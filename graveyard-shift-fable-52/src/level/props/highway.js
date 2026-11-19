// The dead highway above the lot: what stands tall in the jam (a coach, box vans, a panel van),
// the jam itself, and what the embankment below it has collected. Everything here is seen from
// 20 to 70 m through rain, so it is built for silhouette: rounded roof edges, wheel arches,
// glazing with pillars, mirrors and lamp clusters, in one plain vertex-coloured bucket ('vcJam',
// no depth pre-pass, never reflected) plus the emissive ones.
// Vehicle local space: +x forward, +z the right-hand (kerb) side, y = 0 the road.
import { M, box, boxUp, cyl, cylUp, extrude, rgb } from '../build.js';
import { buildCar } from './car.js';
import { VBuf, registerVehicle, panelize, gridNormals, lensPlate } from './vehicleParts.js';
import { buildTractor, buildTrailer, TRACTOR, TRAILER } from './truck.js';
import { grassGeometry, shrubGeometry } from './foliage.js';

const BODY = 'vcJam';
const BLACK = rgb(0x050506);
const GLASS = [0.012, 0.014, 0.017];
const WARM = rgb(0xffe2b0);
const AMBER = rgb(0xff8a12);
const TAIL_ON = [2.6, 0.05, 0.02], TAIL_OFF = rgb(0x4a0605);
const HEAD_OFF = rgb(0x6e7072);

const HUB = rgb(0x3a3d40);
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
// a wheel in its arch on the flank at z (side s): a dark well cut off at the sill, a rolled lip round
// it, the tyre standing in it with a dished rim and a hub (round at any distance it is seen from)
const wheel = (B, x, z, r, w = 0.3, s = 0, sill = 0.42, zf = z) => {
  B.add(BODY, cyl(r, r, w, 20).rotateX(Math.PI / 2), { m: M(x, r, z), color: BLACK });
  B.add(BODY, cyl(r * 0.6, r * 0.56, w + 0.02, 14).rotateX(Math.PI / 2), { m: M(x, r, z), color: HUB });
  B.add(BODY, cyl(r * 0.2, r * 0.2, w + 0.07, 8).rotateX(Math.PI / 2), { m: M(x, r, z), color: BLACK });
  if (!s) return;
  const ra = r + 0.085, a0 = Math.asin(Math.min(1, (sill - r) / ra)), n = 16, body = B.body;
  const c = body.vert(x, sill, s * (zf + 0.006), 0, 0, s, BLACK, [1, 0, 0, 0]);
  const rim = [], lip = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / n, cx = Math.cos(a), sy = Math.sin(a);
    rim.push(body.vert(x + cx * ra, r + sy * ra, s * (zf + 0.006), 0, 0, s, BLACK, [1, 0, 0, 0]));
    lip.push(body.vert(x + cx * ra, r + sy * ra, s * (zf + 0.03), cx * 0.5, sy * 0.5, s * 0.7, B.col, [0, 0, 0, 0]), body.vert(x + cx * (ra + 0.05), r + sy * (ra + 0.05), s * (zf + 0.004), cx * 0.8, sy * 0.8, s * 0.3, B.col, [0, 0, 0, 0]));
  }
  for (let i = 0; i < n; i++) {
    if (s > 0) { body.tri(c, rim[i], rim[i + 1]); body.quad(lip[i * 2], lip[i * 2 + 1], lip[i * 2 + 3], lip[i * 2 + 2]); } else { body.tri(c, rim[i + 1], rim[i]); body.quad(lip[i * 2], lip[i * 2 + 2], lip[i * 2 + 3], lip[i * 2 + 1]); }
  }
};
// The tall vehicles of the jam are drawn by the vehicle layer like the cars round them: merged into
// the zone's one far mesh in the car material (wet clearcoat that takes the road lamps, glass that
// takes a highlight, lamp lenses). What flashes stays in the level's buckets, on its clocks.
function viaLayer(B, parts, o, lip) {
  const body = new VBuf([0.55, 0.1, 0, 0]);
  const P = {
    body, col: lip || o.color || HUB,
    add(key, geo, opts = {}) {
      if (key !== BODY) { B.add(key, geo, opts); return P; }
      const c = opts.color || HUB;
      const cls = opts.cls ?? (c === GLASS ? 4 : c === BLACK ? 1 : c === HUB ? 2 : c === HEAD_OFF || c === TAIL_OFF ? 8 : 0);
      body.add(geo, { color: c, a: [cls, opts.emis || 0, 0, 0] }, opts.m || null);
      return P;
    },
  };
  parts(P, o);
  return registerVehicle(B, { kind: 'jam', far: true, build: () => ({ body, lit: null, wheels: [], plates: [] }) });
}

