// Vehicle kit: what cars, the lorry and the highway traffic are assembled from, and the
// layer that draws them.
//
// Vehicles are not merged into the level's buckets. A prop builder (car.js, truck.js) does two
// things when the level calls it: it authors what the level needs with no renderer (colliders,
// light fixtures, the contact shadow, the stand-ins for the shadow passes and the puddle
// reflection), and it registers a record here. The layer then builds the real meshes in the
// browser: per vehicle a near level (body with cabin, glass, lit parts: 3 draw calls), a middle
// level (1 call, plus 1 for lit lamps) and a far level (merged across the whole highway into 1
// call); tyres, rims and number plates are shared across every vehicle of a zone.
//
// Install: installVehicles(G) once G.level exists. Nothing outside the vehicle files calls it yet,
// so a registered record schedules a poll that installs on the first animation frame after the
// harness publishes G (one frame after boot); calling it from the level is the tidy way
// and makes the poll a no-op.
import {
  BufferGeometry, BufferAttribute, InstancedBufferAttribute, Matrix4, Matrix3, Vector3, Group, Mesh, InstancedMesh, DoubleSide,
} from 'three';
import { M, box, cyl, lathe } from '../build.js';
import { createCarMats } from '../../mats/carPaint.js';
import { canCompileInParallel } from '../../render/warm.js';

const _v = new Vector3(), _n = new Vector3(), _m3 = new Matrix3(), _m4 = new Matrix4(), _m4b = new Matrix4();
const WHITE = [1, 1, 1], ZERO4 = [0, 0, 0, 0];

// ---- vertex buffer assembler ----------------------------------------------------------------------
// One per mesh of a vehicle. Per vertex: position, normal, colour, and two vec4 (aMat, aFx: see
// mats/carPaint.js). `fx` is the default aFx of everything added (the car's own dirt and rust).
export class VBuf {
  constructor(fx = ZERO4) {
    this.pos = []; this.nrm = []; this.col = []; this.a = []; this.b = []; this.idx = [];
    this.n = 0; this.fx = fx; this.ranges = {};
    this.stack = [new Matrix4()];
    this.warp = null; // (Vector3) -> void, in the space of the current transform: what the body went through (dents, a crumpled corner)
  }
  get top() { return this.stack[this.stack.length - 1]; }
  at(m, fn) { this.stack.push(new Matrix4().multiplyMatrices(this.top, m)); try { return fn(); } finally { this.stack.pop(); } }
  // everything added inside fn belongs to the named range (a part that moves: a door, a lid)
  range(name, fn) { const s = this.n; const r = fn(); if (this.n > s) (this.ranges[name] || (this.ranges[name] = [])).push([s, this.n - s]); return r; }
  // one vertex in the current transform; returns its index
  vert(x, y, z, nx, ny, nz, color = WHITE, a = ZERO4, b = this.fx) {
    const m = this.top;
    _v.set(x, y, z);
    if (this.warp) this.warp(_v);
    _v.applyMatrix4(m);
    _n.set(nx, ny, nz).transformDirection(m);
    this.pos.push(_v.x, _v.y, _v.z); this.nrm.push(_n.x, _n.y, _n.z);
    this.col.push(color[0], color[1], color[2]);
    this.a.push(a[0], a[1], a[2] || 0, a[3] || 0);
    this.b.push(b[0], b[1], b[2], b[3]);
    return this.n++;
  }
  tri(i, j, k) { this.idx.push(i, j, k); }
  quad(i, j, k, l) { this.idx.push(i, j, k, i, k, l); }
  // a BufferGeometry (build.js primitives). st: { color, a, b }, m: local Matrix4
  add(geo, st = {}, m = null) {
    const mat = m ? _m4.multiplyMatrices(this.top, m) : this.top;
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
    _m3.getNormalMatrix(mat);
    const flip = mat.determinant() < 0;
    const base = this.n, color = st.color || WHITE, a = st.a || ZERO4, b = st.b || this.fx;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (this.warp) { if (m) _v.applyMatrix4(m); this.warp(_v); _v.applyMatrix4(this.top); } else _v.applyMatrix4(mat);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) { _n.fromBufferAttribute(n, i).applyMatrix3(_m3).normalize(); this.nrm.push(_n.x, _n.y, _n.z); } else this.nrm.push(0, 1, 0);
      this.col.push(color[0], color[1], color[2]);
      this.a.push(a[0], a[1], a[2] || 0, a[3] || 0);
      this.b.push(b[0], b[1], b[2], b[3]);
    }
    const ix = geo.getIndex();
    const cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i += 3) {
      const q = ix ? ix.getX(i) : i, r = ix ? ix.getX(i + 1) : i + 1, s = ix ? ix.getX(i + 2) : i + 2;
      if (flip) this.idx.push(base + q, base + s, base + r); else this.idx.push(base + q, base + r, base + s);
    }
    this.n += p.count;
    geo.dispose();
    return this;
  }
  // another buffer, through a matrix
  merge(o, m) {
    const base = this.n;
    _m3.getNormalMatrix(m);
    for (let i = 0; i < o.n; i++) {
      _v.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]).applyMatrix4(m);
      _n.set(o.nrm[i * 3], o.nrm[i * 3 + 1], o.nrm[i * 3 + 2]).applyMatrix3(_m3).normalize();
      this.pos.push(_v.x, _v.y, _v.z); this.nrm.push(_n.x, _n.y, _n.z);
    }
    for (const k of ['col', 'a', 'b']) for (let i = 0; i < o[k].length; i++) this[k].push(o[k][i]);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(base + o.idx[i]);
    this.n += o.n;
    return this;
  }
  // move a named range by a matrix, now (a door built shut, left standing open)
  transform(name, m) {
    _m3.getNormalMatrix(m);
    for (const [s, c] of this.ranges[name] || []) for (let i = s; i < s + c; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(m);
      this.pos[i * 3] = _v.x; this.pos[i * 3 + 1] = _v.y; this.pos[i * 3 + 2] = _v.z;
      _n.set(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]).applyMatrix3(_m3).normalize();
      this.nrm[i * 3] = _n.x; this.nrm[i * 3 + 1] = _n.y; this.nrm[i * 3 + 2] = _n.z;
    }
  }
  get triangles() { return this.idx.length / 3; }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.a), 4));
    g.setAttribute('aFx', new BufferAttribute(new Float32Array(this.b), 4));
    g.setIndex(new BufferAttribute(this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.userData.ranges = this.ranges;
    return g;
  }
}

