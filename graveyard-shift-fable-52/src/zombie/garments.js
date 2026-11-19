// Clothing: separate shells cut the way the body's cages are, on the sculpt's field pushed out by an
// ease. A garment piece is a tube of rows; each vertex is where its ray meets the body, plus ease,
// then DRAPED: going down a column the cloth keeps the widest radius it has had above it (it hangs
// from the shoulders, the bust, the seat) and comes back toward the body only slowly, flares at the
// hem, and takes 1-2 cm of low folds so no outline is smooth. Edges get a turned-back row, so hems,
// cuffs and collars have thickness. Fold relief, seams, plackets, pockets and stitching are not
// geometry: they are baked per piece into the garment atlas (sculpt/bake.js) from PIECES below.
// Garments take their skin weights from the body under them, so they never part from it.
import { createRng } from '../core/rng.js';
import { march, weightsAt, evaluate } from './sculpt/sdf.js';
import { MIRROR_BONES, vec } from './sculpt/cage.js';
import { createPacker, GUTTER } from './sculpt/uv.js';
import { HEAD_C, NECK_GROUP } from './sculpt/head.js';
import { HIP, KNEE, ANKLE, ELBOW } from './sculpt/figure.js';
import { WRIST } from './sculpt/hands.js';
import { B, NB, SHOULDER } from './skeleton.js';

export const SLOT = { shirt: 0, legs: 1, boots: 2, outer: 3, hat: 4, belt: 5, under: 6, extra: 7 };
const TRUNK = 4, ARM = 8 | 2, LEG = 16, HEAD = 1;
const { norm, sub, cross } = vec;
const TAU = Math.PI * 2;
const hash = (i, j, s) => { const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); };
const vnoise = (x, y, s) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(i, j, s) * (1 - u) + hash(i + 1, j, s) * u) * (1 - v) + (hash(i, j + 1, s) * (1 - u) + hash(i + 1, j + 1, s) * u) * v;
};
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spineAt = (y) => [0, y, y > 1.255 ? lerp(-0.02, -0.026, (y - 1.255) / 0.215) : y > 1.085 ? lerp(-0.012, -0.02, (y - 1.085) / 0.17) : lerp(0, -0.012, Math.max(0, (y - 0.9) / 0.185))];
const armAt = (s) => { const a = SHOULDER, b = ELBOW, c = WRIST, l1 = 0.31; return s < l1 ? [lerp(a[0], b[0], s / l1), lerp(a[1], b[1], s / l1), lerp(a[2], b[2], s / l1)] : [lerp(b[0], c[0], (s - l1) / 0.26), lerp(b[1], c[1], (s - l1) / 0.26), lerp(b[2], c[2], (s - l1) / 0.26)]; };
const ARM_T = norm(sub(ELBOW, SHOULDER));
const legAt = (y) => (y > KNEE[1] ? [lerp(KNEE[0], HIP[0], (y - KNEE[1]) / (HIP[1] - KNEE[1])), y, lerp(KNEE[2], HIP[2], (y - KNEE[1]) / (HIP[1] - KNEE[1]))] : [lerp(ANKLE[0], KNEE[0], (y - ANKLE[1]) / (KNEE[1] - ANKLE[1])), y, lerp(ANKLE[2], KNEE[2], (y - ANKLE[1]) / (KNEE[1] - ANKLE[1]))]);

// what the garment bake needs to know about each piece: filled as pieces are cut (once)
export const PIECES = new Map();
const packer = createPacker(400);

