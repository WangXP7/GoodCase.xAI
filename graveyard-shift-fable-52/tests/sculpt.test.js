import { describe, it, expect } from 'vitest';
import { buildFigure, BUILDS } from '../src/zombie/sculpt/figure.js';
import { evaluate, gradient, weightsAt, project } from '../src/zombie/sculpt/sdf.js';
import { MeshBuf, buildBodyCages, MIRROR_BONES } from '../src/zombie/sculpt/cage.js';
import { BODY, GUTTER } from '../src/zombie/sculpt/uv.js';
import { EYE } from '../src/zombie/sculpt/head.js';
import { NB } from '../src/zombie/skeleton.js';

const F = buildFigure('m', 'average');

describe('the sculpt field', () => {
  it('is negative inside the skull and positive 5 cm outside it', () => {
    expect(evaluate(F, 0, 1.7, -0.02)).toBeLessThan(-0.05);
    expect(evaluate(F, 0, 1.86, -0.02)).toBeGreaterThan(0.02);
    expect(evaluate(F, 0.14, 1.7, -0.02)).toBeGreaterThan(0.02);
  });
  it('has concave eye sockets: the lid surface sits behind the brow and the cheekbone', () => {
    const depth = (y) => { const p = [EYE[0], y, 0.14]; project(F, p); return p[2]; };
    const g = [0, 0, 0];
    // surface depth along a ray straight back from in front of the face
    const hit = (y) => { let z = 0.14; for (let i = 0; i < 400 && evaluate(F, EYE[0], y, z) > 0; i++) z -= 0.0005; return z; };
    expect(hit(EYE[1])).toBeLessThan(hit(EYE[1] + 0.02) - 0.004);
    expect(hit(EYE[1])).toBeLessThan(hit(EYE[1] - 0.024) - 0.002);
    expect(gradient(F, 0, 1.7, 0.2, g)).toBeGreaterThan(0);
    void depth;
  });
  it('keeps five fingers apart at mid length', () => {
    const f = F.marks.fingers;
    for (let i = 0; i + 1 < f.length; i++) {
      const a = f[i].pts[2], b = f[i + 1].pts[2];
      expect(evaluate(F, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)).toBeGreaterThan(0.0003);
    }
    const t = F.marks.thumb.pts[3], ix = f[0].pts[2];
    expect(evaluate(F, (t[0] + ix[0]) / 2, (t[1] + ix[1]) / 2, (t[2] + ix[2]) / 2)).toBeGreaterThan(0.001);
  });
  it('is symmetric and builds every sex and build', () => {
    expect(evaluate(F, 0.1, 1.2, 0.05)).toBeCloseTo(evaluate(F, -0.1, 1.2, 0.05), 9);
    for (const sex of ['m', 'f']) for (const b of BUILDS) {
      const f = buildFigure(sex, b);
      expect(f.n).toBeGreaterThan(100);
      expect(evaluate(f, 0, 1.2, 0)).toBeLessThan(0);
      expect(evaluate(f, 0, 1.2, 0.4)).toBeGreaterThan(0.02);
    }
    expect(evaluate(buildFigure('m', 'heavy'), 0, 1.1, 0.14)).toBeLessThan(evaluate(buildFigure('m', 'gaunt'), 0, 1.1, 0.14));
  });
  it('gives weights that sum to one on at most four bones, mirrored on the right', () => {
    for (const p of [[0.1, 1.3, 0.09], [0.2, 1.4, 0], [0.09, 0.9, 0.05], [0, 1.62, 0.09], [0.36, 1.15, 0], [0.1, 0.5, 0.04]]) {
      const w = weightsAt(F, p[0], p[1], p[2], MIRROR_BONES, NB);
      expect(w.length).toBeLessThanOrEqual(4);
      expect(w.reduce((s, v) => s + v[1], 0)).toBeCloseTo(1, 6);
      const m = weightsAt(F, -p[0], p[1], p[2], MIRROR_BONES, NB);
      expect(m.map((v) => v[0])).toEqual(w.map((v) => MIRROR_BONES[v[0]]));
    }
  });
});

describe('the cages', () => {
  for (const q of [1, 0.5]) {
    it(`wrap onto the zero level at detail ${q}, with UVs inside their rectangles`, () => {
      const mesh = new MeshBuf();
      const info = buildBodyCages(mesh, F, q);
      const m = mesh.finish();
      expect(info.mouth.upper.length).toBeGreaterThan(q >= 1 ? 5 : 0);
      let worst = 0, on = 0;
      const rects = Object.values(BODY);
      for (let i = 0; i < m.count; i++) {
        const x = m.position[i * 3], y = m.position[i * 3 + 1], z = m.position[i * 3 + 2];
        if (!Number.isFinite(x + y + z)) throw new Error(`vertex ${i} is not finite`);
        if (!m.sunk[i]) { worst = Math.max(worst, Math.abs(evaluate(F, x, y, z))); on++; }
        const u = m.uv[i * 2], v = m.uv[i * 2 + 1];
        const g = 4 / 1024;
        if (!rects.some((r) => u >= r[0] + g && u <= r[2] - g && v >= r[1] + g && v <= r[3] - g)) throw new Error(`uv ${u},${v} of vertex ${i} is in no rectangle's interior`);
        const w = m.skinWeight[i * 4] + m.skinWeight[i * 4 + 1] + m.skinWeight[i * 4 + 2] + m.skinWeight[i * 4 + 3];
        if (Math.abs(w - 1) > 1e-4) throw new Error(`weights of vertex ${i} sum to ${w}`);
        for (let k = 0; k < 4; k++) if (m.skinIndex[i * 4 + k] >= NB) throw new Error('bone index out of range');
      }
      expect(worst).toBeLessThan(0.0003);
      expect(on / m.count).toBeGreaterThan(0.8);
      expect(GUTTER).toBeGreaterThanOrEqual(4 / 1024);
      let tris = 0;
      for (const [, l] of m.shells) { tris += l.length / 3; for (const v of l) if (v >= m.count) throw new Error('index out of range'); }
      expect(tris).toBeLessThan(q >= 1 ? 8400 : 2200);
      // stands on the ground, a person's height
      let lo = 9, hi = -9;
      for (let i = 0; i < m.count; i++) if (!m.sunk[i]) { lo = Math.min(lo, m.position[i * 3 + 1]); hi = Math.max(hi, m.position[i * 3 + 1]); }
      expect(lo).toBeGreaterThan(-0.005); expect(lo).toBeLessThan(0.02);
      expect(hi).toBeGreaterThan(1.76); expect(hi).toBeLessThan(1.84);
    });
  }
});
