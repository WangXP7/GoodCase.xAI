// One gloved hand, forearm and jacket sleeve as skinned meshes on a small skeleton.
//
// Hand space (millimetres): origin at the wrist joint, fingers point along -z, the back of the hand
// faces +y, and on the RIGHT hand the thumb is on -x. The left hand is the mirror image in x.
//
// The glove is not assembled from tubes: the hand is one implicit surface (metacarpals, thenar and
// hypothenar pads, thumb web, three tapering phalanges per finger, knuckles) polygonised once at
// load, so the palm, the web and the finger roots are one continuous skin. It is modelled in a
// relaxed, half-curled bind pose, so linear skinning has to travel no more than about 50 degrees
// either way to an open hand or to a grip. `carve` lets the caller press the skin against whatever
// the hand holds: the palm seats into the pistol's grip instead of passing through it.
//
// Skeleton (18 bones): forearm -> hand -> thumb x3, index x3, middle x3, cup -> ring x3, pinky x3.
// `cup` folds the little-finger side of the palm toward the thumb (the metacarpal arch).
import {
  Bone, Skeleton, SkinnedMesh, Group, Vector3, Quaternion, Matrix4, BufferGeometry, BufferAttribute,
} from 'three';
import { box, lathe, weightedNormals } from './geo.js';

const MM = 0.001;
export const FOREARM = 0, HAND = 1, CUP = 17, BONE_COUNT = 18;
const CUP_AT = [4, -3, -34];
export const DIGITS = [
  // dir / curl only matter for the thumb: where it points in the bind pose and which way it flexes.
  // r: radius at each joint (mm, gloved); tip: radius of the fingertip.
  { name: 'thumb', bone: 2, base: [-21, -9, -20], L: [46, 34, 29], r: [12.4, 10.6, 9.6], tip: 8.4, dir: [-0.52, -0.24, -0.82], curl: [0.72, -0.62, -0.3] },
  { name: 'index', bone: 5, base: [-28.5, 1.5, -98], L: [45, 27, 23], r: [9.4, 8.6, 7.9], tip: 6.9, splay: 0.16 },
  { name: 'middle', bone: 8, base: [-8.5, 3, -102], L: [49, 31, 24], r: [9.6, 8.8, 8.1], tip: 7.0, splay: 0.04 },
  { name: 'ring', bone: 11, base: [11, 1.8, -98.5], L: [45, 29, 23], r: [9.1, 8.3, 7.6], tip: 6.7, splay: -0.09, cup: true },
  { name: 'pinky', bone: 14, base: [29, -1.5, -90], L: [36, 22, 21], r: [8.2, 7.4, 6.8], tip: 6.0, splay: -0.22, cup: true },
];
// pose vector: thumb [flex, spread, twist, mcp, ip], then [mcp flex, spread, pip, dip] per finger, then cup
export const POSE_SIZE = 22;
export const POSE_AT = { thumb: 0, index: 5, middle: 9, ring: 13, pinky: 17, cup: 21 };
// the pose the skin is modelled in
export const BIND_POSE = new Float32Array([0, 0, 0, 0.3, 0.28, 0.34, 0, 0.55, 0.3, 0.36, 0, 0.58, 0.32, 0.38, 0, 0.58, 0.32, 0.4, 0, 0.56, 0.32, 0]);
// how much finer than life the cloth shaders sample each bucket (see Arm: aRest)
const GRAIN = { back: 2.0, palm: 2.6, pad: 5, trim: 3, strap: 2.6, sleeve: 2.8 };
export const SLEEVE_END = 450; // mm from the wrist: the sleeve always runs off screen

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// bind-pose frame of a digit's first bone before any flexion: columns X (flexion axis), Y (back of
// the digit), Z (toward the knuckle)
function digitFrame(D) {
  if (D.dir) {
    const Z = norm([-D.dir[0], -D.dir[1], -D.dir[2]]);
    let c = D.curl; const k = dot(c, Z);
    c = norm([c[0] - Z[0] * k, c[1] - Z[1] * k, c[2] - Z[2] * k]);
    const Y = [-c[0], -c[1], -c[2]];
    return { X: cross(Y, Z), Y, Z };
  }
  const a = D.splay || 0;
  return { X: [Math.cos(a), 0, -Math.sin(a)], Y: [0, 1, 0], Z: [Math.sin(a), 0, Math.cos(a)] };
}

// ---- rig -----------------------------------------------------------------------------------------

const _q = new Quaternion(), _q2 = new Quaternion(), _m = new Matrix4();
const _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _v = new Vector3();
const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);

function makeRig(side) {
  const mk = (parent, pos, quat) => { const b = new Bone(); if (pos) b.position.set(pos[0] * MM, pos[1] * MM, pos[2] * MM); if (quat) b.quaternion.copy(quat); if (parent) parent.add(b); return b; };
  const forearm = mk(null), hand = mk(forearm);
  const cup = mk(hand, [CUP_AT[0] * side, CUP_AT[1], CUP_AT[2]]);
  const bones = [forearm, hand];
  const digits = DIGITS.map((D) => {
    const F = digitFrame(D);
    const X = new Vector3(...F.X), Y = new Vector3(...F.Y), Z = new Vector3(...F.Z);
    if (side < 0) { X.x *= -1; Y.x *= -1; Z.x *= -1; X.multiplyScalar(-1); } // mirrored frame stays right-handed
    const q = new Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z));
    const at = D.cup ? [(D.base[0] - CUP_AT[0]) * side, D.base[1] - CUP_AT[1], D.base[2] - CUP_AT[2]] : [D.base[0] * side, D.base[1], D.base[2]];
    const b0 = mk(D.cup ? cup : hand, at, q);
    const b1 = mk(b0, [0, 0, -D.L[0]]), b2 = mk(b1, [0, 0, -D.L[1]]);
    bones.push(b0, b1, b2);
    return { D, rest: q, bones: [b0, b1, b2] };
  });
  bones.push(cup);
  return { side, forearm, hand, cup, bones, digits };
}

// pose: Float32Array(POSE_SIZE), radians. Flexion is positive toward the palm.
function applyPose(rig, p) {
  const s = rig.side;
  for (let d = 0; d < 5; d++) {
    const { rest, bones } = rig.digits[d];
    if (d === 0) {
      _q.setFromAxisAngle(AY, p[1] * s).multiply(_q2.setFromAxisAngle(AX, -p[0])).multiply(_q2.setFromAxisAngle(AZ, p[2] * s));
      bones[0].quaternion.copy(rest).multiply(_q);
      bones[1].quaternion.setFromAxisAngle(AX, -p[3]);
      bones[2].quaternion.setFromAxisAngle(AX, -p[4]);
    } else {
      const o = 1 + d * 4;
      _q.setFromAxisAngle(AY, p[o + 1] * s).multiply(_q2.setFromAxisAngle(AX, -p[o]));
      bones[0].quaternion.copy(rest).multiply(_q);
      bones[1].quaternion.setFromAxisAngle(AX, -p[o + 2]);
      bones[2].quaternion.setFromAxisAngle(AX, -p[o + 3]);
    }
  }
  rig.cup.quaternion.setFromAxisAngle(AZ, -p[POSE_AT.cup] * s);
}

