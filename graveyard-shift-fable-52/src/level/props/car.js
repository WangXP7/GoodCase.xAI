// Cars. One parametric body per type: the side profile (bonnet, cowl, belt line, boot,
// wheel arches) and a cross-section swept along it (sill tuck, bowed door skin, shoulder crease,
// the shoulder rolling into bonnet and deck, and through the cabin the glass plane leaning in to
// the roof rail and the crowned roof) give one grid of points. Panels are cut from that grid along
// the shut lines (vehicleParts.panelize): each panel's edge is pulled back and turned in, so
// bonnet, wings, doors, boot, roof and sills are separate pressings with gaps you can look into,
// the windows are cells of the same grid set back in their frames, an open door or boot lid is its
// panel moved on its hinge, and what shows through the hole is a modelled cabin. Lamps, bumpers,
// grille, handles, mirrors, wipers, plates and the underside are parts placed on that skin.
//
// buildCar(B, o) authors what the level needs without a renderer (colliders, fixtures, the shadow
// and reflection stand-ins) and registers the car with the vehicle layer, which builds the meshes
// at three levels of detail in the browser. Local space: +x the front, +z the right-hand side,
// y = 0 the road.
import { BufferGeometry, BufferAttribute, Matrix4 } from 'three';
import { M, box, boxUp, cyl, lathe, extrude, deform, roundPoly, quadUV, rgb, torus, sphere, tube } from '../build.js';
import { createRng } from '../../core/rng.js';
import { VBuf, panelize, gridNormals, bowl, lensPlate, registerVehicle, setTestVehicles, NEAR, MID, FAR } from './vehicleParts.js';

// L, W, cowlX, rearBaseX, roofF, roofR, hoodF, hoodR, belt, deckY and roofY place the colliders
// (buildCar) and are the original ones. The rest is how the type looks: wheelbase, overhang, wheel size and
// ride height, its lamps (lamp: 'quad' twin oblongs | 'rect' | 'round', lampW x lampH), its grille
// ('slats' | 'crate' | 'bars' | 'slot'), its tail cluster ('wide' | 'tall' | 'wrap'), its bumpers.
export const CAR_TYPES = {
  sedan: { L: 4.72, W: 1.82, wb: 2.78, fo: 0.92, wr: 0.36, sill: 0.18, hoodF: 0.7, hoodR: 0.93, cowlX: 0.86, belt: 0.93, roofY: 1.44, roofF: 0.2, roofR: -1.0, rearBaseX: -1.72, deckY: 0.95, tailY: 0.9, pillarC: 0.2, lamp: 'quad', lampW: 0.42, lampH: 0.125, grille: 'slats', tailLamp: 'wide',
    // (a saloon's dressed tail: a reflector panel in a bright frame between the lamps, the lock and the maker's bar on the lid)
    look: { tailDress: 'panel' } },
  hatch: { L: 4.05, W: 1.74, wb: 2.56, fo: 0.76, wr: 0.33, sill: 0.17, hoodF: 0.72, hoodR: 0.95, cowlX: 0.72, belt: 0.95, roofY: 1.47, roofF: 0.12, roofR: -1.45, rearBaseX: -1.93, deckY: 0.95, tailY: 0.93, pillarC: 0.14, lamp: 'rect', lampW: 0.3, lampH: 0.135, grille: 'slot', tailLamp: 'wrap',
    // (a small car somebody cared about: a black tailgate strip with its handle, a lip over the rear
    // glass, two driving lamps on the front bumper, mud flaps)
    look: { tailDress: 'strip', spots: true, flaps: true, lip: true } },
  suv: { L: 4.85, W: 1.94, wb: 2.94, fo: 0.84, wr: 0.425, sill: 0.27, hoodF: 0.98, hoodR: 1.16, cowlX: 0.84, belt: 1.16, roofY: 1.8, roofF: 0.3, roofR: -2.0, rearBaseX: -2.33, deckY: 1.16, tailY: 1.14, pillarC: 0.16, rack: true, tum: 0.2, lamp: 'rect', lampW: 0.22, lampH: 0.16, grille: 'bars', tailLamp: 'tall', steelBump: true,
    // (how it is drawn where that may differ from the collider's boxes: an upright off-roader on tall tyres)
    look: { roofF: 0.44, roofR: -2.2, tum: 0.11, sill: 0.33, wr: 0.445, hoodF: 1.03, flare: true, rackKind: 'basket', pillarC: 0.2 } },
  pickup: { L: 5.5, W: 1.98, wb: 3.5, fo: 0.95, wr: 0.445, sill: 0.31, hoodF: 1.04, hoodR: 1.2, cowlX: 1.2, belt: 1.2, roofY: 1.84, roofF: 0.68, roofR: -0.42, rearBaseX: -0.62, deckY: 1.22, tailY: 1.22, pillarC: 0.12, bed: true, tum: 0.2, lamp: 'round', lampW: 0.19, lampH: 0.19, grille: 'crate', tailLamp: 'tall', steelBump: true,
    // (a working truck's face: the grille runs down to the bumper, a parking lamp under each headlamp)
    look: { faceDrop: 0.19 } },
  wagon: { L: 4.9, W: 1.84, wb: 2.9, fo: 0.92, wr: 0.357, sill: 0.18, hoodF: 0.72, hoodR: 0.94, cowlX: 0.92, belt: 0.94, roofY: 1.5, roofF: 0.3, roofR: -2.05, rearBaseX: -2.36, deckY: 0.94, tailY: 0.92, pillarC: 0.14, rack: true, lamp: 'quad', lampW: 0.4, lampH: 0.12, grille: 'crate', tailLamp: 'tall',
    // (a long low estate: fast screen, the roof falling to a raked tailgate)
    look: { roofF: 0.16, roofR: -1.8, roofDrop: 0.07, tum: 0.34, hoodF: 0.68, rackKind: 'rails' } },
};
const ARCH_GAP = 0.03; // between the tyre and the lip of its arch
export const CAR_PAINT = { paintCarA: 0x8e1a14, paintCarB: 0xcfd0cb, paintCarC: 0x1b3f40, paintCarD: 0x131518, paintCarE: 0x6d8ca6, paintCarF: 0x3a4a68 };
const FAR_PAINT = [0x8e1a14, 0xb9bab5, 0x1b3f40, 0x131518, 0x6d8ca6, 0x3a4a68, 0x5c5a52];
const PLATES = { plateA: '7KD·R241', plateB: 'NTJ·4409', plateC: '2WX·L087', plateD: 'HVN·5530' };
// what each of the lot's vehicles has been through, where the level does not say (ids from layout.js)
const HISTORY = {
  saloon: { dirt: 0.4, rust: 0.2 },
  pickup: { dirt: 0.75, rust: 0.6, damage: 0.35, steel: true },
  hatch: { dirt: 0.55, rust: 0.7, brokenGlass: ['rl'], damage: 0.25 },
  suv: { dirt: 0.5, rust: 0.12 },
  cruiser: { dirt: 0.35, rust: 0.1, brokenGlass: ['ws'], steel: true, shotSide: 1 }, // (the wash bay's curtain hangs on its other side)
  wagon: { dirt: 0.5, rust: 0.45, damage: 0.9, brokenGlass: ['ws', 'fl'], crumple: 'fl', post: [2.527, -0.38, 0.34] }, // the lamp post's footing, in the car's space
  wreck0: { dirt: 0.8, rust: 0.85, damage: 0.8, brokenGlass: ['ws', 'fl', 'rl', 'rw'], crumple: 'fl' },
  wreck1: { dirt: 0.8, rust: 0.8, damage: 0.8, brokenGlass: ['ws', 'fr', 'fl', 'rr'], crumple: 'fr' },
};

const BLACK = rgb(0x050506), TRIM = rgb(0x121314), CHROME = [0.62, 0.64, 0.67];
const st = (color, cls, emis = 0, blink = 0) => ({ color, a: [cls, emis, blink, 0] });
const S_BLACK = st(BLACK, 1), S_TRIM = st(TRIM, 1), S_CHROME = st(CHROME, 2), S_STEEL = st([0.16, 0.16, 0.17], 5);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

export function archPoints(cx, cy, r, sill, n = 12) {
  const s = Math.max(-1, Math.min(1, (sill - cy) / r));
  const a2 = Math.asin(s), a1 = Math.PI - a2;
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a1 + (a2 - a1) * (i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]); }
  return out;
}

function bodyOutline(t, archN = 12, segs = 4) {
  const h = t.L / 2;
  const fx = h - t.fo, rx = fx - t.wb;
  const ra = t.wr + ARCH_GAP + 0.01; // (the arch lip, a part of its own, covers this edge)
  const top = [[t.cowlX, t.hoodR, 0.05]];
  if (t.bed) top.push([t.rearBaseX + 0.02, t.belt, 0.03], [t.rearBaseX - 0.02, t.deckY, 0.03], [-h + 0.06, t.deckY, 0.04]);
  else if (t.rearBaseX > -h + 0.3) top.push([t.rearBaseX, t.belt, 0.06], [-h + 0.1, t.deckY, 0.14]);
  else top.push([-h + 0.08, t.belt, 0.1]);
  return roundPoly([
    [-h + 0.02, t.sill + 0.24, 0.07], [-h + 0.16, t.sill + 0.03, 0.08],
    ...archPoints(rx, t.wr, ra, t.sill + 0.01, archN), ...archPoints(fx, t.wr, ra, t.sill + 0.01, archN),
    [h - 0.14, t.sill + 0.02, 0.08], [h, t.sill + 0.18, 0.08], [h + 0.01, t.hoodF - 0.05, 0.07], [h - 0.07, t.hoodF + 0.005, 0.09],
    ...top,
    [-h, t.tailY - 0.22, 0.09],
  ], segs);
}

// x where the windscreen (front) or rear glass meets height y
const frontAt = (t, y) => t.cowlX + (t.roofF - t.cowlX) * ((y - t.hoodR) / (t.roofY - t.hoodR));
const rearAt = (t, y) => t.rearBaseX + (t.roofR - t.rearBaseX) * ((y - t.belt) / (t.roofY - t.belt));

