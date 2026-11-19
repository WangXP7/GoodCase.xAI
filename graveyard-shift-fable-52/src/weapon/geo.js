// Geometry toolkit for the viewmodel: everything is built from code as triangle soups, authored in
// millimetres, and turned into BufferGeometry in metres. The one idea that makes hard-surface parts
// read as machined is in weightedNormals(): every edge carries a bevel, and vertex normals are
// weighted by the area of the flat region a face belongs to, so big faces stay flat and the bevel
// strip rolls from one face normal to the next and catches a highlight.
import { BufferGeometry, BufferAttribute, ShapeUtils, Vector2, Vector3, Matrix4, Group, Mesh } from 'three';

const WELD = 2e3; // weld grid: 1/WELD authoring units (0.5 micron in mm)

export class Soup {
  constructor() { this.p = []; this.u = []; }
  get triCount() { return this.p.length / 9; }
  tri(a, b, c, user = null) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.u.push(user, user, user);
    return this;
  }
  quad(a, b, c, d, user = null) { return this.tri(a, b, c, user).tri(a, c, d, user); }
  // per-vertex user values (skin weights on the hands)
  triv(a, b, c, ua, ub, uc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.u.push(ua, ub, uc);
    return this;
  }
  quadv(a, b, c, d, ua, ub, uc, ud) { return this.triv(a, b, c, ua, ub, uc).triv(a, c, d, ua, uc, ud); }
  // Append another soup, optionally through a Matrix4 (winding is fixed for mirroring matrices).
  add(o, m = null) {
    if (!m) { for (let i = 0; i < o.p.length; i++) this.p.push(o.p[i]); for (const u of o.u) this.u.push(u); return this; }
    const flip = m.determinant() < 0;
    const v = new Vector3();
    const n = o.p.length / 9;
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 3; c++) {
        const k = flip ? [0, 2, 1][c] : c;
        v.set(o.p[t * 9 + k * 3], o.p[t * 9 + k * 3 + 1], o.p[t * 9 + k * 3 + 2]).applyMatrix4(m);
        this.p.push(v.x, v.y, v.z);
        this.u.push(o.u[t * 3 + k]);
      }
    }
    return this;
  }
  xf(m) { const s = new Soup().add(this, m); this.p = s.p; this.u = s.u; return this; }
  move(x, y, z) { for (let i = 0; i < this.p.length; i += 3) { this.p[i] += x; this.p[i + 1] += y; this.p[i + 2] += z; } return this; }
  mirrorX() { return new Soup().add(this, new Matrix4().makeScale(-1, 1, 1)); }
  tag(user) { this.u.fill(user); return this; }
  clone() { const s = new Soup(); s.p = this.p.slice(); s.u = this.u.slice(); return s; }

  // -> BufferGeometry (non-indexed) with position and normal, in metres by default. The soup's
  // per-vertex user values stay in soup.u in the same vertex order (degenerate triangles removed).
  toGeometry({ scale = 0.001, crease = 55 } = {}) {
    this.dropDegenerate();
    const pos = new Float32Array(this.p);
    const nrm = weightedNormals(pos, crease);
    if (scale !== 1) for (let i = 0; i < pos.length; i++) pos[i] *= scale;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    return g;
  }
  dropDegenerate() {
    const p = this.p; const out = []; const ou = [];
    for (let t = 0; t < p.length; t += 9) {
      const ax = p[t + 3] - p[t], ay = p[t + 4] - p[t + 1], az = p[t + 5] - p[t + 2];
      const bx = p[t + 6] - p[t], by = p[t + 7] - p[t + 1], bz = p[t + 8] - p[t + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
      for (let i = 0; i < 9; i++) out.push(p[t + i]);
      ou.push(this.u[t / 3], this.u[t / 3 + 1], this.u[t / 3 + 2]);
    }
    this.p = out; this.u = ou;
    return this;
  }
}

