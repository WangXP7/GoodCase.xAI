// The people of Morne who were turned to salt where they stood, and a scarecrow.
//
// A salt figure is not assembled from limbs. Its body is a signed distance field (capsules and
// ellipsoids hung on a posed skeleton and melted into each other), meshed as one skin, so arms fuse
// to chests and skirts to the ground the way they do in a cast. The skin is then roughened, streaked
// by rain and hung with crystal growths and drips.
import { Builder, Rng, Noise, MAT, PAL, THREE, paint, xf, col, mixc, lathe, tube, deform, TAU } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, sstep, pole, aim, rope, ROPE, weathering, stoneTone, placed, looseStone } from './_shared.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const dirv = (a) => vec(a).normalize();
const perp = (v, n) => v.addScaledVector(n, -v.dot(n)).normalize();

// ---------------------------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------------------------
class Field {
  constructor() {
    this.c = [];
    this.e = [];
    this.min = [1e9, 1e9, 1e9];
    this.max = [-1e9, -1e9, -1e9];
  }
  grow(p, r) {
    const a = [p.x, p.y, p.z];
    for (let i = 0; i < 3; i++) {
      this.min[i] = Math.min(this.min[i], a[i] - r);
      this.max[i] = Math.max(this.max[i], a[i] + r);
    }
  }
  /** A tapered capsule from a to b, melted into what is already there over a distance k. */
  cap(a, b, ra, rb = ra, k = 0.04) {
    this.c.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x - a.x, by: b.y - a.y, bz: b.z - a.z, il: 1 / Math.max(1e-9, a.distanceToSquared(b)), ra, rb, k });
    this.grow(a, ra);
    this.grow(b, rb);
    return this;
  }
  /**
   * An ellipsoid with radii r along the unit axes ax. `face` = { n, d } slices it flat on a plane.
   * `down` (upright ellipsoids only) carries its widest section straight down: a mound with a root.
   */
  ell(c, r, ax = null, k = 0.04, face = null, down = false) {
    this.e.push({ c, r, ax: ax || [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)], k, face, down, rm: Math.min(r[0], r[1], r[2]) });
    this.grow(c, Math.max(r[0], r[1], r[2]));
    return this;
  }
  dist(x, y, z) {
    let d = 1e9;
    for (const q of this.c) {
      const px = x - q.ax,
        py = y - q.ay,
        pz = z - q.az;
      let t = (px * q.bx + py * q.by + pz * q.bz) * q.il;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - q.bx * t,
        dy = py - q.by * t,
        dz = pz - q.bz * t;
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - (q.ra + (q.rb - q.ra) * t), q.k);
    }
    for (const q of this.e) {
      const px = x - q.c.x,
        pz = z - q.c.z;
      let py = y - q.c.y;
      if (q.down && py < 0) py = 0;
      const lx = (px * q.ax[0].x + py * q.ax[0].y + pz * q.ax[0].z) / q.r[0],
        ly = (px * q.ax[1].x + py * q.ax[1].y + pz * q.ax[1].z) / q.r[1],
        lz = (px * q.ax[2].x + py * q.ax[2].y + pz * q.ax[2].z) / q.r[2];
      const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const k1 = Math.sqrt((lx * lx) / (q.r[0] * q.r[0]) + (ly * ly) / (q.r[1] * q.r[1]) + (lz * lz) / (q.r[2] * q.r[2]));
      let di = k0 < 1e-6 ? -q.rm : (k0 * (k0 - 1)) / k1;
      if (q.face) di = -smin(-di, -(px * q.face.n.x + py * q.face.n.y + pz * q.face.n.z - q.face.d), 0.03);
      d = smin(d, di, q.k);
    }
    return d;
  }
}

/** Two-bone reach: from root a toward target t, the joint bending toward `hint`. */
function ik(a, t, l1, l2, hint) {
  const d = t.clone().sub(a);
  let L = d.length();
  const max = (l1 + l2) * 0.998;
  if (L > max) {
    d.multiplyScalar(max / L);
    L = max;
  }
  const along = d.clone().multiplyScalar(1 / L);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const hp = hint.clone().addScaledVector(along, -hint.dot(along));
  if (hp.lengthSq() < 1e-8) hp.set(0, 0, 1);
  hp.normalize();
  return [a.clone().addScaledVector(along, x).addScaledVector(hp, h), a.clone().add(d)];
}

/**
 * Pose one person and add their volumes to the field. A pose is written for someone 1.72 m tall
 * who faces +Z with the left hand on +X; `S`, `yaw` and `at` then size and place them.
 *   pel: pelvis centre            sLo, sUp: directions of the lower and upper spine
 *   twist: shoulders turned against the hips (radians, + = left shoulder back)
 *   shrug: [left, right] how far each shoulder is lifted
 *   neck, face: directions        hands.L/R: { at: wrist, hint: where the elbow points, dir: hand }
 *   feet.L/R: { at: ankle, hint: where the knee points, dir: foot }
 *   dress: 'legs' | 'skirt' | 'robe'      tunic, cloak, hood, sleeves: what else they wore
 */
