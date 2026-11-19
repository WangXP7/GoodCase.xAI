// Brimstone: a fumarole. A ragged spatter chimney of dark scoria with a hot throat, crusted with
// native sulfur: needles grown from the vapour around the vent, blocky crystals lower down.
// opts.picked = true -> the needles and crystals struck off, the crust left.
import { Builder, Rng, Noise, MAT, lathe, rock, crystal, xf, deform, flat, paint, mixc, col, ao } from '../kit.js';
import { register } from '../registry.js';
import { aim, lean, paintFlat, prismCrystal, paintCore } from './_shared.js';

register(
  'brimstone',
  (seed, opts = {}) => {
    const R = new Rng(seed * 3571 + 9);
    const nz = new Noise(seed * 13 + 3);
    const b = new Builder();
    const picked = !!opts.picked;

    const H = R.range(0.15, 0.2); // rim height
    const W = R.range(0.17, 0.2); // foot radius
    const rv = R.range(0.036, 0.045); // rim radius
    const P = [
      [1.0, -0.04],
      [0.97, 0.0],
      [0.86, 0.07],
      [0.7, 0.2],
      [0.55, 0.36],
      [0.42, 0.55],
      [0.31, 0.74],
      [(rv * 1.45) / W, 0.9],
      [(rv * 1.12) / W, 0.985],
    ];
    let chim = lathe(
      [
        ...P.map(([r, y]) => [r * W, y * H]),
        [rv, H, 'hard'],
        [rv * 0.78, H * 0.93],
        [rv * 0.62, H * 0.7],
        [rv * 0.5, H * 0.4],
        [rv * 0.4, H * 0.12],
      ],
      18
    );
    const ox = R.range(-0.025, 0.025),
      oz = R.range(-0.025, 0.025);
    const ph = R.range(0, 6.28);
    const lobes = (a) => 1 + 0.15 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 5 + ph * 2.3) + 0.05 * Math.sin(a * 9 + ph * 0.7);
    const notch = (a) => (0.5 + 0.5 * Math.sin(a * 2 + ph * 1.7)) * 0.04 + (0.5 + 0.5 * Math.sin(a * 5 + ph)) * 0.015;
    deform(chim, (p) => {
      const a = Math.atan2(p.z, p.x);
      const rr = Math.hypot(p.x, p.z);
      const t = Math.max(0, Math.min(1, p.y / H));
      const outer = rr > rv * 1.05 ? 1 : 0;
      // slumped lobes at the foot, a notched and leaning rim, clinker everywhere
      const k = 1 + outer * (lobes(a) - 1) * (1 - t * 0.75) + nz.n3(p.x * 16, p.y * 16, p.z * 16) * 0.09 * (outer ? 1 : 0.4);
      p.x *= k;
      p.z *= k;
      if (t > 0.6) p.y -= notch(a) * ((t - 0.6) / 0.4);
      p.x += ox * t;
      p.z += oz * t;
      if (outer) p.y += nz.fbm3(p.x * 11, p.y * 11, p.z * 11, 3) * 0.03 * (1 - t * 0.6);
    });
    chim = flat(chim);
    const basalt = col('#161518'),
      scoria = col('#2b2420'),
      yel = col('#c29c1f'),
      yelPale = col('#d8c355'),
      yelGreen = col('#a8a03a'),
      orange = col('#b4520f'),
      hot = col('#ff5a14');
    const inThroat = (x, y, z) => Math.hypot(x - ox * (y / H), z - oz * (y / H)) < rv * 0.86 && y < H * 0.93;
    paintFlat(
      chim,
      (x, y, z) => {
        const t = Math.max(0, Math.min(1, y / H));
        const n = 0.5 + 0.5 * nz.fbm3(x * 15, y * 15, z * 15, 3);
        if (inThroat(x, y, z)) {
          const g = Math.pow(Math.max(0, 1 - Math.max(0, (y - H * 0.12) / (H * 0.8))), 2.4);
          return { color: mixc('#0a0706', hot, g * 0.9), emissive: 2.0 * g, rough: 0.9, mat: MAT.STONE };
        }
        // sulfur settles in patches that thicken toward the vent
        const patch = 0.5 + 0.5 * nz.n3(x * 9 + 4, y * 9, z * 9 - 2);
        const crust = Math.pow(t, 0.9) * 1.25 + patch * 0.75 - 0.95;
        if (crust <= 0) return { color: mixc(basalt, scoria, n), rough: 0.96, emissive: 0, mat: MAT.STONE };
        let c = n < 0.45 ? mixc(yelGreen, yel, n / 0.45) : mixc(yel, yelPale, (n - 0.45) / 0.55);
        if (t > 0.78) c = c.lerp(orange, Math.min(1, (t - 0.78) / 0.2) * (0.5 + 0.5 * n));
        if (crust < 0.12) c = mixc(scoria, c, 0.45); // a thin stain at the edge of a patch
        return { color: c, rough: 0.6, emissive: 0.03, mat: MAT.CRYSTAL };
      },
      { metal: 0 }
    );
    b.add(chim);

    const slopeAt = (t) => {
      for (let i = 0; i < P.length - 1; i++) if (t <= P[i + 1][1]) return W * (P[i][0] + ((P[i + 1][0] - P[i][0]) * (t - P[i][1])) / (P[i + 1][1] - P[i][1]));
      return rv;
    };
    const onSlope = (a, t, push = 1) => {
      const rr = slopeAt(t) * (1 + (lobes(a) - 1) * (1 - t * 0.75)) * push;
      return [ox * t + Math.cos(a) * rr, H * t - (t > 0.6 ? notch(a) * ((t - 0.6) / 0.4) : 0), oz * t + Math.sin(a) * rr];
    };

    // needles: grown from the hot vapour in a ragged crown round the vent, tufts in the lee
    const needle = (pos, dir, len, rad, k) => {
      const g = crystal(rad, len, { sides: 4, tip: R.range(0.3, 0.5), foot: 0.7, irregular: 0.2, rng: R });
      paint(g, {
        color: (v) => mixc(orange, mixc(yel, yelPale, k), Math.min(1, v.y / (len * 0.4))),
        emissive: (v) => 0.04 + 0.1 * (1 - Math.min(1, v.y / len)),
        rough: 0.28,
        mat: MAT.CRYSTAL,
      });
      b.add(aim(g, dir, pos, R.range(0, 6.28)));
    };
    if (!picked) {
      for (let i = 0, n = R.int(20, 25); i < n; i++) {
        const a = (i / n) * 6.28 + R.range(-0.2, 0.2);
        const p = onSlope(a, R.range(0.93, 1.0), R.range(0.95, 1.3));
        const len = R.range(0.03, 0.085) * (R.chance(0.18) ? 1.5 : 1);
        needle(p, lean(R.range(0.2, 1.0), Math.PI / 2 - a + R.range(-0.5, 0.5)), len, len * R.range(0.055, 0.085), R.next());
      }
      for (let c = 0, nc = R.int(3, 4); c < nc; c++) {
        const a = R.range(0, 6.28),
          t = R.range(0.35, 0.8);
        const base = onSlope(a, t, 0.98);
        for (let i = 0, n = R.int(5, 8); i < n; i++) {
          const len = R.range(0.02, 0.055);
          needle([base[0] + R.range(-0.018, 0.018), base[1] + R.range(-0.012, 0.012), base[2] + R.range(-0.018, 0.018)], lean(R.range(0.3, 1.2), Math.PI / 2 - a + R.range(-1, 1)), len, len * R.range(0.07, 0.1), R.next());
        }
      }
    } else {
      for (let i = 0, n = R.int(10, 13); i < n; i++) {
        const a = (i / n) * 6.28 + R.range(-0.3, 0.3);
        const len = R.range(0.006, 0.016);
        const g = crystal(len * 0.45, len, { sides: 4, tip: 0.05, foot: 0.9, irregular: 0.2, rng: R });
        paint(g, { color: mixc(orange, yel, 0.6), emissive: 0.03, rough: 0.55, mat: MAT.CRYSTAL });
        b.add(aim(g, lean(R.range(0.2, 0.9), Math.PI / 2 - a), onSlope(a, R.range(0.94, 1.0), R.range(0.95, 1.25))));
      }
    }

    // blocky crystals: sulfur's own shape is a steep double pyramid
    for (let c = 0, nc = picked ? 1 : R.int(3, 4); c < nc; c++) {
      const a = R.range(0, 6.28),
        t = R.range(0.2, 0.7);
      const base = onSlope(a, t, 0.96);
      for (let i = 0, n = picked ? 2 : R.int(2, 4); i < n; i++) {
        const s = R.range(0.014, 0.03) * (picked ? 0.6 : 1);
        const g = prismCrystal(
          [
            [s * 0.25, -s * 1.15],
            [s, 0],
            [s * 0.25, s * 1.15],
          ],
          4,
          { xz: [1, 0.8] }
        );
        const k = R.next();
        paintCore(g, { color: mixc(yel, yelPale, 0.6 + 0.4 * k), emissive: 0.02, rough: 0.3 }, { color: mixc(orange, yel, 0.45 + 0.4 * k), emissive: 0.1, rough: 0.2 }, { mat: MAT.CRYSTAL });
        xf(g, { r: [R.range(-1.2, 1.2), R.range(0, 6.28), R.range(-1.2, 1.2)], t: [base[0] + R.range(-0.025, 0.025), base[1] + s * 0.5 + R.range(-0.01, 0.01), base[2] + R.range(-0.025, 0.025)] });
        b.add(g);
      }
    }

    // clinker thrown out round the foot
    for (let i = 0, n = R.int(5, 7); i < n; i++) {
      const a = R.range(0, 6.28),
        d = W * R.range(0.9, 1.2) * lobes(a);
      const s = R.range(0.015, 0.04);
      const g = rock(s, { seed: seed * 5 + i + 40, detail: 1, rough: 0.34, squash: [1, 0.7, 1], facet: true });
      const stained = R.chance(0.4);
      paintFlat(g, (x, y, z, nx, ny) => ({ color: stained && ny > 0.5 && R.chance(0.6) ? mixc(scoria, yelGreen, R.range(0.3, 0.6)) : mixc(basalt, scoria, R.next()), rough: 0.95 }), { mat: MAT.STONE });
      xf(g, { r: [0, R.range(0, 6.28), 0], t: [Math.cos(a) * d, s * 0.3, Math.sin(a) * d] });
      b.add(g);
    }

    const top = onSlope(0, 1, 0);
    b.emitter('smoke', top[0], H + 0.01, top[2], { color: '#b9b08a', size: 0.5, rate: 0.6 });
    b.emitter('fire', top[0], H * 0.95, top[2], { color: '#4f7cff', size: 0.35 });
    b.light(top[0], H + 0.08, top[2], '#5f86ff', 0.5, 2.5);
    b.anchor('top', top[0], H + (picked ? 0.03 : 0.07), top[2]);
    const m = b.build();
    ao(m.opaque, { height: 0.06, strength: 0.3, under: 0.15 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
