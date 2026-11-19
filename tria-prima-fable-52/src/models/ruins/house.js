// A burnt-out cottage and a small mausoleum.
import { Builder, Rng, Noise, MAT, PAL, THREE, xf, col, mixc, TAU } from '../kit.js';
import { register } from '../registry.js';
import {
  Tris,
  V3,
  lerp,
  sstep,
  weathering,
  stoneTone,
  courses,
  courseLevels,
  cut,
  prune,
  masonry,
  archOpening,
  rectOpening,
  dressArch,
  fallen,
  wallSpans,
  stoneBlock,
  placed,
  looseStone,
  deadIvy,
  prismFaces,
  timber,
  iron,
  aim,
  dist3,
  stonePaint,
  roughBox,
} from './_shared.js';

register(
  'ruin_house',
  (seed) => {
    const variant = (((seed - 1) % 3) + 3) % 3;
    const R = new Rng(seed * 557 + 21);
    const nz = new Noise(seed * 41 + 6);
    const b = new Builder();
    const T = new Tris();
    const thick = 0.5,
      eaves = 2.3;
    const chimTop = variant === 2 ? 4.9 : 5.55;

    // the fire is remembered inside: soot round the hearth and where the roof timbers burned
    const sootAt = [
      [-2.6, 0.7, 0, 2.1],
      [R.range(-1.5, 1.5), 1.9, 1.9, 1.3],
      [R.range(-1.5, 1.5), 1.9, -1.9, 1.3],
      [2.3, 1.6, R.range(-1, 1), 1.2],
      [-2.8, chimTop, 0, 0.9],
    ];
    const shadeOut = weathering({ seed: seed + 9, moss: 0.75, mossTop: 1.5, lichen: 0.4, sootAt: [sootAt[4]] });
    const shadeIn = weathering({ seed: seed + 9, moss: 0.45, mossTop: 0.9, lichen: 0.15, sootAt, soot: 0.9 });
    const shade = (p, c, up) => (p.x > -2.97 && p.x < 2.52 && Math.abs(p.z) < 2.02 ? shadeIn(p, c, up) : shadeOut(p, c, up));

    const gable = (u) => eaves + Math.max(0, 2.5 - Math.abs(u)) * 0.96;
    const rag = (k, u) => nz.fbm2(u * 0.9 + k * 13.1, seed * 1.7, 3) * 0.45 + nz.n2(u * 3.1, k * 7.7) * 0.15;
    // faces: 0 front (+Z, u = x), 1 gable (+X, u = -z), 2 back (-Z, u = -x), 3 chimney gable (-X, u = z)
    let tops;
    if (variant === 0)
      tops = [
        (u) => eaves - sstep(0.7, 1.6, u) * 1.3 + rag(0, u) * 0.5,
        (u) => gable(u) - Math.max(0, rag(1, u)) * 0.8 - sstep(0.3, 2.3, u) * 1.0,
        (u) => eaves - 1.5 * Math.exp(-Math.pow((u + 1.1) / 0.8, 2)) + rag(2, u) * 0.4,
        (u) => gable(u) - Math.max(0, rag(3, u)) * 0.45,
      ];
    else if (variant === 1)
      tops = [
        (u) => lerp(eaves, 1.0, sstep(-1.6, 2.6, u)) + rag(0, u) * 0.5,
        (u) => 1.25 + rag(1, u) * 0.7,
        (u) => lerp(1.0, eaves, sstep(-2.6, 1.6, u)) + rag(2, u) * 0.5 - 0.9 * Math.exp(-Math.pow((u + 0.4) / 0.6, 2)),
        (u) => gable(u) - Math.max(0, rag(3, u)) * 0.6 - sstep(0.4, 2.4, -u) * 1.3,
      ];
    else
      tops = [
        (u) => 1.35 + rag(0, u) * 0.9 - sstep(0.5, 2.6, u) * 0.7,
        (u) => 0.9 + rag(1, u) * 0.8,
        (u) => 1.15 + rag(2, u) * 0.9,
        (u) => 1.5 + rag(3, u) * 0.6 + 2.5 * Math.exp(-Math.pow(u / 0.95, 2)),
      ];

    const door = rectOpening(-0.9, 0.48, 0, 1.95);
    const hearth = rectOpening(0, 0.45, 0, 1.05);
    const ops = [[door, rectOpening(1.55, 0.3, 1.0, 1.75)], variant === 0 ? [rectOpening(0, 0.24, 3.0, 3.7)] : [], [rectOpening(1.3, 0.3, 1.0, 1.75)], [hearth]];
    const inStack = (u, v) => Math.abs(u) < 0.42 && v > 2.4 && v < chimTop;

    const levels = courseLevels({ v0: -0.8, v1: 5.3, course: [0.24, 0.33], rng: R, breaks: [0, 1.0, 1.05, 1.75, 1.95, 3.0, 3.7] });
    const faces = prismFaces(-3, 3, -2.5, 2.5);
    const ends = [3, 2.5, 3, 2.5];
    const rowsOf = faces.map((f, k) => {
      const rows = courses({ u0: -ends[k], u1: ends[k], len: [0.38, 0.8], rng: R, levels });
      cut(rows, ops[k]);
      prune(rows, (c, um, vm) => vm < tops[k](um) && !(k === 3 && inStack(um, vm)));
      return rows;
    });
    const tone = (c, rng) => stoneTone(rng, { base: PAL.stone, warm: 0.45, vary: 0.2 });
    faces.forEach((f, k) => {
      const hl = ends[k],
        prev = (k + 3) % 4,
        next = (k + 1) % 4;
      masonry(T, rowsOf[k], {
        map: f.map,
        wF: 0,
        wB: -thick,
        rng: R,
        shadeAt: shade,
        back: true,
        detail: (c) => (c.v1 <= 0.01 ? 'plain' : 'pillow'),
        base: -0.8,
        tone,
        bump: 0.022,
        bevel: 0.034,
        pockets: 0.03,
        debris: 0.3,
        chip: 0.5,
        solid: (u, v) => (u < -hl ? v < tops[prev](ends[prev] - 0.25) : u > hl ? v < tops[next](-ends[next] + 0.25) : k === 3 && inStack(u, v)),
      });
    });

    // lintels: stone over the door and the windows where the wall still stands that high, and over the hearth
    const lintel = (k, cu, v, half, h = 0.24) => {
      if (tops[k](cu) < v + h + 0.1) return false;
      stoneBlock(
        T,
        faces[k].map,
        [
          [cu - half, v],
          [cu + half, v],
          [cu + half, v + h],
          [cu - half, v + h],
        ],
        0.02,
        -thick - 0.02,
        { rng: R, color: stoneTone(R, { base: PAL.stoneLight, vary: 0.08 }), shadeAt: shade, front: true, back: true, sides: [true, false, false, false] }
      );
      return true;
    };
    const doorHead = lintel(0, -0.9, 1.95, 0.74);
    lintel(0, 1.55, 1.75, 0.5, 0.2);
    lintel(2, 1.3, 1.75, 0.5, 0.2);
    stoneBlock(
      T,
      faces[3].map,
      [
        [-0.74, 1.05],
        [0.74, 1.05],
        [0.74, 1.3],
        [-0.74, 1.3],
      ],
      0,
      -thick - 0.04,
      { rng: R, color: col(PAL.stoneDark), shadeAt: shade, front: false, back: true, sides: [true, false, false, false] }
    );

    // the chimney: a breast built against the gable outside, a stack above
    const f3 = faces[3];
    const breast = courses({ u0: -0.62, u1: 0.62, v0: -0.6, v1: 2.4, course: [0.24, 0.33], len: [0.35, 0.7], rng: R });
    masonry(T, breast, {
      map: (u, v, w) => f3.map(u, v, w + 0.16),
      wF: 0,
      wB: -0.22,
      rng: R,
      shadeAt: shade,
      tone,
      chip: 0,
      ridge: false,
      base: -0.6,
      back: (c) => (c.v0 >= -0.01 && c.v1 < 1.4 ? 'plain' : false),
      solid: (u, v) => v > 2.39 && Math.abs(u) < 0.42,
    });
    const hideBelow = Math.max(2.4, tops[3](0.42) - 0.45);
    const sLevels = courseLevels({ v0: 2.4, v1: chimTop, course: [0.22, 0.3], rng: R });
    prismFaces(-3.16, -2.42, -0.42, 0.42).forEach((f, k) => {
      const rows = courses({ u0: f.u0, u1: f.u1, len: [0.3, 0.6], rng: R, levels: sLevels });
      if (k === 0 || k === 2) prune(rows, (c) => c.v1 > hideBelow);
      if (variant === 2) prune(rows, (c, um, vm) => vm < chimTop - 0.5 + nz.n2(um * 3 + k * 5, 1.5) * 0.45);
      masonry(T, rows, { map: f.map, wF: 0, wB: -0.2, rng: R, shadeAt: shade, tone, base: 2.4, chip: variant === 2 ? 0.5 : 0.25, debris: 0, solid: (u) => u < f.u0 || u > f.u1 });
    });
    const sootC = col(PAL.soot);
    T.quad(V3(-2.96, chimTop - 0.55, 0.22), V3(-2.62, chimTop - 0.55, 0.22), V3(-2.62, chimTop - 0.55, -0.22), V3(-2.96, chimTop - 0.55, -0.22), sootC);

    // what fell
    const spots = [];
    for (let i = R.int(14, 18); i > 0; i--) {
      const k = R.int(0, 3),
        f = faces[k];
      let u = R.range(-ends[k], ends[k]);
      for (let j = 0; j < 2; j++) {
        const u2 = R.range(-ends[k], ends[k]);
        if (tops[k](u2) < tops[k](u)) u = u2;
      }
      const p = f.map(u, 0, R.chance(0.5) ? R.range(0.3, 1.3) : -thick - R.range(0.25, 1.1));
      spots.push([p.x, p.z]);
    }
    fallen(T, R, spots, { shadeAt: shade, size: [0.22, 0.5], tone: (rng) => stoneTone(rng, { warm: 0.45, vary: 0.2 }) });
    if (!doorHead) {
      // the door lintel lies where it dropped
      placed(T, [-0.9 + R.range(-0.2, 0.2), 0.1, 2.5 + R.range(0.5, 0.9)], [0.1, R.range(-0.5, 0.5), 0.12], () =>
        looseStone(T, 1.45, 0.24, 0.5, { rng: R, color: stoneTone(R, { base: PAL.stoneLight, vary: 0.08 }), shadeAt: shade, j: 0.02, chip: 1 })
      );
    }
    b.add(T.build());

    // charred timber
    const beam = (a, e, w = 0.13, o = {}) => b.add(aim(timber(dist3(a, e), w, w * 0.9, { rng: R, color: PAL.woodDark, char: R.range(0.7, 0.95), ...o }), a, e));
    const ridgeY = 4.62;
    const rafter = (x, side, frac) => {
      const a = [x, eaves + 0.02, side * 2.2],
        e = [x + R.range(-0.05, 0.05), lerp(eaves, ridgeY, frac), side * 2.2 * (1 - frac)];
      beam(a, e, 0.12, { broken: frac < 0.99 ? 1 : 0 });
    };
    if (variant === 0) {
      rafter(-2.25, 1, 1);
      rafter(-2.25, -1, 1);
      rafter(-1.4, 1, 0.55);
      rafter(-1.4, -1, 1);
      beam([-2.5, ridgeY - 0.06, 0], [-0.7, ridgeY - 0.12, 0.03], 0.14, { broken: 1 });
      beam([-1.4, eaves + 0.05, -2.2], [-1.4, eaves + 0.02, 2.2], 0.15);
      beam([0.3, 0.07, -1.2], [2.0, 0.09, 0.9], 0.13, { broken: 2 });
      beam([1.2, 0.06, -1.9], [0.9, 1.9, -1.95], 0.12, { broken: 1 });
    } else if (variant === 1) {
      rafter(-2.1, 1, 1);
      rafter(-2.1, -1, 0.6);
      beam([-1.2, eaves - 0.2, 2.15], [-0.9, 0.12, 0.2], 0.15, { broken: 1 });
      beam([-1.2, 1.5, -2.15], [-1.0, 0.1, -0.3], 0.15, { broken: 1 });
      beam([0.4, 0.07, 1.4], [2.1, 0.07, -0.6], 0.13, { broken: 2 });
    } else {
      beam([-1.6, 0.07, -1.0], [0.7, 0.08, 1.2], 0.14, { broken: 2 });
      beam([0.9, 0.06, -1.4], [2.0, 0.07, 0.2], 0.12, { broken: 2 });
      beam([-0.4, 0.05, 1.5], [-1.9, 1.0, 1.95], 0.12, { broken: 1 });
    }
    b.add(deadIvy(R, { map: faces[1].map, w: 0.02, u0: -2, u1: 2, top: tops[1], n: 2 }));
    b.add(deadIvy(R, { map: faces[2].map, w: 0.02, u0: -2.6, u1: 2.6, top: tops[2], n: 2 }));

    faces.forEach((f, k) => {
      for (const s of wallSpans(rowsOf[k], { u0: -ends[k], u1: ends[k], step: 0.5, tol: 0.75, floor: -0.5 })) {
        if (s.vb < 0.5) continue;
        const c = f.map((s.ua + s.ub) / 2, (s.va + s.vb) / 2, -thick / 2);
        const hu = (s.ub - s.ua) / 2,
          hv = (s.vb - s.va) / 2;
        if (k % 2 === 0) b.boxCollider(c.x, c.y, c.z, hu, hv, thick / 2 + 0.04);
        else b.boxCollider(c.x, c.y, c.z, thick / 2 + 0.04, hv, hu);
      }
    });
    b.boxCollider(-2.95, chimTop / 2 - 0.25, 0, 0.36, chimTop / 2 + 0.25, 0.62);
    return b.build();
  },
  { kind: 'structure', variants: 3 }
);

