// Shared builders for src/models/structures: coursed masonry, arches, paving, iron, timber, glass, wax.
//
// Masonry is built stone by stone as "cushioned" faces: four corners on the wall plane, one raised
// centre vertex, splayed normals and dark joints. That costs four triangles a stone, stays
// watertight, and lets a ruin lose whole stones along a ragged top.
import { THREE, Rng, Noise, MAT, PAL, TAU, col, paint, xf, box, cyl, sphere, dome, torus, tube, lathe, merge, deform, strokes, GLYPH } from '../kit.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const UP = [0, 1, 0],
  DOWN = [0, -1, 0];

// ---------------------------------------------------------------------------------------------
// Raw mesh accumulator with per-vertex colour. Faces fix their own winding from a `hint` vector.
// ---------------------------------------------------------------------------------------------
export class Mesher {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.i = [];
  }
  get tris() {
    return this.i.length / 3;
  }
  _v(q, nx, ny, nz, c) {
    this.p.push(q[0], q[1], q[2]);
    this.n.push(nx, ny, nz);
    this.c.push(c.r, c.g, c.b);
    return this.p.length / 3 - 1;
  }
  /**
   * A quad that looks toward `hint`. With `ce` (edge colour) it becomes a cushioned stone face:
   * centre raised by `bulge`, corners keep the joint colour and lean their normals outward.
   */
  face(a, b, c, d, hint, cm, ce = null, bulge = 0, splay = 0.5) {
    let nx = (c[1] - a[1]) * (d[2] - b[2]) - (c[2] - a[2]) * (d[1] - b[1]);
    let ny = (c[2] - a[2]) * (d[0] - b[0]) - (c[0] - a[0]) * (d[2] - b[2]);
    let nz = (c[0] - a[0]) * (d[1] - b[1]) - (c[1] - a[1]) * (d[0] - b[0]);
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      const t = b;
      b = d;
      d = t;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (!ce) {
      const i0 = this._v(a, nx, ny, nz, cm);
      this._v(b, nx, ny, nz, cm);
      this._v(c, nx, ny, nz, cm);
      this._v(d, nx, ny, nz, cm);
      this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      return;
    }
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4,
      my = (a[1] + b[1] + c[1] + d[1]) / 4,
      mz = (a[2] + b[2] + c[2] + d[2]) / 4;
    const i0 = this._v([mx + nx * bulge, my + ny * bulge, mz + nz * bulge], nx, ny, nz, cm);
    for (const q of [a, b, c, d]) {
      const dx = q[0] - mx,
        dy = q[1] - my,
        dz = q[2] - mz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const ex = nx + (dx / dl) * splay,
        ey = ny + (dy / dl) * splay,
        ez = nz + (dz / dl) * splay;
      const k = 1 / Math.hypot(ex, ey, ez);
      this._v(q, ex * k, ey * k, ez * k, ce);
    }
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 4, i0, i0 + 4, i0 + 1);
  }
  tri(a, b, c, hint, cl) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      const t = b;
      b = c;
      c = t;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const i0 = this._v(a, nx / l, ny / l, nz / l, cl);
    this._v(b, nx / l, ny / l, nz / l, cl);
    this._v(c, nx / l, ny / l, nz / l, cl);
    this.i.push(i0, i0 + 1, i0 + 2);
  }
  /**
   * A polygon as a fan around a raised centre. pts in ring order; nrm = per-point normals for a
   * curved face (or null for a flat one). Joint colour on the rim, face colour in the middle.
   */
  fan(pts, hint, cm, ce, bulge = 0, splay = 0.5, nrm = null) {
    const n = pts.length;
    let mx = 0,
      my = 0,
      mz = 0,
      nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i],
        q = pts[(i + 1) % n];
      mx += p[0];
      my += p[1];
      mz += p[2];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    mx /= n;
    my /= n;
    mz /= n;
    let rev = false;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      rev = true;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const i0 = this._v([mx + nx * bulge, my + ny * bulge, mz + nz * bulge], nx, ny, nz, cm);
    for (let k = 0; k < n; k++) {
      const idx = rev ? n - 1 - k : k;
      const q = pts[idx];
      const bn = nrm ? nrm[idx] : [nx, ny, nz];
      const dx = q[0] - mx,
        dy = q[1] - my,
        dz = q[2] - mz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const ex = bn[0] + (dx / dl) * splay,
        ey = bn[1] + (dy / dl) * splay,
        ez = bn[2] + (dz / dl) * splay;
      const s = 1 / Math.hypot(ex, ey, ez);
      this._v(q, ex * s, ey * s, ez * s, ce || cm);
    }
    for (let k = 0; k < n; k++) this.i.push(i0, i0 + 1 + k, i0 + 1 + ((k + 1) % n));
  }
  /** Six-sided stone from 8 corners P[i][j][k] (any hexahedron). faces: which of the 6 to emit. */
  hexa(P, cm, ce, bulge = 0.01, faces = [1, 1, 1, 1, 1, 1]) {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        for (let k = 0; k < 2; k++) {
          cx += P[i][j][k][0] / 8;
          cy += P[i][j][k][1] / 8;
          cz += P[i][j][k][2] / 8;
        }
    const quads = [
      [P[0][0][0], P[0][1][0], P[0][1][1], P[0][0][1]], // i = 0
      [P[1][0][0], P[1][1][0], P[1][1][1], P[1][0][1]], // i = 1
      [P[0][0][0], P[1][0][0], P[1][0][1], P[0][0][1]], // j = 0
      [P[0][1][0], P[1][1][0], P[1][1][1], P[0][1][1]], // j = 1
      [P[0][0][0], P[1][0][0], P[1][1][0], P[0][1][0]], // k = 0
      [P[0][0][1], P[1][0][1], P[1][1][1], P[0][1][1]], // k = 1
    ];
    for (let f = 0; f < 6; f++) {
      if (!faces[f]) continue;
      const q = quads[f];
      const hint = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4 - cx, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4 - cy, (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 - cz];
      // a flag of 2 = a plain flat face (two triangles) for sides that are rarely seen
      this.face(q[0], q[1], q[2], q[3], hint, cm, faces[f] === 2 ? null : ce, bulge, 0.4);
    }
  }
  build({ rough = 0.95, metal = 0, mat = MAT.STONE } = {}) {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return paint(g, { rough, metal, mat });
  }
}

// ---------------------------------------------------------------------------------------------
// Stone colour: one tone per stone, then damp, moss, lichen and soot by where it sits.
// ---------------------------------------------------------------------------------------------
export function makeStone(o = {}) {
  const { seed = 1, dark = 1, warm = 0.16, moss = 0.5, lichen = 0.3, damp = 0.4, soot = null, base = PAL.stone, y0 = 0, vary = 1 } = o;
  const nz = new Noise(seed * 31 + 7);
  const cBase = col(base),
    cDark = col(PAL.stoneDark),
    cLight = col(PAL.stoneLight),
    cWarm = col(PAL.stoneWarm),
    cMoss = col(PAL.moss).lerp(col(PAL.stoneDark), 0.3),
    cLichen = col(PAL.lichen),
    cSoot = col(PAL.soot);
  const streak = o.streak === undefined ? 0.5 : o.streak;
  function weather(c, x, y, z, up) {
    const h = y - y0;
    const d = Math.max(0, 1 - h / 1.6);
    c.multiplyScalar(1 - damp * d * d);
    // broad patches a few metres across and rain streaks running down the face
    c.multiplyScalar(1 + nz.fbm2(x * 0.1 + 20.3, (z + h) * 0.12 - 4.1, 2) * 0.2);
    if (!up && streak > 0) {
      const s = nz.fbm2(x * 1.7 + 51.7, h * 0.11 + z * 1.7, 2);
      if (s > 0.12) c.multiplyScalar(1 - Math.min(0.34, (s - 0.12) * 0.8) * streak);
    }
    let m = nz.fbm2(x * 0.45 + 3.1, z * 0.45 + h * 0.6, 3) * 0.5 + 0.5;
    m = Math.max(0, m * 1.6 - 0.55) * moss * (up ? 1.25 : 0.2 + 0.9 * Math.max(0, 1 - h / 2.4));
    if (m > 0) c.lerp(cMoss, Math.min(0.62, m));
    if (lichen > 0) {
      const l = nz.fbm2(x * 0.8 - 7.7, z * 0.8 + h * 0.9 + 11.3, 3);
      if (l > 0.1) c.lerp(cLichen, Math.min(0.4, (l - 0.1) * 1.5) * lichen);
    }
    if (soot) {
      const s = soot(x, y, z);
      if (s > 0) c.lerp(cSoot, Math.min(0.88, s));
    }
    return c;
  }
  return {
    /** Colours of one stone face: `out` for the face, `outE` for its joints. */
    face(R, x, y, z, out, outE) {
      const r = R.next();
      out.copy(cBase);
      // (one quarry: the stones differ a little, they are not a patchwork)
      if (r < 0.16) out.lerp(cDark, R.range(0.1, 0.3) * vary);
      else if (r < 0.3) out.lerp(cLight, R.range(0.05, 0.2) * vary);
      else if (r < 0.3 + warm) out.lerp(cWarm, R.range(0.2, 0.45) * vary);
      out.multiplyScalar((1 + (R.next() - 0.5) * 0.1 * vary) * dark);
      weather(out, x, y, z, false);
      if (outE) outE.copy(out).multiplyScalar(0.6);
      return out;
    },
    /** A weathered top: darker, mossy. */
    top(R, x, y, z, out) {
      out.copy(cBase).lerp(cDark, 0.35).multiplyScalar(R.range(0.8, 1.0) * dark);
      return weather(out, x, y, z, true);
    },
    /** Broken ends and the rubble heart of a wall. */
    core(R, x, y, z, out) {
      out.copy(cBase).lerp(cDark, 0.75).multiplyScalar(R.range(0.6, 0.88) * dark);
      return weather(out, x, y, z, false);
    },
  };
}

