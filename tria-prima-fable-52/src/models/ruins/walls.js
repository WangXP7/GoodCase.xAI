// Free-standing masonry: a run of broken wall, a lone arch, broken columns.
import { Builder, Rng, Noise, PAL, THREE, xf, lathe, disc, flat, TAU } from '../kit.js';
import { register } from '../registry.js';
import {
  Tris,
  V3,
  lerp,
  sstep,
  weathering,
  stoneTone,
  courses,
  cut,
  prune,
  masonry,
  archOpening,
  voussoirs,
  fallen,
  wallSpans,
  stoneBlock,
  placed,
  looseStone,
  deadIvy,
  stonePaint,
  roughBox,
} from './_shared.js';

const flatMap = (u, v, w) => V3(u, v, w);

/** Long-and-short dressed stones up one jamb of an opening. dir = +1 right jamb, -1 left. */
function jambStones(T, map, op, dir, { wF, wB, rng, shadeAt, from = null }) {
  let v = from === null ? op.sill : from,
    long = rng.chance(0.5);
  while (v < op.spring - 1e-3) {
    let h = rng.range(0.3, 0.44);
    if (v + h > op.spring - 0.16) h = op.spring - v;
    const l = long ? rng.range(0.4, 0.52) : rng.range(0.24, 0.3);
    const ua = op.cu + dir * (op.a - 0.018),
      ub = op.cu + dir * (op.a + l);
    stoneBlock(
      T,
      map,
      [
        [ua, v],
        [ub, v],
        [ub, v + h],
        [ua, v + h],
      ],
      wF + 0.03,
      wB - 0.03,
      { rng, color: stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }), shadeAt, front: true, back: true, sides: [false, false, false, true], joint: 0.018, bevel: 0.03, bump: 0.008 }
    );
    v += h;
    long = !long;
  }
}

