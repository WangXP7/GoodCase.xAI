// Helpers shared by the ingredient and item models (src/models/flora, src/models/items).
import { THREE, TAU, Rng, paint, col, cone } from '../kit.js';

const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

/**
 * A smooth path through `points`, the same curve kit.tube() sweeps along.
 * at(t) -> [x, y, z], dir(t) -> unit tangent. t is 0..1 by arc length.
 */
export function path(points) {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const v = new THREE.Vector3();
  const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  return {
    at: (t) => curve.getPointAt(cl(t), v).toArray(),
    dir: (t) => curve.getTangentAt(cl(t), v).toArray(),
    length: curve.getLength(),
  };
}

/** Turn a part built along +Y so it points along `dir`, then move its origin to `pos`. `roll` spins it about its own axis first. */
export function aim(geo, dir, pos = [0, 0, 0], roll = 0) {
  if (roll) geo.rotateY(roll);
  _d.set(dir[0], dir[1], dir[2]);
  if (_d.lengthSq() < 1e-12) _d.set(0, 1, 0);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _one);
  geo.applyMatrix4(_m);
  return geo;
}

/** A unit vector leaning `tilt` radians away from +Y toward the compass angle `yaw`. */
export function lean(tilt, yaw) {
  const s = Math.sin(tilt);
  return [Math.sin(yaw) * s, Math.cos(tilt), Math.cos(yaw) * s];
}

/** Open pyramid: base on the origin, tip at +Y. Three tris when sides = 3. */
export function spike(r, len, sides = 3) {
  const g = cone(r, len, sides, true);
  g.translate(0, len / 2, 0);
  return g;
}

/** A folded kite: base at the origin, tip at +Y, the fold ridge toward +Z. Four tris. */
export function kite(len, width, belly = 0.4, fold = 0.25) {
  const hw = width / 2,
    yb = len * belly,
    zf = hw * fold;
  // base, left, mid (ridge), right, tip
  const pos = [0, 0, 0, -hw, yb, 0, 0, yb, zf, hw, yb, 0, 0, len, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4]);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Faceted crystals with a "core": every flat face gets a centre vertex, so the middle of a face can
// be painted differently from its edges. That reads as depth inside the stone.
// ---------------------------------------------------------------------------------------------
function facets() {
  const pos = [],
    nor = [],
    core = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3(),
    e = new THREE.Vector3();
  const tri = (p, q, r, kp, kq, kr, out) => {
    a.set(p[0], p[1], p[2]);
    b.set(q[0], q[1], q[2]);
    c.set(r[0], r[1], r[2]);
    n.copy(b).sub(a).cross(e.copy(c).sub(a));
    if (n.lengthSq() < 1e-18) return;
    n.normalize();
    let flip = false;
    if (out) {
      // orient away from the given centre
      e.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(_p.set(out[0], out[1], out[2]));
      flip = n.dot(e) < 0;
    }
    if (flip) {
      n.negate();
      pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
      core.push(kp, kr, kq);
    } else {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      core.push(kp, kq, kr);
    }
    for (let i = 0; i < 3; i++) nor.push(n.x, n.y, n.z);
  };
  const build = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1));
    return g;
  };
  return { tri, build };
}

/**
 * Convex polygon faces -> flat facets fanned around each face centre (aCore = 1 there).
 * faces: arrays of [x, y, z] corners in order. `centre` is a point inside the solid (faces are
 * oriented away from it).
 */
export function facetSolid(faces, centre = [0, 0, 0]) {
  const f = facets();
  for (const face of faces) {
    if (face.length === 3) {
      const m = [0, 1, 2].map((k) => (face[0][k] + face[1][k] + face[2][k]) / 3);
      f.tri(face[0], face[1], m, 0, 0, 1, centre);
      f.tri(face[1], face[2], m, 0, 0, 1, centre);
      f.tri(face[2], face[0], m, 0, 0, 1, centre);
      continue;
    }
    const m = [0, 0, 0];
    for (const p of face) for (let k = 0; k < 3; k++) m[k] += p[k] / face.length;
    for (let i = 0; i < face.length; i++) f.tri(face[i], face[(i + 1) % face.length], m, 0, 0, 1, centre);
  }
  return f.build();
}

