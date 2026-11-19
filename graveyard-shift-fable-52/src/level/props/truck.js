// Jack-knifed articulated lorry: a long-nose tractor unit and a dry-van trailer, built
// separately so the level can fold them at the fifth wheel. Local space for both: +x forward,
// +z right, y = 0 road.
//
// Each is written once against the level builder's interface (tractorParts, trailerParts) and run
// twice: once with the level's builder, which keeps only what the level itself draws (the atlas
// decals: conspicuity tape, the haulier's name, box labels), the shadow casters, the reflection
// stand-ins, colliders and fixtures; and once by the vehicle layer through an adapter (meshPass)
// that turns every part into the vehicle meshes: clearcoat paint, real glass over a modelled cab,
// lamps that glow, wheels instanced with the cars'.
import { Matrix4, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { M, box, boxUp, cyl, cylUp, lathe, extrude, deform, roundPoly, quadUV, rgb, tube, torus, sphere } from '../build.js';
import { createRng } from '../../core/rng.js';
import { VBuf, registerVehicle, bowl, lensPlate, panelize, gridNormals } from './vehicleParts.js';
import { CAR_PAINT, sweep } from './car.js';

const BLACK = rgb(0x050506);
const TRIM = rgb(0x101112);
const FRAME = rgb(0x0b0c0d);
const AMBER = rgb(0xff8a12, 5);
const MARK = rgb(0xff8a12, 11); // the tractor's clearance lamps: what picks its outline out of the dark
const RED = rgb(0xff1408, 4);
const CARD = rgb(0x8a6a42);

export const TRACTOR = { fifthX: -2.75, fifthY: 1.22, length: 7.3, width: 2.5 };
export const TRAILER = { L: 12.2, W: 2.56, floor: 1.28, roof: 4.02, kingpinX: 12.2 / 2 - 0.95 };

// wheels are the layer's (instanced): the level pass draws none
function bigWheel(B, x, z, side, dual) { if (B.wheel) B.wheel(x, z, side, dual); }

function mudflap(B, x, z) {
  B.add('rubber', box(0.03, 0.62, 0.6, 0.008, 1), { m: M(x, 0.42, z, 0, 0, 0.06) });
  B.add('chrome', box(0.035, 0.05, 0.6, 0.01, 1), { m: M(x - 0.02, 0.13, z) });
}

// ---- small makers ------------------------------------------------------------------------------------
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
// A surface of revolution about +x, facing out. pts: [[x, r], ...] with x rising.
function revolve(pts, seg = 12) {
  const pos = [], idx = [], n = pts.length;
  for (let i = 0; i < n; i++) for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; pos.push(pts[i][0], pts[i][1] * Math.cos(a), pts[i][1] * Math.sin(a)); }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < seg; s++) { const a = i * seg + s, b = i * seg + ((s + 1) % seg), c = a + seg, d = b + seg; idx.push(a, b, c, b, d, c); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// A patch into a vertex buffer: fn(u, v) -> [x, y, z] over an (nu + 1) x (nv + 1) lattice, facing
// sign * (dP/du x dP/dv), smooth normals.
function patch(buf, nu, nv, fn, st, sign = 1) {
  const P = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) P.push(fn(i / nu, j / nv));
  const at = (i, j) => P[Math.min(nu, Math.max(0, i)) * (nv + 1) + Math.min(nv, Math.max(0, j))];
  const id = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1), p = at(i, j);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    let nx = (uy * vz - uz * vy) * sign, ny = (uz * vx - ux * vz) * sign, nz = (ux * vy - uy * vx) * sign;
    const l = Math.hypot(nx, ny, nz) || 1;
    id.push(buf.vert(p[0], p[1], p[2], nx / l, ny / l, nz / l, st.color, st.a, st.b || buf.fx));
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = id[i * (nv + 1) + j], b = id[(i + 1) * (nv + 1) + j], c = id[(i + 1) * (nv + 1) + j + 1], d = id[i * (nv + 1) + j + 1];
    if (sign > 0) buf.quad(a, b, c, d); else buf.quad(a, d, c, b);
  }
}
// A marker lamp: a ribbed lens bowed out of a bright bezel, hot at the bulb and falling off to its
// rim (never an even glowing block). m: the lamp's place, its lens facing local +x; w across z, h up y.
function marker(B, m, w, h, color, o = {}) {
  if (!B.mesh) return;
  B.add('chrome', box(0.012, h + 0.016, w + 0.016, 0.005, 1), { m: m.clone().multiply(M(-0.004, 0, 0)) });
  if (o.far) { B.add('vcGlow', box(0.01, h, w), { m: m.clone().multiply(M(0.004, 0, 0)), color: [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5] }); return; }
  const c = B.point(...new Vector3(0.004, 0, 0).applyMatrix4(m).toArray());
  const r2 = (Math.max(w, h) * 0.5) ** 2;
  B.add(o.blink || 'vcGlow', lensPlate(w, h, Math.max(3, Math.round(Math.max(w, h) / 0.014)), w >= h ? 'z' : 'y', Math.min(w, h) * 0.32, 0.0012, o.pw ?? 5), {
    m: m.clone().multiply(M(0.003, 0, 0)),
    color: (n, p) => { const d2 = ((p.x - c[0]) ** 2 + (p.y - c[1]) ** 2 + (p.z - c[2]) ** 2) / r2; const k = 0.16 + 1.5 * Math.exp(-d2 * 5); return [color[0] * k, color[1] * k, color[2] * k]; },
  });
}

// ---- the tractor's skin -------------------------------------------------------------------------------
// Bonnet, cowl, cab and sleeper are one lofted skin, like the cars': a cross-section (flank bowed out
// under the waist and leaning in above it, a rolled shoulder, a crowned top) swept along the vehicle,
// with the windscreen as the steep part of the roof line, bowed forward in plan. Panels, windows and
// doors are cells of that grid (vehicleParts.panelize), so every shut line is a real gap.
const CAB_XS = [-1.0, -0.975, -0.9, -0.76, -0.48, -0.3, -0.08, 0.0, 0.19, 0.38, 0.57, 0.76, 0.82, 0.85, 0.94, 1.04, 1.115, 1.14, 1.2, 1.32, 1.7, 2.2, 2.7, 3.15, 3.45, 3.56];
const CAB_FAR_XS = [-1.0, -0.975, -0.76, -0.48, -0.08, 0.0, 0.76, 0.82, 0.85, 1.115, 1.14, 1.2, 2.2, 3.45, 3.56];
const CAB_ROWS = [1.0, 1.14, 1.5, 1.9, 2.08, 2.37, 2.66];
const CAB_HW = 1.18;
export function cabSection(x) {
  const back = 1 - sm(-1.0, -0.975, x); // the rear edge, turned in
  const hoodK = sm(1.14, 1.2, x);
  const w = CAB_HW + (0.93 * (1 - 0.14 * Math.max(0, (x - 1.6) / 2) ** 1.5) - CAB_HW) * hoodK - 0.035 * back;
  let T;
  if (x < 0.35) T = 3.3 - 0.42 * sm(-0.5, 0.35, x); // the sleeper's roof falling to the cab's in a fairing
  else if (x < 0.82) T = 2.88 - (0.02 * (x - 0.35)) / 0.47;
  else if (x < 1.14) T = 2.86 - 0.88 * ((x - 0.82) / 0.32) ** 1.15; // the windscreen
  else T = 1.98 - 0.2 * sm(1.2, 3.5, x) - 0.025 * sm(3.4, 3.56, x);
  T -= 0.035 * back;
  const screen = sm(0.8, 0.85, x) * (1 - sm(1.14, 1.22, x));
  return { w, T, r: 0.13 - 0.04 * hoodK, crown: (0.045 - 0.012 * hoodK) * (1 - screen), bow: 0.05 * screen, sill: 1.0 + 0.06 * sm(1.2, 1.34, x) };
}
const cabTum = (y) => 1 - 0.055 * Math.min(1, Math.max(0, y - 1.95)) ** 2;
// height of the roof skin at (x, z), and the flank's z at (x, y)
export function cabRoofY(x, z) { const S = cabSection(x), flat = S.w * cabTum(S.T - S.r) - S.r; return S.T + S.crown * (1 - Math.min(1, Math.abs(z) / flat) ** 2); }
export function cabFlankZ(x, y) { const S = cabSection(x); return S.w * cabTum(y) + 0.014 * Math.sin(Math.PI * Math.min(1, Math.max(0, (y - S.sill) / (1.95 - S.sill)))); }
function cabGrid(xs) {
  const nx = xs.length, ny = 33, P = new Float32Array(nx * ny * 3);
  for (let i = 0; i < nx; i++) {
    const x = xs[i], S = cabSection(x), top = S.T - S.r, half = [];
    for (let k = 0; k < 7; k++) { const y = Math.min(k === 0 ? S.sill : CAB_ROWS[k], top); half.push([cabFlankZ(x, y), y, 0]); }
    const wt = S.w * cabTum(top), flat = wt - S.r;
    for (let a = 0; a <= 4; a++) { const th = (a / 4) * Math.PI * 0.5; half.push([flat + S.r * Math.cos(th), top + S.r * Math.sin(th), a === 4 ? 0 : 0]); }
    for (const f of [0.74, 0.48, 0.24, 0.03 / flat, 0]) half.push([flat * f, S.T + S.crown * (1 - f * f), S.bow * (1 - f * f)]);
    for (let j = 0; j < ny; j++) {
      const q = half[j <= 16 ? j : 32 - j], k = (i * ny + j) * 3;
      P[k] = x + q[2]; P[k + 1] = q[1]; P[k + 2] = j <= 16 ? -q[0] : q[0];
    }
  }
  return gridNormals({ nx, ny, P }, -1);
}