const _out = new WeakMap();
function originOut(fig, r) { let v = _out.get(r); if (v === undefined) { v = evaluate(fig, r.o[0], r.o[1], r.o[2], r.groups) > 0; _out.set(r, v); } return v; }
// A tube of cloth. o:
//   name, slot, kind (bake fold model: 'body' | 'sleeve' | 'leg' | 'skirt' | 'flat' | 'hat'), W, H (nominal metres), bake {...}
//   rows [{ o, t, mode 'out' | 'in', rmax, groups }], angles [..], closed, ref
//   ease (i, a, f) -> metres (f = row fraction), hang 0..1, flare (f, a) -> metres, fold amplitude (metres), seed
//   weights 'body' | [[bone, w]..] | (x, y, z, i) -> weights, mirror: also emit the right side
//   hemStart / hemEnd: turn the edge back (thickness)
function piece(mesh, fig, o) {
  const rect = packer.take(o.atlas || o.name, o.W, o.H);
  if (!PIECES.has(o.atlas || o.name)) PIECES.set(o.atlas || o.name, { rect, kind: o.kind, W: o.W, H: o.H, ...(o.bake || {}) });
  const closed = o.closed !== false, nA = o.angles.length, cols = nA + (closed ? 1 : 0);
  const rows = o.rows.slice(), nR0 = rows.length;
  const P = [], BP = [], RR = [];
  const prevR = new Float64Array(nA).fill(-1);
  // the ray of column j in row r
  const rayOf = (r, a) => {
    const t = r.t, k0 = o.ref[0] * t[0] + o.ref[1] * t[1] + o.ref[2] * t[2];
    const U = norm([o.ref[0] - t[0] * k0, o.ref[1] - t[1] * k0, o.ref[2] - t[2] * k0]), V = cross(t, U);
    const ca = Math.cos(a), sa = Math.sin(a);
    // a row may tilt its rays up against the tube's axis (the yoke of a shirt fans up to the collar)
    const cl = Math.cos(r.lat || 0), sl = Math.sin(r.lat || 0);
    return [cl * (ca * U[0] + sa * V[0]) - sl * t[0], cl * (ca * U[1] + sa * V[1]) - sl * t[1], cl * (ca * U[2] + sa * V[2]) - sl * t[2]];
  };
  for (let i = 0; i < nR0; i++) {
    const r = rows[i], f = nR0 > 1 ? i / (nR0 - 1) : 0;
    const ds = i > 0 ? Math.hypot(...sub(r.o, rows[i - 1].o)) : 0;
    for (let j = 0; j < nA; j++) {
      const a = o.angles[j];
      const d = rayOf(r, a);
      if (r.rel) { P.push(null); BP.push(null); RR.push(0); continue; }       // filled in below
      let rb;
      if (r.fix !== undefined) rb = Math.max(0, r.fix - 0.012);       // a row of a set radius (closing a tube into a dome)
      else if (r.mode === 'in') {
        const h = march(fig, r.o[0] + d[0] * r.rmax, r.o[1] + d[1] * r.rmax, r.o[2] + d[2] * r.rmax, -d[0], -d[1], -d[2], r.rmax, r.groups);
        rb = h < 0 ? -1 : r.rmax - h;
      } else {
        rb = march(fig, r.o[0], r.o[1], r.o[2], d[0], d[1], d[2], r.rmax, r.groups);
        // (an origin that is itself outside the part has nothing to wrap: the row is parked)
        if (rb < 0 || (r.none !== undefined && originOut(fig, r))) rb = r.none ?? -1;
      }
      let R = rb < 0 ? -1 : rb + o.ease(i, a, f);
      // drape: never tighter than what hung above, less what the cloth is allowed to come back in
      const hang = typeof o.hang === 'function' ? o.hang(f, a) : o.hang ?? 0;
      if (prevR[j] >= 0 && !r.lat && r.fix === undefined) R = Math.max(R, prevR[j] - ds * (1 - hang) * 1.2);
      if (R < 0) R = 0.02;
      if (r.fix !== undefined) R = r.fix;
      prevR[j] = r.lat || r.fix !== undefined ? -1 : R;
      let Rf = R + (o.flare ? o.flare(f, a) : 0);
      if (o.fold) Rf += o.fold * (vnoise(a * 2.2 + (o.seed || 0), f * 3.1, o.seed || 1) - 0.45) * (o.foldGrow ? 0.35 + 0.65 * f : 1);
      let p = [r.o[0] + d[0] * Rf, r.o[1] + d[1] * Rf, r.o[2] + d[2] * Rf];
      if (o.push) p = o.push(p, d, i, a, f) || p;
      P.push(p); RR.push(Rf);
      const br = Math.max(0, rb < 0 ? 0 : rb - 0.004);
      BP.push([r.o[0] + d[0] * br, r.o[1] + d[1] * br, r.o[2] + d[2] * br]);
    }
  }
  // rel: [row, k]: a row whose radius is k times another row's, column for column (the head of a
  // sleeve is its first real ring, drawn in to a point inside the chest)
  for (let i = 0; i < nR0; i++) {
    const r = rows[i];
    if (!r.rel) continue;
    for (let j = 0; j < nA; j++) {
      const d = rayOf(r, o.angles[j]), R = RR[r.rel[0] * nA + j] * r.rel[1];
      P[i * nA + j] = [r.o[0] + d[0] * R, r.o[1] + d[1] * R, r.o[2] + d[2] * R];
      BP[i * nA + j] = [r.o[0] + d[0] * R * 0.7, r.o[1] + d[1] * R * 0.7, r.o[2] + d[2] * R * 0.7];
    }
  }
  // turned-back edge rows: a hem / cuff / collar has thickness
  const turn = (i, inward) => {
    const out = [];
    for (let j = 0; j < nA; j++) {
      const p = P[i * nA + j], b = BP[i * nA + j], q = P[(i + (inward > 0 ? 1 : -1)) * nA + j] || p;
      const n = norm(sub(p, b));
      out.push([p[0] - n[0] * 0.007 + (q[0] - p[0]) * 0.25, p[1] - n[1] * 0.007 + (q[1] - p[1]) * 0.25, p[2] - n[2] * 0.007 + (q[2] - p[2]) * 0.25]);
    }
    return out;
  };
  let grid = [], body = [], nR = nR0;
  for (let i = 0; i < nR0; i++) { grid.push(P.slice(i * nA, (i + 1) * nA)); body.push(BP.slice(i * nA, (i + 1) * nA)); }
  // 'close': the edge is carried in to the body (a collar that sits on the neck, no gap to look down)
  // (it stops 2.5 mm off the skin: a row carried INTO the neck met the neck's own facets, which are
  // cut on other columns, in a saw-tooth line)
  if (o.hemStart === 'close') { grid.unshift(BP.slice(0, nA).map((b, j) => { const p = P[j], l = Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]) || 1, k = Math.min(1, 0.0065 / l); return [b[0] + (p[0] - b[0]) * k, b[1] + (p[1] - b[1]) * k + 0.003, b[2] + (p[2] - b[2]) * k]; })); body.unshift(body[0]); nR++; }
  else if (o.hemStart) { grid.unshift(turn(0, 1)); body.unshift(body[0]); nR++; }
  if (o.hemEnd) { grid.push(turn(nR0 - 1, -1)); body.push(body[body.length - 1]); nR++; }
  const sides = o.mirror ? [1, -1] : [1];
  const g = GUTTER;
  for (const side of sides) {
    mesh.shell = typeof o.shell === 'function' ? o.shell(side) : o.shell || o.name;
    const v0 = mesh.count, ids = [];
    for (let i = 0; i < nR; i++) for (let j = 0; j < cols; j++) {
      const jj = j % nA, p = grid[i][jj], b = body[i][jj];
      const u01 = cols > 1 ? j / (cols - 1) : 0.5, v01 = nR > 1 ? i / (nR - 1) : 0.5;
      const x = p[0] * side;
      let w = o.weights;
      if (typeof w === 'function') w = w(x, p[1], p[2], i, v01);
      if (!w || w === 'body') w = weightsAt(fig, b[0] * side, b[1], b[2], MIRROR_BONES, NB) || weightsAt(fig, x, p[1], p[2], MIRROR_BONES, NB) || [[B.hips, 1]];
      ids.push(mesh.vert(x, p[1], p[2], 0, 1, 0, rect[0] + g + (rect[2] - rect[0] - 2 * g) * u01, rect[1] + g + (rect[3] - rect[1] - 2 * g) * v01, w, [u01 * o.W, v01 * o.H, 0, o.slot]));
    }
    for (let i = 0; i + 1 < nR; i++) for (let j = 0; j + 1 < cols; j++) {
      if (o.skip && o.skip(i, j, nR, cols)) continue;
      mesh.quad(ids[i * cols + j], ids[i * cols + j + 1], ids[(i + 1) * cols + j + 1], ids[(i + 1) * cols + j], (side < 0) !== !!o.flip);
    }
    mesh.computeNormals(v0, mesh.count, [mesh.shell]);
  }
}