// Per-corner normals. Faces that meet at a welded vertex within `creaseDeg` of each other are
// averaged; each flat region (edge-connected coplanar faces) counts once, weighted by area^1.5.
export function weightedNormals(p, creaseDeg = 55) {
  const nT = p.length / 9;
  const vid = new Int32Array(nT * 3);
  const map = new Map();
  let nv = 0;
  for (let i = 0; i < nT * 3; i++) {
    const k = `${Math.round(p[i * 3] * WELD)},${Math.round(p[i * 3 + 1] * WELD)},${Math.round(p[i * 3 + 2] * WELD)}`;
    let id = map.get(k);
    if (id === undefined) { id = nv++; map.set(k, id); }
    vid[i] = id;
  }
  const fn = new Float32Array(nT * 3);
  const area = new Float32Array(nT);
  for (let t = 0; t < nT; t++) {
    const o = t * 9;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const l = Math.hypot(cx, cy, cz);
    area[t] = l * 0.5;
    if (l > 1e-12) { fn[t * 3] = cx / l; fn[t * 3 + 1] = cy / l; fn[t * 3 + 2] = cz / l; }
  }
  // flat regions by union-find over shared edges
  const parent = new Int32Array(nT);
  for (let t = 0; t < nT; t++) parent[t] = t;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const edges = new Map();
  for (let t = 0; t < nT; t++) {
    for (let c = 0; c < 3; c++) {
      const a = vid[t * 3 + c], b = vid[t * 3 + (c + 1) % 3];
      const k = a < b ? a * nv + b : b * nv + a;
      const o = edges.get(k);
      if (o === undefined) { edges.set(k, t); continue; }
      const d = fn[o * 3] * fn[t * 3] + fn[o * 3 + 1] * fn[t * 3 + 1] + fn[o * 3 + 2] * fn[t * 3 + 2];
      if (d > 0.9995) { const ra = find(o), rb = find(t); if (ra !== rb) parent[ra] = rb; }
    }
  }
  const rArea = new Float32Array(nT);
  for (let t = 0; t < nT; t++) rArea[find(t)] += area[t];
  // vertex -> faces
  const start = new Int32Array(nv + 1);
  for (let i = 0; i < nT * 3; i++) start[vid[i] + 1]++;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nv);
  const vf = new Int32Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let c = 0; c < 3; c++) vf[fill[vid[t * 3 + c]]++] = t;

  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(nT * 9);
  const seen = [];
  for (let t = 0; t < nT; t++) {
    const nx = fn[t * 3], ny = fn[t * 3 + 1], nz = fn[t * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = vid[t * 3 + c];
      let sx = 0, sy = 0, sz = 0;
      seen.length = 0;
      for (let k = start[v]; k < start[v + 1]; k++) {
        const g = vf[k];
        if (area[g] < 1e-12) continue;
        const d = fn[g * 3] * nx + fn[g * 3 + 1] * ny + fn[g * 3 + 2] * nz;
        if (d < cosC) continue;
        const r = find(g);
        if (seen.includes(r)) continue;
        seen.push(r);
        const w = Math.pow(rArea[r], 1.5);
        sx += fn[g * 3] * w; sy += fn[g * 3 + 1] * w; sz += fn[g * 3 + 2] * w;
      }
      const l = Math.hypot(sx, sy, sz);
      const o = t * 9 + c * 3;
      if (l > 1e-20) { out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l; } else { out[o] = nx; out[o + 1] = ny; out[o + 2] = nz; }
    }
  }
  return out;
}

// ---- 2D outlines ---------------------------------------------------------------------------------

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Closed outline with rounded or chamfered corners. Each point is [u, v, r?, n?]: r is the corner
// radius, n the number of arc segments (1 = a straight chamfer; default from the turn angle).
// Extra entries after n are kept on the generated points as point[2] (a per-vertex tag).
export function outline(pts) {
  const out = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const P = pts[i], A = pts[(i + N - 1) % N], B = pts[(i + 1) % N];
    const r = P[2] || 0;
    const tagv = P[4];
    if (r <= 0) { out.push([P[0], P[1], tagv]); continue; }
    let ax = A[0] - P[0], ay = A[1] - P[1], bx = B[0] - P[0], by = B[1] - P[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const cosPhi = Math.max(-1, Math.min(1, ax * bx + ay * by));
    const phi = Math.acos(cosPhi); // interior angle at the corner
    if (phi > Math.PI - 0.02) { out.push([P[0], P[1], tagv]); continue; }
    let t = r / Math.tan(phi / 2);
    const tMax = 0.48 * Math.min(la, lb);
    if (t > tMax) t = tMax;
    const rr = t * Math.tan(phi / 2);
    const turn = Math.PI - phi;
    const n = P[3] || Math.max(2, Math.ceil(turn / 0.35));
    const p0 = [P[0] + ax * t, P[1] + ay * t], p1 = [P[0] + bx * t, P[1] + by * t];
    if (n === 1) { out.push([p0[0], p0[1], tagv], [p1[0], p1[1], tagv]); continue; }
    let mx = ax + bx, my = ay + by;
    const lm = Math.hypot(mx, my); mx /= lm; my /= lm;
    const dc = rr / Math.sin(phi / 2);
    const cx = P[0] + mx * dc, cy = P[1] + my * dc;
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    let a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= n; k++) { const a = a0 + (da * k) / n; out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, tagv]); }
  }
  return out;
}

