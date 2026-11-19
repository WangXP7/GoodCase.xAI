// The rock of Morne: cut, jointed and bedded, never a blob. Every rock here is a convex solid or
// a pile of them, made by cutting a block with planes (the convex tools in _shared.js), so faces
// are flat and edges hard. Lichen, moss, seams and streaks are painted on afterwards.
// opts.lod: 0 full, 1 far (fewest triangles, the same outline).
import { Builder, Rng, TAU, MAT, col, paint, strokes, GLYPH, xf, deform } from '../kit.js';
import { register } from '../registry.js';
import { boxFaces, prismFaces, clipFaces, splitFaces, filterFaces, xfFaces, xfPlane, facesInfo, support, nick, chipRock, facesToGeo, warpAt, warpNoise, paintRock, tris, clamp01, V3 } from './_shared.js';

const lodOf = (opts) => (((opts && opts.lod) | 0) >= 1 ? 1 : 0);

/** Faces that look down into the ground: nobody sees them. */
const buried = (n, f) => n.y < -0.7 && f.every((p) => p.y < 0.03);

/**
 * Solids -> unpainted geometries, coarsened until they fit the triangle budget. One warp field
 * runs through all of them, so the two sides of a crack keep their distance.
 */
function mesh(solids, lod, { edge = 0.3, bump = 0.02, warp = 0, warpFreq = 1.3, seed = 1, budget = 860, maxLvl = 2, minimal = false } = {}) {
  if (lod) return solids.map((f) => facesToGeo(f, { minimal: true, skip: buried, warp, warpFreq, seed }));
  let e = edge;
  for (let k = 0; ; k++) {
    const gs = solids.map((f) => facesToGeo(f, { edge: e, maxLvl, bump, warp, warpFreq, seed, skip: buried, minimal }));
    if (k === 10 || gs.reduce((a, g) => a + tris(g), 0) <= budget) return gs;
    e *= 1.25;
  }
}

/** Bounds of several solids together. */
function bounds(solids) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    const i = facesInfo(s);
    if (i.empty) continue;
    min[0] = Math.min(min[0], i.min.x);
    min[1] = Math.min(min[1], i.min.y);
    min[2] = Math.min(min[2], i.min.z);
    max[0] = Math.max(max[0], i.max.x);
    max[1] = Math.max(max[1], i.max.y);
    max[2] = Math.max(max[2], i.max.z);
  }
  return { min, max };
}
const solid = (f) => f && f.length >= 4;

/** Put a solid on the ground with its lowest point `sink` below it. */
function seat(faces, sink = 0.1, x = 0, z = 0) {
  const { min } = facesInfo(faces);
  return xfFaces(faces, { t: [x, -min.y - sink, z] });
}

const GRANITE = { base: '#5d5957', dark: '#353233', light: '#8b8580' };
const SLATE = { base: '#44474b', dark: '#222427', light: '#6e7175' };
const WARM = { base: '#5a5651', dark: '#34312e', light: '#827c73' };