const _cm = new THREE.Color(),
  _ce = new THREE.Color(),
  _ct = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------------------------
function cutList(list, lo, hi, min = 0.06) {
  const out = [];
  for (const s of list) {
    if (hi <= s[0] || lo >= s[1]) {
      out.push(s);
      continue;
    }
    if (lo - s[0] > min) out.push([s[0], lo]);
    if (s[1] - hi > min) out.push([hi, s[1]]);
  }
  return out;
}
function uncovered(a, b, blocks) {
  let res = [[a, b]];
  for (const s of blocks) {
    if (s[1] <= a || s[0] >= b) continue;
    res = cutList(res, s[0], s[1], 0.012);
    if (!res.length) break;
  }
  return res;
}

/** The slice of wall an opening removes at height y: [x left, x right] or null. */
export function openSpan(op, y, margin = op.margin === undefined ? 0.19 : op.margin) {
  if (y < op.y0) return null;
  if (y <= op.y1) return [op.x - op.w / 2, op.x + op.w / 2];
  if (!op.k) return null;
  const Rr = op.k * op.w,
    off = Rr - op.w / 2,
    dy = y - op.y1,
    Ro = Rr + margin;
  if (dy >= Ro) return null;
  const hw = Math.sqrt(Ro * Ro - dy * dy) - off;
  return hw > 0.03 ? [op.x - hw, op.x + hw] : null;
}
/** Height of the point of a pointed opening. */
export function openApex(op) {
  if (!op.k) return op.y1;
  const Rr = op.k * op.w,
    off = Rr - op.w / 2;
  return op.y1 + Math.sqrt(Math.max(0, Rr * Rr - off * off));
}

/**
 * A coursed stone wall in its own frame: X along the wall from 0 to `length`, Y up, the outer face
 * at z = +thick/2 and the inner face at z = -thick/2.
 *   top(x)       where the masonry ends (a ruin loses whole stones above it)
 *   base         lowest y; `foundation` > 0 makes one tall rough course from base upward
 *   plinth       { h, out }: courses below h stand `out` proud on the outer face, chamfered on top
 *   openings     [{ x, w, y0, y1, k, margin }]: clear from y0 to y1 (the springing); k = radius / width
 *                of a pointed head (1 = equilateral, 0.5 = round, more = lancet), k omitted = flat head.
 *                The masonry stops `margin` outside the curve, behind the voussoirs of archRing().
 *   innerFrom    the inner face is only built above this height (the floor hides the rest)
 * Returns { geo, spec } where spec feeds wallBoxes().
 */
export function wall(o) {
  const {
    length: L,
    thick: T = 0.9,
    top = () => 8,
    base = 0,
    foundation = 0,
    plinth = null,
    courseH = 0.38,
    blockL = 0.75,
    openings = [],
    seed = 1,
    stone = makeStone({ seed }),
    stoneIn = stone,
    bulge = 0.024,
    innerFrom = -1e9,
    pockets = 0.02,
    wobble = 0.045,
    key = seed * 13.7,
    inner = true,
  } = o;
  const R = new Rng(seed * 7919 + 17);
  let maxH = base + 0.5;
  for (let i = 0; i <= 80; i++) maxH = Math.max(maxH, top((L * i) / 80));
  // course boundaries
  const ys = [];
  let y = base;
  if (foundation > 0) {
    ys.push(y);
    y += foundation;
  }
  if (plinth) {
    const n = Math.max(1, Math.round((plinth.h - y) / courseH));
    const ch = (plinth.h - y) / n;
    for (let i = 0; i < n; i++) {
      ys.push(y);
      y += ch;
    }
    y = plinth.h;
  }
  while (y < maxH + 0.01) {
    ys.push(y);
    y += courseH * R.range(0.86, 1.17);
  }
  ys.push(y);
  // stones of every course
  const courses = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const ya = ys[j],
      yb = ys[j + 1],
      ym = (ya + yb) / 2;
    const isF = foundation > 0 && j === 0;
    const bl = isF ? blockL * 2.6 : blockL;
    let list = [];
    let x = -R.range(0, bl);
    while (x < L) {
      const len = bl * R.range(0.7, 1.4);
      const a = Math.max(0, x);
      let b = Math.min(L, x + len);
      if (L - b < 0.24) b = L;
      if (b - a > 0.05) list.push([a, b]);
      x = b >= L ? L : x + len;
    }
    list = list.filter((s) => isF || ym < top((s[0] + s[1]) / 2));
    for (const op of openings) {
      const sp = openSpan(op, ym);
      if (sp) list = cutList(list, sp[0], sp[1]);
    }
    courses.push(list);
  }
  // the stones along a broken top are themselves broken: their upper corners sit lower
  const brk = o.broken === undefined ? 0.6 : o.broken;
  if (brk > 0) {
    const Rb = new Rng(seed * 331 + 5);
    for (let j = 0; j < courses.length; j++) {
      const ya = ys[j],
        yb = ys[j + 1];
      if ((foundation > 0 && j === 0) || (plinth && yb <= plinth.h + 1e-6)) continue;
      const above = courses[j + 1] || [];
      for (const s of courses[j]) {
        const u = uncovered(s[0], s[1], above);
        if (u.length !== 1 || u[0][0] > s[0] + 1e-6 || u[0][1] < s[1] - 1e-6) continue;
        const xm = (s[0] + s[1]) / 2;
        let sill = false;
        for (const op of openings) {
          const sp = openSpan(op, yb + 0.06, 0);
          if (sp && xm > sp[0] - 0.3 && xm < sp[1] + 0.3) sill = true;
        }
        if (sill || !Rb.chance(brk)) continue;
        const h = yb - ya;
        s[2] = yb - h * Rb.range(0.05, 0.72);
        s[3] = yb - h * Rb.range(0.05, 0.72);
      }
    }
  }
  const M = new Mesher();
  const hi = T / 2,
    lo = -T / 2;
  for (let j = 0; j < courses.length; j++) {
    const ya = ys[j],
      yb = ys[j + 1],
      ym = (ya + yb) / 2;
    const isF = foundation > 0 && j === 0;
    const inPlinth = plinth && yb <= plinth.h + 1e-6;
    const zo = hi + (inPlinth || isF ? (plinth ? plinth.out : 0.06) : 0);
    const list = courses[j];
    const above = courses[j + 1] || [];
    const below = j > 0 ? courses[j - 1] : null;
    for (let q = 0; q < list.length; q++) {
      const a = list[q][0],
        b = list[q][1],
        xm = (a + b) / 2;
      const yL = list[q][2] === undefined ? yb : list[q][2],
        yR = list[q][3] === undefined ? yb : list[q][3];
      const broken = yL < yb - 1e-6 || yR < yb - 1e-6;
      const bg = R.range(0.006, bulge) * Math.min(1, (b - a) / 0.5) * (isF ? 2 : 1);
      // outer face
      stone.face(R, xm + key, ym, key, _cm, _ce);
      if (isF) {
        _cm.multiplyScalar(0.7);
        _ce.multiplyScalar(0.7);
      }
      if (!broken && !isF && !inPlinth && pockets > 0 && b - a > 0.4 && yb - ya > 0.25 && R.chance(pockets)) {
        // a face stone has dropped out: a shallow dark socket
        const zi = zo - 0.11;
        stone.core(R, xm + key, ym, key, _ct);
        _ct.multiplyScalar(0.55);
        M.face([a, ya, zi], [b, ya, zi], [b, yb, zi], [a, yb, zi], [0, 0, 1], _ct);
        M.face([a, ya, zo], [a, ya, zi], [a, yb, zi], [a, yb, zo], [1, 0, 0], _ct);
        M.face([b, ya, zo], [b, ya, zi], [b, yb, zi], [b, yb, zo], [-1, 0, 0], _ct);
        M.face([a, ya, zo], [b, ya, zo], [b, ya, zi], [a, ya, zi], UP, _ct);
        M.face([a, yb, zo], [b, yb, zo], [b, yb, zi], [a, yb, zi], DOWN, _ct);
      } else {
        M.face([a, ya, zo], [b, ya, zo], [b, yR, zo], [a, yL, zo], [0, 0, 1], _cm, _ce, bg);
      }
      // inner face
      if (inner && !isF && yb > innerFrom + 0.02) {
        const yi = Math.max(ya, innerFrom);
        stoneIn.face(R, xm + key + 53, ym, key + 9, _cm, _ce);
        M.face([a, yi, lo], [b, yi, lo], [b, Math.max(yi + 0.01, yR), lo], [a, Math.max(yi + 0.01, yL), lo], [0, 0, -1], _cm, _ce, bg);
      }
      // plinth chamfer
      if (plinth && Math.abs(yb - plinth.h) < 1e-6) {
        stone.top(R, xm + key, yb, key, _ct);
        const chm = plinth.out * 0.9;
        M.face([a, yb, zo], [b, yb, zo], [b, yb + chm, hi], [a, yb + chm, hi], [0, 0.7, 0.7], _ct);
      }
      // exposed top
      if (broken) {
        stone.top(R, xm + key, yb, key, _ct);
        M.face([a, yL, zo], [b, yR, zo], [b, yR, lo], [a, yL, lo], UP, _ct);
      } else
        for (const u of uncovered(a, b, above)) {
          stone.top(R, (u[0] + u[1]) / 2 + key, yb, key, _ct);
          M.face([u[0], yb, zo], [u[1], yb, zo], [u[1], yb, lo], [u[0], yb, lo], UP, _ct);
        }
      // exposed underside (heads of flat openings, the stepped back of an arch)
      if (below && !isF) {
        for (const u of uncovered(a, b, below)) {
          stone.core(R, (u[0] + u[1]) / 2 + key, ya, key, _ct);
          M.face([u[0], ya, zo], [u[1], ya, zo], [u[1], ya, lo], [u[0], ya, lo], DOWN, _ct);
        }
      }
      // exposed ends
      const prev = q > 0 ? list[q - 1] : null,
        next = q < list.length - 1 ? list[q + 1] : null;
      if (!prev || Math.abs(prev[1] - a) > 1e-4) {
        stone.core(R, a + key, ym, key, _ct);
        if (a < 1e-4 || a > L - 1e-4) stone.face(R, a + key, ym, key + 5, _ct, null);
        M.face([a, ya, lo], [a, ya, zo], [a, yL, zo], [a, yL, lo], [-1, 0, 0], _ct);
      } else {
        // a step between two neighbours of different height
        const pR = prev[3] === undefined ? yb : prev[3];
        if (Math.abs(pR - yL) > 1e-4) {
          stone.core(R, a + key, ym, key, _ct);
          const e0 = Math.min(pR, yL),
            e1 = Math.max(pR, yL);
          M.face([a, e0, lo], [a, e0, zo], [a, e1, zo], [a, e1, lo], [yL > pR ? -1 : 1, 0, 0], _ct);
        }
      }
      if (!next || Math.abs(next[0] - b) > 1e-4) {
        stone.core(R, b + key, ym, key, _ct);
        if (b < 1e-4 || b > L - 1e-4) stone.face(R, b + key, ym, key + 5, _ct, null);
        M.face([b, ya, lo], [b, ya, zo], [b, yR, zo], [b, yR, lo], [1, 0, 0], _ct);
      }
    }
  }
  const geo = M.build({ rough: 0.96, mat: MAT.STONE });
  if (geo && wobble > 0) {
    const nz = new Noise(seed * 5 + 3);
    deform(
      geo,
      (p) => {
        p.z += nz.fbm2(p.x * 0.17 + key, p.y * 0.21, 2) * wobble;
      },
      false
    );
  }
  /** Height of the highest stone standing at x. */
  const topAt = (x) => {
    for (let j = courses.length - 1; j >= 0; j--)
      for (const s of courses[j])
        if (x >= s[0] && x <= s[1]) {
          if (s[2] === undefined) return ys[j + 1];
          return s[2] + ((s[3] - s[2]) * (x - s[0])) / Math.max(1e-6, s[1] - s[0]);
        }
    return base;
  };
  return { geo, spec: { L, T, top, openings, base }, topAt };
}