function figure(F, P, { S = 1.72, yaw = 0, at = [0, 0, 0] } = {}) {
  const f = S / 1.72;
  const pel = vec(P.pel),
    sLo = dirv(P.sLo),
    sUp = dirv(P.sUp),
    nk = dirv(P.neck),
    face = dirv(P.face);
  const chest = pel.clone().addScaledVector(sLo, 0.3);
  const neckB = chest.clone().addScaledVector(sUp, 0.22);
  const head = neckB.clone().addScaledVector(nk, 0.165);
  const hy = P.hipYaw || 0,
    tw = hy + (P.twist || 0);
  const latP = perp(V3(Math.cos(hy), 0, -Math.sin(hy)), sLo),
    latS = perp(V3(Math.cos(tw), 0, -Math.sin(tw)), sUp);
  const fwdP = latP.clone().cross(sLo),
    fwdS = latS.clone().cross(sUp);
  const shrug = P.shrug || [0, 0];
  const sh = chest.clone().addScaledVector(sUp, 0.165);
  const limbs = {};
  for (const [s, k, i] of [
    ['L', 1, 0],
    ['R', -1, 1],
  ]) {
    const shoulder = sh.clone().addScaledVector(latS, k * 0.19).addScaledVector(sUp, shrug[i]);
    const [elbow, wrist] = ik(shoulder, vec(P.hands[s].at), 0.3, 0.25, vec(P.hands[s].hint));
    const hip = pel.clone().addScaledVector(sLo, -0.04).addScaledVector(latP, k * 0.088);
    const [knee, ankle] = ik(hip, vec(P.feet[s].at), 0.42, 0.42, vec(P.feet[s].hint));
    const fd = dirv(P.feet[s].dir);
    limbs[s] = { shoulder, elbow, wrist, tip: wrist.clone().addScaledVector(dirv(P.hands[s].dir), 0.115), hip, knee, ankle, heel: ankle.clone().addScaledVector(fd, -0.04), toe: ankle.clone().addScaledVector(fd, 0.17) };
  }
  // put the lowest part of them on the ground
  let low = Math.min(pel.y - 0.12, chest.y - 0.12);
  for (const l of Object.values(limbs)) low = Math.min(low, l.knee.y - 0.058, l.ankle.y - 0.042, l.heel.y - 0.042, l.toe.y - 0.034, l.wrist.y - 0.036, l.tip.y - 0.034, l.elbow.y - 0.043);
  const ground = low + 0.012;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const W = (v) => V3((v.x * cy + v.z * sy) * f + at[0], (v.y - ground) * f + at[1], (-v.x * sy + v.z * cy) * f + at[2]);
  const Wd = (v) => V3(v.x * cy + v.z * sy, v.y, -v.x * sy + v.z * cy);
  const cap = (a, b, ra, rb, k = 0.04) => F.cap(W(a), W(b), ra * f, rb * f, k * f);
  const ell = (c, r, ax, k = 0.05, fp = null) => F.ell(W(c), [r[0] * f, r[1] * f, r[2] * f], ax.map(Wd), k * f, fp ? { n: Wd(fp.n), d: fp.d * f } : null);
  const along = (p, v, k) => p.clone().addScaledVector(v, k);

  const long = P.dress === 'skirt' || P.dress === 'robe';
  const fat = P.dress === 'robe' || P.cloak ? 0.012 : 0;
  // trunk
  ell(pel, [0.155, 0.125, 0.11], [latP, sLo, fwdP], 0.05);
  ell(along(pel, sLo, 0.16), [0.128, 0.15, 0.096], [latP, sLo, fwdP], 0.06);
  ell(along(chest, sUp, 0.02), [0.165 + fat, 0.17, 0.115 + fat], [latS, sUp, fwdS], 0.06);
  cap(along(limbs.L.shoulder, latS, -0.04), along(limbs.R.shoulder, latS, 0.04), 0.064 + fat, 0.064 + fat, 0.06);
  cap(along(neckB, nk, -0.03), along(head, nk, -0.04), 0.05, 0.046, 0.035);
  // the head: an egg with the front taken off flat. No features.
  const hUp = perp(nk.clone(), face),
    hLat = hUp.clone().cross(face);
  ell(head, [0.078, 0.113, 0.095], [hLat, hUp, face], 0.03, { n: face, d: 0.079 });
  const chin = along(along(head, hUp, -0.068), face, 0.034);
  cap(chin, chin, 0.046, 0.046, 0.035);
  if (P.hood) {
    ell(along(along(head, face, -0.022), hUp, 0.004), [0.103, 0.135, 0.115], [hLat, hUp, face], 0.03, { n: face, d: 0.082 });
    cap(along(head, face, -0.05), along(along(chest, sUp, 0.1), fwdS, -0.1), 0.095, 0.115, 0.06);
  }
  for (const l of Object.values(limbs)) {
    const sl = P.sleeves ? 0.012 : 0;
    cap(l.shoulder, l.elbow, 0.054 + sl, 0.046 + sl, 0.045);
    cap(l.elbow, l.wrist, 0.046 + sl, 0.037 + sl, 0.03);
    cap(l.wrist, l.tip, 0.04, 0.033, 0.03);
    // the hanging part of a wide sleeve
    if (P.sleeves) cap(l.wrist.clone().lerp(l.elbow, 0.4), l.wrist.clone().lerp(l.elbow, 0.3).add(V3(0, -(P.sleeves === true ? 0.15 : P.sleeves), 0)), 0.052, 0.03, 0.045);
    if (long) {
      // legs under cloth
      cap(l.hip, l.knee, 0.1, 0.09, 0.09);
      cap(l.knee, l.ankle, 0.085, 0.08, 0.09);
    } else {
      cap(l.hip, l.knee, 0.086, 0.06, 0.045);
      cap(l.knee, l.ankle, 0.058, 0.043, 0.035);
    }
    cap(l.heel, l.toe, 0.043, 0.035, 0.03);
  }
  if (long) {
    // the cloth itself: narrow at the waist, falling to a wide hem that stands on the ground
    const mk = limbs.L.knee.clone().lerp(limbs.R.knee, 0.5),
      ma = limbs.L.ankle.clone().lerp(limbs.R.ankle, 0.5);
    const hemR = P.dress === 'robe' ? 0.19 : 0.235;
    const kneeling = mk.y - ground < 0.25;
    if (kneeling) {
      cap(pel, mk, 0.13, 0.13, 0.1);
      cap(mk, ma, 0.13, 0.12, 0.1);
    } else {
      const hem = V3(ma.x, ground - 0.02, ma.z);
      cap(pel, mk, 0.125, 0.155, 0.1);
      cap(mk, hem, 0.155, hemR, 0.1);
      cap(V3(limbs.L.ankle.x, ground, limbs.L.ankle.z), V3(limbs.R.ankle.x, ground, limbs.R.ankle.z), 0.12, 0.12, 0.09);
    }
  } else if (P.tunic) {
    const mt = limbs.L.hip.clone().lerp(limbs.L.knee, 0.55).lerp(limbs.R.hip.clone().lerp(limbs.R.knee, 0.55), 0.5);
    cap(along(pel, sLo, 0.04), mt, 0.145, 0.16, 0.05);
  }
  if (P.cloak) {
    // a cloak falls from the shoulders to the ground behind them: [how far behind the hips, how wide there]
    const [k, r] = P.cloak === true ? [0.14, 0.18] : P.cloak;
    cap(along(neckB, fwdS, -0.06), V3(pel.x - Math.sin(hy) * k, ground - 0.02, pel.z - Math.cos(hy) * k), 0.11, r, 0.07);
  }
  // where they stand, kneel or lie
  const onGround = (v) => {
    const w = W(v);
    w.y = 0;
    return w;
  };
  const feet = limbs.L.ankle.clone().lerp(limbs.R.ankle, 0.5);
  if (limbs.L.knee.y - ground < 0.25) feet.lerp(limbs.L.knee.clone().lerp(limbs.R.knee, 0.5), 0.5);
  return { feet: onGround(feet), pel: onGround(pel), chest: onGround(chest), knees: onGround(limbs.L.knee.clone().lerp(limbs.R.knee, 0.5)) };
}

