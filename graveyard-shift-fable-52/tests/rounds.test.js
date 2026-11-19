import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rounds, createRoundDirector, roundTotal, zombiesThroughRound } from '../src/game/rounds.js';
import { tuning } from '../src/game/tuning.js';
import { createGame } from '../src/game/state.js';
import { createWeapon } from '../src/weapon/firing.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';

describe('rounds formulas', () => {
  it('total zombies per round', () => {
    expect(rounds.total(1)).toBe(10);
    expect(rounds.total(5)).toBe(26);
  });
  it('walker health: +100 per round to 9, then x1.1 per round, integer', () => {
    expect(rounds.health(1)).toBe(150);
    expect(rounds.health(9)).toBe(950);
    expect(rounds.health(10)).toBe(1045);
    expect(rounds.health(12)).toBe(Math.round(950 * 1.1 ** 3));
    for (let n = 1; n <= 30; n++) expect(Number.isInteger(rounds.health(n))).toBe(true);
  });
  it('spawn interval floors at 0.6 s', () => {
    expect(rounds.spawnInterval(1)).toBeCloseTo(1.9, 10);
    expect(rounds.spawnInterval(20)).toBe(0.6);
    expect(rounds.spawnInterval(40)).toBe(0.6);
  });
});

// A fake zombie world: spawn hands out ids, kill() emits a death into the director.
// The mechanics tests run without the early-round easing (`ease: {}`); the easing has its own tests
// below with the real tuning.
function makeWorld({ points = [{ pos: [0, 0, 0], kind: 'treeline' }, { pos: [5, 0, 5], kind: 'fence' }], ease = {}, playerPos } = {}) {
  const log = [];
  let nextId = 1;
  const live = new Set();
  const world = {
    points,
    log,
    live,
    spawnCalls: [],
    types: new Map(), // id -> type
    spawn(point, n, type) { const id = nextId++; live.add(id); world.types.set(id, type); world.spawnCalls.push({ point, n, type }); return id; },
  };
  const director = createRoundDirector({
    rng: createRng(7).fork('rounds'),
    spawnPoints: () => world.points,
    spawn: (p, n, type) => world.spawn(p, n, type),
    emit: (name, payload) => log.push([name, payload]),
    ease,
    playerPos,
  });
  world.kill = (id) => { live.delete(id); director.onDeath(id); };
  world.alive = (type) => { let k = 0; for (const id of live) if (world.types.get(id) === type) k++; return k; };
  world.killAll = () => { for (const id of [...live]) world.kill(id); };
  return { world, director };
}

const step = (director, seconds, dt = 1 / 60, each) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) { director.update(dt); if (each) each(); }
};

