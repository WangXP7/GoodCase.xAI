import { describe, it, expect, vi } from 'vitest';
import { createZombies } from '../src/zombie/manager.js';
import { createGhostAnimator, createCrowd, addAgent, setAgentType, crowdThink, createObstacles, AI, WINDUP, RECOVER } from '../src/zombie/ai.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { tuning } from '../src/game/tuning.js';

// A player running past a zombie: the real manager and AI, the ghost animator (the real one's
// timings), a stub body, and a player moved in a straight line at walk or sprint speed. The zombie
// starts facing +z (then turns after the player as it always does) and is either standing (speed 0,
// so the lateral distance is exact) or walking at its type's speed.
vi.mock('../src/zombie/body.js', () => ({ buildZombie: () => { throw new Error('real body not used in tests'); } }));
vi.mock('../src/zombie/anim.js', () => ({ createAnimator: () => { throw new Error('real animator not used in tests'); } }));
vi.mock('../src/zombie/zombietest.js', () => ({ installZombieTest: () => ({ update() {} }) }));

const DT = 1 / 60;
const WALK = tuning.player.walk, SPRINT = tuning.player.sprint;

function setup(round = 5) {
  const events = createEvents((e) => { throw e; });
  const G = {
    params: {}, rng: createRng(1), events,
    time: { t: 0, dt: 0, frame: 0 },
    scene: { add() {} }, camera: null,
    level: { colliders: [], spawnPoints: [], raycast: () => null },
    nav: null,
    player: { pos: [0, 0, 0], alive: true, damage: vi.fn(() => true) },
    game: { state: 'playing', round },
  };
  const mesh = () => ({ visible: true, position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: { y: 0 } });
  // a head hitbox (radius 0.12) on a bone the test places; the capsule raycast always misses
  const head = () => ({ part: 'head', index: 0, center: [0, 0, 0], radius: 0.12, halfHeight: 0, bone: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1] } } });
  const build = (seed) => ({ seed, mesh: mesh(), skeleton: { bones: [] }, hitboxes: [head()], pose: { hide: [false] }, setBlood() {}, getBlood: () => 0, setLod() {}, setWet() {}, raycast: () => null });
  const Z = createZombies(G, { build, animate: () => createGhostAnimator() });
  G.zombies = Z;
  return { G, Z };
}

// heading: the player's direction of travel, degrees from the zombie's start facing (+z).
//   180: head-on, passing beside it; 135: oblique from in front; 90: across its front;
//   0: overtaking it from behind.
// lateral: closest distance of the player's line to the zombie's start position.
// The closest point is on the side the zombie faces for a crossing run (behind: the other side).
// facing: the zombie's start yaw (rad). Returns { hit, attacks, minD }.
export function runPast({ heading, lateral, speed, walking = false, type = 'walker', round = 5, lead = 6, behind = false, facing = 0 }) {
  const { G, Z } = setup(round);
  const h = (heading * Math.PI) / 180;
  const dx = Math.sin(h), dz = Math.cos(h);
  // the side of the line: perpendicular to the travel, toward +z (in front) when crossing
  let nx = dz, nz = -dx;
  if (nz < -1e-9 || (Math.abs(nz) < 1e-9 && nx < 0)) { nx = -nx; nz = -nz; }
  if (behind) { nx = -nx; nz = -nz; }
  const cx = nx * lateral, cz = nz * lateral;
  const sx = cx - dx * lead, sz = cz - dz * lead;
  G.player.pos[0] = sx; G.player.pos[2] = sz;
  Z.spawn([0, 0, 0], { exact: true, type });
  const c = Z.crowd;
  c.yaw[0] = facing;
  if (!walking) { c.speed[0] = 0; Z.list[0].speed = 0; }
  const run = (2 * lead) / speed;
  let hit = false, minD = Infinity, t = 0, attacks = 0;
  G.events.on('zombie:attack', () => { attacks++; });
  // the run, then 1 s for a swing begun at the end of it to land
  for (; t < run + 1; t += DT) {
    if (t < run) { G.player.pos[0] += dx * speed * DT; G.player.pos[2] += dz * speed * DT; }
    G.time.t += DT; Z.update(DT);
    minD = Math.min(minD, Math.hypot(G.player.pos[0] - c.x[0], G.player.pos[2] - c.z[0]));
    if (!hit && G.player.damage.mock.calls.length) hit = true;
  }
  return { hit, attacks, minD };
}

const LATERAL = [0.4, 0.8, 1.2, 1.6];
const HEADINGS = [180, 135, 90, 0];