const ringA = (n, a0 = -Math.PI) => Array.from({ length: n }, (_, i) => a0 + (i / n) * TAU);
// angles for a garment open down the front: from `gap` round the back to -gap (0 = front, +z)
const openA = (n, gap) => Array.from({ length: n }, (_, i) => gap + (i / (n - 1)) * (TAU - 2 * gap));
const DOWN = [0, -1, 0], Z = [0, 0, 1];
const trunkRows = (ys, rmax = 0.3, groups = TRUNK) => ys.map((y) => ({ o: spineAt(y), t: DOWN, mode: 'out', rmax, groups }));
const stepsY = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
// rows of a torso garment: from the collar (rays fanned up from the chest so the yoke lies on the
// shoulders) down the spine to the hem. neck: how high the fan starts (radians; lower = wider opening)
const YOKE = 1.385;
// Every torso garment is cut on the SAME rays: the same columns round the trunk (the skin cage's
// own) and the same ladder of rows, so a garment worn over another is the same surface pushed
// further out along the same rays and can never cut through it between vertices (the round-1
// white wedges at the shoulder were the vest under the shirt doing exactly that).
const FAN = [1.12, 0.92, 0.72, 0.52, 0.32, 0.13], FAN_FAR = [1.12, 0.62, 0.22];
function torsoRows(neck, hem, near, groups, cap) {
  const lats = [neck, ...(near ? FAN : FAN_FAR).filter((l) => l < neck - 0.04)];
  // cap: a garment with sleeves lies over the top of the shoulder (the deltoid is the arm's, and
  // would come through a yoke cut on the trunk alone); the sleeve head takes over below that
  const fan = lats.map((lat) => ({ o: [0, YOKE, -0.02], t: DOWN, lat, mode: 'out', rmax: 0.3, groups: groups | NECK_GROUP | (cap && lat > 0.2 ? ARM : 0) }));
  const ys = [], step = near ? 0.045 : 0.12;
  for (let y = YOKE; y > hem + step * 0.4; y -= step) ys.push(y);
  ys.push(hem);
  return fan.concat(trunkRows(ys, 0.32, groups));
}
const TORSO_N = (near) => (near ? 24 : 12);

