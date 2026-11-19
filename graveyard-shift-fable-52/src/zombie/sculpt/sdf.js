// Signed-distance sculpt: a figure is an ordered list of primitives (ellipsoids, round cones, rounded
// boxes), each attached to a bone, joined by smooth union or cut by smooth subtraction. The same
// packed array is evaluated here in JS (shrink-wrapping the cages, skin weights, snapping wounds to
// the surface) and on the GPU by the bake (SDF_GLSL reads it from a float texture).
//
// A figure is mirror-symmetric: it is authored for x >= 0 (the figure's LEFT side) plus central
// primitives, and evaluated at |x|. Bones are named for the left side; weights for x < 0 are mapped
// through the mirror table by the caller.
//
// Packed layout, STRIDE floats per primitive:
//   0 type (0 ellipsoid, 1 round cone, 2 rounded box)   1 op (0 add, 1 subtract)   2 blend radius k
//   3 bone index     4..6 p0 (centre / cone end a)   7 r0 (cone radius at a / box rounding)
//   8..10 p1 (radii / cone end b / box half size)    11 r1 (cone radius at b)
//   12..14 rotation row 0   15 weight falloff (0 = takes no part in skin weights)
//   16..18 rotation row 1   19 group bits
//   20..22 bounding sphere centre   23 bounding sphere radius
export const STRIDE = 24;
export const ELL = 0, CONE = 1, BOX = 2;

const smin = (a, b, k) => { if (k <= 0) return a < b ? a : b; const h = Math.max(k - Math.abs(a - b), 0) / k; return (a < b ? a : b) - h * h * k * 0.25; };

export class Figure {
  constructor(boneIndex) {
    this.B = boneIndex;          // name -> index
    this.d = [];
    this.n = 0;
    this.data = null;
    this.fall = 0.05;            // default weight falloff (m)
    this.group = 1;
    this.marks = {};             // named landmarks other modules read (eye centres, mouth, finger axes, ...)
  }
  _push(type, op, k, bone, p0, r0, p1, r1, rot, fall, bc, br) {
    let m = [1, 0, 0, 0, 1, 0];
    if (rot) {
      // rotation taking rest space into the primitive's frame: Rx(rot[0]) Ry(rot[1]) Rz(rot[2]), inverted (transpose)
      const [ax, ay, az] = rot;
      const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
      // forward matrix M = Rz * Ry * Rx (columns are the primitive's axes in rest space)
      const m00 = cz * cy, m01 = cz * sy * sx - sz * cx, m02 = cz * sy * cx + sz * sx;
      const m10 = sz * cy, m11 = sz * sy * sx + cz * cx, m12 = sz * sy * cx - cz * sx;
      const m20 = -sy, m21 = cy * sx; // m22 = cy * cx
      // rows of the inverse = columns of M
      m = [m00, m10, m20, m01, m11, m21];
      void m02; void m12;
    }
    const bi = typeof bone === 'number' ? bone : this.B[bone];
    if (bi === undefined) throw new Error(`sdf: unknown bone ${bone}`);
    this.d.push(type, op, k, bi, p0[0], p0[1], p0[2], r0, p1[0], p1[1], p1[2], r1, m[0], m[1], m[2], fall ?? this.fall, m[3], m[4], m[5], this.group, bc[0], bc[1], bc[2], br);
    this.n++;
    this.data = null;
  }
  // o: { k (blend radius), sub (subtract), rot [x, y, z] radians, fall (weight falloff, 0 = none) }
  ell(bone, c, r, o = {}) { this._push(ELL, o.sub ? 1 : 0, o.k ?? 0.02, bone, c, 0, r, 0, o.rot, o.sub ? 0 : o.fall, c, Math.max(r[0], r[1], r[2])); return this; }
  cone(bone, a, b, ra, rb, o = {}) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const half = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2;
    this._push(CONE, o.sub ? 1 : 0, o.k ?? 0.02, bone, a, ra, b, rb, null, o.sub ? 0 : o.fall, mid, half + Math.max(ra, rb));
    return this;
  }
  box(bone, c, h, round, o = {}) { this._push(BOX, o.sub ? 1 : 0, o.k ?? 0.02, bone, c, round, h, 0, o.rot, o.sub ? 0 : o.fall, c, Math.hypot(h[0], h[1], h[2]) + round); return this; }
  pack() { if (!this.data) { this.data = new Float32Array(this.d); this.accel = null; } return this.data; }
}