describe('round director', () => {
  it('start emits round:start with n and total', () => {
    const { world, director } = makeWorld();
    director.start(3);
    expect(world.log[0]).toEqual(['round:start', { n: 3, total: 18, boss: false }]);
    expect(director.n).toBe(3);
  });

  it('spawns at the round interval, passing a spawn point and the round', () => {
    const { world, director } = makeWorld();
    director.start(1);
    director.update(0); // first spawn is immediate
    expect(director.spawned).toBe(1);
    step(director, 1.9 * 3 + 0.01);
    expect(director.spawned).toBe(4);
    for (const c of world.spawnCalls) {
      expect(world.points).toContain(c.point);
      expect(c.n).toBe(1);
    }
  });

  it('never more than 24 alive in a simulated round 15', () => {
    const { world, director } = makeWorld();
    const rng = createRng(99);
    director.start(15);
    let maxAlive = 0;
    let t = 0;
    // Kill slowly so the cap is actually reached, then drain.
    while (director.phase === 'active' && t < 600) {
      director.update(1 / 30);
      t += 1 / 30;
      maxAlive = Math.max(maxAlive, world.live.size, director.alive);
      if (rng.next() < 0.03 && world.live.size) world.kill(rng.pick([...world.live]));
    }
    expect(maxAlive).toBe(24);
    expect(director.spawned).toBe(director.total);
    expect(director.total).toBe(Math.round(0.6 * rounds.total(15)) + 3); // 15 is a boss round
    expect(director.phase).toBe('lull');
  });

  it('round ends only when spawned = total and alive = 0', () => {
    const { world, director } = makeWorld();
    director.start(1);
    // Kill everything as it spawns, except keep one alive at the end.
    step(director, 30, 1 / 60, () => {
      const ids = [...world.live];
      if (director.spawned < rounds.total(1)) ids.forEach((id) => world.kill(id));
    });
    expect(director.spawned).toBe(10);
    expect(director.alive).toBeGreaterThan(0);
    expect(director.phase).toBe('active');
    expect(world.log.some(([e]) => e === 'round:end')).toBe(false);
    // All spawned, all but one dead: still active.
    const ids = [...world.live];
    ids.slice(1).forEach((id) => world.kill(id));
    step(director, 1);
    expect(director.phase).toBe('active');
    world.kill(ids[0]);
    director.update(1 / 60);
    expect(director.phase).toBe('lull');
    expect(world.log.filter(([e]) => e === 'round:end')).toEqual([['round:end', { n: 1 }]]);
  });

  it('deaths of zombies the director did not spawn do not count', () => {
    const { world, director } = makeWorld();
    director.start(1);
    director.update(0);
    director.onDeath(9999);
    expect(director.alive).toBe(1);
  });

  it('10 s lull, then round:start with n+1', () => {
    const b = makeWorld();
    b.director.start(2);
    let tEnd = null; let tStart = null; let t = 0;
    const dt = 1 / 60;
    while (tStart === null && t < 120) {
      b.director.update(dt); t += dt; b.world.killAll();
      const last = b.world.log[b.world.log.length - 1];
      if (tEnd === null && last[0] === 'round:end') tEnd = t;
      if (tEnd !== null && last[0] === 'round:start') { tStart = t; expect(last[1]).toEqual({ n: 3, total: 18, boss: false }); }
    }
    expect(tStart - tEnd).toBeGreaterThan(10 - 2 * dt);
    expect(tStart - tEnd).toBeLessThan(10 + 2 * dt);
    expect(b.director.n).toBe(3);
  });

  it('with no spawn points the round waits instead of throwing', () => {
    const { world, director } = makeWorld({ points: [] });
    director.start(1);
    expect(() => step(director, 20)).not.toThrow();
    expect(director.spawned).toBe(0);
    expect(director.phase).toBe('active');
    world.points.push({ pos: [1, 0, 1], kind: 'fence' });
    director.update(1 / 60);
    expect(director.spawned).toBe(1);
  });

  it('onRemove: a zombie removed without dying is replaced, so the round total is still met', () => {
    const { world, director } = makeWorld();
    director.start(1);
    director.update(0);
    const [first] = world.live;
    world.live.delete(first);
    expect(director.onRemove(first)).toBe(true);
    expect(director.alive).toBe(0);
    expect(director.spawned).toBe(0);
    expect(director.onRemove(first)).toBe(false); // second removal is a no-op
    // Kill everything as it comes: the round still needs 10 deaths, then ends.
    let deaths = 0;
    for (let i = 0; i < 3600 && director.phase === 'active'; i++) {
      director.update(1 / 60); deaths += world.live.size; world.killAll();
    }
    director.update(1 / 60);
    expect(deaths).toBe(10);
    expect(world.spawnCalls.length).toBe(11);
    expect(world.log.filter(([e]) => e === 'round:end')).toEqual([['round:end', { n: 1 }]]);
  });

  it('reconcile drops tracked ids missing from the manager list and replaces them', () => {
    const { world, director } = makeWorld();
    director.start(1);
    step(director, 1.9 * 2 + 0.01); // 3 spawned
    expect(director.alive).toBe(3);
    const ids = [...world.live];
    world.live.delete(ids[1]); // vanished without an event
    director.reconcile(new Set(world.live));
    expect(director.alive).toBe(2);
    expect(director.spawned).toBe(2);
  });

  it('a spawn that returns null (refused) does not count', () => {
    const director = createRoundDirector({
      rng: createRng(1), spawnPoints: () => [{ pos: [0, 0, 0] }], spawn: () => null, emit: () => {},
    });
    director.start(1);
    step(director, 15);
    expect(director.spawned).toBe(0);
  });
});