// ---------------------------------------------------------------------------------------------
// Meshing: naive surface nets on a grid whose lines need not be evenly spaced. One vertex in every
// cell the surface passes through, one quad for every grid edge that crosses it.
// ---------------------------------------------------------------------------------------------
function surfaceNet(fn, xs, ys, zs) {
  const nx = xs.length,
    ny = ys.length,
    nz = zs.length;
  const val = new Float32Array(nx * ny * nz);
  let n = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[n++] = fn(xs[i], ys[j], zs[k]);
  const id = (i, j, k) => i + nx * (j + ny * k);
  const vert = new Int32Array(nx * ny * nz).fill(-1);
  const P = [];
  const v = new Float32Array(8);
  const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = val[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          m = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = EDGES[e],
            b = EDGES[e + 1];
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          m++;
        }
        vert[id(i, j, k)] = P.length / 3;
        P.push(xs[i] + (sx / m) * (xs[i + 1] - xs[i]), ys[j] + (sy / m) * (ys[j + 1] - ys[j]), zs[k] + (sz / m) * (zs[k + 1] - zs[k]));
      }
    }
  }
  const Q = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) Q.push(d, c, b, a);
    else Q.push(a, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const s = val[id(i, j, k)] < 0;
        if (s !== val[id(i + 1, j, k)] < 0) quad(vert[id(i, j - 1, k - 1)], vert[id(i, j, k - 1)], vert[id(i, j, k)], vert[id(i, j - 1, k)], !s);
        if (s !== val[id(i, j + 1, k)] < 0) quad(vert[id(i - 1, j, k - 1)], vert[id(i - 1, j, k)], vert[id(i, j, k)], vert[id(i, j, k - 1)], !s);
        if (s !== val[id(i, j, k + 1)] < 0) quad(vert[id(i - 1, j - 1, k)], vert[id(i, j - 1, k)], vert[id(i, j, k)], vert[id(i - 1, j, k)], !s);
      }
    }
  }
  return { P, Q };
}

function lines(a, b, step) {
  const out = [a];
  while (out[out.length - 1] < b) out.push(out[out.length - 1] + (typeof step === 'function' ? step(out[out.length - 1]) : step));
  return out;
}

const SALT = col(PAL.salt).multiplyScalar(0.8),
  SALT_PINK = col('#b9958c'),
  SALT_GREY = col('#77746f'),
  SALT_DIRT = col('#5f574d');

/** The colour of salt at a point: faint strata, pink and grey impurities, dirt creeping up from the ground. */
function saltAt(nz, x, y, z) {
  const c = SALT.clone();
  c.multiplyScalar(0.9 + 0.1 * nz.n3(x * 1.5, y * 15 + nz.n2(x * 2, z * 2) * 1.5, z * 1.5));
  c.lerp(SALT_PINK, clamp01(nz.fbm3(x * 2.2 + 30, y * 2.2, z * 2.2, 2) * 0.9) * 0.4);
  c.lerp(SALT_GREY, clamp01(nz.fbm3(x * 2 - 20, y * 2, z * 2 + 7, 2) * 1.2 - 0.1) * 0.38);
  c.lerp(SALT_DIRT, sstep(0.5, 0, y + nz.n2(x * 5, z * 5) * 0.12) * 0.6);
  return c;
}

/**
 * Skin a field with salt. Returns { P, N } (vertex positions and normals) for placing growths.
 * The model is shifted so that (cx, cz) lands on the origin; flip = -1 mirrors it left to right.
 */
