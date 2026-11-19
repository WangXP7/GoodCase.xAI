// Geometry builder for the level. Props add primitives to named buckets (one bucket = one material
// = one draw call) through a transform stack; colliders are authored in the same local space and
// come out as world axis-aligned boxes. Everything is merged once at the end.
import {
  BufferGeometry, BufferAttribute, Matrix4, Matrix3, Vector3, Quaternion, Euler, Shape, Path, ExtrudeGeometry,
  CylinderGeometry, LatheGeometry, TubeGeometry, CatmullRomCurve3, Vector2, BoxGeometry, SphereGeometry,
  TorusGeometry, PlaneGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _v = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const WHITE = [1, 1, 1];

// Compose a transform: position, euler rotation (YXZ order: yaw first), scale.
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  return new Matrix4().compose(new Vector3(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

// ---- primitives (all return a BufferGeometry in their own local space) ---------------------------

// Bevelled box. Small parts get the coarsest bevel: a rounded corner a few pixels wide does not
// need more, and thousands of sub-pixel triangles are what makes multisampling expensive.
export const box = (w, h, d, bevel = 0, seg = 2) => {
  if (bevel > 0) return new RoundedBoxGeometry(w, h, d, Math.max(w, h, d) < 0.45 ? 1 : Math.min(seg, 2), Math.min(bevel, w / 2, h / 2, d / 2));
  return new BoxGeometry(w, h, d);
};
// box sitting on y = 0
export const boxUp = (w, h, d, bevel = 0, seg = 2) => box(w, h, d, bevel, seg).translate(0, h / 2, 0);
export const cyl = (rTop, rBot, h, seg = 16, open = false) => new CylinderGeometry(rTop, rBot, h, seg, 1, open);
export const cylUp = (rTop, rBot, h, seg = 16, open = false) => cyl(rTop, rBot, h, seg, open).translate(0, h / 2, 0);
export const sphere = (r, w = 12, h = 8) => new SphereGeometry(r, w, h);
export const torus = (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => new TorusGeometry(r, t, rs, ts, arc);
export const lathe = (pts, seg = 20) => new LatheGeometry(pts.map((p) => new Vector2(p[0], p[1])), seg);
export const plane = (w, h) => new PlaneGeometry(w, h);

// Tube through points (Catmull-Rom). pts: [[x,y,z], ...]
export function tube(pts, radius, radial = 6, perSeg = 6, closed = false) {
  const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(p[0], p[1], p[2])), closed, 'centripetal');
  return new TubeGeometry(curve, Math.max(2, (pts.length - 1) * perSeg), radius, radial, closed);
}

// A polygon with rounded corners. pts: [x, y, r?] in order; returns [[x,y], ...] sampled.
export function roundPoly(pts, segs = 5) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]; const a = pts[(i + n - 1) % n]; const b = pts[(i + 1) % n];
    const r = p[2] || 0;
    if (r <= 0) { out.push([p[0], p[1]]); continue; }
    let ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const d = Math.min(r, la * 0.45, lb * 0.45);
    const p0 = [p[0] + ax * d, p[1] + ay * d], p1 = [p[0] + bx * d, p[1] + by * d];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p1[1]]);
    }
  }
  return out;
}

