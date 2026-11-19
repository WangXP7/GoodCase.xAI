// Halite: rock salt. Interlocked cubes, rose and grey inside, frost-white at the edges, grown on a
// dark stone foot. opts.picked = true -> the seam chipped down to slanted stubs and loose shards.
import { Builder, Rng, Noise, MAT, paint, rock, xf, deform, mixc, col, ao } from '../kit.js';
import { register } from '../registry.js';
import { gemBox, paintCore, wobble } from './_shared.js';

register(
  'halite',
  (seed, opts = {}) => {
    const R = new Rng(seed * 6151 + 5);
    const nz = new Noise(seed * 31 + 7);
    const b = new Builder();
    const picked = !!opts.picked;

    // the stone it grew on
    const fr = R.range(0.22, 0.26),
      sx = 1.12,
      sz = 0.94,
      sy = 0.36;
    const foot = rock(fr, { seed: seed + 11, detail: 2, rough: 0.2, squash: [sx, sy, sz], sink: 0.55, facet: true });
    const lift = fr * sy * 0.3;
    paint(foot, {
      color: (v) => {
        // salt bloom creeps over the upper faces
        const up = Math.max(0, Math.min(1, (v.y + fr * sy * 0.25) / (fr * sy)));
        const k = up * (0.3 + 0.7 * (0.5 + 0.5 * nz.n3(v.x * 11, v.y * 11, v.z * 11)));
        return mixc('#232428', '#8b8480', k * 0.8);
      },
      rough: 0.95,
      mat: MAT.STONE,
    });
    xf(foot, { t: [0, lift, 0] });
    b.add(foot);
    const topAt = (x, z) => lift + fr * sy * Math.sqrt(Math.max(0, 1 - (x / (fr * sx)) ** 2 - (z / (fr * sz)) ** 2));

    const frost = col('#e4dcd7'),
      rose = col('#b27a72'),
      grey = col('#7f858f'),
      pale = col('#c9bbb5');
    const tiltAll = [R.range(-0.22, 0.22), R.range(0, 6.28), R.range(-0.22, 0.22)];
    let best = null;

    const cube = (x, z, s, { sinkBy = 0.3, y = null, turn = 0.3, broken = false, terraces = false } = {}) => {
      const w = s * R.range(0.86, 1.08),
        h = s * R.range(0.86, 1.08),
        d = s * R.range(0.86, 1.08);
      const g = gemBox(w, h, d, s * 0.04);
      const extra = [];
      if (terraces && !broken) {
        // growth terraces: each layer of the crystal stopped a little short of the last
        const st = s * 0.03;
        for (let k = 0, f = 0.74; k < 2; k++, f *= 0.62) {
          const p = gemBox(w * f, st, d * f, 0);
          p.translate(w * 0.06 * k, h / 2 + st * (k + 0.5), -d * 0.05 * k);
          extra.push(p);
        }
        const q = gemBox(st, h * 0.66, d * 0.66, 0);
        q.translate(w / 2 + st * 0.5, h * 0.05, d * 0.04);
        extra.push(q);
      }
      const veil = 0.5 + 0.5 * nz.n3(x * 7 + 3.1, s * 20, z * 7 - 1.7);
      const inner = veil < 0.42 ? mixc(rose, pale, veil / 0.42) : mixc(pale, grey, (veil - 0.42) / 0.58);
      let cut = null;
      if (broken) {
        // a slanted fracture: everything above it is gone
        const f = R.range(0.16, 0.34),
          tx = R.range(-0.5, 0.5),
          tz = R.range(-0.5, 0.5);
        cut = (px, pz) => -h / 2 + h * f + tx * px + tz * pz;
        deform(g, (p) => {
          const yc = cut(p.x, p.z);
          if (p.y > yc) p.y = yc;
        });
      }
      const raw = (px, py, pz) => cut && py > cut(px, pz) - 1e-5;
      const rot = wobble(R, turn);
      const cy = y !== null ? y : topAt(x, z) + h * (0.5 - sinkBy);
      for (const part of [g, ...extra]) {
      paintCore(
        part,
        {
          color: (px, py, pz) => (raw(px, py, pz) ? '#f6f2ef' : frost),
          emissive: 0.02,
          rough: (px, py, pz) => (raw(px, py, pz) ? 0.7 : 0.26),
        },
        {
          color: (px, py, pz) => (raw(px, py, pz) ? '#ece4e0' : mixc(inner, rose, 0.25 * (0.5 + 0.5 * nz.n3(px * 30, py * 30, pz * 30)))),
          emissive: (px, py, pz) => (raw(px, py, pz) ? 0.02 : 0.08),
          rough: (px, py, pz) => (raw(px, py, pz) ? 0.7 : 0.12),
        },
        { mat: MAT.CRYSTAL, metal: 0 }
      );
      xf(part, { r: rot });
      xf(part, { r: tiltAll, t: [x, cy, z] });
      b.add(part);
      }
      return { x, y: cy, z, s, h };
    };

    // the big cubes at the heart of the cluster
    const bigs = [];
    const nBig = R.int(1, 2);
    for (let i = 0; i < nBig; i++) {
      const a = R.range(0, 6.28),
        r = i === 0 ? R.range(0, 0.03) : R.range(0.1, 0.13);
      const s = i === 0 ? R.range(0.18, 0.23) : R.range(0.13, 0.17);
      const c = cube(Math.cos(a) * r, Math.sin(a) * r, s, { sinkBy: 0.28, broken: picked, terraces: true });
      bigs.push(c);
      if (!best || c.y + c.h / 2 > best.y + best.h / 2) best = c;
    }
    // middling cubes crowding them
    for (let i = 0, n = R.int(3, 4); i < n; i++) {
      const a = (i / n) * 6.28 + R.range(-0.5, 0.5),
        r = R.range(0.09, 0.16);
      cube(Math.cos(a) * r, Math.sin(a) * r, R.range(0.085, 0.13), { sinkBy: R.range(0.25, 0.4), turn: 0.45, broken: picked });
    }
    // small ones budding from the corners of the big cubes
    if (!picked) {
      for (const B of bigs) {
        for (let i = 0, n = R.int(2, 3); i < n; i++) {
          const s = R.range(0.04, 0.075);
          const k = B.s * 0.46;
          cube(B.x + R.sign() * k, B.z + R.sign() * k, s, { y: B.y + R.pick([0.5, 0.5, 0.05]) * B.h + R.range(-0.01, 0.01), turn: 0.5 });
        }
      }
    }
    // and scattered over the foot
    for (let i = 0, n = picked ? R.int(3, 4) : R.int(5, 7); i < n; i++) {
      const a = R.range(0, 6.28),
        r = R.range(0.1, 0.21);
      cube(Math.cos(a) * r * sx, Math.sin(a) * r * sz, R.range(0.03, 0.06), { sinkBy: 0.3, turn: 0.6 });
    }
    if (picked) {
      // loose shards where the cubes were struck off
      for (let i = 0, n = R.int(4, 6); i < n; i++) {
        const a = R.range(0, 6.28),
          r = R.range(0.2, 0.32);
        const s = R.range(0.02, 0.045);
        const g = gemBox(s, s * R.range(0.3, 0.7), s * R.range(0.5, 1), 0);
        paintCore(g, { color: '#f4efec', emissive: 0.02, rough: 0.6 }, { color: pale, emissive: 0.06, rough: 0.3 }, { mat: MAT.CRYSTAL });
        xf(g, { r: [R.range(-0.3, 0.3), R.range(0, 6.28), R.range(-0.3, 0.3)], t: [Math.cos(a) * r, s * 0.25, Math.sin(a) * r] });
        b.add(g);
      }
    }

    b.anchor('top', best.x, picked ? topAt(best.x, best.z) + 0.06 : best.y + best.h * 0.55, best.z);
    const m = b.build();
    ao(m.opaque, { height: 0.1, strength: 0.3, under: 0.15 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