// Launch fix: round 1 must not kill a new player who is still reading the hints.
describe('early-round easing (real tuning)', () => {
  // points at 10, 20, 30 and 40 m east of a player at the origin
  const ring = () => [10, 20, 30, 40].map((x) => ({ pos: [x, 0, 0], kind: 'fence', id: `p${x}` }));
  const real = (o = {}) => makeWorld({ ease: tuning.round.ease, points: ring(), playerPos: () => [0, 0, 0], ...o });

  it('tuning: 8 s grace, one every 3.5 s, 25 m, slow walkers in round 1; 5 s grace in round 2; nothing later', () => {
    expect(tuning.round.ease[1]).toEqual({ grace: 8, interval: 3.5, minDist: 25, slowWalkers: true });
    expect(tuning.round.ease[2]).toEqual({ grace: 5 });
    for (let n = 3; n <= 30; n++) expect(tuning.round.ease[n]).toBeUndefined();
  });

  it('round 1: nothing spawns for the first 8 s', () => {
    const { director } = real();
    director.start(1);
    step(director, 7.95);
    expect(director.spawned).toBe(0);
    step(director, 0.1);
    expect(director.spawned).toBe(1);
  });

  it('round 1: no faster than one zombie every 3.5 s', () => {
    const { director } = real();
    director.start(1);
    const times = [];
    let t = 0, last = 0;
    for (let i = 0; i < 60 * 60 && director.spawned < director.total; i++) {
      director.update(1 / 60); t += 1 / 60;
      if (director.spawned > last) { times.push(t); last = director.spawned; }
    }
    expect(times.length).toBe(10);
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBeGreaterThan(3.5 - 1 / 30);
  });

  it('round 1: only from points at least 25 m from the player', () => {
    const { world, director } = real();
    director.start(1);
    step(director, 60);
    expect(world.spawnCalls.length).toBe(10);
    for (const c of world.spawnCalls) expect(c.point.pos[0]).toBeGreaterThanOrEqual(25);
    // the player moves east: only the 40 m point is far enough
    const b = real({ playerPos: () => [12, 0, 0] }); // 2, 8, 18 and 28 m
    b.director.start(1);
    step(b.director, 60);
    for (const c of b.world.spawnCalls) expect(c.point.id).toBe('p40');
  });

  it('round 1: with no point 25 m away it uses the farthest one rather than stalling', () => {
    const { world, director } = real({ points: ring().slice(0, 2) }); // 10 and 20 m
    director.start(1);
    step(director, 60);
    expect(world.spawnCalls.length).toBe(10);
    for (const c of world.spawnCalls) expect(c.point.id).toBe('p20');
  });

  it('round 1 exposes the easing to the spawn callback (slow walkers); later rounds do not', () => {
    const seen = [];
    let director = null;
    director = createRoundDirector({
      rng: createRng(2), spawnPoints: () => [{ pos: [40, 0, 0] }], playerPos: () => [0, 0, 0],
      spawn: () => { seen.push(director.ease && director.ease.slowWalkers); return seen.length; },
    });
    director.start(1);
    step(director, 10);
    expect(seen[0]).toBe(true);
    director.start(3);
    step(director, 1);
    expect(seen[seen.length - 1]).toBeFalsy();
    expect(director.ease).toBe(null);
  });

  it('round 2: a 5 s grace, then its usual interval and any point', () => {
    const { world, director } = real();
    director.start(2);
    step(director, 4.95);
    expect(director.spawned).toBe(0);
    step(director, 0.1);
    expect(director.spawned).toBe(1);
    step(director, rounds.spawnInterval(2) * 3 + 0.01);
    expect(director.spawned).toBe(4);
    expect(world.spawnCalls.some((c) => c.point.pos[0] < 25)).toBe(true);
  });

  it('round 3 and later are unchanged: first spawn immediate, usual interval', () => {
    const { director } = real();
    director.start(3);
    director.update(0);
    expect(director.spawned).toBe(1);
    step(director, rounds.spawnInterval(3) * 3 + 0.01);
    expect(director.spawned).toBe(4);
  });
});

