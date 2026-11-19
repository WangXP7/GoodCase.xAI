// Things the potions make or unmake: the rockfall and its rubble, ice on the water, crust on the
// lava, the pillar of salt. Registers rock_cracked, rubble, ice_floe, lava_crust, salt_pillar.
//
// All of it is cut the way rocks.js cuts rock: convex solids made by slicing blocks with planes,
// so faces stay flat and edges hard. Plates (ice, crust) are one slab broken along real cracks.
import { Builder, Rng, Noise, THREE, TAU, MAT, col, paint } from '../kit.js';
import { register } from '../registry.js';
import { boxFaces, prismFaces, clipFaces, splitFaces, xfFaces, xfPlane, facesInfo, nick, chipRock, facesToGeo, paintRock, tris, clamp01, smooth01, V3 } from './_shared.js';

// ---------------------------------------------------------------------------------------------
// Shared tools
// ---------------------------------------------------------------------------------------------
const solid = (f) => f && f.length >= 4;
/** Faces that look down into the ground: nobody sees them. */
const buried = (n, f) => n.y < -0.7 && f.every((p) => p.y < 0.03);
const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const hash3 = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
/** One tone per face, 0..1, from the direction it looks in. */
const faceTone = (fN, i) => hash3(Math.round(fN[i * 3] * 40), Math.round(fN[i * 3 + 1] * 40), Math.round(fN[i * 3 + 2] * 40));

/** Newell normal of a face: its direction is the face normal, its length twice the area. */
function faceNormal(f, out = new V3()) {
  out.set(0, 0, 0);
  for (let i = 0; i < f.length; i++) {
    const a = f[i],
      b = f[(i + 1) % f.length];
    out.x += (a.y - b.y) * (a.z + b.z);
    out.y += (a.z - b.z) * (a.x + b.x);
    out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out;
}

/** Centre of mass of a convex solid. */
function centreOfMass(faces) {
  const c = new V3(),
    t = new V3();
  let vol = 0;
  for (const f of faces)
    for (let i = 1; i < f.length - 1; i++) {
      const a = f[0],
        b = f[i],
        d = f[i + 1];
      const v = a.dot(t.crossVectors(b, d)) / 6;
      vol += v;
      c.x += ((a.x + b.x + d.x) / 4) * v;
      c.y += ((a.y + b.y + d.y) / 4) * v;
      c.z += ((a.z + b.z + d.z) / 4) * v;
    }
  return Math.abs(vol) > 1e-9 ? c.multiplyScalar(1 / vol) : facesInfo(faces).centre;
}

/** The face of a solid that lies on the plane n . p = d (n unit), or null. */
function faceOn(faces, n, d) {
  for (const f of faces) if (f.every((p) => Math.abs(p.x * n[0] + p.y * n[1] + p.z * n[2] - d) < 1e-4)) return f;
  return null;
}
/** Where the outline of a face crosses the plane `axis` = value. */
function crossings(face, axis, value) {
  const out = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i],
      b = face[(i + 1) % face.length];
    const da = a[axis] - value,
      db = b[axis] - value;
    if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) out.push(new V3().lerpVectors(a, b, da / (da - db)));
  }
  return out;
}

/** Solids -> unpainted geometries, coarsened until they fit the triangle budget. */
function mesh(solids, { edge = 0.3, bump = 0.02, warp = 0, warpFreq = 1.3, seed = 1, budget = 900, maxLvl = 2, skip = buried } = {}) {
  let e = edge;
  for (let k = 0; ; k++) {
    const gs = solids.map((f) => facesToGeo(f, { edge: e, maxLvl, bump, warp, warpFreq, seed, skip }));
    if (k === 10 || gs.reduce((a, g) => a + tris(g), 0) <= budget) return gs;
    e *= 1.25;
  }
}

// ---- plates: a slab with an upper face, broken across by cracks -----------------------------

/** A convex slab: a block trimmed by `n` upright planes between d0 and d1 from the middle. */
function slab(R, n, d0, d1, y0, y1) {
  let f = prismFaces(
    [
      [-2.6, -2.6],
      [2.6, -2.6],
      [2.6, 2.6],
      [-2.6, 2.6],
    ],
    y0,
    y1
  );
  const a0 = R.range(0, TAU);
  for (let i = 0; i < n; i++) {
    const a = a0 + ((i + R.range(-0.3, 0.3)) / n) * TAU;
    f = clipFaces(f, Math.cos(a), R.range(-0.12, 0.12), Math.sin(a), R.range(d0, d1));
  }
  return f;
}

/** The face of a solid that looks up, with its area. */
function topOf(faces) {
  let best = null,
    ba = 0;
  const n = new V3();
  for (const f of faces) {
    faceNormal(f, n);
    const a = n.length();
    if (a > 1e-9 && n.y / a > 0.8 && a > ba) {
      best = f;
      ba = a;
    }
  }
  return best ? { face: best, area: ba / 2 } : null;
}

/**
 * Break a slab: `count` times the largest piece cracks in two. gapOf(k) is the width of crack k.
 * Returns the pieces and, for each crack, the line it draws across the top.
 */
