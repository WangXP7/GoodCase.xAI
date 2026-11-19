// The shell of a round tower, and the belfry that the lake took.
import { Builder, Rng, Noise, MAT, PAL, THREE, paint, xf, col, mixc, lathe, TAU } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, weathering, courses, courseLevels, cut, prune, masonry, archOpening, rectOpening, dressArch, fallen, deadIvy, prismFaces, timber, iron, aim } from './_shared.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

register(
  'ruin_tower',
  (seed) => {
    const R = new Rng(seed * 419 + 9);
    const nz = new Noise(seed * 29 + 2);
    const b = new Builder();
    const T = new Tris();
    const R0 = 3.0,
      thick = 0.8,
      L = TAU * R0;
    // the wall is laid out flat: u runs round the outside, v up, w through the wall. The foot is battered.
    const batter = (v) => 0.16 * clamp01(1 - v / 1.9);
    const map = (u, v, w) => {
      const th = u / R0;
      const rr = R0 + w + (w > -thick * 0.5 ? batter(v) : 0);
      return V3(Math.sin(th) * rr, v, Math.cos(th) * rr);
    };
    const shade = weathering({ seed: seed + 13, moss: 0.7, mossTop: 1.8, lichen: 0.45 });
    // broken on a diagonal: highest toward a0, lowest opposite. The doorway (u = 0) keeps its head.
    const a0 = R.range(-1.4, 1.4);
    const top = (u) => {
      const th = u / R0;
      return 6.55 + 3.25 * Math.cos(th - a0) + nz.fbm2(Math.cos(th) * 2.2 + 5, Math.sin(th) * 2.2, 3) * 0.55;
    };
    const door = archOpening(0, 0.62, 0, 1.62, 1);
    const ops = [door];
    const wrapU = (th) => {
      let t = th % TAU;
      if (t > Math.PI) t -= TAU;
      if (t < -Math.PI) t += TAU;
      return t * R0;
    };
    for (const [th, sill] of [
      [a0 + R.range(-0.35, 0.35), 5.7],
      [a0 + 1.9, 2.9],
      [a0 - 2.0, 2.9],
      [a0 + 0.95, 3.1],
    ]) {
      const u = wrapU(th);
      if (Math.abs(u) < 1.7 || top(u) < sill + 2.0) continue;
      ops.push(rectOpening(u, 0.085, sill, sill + 1.15));
    }

    const foot = courses({ u0: -L / 2, u1: L / 2, v0: -1.5, v1: 0.4, course: [0.4, 0.5], len: [0.8, 1.3], rng: R, wrap: true, breaks: [0] });
    cut(foot, [door], { wrapL: L });
    masonry(T, foot, {
      map,
      wF: 0.07,
      wB: -thick,
      rng: R,
      shadeAt: shade,
      wrapL: L,
      back: (c) => c.v0 >= -0.01,
      detail: (c) => (c.v1 <= 0.01 ? 'plain' : 'pillow'),
      chip: 0,
      ridge: false,
      base: -1.5,
    });

    const rows = courses({ u0: -L / 2, u1: L / 2, v0: 0.4, v1: 10.6, course: [0.33, 0.43], len: [0.7, 1.15], rng: R, wrap: true, breaks: ops.flatMap((o) => [o.sill, o.spring]) });
    cut(rows, ops, { wrapL: L });
    prune(rows, (c, um, vm) => vm < top(um));
    masonry(T, rows, { map, wF: 0, wB: -thick, rng: R, shadeAt: shade, wrapL: L, back: (c) => (c.v0 < 3.4 ? true : 'plain'), base: 0.4, pockets: 0.03, debris: 0.25 });
    dressArch(T, map, door, { wF: 0, wB: -thick, rng: R, shadeAt: shade, depth: 0.36 });

    // what came down: a spill outside the low side, a heap inside
    const spots = [];
    for (let i = 0; i < 15; i++) {
      const th = a0 + Math.PI + R.range(-1.2, 1.2),
        d = R0 + R.range(0.45, 2.6);
      spots.push([Math.sin(th) * d, Math.cos(th) * d]);
    }
    for (let i = 0; i < 11; i++) {
      const th = a0 + Math.PI + R.range(-1.6, 1.6),
        d = R.range(0.2, 1.9);
      spots.push([Math.sin(th) * d, Math.cos(th) * d]);
    }
    fallen(T, R, spots, { shadeAt: shade, size: [0.3, 0.72] });

    b.add(T.build());
    b.add(deadIvy(R, { map, w: 0.03, u0: (a0 - 0.9) * R0, u1: (a0 + 0.9) * R0, top, n: 4 }));

    // a ring of eight boxes, the doorway left open between the first and the last
    const gap = 0.62 / R0 + 0.035,
      span = (TAU - 2 * gap) / 8;
    for (let i = 0; i < 8; i++) {
      const th = gap + (i + 0.5) * span;
      let h = 0;
      for (const k of [-0.4, 0, 0.4]) h += top((th + k * span) * R0) / 3;
      const rc = R0 - thick / 2 + 0.06;
      b.boxCollider(Math.sin(th) * rc, (h - 1.5) / 2, Math.cos(th) * rc, (R0 + 0.16) * Math.tan(span / 2), (h + 1.5) / 2, thick / 2 + 0.1, th);
    }
    return b.build();
  },
  { kind: 'structure' }
);