register(
  'ruin_wall',
  (seed) => {
    const variant = (((seed - 1) % 5) + 5) % 5;
    const R = new Rng(seed * 977 + 31);
    const nz = new Noise(seed * 17 + 3);
    const b = new Builder();
    const T = new Tris();
    const len = [6.0, 6.2, 7.0, 5.2, 6.4][variant];
    const thick = 0.72,
      wF = thick / 2,
      wB = -thick / 2;
    const u0 = -len / 2,
      u1 = len / 2;
    const shade = weathering({ seed: seed + 40, moss: 0.75, mossTop: 1.7, lichen: 0.4 });
    const rag = (u) => nz.fbm2(u * 0.9, seed * 3.1, 3) * 0.55 + nz.n2(u * 3.3, 7) * 0.18;

    let top; // (u) => height of the broken top
    let maxH;
    const ops = []; // openings
    const dressed = []; // [{ op, flanks }]
    let keepExtra = null;
    if (variant === 0) {
      // a gable-high end falling away in steps to a stump
      maxH = 4.7;
      top = (u) => lerp(4.7, 0.9, Math.pow(sstep(u0 + 0.6, u1 - 0.2, u), 0.8)) + rag(u);
    } else if (variant === 1) {
      // a pointed window, the wall above it gone on one side
      maxH = 4.9;
      const op = archOpening(0.25, 0.55, 1.45, 2.85, 1);
      ops.push(op);
      dressed.push({ op, flanks: [false, true] });
      top = (u) => lerp(4.8, 2.3, sstep(0.5, u1, u)) + rag(u) * 0.9 - sstep(u0 + 1.0, u0, u) * 2.2;
    } else if (variant === 2) {
      // long and low, breached
      maxH = 2.9;
      const bx = R.range(0.2, 1.2);
      top = (u) => 2.25 + rag(u) * 0.9 - 1.9 * Math.exp(-Math.pow((u - bx) / 0.75, 2)) - sstep(u1 - 1.0, u1, u) * 1.2;
    } else if (variant === 3) {
      // a tall fragment that still carries half of a great arch
      maxH = 5.3;
      const op = archOpening(1.75, 0.95, 0, 3.0, 1);
      ops.push(op);
      dressed.push({ op, flanks: [true], free: true });
      top = (u) => 5.0 + rag(u) * 0.8 - sstep(u0 + 1.2, u0, u) * 3.2 - sstep(0.6, 1.9, u) * 0.7;
      keepExtra = (c, um) => um < op.cu + 0.05;
    } else {
      // a doorway
      maxH = 3.9;
      const op = archOpening(-0.7, 0.62, 0, 1.7, 1);
      ops.push(op);
      dressed.push({ op, flanks: [false, true] });
      top = (u) => 3.5 + rag(u) * 0.8 - sstep(1.2, u1, u) * 2.3 - sstep(u0 + 0.5, u0, u) * 0.8;
    }

    // footing and plinth: buried stones are flat and cheap, the plinth course stands a little proud
    const foot = courses({ u0: u0 - 0.06, u1: u1 + 0.06, v0: -1, v1: 0.4, course: [0.36, 0.46], len: [0.7, 1.15], rng: R, breaks: [0] });
    cut(foot, ops);
    prune(foot, (c, um) => top(um) > 0.15 && (!keepExtra || keepExtra(c, um)));
    masonry(T, foot, { map: flatMap, wF: wF + 0.06, wB: wB - 0.06, rng: R, shadeAt: shade, back: true, detail: (c) => (c.v1 <= 0.01 ? 'plain' : 'pillow'), chip: 0, ridge: false, base: -1 });

    const rows = courses({ u0, u1, v0: 0.4, v1: maxH + 0.6, course: [0.27, 0.36], len: [0.5, 0.92], rng: R, breaks: ops.flatMap((o) => [o.sill, o.spring]) });
    cut(rows, ops);
    prune(rows, (c, um, vm) => vm < top(um) && (!keepExtra || keepExtra(c, um)));
    masonry(T, rows, { map: flatMap, wF, wB, rng: R, shadeAt: shade, back: true, base: 0.4, pockets: 0.035, debris: 0.3 });

    for (const d of dressed) {
      const op = d.op;
      const n = Math.max(3, Math.round((op.R * op.th) / 0.34));
      for (const mirror of d.flanks) voussoirs(T, flatMap, { cx: op.cu - op.c, cy: op.spring, R: op.R, t0: 0, t1: op.th }, { n, depth: 0.36, wF, wB, rng: R, shadeAt: shade, clampU: op.cu, mirror, free: !!d.free });
      for (const m of d.flanks) jambStones(T, flatMap, op, m ? -1 : 1, { wF, wB, rng: R, shadeAt: shade, from: Math.max(0.4, op.sill) });
      // a sill stone under a window
      if (op.sill > 0.5) {
        stoneBlock(
          T,
          flatMap,
          [
            [op.cu - op.a - 0.12, op.sill - 0.13],
            [op.cu + op.a + 0.12, op.sill - 0.13],
            [op.cu + op.a + 0.12, op.sill + 0.035],
            [op.cu - op.a - 0.12, op.sill + 0.035],
          ],
          wF + 0.07,
          wB - 0.07,
          { rng: R, color: stoneTone(R, { base: PAL.stoneLight }), shadeAt: shade, front: true, back: true, sides: [true, true, true, true], up: [0, 0, 1, 0] }
        );
      }
    }

    // what fell
    const spots = [];
    const nFall = R.int(9, 14);
    for (let i = 0; i < nFall; i++) {
      // more stones lie where the wall is lowest
      let u = R.range(u0 - 0.3, u1 + 0.3);
      for (let k = 0; k < 3; k++) {
        const u2 = R.range(u0 - 0.3, u1 + 0.3);
        if (top(u2) < top(u)) u = u2;
      }
      spots.push([u, R.sign() * R.range(thick / 2 + 0.25, 1.7)]);
    }
    fallen(T, R, spots, { shadeAt: shade, size: [0.26, 0.6] });
    if (variant === 3) {
      // the stones of the lost flank
      const op = ops[0];
      for (let i = 0; i < 4; i++) {
        placed(T, [op.cu + R.range(0.2, 1.6), 0.12, R.range(-1.2, 1.2)], [R.range(-0.3, 0.3), R.range(0, TAU), R.range(-0.3, 0.3)], () =>
          looseStone(T, 0.36, 0.3, thick + 0.06, { rng: R, color: stoneTone(R, { base: PAL.stoneLight }), shadeAt: shade, j: 0.03 })
        );
      }
    }

    b.add(T.build());
    b.add(deadIvy(R, { map: flatMap, w: wF + 0.02, u0: u0 + 0.3, u1: u1 - 0.3, top, n: R.int(2, 3) }));

    for (const s of wallSpans(rows, { u0, u1, step: 0.4, tol: 0.5 })) {
      const va = s.va <= 0.45 ? -0.5 : s.va;
      b.boxCollider((s.ua + s.ub) / 2, (va + s.vb) / 2, 0, (s.ub - s.ua) / 2, (s.vb - va) / 2, thick / 2 + 0.04);
    }
    return b.build();
  },
  { kind: 'structure', variants: 5 }
);

