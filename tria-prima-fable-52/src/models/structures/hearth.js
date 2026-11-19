// Things that hold fire in the workshop: the cauldron on its trivet, the floor bellows, the iron brazier.
// All of them cold: dead coals, grey ash. The game lights them.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, box, cyl, tube, lathe, torus, dome, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { ironSpec, woodSpec, logGeo, plank, rivets } from './_shared.js';

const _c = new THREE.Color(),
  _k = new THREE.Color();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A heap of dead coals around (0, 0, 0): lumps on a low bed of ash. r = radius, h = height of the heap. */
export function deadCoals(R, r, h, n = 14, seed = 1) {
  const out = [];
  const bed = dome(r, 9, 2, (h * 0.55) / r);
  out.push(paint(bed, { color: '#3d3a37', rough: 1, mat: MAT.STONE }));
  const tones = ['#262322', '#3f3c3a', '#191716', '#514d49', '#2f2c2a', '#1f1c1b'];
  for (let i = 0; i < n; i++) {
    const a = R.range(0, TAU),
      d = Math.sqrt(R.next()) * r * 0.86;
    const s = R.range(0.11, 0.2) * r;
    const g = rock(s, { seed: seed * 50 + i, detail: 0, rough: 0.3, squash: [1, 0.72, 1], facet: true });
    g.rotateY(R.range(0, TAU));
    g.translate(Math.sin(a) * d, h * 0.5 * (1 - (d / r) * (d / r)) + s * 0.45, Math.cos(a) * d);
    out.push(paint(g, { color: R.pick(tones), rough: 1, mat: MAT.STONE }));
  }
  return merge(out);
}

/** Cast iron: nearly black, pitted, rust where it has not been handled, soot low down. */
function castIron(seed, { sootBelow = -1e9, sootSpan = 0.3, rust = 0.4, soot = null } = {}) {
  const nz = new Noise(seed * 7 + 3);
  const cI = new THREE.Color('#1d1e20'),
    cR = new THREE.Color(PAL.rust),
    cS = new THREE.Color('#090808');
  const k = (v) => clamp((nz.fbm3(v.x * 5.3 + seed, v.y * 5.3, v.z * 5.3, 3) * 0.5 + 0.5 - (1 - rust) * 0.72) * 2.6, 0, 1);
  const so = soot || ((v) => clamp((sootBelow - v.y) / sootSpan + 0.5, 0, 1));
  return {
    color: (v) =>
      _c
        .copy(cI)
        .lerp(cR, k(v) * 0.7 * (1 - so(v)))
        .lerp(cS, so(v) * 0.85),
    rough: (v) => 0.55 + 0.35 * k(v) + 0.1 * so(v),
    metal: (v) => 0.85 - 0.6 * k(v) - 0.4 * so(v),
    mat: MAT.METAL,
  };
}

