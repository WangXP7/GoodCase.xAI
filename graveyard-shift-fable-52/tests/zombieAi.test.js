import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createZombies } from '../src/zombie/manager.js';
import {
  createCrowd, addAgent, crowdThink, crowdMove, createObstacles, pickSpawn, pickHidden, inView, createGhostAnimator, AI, CHASE, WINDUP, RECOVER, CLIMB,
} from '../src/zombie/ai.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { tuning } from '../src/game/tuning.js';
import { buildWorld, createWorldState, navLinks } from '../src/level/world.js';
import * as WL from '../src/level/worldLayout.js';
import { createAtlas } from '../src/level/atlas.js';
import { createCollision } from '../src/level/collision.js';
import { createNav, createFlowField } from '../src/nav/flowfield.js';

// The tests inject a stub body and the ghost animator, so the real body, animator and test-stage
// modules (owned by the body task, often mid-rework) are replaced and never loaded.
vi.mock('../src/zombie/body.js', () => ({ buildZombie: () => { throw new Error('real body not used in tests'); } }));
vi.mock('../src/zombie/anim.js', () => ({ createAnimator: () => { throw new Error('real animator not used in tests'); } }));
vi.mock('../src/zombie/zombietest.js', () => ({ installZombieTest: () => ({ update() {} }) }));

const DT = 1 / 60;

// A body with the documented shape: mesh (position/rotation/visible), blood, LOD and a capsule
// raycast (a vertical 0.3 m cylinder from 0 to 1.8 m, head above 1.5 m).
function stubBuilder() {
  const made = [];
  const build = (seed) => {
    const blood = {};
    const mesh = {
      visible: true,
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { y: 0 },
    };
    const z = {
      seed, mesh, skeleton: { bones: [] },
      setBlood(p, a) { blood[p] = a; }, getBlood: (p) => blood[p] || 0, setLod() {}, setWet() {},
      raycast(o, d, maxDist = Infinity) {
        const ox = o[0] - mesh.position.x, oz = o[2] - mesh.position.z;
        const a = d[0] * d[0] + d[2] * d[2];
        if (a < 1e-9) return null;
        const t = -(ox * d[0] + oz * d[2]) / a;
        const cx = ox + d[0] * t, cz = oz + d[2] * t;
        if (cx * cx + cz * cz > 0.09 || t < 0 || t > maxDist) return null;
        const y = o[1] + d[1] * t;
        if (y < 0 || y > 1.8) return null;
        return { part: y > 1.5 ? 'head' : 'torso', dist: t, pos: [o[0] + d[0] * t, y, o[2] + d[2] * t] };
      },
    };
    made.push(z);
    return z;
  };
  return { build, made };
}

function makeG({ spawnPoints = [], colliders = [], player = [0, 0, 0], seed = 1 } = {}) {
  const events = createEvents((e) => { throw e; });
  const G = {
    params: {}, rng: createRng(seed), events,
    time: { t: 0, dt: 0, frame: 0 },
    scene: { add() {} },
    camera: null,
    level: { colliders, spawnPoints, raycast: () => null },
    nav: null,
    player: { pos: player.slice(), alive: true, damage: vi.fn(() => true) },
    game: { state: 'playing', round: 1 },
  };
  const log = [];
  for (const n of ['zombie:spawn', 'zombie:attack', 'zombie:die', 'zombie:remove']) events.on(n, (p) => log.push([n, p]));
  return { G, log };
}

function setup(opts) {
  const { G, log } = makeG(opts);
  const sb = stubBuilder();
  const Z = createZombies(G, { build: sb.build, animate: () => createGhostAnimator() });
  G.zombies = Z;
  const step = (n = 1) => { for (let k = 0; k < n; k++) { G.time.t += DT; Z.update(DT); } };
  return { G, Z, log, sb, step };
}

const rec = (Z, id) => Z.list.find((r) => r.id === id);
const dist = (r, p) => Math.hypot(r.pos.x - p[0], r.pos.z - p[2]);

describe('approach', () => {
  it('a zombie 10 m away reaches attack range in 10/speed s +-15%', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { Z, step } = setup({ seed });
      const ang = seed * 1.1;
      const id = Z.spawn([Math.sin(ang) * 10, 0, Math.cos(ang) * 10]);
      const r = rec(Z, id);
      expect(r.speed).toBeGreaterThanOrEqual(1.1);
      expect(r.speed).toBeLessThanOrEqual(1.6);
      let t = 0;
      while (dist(r, [0, 0, 0]) > tuning.walker.reach && t < 30) { step(); t += DT; }
      const ideal = 10 / r.speed;
      expect(t).toBeGreaterThan(ideal * 0.85);
      expect(t).toBeLessThan(ideal * 1.15);
    }
  });

  it('opts.slow (round 1): walkers at the low end of their speed range, the same draw otherwise', () => {
    const [lo, hi] = tuning.zombies.types.walker.speed;
    for (let seed = 1; seed <= 8; seed++) {
      const a = setup({ seed }), b = setup({ seed });
      const fast = rec(a.Z, a.Z.spawn([0, 0, 10])).speed;
      const slow = rec(b.Z, b.Z.spawn([0, 0, 10], { slow: true })).speed;
      expect(slow).toBeGreaterThanOrEqual(lo);
      expect(slow).toBeLessThanOrEqual(lo + 0.2 * (hi - lo) + 1e-9);
      expect(slow).toBeCloseTo(lo + (fast - lo) * 0.2, 9);
    }
  });

  it('opts.minDist: a point in view is swapped only for one at least that far', () => {
    const pts = [{ pos: [0, 0, 10] }, { pos: [0, 0, -30] }, { pos: [12, 0, 0] }];
    const { Z } = setup({ spawnPoints: pts });
    const r = rec(Z, Z.spawn(pts[0], { minDist: 25 }));
    expect(Math.hypot(r.pos.x, r.pos.z)).toBeGreaterThanOrEqual(25);
  });

  it('turns at a limited rate', () => {
    const { Z, step } = setup();
    const id = Z.spawn([0, 0, 10]);
    const i = 0;
    Z.crowd.yaw[i] = 0;   // facing away from the player at the origin
    step();
    expect(Math.abs(Z.crowd.yaw[i])).toBeLessThanOrEqual(AI.turnRate * DT + 1e-9);
    expect(rec(Z, id)).toBeTruthy();
  });

  it('moves the root at exactly the animator rootSpeed along its facing', () => {
    const { Z, step, G } = setup();
    Z.spawn([0, 0, 20]);
    step(120);
    const x0 = Z.crowd.x[0], z0 = Z.crowd.z[0], yaw = Z.crowd.yaw[0];
    G.time.t += DT; Z.update(DT);
    const moved = Math.hypot(Z.crowd.x[0] - x0, Z.crowd.z[0] - z0);
    expect(moved).toBeCloseTo(Z.crowd.root[0] * DT, 9);
    expect(Math.atan2(Z.crowd.x[0] - x0, Z.crowd.z[0] - z0)).toBeCloseTo(yaw, 6);
  });
});

