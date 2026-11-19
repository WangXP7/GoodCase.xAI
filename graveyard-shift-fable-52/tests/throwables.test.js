import { describe, it, expect } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { createWeapon, arcChain } from '../src/weapon/firing.js';
import { createThrowables, falloffDamage, blastDamage, poolTotal } from '../src/weapon/throwables.js';
import { meleeTargets } from '../src/weapon/melee.js';
import { tuning } from '../src/game/tuning.js';

const DT = 1 / 60;
const TW = tuning.weapons.throwables;

function mockG() {
  const events = createEvents();
  const log = [];
  for (const n of ['throw', 'explosion', 'fire:pool', 'weapon:melee', 'hit:zombie', 'weapon:fire']) events.on(n, (p) => log.push([n, p, null]));
  const pressed = new Set();
  const damaged = [];
  const playerHits = [];
  const lures = [];
  const G = {
    params: {}, events, rng: createRng(1), time: { t: 0, sim: 0 },
    input: { pressed: (n) => pressed.has(n), ads: false, fire: false },
    player: {
      eye: [0, 1.7, 0], forward: [0, 0, -1], pos: [0, 0, 0], vel: [0, 0, 0], onGround: true, sprinting: false, alive: true,
      damage: (amount, dir) => playerHits.push(amount),
    },
    game: { state: 'playing' },
    zombies: {
      list: [],
      raycast: () => null,
      damage: (id, amount, part) => { damaged.push({ id, amount, part }); return { killed: false, damage: amount }; },
      setLure: (pos, seconds, radius) => lures.push({ pos, seconds, radius }),
    },
    level: { raycast: () => null },
  };
  return { G, log, pressed, damaged, playerHits, lures };
}

function setup() {
  const m = mockG();
  const w = createWeapon(m.G, { createView: () => null });
  m.G.weapon = w;
  // a clock the log can be stamped with
  let t = 0;
  const step = (secs) => {
    for (let i = 0, n = Math.round(secs / DT); i < n; i++) {
      t += DT; m.G.time.sim = t; w.update(DT);
      for (const l of m.log) if (l[2] === null) l[2] = t;
    }
  };
  return { ...m, w, step, now: () => t };
}

const zombie = (id, x, z) => ({ id, pos: { x, y: 0, z }, health: 1000, alive: true });

describe('frag', () => {
  it('lands and explodes 2.5 s of sim time after the throw', () => {
    const s = setup();
    s.w.addThrowable('frag');
    expect(s.w.throw()).toBe(true);
    for (const l of s.log) if (l[2] === null) l[2] = 0;
    const thrown = s.log.find((l) => l[0] === 'throw');
    expect(thrown[1].kind).toBe('frag');
    expect(thrown[1].vel.z).toBeLessThan(-12); // 14 m/s at 12 degrees up, forward
    expect(thrown[1].vel.y).toBeGreaterThan(2);
    expect(s.w.throwables.frag).toBe(0);
    expect(s.w.throw()).toBe(false); // none left
    s.step(2.4);
    expect(s.log.find((l) => l[0] === 'explosion')).toBeUndefined();
    s.step(0.2);
    const ex = s.log.find((l) => l[0] === 'explosion');
    expect(ex[1]).toMatchObject({ kind: 'frag', radius: 5, damage: 900 });
    expect(ex[2]).toBeCloseTo(2.5, 1);
    expect(ex[1].pos.y).toBeLessThan(0.3); // it came to rest on the ground
    expect(ex[1].pos.z).toBeLessThan(-5);
  });

  it('damage at 2.5 m is half the centre\'s; the player takes a quarter', () => {
    expect(falloffDamage(0, 900, 5)).toBe(900);
    expect(falloffDamage(2.5, 900, 5)).toBe(450);
    expect(falloffDamage(5, 900, 5)).toBe(0);
    expect(falloffDamage(7, 900, 5)).toBe(0);
    const m = mockG();
    m.G.zombies.list.push(zombie(1, 0, -10), zombie(2, 2.5, -10), zombie(3, 6, -10));
    m.G.player.pos = [0, 0, -8];
    const t = createThrowables(m.G, { emit: (n, p) => m.G.events.emit(n, p) });
    t.explode({ x: 0, y: 0.05, z: -10 }, 'frag');
    expect(m.damaged.map((d) => [d.id, Math.round(d.amount)])).toEqual([[1, 900], [2, 450]]);
    expect(m.playerHits).toHaveLength(1);
    expect(m.playerHits[0]).toBeCloseTo(900 * (1 - 2 / 5) * 0.25);
    const hz = m.log.filter((l) => l[0] === 'hit:zombie').map((l) => l[1]);
    expect(hz.map((h) => h.id)).toEqual([1, 2]);
  });

  it('a wall between the blast and a zombie shelters it', () => {
    const m = mockG();
    m.G.zombies.list.push(zombie(1, 0, -12));
    m.G.level.raycast = (o, d, max) => (max > 1 ? { dist: 1, pos: [0, 0.5, -11], normal: [0, 0, 1] } : null);
    const t = createThrowables(m.G, { emit: (n, p) => m.G.events.emit(n, p) });
    t.explode({ x: 0, y: 0.05, z: -10 }, 'frag');
    expect(m.damaged).toEqual([]);
  });
});

