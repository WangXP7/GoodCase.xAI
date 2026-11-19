// What bleeds, where and how much (src/fx/blood.js), and how a kill falls (src/zombie/gore.js).
import { describe, it, expect } from 'vitest';
import { bloodPlan, burstPlan, woundSlot, createPoolRing, createDecalBudget, poolSize, screenPlan, BLOOD } from '../src/fx/blood.js';
import { deathStyle, goreLevel } from '../src/zombie/gore.js';
import { createRng } from '../src/core/rng.js';

const torso = { part: 'torso', damage: 40, killed: false, headshot: false };

describe('bloodPlan', () => {
  it('a torso hit of 40 sprays within its band', () => {
    const p = bloodPlan(torso, { gore: 1, behind: Infinity, r: 0.5 });
    expect(p.spray.count).toBeGreaterThanOrEqual(18);
    expect(p.spray.count).toBeLessThanOrEqual(34);
    expect(p.spray.speed).toBeGreaterThan(0);
  });
  it('asks for one exit decal when a wall is 2 m behind and none when the nearest surface is 4 m away', () => {
    const near = bloodPlan(torso, { gore: 1, behind: 2, r: 0.9 });
    expect(near.decals.filter((d) => d.at === 'behind')).toHaveLength(1);
    expect(near.decals.filter((d) => d.at === 'behind')[0].kind).toBe('spatter');
    const far = bloodPlan(torso, { gore: 1, behind: 4, r: 0.9 });
    expect(far.decals.filter((d) => d.at === 'behind')).toHaveLength(0);
  });
  it('a killing headshot sets burst; a head hit that does not kill only wounds', () => {
    expect(bloodPlan({ part: 'head', damage: 120, killed: true, headshot: true }, { gore: 1 }).burst).toBe(true);
    const p = bloodPlan({ part: 'head', damage: 120, killed: false, headshot: true }, { gore: 1 });
    expect(p.burst).toBe(false);
    expect(p.wound).not.toBeNull();
  });
  it('with gore 0.3 the particle count is at most 30 % and burst is false', () => {
    const full = bloodPlan({ part: 'head', damage: 120, killed: true, headshot: true }, { gore: 1, r: 0.2 }).spray.count;
    const p = bloodPlan({ part: 'head', damage: 120, killed: true, headshot: true }, { gore: 0.3, r: 0.2 });
    expect(p.spray.count).toBeLessThanOrEqual(full * 0.3 + 1e-9);
    expect(p.burst).toBe(false);
    expect(p.wound).not.toBeNull();          // hit feedback stays
    expect(burstPlan(0.3).mist + burstPlan(0.3).spray + burstPlan(0.3).fan).toBe(0);
  });
  it('gore 0 spills nothing at all', () => {
    const p = bloodPlan(torso, { gore: 0, behind: 1 });
    expect(p.spray.count).toBe(0);
    expect(p.spray.mist).toBe(0);
    expect(p.decals).toHaveLength(0);
    expect(p.burst).toBe(false);
    expect(poolSize(0)).toBe(0);
    expect(screenPlan(0, { gore: 0 }).drops).toHaveLength(0);
  });
  it('a limb graze is a puff, a close shotgun a wide burst, fire draws no blood', () => {
    const limb = bloodPlan({ part: 'armL', damage: 20 }, { gore: 1 });
    const chest = bloodPlan({ ...torso }, { gore: 1 });
    expect(limb.spray.count).toBeLessThan(chest.spray.count);
    const shot = bloodPlan({ part: 'torso', damage: 160, pellets: 8 }, { gore: 1, near: 3 });
    expect(shot.spray.spread).toBeGreaterThan(chest.spray.spread);
    expect(shot.spray.count).toBeGreaterThan(chest.spray.count);
    expect(bloodPlan({ part: 'torso', damage: 30, source: 'fire' }, { gore: 1 }).spray.count).toBe(0);
    expect(bloodPlan({ part: 'torso', damage: 30, source: 'fire' }, { gore: 1 }).wound).toBeNull();
  });
  it('an SMG on 24 zombies stays inside the particle budget', () => {
    // 15 rounds a second, a spray lives about 0.5 s: what is alive at once
    const p = bloodPlan({ part: 'torso', damage: 28 }, { gore: 1 });
    expect((p.spray.count + p.spray.mist * 6) * 15 * 0.5).toBeLessThanOrEqual(BLOOD.maxParticles);
  });
});

