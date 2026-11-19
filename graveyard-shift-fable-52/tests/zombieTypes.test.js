// Zombie types: runner, armoured, bloater, brute; limb loss and crawlers; decoy lures.
// Like zombieAi.test.js, the real body, animator and test stage are replaced by a stub body and the
// ghost animator, so these run whatever state the body task's files are in.
import { describe, it, expect, vi } from 'vitest';
import { createZombies } from '../src/zombie/manager.js';
import { createGhostAnimator } from '../src/zombie/ai.js';
import { partScale, attackDamage, animState, poolPlan, explosionLimbs, typeDef } from '../src/zombie/types.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { tuning } from '../src/game/tuning.js';

vi.mock('../src/zombie/body.js', () => ({ buildZombie: () => { throw new Error('real body not used in tests'); } }));
vi.mock('../src/zombie/anim.js', () => ({ createAnimator: () => { throw new Error('real animator not used in tests'); } }));
vi.mock('../src/zombie/zombietest.js', () => ({ installZombieTest: () => ({ update() {} }) }));

const DT = 1 / 60;
const T = tuning.zombies;

function stubBody(seed, G, opts = {}) {
  const mesh = { visible: true, position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: { y: 0 } };
  const severed = new Set();
  return {
    seed, opts, mesh, skeleton: { bones: [] }, severed,
    setBlood() {}, getBlood: () => 0, setLod() {}, setWet() {},
    sever(part) { if (severed.has(part)) return false; severed.add(part); return true; },
    raycast: () => null,
  };
}

function setup({ player = [0, 0, 0], round = 1, seed = 1 } = {}) {
  const events = createEvents((e) => { throw e; });
  const anims = [];
  const built = [];
  const G = {
    params: {}, rng: createRng(seed), events,
    time: { t: 0, sim: 0, dt: 0, frame: 0 },
    scene: { add() {} }, camera: null,
    level: { colliders: [], spawnPoints: [], raycast: () => null },
    nav: null,
    player: { pos: player.slice(), alive: true, damage: vi.fn(() => true) },
    game: { state: 'playing', round },
  };
  const log = [];
  for (const n of ['zombie:spawn', 'zombie:attack', 'zombie:die', 'zombie:sever', 'zombie:burst', 'zombie:remove']) events.on(n, (p) => log.push([n, p, G.time.t]));
  const Z = createZombies(G, { build: (s, g, o) => { const b = stubBody(s, g, o); built.push(b); return b; }, animate: () => { const a = createGhostAnimator(); anims.push(a); return a; } });
  G.zombies = Z;
  const step = (n = 1) => { for (let k = 0; k < n; k++) { G.time.t += DT; G.time.sim += DT; Z.update(DT); } };
  return { G, Z, log, step, anims, built };
}
const rec = (Z, id) => Z.list.find((r) => r.id === id);
const flat = (r, p) => Math.hypot(r.pos.x - p[0], r.pos.z - p[2]);
const events = (log, name) => log.filter(([n]) => n === name);

