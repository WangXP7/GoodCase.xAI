// Cages: small authored grids shrink-wrapped onto the sculpt. A cage is a tube of rows; each row
// has an origin on the cage's axis and a tilt, each column an angle round the axis, and a vertex is
// where the ray from the origin leaves the sculpt (so every vertex sits on the zero level and takes
// its normal from the field's gradient: no faceted shading, and neighbouring cages shade alike
// where they meet). A ray that does not leave within its reach is inside a neighbouring part (the
// arm's first rows are inside the chest, the palm's last inside the finger roots): that vertex is
// "sunk", parked inside, and the cages simply interpenetrate there. No stitching.
import { evaluate, gradient, march, weightsAt, project } from './sdf.js';
import { BODY, rectUV } from './uv.js';
import { HEAD_C, mouthLine, MOUTH_HALF, EAR_GROUP } from './head.js';
import { HIP, KNEE, ANKLE, ELBOW } from './figure.js';
import { WRIST, handPoint } from './hands.js';
import { B, NB, BONES, SHOULDER } from '../skeleton.js';

export const SID = { skin: 8, hair: 9, eye: 10, tooth: 11, gore: 12 };
export const MIRROR_BONES = BONES.map((b) => {
  const n = b.name;
  const m = n.endsWith('L') ? `${n.slice(0, -1)}R` : n.endsWith('R') ? `${n.slice(0, -1)}L` : n;
  return B[m] ?? B[n];
});

// One accumulator for a whole wardrobe. Triangles go to named shells (index lists).
export class MeshBuf {
  constructor() {
    this.p = []; this.n = []; this.uv = []; this.si = []; this.sw = []; this.surf = [];
    this.shells = new Map(); this.shell = 'skin'; this.sunk = [];
  }
  get count() { return this.p.length / 3; }
  // w: [[bone, weight] x up to 4], already normalised. a: [x, y, z, id] -> aSurf
  vert(x, y, z, nx, ny, nz, u, v, w, a, sunk = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
    for (let k = 0; k < 4; k++) { this.si.push(w[k] ? w[k][0] : 0); this.sw.push(w[k] ? w[k][1] : 0); }
    this.surf.push(a[0], a[1], a[2], a[3]);
    this.sunk.push(sunk);
    return this.count - 1;
  }
  tri(a, b, c) {
    let l = this.shells.get(this.shell);
    if (!l) { l = []; this.shells.set(this.shell, l); }
    l.push(a, b, c);
  }
  quad(a, b, c, d, flip) { if (flip) { this.tri(a, c, b); this.tri(a, d, c); } else { this.tri(a, b, c); this.tri(a, c, d); } }
  // area-weighted normals for vertices [from, to) from the triangles of the given shells, shared
  // between vertices that sit at the same place (cloth, hair, hard parts: nothing to take a gradient of)
  computeNormals(from, to, shellNames) {
    const p = this.p, acc = new Float64Array((to - from) * 3), key = new Map(), rep = new Int32Array(to - from);
    for (let i = from; i < to; i++) {
      const k = `${Math.round(p[i * 3] * 20000)},${Math.round(p[i * 3 + 1] * 20000)},${Math.round(p[i * 3 + 2] * 20000)}`;
      let r = key.get(k);
      if (r === undefined) { r = i - from; key.set(k, r); }
      rep[i - from] = r;
    }
    for (const name of shellNames) {
      const idx = this.shells.get(name);
      if (!idx) continue;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        if (a < from || a >= to) continue;
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) { const k = rep[v - from] * 3; acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
      }
    }
    for (let i = from; i < to; i++) {
      const k = rep[i - from] * 3, l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
      this.n[i * 3] = acc[k] / l; this.n[i * 3 + 1] = acc[k + 1] / l; this.n[i * 3 + 2] = acc[k + 2] / l;
    }
  }
  finish() {
    return {
      count: this.count, position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv),
      skinIndex: new Uint16Array(this.si), skinWeight: new Float32Array(this.sw), aSurf: new Float32Array(this.surf),
      shells: this.shells, sunk: Uint8Array.from(this.sunk),
    };
  }
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vec = { norm, sub, cross, lerp3 };

