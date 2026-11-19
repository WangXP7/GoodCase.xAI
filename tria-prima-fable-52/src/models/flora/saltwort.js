// Saltwort: a glasswort from an unkind shore. Swollen, jointed stems in opposite pairs, wine-dark
// where they are old, crusted with their own salt at the joints, each tip ending in a crystal.
// opts.picked = true -> cut back to two joints, with the first new shoots at the foot.
import { Builder, Rng, MAT, TAU, paint, lathe, crystal, xf, mixc, col, ao } from '../kit.js';
import { register } from '../registry.js';
import { aim, lean, spike, gemBox, paintCore, groundPatch } from './_shared.js';

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

register(
  'saltwort',
  (seed, opts = {}) => {
    const R = new Rng(seed * 2909 + 17);
    const b = new Builder();
    const picked = !!opts.picked;
    const H = R.range(0.34, 0.47);
    // wind: nothing at the foot, the tips travel a few centimetres
    const swayAt = (y) => Math.pow(cl(y / H), 2) * 0.5;

    // a crust of salt and grit round the foot
    const mr = R.range(0.085, 0.11);
    const mh = mr * 0.2;
    const mound = groundPatch(mr, mh, seed, { sides: 9 });
    paint(mound, {
      color: (v) => mixc('#221f1d', '#9a938a', cl(v.y / mh) * (0.75 + 0.25 * Math.sin(v.x * 90 + v.z * 70))),
      rough: 1,
      mat: MAT.STONE,
    });
    b.add(mound);
    for (let i = 0, n = R.int(3, 5); i < n; i++) {
      const s = R.range(0.007, 0.016);
      const g = gemBox(s, s, s, 0);
      paintCore(g, { color: '#e9e2dc', rough: 0.4 }, { color: '#cdbfba', emissive: 0.04, rough: 0.2 }, { mat: MAT.CRYSTAL });
      const a = R.range(0, TAU),
        d = R.range(0.03, mr * 0.8);
      xf(g, { r: [R.range(-0.4, 0.4), R.range(0, TAU), R.range(-0.4, 0.4)], t: [Math.cos(a) * d, mh * (1 - d / mr) * 0.8 + s * 0.3, Math.sin(a) * d] });
      b.add(g);
    }

    const old = col('#3f1f28'), // old growth, wine-dark
      green = col('#536150'),
      pale = col('#a6b097'),
      salt = col('#ece6e0');
    let top = [0, 0.05, 0];
    let budget = 62; // joints

    // one swollen joint: narrow where it leaves the last, fat toward its end, salt gathering at its top
    const joint = (pos, dir, len, r, radial, age = -1) => {
      const g = lathe(
        [
          [r * 0.6, 0],
          [r, len * 0.72],
          [r * 0.8, len * 0.95],
          [0, len * 1.02],
        ],
        radial
      );
      const hf = age >= 0 ? age : cl(pos[1] / H);
      const body = hf < 0.16 ? old.clone() : hf < 0.46 ? mixc(old, green, (hf - 0.16) / 0.3) : mixc(green, pale, cl((hf - 0.46) / 0.5));
      const crust = R.range(0.25, 1) * (0.35 + 0.65 * hf); // the higher, the more salt
      const s0 = swayAt(pos[1]),
        s1 = swayAt(pos[1] + dir[1] * len);
      paint(g, {
        color: (v) => {
          const t = v.y / len;
          const c = mixc(body.clone().multiplyScalar(0.55), body, cl(t / 0.4));
          return t > 0.84 ? c.lerp(salt, cl((t - 0.84) / 0.12) * crust) : c;
        },
        rough: (v) => (v.y / len > 0.86 ? 0.95 : 0.5),
        mat: MAT.PLANT,
        sway: (v) => s0 + (s1 - s0) * cl(v.y / len),
      });
      b.add(aim(g, dir, pos, R.range(0, TAU)));
      budget--;
    };

    const grow = (pos, dir, n, len, r, depth) => {
      let drawn = 0;
      for (let i = 0; i < n && budget > 0; i++) {
        const l = len * R.range(0.85, 1.12);
        const rr = r * (1 - i * 0.06);
        joint(pos, dir, l, rr, depth === 0 ? 5 : 4);
        drawn++;
        const end = [pos[0] + dir[0] * l, pos[1] + dir[1] * l, pos[2] + dir[2] * l];
        if (end[1] > top[1]) top = end;
        // side shoots leave in opposite pairs and turn upward
        if (!picked && depth < 2 && i < n - 1 && i >= (depth === 0 ? 1 : 0) && R.chance(depth === 0 ? 0.9 : 0.3)) {
          const u = norm(cross(dir, lean(1.2, R.range(0, TAU))));
          const th = R.range(0.75, 1.0);
          for (const sg of [1, -1]) {
            if (R.chance(0.15)) continue; // one of a pair has snapped off
            const d2 = norm([dir[0] * Math.cos(th) + u[0] * sg * Math.sin(th), dir[1] * Math.cos(th) + u[1] * sg * Math.sin(th) + 0.3, dir[2] * Math.cos(th) + u[2] * sg * Math.sin(th)]);
            grow(end, d2, Math.max(1, Math.min(3, n - i - R.int(1, 2))), len * 0.78, rr * 0.8, depth + 1);
          }
        }
        pos = end;
        dir = norm([dir[0] + R.range(-0.12, 0.12), dir[1] + (depth === 0 ? 0.12 : 0.4), dir[2] + R.range(-0.12, 0.12)]);
      }
      if (!drawn) return;
      const sw = swayAt(pos[1]);
      if (picked) {
        // a clean cut
        const g = lathe(
          [
            [r * 0.7, 0],
            [0, 0.002],
          ],
          5
        );
        paint(g, { color: '#aeb597', rough: 0.7, mat: MAT.PLANT, sway: sw });
        b.add(aim(g, dir, pos));
        return;
      }
      // every tip ends in a point of salt
      if (depth === 0) {
        const h = r * 2.8;
        const g = crystal(r * 0.42, h, { sides: 4, tip: 0.45, rng: R });
        paint(g, { color: (v) => mixc('#c9bfb8', '#f5f1ed', cl(v.y / h)), emissive: 0.06, rough: 0.25, mat: MAT.CRYSTAL, sway: sw });
        b.add(aim(g, dir, pos, R.range(0, TAU)));
      } else {
        const g = spike(r * 0.38, r * 2.0, 3);
        paint(g, { color: '#ece6e1', emissive: 0.05, rough: 0.3, mat: MAT.CRYSTAL, sway: sw });
        b.add(aim(g, dir, pos, R.range(0, TAU)));
      }
    };

    const stems = R.int(3, 4);
    for (let i = 0; i < stems; i++) {
      const yaw = (i / stems) * TAU + R.range(-0.5, 0.5);
      const tilt = i === 0 ? R.range(0.03, 0.15) : R.range(0.25, 0.6);
      const n = picked ? 2 : i === 0 ? R.int(6, 7) : R.int(4, 6);
      const r0 = R.range(0.012, 0.03);
      grow([Math.sin(yaw) * r0, mh * 0.5, Math.cos(yaw) * r0], lean(tilt, yaw), n, H / 6.6, R.range(0.0098, 0.0122) * (i === 0 ? 1.1 : 1), 0);
    }
    if (picked) {
      // what comes back first
      for (let i = 0, n = R.int(2, 3); i < n; i++) {
        const yaw = R.range(0, TAU),
          d = R.range(0.03, 0.06);
        joint([Math.sin(yaw) * d, mh * 0.4, Math.cos(yaw) * d], lean(R.range(0, 0.4), yaw), R.range(0.02, 0.035), 0.006, 4, 0.7);
      }
    }

    b.anchor('top', top[0], top[1] + 0.02, top[2]);
    const m = b.build();
    ao(m.opaque, { height: 0.08, strength: 0.35 });
    return m;
  },
  { kind: 'ingredient', variants: 4 }
);