function breakSlab(R, plate, top, count, gapOf) {
  const pieces = [plate];
  const lines = [];
  for (let k = 0; k < count; k++) {
    let bi = -1,
      ba = 0;
    pieces.forEach((f, i) => {
      const t = topOf(f);
      if (t && t.area > ba) {
        ba = t.area;
        bi = i;
      }
    });
    if (bi < 0) break;
    const f = pieces[bi];
    const tf = topOf(f).face;
    const c = new V3();
    for (const p of tf) c.add(p);
    c.multiplyScalar(1 / tf.length);
    const gap = gapOf(k);
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = R.range(0, TAU),
        lean = R.range(-0.16, 0.16),
        off = R.range(-0.22, 0.22);
      const n = unit(Math.cos(a), lean, Math.sin(a));
      const d = n[0] * c.x + n[1] * top + n[2] * c.z + off;
      const [A, B] = splitFaces(f, n[0], n[1], n[2], d, gap);
      if (!solid(A) || !solid(B)) continue;
      const ta = topOf(A),
        tb = topOf(B);
      if (!ta || !tb || Math.min(ta.area, tb.area) < ba * 0.24) continue;
      pieces.splice(bi, 1, A, B);
      const ends = ta.face.filter((p) => Math.abs(p.x * n[0] + p.y * n[1] + p.z * n[2] - (d - gap / 2)) < 1e-4);
      if (ends.length >= 2) lines.push({ k, a: ends[0].clone(), b: ends[ends.length - 1].clone(), gap, n });
      break;
    }
  }
  return { pieces, lines };
}

/** The upper faces of the pieces as outlines with their planes, for laying things on them. */
function tops(pieces) {
  const out = [];
  for (const f of pieces) {
    const t = topOf(f);
    if (!t) continue;
    const n = faceNormal(t.face).normalize();
    const c = new V3();
    for (const p of t.face) c.add(p);
    c.multiplyScalar(1 / t.face.length);
    out.push({ poly: t.face, n, d: n.dot(t.face[0]), c, area: t.area });
  }
  return out;
}
const yOn = (t, x, z) => (t.d - t.n.x * x - t.n.z * z) / t.n.y;
/** How far inside a convex outline a point is in plan (negative: outside). */
function inside(t, x, z) {
  let m = Infinity;
  const P = t.poly;
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length];
    const ex = b.x - a.x,
      ez = b.z - a.z;
    const l = Math.hypot(ex, ez);
    if (l < 1e-6) continue;
    let nx = -ez / l,
      nz = ex / l;
    if (nx * (t.c.x - a.x) + nz * (t.c.z - a.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    m = Math.min(m, nx * (x - a.x) + nz * (z - a.z));
  }
  return m;
}
function pieceAt(T, x, z) {
  let best = null,
    bm = -Infinity;
  for (const t of T) {
    const m = inside(t, x, z);
    if (m > bm) {
      bm = m;
      best = t;
    }
  }
  return { t: best, m: bm };
}

/**
 * A low ridge along pts (points on a surface): two slopes meeting at a crest.
 *   w, h    half width and height, numbers or (t 0..1, i) => number
 *   round   shade it as a rope (normals turned out at the foot) instead of a sharp roof
 * Round ridges keep three vertices per point: foot, crest, foot.
 */