// make a geometry's triangles face `dir` (decided on its first triangle), with fresh smooth normals
export function facing(geo, dx, dy, dz) {
  const p = geo.getAttribute('position'), ix = geo.getIndex();
  const a = new Vector3().fromBufferAttribute(p, ix.getX(0)), b = new Vector3().fromBufferAttribute(p, ix.getX(1)), c = new Vector3().fromBufferAttribute(p, ix.getX(2));
  const n = b.sub(a).cross(c.sub(a));
  if (n.x * dx + n.y * dy + n.z * dz < 0) { const arr = ix.array; for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } }
  geo.computeVertexNormals();
  return geo;
}

// A dish opening toward +x: an elliptical bowl `depth` deep (lamp reflectors, handle recesses).
export function bowl(rz, ry, depth, rings = 4, seg = 14, pw = 4) {
  const pos = [0, 0, 0], idx = [];
  pos[0] = -depth;
  for (let r = 1; r <= rings; r++) for (let s = 0; s < seg; s++) {
    const q = r / rings, a = (s / seg) * Math.PI * 2;
    // a rounded rectangle more than an ellipse: lamps of this era are oblongs
    const c = Math.cos(a), sn = Math.sin(a), k = 1 / Math.pow(Math.pow(Math.abs(c), pw) + Math.pow(Math.abs(sn), pw), 1 / pw);
    pos.push(-depth * (1 - q * q), ry * q * sn * k, rz * q * c * k);
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let r = 1; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = 1 + (r - 1) * seg + s, b = 1 + (r - 1) * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return facing(g, 1, 0, 0);
}

// A lens: a plate in the YZ plane facing +x, `w` across z and `h` up y, ribbed (ribs: count, across
// 'y' = horizontal ribs, 'z' = vertical flutes), bowed out by `dome`. pw rounds its outline: the
// plate's square grid is drawn in to a superellipse of that power (2 a disc, 6 a soft-cornered oblong).
export function lensPlate(w, h, ribs = 8, across = 'y', dome = 0.006, amp = 0.0025, pw = 0) {
  const nu = across === 'y' ? 4 : ribs * 2, nv = across === 'y' ? ribs * 2 : 4;
  const pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu - 0.5, v = j / nv - 0.5;
    const rib = ((across === 'y' ? j : i) % 2) ? amp : -amp;
    let k = 1;
    if (pw > 0 && (u || v)) {
      const l = Math.hypot(u, v), c = Math.abs(u) / l, sn = Math.abs(v) / l;
      k = Math.max(c, sn) / Math.pow(Math.pow(c, pw) + Math.pow(sn, pw), 1 / pw);
    }
    pos.push(dome * (1 - 4 * u * u) * (1 - 4 * v * v) + rib, v * h * k, u * w * k);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return facing(g, 1, 0, 0);
}

// ---- panels cut from a grid -------------------------------------------------------------------------
// grid: { nx, ny, P: Float32Array(nx * ny * 3) } (point (i, j) at (i * ny + j) * 3), with outward
// normals N (gridNormals). cell(i, j) -> null (a hole) or
//   { id, buf (VBuf), st: {color, a, b}, vert?(i, j) -> st (per vertex), range?, gap?, skirt?, inset?, flip?, lines? }
// Cells of one id are one panel. Where a panel meets another (or a hole) its edge is pulled back by
// `gap` and a skirt `skirt` deep is turned in, its foot black: a shut line you can look into.
// `inset` pushes the whole panel in along the normal (glass in its frame, an inner lining);
// `flip` turns it to face inward. lines: darken the boundary vertices instead (far levels).
export function gridNormals(grid, sign = 1) {
  const { nx, ny, P } = grid;
  const N = new Float32Array(nx * ny * 3);
  const at = (i, j, o) => { const k = (Math.min(nx - 1, Math.max(0, i)) * ny + Math.min(ny - 1, Math.max(0, j))) * 3; o.set(P[k], P[k + 1], P[k + 2]); return o; };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3();
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    at(i + 1, j, a).sub(at(i - 1, j, b)); at(i, j + 1, c).sub(at(i, j - 1, d));
    a.cross(c);
    const l = a.length();
    const k = (i * ny + j) * 3;
    if (l > 1e-12) { N[k] = (a.x / l) * sign; N[k + 1] = (a.y / l) * sign; N[k + 2] = (a.z / l) * sign; } else N[k + 1] = 1;
  }
  grid.N = N;
  return grid;
}