// ---- pieces ------------------------------------------------------------------------------------
// A torso garment. o: { name, slot, top, hem, ease, hang, gap (open front, radians), collar, fold, kind bake }
function torso(mesh, fig, q, o) {
  const near = q >= 1;
  // (far: an undershirt runs on under the belly. Near, the belly below its hem is the skin's; far,
  // the skin under clothes is not drawn, and a heavy figure lost its belly at the switch.)
  const rows = torsoRows(o.neck ?? 1.12, near ? o.hem : o.farHem ?? o.hem, near, o.groups ?? TRUNK, o.cap);
  const n = TORSO_N(near);
  const angles = ringA(n);
  let skip;
  if (o.gap) {
    // open down the front: the two columns nearest the opening are moved onto its edges and the
    // quads between them are left out
    for (const sgn of [1, -1]) { let best = 0; for (let j = 0; j < n; j++) if (Math.abs(angles[j] - sgn * o.gap) < Math.abs(angles[best] - sgn * o.gap)) best = j; angles[best] = sgn * o.gap; }
    skip = (i, j) => Math.abs(angles[j % n]) <= o.gap + 1e-6 && Math.abs(angles[(j + 1) % n]) <= o.gap + 1e-6;
  }
  piece(mesh, fig, {
    name: o.name, shell: o.name, slot: o.slot, kind: 'body', W: 1.15, H: o.top - o.hem, bake: { gapU: o.gap ? (o.gap / TAU) * 1.15 : 0, ...(o.bake || {}) },
    rows, angles, ref: Z, skip,
    ease: (i, a, f) => o.ease + (o.collar && i === 0 ? o.collar : 0),
    hang: o.hang ?? 0.6, fold: (o.fold ?? 0.012) * (near ? 1 : 0.7), foldGrow: true, seed: o.seed || 3,
    flare: (f, a) => (o.flare || 0) * f * f + (o.gap ? 0.022 * Math.exp(-(((Math.abs(a) - o.gap) / 0.25) ** 2)) * (0.3 + f) : 0),
    hemStart: near ? 'close' : false, hemEnd: near, push: o.push,
  });
}
// Sleeves for it. len: metres down the arm from the shoulder.
function sleeves(mesh, fig, q, o) {
  const near = q >= 1;
  const nr = near ? Math.max(5, Math.round((o.len + 0.06) / 0.045)) : Math.max(3, Math.round((o.len + 0.06) / 0.13));
  // The sleeve head is a cap over the deltoid, cut on the arm's own rays: rings fanned from the
  // shoulder joint up to a pole inside the chest, each wrapped on the ARM alone. It is closed, it
  // covers the whole ball of the shoulder at the sleeve's own density (the body of the garment is
  // too coarse there to keep the skin in), and it lies tight, under the yoke where the yoke reaches.
  const c0 = armAt(0.012);
  const rows = (near ? [1.38, 0.92, 0.46] : [1.2, 0.5]).map((lat) => ({ o: c0, t: ARM_T, lat, mode: 'out', rmax: 0.1, groups: ARM, none: 0.03, s: 0 }));
  for (let i = 0; i < nr; i++) {
    const s = 0.012 + (o.len - 0.012) * (i / (nr - 1));
    rows.push({ o: armAt(s), t: ARM_T, mode: 'out', rmax: 0.13, groups: ARM, none: 0.05, s });
  }
  piece(mesh, fig, {
    name: `${o.name}Sl`, atlas: o.len > 0.4 ? 'sleeveLong' : 'sleeveShort', shell: (side) => `${o.name}Sl${side > 0 ? 'L' : 'R'}`, slot: o.slot, kind: 'sleeve', W: 0.36, H: o.len, bake: { joint: o.len > 0.4 ? 0.31 / o.len : -1, cuff: o.cuff ? 1 : 0 },
    rows, angles: ringA(near ? 12 : 6), ref: [0, 1, 0], mirror: true,
    // cloth hangs under the arm: more ease below than on top. The head of the sleeve is SET IN: it
    // starts tight on the deltoid, under the yoke of the garment's body (whose ease is always more),
    // and only takes its own ease over the next few centimetres down the arm. A sleeve head with
    // more ease than the yoke stands out of the shoulder as a dome (round 2's pale caps).
    ease: (i, a, f) => lerp(0.005, o.ease * (0.75 + 0.75 * Math.max(0, -Math.cos(a))) + 0.005, ss(0.012, 0.085, rows[i].s ?? 0)) - (o.cuff && f > 0.9 ? o.ease * 0.5 : 0),
    hang: 0.35, fold: o.fold ?? 0.008, seed: o.seed || 5, hemEnd: near,
  });
}
// Trousers: a seat round the hips, and a leg each. hem: height the legs end at.
function trousers(mesh, fig, q, o) {
  const near = q >= 1;
  const top = o.waist ?? 1.02;
  piece(mesh, fig, {
    name: `${o.name}Seat`, atlas: o.bake && o.bake.denim ? 'seatDenim' : 'seat', shell: o.name, slot: o.slot, kind: 'body', W: 1.1, H: top - 0.84, bake: { seat: 1, ...(o.bake || {}) },
    rows: trunkRows(near ? [top, top - 0.035, 0.95, 0.915, 0.88, 0.85, 0.835, 0.815] : [top, 0.94, 0.86, 0.835, 0.815], 0.3, TRUNK | LEG), angles: ringA(near ? 24 : 12), ref: Z,
    ease: (i) => o.ease + (i === 0 ? 0.004 : 0), hang: 0.5, fold: 0.006, seed: 11, hemStart: near,
    // the last two rows draw in under the crotch: a gusset, so nothing shows between the legs
    push: (p, d, i, a, f) => { const k = p[1] < 0.825 ? 0.1 : p[1] < 0.845 ? 0.5 : 1; return k < 1 ? [p[0] * k, p[1], p[2] * (0.35 + 0.65 * k)] : p; },
  });
  const ys = stepsY(0.91, o.hem, near ? Math.max(4, Math.round((0.91 - o.hem) / 0.055)) : Math.max(3, Math.round((0.91 - o.hem) / 0.2)));
  piece(mesh, fig, {
    name: `${o.name}Leg`, shell: (side) => (o.legShell ? o.legShell(side) : o.name), slot: o.slot, kind: 'leg', W: 0.62, H: 0.91 - o.hem, bake: { joint: o.hem < 0.4 ? (0.91 - KNEE[1]) / (0.91 - o.hem) : -1, stack: o.hem < 0.2 ? 1 : 0, ...(o.bake || {}) },
    rows: ys.map((y) => ({ o: legAt(y), t: DOWN, mode: 'out', rmax: 0.17, groups: LEG, none: 0.05 })), angles: ringA(near ? 12 : 6, 0), ref: [1, 0, 0], mirror: true,
    ease: (i, a, f) => o.ease * (0.8 + 0.9 * f) + (o.legEase || 0), hang: o.hang ?? 0.75, fold: o.fold ?? 0.009, seed: 13, hemEnd: near,
    flare: (f) => (o.flare || 0) * f,
  });
}
function skirt(mesh, fig, q, o) {
  const near = q >= 1;
  const ys = stepsY(o.waist, o.hem, near ? Math.max(5, Math.round((o.waist - o.hem) / 0.05)) : 4);
  piece(mesh, fig, {
    name: o.name, shell: o.shell || o.name, slot: o.slot, kind: 'skirt', W: 1.3, H: o.waist - o.hem, bake: o.bake,
    rows: ys.map((y) => ({ o: [0, y, y > 0.9 ? spineAt(y)[2] : 0.004], t: DOWN, mode: y > 0.88 ? 'out' : 'in', rmax: 0.32, groups: y > 0.88 ? TRUNK | LEG : LEG })),
    angles: o.span ? Array.from({ length: near ? 11 : 5 }, (_, i) => -o.span + (2 * o.span * i) / ((near ? 11 : 5) - 1)) : ringA(near ? 24 : 12), closed: !o.span, ref: Z,
    ease: () => o.ease, hang: 0.93, fold: o.fold ?? 0.016, foldGrow: true, seed: o.seed || 17, flare: (f) => (o.flare ?? 0.03) * f, hemEnd: near, hemStart: near && !!o.span,
    // a skirt belongs to the hips first, the thighs second: it must not split down the middle
    weights: (x, y, z) => { const t = ss(0.9, 0.55, y) * 0.55, l = x >= 0 ? B.thighL : B.thighR, r = x >= 0 ? B.thighR : B.thighL, k = Math.min(1, Math.abs(x) / 0.08); return [[B.hips, 1 - t], [l, t * (0.5 + 0.5 * k)], [r, t * (0.5 - 0.5 * k)]].filter((w) => w[1] > 0.001); },
  });
}
function boots(mesh, fig, q, o) {
  const near = q >= 1;
  const ys = stepsY(o.top, 0.07, near ? Math.max(3, Math.round((o.top - 0.07) / 0.05)) : 2);
  piece(mesh, fig, {
    name: `${o.name}Shaft`, shell: o.name, slot: SLOT.boots, kind: 'leg', W: 0.36, H: o.top - 0.07, bake: { boot: 1 },
    rows: ys.map((y) => ({ o: legAt(y), t: DOWN, mode: 'out', rmax: 0.1, groups: LEG, none: 0.04 })), angles: ringA(near ? 10 : 6, 0), ref: [1, 0, 0], mirror: true,
    ease: (i, a, f) => 0.011 + 0.004 * (1 - f), hang: 0.2, hemStart: near, atlas: 'bootShaft',
  });
  // The foot of the boot is a shape of its own, not a wrap of the bare foot: a closed last with a
  // flat sole on the ground, a welt, a heel counter under the shaft and a rounded toe box.
  //   [z, half width, height of the upper over the sole]; the first and last rows close it
  const last = near
    ? [[-0.09, 0.004, 0.03], [-0.084, 0.03, 0.075], [-0.062, 0.041, 0.108], [-0.02, 0.047, 0.118], [0.03, 0.05, 0.106], [0.07, 0.054, 0.08], [0.11, 0.056, 0.066], [0.15, 0.053, 0.058], [0.178, 0.042, 0.048], [0.192, 0.024, 0.034], [0.198, 0.004, 0.022]]
    : [[-0.09, 0.004, 0.03], [-0.07, 0.04, 0.1], [-0.01, 0.048, 0.116], [0.07, 0.054, 0.08], [0.15, 0.053, 0.058], [0.186, 0.032, 0.04], [0.198, 0.004, 0.022]];
  const nA = near ? 12 : 8, cols = nA + 1, nR = last.length, g = GUTTER;
  const rect = packer.take('bootFoot', 0.3, 0.29);
  if (!PIECES.has('bootFoot')) PIECES.set('bootFoot', { rect, kind: 'flat', W: 0.3, H: 0.29, boot: 2 });
  const WELT = 0.02;
  for (const side of [1, -1]) {
    mesh.shell = o.name;
    const v0 = mesh.count, ids = [];
    for (let i = 0; i < nR; i++) for (let j = 0; j < cols; j++) {
      const [z, w, h] = last[i], a = ((j % nA) / nA) * TAU, c = Math.cos(a), sn = Math.sin(a);
      // round over the top, square at the welt, flat underneath
      const x = 0.106 + w * Math.sign(c) * Math.abs(c) ** 0.7;
      const y = sn >= 0 ? WELT + (h - WELT) * sn ** 0.85 : WELT - (WELT - 0.002) * Math.min(1, (-sn) ** 0.45 * 1.15);
      const yy = i === 0 || i === nR - 1 ? Math.min(y, h) : y;
      const tw = Math.min(1, Math.max(0, (z - 0.075) / 0.04));
      const wts = tw <= 0 ? [[side > 0 ? B.footL : B.footR, 1]] : tw >= 1 ? [[side > 0 ? B.toeL : B.toeR, 1]] : [[side > 0 ? B.footL : B.footR, 1 - tw], [side > 0 ? B.toeL : B.toeR, tw]];
      const u01 = j / (cols - 1), v01 = i / (nR - 1);
      ids.push(mesh.vert(x * side, yy, z, 0, 1, 0, rect[0] + g + (rect[2] - rect[0] - 2 * g) * u01, rect[1] + g + (rect[3] - rect[1] - 2 * g) * v01, wts, [u01 * 0.3, v01 * 0.29, 0, SLOT.boots]));
    }
    for (let i = 0; i + 1 < nR; i++) for (let j = 0; j + 1 < cols; j++) mesh.quad(ids[i * cols + j], ids[i * cols + j + 1], ids[(i + 1) * cols + j + 1], ids[(i + 1) * cols + j], side < 0);
    mesh.computeNormals(v0, mesh.count, [mesh.shell]);
  }
}
// A ring round the waist (belts, the knotted coverall top). Extra lumps come from `lump(a)`.
function belt(mesh, fig, q, o) {
  const near = q >= 1;
  piece(mesh, fig, {
    name: o.name, shell: o.name, slot: o.slot, kind: 'flat', W: 1.1, H: o.h * 2, bake: { belt: o.kindBake ?? 1 },
    rows: trunkRows([o.y + o.h, o.y + o.h * 0.5, o.y - o.h * 0.5, o.y - o.h], 0.32, TRUNK | LEG), angles: ringA(near ? 24 : 12), ref: Z,
    ease: (i, a) => o.ease + (i === 1 || i === 2 ? o.thick ?? 0.006 : 0) + (o.lump ? o.lump(a, i) : 0), hang: 0.8,
  });
}
// a closed box of cloth or leather hung on a bone (pouches, a holster, a buckle)
function box(mesh, c, h, yaw, w, slot, shell) {
  mesh.shell = shell;
  const v0 = mesh.count, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const at = (x, y, z) => [c[0] + x * cy + z * sy, c[1] + y, c[2] - x * sy + z * cy];
  const F = [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]];
  const r = PIECES.get('pouch') || (PIECES.set('pouch', { rect: packer.take('pouch', 0.12, 0.12), kind: 'flat', W: 0.12, H: 0.12, belt: 3 }), PIECES.get('pouch'));
  for (const f of F) {
    const ids = f.map((k, n) => { const p = at(k[0] * h[0], k[1] * h[1], k[2] * h[2]); const u = n === 1 || n === 2 ? 1 : 0, v = n >= 2 ? 1 : 0; return mesh.vert(p[0], p[1], p[2], 0, 1, 0, r.rect[0] + GUTTER + (r.rect[2] - r.rect[0] - 2 * GUTTER) * u, r.rect[1] + GUTTER + (r.rect[3] - r.rect[1] - 2 * GUTTER) * v, w, [u * 0.12, v * 0.12, 0, slot]); });
    mesh.quad(ids[0], ids[1], ids[2], ids[3], false);
  }
  // faceted on purpose: each face keeps its own normal
  const p = mesh.p;
  for (let i = v0; i < mesh.count; i += 4) {
    const a = i * 3, b = (i + 1) * 3, d = (i + 3) * 3;
    const n = norm(cross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]]));
    for (let k = 0; k < 4; k++) { mesh.n[(i + k) * 3] = n[0]; mesh.n[(i + k) * 3 + 1] = n[1]; mesh.n[(i + k) * 3 + 2] = n[2]; }
  }
}

