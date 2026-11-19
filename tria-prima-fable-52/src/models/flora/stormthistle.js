// Stormthistle: a tall thistle the colour of wet iron. Every part of it ends in a spine, the heads
// carry a dry yellow tuft, and before rain the longest spines hold small blue-white sparks.
// opts.picked = true -> the heads cut off, the stalks and the leaves left standing.
import { Builder, Rng, MAT, TAU, THREE, paint, tube, lathe, leaf, mixc, col } from '../kit.js';
import { register } from '../registry.js';
import { path, aim, lean, spike, kite } from './_shared.js';

const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const IRON = col('#454d55'),
  IRON_DARK = col('#1f2327'),
  STEEL = col('#6c7d90'),
  PALE = col('#cfdcea'),
  LEAF = col('#333c38'),
  VEIN = col('#7f8c92'),
  STRAW = col('#6b5f2f'),
  GOLD = col('#c2ad55');

register(
  'stormthistle',
  (seed, opts = {}) => {
    const R = new Rng(seed * 6007 + 3);
    const b = new Builder();
    const picked = !!opts.picked;
    const H = R.range(0.86, 1.12);
    // wind: rooted at the foot, the heads travel a hand's breadth
    const swayAt = (y) => Math.pow(cl(y / H), 1.6) * 0.75;

    // ---- stalk ---------------------------------------------------------------------------------
    const sp = [
      [0, -0.06, 0],
      [R.range(-0.03, 0.03), H * 0.3, R.range(-0.03, 0.03)],
      [R.range(-0.05, 0.05), H * 0.66, R.range(-0.05, 0.05)],
      [R.range(-0.06, 0.06), H, R.range(-0.06, 0.06)],
    ];
    const SP = path(sp);
    const stalkColor = (v) => mixc(IRON_DARK, IRON, cl(v.y / (H * 0.45))).lerp(STEEL, cl((v.y / H - 0.55) / 0.6) * 0.55);
    const stalk = tube(sp, (t) => 0.0118 - 0.0056 * t, 6, { samples: 8 });
    paint(stalk, { color: stalkColor, rough: 0.55, metal: 0.15, mat: MAT.PLANT, sway: (v) => swayAt(v.y) });
    b.add(stalk);

    // ---- leaves: a ribbed midrib with paired lobes, each lobe a spine -----------------------------
    const spinyLeaf = (L, pairs, sw, curl) => {
      const out = [];
      const mid = leaf(L, L * 0.13, { segs: 3, belly: 0.3, point: 2.4, curl, fold: -0.5, base: 0.55 });
      paint(mid, {
        color: (v) => mixc(LEAF, VEIN, 0.1 + 0.5 * cl(1 - Math.abs(v.x) / (L * 0.03))).lerp(PALE, Math.pow(cl(v.y / L), 6) * 0.7),
        rough: 0.5,
        mat: MAT.PLANT,
        sway: (v) => sw + 0.22 * cl(v.y / L),
      });
      out.push(mid);
      for (let i = 0; i < pairs; i++) {
        const t = 0.16 + (i / pairs) * 0.7;
        const a = curl * t;
        const y = Math.abs(curl) > 1e-3 ? (L * Math.sin(a)) / curl : L * t;
        const z = Math.abs(curl) > 1e-3 ? (-L * (1 - Math.cos(a))) / curl : 0;
        for (const s of [-1, 1]) {
          const ll = L * (0.32 - 0.2 * Math.abs(t - 0.38)) * R.range(0.8, 1.15); // longest below the middle
          const g = kite(ll, ll * 0.4, 0.34, -0.3);
          paint(g, {
            color: (v) => mixc(LEAF, PALE, Math.pow(cl(v.y / ll), 4) * 0.7),
            rough: 0.5,
            mat: MAT.PLANT,
            sway: sw + 0.22 * t,
          });
          g.rotateZ(-s * R.range(0.9, 1.25)); // out to the side and a little forward
          g.rotateX(-a + R.range(-0.25, 0.25)); // follow the curl of the midrib
          g.translate(0, y, z);
          out.push(g);
        }
      }
      return out;
    };
    const placeLeaf = (list, tilt, yaw, pos) => {
      for (const g of list) {
        g.rotateX(tilt);
        g.rotateY(yaw);
        g.translate(pos[0], pos[1], pos[2]);
        b.add(g);
      }
    };
    // the rosette at the foot
    const nr = R.int(5, 7),
      yr = R.range(0, TAU);
    for (let i = 0; i < nr; i++) {
      placeLeaf(spinyLeaf(R.range(0.2, 0.3), 4, 0, -R.range(0.3, 0.6)), R.range(1.02, 1.3), yr + (i / nr) * TAU + R.range(-0.3, 0.3), [0, 0.012, 0]);
    }
    // leaves up the stalk, smaller as they climb
    const ns = R.int(6, 8);
    let yaw = R.range(0, TAU);
    for (let i = 0; i < ns; i++) {
      const t = 0.1 + (i / ns) * 0.6 + R.range(-0.02, 0.02);
      const p = SP.at(t);
      yaw += 2.4 + R.range(-0.4, 0.4);
      placeLeaf(spinyLeaf(R.range(0.19, 0.25) * (1 - t * 0.8), 3, swayAt(p[1]), -R.range(0.4, 0.8)), R.range(0.75, 1.05), yaw, p);
    }
    // thorns on the stalk itself
    for (let i = 0; i < 9; i++) {
      const t = R.range(0.08, 0.92);
      const p = SP.at(t);
      const len = R.range(0.014, 0.028);
      const g = spike(0.0032, len, 3);
      paint(g, { color: (v) => mixc(IRON, PALE, cl(v.y / len)), rough: 0.4, mat: MAT.PLANT, sway: swayAt(p[1]) });
      b.add(aim(g, lean(R.range(0.8, 1.2), R.range(0, TAU)), p, R.range(0, TAU)));
    }

    // ---- heads ---------------------------------------------------------------------------------
    let top = SP.at(1);
    const head = (pos, dir, rh, main) => {
      const sw = swayAt(pos[1]);
      if (picked) {
        // a clean pale cut
        const g = lathe(
          [
            [rh * 0.22, 0],
            [0, 0.0015],
          ],
          6
        );
        paint(g, { color: '#9aa58f', rough: 0.7, mat: MAT.PLANT, sway: sw });
        b.add(aim(g, dir, pos));
        return;
      }
      const parts = [];
      // the receptacle: an iron egg covered in overlapping scales
      const hh = rh * 1.9;
      const rec = lathe(
        [
          [rh * 0.3, 0],
          [rh * 0.9, rh * 0.4],
          [rh, rh * 0.95],
          [rh * 0.74, rh * 1.55],
          [rh * 0.3, hh],
        ],
        7
      );
      paint(rec, {
        color: (v) => {
          const k = Math.round((Math.atan2(-v.z, v.x) / TAU) * 7 + Math.round((v.y / hh) * 4) * 0.5);
          return mixc('#15191e', '#3a4452', cl(v.y / hh)).multiplyScalar(((k % 2) + 2) % 2 ? 0.78 : 1.05);
        },
        rough: 0.4,
        metal: 0.25,
        mat: MAT.PLANT,
        sway: sw,
      });
      parts.push(rec);
      const tips = [];
      const whorl = (n, radius, y, make, tilt0, tilt1) => {
        const a0 = R.range(0, TAU);
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * TAU + R.range(-0.18, 0.18);
          const tilt = R.range(tilt0, tilt1);
          const { g, len } = make();
          g.rotateX(tilt);
          g.translate(0, y, radius);
          g.rotateY(a);
          parts.push(g);
          const rr = radius + len * Math.sin(tilt);
          tips.push([Math.sin(a) * rr, y + len * Math.cos(tilt), Math.cos(a) * rr]);
        }
      };
      // the ruff: long flat bracts, steel going to bone at the points
      whorl(
        main ? 9 : 7,
        rh * 0.3,
        rh * 0.12,
        () => {
          const len = rh * R.range(2.3, 3.1);
          const g = kite(len, rh * 0.52, 0.28, -0.4);
          paint(g, { color: (v) => mixc('#3d4853', STEEL, cl(v.y / (len * 0.5))).lerp(PALE, Math.pow(cl(v.y / len), 3)), emissive: (v) => 0.5 * Math.pow(cl(v.y / len), 6), rough: 0.32, metal: 0.3, mat: MAT.PLANT, sway: sw });
          return { g, len };
        },
        1.12,
        1.5
      );
      tips.length = 0; // sparks sit on the spines, not on the ruff
      const spine = (l0, l1) => () => {
        const len = rh * R.range(l0, l1);
        const g = spike(rh * 0.075, len, 3);
        paint(g, { color: (v) => mixc('#4c5764', PALE, Math.pow(cl(v.y / len), 1.5)), emissive: (v) => 0.9 * Math.pow(cl(v.y / len), 4), rough: 0.3, metal: 0.3, mat: MAT.PLANT, sway: sw });
        return { g, len };
      };
      whorl(main ? 11 : 8, rh * 0.86, rh * 0.75, spine(1.3, 1.9), 0.95, 1.25);
      whorl(main ? 9 : 7, rh * 0.72, rh * 1.42, spine(1.1, 1.6), 0.5, 0.8);
      // sparks caught on a few of the spines
      for (let i = 0, n = main ? 5 : 3; i < n && tips.length; i++) {
        const p = tips.splice(R.int(0, tips.length - 1), 1)[0];
        const g = new THREE.OctahedronGeometry(rh * R.range(0.07, 0.11), 0);
        paint(g, { color: '#cfe6ff', emissive: 4, rough: 0.3, mat: MAT.GLOW, sway: sw });
        g.translate(p[0], p[1], p[2]);
        parts.push(g);
      }
      // the tuft: dry florets the colour of old straw
      tips.length = 0;
      whorl(
        main ? 9 : 7,
        rh * 0.16,
        hh * 0.94,
        () => {
          const len = rh * R.range(0.9, 1.45);
          const g = spike(rh * 0.1, len, 3);
          paint(g, { color: (v) => mixc(STRAW, GOLD, cl(v.y / len)), emissive: (v) => 0.25 * cl(v.y / len), rough: 0.6, mat: MAT.PLANT, sway: sw });
          return { g, len };
        },
        0.06,
        0.42
      );
      for (const g of parts) b.add(aim(g, dir, pos));
      if (main) {
        top = [pos[0] + dir[0] * hh * 1.4, pos[1] + dir[1] * hh * 1.4, pos[2] + dir[2] * hh * 1.4];
        const c = [pos[0] + dir[0] * rh, pos[1] + dir[1] * rh, pos[2] + dir[2] * rh];
        b.emitter('spark', c[0], c[1], c[2], { color: '#cfe6ff', radius: rh * 2.4, rate: 0.6 });
        b.light(c[0], c[1] + rh, c[2], '#bfe0ff', 0.3, 2);
      }
    };
    const RH = R.range(0.04, 0.046);
    head(SP.at(1), SP.dir(1), RH, true);

    // side branches, each with a smaller head
    const nb = R.int(1, 2),
      yb = R.range(0, TAU);
    for (let i = 0; i < nb; i++) {
      const t = R.range(0.5, 0.72);
      const p = SP.at(t);
      const a = yb + i * Math.PI + R.range(-0.6, 0.6);
      const o = [Math.sin(a), Math.cos(a)];
      const reach = R.range(0.1, 0.17),
        rise = Math.min(R.range(0.16, 0.27), H * 0.93 - p[1]);
      const pts = [p, [p[0] + o[0] * reach * 0.6, p[1] + rise * 0.28, p[2] + o[1] * reach * 0.6], [p[0] + o[0] * reach, p[1] + rise * 0.72, p[2] + o[1] * reach], [p[0] + o[0] * reach * 1.08, p[1] + rise, p[2] + o[1] * reach * 1.08]];
      const g = tube(pts, (u) => 0.0062 - 0.002 * u, 4, { samples: 5 });
      paint(g, { color: stalkColor, rough: 0.55, metal: 0.15, mat: MAT.PLANT, sway: (v) => swayAt(v.y) });
      b.add(g);
      const BP = path(pts);
      head(BP.at(1), BP.dir(1), RH * R.range(0.68, 0.8), false);
      // a leaf under the fork
      placeLeaf(spinyLeaf(R.range(0.09, 0.12), 2, swayAt(p[1]), -0.5), R.range(0.9, 1.2), a, p);
    }

    b.anchor('top', top[0], top[1], top[2]);
    return b.build();
  },
  { kind: 'ingredient', variants: 4 }
);