describe('crowd separation', () => {
  it('no two zombies end a frame closer than 0.5 m', () => {
    const { Z, step } = setup();
    // a ring, plus three on the same spot
    for (let k = 0; k < 12; k++) Z.spawn([Math.sin(k) * 9, 0, Math.cos(k) * 9]);
    for (let k = 0; k < 3; k++) Z.spawn([6, 0, 6]);
    let worst = Infinity;
    for (let f = 0; f < 60 * 20; f++) {
      step();
      for (let a = 0; a < Z.list.length; a++) for (let b = a + 1; b < Z.list.length; b++) {
        worst = Math.min(worst, Math.hypot(Z.list[a].pos.x - Z.list[b].pos.x, Z.list[a].pos.z - Z.list[b].pos.z));
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0.5);
  });

  it('never pushes a zombie into a collider', () => {
    // a wall between the zombie and the player; no nav, so it walks straight into it
    const wall = { min: [-3, 0, 4], max: [3, 2, 4.4], surface: 'concrete' };
    const { Z, step } = setup({ colliders: [wall] });
    for (let k = 0; k < 5; k++) Z.spawn([(k - 2) * 0.3, 0, 8]);
    for (let f = 0; f < 600; f++) {
      step();
      for (const r of Z.list) {
        const cx = Math.min(Math.max(r.pos.x, -3), 3), cz = Math.min(Math.max(r.pos.z, 4), 4.4);
        expect(Math.hypot(r.pos.x - cx, r.pos.z - cz)).toBeGreaterThanOrEqual(AI.radius - 1e-3);
      }
    }
  });
});

describe('attack', () => {
  it('lands 34 after the 0.5 s wind-up when the player is still in reach', () => {
    const { Z, G, log, step } = setup();
    const id = Z.spawn([0, 0, 3]);
    let attackT = null;
    for (let f = 0; f < 600 && attackT === null; f++) { step(); if (log.some(([n]) => n === 'zombie:attack')) attackT = G.time.t; }
    expect(attackT).not.toBeNull();
    expect(log.find(([n]) => n === 'zombie:attack')[1].id).toBe(id);
    step(Math.floor(0.45 / DT));
    expect(G.player.damage).not.toHaveBeenCalled();
    step(Math.ceil(0.1 / DT));
    expect(G.player.damage).toHaveBeenCalledTimes(1);
    const [amount, dir] = G.player.damage.mock.calls[0];
    expect(amount).toBe(34);
    // the vector from the player toward the attacker
    const r = rec(Z, id);
    expect(dir[0] * r.pos.x + dir[2] * r.pos.z).toBeGreaterThan(0);
    expect(Math.hypot(dir[0], dir[2])).toBeCloseTo(1, 6);
  });

  it('reaches a player up to an arm above it on open ground; up to 2 m only on something it stands beside', () => {
    expect(AI.maxDy).toBeGreaterThanOrEqual(1.9);
    expect(AI.armDy).toBeCloseTo(0.9, 6);
    for (const [y, hits] of [[0.85, true], [1.45, false]]) {
      const { Z, G, step } = setup({ player: [0, y, 0] });
      Z.spawn([0, 0, 0.9]);
      step(Math.ceil(3 / DT));
      expect(G.player.damage.mock.calls.length > 0).toBe(hits);
    }
    // standing on a 1.45 m dumpster the zombie is beside: reached; on a 2.6 m one: not
    for (const [y, hits] of [[1.45, true], [2.6, false]]) {
      const { Z, G, step } = setup({ player: [0, y, 0], colliders: [{ min: [-0.6, 0, -0.6], max: [0.6, y, 0.45] }] });
      Z.spawn([0, 0, 0.9], { exact: true });
      step(Math.ceil(3 / DT));
      expect(G.player.damage.mock.calls.length > 0).toBe(hits);
    }
  });

  it('misses when the player steps out of reach during the wind-up', () => {
    const { Z, G, log, step } = setup();
    Z.spawn([0, 0, 3]);
    G.events.on('zombie:attack', () => { G.player.pos[2] = -2.5; });
    for (let f = 0; f < 600 && !log.some(([n]) => n === 'zombie:attack'); f++) step();
    step(Math.ceil(0.6 / DT));
    expect(G.player.damage).not.toHaveBeenCalled();
  });

  it('waits the 1.2 s cooldown between attacks', () => {
    const { Z, G, step } = setup();
    Z.spawn([0, 0, 2]);
    const hits = [];
    G.player.damage = vi.fn(() => { hits.push(G.time.t); return true; });
    step(60 * 8);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (let k = 1; k < hits.length; k++) expect(hits[k] - hits[k - 1]).toBeGreaterThanOrEqual(tuning.walker.windup + tuning.walker.cooldown - 1e-6);
  });

  it('does nothing while the game is paused', () => {
    const { Z, G, step } = setup();
    Z.spawn([0, 0, 6]);
    step(30);
    const x = Z.list[0].pos.x, z = Z.list[0].pos.z;
    G.game.state = 'paused';
    step(120);
    expect(Z.list[0].pos.x).toBe(x);
    expect(Z.list[0].pos.z).toBe(z);
  });
});

describe('damage and death', () => {
  it('head damage is x3', () => {
    const { Z } = setup();
    const a = Z.spawn([0, 0, 9], { health: 150 });
    const b = Z.spawn([5, 0, 9], { health: 150 });
    expect(Z.damage(a, 40, 'head', [0, 0, 1])).toMatchObject({ killed: false, damage: 120, headshot: true });
    expect(rec(Z, a).health).toBe(30);
    expect(Z.damage(b, 40, 'torso', [0, 0, 1])).toMatchObject({ killed: false, damage: 40 });
    expect(rec(Z, b).health).toBe(110);
  });

  it('default health follows the round', () => {
    const { Z } = setup();
    expect(rec(Z, Z.spawn([0, 0, 9], { round: 3 })).health).toBe(350);
  });

  it('emits zombie:die while the zombie is still listed, then removes it', () => {
    const { Z, G, log } = setup();
    const id = Z.spawn([0, 0, 9], { health: 100 });
    let listedAtDie = null;
    G.events.on('zombie:die', (p) => { listedAtDie = Z.list.some((r) => r.id === p.id); });
    expect(Z.damage(id, 40, 'head', [0, 0, 1]).killed).toBe(true);
    expect(listedAtDie).toBe(true);
    const die = log.find(([n]) => n === 'zombie:die')[1];
    expect(die).toMatchObject({ id, headshot: true });
    expect(die.pos.length).toBe(3);
    expect(Z.list.some((r) => r.id === id)).toBe(false);
    expect(Z.alive).toBe(0);
    expect(Z.corpses).toBe(1);
    expect(log.some(([n]) => n === 'zombie:remove')).toBe(false);
    // damage to a dead id is ignored
    expect(Z.damage(id, 40, 'torso').killed).toBe(false);
  });

  it('raycast returns the nearest zombie hit with id and part', () => {
    const { Z, step } = setup();
    const near = Z.spawn([0, 0, 6]);
    Z.spawn([0, 0, 9]);
    step();
    const h = Z.raycast([0, 1.6, 0], [0, 0, 1], 60);
    expect(h).toMatchObject({ id: near, part: 'head' });
    expect(h.dist).toBeGreaterThan(5);
    expect(h.dist).toBeLessThan(6.5);
    expect(Z.raycast([0, 1.6, 0], [1, 0, 0], 60)).toBeNull();
    expect(Z.raycast([0, 1.0, 0], [0, 0, 1], 3)).toBeNull();
  });
});

describe('stuck guard', () => {
  it('respawns a zombie that has not got closer in 6 s at a spawn point, same id, no remove', () => {
    // boxed in on all sides
    const box = (x0, z0, x1, z1) => ({ min: [x0, 0, z0], max: [x1, 2, z1] });
    const colliders = [box(-1, 9, 1, 9.3), box(-1, 10.7, 1, 11), box(-1.3, 9, -1, 11), box(1, 9, 1.3, 11)];
    const sp = { pos: [30, 0, -30], kind: 'treeline' };
    const { Z, G, log, step } = setup({ colliders, spawnPoints: [sp] });
    const id = Z.spawn([0, 0, 10], { exact: true });
    step(Math.floor(5.5 / DT));
    expect(dist(rec(Z, id), [0, 0, 10])).toBeLessThan(1);
    step(Math.ceil(1 / DT));
    const r = rec(Z, id);
    expect(r).toBeTruthy();
    expect(Z.stats.stuck).toBe(1);
    expect(dist(r, [30, 0, -30])).toBeLessThan(2);
    expect(log.some(([n]) => n === 'zombie:remove')).toBe(false);
    expect(G.zombies.alive).toBe(1);
  });

  it('a zombie following a player who walks away is not stuck', () => {
    const { Z, G, step } = setup({ spawnPoints: [{ pos: [40, 0, 40], kind: 'treeline' }] });
    Z.spawn([0, 0, 6], { exact: true });
    for (let f = 0; f < 60 * 15; f++) { G.player.pos[2] -= 1.8 * DT; step(); }
    expect(Z.stats.stuck).toBe(0);
  });
});

describe('spawning', () => {
  it('pool reuses meshes: 24 spawned, killed, spawned again builds nothing new', () => {
    const { Z, sb, step } = setup();
    const built = sb.made.length;
    expect(built).toBe(tuning.round.maxAlive + 12);
    for (let round = 0; round < 3; round++) {
      const ids = [];
      for (let k = 0; k < 24; k++) ids.push(Z.spawn([Math.sin(k) * 12, 0, Math.cos(k) * 12]));
      expect(ids.every((id) => id !== null)).toBe(true);
      expect(Z.spawn([0, 0, 12])).toBeNull();   // live cap
      expect(Z.alive).toBe(24);
      step(5);
      for (const id of ids) expect(Z.damage(id, 1e6, 'torso', [0, 0, -1]).killed).toBe(true);
      expect(Z.corpses).toBe(12);
      step(10);
    }
    expect(sb.made.length).toBe(built);
    // every visible body is a live zombie or a corpse
    expect(sb.made.filter((z) => z.mesh.visible).length).toBeLessThanOrEqual(24 + 12);
  });

  it('substitutes a spawn point out of view and away from the player', () => {
    const near = { pos: [3, 0, 0], kind: 'treeline' };
    const ahead = { pos: [0, 0, -20], kind: 'treeline' };
    const behind = { pos: [0, 0, 20], kind: 'treeline' };
    const view = { x: 0, z: 0, fx: 0, fz: -1, cosHalf: Math.cos(1) };
    expect(inView(view, 0, -20)).toBe(true);
    expect(inView(view, 0, 20)).toBe(false);
    const rng = createRng(3);
    expect(pickSpawn([near, ahead, behind], near, 0, 0, view, rng)).toBe(behind);
    expect(pickSpawn([near, ahead, behind], ahead, 0, 0, view, rng)).toBe(behind);
    expect(pickSpawn([near, ahead, behind], behind, 0, 0, view, rng)).toBe(behind);
    // nothing qualifies: the farthest out of view
    expect(pickSpawn([near, ahead], ahead, 0, 0, view, rng)).toBe(near);
    // no level points: the candidate as given
    expect(pickSpawn([], [5, 0, 5], 0, 0, view, rng)).toEqual([5, 0, 5]);
  });

  it('fence spawns walk to the fence, climb, then chase', () => {
    const fence = { min: [22.25, 0, -10], max: [22.35, 1.65, 10] };
    const sp = { pos: [23.7, 0, 1.5], kind: 'fence', top: 1.65, to: [21.2, 0, 1.5] };
    const { Z, G, step } = setup({ colliders: [fence], spawnPoints: [sp], player: [0, 0, 1.5] });
    G.level.raycast = (o, d) => (d[0] < 0 ? { dist: o[0] - 22.35, pos: [22.35, o[1], o[2]], normal: [1, 0, 0] } : null);
    const id = Z.spawn(sp);
    const seen = new Set();
    let climbedAt = null;
    for (let f = 0; f < 60 * 10; f++) {
      step();
      seen.add(rec(Z, id).state);
      if (rec(Z, id).state === 'climb' && climbedAt === null) climbedAt = rec(Z, id).pos.x;
    }
    expect(seen.has('climb')).toBe(true);
    expect(climbedAt).toBeGreaterThan(22.35 + 0.2);
    expect(climbedAt).toBeLessThan(22.35 + 0.5);
    expect(rec(Z, id).state).toBe('walk');
    expect(rec(Z, id).pos.x).toBeLessThan(21);
  });

  it('spawn=<n> stages zombies in front of the shot camera', () => {
    const { G, log } = makeG();
    G.params = { spawn: 3, shot: 'zombies-near' };
    G.level.shots = { 'zombies-near': { cam: [-2.2, 1.7, -3.5, -1.5708, -0.3], fov: 70 } };
    G.shotCam = { cam: G.level.shots['zombies-near'].cam };
    G.level.spawnPoints = [{ pos: [30, 0, 30], kind: 'treeline' }];
    const sb = stubBuilder();
    const Z = createZombies(G, { build: sb.build, animate: () => createGhostAnimator() });
    Z.update(DT);
    expect(Z.alive).toBe(3);
    for (const r of Z.list) {
      // the camera looks along +x
      expect(r.pos.x - -2.2).toBeGreaterThan(2);
      expect(r.pos.x - -2.2).toBeLessThan(5);
      expect(Math.abs(r.pos.z - -3.5)).toBeLessThan(1.6);
    }
    expect(log.filter(([n]) => n === 'zombie:spawn').length).toBe(3);
  });

  it('clear() removes everything including corpses, without events', () => {
    const { Z, log } = setup();
    const a = Z.spawn([0, 0, 9]);
    Z.spawn([3, 0, 9]);
    Z.damage(a, 1e6, 'torso');
    const before = log.length;
    Z.clear();
    expect(Z.alive).toBe(0);
    expect(Z.list.length).toBe(0);
    expect(Z.corpses).toBe(0);
    expect(log.length).toBe(before);
  });

  it('runs with the stub level and no bodies', () => {
    const { G } = makeG();
    G.level = { stub: true, colliders: [], spawnPoints: [], raycast: () => null };
    G.nav = { stub: true };
    const Z = createZombies(G, { build: () => { throw new Error('no mats'); }, animate: () => createGhostAnimator() });
    const id = Z.spawn([0, 0, 8]);
    expect(id).not.toBeNull();
    for (let f = 0; f < 120; f++) { G.time.t += DT; Z.update(DT); }
    expect(Z.list[0].pos.z).toBeLessThan(8);
    expect(Z.raycast([0, 1, 0], [0, 0, 1], 60)).toBeNull();
  });
});

describe('flow field and unreachable player', () => {
  it('follows G.nav.field.dir and gathers when the player cannot be reached', () => {
    const { Z, G, step } = setup();
    // a field whose target is (0,5) (the closest reachable point to a player at (0,0))
    const T = [0, 5];
    G.nav = {
      field: {
        dir(x, z) { const dx = T[0] - x, dz = T[1] - z, l = Math.hypot(dx, dz); return l < 0.05 ? [0, 0] : [dx / l, dz / l]; },
        dist(x, z) { return Math.hypot(T[0] - x, T[1] - z); },
      },
    };
    const id = Z.spawn([0, 0, 15], { exact: true });
    step(60 * 15);
    const r = rec(Z, id);
    expect(Math.hypot(r.pos.x - T[0], r.pos.z - T[1])).toBeLessThan(0.5);
    expect(Z.stats.stuck).toBe(0);
  });
});

describe('player out of every path', () => {
  it('a crowd gathers where the field ends (dist Infinity for all) with no stuck respawn and no relocation', () => {
    const { Z, G, step } = setup({ spawnPoints: [{ pos: [30, 0, 30], kind: 'treeline', zone: 'forecourt' }] });
    const T = [0, 20]; // where the cut-off part of the map ends, nearest the player at the origin
    const out = [0, 0];
    G.nav = { field: {
      dir(x, z) { const dx = T[0] - x, dz = T[1] - z, l = Math.hypot(dx, dz); out[0] = l < 0.05 ? 0 : dx / l; out[1] = l < 0.05 ? 0 : dz / l; return [out[0], out[1]]; },
      dist: () => Infinity,
    } };
    G.level.zoneAt = () => 'forecourt';
    for (let k = 0; k < 10; k++) Z.spawn([Math.sin(k) * 10, 0, 20 + Math.cos(k) * 10], { exact: true });
    step(60 * 40);
    expect(Z.stats.stuck).toBe(0);
    expect(Z.stats.relocated).toBe(0);
    for (const r of Z.list) expect(Math.hypot(r.pos.x - T[0], r.pos.z - T[1])).toBeLessThan(3);
  });
});

describe('pure crowd', () => {
  it('pushes a dense cluster of 24 apart within three frames', () => {
    const c = createCrowd(24);
    for (let k = 0; k < 24; k++) addAgent(c, (k % 6) * 0.1, Math.floor(k / 6) * 0.1, 0, 1.3, 0);
    const env = { t: 0, px: 0, py: 0, pz: -10, pAlive: true, field: null, tune: tuning.walker, obstacles: createObstacles([]),
      hooks: { attackStart() {}, attackEnd() {}, climb() {}, stuck() {} } };
    for (let f = 0; f < 3; f++) {
      env.t += DT;
      crowdThink(c, DT, env);
      for (let i = 0; i < 24; i++) c.root[i] = c.want[i];
      crowdMove(c, DT, env);
    }
    for (let a = 0; a < 24; a++) for (let b = a + 1; b < 24; b++) {
      expect(Math.hypot(c.x[a] - c.x[b], c.z[a] - c.z[b])).toBeGreaterThanOrEqual(AI.minSep);
    }
    expect(c.state.every((s) => s === CHASE)).toBe(true);
  });

  it('24 zombies cost under 0.6 ms per frame (think + move, flow field and colliders)', () => {
    const c = createCrowd(24);
    for (let k = 0; k < 24; k++) addAgent(c, Math.sin(k) * 15, Math.cos(k) * 15, 0, 1.3, 0);
    const cols = [];
    for (let k = 0; k < 60; k++) cols.push({ min: [(k % 10) * 4 - 20, 0, Math.floor(k / 10) * 6 - 18], max: [(k % 10) * 4 - 19, 2, Math.floor(k / 10) * 6 - 17] });
    const out = [0, 0];
    const field = { dir(x, z) { const l = Math.hypot(x, z) || 1; out[0] = -x / l; out[1] = -z / l; return out; }, dist: (x, z) => Math.hypot(x, z) };
    const env = { t: 0, px: 0, py: 0, pz: 0, pAlive: true, field, tune: tuning.walker, obstacles: createObstacles(cols),
      hooks: { attackStart() {}, attackEnd() {}, climb() {}, stuck() {} } };
    const run = (n) => { for (let f = 0; f < n; f++) { env.t += DT; crowdThink(c, DT, env); for (let i = 0; i < 24; i++) c.root[i] = c.want[i]; crowdMove(c, DT, env); } };
    run(600);   // warm up
    const t0 = performance.now();
    run(1200);
    const ms = (performance.now() - t0) / 1200;
    expect(ms).toBeLessThan(0.6);
  });
});

describe('ghost animator', () => {
  it('ramps toward the asked speed and finishes an attack at 1.55 s', () => {
    const a = createGhostAnimator();
    a.set('walk');
    for (let k = 0; k < 120; k++) a.update(DT, 1.4);
    expect(a.rootSpeed).toBeCloseTo(1.4, 6);
    a.set('attack');
    expect(a.done).toBe(false);
    for (let k = 0; k < 94; k++) a.update(DT, 0);
    expect(a.done).toBe(true);
    expect(a.state).toBe('idle');
  });
});

describe('crowd spacing and raycasts', () => {
  const hooks = { attackStart() {}, attackEnd() {}, climb() {}, stuck() {} };
  const one = (x, state) => {
    const c = createCrowd(4);
    addAgent(c, x, 0, -Math.PI / 2, 1.3, 0);
    if (state) c.state[0] = state;
    return c;
  };
  const env = { px: 0, pz: 0, obstacles: null };

  it('the player gap gives way no faster than 1.5 m/s', () => {
    const c = one(0.4);
    let x0 = c.x[0];
    for (let f = 0; f < 8; f++) {   // 0.2 m to give at 0.025 m a frame
      crowdMove(c, DT, env);
      const moved = Math.abs(c.x[0] - x0);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(AI.playerShove * DT + 1e-9);
      x0 = c.x[0];
    }
    crowdMove(c, DT, env);
    expect(c.x[0]).toBeCloseTo(AI.playerGap, 9);
  });

  it('a zombie winding up or recovering holds its ground', () => {
    for (const st of [WINDUP, RECOVER]) {
      const c = one(0.4, st);
      for (let f = 0; f < 30; f++) crowdMove(c, DT, env);
      expect(c.x[0]).toBe(0.4);
    }
  });

  it('the 0.3 m hard floor always holds', () => {
    for (const st of [CHASE, WINDUP]) {
      const c = one(0.1, st);
      crowdMove(c, DT, env);
      expect(Math.hypot(c.x[0], c.z[0])).toBeGreaterThanOrEqual(AI.playerFloor - 1e-9);
      expect(Math.hypot(c.x[0], c.z[0])).toBeLessThanOrEqual(AI.playerFloor + AI.playerShove * DT + 1e-9);
    }
  });

  it('a player teleported 0.4 m from a walking zombie moves it no faster than the cap', () => {
    const { Z, G, step } = setup();
    const id = Z.spawn([0, 0, 10]);
    step(240);   // walking at full speed toward the player at the origin
    const r = rec(Z, id);
    expect(r.state).toBe('walk');
    // put the player 0.4 m straight ahead of it
    const yaw = Z.crowd.yaw[0];
    G.player.pos[0] = r.pos.x + Math.sin(yaw) * 0.4; G.player.pos[2] = r.pos.z + Math.cos(yaw) * 0.4;
    for (let f = 0; f < 20; f++) {
      const x0 = r.pos.x, z0 = r.pos.z;
      step();
      const moved = Math.hypot(r.pos.x - x0, r.pos.z - z0);
      expect(moved).toBeLessThanOrEqual((Z.crowd.root[0] + AI.playerShove) * DT + 1e-9);
    }
  });

  it('dead zombies and corpses are not returned by raycast', () => {
    const { Z, step } = setup();
    const near = Z.spawn([0, 0, 6]);
    const far = Z.spawn([0, 0, 9]);
    step();
    expect(Z.raycast([0, 1, 0], [0, 0, 1], 60).id).toBe(near);
    Z.damage(near, 1e6, 'torso', [0, 0, 1]);
    expect(Z.raycast([0, 1, 0], [0, 0, 1], 60).id).toBe(far);
    Z.damage(far, 1e6, 'torso', [0, 0, 1]);
    step(30);
    expect(Z.corpses).toBe(2);
    expect(Z.raycast([0, 1, 0], [0, 0, 1], 60)).toBeNull();
  });

  it('clear() during a wind-up leaves no attack to land', () => {
    const { Z, G, log, step } = setup();
    Z.spawn([0, 0, 2]);
    for (let f = 0; f < 600 && !log.some(([n]) => n === 'zombie:attack'); f++) step();
    expect(Z.crowd.state[0]).toBe(WINDUP);
    Z.clear();
    const n = log.length;
    step(180);
    expect(G.player.damage).not.toHaveBeenCalled();
    expect(log.length).toBe(n);
    expect(Z.alive).toBe(0);
  });

  it('clear() during a climb leaves nothing running, and the slot starts fresh', () => {
    const sp = { pos: [23.7, 0, 1.5], kind: 'fence', top: 1.65, to: [21.2, 0, 1.5] };
    const { Z, G, log, step } = setup({ spawnPoints: [sp], player: [0, 0, 1.5] });
    G.level.raycast = (o, d) => (d[0] < 0 ? { dist: o[0] - 22.35 } : null);
    const id = Z.spawn(sp);
    for (let f = 0; f < 600 && rec(Z, id).state !== 'climb'; f++) step();
    expect(rec(Z, id).state).toBe('climb');
    Z.clear();
    const n = log.length;
    step(240);
    expect(log.length).toBe(n);
    expect(Z.crowd.count).toBe(0);
    const id2 = Z.spawn([0, 0, 9], { exact: true });
    step();
    expect(rec(Z, id2).state).toBe('walk');
    expect(rec(Z, id2).pos.z).toBeLessThan(9);
  });

  it('a stuck respawn keeps the same record in list and emits no zombie:remove', () => {
    const box = (x0, z0, x1, z1) => ({ min: [x0, 0, z0], max: [x1, 2, z1] });
    const colliders = [box(-1, 9, 1, 9.3), box(-1, 10.7, 1, 11), box(-1.3, 9, -1, 11), box(1, 9, 1.3, 11)];
    const { Z, log, step } = setup({ colliders, spawnPoints: [{ pos: [30, 0, -30], kind: 'treeline' }] });
    const id = Z.spawn([0, 0, 10], { exact: true });
    const r = rec(Z, id);
    step(Math.ceil(6.6 / DT));
    expect(Z.stats.stuck).toBe(1);
    expect(Z.list.length).toBe(1);
    expect(Z.list[0]).toBe(r);
    expect(r.id).toBe(id);
    expect(r.alive).toBe(true);
    expect(log.filter(([n]) => n === 'zombie:remove').length).toBe(0);
    expect(log.filter(([n]) => n === 'zombie:spawn').length).toBe(1);
  });

  it("puts live zombies into idle when the game is 'dead' or 'title'", () => {
    for (const gs of ['dead', 'title']) {
      const { G, Z, step } = makeAnims();
      Z.spawn([0, 0, 9]);
      step(60);
      expect(Z.anims[0].state).toBe('walk');
      G.game.state = gs;
      step(2);
      expect(Z.anims[0].state).toBe('idle');
      const x = Z.list[0].pos.x, z = Z.list[0].pos.z;
      step(60);
      expect([Z.list[0].pos.x, Z.list[0].pos.z]).toEqual([x, z]);
      G.game.state = 'playing';
      step(2);
      expect(Z.anims[0].state).toBe('walk');
    }
  });

  it('queries the flow field a few dozen times a second for 24 zombies, or uses dirInto', () => {
    const { Z, G, step } = setup();
    let dirCalls = 0, intoCalls = 0;
    const field = {
      dir(x, z) { dirCalls++; const l = Math.hypot(x, z) || 1; return [-x / l, -z / l]; },
      dist: (x, z) => Math.hypot(x, z),
    };
    G.nav = { field };
    for (let k = 0; k < 24; k++) Z.spawn([Math.sin(k * 0.26) * 20, 0, Math.cos(k * 0.26) * 20]);
    step(120);
    dirCalls = 0;
    step(180);   // 3 s
    expect(dirCalls / 3).toBeLessThan(70);
    expect(dirCalls).toBeGreaterThan(0);
    field.dirInto = (x, z, out) => { intoCalls++; const l = Math.hypot(x, z) || 1; out[0] = -x / l; out[1] = -z / l; return out; };
    dirCalls = 0;
    step(60);
    expect(dirCalls).toBe(0);
    expect(intoCalls).toBeGreaterThan(0);
  });
});

// setup() variant that keeps the animators so tests can read their state
function makeAnims() {
  const { G } = makeG();
  const sb = stubBuilder();
  const anims = [];
  const Z = createZombies(G, { build: sb.build, animate: () => { const a = createGhostAnimator(); anims.push(a); return a; } });
  G.zombies = Z;
  // the latest animator for the first zombie
  Object.defineProperty(Z, 'anims', { get: () => [anims[anims.length - 1]] });
  const step = (n = 1) => { for (let k = 0; k < n; k++) { G.time.t += DT; Z.update(DT); } };
  return { G, Z, step };
}


// A camera for view(): at (x, z) looking along (fx, fz) on the ground (70 deg, 16:9).
function camera(x, z, fx, fz) {
  const e = new Array(16).fill(0);
  e[8] = -fx; e[10] = -fz; e[12] = x; e[14] = z;
  return { fov: 70, aspect: 16 / 9, position: { x, y: 1.7, z }, matrixWorld: { elements: e } };
}

// The ghost animator, except that a climb (fence or window) never ends: it stays in 'climb' or
// 'window', not done, with no root motion (an animation clip that does not finish in idle).
function frozenClimb() {
  const g = createGhostAnimator();
  let frozen = null;
  return {
    states: ['idle', 'walk', 'attack', 'stagger', 'climb', 'dead', 'window'],
    get rootSpeed() { return frozen ? 0 : g.rootSpeed; },
    get done() { return frozen ? false : g.done; },
    get state() { return frozen || g.state; },
    get settled() { return g.settled; },
    set(n, o) { if (n === 'climb' || n === 'window') { frozen = n; return; } frozen = null; g.set(n, o); },
    setTarget() {}, hitReact() {},
    collapse(d, i) { frozen = null; g.collapse(d, i); },
    update(dt, sp, cd) { if (!frozen) g.update(dt, sp, cd); },
  };
}

describe('stuck climbs', () => {
  it('a climb the animator never ends is left after 5 s, on the far side of the fence', () => {
    const fence = { min: [22.25, 0, -10], max: [22.35, 1.65, 10] };
    const sp = { pos: [23.7, 0, 1.5], kind: 'fence', top: 1.65, to: [21.2, 0, 1.5] };
    const { G } = makeG({ colliders: [fence], spawnPoints: [sp], player: [0, 0, 1.5] });
    G.level.raycast = (o, d) => (d[0] < 0 ? { dist: o[0] - 22.35, pos: [22.35, o[1], o[2]], normal: [1, 0, 0] } : null);
    const anims = [];
    const Z = createZombies(G, { build: stubBuilder().build, animate: () => { const a = frozenClimb(); anims.push(a); return a; } });
    G.zombies = Z;
    const id = Z.spawn(sp, { exact: true });
    const i = 0;
    let tClimb = null, tOut = null;
    for (let f = 0; f < 60 * 12 && tOut === null; f++) {
      G.time.t += DT; Z.update(DT);
      if (tClimb === null && Z.crowd.state[i] === CLIMB) tClimb = G.time.t;
      if (tClimb !== null && Z.crowd.state[i] !== CLIMB) tOut = G.time.t;
    }
    expect(tClimb).not.toBeNull();
    expect(tOut - tClimb).toBeLessThanOrEqual(5 + 2 * DT);
    expect(tOut - tClimb).toBeGreaterThan(4.9);
    const r = rec(Z, id);
    expect(r.pos.x).toBeLessThan(22.25 - AI.radius); // over the fence
    expect(anims[anims.length - 1].state).toBe('walk'); // the animator was put back in its gait
    G.time.t += DT; Z.update(DT);
    const before = dist(rec(Z, id), [0, 0, 1.5]);
    for (let f = 0; f < 60 * 6; f++) { G.time.t += DT; Z.update(DT); }
    expect(before - dist(rec(Z, id), [0, 0, 1.5])).toBeGreaterThan(4); // chasing
  });

  it('a walking zombie climbing in never comes within the player gap', () => {
    const fence = { min: [22.25, 0, -10], max: [22.35, 1.65, 10] };
    const sp = { pos: [23.7, 0, 1.5], kind: 'fence', top: 1.65, to: [21.2, 0, 1.5] };
    const { G, Z, step } = setup({ colliders: [fence], spawnPoints: [sp], player: [21.6, 0, 1.5] });
    G.level.raycast = (o, d) => (d[0] < 0 ? { dist: o[0] - 22.35, pos: [22.35, o[1], o[2]], normal: [1, 0, 0] } : null);
    Z.spawn(sp, { exact: true });
    let climbed = false, closest = Infinity;
    for (let f = 0; f < 60 * 6; f++) {
      step();
      if (Z.crowd.state[0] === CLIMB) { climbed = true; closest = Math.min(closest, Math.hypot(Z.crowd.x[0] - 21.6, Z.crowd.z[0] - 1.5)); }
    }
    expect(climbed).toBe(true);
    expect(closest).toBeGreaterThanOrEqual(AI.playerGap - 1e-6);
  });

  it('the far-mesh distance is the tier\'s zombieLodFar (12 m without one), read again when it changes', () => {
    const { G } = makeG();
    const lods = [];
    const sb = stubBuilder();
    const Z = createZombies(G, { build: (seed) => { const z = sb.build(seed); z.setLod = (v) => { z.lod = v; }; lods.push(z); return z; }, animate: () => createGhostAnimator() });
    G.zombies = Z;
    G.camera = camera(0, 0, 0, -1);
    G.player.pos = [0, 0, 30]; // far: the zombie stands still at 10 m from the camera
    Z.spawn([0, 0, -10], { exact: true });
    const body = () => lods.find((z) => z.mesh.visible);
    const step = () => { G.time.t += DT; Z.update(DT); };
    step();
    expect(body().lod).toBe(0); // 10 m < 12
    G.quality = { zombieLodFar: 7 };
    step();
    expect(body().lod).toBe(1);
    G.quality.zombieLodFar = 12; // a tier change
    step();
    expect(body().lod).toBe(0);
  });

  it('a stuck respawn waits (retrying each second) while every spawn point is in view', () => {
    const box = (x0, z0, x1, z1) => ({ min: [x0, 0, z0], max: [x1, 2, z1] });
    const colliders = [box(-1, 9, 1, 9.3), box(-1, 10.7, 1, 11), box(-1.3, 9, -1, 11), box(1, 9, 1.3, 11)];
    const sp = { pos: [0, 0, -30], kind: 'treeline' };
    const { Z, G, step } = setup({ colliders, spawnPoints: [sp] });
    G.camera = camera(0, 0, 0, -1); // looking at the only spawn point
    const id = Z.spawn([0, 0, 10], { exact: true });
    step(Math.ceil(6.5 / DT));
    expect(Z.stats.stuck).toBe(1);
    step(Math.ceil(10 / DT));
    expect(Z.stats.stuck).toBe(1); // counted once while it waits
    expect(dist(rec(Z, id), [0, 0, 10])).toBeLessThan(1); // still in its box, not popped in view
    G.camera = camera(0, 0, 0, 1); // the player turns round
    step(Math.ceil(1.1 / DT));
    expect(dist(rec(Z, id), [0, 0, -30])).toBeLessThan(2);
  });

  it('pickHidden never returns a point in view', () => {
    const view = { x: 0, z: 0, fx: 0, fz: -1, cosHalf: Math.cos(1) };
    const ahead = { pos: [0, 0, -20] }, behind = { pos: [0, 0, 20] }, close = { pos: [0, 0, 3] }, far = { pos: [0, 0, 40] };
    const rng = createRng(1);
    expect(pickHidden([ahead], 0, 0, view, rng)).toBeNull();
    expect(pickHidden([ahead, behind], 0, 0, view, rng)).toBe(behind);
    expect(pickHidden([ahead, close], 0, 0, view, rng)).toBe(close); // the farthest out of view
    expect(pickHidden([ahead, behind, far], 0, 0, view, rng, 8, 30)).toBe(behind); // nearer than 30: the nearest
    expect(pickHidden([ahead, far], 0, 0, view, rng, 8, 30)).toBeNull();
  });

  describe('stragglers', () => {
    function stragglerSetup(n, { spawnPoints = [], at = null } = {}) {
      const ctx = setup({ spawnPoints });
      const { G, Z } = ctx;
      G.game.director = { phase: 'active', spawned: 30, total: 30 };
      const seen = [];
      G.events.on('round:straggler', (p) => seen.push([G.time.t, p]));
      const pts = at || [[200, 0, 0], [0, 0, 200], [-200, 0, 0], [0, 0, -200]];
      const ids = [];
      for (let k = 0; k < n; k++) ids.push(Z.spawn(pts[k], { exact: true }));
      return { ...ctx, seen, ids };
    }

    it('with everything spawned and 3 left for 30 s: round:straggler for each, every 10 s, and 1.5x speed', () => {
      const { Z, G, step, seen, ids } = stragglerSetup(3);
      step(Math.round(29 / DT));
      expect(seen.length).toBe(0);
      for (let k = 0; k < 3; k++) expect(Z.crowd.speed[k]).toBe(rec(Z, ids[k]).speed);
      step(Math.round(1.2 / DT));
      expect(seen.length).toBe(3);
      expect(new Set(seen.map(([, p]) => p.id))).toEqual(new Set(ids));
      for (const [t, p] of seen) {
        const r = rec(Z, p.id);
        // where it stood then (it has walked on at 1.5x since)
        expect(Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z)).toBeLessThan((G.time.t - t + DT) * r.speed * 1.5 + 0.05);
        expect(p.pos.y).toBe(r.pos.y);
      }
      for (let k = 0; k < 3; k++) expect(Z.crowd.speed[k]).toBeCloseTo(rec(Z, ids[k]).speed * 1.5, 12);
      step(Math.round(10 / DT));
      expect(seen.length).toBe(6);
      expect(seen[5][0] - seen[2][0]).toBeCloseTo(10, 1);
      // a new wave of spawns (or more than 3 left) ends it
      G.game.director.spawned = 29;
      step(2);
      for (let k = 0; k < 3; k++) expect(Z.crowd.speed[k]).toBe(rec(Z, ids[k]).speed);
      step(Math.round(20 / DT));
      expect(seen.length).toBe(6);
    });

    it('not while more than 3 are left or the round is still spawning', () => {
      const a = stragglerSetup(4);
      a.step(Math.round(40 / DT));
      expect(a.seen.length).toBe(0);
      const b = stragglerSetup(2);
      b.G.game.director.spawned = 10;
      b.step(Math.round(40 / DT));
      expect(b.seen.length).toBe(0);
    });

    it('a crawler left for 60 s is moved to a spawn point out of view and nearer the player; never one in view', () => {
      const inViewNear = { pos: [0, 0, -20], kind: 'treeline', zone: 'z' };
      const hiddenNear = { pos: [30, 0, 20], kind: 'treeline', zone: 'z' };
      const hiddenFar = { pos: [0, 0, 300], kind: 'treeline', zone: 'z' };
      const { Z, G, step, seen, ids } = stragglerSetup(1, { spawnPoints: [inViewNear, hiddenNear, hiddenFar], at: [[0, 0, 150]] });
      G.camera = camera(0, 0, 0, -1);
      const r = rec(Z, ids[0]);
      Z.damage(ids[0], r.maxHealth * 0.41, 'legL', [0, 0, -1]);
      expect(r.crawling).toBe(true);
      step(Math.round(59 / DT));
      expect(Z.stats.relocated).toBe(0);
      expect(Z.crowd.speed[0]).toBe(tuning.zombies.crawler.speed); // a crawler does not hurry
      step(Math.round(1.5 / DT));
      expect(Z.stats.relocated).toBe(1);
      expect(dist(r, [30, 0, 20])).toBeLessThan(2);
      expect(seen.some(([t, p]) => p.id === ids[0] && t > 59)).toBe(true);

      // only a point in view nearer the player: it stays where it is
      const b = stragglerSetup(1, { spawnPoints: [inViewNear, hiddenFar], at: [[0, 0, 150]] });
      b.G.camera = camera(0, 0, 0, -1);
      const rb = rec(b.Z, b.ids[0]);
      b.Z.damage(b.ids[0], rb.maxHealth * 0.41, 'legR', [0, 0, -1]);
      b.step(Math.round(75 / DT));
      expect(b.Z.stats.relocated).toBe(0);
      expect(rb.pos.z).toBeGreaterThan(80);
    });
  });
});


