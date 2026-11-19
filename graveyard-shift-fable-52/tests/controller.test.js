import { describe, it, expect } from 'vitest';
import { tuning } from '../src/game/tuning.js';
import {
  createPlayerState, stepMovement, stepHealth, applyDamage, applyHeal, flatMoveCapsule, MAX_FRAME_DT,
  blockByBodies, BODY_BLOCK,
} from '../src/player/sim.js';
import { createBot, botCommand } from '../src/player/bot.js';
import { createViewState, stepView } from '../src/player/view.js';
import { createPlayer } from '../src/player/controller.js';
import { createInput } from '../src/player/input.js';
import { createEvents } from '../src/core/events.js';
import { createCollision } from '../src/level/collision.js';

const T = tuning.player;
const FWD = { move: { x: 0, y: 1 }, sprint: false, jump: false };
const SPRINT = { move: { x: 0, y: 1 }, sprint: true, jump: false };

// Small stand-in for the level's moveCapsule over axis-aligned boxes, ground plane at y=0.
// Moves one axis at a time and stops the capsule (as a box of half-width r) at the face it hits.
function boxWorld(boxes) {
  const overlaps = (p, r, h, b) =>
    p[0] + r > b.min[0] && p[0] - r < b.max[0] && p[2] + r > b.min[2] && p[2] - r < b.max[2] &&
    p[1] + h > b.min[1] && p[1] < b.max[1];
  return (pos, r, h, d) => {
    const p = pos.slice();
    for (const a of [0, 2, 1]) {
      p[a] += d[a];
      for (const b of boxes) {
        if (!overlaps(p, r, h, b)) continue;
        const ext = a === 1 ? [0, h] : [r, r];
        if (d[a] > 0) p[a] = b.min[a] - ext[1];
        else if (d[a] < 0) p[a] = b.max[a] + ext[0];
      }
    }
    if (p[1] < 0) p[1] = 0;
    const onGround = p[1] <= 1e-6 || boxes.some((b) => Math.abs(p[1] - b.max[1]) < 1e-6 &&
      p[0] + r > b.min[0] && p[0] - r < b.max[0] && p[2] + r > b.min[2] && p[2] - r < b.max[2]);
    return { pos: p, onGround };
  };
}

const run = (s, cmd, seconds, dt = 1 / 60, world = flatMoveCapsule) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepMovement(s, cmd, dt, world);
};

describe('player movement', () => {
  it('holding forward for 1 s at 60 Hz covers 4.2 m (+-0.1) on flat ground', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, FWD, 1);
    expect(-s.pos[2]).toBeGreaterThan(T.walk - 0.1);
    expect(-s.pos[2]).toBeLessThan(T.walk + 0.1);
    expect(Math.abs(s.pos[0])).toBeLessThan(1e-9);
    expect(s.pos[1]).toBe(0);
    expect(s.onGround).toBe(true);
  });

  it('sprint covers 6.5 m (+-0.1) in 1 s and sets sprinting', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, SPRINT, 1);
    expect(-s.pos[2]).toBeGreaterThan(T.sprint - 0.1);
    expect(-s.pos[2]).toBeLessThan(T.sprint + 0.1);
    expect(s.sprinting).toBe(true);
  });

  it('sprint only applies to forward movement', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, { move: { x: 1, y: 0 }, sprint: true }, 1);
    expect(s.sprinting).toBe(false);
    expect(s.pos[0]).toBeLessThan(T.walk + 0.1);
  });

  it('forward follows yaw (yaw +90deg faces -X)', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: Math.PI / 2 });
    run(s, FWD, 1);
    expect(s.pos[0]).toBeLessThan(-(T.walk - 0.1));
    expect(Math.abs(s.pos[2])).toBeLessThan(1e-6);
  });

  it('walking into a collider does not pass through at dt 0.05, walking or sprinting', () => {
    const wall = { min: [-5, 0, -3.2], max: [5, 3, -3.0] }; // 20 cm thick wall 3 m ahead
    const world = boxWorld([wall]);
    for (const cmd of [FWD, SPRINT]) {
      const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
      run(s, cmd, 3, 0.05, world);
      expect(s.pos[2]).toBeGreaterThanOrEqual(wall.max[2] + T.radius - 1e-9);
      expect(s.pos[2]).toBeLessThan(wall.max[2] + T.radius + 0.01); // pressed against it
      expect(Math.abs(s.vel[2])).toBeLessThan(1e-6); // velocity into the wall is dropped
    }
  });

  it('slides along a wall when moving diagonally into it', () => {
    const world = boxWorld([{ min: [-50, 0, -1.2], max: [50, 3, -1] }]);
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, { move: { x: 0.7071, y: 0.7071 } }, 2, 0.05, world);
    expect(s.pos[2]).toBeGreaterThanOrEqual(-1 + T.radius - 1e-9);
    expect(s.pos[0]).toBeGreaterThan(4);
  });

  it('a dt of 5 s is clamped', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    stepMovement(s, SPRINT, 5);
    expect(-s.pos[2]).toBeLessThanOrEqual(T.sprint * MAX_FRAME_DT + 1e-9);
    expect(-s.pos[2]).toBeGreaterThan(0);
    const h = createPlayerState();
    applyDamage(h, 50);
    stepHealth(h, 5);
    expect(h.health).toBe(50); // 5 s counts as 0.1 s: regen has not started
  });

  it('jumps with tuning jump speed, lands, and records the landing', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    stepMovement(s, { move: { x: 0, y: 0 }, jump: true }, 1 / 60);
    expect(s.onGround).toBe(false);
    let peak = 0;
    for (let i = 0; i < 120 && !s.onGround; i++) {
      stepMovement(s, { move: { x: 0, y: 0 } }, 1 / 60);
      peak = Math.max(peak, s.pos[1]);
    }
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThan(1.0);
    expect(s.onGround).toBe(true);
    expect(s.landSpeed).toBeGreaterThan(3);
  });

  it('does not jump in the air', () => {
    const s = createPlayerState({ pos: [0, 2, 0] });
    s.onGround = false;
    stepMovement(s, { move: { x: 0, y: 0 }, jump: true }, 1 / 60);
    expect(s.vel[1]).toBeLessThan(0);
  });

  it('falls back to a flat floor when moveCapsule returns nothing useful', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, FWD, 1, 1 / 60, () => undefined);
    expect(-s.pos[2]).toBeGreaterThan(T.walk - 0.1);
    expect(s.pos[1]).toBe(0);
  });
});

