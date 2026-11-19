import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, vec3, float, mix, step, fract, abs, smoothstep, sin, uv, uniform, time } from 'three/tsl';

// js/jet-model.js
// The Republic of Singapore Air Force's F-15SG Strike Eagle, low-poly for real time: built in code from its real
// dimensions (19.4 m long, 13.05 m span, 5.6 m to the fin tips), no model files to download or license.
// - One merged airframe mesh (~3,500 triangles) sharing one paint material: the radome and the tandem two-seat
//   cockpit, the boxy intakes either side of it with the Strike Eagle's conformal fuel tanks along them, the 45°
//   wings with their raked tips, the twin fins over the GE F110 engines and their nozzles, AIM-9X and AIM-120 missiles
//   on the wing pylons and the CFTs. The paint is the RSAF's two-tone grey, mottled in the shader with faint panel
//   lines, lighter underneath; vertex colours mark the parts that aren't painted (intakes, nozzles, missiles, tyres).
// - Moving parts as their own meshes: the all-moving stabilators (they follow the stick), the landing gear (folds
//   away), the afterburner plumes (additive, with shock diamonds, sized by the throttle).
// - The gold-tinted canopy, the RSAF roundel (a red disc, the lion's head in white) on the intakes and wings, the
//   serial on the fins, navigation lights and a white tail strobe.
// Body frame: forward +z, up +y, left wing +x; the origin at the jet's centre, 2.3 m over the wheels (gear down).
// createJetModel() returns { root, canopy, cockpit, stabilators, gear, flames, nozzleGlow, strobe, setAfterburner(level),
// setGear(deploy), setStabilators(pitch), setCockpitView(on) }.

const PAINT = [1, 1, 1]; // painted (the shader's camouflage)
const DARK = [0.035, 0.037, 0.04];
const NOZZLE = [0.33, 0.31, 0.3];
const NOZZLE_IN = [0.09, 0.08, 0.08];
const MISSILE = [0.78, 0.79, 0.78];
const SEEKER = [0.16, 0.17, 0.19];
const GEAR = [0.72, 0.73, 0.74];
const TYRE = [0.05, 0.05, 0.05];
const LIP = [0.22, 0.24, 0.26];

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: indexed triangles with a colour per vertex, smoothed per part, then merged
// ---------------------------------------------------------------------------------------------------------------------
class Parts {
  constructor() { this.list = []; }
  // a part: positions [x, y, z]…, colours, triangle indices; normals smoothed within it
  add(pos, col, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.list.push(g);
  }
  /** Rings of points (each [x, y, z]), joined in order; `colors`: one per ring (or per point, as rings of colours) */
  loft(rings, colors, { closed = true } = {}) {
    const pos = [], col = [], idx = [];
    const n = rings[0].length;
    rings.forEach((ring, r) => {
      for (let k = 0; k < n; k++) {
        pos.push(...ring[k]);
        const c = Array.isArray(colors[r][0]) ? colors[r][k] : colors[r];
        col.push(...c);
      }
    });
    const segs = closed ? n : n - 1;
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < segs; k++) {
        const a = r * n + k, b = r * n + ((k + 1) % n), c = (r + 1) * n + k, d = (r + 1) * n + ((k + 1) % n);
        idx.push(a, c, b, b, c, d);
      }
    }
    this.add(pos, col, idx);
  }
  /** A disc closing a ring (a fan from its centre) */
  cap(ring, color) {
    const pos = [], col = [], idx = [];
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length, s[2] + p[2] / ring.length], [0, 0, 0]);
    pos.push(...c);
    col.push(...color);
    ring.forEach((p, k) => {
      pos.push(...p);
      col.push(...color);
      idx.push(0, 1 + k, 1 + ((k + 1) % ring.length));
    });
    this.add(pos, col, idx);
  }
  merge() {
    let count = 0, indices = 0;
    for (const g of this.list) { count += g.attributes.position.count; indices += g.index.count; }
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const idx = new Uint32Array(indices);
    let v = 0, i = 0;
    for (const g of this.list) {
      pos.set(g.attributes.position.array, v * 3);
      nrm.set(g.attributes.normal.array, v * 3);
      col.set(g.attributes.color.array, v * 3);
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) idx[i + k] = src[k] + v;
      v += g.attributes.position.count;
      i += src.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
}

/** A superellipse cross-section at z: centre (cx, cy), width w, heights above / below, squareness e (2 ellipse) */
function section(z, cx, cy, w, top, bottom, e = 2, n = 24) {
  const ring = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = cx + (w / 2) * Math.sign(c) * Math.abs(c) ** (2 / e);
    const y = cy + (s >= 0 ? top : bottom) * Math.sign(s) * Math.abs(s) ** (2 / e);
    ring.push([x, y, z]);
  }
  return ring;
}
const mirror = (ring) => ring.map(([x, y, z]) => [-x, y, z]);
const scaleRing = (ring, k, cx, cy) => ring.map(([x, y, z]) => [cx + (x - cx) * k, cy + (y - cy) * k, z]);
const shiftRing = (ring, dz) => ring.map(([x, y, z]) => [x, y, z + dz]);

