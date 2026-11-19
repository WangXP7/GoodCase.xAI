// Small animation kit for the viewmodel: eased keyframe tracks and damped springs.
const EASE = {
  lin: (t) => t,
  io: (t) => t * t * (3 - 2 * t), // ease in and out
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  out3: (t) => 1 - (1 - t) ** 3,
  in3: (t) => t * t * t,
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }, // overshoots, then settles
  hold: () => 0,
};
export const ease = EASE;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };

// Keyframes: [[time, value, easeIntoThisKey?], ...] sorted by time. value: number or array.
// Scalar tracks return the number. Vector tracks write into `out` (required: nothing is allocated,
// so a track can be sampled every frame) and return it. Keep tables at module scope.
export function key(keys, t, out) {
  const n = keys.length;
  let a, b, k = 0;
  if (t <= keys[0][0]) a = b = keys[0];
  else if (t >= keys[n - 1][0]) a = b = keys[n - 1];
  else {
    let i = 1;
    while (keys[i][0] < t) i++;
    a = keys[i - 1]; b = keys[i];
    k = EASE[b[2] || 'io']((t - a[0]) / (b[0] - a[0]));
  }
  const va = a[1], vb = b[1];
  if (typeof va === 'number') return va + (vb - va) * k;
  for (let j = 0; j < va.length; j++) out[j] = va[j] + (vb[j] - va[j]) * k;
  return out;
}

// Second-order spring toward zero with an impulse input: x'' = -w^2 x - 2 z w x'.
export class Spring {
  constructor(freq, damping) { this.w = freq * Math.PI * 2; this.z = damping; this.x = 0; this.v = 0; }
  kick(v) { this.v += v; }
  step(dt) {
    // semi-implicit, sub-stepped: stable at any frame time
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.w * this.w * this.x - 2 * this.z * this.w * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}
