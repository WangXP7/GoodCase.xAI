// The alchemist's furniture: workbench, ingredient shelf, lectern and alembic. Owner: MODELS-B.
// Everything is old, heavy and used: split oak, tallow, rust, stained glass.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, tint, deform, flat, box, cyl, cone, sphere, dome, torus, lathe, tube, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { ironSpec, copperSpec, brassSpec, woodSpec, stoneSpec, plank, hoop, chain, vessel, SHAPES, book, bookStack, openBook, sheet, candle, skull, glyph, hewn } from './_shared.js';

const HALF = Math.PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Timber. plank() stands along +Y; these lay one down. `at` is the centre of the piece
// (for a post: the middle of its foot).
// ---------------------------------------------------------------------------------------------
export function boardX(len, w, t, at, o) {
  const g = plank(len, w, t, o);
  g.translate(0, -len / 2, 0);
  g.rotateY(HALF);
  g.rotateZ(-HALF);
  g.translate(at[0], at[1], at[2]);
  return g;
}
export function edgeX(len, h, t, at, o) {
  const g = plank(len, h, t, o);
  g.translate(0, -len / 2, 0);
  g.rotateZ(-HALF);
  g.translate(at[0], at[1], at[2]);
  return g;
}
export function boardZ(len, w, t, at, o) {
  const g = plank(len, w, t, o);
  g.translate(0, -len / 2, 0);
  g.rotateX(HALF);
  g.translate(at[0], at[1], at[2]);
  return g;
}
export function edgeZ(len, h, t, at, o) {
  const g = plank(len, h, t, o);
  g.translate(0, -len / 2, 0);
  g.rotateY(HALF);
  g.rotateX(HALF);
  g.translate(at[0], at[1], at[2]);
  return g;
}
export function post(len, w, t, at, o) {
  const g = plank(len, w, t, o);
  g.translate(at[0], at[1], at[2]);
  return g;
}
/** A board with enough vertices along its length to take stains. Lies along X, centred. */
function fineBoardX(len, w, t, at, { tone = PAL.wood, seed = 1, worn = 0.4 } = {}) {
  const g = new THREE.BoxGeometry(w, len, t, 2, Math.max(2, Math.round(len / 0.12)), 1);
  paint(g, woodSpec(tone, seed * 3.7, { worn }));
  g.rotateY(HALF);
  g.rotateZ(-HALF);
  g.translate(at[0], at[1], at[2]);
  return g;
}
/** Scale the colours of a painted geometry: bone gone brown, brass gone dull. */
export function dim(g, r, gg = r, bb = r) {
  const ca = g.attributes.color;
  for (let i = 0; i < ca.count; i++) ca.setXYZ(i, ca.getX(i) * r, ca.getY(i) * gg, ca.getZ(i) * bb);
  return g;
}
const GLASS = { color: PAL.glass, rough: 0.08, metal: 0, mat: MAT.PLAIN };
/**
 * A closed convex shape from points and triangles, every face turned outward and flat shaded.
 * Leaves, shards, wedges: anything a lathe or a box cannot give.
 */
