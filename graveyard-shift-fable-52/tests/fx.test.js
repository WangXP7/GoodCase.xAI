import { describe, it, expect } from 'vitest';
import { decalShares, bloodCap, goreOf, HALO, haloWeight, haloLod, spatterSize, SPATTER, boxDepth } from '../src/fx/decals.js';
import { tracerDue, jaggedPath, emitCount } from '../src/fx/combat.js';
import { burstScale, hitBlood, deathPool, slowSlots } from '../src/fx/particles.js';

describe('decal shares', () => {
  it('blood has 160 of 256 on desktop tiers and 64 of 96 on mobile', () => {
    expect(decalShares(256)).toEqual([256, 160]);
    expect(decalShares(96)).toEqual([96, 64]);
    expect(decalShares(undefined)).toEqual([256, 160]);
    expect(decalShares(1e6)[0]).toBe(256);
  });
  it('reduced gore keeps 0.3 of the share, never fewer than 4', () => {
    expect(bloodCap(160, 1)).toBe(160);
    expect(bloodCap(160, 0.3)).toBe(48);
    expect(bloodCap(64, 0.3)).toBe(19);
    expect(bloodCap(8, 0.3)).toBe(4);
    expect(bloodCap(160, undefined)).toBe(160);
  });
});

describe('tracers', () => {
  it('every third round of automatic fire, every upgraded round, nothing else', () => {
    const auto = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => tracerDue(n, true, false));
    expect(auto).toEqual([3, 6, 9]);
    expect([1, 2, 3].every((n) => tracerDue(n, false, true))).toBe(true);
    expect([1, 2, 3].some((n) => tracerDue(n, false, false))).toBe(false);
  });
});

describe('arc path', () => {
  it('keeps both ends exact and stays within the amplitude', () => {
    let s = 1; const next = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = new Float32Array(3 * 9);
    jaggedPath(0, 1, 0, 4, 1, 0, 8, 0.3, next, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 1, 0]);
    expect([out[24], out[25], out[26]]).toEqual([4, 1, 0]);
    for (let i = 1; i < 8; i++) { expect(Math.abs(out[i * 3 + 1] - 1)).toBeLessThanOrEqual(0.3001); expect(Math.abs(out[i * 3] - i * 0.5)).toBeLessThanOrEqual(0.3001); }
  });
});

describe('rate emission', () => {
  it('lets out rate x time over many frames, whatever the frame rate, and caps a long frame', () => {
    for (const fps of [30, 60, 144]) {
      const acc = { v: 0 }; let n = 0;
      for (let i = 0; i < fps * 2; i++) n += emitCount(acc, 50, 1 / fps);
      expect(Math.abs(n - 100)).toBeLessThanOrEqual(1);
    }
    expect(emitCount({ v: 0 }, 1000, 1, 24)).toBe(24);
    expect(emitCount({ v: 0 }, 50, 0)).toBe(0);
  });
});

describe('burst scale', () => {
  it('is 1 at the desktop cap and about 0.6 at the mobile cap', () => {
    expect(burstScale(4096)).toBe(1);
    expect(burstScale(1536)).toBeCloseTo(0.612, 2);
    expect(burstScale(100)).toBe(0.5);
  });
});

const lcg = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

describe('gore level', () => {
  it('0 means no gore, not full; only a missing value counts as full', () => {
    expect(goreOf(0)).toBe(0);
    expect(goreOf(0.3)).toBe(0.3);
    expect(goreOf(1)).toBe(1);
    expect(goreOf(undefined)).toBe(1);
    expect(goreOf(NaN)).toBe(1);
    expect(goreOf(5)).toBe(1);
    expect(bloodCap(160, 0)).toBe(0);
    expect(bloodCap(64, 0)).toBe(0);
  });
  it('gore 0: a hit spills nothing and a death lays no pool', () => {
    const next = lcg(7);
    for (let i = 0; i < 200; i++) {
      const p = hitBlood({ part: i % 2 ? 'head' : 'torso', killed: i % 3 === 0 }, 0, next(), next(), next(), next());
      expect(p).toEqual({ amount: 0, ground: 0, wall: 0 });
    }
    expect(deathPool(0, false, true, 0.5)).toBe(0);
  });
});