describe('types: table and helpers', () => {
  it('every type has a row; zombie:spawn carries the type', () => {
    for (const t of ['walker', 'runner', 'armoured', 'bloater', 'brute']) expect(typeDef(t)).toBe(T.types[t]);
    const { Z, log } = setup();
    const id = Z.spawn([0, 0, 10], { exact: true, type: 'runner' });
    expect(rec(Z, id).type).toBe('runner');
    expect(events(log, 'zombie:spawn')[0][1]).toMatchObject({ id, type: 'runner' });
  });
  it('health is the round walker health times the type factor', () => {
    const { Z } = setup({ round: 10 });
    const h = Math.round(tuning.walker.health(10));
    const want = { walker: 1, runner: 0.85, armoured: 1.2, bloater: 2, brute: 8 }; // the brute is 8x at round 10
    for (const [t, k] of Object.entries(want)) {
      const id = Z.spawn([Object.keys(want).indexOf(t) * 3, 0, 10], { exact: true, type: t });
      expect(rec(Z, id).health).toBe(Math.round(h * k));
      expect(rec(Z, id).maxHealth).toBe(Math.round(h * k));
    }
    // health given by the director is the round's walker health; the type still scales it
    const id = Z.spawn([20, 0, 10], { exact: true, type: 'brute', health: 100, round: 5 });
    expect(rec(Z, id).health).toBe(1200);
    // the brute's multiple falls with the round: 12x at 5, 10x at 7.5 (linear), 8x at 10, 6x from 15
    for (const [n, k] of [[5, 12], [10, 8], [12, 7.2], [15, 6], [25, 6]]) {
      const b = Z.spawn([24 + n, 0, 10], { exact: true, type: 'brute', health: 1000, round: n });
      expect(rec(Z, b).maxHealth).toBe(Math.round(1000 * k));
      Z.damage(b, 1e9, 'torso');
    }
  });
  it('records carry layer, crawling and limbs', () => {
    const { Z } = setup();
    const r = rec(Z, Z.spawn([0, 0, 10], { exact: true }));
    expect(r).toMatchObject({ type: 'walker', layer: 0, crawling: false, limbs: { head: true, armL: true, armR: true, legL: true, legR: true } });
  });
  it('animator states fall back to walk, attack or climb when the animator does not list them', () => {
    const old = { set() {} };
    expect(animState(old, 'run')).toBe('walk');
    expect(animState(old, 'crawl')).toBe('walk');
    expect(animState(old, 'slam')).toBe('attack');
    expect(animState(old, 'tear')).toBe('attack');
    expect(animState(old, 'window')).toBe('climb');
    expect(animState(old, 'burst')).toBe('attack');
    expect(animState(old, 'walk')).toBe('walk');
    const neu = { states: ['idle', 'walk', 'run', 'crawl', 'attack', 'slam', 'stagger', 'climb', 'window', 'tear', 'burst', 'dead'] };
    for (const s of ['run', 'crawl', 'slam', 'window', 'tear', 'burst']) expect(animState(neu, s)).toBe(s);
  });
  it('the pool keeps at least 3 brute and 2 bloated bodies and builds them as the body builder names them', () => {
    const plan = poolPlan(36, (a) => a[1]);
    expect(plan.length).toBe(36);
    expect(plan.filter((p) => p.kind === 'brute' && p.opts.build === 'brute').length).toBeGreaterThanOrEqual(3);
    expect(plan.filter((p) => p.kind === 'bloater' && p.opts.build === 'bloated').length).toBeGreaterThanOrEqual(2);
    expect(plan.filter((p) => p.kind === 'armoured' && p.opts.variant === 'trooper').length).toBeGreaterThan(0);
    expect(plan.filter((p) => p.kind === 'civilian').every((p) => p.opts.variant !== 'trooper')).toBe(true);
    const { built } = setup();
    expect(built.length).toBe(36);
    expect(built.filter((b) => b.opts.build === 'brute').length).toBe(3);
  });
  it('a spawn takes a body of its kind', () => {
    const { Z, built } = setup();
    const id = Z.spawn([0, 0, 10], { exact: true, type: 'brute' });
    const b = built.find((x) => x.mesh.visible && x.opts.build === 'brute');
    expect(b).toBeTruthy();
    expect(Z.bodyOf(id)).toBe(b);
  });
});

