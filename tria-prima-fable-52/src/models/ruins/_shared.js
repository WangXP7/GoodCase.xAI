// Shared builders for what people left behind on Morne: coursed masonry that breaks the way real
// walls break, dressed arches, loose stones, weathered timber, rusted iron.
// Used only by the models in this folder.
import { THREE, Rng, Noise, MAT, PAL, col, mixc, paint, tube } from '../kit.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Tris: a flat-shaded triangle writer that produces kit geometry (color, aFx, aMat, aUvw) directly.
// ---------------------------------------------------------------------------------------------
const _e1 = new THREE.Vector3(),
  _e2 = new THREE.Vector3(),
  _nn = new THREE.Vector3(),
  _pa = new THREE.Vector3(),
  _pb = new THREE.Vector3(),
  _pc = new THREE.Vector3();

export class Tris {
  constructor({ mat = MAT.STONE, rough = 0.92, metal = 0, emissive = 0, sway = 0 } = {}) {
    this.P = [];
    this.N = [];
    this.C = [];
    this.U = [];
    this.F = [];
    this.M = [];
    this.mat = mat;
    this.rough = rough;
    this.metal = metal;
    this.emissive = emissive;
    this.sway = sway;
    this.ux = 0;
    this.uy = 0;
    this.uz = 0;
    this.gs = [1, 1, 1]; // scale of the detail coordinates: [3, 0.6, 3] draws the grain out into vertical streaks
    this.mx = null; // optional Matrix4 applied to every position written
  }
  get tris() {
    return this.P.length / 9;
  }
  /** Offset the detail coordinates of what follows, so every stone gets its own grain. */
  grain(rng) {
    this.ux = rng.range(-40, 40);
    this.uy = rng.range(-40, 40);
    this.uz = rng.range(-40, 40);
    return this;
  }
  /** A triangle. With na, nb, nc it is smooth shaded with those normals, otherwise flat. */
  tri(a, b, c, ca, cb = ca, cc = ca, na = null, nb = null, nc = null) {
    const ux = this.ux,
      uy = this.uy,
      uz = this.uz;
    const gx = this.gs[0],
      gy = this.gs[1],
      gz = this.gs[2];
    const u0 = a.x * gx + ux,
      u1 = a.y * gy + uy,
      u2 = a.z * gz + uz,
      u3 = b.x * gx + ux,
      u4 = b.y * gy + uy,
      u5 = b.z * gz + uz,
      u6 = c.x * gx + ux,
      u7 = c.y * gy + uy,
      u8 = c.z * gz + uz;
    if (this.mx) {
      a = _pa.copy(a).applyMatrix4(this.mx);
      b = _pb.copy(b).applyMatrix4(this.mx);
      c = _pc.copy(c).applyMatrix4(this.mx);
    }
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _nn.crossVectors(_e1, _e2);
    const l = _nn.length();
    if (l < 1e-10) return this;
    _nn.multiplyScalar(1 / l);
    this.U.push(u0, u1, u2, u3, u4, u5, u6, u7, u8);
    this.P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (na) {
      for (const n of [na, nb, nc]) {
        _e1.copy(n);
        if (this.mx) _e1.transformDirection(this.mx);
        else _e1.normalize();
        this.N.push(_e1.x, _e1.y, _e1.z);
      }
    } else this.N.push(_nn.x, _nn.y, _nn.z, _nn.x, _nn.y, _nn.z, _nn.x, _nn.y, _nn.z);
    this.C.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    for (let i = 0; i < 3; i++) {
      this.F.push(this.emissive, this.rough, this.metal, this.sway);
      this.M.push(this.mat);
    }
    return this;
  }
  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca, na = null, nb = null, nc = null, nd = null) {
    this.tri(a, b, c, ca, cb, cc, na, nb, nc);
    this.tri(a, c, d, ca, cc, cd, na, nc, nd);
    return this;
  }
  /** A quad whose normal is made to agree with `out` (given in the writer's local space). */
  quadOut(a, b, c, d, out, ca, cb = ca, cc = ca, cd = ca, na = null, nb = null, nc = null, nd = null) {
    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _nn.crossVectors(_e1, _e2);
    if (_nn.dot(out) < 0) return this.quad(a, d, c, b, ca, cd, cc, cb, na, nd, nc, nb);
    return this.quad(a, b, c, d, ca, cb, cc, cd, na, nb, nc, nd);
  }
  triOut(a, b, c, out, ca, cb = ca, cc = ca) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _nn.crossVectors(_e1, _e2);
    if (_nn.dot(out) < 0) return this.tri(a, c, b, ca, cc, cb);
    return this.tri(a, b, c, ca, cb, cc);
  }
  build() {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.F, 4));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.M, 1));
    g.setAttribute('aUvw', new THREE.Float32BufferAttribute(this.U, 3));
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Colour: stone tones and weathering
// ---------------------------------------------------------------------------------------------
/** The colour of one stone: the base drifted toward its warm, pale and dark neighbours. */
export function stoneTone(rng, { base = PAL.stone, warm = 0.3, vary = 0.14 } = {}) {
  const other = rng.chance(warm) ? PAL.stoneWarm : rng.chance(0.5) ? PAL.stoneLight : PAL.stoneDark;
  // (one quarry: the stones differ a little, they are not a patchwork)
  const c = mixc(base, other, rng.range(0, 0.34)).multiplyScalar(1 + rng.range(-vary, vary) * 0.65);
  // now and then a stone from another quarry, or one the rain has turned black
  if (rng.chance(0.045)) c.lerp(col(rng.chance(0.5) ? '#2c2b2b' : '#6a5a4a'), 0.4);
  return c;
}

/**
 * Returns shadeAt(p, c, up) -> c, which ages a colour by where it sits:
 * rain streaks and tonal drift, damp near the ground, moss low down and on anything that looks at
 * the sky, pale lichen blotches, soot around `sootAt` points, an algae band below `water`.
 *   p: world position, c: THREE.Color (mutated), up: 0..1 how much the face looks upward.
 */