// ---------------------------------------------------------------------------------------------
// A pointed arch standing alone: two piers, the ring, and what is left of the wall it carried.
// ---------------------------------------------------------------------------------------------
register(
  'ruin_arch',
  (seed) => {
    const R = new Rng(seed * 613 + 5);
    const nz = new Noise(seed * 23 + 1);
    const b = new Builder();
    const T = new Tris();
    const thick = 0.9,
      wF = thick / 2,
      wB = -thick / 2;
    const a = 1.3,
      pier = 1.0,
      spring = 2.9;
    const op = archOpening(0, a, 0, spring, 1); // apex 5.15
    const shade = weathering({ seed: seed + 71, moss: 0.7, mossTop: 1.6, lichen: 0.45 });
    const flip = seed % 2 ? 1 : -1; // the side that lost its spandrel
    const edge = a + pier;
    // where the wall ran on, the piers are left toothed
    const tooth = (v, side) => edge + 0.1 + 0.34 * Math.max(0, nz.n2(v * 2.1, side * 9.7 + seed));
    const top = (u) => 5.72 - sstep(-0.9, 1.5, u * flip) * 2.45 + nz.fbm2(u * 1.1, seed * 2.3, 3) * 0.45;

    const foot = courses({ u0: -edge - 0.5, u1: edge + 0.5, v0: -1, v1: 0.4, course: [0.36, 0.46], len: [0.6, 1.0], rng: R, breaks: [0] });
    cut(foot, [op]);
    prune(foot, (c, um, vm) => Math.abs(um) < tooth(vm, Math.sign(um)) + 0.06);
    masonry(T, foot, { map: flatMap, wF: wF + 0.07, wB: wB - 0.07, rng: R, shadeAt: shade, back: true, detail: (c) => (c.v1 <= 0.01 ? 'plain' : 'pillow'), chip: 0, ridge: false, base: -1 });

    const rows = courses({ u0: -edge - 0.5, u1: edge + 0.5, v0: 0.4, v1: 6.5, course: [0.27, 0.36], len: [0.45, 0.85], rng: R, breaks: [spring - 0.19, spring] });
    cut(rows, [op]);
    prune(rows, (c, um, vm) => Math.abs(um) < tooth(vm, Math.sign(um)) && vm < top(um));
    masonry(T, rows, { map: flatMap, wF, wB, rng: R, shadeAt: shade, back: true, base: 0.4, pockets: 0.03, debris: 0.3 });

    // imposts: a projecting course the ring springs from
    for (const side of [-1, 1]) {
      const ua = side * (a - 0.06),
        ub = side * (a + pier * 0.8);
      stoneBlock(
        T,
        flatMap,
        [
          [Math.min(ua, ub), spring - 0.19],
          [Math.max(ua, ub), spring - 0.19],
          [Math.max(ua, ub), spring],
          [Math.min(ua, ub), spring],
        ],
        wF + 0.07,
        wB - 0.07,
        { rng: R, color: stoneTone(R, { base: PAL.stoneLight, vary: 0.06 }), shadeAt: shade, front: true, back: true, sides: [true, true, true, true], up: [0, 0, 1, 0] }
      );
      jambStones(T, flatMap, op, side, { wF, wB, rng: R, shadeAt: shade, from: 0.4 });
    }
    const n = Math.round((op.R * op.th) / 0.36);
    for (const mirror of [false, true]) voussoirs(T, flatMap, { cx: -op.c, cy: spring, R: op.R, t0: 0, t1: op.th }, { n, depth: 0.42, wF, wB, rng: R, shadeAt: shade, clampU: 0, mirror, free: true });

    // what came down lies mostly under the lost spandrel
    const spots = [];
    for (let i = R.int(10, 14); i > 0; i--) spots.push([flip * R.range(-0.4, 3.3), R.sign() * R.range(0.7, 2.0)]);
    for (let i = 0; i < 3; i++) spots.push([-flip * R.range(1.0, 3.0), R.sign() * R.range(0.7, 1.6)]);
    fallen(T, R, spots, { shadeAt: shade, size: [0.26, 0.62] });

    b.add(T.build());
    b.add(deadIvy(R, { map: flatMap, w: wF + 0.02, u0: -flip * (a + 0.15), u1: -flip * (edge - 0.1), top: () => 5.4, n: 2 }));
    b.add(deadIvy(R, { map: (u, v, w) => V3(u, v, -w), w: wF + 0.02, u0: flip * (a + 0.15), u1: flip * (edge - 0.1), top: () => 3.2, n: 1 }));

    for (const side of [-1, 1]) {
      const vb = Math.min(top(side * (a + pier / 2)), 3.6);
      b.boxCollider(side * (a + pier / 2 + 0.08), (vb - 0.5) / 2, 0, pier / 2 + 0.12, (vb + 0.5) / 2, thick / 2 + 0.06);
    }
    return b.build();
  },
  { kind: 'structure' }
);