// ---------------------------------------------------------------------------------------------
// rock_boulder: lichen granite, 0.8 to 2.5 m. A block with its corners knocked off, often with
// a lesser block bedded against it. Frost has been at most of them: a third parted from the
// rest, a sheet spalled off a flank and slid.
// ---------------------------------------------------------------------------------------------
register(
  'rock_boulder',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2003);
    const S = R.range(0.8, 2.5);
    const size = [S, S * R.range(0.6, 0.85), S * R.range(0.68, 0.95)];
    const block = R.range(0.65, 1.0);
    // a few big planes first, then the corners: large faces with small ones crowding their meetings
    const granite = (rng, sz, cuts, nicks) => chipRock(rng, { size: sz, cuts, depth: [0.72, 1.0], vertical: 0.3, block, nicks, nickDepth: [0.05, 0.24], fit: true });
    let body = granite(new Rng(seed * 104729 + 2003), size, 9, 16);
    body = xfFaces(body, { r: [R.range(-0.25, 0.25), R.range(0, TAU), R.range(-0.25, 0.25)] });
    // every draw is made whether it is used or not, so one seed is one boulder
    const split = R.chance(0.6),
      ca = R.range(0, TAU),
      tl = R.range(-0.3, 0.3),
      off = R.range(0.06, 0.24) * S * (R.chance(0.5) ? 1 : -1),
      gap = S * R.range(0.015, 0.035) + 0.008,
      slump = [R.range(-0.06, 0.06), R.range(-0.04, 0.04), R.range(-0.06, 0.06)],
      drop = R.range(0, 0.04) * S,
      spall = R.chance(0.5),
      sideS = R.chance(0.5) ? 1 : -1,
      sa = ca + (sideS * Math.PI) / 2 + R.range(-0.6, 0.6),
      sk = R.range(0.68, 0.84),
      sTilt = R.range(0.05, 0.16),
      sDrop = R.range(0.02, 0.07) * S,
      sink = size[1] * R.range(0.1, 0.18),
      twin = R.chance(0.6),
      ts = S * R.range(0.45, 0.68),
      td = S * R.range(0.3, 0.46),
      tr = [R.range(-0.4, 0.4), R.range(0, TAU), R.range(-0.4, 0.4)],
      tk = [R.range(0.6, 0.9), R.range(0.7, 1)],
      tj = R.range(-0.3, 0.3);
    const n = [Math.cos(ca) * Math.cos(tl), Math.sin(tl), Math.sin(ca) * Math.cos(tl)];
    let cracks = [];
    let big = body;
    const rest = [];
    if (split) {
      const [A, B] = splitFaces(body, n[0], n[1], n[2], off, gap);
      if (solid(A) && solid(B)) {
        // the smaller part has settled away from the larger
        const [keep, gone, sgn] = off > 0 ? [A, B, 1] : [B, A, -1];
        const gi = facesInfo(gone);
        big = keep;
        rest.push(xfFaces(gone, { r: slump, pivot: [gi.centre.x, gi.min.y, gi.centre.z], t: [n[0] * gap * 0.5 * sgn, -drop, n[2] * gap * 0.5 * sgn] }));
        cracks.push({ n, d: off, w: gap * 1.6 + 0.03, k: 0.7 });
      }
    }
    if (spall) {
      const m = [Math.cos(sa) * 0.995, 0.1, Math.sin(sa) * 0.995];
      const d = support(big, m[0], m[1], m[2]) * sk;
      const g2 = S * 0.012 + 0.006;
      const [core, flake] = splitFaces(big, m[0], m[1], m[2], d, g2);
      if (solid(core) && solid(flake)) {
        const fi = facesInfo(flake);
        big = core;
        rest.push(xfFaces(flake, { r: [sTilt * Math.sin(sa), 0, -sTilt * Math.cos(sa)], pivot: [fi.centre.x, fi.min.y, fi.centre.z], t: [Math.cos(sa) * S * 0.012, -sDrop, Math.sin(sa) * S * 0.012] }));
        cracks.push({ n: m, d, w: g2 * 1.6 + 0.025, k: 0.6 });
      }
    }
    let main = [big, ...rest];
    const lift = -bounds([big]).min[1] - sink;
    main = main.map((f) => xfFaces(f, { t: [0, lift, 0] }));
    cracks = cracks.map((c) => xfPlane(c, { t: [0, lift, 0] }));
    // the lesser block, bedded against the back of the larger part, clear of crack and spall
    if (twin) {
      const back = (off > 0 ? ca + Math.PI : ca) + (off > 0 ? 1 : -1) * sideS * 0.5 + tj;
      const t = xfFaces(granite(new Rng(seed * 104729 + 2777), [ts, ts * tk[0], ts * tk[1]], 8, 12), { r: tr });
      main.push(seat(t, ts * tk[0] * 0.3, Math.cos(back) * td, Math.sin(back) * td));
    }
    const bb = bounds(main);
    const solids = [...main];
    // a stone or two that came off it
    const nC = R.int(0, 2);
    for (let i = 0; i < 2; i++) {
      const s = S * R.range(0.14, 0.26),
        an = R.range(0, TAU),
        dist = S * R.range(0.62, 0.85),
        yaw = R.range(0, TAU);
      const st = xfFaces(granite(new Rng(seed * 131 + i * 17 + 5), [s, s * 0.7, s * 0.85], 7, 6), { r: [0, yaw, 0] });
      if (i < nC) solids.push(seat(st, s * 0.2, Math.cos(an) * dist, Math.sin(an) * dist));
    }
    const geos = mesh(solids, lod, { edge: 0.09 + S * 0.045, bump: S * 0.012, warp: S * 0.03, warpFreq: 2.4 / S, seed });
    for (const g of geos)
      paintRock(g, {
        ...GRANITE,
        lichenAmt: 0.45,
        mossAmt: 0.3,
        seed,
        facet: 0.12,
        cracks,
        stains: [
          { colour: '#a09f8f', amt: 0.3, freq: 4.6, up: -0.3, k: 0.6 },
          { colour: '#8a7b45', amt: 0.24, freq: 3.1, up: 0.1, k: 0.5 },
          { colour: '#2a2726', amt: 0.35, freq: 1.3, k: 0.5 },
        ],
      });
    const b = new Builder().add(geos);
    const top = bb.max[1];
    b.cylCollider(0, top / 2, 0, ((bb.max[0] - bb.min[0] + bb.max[2] - bb.min[2]) / 4) * 0.85, top);
    return b.build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// rock_slab: a flat outcrop, 3 x 0.6 x 2.5 m, in three beds. The upper bed is jointed; its top
