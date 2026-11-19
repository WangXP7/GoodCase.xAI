// Candles, storage and clutter: candles, chest, crate, barrel, sack, bookpile, lore_page. Owner: MODELS-B.
// Things left where their owner put them down for the last time.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, tint, deform, flat, box, cyl, cone, dome, torus, lathe, tube, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { ironSpec, brassSpec, woodSpec, stoneSpec, plank, logGeo, book, openBook, sheet, candle, skull, hewn, seamNormals } from './_shared.js';
import { boardX, edgeX, edgeZ, post, dim, hull, crock } from './furniture.js';

const HALF = Math.PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _c = new THREE.Color(),
  _d = new THREE.Color();
/** Seeds run 1, 2, 3...: which of `n` variants this one is. */
const variantOf = (seed, n) => {
  const s = Math.round(Number.isFinite(seed) ? seed : 1);
  return (((s - 1) % n) + n) % n;
};
/** Bounding box of a (nested) list of geometries. */
function boundsOf(geos) {
  const bb = new THREE.Box3();
  for (const g of geos.flat(Infinity)) {
    if (!g) continue;
    g.computeBoundingBox();
    bb.union(g.boundingBox);
  }
  return bb;
}
/** Highest point of a geometry within `r` of (x, z): where to set something down on a rough stone. */
function topAt(g, x, z, r = 0.08) {
  const p = g.attributes.position;
  let best = -Infinity,
    all = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > all) all = y;
    if (Math.hypot(p.getX(i) - x, p.getZ(i) - z) < r && y > best) best = y;
  }
  return best > -Infinity ? best : all;
}
/**
 * A strip of leather or cloth `width` wide (X) following a path of [y, z] points. Its face looks
 * up where the path runs toward +Z and forward where it runs down. `double` gives it a back.
 */
function ribbon(path, width, { x = 0, double = false } = {}) {
  const pos = [];
  const x0 = x - width / 2,
    x1 = x + width / 2;
  for (let i = 0; i < path.length - 1; i++) {
    const [ya, za] = path[i],
      [yb, zb] = path[i + 1];
    const A = [x0, ya, za],
      B = [x1, ya, za],
      C = [x1, yb, zb],
      D = [x0, yb, zb];
    pos.push(...A, ...C, ...B, ...A, ...D, ...C);
    if (double) pos.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** A half ring that hangs from its two ends: a drop handle. Hangs in the YZ plane from the origin. */
function dropRing(R, r, lift = 0.3, side = 1) {
  const g = torus(R, r, 3, 6, Math.PI);
  g.rotateX(HALF);
  g.rotateY(HALF);
  g.rotateZ(lift * side);
  return g;
}
const LEATHER = (tone = '#3a2a1e', seed = 0) => {
  const nz = new Noise(300 + seed);
  return { color: (q) => _c.set(tone).multiplyScalar(0.65 + 0.6 * (nz.fbm3(q.x * 9, q.y * 9, q.z * 9, 3) * 0.5 + 0.5)), rough: 0.7, metal: 0, mat: MAT.PLAIN };
};

// =============================================================================================
// Candles: unlit. The game draws a flame at every `candle` emitter and hangs the light on one.
// =============================================================================================
register(
  'candles',
  (seed = 1) => {
    const v = variantOf(seed, 4);
    const b = new Builder();
    const R = new Rng(9100 + v * 37);
    const nz = new Noise(600 + v);
    const cW = new THREE.Color(PAL.wax),
      cDirty = new THREE.Color('#6a5f45');
    let seat = 0,
      spread = 0.12,
      count = 6,
      maxH = 0.27,
      zs = 1,
      side = 0; // > 0: the radius of a sheer side the tallow can run down
    const blocked = []; // [x, z, r]: no candle here
    const given = []; // candles placed by hand: { x, z, y, h, r }

    if (v === 0) {
      // a dented iron dish
      const RAD = 12;
      const dish = hewn(
        lathe(
          [
            [0.07, 0, 'hard'],
            [0.1, 0.012],
            [0.175, 0.03],
            [0.2, 0.052, 'hard'],
            [0.191, 0.056, 'hard'],
            [0.16, 0.036],
            [0.08, 0.022],
            [0, 0.02],
          ],
          RAD
        ),
        RAD,
        { amp: 0.004, freq: 9, seed: 4 }
      );
      b.add(paint(dish, ironSpec(0.75, 3, 12)));
      seat = 0.024;
      spread = 0.125;
      count = 6;
      maxH = 0.3;
    } else if (v === 1) {
      // a broken flagstone
      const slab = rock(0.27, { seed: 13, detail: 1, rough: 0.14, squash: [1, 0.2, 0.8], facet: true });
      slab.translate(0, 0.032, 0);
      b.add(paint(slab, stoneSpec(PAL.stone, 6, 0.85)));
      seat = boundsOf([slab]).max.y - 0.014;
      spread = 0.15;
      zs = 0.8;
      count = 7;
      maxH = 0.33 - seat;
    } else if (v === 2) {
      // a skull on a stone, a candle on its crown and more round it
      const slab = rock(0.3, { seed: 21, detail: 1, rough: 0.12, squash: [1, 0.16, 0.95], facet: true });
      slab.translate(0, 0.03, 0);
      b.add(paint(slab, stoneSpec(PAL.stoneDark, 8, 1.05)));
      seat = boundsOf([slab]).max.y - 0.014;
      const sk = skull(0.2, { seed: 3, jaw: false });
      dim(sk, 0.66, 0.58, 0.44);
      sk.rotateY(0.35);
      sk.translate(0, seat - 0.006, 0);
      b.add(sk);
      given.push({ x: -0.012, z: -0.02, y: seat - 0.006 + 0.2 * 1.0, h: 0.065, r: 0.02 });
      blocked.push([0, 0.0, 0.115]);
      spread = 0.215;
      count = 5;
      maxH = 0.17;
    } else {
      // the drum of a fallen colonnette
      const RAD = 12;
      const drum = flat(
        hewn(
          lathe(
            [
              [0.15, 0, 'hard'],
              [0.174, 0.012],
              [0.168, 0.1],
              [0.156, 0.118, 'hard'],
              [0, 0.124],
            ],
            RAD
          ),
          RAD,
          { amp: 0.007, freq: 7, seed: 8 }
        )
      );
      b.add(paint(drum, stoneSpec(PAL.stoneLight, 9, 0.8)));
      seat = 0.118;
      spread = 0.118;
      count = 7;
      maxH = 0.2;
      side = 0.172;
      given.push({ x: 0.25, z: 0.07, y: 0, h: 0.1, r: 0.021 }, { x: 0.2, z: -0.19, y: 0, h: 0.04, r: 0.023 });
    }

    const waxSpec = { color: (q) => _c.copy(cW).lerp(cDirty, clamp(0.5 - (q.y - seat) * 12 + 0.3 * nz.n3(q.x * 30, q.y * 30, q.z * 30), 0, 0.8)), rough: 0.5, metal: 0, mat: MAT.PLAIN };

    // where the candles stand
    const spots = [];
    const tryPlace = (r) => {
      for (let t = 0; t < 80; t++) {
        const a = R.range(0, TAU),
          d = Math.sqrt(R.next()) * (spread - r);
        const x = Math.cos(a) * d,
          z = Math.sin(a) * d * zs;
        if (blocked.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + r)) continue;
        if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < r + s.r + 0.007)) continue;
        return [x, z];
      }
      return null;
    };
    for (let i = 0; i < count; i++) {
      const r = R.range(0.015, 0.024);
      const p = tryPlace(r);
      if (!p) continue;
      const mid = 1 - Math.hypot(p[0], p[1] / zs) / spread;
      const h = i === 0 ? maxH : clamp(maxH * (0.14 + 0.8 * R.next() * (0.45 + 0.55 * mid)), 0.028, maxH);
      spots.push({ x: p[0], z: p[1], y: seat, h, r });
    }

    // the tallow they stand in
    {
      const mound = dome(spread * 1.1, 10, 3, 0.2);
      deform(mound, (p) => {
        const a = Math.atan2(p.z, p.x);
        const k = 0.84 + 0.3 * nz.n2(Math.cos(a) * 1.7 + 3, Math.sin(a) * 1.7);
        p.y *= 0.7 + 0.6 * nz.n2(p.x * 9, p.z * 9);
        p.x *= k;
        p.z *= k * zs;
      });
      mound.translate(0, seat - 0.006, 0);
      b.add(paint(mound, waxSpec));
    }
    if (side > 0) {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const a = R.range(0, TAU);
        const ex = Math.cos(a),
          ez = Math.sin(a);
        const drop = R.range(0.35, 1) * seat;
        runs.push(
          tube(
            [
              [ex * spread * 0.95, seat + 0.006, ez * spread * 0.95],
              [ex * (side - 0.012), seat + 0.004, ez * (side - 0.012)],
              [ex * (side + 0.006), seat - drop * 0.5, ez * (side + 0.006)],
              [ex * (side + 0.008), seat - drop, ez * (side + 0.008)],
            ],
            (t) => 0.007 + 0.004 * t,
            4,
            { samples: 5 }
          )
        );
      }
      b.add(paint(merge(runs.map((g) => paint(g, {}))), waxSpec));
    }
    // candles burnt right down: a puddle and a black wick
    {
      const spent = [];
      const wicks = [];
      for (let i = 0; i < 2; i++) {
        const p = tryPlace(0.03);
        if (!p) continue;
        const d = dome(0.03, 7, 2, 0.3);
        d.translate(p[0], seat + 0.002, p[1]);
        spent.push(d);
        const w = box(0.004, 0.008, 0.004);
        w.translate(p[0], seat + 0.013, p[1]);
        wicks.push(w);
        spots.push({ x: p[0], z: p[1], r: 0.03, spent: true });
      }
      if (spent.length) {
        b.add(paint(merge(spent.map((g) => paint(g, {}))), waxSpec));
        b.add(paint(merge(wicks.map((g) => paint(g, {}))), { color: PAL.soot, rough: 1, metal: 0, mat: MAT.PLAIN }));
      }
    }

    let tallest = null;
    for (const s of [...spots, ...given]) {
      if (s.spent) continue;
      const c = candle(R, s.h, s.r, { drips: s.h > 0.1 ? R.int(1, 3) : R.int(0, 1), pool: s.y < 0.01 });
      const tilt = R.range(0, 0.085),
        az = R.range(0, TAU);
      c.geo.rotateZ(tilt);
      c.geo.rotateY(az);
      c.geo.translate(s.x, s.y - 0.004, s.z);
      b.add(c.geo);
      // the wick after the same lean
      const tx = -c.tip[1] * Math.sin(tilt),
        ty = c.tip[1] * Math.cos(tilt);
      const w = [s.x + tx * Math.cos(az), s.y - 0.004 + ty, s.z - tx * Math.sin(az)];
      b.emitter('candle', w[0], w[1], w[2]);
      if (!tallest || w[1] > tallest[1]) tallest = w;
    }
    if (tallest) b.light(tallest[0], tallest[1] + 0.04, tallest[2], '#ffb45e', 0.9, 3.4);
    return b.build();
  },
  { kind: 'prop', variants: 4 }
);

