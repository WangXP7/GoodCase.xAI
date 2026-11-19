// Seeded gradient noise (2D / 3D), fbm, ridged and domain warp helpers. CPU side only;
// shaders use generated noise textures instead.
import { Rng } from './rng.js';

export class Noise {
  constructor(seed = 1337) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 2D gradient noise in roughly [-1, 1]. */
  n2(x, y) {
    const perm = this.perm;
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const X = xi & 255,
      Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = perm[perm[X] + Y],
      ab = perm[perm[X] + Y + 1],
      ba = perm[perm[X + 1] + Y],
      bb = perm[perm[X + 1] + Y + 1];
    const g = (h, dx, dy) => {
      switch (h & 7) {
        case 0:
          return dx + dy;
        case 1:
          return dx - dy;
        case 2:
          return -dx + dy;
        case 3:
          return -dx - dy;
        case 4:
          return dx * 1.4142;
        case 5:
          return -dx * 1.4142;
        case 6:
          return dy * 1.4142;
        default:
          return -dy * 1.4142;
      }
    };
    const x1 = g(aa, xf, yf) + (g(ba, xf - 1, yf) - g(aa, xf, yf)) * u;
    const x2 = g(ab, xf, yf - 1) + (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1)) * u;
    return (x1 + (x2 - x1) * v) * 0.7071;
  }

  /** 3D gradient noise in roughly [-1, 1]. */
  n3(x, y, z) {
    const perm = this.perm;
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = x - xi,
      yf = y - yi,
      zf = z - zi;
    const X = xi & 255,
      Y = yi & 255,
      Z = zi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const A = perm[X] + Y,
      AA = perm[A] + Z,
      AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y,
      BA = perm[B] + Z,
      BB = perm[B + 1] + Z;
    const g = (h, dx, dy, dz) => {
      h &= 15;
      const a = h < 8 ? dx : dy;
      const b = h < 4 ? dy : h === 12 || h === 14 ? dx : dz;
      return ((h & 1) === 0 ? a : -a) + ((h & 2) === 0 ? b : -b);
    };
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(g(perm[AA], xf, yf, zf), g(perm[BA], xf - 1, yf, zf), u), l(g(perm[AB], xf, yf - 1, zf), g(perm[BB], xf - 1, yf - 1, zf), u), v),
      l(
        l(g(perm[AA + 1], xf, yf, zf - 1), g(perm[BA + 1], xf - 1, yf, zf - 1), u),
        l(g(perm[AB + 1], xf, yf - 1, zf - 1), g(perm[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v
      ),
      w
    );
  }

  /** Fractal sum, output roughly [-1, 1]. */
  fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n2(x * f + i * 17.13, y * f - i * 9.71);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }
  fbm3(x, y, z, oct = 4, lac = 2.0, gain = 0.5) {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n3(x * f + i * 17.13, y * f - i * 9.71, z * f + i * 3.37);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }
  /** Ridged multifractal in [0, 1]: sharp crests, good for mountains. */
  ridged2(x, y, oct = 5, lac = 2.05, gain = 0.5) {
    let a = 0.5,
      f = 1,
      s = 0,
      prev = 1,
      n = 0;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.n2(x * f + i * 31.7, y * f + i * 11.3));
      v *= v;
      s += v * a * prev;
      n += a;
      prev = v;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }
  /** Billowy in [0, 1]. */
  billow2(x, y, oct = 4) {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * Math.abs(this.n2(x * f + i * 5.3, y * f + i * 7.9));
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}