// Rows along a polyline. `at`: list of distances along it (metres from the start; negative or past
// the end extrapolate). Each row: { o, t, lat: 0, rmax }.
export function shaftRows(pts, at, rmax) {
  const seg = [];
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(...sub(pts[i + 1], pts[i])); seg.push([L, l, norm(sub(pts[i + 1], pts[i]))]); L += l; }
  return at.map((s) => {
    let k = 0;
    while (k + 1 < seg.length && s > seg[k][0] + seg[k][1]) k++;
    const [s0, l, d] = seg[k];
    const o = [pts[k][0] + d[0] * (s - s0), pts[k][1] + d[1] * (s - s0), pts[k][2] + d[2] * (s - s0)];
    // blend the tangent across a joint so rows fan round a bend instead of crossing
    let t = d;
    const w = 0.012;
    if (k > 0 && s - s0 < w) t = norm(lerp3(seg[k - 1][2], d, 0.5 + (0.5 * (s - s0)) / w));
    else if (k + 1 < seg.length && s0 + l - s < w) t = norm(lerp3(seg[k + 1][2], d, 0.5 + (0.5 * (s0 + l - s)) / w));
    return { o, t, lat: 0, rmax: typeof rmax === 'function' ? rmax(s / L) : rmax, s };
  });
}
// Cap rows: rays from one point tilting from the side (lat 0) to the pole (+-90 degrees along t).
export const capRows = (o, t, lats, rmax) => lats.map((lat) => ({ o, t, lat, rmax }));
export const range = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));

// Wrap a tube. rows: [{ o, t, lat, rmax, sink? }]; angles: column angles (radians) round the axis
// from `ref`; closed: the first column is repeated at the end so UVs can run round.
// Returns { nR, cols, P, N, sunk } (Float64Array positions and unit normals).
export function wrap(fig, rows, angles, ref, o = {}) {
  const closed = o.closed !== false;
  const nR = rows.length, cols = angles.length + (closed ? 1 : 0);
  const P = new Float64Array(nR * cols * 3), N = new Float64Array(nR * cols * 3), sunk = new Uint8Array(nR * cols);
  const g = [0, 0, 0], groups = o.groups ?? -1;
  for (let i = 0; i < nR; i++) {
    const r = rows[i], t = r.t;
    const U = norm(sub(ref, [t[0] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2]), t[1] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2]), t[2] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2])]));
    const V = cross(t, U);
    const cl = Math.cos(r.lat), sl = Math.sin(r.lat);
    for (let j = 0; j < cols; j++) {
      const k = (i * cols + j) * 3;
      if (closed && j === cols - 1) { for (let e = 0; e < 3; e++) { P[k + e] = P[i * cols * 3 + e]; N[k + e] = N[i * cols * 3 + e]; } sunk[i * cols + j] = sunk[i * cols]; continue; }
      const a = angles[j], ca = Math.cos(a), sa = Math.sin(a);
      const dx = cl * (ca * U[0] + sa * V[0]) + sl * t[0], dy = cl * (ca * U[1] + sa * V[1]) + sl * t[1], dz = cl * (ca * U[2] + sa * V[2]) + sl * t[2];
      const rm = typeof r.rmax === 'function' ? r.rmax(a) : r.rmax;
      let hit;
      if (!r.sink && o.hull && o.hull(r, a)) {
        // the OUTER surface along this ray: marched from outside in. Where a form overhangs along
        // the ray (the tip of the nose over the lip) the first exit from inside is the wrong one.
        const h = march(fig, r.o[0] + dx * rm, r.o[1] + dy * rm, r.o[2] + dz * rm, -dx, -dy, -dz, rm, groups);
        hit = h < 0 ? -1 : rm - h;
      } else {
        hit = r.sink ? -1 : march(fig, r.o[0], r.o[1], r.o[2], dx, dy, dz, rm, groups);
        if (hit >= 0 && evaluate(fig, r.o[0], r.o[1], r.o[2], groups) > 0) hit = -1;      // the origin itself is outside
      }
      if (hit < 0) {
        const d = rm * (r.sink ?? 0.8);
        P[k] = r.o[0] + dx * d; P[k + 1] = r.o[1] + dy * d; P[k + 2] = r.o[2] + dz * d;
        // make sure a parked vertex really is inside something: walk it down the field
        for (let it = 0; it < 6; it++) {
          const dd = gradient(fig, P[k], P[k + 1], P[k + 2], g, groups, 0.002);
          if (dd < -0.008) break;
          P[k] -= g[0] * (dd + 0.012); P[k + 1] -= g[1] * (dd + 0.012); P[k + 2] -= g[2] * (dd + 0.012);
        }
        N[k] = dx; N[k + 1] = dy; N[k + 2] = dz; sunk[i * cols + j] = 1;
      } else {
        const x = r.o[0] + dx * hit, y = r.o[1] + dy * hit, z = r.o[2] + dz * hit;
        gradient(fig, x, y, z, g, groups);
        P[k] = x; P[k + 1] = y; P[k + 2] = z; N[k] = g[0]; N[k + 1] = g[1]; N[k + 2] = g[2];
      }
    }
  }
  return { nR, cols, P, N, sunk, closed };
}