// o: { paint, doorAjar, cabLight 0..1 (courtesy lamp on), parking (sidelights on), far }
function tractorShell(B, o, paintKey) {
  const far = !!o.far;
  const xs = far ? CAB_FAR_XS : CAB_XS;
  const grid = cabGrid(xs);
  const col = rgb(PAINT_HEX[paintKey] ?? 0x777777);
  const fx = B.body.fx;
  const P = grid.P;
  // road film thick along the sills and behind the steer wheels; rust starting from the seams
  const paintAt = (i, j, bnd) => {
    const k = (i * 33 + j) * 3, x = P[k], y = P[k + 1];
    const spray = 0.35 * (1 - sm(1.0, 1.7, y)) + 0.25 * (1 - sm(1.0, 2.3, y)) * (1 - sm(0.2, 1.5, Math.abs(x - 1.5)));
    return { color: col, a: [0, 0, 0, 0], b: [Math.min(1, fx[0] + spray), fx[1] + (bnd ? 0.16 : 0), 0, 0] };
  };
  const lamp = o.cabLight ? 0.5 * o.cabLight : 0;
  const GL = [0.018, 0.028, 0.025];
  const panel = (id, extra = {}) => ({ id, buf: B.body, vert: paintAt, gap: far ? 0 : 0.004, skirt: far ? 0 : 0.016, lines: far, ...extra });
  const pane = (id, extra = {}) => (far
    ? { id, buf: B.body, st: { color: o.cabLight ? [0.05, 0.035, 0.02] : [0.004, 0.005, 0.006], a: [4, o.cabLight ? 0.9 * o.cabLight : 0, 0, 0] }, inset: 0.004, ...extra }
    : { id, buf: B.glass, st: { color: GL, a: [0.5, 0.8, -99, 0] }, inset: 0.01, ...extra });
  // the windscreen carries its place on the screen for the wiped arcs (scaled: a lorry's blades are long)
  const screenPane = (id) => (far ? pane(id) : {
    id, buf: B.glass, inset: 0.01,
    vert: (i, j) => { const k = (i * 33 + j) * 3; return { color: GL, a: [0.46, 0.9, P[k + 2] * 0.6, Math.hypot(P[k] - 1.16, P[k + 1] - 1.98) * 0.6] }; },
  });
  const ajar = (sd) => (o.doorAjar && sd < 0 ? { range: 'ajar', skirt: far ? 0 : 0.045, skirtEdge: true, skirtColor: TRIM } : {});
  const zone = (i, j) => {
    const xc = (xs[i] + xs[i + 1]) / 2, c = j < 16 ? j : 31 - j, sd = j < 16 ? -1 : 1;
    return { xc, c, sd };
  };
  panelize(grid, (i, j) => {
    const { xc, c, sd } = zone(i, j);
    if (xc > 1.2) return c === 15 ? { id: 'hinge', buf: B.body, st: { color: [0.55, 0.57, 0.6], a: [2, 0, 0, 0] }, gap: 0, skirt: 0 } : panel(c >= 7 ? `hood${sd}` : `hoodSide${sd}`);
    if (xc > 1.14) return panel('cowl');
    if (xc < -0.1) return c >= 4 && c <= 5 && xc > -0.76 && xc < -0.48 ? pane(`sw${sd}`) : panel('sleeper');
    if (c <= 6) {
      if (xc > -0.08 && xc < 0.94 && c >= 1) return c >= 4 && c <= 5 && xc > 0 && xc < 0.76 ? pane(`dw${sd}`, o.doorAjar && sd < 0 ? { range: 'ajar' } : {}) : panel(`door${sd}`, ajar(sd));
      return panel('cab');
    }
    if (c <= 10) return panel('cab');
    if (xc < 0.82) return panel('roof');
    if (xc > 0.85 && xc < 1.115 && c <= 14) return screenPane(`ws${sd}`);
    return panel('cab');
  });
  if (!far) {
    // the same cells from inside: a trimmed lining, the door's card going with the door
    const LIN = { color: rgb(0x3a332c), a: [3, lamp, 0, 0] }, CARD = { color: rgb(0x2a2420), a: [3, lamp * 1.2, 0, 0] };
    panelize(grid, (i, j) => {
      const { xc, c, sd } = zone(i, j);
      if (xc > 1.14) return null;
      const win = c >= 4 && c <= 5 && ((xc > -0.76 && xc < -0.48) || (xc > 0 && xc < 0.76));
      const ws = c >= 11 && c <= 14 && xc > 0.85 && xc < 1.115;
      if (win || ws) return null;
      if (c <= 6 && c >= 1 && xc > -0.08 && xc < 0.94 && o.doorAjar && sd < 0) return { id: 'card', buf: B.body, st: CARD, inset: 0.04, flip: true, range: 'ajar' };
      return { id: 'lin', buf: B.body, st: LIN, inset: 0.03, flip: true };
    });
  }
  // the back of the sleeper, closing the skin
  {
    const ids = [], T0 = cabSection(xs[0]).T;
    const cidx = B.body.vert(xs[0] - 0.004, (1.0 + T0) / 2, 0, -1, 0, 0, col, [0, 0, 0, 0]);
    for (let j = 0; j < 33; j++) ids.push(B.body.vert(P[j * 3] - 0.004, P[j * 3 + 1], P[j * 3 + 2], -1, 0, 0, col, [0, 0, 0, 0]));
    for (let j = 0; j < 32; j++) B.body.tri(cidx, ids[j], ids[j + 1]);
    B.body.tri(cidx, ids[32], ids[0]);
  }
  if (o.doorAjar) {
    const hinge = M(0.94, 0, -CAB_HW, 0, -o.doorAjar, 0).multiply(M(-0.94, 0, CAB_HW));
    B.body.transform('ajar', hinge); B.glass.transform('ajar', hinge);
  }
}

