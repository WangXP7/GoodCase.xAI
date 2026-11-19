// Geometry toolkit for every hand-built model in the game.
//
// All models end up as ONE merged BufferGeometry with these attributes:
//   position, normal
//   color  vec3   linear albedo
//   aFx    vec4   (emissive strength, roughness, metalness, wind sway weight)
//   aMat   float  material id (MAT.*) - selects procedural surface detail in the prop shader
//   aUvw   vec3   "detail coordinates": the vertex position in the part's own space at paint time.
//                 Procedural grain / speckle is evaluated there, so it sticks to the part however
//                 it is later rotated or moved. For WOOD the grain runs along the part's local Y.
//
// Conventions: metres, Y up, a model stands on y = 0 centred on the origin, +Z is its front.
// Build each part in a convenient local pose, paint() it, THEN move it into place with xf().
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Noise } from '../core/noise.js';
import { Rng } from '../core/rng.js';

export { Rng, Noise, THREE };
export const TAU = Math.PI * 2;

export const MAT = {
  PLAIN: 0, // painted / generic
  WOOD: 1, // grain along the part's local Y
  STONE: 2, // mottled, speckled, slightly bumpy
  METAL: 3, // hammered, streaky roughness
  PLANT: 4, // soft translucent lighting, sways when aFx.w > 0
  CRYSTAL: 5, // faceted sparkle + rim glow
  CLOTH: 6, // woven bump
  GLOW: 7, // pure light source (lamp flame, rune)
};

// One shared palette so separate modules agree on what wood, stone and copper look like.
// Dark fantasy: weathered, desaturated, cold. Saturation belongs to fire, sulfur, blood and the Gloom.
export const PAL = {
  // wood
  woodDark: '#2a1f18',
  wood: '#4a3829',
  woodLight: '#6b543d',
  woodGrey: '#5a554e',
  bark: '#2e2620',
  barkDark: '#1a1512',
  barkPale: '#8f8b84',
  // stone
  stone: '#5f5e5c',
  stoneDark: '#3a3a3c',
  stoneLight: '#86847f',
  stoneWarm: '#6e655a',
  slate: '#33363b',
  basalt: '#1b1b1f',
  moss: '#3e4a2a',
  lichen: '#7d8466',
  // metal
  copper: '#9c5a34',
  copperDark: '#5e3420',
  verdigris: '#4f8475',
  brass: '#9a7d3a',
  bronze: '#6b5230',
  iron: '#2f3134',
  rust: '#5a3a28',
  steel: '#7a8089',
  silver: '#aab0b8',
  lead: '#4a4c52',
  gold: '#c79a3a',
  // growth
  leaf: '#3a4f2a',
  leafDark: '#232f1c',
  leafDry: '#6b6238',
  leafDead: '#4a3a26',
  stem: '#2f3a22',
  thorn: '#1a1410',
  // made things
  parchment: '#b9a886',
  vellum: '#8f7f62',
  ink: '#15110d',
  cloth: '#5a5146',
  clothRed: '#5c1f1a',
  clothBlack: '#17161a',
  clothBlue: '#26323f',
  rope: '#7a6a4a',
  thatch: '#6f6240',
  bone: '#cfc6b2',
  boneOld: '#9c917a',
  wax: '#d6c9a3',
  clay: '#70432f',
  brick: '#5b332a',
  soot: '#0f0e0e',
  ash: '#55524e',
  char: '#1f1b19',
  // substances
  glass: '#a9c2bd',
  glassGreen: '#5f7f6a',
  ice: '#a9d3e6',
  salt: '#e6d9d6',
  sulfur: '#d6ac28',
  quick: '#c3ccd8',
  // light and dark
  ember: '#ff6a1c',
  emberDeep: '#b3260c',
  gloom: '#2a173f',
  gloomGlow: '#7a4fd0',
  rune: '#e0a04a',
  runeCold: '#7fb7d9',
  blood: '#5a0f12',
};