function table(opts) {
  const rows = [];
  for (const speed of [WALK, SPRINT]) {
    for (const heading of HEADINGS) {
      const cells = LATERAL.map((lateral) => runPast({ heading, lateral, speed, ...opts }));
      rows.push({ speed, heading, cells });
    }
  }
  return rows;
}

function print(name, rows) {
  const lines = [`${name}   lateral: ${LATERAL.map((l) => `${l.toFixed(1)} m`).join('  ')}`];
  for (const r of rows) {
    lines.push(`  ${r.speed === SPRINT ? 'sprint' : 'walk  '} ${String(r.heading).padStart(3)}deg  ${r.cells.map((c) => (c.hit ? ' HIT ' : c.attacks ? ' miss' : ' --  ') + ' ').join(' ')}`);
  }
  lines.push('  (HIT: landed; miss: swung and missed; --: never swung)');
  console.log(lines.join('\n'));
}

describe('run-past table', () => {
  it('prints the hit table (RUNPAST_TABLE=1)', () => {
    if (!process.env.RUNPAST_TABLE) return;
    print('standing walker', table({}));
    print('walking walker', table({ walking: true }));
    print('runner (walking)', table({ walking: true, type: 'runner' }));
    for (const round of [1, 2, 3]) print(`standing walker, round ${round}`, table({ round }));
  });
});

describe('running past a zombie', () => {
  // A player who brushes past (0.4 m) or passes at arm's length (0.8 m) is hit, at walk and sprint
  // speed, from every direction it comes: from in front, across its front, overtaking from behind.
  for (const walking of [false, true]) {
    for (const speed of [WALK, SPRINT]) {
      it(`a ${walking ? 'walking' : 'standing'} walker hits a player ${speed === SPRINT ? 'sprinting' : 'walking'} past at 0.4 and 0.8 m`, () => {
        for (const heading of HEADINGS) {
          for (const lateral of [0.4, 0.8]) {
            const r = runPast({ heading, lateral, speed, walking });
            expect({ heading, lateral, hit: r.hit }).toEqual({ heading, lateral, hit: true });
          }
        }
      });
    }
  }

  it('a standing walker never hits a player who stays 1.6 m away, and a sprint at 1.2 m gets by', () => {
    for (const heading of HEADINGS) {
      for (const speed of [WALK, SPRINT]) expect(runPast({ heading, lateral: 1.6, speed }).hit).toBe(false);
      expect(runPast({ heading, lateral: 1.2, speed: SPRINT }).hit).toBe(false);
    }
  });

  it('one swing at most for one pass (the cooldown holds)', () => {
    for (const heading of HEADINGS) expect(runPast({ heading, lateral: 0.4, speed: WALK }).attacks).toBeLessThanOrEqual(1);
  });

  it('never from behind: a sprint across its back at 0.8 m is not hit', () => {
    // standing, facing +z; the player crosses behind it (and keeps going)
    for (const heading of [90, 270]) expect(runPast({ heading, lateral: 0.8, speed: SPRINT, behind: true }).hit).toBe(false);
  });

  it('round 1 swings only at where the player stands, round 2 half way, round 3 three quarters, full from round 4 (tuning.zombies.swing)', () => {
    expect(tuning.zombies.swing.byRound).toEqual({ 1: 0, 2: 0.5, 3: 0.75 });
    expect(tuning.zombies.swing.strength).toBe(1);
    // a walking pass at 0.4 m and a sprint at 0.8 m: missed in round 1, hit from round 4
    for (const heading of HEADINGS) {
      expect(runPast({ heading, lateral: 0.4, speed: WALK, round: 1 }).hit).toBe(false);
      expect(runPast({ heading, lateral: 0.8, speed: SPRINT, round: 1 }).hit).toBe(false);
      expect(runPast({ heading, lateral: 0.4, speed: WALK, round: 4 }).hit).toBe(true);
      expect(runPast({ heading, lateral: 0.8, speed: SPRINT, round: 4 }).hit).toBe(true);
    }
    // a player who stops in front of it is still hit in round 1
    expect(runPast({ heading: 180, lateral: 0.4, speed: 0.1, round: 1, lead: 0.3 }).hit).toBe(true);
  });
});

