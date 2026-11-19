// Hair: a cover and locks. The COVER is a thin shell over the scalp wherever hair grows, fringed at
// the hairline, so there is always a dark mass of hair under the locks and never a hole at the
// crown. The LOCKS are narrow cards rooted under the cover and laid the way rain leaves hair: out
// from a whorl behind the crown and down the head, ring over ring like shingles, each ring's tips
// lying over the roots of the ring below and a little higher off the scalp than it, so no lock
// crosses another. What a card shows is drawn by the material as a function of its (u, v): a lock
// that narrows to a point, made of strands that end at different lengths (mats/charBody.js,
// sChLock). All of it is shaded on normals that point out from the middle of the head, so the mass
// is lit as one round thing, not as plates.
// Under a hat only the "low" shells are worn: everything in them is rooted below the hat line and
// runs down, so nothing can come through a cap, a beanie or a campaign hat.
// Shells (variants.js picks): hairCap, hairTop (no hat), hairCapLow, hairSides (under hats, and all
// a balding head has), hairLong / hairLongLow (to the shoulders), hairBun (tied up).
// Both levels of detail build the same shells with the same lengths; the far one has fewer, wider cards.
import { DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, NoColorSpace } from 'three';
import { createRng } from '../core/rng.js';
import { gradient, march } from './sculpt/sdf.js';
import { HEAD_C } from './sculpt/head.js';
import { SID } from './sculpt/cage.js';
import { BODY } from './sculpt/uv.js';
import { B } from './skeleton.js';

const MU = (BODY.misc[0] + BODY.misc[2]) / 2, MV = (BODY.misc[1] + BODY.misc[3]) / 2;
const LOCKS = 8;            // locks side by side in the texture
export const HAT_LINE = 1.68;      // nothing of a "low" shell is rooted above this height (rest pose)
const NC = [HEAD_C[0], HEAD_C[1] - 0.02, HEAD_C[2] - 0.01];      // normals radiate from here

// The lock texture is no longer read: locks are drawn as a function in the material. The sampler
// stays bound (the material's contract), to a texture of a few bytes whatever `down` asks for.
export function createHairTexture() {
  const px = new Uint8Array(4 * 4 * 4).fill(255);
  const t = new DataTexture(px, 4, 4, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.magFilter = LinearFilter; t.minFilter = LinearFilter;
  t.generateMipmaps = false; t.colorSpace = NoColorSpace; t.needsUpdate = true;
  return t;
}

const g = [0, 0, 0];
const W_HEAD = [[B.head, 1]];
const nOut = (p, tilt) => { const x = p[0] - NC[0] + (tilt ? tilt[0] : 0), y = p[1] - NC[1] + (tilt ? tilt[1] : 0), z = p[2] - NC[2] + (tilt ? tilt[2] : 0), l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

// a point on the scalp in the direction (azimuth from +z toward +x, latitude) from the head's centre
function rootAt(fig, az, lat) {
  const cl = Math.cos(lat), d = [cl * Math.sin(az), Math.sin(lat), cl * Math.cos(az)];
  const h = march(fig, HEAD_C[0], HEAD_C[1], HEAD_C[2], d[0], d[1], d[2], 0.16);
  return h < 0 ? null : [HEAD_C[0] + d[0] * h, HEAD_C[1] + d[1] * h, HEAD_C[2] + d[2] * h];
}
// the hairline as a latitude limit: high over the forehead, down past the ears to the nape
export const hairLat = (az) => { const a = Math.abs(az); return a < 0.9 ? 0.52 + 0.1 * (a / 0.9) ** 2 : a < 1.5 ? 0.62 - 0.52 * ((a - 0.9) / 0.6) : a < 2.0 ? 0.1 - 0.5 * ((a - 1.5) / 0.5) : -0.4; };
// the latitude at which the scalp crosses a height, for one azimuth (bisection)
function latAtHeight(fig, az, y) {
  let lo = -0.6, hi = 1.5;
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2, p = rootAt(fig, az, m); if (!p || p[1] > y) hi = m; else lo = m; }
  return lo;
}

// The cover. top(az) -> latitude of its upper edge (PI/2 = the crown, closed).
function cover(mesh, fig, nAz, nLat, top, thick) {
  const ids = [], shut = [];
  for (let j = 0; j <= nAz; j++) {
    const az = -Math.PI + (j / nAz) * 2 * Math.PI, lt = top(az), lb = hairLat(az);
    shut.push(lt - lb < 0.06);
    for (let i = 0; i <= nLat + 1; i++) {
      // the last row is the fringe: it hangs past the hairline and the lock tips cut its edge
      const fringe = i > nLat, t = Math.min(1, i / nLat);
      const lat = lt + (lb - lt) * t - (fringe ? 0.16 : 0);
      const open = lt - lb < 0.06;                     // no hair here (the forehead under a hat): folded shut
      const p = rootAt(fig, az, open ? lt : lat) || [HEAD_C[0], HEAD_C[1] + 0.09, HEAD_C[2]];
      gradient(fig, p[0], p[1], p[2], g);
      const off = open ? -0.004 : fringe ? 0.003 : thick * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.2)));
      const q = [p[0] + g[0] * off, p[1] + g[1] * off, p[2] + g[2] * off], n = nOut(q);
      ids.push(mesh.vert(q[0], q[1], q[2], n[0], n[1], n[2], MU, MV, W_HEAD, [(j / nAz) * 2, fringe ? 0.97 : 0.04 + 0.36 * t, 2.82 + 0.1 * Math.sin(j * 2.3 + i), SID.hair]));      // shade + 2: the cover (its sides are not cut ragged)
    }
  }
  const s = nLat + 2;
  // (nothing is drawn to or from a column with no hair: a quad from a folded column to a full one
  // stood out of the temple as a blade)
  for (let j = 0; j < nAz; j++) for (let i = 0; i <= nLat; i++) if (!shut[j] && !shut[j + 1]) mesh.quad(ids[j * s + i], ids[(j + 1) * s + i], ids[(j + 1) * s + i + 1], ids[j * s + i + 1], true);
}