// =============================================================================================
// Chest: iron-bound, barrel-lidded. Front is +Z.
// =============================================================================================
/** The inside of a box open at the top: faces look inward. */
function innerBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = Array.from(g.index.array);
  idx.splice(12, 6);
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.setIndex(idx);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
register(
  'chest',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(4400 + v * 11);
    const W = 0.94,
      D = 0.54,
      BH = 0.42,
      FOOT = 0.03,
      T = 0.028;
    const open = [0, 0.33, 1.72][v];
    const tone = [PAL.woodDark, PAL.wood, '#2c2622'][v];
    const rust = [0.6, 0.75, 0.9][v];
    let k = 0;
    const o = (x = {}) => ({ tone, worn: 0.45, seed: ++k + 60 + v * 20, ...x });
    const body = [];

    // walls, two boards high
    const bh = (BH - FOOT) / 2;
    for (let i = 0; i < 2; i++) {
      const y = FOOT + bh * (i + 0.5);
      for (const sz of [-1, 1]) body.push(edgeX(W, bh - 0.004, T, [0, y, sz * (D / 2 - T / 2)], o()));
      for (const sx of [-1, 1]) body.push(edgeZ(D - 2 * T, bh - 0.004, T, [sx * (W / 2 - T / 2), y, 0], o()));
    }
    body.push(boardX(W - 2 * T, D - 2 * T, 0.02, [0, FOOT + 0.01, 0], o()));
    for (const sx of [-1, 1]) body.push(edgeZ(D + 0.012, FOOT + 0.014, 0.075, [sx * (W / 2 - 0.11), (FOOT + 0.014) / 2, 0], o({ tone: PAL.woodDark })));
    b.add(body);
    {
      const dark = innerBox(W - 2 * T, BH - FOOT - 0.022, D - 2 * T);
      dark.translate(0, FOOT + 0.021 + (BH - FOOT - 0.022) / 2, 0);
      b.add(paint(dark, { color: '#0a0807', rough: 1, metal: 0, mat: MAT.PLAIN }));
    }

    // the lid: a segment of a barrel, six staves
    const rise = 0.17;
    const LR = ((D * D) / 4 + rise * rise) / (2 * rise);
    const half = Math.asin(D / 2 / LR);
    const NS = 6;
    const arcPart = (r0, r1, x0, x1, spec, facet) => {
      const prof =
        r0 === r1
          ? [
              [r0, x0],
              [r0, x1],
            ]
          : [
              [r0, x0],
              [r1, x0 + 0.004],
              [r1, x1 - 0.004],
              [r0, x1],
            ];
      let g = lathe(prof, NS, { arc: 2 * half });
      if (facet) g = flat(g);
      paint(g, spec);
      g.rotateY(Math.PI - half);
      g.rotateZ(-HALF);
      g.translate(0, BH - (LR - rise), 0);
      return g;
    };
    const lid = [];
    {
      const staves = arcPart(LR, LR, -W / 2, W / 2, woodSpec(tone, 77 + v, { worn: 0.5 }), true);
      const ks = [];
      for (let i = 0; i < NS; i++) ks.push(R.range(0.78, 1.12));
      tint(staves, (q) => ks[Math.floor(q.i / 6) % NS]);
      lid.push(staves);
      for (const sx of [-1, 1]) {
        const x = (sx * W) / 2;
        const P = [[x, BH, 0]];
        for (let i = 0; i <= NS; i++) {
          const a = Math.PI - half + (i / NS) * 2 * half;
          P.push([x, BH - (LR - rise) - LR * Math.cos(a), -LR * Math.sin(a)]);
        }
        const T3 = [];
        for (let i = 1; i <= NS; i++) T3.push([0, i, i + 1]);
        P.push([0, BH, 0]); // pulls the centroid inward so the cap faces out
        lid.push(paint(hull(P, T3), woodSpec(tone, 81 + sx, { worn: 0.4 })));
      }
      const under = hull(
        [
          [-W / 2, BH, -D / 2],
          [W / 2, BH, -D / 2],
          [W / 2, BH, D / 2],
          [-W / 2, BH, D / 2],
          [0, BH + 0.2, 0],
        ],
        [
          [0, 1, 2],
          [0, 2, 3],
        ]
      );
      lid.push(paint(under, { color: '#15100d', rough: 0.95, metal: 0, mat: MAT.WOOD }));
      // iron over the lid
      for (const x of [-W / 2 + 0.026, -0.3, 0.3, W / 2 - 0.026]) lid.push(arcPart(LR - 0.001, LR + 0.006, x - 0.025, x + 0.025, ironSpec(rust, 5 + x * 7, 12), false));
    }
    const swing = (g) => {
      if (open) {
        g.translate(0, -BH, D / 2);
        g.rotateX(-open);
        g.translate(0, BH, -D / 2);
      }
      return g;
    };
    lid.forEach(swing);
    b.add(lid);

    // iron on the body
    {
      const iron = [];
      const mid = (BH + FOOT) / 2,
        hh = BH - FOOT;
      for (const x of [-0.3, 0.3])
        for (const sz of [-1, 1]) {
          const s = box(0.05, hh, 0.006);
          s.translate(x, mid, sz * (D / 2 + 0.003));
          iron.push(s);
        }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const f = box(0.052, hh, 0.006);
          f.translate(sx * (W / 2 - 0.026), mid, sz * (D / 2 + 0.003));
          const e = box(0.006, hh, 0.052);
          e.translate(sx * (W / 2 + 0.003), mid, sz * (D / 2 - 0.026));
          iron.push(f, e);
        }
      const plate = box(0.12, 0.14, 0.008);
      plate.translate(0, BH - 0.1, D / 2 + 0.004);
      iron.push(plate);
      // rivets down the front straps
      for (const x of [-W / 2 + 0.026, -0.3, 0.3, W / 2 - 0.026])
        for (const y of [FOOT + 0.05, mid, BH - 0.05]) {
          const rv = cone(0.011, 0.009, 4, true);
          rv.rotateX(HALF);
          rv.translate(x, y, D / 2 + 0.0105);
          iron.push(rv);
        }
      // drop handles on the ends
      for (const sx of [-1, 1]) {
        const h = dropRing(0.055, 0.008, 0.32, sx);
        h.translate(sx * (W / 2 + 0.016), 0.3, 0);
        iron.push(h);
        for (const sz of [-1, 1]) {
          const m = box(0.014, 0.034, 0.03);
          m.translate(sx * (W / 2 + 0.008), 0.3, sz * 0.055);
          iron.push(m);
        }
      }
      // the hasp hangs from the lid's front edge
      const fy = BH + D * Math.sin(open),
        fz = -D / 2 + D * Math.cos(open);
      const hasp = box(0.038, 0.115, 0.007);
      hasp.translate(0, fy - 0.045, fz + 0.012);
      iron.push(hasp);
      if (v === 0) {
        // locked
        const lock = box(0.052, 0.056, 0.024);
        lock.translate(0, BH - 0.168, D / 2 + 0.022);
        const sh = torus(0.017, 0.0045, 3, 6, Math.PI);
        sh.rotateX(-HALF);
        sh.translate(0, BH - 0.14, D / 2 + 0.022);
        iron.push(lock, sh);
      }
      b.add(paint(merge(iron.map((g) => paint(g, {}))), ironSpec(rust, 21 + v, 11)));
      const hole = box(0.012, 0.03, 0.004);
      hole.translate(0, BH - 0.118, D / 2 + 0.0085);
      b.add(paint(hole, { color: '#050404', rough: 1, metal: 0, mat: MAT.PLAIN }));
    }

    if (v === 1) {
      // ajar: something was pulled out in a hurry and left hanging
      const cl = ribbon(
        [
          [BH - 0.06, D / 2 - 0.13],
          [BH + 0.012, D / 2 - 0.03],
          [BH + 0.012, D / 2 + 0.012],
          [BH - 0.06, D / 2 + 0.024],
          [BH - 0.17, D / 2 + 0.02],
          [BH - 0.25, D / 2 + 0.034],
        ],
        0.26,
        { x: -0.19 }
      );
      deform(cl, (p) => {
        p.z += 0.008 * Math.sin(p.x * 40) * clamp((BH - p.y) * 6, 0, 1);
        if (p.y < BH - 0.2) p.y += 0.03 * Math.sin(p.x * 23 + 1);
      });
      b.add(paint(cl, { color: (q) => _c.set(PAL.clothRed).multiplyScalar(0.55 + 0.5 * clamp((q.y - BH + 0.25) * 4, 0, 1)), rough: 0.95, metal: 0, mat: MAT.CLOTH }));
    }
    if (v === 2) {
      // thrown open and long since emptied: straw, a crock, two scrolls nobody wanted
      const straw = new THREE.PlaneGeometry(W - 2 * T - 0.01, D - 2 * T - 0.01, 5, 3);
      straw.rotateX(-HALF);
      const nzS = new Noise(31);
      deform(straw, (p) => {
        p.y = FOOT + 0.1 + 0.05 * nzS.n2(p.x * 9, p.z * 9);
      });
      b.add(paint(flat(straw), { color: (q) => _c.set(PAL.thatch).multiplyScalar(0.35 + 0.4 * nzS.n2(q.x * 30, q.z * 30) ** 2), rough: 1, metal: 0, mat: MAT.PLANT }));
      const c1 = crock(0.2, 0.085, { seed: 15, tone: '#4f4135' });
      c1.rotateZ(1.15);
      c1.translate(-0.12, FOOT + 0.19, 0.03);
      b.add(c1);
      const scrolls = [];
      for (let i = 0; i < 2; i++) {
        const s = cyl(0.02, 0.02, 0.27, 6);
        s.rotateX(HALF);
        s.rotateY(0.5 + i * 0.9);
        s.translate(0.2 + i * 0.07, FOOT + 0.16 + i * 0.012, -0.03 + i * 0.06);
        scrolls.push(s);
      }
      b.add(paint(merge(scrolls.map((g) => paint(g, {}))), { color: (q) => _c.set(PAL.vellum).multiplyScalar(0.75 + 0.2 * Math.sin(q.x * 90)), rough: 0.9, metal: 0, mat: MAT.PLAIN }));
    }

    const bb = boundsOf([body, lid]);
    b.boxCollider(0, (bb.max.y + 0) / 2, (bb.max.z + bb.min.z) / 2, W / 2, bb.max.y / 2, (bb.max.z - bb.min.z) / 2);
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);

