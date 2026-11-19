// The packhorse bridge: one slightly pointed arch, a humped deck, parapets that have lost stretches.
// Runs along Z from -8 to +8, 3.6 m wide. The deck meets the ground (y = 0) at both ends and rises
// 1.6 m at the crown. Abutments go down to y = -4.
import { Builder, Rng, Noise, PAL, THREE, mixc } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, weathering, stoneTone, courses, cut, prune, masonry, voussoirs, placed, looseStone } from './_shared.js';

const HW = 1.8; // half width
const SPAN = 4.5, // half the clear span
  SPRING = -1.6,
  CROWN = 1.05,
  C = 0.9; // how far the arc centres sit past the middle: this is what points the arch
const CY = ((SPAN + C) * (SPAN + C) - C * C + SPRING * SPRING - CROWN * CROWN) / (2 * (SPRING - CROWN));
const RAD = Math.hypot(C, CROWN - CY);

/** Height of the walking surface. */
export const deckY = (z) => (Math.abs(z) >= 8 ? 0 : 0.8 * (1 + Math.cos((Math.PI * z) / 8)));
/** Underside of the arch (only meaningful for |z| < SPAN). */
const intrados = (z) => CY + Math.sqrt(Math.max(0, RAD * RAD - Math.pow(Math.abs(z) + C, 2)));