describe('player health', () => {
  it('damage(34) three times kills', () => {
    const s = createPlayerState();
    expect(applyDamage(s, 34)).toBe(true);
    expect(applyDamage(s, 34)).toBe(true);
    expect(s.alive).toBe(true);
    expect(s.health).toBe(32);
    applyDamage(s, 34);
    expect(s.alive).toBe(false);
    expect(s.health).toBe(0);
    expect(applyDamage(s, 34)).toBe(false); // already dead
  });

  it('regenerates only after 4 s without damage, then at 25/s up to max', () => {
    const s = createPlayerState();
    applyDamage(s, 34);
    for (let i = 0; i < 239; i++) stepHealth(s, 1 / 60); // 3.98 s
    expect(s.health).toBe(66);
    applyDamage(s, 10); // resets the delay
    for (let i = 0; i < 239; i++) stepHealth(s, 1 / 60);
    expect(s.health).toBe(56);
    for (let i = 0; i < 61; i++) stepHealth(s, 1 / 60); // crosses 4 s, then ~1 s of regen
    expect(s.health).toBeGreaterThan(56 + 20);
    expect(s.health).toBeLessThan(56 + 27);
    for (let i = 0; i < 600; i++) stepHealth(s, 1 / 60);
    expect(s.health).toBe(T.health);
  });

  it('god mode ignores damage; heal caps at max; the dead do not heal', () => {
    const s = createPlayerState();
    expect(applyDamage(s, 99, { god: true })).toBe(false);
    expect(s.health).toBe(100);
    applyDamage(s, 30);
    applyHeal(s, 50);
    expect(s.health).toBe(100);
    applyDamage(s, 200);
    applyHeal(s, 50);
    expect(s.health).toBe(0);
  });
});

describe('view feel (subtle)', () => {
  it('head bob stays within 3 cm, sprint kicks FOV by ~5 deg, landing dips under 15 cm', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    const v = createViewState();
    let minY = 0; let fov = 0; let dip = 0;
    for (let i = 0; i < 120; i++) {
      stepMovement(s, SPRINT, 1 / 60);
      const o = stepView(v, s, 1 / 60, T.eye);
      minY = Math.min(minY, o.offset[1]); fov = o.fovAdd;
    }
    expect(minY).toBeLessThan(-0.01);
    expect(minY).toBeGreaterThan(-0.05);
    expect(fov).toBeGreaterThan(4);
    expect(fov).toBeLessThanOrEqual(5);
    s.landSpeed = 8; // hard landing
    for (let i = 0; i < 30; i++) dip = Math.min(dip, stepView(v, s, 1 / 60, T.eye).offset[1]);
    expect(dip).toBeLessThan(-0.05);
    expect(dip).toBeGreaterThanOrEqual(-0.15 - 0.05);
  });
});