export function weathering({ seed = 1, moss = 0.6, mossTop = 1.5, lichen = 0.35, grime = 0.5, ground = 0, sootAt = null, soot = 0.85, water = null } = {}) {
  const nz = new Noise(seed * 31 + 7);
  const cMoss = col(PAL.moss),
    cMossD = col('#262f1c'),
    cLichen = col(PAL.lichen),
    cSoot = col(PAL.soot),
    cAlgae = col('#1d2a1c');
  return (p, c, up = 0) => {
    const y = p.y - ground;
    const tone = nz.fbm3(p.x * 0.4, p.y * 0.4, p.z * 0.4, 3);
    const streak = nz.n3(p.x * 2.3, p.y * 0.22, p.z * 2.3);
    c.multiplyScalar(1 + tone * 0.3 * grime - Math.max(0, streak) * 0.24 * grime);
    c.multiplyScalar(1 - clamp01(1 - y / 0.9) * 0.28);
    if (moss > 0) {
      const m = nz.fbm3(p.x * 1.1 + 9, p.y * 1.1, p.z * 1.1 - 4, 3) * 0.5 + 0.5;
      const want = clamp01(Math.max(0, 1 - y / mossTop) * 0.85 + up * 0.6) * moss;
      const k = sstep(1 - want * 0.95, 1 - want * 0.95 + 0.16, m + 0.12);
      if (k > 0) c.lerp(m > 0.6 ? cMoss : cMossD, k * 0.85);
    }
    if (lichen > 0) {
      const l = nz.n3(p.x * 2.9 - 3, p.y * 2.9 + 11, p.z * 2.9);
      const k = sstep(0.5 - lichen * 0.35, 0.62 - lichen * 0.35, l);
      if (k > 0) c.lerp(cLichen, k * 0.45);
    }
    if (sootAt) {
      let s = 0;
      for (const a of sootAt) {
        const dx = p.x - a[0],
          dy = p.y - a[1],
          dz = p.z - a[2];
        const r = a[3] || 1.6;
        // soot climbs: the stain is stretched upward from the fire
        const d = Math.sqrt(dx * dx + dz * dz + (dy > 0 ? (dy / 2.4) * (dy / 2.4) : dy * 2 * (dy * 2))) / r;
        s = Math.max(s, 1 - d);
      }
      if (s > 0) c.lerp(cSoot, clamp01(s * 1.4 * (0.7 + 0.5 * nz.n3(p.x * 3, p.y * 3, p.z * 3))) * soot);
    }
    if (water !== null) {
      const d = p.y - water;
      if (d < 0.7) {
        const k = sstep(0.7, -0.2, d + nz.n3(p.x * 1.7, 0, p.z * 1.7) * 0.25);
        c.lerp(cAlgae, k * 0.75);
        if (d > -0.15 && d < 0.5) c.multiplyScalar(1 + 0.25 * Math.max(0, nz.n3(p.x * 9, p.y * 9, p.z * 9)));
      }
    }
    return c;
  };
}

// ---------------------------------------------------------------------------------------------
// Dressed stones
// ---------------------------------------------------------------------------------------------
/**
 * One stone seen from its faces. `q` = its four corners as [u, v] in the plane of the wall.
 * `map(u, v, w)` places a point: w runs through the wall, wF is the front face, wB the back.
 * A face is a shallow pillow: its border sits `joint` behind the face and is painted dark, so
 * neighbouring stones meet in a V joint without any gap.
 *   o.front / o.back: true (pillow) | 'plain' (one flat quad) | false
 *   o.sides: [bool x4] which edges (q0-q1, q1-q2, q2-q3, q3-q0) get a face through the wall
 *   o.up:    [0..1 x4] how much each side looks at the sky (moss)
 *   o.ridge: [bool x4] break that side into a ragged ridge (the broken top of a wall)
 */