// ---- the hand as an implicit surface (right hand, bind pose, mm) -----------------------------------

function roundCone(a, b, r1, r2) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (px, py, pz) => {
    const ax = px - a[0], ay = py - a[1], az = pz - a[2];
    const y = ax * bx + ay * by + az * bz, z = y - l2;
    const cx = ax * l2 - bx * y, cy = ay * l2 - by * y, cz = az * l2 - bz * y;
    const x2 = cx * cx + cy * cy + cz * cz, y2 = y * y * l2, z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  };
}
const ellipsoid = (c, r) => (px, py, pz) => {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z), k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
};
// an ellipsoid with its radii along a bone's frame ax = [X, Y, Z] (approximate distance, good near the surface)
const ellipsoidIn = (c, ax, r) => (px, py, pz) => {
  const dx = px - c[0], dy = py - c[1], dz = pz - c[2];
  const x = (dx * ax[0][0] + dy * ax[0][1] + dz * ax[0][2]) / r[0], y = (dx * ax[1][0] + dy * ax[1][1] + dz * ax[1][2]) / r[1], z = (dx * ax[2][0] + dy * ax[2][1] + dz * ax[2][2]) / r[2];
  const k0 = Math.hypot(x, y, z), k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
};
const sphere = (c, r) => (px, py, pz) => Math.hypot(px - c[0], py - c[1], pz - c[2]) - r;
const roundBox = (c, h, r) => (px, py, pz) => {
  const x = Math.abs(px - c[0]) - h[0] + r, y = Math.abs(py - c[1]) - h[1] + r, z = Math.abs(pz - c[2]) - h[2] + r;
  return Math.min(Math.max(x, y, z), 0) + Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) - r;
};