// lowest and highest y at which the vertical line at x crosses a closed outline
function span(poly, x) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) > 0) continue;
    const y = Math.abs(b[0] - a[0]) < 1e-9 ? [a[1], b[1]] : [a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
    for (const v of y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  return [lo, hi];
}

const ROWS = 11; // flank rows per side, sill to shoulder
// Where the lower body's skin is, for a car type: skin(x, y) -> z of the right-hand flank.
export function carShape(t) {
  const h = t.L / 2, hw = t.W / 2;
  const poly = bodyOutline(t, 12, 3);
  const sill = t.sill + 0.02;
  const ends = (x) => Math.max(-h + 0.004, Math.min(h - 0.004, x));
  const at = (x) => span(poly, ends(x));
  // half-width in plan: tapering to nose and tail, corners rounded off
  const half = (x) => {
    const e = Math.max(0, (Math.abs(x) - (h - 0.7)) / 0.7), c = Math.max(0, (Math.abs(x) - (h - 0.22)) / 0.22);
    return hw * (1 - 0.13 * e * e) - 0.13 * c * c * c;
  };
  const offset = (y, b, top) => {
    let d = 0.032 * Math.sin(Math.PI * clamp01((y - sill) / (t.belt - sill))) // the door skin bows out
      - 0.065 * (1 - smooth(sill, sill + 0.24, y)); // and turns under at the sill
    const full = smooth(0.24, 0.5, top - b); // the section flattens out where the flank gets short
    const yc = top - 0.085; // shoulder crease: a step in, then the shoulder leans toward the glass
    if (y > yc) d -= (0.013 * smooth(yc, yc + 0.014, y) + 0.2 * (y - yc)) * full;
    if (b > sill + 0.04 && y < b + 0.045) d += 0.02 * (1 - (y - b) / 0.045) * full; // wheel-arch lip
    return d;
  };
  const skin = (x, y) => { const [b, top] = at(x); return half(x) + offset(Math.min(y, top), b, top); };
  const rows = (x) => {
    const [b, top] = at(x);
    const H = top - b, rs = Math.min(0.05, H * 0.3), yc = top - 0.085;
    const w = smooth(0.24, 0.5, H);
    const placed = [b, b + 0.022, b + 0.05];
    for (let k = 1; k <= 5; k++) placed.push(b + 0.05 + ((yc - 0.006 - b - 0.05) * k) / 5);
    placed.push(yc + 0.014, Math.min(yc + 0.045, top - rs - 0.004), top - rs);
    const ys = placed.map((y, j) => { const even = b + ((H - rs) * j) / (ROWS - 1); return even + (y - even) * w; });
    return { b, top, rs, ys };
  };
  return { t, h, hw, poly, at, half, skin, rows, sill };
}

// A strip lying on the flank of side s (+1 right, -1 left), `off` proud of the skin.
function ribbon(S, pts, w, s, off = 0.003, across = 'y') {
  const pos = [], nrm = [], idx = [];
  pts.forEach(([x, y], i) => {
    for (const k of [-1, 1]) {
      const px = across === 'x' ? x + (k * w) / 2 : x, py = across === 'y' ? y + (k * w) / 2 : y;
      pos.push(px, py, s * (S.skin(px, py) + off));
      nrm.push(0, 0, s);
    }
    if (i) {
      const a = (i - 1) * 2;
      const flip = (across === 'y') === (s > 0);
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  return g;
}
const line = (a, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

// A closed section swept along an open path in plan, the ends capped. path: [[x, z], ...],
// sec: [[out, y], ...] (out: outward from the path, away from the point (cx, cz)).
export function sweep(path, sec, cx = 0, cz = 0) {
  const n = path.length, m = sec.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (nx * (path[i][0] - cx) + nz * (path[i][1] - cz) < 0) { nx = -nx; nz = -nz; }
    for (let j = 0; j < m; j++) pos.push(path[i][0] + nx * sec[j][0], sec[j][1], path[i][1] + nz * sec[j][0]);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, d = b + m;
    idx.push(a, b, c, b, d, c);
  }
  for (const [i, first] of [[0, true], [n - 1, false]]) {
    const base = pos.length / 3;
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < m; j++) { const k = (i * m + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); x += pos[k] / m; y += pos[k + 1] / m; z += pos[k + 2] / m; }
    pos.push(x, y, z);
    for (let j = 0; j < m; j++) { const p = base + j, q = base + ((j + 1) % m); if (first) idx.push(base + m, q, p); else idx.push(base + m, p, q); }
  }
  // a closed surface wound to face out has positive volume
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) + pos[a + 1] * (pos[b + 2] * pos[c] - pos[b] * pos[c + 2]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const k = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = k; }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// The plan outline of one end of the car (end: +1 nose, -1 tail), from x = xa on one flank round to
// the same on the other, `off` proud of the skin: what a bumper follows.
function endPath(S, end, xa, off) {
  const { h } = S;
  const xb = end * (h - 0.12), xc = end * (h + off);
  const za = S.half(xa) + off * 0.4, zb = S.half(xb) + off * 0.6;
  return roundPoly([[xa, -za, 0], [xb, -zb, 0.08], [xc, -(zb - 0.2), 0.17], [xc, zb - 0.2, 0.17], [xb, zb, 0.08], [xa, za, 0]], 3);
}

// ---- the grid -------------------------------------------------------------------------------------
const LODQ = [
  { dx: 0.1, rows: [0, 1, 2, 3, 5, 7, 8, 9, 10], NA: 3, NU: 4, NC: 3, NT: 4, arch: 12, seg: 3, gap: 0.016 },
  { dx: 0.22, rows: [0, 2, 4, 6, 8, 10], NA: 1, NU: 2, NC: 1, NT: 3, arch: 7, seg: 1, gap: 0.06 },
  { dx: 0.45, rows: [0, 5, 10], NA: 1, NU: 1, NC: 1, NT: 2, arch: 3, seg: 1, gap: 0.2 },
];

function bodyGrid(t, lod, keys) {
  const Q = LODQ[lod];
  const S = carShape(t);
  const { h } = S;
  const tum = t.tum ?? 0.3;
  const ghPoly = roundPoly([[t.cowlX + 0.04, t.hoodR - 0.03, 0], [t.roofF, t.roofY, 0.16], [t.roofR, t.roofY - 0.012 - (t.roofDrop || 0), 0.16], [t.rearBaseX, t.belt - 0.03, 0]], 5);
  const bedZone = (x) => !!t.bed && x < t.rearBaseX - 0.03 && x > -h + 0.06;
  // centre-line height of the top surface
  const cOf = (x) => {
    const [b, e] = S.at(x);
    const crown = 0.03 * Math.min(1, (e - b) / 0.4);
    const g = x > t.rearBaseX && x < t.cowlX + 0.04 ? span(ghPoly, x)[1] : -Infinity;
    return Math.max(e + crown, g);
  };
  // stations: every vertex of the side profile, the keys (where panels are cut), filled in between
  const poly = lod === NEAR ? S.poly : bodyOutline(t, Q.arch, Q.seg);
  const cl = (x) => Math.max(-h + 0.004, Math.min(h - 0.004, x));
  let xs = [...poly.map((p) => cl(p[0])), ...keys.map(cl)].sort((a, b) => a - b).filter((x, i, all) => !i || x - all[i - 1] > Q.gap);
  const filled = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1], n = Math.ceil(gap / Q.dx);
    for (let k = 1; k <= n; k++) filled.push(xs[i - 1] + (gap * k) / n);
  }
  xs = filled;
  const nL = Q.rows.length;
  const NP = nL + Q.NA + Q.NU + Q.NC + Q.NT;
  const ny = 2 * NP - 1, nx = xs.length;
  const P = new Float32Array(nx * ny * 3);
  const U = new Float32Array(nx); // height of the glass plane at each station (0 outside the cabin)
  const Z = new Float32Array(NP), Y = new Float32Array(NP);
  for (let i = 0; i < nx; i++) {
    const x = xs[i];
    const { top: e, rs, ys } = S.rows(x);
    let n = 0;
    for (const r of Q.rows) { Y[n] = ys[r]; Z[n] = S.skin(x, ys[r]); n++; }
    const zf = Z[n - 1], yf = Y[n - 1];
    for (let k = 1; k <= Q.NA; k++) { const a = ((Math.PI / 2) * k) / Q.NA; Z[n] = zf - rs * (1 - Math.cos(a)); Y[n] = yf + rs * Math.sin(a); n++; }
    const zt = zf - rs;
    const c = cOf(x), D = c - e;
    const slope = Math.min(1.3, Math.abs(cOf(x + 0.03) - cOf(x - 0.03)) / 0.06);
    const cr = Math.min(D, 0.03 + 0.11 * slope);
    const u = Math.max(0, D - cr), rB = Math.min(0.06, u * 0.45), wU = smooth(0.02, 0.12, u);
    U[i] = u;
    let zu = zt, yu = e;
    for (let k = 1; k <= Q.NU; k++) {
      const f = k / Q.NU;
      yu = e + (u - rB) * f;
      zu = zt - 0.012 * wU - tum * (yu - e) + 0.014 * Math.sin(Math.PI * f) * wU;
      Z[n] = zu; Y[n] = yu; n++;
    }
    for (let k = 1; k <= Q.NC; k++) { const a = ((Math.PI / 2) * k) / Q.NC; Z[n] = zu - rB * (1 - Math.cos(a)); Y[n] = yu + rB * Math.sin(a); n++; }
    const zR = zu - rB;
    if (bedZone(x)) {
      const fy = e - 0.48;
      const pts = Q.NT >= 4 ? [[zt - 0.055, e], [zt - 0.075, e - 0.02], [zt - 0.08, fy], [0, fy]]
        : Q.NT >= 3 ? [[zt - 0.06, e], [zt - 0.08, fy], [0, fy]] : [[zt - 0.07, e - 0.03], [0, e - 0.03]];
      for (const [pz, py] of pts) { Z[n] = pz; Y[n] = py; n++; }
    } else {
      for (let m = 1; m <= Q.NT; m++) { const k = 1 - m / Q.NT; Z[n] = zR * k; Y[n] = c - cr * k * k; n++; }
    }
    for (let j = 0; j < ny; j++) {
      const r = j < NP ? j : ny - 1 - j, s = j < NP ? 1 : -1;
      const k = (i * ny + j) * 3;
      P[k] = x; P[k + 1] = Y[r]; P[k + 2] = s * Z[r];
    }
  }
  const grid = { nx, ny, P, xs, NP, U, S, Q, iLow: nL - 1, iA: nL - 1 + Q.NA, iU: nL - 1 + Q.NA + Q.NU, iB: nL - 1 + Q.NA + Q.NU + Q.NC, bedZone, cOf };
  return grid;
}

// What the body has been through, as one displacement of the car's space: seeded dents in the
// flanks, a corner stove in round what it hit (o.post: [x, z, radius] in the car's space; without
// one, something about the size of a bollard at that corner), the scrapyard's press. Returns
// (out, x, y, z, s) -> how far the paint has let go there (0..1), the moved point written to out; s
// is the flank the point belongs to. The panel grid and every part hung on it go through the same
// function, so a bumper or a lamp moves with the metal it is bolted to.
function damageField(t, o) {
  const h = t.L / 2, hw = t.W / 2;
  const rng = createRng(o.seed).fork('dents');
  const dents = [];
  const n = Math.round((o.damage || 0) * 5);
  for (let i = 0; i < n; i++) dents.push({ x: rng.range(-h + 0.5, h - 0.5), y: rng.range(t.sill + 0.25, t.belt - 0.12), s: rng.next() < 0.5 ? 1 : -1, r: rng.range(0.12, 0.3), d: rng.range(0.012, 0.04) });
  let post = null;
  if (o.crumple) {
    const fr = o.crumple[0] === 'f' ? 1 : -1, s = o.crumple[1] === 'r' ? 1 : -1;
    for (let i = 0; i < 7; i++) dents.push({ x: fr * (h - rng.range(0.3, 1.15)), y: rng.range(t.sill + 0.15, t.hoodR - 0.02), s, r: rng.range(0.16, 0.36), d: rng.range(0.025, 0.07), top: i % 3 === 0 });
    post = o.post ? { x: Math.abs(o.post[0]), z: o.post[1], r: o.post[2], fr } : { x: h + 0.08, z: s * (hw - 0.4), r: 0.38, fr };
  }
  const crush = o.crushed || 0;
  const cr = createRng(o.seed).fork('crush');
  const ph = [cr.range(0, 6), cr.range(0, 6), cr.range(0, 6)];
  if (!dents.length && !post && !crush) return null;
  const front = h + 0.065; // the furthest forward anything on the nose stands
  return (out, x0, y0, z0, s) => {
    let x = x0, y = y0, z = z0, m = 0;
    for (const d of dents) {
      if (d.s !== s && Math.abs(z) > 0.25) continue;
      const q = Math.hypot(x - d.x, y - d.y) / d.r;
      if (q >= 1) continue;
      const fl = smooth(hw - 0.22, hw - 0.07, Math.abs(z)); // a dent is in the flank: it dies out over the shoulder, onto bonnet, roof and deck
      const f = (1 - q * q) * (1 - q * q) * fl;
      z -= s * d.d * f;
      if (d.top) y -= d.d * 0.5 * f;
      // paint cracks where the sheet folded: the rim of the dent and its deepest point
      m = Math.max(m, fl * clamp01((d.d / d.r - 0.06) * 5) * Math.max(Math.exp(-(((q - 0.78) / 0.16) ** 2)), 0.6 * Math.exp(-((q / 0.22) ** 2))));
    }
    if (post) {
      // the notch: everything across the post's width is driven back clear of it, the metal either
      // side dragged after it, less the further back along the car
      const ax = post.fr * x, dz = z - post.z, az = Math.abs(dz);
      const reach = smooth(h - 1.3, h - 0.12, ax);
      if (reach > 0 && az < post.r + 0.75) {
        const hard = az < post.r ? Math.max(0, front - (post.x - Math.sqrt(post.r * post.r - dz * dz)) + 0.015) : 0;
        const full = Math.max(0, front - (post.x - post.r) + 0.015);
        const soft = 0.3 * full * (1 - smooth(post.r * 0.6, post.r + 0.75, az));
        const push = Math.max(hard, soft) * reach;
        x -= post.fr * push;
        if (y > t.hoodF - 0.12) y += 0.07 * reach * Math.min(1, push / 0.15) * (0.4 + 0.6 * Math.sin(x * 9 + z * 6 + ph[0]) ** 2); // the bonnet's edge rides up
        z += 0.04 * reach * Math.min(1, push / 0.15) * Math.sign(dz) * smooth(post.r * 0.5, post.r + 0.3, az) * (1 - smooth(post.r + 0.3, post.r + 0.75, az)); // and the wing bows out
        // (paint lets go where the metal folded: the nose itself and the lip of the bonnet, not the bonnet's top)
        m = Math.max(m, smooth(0.03, 0.14, push) * (1 - smooth(post.r * 0.9, post.r + 0.22, az)) * smooth(h - 0.3, h - 0.1, ax) * (0.45 + 0.55 * Math.sin(y * 31 + z * 23 + ph[1]) ** 2));
      }
    }
    if (crush > 0) {
      // the press: everything above the belt comes down to it, the body folds and spreads
      const yb = t.sill + 0.5;
      const w = 0.5 + 0.5 * Math.sin(x * 2.3 + ph[0]) * Math.sin(z * 3.1 + ph[1]);
      if (y > yb) y = yb + (y - yb) * (1 - crush * (0.62 + 0.25 * w));
      z *= 1 + crush * 0.05 * Math.sin(y * 9 + x * 4 + ph[2]);
      y += crush * 0.035 * Math.sin(x * 5.7 + z * 4.3 + ph[1]);
      m = Math.max(m, crush * (0.35 + 0.5 * w));
    }
    out[0] = x; out[1] = y; out[2] = z;
    return m;
  };
}

function applyDamage(grid, field) {
  const { nx, ny, P, NP } = grid;
  const dmg = new Float32Array(nx * ny), out = [0, 0, 0];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const k = (i * ny + j) * 3;
    dmg[i * ny + j] = field(out, P[k], P[k + 1], P[k + 2], j < NP ? 1 : -1);
    P[k] = out[0]; P[k + 1] = out[1]; P[k + 2] = out[2];
  }
  grid.dmg = dmg;
}