export function circle(cx, cy, r, n = 24, a0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

function clean(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = out.length ? out[out.length - 1] : pts[pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5 || !out.length) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-5) out.pop();
  return out;
}

// Miter vectors: adding d * miter[i] to point i moves every edge d to the LEFT of its direction
// (inward for a counter-clockwise outline, outward for a clockwise hole).
function miters(pts) {
  const N = pts.length; const out = [];
  for (let i = 0; i < N; i++) {
    const P = pts[i], A = pts[(i + N - 1) % N], B = pts[(i + 1) % N];
    let e1x = P[0] - A[0], e1y = P[1] - A[1], e2x = B[0] - P[0], e2y = B[1] - P[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    let mx = -e1y - e2y, my = e1x + e2x;
    const l = mx * mx + my * my;
    if (l < 1e-6) { out.push([-e1y, e1x]); continue; }
    const k = Math.min(2 / l, 2.5);
    out.push([mx * k, my * k]);
  }
  return out;
}

const MAPS = {
  xyz: [(u, v, w) => [u, v, w], false],
  zyx: [(u, v, w) => [w, v, u], true], // side profile (u = z, v = y) extruded along x
  xzy: [(u, v, w) => [u, w, v], true], // plan profile (u = x, v = z) extruded along y
  yzx: [(u, v, w) => [w, u, v], false], // lathe axis along x
  zxy: [(u, v, w) => [v, w, u], false], // lathe axis along y
  yxz: [(u, v, w) => [v, u, w], true],
};

// Extrude a 2D outline from w0 to w1 with a bevel at each end.
// opts: holes [[...]], b0 / b1 bevel size at the w0 / w1 end (0 = square end), segs (1 = chamfer),
//   f0 / f1: per-vertex bevel factor for the outer outline at each end, as fn(point, index) -> 0..n
//   (0 leaves that vertex unbevelled: used where a part butts against its neighbour),
//   hb: bevel factor for holes (default 1), map: axis mapping name (see MAPS), user: vertex tag.
export function prism(contourIn, w0, w1, opts = {}) {
  const { holes = [], b0 = 0, b1 = 0, segs = 1, f0 = null, f1 = null, hb = 1, map = 'xyz', user = null, cap0 = true, cap1 = true } = opts;
  let contour = clean(contourIn);
  if (signedArea(contour) < 0) contour = contour.slice().reverse();
  const loops = [contour];
  for (const h of holes) { let hh = clean(h); if (signedArea(hh) > 0) hh = hh.slice().reverse(); loops.push(hh); }
  const mit = loops.map(miters);
  const fac0 = loops.map((L, li) => L.map((pt, i) => (li === 0 ? (f0 ? f0(pt, i) : 1) : hb)));
  const fac1 = loops.map((L, li) => L.map((pt, i) => (li === 0 ? (f1 ? f1(pt, i) : 1) : hb)));

  // rings: { inset, dw, end } from the w0 cap to the w1 cap
  const rings = [];
  if (b0 > 0) for (let j = 0; j <= segs; j++) { const a = (j / segs) * Math.PI / 2; rings.push({ inset: b0 * (1 - Math.sin(a)), dw: b0 * (1 - Math.cos(a)), end: 0 }); }
  else rings.push({ inset: 0, dw: 0, end: 0 });
  if (b1 > 0) for (let j = segs; j >= 0; j--) { const a = (j / segs) * Math.PI / 2; rings.push({ inset: b1 * (1 - Math.sin(a)), dw: b1 * (1 - Math.cos(a)), end: 1 }); }
  else rings.push({ inset: 0, dw: 0, end: 1 });

  const ringPts = rings.map((R) => loops.map((L, li) => L.map((pt, i) => {
    const f = R.end === 0 ? fac0[li][i] : fac1[li][i];
    const m = mit[li][i];
    return [pt[0] + m[0] * R.inset * f, pt[1] + m[1] * R.inset * f, R.end === 0 ? w0 + R.dw * f : w1 - R.dw * f];
  })));

  const [fnMap, flip] = MAPS[map];
  const s = new Soup();
  const P = (q) => fnMap(q[0], q[1], q[2]);
  const tri = (a, b, c) => (flip ? s.tri(P(a), P(c), P(b), user) : s.tri(P(a), P(b), P(c), user));
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let li = 0; li < loops.length; li++) {
      const A = ringPts[r][li], B = ringPts[r + 1][li], N = A.length;
      for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]); }
    }
  }
  const cap = (R, up) => {
    const c2 = R[0].map((q) => new Vector2(q[0], q[1]));
    const h2 = R.slice(1).map((L) => L.map((q) => new Vector2(q[0], q[1])));
    const all = [].concat(...R);
    for (const [a, b, c] of ShapeUtils.triangulateShape(c2, h2)) {
      const A = all[a], B = all[b], C = all[c];
      const ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
      if ((ar > 0) === up) tri(A, B, C); else tri(A, C, B);
    }
  };
  if (cap0) cap(ringPts[0], false);
  if (cap1) cap(ringPts[rings.length - 1], true);
  return s;
}