// ---------------------------------------------------------------------------------------------- cauldron
const RIM_Y = 0.95;
const SURFACE_Y = 0.82;
register(
  'cauldron',
  () => {
    const b = new Builder();
    const R = new Rng(311);
    // the pot: outside from the bottom up, over the lip, and down the inside
    const prof = [
      [0, 0.33],
      [0.2, 0.338],
      [0.4, 0.41],
      [0.52, 0.52],
      [0.568, 0.63],
      [0.575, 0.68, 'hard'],
      [0.592, 0.69, 'hard'],
      [0.592, 0.715, 'hard'],
      [0.573, 0.725, 'hard'],
      [0.55, 0.8],
      [0.51, 0.875],
      [0.52, 0.915],
      [0.575, 0.93, 'hard'],
      [0.58, RIM_Y, 'hard'],
      [0.535, RIM_Y, 'hard'],
      [0.49, 0.92],
      [0.478, 0.88],
      [0.515, 0.8],
      [0.545, 0.67],
      [0.5, 0.53],
      [0.39, 0.44],
      [0.2, 0.378],
      [0, 0.368],
    ];
    const pot = lathe(prof, 22);
    const nzP = new Noise(77);
    const spec = castIron(3, { sootBelow: 0.56, sootSpan: 0.22, rust: 0.3 });
    const outer = spec.color;
    const cCrust = new THREE.Color('#3a3524'),
      cIn = new THREE.Color('#111112');
    spec.color = (v) => {
      const inside = v.x * v.nx + v.z * v.nz < -0.05 || (v.ny > 0.5 && v.y < 0.6);
      if (!inside) return outer(v);
      // inside: black, with the tide lines of old batches
      const tide = Math.exp(-Math.pow((v.y - (SURFACE_Y + 0.01 + nzP.n2(Math.atan2(v.x, v.z) * 3, 1.7) * 0.012)) / 0.03, 2));
      const tide2 = Math.exp(-Math.pow((v.y - 0.7) / 0.02, 2)) * 0.5;
      return _c.copy(cIn).lerp(cCrust, Math.min(1, tide + tide2) * 0.85);
    };
    b.add(paint(pot, spec));

    // lugs and ring handles
    {
      const iron = [];
      for (const s of [-1, 1]) {
        const lug = tube(
          [
            [s * 0.555, 0.84, -0.06],
            [s * 0.63, 0.85, -0.04],
            [s * 0.645, 0.85, 0],
            [s * 0.63, 0.85, 0.04],
            [s * 0.555, 0.84, 0.06],
          ],
          0.014,
          5,
          { samples: 8 }
        );
        const ring = torus(0.075, 0.013, 5, 12);
        ring.rotateZ(Math.PI / 2 - s * 0.35);
        ring.translate(s * 0.665, 0.79, 0);
        iron.push(lug, ring);
      }
      // the trivet: a ring under the belly on three splayed legs
      const tr = torus(0.4, 0.022, 5, 18);
      tr.translate(0, 0.385, 0);
      iron.push(tr);
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 6 + (i / 3) * TAU;
        const sx = Math.sin(a),
          cz = Math.cos(a);
        iron.push(
          tube(
            [
              [sx * 0.4, 0.385, cz * 0.4],
              [sx * 0.52, 0.3, cz * 0.52],
              [sx * 0.6, 0.12, cz * 0.6],
              [sx * 0.63, 0.0, cz * 0.63],
            ],
            0.024,
            5,
            { samples: 6 }
          )
        );
        const foot = box(0.1, 0.02, 0.1);
        foot.rotateY(a);
        foot.translate(sx * 0.64, 0.01, cz * 0.64);
        iron.push(foot);
        // a strut back to the ring
        iron.push(
          tube(
            [
              [sx * 0.57, 0.18, cz * 0.57],
              [Math.sin(a + 0.55) * 0.4, 0.38, Math.cos(a + 0.55) * 0.4],
            ],
            0.012,
            4
          )
        );
      }
      b.add(paint(merge(iron.map((g) => paint(g, {}))), castIron(5, { sootBelow: 0.3, sootSpan: 0.3, rust: 0.6 })));
    }

    // the hearth: a ring of stones, ash, burnt logs
    {
      const cS = new THREE.Color(PAL.stoneDark).lerp(new THREE.Color(PAL.stone), 0.45),
        cK = new THREE.Color(PAL.soot),
        cA = new THREE.Color('#4a4744');
      const nzS = new Noise(41);
      const n = 11;
      for (let i = 0; i < n; i++) {
        if (i === 7) continue; // one stone has been kicked out of the ring
        const a = (i / n) * TAU + R.range(-0.16, 0.16);
        const r = R.range(0.1, 0.19);
        const d = R.range(0.72, 0.84) + (i === 3 ? 0.07 : 0);
        const g = rock(r, { seed: 400 + i, detail: 1, rough: 0.34, squash: [R.range(0.9, 1.45), R.range(0.5, 0.82), R.range(0.8, 1.1)], sink: 0.4, facet: i % 3 === 0 });
        g.rotateY(a + R.range(-0.6, 0.6));
        g.translate(Math.sin(a) * d, r * 0.3, Math.cos(a) * d);
        const tone = R.range(0.55, 0.9);
        // black on the side that faces the fire, ash settled on top
        paint(g, {
          color: (v) =>
            _c
              .copy(cS)
              .multiplyScalar(tone * (0.85 + 0.3 * nzS.fbm3(v.x * 7, v.y * 7, v.z * 7, 2)))
              .lerp(cA, clamp(v.ny - 0.55, 0, 0.3))
              .lerp(cK, clamp(1.6 - Math.hypot(v.x, v.z) / 0.62, 0.12, 0.92)),
          rough: 0.97,
          mat: MAT.STONE,
        });
        b.add(g);
      }
      {
        // the kicked stone, a step away
        const g = rock(0.15, { seed: 431, detail: 1, rough: 0.34, squash: [1.3, 0.6, 0.95], sink: 0.35 });
        g.rotateY(1.1);
        g.translate(-0.98, 0.04, 0.62);
        paint(g, { color: (v) => _c.copy(cS).multiplyScalar(0.7 + 0.25 * nzS.fbm3(v.x * 7, v.y * 7, v.z * 7, 2)).lerp(cK, v.x > -0.95 ? 0.6 : 0.1), rough: 0.97, mat: MAT.STONE });
        b.add(g);
      }
      const ash = dome(0.7, 14, 3, 0.07);
      const nzA = new Noise(9);
      paint(ash, { color: (v) => _c.set('#2f2d2b').multiplyScalar(0.55 + 0.75 * (nzA.fbm2(v.x * 6, v.z * 6, 3) * 0.5 + 0.5)).lerp(_k.set('#0e0d0d'), clamp(0.9 - Math.hypot(v.x, v.z) / 0.42, 0, 0.7)), rough: 1, mat: MAT.STONE });
      b.add(ash);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + R.range(-0.3, 0.3);
        const len = R.range(0.5, 0.74);
        const g = logGeo(len, R.range(0.045, 0.07), { seed: 20 + i, char: R.range(0.7, 1), radial: 6 });
        g.rotateZ(Math.PI / 2 + R.range(-0.12, 0.12)); // lie along -X
        g.translate(len * 0.5 + 0.06, 0, 0);
        g.rotateY(a);
        g.translate(0, 0.075 + R.range(0, 0.03), 0);
        b.add(g);
      }
    }
    const coals = deadCoals(R, 0.3, 0.16, 14, 3);
    coals.translate(0, 0.05, 0);
    b.part('coals', coals);

    // the stirring paddle, upright through the surface point
    {
      const wood = [];
      const shaft = cyl(0.016, 0.019, 1.14, 7, 2);
      shaft.translate(0, SURFACE_Y - 0.12 + 0.57, 0);
      wood.push(shaft);
      const grip = cyl(0.024, 0.017, 0.2, 7);
      grip.translate(0, SURFACE_Y + 0.9, 0);
      wood.push(grip);
      const blade = new THREE.BoxGeometry(0.12, 0.26, 0.02, 2, 2, 1);
      const pos = blade.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < -0.1) pos.setX(i, pos.getX(i) * 0.82);
        if (y > 0.1) pos.setX(i, pos.getX(i) * 0.45);
      }
      blade.computeVertexNormals();
      blade.translate(0, SURFACE_Y - 0.35 + 0.13, 0);
      wood.push(blade);
      const g = merge(wood.map((q) => paint(q, {})));
      const sp = woodSpec(PAL.woodLight, 12, { worn: 0.5 });
      const base = sp.color;
      const cStain = new THREE.Color('#1f1a12');
      sp.color = (v) => {
        const c = base(v);
        return c.lerp(cStain, clamp((SURFACE_Y + 0.08 - v.y) / 0.12, 0, 0.85));
      };
      const loop = torus(0.03, 0.006, 4, 10);
      loop.rotateX(Math.PI / 2);
      loop.translate(0, SURFACE_Y + 1.025, 0);
      b.part('ladle', paint(g, sp), paint(loop, ironSpec(0.6, 8, 20)));
    }

    b.cylCollider(0, RIM_Y / 2, 0, 0.62, RIM_Y);
    b.anchor('surface', 0, SURFACE_Y, 0);
    b.anchor('fire', 0, 0.16, 0);
    b.anchor('view', 0, 1.75, 1.5);
    return b.build();
  },
  { kind: 'prop', variants: 1, surfaceRadius: 0.51, rimY: RIM_Y, rimRadius: 0.535 }
);