describe('bot', () => {
  it('walks a 10 m square loop on flat ground without getting stuck', () => {
    const s = createPlayerState({ pos: [2, 0, 3], yaw: 0.4 });
    const bot = createBot({ pos: s.pos.slice(), yaw: s.yaw });
    const visited = new Set();
    for (let i = 0; i < 60 * 40; i++) {
      const cmd = botCommand(bot, s, 1 / 60);
      s.yaw = cmd.yaw; s.pitch = cmd.pitch;
      stepMovement(s, cmd, 1 / 60);
      bot.loop.forEach((c, k) => { if (Math.hypot(c[0] - s.pos[0], c[1] - s.pos[2]) < 0.5) visited.add(k); });
    }
    expect(visited.size).toBe(4);
    expect(bot.laps).toBeGreaterThanOrEqual(2);
    expect(bot.stuck).toBe(0);
  });

  it('stuck guard moves on when a corner is unreachable', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    const bot = createBot({ pos: s.pos.slice(), yaw: 0 });
    const world = boxWorld([{ min: [-3, 0, -6], max: [3, 5, -5] }]); // wall across the first side
    for (let i = 0; i < 60 * 20; i++) {
      const cmd = botCommand(bot, s, 1 / 60);
      s.yaw = cmd.yaw; s.pitch = cmd.pitch;
      stepMovement(s, cmd, 1 / 60, world);
    }
    expect(bot.stuck).toBeGreaterThan(0);
    expect(bot.wp).not.toBe(1);
  });

  it('setGoal walks to the goal; fireAt faces the target and fires once', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    const bot = createBot({ pos: [0, 0, 0], yaw: 0 });
    bot.setGoal(6, 4);
    for (let i = 0; i < 60 * 5; i++) {
      const cmd = botCommand(bot, s, 1 / 60);
      s.yaw = cmd.yaw; s.pitch = cmd.pitch;
      stepMovement(s, cmd, 1 / 60);
    }
    expect(Math.hypot(s.pos[0] - 6, s.pos[2] - 4)).toBeLessThan(0.5);
    bot.fireAt([6, 1.7, -10]);
    const cmd = botCommand(bot, s, 1 / 60);
    expect(cmd.fire).toBe(true);
    expect(cmd.yaw).toBeCloseTo(0, 1); // target is straight down -Z
    expect(botCommand(bot, s, 1 / 60).fire).toBe(false);
  });
});

describe('G.player wiring (no DOM)', () => {
  const makeG = (params = {}) => {
    const G = { params, events: createEvents(), time: { t: 0 }, level: null, game: { stub: true } };
    G.input = createInput(G);
    G.player = createPlayer(G);
    return G;
  };

  it('damage emits player:damage then player:dead, god=1 ignores it', () => {
    const G = makeG();
    const seen = [];
    G.events.on('player:damage', (e) => seen.push(['damage', e.amount]));
    G.events.on('player:dead', () => seen.push(['dead']));
    for (let i = 0; i < 3; i++) G.player.damage(34, [0, 0, -1]);
    expect(seen).toEqual([['damage', 34], ['damage', 34], ['damage', 34], ['dead']]);
    expect(G.player.lastDamage.angle).toBeCloseTo(0); // source straight ahead
    G.player.reset();
    expect(G.player.alive).toBe(true);
    expect(G.player.health).toBe(100);

    const god = makeG({ god: true });
    god.player.damage(500, [1, 0, 0]);
    expect(god.player.health).toBe(100);
  });

  it('does not move while a real game is paused, and moves while playing', () => {
    const G = makeG();
    G.game = { state: 'paused' };
    G.input.move.y = 1;
    for (let i = 0; i < 30; i++) G.player.update(1 / 60);
    expect(G.player.pos[2]).toBe(0);
    G.game.state = 'playing';
    for (let i = 0; i < 30; i++) G.player.update(1 / 60);
    expect(G.player.pos[2]).toBeLessThan(-1);
  });

  it('recoil moves the aim and mostly recovers', () => {
    const G = makeG();
    const f0 = G.player.forward[1];
    G.player.addRecoil(0.05, 0);
    G.player.update(1 / 60);
    expect(G.player.forward[1]).toBeGreaterThan(f0 + 0.02);
    for (let i = 0; i < 120; i++) G.player.update(1 / 60);
    expect(G.player.forward[1]).toBeGreaterThan(f0); // a share stays in the aim
    expect(G.player.forward[1]).toBeLessThan(f0 + 0.02);
  });

  it('bot=1 exposes setGoal and fireAt and fires through input', () => {
    const G = makeG({ bot: true });
    expect(typeof G.player.bot.setGoal).toBe('function');
    G.player.bot.fireAt([0, 1.7, -10]);
    G.input.update(1 / 60);
    G.player.update(1 / 60);
    expect(G.input.fire).toBe(true);
    expect(G.input.pressed('fire')).toBe(true);
    G.input.update(1 / 60);
    expect(G.input.pressed('fire')).toBe(false);
  });
});