export function stoneBlock(T, map, q, wF, wB, o) {
  const rng = o.rng;
  const joint = o.joint ?? 0.02,
    bevel = o.bevel ?? 0.028,
    bump = o.bump ?? 0.014;
  const shade = o.shadeAt || null;
  const c0 = o.color;
  const s = wF >= wB ? 1 : -1;
  let cu = 0,
    cv = 0;
  for (const p of q) {
    cu += p[0] * 0.25;
    cv += p[1] * 0.25;
  }
  T.grain(rng);
  const colAt = (p, k, up = 0) => {
    const c = c0.clone();
    if (shade) shade(p, c, up);
    return k === 1 ? c : c.multiplyScalar(k);
  };
  const face = (w, dir, plain) => {
    const out = map(cu, cv, w + dir).sub(map(cu, cv, w));
    if (plain) {
      const P = q.map((p) => map(p[0], p[1], w));
      T.quadOut(P[0], P[1], P[2], P[3], out, colAt(P[0], 0.92), colAt(P[1], 0.92), colAt(P[2], 0.92), colAt(P[3], 0.92));
      return;
    }
    // most stones stand a few millimetres proud or shy; a few are badly eroded; `pocket` = the
    // face stone is gone and the dark core of the wall shows
    const pocket = o.pocket === true || o.pocket === (dir === s ? 'front' : 'back');
    const b0 = pocket ? -rng.range(0.14, 0.24) : rng.chance(0.1) ? -rng.range(0.02, 0.05) : rng.range(-bump, bump);
    const chipped = pocket ? -1 : rng.chance(0.16) ? rng.int(0, 3) : -1;
    out.normalize();
    const pc = map(cu, cv, w);
    const O = [],
      I = [],
      CO = [],
      CI = [],
      NO = [],
      NI = [];
    for (let i = 0; i < 4; i++) {
      const du = cu - q[i][0],
        dv = cv - q[i][1];
      const k = i === chipped ? rng.range(2.5, 4.5) : pocket ? 0.5 : 1;
      const iu = Math.sign(du) * Math.min(Math.abs(du) * 0.7, bevel * k * rng.range(0.6, 1.5));
      const iv = Math.sign(dv) * Math.min(Math.abs(dv) * 0.7, bevel * k * rng.range(0.6, 1.5));
      O.push(map(q[i][0], q[i][1], w - dir * joint));
      I.push(map(q[i][0] + iu, q[i][1] + iv, w + dir * (b0 + rng.range(-0.5, 0.5) * bump - (i === chipped ? 0.02 : 0))));
      CO.push(colAt(O[i], pocket ? 0.55 : 0.38));
      CI.push(colAt(I[i], pocket ? 0.3 : 1));
      // worn arrises: the shading normal rolls over toward the joint instead of breaking on a crease
      const side = O[i].clone().sub(pc);
      side.addScaledVector(out, -side.dot(out)).normalize();
      NO.push(out.clone().addScaledVector(side, pocket ? -0.9 : 0.95));
      NI.push(out.clone().addScaledVector(side, pocket ? 0 : 0.14));
    }
    T.quadOut(I[0], I[1], I[2], I[3], out, CI[0], CI[1], CI[2], CI[3], NI[0], NI[1], NI[2], NI[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      T.quadOut(O[i], O[j], I[j], I[i], out, CO[i], CO[j], CI[j], CI[i], NO[i], NO[j], NI[j], NI[i]);
    }
  };
  if (o.front !== false) face(wF, s, o.front === 'plain');
  if (o.back) face(wB, -s, o.back === 'plain');
  if (o.sides) {
    const mid = map(cu, cv, (wF + wB) / 2);
    for (let i = 0; i < 4; i++) {
      if (!o.sides[i]) continue;
      const j = (i + 1) & 3;
      const a = map(q[i][0], q[i][1], wF - s * joint),
        b = map(q[j][0], q[j][1], wF - s * joint);
      const c = map(q[j][0], q[j][1], wB + s * joint),
        d = map(q[i][0], q[i][1], wB + s * joint);
      const out = a.clone().add(c).multiplyScalar(0.5).sub(mid);
      const up = o.up ? o.up[i] : 0;
      const k = 0.8;
      if (o.ridge && o.ridge[i]) {
        const n = out.clone().normalize();
        const mi = a.clone().lerp(d, rng.range(0.3, 0.7)).addScaledVector(n, rng.range(0.02, 0.11));
        const mj = b.clone().lerp(c, rng.range(0.3, 0.7)).addScaledVector(n, rng.range(0.02, 0.11));
        T.quadOut(a, b, mj, mi, out, colAt(a, k, up), colAt(b, k, up), colAt(mj, k * 0.9, up), colAt(mi, k * 0.9, up));
        T.quadOut(mi, mj, c, d, out, colAt(mi, k * 0.9, up), colAt(mj, k * 0.9, up), colAt(c, k, up), colAt(d, k, up));
      } else T.quadOut(a, b, c, d, out, colAt(a, k, up), colAt(b, k, up), colAt(c, k, up), colAt(d, k, up));
    }
  }
}

/**
 * A loose stone: a box with every corner knocked a little out of true, written through the
 * writer's current matrix. Centred on the origin of that matrix.
 */
export function looseStone(T, w, h, d, { rng, color, shadeAt = null, j = 0.035, chip = 0.5 } = {}) {
  const P = [];
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1,
      sy = i & 2 ? 1 : -1,
      sz = i & 4 ? 1 : -1;
    P.push(V3((sx * w) / 2 + rng.range(-j, j), (sy * h) / 2 + rng.range(-j, j), (sz * d) / 2 + rng.range(-j, j)));
  }
  if (rng.chance(chip)) P[rng.int(0, 7)].multiplyScalar(rng.range(0.55, 0.8)); // one corner broken off
  T.grain(rng);
  const world = new THREE.Vector3();
  const colAt = (p, k, up) => {
    const c = color.clone().multiplyScalar(k);
    if (shadeAt) shadeAt(T.mx ? world.copy(p).applyMatrix4(T.mx) : p, c, up);
    return c;
  };
  const F = [
    [0, 1, 3, 2, V3(0, 0, -1)],
    [4, 5, 7, 6, V3(0, 0, 1)],
    [0, 2, 6, 4, V3(-1, 0, 0)],
    [1, 3, 7, 5, V3(1, 0, 0)],
    [2, 3, 7, 6, V3(0, 1, 0)],
    [0, 1, 5, 4, V3(0, -1, 0)],
  ];
  for (const [a, b, c, e, out] of F) {
    const k = rng.range(0.86, 1.06);
    // how much this face looks up once the stone has been thrown down
    const up = (T.mx ? Math.max(0, out.clone().transformDirection(T.mx).y) : Math.max(0, out.y)) * 0.5;
    T.quadOut(P[a], P[b], P[c], P[e], out, colAt(P[a], k, up), colAt(P[b], k, up), colAt(P[c], k, up), colAt(P[e], k, up));
  }
}

const _mPos = new THREE.Vector3(),
  _mQuat = new THREE.Quaternion(),
  _mEul = new THREE.Euler(),
  _mScl = new THREE.Vector3(1, 1, 1);
/** Run fn with the writer's matrix set to a position + XYZ rotation. */
export function placed(T, t, r, fn) {
  const prev = T.mx;
  const m = new THREE.Matrix4().compose(_mPos.set(t[0], t[1], t[2]), _mQuat.setFromEuler(_mEul.set(r[0], r[1], r[2], 'XYZ')), _mScl);
  T.mx = prev ? prev.clone().multiply(m) : m;
  fn();
  T.mx = prev;
}