// is level at y = 0.6 and can be walked on.
// ---------------------------------------------------------------------------------------------
register(
  'rock_slab',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2101);
    const TOP = 0.6;
    const t1 = R.range(0.17, 0.25),
      t2 = R.range(0.13, 0.2);
    const y1 = TOP - t1,
      y2 = y1 - t2;
    // a bed: a plate broken only round its rim (joints are upright), its top left level
    const bed = (k, thick, yTop, cuts, depth, yaw, sx, sz, block = 1) => {
      const f = chipRock(new Rng(seed * 104729 + 2101 + k * 977), { size: [3.0, thick, 2.5], cuts, depth, vertical: 1, tilt: 0.02, block });
      return xfFaces(f, { r: [0, yaw, 0], t: [sx, yTop - thick / 2, sz] });
    };
    const plot = (f) => clipFaces(clipFaces(clipFaces(clipFaces(f, 1, 0, 0, 1.5), -1, 0, 0, 1.5), 0, 0, 1, 1.25), 0, 0, -1, 1.25);
    const groups = [];
    // upper bed: stepped back along one side, cut through by one or two joints, corners knocked off
    {
      let top = bed(0, t1, TOP, 9, [0.88, 0.995], 0, 0, 0, 0.7);
      const sb = (R.int(0, 3) * Math.PI) / 2 + R.range(-0.12, 0.12),
        step = R.range(0.1, 0.26);
      top = nick(top, Math.cos(sb), 0, Math.sin(sb), step);
      const ja = R.range(-0.5, 0.5) + (R.chance(0.5) ? 0 : Math.PI / 2),
        jo = R.range(-0.5, 0.5),
        jg = R.range(0.035, 0.07),
        second = R.chance(0.7),
        ja2 = ja + Math.PI / 2 + R.range(-0.3, 0.3),
        jo2 = R.range(-0.4, 0.4),
        jg2 = R.range(0.03, 0.055);
      const n1 = [Math.cos(ja), 0, Math.sin(ja)],
        n2 = [Math.cos(ja2), 0, Math.sin(ja2)];
      const cracks = [{ n: n1, d: jo, w: jg + 0.05, k: 0.55 }];
      let pieces = splitFaces(top, n1[0], 0, n1[2], jo, jg);
      if (second && solid(pieces[0])) {
        pieces = [...splitFaces(pieces[0], n2[0], 0, n2[2], jo2, jg2), pieces[1]];
        cracks.push({ n: n2, d: jo2, w: jg2 + 0.05, k: 0.45 });
      }
      pieces = pieces.filter(solid).map((f, i) => {
        const CR = new Rng(seed * 733 + i * 59 + 11);
        for (let k = 0; k < 3; k++) {
          const a = CR.range(0, TAU);
          f = nick(f, Math.cos(a), CR.range(0.7, 1.1), Math.sin(a), CR.range(0.02, 0.06));
        }
        return f;
      });
      groups.push({ solids: pieces, cracks });
    }
    // middle bed, one joint
    {
      const mid = bed(1, t2, y1, 8, [0.9, 1.0], R.range(-0.05, 0.05), R.range(-0.05, 0.05), R.range(-0.04, 0.04));
      const ja = R.range(0, Math.PI),
        jo = R.range(-0.6, 0.6),
        jg = R.range(0.03, 0.06);
      const n1 = [Math.cos(ja), 0, Math.sin(ja)];
      groups.push({ solids: splitFaces(mid, n1[0], 0, n1[2], jo, jg), cracks: [{ n: n1, d: jo, w: jg + 0.05, k: 0.5 }] });
    }
    // lower bed, going into the ground
    groups.push({ solids: [bed(2, y2 + 0.3, y2, 7, [0.92, 1.0], R.range(-0.07, 0.07), R.range(-0.06, 0.06), R.range(-0.05, 0.05))], cracks: null });
    const solids = [],
      owner = [];
    groups.forEach((g, gi) => {
      for (const f of g.solids) {
        if (!solid(f)) continue;
        const c = plot(f);
        if (!solid(c)) continue;
        solids.push(c);
        owner.push(gi);
      }
    });
    // undersides, and the tops of the beds below, are all but hidden: fewest triangles there
    const geos = mesh(solids, lod, { edge: 0.26, bump: 0.012, warp: 0.012, warpFreq: 1.7, seed, minimal: (n, f) => n.y < -0.5 || (n.y > 0.5 && f[0].y < TOP - 0.02) });
    geos.forEach((g, i) =>
      paintRock(g, {
        ...WARM,
        lichenAmt: 0.5,
        mossAmt: 0.35,
        seed,
        facet: 0.08,
        seams: [y1, y2],
        cracks: groups[owner[i]].cracks,
        streak: 0.25,
        stains: [
          { colour: '#a09f8f', amt: 0.26, freq: 4.2, up: 0.3, k: 0.5 },
          { colour: '#847743', amt: 0.22, freq: 2.6, up: 0.4, k: 0.5 },
          { colour: '#2c2a28', amt: 0.3, freq: 1.1, k: 0.45 },
        ],
      })
    );
    return new Builder().add(geos).boxCollider(0, TOP / 2, 0, 1.38, TOP / 2, 1.12).build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// A shard: a block cut to a point by planes that lean together, the tip broken on a slant.
// Unit space, then scaled to w x h x d. The base is at -h / 2. apex > 1 lets the planes meet
// above the block, which leaves a blade with a broken end rather than a needle.
// ---------------------------------------------------------------------------------------------
function shard(R, { h, w, d, sides = 5, chips = 2, apex = 1 }) {
  let f = boxFaces(1, 1, 1);
  const ax = R.range(-0.25, 0.25),
    az = R.range(-0.25, 0.25);
  let a = R.range(0, TAU);
  for (let k = 0; k < sides; k++) {
    a += (TAU / sides) * (1 + R.range(-0.35, 0.35));
    const rb = R.range(0.55, 1.0);
    const phi = Math.atan(rb / (apex + 1));
    const n = [Math.cos(a) * Math.cos(phi), Math.sin(phi), Math.sin(a) * Math.cos(phi)];
    f = clipFaces(f, n[0], n[1], n[2], n[0] * ax + n[1] * apex + n[2] * az);
  }
  for (let k = 0; k < chips; k++) {
    const b = R.range(0, TAU),
      tip = k === 0 || R.chance(0.4),
      ny = tip ? R.range(0.7, 1.3) : R.range(-0.1, 0.3),
      y0 = tip ? R.range(0.7, 0.9) : R.range(-0.4, 0.5),
      fr = R.range(0.6, 0.85);
    const r0 = tip ? 0 : 0.78 * ((1 - y0) / 2) * fr;
    const g = clipFaces(f, Math.cos(b), ny, Math.sin(b), Math.cos(b) * (ax * 0.5 + Math.cos(b) * r0) + ny * y0 + Math.sin(b) * (az * 0.5 + Math.sin(b) * r0));
    if (solid(g)) f = g;
  }
  return xfFaces(f, { s: [w / 2, h / 2, d / 2] });
}
/** Stand a shard at (x, z), its base `sink` under the ground, leaning by `lean` toward azimuth `to`. */
function stand(f, h, { x = 0, z = 0, sink = 0.4, lean = 0, to = 0, yaw = 0 }) {
  let g = xfFaces(f, { r: [0, yaw, 0], t: [0, h / 2 - sink, 0] });
  g = xfFaces(g, { r: [lean * Math.sin(to), 0, -lean * Math.cos(to)] });
  return xfFaces(g, { t: [x, 0, z] });
}