function tractorParts(B, o = {}) {
  const paint = o.paint || 'paintTruck';
  const hoodW = 1.86, cabW = 2.36;
  const far = !!o.far, near = B.mesh && !far;

  // ---- frame, axles, fifth wheel
  for (const z of [-0.43, 0.43]) B.add('vcMatte', box(7.2, 0.3, 0.1), { m: M(-0.3, 0.92, z), color: FRAME, shadow: true });
  for (const x of [2.55, -2.1, -3.4]) B.add('vcMatte', cyl(0.09, 0.09, 2.2, 8).rotateX(Math.PI / 2), { m: M(x, 0.52, 0), color: FRAME });
  B.add('vcMatte', cylUp(0.48, 0.5, 0.07, 20), { m: M(TRACTOR.fifthX, 1.1, 0), color: FRAME });
  B.add('vcMatte', boxUp(1.0, 0.16, 0.9, 0.02, 1), { m: M(TRACTOR.fifthX, 0.95, 0), color: FRAME });

  if (!B.mesh) {
    // what the level keeps of the body: its shadow casters (the old slab shapes do for that)
    const hood = roundPoly([[1.1, 1.0, 0], [3.52, 1.0, 0.04], [3.56, 1.76, 0.14], [1.1, 1.98, 0.04]], 4);
    B.add(paint, deform(extrude(hood, hoodW, { bevel: 0.07, bevelSeg: 3 }), (v) => { v.z *= 1 - 0.14 * Math.max(0, (v.x - 1.6) / 2) ** 1.5; }), { shadow: true });
    const cab = roundPoly([[1.14, 1.0, 0], [1.14, 1.98, 0.03], [0.82, 2.86, 0.1], [-0.2, 2.92, 0.06], [-0.5, 3.3, 0.14], [-1.0, 3.3, 0.1], [-1.0, 1.0, 0.03]], 4);
    B.add(paint, deform(extrude(cab, cabW, { smooth: false }), (v) => { v.z *= 0.95; v.y -= v.y > 1.5 ? 0.05 : 0; }), { shadow: true });
    const wing = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * (1 - i / 16) * 1.02 - 0.03; wing.push([2.55 + Math.cos(a) * 0.72, 0.56 + Math.sin(a) * 0.68]); }
    for (let i = 16; i >= 0; i--) { const a = Math.PI * (1 - i / 16) * 1.02 - 0.03; wing.push([2.55 + Math.cos(a) * 0.6, 0.56 + Math.sin(a) * 0.56]); }
    for (const s of [1, -1]) B.add(paint, extrude(wing, 0.46, { bevel: 0.03, bevelSeg: 2 }), { m: M(0, 0, s * 1.0), shadow: true });
    if (o.doorAjar) B.add(paint, box(1.0, 1.7, 0.07), { m: M(0.94, 0, -(cabW / 2), 0, -o.doorAjar, 0).multiply(M(-0.5, 1.98, 0)), shadow: true });
  } else {
    tractorShell(B, o, paint);
    const PAINT = { color: rgb(PAINT_HEX[paint] ?? 0x777777), a: [0, 0, 0, 0] };
    // under the skin: the engine as a dark mass, the cab's floor pan
    B.add('vcMatte', box(2.3, 0.6, 1.3), { m: M(2.35, 1.12, 0), color: BLACK });
    B.add('vcMatte', box(2.1, 0.03, 2.3), { m: M(0.07, 1.0, 0), color: BLACK });
    // ---- radiator shell: a chromed surround standing proud of the nose and above the bonnet line,
    // the core set well back in it behind a mesh of fine bars, three stays, the maker's plate
    const NX = 3.56, gT = cabSection(NX).T + 0.075, gW = cabSection(NX).w + 0.03;
    const shellO = roundPoly([[-gW, 0.98, 0.05], [gW, 0.98, 0.05], [gW + 0.02, gT - 0.2, 0.2], [0, gT + 0.03, 1.2], [-gW - 0.02, gT - 0.2, 0.2]], far ? 3 : 6);
    const shellI = roundPoly([[-gW + 0.085, 1.07, 0.03], [gW - 0.085, 1.07, 0.03], [gW - 0.075, gT - 0.24, 0.13], [0, gT - 0.075, 1.1], [-gW + 0.075, gT - 0.24, 0.13]], far ? 3 : 6);
    B.add('chrome', extrude(shellO, 0.2, { bevel: 0.035, bevelSeg: far ? 1 : 3, holes: [shellI] }).rotateY(Math.PI / 2), { m: M(NX + 0.03, 0, 0) });
    B.add('vcMatte', box(0.02, gT - 1.05, 2 * gW - 0.1), { m: M(NX - 0.03, (gT + 1.02) / 2, 0), color: BLACK });
    if (near) {
      const nb = 19;
      for (let i = 0; i < nb; i++) { const z = (-1 + (2 * (i + 0.5)) / nb) * (gW - 0.09); B.add('chrome', box(0.012, gT - 1.16 - 0.05 * (z / gW) ** 2, 0.011), { m: M(NX + 0.035, (gT + 0.99) / 2 - 0.025 * (z / gW) ** 2, z) }); }
      for (const y of [1.25, 1.45, 1.65]) B.add('chrome', box(0.016, 0.02, 2 * gW - 0.17), { m: M(NX + 0.046, y, 0) });
      B.add('chrome', box(0.02, 0.07, 0.34, 0.012, 1), { m: M(NX + 0.135, gT - 0.035, 0) });
      B.add('vcGloss', box(0.006, 0.04, 0.28), { m: M(NX + 0.146, gT - 0.035, 0), color: rgb(0x5a0f0a) });
      // bonnet latches and the grab handle over the shell
      for (const s of [1, -1]) {
        B.add('chrome', box(0.1, 0.03, 0.016, 0.006, 1), { m: M(2.2, 1.3, s * (cabFlankZ(2.2, 1.3) + 0.008)) });
        // louvres pressed into the bonnet side, a bright strip along its shoulder
        for (let k = 0; k < 9; k++) { const x = 1.62 + k * 0.085; B.add('vcMatte', box(0.014, 0.3, 0.012), { m: M(x, 1.5, s * (cabFlankZ(x, 1.5) + 0.001), 0, 0, -0.12), color: BLACK }); B.add(paint, box(0.03, 0.3, 0.02), { m: M(x - 0.02, 1.5, s * (cabFlankZ(x, 1.5) - 0.002), 0, s * 0.5, -0.12) }); }
      }
    }
    // ---- bumper: a deep chromed blade swept across the nose, its ends drawn back round the wings
    {
      const path = [[3.42, -1.3], [3.6, -1.26], [3.7, -1.12], [3.73, -0.8], [3.74, 0], [3.73, 0.8], [3.7, 1.12], [3.6, 1.26], [3.42, 1.3]];
      const sec = [[0, 0.5], [0.035, 0.515], [0.05, 0.58], [0.052, 0.68], [0.05, 0.78], [0.035, 0.845], [0, 0.86], [-0.02, 0.68]];
      B.add('chrome', sweep(path, sec, 0, 0), {});
      for (const z of [-0.5, 0.5]) B.add('vcMatte', box(0.3, 0.1, 0.08), { m: M(3.56, 0.7, z), color: FRAME });
      if (near) {
        for (const s of [1, -1]) { // tow hooks, fog lamps let into the blade
          B.add('vcMatte', torus(0.05, 0.014, 5, 10).rotateY(Math.PI / 2), { m: M(3.8, 0.6, s * 0.42, 0, 0, 0), color: FRAME });
          B.body.add(bowl(0.07, 0.04, 0.02, 2, 10, 5), { color: [0.85, 0.86, 0.88], a: [2, 0, 0, 0] }, M(3.785, 0.69, s * 0.86));
          B.glass.add(lensPlate(0.15, 0.085, 6, 'z', 0.004, 0.002, 5), { color: [0.05, 0.04, 0.02], a: [0.3, 0.3, -99, 0] }, M(3.789, 0.69, s * 0.86));
        }
        B.plate(M(3.795, 0.62, 0), 'VH·7716');
      }
    }
    // ---- wings over the steer wheels: a crowned skin rolled down at its outer edge, a liner under it
    for (const s of [1, -1]) {
      const wing = (u, v) => {
        const a = Math.PI * (1 - u) * 1.03 - 0.045, R = 0.69 + 0.022 * Math.sin(Math.PI * Math.min(1, v / 0.78)) - 0.12 * Math.max(0, (v - 0.76) / 0.24) ** 2;
        return [2.55 + Math.cos(a) * R * 1.04, 0.56 + Math.sin(a) * R, s * (0.78 + 0.46 * v + 0.012 * Math.sin(Math.PI * u))];
      };
      patch(B.body, far ? 8 : 18, far ? 3 : 7, wing, PAINT, -s);
      if (near) patch(B.body, 12, 3, (u, v) => { const p = wing(u, v); const k = 0.955; return [2.55 + (p[0] - 2.55) * k, 0.56 + (p[1] - 0.56) * k, p[2]]; }, { color: BLACK, a: [1, 0, 0, 0] }, s);
    }
    // ---- headlamps on the wings: bullet pods, a sealed beam in a bright ring (bowl, bulb, fluted lens)
    for (const s of [1, -1]) {
      const lx = 3.36, ly = 1.47, lz = s * 0.99;
      const pod = [];
      for (let i = 0; i <= 7; i++) { const t = i / 7, xx = -0.26 + 0.38 * t; pod.push([xx, 0.112 * Math.sqrt(Math.max(0, 1 - (Math.min(0, xx) / 0.26) ** 2)) * (xx > 0 ? 1 - 0.03 * (xx / 0.12) : 1)]); }
      pod.push([0.135, 0.104], [0.14, 0.094]);
      B.add(paint, revolve(pod, far ? 8 : 14), { m: M(lx, ly, lz) });
      B.add('chrome', box(0.06, 0.05, 0.24, 0.015, 1), { m: M(lx - 0.05, ly - 0.03, s * 0.86) }); // its bracket off the bonnet side
      if (near) {
        B.add('chrome', torus(0.098, 0.011, 5, 16).rotateY(Math.PI / 2), { m: M(lx + 0.138, ly, lz) });
        B.body.add(bowl(0.09, 0.09, 0.05, 3, 14, 2), { color: [0.9, 0.91, 0.93], a: [2, 0, 0, 0] }, M(lx + 0.132, ly, lz));
        B.body.add(sphere(0.014, 8, 4), { color: [0.6, 0.62, 0.65], a: [2, 0, 0, 0] }, M(lx + 0.1, ly, lz));
        B.glass.add(lensPlate(0.184, 0.184, 8, 'z', 0.016, 0.003, 2), { color: [0.03, 0.035, 0.035], a: [0.2, 0.22, -99, 0] }, M(lx + 0.134, ly, lz));
        if (o.parking) {
          B.lit.add(bowl(0.082, 0.082, 0.044, 3, 12, 2), { color: rgb(0xffe6b8, 2.2), a: [0, 0, 0, 0] }, M(lx + 0.1325, ly, lz));
          B.lit.add(sphere(0.017, 8, 5), { color: rgb(0xffe6b8, 60), a: [0, 0, 0, 0] }, M(lx + 0.1, ly, lz));
        }
      } else B.add(o.parking ? 'vcGlow' : 'vcMatte', cyl(0.09, 0.09, 0.01, 10).rotateZ(Math.PI / 2), { m: M(lx + 0.142, ly, lz), color: o.parking ? rgb(0xffe6b8, 6) : rgb(0x6e7072) });
      // the indicator on the wing's crown, an amber repeater on its flank
      marker(B, M(2.55, 1.284, s * 1.0, 0, 0, Math.PI / 2), 0.1, 0.06, MARK, { far });
    }
  }
  for (const s of [1, -1]) bigWheel(B, 2.55, s * 1.03, s, false);

  // ---- inside the cab: floor, two seats, the dash with its wheel, the bunk behind a half-drawn curtain
  if (near) {
    const lamp = o.cabLight ? 0.5 * o.cabLight : 0;
    const cabin = (geo, color, m) => B.add('vcCabin', geo, { m, color, emis: lamp });
    cabin(box(2.0, 0.04, cabW - 0.12), rgb(0x1a1a1c), M(0.05, 1.5, 0));
    for (const z of [-0.6, 0.6]) {
      cabin(box(0.5, 0.14, 0.5, 0.05, 2), rgb(0x4a3a2c), M(0.3, 1.86, z));
      cabin(box(0.12, 0.7, 0.5, 0.05, 2), rgb(0x4a3a2c), M(0.04, 2.25, z, 0, 0, 0.12));
      cabin(box(0.1, 0.16, 0.26, 0.04, 1), rgb(0x4a3a2c), M(-0.02, 2.68, z, 0, 0, 0.12));
      cabin(box(0.2, 0.36, 0.2), rgb(0x101012), M(0.3, 1.66, z));
    }
    cabin(box(0.34, 0.5, cabW - 0.14, 0.05, 2), rgb(0x161618), M(0.92, 1.9, 0));
    cabin(box(0.2, 0.12, 0.5, 0.03, 1), rgb(0x161618), M(0.86, 2.18, -0.6));
    cabin(torus(0.22, 0.02, 6, 20), rgb(0x0c0c0d), M(0.62, 2.22, -0.6, 0, Math.PI / 2, -0.6));
    cabin(cyl(0.025, 0.025, 0.4, 6).rotateZ(Math.PI / 2), rgb(0x0c0c0d), M(0.78, 2.13, -0.6, 0, 0, -0.6));
    cabin(box(0.7, 0.2, cabW - 0.16, 0.05, 2), rgb(0x35383a), M(-0.62, 2.0, 0)); // the bunk
    cabin(box(0.02, 1.3, 1.1), rgb(0x3a1f16), M(-0.26, 2.25, 0.55)); // curtain, half drawn
    if (o.cabLight) B.add('vcGlow', box(0.16, 0.012, 0.1), { m: M(0.3, 2.8, 0), color: rgb(0xffd9a0, 22 * o.cabLight) });
    if (o.cabLight) B.add('vcGlow', box(0.004, 0.07, 0.3), { m: M(0.745, 2.12, -0.6, 0, 0, -0.25), color: [0.2, 0.7, 0.4] }); // the gauges
  }
  if (B.mesh) {
    // ---- on the skin: visor, wipers, door furniture, mirrors, grab rails, roof lamps and horns
    const slope = Math.atan2(0.3, 0.84);
    B.add(paint, box(0.36, 0.03, 2.1, 0.012, 1), { m: M(0.99, 2.88, 0, 0, 0, -0.24) }); // sun visor
    if (near) {
      for (const z of [-0.98, 0, 0.98]) B.add(paint, box(0.05, 0.03, 0.04), { m: M(0.84, 2.9, z) });
      for (const z of [-0.52, 0.6]) { // wipers, parked: arm from its spindle on the cowl, the blade across it
        const arm = M(1.19, 2.0, z, 0, 0, slope).multiply(M(0.014, 0, 0, z < 0 ? 1.25 : 1.3, 0, 0));
        B.add('vcMatte', box(0.012, 0.52, 0.014).translate(0, 0.26, 0), { m: arm, color: BLACK });
        B.add('vcMatte', box(0.016, 0.03, 0.5), { m: M(1.165, 2.115, z + 0.3, 0, 0, slope).multiply(M(0.004, 0, 0, 0.06, 0, 0)), color: BLACK });
        B.add('chrome', cyl(0.014, 0.014, 0.03, 6), { m: M(1.19, 1.995, z, 0, 0, slope - Math.PI / 2) });
      }
    }
    for (const s of [1, -1]) {
      const open = o.doorAjar && s < 0;
      if (near && !open) {
        // door handle in its dished plate, the lock under it
        const hz = cabFlankZ(0.06, 1.98);
        B.add('chrome', box(0.2, 0.07, 0.012, 0.005, 1), { m: M(0.08, 1.98, s * (hz + 0.004)) });
        B.add('chrome', box(0.15, 0.022, 0.03, 0.01, 1), { m: M(0.09, 1.99, s * (hz + 0.022)) });
        B.add('vcMatte', cyl(0.012, 0.012, 0.01, 8).rotateX(Math.PI / 2), { m: M(0.02, 1.9, s * (hz + 0.006)), color: BLACK });
      }
      // grab rail up the back of the door opening, on stand-offs
      const gz = cabFlankZ(-0.2, 2.2) + 0.05;
      B.add('chrome', cyl(0.016, 0.016, 1.2, 6), { m: M(-0.2, 2.25, s * gz) });
      if (near) for (const y of [1.7, 2.8]) B.add('chrome', cyl(0.012, 0.012, 0.06, 5).rotateX(Math.PI / 2), { m: M(-0.2, y, s * (gz - 0.028)) });
      // mirrors: a tall head carried on a loop of tube off the door pillar, a convex spot mirror under it
      {
        const z0 = cabFlankZ(0.9, 2.2), zo = z0 + 0.3;
        const loop = [[0.86, 2.18, z0 - 0.02], [0.9, 2.2, z0 + 0.14], [0.94, 2.24, zo], [0.94, 2.5, zo + 0.01], [0.94, 2.76, zo], [0.9, 2.74, z0 + 0.12], [0.84, 2.66, cabFlankZ(0.84, 2.6) - 0.04]].map(([x, y, z]) => [x, y, s * z]);
        B.add('chrome', tube(loop, 0.011, 5, far ? 1 : 3), {});
        B.add('vcMatte', box(0.045, 0.44, 0.2, 0.018, 2), { m: M(0.955, 2.5, s * (zo + 0.02), 0, s * 0.22, 0), color: TRIM });
        if (near) {
          B.add('chrome', box(0.006, 0.4, 0.17), { m: M(0.955, 2.5, s * (zo + 0.02), 0, s * 0.22, 0).multiply(M(-0.024, 0, 0)) });
          B.add('chrome', sphere(0.06, 10, 6), { m: M(0.95, 2.2, s * (zo + 0.02), 0, 0, 0, 0.35, 1, 1) });
        }
      }
      // fuel tank slung under the cab on straps, the steps up to the door on its flank
      B.add('chrome', cyl(0.34, 0.34, 1.5, far ? 12 : 24).rotateZ(Math.PI / 2), { m: M(0.25, 0.72, s * 0.98), shadow: true });
      if (near) {
        for (const x of [-0.2, 0.7]) B.add('vcMatte', cyl(0.346, 0.346, 0.06, 24, true).rotateZ(Math.PI / 2), { m: M(x, 0.72, s * 0.98), color: rgb(0x2a2c2e) });
        B.add('chrome', cyl(0.05, 0.05, 0.05, 10), { m: M(0.25, 1.08, s * 1.06, s * 0.5, 0, 0) }); // filler cap
        for (const [y, zz, w] of [[1.02, 1.24, 0.62], [0.66, 1.33, 0.56]]) {
          B.add('chrome', box(w, 0.035, 0.2, 0.012, 1), { m: M(0.48, y, s * zz) });
          for (let k = 0; k < 4; k++) B.add('vcMatte', box(w - 0.06, 0.006, 0.018), { m: M(0.48, y + 0.02, s * (zz - 0.066 + k * 0.044)), color: BLACK }); // tread bars
          for (const dx of [-1, 1]) B.add('chrome', box(0.02, 0.03, 0.26), { m: M(0.48 + dx * (w / 2 - 0.03), y - 0.03, s * (zz - 0.13)) });
        }
      }
      // exhaust stack up the back of the sleeper: lagged pipe in a pierced shield, a curved tip
      {
        const ex = -1.14, ez = s * 1.0;
        B.add('chrome', cylUp(0.07, 0.07, 2.45, far ? 8 : 14), { m: M(ex, 1.05, ez), shadow: true });
        B.add('vcMatte', cylUp(0.098, 0.098, 0.95, far ? 8 : 14), { m: M(ex, 1.62, ez), color: rgb(0x1c1d1f) });
        if (near) {
          for (const y of [1.62, 2.57]) B.add('chrome', cylUp(0.104, 0.104, 0.035, 14), { m: M(ex, y - 0.017, ez) });
          for (let k = 0; k < 6; k++) for (const a of [0.6, -0.6, 2.2, -2.2]) B.add('vcMatte', box(0.012, 0.09, 0.03), { m: M(ex + Math.cos(a) * 0.096, 1.76 + k * 0.14, ez + Math.sin(a) * 0.096, 0, -a, 0), color: BLACK }); // the shield's slots
          const tip = [];
          for (let k = 0; k <= 5; k++) { const a = (k / 5) * 0.75; tip.push([ex - 0.5 * (1 - Math.cos(a)), 3.5 + 0.5 * Math.sin(a), ez]); }
          B.add('chrome', tube(tip, 0.07, 12, 2), {});
          B.add('vcMatte', cyl(0.062, 0.062, 0.01, 12), { m: M(tip[5][0] - 0.012 * Math.sin(0.75), tip[5][1] + 0.012 * Math.cos(0.75), ez, 0, 0, 0.75), color: BLACK });
          B.add('vcMatte', box(0.14, 0.03, 0.05), { m: M(ex + 0.08, 2.9, ez * 0.99), color: FRAME });
          B.add('vcMatte', box(0.14, 0.03, 0.05), { m: M(ex + 0.08, 1.5, ez * 0.99), color: FRAME });
        } else B.add('chrome', cylUp(0.07, 0.07, 0.4, 8), { m: M(ex - 0.06, 3.48, ez, 0, 0, 0.3) });
      }
      // drive axles: duals, mud flaps on their hanger
      mudflap(B, -4.02, s * 0.9);
      // cab-side marker under the sleeper's eave
      marker(B, M(-0.7, 3.0, s * (cabFlankZ(-0.7, 3.0) + 0.004), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0), 0.09, 0.04, MARK, { far });
    }
    if (near) B.add('vcMatte', cyl(0.02, 0.02, 2.0, 6).rotateX(Math.PI / 2), { m: M(-3.98, 0.74, 0), color: FRAME });
    // five clearance lamps across the brow of the roof: bullet housings, amber lenses
    for (const z of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const y = cabRoofY(0.7, z);
      if (near) B.add('chrome', revolve([[-0.07, 0], [-0.05, 0.016], [-0.01, 0.027], [0.03, 0.03], [0.036, 0.024]], 8), { m: M(0.7, y + 0.012, z) });
      marker(B, M(0.737, y + 0.012, z), 0.046, 0.04, MARK, { far, pw: 2 });
    }
    // air horns on the roof, trumpets forward
    for (const z of [-0.3, 0.3]) B.add('chrome', revolve([[-0.3, 0.014], [-0.26, 0.03], [-0.22, 0.016], [0.1, 0.022], [0.2, 0.036], [0.26, 0.06], [0.262, 0.05], [0.2, 0.02]], far ? 6 : 10), { m: M(0.25, cabRoofY(0.25, z) + 0.065, z) });
    if (near) for (const z of [-0.3, 0.3]) B.add('chrome', box(0.03, 0.07, 0.03), { m: M(0.2, cabRoofY(0.2, z) + 0.03, z) });
  }
  for (const s of [1, -1]) { bigWheel(B, -2.1, s * 1.04, s, true); bigWheel(B, -3.4, s * 1.04, s, true); }
  if (o.cabLight) B.fixtures.push({ kind: 'dome', pos: B.point(0.2, 2.7, 0) });
  // coiled air and electrical lines hanging off the back of the sleeper
  const coil = (z, col, sag) => {
    const pts = [];
    for (let i = 0; i <= 26; i++) { const k = i / 26; pts.push([-1.03 - k * 1.3, 2.05 - k * 0.55 - Math.sin(k * Math.PI) * sag + Math.sin(i * 1.9) * 0.045, z + Math.cos(i * 1.9) * 0.045 + k * 0.1]); }
    B.add('vcGloss', tube(pts, 0.011, far ? 3 : 5, far ? 1 : 3), { color: col });
  };
  coil(-0.16, rgb(0x8a1010), 0.25); coil(0.0, rgb(0x0f2c7a), 0.32); coil(0.15, rgb(0x0b0b0b), 0.2);

  // reflection stand-in: nose, cab, sleeper fairing, chassis and wheels as one dark block
  const PAINT = rgb(0x9a3a12, 0.8);
  B.refl([1.1, 1.0, -0.9], [3.56, 1.85, 0.9], PAINT);
  B.refl([-1.0, 1.0, -cabW / 2], [1.14, 2.9, cabW / 2], PAINT);
  B.refl([-1.0, 2.9, -cabW / 2], [-0.3, 3.3, cabW / 2], PAINT);
  B.refl([-4.1, 0.05, -1.2], [3.7, 1.0, 1.2], FRAME);
  B.blob(8.6, 3.6, -0.2, 0);
  B.collide([1.1, 0, -1.2], [3.8, 1.9, 1.2], 'metal', 0.6);
  B.collide([-1.05, 0, -1.25], [1.1, 3.3, 1.25], 'metal', 0.6);
  B.collide([-4.1, 0, -1.25], [-1.05, 1.3, 1.25], 'metal', 0.6);
}