function ridge(pts, w, h, round = false) {
  const n = pts.length;
  const P = [],
    N = [],
    idx = [];
  const T = new V3();
  const k = 0.5,
    kl = Math.hypot(1, k);
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]);
    T.y = 0;
    T.normalize();
    const sx = -T.z,
      sz = T.x;
    const t = n > 1 ? i / (n - 1) : 0;
    const ww = typeof w === 'function' ? w(t, i) : w,
      hh = typeof h === 'function' ? h(t, i) : h;
    const p = pts[i];
    P.push(p.x - sx * ww, p.y, p.z - sz * ww, p.x, p.y + hh, p.z, p.x + sx * ww, p.y, p.z + sz * ww);
    N.push(-sx / kl, k / kl, -sz / kl, 0, 1, 0, sx / kl, k / kl, sz / kl);
  }
  for (let i = 0; i < n - 1; i++) {
    const L0 = i * 3,
      C0 = L0 + 1,
      R0 = L0 + 2,
      L1 = L0 + 3,
      C1 = L0 + 4,
      R1 = L0 + 5;
    idx.push(R0, R1, C0, R1, C1, C0, L1, L0, C0, L1, C0, C1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(idx);
  if (round) {
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    return g;
  }
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

/** A flat ribbon lying on a surface along pts; w(t) is its half width. */
function ribbon(pts, w) {
  const n = pts.length;
  const P = [],
    N = [],
    idx = [];
  const T = new V3();
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]);
    T.y = 0;
    T.normalize();
    const sx = -T.z,
      sz = T.x;
    const ww = typeof w === 'function' ? w(n > 1 ? i / (n - 1) : 0, i) : w;
    const p = pts[i];
    P.push(p.x - sx * ww, p.y, p.z - sz * ww, p.x + sx * ww, p.y, p.z + sz * ww);
    N.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n - 1; i++) {
    const L0 = i * 2,
      R0 = L0 + 1,
      L1 = L0 + 2,
      R1 = L0 + 3;
    idx.push(L0, R0, L1, R0, R1, L1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------
// rock_cracked: the plug in the canyon. One mass of dark scoria that came down in a piece and
// split where it struck: two great blocks leaning apart, a keystone driven between them, a cap
// slid along its bed. The fissures go right through and sulfur has bloomed in them.
// 8 m wide (X), 5 m tall, 4 m deep, footing to y = -1.
// ---------------------------------------------------------------------------------------------
const SCAR_ROCK = { base: '#4b4744', dark: '#232120', light: '#79736b' };
const SULFUR = col('#a68b2d');
const SULFUR_DULL = col('#7f6f36');

/** Sulfur in and around the fissures: planes are where this block's fissure walls lie. */
function sulfurPass(geo, planes, seed) {
  const nz = new Noise(seed * 29 + 3);
  const fN = geo.userData.faceN,
    fW = geo.userData.faceW;
  const c = geo.attributes.color;
  const out = new THREE.Color();
  paint(geo, {
    color: (v) => {
      out.setRGB(c.getX(v.i), c.getY(v.i), c.getZ(v.i));
      let wall = false,
        lip = 0;
      for (const pl of planes) {
        const dist = Math.abs(v.x * pl.n[0] + v.y * pl.n[1] + v.z * pl.n[2] - pl.d);
        const al = Math.abs(fN[v.i * 3] * pl.n[0] + fN[v.i * 3 + 1] * pl.n[1] + fN[v.i * 3 + 2] * pl.n[2]);
        if (al > 0.96 && dist < 0.25) wall = true;
        else lip = Math.max(lip, 1 - dist / 0.34);
      }
      const n1 = nz.fbm3(v.x * 1.9, v.y * 1.9, v.z * 1.9, 3) * 0.5 + 0.5;
      if (wall) {
        // crusted yellow in patches, and all of it dark toward the heart of the fissure
        out.lerp(SULFUR, smooth01(0.48, 0.64, n1) * 0.72);
        out.multiplyScalar(0.68 - 0.36 * Math.min(1, fW[v.i] * 1.6));
      } else if (lip > 0) out.lerp(SULFUR_DULL, lip * lip * smooth01(0.46, 0.7, n1) * 0.4);
      return out;
    },
  });
}

register(
  'rock_cracked',
  (seed) => {
    const R = new Rng(seed * 7919 + 3101);
    let mass = chipRock(new Rng(seed * 104729 + 3101), { size: [8, 6, 4], cuts: 14, depth: [0.8, 1.0], vertical: 0.45, tilt: 0.14, block: 0.92, fit: true });
    mass = xfFaces(mass, { t: [0, 2, 0] }); // y from -1 to 5
    // a broken skyline, highest over the keystone
    mass = nick(mass, 0.3, 1, 0.12, 0.95);
    mass = nick(mass, -0.34, 1, -0.1, 0.8);
    mass = nick(mass, 0.04, 1, -0.5, 0.45);
    mass = nick(mass, -0.03, 1, 0.55, 0.4);

    // the fissures: A and B lean apart and make the middle a keystone, C is a bed through the left block
    const nA = unit(0.97, 0.22, 0.1 + R.range(-0.04, 0.04)),
      nB = unit(0.96, -0.26, -0.12 + R.range(-0.04, 0.04)),
      nC = unit(-0.22, 0.95, 0.2);
    const dA = nA[0] * (-1.3 + R.range(-0.15, 0.15)) + nA[1] * 2,
      dB = nB[0] * (1.45 + R.range(-0.15, 0.15)) + nB[1] * 2,
      dC = nC[0] * -2.9 + nC[1] * 2.75;
    const gA = 0.18,
      gB = 0.15,
      gC = 0.07;
    const [L, rest] = splitFaces(mass, nA[0], nA[1], nA[2], dA, gA);
    const [M, Rt] = splitFaces(rest, nB[0], nB[1], nB[2], dB, gB);
    const [Lb, Lc] = splitFaces(L, nC[0], nC[1], nC[2], dC, gC);
    const A0 = { n: nA, d: dA - gA / 2 },
      A1 = { n: nA, d: dA + gA / 2 },
      B0 = { n: nB, d: dB - gB / 2 },
      B1 = { n: nB, d: dB + gB / 2 },
      C0 = { n: nC, d: dC - gC / 2 },
      C1 = { n: nC, d: dC + gC / 2 };
    // the two walls of each fissure, taken before anything moves
    const fissures = [
      { n: nA, d: dA, walls: [faceOn(L, nA, A0.d), faceOn(M, nA, A1.d)] },
      { n: nB, d: dB, walls: [faceOn(M, nB, B0.d), faceOn(Rt, nB, B1.d)] },
    ].filter((fs) => fs.walls[0] && fs.walls[1]);

    // each block has settled its own way: the flanks lean out, the keystone has dropped and turned
    const blocks = [
      { f: Lb, planes: [A0, C0], move: { r: [0, 0, 0.022], pivot: [-2.8, -1, 0], t: [-0.03, 0, 0] } },
      { f: Lc, planes: [A0, C1], move: { r: [0.02, 0.05, 0.04], pivot: [-2.9, 2.75, 0], t: [-0.12, 0.02, 0.1] } },
      { f: M, planes: [A1, B0], move: { r: [0.03, -0.04, -0.012], pivot: [0, 2, 0], t: [0, -0.14, 0.1] } },
      { f: Rt, planes: [B1], move: { r: [-0.015, 0, -0.03], pivot: [2.8, -1, 0], t: [0.04, 0, 0] } },
    ].filter((b) => solid(b.f));
    const big = [];
    blocks.forEach((b, i) => {
      let f = xfFaces(b.f, b.move);
      const NR = new Rng(seed * 811 + i * 53 + 7);
      for (let k = 0; k < 15; k++) f = nick(f, NR.gauss(), NR.gauss() * 0.7, NR.gauss(), NR.range(0.14, 0.7));
      big.push({ f, planes: b.planes.map((p) => xfPlane(p, b.move)) });
    });

    // stones caught in the fissures, and what has gathered at the foot
    const small = [];
    const stone = (x, y, z, s, k, squash = 0.75) => {
      const SR = new Rng(seed * 613 + k * 37 + 11);
      const f = chipRock(SR, { size: [s, s * squash, s * SR.range(0.7, 0.95)], cuts: 10, depth: [0.55, 0.95], block: 0.25, nicks: 5, nickDepth: [0.08, 0.3], fit: true });
      small.push(xfFaces(f, { r: [SR.range(-0.5, 0.5), SR.range(0, TAU), SR.range(-0.5, 0.5)], t: [x, y, z] }));
    };
    let sk = 0;
    for (const fs of fissures) {
      const xAt = (y, z) => (fs.d - fs.n[1] * y - fs.n[2] * z) / fs.n[0];
      // jammed in the mouth of the fissure, front and back, where both walls still stand
      for (const y0 of [1.1, 2.5, 3.7]) {
        const y = y0 + R.range(-0.3, 0.3);
        const c = fs.walls.map((w) => crossings(w, 'y', y).map((p) => p.z));
        const s1 = R.range(0.36, 0.52),
          s2 = R.range(0.34, 0.5),
          k1 = R.chance(0.75),
          k2 = R.chance(0.6);
        if (c[0].length < 2 || c[1].length < 2) continue;
        const front = Math.min(Math.max(...c[0]), Math.max(...c[1])) - s1 * 0.5,
          back = Math.max(Math.min(...c[0]), Math.min(...c[1])) + s2 * 0.5;
        if (k1) stone(xAt(y, front), y, front, s1, sk++, 1.3);
        if (k2) stone(xAt(y, back), y, back, s2, sk++, 1.3);
      }
      // and sitting in the notch along the top
      for (const z0 of [-1.1, 0, 1.1]) {
        const z = z0 + R.range(-0.3, 0.3);
        const c = fs.walls.map((w) => crossings(w, 'z', z).map((p) => p.y));
        const s = R.range(0.45, 0.7);
        if (c[0].length < 2 || c[1].length < 2) continue;
        const y = Math.min(Math.max(...c[0]), Math.max(...c[1])) - 0.14 - s * 0.3;
        stone(xAt(y, z), y, z, s, sk++, 0.9);
      }
    }
    // scree: most of it lies where the fissures shed it, the larger stones against the foot
    const feet = [-1.1, 1.3];
    for (let i = 0; i < 22; i++) {
      const front = i % 2 === 0;
      const near = R.chance(0.6);
      const out = Math.pow(R.next(), 1.6) * 0.95;
      const s = R.range(0.16, 0.66) * (1 - 0.45 * out),
        x = near ? R.pick(feet) + R.gauss() * 0.75 : R.range(-3.75, 3.75),
        z = (front ? 1 : -1) * (1.95 + out);
      stone(Math.max(-3.8, Math.min(3.8, x)), s * 0.75 * R.range(0.1, 0.3), z, s, 40 + i);
    }

    const geos = mesh(
      big.map((b) => b.f),
      { edge: 0.42, bump: 0.05, warp: 0.11, warpFreq: 0.6, seed, budget: 3300 }
    );
    const cracks = [];
    for (const b of big) for (const p of b.planes) cracks.push({ n: p.n, d: p.d, w: 0.3, k: 0.5 });
    const look = { ...SCAR_ROCK, lichenAmt: 0.12, mossAmt: 0, seed, facet: 0.22, streak: 0.4, soil: 0.6, wear: 0.2, stains: [{ colour: '#201d1c', amt: 0.4, freq: 0.9, k: 0.55 }, { colour: '#6a5f4e', amt: 0.25, freq: 2.6, up: 0.2, k: 0.4 }] };
    geos.forEach((g, i) => {
      paintRock(g, { ...look, cracks });
      sulfurPass(g, big[i].planes, seed);
    });
    const sg = mesh(small, { edge: 0.3, bump: 0.02, warp: 0.02, warpFreq: 3, seed: seed + 5, budget: 1700, maxLvl: 0 });
    sg.forEach((g, i) => paintRock(g, { ...look, seed: seed + i, facet: 0.2, streak: 0, stains: [{ colour: '#8d7a34', amt: i % 3 === 0 ? 0.34 : 0.12, freq: 3.2, k: 0.5 }] }));

    return new Builder().add(geos, sg).boxCollider(0, 2, 0, 4, 3, 2).build();
  },
  { kind: 'gameplay', variants: 1 }
);

// ---------------------------------------------------------------------------------------------
// rubble: one piece of the plug after the blast, 0.3 to 0.9 m, all fresh fracture. Centred on
// its centre of mass; model.radius is the true bounding radius (the game rolls it as a sphere).
// ---------------------------------------------------------------------------------------------
const RUBBLE_SIZE = [0.48, 0.68, 0.34, 0.77, 0.56, 0.8, 0.3, 0.7];
register(
  'rubble',
  (seed) => {
    const s = RUBBLE_SIZE[(((seed - 1) % 8) + 8) % 8];
    const R = new Rng(seed * 7919 + 3201);
    let f = chipRock(new Rng(seed * 104729 + 3201), { size: [s, s * R.range(0.66, 0.9), s * R.range(0.72, 0.95)], cuts: 8, depth: [0.6, 0.95], vertical: 0.3, block: 0.5, nicks: 4, nickDepth: [0.08, 0.3], fit: true });
    f = xfFaces(f, { r: [R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)] });
    const c = centreOfMass(f);
    f = xfFaces(f, { t: [-c.x, -c.y, -c.z] });
    const g = facesToGeo(f, { maxLvl: 0, edge: s * 0.5, bump: s * 0.02, seed });
    paintRock(g, {
      base: '#4f4a47',
      dark: '#292625',
      light: '#7b746c',
      lichenAmt: 0,
      mossAmt: 0,
      soil: 0,
      ground: -10,
      facet: 0.24,
      wear: 0.22,
      seed,
      stains: [{ colour: '#9a8430', amt: seed % 3 === 0 ? 0.4 : 0.2, freq: 2.2 / s, k: 0.55 }],
    });
    let rad = 0;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) rad = Math.max(rad, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    const m = new Builder()
      .add(g)
      .sphereCollider(0, 0, 0, rad * 0.72)
      .build();
    m.radius = rad;
    return m;
  },
  { kind: 'gameplay', variants: 8 }
);

// ---------------------------------------------------------------------------------------------
// ice_floe: a plate of lake ice, 3.6 m across and 0.5 m thick, the waterline at y = 0 and the
// top at 0.14. Frost on top, clear and blue-green where it broke. It has cracked across and one
// of the cracks has frozen shut again in a ridge.
// ---------------------------------------------------------------------------------------------
const ICE = { frost: col('#d6e0e5'), clear: col('#739fb1'), scour: col('#4f8398'), rim: col('#b9dbe7'), side: col('#8ec3d4'), deep: col('#0e3642'), seam: col('#e9f0f3'), hair: col('#27505f') };

function paintIce(g, seed, top, bot) {
  const nz = new Noise(seed * 17 + 3);
  const fN = g.userData.faceN,
    fW = g.userData.faceW;
  const out = new THREE.Color();
  const kind = (i) => (fN[i * 3 + 1] > 0.8 ? 0 : fN[i * 3 + 1] > 0.25 ? 1 : 2); // top, bevel, wall
  let frost = 1;
  return paint(g, {
    color: (v) => {
      const k = kind(v.i);
      if (k === 0) {
        const w = Math.min(1, fW[v.i] * 1.5);
        const n1 = nz.fbm3(v.x * 1.2, 0.5, v.z * 1.2, 3) * 0.5 + 0.5;
        const n2 = nz.fbm3(v.x * 3.3 + 9, 4, v.z * 3.3, 2) * 0.5 + 0.5;
        frost = clamp01(0.28 + w * 0.8 + (n2 - 0.5) * 0.8);
        out.copy(ICE.clear).lerp(ICE.frost, frost);
        const sc = smooth01(0.5, 0.66, n1) * 0.75;
        frost *= 1 - sc;
        return out.lerp(ICE.scour, sc);
      }
      frost = 0;
      if (k === 1) return out.copy(ICE.rim).multiplyScalar(0.9 + 0.2 * faceTone(fN, v.i));
      const t = clamp01((v.y - bot) / (top - bot));
      return out
        .copy(ICE.deep)
        .lerp(ICE.side, t * t)
        .multiplyScalar(0.86 + 0.28 * faceTone(fN, v.i));
    },
    rough: (v) => (kind(v.i) === 0 ? 0.36 + 0.5 * frost : 0.1),
    mat: (v) => (kind(v.i) === 0 ? MAT.PLAIN : MAT.CRYSTAL),
    emissive: 0,
    metal: 0,
  });
}

register(
  'ice_floe',
  (seed) => {
    const R = new Rng(seed * 7919 + 3301);
    const TOP = 0.14,
      BOT = -0.36;
    let plate = slab(R, R.int(8, 9), 1.6, 1.8, BOT, TOP);
    // the broken rim: chips off the upper edge, and the under side melted back
    for (let i = 0; i < 14; i++) {
      const a = R.range(0, TAU);
      plate = nick(plate, Math.cos(a), R.range(0.7, 1.3), Math.sin(a), R.range(0.025, 0.085));
    }
    for (let i = 0; i < 9; i++) {
      const a = R.range(0, TAU);
      plate = nick(plate, Math.cos(a), -R.range(0.5, 0.9), Math.sin(a), R.range(0.1, 0.24));
    }
    // cracks: the first and the last have frozen shut, the others stand open on dark water
    const shut = (k) => k === 0 || k === 3;
    const nC = 3 + (seed % 2);
    const { pieces, lines } = breakSlab(R, plate, TOP, nC, (k) => (shut(k) ? 0.004 : R.range(0.03, 0.05)));
    // the pieces no longer lie quite true to each other
    let moved = pieces.map((f) => {
      const i = facesInfo(f);
      return xfFaces(f, { r: [R.range(-0.01, 0.01), 0, R.range(-0.01, 0.01)], pivot: [i.centre.x, TOP, i.centre.z], t: [0, R.range(-0.012, 0.012), 0] });
    });
    let hi = -Infinity;
    for (const f of moved) hi = Math.max(hi, facesInfo(f).max.y);
    moved = moved.map((f) => xfFaces(f, { t: [0, TOP - hi, 0] }));

    const geos = mesh(moved, { edge: 0.34, bump: 0, seed, budget: 600, maxLvl: 2, skip: (n) => n.y < -0.4 });
    for (const g of geos) paintIce(g, seed, TOP, BOT);
    const b = new Builder().add(geos);

    const T = tops(moved);
    // refrozen seams: a low broken ridge of white ice along the crack
    for (const ln of lines) {
      if (!shut(ln.k)) continue;
      const len = ln.a.distanceTo(ln.b);
      const n = Math.max(3, Math.round(len / 0.26));
      const pts = [],
        hs = [],
        ws = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = ln.a.x + (ln.b.x - ln.a.x) * t + R.range(-0.025, 0.025),
          z = ln.a.z + (ln.b.z - ln.a.z) * t + R.range(-0.025, 0.025);
        const at = pieceAt(T, x, z);
        pts.push(new V3(x, (at.t ? yOn(at.t, x, z) : TOP) - 0.014, z));
        const end = Math.min(1, Math.min(t, 1 - t) * 5);
        hs.push((0.03 + R.range(0, 0.04)) * end + 0.012);
        ws.push((0.05 + R.range(0, 0.05)) * (0.5 + 0.5 * end));
      }
      const g = ridge(
        pts,
        (t, i) => ws[i],
        (t, i) => hs[i]
      );
      paint(g, { color: (v) => ICE.seam.clone().multiplyScalar(0.9 + 0.1 * hash3(v.x * 31, v.y * 17, v.z * 23)), rough: 0.72, mat: MAT.PLAIN, emissive: 0, metal: 0 });
      b.add(g);
    }
    // hair cracks running in from the edges: clear dark lines in the frost
    const nH = R.int(9, 12);
    for (let i = 0; i < nH && T.length; i++) {
      const t = R.pick(T);
      const P = t.poly;
      const e = R.int(0, P.length - 1);
      const a = P[e],
        c = P[(e + 1) % P.length];
      const u = R.range(0.2, 0.8);
      let x = a.x + (c.x - a.x) * u,
        z = a.z + (c.z - a.z) * u;
      let dir = Math.atan2(t.c.z - z, t.c.x - x) + R.range(-0.7, 0.7);
      const pts = [new V3(x, yOn(t, x, z) + 0.004, z)];
      const steps = R.int(2, 4);
      for (let s = 0; s < steps; s++) {
        const len = R.range(0.16, 0.36);
        const nx = x + Math.cos(dir) * len,
          nzp = z + Math.sin(dir) * len;
        if (inside(t, nx, nzp) < 0.04) break;
        x = nx;
        z = nzp;
        pts.push(new V3(x, yOn(t, x, z) + 0.004, z));
        dir += R.range(-0.6, 0.6);
      }
      if (pts.length < 2) continue;
      const g = ribbon(pts, (tt) => 0.013 * (1 - tt) + 0.0035);
      paint(g, { color: ICE.hair, rough: 0.22, mat: MAT.PLAIN, emissive: 0, metal: 0 });
      b.add(g);
    }
    return b.cylCollider(0, TOP - 0.25, 0, 1.7, 0.5).build();
  },
  { kind: 'gameplay', variants: 3 }
);