// Everything the builder needs to know about the hand at a point: distance, which part it belongs
// to, skin weights and which side of the glove's seam it is on.
function makeField(rig, carve) {
  rig.forearm.position.set(0, 0, 0); rig.forearm.quaternion.identity(); rig.hand.quaternion.identity();
  applyPose(rig, BIND_POSE);
  rig.forearm.updateMatrixWorld(true);
  const J = [], AXES = []; // per digit: four joint points (mm), three [X, Y, Z] bone frames
  for (const { D, bones } of rig.digits) {
    const pts = [], ax = [];
    for (let i = 0; i < 3; i++) {
      const e = bones[i].matrixWorld.elements;
      pts.push([e[12] / MM, e[13] / MM, e[14] / MM]);
      ax.push([[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]]);
    }
    const Z = ax[2][2], p2 = pts[2];
    pts.push([p2[0] - Z[0] * D.L[2], p2[1] - Z[1] * D.L[2], p2[2] - Z[2] * D.L[2]]);
    J.push(pts); AXES.push(ax);
  }
  const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const off = (p, ax, x, y, z) => [p[0] + ax[0][0] * x + ax[1][0] * y + ax[2][0] * z, p[1] + ax[0][1] * x + ax[1][1] * y + ax[2][1] * z, p[2] + ax[0][2] * x + ax[1][2] * y + ax[2][2] * z];

  // digits: a finger is not three cones. Each phalanx is a slim shaft (SHAFT of the joint's girth); the
  // joints keep their full girth and carry a knuckle proud on the back; under each phalanx, between the
  // joints, sits a soft pad, so from the side the back is knuckle-dip-knuckle and the underside is
  // pad-crease-pad, the creases falling under the joints.
  const SHAFT = 0.88;
  const digitPrims = DIGITS.map((D, d) => {
    const P = J[d], A = AXES[d], prims = [];
    const tipC = along(P[2], P[3], 1 - D.tip / D.L[2]);
    if (d === 0) {
      prims.push(roundCone(P[0], P[1], 14.2, D.r[0] + 0.4)); // thumb metacarpal with the thenar muscle on it
      prims.push(roundCone(off(P[0], A[0], 5, -6.5, -4), off(P[1], A[0], 5, -4.5, 12), 12.5, 8.5)); // thenar pad
    } else prims.push(roundCone(P[0], P[1], D.r[0] * 0.95, D.r[1] * SHAFT));
    prims.push(roundCone(P[1], P[2], D.r[1] * SHAFT, D.r[2] * SHAFT));
    prims.push(roundCone(P[2], tipC, D.r[2] * SHAFT, D.tip * 0.94));
    const kn = [];
    // the joints: full girth, and a knuckle standing proud on the back of each
    kn.push(sphere(P[1], D.r[1] * 0.97));
    kn.push(sphere(P[2], D.r[2] * 0.96));
    kn.push(ellipsoidIn(off(P[1], A[1], 0, 4.4, 0.5), A[1], [D.r[1] * 0.86, D.r[1] * 0.74, D.r[1] * 0.98]));
    kn.push(ellipsoidIn(off(P[2], A[2], 0, 3.6, 0.5), A[2], [D.r[2] * 0.84, D.r[2] * 0.72, D.r[2] * 0.94]));
    // the soft pad under each phalanx: fullest at its middle, gone at the creases
    if (d > 0) {
      kn.push(ellipsoidIn(off(along(P[0], P[1], 0.5), A[0], 0, -3.4, 0), A[0], [(D.r[0] + D.r[1]) * 0.47, (D.r[0] + D.r[1]) * 0.44, D.L[0] * 0.3]));
      kn.push(ellipsoidIn(off(along(P[1], P[2], 0.5), A[1], 0, -3.2, 0), A[1], [(D.r[1] + D.r[2]) * 0.47, (D.r[1] + D.r[2]) * 0.43, D.L[1] * 0.33]));
    } else kn.push(ellipsoidIn(off(along(P[1], P[2], 0.5), A[1], 0, -2.6, 0), A[1], [(D.r[1] + D.r[2]) * 0.47, (D.r[1] + D.r[2]) * 0.44, D.L[1] * 0.34]));
    // the fingertip: a full pad underneath, the nail side flatter
    kn.push(ellipsoidIn(off(tipC, A[2], 0, -2.2, 3), A[2], [D.tip * 1.02, D.tip * 0.98, D.tip * 1.3]));
    const c = along(P[0], P[3], 0.5), R = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]) * 0.5 + 34;
    return { prims, kn, c, R };
  });

  // palm: metacarpals under a flat back, a hollow centre between the two pads, the carpus, the wrist
  const CARPAL = [[-15, -1, -10], [-5, 0, -8], [6, 0, -8], [15.5, -2, -10]];
  const palmPrims = [];
  for (let d = 1; d < 5; d++) palmPrims.push(roundCone(CARPAL[d - 1], DIGITS[d].base, 12.2, DIGITS[d].r[0] + 2.4));
  palmPrims.push(roundBox([0, 1.2, -50], [31, 9.6, 40], 8));
  palmPrims.push(ellipsoid([0, -2.5, -11], [29, 15.5, 21])); // carpus
  palmPrims.push(ellipsoid([25.5, -9, -43], [12.5, 11.5, 35])); // hypothenar pad
  palmPrims.push(ellipsoid([2, -8.5, -90], [35, 7.5, 11])); // pad under the knuckles
  const wrist = (px, py, pz) => {
    const rx = 29.5 + 0.035 * pz, ry = 18.5 + 0.04 * pz;
    const qx = px / rx, qy = (py + 1) / ry;
    const dr = (Math.hypot(qx, qy) - 1) * Math.min(rx, ry);
    return Math.max(dr, pz - 70, -12 - pz);
  };

  const S = { d: 0, palm: 0, dig: [0, 0, 0, 0, 0], best: -1, fold: 0 }; // filled by raw() and weights()
  function raw(px, py, pz) {
    let dp = wrist(px, py, pz);
    for (let i = 0; i < palmPrims.length; i++) dp = smin(dp, palmPrims[i](px, py, pz), 7);
    S.palm = dp;
    let d = dp, best = -1, bd = 1e9;
    for (let k = 0; k < 5; k++) {
      const G = digitPrims[k];
      const far = Math.hypot(px - G.c[0], py - G.c[1], pz - G.c[2]) - G.R;
      let dd;
      if (far > 12) dd = far + 20; // well clear of this digit: its bound is enough
      else {
        dd = G.prims[0](px, py, pz);
        for (let i = 1; i < G.prims.length; i++) dd = smin(dd, G.prims[i](px, py, pz), k === 0 && i === 1 ? 6 : 1.6);
        for (let i = 0; i < G.kn.length; i++) dd = smin(dd, G.kn[i](px, py, pz), 2.6);
      }
      S.dig[k] = dd;
      if (dd < bd) { bd = dd; best = k; }
      d = smin(d, dd, k === 0 ? 11 : 4.5);
    }
    S.best = best; S.d = d;
    return d;
  }

  // ---- skin weights: [bone, weight] x 4 -----------------------------------------------------------
  const BIS = AXES.map((A) => { // planes through the two outer joints that split one phalanx from the next
    const u0 = A[0][2], u1 = A[1][2], u2 = A[2][2];
    return [norm([u0[0] + u1[0], u0[1] + u1[1], u0[2] + u1[2]]), norm([u1[0] + u2[0], u1[1] + u2[1], u1[2] + u2[2]])];
  });
  const cand = new Float32Array(6), W = new Float32Array(8);
  const CB = [FOREARM, HAND, CUP, 0, 0, 0];
  const BLEND = [[9, 6.5, 5.5], [9, 6, 5], [9, 6, 5], [9, 6, 5], [8, 5.5, 4.5]];
  // call after raw() at the same point
  function weights(px, py, pz, out = W) {
    const k = S.best, D = DIGITS[k], P = J[k], A = AXES[k];
    const dmin = Math.min(S.palm, S.dig[k]);
    const gate = 1 - smooth(1, 6.5, S.dig[k] - dmin);
    const u0 = A[0][2]; // bone Z axes point back toward the knuckle
    const t0 = -((px - P[0][0]) * u0[0] + (py - P[0][1]) * u0[1] + (pz - P[0][2]) * u0[2]);
    const n1 = BIS[k][0], n2 = BIS[k][1];
    const t1 = -((px - P[1][0]) * n1[0] + (py - P[1][1]) * n1[1] + (pz - P[1][2]) * n1[2]);
    const t2 = -((px - P[2][0]) * n2[0] + (py - P[2][1]) * n2[1] + (pz - P[2][2]) * n2[2]);
    const B = BLEND[k];
    const a0 = (k === 0 ? smooth(-10, 13, t0) : smooth(-B[0], B[0] + 3, t0)) * gate;
    const a1 = smooth(-B[1], B[1], t1), a2 = smooth(-B[2], B[2], t2);
    // where the glove creases: over each finger joint and across the knuckle line
    S.fold = gate * Math.max(Math.exp(-((t1 / 3.4) ** 2)), Math.exp(-((t2 / 3) ** 2)), 0.7 * Math.exp(-(((t0 - 6) / 5) ** 2)));
    const H = 1 - a0;
    const wf = smooth(-10, 18, pz);
    let wc = smooth(1, 17, px) * smooth(-16, -46, pz);
    if (D.cup) wc += (1 - wc) * Math.min(1, a0 * 4);
    cand[0] = H * wf; cand[1] = H * (1 - wf) * (1 - wc); cand[2] = H * (1 - wf) * wc;
    cand[3] = a0 * (1 - a1); cand[4] = a0 * a1 * (1 - a2); cand[5] = a0 * a1 * a2;
    CB[3] = D.bone; CB[4] = D.bone + 1; CB[5] = D.bone + 2;
    // keep the four largest
    let lo = 0, lo2 = 1;
    if (cand[lo2] < cand[lo]) { lo = 1; lo2 = 0; }
    for (let i = 2; i < 6; i++) { if (cand[i] < cand[lo]) { lo2 = lo; lo = i; } else if (cand[i] < cand[lo2]) lo2 = i; }
    let sum = 0, n = 0;
    for (let i = 0; i < 6; i++) if (i !== lo && i !== lo2) sum += cand[i];
    for (let i = 0; i < 6; i++) if (i !== lo && i !== lo2) { out[n * 2] = CB[i]; out[n * 2 + 1] = cand[i] / sum; n++; }
    return out;
  }

  // which side of the glove's side seam: > 0 is the fabric back, < 0 the leather palm. Call after raw().
  function dorsal(px, py, pz) {
    const k = S.best, P = J[k], A = AXES[k];
    const dmin = Math.min(S.palm, S.dig[k]);
    const gate = 1 - smooth(1, 6.5, S.dig[k] - dmin);
    // nearest phalanx by its bisector planes
    let seg = 0;
    for (let i = 1; i < 3; i++) { const u = A[i][2]; if (-((px - P[i][0]) * u[0] + (py - P[i][1]) * u[1] + (pz - P[i][2]) * u[2]) > 0) seg = i; }
    const Y = A[seg][1], q = P[seg];
    const u0 = A[0][2];
    const t0 = -((px - P[0][0]) * u0[0] + (py - P[0][1]) * u0[1] + (pz - P[0][2]) * u0[2]);
    const fd = (px - q[0]) * Y[0] + (py - q[1]) * Y[1] + (pz - q[2]) * Y[2] - SEAM_Y;
    const fp = Math.max(py + 1.5, (pz - 6) * 0.5);
    const m = gate * (k === 0 ? smooth(4, 22, t0) : smooth(-4, 10, t0));
    return fp + (fd - fp) * m;
  }

  // ---- carve: press the skin against what the hand holds --------------------------------------------
  const cw = new Float32Array(8);
  function sd(px, py, pz) {
    let d = raw(px, py, pz);
    if (carve && d < 3 && d > -22) {
      weights(px, py, pz, cw);
      // how far flesh gives: a palm or a thumb's pad a long way, the root of a finger a little, a fingertip hardly
      let give = 20;
      if (S.dig[S.best] <= S.palm + 2) {
        let root = false;
        for (let k = 0; k < 4; k++) if (cw[k * 2] === DIGITS[S.best].bone && cw[k * 2 + 1] > 0.5) root = true;
        give = S.best === 0 ? (root ? 20 : 6) : root ? 3.5 : 1.6;
      }
      const c = carve(px, py, pz, cw);
      if (c < 12) d = smax(d, Math.min(0.2 - c, d + give), 1.6);
    }
    return d;
  }
  return { sd, raw, weights, dorsal, S, J, AXES };
}
const SEAM_Y = 1.0;
const TIP_CAP = 15; // mm of each fingertip covered by the suede cap
const CELL = 2.5; // mm: the glove skin's mesh size
const STITCH = 1.0; // mm between stations along a seam