function primDist(D, o, x, y, z) {
  const type = D[o];
  if (type === CONE) {
    const ax = D[o + 4], ay = D[o + 5], az = D[o + 6], r1 = D[o + 7], r2 = D[o + 11];
    const bax = D[o + 8] - ax, bay = D[o + 9] - ay, baz = D[o + 10] - az;
    const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  }
  const px = x - D[o + 4], py = y - D[o + 5], pz = z - D[o + 6];
  const r0x = D[o + 12], r0y = D[o + 13], r0z = D[o + 14], r1x = D[o + 16], r1y = D[o + 17], r1z = D[o + 18];
  const qx = r0x * px + r0y * py + r0z * pz, qy = r1x * px + r1y * py + r1z * pz;
  const qz = (r0y * r1z - r0z * r1y) * px + (r0z * r1x - r0x * r1z) * py + (r0x * r1y - r0y * r1x) * pz;
  if (type === ELL) {
    const rx = D[o + 8], ry = D[o + 9], rz = D[o + 10];
    const ux = qx / rx, uy = qy / ry, uz = qz / rz;
    const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (k0 < 1e-9) return -Math.min(rx, ry, rz);
    const vx = ux / rx, vy = uy / ry, vz = uz / rz;
    return (k0 * (k0 - 1)) / Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  const dx = Math.abs(qx) - D[o + 8], dy = Math.abs(qy) - D[o + 9], dz = Math.abs(qz) - D[o + 10];
  const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0, oz = dz > 0 ? dz : 0;
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0) - D[o + 7];
}

// A grid over the figure listing, per cell, the primitives that can matter there: those whose
// bounding sphere, grown by their blend radius and by MARGIN, reaches the cell. Within MARGIN of the
// surface the listed primitives give the exact distance; further out the value is capped at MARGIN,
// which is still a safe step for a ray march. Built once per figure (about a millisecond).
const CELL = 0.03, MARGIN = 0.03, X0 = 0, Y0 = -0.09, Z0 = -0.3, NX = 30, NY = 68, NZC = 22;
function accelOf(fig) {
  const D = fig.pack(), n = fig.n;
  const start = new Int32Array(NX * NY * NZC + 1);
  const each = (fn) => {
    for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
      const r = D[o + 23] + D[o + 2] + MARGIN + CELL * 0.87;
      const x0 = Math.max(0, Math.floor((D[o + 20] - r - X0) / CELL)), x1 = Math.min(NX - 1, Math.floor((D[o + 20] + r - X0) / CELL));
      const y0 = Math.max(0, Math.floor((D[o + 21] - r - Y0) / CELL)), y1 = Math.min(NY - 1, Math.floor((D[o + 21] + r - Y0) / CELL));
      const z0 = Math.max(0, Math.floor((D[o + 22] - r - Z0) / CELL)), z1 = Math.min(NZC - 1, Math.floor((D[o + 22] + r - Z0) / CELL));
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = X0 + (x + 0.5) * CELL - D[o + 20], cy = Y0 + (y + 0.5) * CELL - D[o + 21], cz = Z0 + (z + 0.5) * CELL - D[o + 22];
        if (cx * cx + cy * cy + cz * cz <= r * r) fn((z * NY + y) * NX + x, o);
      }
    }
  };
  each((c) => { start[c + 1]++; });
  for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c];
  const list = new Int32Array(start[start.length - 1]), fill = start.slice(0, -1);
  each((c, o) => { list[fill[c]++] = o; });
  return { start, list };
}