// ---------------------------------------------------------------------------------------------
// rock_spire: a crag of slate standing on edge, 4 to 9 m. The beds are upright: a pack of
// leaves, the tallest in the middle, each broken off at its own height and opening from its
// neighbours like the pages of a book. Stubs and fallen plates lie round the foot.
// ---------------------------------------------------------------------------------------------
register(
  'rock_spire',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2201);
    const H = R.range(4, 9);
    const SINK = 0.6;
    const nL = R.int(4, 6);
    const T = H * R.range(0.24, 0.32), // the pack, across the bedding (x)
      WZ = H * R.range(0.2, 0.28); // the widest leaf, along the bedding (z)
    const ip = Math.min(nL - 1, Math.max(0, Math.round(R.range(0.25, 0.75) * (nL - 1))));
    const splay = R.range(0.012, 0.035);
    const wts = [];
    for (let i = 0; i < 6; i++) wts.push(R.range(0.6, 1.4));
    let sum = 0;
    for (let i = 0; i < nL; i++) sum += wts[i];
    const items = []; // { f, cracks, leaf }
    const hOf = [];
    let x0 = -T / 2;
    for (let i = 0; i < 6; i++) {
      const hk = R.range(0.75, 1),
        wk = R.range(0.8, 1.1),
        zo = R.range(-0.1, 0.1) * WZ,
        kA = R.range(0.3, 0.72),
        kB = R.range(0.3, 0.72),
        kT = R.range(0.45, 0.8),
        ap = R.range(-0.3, 0.3),
        s1 = R.range(0.5, 2.0),
        s2 = R.range(0.5, 2.0),
        r1 = R.range(-0.4, 0.4),
        r2 = R.range(-0.4, 0.4),
        shA = R.next(),
        yA = R.range(0.3, 0.75),
        tA = R.range(0.25, 0.6),
        shB = R.next(),
        yB = R.range(0.3, 0.75),
        tB = R.range(0.25, 0.6),
        brk = R.next(),
        by = R.range(0.42, 0.7),
        bt = [R.range(-0.12, 0.12), R.range(-0.12, 0.12)],
        creep = [R.range(-0.06, 0.06), R.range(-0.06, 0.06)],
        turn = R.range(-0.05, 0.05),
        gap = R.range(0.02, 0.05);
      if (i >= nL) continue;
      const th = (T * wts[i]) / sum,
        cx = x0 + th / 2;
      x0 += th;
      const far = Math.abs(i - ip) / Math.max(1, nL - 1);
      const h = i === ip ? H : H * Math.max(0.28, 1 - 0.9 * far) * hk;
      const w = WZ * (1 - 0.5 * far) * wk,
        half = (th - gap) / 2;
      hOf[i] = h;
      let f = xfFaces(boxFaces(half, (h + 0.6 + SINK) / 2, w / 2), { t: [cx, (h + 0.6 - SINK) / 2, zo] });
      // the two edges lean together, each at its own pitch, and may steepen at a shoulder
      const reachAt = [0, 0];
      const edge = (sgn, k, sh, ys, ts, slot) => {
        const tn = ((w / 2) * (1 - k)) / h,
          c = 1 / Math.hypot(1, tn);
        f = clipFaces(f, 0, tn * c, sgn * c, c * (sgn * zo + w / 2));
        reachAt[slot] = (w / 2) * k;
        if (sh < 0.65) {
          const y = h * ys,
            zs = zo + sgn * (w / 2 - tn * y),
            t2 = tn + Math.min(ts, ((w / 2) * k - 0.04 * w) / (h - y)),
            c2 = 1 / Math.hypot(1, t2);
          f = clipFaces(f, 0, t2 * c2, sgn * c2, c2 * (t2 * y + sgn * zs));
          reachAt[slot] = w / 2 - tn * y - t2 * (h - y);
        }
      };
      edge(1, kA, shA, yA, tA, 0);
      edge(-1, kB, shB, yB, tB, 1);
      // thinner toward the top
      {
        const tn = (half * (1 - kT)) / h,
          c = 1 / Math.hypot(1, tn);
        f = clipFaces(f, c, tn * c, 0, c * (cx + half));
        f = clipFaces(f, -c, tn * c, 0, c * (half - cx));
      }
      // the crest: two slants meeting at a ridge somewhere along the top
      const za = zo + (-reachAt[1] + (reachAt[0] + reachAt[1]) * (0.5 + ap));
      f = clipFaces(f, r1, 1, s1, r1 * cx + h + s1 * za);
      f = clipFaces(f, r2, 1, -s2, r2 * cx + h - s2 * za);
      // broken across, the upper part crept and turned on the lower
      let parts = [f];
      const cracks = [];
      if (brk < 0.7 && h > 2.4) {
        const yb = h * by;
        const [lo, hi] = splitFaces(f, bt[0], 1, bt[1], yb + bt[0] * cx + bt[1] * zo, 0.035);
        if (solid(lo) && solid(hi)) {
          parts = [lo, xfFaces(hi, { r: [0, turn, 0], pivot: [cx, yb, zo], t: [creep[0] * th, 0, creep[1] * w * 0.5] })];
          const l = Math.hypot(bt[0], 1, bt[1]);
          cracks.push({ n: [bt[0] / l, 1 / l, bt[1] / l], d: (yb + bt[0] * cx + bt[1] * zo) / l, w: 0.1, k: 0.6 });
        }
      }
      // opening from the tallest leaf like a page
      const open = { r: [0, 0, -(i - ip) * splay], pivot: [cx, 0, zo] };
      for (const p of parts) items.push({ f: xfFaces(p, open), cracks: cracks.map((c) => xfPlane(c, open)), leaf: i });
    }
    // at the far lod, the faces a taller neighbour stands against are left out
    if (lod)
      for (const it of items) {
        const i = it.leaf;
        const hideP = hOf[i + 1] !== undefined && hOf[i + 1] > hOf[i],
          hideN = hOf[i - 1] !== undefined && hOf[i - 1] > hOf[i];
        it.f = filterFaces(it.f, (n) => !((hideP && n.x > 0.94) || (hideN && n.x < -0.94)));
      }
    // broken stubs standing at the ends of the pack
    const nS = R.int(1, 3);
    for (let i = 0; i < 3; i++) {
      const h2 = H * R.range(0.1, 0.24),
        w2 = WZ * R.range(0.35, 0.6),
        d2 = T * R.range(0.1, 0.18),
        side = i % 2 ? -1 : 1,
        x = R.range(-0.35, 0.35) * T,
        z = side * WZ * R.range(0.42, 0.62),
        ln = R.range(0.08, 0.4),
        yaw = Math.PI / 2 + R.range(-0.25, 0.25),
        sides = R.int(3, 5);
      const s = shard(new Rng(seed * 733 + i * 91 + 3), { h: h2 + SINK, w: w2, d: d2, sides, chips: 2 });
      if (i < nS) items.push({ f: stand(s, h2 + SINK, { x, z, sink: SINK, lean: ln, to: side * (Math.PI / 2) + R.range(-0.5, 0.5), yaw }), cracks: [], leaf: -9 });
    }
    // the whole crag leans a little, and is turned to its own strike
    const lean = R.range(0, 0.07),
      leanTo = R.range(0, TAU),
      strike = R.range(0, TAU);
    const pose = (o) => ({ ...o, a: { r: [lean * Math.sin(leanTo), 0, -lean * Math.cos(leanTo)] }, b: { r: [0, strike, 0] } });
    for (const it of items) {
      const p = pose(it);
      it.f = xfFaces(xfFaces(it.f, p.a), p.b);
      it.cracks = it.cracks.map((c) => xfPlane(xfPlane(c, p.a), p.b));
    }
    // fallen plates
    const nR = lod ? 0 : R.int(3, 6);
    for (let i = 0; i < 6 && !lod; i++) {
      const s = R.range(0.35, 0.9),
        an = R.range(0, TAU),
        dist = (T + WZ) * R.range(0.34, 0.6),
        yaw = R.range(0, TAU),
        tip = R.range(-0.25, 0.25),
        ky = R.range(0.22, 0.4);
      const st = xfFaces(chipRock(new Rng(seed * 419 + i * 13 + 1), { size: [s, s * ky, s * 0.7], cuts: 9, depth: [0.7, 0.99], vertical: 0.7, block: 0.8, fit: true }), { r: [tip, yaw, 0] });
      if (i < nR) items.push({ f: seat(st, s * 0.1, Math.cos(an) * dist, Math.sin(an) * dist), cracks: [], leaf: -9 });
    }
    const live = items.filter((it) => solid(it.f));
    const geos = mesh(
      live.map((it) => it.f),
      lod,
      { edge: H * 0.07, bump: 0.03, warp: 0.02 + H * 0.004, warpFreq: 0.9, seed }
    );
    geos.forEach((g, i) => paintRock(g, { ...SLATE, lichenAmt: 0.22, mossAmt: 0.28, seed, facet: 0.16, streak: 0.45, cracks: live[i].cracks, soil: 0.6, wear: 0.16, stains: [{ colour: '#6d6a4a', amt: 0.2, freq: 2.4, up: 0.2, k: 0.45 }] }));
    return new Builder()
      .add(geos)
      .cylCollider(0, H * 0.4, 0, ((T + WZ) / 4) * 0.9, H * 0.8)
      .build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// rock_basalt: a cluster of hexagonal columns, 2 to 5 m, stepping down from the tallest.