// ---- the real map: windows, stairs, the walkway, doors ---------------------------------
// The whole world's colliders (buildWorld, as the perimeter test does), the world state (doors,
// boards, active spawn points), the level's collision for heightAt, and the real two-layer nav.
describe('layered world', () => {
  let built;
  beforeAll(() => {
    const rng = createRng(1).fork('level');
    built = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')) });
  }, 60000);

  function worldSetup({ player = [0, 0, 0], open = [], zone = null, seed = 1 } = {}) {
    for (const c of built.colliders) if (c.door) c.off = false; // doors shut (shared colliders)
    const { G, log } = makeG({ player, seed });
    const breaks = [];
    G.events.on('board:break', (p) => breaks.push([p.id, p.left, G.time.t]));
    let nav = null;
    const state = createWorldState({ colliders: built.colliders, nav: () => nav, emit: (n, p) => G.events.emit(n, p) });
    if (zone) state.setZone(zone);
    const col = createCollision(built.colliders);
    let active = built.colliders.filter((c) => !c.off);
    G.level = {
      get colliders() { return active; },
      bounds: WL.bounds,
      navOptions: { ...WL.navOptions, links: navLinks(state) },
      raycast: col.raycast, heightAt: col.heightAt,
      spawnPoints: state.activeSpawnPoints(), activeSpawnPoints: state.activeSpawnPoints,
      windows: state.windows, tearBoard: state.tearBoard, repairBoard: state.repairBoard, zoneAt: state.zoneAt, doors: state.doors,
    };
    G.events.on('door:open', () => { active = built.colliders.filter((c) => !c.off); });
    G.time.sim = 0;
    nav = createNav(G);
    G.nav = nav;
    for (const id of open) state.openDoor(id);
    state.update(player);
    const sb = stubBuilder();
    const Z = createZombies(G, { build: sb.build, animate: () => createGhostAnimator() });
    G.zombies = Z;
    const step = (n = 1) => { for (let k = 0; k < n; k++) { G.time.t += DT; G.time.sim += DT; nav.update(DT); Z.update(DT); state.update(G.player.pos); } };
    const reshut = () => { state.reset(); active = built.colliders.filter((c) => !c.off); state.update(G.player.pos); };
    return { G, Z, log, step, state, breaks, reshut };
  }
  const point = (id) => WL.spawnPoints.find((s) => s.id === id);

  it('a zombie at a boarded window tears 6 boards in 5.4 s and is inside 2 s after the last', () => {
    const { Z, G, step, breaks } = worldSetup({ player: [13, 0, -25], open: ['d1'] });
    const id = Z.spawn(point('sp-w-d1'), { exact: true });
    const r = rec(Z, id);
    let tTear = null;
    for (let f = 0; f < 60 * 15 && breaks.length < 6; f++) { step(); if (tTear === null && r.state === 'tear') tTear = G.time.t; }
    expect(tTear).not.toBeNull();
    expect(breaks.map((b) => b[1])).toEqual([5, 4, 3, 2, 1, 0]);
    expect(breaks.every((b) => b[0] === 'w-d1')).toBe(true);
    const tLast = breaks[5][2];
    expect(tLast - tTear).toBeGreaterThan(5.4 - 0.3);
    expect(tLast - tTear).toBeLessThan(5.4 + 0.3);
    let tIn = null;
    for (let f = 0; f < 60 * 4 && tIn === null; f++) { step(); if (WL.zoneAt(r.pos.x, r.pos.z) === 'diner') tIn = G.time.t; }
    expect(tIn).not.toBeNull();
    expect(tIn - tLast).toBeLessThan(2);
    expect(Z.stats.stuck).toBe(0);
  });

  it('a zombie left outside a window it can path through takes the window (no stuck respawn)', () => {
    const { Z, G, step, state } = worldSetup({ player: [22, 0, -26], open: ['d1'] });
    while (state.windows.find((w) => w.id === 'w-d4').boards > 0) state.tearBoard('w-d4');
    const id = Z.spawn([23.6, 0, -34.6], { exact: true }); // outside the north wall, in plain chase
    const r = rec(Z, id);
    step(Math.round(12 / DT));
    expect(WL.zoneAt(r.pos.x, r.pos.z)).toBe('diner');
    expect(G.player.damage).toHaveBeenCalled();
    expect(Z.stats.stuck).toBe(0);
  });

  it('repairing a board while it tears adds 0.9 s', () => {
    const { Z, G, step, breaks, state } = worldSetup({ player: [13, 0, -25], open: ['d1'] });
    const id = Z.spawn(point('sp-w-d2'), { exact: true });
    const r = rec(Z, id);
    let tTear = null, repaired = false;
    for (let f = 0; f < 60 * 15 && !(breaks.length && breaks[breaks.length - 1][1] === 0); f++) {
      step();
      if (tTear === null && r.state === 'tear') tTear = G.time.t;
      if (!repaired && breaks.length === 3) { state.repairBoard('w-d2'); repaired = true; }
    }
    expect(breaks.length).toBe(7);
    const span = breaks[6][2] - tTear;
    expect(span).toBeGreaterThan(6.3 - 0.3);
    expect(span).toBeLessThan(6.3 + 0.3);
  });

  it('the stuck guard does not fire for zombies queued at a window; both get in', () => {
    const { Z, G, step } = worldSetup({ player: [13, 0, -25], open: ['d1'] });
    const a = Z.spawn(point('sp-w-d3'), { exact: true });
    const b = Z.spawn(point('sp-w-d3'), { exact: true });
    step(Math.round(24 / DT));
    expect(Z.stats.stuck).toBe(0);
    for (const id of [a, b]) {
      const r = rec(Z, id);
      expect(r).toBeTruthy();
      expect(WL.zoneAt(r.pos.x, r.pos.z)).toBe('diner');
    }
    expect(G.player.damage).toHaveBeenCalled();
  });

  it('a zombie reaches a player on the motel walkway by the stairs, its y following the steps', () => {
    const P = [45, 3.04, -37.2];
    const { Z, G, step } = worldSetup({ player: P, zone: 'motel' });
    const id = Z.spawn([40, 0, -24], { exact: true });
    const r = rec(Z, id);
    const ys = new Set();
    let maxY = 0, bad = 0;
    for (let f = 0; f < 60 * 40 && !G.player.damage.mock.calls.length; f++) {
      step();
      maxY = Math.max(maxY, r.pos.y);
      if (r.pos.y > 0.1 && r.pos.y < 3.0) {
        ys.add(r.pos.y.toFixed(2));
        // on a stair: the height is a whole number of risers
        const k = r.pos.y / WL.stairs[0].rise;
        if (Math.abs(k - Math.round(k)) > 1e-6) bad++;
      }
    }
    expect(G.player.damage).toHaveBeenCalled();
    expect(maxY).toBeCloseTo(3.04, 5);
    expect(r.pos.y).toBeCloseTo(3.04, 5);
    expect(r.layer).toBe(1);
    expect(ys.size).toBeGreaterThanOrEqual(10); // it went up step by step
    expect(bad).toBe(0);
    expect(Z.stats.stuck).toBe(0);
  });

  it('zombies below a player on the walkway do not attack through the floor', () => {
    const P = [45, 3.04, -37.2];
    const { Z, log, step } = worldSetup({ player: P, zone: 'motel' });
    const id = Z.spawn([45.4, 0, -37.0], { exact: true });
    step(Math.round(4 / DT));
    expect(log.filter(([n]) => n === 'zombie:attack').length).toBe(0);
    // and it does not stand under the player: it is on its way to a stair
    expect(Math.hypot(rec(Z, id).pos.x - P[0], rec(Z, id).pos.z - P[2])).toBeGreaterThan(2);
  });

  it('a player upstairs and one in a dead-end room are both reached without stuck respawns', () => {
    // north-wing upper room n4 and ground-floor room n1: zombies from the lot get to both
    for (const P of [[52, 3.04, -41], [41, 0, -41]]) {
      const { Z, G, step } = worldSetup({ player: P, zone: 'motel' });
      for (let k = 0; k < 6; k++) Z.spawn([34 + k * 3, 0, -20 - (k % 2) * 4], { exact: true });
      step(Math.round(45 / DT));
      expect(G.player.damage).toHaveBeenCalled();
      expect(Z.stats.stuck).toBe(0);
    }
  });

  it('a door bought after the nav is built lets the zombies behind it through (no stuck respawns)', () => {
    const { Z, G, step, state } = worldSetup({ player: [-11, 0.1, -18.3] });
    G.nav.field.dist(0, 0, 0); // the grid is built now, with every door shut
    state.openDoor('d1');
    const ids = [[8, 0, -22], [14, 0, -26], [20, 0, -24]].map((p) => Z.spawn(p, { exact: true }));
    step(Math.round(30 / DT));
    for (const id of ids) {
      const r = rec(Z, id);
      expect(r).toBeTruthy();
      expect(Math.hypot(r.pos.x + 11, r.pos.z + 18.3)).toBeLessThan(2);
    }
    expect(Z.stats.stuck).toBe(0);
  });

  it('zombies in a zone that becomes unreachable are moved to an active spawn point', () => {
    const { Z, G, step, reshut, state } = worldSetup({ player: [13, 0, -25], open: ['d1'] });
    const id = Z.spawn([15, 0, -27], { exact: true });
    step(30);
    G.player.pos = [0, 0, 0];
    step(2);
    reshut(); // every door shut again: the diner is cut off from the forecourt
    step(Math.round(2.5 / DT));
    const r = rec(Z, id);
    expect(r).toBeTruthy();
    expect(Z.stats.relocated).toBeGreaterThanOrEqual(1);
    expect(WL.zoneAt(r.pos.x, r.pos.z)).not.toBe('diner');
    expect(state.activeSpawnPoints().every((s) => s.zone === 'forecourt')).toBe(true);
    const near = Math.min(...state.activeSpawnPoints().map((s) => Math.hypot(s.pos[0] - r.pos.x, s.pos[2] - r.pos.z)));
    expect(near).toBeLessThan(5);
  });

  it('a jam of 20 on the narrow east walkway and stairs triggers no stuck respawn', () => {
    const P = [62, 3.04, -28];
    const { Z, G, step } = worldSetup({ player: P, zone: 'motel' });
    const types = ['runner', 'armoured', 'walker', 'brute', 'walker'];
    for (let k = 0; k < 20; k++) Z.spawn([30 + (k % 10) * 2.6, 0, -30 + Math.floor(k / 10) * 8], { exact: true, type: types[k % 5] });
    step(Math.round(60 / DT));
    expect(Z.stats.stuck).toBe(0);
    expect(Z.list.filter((r) => r.layer === 1).length).toBeGreaterThanOrEqual(10);
    expect(G.player.damage).toHaveBeenCalled();
  });

  it('AI cost: 24 mixed types on two layers stay under 1.0 ms a frame (stats.aiMs)', () => {
    const P = [45, 3.04, -37.2];
    const { Z, step } = worldSetup({ player: P, zone: 'motel' });
    const types = ['runner', 'armoured', 'walker', 'bloater', 'brute', 'walker'];
    const r = createRng(9);
    for (let k = 0; Z.list.length < 24 && k < 400; k++) {
      const x = r.range(28, 58), z = r.range(-35, -4);
      Z.spawn([x, 0, z], { exact: true, type: types[k % types.length] });
    }
    step(300);
    let sum = 0;
    for (let f = 0; f < 900; f++) { step(); sum += Z.stats.aiMs; }
    expect(Z.list.some((q) => q.layer === 1)).toBe(true);
    expect(sum / 900).toBeLessThan(1.0);
  });

  it('a player out of reach (on a car roof) gathers zombies below without stuck respawns', () => {
    const { Z, G, step } = worldSetup({ player: [0, 0, 0] });
    // the forecourt car nearest the origin; stand on its roof
    const car = built.colliders.filter((c) => c.max[1] > 1.2 && c.max[1] < 1.8 && Math.abs(c.min[1]) < 0.6 && c.max[0] - c.min[0] < 6 && c.max[2] - c.min[2] < 6)
      .sort((a, b) => Math.hypot((a.min[0] + a.max[0]) / 2, (a.min[2] + a.max[2]) / 2) - Math.hypot((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2))[0];
    G.player.pos = [(car.min[0] + car.max[0]) / 2, car.max[1], (car.min[2] + car.max[2]) / 2];
    for (let k = 0; k < 8; k++) Z.spawn([G.player.pos[0] + Math.sin(k) * 10, 0, G.player.pos[2] + Math.cos(k) * 10], { exact: true });
    step(Math.round(30 / DT));
    expect(Z.stats.stuck).toBe(0);
  });

  // ---- no attacks through walls, climbs that end, doors in the nav ----------------------
  // records every hit on the player with where the (only) zombie stood
  function hitLog(G, Z) {
    const hits = [];
    G.player.damage = vi.fn(() => { const r = Z.list[0]; hits.push(r ? { x: r.pos.x, z: r.pos.z, state: r.state } : null); return true; });
    return hits;
  }

  it('no swing through the diner\'s rear wall: a player against it inside, a zombie just outside, boards up', () => {
    const { Z, G, log, step } = worldSetup({ player: [16.2, 0, -31.35], open: ['d1'] });
    const hits = hitLog(G, Z);
    Z.spawn([16.2, 0, -32.5], { exact: true }); // 1.15 m apart, a 0.3 m wall between
    step(Math.round(20 / DT));
    expect(hits.length).toBe(0);
    expect(log.filter(([n]) => n === 'zombie:attack').length).toBe(0);
  });

  it('the kitchen\'s east wall: a zombie in the motel lot walks round through the back door and only hits from inside', () => {
    const { Z, G, step } = worldSetup({ player: [25.95, 0, -23.6], open: ['d1', 'd2'] });
    const hits = hitLog(G, Z);
    Z.spawn([26.95, 0, -23.6], { exact: true }); // 1.0 m apart through the wall
    step(Math.round(25 / DT));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.x).toBeLessThan(26.3); // inside the kitchen
    expect(Z.stats.stuck).toBe(0);
  });

  it('a motel room\'s front wall: a zombie on the lot side goes in by the door before it hits', () => {
    const { Z, G, step } = worldSetup({ player: [43.2, 0, -38.65], zone: 'motel' });
    const hits = hitLog(G, Z);
    Z.spawn([43.2, 0, -37.6], { exact: true });
    step(Math.round(25 / DT));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.z).toBeLessThan(-38.3); // in the room
    expect(Z.stats.stuck).toBe(0);
  });

  it('a zombie tearing a window swings through it at a player standing there once 3 boards are gone', () => {
    const { Z, G, step, breaks } = worldSetup({ player: [14.5, 0, -31.3], open: ['d1'] });
    const hits = hitLog(G, Z);
    Z.spawn(point('sp-w-d2'), { exact: true });
    let hitAt = null;
    for (let f = 0; f < 60 * 25; f++) {
      step();
      if (hitAt === null && hits.length) hitAt = breaks.length;
    }
    expect(hitAt).not.toBeNull();
    expect(hitAt).toBeGreaterThanOrEqual(3); // not before 3 boards are torn
    expect(hits[0].z).toBeLessThan(-32); // from outside the wall
    expect(breaks.length).toBe(6); // and it goes on tearing
  });

  it('a zombie tearing a window at its edge hits a player through the opening, not one behind the wall beside it', () => {
    for (const [px, hits] of [[14.1, true], [13.25, false]]) {
      const { Z, G, step, breaks } = worldSetup({ player: [20, 0, -26], open: ['d1'] });
      const hit = hitLog(G, Z);
      Z.spawn(point('sp-w-d2'), { exact: true });
      // until it is tearing with no more than 3 boards left, the player away from the window
      for (let f = 0; f < 60 * 20 && !(Z.crowd.state[0] === 6 && breaks.length >= 3); f++) step();
      expect(Z.crowd.state[0]).toBe(6);
      // at the window's west edge (the opening is 13.8-15.2), the player inside 0.35 m from the wall
      Z.crowd.x[0] = 13.85;
      G.player.pos[0] = px; G.player.pos[2] = -31.5;
      let swung = 0;
      G.events.on('zombie:attack', () => { swung++; });
      step(Math.round(2 / DT));
      expect(swung).toBeGreaterThan(0); // in reach either way: it swings
      expect({ px, hit: hit.length > 0 }).toEqual({ px, hit: hits });
    }
  });

  it('a window climb the animator never ends is left after 5 s; the next zombie at that window gets in too', () => {
    const { G, step } = worldSetup({ player: [13, 0, -25], open: ['d1'] });
    const Z = createZombies(G, { build: stubBuilder().build, animate: () => frozenClimb() });
    G.zombies = Z;
    const a = Z.spawn(point('sp-w-d3'), { exact: true });
    const b = Z.spawn(point('sp-w-d3'), { exact: true });
    for (let f = 0; f < 60 * 30; f++) { G.time.t += DT; G.time.sim += DT; G.nav.update(DT); Z.update(DT); }
    for (const id of [a, b]) expect(WL.zoneAt(rec(Z, id).pos.x, rec(Z, id).pos.z)).toBe('diner');
    expect(G.player.damage).toHaveBeenCalled();
  });

  it('doors bought in ring order after the nav is built connect every zone to every other; shut again they do not', () => {
    const { G, state, reshut } = worldSetup({ player: [0, 0, 0] });
    G.nav.field.dist(0, 0, 0); // the grid exists, every door shut
    const grid = G.nav.grid;
    const P = { forecourt: [0, 0, 0], diner: [13, 0, -25], motel: [40, 0, -24], garage: [34, 0, 6] };
    for (const [z, p] of Object.entries(P)) {
      const k = grid.nearestWalkable(p[0], p[2], 0); // an open cell near each zone's point
      P[z] = [grid.centerX(k), 0, grid.centerZ(k)];
      expect(WL.zoneAt(P[z][0], P[z][2])).toBe(z);
    }
    const reach = () => {
      const out = {};
      for (const [to, pt] of Object.entries(P)) {
        const f = createFlowField(grid);
        f.setTarget(pt);
        for (const [from, pf] of Object.entries(P)) if (from !== to) out[`${from}>${to}`] = f.dist(pf[0], pf[2], 0) < Infinity;
      }
      return out;
    };
    expect(reach()['forecourt>diner']).toBe(false);
    for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) {
      expect(state.openDoor(id)).toBe(true);
      const d = WL.doors.find((q) => q.id === id), r = reach();
      expect(r[`${d.a}>${d.b}`]).toBe(true);
      expect(r[`${d.b}>${d.a}`]).toBe(true);
    }
    const all = reach();
    expect(Object.values(all).every(Boolean)).toBe(true);
    reshut();
    const shut = reach();
    for (const z of ['diner', 'motel', 'garage']) { expect(shut[`forecourt>${z}`]).toBe(false); expect(shut[`${z}>forecourt`]).toBe(false); }
  });
});
