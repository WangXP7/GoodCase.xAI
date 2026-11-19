// What still moves on the Isle of Morne: the Shades of the Gloom and the carrion crows.
// Registers shade, crow.
import { Builder, Rng, Noise, THREE, TAU, MAT, col, paint, xf, tube, ico, deform } from '../kit.js';
import { register } from '../registry.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Smooth step from a to b (a may be the larger of the two). */
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A smooth curve through [t, value] keys (t ascending). */
function curve(keys) {
  const n = keys.length;
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 1;
    while (t > keys[i][0]) i++;
    const p0 = keys[Math.max(0, i - 2)][1],
      p1 = keys[i - 1][1],
      p2 = keys[i][1],
      p3 = keys[Math.min(n - 1, i + 1)][1];
    const u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
    return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  };
}

/**
 * Skin a stack of closed rings (each the same number of [x, y, z] points) into one smooth surface.
 * Vertex j * n + i is point i of ring j; the cap centres (capA first) come after all the rings.
 */
function loft(rings, { capA = false, capB = false } = {}) {
  const n = rings[0].length;
  const pos = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i,
        b = j * n + ((i + 1) % n),
        c = a + n,
        d = b + n;
      idx.push(a, b, c, b, d, c);
    }
  const cap = (j, flip) => {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const p of rings[j]) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const k = pos.length / 3;
    pos.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i++) {
      const a = j * n + i,
        b = j * n + ((i + 1) % n);
      if (flip) idx.push(k, b, a);
      else idx.push(k, a, b);
    }
  };
  if (capA) cap(0, true);
  if (capB) cap(rings.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Loose triangles: a flat list of 9 numbers each. Hard edged. */
function trisGeo(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

/** The same thing on the other side of the body: x mirrored, faces still looking outward. */
function mirrorX(geo) {
  const g = geo.clone();
  const p = g.attributes.position,
    n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (n) n.setX(i, -n.getX(i));
  }
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < p.count; i += 3) idx.push(i, i + 2, i + 1);
    g.setIndex(idx);
  } else {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// shade: the hunger of the Gloom in what is left of a pilgrim's cloak. 2.2 m. No legs: the cloak
// ends in rags that never reach the ground. No face: the hood is empty, and two pale points sit
// far back in it. The arms are too long, and the hands are mostly fingers.
//
// The game drapes the body and both arms in its ghost cloth (dark, a violet rim, the hem eaten
// away) and swings each arm about its shoulder to reach for the living. At rest the arms hang with
// the palms turned back, so that a raised hand comes down on its prey claws first.
// ---------------------------------------------------------------------------------------------
register(
  'shade',
  (seed) => {
    const R = new Rng(seed * 2371 + 77);
    const nz = new Noise(seed * 31 + 9);
    const b = new Builder();

    const ASH = col('#5d5a55'),
      SOOT = col('#121113'),
      ROT = col('#2b3523'),
      SKIN = col('#46434b'),
      KNUCKLE = col('#77726e'),
      CLAW = col('#0a090b');
    const VOID = [0.0012, 0.0012, 0.0018];
    /** Wet ash and old soot, rot creeping up from the hem. */
    const cloth = (v, k = 1) => {
      const n = nz.fbm3(v.x * 5, v.y * 3.2, v.z * 5, 3);
      const streak = nz.fbm3(v.x * 21 + 3, v.y * 1.4, v.z * 21, 2);
      const c = SOOT.clone().lerp(ASH, clamp01(0.4 + n * 0.6 + streak * 0.3) * 0.85);
      const rot = sstep(1.05, 0.2, v.y) * clamp01(0.45 + nz.fbm3(v.x * 6 + 9, v.y * 3.5, v.z * 6, 2) * 0.9);
      c.lerp(ROT, rot * 0.65);
      return c.multiplyScalar(k);
    };

    /** A rag hanging from (x, y, z), its flat side turned to (ox, oz), torn to a point or a fork. */
    const strip = (x, y, z, ox, oz, len, w, o = {}) => {
      const { rows = 6, flare = 0.1, twist = 0, tipW = 0.1, s0 = 0.1, s1 = 1.6, dark = 1, fork = false } = o;
      const g = new THREE.PlaneGeometry(w, len, 2, rows);
      g.translate(0, -len / 2, 0);
      const p1 = R.range(0, TAU),
        p2 = R.range(0, TAU),
        wob = R.range(0.6, 1.3);
      deform(g, (p) => {
        const t = clamp01(-p.y / len);
        const side = Math.round((2 * p.x) / w);
        const half = side * (w / 2) * (1 - (1 - tipW) * Math.pow(t, 1.6)) * (1 + 0.16 * Math.sin(t * 8 + p1) * t);
        if (fork && side === 0 && t > 0.55) p.y += len * 0.18 * ((t - 0.55) / 0.45);
        const a = twist * t;
        p.x = Math.cos(a) * half + Math.sin(t * 4.1 + p2) * 0.028 * t * wob;
        p.z = Math.sin(a) * half + Math.sin(t * 3.3 + p1) * 0.03 * t * wob + flare * len * t * t;
      });
      xf(g, { r: [0, Math.atan2(ox, oz), 0], t: [x, y, z] });
      return paint(g, { color: (v) => cloth(v, dark), rough: 0.97, mat: MAT.CLOTH, sway: (v) => s0 + (s1 - s0) * Math.pow(clamp01((y - v.y) / len), 1.3) });
    };

    // ---- the cloak: a starved trunk under cloth, the chest fallen in, the back humped
    const HW = curve([[0.94, 0.175], [1.1, 0.155], [1.25, 0.15], [1.4, 0.17], [1.55, 0.205], [1.66, 0.232], [1.74, 0.21], [1.82, 0.12], [1.885, 0.06]]);
    const HD = curve([[0.94, 0.135], [1.1, 0.115], [1.25, 0.105], [1.4, 0.115], [1.55, 0.13], [1.66, 0.13], [1.74, 0.1], [1.82, 0.075], [1.885, 0.05]]);
    const CZ = curve([[0.94, -0.005], [1.1, -0.015], [1.25, -0.03], [1.4, -0.045], [1.55, -0.05], [1.66, -0.035], [1.74, -0.03], [1.82, -0.03], [1.885, -0.03]]);
    const caveAt = (y) => sstep(1.22, 1.45, y) * (1 - sstep(1.6, 1.72, y));
    const NC = 32;
    const rows = [];
    for (const y of [1.885, 1.83, 1.775, 1.72, 1.67]) rows.push({ y, rib: -1 });
    for (let j = 0; j <= 12; j++) rows.push({ y: 1.62 - 0.03 * j, rib: j });
    for (const y of [1.19, 1.11, 1.03]) rows.push({ y, rib: -1 });
    rows.push({ y: 0.94, rib: -1, hem: true });
    const rings = [],
      K = [];
    for (const row of rows) {
      const ring = [];
      const hw = HW(row.y),
        hd = HD(row.y),
        cz = CZ(row.y);
      for (let i = 0; i < NC; i++) {
        const a = (i / NC) * TAU;
        const ca = Math.cos(a),
          sa = Math.sin(a);
        const cx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.85),
          sz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.85);
        const front = Math.max(0, sa);
        // hanging folds, deeper toward the hem
        const pleat = 1 + 0.07 * Math.sin(a * 9 + 1.3) * sstep(1.5, 1.0, row.y) + 0.05 * nz.fbm3(cx * 2.6 + 5, row.y * 1.3, sz * 2.6, 2) * sstep(1.7, 1.2, row.y);
        const hump = sa < 0 ? 1 + 0.3 * sstep(1.3, 1.6, row.y) * (1 - sstep(1.7, 1.86, row.y)) : 1;
        let x = hw * cx * pleat,
          y = row.y,
          z = cz + hd * sz * hump * pleat - 0.045 * caveAt(row.y) * front * front * (1 - 0.55 * Math.abs(cx));
        if (row.hem) y += (i % 2 ? 0.055 : -0.035) + R.range(-0.03, 0.03);
        let k = 0;
        if (row.rib >= 0) {
          // ribs: every other ring stands proud, slanting down and outward from the breastbone
          const ax = Math.abs(x);
          const m = sstep(0.1, 0.45, front) * sstep(0.025, 0.065, ax) * (1 - sstep(0.7, 0.98, ax / hw)) * Math.pow(Math.sin((Math.PI * (row.rib + 0.5)) / 13), 0.6);
          k = (row.rib % 2 === 0 ? 1 : -0.7) * m;
          y -= 0.2 * ax * sstep(0, 0.4, front);
          z += 0.012 * k;
        }
        ring.push([x, y, z]);
        K.push(k);
      }
      rings.push(ring);
    }
    const cloak = loft(rings, { capA: true });
    K.push(0);
    paint(cloak, {
      color: (v) => cloth(v, (1 + 0.32 * (K[v.i] || 0)) * (1 - 0.3 * caveAt(v.y) * sstep(0.02, 0.1, v.z))),
      rough: 0.96,
      mat: MAT.CLOTH,
      sway: (v) => 0.35 * sstep(1.3, 0.92, v.y),
    });
    b.add(cloak);

    // ---- the hem: rags, and more rags inside them
    for (let i = 0; i < 22; i++) {
      const a = ((i + R.range(-0.3, 0.3)) / 22) * TAU;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const y0 = R.range(1.0, 1.1);
      const yEnd = i % 4 === 0 ? R.range(0.12, 0.2) : R.range(0.18, 0.42);
      b.add(strip(HW(y0) * ca * 0.96, y0, CZ(y0) + HD(y0) * sa * 0.96, ca, sa, y0 - yEnd, R.range(0.09, 0.15), { flare: R.range(0.05, 0.15), twist: R.range(-0.7, 0.7), tipW: R.range(0.04, 0.3), s0: 0.15, s1: R.range(1.3, 2.0), fork: R.chance(0.3) }));
    }
    for (let i = 0; i < 12; i++) {
      const a = ((i + R.range(-0.3, 0.3)) / 12) * TAU;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const y0 = R.range(1.0, 1.08);
      const yEnd = R.range(0.22, 0.5);
      b.add(strip(HW(y0) * ca * 0.7, y0, CZ(y0) + HD(y0) * sa * 0.7, ca, sa, y0 - yEnd, R.range(0.12, 0.18), { rows: 5, flare: R.range(0, 0.06), twist: R.range(-0.4, 0.4), tipW: R.range(0.1, 0.4), s0: 0.1, s1: R.range(1.0, 1.6), dark: 0.55 }));
    }

    // ---- the mantle: a short cape thrown back over the shoulders, long and torn behind
    const MHW = curve([[1.3, 0.345], [1.5, 0.345], [1.64, 0.335], [1.735, 0.29], [1.8, 0.17], [1.84, 0.07]]);
    const MHD = curve([[1.3, 0.215], [1.5, 0.2], [1.64, 0.175], [1.735, 0.135], [1.8, 0.09], [1.84, 0.06]]);
    const MCZ = curve([[1.3, -0.05], [1.5, -0.04], [1.64, -0.035], [1.735, -0.045], [1.8, -0.03], [1.84, -0.04]]);
    const MN = 28;
    const edgeY = [];
    for (let i = 0; i < MN; i++) {
      const sa = Math.sin((i / MN) * TAU);
      edgeY.push(Math.min(1.715, 1.5 + 0.2 * Math.pow(Math.max(0, sa), 0.7) - 0.14 * Math.max(0, -sa) + (i % 2 ? 0.035 : -0.03) + R.range(-0.02, 0.02)));
    }
    const mr = [];
    for (const f of [-3, -2, -1, 0.5, 1]) {
      // three rings at set heights, then two that follow the torn edge
      const ring = [];
      for (let i = 0; i < MN; i++) {
        const a = (i / MN) * TAU;
        const y = f === -3 ? 1.84 : f === -2 ? 1.8 : f === -1 ? 1.735 : lerp(1.735, edgeY[i], f);
        const wr = 1 + 0.05 * Math.sin(a * 7 + 2) * sstep(1.72, 1.5, y);
        ring.push([MHW(y) * Math.cos(a) * wr, y, MCZ(y) + MHD(y) * Math.sin(a) * wr]);
      }
      mr.push(ring);
    }
    const mantle = loft(mr, { capA: true });
    b.add(paint(mantle, { color: (v) => cloth(v, 1.1), rough: 0.96, mat: MAT.CLOTH, sway: (v) => 0.3 * sstep(1.7, 1.4, v.y) }));
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + 0.8 + ((i + R.range(0.15, 0.85)) / 8) * (Math.PI - 1.6);
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const y0 = 1.55 - 0.14 * Math.max(0, -sa);
      const yEnd = R.range(0.62, 1.05);
      b.add(strip(MHW(y0) * ca * 0.97, y0, MCZ(y0) + MHD(y0) * sa * 0.97, ca, sa, y0 - yEnd, R.range(0.1, 0.16), { flare: R.range(-0.02, 0.05), twist: R.range(-0.5, 0.5), tipW: R.range(0.05, 0.3), s0: 0.2, s1: R.range(1.0, 1.5), fork: R.chance(0.35) }));
    }

    // ---- the hood: a deep cowl bowed toward whoever it has found, and nothing in it
    const hoodM = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.91, 0.085), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0, 0)), new THREE.Vector3(1, 1, 1));
    const HN = 20;
    // z along the cowl, half width, half height, lift; 0 cloth, 1 the lip, 2 the lining
    const HR = [
      [-0.215, 0.028, 0.032, 0.035, 0],
      [-0.2, 0.078, 0.09, 0.03, 0],
      [-0.172, 0.12, 0.142, 0.025, 0],
      [-0.125, 0.16, 0.192, 0.018, 0],
      [-0.06, 0.184, 0.226, 0.01, 0],
      [0.01, 0.19, 0.238, 0.004, 0],
      [0.08, 0.184, 0.238, 0.0, 0],
      [0.145, 0.166, 0.226, -0.005, 0],
      [0.2, 0.144, 0.207, -0.01, 0],
      [0.216, 0.128, 0.19, -0.01, 1],
      [0.19, 0.114, 0.174, -0.01, 2],
      [0.09, 0.1, 0.15, -0.005, 2],
      [-0.01, 0.062, 0.09, 0.0, 2],
    ];
    const hr = [],
      HK = [];
    for (const [z, rx, ry, yo, kind] of HR) {
      const ring = [];
      for (let i = 0; i < HN; i++) {
        const a = (i / HN) * TAU;
        const ca = Math.cos(a),
          sa = Math.sin(a);
        const up = Math.max(0, sa);
        // a point at the crown, and a pointed arch to the opening
        const crown = kind === 0 ? Math.exp(-Math.pow((z + 0.1) / 0.09, 2)) * Math.pow(up, 4) : 0;
        const peak = 0.34 * crown + 0.1 * Math.pow(up, 6) * (kind === 0 ? sstep(0.0, 0.2, z) : 1);
        // the brow of the cowl hangs forward, its cheeks and chin fall back
        const lipZ = z > 0.12 ? (0.035 * up * up - 0.02 * ca * ca - 0.02 * Math.pow(Math.max(0, -sa), 2)) * sstep(0.12, 0.2, z) : 0;
        const wr = kind === 0 ? 1 + 0.035 * nz.fbm3(ca * 2.2, sa * 2.2, z * 9, 2) : 1;
        const chin = sa < 0 ? 1 - 0.18 * sa * sa : 1;
        ring.push([rx * ca * wr * chin, yo + ry * sa * (1 + peak) * wr, z + lipZ - 0.05 * crown]);
        HK.push(kind);
      }
      hr.push(ring);
    }
    const hood = loft(hr, { capA: true, capB: true });
    HK.push(0, 2);
    {
      // the lining takes no light from any side
      const n = hood.attributes.normal;
      for (let i = 0; i < n.count; i++) if (HK[i] === 2) n.setXYZ(i, 0, 0, 1);
    }
    hood.applyMatrix4(hoodM);
    paint(hood, {
      color: (v) => (HK[v.i] === 2 ? VOID : cloth(v, HK[v.i] === 1 ? 1.2 : 1.05)),
      rough: (v) => (HK[v.i] === 2 ? 1 : 0.95),
      // black and "metal": no diffuse and no highlight, so a lantern held up to it finds nothing
      metal: (v) => (HK[v.i] === 2 ? 1 : 0),
      mat: (v) => (HK[v.i] === 2 ? MAT.PLAIN : MAT.CLOTH),
      sway: 0,
    });
    b.add(hood);

    const eye = (sx) => {
      const g = ico(0.008, 1);
      g.translate(sx * 0.037, 0.022, 0.03);
      g.applyMatrix4(hoodM);
      return paint(g, { color: [0.75, 0.86, 1.0], emissive: 3.2, rough: 1, mat: MAT.GLOW, sway: 0 });
    };
    b.part('eyes', eye(-1), eye(1));

    // ---- the arms (built on the right, the left one mirrored)
    const S = [0.245, 1.7, 0.0],
      E = [0.28, 1.2, -0.02],
      W = [0.29, 0.74, 0.07];
    const skin = (v) => SKIN.clone().multiplyScalar(0.8 + 0.4 * clamp01(0.5 + nz.fbm3(v.x * 30, v.y * 9, v.z * 30, 2)));
    const finger = (k0, pts, len, r0) => {
      const g = tube(pts, (t) => r0 * Math.pow(1 - t, 0.75) + 0.0012 + 0.0024 * Math.exp(-Math.pow((t - 0.4) / 0.07, 2)), 4, { samples: 6 });
      const along = (v) => clamp01((k0[1] - v.y) / (len * 0.96));
      return paint(g, {
        color: (v) => {
          const t = along(v);
          return t > 0.66 ? CLAW : SKIN.clone().lerp(KNUCKLE, Math.min(1, Math.exp(-Math.pow((t - 0.4) / 0.08, 2)) * 0.7 + (t < 0.08 ? 0.5 : 0)));
        },
        rough: (v) => (along(v) > 0.66 ? 0.38 : 0.75),
        mat: MAT.PLAIN,
        sway: 0,
      });
    };
    const arm = () => {
      const out = [];
      // the sleeve: a rounded shoulder, a tube of cloth to below the elbow, a torn end
      const SN = 9;
      const sc = [
        [[S[0], S[1] + 0.04, S[2]], 0.016],
        [[S[0], S[1] + 0.022, S[2]], 0.044],
        [[S[0] + 0.004, S[1] - 0.025, S[2]], 0.062],
        [lerp3(S, E, 0.3), 0.064],
        [lerp3(S, E, 0.65), 0.056],
        [lerp3(S, E, 0.95), 0.064],
        [lerp3(E, W, 0.16), 0.07],
        [lerp3(E, W, 0.3), 0.076],
      ];
      const sr = sc.map(([c, r], j) => {
        const ring = [];
        for (let i = 0; i < SN; i++) {
          const a = (i / SN) * TAU;
          const rr = r * (1 + 0.1 * nz.fbm3(Math.cos(a) * 2 + 7, c[1] * 6, Math.sin(a) * 2, 2));
          const torn = j === sc.length - 1 ? (i % 2 ? -0.06 : 0.03) + R.range(-0.02, 0.02) : 0;
          ring.push([c[0] + rr * Math.cos(a), c[1] + torn, c[2] + rr * Math.sin(a)]);
        }
        return ring;
      });
      out.push(paint(loft(sr, { capA: true }), { color: (v) => cloth(v, 1.05), rough: 0.96, mat: MAT.CLOTH, sway: (v) => 0.5 * sstep(1.3, 1.05, v.y) }));
      const end = lerp3(E, W, 0.3);
      for (let i = 0; i < 3; i++) {
        const a = R.range(0, TAU);
        out.push(strip(end[0] + Math.cos(a) * 0.07, end[1] + 0.03, end[2] + Math.sin(a) * 0.07, Math.cos(a), Math.sin(a), R.range(0.14, 0.3), R.range(0.06, 0.09), { rows: 4, flare: 0.02, twist: R.range(-0.5, 0.5), tipW: R.range(0.05, 0.25), s0: 0.3, s1: 1.2 }));
      }
      // what the sleeve no longer covers: a forearm that is all bone, a narrow hand
      const fa = tube([lerp3(E, W, 0.08), lerp3(E, W, 0.55), W, [W[0], W[1] - 0.03, W[2] + 0.004]], (t) => lerp(0.027, 0.019, t) + 0.005 * Math.exp(-Math.pow((t - 0.9) / 0.07, 2)), 6, { samples: 7 });
      out.push(paint(fa, { color: skin, rough: 0.75, mat: MAT.PLAIN, sway: 0 }));
      const palm = new THREE.SphereGeometry(1, 7, 5);
      palm.scale(0.036, 0.058, 0.016);
      palm.translate(W[0], W[1] - 0.055, W[2] + 0.005);
      out.push(paint(palm, { color: (v) => skin(v).multiplyScalar(0.9), rough: 0.75, mat: MAT.PLAIN, sway: 0 }));
      // four fingers fanned, each ending in a claw that hooks back toward the palm side
      const fx = [-0.03, -0.011, 0.009, 0.028],
        fs = [-0.24, -0.08, 0.05, 0.2],
        fl = [0.165, 0.2, 0.19, 0.15];
      for (let i = 0; i < 4; i++) {
        const k0 = [W[0] + fx[i], W[1] - 0.098, W[2] + 0.006];
        const s = fs[i] + R.range(-0.04, 0.04),
          l = fl[i];
        const sn = Math.sin(s),
          cs = Math.cos(s);
        out.push(finger(k0, [k0, [k0[0] + l * 0.4 * sn, k0[1] - l * 0.4 * cs, k0[2] + 0.012], [k0[0] + l * 0.75 * sn, k0[1] - l * 0.74 * cs, k0[2] - 0.006 - l * 0.1], [k0[0] + l * sn, k0[1] - l * 0.96 * cs, k0[2] - 0.03 - l * 0.32]], l, 0.0105));
      }
      const t0 = [W[0] - 0.03, W[1] - 0.04, W[2] + 0.008];
      out.push(finger(t0, [t0, [t0[0] - 0.03, t0[1] - 0.045, t0[2] + 0.014], [t0[0] - 0.042, t0[1] - 0.085, t0[2] + 0.004], [t0[0] - 0.045, t0[1] - 0.115, t0[2] - 0.022]], 0.12, 0.0105));
      return out;
    };
    b.part('armR', arm());
    b.part('armL', arm().map(mirrorX));

    const head = new THREE.Vector3(0, -0.01, 0.2).applyMatrix4(hoodM);
    b.anchor('shoulderL', -S[0], S[1], S[2]).anchor('shoulderR', S[0], S[1], S[2]);
    b.anchor('head', head.x, head.y, head.z).anchor('core', 0, 1.3, -0.02);
    return b.build();
  },
  { kind: 'creature', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// crow: a carrion crow, 0.45 m from bill to tail, standing. Heavy bill, shaggy throat. The wings
// are built spread flat along -X and +X: the game folds them about the shoulder joints when the
// bird sits, and beats them when it leaves. Three birds: one looking ahead, one with its head
// turned and cocked, one hunched with its bill down.
// ---------------------------------------------------------------------------------------------
register(
  'crow',
  (seed) => {
    const v = ((((seed | 0) - 1) % 3) + 3) % 3;
    const R = new Rng(seed * 733 + 11);
    const b = new Builder();
    const SC = [1.0, 0.93, 1.07][v];
    const yaw = [0, 0.8, -0.4][v],
      pitch = [0, -0.12, 0.4][v];
    const BLACK = col('#0d0d10'),
      SHEEN = col('#0f1d24'),
      BILL = col('#34353a'),
      BILLTIP = col('#17171a'),
      LEG = col('#19191c'),
      EYE = col('#70757c');
    const size = (g) => {
      g.scale(SC, SC, SC);
      return g;
    };

    // ---- body, head and bill as one skin along the spine: [y, z, half width, half height]
    const SP = [
      [0.098, -0.115, 0.02, 0.016],
      [0.112, -0.085, 0.04, 0.035],
      [0.132, -0.03, 0.056, 0.055],
      [0.156, 0.025, 0.055, 0.058],
      [0.181, 0.06, 0.045, 0.049],
      [0.206, 0.08, 0.031, 0.033],
      [0.231, 0.09, 0.032, 0.033],
      [0.243, 0.11, 0.031, 0.031],
      [0.239, 0.132, 0.019, 0.0215],
      [0.231, 0.16, 0.0105, 0.0135],
      [0.22, 0.187, 0.002, 0.003],
    ];
    const NECK = new THREE.Vector3(0, SP[5][0], SP[5][1]);
    const HEADW = [0, 0, 0, 0, 0, 0.35, 0.8, 1, 1, 1, 1];
    const _e = new THREE.Euler(),
      _p = new THREE.Vector3();
    /** Turn a point with the head: w is how much of the head's turn it takes. */
    const head = (p, w = 1) => {
      if (w <= 0) return p;
      _e.set(pitch * w, yaw * w, 0, 'YXZ');
      _p.set(p[0], p[1], p[2]).sub(NECK).applyEuler(_e).add(NECK);
      return [_p.x, _p.y, _p.z];
    };
    const NB = 10;
    const rings = [],
      BK = [];
    for (let k = 0; k < SP.length; k++) {
      const [y, z, wx, wy] = SP[k];
      const a0 = SP[Math.max(0, k - 1)],
        a1 = SP[Math.min(SP.length - 1, k + 1)];
      let ty = a1[0] - a0[0],
        tz = a1[1] - a0[1];
      const tl = Math.hypot(ty, tz) || 1;
      ty /= tl;
      tz /= tl;
      const ring = [];
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * TAU;
        const ca = Math.cos(a),
          sa = Math.sin(a);
        let h = wy * sa;
        if (sa > 0 && k >= 2 && k <= 4) h *= 0.85; // a flat back
        if (sa < -0.9 && k >= 5 && k <= 7) h -= 0.012; // the shaggy throat
        ring.push(head([wx * ca, y + h * tz, z - h * ty], HEADW[k]));
        BK.push(k);
      }
      rings.push(ring);
    }
    const skinGeo = loft(rings, { capA: true, capB: true });
    BK.push(0, 10);
    paint(skinGeo, {
      color: (q) => {
        const k = BK[q.i];
        return k >= 9 ? (k === 10 ? BILLTIP : BILL) : k === 8 ? BLACK.clone().lerp(BILL, 0.55) : BLACK.clone().multiplyScalar(0.85 + 0.3 * R.next());
      },
      rough: (q) => (BK[q.i] >= 8 ? 0.36 : BK[q.i] >= 6 ? 0.5 : 0.62),
      mat: MAT.PLAIN,
      sway: 0,
    });

    // ---- loose feathers of the body: the tail, the hackles under the bill
    const T = [];
    const tri = (a, c, d) => T.push(...a, ...c, ...d);
    const TR = [[-0.022, 0.106, -0.092], [0, 0.112, -0.095], [0.022, 0.106, -0.092]],
      TM = [[-0.034, 0.076, -0.178], [0, 0.082, -0.182], [0.034, 0.076, -0.178]],
      TT = [[-0.03, 0.05, -0.248], [0, 0.052, -0.262], [0.03, 0.05, -0.248]];
    for (const [A, B] of [[TR, TM], [TM, TT]])
      for (let i = 0; i < 2; i++) {
        tri(A[i], A[i + 1], B[i]);
        tri(A[i + 1], B[i + 1], B[i]);
      }
    for (const [x, zz, yt] of [[-0.013, 0.116, 0.166], [0.013, 0.114, 0.164], [0, 0.122, 0.172]]) tri(head([x - 0.009, 0.204, zz - 0.004], 0.8), head([x + 0.009, 0.204, zz - 0.004], 0.8), head([x * 1.3, yt, zz + 0.014], 0.8));
    const loose = paint(trisGeo(T), { color: () => BLACK.clone().multiplyScalar(0.8 + 0.3 * R.next()), rough: 0.55, mat: MAT.PLAIN, sway: 0 });

    // ---- legs and feet
    const legs = [];
    const F = [];
    for (const sx of [-1, 1]) {
      legs.push(tube([[sx * 0.024, 0.088, -0.012], [sx * 0.027, 0.006, 0.004]], 0.0045, 3, { samples: 1, caps: false }));
      const A = [sx * 0.027, 0.005, 0.004];
      for (const [th, len] of [[-0.45, 0.038], [0, 0.042], [0.45, 0.038], [Math.PI, 0.026]]) {
        const dx = Math.sin(th),
          dz = Math.cos(th);
        F.push(A[0] - dz * 0.0045, A[1], A[2] + dx * 0.0045, A[0] + dz * 0.0045, A[1], A[2] - dx * 0.0045, A[0] + dx * len, 0.002, A[2] + dz * len);
      }
    }
    legs.push(trisGeo(F));
    for (const g of legs) paint(g, { color: LEG, rough: 0.6, mat: MAT.PLAIN, sway: 0 });
    // feathered thighs over the tops of the legs
    const thighs = [-1, 1].map((sx) =>
      paint(tube([[sx * 0.023, 0.108, -0.016], [sx * 0.026, 0.05, -0.002]], (t) => lerp(0.017, 0.006, t), 4, { samples: 1, caps: false }), { color: () => BLACK.clone().multiplyScalar(0.8 + 0.3 * R.next()), rough: 0.6, mat: MAT.PLAIN, sway: 0 })
    );

    // ---- one dull point of light for each eye
    const EY = [];
    for (const sx of [-1, 1]) {
      const c = [sx * 0.0315, 0.25, 0.117],
        d = 0.0034;
      const p = [
        [c[0], c[1] + d, c[2]],
        [c[0], c[1], c[2] + d],
        [c[0], c[1] - d, c[2]],
        [c[0], c[1], c[2] - d],
      ].map((q) => head(q, 1));
      EY.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
    }
    const eyes = paint(trisGeo(EY), { color: EYE, rough: 0.3, mat: MAT.PLAIN, sway: 0 });

    b.part('body', size(skinGeo), size(loose), legs.map(size), thighs.map(size), size(eyes));

    // ---- a wing (the right one): x out along the span, z toward the leading edge
    const WA = [0.036, 0.195, 0.04];
    const wing = () => {
      const out = [];
      const fan = (arr, pts) => {
        for (let i = 1; i < pts.length - 1; i++) arr.push(...pts[0], ...pts[i], ...pts[i + 1]);
      };
      // coverts: the arm of the wing, where the sheen is
      const C = [];
      fan(C, [
        [0, 0.004, 0.048],
        [0.1, 0.008, 0.062],
        [0.2, 0.007, 0.07],
        [0.262, 0.004, 0.06],
        [0.276, 0.002, 0.034],
        [0.24, 0.004, -0.014],
        [0.12, 0.006, -0.022],
        [0, 0.004, -0.024],
      ]);
      out.push(paint(trisGeo(C), { color: SHEEN, rough: 0.5, metal: 0.22, mat: MAT.PLAIN, sway: 0 }));
      // flight feathers: secondaries along the trailing edge, primaries fingered at the tip
      const Q = [];
      const feather = (root, dir, perp, len, w, yTip) => {
        const at = (along, side, y) => [root[0] + dir[0] * along + perp[0] * side, y, root[2] + dir[1] * along + perp[1] * side];
        fan(Q, [at(0, -w, root[1]), at(0, w, root[1]), at(len * 0.72, w * 0.9, root[1] - 0.003), at(len, w * 0.1, yTip), at(len * 0.76, -w * 0.85, root[1] - 0.003)]);
      };
      for (let i = 0; i < 5; i++) {
        const th = 0.08 + 0.09 * i;
        feather([0.02 + 0.045 * i, 0.002 - 0.0012 * i, -0.012], [Math.sin(th), -Math.cos(th)], [Math.cos(th), Math.sin(th)], 0.1 + 0.004 * i, 0.026, -0.006);
      }
      const PH = [1.05, 0.8, 0.56, 0.36, 0.18, 0.02],
        PL = [0.15, 0.17, 0.185, 0.19, 0.18, 0.16];
      for (let j = 0; j < 6; j++) feather([lerp(0.2, 0.268, j / 5), -0.001 - 0.001 * j, lerp(0.0, 0.04, j / 5)], [Math.cos(PH[j]), -Math.sin(PH[j])], [Math.sin(PH[j]), Math.cos(PH[j])], PL[j], 0.017, -0.013);
      out.push(paint(trisGeo(Q), { color: () => BLACK.clone().multiplyScalar(0.75 + 0.4 * R.next()), rough: 0.62, mat: MAT.PLAIN, sway: 0 }));
      for (const g of out) g.translate(WA[0], WA[1], WA[2]);
      return out;
    };
    b.part('wingR', wing().map(size));
    b.part('wingL', wing().map(mirrorX).map(size));
    b.anchor('wingL', -WA[0] * SC, WA[1] * SC, WA[2] * SC).anchor('wingR', WA[0] * SC, WA[1] * SC, WA[2] * SC);
    return b.build();
  },
  { kind: 'creature', variants: 3 }
);
