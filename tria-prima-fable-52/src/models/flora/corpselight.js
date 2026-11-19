// Corpselight: pale fungus fingers that only fruit on the dead. They come up through the orbits of a
// half-buried skull, or between the ribs of whatever lies under the soil, and their tips burn a cold
// green. opts.picked = true -> the bone stays, the fingers are cut to stubs and the light is gone.
import { Builder, Rng, Noise, MAT, TAU, THREE, paint, sphere, box, tube, lathe, rock, mat4, deform, mixc, col, ao } from '../kit.js';
import { register } from '../registry.js';
import { groundPatch, path } from './_shared.js';

const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (a, b, x) => {
  const t = cl((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const BONE = col('#a2987f'),
  BONE_DARK = col('#4f4638'),
  HOLLOW = col('#050403');

function bonePaint(geo, nz, extra = {}) {
  return paint(geo, {
    color: (v) => mixc(BONE_DARK, BONE, 0.35 + 0.65 * cl(0.5 + 0.9 * nz.fbm3(v.x * 26, v.y * 26, v.z * 26, 2))),
    rough: 0.82,
    mat: MAT.STONE,
    ...extra,
  });
}

// The face of a skull as a relief, in millimetres: rows from the forehead down to the teeth, columns
// from the midline out to the temple (mirrored). Rows and columns sit on the features, so the orbits
// and the nose are true pits with flat floors.
const ROW_Y = [30, 19, 8, -2, -15, -24, -31, -41, -51, -62, -72, -82];
const ROW_Z = [71, 76, 81, 77, 76, 78, 81, 81, 82, 82, 80, 77];
const ROW_W = [60, 63, 64, 64, 63, 60, 54, 47, 40, 35, 32, 30];
const COL_F = [0, 0.094, 0.19, 0.34, 0.56, 0.72, 0.875, 1];
const SX = 66,
  SY = 61,
  SZ = 82; // cranium half extents, mm
const cranZ = (x, y) => SZ * Math.sqrt(Math.max(0, 1 - (x / SX) * (x / SX) - (y / SY) * (y / SY)));

function faceMask(nz) {
  const pos = [],
    shade = [],
    idx = [];
  const C = COL_F.length * 2 - 1;
  for (let j = 0; j < ROW_Y.length; j++) {
    for (let c = 0; c < C; c++) {
      const k = c - (COL_F.length - 1),
        a = Math.abs(k);
      let x = Math.sign(k) * COL_F[a] * ROW_W[j];
      const y = ROW_Y[j];
      let z = ROW_Z[j] - 0.0085 * x * x,
        s = 1;
      if ((a === 3 || a === 4) && (j === 3 || j === 4)) {
        z -= 24; // orbit
        s = 0;
      } else if (j === 7 && a <= 1) {
        z -= 18; // nose
        s = 0;
      } else if (j === 6 && a === 0) {
        z -= 6;
        s = 0.3;
      } else if (j === 8 && a === 0) {
        z -= 3;
        s = 0.55;
      }
      if (j === 2) z += a >= 2 && a <= 5 ? 3.5 : 1.5; // brow
      if (j === 5 && (a === 5 || a === 6)) z += a === 5 ? 4 : 3; // cheekbone
      if (j === 6 && a === 5) z += 2;
      if (a === 7) {
        // the edge turns back and tucks into the side of the vault
        if (y > -27) {
          x = Math.sign(k) * Math.min(Math.abs(x), 57);
          z = Math.min(z, cranZ(x, y) - 5);
        } else z -= 12;
      }
      if (j === 0) z = Math.min(z, cranZ(x, y) - 2);
      pos.push(x * 0.001, y * 0.001, z * 0.001);
      shade.push(s);
    }
  }
  for (let j = 0; j < ROW_Y.length - 1; j++) {
    for (let c = 0; c < C - 1; c++) {
      const p = j * C + c,
        q = p + C;
      // split each quad along the diagonal that leaves the midline, so the two halves mirror
      if (c < (C - 1) / 2) idx.push(p, q, q + 1, p, q + 1, p + 1);
      else idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  paint(g, {
    color: (v) => mixc(BONE_DARK, BONE, 0.35 + 0.65 * cl(0.5 + 0.9 * nz.fbm3(v.x * 26, v.y * 26, v.z * 26, 2))).lerp(HOLLOW, 1 - shade[v.i]),
    rough: 0.82,
    mat: MAT.STONE,
  });
  return g;
}

/** A human skull without its jaw, in its own space: cranium centred on the origin, face toward +Z. */
function skull(R, nz) {
  const out = [];
  const cran = sphere(1, 12, 9);
  deform(cran, (p) => {
    // flat underneath, a fuller back
    if (p.y < -0.45) p.y = -0.45 + (p.y + 0.45) * 0.3;
    if (p.z < -0.3) p.z *= 1.06;
    // the temples pinch in behind the brow
    if (p.y < 0.3) p.x *= 1 - 0.1 * sm(-0.2, 0.6, p.z);
    // behind the face the vault is cut away, so the pits of the mask have somewhere to go
    p.z -= sm(0.42, 0.7, p.z) * sm(0.32, 0.12, p.y) * 0.6;
    p.set(p.x * SX * 0.001, p.y * SY * 0.001, p.z * SZ * 0.001);
  });
  paint(cran, {
    color: (v) => mixc(BONE_DARK, BONE, 0.35 + 0.65 * cl(0.5 + 0.9 * nz.fbm3(v.x * 26, v.y * 26, v.z * 26, 2))).multiplyScalar(v.y > 0.02 && Math.abs(v.x) < 0.004 ? 0.82 : 1),
    rough: 0.82,
    mat: MAT.STONE,
  });
  out.push(cran, faceMask(nz));
  // cheekbones running back to the temples
  for (const s of [-1, 1]) {
    out.push(
      bonePaint(
        tube(
          [
            [s * 0.052, -0.026, 0.05],
            [s * 0.064, -0.022, 0.026],
            [s * 0.062, -0.016, -0.008],
          ],
          (t) => 0.0052 - 0.0012 * t,
          4,
          { samples: 3 }
        ),
        nz
      )
    );
  }
  // teeth: a few are gone
  for (let k = -3; k <= 3; k++) {
    if (R.chance(0.26)) continue;
    const x = k * 0.0074;
    const h = R.range(0.008, 0.012);
    const th = box(0.0064, h, 0.0056);
    paint(th, { color: mixc('#857a5f', '#c2b99e', R.next()), rough: 0.55, mat: MAT.PLAIN });
    th.rotateY(-k * 0.19);
    th.translate(x, -0.082 - h * 0.4, 0.0745 - 8.5 * x * x);
    out.push(th);
  }
  return out;
}

register(
  'corpselight',
  (seed, opts = {}) => {
    const R = new Rng(seed * 4409 + 7);
    const nz = new Noise(seed * 13 + 5);
    const b = new Builder();
    const picked = !!opts.picked;
    const ribcage = seed % 4 === 0;
    const up = new THREE.Vector3(0, 1, 0);

    const gr = ribcage ? 0.15 : 0.13,
      gh = 0.022;
    const soil = groundPatch(gr, gh, seed + 11, { sides: 10, lump: 0.2 });
    paint(soil, { color: (v) => mixc('#0d0b09', '#2b241c', cl(0.5 + 0.8 * nz.fbm3(v.x * 18, 3, v.z * 18, 2))), rough: 1, mat: MAT.STONE });
    b.add(soil);

    // ---- the fingers -------------------------------------------------------------------------
    const tip = col('#8fd9a0'),
      flesh = col('#6f8069'),
      foot = col('#2a3229');
    const T = new THREE.Vector3(),
      N = new THREE.Vector3(),
      B = new THREE.Vector3(),
      ref = new THREE.Vector3(1, 0, 0.13).normalize();
    let best = null; // the tallest finger: the light sits there
    const finger = (p0, n0, len, r) => {
      const n = n0.clone().normalize();
      if (picked) {
        // what the knife left
        const p1 = p0.clone().addScaledVector(n, len * 0.12).addScaledVector(up, len * 0.08);
        const g = tube([p0, p1], (t) => r * (0.5 + 0.1 * t), 5, { samples: 1 });
        paint(g, { color: (v) => (v.i >= 19 ? col('#c3d0ba') : mixc(foot, flesh, v.i >= 6 ? 0.6 : 0)), emissive: (v) => (v.i >= 19 ? 0.12 : 0), rough: 0.55, mat: MAT.PLANT });
        b.add(g);
        if (!best || p1.y > best.y) best = p1.clone();
        return;
      }
      const j = () => new THREE.Vector3(R.range(-1, 1), R.range(-0.3, 0.3), R.range(-1, 1)).multiplyScalar(len * 0.13);
      const p1 = p0.clone().addScaledVector(n, len * 0.28).addScaledVector(up, len * 0.1);
      const p2 = p1.clone().addScaledVector(n.clone().multiplyScalar(0.35).add(up).normalize(), len * 0.37).add(j());
      const p3 = p2.clone().addScaledVector(n.clone().multiplyScalar(0.1).add(up).normalize(), len * 0.33).add(j());
      const P = path([p0, p1, p2, p3].map((v) => v.toArray()));
      // a club: a thin stalk, swelling toward the top, a round end. Built straight, then laid along the path.
      const g = lathe(
        [
          [r * 0.42, 0],
          [r * 0.5, 0.26],
          [r * 0.8, 0.5],
          [r, 0.72],
          [r * 0.95, 0.87],
          [r * 0.66, 0.96],
          [0, 1],
        ],
        5
      );
      paint(g, {
        color: (v) => (v.y < 0.3 ? mixc(foot, flesh, v.y / 0.3) : mixc(flesh, tip, sm(0.5, 0.95, v.y))),
        emissive: (v) => 0.02 + 1.35 * Math.pow(sm(0.5, 1, v.y), 2),
        rough: 0.5,
        mat: MAT.PLANT,
      });
      deform(g, (p) => {
        const t = cl(p.y);
        const c = P.at(t),
          d = P.dir(t);
        T.set(d[0], d[1], d[2]);
        N.crossVectors(T, ref).normalize();
        B.crossVectors(N, T);
        p.set(c[0] + N.x * p.x + B.x * p.z, c[1] + N.y * p.x + B.y * p.z, c[2] + N.z * p.x + B.z * p.z);
      });
      b.add(g);
      if (!best || p3.y > best.y) best = p3.clone();
    };
    const cluster = (p0, n0, count, len) => {
      for (let i = 0; i < count; i++) {
        const n = n0.clone().add(new THREE.Vector3(R.range(-0.6, 0.6), R.range(-0.1, 0.5), R.range(-0.6, 0.6)));
        const p = p0.clone().add(new THREE.Vector3(R.range(-1, 1), R.range(-0.5, 0.5), R.range(-1, 1)).multiplyScalar(0.007));
        finger(p, n, len * R.range(0.55, 1.1) * (i === 0 ? 1.15 : 1), i === 0 ? R.range(0.0062, 0.008) : R.range(0.004, 0.0066));
      }
    };
    const fromSoil = (count) => {
      for (let k = 0; k < count; k++) {
        const a = R.range(0, TAU),
          d = R.range(0.06, gr * 0.72);
        cluster(new THREE.Vector3(Math.cos(a) * d, gh * 0.3, Math.sin(a) * d), new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), R.int(2, 3), R.range(0.04, 0.075));
      }
    };

    if (!ribcage) {
      // ---- a skull on its back, the face turned up at whoever finds it -------------------------
      const M = new THREE.Matrix4().compose(
        new THREE.Vector3(R.range(-0.01, 0.01), R.range(0.03, 0.042), R.range(-0.01, 0.01)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-R.range(0.5, 0.85), R.range(-0.5, 0.5), R.sign() * R.range(0.08, 0.36), 'YZX')),
        new THREE.Vector3(1, 1, 1)
      );
      for (const g of skull(R, nz)) b.add(mat4(g, M));
      const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
      const dir = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(M);
      // through the orbits (whichever looks more at the sky gets the bigger tuft), and out of the nose
      const eyes = [-1, 1].map((s) => ({ p: at(s * 0.029, -0.008, 0.05), n: dir(s * 0.2, 0.15, 1) })).sort((a, c) => c.p.y - a.p.y);
      cluster(eyes[0].p, eyes[0].n, R.int(4, 5), R.range(0.085, 0.11));
      if (R.chance(0.6)) cluster(eyes[1].p, eyes[1].n, 2, R.range(0.045, 0.06));
      if (R.chance(0.5)) cluster(at(0, -0.041, 0.064), dir(0, -0.1, 1), 2, R.range(0.035, 0.05));
      fromSoil(R.int(2, 3));
    } else {
      // ---- ribs standing out of the ground like a closing hand ---------------------------------
      const yaw = R.range(0, TAU);
      const M = new THREE.Matrix4().makeRotationY(yaw);
      const pairs = 4;
      for (let i = 0; i < pairs; i++) {
        const x = (i - (pairs - 1) / 2) * 0.043 + R.range(-0.004, 0.004);
        for (const s of [-1, 1]) {
          const lean = R.range(-0.012, 0.012);
          const h = R.range(0.13, 0.165) * (1 - Math.abs(i - 1.5) * 0.09);
          let pts = [
            [x, -0.03, s * 0.08],
            [x + lean, h * 0.42, s * 0.096],
            [x + lean * 1.6, h * 0.82, s * 0.07],
            [x + lean * 2, h, s * 0.022],
          ];
          const broken = R.chance(0.3);
          if (broken) pts = pts.slice(0, 3);
          const g = tube(pts, (t) => 0.0078 - 0.003 * t, 4, { samples: broken ? 4 : 6 });
          bonePaint(g, nz);
          b.add(mat4(g, M));
        }
      }
      // what is left of the spine shows between them
      for (let i = 0; i < 3; i++) {
        const g = rock(0.017, { seed: seed * 7 + i, detail: 0, rough: 0.2, squash: [1, 0.7, 0.9] });
        bonePaint(g, nz);
        g.translate((i - 1) * 0.045 + R.range(-0.005, 0.005), gh * 0.75, R.range(-0.008, 0.008));
        b.add(mat4(g, M));
      }
      const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
      cluster(at(R.range(-0.03, 0.03), gh * 0.6, R.range(-0.02, 0.02)), new THREE.Vector3(0, 1, 0), R.int(4, 5), R.range(0.1, 0.13));
      cluster(at(R.range(-0.07, -0.04), gh * 0.5, R.range(-0.04, 0.04)), new THREE.Vector3(-0.2, 1, 0), 3, R.range(0.06, 0.085));
      cluster(at(R.range(0.04, 0.07), gh * 0.5, R.range(-0.04, 0.04)), new THREE.Vector3(0.2, 1, 0), 3, R.range(0.05, 0.08));
      fromSoil(2);
    }

    const top = best || new THREE.Vector3(0, 0.08, 0);
    b.anchor('top', top.x, top.y + 0.02, top.z);
    if (!picked) {
      b.light(top.x, top.y + 0.03, top.z, '#8fd9a0', 0.6, 2.4);
      b.emitter('glow', top.x, top.y, top.z, { color: '#8fd9a0', size: 0.16 });
    }
    const m = b.build();
    ao(m.opaque, { height: 0.05, strength: 0.4, under: 0.15 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