/** Stones that fell where a wall failed: spots = [[x, z], ...], half sunk into the ground. */
export function fallen(T, rng, spots, { size = [0.28, 0.6], shadeAt = null, y = 0, tone = null } = {}) {
  for (const [x, z] of spots) {
    const w = rng.range(size[0], size[1]),
      h = w * rng.range(0.45, 0.75),
      d = w * rng.range(0.6, 0.95);
    const tilt = rng.chance(0.3) ? 0.55 : 0.2;
    placed(T, [x, y + h * rng.range(0.12, 0.4), z], [rng.range(-tilt, tilt), rng.range(0, 6.283), rng.range(-tilt, tilt)], () =>
      looseStone(T, w, h, d, { rng, color: tone ? tone(rng) : stoneTone(rng), shadeAt })
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Coursed masonry
// ---------------------------------------------------------------------------------------------
/**
 * Lay out courses of blocks over the rectangle u0..u1, v0..v1 of a wall.
 * Returns rows: [{ v0, v1, cells: [{ u0, u1, v0, v1 }] }]. `breaks`: heights where a course must
 * end (sills, springing lines). `wrap`: the wall closes on itself (a tower), rows start at a
 * random phase so no joint runs up the whole wall.
 */
export function courseLevels({ v0, v1, course = [0.28, 0.36], rng, breaks = [] }) {
  const lv = [v0];
  const bk = breaks.filter((b) => b > v0 + 0.05 && b < v1 - 0.05).sort((a, b) => a - b);
  let v = v0;
  let guard = 0;
  while (v < v1 - 1e-3 && guard++ < 500) {
    let h = rng.range(course[0], course[1]) * (rng.chance(0.16) ? 0.68 : 1);
    const next = bk.find((b) => b > v + 1e-3);
    const limit = next !== undefined ? next : v1;
    if (v + h > limit - course[0] * 0.55) h = limit - v;
    if (h > course[1] * 1.45) h /= 2;
    v += h;
    lv.push(v);
  }
  return lv;
}
export function courses({ u0, u1, v0, v1, course = [0.28, 0.36], len = [0.5, 0.9], rng, wrap = false, breaks = [], levels = null }) {
  const rows = [];
  const lv = levels || courseLevels({ v0, v1, course, rng, breaks });
  for (let r = 0; r < lv.length - 1; r++) {
    const v = lv[r],
      h = lv[r + 1] - lv[r];
    const L = u1 - u0;
    const lens = [];
    let sum = 0;
    while (sum < L - 1e-6) {
      const l = rng.range(len[0], len[1]);
      lens.push(l);
      sum += l;
    }
    const k = L / sum;
    let u = u0 + (wrap ? rng.range(0, len[1]) : 0);
    const cells = [];
    for (const l of lens) {
      cells.push({ u0: u, u1: u + l * k, v0: v, v1: v + h });
      u += l * k;
    }
    rows.push({ v0: v, v1: v + h, cells });
  }
  return rows;
}

/** A pointed opening: half width a, vertical jambs from sill to spring, then two arcs. k = 0 round, 1 equilateral, 2 lancet. */
export function archOpening(cu, a, sill, spring, k = 1) {
  const c = k * a,
    R = a + c,
    rise = Math.sqrt(R * R - c * c);
  return {
    cu,
    a,
    sill,
    spring,
    c,
    R,
    apex: spring + rise,
    th: Math.acos(c / R),
    half(v) {
      if (v <= sill || v >= spring + rise) return 0;
      if (v <= spring) return a;
      const dy = v - spring;
      return Math.max(0, -c + Math.sqrt(Math.max(0, R * R - dy * dy)));
    },
  };
}
export function rectOpening(cu, a, sill, top) {
  return { cu, a, sill, spring: top, apex: top, flat: true, half: (v) => (v > sill && v < top ? a : 0) };
}

/** Cut openings out of laid courses. Blocks are trimmed at the jambs, never dropped whole. */
export function cut(rows, openings, { wrapL = 0, minLen = 0.14 } = {}) {
  for (const row of rows) {
    for (const o of openings) {
      // the course under a sill keeps a level top
      if (Math.abs(row.v1 - o.sill) < 2e-3) for (const c of row.cells) if (c.u1 > o.cu - o.a - 0.3 && c.u0 < o.cu + o.a + 0.3) c.level = true;
      if (row.v1 <= o.sill + 1e-3 || row.v0 >= o.apex - 1e-3) continue;
      const hw = o.half(Math.max(row.v0, o.sill) + 2e-3);
      if (hw <= 0) continue;
      for (const shift of wrapL ? [-wrapL, 0, wrapL] : [0]) {
        const a = o.cu - hw + shift,
          b = o.cu + hw + shift;
        const out = [];
        for (const c of row.cells) {
          if (c.u1 <= a || c.u0 >= b) {
            out.push(c);
            continue;
          }
          if (c.u0 < a) out.push({ ...c, u1: a, cutR: true });
          if (c.u1 > b) out.push({ ...c, u0: b, cutL: true });
        }
        // hand slivers to a neighbour that touches them, so no slot is left beside a jamb
        for (let i = 0; i < out.length; i++) {
          const c = out[i];
          if (c.u1 - c.u0 >= minLen) continue;
          const p = out[i - 1],
            n = out[i + 1];
          if (p && Math.abs(p.u1 - c.u0) < 1e-6) {
            p.u1 = c.u1;
            out.splice(i--, 1);
          } else if (n && Math.abs(n.u0 - c.u1) < 1e-6) {
            n.u0 = c.u0;
            out.splice(i--, 1);
          }
        }
        row.cells = out;
      }
    }
  }
  return rows;
}

/** Drop the blocks for which keep(cell, uMid, vMid) is false (a broken top, a breach). */
export function prune(rows, keep) {
  for (const row of rows) row.cells = row.cells.filter((c) => keep(c, (c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2));
  return rows;
}

export function covered(rows, u, v, wrapL = 0) {
  for (const row of rows) {
    if (v < row.v0 || v >= row.v1) continue;
    for (const c of row.cells) {
      if (u >= c.u0 && u <= c.u1) return true;
      if (wrapL && ((u + wrapL >= c.u0 && u + wrapL <= c.u1) || (u - wrapL >= c.u0 && u - wrapL <= c.u1))) return true;
    }
    return false;
  }
  return false;
}

/**
 * Write laid courses as stones. Faces are pillows; wherever a neighbour is missing the stone gets
 * a face through the wall, and stones left at a broken top are knocked down and ragged.
 *   map(u, v, w), wF, wB       see stoneBlock
 *   back: false | true | 'plain' | (cell) => one of those
 *   detail: (cell) => 'pillow' | 'plain'      cheap flat faces where nobody will stand close
 *   returns: (cell) => bool                   false = never give this stone side faces
 *   base: stones resting on this height get no underside
 *   pockets: chance that an inner stone has lost its face    debris: chance of rubble on a broken top
 *   clip: (u) => v             cut the stones to a sloping top line
 *   solid: (u, v) => bool      masonry that is not in `rows` (the wall round the corner, a chimney)
 */
export function masonry(T, rows, o) {
  const { map, wF, wB, rng, shadeAt = null, base = -1e9, wrapL = 0, chip = 0.45 } = o;
  const tone = o.tone || (() => stoneTone(rng));
  const has = (u, v) => covered(rows, u, v, wrapL) || (o.solid ? o.solid(u, v) : false);
  const e = 0.012;
  for (const row of rows) {
    for (const c of row.cells) {
      const um = (c.u0 + c.u1) / 2,
        vm = (c.v0 + c.v1) / 2,
        L = c.u1 - c.u0;
      const left = !has(c.u0 - e, vm),
        right = !has(c.u1 + e, vm);
      const tA = !has(c.u0 + L * 0.2, c.v1 + e),
        tB = !has(um, c.v1 + e),
        tC = !has(c.u1 - L * 0.2, c.v1 + e);
      const top = tA || tB || tC,
        open = tA && tB && tC;
      const bottom = c.v0 > base + e && (!has(c.u0 + L * 0.2, c.v0 - e) || !has(um, c.v0 - e) || !has(c.u1 - L * 0.2, c.v0 - e));
      let vL = c.v1,
        vR = c.v1,
        uL = c.u0,
        uR = c.u1;
      const ragged = chip > 0 && !c.level;
      if (open && ragged) {
        const h = c.v1 - c.v0;
        vL -= rng.range(0, chip) * h;
        vR -= rng.range(0, chip) * h;
      }
      // a stone at a broken end is broken itself: its exposed top corner is gone
      if (top && ragged) {
        if (left && !c.cutL) uL += rng.range(0, 0.4) * L;
        if (right && !c.cutR) uR -= rng.range(0, 0.4) * L;
      }
      if (o.clip) {
        // a raking top (a gable under its roof): stones are cut to the slope
        vL = Math.min(vL, o.clip(uL));
        vR = Math.min(vR, o.clip(uR));
        if (vL < c.v0 + 0.03 && vR < c.v0 + 0.03) continue;
        vL = Math.max(vL, c.v0 + 0.004);
        vR = Math.max(vR, c.v0 + 0.004);
      }
      const q = [
        [c.u0, c.v0],
        [c.u1, c.v0],
        [uR, vR],
        [uL, vL],
      ];
      const mode = o.detail ? o.detail(c) : 'pillow';
      let back = typeof o.back === 'function' ? o.back(c) : o.back || false;
      if (back && mode === 'plain') back = 'plain';
      const ret = o.returns ? o.returns(c) : true;
      const inside = !left && !right && !top && !bottom;
      stoneBlock(T, map, q, wF, wB, {
        rng,
        color: tone(c, rng),
        shadeAt,
        front: mode === 'plain' ? 'plain' : true,
        back,
        sides: ret ? [bottom, right, top, left] : null,
        up: [0, 0, 1, 0],
        ridge: [false, false, open && o.ridge !== false && !c.level, false],
        joint: o.joint,
        bevel: o.bevel,
        bump: o.bump,
        pocket: inside && mode !== 'plain' && o.pockets && rng.chance(o.pockets) ? (back === true && rng.chance(0.5) ? 'back' : 'front') : false,
      });
      // rubble left lying on the broken top
      if (open && ragged && o.debris && rng.chance(o.debris)) {
        const sz = rng.range(0.12, 0.26);
        const p = map(lerp(uL, uR, rng.range(0.25, 0.75)), Math.min(vL, vR) + sz * 0.28, lerp(wB, wF, rng.range(0.25, 0.75)));
        placed(T, [p.x, p.y, p.z], [rng.range(-0.4, 0.4), rng.range(0, 6.283), rng.range(-0.4, 0.4)], () =>
          looseStone(T, sz, sz * rng.range(0.5, 0.8), sz * rng.range(0.6, 1), { rng, color: tone(c, rng), shadeAt, j: sz * 0.12 })
        );
      }
    }
  }
}

/**
 * The dressed stones of one flank of an arch: wedges along a circular arc of the intrados.
 *   arc: { cx, cy, R, t0, t1 }   centre, radius and sweep (radians, counter-clockwise from +u)
 *   clampU: the crown stone is cut on this vertical line (the apex of a pointed arch)
 *   mirror: build the other flank, reflected about u = clampU
 *   free: the ring stands clear of any walling, so its back (extrados) and ends are faced too
 */
export function voussoirs(T, map, arc, o) {
  const { n, depth, wF, wB, rng, shadeAt = null, clampU = null, mirror = false, free = false, soffit = true, proud = 0.03 } = o;
  const tone = o.tone || (() => stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }));
  const s = wF >= wB ? 1 : -1;
  const pt = (t, r) => [arc.cx + r * Math.cos(t), arc.cy + r * Math.sin(t)];
  const mir = (p) => (mirror ? [2 * clampU - p[0], p[1]] : p);
  for (let i = 0; i < n; i++) {
    const ta = lerp(arc.t0, arc.t1, i / n),
      tb = lerp(arc.t0, arc.t1, (i + 1) / n);
    const d = depth * rng.range(0.9, 1.12);
    const Ri = arc.R - 0.018; // the soffit stands a little inside the opening, clear of the walling behind
    let inA = pt(ta, Ri),
      outA = pt(ta, arc.R + d),
      inB = pt(tb, Ri),
      outB = pt(tb, arc.R + d);
    const last = i === n - 1;
    if (last && clampU !== null) {
      const dx = clampU - arc.cx;
      inB = [clampU, arc.cy + Math.sqrt(Math.max(0, Ri * Ri - dx * dx))];
      outB = [clampU, arc.cy + Math.sqrt(Math.max(0, (arc.R + d) * (arc.R + d) - dx * dx))];
    }
    stoneBlock(T, map, [mir(inA), mir(outA), mir(outB), mir(inB)], wF + s * proud, wB - s * proud, {
      rng,
      color: tone(rng),
      shadeAt,
      front: true,
      back: true,
      sides: [free && i === 0, free, free && last && clampU === null, soffit],
      up: [0, 0.6, 0, 0],
      joint: o.joint ?? 0.018,
      bevel: o.bevel ?? 0.03,
      bump: o.bump ?? 0.008,
    });
  }
}

/**
 * Dress a pointed opening made with archOpening: both flanks of voussoirs, and long-and-short
 * jamb stones from sill to springing.
 */
export function dressArch(T, map, op, o) {
  const { wF, wB, rng, shadeAt = null, depth = 0.34, jambs = true, free = false, proud = 0.03 } = o;
  const tone = o.tone || (() => stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }));
  const s = wF >= wB ? 1 : -1;
  const n = o.n || Math.max(3, Math.round((op.R * op.th) / 0.34));
  for (const mirror of [false, true]) {
    voussoirs(T, map, { cx: op.cu - op.c, cy: op.spring, R: op.R, t0: 0, t1: op.th }, { ...o, n, depth, clampU: op.cu, mirror, tone, free, proud });
  }
  if (jambs && op.spring > op.sill + 0.1) {
    for (const dir of [1, -1]) {
      let v = op.sill,
        long = rng.chance(0.5);
      while (v < op.spring - 1e-3) {
        let h = rng.range(0.3, 0.44);
        if (v + h > op.spring - 0.16) h = op.spring - v;
        const l = long ? rng.range(0.4, 0.52) : rng.range(0.24, 0.3);
        const ua = op.cu + dir * (op.a - 0.018),
          ub = op.cu + dir * (op.a + l);
        stoneBlock(
          T,
          map,
          [
            [ua, v],
            [ub, v],
            [ub, v + h],
            [ua, v + h],
          ],
          wF + s * proud,
          wB - s * proud,
          { rng, color: tone(rng), shadeAt, front: true, back: true, sides: [false, false, false, true], joint: 0.018, bevel: 0.03, bump: 0.008 }
        );
        v += h;
        long = !long;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Timber, iron, rope (kit geometry, painted). Everything is built along +Y from the origin.
// ---------------------------------------------------------------------------------------------
/**
 * A sawn timber: a board, a beam or a rafter of length `len` along +Y.
 *   broken: 0 whole | 1 splintered at the far end | 2 at both ends
 *   bow: metres of sag at mid length (toward -Z)      char: 0..1 burnt
 */
export function timber(len, w, t, { rng = new Rng(1), color = PAL.woodGrey, broken = 0, bow = 0, char = 0, rot = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, len, t, broken ? 3 : 1, bow ? 4 : 1, 1);
  g.translate(0, len / 2, 0);
  const pos = g.attributes.position;
  if (broken) {
    const reach = Math.min(len * 0.3, w * 2.4);
    const off = [rng.range(0.05, 1), rng.range(0, 0.35), rng.range(0.1, 1), rng.range(0, 0.6)].map((k) => k * reach);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const c = Math.round((pos.getX(i) / w + 0.5) * 3);
      if (y > len - 1e-4) pos.setY(i, y - off[c]);
      else if (broken === 2 && y < 1e-4) pos.setY(i, y + off[3 - c] * 0.8);
    }
  }
  if (bow) for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - bow * Math.sin((Math.PI * pos.getY(i)) / len));
  g.computeVertexNormals();
  const base = col(color).multiplyScalar(rng.range(0.8, 1.14));
  if (rot) base.lerp(col('#2b2a24'), rot * rng.range(0.5, 1));
  if (char) base.lerp(col(PAL.char), char);
  const dark = base.clone().multiplyScalar(0.6);
  paint(g, {
    color: (v) => {
      const e = Math.exp(-Math.min(v.y, len - v.y) / 0.07);
      return base.clone().lerp(dark, e * 0.8);
    },
    rough: char ? 0.8 : 0.93,
    mat: MAT.WOOD,
  });
  return g;
}

/** A round timber (pile, post, pole) of length `len` along +Y, slightly crooked. */
export function pole(len, r, { rng = new Rng(1), radial = 7, taper = 0.88, color = PAL.woodGrey, crook = 0.02, hseg = 3, rot = 0 } = {}) {
  const g = new THREE.CylinderGeometry(r * taper, r, len, radial, hseg);
  g.translate(0, len / 2, 0);
  const ph = rng.range(0, 6.28),
    ph2 = rng.range(0, 6.28);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i),
      t = y / len;
    pos.setX(i, pos.getX(i) + Math.sin(t * 3.1 + ph) * crook * len * 0.25 * t);
    pos.setZ(i, pos.getZ(i) + Math.sin(t * 2.3 + ph2) * crook * len * 0.25 * t);
  }
  g.computeVertexNormals();
  const base = col(color).multiplyScalar(rng.range(0.8, 1.12));
  if (rot) base.lerp(col('#2b2a24'), rot);
  const top = base.clone().multiplyScalar(0.7);
  paint(g, { color: (v) => (v.ny > 0.9 ? top : base), rough: 0.93, mat: MAT.WOOD });
  return g;
}