/**
 * Low-level facet builder for shapes that are not convex.
 *   poly(points, { toward | away, fan, rim, centre })  one flat polygon; `toward` / `away` is a point
 *     that fixes which way it faces; fan = true adds a centre vertex (aCore = centre there, rim on the edge)
 *   build() -> non-indexed geometry with flat normals and aCore
 */
export function facetBuilder() {
  const f = facets();
  const poly = (pts, { toward = null, away = null, fan = true, rim = 0, centre = 1 } = {}) => {
    const m = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) m[k] += p[k] / pts.length;
    // facing a point is the same as facing away from its mirror image in the polygon
    const ref = toward ? [2 * m[0] - toward[0], 2 * m[1] - toward[1], 2 * m[2] - toward[2]] : away;
    if (fan && pts.length > 3) {
      for (let i = 0; i < pts.length; i++) f.tri(pts[i], pts[(i + 1) % pts.length], m, rim, rim, centre, ref);
    } else {
      for (let i = 1; i < pts.length - 1; i++) f.tri(pts[0], pts[i], pts[i + 1], rim, rim, rim, ref);
    }
  };
  return { poly, build: f.build };
}

/**
 * A hopper cube centred on the origin, half edge h: every face is a stepped hollow, the way salt
 * grows when its edges outrun its faces. steps = [[size, depth], ...] as fractions of h, size
 * falling and depth rising; the last entry is the floor of the hollow.
 * Paint it with paintFlat(): a triangle's depth below its face is h - max(|cx|, |cy|, |cz|).
 */
export function hopperCube(h, steps) {
  const fb = facetBuilder();
  const S = [[1, 0], ...steps];
  for (let n = 0; n < 3; n++) {
    const u = (n + 1) % 3,
      v = (n + 2) % 3;
    for (const s of [-1, 1]) {
      const P = (su, sv, size, depth) => {
        const q = [0, 0, 0];
        q[n] = s * h * (1 - depth);
        q[u] = su * h * size;
        q[v] = sv * h * size;
        return q;
      };
      const eye = [0, 0, 0];
      eye[n] = s * h * 20;
      const C = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (let k = 0; k < S.length - 1; k++) {
        const [s0, d0] = S[k],
          [s1, d1] = S[k + 1];
        for (let i = 0; i < 4; i++) {
          const a = C[i],
            c = C[(i + 1) % 4];
          // the flat tread, then the riser that drops to the next level
          fb.poly([P(a[0], a[1], s0, d0), P(c[0], c[1], s0, d0), P(c[0], c[1], s1, d0), P(a[0], a[1], s1, d0)], { toward: eye, fan: false });
          fb.poly([P(a[0], a[1], s1, d0), P(c[0], c[1], s1, d0), P(c[0], c[1], s1, d1), P(a[0], a[1], s1, d1)], { toward: eye, fan: false });
        }
      }
      const [sf, df] = S[S.length - 1];
      fb.poly(
        C.map((c) => P(c[0], c[1], sf, df)),
        { toward: eye, fan: true }
      );
    }
  }
  return fb.build();
}

/** Split every triangle of any geometry into three around its centroid (aCore = 1 at the centroid). */
export function fanTris(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const f = facets();
  const P = (i) => [p.getX(i), p.getY(i), p.getZ(i)];
  for (let i = 0; i < p.count; i += 3) {
    const a = P(i),
      b = P(i + 1),
      c = P(i + 2);
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    f.tri(a, b, m, 0, 0, 1, null);
    f.tri(b, c, m, 0, 0, 1, null);
    f.tri(c, a, m, 0, 0, 1, null);
  }
  return f.build();
}

/**
 * A box centred on the origin whose six faces are fanned around their centres. `chamfer` > 0 cuts
 * the edges and corners (56 tris), 0 leaves a plain cube (24 tris).
 */