// ---------------------------------------------------------------------------------------------
const hexPoly = (cx, cz, r, rot = Math.PI / 6) => Array.from({ length: 6 }, (_, k) => [cx + Math.cos(rot + (k * TAU) / 6) * r, cz + Math.sin(rot + (k * TAU) / 6) * r]);
const HEX_NB = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
register(
  'rock_basalt',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2301);
    const HM = R.range(2, 5);
    const r = R.range(0.25, 0.33);
    const RINGS = 3;
    const pk = [R.range(-1.2, 1.2) * r, R.range(-1.2, 1.2) * r];
    const span = RINGS * Math.sqrt(3) * r;
    // heights first, so each column knows which of its sides are hidden by a taller neighbour
    const cells = new Map();
    for (let q = -RINGS; q <= RINGS; q++)
      for (let s = -RINGS; s <= RINGS; s++) {
        if (Math.abs(q + s) > RINGS) continue;
        const x = Math.sqrt(3) * r * (q + s / 2),
          z = 1.5 * r * s;
        const d = Math.hypot(x - pk[0], z - pk[1]) / span;
        const ring = Math.max(Math.abs(q), Math.abs(s), Math.abs(q + s));
        const hh = HM * Math.max(0.1, 1 - 0.8 * Math.pow(d, 1.15)) * R.range(0.72, 1.0),
          gone = R.chance(ring === RINGS ? 0.45 : ring === RINGS - 1 ? 0.12 : 0),
          tx = R.range(-0.22, 0.22),
          tz = R.range(-0.22, 0.22),
          broken = R.chance(0.25),
          bx = R.range(-0.6, 0.6),
          bz = R.range(-0.6, 0.6);
        if (gone) continue;
        cells.set(q + ',' + s, { q, s, x, z, ring, h: Math.max(0.25, hh), tx: broken ? bx : tx, tz: broken ? bz : tz });
      }
    // each column is a stack of drums parted at cross joints, a touch out of line with each other
    const solids = [];
    let hmax = 0;
    const JR = new Rng(seed * 104729 + 2301);
    for (const c of cells.values()) {
      hmax = Math.max(hmax, c.h);
      const j1 = c.h * JR.range(0.25, 0.5),
        j2 = c.h * JR.range(0.6, 0.85),
        tones = [JR.range(0.84, 1.14), JR.range(0.84, 1.14), JR.range(0.84, 1.14)],
        offs = [0, 0, JR.range(-0.014, 0.014), JR.range(-0.014, 0.014), JR.range(-0.014, 0.014), JR.range(-0.014, 0.014)];
      if (lod && c.ring === RINGS && c.h < 0.3 * HM) continue;
      const joints = lod ? [] : c.h > 1.6 ? [j1, j2] : c.h > 0.8 ? [j1] : [];
      const ys = [-0.5, ...joints, c.h + 0.6];
      for (let k = 0; k < ys.length - 1; k++) {
        const last = k === ys.length - 2;
        const segTop = last ? c.h : ys[k + 1];
        let f = prismFaces(hexPoly(c.x + offs[k * 2], c.z + offs[k * 2 + 1], r * 0.965), ys[k], ys[k + 1]);
        // hidden sides: the neighbour that way stands clearly higher than this drum
        const slack = lod ? -0.1 * c.h : last ? 0.3 : 0.2;
        const hide = [];
        for (let m = 0; m < 6; m++) {
          const nb = cells.get(c.q + HEX_NB[m][0] + ',' + (c.s + HEX_NB[m][1]));
          if (nb && nb.h >= segTop + slack) hide.push((m * TAU) / 6);
        }
        if (last) f = clipFaces(f, c.tx, 1, c.tz, c.tx * c.x + c.h + c.tz * c.z);
        f = filterFaces(f, (n) => {
          if (Math.abs(n.y) > 0.5) return last && n.y > 0;
          for (const a of hide) if (n.x * Math.cos(a) + n.z * Math.sin(a) > 0.98) return false;
          return true;
        });
        if (f.length) solids.push({ f, tone: tones[k] });
      }
    }
    // drums that have come down
    const nD = R.int(2, 4);
    for (let i = 0; i < 4; i++) {
      const len = R.range(0.35, 0.9),
        an = R.range(0, TAU),
        dist = span * R.range(1.05, 1.4) + r,
        yaw = R.range(0, TAU),
        tip = R.range(-0.15, 0.15);
      if (i >= nD || lod) continue;
      let f = prismFaces(hexPoly(0, 0, r * 0.95, 0), -len / 2, len / 2);
      f = xfFaces(f, { r: [Math.PI / 2 + tip, 0, 0] });
      f = xfFaces(f, { r: [0, yaw, 0], t: [Math.cos(an) * dist, r * 0.72, Math.sin(an) * dist] });
      solids.push({ f, tone: 1 });
    }
    const tl = R.range(0, 0.09),
      tto = R.range(0, TAU);
    const all = solids.map((o) => xfFaces(o.f, { r: [tl * Math.sin(tto), 0, -tl * Math.cos(tto)] }));
    const geos = lod ? all.map((f) => facesToGeo(f, { minimal: true })) : all.map((f, i) => facesToGeo(f, { maxLvl: 0, edge: 0.4, bump: 0.02, seed: seed + i, minimal: (n) => n.y < 0.5 }));
    geos.forEach((g, i) =>
      paintRock(g, {
        tone: solids[i].tone, base: '#34363a', dark: '#17181b', light: '#62656a', lichenAmt: 0.34, mossAmt: 0.24, seed, facet: 0.26, streak: 0.3, soil: 0.65, wear: 0.2, stains: [{ colour: '#6f6a3c', amt: 0.2, freq: 3.4, up: 0.5, k: 0.45 }] })
    );
    return new Builder()
      .add(geos)
      .cylCollider(0, hmax * 0.4, 0, span * 0.45, hmax * 0.8)
      .cylCollider(0, hmax * 0.15, 0, span * 0.85, hmax * 0.3)
      .build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// rock_obsidian: black volcanic glass, 1 to 2.5 m: a broken lump with blades of itself standing