describe('runner', () => {
  it('a runner 20 m away arrives in 20/4.2 .. 20/3.4 s (+-15 %)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { Z, step } = setup({ seed });
      const ang = seed * 0.9;
      const id = Z.spawn([Math.sin(ang) * 20, 0, Math.cos(ang) * 20], { exact: true, type: 'runner' });
      const r = rec(Z, id);
      expect(r.speed).toBeGreaterThanOrEqual(3.4);
      expect(r.speed).toBeLessThanOrEqual(4.2);
      let t = 0;
      while (flat(r, [0, 0, 0]) > T.types.runner.reach && t < 30) { step(); t += DT; }
      expect(t).toBeGreaterThan((20 / 4.2) * 0.85);
      expect(t).toBeLessThan((20 / 3.4) * 1.15);
    }
  });
  it('lands 28 after a 0.35 s wind-up', () => {
    const { Z, G, log, step } = setup();
    Z.spawn([0, 0, 3], { exact: true, type: 'runner' });
    let t0 = null;
    for (let f = 0; f < 600 && t0 === null; f++) { step(); const a = events(log, 'zombie:attack')[0]; if (a) t0 = a[2]; }
    expect(t0).not.toBeNull();
    step(Math.floor(0.3 / DT));
    expect(G.player.damage).not.toHaveBeenCalled();
    step(Math.ceil(0.1 / DT));
    expect(G.player.damage).toHaveBeenCalledTimes(1);
    expect(G.player.damage.mock.calls[0][0]).toBe(28);
  });
});

describe('armoured', () => {
  it('100 to the chest: 20 from the front, 150 from behind; 300 to the head', () => {
    const { Z } = setup({ round: 12 });
    const id = Z.spawn([0, 0, 5], { exact: true, type: 'armoured' });
    // it faces the player at the origin: a shot from the player travels +z, into its front
    expect(Z.damage(id, 100, 'torso', [0, 0, 1]).damage).toBeCloseTo(20, 9);
    expect(Z.damage(id, 100, 'torso', { x: 0, y: 0, z: -1 }).damage).toBeCloseTo(150, 9);
    expect(Z.damage(id, 100, 'head', [0, 0, 1]).damage).toBeCloseTo(300, 9);
    expect(Z.damage(id, 100, 'armL', [0, 0, 1]).damage).toBeCloseTo(20, 9);
    expect(Z.damage(id, 100, 'legR', [0, 0, -1]).damage).toBeCloseTo(20, 9);
  });
  it('partScale is 1 for every part of an unarmoured type but the head', () => {
    for (const p of ['torso', 'armL', 'armR', 'legL', 'legR']) expect(partScale('walker', p, [0, 0, 1], 0)).toBe(1);
    expect(partScale('runner', 'head', null, 0)).toBe(3);
    expect(partScale('armoured', 'torso', null, 0)).toBe(1); // fire: no direction, not stopped by the plate
  });
});

describe('bloater', () => {
  it('killed 10 m away it bursts (zombie:burst) and the cloud does not reach the player', () => {
    const { Z, G, log, step } = setup();
    const id = Z.spawn([0, 0, 10], { exact: true, type: 'bloater' });
    step(2);
    const res = Z.damage(id, 1e6, 'torso', [0, 0, 1]);
    expect(res.killed).toBe(true);
    const b = events(log, 'zombie:burst');
    expect(b.length).toBe(1);
    expect(b[0][1].id).toBe(id);
    expect(Math.hypot(b[0][1].pos.x, b[0][1].pos.z - 10)).toBeLessThan(0.5);
    const die = events(log, 'zombie:die')[0][1];
    expect(die).toMatchObject({ id, type: 'bloater' });
    step(Math.ceil(7 / DT));
    expect(G.player.damage).not.toHaveBeenCalled();
    expect(Z.clouds.length).toBe(0);
  });
  it('one that reaches 1.5 m bursts 0.8 s later; 2 s in the cloud costs 24', () => {
    const { Z, G, log, step } = setup();
    const id = Z.spawn([0, 0, 4], { exact: true, type: 'bloater' });
    const r = rec(Z, id);
    let tNear = null;
    for (let f = 0; f < 60 * 20 && !events(log, 'zombie:burst').length; f++) {
      step();
      if (tNear === null && flat(r, [0, 0, 0]) <= T.types.bloater.burst.trigger) tNear = G.time.t;
    }
    const b = events(log, 'zombie:burst');
    expect(b.length).toBe(1);
    expect(b[0][2] - tNear).toBeGreaterThan(0.8 - 2.5 * DT);
    expect(b[0][2] - tNear).toBeLessThan(0.8 + 2.5 * DT);
    // no swing from a bloater, and it has left the list (counted as a death for the round)
    expect(events(log, 'zombie:attack').length).toBe(0);
    expect(rec(Z, id)).toBeUndefined();
    expect(events(log, 'zombie:die')[0][1]).toMatchObject({ id, type: 'bloater', cause: 'burst' });
    expect(G.player.damage).not.toHaveBeenCalled();
    step(Math.round(2 / DT));
    const total = G.player.damage.mock.calls.reduce((s, c) => s + c[0], 0);
    expect(total).toBeCloseTo(24, 6);
    // walk out of it: no more
    G.player.pos[2] = -8;
    step(Math.round(5 / DT));
    expect(G.player.damage.mock.calls.reduce((s, c) => s + c[0], 0)).toBeCloseTo(24, 6);
  });
  it('a player standing upstairs over the cloud is not hurt', () => {
    const { Z, G, step } = setup({ player: [0, 3.04, 0] });
    const id = Z.spawn([0, 0, 1], { exact: true, type: 'bloater' });
    Z.damage(id, 1e6, 'torso');
    step(Math.round(3 / DT));
    expect(G.player.damage).not.toHaveBeenCalled();
  });
});