/**
 * Collider boxes for a wall spec, in the wall's frame: [{ x0, x1, y0, y1 }].
 * Never taller than the standing masonry and open where the openings are.
 */
export function wallBoxes(spec, { step = 2.2, minH = 0.4, yMin = spec.base } = {}) {
  const { L, top, openings = [] } = spec;
  const cuts = new Set([0, L]);
  for (const op of openings) {
    cuts.add(clamp(op.x - op.w / 2, 0, L));
    cuts.add(clamp(op.x + op.w / 2, 0, L));
  }
  const xs = [...cuts].sort((a, b) => a - b);
  const edges = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const n = Math.max(1, Math.ceil((xs[i + 1] - xs[i]) / step));
    for (let k = 0; k < n; k++) edges.push(xs[i] + ((xs[i + 1] - xs[i]) * k) / n);
  }
  edges.push(L);
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i],
      b = edges[i + 1];
    if (b - a < 0.05) continue;
    let h = Infinity;
    for (let k = 0; k <= 6; k++) h = Math.min(h, top(a + ((b - a) * k) / 6));
    h = Math.floor(h * 4) / 4;
    let spans = h - yMin > minH ? [[yMin, h]] : [];
    const xm = (a + b) / 2;
    for (const op of openings) {
      if (xm < op.x - op.w / 2 || xm > op.x + op.w / 2) continue;
      let apex = op.y1;
      if (op.k) {
        const Rr = op.k * op.w,
          off = Rr - op.w / 2;
        const near = a < op.x && b > op.x ? 0 : Math.min(Math.abs(a - op.x), Math.abs(b - op.x));
        apex = op.y1 + Math.sqrt(Math.max(0, Rr * Rr - (near + off) * (near + off)));
      }
      spans = cutList(spans, op.y0, apex, minH);
    }
    bands.push({ a, b, spans });
  }
  const out = [];
  let run = null;
  const sig = (s) => s.map((v) => v[0].toFixed(2) + ':' + v[1].toFixed(2)).join('|');
  for (const bd of bands) {
    if (run && sig(run.spans) === sig(bd.spans) && Math.abs(run.b - bd.a) < 1e-6) run.b = bd.b;
    else {
      if (run) for (const s of run.spans) out.push({ x0: run.a, x1: run.b, y0: s[0], y1: s[1] });
      run = { a: bd.a, b: bd.b, spans: bd.spans };
    }
  }
  if (run) for (const s of run.spans) out.push({ x0: run.a, x1: run.b, y0: s[0], y1: s[1] });
  return out;
}

