// Quicksilver: a broken lump of dark ore seamed with cinnabar, sweating beads of native mercury
// that gather into a mirror pool in a hollow. opts.picked = true -> the hollow drained.
import { Builder, Rng, Noise, MAT, paint, rock, lathe, sphere, xf, deform, flat, mixc, col, ao } from '../kit.js';
import { register } from '../registry.js';
import { surfacePoints, prismCrystal, paintCore, aim } from './_shared.js';

const sm = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

register(
  'quicksilver',
  (seed, opts = {}) => {
    const R = new Rng(seed * 4447 + 3);
    const nz = new Noise(seed * 17 + 5);
    const b = new Builder();
    const picked = !!opts.picked;

    const r = R.range(0.19, 0.23);
    const sq = [R.range(1.0, 1.18), R.range(0.78, 0.92), R.range(0.86, 1.0)];
    let ore = rock(r, { seed: seed * 3 + 2, detail: 6, rough: 0.27, freq: 1.3, squash: sq, sink: 0.42 });
    const lift = r * sq[1] * 0.5;

    // a hollow in the crown where the metal collects
    const pr = r * R.range(0.3, 0.35);
    const pa = R.range(0, 6.28),
      pd = r * R.range(0.0, 0.1);
    const px = Math.cos(pa) * pd,
      pz = Math.sin(pa) * pd;
    let sum = 0,
      cnt = 0;
    deform(
      ore,
      (p) => {
        if (p.y > 0 && Math.hypot(p.x - px, p.z - pz) < pr * 1.4) {
          sum += p.y;
          cnt++;
        }
      },
      false
    );
    const cap = sum / Math.max(1, cnt);
    const depth = pr * 0.6;
    deform(ore, (p) => {
      if (p.y <= 0) return;
      const d = Math.hypot(p.x - px, p.z - pz) / pr;
      if (d > 2.1) return;
      p.y += (cap - p.y) * (1 - sm(1.0, 2.1, d)) * 0.85; // level the crown
      p.y -= depth * (1 - sm(0.5, 1.05, d)); // scoop the bowl
    });
    const poolY = cap - depth * 0.45;

    // colour is laid on the smooth lump, then it is broken into facets: hard planes, soft seams
    const host = col('#1b1b1f'),
      hostPale = col('#37373d'),
      cinn = col('#7a1d13'),
      cinnDark = col('#3a0e0b');
    const veinAt = (x, y, z) => {
      const s = nz.fbm3(x * 4.2 + 9, y * 4.2, z * 4.2 - 4, 3);
      let v = Math.max(0, 1 - Math.abs(s) / 0.05);
      const s2 = nz.fbm3(x * 7 - 2, y * 7, z * 7 + 6, 2);
      v = Math.max(v, Math.max(0, 1 - Math.abs(s2 - 0.3) / 0.045) * 0.8);
      const d = Math.hypot(x - px, z - pz) / pr;
      if (y > 0 && d < 1.2) v = Math.max(v, (1 - d / 1.2) * 1.4);
      return Math.min(1, v);
    };
    paint(ore, {
      color: (v) => {
        const base = mixc(host, hostPale, 0.5 + 0.5 * nz.fbm3(v.x * 8, v.y * 8, v.z * 8, 3));
        return base.lerp(mixc(cinnDark, cinn, 0.5 + 0.5 * nz.n3(v.x * 27, v.y * 27, v.z * 27)), veinAt(v.x, v.y, v.z));
      },
      rough: (v) => 0.93 - 0.3 * veinAt(v.x, v.y, v.z),
      mat: MAT.STONE,
    });
    ore = flat(ore);
    xf(ore, { t: [0, lift, 0] });
    b.add(ore);

    // cinnabar proper: knots of small blood-red crystals where the seams break the surface
    const spots = surfacePoints(ore, R, 60, 0.15)
      .filter((s) => veinAt(s.p[0], s.p[1] - lift, s.p[2]) > 0.55 && Math.hypot(s.p[0] - px, s.p[2] - pz) > pr * 0.9)
      .slice(0, picked ? 2 : 3);
    for (const s of spots) {
      for (let i = 0, n = R.int(3, 4); i < n; i++) {
        const c = R.range(0.008, 0.017);
        const g = prismCrystal(
          [
            [c * 0.3, -c * 0.4],
            [c, 0.1 * c],
            [c * 0.2, c * 1.0],
          ],
          4,
          { rng: R, irregular: 0.2 }
        );
        paintCore(g, { color: '#3d0d0a', emissive: 0.0, rough: 0.3 }, { color: '#9c2416', emissive: 0.06, rough: 0.16 }, { mat: MAT.CRYSTAL });
        const dir = [s.n[0] + R.range(-0.7, 0.7), s.n[1] + R.range(-0.2, 0.7), s.n[2] + R.range(-0.7, 0.7)];
        b.add(aim(g, dir, [s.p[0] + R.range(-0.014, 0.014), s.p[1] + R.range(-0.004, 0.006), s.p[2] + R.range(-0.014, 0.014)], R.range(0, 6.28)));
      }
    }

    const metal = { color: '#c9d2de', rough: 0.035, metal: 1, emissive: 0.07, mat: MAT.PLAIN };
    // the fat drops get looked at from a hand's breadth away, so they are round; the smallest are a glint
    const bead = (x, y, z, br, squash = 0.78) => {
      const g = br >= 0.0095 ? sphere(br, 8, 4) : br >= 0.005 ? sphere(br, 7, 3) : sphere(br, 5, 2);
      g.scale(1, squash, 1);
      paint(g, metal);
      xf(g, { t: [x, y, z] });
      b.add(g);
    };

    if (!picked) {
      // the pool: mercury does not wet stone, so its edge is a rounded bead, not a film
      const rr = pr * 0.84,
        hh = pr * 0.11;
      const pool = lathe(
        [
          [rr * 0.94, -hh * 1.6],
          [rr, -hh * 0.3],
          [rr * 0.97, hh * 0.35],
          [rr * 0.82, hh * 0.8],
          [rr * 0.45, hh],
          [0, hh],
        ],
        16
      );
      paint(pool, metal);
      xf(pool, { t: [px, poolY + lift, pz] });
      b.add(pool);
    } else {
      // a last bead or two in the bottom of the hollow
      for (let i = 0; i < 2; i++) bead(px + R.range(-0.25, 0.25) * pr, cap - depth + lift + 0.008, pz + R.range(-0.25, 0.25) * pr, R.range(0.006, 0.011), 0.7);
    }

    // beads sweating out of the seams: a string of small ones along the cinnabar, fat drops where they
    // have run together on a ledge. Each sits in the middle of a facet, clear of the others.
    const facets = [];
    for (let i = 0, P = ore.attributes.position, Q = ore.attributes.normal; i < P.count; i += 3) {
      const c = [(P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3, (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3];
      if (c[1] < 0.012 || Math.hypot(c[0] - px, c[2] - pz) < pr * 1.2) continue;
      facets.push({ p: c, n: [Q.getX(i), Q.getY(i), Q.getZ(i)] });
    }
    for (let i = facets.length - 1; i > 0; i--) {
      const j = R.int(0, i);
      [facets[i], facets[j]] = [facets[j], facets[i]];
    }
    const placed = [];
    const sweat = (pass, count, r0, r1, squash) => {
      let k = 0;
      for (const s of facets) {
        if (k >= count) break;
        if (!pass(s)) continue;
        const br = R.range(r0, r1);
        const c = [s.p[0] + s.n[0] * br * 0.45, s.p[1] + s.n[1] * br * 0.45, s.p[2] + s.n[2] * br * 0.45];
        if (placed.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < (br + q[3]) * 1.15)) continue;
        placed.push([c[0], c[1], c[2], br]);
        bead(c[0], c[1], c[2], br, squash);
        k++;
      }
    };
    const seam = (s) => veinAt(s.p[0], s.p[1] - lift, s.p[2]);
    sweat((s) => s.n[1] > -0.25 && seam(s) > 0.3, picked ? 3 : 7, 0.003, 0.0048, 0.95);
    sweat((s) => s.n[1] > 0.25, picked ? 2 : 4, 0.0052, 0.009, 0.86);
    if (!picked) sweat((s) => s.n[1] > 0.55, 3, 0.0105, 0.0145, 0.72);
    // a few that reached the ground
    if (!picked) {
      for (let i = 0, n = R.int(2, 3); i < n; i++) {
        const a = R.range(0, 6.28),
          d = r * R.range(1.08, 1.3);
        const br = i ? R.range(0.006, 0.009) : R.range(0.008, 0.012); // one fat drop at most
        bead(Math.cos(a) * d * sq[0], br * 0.6, Math.sin(a) * d * sq[2], br, 0.7);
      }
    }

    b.anchor('top', px, poolY + lift + 0.03, pz);
    const m = b.build();
    ao(m.opaque, { height: 0.09, strength: 0.35, under: 0.2 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