// ---- polygonise: naive surface nets over a narrow band, vertices pulled onto the surface ------------

function surfaceNets(sd, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  const B = 3, reach = h * B * 0.87 + h; // a block's centre value decides whether to sample it densely
  for (let k0 = 0; k0 < nz; k0 += B) for (let j0 = 0; j0 < ny; j0 += B) for (let i0 = 0; i0 < nx; i0 += B) {
    const c = sd(lo[0] + (i0 + (B - 1) / 2) * h, lo[1] + (j0 + (B - 1) / 2) * h, lo[2] + (k0 + (B - 1) / 2) * h);
    const dense = Math.abs(c) < reach + 2.5;
    for (let k = k0; k < Math.min(nz, k0 + B); k++) for (let j = j0; j < Math.min(ny, j0 + B); j++) for (let i = i0; i < Math.min(nx, i0 + B); i++) {
      val[i + nx * (j + ny * k)] = dense ? sd(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h) : c;
    }
  }
  const cell = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const at = (i, j, k) => val[i + nx * (j + ny * k)];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    const v = [at(i, j, k), at(i + 1, j, k), at(i, j + 1, k), at(i + 1, j + 1, k), at(i, j, k + 1), at(i + 1, j, k + 1), at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1)];
    for (let c = 0; c < 8; c++) if (v[c] < 0) mask |= 1 << c;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let a = 0; a < 8; a++) for (let ax = 1; ax <= 4; ax <<= 1) {
      if (a & ax) continue;
      const b = a | ax;
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += (a & 1) + (ax === 1 ? t : 0); sy += ((a >> 1) & 1) + (ax === 2 ? t : 0); sz += ((a >> 2) & 1) + (ax === 4 ? t : 0); n++;
    }
    cell[i + nx * (j + ny * k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const quads = [];
  const C = (i, j, k) => cell[i + nx * (j + ny * k)];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = at(i, j, k) < 0;
    if (s0 !== (at(i + 1, j, k) < 0)) { const q = [C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k)]; if (s0) quads.push(q[0], q[1], q[2], q[3]); else quads.push(q[3], q[2], q[1], q[0]); }
    if (s0 !== (at(i, j + 1, k) < 0)) { const q = [C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1)]; if (s0) quads.push(q[0], q[1], q[2], q[3]); else quads.push(q[3], q[2], q[1], q[0]); }
    if (s0 !== (at(i, j, k + 1) < 0)) { const q = [C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k)]; if (s0) quads.push(q[0], q[1], q[2], q[3]); else quads.push(q[3], q[2], q[1], q[0]); }
  }
  return { pos, quads };
}

// One bucket of skinned, indexed triangles.
class Part {
  constructor() { this.p = []; this.n = []; this.w = []; this.i = []; this.a = []; }
  // p, n: [x, y, z] mm; w: 8 numbers; fold, ao: 0..1 -> index
  vert(p, n, w, fold = 0, ao = 0) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
    for (let k = 0; k < 8; k++) this.w.push(w[k]);
    this.a.push(0, 0, fold, ao);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // rigid hard-surface piece from a geo.js soup (flat-shaded with bevel-weighted normals)
  soup(s, w) {
    s.dropDegenerate();
    const nr = weightedNormals(new Float32Array(s.p), 50);
    const base = this.p.length / 3;
    for (let v = 0; v < s.p.length / 3; v++) this.vert([s.p[v * 3], s.p[v * 3 + 1], s.p[v * 3 + 2]], [nr[v * 3], nr[v * 3 + 1], nr[v * 3 + 2]], w);
    for (let v = 0; v < s.p.length / 3; v += 3) this.i.push(base + v, base + v + 1, base + v + 2);
  }
  get triCount() { return this.i.length / 3; }
}