// ---- headwear: lathes on the `cap` bone, kept outside the skull's hull --------------------------
// profile(a) -> [[radius scale or absolute, y], ...] rows from the band up to the top
function hat(mesh, fig, q, o) {
  const near = q >= 1, n = near ? (o.n || 24) : 12, w = [[B.cap, 1]];       // o.n: segments round it at the near level (a wide brim needs more to stay round)
  const ang = ringA(n);
  // the head's outline at band height, plus ease: what the hat sits on
  const hull = ang.map((a) => { const d = [Math.sin(a), 0, Math.cos(a)]; const h = march(fig, d[0] * 0.2, o.band, HEAD_C[2] + d[2] * 0.2, -d[0], 0, -d[2], 0.2, HEAD); return (h < 0 ? 0.09 : 0.2 - h) + o.ease; });
  const rect = packer.take(o.name, 0.75, 0.3);
  if (!PIECES.has(o.name)) PIECES.set(o.name, { rect, kind: 'hat', W: 0.75, H: 0.3, ...(o.bake || {}) });
  mesh.shell = o.name;
  const v0 = mesh.count, rows = o.rows(near), nR = rows.length, ids = [], g = GUTTER;
  for (let i = 0; i < nR; i++) for (let j = 0; j <= n; j++) {
    const a = ang[j % n], [rs, y, add, vv] = rows[i](a);       // (vv: the row's own place up the piece, where the rows are not even)
    const R = hull[j % n] * rs + (add || 0);
    const u = j / n, v = vv ?? i / (nR - 1);
    ids.push(mesh.vert(Math.sin(a) * R, y, HEAD_C[2] + Math.cos(a) * R, 0, 1, 0, rect[0] + g + (rect[2] - rect[0] - 2 * g) * u, rect[1] + g + (rect[3] - rect[1] - 2 * g) * v, w, [u * 0.75, v * 0.3, 0, SLOT.hat]));
  }
  for (let i = 0; i + 1 < nR; i++) for (let j = 0; j < n; j++) mesh.quad(ids[i * (n + 1) + j], ids[i * (n + 1) + j + 1], ids[(i + 1) * (n + 1) + j + 1], ids[(i + 1) * (n + 1) + j], true);
  mesh.computeNormals(v0, mesh.count, [o.name]);
  return hull;
}
function hats(mesh, fig, q) {
  const near = q >= 1;
  const front = (a) => Math.max(0, Math.cos(a));
  // trucker cap: a tall foam front panel standing over the brow, a lower mesh back, a button
  const capBand = 1.722;
  hat(mesh, fig, q, {
    name: 'capT', band: capBand, ease: 0.008, bake: { hat: 1 },
    rows: () => [
      () => [0.985, capBand - 0.012], () => [1, capBand - 0.004],
      (a) => [1, capBand + 0.03 + 0.012 * front(a)], (a) => [0.97 - 0.04 * (1 - front(a)), capBand + 0.06 + 0.02 * front(a)],
      (a) => [0.8 - 0.1 * (1 - front(a)), capBand + 0.086 + 0.02 * front(a)], (a) => [0.45, capBand + 0.103 + 0.012 * front(a)], () => [0.04, capBand + 0.11], () => [0, capBand + 0.112],
    ],
  });
  {
    // the brim: a curved tongue, a thin solid so it casts and has an edge
    const rect = packer.take('capBrim', 0.2, 0.1), w = [[B.cap, 1]];
    if (!PIECES.has('capBrim')) PIECES.set('capBrim', { rect, kind: 'flat', W: 0.2, H: 0.1, hat: 2 });
    mesh.shell = 'capT';
    const v0 = mesh.count, nx = near ? 12 : 6, nz = near ? 4 : 2, ids = [[], []];
    for (let layer = 0; layer < 2; layer++) for (let k = 0; k <= nz; k++) for (let i = 0; i <= nx; i++) {
      const a = -1.05 + (2.1 * i) / nx, t = k / nz;
      const R = 0.094 + t * 0.075 * (0.55 + 0.45 * Math.cos(a * 1.2));
      const y = capBand - 0.006 - t * 0.016 - 0.02 * (1 - Math.cos(a)) * (0.4 + t) - layer * 0.004 * (1 - t * 0.6);
      ids[layer].push(mesh.vert(Math.sin(a) * R, y, HEAD_C[2] + Math.cos(a) * R, 0, layer ? -1 : 1, 0, rect[0] + GUTTER + (rect[2] - rect[0] - 2 * GUTTER) * (i / nx), rect[1] + GUTTER + (rect[3] - rect[1] - 2 * GUTTER) * t, w, [(i / nx) * 0.2, t * 0.1, 0, SLOT.hat]));
    }
    for (let layer = 0; layer < 2; layer++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const s = nx + 1, a = ids[layer][k * s + i], b = ids[layer][k * s + i + 1], c = ids[layer][(k + 1) * s + i + 1], d = ids[layer][(k + 1) * s + i];
      mesh.quad(a, b, c, d, layer === 0);
    }
    mesh.computeNormals(v0, mesh.count, ['capT']);
  }
  // beanie: follows the skull, a thick turned-up band, a slouch at the top
  hat(mesh, fig, q, {
    name: 'beanie', band: 1.71, ease: 0.008, bake: { hat: 3 },
    rows: () => [() => [1.0, 1.696, 0.002], () => [1.03, 1.692, 0.008], () => [1.04, 1.71, 0.01], () => [1.03, 1.728, 0.008], () => [1.0, 1.732, 0.001],
      () => [0.985, 1.752], () => [0.92, 1.778], () => [0.78, 1.8], () => [0.55, 1.816], (a) => [0.25, 1.826 - 0.004 * Math.cos(a)], () => [0, 1.828]],
  });
  // campaign hat: wide flat brim, tall crown pinched in four
  hat(mesh, fig, q, {
    name: 'campaign', band: 1.735, ease: 0.006, bake: { hat: 4 }, n: 40,
    rows: () => {
      const pinch = (a, k) => 1 - k * (0.5 + 0.5 * Math.cos(4 * a + Math.PI));
      // (few rows, many segments: the brim's edge is what is seen, and at 24 it was a polygon. Each
      // row names its place up the piece, so the band stays where the bake draws it.)
      const brim = (a) => 0.086 + 0.012 * Math.abs(Math.sin(a)), dip = (a) => 0.004 * Math.cos(2 * a);
      return [
        (a) => [1, 1.727 - 0.012 + dip(a), brim(a) - 0.004, 0], (a) => [1, 1.727 - 0.004 + dip(a), brim(a), 1 / 9], () => [1, 1.73, 0.004, 3 / 9],
        (a) => [0.97 * pinch(a, 0.06), 1.795, 0, 5 / 9], (a) => [0.72 * pinch(a, 0.3), 1.838, 0, 7 / 9], () => [0, 1.851, 0, 1],
      ];
    },
  });
  // hood, up: round the head from the collar, open at the face
  {
    const n = near ? 15 : 7, gap = 0.72;
    piece(mesh, fig, {
      name: 'hood', slot: SLOT.outer, kind: 'body', W: 0.7, H: 0.4, bake: { hood: 1 },
      rows: stepsY(1.5, 1.79, near ? 8 : 4).map((y) => ({ o: [0, y, y > 1.6 ? -0.012 : -0.024], t: [0, 1, 0], mode: 'in', rmax: 0.2, groups: y > 1.56 ? HEAD : HEAD | TRUNK })),
      angles: openA(n, gap), closed: false, ref: Z,
      ease: (i, a, f) => 0.022 + 0.012 * f + 0.014 * Math.exp(-((((Math.abs(a) > Math.PI ? TAU - Math.abs(a) : Math.abs(a)) - gap) / 0.2) ** 2)), hang: 0, fold: 0.006, seed: 23,
      push: (p, d, i, a, f) => (f > 0.72 ? [p[0] * (1 - (f - 0.72) * 3.1), p[1] + 0.02 * (1 - (f - 0.72) * 2), -0.014 + (p[2] + 0.014) * (1 - (f - 0.72) * 3.1) + (f - 0.72) * 0.05] : p),
      weights: (x, y) => (y > 1.6 ? [[B.head, 1]] : y > 1.53 ? [[B.head, 0.5], [B.neck, 0.5]] : [[B.neck, 0.4], [B.spine2, 0.6]]),
      hemStart: false, flip: false,
    });
  }
}