// =============================================================================================
// Crate: 0.7 m, slatted, built to be thrown about. Origin at the middle of its foot.
// =============================================================================================
register(
  'crate',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(5200 + v * 13);
    const HS = 0.35,
      BT = 0.026,
      PT = 0.02,
      PW = 0.07;
    const tone = [PAL.wood, PAL.woodGrey, PAL.woodDark][v];
    let k = 0;
    const o = (x = {}) => ({ tone, worn: v === 1 ? 0.75 : 0.4, seed: ++k + 200 + v * 40, rough: 0.006, char: v === 2 ? 0.3 * R.next() : 0, ...x });
    const wood = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(post(0.66, PW, PW, [sx * (HS - PW / 2), 0.02, sz * (HS - PW / 2)], o({ tone: v === 1 ? PAL.woodGrey : PAL.woodDark })));
    // slats: four to a side with a gap between
    const gone = ['', '0:2', '3:1'][v];
    const off = HS - BT - PT / 2,
      len = 2 * (HS - 0.012);
    for (let f = 0; f < 4; f++)
      for (let i = 0; i < 4; i++) {
        if (gone === f + ':' + i) continue;
        const y = 0.02 + 0.165 * (i + 0.5) + R.range(-0.004, 0.004);
        const sgn = f % 2 ? -1 : 1;
        wood.push(f < 2 ? edgeX(len, 0.143, PT, [0, y, sgn * off], o()) : edgeZ(len, 0.143, PT, [sgn * off, y, 0], o()));
      }
    // lid and bottom
    for (let i = 0; i < 4; i++) {
      if (v === 2 && i === 1) continue;
      const askew = v === 1 && i === 2;
      const g = boardX(askew ? 0.66 : 0.68 - R.range(0, 0.008), 0.168, PT, [0, 0, 0], o());
      if (askew) g.rotateY(0.07);
      g.translate(0, 0.69, -0.2625 + 0.175 * i);
      wood.push(g);
    }
    for (let i = 0; i < 3; i++) wood.push(boardX(0.675, 0.226, PT, [0, 0.01, (i - 1) * 0.2325], o()));
    // a brace across the front and the back
    for (const sz of [-1, 1]) {
      if ((v === 1 && sz < 0) || (v === 2 && sz > 0)) continue;
      const br = plank(0.75, 0.062, BT - 0.004, o({ tone: v === 1 ? PAL.woodGrey : PAL.woodDark }));
      br.translate(0, -0.375, 0);
      br.rotateZ(-0.7115 * sz);
      br.translate(0, 0.35, sz * (HS - BT / 2));
      wood.push(br);
    }
    b.add(wood);
    // what is inside: the dark
    const core = box(0.6, 0.5, 0.6);
    core.translate(0, 0.29, 0);
    b.add(paint(core, { color: '#0a0908', rough: 1, metal: 0, mat: MAT.PLAIN }));
    // rope handles on the ends
    if (v !== 1) {
      const ropes = [];
      for (const sx of [-1, 1]) {
        const h = dropRing(0.06, 0.0105, 0.0, sx);
        h.translate(sx * (HS - BT + 0.0115), 0.575, 0);
        ropes.push(h);
      }
      b.add(paint(merge(ropes.map((g) => paint(g, {}))), { color: (q) => _c.set(PAL.rope).multiplyScalar(0.55 + 0.3 * Math.sin((q.y + q.z) * 260)), rough: 0.95, metal: 0, mat: MAT.CLOTH }));
    }
    b.boxCollider(0, HS, 0, HS, HS, HS);
    return b.build();
  },
  { kind: 'prop', variants: 3, size: 0.7 }
);