/**
 * A thin lifting surface (wing, fin, stabilator) from its planform: leading edge from `root[0]` to `tip[0]`, trailing
 * edge from `root[1]` to `tip[1]` (each [span, chord] in the surface's own 2D frame), thickness `t0` at the root to
 * `t1` at the tip; `place(span, chord, thick)` maps a point to the body frame. A biconvex section, sharp at both edges.
 */
function surface(parts, { root, tip, t0, t1, place, color = PAINT, spans = 5, chords = 9 }) {
  const top = [], bottom = [];
  for (let i = 0; i <= spans; i++) {
    const f = i / spans;
    const le = [root[0][0] + (tip[0][0] - root[0][0]) * f, root[0][1] + (tip[0][1] - root[0][1]) * f];
    const te = [root[1][0] + (tip[1][0] - root[1][0]) * f, root[1][1] + (tip[1][1] - root[1][1]) * f];
    const t = t0 + (t1 - t0) * f;
    const rowT = [], rowB = [];
    for (let j = 0; j <= chords; j++) {
      const c = j / chords;
      const s = le[0] + (te[0] - le[0]) * c, ch = le[1] + (te[1] - le[1]) * c;
      // thickest a third of the way back
      const th = t * Math.sin(Math.PI * Math.min(1, c ** 0.75));
      rowT.push(place(s, ch, th * 0.58));
      rowB.push(place(s, ch, -th * 0.42));
    }
    top.push(rowT);
    bottom.push(rowB);
  }
  // one closed loop per span station: along the top, back along the bottom (the edges shared)
  const rings = top.map((row, i) => [...row, ...bottom[i].slice(1, -1).reverse()]);
  parts.loft(rings, rings.map(() => color));
  // the tip and root closed
  parts.cap(rings[rings.length - 1], color);
  parts.cap(rings[0], color);
}

/** A cylinder along z from z0 to z1 (radius r0 -> r1) around (x, y), n sides, with its ends capped */
function tube(parts, x, y, z0, z1, r0, r1, color, n = 10, caps = [true, true], capColor = color) {
  const ring = (z, r) => Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2;
    return [x + Math.cos(t) * r, y + Math.sin(t) * r, z];
  });
  const a = ring(z0, r0), b = ring(z1, r1);
  parts.loft([a, b], [color, color]);
  if (caps[0]) parts.cap(a, capColor);
  if (caps[1]) parts.cap(b, capColor);
}

/** A box (centre, half sizes) */
function box(parts, cx, cy, cz, hx, hy, hz, color) {
  const pos = [], col = [], idx = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
  ];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(
        cx + (n[0] + u[0] * su + v[0] * sv) * hx,
        cy + (n[1] + u[1] * su + v[1] * sv) * hy,
        cz + (n[2] + u[2] * su + v[2] * sv) * hz
      );
      col.push(...color);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // (a box's normals are not smoothed across its corners: each face has its own vertices)
  parts.add(pos, col, idx);
}

// ---------------------------------------------------------------------------------------------------------------------
// The airframe
// ---------------------------------------------------------------------------------------------------------------------
// The wing's planform (left wing, x > 0) and where its surface is: also for the roundels on it
const WING = { root: [[1.95, 0.7], [1.95, -5.3]], tip: [[6.0, -3.15], [6.52, -4.85]], y: 0.36, t0: 0.34, t1: 0.07 };
const wingPlace = (side) => (s, ch, th) => [side * s, WING.y - (s - 1.95) * 0.018 + th, ch];

// 1. The fuselage: radome, cockpit, the spine between the engines, out to the tail cone between the nozzles
//    [z, width, top, bottom, centre y, squareness]. Its forward part (the radome to behind the front seat, z >= 3.6) is
//    a mesh of its own, swapped from the front seat for one with the cockpit cut into it (buildCockpit)
const FWD = 3.6;
const BODY = [
    [9.72, 0.03, 0.015, 0.015, -0.02, 2],
    [9.35, 0.34, 0.17, 0.17, -0.02, 2],
    [8.5, 0.78, 0.32, 0.4, -0.04, 2],
    [7.3, 1.1, 0.43, 0.52, 0.0, 2.1],
    [6.3, 1.26, 0.5, 0.58, 0.04, 2.2],
    [5.2, 1.34, 0.6, 0.6, 0.08, 2.5],
    [3.6, 1.4, 0.68, 0.64, 0.1, 2.8],
    [2.0, 1.46, 0.72, 0.68, 0.08, 3],
    [0.4, 1.62, 0.76, 0.72, 0.08, 3.4],
    [-1.6, 1.86, 0.72, 0.72, 0.08, 4],
    [-4.4, 2.1, 0.62, 0.64, 0.06, 4],
    [-6.8, 1.8, 0.5, 0.52, 0.04, 3.6],
    [-8.2, 1.15, 0.34, 0.36, 0.02, 3],
    [-9.05, 0.5, 0.14, 0.16, 0.02, 2.4],
    [-9.25, 0.04, 0.02, 0.02, 0.02, 2]
];
const bodyRings = (rows) => rows.map(([z, w, t, b, cy, e]) => section(z, 0, cy, w, t, b, e, 24));