describe('corpse pools', () => {
  it('a corpse requests exactly one pool', () => {
    const ring = createPoolRing();
    expect(ring.add(7).added).toBe(true);
    expect(ring.add(7).added).toBe(false);
    expect(ring.live).toBe(1);
  });
  it('the 13th pool retires the 1st', () => {
    const ring = createPoolRing();
    for (let i = 1; i <= 12; i++) { const r = ring.add(i); ring.setSlot(r.index, 100 + i); expect(r.retired).toBeNull(); }
    const r = ring.add(13);
    expect(r.added).toBe(true);
    expect(r.retired).toBe(1);
    expect(r.retiredSlot).toBe(101);
    expect(ring.live).toBe(BLOOD.pools);
    expect(ring.has(1)).toBe(false);
  });
  it('no pool under reduced gore; bigger under a bloater and a brute', () => {
    expect(poolSize(0.3)).toBe(0);
    expect(poolSize(1, { burst: true })).toBeGreaterThan(poolSize(1));
    expect(poolSize(1, { big: true })).toBeGreaterThan(poolSize(1));
  });
});

describe('budgets', () => {
  it('500 hits never request more decals than the blood share', () => {
    const budget = createDecalBudget(160);
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const p = bloodPlan(torso, { gore: 1, behind: 1 + rng.next() * 3, r: rng.next() });
      expect(p.decals.length).toBeLessThanOrEqual(2);
      budget.take(p.decals.length);
      expect(budget.live).toBeLessThanOrEqual(160);
    }
    expect(budget.asked).toBeGreaterThan(160);
  });
  it('a hit on a zombie already carrying 8 wounds replaces the oldest', () => {
    expect(woundSlot(0)).toBe(0);
    expect(woundSlot(7)).toBe(7);
    expect(woundSlot(8)).toBe(0);
    expect(woundSlot(9)).toBe(1);
    // the wounds a body was built with are kept
    expect(woundSlot(6, 2)).toBe(2);
    expect(woundSlot(5, 2)).toBe(7);
  });
});

describe('screen blood', () => {
  const rng = createRng(3);
  const r = () => rng.next();
  it('a hit from the left puts its drops on the left third', () => {
    const p = screenPlan(-Math.PI / 2, { gore: 1, r });
    expect(p.pulse).toBe(false);
    expect(p.drops.length).toBeGreaterThanOrEqual(3);
    for (const d of p.drops) expect(d.x).toBeLessThan(1 / 3);
    for (const d of screenPlan(Math.PI / 2, { gore: 1, r }).drops) expect(d.x).toBeGreaterThan(2 / 3);
  });
  it('never covers the middle fifth, from any side', () => {
    for (let a = -3.1; a < 3.2; a += 0.15) for (const touch of [false, true]) {
      for (const d of screenPlan(a, { gore: 1, r, touch, hurt: 1 }).drops) {
        expect(Math.abs(d.x - 0.5) > 0.1 || Math.abs(d.y - 0.5) > 0.1).toBe(true);
      }
    }
  });
  it('more at near death, fewer and fainter on touch, none when reduced or with reduced motion', () => {
    const one = screenPlan(0, { gore: 1, r: () => 0.9, hurt: 0.3 }), dying = screenPlan(0, { gore: 1, r: () => 0.9, hurt: 0.95 });
    expect(dying.drops.length).toBeGreaterThan(one.drops.length);
    const touch = screenPlan(0, { gore: 1, r: () => 0.9, touch: true, hurt: 0.95 });
    expect(touch.drops.length).toBeLessThan(dying.drops.length);
    expect(Math.max(...touch.drops.map((d) => d.alpha))).toBeLessThan(Math.max(...dying.drops.map((d) => d.alpha)));
    for (const d of touch.drops) expect(d.y).toBeLessThan(0.55);     // clear of the controls
    const red = screenPlan(0, { gore: 0.3, r });
    expect(red.pulse).toBe(true);
    expect(red.drops).toHaveLength(0);
    expect(screenPlan(0, { gore: 1, reducedMotion: true, r }).pulse).toBe(true);
  });
});

describe('how a kill falls', () => {
  it('by what killed it', () => {
    expect(deathStyle({ killed: true, source: 'explosion', part: 'torso' }, 3, '')).toBe('blast');
    expect(deathStyle({ killed: true, part: 'torso', source: 'bullet' }, 3, 'shotgun')).toBe('spin');
    expect(deathStyle({ killed: true, part: 'torso', source: 'bullet' }, 12, 'shotgun')).toBe('');
    expect(deathStyle({ killed: true, part: 'head', headshot: true }, 12, 'pistol')).toBe('head');
    expect(deathStyle({ killed: true, part: 'legL' }, 12, 'smg')).toBe('');
    expect(deathStyle({ killed: false, part: 'head' }, 2, 'shotgun')).toBe('');
  });
  it('the gore level comes from G.fx.gore, else the setting', () => {
    expect(goreLevel({ fx: { gore: 0.3 } })).toBe(0.3);
    expect(goreLevel({ fx: { gore: 0 } })).toBe(0);
    expect(goreLevel({ ui: { settings: { gore: 'reduced' } } })).toBe(0.3);
    expect(goreLevel({})).toBe(1);
  });
});