// Rounded-edge box centred at (cx, cy, cz) with full sizes (sx, sy, sz); bevel b on every edge.
export function box(cx, cy, cz, sx, sy, sz, b = 0.4, segs = 1) {
  const hx = sx / 2, hy = sy / 2;
  const pts = outline([[-hx, -hy, b, segs], [hx, -hy, b, segs], [hx, hy, b, segs], [-hx, hy, b, segs]]);
  return prism(pts, -sz / 2, sz / 2, { b0: b, b1: b, segs }).move(cx, cy, cz);
}

// Revolve a profile [[r, w], ...] about the w axis. Walk the profile from the low-w end round the
// outside to the high-w end (a hollow part continues back down the bore and sets closed: true).
export function lathe(profile, opts = {}) {
  const { segs = 24, map = 'xyz', closed = false, user = null, phase = 0 } = opts;
  const [fnMap] = MAPS[map];
  const s = new Soup();
  const N = profile.length;
  const pt = (i, j) => { const a = phase + (j / segs) * Math.PI * 2; const [r, w] = profile[i]; return fnMap(r * Math.cos(a), r * Math.sin(a), w); };
  const last = closed ? N : N - 1;
  for (let i = 0; i < last; i++) {
    const i1 = (i + 1) % N;
    for (let j = 0; j < segs; j++) {
      const A = pt(i, j), B = pt(i, j + 1), C = pt(i1, j + 1), D = pt(i1, j);
      s.tri(A, B, C, user); s.tri(A, C, D, user);
    }
  }
  return s;
}

// Tube swept along a polyline. radius: number or fn(i, t). Parallel-transported frames.
export function tube(path, radius, opts = {}) {
  const { radial = 6, caps = true, user = null, squash = 1, up = [0, 1, 0] } = opts;
  const s = new Soup();
  const n = path.length;
  const T = new Vector3(), Nn = new Vector3(), Bn = new Vector3(), prevT = new Vector3(), q = new Vector3();
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (i === 0) {
      Nn.set(up[0], up[1], up[2]);
      if (Math.abs(Nn.dot(T)) > 0.9) Nn.set(1, 0, 0);
      Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    } else {
      q.crossVectors(prevT, T);
      const sl = q.length();
      if (sl > 1e-6) { q.multiplyScalar(1 / sl); Nn.applyAxisAngle(q, Math.asin(Math.min(1, sl))); }
      Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    }
    prevT.copy(T);
    Bn.crossVectors(T, Nn);
    const r = typeof radius === 'function' ? radius(i, i / (n - 1)) : radius;
    const ring = [];
    for (let j = 0; j < radial; j++) {
      const a2 = (j / radial) * Math.PI * 2;
      const c = Math.cos(a2) * r, d = Math.sin(a2) * r * squash;
      ring.push([path[i][0] + Nn.x * d + Bn.x * c, path[i][1] + Nn.y * d + Bn.y * c, path[i][2] + Nn.z * d + Bn.z * c]);
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < radial; j++) { const k = (j + 1) % radial; s.quad(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j], user); }
  if (caps) {
    for (let j = 1; j + 1 < radial; j++) { s.tri(rings[0][0], rings[0][j + 1], rings[0][j], user); s.tri(rings[n - 1][0], rings[n - 1][j], rings[n - 1][j + 1], user); }
  }
  return s;
}