const SKIN = [0, 0, 0, SID.skin];
// Emit a wrapped grid as skin. side -1 mirrors it to the figure's right. Returns the vertex ids.
export function emit(mesh, fig, grid, rect, o = {}) {
  const { nR, cols, P, N, sunk } = grid;
  const side = o.side ?? 1, ids = new Int32Array(nR * cols), uv = [0, 0];
  for (let i = 0; i < nR; i++) for (let j = 0; j < cols; j++) {
    const k = (i * cols + j) * 3;
    const x = P[k] * side, y = P[k + 1], z = P[k + 2];
    const w = (o.weights && o.weights(x, y, z, i, j)) || weightsAt(fig, x, y, z, MIRROR_BONES, NB) || [[B.hips, 1]];
    rectUV(rect, i, nR, j, cols, uv);
    ids[i * cols + j] = mesh.vert(x, y, z, N[k] * side, N[k + 1], N[k + 2], uv[0], uv[1], w, o.surf || SKIN, sunk[i * cols + j]);
  }
  for (let i = 0; i + 1 < nR; i++) for (let j = 0; j + 1 < cols; j++) {
    if (o.skip && o.skip(i, j)) continue;
    const a = ids[i * cols + j], b = ids[i * cols + j + 1], c = ids[(i + 1) * cols + j + 1], d = ids[(i + 1) * cols + j];
    // rows run along +t, columns turn anticlockwise about it: (a, b, c) faces outward
    mesh.quad(a, b, c, d, (side < 0) !== !!o.flip);
  }
  return ids;
}