/** Frame of a wall that runs from (ax, az) to (bx, bz): its outer face looks to the right of travel turned... see place(). */
export function wallFrame(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len,
    dz = (bz - az) / len;
  // local +X -> (dx, dz); local +Z (the outer face) -> (-dz, dx)
  const th = Math.atan2(-dz, dx);
  return {
    len,
    th,
    dx,
    dz,
    ox: -dz,
    oz: dx,
    /** local (x along, y, z across) -> model space */
    pt: (x, y, z = 0) => [ax + dx * x - dz * z, y, az + dz * x + dx * z],
    place: (geo) => (geo ? xf(geo, { r: [0, th, 0], t: [ax, 0, az] }) : geo),
  };
}
/** Push the collider boxes of a placed wall into a Builder. */
export function wallColliders(b, spec, frame, opts) {
  for (const k of wallBoxes(spec, opts)) {
    const c = frame.pt((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2, 0);
    b.boxCollider(c[0], c[1], c[2], (k.x1 - k.x0) / 2, (k.y1 - k.y0) / 2, spec.T / 2, frame.th);
  }
}

/** Piecewise-linear profile through [[x, h], ...] with a ragged bite taken out of it. */
export function profile(points, { jag = 0.45, freq = 0.9, seed = 1, floor = 0 } = {}) {
  const nz = new Noise(seed * 3 + 11);
  return (x) => {
    let h = points[0][1];
    if (x >= points[points.length - 1][0]) h = points[points.length - 1][1];
    else
      for (let i = 0; i < points.length - 1; i++) {
        if (x >= points[i][0] && x <= points[i + 1][0]) {
          const t = (x - points[i][0]) / Math.max(1e-6, points[i + 1][0] - points[i][0]);
          h = points[i][1] + (points[i + 1][1] - points[i][1]) * t;
          break;
        }
      }
    return Math.max(floor, h + nz.fbm2(x * freq, 3.3, 2) * jag);
  };
}

// ---------------------------------------------------------------------------------------------
// Arches
// ---------------------------------------------------------------------------------------------
/**
 * A pointed arch of voussoirs in a wall's frame: the opening is centred on x = cx, `w` wide,
 * springing at y = spring, radius k * w. Stones are `depth` deep along the radius and `thick`
 * through the wall (centred on z = zc). keep(x, y) lets a ruin drop stones.
 */
export function archRing(o) {
  const { cx = 0, w, k = 1, spring, depth = 0.34, thick = 1.0, zc = 0, seed = 1, stone = makeStone({ seed }), keep = null, bulge = 0.012, key = seed * 3.3 } = o;
  const R = new Rng(seed * 104729 + 5);
  const Rr = k * w,
    off = Rr - w / 2;
  const A = Math.acos(clamp(off / Rr, -1, 1));
  const n = o.n || Math.max(3, Math.round((Rr * A) / 0.36));
  const M = new Mesher();
  const pt = (s, r, t) => [cx + s * (-off + r * Math.cos(t)), spring + r * Math.sin(t)];
  const kept = { 1: [], '-1': [] };
  for (const s of [1, -1])
    for (let i = 0; i < n; i++) {
      const m = pt(s, Rr + depth / 2, (A * (i + 0.5)) / n);
      kept[s][i] = !keep || keep(m[0], m[1]);
    }
  for (const s of [1, -1])
    for (let i = 0; i < n; i++) {
      if (!kept[s][i]) continue;
      const t0 = (A * i) / n,
        t1 = (A * (i + 1)) / n;
      const ro = Rr + depth * R.range(0.92, 1.12);
      const th = thick + R.range(0, 0.04);
      const zb = zc - th / 2,
        zf = zc + th / 2;
      const i0 = pt(s, Rr, t0),
        i1 = pt(s, Rr, t1),
        o0 = pt(s, ro, t0),
        o1 = pt(s, ro, t1);
      const P = [
        [
          [
            [i0[0], i0[1], zb],
            [i0[0], i0[1], zf],
          ],
          [
            [i1[0], i1[1], zb],
            [i1[0], i1[1], zf],
          ],
        ],
        [
          [
            [o0[0], o0[1], zb],
            [o0[0], o0[1], zf],
          ],
          [
            [o1[0], o1[1], zb],
            [o1[0], o1[1], zf],
          ],
        ],
      ];
      const mid = pt(s, Rr + depth / 2, (t0 + t1) / 2);
      stone.face(R, mid[0] + key, mid[1], key, _cm, _ce);
      const endA = i === 0 || !kept[s][i - 1];
      const endB = i === n - 1 ? !kept[-s][n - 1] : !kept[s][i + 1];
      // faces: i=0 intrados, i=1 extrados, j=0 lower bed, j=1 upper bed, k=0 back, k=1 front
      M.hexa(P, _cm, _ce, bulge, [1, 2, endA ? 2 : 0, endB ? 2 : 0, 1, 1]);
    }
  return M.build({ rough: 0.95, mat: MAT.STONE });
}
/** A point on a pointed arch curve: t = 0 at the right springing, 1 at the point. side = 1 right, -1 left. */
export function archPoint(cx, w, k, spring, t, side = 1, grow = 0) {
  const Rr = k * w,
    off = Rr - w / 2,
    A = Math.acos(clamp(off / Rr, -1, 1));
  return [cx + side * (-off + (Rr + grow) * Math.cos(A * t)), spring + (Rr + grow) * Math.sin(A * t)];
}

// ---------------------------------------------------------------------------------------------
// Blocks, drums, paving
// ---------------------------------------------------------------------------------------------
/**
 * A cuboid dressed in coursed stone on its four sides, centred on x/z, from y0 to y0 + h.
 * top: true = one weathered slab face, a number = paving slabs of about that size.
 * sides: [+Z, +X, -Z, -X] which faces to build.
 */
export function blockBox(w, h, d, o = {}) {
  const { y0 = 0, courseH = 0.38, blockL = 0.7, seed = 1, stone = makeStone({ seed }), top = true, bottom = false, bulge = 0.022, sides = [1, 1, 1, 1], key = seed * 7.1, M = new Mesher(), at = [0, 0, 0], build = true } = o;
  const R = new Rng(seed * 6151 + 3);
  const hx = w / 2,
    hz = d / 2;
  const ox = at[0],
    oy = at[1] + y0,
    oz = at[2];
  const nC = Math.max(1, Math.round(h / courseH));
  const defs = [
    { on: sides[0], len: w, p: (u) => [ox - hx + u, 0, oz + hz], n: [0, 0, 1] },
    { on: sides[1], len: d, p: (u) => [ox + hx, 0, oz + hz - u], n: [1, 0, 0] },
    { on: sides[2], len: w, p: (u) => [ox + hx - u, 0, oz - hz], n: [0, 0, -1] },
    { on: sides[3], len: d, p: (u) => [ox - hx, 0, oz - hz + u], n: [-1, 0, 0] },
  ];
  for (let j = 0; j < nC; j++) {
    const ya = oy + (h * j) / nC,
      yb = oy + (h * (j + 1)) / nC;
    for (let f = 0; f < 4; f++) {
      const F = defs[f];
      if (!F.on) continue;
      let u = j % 2 === 0 ? 0 : -blockL * R.range(0.35, 0.65);
      while (u < F.len - 1e-6) {
        const len = blockL * R.range(0.75, 1.3);
        const a = Math.max(0, u);
        let e = Math.min(F.len, u + len);
        if (F.len - e < blockL * 0.3) e = F.len;
        const pa = F.p(a),
          pb = F.p(e);
        stone.face(R, a + key + f * 31, (ya + yb) / 2, key + f * 7, _cm, _ce);
        M.face([pa[0], ya, pa[2]], [pb[0], ya, pb[2]], [pb[0], yb, pb[2]], [pa[0], yb, pa[2]], F.n, _cm, _ce, R.range(0.005, bulge) * Math.min(1, (e - a) / 0.5));
        u = e >= F.len ? F.len : u + len;
      }
    }
  }
  if (top) {
    if (typeof top === 'number') paving(M, ox - hx, oz - hz, ox + hx, oz + hz, { y: oy + h, slab: top, seed: seed + 5, stone });
    else {
      stone.top(R, ox + key, oy + h, oz, _ct);
      M.face([ox - hx, oy + h, oz + hz], [ox + hx, oy + h, oz + hz], [ox + hx, oy + h, oz - hz], [ox - hx, oy + h, oz - hz], UP, _ct);
    }
  }
  if (bottom) {
    stone.core(R, ox + key, oy, oz, _ct);
    M.face([ox - hx, oy, oz + hz], [ox + hx, oy, oz + hz], [ox + hx, oy, oz - hz], [ox - hx, oy, oz - hz], DOWN, _ct);
  }
  return build ? M.build({ rough: 0.96, mat: MAT.STONE }) : M;
}

/** Paving slabs into a Mesher over the rectangle [x0..x1] x [z0..z1] at height y. mask(x, z) -> keep? */
export function paving(M, x0, z0, x1, z1, o = {}) {
  const { y = 0, slab = 0.9, seed = 1, stone = makeStone({ seed }), mask = null, missing = 0.0, bulge = 0.012, key = seed * 3.9, earth = '#2a2219', dark = 0.86 } = o;
  const R = new Rng(seed * 2843 + 1);
  const cE = col(earth);
  let z = z0;
  while (z < z1 - 1e-6) {
    let dz = slab * R.range(0.8, 1.25);
    if (z1 - (z + dz) < slab * 0.4) dz = z1 - z;
    let x = x0 - (R.next() < 0.5 ? 0 : slab * R.range(0.3, 0.6));
    while (x < x1 - 1e-6) {
      const len = slab * R.range(0.75, 1.5);
      const a = Math.max(x0, x);
      let b = Math.min(x1, x + len);
      if (x1 - b < slab * 0.3) b = x1;
      const xm = (a + b) / 2,
        zm = z + dz / 2;
      if (!mask || mask(xm, zm)) {
        if (missing > 0 && R.chance(missing)) {
          const yl = y - 0.07;
          M.face([a, yl, z + dz], [b, yl, z + dz], [b, yl, z], [a, yl, z], UP, cE);
          M.face([a, yl, z], [b, yl, z], [b, y, z], [a, y, z], [0, 0, 1], cE);
          M.face([a, yl, z + dz], [b, yl, z + dz], [b, y, z + dz], [a, y, z + dz], [0, 0, -1], cE);
          M.face([a, yl, z], [a, yl, z + dz], [a, y, z + dz], [a, y, z], [1, 0, 0], cE);
          M.face([b, yl, z], [b, yl, z + dz], [b, y, z + dz], [b, y, z], [-1, 0, 0], cE);
        } else {
          stone.face(R, xm + key, y, zm, _cm, _ce);
          _cm.multiplyScalar(dark);
          _ce.multiplyScalar(dark * 0.9);
          M.face([a, y, z + dz], [b, y, z + dz], [b, y, z], [a, y, z], UP, _cm, _ce, R.range(0.002, bulge), 0.35);
        }
      }
      x = b >= x1 ? x1 : x + len;
    }
    z += dz;
  }
  return M;
}
export function flagstones(x0, z0, x1, z1, o = {}) {
  return paving(new Mesher(), x0, z0, x1, z1, o).build({ rough: 0.9, mat: MAT.STONE });
}
/** Round paving: rings of wedge slabs from r0 out to r1 at height y. */
export function pavingDisc(M, r0, r1, o = {}) {
  const { y = 0, slab = 0.8, seed = 1, stone = makeStone({ seed }), bulge = 0.012, key = seed * 5.3, at = [0, 0], dark = 0.86 } = o;
  const R = new Rng(seed * 911 + 7);
  const nR = Math.max(1, Math.round((r1 - r0) / slab));
  for (let i = 0; i < nR; i++) {
    const ra = r0 + ((r1 - r0) * i) / nR,
      rb = r0 + ((r1 - r0) * (i + 1)) / nR;
    const n = Math.max(3, Math.round((TAU * (ra + rb) * 0.5) / slab));
    const ph = R.range(0, TAU);
    for (let k = 0; k < n; k++) {
      const a0 = ph + (k / n) * TAU,
        a1 = ph + ((k + 1) / n) * TAU,
        am = (a0 + a1) / 2;
      const P = (r, a) => [at[0] + Math.sin(a) * r, y, at[1] + Math.cos(a) * r];
      stone.face(R, Math.sin(am) * rb + key, y, Math.cos(am) * rb, _cm, _ce);
      _cm.multiplyScalar(dark);
      _ce.multiplyScalar(dark * 0.9);
      const pts = ra < 1e-4 ? [P(0, 0), P(rb, a0), P(rb, am), P(rb, a1)] : [P(ra, a0), P(rb, a0), P(rb, am), P(rb, a1), P(ra, a1), P(ra, am)];
      M.fan(pts, UP, _cm, _ce, R.range(0.002, bulge), 0.35);
    }
  }
  return M;
}

/**
 * An upright drum or polygon of coursed stone, centred on the Y axis, from y0 up.
 *   r        radius to the corners: number or (y above y0) => radius
 *   seg      angular segments; per = segments per stone; round = smooth normals (a true drum)
 *   top      number or (angle) => height above y0 where the masonry ends
 *   ri       inner radius: a hollow shell with an inner face above innerFrom and a rim on broken tops
 *   openings [{ a0, a1, y0, y1 }] angles in radians (0 = +Z, growing toward +X), heights above y0
 *   cap      true closes a solid drum with a flat top
 */
export function blockCyl(r, o = {}) {
  const { y0 = 0, seg = 8, per = 1, round = false, top = 3, ri = 0, innerFrom = -1e9, openings = [], cap = true, courseH = 0.38, seed = 1, stone = makeStone({ seed }), bulge = 0.02, phase = Math.PI / seg, key = seed * 9.7, M = new Mesher(), at = [0, 0, 0], build = true, capStone = null } = o;
  const R = new Rng(seed * 3571 + 9);
  const rf = typeof r === 'function' ? r : () => r;
  const tf = typeof top === 'function' ? top : () => top;
  let maxH = 0;
  for (let i = 0; i < 64; i++) maxH = Math.max(maxH, tf((i / 64) * TAU));
  const flatTop = typeof top !== 'function';
  const nC = flatTop ? Math.max(1, Math.round(maxH / courseH)) : Math.ceil(maxH / courseH);
  const ch = flatTop ? maxH / nC : courseH;
  const ang = (s) => phase + (s / seg) * TAU;
  const P = (s, y, rad) => {
    const a = ang(s);
    return [at[0] + Math.sin(a) * rad, at[1] + y0 + y, at[2] + Math.cos(a) * rad];
  };
  const Nr = (s) => {
    const a = ang(s);
    return [Math.sin(a), 0, Math.cos(a)];
  };
  const inOpening = (am, ym) => {
    for (const op of openings) {
      let d = (((am - op.a0) % TAU) + TAU) % TAU;
      if (d <= ((((op.a1 - op.a0) % TAU) + TAU) % TAU) && ym >= op.y0 && ym <= op.y1) return true;
    }
    return false;
  };
  // which stones stand: grid[j][b] with the segment range of each stone
  const nB = Math.ceil(seg / per);
  const rows = [];
  for (let j = 0; j < nC; j++) {
    const ym = (j + 0.5) * ch;
    const shift = per > 1 && j % 2 === 1 ? Math.floor(per / 2) : 0;
    const row = [];
    for (let b = 0; b < nB; b++) {
      const s0 = b * per + shift,
        s1 = Math.min(seg + shift, s0 + per);
      const am = (ang(s0) + ang(s1)) / 2;
      row.push({ s0, s1, on: ym < tf(((am % TAU) + TAU) % TAU) && !inOpening(am, ym) });
    }
    rows.push(row);
  }
  const standing = (j, s) => {
    if (j < 0) return true;
    if (j >= nC) return false;
    const sm = ((s % seg) + seg) % seg;
    for (const st of rows[j]) {
      for (let q = st.s0; q < st.s1; q++) if (((q % seg) + seg) % seg === sm) return st.on;
    }
    return false;
  };
  for (let j = 0; j < nC; j++) {
    const ya = j * ch,
      yb = (j + 1) * ch,
      ym = (ya + yb) / 2;
    const ra = rf(ya),
      rb = rf(yb);
    for (const st of rows[j]) {
      if (!st.on) continue;
      const am = (ang(st.s0) + ang(st.s1)) / 2;
      const nm = [Math.sin(am), 0, Math.cos(am)];
      stone.face(R, am * 3 + key, y0 + ym, key, _cm, _ce);
      const pts = [],
        nrm = [];
      for (let s = st.s0; s <= st.s1; s++) {
        pts.push(P(s, ya, ra));
        nrm.push(round ? Nr(s) : nm);
      }
      for (let s = st.s1; s >= st.s0; s--) {
        pts.push(P(s, yb, rb));
        nrm.push(round ? Nr(s) : nm);
      }
      M.fan(pts, nm, _cm, _ce, R.range(0.004, bulge), 0.45, nrm);
      if (ri > 0 && yb > innerFrom + 0.02) {
        const yi = Math.max(ya, innerFrom);
        stone.face(R, am * 3 + key + 40, y0 + ym, key + 3, _cm, _ce);
        _cm.multiplyScalar(0.7);
        _ce.multiplyScalar(0.7);
        const ip = [];
        for (let s = st.s0; s <= st.s1; s++) ip.push(P(s, yi, ri));
        for (let s = st.s1; s >= st.s0; s--) ip.push(P(s, yb, ri));
        M.fan(ip, [-nm[0], 0, -nm[2]], _cm, _ce, 0.004, 0.3);
      }
      // rim / top where nothing stands above
      for (let s = st.s0; s < st.s1; s++) {
        if (!standing(j + 1, s) && (ri > 0 || !flatTop || !cap)) {
          stone.top(R, am * 3 + key, y0 + yb, key, _ct);
          if (ri > 0) M.face(P(s, yb, rb), P(s + 1, yb, rb), P(s + 1, yb, ri), P(s, yb, ri), UP, _ct);
          else M.tri(P(s, yb, rb), P(s + 1, yb, rb), [at[0], at[1] + y0 + yb, at[2]], UP, _ct);
        }
        if (j > 0 && !standing(j - 1, s)) {
          stone.core(R, am * 3 + key, y0 + ya, key, _ct);
          M.face(P(s, ya, ra), P(s + 1, ya, ra), P(s + 1, ya, ri), P(s, ya, ri), DOWN, _ct);
        }
      }
      // broken ends
      for (const [s, sn, dir] of [
        [st.s0, st.s0 - 1, -1],
        [st.s1, st.s1, 1],
      ]) {
        if (standing(j, sn)) continue;
        stone.core(R, am * 3 + key + s, y0 + ym, key, _ct);
        const a = ang(s);
        const tn = [Math.cos(a) * dir, 0, -Math.sin(a) * dir];
        M.face(P(s, ya, ra), P(s, ya, ri), P(s, yb, ri), P(s, yb, rb), tn, _ct);
      }
    }
  }
  if (cap && flatTop && !ri) {
    const st2 = capStone || stone;
    const rt = rf(maxH);
    st2.top(R, key, y0 + maxH, key, _ct);
    _ce.copy(_ct).multiplyScalar(0.7);
    const pts = [];
    for (let s = 0; s < seg; s++) pts.push(P(s, maxH, rt));
    M.fan(pts, UP, _ct, _ce, 0.0, 0.0);
  }
  return build ? M.build({ rough: 0.96, mat: MAT.STONE }) : M;
}

/** A loose stone: a knocked-about block, `s` = [sx, sy, sz]. Sits on y = 0. */
export function looseStone(R, s, stone, key = 0, flat = s[0] < 0.42) {
  const M = new Mesher();
  const j = (v) => v * (1 + R.range(-0.2, 0.2));
  const hx = s[0] / 2,
    hy = s[1] / 2,
    hz = s[2] / 2;
  const P = [0, 1].map((i) => [0, 1].map((jj) => [0, 1].map((k) => [j(i ? hx : -hx), j(jj ? hy : -hy) + hy, j(k ? hz : -hz)])));
  stone.face(R, key + R.range(0, 40), 0.9, key, _cm, _ce);
  // small stones are plain six-sided lumps (12 triangles); big ones get cushioned faces
  M.hexa(P, _cm, flat ? null : _ce, Math.min(0.03, s[0] * 0.05));
  return M.build({ rough: 0.97, mat: MAT.STONE });
}
/** A scatter of loose stones around (0, 0): returns one geometry. spread = radius, n stones. */
export function rubble(R, n, spread, stone, { size = [0.25, 0.6], y = 0, pile = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = R.range(0, TAU),
      d = Math.sqrt(R.next()) * spread;
    const sx = R.range(size[0], size[1]);
    const g = looseStone(R, [sx, sx * R.range(0.45, 0.8), sx * R.range(0.6, 1.0)], stone, i * 3.1);
    const lift = pile * Math.max(0, 1 - d / spread);
    xf(g, { r: [R.range(-0.5, 0.5), R.range(0, TAU), R.range(-0.5, 0.5)], t: [Math.cos(a) * d, y + lift + sx * 0.08, Math.sin(a) * d] });
    out.push(g);
  }
  return merge(out);
}

// ---------------------------------------------------------------------------------------------
// Paint presets (use as paint(geo, ironSpec(...)))
// ---------------------------------------------------------------------------------------------
const _nzM = new Noise(911);
const _out = new THREE.Color();
export function ironSpec(rust = 0.5, seed = 0, f = 5) {
  const cI = col(PAL.iron),
    cR = col(PAL.rust),
    cS = col(PAL.soot);
  const k = (v) => clamp((_nzM.fbm3(v.x * f + seed, v.y * f + seed * 0.3, v.z * f, 3) * 0.5 + 0.5 - (1 - rust) * 0.75) * 2.4, 0, 1);
  return {
    color: (v) => _out.copy(cI).lerp(cS, 0.25).lerp(cR, k(v) * 0.85),
    rough: (v) => 0.5 + 0.42 * k(v),
    metal: (v) => 0.9 - 0.65 * k(v),
    mat: MAT.METAL,
  };
}
export function copperSpec(verd = 0.4, seed = 0, { yLo = 0, yHi = 1, f = 4 } = {}) {
  const cC = col(PAL.copper),
    cD = col(PAL.copperDark),
    cV = col(PAL.verdigris),
    cS = col(PAL.soot);
  const n1 = (v) => _nzM.fbm3(v.x * f + seed + 9, v.y * f, v.z * f + 4, 3) * 0.5 + 0.5;
  const kv = (v) => clamp((_nzM.fbm3(v.x * f * 1.7 + seed, v.y * f * 0.6 - 3, v.z * f * 1.7, 3) * 0.5 + 0.5 - (1 - verd) * 0.8) * 3, 0, 1);
  return {
    color: (v) => {
      const lowDark = 1 - clamp((v.y - yLo) / Math.max(1e-4, yHi - yLo), 0, 1);
      return _out
        .copy(cC)
        .lerp(cD, clamp(n1(v) * 0.9 + lowDark * 0.4, 0, 1))
        .lerp(cV, kv(v) * 0.8)
        .lerp(cS, lowDark * lowDark * 0.5);
    },
    rough: (v) => 0.42 + 0.5 * kv(v) + 0.1 * n1(v),
    metal: (v) => 0.92 - 0.7 * kv(v),
    mat: MAT.METAL,
  };
}
/** Old bronze: brown metal going green in patches. */
export function bronzeSpec(verd = 0.5, seed = 0, f = 3.5) {
  const cB = col(PAL.bronze),
    cD = col(PAL.copperDark),
    cV = col(PAL.verdigris);
  const n1 = (v) => _nzM.fbm3(v.x * f + seed + 3, v.y * f, v.z * f - 2, 3) * 0.5 + 0.5;
  const kv = (v) => clamp((_nzM.fbm3(v.x * f * 1.6 + seed, v.y * f * 0.7 + 5, v.z * f * 1.6, 3) * 0.5 + 0.5 - (1 - verd) * 0.8) * 3, 0, 1);
  return {
    color: (v) =>
      _out
        .copy(cB)
        .lerp(cD, n1(v) * 0.6)
        .lerp(cV, kv(v) * 0.7),
    rough: (v) => 0.45 + 0.4 * kv(v),
    metal: (v) => 0.85 - 0.6 * kv(v),
    mat: MAT.METAL,
  };
}
export function brassSpec(seed = 0) {
  const cB = col(PAL.brass),
    cD = col(PAL.bronze);
  const n1 = (v) => _nzM.fbm3(v.x * 9 + seed, v.y * 9, v.z * 9, 2) * 0.5 + 0.5;
  return { color: (v) => _out.copy(cB).lerp(cD, n1(v) * 0.8), rough: (v) => 0.38 + 0.3 * n1(v), metal: 0.9, mat: MAT.METAL };
}
/** Wood with streaks along the part's local Y. tone: base colour; char 0..1 burns it. */
export function woodSpec(tone = PAL.wood, seed = 0, { char = 0, worn = 0.3 } = {}) {
  const cT = col(tone),
    cG = col(PAL.woodGrey),
    cC = col(PAL.char);
  const n1 = (v) => _nzM.fbm3(v.x * 14 + seed, v.y * 1.4 + seed, v.z * 14, 2) * 0.5 + 0.5;
  return {
    color: (v) => {
      const n = n1(v);
      return _out
        .copy(cT)
        .multiplyScalar(0.72 + 0.5 * n)
        .lerp(cG, worn * (1 - n) * 0.8)
        .lerp(cC, clamp(char * (0.6 + 0.8 * n), 0, 1));
    },
    rough: 0.88,
    metal: 0,
    mat: MAT.WOOD,
  };
}
export function stoneSpec(tone = PAL.stone, seed = 0, k = 1) {
  const cT = col(tone),
    cD = col(PAL.stoneDark);
  const n1 = (v) => _nzM.fbm3(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2 + seed, 3) * 0.5 + 0.5;
  return { color: (v) => _out.copy(cT).lerp(cD, n1(v) * 0.6).multiplyScalar(k), rough: 0.95, metal: 0, mat: MAT.STONE };
}

// ---------------------------------------------------------------------------------------------
// Timber
// ---------------------------------------------------------------------------------------------
/** A plank standing on y = 0 with its length (and grain) along +Y. Rotate it where it goes. */
export function plank(len, w, t, { seed = 1, tone = PAL.wood, char = 0, worn = 0.3, rough = 0.012, R = null } = {}) {
  const g = new THREE.BoxGeometry(w, len, t, 1, 2, 1);
  g.translate(0, len / 2, 0);
  const rr = R || new Rng(seed * 131 + 7);
  if (rough > 0) {
    const jx = [rr.range(-1, 1), rr.range(-1, 1), rr.range(-1, 1), rr.range(-1, 1)];
    deform(g, (p) => {
      if (p.y > len - 1e-4) p.y += jx[(p.x > 0 ? 1 : 0) + (p.z > 0 ? 2 : 0)] * rough * 1.6;
      else if (p.y < 1e-4) p.y += jx[(p.x > 0 ? 3 : 2) - (p.z > 0 ? 2 : 0)] * rough * 0.6;
      else p.x += jx[p.z > 0 ? 0 : 1] * rough * 0.5;
    });
  }
  return paint(g, woodSpec(tone, seed * 3.7, { char, worn }));
}
/** A round log along +Y from 0 to len, bark outside, pale ends. */
export function logGeo(len, r, { seed = 1, radial = 7, char = 0, bark = PAL.bark } = {}) {
  const g = cyl(r * 0.94, r, len, radial, 2);
  g.translate(0, len / 2, 0);
  const sp = woodSpec(bark, seed, { char, worn: 0.1 });
  const cEnd = col(char > 0.5 ? PAL.char : PAL.woodLight);
  const colFn = sp.color;
  sp.color = (v) => (Math.abs(v.ny) > 0.9 ? _out.copy(cEnd).multiplyScalar(char > 0.5 ? 1 : 0.7) : colFn(v));
  return paint(g, sp);
}

// ---------------------------------------------------------------------------------------------
// Iron bits
// ---------------------------------------------------------------------------------------------
/** A flat hoop around a drum: radius r, height h (a thin open cylinder standing `t` proud). */
export function hoop(r, h, { t = 0.012, seg = 20, rust = 0.5, seed = 0, y = 0 } = {}) {
  const g = lathe(
    [
      [r, -h / 2, 'hard'],
      [r + t, -h / 2, 'hard'],
      [r + t, h / 2, 'hard'],
      [r, h / 2, 'hard'],
    ],
    seg
  );
  g.translate(0, y, 0);
  return paint(g, ironSpec(rust, seed));
}
/** A ring of rivet heads at radius r, height y. */
export function rivets(r, y, n, { size = 0.018, rust = 0.5, a0 = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    const g = new THREE.ConeGeometry(size, size * 0.8, 4);
    g.rotateX(Math.PI / 2);
    g.translate(0, y, r + size * 0.3);
    g.rotateY(a);
    out.push(g);
  }
  return paint(merge(out), ironSpec(rust, 3));
}
/** A chain from a to b drooping by `sag`. */
export function chain(a, b, { sag = 0.3, link = 0.16, wire = 0.017, rust = 0.65, seed = 1 } = {}) {
  const R = new Rng(seed * 733 + 1);
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const at = (t) => new THREE.Vector3().lerpVectors(A, B, t).add(new THREE.Vector3(0, -4 * sag * t * (1 - t), 0));
  let len = 0;
  let prev = at(0);
  for (let i = 1; i <= 24; i++) {
    const p = at(i / 24);
    len += p.distanceTo(prev);
    prev = p;
  }
  const n = Math.max(2, Math.round(len / (link * 0.72)));
  const out = [];
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0),
    alt = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = at(t);
    const d = at(Math.min(1, t + 0.02))
      .sub(at(Math.max(0, t - 0.02)))
      .normalize();
    const ref = Math.abs(d.y) > 0.92 ? alt : up;
    const u = new THREE.Vector3().copy(ref).addScaledVector(d, -ref.dot(d)).normalize();
    const v = new THREE.Vector3().crossVectors(d, u);
    const roll = (i % 2) * (Math.PI / 2) + R.range(-0.25, 0.25);
    const u2 = u.clone().multiplyScalar(Math.cos(roll)).addScaledVector(v, Math.sin(roll));
    const v2 = new THREE.Vector3().crossVectors(d, u2);
    const g = new THREE.TorusGeometry(link * 0.33, wire, 3, 6);
    g.rotateX(Math.PI / 2); // ring lies in XZ
    g.scale(1.5, 1, 0.82);
    m.makeBasis(d, u2, v2).setPosition(p);
    g.applyMatrix4(m);
    out.push(g);
  }
  return paint(merge(out), ironSpec(rust, seed * 2.3, 9));
}
/** A square-section iron bar through points (a tube with four sides). */
export function bar(points, r = 0.015, { rust = 0.5, seed = 0, samples = 0, radial = 4 } = {}) {
  return paint(tube(points, r, radial, { samples: samples || Math.max(1, (points.length - 1) * 3) }), ironSpec(rust, seed));
}