describe('round scaling', () => {
  it('total: 6 + 4n to round 10, then faster', () => {
    expect(rounds.total(1)).toBe(10);
    expect(rounds.total(10)).toBe(46);
    expect(rounds.total(11)).toBe(53);
    expect(rounds.total(15)).toBe(89);
    expect(rounds.total(20)).toBe(156);
    for (let n = 11; n <= 20; n++) expect(rounds.total(n) - rounds.total(n - 1)).toBeGreaterThan(rounds.total(n - 1) - rounds.total(n - 2) - 1e-9);
  });
  it('after round 20: +10 zombies a round (no grind)', () => {
    expect(rounds.total(21)).toBe(166);
    expect(rounds.total(30)).toBe(256);
    expect(rounds.total(40)).toBe(356);
    for (let n = 21; n <= 60; n++) expect(rounds.total(n) - rounds.total(n - 1)).toBe(10);
  });
  it('walker health: x1.1 a round to 20, then x1.05 a round', () => {
    const h20 = 950 * 1.1 ** 11;
    expect(rounds.health(20)).toBe(Math.round(h20));
    expect(rounds.health(21)).toBe(Math.round(h20 * 1.05));
    expect(rounds.health(30)).toBe(Math.round(h20 * 1.05 ** 10));
    expect(rounds.health(40)).toBe(Math.round(h20 * 1.05 ** 20));
    for (let n = 2; n <= 60; n++) expect(rounds.health(n)).toBeGreaterThan(rounds.health(n - 1));
    // the frag and the molotov scale with the same walker health
    expect(Math.round(tuning.walker.health(25))).toBe(rounds.health(25));
  });
  it('brute health: 12x walker at round 5, 8x at 10, 6x from 15, linear between', () => {
    expect(rounds.bruteScale(5)).toBe(12);
    expect(rounds.bruteScale(10)).toBe(8);
    expect(rounds.bruteScale(15)).toBe(6);
    expect(rounds.bruteScale(20)).toBe(6);
    expect(rounds.bruteScale(40)).toBe(6);
    expect(rounds.bruteScale(1)).toBe(12);
    expect(rounds.bruteScale(7.5)).toBeCloseTo(10, 12);
    expect(rounds.bruteScale(12.5)).toBeCloseTo(7, 12);
    expect(rounds.bruteHealth(5)).toBe(Math.round(550 * 12));
    expect(rounds.bruteHealth(10)).toBe(Math.round(rounds.health(10) * 8));
    expect(rounds.bruteHealth(15)).toBe(Math.round(rounds.health(15) * 6));
  });
  it('zombiesThroughRound and roundTotal are pure exports that sum the director totals', () => {
    expect(roundTotal(1)).toBe(10);
    expect(roundTotal(5)).toBe(17);
    expect(roundTotal(10)).toBe(30);
    expect(roundTotal(21)).toBe(166);
    expect(zombiesThroughRound(0)).toBe(0);
    expect(zombiesThroughRound(1)).toBe(10);
    let sum = 0;
    for (let n = 1; n <= 40; n++) { sum += roundTotal(n); expect(zombiesThroughRound(n)).toBe(sum); expect(roundTotal(n)).toBe(rounds.roundTotal(n)); }
    // the director spawns exactly roundTotal(n)
    for (const n of [4, 5, 10, 23]) {
      const { director } = makeWorld();
      director.start(n);
      expect(director.total).toBe(roundTotal(n));
    }
  });
  it('a boss every fifth round, with min(3, n/5) brutes', () => {
    expect(rounds.isBoss(5)).toBe(true);
    expect(rounds.isBoss(10)).toBe(true);
    expect(rounds.isBoss(6)).toBe(false);
    expect(rounds.isBoss(1)).toBe(false);
    expect(rounds.brutes(5)).toBe(1);
    expect(rounds.brutes(10)).toBe(2);
    expect(rounds.brutes(15)).toBe(3);
    expect(rounds.brutes(20)).toBe(3);
    expect(rounds.brutes(6)).toBe(0);
  });
  it('mix: runners from round 4 (+0.07 a round), armoured from 7, bloaters from 9; shares sum to 1', () => {
    expect(rounds.mix(3).runner).toBe(0);
    expect(rounds.mix(4).runner).toBeCloseTo(0.07, 12);
    expect(rounds.mix(8).runner).toBeCloseTo(0.35, 12);
    // the ramp (before the walker floor) reaches 70 % at round 13 and stays there
    expect(tuning.zombies.mix.runner(8)).toBeCloseTo(0.35, 12);
    expect(tuning.zombies.mix.runner(12)).toBeCloseTo(0.63, 12);
    expect(tuning.zombies.mix.runner(13)).toBeCloseTo(0.7, 12);
    expect(tuning.zombies.mix.runner(30)).toBeCloseTo(0.7, 12);
    for (let n = 1; n < 7; n++) expect(rounds.mix(n).armoured).toBe(0);
    expect(rounds.mix(7).armoured).toBeCloseTo(0.1, 12);
    expect(tuning.zombies.mix.armoured(12)).toBeCloseTo(0.2, 12);
    for (let n = 1; n < 9; n++) expect(rounds.mix(n).bloater).toBe(0);
    expect(rounds.mix(9).bloater).toBeCloseTo(1 / 12, 12);
    for (let n = 1; n <= 60; n++) {
      const m = rounds.mix(n);
      expect(m.walker + m.runner + m.armoured + m.bloater).toBeCloseTo(1, 12);
      expect(m.walker).toBeGreaterThanOrEqual(0.15 - 1e-12); // walkers never vanish
    }
    // where the floor binds the specials keep their proportions
    const m13 = rounds.mix(13);
    expect(m13.walker).toBeCloseTo(0.15, 12);
    expect(m13.runner / m13.armoured).toBeCloseTo(0.7 / 0.2, 9);
    expect(m13.armoured / m13.bloater).toBeCloseTo(0.2 / (1 / 12), 9);
    // below it nothing changes
    expect(rounds.mix(11).runner).toBeCloseTo(0.56, 12);
    expect(rounds.mix(11).walker).toBeCloseTo(1 - 0.56 - 0.18 - 1 / 12, 12);
  });
  it('a simulated round 25 spawns at least 15 % walkers', () => {
    const { world, director } = makeWorld();
    director.start(25);
    for (let i = 0; i < 60 * 900 && director.phase === 'active'; i++) { director.update(1 / 60); world.killAll(); }
    const reg = world.spawnCalls.filter((c) => c.type !== 'brute');
    expect(reg.filter((c) => c.type === 'walker').length / reg.length).toBeGreaterThan(0.12);
  });
  it('round 5 spawns round(0.6 x 26) = 16 plus one brute and ends only when the brute is dead', () => {
    const { world, director } = makeWorld();
    director.start(5);
    expect(world.log[0]).toEqual(['round:start', { n: 5, total: 17, boss: true }]);
    let brute = null;
    for (let i = 0; i < 60 * 120 && director.spawned < director.total; i++) {
      director.update(1 / 60);
      for (const id of [...world.live]) { if (world.types.get(id) === 'brute') brute = id; else world.kill(id); }
    }
    expect(director.spawned).toBe(17);
    expect(world.spawnCalls.filter((c) => c.type === 'brute').length).toBe(1);
    expect(world.spawnCalls.filter((c) => c.type !== 'brute').length).toBe(16);
    expect(brute).not.toBeNull();
    step(director, 30);
    expect(director.phase).toBe('active');
    world.kill(brute);
    director.update(1 / 60);
    expect(director.phase).toBe('lull');
  });
  it('types follow the schedule: none special before their round', () => {
    for (const n of [1, 3, 6, 8]) {
      const { world, director } = makeWorld();
      director.start(n);
      for (let i = 0; i < 60 * 200 && director.phase === 'active'; i++) { director.update(1 / 60); world.killAll(); }
      const seen = new Set(world.spawnCalls.map((c) => c.type));
      expect(seen.has('runner')).toBe(n >= 4);
      expect(seen.has('armoured')).toBe(n >= 7);
      expect(seen.has('bloater')).toBe(false);
      expect(seen.has('brute')).toBe(false);
      expect(seen.has('walker')).toBe(true);
    }
  });
  it('round 14 brings runners, armoured and bloaters; round 12 mostly runners', () => {
    const { world, director } = makeWorld();
    director.start(14);
    for (let i = 0; i < 60 * 600 && director.phase === 'active'; i++) { director.update(1 / 60); world.killAll(); }
    const count = (t) => world.spawnCalls.filter((c) => c.type === t).length;
    const N = world.spawnCalls.length;
    expect(N).toBe(rounds.total(14));
    expect(count('runner') / N).toBeGreaterThan(0.5);
    expect(count('armoured')).toBeGreaterThan(0);
    expect(count('bloater')).toBeGreaterThan(0);
  });
  it('never more than 2 bloaters (and never more than 24 zombies) alive in a simulated round 15', () => {
    const { world, director } = makeWorld();
    const rng = createRng(5);
    director.start(15);
    let maxB = 0, maxAll = 0, bloaters = 0;
    for (let i = 0; i < 60 * 900 && director.phase === 'active'; i++) {
      director.update(1 / 60);
      maxB = Math.max(maxB, world.alive('bloater'));
      maxAll = Math.max(maxAll, world.live.size);
      if (rng.next() < 0.02 && world.live.size) world.kill(rng.pick([...world.live]));
    }
    bloaters = world.spawnCalls.filter((c) => c.type === 'bloater').length;
    expect(bloaters).toBeGreaterThan(2);
    expect(maxB).toBeLessThanOrEqual(2);
    expect(maxAll).toBeLessThanOrEqual(24);
    expect(director.phase).toBe('lull');
  });
  it('exposes the type being spawned while it asks for the spawn (for a spawn callback that drops it)', () => {
    const seen = [];
    let director = null;
    director = createRoundDirector({ rng: createRng(2), spawnPoints: () => [{ pos: [0, 0, 0] }], spawn: (p, n, type) => { seen.push([type, director.pendingType]); return seen.length; } });
    director.start(5);
    for (let i = 0; i < 60 * 60; i++) director.update(1 / 60);
    expect(seen.length).toBe(17);
    for (const [a, b] of seen) expect(b).toBe(a);
    expect(director.pendingType).toBe(null);
  });
});