// ---------------------------------------------------------------------------------------------- bellows
const HINGE = [0, 0.135, -0.3];
const OPEN = 0.33; // how far the upper board stands open at rest (radians)
register(
  'bellows',
  () => {
    const b = new Builder();
    // a pear-shaped board lying flat: the point at z = -0.3 (the nozzle end), the round end at z = +0.36
    const pear = (z) => {
      const t = (z + 0.3) / 0.66; // 0 at the point, 1 at the round end
      if (t < 0.62) return 0.03 + 0.17 * Math.pow(t / 0.62, 0.8);
      const u = (t - 0.62) / 0.38;
      return 0.2 * Math.sqrt(Math.max(0, 1 - u * u * 0.98));
    };
    const outline = [];
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const z = -0.3 + (0.66 * i) / N;
      outline.push([pear(z), z]);
    }
    const ring = [...outline, ...outline.slice(0, -1).reverse().map(([x, z]) => [-x, z])];
    const board = (seed) => {
      const sh = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, z)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.024, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(Math.PI / 2); // the shape plane (x, y=z) becomes XZ, thickness downward
      g.translate(0, 0.012, 0);
      // grain along the length: let the wood shader see Y as Z
      const out = g.index ? g.toNonIndexed() : g;
      out.computeVertexNormals();
      paint(out, woodSpec(PAL.wood, seed, { worn: 0.45 }));
      const u = out.attributes.aUvw;
      for (let i = 0; i < u.count; i++) u.setXYZ(i, u.getX(i), u.getZ(i), u.getY(i));
      return out;
    };
    const tilt = (g) => {
      g.translate(-HINGE[0], -HINGE[1], -HINGE[2]);
      g.rotateX(-OPEN);
      g.translate(HINGE[0], HINGE[1], HINGE[2]);
      return g;
    };
    const yLow = 0.1;
    const lower = board(3);
    lower.translate(0, yLow, 0);
    b.add(lower);
    const upper = board(4);
    upper.translate(0, HINGE[1] + 0.012, 0);
    // the handle on the round end
    const handle = plank(0.13, 0.05, 0.026, { seed: 5, tone: PAL.wood, worn: 0.5 });
    handle.rotateX(Math.PI / 2);
    handle.translate(0, HINGE[1] + 0.012, 0.33);
    // the air hole with its leather flap
    const hole = new THREE.CircleGeometry(0.034, 8);
    hole.rotateX(-Math.PI / 2);
    hole.translate(0, HINGE[1] + 0.0135, 0.14);
    paint(hole, { color: '#070605', rough: 1, mat: MAT.PLAIN });
    const flap = box(0.085, 0.004, 0.075);
    flap.rotateX(-0.12);
    flap.translate(0.012, HINGE[1] + 0.02, 0.118);
    paint(flap, { color: '#2a1c13', rough: 0.8, mat: MAT.CLOTH });
    const top = [tilt(upper), tilt(handle), tilt(hole), tilt(flap)];

    // the leather: a pleated wall between the two boards
    const leatherLo = [],
      leatherHi = [];
    {
      const cL = new THREE.Color('#2a1c13'),
        cD = new THREE.Color('#140d09');
      const pts = ring.filter(([, z]) => z > -0.27);
      const up = (x, z) => {
        // where the upper board's edge is, at rest
        const dz = z - HINGE[2];
        return [x, HINGE[1] + Math.sin(OPEN) * dz, HINGE[2] + Math.cos(OPEN) * dz];
      };
      const mk = (rows) => {
        const pos = [],
          idx = [];
        const n = pts.length;
        for (let i = 0; i < n; i++) for (const r of rows) pos.push(...r(pts[i]));
        const m = rows.length;
        for (let i = 0; i < n - 1; i++)
          for (let j = 0; j < m - 1; j++) {
            const a = i * m + j,
              c = (i + 1) * m + j;
            idx.push(a, c, a + 1, a + 1, c, c + 1);
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };
      const lerp = (p, q, t, pinch) => {
        const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        m[0] *= pinch;
        m[2] = m[2] * pinch + (1 - pinch) * 0.02;
        return m;
      };
      const lo = ([x, z]) => [x * 0.97, yLow + 0.012, z * 0.985];
      const hi = ([x, z]) => up(x * 0.97, z * 0.985);
      const at = (t, pinch) => (p) => lerp(lo(p), hi(p), t, pinch);
      const paintL = (g) => paint(g, { color: (v) => _c.copy(cL).lerp(cD, 0.5 + 0.5 * Math.sin(v.y * 60 + v.z * 9)), rough: 0.75, metal: 0, mat: MAT.CLOTH });
      leatherLo.push(paintL(mk([at(0, 1), at(0.17, 1.06), at(0.33, 0.86), at(0.5, 1.07)])));
      leatherHi.push(paintL(mk([at(0.5, 1.07), at(0.67, 0.86), at(0.83, 1.06), at(1, 1)])));
      // brass tacks along both boards
      const tack = (p) => {
        const g = new THREE.ConeGeometry(0.0055, 0.005, 5);
        g.translate(p[0] * 1.0, p[1], p[2]);
        return paint(g, { color: PAL.bronze, rough: 0.55, metal: 0.8, mat: MAT.METAL });
      };
      pts.forEach((p, i) => {
        if (i % 2) return;
        const l = lo(p),
          h = hi(p);
        leatherLo.push(tack([l[0] * 1.03, l[1] + 0.014, l[2]]));
        leatherHi.push(tack([h[0] * 1.03, h[1] + 0.03, h[2]]));
      });
    }
    b.add(leatherLo);
    top.push(...leatherHi);
    b.part('top', top);

    // the head block, the nozzle, the feet
    const head = box(0.11, 0.085, 0.12, 0.01, 1);
    head.translate(0, 0.125, -0.31);
    b.add(paint(head, woodSpec(PAL.woodDark, 7, { worn: 0.3 })));
    const noz = lathe(
      [
        [0.03, 0, 'hard'],
        [0.052, 0, 'hard'],
        [0.05, 0.03],
        [0.03, 0.13],
        [0.022, 0.17, 'hard'],
        [0.014, 0.17, 'hard'],
      ],
      8
    );
    noz.rotateX(-Math.PI / 2);
    noz.translate(0, 0.125, -0.35);
    const band = torus(0.05, 0.008, 4, 8);
    band.rotateX(Math.PI / 2);
    band.translate(0, 0.125, -0.38);
    b.add(paint(merge(paint(noz, {}), paint(band, {})), ironSpec(0.6, 3, 12)));
    for (const [z, w] of [
      [0.16, 0.36],
      [-0.2, 0.2],
    ]) {
      const f = plank(w, 0.07, 0.088, { seed: z * 10 + 9, tone: PAL.woodDark, worn: 0.4 });
      f.rotateZ(Math.PI / 2);
      f.translate(w / 2, 0.044, z);
      b.add(f);
    }
    b.anchor('hinge', HINGE[0], HINGE[1], HINGE[2]);
    return b.build();
  },
  { kind: 'prop', variants: 1, openAngle: OPEN, axis: 'x' }
);