export function gemBox(w, h, d, chamfer = 0) {
  const H = [w / 2, h / 2, d / 2];
  const c = Math.min(chamfer, Math.min(H[0], H[1], H[2]) * 0.45);
  const faces = [];
  const pt = (vals) => vals;
  for (let n = 0; n < 3; n++) {
    const u = (n + 1) % 3,
      v = (n + 2) % 3;
    for (const s of [-1, 1]) {
      const face = [];
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const q = [0, 0, 0];
        q[n] = s * H[n];
        q[u] = su * (H[u] - c);
        q[v] = sv * (H[v] - c);
        face.push(pt(q));
      }
      faces.push(face);
    }
  }
  const g = facets();
  const O = [0, 0, 0];
  for (const face of faces) {
    const m = [0, 0, 0];
    for (const p of face) for (let k = 0; k < 3; k++) m[k] += p[k] / 4;
    for (let i = 0; i < 4; i++) g.tri(face[i], face[(i + 1) % 4], m, 0, 0, 1, O);
  }
  if (c > 0) {
    // edges: one quad between the two faces that meet along axis k
    for (let k = 0; k < 3; k++) {
      const i = (k + 1) % 3,
        j = (k + 2) % 3;
      for (const si of [-1, 1])
        for (const sj of [-1, 1]) {
          const mk = (a, bb, kk) => {
            const q = [0, 0, 0];
            q[i] = a;
            q[j] = bb;
            q[k] = kk;
            return q;
          };
          const A = mk(si * H[i], sj * (H[j] - c), -(H[k] - c));
          const B = mk(si * H[i], sj * (H[j] - c), H[k] - c);
          const C = mk(si * (H[i] - c), sj * H[j], H[k] - c);
          const D = mk(si * (H[i] - c), sj * H[j], -(H[k] - c));
          g.tri(A, B, C, 0, 0, 0, O);
          g.tri(A, C, D, 0, 0, 0, O);
        }
    }
    // corners
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const s = [sx, sy, sz];
          const P = (axis) => {
            const q = [s[0] * (H[0] - c), s[1] * (H[1] - c), s[2] * (H[2] - c)];
            q[axis] = s[axis] * H[axis];
            return q;
          };
          g.tri(P(0), P(1), P(2), 0, 0, 0, O);
        }
  }
  return g.build();
}

/**
 * An n-sided bipyramid crystal centred on the origin, long axis Y: rings of `sides` corners at the
 * given [radius, y] stations, capped flat at both ends. xz = [sx, sz] squashes the section.
 * Faces are fanned around their centres (aCore).
 */
export function prismCrystal(stations, sides = 6, { xz = [1, 1], yaw = 0, rng = null, irregular = 0 } = {}) {
  const rings = stations.map(([r, y]) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = yaw + (i / sides) * TAU;
      const k = 1 + (rng && irregular ? rng.range(-irregular, irregular) : 0);
      out.push([Math.cos(a) * r * xz[0] * k, y, Math.sin(a) * r * xz[1] * k]);
    }
    return out;
  });
  const faces = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      faces.push([rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]);
    }
  }
  if (stations[0][0] > 1e-6) faces.push(rings[0].slice().reverse());
  if (stations[stations.length - 1][0] > 1e-6) faces.push(rings[rings.length - 1]);
  const y0 = stations[0][1],
    y1 = stations[stations.length - 1][1];
  return facetSolid(
    faces.map((f) => dedupe(f)).filter((f) => f.length >= 3),
    [0, (y0 + y1) / 2, 0]
  );
}
function dedupe(face) {
  const out = [];
  for (const p of face) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0],
      b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9) out.pop();
  }
  return out;
}

/**
 * Paint a geometry that carries aCore. `edge` and `core` are { color, emissive, rough }; each value
 * may be a constant or a function (x, y, z) => value evaluated at the vertex. `common` is passed to
 * kit.paint() first (mat, metal, sway ...).
 */