// One clump. root: on the scalp; flow: the way it runs; len, width (metres). o: { lift, rise, gravity,
// curl (sideways wander, metres), tuck (0..1: the tip comes back to the head), v0, vMax, shade }
function clump(mesh, fig, rng, root, flow, len, width, segs, o = {}) {
  const lift = o.lift ?? 0.003, rise = o.rise ?? 0.008, grav = o.gravity ?? 0.5, tuck = o.tuck ?? 0.6;
  let p = root.slice(), d = flow.slice();
  const pts = [];
  const step = len / segs;
  const curl = (o.curl ?? 0.006) * rng.range(-1, 1), cph = rng.range(0, 6.28);
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const want = lift + rise * Math.sin(Math.PI * Math.min(1, t * (1 + 0.4 * tuck))) + (1 - tuck) * rise * t;
    // out of the head to its height over the scalp; a clump that lies on the head is also drawn
    // back down to it (the field is not an exact distance deep inside the skull, so this is
    // repeated: one long step can overshoot and leave the clump standing in the air)
    let dist = 0;
    for (let it = 0; it < 4; it++) {
      dist = gradient(fig, p[0], p[1], p[2], g);
      let mv = 0;
      if (dist < want) mv = (want - dist) * 0.9; else if (tuck > 0.5 && dist < 0.06) mv = -(dist - want) * 0.9;
      if (Math.abs(mv) < 0.0005) break;
      p[0] += g[0] * mv; p[1] += g[1] * mv; p[2] += g[2] * mv;
    }
    if (o.aim) { const ax = o.aim[0] - p[0], ay = o.aim[1] - p[1], az = o.aim[2] - p[2], al = Math.hypot(ax, ay, az) || 1; d = [ax / al, ay / al, az / al]; }
    const near = dist < 0.035;
    pts.push([p[0], p[1], p[2], near ? g[0] : 0, near ? g[1] : 0, near ? g[2] : 0]);
    // onward: along the flow, pulled down, wandering sideways; kept along the head while on it
    const side = [d[1] * g[2] - d[2] * g[1], d[2] * g[0] - d[0] * g[2], d[0] * g[1] - d[1] * g[0]];
    const cw = Math.cos(cph + t * 5) * curl / step;
    let fx = d[0] + side[0] * cw, fy = d[1] - grav * (0.35 + t) + side[1] * cw, fz = d[2] + side[2] * cw;
    if (near && dist < want + 0.006) { const dn = fx * g[0] + fy * g[1] + fz * g[2]; if (dn < 0 || tuck > 0.3) { fx -= g[0] * dn; fy -= g[1] * dn; fz -= g[2] * dn; } }
    const l = Math.hypot(fx, fy, fz) || 1;
    d = [fx / l, fy / l, fz / l];
    p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step];
  }
  const lock = rng.int(0, LOCKS - 1), u0 = lock / LOCKS, u1 = (lock + 1) / LOCKS;
  const v0 = o.v0 ?? 0.2, vMax = o.vMax ?? 1, shade = o.shade ?? rng.range(0.84, 1.06);
  const across = o.flat ? [-1, 1] : [-1, 0, 1], nx = across.length, taper = o.taper ?? 0;
  const tilt = [rng.range(-0.008, 0.008), rng.range(-0.008, 0.008), rng.range(-0.008, 0.008)];
  const ids = [];
  for (let k = 0; k <= segs; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(segs, k + 1)], c = pts[k];
    const n = c[3] || c[4] || c[5] ? [c[3], c[4], c[5]] : nOut(c);
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let s = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const sl = Math.hypot(...s) || 1, hw = (width / 2) * (1 - taper * (k / segs));
    s = s.map((x) => (x / sl) * hw);
    const v = v0 + (vMax - v0) * (k / segs);
    const no = nOut(c, tilt);
    // bowed across, so a clump has a ridge and never lies edge-on as a line
    for (const e of across) {
      const bow = e === 0 ? hw * 0.44 : 0;
      ids.push(mesh.vert(c[0] + s[0] * e + n[0] * bow, c[1] + s[1] * e + n[1] * bow, c[2] + s[2] * e + n[2] * bow,
        no[0] + (s[0] / hw) * e * 0.12, no[1] + (s[1] / hw) * e * 0.12, no[2] + (s[2] / hw) * e * 0.12, MU, MV, W_HEAD, [u0 + (u1 - u0) * (e + 1) / 2, v, shade, SID.hair]));
    }
  }
  for (let k = 0; k < segs; k++) for (let e = 0; e + 1 < nx; e++) mesh.quad(ids[k * nx + e], ids[k * nx + e + 1], ids[(k + 1) * nx + e + 1], ids[(k + 1) * nx + e], false);
}