describe('molotov', () => {
  it('a pool ticks 120 a second on a zombie inside 2.8 m for 8 s, and not outside', () => {
    const s = setup();
    s.w.addThrowable('molotov');
    s.w.throwable = 'molotov';
    s.w.throw();
    s.step(2);
    const pool = s.log.find((l) => l[0] === 'fire:pool');
    expect(pool).toBeTruthy();
    expect(pool[1]).toMatchObject({ radius: 2.8, seconds: 8 });
    const p = pool[1].pos;
    s.G.zombies.list.push(zombie(1, p.x + 2, p.z), zombie(2, p.x + 3.5, p.z));
    s.step(10);
    const total = (id) => s.damaged.filter((d) => d.id === id).reduce((a, d) => a + d.amount, 0);
    expect(total(1)).toBeGreaterThan(120 * 6); // the zombie arrived after the pool started
    expect(total(1)).toBeLessThanOrEqual(960);
    expect(total(2)).toBe(0);
  });

  it('a full pool deals exactly 120 x 8 and burns the player at 15 a second', () => {
    const m = mockG();
    m.G.zombies.list.push(zombie(1, 1, -5));
    m.G.player.pos = [0, 0, -4];
    const t = createThrowables(m.G, { emit: (n, p) => m.G.events.emit(n, p) });
    t.addPool({ x: 0, y: 0, z: -5 }, 'molotov');
    for (let i = 0; i < 9 * 60; i++) t.update(DT);
    const total = m.damaged.reduce((a, d) => a + d.amount, 0);
    expect(total).toBeCloseTo(960, 6);
    expect(m.playerHits.reduce((a, v) => a + v, 0)).toBeCloseTo(15 * 8, 6);
    expect(t.pools).toBe(0);
  });
});

describe('decoy', () => {
  it('lures G.zombies to it, then bursts 8 s later', () => {
    const s = setup();
    s.w.addThrowable('decoy');
    s.w.throwable = 'decoy';
    s.w.throw();
    s.step(3);
    expect(s.lures).toHaveLength(1);
    expect(s.lures[0]).toMatchObject({ seconds: 8, radius: 25 });
    const lureAt = s.now();
    const landed = s.lures[0].pos;
    s.G.zombies.list.push(zombie(7, landed.x + 1, landed.z), zombie(8, landed.x + 4, landed.z));
    s.step(8.5);
    const ex = s.log.find((l) => l[0] === 'explosion');
    expect(ex[1]).toMatchObject({ kind: 'decoy', radius: 3, damage: 300 });
    expect(ex[2] - lureAt).toBeGreaterThan(8 - 3);
    expect(ex[2] - lureAt).toBeLessThanOrEqual(8 + 0.05);
    expect(s.damaged).toEqual([{ id: 7, amount: 300, part: 'torso' }]);
  });
});

describe('carry limits', () => {
  it('counts never exceed the carry limits, and a throw spends one', () => {
    const s = setup();
    for (const k of TW.kinds) {
      s.w.addThrowable(k, 99);
      expect(s.w.throwables[k]).toBe(TW[k].carry);
      s.w.addThrowable(k);
      expect(s.w.throwables[k]).toBe(TW[k].carry);
    }
    s.w.throw();
    expect(s.w.throwables.frag).toBe(2);
    expect(s.w.throw()).toBe(false); // cooldown
    s.step(TW.cooldown + 0.05);
    expect(s.w.throw()).toBe(true);
    expect(s.w.throwables.frag).toBe(1);
  });

  it('the throw input throws the selected kind', () => {
    const s = setup();
    s.w.addThrowable('frag');
    s.pressed.add('throw'); s.step(DT); s.pressed.clear();
    expect(s.log.filter((l) => l[0] === 'throw')).toHaveLength(1);
  });
});