// out of it, every face a clean fracture, every edge catching the light.
// ---------------------------------------------------------------------------------------------
register(
  'rock_obsidian',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2401);
    const S = R.range(1, 2.5);
    const SINK = 0.25;
    const solids = [];
    // the lump the blades stand in
    {
      const s = S * R.range(0.5, 0.66);
      const f = xfFaces(chipRock(new Rng(seed * 104729 + 2401), { size: [s, s * R.range(0.5, 0.7), s * R.range(0.65, 0.9)], cuts: 12, depth: [0.5, 0.95], block: 0.35, nicks: 6, nickDepth: [0.08, 0.3], fit: true }), { r: [R.range(-0.25, 0.25), R.range(0, TAU), R.range(-0.25, 0.25)] });
      solids.push(seat(f, s * 0.12));
    }
    const nS = R.int(4, 6);
    let b = R.range(0, TAU);
    for (let i = 0; i < 6; i++) {
      b += 2.39996 + R.range(-0.4, 0.4);
      const h = i === 0 ? S : S * R.range(0.4, 0.85),
        w = h * R.range(0.3, 0.46),
        d = w * R.range(0.35, 0.6),
        dist = i === 0 ? S * 0.04 : S * R.range(0.14, 0.3),
        ln = i === 0 ? R.range(0, 0.15) : R.range(0.15, 0.55),
        sides = R.int(3, 5),
        yaw = b + Math.PI / 2 + R.range(-0.5, 0.5),
        apex = R.range(1.4, 2.6);
      const f = shard(new Rng(seed * 613 + i * 37 + 9), { h: h + SINK, w, d, sides, chips: 3, apex });
      if (i < nS) solids.push(stand(f, h + SINK, { x: Math.cos(b) * dist, z: Math.sin(b) * dist, sink: SINK, lean: ln, to: b, yaw }));
    }
    // flakes on the ground
    const nF = R.int(4, 7);
    for (let i = 0; i < 7; i++) {
      const s = S * R.range(0.08, 0.2),
        an = R.range(0, TAU),
        dist = S * R.range(0.36, 0.6),
        yaw = R.range(0, TAU),
        rx = R.range(-0.4, 0.4);
      const f = xfFaces(chipRock(new Rng(seed * 211 + i * 19 + 7), { size: [s, s * 0.3, s * 0.6], cuts: 7, depth: [0.4, 0.8], fit: true }), { r: [rx, yaw, 0] });
      if (i < nF && !(lod && i % 2)) solids.push(seat(f, s * 0.05, Math.cos(an) * dist, Math.sin(an) * dist));
    }
    const geos = mesh(solids.filter(solid), lod, { edge: S * 0.16, bump: 0, seed, maxLvl: 1 });
    for (const g of geos)
      paintRock(g, {
        base: '#0d0d11',
        dark: '#050506',
        light: '#1a1921',
        lichenAmt: 0,
        mossAmt: 0,
        seed,
        facet: 0.5,
        soil: 0.25,
        wear: 0,
        rough: 0.24,
        mat: MAT.PLAIN,
        edge: '#474858',
        edgeAmt: 0.6,
        stains: [{ colour: '#2b1620', amt: 0.3, freq: 2.2, k: 0.6 }],
      });
    return new Builder()
      .add(geos)
      .cylCollider(0, S * 0.3, 0, S * 0.34, S * 0.6)
      .build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// salt_crystal: a cluster of great salt cubes, 1 to 3 m, grown into each other, small ones