/** The forward fuselage; `cut`: with the cockpit's opening cut down into its top, from the glareshield back */
function buildForwardFuselage(cut = false) {
  const P = new Parts();
  let rows = BODY.filter(([z]) => z >= FWD);
  if (cut) {
    const at = (z) => {
      // the full section at z, interpolated
      const i = BODY.findIndex(([bz]) => bz < z);
      const a = BODY[i - 1], b = BODY[i], f = (a[0] - z) / (a[0] - b[0]);
      return a.map((v, k) => v + (b[k] - v) * f);
    };
    const lowered = (z) => { const r = at(z); r[2] = 0.34; r[0] = z; return r; };
    rows = [...rows.filter(([z]) => z > 5.32), (() => { const r = at(5.32); r[0] = 5.32; return r; })(),
      lowered(5.28), lowered(4.4), lowered(FWD)];
  }
  P.loft(bodyRings(rows), rows.map(() => PAINT));
  return P.merge();
}

function buildAirframe() {
  const P = new Parts();
  const aft = BODY.filter(([z]) => z <= FWD);
  P.loft(bodyRings(aft), aft.map(() => PAINT));

  // 2. Each side: the intake (its mouth dark inside a lip), along the cockpit's flank and back into the engine nacelle,
  //    and the F110's nozzle
  for (const side of [1, -1]) {
    // [z, centre x, width, top, bottom, centre y, squareness]
    const nacelle = [
      [2.8, 1.58, 1.22, 0.58, 0.7, -0.06, 7],
      [2.3, 1.64, 1.34, 0.64, 0.74, -0.04, 6],
      [0.6, 1.66, 1.4, 0.66, 0.74, -0.02, 6],
      [-1.8, 1.6, 1.44, 0.64, 0.72, 0, 5.5],
      [-4.2, 1.4, 1.46, 0.62, 0.66, 0.02, 4.5],
      [-6.3, 1.06, 1.42, 0.62, 0.62, 0.02, 3],
      [-8.1, 0.74, 1.24, 0.6, 0.6, 0.0, 2.3],
      [-8.6, 0.71, 1.17, 0.58, 0.58, 0.0, 2]
    ];
    const rings = nacelle.map(([z, cx, w, t, b, cy, e]) => section(z, side * cx, cy, w, t, b, e, 16));
    P.loft(rings, nacelle.map(() => PAINT));
    // the intake mouth: a dark lip stepping in to a dark duct face
    const [, cx0, , , , cy0] = nacelle[0];
    const lip = scaleRing(shiftRing(rings[0], -0.12), 0.84, side * cx0, cy0);
    const duct = scaleRing(shiftRing(rings[0], -0.9), 0.8, side * cx0, cy0);
    P.loft([rings[0], lip], [LIP, LIP]);
    P.loft([lip, duct], [DARK, DARK]);
    P.cap(duct, DARK);
    // the intake's splitter ramp above the mouth (the F-15's variable ramp hinges forward of it)
    box(P, side * cx0, cy0 + 0.6, 2.95, 0.6, 0.03, 0.22, PAINT);
    // the nozzle: turkey feathers tapering back, burnt metal, dark inside
    const n0 = section(-8.6, side * 0.71, 0, 1.12, 0.56, 0.56, 2, 16);
    const n1 = section(-9.55, side * 0.71, 0, 0.98, 0.49, 0.49, 2, 16);
    const n2 = scaleRing(shiftRing(n1, 0.35), 0.86, side * 0.71, 0);
    P.loft([n0, n1, n2], [NOZZLE, NOZZLE, NOZZLE_IN]);
    P.cap(n2, NOZZLE_IN);
    // the conformal fuel tank along the intake's outer flank
    const cft = [
      [2.3, 2.2, 0.16, 0.08, 0.08, -0.3, 2],
      [1.5, 2.3, 0.62, 0.36, 0.34, -0.28, 3],
      [-1.0, 2.36, 0.72, 0.42, 0.38, -0.26, 3.4],
      [-3.6, 2.2, 0.66, 0.4, 0.36, -0.24, 3],
      [-5.2, 1.86, 0.36, 0.22, 0.2, -0.22, 2.4],
      [-5.7, 1.7, 0.08, 0.05, 0.05, -0.22, 2]
    ];
    P.loft(cft.map(([z, cx, w, t, b, cy, e]) => section(z, side * cx, cy, w, t, b, e, 14)), cft.map(() => PAINT));
  }

  // 3. The wings: 45° leading edges, raked tips, a hint of anhedral
  for (const side of [1, -1]) {
    surface(P, { root: WING.root, tip: WING.tip, t0: WING.t0, t1: WING.t1, place: wingPlace(side), spans: 5, chords: 9 });
  }

  // 4. The twin fins over the engines, their tips clipped
  for (const side of [1, -1]) {
    surface(P, {
      root: [[0.55, -4.5], [0.55, -8.35]], tip: [[3.62, -7.05], [3.62, -8.15]], t0: 0.17, t1: 0.05,
      place: (s, ch, th) => [side * (1.42 + (s - 0.55) * 0.035) + th * side, s, ch], spans: 4, chords: 7
    });
    // the fin's root fairing on the nacelle
    box(P, side * 1.42, 0.5, -6.4, 0.11, 0.1, 1.9, PAINT);
  }

  // 5. Missiles: AIM-9X pairs on the wing pylons' shoulder rails, AIM-120s on the CFTs
  for (const side of [1, -1]) {
    box(P, side * 4.0, WING.y - 0.12, -2.0, 0.05, 0.12, 1.25, PAINT); // pylon
    for (const dx of [-0.24, 0.24]) {
      const x = side * 4.0 + dx;
      tube(P, x, WING.y - 0.32, 0.9, -2.0, 0.064, 0.064, MISSILE, 8, [false, true]);
      tube(P, x, WING.y - 0.32, 1.1, 0.9, 0.02, 0.064, SEEKER, 8, [false, false]);
      for (const [ax, ay] of [[1, 0], [0, 1]]) box(P, x, WING.y - 0.32, -1.8, 0.16 * ax + 0.01, 0.16 * ay + 0.01, 0.13, MISSILE);
    }
    for (const z of [0.6, -2.3]) {
      const x = side * 2.42, y = -0.66;
      tube(P, x, y, z + 1.9, z - 1.75, 0.09, 0.09, MISSILE, 8, [false, true]);
      tube(P, x, y, z + 2.15, z + 1.9, 0.025, 0.09, SEEKER, 8, [false, false]);
      for (const [ax, ay] of [[1, 0], [0, 1]]) box(P, x, y, z - 1.55, 0.21 * ax + 0.01, 0.21 * ay + 0.01, 0.16, MISSILE);
    }
  }
  // the pitot on the radome
  tube(P, 0, -0.02, 10.25, 9.6, 0.012, 0.03, LIP, 6, [true, false]);
  return P.merge();
}