describe('zombies are solid to the player', () => {
  const body = (x, z) => ({ pos: { x, y: 0, z } });
  const withBodies = (bodies, world = flatMoveCapsule) => (pos, r, h, d) => {
    const res = world(pos, r, h, d);
    const to = res.pos.slice();
    if (!blockByBodies(pos, to, bodies)) return res;
    return { pos: world(res.pos, r, h, [to[0] - res.pos[0], 0, to[2] - res.pos[2]]).pos, onGround: res.onGround };
  };
  const gap = (s, b) => Math.hypot(s.pos[0] - b.pos.x, s.pos[2] - b.pos.z);

  it('walking straight at a zombie stops at the block radius', () => {
    const z = body(0, -3);
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, FWD, 3, 1 / 60, withBodies([z]));
    expect(gap(s, z)).toBeGreaterThanOrEqual(BODY_BLOCK - 1e-6);
    expect(s.pos[2]).toBeGreaterThan(-3); // did not pass through
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(0.5);
  });

  it('a glancing approach slides round the zombie and carries on', () => {
    const z = body(0.25, -3);
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    let closest = Infinity;
    const world = withBodies([z]);
    for (let i = 0; i < 180; i++) { stepMovement(s, FWD, 1 / 60, world); closest = Math.min(closest, gap(s, z)); }
    expect(closest).toBeGreaterThanOrEqual(BODY_BLOCK - 1e-6);
    expect(s.pos[2]).toBeLessThan(-5); // got past
    expect(s.pos[0]).toBeLessThan(0); // on the side it was already offset to
  });

  it('a row of zombies shoulder to shoulder cannot be walked through', () => {
    const row = [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].map((x) => body(x, -3));
    for (const x0 of [-0.9, -0.6, -0.31, 0, 0.2, 0.45]) {
      const s = createPlayerState({ pos: [x0, 0, 0], yaw: 0 });
      run(s, SPRINT, 4, 1 / 60, withBodies(row));
      expect(s.pos[2]).toBeGreaterThan(-3);
      for (const z of row) expect(gap(s, z)).toBeGreaterThanOrEqual(BODY_BLOCK - 1e-6);
    }
  });

  it('a zombie that steps into the player does not shove them, and they can walk out', () => {
    const z = body(0, -0.2); // already overlapping
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    const world = withBodies([z]);
    run(s, { move: { x: 0, y: 0 } }, 0.5, 1 / 60, world);
    expect(s.pos[0]).toBeCloseTo(0); expect(s.pos[2]).toBeCloseTo(0); // not pushed
    run(s, FWD, 0.5, 1 / 60, world); // into it: goes no deeper
    expect(gap(s, z)).toBeGreaterThanOrEqual(0.2 - 1e-6);
    run(s, { move: { x: 0, y: -1 } }, 1, 1 / 60, world); // backing away is free
    expect(s.pos[2]).toBeGreaterThan(2);
  });

  it('a zombie that has lunged inside the circle cannot be slipped past, only backed away from', () => {
    const z = body(0.35, -0.1); // at the player's right shoulder, well inside 0.6
    const world = withBodies([z]);
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, FWD, 1, 1 / 60, world); // straight ahead is nearly tangent to it
    expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThan(0.3);
    expect(gap(s, z)).toBeGreaterThanOrEqual(Math.hypot(0.35, 0.1) - 1e-6); // and no deeper
    const t = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(t, { move: { x: -1, y: 0 } }, 1, 1 / 60, world); // strafing left, away from it: free
    expect(t.pos[0]).toBeLessThan(-3);
  });

  it('a crowd in mid-swing (every body inside the circle) is not walked through', () => {
    const crowd = [];
    for (let row = 0; row < 3; row++) for (let k = -3; k <= 3; k++) crowd.push(body(k * 0.55 + (row % 2) * 0.27, -0.4 - row * 0.5));
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    run(s, SPRINT, 6, 1 / 60, withBodies(crowd));
    expect(s.pos[2]).toBeGreaterThan(-0.4);
    expect(Math.abs(s.pos[0])).toBeLessThan(1);
  });

  it('ringed by zombies the player still gets out through a gap wider than two radii', () => {
    const ring = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.3; if (k !== 0) ring.push(body(Math.sin(a) * 1.0, Math.cos(a) * 1.0)); }
    const a0 = 0.3; // the open side
    const s = createPlayerState({ pos: [0, 0, 0], yaw: Math.atan2(-Math.sin(a0), -Math.cos(a0)) });
    run(s, FWD, 2, 1 / 60, withBodies(ring));
    expect(Math.hypot(s.pos[0], s.pos[2])).toBeGreaterThan(3);
  });

  it('being stopped by a body never pushes the player through a wall', () => {
    const wall = { min: [-5, 0, -1.6], max: [5, 3, -1.2] };
    const z = body(0.3, -0.5);
    const s = createPlayerState({ pos: [-1.2, 0, -0.8], yaw: -Math.PI / 2 }); // walking +x along the wall
    run(s, FWD, 3, 1 / 60, withBodies([z], boxWorld([wall])));
    expect(s.pos[2] - T.radius).toBeGreaterThanOrEqual(-1.2 - 1e-6);
    expect(s.pos.every(Number.isFinite)).toBe(true);
  });

  it('standing above their heads (a car roof) is not blocked; bad bodies are ignored', () => {
    const to = [0, 1.6, 0];
    expect(blockByBodies([0, 1.6, 1], to, [body(0, 0)])).toBe(false);
    const t2 = [0, 0, 0.1];
    expect(blockByBodies([0, 0, 1], t2, [null, {}, { pos: { x: NaN, z: 0 } }])).toBe(false);
    expect(t2).toEqual([0, 0, 0.1]);
  });

  it('G.player moves through G.zombies.list: the real controller is blocked too', () => {
    const G = {
      params: {}, events: createEvents(), time: { t: 0 },
      level: { moveCapsule: flatMoveCapsule, playerStart: { pos: [0, 0, 0], yaw: 0 }, bounds: { min: [-50, -1, -50], max: [50, 20, 50] } },
      zombies: { list: [{ id: 1, pos: { x: 0, y: 0, z: -2 }, alive: true }] },
    };
    G.input = { move: { x: 0, y: 1 }, look: { dx: 0, dy: 0 }, pressed: () => false };
    G.player = createPlayer(G);
    for (let i = 0; i < 180; i++) G.player.update(1 / 60);
    expect(G.player.pos[2]).toBeGreaterThan(-2 + BODY_BLOCK - 1e-6);
    G.zombies.list.length = 0; // it dies: the way is clear
    for (let i = 0; i < 60; i++) G.player.update(1 / 60);
    expect(G.player.pos[2]).toBeLessThan(-3);
  });
});