// crusting the foot.
// ---------------------------------------------------------------------------------------------
register(
  'salt_crystal',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2501);
    const S = R.range(1, 3);
    const solids = [];
    const nB = R.int(4, 7);
    for (let i = 0; i < 7; i++) {
      const a = S * (i === 0 ? R.range(0.5, 0.62) : R.range(0.26, 0.5)),
        an = R.range(0, TAU),
        dist = i === 0 ? 0 : S * R.range(0.16, 0.36),
        y = i === 0 ? S - a * 0.72 : a * R.range(0.1, 0.5) + (i === 1 ? S * 0.2 : 0),
        rx = R.range(-0.6, 0.6),
        ry = R.range(0, TAU),
        rz = R.range(-0.6, 0.6),
        ky = R.range(0.7, 1.5);
      if (i >= nB) continue;
      solids.push(xfFaces(boxFaces(a / 2, (a / 2) * ky, a / 2), { r: [rx, ry, rz], t: [Math.cos(an) * dist, y, Math.sin(an) * dist] }));
    }
    const nS = R.int(12, 20);
    for (let i = 0; i < 20; i++) {
      const a = S * R.range(0.06, 0.16),
        an = R.range(0, TAU),
        dist = S * R.range(0.2, 0.55),
        y = a * R.range(-0.1, 0.4) + (R.chance(0.3) ? S * R.range(0.1, 0.4) * (1 - dist / (S * 0.55)) : 0),
        rx = R.range(-0.7, 0.7),
        ry = R.range(0, TAU),
        rz = R.range(-0.7, 0.7);
      if (i >= nS || (lod && i % 2)) continue;
      solids.push(xfFaces(boxFaces(a / 2), { r: [rx, ry, rz], t: [Math.cos(an) * dist, y, Math.sin(an) * dist] }));
    }
    const geos = lod ? solids.map((f) => facesToGeo(f, { minimal: true, skip: buried })) : solids.map((f) => facesToGeo(f, { maxLvl: 1, edge: S * 0.22, skip: buried }));
    const cRim = col('#e9dfdb'),
      cHeart = col('#b39d9c'),
      cDirt = col('#7d7370'),
      out = col('#ffffff');
    for (const g of geos) {
      const fW = g.userData.faceW,
        fN = g.userData.faceN;
      paint(g, {
        color: (v) => {
          // hopper faces: clear and white along the edges, clouded rose toward the heart
          const w = Math.min(1, fW[v.i] * 1.6);
          out.copy(cRim).lerp(cHeart, w * 0.8);
          out.lerp(cDirt, clamp01(1 - v.y / (S * 0.22)) * 0.75);
          const fy = fN[v.i * 3 + 1];
          return out.multiplyScalar(0.86 + 0.14 * fy);
        },
        rough: 0.26,
        mat: MAT.CRYSTAL,
      });
    }
    return new Builder()
      .add(geos)
      .cylCollider(0, S * 0.3, 0, S * 0.36, S * 0.6)
      .build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// rock_small: three to five loose stones, 0.15 to 0.4 m. No collider.
// ---------------------------------------------------------------------------------------------
register(
  'rock_small',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 2601);
    const n = R.int(3, 5);
    const b = new Builder();
    let an = R.range(0, TAU);
    for (let i = 0; i < 5; i++) {
      an += TAU / n + R.range(-0.5, 0.5);
      const s = R.range(0.15, 0.4),
        dist = i === 0 ? 0.05 : R.range(0.22, 0.48),
        yaw = R.range(0, TAU),
        ky = R.range(0.5, 0.8),
        kz = R.range(0.6, 0.95),
        slate = R.chance(0.35);
      if (i >= n) continue;
      // far off, a stone is the same block with only its first few planes cut
      let f = xfFaces(chipRock(new Rng(seed * 317 + i * 23 + 3), { size: [s, s * ky, s * kz], cuts: lod ? 4 : 7, depth: [0.72, 1.0], vertical: 0.2, block: 0.5 + 0.5 * ((i * 0.37 + seed * 0.21) % 1), nicks: lod ? 0 : 9, nickDepth: [0.06, 0.26], fit: true }), { r: [0, yaw, 0] });
      f = seat(f, s * ky * 0.18, Math.cos(an) * dist, Math.sin(an) * dist);
      const g = lod ? facesToGeo(f, { minimal: true, skip: buried }) : facesToGeo(f, { maxLvl: 0, edge: s * 0.3, bump: s * 0.03, warp: s * 0.03, warpFreq: 3 / s, seed: seed + i, skip: buried });
      paintRock(g, { ...(slate ? SLATE : GRANITE), lichenAmt: 0.4, mossAmt: 0.3, seed: seed + i, facet: 0.12, soil: 0.6 });
      b.add(g);
    }
    return b.build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// standing_stone: a menhir, 2.5 to 3.5 m, one face dressed flat, the rest left as the weather