// o: { paint, doorOpen (radians, right-hand rear door), cargo (bool) }
function trailerParts(B, o = {}) {
  const paint = o.paint || 'paintTrailer';
  const far = !!o.far, near = B.mesh && !far;
  const { L, W, floor, roof } = TRAILER;
  const h = L / 2, hw = W / 2;
  const open = o.doorOpen || 0;

  // ---- box: five skins so the open rear shows a real interior
  for (const s of [1, -1]) {
    if (B.mesh) sideSkin(B, s, o, paint);
    else B.add(paint, box(L - 0.1, roof - floor - 0.1, 0.02), { m: M(0, (floor + roof) / 2, s * (hw - 0.06)), shadow: true });
  }
  B.add(paint, box(L, 0.05, W, 0.02, 1), { m: M(0, roof - (B.mesh ? 0.025 : 0.09), 0), shadow: true });
  B.add(paint, box(0.05, roof - floor, W), { m: M(h - 0.025, (floor + roof) / 2, 0), shadow: true });
  B.add('vcMatte', box(L, 0.12, W - 0.04), { m: M(0, floor - 0.06, 0), color: rgb(0x2a231b), shadow: true });
  B.add('vcMatte', box(L - 0.1, roof - floor - 0.1, 0.01), { m: M(0, (floor + roof) / 2, hw - 0.05), color: rgb(0x54504a) });
  B.add('vcMatte', box(L - 0.1, roof - floor - 0.1, 0.01), { m: M(0, (floor + roof) / 2, -hw + 0.05), color: rgb(0x54504a) });
  B.add('vcMatte', box(0.01, roof - floor - 0.1, W - 0.1), { m: M(h - 0.06, (floor + roof) / 2, 0), color: rgb(0x4a4640) });
  // rails, corner posts, side posts
  for (const s of [1, -1]) {
    B.add('chrome', box(L + 0.02, 0.14, 0.05, 0.015, 1), { m: M(0, floor + 0.02, s * (hw + 0.005)) });
    B.add('chrome', box(L + 0.02, 0.1, 0.05, 0.015, 1), { m: M(0, roof - 0.05, s * (hw + 0.005)) });
    // side posts: pressed hat sections standing off the sheet, their slanted flanks catching the lamps
    if (B.mesh) {
      const np = far ? 15 : 30, y0 = floor + 0.1, y1 = roof - 0.1, ST = { color: rgb(PAINT_HEX[paint] ?? 0xd3d1c8), a: [0, 0, 0, 0], b: [B.body.fx[0], B.body.fx[1] + 0.25, 0, 0] };
      for (let i = 1; i < np; i++) {
        const x = -h + (i * L) / np, z0 = hw - 0.004, z1 = hw + 0.02;
        const sec = [[x - 0.036, z0, -0.75, 0.66], [x - 0.02, z1, -0.3, 0.95], [x + 0.02, z1, 0.3, 0.95], [x + 0.036, z0, 0.75, 0.66]];
        const id = [];
        for (const y of [y0, y1]) for (const [px, pz, nx, nz] of sec) id.push(B.body.vert(px, y, s * pz, nx, 0, s * nz, ST.color, ST.a, ST.b));
        for (let k = 0; k < 3; k++) { if (s > 0) B.body.quad(id[k], id[k + 1], id[k + 5], id[k + 4]); else B.body.quad(id[k], id[k + 4], id[k + 5], id[k + 1]); }
      }
    }
    for (const x of [h - 0.04, -h + 0.04]) B.add('chrome', box(0.1, roof - floor, 0.07, 0.02, 1), { m: M(x, (floor + roof) / 2, s * (hw - 0.02)) });
    // conspicuity tape: red and white along the whole of the bottom rail, in lengths, and the operator's name
    for (let i = 0; i < 13; i++) B.add('atlasLit', quadUV(0.78, 0.052, B.atlas.uv('tape')), { m: M(-h + 0.52 + i * 0.93, floor + 0.02, s * (hw + 0.034), 0, s > 0 ? 0 : Math.PI, 0) });
    B.add('atlasLit', quadUV(4.4, 1.1, B.atlas.uv('haulage')), { m: M(0.6, floor + 1.75, s * (hw + 0.033), 0, s > 0 ? 0 : Math.PI, 0) });
    // marker lamps: oblong lenses in bright bezels
    const side = (x, y) => M(x, y, s * (hw + 0.03), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    marker(B, side(h - 0.2, roof - 0.14), 0.1, 0.04, AMBER, { far });
    marker(B, side(0, floor + 0.12), 0.1, 0.04, AMBER, { far });
    marker(B, side(-h + 0.2, roof - 0.14), 0.1, 0.04, RED, { far });
  }
  // front bulkhead: document box, gladhands
  B.add('chrome', box(0.05, 0.3, 0.4, 0.015, 1), { m: M(h + 0.02, floor + 0.5, 0.3) });
  B.add('vcMatte', box(0.06, 0.12, 0.3, 0.02, 1), { m: M(h + 0.02, floor + 0.3, -0.3), color: BLACK });

  // ---- rear frame and doors
  B.add('chrome', box(0.1, 0.12, W, 0.02, 1), { m: M(-h + 0.05, roof - 0.06, 0) });
  B.add('chrome', box(0.1, 0.16, W, 0.02, 1), { m: M(-h + 0.05, floor - 0.02, 0) });
  const door = (s, ang) => {
    const hinge = M(-h, 0, s * (hw - 0.03), 0, s * ang, 0);
    const w = hw - 0.05;
    const at = (m) => hinge.clone().multiply(m);
    B.add(paint, box(0.045, roof - floor - 0.2, w, 0.012, 1), { m: at(M(-0.02, (floor + roof) / 2, -s * w / 2)), shadow: true });
    if (far) { for (const k of [0.3, 0.72]) B.add('chrome', box(0.03, roof - floor - 0.1, 0.03), { m: at(M(-0.055, (floor + roof) / 2, -s * w * k)) }); return; }
    // pressed ribs across the outer skin; inside, a ply liner with steel straps and a black gasket
    for (let i = 0; i < 7; i++) B.add(paint, box(0.022, 0.07, w - 0.12, 0.01, 1), { m: at(M(-0.05, floor + 0.32 + i * 0.37, -s * w / 2)) });
    // the inside face, which is what an open door shows: a steel frame round a scuffed ply liner,
    // pressed stiffening ribs across it, the hold-back chain, a reflective strip along its foot,
    // the manifest pocket; the lock rods' cams stand out past its top and bottom edges
    B.add('vcMatte', box(0.012, roof - floor - 0.34, w - 0.14), { m: at(M(0.008, (floor + roof) / 2, -s * w / 2)), color: rgb(0x6a5a40) });
    for (let i = 0; i < 9; i++) B.add(paint, box(0.03, 0.055, w - 0.1, 0.012, 1), { m: at(M(0.022, floor + 0.3 + i * 0.29, -s * w / 2)) });
    for (const zz of [0.07, w - 0.07]) B.add(paint, box(0.03, roof - floor - 0.26, 0.07, 0.012, 1), { m: at(M(0.02, (floor + roof) / 2, -s * zz)) });
    for (const yy of [floor + 0.17, roof - 0.17]) B.add(paint, box(0.03, 0.07, w - 0.06, 0.012, 1), { m: at(M(0.02, yy, -s * w / 2)) });
    B.add('atlasLit', quadUV(w - 0.2, 0.06, B.atlas.uv('tape')), { m: at(M(0.04, floor + 0.2, -s * w / 2, 0, Math.PI / 2, 0)) });
    B.add('vcMatte', box(0.012, 0.3, 0.24, 0.004, 1), { m: at(M(0.042, floor + 1.5, -s * w * 0.45)), color: rgb(0x8a8672) }); // manifest pocket
    for (let i = 0; i < 7; i++) B.add('chrome', box(0.012, 0.05, 0.02), { m: at(M(0.05 + (i % 2) * 0.008, floor + 1.2 - i * 0.045, -s * (w - 0.2), 0, 0, i % 2 ? 0.5 : -0.5)) }); // hold-back chain
    B.add('chrome', box(0.02, 0.05, 0.05, 0.006, 1), { m: at(M(0.05, floor + 1.24, -s * (w - 0.2))) });
    for (const zz of [0.03, w - 0.03]) B.add('vcMatte', box(0.03, roof - floor - 0.22, 0.03), { m: at(M(0.004, (floor + roof) / 2, -s * zz)), color: BLACK });
    for (const yy of [floor + 0.2, floor + 0.95, roof - 1.0, roof - 0.25]) { // strap hinges
      B.add('chrome', box(0.02, 0.07, 0.34, 0.006, 1), { m: at(M(-0.05, yy, -s * 0.17)) });
      B.add('chrome', cyl(0.022, 0.022, 0.11, 8), { m: at(M(-0.02, yy, s * 0.012)) });
    }
    for (const k of [0.3, 0.72]) { // lock rods with handles and keepers
      B.add('chrome', cyl(0.016, 0.016, roof - floor - 0.1, 6), { m: at(M(-0.055, (floor + roof) / 2, -s * w * k)) });
      B.add('chrome', box(0.02, 0.04, 0.3, 0.008, 1), { m: at(M(-0.065, floor + 0.85, -s * (w * k + 0.12))) });
      for (const y of [floor + 0.12, roof - 0.14]) B.add('chrome', box(0.04, 0.06, 0.07, 0.01, 1), { m: at(M(-0.055, y, -s * w * k)) });
      for (const y of [floor + 0.04, roof - 0.05]) B.add('chrome', box(0.1, 0.035, 0.05, 0.008, 1), { m: at(M(-0.02, y, -s * w * k)) }); // cams
    }
    for (const y of [floor + 0.25, (floor + roof) / 2, roof - 0.3]) B.add('chrome', box(0.03, 0.09, 0.14, 0.01, 1), { m: at(M(-0.045, y, -s * 0.06)) });
    B.add('atlasLit', quadUV(w - 0.1, 0.06, B.atlas.uv('tape')), { m: at(M(-0.046, floor + 0.2, -s * w / 2, 0, -Math.PI / 2, 0)) });
  };
  door(-1, 0);
  door(1, open);
  // lamps, bumper, underride guard
  const STEEL = rgb(0x24262a);
  for (const s of [1, -1]) {
    // tail lamps: two round units a side let into the rear sill, red lenses ribbed in rings
    if (B.mesh) {
      B.add('vcMatte', box(0.05, 0.16, 0.42, 0.015, 1), { m: M(-h - 0.005, floor - 0.2, s * 0.9), color: STEEL });
      for (const dz of [-0.1, 0.1]) marker(B, M(-h - 0.032, floor - 0.2, s * 0.9 + dz, 0, Math.PI, 0), 0.11, 0.11, RED, { far, pw: 2 });
    }
    // underride guard: hangers off the frame, braced, a square bar across at bumper height
    B.add('vcMatte', boxUp(0.08, 0.66, 0.1), { m: M(-h + 0.1, 0.52, s * 0.45), color: STEEL });
    if (near) B.add('vcMatte', box(0.06, 0.7, 0.06), { m: M(-h + 0.36, 0.86, s * 0.45, 0, 0, -0.75), color: STEEL });
    mudflap(B, -h + 0.15, s * 0.92); // behind the rear axle (it stood inside the wheels)
    for (const x of [-4.1, -5.38]) bigWheel(B, x, s * 1.05, s, true);
    // the bogie: the slider rail under the floor, spring hangers and a leaf pack over each axle
    B.add('vcMatte', box(L - 1.2, 0.2, 0.09), { m: M(-0.2, floor - 0.22, s * 0.45), color: FRAME });
    if (near) {
      B.add('vcMatte', box(2.5, 0.06, 0.09, 0.02, 1), { m: M(-4.74, 0.72, s * 0.5), color: STEEL });
      for (const x of [-5.9, -4.74, -3.58]) B.add('vcMatte', box(0.14, 0.34, 0.12), { m: M(x, 0.9, s * 0.5), color: FRAME });
      for (const x of [-4.1, -5.38]) B.add('vcMatte', box(0.2, 0.12, 0.16), { m: M(x, 0.62, s * 0.5), color: FRAME });
    }
    // landing gear
    B.add('vcMatte', boxUp(0.12, 0.98, 0.12), { m: M(3.4, 0.28, s * 0.8), color: FRAME, shadow: true });
    B.add('vcMatte', boxUp(0.3, 0.04, 0.26, 0.01, 1), { m: M(3.4, 0.26, s * 0.8), color: FRAME });
    B.add('vcMatte', box(1.4, 0.26, 0.1), { m: M(-4.74, 0.98, s * 0.45), color: FRAME });
  }
  B.add('vcMatte', box(0.11, 0.11, 2.42, 0.012, 1), { m: M(-h + 0.1, 0.52, 0), color: STEEL, shadow: true });
  B.add('atlasLit', quadUV(2.3, 0.055, B.atlas.uv('tape')), { m: M(-h + 0.043, 0.52, 0, 0, -Math.PI / 2, 0) });
  // cross-members under the floor, seen from low down along the flank
  if (near) for (let i = 0; i < 16; i++) B.add('vcMatte', box(0.06, 0.1, W - 0.2), { m: M(-h + 0.6 + i * 0.74, floor - 0.17, 0), color: FRAME });
  B.add('vcMatte', box(0.06, 0.06, 1.7), { m: M(3.4, 0.75, 0), color: FRAME });
  for (const x of [-4.1, -5.38]) B.add('vcMatte', cyl(0.1, 0.1, 2.2, 8).rotateX(Math.PI / 2), { m: M(x, 0.52, 0), color: FRAME });
  B.add('vcMatte', box(0.5, 0.1, 0.5, 0.02, 1), { m: M(TRAILER.kingpinX, floor - 0.1, 0), color: FRAME });

  // a work lamp left on inside, at the rear: enough to see the load by
  B.add('vcGlow', box(0.6, 0.025, 0.09), { m: M(-h + 0.6, roof - 0.07, 0), color: [9, 11, 10] });
  B.add('vcMatte', box(0.7, 0.04, 0.14), { m: M(-h + 0.6, roof - 0.045, 0), color: FRAME });
  B.fixtures.push({ kind: 'trailerLamp', pos: B.point(-h + 0.35, roof - 0.6, 0) });
  // and a work lamp on the rear header, outside over the doors: it lights the sill, whatever was
  // dragged out, and the rain and the drips coming off the roof edge (which nothing else reaches)
  B.add('vcMatte', box(0.14, 0.08, 0.24, 0.01, 1), { m: M(-h - 0.07, roof - 0.13, 0), color: FRAME });
  B.add('vcGlow', box(0.1, 0.012, 0.18), { m: M(-h - 0.08, roof - 0.176, 0), color: [26, 30, 28] });
  B.fixtures.push({ kind: 'trailerWork', pos: B.point(-h - 0.3, roof - 0.26, 0), dir: B.dir(-0.32, -1, 0) });
  // ---- cargo: cases stacked inside, some dragged out
  if (o.cargo) {
    const rng = B.rng.fork('cargo');
    for (let i = 0; i < 26; i++) {
      const x = -h + 0.6 + Math.floor(i / 6) * 0.72 + rng.range(-0.05, 0.05);
      const z = -0.9 + (i % 3) * 0.62 + rng.range(-0.04, 0.04);
      const y = floor + (Math.floor(i / 3) % 2) * 0.47;
      const c = [CARD[0] * rng.range(0.75, 1.1), CARD[1] * rng.range(0.75, 1.1), CARD[2] * rng.range(0.75, 1.05)];
      B.add('vcMatte', boxUp(0.62, 0.45, 0.56, 0.012, 1), { m: M(x, y, z, 0, rng.range(-0.08, 0.08), 0), color: c });
      // the work lamp's light on the nearest of the load, baked, so the cases show from the lane
      // whether or not the lamp holds a real light slot: brightest on the faces turned to it
      if (x < -h + 2.2) {
        const q = B.point(-h + 0.6, roof - 0.1, 0);
        const lit = (n, p) => {
          const dx = q[0] - p.x, dy = q[1] - p.y, dz = q[2] - p.z, d2 = dx * dx + dy * dy + dz * dz;
          const k = 0.05 + 2.2 * Math.max(0, (n.x * dx + n.y * dy + n.z * dz) / Math.sqrt(d2)) / (0.6 + d2);
          return [c[0] * k * 0.95, c[1] * k, c[2] * k * 0.92];
        };
        B.add('vcGlow', boxUp(0.622, 0.451, 0.562, 0.012, 1), { m: M(x, y, z), color: lit });
      }
      if (x < -h + 1.0) B.add('atlasLit', quadUV(0.36, 0.24, B.atlas.uv('boxLabel')), { m: M(x - 0.312, y + 0.24, z, 0, -Math.PI / 2, 0) });
    }
  }

  B.refl([-h, floor, -hw], [h, roof, hw], rgb(0xd3d1c8, 0.6));
  B.refl([-5.95, 0.02, -1.22], [-3.5, floor, 1.22], FRAME);
  B.blob(4.6, 3.6, -4.6, 0);
  B.blob(1.6, 3.2, 3.4, 0);
  B.collide([-h, 0, -hw], [h, roof, hw], 'metal', 0.6);
  B.shelter([-h, floor, -hw], [h, roof, hw], L / 8); // dry under and inside the box
}

// A cardboard case on the ground (spilled cargo). Local origin at the centre of its base.
export function cargoBox(B, tint = 1, label = true) {
  B.add('vcMatte', boxUp(0.62, 0.45, 0.56, 0.012, 1), { color: [CARD[0] * tint, CARD[1] * tint, CARD[2] * tint], shadow: true });
  if (label) B.add('atlasLit', quadUV(0.36, 0.24, B.atlas.uv('boxLabel')), { m: M(0, 0.24, 0.282) });
  B.collide([-0.31, 0, -0.28], [0.31, 0.45, 0.28], 'cloth', 0.4);
}

// A trailer flank as a sheet with some life in it: shallow dents, and down the right-hand side the
// long scrape of whatever it folded round, paint gone to bare aluminium along it.
function sideSkin(B, s, o, paintKey) {
  const { L, W, floor, roof } = TRAILER;
  const h = L / 2, hw = W / 2;
  const buf = B.body;
  const rng = createRng(0x51de ^ (s > 0 ? 7 : 3));
  const dents = [];
  for (let i = 0; i < 5; i++) dents.push([rng.range(-h + 0.5, h - 0.5), rng.range(floor + 0.3, roof - 0.4), rng.range(0.25, 0.6), rng.range(0.008, 0.022)]);
  const wob = [rng.range(0, 6), rng.range(0, 6)];
  const field = (x, y) => {
    let d = 0, m = 0;
    for (const [dx, dy, r, dep] of dents) { const q = Math.hypot(x - dx, y - dy) / r; if (q < 1) { const f = (1 - q * q) ** 2; d += dep * f; m = Math.max(m, 0.5 * Math.exp(-(((q - 0.8) / 0.15) ** 2))); } }
    if (s > 0 && !o.far) {
      const yc = floor + 1.05 + 0.1 * Math.sin(x * 0.9 + wob[0]) + 0.04 * Math.sin(x * 4.1 + wob[1]);
      const along = Math.min(1, Math.max(0, (x + 4.6) / 0.6)) * Math.min(1, Math.max(0, (3.8 - x) / 1.2));
      const core = Math.exp(-(((y - yc) / 0.11) ** 2)), hair = Math.exp(-(((y - yc - 0.33) / 0.03) ** 2)) + Math.exp(-(((y - yc + 0.27) / 0.025) ** 2));
      d += 0.02 * core * along;
      m = Math.max(m, along * Math.min(1, 0.95 * core + 0.8 * hair));
    }
    return [d, m];
  };
  const nx = o.far ? 16 : 72, ny = o.far ? 3 : 14;
  const col = rgb(PAINT_HEX[paintKey] ?? 0xd3d1c8);
  const idx = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const x = -h + (L * i) / nx, y = floor + ((roof - floor) * j) / ny;
    const [d, m] = field(x, y);
    const e = 0.04, gx = (field(x + e, y)[0] - field(x - e, y)[0]) / (2 * e), gy = (field(x, y + e)[0] - field(x, y - e)[0]) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    idx.push(buf.vert(x, y, s * (hw - d), (s * gx) / l * s, gy / l, s / l, col, [0, 0, 0, 0], [buf.fx[0], buf.fx[1], m, 0]));
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const a = idx[i * (ny + 1) + j], b = idx[(i + 1) * (ny + 1) + j], c = idx[(i + 1) * (ny + 1) + j + 1], d = idx[i * (ny + 1) + j + 1];
    if (s > 0) buf.quad(a, b, c, d); else buf.quad(a, d, c, b);
  }
}