const BLACK = [0.004, 0.004, 0.005];
const _e = new Vector3(), _c = new Vector3(), _o0 = new Vector3(), _o1 = new Vector3();
export function panelize(grid, cell) {
  const { nx, ny, P, N } = grid;
  const cw = ny - 1;
  const info = new Array((nx - 1) * cw);
  const pid = new Int32Array((nx - 1) * cw).fill(-1); // panel index of each cell (-1: a hole)
  const panels = [];
  const byId = new Map();
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < cw; j++) {
    const c = cell(i, j) || null;
    info[i * cw + j] = c;
    if (!c) continue;
    let p = byId.get(c.id);
    if (!p) { p = { c, cells: [], k: panels.length }; byId.set(c.id, p); panels.push(p); }
    p.cells.push(i, j);
    pid[i * cw + j] = p.k;
  }
  // -2 outside the grid, -1 a hole, else the panel
  const idOf = (i, j) => (i < 0 || j < 0 || i >= nx - 1 || j >= cw ? -2 : pid[i * cw + j]);
  const nv = nx * ny;
  const stamp = new Int32Array(nv).fill(-1), vix = new Int32Array(nv), sh = new Float32Array(nv * 7);
  for (const { c, cells, k: me } of panels) {
    const buf = c.buf;
    const sg = c.flip ? -1 : 1;
    const emit = () => {
      // where a vertex of this panel sits: pulled back from the panel's edge by the gap, pushed in by the inset
      const place = (i, j) => {
        const key = i * ny + j, o = key * 7;
        if (stamp[key] === me) return o;
        stamp[key] = me; vix[key] = -1;
        const k = key * 3;
        const px = P[k], py = P[k + 1], pz = P[k + 2], nx0 = N[k], ny0 = N[k + 1], nz0 = N[k + 2];
        let mine = 0, other = 0, dx = 0, dy = 0, dz = 0;
        for (let q = 0; q < 4; q++) {
          const ci = i - (q & 1), cj = j - (q >> 1);
          const id = idOf(ci, cj);
          if (id === -2) continue;
          if (id === me) {
            mine++;
            const a = (ci * ny + cj) * 3, b = a + 3, d = a + ny * 3, f = d + 3;
            dx += (P[a] + P[b] + P[d] + P[f]) / 4 - px; dy += (P[a + 1] + P[b + 1] + P[d + 1] + P[f + 1]) / 4 - py; dz += (P[a + 2] + P[b + 2] + P[d + 2] + P[f + 2]) / 4 - pz;
          } else other++;
        }
        let bnd = 0;
        if (other > 0 && mine > 0) {
          const dn = dx * nx0 + dy * ny0 + dz * nz0;
          dx -= nx0 * dn; dy -= ny0 * dn; dz -= nz0 * dn;
          const l = Math.hypot(dx, dy, dz);
          if (l > 1e-6) { dx /= l; dy /= l; dz /= l; bnd = 1; } else { dx = 0; dy = 0; dz = 0; }
        } else { dx = 0; dy = 0; dz = 0; }
        const g = bnd ? (c.gap || 0) : 0, ins = c.inset || 0;
        sh[o] = px + dx * g - nx0 * ins; sh[o + 1] = py + dy * g - ny0 * ins; sh[o + 2] = pz + dz * g - nz0 * ins;
        sh[o + 3] = dx; sh[o + 4] = dy; sh[o + 5] = dz; sh[o + 6] = bnd;
        return o;
      };
      const vertex = (i, j) => {
        const key = i * ny + j;
        const o = place(i, j);
        if (vix[key] >= 0) return vix[key];
        const k = key * 3;
        const s = c.vert ? c.vert(i, j, sh[o + 6]) : c.st;
        let col = s.color || WHITE;
        if (c.lines && sh[o + 6]) col = [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25];
        const v = buf.vert(sh[o], sh[o + 1], sh[o + 2], N[k] * sg, N[k + 1] * sg, N[k + 2] * sg, col, s.a, s.b);
        vix[key] = v;
        return v;
      };
      const pa = buf.pos, na = buf.nrm;
      for (let q = 0; q < cells.length; q += 2) {
        const i = cells[q], j = cells[q + 1];
        const a = vertex(i, j), b = vertex(i + 1, j), d = vertex(i, j + 1), f = vertex(i + 1, j + 1);
        // facing: the normal at the corner decides the winding
        const A = a * 3, Bq = b * 3, D = d * 3;
        _e.set(pa[Bq] - pa[A], pa[Bq + 1] - pa[A + 1], pa[Bq + 2] - pa[A + 2]);
        _c.set(pa[D] - pa[A], pa[D + 1] - pa[A + 1], pa[D + 2] - pa[A + 2]);
        _e.cross(_c);
        if (_e.x * na[A] + _e.y * na[A + 1] + _e.z * na[A + 2] >= 0) { buf.tri(a, b, d); buf.tri(b, f, d); } else { buf.tri(a, d, b); buf.tri(b, d, f); }
      }
      // skirts along every edge shared with another panel or a hole
      const depth = c.skirt || 0;
      if (depth > 0) {
        const dk = c.skirtColor || BLACK;
        const edge = (i0, j0, i1, j1) => {
          const s0 = place(i0, j0), s1 = place(i1, j1);
          const k0 = (i0 * ny + j0) * 3, k1 = (i1 * ny + j1) * 3;
          const st0 = c.vert ? c.vert(i0, j0, 1) : c.st, st1 = c.vert ? c.vert(i1, j1, 1) : c.st;
          _o0.set(N[k0] * sg * 0.75 - sh[s0 + 3], N[k0 + 1] * sg * 0.75 - sh[s0 + 4], N[k0 + 2] * sg * 0.75 - sh[s0 + 5]).normalize();
          _o1.set(N[k1] * sg * 0.75 - sh[s1 + 3], N[k1 + 1] * sg * 0.75 - sh[s1 + 4], N[k1 + 2] * sg * 0.75 - sh[s1 + 5]).normalize();
          const t0 = buf.vert(sh[s0], sh[s0 + 1], sh[s0 + 2], _o0.x, _o0.y, _o0.z, st0.color, st0.a, st0.b);
          const t1 = buf.vert(sh[s1], sh[s1 + 1], sh[s1 + 2], _o1.x, _o1.y, _o1.z, st1.color, st1.a, st1.b);
          const b0 = buf.vert(sh[s0] - N[k0] * sg * depth, sh[s0 + 1] - N[k0 + 1] * sg * depth, sh[s0 + 2] - N[k0 + 2] * sg * depth, -sh[s0 + 3], -sh[s0 + 4], -sh[s0 + 5], dk, c.skirtA || st0.a, st0.b);
          const b1 = buf.vert(sh[s1] - N[k1] * sg * depth, sh[s1 + 1] - N[k1 + 1] * sg * depth, sh[s1 + 2] - N[k1 + 2] * sg * depth, -sh[s1 + 3], -sh[s1 + 4], -sh[s1 + 5], dk, c.skirtA || st1.a, st1.b);
          // face away from the panel
          const q = buf.pos;
          _e.set(q[t1 * 3] - q[t0 * 3], q[t1 * 3 + 1] - q[t0 * 3 + 1], q[t1 * 3 + 2] - q[t0 * 3 + 2]);
          _c.set(q[b0 * 3] - q[t0 * 3], q[b0 * 3 + 1] - q[t0 * 3 + 1], q[b0 * 3 + 2] - q[t0 * 3 + 2]);
          _e.cross(_c);
          if (_e.x * -sh[s0 + 3] + _e.y * -sh[s0 + 4] + _e.z * -sh[s0 + 5] >= 0) { buf.tri(t0, t1, b0); buf.tri(t1, b1, b0); } else { buf.tri(t0, b0, t1); buf.tri(t1, b0, b1); }
        };
        const open = (id) => id !== me && (id !== -2 || c.skirtEdge);
        for (let q = 0; q < cells.length; q += 2) {
          const i = cells[q], j = cells[q + 1];
          if (open(idOf(i - 1, j))) edge(i, j, i, j + 1);
          if (open(idOf(i + 1, j))) edge(i + 1, j, i + 1, j + 1);
          if (open(idOf(i, j - 1))) edge(i, j, i + 1, j);
          if (open(idOf(i, j + 1))) edge(i, j + 1, i + 1, j + 1);
        }
      }
    };
    if (c.range) buf.range(c.range, emit); else emit();
  }
}