// ---------------------------------------------------------------------------------------------
// lava_crust: a plate of chilled basalt on the melt, 3.2 m across, the top at y = 0.1. The skin
// wrinkled into ropes while it still crept, then cracked across them; the cracks and the under
// edge show what is beneath.
// ---------------------------------------------------------------------------------------------
const LAVA = { skin: col('#151417'), sheen: col('#35353c'), warm: col('#2b1712'), ember: col('#5e1708'), hot: col('#ff5a14'), core: col('#ff8a2e') };

function paintCrust(g, seed, top, bot) {
  const nz = new Noise(seed * 19 + 5);
  const fN = g.userData.faceN,
    fW = g.userData.faceW;
  const out = new THREE.Color();
  const kind = (i) => (fN[i * 3 + 1] > 0.8 ? 0 : fN[i * 3 + 1] > 0.25 ? 1 : 2); // top, bevel, wall
  let sheen = 0,
    heat = 0;
  return paint(g, {
    color: (v) => {
      const k = kind(v.i);
      heat = 0;
      if (k === 0) {
        const w = Math.min(1, fW[v.i] * 1.5);
        const n1 = nz.fbm3(v.x * 1.6, 0.5, v.z * 1.6, 3) * 0.5 + 0.5;
        sheen = smooth01(0.48, 0.72, n1);
        out.copy(LAVA.skin).lerp(LAVA.sheen, sheen * 0.75);
        return out.lerp(LAVA.warm, (1 - w) * 0.55).multiplyScalar(0.85 + 0.3 * faceTone(fN, v.i));
      }
      sheen = 0;
      if (k === 1) return out.copy(LAVA.skin).lerp(LAVA.warm, 0.6);
      // the walls of the cracks and the outer edge: black at the lip, lit from below
      const t = clamp01((v.y - bot) / (top - bot));
      heat = 1 - smooth01(0.45, 1.0, t);
      return out.copy(LAVA.ember).lerp(LAVA.hot, heat);
    },
    emissive: (v) => (kind(v.i) === 2 ? 0.3 + 3.4 * heat : 0),
    rough: (v) => (kind(v.i) === 0 ? 0.72 - 0.3 * sheen : 0.8),
    mat: (v) => (kind(v.i) === 2 ? MAT.GLOW : MAT.STONE),
    metal: 0,
  });
}