// ---- the body's cages -----------------------------------------------------------------------------
// q: 1 near level, 0.5 far level. Returns { mouth } (what the mouth parts need).
// faces: figures of the same sex and build with other faces; each gets a head shell (head1, head2..) at the near level.
export function buildBodyCages(mesh, fig, q = 1, faces = null) {
  const near = q >= 1;
  const n = (a, b) => (near ? a : b);
  const ring = (c, a0 = 0) => range(a0, a0 + 2 * Math.PI, c + 1).slice(0, c);
  const X = [1, 0, 0], Z = [0, 0, 1];
  const out = {};

  // ---- head and neck: rays from the middle of the head, then down the neck. One cage per face
  // (hf: the figure with that face; the same rays, UVs and rows, so they share the baked maps).
  const headCage = (hf, shell) => {
    mesh.shell = shell;
    // columns: dense across the face (angle 0 = straight ahead, +z), sparse round the back; the
    // seam is at the back
    let az;
    if (near) {
      // finest over the nose (its bridge is 14 mm wide: at an even 3 degrees it was three vertices,
      // a flat card), 3 degrees to the outer corner of the eye, then opening out
      az = [0];
      for (const a of [0.026, 0.052, 0.085, 0.125, 0.17, 0.22, 0.27, 0.32, 0.37, 0.42, 0.47, 0.52]) { az.push(a); az.unshift(-a); }
      for (let k = 1; k <= 6; k++) { az.push(0.52 + k * 0.2); az.unshift(-0.52 - k * 0.2); }        // to +-100 at 11.5
      const rest = 2 * Math.PI - 2 * (0.52 + 6 * 0.2), nb = 7;
      for (let k = 1; k <= nb; k++) az.push(0.52 + 6 * 0.2 + (rest * k) / (nb + 1));
    } else az = ring(16, -Math.PI);
    // descending, so that the negated angles handed to wrap() ascend (anticlockwise about the downward axis)
    az = az.map((a) => (a > Math.PI ? a - 2 * Math.PI : a)).sort((a, b) => b - a);
    // angle is measured from +z toward +x: with ref = Z and tangent +y, V = y cross z = +x
    const up = [0, 1, 0];
    const mLat = Math.atan2(mouthLine(0)[0] - HEAD_C[1], mouthLine(0)[1] - HEAD_C[2]);
    const lats = near
      ? [...range(1.5, 0.5, 7), ...range(0.4, mLat + 0.052 * 2, 14).slice(0, -1), mLat + 0.085, mLat + 0.04, mLat, mLat - 0.045, mLat - 0.1, ...range(mLat - 0.17, -1.08, 6)]
      : [...range(1.45, 0.45, 4), 0.2, -0.05, -0.28, mLat, -0.75, -1.08];
    const rows = capRows(HEAD_C, up, lats, 0.16);
    const mRow = lats.indexOf(mLat);
    // neck rows go down the neck's own axis into the chest
    const neck = shaftRows([[0, 1.572, -0.016], [0, 1.45, -0.03]], near ? [0.0, 0.02, 0.042, 0.066, 0.09, 0.115] : [0.0, 0.045, 0.1], 0.085);
    // rows must keep one tangent sense so the winding is the same: the head's rows run from the
    // crown down, which is along -y; give every row t = -y-ish and mirror the tilt
    for (const r of rows) { r.t = [0, -1, 0]; r.lat = -r.lat; }
    const all = rows.concat(neck);
    // with t pointing down, anticlockwise about t seen from above is clockwise: V = t x Z = -x.
    // Negate the angles so +angle is still toward +x.
    // the face is wrapped from outside (see wrap: hull), so the tip of the nose, the lips and the
    // chin are where the outline is; the scalp, the sides and the neck from inside as before
    // (out to the temples: a boundary across the eye left the lids in pieces)
    const hull = (r, a) => r.o === HEAD_C && Math.abs(a) < 0.75 && r.lat < 0.72 && r.lat > -0.45;
    // (near: without the ears, which have a cage of their own; a head wrapped through them came
    // out in plates behind the ear. What then lies under the root of an ear is marked sunk.)
    const grid = wrap(hf, all, az.map((a) => -a), Z, { hull, groups: near ? ~EAR_GROUP : -1 });
    const cols = grid.cols;
    if (near) for (let v = 0; v < grid.nR * cols; v++) if (!grid.sunk[v] && evaluate(hf, grid.P[v * 3], grid.P[v * 3 + 1], grid.P[v * 3 + 2]) < -0.0003) grid.sunk[v] = 1;
    // pull the mouth row onto the lip line
    const inMouth = [];
    for (let j = 0; j < cols - 1; j++) {
      const k = (mRow * cols + j) * 3;
      if (Math.abs(grid.P[k]) > MOUTH_HALF - 0.002 || grid.P[k + 2] < 0.05) continue;
      const a = az[j];
      let lo = mLat - 0.07, hi = mLat + 0.07, x = 0, y = 0, z = 0;
      for (let it = 0; it < 14; it++) {
        const lat = (lo + hi) / 2, cl = Math.cos(lat);
        const dx = cl * Math.sin(a), dy = Math.sin(lat), dz = cl * Math.cos(a);
        const h = march(hf, HEAD_C[0], HEAD_C[1], HEAD_C[2], dx, dy, dz, 0.16);
        x = HEAD_C[0] + dx * h; y = HEAD_C[1] + dy * h; z = HEAD_C[2] + dz * h;
        if (y > mouthLine(x)[0]) hi = lat; else lo = lat;
      }
      const g = [0, 0, 0];
      gradient(hf, x, y, z, g);
      grid.P[k] = x; grid.P[k + 1] = y; grid.P[k + 2] = z; grid.N[k] = g[0]; grid.N[k + 1] = g[1]; grid.N[k + 2] = g[2];
      inMouth.push(j);
    }
    // (the tip of the nose stands clear of every form that carries weight: it is the head's)
    const headW = (x, y, z) => weightsAt(hf, x, y, z, MIRROR_BONES, NB) || [[B.head, 1]];
    const ids = emit(mesh, hf, grid, BODY.head, {
      weights: headW,
      // the quads under the lip line are re-made below from a second copy of that row
      skip: (i, j) => i === mRow && inMouth.includes(j) && inMouth.includes(j + 1),
    });
    // lower-lip copy of the mouth row: same place, but it belongs to the jaw
    const lower = new Map(), uv = [0, 0];
    for (const j of inMouth) {
      const k = (mRow * cols + j) * 3;
      rectUV(BODY.head, mRow, grid.nR, j, cols, uv);
      const w = [[B.jaw, 1]];
      lower.set(j, mesh.vert(grid.P[k], grid.P[k + 1], grid.P[k + 2], grid.N[k], grid.N[k + 1], grid.N[k + 2], uv[0], uv[1] + 0.0004, w, SKIN));
      // and the upper copy is the head's alone
      const id = ids[mRow * cols + j];
      mesh.si[id * 4] = B.head; mesh.sw[id * 4] = 1; for (let e = 1; e < 4; e++) { mesh.si[id * 4 + e] = 0; mesh.sw[id * 4 + e] = 0; }
    }
    for (const j of inMouth) {
      if (!inMouth.includes(j + 1)) continue;
      const a = lower.get(j), b = lower.get(j + 1), c = ids[(mRow + 1) * cols + j + 1], d = ids[(mRow + 1) * cols + j];
      mesh.quad(a, b, c, d, false);
    }
    // the row under the lips follows the jaw more than distance alone would say
    for (const j of inMouth) for (const dr of [1, 2]) {
      const id = ids[(mRow + dr) * cols + j];
      mesh.si[id * 4] = B.jaw; mesh.sw[id * 4] = 1; for (let e = 1; e < 4; e++) { mesh.si[id * 4 + e] = 0; mesh.sw[id * 4 + e] = 0; }
    }
    return { upper: inMouth.map((j) => ids[mRow * cols + j]), lower: inMouth.map((j) => lower.get(j)) };
  };
  out.mouth = headCage(fig, 'head');
  if (near && faces) faces.forEach((hf, k) => headCage(hf, `head${k + 1}`));

  // ---- ears: the side of the ear as a height field seen from beside the head, rings from its
  // middle out to its own outline, then a wall straight in to the skull. (A tube wrapped up the
  // middle of so thin a shell sent half its rays through into the head: fans of shards.)
  if (near) {
    const e = fig.marks.ear.c, c = [e[1], e[2] - 0.002], x0 = e[0] + 0.035;
    const ca = Math.cos(0.26), sa = Math.sin(0.26), RY = 0.033, RZ = 0.02, nA = 10;
    const ang = ring(nA), fr = [0, 0.42, 0.78, 1, 1], nR = fr.length, cols = nA + 1;
    const grid = { nR, cols, P: new Float64Array(nR * cols * 3), N: new Float64Array(nR * cols * 3), sunk: new Uint8Array(nR * cols), closed: true };
    const hitX = (y, z) => { const h = march(fig, x0, y, z, -1, 0, 0, 0.07); return h < 0 ? x0 - 0.07 : x0 - h; };
    const at = (a, r) => { const u = Math.cos(a) * RY * r, v = Math.sin(a) * RZ * r; return [c[0] + u * ca + v * sa, c[1] - u * sa + v * ca]; };
    const g = [0, 0, 0];
    for (let j = 0; j < nA; j++) {
      const a = ang[j];
      // the skull beside the ear on this bearing, and the furthest point that is still ear
      const far = at(a, 1.7), skull = hitX(far[0], far[1]);
      let edge = 1.3;
      for (; edge > 0.3; edge -= 0.05) { const q = at(a, edge); if (hitX(q[0], q[1]) > skull + 0.0045) break; }
      for (let i = 0; i < nR; i++) {
        const q = at(a, fr[i] * edge), k = (i * cols + j) * 3;
        let x = hitX(q[0], q[1]);
        if (i === nR - 1) {
          // the wall's foot: under the skin of the head
          x = Math.min(x, skull) - 0.004;
          grid.N[k] = 0.3; grid.N[k + 1] = (q[0] - c[0]) / RY; grid.N[k + 2] = (q[1] - c[1]) / RZ; grid.sunk[i * cols + j] = 1;
          const l = Math.hypot(grid.N[k], grid.N[k + 1], grid.N[k + 2]) || 1;
          grid.N[k] /= l; grid.N[k + 1] /= l; grid.N[k + 2] /= l;
        } else { gradient(fig, x, q[0], q[1], g); grid.N[k] = g[0]; grid.N[k + 1] = g[1]; grid.N[k + 2] = g[2]; }
        grid.P[k] = x; grid.P[k + 1] = q[0]; grid.P[k + 2] = q[1];
      }
    }
    for (let i = 0; i < nR; i++) for (let e3 = 0; e3 < 3; e3++) { grid.P[(i * cols + nA) * 3 + e3] = grid.P[i * cols * 3 + e3]; grid.N[(i * cols + nA) * 3 + e3] = grid.N[i * cols * 3 + e3]; }
    for (let i = 0; i < nR; i++) grid.sunk[i * cols + nA] = grid.sunk[i * cols];
    for (const side of [1, -1]) { mesh.shell = side > 0 ? 'earL' : 'earR'; emit(mesh, fig, grid, BODY.ear, { side, flip: true }); }
  }

  // ---- torso: up the spine from the crotch to the base of the neck
  {
    mesh.shell = 'torso';
    const axis = [[0, 0.9, 0], [0, 0.975, -0.005], [0, 1.085, -0.012], [0, 1.255, -0.02], [0, 1.47, -0.026]];
    // reach: an ellipse that stops at the shoulder joint, so the arms belong to the arm cages
    const reach = (s) => (a) => { const c = Math.cos(a), sn = Math.sin(a); return 1 / Math.hypot(sn / (0.2 + 0.03 * (1 - s)), c / 0.24); };
    const at = near ? [0, 0.035, 0.075, 0.115, 0.155, 0.195, 0.235, 0.275, 0.315, 0.355, 0.39, 0.425, 0.455, 0.485] : [0, 0.09, 0.19, 0.29, 0.39, 0.485];
    const up = norm(sub(axis[1], axis[0]));
    // The yoke: above the armpits the rows FAN up from the chest (as a shirt's yoke is cut), so the
    // tops of the shoulders and the slope to the neck are met head-on. Level rows there grazed a
    // near-level surface: two or three rows had to span it, a shelf with a hard edge at the collarbone.
    const yoke = [0, 1.385, -0.02], fanR = (a) => { const c = Math.cos(a), sn = Math.sin(a); return 1 / Math.hypot(sn / 0.2, c / 0.24); };
    const rows = [
      ...capRows(axis[0], up, near ? [-1.57, -1.1, -0.7, -0.35] : [-1.57, -0.7], (a) => 0.13 + 0.05 * Math.abs(Math.sin(a))),
      ...shaftRows(axis, at, reach),
      ...capRows(yoke, [0, 1, 0], near ? [0.14, 0.32, 0.52, 0.72, 0.92] : [0.3, 0.75], fanR),
      { ...capRows(yoke, [0, 1, 0], [1.25], 0.09)[0], sink: 0.8 },
    ];
    for (const r of rows) r.t = r.t[1] > 0.5 ? r.t : up;
    // angle 0 = +z (front); seam at the back
    const grid = wrap(fig, rows, ring(n(24, 12), -Math.PI), Z);
    emit(mesh, fig, grid, BODY.torso);
  }

  // ---- arms
  {
    const axis = [[0.128, 1.418, -0.014], SHOULDER, ELBOW, WRIST];      // starts well inside the shoulder: its parked first ring must not show as a plate on top
    const at = near ? [0, 0.05, 0.085, 0.12, 0.165, 0.215, 0.265, 0.315, 0.35, 0.375, 0.4, 0.44, 0.49, 0.54, 0.585, 0.62, 0.645, 0.67] : [0, 0.07, 0.14, 0.26, 0.375, 0.5, 0.62, 0.67];
    const rows = shaftRows(axis, at, 0.1);
    rows[0].sink = 0.12; rows[rows.length - 1].sink = 0.12; rows[rows.length - 1].rmax = 0.1;
    const grid = wrap(fig, rows, ring(n(10, 6), Math.PI / 2), [0, 1, 0]);
    for (const side of [1, -1]) { mesh.shell = side > 0 ? 'armL' : 'armR'; emit(mesh, fig, grid, BODY.arm, { side }); }
  }

  // ---- hands: palm, four fingers, thumb
  {
    const hs = fig.marks.handScale;
    const P = (al, ac, u) => handPoint(al * hs, ac * hs, u * hs);
    const pal = shaftRows([P(-0.012, 0.002, 0), P(0.11, 0.002, 0)], (near ? [0, 0.012, 0.026, 0.042, 0.058, 0.074, 0.088, 0.1, 0.106] : [0, 0.02, 0.05, 0.085, 0.106]).map((v) => v * hs), 0.06);
    pal[0].sink = 0.2; pal[pal.length - 1].sink = 0.15;
    const back = sub(P(0, 0, 1), P(0, 0, 0));
    const grid = wrap(fig, pal, ring(n(14, 8)), back);
    const fingers = fig.marks.fingers.concat([fig.marks.thumb]);
    const fg = fingers.map((f) => {
      const len = [1, 2, 3].map((k) => Math.hypot(...sub(f.pts[k + 1], f.pts[k])));
      const s0 = Math.hypot(...sub(f.pts[1], f.pts[0]));
      const a = s0 + len[0], b = a + len[1], c = b + len[2];
      const at = near ? [0.004, s0 + 0.004, s0 + len[0] * 0.5, a - 0.004, a + 0.004, a + len[1] * 0.5, b - 0.003, b + 0.004, b + len[2] * 0.55] : [0.004, s0 + len[0] * 0.5, a, b, b + len[2] * 0.6];
      const rows = shaftRows(f.pts, at, 0.016);
      rows[0].sink = 0.3;
      const tip = f.pts[4], tdir = norm(sub(f.pts[4], f.pts[3]));
      const o = [tip[0] - tdir[0] * 0.004, tip[1] - tdir[1] * 0.004, tip[2] - tdir[2] * 0.004];
      rows.push(...capRows(o, tdir, near ? [0.35, 0.95, 1.5708] : [0.6, 1.5708], 0.016));
      return wrap(fig, rows, ring(n(6, 4)), back);
    });
    for (const side of [1, -1]) {
      mesh.shell = side > 0 ? 'handL' : 'handR';
      emit(mesh, fig, grid, BODY.palm, { side });
      fg.forEach((g, i) => emit(mesh, fig, g, BODY[fingers[i].name], { side }));
    }
  }

  // ---- legs and feet
  {
    const axis = [[HIP[0], 0.96, 0], HIP, KNEE, ANKLE, [ANKLE[0], 0.04, ANKLE[2] - 0.004]];
    const at = near ? [0, 0.045, 0.085, 0.13, 0.19, 0.25, 0.31, 0.37, 0.415, 0.45, 0.48, 0.52, 0.58, 0.65, 0.72, 0.79, 0.84, 0.875, 0.9] : [0, 0.085, 0.2, 0.33, 0.45, 0.55, 0.7, 0.84, 0.9];
    const rows = shaftRows(axis, at, 0.125);
    rows[0].sink = 0.3; rows[rows.length - 1].sink = 0.2;
    // seam on the inside of the leg
    const grid = wrap(fig, rows, ring(n(12, 7), Math.PI), X);
    const fa = [[0.104, 0.045, -0.06], [0.107, 0.034, 0.03], [0.108, 0.02, 0.118]];
    const fr = [
      ...capRows(fa[0], norm(sub(fa[1], fa[0])), near ? [-1.5708, -0.7] : [-1.5708, -0.5], 0.06),
      ...shaftRows(fa, near ? [0.035, 0.075, 0.115, 0.15, 0.172] : [0.05, 0.11, 0.165], 0.075),
      ...capRows([0.11, 0.018, 0.128], [0, -0.1, 1], near ? [0.4, 1.0, 1.5708] : [0.7, 1.5708], 0.05),
    ];
    const foot = wrap(fig, fr, ring(n(10, 6), Math.PI / 2), [0, 1, 0]);
    for (const side of [1, -1]) {
      mesh.shell = side > 0 ? 'legL' : 'legR'; emit(mesh, fig, grid, BODY.leg, { side });
      mesh.shell = side > 0 ? 'footL' : 'footR'; emit(mesh, fig, foot, BODY.foot, { side });
    }
  }
  return out;
}
export { project };