// A body lofted for the far traffic, the way the cars' are: a cross-section (flank leaning in above
// the belt, a rolled shoulder, a crowned top) swept along stations [x, T, bow] where T is the height
// of the top line there: a screen, a nose or a tail is where T falls steeply, and the shoulder's
// roll rounds the corners of those end faces in plan. S: { st, rows (flank heights, sill first), w
// (half width), r, crown, tum, belt, roof, NR, F (top points as fractions of the half width, 0 last),
// cell(xc, c, sd, K) -> { id, color, cls, emis, vert } | null } with K = { nr, NR }: cells c <
// nr - 1 are flank rows, nr - 1 the cant rail, then NR of roll, then the top. Returns flank(x, y).
function loft(body, S) {
  const { st, rows, NR = 3, F = [0.5, 0] } = S;
  const nr = rows.length, H = nr + NR + 1 + F.length, ny = 2 * H - 1, nx = st.length;
  const P = new Float32Array(nx * ny * 3);
  const flank = (y) => S.w * (1 - S.tum * Math.min(1, Math.max(0, (y - S.belt) / (S.roof - S.belt))) ** 2);
  for (let i = 0; i < nx; i++) {
    const [x, T, bow = 0] = st[i];
    const r = Math.min(S.r, Math.max(0.015, (T - rows[0]) * 0.45)), top = Math.max(rows[0], T - r);
    const half = [];
    for (let k = 0; k < nr; k++) { const y = Math.min(rows[k], top); half.push([flank(y), y, 0]); }
    const flat = flank(top) - r, crown = S.crown * sm(S.roof - 0.5, S.roof - 0.1, T);
    for (let a = 0; a <= NR; a++) { const th = (a / NR) * Math.PI * 0.5; half.push([flat + r * Math.cos(th), top + r * Math.sin(th), bow * 0.2 * Math.sin(th)]); }
    for (const f of F) half.push([flat * f, T + crown * (1 - f * f), bow * (0.2 + 0.8 * (1 - f * f))]);
    for (let j = 0; j < ny; j++) {
      const q = half[j < H ? j : ny - 1 - j], k = (i * ny + j) * 3;
      P[k] = x + q[2]; P[k + 1] = q[1]; P[k + 2] = j < H ? -q[0] : q[0];
    }
  }
  const grid = gridNormals({ nx, ny, P }, -1);
  const K = { nr, NR, H };
  panelize(grid, (i, j) => {
    const c = j < H - 1 ? j : ny - 2 - j, sd = j < H - 1 ? -1 : 1;
    const q = S.cell((st[i][0] + st[i + 1][0]) / 2, c, sd, K, i);
    if (!q) return null;
    const cls = q.cls ?? 0;
    return { id: q.id, buf: body, st: { color: q.color, a: [cls, q.emis || 0, 0, 0] }, vert: q.vert ? (vi, vj) => q.vert(P[(vi * ny + vj) * 3], P[(vi * ny + vj) * 3 + 1]) : undefined, inset: cls === 4 ? 0.006 : 0 };
  });
  return (x, y) => flank(y);
}
// a lamp on an end face: a ribbed lens in a dark surround; lit, the lens is the level's glow
const lamp = (B, on, m, w, h, color, off, pw = 5) => {
  B.add(BODY, box(0.02, h + 0.04, w + 0.04, 0.008, 1), { m: m.clone().multiply(M(-0.006, 0, 0)), color: BLACK });
  if (on) B.add('vcGlow', lensPlate(w, h, 4, w >= h ? 'z' : 'y', 0.012, 0.002, pw), { m: m.clone().multiply(M(0.006, 0, 0)), color });
  else B.add(BODY, lensPlate(w, h, 4, w >= h ? 'z' : 'y', 0.012, 0.002, pw), { m: m.clone().multiply(M(0.006, 0, 0)), color: off });
};
const FRONT = (x, y, z) => M(x, y, z), REAR = (x, y, z) => M(x, y, z, 0, Math.PI, 0);
const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// hazard flasher: an amber lens in one of the blink buckets, big enough to read across the lot
const flasher = (B, key, x, y, z, along) => { if (key) B.add(key, box(along ? 0.26 : 0.05, 0.17, along ? 0.05 : 0.26), { m: M(x, y, z) }); };