// distance to the figure's surface at a rest-space point (negative inside; exact within 3 cm of the
// surface, capped at 3 cm beyond). `groups`: only primitives with one of these group bits.
export function evaluate(fig, x, y, z, groups = -1) {
  const D = fig.data || fig.pack();
  const acc = fig.accel || (fig.accel = accelOf(fig));
  if (x < 0) x = -x;
  const ix = Math.floor((x - X0) / CELL), iy = Math.floor((y - Y0) / CELL), iz = Math.floor((z - Z0) / CELL);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZC) return MARGIN;
  const c = (iz * NY + iy) * NX + ix, list = acc.list;
  let d = 1e9;
  for (let k = acc.start[c], e = acc.start[c + 1]; k < e; k++) {
    const o = list[k];
    if (!(D[o + 19] & groups)) continue;
    const kk = D[o + 2];
    if (D[o + 1] === 0) d = smin(d, primDist(D, o, x, y, z), kk);
    else d = -smin(-d, primDist(D, o, x, y, z), kk);
  }
  return d > MARGIN ? MARGIN : d;
}

// unit gradient (outward normal) by central differences; writes out[0..2], returns the distance
export function gradient(fig, x, y, z, out, groups = -1, h = 0.0006) {
  const gx = evaluate(fig, x + h, y, z, groups) - evaluate(fig, x - h, y, z, groups);
  const gy = evaluate(fig, x, y + h, z, groups) - evaluate(fig, x, y - h, z, groups);
  const gz = evaluate(fig, x, y, z + h, groups) - evaluate(fig, x, y, z - h, groups);
  const l = Math.hypot(gx, gy, gz) || 1;
  out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  return evaluate(fig, x, y, z, groups);
}

// Move a point onto the zero level along the gradient (a few Newton steps). Writes p in place,
// returns the remaining |distance|.
const _g = [0, 0, 0];
export function project(fig, p, groups = -1, steps = 6) {
  let d = 0;
  for (let s = 0; s < steps; s++) {
    d = gradient(fig, p[0], p[1], p[2], _g, groups, 0.0004);
    if (Math.abs(d) < 2e-5) break;
    p[0] -= _g[0] * d; p[1] -= _g[1] * d; p[2] -= _g[2] * d;
  }
  return Math.abs(d);
}

// Skin weights at a point: each additive primitive pulls for its bone with a weight that falls off
// with the distance to that primitive; summed per bone, the four largest kept, normalised.
// Returns [[bone, w], ...]. `mirror` (Int array) maps bones when the point is on the x < 0 side.
export function weightsAt(fig, x, y, z, mirror, nb, groups = -1) {
  const D = fig.data || fig.pack(), n = fig.n;
  const neg = x < 0;
  if (neg) x = -x;
  const acc = new Float64Array(nb);
  for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
    const fall = D[o + 15];
    if (fall <= 0 || D[o + 1] !== 0 || !(D[o + 19] & groups)) continue;
    const bx = x - D[o + 20], by = y - D[o + 21], bz = z - D[o + 22];
    if (Math.sqrt(bx * bx + by * by + bz * bz) - D[o + 23] > fall) continue;
    const di = primDist(D, o, x, y, z);
    if (di >= fall) continue;
    const t = di <= 0 ? 1 : 1 - di / fall;
    acc[D[o + 3]] += t * t * (3 - 2 * t);
  }
  const out = [];
  for (let b = 0; b < nb; b++) if (acc[b] > 0) out.push([b, acc[b]]);
  out.sort((a, b) => b[1] - a[1]);
  if (out.length > 4) out.length = 4;
  if (!out.length) return null;
  let s = 0;
  for (const w of out) s += w[1];
  for (const w of out) { w[1] /= s; if (neg && mirror) w[0] = mirror[w[0]]; }
  return out;
}