// The stabilators (both, about their common hinge at the pivot's origin) and the gear (folding up into the belly)
function buildStabilators() {
  const P = new Parts();
  for (const side of [1, -1]) {
    surface(P, {
      root: [[1.95, 1.2], [1.95, -1.4]], tip: [[4.3, -0.75], [4.3, -1.45]], t0: 0.13, t1: 0.04,
      place: (s, ch, th) => [side * s, th - (s - 1.95) * 0.02, ch], spans: 3, chords: 6
    });
  }
  return P.merge();
}

function buildGear() {
  const P = new Parts();
  // geometry hangs from y = 0 (the pivot, under the belly) down to the ground at y = -1.75 (2.3 m below the centre)
  // the nose gear under the cockpit, the mains (a wheel each) under the intakes
  const legs = [[0, 5.0, 0.32, 0.17], [1.38, -1.35, 0.5, 0.26], [-1.38, -1.35, 0.5, 0.26]];
  for (const [x, z, r, w] of legs) {
    const hub = -1.75 + r;
    // strut
    box(P, x, hub / 2 + 0.05, z, 0.07, -hub / 2, 0.07, GEAR);
    // wheel: a short cylinder across x
    const n = 14;
    const ring = (dx, rr) => Array.from({ length: n }, (_, k) => {
      const t = (k / n) * Math.PI * 2;
      return [x + dx, hub + Math.sin(t) * rr, z + Math.cos(t) * rr];
    });
    const a = ring(-w / 2, r), b = ring(w / 2, r);
    P.loft([a, b], [TYRE, TYRE]);
    P.cap(a, GEAR);
    P.cap(b, GEAR);
  }
  return P.merge();
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------
// The RSAF's two-tone grey: a darker grey mottled with a lighter one on the upper surfaces, lighter underneath, faint
// panel lines; parts coloured otherwise (vertex colour not white) keep their colour
function paintMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
  const evaluate = Fn(() => {
    const tint = attribute('color', 'vec3');
    const painted = step(0.98, tint.x.min(tint.y).min(tint.z));
    const p = positionLocal;
    // soft-edged blobs of the lighter grey, a few metres across
    const blob = sin(p.x.mul(0.9).add(sin(p.z.mul(0.45)).mul(1.8))).mul(sin(p.z.mul(0.62).add(sin(p.x.mul(0.7)).mul(1.3))));
    const camo = smoothstep(0.05, 0.25, blob);
    const upper = mix(vec3(0.16, 0.18, 0.2), vec3(0.27, 0.29, 0.31), camo);
    const under = vec3(0.33, 0.35, 0.37);
    const grey = mix(under, upper, smoothstep(-0.55, 0.1, normalLocal.y));
    // panel lines across the fuselage and wings
    const lineZ = smoothstep(0.0, 0.02, abs(fract(p.z.mul(0.85)).sub(0.5)).sub(0.47).negate());
    const lineX = smoothstep(0.0, 0.02, abs(fract(p.x.mul(1.1)).sub(0.5)).sub(0.47).negate()).mul(step(1.9, abs(p.x)));
    const lines = float(1).sub(lineZ.max(lineX).mul(0.18));
    return mix(tint, grey.mul(lines), painted);
  });
  m.colorNode = evaluate();
  return m;
}

function canopyMaterial() {
  // gold-tinted, glossy: mostly the sky's reflection
  return new THREE.MeshStandardNodeMaterial({ color: 0x4d4532, roughness: 0.08, metalness: 0.55, side: THREE.DoubleSide });
}