register(
  'bridge',
  (seed, opts) => {
    const R = new Rng(seed * 149 + 7);
    const nz = new Noise(seed * 53 + 4);
    const b = new Builder();
    const T = new Tris();
    if (opts && opts.lift) T.mx = new THREE.Matrix4().makeTranslation(0, Number(opts.lift), 0); // debug: look under it
    const shade = weathering({ seed: seed + 31, moss: 0.6, mossTop: 1.5, ground: -2.4, lichen: 0.45, water: -3.1 });
    const map = (u, v, w) => V3(w, v, u); // u along the bridge, v up, w across

    const arch = {
      cu: 0,
      a: SPAN,
      sill: -4.02,
      spring: SPRING,
      apex: CROWN,
      half: (v) => (v >= CROWN ? 0 : v <= SPRING ? SPAN : Math.max(0, -C + Math.sqrt(Math.max(0, RAD * RAD - (v - CY) * (v - CY))))),
    };

    // abutments below the springing: big plain blocks, their faces under the arch included
    const low = courses({ u0: -8.5, u1: 8.5, v0: -4, v1: SPRING, course: [0.45, 0.6], len: [0.9, 1.5], rng: R });
    cut(low, [arch]);
    masonry(T, low, { map, wF: HW, wB: -HW, rng: R, shadeAt: shade, back: true, detail: (c) => (c.v0 > -2.75 ? 'pillow' : 'plain'), chip: 0, ridge: false, base: -4, solid: (u, v) => Math.abs(u) > 8.5 || v > SPRING - 0.01 });

    // spandrels and haunches, cut to the line of the deck
    const body = courses({ u0: -8.5, u1: 8.5, v0: SPRING, v1: 1.7, course: [0.28, 0.36], len: [0.5, 0.95], rng: R });
    cut(body, [arch]);
    const under = (u) => deckY(u) - 0.14;
    prune(body, (c, um) => c.v0 < Math.max(under(c.u0), under(c.u1), under(um)) - 0.03);
    masonry(T, body, {
      map,
      wF: HW,
      wB: -HW,
      rng: R,
      shadeAt: shade,
      back: true,
      chip: 0,
      ridge: false,
      base: SPRING,
      pockets: 0.03,
      clip: under,
      returns: () => false,
      solid: (u, v) => Math.abs(u) > 8.5 || v > under(u) - 0.05,
    });

    // the ring: voussoirs right through the bridge, so their undersides make the barrel
    const t0 = Math.atan2(SPRING - CY, SPAN + C),
      t1 = Math.atan2(CROWN - CY, C);
    const n = Math.round((RAD * (t1 - t0)) / 0.42);
    for (const mirror of [false, true]) voussoirs(T, map, { cx: -C, cy: CY, R: RAD, t0, t1 }, { n, depth: 0.44, wF: HW, wB: -HW, rng: R, shadeAt: shade, clampU: 0, mirror, proud: 0.035 });

    // a string course that follows the hump, hiding the edge of the paving
    const band = courses({ u0: -8.45, u1: 8.45, levels: [-0.36, -0.03], len: [0.7, 1.1], rng: R });
    masonry(T, band, { map: (u, v, w) => V3(w, deckY(u) + v, u), wF: HW + 0.06, wB: -HW - 0.06, rng: R, shadeAt: shade, back: true, chip: 0, ridge: false, solid: (u) => Math.abs(u) > 8.45, tone: (c, rng) => stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }) });

    // paving: big worn setts, darker and smoother down the middle where feet and hooves went
    const pave = courses({ u0: -8.3, u1: 8.3, v0: -HW, v1: HW, course: [0.5, 0.75], len: [0.55, 1.0], rng: R });
    masonry(T, pave, {
      map: (u, v, w) => V3(v, deckY(u) + w, u),
      wF: 0,
      wB: -0.25,
      rng: R,
      shadeAt: shade,
      chip: 0,
      ridge: false,
      returns: () => false,
      bump: 0.011,
      bevel: 0.045,
      joint: 0.024,
      tone: (c, rng) => {
        const edge = Math.min(1, Math.abs((c.v0 + c.v1) / 2) / 1.3);
        return mixc(stoneTone(rng, { base: PAL.stoneDark, vary: 0.1 }), stoneTone(rng, { base: PAL.stone, warm: 0.4 }), edge * 0.8).lerp(new THREE.Color(PAL.moss), edge > 0.75 ? rng.range(0, 0.35) : 0);
      },
    });

    // parapets: three courses and a coping, each side broken in its own places
    const parapetTop = {};
    for (const side of [-1, 1]) {
      const gaps = [];
      for (let i = R.int(2, 3); i > 0; i--) gaps.push([R.range(-6.5, 6.5), R.range(0.6, 1.5), R.range(0.6, 1.15)]);
      const top = (u) => {
        let t = 1.0 - Math.max(0, (Math.abs(u) - 7.7) / 0.8) * 0.9;
        for (const [c, w, d] of gaps) t -= d * Math.exp(-Math.pow((u - c) / w, 2));
        return t - Math.max(0, nz.fbm2(u * 0.7 + side * 31, seed * 1.3, 3)) * 0.35;
      };
      parapetTop[side] = top;
      const mapP = (u, v, w) => V3(side * (HW - 0.18 + w), deckY(u) + v, u);
      const rows = courses({ u0: -8.4, u1: 8.4, v0: 0, v1: 0.84, course: [0.25, 0.3], len: [0.5, 0.9], rng: R });
      prune(rows, (c, um, vm) => vm < top(um));
      masonry(T, rows, { map: mapP, wF: 0.18, wB: -0.18, rng: R, shadeAt: shade, back: true, base: 0, chip: 0.5, debris: 0.25 });
      const cope = courses({ u0: -8.4, u1: 8.4, levels: [0.84, 1.0], len: [0.7, 1.1], rng: R });
      prune(cope, (c, um) => top(um) > 0.93);
      masonry(T, cope, { map: mapP, wF: 0.23, wB: -0.23, rng: R, shadeAt: shade, back: true, base: 0.84, chip: 0, ridge: false, tone: (c, rng) => stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }) });
      // stones from the lost stretches lie at the foot of the wall, clear of the path
      for (const [c, w] of gaps) {
        for (let i = R.int(2, 4); i > 0; i--) {
          const u = Math.max(-7.6, Math.min(7.6, c + R.range(-w, w))),
            sz = R.range(0.16, 0.3);
          placed(T, [side * R.range(1.12, 1.36), deckY(u) + sz * 0.22, u], [R.range(-0.3, 0.3), R.range(0, 6.28), R.range(-0.3, 0.3)], () =>
            looseStone(T, sz, sz * R.range(0.5, 0.75), sz * R.range(0.6, 1), { rng: R, color: stoneTone(R), shadeAt: shade, j: sz * 0.12 })
          );
        }
      }
    }
    b.add(T.build());

    // colliders. The deck: boxes 0.4 m long whose tops follow the hump in steps of at most 0.13 m.
    // Under the arch they are only as deep as the masonry, so the water below stays open.
    for (let i = 0; i < 40; i++) {
      const zc = -8 + 0.4 * (i + 0.5);
      const top = deckY(zc);
      const bottom = Math.abs(zc) < SPAN - 0.1 ? Math.min(top - 0.3, intrados(Math.abs(zc) + 0.2) - 0.02) : -4;
      b.boxCollider(0, (top + bottom) / 2, zc, HW, (top - bottom) / 2, 0.2);
    }
    for (const side of [-1, 1]) {
      for (let zc = -7.5; zc <= 7.51; zc += 1.0) {
        let h = 0;
        for (const k of [-0.35, 0, 0.35]) h += parapetTop[side](zc + k) / 3;
        if (h < 0.5) continue;
        const ya = Math.min(deckY(zc - 0.5), deckY(zc + 0.5)) - 0.15,
          yb = Math.max(deckY(zc - 0.5), deckY(zc + 0.5)) + Math.min(1, h);
        b.boxCollider(side * (HW - 0.18), (ya + yb) / 2, zc, 0.2, (yb - ya) / 2, 0.5);
      }
    }
    return b.build();
  },
  { kind: 'structure' }
);