describe('player hooks', () => {
  const makeG = (params = {}) => {
    const G = { params, events: createEvents(), time: { t: 0 }, level: null, game: { stub: true } };
    G.input = createInput(G);
    G.player = createPlayer(G);
    return G;
  };

  it('34 damage with 1 plate leaves health 100 and plates 1 with 16 hp of plate left', () => {
    const G = makeG();
    expect(G.player.plates).toBe(0);
    expect(G.player.addPlates(1)).toBe(1);
    G.player.damage(34, [0, 0, -1]);
    expect(G.player.health).toBe(100);
    expect(G.player.plates).toBe(1);
    expect(G.player.plateHp).toBe(16);
  });

  it('120 damage with 2 plates leaves health 80, plates 0; armor:change follows the plate count', () => {
    const G = makeG();
    const seen = [];
    G.events.on('armor:change', (e) => seen.push(e.plates));
    G.player.addPlates(2);
    G.player.damage(120, [0, 0, -1]);
    expect(G.player.health).toBe(80);
    expect(G.player.plates).toBe(0);
    expect(seen).toEqual([2, 0]);
  });

  it('addPlates caps at 3, replaces a cracked plate, and returns how many went on', () => {
    const G = makeG();
    expect(G.player.addPlates(5)).toBe(3);
    expect(G.player.addPlates(1)).toBe(0);
    G.player.damage(10);
    expect(G.player.plates).toBe(3);
    expect(G.player.addPlates(1)).toBe(1); // the cracked one is swapped
    expect(G.player.plateHp).toBe(tuning.touch.plate);
    G.player.reset();
    expect(G.player.plates).toBe(0);
    expect(makeG({ plates: 2 }).player.plates).toBe(2);
  });

  it('maxHealth = 175 then full regen reaches 175; lowering it clamps health', () => {
    const G = makeG();
    G.player.maxHealth = 175;
    for (let i = 0; i < 60 * 8; i++) G.player.update(1 / 60);
    expect(G.player.health).toBe(175);
    G.player.maxHealth = 100;
    expect(G.player.health).toBe(100);
    G.player.maxHealth = 175;
    G.player.reset();
    expect(G.player.maxHealth).toBe(100);
  });

  it('speedScale 1.12 moves 4.70 m in 1 s walking', () => {
    const s = createPlayerState({ pos: [0, 0, 0], yaw: 0 });
    s.speedScale = 1.12;
    run(s, FWD, 1);
    expect(-s.pos[2]).toBeGreaterThan(4.70 - 0.1);
    expect(-s.pos[2]).toBeLessThan(4.70 + 0.1);
    const G = makeG();
    expect(G.player.speedScale).toBe(1);
  });

  it('a lethal hit with a hook returning {health:50, invuln:3} leaves the player alive at 50 and immune for 3 s of sim time; the hook is asked once until re-armed', () => {
    const G = makeG();
    let asked = 0;
    const seen = [];
    G.events.on('player:dead', () => seen.push('dead'));
    G.player.setLethalHook(() => { asked++; return { health: 50, invuln: 3 }; });
    G.player.damage(60);
    expect(asked).toBe(0); // not lethal
    G.player.damage(60);
    expect(asked).toBe(1);
    expect(G.player.alive).toBe(true);
    expect(G.player.health).toBe(50);
    expect(G.player.invulnerable).toBeCloseTo(3);
    expect(G.player.damage(200)).toBe(false);
    G.input.paused = true; // paused: sim time stands still, so the immunity holds
    for (let i = 0; i < 300; i++) G.player.update(1 / 60);
    expect(G.player.invulnerable).toBeCloseTo(3);
    G.input.paused = false;
    for (let i = 0; i < 170; i++) G.player.update(1 / 60);
    expect(G.player.damage(1)).toBe(false); // 2.83 s in
    for (let i = 0; i < 12; i++) G.player.update(1 / 60);
    expect(G.player.invulnerable).toBe(0);
    G.player.health = 10;
    G.player.damage(200);
    expect(asked).toBe(1); // not re-armed
    expect(G.player.alive).toBe(false);
    expect(seen).toEqual(['dead']);
    G.player.reset();
    G.player.setLethalHook(() => { asked++; return null; }); // a hook that declines
    G.player.damage(200);
    expect(asked).toBe(2);
    expect(G.player.alive).toBe(false);
  });

  it('standing on a slip collider for 2 s then sliding off lands with fall speed under 3 m/s', () => {
    const box = { min: [-7, 0, -1], max: [7, 0.25, 1], surface: 'metal', slip: { c: [0, 0], side: [1, 0] } };
    const col = createCollision([box]);
    const s = createPlayerState({ pos: [0.1, 0.25, 0], yaw: 0 });
    s.onGround = false;
    const idle = { move: { x: 0, y: 0 } };
    let onCar = 0;
    for (let i = 0; i < 240; i++) {
      stepMovement(s, idle, 1 / 60, col.moveCapsule);
      if (s.pos[1] > 0.25 - 1e-6) onCar += 1 / 60;
    }
    expect(onCar).toBeGreaterThan(2); // it really stood on the car that long
    expect(s.pos[1]).toBe(0);
    expect(s.onGround).toBe(true);
    expect(s.landSpeed).toBeGreaterThan(0);
    expect(s.landSpeed).toBeLessThan(3);
  });
});