const PAINT_HEX = { paintTruck: 0x9a3a12, paintTrailer: 0xd3d1c8, ...CAR_PAINT };
const WHITE = [1, 1, 1];

// the level's share of a vehicle: atlas decals, shadow casters, stand-ins, colliders, fixtures
function levelPass(B) {
  const P = {
    add(key, geo, opts = {}) {
      if (key === 'atlasLit') B.add(key, geo, opts);
      else if (opts.shadow) B.add('shadow', geo, { m: opts.m });
      else geo.dispose();
      return P;
    },
    at: (m, fn) => B.at(m, fn), point: (x, y, z) => B.point(x, y, z), dir: (x, y, z) => B.dir(x, y, z),
    fixtures: B.fixtures, refl: (...a) => { B.refl(...a); return P; }, blob: (...a) => { B.blob(...a); return P; },
    collide: (...a) => { B.collide(...a); return P; }, shelter: (...a) => { B.shelter(...a); return P; },
    atlas: B.atlas, rng: B.rng, mesh: false,
  };
  return P;
}

// the layer's share: every part into the vehicle's buffers
function meshPass(parts, env) {
  const fx = [env.dirt ?? 0.6, (env.rust ?? 0.4) * 0.3, 0, 0];
  const body = new VBuf(fx), glass = new VBuf([0, 0, 0, 0]), lit = new VBuf([0, 0, 0, 0]);
  const wheels = [], plates = [];
  const A = {
    plate(m, text) { plates.push({ m: new Matrix4().multiplyMatrices(body.top, m), text }); return A; },
    mesh: true, body, glass, lit, fixtures: [], atlas: { uv: () => [0, 0, 1, 1] }, rng: env.rng || createRng(7),
    at: (m, fn) => body.at(m, () => glass.at(m, () => lit.at(m, fn))),
    point(x, y, z) { const e = body.top.elements; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; },
    dir(x, y, z) { const e = body.top.elements; return [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z]; },
    refl() { return A; }, blob() { return A; }, collide() { return A; }, shelter() { return A; },
    wheel(x, z, side, dual) {
      const wr = 0.52, w = 0.3;
      for (let i = 0; i < (dual ? 2 : 1); i++) wheels.push({ m: new Matrix4().multiplyMatrices(body.top, M(x, wr, z - side * i * (w + 0.03), 0, side > 0 ? 0 : Math.PI, 0, wr, wr, w)), rim: i === 0 ? 'steel' : 'none' });
    },
    add(key, geo, opts = {}) {
      const m = opts.m || null;
      if (key === 'atlasLit' || key === 'uvBlob') { geo.dispose(); return A; }
      if (key === 'glassCar') glass.add(geo, { color: [0.018, 0.028, 0.025], a: [0.5, 1, -99, 0] }, m);
      else if (key === 'vcGlow' || key.startsWith('blink')) {
        const fn = typeof opts.color === 'function' ? opts.color : null;
        const s0 = lit.n;
        lit.add(geo, { color: fn ? WHITE : (opts.color || WHITE), a: [0, 0, key.startsWith('blink') ? 1 : 0, 0] }, m);
        if (fn) for (let i = s0; i < lit.n; i++) {
          const c = fn({ x: lit.nrm[i * 3], y: lit.nrm[i * 3 + 1], z: lit.nrm[i * 3 + 2] }, { x: lit.pos[i * 3], y: lit.pos[i * 3 + 1], z: lit.pos[i * 3 + 2] });
          lit.col[i * 3] = c[0]; lit.col[i * 3 + 1] = c[1]; lit.col[i * 3 + 2] = c[2];
        }
      } else if (key.startsWith('paint')) body.add(geo, { color: rgb(PAINT_HEX[key] ?? 0x777777), a: [0, 0, 0, 0] }, m);
      else if (key === 'chrome') body.add(geo, { color: [0.72, 0.74, 0.77], a: [2, 0, 0, 0], b: [fx[0] * 0.35, fx[1] * 0.3, 0, 0] }, m);
      else if (key === 'rubber') body.add(geo, { color: [0.012, 0.012, 0.013], a: [1, 0, 0, 0] }, m);
      else if (key === 'vcCabin') body.add(geo, { color: opts.color || WHITE, a: [3, opts.emis || 0, 0, 0] }, m);
      else body.add(geo, { color: opts.color || WHITE, a: [1, 0, 0, 0] }, m);
      return A;
    },
  };
  parts(A);
  return { body, glass, lit, wheels, plates };
}