// ---- wheels -----------------------------------------------------------------------------------------
// All wheel geometry is unit size (radius 1, width 1, axis z, +z the outer face) and placed by an
// instance matrix that scales it, so every car and the lorry share one tyre mesh and one rim mesh.
const withAttrs = (g, color, cls, fx = [0.5, 0.15, 0, 0]) => {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3), a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col.set(color, i * 3); a[i * 4] = cls; b.set(fx, i * 4); }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aMat', new BufferAttribute(a, 4));
  g.setAttribute('aFx', new BufferAttribute(b, 4));
  return g;
};
const TYRE_PROFILE = [[0.6, -0.42], [0.68, -0.5], [0.8, -0.53], [0.92, -0.5], [0.985, -0.4], [1.0, -0.15], [1.0, 0.15], [0.985, 0.4], [0.92, 0.5], [0.8, 0.53], [0.68, 0.5], [0.6, 0.42]];
export function tyreGeometry(flat = false, seg = 28) {
  const g = lathe(TYRE_PROFILE, seg).rotateX(Math.PI / 2);
  if (flat) {
    // the weight of the car on an airless tyre: the foot spreads, the sidewalls fold out over it
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < -0.45) { const k = (-0.45 - y) / 0.55; y = -0.45 - k * 0.19; z *= 1 + 0.28 * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5); x *= 1 + 0.1 * k; }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
  }
  return withAttrs(g, [0.007, 0.007, 0.008], 7, [0.4, 0, 0, 0]);
}
// rim: 'alloy' (five spokes over a disc and caliper) or 'steel' (a dished pressing with a hub cap)
export function rimGeometry(kind = 'alloy') {
  const buf = new VBuf([0.45, 0.12, 0, 0.55]); // (half sheltered, in its arch: a soaked dish mirrors the horizon as a bar across the wheel)
  const R = 0.6;
  const SILVER = { color: [0.5, 0.52, 0.55], a: [2, 0, 0, 0] }, DARK = { color: [0.012, 0.012, 0.014], a: [1, 0, 0, 0] };
  const STEEL = { color: [0.2, 0.2, 0.21], a: [5, 0, 0, 0], b: [0.4, 0.5, 0, 0] };
  // a face of revolution looking out along +z: three winds a lathe to face the other way for a
  // profile that runs outward, so it is given the profile reversed
  const face = (pts, seg) => lathe(pts.slice().reverse(), seg).rotateX(Math.PI / 2);
  // barrel and the back of the well
  buf.add(cyl(R, R, 0.8, 18, true).rotateX(Math.PI / 2), kind === 'alloy' ? SILVER : { color: [0.16, 0.17, 0.18], a: [5, 0, 0, 0] }, M(0, 0, -0.02));
  buf.add(cyl(R, R, 0.02, 14).rotateX(Math.PI / 2), DARK, M(0, 0, -0.36));
  // outer lip
  buf.add(face([[R - 0.05, 0.36], [R, 0.4], [R + 0.03, 0.44], [R + 0.03, 0.4]], 22), kind === 'alloy' ? SILVER : { color: [0.34, 0.35, 0.37], a: [0, 0, 0, 0], b: [0.45, 0.14, 0, 0.55] });
  if (kind === 'alloy') {
    // brake disc and caliper, seen between the spokes
    buf.add(cyl(0.45, 0.45, 0.06, 16).rotateX(Math.PI / 2), STEEL, M(0, 0, 0.08));
    buf.add(cyl(0.2, 0.2, 0.1, 8).rotateX(Math.PI / 2), STEEL, M(0, 0, 0.12));
    buf.add(box(0.2, 0.3, 0.16, 0.03, 1), { color: [0.05, 0.05, 0.055], a: [1, 0, 0, 0] }, M(-0.3, 0.26, 0.1, 0, 0, 0.85));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.31;
      // a spoke: wide at the rim, waisted at the hub, set back toward the centre
      const g = box(0.46, 0.13, 0.07);
      const p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setY(k, p.getY(k) * (0.75 + 0.9 * (x + 0.23))); p.setZ(k, p.getZ(k) - 0.09 * (0.23 - x)); }
      g.computeVertexNormals();
      buf.add(g, SILVER, M(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.36, 0, 0, a));
      buf.add(cyl(0.022, 0.022, 0.03, 6).rotateX(Math.PI / 2), { color: [0.3, 0.3, 0.31], a: [2, 0, 0, 0] }, M(Math.cos(a + 0.63) * 0.15, Math.sin(a + 0.63) * 0.15, 0.33));
    }
    buf.add(face([[0, 0.34], [0.1, 0.34], [0.14, 0.3], [0.17, 0.24]], 14), SILVER);
  } else {
    // pressed steel, painted: a dished centre with eight vent holes, a chromed cap over the nuts
    const WHEEL = { color: [0.34, 0.35, 0.37], a: [0, 0, 0, 0], b: [0.45, 0.14, 0, 0.55] };
    buf.add(face([[0.16, 0.36], [0.24, 0.35], [0.33, 0.29], [0.44, 0.235], [0.52, 0.25], [R - 0.03, 0.35]], 20), WHEEL);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      buf.add(cyl(0.05, 0.05, 0.012, 8).rotateX(Math.PI / 2), DARK, M(Math.cos(a) * 0.43, Math.sin(a) * 0.43, 0.243, 0, 0, a + Math.PI / 2, 1.7, 1, 1));
    }
    buf.add(face([[0, 0.45], [0.09, 0.445], [0.16, 0.42], [0.2, 0.385], [0.215, 0.35]], 16), { color: [0.62, 0.64, 0.67], a: [2, 0, 0, 0], b: [0.3, 0.08, 0, 0.3] });
  }
  return buf.geometry();
}

