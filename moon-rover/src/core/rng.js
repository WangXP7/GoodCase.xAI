/* ============================================================
   Deterministic value noise + seeded PRNG.

   Everything the terrain is made of is baked from THESE functions on the
   CPU into Float32 textures, so the GPU never re-derives a height — it
   samples exactly what the physics samples. No shader/JS drift, ever.
   ============================================================ */

/* ---- mulberry32: tiny, fast, reproducible ---- */
export function makeRNG(seed = 0x5eed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- integer hash -> [0,1). Exact in double precision, no fract(sin()) chaos ---- */
export function hash2i(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---- 2D value noise, quintic smoothstep (C2 continuous -> clean normals) ---- */
export function vnoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2i(ix, iy, seed);
  const b = hash2i(ix + 1, iy, seed);
  const c = hash2i(ix, iy + 1, seed);
  const d = hash2i(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/* rotated octaves — decorrelates the lattice so no diagonal weave shows up */
const R = [
  [0.8090, -0.5878, 0.5878, 0.8090],
  [0.3090, 0.9511, -0.9511, 0.3090],
  [-0.5878, 0.8090, -0.8090, -0.5878],
  [0.9511, 0.3090, -0.3090, 0.9511],
  [-0.8090, -0.5878, 0.5878, -0.8090]
];

export function fbm(x, y, octaves = 4, lac = 2.07, gain = 0.5, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const m = R[o % R.length];
    const rx = x * m[0] + y * m[1], ry = x * m[2] + y * m[3];
    sum += vnoise(rx * freq + o * 17.3, ry * freq + o * 9.1, seed + o * 131) * amp;
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;                       // 0..1
}

/* ridged multifractal — sharp crests, good for mountain rims */
export function ridged(x, y, octaves = 4, lac = 2.11, gain = 0.5, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const m = R[o % R.length];
    const rx = x * m[0] + y * m[1], ry = x * m[2] + y * m[3];
    const n = vnoise(rx * freq + o * 5.7, ry * freq + o * 12.4, seed + o * 977);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += r * r * amp;
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;                       // 0..1
}

/* smoothstep / helpers */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const dmod = (a, n) => a - Math.floor(a / n) * n;