// =============================================================================================
// Barrel: 0.6 x 0.9 m. Each stave is its own facet.
// =============================================================================================
register(
  'barrel',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(6300 + v * 17);
    const N = 13,
      H = 0.9;
    const PROF = [
      [0, 0.252],
      [0.09, 0.2715],
      [0.25, 0.2895],
      [0.45, 0.296],
      [0.65, 0.2895],
      [0.81, 0.2715],
      [0.9, 0.252],
    ];
    const rAt = (y) => {
      for (let i = 0; i < PROF.length - 1; i++) {
        const [y0, r0] = PROF[i],
          [y1, r1] = PROF[i + 1];
        if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
      return PROF[PROF.length - 1][1];
    };
    const slope = (j) => {
      const a = PROF[Math.max(0, j - 1)],
        c = PROF[Math.min(PROF.length - 1, j + 1)];
      return (c[1] - a[1]) / (c[0] - a[0]);
    };
    const tone = [PAL.wood, PAL.woodGrey, '#241e1b'][v];
    const hoops = [
      [0.05, 0.2, 0.7, 0.85],
      [0.05, 0.22, 0.85],
      [0.05, 0.17, 0.3, 0.6, 0.73, 0.85],
    ][v];
    const BUNG = 3; // the stave with the bung in it

    const pos = [],
      nor = [];
    const shade = [];
    const per = (PROF.length - 1) * 6;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU,
        a1 = ((i + 1) / N) * TAU,
        am = (a0 + a1) / 2;
      const dr = R.range(-0.0025, 0.0025);
      shade.push(R.range(0.76, 1.14));
      const P = (a, j) => [Math.cos(a) * (PROF[j][1] + dr), PROF[j][0], Math.sin(a) * (PROF[j][1] + dr)];
      const Nn = (j) => {
        const s = slope(j),
          l = Math.hypot(1, s);
        return [Math.cos(am) / l, -s / l, Math.sin(am) / l];
      };
      for (let j = 0; j < PROF.length - 1; j++) {
        const A = P(a0, j),
          B = P(a1, j),
          C = P(a1, j + 1),
          Dd = P(a0, j + 1);
        const n0 = Nn(j),
          n1 = Nn(j + 1);
        pos.push(...A, ...Dd, ...B, ...B, ...Dd, ...C);
        nor.push(...n0, ...n1, ...n0, ...n0, ...n1, ...n1);
      }
    }
    const staves = new THREE.BufferGeometry();
    staves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    staves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    paint(staves, woodSpec(tone, 40 + v * 9, { worn: v === 1 ? 0.7 : 0.35 }));
    const bungA = ((BUNG + 0.5) / N) * TAU;
    tint(staves, (q) => {
      const st = Math.floor(q.i / per);
      let s = shade[st];
      s *= 0.7 + 0.3 * clamp(q.y / 0.14, 0, 1); // damp at the foot
      for (const hy of hoops) if (q.y < hy && q.y > hy - 0.1) s *= 0.88; // rust runs under each hoop
      if (v === 1 && Math.abs(q.y - 0.67) < 0.05) s *= 1.3; // pale where a hoop sat until it fell off
      if (v === 2 && st === BUNG && q.y < 0.46) s *= 0.55; // what leaked
      return s;
    });
    b.add(staves);

    // heads, set in from the chime
    const rin = 0.232;
    const headSpec = woodSpec(tone, 47 + v, { worn: 0.5 });
    const top = lathe(
      [
        [0.2545, H],
        [rin, H, 'hard'],
        [rin, H - 0.036, 'hard'],
        [0, H - 0.036],
      ],
      N
    );
    const bot = lathe(
      [
        [0, 0.036],
        [rin, 0.036, 'hard'],
        [rin, 0, 'hard'],
        [0.2545, 0],
      ],
      N
    );
    const heads = merge(paint(top, headSpec), paint(bot, headSpec));
    tint(heads, (q) => (Math.abs(q.ny) > 0.5 ? 0.62 + 0.25 * Math.sin(q.x * 31) : 0.5));
    b.add(heads);

    // hoops
    {
      const hs = hoops.map((y, i) => {
        const h = i === 0 || i === hoops.length - 1 ? 0.05 : 0.042;
        const y0 = y - h / 2,
          y1 = y + h / 2,
          t = 0.0042;
        return lathe(
          [
            [rAt(y0) - 0.002, y0],
            [rAt(y0 + h * 0.22) + t, y0 + h * 0.22],
            [rAt(y1 - h * 0.22) + t, y1 - h * 0.22],
            [rAt(y1) - 0.002, y1],
          ],
          N
        );
      });
      b.add(paint(merge(hs.map((g) => paint(g, {}))), ironSpec([0.6, 0.85, 0.5][v], 9 + v, 9)));
    }
    // the bung
    {
      const g = cyl(0.02, 0.024, 0.03, 6);
      g.rotateX(HALF);
      g.rotateY(HALF - bungA);
      g.translate(Math.cos(bungA) * 0.283, 0.45, Math.sin(bungA) * 0.283);
      b.add(paint(g, woodSpec(PAL.woodLight, 3, { worn: 0.2 })));
    }
    b.cylCollider(0, H / 2, 0, 0.3, H);
    return b.build();
  },
  { kind: 'prop', variants: 3, radius: 0.3, height: 0.9 }
);