describe('brute', () => {
  it('ignores a pistol stagger and takes one from a frag (and from a shotgun inside 4 m only)', () => {
    const { Z, G, step, anims } = setup({ round: 5 });
    const id = Z.spawn([0, 0, 12], { exact: true, type: 'brute' });
    step(60);
    const a = anims[anims.length - 1];
    const r = rec(Z, id);
    const hit = (source, weapon, part = 'torso') => {
      const res = Z.damage(id, 40, part, [0, 0, -1]);
      G.events.emit('hit:zombie', { id, pos: { x: r.pos.x, y: 1.2, z: r.pos.z }, part, damage: res.damage, killed: res.killed, headshot: false, dir: { x: 0, y: 0, z: -1 }, weapon, source });
    };
    hit('bullet', 'pistol');
    step(2);
    expect(a.state).not.toBe('stagger');
    hit('bullet', 'pump'); // a shotgun, but from more than 4 m
    step(2);
    expect(a.state).not.toBe('stagger');
    hit('explosion', 'frag');
    expect(a.state).toBe('stagger');
    step(Math.ceil(1.2 / DT));
    expect(a.state).not.toBe('stagger');
    G.player.pos[2] = r.pos.z - 3;
    hit('bullet', 'pump');
    expect(a.state).toBe('stagger');
  });
  it('is immune to One-Tap', () => {
    const { Z, G } = setup({ round: 5 });
    G.weapon = { mods: { instantKill: true }, def: { damage: 40 } };
    const id = Z.spawn([0, 0, 12], { exact: true, type: 'brute' });
    const r = rec(Z, id);
    const res = Z.damage(id, r.health + 1, 'torso', [0, 0, 1]);
    expect(res.killed).toBe(false);
    expect(res.damage).toBe(40);
    // the record says so; a real amount (a frag's blast, a pellet volley) is taken as it comes
    expect(r.oneTapImmune).toBe(true);
    const before = r.health;
    expect(Z.damage(id, 900, 'torso').damage).toBe(900);
    expect(r.health).toBe(before - 900);
    // a walker under One-Tap dies as before
    const w = Z.spawn([4, 0, 12], { exact: true });
    expect(rec(Z, w).oneTapImmune).toBe(false);
    expect(Z.damage(w, rec(Z, w).health + 1, 'torso').killed).toBe(true);
  });
  it('swings for 60 at 1.6 m and slams every 6 s for 40 within 2.5 m', () => {
    const { Z, G, log, step } = setup({ round: 5 });
    Z.spawn([0, 0, 1.5], { exact: true, type: 'brute' });
    step(Math.round(14 / DT));
    const amounts = G.player.damage.mock.calls.map((c) => c[0]);
    expect(amounts).toContain(40);
    expect(amounts).toContain(60);
    const slams = events(log, 'zombie:attack').filter(([, p]) => p.kind === 'slam').map(([, , t]) => t);
    expect(slams.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < slams.length; k++) expect(slams[k] - slams[k - 1]).toBeGreaterThanOrEqual(6 - 1e-6);
  });
});

