// Small math helpers shared across the game.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const remap = (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c);
export const remapClamped = (x, a, b, c, d) => c + saturate((x - a) / (b - a)) * (d - c);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (x) => (x < 0 ? -1 : 1);
export const fract = (x) => x - Math.floor(x);
export const mod = (x, n) => ((x % n) + n) % n;
export const sq = (x) => x * x;
export const length2 = (x, y) => Math.sqrt(x * x + y * y);
export const length3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Polynomial smooth minimum (k = blend width). */
export function smin(a, b, k) {
  const h = saturate(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * TAU) / 3) + 1;
};

/** Distance from point p to segment a-b in 2D, plus the parameter along the segment. */
export function distToSegment2(px, pz, ax, az, bx, bz, out) {
  const abx = bx - ax,
    abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = saturate(t);
  const cx = ax + abx * t,
    cz = az + abz * t;
  const d = Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));
  if (out) {
    out.t = t;
    out.x = cx;
    out.z = cz;
  }
  return d;
}

/** Integer hash -> [0,1). */
export function hash1(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