// ---------------------------------------------------------------------------------------------
// Colour helpers (all return new THREE.Color in linear working space)
// ---------------------------------------------------------------------------------------------
export function col(v) {
  if (v && v.isColor) return v.clone();
  if (Array.isArray(v)) return new THREE.Color(v[0], v[1], v[2]);
  return new THREE.Color(v);
}
export function mixc(a, b, t) {
  return col(a).lerp(col(b), t);
}
export function shade(c, k) {
  return col(c).multiplyScalar(k);
}
/** Shift hue / saturation / lightness (perceptual sRGB HSL). */
export function hsl(c, dh = 0, ds = 0, dl = 0) {
  const o = col(c);
  const h = { h: 0, s: 0, l: 0 };
  o.getHSL(h, THREE.SRGBColorSpace);
  o.setHSL((((h.h + dh) % 1) + 1) % 1, Math.min(1, Math.max(0, h.s + ds)), Math.min(1, Math.max(0, h.l + dl)), THREE.SRGBColorSpace);
  return o;
}
/** Random variation of a colour. */
export function jitter(c, rng, amt = 0.05) {
  return hsl(c, rng.range(-amt, amt) * 0.5, rng.range(-amt, amt), rng.range(-amt, amt));
}

// ---------------------------------------------------------------------------------------------
// Painting: assign color / aFx / aMat / aUvw
// ---------------------------------------------------------------------------------------------
const _v = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, i: 0, n: 0 };

/**
 * paint(geo, { color, emissive, rough, metal, sway, mat, uvw })
 * Every option may be a constant or a function (v) => value where v = { x, y, z, nx, ny, nz, i, n }.
 * `color` accepts hex string / number / THREE.Color / [r,g,b] (linear) or a function returning one.
 * Options left undefined keep the existing attribute value (or the default when there is none).
 * `uvw: false` keeps existing detail coordinates; by default they are captured from positions
 * the first time a geometry is painted.
 */
export function paint(geo, o = {}) {
  const pos = geo.attributes.position;
  const n = pos.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  let color = geo.attributes.color;
  if (!color) {
    color = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
    geo.setAttribute('color', color);
  }
  let fx = geo.attributes.aFx;
  if (!fx) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 4 + 1] = 0.8;
    }
    fx = new THREE.BufferAttribute(a, 4);
    geo.setAttribute('aFx', fx);
  }
  let mat = geo.attributes.aMat;
  if (!mat) {
    mat = new THREE.BufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aMat', mat);
  }
  let uvw = geo.attributes.aUvw;
  if (!uvw) {
    uvw = new THREE.BufferAttribute(new Float32Array(pos.array.slice(0, n * 3)), 3);
    geo.setAttribute('aUvw', uvw);
  } else if (o.uvw === true) {
    uvw.array.set(pos.array.subarray(0, n * 3));
  }
  const cFn = typeof o.color === 'function' ? o.color : null;
  const cConst = o.color !== undefined && !cFn ? col(o.color) : null;
  const ev = (opt) => (typeof opt === 'function' ? opt(_v) : opt);
  _v.n = n;
  for (let i = 0; i < n; i++) {
    _v.x = pos.getX(i);
    _v.y = pos.getY(i);
    _v.z = pos.getZ(i);
    _v.nx = nor.getX(i);
    _v.ny = nor.getY(i);
    _v.nz = nor.getZ(i);
    _v.i = i;
    if (cConst) color.setXYZ(i, cConst.r, cConst.g, cConst.b);
    else if (cFn) {
      const c = cFn(_v);
      if (c && c.isColor) color.setXYZ(i, c.r, c.g, c.b);
      else if (Array.isArray(c)) color.setXYZ(i, c[0], c[1], c[2]);
      else {
        const cc = col(c);
        color.setXYZ(i, cc.r, cc.g, cc.b);
      }
    }
    if (o.emissive !== undefined) fx.setX(i, ev(o.emissive));
    if (o.rough !== undefined) fx.setY(i, ev(o.rough));
    if (o.metal !== undefined) fx.setZ(i, ev(o.metal));
    if (o.sway !== undefined) fx.setW(i, ev(o.sway));
    if (o.mat !== undefined) mat.setX(i, ev(o.mat));
  }
  return geo;
}