// One geometry for every wheel of every vehicle: the tyre and both rims, each rim's vertices named in
// aMat.w (1 alloy, 2 steel; 0 the tyre). The wheel material's vertex stage (mats/carPaint.js,
// CAR_WHEEL) drops the rim an instance does not wear and treads a flat tyre down onto its rim, from
// the per-instance aWheel (x: rim worn, y: 1 flat): one draw call a zone, whatever stands in it.
export function wheelGeometry() {
  const parts = [[tyreGeometry(false), 0], [rimGeometry('alloy'), 1], [rimGeometry('steel'), 2]];
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.getAttribute('position').count; ni += g.getIndex().count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), a = new Float32Array(nv * 4), b = new Float32Array(nv * 4), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  for (const [g, part] of parts) {
    const n = g.getAttribute('position').count, u = g.getAttribute('uv');
    pos.set(g.getAttribute('position').array, v0 * 3); nrm.set(g.getAttribute('normal').array, v0 * 3); col.set(g.getAttribute('color').array, v0 * 3);
    a.set(g.getAttribute('aMat').array, v0 * 4); b.set(g.getAttribute('aFx').array, v0 * 4);
    // a rim has no tread: its uv sits on the flat strip along the edge of the tyre's normal bake
    for (let i = 0; i < n; i++) { a[(v0 + i) * 4 + 3] = part; uv[(v0 + i) * 2] = u ? u.getX(i) : 0.5; uv[(v0 + i) * 2 + 1] = u ? u.getY(i) : 0.004; }
    const ix = g.getIndex().array;
    for (let i = 0; i < ix.length; i++) idx[i0 + i] = ix[i] + v0;
    v0 += n; i0 += ix.length;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3)); out.setAttribute('normal', new BufferAttribute(nrm, 3)); out.setAttribute('color', new BufferAttribute(col, 3));
  out.setAttribute('aMat', new BufferAttribute(a, 4)); out.setAttribute('aFx', new BufferAttribute(b, 4)); out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  return out;
}

// ---- the layer -----------------------------------------------------------------------------------------
// record: { kind, id, prop, far, build(lod) -> { body: VBuf, glass?: VBuf, lit?: VBuf, wheels: [{ m: Matrix4 (unit wheel -> vehicle), flat, rim }], plates: [{ m, text }] },
//           lid?: Matrix4 (what 'lid' ranges move by when searched), reach: metres from the origin to its far end }
const REG = { builder: null, recs: [], layer: null, polling: false };
export const NEAR = 0, MID = 1, FAR = 2;