describe('blood on a hit', () => {
  it('lays a spatter of 0.15-0.4 m, never a pool', () => {
    const next = lcg(11); let grounds = 0; let walls = 0;
    for (let i = 0; i < 2000; i++) {
      const p = hitBlood({ part: ['head', 'torso', 'armL', 'legR'][i % 4], killed: i % 5 === 0 }, 1, next(), next(), next(), next());
      expect(Object.keys(p).sort()).toEqual(['amount', 'ground', 'wall']); // nothing that could be a pool
      for (const s of [p.ground, p.wall]) if (s > 0) { expect(s).toBeGreaterThanOrEqual(SPATTER.min); expect(s).toBeLessThanOrEqual(SPATTER.max); }
      if (p.ground > 0) grounds++;
      if (p.wall > 0) walls++;
      expect(p.amount).toBeGreaterThan(0);
    }
    expect(grounds).toBeGreaterThan(1400); expect(grounds).toBeLessThan(1800); // about 0.8 of hits
    expect(walls).toBeGreaterThan(1100);
    for (const a of [0.1, 0.55, 0.75, 1.1, 1.4, 3]) for (const r of [0, 0.5, 0.999]) {
      expect(spatterSize(a, r)).toBeGreaterThanOrEqual(SPATTER.min);
      expect(spatterSize(a, r)).toBeLessThanOrEqual(SPATTER.max);
    }
    expect(spatterSize(1.4, 0.5)).toBeGreaterThan(spatterSize(0.55, 0.5)); // a heavier hit, a larger mark
  });
  it('reduced gore lays fewer', () => {
    const next = lcg(3); let full = 0; let reduced = 0;
    for (let i = 0; i < 1000; i++) {
      if (hitBlood({ part: 'torso' }, 1, next(), next(), next(), next()).ground > 0) full++;
      if (hitBlood({ part: 'torso' }, 0.3, next(), next(), next(), next()).ground > 0) reduced++;
    }
    expect(reduced).toBeLessThan(full * 0.45);
  });
});

describe('pool on death only', () => {
  it('one modest pool at full gore, unless someone else owns corpse pools', () => {
    for (const r of [0, 0.5, 0.999]) { const s = deathPool(1, false, true, r); expect(s).toBeGreaterThanOrEqual(0.5); expect(s).toBeLessThanOrEqual(0.8); }
    expect(deathPool(0.3, false, true, 0.5)).toBe(0); // reduced: no pool under a body
    expect(deathPool(1, true, true, 0.5)).toBe(0); //   blood.js took over (G.fx.bloodOwner)
    expect(deathPool(1, false, false, 0.5)).toBe(0); // switched off (G.fx.corpsePools = false)
  });
});

describe('rain halo', () => {
  it('is masked by the core field, feathered inside the box and thin', () => {
    expect(HALO.alpha).toBeLessThanOrEqual(0.15);
    let max = 0;
    for (let x = -0.5; x <= 0.5; x += 0.05) for (let y = -0.5; y <= 0.5; y += 0.05) {
      expect(Math.abs(haloWeight(x, y, 0))).toBe(0); // no blood near: no halo, wherever in the box
      const w = haloWeight(x, y, 1);
      if (Math.max(Math.abs(x), Math.abs(y)) >= 0.5 - 1e-9) expect(Math.abs(w)).toBeLessThan(1e-12); // nothing at the box's edge: no rectangle
      if (Math.max(Math.abs(x), Math.abs(y)) <= 0.3) expect(w).toBeCloseTo(HALO.alpha, 6);
      max = Math.max(max, w);
    }
    expect(max).toBeLessThanOrEqual(0.15);
  });
  it('never samples a mip that is the whole cell', () => {
    for (const lod of [0, 1, 2, 3, 4, 8]) { expect(haloLod(lod)).toBeLessThanOrEqual(3.5); expect(haloLod(lod)).toBeGreaterThanOrEqual(2); }
    expect(haloLod(1)).toBe(2.5);
  });
});

describe('decal box and smoke ring', () => {
  it('a floor decal is shallow, a wall decal deeper', () => {
    expect(boxDepth(2, true)).toBeLessThanOrEqual(0.12);
    expect(boxDepth(0.2, true)).toBeGreaterThanOrEqual(0.1);
    expect(boxDepth(0.3, false)).toBeGreaterThanOrEqual(0.1);
  });
  it('hanging smoke has slots that bursts cannot take', () => {
    expect(slowSlots(4096)).toBe(512);
    expect(slowSlots(1536)).toBe(256);
    expect(1536 - 128 - slowSlots(1536)).toBeGreaterThan(1000);
  });
});