function saltSkin(T, F, { xz, yStep, rng, nz, cx, cz, flip = 1, facet = 0.5 }) {
  const lump = (x, y, z) => nz.fbm3(x * 7, y * 7, z * 7, 2) * 0.014 * (1 + 1.2 * clamp01(1 - y / 0.4));
  const D = (x, y, z) => Math.max(F.dist(cx + flip * x, y, z + cz) + lump(x, y, z), -0.085 - y);
  const pad = xz * 1.5 + 0.03;
  const { P, Q } = surfaceNet(D, lines(F.min[0] - cx - pad, F.max[0] - cx + pad, xz), lines(-0.13, F.max[1] + pad, yStep), lines(F.min[2] - cz - pad, F.max[2] - cz + pad, xz));
  const n = P.length / 3;
  const N = new Float32Array(n * 3);
  const C = [];
  const e = xz * 0.4;
  const g = [0, 0, 0];
  const grad = (x, y, z) => {
    g[0] = D(x + e, y, z) - D(x - e, y, z);
    g[1] = D(x, y + e, z) - D(x, y - e, z);
    g[2] = D(x, y, z + e) - D(x, y, z - e);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= l;
    g[1] /= l;
    g[2] /= l;
    return l / (2 * e);
  };
  for (let i = 0; i < n; i++) {
    let x = P[i * 3],
      y = P[i * 3 + 1],
      z = P[i * 3 + 2];
    // the net puts its vertices near the surface: walk them onto it, so the coarse mesh does not show the grid
    for (let it = 0; it < 2; it++) {
      const slope = grad(x, y, z);
      const s = Math.max(-xz * 0.5, Math.min(xz * 0.5, D(x, y, z) / Math.max(0.3, slope)));
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    grad(x, y, z);
    // a crystalline skin: every vertex stands a little in or out of the true surface
    const j = rng.range(-0.005, 0.005);
    x += g[0] * j;
    y += g[1] * j;
    z += g[2] * j;
    P[i * 3] = x;
    P[i * 3 + 1] = y;
    P[i * 3 + 2] = z;
    N[i * 3] = g[0];
    N[i * 3 + 1] = g[1];
    N[i * 3 + 2] = g[2];
    // dark in the folds, paler where it looks at the sky
    const c = saltAt(nz, x, y, z);
    const occ = clamp01(F.dist(cx + flip * (x + g[0] * 0.07), y + g[1] * 0.07, z + cz + g[2] * 0.07) / 0.07);
    c.multiplyScalar((0.45 + 0.55 * occ) * (0.88 + 0.16 * Math.max(0, g[1])) * (1 - 0.2 * Math.max(0, -g[1])));
    C.push(c);
  }
  const p = (i) => V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const fn = new THREE.Vector3(),
    e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3();
  // how squarely the triangle a b c faces the way the surface does there
  const facing = (a, b, c) => {
    fn.crossVectors(e1.subVectors(p(b), p(a)), e2.subVectors(p(c), p(a)));
    const l = fn.length();
    if (l < 1e-9) return 0;
    return (fn.x * (N[a * 3] + N[b * 3] + N[c * 3]) + fn.y * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fn.z * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2])) / (3 * l);
  };
  const tri = (a, b, c) => {
    const pa = p(a),
      pb = p(b),
      pc = p(c);
    fn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
    if (fn.lengthSq() < 1e-14) return;
    fn.normalize();
    const nn = (i) => V3(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).multiplyScalar(1 - facet).addScaledVector(fn, facet);
    T.rough = rng.chance(0.22) ? rng.range(0.26, 0.4) : rng.range(0.58, 0.8); // here and there a face that catches the light
    T.tri(pa, pb, pc, C[a], C[b], C[c], nn(a), nn(b), nn(c));
  };
  for (let q = 0; q < Q.length; q += 4) {
    const a = Q[q],
      b = Q[q + 1],
      c = Q[q + 2],
      d = Q[q + 3];
    if (P[a * 3 + 1] < -0.07 && P[b * 3 + 1] < -0.07 && P[c * 3 + 1] < -0.07 && P[d * 3 + 1] < -0.07) continue; // the cut underneath
    // split the quad along the diagonal that leaves neither half folded over
    if (Math.min(facing(a, b, c), facing(a, c, d)) >= Math.min(facing(a, b, d), facing(b, c, d))) {
      tri(a, b, c);
      tri(a, c, d);
    } else {
      tri(a, b, d);
      tri(b, c, d);
    }
  }
  return { P, N };
}

