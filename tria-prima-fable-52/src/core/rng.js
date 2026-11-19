// Deterministic random number generator (mulberry32).
export class Rng {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  /** Uniform in [0, 1). */
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a, b) {
    return a + (b - a) * this.next();
  }
  /** Integer in [a, b] inclusive. */
  int(a, b) {
    return Math.floor(a + (b - a + 1) * this.next());
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  chance(p) {
    return this.next() < p;
  }
  /** Approximately normal, mean 0, sd 1. */
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
  /** Child generator that does not disturb this one's sequence much. */
  fork(salt = 0) {
    return new Rng((Math.imul(this.s ^ 0x9e3779b9, 2654435761) + salt * 7919) >>> 0);
  }
}

export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