/** Paint any geometry as rusted wrought iron. */
export function iron(g, rng = new Rng(1), rust = 0.55) {
  const c = mixc(PAL.iron, PAL.rust, clamp01(rust + rng.range(-0.25, 0.25))).multiplyScalar(rng.range(0.85, 1.1));
  return paint(g, { color: c, rough: 0.82, metal: 0.45, mat: MAT.METAL });
}
/** A square iron bar of length `len` along +Y. */
export function bar(len, t, rng, rust = 0.55) {
  const g = new THREE.BoxGeometry(t, len, t);
  g.translate(0, len / 2, 0);
  return iron(g, rng, rust);
}

const _qa = new THREE.Quaternion(),
  _ya = new THREE.Vector3(0, 1, 0),
  _da = new THREE.Vector3();
/** Turn a geometry built along +Y so it runs from point a toward point b ([x, y, z] arrays). */
export function aim(g, a, b) {
  _da.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  g.applyQuaternion(_qa.setFromUnitVectors(_ya, _da));
  g.translate(a[0], a[1], a[2]);
  return g;
}
export const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** A chain from a to b: flat links, every other one turned a quarter. */
export function chain(a, b, { link = 0.075, t = 0.012, rng = new Rng(1), rust = 0.6, sway = 0 } = {}) {
  const L = dist3(a, b);
  const n = Math.max(1, Math.round(L / (link * 0.8)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(link * 0.5, (L / n) * 1.22, t);
    if (i & 1) g.rotateY(Math.PI / 2);
    g.translate(0, (L / n) * (i + 0.5), 0);
    iron(g, rng, rust);
    out.push(g);
  }
  for (const g of out) {
    aim(g, a, b);
    if (sway) paint(g, { sway: (v) => sway * clamp01((Math.max(a[1], b[1]) - v.y) / Math.max(0.01, Math.abs(a[1] - b[1]))), uvw: false });
  }
  return out;
}

/** Old hemp: grey-brown, not gold. */
export const ROPE = mixc(PAL.rope, PAL.woodGrey, 0.6).multiplyScalar(0.72);
/** A rope through points. */
export function rope(points, r = 0.014, { sway = 0, color = ROPE, radial = 5 } = {}) {
  const g = tube(points, r, radial, { samples: Math.max(3, (points.length - 1) * 3) });
  return paint(g, { color: col(color), rough: 0.95, mat: MAT.CLOTH, sway });
}

// ---------------------------------------------------------------------------------------------
// Colliders for a straight run of masonry
// ---------------------------------------------------------------------------------------------
/**
 * Reduce laid courses to a few upright rectangles: [{ ua, ub, va, vb }]. The wall is sampled in
 * columns `step` wide; neighbouring columns whose solid spans agree within `tol` are merged.
 */
export function wallSpans(rows, { u0, u1, step = 0.5, tol = 0.45, floor = -1e9 } = {}) {
  const cols = [];
  const n = Math.max(1, Math.round((u1 - u0) / step));
  for (let i = 0; i < n; i++) {
    const ua = u0 + ((u1 - u0) * i) / n,
      ub = u0 + ((u1 - u0) * (i + 1)) / n,
      um = (ua + ub) / 2;
    const spans = [];
    let cur = null;
    for (const row of rows) {
      const on = row.cells.some((c) => um >= c.u0 && um <= c.u1);
      if (on) {
        if (cur && Math.abs(cur.vb - row.v0) < 1e-3) cur.vb = row.v1;
        else spans.push((cur = { va: Math.max(floor, row.v0), vb: row.v1 }));
      } else cur = null;
    }
    cols.push({ ua, ub, spans: spans.filter((s) => s.vb - s.va > 0.25) });
  }
  const out = [];
  let open = [];
  for (const c of cols) {
    const same = open.length === c.spans.length && open.every((o, k) => Math.abs(o.va - c.spans[k].va) < tol && Math.abs(o.sum / o.n - c.spans[k].vb) < tol);
    if (same) {
      open.forEach((o, k) => {
        o.ub = c.ub;
        o.sum += c.spans[k].vb;
        o.n++;
        o.va = Math.min(o.va, c.spans[k].va);
      });
    } else {
      out.push(...open);
      open = c.spans.map((s) => ({ ua: c.ua, ub: c.ub, va: s.va, sum: s.vb, n: 1 }));
    }
  }
  out.push(...open);
  return out.map((o) => ({ ua: o.ua, ub: o.ub, va: o.va, vb: o.sum / o.n }));
}

// ---------------------------------------------------------------------------------------------
// Kit geometry as weathered stone, dead ivy, the faces of a pier, a lantern cage
// ---------------------------------------------------------------------------------------------
const _sp = new THREE.Vector3();
/** Paint a placed kit geometry (lathe, rock, box) as stone, aged by where it sits. */
export function stonePaint(g, { color = PAL.stone, shadeAt = null, rough = 0.92, dark = null } = {}) {
  const base = col(color);
  return paint(g, {
    color: (v) => {
      const c = base.clone();
      if (dark) c.multiplyScalar(dark(v));
      return shadeAt ? shadeAt(_sp.set(v.x, v.y, v.z), c, Math.max(0, v.ny)) : c;
    },
    rough,
    mat: MAT.STONE,
  });
}

/** Wire-dead ivy: a few dark stems that climbed a wall and died there. map(u, v, w) as in masonry. */
export function deadIvy(rng, { map, w, u0, u1, top, n = 3, from = -0.1 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pts = [];
    let u = rng.range(u0, u1),
      v = from;
    const h = top(u) * rng.range(0.45, 0.85);
    if (h < from + 0.9) continue;
    while (v < h) {
      pts.push(map(u, v, w + rng.range(0.005, 0.03)));
      v += rng.range(0.25, 0.5);
      u += rng.range(-0.22, 0.22);
    }
    if (pts.length < 3) continue;
    const g = tube(pts, (t) => 0.018 * (1 - t * 0.75), 4, { samples: pts.length * 2 });
    paint(g, { color: mixc(PAL.barkDark, PAL.thorn, rng.next()), rough: 0.95, mat: MAT.WOOD });
    out.push(g);
    for (let k = 1; k < pts.length - 1; k++) {
      if (!rng.chance(0.6)) continue;
      const p = pts[k],
        d = rng.sign();
      const du = d * rng.range(0.3, 0.6),
        dv = rng.range(0.15, 0.5);
      // side shoots are laid out in wall space again so they hug a curved wall too
      const a = map(0, 0, w),
        bu = map(1, 0, w).sub(a),
        bv = map(0, 1, w).sub(a);
      const q1 = p.clone().addScaledVector(bu, du * 0.5).addScaledVector(bv, dv * 0.5),
        q2 = p.clone().addScaledVector(bu, du).addScaledVector(bv, dv);
      const s = tube([p, q1, q2], (t) => 0.009 * (1 - t * 0.8), 3, { samples: 4, caps: false });
      paint(s, { color: col(PAL.thorn), rough: 0.95, mat: MAT.WOOD });
      out.push(s);
    }
  }
  return out;
}

/**
 * The four outward faces of an upright rectangular pier or building, as masonry runs:
 * [{ map, u0, u1, n: [nx, nz] }] for +Z, +X, -Z, -X. w = 0 is the face, negative w goes inward.
 * `post(p)` may move every point afterwards (a lean).
 */
export function prismFaces(x0, x1, z0, z1, post = null) {
  const P = post || ((p) => p);
  return [
    { map: (u, v, w) => P(V3(u, v, z1 + w)), u0: x0, u1: x1, n: [0, 1] },
    { map: (u, v, w) => P(V3(x1 + w, v, -u)), u0: -z1, u1: -z0, n: [1, 0] },
    { map: (u, v, w) => P(V3(-u, v, z0 - w)), u0: -x1, u1: -x0, n: [0, -1] },
    { map: (u, v, w) => P(V3(x0 - w, v, u)), u0: z0, u1: z1, n: [-1, 0] },
  ];
}

/**
 * A dead iron lantern: a cage of bars under a peaked cap, a ring on top, a candle stub inside.
 * Built hanging: the top of the ring is at the origin, the cage hangs below it.
 * Returns { geos, flame: [x, y, z] } (flame = where a light would sit).
 */
export function lantern(rng, { w = 0.15, h = 0.26, rust = 0.6, sway = 0 } = {}) {
  const geos = [];
  const add = (g) => {
    iron(g, rng, rust);
    geos.push(g);
    return g;
  };
  const top = -0.07; // underside of the ring
  const ring = new THREE.TorusGeometry(0.028, 0.006, 4, 8);
  ring.translate(0, -0.03, 0);
  add(ring);
  const cap = new THREE.ConeGeometry(w * 0.82, w * 0.55, 4, 1);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, top - w * 0.275, 0);
  add(cap);
  const y1 = top - w * 0.55,
    y0 = y1 - h;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const b = new THREE.BoxGeometry(0.012, h, 0.012);
    b.translate((sx * w) / 2, (y0 + y1) / 2, (sz * w) / 2);
    add(b);
  }
  for (const y of [y0, y1]) {
    for (const k of [0, 1]) {
      for (const sgn of [-1, 1]) {
        const r = new THREE.BoxGeometry(k ? 0.012 : w + 0.012, 0.012, k ? w + 0.012 : 0.012);
        r.translate(k ? (sgn * w) / 2 : 0, y, k ? 0 : (sgn * w) / 2);
        add(r);
      }
    }
  }
  const floor = new THREE.BoxGeometry(w + 0.03, 0.014, w + 0.03);
  floor.translate(0, y0 - 0.006, 0);
  add(floor);
  // a guttered candle stub
  const candle = new THREE.CylinderGeometry(0.014, 0.018, 0.05, 6);
  candle.translate(0.01, y0 + 0.03, -0.005);
  paint(candle, { color: mixc(PAL.wax, PAL.soot, 0.45), rough: 0.7, mat: MAT.PLAIN });
  geos.push(candle);
  if (sway) for (const g of geos) paint(g, { sway, uvw: false });
  return { geos, flame: [0, y0 + 0.09, 0] };
}