// ---- stroke lettering ----------------------------------------------------------------------------
// A plain engraver's alphabet on a 4 x 6 grid; each glyph is a list of polylines.
const GLYPHS = {
  A: [[0, 0, 0, 4, 2, 6, 4, 4, 4, 0], [0, 2.5, 4, 2.5]], B: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [3, 3, 4, 2, 4, 1, 3, 0, 0, 0]],
  C: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1]], D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]],
  E: [[4, 6, 0, 6, 0, 0, 4, 0], [0, 3, 3, 3]], F: [[4, 6, 0, 6, 0, 0], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 2.2, 3]], H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[2, 0, 2, 6], [1, 0, 3, 0], [1, 6, 3, 6]], J: [[3.5, 6, 3.5, 1, 2.5, 0, 1, 0, 0, 1]],
  K: [[0, 0, 0, 6], [4, 6, 0, 2.6], [1.3, 3.7, 4, 0]], L: [[0, 6, 0, 0, 4, 0]],
  M: [[0, 0, 0, 6, 2, 3, 4, 6, 4, 0]], N: [[0, 0, 0, 6, 4, 0, 4, 6]],
  O: [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0]], P: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  Q: [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0], [2.5, 1.5, 4.2, -0.3]],
  R: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [2, 3, 4, 0]], S: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]], U: [[0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]], V: [[0, 6, 2, 0, 4, 6]],
  W: [[0, 6, 1, 0, 2, 3.5, 3, 0, 4, 6]], X: [[0, 0, 4, 6], [0, 6, 4, 0]], Y: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6, 0, 0, 4, 0]],
  0: [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0], [0.6, 1.2, 3.4, 4.8]], 1: [[1, 4.8, 2.2, 6, 2.2, 0], [1, 0, 3.4, 0]],
  2: [[0, 5, 1, 6, 3, 6, 4, 5, 4, 3.6, 0, 0, 4, 0]], 3: [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1.5, 3], [3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  4: [[3, 0, 3, 6, 0, 2, 4, 2]], 5: [[4, 6, 0, 6, 0, 3.4, 3, 3.4, 4, 2.4, 4, 1, 3, 0, 1, 0, 0, 1]],
  6: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2.4, 3, 3.4, 0, 3.4]], 7: [[0, 6, 4, 6, 1.5, 0]],
  8: [[1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3]],
  9: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 3.6, 1, 2.6, 4, 2.6]],
  '-': [[0.6, 3, 3.4, 3]], '.': [[1.7, 0, 2.3, 0]], '/': [[0, 0, 4, 6]], x: [[0.5, 1, 3.5, 4.4], [0.5, 4.4, 3.5, 1]],
  '&': [[4, 0, 0.6, 4.6, 0.6, 5.4, 1.4, 6, 2.4, 5.4, 2.4, 4.4, 0, 2, 0, 1, 1, 0, 2.4, 0, 4, 2.4]], ' ': [],
};

// Lettering as thin flat ribbons in the (u, v) plane at w = 0, facing +w. Returns { soup, width }.
// h: cap height, sw: stroke width, track: extra letter spacing in grid units.
export function strokeText(str, { h = 3, sw = 0.3, track = 1.4, slant = 0 } = {}) {
  const k = h / 6;
  const s = new Soup();
  let x = 0;
  const seg = (ax, ay, bx, by) => {
    let dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy * sw / 2, ny = dx * sw / 2, ex = dx * sw / 2, ey = dy * sw / 2;
    s.quad([ax - ex - nx, ay - ey - ny, 0], [bx + ex - nx, by + ey - ny, 0], [bx + ex + nx, by + ey + ny, 0], [ax - ex + nx, ay - ey + ny, 0]);
  };
  for (const ch of str) {
    const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || [];
    for (const line of g) for (let i = 0; i + 3 < line.length; i += 2) {
      seg(x + (line[i] + line[i + 1] * slant) * k, line[i + 1] * k, x + (line[i + 2] + line[i + 3] * slant) * k, line[i + 3] * k);
    }
    x += (ch === ' ' ? 3 : 4 + track) * k;
  }
  return { soup: s, width: x - track * k };
}

