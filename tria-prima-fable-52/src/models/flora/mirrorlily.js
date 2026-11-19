// Mirrorlily: black pads lying on black water, and one funeral-pale bloom whose heart is a cup of
// silver holding a bead of living mercury. The model's y = 0 is the water surface.
// opts.picked = true -> the bloom cut, the pads and a closed bud left.
import { Builder, Rng, MAT, TAU, THREE, paint, leaf, tube, lathe, sphere, ring, xf, mixc, col, gradY } from '../kit.js';
import { register } from '../registry.js';
import { spike, aim, lean } from './_shared.js';

function padGeo(rad, notch, ph) {
  const N = 14;
  const rings = [
    [0.5, 0.0],
    [0.88, 0.0015],
    [1.0, 0.009],
  ];
  const pos = [0, -0.003, 0],
    idx = [];
  for (let j = 0; j < rings.length; j++) {
    for (let i = 0; i <= N; i++) {
      const a = notch / 2 + ((TAU - notch) * i) / N;
      const w = 1 + 0.045 * Math.sin(a * 3 + ph) + 0.03 * Math.sin(a * 7 + ph * 2.1);
      const r = rad * rings[j][0] * (j === 0 ? 1 : w);
      // the rim ripples where it meets the water
      const y = rings[j][1] + (j === 2 ? 0.004 * Math.sin(a * 5 + ph) : 0);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  const row = (j) => 1 + j * (N + 1);
  for (let i = 0; i < N; i++) idx.push(0, row(0) + i + 1, row(0) + i);
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < N; i++) {
      const a = row(j) + i,
        c = row(j + 1) + i;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

register(
  'mirrorlily',
  (seed, opts = {}) => {
    const R = new Rng(seed * 3323 + 41);
    const b = new Builder();
    const picked = !!opts.picked;
    const root = [R.range(-0.03, 0.03), -0.38, R.range(-0.03, 0.03)];

    // pads
    const np = R.int(3, 5);
    const a0 = R.range(0, TAU);
    const padC = col('#0a100c'),
      padMid = col('#18231a'),
      padRim = col('#2e1823');
    for (let i = 0; i < np; i++) {
      const a = a0 + (i / np) * TAU + R.range(-0.35, 0.35);
      const rad = R.range(0.095, 0.15) * (i === 0 ? 1.1 : 1);
      const d = R.range(0.15, 0.24) + rad * 0.25;
      const cx = Math.cos(a) * d,
        cz = Math.sin(a) * d;
      const g = padGeo(rad, R.range(0.3, 0.55), R.range(0, TAU));
      paint(g, {
        color: (v) => {
          const t = Math.hypot(v.x, v.z) / rad;
          return t < 0.6 ? mixc(padMid, padC, t / 0.6) : mixc(padC, padRim, Math.pow((t - 0.6) / 0.4, 2));
        },
        rough: 0.32,
        mat: MAT.PLANT,
        sway: 0,
      });
      // the notch points back toward the root, as it does on the real thing
      xf(g, { r: [R.range(-0.02, 0.02), Math.PI - a + R.range(-0.5, 0.5), R.range(-0.02, 0.02)], t: [cx, 0.012, cz] });
      b.add(g);
      const st = tube(
        [
          [cx, 0.008, cz],
          [cx * 0.75 + root[0] * 0.25, -0.1, cz * 0.75 + root[2] * 0.25],
          [cx * 0.25 + root[0] * 0.75, -0.26, cz * 0.25 + root[2] * 0.75],
          root,
        ],
        0.0045,
        4,
        { samples: 4, caps: false }
      );
      paint(st, { color: '#0a0f0b', rough: 0.6, mat: MAT.PLANT });
      b.add(st);
    }

    // a bud that has not opened: there in both states
    {
      const a = R.range(0, TAU),
        d = R.range(0.07, 0.11);
      const base = [Math.cos(a) * d, R.range(0.012, 0.03), Math.sin(a) * d];
      const st = tube([root, [base[0] * 0.7, -0.15, base[2] * 0.7], base], 0.005, 4, { samples: 4, caps: false });
      paint(st, { color: '#0b100c', rough: 0.6, mat: MAT.PLANT });
      b.add(st);
      const bud = lathe(
        [
          [0.005, 0],
          [0.013, 0.012],
          [0.0145, 0.03],
          [0.007, 0.056],
          [0, 0.066],
        ],
        6
      );
      paint(bud, { color: gradY('#0d130e', '#3a3a42', 0, 0.066, 2.2), rough: 0.45, mat: MAT.PLANT, sway: 0.1 });
      b.add(aim(bud, lean(R.range(0.1, 0.4), a), base));
    }

    // the bloom
    const lx = R.range(-0.025, 0.025),
      lz = R.range(-0.025, 0.025);
    const hb = picked ? R.range(0.02, 0.035) : R.range(0.075, 0.105);
    const T = [lx, hb, lz];
    const stalk = tube([root, [lx * 0.3, -0.18, lz * 0.3], [lx * 0.8, hb * 0.3 - 0.03, lz * 0.8], T], (t) => 0.0075 - 0.002 * t, 5, { samples: 6, caps: picked });
    paint(stalk, {
      color: (v) => (picked && v.y > hb - 0.004 ? col('#8f9a80') : mixc('#0a0f0b', '#1b241a', Math.max(0, Math.min(1, (v.y + 0.1) / 0.2)))),
      rough: 0.55,
      mat: MAT.PLANT,
      sway: (v) => Math.min(1, Math.max(0, v.y / hb)) * (picked ? 0.04 : 0.14),
    });
    b.add(stalk);

    if (!picked) {
      const grey = col('#3f3d4d'),
        pale = col('#9c9bab'),
        white = col('#d3d2dc');
      const SW = 0.14; // the whole head moves as one with the top of the stalk
      const petal = (len, wid, o, glow) => {
        const g = leaf(len, wid, { segs: 4, belly: 0.4, point: 1.5, ...o });
        paint(g, {
          color: (v) => {
            const t = Math.min(1, Math.max(0, v.y / len));
            const c = t < 0.4 ? mixc(grey, pale, t / 0.4) : mixc(pale, white, (t - 0.4) / 0.6);
            // a bruised midrib
            return c.multiplyScalar(1 - 0.22 * Math.max(0, 1 - Math.abs(v.x) / (wid * 0.16)));
          },
          emissive: glow,
          rough: 0.5,
          mat: MAT.PLANT,
          sway: SW,
        });
        return g;
      };
      const place = (list) => list.map((g) => xf(g, { t: T }));
      const yaw = R.range(0, TAU);
      // sepals: dark outside, they lie almost on the water
      b.add(
        place(
          ring(
            () => {
              const g = leaf(0.088, 0.042, { segs: 3, belly: 0.4, point: 1.6, curl: -0.45, fold: -0.3 });
              return paint(g, { color: gradY('#0f1510', '#2a2f2a', 0, 0.088), rough: 0.45, mat: MAT.PLANT, sway: SW });
            },
            4,
            { tilt: 1.36, radius: 0.008, yaw0: yaw }
          )
        )
      );
      // three whorls of petals, each standing a little more upright than the last
      b.add(place(ring(() => petal(R.range(0.1, 0.116), 0.044, { curl: -R.range(0.35, 0.7), fold: -0.32 }, 0.02), 8, { tilt: 1.26, radius: 0.008, yaw0: yaw + 0.4, rng: R, jitter: 0.1, y: 0.002 })));
      b.add(place(ring(() => petal(R.range(0.086, 0.098), 0.041, { curl: -R.range(0.0, 0.25), fold: -0.4 }, 0.03), 8, { tilt: 1.0, radius: 0.008, yaw0: yaw, rng: R, jitter: 0.1, y: 0.004 })));
      b.add(
        place(
          ring(
            () => {
              const g = leaf(R.range(0.064, 0.074), 0.034, { segs: 3, belly: 0.42, point: 1.4, curl: 0.3, fold: -0.5 });
              return paint(g, { color: gradY(pale, white, 0, 0.07), emissive: 0.04, rough: 0.45, mat: MAT.PLANT, sway: SW });
            },
            6,
            { tilt: 0.74, radius: 0.009, yaw0: yaw + 0.3, rng: R, jitter: 0.1, y: 0.006 }
          )
        )
      );
      // the cup: the innermost petals are not petals any more
      b.add(
        place(
          ring(
            () => {
              const g = leaf(0.05, 0.036, { segs: 3, belly: 0.5, point: 1.3, curl: 0.75, fold: -0.6 });
              return paint(g, { color: gradY('#59626c', '#c9d1db', 0, 0.044), rough: 0.12, metal: 1, emissive: 0.03, mat: MAT.PLAIN, sway: SW });
            },
            6,
            { tilt: 0.56, radius: 0.008, yaw0: yaw, y: 0.008 }
          )
        )
      );
      // filaments, silvered
      b.add(
        place(
          ring(
            () => {
              const g = spike(0.0012, R.range(0.026, 0.036), 3);
              return paint(g, { color: '#aeb6c0', rough: 0.2, metal: 1, mat: MAT.PLAIN, sway: SW });
            },
            9,
            { tilt: 0.5, radius: 0.014, y: 0.012, rng: R, jitter: 0.2 }
          )
        )
      );
      // the bead: it turns to follow you
      const bead = sphere(0.0215, 12, 9);
      bead.scale(1, 0.92, 1);
      paint(bead, { color: '#dfe6ee', rough: 0.03, metal: 1, emissive: 0.12, mat: MAT.PLAIN, sway: SW });
      xf(bead, { t: [T[0], T[1] + 0.036, T[2]] });
      b.add(bead);
      b.anchor('top', T[0], T[1] + 0.04, T[2]);
      b.light(T[0], T[1] + 0.06, T[2], '#b8c7d6', 0.25, 1.6);
    } else {
      b.anchor('top', T[0], T[1] + 0.02, T[2]);
    }

    return b.build();
  },
  { kind: 'ingredient', variants: 4 }
);