register(
  'lava_crust',
  (seed) => {
    const R = new Rng(seed * 7919 + 3401);
    const TOP = 0.1,
      BOT = -0.12;
    let plate = slab(R, R.int(10, 12), 1.42, 1.6, BOT, TOP);
    for (let i = 0; i < 10; i++) {
      const a = R.range(0, TAU);
      // shallow and steep: two of these on one corner must not eat the wall that glows beneath it
      plate = nick(plate, Math.cos(a), R.range(1.0, 1.6), Math.sin(a), R.range(0.015, 0.04));
    }
    // what glows through: a sheet of melt just under the skin
    const MELT = 0.035;
    const under = topOf(plate).face.map((p) => new V3(p.x * 0.95, MELT, p.z * 0.95));
    const { pieces, lines } = breakSlab(R, plate, TOP, 3 + (seed % 2), () => R.range(0.03, 0.055));
    // corners crumble first, and a wall that crumbles lets its crack gape: no two cracks alike
    let moved = pieces.map((piece) => {
      let f = piece;
      for (let k = 0; k < 2; k++) {
        const a = R.range(0, TAU);
        const cut = nick(f, Math.cos(a), 0, Math.sin(a), R.range(0.02, 0.06));
        if (solid(cut)) f = cut;
      }
      const i = facesInfo(f);
      return xfFaces(f, { r: [R.range(-0.012, 0.012), 0, R.range(-0.012, 0.012)], pivot: [i.centre.x, TOP, i.centre.z], t: [0, R.range(-0.008, 0.008), 0] });
    });
    let hi = -Infinity;
    for (const f of moved) hi = Math.max(hi, facesInfo(f).max.y);
    moved = moved.map((f) => xfFaces(f, { t: [0, TOP - hi, 0] }));

    const geos = mesh(moved, { edge: 0.5, bump: 0.012, seed, budget: 300, maxLvl: 1, skip: (n) => n.y < -0.4 });
    for (const g of geos) paintCrust(g, seed, TOP, BOT);
    const b = new Builder().add(geos);

    const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    let used = geos.reduce((s, g) => s + triCount(g), 0);
    /** Loose triangles lying flat, facing up. */
    const flat = (P) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      const N = new Float32Array(P.length);
      for (let k = 1; k < N.length; k += 3) N[k] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      return g;
    };

    // the melt: hotter in some places than in others, so the cracks do not glow evenly
    {
      const hz = new Noise(seed * 23 + 11);
      const rings = [0.5, 1];
      const n = under.length;
      const at = (i, j) => [under[i % n].x * rings[j], MELT, under[i % n].z * rings[j]];
      const P = [];
      for (let i = 0; i < n; i++) {
        P.push(0, MELT, 0, ...at(i, 0), ...at(i + 1, 0));
        for (let j = 0; j + 1 < rings.length; j++) P.push(...at(i, j), ...at(i, j + 1), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i + 1, j));
      }
      const g = flat(P);
      const out = new THREE.Color();
      let h = 0;
      paint(g, {
        color: (v) => {
          h = clamp01(hz.fbm3(v.x * 1.15, 3.7, v.z * 1.15, 2) * 0.95 + 0.5);
          return out.copy(LAVA.ember).lerp(LAVA.hot, smooth01(0.12, 0.6, h)).lerp(LAVA.core, smooth01(0.62, 0.98, h));
        },
        emissive: () => 0.7 + 3.5 * smooth01(0.18, 0.85, h),
        rough: 0.9,
        metal: 0,
        mat: MAT.GLOW,
      });
      used += triCount(g);
      b.add(g);
    }

    // skin that crusted over again closes the cracks here and there
    const T = tops(moved);
    {
      const P = [];
      for (const ln of lines) {
        const len = Math.hypot(ln.b.x - ln.a.x, ln.b.z - ln.a.z);
        if (len < 0.5) continue;
        const ax = ln.a.x + ln.n[0] * ln.gap * 0.5,
          az = ln.a.z + ln.n[2] * ln.gap * 0.5;
        const tx = (ln.b.x - ln.a.x) / len,
          tz = (ln.b.z - ln.a.z) / len;
        const sx = -tz,
          sz = tx;
        const hw = ln.gap * 0.5 + 0.012,
          reach = ln.gap * 0.5 + 0.03;
        const lip = (u, side) => {
          const x = ax + tx * u,
            z = az + tz * u;
          const px = x + sx * reach * side,
            pz = z + sz * reach * side;
          const at = pieceAt(T, px, pz);
          if (!at.t || at.m < 0.004) return null;
          return [x + sx * hw * side, yOn(at.t, px, pz) - 0.014, z + sz * hw * side];
        };
        let u = R.range(0.1, 0.9);
        while (u < len - 0.2) {
          const l = Math.min(R.range(0.1, 0.45), len - 0.08 - u);
          const L0 = lip(u, -1),
            R0 = lip(u, 1),
            L1 = lip(u + l, -1),
            R1 = lip(u + l, 1);
          if (L0 && R0 && L1 && R1) P.push(...L0, ...R0, ...L1, ...R0, ...R1, ...L1);
          u += l + R.range(0.5, 1.6);
        }
      }
      if (P.length) {
        const g = flat(P);
        paint(g, { color: LAVA.skin.clone().lerp(LAVA.warm, 0.5), rough: 0.8, metal: 0, emissive: 0, mat: MAT.STONE });
        used += triCount(g);
        b.add(g);
      }
    }

    // ropes: festoons bowed away from where the flow came from, broken where the plate broke
    const ropes = [];
    const FC = 2.4,
      fa = R.range(0, TAU);
    const fx = Math.cos(fa) * FC,
      fz = Math.sin(fa) * FC;
    const half = Math.asin(Math.min(1, 1.75 / FC)) + 0.12;
    const foot = col('#111013'),
      crest = col('#302f36');
    let r = FC - 1.7 + R.range(0, 0.15);
    while (r < FC + 1.7) {
      const amp = R.range(0.03, 0.07),
        ph = R.range(0, TAU),
        ph2 = R.range(0, TAU),
        skip = R.chance(0.06),
        hgt = R.range(0.03, 0.048),
        wid = R.range(0.065, 0.1);
      const FINE = 0.05;
      const step = FINE / r;
      let run = [],
        cur = null;
      const flush = () => {
        // the walk is fine, so a rope starts and stops where its piece does; the rope itself is coarse
        const m = run.length;
        if (m >= 5) {
          const n = Math.max(3, Math.ceil(((m - 1) * FINE) / 0.3) + 1);
          const pts = [];
          for (let j = 0; j < n; j++) pts.push(run[Math.round((j * (m - 1)) / (n - 1))]);
          const end = (t) => Math.min(1, Math.min(t, 1 - t) * (n - 1));
          const g = ridge(
            pts,
            (t) => wid * (0.5 + 0.5 * end(t)),
            (t) => hgt * end(t),
            true
          );
          paint(g, { color: (v) => (v.i % 3 === 1 ? crest : foot), rough: (v) => (v.i % 3 === 1 ? 0.45 : 0.7), metal: 0, emissive: 0, mat: MAT.STONE });
          ropes.push(g);
        }
        run = [];
        cur = null;
      };
      if (!skip)
        for (let a = -half; a <= half + 1e-6; a += step) {
          const s = a * r;
          const rr = r + amp * Math.sin(s * 2.3 + ph) + amp * 0.4 * Math.sin(s * 6.1 + ph2);
          const ang = fa + Math.PI + a;
          const x = fx + Math.cos(ang) * rr,
            z = fz + Math.sin(ang) * rr;
          const at = pieceAt(T, x, z);
          if (!at.t || at.m < 0.08) {
            flush();
            continue;
          }
          if (cur && at.t !== cur) flush();
          cur = at.t;
          run.push(new V3(x, yOn(at.t, x, z) - 0.004, z));
        }
      flush();
      r += R.range(0.18, 0.26);
    }
    // the budget is the plate's: if the ropes would break it, some of them go, wherever they lie
    let total = ropes.reduce((s, g) => s + triCount(g), 0);
    while (ropes.length && used + total > 880) {
      const k = R.int(0, ropes.length - 1);
      total -= triCount(ropes[k]);
      ropes.splice(k, 1);
    }
    if (ropes.length) b.add(ropes);
    return b.cylCollider(0, TOP - 0.25, 0, 1.5, 0.5).build();
  },
  { kind: 'gameplay', variants: 3 }
);