// A touring coach. o: { color, lit: [radiance per pane, 0 = dark], doorOpen, hazard (blink bucket), tail, head }
export const buildCoach = (B, o = {}) => viaLayer(B, coachParts, o);
function coachParts(B, o) {
  const L = 12.2, W = 2.5, H = 3.5, h = L / 2, hw = W / 2, wr = 0.5, fx = h - 2.7, rx = -h + 3.1;
  const col = o.color || rgb(0x4a5258), dark = dim(col, 0.35), lit = o.lit || [];
  const xb0 = -h + 0.75, xb1 = h - 1.6, panes = 8, pitch = (xb1 - xb0) / panes, y0 = 1.74, y1 = 2.84;
  const dx0 = xb1 + 0.05, dx1 = h - 0.6; // the door, kerb side at the front
  const st = [[-h + 0.03, 0.5], [-h, 0.8], [-h, 1.25], [-h + 0.015, 1.95], [-h + 0.07, 2.9], [-h + 0.2, 3.3], [-h + 0.45, 3.46], [xb0 - 0.05, H]];
  for (let i = 0; i < panes; i++) st.push([xb0 + i * pitch + 0.05, H], [xb0 + (i + 1) * pitch - 0.05, H]);
  st.push([dx0, H], [dx1, 3.47], [h - 0.38, 3.34, 0.02], [h - 0.3, 3.0, 0.06], [h - 0.1, 1.78, 0.13], [h - 0.05, 1.5, 0.14], [h - 0.04, 1.05, 0.13], [h - 0.06, 0.72, 0.11], [h - 0.12, 0.5, 0.08]);
  const paneOf = (xc) => { const k = (xc - xb0) / pitch, i = Math.floor(k); return k > 0 && i < panes && Math.abs(k - i - 0.5) < 0.5 - 0.06 / pitch ? i : -1; };
  const glow = (k) => ({ id: 'g', cls: 4, emis: 1, color: WARM, vert: (x, y) => { const q = 0.16 + 0.84 * sm(y0 + 0.2, y1, y); return { color: [WARM[0] * k * q, WARM[1] * k * q * 0.93, WARM[2] * k * q * 0.8], a: [4, 1, 0, 0] }; } });
  const flank = loft(B.body, {
    st, rows: [0.42, 0.95, 1.5, y0, 2.3, y1], w: hw, r: 0.26, crown: 0.07, tum: 0.05, belt: 1.5, roof: H, NR: 3, F: [0.62, 0.3, 0.02, 0],
    cell(xc, c, sd, K) {
      const topC = c >= K.nr + K.NR, end = xc < xb0 - 0.05 ? -1 : xc > dx1 ? 1 : 0;
      if (end < 0) { // the tail: engine grille, the rear window over it
        if (topC && c < K.H - 2 + 1 && xc < -h + 0.05 && xc > -h + 0.005) return { id: 'eng', color: BLACK, cls: 1 };
        if (topC && xc > -h + 0.03 && xc < -h + 0.14) return { id: 'rw', color: GLASS, cls: 4 };
        return { id: 'body', color: col };
      }
      if (end > 0) { // the nose: the blind over a deep screen split by a centre bar
        if (topC && xc > h - 0.36 && xc < h - 0.3) return c === K.H - 2 ? { id: 'body', color: col } : { id: 'blind', color: dim(AMBER, 1.5), cls: 4, emis: 1 };
        if (topC && xc > h - 0.3 && xc < h - 0.09) return c === K.H - 2 ? { id: 'bar', color: BLACK, cls: 1 } : { id: 'ws', color: GLASS, cls: 4 };
        return { id: 'body', color: col };
      }
      if (c >= K.nr - 1) return { id: 'roof', color: col };
      if (xc > dx0 && xc < dx1) { // the door on the kerb side, the driver's window on the other
        if (sd > 0) return o.doorOpen ? (c <= 4 ? null : { id: 'body', color: col }) : (c >= 1 && c <= 4 ? { id: 'doorg', color: GLASS, cls: 4 } : { id: 'body', color: col });
        return c >= 3 && c <= 4 ? { id: 'dw', color: GLASS, cls: 4 } : { id: 'body', color: col };
      }
      if (c === 2) return { id: 'waist', color: dark };
      if (c >= 3) { const pn = paneOf(xc); return pn < 0 ? { id: 'post', color: dim(col, 0.5) } : (lit[pn] > 0 ? glow(lit[pn]) : { id: 'g0', color: GLASS, cls: 4 }); }
      return { id: 'low', color: col };
    },
  });
  B.add(BODY, boxUp(L - 1.4, 0.5, W - 0.5), { m: M(0, 0.22, 0), color: BLACK });
  for (const s of [1, -1]) {
    const zf = s * hw;
    wheel(B, fx, s * (hw - 0.17), wr, 0.3, s, 0.42, hw); wheel(B, rx, s * (hw - 0.2), wr, 0.38, s, 0.42, hw); wheel(B, rx - 1.25, s * (hw - 0.17), wr, 0.3, s, 0.42, hw);
    // luggage bay doors as shut lines under the waist, a bright strip along the sill
    for (const x of [-1.6, 0.1, 1.8]) B.add(BODY, box(0.02, 0.5, 0.012), { m: M(x, 1.14, s * (hw + 0.004)), color: BLACK });
    B.add(BODY, box(4.6, 0.012, 0.012), { m: M(0.1, 0.9, s * (hw + 0.004)), color: BLACK });
    // what the saloon lights are seen past: seat backs with rounded head restraints, a curtain drawn part way
    for (let i = 0; i < panes; i++) {
      if (!(lit[i] > 0)) continue;
      const xc = xb0 + (i + 0.5) * pitch, zz = (y) => s * (flank(xc, y) + 0.004);
      B.add(BODY, box(pitch - 0.1, 0.16, 0.012), { m: M(xc, y0 + 0.08, zz(y0 + 0.08)), color: BLACK });
      for (const dx of [-0.33, 0.27]) B.add(BODY, cyl(0.12, 0.12, 0.012, 10).rotateX(Math.PI / 2), { m: M(xc + dx, y0 + 0.21, zz(y0 + 0.2), 0, 0, 0, 1, 1.25, 1), color: BLACK });
      if (i % 3 === 1) B.add(BODY, box(0.3, y1 - y0 - 0.02, 0.012), { m: M(xc + pitch / 2 - 0.22, (y0 + y1) / 2, zz(2.3), s * 0.045, 0, 0), color: [0.035, 0.02, 0.014] });
    }
    // mirror on its arm, drooping from the roof corner
    B.add(BODY, box(0.5, 0.045, 0.045), { m: M(h - 0.12, H - 0.72, s * (hw + 0.06), 0, s * -0.5, 0), color: BLACK });
    B.add(BODY, box(0.07, 0.46, 0.24, 0.02, 1), { m: M(h + 0.1, H - 0.98, s * (hw + 0.18)), color: BLACK });
    // lamps: twin head lamps low on the nose, a tall cluster at each rear corner, markers at the roof ends
    lamp(B, o.head, FRONT(h + 0.07, 0.98, s * 0.92), 0.36, 0.15, rgb(0xfff0d0, 40 * (o.head || 0)), HEAD_OFF);
    lamp(B, o.tail, REAR(-h - 0.005, 1.32, s * 1.0), 0.17, 0.5, TAIL_ON, TAIL_OFF);
    B.add('vcGlow', box(0.1, 0.045, 0.03), { m: M(h - 1.1, H - 0.1, s * (hw - 0.16)), color: dim(AMBER, 3) });
    B.add('vcGlow', box(0.1, 0.045, 0.03), { m: M(-h + 0.5, H - 0.12, s * (hw - 0.16)), color: [3, 0.06, 0.03] });
    flasher(B, o.hazard, h + 0.07, 0.98, s * 1.16); flasher(B, o.hazard, -h - 0.03, 1.75, s * 1.02); flasher(B, o.hazard, 0.4, 1.62, zf + s * 0.02, true);
  }
  // bumpers wrapped round both ends, wipers parked on the screen
  B.add(BODY, box(0.2, 0.3, W - 0.06, 0.09, 2), { m: M(h + 0.02, 0.58, 0), color: BLACK });
  B.add(BODY, box(0.16, 0.26, W - 0.06, 0.08, 2), { m: M(-h + 0.02, 0.58, 0), color: BLACK });
  for (const z of [-0.5, 0.56]) B.add(BODY, box(0.012, 0.02, 0.8), { m: M(h + 0.09, 1.86, z, 0.4, 0, 0), color: BLACK });
  // roof: the air-conditioning pod, two hatches
  B.add(BODY, box(2.4, 0.2, 1.5, 0.09, 2), { m: M(-1.6, H + 0.12, 0), color: dim(col, 0.7) });
  for (const x of [1.6, 3.6]) B.add(BODY, box(0.7, 0.06, 0.7, 0.02, 1), { m: M(x, H + 0.075, 0), color: dim(col, 0.6) });
  // the door: folded open on the stairwell, its light on; or shut, as lines
  if (o.doorOpen) {
    const zz = hw - 0.3;
    B.add(BODY, box(dx1 - dx0, 2.5, 0.02), { m: M((dx0 + dx1) / 2, 1.7, zz), color: [0.05, 0.045, 0.04], cls: 3, emis: 0.42 }); // the stairwell's far wall, lit
    B.add(BODY, box(0.035, 1.5, 0.03), { m: M((dx0 + dx1) / 2 + 0.1, 1.9, zz + 0.2, 0, 0, 0.5), color: BLACK }); // the handrail up the steps
    for (let k = 0; k < 3; k++) B.add(BODY, box(dx1 - dx0 - 0.04, 0.03, 0.3), { m: M((dx0 + dx1) / 2, 0.5 + k * 0.26, hw - 0.14 - k * 0.07), color: [0.05, 0.045, 0.04], cls: 3, emis: 0.5 });
    for (const x of [dx0 + 0.02, dx1 - 0.02]) { B.add(BODY, box(0.045, 2.4, 0.42), { m: M(x, 1.7, hw + 0.19), color: col }); B.add(BODY, box(0.05, 1.1, 0.3), { m: M(x, 2.2, hw + 0.19), color: GLASS }); }
  } else for (const x of [dx0, (dx0 + dx1) / 2, dx1]) B.add(BODY, box(0.02, 2.4, 0.012), { m: M(x, 1.7, hw + 0.004), color: BLACK });
}