// An afterburner plume: hot white at the nozzle through orange to nothing, with shock diamonds, flickering
function flameMaterial(level) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const t = uv().y;
  const core = mix(vec3(1.0, 0.92, 0.8), vec3(1.0, 0.42, 0.08), smoothstep(0.05, 0.6, t));
  const blue = mix(vec3(0.45, 0.6, 1.0), core, smoothstep(0.0, 0.18, t));
  const diamonds = sin(t.mul(34.0)).mul(0.5).add(0.5).pow(3).mul(0.6).mul(float(1).sub(t));
  const flicker = sin(time.mul(53.0).add(t.mul(9.0))).mul(0.08).add(0.92);
  const fade = float(1).sub(t).pow(1.6);
  m.colorNode = blue.mul(fade.add(diamonds)).mul(flicker).mul(level).mul(1.6);
  return m;
}

// The roundel (a red disc, the lion's head in white) and the serial, drawn once onto a small texture
function decalTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  // roundel: red disc, white lion's head facing right (a maned head: a ring of spikes, the face, the jaw)
  g.fillStyle = '#d4202b';
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let k = 0; k <= 22; k++) {
    const t = (k / 22) * Math.PI * 1.55 + Math.PI * 0.55;
    const r = k % 2 ? 30 : 40;
    g.lineTo(58 + Math.cos(t) * r, 66 + Math.sin(t) * r);
  }
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(66, 30); g.quadraticCurveTo(96, 34, 98, 56); g.lineTo(104, 66); g.lineTo(96, 70);
  g.quadraticCurveTo(94, 90, 74, 98); g.lineTo(60, 88); g.closePath();
  g.fill();
  g.fillStyle = '#d4202b';
  g.beginPath(); g.arc(82, 52, 4, 0, Math.PI * 2); g.fill();
  // the serial (low-vis dark grey), on the right half
  g.fillStyle = 'rgba(40,44,48,0.95)';
  g.font = '700 46px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('8301', 192, 44);
  g.font = '700 26px Arial, Helvetica, sans-serif';
  g.fillText('RSAF', 192, 94);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Decal quads: [centre, normal-ish axes u (right on the decal) & v (up on it), size, which half of the texture]