export function paintCore(geo, edge, core, common = {}) {
  paint(geo, common);
  const k = geo.attributes.aCore;
  const pos = geo.attributes.position;
  const color = geo.attributes.color,
    fx = geo.attributes.aFx;
  const ev = (o, x, y, z, def) => (o === undefined ? def : typeof o === 'function' ? o(x, y, z) : o);
  const ca = new THREE.Color(),
    cb = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const t = k ? k.getX(i) : 0;
    ca.copy(col(ev(edge.color, x, y, z, '#ffffff')));
    cb.copy(col(ev(core.color, x, y, z, '#ffffff')));
    ca.lerp(cb, t);
    color.setXYZ(i, ca.r, ca.g, ca.b);
    const e0 = ev(edge.emissive, x, y, z, 0),
      e1 = ev(core.emissive, x, y, z, e0);
    fx.setX(i, e0 + (e1 - e0) * t);
    const r0 = ev(edge.rough, x, y, z, undefined),
      r1 = ev(core.rough, x, y, z, r0);
    if (r0 !== undefined) fx.setY(i, r0 + (r1 - r0) * t);
  }
  return geo;
}

/**
 * Paint a faceted (non-indexed) geometry one whole triangle at a time, so colour changes are crisp
 * along the facet edges. fn(cx, cy, cz, nx, ny, nz, triIndex) -> { color, emissive?, rough?, metal? }
 * evaluated at the triangle's centre. `common` goes to kit.paint() first.
 */
export function paintFlat(geo, fn, common = {}) {
  paint(geo, common);
  const pos = geo.attributes.position,
    nor = geo.attributes.normal;
  const color = geo.attributes.color,
    fx = geo.attributes.aFx,
    mat = geo.attributes.aMat;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
      cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
      cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const o = fn(cx, cy, cz, nor.getX(i), nor.getY(i), nor.getZ(i), i / 3);
    c.copy(col(o.color));
    for (let k = 0; k < 3; k++) {
      color.setXYZ(i + k, c.r, c.g, c.b);
      if (o.emissive !== undefined) fx.setX(i + k, o.emissive);
      if (o.rough !== undefined) fx.setY(i + k, o.rough);
      if (o.metal !== undefined) fx.setZ(i + k, o.metal);
      if (o.mat !== undefined) mat.setX(i + k, o.mat);
    }
  }
  return geo;
}

/**
 * A low irregular patch of ground for something to stand in. Its rim dips below y = 0, so the visible
 * outline is wherever the lumpy surface meets the terrain, never a regular polygon. Unpainted.
 */
export function groundPatch(radius, height, seed = 1, { sides = 9, lump = 0.22, dip = 0.03 } = {}) {
  const rows = [
    [1.0, -dip],
    [0.86, height * 0.12],
    [0.6, height * 0.62],
    [0.3, height * 0.93],
  ];
  const ph = seed * 1.7,
    pos = [],
    idx = [];
  const lumpAt = (a, k) => 1 + lump * (0.6 * Math.sin(a * 2 + ph) + 0.3 * Math.sin(a * 3 - ph * 1.3 + k) + 0.25 * Math.sin(a * 5 + ph * 2.1 + k * 2));
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < sides; i++) {
      const a = ((i + (j % 2) * 0.5) / sides) * TAU;
      const r = radius * rows[j][0] * lumpAt(a, j * 0.7);
      const y = rows[j][1] + (j > 0 ? height * 0.16 * Math.sin(a * 3 + ph * 0.7 + j) : 0);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  const top = pos.length / 3;
  pos.push(radius * 0.05 * Math.sin(ph), height, radius * 0.05 * Math.cos(ph));
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i,
        b = j * sides + ((i + 1) % sides),
        c = a + sides,
        d = b + sides;
      // rows are staggered by half a step: alternate the diagonal so the quads stay well shaped
      if (j % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const last = (rows.length - 1) * sides;
  for (let i = 0; i < sides; i++) idx.push(last + i, top, last + ((i + 1) % sides));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A random rotation of at most `amount` radians about a random axis, as [rx, ry, rz] for kit.xf(). */
export function wobble(rng, amount) {
  return [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
}

/** Points on the surface of a geometry: random vertices with their normals, facing above `minNy`. */
export function surfacePoints(geo, rng, n, minNy = -0.2) {
  const pos = geo.attributes.position,
    nor = geo.attributes.normal;
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const i = rng.int(0, pos.count - 1);
    if (nor.getY(i) < minNy) continue;
    out.push({ p: [pos.getX(i), pos.getY(i), pos.getZ(i)], n: [nor.getX(i), nor.getY(i), nor.getZ(i)] });
  }
  return out;
}

export { Rng };