// All of one arm's geometry by material bucket: { back, palm, pad, trim, strap, sleeve } of Part.
// Built in right-hand space. carve(x, y, z, weights) -> clearance in mm of the
// bind-space point once the hand is in its grip (positive: free), or null.
export function buildArmParts(carve = null) {
  const F = makeField(makeRig(1), carve);
  const { sd, raw, weights, dorsal, S, J, AXES } = F;
  const out = { back: new Part(), palm: new Part(), pad: new Part(), trim: new Part(), strap: new Part(), sleeve: new Part() };
  const grad = (x, y, z, e = 0.4) => { const d = sd(x, y, z); return norm([sd(x + e, y, z) - d, sd(x, y + e, z) - d, sd(x, y, z + e) - d]); };
  const wAt = (p) => { raw(p[0], p[1], p[2]); return Array.from(weights(p[0], p[1], p[2])); };
  // slide a point along `dir` onto the surface (sphere tracing from outside)
  const land = (p, dir, max = 90) => {
    const q = [p[0], p[1], p[2]];
    let t = 0;
    for (let i = 0; i < 48 && t < max; i++) { const d = sd(q[0], q[1], q[2]); if (d < 0.02) break; const s = Math.max(d * 0.85, 0.02); q[0] += dir[0] * s; q[1] += dir[1] * s; q[2] += dir[2] * s; t += s; }
    return q;
  };

  // ---- glove skin ----
  const net = surfaceNets(sd, [-76, -64, -196], [56, 30, 72], CELL);
  const nv = net.pos.length / 3;
  const P = net.pos, N = new Float32Array(nv * 3), dors = new Float32Array(nv);
  const skinW = new Float32Array(nv * 8), fold = new Float32Array(nv), tipv = new Uint8Array(nv);
  const meshNormals = () => {
    N.fill(0);
    for (let q = 0; q < net.quads.length; q += 4) {
      const a = net.quads[q] * 3, b = net.quads[q + 1] * 3, c = net.quads[q + 2] * 3, d = net.quads[q + 3] * 3;
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [a, b, c, d]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
    }
    for (let v = 0; v < nv; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  };
  meshNormals();
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    raw(x, y, z);
    skinW.set(weights(x, y, z), v * 8);
    fold[v] = Math.max(S.fold, 0.8 * Math.exp(-(((z - 2) / 5) ** 2))); // and at the wrist
    dors[v] = dorsal(x, y, z);
    { // the last 15 mm of every digit is a suede cap (see TIP_CAP)
      const k = S.best, Pk = J[k][2], Zk = AXES[k][2][2];
      const t2 = -((x - Pk[0]) * Zk[0] + (y - Pk[1]) * Zk[1] + (z - Pk[2]) * Zk[2]);
      if (S.dig[k] <= S.palm + 1 && t2 > DIGITS[k].L[2] - TIP_CAP) tipv[v] = 1;
    }
    if (carve) {
      // the net's vertices sit within a fraction of a millimetre of the pressed surface; any still
      // inside what the hand holds are drawn in along the normal until they are clear
      const w = skinW.subarray(v * 8, v * 8 + 8);
      let dir = -1; // inward, unless that only takes a thin web deeper
      for (let it = 0; it < 12; it++) {
        const c = carve(x, y, z, w);
        if (c >= 0.1) break;
        if (it === 3 && c < -1.5) { const out = carve(x + N[v * 3] * 4, y + N[v * 3 + 1] * 4, z + N[v * 3 + 2] * 4, w); if (out > c + 1) dir = 1; }
        const s = Math.min(1.5, 0.25 - c) * dir;
        x += N[v * 3] * s; y += N[v * 3 + 1] * s; z += N[v * 3 + 2] * s;
      }
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    }
  }
  // The fabric gathers where the glove bends: a crease over each joint with a ridge either side of
  // it. Only on the back, so nothing that bears on the gun moves.
  for (let v = 0; v < nv; v++) {
    const f = fold[v];
    if (dors[v] <= 0.5 || f < 0.05) continue;
    const h = (0.62 * Math.cos(f * 9.42) * smooth(0.05, 0.3, f) - 0.45 * f * f * f) * smooth(0.5, 3, dors[v]);
    P[v * 3] += N[v * 3] * h; P[v * 3 + 1] += N[v * 3 + 1] * h; P[v * 3 + 2] += N[v * 3 + 2] * h;
  }
  meshNormals();
  // both glove buckets share one vertex list; the open end of the cuff (z > 66) is dropped
  for (const part of [out.back, out.palm]) { part.p = P; part.n = N; part.w = skinW; part.a = new Float32Array(nv * 4); }
  out.palm.a = out.back.a;
  for (let v = 0; v < nv; v++) out.back.a[v * 4 + 2] = fold[v];
  // the seam lines, baked into the skin itself (aSurf.x: the cloth wears paler there, and tiers that
  // drop the stitched rows draw the thread's line from it): the side seam of every finger and of the
  // palm, where the fabric back meets the suede
  for (let v = 0; v < nv; v++) out.back.a[v * 4] = 0.8 * (1 - smooth(0.3, 2.6, Math.abs(dors[v])));
  for (let q = 0; q < net.quads.length; q += 4) {
    const a = net.quads[q], b = net.quads[q + 1], c = net.quads[q + 2], d = net.quads[q + 3];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (Math.min(P[a * 3 + 2], P[b * 3 + 2], P[c * 3 + 2], P[d * 3 + 2]) > 66) continue;
    const cap = tipv[a] + tipv[b] + tipv[c] + tipv[d] >= 3;
    (!cap && dors[a] + dors[b] + dors[c] + dors[d] > 0 ? out.back : out.palm).quad(a, b, c, d);
  }

  // ---- stitched seams: up each side of every digit and over the tip ----
  // A row of stitches: two stations of thread, one of gap (2 mm stitches in a fine dark thread).
  const bead = (path, wide = 0.4, high = 0.42) => {
    let prev = null;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      const n = grad(p[0], p[1], p[2]);
      const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const s = norm(cross(n, t));
      const w = wAt(p);
      const lift = high * (0.7 + 0.3 * Math.cos(p[3] * (Math.PI / STITCH))); // each stitch pulls the ridge down a little
      const v0 = out.trim.vert([p[0] - s[0] * wide - n[0] * 0.25, p[1] - s[1] * wide - n[1] * 0.25, p[2] - s[2] * wide - n[2] * 0.25], norm([n[0] - s[0], n[1] - s[1], n[2] - s[2]]), w);
      const v1 = out.trim.vert([p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift], n, w);
      const v2 = out.trim.vert([p[0] + s[0] * wide - n[0] * 0.25, p[1] + s[1] * wide - n[1] * 0.25, p[2] + s[2] * wide - n[2] * 0.25], norm([n[0] + s[0], n[1] + s[1], n[2] + s[2]]), w);
      if (prev && i % 3 !== 0) { out.trim.quad(prev[0], v0, v1, prev[1]); out.trim.quad(prev[1], v1, v2, prev[2]); }
      prev = [v0, v1, v2];
    }
  };
  for (let d = 0; d < 5; d++) {
    const D = DIGITS[d], Pd = J[d], A = AXES[d];
    const path = [];
    let run = 0;
    // start just outside this digit's own skin: a longer ray would begin inside the neighbouring finger
    const R0 = D.r[0] + 3.5;
    const put = (c, dir) => { const q = land([c[0] + dir[0] * R0, c[1] + dir[1] * R0, c[2] + dir[2] * R0], [-dir[0], -dir[1], -dir[2]], R0 + 4); q.push(run); path.push(q); run += STITCH; };
    const sideRun = (sgn, rev) => {
      const pts = [];
      for (let seg = d === 0 ? 1 : 0; seg < 3; seg++) {
        const X = A[seg][0], Y = A[seg][1], Z = A[seg][2];
        const L = D.L[seg] - (seg === 2 ? D.tip : 0), s0 = seg === 0 ? 17 : 0;
        for (let s = s0; s < L; s += STITCH) pts.push([[Pd[seg][0] - Z[0] * s + Y[0] * SEAM_Y, Pd[seg][1] - Z[1] * s + Y[1] * SEAM_Y, Pd[seg][2] - Z[2] * s + Y[2] * SEAM_Y], [X[0] * sgn, X[1] * sgn, X[2] * sgn]]);
      }
      if (rev) pts.reverse();
      for (const [c, dir] of pts) put(c, dir);
    };
    sideRun(1, false);
    const X = A[2][0], Y = A[2][1], Z = A[2][2];
    const tc = [Pd[3][0] + Z[0] * D.tip + Y[0] * SEAM_Y, Pd[3][1] + Z[1] * D.tip + Y[1] * SEAM_Y, Pd[3][2] + Z[2] * D.tip + Y[2] * SEAM_Y];
    for (let a = 0.12; a < Math.PI - 0.06; a += STITCH / D.tip) put(tc, [X[0] * Math.cos(a) - Z[0] * Math.sin(a), X[1] * Math.cos(a) - Z[1] * Math.sin(a), X[2] * Math.cos(a) - Z[2] * Math.sin(a)]);
    sideRun(-1, true);
    bead(path);
    // the seam where the fingertip's cap is sewn on
    const ring = [], cz = D.L[2] - TIP_CAP, rr = D.r[2] + 4;
    run = 0;
    for (let a = 0; a < Math.PI * 2 + 0.01; a += STITCH / D.r[2]) {
      const dir = [X[0] * Math.cos(a) + Y[0] * Math.sin(a), X[1] * Math.cos(a) + Y[1] * Math.sin(a), X[2] * Math.cos(a) + Y[2] * Math.sin(a)];
      const c = [Pd[2][0] - Z[0] * cz, Pd[2][1] - Z[1] * cz, Pd[2][2] - Z[2] * cz];
      const q = land([c[0] + dir[0] * rr, c[1] + dir[1] * rr, c[2] + dir[2] * rr], [-dir[0], -dir[1], -dir[2]], rr + 2);
      if (Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) > rr - 0.5) { if (ring.length > 3) bead(ring); ring.length = 0; continue; } // ran into the next finger
      q.push(run); run += STITCH; ring.push(q);
    }
    if (ring.length > 3) bead(ring);
  }
  // down each edge of the palm, where the fabric back meets the leather
  for (const sgn of [1, -1]) {
    const path = [];
    let run = 0;
    for (let z = -84; z <= 5; z += STITCH) {
      if (sgn < 0 && z > -66 && z < -8) continue; // the thumb is in the way on this side
      const q = land([sgn * 70, -1.5, z], [-sgn, 0, 0], 70); q.push(run); run += STITCH;
      if (sgn < 0 && z >= -8 && path.length && path[path.length - 1][2] < -60) { bead(path); path.length = 0; }
      path.push(q);
    }
    bead(path);
  }

  // the stitched outline of the back-of-hand panel, and the seam where the cuff is sewn on
  {
    const path = [];
    let run = 0;
    const X0 = -27, X1 = 26, Z0 = -70, Z1 = -14, R = 11;
    const corner = (cx, cz, a0) => { for (let a = a0; a < a0 + Math.PI / 2 + 1e-6; a += STITCH / R) path.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); };
    const line = (x0, z0, x1, z1) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / STITCH); for (let i = 1; i < n; i++) path.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]); };
    corner(X1 - R, Z1 - R, 0); line(X1 - R, Z1, X0 + R, Z1); corner(X0 + R, Z1 - R, Math.PI / 2); line(X0, Z1 - R, X0, Z0 + R);
    corner(X0 + R, Z0 + R, Math.PI); line(X0 + R, Z0, X1 - R, Z0); corner(X1 - R, Z0 + R, Math.PI * 1.5); line(X1, Z0 + R, X1, Z1 - R);
    path.push(path[0]);
    bead(path.map(([x, z]) => { const q = land([x, 44, z], [0, -1, 0], 70); q.push(run); run += STITCH; return q; }), 0.5, 0.4);
    const ring = [];
    run = 0;
    for (let a = 0; a <= Math.PI * 2 + 1e-6; a += STITCH / 26) { const q = land([Math.cos(a) * 70, Math.sin(a) * 70 - 1, 2.5], [-Math.cos(a), -Math.sin(a), 0], 70); q.push(run); run += STITCH; ring.push(q); }
    bead(ring, 0.55, 0.42);
  }

  // ---- knuckle panel: one moulded piece over the four knuckles, split by flex grooves ----
  {
    const MCP = DIGITS.slice(1).map((D) => D.base);
    const zMid = (x) => { // the knuckle line
      if (x <= MCP[0][0]) return MCP[0][2];
      for (let i = 0; i < 3; i++) if (x <= MCP[i + 1][0]) { const t = (x - MCP[i][0]) / (MCP[i + 1][0] - MCP[i][0]); return MCP[i][2] + (MCP[i + 1][2] - MCP[i][2]) * t; }
      return MCP[3][2];
    };
    const X0 = -37.5, X1 = 37, nxp = 62, nzp = 28, Z0 = -5.5, Z1 = 24;
    const rows = [];
    for (let i = 0; i <= nxp; i++) {
      const row = [];
      const x = X0 + ((X1 - X0) * i) / nxp;
      for (let j = 0; j <= nzp; j++) {
        const zl = Z0 + ((Z1 - Z0) * j) / nzp, z = zMid(x) + zl;
        // rounded outline, then four pods with grooves between them
        const ex = Math.min(x - X0, X1 - x), ez = Math.min(zl - Z0, Z1 - zl);
        const edge = smooth(0, 2.2, Math.min(ex, ez * 1.0)) * smooth(0, 5, ex + ez - 2.5);
        let pod = 0, groove = 1;
        // flat-topped pods with crisp shoulders, each scored by two flex lines
        for (let k = 0; k < 4; k++) pod = Math.max(pod, (1 - smooth(5.4, 7.6, Math.abs(x - MCP[k][0]))) * (1 - smooth(7.5, 10.5, Math.abs(zl - 4))) * (0.82 + 0.18 * smooth(0.5, 1.1, Math.abs(Math.abs(zl - 4) - 4.2))));
        for (let k = 0; k < 3; k++) groove = Math.min(groove, smooth(0.5, 2.0, Math.abs(x - (MCP[k][0] + MCP[k + 1][0]) / 2)));
        const rear = 1 - 0.45 * smooth(12, 20, zl); // thins toward the wrist
        const lift = edge * (0.3 + groove * (1.0 * rear + 2.3 * pod));
        const q = land([x, 46, z], [0, -1, 0], 80);
        raw(q[0], q[1], q[2]);
        const n = grad(q[0], q[1], q[2]);
        // rigid on the hand: the panel is a hard shell and must not crumple when the fingers close
        const wc = smooth(1, 17, q[0]) * smooth(-16, -46, q[2]);
        const hit = q[1] > -6 && Math.abs(S.d) < 0.6; // the ray can miss the hand at the panel's corners
        row.push({ q, n, lift, w: [HAND, 1 - wc, CUP, wc, 0, 0, 0, 0], on: hit && edge > 0.02, hit });
      }
      rows.push(row);
    }
    const idx = rows.map((row) => row.map(() => -1));
    const vid = (i, j) => {
      if (idx[i][j] < 0) {
        const r = rows[i][j];
        const l = r.lift - 0.12;
        // shading normal from the lifted neighbours
        const a = rows[Math.max(0, i - 1)][j], b = rows[Math.min(nxp, i + 1)][j], c = rows[i][Math.max(0, j - 1)], d = rows[i][Math.min(nzp, j + 1)];
        const pa = (o) => [o.q[0] + o.n[0] * o.lift, o.q[1] + o.n[1] * o.lift, o.q[2] + o.n[2] * o.lift];
        const A = pa(a), B = pa(b), C2 = pa(c), D2 = pa(d);
        let nn = norm(cross([D2[0] - C2[0], D2[1] - C2[1], D2[2] - C2[2]], [B[0] - A[0], B[1] - A[1], B[2] - A[2]]));
        if (dot(nn, r.n) < 0) nn = [-nn[0], -nn[1], -nn[2]];
        idx[i][j] = out.pad.vert([r.q[0] + r.n[0] * l, r.q[1] + r.n[1] * l, r.q[2] + r.n[2] * l], nn, r.w);
      }
      return idx[i][j];
    };
    for (let i = 0; i < nxp; i++) for (let j = 0; j < nzp; j++) {
      const a = rows[i][j], b = rows[i + 1][j], c = rows[i][j + 1], d = rows[i + 1][j + 1];
      if (!(a.on || b.on || c.on || d.on) || !(a.hit && b.hit && c.hit && d.hit)) continue;
      out.pad.quad(vid(i, j), vid(i, j + 1), vid(i + 1, j + 1), vid(i + 1, j));
    }
  }

  // ---- wrist strap and its pull tab ----
  {
    const NS = 44, rings = [];
    for (const [z, l] of [[7.2, -0.1], [8.2, 1.5], [10.5, 1.75], [22.5, 1.75], [24.8, 1.5], [25.8, -0.1]]) {
      const ring = [];
      for (let j = 0; j < NS; j++) {
        const th = (j / NS) * Math.PI * 2, dir = [Math.cos(th), Math.sin(th), 0];
        const q = land([dir[0] * 70, dir[1] * 70 - 1, z], [-dir[0], -dir[1], 0], 70);
        const n = grad(q[0], q[1], q[2]);
        ring.push(out.strap.vert([q[0] + n[0] * l, q[1] + n[1] * l, q[2] + n[2] * l], l < 0.5 ? norm([n[0], n[1], z < 16 ? -1.2 : 1.2]) : n, wAt(q)));
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < NS; j++) { const k = (j + 1) % NS; out.strap.quad(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]); }
    const top = land([6, 50, 16.5], [0, -1, 0], 60);
    const tw = wAt(top);
    out.pad.soup(box(6, top[1] + 2.6, 16.5, 30, 2.4, 15.5, 0.9, 2), tw);
    out.pad.soup(box(19.5, top[1] + 3.5, 16.5, 7, 2.6, 12.5, 0.8, 2), tw);
  }

  // ---- jacket sleeve: cuff over the glove's wrist, compression folds behind it, drape to the elbow ----
  {
    const NS = 34;
    const fore = [FOREARM, 1, 0, 0, 0, 0, 0, 0];
    const CUFF0 = 31, CUFF1 = 58;
    const ridge = (x) => Math.abs(Math.sin(x * 0.5)) ** 0.75; // round crests, tight valleys
    const shape = (z, th) => {
      const band = z <= CUFF1;
      // the cuff is elasticated: snug on the glove's wrist at its mouth, opening out to the sleeve behind it
      // (a band of one width stood off the wrist all round and read as a separate tube)
      const snug = smooth(CUFF0, CUFF1 + 14, z);
      let rx = band ? 33.2 + 3.8 * snug : 38 + (z - CUFF1) * 0.045 - 1 * (1 - snug), ry = band ? 23.4 + 8.1 * snug : 33 + (z - CUFF1) * 0.052 - 1.5 * (1 - snug);
      let h = 0, fold = 0;
      if (band) h = 1.1 * Math.exp(-(((z - CUFF0 - 3) / 1.3) ** 2)) + 1.1 * Math.exp(-(((z - CUFF1 + 3) / 1.3) ** 2));
      else {
        const f = smooth(CUFF1, CUFF1 + 9, z);
        // cloth pushed up behind the cuff: tight rings that wander round the arm
        const near = Math.exp(-((z - CUFF1) / 85)), k1 = ridge(z * 0.262 + 1.5 * Math.sin(th + 0.4) + 0.8 * Math.sin(2 * th + 1.3) + 0.5 * Math.sin(z * 0.03));
        // long diagonal folds toward the elbow
        const k2 = ridge(z * 0.085 + 2.0 * th + 0.9 * Math.sin(th * 3 + z * 0.012) + 0.6), k3 = 0.5 + 0.5 * Math.sin(z * 0.047 - 3 * th + 2.1);
        h = f * ((k1 - 0.6) * 5.2 * near + (k2 - 0.55) * 5.5 * (1 - 0.75 * near) + (k3 - 0.5) * 2.2)
          + 1.6 * Math.sin(th * 9 + 0.7) * Math.exp(-(z - CUFF1) / 16) * f; // gathers into the cuff seam
        fold = f * Math.min(1, (1 - k1) * 1.5 * near + (1 - k2) * 1.2 * (1 - 0.75 * near));
      }
      rx += h; ry += h;
      const c = Math.cos(th), sn = Math.sin(th);
      const e = 2 / 2.25;
      const sag = band ? 0 : smooth(CUFF1, 200, z) * 5; // slack cloth hangs under the arm
      return [Math.sign(c) * Math.abs(c) ** e * rx, Math.sign(sn) * Math.abs(sn) ** e * ry * (sn < 0 ? 1 + sag * 0.012 : 1) - 1 - sag * 0.5, z, fold];
    };
    const zs = [];
    for (let z = CUFF0; z < 200; z += 3.2) zs.push(z);
    for (let z = 200; z <= SLEEVE_END; z += 7) zs.push(z);
    const rings = [];
    // the hem turned in round the opening
    for (const [z, k] of [[CUFF0 + 9, 0.62], [CUFF0 + 3.2, 0.84], [CUFF0 + 0.3, 0.94]]) { // (deep enough that the mouth never shows an empty ring)
      const ring = [];
      for (let j = 0; j < NS; j++) { const q = shape(z, (j / NS) * Math.PI * 2); ring.push(out.sleeve.vert([q[0] * k, (q[1] + 1) * k - 1, z], [0, 0, -1], fore)); }
      rings.push(ring);
    }
    for (const z of zs) {
      const ring = [];
      for (let j = 0; j < NS; j++) {
        const th = (j / NS) * Math.PI * 2, q = shape(z, th), a = shape(z, th + 0.02), b = shape(z + 0.6, th);
        const n = norm(cross([a[0] - q[0], a[1] - q[1], a[2] - q[2]], [b[0] - q[0], b[1] - q[1], b[2] - q[2]]));
        ring.push(out.sleeve.vert(q, n, fore, q[3], 0));
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < NS; j++) { const k = (j + 1) % NS; out.sleeve.quad(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]); }
    // cuff tab with a snap
    const sp = shape(44.5, 1.15);
    const m = new Matrix4().makeTranslation(sp[0], sp[1], sp[2]).multiply(new Matrix4().makeRotationZ(1.15 - Math.PI / 2));
    const tab = box(0, 1.1, 0, 22, 2.2, 15, 0.8, 2).xf(m);
    out.sleeve.soup(tab, fore);
    const snap = lathe([[0, 2.0], [3.4, 2.0], [3.4, 3.2], [2.5, 4.1], [0, 4.1]], { segs: 14, map: 'zxy' }).xf(new Matrix4().makeTranslation(sp[0], sp[1], sp[2]).multiply(new Matrix4().makeRotationZ(1.15 - Math.PI / 2)).multiply(new Matrix4().makeTranslation(5, 0, 0)));
    out.pad.soup(snap, fore);
  }
  return out;
}