describe('limbs and crawlers', () => {
  it('a leg that takes 40 % of max health comes off once and the zombie crawls at 0.7 m/s', () => {
    const { Z, log, step } = setup();
    const id = Z.spawn([0, 0, 15], { exact: true });
    const r = rec(Z, id);
    step(60);
    const third = r.maxHealth * 0.2;
    expect(Z.damage(id, third, 'legL', [0, 0, -1]).severed).toBeUndefined();
    expect(events(log, 'zombie:sever').length).toBe(0);
    const res = Z.damage(id, third + 0.01, 'legL', [0, 0, -1]);
    expect(res.killed).toBe(false);
    expect(res.severed).toBe('legL');
    Z.damage(id, 1, 'legL', [0, 0, -1]);
    const sev = events(log, 'zombie:sever');
    expect(sev.length).toBe(1);
    expect(sev[0][1]).toMatchObject({ id, part: 'legL' });
    expect(r.crawling).toBe(true);
    expect(r.limbs.legL).toBe(false);
    expect(r.speed).toBeCloseTo(0.7, 9);
    expect(Z.bodyOf(id).severed.has('legL')).toBe(true);
    step(Math.round(3 / DT)); // slow down to a crawl
    const z0 = r.pos.z;
    step(Math.round(4 / DT));
    expect((z0 - r.pos.z) / 4).toBeGreaterThan(0.6);
    expect((z0 - r.pos.z) / 4).toBeLessThan(0.75);
  });
  it('a crawler bites for 20 at 0.9 m', () => {
    const { Z, G, step } = setup();
    const id = Z.spawn([0, 0, 3], { exact: true });
    Z.damage(id, rec(Z, id).maxHealth * 0.41, 'legR');
    step(Math.round(12 / DT));
    expect(G.player.damage).toHaveBeenCalled();
    expect(G.player.damage.mock.calls[0][0]).toBe(20);
    expect(flat(rec(Z, id), [0, 0, 0])).toBeLessThanOrEqual(0.9);
  });
  it('an arm at 35 %; a zombie missing an arm hits for half', () => {
    const { Z, G, log, step } = setup();
    const id = Z.spawn([0, 0, 3], { exact: true });
    Z.damage(id, rec(Z, id).maxHealth * 0.36, 'armR');
    expect(events(log, 'zombie:sever').map(([, p]) => p.part)).toEqual(['armR']);
    expect(rec(Z, id).crawling).toBe(false);
    step(Math.round(4 / DT));
    expect(G.player.damage.mock.calls[0][0]).toBe(17);
    expect(attackDamage('walker', false, 2)).toBe(34 / 4);
    expect(attackDamage('brute', true, 1)).toBe(10);
  });
  it('a killing headshot of at least half its max health takes the head; a weaker one does not', () => {
    const { Z, log } = setup({ round: 3 });
    const a = Z.spawn([0, 0, 10], { exact: true });
    Z.damage(a, rec(Z, a).maxHealth * 0.6 / 3, 'head'); // 0.6 of max after the x3
    expect(events(log, 'zombie:sever').map(([, p]) => p.part)).toEqual([]);
    Z.damage(a, rec(Z, a).maxHealth, 'head'); // kills
    expect(events(log, 'zombie:sever').map(([, p]) => [p.id, p.part])).toEqual([[a, 'head']]);
    const b = Z.spawn([3, 0, 10], { exact: true });
    Z.damage(b, rec(Z, b).maxHealth * 0.8, 'torso');
    Z.damage(b, rec(Z, b).maxHealth * 0.1, 'head'); // kills with 0.3 of max
    expect(events(log, 'zombie:sever').length).toBe(1);
  });
  it('a killing explosion takes 1 to 3 limbs', () => {
    const { Z, G, log } = setup({ round: 2 });
    for (let k = 0; k < 6; k++) {
      const id = Z.spawn([k * 2, 0, 10], { exact: true });
      const res = Z.damage(id, 1e6, 'torso', [0, 0, 1]);
      G.events.emit('hit:zombie', { id, pos: { x: k * 2, y: 1, z: 10 }, part: 'torso', damage: res.damage, killed: true, headshot: false, dir: { x: 0, y: 0, z: 1 }, weapon: 'frag', source: 'explosion' });
      const n = events(log, 'zombie:sever').filter(([, p]) => p.id === id).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
    const out = [];
    const rng = createRng(4);
    for (let k = 0; k < 50; k++) {
      explosionLimbs(rng, { armL: true, armR: false, legL: true, legR: true }, out);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out.length).toBeLessThanOrEqual(3);
      expect(out).not.toContain('armR');
      expect(new Set(out).size).toBe(out.length);
    }
  });
});