// =============================================================================================
// Sack
// =============================================================================================
register(
  'sack',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(7400 + v * 19);
    const nz = new Noise(70 + v);
    const RAD = 12;
    const BURLAP = ['#6c5c43', '#5f553f', '#64543c'][v];
    const burlap = (inside = () => 0) => ({
      color: (q) =>
        _c
          .set(BURLAP)
          .multiplyScalar((0.7 + 0.45 * (nz.fbm3(q.x * 7, q.y * 7, q.z * 7, 3) * 0.5 + 0.5)) * (0.66 + 0.34 * clamp(q.y / 0.16, 0, 1)))
          .lerp(_d.set('#0c0a08'), inside(q)),
      rough: 0.95,
      metal: 0,
      mat: MAT.CLOTH,
    });
    const lumpy = (g, amp = 0.022) => {
      deform(g, (p) => {
        const rr = Math.hypot(p.x, p.z);
        if (rr < 1e-4) return;
        const k = 1 + (nz.fbm3(p.x * 5 + 3, p.y * 5, p.z * 5, 3) * amp) / Math.max(0.09, rr);
        p.x *= k;
        p.z *= k;
      });
      return g;
    };

    if (v === 0) {
      // full and tied at the neck, slumped against whatever is beside it
      const g = lumpy(
        lathe(
          [
            [0, 0],
            [0.2, 0.0],
            [0.275, 0.05],
            [0.3, 0.19],
            [0.275, 0.38],
            [0.2, 0.52],
            [0.1, 0.61],
            [0.062, 0.645],
            [0.06, 0.672],
            [0.1, 0.715],
            [0.125, 0.755],
            [0.08, 0.75],
            [0, 0.72],
          ],
          RAD
        )
      );
      deform(g, (p, n, i) => {
        const col = (i % (RAD + 1)) % RAD,
          row = Math.floor(i / (RAD + 1));
        if (row >= 9 && row <= 11) {
          const s = col % 2 ? 1.22 : 0.8;
          p.x *= s;
          p.z *= s;
          p.y += col % 2 ? 0.012 : -0.008;
        }
        p.z *= 0.92;
        p.x += 0.24 * p.y * p.y;
      });
      seamNormals(g, RAD);
      b.add(paint(g, burlap((q) => (q.y > 0.735 && Math.hypot(q.x - 0.13, q.z) < 0.09 ? 0.7 : 0))));
      const lean = (y) => 0.24 * y * y;
      const tie = torus(0.066, 0.011, 4, 9);
      tie.rotateZ(-0.3);
      tie.translate(lean(0.66), 0.66, 0);
      const end = tube(
        [
          [lean(0.66) + 0.06, 0.66, 0.03],
          [lean(0.66) + 0.11, 0.62, 0.06],
          [lean(0.66) + 0.12, 0.52, 0.07],
        ],
        0.008,
        4,
        { samples: 4 }
      );
      b.add(paint(merge(paint(tie, {}), paint(end, {})), { color: (q) => _c.set(PAL.rope).multiplyScalar(0.6 + 0.3 * Math.sin((q.x + q.y + q.z) * 240)), rough: 0.95, metal: 0, mat: MAT.CLOTH }));
      b.cylCollider(0.035, 0.38, 0, 0.32, 0.76);
    } else if (v === 1) {
      // open, the mouth rolled down, half full of grey salt
      const g = lumpy(
        lathe(
          [
            [0, 0],
            [0.21, 0],
            [0.29, 0.05],
            [0.315, 0.2],
            [0.3, 0.36],
            [0.272, 0.455],
            [0.292, 0.495],
            [0.275, 0.532],
            [0.243, 0.52],
            [0.225, 0.47],
            [0, 0.46],
          ],
          RAD
        ),
        0.02
      );
      seamNormals(g, RAD);
      b.add(paint(g, burlap()));
      const heap = dome(0.232, 11, 3, 0.48);
      deform(heap, (p) => {
        p.y *= 0.8 + 0.5 * nz.n2(p.x * 8, p.z * 8);
      });
      heap.translate(0.01, 0.455, 0);
      const spill = dome(0.13, 8, 2, 0.14);
      spill.scale(1, 1, 0.75);
      spill.translate(0.33, 0, 0.14);
      const cS = new THREE.Color(PAL.salt);
      b.add(
        paint(merge(paint(heap, {}), paint(spill, {})), {
          color: (q) => _c.copy(cS).multiplyScalar(0.5 + 0.28 * (nz.fbm3(q.x * 22, q.y * 22, q.z * 22, 2) * 0.5 + 0.5)),
          rough: 0.9,
          metal: 0,
          mat: MAT.PLAIN,
        })
      );
      // a scoop left standing in it
      const handle = cyl(0.012, 0.014, 0.24, 6);
      handle.translate(0, 0.12, 0);
      const bowl = box(0.07, 0.09, 0.05);
      bowl.translate(0, -0.03, 0);
      const sc = merge(paint(handle, woodSpec(PAL.woodLight, 4, { worn: 0.5 })), paint(bowl, woodSpec(PAL.woodLight, 5, { worn: 0.5 })));
      sc.rotateZ(-0.5);
      sc.rotateY(0.6);
      sc.translate(-0.05, 0.56, 0.03);
      b.add(sc);
      b.cylCollider(0, 0.29, 0, 0.325, 0.58);
    } else {
      // fallen on its side, the mouth open and the charcoal out across the floor
      const g = lumpy(
        lathe(
          [
            [0, 0],
            [0.2, 0],
            [0.27, 0.05],
            [0.29, 0.2],
            [0.265, 0.4],
            [0.21, 0.55],
            [0.16, 0.66],
            [0.15, 0.725],
            [0.128, 0.71],
            [0.11, 0.62],
            [0, 0.56],
          ],
          RAD
        )
      );
      paint(g, burlap((q) => (q.y > 0.55 && Math.hypot(q.x, q.z) < 0.14 ? 0.88 : 0)));
      g.rotateZ(-HALF); // the mouth toward +X
      g.scale(1, 0.72, 1.08);
      g.translate(0, 0.2, 0);
      deform(g, (p) => {
        if (p.y < 0.006) p.y = 0.006;
      });
      seamNormals(g, RAD);
      b.add(g);
      const heap = dome(0.27, 10, 3, 0.2);
      deform(heap, (p) => {
        p.y *= 0.6 + 0.9 * nz.n2(p.x * 9, p.z * 9);
        p.z *= 0.72;
      });
      heap.translate(0.78, 0, 0.02);
      b.add(paint(heap, { color: (q) => _c.set(PAL.char).multiplyScalar(0.7 + 0.9 * (nz.n3(q.x * 30, q.y * 30, q.z * 30) * 0.5 + 0.5)), rough: 1, metal: 0, mat: MAT.PLAIN }));
      const lumps = [];
      for (let i = 0; i < 8; i++) {
        const c = rock(R.range(0.022, 0.045), { seed: 90 + i, detail: 0, rough: 0.3, facet: true });
        const a = R.range(-1.1, 1.1),
          d = R.range(0.06, 0.34);
        c.translate(0.72 + Math.cos(a) * d, 0.02 + (1 - d / 0.34) * 0.035, Math.sin(a) * d * 0.9);
        lumps.push(c);
      }
      b.add(paint(merge(lumps.map((q) => paint(q, {}))), { color: (q) => _c.set(PAL.char).multiplyScalar(0.8 + 0.7 * (q.ny > 0.3 ? 1 : 0.3)), rough: 0.95, metal: 0, mat: MAT.PLAIN }));
      b.boxCollider(0.37, 0.2, 0, 0.38, 0.2, 0.31);
    }
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);