function buildDecals() {
  const pos = [], uvs = [], idx = [];
  const quad = (c, u, v, w, h, half) => {
    const base = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(c[0] + u[0] * su * w / 2 + v[0] * sv * h / 2, c[1] + u[1] * su * w / 2 + v[1] * sv * h / 2,
        c[2] + u[2] * su * w / 2 + v[2] * sv * h / 2);
      uvs.push(half * 0.5 + (su + 1) * 0.25, (sv + 1) * 0.5);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // the intakes' flanks (roundel, the nose to the right of it seen from that side)
  quad([2.37, 0.18, 1.6], [0, 0, -1], [0, 1, 0], 0.72, 0.72, 0);
  quad([-2.37, 0.18, 1.6], [0, 0, 1], [0, 1, 0], 0.72, 0.72, 0);
  // the top of the left wing & under the right one
  const wy = (x, z, top) => WING.y - (x - 1.95) * 0.018 + (top ? 1 : -1) * 0.22 * (WING.t0 + (WING.t1 - WING.t0) * ((x - 1.95) / 4.57));
  quad([4.4, wy(4.4, -3.4, true) + 0.012, -3.4], [-1, 0, 0], [0, 0, 1], 1.0, 1.0, 0);
  quad([-4.4, wy(4.4, -3.4, false) - 0.012, -3.4], [-1, 0, 0], [0, 0, -1], 1.0, 1.0, 0);
  // the serial on the fins' outer faces
  for (const side of [1, -1]) {
    const x = side * (1.42 + 1.6 * 0.035 + 0.06);
    quad([x, 2.0, -7.2], [0, 0, -side], [0, 1, 0], 1.3, 0.65, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The canopy's bubble: [z, width, height above the sill, sill y], from the windscreen's point back over both seats,
// faired into the spine (the pilot's eyes at y 1.14, z 4.15: well under it, as in the real jet)
const CANOPY = [
  [6.05, 0.26, 0.04, 0.57], [5.55, 0.8, 0.42, 0.62], [4.8, 1.0, 0.68, 0.62], [3.4, 1.04, 0.8, 0.62],
  [2.0, 1.0, 0.76, 0.64], [1.0, 0.82, 0.56, 0.68], [0.25, 0.44, 0.26, 0.72], [-0.2, 0.08, 0.03, 0.74]
];
const CANOPY_SIDES = 16;
/** The canopy's cross-section at z (interpolated between CANOPY's), scaled about its sill by k: an arch of points */
function canopyArch(z, k = 1) {
  let i = 0;
  while (i < CANOPY.length - 2 && CANOPY[i + 1][0] > z) i++;
  const a = CANOPY[i], b = CANOPY[i + 1];
  const f = Math.max(0, Math.min(1, (a[0] - z) / (a[0] - b[0])));
  const [w, h, y] = [1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * f);
  return Array.from({ length: CANOPY_SIDES + 1 }, (_, n) => {
    const t = (n / CANOPY_SIDES) * Math.PI;
    const c = Math.cos(t), sn = Math.sin(t);
    return [(w / 2) * k * Math.sign(c) * Math.abs(c) ** (2 / 2.6), y + h * k * sn ** (2 / 2.6), z];
  });
}

function buildCanopy() {
  const P = new Parts();
  const rings = CANOPY.map(([z]) => canopyArch(z));
  P.loft(rings, rings.map(() => [1, 1, 1]), { closed: false });
  return P.merge();
}

// ---------------------------------------------------------------------------------------------------------------------
// The front cockpit, seen only from the front seat: the glareshield over the instrument panel (three multifunction
// displays and the up-front controls, drawn once onto a texture, their screens glowing), the HUD's combiner glass on
// its projector, the windscreen's frame arch, the walls and side consoles, the stick, the seat; the forward fuselage with
// the cockpit cut into it. ~1,000 triangles, drawn only from the front seat.
// ---------------------------------------------------------------------------------------------------------------------
const COCKPIT_GREY = [0.075, 0.08, 0.085];
const FRAME = [0.11, 0.12, 0.13];

function buildCockpitShell() {
  const P = new Parts();
  // the glareshield: a hood over the panel, its edge rounded off towards the pilot
  box(P, 0, 0.935, 5.14, 0.37, 0.03, 0.15, COCKPIT_GREY);
  // (a rolled lip: a cylinder across the hood's back edge)
  const n = 8;
  const ring = (x) => Array.from({ length: n }, (_, j) => {
    const t = (j / n) * Math.PI * 2;
    return [x, 0.935 + Math.sin(t) * 0.03, 4.99 + Math.cos(t) * 0.03];
  });
  const r0 = ring(-0.37), r1 = ring(0.37);
  P.loft([r0, r1], [COCKPIT_GREY, COCKPIT_GREY]);
  // the HUD's projector on the glareshield and the combiner's two posts
  box(P, 0, 0.985, 5.1, 0.1, 0.02, 0.07, FRAME);
  for (const x of [-0.105, 0.105]) box(P, x, 1.08, 5.1, 0.008, 0.09, 0.008, FRAME);
  box(P, 0, 1.172, 5.1, 0.113, 0.006, 0.008, FRAME);
  // the windscreen's frame: an arch of rectangular section where the windscreen meets the canopy
  const z0 = 5.36, z1 = 5.31;
  const outer0 = canopyArch(z0, 1.002), outer1 = canopyArch(z1, 1.002);
  const inner1 = canopyArch(z1, 0.95), inner0 = canopyArch(z0, 0.95);
  P.loft([outer0, outer1, inner1, inner0, outer0], [FRAME, FRAME, FRAME, FRAME, FRAME], { closed: false });
  // the cockpit's walls from the cut fuselage up to the canopy's sill rails, and the side consoles along them
  for (const side of [1, -1]) {
    box(P, side * 0.58, 0.58, 4.44, 0.13, 0.28, 0.84, COCKPIT_GREY);
    box(P, side * 0.49, 0.865, 4.44, 0.05, 0.02, 0.84, FRAME);
    // side consoles: the throttle quadrant on the left, the right one's panels
    box(P, side * 0.36, 0.66, 4.3, 0.09, 0.06, 0.7, COCKPIT_GREY);
  }
  // the two throttle levers on the left console, their grips
  for (const dx of [-0.018, 0.018]) {
    box(P, 0.36 + dx, 0.76, 4.5, 0.008, 0.045, 0.008, FRAME);
    box(P, 0.36 + dx, 0.81, 4.5, 0.012, 0.012, 0.022, [0.04, 0.04, 0.04]);
  }
  // the tub's floor, the bulkhead under the panel, the ejection seat behind the pilot
  box(P, 0, 0.46, 4.44, 0.45, 0.01, 0.84, [0.05, 0.05, 0.055]);
  box(P, 0, 0.5, 5.24, 0.45, 0.05, 0.04, COCKPIT_GREY);
  box(P, 0, 0.82, 3.78, 0.26, 0.38, 0.07, [0.06, 0.06, 0.065]);
  // the stick, between the knees
  box(P, 0, 0.58, 4.62, 0.013, 0.12, 0.013, FRAME);
  box(P, 0, 0.72, 4.62, 0.022, 0.04, 0.025, [0.04, 0.04, 0.04]);
  return P.merge();
}

// The instrument panel's face: three MFDs (engines and fuel; the tactical situation with Singapore's coast; the
// radar), the up-front control panel between the upper two, bezels and their buttons
function panelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c1f';
  g.fillRect(0, 0, 1024, 512);
  // panel seams
  g.strokeStyle = '#0c0d0e';
  g.lineWidth = 3;
  g.strokeRect(8, 8, 1008, 496);
  const screen = (x, y, s, draw) => {
    // bezel with 5 buttons a side
    g.fillStyle = '#26292d';
    g.fillRect(x - 26, y - 26, s + 52, s + 52);
    g.fillStyle = '#3a3e43';
    for (let k = 0; k < 5; k++) {
      const t = y + (k + 0.5) * (s / 5) - 7;
      g.fillRect(x - 21, t, 14, 14); g.fillRect(x + s + 7, t, 14, 14);
      const u = x + (k + 0.5) * (s / 5) - 7;
      g.fillRect(u, y - 21, 14, 14); g.fillRect(u, y + s + 7, 14, 14);
    }
    g.fillStyle = '#020403';
    g.fillRect(x, y, s, s);
    g.save();
    g.beginPath(); g.rect(x, y, s, s); g.clip();
    g.translate(x, y);
    draw(s);
    g.restore();
  };
  g.lineCap = 'round';
  const green = '#5dff8f', amber = '#ffb84d', white = '#e8f0f5', cyan = '#59d6ff';
  // left: the engines (two RPM dials, nozzle bars) and fuel
  screen(60, 210, 230, (s) => {
    g.lineWidth = 4;
    for (const [cx, label] of [[s * 0.28, 'L'], [s * 0.72, 'R']]) {
      g.strokeStyle = white;
      g.beginPath(); g.arc(cx, s * 0.32, 44, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      g.strokeStyle = green;
      g.beginPath(); g.moveTo(cx, s * 0.32); g.lineTo(cx + Math.cos(Math.PI * 1.9) * 40, s * 0.32 + Math.sin(Math.PI * 1.9) * 40); g.stroke();
      g.fillStyle = white;
      g.font = '700 22px monospace';
      g.textAlign = 'center';
      g.fillText(label, cx, s * 0.32 + 34);
      g.fillText('92', cx, s * 0.32 + 70);
    }
    g.fillStyle = green;
    g.font = '700 24px monospace';
    g.fillText('ENG  RPM', s / 2, s * 0.86); // (the fuel is on the HUD, live)
  });
  // centre: the tactical situation, Singapore's coast and the jet at the centre
  screen(397, 178, 230, (s) => {
    g.strokeStyle = cyan;
    g.lineWidth = 3;
    g.beginPath();
    const pts = [[0.05, 0.42], [0.18, 0.36], [0.33, 0.33], [0.48, 0.3], [0.62, 0.34], [0.78, 0.31], [0.95, 0.37], [0.9, 0.55], [0.76, 0.6], [0.58, 0.66], [0.42, 0.68], [0.28, 0.63], [0.12, 0.6], [0.05, 0.5]];
    pts.forEach(([u, v], k) => (k ? g.lineTo(u * s, v * s) : g.moveTo(u * s, v * s)));
    g.closePath();
    g.stroke();
    g.strokeStyle = 'rgba(93,255,143,0.5)';
    g.lineWidth = 2;
    for (const r of [0.2, 0.38]) { g.beginPath(); g.arc(s / 2, s / 2, r * s, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = white;
    g.beginPath(); g.moveTo(s / 2, s / 2 - 12); g.lineTo(s / 2 + 9, s / 2 + 10); g.lineTo(s / 2 - 9, s / 2 + 10); g.closePath(); g.fill();
    g.font = '700 18px monospace';
    g.textAlign = 'left';
    g.fillText('TSD', 10, 24);
  });
  // right: the radar's B-scope, a few contacts
  screen(734, 210, 230, (s) => {
    g.strokeStyle = 'rgba(93,255,143,0.35)';
    g.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      g.beginPath(); g.moveTo(0, (k * s) / 4); g.lineTo(s, (k * s) / 4); g.stroke();
      g.beginPath(); g.moveTo((k * s) / 4, 0); g.lineTo((k * s) / 4, s); g.stroke();
    }
    g.fillStyle = green;
    for (const [u, v] of [[0.32, 0.28], [0.66, 0.42], [0.55, 0.18]]) g.fillRect(u * s - 7, v * s - 4, 14, 8);
    g.strokeStyle = green;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(s * 0.62, 0); g.lineTo(s * 0.62, s); g.stroke();
    g.fillStyle = amber;
    g.font = '700 18px monospace';
    g.fillText('RWS 40', 10, s - 12);
  });
  // the up-front controls: a two-line display and a keypad
  g.fillStyle = '#26292d';
  g.fillRect(397, 24, 230, 120);
  g.fillStyle = '#071a0e';
  g.fillRect(410, 34, 204, 34);
  g.fillStyle = green;
  g.font = '700 20px monospace';
  g.textAlign = 'center';
  g.fillText('UHF 243.0  TCN 12X', 512, 58);
  g.fillStyle = '#3a3e43';
  for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) g.fillRect(414 + k * 34, 80 + r * 30, 26, 22);
  // warning lights either side of it
  for (const [x, col] of [[300, '#ff3b2b'], [340, '#ffb84d'], [684, '#ffb84d'], [724, '#4dff7a']]) {
    g.fillStyle = col;
    g.fillRect(x, 60, 30, 18);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildCockpit(paint) {
  const group = new THREE.Group();
  group.name = 'F15SG_cockpit';
  const matte = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 });
  group.add(new THREE.Mesh(buildCockpitShell(), matte));
  // the forward fuselage with the cockpit cut into it (the airframe's own is hidden from the front seat)
  group.add(new THREE.Mesh(buildForwardFuselage(true), paint));
  // the panel's face, leaning back from under the glareshield
  const tex = panelTexture();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.42), new THREE.MeshStandardNodeMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.7, metalness: 0.05
  }));
  panel.position.set(0, 0.71, 5.1);
  panel.rotation.set(-0.2, Math.PI, 0);
  group.add(panel);
  // the combiner: a faint green pane
  const combiner = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), new THREE.MeshBasicNodeMaterial({
    color: 0x3dff9a, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide
  }));
  combiner.position.set(0, 1.085, 5.1);
  combiner.rotation.x = 0.35;
  group.add(combiner);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = o !== combiner; } });
  group.visible = false;
  return { group };
}

