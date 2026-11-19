// The collapse. A dying zombie stops being animated and falls: fifteen points (hips, waist,
// shoulders, neck, head, elbows, wrists, knees, ankles) joined by the lengths of its own bones, under
// gravity, with the ground under them and the level's boxes around them. Nothing is keyed, so the
// knees give first, the trunk folds at the waist, the head and arms arrive last, and where it all
// ends depends on the shot that killed it, on what it was doing, on what it fell against, and on
// its seed: on its side, twisted, slumped against a pump, the legs fallen to one side.
//
// It is a body, not a rope: knees and elbows resist folding and cannot close past a limit, the
// thighs stay inside the range of a hip, the waist and neck bend only so far, and limbs are kept
// out of the trunk, the head and each other.
//
// Allocation-free after create(); a settled body costs nothing.
//
// Model space: the zombie's root at the origin, +z the way it faced, y up, ground at y = 0.
import { B } from './skeleton.js';
import { vRot } from './ik.js';

export const R = { hipL: 0, hipR: 1, waist: 2, shL: 3, shR: 4, neck: 5, head: 6, elbL: 7, handL: 8, elbR: 9, handR: 10, kneeL: 11, footL: 12, kneeR: 13, footR: 14 };
const N = 15;
// [radius on the ground, mass]
const BODY = [[0.1, 4], [0.1, 4], [0.105, 5], [0.08, 3], [0.08, 3], [0.06, 1.5], [0.1, 2.5], [0.05, 1], [0.055, 0.6], [0.05, 1], [0.055, 0.6], [0.065, 2], [0.06, 1], [0.065, 2], [0.06, 1]];
const PROP = 0.025;   // added to a point's radius against props: the clothes on it
// [a, b, stiffness, min (fraction of rest), max (fraction of rest)]  (stiffness 1 = a bone)
const LINKS = [
  [0, 1, 1], [0, 2, 1], [1, 2, 1],                                  // pelvis
  [3, 4, 1], [3, 5, 1], [4, 5, 1], [2, 3, 1], [2, 4, 1], [2, 5, 1],  // chest
  [0, 3, 0.3, 0.74, 1.05], [1, 4, 0.3, 0.74, 1.05], [0, 4, 0.25, 0.76, 1.07], [1, 3, 0.25, 0.76, 1.07],   // the waist bends and twists, within limits
  [5, 6, 1], [6, 3, 0.3, 0.76, 1.1], [6, 4, 0.3, 0.76, 1.1], [6, 2, 0.12, 0.86, 1.04],   // neck
  [3, 7, 1], [7, 8, 1], [4, 9, 1], [9, 10, 1],                       // arms
  [0, 11, 1], [11, 12, 1], [1, 13, 1], [13, 14, 1],                  // legs
];
// hinges: [root, joint, end, stiffness toward `open`, least and resting distance root-to-end as fractions of the straight limb]
const BEND = [[0, 11, 12, 0.012, 0.5, 0.9], [1, 13, 14, 0.012, 0.5, 0.9], [3, 7, 8, 0.01, 0.4, 0.84], [4, 9, 10, 0.01, 0.4, 0.84]];
// pairs that only push apart: [a, b, least distance in metres]
const APART = [[3, 8, 0.12], [4, 10, 0.12], [0, 12, 0.3], [1, 14, 0.3], [11, 13, 0.14], [12, 14, 0.11], [6, 8, 0.13], [6, 10, 0.13], [6, 11, 0.2], [6, 13, 0.2], [8, 10, 0.07]];
// limb segments kept apart from each other: [a0, a1, b0, b1, least distance between their axes]
const SEGS = [
  [11, 12, 13, 14, 0.115], [0, 11, 13, 14, 0.125], [1, 13, 11, 12, 0.125],                 // legs
  [7, 8, 0, 11, 0.105], [7, 8, 1, 13, 0.105], [9, 10, 0, 11, 0.105], [9, 10, 1, 13, 0.105],  // forearms on thighs
  [7, 8, 11, 12, 0.095], [7, 8, 13, 14, 0.095], [9, 10, 11, 12, 0.095], [9, 10, 13, 14, 0.095],   // forearms on shins
  [7, 8, 9, 10, 0.085], [7, 8, 4, 9, 0.09], [9, 10, 3, 7, 0.09],                           // arms on arms
];
// segments tested at their middle against props: [a, b, radius]
const MIDS = [[0, 11, 0.085], [11, 12, 0.065], [1, 13, 0.085], [13, 14, 0.065], [3, 7, 0.06], [7, 8, 0.05], [4, 9, 0.06], [9, 10, 0.05], [2, 5, 0.12], [0, 1, 0.11], [3, 4, 0.11], [5, 6, 0.07]];
const H = 1 / 120;
const MAXB = 24, BS = 17;   // a box: centre 3, axes 9, half sizes 3, bounding radius, stands on the ground
const REACH = 2.3;          // boxes farther than this from the root are not collected
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createRagdoll() {
  const p = new Float32Array(N * 3), q = new Float32Array(N * 3), rest = new Float32Array(LINKS.length), full = new Float32Array(BEND.length);
  const _v = new Float32Array(3), _n = new Float32Array(3);
  const bx = new Float32Array(MAXB * BS), bDist = new Float32Array(MAXB), seen = new Array(MAXB).fill(null), active = new Uint8Array(MAXB);
  let nBox = 0, nActive = 0;
  let t = 0, acc = 0, still = 0, pin = 0, settled = false;
  const pinP = new Float32Array(6);
  // per fall: when the wind-down begins (a thrown body is still in the air at 1.2 s), how slack the
  // knees and elbows are (1 = the original spring toward straight, 0 = none), the body's size (the
  // brute's radii), and the floor under each point (model space; 0 = the plane the root stands on)
  let calm = 1.2, slack = 1, size = 1, stepN = 0;
  const g = new Float32Array(N);
  let floorFn = null;

  function link(a, b, want, k, wa, wb) {
    const ax = a * 3, bxx = b * 3;
    const dx = p[bxx] - p[ax], dy = p[bxx + 1] - p[ax + 1], dz = p[bxx + 2] - p[ax + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const e = ((d - want) / d) * k, s = wa + wb;
    const fa = wb / s, fb = wa / s;     // the lighter end moves more
    p[ax] += dx * e * fa; p[ax + 1] += dy * e * fa; p[ax + 2] += dz * e * fa;
    p[bxx] -= dx * e * fb; p[bxx + 1] -= dy * e * fb; p[bxx + 2] -= dz * e * fb;
  }
  const dist = (a, b) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);

  // a knee only bends forward of the line from hip to ankle, as the pelvis sees forward
  function knee(hip, kn, ft, fx, fy, fz) {
    const k = kn * 3, h = hip * 3, f = ft * 3;
    const mx = p[k] - (p[h] + p[f]) * 0.5, my = p[k + 1] - (p[h + 1] + p[f + 1]) * 0.5, mz = p[k + 2] - (p[h + 2] + p[f + 2]) * 0.5;
    const d = mx * fx + my * fy + mz * fz;
    if (d < 0.01) {
      // the hip and the ankle give way the other way, by their masses: a bend, not a shove
      const c = (0.01 - d) * 0.6, ch = c * 0.3, cf = c * 0.8;
      p[k] += fx * c; p[k + 1] += fy * c; p[k + 2] += fz * c;
      p[h] -= fx * ch; p[h + 1] -= fy * ch; p[h + 2] -= fz * ch;
      p[f] -= fx * cf; p[f + 1] -= fy * cf; p[f + 2] -= fz * cf;
    }
  }
  // a thigh stays in the range of a hip: not across the other leg, not in the splits (both as the
  // distance from the knee to the other hip, so nothing is pushed without something pushing back),
  // and not far behind the pelvis (knee and waist forward, hip back: a bend, not a shove).
  // (fx, fy, fz): the pelvis's forward
  function hip(hp, other, kn, fx, fy, fz) {
    const h = hp * 3, k = kn * 3;
    const tx = p[k] - p[h], ty = p[k + 1] - p[h + 1], tz = p[k + 2] - p[h + 2];
    const L = Math.hypot(tx, ty, tz) || 1e-6, straight = Math.hypot(L, dist(hp, other)), d = dist(kn, other);
    if (d < straight * 0.93) link(kn, other, straight * 0.93, 0.5, 2, 4);
    else if (d > straight * 1.23) link(kn, other, straight * 1.23, 0.5, 2, 4);
    const tf = (tx * fx + ty * fy + tz * fz) / L;
    if (tf < -0.3) {
      const c = Math.min((-0.3 - tf) * L * 0.2, 0.008);
      p[k] += fx * c; p[k + 1] += fy * c; p[k + 2] += fz * c;
      p[6] += fx * c * 0.2; p[7] += fy * c * 0.2; p[8] += fz * c * 0.2;
      p[h] -= fx * c * 0.75; p[h + 1] -= fy * c * 0.75; p[h + 2] -= fz * c * 0.75;      // 2 + 5 * 0.2 = 4 * 0.75: no net push
    }
  }
  // a point stays out of a ball (the trunk, the head). The ball sits on points ra and rb (the same
  // point twice for the waist or the head) and they are pushed back by the masses, so a limb caught
  // under the body lifts the body instead of driving it across the ground
  function outOf(i, cx, cy, cz, rad, ra, rb) {
    const k = i * 3, dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz, d = Math.hypot(dx, dy, dz);
    if (d >= rad || d < 1e-5) return;
    const m = BODY[i][1], M = ra === rb ? BODY[ra][1] : BODY[ra][1] + BODY[rb][1];
    const s = ((rad - d) / d) * (M / (m + M)), w = -((rad - d) / d) * (m / (m + M)) * (ra === rb ? 1 : 0.5);
    p[k] += dx * s; p[k + 1] += dy * s; p[k + 2] += dz * s;
    const A = ra * 3, Bk = rb * 3;
    p[A] += dx * w; p[A + 1] += dy * w; p[A + 2] += dz * w;
    if (ra !== rb) { p[Bk] += dx * w; p[Bk + 1] += dy * w; p[Bk + 2] += dz * w; }
  }
  // a limb segment stays out of a ball: its nearest point is pushed clear, shared between the two ends
  function segOut(a, b, cx, cy, cz, rad, ra, rb) {
    const ak = a * 3, bk = b * 3;
    const dx = p[bk] - p[ak], dy = p[bk + 1] - p[ak + 1], dz = p[bk + 2] - p[ak + 2];
    const u = clamp(((cx - p[ak]) * dx + (cy - p[ak + 1]) * dy + (cz - p[ak + 2]) * dz) / (dx * dx + dy * dy + dz * dz || 1e-6), 0, 1);
    const ex = p[ak] + dx * u - cx, ey = p[ak + 1] + dy * u - cy, ez = p[ak + 2] + dz * u - cz, d = Math.hypot(ex, ey, ez);
    if (d >= rad || d < 1e-5) return;
    const ma = BODY[a][1], mb = BODY[b][1], M = ra === rb ? BODY[ra][1] : BODY[ra][1] + BODY[rb][1];
    const g = (rad - d) / d, s = (g * (M / (ma + mb + M))) / (u * u + (1 - u) * (1 - u)), sa = s * (1 - u), sb = s * u;
    p[ak] += ex * sa; p[ak + 1] += ey * sa; p[ak + 2] += ez * sa;
    p[bk] += ex * sb; p[bk + 1] += ey * sb; p[bk + 2] += ez * sb;
    // what the limb was given, taken from the trunk
    const w = -((sa * ma + sb * mb) / M) * (ra === rb ? 1 : 1);
    const A = ra * 3, Bk = rb * 3;
    if (ra === rb) { p[A] += ex * w; p[A + 1] += ey * w; p[A + 2] += ez * w; } else {
      p[A] += ex * w; p[A + 1] += ey * w; p[A + 2] += ez * w; p[Bk] += ex * w; p[Bk + 1] += ey * w; p[Bk + 2] += ez * w;
    }
  }
  // two limb segments stay a thickness apart (closest points of the two axes)
  function segApart(a0, a1, b0, b1, min) {
    const A0 = a0 * 3, A1 = a1 * 3, B0 = b0 * 3, B1 = b1 * 3;
    const d1x = p[A1] - p[A0], d1y = p[A1 + 1] - p[A0 + 1], d1z = p[A1 + 2] - p[A0 + 2];
    const d2x = p[B1] - p[B0], d2y = p[B1 + 1] - p[B0 + 1], d2z = p[B1 + 2] - p[B0 + 2];
    const rx = p[A0] - p[B0], ry = p[A0 + 1] - p[B0 + 1], rz = p[A0 + 2] - p[B0 + 2];
    const a = d1x * d1x + d1y * d1y + d1z * d1z || 1e-6, e = d2x * d2x + d2y * d2y + d2z * d2z || 1e-6;
    const f = d2x * rx + d2y * ry + d2z * rz, c = d1x * rx + d1y * ry + d1z * rz, b = d1x * d2x + d1y * d2y + d1z * d2z;
    const den = a * e - b * b;
    let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0.5;
    let u = (b * s + f) / e;
    if (u < 0) { u = 0; s = clamp(-c / a, 0, 1); } else if (u > 1) { u = 1; s = clamp((b - c) / a, 0, 1); }
    let nx = rx + d1x * s - d2x * u, ny = ry + d1y * s - d2y * u, nz = rz + d1z * s - d2z * u;
    let d = Math.hypot(nx, ny, nz);
    if (d >= min) return;
    if (d < 1e-4) { nx = 0; ny = 1; nz = 0; d = 1; }      // crossing exactly: the first goes over the second
    const g = ((min - d) * 0.3) / d;
    const wa = g / (s * s + (1 - s) * (1 - s)), wb = g / (u * u + (1 - u) * (1 - u));
    p[A0] += nx * wa * (1 - s); p[A0 + 1] += ny * wa * (1 - s); p[A0 + 2] += nz * wa * (1 - s);
    p[A1] += nx * wa * s; p[A1 + 1] += ny * wa * s; p[A1 + 2] += nz * wa * s;
    p[B0] -= nx * wb * (1 - u); p[B0 + 1] -= ny * wb * (1 - u); p[B0 + 2] -= nz * wb * (1 - u);
    p[B1] -= nx * wb * u; p[B1 + 1] -= ny * wb * u; p[B1 + 2] -= nz * wb * u;
  }

  // ---- props ---------------------------------------------------------------------------------
  // how deep a ball at (x, y, z) is in box o; the way out is left in _n. 0 = clear.
  function sep(x, y, z, r, o) {
    const dx = x - bx[o], dy = y - bx[o + 1], dz = z - bx[o + 2];
    const br = bx[o + 15] + r;
    if (dx * dx + dy * dy + dz * dz > br * br) return 0;
    const lx = dx * bx[o + 3] + dy * bx[o + 4] + dz * bx[o + 5], ly = dx * bx[o + 6] + dy * bx[o + 7] + dz * bx[o + 8], lz = dx * bx[o + 9] + dy * bx[o + 10] + dz * bx[o + 11];
    const ex = Math.abs(lx) - bx[o + 12], ey = Math.abs(ly) - bx[o + 13], ez = Math.abs(lz) - bx[o + 14];
    let nx = 0, ny = 0, nz = 0, depth;
    if (ex <= 0 && ey <= 0 && ez <= 0) {
      // inside: out through the nearest face, but never down through the bottom of a box that stands on the ground
      const eyc = ly < 0 && bx[o + 16] ? -1e9 : ey;
      if (ex >= eyc && ex >= ez) { nx = lx < 0 ? -1 : 1; depth = r - ex; } else if (eyc >= ez) { ny = ly < 0 ? -1 : 1; depth = r - ey; } else { nz = lz < 0 ? -1 : 1; depth = r - ez; }
    } else {
      const qx = ex > 0 ? (lx < 0 ? -ex : ex) : 0, qy = ey > 0 ? (ly < 0 ? -ey : ey) : 0, qz = ez > 0 ? (lz < 0 ? -ez : ez) : 0;
      const d = Math.hypot(qx, qy, qz);
      if (d >= r) return 0;
      nx = qx / d; ny = qy / d; nz = qz / d; depth = r - d;
    }
    _n[0] = nx * bx[o + 3] + ny * bx[o + 6] + nz * bx[o + 9]; _n[1] = nx * bx[o + 4] + ny * bx[o + 7] + nz * bx[o + 10]; _n[2] = nx * bx[o + 5] + ny * bx[o + 8] + nz * bx[o + 11];
    return depth;
  }
  // move point k out along _n by depth without giving it speed; stop it going in; let the surface drag it
  function shove(k, depth) {
    const sx = _n[0] * depth, sy = _n[1] * depth, sz = _n[2] * depth;
    p[k] += sx; p[k + 1] += sy; p[k + 2] += sz; q[k] += sx; q[k + 1] += sy; q[k + 2] += sz;
    const vn = (p[k] - q[k]) * _n[0] + (p[k + 1] - q[k + 1]) * _n[1] + (p[k + 2] - q[k + 2]) * _n[2];
    if (vn < 0) { q[k] += _n[0] * vn; q[k + 1] += _n[1] * vn; q[k + 2] += _n[2] * vn; }
    q[k] += (p[k] - q[k]) * 0.25; q[k + 1] += (p[k + 1] - q[k + 1]) * 0.25; q[k + 2] += (p[k + 2] - q[k + 2]) * 0.25;
  }
  function props() {
    for (let a = 0; a < nActive; a++) {
      const o = active[a] * BS;
      for (let i = 0; i < N; i++) {
        const k = i * 3, d = sep(p[k], p[k + 1], p[k + 2], BODY[i][0] + PROP, o);
        if (d > 0) shove(k, d);
      }
      for (let m = 0; m < MIDS.length; m++) {
        const M = MIDS[m], ka = M[0] * 3, kb = M[1] * 3;
        const d = sep((p[ka] + p[kb]) * 0.5, (p[ka + 1] + p[kb + 1]) * 0.5, (p[ka + 2] + p[kb + 2]) * 0.5, M[2] + PROP, o);
        if (d > 0) { const nx = _n[0], ny = _n[1], nz = _n[2]; shove(ka, d); _n[0] = nx; _n[1] = ny; _n[2] = nz; shove(kb, d); }
      }
    }
  }
  // boxes near enough to the body to matter this step
  function nearBoxes() {
    nActive = 0;
    if (!nBox) return;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < N * 3; i += 3) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
      if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2];
    }
    for (let b = 0; b < nBox; b++) {
      const o = b * BS, r = bx[o + 15] + 0.2;
      const dx = Math.max(x0 - bx[o], 0, bx[o] - x1), dy = Math.max(y0 - bx[o + 1], 0, bx[o + 1] - y1), dz = Math.max(z0 - bx[o + 2], 0, bx[o + 2] - z1);
      if (dx * dx + dy * dy + dz * dz < r * r) active[nActive++] = b;
    }
  }

  function step() {
    // verlet: carry each point on, with gravity and a little drag. Once the fall is over, whatever is
    // only creeping or trembling is damped hard (a falling limb is faster than that and is not), and the
    // drag grows, so the body comes to rest instead of twitching
    const drag = t < calm ? 0.992 : Math.max(0.95, 0.992 - (t - calm) * 0.06);
    const slow = t < calm - 0.4 ? 0 : (0.14 * H) ** 2;
    // the floor under each point (stairs, kerbs, a drop), asked for a few times a second
    if (floorFn && (stepN++ & 3) === 0) for (let i = 0; i < N; i++) g[i] = floorFn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    for (let i = 0; i < N * 3; i += 3) {
      let vx = p[i] - q[i], vy = p[i + 1] - q[i + 1], vz = p[i + 2] - q[i + 2];
      const k = vx * vx + vy * vy + vz * vz < slow ? 0.75 : drag;
      vx *= k; vy *= k; vz *= k;
      q[i] = p[i]; q[i + 1] = p[i + 1]; q[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy - 9.8 * H * H; p[i + 2] += vz;
    }
    nearBoxes();
    for (let it = 0; it < 6; it++) {
      for (let c = 0; c < LINKS.length; c++) {
        const L = LINKS[c], a = L[0], b = L[1];
        if (L[2] >= 1) link(a, b, rest[c], 1, BODY[a][1], BODY[b][1]);
        else {
          const d = dist(a, b);
          link(a, b, rest[c], L[2] * 0.35, BODY[a][1], BODY[b][1]);
          if (d < rest[c] * L[3]) link(a, b, rest[c] * L[3], 1, BODY[a][1], BODY[b][1]);
          else if (d > rest[c] * L[4]) link(a, b, rest[c] * L[4], 1, BODY[a][1], BODY[b][1]);
        }
      }
      // knees and elbows: a little spring toward nearly straight, and they cannot fold shut
      for (let c = 0; c < BEND.length; c++) {
        const J = BEND[c], a = J[0], b = J[2], d = dist(a, b);
        if (d < full[c] * J[4]) link(a, b, full[c] * J[4], 1, BODY[a][1], BODY[b][1]);
        else if (d < full[c] * J[5]) link(a, b, full[c] * J[5], J[3] * slack, BODY[a][1], BODY[b][1]);
      }
      for (let c = 0; c < APART.length; c++) { const A = APART[c]; if (dist(A[0], A[1]) < A[2]) link(A[0], A[1], A[2], 1, BODY[A[0]][1], BODY[A[1]][1]); }
      // pelvis left = right hip to left hip; forward = left crossed with the line up to the waist
      let ax = p[0] - p[3], ay = p[1] - p[4], az = p[2] - p[5];
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      const ux = p[6] - (p[0] + p[3]) * 0.5, uy = p[7] - (p[1] + p[4]) * 0.5, uz = p[8] - (p[2] + p[5]) * 0.5;
      let fx = ay * uz - az * uy, fy = az * ux - ax * uz, fz = ax * uy - ay * ux;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      knee(R.hipL, R.kneeL, R.footL, fx, fy, fz); knee(R.hipR, R.kneeR, R.footR, fx, fy, fz);
      hip(R.hipL, R.hipR, R.kneeL, fx, fy, fz); hip(R.hipR, R.hipL, R.kneeR, fx, fy, fz);
      // arms and shins stay out of the trunk (four balls up the spine) and the head
      const hx = (p[0] + p[3]) * 0.5, hy = (p[1] + p[4]) * 0.5, hz = (p[2] + p[5]) * 0.5;
      const cx = (p[9] + p[12]) * 0.5, cy = (p[10] + p[13]) * 0.5, cz = (p[11] + p[14]) * 0.5;
      const mx = (p[6] + cx) * 0.5, my = (p[7] + cy) * 0.5, mz = (p[8] + cz) * 0.5;
      const kx = R.head * 3;
      const HL = R.hipL, HR = R.hipR, W = R.waist, SL = R.shL, SR = R.shR, HD = R.head;
      for (let s = 0; s < 2; s++) {
        const e = s ? R.elbR : R.elbL, w = s ? R.handR : R.handL, kn = s ? R.kneeR : R.kneeL, ft = s ? R.footR : R.footL;
        outOf(e, hx, hy, hz, 0.14, HL, HR); outOf(e, p[6], p[7], p[8], 0.14, W, W); outOf(e, mx, my, mz, 0.145, W, W); outOf(e, cx, cy, cz, 0.15, SL, SR);
        segOut(e, w, hx, hy, hz, 0.135, HL, HR); segOut(e, w, p[6], p[7], p[8], 0.135, W, W); segOut(e, w, mx, my, mz, 0.14, W, W); segOut(e, w, cx, cy, cz, 0.145, SL, SR);
        segOut(e, w, p[kx], p[kx + 1], p[kx + 2], 0.13, HD, HD);
        segOut(kn, ft, p[6], p[7], p[8], 0.16, W, W); segOut(kn, ft, mx, my, mz, 0.17, W, W); segOut(kn, ft, cx, cy, cz, 0.18, SL, SR); segOut(kn, ft, p[kx], p[kx + 1], p[kx + 2], 0.16, HD, HD);
        outOf(kn, mx, my, mz, 0.2, W, W); outOf(kn, cx, cy, cz, 0.22, SL, SR);
      }
      for (let c = 0; c < SEGS.length; c++) { const S = SEGS[c]; segApart(S[0], S[1], S[2], S[3], S[4]); }
      // props, then the ground: nothing goes through either, and what touches drags
      if (nActive && it >= 2) props();
      for (let i = 0; i < N; i++) {
        const k = i * 3, r = BODY[i][0] * size + g[i];
        if (p[k + 1] < r) {
          p[k + 1] = r;
          q[k] += (p[k] - q[k]) * 0.35; q[k + 2] += (p[k + 2] - q[k + 2]) * 0.35;
          if (q[k + 1] < r) q[k + 1] += (r - q[k + 1]) * 0.6;       // hardly any bounce
        }
      }
      // for the first moment the feet stay where they were planted, so the legs fold over them
      if (pin > 0) for (let n = 0; n < 2; n++) { const k = (n ? R.footR : R.footL) * 3; p[k] = pinP[n * 3]; p[k + 1] = pinP[n * 3 + 1]; p[k + 2] = pinP[n * 3 + 2]; }
    }
    // the last of it: from 1.2 s the speed anything may still have is wound down to nothing by 1.9 s,
    // so a body wedged against something where its limits cannot all be met lies still instead of squirming
    if (t > calm) {
      const u = clamp((t - calm) / 0.7, 0, 1), cap = 4 * (1 - u * u * (3 - 2 * u)) * H;
      for (let i = 0; i < N * 3; i += 3) {
        const vx = p[i] - q[i], vy = p[i + 1] - q[i + 1], vz = p[i + 2] - q[i + 2], v = Math.hypot(vx, vy, vz);
        if (v > cap) { const k = cap / v; p[i] = q[i] + vx * k; p[i + 1] = q[i + 1] + vy * k; p[i + 2] = q[i + 2] + vz * k; }
      }
    }
  }

  return {
    p, R, ground: g,
    get settled() { return settled; },
    // floor(x, y, z) -> height of the floor under a point (model space), or null for the flat plane
    set floor(fn) { floorFn = fn || null; if (!floorFn) g.fill(0); },
    // an instant change of a point's velocity (m/s), for what a dying body still does: the second
    // knee giving, the trunk twisting, the head dropping
    // put the wind-down off (the body was found propped up and has been tipped over)
    extend(sec) { calm = Math.min(calm + sec, 3.2); still = 0; },
    kick(i, vx, vy, vz) { const k = i * 3; q[k] -= vx * H; q[k + 1] -= vy * H; q[k + 2] -= vz * H; },
    get time() { return t; },
    get boxes() { return nBox; },
    // Collect what the body can fall against. colliders: the level's boxes ({ min, max } in world
    // space; a box with `obb` { c, ax, ay, az, half } is a slice of a rotated prop and the oriented
    // box is used, once). (rx, ry, rz, yaw): the zombie's root. Call before start(); with nothing
    // collected the body falls on the ground plane alone.
    world(colliders, rx, ry, rz, yaw) {
      nBox = 0;
      if (!colliders) return 0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let n = 0; n < colliders.length; n++) {
        const b = colliders[n];
        if (!b || !b.min || !b.max) continue;
        if (b.max[1] < ry + 0.03 || b.min[1] > ry + 2.1) continue;
        const dx = Math.max(b.min[0] - rx, 0, rx - b.max[0]), dz = Math.max(b.min[2] - rz, 0, rz - b.max[2]), d = Math.hypot(dx, dz);
        if (d > REACH) continue;
        const ob = b.obb || null;
        let slot = -1;
        if (ob) {
          for (let k = 0; k < nBox; k++) if (seen[k] === ob) { slot = k; break; }
          if (slot >= 0) { if (d < bDist[slot]) bDist[slot] = d; continue; }
        }
        if (nBox < MAXB) slot = nBox++;
        else {
          // full: the farthest one collected makes way for a nearer one
          let far = 0;
          for (let k = 1; k < MAXB; k++) if (bDist[k] > bDist[far]) far = k;
          if (bDist[far] <= d) continue;
          slot = far;
        }
        seen[slot] = ob; bDist[slot] = d;
        const o = slot * BS;
        const wx = ob ? ob.c[0] : (b.min[0] + b.max[0]) * 0.5, wy = ob ? ob.c[1] : (b.min[1] + b.max[1]) * 0.5, wz = ob ? ob.c[2] : (b.min[2] + b.max[2]) * 0.5;
        bx[o] = (wx - rx) * cy - (wz - rz) * sy; bx[o + 1] = wy - ry; bx[o + 2] = (wx - rx) * sy + (wz - rz) * cy;
        for (let a = 0; a < 3; a++) {
          const ux = ob ? (a === 0 ? ob.ax : a === 1 ? ob.ay : ob.az)[0] : a === 0 ? 1 : 0, uy = ob ? (a === 0 ? ob.ax : a === 1 ? ob.ay : ob.az)[1] : a === 1 ? 1 : 0, uz = ob ? (a === 0 ? ob.ax : a === 1 ? ob.ay : ob.az)[2] : a === 2 ? 1 : 0;
          bx[o + 3 + a * 3] = ux * cy - uz * sy; bx[o + 4 + a * 3] = uy; bx[o + 5 + a * 3] = ux * sy + uz * cy;
          bx[o + 12 + a] = ob ? ob.half[a] : (b.max[a] - b.min[a]) * 0.5;
        }
        bx[o + 15] = Math.hypot(bx[o + 12], bx[o + 13], bx[o + 14]);
        bx[o + 16] = bx[o + 7] > 0.9 && bx[o + 1] - bx[o + 13] < 0.3 ? 1 : 0;
      }
      for (let k = 0; k < MAXB; k++) seen[k] = null;
      return nBox;
    },
    // distance along (dx, 0, dz) (unit, model space) from (ox, oy, oz) to the first collected box, or `max`
    ray(ox, oy, oz, dx, dz, max) {
      let best = max;
      for (let b = 0; b < nBox; b++) {
        const o = b * BS;
        const rx = ox - bx[o], ry = oy - bx[o + 1], rz = oz - bx[o + 2];
        let t0 = -1e9, t1 = best, miss = false;
        for (let a = 0; a < 3 && !miss; a++) {
          const k = o + 3 + a * 3, lo = rx * bx[k] + ry * bx[k + 1] + rz * bx[k + 2], ld = dx * bx[k] + dz * bx[k + 2], h = bx[o + 12 + a];
          if (Math.abs(ld) < 1e-9) { if (Math.abs(lo) > h) miss = true; continue; }
          let ta = (-h - lo) / ld, tb = (h - lo) / ld;
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) miss = true;
        }
        if (!miss && t0 >= 0 && t0 < best) best = t0;
      }
      return best;
    },
    // wp / wq: model-space joint positions and rotations of the live pose. vel(i, out): starting
    // velocity of point i in m/s. pinTime: seconds the feet stay planted.
    start(wp, wq, vel, pinTime, opts) {
      calm = (opts && opts.calm) || 1.2; slack = opts && opts.slack !== undefined ? opts.slack : 1; size = (opts && opts.size) || 1; stepN = 0;
      if (floorFn) for (let i = 0; i < N; i++) { const j0 = i * 3; g[i] = 0; void j0; }
      const J = [B.thighL, B.thighR, B.spine1, B.upperArmL, B.upperArmR, B.neck, B.head, B.foreArmL, B.handL, B.foreArmR, B.handR, B.shinL, B.footL, B.shinR, B.footR];
      for (let i = 0; i < N; i++) {
        const j = J[i] * 3;
        p[i * 3] = wp[j]; p[i * 3 + 1] = Math.max(wp[j + 1], BODY[i][0] * size); p[i * 3 + 2] = wp[j + 2];
      }
      vRot(_v, wq, B.head * 4, 0, 0.09, 0.012);
      p[R.head * 3] += _v[0]; p[R.head * 3 + 1] += _v[1]; p[R.head * 3 + 2] += _v[2];
      for (let c = 0; c < LINKS.length; c++) rest[c] = dist(LINKS[c][0], LINKS[c][1]);
      for (let c = 0; c < BEND.length; c++) full[c] = dist(BEND[c][0], BEND[c][1]) + dist(BEND[c][1], BEND[c][2]);
      for (let i = 0; i < N; i++) {
        vel(i, _v);
        q[i * 3] = p[i * 3] - _v[0] * H; q[i * 3 + 1] = p[i * 3 + 1] - _v[1] * H; q[i * 3 + 2] = p[i * 3 + 2] - _v[2] * H;
      }
      for (let n = 0; n < 2; n++) { const k = (n ? R.footR : R.footL) * 3; pinP[n * 3] = p[k]; pinP[n * 3 + 1] = p[k + 1]; pinP[n * 3 + 2] = p[k + 2]; }
      t = 0; acc = 0; still = 0; pin = pinTime; settled = false;
    },
    update(dt) {
      if (settled) return;
      acc += Math.min(dt, 0.05);
      while (acc >= H) {
        acc -= H; t += H; pin -= H;
        step();
      }
      let m = 0;
      for (let i = 0; i < N * 3; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
      still = m < 0.0006 ? still + dt : 0;        // under about 7 cm/s everywhere
      if ((t > calm - 0.4 && still > 0.3) || t > calm + 1.1) settled = true;
    },
  };
}