/** Darken and green a placed timber geometry below the waterline `y`, pale it just above. */
export function waterStain(g, y = 0, { reach = 0.35 } = {}) {
  const pos = g.attributes.position,
    c = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const d = pos.getY(i) - y;
    if (d > reach) continue;
    const k = sstep(reach, -0.1, d);
    c.setXYZ(i, c.getX(i) * lerp(1, 0.42, k), c.getY(i) * lerp(1, 0.62, k), c.getZ(i) * lerp(1, 0.4, k));
  }
  return g;
}

/** A box whose eight corners are knocked a little out of true (a cut stone, a slab, a step). */
export function roughBox(w, h, d, rng, j = 0.012) {
  const g = new THREE.BoxGeometry(w, h, d);
  const off = [];
  for (let i = 0; i < 8; i++) off.push([rng.range(-j, j), rng.range(-j, j), rng.range(-j, j)]);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getX(i) > 0 ? 1 : 0) | (pos.getY(i) > 0 ? 2 : 0) | (pos.getZ(i) > 0 ? 4 : 0);
    pos.setXYZ(i, pos.getX(i) + off[k][0], pos.getY(i) + off[k][1], pos.getZ(i) + off[k][2]);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A hewn block, centred: a box with its corners out of true and every face a little swollen or
 * dished, subdivided so that weathering painted on its vertices has something to hold on to.
 */
