// Small allocation-free quaternion helpers and the two-bone IK used for all four limbs.
// Quaternions and vectors live in flat arrays; every function takes (array, offset) pairs.

export function qEuler(out, o, pitch, yaw, roll) {
  // yaw (Y) then pitch (X) then roll (Z), applied in the parent's frame: q = qY * qX * qZ
  const cx = Math.cos(pitch * 0.5), sx = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cz = Math.cos(roll * 0.5), sz = Math.sin(roll * 0.5);
  out[o] = cy * sx * cz + sy * cx * sz;
  out[o + 1] = sy * cx * cz - cy * sx * sz;
  out[o + 2] = cy * cx * sz - sy * sx * cz;
  out[o + 3] = cy * cx * cz + sy * sx * sz;
}

export function qMul(out, o, a, ao, b, bo) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// out = conj(a) * b : b expressed in a's frame
export function qInvMul(out, o, a, ao, b, bo) {
  const ax = -a[ao], ay = -a[ao + 1], az = -a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

export function vRot(out, q, qo, x, y, z) {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
}

// quaternion of the frame whose columns are the given unit axes
export function qBasis(out, o, xx, xy, xz, yx, yy, yz, zx, zy, zz) {
  const tr = xx + yy + zz;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    out[o + 3] = 0.25 / s; out[o] = (yz - zy) * s; out[o + 1] = (zx - xz) * s; out[o + 2] = (xy - yx) * s;
  } else if (xx > yy && xx > zz) {
    const s = 2 * Math.sqrt(1 + xx - yy - zz);
    out[o + 3] = (yz - zy) / s; out[o] = 0.25 * s; out[o + 1] = (yx + xy) / s; out[o + 2] = (zx + xz) / s;
  } else if (yy > zz) {
    const s = 2 * Math.sqrt(1 + yy - xx - zz);
    out[o + 3] = (zx - xz) / s; out[o] = (yx + xy) / s; out[o + 1] = 0.25 * s; out[o + 2] = (zy + yz) / s;
  } else {
    const s = 2 * Math.sqrt(1 + zz - xx - yy);
    out[o + 3] = (xy - yx) / s; out[o] = (zx + xz) / s; out[o + 1] = (zy + yz) / s; out[o + 2] = 0.25 * s;
  }
}

// rotation taking unit vector a to unit vector b (shortest arc)
export function qFromTo(out, o, ax, ay, az, bx, by, bz) {
  const d = ax * bx + ay * by + az * bz;
  if (d < -0.999999) { out[o] = 1; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const w = 1 + d;
  const l = Math.hypot(cx, cy, cz, w);
  out[o] = cx / l; out[o + 1] = cy / l; out[o + 2] = cz / l; out[o + 3] = w / l;
}

// A limb bone hangs along -Y at rest with its front on +Z. Orient it so -Y runs along (dx,dy,dz)
// (unit) and +Z leans toward the front hint (fx,fy,fz).
function aimBone(out, o, dx, dy, dz, fx, fy, fz) {
  const k = fx * dx + fy * dy + fz * dz;
  let zx = fx - dx * k, zy = fy - dy * k, zz = fz - dz * k;
  let l = Math.hypot(zx, zy, zz);
  if (l < 1e-5) { zx = 1 - dx * dx; zy = -dx * dy; zz = -dx * dz; l = Math.hypot(zx, zy, zz) || 1; }
  zx /= l; zy /= l; zz /= l;
  const yx = -dx, yy = -dy, yz = -dz;
  // x = y cross z
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  qBasis(out, o, xx, xy, xz, yx, yy, yz, zx, zy, zz);
}

const _t = new Float32Array(8);
export const ikMid = new Float32Array(3); // middle joint position of the last solve

// Two-bone IK in model space. A: root joint, T: target for the end joint, l1/l2: bone lengths,
// (bx,by,bz): which way the middle joint should go, front: +1 if the limb's front faces the bend
// (knees), -1 if it faces away (elbows). corr: per-bone rest-direction corrections (offset co1/co2).
// (cx,cy,cz): a second bend direction, blended in as the first comes into line with the limb, so
// the joint never flips when the two are parallel.
// Writes model-space rotations for both bones. Returns the reach actually used.
export function ik2(q1, o1, q2, o2, ax, ay, az, tx, ty, tz, l1, l2, bx, by, bz, front, corr, co1, co2, cx = 0, cy = 0, cz = 0) {
  let nx = tx - ax, ny = ty - ay, nz = tz - az;
  let D = Math.hypot(nx, ny, nz);
  if (D < 1e-5) { nx = 0; ny = -1; nz = 0; D = 1e-5; }
  nx /= D; ny /= D; nz /= D;
  const reach = Math.min(Math.max(D, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.9995);
  const ca = Math.min(1, Math.max(-1, (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach)));
  const sa = Math.sqrt(1 - ca * ca);
  // bend direction perpendicular to the root->target line
  const k = bx * nx + by * ny + bz * nz;
  let px = bx - nx * k, py = by - ny * k, pz = bz - nz * k;
  let pl = Math.hypot(px, py, pz);
  const bl = Math.hypot(bx, by, bz) || 1;
  if (pl < 0.3 * bl) {
    // nearly parallel: lean on the second direction (or, with none given, any perpendicular)
    const k2 = cx * nx + cy * ny + cz * nz;
    let qx = cx - nx * k2, qy = cy - ny * k2, qz = cz - nz * k2;
    let ql = Math.hypot(qx, qy, qz);
    if (ql < 1e-5) { qx = nz; qy = 0; qz = -nx; ql = Math.hypot(qx, qy, qz); if (ql < 1e-5) { qx = 1; qy = 0; qz = 0; ql = 1; } }
    const w = pl / (0.3 * bl);
    px = (px / (pl || 1)) * w + (qx / ql) * (1 - w); py = (py / (pl || 1)) * w + (qy / ql) * (1 - w); pz = (pz / (pl || 1)) * w + (qz / ql) * (1 - w);
    pl = Math.hypot(px, py, pz) || 1;
  }
  px /= pl; py /= pl; pz /= pl;
  const d1x = nx * ca + px * sa, d1y = ny * ca + py * sa, d1z = nz * ca + pz * sa;
  const mx = ax + d1x * l1, my = ay + d1y * l1, mz = az + d1z * l1;
  ikMid[0] = mx; ikMid[1] = my; ikMid[2] = mz;
  let d2x = ax + nx * reach - mx, d2y = ay + ny * reach - my, d2z = az + nz * reach - mz;
  const d2l = Math.hypot(d2x, d2y, d2z) || 1;
  d2x /= d2l; d2y /= d2l; d2z /= d2l;
  aimBone(_t, 0, d1x, d1y, d1z, px * front, py * front, pz * front);
  qMul(q1, o1, _t, 0, corr, co1);
  aimBone(_t, 4, d2x, d2y, d2z, px * front, py * front, pz * front);
  qMul(q2, o2, _t, 4, corr, co2);
  return reach;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
// critically damped approach of x toward target; returns the new value (state: [x, v] at offset o)
export function springTo(s, o, target, omega, zeta, dt) {
  const x = s[o], v = s[o + 1];
  const a = -omega * omega * (x - target) - 2 * zeta * omega * v;
  s[o + 1] = v + a * dt;
  s[o] = x + s[o + 1] * dt;
  return s[o];
}