// ---------------------------------------------------------------------------------------------
// Glass, books, wax, bone
// ---------------------------------------------------------------------------------------------
function profR(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const p = profile[i],
      q = profile[i + 1];
    if ((y >= p[1] && y <= q[1]) || (y <= p[1] && y >= q[1])) {
      const t = Math.abs(q[1] - p[1]) < 1e-9 ? 0 : (y - p[1]) / (q[1] - p[1]);
      return p[0] + (q[0] - p[0]) * t;
    }
  }
  return profile[profile.length - 1][0];
}
/**
 * A glass vessel from a lathe profile [[r, y], ...] (outer wall, bottom to top; start at r = 0).
 * Adds its glass and liquid to the Builder and returns { top, mouth } (height and radius of the mouth).
 *   fill 0..1 of the profile height; liquid colour; glow = emissive of the liquid
 *   cork: true = cork, 'wax' = cork under a wax seal, 'cloth' = tied cloth cap, false = open
 *   xform: { t, r, s } applied to everything (a flask on its side, on a shelf...)
 */
export function vessel(b, profile, o = {}) {
  const { xform = {}, glass = PAL.glass, liquid = '#2c3a2a', glow = 0.0, fill = 0.6, radial = 10, cork = true, wall = 0.005, seed = 1, dirty = 0.35 } = o;
  const y0 = profile[0][1],
    y1 = profile[profile.length - 1][1];
  const cG = col(glass);
  const g = lathe(profile, radial);
  const nz = new Noise(seed * 3 + 1);
  paint(g, {
    color: (v) => _out.copy(cG).multiplyScalar(1 - dirty * (0.5 + 0.5 * nz.n3(v.x * 30, v.y * 30, v.z * 30)) * (0.4 + 0.6 * (1 - (v.y - y0) / (y1 - y0)))),
    rough: 0.08,
    metal: 0,
    mat: MAT.PLAIN,
  });
  b.glass(xf(g, xform));
  if (fill > 0 && liquid) {
    const yf = y0 + (y1 - y0) * fill;
    const pts = [[0, y0 + wall]];
    for (const p of profile) {
      if (p[1] <= y0 + wall || p[1] >= yf) continue;
      pts.push([Math.max(0.001, p[0] - wall), p[1]]);
    }
    const rf = Math.max(0.002, profR(profile, yf) - wall);
    pts.push([rf, yf, 'hard']);
    pts.push([0, yf]);
    const cL = col(liquid);
    const lg = lathe(pts, radial);
    paint(lg, { color: (v) => _out.copy(cL).multiplyScalar(0.55 + 0.6 * clamp((v.y - y0) / Math.max(1e-4, yf - y0), 0, 1)), emissive: glow, rough: 0.2, metal: 0, mat: MAT.PLAIN });
    b.liquid(xf(lg, xform));
  }
  const rm = profile[profile.length - 1][0];
  if (cork) {
    const parts = [];
    if (cork === 'cloth') {
      const c = lathe(
        [
          [rm * 1.25, y1 - rm * 0.9],
          [rm * 1.12, y1 - rm * 0.2],
          [rm * 1.08, y1 + 0.004],
          [0, y1 + 0.008],
        ],
        Math.max(6, radial - 2)
      );
      parts.push(paint(c, { color: PAL.vellum, rough: 0.95, mat: MAT.CLOTH }));
      const tw = torus(rm * 1.1, rm * 0.09, 3, 7);
      tw.translate(0, y1 - rm * 0.35, 0);
      parts.push(paint(tw, { color: PAL.rope, rough: 0.9, mat: MAT.CLOTH }));
    } else {
      const c = cyl(rm * 1.02, rm * 0.86, rm * 2.0, Math.max(6, radial - 3));
      c.translate(0, y1 - rm * 0.2, 0);
      parts.push(paint(c, woodSpec('#8a6a44', seed, { worn: 0.1 })));
      if (cork === 'wax') {
        const wx = lathe(
          [
            [rm * 1.3, y1 - rm * 0.5],
            [rm * 1.22, y1 + rm * 0.5],
            [rm * 0.9, y1 + rm * 0.95],
            [0, y1 + rm * 1.0],
          ],
          Math.max(6, radial - 2)
        );
        parts.push(paint(wx, { color: PAL.blood, rough: 0.45, mat: MAT.PLAIN }));
      }
    }
    b.add(parts.map((p) => xf(p, xform)));
  }
  return { top: y1, mouth: rm };
}
/** Common bottle shapes: profiles standing on y = 0, `h` tall, `r` at the belly. */
export const SHAPES = {
  round: (h, r) => [
    [0, 0],
    [r * 0.55, 0.004],
    [r * 0.95, h * 0.16],
    [r, h * 0.34],
    [r * 0.8, h * 0.54],
    [r * 0.32, h * 0.68],
    [r * 0.28, h * 0.94],
    [r * 0.36, h],
  ],
  jar: (h, r) => [
    [0, 0],
    [r * 0.9, 0.003],
    [r, h * 0.08],
    [r, h * 0.78],
    [r * 0.8, h * 0.88],
    [r * 0.8, h * 0.96],
    [r * 0.88, h],
  ],
  tall: (h, r) => [
    [0, 0],
    [r * 0.9, 0.003],
    [r, h * 0.05],
    [r * 0.95, h * 0.55],
    [r * 0.4, h * 0.7],
    [r * 0.36, h * 0.95],
    [r * 0.46, h],
  ],
  squat: (h, r) => [
    [0, 0],
    [r * 0.7, 0.003],
    [r, h * 0.25],
    [r * 0.92, h * 0.5],
    [r * 0.45, h * 0.72],
    [r * 0.4, h * 0.93],
    [r * 0.5, h],
  ],
  cone: (h, r) => [
    [0, 0],
    [r * 0.96, 0.003],
    [r, h * 0.06],
    [r * 0.3, h * 0.7],
    [r * 0.27, h * 0.95],
    [r * 0.36, h],
  ],
};