export function hull(P, T) {
  const c = [0, 0, 0];
  for (const q of P) {
    c[0] += q[0] / P.length;
    c[1] += q[1] / P.length;
    c[2] += q[2] / P.length;
  }
  const pos = [];
  for (const [i, j, k] of T) {
    const a = P[i],
      b = P[j],
      d = P[k];
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = d[0] - a[0],
      vy = d[1] - a[1],
      vz = d[2] - a[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const out = nx * (a[0] - c[0]) + ny * (a[1] - c[1]) + nz * (a[2] - c[2]) >= 0;
    pos.push(...a, ...(out ? b : d), ...(out ? d : b));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** A dried leaf hanging from the origin: a flattened spindle `L` long, `w` wide, curled by `curl`. */
export function blade(L, w, t, curl = 0) {
  return hull(
    [
      [0, 0, 0],
      [w, -L * 0.55, curl],
      [0, -L * 0.5, t + curl * 1.3],
      [-w, -L * 0.62, curl],
      [0, -L * 0.6, -t + curl * 0.6],
      [w * 0.2, -L, curl * 0.2],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
      [0, 4, 1],
      [5, 2, 1],
      [5, 3, 2],
      [5, 4, 3],
      [5, 1, 4],
    ]
  );
}
/** A thin iron band round a turned thing: a shallow ridge, cheaper than hoop(). */
export function band(r, h, y, seg = 12, rust = 0.6, seed = 1, t = 0.005) {
  const g = lathe(
    [
      [r - 0.002, y - h / 2],
      [r + t, y - h * 0.3],
      [r + t, y + h * 0.3],
      [r - 0.002, y + h / 2],
    ],
    seg
  );
  return paint(g, ironSpec(rust, seed, 14));
}
/** A glazed crock. */
export function crock(h, r, { seed = 1, tone = PAL.clay, lid = false } = {}) {
  const RAD = 10;
  const prof = [
    [r * 0.62, 0, 'hard'],
    [r * 0.7, 0.012],
    [r, h * 0.34],
    [r * 0.97, h * 0.62],
    [r * 0.66, h * 0.88],
    [r * 0.7, h * 0.97],
    [r * 0.74, h, 'hard'],
    [r * 0.62, h, 'hard'],
  ];
  if (lid) prof.push([r * 0.55, h + 0.012], [r * 0.2, h + 0.03], [r * 0.12, h + 0.06], [0, h + 0.065]);
  else prof.push([r * 0.6, h * 0.8], [0, h * 0.78]);
  const g = hewn(lathe(prof, RAD), RAD, { amp: r * 0.04, freq: 6, seed, squash: 0.02 });
  const cT = new THREE.Color(tone),
    cD = new THREE.Color(PAL.soot),
    cG = new THREE.Color('#2f3324');
  const nz = new Noise(seed * 13 + 3);
  return paint(g, {
    color: (v) => {
      const n = nz.fbm3(v.x * 9, v.y * 9, v.z * 9, 3);
      _c.copy(cT).multiplyScalar(0.75 + 0.4 * n);
      // a dark glaze that ran down from the shoulder and stopped short of the foot
      const run = h * (0.3 + 0.2 * nz.n2(Math.atan2(v.x, v.z) * 3, seed));
      if (v.y > run) _c.lerp(cG, 0.75);
      return _c.lerp(cD, clamp(0.5 - v.y / (h * 0.3), 0, 0.5));
    },
    rough: (v) => (v.y > h * 0.4 ? 0.35 : 0.85),
    metal: 0,
    mat: MAT.PLAIN,
  });
}

// =============================================================================================
// Workbench
// =============================================================================================
register(
  'workbench',
  () => {
    const b = new Builder();
    const R = new Rng(311);
    const nz = new Noise(41);
    let k = 0;
    const o = (x = {}) => ({ tone: PAL.woodDark, worn: 0.35, seed: ++k, ...x });
    const TOP = 0.9,
      W = 2.2,
      D = 0.9;

    // the top: four thick boards with uneven ends, burnt and stained
    {
      const widths = [0.235, 0.21, 0.24, 0.215];
      const top = [];
      let z = -D / 2;
      for (let i = 0; i < 4; i++) {
        const len = W + R.range(-0.04, 0.02);
        top.push(fineBoardX(len, widths[i] - 0.006, 0.07, [R.range(-0.012, 0.012), TOP - 0.035 - (i === 2 ? 0.004 : 0), z + widths[i] / 2], { seed: ++k, worn: 0.5 }));
        z += widths[i];
      }
      const g = merge(top);
      const burns = [
        [0.93, -0.32, 0.22, 0.75],
        [-0.84, -0.16, 0.2, 0.6],
        [0.2, 0.28, 0.12, 0.5],
      ];
      tint(g, (v) => {
        if (v.ny < 0.5) return 0.85;
        let s = 1;
        const spill = nz.fbm2(v.x * 2.2 + 4, v.z * 2.2, 3);
        if (spill > 0.18) s *= 1 - Math.min(0.5, (spill - 0.18) * 1.6);
        for (const [x, z2, r, kk] of burns) {
          const d = Math.hypot(v.x - x, v.z - z2);
          if (d < r) s *= 1 - kk * (1 - d / r);
        }
        return s;
      });
      b.add(g);
    }
    // frame
    {
      const wood = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(post(TOP - 0.068, 0.13, 0.13, [sx * 0.98, 0, sz * 0.33], o()));
      for (const sz of [-1, 1]) wood.push(edgeX(1.84, 0.15, 0.04, [0, TOP - 0.145, sz * 0.365], o()));
      for (const sx of [-1, 1]) {
        wood.push(edgeZ(0.54, 0.15, 0.04, [sx * 1.015, TOP - 0.145, 0], o()));
        wood.push(edgeZ(0.54, 0.09, 0.05, [sx * 0.98, 0.2, 0], o()));
      }
      wood.push(edgeX(1.84, 0.09, 0.05, [0, 0.2, -0.33], o()));
      // a low shelf of two boards, one shorter than the other
      wood.push(boardX(1.9, 0.21, 0.03, [0, 0.262, -0.19], o({ worn: 0.5 })));
      wood.push(boardX(1.62, 0.2, 0.03, [-0.13, 0.262, 0.03], o({ worn: 0.5 })));
      // peg ends on the legs
      const pegs = [];
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          for (const y of [0.2, TOP - 0.14]) {
            const p = cyl(0.014, 0.014, 0.012, 6);
            p.rotateX(HALF);
            p.translate(sx * 0.98 + 0.02 * sx, y, sz * 0.33 + sz * 0.066);
            pegs.push(p);
          }
      wood.push(paint(merge(pegs.map((g) => paint(g, {}))), woodSpec(PAL.woodLight, 5, { worn: 0.2 })));
      b.add(wood);
    }

    // --- a flask on a retort stand over a spirit lamp
    {
      const x = -0.83,
        z = -0.17;
      const iron = [];
      const base = box(0.22, 0.014, 0.15);
      base.translate(x, TOP + 0.007, z);
      iron.push(base);
      const rod = cyl(0.007, 0.008, 0.56, 6);
      rod.translate(x - 0.07, TOP + 0.29, z - 0.04);
      iron.push(rod);
      // a ring under the belly and a smaller one round the neck, each on its own boss
      for (const [ry, rr, ex, ez] of [
        [0.236, 0.053, -0.0044, -0.0143],
        [0.38, 0.027, 0.0198, -0.0048],
      ]) {
        const ring = torus(rr, 0.0055, 4, 10);
        ring.translate(x + 0.045, TOP + ry, z + 0.005);
        iron.push(ring);
        iron.push(
          tube(
            [
              [x - 0.07, TOP + ry, z - 0.04],
              [x + ex, TOP + ry, z + ez],
            ],
            0.0055,
            4
          )
        );
        const boss = box(0.028, 0.028, 0.028);
        boss.translate(x - 0.07, TOP + ry, z - 0.04);
        iron.push(boss);
      }
      b.add(paint(merge(iron.map((g) => paint(g, {}))), ironSpec(0.45, 7, 9)));
      vessel(b, SHAPES.round(0.2, 0.075), { xform: { t: [x + 0.045, TOP + 0.214, z + 0.005] }, liquid: '#32481f', fill: 0.4, cork: false, radial: 10, seed: 2, dirty: 0.5 });
      // the lamp: a squat brass pot with a wick tube, cold
      const lamp = lathe(
        [
          [0.03, 0, 'hard'],
          [0.046, 0.008],
          [0.05, 0.03],
          [0.03, 0.05],
          [0.012, 0.056, 'hard'],
          [0.012, 0.075, 'hard'],
          [0, 0.075],
        ],
        8
      );
      lamp.translate(x + 0.045, TOP + 0.014, z + 0.005);
      b.add(dim(paint(lamp, brassSpec(3)), 0.6));
    }

    // --- mortar and pestle, a spill of brimstone beside them
    {
      const x = -0.5,
        z = 0.2;
      const RAD = 10;
      const m = hewn(
        lathe(
          [
            [0.05, 0, 'hard'],
            [0.062, 0.012],
            [0.058, 0.03],
            [0.09, 0.075],
            [0.094, 0.1, 'hard'],
            [0.078, 0.102, 'hard'],
            [0.062, 0.06],
            [0.03, 0.036],
            [0, 0.032],
          ],
          RAD
        ),
        RAD,
        { amp: 0.004, freq: 12, seed: 3 }
      );
      m.translate(x, TOP, z);
      b.add(paint(m, stoneSpec(PAL.stone, 3, 0.9)));
      const powder = dome(0.05, 8, 2, 0.3);
      powder.translate(x, TOP + 0.036, z);
      const heap = dome(0.05, 7, 2, 0.35);
      heap.scale(1.3, 1, 0.8);
      heap.translate(x - 0.19, TOP, z + 0.09);
      b.add(paint(merge(paint(powder, {}), paint(heap, {})), { color: (v) => _c.set(PAL.sulfur).multiplyScalar(0.4 + 0.22 * nz.n3(v.x * 40, v.y * 40, v.z * 40)), rough: 1, metal: 0, mat: MAT.PLAIN }));
      const p = lathe(
        [
          [0, 0],
          [0.019, 0.006],
          [0.021, 0.03],
          [0.012, 0.06],
          [0.011, 0.16],
          [0.014, 0.175],
          [0, 0.18],
        ],
        7
      );
      p.rotateZ(-0.95);
      p.translate(x - 0.02, TOP + 0.05, z + 0.01);
      b.add(paint(p, stoneSpec(PAL.stoneDark, 4, 1.1)));
    }

    // --- books, and on them a skull that has served as a candlestick for years
    {
      const x = -0.2,
        z = -0.22;
      const st = bookStack(R, 3, { w: 0.21, d: 0.28 });
      st.geo.rotateY(0.3);
      st.geo.translate(x, TOP, z);
      b.add(st.geo);
      const sk = skull(0.175, { seed: 2, jaw: false });
      dim(sk, 0.62, 0.56, 0.44);
      sk.rotateY(0.45);
      sk.translate(x + 0.005, TOP + st.top, z + 0.01);
      b.add(sk);
      const c = candle(R, 0.045, 0.016, { drips: 2, pool: true });
      c.geo.translate(x - 0.004, TOP + st.top + 0.168, z - 0.006);
      b.add(c.geo);
      // tallow run down the brow and one temple
      const runs = [];
      [-1.25, 0.15, 1.5].forEach((da, i) => {
        const a = 0.45 + da;
        const sx = Math.sin(a),
          cz = Math.cos(a);
        runs.push(
          tube(
            [
              [x + sx * 0.02, TOP + st.top + 0.172, z + cz * 0.02],
              [x + sx * 0.052, TOP + st.top + 0.152, z + cz * 0.052],
              [x + sx * 0.071, TOP + st.top + 0.118 - i * 0.022, z + cz * 0.071],
            ],
            (t) => 0.0035 + 0.0028 * t,
            4,
            { samples: 4 }
          )
        );
      });
      b.add(paint(merge(runs.map((g) => paint(g, {}))), { color: '#a99d7d', rough: 0.55, metal: 0, mat: MAT.PLAIN }));
    }

    // --- the letter, where it was left: the game hangs its page at (0.15, 0.98, 0.1)
    {
      const s = sheet(0.21, 0.29, { seed: 3, curl: 0.014 });
      const lines = [];
      for (let i = 0; i < 8; i++) {
        const lw = i === 7 ? 0.07 : R.range(0.12, 0.165);
        const ln = box(lw, 0.0006, 0.0055);
        ln.translate(-0.0825 + lw / 2 + 0.005, 0.0052, -0.11 + i * 0.025);
        lines.push(ln);
      }
      const ink = paint(merge(lines.map((g) => paint(g, {}))), { color: PAL.ink, rough: 0.9, metal: 0, mat: MAT.PLAIN });
      const seal = paint(cyl(0.013, 0.015, 0.004, 8), { color: PAL.blood, rough: 0.4, metal: 0, mat: MAT.PLAIN });
      seal.translate(0.06, 0.006, 0.115);
      const g = merge(s, ink, seal);
      g.rotateY(0.22);
      g.translate(0.15, TOP, 0.1);
      b.add(g);
      // inkwell and quill
      const well = lathe(
        [
          [0.022, 0, 'hard'],
          [0.03, 0.006],
          [0.032, 0.03],
          [0.018, 0.042],
          [0.016, 0.05, 'hard'],
          [0.011, 0.05, 'hard'],
          [0.011, 0.03],
          [0, 0.03],
        ],
        8
      );
      well.translate(0.37, TOP, -0.03);
      b.add(paint(well, { color: '#1b1d20', rough: 0.3, metal: 0.7, mat: MAT.METAL }));
      const quill = tube(
        [
          [0, 0, 0],
          [0.006, 0.09, 0],
          [0.02, 0.2, 0],
        ],
        (t) => 0.0022 * (1 - 0.6 * t),
        4,
        { samples: 4 }
      );
      const vane = new THREE.BufferGeometry();
      vane.setAttribute('position', new THREE.Float32BufferAttribute([0.005, 0.075, 0, 0.03, 0.13, 0.004, 0.021, 0.205, 0, 0.005, 0.075, 0, 0.021, 0.205, 0, -0.008, 0.14, -0.004], 3));
      vane.computeVertexNormals();
      const q = merge(paint(quill, { color: PAL.boneOld, rough: 0.7, mat: MAT.PLAIN }), paint(vane, { color: '#3a3833', rough: 0.9, mat: MAT.PLAIN }));
      q.rotateZ(-0.5);
      q.rotateY(0.8);
      q.translate(0.37, TOP + 0.03, -0.03);
      b.add(q);
    }

    // --- the balance
    {
      const x = 0.56,
        z = -0.23;
      const parts = [];
      parts.push(
        lathe(
          [
            [0.075, 0, 'hard'],
            [0.078, 0.008],
            [0.05, 0.02],
            [0.016, 0.03],
            [0.009, 0.05],
            [0.008, 0.3],
            [0.015, 0.31],
            [0.007, 0.325],
            [0, 0.335],
          ],
          8
        )
      );
      const tilt = 0.17;
      const arm = 0.18;
      const beam = box(arm * 2 + 0.02, 0.009, 0.009);
      beam.rotateZ(tilt);
      beam.translate(0, 0.3, 0);
      parts.push(beam);
      const pans = [];
      for (const s of [-1, 1]) {
        const ex = s * arm * Math.cos(tilt),
          ey = 0.3 + s * arm * Math.sin(tilt);
        const drop = 0.15;
        const pan = lathe(
          [
            [0, -0.012],
            [0.035, -0.01],
            [0.056, 0.0, 'hard'],
            [0.054, 0.003, 'hard'],
            [0.034, -0.006],
            [0, -0.008],
          ],
          9
        );
        pan.translate(ex, ey - drop, 0);
        parts.push(pan);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + 0.4;
          parts.push(
            tube(
              [
                [ex, ey - 0.004, 0],
                [ex + Math.sin(a) * 0.054, ey - drop + 0.002, Math.cos(a) * 0.054],
              ],
              0.0014,
              3,
              { samples: 1 }
            )
          );
        }
        pans.push([ex, ey - drop]);
      }
      const g = dim(paint(merge(parts.map((q) => paint(q, {}))), brassSpec(2)), 0.72, 0.7, 0.6);
      g.rotateY(-0.3);
      g.translate(x, TOP, z);
      b.add(g);
      // salt in the low pan, two weights in the high one
      const salt = dome(0.03, 7, 2, 0.55);
      salt.translate(pans[0][0], pans[0][1] - 0.007, 0);
      const sg = paint(salt, { color: PAL.salt, rough: 0.9, metal: 0, mat: MAT.CRYSTAL });
      const w1 = cyl(0.011, 0.013, 0.02, 6);
      w1.translate(pans[1][0] - 0.012, pans[1][1] + 0.004, 0.006);
      const w2 = cyl(0.008, 0.009, 0.014, 6);
      w2.translate(pans[1][0] + 0.016, pans[1][1] + 0.001, -0.01);
      const wg = paint(merge(paint(w1, {}), paint(w2, {})), ironSpec(0.2, 3, 20));
      const both = merge(sg, wg);
      both.rotateY(-0.3);
      both.translate(x, TOP, z);
      b.add(both);
    }

    // --- jars and bottles
    vessel(b, SHAPES.jar(0.17, 0.052), { xform: { t: [0.8, TOP, 0.2] }, liquid: '#4f1513', fill: 0.7, cork: 'cloth', radial: 9, seed: 4 });
    vessel(b, SHAPES.tall(0.25, 0.046), { xform: { t: [0.95, TOP, 0.04] }, liquid: '#24382c', fill: 0.5, cork: 'wax', radial: 9, seed: 5 });
    vessel(b, SHAPES.squat(0.115, 0.058), { xform: { t: [0.66, TOP, 0.31] }, liquid: '#7a5a1e', fill: 0.6, cork: true, radial: 9, seed: 6 });
    vessel(b, SHAPES.cone(0.16, 0.05), { xform: { t: [1.0, TOP + 0.05, 0.33], r: [HALF + 0.03, 0, 0.7] }, liquid: null, fill: 0, cork: false, radial: 9, seed: 7, dirty: 0.6 });

    // --- two stubs in a saucer of tallow
    {
      const x = 0.93,
        z = -0.32;
      const dish = lathe(
        [
          [0, 0],
          [0.05, 0.002],
          [0.075, 0.016, 'hard'],
          [0.072, 0.019, 'hard'],
          [0.05, 0.008],
          [0, 0.006],
        ],
        10
      );
      dish.translate(x, TOP, z);
      b.add(dim(paint(dish, brassSpec(7)), 0.5));
      const c1 = candle(R, 0.095, 0.018, { drips: 3 });
      c1.geo.translate(x - 0.015, TOP + 0.006, z + 0.005);
      const c2 = candle(R, 0.04, 0.02, { drips: 1 });
      c2.geo.translate(x + 0.03, TOP + 0.006, z - 0.02);
      b.add(c1.geo, c2.geo);
    }

    // --- a knife left standing in the board
    {
      const blade = box(0.022, 0.13, 0.003);
      blade.translate(0, 0.06, 0);
      const guard = box(0.05, 0.008, 0.012);
      guard.translate(0, 0.127, 0);
      const grip = cyl(0.01, 0.012, 0.085, 6);
      grip.translate(0, 0.173, 0);
      const g = merge(paint(blade, { color: PAL.steel, rough: 0.35, metal: 0.9, mat: MAT.METAL }), paint(guard, ironSpec(0.3, 2, 20)), paint(grip, woodSpec(PAL.woodDark, 9)));
      g.rotateZ(0.32);
      g.rotateY(0.9);
      g.translate(-0.02, TOP - 0.012, 0.33);
      b.add(g);
    }

    // --- under the bench: crocks and a coil of rope
    {
      const c1 = crock(0.3, 0.13, { seed: 2, lid: true });
      c1.translate(-0.62, 0.277, -0.13);
      const c2 = crock(0.2, 0.1, { seed: 5, tone: '#5a4a3a' });
      c2.translate(-0.3, 0.277, -0.07);
      b.add(c1, c2);
      const rope = [];
      for (let i = 0; i < 3; i++) {
        const t = torus(0.12 - i * 0.012, 0.016, 5, 14);
        t.rotateY(i * 0.7);
        t.translate(0.45 + R.range(-0.01, 0.01), 0.295 + i * 0.028, -0.08 + R.range(-0.01, 0.01));
        rope.push(t);
      }
      b.add(paint(merge(rope.map((g) => paint(g, {}))), { color: (v) => _c.set(PAL.rope).multiplyScalar(0.6 + 0.3 * Math.sin((v.x + v.z) * 180)), rough: 0.95, metal: 0, mat: MAT.CLOTH }));
    }

    b.boxCollider(0, TOP / 2, 0, W / 2, TOP / 2, D / 2);
    return b.build();
  },
  { kind: 'prop', variants: 1, topY: 0.9 }
);

// =============================================================================================
// Ingredient shelf
// =============================================================================================
register(
  'shelf',
  () => {
    const b = new Builder();
    const R = new Rng(733);
    let k = 0;
    const o = (x = {}) => ({ tone: PAL.woodDark, worn: 0.4, seed: ++k + 30, ...x });
    const W = 1.8,
      H = 2.4,
      D = 0.4;
    const SH = [0.1, 0.6, 1.08, 1.53, 1.96]; // undersides... the boards' middles
    const T = 0.036;
    const wood = [];
    wood.push(post(H, 0.046, D, [-(W / 2 - 0.023), 0, 0], o()));
    wood.push(post(H - 0.035, 0.046, D, [W / 2 - 0.023, 0, 0], o()));
    SH.forEach((y, i) => wood.push(boardX(W - 0.094 + (i === 2 ? -0.004 : 0), D - 0.02, T, [0, y, 0.004], o({ worn: 0.55 }))));
    wood.push(boardX(W + 0.07, D + 0.05, 0.042, [0.005, H - 0.03, 0.012], o()));
    wood.push(edgeX(W - 0.094, 0.082, 0.03, [0, 0.041, D / 2 - 0.035], o()));
    // the back: upright boards, two of them gone and one snapped off short
    {
      const n = 8,
        bw = (W - 0.1) / n;
      for (let i = 0; i < n; i++) {
        if (i === 2 || i === 6) continue;
        const short = i === 5;
        wood.push(post(short ? 1.25 : H - 0.09 - R.range(0, 0.03), bw - 0.006, 0.016, [-(W - 0.1) / 2 + bw * (i + 0.5), 0.03, -D / 2 + 0.012], o({ tone: PAL.wood, worn: 0.6 })));
      }
    }
    b.add(wood);
    const top = (i) => SH[i] + T / 2;

    // bottom board: crocks, a small keg on chocks, a stack of bowls
    {
      const c1 = crock(0.34, 0.14, { seed: 7, lid: true });
      c1.translate(-0.58, top(0), 0.0);
      const c2 = crock(0.26, 0.12, { seed: 9, tone: '#4f4135' });
      c2.translate(-0.24, top(0), 0.03);
      b.add(c1, c2);
      const RAD = 10;
      const keg = lathe(
        [
          [0, 0],
          [0.1, 0, 'hard'],
          [0.125, 0.08],
          [0.132, 0.16],
          [0.125, 0.24],
          [0.1, 0.32, 'hard'],
          [0, 0.32],
        ],
        RAD
      );
      paint(keg, woodSpec(PAL.wood, 14, { worn: 0.3 }));
      const hoops = [band(0.113, 0.024, 0.045, RAD, 0.7, 1), band(0.113, 0.024, 0.275, RAD, 0.6, 2)];
      const kg = merge(keg, hoops);
      kg.rotateZ(HALF);
      kg.translate(0.5, top(0) + 0.14, 0.0);
      b.add(kg);
      for (const dx of [0.24, 0.44]) {
        const ch = paint(box(0.04, 0.03, 0.2), woodSpec(PAL.woodDark, 3));
        ch.rotateZ(dx < 0.3 ? 0.5 : -0.5);
        ch.translate(dx + 0.0, top(0) + 0.015, 0);
        b.add(ch);
      }
      const bowls = [];
      for (let i = 0; i < 3; i++) {
        const bw = lathe(
          [
            [0.03, 0, 'hard'],
            [0.075, 0.035, 'hard'],
            [0.07, 0.037, 'hard'],
            [0.03, 0.006],
            [0, 0.006],
          ],
          8
        );
        bw.translate(0.74 + R.range(-0.004, 0.004), top(0) + i * 0.014, 0.02 + R.range(-0.004, 0.004));
        bowls.push(bw);
      }
      b.add(paint(merge(bowls.map((g) => paint(g, {}))), woodSpec(PAL.woodLight, 8, { worn: 0.5 })));
    }

    // second board: jars under tied cloth
    {
      const liquids = ['#3a2a16', '#263a22', '#4a1512', '#16161a', '#55501e'];
      let x = -0.76;
      for (let i = 0; i < 5; i++) {
        const r = R.range(0.052, 0.078),
          h = R.range(0.17, 0.3);
        vessel(b, SHAPES.jar(h, r), { xform: { t: [x + r, top(1), R.range(-0.06, 0.05)] }, liquid: liquids[i], fill: R.range(0.45, 0.85), cork: i === 3 ? 'wax' : 'cloth', radial: 7, seed: 20 + i, dirty: 0.55 });
        x += r * 2 + R.range(0.1, 0.16);
      }
      // the last one lies empty on its side
      vessel(b, SHAPES.jar(0.21, 0.058), { xform: { t: [0.78, top(1) + 0.058, -0.03], r: [HALF, 0, 1.25] }, liquid: null, fill: 0, cork: false, radial: 7, seed: 31, dirty: 0.75 });
    }
    // third board: stoppered flasks
    {
      const kinds = [
        ['round', 0.2, 0.075, '#8f98a3', true],
        ['cone', 0.24, 0.07, '#a8891e', true],
        ['tall', 0.3, 0.05, '#571613', 'wax'],
        ['squat', 0.14, 0.07, '#2c6e6a', true],
        ['round', 0.16, 0.06, '#101013', 'wax'],
        ['tall', 0.26, 0.045, '#3f4a22', true],
      ];
      let x = -0.76;
      kinds.forEach(([shape, h, r, liquid, cork], i) => {
        vessel(b, SHAPES[shape](h, r), { xform: { t: [x + r, top(2), R.range(-0.05, 0.06)] }, liquid, fill: R.range(0.35, 0.75), cork, radial: r > 0.065 ? 8 : 7, seed: 40 + i, glow: i === 3 ? 0.35 : 0, dirty: 0.45 });
        x += r * 2 + R.range(0.1, 0.16);
      });
    }
    // fourth board: books on end, a small skull, scrolls
    {
      const covers = [PAL.clothRed, PAL.clothBlack, PAL.woodDark, PAL.clothBlue, '#3a3324', PAL.clothBlack, '#4a3a22'];
      let x = -0.8;
      for (let i = 0; i < 7; i++) {
        const t = R.range(0.035, 0.07),
          h = R.range(0.22, 0.31),
          dp = R.range(0.17, 0.22);
        const g = book(dp, h, t, { cover: covers[i], seed: 50 + i });
        g.translate(0, -t / 2, 0);
        g.rotateX(-HALF);
        g.rotateY(HALF);
        const leanBook = i === 6 ? 0.3 : R.range(-0.03, 0.03);
        g.translate(0, h / 2, 0);
        g.rotateZ(-leanBook);
        g.translate(x + t / 2 + (i === 6 ? 0.045 : 0), top(3), 0.02 + R.range(-0.02, 0.02));
        b.add(g);
        x += t + 0.004;
      }
      const sk = skull(0.13, { seed: 6 });
      dim(sk, 0.6, 0.54, 0.42);
      sk.rotateY(-0.5);
      sk.translate(0.08, top(3), 0.04);
      b.add(sk);
      const scrolls = [];
      for (let i = 0; i < 4; i++) {
        const s = cyl(0.022, 0.022, R.range(0.24, 0.3), 7);
        s.rotateX(HALF);
        s.rotateY(R.range(-0.25, 0.25) + HALF * 0);
        s.translate(0.42 + (i % 2) * 0.05 + (i > 1 ? 0.025 : 0), top(3) + 0.022 + (i > 1 ? 0.04 : 0), 0.0);
        scrolls.push(s);
      }
      b.add(paint(merge(scrolls.map((g) => paint(g, {}))), { color: (v) => _c.set(PAL.vellum).multiplyScalar(Math.abs(v.nz) > 0.9 ? 0.45 : 0.8), rough: 0.9, metal: 0, mat: MAT.PLAIN }));
      const jar = crock(0.18, 0.075, { seed: 11, tone: '#55473a', lid: true });
      jar.translate(0.72, top(3), 0.02);
      b.add(jar);
    }
    // top board: a small coffer, small bottles, a coil of copper
    {
      const cof = [edgeX(0.34, 0.15, 0.2, [0, 0.075, 0], o({ tone: PAL.wood })), boardX(0.36, 0.22, 0.025, [0, 0.162, 0], o())];
      const cg = merge(cof);
      cg.rotateY(0.12);
      cg.translate(-0.52, top(4), 0.0);
      b.add(cg);
      const straps = [];
      for (const dx of [-0.11, 0.11]) {
        const s = box(0.03, 0.18, 0.006);
        s.translate(dx, 0.09, 0.103);
        straps.push(s);
      }
      const sg = paint(merge(straps.map((g) => paint(g, {}))), ironSpec(0.7, 2, 14));
      sg.rotateY(0.12);
      sg.translate(-0.52, top(4), 0.0);
      b.add(sg);
      for (let i = 0; i < 3; i++) vessel(b, SHAPES.squat(R.range(0.09, 0.12), 0.038), { xform: { t: [-0.13 + i * 0.125, top(4), R.range(-0.04, 0.05)] }, liquid: ['#3a1210', '#262e14', '#6b5a1e'][i], fill: R.range(0.3, 0.7), cork: true, radial: 6, seed: 70 + i });
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * TAU * 3.2;
        pts.push([0.55 + Math.sin(a) * 0.085, top(4) + 0.012 + i * 0.0045, 0.01 + Math.cos(a) * 0.085]);
      }
      b.add(paint(tube(pts, 0.008, 4, { samples: 30 }), copperSpec(0.6, 3, { yLo: top(4), yHi: top(4) + 0.12, f: 12 })));
    }
    // dried herbs hung head down from a rod under the top board
    {
      const y0 = H - 0.092,
        z0 = D / 2 - 0.035;
      const rod = cyl(0.006, 0.006, W - 0.16, 5);
      rod.rotateZ(HALF);
      rod.translate(0, H - 0.085, z0);
      b.add(paint(rod, ironSpec(0.7, 4, 12)));
      const tones = [PAL.leafDry, '#4f4a2c', '#4a2f3a', PAL.leafDead, '#5d5631'];
      const cT = new THREE.Color();
      const ties = [];
      [
        [-0.66, 0.3, 0],
        [-0.38, 0.22, 1],
        [-0.03, 0.34, 0],
        [0.34, 0.25, 2],
        [0.63, 0.29, 1],
      ].forEach(([x, len, kind], bi) => {
        cT.set(tones[bi]);
        const parts = [];
        // long leaves tied by their stalks, the outer ones splayed and curled
        const n = kind === 2 ? 6 : 8;
        for (let i = 0; i < n; i++) {
          const L = len * R.range(0.6, 1.0),
            w = (kind === 2 ? 0.03 : 0.019) * R.range(0.7, 1.25);
          const g = blade(L, w, 0.005, R.range(-0.02, 0.02));
          g.rotateY(R.range(0, TAU));
          g.rotateZ((i < 2 ? 0.03 : R.range(0.08, 0.3)) * (kind === 2 ? 0.7 : 1));
          g.rotateY((i / n) * TAU + R.range(-0.4, 0.4));
          g.translate(0, -0.045, 0);
          const k = R.range(0.6, 1.25);
          parts.push(paint(g, { color: (v) => _c.copy(cT).multiplyScalar(k * (0.75 + 0.5 * clamp(-v.y / len, 0, 1))), rough: 0.95, metal: 0, mat: MAT.PLANT }));
        }
        // the stalks above the tie, and a few stems with seed heads
        const stalk = paint(cyl(0.009, 0.013, 0.07, 5), { color: _c.set(PAL.leafDead).multiplyScalar(0.6).clone(), rough: 0.95, metal: 0, mat: MAT.PLANT });
        stalk.translate(0, -0.028, 0);
        parts.push(stalk);
        if (kind !== 2)
          for (let i = 0; i < 3; i++) {
            const a = R.range(0, TAU),
              sp = R.range(0.03, 0.075),
              l = len * R.range(0.7, 1.12);
            const ex = Math.sin(a) * sp,
              ez = Math.cos(a) * sp;
            const st = tube(
              [
                [ex * 0.1, -0.04, ez * 0.1],
                [ex * 0.5, -l * 0.55, ez * 0.5],
                [ex, -l, ez],
              ],
              0.0022,
              3,
              { samples: 2, caps: false }
            );
            const head = kind === 1 ? sphere(0.012, 5, 3) : cone(0.009, 0.03, 4);
            if (kind === 1) head.scale(1, 1.45, 1);
            else head.rotateZ(Math.PI);
            head.translate(ex, -l - 0.006, ez);
            parts.push(paint(merge(paint(st, {}), paint(head, {})), { color: _c.set(kind === 1 ? '#3b2f25' : '#6a5f38').clone(), rough: 0.95, metal: 0, mat: MAT.PLANT }));
          }
        const g = merge(parts);
        paint(g, { sway: (v) => 0.28 * clamp(-v.y / len, 0, 1) });
        g.scale(1, 1, 0.8);
        g.translate(x, y0 - 0.012, z0);
        b.add(g);
        const tie = torus(0.013, 0.004, 3, 6);
        tie.translate(x, y0 - 0.058, z0);
        ties.push(tie);
        // the loop over the rod
        const lp = torus(0.011, 0.0025, 3, 6);
        lp.rotateX(HALF);
        lp.rotateY(HALF);
        lp.translate(x, y0 + 0.004, z0);
        ties.push(lp);
      });
      b.add(paint(merge(ties.map((g) => paint(g, {}))), { color: PAL.rope, rough: 0.95, metal: 0, mat: MAT.CLOTH }));
    }

    b.boxCollider(0, H / 2, 0, W / 2, H / 2, D / 2);
    return b.build();
  },
  { kind: 'prop', variants: 1 }
);

// =============================================================================================
// Lectern
// =============================================================================================
register(
  'lectern',
  () => {
    const b = new Builder();
    const R = new Rng(977);
    const SLOPE = 0.52; // the desk falls toward the reader, who stands at +Z
    const DY = 1.1,
      DZ = 0.03;
    const oak = (seed, tone = PAL.woodDark) => woodSpec(tone, seed, { worn: 0.35 });
    // stepped foot and an eight-sided shaft with two collars, cut on a pole lathe and then carved
    const foot = flat(
      lathe(
        [
          [0, 0],
          [0.31, 0, 'hard'],
          [0.31, 0.055, 'hard'],
          [0.25, 0.075, 'hard'],
          [0.25, 0.13, 'hard'],
          [0.17, 0.2, 'hard'],
          [0.11, 0.24, 'hard'],
        ],
        8
      )
    );
    const shaft = flat(
      lathe(
        [
          [0.11, 0.24, 'hard'],
          [0.082, 0.3, 'hard'],
          [0.082, 0.5, 'hard'],
          [0.108, 0.52, 'hard'],
          [0.108, 0.6, 'hard'],
          [0.082, 0.62, 'hard'],
          [0.076, 0.84, 'hard'],
          [0.1, 0.875, 'hard'],
          [0.1, 0.905, 'hard'],
          [0.145, 0.95, 'hard'],
          [0.155, 0.962, 'hard'],
          [0, 0.962],
        ],
        8
      )
    );
    foot.rotateY(Math.PI / 8);
    shaft.rotateY(Math.PI / 8);
    b.add(paint(foot, oak(3)), paint(shaft, oak(5)));
    // the three signs cut into the collar, one to a face
    ['salt', 'mercury', 'sulfur'].forEach((name, i) => {
      const g = glyph(name, 0.058, { width: 0.09, depth: 0.004 });
      g.translate(0, 0.56, 0.101);
      g.rotateY((i - 1) * (Math.PI / 4));
      b.add(g);
    });
    // desk, lip, cheeks and the book, built level and then tipped
    const tip = (g) => {
      g.rotateX(SLOPE);
      g.translate(0, DY, DZ);
      return g;
    };
    const tipPoint = (x, y, z) => [x, DY + y * Math.cos(SLOPE) - z * Math.sin(SLOPE), DZ + y * Math.sin(SLOPE) + z * Math.cos(SLOPE)];
    {
      const desk = [];
      desk.push(boardZ(0.44, 0.27, 0.034, [-0.134, 0, 0], { tone: PAL.woodDark, worn: 0.4, seed: 11 }));
      desk.push(boardZ(0.445, 0.265, 0.034, [0.135, -0.002, 0], { tone: PAL.woodDark, worn: 0.4, seed: 12 }));
      desk.push(edgeX(0.54, 0.045, 0.03, [0, 0.03, 0.212], { tone: PAL.wood, worn: 0.5, seed: 13 }));
      // battens under the boards
      desk.push(edgeX(0.5, 0.04, 0.04, [0, -0.036, -0.14], { tone: PAL.woodDark, seed: 14 }));
      desk.push(edgeX(0.5, 0.04, 0.04, [0, -0.036, 0.12], { tone: PAL.woodDark, seed: 15 }));
      b.add(tip(merge(desk)));
      const bk = openBook(0.44, 0.31, { seed: 4, cover: PAL.clothBlack });
      bk.translate(0, 0.017, 0.035);
      b.add(tip(bk));
      // iron corners on the desk and a staple for the chain
      const irons = [];
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const c = box(0.07, 0.006, 0.07);
          c.translate(sx * 0.237, 0.019, sz * 0.19);
          irons.push(c);
        }
      b.add(tip(paint(merge(irons.map((g) => paint(g, {}))), ironSpec(0.7, 5, 14))));
    }
    // the head block that carries the desk: a wedge cut to the slope
    {
      const g = new THREE.BoxGeometry(0.21, 1, 0.25, 1, 1, 2);
      const under = (z) => DY - (z - DZ) * Math.tan(SLOPE) - 0.021;
      deform(g, (p) => {
        p.y = p.y < 0 ? 0.955 : under(p.z);
        if (p.y < 0.96) {
          p.x *= 0.74;
          p.z *= 0.8;
        }
      });
      b.add(paint(flat(g), oak(21)));
    }
    // the book was chained: the chain runs from the cover to a ring in the shaft
    {
      const a = tipPoint(-0.2, 0.012, 0.19);
      const ringAt = [-0.1, 0.72, 0.03];
      const ring = torus(0.022, 0.005, 4, 8);
      ring.rotateZ(HALF);
      ring.translate(ringAt[0], ringAt[1], ringAt[2]);
      b.add(paint(ring, ironSpec(0.8, 6, 14)));
      b.add(chain(a, [ringAt[0] - 0.012, ringAt[1] - 0.02, ringAt[2]], { sag: 0.16, link: 0.052, wire: 0.0052, rust: 0.8, seed: 5 }));
    }
    // a pricket on an iron arm, the stub in it long cold
    {
      const tipAt = [0.33, 1.2, -0.06];
      b.add(
        paint(
          tube(
            [
              [0.08, 0.95, -0.02],
              [0.2, 0.99, -0.04],
              [0.3, 1.08, -0.06],
              [tipAt[0], tipAt[1], tipAt[2]],
            ],
            0.008,
            4,
            { samples: 8 }
          ),
          ironSpec(0.75, 9, 12)
        )
      );
      const pan = lathe(
        [
          [0, 0],
          [0.035, 0.002],
          [0.05, 0.014, 'hard'],
          [0.047, 0.016, 'hard'],
          [0.03, 0.007],
          [0, 0.006],
        ],
        8
      );
      pan.translate(tipAt[0], tipAt[1], tipAt[2]);
      b.add(paint(pan, ironSpec(0.7, 2, 12)));
      const c = candle(R, 0.1, 0.017, { drips: 4 });
      c.geo.translate(tipAt[0], tipAt[1] + 0.006, tipAt[2]);
      b.add(c.geo);
    }
    const pg = tipPoint(0, 0.05, 0.035);
    b.anchor('page', pg[0], pg[1], pg[2]);
    b.cylCollider(0, 0.65, 0, 0.32, 1.3);
    return b.build();
  },
  { kind: 'prop', variants: 1 }
);