function geometryFrom(part, mirror, grain, shared = null) {
  const nv = part.p.length / 3;
  const g = new BufferGeometry();
  const sgn = mirror ? -1 : 1;
  if (shared) { for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'aSurf']) g.setAttribute(k, shared.getAttribute(k)); } else {
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      pos[v * 3] = part.p[v * 3] * MM * sgn; pos[v * 3 + 1] = part.p[v * 3 + 1] * MM; pos[v * 3 + 2] = part.p[v * 3 + 2] * MM;
      nrm[v * 3] = part.n[v * 3] * sgn; nrm[v * 3 + 1] = part.n[v * 3 + 1]; nrm[v * 3 + 2] = part.n[v * 3 + 2];
      for (let k = 0; k < 4; k++) { si[v * 4 + k] = part.w[v * 8 + k * 2]; sw[v * 4 + k] = part.w[v * 8 + k * 2 + 1]; }
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    g.setAttribute('skinIndex', new BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    g.setAttribute('aSurf', new BufferAttribute(new Float32Array(part.a), 4));
  }
  // the cloth shaders sample in aRest: the bind pose, scaled so the weave is `grain` times finer
  const pos = g.getAttribute('position').array, rest = new Float32Array(nv * 3);
  for (let i = 0; i < rest.length; i++) rest[i] = pos[i] * grain;
  g.setAttribute('aRest', new BufferAttribute(rest, 3));
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(part.i.length);
  for (let t = 0; t < part.i.length; t += 3) { idx[t] = part.i[t]; idx[t + 1] = part.i[t + (mirror ? 2 : 1)]; idx[t + 2] = part.i[t + (mirror ? 1 : 2)]; }
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export class Arm {
  // side: +1 right, -1 left. The rig exists at once; the skin is attached later (see attach).
  constructor(side) {
    this.side = side;
    this.group = new Group();
    this.group.name = side > 0 ? 'armR' : 'armL';
    const rig = makeRig(side);
    this.rig = rig;
    this.bones = rig.bones; this.digits = rig.digits; this.forearm = rig.forearm; this.hand = rig.hand; this.cup = rig.cup;
    this.group.add(rig.forearm);
    applyPose(rig, BIND_POSE);
    this.group.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones); // bind = BIND_POSE
    this.meshes = [];
    this.geometry = {};
    this.pose = new Float32Array(POSE_SIZE);
    this.skinMats = Array.from({ length: BONE_COUNT }, () => new Matrix4());
    this.setPose(BIND_POSE);
  }

  // parts: buildArmParts() output (right-hand space; mirrored here for a left arm). materials by bucket.
  attach(parts, materials) {
    let shared = null;
    for (const [name, part] of Object.entries(parts)) {
      if (!part.triCount) continue;
      const geo = geometryFrom(part, this.side < 0, GRAIN[name] || 1, name === 'palm' ? shared : null);
      if (name === 'back') shared = geo;
      const mesh = new SkinnedMesh(geo, materials[name]);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.bind(this.skeleton, new Matrix4());
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.geometry[name] = geo;
    }
  }

  setPose(p) {
    if (p !== this.pose) this.pose.set(p);
    applyPose(this.rig, p);
  }

  // Put the wrist at `pos` with the hand oriented by `quat` (hand space -> the arm group's space);
  // the forearm runs from the wrist toward `elbow`.
  place(pos, quat, elbow) {
    _z.copy(elbow).sub(pos).normalize();
    _y.set(0, 1, 0).applyQuaternion(quat);
    _x.crossVectors(_y, _z);
    if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
    _x.normalize();
    _y.crossVectors(_z, _x);
    this.forearm.position.copy(pos);
    this.forearm.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    this.hand.quaternion.copy(this.forearm.quaternion).invert().multiply(quat);
  }

  // Digit joints and tip in the arm group's parent space (metres): [knuckle, joint, joint, tip].
  // Call after place()/setPose(); updates the bone matrices.
  joints(d, out) {
    this.group.updateMatrixWorld(true);
    const { D, bones } = this.digits[d];
    for (let i = 0; i < 3; i++) out[i].setFromMatrixPosition(bones[i].matrixWorld);
    out[3].set(0, 0, -D.L[2] * MM).applyMatrix4(bones[2].matrixWorld);
    return out;
  }
  // a point given in hand space (mm, right-hand convention) -> the arm group's parent space
  handPoint(x, y, z, out) {
    this.group.updateMatrixWorld(true);
    return out.set(x * this.side * MM, y * MM, z * MM).applyMatrix4(this.hand.matrixWorld);
  }

  // Skinning matrices for the current pose (bind space, metres -> the arm group's parent space).
  updateSkinMats() {
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < BONE_COUNT; i++) this.skinMats[i].multiplyMatrices(this.bones[i].matrixWorld, this.skeleton.boneInverses[i]);
    return this.skinMats;
  }
  // Skin one bind-space point (metres, this arm's own handedness) with weights [bone, w] x 4. Call
  // updateSkinMats() first.
  skinPoint(x, y, z, w, out) {
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const wt = w[k * 2 + 1];
      if (wt <= 0) continue;
      const e = this.skinMats[w[k * 2]].elements;
      ox += wt * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      oy += wt * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      oz += wt * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    return out.set(ox, oy, oz);
  }
  // Every vertex of one bucket in the current pose: fn(index, Vector3 position, Vector3 normal).
  eachSkinned(name, fn) {
    const g = this.geometry[name];
    if (!g) return;
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
    const w = [0, 0, 0, 0, 0, 0, 0, 0], p = new Vector3(), n = new Vector3(), o = new Vector3();
    this.updateSkinMats();
    for (let v = 0; v < pos.count; v++) {
      for (let k = 0; k < 4; k++) { w[k * 2] = si[v * 4 + k]; w[k * 2 + 1] = sw[v * 4 + k]; }
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      this.skinPoint(x, y, z, w, p);
      this.skinPoint(x + nrm.getX(v) * 1e-3, y + nrm.getY(v) * 1e-3, z + nrm.getZ(v) * 1e-3, w, o);
      n.copy(o).sub(p).normalize();
      fn(v, p, n);
    }
  }
}

// Hand orientation from landmarks: `back` points from the knuckles toward the wrist, `thumb` is the
// rough direction of the thumb side of the hand. Returns a quaternion (hand space -> caller's space).
export function handQuat(side, back, thumb, out = new Quaternion()) {
  _z.copy(back).normalize();
  _x.copy(thumb).multiplyScalar(-side);
  _x.addScaledVector(_z, -_x.dot(_z)).normalize();
  _y.crossVectors(_z, _x);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}