// ---------------------------------------------------------------------------------------------
// salt_pillar: a column of salt grown in a breath, 1.7 m across at the foot and 2.8 m tall.
// Square shafts in storeys, grown into each other; the heads of the inner ones lie level and
// make a floor to stand on. Everything is upright, so the pillar can be drawn out taller (the
// game raises it by scaling Y from 0) and still be salt.
// ---------------------------------------------------------------------------------------------
register(
  'salt_pillar',
  (seed) => {
    const R = new Rng(seed * 7919 + 3501);
    const H = 2.8;
    const solids = [];
    /** A square shaft in storeys, each a little out of line with the one below. */
    const shaft = (x, z, yaw, w, h, { storeys = 2, lean = 0, to = 0, slant = 0 } = {}) => {
      const asp = R.range(0.86, 1.0),
        tone = R.next();
      const ys = [0];
      for (let k = 1; k < storeys; k++) ys.push(h * (k / storeys + R.range(-0.1, 0.1)));
      ys.push(h);
      for (let k = 0; k < storeys; k++) {
        const last = k === storeys - 1;
        const ww = last ? w : w * R.range(0.8, 1.08),
          dy = last ? 0 : R.range(-0.24, 0.24),
          ox = last ? 0 : R.range(-0.04, 0.04),
          oz = last ? 0 : R.range(-0.04, 0.04);
        const y0 = ys[k],
          y1 = ys[k + 1];
        let f = xfFaces(boxFaces(ww / 2, (y1 - y0) / 2, (ww * asp) / 2), { r: [0, yaw + dy, 0], t: [x + ox, (y0 + y1) / 2, z + oz] });
        // a head that did not grow level: cut on the slant, highest on the side away from `to`
        if (last && slant) {
          const cx = Math.cos(to),
            cz = Math.sin(to);
          f = clipFaces(f, cx * slant, 1, cz * slant, cx * slant * (x - cx * w * 0.5) + h + cz * slant * (z - cz * w * 0.5));
        }
        if (lean) f = clipFaces(xfFaces(f, { r: [Math.sin(to) * lean, 0, -Math.cos(to) * lean], pivot: [x, 0, z] }), 0, -1, 0, 0);
        if (solid(f)) solids.push({ f, tone });
      }
    };
    // the floor: one stout shaft with seven round it, heads a finger apart so none fights another
    const a0 = R.range(0, TAU);
    shaft(0, 0, a0, 0.84, H, { storeys: 3 });
    const nRing = 7;
    for (let i = 0; i < nRing; i++) {
      const a = a0 + (i / nRing) * TAU + R.range(-0.12, 0.12);
      const d = R.range(0.39, 0.44);
      shaft(Math.cos(a) * d, Math.sin(a) * d, R.range(0, TAU), R.range(0.5, 0.58), H - 0.012 * (i + 1), { storeys: R.int(2, 3) });
    }
    // lesser shafts that did not reach, leaning out a little: the pillar is widest at the foot
    for (let i = 0; i < 8; i++) {
      const a = a0 + ((i + 0.5) / 8) * TAU + R.range(-0.25, 0.25);
      const w = R.range(0.24, 0.38);
      const d = Math.min(R.range(0.58, 0.72), 0.86 - w * 0.71);
      shaft(Math.cos(a) * d, Math.sin(a) * d, R.range(0, TAU), w, R.range(0.7, 2.35), { storeys: R.int(1, 2), lean: R.range(0, 0.05), to: a, slant: R.range(0.25, 0.7) });
    }
    // cubes grown out of the shafts, corners first
    for (let i = 0; i < 14; i++) {
      const a = R.range(0, TAU),
        w = R.range(0.14, 0.3),
        y = R.range(0.4, 2.5),
        d = R.range(0.5, Math.min(0.72, 0.86 - w * 0.75));
      const f = xfFaces(boxFaces(w / 2), { r: [R.range(-0.22, 0.22), R.range(0, TAU), R.range(-0.22, 0.22)], t: [Math.cos(a) * d, y, Math.sin(a) * d] });
      solids.push({ f, tone: R.next() });
    }
    // and crusting the foot
    for (let i = 0; i < 16; i++) {
      const a = R.range(0, TAU),
        w = R.range(0.14, 0.32),
        d = R.range(0.55, 0.86 - w * 0.7);
      let f = xfFaces(boxFaces(w / 2), { r: [R.range(-0.5, 0.5), R.range(0, TAU), R.range(-0.5, 0.5)], t: [Math.cos(a) * d, w * R.range(0.15, 0.6), Math.sin(a) * d] });
      f = clipFaces(f, 0, -1, 0, 0);
      if (solid(f)) solids.push({ f, tone: R.next() });
    }

    const cRim = col('#f1ebe8'),
      cRose = col('#b39392'),
      cGrey = col('#a9a6aa'),
      cDirt = col('#857b78'),
      out = new THREE.Color();
    const b = new Builder();
    for (const s of solids) {
      const g = facesToGeo(s.f, { maxLvl: 0, edge: 0.05, skip: buried });
      const fW = g.userData.faceW,
        fN = g.userData.faceN;
      paint(g, {
        color: (v) => {
          // hopper faces: white along the edges, a rose or grey veil toward the heart
          const w = Math.min(1, fW[v.i] * 1.5);
          out.copy(cRim).lerp(s.tone < 0.6 ? cRose : cGrey, w * (0.45 + 0.5 * s.tone));
          out.lerp(cDirt, clamp01(1 - v.y / 0.45) * 0.55);
          return out.multiplyScalar(0.84 + 0.16 * fN[v.i * 3 + 1]);
        },
        rough: 0.26,
        metal: 0,
        emissive: 0,
        mat: MAT.CRYSTAL,
      });
      b.add(g);
    }
    return b.cylCollider(0, H / 2, 0, 0.8, H).build();
  },
  { kind: 'gameplay', variants: 1 }
);