// March along a ray and return the distance travelled to the surface, or -1.
//   outward (from inside): the first exit; steps by |d| so thin gaps are not jumped.
//   inward (from outside): the first hit.
export function march(fig, ox, oy, oz, dx, dy, dz, tMax, groups = -1, t0 = 0) {
  let t = t0;
  let d = evaluate(fig, ox + dx * t, oy + dy * t, oz + dz * t, groups);
  const inside = d < 0;
  for (let i = 0; i < 160 && t < tMax; i++) {
    const tn = Math.min(tMax, t + Math.max(Math.abs(d) * 0.8, 0.0012));
    const dn = evaluate(fig, ox + dx * tn, oy + dy * tn, oz + dz * tn, groups);
    if ((dn < 0) !== inside) {
      let a = t, b = tn;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        if ((evaluate(fig, ox + dx * m, oy + dy * m, oz + dz * m, groups) < 0) === inside) a = m; else b = m;
      }
      return (a + b) / 2;
    }
    t = tn; d = dn;
  }
  return -1;
}

// The same evaluator for the bake. tPrims: RGBA32F, 6 texels wide, one row per primitive.
export const SDF_GLSL = /* glsl */ `
uniform highp sampler2D tPrims;
uniform int uPrimN;
float sdSmin(float a, float b, float k) { if (k <= 0.0) return min(a, b); float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
// One exit with the result always assigned (Direct3D's compiler warns that early returns may leave it unset).
float sdPrim(int i, vec4 t0, vec3 p) {
  float res = 0.0;
  vec4 t1 = texelFetch(tPrims, ivec2(1, i), 0), t2 = texelFetch(tPrims, ivec2(2, i), 0);
  if (t0.x > 0.5 && t0.x < 1.5) {
    vec3 a = t1.xyz, ba = t2.xyz - a; float r1 = t1.w, r2 = t2.w;
    float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
    vec3 pa = p - a; float y = dot(pa, ba), z = y - l2;
    vec3 q = pa * l2 - ba * y; float x2 = dot(q, q), y2 = y * y * l2, z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) res = sqrt(x2 + z2) * il2 - r2;
    else if (sign(y) * a2 * y2 < k) res = sqrt(x2 + y2) * il2 - r1;
    else res = (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  } else {
    vec3 r0 = texelFetch(tPrims, ivec2(3, i), 0).xyz, r1v = texelFetch(tPrims, ivec2(4, i), 0).xyz;
    vec3 d = p - t1.xyz;
    vec3 q = vec3(dot(r0, d), dot(r1v, d), dot(cross(r0, r1v), d));
    if (t0.x < 0.5) {
      vec3 u = q / t2.xyz; float k0 = length(u);
      if (k0 < 1e-9) res = -min(t2.x, min(t2.y, t2.z));
      else res = k0 * (k0 - 1.0) / length(u / t2.xyz);
    } else {
      vec3 e = abs(q) - t2.xyz;
      res = length(max(e, 0.0)) + min(max(e.x, max(e.y, e.z)), 0.0) - t1.w;
    }
  }
  return res;
}
float sdFigure(vec3 p) {
  p.x = abs(p.x);
  float d = 1e9;
  for (int i = 0; i < uPrimN; i++) {
    vec4 b = texelFetch(tPrims, ivec2(5, i), 0);
    vec4 t0 = texelFetch(tPrims, ivec2(0, i), 0);
    float lb = length(p - b.xyz) - b.w;
    if (t0.y < 0.5) { if (lb > d + t0.z) continue; d = sdSmin(d, sdPrim(i, t0, p), t0.z); }
    else { if (lb > t0.z - d) continue; d = -sdSmin(-d, sdPrim(i, t0, p), t0.z); }
  }
  return d;
}
`;