describe('input: actions and holds (no DOM)', () => {
  it('synth reaches the new actions; held(name) counts seconds', () => {
    const G = { params: {}, events: createEvents() };
    const input = createInput(G);
    for (const a of ['swap', 'melee', 'throw', 'cycle', 'slot1', 'slot2', 'hint']) {
      input.synth(a);
      expect(input.pressed(a)).toBe(true);
    }
    expect(input.held('interact')).toBe(0);
    expect(input.mode).toBe('lock');
    expect(input.touch && typeof input.touch.setLayout).toBe('function');
  });

  it('a touch layout drives move, look and fire through G.input', () => {
    const G = { params: { touch: true }, events: createEvents(), device: { touch: true, onChange() {} } };
    const input = createInput(G);
    expect(input.mode).toBe('touch');
    const layout = {
      stick: { x: 150, y: 280, r: 150 }, look: { x: 340, y: 0, w: 460, h: 400 },
      buttons: [{ name: 'fire', x: 700, y: 300, r: 42, mode: 'hold', look: true }],
    };
    input.touch.setLayout(layout);
    expect(input.touch.layout).toBe(layout);
    expect(input.touch.rects.buttons[0]).toMatchObject({ name: 'fire', x: 658, y: 258, w: 84, h: 84 });
    const m = input.touch.machine;
    m.down(1, 150, 280, 0); m.move(1, 150, 224, 1);
    m.down(2, 700, 300, 0);
    input.update(1 / 60);
    expect(input.move.y).toBeCloseTo(1, 5);
    expect(input.fire).toBe(true);
    expect(input.pressed('fire')).toBe(true);
    input.update(1 / 60);
    expect(input.pressed('fire')).toBe(false);
    expect(input.held('fire')).toBeCloseTo(2 / 60, 6);
    expect(input.touch.state.buttons.fire).toBe(true);
    input.touch.cancelAll();
    input.update(1 / 60);
    expect(input.fire).toBe(false);
    expect(input.move.y).toBe(0);
    expect(input.held('fire')).toBe(0);
  });
});