// =============================================================================================
// Book pile
// =============================================================================================
register(
  'bookpile',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(8500 + v * 23);
    const covers = [PAL.clothRed, PAL.clothBlue, PAL.clothBlack, PAL.woodDark, '#3a3324', '#2c3528'];
    const geos = [];
    const lay = (x, y, z, yaw, { w = 0.22 * R.range(0.82, 1.06), d = 0.29 * R.range(0.82, 1.06), t = R.range(0.03, 0.06), tilt = 0, pitch = 0 } = {}) => {
      const g = book(w, d, t, { cover: R.pick(covers), seed: R.int(1, 9999), ribs: 2 });
      if (tilt) g.rotateZ(tilt);
      if (pitch) g.rotateX(pitch);
      g.rotateY(yaw);
      g.translate(x, y, z);
      geos.push(g);
      return t;
    };
    const stub = (x, y, z, h = 0.055) => {
      const c = candle(R, h, 0.018, { drips: 2, pool: true });
      c.geo.translate(x, y, z);
      geos.push(c.geo);
    };

    if (v === 0) {
      // a stack that has begun to go over
      let y = 0;
      for (let i = 0; i < 8; i++) y += lay(y * y * 0.55 + R.range(-0.012, 0.012), y, R.range(-0.012, 0.012), R.range(-0.3, 0.3) + (i % 3 === 0 ? HALF : 0));
      stub(y * y * 0.55 - 0.02, y, 0.01);
      const t1 = lay(0.36, 0, 0.1, 0.5);
      lay(0.38, t1 * 0.5, 0.15, 1.3, { tilt: 0.16 });
      const ob = openBook(0.42, 0.3, { seed: 5, cover: PAL.clothBlack });
      ob.rotateY(-0.5);
      ob.translate(-0.07, 0, 0.37);
      geos.push(ob);
    } else if (v === 1) {
      // two stacks and one leant against them, scrolls on top
      let y = 0;
      for (let i = 0; i < 5; i++) y += lay(-0.14 + R.range(-0.01, 0.01), y, R.range(-0.01, 0.01), R.range(-0.25, 0.25));
      const yA = y;
      y = 0;
      for (let i = 0; i < 3; i++) y += lay(0.13 + R.range(-0.01, 0.01), y, 0.03 + R.range(-0.01, 0.01), HALF + R.range(-0.25, 0.25));
      {
        const w = 0.21,
          t = 0.05;
        const g = book(w, 0.29, t, { cover: PAL.clothRed, seed: 77, ribs: 2 });
        g.translate(-w / 2, 0, 0);
        g.rotateZ(-1.13);
        g.translate(0.345, 0, 0.02);
        geos.push(g);
      }
      const scrolls = [];
      for (let i = 0; i < 3; i++) {
        const s = cyl(0.021, 0.021, R.range(0.25, 0.31), 6);
        s.rotateX(HALF);
        s.rotateY(0.3 + R.range(-0.2, 0.2));
        s.translate(-0.17 + (i % 2) * 0.045 + (i === 2 ? 0.022 : 0), yA + 0.021 + (i === 2 ? 0.037 : 0), 0);
        scrolls.push(s);
      }
      geos.push(paint(merge(scrolls.map((g) => paint(g, {}))), { color: (q) => _c.set(PAL.vellum).multiplyScalar(Math.abs(q.nz) > 0.8 ? 0.45 : 0.82), rough: 0.9, metal: 0, mat: MAT.PLAIN }));
      stub(0.13, y, 0.03, 0.04);
    } else {
      // a heap: swept off a table and never picked up
      const t0 = [];
      [
        [-0.17, -0.1, 0.2],
        [0.15, -0.13, 1.2],
        [0.04, 0.18, -0.5],
        [-0.2, 0.19, 2.1],
      ].forEach(([x, z, yaw]) => t0.push(lay(x, 0, z, yaw)));
      const y1 = Math.max(...t0);
      [
        [-0.04, -0.01, 0.75, 0.13, 0.0],
        [0.13, 0.07, -0.35, -0.1, 0.08],
        [-0.14, 0.09, 1.7, 0.05, -0.12],
      ].forEach(([x, z, yaw, tilt, pitch]) => lay(x, y1 + 0.012, z, yaw, { tilt, pitch }));
      lay(0.02, y1 + 0.075, 0.02, 0.3, { tilt: -0.14 });
      const ob = openBook(0.4, 0.29, { seed: 9, cover: '#2c3528' });
      ob.rotateZ(0.12);
      ob.rotateY(-0.8);
      ob.translate(-0.02, y1 + 0.135, 0.0);
      geos.push(ob);
      // one on its own, face down and spine up
      {
        const w = 0.2,
          dd = 0.27;
        for (const s of [-1, 1]) {
          const g = book(w, dd, 0.016, { cover: PAL.clothBlue, seed: 31 + s });
          g.translate(w / 2, 0, 0);
          g.rotateZ(s > 0 ? -0.87 : Math.PI + 0.87);
          g.translate(0, w * Math.sin(0.87) + 0.012, 0);
          g.rotateY(0.9);
          g.translate(0.4, 0, 0.26);
          geos.push(g);
        }
      }
    }
    b.add(geos);
    const bb = boundsOf(geos);
    b.boxCollider((bb.max.x + bb.min.x) / 2, bb.max.y / 2, (bb.max.z + bb.min.z) / 2, (bb.max.x - bb.min.x) / 2, bb.max.y / 2, (bb.max.z - bb.min.z) / 2);
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);