// ---------------------------------------------------------------------------------------------
// Broken columns: drums on a moulded base, snapped, some with a drum lying beside them.
// ---------------------------------------------------------------------------------------------
register(
  'ruin_pillar',
  (seed) => {
    const variant = (((seed - 1) % 4) + 4) % 4;
    const R = new Rng(seed * 331 + 17);
    const b = new Builder();
    const shade = weathering({ seed: seed + 5, moss: 0.75, mossTop: 1.0, lichen: 0.5 });
    const sides = variant === 3 ? 8 : 10;
    const r = variant === 3 ? 0.4 : 0.36;
    const H = [1.25, 2.45, 3.0, 3.1][variant]; // height of the shaft
    const tone = () => stoneTone(R, { base: PAL.stoneLight, warm: 0.4, vary: 0.1 });
    const out = [];

    /** One drum, base on y = 0. brk > 0 snaps its top on a slope that drops by `brk`. */
    const drum = (h, { brk = 0, caps = false } = {}) => {
      const j = 0.011;
      const parts = [];
      if (!brk) {
        parts.push(
          lathe(
            [
              [r - j, 0, 'hard'],
              [r, j, 'hard'],
              [r, h - j, 'hard'],
              [r - j, h, 'hard'],
            ],
            sides
          )
        );
        if (caps) {
          const t = disc(r - j, sides);
          t.translate(0, h, 0);
          parts.push(t);
        }
      } else {
        const g = lathe(
          [
            [r - j, 0, 'hard'],
            [r, j, 'hard'],
            [r, h, 'hard'],
          ],
          sides
        );
        // the break: a slope with a ragged, faceted face
        const dir = R.range(0, TAU),
          dx = Math.cos(dir),
          dz = Math.sin(dir);
        const nb = new Noise(R.int(1, 9999));
        const yb = (x, z, k) => Math.max(0.08, h - brk * (0.5 + 0.5 * ((x * dx + z * dz) / r)) - Math.abs(nb.n2(x * 6, z * 6)) * 0.09 + k);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) > h - 1e-3) pos.setY(i, yb(pos.getX(i), pos.getZ(i), 0));
        g.computeVertexNormals();
        const P = [];
        const ring = (rr, k) => {
          const o = [];
          for (let i = 0; i < sides; i++) {
            const a = (i / sides) * TAU,
              x = Math.cos(a) * rr,
              z = -Math.sin(a) * rr;
            o.push([x, yb(x, z, k ? R.range(-0.03, 0.09) : 0), z]);
          }
          return o;
        };
        const rim = ring(r, 0),
          mid = ring(r * 0.52, 1),
          c = [0, yb(0, 0, R.range(0, 0.1)), 0];
        for (let i = 0; i < sides; i++) {
          const n = (i + 1) % sides;
          P.push(...rim[i], ...rim[n], ...mid[n], ...rim[i], ...mid[n], ...mid[i], ...mid[i], ...mid[n], ...c);
        }
        const t = new THREE.BufferGeometry();
        t.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        t.computeVertexNormals();
        parts.push(g, t);
      }
      if (caps) {
        const d = disc(r - j, sides);
        d.rotateX(Math.PI);
        parts.push(d);
      }
      return variant === 3 ? parts.map((g) => flat(g)) : parts;
    };
    const capital = () => {
      const g = lathe(
        [
          [r, 0, 'hard'],
          [r + 0.035, 0.025],
          [r, 0.055, 'hard'],
          [r + 0.01, 0.08],
          [r + 0.05, 0.2],
          [r + 0.16, 0.3, 'hard'],
          [r + 0.16, 0.33, 'hard'],
        ],
        sides
      );
      const ab = roughBox(2 * r + 0.4, 0.16, 2 * r + 0.4, R, 0.025);
      ab.translate(0, 0.41, 0);
      return [g, ab];
    };

    const lean = [R.range(-0.02, 0.02), 0, variant === 2 ? R.range(0.03, 0.045) : R.range(-0.02, 0.02)];
    const stand = (parts, y, color, y0, y1, darkTop = true) => {
      const yaw = R.range(0, TAU);
      for (const g of parts) {
        xf(g, { t: [R.range(-0.012, 0.012), y, R.range(-0.012, 0.012)], r: [0, yaw, 0] });
        xf(g, { r: lean });
        out.push(stonePaint(g, { color, shadeAt: shade, dark: (v) => 1 - 0.5 * Math.exp(-Math.max(0, Math.min(v.y - y0, darkTop ? y1 - v.y : 9)) / 0.025) }));
      }
    };

    // foundation, plinth, moulded base
    const fnd = roughBox(1.12, 0.72, 1.12, R, 0.03);
    fnd.translate(0, -0.38, 0);
    out.push(stonePaint(fnd, { color: PAL.stoneDark, shadeAt: shade }));
    const pl = roughBox(2 * r + 0.3, 0.27, 2 * r + 0.3, R, 0.018);
    pl.translate(0, 0.125, 0);
    xf(pl, { r: [0, R.range(-0.06, 0.06), 0] });
    out.push(stonePaint(pl, { color: tone(), shadeAt: shade }));
    stand(
      [
        lathe(
          [
            [r + 0.1, 0, 'hard'],
            [r + 0.135, 0.06],
            [r + 0.1, 0.12],
            [r + 0.04, 0.15],
            [r + 0.012, 0.25, 'hard'],
          ],
          sides
        ),
      ],
      0.26,
      tone(),
      0.26,
      0.51
    );

    // the shaft
    let y = 0.51;
    const yEnd = 0.51 + H;
    const slipAt = R.int(1, 3); // one drum has been shoved out of line
    let k = 0;
    while (y < yEnd - 1e-3) {
      let h = R.range(0.36, 0.7);
      if (yEnd - (y + h) < 0.3) h = yEnd - y;
      const last = y + h >= yEnd - 1e-3;
      const snapped = last && variant !== 2;
      const parts = drum(h, { brk: snapped ? Math.min(h - 0.12, R.range(0.22, 0.42)) : 0 });
      if (k++ === slipAt && !last) {
        const sa = R.range(0, TAU),
          sd = R.range(0.035, 0.07);
        for (const g of parts) g.translate(Math.cos(sa) * sd, 0, Math.sin(sa) * sd);
      }
      stand(parts, y, tone(), y, y + h, !snapped);
      y += h;
    }
    if (variant === 2) stand(capital(), y, tone(), y, y + 0.46, false);

    // what fell: drums on their sides, half sunk
    const lying = (parts, x, z, yaw, tilt, color, hh) => {
      for (const g of parts) {
        g.translate(0, -hh / 2, 0);
        xf(g, { r: [0, 0, Math.PI / 2 + tilt] });
        xf(g, { t: [x, r - 0.07, z], r: [0, yaw, 0] });
        out.push(stonePaint(g, { color, shadeAt: shade }));
      }
      b.boxCollider(x, r * 0.5, z, hh / 2, r * 0.55, r * 0.9, yaw);
    };
    const nFallen = [2, 1, 0, 1][variant];
    let ang = R.range(0, TAU);
    for (let i = 0; i < nFallen; i++) {
      const h = R.range(0.45, 0.62);
      const d = R.range(1.0, 1.5);
      lying(drum(h, { brk: i === 0 ? R.range(0.15, 0.3) : 0, caps: true }), Math.cos(ang) * d, Math.sin(ang) * d, R.range(0, TAU), R.range(-0.14, 0.14), tone(), h);
      ang += R.range(1.4, 2.6);
    }
    if (variant === 3) {
      // the slab it carried lies a little way off, split
      const x = Math.cos(ang) * 1.6,
        z = Math.sin(ang) * 1.6,
        c = tone(),
        yaw = R.range(0, TAU);
      for (const [w, dx, tilt] of [
        [0.62, -0.3, 0.16],
        [0.44, 0.3, -0.1],
      ]) {
        const g = roughBox(w, 0.15, 1.1, R, 0.03);
        xf(g, { t: [dx, 0.07, 0], r: [R.range(-0.05, 0.05), 0, tilt] });
        xf(g, { t: [x, 0, z], r: [0, yaw, 0] });
        out.push(stonePaint(g, { color: c, shadeAt: shade }));
      }
    }
    const T = new Tris();
    const spots = [];
    for (let i = R.int(4, 7); i > 0; i--) {
      const aa = R.range(0, TAU),
        d = R.range(0.7, 1.9);
      spots.push([Math.cos(aa) * d, Math.sin(aa) * d]);
    }
    fallen(T, R, spots, { shadeAt: shade, size: [0.16, 0.4], tone });
    out.push(T.build());

    b.add(out);
    const top = 0.51 + H + (variant === 2 ? 0.46 : 0);
    b.cylCollider(0, top / 2, 0, r + 0.12, top);
    return b.build();
  },
  { kind: 'structure', variants: 4 }
);
