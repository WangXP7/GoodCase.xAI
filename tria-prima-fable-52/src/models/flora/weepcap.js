// Weepcap: an ink cap. Thin pale stems, ash-grey bells that melt from the rim upward into
// blue-black ink, and the ground under them never dry. opts.picked = true -> cut stubs and the first pins.
import { Builder, Rng, Noise, MAT, TAU, THREE, paint, lathe, tube, xf, deform, mixc, col, gradY, ao } from '../kit.js';
import { register } from '../registry.js';
import { groundPatch } from './_shared.js';

const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const RAD = 10; // columns round a cap

register(
  'weepcap',
  (seed, opts = {}) => {
    const R = new Rng(seed * 1873 + 29);
    const nz = new Noise(seed * 7 + 77);
    const b = new Builder();
    const picked = !!opts.picked;

    // the ground under it stays dark and wet
    const wr = R.range(0.1, 0.13),
      wh = wr * 0.11;
    const wet = groundPatch(wr, wh, seed + 3, { sides: 10, lump: 0.26 });
    paint(wet, {
      color: (v) => mixc('#05070a', '#1d1a16', cl((Math.hypot(v.x, v.z) - wr * 0.3) / (wr * 0.6))),
      rough: (v) => 0.1 + 0.85 * cl((Math.hypot(v.x, v.z) - wr * 0.35) / (wr * 0.5)),
      mat: MAT.PLAIN,
    });
    b.add(wet);

    const ink = col('#05070a'),
      slate = col('#33454d'),
      ash = col('#8d897c'),
      dew = col('#1d4a58');
    const e = new THREE.Euler(),
      v3 = new THREE.Vector3();
    let top = [0, 0.03, 0],
      dripAt = null;
    const column = (x, z) => ((Math.round((Math.atan2(-z, x) / TAU) * RAD) % RAD) + RAD) % RAD;

    // age 0 = a closed bell, 1 = flared, tattered and running
    const shroom = (x, z, h, cr, ch, age) => {
      const lx = R.range(-0.22, 0.22) * h,
        lz = R.range(-0.22, 0.22) * h;
      const pts = [
        [x, -0.004, z],
        [x + lx * 0.2 + R.range(-0.008, 0.008), h * 0.38, z + lz * 0.2 + R.range(-0.008, 0.008)],
        [x + lx * 0.7, h * 0.78, z + lz * 0.7],
        [x + lx, h, z + lz],
      ];
      const sr = 0.0052 + cr * 0.06;
      const stem = tube(pts, (t) => sr * (1.25 - 0.45 * t), 5, { samples: 6 });
      paint(stem, {
        // pale and fibrous, stained by what runs down it from the cap
        color: (v) => {
          const t = cl(v.y / (h * 0.9));
          const c = mixc('#3d3d38', '#aca799', t);
          return v.y > h * 0.8 ? c.lerp(slate, cl((v.y - h * 0.8) / (h * 0.2)) * (0.25 + 0.6 * age)) : c;
        },
        rough: 0.62,
        mat: MAT.PLANT,
        sway: (v) => Math.pow(cl(v.y / h), 2) * 0.3,
      });
      b.add(stem);

      const flare = 0.84 + age * 0.36; // the rim opens and lifts as it rots
      const lift = age > 0.55 ? (age - 0.55) * ch * 0.5 : 0;
      const outer = lathe(
        [
          [cr * flare, lift],
          [cr * (0.9 + age * 0.08), ch * 0.2 + lift * 0.4],
          [cr * 0.8, ch * 0.54],
          [cr * 0.47, ch * 0.86],
          [0, ch],
        ],
        RAD
      );
      const inner = lathe(
        [
          [cr * 0.3, ch * 0.7],
          [cr * 0.74, ch * 0.3],
          [cr * flare * 0.97, lift + 0.0015],
        ],
        RAD
      );
      // a margin that is being eaten away: every column of the rim has dissolved to a different height
      const eaten = [];
      for (let i = 0; i < RAD; i++) eaten.push(R.chance(0.3 + age * 0.3) ? R.range(0.5, 1) : R.range(0, 0.3));
      const rag = (p) => {
        const t = (p.y - lift) / ch;
        if (t > 0.3) return;
        const k = (1 - cl(t / 0.3)) * (0.25 + age);
        const n = eaten[column(p.x, p.z)];
        p.y += n * ch * 0.2 * k;
        const s = 1 - n * 0.1 * k;
        p.x *= s;
        p.z *= s;
      };
      deform(outer, rag);
      deform(inner, rag);
      const melt = 0.14 + age * 0.3; // how far up the ink has climbed
      paint(outer, {
        color: (v) => {
          const t = cl(v.y / ch);
          const fleck = 0.5 + 0.5 * nz.n3(v.x * 400, v.y * 400, v.z * 400);
          // pleats: the cap is grooved from the rim upward
          const pleat = column(v.x, v.z) % 2 ? 1 - 0.3 * (1 - t) : 1;
          let c;
          if (t < melt) c = mixc(ink, slate, Math.pow(t / melt, 2) * 0.55);
          else c = mixc(mixc(ink, slate, 0.55), mixc(slate, ash, 0.3 + 0.7 * fleck), cl((t - melt) / 0.38));
          return c.multiplyScalar(pleat);
        },
        emissive: (v) => (v.y / ch < 0.12 ? 0.05 : 0),
        rough: (v) => 0.14 + 0.66 * cl((v.y / ch - 0.1) / 0.45),
        mat: MAT.PLANT,
        sway: 0.3,
      });
      paint(inner, { color: '#040507', rough: 0.3, mat: MAT.PLANT, sway: 0.3 });
      // hang the cap on the stem, drooping the way the stem leans
      const tilt = [R.range(-0.18, 0.18) + lz * 2.2, R.range(0, TAU), R.range(-0.18, 0.18) - lx * 2.2];
      const at = [x + lx, h, z + lz];
      const place = (g) => {
        g.translate(0, -ch * 0.82, 0);
        xf(g, { r: [0, tilt[1], 0] });
        xf(g, { r: [tilt[0], 0, tilt[2]], t: at });
        return g;
      };
      b.add(place(outer), place(inner));
      if (at[1] + ch * 0.2 > top[1]) top = [at[0], at[1] + ch * 0.2, at[2]];

      // the weeping: ink gathers on the lowest points of the rim and lets go
      const world = (px, py, pz) => {
        v3.set(px, py - ch * 0.82, pz);
        v3.applyEuler(e.set(0, tilt[1], 0, 'XYZ'));
        v3.applyEuler(e.set(tilt[0], 0, tilt[2], 'XYZ'));
        return [v3.x + at[0], v3.y + at[1], v3.z + at[2]];
      };
      const low = [];
      for (let i = 0; i < RAD; i++) if (eaten[i] < 0.3) low.push(i);
      const nd = Math.min(low.length, Math.round(1 + age * 3.2));
      for (let k = 0; k < nd; k++) {
        const i = low.splice(R.int(0, low.length - 1), 1)[0];
        const a = (i / RAD) * TAU;
        const rr = cr * flare * (1 - eaten[i] * 0.1 * (0.25 + age));
        const p = world(Math.cos(a) * rr, lift + eaten[i] * ch * 0.2 * (0.25 + age), -Math.sin(a) * rr);
        const len = Math.min(p[1] - wh - 0.008, R.range(0.012, 0.034) * (0.6 + age * 0.7));
        if (len < 0.006) continue;
        const w = 0.0022 + len * 0.045;
        const d = lathe(
          [
            [0, -len],
            [w * 0.75, -len * 0.965],
            [w, -len * 0.87],
            [w * 0.5, -len * 0.62],
            [w * 0.22, -len * 0.3],
            [w * 0.3, 0.002],
          ],
          5
        );
        paint(d, {
          color: (v) => mixc(ink, dew, Math.pow(cl(-v.y / len), 2)),
          emissive: (v) => 0.5 * Math.pow(cl(-v.y / len), 3),
          rough: 0.08,
          mat: MAT.PLAIN,
          sway: 0.3,
        });
        xf(d, { t: p });
        b.add(d);
        if (!dripAt || age > dripAt.age) dripAt = { p: [p[0], p[1] - len, p[2]], age };
      }
    };

    const stub = (x, z) => {
      const h = R.range(0.012, 0.03);
      const g = tube(
        [
          [x, -0.004, z],
          [x + R.range(-0.003, 0.003), h, z + R.range(-0.003, 0.003)],
        ],
        R.range(0.005, 0.007),
        5
      );
      paint(g, { color: gradY('#3f3f3a', '#b9b3a4', 0, h), rough: 0.6, mat: MAT.PLANT });
      b.add(g);
      if (h > top[1]) top = [x, h, z];
    };
    const pin = (x, z) => {
      // a new one coming: a pale egg on a short stalk
      const h = R.range(0.014, 0.026);
      const g = lathe(
        [
          [0.0025, 0],
          [0.003, h * 0.35],
          [0.0062, h * 0.6],
          [0.005, h * 0.9],
          [0, h],
        ],
        6
      );
      paint(g, { color: gradY('#6f6c62', '#7d8480', 0, h), rough: 0.5, mat: MAT.PLANT });
      xf(g, { r: [R.range(-0.2, 0.2), 0, R.range(-0.2, 0.2)], t: [x, wh * 0.5, z] });
      b.add(g);
    };

    const n = R.int(4, 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R.range(-0.5, 0.5),
        d = i === 0 ? R.range(0, 0.015) : R.range(0.03, 0.07);
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (picked) {
        stub(x, z);
        continue;
      }
      const age = i === 0 ? R.range(0.75, 1) : R.range(0.1, 0.85);
      const h = (0.09 + age * 0.1) * R.range(0.85, 1.12);
      const cr = (0.017 + age * 0.012) * R.range(0.9, 1.1);
      shroom(x, z, h, cr, cr * R.range(1.55, 1.95) * (1 - age * 0.22), age);
    }
    for (let i = 0, k = R.int(2, 3); i < k; i++) {
      const a = R.range(0, TAU),
        d = R.range(0.04, 0.08);
      pin(Math.cos(a) * d, Math.sin(a) * d);
    }

    if (dripAt) b.emitter('drip', dripAt.p[0], dripAt.p[1], dripAt.p[2], { color: '#1d4a58', rate: 0.5 });
    b.anchor('top', top[0], top[1] + 0.01, top[2]);
    const m = b.build();
    ao(m.opaque, { height: 0.05, strength: 0.3, under: 0.1 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