// ---------------------------------------------------------------------------------------------
// A small mausoleum: ashlar under a roof of stone slabs, its iron door standing ajar.
// ---------------------------------------------------------------------------------------------
register(
  'crypt',
  (seed) => {
    const R = new Rng(seed * 271 + 13);
    const b = new Builder();
    const T = new Tris();
    const shade = weathering({ seed: seed + 23, moss: 0.6, mossTop: 0.9, lichen: 0.5 });
    const hx = 1.35,
      hz = 1.85,
      eaves = 2.3,
      thick = 0.4;
    const sill = 0.2;
    const out = [];
    const stone = (g, c = null) => out.push(stonePaint(g, { color: c || stoneTone(R, { base: PAL.stone, vary: 0.08 }), shadeAt: shade }));

    // footing, plinth, steps
    let g = roughBox(3.1, 0.8, 4.1, R, 0.03);
    g.translate(0, -0.42, 0);
    stone(g, col(PAL.stoneDark));
    g = roughBox(3.0, 0.22, 4.0, R, 0.02);
    g.translate(0, 0.1, 0);
    stone(g);
    g = roughBox(1.5, 0.15, 0.42, R, 0.02);
    g.translate(0, 0.07, 2.2);
    stone(g);

    const door = archOpening(0, 0.45, sill, 1.55, 1); // apex 2.33
    const tops = [(u) => eaves + (hx - Math.abs(u)) * 0.56, () => eaves, (u) => eaves + (hx - Math.abs(u)) * 0.56, () => eaves];
    const levels = courseLevels({ v0: sill, v1: 3.2, course: [0.32, 0.4], rng: R, breaks: [1.55, eaves] });
    prismFaces(-hx, hx, -hz, hz).forEach((f, k) => {
      const rows = courses({ u0: f.u0, u1: f.u1, len: [0.55, 0.95], rng: R, levels });
      if (k === 0) cut(rows, [door]);
      prune(rows, (c, um) => c.v0 < Math.max(tops[k](c.u0), tops[k](c.u1), tops[k](um)) - 0.03);
      masonry(T, rows, { map: f.map, wF: 0, wB: -thick, rng: R, shadeAt: shade, base: sill, chip: 0, ridge: false, pockets: 0.02, clip: k % 2 ? null : tops[k], solid: (u, v) => u < f.u0 || u > f.u1 || v > tops[k](u) - 0.02 });
      if (k === 0) dressArch(T, f.map, door, { wF: 0, wB: -thick, rng: R, shadeAt: shade, depth: 0.3 });
      if (k % 2) {
        // a cornice along the eaves
        const band = courses({ u0: f.u0 - 0.07, u1: f.u1 + 0.07, len: [0.8, 1.2], rng: R, levels: [eaves - 0.2, eaves] });
        masonry(T, band, { map: f.map, wF: 0.08, wB: -thick, rng: R, shadeAt: shade, chip: 0, ridge: false, solid: (u) => u < f.u0 - 0.07 || u > f.u1 + 0.07 });
      }
    });

    // darkness inside
    const dk = col('#060607');
    const x0 = -hx + thick - 0.02,
      x1 = hx - thick + 0.02,
      z0 = -hz + thick - 0.02,
      z1 = hz - thick + 0.02;
    T.quad(V3(x0, sill, z0), V3(x1, sill, z0), V3(x1, 2.5, z0), V3(x0, sill + 2.3, z0), dk);
    T.quad(V3(x0, sill, z0), V3(x0, sill, z1), V3(x0, 2.5, z1), V3(x0, 2.5, z0), dk);
    T.quad(V3(x1, sill, z0), V3(x1, sill, z1), V3(x1, 2.5, z1), V3(x1, 2.5, z0), dk);
    T.quad(V3(x0, sill + 0.01, z0), V3(x1, sill + 0.01, z0), V3(x1, sill + 0.01, z1 + 0.3), V3(x0, sill + 0.01, z1 + 0.3), col('#141413'));
    T.quad(V3(x0, 2.5, z0), V3(x1, 2.5, z0), V3(x1, 2.5, z1), V3(x0, 2.5, z1), dk);

    // the roof: stone slabs on two slopes, a ridge of saddle stones, one slab gone
    const ridgeY = eaves + hx * 0.56 + 0.1,
      eaveX = hx + 0.17,
      eaveY = eaves - 0.04;
    const slope = Math.atan2(ridgeY - eaveY, eaveX),
      slopeLen = Math.hypot(ridgeY - eaveY, eaveX);
    const lost = R.int(0, 9);
    let n = 0;
    for (const side of [-1, 1]) {
      const w = (2 * hz + 0.24) / 5;
      for (let i = 0; i < 5; i++, n++) {
        const z = -hz - 0.12 + w * (i + 0.5);
        const sl = roughBox(slopeLen + 0.04, 0.1, w - 0.015, R, 0.014);
        const c = mixc(PAL.slate, PAL.stone, R.range(0.25, 0.6)).multiplyScalar(R.range(0.9, 1.08));
        if (n === lost) {
          // slid off and broke on the ground
          const yaw = R.range(-0.4, 0.4);
          for (const [dz, tilt] of [
            [-0.42, 0.5],
            [0.5, 0.06],
          ]) {
            const pc = roughBox(slopeLen * 0.5, 0.1, w - 0.05, R, 0.03);
            xf(pc, { r: [R.range(-0.08, 0.08), yaw + dz, side * tilt], t: [side * (hx + 0.55 + Math.abs(dz) * 0.9), 0.07 + tilt * 0.36, z + dz] });
            stone(pc, c);
          }
          continue;
        }
        xf(sl, { r: [R.range(-0.012, 0.012), 0, -side * slope + R.range(-0.012, 0.012)], t: [side * (eaveX / 2), (ridgeY + eaveY) / 2 + 0.03 + R.range(-0.008, 0.008), z] });
        stone(sl, c);
      }
    }
    for (let i = 0; i < 4; i++) {
      const rs = roughBox(0.34, 0.14, (2 * hz + 0.24) / 4 - 0.02, R, 0.016);
      rs.translate(0, ridgeY + 0.06, -hz - 0.12 + ((2 * hz + 0.24) / 4) * (i + 0.5));
      stone(rs);
    }
    // a plain ball on the gable
    const ball = new THREE.IcosahedronGeometry(0.15, 1);
    ball.translate(0, ridgeY + 0.26, hz + 0.02);
    stone(ball);
    const neck = roughBox(0.2, 0.12, 0.2, R, 0.01);
    neck.translate(0, ridgeY + 0.13, hz + 0.02);
    stone(neck);

    // the iron door, pointed like its arch, hanging open a hand's width on its lower hinge
    const D = new Tris({ mat: MAT.METAL, rough: 0.82, metal: 0.45 });
    const nd = new Noise(seed + 301);
    const dw = 0.86;
    const yTop = (x) => 1.35 + Math.sqrt(Math.max(0, 0.81 - Math.pow(Math.abs(x - dw / 2) + 0.45, 2)));
    const ironC = (x, y) => mixc(PAL.iron, PAL.rust, Math.min(1, Math.max(0, 0.3 + nd.fbm2(x * 4, y * 2.2, 3) * 0.8 - y * 0.12))).multiplyScalar(0.8);
    const swing = [0, -0.6, 0.012],
      hinge = [-dw / 2, sill + 0.02, hz - 0.08];
    placed(D, hinge, swing, () => {
      const xs = [0, 0.11, 0.22, 0.33, 0.43, 0.53, 0.64, 0.75, dw];
      for (let i = 0; i < xs.length - 1; i++) {
        const xa = xs[i],
          xb = xs[i + 1],
          ya = yTop(xa),
          yb = yTop(xb);
        for (const z of [0.016, -0.016]) {
          for (const [y0, y1, k0, k1] of [
            [0, 0.9, 0, 0.9],
            [0.9, 1, 0.9, 1],
          ]) {
            const p = [V3(xa, ya * (y0 === 0 ? 0 : 0.6), z), V3(xb, yb * (y0 === 0 ? 0 : 0.6), z), V3(xb, y1 === 1 ? yb : yb * 0.6, z), V3(xa, y1 === 1 ? ya : ya * 0.6, z)];
            D.quadOut(p[0], p[1], p[2], p[3], V3(0, 0, z), ironC(xa, p[0].y), ironC(xb, p[1].y), ironC(xb, p[2].y), ironC(xa, p[3].y));
          }
        }
        D.quadOut(V3(xa, ya, 0.016), V3(xb, yb, 0.016), V3(xb, yb, -0.016), V3(xa, ya, -0.016), V3(0, 1, 0), ironC(xa, ya).multiplyScalar(0.7));
      }
      D.quadOut(V3(dw, 0, 0.016), V3(dw, yTop(dw), 0.016), V3(dw, yTop(dw), -0.016), V3(dw, 0, -0.016), V3(1, 0, 0), ironC(dw, 0.5).multiplyScalar(0.7));
    });
    b.add(D.build());
    const fit = (q) => xf(xf(q, { r: swing }), { t: hinge });
    for (const y of [0.28, 0.95, 1.5]) {
      const strap = new THREE.BoxGeometry(dw + 0.02, 0.075, 0.05);
      strap.translate(dw / 2, y, 0);
      b.add(iron(fit(strap), R, 0.35));
    }
    const ring = new THREE.TorusGeometry(0.055, 0.009, 4, 10);
    ring.translate(dw - 0.14, 0.98, 0.034);
    b.add(iron(fit(ring), R, 0.4));

    const spots = [];
    for (let i = 0; i < 6; i++) spots.push([R.sign() * R.range(hx + 0.3, hx + 1.1), R.range(-hz, hz + 0.6)]);
    fallen(T, R, spots, { shadeAt: shade, size: [0.16, 0.36] });
    b.add(T.build(), out);
    b.add(deadIvy(R, { map: (u, v, w) => V3(hx + w, v, -u), w: 0.02, u0: -hz + 0.3, u1: hz - 0.3, top: () => 2.6, n: 3 }));
    b.boxCollider(0, 1.45, 0, 1.52, 1.75, 2.02);
    return b.build();
  },
  { kind: 'structure' }
);