// =============================================================================================
// Alembic: cucurbit and head on an iron tripod, a copper worm, a receiver
// =============================================================================================
register(
  'alembic',
  () => {
    const b = new Builder();
    const R = new Rng(1201);
    const CX = -0.24; // the furnace end
    const RING = 0.44;
    // tripod
    {
      const iron = [];
      const ring = torus(0.118, 0.009, 5, 14);
      ring.translate(CX, RING, 0);
      iron.push(ring);
      const brace = torus(0.165, 0.006, 4, 12);
      brace.translate(CX, 0.17, 0);
      iron.push(brace);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5;
        const sx = Math.sin(a),
          cz = Math.cos(a);
        iron.push(
          tube(
            [
              [CX + sx * 0.118, RING, cz * 0.118],
              [CX + sx * 0.15, 0.28, cz * 0.15],
              [CX + sx * 0.17, 0.12, cz * 0.17],
              [CX + sx * 0.215, 0.0, cz * 0.215],
            ],
            0.0085,
            4,
            { samples: 6 }
          )
        );
      }
      // the fire pan on the brace
      const pan = lathe(
        [
          [0, 0.0],
          [0.07, 0.004],
          [0.125, 0.03, 'hard'],
          [0.12, 0.034, 'hard'],
          [0.07, 0.012],
          [0, 0.01],
        ],
        10
      );
      pan.translate(CX, 0.172, 0);
      iron.push(pan);
      b.add(paint(merge(iron.map((g) => paint(g, {}))), ironSpec(0.7, 11, 10)));
      const coals = [];
      for (let i = 0; i < 9; i++) {
        const c = rock(R.range(0.016, 0.03), { seed: 40 + i, detail: 0, rough: 0.3, facet: true });
        const a = R.range(0, TAU),
          d = R.range(0, 0.07);
        c.translate(CX + Math.sin(a) * d, 0.196 + R.range(0, 0.012), Math.cos(a) * d);
        coals.push(c);
      }
      b.add(paint(merge(coals.map((g) => paint(g, {}))), { color: (v) => _c.set(PAL.char).lerp(new THREE.Color(PAL.ash), clamp((v.y - 0.2) * 30, 0, 0.7)), rough: 1, metal: 0, mat: MAT.PLAIN }));
    }
    // cucurbit
    const cuc = [
      [0, 0],
      [0.07, 0.006],
      [0.118, 0.06],
      [0.128, 0.125],
      [0.108, 0.2],
      [0.062, 0.26],
      [0.048, 0.31],
      [0.052, 0.34],
    ];
    const Y0 = RING - 0.06;
    vessel(b, cuc, { xform: { t: [CX, Y0, 0] }, liquid: '#3a4a1c', fill: 0.4, cork: false, radial: 12, seed: 3, dirty: 0.6 });
    // head: a helm over the neck with a beak running down to the worm
    {
      const HY = Y0 + 0.315;
      const head = lathe(
        [
          [0.056, 0.0],
          [0.066, 0.02],
          [0.108, 0.07],
          [0.112, 0.12],
          [0.085, 0.175],
          [0.035, 0.205],
          [0.018, 0.215],
          [0.024, 0.235],
          [0, 0.245],
        ],
        12
      );
      head.translate(CX, HY, 0);
      const beak = tube(
        [
          [CX + 0.09, HY + 0.1, 0],
          [CX + 0.2, HY + 0.085, 0],
          [CX + 0.34, HY + 0.01, 0],
          [CX + 0.455, HY - 0.075, 0],
        ],
        (t) => 0.022 - 0.011 * t,
        7,
        { samples: 8, caps: false }
      );
      b.glass(paint(head, GLASS), paint(beak, GLASS));
      // lute: a smear of clay where glass meets glass
      const lute = torus(0.058, 0.012, 5, 10);
      lute.translate(CX, HY + 0.008, 0);
      b.add(paint(lute, { color: PAL.clay, rough: 1, metal: 0, mat: MAT.PLAIN }));
    }
    // the worm: copper, green where it has sweated, on an iron upright
    {
      const WX = 0.26;
      const topY = Y0 + 0.24,
        botY = 0.3;
      const pts = [[CX + 0.44, topY + 0.01, 0]];
      const turns = 4.5,
        n = 40;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = t * turns * TAU - HALF;
        pts.push([WX + Math.sin(a) * 0.07, topY - (topY - botY) * t, Math.cos(a) * 0.07]);
      }
      pts.push([WX + 0.1, botY - 0.02, 0.035], [WX + 0.17, botY - 0.03, 0.01], [WX + 0.2, botY - 0.045, 0.0], [WX + 0.2, botY - 0.075, 0.0]);
      b.add(paint(tube(pts, 0.0095, 5, { samples: 90, tension: 0.5 }), copperSpec(0.55, 5, { yLo: botY, yHi: topY, f: 14 })));
      const iron = [];
      const up = cyl(0.008, 0.01, topY + 0.09, 6);
      up.translate(WX, (topY + 0.09) / 2, -0.11);
      iron.push(up);
      const plate = box(0.16, 0.012, 0.16);
      plate.translate(WX, 0.006, -0.11);
      iron.push(plate);
      for (const y of [topY - 0.02, botY + 0.03])
        iron.push(
          tube(
            [
              [WX, y, -0.11],
              [WX, y, -0.07],
            ],
            0.006,
            4
          )
        );
      b.add(paint(merge(iron.map((g) => paint(g, {}))), ironSpec(0.65, 13, 10)));
      // receiver on a block
      const blk = paint(box(0.2, 0.09, 0.2, 0.008, 1), woodSpec(PAL.woodDark, 6, { worn: 0.5 }));
      blk.rotateY(0.3);
      blk.translate(WX + 0.2, 0.045, 0.0);
      b.add(blk);
      vessel(b, SHAPES.round(0.17, 0.068), { xform: { t: [WX + 0.2, 0.09, 0.0] }, liquid: '#b9c8c4', fill: 0.26, cork: false, radial: 10, seed: 9, dirty: 0.3 });
    }
    b.boxCollider(0, 0.45, 0, 0.5, 0.45, 0.22);
    return b.build();
  },
  { kind: 'prop', variants: 1 }
);