/** Colour function: vertical gradient between y0 and y1. Use as paint(geo, { color: gradY(...) }). */
export function gradY(c0, c1, y0 = 0, y1 = 1, pow = 1) {
  const a = col(c0),
    b = col(c1),
    out = new THREE.Color();
  return (v) => {
    let t = (v.y - y0) / (y1 - y0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (pow !== 1) t = Math.pow(t, pow);
    return out.copy(a).lerp(b, t);
  };
}
/** Colour function: gradient by distance from the Y axis. */
export function gradR(c0, c1, r0 = 0, r1 = 1, pow = 1) {
  const a = col(c0),
    b = col(c1),
    out = new THREE.Color();
  return (v) => {
    let t = (Math.hypot(v.x, v.z) - r0) / (r1 - r0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (pow !== 1) t = Math.pow(t, pow);
    return out.copy(a).lerp(b, t);
  };
}

/** Multiply existing vertex colours: fn(v) -> scalar or [r,g,b]. Good for cheap baked shading. */
export function tint(geo, fn) {
  const pos = geo.attributes.position,
    nor = geo.attributes.normal,
    color = geo.attributes.color;
  if (!color) paint(geo, {});
  const c = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    _v.x = pos.getX(i);
    _v.y = pos.getY(i);
    _v.z = pos.getZ(i);
    _v.nx = nor.getX(i);
    _v.ny = nor.getY(i);
    _v.nz = nor.getZ(i);
    _v.i = i;
    const k = fn(_v);
    if (Array.isArray(k)) c.setXYZ(i, c.getX(i) * k[0], c.getY(i) * k[1], c.getZ(i) * k[2]);
    else c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}
/** Fake ambient occlusion: darker near the ground and on downward faces. Call after placing parts. */
export function ao(geo, { ground = 0, height = 0.35, strength = 0.45, under = 0.25 } = {}) {
  return tint(geo, (v) => {
    const g = 1 - strength * Math.max(0, 1 - (v.y - ground) / height);
    const u = 1 - under * Math.max(0, -v.ny);
    return g * u;
  });
}

// ---------------------------------------------------------------------------------------------
// Transforms and deformers (all mutate and return the geometry)
// ---------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _e = new THREE.Euler(),
  _s = new THREE.Vector3(),
  _t = new THREE.Vector3();

/** xf(geo, { t:[x,y,z], r:[rx,ry,rz] (radians, XYZ order), s: number | [sx,sy,sz] }) - scale, then rotate, then translate. */
export function xf(geo, { t = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  _e.set(r[0], r[1], r[2], 'XYZ');
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _t.set(t[0], t[1], t[2]);
  _m.compose(_t, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}
export const move = (geo, x, y, z) => xf(geo, { t: [x, y, z] });
export const rot = (geo, rx, ry, rz) => xf(geo, { r: [rx, ry, rz] });
export const scale = (geo, sx, sy = sx, sz = sx) => xf(geo, { s: [sx, sy, sz] });
export function clone(geo) {
  return geo.clone();
}
export function mat4(geo, m) {
  geo.applyMatrix4(m);
  return geo;
}

/** Move every vertex: fn(p: Vector3, n: Vector3, i) mutates p. Normals are recomputed. */
export function deform(geo, fn, recompute = true) {
  const pos = geo.attributes.position,
    nor = geo.attributes.normal;
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i);
    fn(p, n, i);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  if (recompute) geo.computeVertexNormals();
  return geo;
}
/** Push vertices along their normals by fbm noise. */
export function noisy(geo, amp = 0.05, freq = 2, seed = 1, oct = 3) {
  const nz = new Noise(seed);
  return deform(geo, (p, n) => {
    const d = nz.fbm3(p.x * freq, p.y * freq, p.z * freq, oct) * amp;
    p.addScaledVector(n, d);
  });
}
/** Bend around the X axis as height grows: positive leans toward -Z. `amount` is radians per unit of Y. */
export function bend(geo, amount, y0 = 0) {
  return deform(geo, (p) => {
    const h = p.y - y0;
    if (h <= 0 || amount === 0) return;
    // The spine (z = 0) becomes an arc whose centre lies at z = -r.
    const a = h * amount;
    const r = 1 / amount;
    const z = p.z;
    p.y = y0 + (r + z) * Math.sin(a);
    p.z = -r + (r + z) * Math.cos(a);
  });
}
/** Twist around the Y axis: radians per unit of Y. */
export function twist(geo, amount) {
  return deform(geo, (p) => {
    const a = p.y * amount,
      c = Math.cos(a),
      s = Math.sin(a);
    const x = p.x * c - p.z * s,
      z = p.x * s + p.z * c;
    p.x = x;
    p.z = z;
  });
}
/** Scale XZ as a function of normalised height: fn(t 0..1) -> factor. */
export function taper(geo, fn) {
  geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y,
    h = Math.max(1e-6, geo.boundingBox.max.y - y0);
  return deform(geo, (p) => {
    const k = fn((p.y - y0) / h);
    p.x *= k;
    p.z *= k;
  });
}
/** Faceted look: unshare vertices and recompute normals. */
export function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}
/** Smooth look: weld vertices and recompute normals. */
export function smooth(geo, tolerance = 1e-4) {
  const g0 = geo.clone();
  for (const k of Object.keys(g0.attributes)) if (k !== 'position') g0.deleteAttribute(k);
  const g = mergeVertices(g0, tolerance);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------------------------
const KEEP = ['position', 'normal', 'color', 'aFx', 'aMat', 'aUvw'];
function normalise(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.color || !geo.attributes.aFx || !geo.attributes.aMat || !geo.attributes.aUvw) paint(geo, {});
  for (const k of Object.keys(geo.attributes)) if (!KEEP.includes(k)) geo.deleteAttribute(k);
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  geo.morphAttributes = {};
  return geo;
}
/** Merge any number of painted geometries (nested arrays and nulls are fine) into one. */
export function merge(...parts) {
  const list = parts.flat(Infinity).filter(Boolean);
  if (list.length === 0) return null;
  const out = mergeGeometries(list.map(normalise), false);
  if (!out) throw new Error('kit.merge: mergeGeometries failed');
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Primitives (centred on the origin unless stated)
// ---------------------------------------------------------------------------------------------
/** Box; `bevel` > 0 rounds the edges. */
export function box(w, h, d, bevel = 0, seg = 2) {
  if (bevel > 0) return new RoundedBoxGeometry(w, h, d, seg, Math.min(bevel, Math.min(w, h, d) * 0.49));
  return new THREE.BoxGeometry(w, h, d);
}
/** Cylinder / cone frustum along Y. */
export function cyl(rTop, rBot, h, radial = 12, hSeg = 1, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, radial, hSeg, open);
}
export function cone(r, h, radial = 12, open = false) {
  return new THREE.ConeGeometry(r, h, radial, 1, open);
}
export function sphere(r, w = 14, h = 10) {
  return new THREE.SphereGeometry(r, w, h);
}
/** Upper half sphere (dome), base at y = 0. */
export function dome(r, w = 14, h = 6, squash = 1) {
  const g = new THREE.SphereGeometry(r, w, h, 0, TAU, 0, Math.PI / 2);
  if (squash !== 1) g.scale(1, squash, 1);
  return g;
}
export function ico(r, detail = 1) {
  return new THREE.IcosahedronGeometry(r, detail);
}
export function torus(R, r, radial = 8, tubular = 20, arc = TAU) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular, arc);
  g.rotateX(Math.PI / 2); // lie flat in XZ
  return g;
}
/** Flat disc in XZ facing up. */
export function disc(r, seg = 16) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
/** Flat rectangle in XZ facing up. */
export function plane(w, d, sw = 1, sd = 1) {
  const g = new THREE.PlaneGeometry(w, d, sw, sd);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Surface of revolution around Y.
 * profile: [[r, y] | [r, y, 'hard'], ...] listed bottom to top for an outward facing surface
 * (list top to bottom for an inward facing one, e.g. the inside of a bowl).
 * A point marked 'hard' gets a crease. The first/last point may have r = 0 to close the shape.
 */
export function lathe(profile, radial = 16, { arc = TAU } = {}) {
  const P = profile.map((p) => ({ r: p[0], y: p[1], hard: p[2] === 'hard' || p[2] === true }));
  const segN = [];
  for (let i = 0; i < P.length - 1; i++) {
    const dr = P[i + 1].r - P[i].r,
      dy = P[i + 1].y - P[i].y;
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const rows = []; // { r, y, nr, ny }
  const segRows = []; // [rowA, rowB] per profile segment
  for (let i = 0; i < P.length; i++) {
    const prev = i > 0 ? segN[i - 1] : null;
    const next = i < P.length - 1 ? segN[i] : null;
    if (prev && next && !P[i].hard) {
      let nr = prev[0] + next[0],
        ny = prev[1] + next[1];
      const l = Math.hypot(nr, ny) || 1;
      rows.push({ r: P[i].r, y: P[i].y, nr: nr / l, ny: ny / l });
      segRows[i - 1][1] = rows.length - 1;
      segRows[i] = [rows.length - 1, -1];
    } else {
      if (prev) {
        rows.push({ r: P[i].r, y: P[i].y, nr: prev[0], ny: prev[1] });
        segRows[i - 1][1] = rows.length - 1;
      }
      if (next) {
        rows.push({ r: P[i].r, y: P[i].y, nr: next[0], ny: next[1] });
        segRows[i] = [rows.length - 1, -1];
      }
    }
  }
  const cols = radial + 1;
  const pos = new Float32Array(rows.length * cols * 3);
  const nor = new Float32Array(rows.length * cols * 3);
  for (let j = 0; j < rows.length; j++) {
    const R = rows[j];
    for (let i = 0; i < cols; i++) {
      const a = (i / radial) * arc;
      const c = Math.cos(a),
        s = Math.sin(a);
      const k = (j * cols + i) * 3;
      pos[k] = R.r * c;
      pos[k + 1] = R.y;
      pos[k + 2] = -R.r * s;
      nor[k] = R.nr * c;
      nor[k + 1] = R.ny;
      nor[k + 2] = -R.nr * s;
    }
  }
  const idx = [];
  for (const [a, b] of segRows) {
    if (b < 0) continue;
    for (let i = 0; i < radial; i++) {
      const a0 = a * cols + i,
        a1 = a0 + 1,
        b0 = b * cols + i,
        b1 = b0 + 1;
      if (rows[a].r > 1e-6) idx.push(a0, a1, b0);
      if (rows[b].r > 1e-6) idx.push(a1, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Tube swept along a smooth curve through `points` ([x,y,z] arrays or Vector3).
 * radius: number or (t 0..1) => number, so stems, roots and horns can taper.
 */
export function tube(points, radius = 0.05, radial = 6, { samples = 0, caps = true, closed = false, tension = 0.5 } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
  const N = samples || Math.max(2, (pts.length - 1) * 4);
  const frames = curve.computeFrenetFrames(N, closed);
  const rf = typeof radius === 'function' ? radius : () => radius;
  const cols = radial + 1;
  const rowsN = N + 1;
  const pos = [],
    nor = [],
    idx = [];
  const P = new THREE.Vector3();
  const centers = [];
  for (let j = 0; j < rowsN; j++) {
    const t = j / N;
    curve.getPointAt(t, P);
    centers.push(P.clone());
    const Nn = frames.normals[j],
      B = frames.binormals[j];
    const r = rf(t);
    for (let i = 0; i < cols; i++) {
      const a = (i / radial) * TAU;
      const c = Math.cos(a),
        s = Math.sin(a);
      const nx = c * Nn.x + s * B.x,
        ny = c * Nn.y + s * B.y,
        nz = c * Nn.z + s * B.z;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * cols + i,
        b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (caps && !closed) {
    for (const end of [0, N]) {
      const r = rf(end / N);
      if (r < 1e-5) continue;
      const T = frames.tangents[end];
      const sgn = end === 0 ? -1 : 1;
      const base = pos.length / 3;
      const C = centers[end];
      pos.push(C.x, C.y, C.z);
      nor.push(T.x * sgn, T.y * sgn, T.z * sgn);
      for (let i = 0; i < cols; i++) {
        const k = (end * cols + i) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        nor.push(T.x * sgn, T.y * sgn, T.z * sgn);
      }
      for (let i = 0; i < radial; i++) {
        if (end === 0) idx.push(base, base + 2 + i, base + 1 + i);
        else idx.push(base, base + 1 + i, base + 2 + i);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A leaf / petal / blade: base at the origin, growing along +Y, face toward +Z.
 *   len, width   overall size
 *   segs         rows along the length
 *   belly        0..1 where the widest point sits (0.35 = near the base, 0.6 = near the tip)
 *   point        > 1 sharpens the tip, < 1 rounds it
 *   curl         radians the tip leans back (toward -Z); negative curls forward
 *   fold         how far the edges lift toward +Z relative to the half width (V / cup shape)
 *   base         width at the base as a fraction of the full width (0 = pointed stalk end)
 * Render double sided (the prop material is).
 */
export function leaf(len, width, { segs = 6, belly = 0.45, point = 1.4, curl = 0.4, fold = 0.25, base = 0.0, wave = 0, waveFreq = 3 } = {}) {
  const cols = 5; // edge, quarter, mid, quarter, edge
  const pos = [],
    idx = [];
  let y = 0,
    z = 0;
  const dt = 1 / segs;
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    if (j > 0) {
      const a = curl * (t - dt * 0.5);
      y += Math.cos(a) * len * dt;
      z -= Math.sin(a) * len * dt;
    }
    // width profile: rises to the belly then falls to the tip
    let w;
    if (t <= belly) {
      const u = belly > 0 ? t / belly : 1;
      w = base + (1 - base) * Math.sin((u * Math.PI) / 2);
    } else {
      const u = (t - belly) / (1 - belly);
      w = Math.pow(Math.cos((u * Math.PI) / 2), point);
    }
    const hw = w * width * 0.5;
    const a = curl * t;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    for (let i = 0; i < cols; i++) {
      const u = (i / (cols - 1)) * 2 - 1; // -1..1
      const lift = fold * hw * u * u + (wave ? Math.sin(t * waveFreq * Math.PI + u * 1.3) * wave * hw : 0);
      // local frame: tangent (0, ca, -sa); face normal (0, sa, ca)
      pos.push(u * hw, y + lift * sa, z + lift * ca);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i,
        b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Faceted crystal standing on y = 0: an n-sided prism with a pointed tip. */
export function crystal(radius, height, { sides = 6, tip = 0.3, foot = 0.8, irregular = 0.12, rng = null } = {}) {
  const R = rng || new Rng(7);
  const ring = (r, y) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const k = 1 + R.range(-irregular, irregular);
      out.push(new THREE.Vector3(Math.cos(a) * r * k, y, Math.sin(a) * r * k));
    }
    return out;
  };
  const a = ring(radius * foot, 0),
    b = ring(radius, height * (1 - tip));
  const apex = new THREE.Vector3(R.range(-1, 1) * radius * irregular, height, R.range(-1, 1) * radius * irregular);
  const pos = [];
  const tri = (p, q, r) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tri(a[i], b[j], a[j]);
    tri(a[i], b[i], b[j]);
    tri(b[i], apex, b[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Rock / boulder / pebble: a noise-displaced icosphere.
 *   squash [sx, sy, sz], rough 0..0.5 displacement, facet true = hard low-poly faces,
 *   sink 0..1 flattens the underside so it sits on the ground (origin stays at the centre).
 */
export function rock(radius, { seed = 1, detail = 2, rough = 0.22, freq = 1.3, squash = [1, 0.75, 1], facet = false, sink = 0 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g = mergeVertices(g, 1e-4);
  const nz = new Noise(seed);
  const p = new THREE.Vector3();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const d = 1 + nz.fbm3(p.x * freq + seed, p.y * freq, p.z * freq, 3) * rough * 2 + nz.n3(p.x * freq * 3.1, p.y * freq * 3.1, p.z * freq * 3.1) * rough * 0.35;
    p.multiplyScalar(d * radius);
    p.x *= squash[0];
    p.y *= squash[1];
    p.z *= squash[2];
    if (sink > 0) {
      const floor = -radius * squash[1] * (1 - sink);
      if (p.y < floor) p.y = floor + (p.y - floor) * 0.15;
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return facet ? flat(g) : g;
}

/**
 * Copies of a geometry arranged in a ring around Y. `geo` may be a function (i, n) => geometry.
 * Each copy is tilted by `tilt` so its +Y leans OUTWARD, then pushed out by `radius`.
 * For leaf() parts this means: tilt > 0 opens the petal outward; a NEGATIVE curl bends the tip
 * further outward and down (open bloom), a positive curl bends it back toward the axis (bud / cup);
 * a NEGATIVE fold cups the petal toward the axis.
 */
export function ring(geo, n, { radius = 0, y = 0, tilt = 0, yaw0 = 0, spin = 0, jitter = 0, rng = null } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = typeof geo === 'function' ? geo(i, n) : geo.clone();
    if (!g) continue;
    const a = yaw0 + (i / n) * TAU + (rng && jitter ? rng.range(-jitter, jitter) : 0);
    // tilt outward (around local X), optional spin around own Y first
    if (spin) g.rotateY(spin);
    if (tilt) g.rotateX(tilt);
    g.translate(0, y, radius);
    g.rotateY(a);
    out.push(g);
  }
  return out;
}

/** Thin raised strokes for glyphs / runes: paths are arrays of [x, y] in a plane facing +Z. */
export function strokes(paths, width = 0.02, depth = 0.006) {
  const out = [];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, y0] = path[i],
        [x1, y1] = path[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const g = new THREE.BoxGeometry(len + width, width, depth);
      g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, depth / 2);
      out.push(g);
    }
  }
  return out.length ? mergeGeometries(out, false) : null;
}

/** Circle as a stroke path (for runes). */
export function circlePath(cx, cy, r, n = 20, a0 = 0, a1 = TAU) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return p;
}

/** The three Prime glyphs as stroke paths inside a unit box centred on the origin (y up). */
export const GLYPH = {
  // Sulfur: a triangle on a cross
  sulfur: [
    [
      [-0.3, 0.05],
      [0.3, 0.05],
      [0, 0.5],
      [-0.3, 0.05],
    ],
    [
      [0, 0.05],
      [0, -0.5],
    ],
    [
      [-0.2, -0.25],
      [0.2, -0.25],
    ],
  ],
  // Mercury: a circle with a crescent above and a cross below
  mercury: [
    circlePath(0, 0.05, 0.2, 18),
    circlePath(0, 0.45, 0.2, 10, Math.PI, TAU),
    [
      [0, -0.15],
      [0, -0.5],
    ],
    [
      [-0.16, -0.33],
      [0.16, -0.33],
    ],
  ],
  // Salt: a circle cut by a horizontal line
  salt: [
    circlePath(0, 0, 0.36, 22),
    [
      [-0.36, 0],
      [0.36, 0],
    ],
  ],
};

// ---------------------------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------------------------
/**
 * Collects the parts of a model. A finished model is:
 * {
 *   opaque:  BufferGeometry | null   everything solid (prop shader)
 *   glass:   BufferGeometry | null   bottle walls, lenses (glass shader; color = tint)
 *   liquid:  BufferGeometry | null   the liquid volume inside a vessel (liquid shader)
 *   parts:   { name: BufferGeometry } separately animated / toggled pieces (see Builder.part)
 *   colliders: [{ type:'box', c:[x,y,z], h:[hx,hy,hz], ry? } | { type:'cyl', c, r, h } | { type:'sphere', c, r }]
 *   anchors:  { name: [x, y, z] }    named points: 'top', 'flame', 'pour', 'socket' ...
 *   emitters: [{ type, pos:[x,y,z], color?, size? }]   'fire' | 'glow' | 'smoke' | 'spark' | 'steam' | 'drip'
 *   lights:   [{ pos:[x,y,z], color, intensity, range }]
 *   size: [w, h, d], radius
 * }
 */
export class Builder {
  constructor() {
    this._o = [];
    this._g = [];
    this._l = [];
    this._p = {};
    this.colliders = [];
    this.anchors = {};
    this.emitters = [];
    this.lights = [];
  }
  add(...geos) {
    this._o.push(...geos.flat(Infinity).filter(Boolean));
    return this;
  }
  glass(...geos) {
    this._g.push(...geos.flat(Infinity).filter(Boolean));
    return this;
  }
  liquid(...geos) {
    this._l.push(...geos.flat(Infinity).filter(Boolean));
    return this;
  }
  /**
   * A named piece kept as its own geometry (model.parts[name]) instead of being merged into
   * `opaque`: anything the game moves, hides or lights on its own (a lid, a door, a glowing eye,
   * a bellows top, debris chunks). Build it in model space, exactly where it sits at rest.
   */
  part(name, ...geos) {
    (this._p[name] = this._p[name] || []).push(...geos.flat(Infinity).filter(Boolean));
    return this;
  }
  collider(c) {
    this.colliders.push(c);
    return this;
  }
  boxCollider(cx, cy, cz, hx, hy, hz, ry = 0) {
    this.colliders.push({ type: 'box', c: [cx, cy, cz], h: [hx, hy, hz], ry });
    return this;
  }
  cylCollider(cx, cy, cz, r, h) {
    this.colliders.push({ type: 'cyl', c: [cx, cy, cz], r, h });
    return this;
  }
  sphereCollider(cx, cy, cz, r) {
    this.colliders.push({ type: 'sphere', c: [cx, cy, cz], r });
    return this;
  }
  anchor(name, x, y, z) {
    this.anchors[name] = [x, y, z];
    return this;
  }
  emitter(type, x, y, z, extra = {}) {
    this.emitters.push({ type, pos: [x, y, z], ...extra });
    return this;
  }
  light(x, y, z, color, intensity = 1, range = 6) {
    this.lights.push({ pos: [x, y, z], color, intensity, range });
    return this;
  }
  build() {
    const opaque = this._o.length ? merge(this._o) : null;
    const glass = this._g.length ? merge(this._g) : null;
    const liquid = this._l.length ? merge(this._l) : null;
    const parts = {};
    for (const [name, list] of Object.entries(this._p)) if (list.length) parts[name] = merge(list);
    const bb = new THREE.Box3();
    for (const g of [opaque, glass, liquid, ...Object.values(parts)]) {
      if (!g) continue;
      g.computeBoundingBox();
      bb.union(g.boundingBox);
    }
    const size = bb.isEmpty() ? [0, 0, 0] : [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    const radius = bb.isEmpty() ? 0 : Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
    return {
      opaque,
      glass,
      liquid,
      parts,
      colliders: this.colliders,
      anchors: this.anchors,
      emitters: this.emitters,
      lights: this.lights,
      size,
      radius,
      min: bb.isEmpty() ? [0, 0, 0] : bb.min.toArray(),
      max: bb.isEmpty() ? [0, 0, 0] : bb.max.toArray(),
    };
  }
}