// Arbitrary polylines as flat ribbons (logos, witness marks). lines: [[u, v, u, v, ...], ...]
export function strokeLines(lines, sw = 0.3, close = false) {
  const s = new Soup();
  for (const line of lines) {
    const n = line.length / 2;
    for (let i = 0; i < (close ? n : n - 1); i++) {
      const ax = line[i * 2], ay = line[i * 2 + 1], bx = line[((i + 1) % n) * 2], by = line[((i + 1) % n) * 2 + 1];
      let dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = -dy * sw / 2, ny = dx * sw / 2, ex = dx * sw / 2, ey = dy * sw / 2;
      s.quad([ax - ex - nx, ay - ey - ny, 0], [bx + ex - nx, by + ey - ny, 0], [bx + ex + nx, by + ey + ny, 0], [ax - ex + nx, ay - ey + ny, 0]);
    }
  }
  return s;
}

// ---- signed distance to an extruded outline (hand grasp solver) ------------------------------------
export function sdPoly(pts, x, y) {
  let d = Infinity; let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1];
    const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const dx = wx - ex * t, dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}
// distance to the solid made by extruding a 2D outline (distance d2 in its plane) to half-width hw
export function sdExtrude(d2, across, hw) {
  const wy = Math.abs(across) - hw;
  return Math.min(Math.max(d2, wy), 0) + Math.hypot(Math.max(d2, 0), Math.max(wy, 0));
}

// ---- weapon model assembly (models/*.js) -----------------------------------------------------------
// Profiles are authored in millimetres: `side` extrudes a (z, y) profile along x, `sect` an (x, y)
// section along z, `plan` an (x, z) plan along y.
export const MM = 0.001;
export const side = (profile, x0, x1, opts = {}) => prism(profile, x0, x1, { map: 'zyx', ...opts });
export const sect = (profile, z0, z1, opts = {}) => prism(profile, z0, z1, { map: 'xyz', ...opts });
export const plan = (profile, y0, y1, opts = {}) => prism(profile, y0, y1, { map: 'xzy', ...opts });
// a pin or screw through the gun along x, a disc facing z, a chamfered rod along z
export const pinX = (z, y, r, x0, x1, c = 0.2) => lathe([[0, x0], [r - c, x0], [r, x0 + c], [r, x1 - c], [r - c, x1], [0, x1]], { segs: 16, map: 'yzx' }).move(0, y, z);
export const discZ = (x, y, r, z0, z1, n = 16) => sect(circle(x, y, r, n), z0, z1);
export const rodZ = (x, y, r, z0, z1, c = 0.3, segs = 20) => lathe([[0, z0], [r - c, z0], [r, z0 + c], [r, z1 - c], [r - c, z1], [0, z1]], { segs }).move(x, y, 0);
// Lettering laid on a flank at |x| = hw ('left' faces -x and reads toward the muzzle's left,
// 'right' faces +x), starting at z = a with its baseline at y = b; or on a top face at y = hw
// (where = 'top': u -> +x from x = a, v -> -z from z = b).
export function placeText(soup, where, hw, a, b, lift = 0.04) {
  const m = new Matrix4();
  if (where === 'left') m.set(0, 0, -1, -hw - lift, 0, 1, 0, b, 1, 0, 0, a, 0, 0, 0, 1);
  else if (where === 'right') m.set(0, 0, 1, hw + lift, 0, 1, 0, b, -1, 0, 0, a, 0, 0, 0, 1);
  else m.set(1, 0, 0, a, 0, 0, 1, hw + lift, 0, -1, 0, b, 0, 0, 0, 1);
  return new Soup().add(soup, m);
}