describe('the strike (pure crowd)', () => {
  const W = tuning.walker;
  function one({ yaw = 0, px = 0, pz = 1, obstacles = null, pvx = 0, pvz = 0 } = {}) {
    const c = createCrowd(2);
    addAgent(c, 0, 0, yaw, 0, 0);
    setAgentType(c, 0, { reach: W.reach, windup: W.windup, cooldown: W.cooldown });
    const ends = [], starts = [];
    const hooks = { attackStart: (i) => starts.push(i), attackEnd: (i, landed) => ends.push(landed), climb() {}, stuck() {} };
    const env = { t: 0, px, py: 0, pz, pAlive: true, field: null, tune: W, hooks, obstacles, pvx, pvz };
    const step = (n = 1) => { for (let k = 0; k < n; k++) { env.t += DT; crowdThink(c, DT, env); } };
    return { c, env, step, ends, starts };
  }

  it('lands on the first frame of the strike the player is in reach', () => {
    const s = one({ pz: 1.0 });
    s.step();
    expect(s.c.state[0]).toBe(WINDUP);
    s.step(Math.floor(W.windup / DT) - 2);
    expect(s.ends.length).toBe(0);
    s.step(3);
    expect(s.ends).toEqual([true]);
    expect(s.c.state[0]).toBe(RECOVER);
  });

  it('a player out of reach when the wind-up ends who steps in during the strike is hit; one who stays out is missed after strikeHold', () => {
    const a = one({ pz: 1.0 });
    a.step();
    a.env.pz = 2.0; a.env.pvx = 4; // on the move: the full strike
    a.step(Math.ceil(W.windup / DT) + 2);
    expect(a.ends.length).toBe(0);
    a.env.pz = W.reach + AI.strikeSlack / 2;
    a.step();
    expect(a.ends).toEqual([true]);
    const b = one({ pz: 1.0 });
    b.step();
    b.env.pz = 2.0; b.env.pvx = 4;
    b.step(Math.ceil((W.windup + AI.strikeHold) / DT) + 1);
    expect(b.ends).toEqual([false]);
  });

  it('level with its shoulders lands; behind the shoulder or behind it does not', () => {
    for (const [px, pz, hit] of [[1.0, 0, true], [-1.0, 0.05, true], [0.95, -0.25, false], [0, -1.0, false], [0.3, -0.9, false]]) {
      const s = one({ pz: 1.0 });
      s.step();
      // the player moves at once to its spot and the zombie is held facing +z
      s.env.px = px; s.env.pz = pz; s.env.pvx = 4; // running past
      for (let k = 0; k < 60 && !s.ends.length; k++) { s.c.yaw[0] = 0; s.step(); }
      expect({ px, pz, hit: s.ends[0] }).toEqual({ px, pz, hit });
    }
  });

  it('a player standing still meets the eased swing: in front only, no extra reach', () => {
    for (const [px, pz, pvx, hit] of [[1.0, 0, 0, false], [1.0, 0, 4, true], [0.6, 0.85, 0, true]]) {
      const s = one({ pz: 1.0 });
      s.step();
      s.env.px = px; s.env.pz = pz; s.env.pvx = pvx;
      for (let k = 0; k < 60 && !s.ends.length; k++) { s.c.yaw[0] = 0; s.step(); }
      expect({ px, pz, pvx, hit: s.ends[0] }).toEqual({ px, pz, pvx, hit });
    }
  });

  it('swings ahead of a running player, and not at one running away', () => {
    // the player 2.5 m off, running across its front at sprint speed: in reach when the blow lands
    const a = one({ px: -2.5, pz: 0.7, pvx: SPRINT });
    a.step();
    expect(a.starts.length).toBe(1);
    // the same spot, standing: too far for a swing
    const b = one({ px: -2.5, pz: 0.7 });
    b.step();
    expect(b.starts.length).toBe(0);
    // 1.0 m away and running straight off: gone before the blow lands
    const c = one({ pz: 1.0, pvz: SPRINT });
    c.step();
    expect(c.starts.length).toBe(0);
  });

  it('no swing and no hit through a wall at swing height; a waist-high counter does not stop it', () => {
    const wall = createObstacles([{ min: [-2, 0, 0.45], max: [2, 2.5, 0.75] }]);
    const a = one({ pz: 1.0, obstacles: wall });
    a.step(90);
    expect(a.starts.length + a.ends.length).toBe(0);
    const counter = createObstacles([{ min: [-2, 0, 0.45], max: [2, 1.0, 0.75] }]);
    const b = one({ pz: 1.0, obstacles: counter });
    b.step(60);
    expect(b.ends).toEqual([true]);
    // a wall put up between them during the wind-up stops the blow
    const c = one({ pz: 1.0 });
    c.step();
    c.env.obstacles = wall;
    c.step(60);
    expect(c.ends).toEqual([false]);
  });

  it('blocks(): segment against boxes, ignoring a box an end stands in', () => {
    const o = createObstacles([{ min: [1, 0, -1], max: [1.3, 3, 1] }, { min: [5, 0, -1], max: [7, 1.5, 1] }]);
    expect(o.blocks(0, 0, 2, 0, 0)).toBe(true);
    expect(o.blocks(0, 0, 0.9, 0.5, 0)).toBe(false);
    expect(o.blocks(0, 2, 2, 2, 0)).toBe(false);
    expect(o.blocks(4, 0, 6, 0, 0)).toBe(false);        // the player stands on the 1.5 m box
    expect(o.blocks(0, 0, 2, 0, 2.5)).toBe(false);      // feet above the wall's top band
    expect(createObstacles([]).blocks(0, 0, 1, 1, 0)).toBe(false);
  });
});