export function shapeOf(points, holes = []) {
  const s = new Shape(points.map((p) => new Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new Path(h.map((p) => new Vector2(p[0], p[1]))));
  return s;
}

// Extrude a 2D outline (x, y) along z, centred on z = 0. Smooth normals across the bevel so edges
// catch a highlight instead of reading as a hard box corner.
export function extrude(points, depth, { bevel = 0, bevelSeg = 2, holes = [], smooth = true, steps = 1 } = {}) {
  const g = new ExtrudeGeometry(shapeOf(points, holes), {
    depth: Math.max(1e-4, depth - 2 * bevel), steps, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelOffset: -bevel, bevelSegments: bevelSeg, curveSegments: 6,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  g.deleteAttribute('uv');
  if (!smooth) return g;
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

// Move every vertex with fn(v) (v is a Vector3, edited in place), then recompute normals.
export function deform(geo, fn, renormal = true) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    fn(_v);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  p.needsUpdate = true;
  if (renormal) geo.computeVertexNormals();
  return geo;
}

// A quad in the XY plane facing +z with explicit UVs (u0, v0, u1, v1), for the signage atlas.
export function quadUV(w, h, uv) {
  const g = new PlaneGeometry(w, h);
  const a = g.getAttribute('uv');
  const [u0, v0, u1, v1] = uv;
  a.setXY(0, u0, v1); a.setXY(1, u1, v1); a.setXY(2, u0, v0); a.setXY(3, u1, v0);
  return g;
}

// ---- builder ---------------------------------------------------------------------------------

// Zones: `B.zone(name)` makes everything built after it land in that zone's buckets (one
// group per zone, culled as a whole), and `B.instance` / `B.fixture` record into the current zone.
// `finish()` returns the current zone's geometries (a single-zone build never calls B.zone);
// `finishZones()` returns them all. Colliders carry `prop` (what drawn prop they belong to: anything
// added through B.collide is drawn by definition; an invisible wall pushed straight into
// B.colliders has none, and the perimeter test fails on it) and `zone`.
export function createBuilder() {
  const zoneBuckets = new Map();
  const zoneInstances = new Map();
  let zone = 'main';
  const bucketsOf = (z) => { let m = zoneBuckets.get(z); if (!m) { m = new Map(); zoneBuckets.set(z, m); } return m; };
  let buckets = bucketsOf(zone);
  const colliders = [];
  const stack = [new Matrix4()];
  const top = () => stack[stack.length - 1];
  const nm = new Matrix3();

  function bucket(key) {
    let b = buckets.get(key);
    if (!b) { b = { key, pos: [], nrm: [], uv: [], col: [], idx: [], count: 0, hasUv: false, hasCol: false }; buckets.set(key, b); }
    return b;
  }

  function append(b, geo, mat, color, wantUv) {
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const base = b.count;
    nm.getNormalMatrix(mat);
    const flip = mat.determinant() < 0;
    const bake = typeof color === 'function';
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(mat);
      b.pos.push(_v.x, _v.y, _v.z);
      if (n) { _n.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); b.nrm.push(_n.x, _n.y, _n.z); } else b.nrm.push(0, 1, 0);
      if (wantUv) { if (uv) b.uv.push(uv.getX(i), uv.getY(i)); else b.uv.push(0, 0); }
      if (color) { const c = bake ? color(_n, _v) : color; b.col.push(c[0], c[1], c[2]); }
    }
    if (wantUv) b.hasUv = true;
    if (color) b.hasCol = true;
    const ix = geo.getIndex();
    const cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i += 3) {
      const a = ix ? ix.getX(i) : i, c = ix ? ix.getX(i + 1) : i + 1, d = ix ? ix.getX(i + 2) : i + 2;
      if (flip) b.idx.push(base + a, base + d, base + c); else b.idx.push(base + a, base + c, base + d);
    }
    b.count += p.count;
  }

  const B = {
    colliders,
    get buckets() { return buckets; },
    get zoneName() { return zone; },
    rainOccluders: [],
    fixtures: [],
    prop: null, // name of the prop being built: tags its colliders (B.tag)
    // everything built after this lands in zone `name` (its own group of meshes)
    zone(name) { zone = name; buckets = bucketsOf(name); return B; },
    // run fn with the current zone set to `name`, then restore it
    inZone(name, fn) { const prev = zone; B.zone(name); try { return fn(); } finally { B.zone(prev); } },
    // run fn with its colliders tagged as belonging to the drawn prop `name`
    tag(name, fn) { const prev = B.prop; B.prop = name; try { return fn(); } finally { B.prop = prev; } },
    // One InstancedMesh per key per zone: the geometry (shared, not merged) and material key given by
    // the first call, a world matrix per instance (the current transform times `matrix`).
    instance(key, geometry, materialKey, matrix) {
      let m = zoneInstances.get(zone);
      if (!m) { m = new Map(); zoneInstances.set(zone, m); }
      let rec = m.get(key);
      if (!rec) { rec = { key, geometry, material: materialKey, matrices: [] }; m.set(key, rec); }
      rec.matrices.push(matrix ? new Matrix4().multiplyMatrices(top(), matrix) : top().clone());
      return B;
    },
    // A light fixture in the current zone ({ kind, pos, dir?, needsPower?, ... }, as the level
    // registers them): culled with its zone, and with needsPower dark until the power is on.
    fixture(f) { B.fixtures.push({ ...f, zone: f.zone || zone }); return B; },
    // run fn with an extra transform on the stack
    at(m, fn) { stack.push(new Matrix4().multiplyMatrices(top(), m)); try { return fn(); } finally { stack.pop(); } },
    matrix: () => top().clone(),
    // world position of a local point
    point(x, y, z) { _v.set(x, y, z).applyMatrix4(top()); return [_v.x, _v.y, _v.z]; },
    dir(x, y, z) { _v.set(x, y, z).transformDirection(top()); return [_v.x, _v.y, _v.z]; },
    // Add geometry to a bucket. opts: m (local Matrix4), color [r,g,b] linear (buckets whose key
    // starts with 'vc' carry vertex colours) or a function (worldNormal, worldPos) => [r,g,b] for
    // baked shading, shadow (also add to the shadow-caster proxy).
    // Buckets whose key starts with 'atlas' or 'uv' keep UVs.
    add(key, geo, opts = {}) {
      const mat = opts.m ? new Matrix4().multiplyMatrices(top(), opts.m) : top();
      const vc = /vc/i.test(key);
      append(bucket(key), geo, mat, vc ? (opts.color || WHITE) : null, key.startsWith('atlas') || key.startsWith('uv'));
      if (opts.shadow) append(bucket('shadow'), geo, mat, null, false);
      if (B.prepass && B.prepass(key)) append(bucket('depth'), geo, mat, null, false);
      geo.dispose();
      return B;
    },
    // Soft contact shadow on the ground under whatever stands at the current transform: a dark
    // alpha quad, so things sit on the lot even where no shadow-casting lamp reaches them.
    blob(w, d, x = 0, z = 0, y = 0.012) {
      return B.add('uvBlob', new PlaneGeometry(w, d).rotateX(-Math.PI / 2), { m: M(x, y, z) });
    },
    // Stand-in for the puddle reflection, which draws only the 'vcRefl' bucket and the emissive
    // ones: a plain lit box in the prop's colour, given by local min/max. Big shapes only.
    refl(min, max, color) {
      return B.add('vcRefl', new BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), { m: M((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2), color });
    },
    // Raw triangles already in world space, one normal for all, colour per vertex.
    addRaw(key, pos, idx, col, normal) {
      const b = bucket(key);
      const base = b.count;
      for (let i = 0; i < pos.length; i += 3) { b.pos.push(pos[i], pos[i + 1], pos[i + 2]); b.nrm.push(normal[0], normal[1], normal[2]); }
      for (const c of col) b.col.push(c);
      b.hasCol = true;
      for (const i of idx) b.idx.push(base + i);
      b.count += pos.length / 3;
      return B;
    },
    // Collider box given in local space by min/max. Rotated transforms are covered by slices along
    // the box's longer horizontal axis, so every output box is world axis-aligned: that is what
    // capsule movement and navigation use. Each slice also carries the one oriented box it was cut
    // from (`obb`: centre, unit axes, half-extents), which is what rays are tested against, so a
    // bullet lands on the real panel with the panel's normal.
    collide(min, max, surface = 'metal', slice = 0.5) {
      const m = top();
      const e = m.elements;
      const sx = Math.hypot(e[0], e[1], e[2]);
      const cosY = e[0] / sx, sinY = -e[2] / sx; // yaw of the local x axis
      const aligned = Math.abs(sinY) < 0.02 || Math.abs(cosY) < 0.02;
      const out = (mn, mx) => {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < 8; k++) {
          _v.set(k & 1 ? mx[0] : mn[0], k & 2 ? mx[1] : mn[1], k & 4 ? mx[2] : mn[2]).applyMatrix4(m);
          lo[0] = Math.min(lo[0], _v.x); lo[1] = Math.min(lo[1], _v.y); lo[2] = Math.min(lo[2], _v.z);
          hi[0] = Math.max(hi[0], _v.x); hi[1] = Math.max(hi[1], _v.y); hi[2] = Math.max(hi[2], _v.z);
        }
        return { lo, hi };
      };
      const tagOf = () => (B.prop || 'drawn');
      if (aligned) {
        const { lo, hi } = out(min, max);
        colliders.push({ min: lo, max: hi, surface, prop: tagOf(), zone });
        return B;
      }
      const axis = (k) => { const l = Math.hypot(e[k], e[k + 1], e[k + 2]); return { v: [e[k] / l, e[k + 1] / l, e[k + 2] / l], l }; };
      const X = axis(0), Y = axis(4), Z = axis(8);
      _v.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).applyMatrix4(m);
      const obb = {
        c: [_v.x, _v.y, _v.z], ax: X.v, ay: Y.v, az: Z.v, surface,
        half: [((max[0] - min[0]) / 2) * X.l, ((max[1] - min[1]) / 2) * Y.l, ((max[2] - min[2]) / 2) * Z.l],
      };
      // slice along the long axis; each slice's AABB is shrunk across the short axis so the
      // staircase hugs the rotated box instead of wrapping its bounding box
      const lx = max[0] - min[0], lz = max[2] - min[2];
      const ax = lx >= lz ? 0 : 2;
      const len = ax === 0 ? lx : lz;
      const nS = Math.max(1, Math.ceil(len / slice));
      for (let i = 0; i < nS; i++) {
        const a = min[ax] + (len * i) / nS, b = min[ax] + (len * (i + 1)) / nS;
        const mid = (a + b) / 2;
        const mn = min.slice(), mx = max.slice();
        mn[ax] = mid; mx[ax] = mid; // the slice's centre line across the short axis
        const { lo, hi } = out(mn, mx);
        const half = (b - a) / 2;
        const ex = Math.abs(ax === 0 ? cosY : sinY) * half * sx, ez = Math.abs(ax === 0 ? sinY : cosY) * half * sx;
        colliders.push({ min: [lo[0] - ex, lo[1], lo[2] - ez], max: [hi[0] + ex, hi[1], hi[2] + ez], surface, obb, prop: tagOf(), zone });
      }
      return B;
    },
    // A roof the rain cannot fall through, given as a local box: pushed to B.rainOccluders as
    // world boxes (a run of them when the prop lies at an angle), from the same transform as the
    // geometry it belongs to.
    shelter(min, max, slice = 1.6) {
      const before = colliders.length;
      B.collide(min, max, 'metal', slice);
      for (const c of colliders.splice(before)) B.rainOccluders.push({ min: c.min, max: c.max });
      return B;
    },
    // Finish: one indexed BufferGeometry per bucket of the current zone.
    finish() { return finishBuckets(buckets); },
    // Every zone: Map(zone -> Map(bucket key -> geometry)).
    finishZones() {
      const out = new Map();
      for (const [z, m] of zoneBuckets) { const g = finishBuckets(m); if (g.size) out.set(z, g); }
      return out;
    },
    // Map(zone -> Map(key -> { key, geometry, material, matrices })).
    instances: zoneInstances,
  };
  function finishBuckets(bm) {
    {
      const out = new Map();
      for (const b of bm.values()) {
        if (!b.count) continue;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
        g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
        if (b.hasUv) g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
        if (b.hasCol) g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3));
        g.setIndex(new BufferAttribute(b.count > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        out.set(b.key, g);
        b.pos = b.nrm = b.uv = b.col = b.idx = null;
        b.count = 0;
      }
      return out;
    }
  }
  return B;
}

// sRGB hex -> linear [r, g, b], optionally scaled (for emissive radiance).
export function rgb(hex, scale = 1) {
  const c = (v) => { const s = v / 255; return (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * scale; };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}