export function buildHair(mesh, fig, q) {
  const near = q >= 1;
  const rng = createRng(4711);
  const N = (a, b) => (near ? a : b), wide = near ? 1 : 1.7, sg = (n) => (near ? n : 2);
  const lowTop = (az) => Math.min(Math.PI / 2, Math.max(hairLat(az), latAtHeight(fig, az, HAT_LINE)));

  mesh.shell = 'hairCap';
  cover(mesh, fig, N(18, 9), N(7, 4), () => Math.PI / 2, 0.009);
  mesh.shell = 'hairCapLow';
  cover(mesh, fig, N(18, 9), N(4, 2), (az) => Math.min(Math.PI / 2, latAtHeight(fig, az, HAT_LINE)), 0.004);

  // ---- on top: rings of locks out from the whorl, each ring lapping the ring below it and lying a
  // little higher off the scalp, every lock running the same way round (away from the whorl, turned
  // a little with its wind): wet hair combed by the rain, nothing crossing
  mesh.shell = 'hairTop';
  const whorl = rootAt(fig, 2.7, 1.28) || [HEAD_C[0], HEAD_C[1] + 0.1, HEAD_C[2] - 0.02];
  const RINGS = near ? [[1.3, 6], [1.06, 10], [0.84, 14], [0.64, 16]] : [[1.3, 3], [1.06, 4], [0.84, 5], [0.64, 5]];
  RINGS.forEach(([lat, n], ri) => {
    for (let k = 0; k < n; k++) {
      const az = -Math.PI + ((k + 0.5 + rng.range(-0.22, 0.22)) / n) * 2 * Math.PI + ri * 0.37;
      const azw = Math.atan2(Math.sin(az), Math.cos(az));
      const la = lat + rng.range(-0.035, 0.035);
      if (la < hairLat(azw) + 0.07) continue;
      const root = rootAt(fig, azw, la);
      if (!root) continue;
      gradient(fig, root[0], root[1], root[2], g);
      let f = [root[0] - whorl[0], root[1] - whorl[1] - 0.012, root[2] - whorl[2]];
      const fl = Math.hypot(...f);
      f = fl > 0.012 ? f.map((x) => x / fl) : [Math.sin(azw), 0, Math.cos(azw)];
      const sw = 0.32 + rng.range(-0.07, 0.07);       // the wind of the whorl
      const flow = [f[0] + (g[1] * f[2] - g[2] * f[1]) * sw, f[1] + (g[2] * f[0] - g[0] * f[2]) * sw, f[2] + (g[0] * f[1] - g[1] * f[0]) * sw];
      const front = Math.cos(azw) > 0.45 && ri === 3;
      const fwd = Math.max(0, Math.cos(azw)) ** 2, room = Math.max(0.03, (la - hairLat(azw) + 0.42) * 0.095);       // (how far it may run before it is on the face)
      clump(mesh, fig, rng, root, flow, Math.min(front ? rng.range(0.035, 0.06) : rng.range(0.085, 0.118), fwd > 0.2 ? room : 1), near ? rng.range(0.021, 0.029) : rng.range(0.03, 0.04) * wide, sg(5),
        { flat: near, lift: 0.0022 + 0.0012 * (3 - ri), rise: rng.range(0.0015, 0.0035), tuck: 1, gravity: 0.3, curl: 0.003, v0: 0.1, vMax: rng.range(0.9, 1) });
    }
  });
  // a few strays stuck to the forehead by the wet: thin, tapering, wandering a little
  for (const az of near ? [-0.5, -0.27, 0.06, 0.3, 0.52] : []) {
    const root = rootAt(fig, az + rng.range(-0.05, 0.05), hairLat(az) + 0.045);
    if (root) clump(mesh, fig, rng, root, [Math.sin(az) * 0.25 + rng.range(-0.3, 0.3), -1, Math.cos(az) * 0.4], rng.range(0.035, 0.062), rng.range(0.0075, 0.011), 4, { flat: true, lift: 0.0016, rise: 0.0008, tuck: 1, gravity: 0.9, curl: 0.006, taper: 0.5, v0: 0.5, vMax: 1 });
  }
  // ---- round the sides and back, under the hat line: two rows lying down the head and swept back,
  // the upper row over the lower
  mesh.shell = 'hairSides';
  for (const [dl, n, lift] of [[0.42, N(20, 5), 0.0034], [0.2, N(22, 6), 0.0022]]) for (let k = 0; k < n; k++) {
    const az = -Math.PI + ((k + 0.5 + rng.range(-0.2, 0.2)) / n) * 2 * Math.PI;
    if (Math.abs(az) < 0.8) continue;                       // not across the forehead
    const la = Math.min(hairLat(az) + dl + rng.range(-0.03, 0.03), lowTop(az) - 0.03);
    if (la < hairLat(az) + 0.05) continue;
    const root = rootAt(fig, az, la);
    if (!root) continue;
    clump(mesh, fig, rng, root, [Math.sin(az) * 0.16 + rng.range(-0.07, 0.07), -0.75, Math.cos(az) * 0.16 - 0.26], rng.range(0.055, 0.085), near ? rng.range(0.018, 0.025) : rng.range(0.024, 0.034) * wide, sg(4), { flat: near, lift, rise: rng.range(0.001, 0.003), tuck: 1, curl: 0.003, v0: 0.2, vMax: rng.range(0.85, 1) });
  }
  // ---- long and matted: locks to the shoulders, a few across the face. Two cuts: rooted high
  // (no hat) and rooted under the hat line.
  for (const low of [false, true]) {
    mesh.shell = low ? 'hairLongLow' : 'hairLong';
    const n = N(26, 10);
    for (let k = 0; k < n; k++) {
      const az = -Math.PI + ((k + rng.next() * 0.7) / n) * 2 * Math.PI;
      const face = Math.abs(az) < 0.75;
      if (face && (low || k % 3 !== 0)) continue;
      const la = low ? lowTop(az) - rng.range(0.04, 0.18) : Math.max(hairLat(az) + 0.12, rng.range(0.5, 1.05));
      if (la < hairLat(az) + 0.04) continue;
      const root = rootAt(fig, az, la);
      if (!root) continue;
      const len = face ? rng.range(0.09, 0.15) : rng.range(0.19, 0.3) - (low ? 0.03 : 0);
      // ropes of wet hair: narrow, tapering, and wandering as they hang
      clump(mesh, fig, rng, root, [Math.sin(az) * 0.45, -0.55, Math.cos(az) * 0.45], len, (near ? rng.range(0.017, 0.026) : rng.range(0.022, 0.032) * wide), sg(face ? 4 : 6), { gravity: 0.85, lift: 0.004, rise: 0.005, tuck: 0, curl: 0.011, taper: 0.4, v0: 0.14 });
    }
  }
  // ---- tied up: drawn back tight (the cover is the drawn-back hair) to a knot high on the back
  // of the head, a few flat locks leading into it, strays at the temples and nape. The knot is a
  // solid coil, not a spray of cards: at the far level it is all there is, so it stays a bun.
  mesh.shell = 'hairBun';
  const knot = rootAt(fig, Math.PI, 0.5);
  if (knot) {
    const nb = N(10, 0);
    for (let k = 0; k < nb; k++) {
      const az = -Math.PI + ((k + 0.5) / nb) * 2 * Math.PI, lat = Math.max(hairLat(az) + 0.12, 0.45 + 0.4 * (((k * 7) % 5) / 4));
      const root = rootAt(fig, az, lat);
      if (!root) continue;
      const to = [knot[0] - root[0], knot[1] - root[1] + 0.015, knot[2] - root[2]], l = Math.hypot(...to);
      if (l < 0.03) continue;
      clump(mesh, fig, rng, root, to.map((x) => x / l), Math.min(l * 1.15, 0.19), rng.range(0.03, 0.04), 4, { flat: true, gravity: 0, lift: 0.0035, rise: 0.006, tuck: 1, curl: 0.002, v0: 0.06, vMax: rng.range(0.9, 1), aim: knot });      // roots on the scalp, the middle over the cover
    }
    // the knot: one thick rope of hair wound on itself, the outer turn lying on the head and each
    // turn inside it standing a little further out, the end tucked in at the middle (u runs round
    // the rope, so its strands run along the winding)
    const A = nOut(knot), up = [0, 1, 0];
    let U = [up[1] * A[2] - up[2] * A[1], up[2] * A[0] - up[0] * A[2], up[0] * A[1] - up[1] * A[0]];
    const ul = Math.hypot(...U) || 1; U = U.map((x) => x / ul);
    const Vv = [A[1] * U[2] - A[2] * U[1], A[2] * U[0] - A[0] * U[2], A[0] * U[1] - A[1] * U[0]];
    const c = [knot[0] + A[0] * 0.004, knot[1] + A[1] * 0.004 + 0.008, knot[2] + A[2] * 0.004];
    const turns = 2.2, ns = N(24, 8), sides = N(5, 4), ids = [];
    for (let i = 0; i <= ns; i++) {
      const t = i / ns, ang = t * turns * 2 * Math.PI + 0.6, r = 0.035 * (1 - 0.8 * t), hgt = 0.01 + 0.024 * t, tr = (i === ns ? 0.3 : 1) * 0.0145 * (1 - 0.3 * t);
      const R = [U[0] * Math.cos(ang) + Vv[0] * Math.sin(ang), U[1] * Math.cos(ang) + Vv[1] * Math.sin(ang), U[2] * Math.cos(ang) + Vv[2] * Math.sin(ang)];
      const p = [c[0] + R[0] * r + A[0] * hgt, c[1] + R[1] * r + A[1] * hgt, c[2] + R[2] * r + A[2] * hgt];
      for (let j = 0; j <= sides; j++) {
        const a2 = (j / sides) * 2 * Math.PI, ca = Math.cos(a2), sa = Math.sin(a2);
        const n = [R[0] * ca + A[0] * sa, R[1] * ca + A[1] * sa, R[2] * ca + A[2] * sa];
        ids.push(mesh.vert(p[0] + n[0] * tr, p[1] + n[1] * tr, p[2] + n[2] * tr, n[0], n[1], n[2], MU, MV, W_HEAD, [(j / sides) * 0.75, 0.08 + 0.26 * t, 2.9, SID.hair]));
      }
    }
    for (let i = 0; i < ns; i++) for (let j = 0; j < sides; j++) mesh.quad(ids[i * (sides + 1) + j], ids[i * (sides + 1) + j + 1], ids[(i + 1) * (sides + 1) + j + 1], ids[(i + 1) * (sides + 1) + j], true);
    for (const az of near ? [-1.25, 1.2, -2.6, 2.75, -0.42] : []) {
      const root = rootAt(fig, az, hairLat(az) + 0.07);
      if (root) clump(mesh, fig, rng, root, [Math.sin(az) * 0.3, -0.8, Math.cos(az) * 0.3], rng.range(0.06, 0.11), 0.011, 4, { flat: true, gravity: 0.85, lift: 0.002, rise: 0.001, tuck: az > -1 && az < 0 ? 1 : 0.2, curl: 0.008, taper: 0.5, v0: 0.4 });
    }
  }
}
