// Seeded RNG (mulberry32). The only file allowed to touch Math.random-style entropy.
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed = 1) {
  let a = (seed | 0) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive both ends
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Independent stream derived from the original seed + label; does not consume this stream.
    fork: (label) => createRng((((seed | 0) >>> 0) ^ hashString(String(label))) >>> 0),
  };
}