/** A closed book lying flat: w along X (spine at -X), d along Z, t thick, bottom on y = 0. */
export function book(w, d, t, { cover = PAL.clothRed, seed = 1, ribs = 0 } = {}) {
  const R = new Rng(seed * 17 + 3);
  const pages = paint(box(w - 0.012, t * 0.76, d - 0.014), { color: (v) => _out.set(PAL.parchment).multiplyScalar(0.62 + 0.25 * R.next()), rough: 0.95, mat: MAT.PLAIN });
  pages.translate(0.004, t / 2, 0);
  // scuffed leather: worn pale at the corners, dark where hands never go
  const cC = col(cover).clone().multiplyScalar(R.range(0.7, 1.1));
  const ks = seed * 1.37;
  const cS = { color: (v) => _out.copy(cC).multiplyScalar(0.7 + 0.55 * (_nzM.fbm3(v.x * 19 + ks, v.y * 19, v.z * 19 + ks, 2) * 0.5 + 0.5)), rough: 0.72, metal: 0, mat: MAT.PLAIN };
  const top = paint(box(w, t * 0.12, d), cS);
  top.translate(0, t * 0.94, 0);
  const bot = paint(box(w, t * 0.12, d), cS);
  bot.translate(0, t * 0.06, 0);
  const spine = paint(box(0.008, t, d), cS);
  spine.translate(-w / 2 + 0.004, t / 2, 0);
  const out = [pages, top, bot, spine];
  // raised bands across the spine
  for (let i = 0; i < ribs; i++) {
    const rb = paint(box(0.012, t * 1.04, 0.008), { color: cC.clone().multiplyScalar(0.55), rough: 0.7, metal: 0, mat: MAT.PLAIN });
    rb.translate(-w / 2 + 0.004, t / 2, ribs === 1 ? 0 : (i / (ribs - 1) - 0.5) * d * 0.56);
    out.push(rb);
  }
  return merge(out);
}
/** A stack of n books on y = 0. Returns { geo, top }. */
export function bookStack(R, n, { w = 0.2, d = 0.27, covers = [PAL.clothRed, PAL.clothBlue, PAL.clothBlack, PAL.woodDark, '#3a3324'] } = {}) {
  const out = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = R.range(0.028, 0.06),
      s = R.range(0.8, 1.1);
    const g = book(w * s, d * s, t, { cover: R.pick(covers), seed: R.int(1, 9999) });
    xf(g, { r: [0, R.range(-0.35, 0.35), 0], t: [R.range(-0.015, 0.015), y, R.range(-0.015, 0.015)] });
    out.push(g);
    y += t;
  }
  return { geo: merge(out), top: y };
}
/** An open book lying face up, centred, bottom on y = 0. w = width of both pages together. */
export function openBook(w, d, { seed = 1, cover = PAL.woodDark, lines = true } = {}) {
  const R = new Rng(seed * 29 + 1);
  const out = [];
  const cov = paint(box(w + 0.02, 0.012, d + 0.016), { color: cover, rough: 0.75, metal: 0, mat: MAT.PLAIN });
  cov.translate(0, 0.006, 0);
  out.push(cov);
  const pageY = (x) => {
    const u = clamp(Math.abs(x) / (w / 2), 0, 1);
    return 0.014 + Math.sin(u * Math.PI) * 0.014 + (1 - u) * 0.004;
  };
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(w / 2 - 0.004, d, 4, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((s * w) / 4, 0, 0);
    deform(g, (p) => {
      p.y = pageY(p.x);
    });
    out.push(paint(g, { color: (v) => _out.set(PAL.parchment).multiplyScalar(0.7 + 0.2 * (Math.abs(v.x) / (w / 2))), rough: 0.92, mat: MAT.PLAIN }));
    const side = paint(box(w / 2 - 0.006, 0.014, d - 0.004), { color: _out.set(PAL.vellum).multiplyScalar(0.7).clone(), rough: 0.95, mat: MAT.PLAIN });
    side.translate((s * w) / 4, 0.014, 0);
    out.push(side);
    if (lines) {
      const nl = 9,
        maxW = w / 2 - 0.05;
      for (let i = 0; i < nl; i++) {
        if (R.chance(0.12)) continue;
        const lw = maxW * R.range(0.6, 1);
        const ln = new THREE.PlaneGeometry(lw, d * 0.022, 3, 1);
        ln.rotateX(-Math.PI / 2);
        ln.translate(s * (w / 4) - (maxW - lw) / 2, 0, -d / 2 + d * 0.12 + (i / nl) * d * 0.78);
        deform(ln, (p) => {
          p.y = pageY(p.x) + 0.0012;
        });
        out.push(paint(ln, { color: PAL.ink, rough: 0.9, mat: MAT.PLAIN }));
      }
    }
  }
  return merge(out);
}
/** A sheet of parchment lying on y = 0, slightly curled. */
export function sheet(w, d, { seed = 1, curl = 0.012, lines = 0 } = {}) {
  const R = new Rng(seed * 41 + 5);
  const g = new THREE.PlaneGeometry(w, d, 3, 3);
  g.rotateX(-Math.PI / 2);
  const c0 = R.range(-1, 1),
    c1 = R.range(-1, 1);
  const yAt = (x, z) => 0.003 + curl * (Math.abs((x / w) * 2) ** 2 * (0.5 + 0.5 * c0) + Math.abs((z / d) * 2) ** 2 * (0.5 + 0.5 * c1)) * 0.5;
  deform(g, (p) => {
    p.y = yAt(p.x, p.z);
  });
  const k = R.range(0.75, 1.05);
  const out = paint(g, { color: (v) => _out.set(PAL.parchment).multiplyScalar(k * (0.85 + 0.15 * Math.sin(v.x * 40 + v.z * 23))), rough: 0.9, mat: MAT.PLAIN });
  if (!lines) return out;
  // written lines that follow the curl of the sheet
  const ink = [];
  for (let i = 0; i < lines; i++) {
    const lw = (i === lines - 1 ? 0.36 : R.range(0.6, 0.8)) * w;
    const ln = new THREE.PlaneGeometry(lw, d * 0.022, 3, 1);
    ln.rotateX(-Math.PI / 2);
    ln.translate(-w * 0.4 + lw / 2, 0, -d * 0.36 + (i / Math.max(1, lines - 1)) * d * 0.68);
    deform(ln, (p) => {
      p.y = yAt(p.x, p.z) + 0.003;
    });
    ink.push(paint(ln, { color: PAL.ink, rough: 0.9, mat: MAT.PLAIN }));
  }
  return merge(out, ink);
}