/** Cubes of salt grown into one another where it lies thickest, and drips where it ran. */
function growths(b, T, { P, N }, rng, nz, { clusters = 0, base = 3, drips = 7 } = {}) {
  const n = P.length / 3;
  const ups = [],
    low = [],
    downs = [];
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1],
      ny = N[i * 3 + 1];
    if (ny > 0.6 && y > 0.3) ups.push(i);
    else if (ny > 0.3 && y > 0.01 && y < 0.12) low.push(i);
    if (ny < -0.7 && y > 0.3) downs.push(i);
  }
  const q = new THREE.Quaternion(),
    o = new THREE.Vector3();
  const cluster = (i, big) => {
    const x = P[i * 3],
      y = P[i * 3 + 1],
      z = P[i * 3 + 2];
    // halite grows in cubes, and the cubes of one cluster share their axes; most of each is buried
    q.setFromEuler(new THREE.Euler(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)));
    const s0 = rng.range(0.04, 0.06) * big;
    for (let k = 0; k < (big > 1 ? 4 : 2); k++) {
      const s = k ? s0 * rng.range(0.4, 0.8) : s0;
      o.set(0, 0, 0);
      if (k) o.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(s0 * 0.75).applyQuaternion(q);
      const g = new THREE.BoxGeometry(s, s * rng.range(0.7, 1.1), s * rng.range(0.7, 1.1));
      g.applyQuaternion(q);
      const sink = big > 1 ? 0.3 : 0.45;
      g.translate(x + o.x - N[i * 3] * s * sink, Math.max(big > 1 ? s * 0.1 : -1, y + o.y - N[i * 3 + 1] * s * sink), z + o.z - N[i * 3 + 2] * s * sink);
      const c = saltAt(nz, x, y + 0.5, z).multiplyScalar(rng.range(0.78, 0.95));
      b.add(paint(g, { color: c, rough: 0.3, mat: MAT.CRYSTAL }));
    }
  };
  for (let k = 0; k < clusters && ups.length; k++) cluster(rng.pick(ups), 1);
  for (let k = 0; k < base && low.length; k++) cluster(rng.pick(low), 1.5);
  const used = [];
  for (let k = 0, tries = 0; k < drips && tries < 200 && downs.length; tries++) {
    const i = rng.pick(downs);
    const x = P[i * 3],
      y = P[i * 3 + 1],
      z = P[i * 3 + 2];
    if (used.some((u) => Math.hypot(u[0] - x, u[1] - y, u[2] - z) < 0.06)) continue;
    used.push([x, y, z]);
    k++;
    // thick where it leaves the body, then a thin tail that does not hang quite plumb
    const len = Math.min(y - 0.05, rng.chance(0.4) ? rng.range(0.025, 0.05) : rng.range(0.06, 0.15)),
      r = rng.range(0.012, 0.02) * (0.7 + len * 3);
    const a0 = rng.range(0, TAU),
      bx = rng.range(-0.14, 0.14) * len,
      bz = rng.range(-0.14, 0.14) * len;
    const ring = (yy, rr, k) => [0, 1, 2].map((i) => V3(x + bx * k + Math.cos(a0 + (i * TAU) / 3) * rr, yy, z + bz * k + Math.sin(a0 + (i * TAU) / 3) * rr));
    const A = ring(y + 0.018, r, 0),
      B = ring(y - len * 0.36, r * 0.42, 0.35),
      tip = V3(x + bx, y - len, z + bz);
    const c = saltAt(nz, x, y, z).multiplyScalar(rng.range(0.72, 0.9)),
      c2 = c.clone().multiplyScalar(0.85);
    T.rough = 0.42;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3,
        out = V3(Math.cos(a0 + ((i + 0.5) * TAU) / 3), 0, Math.sin(a0 + ((i + 0.5) * TAU) / 3));
      T.quadOut(A[i], A[j], B[j], B[i], out, c, c, c2, c2);
      T.triOut(B[i], B[j], tip, out, c2, c2, c2);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The six
// ---------------------------------------------------------------------------------------------
const SPEC = [
  {
    // shielding the face: thrown back on the rear foot, the head turned away under one forearm,
    // the other hand pushed out at what is coming
    crust: [0.3, 0.36],
    r: 0.34,
    who: [
      {
        S: 1.74,
        pose: {
          pel: [0, 0.9, -0.03],
          sLo: [0, 1, -0.12],
          sUp: [0.02, 1, -0.2],
          twist: 0.4,
          shrug: [0, 0.03],
          neck: [0.06, 1, -0.03],
          face: [0.55, -0.3, 0.78],
          hands: { L: { at: [0.28, 1.17, 0.3], hint: [0.5, -1, -0.2], dir: [0, 0.8, 0.55] }, R: { at: [0.03, 1.63, 0.19], hint: [-0.7, 0.1, 0.7], dir: [0.8, 0.45, 0.25] } },
          feet: { L: { at: [0.13, 0.07, 0.14], hint: [0, 0, 1], dir: [0.25, 0, 1] }, R: { at: [-0.12, 0.07, -0.26], hint: [-0.3, 0, 1], dir: [-0.4, 0, 1] } },
          dress: 'legs',
          tunic: true,
          sleeves: 0.1,
        },
      },
    ],
  },
  {
    // kneeling: sat back on the heels and folded over, the face in both hands
    crust: [0.33, 0.4],
    r: 0.36,
    split: -1,
    who: [
      {
        S: 1.64,
        pose: {
          pel: [0, 0.37, -0.15],
          sLo: [0, 0.9, 0.44],
          sUp: [0, 0.62, 0.78],
          neck: [0.06, 0.25, 0.97],
          face: [0, -0.85, 0.5],
          hands: { L: { at: [0.055, 0.7, 0.33], hint: [0.7, -1, -0.1], dir: [-0.3, 0.55, 0.78] }, R: { at: [-0.06, 0.685, 0.335], hint: [-0.7, -1, -0.1], dir: [0.3, 0.55, 0.78] } },
          feet: { L: { at: [0.1, 0.07, -0.25], hint: [0.1, -0.3, 1], dir: [0.05, -0.15, -1] }, R: { at: [-0.11, 0.07, -0.23], hint: [-0.1, -0.3, 1], dir: [-0.05, -0.15, -1] } },
          dress: 'legs',
          tunic: true,
          hood: true,
          cloak: [0.1, 0.15],
        },
      },
    ],
  },
  {
    // reaching up: on the toes, one arm at full stretch and the other half raised, the head thrown back
    crust: [0.29, 0.3],
    r: 0.32,
    xz: 0.045,
    who: [
      {
        S: 1.76,
        pose: {
          pel: [0, 0.97, 0],
          sLo: [0, 1, 0.07],
          sUp: [0, 1, -0.07],
          twist: -0.15,
          shrug: [0, 0.05],
          neck: [0, 1, -0.28],
          face: [-0.12, 0.72, 0.68],
          hands: { L: { at: [0.34, 1.52, 0.2], hint: [0.8, -0.6, 0.1], dir: [0.1, 0.9, 0.4] }, R: { at: [-0.14, 2.06, 0.16], hint: [-1, 0, -0.3], dir: [0.05, 1, 0.12] } },
          feet: { L: { at: [0.1, 0.11, 0.17], hint: [0.1, 0, 1], dir: [0.2, -0.5, 1] }, R: { at: [-0.09, 0.1, -0.08], hint: [0, 0, 1], dir: [-0.15, -0.45, 1] } },
          dress: 'robe',
          sleeves: 0.2,
        },
      },
    ],
  },
  {
    // two holding each other: the smaller one's face in the taller one's shoulder
    crust: [0.36, 0.4],
    r: 0.42,
    xz: 0.055,
    who: [
      {
        S: 1.8,
        at: [0, 0, -0.15],
        pose: {
          pel: [0, 0.95, 0],
          sLo: [0, 1, 0.06],
          sUp: [0, 1, 0.16],
          neck: [0.1, 0.9, 0.42],
          face: [0.3, -0.5, 0.8],
          hands: { L: { at: [0.1, 1.42, 0.31], hint: [1, -0.3, 0.3], dir: [-0.9, 0.2, -0.1] }, R: { at: [-0.05, 1.15, 0.4], hint: [-1, -0.3, 0.2], dir: [0.9, 0.1, 0] } },
          feet: { L: { at: [0.12, 0.07, 0.02], hint: [0.1, 0, 1], dir: [0.3, 0, 1] }, R: { at: [-0.12, 0.07, -0.04], hint: [-0.1, 0, 1], dir: [-0.3, 0, 1] } },
          dress: 'legs',
          cloak: true,
        },
      },
      {
        S: 1.6,
        yaw: Math.PI,
        at: [0.02, 0, 0.14],
        pose: {
          pel: [0, 0.95, 0],
          sLo: [0, 1, 0.1],
          sUp: [0, 1, 0.24],
          neck: [-0.12, 0.9, 0.45],
          face: [-0.6, -0.15, 0.78],
          hands: { L: { at: [0.17, 1.1, 0.45], hint: [1, -0.3, -0.2], dir: [-0.9, 0, 0.3] }, R: { at: [-0.16, 1.16, 0.45], hint: [-1, -0.3, -0.2], dir: [0.9, 0.1, 0.3] } },
          feet: { L: { at: [0.09, 0.07, 0], hint: [0, 0, 1], dir: [0.2, 0, 1] }, R: { at: [-0.09, 0.07, 0.03], hint: [0, 0, 1], dir: [-0.2, 0, 1] } },
          dress: 'skirt',
          hood: true,
        },
      },
    ],
  },
  {
    // fallen: down on the chest and still crawling, one arm stretched out ahead, the head lifted
    crust: [0.5, 1.02],
    r: 0.5,
    split: -1,
    xz: 0.049,
    low: true,
    who: [
      {
        S: 1.68,
        pose: {
          pel: [0, 0.13, -0.25],
          sLo: [0.04, 0.2, 1],
          sUp: [0.02, 0.38, 1],
          twist: 0.2,
          neck: [0, 0.62, 0.78],
          face: [0.12, -0.3, 0.95],
          hands: { L: { at: [0.16, 0.05, 0.4], hint: [1, -0.4, -0.3], dir: [-0.5, -0.05, 0.85] }, R: { at: [-0.2, 0.05, 0.74], hint: [-1, 0.6, 0], dir: [0.1, -0.05, 1] } },
          feet: { L: { at: [0.1, 0.06, -1.08], hint: [0.3, -1, 0], dir: [0.15, -0.2, -1] }, R: { at: [-0.2, 0.06, -0.9], hint: [-1, 0.2, 0.4], dir: [-0.35, -0.2, -0.9] } },
          dress: 'skirt',
          hood: true,
          cloak: [0.55, 0.17],
        },
      },
    ],
  },
  {
    // turning to look back: caught in mid stride, the head over the shoulder, a hand left behind
    crust: [0.31, 0.42],
    r: 0.36,
    who: [
      {
        S: 1.66,
        pose: {
          pel: [0, 0.9, 0],
          sLo: [0, 1, 0.05],
          sUp: [0.02, 1, 0],
          twist: 0.6,
          neck: [0.04, 1, -0.05],
          face: [0.9, -0.08, -0.42],
          hands: { L: { at: [0.4, 1.02, -0.4], hint: [0.6, 0.5, -0.3], dir: [0.4, -0.3, -0.85] }, R: { at: [0.02, 1.27, 0.17], hint: [-0.8, -0.6, 0.1], dir: [0.6, 0.6, -0.2] } },
          feet: { L: { at: [0.09, 0.1, -0.28], hint: [0.1, 0, 1], dir: [0.2, -0.45, 1] }, R: { at: [-0.08, 0.07, 0.26], hint: [0, 0, 1], dir: [-0.1, 0, 1] } },
          dress: 'skirt',
          hood: true,
        },
      },
    ],
  },
];

register(
  'statue_salt',
  (seed, opts) => {
    const variant = (((seed - 1) % 6) + 6) % 6;
    const spec = SPEC[variant];
    const R = new Rng(seed * 617 + 11);
    const nz = new Noise(seed * 43 + 9);
    const b = new Builder();
    const F = new Field();
    const flip = Math.floor((seed - 1) / 6) % 2 ? -1 : 1; // the second time round the six, they are mirrored
    const size = R.range(0.955, 1); // and nobody is quite the same height: 1.5 to 1.8 m
    const who = spec.who.map((w) => figure(F, w.pose, { S: w.S * size, yaw: w.yaw || 0, at: (w.at || [0, 0, 0]).map((v) => v * size) }));
    const cx = (F.min[0] + F.max[0]) / 2,
      cz = (F.min[2] + F.max[2]) / 2,
      top = F.max[1];
    // what has run off them and set on the ground: mounds that go down into it, so a slope does not show daylight under them
    const mound = (p, rx, rz, h = 0.07) => {
      F.ell(V3(p.x, -0.012, p.z), [rx, h, rz], null, 0.1, null, true);
      for (let i = 0; i < 2; i++) {
        const an = R.range(0, TAU),
          r = R.range(0.07, 0.11);
        F.ell(V3(p.x + Math.cos(an) * rx * 0.9, -0.01, p.z + Math.sin(an) * rz * 0.9), [r * 1.5, r * 0.55, r * 1.3], null, 0.08, null, true);
      }
    };
    if (spec.low) {
      mound(who[0].chest, 0.27, 0.3, 0.06);
      mound(who[0].pel, 0.3, 0.3, 0.06);
      mound(who[0].knees, 0.24, 0.3, 0.05);
    } else {
      const c = who[0].feet.clone();
      if (who[1]) c.lerp(who[1].feet, 0.5);
      mound(c, spec.crust[0], spec.crust[1]);
    }
    const T = new Tris({ mat: MAT.STONE, rough: 0.6 });
    T.gs = [4.5, 1.6, 4.5]; // the grain of the stone shader, finer and drawn out a little, the way rain runs
    const xz = Number((opts && opts.cell) || spec.xz || 0.043); // the grid: `cell` and `facet` are for looking at the mesh in the viewer
    const split = spec.split !== undefined ? spec.split : 0.85; // below this height the grid is coarser
    const skin = saltSkin(T, F, { xz, yStep: (y) => (y < split ? xz * 1.3 : xz * 0.9), rng: R, nz, cx, cz, flip, facet: opts && opts.facet !== undefined ? Number(opts.facet) : 0.5 });
    growths(b, T, skin, R, nz, { base: 3, drips: spec.low ? 3 : 7 });
    b.add(T.build());
    b.cylCollider(0, top / 2, 0, spec.r, top);
    return b.build();
  },
  { kind: 'prop', variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// The scarecrow: two poles, a coat, a sack for a head. Nothing has been afraid of it for years.
// ---------------------------------------------------------------------------------------------
register(
  'scarecrow',
  (seed) => {
    const R = new Rng(seed * 449 + 5);
    const nz = new Noise(seed * 13 + 3);
    const b = new Builder();
    const side = R.sign(); // the arm that droops
    const lean = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(R.range(0.03, 0.08), R.range(-0.3, 0.3), -side * R.range(0.05, 0.1)));
    const put = (g) => {
      g.applyMatrix4(lean);
      return g;
    };
    const cloth = (g, c, sway) => paint(g, { color: c, rough: 0.96, mat: MAT.CLOTH, sway });
    // cloth left out for years: bleached where the sun reaches it, dark where the wet stays
    const stain = (base, k = 0.3) => {
      const c0 = col(base);
      return (v) =>
        c0
          .clone()
          .multiplyScalar((1 - k * clamp01(nz.fbm3(v.x * 6, v.y * 6, v.z * 6, 2) * 0.9 + 0.35)) * (0.8 + 0.4 * sstep(0.7, 1.7, v.y)) * (0.9 + 0.2 * Math.max(0, v.ny)));
    };
    const coatC = col(PAL.cloth).multiplyScalar(1.25),
      sackC = mixc(PAL.thatch, PAL.cloth, 0.5),
      hatC = mixc(PAL.clothBlack, PAL.cloth, 0.55);
    const straw = (a, e, r = 0.007) => {
      const len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
      const g = new THREE.ConeGeometry(r, len, 3, 1, true);
      g.translate(0, len / 2, 0);
      b.add(put(paint(aim(g, a, e), { color: mixc(PAL.thatch, PAL.woodGrey, R.range(0, 0.45)).multiplyScalar(R.range(0.9, 1.25)), rough: 0.9, mat: MAT.PLANT, sway: 0.3 })));
    };
    // a strip of cloth hanging from (x, y, z), frayed to a point
    const rag = (x, y, z, len, w, yaw, root = 0) => {
      const g = new THREE.PlaneGeometry(w, len, 2, 4);
      g.translate(0, -len / 2, 0);
      deform(g, (p) => {
        const t = clamp01(-p.y / len);
        p.x *= 1 - 0.85 * Math.pow(t, 1.5);
        p.x += Math.sin(t * 5 + x * 7) * 0.014 * t;
        p.z += Math.sin(t * 3 + yaw) * 0.03 * t;
      });
      xf(g, { r: [0, yaw, 0], t: [x, y, z] });
      b.add(put(cloth(g, stain(coatC, 0.45), (v) => root + 1.4 * clamp01((y - v.y) / len))));
    };

    // the poles and their lashing
    const up = pole(2.27, 0.038, { rng: R, radial: 6, taper: 0.8, crook: 0.025, color: PAL.woodGrey, rot: 0.2 }); // it ends inside the sack
    up.translate(0, -0.45, 0);
    b.add(put(up));
    const BL = [-0.78, 1.57 + 0.07 * side, 0.036],
      BR = [0.74, 1.57 - 0.07 * side, 0.036];
    b.add(put(aim(pole(1.53, 0.027, { rng: R, radial: 6, taper: 0.85, crook: 0.03, color: PAL.woodGrey }), BL, BR)));
    const barY = (x) => BL[1] + ((x - BL[0]) / (BR[0] - BL[0])) * (BR[1] - BL[1]);
    for (const s of [-1, 1]) {
      const loop = [];
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * TAU;
        loop.push([Math.cos(an) * 0.05 * s, barY(0) + Math.sin(an) * 0.052, 0.018 + Math.cos(an) * 0.03]);
      }
      b.add(put(paint(tube(loop, 0.008, 3, { closed: true, samples: 10 }), { color: ROPE, rough: 0.95, mat: MAT.CLOTH })));
    }

    // the coat: hung on the bar, tied in at the waist with rope, the skirt of it in ribbons and torn up one side
    const top = barY(0) + 0.06,
      belt = 1.14,
      hem = 0.74,
      SEG = 14;
    const coat = lathe(
      [
        [0.235, hem],
        [0.215, 0.93],
        [0.165, belt],
        [0.2, 1.36],
        [0.17, top - 0.07],
        [0.06, top + 0.01],
      ],
      SEG
    );
    const cut = [];
    for (let i = 0; i < SEG; i++) cut.push(R.chance(0.45) ? R.range(0.12, 0.36) : R.range(0, 0.07));
    const tear = R.int(0, SEG - 1);
    deform(coat, (p) => {
      const an = Math.atan2(-p.z, p.x),
        t = (((an / TAU) % 1) + 1) % 1,
        i = Math.round(t * SEG) % SEG;
      const below = clamp01((belt - p.y) / 0.4);
      const fold = 1 + 0.13 * Math.sin(an * 5 + seed) * below + 0.05 * Math.sin(an * 3 + 1) * clamp01((p.y - belt) / 0.3);
      p.x *= fold;
      p.z *= fold * 0.5;
      p.z += 0.03 + 0.03 * below * Math.sin(p.x * 9 + seed); // it does not hang flat
      const d = Math.min(Math.abs(i - tear), SEG - Math.abs(i - tear));
      if (p.y < hem + 0.01) p.y -= cut[i]; // the hem hangs in tatters
      if (d === 0) p.y = Math.max(p.y, belt - 0.06);
      else if (d === 1) p.y = Math.max(p.y, hem + 0.12);
    });
    b.add(put(cloth(coat, stain(coatC), (v) => 1.5 * Math.pow(clamp01((top - 0.12 - v.y) / 0.9), 1.6))));
    const girdle = new THREE.TorusGeometry(0.17, 0.012, 4, 12);
    girdle.rotateX(Math.PI / 2);
    girdle.scale(1, 1, 0.52);
    girdle.translate(0, belt, 0.03);
    b.add(put(paint(girdle, { color: ROPE, rough: 0.95, mat: MAT.CLOTH, sway: 0.25 })));
    b.add(put(rope([[0.05, belt, 0.125], [0.07, belt - 0.12, 0.14], [0.06, belt - 0.3, 0.13]], 0.008, { sway: 0.9 })));
    for (let i = 0; i < 4; i++) {
      const an = R.range(0, TAU);
      rag(Math.cos(an) * 0.2, hem + 0.02, -Math.sin(an) * 0.1 + 0.03, R.range(0.2, 0.42), R.range(0.05, 0.08), an + Math.PI / 2, 0.9);
    }

    // one sleeve still whole, hanging empty off the end of the bar
    {
      const x1 = side * 0.6,
        y1 = barY(x1);
      const pts = [
        [side * 0.12, barY(side * 0.12) - 0.015, 0.036],
        [side * 0.38, barY(side * 0.38) - 0.03, 0.036],
        [x1, y1 - 0.035, 0.036],
        [x1 + side * 0.075, y1 - 0.2, 0.05],
        [x1 + side * 0.05, y1 - 0.45, 0.04],
      ];
      const sl = tube(pts, (t) => 0.074 - 0.022 * t, 6, { samples: 9, caps: false });
      deform(sl, (p) => {
        const drop = clamp01((y1 - 0.1 - p.y) / 0.2);
        p.z = 0.04 + (p.z - 0.04) * (1 - 0.55 * drop); // empty, so it hangs flat
        if (p.y < y1 - 0.42) p.y -= nz.n2(p.x * 40, p.z * 40) * 0.06 + 0.03;
      });
      b.add(put(cloth(sl, stain(coatC), (v) => 1.4 * clamp01((y1 - 0.1 - v.y) / 0.38))));
      for (let i = 0; i < 5; i++) straw([x1 + side * 0.05, y1 - 0.42, 0.04], [x1 + side * 0.05 + R.range(-0.07, 0.07), y1 - 0.5 - R.range(0.05, 0.16), 0.04 + R.range(-0.06, 0.06)]);
    }
    // the other torn away: a stump of it at the shoulder, rags along the bare bar
    {
      const s = -side,
        x1 = s * 0.34;
      const sl = tube(
        [
          [s * 0.1, barY(s * 0.1) - 0.015, 0.036],
          [s * 0.22, barY(s * 0.22) - 0.025, 0.036],
          [x1, barY(x1) - 0.03, 0.036],
        ],
        (t) => 0.074 - 0.01 * t,
        6,
        { samples: 4, caps: false }
      );
      deform(sl, (p) => {
        if (Math.abs(p.x) > Math.abs(x1) - 0.02) p.x += s * (nz.n2(p.y * 40, p.z * 40) * 0.07 + 0.02);
      });
      b.add(put(cloth(sl, stain(coatC), (v) => 0.4 * clamp01((barY(v.x) - v.y) / 0.1))));
      for (let i = 0; i < 6; i++) straw([x1, barY(x1) - 0.03, 0.036], [x1 + s * R.range(0.08, 0.2), barY(x1) - 0.03 + R.range(-0.13, 0.05), 0.036 + R.range(-0.08, 0.08)]);
      rag(s * 0.47, barY(s * 0.47) - 0.02, 0.036, R.range(0.3, 0.42), 0.07, R.range(-0.4, 0.4), 0.2);
      rag(s * 0.63, barY(s * 0.63) - 0.02, 0.036, R.range(0.16, 0.26), 0.055, R.range(-0.6, 0.6), 0.2);
    }

    // the head: a sack stuffed with straw and tied at the neck, hanging forward and to one side
    let head = new THREE.IcosahedronGeometry(1, 2);
    head = deform(head, (p) => {
      p.normalize();
      const lum = 1 + nz.fbm3(p.x * 2.2, p.y * 2.2, p.z * 2.2, 2) * 0.16;
      const neck = p.y < -0.45 ? 1 - (-(p.y + 0.45) / 0.55) * 0.55 : 1; // gathered in at the tie
      const ear = p.y > 0.55 ? Math.pow(Math.abs(p.x), 2.5) * 0.5 : 0; // the corners of the sack
      p.set(p.x * 0.125 * lum * neck * (1 + ear), p.y * 0.165 * lum + ear * 0.05, p.z * 0.12 * lum * neck);
    });
    const HY = barY(0) + 0.29;
    const headM = new THREE.Matrix4().makeTranslation(side * 0.025, HY, 0.06).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.45, R.range(-0.25, 0.25), -side * R.range(0.18, 0.34))));
    head.applyMatrix4(headM);
    b.add(put(cloth(head, stain(sackC, 0.4), 0)));
    const tie = new THREE.TorusGeometry(0.066, 0.011, 4, 9);
    tie.rotateX(Math.PI / 2);
    tie.translate(0, -0.105, 0);
    tie.applyMatrix4(headM);
    b.add(put(paint(tie, { color: ROPE, rough: 0.95, mat: MAT.CLOTH })));
    b.add(put(rope([[0.05, HY - 0.11, 0.1], [0.075, HY - 0.2, 0.13], [0.065, HY - 0.36, 0.13]], 0.008, { sway: 0.6 })));
    for (let i = 0; i < 8; i++) {
      const an = R.range(0, TAU);
      straw([Math.cos(an) * 0.05, HY - 0.15, 0.06 + Math.sin(an) * 0.05], [Math.cos(an) * 0.15, HY - 0.16 - R.range(0.03, 0.15), 0.06 + Math.sin(an) * 0.15]);
    }
    // a hat that has kept the rain off nothing, the brim broken down on one side
    const hat = lathe(
      [
        [0.27, 0],
        [0.115, 0.025],
        [0.105, 0.12],
        [0.07, 0.17],
        [0, 0.18],
      ],
      10
    );
    deform(hat, (p) => {
      const r = Math.hypot(p.x, p.z);
      if (r > 0.12) {
        const k = (r - 0.12) / 0.15;
        p.y += nz.n2(p.x * 7, p.z * 7) * 0.07 * k - 0.04 * k * k - 0.1 * k * Math.pow(clamp01((side * p.x) / 0.27), 2);
      } else p.y += nz.n2(p.x * 9 + 3, p.z * 9) * 0.025;
    });
    hat.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.12, -0.012).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.2, 0, R.range(-0.1, 0.1)))));
    hat.applyMatrix4(headM);
    b.add(put(cloth(hat, stain(hatC, 0.3), 0)));

    // stones kicked up against the foot of the pole
    const T = new Tris({ mat: MAT.STONE, rough: 0.94 });
    const shade = weathering({ seed: seed + 5, moss: 0.3, mossTop: 0.2, lichen: 0.5, grime: 0.6 });
    for (let i = 0; i < 3; i++) {
      const an = R.range(0, TAU),
        w = R.range(0.16, 0.26),
        h = w * R.range(0.5, 0.7);
      placed(T, [Math.cos(an) * 0.13, h * 0.3, Math.sin(an) * 0.13], [R.range(-0.3, 0.3), R.range(0, TAU), R.range(-0.3, 0.3)], () => looseStone(T, w, h, w * R.range(0.6, 0.9), { rng: R, color: stoneTone(R), shadeAt: shade }));
    }
    b.add(T.build());
    return b.build();
  },
  { kind: 'prop' }
);