// =============================================================================================
// Where a note is found
// =============================================================================================
/** A written sheet with a pebble on one corner, lying on y = 0 about the origin. */
function note(seed, R) {
  const s = sheet(0.2, 0.27, { seed, curl: 0.02, lines: 7 });
  const peb = rock(0.032, { seed: seed + 40, detail: 1, rough: 0.2, squash: [1, 0.6, 0.85] });
  peb.translate(0.055, 0.02, -0.085);
  return merge(s, paint(peb, stoneSpec(PAL.stoneDark, seed, 1.1)));
}
/** A leather satchel standing on y = 0: 0.3 wide (X), 0.21 tall, front toward +Z. */
function satchel(R, { open = false, seed = 1 } = {}) {
  const out = [];
  const g = new THREE.BoxGeometry(0.3, 0.21, 0.09, 3, 3, 1);
  g.translate(0, 0.105, 0);
  deform(g, (p) => {
    const u = clamp(p.y / 0.21, 0, 1);
    const bulge = Math.sin(u * Math.PI);
    p.z *= 0.72 + 0.5 * bulge;
    p.x *= 0.93 + 0.09 * bulge;
    p.y += 0.008 * Math.sin(p.x * 21 + seed);
  });
  out.push(paint(g, LEATHER('#3a2a1e', seed)));
  // the flap: over the top and down the front, or thrown back
  const path = open
    ? [
        [0.195, -0.048],
        [0.27, -0.058],
        [0.35, -0.05],
        [0.415, -0.056],
      ]
    : [
        [0.192, -0.05],
        [0.219, -0.012],
        [0.21, 0.04],
        [0.17, 0.063],
        [0.085, 0.068],
      ];
  const flap = ribbon(path, 0.31, { double: true });
  out.push(paint(flap, LEATHER('#33241a', seed + 3)));
  if (!open) {
    const tab = box(0.03, 0.075, 0.007);
    tab.translate(0, 0.085, 0.071);
    out.push(paint(tab, LEATHER('#281c14', seed + 5)));
    const buckle = box(0.042, 0.032, 0.006);
    buckle.translate(0, 0.075, 0.076);
    out.push(dim(paint(buckle, brassSpec(seed)), 0.6));
  }
  // the strap, slack
  const strap = tube(
    [
      [-0.145, 0.19, 0],
      [-0.2, 0.13, 0.05],
      [-0.23, 0.02, 0.15],
      [-0.08, 0.012, 0.25],
      [0.13, 0.012, 0.21],
      [0.215, 0.07, 0.09],
      [0.145, 0.19, 0],
    ],
    0.0075,
    3,
    { samples: 12, caps: false }
  );
  out.push(paint(strap, LEATHER('#2a1d15', seed + 7)));
  return merge(out);
}
register(
  'lore_page',
  (seed = 1) => {
    const v = variantOf(seed, 3);
    const b = new Builder();
    const R = new Rng(9900 + v * 29);
    let page = [0, 0.3, 0];
    const stubAt = (x, y, z, h = 0.05) => {
      const c = candle(R, h, 0.018, { drips: 2, pool: true });
      c.geo.translate(x, y - 0.003, z);
      b.add(c.geo);
    };

    if (v === 0) {
      // a flat rock
      const stone = rock(0.5, { seed: 31, detail: 2, rough: 0.13, squash: [1, 0.36, 0.78], facet: true });
      stone.translate(0, 0.1, 0);
      paint(stone, stoneSpec(PAL.stone, 12, 0.9));
      tint(stone, (q) => (q.y < 0.05 ? 0.6 : 1) * (q.ny > 0.7 ? 1.08 : 0.9));
      b.add(stone);
      const y = topAt(stone, 0.02, 0.03, 0.14) + 0.002;
      const n = note(1, R);
      n.rotateY(0.35);
      n.translate(0.02, y, 0.03);
      b.add(n);
      page = [0.02, y + 0.01, 0.03];
      stubAt(-0.17, topAt(stone, -0.17, -0.08, 0.1), -0.08, 0.06);
      const sa = satchel(R, { seed: 2 });
      sa.rotateX(-0.42);
      sa.rotateY(2.3);
      sa.translate(0.47, -0.01, -0.3);
      b.add(sa);
      b.cylCollider(0, 0.1, 0, 0.4, 0.26);
    } else if (v === 1) {
      // a three-legged stool that has lost a leg; a billet of firewood stands in for it
      const RAD = 10;
      const SEAT = 0.44;
      const wood = [];
      const seat = flat(
        hewn(
          lathe(
            [
              [0, SEAT - 0.042],
              [0.18, SEAT - 0.042, 'hard'],
              [0.2, SEAT - 0.03],
              [0.2, SEAT - 0.008, 'hard'],
              [0.188, SEAT, 'hard'],
              [0, SEAT],
            ],
            RAD
          ),
          RAD,
          { amp: 0.006, freq: 6, seed: 2 }
        )
      );
      wood.push(paint(seat, woodSpec(PAL.wood, 14, { worn: 0.6 })));
      for (let i = 0; i < 3; i++) {
        const a = HALF + (i * TAU) / 3 + 0.2;
        const cx = Math.cos(a),
          cz = Math.sin(a);
        const broken = i === 2;
        const y0 = broken ? SEAT - 0.19 : -0.09;
        const f = (SEAT - 0.04 - y0) / (SEAT - 0.04);
        const leg = tube(
          [
            [cx * 0.115, SEAT - 0.04, cz * 0.115],
            [cx * (0.115 + 0.1 * f), y0, cz * (0.115 + 0.1 * f)],
          ],
          (t) => 0.02 + 0.006 * t,
          6
        );
        wood.push(paint(leg, woodSpec(PAL.woodDark, 20 + i, { worn: 0.4 })));
        if (broken) {
          const sp = cone(0.016, 0.07, 4);
          sp.rotateZ(Math.PI);
          sp.rotateX(0.25 * cz);
          sp.rotateZ(-0.25 * cx);
          sp.translate(cx * (0.115 + 0.1 * f) + 0.004, y0 - 0.03, cz * (0.115 + 0.1 * f));
          wood.push(paint(sp, woodSpec(PAL.woodLight, 9, { worn: 0.1 })));
          // the billet under that corner
          const lg = logGeo(SEAT - 0.02, 0.062, { seed: 5, radial: 7 });
          lg.translate(Math.cos(a + 0.55) * 0.118, -0.022, Math.sin(a + 0.55) * 0.118);
          wood.push(lg);
          // and the rest of the leg on the ground
          const rest = tube(
            [
              [0, 0, 0],
              [0.24, 0.006, 0],
            ],
            (t) => 0.022 + 0.004 * t,
            6
          );
          const rg = paint(rest, woodSpec(PAL.woodDark, 33, { worn: 0.4 }));
          rg.rotateY(0.8);
          rg.translate(cx * 0.33 - 0.1, 0.022, cz * 0.33);
          wood.push(rg);
        }
      }
      b.add(wood);
      const n = note(2, R);
      n.rotateY(-0.5);
      n.translate(-0.02, SEAT, 0.01);
      b.add(n);
      page = [-0.02, SEAT + 0.01, 0.01];
      stubAt(0.1, SEAT, -0.11, 0.045);
      const sa = satchel(R, { seed: 4 });
      sa.rotateX(-0.3);
      sa.rotateY(-0.5);
      sa.translate(-0.24, -0.008, 0.31);
      b.add(sa);
      b.cylCollider(0, SEAT / 2, 0, 0.21, SEAT);
    } else {
      // a satchel left open on a slab, the page half out of it
      const slab = rock(0.4, { seed: 44, detail: 1, rough: 0.1, squash: [1, 0.16, 0.74], facet: true });
      slab.translate(0, 0.035, 0);
      b.add(paint(slab, stoneSpec(PAL.stoneWarm, 15, 0.85)));
      const y = boundsOf([slab]).max.y - 0.008;
      const sa = satchel(R, { open: true, seed: 6 });
      sa.rotateX(-HALF + 0.12); // on its back, the mouth toward -Z
      sa.rotateY(-HALF - 0.3); // ...then toward +X
      sa.translate(-0.23, y + 0.05, 0.0);
      b.add(sa);
      const n = note(3, R);
      n.rotateZ(-0.04);
      n.rotateY(1.25);
      n.translate(0.13, y + 0.012, 0.05);
      b.add(n);
      page = [0.13, y + 0.022, 0.05];
      stubAt(0.0, y, -0.17, 0.04);
    }
    b.anchor('page', page[0], page[1], page[2]);
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);