/** One wax candle standing on y = 0: returns { geo, tip }. */
export function candle(R, h, r = 0.02, { drips = 2, pool = true } = {}) {
  const out = [];
  const body = lathe(
    [
      [r, 0],
      [r * 0.98, h * 0.9],
      [r * 1.14, h - r * 0.5],
      [r * 1.06, h],
      [r * 0.45, h - r * 0.35],
      [0, h - r * 0.4],
    ],
    7
  );
  out.push(body);
  for (let i = 0; i < drips; i++) {
    const a = R.range(0, TAU),
      l = Math.min(h * 0.9, R.range(0.02, 0.09));
    const dx = Math.sin(a) * r * 1.05,
      dz = Math.cos(a) * r * 1.05;
    out.push(
      tube(
        [
          [dx, h - r * 0.3, dz],
          [dx * 1.06, h - l * 0.5, dz * 1.06],
          [dx * 1.02, h - l, dz * 1.02],
        ],
        (t) => r * (0.22 + 0.16 * t),
        4,
        { samples: 3 }
      )
    );
  }
  if (pool) {
    const p = dome(r * R.range(1.7, 2.6), 7, 2, 0.22);
    out.push(p);
  }
  const wax = merge(out.map((g) => paint(g, {})));
  const cW = col(PAL.wax),
    cD = col('#6f6447');
  paint(wax, { color: (v) => _out.copy(cW).lerp(cD, clamp(1 - v.y / Math.max(0.03, h * 0.7), 0, 1) * 0.55), rough: 0.5, metal: 0, mat: MAT.PLAIN });
  const wick = paint(box(0.003, 0.014, 0.003), { color: PAL.soot, rough: 1, mat: MAT.PLAIN });
  wick.translate(0, h - r * 0.4 + 0.007, 0);
  return { geo: merge(wax, wick), tip: [0, h - r * 0.4 + 0.016, 0] };
}