// model.attach for a model whose attachments are parts shown and hidden. defs: { kind: { parts:
// [Object3D], hide?: [Object3D] (what the attachment replaces), anchors?: { name: Vector3 } (where
// that anchor is with it fitted: an optic moves `sight`, a muzzle device `muzzle`) } }. Returns
// attach(kind, on) -> boolean (false: this weapon has no such attachment).
export function fitments(model, defs) {
  const base = {}, on = {};
  for (const k of Object.keys(model.anchors)) base[k] = model.anchors[k].clone();
  for (const d of Object.values(defs)) for (const p of d.parts) p.visible = false;
  return (kind, want) => {
    const d = defs[kind];
    if (!d) return false;
    on[kind] = !!want;
    for (const p of d.parts) p.visible = on[kind];
    if (d.hide) for (const h of d.hide) h.visible = !on[kind];
    for (const k of Object.keys(base)) model.anchors[k].copy(base[k]);
    for (const kk of Object.keys(defs)) if (on[kk] && defs[kk].anchors) for (const a of Object.keys(defs[kk].anchors)) model.anchors[a].copy(defs[kk].anchors[a]);
    return true;
  };
}
// A small open reflex sight, shared by every weapon that takes one: a base, a hooded window frame
// and the emitter housing behind it. z: where the window stands; y0: the surface it sits on; yd:
// the dot's height. Returns { body, dot } soups (mm). The eye lines up the dot.
export function reflexSight(z, y0, yd, w = 11) {
  const body = new Soup();
  body.add(box(0, y0 + 2.2, z + 13, w * 2 - 1, 4.4, 34, 1));
  body.add(box(0, y0 + 6, z + 24, w * 2 - 3, 6, 11, 1.2));
  // the window is 16 mm high round the dot; anything between it and the base is a riser block
  const top = yd + 8.5, bot = Math.max(y0 + 3.5, yd - 9.5);
  if (bot > y0 + 4) body.add(box(0, (y0 + 4 + bot) / 2, z + 6, w * 2 - 5, bot - y0 - 3, 20, 1.2));
  body.add(prism(outline([[-w, bot, 1.5], [w, bot, 1.5], [w, top - 3, 3], [w - 3, top, 3], [-w + 3, top, 3], [-w, top - 3, 3]]), z - 1.6, z + 1.6,
    { holes: [outline([[-w + 1.8, bot + 2.1, 1.5], [w - 1.8, bot + 2.1, 1.5], [w - 1.8, top - 3.2, 2.5], [-w + 1.8, top - 3.2, 2.5]])], b0: 0.5, b1: 0.5, hb: 0.5, map: 'xyz' }));
  body.add(pinX(z + 8, y0 + 2.4, 1.7, -(w + 1.2), w + 1.2, 0.3)); // clamp screw
  const dot = prism(circle(0, yd, 0.55, 10), z - 0.2, z + 0.2, { map: 'xyz' });
  return { body, dot };
}

// Collects soups by part and material, then turns each part into a Group of meshes whose origin is
// the part's pivot. materials: { name: Material }. Vertices tagged 'grip' get the studded-zone mask.
export function modelKit(G, materials, name) {
  const root = new Group();
  root.name = name;
  const P = {}, parts = {}, meshes = [];
  let triangles = 0;
  const put = (part, mat, soup) => { ((P[part] ||= {})[mat] ||= new Soup()).add(soup); };
  const meshOf = (soup, matName) => {
    if (!materials[matName]) throw new Error(`[${name}] no material "${matName}"`);
    const geo = soup.toGeometry();
    const u = soup.u;
    G.mats.bakeRest(geo, { masks: { grip: (x, y, z, i) => (u[i] === 'grip' ? 1 : 0) } });
    triangles += soup.triCount;
    return geo;
  };
  const add = (g, geo, matName) => {
    const mesh = new Mesh(geo, materials[matName]);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = -10;
    mesh.userData.mat = matName;
    meshes.push(mesh); g.add(mesh);
    return mesh;
  };
  // part(name, pivot mm, parent): the soups put under `name` become a Group at `pivot`
  const part = (pname, pivot = [0, 0, 0], parent = root) => {
    const g = new Group();
    g.name = pname;
    g.position.set(pivot[0] * MM, pivot[1] * MM, pivot[2] * MM);
    for (const [matName, soup] of Object.entries(P[pname] || {})) {
      const geo = meshOf(soup, matName);
      geo.translate(-pivot[0] * MM, -pivot[1] * MM, -pivot[2] * MM);
      add(g, geo, matName);
    }
    parent.add(g);
    parts[pname] = g;
    return g;
  };
  // a second instance of a part's geometry (the spare magazine)
  const copy = (from, pname, parent = root) => {
    const g = new Group();
    g.name = pname;
    for (const m of parts[from].children) if (m.isMesh) add(g, m.geometry, m.userData.mat);
    parent.add(g);
    parts[pname] = g;
    return g;
  };
  return { root, parts, meshes, put, part, copy, get triangles() { return triangles; } };
}