// A rigid box van: a forward cab and a cargo box on a chassis.
// o: { len, h, color (box), cab (colour), stripe, hazard, tail, head, rearOpen }
export const buildBoxVan = (B, o = {}) => viaLayer(B, boxVanParts, o, o.cab || o.color || rgb(0x6f6c62));
function boxVanParts(B, o) {
  const L = o.len ?? 8.2, H = o.h ?? 3.5, h = L / 2, W = 2.44, cw = 2.16, chw = cw / 2;
  const bc = o.color || rgb(0x6f6c62), cab = o.cab || bc;
  const fx = h - 1.2, rx = -h + 1.95, wr = 0.43, sill = 0.56;
  // the cab: a short sloping bonnet under a deep raked screen, the roof crowned, every corner rolled
  const st = [[h - 2.2, 2.52], [h - 1.5, 2.52], [h - 1.12, 2.49], [h - 1.02, 2.42, 0.02], [h - 0.56, 1.6, 0.07], [h - 0.46, 1.5, 0.08], [h - 0.1, 1.38, 0.08], [h - 0.03, 1.22, 0.07], [h - 0.02, 0.86, 0.06], [h - 0.07, 0.6, 0.04]];
  const flank = loft(B.body, {
    st, rows: [sill, 1.0, 1.36, 1.66, 2.0, 2.3], w: chw, r: 0.15, crown: 0.05, tum: 0.07, belt: 1.5, roof: 2.52, NR: 3, F: [0.5, 0.03, 0],
    cell(xc, c, sd, K) {
      const topC = c >= K.nr + K.NR;
      if (topC && xc > h - 1.02 && xc < h - 0.56) return c === K.H - 2 ? { id: 'bar', color: cab } : { id: 'ws', color: GLASS, cls: 4 };
      if (topC && xc > h - 0.03) return xc > h - 0.045 + 0.02 ? { id: 'nose', color: cab } : { id: 'grille', color: BLACK, cls: 1 };
      if (c >= 3 && c <= 4 && xc > h - 2.0 && xc < h - 1.12) return { id: 'dw', color: GLASS, cls: 4 };
      return { id: 'cab', color: cab };
    },
  });
  B.add(BODY, box(0.03, 0.34, 1.3, 0.01, 1), { m: M(h + 0.045, 1.04, 0), color: BLACK }); // grille
  for (const s of [1, -1]) {
    for (const x of [h - 2.06, h - 1.06]) B.add(BODY, box(0.02, 1.5, 0.012), { m: M(x, 1.42, s * (chw + 0.004)), color: BLACK }); // door shuts
    B.add(BODY, box(0.34, 0.035, 0.035), { m: M(h - 0.98, 2.2, s * (chw + 0.1)), color: BLACK });
    B.add(BODY, box(0.06, 0.38, 0.19, 0.02, 1), { m: M(h - 0.86, 2.05, s * (chw + 0.24)), color: BLACK });
    lamp(B, o.head, FRONT(h + 0.045, 1.02, s * 0.8), 0.3, 0.15, rgb(0xfff0d0, 40 * (o.head || 0)), HEAD_OFF);
    wheel(B, fx, s * (chw - 0.14), wr, 0.3, s, sill, chw); wheel(B, rx, s * (W / 2 - 0.26), wr, 0.44);
    // mudguard over the rear pair, marker lamps along the bottom rail
    const guard = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); guard.push([rx + Math.cos(a) * 0.6, wr + Math.sin(a) * 0.56]); }
    for (let i = 12; i >= 0; i--) { const a = Math.PI * (i / 12); guard.push([rx + Math.cos(a) * 0.54, wr + Math.sin(a) * 0.5]); }
    B.add(BODY, extrude(guard, 0.5, { bevel: 0.02, bevelSeg: 1 }), { m: M(0, 0, s * (W / 2 - 0.26)), color: BLACK });
    for (let i = 0; i < 3; i++) B.add('vcGlow', box(0.1, 0.045, 0.03), { m: M(-h + 0.5 + (i * (L - 3.2)) / 2, 1.12, s * (W / 2 + 0.01)), color: dim(AMBER, 3) });
    lamp(B, o.tail, REAR(-h - 0.012, 0.98, s * 0.95), 0.34, 0.14, TAIL_ON, TAIL_OFF);
    flasher(B, o.hazard, -h - 0.03, 1.2, s * 0.98); flasher(B, o.hazard, h + 0.06, 1.02, s * 1.04); flasher(B, o.hazard, h - 1.9, 1.3, s * (chw + 0.02), true);
    if (o.stripe) B.add(BODY, box((L - 2.25) * 0.78, 0.42, 0.012), { m: M(-h + (L - 2.25) / 2, 2.1, s * (W / 2 + 0.004)), color: o.stripe });
  }
  B.add(BODY, box(0.2, 0.26, cw + 0.06, 0.08, 2), { m: M(h + 0.0, 0.62, 0), color: BLACK });
  for (const z of [-0.45, 0.5]) B.add(BODY, box(0.012, 0.02, 0.6), { m: M(h - 0.5, 1.64, z, 0.4, 0, 0), color: BLACK }); // wipers
  // the box: rounded along every edge, bright corner rails, a wind deflector over the cab, chassis rails under it
  const bl = L - 2.25;
  B.add(BODY, box(bl, H - 1.05, W, 0.07, 2), { m: M(-h + bl / 2, (1.05 + H) / 2, 0), color: bc });
  for (const s of [1, -1]) { B.add(BODY, box(bl - 0.1, 0.07, 0.03), { m: M(-h + bl / 2, H - 0.06, s * (W / 2 - 0.004)), color: HUB }); B.add(BODY, box(bl - 0.1, 0.09, 0.03), { m: M(-h + bl / 2, 1.1, s * (W / 2 - 0.004)), color: HUB }); }
  {
    const d = [[h - 2.22, 2.55]];
    for (let i = 0; i <= 7; i++) { const a = (i / 7) * Math.PI * 0.5; d.push([h - 2.22 + 0.85 * Math.cos(a), 2.55 + Math.min(0.8, H - 2.62) * Math.sin(a)]); }
    B.add(BODY, extrude(d, cw - 0.3, { bevel: 0.04, bevelSeg: 2 }), { color: cab });
  }
  B.add(BODY, box(bl - 0.3, 0.38, 1.1), { m: M(-h + bl / 2, 0.86, 0), color: BLACK });
  B.add(BODY, box(0.08, 0.1, W - 0.1), { m: M(-h + 0.06, 0.6, 0), color: BLACK }); // under-run bar
  for (const z of [-0.7, 0.7]) B.add(BODY, box(0.06, 0.45, 0.06), { m: M(-h + 0.08, 0.82, z), color: BLACK });
  // rear: roller door in its frame, slats, the pull strap; or run half up on what is left inside
  const up = o.rearOpen ? 1.25 : 0;
  B.add(BODY, box(0.02, H - 1.3 - up, W - 0.24), { m: M(-h - 0.006, (1.15 + up + H - 0.15) / 2, 0), color: dim(bc, 0.8) });
  for (let y = 1.3 + up; y < H - 0.3; y += 0.24) B.add(BODY, box(0.012, 0.022, W - 0.26), { m: M(-h - 0.018, y, 0), color: BLACK });
  if (up) {
    B.add(BODY, box(0.02, up, W - 0.24), { m: M(-h + 0.01, 1.15 + up / 2, 0), color: BLACK });
    for (const z of [-0.6, 0.15]) B.add(BODY, boxUp(0.5, 0.45, 0.6), { m: M(-h + 0.3, 1.15, z), color: rgb(0x8a6a42, 0.5) });
  }
  for (const z of [-0.5, 0, 0.5]) B.add('vcGlow', box(0.03, 0.045, 0.1), { m: M(-h - 0.01, H - 0.1, z), color: [3, 0.06, 0.03] });
}