/** A human skull about `s` metres long, resting on y = 0, facing +Z. */
export function skull(s = 0.19, { seed = 1, jaw = true } = {}) {
  const out = [];
  const cB = col(PAL.boneOld),
    cL = col(PAL.bone),
    cK = col('#0c0a08');
  const cran = sphere(0.5, 9, 7);
  cran.scale(0.78, 0.8, 1.0);
  cran.translate(0, 0.62, -0.08);
  out.push(cran);
  const face = box(0.56, 0.42, 0.3, 0.08, 1);
  face.translate(0, 0.36, 0.3);
  out.push(face);
  if (jaw) {
    const j = box(0.44, 0.16, 0.36, 0.05, 1);
    j.translate(0, 0.1, 0.22);
    out.push(j);
  }
  const g = merge(out.map((q) => paint(q, {})));
  const nz = new Noise(seed + 77);
  paint(g, { color: (v) => _out.copy(cB).lerp(cL, clamp(v.y * 1.1 + nz.n3(v.x * 6, v.y * 6, v.z * 6) * 0.25, 0, 1)), rough: 0.8, metal: 0, mat: MAT.PLAIN });
  const dark = [];
  for (const sx of [-1, 1]) {
    const e = sphere(0.105, 6, 5);
    e.scale(1, 1.05, 0.5);
    e.translate(sx * 0.15, 0.47, 0.44);
    dark.push(e);
  }
  const nose = new THREE.ConeGeometry(0.055, 0.12, 3);
  nose.translate(0, 0.31, 0.455);
  dark.push(nose);
  const teeth = box(0.34, 0.035, 0.02);
  teeth.translate(0, 0.19, 0.452);
  const d = merge(dark.map((q) => paint(q, { color: cK, rough: 1, mat: MAT.PLAIN })));
  const all = merge(g, d, paint(teeth, { color: PAL.bone, rough: 0.7, mat: MAT.PLAIN }));
  all.scale(s, s, s);
  // refresh detail coordinates after the uniform scale so the grain is in metres
  all.attributes.aUvw.array.set(all.attributes.position.array);
  return all;
}

/** A Prime sign ('sulfur' | 'mercury' | 'salt') as strokes facing +Z, `size` tall, centred on the origin. Cold: it reads as a carved, soot-filled groove. */
export function glyph(name, size, { color = '#100d0b', width = 0.055, depth = 0.016 } = {}) {
  const g = strokes(GLYPH[name], width, depth / size);
  g.scale(size, size, size);
  return paint(g, { color, rough: 1, metal: 0, mat: MAT.STONE });
}

const _Y = new THREE.Vector3(0, 1, 0);
/** Lay a geometry built along +Y (from y = 0 to len) onto the segment a -> b. make(len) returns the geometry. */
export function strut(a, b, make, roll = 0) {
  const A = new THREE.Vector3(a[0], a[1], a[2]),
    B = new THREE.Vector3(b[0], b[1], b[2]);
  const d = B.clone().sub(A);
  const len = d.length();
  const g = make(len);
  if (roll) g.rotateY(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A deformed lathe has a crease where its first and last columns meet: average the normals there. */
export function seamNormals(g, radial) {
  const nor = g.attributes.normal,
    cols = radial + 1;
  for (let j = 0; (j + 1) * cols <= nor.count; j++) {
    const a = j * cols,
      b = a + radial;
    const x = nor.getX(a) + nor.getX(b),
      y = nor.getY(a) + nor.getY(b),
      z = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l);
    nor.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

const _nzH = new Noise(4421);
/**
 * Knock a lathe out of true, as if it were hewn or thrown by hand: every vertex moves along its
 * radius by up to `amp` (fbm of position at `freq`), and `squash` makes the plan slightly oval.
 */
export function hewn(g, radial, { amp = 0.01, freq = 3, seed = 0, squash = 0 } = {}) {
  deform(g, (p) => {
    const rr = Math.hypot(p.x, p.z);
    if (rr < 1e-5) return;
    const a = Math.atan2(p.z, p.x);
    const d = amp * _nzH.fbm3(p.x * freq + seed * 3.7, p.y * freq + seed, p.z * freq, 3) + squash * rr * Math.cos(2 * a + seed);
    const k = 1 + d / rr;
    p.x *= k;
    p.z *= k;
  });
  return seamNormals(g, radial);
}