describe('touch sprint, speed scale and auto-fire', () => {
  const LAYOUT = {
    stick: { x: 150, y: 280, r: 150 }, look: { x: 340, y: 0, w: 460, h: 400 },
    buttons: [
      { name: 'fire', x: 700, y: 300, r: 42, mode: 'hold', look: true },
      { name: 'ads', x: 640, y: 220, r: 28, mode: 'hold' },
    ],
  };
  const touchG = (extra = {}) => {
    const G = {
      params: { touch: true }, events: createEvents(), time: { t: 0 }, game: { stub: true },
      device: { touch: true, coarse: true, onChange() {} },
      level: { moveCapsule: flatMoveCapsule, playerStart: { pos: [0, 0, 0], yaw: 0 }, bounds: { min: [-50, -1, -50], max: [50, 20, 50] } },
      ...extra,
    };
    G.input = createInput(G);
    G.input.touch.setLayout(LAYOUT);
    G.player = createPlayer(G);
    return G;
  };
  const frame = (G, n = 1) => { for (let i = 0; i < n; i++) { G.input.update(1 / 60); G.player.update(1 / 60); } };

  it('the touch stick does not auto-sprint while fire or ads is held or the weapon reloads', () => {
    const G = touchG({ weapon: { reloading: false } });
    const m = G.input.touch.machine;
    m.down(1, 150, 280, 0); m.move(1, 150, 220, 1);
    frame(G, 30);
    expect(G.input.sprint).toBe(true);
    expect(G.player.sprinting).toBe(true);
    m.down(2, 700, 300, 0); // fire
    frame(G, 1);
    expect(G.input.sprint).toBe(false);
    frame(G, 5);
    expect(G.player.sprinting).toBe(false);
    m.up(2, 10);
    m.down(3, 640, 220, 0); // ads
    frame(G, 5);
    expect(G.input.sprint).toBe(false);
    m.up(3, 10);
    G.weapon.reloading = true;
    frame(G, 5);
    expect(G.input.sprint).toBe(false);
    G.weapon.reloading = false;
    frame(G, 2);
    expect(G.input.sprint).toBe(true);
  });

  it('...nor while auto-fire is on target', () => {
    const G = touchG({
      zombies: { list: [{ id: 1, pos: { x: 0, y: 0, z: -10 }, alive: true }], raycast: () => ({ id: 1, dist: 10 }) },
    });
    G.level.raycast = () => null;
    G.input.touch.autoFire = true; // the auto-fire assist is opt-in
    G.player.pitch = Math.atan2(-0.5, 10); // at the chest
    const m = G.input.touch.machine;
    m.down(1, 150, 280, 0); m.move(1, 150, 220, 1);
    frame(G, 30);
    expect(G.input.touch.onTarget).toBe(true);
    expect(G.input.sprint).toBe(false);
  });

  it('setSpeedScale: named factors multiply; 1 removes one; reset clears them', () => {
    const G = touchG();
    expect(G.player.speedScale).toBe(1);
    G.player.setSpeedScale('weapon', 0.9);
    G.player.setSpeedScale('perk', 1.12);
    expect(G.player.speedScale).toBeCloseTo(1.008, 9);
    G.player.setSpeedScale('weapon', 1);
    expect(G.player.speedScale).toBeCloseTo(1.12, 9);
    G.player.speedScale = 5; // read-only
    expect(G.player.speedScale).toBeCloseTo(1.12, 9);
    G.input.move.y = 1;
    G.player.reset();
    expect(G.player.speedScale).toBe(1);
  });

  describe('touchAim (auto-fire through the real controller)', () => {
    const zombieAhead = (levelDist) => {
      const G = touchG({
        zombies: { list: [{ id: 1, pos: { x: 0, y: 0, z: -10 }, alive: true }], raycast: () => ({ id: 1, dist: 10 }) },
      });
      G.level.raycast = (o, d, max) => (levelDist !== null && levelDist <= max ? { dist: levelDist } : null);
      G.input.touch.autoFire = true; // the auto-fire assist is opt-in
      G.player.pitch = Math.atan2(-0.5, 10);
      let synths = 0;
      const synth = G.input.synth;
      G.input.synth = (n) => { if (n === 'fire') synths++; synth(n); };
      return { G, count: () => synths };
    };
    it('on target with a clear line: semi-auto fires 4 a second at most, the first shot after 0.12 s', () => {
      const { G, count } = zombieAhead(null);
      frame(G, 6);
      expect(count()).toBe(0);
      frame(G, 3);
      expect(count()).toBe(1);
      frame(G, 51); // 1 s in all
      expect(count()).toBeGreaterThanOrEqual(4);
      expect(count()).toBeLessThanOrEqual(4); // tuning.touch.assistSemiRate
    });
    it('a level ray closer than the zombie hit gives no fire synth', () => {
      const { G, count } = zombieAhead(5);
      frame(G, 60);
      expect(count()).toBe(0);
      expect(G.input.touch.onTarget).toBe(false);
    });
    it('no dry-fire synth when magazine and reserve are both empty', () => {
      const { G, count } = zombieAhead(null);
      G.weapon = { ammo: { mag: 0, reserve: 0 }, reloading: false };
      frame(G, 60);
      expect(count()).toBe(0);
    });
    it('with no rounds left, a zombie in the crosshair does not count as on target (sprint is not held back)', () => {
      const { G } = zombieAhead(null);
      G.weapon = { ammo: { mag: 0, reserve: 0 }, reloading: false };
      frame(G, 30);
      expect(G.input.touch.onTarget).toBe(false);
    });
    it('the auto-fire ray follows the aim including recoil, like player.forward', () => {
      const { G } = zombieAhead(null);
      const dirs = [];
      const ray = G.zombies.raycast;
      G.zombies.raycast = (o, d, max) => { dirs.push(d.slice()); return ray(o, d, max); };
      frame(G, 2);
      G.player.addRecoil(0.04, 0.01); // 0.03 rad springs back, 0.01 stays in the aim
      dirs.length = 0;
      frame(G, 1);
      const d = dirs[dirs.length - 1];
      const f = G.player.forward;
      expect(d[1] - Math.sin(G.player.pitch)).toBeGreaterThan(0.02); // the springing share of the recoil
      expect(Math.hypot(d[0] - f[0], d[1] - f[1], d[2] - f[2])).toBeLessThan(0.01);
    });
    it('friction and magnetism ignore a target behind a wall', () => {
      const { G } = zombieAhead(5);
      G.player.pitch = Math.atan2(-0.5, 10) + 0.03; // 1.7 deg above the chest: inside the 2.2 deg friction cone
      const m = G.input.touch.machine;
      m.down(1, 150, 280, 0); m.move(1, 150, 240, 1); // stick deflected (magnetism would pull)
      const p0 = G.player.pitch;
      frame(G, 10);
      expect(G.player.pitch).toBeCloseTo(p0, 9); // not pulled
      m.down(2, 400, 100, 0); m.move(2, 410, 100, 2);
      const y0 = G.player.yaw;
      frame(G, 1);
      const turned = y0 - G.player.yaw;
      expect(turned).toBeGreaterThan(10 * tuning.touch.look * 0.9); // full scale, no friction
    });
  });
});