// ---- game state (state.js) with a fake G --------------------------------------------------------
// (tests that need a zombie on the first frame start at round 3: rounds 1 and 2 open with a grace)

function fakeG(params = {}, { withZombies = true } = {}) {
  const events = createEvents((e) => { throw e; });
  const calls = { clear: 0, fxClear: 0, playerReset: 0, weaponReset: 0 };
  let nextId = 1;
  const G = {
    params, events, rng: createRng(3),
    level: { spawnPoints: [{ pos: [0, 0, 0], kind: 'treeline' }], interactables: [] },
    zombies: withZombies
      ? { alive: 0, spawn: () => nextId++, clear: () => { calls.clear++; } }
      : { stub: true, alive: 0, update() {} },
    fx: { clear: () => { calls.fxClear++; } },
    player: { pos: [0, 0, 0], reset: () => { calls.playerReset++; } },
    weapon: { stub: true, reset: () => { calls.weaponReset++; } },
    input: { stub: true },
  };
  const seen = [];
  for (const name of ['game:state', 'round:start', 'round:end', 'points:add', 'buy']) {
    events.on(name, (p) => seen.push([name, p]));
  }
  return { G, calls, seen };
}

describe('game state', () => {
  let saved;
  beforeEach(() => {
    saved = globalThis.window;
    const mem = new Map();
    globalThis.window = { localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) } };
  });
  afterEach(() => { globalThis.window = saved; });

  it('starts on the title and does nothing until start()', () => {
    const { G } = fakeG();
    const game = createGame(G);
    game.update(1);
    expect(game.state).toBe('title');
    expect(game.round).toBe(0);
    expect(game.points).toBe(500);
  });

  it('autostart=1 starts play on the first update; round=<n> picks the round', () => {
    const { G, seen } = fakeG({ autostart: true, round: 7 });
    const game = createGame(G);
    game.update(1 / 60);
    expect(game.state).toBe('playing');
    expect(game.round).toBe(7);
    expect(seen).toContainEqual(['game:state', { state: 'playing' }]);
    expect(seen).toContainEqual(['round:start', { n: 7, total: 34, boss: false }]);
  });

  it('does not throw with stub zombies and no spawn points; round simply waits', () => {
    const { G } = fakeG({ autostart: true }, { withZombies: false });
    G.level = { stub: true, spawnPoints: [], interactables: [] };
    const game = createGame(G);
    expect(() => { for (let i = 0; i < 600; i++) game.update(1 / 60); }).not.toThrow();
    expect(game.state).toBe('playing');
    expect(game.round).toBe(1);
  });

  it('points from hit:zombie events: 10 hit, 60 kill, 100 headshot kill', () => {
    const { G, seen } = fakeG({ autostart: true });
    const game = createGame(G);
    game.update(0);
    G.events.emit('hit:zombie', { id: 1, part: 'torso', damage: 40, killed: false });
    expect(game.points).toBe(510);
    G.events.emit('hit:zombie', { id: 1, part: 'torso', damage: 40, killed: true });
    expect(game.points).toBe(570);
    G.events.emit('hit:zombie', { id: 2, part: 'head', damage: 120, killed: true });
    expect(game.points).toBe(670);
    expect(seen.filter(([e]) => e === 'points:add').map(([, p]) => p.amount)).toEqual([10, 60, 100]);
  });

  it('zombie:die counts kills', () => {
    const { G } = fakeG({ autostart: true });
    const game = createGame(G);
    game.update(0);
    G.events.emit('zombie:die', { id: 1, pos: [0, 0, 0], headshot: false });
    expect(game.kills).toBe(1);
  });

  it('a bloater that bursts by itself counts toward the round but drops no power-up', () => {
    const run = (cause) => {
      const { G } = fakeG({ autostart: true, round: 3 });
      const drops = [];
      G.events.on('powerup:drop', (p) => drops.push(p));
      const game = createGame(G);
      game.update(0);
      expect(game.director.alive).toBe(1);
      const first = 1; // the zombie the round spawned first
      G.events.emit('zombie:die', cause ? { id: first, pos: [0, 0, 0], headshot: false, type: 'bloater', cause } : { id: first, pos: [0, 0, 0], headshot: false, type: 'bloater' });
      expect(game.director.alive).toBe(0); // counted toward the round either way
      // enough deaths that a 3 % drop chance is certain to come up for ordinary kills
      for (let k = 0; k < 300; k++) {
        G.events.emit('zombie:die', cause ? { id: 1000 + k, pos: [0, 0, 0], headshot: false, type: 'bloater', cause } : { id: 1000 + k, pos: [0, 0, 0], headshot: false, type: 'bloater' });
      }
      return { drops: drops.length, points: game.points };
    };
    const killed = run(null), burst = run('burst');
    expect(killed.drops).toBeGreaterThan(0);
    expect(burst.drops).toBe(0);
    expect(burst.points).toBe(500); // nothing paid
  });

  it('pause freezes rounds and spawns; resume continues', () => {
    const { G } = fakeG({ autostart: true, round: 3 });
    const game = createGame(G);
    game.update(0);
    const spawned = game.director.spawned;
    game.pause();
    expect(game.state).toBe('paused');
    for (let i = 0; i < 600; i++) game.update(1 / 60);
    expect(game.director.spawned).toBe(spawned);
    game.resume();
    expect(game.state).toBe('playing');
    for (let i = 0; i < 300; i++) game.update(1 / 60);
    expect(game.director.spawned).toBeGreaterThan(spawned);
  });

  it('player:dead -> dead, best round saved; restart resets round and points and clears', () => {
    const { G, calls, seen } = fakeG({ autostart: true, round: 4 });
    const game = createGame(G);
    game.update(0);
    G.events.emit('hit:zombie', { id: 1, part: 'torso', killed: false });
    G.events.emit('player:dead');
    expect(game.state).toBe('dead');
    expect(seen).toContainEqual(['game:state', { state: 'dead' }]);
    expect(game.best).toBe(4);
    expect(window.localStorage.getItem('graveyard-shift.bestRound')).toBe('4');
    // A new game reads the saved best.
    expect(createGame(fakeG().G).best).toBe(4);
    game.restart();
    expect(game.state).toBe('playing');
    expect(game.round).toBe(1); // round=<n> only sets the first start
    expect(game.points).toBe(500);
    expect(game.kills).toBe(0);
    expect(calls.clear).toBe(1);
    expect(calls.fxClear).toBe(1);
    expect(calls.playerReset).toBe(1);
    expect(calls.weaponReset).toBe(1);
  });

  it('die -> retry with the real weapon: full pistol, round 1, 500 points, whatever was spent', () => {
    const { G } = fakeG({ autostart: true, round: 3 });
    const warn = console.warn; console.warn = () => {};
    G.player = { eye: [0, 1.7, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true, alive: true, pos: [0, 0, 0], reset() {} };
    G.time = { t: 0 };
    const pressed = new Set();
    G.input = { pressed: (n) => pressed.has(n) };
    const game = createGame(G);
    G.game = game;
    const weapon = createWeapon(G, { createView: () => null });
    console.warn = warn;
    G.weapon = weapon;
    game.update(0);
    for (let i = 0; i < 12; i++) { pressed.add('fire'); weapon.update(1 / 60); pressed.clear(); for (let k = 0; k < 12; k++) weapon.update(1 / 60); }
    pressed.add('reload'); weapon.update(1 / 60); pressed.clear(); // dies mid-reload
    for (let k = 0; k < 20; k++) weapon.update(1 / 60);
    expect(weapon.ammo.mag).toBe(0);
    expect(weapon.reloading).toBe(true);
    game.economy.spend(250);
    G.events.emit('player:dead');
    expect(game.state).toBe('dead');
    game.restart();
    expect(game.state).toBe('playing');
    expect(weapon.ammo.mag).toBe(12);
    expect(weapon.ammo.reserve).toBe(48);
    expect(weapon.reloading).toBe(false);
    expect(game.round).toBe(1);
    expect(game.points).toBe(500);
  });

  it('a pause in the middle of a reload does not cancel it', () => {
    const { G } = fakeG({ autostart: true });
    const warn = console.warn; console.warn = () => {};
    G.player = { eye: [0, 1.7, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true, alive: true, pos: [0, 0, 0], reset() {} };
    G.time = { t: 0 };
    const pressed = new Set();
    G.input = { pressed: (n) => pressed.has(n) };
    const game = createGame(G);
    G.game = game;
    const weapon = createWeapon(G, { createView: () => null });
    console.warn = warn;
    G.weapon = weapon;
    game.update(0);
    pressed.add('fire'); weapon.update(1 / 60); pressed.clear();
    for (let k = 0; k < 12; k++) weapon.update(1 / 60);
    pressed.add('reload'); weapon.update(1 / 60); pressed.clear();
    for (let k = 0; k < 10; k++) weapon.update(1 / 60);
    expect(weapon.reloading).toBe(true);
    const at = weapon.state.reloadT;
    game.pause();
    for (let k = 0; k < 30; k++) weapon.update(0); // the loop still ticks, with no time passing
    expect(weapon.reloading).toBe(true);
    expect(weapon.state.reloadT).toBe(at);
    game.resume();
    for (let k = 0; k < 120; k++) weapon.update(1 / 60);
    expect(weapon.reloading).toBe(false);
    expect(weapon.ammo.mag).toBe(12);
  });

  it('newBest: not on a first-ever death before round 3; yes from round 3, or when a stored best is beaten', () => {
    const die = (round) => { const f = fakeG({ autostart: true, round }); const g = createGame(f.G); g.update(0); f.G.events.emit('player:dead'); return g; };
    const first = die(1); // nothing stored yet: round 1 is no record
    expect(first.newBest).toBe(false);
    expect(first.best).toBe(1); // still remembered
    expect(die(2).newBest).toBe(true); // beats the stored 1
    window.localStorage.setItem('graveyard-shift.bestRound', '0');
    expect(die(2).newBest).toBe(false); // first-ever, round 2
    window.localStorage.setItem('graveyard-shift.bestRound', '0');
    expect(die(3).newBest).toBe(true); // first-ever, but round 3
  });

  it('newBest is set when the record is beaten, not when it is equalled', () => {
    const a = fakeG({ autostart: true, round: 4 });
    const g1 = createGame(a.G);
    g1.update(0);
    a.G.events.emit('player:dead');
    expect(g1.newBest).toBe(true);
    const b = fakeG({ autostart: true, round: 4 }); // dies on round 4 again: a tie
    const g2 = createGame(b.G);
    g2.update(0);
    b.G.events.emit('player:dead');
    expect(g2.best).toBe(4);
    expect(g2.newBest).toBe(false);
  });

  it('zombie:remove is not a kill and the director replaces the zombie', () => {
    const { G } = fakeG({ autostart: true, round: 3 });
    const game = createGame(G);
    game.update(0);
    expect(game.director.alive).toBe(1);
    G.events.emit('zombie:remove', { id: 1 });
    expect(game.kills).toBe(0);
    expect(game.director.alive).toBe(0);
    expect(game.director.spawned).toBe(0);
    game.update(1.9); // replacement comes at the normal spawn pace
    expect(game.director.spawned).toBe(1);
  });

  it('ids missing from G.zombies.list are dropped during update', () => {
    const { G } = fakeG({ autostart: true, round: 3 });
    let nextId = 1;
    G.zombies.list = [];
    G.zombies.spawn = () => { const id = nextId++; G.zombies.list.push({ id }); return id; };
    const game = createGame(G);
    for (let i = 0; i < 240; i++) game.update(1 / 60); // ~3 spawned
    const before = game.director.alive;
    expect(before).toBeGreaterThan(1);
    const spawnedBefore = game.director.spawned;
    G.zombies.list.shift(); // removed silently
    game.update(0);
    expect(game.director.alive).toBe(before - 1);
    expect(game.director.spawned).toBe(spawnedBefore - 1); // owed again, so it will be replaced
    expect(game.kills).toBe(0);
  });

  it('best round only increases', () => {
    const { G } = fakeG({ autostart: true, round: 2 });
    window.localStorage.setItem('graveyard-shift.bestRound', '9');
    const game = createGame(G);
    game.update(0);
    G.events.emit('player:dead');
    expect(game.best).toBe(9);
    expect(window.localStorage.getItem('graveyard-shift.bestRound')).toBe('9');
  });
});