export function registerVehicle(B, rec) {
  // (a builder is known by its collider list: props wrap the builder object, they share that array)
  if (REG.builder !== B.colliders) { REG.builder = B.colliders; REG.recs = []; }
  rec.zone = B.zoneName;
  rec.matrix = B.matrix();
  rec.occluders = B.rainOccluders;
  rec.searched = false;
  rec.handle = { setSearched(on) { rec.searched = !!on; if (rec.apply) rec.apply(); }, setState() {} };
  REG.recs.push(rec);
  if (!REG.polling && typeof window !== 'undefined' && typeof requestAnimationFrame === 'function') {
    REG.polling = true;
    const poll = () => {
      const G = window.__G;
      if (G && G.level && G.scene && G.mats && !G.mats.stub) { try { installVehicles(G); } catch (err) { console.error(`[vehicles] ${err && err.stack ? err.stack : err}`); } } else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }
  return rec.handle;
}
export const vehicleRecords = () => REG.recs;
// car.js registers how to make test vehicles (kept out of this file: it knows no vehicle types)
export const setTestVehicles = (fn) => { REG.testVehicles = fn; };

// how sheltered a world point is: 1 well under a roof, falling to 0 a metre in from its drip line
function shelterAt(occ, x, y, z) {
  let s = 0;
  for (let i = 0; i < occ.length; i++) {
    const o = occ[i];
    if (o.min[1] < y + 0.3) continue;
    const d = Math.min(x - o.min[0], o.max[0] - x, z - o.min[2], o.max[2] - z);
    if (d > 0) s = Math.max(s, Math.min(1, d / 1.2));
  }
  return s;
}
function applyShelter(buf, m, occ) {
  if (!occ || !occ.length) return;
  for (let i = 0; i < buf.n; i++) {
    _v.set(buf.pos[i * 3], buf.pos[i * 3 + 1], buf.pos[i * 3 + 2]).applyMatrix4(m);
    const s = shelterAt(occ, _v.x, _v.y, _v.z);
    if (s > buf.b[i * 4 + 3]) buf.b[i * 4 + 3] = s;
  }
}

class VehicleRoot extends Group {
  updateMatrixWorld(force) { if (this.tick) this.tick(); super.updateMatrixWorld(force); }
}

const _lid = new Matrix4();
// move the 'lid' ranges of a geometry to open or shut, in place; light or douse the 'lidGlow' ranges
function setLid(geo, r, lid, open) {
  if (!r) return;
  const base = geo.userData.base || (geo.userData.base = {});
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  if (r.lid && lid) {
    if (!base.p) { base.p = p.array.slice(); base.n = n.array.slice(); }
    _lid.copy(lid); _m3.getNormalMatrix(_lid);
    for (let q = 0; q < r.lid.length; q++) {
      const s = r.lid[q][0], c = r.lid[q][1];
      for (let i = s; i < s + c; i++) {
        _v.set(base.p[i * 3], base.p[i * 3 + 1], base.p[i * 3 + 2]); _n.set(base.n[i * 3], base.n[i * 3 + 1], base.n[i * 3 + 2]);
        if (open) { _v.applyMatrix4(_lid); _n.applyMatrix3(_m3).normalize(); }
        p.setXYZ(i, _v.x, _v.y, _v.z); n.setXYZ(i, _n.x, _n.y, _n.z);
      }
    }
    p.needsUpdate = true; n.needsUpdate = true;
  }
  if (r.lidGlow) {
    const a = geo.getAttribute('aMat'), col = geo.getAttribute('color');
    if (!base.a) { base.a = a.array.slice(); base.c = col.array.slice(); }
    const basic = geo.userData.lit;
    for (let q = 0; q < r.lidGlow.length; q++) {
      const s = r.lidGlow[q][0], c = r.lidGlow[q][1];
      for (let i = s; i < s + c; i++) {
        if (basic) col.setXYZ(i, open ? base.c[i * 3] : 0, open ? base.c[i * 3 + 1] : 0, open ? base.c[i * 3 + 2] : 0);
        else a.setY(i, open ? base.a[i * 4 + 1] : 0);
      }
    }
    a.needsUpdate = true; col.needsUpdate = true;
  }
}
// a buffer's named ranges, moved by a vertex offset (for a buffer merged into a larger one)
const offsetRanges = (ranges, off) => { const o = {}; for (const k in ranges) o[k] = ranges[k].map(([s, c]) => [s + off, c]); return o; };
// show or hide one vehicle's triangles in a merged mesh: its indices are restored or collapsed
function setSpan(geo, i0, i1, on) {
  if (!geo || i1 <= i0) return;
  const ix = geo.getIndex(), master = geo.userData.master;
  if (on) for (let i = i0; i < i1; i++) ix.array[i] = master[i]; else ix.array.fill(0, i0, i1);
  ix.needsUpdate = true;
}

export function installVehicles(G) {
  if (REG.layer) return REG.layer;
  const mats = createCarMats(G);
  const root = new VehicleRoot();
  root.name = 'vehicles';
  const zones = new Map();
  const zoneGroup = (name) => {
    let z = zones.get(name);
    if (!z) { z = new Group(); z.name = `vehicles:${name}`; zones.set(name, z); root.add(z); }
    return z;
  };
  const mesh = (geo, mat, order = 0, reflect = false) => {
    const m = new Mesh(geo, mat);
    m.receiveShadow = mat !== mats.lit && mat !== mats.glass;
    m.renderOrder = order;
    if (!reflect) m.userData.noReflect = true;
    return m;
  };
  const cars = [];
  const stats = { near: 0, mid: 0, far: 0, tris: [0, 0, 0] };
  const farBuf = new Map(); // zone -> { body, lit }
  // Wheels in full (tread, sidewall, a real rim) are instanced, one call a zone, and only for what is
  // close: a car's while it is at its near level, the lorry's always. At the middle level a car's
  // wheels are drums with a hub in its own merged body.
  const wheels = new Map(); // zone -> [{ m, rim: 0 none | 1 alloy | 2 steel, flat, car }]
  const plates = new Map(); // zone -> [{ m, text }]
  const push = (map, zone, make) => { let v = map.get(zone); if (!v) { v = make(); map.set(zone, v); } return v; };

  // harness: ?vehtest=<name> stands extra vehicles on the open lot (see car.js testVehicles)
  const test = typeof window !== 'undefined' && /[?&]vehtest=([\w,-]+)/.exec(window.location.search);
  const extra = test && REG.testVehicles ? REG.testVehicles(test[1]) : [];
  // The middle level of every vehicle of a zone lives in three merged meshes (body, glass, lit) with
  // the far traffic: one draw call each however many vehicles stand there. A vehicle drawn at its
  // near level has its span of the merged index buffers collapsed.
  const mids = new Map(); // zone -> { body, glass, lit: VBuf, geo: { body, glass, lit } }
  const midOf = (zone) => push(mids, zone, () => ({ body: new VBuf(), glass: new VBuf(), lit: new VBuf(), geo: {} }));
  const addWheels = (rec, b, car = null) => {
    const w = push(wheels, rec.zone, () => []);
    const drums = rec.far || !rec.oneLevel; // far traffic and cars at the middle level; the lot's lorry keeps full wheels
    for (const wh of b.wheels || []) {
      if (!rec.far) w.push({ m: new Matrix4().multiplyMatrices(rec.matrix, wh.m), rim: wh.rim === 'steel' ? 2 : wh.rim === 'none' ? 0 : 1, flat: wh.flat ? 1 : 0, car: rec.oneLevel ? null : car });
      if (drums) {
        b.body.add(cyl(1, 1, 1.04, 14).rotateX(Math.PI / 2), { color: [0.007, 0.007, 0.008], a: [7, 0, 0, 0], b: [0.4, 0, 0, 0] }, wh.m);
        b.body.add(cyl(0.6, 0.6, 0.03, 10).rotateX(Math.PI / 2), wh.rim === 'steel' ? { color: [0.34, 0.35, 0.37], a: [0, 0, 0, 0], b: [0.45, 0.14, 0, 0.55] } : { color: [0.5, 0.52, 0.55], a: [2, 0, 0, 0], b: [0.45, 0.12, 0, 0.55] }, _m4b.copy(wh.m).multiply(M(0, 0, 0.52)));
        b.body.add(cyl(0.2, 0.2, 0.03, 8).rotateX(Math.PI / 2), { color: [0.02, 0.02, 0.022], a: [1, 0, 0, 0] }, _m4b.copy(wh.m).multiply(M(0, 0, 0.535)));
      }
    }
    const pl = push(plates, rec.zone, () => []);
    for (const p of b.plates || []) pl.push({ m: new Matrix4().multiplyMatrices(rec.matrix, p.m), text: p.text, w: p.w || 0.32, h: p.h || 0.16 });
  };
  for (const rec of [...REG.recs, ...extra]) {
    const z = midOf(rec.zone);
    if (rec.far) {
      const b = rec.build(FAR);
      addWheels(rec, b);
      z.body.merge(b.body, rec.matrix);
      if (b.lit && b.lit.n) z.lit.merge(b.lit, rec.matrix);
      stats.far += b.body.triangles;
      continue;
    }
    const g = new Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(rec.matrix);
    zoneGroup(rec.zone).add(g);
    const e = rec.matrix.elements;
    const car = { rec, group: g, zone: z, x: e[12], y: e[13], z: e[14], near: null, lod: -1, span: {}, ranges: {}, lidWorld: null };
    // middle level: into the zone's merged buffers
    {
      const b = rec.build(MID);
      addWheels(rec, b, car);
      for (const k of ['body', 'glass', 'lit']) {
        const buf = b[k];
        if (!buf || !buf.n) continue;
        if (k !== 'lit') applyShelter(buf, rec.matrix, rec.occluders);
        const v0 = z[k].n, i0 = z[k].idx.length;
        z[k].merge(buf, rec.matrix);
        car.span[k] = [i0, z[k].idx.length];
        car.ranges[k] = offsetRanges(buf.ranges, v0);
        stats.tris[MID] += buf.triangles;
      }
      if (rec.lid) car.lidWorld = new Matrix4().multiplyMatrices(rec.matrix, rec.lid).multiply(new Matrix4().copy(rec.matrix).invert());
    }
    // near level: its own three meshes, built when first wanted
    car.build = () => {
      const b = rec.build(NEAR);
      const out = [];
      for (const [k, buf] of [['body', b.body], ['glass', b.glass], ['lit', b.lit]]) {
        if (!buf || !buf.n) continue;
        if (k !== 'lit') applyShelter(buf, rec.matrix, rec.occluders);
        const geo = buf.geometry();
        if (k === 'lit') geo.userData.lit = true;
        const m = mesh(geo, k === 'body' ? mats.body : k === 'glass' ? mats.glass : mats.lit, k === 'glass' ? 10 : 0, k === 'lit');
        m.visible = false;
        setLid(geo, geo.userData.ranges, rec.lid, rec.searched);
        g.add(m);
        out.push(m);
        stats.tris[NEAR] += buf.triangles;
      }
      car.near = out;
    };
    rec.apply = () => {
      if (car.near) for (const m of car.near) setLid(m.geometry, m.geometry.userData.ranges, rec.lid, rec.searched);
      for (const k of ['body', 'lit']) if (z.geo[k] && car.ranges[k]) setLid(z.geo[k], car.ranges[k], car.lidWorld, rec.searched);
    };
    cars.push(car);
    if (G.level && G.level.props && rec.prop) G.level.props[rec.prop] = rec.handle;
  }
  for (const [zone, z] of mids) {
    for (const k of ['body', 'glass', 'lit']) {
      if (!z[k].n) continue;
      const geo = z[k].geometry();
      geo.userData.master = geo.getIndex().array.slice();
      if (k === 'lit') geo.userData.lit = true;
      z.geo[k] = geo;
      const m = mesh(geo, k === 'body' ? mats.body : k === 'glass' ? mats.glass : mats.lit, k === 'glass' ? 10 : 0, k === 'lit');
      m.frustumCulled = false;
      zoneGroup(zone).add(m);
    }
  }
  for (const car of cars) { car.rec.apply(); if (G.params && G.params.searched === 'all') car.rec.handle.setSearched(true); }
  // wheels: instanced across every vehicle of the zone
  const wheelGeo = wheelGeometry();
  const wheelSets = new Map(); // zone -> { list, im, aw, dirty }
  for (const [zone, list] of wheels) {
    if (!list.length) continue;
    // the zone's own geometry over the shared buffers, for its per-instance attribute
    const geo = new BufferGeometry();
    for (const k in wheelGeo.attributes) geo.setAttribute(k, wheelGeo.attributes[k]);
    geo.setIndex(wheelGeo.index);
    const aw = new InstancedBufferAttribute(new Float32Array(list.length * 2), 2);
    geo.setAttribute('aWheel', aw);
    const im = new InstancedMesh(geo, mats.tyreMaterial(), list.length);
    im.frustumCulled = false; im.receiveShadow = true; im.userData.noReflect = true;
    zoneGroup(zone).add(im);
    wheelSets.set(zone, { list, im, aw, dirty: true });
  }
  // the instances drawn: the wheels of what is near (written in place; nothing allocated)
  const refreshWheels = (set) => {
    let n = 0;
    for (let i = 0; i < set.list.length; i++) {
      const w = set.list[i];
      if (w.car && w.car.lod !== NEAR) continue;
      set.im.setMatrixAt(n, w.m); set.aw.array[n * 2] = w.rim; set.aw.array[n * 2 + 1] = w.flat; n++;
    }
    set.im.count = n; set.im.visible = n > 0;
    set.im.instanceMatrix.needsUpdate = true; set.aw.needsUpdate = true;
    set.dirty = false;
  };
  const wheelList = [...wheelSets.values()];
  for (const car of cars) car.wheelSet = wheelSets.get(car.rec.zone) || null;
  // number plates: one sheet, one mesh a zone
  for (const [zone, list] of plates) {
    if (!list.length) continue;
    const texts = [...new Set(list.map((p) => p.text))];
    const sheet = mats.plates(texts);
    const pos = [], nrm = [], uv = [], idx = [];
    list.forEach((p, i) => {
      const [u0, v0, u1, v1] = sheet.uv(texts.indexOf(p.text));
      // a plate faces +x in its own space
      const c = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
      _n.set(1, 0, 0).transformDirection(p.m);
      for (const [sz, sy, u, v] of c) { _v.set(0, (sy * p.h) / 2, (-sz * p.w) / 2).applyMatrix4(p.m); pos.push(_v.x, _v.y, _v.z); nrm.push(_n.x, _n.y, _n.z); uv.push(u, v); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    const pm = mesh(g, sheet.material, 2);
    pm.material.side = DoubleSide;
    zoneGroup(zone).add(pm);
  }

  // ---- per frame: which level each vehicle is drawn at (no allocation)
  let lastFrame = -1;
  const zoneList = [...zones];
  const queue = cars.filter((c) => !c.rec.oneLevel); // near levels still to build, one a frame, nearest first
  const nearRadius = () => {
    const q = G.quality || {};
    if (typeof q.vehicleNear === 'number') return q.vehicleNear;
    return (q.zombieLodFar ?? 12) >= 12 ? 9.5 : 0; // the mobile tier never draws the near level
  };
  const show = (car, lod) => {
    if (car.lod === lod) return;
    const near = lod === NEAR;
    if (car.near) for (let i = 0; i < car.near.length; i++) car.near[i].visible = near;
    const z = car.zone;
    if (car.span.body) setSpan(z.geo.body, car.span.body[0], car.span.body[1], !near);
    if (car.span.glass) setSpan(z.geo.glass, car.span.glass[0], car.span.glass[1], !near);
    if (car.span.lit) setSpan(z.geo.lit, car.span.lit[0], car.span.lit[1], !near);
    car.lod = lod;
    if (car.wheelSet) car.wheelSet.dirty = true;
  };
  root.tick = () => {
    const f = G.time ? G.time.frame : 0;
    if (f === lastFrame) return;
    lastFrame = f;
    mats.update(G.time ? G.time.t : 0);
    const ce = G.camera.matrixWorld.elements, cxw = ce[12], cyw = ce[13], czw = ce[14];
    const nr = nearRadius();
    const lv = G.level;
    for (let i = 0; i < zoneList.length; i++) { const lg = lv && lv.groups && lv.groups[zoneList[i][0]]; zoneList[i][1].visible = lg ? lg.visible : true; }
    let nearest = null, nd = Infinity;
    stats.near = 0; stats.mid = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const d = Math.hypot(c.x - cxw, c.y + 0.8 - cyw, c.z - czw) - (c.rec.reach || 2.4) * 0.5;
      c.dist = d;
      const want = !c.rec.oneLevel && nr > 0 && d < (c.lod === NEAR ? nr + 1.5 : nr) ? NEAR : MID;
      if (want === NEAR && !c.near && d < nd) { nd = d; nearest = c; }
      const have = want === NEAR && c.near ? NEAR : MID;
      show(c, have);
      if (have === NEAR) stats.near++; else stats.mid++;
    }
    for (let i = 0; i < wheelList.length; i++) if (wheelList[i].dirty) refreshWheels(wheelList[i]);
    // build ahead: the nearest wanted level first, otherwise work through the rest while idle
    if (nearest) nearest.build();
    else if (nr > 0 && queue.length) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < queue.length; i++) { if (queue[i].near) { queue[i] = queue[queue.length - 1]; queue.pop(); i--; continue; } if (queue[i].dist < bd) { bd = queue[i].dist; bi = i; } }
      if (bi >= 0) queue[bi].build();
    }
  };

  // ---- harness shots: ?shot=car-<id>-front34 | -rear34 | -side | -wheel | -lamp | -tail | -glass | -plate | -8m | -25m
  // for every vehicle that gave its dimensions (rec.dims), and truck-cab / truck-trailer
  const shots = {};
  const lookFrom = (m, from, to, fov = 55) => {
    const a = _v.set(from[0], from[1], from[2]).applyMatrix4(m).toArray(), b = _n.set(to[0], to[1], to[2]).applyMatrix4(m).toArray();
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]);
    return { cam: [a[0], a[1], a[2], Math.atan2(-d[0], -d[2]), Math.asin(d[1] / l)], fov };
  };
  // how much of the way from a vehicle out to a camera position is clear of the level's colliders (1: all of it)
  const _o = new Vector3(), _d = new Vector3();
  const clearance = (m, from, to) => {
    if (!G.level || !G.level.raycast) return 1;
    _o.set(to[0], to[1] + 0.5, to[2]).applyMatrix4(m); _d.set(from[0], from[1], from[2]).applyMatrix4(m).sub(_o);
    const len = _d.length(), start = Math.min(3.2, len * 0.6); // (start outside the vehicle's own boxes)
    _d.multiplyScalar(1 / len); _o.addScaledVector(_d, start);
    const hit = G.level.raycast(_o, _d, len - start);
    return hit ? (start + hit.dist) / len : 1;
  };
  for (const { rec } of cars) {
    const d = rec.dims, m = rec.matrix;
    if (!d || !rec.id) continue;
    const n = (k) => `${d.name || `car-${rec.id}`}-${k}`;
    if (d.truck) { shots[d.name] = lookFrom(m, d.from, d.to, 60); continue; }
    // stand on the flank asked for unless it is walled in and the other is not; then come in along
    // each line of sight as far as it takes to have nothing solid between the camera and the car
    let s = d.side || 1;
    if (clearance(m, [0, 1.45, s * 5], [0, 0.75, 0]) < 0.5 && clearance(m, [0, 1.45, -s * 5], [0, 0.75, 0]) > 0.8) s = -s;
    const view = (from, to, fov) => {
      const c = clearance(m, from, to), k = c >= 1 ? 1 : Math.max(0.35, c * 0.85);
      const f = [to[0] + (from[0] - to[0]) * k, from[1], to[2] + (from[2] - to[2]) * k];
      const shot = lookFrom(m, f, to, fov);
      // (never below the ground the camera stands over: the embankment beyond the drives)
      const gy = G.level && G.level.heightAt ? G.level.heightAt(shot.cam[0], shot.cam[2]) : null;
      if (Number.isFinite(gy) && shot.cam[1] < gy + 1.5) shot.cam[1] = gy + 1.5;
      return shot;
    };
    shots[n('front34')] = view([d.h + 2.9, 1.55, s * 3.3], [0.4, 0.75, 0]);
    shots[n('rear34')] = view([-d.h - 2.9, 1.55, s * 3.3], [-0.4, 0.75, 0]);
    shots[n('side')] = view([0, 1.45, s * 5], [0, 0.75, 0]);
    shots[n('wheel')] = lookFrom(m, [d.fx + 0.5, 0.75, s * (d.hw + 1.4)], [d.fx, 0.42, s * d.hw], 50);
    shots[n('lamp')] = lookFrom(m, [d.h + 1.25, 1.0, s * 0.9], [d.h, d.lampY, s * 0.45], 50);
    shots[n('tail')] = lookFrom(m, [-d.h - 1.25, 1.05, s * 0.8], [-d.h, d.tailY, s * 0.4], 50);
    shots[n('glass')] = lookFrom(m, [0.5, 1.5, s * (d.hw + 1.2)], [-0.2, d.belt + 0.15, 0]);
    shots[n('plate')] = lookFrom(m, [-d.h - 1.1, 0.9, s * 0.25], [-d.h, d.tailY - 0.15, 0], 45);
    shots[n('8m')] = view([d.h + 5, 1.7, s * 6], [0, 0.8, 0], 62);
    shots[n('25m')] = view([d.h + 16, 1.7, s * 19], [0, 0.8, 0], 62);
  }
  if (G.level && G.level.shots) Object.assign(G.level.shots, shots);
  if (G.params && shots[G.params.shot] && typeof window !== 'undefined' && typeof window.__setShot === 'function') window.__setShot(shots[G.params.shot]);

  G.scene.add(root);
  const layer = { root, cars, mats, stats, zones, shots };
  REG.layer = layer;
  if (typeof window !== 'undefined') window.__vehicles = layer;
  try {
    const target = G.post && G.post.targets && G.post.targets.scene;
    if (target && G.renderer.compileAsync && canCompileInParallel(G.renderer)) {
      const prev = G.renderer.getRenderTarget();
      G.renderer.setRenderTarget(target);
      G.renderer.compileAsync(root, G.camera, G.scene).catch(() => {});
      G.renderer.setRenderTarget(prev);
    }
  } catch (err) { /* the first frame compiles them instead */ }
  return layer;
}