// found it. opts.glyph = 'sulfur' | 'mercury' | 'salt' cuts that sign into the dressed face
// (dark grooves, no light of its own).
// ---------------------------------------------------------------------------------------------
register(
  'standing_stone',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const glyph = opts && GLYPH[opts.glyph] ? opts.glyph : null;
    const R = new Rng(seed * 7919 + 2701);
    const H = R.range(2.5, 3.5),
      W = R.range(0.9, 1.25),
      D = R.range(0.42, 0.58);
    const zf = D * 0.5;
    const wR = W * R.range(0.4, 0.48),
      wL = W * R.range(0.4, 0.48);
    // cross-section: a broad flat front, a rounded back
    const poly = [
      [wR, zf],
      [-wL, zf],
      [-W * R.range(0.48, 0.54), zf - D * R.range(0.3, 0.5)],
      [-W * R.range(0.28, 0.4), -D * R.range(0.42, 0.52)],
      [W * R.range(0.2, 0.36), -D * R.range(0.42, 0.52)],
      [W * R.range(0.48, 0.54), zf - D * R.range(0.3, 0.55)],
    ];
    let f = prismFaces(poly, -2, H + 0.6);
    // every side but the front leans in a little, and most lean harder above a shoulder
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = Math.hypot(dx, dz) || 1;
      const ox = dz / l,
        oz = -dx / l,
        off0 = ox * (a[0] + b[0]) * 0.5 + oz * (a[1] + b[1]) * 0.5;
      const t = R.range(0.015, 0.07),
        ys = H * R.range(0.42, 0.8),
        more = R.range(0.08, 0.32),
        sh = R.chance(0.75);
      f = clipFaces(f, ox * Math.cos(t), Math.sin(t), oz * Math.cos(t), off0 * Math.cos(t));
      if (sh) {
        const room = Math.abs(ox) * W + Math.abs(oz) * D;
        const t2 = Math.min(t + more, Math.atan((0.3 * room) / (H - ys)));
        const off = off0 - ys * Math.tan(t);
        f = clipFaces(f, ox * Math.cos(t2), Math.sin(t2), oz * Math.cos(t2), off * Math.cos(t2) + ys * Math.sin(t2));
      }
    }
    // the top: weathered to one slant, a lesser slant the other way, the corners gone
    {
      const ta = R.range(0, TAU),
        s1 = R.range(0.3, 0.8),
        tb = ta + Math.PI + R.range(-0.8, 0.8),
        s2 = R.range(0.15, 0.5),
        low = R.range(0, 0.12);
      f = clipFaces(f, Math.cos(ta) * s1, 1, Math.sin(ta) * s1 * 0.6, H);
      f = clipFaces(f, Math.cos(tb) * s2, 1, Math.sin(tb) * s2 * 0.6, H - low);
      for (let k = 0; k < 4; k++) {
        const a = R.range(0, TAU);
        f = nick(f, Math.cos(a), R.range(0.5, 1.2), Math.sin(a), R.range(0.03, 0.1));
      }
      for (let k = 0; k < 3; k++) {
        const a = R.range(0, TAU);
        f = nick(f, Math.cos(a), R.range(0.2, 0.36), Math.sin(a), R.range(0.04, 0.09));
      }
    }
    // stand it at its full height, whatever the weather took, and cut it off below ground
    f = xfFaces(f, { t: [0, H - facesInfo(f).max.y, 0] });
    f = clipFaces(f, 0, -1, 0, 0.6);
    const lean = [R.range(-0.05, 0.05), 0, R.range(-0.07, 0.07)];
    f = xfFaces(f, { r: lean });
    const WARP = 0.03,
      WFREQ = 1.15;
    const b = new Builder();
    const geos = mesh([f], lod, { edge: 0.2, bump: 0.006, warp: WARP, warpFreq: WFREQ, seed, budget: glyph ? 520 : 860 });
    for (const g of geos)
      paintRock(g, {
        ...WARM,
        lichenAmt: 0.42,
        mossAmt: 0.34,
        seed,
        facet: 0.1,
        streak: 0.5,
        soil: 0.6,
        stains: [
          { colour: '#a09f8f', amt: 0.24, freq: 3.6, up: -0.4, k: 0.5 },
          { colour: '#7c7040', amt: 0.2, freq: 2.8, up: -0.2, k: 0.4 },
          { colour: '#2c2a28', amt: 0.3, freq: 0.9, k: 0.4 },
        ],
      });
    b.add(geos);
    if (glyph) {
      const gs = Math.min(0.56, (wR + wL) * 0.62);
      const step = lod ? 3 : 1;
      const paths = GLYPH[glyph].map((p) => p.filter((_, i) => i % step === 0 || i === p.length - 1).map(([x, y]) => [x * gs, y * gs]));
      const g = strokes(paths, lod ? 0.04 : 0.032, 0.03);
      if (g) {
        paint(g, { color: '#0c0c0d', rough: 1, mat: MAT.STONE });
        xf(g, { t: [(wR - wL) * 0.5, H * 0.6, zf - 0.03 + 0.01] });
        xf(g, { r: lean });
        // the dressed face is warped with the rest of the stone: carry the grooves along with it
        const wn = warpNoise(seed),
          w = new V3();
        deform(g, (p) => p.add(warpAt(wn, p.x, p.y, p.z, WARP, WFREQ, w)), false);
        b.add(g);
      }
    }
    b.boxCollider(0, H / 2, 0, W * 0.44, H / 2, D * 0.46);
    return b.build();
  },
  { kind: 'rock', lods: 2, variants: 6 }
);