describe('input in a DOM (fakes)', () => {
  const fakeTarget = () => {
    const l = {};
    return { l, addEventListener(t, f) { (l[t] ||= []).push(f); }, removeEventListener() {}, fire(t, e = {}) { for (const f of (l[t] || []).slice()) f(e); } };
  };
  let saved;
  const install = () => {
    saved = { window: globalThis.window, document: globalThis.document };
    const win = fakeTarget();
    win.performance = globalThis.performance;
    win.screen = { orientation: fakeTarget() };
    const canvas = { tagName: 'CANVAS', closest: () => null, locks: 0 };
    const doc = fakeTarget();
    Object.assign(doc, {
      body: { tagName: 'BODY', appendChild() {} }, documentElement: { tagName: 'HTML' }, hidden: false,
      pointerLockElement: null,
      querySelector: () => canvas, getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {} }),
      exitPointerLock() { if (doc.pointerLockElement) { doc.pointerLockElement = null; doc.fire('pointerlockchange'); } },
    });
    canvas.requestPointerLock = () => { canvas.locks++; };
    globalThis.window = win;
    globalThis.document = doc;
    return { win, doc, canvas };
  };
  const restore = () => { globalThis.window = saved.window; globalThis.document = saved.document; };
  const makeGame = () => {
    const game = { state: 'playing', pause() { if (game.state === 'playing') game.state = 'paused'; }, resume() { if (game.state === 'paused') game.state = 'playing'; } };
    return game;
  };

  it('touch mode: no pointer lock; blur, hidden and pagehide pause, portrait does not; nothing held after', () => {
    const { win, doc, canvas } = install();
    try {
      const cbs = [];
      const G = { params: {}, events: createEvents(), game: makeGame(), device: { touch: true, coarse: true, portrait: false, onChange: (f) => cbs.push(f) } };
      const input = createInput(G);
      expect(input.mode).toBe('touch');
      input.requestLock();
      win.fire('mousedown', { target: canvas, button: 0 });
      expect(canvas.locks).toBe(0);
      win.fire('blur');
      expect(G.game.state).toBe('paused');
      G.game.resume();
      doc.hidden = true; doc.fire('visibilitychange'); doc.hidden = false;
      expect(G.game.state).toBe('paused');
      G.game.resume();
      win.fire('pagehide');
      expect(G.game.state).toBe('paused');
      G.game.resume();
      // turning upright does not pause (the game plays in portrait), but no finger survives the turn
      input.touch.setLayout({ stick: { x: 150, y: 280, r: 150 }, buttons: [] });
      input.touch.machine.down(1, 150, 280, 0); input.touch.machine.move(1, 150, 224, 1);
      input.update(1 / 60);
      expect(input.move.y).toBeGreaterThan(0);
      G.device.portrait = true;
      for (const f of cbs) f(G.device);
      expect(G.game.state).toBe('playing');
      input.update(1 / 60);
      expect(input.move.y).toBe(0);
      G.device.portrait = false;
      for (const f of cbs) f(G.device);
      expect(G.game.state).toBe('playing');
      input.touch.setLayout({ stick: { x: 150, y: 280, r: 150 }, buttons: [] });
      input.touch.machine.down(1, 150, 280, 0); input.touch.machine.move(1, 150, 224, 1);
      win.screen.orientation.fire('change');
      input.update(1 / 60);
      expect(input.move.y).toBe(0);
    } finally { restore(); }
  });

  it('touch laptop: a mouse pointerdown goes back to lock mode and asks for the lock; a touch goes back to touch', () => {
    const { win, canvas } = install();
    try {
      const modes = [];
      const G = { params: {}, events: createEvents(), game: makeGame(), device: { touch: true, coarse: false, portrait: false, onChange() {} } };
      G.events.on('input:mode', (e) => modes.push(e.mode));
      const input = createInput(G);
      expect(input.mode).toBe('touch');
      win.fire('pointerdown', { pointerType: 'mouse', target: canvas });
      expect(input.mode).toBe('lock');
      expect(canvas.locks).toBe(1);
      const e = { target: canvas, cancelable: true, preventDefault() {}, changedTouches: [{ identifier: 1, clientX: 10, clientY: 10 }], touches: [{ identifier: 1, clientX: 10, clientY: 10 }] };
      win.fire('touchstart', e);
      expect(input.mode).toBe('touch');
      expect(modes).toEqual(['lock', 'touch']);
      // a phone (coarse) never leaves touch mode on a mouse event
      const P = { params: {}, events: createEvents(), game: makeGame(), device: { touch: true, coarse: true, onChange() {} } };
      const pin = createInput(P);
      win.fire('pointerdown', { pointerType: 'mouse', target: canvas });
      expect(pin.mode).toBe('touch');
    } finally { restore(); }
  });

  it('lock mode: refusals within 1.5 s of losing the lock do not count; two later ones fall back to drag', () => {
    const { win, doc, canvas } = install();
    const realNow = performance.now.bind(performance);
    let now = 1000;
    performance.now = () => now;
    try {
      const G = { params: {}, events: createEvents(), game: makeGame(), device: { touch: false, coarse: false, onChange() {} } };
      const input = createInput(G);
      expect(input.mode).toBe('lock');
      doc.pointerLockElement = canvas; doc.fire('pointerlockchange');
      expect(input.locked).toBe(true);
      doc.pointerLockElement = null; doc.fire('pointerlockchange'); // Esc: lost
      expect(G.game.state).toBe('paused');
      G.game.resume();
      doc.fire('pointerlockerror'); now += 500; doc.fire('pointerlockerror'); // the browser's cooldown
      expect(input.mode).toBe('lock');
      now += 2000;
      G.game.resume();
      doc.fire('pointerlockerror');
      expect(input.mode).toBe('lock');
      G.game.resume();
      doc.fire('pointerlockerror');
      expect(input.mode).toBe('drag');
    } finally { performance.now = realNow; restore(); }
  });
});