// ---- the wardrobe: every garment of every variant, cut once per sculpt and level ----------------
export function buildGarments(mesh, fig, q) {
  const fem = fig.shape.fem;
  // underwear layer
  torso(mesh, fig, q, { cap: true, name: 'tee', slot: SLOT.under, neck: 1.0, top: 1.475, hem: 0.97, farHem: 0.9, ease: 0.011, hang: 0.45, fold: 0.006, seed: 31, bake: { crew: 1 } });
  sleeves(mesh, fig, q, { name: 'tee', slot: SLOT.under, len: 0.17, ease: 0.014 });
  torso(mesh, fig, q, { name: 'tank', slot: SLOT.under, neck: 0.62, top: 1.44, hem: 0.95, farHem: 0.89, ease: 0.011, hang: 0.5, fold: 0.008, seed: 37, bake: { tank: 1 } });
  // shirts
  torso(mesh, fig, q, { cap: true, name: 'shirt', slot: SLOT.shirt, top: 1.5, hem: 0.975, ease: 0.016, collar: 0.012, hang: 0.62, fold: 0.012, seed: 41, bake: { placket: 1, collar: 1, pockets: 2 } });
  sleeves(mesh, fig, q, { name: 'shirt', slot: SLOT.shirt, len: 0.2, ease: 0.02 });
  sleeves(mesh, fig, q, { name: 'shirtLong', slot: SLOT.shirt, len: 0.55, ease: 0.02, cuff: true });
  torso(mesh, fig, q, { cap: true, name: 'flannel', slot: SLOT.outer, top: 1.5, hem: 0.87, ease: 0.024, collar: 0.016, hang: 0.85, gap: 0.42, fold: 0.016, seed: 43, flare: 0.02, bake: { placket: 1, collar: 1, pockets: 2 } });
  sleeves(mesh, fig, q, { name: 'flannel', slot: SLOT.outer, len: 0.56, ease: 0.028, cuff: true, fold: 0.01 });
  torso(mesh, fig, q, { cap: true, name: 'hoodie', slot: SLOT.outer, top: 1.5, hem: 0.9, ease: 0.03, collar: 0.02, hang: 0.9, fold: 0.016, seed: 47, bake: { pouch: 1, rib: 1 },
    push: (p, d, i, a, f) => (f > 0.9 ? [p[0] * 0.96, p[1], p[2] * 0.96] : p) });
  sleeves(mesh, fig, q, { name: 'hoodie', slot: SLOT.outer, len: 0.57, ease: 0.034, cuff: true, fold: 0.012 });
  torso(mesh, fig, q, { cap: true, name: 'robe', slot: SLOT.outer, top: 1.5, hem: 0.36, ease: 0.03, collar: 0.03, hang: 0.94, fold: 0.02, seed: 53, flare: 0.05, groups: TRUNK | LEG, bake: { robe: 1 },
    push: (p, d, i, a, f) => (p[1] < 0.86 && Math.abs(p[0]) < 0.05 ? [p[0], p[1], Math.max(p[2], 0.1)] : p) });
  sleeves(mesh, fig, q, { name: 'robe', slot: SLOT.outer, len: 0.5, ease: 0.027, fold: 0.011 });
  torso(mesh, fig, q, { name: 'vestHi', slot: SLOT.extra, neck: 0.85, top: 1.47, hem: 0.98, ease: 0.034, hang: 0.95, gap: 0.3, fold: 0.006, seed: 59, bake: { vest: 1 } });
  torso(mesh, fig, q, { name: 'armour', slot: SLOT.outer, neck: 0.8, top: 1.47, hem: 1.05, ease: 0.036, hang: 1, fold: 0, seed: 61, bake: { armour: 1 },
    // plates: flat front and back
    push: (p, d, i, a, f) => [p[0], p[1], p[2] > 0.06 ? Math.max(p[2], 0.135 + 0.02 * fig.shape.fat) : p[2] < -0.1 ? Math.min(p[2], -0.15) : p[2]] });
  // dress: bodice, short sleeves and a skirt to the knee; apron over it
  torso(mesh, fig, q, { cap: true, name: 'dress', slot: SLOT.shirt, top: 1.49, hem: 1.0, ease: 0.016, collar: 0.012, hang: 0.55, fold: 0.008, seed: 67, bake: { placket: 1, collar: 1 } });
  sleeves(mesh, fig, q, { name: 'dress', slot: SLOT.shirt, len: 0.15, ease: 0.02, cuff: true });
  skirt(mesh, fig, q, { name: 'dressSkirt', shell: 'dress', slot: SLOT.shirt, waist: 1.02, hem: 0.5, ease: 0.014, flare: 0.05, fold: 0.022 });
  skirt(mesh, fig, q, { name: 'apron', slot: SLOT.belt, waist: 1.03, hem: 0.6, ease: 0.026, flare: 0.045, fold: 0.012, span: 1.15, seed: 71, bake: { apron: 1 } });
  // legs
  trousers(mesh, fig, q, { name: 'jeans', slot: SLOT.legs, ease: 0.011, hem: 0.075, hang: 0.7, bake: { denim: 1 } });
  trousers(mesh, fig, q, { name: 'work', slot: SLOT.legs, ease: 0.02, hem: 0.08, hang: 0.85, fold: 0.012, bake: { cargo: 1 } });
  trousers(mesh, fig, q, { name: 'slacks', slot: SLOT.legs, ease: 0.014, hem: 0.07, hang: 0.9, bake: { crease: 1, stripe: 1 } });
  trousers(mesh, fig, q, { name: 'shorts', slot: SLOT.legs, ease: 0.022, hem: 0.6, hang: 0.9, waist: 0.99, flare: 0.012 });
  boots(mesh, fig, q, { name: 'boots', top: 0.3 });
  boots(mesh, fig, q, { name: 'shoes', top: 0.115 });
  // waist: a belt, a duty belt with pouches, the top of a coverall knotted round the hips
  belt(mesh, fig, q, { name: 'belt', slot: SLOT.belt, y: 1.0, h: 0.019, ease: 0.017, thick: 0.004 });
  box(mesh, [0, 1.0, 0.118 + 0.06 * Math.max(0, fig.shape.fat) + 0.012 * (1 - fem)], [0.022, 0.017, 0.004], 0, [[B.hips, 0.6], [B.spine1, 0.4]], SLOT.belt, 'belt');
  belt(mesh, fig, q, { name: 'duty', slot: SLOT.belt, y: 0.995, h: 0.027, ease: 0.022, thick: 0.008, kindBake: 2 });
  if (q >= 1) {
    const hw = [[B.hips, 1]], fat = Math.max(0, fig.shape.fat);
    for (const [a, hh, hx] of [[0.55, 0.045, 0.03], [-0.55, 0.04, 0.026], [2.3, 0.05, 0.035], [-2.4, 0.04, 0.03], [-1.45, 0.075, 0.04]]) {
      const R = 0.2 + 0.03 * fat - 0.035 * Math.abs(Math.cos(a));
      box(mesh, [Math.sin(a) * R, 0.985 - (hh > 0.06 ? 0.04 : 0), -0.005 + Math.cos(a) * R * 0.78], [hx, hh, 0.02], a, hw, SLOT.belt, 'duty');
    }
  }
  belt(mesh, fig, q, { name: 'knot', slot: SLOT.legs, y: 0.975, h: 0.05, ease: 0.03, thick: 0.02, kindBake: 4,
    lump: (a, i) => 0.012 * vnoise(a * 3, i, 7) + 0.035 * Math.exp(-((a / 0.35) ** 2)) });
  if (q >= 1) {
    // the two sleeves, knotted, their ends hanging in front
    for (const sx of [1, -1]) piece(mesh, fig, {
      name: 'knotEnd', atlas: 'knotEnd', shell: 'knot', slot: SLOT.legs, kind: 'sleeve', W: 0.3, H: 0.3, bake: { joint: -1 },
      rows: stepsY(0, 0.26, 6).map((s) => ({ o: [sx * (0.035 + s * 0.12), 0.965 - s, 0.15 + 0.06 * Math.max(0, fig.shape.fat) - s * 0.12], t: norm([sx * 0.12, -1, -0.12]), mode: 'out', rmax: 0.001, groups: 0, none: 0.034 - s * 0.03 })),
      angles: ringA(7), ref: Z, ease: () => 0, hang: 0, fold: 0.012, seed: 73 + sx, weights: [[B.hips, 0.7], [sx > 0 ? B.thighL : B.thighR, 0.3]], hemEnd: true,
    });
  }
  hats(mesh, fig, q);
  return { pieces: PIECES, used: packer.used };
}