// A panel van: one volume, short nose. o: { color, hazard, tail, head, bars }
export const buildPanelVan = (B, o = {}) => viaLayer(B, panelVanParts, o);
function panelVanParts(B, o) {
  const L = 5.5, W = 1.98, H = 2.4, h = L / 2, hw = W / 2, wr = 0.36, fx = h - 0.95, rx = -h + 1.15, sill = 0.43;
  const col = o.color || rgb(0xcfd0cb);
  const st = [[-h + 0.04, 0.5], [-h, 0.72], [-h, 1.05], [-h + 0.01, 1.48], [-h + 0.06, 2.08], [-h + 0.16, 2.3], [-h + 0.45, H], [-0.9, H], [h - 2.38, H], [h - 1.6, H - 0.02], [h - 1.44, H - 0.08, 0.02], [h - 1.36, H - 0.16, 0.03], [h - 0.66, 1.36, 0.1], [h - 0.56, 1.27, 0.1], [h - 0.14, 1.13, 0.1], [h - 0.05, 0.97, 0.09], [h - 0.04, 0.68, 0.07], [h - 0.1, 0.5, 0.04]];
  const flank = loft(B.body, {
    st, rows: [sill, 0.8, 1.2, 1.44, 1.76, 2.06], w: hw, r: 0.17, crown: 0.05, tum: 0.07, belt: 1.3, roof: H, NR: 3, F: [0.5, 0.03, 0],
    cell(xc, c, sd, K) {
      const topC = c >= K.nr + K.NR;
      if (topC && xc > h - 1.36 && xc < h - 0.66) return { id: 'ws', color: GLASS, cls: 4 };
      if (topC && xc < -h + 0.06 && xc > -h + 0.005) return c === K.H - 2 ? { id: 'rear', color: col } : { id: 'rw', color: GLASS, cls: 4 };
      if (topC && xc > h - 0.05) return { id: 'grille', color: BLACK, cls: 1 };
      if (c >= 3 && c <= 4 && xc > h - 2.38 && xc < h - 1.44) return { id: 'dw', color: GLASS, cls: 4 };
      return { id: 'body', color: col };
    },
  });
  B.add(BODY, boxUp(L - 0.9, 0.4, W - 0.4), { m: M(0, 0.2, 0), color: BLACK });
  for (const s of [1, -1]) {
    wheel(B, fx, s * (hw - 0.13), wr, 0.24, s, sill, hw); wheel(B, rx, s * (hw - 0.13), wr, 0.24, s, sill, hw);
    for (const x of [h - 2.42, h - 1.38, -h + 0.5]) B.add(BODY, box(0.018, 1.7, 0.012), { m: M(x, 1.35, s * (hw + 0.004)), color: BLACK }); // door shuts, the slider's track
    B.add(BODY, box(h - 2.42 + h - 0.5, 0.018, 0.012), { m: M((h - 2.42 - h + 0.5) / 2, 1.42, s * (hw + 0.004)), color: BLACK });
    B.add(BODY, box(0.2, 0.03, 0.03), { m: M(h - 1.4, 1.74, s * (flank(0, 1.74) + 0.06)), color: BLACK });
    B.add(BODY, box(0.06, 0.26, 0.17, 0.02, 1), { m: M(h - 1.34, 1.68, s * (hw + 0.17)), color: BLACK });
    lamp(B, o.head, FRONT(h + 0.05, 0.9, s * 0.68), 0.3, 0.15, rgb(0xfff0d0, 40 * (o.head || 0)), HEAD_OFF);
    lamp(B, o.tail, REAR(-h - 0.012, 1.45, s * (hw - 0.14)), 0.11, 0.5, TAIL_ON, TAIL_OFF);
    flasher(B, o.hazard, -h - 0.03, 1.05, s * (hw - 0.16)); flasher(B, o.hazard, h + 0.06, 0.9, s * 0.92);
  }
  B.add(BODY, box(0.18, 0.22, W + 0.02, 0.07, 2), { m: M(h + 0.0, 0.55, 0), color: BLACK });
  B.add(BODY, box(0.14, 0.2, W + 0.02, 0.06, 2), { m: M(-h + 0.01, 0.55, 0), color: BLACK });
  for (const z of [-0.4, 0.45]) B.add(BODY, box(0.012, 0.02, 0.55), { m: M(h - 0.6, 1.41, z, 0.4, 0, 0), color: BLACK }); // wipers
  if (o.bars) for (const x of [-1.6, -0.2, 1.0]) { B.add(BODY, box(0.05, 0.05, W - 0.1), { m: M(x, H + 0.17, 0), color: BLACK }); for (const s of [1, -1]) B.add(BODY, box(0.04, 0.16, 0.04), { m: M(x, H + 0.09, s * (W / 2 - 0.24)), color: BLACK }); }
  if (o.bars) B.add(BODY, box(3.2, 0.04, 0.34), { m: M(-0.3, H + 0.22, 0.3), color: rgb(0x8a8f92) }); // a ladder, strapped down
}