function buildFlame() {
  // a lathe from the nozzle (v = 0) to the tip (v = 1), 1 m long along -z (scaled to the plume's length)
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.44 * (1 - t) ** 0.7 * (1 + 0.15 * Math.sin(t * Math.PI)), t));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// The geometries & materials every F-15SG shares (the player's, its wingman, a flypast's four), built once
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const disc = new THREE.CircleGeometry(0.4, 14);
  disc.rotateY(Math.PI);
  SHARED = {
    paint: paintMaterial(),
    airframe: buildAirframe(),
    forward: buildForwardFuselage(),
    canopy: buildCanopy(),
    canopyMat: canopyMaterial(),
    decals: buildDecals(),
    decalMat: new THREE.MeshStandardNodeMaterial({ map: decalTexture(), alphaTest: 0.5, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }),
    stabilators: buildStabilators(),
    gear: buildGear(),
    flame: buildFlame(),
    disc,
    lights: [0xff2b2b, 0x22ff66, 0xffffff].map((color) => new THREE.MeshBasicNodeMaterial({ color })),
    light: new THREE.SphereGeometry(1, 8, 6)
  };
  return SHARED;
}

/** An F-15SG; `cockpit`: with the front cockpit for the player's view from the seat (the others' never shows) */
function createJetModel({ cockpit: withCockpit = true } = {}) {
  const S = shared();
  const root = new THREE.Group();
  root.name = 'F15SG';
  const paint = S.paint;

  const airframe = new THREE.Mesh(S.airframe, paint);
  airframe.name = 'F15SG_airframe';
  root.add(airframe);
  const forward = new THREE.Mesh(S.forward, paint);
  forward.name = 'F15SG_forward';
  root.add(forward);

  const canopy = new THREE.Mesh(S.canopy, S.canopyMat);
  canopy.name = 'F15SG_canopy';
  root.add(canopy);

  const cockpit = withCockpit ? buildCockpit(paint) : null;
  if (cockpit) root.add(cockpit.group);

  const decals = new THREE.Mesh(S.decals, S.decalMat);
  decals.name = 'F15SG_markings';
  root.add(decals);

  const stabilators = new THREE.Group();
  stabilators.position.set(0, 0.02, -7.8);
  stabilators.add(new THREE.Mesh(S.stabilators, paint));
  root.add(stabilators);

  const gear = new THREE.Group();
  gear.position.set(0, -0.55, 0);
  gear.add(new THREE.Mesh(S.gear, paint));
  root.add(gear);

  // afterburner plumes: one geometry, two meshes; and the nozzles' glow (their own materials: their own throttle)
  const abLevel = uniform(0);
  const flameGeo = S.flame;
  const flameMat = flameMaterial(abLevel);
  const flames = new THREE.Group();
  for (const x of [0.71, -0.71]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(x, 0, -9.35);
    f.castShadow = f.receiveShadow = false;
    f.frustumCulled = false;
    flames.add(f);
  }
  flames.visible = false;
  root.add(flames);
  const glowMat = new THREE.MeshBasicNodeMaterial({ color: 0xff7a2a });
  glowMat.colorNode = vec3(1.0, 0.45, 0.12).mul(abLevel.mul(2.2).add(0.12));
  const nozzleGlow = new THREE.Group();
  for (const x of [0.71, -0.71]) {
    const d = new THREE.Mesh(S.disc, glowMat);
    d.position.set(x, 0, -9.18);
    nozzleGlow.add(d);
  }
  root.add(nozzleGlow);

  // navigation lights: red on the left (port) wingtip, green on the right, white strobe on the tail
  const light = (k, x, y, z, r = 0.07) => {
    const mesh = new THREE.Mesh(S.light, S.lights[k]);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  light(0, 6.5, WING.y - 0.07, -4.1);
  light(1, -6.5, WING.y - 0.07, -4.1);
  const strobe = light(2, 1.5, 3.62, -7.7, 0.08);

  return {
    root,
    canopy,
    cockpit: cockpit ? cockpit.group : null,
    stabilators,
    gear,
    flames,
    nozzleGlow,
    strobe,
    setAfterburner(level) {
      abLevel.value = level;
      flames.visible = level > 0.02;
      // the plume lengthens with the afterburner's stage
      for (const f of flames.children) f.scale.set(1, 1, 2.2 + level * 4.2);
    },
    setGear(deploy) {
      gear.visible = deploy > 0.02;
      gear.scale.set(1, Math.max(0.02, deploy), 1);
    },
    // the stabilators follow the stick (back: leading edges down, the nose comes up)
    setStabilators(pitch) {
      stabilators.rotation.x = Math.max(-0.35, Math.min(0.35, pitch * 0.3));
    },
    /** From the front seat: the cockpit in; the canopy's outside (opaque glass) and the uncut nose out */
    setCockpitView(on) {
      if (!cockpit) return;
      cockpit.group.visible = on;
      canopy.visible = forward.visible = !on;
    }
  };
}

export { createJetModel };