// ---- outfits ------------------------------------------------------------------------------------
const C = {
  denim: [0x24375f, 0x1c2a44, 0x33486a, 0x15181f], flannel: [[0x7a1a17, 0x1a1c20], [0x1f3d2a, 0x10140f], [0x2a3550, 0x15171d], [0x6a4a1a, 0x201a12]],
  tee: [0x8f9093, 0x4a4d52, 0x6a2f2a, 0x2c3a4a, 0xa59f8f], white: [0xa8a49a, 0x9a9488, 0xb0aca4], work: [0x2d3f54, 0x4a4d48, 0x3a4230, 0x5a4a34], hoodie: [0x2a2d33, 0x4a2a2a, 0x2a3a34, 0x55585c, 0x23283a],
  dress: [0x7fa3b8, 0xb98a94, 0x8fb39a, 0xc2b27a], robe: [0xb9b2a2, 0x8fa0ad, 0xa89aa6, 0x9aa890], trooper: [0x6b6247, 0x4f5560], slacks: [0x2a2d35, 0x3a3428],
};
// Everything a variant wears: shells (outermost first), the eight slots, what its head carries.
export function makeOutfit(rng, variant, sex, build, opts = {}) {
  const r = rng;
  const slots = new Array(8).fill(null).map(() => ({ kind: 'canvas', color: 0x333333 }));
  const set = (i, kind, color, colorB) => { slots[i] = { kind, color, colorB }; };
  if (opts.bare) return { shells: [], slots, barefoot: true };
  const sh = [];
  const out = { shells: sh, slots, barefoot: false, hat: null, hood: false, hair: null, armour: false, helmet: false, stripes: null };
  set(SLOT.boots, 'leather', r.pick([0x2a1c12, 0x15120f, 0x3a2a1a]), 0x6a5238);
  set(SLOT.belt, 'leather', 0x1c1410, 0x5a4630);
  if (variant === 'trucker') {
    const [c1, c2] = r.pick(C.flannel);
    set(SLOT.outer, 'flannel', c1, c2); set(SLOT.under, 'jersey', r.pick(C.white)); set(SLOT.legs, 'denim', r.pick(C.denim), 0xdcd9cf);
    set(SLOT.hat, 'canvas', r.pick([0x7a2a22, 0x23364e, 0x2f4a32, 0x1a1a1c]), 0xcfcabb);
    sh.push('capT', 'flannel', 'flannelSlL', 'flannelSlR', 'belt', 'tank', 'jeans', 'boots');
    out.hat = 'capT';
  } else if (variant === 'waitress') {
    set(SLOT.shirt, 'cotton', r.pick(C.dress)); set(SLOT.belt, 'cotton', r.pick(C.white));
    set(SLOT.boots, 'leather', r.pick([0x1a1a1c, 0x8a857a]), 0x55504a);
    sh.push('apron', 'dress', 'dressSlL', 'dressSlR', 'shoes');
    out.hair = r.next() < 0.75 ? 'bun' : 'long';
  } else if (variant === 'mechanic') {
    const c = r.pick(C.work);
    set(SLOT.legs, 'canvas', c); set(SLOT.under, 'jersey', r.pick(C.tee)); set(SLOT.hat, 'jersey', r.pick([0x23262b, 0x4a2b22, 0x2c3a2a, 0x6a5a2a]));
    sh.push('knot', 'tee', 'teeSlL', 'teeSlR', 'work', 'boots');
    if (r.next() < 0.5) { set(SLOT.extra, 'hivis', 0xd8f01c, 0xbfc2c6); sh.unshift('vestHi'); out.stripes = { y: [1.1, 1.3], halfWidth: 0.025, x: 0.1 }; }
    if (r.next() < 0.7) { sh.unshift('beanie'); out.hat = 'beanie'; }
  } else if (variant === 'guest') {
    out.barefoot = true;
    if (r.next() < 0.55) {
      set(SLOT.outer, 'towel', r.pick(C.robe)); set(SLOT.belt, 'towel', slots[SLOT.outer].color); set(SLOT.legs, 'cotton', r.pick([0x5a6a7a, 0x8a8a84, 0x4a4a52]));
      sh.push('robe', 'robeSlL', 'robeSlR', 'belt', 'shorts');
    } else {
      set(SLOT.under, 'jersey', r.pick(C.white)); set(SLOT.legs, 'cotton', r.pick([0x5a6a7a, 0x7a4a48, 0x4a5a4a, 0x8a8a84]));
      sh.push('tank', 'shorts');
    }
  } else if (variant === 'trooper') {
    const c = r.pick(C.trooper);
    set(SLOT.shirt, 'cotton', c); set(SLOT.legs, 'cotton', r.pick(C.slacks)); set(SLOT.outer, 'canvas', 0x16181b); set(SLOT.hat, 'canvas', 0x4a4030, 0x1a1612);
    set(SLOT.belt, 'leather', 0x0f0d0c, 0x3a3028);
    const hatOn = r.next() < 0.8;
    if (hatOn) { sh.push('campaign'); out.hat = 'campaign'; }
    sh.push('armour', 'duty', 'shirt', r.next() < 0.5 ? 'shirtLongSlL' : 'shirtSlL', 'slacks', 'boots');
    sh.push(sh.includes('shirtLongSlL') ? 'shirtLongSlR' : 'shirtSlR');
    out.armour = true;
  } else {
    set(SLOT.outer, 'jersey', r.pick(C.hoodie)); set(SLOT.legs, 'denim', r.pick(C.denim), 0xdcd9cf); set(SLOT.under, 'jersey', r.pick(C.tee));
    sh.push('hoodie', 'hoodieSlL', 'hoodieSlR', 'jeans', 'boots');
    if (r.next() < 0.55) { sh.unshift('hood'); out.hood = true; }
  }
  return out;
}