// ---- the jam ------------------------------------------------------------------------------------
// hw: { y, z0, z1 } the deck. Near carriageway (toward the lot) runs west, the far one east.
// Hazard groups: 'blinkC' and 'blinkD' flash on their own clocks (the level drives them), so no
// two sets on the road keep step. Fixtures pushed: hazardFar (one per flashing vehicle, kerb side,
// so the amber carries in the rain) and headlightFar (the car left on the shoulder with its lights on).
export function buildJam(B, rng, hw) {
  const y = hw.y - 0.08;
  const lane = [hw.z0 + 2.4, hw.z0 + 5.5], farLane = [hw.z1 - 2.4, hw.z1 - 5.5];
  const W = Math.PI; // westbound
  const at = (x, z, ry, fn) => B.at(M(x, y, z, 0, ry, 0), fn);
  const TYPES = ['sedan', 'hatch', 'suv', 'wagon', 'pickup', 'sedan', 'suv'];
  const car = (x, z, ry, o = {}) => at(x, z, ry, () => buildCar(B, { type: o.type || rng.pick(TYPES), colour: o.colour ?? rng.int(0, 6), far: true, ...o }));
  const hazardAt = (x, z, group) => B.fixtures.push({ kind: 'hazardFar', pos: [x, y + 1.1, z], group });

  // ---- what stands tall, west to east along the near lanes
  at(-33, lane[0] + 0.1, W + 0.04, () => buildBoxVan(B, { len: 9.2, h: 3.7, color: rgb(0x6f6c62), cab: rgb(0x7a1410), stripe: rgb(0x7a1410, 0.6), tail: true }));
  at(-17.5, lane[1] - 0.2, W - 0.05, () => buildPanelVan(B, { color: rgb(0x9a9c98), bars: true }));
  // the coach: saloon lights still on, door folded open, flashers going
  at(-1.5, lane[0], W - 0.025, () => buildCoach(B, { color: rgb(0x55606a), lit: [0.26, 0.22, 0.07, 0, 0.26, 0.24, 0.2, 0.08], doorOpen: true, hazard: 'blinkD' }));
  hazardAt(-7.6, lane[0] - 1.3, 'D'); hazardAt(4.6, lane[0] - 1.3, 'D');
  at(13.2, lane[1] + 0.1, W + 0.03, () => buildBoxVan(B, { len: 7.6, h: 3.4, color: rgb(0x2c4a66), cab: rgb(0xcfd0cb), rearOpen: true }));
  // the jack-knife: an artic folded across both near lanes, cab against the rail, flashers going
  {
    const Q = { ...B, collide() { return Q; }, shelter() { return Q; }, refl() { return Q; }, blob() { return Q; }, fixtures: [] };
    const tx = 31.5, tz = (lane[0] + lane[1]) / 2 + 0.3, psi = W - 0.3, fold = 1.1; // trailer across the near lanes, cab swung round into the median
    Q.at(M(tx, y, tz, 0, psi, 0), () => buildTrailer(Q, { doorOpen: 0, far: true, id: 'jam-trailer' }));
    const kx = tx + Math.cos(psi) * TRAILER.kingpinX, kz = tz - Math.sin(psi) * TRAILER.kingpinX, ty = psi + fold;
    Q.at(M(kx - Math.cos(ty) * TRACTOR.fifthX, y, kz + Math.sin(ty) * TRACTOR.fifthX, 0, ty, 0), () => {
      buildTractor(Q, { paint: 'paintCarC', doorAjar: 1.1, cabLight: 0.8, far: true, id: 'jam-tractor' });
      for (const s of [1, -1]) { flasher(B, 'blinkC', 3.8, 1.5, s * 0.98); flasher(B, 'blinkC', -1.0, 2.2, s * 1.2, true); }
    });
    Q.at(M(tx, y, tz, 0, psi, 0), () => { for (const s of [1, -1]) { flasher(B, 'blinkC', -TRAILER.L / 2 - 0.03, 1.5, s * 0.98); flasher(B, 'blinkC', 0, 1.42, s * (TRAILER.W / 2 + 0.03), true); } });
    hazardAt(tx + 4.6, tz - 1.2, 'C'); hazardAt(kx - 1.5, kz - 1.6, 'C');
  }
  at(47, lane[0] + 0.2, W - 0.06, () => buildBoxVan(B, { len: 8.6, h: 3.8, color: rgb(0xcfd0cb), cab: rgb(0x1b3f40), stripe: rgb(0x1b3f40, 0.7), hazard: 'blinkD', tail: true }));
  hazardAt(51.2, lane[0] - 1.2, 'D');
  at(-52, lane[1], W + 0.04, () => buildBoxVan(B, { len: 8.4, h: 3.6, color: rgb(0x54504a) }));
  at(63, lane[1] + 0.2, W + 0.02, () => buildPanelVan(B, { color: rgb(0x1c2a44), tail: true }));

  // ---- cars. The near lane is seen from the lot: lofted bodies, placed by hand so the gaps and
  // the beats are where they tell. [x, lane, yaw offset, options]
  const near = [
    [-62, 0, 0.03, {}], [-55.5, 0, -0.05, { tail: true }], [-46, 0, 0.02, {}], [-40.4, 0, 0.1, { dome: 0.9 }],
    [-25.8, 0, -0.04, {}], [-20.2, 0, 0.06, { hazard: true, tail: true }], [-13.4, 0, -0.3, { doorOpen: 1 }], // pulled out to pass, got nowhere
    [7.6, 0, 0.05, { tail: true }], [13.4, 0, -0.02, { dome: 0.7, doorOpen: 1 }], [18.6, 0, 0.12, {}],
    [41.0, 0, -0.08, { tail: true }], [54.6, 0, 0.04, { head: 0.45 }], [60.2, 0, -0.03, { hazard: true }], [67.5, 0, 0.05, { head: 0.6, dome: 0.8 }], [74, 0, 0, {}], [82, 0, 0.04, { head: 0.3 }],
    [-45, 1, 0.04, {}], [-39, 1, -0.06, { tail: true }], [-27, 1, 0.03, {}], [-9.5, 1, 0.08, { tail: true }], [-3.2, 1, -0.04, {}], [3.4, 1, 0.05, { dome: 0.8 }],
    [43.5, 1, 0.07, { head: 0.5 }], [50.2, 1, -0.03, { tail: true }], [57, 1, 0.02, { head: 0.35 }], [70.5, 1, -0.05, {}], [79, 1, 0.03, { head: 0.6 }],
  ];
  for (const [x, l, dy, o] of near) car(x + rng.range(-0.5, 0.5), lane[l] + rng.range(-0.35, 0.35), W + dy, { loft: l === 0 || !!o.dome || !!o.doorOpen, ...o });
  // one that tried the shoulder and stopped against the rail, lights still burning down the bank
  {
    const x = 9.6, z = hw.z0 + 0.95, ry = W - 0.62;
    car(x, z, ry, { type: 'sedan', colour: 1, loft: true, head: 0.7, doorOpen: 1, dome: 0.8 });
    const fwd = [Math.cos(ry), -Math.sin(ry)];
    B.fixtures.push({ kind: 'headlightFar', pos: [x + fwd[0] * 2.2, y + 0.72, z + fwd[1] * 2.2], dir: [fwd[0], -0.2, fwd[1]] });
  }
  // the far carriageway: only roofs and lamps show over the near lanes, so the cheap bodies do
  let n = 0;
  for (const z of farLane) {
    let x = -62 + rng.range(0, 6);
    while (x < 78) {
      if (rng.next() > 0.28) { car(x, z + rng.range(-0.4, 0.4), rng.range(-0.12, 0.12), { tail: n % 5 === 1, hazard: n % 7 === 3, head: n % 9 === 4 ? 0.6 : 0 }); n++; }
      x += rng.range(5.6, 9.5);
    }
  }
}