describe('lure', () => {
  it('pulls every zombie within 25 m for 8 s; they return to the player after', () => {
    const { Z, G, step } = setup();
    const lure = [20, 0, 0];
    const near = [[14, 0, 4], [26, 0, -4], [20, 0, -8]].map((p) => Z.spawn(p, { exact: true }));
    const far = Z.spawn([-12, 0, -24], { exact: true }); // 32 m from the lure, 27 from the player
    step(5);
    Z.setLure({ x: lure[0], y: 0, z: lure[2] }, 8, 25);
    for (const id of near) expect(rec(Z, id).lured).toBe(true);
    expect(rec(Z, far).lured).toBe(false);
    step(Math.round(7.5 / DT));
    for (const id of near) expect(flat(rec(Z, id), lure)).toBeLessThan(3);
    expect(flat(rec(Z, far), [0, 0, 0])).toBeLessThan(27 - 7);
    expect(G.player.damage).not.toHaveBeenCalled();
    step(Math.round(1 / DT));
    for (const id of near) expect(rec(Z, id).lured).toBe(false);
    step(Math.round(20 / DT));
    for (const id of near) expect(flat(rec(Z, id), [0, 0, 0])).toBeLessThan(2);
  });
  it('setLure(null) ends it at once', () => {
    const { Z, step } = setup();
    const id = Z.spawn([10, 0, 0], { exact: true });
    Z.setLure([12, 0, 0], 8);
    expect(rec(Z, id).lured).toBe(true);
    Z.setLure(null, 0);
    expect(rec(Z, id).lured).toBe(false);
    step(10);
  });
});

describe('stagger (Jump Start)', () => {
  it('throws a zombie back and holds it; the brute ignores it', () => {
    const { Z, G, step } = setup();
    const id = Z.spawn([0, 0, 2], { exact: true });
    const b = Z.spawn([3, 0, 3], { exact: true, type: 'brute' });
    step(5);
    const r = rec(Z, id);
    const z0 = r.pos.z;
    expect(Z.stagger(id, { x: 0, y: 0, z: 2 }, 1.5)).toBe(true);
    expect(r.pos.z).toBeCloseTo(z0 + 2, 6);
    const z1 = r.pos.z;
    step(Math.round(1.4 / DT));
    expect(Math.abs(r.pos.z - z1)).toBeLessThan(0.3);
    expect(G.player.damage).not.toHaveBeenCalled();
    step(Math.round(4 / DT));
    expect(r.pos.z).toBeLessThan(z1 - 1);
    expect(Z.stagger(b, { x: 2, y: 0, z: 0 }, 1.5)).toBe(false);
  });
});