// ---------------------------------------------------------------------------------------------- brazier
register(
  'brazier',
  () => {
    const b = new Builder();
    const R = new Rng(733);
    const iron = [];
    const BOWL_Y = 0.86,
      RIM = 1.1,
      BR = 0.37;
    const bowl = lathe(
      [
        [0, BOWL_Y],
        [0.12, BOWL_Y + 0.008],
        [0.26, BOWL_Y + 0.07],
        [0.34, BOWL_Y + 0.16],
        [BR, RIM - 0.02],
        [BR + 0.03, RIM, 'hard'],
        [BR - 0.015, RIM, 'hard'],
        [0.32, BOWL_Y + 0.17],
        [0.24, BOWL_Y + 0.09],
        [0.1, BOWL_Y + 0.035],
        [0, BOWL_Y + 0.03],
      ],
      14
    );
    iron.push(bowl);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.3;
      const sx = Math.sin(a),
        cz = Math.cos(a);
      const P = (r, y) => [sx * r, y, cz * r];
      // a leg: scrolled foot, in to the waist, out around the bowl, up to a spike
      iron.push(tube([P(0.5, 0.03), P(0.44, 0.0), P(0.38, 0.06), P(0.27, 0.38), P(0.17, 0.68), P(0.24, 0.84), P(0.36, 0.95), P(0.405, 1.08), P(0.41, 1.2), P(0.4, 1.3)], (t) => 0.02 - 0.012 * Math.max(0, (t - 0.82) / 0.18), 5, { samples: 22 }));
      const leaf = new THREE.ConeGeometry(0.022, 0.07, 4);
      leaf.translate(sx * 0.4, 1.33, cz * 0.4);
      iron.push(leaf);
    }
    const waist = torus(0.175, 0.014, 4, 12);
    waist.translate(0, 0.68, 0);
    const low = torus(0.3, 0.012, 4, 14);
    low.translate(0, 0.3, 0);
    const collar = torus(BR + 0.035, 0.012, 4, 14);
    collar.translate(0, RIM - 0.07, 0);
    iron.push(waist, low, collar);
    const spec = castIron(21, { rust: 0.62, soot: (v) => clamp((v.y - 0.72) / 0.3, 0, 0.75) * (v.y > 1.14 ? 0.5 : 1) });
    b.add(paint(merge(iron.map((g) => paint(g, {}))), spec));
    b.add(rivets(BR + 0.04, RIM - 0.07, 9, { size: 0.011, rust: 0.25, a0: 0.2 }));
    const coals = deadCoals(R, 0.33, 0.13, 16, 5);
    coals.translate(0, RIM - 0.07, 0);
    b.part('coals', coals);
    b.cylCollider(0, 0.6, 0, 0.4, 1.2);
    b.anchor('flame', 0, RIM + 0.1, 0);
    return b.build();
  },
  { kind: 'prop', variants: 1 }
);