// ---- the embankment -----------------------------------------------------------------------------
// ground(x, z) -> terrain height. What a verge collects: rank grass, a drain at the toe, marker
// posts, rubbish thrown from windows, a chevron board somebody took out on the way down.
export function buildEmbankment(B, rng, hw, ground, drives) {
  const onDrive = (x, pad = 0.6) => drives.some((d) => x > d[0] - pad && x < d[1] + pad);
  const toe = 23.8, crest = hw.z0 - 0.7;
  // grass: tufts all over the bank, taller and thicker toward the toe where the water goes
  for (let i = 0; i < 900; i++) {
    const x = rng.range(-42, 44), t = rng.next() ** 1.4, z = toe + (crest - toe) * t;
    if (onDrive(x, 1.0)) continue;
    B.add('uvFoliage', grassGeometry(rng, rng.range(0.7, 1.5) * (1.25 - 0.5 * t), rng.next() < 0.5 - 0.3 * t), { m: M(x, ground(x, z) - 0.03, z, 0, rng.range(0, 3), 0) });
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-40, 42), z = rng.range(toe, toe + 4.5);
    if (onDrive(x, 2.2)) continue;
    B.add('uvFoliage', shrubGeometry(rng, rng.range(0.6, 1.2)), { m: M(x, ground(x, z) - 0.05, z) });
  }
  // drainage: a concrete channel along the toe between the drives, a headwall and pipe at each end
  for (const [x0, x1] of [[-6.2, 4.2], [12.8, 22], [-22, -14.8]]) {
    const z = 24.6, len = x1 - x0, cx = (x0 + x1) / 2, gy = ground(cx, z);
    B.add('concrete', box(len, 0.1, 0.9), { m: M(cx, gy - 0.02, z) });
    for (const s of [1, -1]) B.add('concrete', box(len, 0.12, 0.42), { m: M(cx, gy + 0.1, z + s * 0.6, s * 0.5, 0, 0) });
    B.add('vcMatte', box(len - 0.3, 0.012, 0.5), { m: M(cx, gy + 0.035, z), color: [0.012, 0.014, 0.012] }); // standing water and silt
    for (const [x, s] of [[x0, -1], [x1, 1]]) {
      B.add('concrete', boxUp(0.3, 1.0, 2.0, 0.03, 1), { m: M(x + s * 0.1, gy - 0.1, z) });
      B.add('vcMatte', cyl(0.34, 0.34, 0.5, 14).rotateZ(Math.PI / 2), { m: M(x - s * 0.1, gy + 0.36, z), color: BLACK });
      B.add('paintGalv', cyl(0.36, 0.36, 0.24, 14, true).rotateZ(Math.PI / 2), { m: M(x - s * 0.2, gy + 0.36, z) });
    }
  }
  // marker posts along the shoulder above, and down both sides of each drive; reflectors that
  // still catch whatever light there is. A few lean, two are down.
  const post = (x, z, lean, red) => {
    const gy = ground(x, z);
    B.at(M(x, gy - 0.05, z, lean * 0.9, rng.range(0, 6), lean), () => {
      B.add('vcMatte', boxUp(0.1, 1.0, 0.035, 0.012, 1), { color: rgb(0xb8b6ac) });
      B.add('vcMatte', box(0.102, 0.2, 0.037), { m: M(0, 0.74, 0), color: BLACK });
      for (const s of [1, -1]) B.add('vcGlow', box(0.06, 0.12, 0.004), { m: M(0, 0.74, s * 0.02), color: red ? [0.9, 0.03, 0.02] : [0.9, 0.5, 0.08] });
    });
  };
  for (let x = -44; x < 46; x += 5.5) if (!onDrive(x, 1.4)) post(x + rng.range(-0.4, 0.4), hw.z0 - 0.55, rng.next() < 0.2 ? rng.range(0.25, 1.45) : rng.range(-0.05, 0.05), false);
  for (const [x0, x1] of drives) for (let z = 22.6; z < 31; z += 2.8) { post(x0 - 0.75, z, rng.next() < 0.25 ? 0.5 : 0.03, true); post(x1 + 0.75, z + 1.2, rng.next() < 0.25 ? -1.4 : -0.03, true); }
  // a chevron board, flattened: yellow plate, black chevrons, its two posts bent under it
  {
    const x = 2.6, z = 29.3, gy = ground(x, z), slope = Math.atan2(ground(x, z + 1) - gy, 1); // where the stranded car's headlights fall
    B.at(M(x, gy + 0.09, z, slope - 0.12, 0.5, 0.06), () => {
      B.add('vcMatte', box(1.5, 0.03, 0.62, 0.008, 1), { color: rgb(0xd7a50d, 0.8) });
      for (let i = 0; i < 3; i++) for (const s of [1, -1]) B.add('vcMatte', box(0.3, 0.008, 0.11), { m: M(-0.45 + i * 0.45 + 0.05, 0.02, s * 0.11, 0, s * 0.72, 0), color: BLACK });
      for (const px of [-0.5, 0.5]) B.add('paintGalv', box(0.06, 0.04, 2.1), { m: M(px, -0.03, 0.9, 0.08, px * 0.2, 0) });
    });
  }
  // rubbish: cups, cans, bags caught in the grass; pale things, so they find what light there is
  const PALE = [0xbdb8a8, 0x8f8a7c, 0xa02018, 0x9aa7b0, 0xd6d2c4, 0x2a4a7a].map((c) => rgb(c, 0.55));
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-40, 42), z = toe + (crest - toe) * rng.next() ** 0.7;
    if (onDrive(x, 0.2)) continue;
    const gy = ground(x, z), k = rng.next();
    if (k < 0.45) B.add('vcMatte', cylUp(0.04, 0.03, 0.11, 6), { m: M(x, gy + 0.03, z, rng.range(1.2, 1.9), rng.range(0, 6), 0), color: rng.pick(PALE) });
    else if (k < 0.8) B.add('vcMatte', box(rng.range(0.15, 0.4), 0.012, rng.range(0.12, 0.3)), { m: M(x, gy + 0.05, z, rng.range(-0.4, 0.4), rng.range(0, 6), rng.range(-0.4, 0.4)), color: rng.pick(PALE) });
    else B.add('vcMatte', box(0.3, 0.14, 0.22, 0.05, 1), { m: M(x, gy + 0.05, z, rng.range(-0.3, 0.3), rng.range(0, 6), rng.range(-0.2, 0.2)), color: rgb(rng.next() < 0.5 ? 0x5a5c58 : 0x2c2e30, 0.8) }); // a bin bag, split
  }
  // a tyre and a wheel trim, rolled down from above
  B.add('rubber', cyl(0.33, 0.33, 0.2, 14, true), { m: M(-2.8, ground(-2.8, 26.4) + 0.1, 26.4, 0.25, 0, 0.1) });
  B.add('chrome', cyl(0.2, 0.2, 0.02, 12), { m: M(15.5, ground(15.5, 27.2) + 0.04, 27.2, 0.3, 0, -0.1) });
}

