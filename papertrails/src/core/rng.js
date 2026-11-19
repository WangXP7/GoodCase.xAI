// Seeded randomness. NEVER use Math.random() in simulation/world code (captures must be deterministic).

/** mulberry32 PRNG. Returns a function () => float in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of a 2D integer coordinate + seed -> uint32. Order independent, stateless. */
export function hash2(x, y, seed = 0) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = (h << 13) | (h >>> 19);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash2 mapped to a float in [0,1). */
export function hash2f(x, y, seed = 0) {
  return hash2(x, y, seed) / 4294967296;
}

/** A fresh PRNG stream for a cell: rngAt(x,y,seed)() -> float. */
export function rngAt(x, y, seed = 0) {
  return mulberry32(hash2(x, y, seed));
}

/** Helpers taking an rng function. */
export const rand = {
  range: (rng, a, b) => a + (b - a) * rng(),
  int: (rng, a, b) => a + Math.floor(rng() * (b - a + 1)),
  pick: (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length],
  sign: (rng) => (rng() < 0.5 ? -1 : 1),
  /** weighted pick: items[i] chosen with probability weights[i]/sum. */
  weighted(rng, items, weights) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += weights[i];
    let r = rng() * sum;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  },
};