// ---------------------------------------------------------------------------------------------
// The drowned belfry. Origin on the lake bed; the lowest six metres stand under water.
// It leans toward +X. The bell hangs plumb on an axle that runs along Z.
// ---------------------------------------------------------------------------------------------
register(
  'bell_tower',
  (seed) => {
    const R = new Rng(seed * 733 + 3);
    const nz = new Noise(seed * 37 + 11);
    const b = new Builder();
    const T = new Tris();
    const LEAN = 0.095;
    const cl = Math.cos(LEAN),
      sl = Math.sin(LEAN);
    const post = (p) => {
      const x = p.x * cl + p.y * sl;
      p.y = -p.x * sl + p.y * cl;
      p.x = x;
      return p;
    };
    const half = 2.2,
      thick = 0.62,
      side = 2 * half,
      per = 4 * side,
      WATER = 6;
    const shade = weathering({ seed: seed + 3, moss: 0.55, mossTop: 1.3, ground: WATER + 0.1, lichen: 0.4, water: WATER + 0.3 });

    // the broken top, as one profile round the four faces so they agree at the corners
    const s0 = side * (1 + (seed % 2));
    const dper = (a, c) => {
      const d = (((a - c) % per) + per) % per;
      return Math.min(d, per - d);
    };
    const topP = (s) => {
      let pin = 0;
      for (let k = 0; k < 4; k++) pin = Math.max(pin, 1 - dper(s, k * side) / 0.42);
      const br = 3.3 * Math.exp(-Math.pow(dper(s, s0) / 1.7, 2));
      const n = nz.fbm2(s * 0.9, 3.7, 3) * 0.5 + nz.n2(s * 2.7, 9.1) * 0.25;
      return 15.7 + pin * 0.5 - br - Math.max(0, n - 0.08) * 1.5;
    };

    const lower = courseLevels({ v0: -1.5, v1: 5.4, course: [0.5, 0.66], rng: R });
    const upper = courseLevels({ v0: 5.4, v1: 16.5, course: [0.36, 0.46], rng: R, breaks: [9.5, 9.74, 10.5, 12.3, 14.5, 14.74] });
    const inBand = (v) => (v > 9.5 && v < 9.74) || (v > 14.5 && v < 14.74);
    const op = archOpening(0, 1.0, 10.5, 12.3, 1);

    // a stepped plinth on the lake bed
    for (const f of prismFaces(-2.5, 2.5, -2.5, 2.5, post)) {
      const rows = courses({ u0: -2.5, u1: 2.5, v0: -1.5, v1: 1.15, course: [0.5, 0.66], len: [0.9, 1.5], rng: R });
      masonry(T, rows, { map: f.map, wF: 0, wB: -0.45, rng: R, shadeAt: shade, detail: () => 'plain', chip: 0, ridge: false, base: -1.5, solid: (u) => Math.abs(u) > 2.5 });
    }

    prismFaces(-half, half, -half, half, post).forEach((f, k) => {
      const topU = (u) => topP(k * side + u + half);
      const round = (u, v) => (u < -half ? v < topP(k * side - 0.02) : u > half ? v < topP((k + 1) * side + 0.02) : false);
      // under water: big plain blocks
      const low = courses({ u0: -half, u1: half, len: [0.9, 1.5], rng: R, levels: lower });
      masonry(T, low, { map: f.map, wF: 0, wB: -thick, rng: R, shadeAt: shade, detail: () => 'plain', chip: 0, ridge: false, base: -1.5, solid: (u, v) => v > 5.39 || Math.abs(u) > half });

      const slit = k % 2 === seed % 2 ? rectOpening(R.range(-0.5, 0.5), 0.1, 7.2, 8.5) : null;
      const rows = courses({ u0: -half, u1: half, len: [0.6, 1.05], rng: R, levels: upper }).filter((r) => !inBand((r.v0 + r.v1) / 2));
      cut(rows, slit ? [op, slit] : [op]);
      prune(rows, (c, um, vm) => vm < topU(um));
      masonry(T, rows, {
        map: f.map,
        wF: 0,
        wB: -thick,
        rng: R,
        shadeAt: shade,
        back: (c) => (c.v0 > 10.1 ? 'plain' : false),
        base: 5.4,
        pockets: 0.01,
        debris: 0.3,
        solid: (u, v) => round(u, v) || (inBand(v) && Math.abs(u) <= half && v < topU(u)),
      });
      // string course under the belfry, cornice under the parapet
      for (const [va, vb] of [
        [9.5, 9.74],
        [14.5, 14.74],
      ]) {
        const band = courses({ u0: -half - 0.09, u1: half + 0.09, len: [0.9, 1.4], rng: R, levels: [va, vb] });
        prune(band, (c, um, vm) => vm < topU(Math.max(-half, Math.min(half, um))));
        masonry(T, band, { map: f.map, wF: 0.09, wB: -thick, rng: R, shadeAt: shade, chip: 0, ridge: false, solid: (u) => Math.abs(u) > half + 0.09 });
      }
      dressArch(T, f.map, op, { wF: 0, wB: -thick, rng: R, shadeAt: shade, depth: 0.38, n: 5 });
    });

    // inside: the belfry floor, and darkness behind the slits
    const inn = half - thick;
    const dark = col('#0b0c0d'),
      floorC = col(PAL.stoneDark).multiplyScalar(0.6);
    const P = (x, y, z) => post(V3(x, y, z));
    T.quad(P(-inn, 10.2, inn), P(inn, 10.2, inn), P(inn, 10.2, -inn), P(-inn, 10.2, -inn), floorC);
    for (const [ax, az, bx, bz] of [
      [-inn, inn, inn, inn],
      [inn, inn, inn, -inn],
      [inn, -inn, -inn, -inn],
      [-inn, -inn, -inn, inn],
    ])
      T.quad(P(ax, 5.4, az), P(bx, 5.4, bz), P(bx, 10.2, bz), P(ax, 10.2, az), dark);

    // stones on the lake bed
    const spots = [];
    for (let i = 0; i < 9; i++) {
      const th = R.range(0, TAU),
        d = R.range(3.4, 5.2);
      spots.push([Math.cos(th) * d + 0.6, Math.sin(th) * d]);
    }
    fallen(T, R, spots, { shadeAt: shade, size: [0.5, 1.0] });
    b.add(T.build());

    // timber: the bell frame, and what is left of the roof
    const leanGeo = (g) => xf(g, { r: [0, 0, -LEAN] });
    for (const z of [-1.03, 1.03]) b.add(leanGeo(aim(timber(3.5, 0.24, 0.2, { rng: R, color: PAL.woodDark, rot: 0.3 }), [-1.75, 12.84, z], [1.75, 12.84, z])));
    for (let k = 0; k < 4; k++) {
      if (dper(k * side, s0) < 0.1 || R.chance(0.25)) continue;
      const cx = k === 0 || k === 3 ? -1 : 1,
        cz = k === 0 || k === 1 ? 1 : -1; // corner k sits at the start of face k
      const a = [cx * (half - 0.35), 14.8, cz * (half - 0.35)],
        e = [0, 16.9, 0];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]) * R.range(0.45, 0.62);
      b.add(leanGeo(aim(timber(len, 0.16, 0.14, { rng: R, color: PAL.woodGrey, broken: 1, char: 0.25 }), a, e)));
    }

    // the bell: bronze gone green, hung from an oak headstock. Everything in this part turns about the anchor.
    const A = post(V3(0, 13.0, 0));
    const nb = new Noise(seed + 77);
    const bronze = (g) =>
      paint(g, {
        color: (v) => {
          const k = clamp01(0.45 + nb.fbm3(v.x * 2.5, v.y * 0.9, v.z * 2.5, 3) * 0.9 + (v.ny > 0.2 ? 0.25 : 0));
          return mixc(PAL.bronze, PAL.verdigris, k * 0.8).multiplyScalar(0.75);
        },
        rough: 0.58,
        metal: 0.7,
        mat: MAT.METAL,
      });
    const bell = [];
    const outer = lathe(
      [
        [0.76, -1.32, 'hard'],
        [0.78, -1.25],
        [0.66, -1.08],
        [0.5, -0.8],
        [0.43, -0.5],
        [0.4, -0.25],
        [0.36, -0.12, 'hard'],
        [0.22, -0.03],
        [0, 0],
      ],
      14
    );
    const inner = lathe(
      [
        [0, -0.12],
        [0.3, -0.2],
        [0.37, -0.6],
        [0.55, -1.05],
        [0.7, -1.28],
        [0.76, -1.32, 'hard'],
      ],
      14
    );
    for (const g of [outer, inner]) {
      g.translate(A.x, A.y - 0.24, 0);
      bell.push(bronze(g));
    }
    const canons = new THREE.BoxGeometry(0.26, 0.16, 0.22);
    canons.translate(A.x, A.y - 0.2, 0);
    bell.push(bronze(canons));
    bell.push(aim(timber(1.9, 0.34, 0.32, { rng: R, color: PAL.woodDark, rot: 0.2 }), [A.x, A.y + 0.03, -0.95], [A.x, A.y + 0.03, 0.95]));
    for (const z of [-0.3, 0.3]) {
      const strap = new THREE.BoxGeometry(0.37, 0.52, 0.06);
      strap.translate(A.x, A.y - 0.06, z);
      bell.push(iron(strap, R, 0.6));
    }
    for (const z of [-1.04, 1.04]) {
      const pin = new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6);
      pin.rotateX(Math.PI / 2);
      pin.translate(A.x, A.y, z);
      bell.push(iron(pin, R, 0.5));
    }
    const rod = new THREE.BoxGeometry(0.035, 1.0, 0.035);
    rod.translate(0, -0.5, 0);
    const ball = new THREE.IcosahedronGeometry(0.095, 0);
    ball.translate(0, -1.02, 0);
    for (const g of [rod, ball]) {
      xf(g, { t: [A.x, A.y - 0.38, 0], r: [0, 0, 0.07] });
      bell.push(iron(g, R, 0.45));
    }
    b.part('bell', bell);
    b.anchor('bell', A.x, A.y, 0);

    for (const [ya, yb, h] of [
      [-1.5, 4.5, 2.55],
      [4.5, 10.5, 2.3],
      [10.5, 16, 2.3],
    ]) {
      const yc = (ya + yb) / 2;
      b.boxCollider(yc * sl, yc * cl, 0, h + ((yb - ya) / 2) * sl, (yb - ya) / 2, h);
    }
    return b.build();
  },
  { kind: 'structure' }
);