// ---- what is beyond -------------------------------------------------------------------------------
// The jam going on out of sight in both directions, a gantry far down the road, a farm on the
// far hillside: small unlit points, there to say the dark is not empty.
export function buildDistantLights(B, rng, hw) {
  const y = hw.y + 0.6;
  for (const dir of [-1, 1]) {
    for (let d = 84; d < 230; d += rng.range(5, 13)) {
      const x = dir * d, far = (d - 84) / 146;
      const z = (rng.next() < 0.5 ? hw.z0 + 2.4 : hw.z0 + 5.5) + (rng.next() < 0.5 ? 0 : 6.2);
      const k = rng.next();
      if (k < 0.5) B.add('vcGlow', box(0.5, 0.22, 1.5), { m: M(x, y + far * 3, z + far * dir * 18), color: [3.5 - 2 * far, 0.05, 0.02] });
      else if (k < 0.62) B.add('vcGlow', box(0.5, 0.26, 1.5), { m: M(x, y + far * 3, z + far * dir * 18), color: rgb(0xfff0d0, 16 - 10 * far) });
      else if (k < 0.7) B.add(dir > 0 ? 'blinkC' : 'blinkD', box(0.5, 0.3, 1.7), { m: M(x, y + far * 3, z + far * dir * 18) });
    }
    // lamp heads carrying on down the road
    for (let d = 104; d < 240; d += 26) if (rng.next() < 0.7) B.add('vcGlow', box(0.9, 0.3, 0.9), { m: M(dir * d, hw.y + 10.4, hw.z1 + 3 + ((d - 84) / 146) * dir * 18), color: [B.glow.sodium[0] * 0.5, B.glow.sodium[1] * 0.5, B.glow.sodium[2] * 0.5] });
  }
  // a farm and a yard light on the hillside beyond the road
  for (const [x, yy, z, c, s] of [[-38, 15, 176, 0xffa040, 8], [-33, 14.2, 178, 0xffc070, 5], [-35.5, 16.5, 177, 0xd0e4ff, 10], [58, 21, 190, 0xffa040, 7], [84, 12, 150, 0xffd9a0, 6], [86.5, 12.4, 151, 0xffa040, 4], [12, 26, 200, 0xd0e4ff, 6]]) {
    B.add('vcGlow', box(0.7, 0.5, 0.7), { m: M(x, yy, z), color: rgb(c, s) });
  }
}