describe('melee', () => {
  it('a swing with nothing in reach emits weapon:melee {hit:false}', () => {
    const s = setup();
    s.G.zombies.list.push(zombie(1, 0, -3)); // out of the knife's reach
    s.G.zombies.list.push(zombie(2, 0, 1)); // behind
    expect(s.w.swing()).toBe(true);
    const e = s.log.find((l) => l[0] === 'weapon:melee');
    expect(e[1]).toMatchObject({ hit: false, kind: 'knife' });
    expect(s.damaged).toEqual([]);
  });

  it('the knife hits one zombie in front for 150; the axe two for 600; a swing blocks the next for its time', () => {
    const s = setup();
    s.G.zombies.list.push(zombie(1, 0.2, -1.2), zombie(2, -0.3, -1.5), zombie(3, 0, -1.4));
    s.w.swing();
    expect(s.damaged).toEqual([{ id: 1, amount: 150, part: 'torso' }]);
    expect(s.log.find((l) => l[0] === 'weapon:melee')[1]).toMatchObject({ hit: true, id: 1, kind: 'knife' });
    expect(s.log.find((l) => l[0] === 'hit:zombie')[1]).toMatchObject({ id: 1, damage: 150, source: 'melee', weapon: 'knife' });
    expect(s.w.swing()).toBe(false);
    s.step(0.72);
    s.w.setMelee('axe');
    s.damaged.length = 0;
    s.w.swing();
    expect(s.damaged.map((d) => [d.id, d.amount])).toEqual([[1, 600], [3, 600]]);
  });

  it('a swing cancels a reload without granting ammo; the melee input swings', () => {
    const s = setup();
    s.w.state.mag = 3;
    s.w.reload();
    s.step(0.5);
    s.pressed.add('melee'); s.step(DT); s.pressed.clear();
    expect(s.log.filter((l) => l[0] === 'weapon:melee')).toHaveLength(1);
    expect(s.w.reloading).toBe(false);
    s.step(3);
    expect(s.w.ammo).toMatchObject({ mag: 3, reserve: 48 });
  });

  it('does not reach a zombie on another floor', () => {
    const up = { id: 5, pos: { x: 0, y: 3, z: -1 }, alive: true };
    const out = [];
    meleeTargets([0, 1.7, 0], [0, 0, -1], [up], { reach: 1.6, hits: 1, cone: 0.6 }, out);
    expect(out).toEqual([]);
  });

  it('meleeTargets is pure: nearest first, within reach and cone, at most `hits`', () => {
    const list = [zombie(1, 0, -1.8), zombie(2, 0, -1.0), zombie(3, 1.5, 0), zombie(4, 0, -1.5)];
    const out = [];
    meleeTargets([0, 1.7, 0], [0, 0, -1], list, { reach: 1.6, hits: 2, cone: 0.6 }, out);
    expect(out.map((r) => r.id)).toEqual([2, 4]);
    meleeTargets([0, 1.7, 0], [0, 0, -1], [], { reach: 1.6, hits: 2, cone: 0.6 }, out);
    expect(out).toEqual([]);
  });
});