// ---- the car -----------------------------------------------------------------------------------------
// Options (the originals, all kept): type, paint (a CAR_PAINT key or a hex colour), plate, doorAjar
// (radians, driver's door), dome, head 0..1, tail, hazard, flat 'fl'|'fr'|'rl'|'rr', lightbar,
// shield, fuelOpen (side), rim, story, far, loft, colour (index, far traffic), doorOpen (far).
// New: damage 0..1, rust 0..1, dirt 0..1, brokenGlass ['ws','rw','fl','fr','rl','rr'], crushed 0..1,
// crumple 'fl'|'fr'|'rl'|'rr' (that corner stoved in), steel (pressed-steel wheels), searched.
function carMeshes(t, o, lod) {
  if (t.look) t = { ...t, ...t.look };
  const near = lod === NEAR, far = lod === FAR;
  const h = t.L / 2, hw = t.W / 2;
  const fx = h - t.fo, rx = fx - t.wb;
  const dirt = o.dirt ?? 0.45, rust = o.rust ?? 0.25;
  const fxDef = [dirt, rust * 0.3, 0, 0];
  const body = new VBuf(fxDef), glass = new VBuf([0, 0, 0, 0]), lit = new VBuf([0, 0, 0, 0]);
  const paint = o.paintRgb;
  const S_PAINT = st(paint, 0);
  const crushed = o.crushed || 0;
  const broken = new Set(crushed > 0.25 ? ['ws', 'rw', 'fl', 'fr', 'rl', 'rr', 'ql', 'qr'] : o.brokenGlass || []);
  const hasBoot = !t.bed && t.rearBaseX > -h + 0.45;
  const gate = !t.bed && !hasBoot;
  const doors4 = !t.bed;

  const yb = t.belt + 0.035, yt = t.roofY - 0.075;
  const bx = (frontAt(t, yt) + rearAt(t, yt)) / 2 + (t.bed ? 0 : 0.12);
  const dA = t.cowlX + 0.03, dB = bx, dC = t.bed ? t.rearBaseX + 0.12 : rearAt(t, yb) + 0.25;
  const xNose = h - 0.11, xTail = -h + 0.1, xH = t.cowlX + 0.11, xBoot0 = t.rearBaseX - 0.05;
  const fuelS = o.fuelOpen || 1, fxc = Math.max(rx - 0.45, -h + 0.3);
  const keys = [dA, dB, dB + 0.05, dB - 0.05, dC, dC + 0.05, xNose, xTail, xH, t.cowlX, t.cowlX - 0.02, t.roofF + 0.05, t.roofR - 0.05, t.rearBaseX + 0.04, t.rearBaseX + 0.02, fxc - 0.085, fxc + 0.085];
  if (hasBoot) keys.push(xBoot0);
  if (t.bed) keys.push(t.rearBaseX - 0.035, t.rearBaseX - 0.005, -h + 0.065, -h + 0.05);
  const grid = bodyGrid(t, lod, far ? [] : keys);
  const { nx, ny, xs, NP, S, Q, iLow, iA, iU, iB } = grid;
  const field = far ? null : damageField(t, o);
  if (field) applyDamage(grid, field);
  const _wo = [0, 0, 0];
  const warp = field ? (v) => { field(_wo, v.x, v.y, v.z, v.z >= 0 ? 1 : -1); v.set(_wo[0], _wo[1], _wo[2]); } : null;
  const raL = t.wr + ARCH_GAP;
  const yF = t.sill + (t.steelBump ? 0.18 : 0.15), yR = t.sill + (t.steelBump ? 0.2 : 0.17); // bumper heights
  // where a broken windscreen was hit: across the car, and up the glass from the scuttle
  const webRng = createRng(o.seed).fork('web');
  const webZ = webRng.range(-0.35, -0.15), webU = webRng.range(0.3, 0.5);
  // normals face out: the right-hand flank's point +z
  gridNormals(grid, 1);
  { const k = ((nx >> 1) * ny + 3) * 3; if (grid.N[k + 2] < 0) gridNormals(grid, -1); }

  const lean = o.flat ? M(0, -0.03, 0, o.flat[1] === 'r' ? 0.04 : -0.04, 0, o.flat[0] === 'f' ? -0.022 : 0.022) : new Matrix4();
  const rowInfo = (jj) => {
    const side = jj < NP - 1 ? 1 : -1, r = side > 0 ? jj : 2 * NP - 3 - jj;
    if (r < iLow) return [side, 'L', r];
    if (r < iA) return [side, 'A', r - iLow];
    if (r < iU) return [side, 'U', r - iA];
    if (r < iB) return [side, 'B', r - iU];
    return [side, 'T', r - iB];
  };
  const xm = (i) => (xs[i] + xs[i + 1]) / 2;
  const um = (i) => (grid.U[i] + grid.U[i + 1]) / 2;
  const NU = Q.NU;
  const gapW = near ? 0.0032 : 0, skirtD = near ? 0.014 : 0;
  // per-vertex style of a painted panel: its colour, the car's dirt, rust where rust starts
  const stB = Array.from(xs, (x) => S.at(x)[0]);
  const rustAt = (i, j, bnd) => {
    const [, zone, r] = rowInfo(Math.min(j, ny - 2));
    let m = 0.3;
    if (zone === 'L') {
      const b = stB[i];
      if (r <= 2 && b > t.sill + 0.05) m += 0.6; // arch lips
      else if (r <= 1) m += 0.35; // sills
      else if (r <= 4) m += 0.12;
    }
    if (bnd) m += 0.16;
    return Math.min(1, rust * m * 1.6);
  };
  const tone = (id) => {
    // a cruiser is two-tone: doors and roof in the body colour, the rest near-black
    if (o.lightbar && !/^(door|roof|frame)/.test(id)) return [0.012, 0.013, 0.017];
    const k = 0.94 + 0.12 * ((hashStr(id + o.seed) % 100) / 100);
    return [paint[0] * k, paint[1] * k, paint[2] * k];
  };
  const panels = new Map();
  const painted = (id, extra = {}) => {
    let p = panels.get(id);
    if (!p) {
      const col = tone(id);
      p = { id, buf: body, gap: gapW, skirt: skirtD, lines: lod === MID, ...extra,
        vert: (i, j, bnd) => ({ color: col, a: [0, 0, 0, 0], b: [dirt, rustAt(i, j, bnd), grid.dmg ? grid.dmg[i * ny + j] : 0, 0] }) };
      panels.set(id, p);
    }
    return p;
  };
  const plain = (id, style, extra = {}) => {
    let p = panels.get(id);
    if (!p) { p = { id, buf: body, st: style, gap: gapW, skirt: skirtD, ...extra }; panels.set(id, p); }
    return p;
  };
  const GLASS_TINT = [0.018, 0.028, 0.025];
  // a broken windscreen is crazed milky round where it was hit
  const hazeAt = (x, y, z) => (broken.has('ws') ? 0.4 * Math.exp(-((z - webZ) ** 2 + (Math.hypot(x - t.cowlX, y - t.hoodR) - webU) ** 2) / 0.045) : 0);
  const pane = (id, extra = {}) => {
    if (broken.has(id) && id !== 'ws') return null;
    let p = panels.get(id);
    if (!p) {
      const inset = near ? 0.009 : 0.005;
      if (far) p = { id, buf: body, st: st(o.dome ? [0.05, 0.035, 0.02] : [0.004, 0.005, 0.006], 4, o.dome ? 0.9 * o.dome : 0), inset: 0.004, ...extra };
      else if (id === 'ws') {
        p = { id, buf: glass, inset, ...extra,
          vert: (i, j) => { const k = (i * ny + j) * 3; const hz = hazeAt(grid.P[k], grid.P[k + 1], grid.P[k + 2]); return { color: GLASS_TINT, a: [0.5 + hz * 0.5, 1.7 + 2 * hz, grid.P[k + 2], Math.hypot(grid.P[k] - t.cowlX, grid.P[k + 1] - t.hoodR) - 0.02], b: broken.has('ws') ? [webZ, webU - 0.02, 1, 0] : [0, 0, 0, 0] }; } };
      } else p = { id, buf: glass, inset, st: { color: GLASS_TINT, a: [id === 'rw' ? 0.52 : 0.5, id === 'rw' ? 0.45 : 0.6, -99, 0] }, ...extra };
      panels.set(id, p);
    }
    return p;
  };
  const ajar = !far && o.doorAjar ? 'ajar' : null;
  const cabinX = (x) => x < t.cowlX - 0.02 && x > t.rearBaseX + 0.02;
  const cell = (i, jj) => {
    const [side, zone, sub] = rowInfo(jj);
    const x = xm(i);
    const sd = side > 0 ? 'R' : 'L';
    const lidR = !far ? 'lid' : undefined;
    if (zone === 'T') {
      if (grid.bedZone(x)) return sub === 0 ? painted(`side${sd}`) : plain('bed', st([0.02, 0.02, 0.022], 1), { gap: 0, skirt: 0 });
      if (x > xNose) return painted('nose');
      if (x > xH) return painted('bonnet');
      if (x > t.cowlX) return plain('cowl', S_TRIM);
      if (x > t.roofF + 0.05) return sub >= 1 ? pane('ws') : painted(`side${sd}`);
      if (x > t.roofR - 0.05) return sub >= 1 ? painted('roof') : painted(`side${sd}`);
      if (x > t.rearBaseX + 0.04 && !t.bed) {
        if (gate) return sub >= 1 ? pane('rw', { range: lidR }) : painted('gate', { range: lidR });
        return sub >= 1 ? pane('rw') : painted(`side${sd}`);
      }
      if (t.bed && x > t.rearBaseX - 0.03) return sub >= 1 ? pane('rw') : painted(`side${sd}`);
      if (hasBoot) return x > xBoot0 ? painted('deck') : x > xTail ? painted('boot', { range: lidR }) : painted('tail');
      if (gate) return x > xTail ? painted('gate', { range: lidR }) : painted('tail');
      return painted('tail');
    }
    if (zone === 'B') return x > t.cowlX - 0.02 ? painted(`wingF${sd}`) : painted(`side${sd}`);
    const isAjar = ajar && side < 0;
    const doorF = () => painted(`doorF${sd}`, isAjar ? { range: 'ajar', skirt: near ? 0.05 : 0, skirtEdge: true, skirtColor: TRIM } : {});
    if (zone === 'U') {
      if (!cabinX(x)) return x > t.cowlX - 0.02 ? painted(`wingF${sd}`) : painted(`side${sd}`);
      const hgt = um(i);
      if (x > dA) return painted(`side${sd}`);
      if (x > dB) {
        const frame = sub === NU - 1 || x < dB + 0.05 || hgt < 0.09;
        if (!frame) return pane(side > 0 ? 'fr' : 'fl', isAjar ? { range: 'ajar' } : {});
        return hgt < 0.09 ? doorF() : plain(`frameF${sd}`, S_BLACK, isAjar ? { range: 'ajar' } : {});
      }
      if (x > dC) {
        const frame = sub === NU - 1 || x > dB - 0.05 || x < dC + 0.05;
        if (!frame) return pane(side > 0 ? (doors4 ? 'rr' : 'qr') : (doors4 ? 'rl' : 'ql'));
        return doors4 ? plain(`frameR${sd}`, S_BLACK) : painted(`side${sd}`);
      }
      if (t.rack && sub < NU - 1 && x < dC - 0.07 && x > rearAt(t, t.belt + (sub + 1) * (t.roofY - t.belt) / NU) + 0.16) return pane(side > 0 ? 'qr' : 'ql');
      return painted(`side${sd}`);
    }
    // lower flank (and the shoulder roll above it)
    if (zone === 'L' && sub < 1 && x > rx + t.wr + 0.08 && x < fx - t.wr - 0.08) return plain(`sill${sd}`, S_TRIM);
    if (x > xNose) return painted('nose');
    if (x > dA) return painted(`wingF${sd}`);
    if (x > dB) return doorF();
    if (x > dC) return doors4 ? painted(`doorR${sd}`) : painted(`side${sd}`);
    if (x > xTail) {
      if (near && side === fuelS && Math.abs(x - fxc) < 0.085 && zone === 'L') {
        const y = grid.P[(i * ny + jj) * 3 + 1];
        if (y > t.belt - 0.3 && y < t.belt - 0.12) return painted('fuel');
      }
      return painted(`side${sd}`);
    }
    return painted('tail');
  };

  body.at(lean, () => glass.at(lean, () => lit.at(lean, () => {
    panelize(grid, cell);
    // nose and tail faces
    for (const [i, sign] of [[0, -1], [nx - 1, 1]]) {
      let cy = 0;
      for (let j = 0; j < ny; j++) cy += grid.P[(i * ny + j) * 3 + 1] / ny;
      const fxv = [dirt, rust * 0.5, grid.dmg ? 0.2 * (o.damage || 0) : 0, 0];
      const c0 = body.vert(grid.P[(i * ny + NP - 1) * 3], cy, 0, sign, 0, 0, paint, [0, 0, 0, 0], fxv);
      const ring = [];
      for (let j = 0; j < ny; j++) { const k = (i * ny + j) * 3; ring.push(body.vert(grid.P[k], grid.P[k + 1], grid.P[k + 2], sign, 0, 0, paint, [0, 0, 0, 0], fxv)); }
      // (the ring runs from the right sill over the top to the left one: clockwise seen from ahead)
      for (let j = 0; j < ny; j++) { const a = ring[j], b = ring[(j + 1) % ny]; if (sign > 0) body.tri(c0, b, a); else body.tri(c0, a, b); }
    }

    // the underside, sill to sill: painted where it turns up into the nose and tail, black between
    for (let i = 0; i < nx - 1; i++) {
      const end = Math.abs(xm(i)) > h - 0.3;
      const col = end ? paint : [0.012, 0.012, 0.013], a = [end ? 0 : 1, 0, 0, 0];
      const k0 = (i * ny) * 3, k1 = (i * ny + ny - 1) * 3, k2 = ((i + 1) * ny + ny - 1) * 3, k3 = ((i + 1) * ny) * 3;
      // (where it turns up it is the lower panel of the nose or tail: it faces the way it lies)
      const P = grid.P;
      let n0 = 0, n1 = -1;
      if (end) { const ex = P[k3] - P[k0], ey = P[k3 + 1] - P[k0 + 1], l = Math.hypot(ex, ey) || 1; n0 = ey / l; n1 = -ex / l; }
      const vv = (k) => body.vert(P[k], P[k + 1], P[k + 2], n0, n1, 0, col, a);
      const v0 = vv(k0), v1 = vv(k1), v2 = vv(k2), v3 = vv(k3);
      body.quad(v0, v1, v2, v3);
    }

    // ---- inner lining: the same cells seen from inside, so the cabin has walls and a headlining
    if (!far && crushed < 0.25) {
      const LINER = st([0.045, 0.045, 0.048], 3), HEAD = st([0.16, 0.155, 0.145], 3), CARD = st([0.07, 0.068, 0.066], 3);
      const lin = { id: 'liner', buf: body, st: LINER, inset: near ? 0.03 : 0.014, flip: true };
      const head = { id: 'head', buf: body, st: HEAD, inset: near ? 0.03 : 0.014, flip: true };
      const card = { id: 'card', buf: body, st: CARD, inset: 0.05, flip: true, range: 'ajar' };
      const gcard = { id: 'gcard', buf: body, st: CARD, inset: near ? 0.04 : 0.014, flip: true, range: 'lid' };
      const bcard = { id: 'bcard', buf: body, st: st([paint[0] * 0.5, paint[1] * 0.5, paint[2] * 0.5], 0), inset: 0.014, flip: true, range: 'lid' };
      panelize(grid, (i, jj) => {
        const zone = rowInfo(jj)[1];
        const x = xm(i);
        const c = cell(i, jj);
        if (!c || c.buf === glass || (c.id === 'ws' || c.id === 'rw')) return null;
        if (c.range === 'ajar') return zone === 'U' || !near ? null : card;
        if (c.range === 'lid') return gate ? gcard : bcard; // (at every level: an open lid seen from behind is its inner face)
        if (x > t.cowlX + 0.02 || x < (gate ? -h + 0.12 : t.rearBaseX - 0.02)) return null;
        if (zone === 'L' || zone === 'A') return null; // below the glass the doors' inner panels are flat cards (below)
        if (zone === 'T' || zone === 'B') return x < t.roofF + 0.05 && x > t.roofR - 0.05 ? head : (zone === 'B' ? lin : null);
        return lin;
      });
      // inner panels of the flanks, belt to sill; where the body draws in to the tail they follow it
      if (near) for (const s of [1, -1]) {
        const xr = gate ? -h + 0.14 : t.rearBaseX, x0 = Math.max(xr, -h + 0.72), x1 = s < 0 && ajar ? dB : t.cowlX;
        const cy = (t.belt + t.sill) / 2 + 0.05, ch = t.belt - t.sill - 0.06, z0 = S.half(x0) - 0.075;
        body.add(box(x1 - x0, ch, 0.02), CARD, M((x0 + x1) / 2, cy, s * z0));
        if (xr < x0 - 0.05) {
          const zr = S.half(xr) - 0.085, len = Math.hypot(x0 - xr, z0 - zr);
          body.add(box(len, ch, 0.02), CARD, M((x0 + xr) / 2, cy, s * (z0 + zr) / 2, 0, -s * Math.atan2(z0 - zr, x0 - xr), 0));
        }
      }
    }
    body.warp = warp; glass.warp = warp; lit.warp = warp; // from here on, parts hung on the skin: they go where it went

    const noseHW = S.half(h - 0.02), tailHW = S.half(-h + 0.02);
    const lampY = t.hoodF - 0.15;
    const TAILC = [0.075, 0.0015, 0.0015], AMBERC = [0.34, 0.085, 0.004], WHITEC = [0.2, 0.2, 0.19];
    const LENS = (c) => st(c, 8);
    const headOn = (s) => !!o.head && (s > 0 || o.head > 0.5);
    const LW = t.lampW, LH = t.lampH;
    const lampZ = noseHW - 0.105 - LW / 2; // centre of a headlamp unit
    const gH = lampZ - LW / 2 - 0.022; // half the width of the grille between them
    // where the tail's skin is at height y on the centre line, and how far along the car its plan
    // outline still reaches out to z (the corner coming round)
    const tailX = (y) => {
      let x = 0;
      for (let i = 0; i < S.poly.length; i++) {
        const a = S.poly[i], b = S.poly[(i + 1) % S.poly.length];
        if ((a[1] - y) * (b[1] - y) > 0 || Math.abs(b[1] - a[1]) < 1e-9) continue;
        x = Math.min(x, a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
      }
      return x;
    };
    const endX = (z) => { let lo = h - 0.5, hi = h; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (S.half(mid) > z) lo = mid; else hi = mid; } return lo; };

    if (far) {
      // far level: lamps as lit or dull lenses, bumpers, a dark underside, wheels as drums with a hub
      for (const s of [1, -1]) {
        const on = headOn(s);
        (on ? lit : body).add(box(0.05, LH, LW), on ? st(rgb(0xfff0d0, 90 * o.head), 0) : LENS([0.4, 0.42, 0.44]), M(h, lampY, s * lampZ));
        (o.tail ? lit : body).add(box(0.06, 0.15, 0.36), o.tail ? st([2.6, 0.05, 0.02], 0) : LENS(TAILC), M(-h + 0.02, t.tailY - 0.13, s * (tailHW - 0.24)));
      }
      body.add(box(0.04, 0.19, gH * 2), S_BLACK, M(h - 0.012, lampY, 0));
      for (const [e, y] of [[1, yF], [-1, yR]]) body.add(box(0.12, 0.15, t.W - 0.1), t.steelBump ? st([0.5, 0.52, 0.55], 2) : S_TRIM, M(e * (h - 0.01), y, 0));
      body.add(boxUp(t.L - 0.5, t.wr + 0.1, t.W - 0.5), S_BLACK, M(0, t.sill - 0.04, 0));
      for (const x of [fx, rx]) for (const s of [1, -1]) {
        body.add(cyl(t.wr, t.wr, 0.22, 12).rotateX(Math.PI / 2), st([0.007, 0.007, 0.008], 7), M(x, t.wr, s * (hw - 0.1)));
        body.add(cyl(t.wr * 0.58, t.wr * 0.58, 0.02, 8).rotateX(Math.PI / 2), st([0.3, 0.31, 0.33], 2), M(x, t.wr, s * (hw + 0.012)));
      }
      if (o.doorOpen) {
        const s = o.doorOpen, dh = t.belt - t.sill - 0.06;
        body.add(box(1.0, dh, 0.05).translate(-0.5, t.sill + 0.08 + dh / 2, 0), S_PAINT, M(dA, 0, s * hw, 0, s * 1.15, 0));
        body.add(box(0.98, dh, 0.02), S_BLACK, M(dA - 0.5, t.sill + 0.08 + dh / 2, s * (hw + 0.035)));
      }
      return;
    }

    // ---- lamps
    for (const s of [1, -1]) {
      const zc = s * lampZ, on = headOn(s);
      const smashed = !!o.crumple && o.crumple[0] === 'f' && (o.crumple[1] === 'r' ? 1 : -1) === s;
      const zi = s * (noseHW - 0.05), ri = s * -0.55; // the indicator, turned round the corner
      if (near) {
        // a headlamp: a chromed reflector bowl, the bulb in its holder behind a shield, a clear lens
        // fluted on its face, a bright surround; the twin-lamp noses carry two to a side
        const x0 = h + 0.05, round = t.lamp === 'round', pw = round ? 2 : 5;
        const cells = t.lamp === 'quad' ? [[-LW / 4, LW / 2 - 0.008], [LW / 4, LW / 2 - 0.008]] : [[0, LW]];
        for (const [dz, w] of cells) {
          const z = zc + dz;
          body.add(bowl(w / 2 - 0.004, LH / 2 - 0.004, 0.038, 4, 20, pw), st(smashed ? [0.1, 0.1, 0.1] : [0.9, 0.91, 0.93], 2), M(x0, lampY, z));
          body.add(cyl(0.012, 0.012, 0.022, 8).rotateZ(Math.PI / 2), st([0.5, 0.5, 0.48], 2), M(x0 - 0.026, lampY, z));
          body.add(sphere(0.012, 8, 4), S_CHROME, M(x0 - 0.012, lampY, z));
          if (on) {
            lit.add(bowl(w / 2 - 0.01, LH / 2 - 0.01, 0.034, 3, 12, pw), st(rgb(0xfff0d0, 20 * o.head), 0), M(x0 + 0.0008, lampY, z));
            lit.add(sphere(0.024, 8, 5), st(rgb(0xfff0d0, 300 * o.head), 0), M(x0 - 0.012, lampY, z));
          }
          if (!smashed) glass.add(lensPlate(w, LH, round ? 8 : Math.max(5, Math.round(w / 0.024)), 'z', 0.007, 0.003, pw), { color: [0.03, 0.035, 0.035], a: [0.2, 0.22, -99, 0] }, M(x0 + 0.004, lampY, z));
          if (round) body.add(torus(w / 2 + 0.002, 0.007, 5, 18), S_CHROME, M(x0 + 0.002, lampY, z, 0, Math.PI / 2, 0));
        }
        if (!round) {
          for (const dy of [-1, 1]) body.add(box(0.034, 0.007, LW + 0.014), S_CHROME, M(x0 - 0.01, lampY + dy * (LH / 2 + 0.0035), zc));
          for (const dz of t.lamp === 'quad' ? [-1, 0, 1] : [-1, 1]) body.add(box(0.034, LH, 0.007), S_CHROME, M(x0 - 0.01, lampY, zc + dz * (LW / 2 + 0.0035)));
        }
        // indicator wrapping the corner: an amber lens over a bright back
        body.add(box(0.05, LH - 0.01, 0.08), st([0.75, 0.6, 0.35], 2), M(h - 0.008, lampY, zi, 0, ri, 0));
        if (o.hazard) lit.add(box(0.004, LH - 0.03, 0.07), st(rgb(0xff8a12, 10), 0, 0, 1), M(h + 0.0185, lampY, zi, 0, ri, 0));
        glass.add(lensPlate(0.088, LH - 0.006, 5, 'y', 0.005, 0.0012, 6), { color: AMBERC, a: [o.hazard ? 0.45 : 0.86, 0.1, -99, 0] }, M(h + 0.021, lampY, zi + s * 0.004, 0, ri, 0));
      } else {
        (on ? lit : body).add(box(0.03, LH - 0.012, LW - 0.012), on ? st(rgb(0xfff0d0, 160 * o.head), 0) : LENS(smashed ? [0.04, 0.04, 0.04] : [0.42, 0.44, 0.46]), M(h + 0.04, lampY, zc));
        body.add(box(0.05, LH, 0.095), LENS(AMBERC), M(h + 0.006, lampY, zi, 0, ri, 0));
        if (o.hazard) lit.add(box(0.03, LH - 0.02, 0.09), st(rgb(0xff8a12, 14), 0, 0, 1), M(h + 0.022, lampY, zi, 0, ri, 0));
      }
      // tail cluster: one lamp unit let into the rear panel and leaning with it: a bright back, over
      // it one lens in three colours (stop and tail, indicator, reversing), a gasket, a thin bright
      // surround. Wide across the tail of a saloon, wrapped to the corner of a hatch, upright at the
      // corners of what has a tailgate.
      {
        const tall = t.tailLamp === 'tall', wrap = t.tailLamp === 'wrap';
        const W = tall ? 0.13 : wrap ? 0.34 : 0.42, H = tall ? 0.34 : wrap ? 0.125 : 0.14;
        const yc = tall ? t.tailY - 0.035 - H / 2 : t.tailY - 0.13;
        const zt = s * (tailHW - (tall ? 0.11 : wrap ? 0.235 : 0.29));
        const xa = tailX(yc - H / 2), xb = tailX(yc + H / 2);
        // turned as far as the corner has come round by the unit's outer edge, and no further
        const round = h - endX(Math.abs(zt) + W / 2 - 0.005), ry = s * Math.atan2(round, W);
        const m = M((xa + xb) / 2 + round / 2, yc, zt, 0, Math.PI + ry, Math.atan2(xb - xa, H));
        const at = (lm) => new Matrix4().multiplyMatrices(m, lm);
        // which lamp a point of the unit is: 0 stop and tail, 1 indicator, 2 reversing (outermost or topmost first)
        const part = (y, z) => { const f = tall ? 0.5 - y / H : 0.5 + (s * z) / W; return f < 0.56 ? 0 : f < 0.8 ? 1 : 2; };
        const cols = [TAILC, AMBERC, WHITEC];
        const where = (f0, f1, x) => { const fc = (f0 + f1) / 2 - 0.5; return tall ? M(x, -fc * H, 0) : M(x, 0, s * fc * W); };
        if (near) {
          body.add(box(0.026, H + 0.016, W + 0.016), S_BLACK, at(M(-0.003, 0, 0)));
          body.add(box(0.004, H - 0.01, W - 0.01), st([0.85, 0.85, 0.85], 2), at(M(0.0115, 0, 0)));
          for (const dy of [-1, 1]) body.add(box(0.008, 0.005, W + 0.014), S_CHROME, at(M(0.014, dy * (H / 2 + 0.0035), 0)));
          for (const dz of [-1, 1]) body.add(box(0.008, H + 0.004, 0.005), S_CHROME, at(M(0.014, 0, dz * (W / 2 + 0.0035))));
          const g = lensPlate(W, H, tall ? 11 : Math.round(W / 0.03), tall ? 'y' : 'z', 0.009, 0.0015, 7);
          const p = g.getAttribute('position'), which = [];
          for (let k = 0; k < p.count; k++) which.push(part(p.getY(k), p.getZ(k)));
          const b0 = glass.n;
          glass.add(g, { color: TAILC, a: [0.92, 0.07, -99, 0] }, at(M(0.016, 0, 0)));
          for (let k = 0; k < which.length; k++) {
            const c = cols[which[k]], q = (b0 + k) * 3;
            glass.col[q] = c[0]; glass.col[q + 1] = c[1]; glass.col[q + 2] = c[2];
            if ((which[k] === 0 && o.tail) || (which[k] === 1 && o.hazard)) glass.a[(b0 + k) * 4] = 0.3;
          }
        } else {
          body.add(box(0.016, H + 0.014, W + 0.014), S_BLACK, at(M(0, 0, 0)));
          for (const [f0, f1, c] of [[0, 0.56, TAILC], [0.56, 0.8, AMBERC], [0.8, 1, WHITEC]]) body.add(tall ? box(0.02, (f1 - f0) * H, W) : box(0.02, H, (f1 - f0) * W), LENS(c), at(where(f0, f1, 0.008)));
        }
        // what is lit: the tail lamp; the indicator, with the hazards
        const glow = (f0, f1, rad, blink) => {
          const ext = f1 - f0, gw = tall ? W - 0.012 : ext * W - 0.008, gh = tall ? ext * H - 0.008 : H - 0.012;
          if (!near) { lit.add(box(0.012, gh, gw), st(rad, 0, 0, blink ? 1 : 0), at(where(f0, f1, 0.02))); return; }
          const g = lensPlate(gw, gh, 5, tall ? 'y' : 'z', 0.001, 0.0006);
          const p = g.getAttribute('position'), base = lit.n, fall = [];
          for (let k = 0; k < p.count; k++) { const q = Math.hypot(p.getY(k) / (gh * 0.5), p.getZ(k) / (gw * 0.5)); fall.push(0.3 + 2.0 * Math.exp(-q * q * 2.0)); }
          lit.add(g, st(rad, 0, 0, blink ? 1 : 0), at(where(f0, f1, 0.0146)));
          for (let k = 0; k < fall.length; k++) { lit.col[(base + k) * 3] *= fall[k]; lit.col[(base + k) * 3 + 1] *= fall[k]; lit.col[(base + k) * 3 + 2] *= fall[k]; }
        };
        if (o.tail) glow(0, 0.56, [2.4, 0.045, 0.018], false);
        if (o.hazard) glow(0.56, 0.8, rgb(0xff8a12, 9), true);
      }
    }

    // ---- bumpers: a section swept round each end from wheel arch to wheel arch, a valance under it
    const steelBump = !!t.steelBump;
    const BUMP = steelBump ? st([0.55, 0.57, 0.6], 2) : st([0.02, 0.021, 0.023], 1);
    const bumpH = steelBump ? 0.085 : 0.075;
    const bsec = !near ? [[-0.03, bumpH], [0.046, bumpH - 0.016], [0.046, 0.016 - bumpH], [-0.03, -bumpH]]
      : steelBump ? [[-0.03, 0.085], [0.028, 0.085], [0.05, 0.062], [0.05, 0.012], [0.034, -0.004], [0.034, -0.06], [0.016, -0.085], [-0.03, -0.085]]
        : [[-0.03, 0.075], [0.02, 0.075], [0.044, 0.052], [0.05, 0], [0.044, -0.046], [0.02, -0.075], [-0.03, -0.075]];
    for (const end of [1, -1]) {
      const xa = end > 0 ? fx + raL + 0.04 : rx - raL - 0.04, y = end > 0 ? yF : yR;
      const path = endPath(S, end, xa, 0.012), cxp = end * (h - 0.8);
      body.add(sweep(path, bsec, cxp, 0).translate(0, y, 0), BUMP);
      if (near && !steelBump) body.add(sweep(path, [[0.047, 0.013], [0.057, 0.013], [0.057, -0.013], [0.047, -0.013]], cxp, 0).translate(0, y + 0.004, 0), S_CHROME);
      const vd = Math.max(0.05, y - bumpH - (t.sill - 0.03));
      body.add(sweep(path, [[-0.03, 0], [0.0, 0], [-0.012, -vd], [-0.03, -vd]], cxp, 0).translate(0, y - bumpH + 0.004, 0), st([0.016, 0.017, 0.018], 1));
    }
    if (near && steelBump) for (const z of [-0.34, 0.34]) body.add(box(0.03, 0.15, 0.06), st([0.012, 0.012, 0.013], 1), M(h + 0.066, yF, z)); // over-riders

    // ---- nose: the band the lamps and the grille stand in, a painted lip over it, the grille by type
    const drop = t.faceDrop || 0; // how far the band and the grille reach below the lamps' own band
    body.add(box(0.05, 0.21 + drop, noseHW * 2 - 0.2), S_BLACK, M(h - 0.02, lampY - drop / 2, 0));
    body.add(box(0.036, 0.009, (lampZ + LW / 2) * 2 + 0.03), S_PAINT, M(h + 0.004, lampY + 0.1095, 0));
    if (near) {
      body.add(box(0.07, 0.006, noseHW * 2 - 0.16), S_CHROME, M(h + 0.022, lampY - 0.108 - drop, 0));
      const GR = st([0.2, 0.21, 0.22], 2), gx = h + 0.03;
      const surround = (tk, style) => {
        for (const dy of [-1, 1]) body.add(box(0.03, tk, gH * 2 + tk), style, M(h + 0.042, lampY - drop / 2 + dy * (0.1 + drop / 2 - tk / 2), 0));
        for (const dz of [-1, 1]) body.add(box(0.03, 0.2 + drop, tk), style, M(h + 0.042, lampY - drop / 2, dz * gH));
      };
      if (t.grille === 'slats') {
        for (let k = 0; k < 6; k++) body.add(box(0.034, 0.007, gH * 2 - 0.02), GR, M(gx, lampY - 0.07 + 0.028 * k, 0, 0, 0, 0.4));
        surround(0.01, S_CHROME);
        body.add(box(0.016, 0.045, 0.085), S_CHROME, M(h + 0.052, lampY, 0)); // the maker's badge
      } else if (t.grille === 'crate') {
        const nh = 3 + Math.round(drop / 0.05);
        for (let k = 0; k < nh; k++) body.add(box(0.03, 0.012, gH * 2 - 0.02), S_CHROME, M(gx + 0.008, lampY + 0.05 - 0.05 * k, 0));
        const nv = Math.round((gH * 2) / 0.07);
        for (let k = 1; k < nv; k++) body.add(box(0.02, 0.185 + drop, 0.006), GR, M(gx, lampY - drop / 2, -gH + (gH * 2 * k) / nv));
        surround(0.02, S_CHROME);
        if (drop) {
          // the bar across the middle in the body's colour with the maker's letters' plate on it, and
          // under each headlamp an oblong parking lamp in a bright frame
          body.add(box(0.04, 0.05, gH * 2 - 0.02), S_PAINT, M(gx + 0.012, lampY - drop / 2 - 0.02, 0));
          body.add(box(0.012, 0.03, 0.3), S_CHROME, M(gx + 0.034, lampY - drop / 2 - 0.02, 0));
          for (const s of [1, -1]) {
            const yp = lampY - 0.105 - drop / 2;
            body.add(box(0.03, drop - 0.05, LW + 0.03), S_CHROME, M(h + 0.02, yp, s * lampZ));
            body.add(box(0.03, drop - 0.075, LW + 0.004), st([0.75, 0.6, 0.35], 2), M(h + 0.026, yp, s * lampZ));
            glass.add(lensPlate(LW, drop - 0.08, 6, 'y', 0.004, 0.0012, 6), { color: AMBERC, a: [0.86, 0.1, -99, 0] }, M(h + 0.043, yp, s * lampZ));
          }
        }
      } else if (t.grille === 'bars') {
        const nb = 7, pitch = (gH * 2) / nb;
        for (let k = 0; k < nb; k++) body.add(box(0.05, 0.19, pitch * 0.62), S_PAINT, M(gx + 0.002, lampY, -gH + pitch * (k + 0.5)));
        surround(0.012, S_PAINT);
      } else {
        // a slot under a painted panel, the badge on the panel
        body.add(box(0.026, 0.125, gH * 2 + 0.02), S_PAINT, M(h + 0.018, lampY + 0.04, 0));
        for (let k = 0; k < 2; k++) body.add(box(0.03, 0.007, gH * 2 - 0.02), GR, M(gx - 0.004, lampY - 0.078 + 0.028 * k, 0, 0, 0, 0.4));
        body.add(cyl(0.032, 0.032, 0.012, 12).rotateZ(Math.PI / 2), S_CHROME, M(h + 0.034, lampY + 0.045, 0));
      }
      // a tall nose has an intake between the bumper and the band
      if (steelBump && !drop) body.add(box(0.03, 0.075, noseHW * 2 - 0.7), st([0.008, 0.008, 0.009], 1), M(h - 0.004, (lampY - 0.105 + yF + bumpH) / 2, 0));
    } else body.add(box(0.02, 0.1 + drop, gH * 2 - 0.04), st([0.1, 0.1, 0.11], 2), M(h + 0.012, lampY - drop / 2, 0));

    // ---- the tail between the lamps, by type, leaning with the panel as the lamps do
    if (t.tailDress && crushed <= 0.25) {
      const panel = t.tailDress === 'panel';
      const LWt = panel ? 0.42 : 0.34, Ht = panel ? 0.14 : 0.125, yc = t.tailY - 0.13;
      const gz = tailHW - (panel ? 0.29 : 0.235) - LWt / 2 - 0.014; // half the width between the lamps' inner edges
      const xa = tailX(yc - Ht / 2), xb = tailX(yc + Ht / 2);
      const m = M((xa + xb) / 2, yc, 0, 0, Math.PI, Math.atan2(xb - xa, Ht));
      const at = (lm) => new Matrix4().multiplyMatrices(m, lm);
      body.add(box(0.024, Ht + 0.016, gz * 2), S_BLACK, at(M(-0.003, 0, 0)));
      if (panel) {
        // a ribbed red reflector either side of the lock, bright strips over and under
        for (const sz of [1, -1]) {
          if (near) glass.add(lensPlate(gz - 0.06, Ht - 0.02, 9, 'z', 0.006, 0.0015, 7), { color: TAILC, a: [0.92, 0.07, -99, 0] }, at(M(0.014, 0, sz * (gz / 2 + 0.02))));
          else body.add(box(0.016, Ht - 0.02, gz - 0.06), LENS(TAILC), at(M(0.006, 0, sz * (gz / 2 + 0.02))));
        }
        for (const dy of [-1, 1]) body.add(box(0.01, 0.006, gz * 2 + 0.004), S_CHROME, at(M(0.014, dy * (Ht / 2 + 0.004), 0)));
        body.add(box(0.014, Ht - 0.03, 0.07), S_CHROME, at(M(0.012, 0, 0)));
        if (near) body.add(cyl(0.011, 0.011, 0.012, 8).rotateZ(Math.PI / 2), S_BLACK, at(M(0.02, 0, 0)));
        // the maker's bar on the lid's edge
        body.add(box(0.012, 0.022, 0.26), S_CHROME, M(tailX(t.tailY - 0.03) - 0.006, t.tailY - 0.03, 0));
      } else {
        // a ribbed black strip, the gate's handle in the middle, the model's plate to one side
        if (near) for (let k = 0; k < 4; k++) body.add(box(0.008, 0.008, gz * 2 - 0.02), st([0.03, 0.03, 0.032], 1), at(M(0.012, -Ht / 2 + 0.02 + k * (Ht - 0.04) / 3, 0)));
        body.add(box(0.016, 0.034, 0.17), S_CHROME, at(M(0.014, -0.012, 0)));
        body.add(box(0.012, 0.03, 0.15), S_CHROME, at(M(0.012, 0.02, gz - 0.12)));
      }
      // a red reflector low at each corner of the panel
      for (const sz of [1, -1]) body.add(box(0.012, 0.035, 0.11), LENS(TAILC), M(tailX(t.tailY - 0.36) - 0.006, t.tailY - 0.36, sz * (tailHW - 0.2)));
    }
    // a black lip across the roof's trailing edge
    if (t.lip && crushed <= 0.25) body.add(box(0.14, 0.02, t.W - 0.42), S_BLACK, M(t.roofR - 0.07, t.roofY - 0.012, 0, 0, 0, 0.14));
    // two round driving lamps stood on the front bumper
    if (t.spots && crushed <= 0.25) for (const z of [-0.24, 0.24]) {
      const x0 = h + 0.07, y0 = yF + bumpH + 0.075;
      body.add(box(0.02, 0.06, 0.02), S_BLACK, M(x0 - 0.02, y0 - 0.07, z));
      body.add(cyl(0.078, 0.066, 0.06, near ? 16 : 10).rotateZ(Math.PI / 2), S_BLACK, M(x0 - 0.02, y0, z));
      if (near) {
        body.add(bowl(0.066, 0.066, 0.03, 3, 16, 2), st([0.9, 0.91, 0.93], 2), M(x0 + 0.004, y0, z));
        glass.add(lensPlate(0.14, 0.14, 8, 'z', 0.007, 0.003, 2), { color: [0.03, 0.035, 0.035], a: [0.2, 0.22, -99, 0] }, M(x0 + 0.012, y0, z));
        body.add(torus(0.072, 0.007, 5, 18), S_CHROME, M(x0 + 0.01, y0, z, 0, Math.PI / 2, 0));
      } else body.add(cyl(0.07, 0.07, 0.01, 10).rotateZ(Math.PI / 2), LENS([0.42, 0.44, 0.46]), M(x0 + 0.012, y0, z));
    }

    // ---- plates: a backing, the plate, two lamps over the rear one
    if (o.plateText) {
      const py = t.tailY - 0.3;
      body.add(box(0.012, 0.185, 0.345), st([0.03, 0.03, 0.032], 1), M(-h - 0.012, py, 0));
      body.add(box(0.012, 0.185, 0.345), st([0.03, 0.03, 0.032], 1), M(h + 0.068, yF, 0));
      if (near) for (const z of [-0.1, 0.1]) {
        body.add(box(0.03, 0.018, 0.05), S_CHROME, M(-h - 0.016, py + 0.105, z));
        if (o.tail || o.head) lit.add(box(0.02, 0.004, 0.04), st(rgb(0xffe2b0, 5), 0), M(-h - 0.02, py + 0.094, z));
      }
    }

    // ---- sides: rub strip, handles, mirrors, repeaters, the fuel filler
    const yRub = t.sill + (t.belt - t.sill) * 0.42;
    for (const s of [1, -1]) {
      const open = s < 0 && ajar;
      const strip = (x0, x1, y, w, style, off = 0.006) => { if (x1 - x0 > 0.1) body.add(ribbon(S, line([x0, y], [x1, y], Math.ceil((x1 - x0) / (near ? 0.12 : 0.3))), w, s, off, 'y'), style); };
      const a0 = rx + t.wr + 0.1, a1 = fx - t.wr - 0.1;
      const runs = [[-h + 0.3, rx - t.wr - 0.1], [fx + t.wr + 0.1, h - 0.3]];
      if (open) runs.push([a0, dB - 0.012], [dA + 0.012, a1]); else runs.push([a0, dC - 0.008], [dC + 0.008, dB - 0.008], [dB + 0.008, dA - 0.008], [dA + 0.008, a1]);
      for (const [x0, x1] of runs) strip(x0, x1, yRub, 0.034, S_TRIM, 0.009);
      if (open) body.range('ajar', () => strip(dB + 0.012, dA - 0.012, yRub, 0.034, S_TRIM, 0.009));
      if (!near || crushed > 0.25) continue;
      const handle = (x) => {
        // an escutcheon dished into the skin, the flap across it, the lock under the grip
        const y = t.belt - 0.13, zk = S.skin(x, y);
        body.add(bowl(0.078, 0.03, 0.011, 2, 10, 5), st([0.01, 0.01, 0.011], 1), M(x, y, s * (zk + 0.012), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
        body.add(deform(box(0.13, 0.03, 0.01), (v) => { if (v.y < 0) v.z -= s * 0.007; v.y *= 1 - 0.35 * (Math.abs(v.x) / 0.065); }), S_CHROME, M(x, y + 0.005, s * (zk + 0.016)));
        body.add(cyl(0.008, 0.008, 0.008, 8).rotateX(Math.PI / 2), S_CHROME, M(x + 0.09, y - 0.036, s * (zk + 0.004)));
      };
      if (open) body.range('ajar', () => handle(dB + 0.15)); else handle(dB + 0.15);
      if (doors4) handle(dC + 0.15);
      // door mirror: a housing tapering forward on its foot, the glass set in the back of it
      const mirror = () => {
        const zm = s * S.skin(t.cowlX - 0.06, t.belt - 0.02);
        body.add(deform(box(0.11, 0.115, 0.185, 0.03, 1), (v) => { if (v.x > 0) { v.y *= 0.6; v.z *= 0.72; } }), st(tone('wingF'), 0), M(t.cowlX - 0.06, t.belt + 0.095, zm + s * 0.115, 0, s * 0.2, 0));
        body.add(deform(box(0.09, 0.05, 0.1), (v) => { if (v.y > 0) { v.x *= 0.6; v.z *= 0.7; } }), S_TRIM, M(t.cowlX - 0.055, t.belt + 0.035, zm + s * 0.035));
        body.add(box(0.004, 0.085, 0.15), st([0.3, 0.32, 0.34], 2), M(t.cowlX - 0.117, t.belt + 0.095, zm + s * 0.115, 0, s * 0.2, 0));
      };
      if (open) body.range('ajar', mirror); else mirror();
      // side repeater on the wing
      glass.add(lensPlate(0.05, 0.022, 3, 'y', 0.004), { color: AMBERC, a: [0.75, 0.4, -99, 0] }, M(fx + t.wr + 0.22, t.belt - 0.14, s * (S.skin(fx + t.wr + 0.22, t.belt - 0.14) + 0.003), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
      // mud flaps behind the wheels of the working vehicles
      if (t.bed || t.sill > 0.25 || t.flaps) for (const x of [fx, rx]) body.add(box(0.012, 0.26, 0.26), st([0.01, 0.01, 0.011], 1, 0), M(x - t.wr - 0.09, t.sill - 0.02, s * (hw - 0.17), 0, 0, -0.08));
    }
    // fuel filler: its door (a panel of the flank) and, open, the cap behind it
    if (near && o.fuelOpen) {
      const y = t.belt - 0.21, z = S.skin(fxc, y);
      body.add(cyl(0.035, 0.035, 0.03, 10).rotateX(Math.PI / 2), S_BLACK, M(fxc, y, fuelS * (z - 0.02)));
    }

    // ---- wipers, aerial, exhaust, underside, arch liners
    const wsA = Math.atan2(t.cowlX - t.roofF, t.roofY - t.hoodR);
    if (near && crushed < 0.25) {
      for (const s of [1, -1]) {
        body.add(box(0.012, 0.016, 0.5), S_BLACK, M(t.cowlX - 0.045 - 0.085 * Math.sin(wsA), t.hoodR + 0.03 + 0.085 * Math.cos(wsA), s * 0.3 - 0.1, 0.0, 0.1, wsA));
        body.add(box(0.014, 0.012, 0.4), st([0.02, 0.02, 0.022], 1), M(t.cowlX - 0.01, t.hoodR + 0.035, s * 0.3 + 0.1, 0.35, 0, 0));
        body.add(cyl(0.014, 0.014, 0.03, 8), S_BLACK, M(t.cowlX + 0.03, t.hoodR + 0.03, s * 0.3 + 0.28));
      }
      body.add(cyl(0.003, 0.005, 0.75, 5), S_BLACK, M(t.rearBaseX + 0.25, t.belt + 0.36, hw - 0.2, 0, 0, 0.25));
      // tailpipe: a tube you can see into
      body.add(cyl(0.03, 0.03, 0.2, 12, true).rotateZ(Math.PI / 2), S_CHROME, M(-h + 0.02, t.sill - 0.055, hw - 0.42));
      body.add(cyl(0.026, 0.026, 0.18, 10).rotateZ(Math.PI / 2), st([0.004, 0.004, 0.004], 1), M(-h - 0.0, t.sill - 0.055, hw - 0.42));
      body.add(cyl(0.08, 0.08, 0.55, 10).rotateZ(Math.PI / 2), st([0.1, 0.09, 0.08], 5), M(-h + 0.6, t.sill - 0.03, hw - 0.42));
    }
    body.add(box(t.L - 0.5, 0.12, t.W - 0.24), st([0.012, 0.012, 0.013], 1), M(0, t.sill + 0.03, 0));
    for (const x of [fx, rx]) {
      // arch liners: a tub over each wheel, caked
      const g = cyl(raL + 0.014, raL + 0.014, 0.34, near ? 16 : 8, true, 0).rotateX(Math.PI / 2);
      for (const s of [1, -1]) body.add(g.clone(), { color: [0.02, 0.018, 0.015], a: [1, 0, 0, 0], b: [1, 0, 0, 0] }, M(x, t.wr, s * (hw - 0.2), 0, 0, 0, 1, 1, -1));
      g.dispose();
      body.add(cyl(0.04, 0.04, t.W - 0.4, 6).rotateX(Math.PI / 2), S_STEEL, M(x, t.wr, 0));
    }
    // arch lips: the rolled edge of each wheel opening, a true arc whatever the panel grid does
    // behind it: out on the skin, a bead standing proud, then turned in toward the liner
    if (crushed < 0.5) for (const cx of [fx, rx]) for (const s of [1, -1]) {
      const N = near ? 24 : 12;
      const a2 = Math.asin(Math.max(-1, Math.min(1, (t.sill + 0.012 - t.wr) / raL))), a1 = Math.PI - a2;
      // (t.flare: a wide moulded flare in black over the tyre instead of a rolled lip)
      const prof = t.flare ? (near ? [[0.085, 0.0006, 0.5], [0.06, 0.034, 0.3], [0.02, 0.046, 0.05], [-0.003, 0.04, -0.5], [-0.006, -0.03, -8]] : [[0.085, 0.001, 0.5], [0.03, 0.044, 0.1], [-0.006, -0.03, -8]])
        : near ? [[0.03, 0.0006, 0.4], [0.013, 0.012, 0.3], [-0.003, 0.011, -0.5], [-0.006, -0.03, -8]] : [[0.028, 0.001, 0.4], [0.002, 0.012, -0.3], [-0.006, -0.03, -8]];
      const m = prof.length, ids = [];
      const col = t.flare ? TRIM : tone('arch'), fxA = [dirt, t.flare ? 0 : Math.min(1, rust * 1.5), 0, 0];
      for (let k = 0; k <= N; k++) {
        const a = a1 + (a2 - a1) * (k / N), ca = Math.cos(a), sa = Math.sin(a);
        const zs = S.skin(cx + ca * (raL + 0.02), t.wr + sa * (raL + 0.02));
        for (let q = 0; q < m; q++) {
          const r = raL + prof[q][0], l = Math.hypot(prof[q][2], 1);
          ids.push(body.vert(cx + ca * r, t.wr + sa * r, s * (zs + prof[q][1]), (ca * prof[q][2]) / l, (sa * prof[q][2]) / l, s / l, q === m - 1 ? BLACK : col, [q === m - 1 || t.flare ? 1 : 0, 0, 0, 0], fxA));
        }
      }
      for (let k = 0; k < N; k++) for (let q = 0; q < m - 1; q++) {
        const a = ids[k * m + q], b = ids[k * m + q + 1], c = ids[(k + 1) * m + q], d = ids[(k + 1) * m + q + 1];
        if (s > 0) body.quad(a, b, d, c); else body.quad(a, c, d, b);
      }
    }

    // ---- roof furniture
    const roofW = (S.half(0) - 0.05 - (t.tum ?? 0.3) * (t.roofY - t.belt)) * 2 - 0.1;
    if (t.rack && crushed < 0.25) {
      const yr = (x) => t.roofY - (t.roofDrop || 0) * clamp01((t.roofF - x) / (t.roofF - t.roofR));
      if (t.rackKind === 'rails') {
        // two bright rails along the gutters on low feet
        for (const s of [1, -1]) {
          for (const [xa, xb] of [[t.roofF - 0.3, (t.roofF + t.roofR) / 2], [(t.roofF + t.roofR) / 2, t.roofR + 0.25]]) body.add(cyl(0.011, 0.011, xa - xb, 6).rotateZ(Math.PI / 2), S_CHROME, M((xa + xb) / 2, (yr(xa) + yr(xb)) / 2 + 0.05, s * (roofW / 2 - 0.05), 0, 0, Math.atan2(yr(xa) - yr(xb), xa - xb)));
          for (const x of [t.roofF - 0.3, (t.roofF + t.roofR) / 2, t.roofR + 0.25]) body.add(near ? box(0.06, 0.05, 0.022, 0.008, 1) : box(0.06, 0.05, 0.022), S_CHROME, M(x, yr(x) + 0.03, s * (roofW / 2 - 0.05)));
        }
      } else if (t.rackKind === 'basket') {
        // an expedition rack: a tubed tray on six feet, slats across it, the spare lashed down flat
        const x0 = t.roofF - 0.35, x1 = t.roofR + 0.3, zw = roofW / 2 - 0.07, yb = t.roofY + 0.085;
        for (const s of [1, -1]) {
          for (const y of [yb, yb + 0.1]) body.add(cyl(0.012, 0.012, x0 - x1, 6).rotateZ(Math.PI / 2), S_TRIM, M((x0 + x1) / 2, y, s * zw));
          for (const x of [x0, (x0 + x1) / 2, x1]) { body.add(box(0.06, 0.07, 0.03), S_TRIM, M(x, t.roofY + 0.045, s * zw)); if (near) body.add(cyl(0.008, 0.008, 0.1, 5), S_TRIM, M(x, yb + 0.05, s * zw)); }
        }
        for (const x of [x0, x1]) for (const y of [yb, yb + 0.1]) body.add(cyl(0.012, 0.012, zw * 2, 6).rotateX(Math.PI / 2), S_TRIM, M(x, y, 0));
        if (near) for (let k = 1; k < 6; k++) body.add(box(0.04, 0.012, zw * 2), S_TRIM, M(x0 + ((x1 - x0) * k) / 6, yb, 0));
        if (!far) {
          body.add(torus(0.3, 0.115, near ? 8 : 5, near ? 20 : 10).rotateX(Math.PI / 2), { color: [0.007, 0.007, 0.008], a: [7, 0, 0, 0] }, M(x1 + 0.55, yb + 0.12, 0.1));
          body.add(cyl(0.2, 0.2, 0.1, near ? 14 : 8), S_STEEL, M(x1 + 0.55, yb + 0.1, 0.1));
        }
      } else {
        for (const s of [1, -1]) {
          body.add(box(t.roofF - t.roofR - 0.3, 0.025, 0.035), S_TRIM, M((t.roofF + t.roofR) / 2, t.roofY + 0.075, s * (roofW / 2 - 0.06)));
          for (const x of [t.roofF - 0.3, (t.roofF + t.roofR) / 2, t.roofR + 0.3]) body.add(box(0.07, 0.06, 0.03), S_TRIM, M(x, t.roofY + 0.045, s * (roofW / 2 - 0.06)));
        }
        for (const x of [t.roofF - 0.45, t.roofR + 0.45]) body.add(box(0.05, 0.022, roofW - 0.08), S_TRIM, M(x, t.roofY + 0.095, 0));
      }
    }
    if (o.lightbar) {
      // light bar: feet clamped to the gutters, an alloy base, six lens segments each over its own
      // pair of reflectors, the siren's speaker between the two banks
      const lx = (t.roofF + t.roofR) / 2 + 0.1, by = t.roofY + 0.045;
      for (const z of [-roofW * 0.42, roofW * 0.42]) body.add(box(0.07, 0.05, 0.05), S_BLACK, M(lx, t.roofY + 0.03, z));
      body.add(box(0.32, 0.022, roofW * 0.92), st([0.3, 0.31, 0.33], 2), M(lx, by + 0.012, 0));
      const segW = roofW * 0.135;
      for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
        const z = s * (roofW * 0.075 + segW * (k + 0.5));
        const c = k === 0 ? [0.3, 0.3, 0.28] : s > 0 ? [0.015, 0.04, 0.5] : [0.5, 0.012, 0.012];
        if (near) {
          for (const d of [1, -1]) body.add(bowl(segW / 2 - 0.012, 0.03, 0.03, 2, 8), st([0.8, 0.8, 0.82], 2), M(lx + d * 0.1, by + 0.062, z, 0, d > 0 ? 0 : Math.PI, 0));
          glass.add(box(0.3, 0.078, segW - 0.006), { color: c, a: [0.6, 0.35, -99, 0] }, M(lx, by + 0.063, z));
          body.add(box(0.31, 0.084, 0.006), S_BLACK, M(lx, by + 0.063, z + (s * segW) / 2));
        } else body.add(box(0.3, 0.078, segW - 0.006), LENS(c), M(lx, by + 0.063, z));
      }
      body.add(box(0.3, 0.08, roofW * 0.14), st([0.05, 0.05, 0.055], 1), M(lx, by + 0.063, 0));
      if (near) for (let k = 0; k < 5; k++) body.add(box(0.31, 0.006, roofW * 0.12), S_CHROME, M(lx, by + 0.035 + k * 0.014, 0));
      // push bar: two tube hoops off the chassis, two cross tubes, a rubber strip down each upright
      const pb = h + 0.13;
      for (const z of [-0.33, 0.33]) {
        if (near) {
          body.add(tube([[h - 0.05, t.sill + 0.06, z], [pb - 0.02, t.sill + 0.1, z], [pb, t.sill + 0.2, z], [pb, lampY + 0.12, z], [pb - 0.03, lampY + 0.19, z]], 0.02, 6, 3), S_BLACK);
          body.add(box(0.012, 0.22, 0.03), st([0.03, 0.03, 0.032], 1), M(pb + 0.022, lampY - 0.02, z));
        } else body.add(box(0.04, lampY + 0.09 - t.sill, 0.04), S_BLACK, M(pb, (lampY + 0.19 + t.sill + 0.1) / 2, z));
      }
      for (const y of [lampY + 0.13, t.sill + 0.26]) body.add(cyl(0.019, 0.019, 0.96, near ? 8 : 5).rotateX(Math.PI / 2), S_BLACK, M(pb, y, 0));
      // spot lamp on the driver's pillar
      body.add(cyl(0.05, 0.04, 0.09, 10).rotateZ(Math.PI / 2), S_CHROME, M(t.cowlX - 0.12, t.belt + 0.2, -(hw - 0.02)));
    }
    body.warp = null; glass.warp = null; lit.warp = null; // what is inside stays where it was

    // ---- cabin
    const gw = (S.half(0) - 0.06) * 2;
    const floorY = t.sill + 0.1;
    const SEATS = [[0.075, 0.06, 0.048], [0.05, 0.052, 0.056], [0.07, 0.028, 0.024], [0.045, 0.05, 0.042]]; // tan, grey, oxblood, olive
    const SEAT = st(o.lightbar ? [0.035, 0.035, 0.04] : SEATS[(o.seed >>> 3) % SEATS.length], 3), DASH = st([0.03, 0.03, 0.032], 3), CARPET = st([0.02, 0.019, 0.018], 3);
    const seatX = t.cowlX - 1.02;
    const cab0 = body.n;
    if (near && crushed < 0.25) {
      { const x0 = gate ? -h + 0.12 : t.rearBaseX - 0.05; body.add(box(t.cowlX - x0, 0.02, gw - 0.1), CARPET, M((t.cowlX + x0) / 2, floorY, 0)); }
      body.add(box(0.03, t.hoodR - floorY, gw - 0.08), DASH, M(t.cowlX + 0.0, (t.hoodR + floorY) / 2, 0)); // bulkhead
      for (const z of [-0.38, 0.38]) {
        // front seats: a squab and a back, each with its bolsters standing up at the sides, a head restraint on its posts
        body.add(deform(box(0.5, 0.16, 0.5, 0.05, 1), (v) => { if (v.y > 0) v.y += 0.035 * smooth(0.55, 1, Math.abs(v.z) / 0.25); }), SEAT, M(seatX + 0.2, floorY + 0.24, z, 0, 0, 0.06));
        body.add(deform(box(0.13, 0.62, 0.5, 0.05, 1), (v) => { v.z *= 1 - 0.12 * Math.max(0, v.y / 0.31); if (v.x > 0) v.x += 0.045 * smooth(0.55, 1, Math.abs(v.z) / 0.25) * (1 - 0.5 * Math.max(0, v.y / 0.31)); }), SEAT, M(seatX - 0.06, floorY + 0.6, z, 0, 0, 0.22));
        body.add(box(0.1, 0.17, 0.26, 0.04, 1), SEAT, M(seatX - 0.165, floorY + 1.02, z, 0, 0, 0.22));
        for (const dz of [-0.06, 0.06]) body.add(cyl(0.007, 0.007, 0.1, 5), S_CHROME, M(seatX - 0.14, floorY + 0.92, z + dz, 0, 0, 0.22));
        body.add(box(0.5, 0.08, 0.52), CARPET, M(seatX + 0.2, floorY + 0.1, z)); // seat base
      }
      // dashboard: a moulded top over a fascia, the binnacle, the wheel on its column
      const dash = [[t.cowlX - 0.03, t.belt + 0.0], [t.cowlX - 0.4, t.belt - 0.005], [t.cowlX - 0.5, t.belt - 0.07], [t.cowlX - 0.47, t.belt - 0.33], [t.cowlX - 0.3, t.belt - 0.42], [t.cowlX - 0.03, t.belt - 0.42]];
      body.add(extrude(roundPoly(dash.map(([x, y], i) => [x, y, i === 1 || i === 2 ? 0.04 : 0.01]), 3), gw - 0.12, { bevel: 0.01, bevelSeg: 1 }), DASH);
      body.add(box(0.16, 0.09, 0.34, 0.03, 2), DASH, M(t.cowlX - 0.4, t.belt + 0.03, -0.38));
      body.add(box(0.012, 0.09, 0.3), st([0.012, 0.014, 0.014], 3), M(t.cowlX - 0.487, t.belt - 0.12, -0.38, 0, 0, -0.2));
      if (o.head || o.dome) lit.add(box(0.004, 0.05, 0.22), st([0.12, 0.5, 0.3], 0), M(t.cowlX - 0.495, t.belt - 0.12, -0.38, 0, 0, -0.2)); // the instruments, still lit
      body.add(box(0.012, 0.11, 0.2), st([0.014, 0.014, 0.016], 3), M(t.cowlX - 0.488, t.belt - 0.2, 0.0, 0, 0, -0.12)); // radio and heater
      body.add(box(0.01, 0.09, 0.28), st([0.02, 0.02, 0.022], 3), M(t.cowlX - 0.478, t.belt - 0.2, 0.42, 0, 0, -0.06)); // glovebox lid
      const wy = t.belt - 0.0, wx = t.cowlX - 0.6;
      body.add(torus(0.175, 0.016, 6, 20), st([0.012, 0.012, 0.013], 3), M(wx, wy, -0.38, 0, Math.PI / 2, -0.42));
      for (const a of [0, 2.2, -2.2]) body.add(box(0.012, 0.165, 0.03), st([0.014, 0.014, 0.015], 3), M(wx, wy, -0.38, 0, Math.PI / 2, -0.42).multiply(M(0, 0, 0, 0, 0, a)).multiply(M(0, 0.085, 0)));
      body.add(cyl(0.035, 0.045, 0.05, 10).rotateX(Math.PI / 2), st([0.014, 0.014, 0.015], 3), M(wx, wy, -0.38, 0, Math.PI / 2, -0.42));
      body.add(cyl(0.022, 0.022, 0.26, 8).rotateZ(Math.PI / 2), DASH, M(wx + 0.12, wy - 0.055, -0.38, 0, 0, -0.42));
      // centre console, gear lever, handbrake, the mirror on the screen
      body.add(box(0.75, 0.2, 0.18, 0.03, 1), DASH, M(seatX + 0.3, floorY + 0.14, 0));
      body.add(cyl(0.008, 0.008, 0.16, 6), S_CHROME, M(seatX + 0.42, floorY + 0.3, 0, 0, 0, -0.2));
      body.add(sphere(0.024, 8, 6), st([0.012, 0.012, 0.013], 3), M(seatX + 0.44, floorY + 0.385, 0));
      body.add(box(0.2, 0.025, 0.03), DASH, M(seatX + 0.08, floorY + 0.27, 0.03, 0, 0, 0.25));
      body.add(box(0.02, 0.06, 0.2), DASH, M(t.roofF + 0.16, t.roofY - 0.1, 0, 0, 0, 0.3));
      body.add(box(0.004, 0.05, 0.18), st([0.35, 0.37, 0.4], 2), M(t.roofF + 0.148, t.roofY - 0.1, 0, 0, 0, 0.3));
      if (!t.bed) {
        // rear bench with two restraints, the shelf behind it
        const bxr = t.rearBaseX + (gate ? 0.75 : 0.5);
        body.add(deform(box(0.5, 0.16, gw - 0.2, 0.05, 1), (v) => { if (v.y > 0) v.y += 0.03 * smooth(0.7, 1, Math.abs(v.z) / ((gw - 0.2) / 2)); }), SEAT, M(bxr + 0.24, floorY + 0.24, 0, 0, 0, 0.06));
        body.add(box(0.13, 0.58, gw - 0.2, 0.05, 1), SEAT, M(bxr - 0.04, floorY + 0.58, 0, 0, 0, 0.26));
        for (const z of [-0.4, 0.4]) body.add(box(0.09, 0.15, 0.24, 0.04, 1), SEAT, M(bxr - 0.15, floorY + 0.95, z, 0, 0, 0.26));
        body.add(box(0.5, 0.08, gw - 0.16), CARPET, M(bxr + 0.24, floorY + 0.1, 0));
        if (!gate) body.add(box(t.rearBaseX + 0.52 - (t.rearBaseX - 0.02) + 0.0, 0.02, gw - 0.2), st([0.05, 0.05, 0.052], 3), M(t.rearBaseX + 0.24, t.belt - 0.02, 0));
        else {
          // load floor and what was left in the back
          { const x0 = -h + 0.12, x1 = t.rearBaseX + 0.66; body.add(box(x1 - x0, 0.03, gw - 0.2), CARPET, M((x0 + x1) / 2, floorY + 0.3, 0)); }
        }
      } else body.add(box(0.03, t.belt - floorY + 0.2, gw - 0.1), DASH, M(t.rearBaseX + 0.06, (t.belt + floorY) / 2 + 0.1, 0));
      // door armrests on the three doors that are shut (the open one carries its own)
      for (const s of [1, -1]) for (const [x, w] of doors4 ? [[(dA + dB) / 2, 0.5], [(dB + dC) / 2, 0.4]] : [[(dA + dB) / 2, 0.5]]) {
        const arm = () => body.add(box(w, 0.05, 0.07), st([0.03, 0.03, 0.032], 3), M(x, t.belt - 0.2, s * (S.skin(x, t.belt - 0.2) - 0.085)));
        if (s < 0 && ajar && x > dB) body.range('ajar', () => { arm(); body.add(box(w * 0.9, 0.12, 0.025), st([0.025, 0.025, 0.027], 3), M(x - 0.03, t.sill + 0.24, s * (S.skin(x, t.sill + 0.24) - 0.07))); body.add(box(0.1, 0.02, 0.02), S_CHROME, M(x + 0.12, t.belt - 0.1, s * (S.skin(x, t.belt - 0.1) - 0.065))); });
        else arm();
      }
      if (o.lightbar) {
        // the cruiser's cabin: a console between the seats with its screen lit, a cage behind them
        body.add(box(0.3, 0.2, 0.22), st([0.02, 0.02, 0.022], 3), M(seatX + 0.42, floorY + 0.36, 0, 0, 0, 0.1));
        lit.add(box(0.004, 0.11, 0.17), st([0.25, 0.9, 0.75], 0), M(seatX + 0.345, floorY + 0.47, -0.02, 0, 0.25, 0.35));
        body.add(box(0.012, 0.13, 0.19), st([0.01, 0.01, 0.012], 3), M(seatX + 0.35, floorY + 0.47, -0.02, 0, 0.25, 0.35));
        for (let k = 0; k < 9; k++) body.add(box(0.012, 0.5, 0.012), S_BLACK, M(seatX - 0.3, t.belt + 0.2, -0.56 + k * 0.14));
        for (const y of [t.belt - 0.04, t.belt + 0.44]) body.add(box(0.02, 0.02, 1.2), S_BLACK, M(seatX - 0.3, y, 0));
      }
      if (o.dome || o.lightbar) {
        const dx = t.roofF - 0.5;
        body.add(box(0.12, 0.012, 0.08), st([0.3, 0.3, 0.28], 3), M(dx, t.roofY - 0.062, 0));
        if (o.dome) lit.add(box(0.1, 0.006, 0.06), st(rgb(0xffd9a0, 26), 0), M(dx, t.roofY - 0.07, 0));
      }
    } else if (crushed < 0.25) {
      // middle level: the cabin's silhouette behind the tinted glass: a tub, the seats, the dash, the wheel
      const TUB = st([0.022, 0.022, 0.023], 3);
      const x0 = Math.max(gate ? -h + 0.2 : t.rearBaseX, -h + 0.72), x1 = t.cowlX, zw = S.half(x0) - 0.07;
      body.add(box(x1 - x0, 0.02, zw * 2), TUB, M((x0 + x1) / 2, floorY, 0));
      for (const s of [1, -1]) body.add(box(x1 - x0, t.belt - floorY, 0.02), TUB, M((x0 + x1) / 2, (t.belt + floorY) / 2, s * zw));
      body.add(box(0.02, t.belt - floorY, zw * 2), TUB, M(x0, (t.belt + floorY) / 2, 0));
      body.add(box(0.48, t.belt - floorY, zw * 2 - 0.04), DASH, M(t.cowlX - 0.25, (t.belt + floorY) / 2, 0));
      body.add(torus(0.175, 0.018, 4, 10), st([0.012, 0.012, 0.013], 3), M(t.cowlX - 0.6, t.belt, -0.38, 0, Math.PI / 2, -0.42));
      for (const z of [-0.38, 0.38]) {
        body.add(box(0.5, 0.2, 0.48), SEAT, M(seatX + 0.2, floorY + 0.2, z));
        body.add(box(0.14, 0.62, 0.46), SEAT, M(seatX - 0.06, floorY + 0.6, z, 0, 0, 0.22));
        body.add(box(0.1, 0.17, 0.26), SEAT, M(seatX - 0.165, floorY + 1.02, z, 0, 0, 0.22));
      }
      if (!t.bed) {
        const bxr = t.rearBaseX + (gate ? 0.75 : 0.5);
        body.add(box(0.5, 0.2, gw - 0.2), SEAT, M(bxr + 0.24, floorY + 0.2, 0));
        body.add(box(0.14, 0.58, gw - 0.2), SEAT, M(bxr - 0.04, floorY + 0.58, 0, 0, 0, 0.26));
        if (!gate) body.add(box(0.52, 0.02, gw - 0.2), TUB, M(t.rearBaseX + 0.24, t.belt - 0.02, 0));
      }
    }
    // light the cabin from its lamps: baked, so it shows through the glass with no light slot to spare
    {
      const lamps = [];
      if (o.dome) lamps.push([t.roofF - 0.5, t.roofY - 0.1, 0, 0.022 * (o.dome === true ? 1 : o.dome)]);
      if (o.lightbar && near) lamps.push([seatX + 0.3, floorY + 0.5, -0.05, 0.004]);
      if ((o.head || o.dome) && near) lamps.push([t.cowlX - 0.55, t.belt - 0.1, -0.38, 0.0012]);
      if (lamps.length) for (let i = cab0; i < body.n; i++) {
        if (body.a[i * 4] !== 3) continue;
        let e = 0;
        for (const [lx, ly, lz, k] of lamps) {
          const dx = lx - body.pos[i * 3], dy = ly - body.pos[i * 3 + 1], dz = lz - body.pos[i * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
          const nl = (body.nrm[i * 3] * dx + body.nrm[i * 3 + 1] * dy + body.nrm[i * 3 + 2] * dz) / d;
          e += (k * Math.max(0.12, nl)) / (0.08 + d2);
        }
        body.a[i * 4 + 1] = Math.min(1.1, e * 16);
      }
      // the lining was built before cab0: light it too
      if (lamps.length && near) for (let i = 0; i < cab0; i++) {
        if (body.a[i * 4] !== 3) continue;
        let e = 0;
        for (const [lx, ly, lz, k] of lamps) {
          const dx = lx - body.pos[i * 3], dy = ly - body.pos[i * 3 + 1], dz = lz - body.pos[i * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
          const nl = (body.nrm[i * 3] * dx + body.nrm[i * 3 + 1] * dy + body.nrm[i * 3 + 2] * dz) / d;
          e += (k * Math.max(0.12, nl)) / (0.08 + d2);
        }
        body.a[i * 4 + 1] = Math.min(1.1, e * 16);
      }
    }

    // ---- what is under the lid: a boot, a load space, the pickup's tool box
    const GLOW = [0.5, 0.42, 0.3];
    if (near || lod === MID) {
      const well = (x0, x1, y0, y1, w) => {
        const WELL = st([0.035, 0.034, 0.032], 3);
        body.add(box(x1 - x0, 0.02, w), WELL, M((x0 + x1) / 2, y0, 0));
        if (near) {
          for (const s of [1, -1]) body.add(box(x1 - x0, y1 - y0, 0.02), WELL, M((x0 + x1) / 2, (y0 + y1) / 2, s * w / 2));
          body.add(box(0.02, y1 - y0, w), WELL, M(x1, (y0 + y1) / 2, 0));
          // a holdall, a jack, a fuel can
          body.add(box(0.5, 0.2, 0.3, 0.07, 1), st([0.05, 0.07, 0.05], 3), M((x0 + x1) / 2 + 0.05, y0 + 0.11, -w * 0.18, 0, 0.3, 0));
          body.add(box(0.2, 0.26, 0.13), st([0.35, 0.05, 0.03], 3), M((x0 + x1) / 2 - 0.1, y0 + 0.14, w * 0.25, 0, -0.2, 0));
          body.add(box(0.3, 0.07, 0.1), st([0.1, 0.1, 0.11], 5), M((x0 + x1) / 2 + 0.15, y0 + 0.045, w * 0.3, 0, 0.9, 0));
        }
      };
      if (hasBoot) {
        const s0 = body.n;
        well(-h + 0.12, xBoot0 - 0.02, t.sill + 0.16, t.deckY - 0.05, tailHW * 2 - 0.25);
        body.ranges.lidGlow = [[s0, body.n - s0]];
        for (let i = s0; i < body.n; i++) body.a[i * 4 + 1] = 2.2;
        lit.range('lidGlow', () => lit.add(box(0.1, 0.01, 0.05), st(rgb(0xffe2b0, 14), 0), M(xBoot0 - 0.1, t.deckY - 0.07, 0)));
      } else if (gate && near) {
        const s0 = body.n;
        body.add(box(0.5, 0.2, 0.3, 0.07, 1), st([0.05, 0.07, 0.05], 3), M(t.rearBaseX + 0.25, floorY + 0.42, -0.2, 0, 0.3, 0));
        body.add(box(0.2, 0.26, 0.13), st([0.35, 0.05, 0.03], 3), M(t.rearBaseX + 0.15, floorY + 0.45, 0.3, 0, -0.2, 0));
        body.ranges.lidGlow = [[s0, body.n - s0]];
        for (let i = s0; i < body.n; i++) body.a[i * 4 + 1] = 2.0;
        lit.range('lidGlow', () => lit.add(box(0.08, 0.01, 0.05), st(rgb(0xffe2b0, 14), 0), M(t.roofR - 0.3, t.roofY - 0.075, 0)));
      } else if (t.bed) {
        // a tool box across the bed behind the cab: checker plate, its lid on a piano hinge
        const x0 = t.rearBaseX - 0.62, x1 = t.rearBaseX - 0.1, y0 = t.deckY - 0.46, y1 = t.deckY + 0.07, w = t.W - 0.3;
        const BOX = st([0.33, 0.34, 0.36], 2);
        for (const s of [1, -1]) body.add(box(x1 - x0, y1 - y0, 0.02), BOX, M((x0 + x1) / 2, (y0 + y1) / 2, s * w / 2));
        for (const x of [x0, x1]) body.add(box(0.02, y1 - y0, w), BOX, M(x, (y0 + y1) / 2, 0));
        const s0 = body.n;
        body.add(box(x1 - x0 - 0.04, 0.02, w - 0.04), st([0.03, 0.03, 0.03], 3), M((x0 + x1) / 2, y0 + 0.03, 0));
        if (near) {
          body.add(box(0.3, 0.1, 0.45), st([0.3, 0.05, 0.03], 3), M((x0 + x1) / 2, y0 + 0.1, -0.4));
          body.add(box(0.12, 0.08, 0.5), st([0.25, 0.2, 0.05], 3), M((x0 + x1) / 2 + 0.05, y0 + 0.09, 0.35, 0, 0.2, 0));
        }
        body.ranges.lidGlow = [[s0, body.n - s0]];
        for (let i = s0; i < body.n; i++) body.a[i * 4 + 1] = 2.2;
        body.range('lid', () => body.add(box(x1 - x0 + 0.03, 0.025, w + 0.03), BOX, M((x0 + x1) / 2, y1 + 0.012, 0)));
        lit.range('lidGlow', () => lit.add(box(0.05, 0.01, 0.3), st(rgb(0xffe2b0, 10), 0), M(x1 - 0.04, y1 - 0.05, 0)));
      }
      void GLOW;
    }

    // ---- broken glass
    {
      const rg = createRng(o.seed).fork('glass');
      const PEB = st([0.16, 0.22, 0.2], 6);
      const mix = (u, v, f) => [u[0] + (v[0] - u[0]) * f, u[1] + (v[1] - u[1]) * f, u[2] + (v[2] - u[2]) * f];
      // a crumb of toughened glass: three facets on a triangle a few millimetres across
      const chip = (x, y, z, sz) => {
        const a = rg.range(0, 6.283), ca = Math.cos(a) * sz, sa = Math.sin(a) * sz;
        const P4 = [[x + ca, y, z + sa], [x - sa * 0.8, y, z + ca * 0.8], [x - ca * 0.6 + sa * 0.5, y, z - sa * 0.6 - ca * 0.5], [x + sa * 0.1, y + sz * rg.range(0.5, 0.9), z + ca * 0.1]];
        for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
          const A = P4[i], Bp = P4[j], C = P4[3];
          const ux = Bp[0] - A[0], uy = Bp[1] - A[1], uz = Bp[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
          let n0 = uy * vz - uz * vy, n1 = uz * vx - ux * vz, n2 = ux * vy - uy * vx;
          const l = Math.hypot(n0, n1, n2) || 1, f = n1 < 0 ? -1 / l : 1 / l; // facets look up and out
          n0 *= f; n1 *= f; n2 *= f;
          const v0 = body.vert(A[0], A[1], A[2], n0, n1, n2, PEB.color, PEB.a), v1 = body.vert(Bp[0], Bp[1], Bp[2], n0, n1, n2, PEB.color, PEB.a), v2 = body.vert(C[0], C[1], C[2], n0, n1, n2, PEB.color, PEB.a);
          if (f > 0) body.tri(v0, v1, v2); else body.tri(v0, v2, v1);
        }
      };
      const pebbles = (cx, cy, cz, rx2, rz2, n) => {
        for (let k = 0; k < n * 1.7; k++) { const a = rg.range(0, 6.283), q = rg.next() ** 0.8; chip(cx + Math.cos(a) * q * rx2, cy, cz + Math.sin(a) * q * rz2, rg.next() < 0.12 ? rg.range(0.005, 0.0075) : rg.range(0.0022, 0.0048)); }
      };
      // a side window that is gone leaves shards in the rubber, crumbs on the seat and on the ground
      if (near) for (let i = 0; i < nx - 1; i++) for (let jj = 0; jj < ny - 1; jj++) {
        const zone = rowInfo(jj)[1];
        if (zone !== 'U' && zone !== 'T') continue;
        if (!cellId(i, jj)) continue;
        for (const [ei, ej] of [[i - 1, jj], [i + 1, jj], [i, jj - 1], [i, jj + 1]]) {
          if (ei < 0 || ej < 0 || ei >= nx - 1 || ej >= ny - 1 || cellId(ei, ej)) continue;
          // the edge shared with the frame, and the opposite edge of the cell (which way is in)
          const di = ei - i, dj = ej - jj;
          const p0 = di ? [i + (di > 0 ? 1 : 0), jj] : [i, jj + (dj > 0 ? 1 : 0)], p1 = di ? [p0[0], jj + 1] : [i + 1, p0[1]];
          const q0 = di ? [i + (di > 0 ? 0 : 1), jj] : [i, jj + (dj > 0 ? 0 : 1)], q1 = di ? [q0[0], jj + 1] : [i + 1, q0[1]];
          const P3 = (pt) => { const k = (pt[0] * ny + pt[1]) * 3; return [grid.P[k] - grid.N[k] * 0.009, grid.P[k + 1] - grid.N[k + 1] * 0.009, grid.P[k + 2] - grid.N[k + 2] * 0.009, grid.N[k], grid.N[k + 1], grid.N[k + 2]]; };
          const a = P3(p0), b = P3(p1), c = P3(q0), d = P3(q1);
          // what toughened glass leaves in its rubber: a ragged crazed band, deeper in the corners and
          // here and there a tongue still hanging in, bitten back to nothing in places; and where the
          // edge is the sill, crumbs lying along it
          const el = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), dl = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) || 1;
          const nseg = Math.max(3, Math.round(el / 0.022));
          const ph = rg.range(0, 6.283), ph2 = rg.range(0, 6.283);
          let prev = null, tongue = 0;
          for (let k = 0; k <= nseg; k++) {
            const f = k / nseg;
            if (rg.next() < 0.035) tongue = rg.range(0.015, 0.045); else tongue *= 0.4;
            let dep = 0.005 + 0.009 * (0.5 + 0.5 * Math.sin(f * el * 31 + ph)) + 0.007 * (0.5 + 0.5 * Math.sin(f * el * 83 + ph2)) + rg.range(-0.004, 0.008) + tongue;
            if (rg.next() < 0.09) dep = 0.002;
            const tf = Math.min(0.9, Math.max(0.001, dep / dl));
            const e = mix(a, b, f), ti = mix(mix(a, b, clamp01(f + rg.range(-0.3, 0.3) / nseg)), mix(c, d, f), tf);
            const v0 = body.vert(e[0], e[1], e[2], a[3], a[4], a[5], PEB.color, PEB.a), v1 = body.vert(ti[0], ti[1], ti[2], a[3], a[4], a[5], PEB.color, PEB.a);
            if (prev) { body.quad(prev[0], v0, v1, prev[1]); body.quad(prev[0], prev[1], v1, v0); }
            prev = [v0, v1];
          }
          if (Math.min(c[1], d[1]) > Math.max(a[1], b[1]) + 0.05) for (let k = 0; k < el / 0.011; k++) {
            const e = mix(mix(a, b, rg.next()), mix(c, d, 0.5), rg.range(-0.01, 0.03) / dl);
            chip(e[0] - a[3] * rg.range(0.004, 0.02), e[1] + 0.002, e[2] - a[5] * rg.range(0.004, 0.02), rg.range(0.002, 0.004));
          }
        }
      }
      function cellId(i, jj) {
        // is this cell a pane that has been broken out?
        const [side, zone, sub] = rowInfo(jj);
        const x = xm(i);
        if (zone === 'T') {
          if (sub < 1 || grid.bedZone(x)) return null;
          if (x <= t.roofR - 0.05 && x > t.rearBaseX + 0.04 && !t.bed && broken.has('rw')) return 'rw';
          return null;
        }
        if (zone !== 'U' || !cabinX(x) || x > dA) return null;
        if (x > dB) { const frame = sub === NU - 1 || x < dB + 0.05 || um(i) < 0.09; const id = side > 0 ? 'fr' : 'fl'; return !frame && broken.has(id) ? id : null; }
        if (x > dC) { const frame = sub === NU - 1 || x > dB - 0.05 || x < dC + 0.05; const id = side > 0 ? (doors4 ? 'rr' : 'qr') : (doors4 ? 'rl' : 'ql'); return !frame && broken.has(id) ? id : null; }
        return null;
      }
      const gy = o.flat ? 0.036 : 0.006; // the road, in the car's (leaning) space
      if (near) for (const id of broken) {
        const s = id[1] === 'r' ? 1 : -1;
        if (id === 'fl' || id === 'fr') { pebbles(seatX + 0.2, floorY + 0.335, s * 0.38, 0.2, 0.18, 30); pebbles((dA + dB) / 2, gy, s * (hw + 0.25), 0.5, 0.3, 70); }
        if (id === 'rl' || id === 'rr') { pebbles(t.rearBaseX + 0.75, floorY + 0.335, s * 0.4, 0.18, 0.2, 26); pebbles((dB + dC) / 2, gy, s * (hw + 0.25), 0.45, 0.3, 60); }
        if (id === 'rw') pebbles(-h - 0.2, gy, 0, 0.35, 0.6, 70);
      }
      // a windscreen holds together and webs: cracks running out from where it was hit, wandering
      // as they go, shorter ones bridging between them (at the middle level, fewer and wider)
      if (broken.has('ws') && crushed <= 0.25) {
        const cz = webZ; // (the web itself is drawn in the glass: mats/carPaint.js, carWeb)
        if (near) pebbles(t.cowlX + 0.15, t.hoodR + 0.025, cz, 0.12, 0.2, 18);
      }
    }
  })));

  if (far) return { body, lit, wheels: [], plates: [] };

  // ---- hinged parts: the driver's door left open, the lid when the car has been searched
  if (ajar) {
    const zh = -S.skin(dA, t.belt - 0.2);
    const hinge = new Matrix4().multiplyMatrices(lean, M(dA, 0, zh + 0.01, 0, -o.doorAjar, 0)).multiply(M(-dA, 0, -(zh + 0.01))).multiply(new Matrix4().copy(lean).invert());
    body.transform('ajar', hinge); glass.transform('ajar', hinge);
    // what holds it: the check strap and the hinge knuckles on the pillar
    body.at(lean, () => {
      body.add(box(0.26, 0.03, 0.012), S_BLACK, M(dA - 0.1, t.sill + 0.42, zh - 0.08, 0, -o.doorAjar * 0.5, 0));
      for (const y of [t.sill + 0.2, t.belt - 0.12]) body.add(cyl(0.018, 0.018, 0.09, 6), S_STEEL, M(dA + 0.005, y, zh - 0.012));
      body.add(box(dA - dB - 0.06, 0.03, 0.1), st([0.22, 0.23, 0.24], 2), M((dA + dB) / 2, t.sill + 0.085, zh + 0.06)); // sill plate
    });
  }
  let lid = null;
  if (hasBoot) lid = M(xBoot0, t.deckY - 0.01, 0, 0, 0, -1.25).multiply(M(-xBoot0, -(t.deckY - 0.01), 0));
  else if (gate) { const px = t.roofR - 0.05, py = grid.cOf(px) - 0.02; lid = M(px, py, 0, 0, 0, -1.3).multiply(M(-px, -py, 0)); }
  else if (t.bed) { const px = t.rearBaseX - 0.1, py = t.deckY + 0.085; lid = M(px, py, 0, 0, 0, -1.15).multiply(M(-px, -py, 0)); }
  if (lid) lid = new Matrix4().multiplyMatrices(lean, lid).multiply(new Matrix4().copy(lean).invert());

  // ---- wheels (instanced by the layer): unit wheel -> the car
  const wheels = [];
  const ww = t.wr > 0.4 ? 0.27 : 0.225, zc = hw + 0.028 - 0.53 * ww; // the sidewall flush with the arch lip
  const rim = o.rim === 'paintGalv' || o.steel ? 'steel' : 'alloy';
  if (crushed < 0.5) for (const [x, s, id] of [[fx, 1, 'fr'], [fx, -1, 'fl'], [rx, 1, 'rr'], [rx, -1, 'rl']]) {
    const flat = o.flat === id || crushed > 0.2;
    const drop = flat ? t.wr * 0.36 : 0;
    wheels.push({ m: new Matrix4().multiplyMatrices(lean, M(x, t.wr - drop, s * zc, 0, s > 0 ? 0 : Math.PI, 0, t.wr, t.wr, ww)), flat, rim });
  }
  return { body, glass, lit, wheels, plates: plates(), lid };

  function plates() {
    if (!o.plateText) return [];
    const py = t.tailY - 0.3;
    return [{ m: new Matrix4().multiplyMatrices(lean, M(-h - 0.02, py, 0, 0, Math.PI, 0)), text: o.plateText }, { m: new Matrix4().multiplyMatrices(lean, M(h + 0.076, yF, 0)), text: o.plateText }];
  }
}

// the stand-in the shadow passes and the puddle reflection draw: the silhouette in a few hundred triangles
function standIn(B, t, o) {
  const h = t.L / 2, hw = t.W / 2;
  const fx = h - t.fo, rx = fx - t.wb;
  const col = [o.paintRgb[0] * 0.8, o.paintRgb[1] * 0.8, o.paintRgb[2] * 0.8];
  const gw = t.W - 0.13;
  const add = (geo, m) => B.add('vcRefl', geo, { m, color: col, shadow: true });
  // (kept a few centimetres inside the real skin everywhere: a stand-in that pokes through the
  // body it stands for draws its own shadow across the panels)
  const inside = (v) => { v.x *= 0.985; v.z *= 0.93; if (v.y > t.sill + 0.25) v.y -= 0.06; };
  add(deform(extrude(bodyOutline(t, 3, 1), t.W, { smooth: false }), (v) => { v.z *= 1 - 0.13 * Math.max(0, (Math.abs(v.x) - (h - 0.7)) / 0.7) ** 2; inside(v); }));
  add(deform(extrude([[t.cowlX - 0.02, t.hoodR - 0.03], [t.roofF - 0.04, t.roofY], [t.roofR + 0.04, t.roofY - 0.012], [t.rearBaseX + 0.06, t.belt - 0.03]], gw - 0.12, { smooth: false }), (v) => { v.z *= 1 - (t.tum ?? 0.3) * 0.9 * Math.min(1, Math.max(0, (v.y - t.belt) / (t.roofY - t.belt))); v.y -= 0.06; }));
  add(boxUp(t.L - 0.5, t.wr + 0.1, t.W - 0.5), M(0, t.sill - 0.04, 0));
  for (const x of [fx, rx]) for (const s of [1, -1]) add(cyl(t.wr, t.wr, 0.22, 8).rotateX(Math.PI / 2), M(x, t.wr, s * (hw - 0.13)));
  if (o.doorAjar) add(box(1.0, t.belt - t.sill, 0.05).translate(-0.5, (t.belt + t.sill) / 2 + 0.04, 0), M(t.cowlX + 0.03, 0, -hw, 0, -o.doorAjar, 0));
}

export function buildCar(B, opts = {}) {
  const t = CAR_TYPES[opts.type || 'sedan'];
  const o = { ...(HISTORY[opts.id] || {}), ...opts };
  const h = t.L / 2, hw = t.W / 2;
  const hex = typeof o.paint === 'number' ? o.paint : o.far && o.colour !== undefined ? FAR_PAINT[o.colour % FAR_PAINT.length] : (CAR_PAINT[o.paint || 'paintCarA'] ?? 0x5c5a52);
  o.paintRgb = rgb(hex);
  const p0 = B.point(0, 0, 0);
  o.seed = (hashStr(`${o.id || ''}:${o.type || 'sedan'}:${Math.round(p0[0] * 10)}:${Math.round(p0[2] * 10)}`) ^ 0x9e3779b9) >>> 0;
  o.plateText = o.plate ? (PLATES[o.plate] || String(o.plate)) : null;

  if (o.far) {
    // the highway's traffic: no colliders, the flashers in the level's blink bucket so the sets keep step
    if (o.hazard) for (const s of [1, -1]) { B.add('blinkA', box(0.04, 0.12, 0.2), { m: M(-h - 0.01, t.tailY - 0.13, s * (hw - 0.1)) }); B.add('blinkA', box(0.04, 0.1, 0.16), { m: M(h + 0.01, t.hoodF - 0.16, s * (hw - 0.1)) }); }
    const handle = registerVehicle(B, { kind: 'car', id: o.id, far: true, build: () => carMeshes(t, o, FAR) });
    return Object.assign(handle, { type: t });
  }

  // ---- what the level needs of a car, with or without a renderer
  const lean = o.flat ? M(0, -0.03, 0, o.flat[1] === 'r' ? 0.04 : -0.04, 0, o.flat[0] === 'f' ? -0.022 : 0.022) : new Matrix4();
  const S = carShape(t);
  B.at(lean, () => {
    const lampY = t.hoodF - 0.15, noseHW = S.half(h - 0.02);
    for (const s of [1, -1]) {
      const on = o.head && (s > 0 || o.head > 0.5);
      if (on) B.fixtures.push({ kind: 'headlight', pos: B.point(h + 0.12, lampY, s * (noseHW - 0.3)), dir: B.dir(1, -0.13, s * 0.04), level: o.head });
    }
    if (o.hazard) B.fixtures.push({ kind: 'hazard', pos: B.point(-h - 0.5, 0.75, 0) }, { kind: 'hazard', pos: B.point(h + 0.5, 0.65, 0) });
    const yb = t.belt + 0.035, yt = t.roofY - 0.075;
    const bx = (frontAt(t, yt) + rearAt(t, yt)) / 2 + (t.bed ? 0 : 0.12);
    if (o.doorAjar && o.dome) B.fixtures.push({ kind: 'dome', pos: B.point(t.cowlX - 0.5, t.belt - 0.1, -hw + 0.45) });
    if (o.shield && B.atlas) for (const s of [1, -1]) {
      if (s < 0 && o.doorAjar) continue;
      const y = (t.belt + t.sill) / 2 + 0.1;
      B.add('atlasLit', quadUV(0.4, 0.4, B.atlas.uv('sheriff')), { m: M(bx + 0.52, y, s * (S.skin(bx + 0.52, y) + 0.012), 0, s > 0 ? 0 : Math.PI, 0) });
    }
    // the story: a hand dragged down the rear door glass from inside
    if (o.story && B.decals) {
      const x = bx - 0.42, y = (yb + yt) / 2 + 0.02;
      const tum = t.tum ?? 0.3, phi = Math.atan(tum);
      const zg = -(S.skin(x, t.belt - 0.06) - 0.05 - 0.012 - tum * (y - t.belt)) + 0.016;
      B.add('uvPaintGlass', quadUV(0.3, 0.375, B.decals.uv('handprint')), { m: M(x, y, zg, phi, Math.PI, 0) });
      B.add('uvPaintGlass', quadUV(0.24, 0.3, B.decals.uv('handprint')), { m: M(x - 0.4, y - 0.03, zg, phi, Math.PI, 0.45) });
    }
  });
  standIn(B, t, o);
  B.blob(t.L + 0.9, t.W + 0.9);
  let lidM = null;
  const handle = registerVehicle(B, {
    kind: 'car', id: o.id, prop: o.prop || (o.id ? `car:${o.id}` : null), reach: t.L / 2,
    dims: { h, hw, fx: h - t.fo, belt: t.belt, lampY: t.hoodF - 0.15, tailY: t.tailY - 0.15, side: o.shotSide || (o.doorAjar ? -1 : 1) },
    build(lod) { const r = carMeshes(t, o, lod); lidM = r.lid; this.lid = r.lid; return r; },
    get lidMatrix() { return lidM; },
  });
  Object.assign(handle, { type: t });
  // ---- colliders: bonnet, cabin, boot at their own heights
  if (o.noCollide) return handle;
  const cS = o.sliceSize || 0.5;
  // No footing on a car: bonnet, roof and boot shed whoever climbs them, off the nearer flank. (They
  // were a perch no zombie could reach: a jump onto the bonnet, another onto the roof.)
  const nBefore = B.colliders.length;
  const c0 = B.point(0, 0, 0), c1 = B.point(0, 0, 1);
  const sl = Math.hypot(c1[0] - c0[0], c1[2] - c0[2]) || 1;
  const slip = { c: [c0[0], c0[2]], side: [(c1[0] - c0[0]) / sl, (c1[2] - c0[2]) / sl] };
  const mid = (t.cowlX + h) / 2;
  B.collide([mid, 0, -hw], [h, t.hoodF + 0.02, hw], 'metal', cS);
  B.collide([t.cowlX, 0, -hw], [mid, t.hoodR, hw], 'metal', cS);
  B.collide([t.rearBaseX, 0, -hw], [t.cowlX, t.belt, hw], 'metal', cS);
  B.collide([t.roofR - 0.15, t.belt, -hw + 0.1], [t.roofF + 0.25, t.roofY, hw - 0.1], 'glass', cS);
  if (-h < t.rearBaseX - 0.05) B.collide([-h, 0, -hw], [t.rearBaseX, t.deckY, hw], 'metal', cS);
  for (let i = nBefore; i < B.colliders.length; i++) B.colliders[i].slip = slip;
  return handle;
}

// For other builders (truck.js, highway.js) and the garage and clutter props: the geometry of
// one car at a level of detail, with no level side effects. o as buildCar; returns
// { body, glass, lit, wheels, plates, lid } (VBufs).
export function carGeometry(type, opts = {}, lod = MID) {
  const t = CAR_TYPES[type || 'sedan'];
  const o = { ...opts };
  o.paintRgb = o.paintRgb || rgb(typeof o.paint === 'number' ? o.paint : (CAR_PAINT[o.paint || 'paintCarA'] ?? 0x5c5a52));
  o.seed = o.seed ?? hashStr(`${type}:${o.id || ''}`);
  o.plateText = o.plate ? (PLATES[o.plate] || String(o.plate)) : null;
  return carMeshes(t, o, lod);
}

// Harness (?vehtest=): vehicles the level does not have yet, stood on the open lot south of the
// canopy for a look. 'crushed': three pressed cars stacked as the scrapyard will stack them;
// 'row': one of every type side by side. No colliders: for shots only.
setTestVehicles((name) => {
  const rec = (type, o, m) => {
    const r = { kind: 'car', zone: 'forecourt', matrix: m, occluders: [], searched: false, reach: 2.4, build: (lod) => carGeometry(type, o, lod) };
    r.handle = { setSearched() {}, setState() {} };
    return r;
  };
  if (name === 'crushed') {
    return [
      rec('sedan', { id: 'c1', paint: 'paintCarF', crushed: 0.8, rust: 0.8, dirt: 0.8 }, M(2, 0, 13, 0, 0.4, 0)),
      rec('wagon', { id: 'c2', paint: 'paintCarC', crushed: 0.85, rust: 0.9, dirt: 0.7 }, M(2.1, 0.62, 13.1, 0.02, 0.52, 0.03)),
      rec('hatch', { id: 'c3', paint: 'paintCarA', crushed: 0.75, rust: 0.7, dirt: 0.8 }, M(1.9, 1.2, 12.9, -0.03, 0.3, -0.02)),
    ];
  }
  // one type alone, the same paint and wear whichever it is (to set them side by side in pictures)
  if (CAR_TYPES[name]) return [rec(name, { id: 'solo', paint: 'paintCarE', plate: 'plateD', rust: 0.3, dirt: 0.4 }, M(-3, 0, 13.5, 0, Math.PI / 2, 0))];
  if (name === 'row') return ['sedan', 'hatch', 'suv', 'pickup', 'wagon'].map((type, i) => rec(type, { id: `row${i}`, paint: ['paintCarA', 'paintCarE', 'paintCarD', 'paintCarB', 'paintCarC'][i], plate: 'plateD', rust: 0.3, dirt: 0.4 }, M(-9 + i * 3.2, 0, 13.5, 0, Math.PI / 2, 0)));
  return [];
});
