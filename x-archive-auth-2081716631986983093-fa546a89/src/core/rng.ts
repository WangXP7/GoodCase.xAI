/**
 * Deterministic pseudo-random utilities.
 *
 * Everything procedural — geometry, greebles, textures, asteroid fields, map
 * layout — must draw from a seeded `Rng` so a given seed always reproduces the
 * same universe. Never call `Math.random()` in generation code.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    // Avoid the degenerate 0 state.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform [0, 1). */
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Approximately gaussian, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.4142;
  }

  /** Signed [-1, 1). */
  sign(): number {
    return this.next() * 2 - 1;
  }

  /** Unit vector on the sphere, written into `out`. */
  onSphere(out: { x: number; y: number; z: number }): void {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.x = r * Math.cos(a);
    out.y = r * Math.sin(a);
    out.z = z;
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Fork an independent stream — use for per-object sub-generation. */
  fork(salt = 0): Rng {
    return new Rng((this.int(0, 0x7fffffff) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}

/** Hash a string to a 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 3D value noise hash, returns [0,1). Cheap, for CPU-side jitter. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