describe('the Jumper', () => {
  it('arcChain hits at most 5 zombies and never the same one twice', () => {
    const list = [];
    for (let i = 0; i < 10; i++) list.push(zombie(i + 1, i * 3, -10));
    const ids = arcChain(list[0], list, 4, 5, []).map((r) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    // a tight cluster: still five distinct
    const cl = [];
    for (let i = 0; i < 9; i++) cl.push(zombie(i + 1, (i % 3) * 0.5, -10 - Math.floor(i / 3) * 0.5));
    const c = arcChain(cl[4], cl, 4, 5, []).map((r) => r.id);
    expect(c).toHaveLength(5);
    expect(new Set(c).size).toBe(5);
    expect(c[0]).toBe(5);
    // a gap over 5 m ends the chain
    const gap = [zombie(1, 0, 0), zombie(2, 4, 0), zombie(3, 10, 0)];
    expect(arcChain(gap[0], gap, 4, 5, []).map((r) => r.id)).toEqual([1, 2]);
  });

  it('a Jumper shot damages the first zombie in full and the arcs at 0.6x', () => {
    const s = setup();
    for (let i = 0; i < 8; i++) s.G.zombies.list.push(zombie(i + 1, i * 2, -10));
    s.G.zombies.raycast = () => ({ id: 1, part: 'torso', pos: [0, 1.2, -10], dist: 10 });
    s.w.give('jumper');
    s.step(1);
    s.w.fire();
    expect(s.damaged.map((d) => d.id)).toEqual([1, 2, 3, 4, 5]);
    expect(s.damaged.map((d) => d.amount)).toEqual([600, 360, 360, 360, 360]);
    const arc = s.log.filter((l) => l[0] === 'hit:zombie').map((l) => l[1].source);
    expect(arc).toEqual(['bullet', 'arc', 'arc', 'arc', 'arc']);
  });
});

describe('the Roadflare', () => {
  // a zombie standing across the line of fire at z = zz
  const wall = (zz, id = 1) => (o, d, max) => {
    if (!(d[2] < 0) || o[2] <= zz) return null;
    const dist = (o[2] - zz) / -d[2];
    return dist <= max ? { id, part: 'torso', pos: [o[0] + d[0] * dist, o[1] + d[1] * dist, zz], dist } : null;
  };

  it('is a lobbed shot: flare:launch with its velocity, a direct hit for 200, a 3 m pool where it bursts', () => {
    const s = setup();
    s.G.zombies.raycast = wall(-10);
    const seen = [];
    for (const n of ['flare:launch', 'flare:burst']) s.G.events.on(n, (p) => seen.push([n, p]));
    s.w.give('flare');
    s.step(1);
    s.w.fire();
    expect(s.damaged).toEqual([]); // nothing is hit at the moment of firing
    expect(s.log.find((l) => l[0] === 'weapon:fire')[1]).toMatchObject({ weapon: 'flare' });
    const launch = seen.find((e) => e[0] === 'flare:launch')[1];
    expect(launch.vel.z).toBeLessThan(-40);
    expect(launch.gravity).toBeGreaterThan(0);
    expect(launch.gravity).toBeLessThan(9.81);
    s.step(1);
    expect(s.damaged[0]).toMatchObject({ id: 1, amount: 200 });
    const burst = seen.find((e) => e[0] === 'flare:burst')[1];
    expect(burst).toMatchObject({ id: launch.id, hit: true });
    const pool = s.log.find((l) => l[0] === 'fire:pool');
    expect(pool[1]).toMatchObject({ radius: 3, seconds: 6, kind: 'flare' });
    expect(pool[1].pos.y).toBe(0);
    expect(pool[1].pos.z).toBeCloseTo(-10, 0);
  });

  it('with nothing in the way it arcs down and burns where it lands', () => {
    const s = setup();
    s.w.give('flare');
    s.step(1);
    s.w.fire();
    s.step(4);
    const pool = s.log.find((l) => l[0] === 'fire:pool');
    expect(pool).toBeTruthy();
    expect(pool[1].pos.z).toBeLessThan(-20); // a long, flat arc
    expect(s.damaged).toEqual([]);
  });
});

describe('molotov and thrown-item edge cases', () => {
  it('a flying molotov breaks on a zombie in its path', () => {
    const s = setup();
    s.G.zombies.raycast = (o, d, max) => {
      if (!(d[2] < 0) || o[2] <= -5) return null;
      const dist = (o[2] + 5) / -d[2];
      return dist <= max ? { id: 4, part: 'torso', pos: [0, 1, -5], dist } : null;
    };
    s.w.addThrowable('molotov');
    s.w.throwable = 'molotov';
    s.w.throw();
    s.step(1);
    const pool = s.log.find((l) => l[0] === 'fire:pool');
    expect(pool[1].pos.z).toBeCloseTo(-5, 0);
  });

  it('a pool burns at the height it landed on (an upper walkway), not the floor below', () => {
    const m = mockG();
    // the walkway's top at y = 3 under the burst
    m.G.level.raycast = (o, d, max) => (d[1] < -0.9 && o[1] > 3 ? { dist: o[1] - 3, pos: [o[0], 3, o[2]], normal: [0, 1, 0] } : null);
    m.G.zombies.list.push({ id: 1, pos: { x: 0, y: 3, z: -5 }, alive: true }, { id: 2, pos: { x: 0, y: 0, z: -5 }, alive: true });
    const t = createThrowables(m.G, { emit: (n, p) => m.G.events.emit(n, p) });
    t.addPool({ x: 0, y: 3.06, z: -5 }, 'molotov');
    expect(m.log.find((l) => l[0] === 'fire:pool')[1].pos.y).toBeCloseTo(3);
    for (let i = 0; i < 60; i++) t.update(DT);
    expect(new Set(m.damaged.map((d) => d.id))).toEqual(new Set([1]));
    // with no floor found, the level's height
    const n = mockG();
    n.G.level.heightAt = () => 0.4;
    const u = createThrowables(n.G, { emit: (k, p) => n.G.events.emit(k, p) });
    u.addPool({ x: 0, y: 2, z: 0 }, 'molotov');
    expect(n.log.find((l) => l[0] === 'fire:pool')[1].pos.y).toBeCloseTo(0.4);
  });

  it('when one decoy bursts, zombies go to another decoy still calling', () => {
    const s = setup();
    s.w.addThrowable('decoy', 2);
    s.w.throwable = 'decoy';
    s.w.throw();
    s.step(1);
    s.w.throw();
    s.step(10); // the first lands about 2.4 s after its throw and bursts 8 s later
    expect(s.log.filter((l) => l[0] === 'explosion')).toHaveLength(1);
    // first decoy burst: the lure moves to the second, not to null
    const afterFirst = s.lures.slice(2);
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(afterFirst[0].pos).toBeTruthy();
    s.step(3);
    expect(s.lures[s.lures.length - 1].pos).toBe(null);
  });

  it('frag and molotov damage scale with the round: 1, 10 and 20', () => {
    const h = tuning.walker.health;
    expect(blastDamage(1)).toBe(900);
    expect(blastDamage(10)).toBeCloseTo(Math.max(900, 1.2 * h(10)));
    expect(blastDamage(20)).toBeCloseTo(1.2 * h(20));
    expect(poolTotal(1)).toBe(960);
    expect(poolTotal(10)).toBeCloseTo(Math.max(960, h(10)));
    expect(poolTotal(20)).toBeCloseTo(h(20));
    // read from G.game.round
    const m = mockG();
    m.G.game.round = 20;
    m.G.zombies.list.push(zombie(1, 0, -5));
    const t = createThrowables(m.G, { emit: (n, p) => m.G.events.emit(n, p) });
    t.explode({ x: 0, y: 0, z: -5 }, 'frag');
    expect(m.log.find((l) => l[0] === 'explosion')[1].damage).toBeCloseTo(blastDamage(20));
    expect(m.damaged[0].amount).toBeCloseTo(blastDamage(20));
    m.damaged.length = 0;
    t.addPool({ x: 0, y: 0, z: -5 }, 'molotov');
    for (let i = 0; i < 9 * 60; i++) t.update(DT);
    expect(m.damaged.reduce((a, d) => a + d.amount, 0)).toBeCloseTo(h(20), 6);
  });

  it('update(0) with slot, melee and throw presses and throwables in flight changes nothing', () => {
    const s = setup();
    s.w.give('smg');
    s.step(1);
    s.w.switchTo(0);
    s.step(1);
    s.w.addThrowable('frag', 2);
    s.w.throw();
    s.step(0.9); // past the throw's cooldown, which also holds off a reload
    s.w.state.mag = 3;
    s.w.reload();
    expect(s.w.reloading).toBe(true);
    s.step(0.3);
    const before = s.log.length;
    s.pressed.add('slot2'); s.pressed.add('melee'); s.pressed.add('throw'); s.pressed.add('swap'); s.pressed.add('cycle');
    for (let i = 0; i < 600; i++) s.w.update(0);
    s.pressed.clear();
    expect(s.w.slot).toBe(0);
    expect(s.w.reloading).toBe(true);
    expect(s.w.throwables.frag).toBe(1);
    expect(s.log.length).toBe(before); // no melee, no throw, no explosion
    s.step(1.0); // the fuse runs on sim time only: 1.2 s before the pause, 2.2 s now
    expect(s.log.find((l) => l[0] === 'explosion')).toBeUndefined();
    s.step(0.4);
    expect(s.log.find((l) => l[0] === 'explosion')).toBeTruthy();
    expect(s.w.ammo.mag).toBe(12); // the reload went on and finished
  });
});