export function hewn(w, h, d, rng, { j = 0.012, swell = 0.006, seg = 2 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const off = [],
    fs = [];
  for (let i = 0; i < 8; i++) off.push([rng.range(-j, j), rng.range(-j, j), rng.range(-j, j)]);
  for (let i = 0; i < 6; i++) fs.push(rng.range(-swell, swell));
  const pos = g.attributes.position,
    nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const tx = x / w + 0.5,
      ty = y / h + 0.5,
      tz = z / d + 0.5;
    let ox = 0,
      oy = 0,
      oz = 0;
    for (let c = 0; c < 8; c++) {
      const k = (c & 1 ? tx : 1 - tx) * (c & 2 ? ty : 1 - ty) * (c & 4 ? tz : 1 - tz);
      ox += off[c][0] * k;
      oy += off[c][1] * k;
      oz += off[c][2] * k;
    }
    const nx = nor.getX(i),
      ny = nor.getY(i),
      nz = nor.getZ(i);
    // only the inside of a face moves along its normal, so the edges stay closed
    const e = Math.abs(nx) > 0.5 ? Math.min(ty, 1 - ty, tz, 1 - tz) : Math.abs(ny) > 0.5 ? Math.min(tx, 1 - tx, tz, 1 - tz) : Math.min(tx, 1 - tx, ty, 1 - ty);
    const f = fs[nx > 0.5 ? 0 : nx < -0.5 ? 1 : ny > 0.5 ? 2 : ny < -0.5 ? 3 : nz > 0.5 ? 4 : 5] * Math.min(1, e * 4);
    pos.setXYZ(i, x + ox + nx * f, y + oy + ny * f, z + oz + nz * f);
  }
  g.computeVertexNormals();
  return g;
}

/** A square shaft standing on y = 0: wBot wide at the foot, wTop at the head (0 = a pyramid). */
export function shaft4(wBot, wTop, h, hseg = 3) {
  const g = new THREE.CylinderGeometry(Math.max(1e-4, wTop * Math.SQRT1_2), wBot * Math.SQRT1_2, h, 4, hseg);
  g.rotateY(Math.PI / 4);
  g.translate(0, h / 2, 0);
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

/** A four-sided spearhead standing on y = 0. */
export function spear(len = 0.16, w = 0.028) {
  const g = new THREE.BufferGeometry();
  const a = len * 0.27;
  const P = [];
  const ring = [
    [w, 0],
    [0, w],
    [-w, 0],
    [0, -w],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = ring[i],
      [x1, z1] = ring[(i + 1) & 3];
    P.push(x0, a, z0, 0, len, 0, x1, a, z1); // blade
    P.push(x0 * 0.25, 0, z0 * 0.25, x0, a, z0, x1, a, z1, x0 * 0.25, 0, z0 * 0.25, x1, a, z1, x1 * 0.25, 0, z1 * 0.25); // socket
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}