describe('turning', () => {
  it('a turn from rest builds up to AI.turnRate over AI.turnRamp s', () => {
    const W = tuning.walker;
    const c = createCrowd(1);
    addAgent(c, 0, 0, 0, 0, 0);
    const hooks = { attackStart() {}, attackEnd() {}, climb() {}, stuck() {} };
    // the player straight behind, out of reach: it turns round on the spot
    const env = { t: 0, px: 0, py: 0, pz: -5, pAlive: true, field: null, tune: W, hooks };
    const speeds = [];
    for (let f = 0; f < 20; f++) { const y0 = c.yaw[0]; env.t += DT; crowdThink(c, DT, env); speeds.push(Math.abs(c.yaw[0] - y0) / DT); }
    expect(speeds[0]).toBeLessThan(AI.turnRate * 0.2);
    for (let f = 1; f < speeds.length; f++) expect(speeds[f]).toBeGreaterThanOrEqual(speeds[f - 1] - 1e-9);
    const full = Math.ceil(AI.turnRamp / DT);
    expect(speeds[full - 2]).toBeLessThan(AI.turnRate);
    expect(speeds[full + 1]).toBeCloseTo(AI.turnRate, 6);
  });
});

describe('a zombie at arm\'s length can be shot', () => {
  const eye = [0, 1.7, 0];
  const at = (x, y, z) => { const d = [x - eye[0], y - eye[1], z - eye[2]]; const l = Math.hypot(...d); return d.map((v) => v / l); };
  const placeHead = (Z, x, y, z) => { const e = Z.bodyOf(Z.list[0].id).hitboxes[0].bone.matrixWorld.elements; e[12] = x; e[13] = y; e[14] = z; };

  it('a ray that misses every capsule (the camera inside the lunging body) hits its standing column within 1 m', () => {
    const { Z } = setup(5);
    const id = Z.spawn([0, 0, 0.6], { exact: true });
    placeHead(Z, 0, 1.6, 0.6);
    const h = Z.raycast(eye, at(0, 1.3, 0.6), 5);
    expect(h && h.id).toBe(id);
    expect(h.part).toBe('torso');
    expect(h.dist).toBeGreaterThan(0.2);
    expect(h.dist).toBeLessThan(0.6);
    expect(Z.raycast(eye, at(0, 1.3, -0.6), 5)).toBeNull();       // the other way
    expect(Z.raycast(eye, at(1.5, 1.3, 0.6), 5)).toBeNull();      // beside it
    // further off, the body's own capsules decide (here: a miss)
    const far = setup(5);
    far.Z.spawn([0, 0, 2], { exact: true });
    expect(far.Z.raycast(eye, at(0, 1.3, 2), 5)).toBeNull();
  });

  it('the column counts a head only where the ray passes through the head itself', () => {
    const { Z } = setup(5);
    Z.spawn([0, 0, 0.6], { exact: true });
    // the head lunged forward and down, at (0, 1.45, 0.45)
    placeHead(Z, 0, 1.45, 0.45);
    expect(Z.raycast(eye, at(0, 1.45, 0.45), 5).part).toBe('head');
    // a level shot at eye height over the head: in the column's top, but not through the head
    expect(Z.raycast(eye, [0, 0, 1], 5).part).toBe('torso');
    // a severed head is never hit
    Z.bodyOf(Z.list[0].id).pose.hide[0] = true;
    expect(Z.raycast(eye, at(0, 1.45, 0.45), 5).part).toBe('torso');
  });

  it('a crawler at arm\'s length is a low box: a level shot over it misses, one down at it hits', () => {
    const { Z } = setup(5);
    const id = Z.spawn([0, 0, 0.8], { exact: true });
    Z.list[0].crawling = true;
    placeHead(Z, 0, 0.3, 0.6);
    expect(Z.raycast(eye, [0, 0, 1], 5)).toBeNull();
    const h = Z.raycast(eye, at(0, 0.3, 0.8), 5);
    expect(h && h.id).toBe(id);
    expect(Z.raycast(eye, at(0, 0.3, 0.6), 5).part).toBe('head');
    expect(Z.raycast(eye, at(0.3, 0.1, 0.9), 5).part).toBe('torso');
  });
});