// B: the level builder. o as tractorParts, plus far (highway: merged into the far mesh), prop.
export function buildTractor(B, o = {}) {
  tractorParts(levelPass(B), o);
  const env = { dirt: 0.55, rust: 0.35, rng: B.rng };
  // searched: the locker under the sleeper drops open, its lamp on
  const px = -0.6, py = 1.22, pz = -(CAB_HW + 0.036);
  const lid = M(px, py, pz, -1.35, 0, 0).multiply(M(-px, -py, -pz));
  return registerVehicle(B, {
    kind: 'tractor', oneLevel: true, dims: { truck: true, name: 'truck-cab', from: [5.5, 1.9, -4.8], to: [0.6, 1.9, 0] }, id: o.id || 'tractor', prop: o.far ? null : (o.prop || 'lorry:cab'), far: !!o.far, reach: 4, lid,
    build: () => meshPass((A) => {
      tractorParts(A, o);
      if (o.far) return;
      A.body.range('lid', () => A.add(o.paint || 'paintTruck', box(0.56, 0.44, 0.025), { m: M(px, py + 0.22, pz) }));
      const s0 = A.body.n;
      A.add('vcCabin', box(0.5, 0.4, 0.3), { m: M(px, py + 0.22, pz + 0.17), color: rgb(0x202022), emis: 1.6 });
      A.add('vcCabin', box(0.3, 0.14, 0.2, 0.03, 1), { m: M(px + 0.05, py + 0.1, pz + 0.1), color: rgb(0x5a1410), emis: 1.6 });
      A.body.ranges.lidGlow = [[s0, A.body.n - s0]];
      A.lit.range('lidGlow', () => A.add('vcGlow', box(0.2, 0.012, 0.03), { m: M(px, py + 0.41, pz + 0.04), color: rgb(0xffe2b0, 12) }));
    }, env),
  });
}

export function buildTrailer(B, o = {}) {
  trailerParts(levelPass(B), o);
  const env = { dirt: 0.8, rust: 0.5, rng: B.rng };
  return registerVehicle(B, { kind: 'trailer', oneLevel: true, dims: { truck: true, name: 'truck-trailer', from: [-9.2, 1.8, 2.6], to: [-5, 2.2, 0] }, id: o.id || 'trailer', far: !!o.far, reach: 6.2, build: () => meshPass((A) => trailerParts(A, o), env) });
}
