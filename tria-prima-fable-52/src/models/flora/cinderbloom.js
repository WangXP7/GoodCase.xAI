// Cinderbloom: the reference model for the kit and for the game's tone.
// A flower of charred petals that never finished burning. Dark silhouette, ember only at the throat.
// opts.picked = true -> the plucked stalk (no head) that stays in the world while it regrows.
import { Builder, Rng, MAT, paint, leaf, tube, cone, rock, sphere, dome, ring, xf, gradY, mixc, col, ao, TAU } from '../kit.js';
import { register } from '../registry.js';

register(
  'cinderbloom',
  (seed, opts = {}) => {
    const R = new Rng(seed * 7919 + 13);
    const b = new Builder();
    const H = R.range(0.46, 0.62);
    const lx = R.range(-0.09, 0.09),
      lz = R.range(-0.09, 0.09);
    const top = [lx * 1.3, H, lz * 1.3];
    const p1 = [lx * 0.1 + R.range(-0.03, 0.03), H * 0.33, lz * 0.1 + R.range(-0.03, 0.03)];
    const p2 = [lx * 0.9 + R.range(-0.03, 0.03), H * 0.7, lz * 0.8 + R.range(-0.03, 0.03)];

    // scorched earth it grows from
    const ash = dome(R.range(0.07, 0.1), 9, 3, 0.22);
    paint(ash, { color: gradY('#0b0a09', '#1a1512', 0, 0.02), rough: 1, mat: MAT.STONE });
    b.add(ash);

    // crooked, charred stem
    const stemPts = [[0, 0, 0], p1, p2, top];
    const stem = tube(stemPts, (t) => 0.015 - 0.0075 * t, 6, { samples: 12 });
    paint(stem, { color: gradY('#0f0c0a', '#2b1a12', 0, H), rough: 0.92, mat: MAT.WOOD, sway: (v) => Math.pow(Math.max(0, v.y) / H, 2) * 0.5 });
    b.add(stem);

    // thorns
    const at = (t) => {
      // piecewise-linear point on the stem
      const s = t * 3,
        i = Math.min(2, Math.floor(s)),
        f = s - i;
      const a = stemPts[i],
        c = stemPts[i + 1];
      return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    };
    for (let i = 0, n = R.int(6, 9); i < n; i++) {
      const t = R.range(0.12, 0.9);
      const g = cone(0.0055, R.range(0.022, 0.036), 4);
      g.translate(0, 0.014, 0);
      paint(g, { color: '#0c0908', rough: 0.8, mat: MAT.WOOD, sway: t * t * 0.5 });
      xf(g, { r: [R.range(1.0, 1.5), 0, 0] });
      xf(g, { r: [0, R.range(0, TAU), 0], t: at(t) });
      b.add(g);
    }

    // withered leaves, curled dry and hanging
    for (let i = 0, n = R.int(2, 3); i < n; i++) {
      const t = 0.2 + (i / n) * 0.4 + R.range(-0.04, 0.04);
      const len = R.range(0.15, 0.22);
      const g = leaf(len, len * 0.3, { segs: 6, curl: R.range(1.4, 2.2), fold: 0.7, belly: 0.4, point: 1.8, wave: 0.14 });
      paint(g, { color: gradY('#171410', '#4b3a22', 0, len), rough: 0.9, mat: MAT.PLANT, sway: 0.25 + t * 0.4 });
      xf(g, { r: [R.range(1.2, 1.8), 0, 0] });
      xf(g, { r: [0, R.range(0, TAU), 0], t: at(t) });
      b.add(g);
    }

    if (!opts.picked) {
      const hot = col('#ff8a2a'),
        red = col('#8a1806'),
        char = col('#0e0b0a');
      const burnt = (len, glow) => ({
        color: (v) => {
          const t = Math.min(1, Math.max(0, v.y / len));
          return t < 0.3 ? mixc(hot, red, t / 0.3) : mixc(red, char, Math.min(1, (t - 0.3) / 0.35));
        },
        // the fire lives in the throat and along the midrib, the tips are dead charcoal
        emissive: (v) => {
          const t = Math.min(1, Math.max(0, v.y / len));
          const vein = Math.exp(-Math.pow(v.x / (len * 0.07), 2));
          return glow * Math.pow(1 - t, 2.6) * (0.35 + 0.65 * vein) + 0.02;
        },
        rough: 0.85,
        mat: MAT.PLANT,
        sway: 0.5,
      });

      // charred sepals
      b.add(
        ring(
          () => {
            const g = leaf(0.06, 0.022, { segs: 3, curl: -0.6, fold: 0.5, point: 2 });
            return paint(g, { color: '#120e0b', rough: 0.9, mat: MAT.PLANT, sway: 0.5 });
          },
          5,
          { tilt: 1.2, radius: 0.006 }
        ).map((g) => xf(g, { t: [top[0], top[1] - 0.012, top[2]] }))
      );

      // outer petals: ragged, sharp, some broken short
      b.add(
        ring(
          () => {
            const len = R.range(0.13, 0.19) * (R.chance(0.22) ? 0.55 : 1);
            const g = leaf(len, len * 0.42, { segs: 7, curl: -R.range(0.5, 1.5), fold: -0.3, belly: 0.42, point: 2.3, wave: 0.14, waveFreq: 4 });
            return paint(g, burnt(len, 2.4));
          },
          R.int(6, 8),
          { tilt: R.range(0.45, 0.7), radius: 0.012, rng: R, jitter: 0.2 }
        ).map((g) => xf(g, { t: top }))
      );

      // inner petals: a tight, hotter cup around the coal
      b.add(
        ring(
          () => {
            const len = R.range(0.085, 0.115);
            const g = leaf(len, len * 0.46, { segs: 5, curl: R.range(0.2, 0.5), fold: -0.5, belly: 0.5, point: 2.0 });
            return paint(g, burnt(len, 3.2));
          },
          5,
          { tilt: 0.4, radius: 0.008, yaw0: 0.5, rng: R, jitter: 0.15 }
        ).map((g) => xf(g, { t: top }))
      );

      // the coal
      const coal = rock(0.024, { seed: seed + 3, detail: 1, rough: 0.3, squash: [1, 0.9, 1], facet: true });
      paint(coal, { color: '#ff6a1c', emissive: 3.2, rough: 0.6, mat: MAT.GLOW, sway: 0.5 });
      xf(coal, { t: [top[0], top[1] + 0.02, top[2]] });
      b.add(coal);

      // a few sparks caught above it
      for (let i = 0; i < 3; i++) {
        const s = sphere(R.range(0.003, 0.006), 5, 4);
        paint(s, { color: '#ffb060', emissive: 4.0, mat: MAT.GLOW, sway: 0.6 });
        xf(s, { t: [top[0] + R.range(-0.04, 0.04), top[1] + R.range(0.06, 0.16), top[2] + R.range(-0.04, 0.04)] });
        b.add(s);
      }
      b.emitter('spark', top[0], top[1] + 0.05, top[2], { color: '#ff8a3a', rate: 1.5 });
      b.light(top[0], top[1] + 0.05, top[2], '#ff6a22', 0.7, 2.5);
    }
    b.anchor('top', top[0], top[1] + 0.03, top[2]);
    const m = b.build();
    ao(m.opaque, { height: 0.1, strength: 0.35 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