describe('fairness of the strike', () => {
  const W = tuning.walker;
  function agent({ x = 0, y = 0, z = 0, yaw = 0, reach = W.reach, slam = null } = {}) {
    const c = createCrowd(2);
    addAgent(c, x, z, yaw, 0, 0);
    c.y[0] = y;
    setAgentType(c, 0, { reach, windup: W.windup, cooldown: W.cooldown, slam });
    return c;
  }
  function run(c, env, frames) {
    const ends = [], starts = [];
    env.hooks = { attackStart: () => starts.push(1), attackEnd: (i, landed, dx, dz, kind) => ends.push([landed, kind]), climb() {}, stuck() {}, ...(env.hooks || {}) };
    env.t = 0; env.pAlive = true; env.field = null; env.tune = W;
    for (let f = 0; f < frames; f++) { env.t += DT; crowdThink(c, DT, env); }
    return { starts, ends };
  }
  const landedCount = (r) => r.ends.filter(([l]) => l).length;

  it('a zombie under a landing does not hit a player standing on it', () => {
    // a landing slab 1.2-1.5 m up; the zombie below it, the player on it 0.8 m away
    const landing = createObstacles([{ min: [-1, 1.2, 0], max: [1, 1.5, 2] }]);
    expect(landedCount(run(agent({ z: 0.6 }), { px: 0, py: 1.5, pz: 1.4, obstacles: landing }, 120))).toBe(0);
    // beside the landing's edge (not under it) it is a raised thing, like a dumpster: reached
    expect(landedCount(run(agent({ z: -0.6 }), { px: 0, py: 1.5, pz: 0.3, obstacles: landing }, 120))).toBeGreaterThan(0);
    // with nothing to stand on (no colliders) 1.5 m up is out of an arm's reach
    expect(landedCount(run(agent({ z: -0.6 }), { px: 0, py: 1.5, pz: 0.3, obstacles: null }, 120))).toBe(0);
  });

  it('on the same flight of stairs it reaches further up than an arm', () => {
    // a steep flight: 0.25 m risers, 0.2 m treads
    const stairs = createObstacles([0, 1, 2, 3, 4, 5, 6].map((k) => ({ min: [-0.6, 0, k * 0.2], max: [0.6, (k + 1) * 0.25, (k + 1) * 0.2], stair: true })));
    // zombie on step 1 (feet 0.5), player on step 5 (feet 1.5): 1.0 m up, 0.8 m along
    expect(landedCount(run(agent({ z: 0.3, y: 0.5 }), { px: 0, py: 1.5, pz: 1.1, obstacles: stairs }, 120))).toBeGreaterThan(0);
  });

  it('a brute gets no extra reach on its swing', () => {
    const brute = tuning.zombies.types.brute;
    // just past its reach when the wind-up ends: a walker's slack lands it, the brute's swing misses
    const c = agent({ reach: brute.reach, slam: { every: 1e9, radius: 0.1, windup: 0.6 } });
    c.slamT[0] = 1e9;
    const env = { px: 0, py: 0, pz: brute.reach - 0.05, obstacles: null };
    env.hooks = { attackStart: () => { env.pz = brute.reach + AI.strikeSlack / 2; env.pvx = 4; } };
    expect(run(c, env, 120).ends[0]).toEqual([false, 0]);
    const env2 = { px: 0, py: 0, pz: W.reach - 0.05, obstacles: null };
    env2.hooks = { attackStart: () => { env2.pz = W.reach + AI.strikeSlack / 2; env2.pvx = 4; } };
    expect(run(agent(), env2, 120).ends[0]).toEqual([true, 0]);
  });

  it('a swing from a window it is tearing lands only through the opening (hooks.through)', () => {
    for (const open of [true, false]) {
      const c = agent({ z: 0 });
      // at a window, tearing, 2 boards left (under breachBoards)
      c.state[0] = 6; c.fnx[0] = 0; c.fnz[0] = 1; c.fd[0] = 0.3; c.win[0] = 1;
      const asked = [];
      const env = { px: 0.5, py: 0, pz: 0.9, obstacles: null, breachBoards: 3, tearEvery: 100,
        hooks: { boards: () => 2, tear: () => 2, tearStart() {}, through: (i, x, z) => { asked.push([x, z]); return open; } } };
      const r = run(c, env, 120);
      expect(r.starts.length).toBeGreaterThan(0);
      expect(asked.length).toBeGreaterThan(0);
      expect(r.ends[0][0]).toBe(open);
    }
  });
});
