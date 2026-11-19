// Things by the road: the waymark, cairns, the village well, a hand-cart, the gibbet.
import { Builder, Rng, MAT, PAL, THREE, paint, xf, mixc, rock, lathe, tube, TAU } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, weathering, stoneTone, stonePaint, placed, looseStone, courses, masonry, prune, timber, pole, iron, aim, dist3, chain, rope, lantern, hewn, ROPE } from './_shared.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const stick = (a, e, t, w = t) => {
  const g = new THREE.BoxGeometry(w, dist3(a, e), t);
  g.translate(0, dist3(a, e) / 2, 0);
  return aim(g, a, e);
};

// ---------------------------------------------------------------------------------------------
// The waymark: a leaning post, a finger board nobody can read, a lantern that is not lit.
// ---------------------------------------------------------------------------------------------
register(
  'waymark',
  (seed) => {
    const R = new Rng(seed * 211 + 5);
    const b = new Builder();
    const shade = weathering({ seed: seed + 3, moss: 0.6, mossTop: 0.5, lichen: 0.7 });
    const lean = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(R.range(0.05, 0.09), R.range(-0.3, 0.3), R.range(-0.075, -0.04)));
    const put = (g) => {
      g.applyMatrix4(lean);
      return g;
    };
    const at = (p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(lean).toArray();

    const post = timber(2.82, 0.13, 0.12, { rng: R, color: PAL.woodGrey, broken: 1, rot: 0.35 });
    post.translate(0, -0.45, 0);
    b.add(put(post));

    // the bracket and its stay
    const arm = tube(
      [
        [0.05, 2.0, 0],
        [0.3, 2.04, 0],
        [0.5, 2.05, 0],
        [0.565, 2.01, 0],
        [0.54, 1.955, 0],
      ],
      0.012,
      4,
      { samples: 12 }
    );
    b.add(put(iron(arm, R, 0.4)), put(iron(stick([0.065, 1.66, 0], [0.4, 2.04, 0], 0.012, 0.022), R, 0.4)));
    for (const y of [1.7, 2.0]) {
      const band = new THREE.BoxGeometry(0.15, 0.035, 0.14);
      band.translate(0, y, 0);
      b.add(put(iron(band, R, 0.45)));
    }
    // the lantern hangs plumb whatever the post does
    const hook = at([0.54, 1.95, 0]);
    const drop = 0.09;
    b.add(chain(hook, [hook[0], hook[1] - drop, hook[2]], { link: 0.045, t: 0.008, rng: R, rust: 0.4, sway: 0.25 }));
    const lan = lantern(R, { w: 0.17, h: 0.27, rust: 0.4, sway: 0.25 });
    for (const g of lan.geos) {
      g.translate(hook[0], hook[1] - drop, hook[2]);
      b.add(g);
    }
    b.anchor('flame', hook[0] + lan.flame[0], hook[1] - drop + lan.flame[1], hook[2] + lan.flame[2]);

    // boards: built along +Y so the grain runs their length
    const board = (len, w, pointed) => {
      const g = new THREE.BoxGeometry(w, len, 0.028, 2, 1, 1);
      g.translate(0, len / 2, 0);
      const pos = g.attributes.position;
      const jag = [R.range(0, 0.12), R.range(0, 0.12), R.range(0, 0.12)];
      for (let i = 0; i < pos.count; i++) {
        const top = pos.getY(i) > len - 1e-4;
        if (pointed && top && Math.abs(pos.getX(i)) < 1e-4) pos.setY(i, len + w * 0.5);
        else if (!pointed && top) pos.setY(i, len - jag[Math.round((pos.getX(i) / w + 0.5) * 2)]);
      }
      g.computeVertexNormals();
      const base = mixc(PAL.woodGrey, PAL.barkPale, R.range(0.1, 0.4));
      const dark = base.clone().multiplyScalar(0.55);
      return paint(g, { color: (v) => base.clone().lerp(dark, Math.exp(-Math.max(0, Math.min(v.y, len - v.y)) / 0.06) * 0.8), rough: 0.93, mat: MAT.WOOD });
    };
    const a = [0.11, 1.5, 0.076],
      e = [-0.72, 1.44, 0.082];
    const fb = [board(0.8, 0.17, true)];
    // what is left of the lettering
    for (let y = 0.2; y < 0.7; y += R.range(0.055, 0.085)) {
      if (R.chance(0.3)) continue;
      const h = R.range(0.04, 0.09);
      const s = new THREE.BoxGeometry(h, 0.012, 0.004);
      s.rotateZ(R.chance(0.3) ? R.range(-0.7, 0.7) : 0);
      s.translate(R.range(-0.02, 0.02), y, 0.0155);
      fb.push(paint(s, { color: '#17120e', rough: 0.95, mat: MAT.PLAIN }));
    }
    for (const g of fb) b.add(put(aim(g, a, e)));
    b.add(put(aim(board(0.36, 0.15, false), [0.02, 1.22, -0.075], [0.3, 1.02, -0.085])));
    for (const p of [
      [0.03, 1.5, 0.094],
      [-0.03, 1.47, 0.094],
    ]) {
      const nail = new THREE.BoxGeometry(0.016, 0.016, 0.01);
      nail.translate(p[0], p[1], p[2]);
      b.add(put(iron(nail, R, 0.5)));
    }

    // stones heaped round the foot to hold it up
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * TAU + R.range(-0.4, 0.4),
        r = R.range(0.1, 0.17),
        d = R.range(0.14, 0.24);
      const g = rock(r, { seed: R.int(1, 99999), detail: 1, rough: 0.24, squash: [1, 0.62, R.range(0.75, 1)], facet: true });
      xf(g, { r: [R.range(-0.2, 0.2), R.range(0, TAU), R.range(-0.2, 0.2)], t: [Math.cos(an) * d, r * 0.25, Math.sin(an) * d] });
      b.add(stonePaint(g, { color: stoneTone(R), shadeAt: shade }));
    }
    return b.build();
  },
  { kind: 'prop' }
);

// ---------------------------------------------------------------------------------------------
// Cairns: a heap, a slender stack, and one that has half come down.
// ---------------------------------------------------------------------------------------------
register(
  'cairn',
  (seed) => {
    const variant = (((seed - 1) % 3) + 3) % 3;
    const R = new Rng(seed * 173 + 29);
    const b = new Builder();
    const shade = weathering({ seed: seed + 41, moss: 0.55, mossTop: 0.4, lichen: 0.85, grime: 0.6 });
    const stone = (r, flatness, pos, rot) => {
      const g = rock(r, { seed: R.int(1, 99999), detail: 1, rough: 0.2, squash: [1, flatness, R.range(0.72, 1)], facet: true });
      xf(g, { r: rot, t: pos });
      b.add(stonePaint(g, { color: stoneTone(R, { vary: 0.12 }), shadeAt: shade }));
    };
    const heap = (layers, y0 = 0.02) => {
      let y = y0;
      for (const [n, ring, r, part = 1] of layers) {
        const ph = R.range(0, TAU);
        for (let i = 0; i < n; i++) {
          if (i / n > part) continue;
          const an = ph + (i / n) * TAU + R.range(-0.2, 0.2),
            rr = r * R.range(0.86, 1.1);
          stone(rr, R.range(0.42, 0.55), [Math.cos(an) * ring, y + rr * 0.42, Math.sin(an) * ring], [R.range(-0.16, 0.16), R.range(0, TAU), R.range(-0.16, 0.16)]);
        }
        y += r * 0.84;
      }
      return y;
    };
    if (variant === 0) {
      stone(0.36, 0.7, [0, 0.2, 0], [0, R.range(0, TAU), 0]); // the heart of the heap
      heap([
        [7, 0.42, 0.27],
        [5, 0.29, 0.25],
        [4, 0.17, 0.22],
        [2, 0.08, 0.2],
        [1, 0, 0.16],
      ]);
      b.cylCollider(0, 0.5, 0, 0.62, 1.0);
    } else if (variant === 1) {
      let y = 0;
      let x = 0,
        z = 0;
      for (const r of [0.36, 0.3, 0.26, 0.22, 0.18, 0.15, 0.12, 0.09]) {
        const f = R.range(0.36, 0.48);
        stone(r, f, [x, y + r * f * 0.86, z], [R.range(-0.1, 0.1), R.range(0, TAU), R.range(-0.1, 0.1)]);
        y += r * f * 1.66;
        x += R.range(-0.035, 0.035);
        z += R.range(-0.035, 0.035);
      }
      for (let i = 0; i < 3; i++) {
        const an = R.range(0, TAU),
          r = R.range(0.1, 0.15);
        stone(r, 0.55, [Math.cos(an) * 0.42, r * 0.3, Math.sin(an) * 0.42], [0, R.range(0, TAU), 0]);
      }
      b.cylCollider(0, 0.5, 0, 0.38, 1.0);
    } else {
      stone(0.34, 0.6, [0, 0.16, 0], [0, R.range(0, TAU), 0]);
      heap([
        [7, 0.42, 0.27],
        [5, 0.28, 0.24, 0.75],
        [3, 0.15, 0.2, 0.5],
      ]);
      // the top of it went down the slope
      const dir = R.range(0, TAU);
      for (let i = 0; i < 6; i++) {
        const an = dir + R.range(-0.7, 0.7),
          d = R.range(0.75, 1.5),
          r = R.range(0.14, 0.24);
        stone(r, R.range(0.45, 0.6), [Math.cos(an) * d, r * 0.3, Math.sin(an) * d], [R.range(-0.5, 0.5), R.range(0, TAU), R.range(-0.5, 0.5)]);
      }
      b.cylCollider(0, 0.32, 0, 0.62, 0.64);
    }
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);

// ---------------------------------------------------------------------------------------------
// The village well. The roof went long ago; the windlass and its bucket are still there.
// ---------------------------------------------------------------------------------------------
register(
  'well',
  (seed) => {
    const R = new Rng(seed * 389 + 17);
    const b = new Builder();
    const T = new Tris();
    const shade = weathering({ seed: seed + 77, moss: 0.75, mossTop: 0.8, lichen: 0.5 });
    const RO = 0.95,
      TH = 0.33,
      L = TAU * RO,
      H = 0.78;
    const map = (u, v, w) => {
      const th = u / RO,
        rr = RO + w;
      return V3(Math.sin(th) * rr, v, Math.cos(th) * rr);
    };
    const rows = courses({ u0: -L / 2, u1: L / 2, v0: -0.7, v1: H, course: [0.24, 0.3], len: [0.42, 0.7], rng: R, wrap: true, breaks: [0] });
    masonry(T, rows, { map, wF: 0, wB: -TH, rng: R, shadeAt: shade, wrapL: L, back: (c) => (c.v0 >= -0.01 ? 'plain' : false), detail: (c) => (c.v1 <= 0.01 ? 'plain' : 'pillow'), chip: 0, ridge: false, base: -0.7, pockets: 0.04 });
    // the coping: wide flat stones, a stretch of them pushed off
    const gapAt = R.range(-L / 2, L / 2);
    const away = (u) => {
      let d = Math.abs(u - gapAt);
      if (d > L / 2) d = L - d;
      return d;
    };
    const cope = courses({ u0: -L / 2, u1: L / 2, levels: [H, H + 0.11], len: [0.5, 0.8], rng: R, wrap: true });
    prune(cope, (c, um) => away(um) > 0.55);
    masonry(T, cope, { map, wF: 0.05, wB: -TH - 0.04, rng: R, shadeAt: shade, wrapL: L, back: true, chip: 0, ridge: false, base: H, tone: (c, rng) => stoneTone(rng, { base: PAL.stoneLight, vary: 0.08 }) });
    for (let i = 0; i < 2; i++) {
      const th = gapAt / RO + R.range(-0.3, 0.3),
        d = RO + R.range(0.35, 0.7);
      placed(T, [Math.sin(th) * d, 0.07, Math.cos(th) * d], [R.range(-0.25, 0.25), R.range(0, TAU), R.range(-0.25, 0.25)], () => looseStone(T, R.range(0.45, 0.6), 0.11, 0.38, { rng: R, color: stoneTone(R, { base: PAL.stoneLight }), shadeAt: shade }));
    }
    b.add(T.build());
    // the dark, a little way down
    const dark = new THREE.CircleGeometry(RO - TH + 0.01, 16);
    dark.rotateX(-Math.PI / 2);
    dark.translate(0, 0.2, 0);
    b.add(paint(dark, { color: '#06090a', rough: 0.16, mat: MAT.PLAIN }));
    // a worn step where people stood to draw
    const step = hewn(0.95, 0.14, 0.42, R, { j: 0.02 });
    step.translate(0, 0.03, RO + 0.26);
    b.add(stonePaint(step, { color: stoneTone(R), shadeAt: shade }));

    // the windlass: two uprights set in the well head, a drum, an iron crank
    const DY = 1.5;
    for (const [x, top] of [
      [-0.785, 2.08],
      [0.785, 1.78],
    ]) {
      const up = timber(top - 0.3, 0.13, 0.11, { rng: R, color: PAL.woodGrey, broken: 1, rot: 0.3 });
      xf(up, { r: [R.range(-0.02, 0.02), 0, R.range(-0.025, 0.025)], t: [x, 0.3, 0] });
      b.add(up);
    }
    b.add(aim(pole(1.82, 0.075, { rng: R, radial: 8, taper: 1, crook: 0.003, hseg: 1, color: mixc(PAL.woodGrey, PAL.woodDark, 0.3) }), [-0.9, DY, 0], [0.92, DY, 0]));
    b.add(iron(stick([0.9, DY, 0], [1.03, DY, 0], 0.022), R, 0.45), iron(stick([1.02, DY, 0], [1.02, DY - 0.2, 0.13], 0.02), R, 0.45), iron(stick([1.01, DY - 0.2, 0.13], [1.2, DY - 0.2, 0.13], 0.02), R, 0.45));
    // the roof is gone: a stub of its tie on the taller post, a rafter against the well head
    b.add(aim(timber(0.5, 0.09, 0.07, { rng: R, color: PAL.woodGrey, broken: 1, rot: 0.4 }), [-0.78, 1.68, 0], [-0.3, 1.73, 0.02]));
    b.add(aim(timber(1.5, 0.08, 0.06, { rng: R, color: PAL.woodGrey, broken: 2, rot: 0.5 }), [-1.5, 0.03, -0.62], [-0.72, 0.93, -0.5]));
    // rope on the drum, and the bucket hanging just over the well head
    const turns = [];
    for (let k = 0; k < 7; k++) turns.push([0.078, -0.14 + k * 0.034], [0.1, -0.123 + k * 0.034]);
    turns.push([0.078, -0.14 + 7 * 0.034]);
    const wrap = lathe(turns, 8);
    wrap.rotateZ(-Math.PI / 2);
    wrap.translate(0, DY, 0);
    b.add(paint(wrap, { color: (v) => ROPE.clone().multiplyScalar(0.75 + 0.35 * Math.abs(Math.sin(v.x * 92))), rough: 0.95, mat: MAT.CLOTH }));
    const bx = 0.04,
      bz = 0.092,
      bt = 1.14; // bucket top
    const sway = (g, k = 0.5) => paint(g, { sway: (v) => k * clamp01((DY - v.y) / 0.7), uvw: false });
    b.add(sway(rope([[bx, DY, bz], [bx, bt + 0.17, bz]], 0.013)));
    const bucket = [];
    bucket.push(paint(lathe([[0.125, 0], [0.15, 0.3, 'hard'], [0.135, 0.3, 'hard'], [0.112, 0.03, 'hard'], [0, 0.03]], 9), { color: mixc(PAL.woodDark, PAL.woodGrey, 0.4), rough: 0.9, mat: MAT.WOOD }));
    for (const y of [0.06, 0.23]) bucket.push(iron(lathe([[0.128 + y * 0.083, y - 0.014], [0.132 + y * 0.083, y - 0.014], [0.134 + y * 0.083, y + 0.014], [0.13 + y * 0.083, y + 0.014]], 9), R, 0.5));
    const bail = [];
    for (let i = 0; i <= 6; i++) {
      const an = (i / 6) * Math.PI;
      bail.push([Math.cos(an) * 0.148, 0.28 + Math.sin(an) * 0.17, 0]);
    }
    bucket.push(iron(tube(bail, 0.007, 3, { samples: 8 }), R, 0.5));
    for (const g of bucket) b.add(sway(xf(g, { r: [0.05, R.range(0, TAU), -0.07], t: [bx, bt - 0.3, bz] })));

    b.cylCollider(0, 0.45, 0, 1.0, 0.9);
    return b.build();
  },
  { kind: 'structure' }
);

// ---------------------------------------------------------------------------------------------
// A hand-cart left where its wheel came off. Built in its own frame (origin at the middle of the
// axle, shafts toward +Z), then tipped onto the axle end and the tip of one shaft.
// ---------------------------------------------------------------------------------------------
function wheel(R, { r = 0.45, missing = [], arc = TAU, snapped = [] } = {}) {
  const out = [];
  const wood = (g, k = 0.35) => paint(g, { color: mixc(PAL.woodGrey, PAL.woodDark, k).multiplyScalar(R.range(0.85, 1.1)), rough: 0.92, mat: MAT.WOOD });
  const rim = new THREE.TorusGeometry(r - 0.036, 0.036, 4, 16, arc);
  out.push(wood(rim));
  const tyre = new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.05, 16, 1, true, 0, arc);
  tyre.rotateX(Math.PI / 2);
  tyre.rotateZ(Math.PI / 2); // a cylinder's seam starts on +Z, a torus arc on +X
  out.push(iron(tyre, R, 0.5));
  const hub = new THREE.CylinderGeometry(0.07, 0.08, 0.2, 8);
  hub.rotateX(Math.PI / 2);
  out.push(wood(hub, 0.6));
  for (let i = 0; i < 8; i++) {
    if (missing.includes(i)) continue;
    const an = (i / 8) * TAU + 0.2;
    const short = snapped.includes(i);
    const sp = timber((r - 0.06) * (short ? R.range(0.35, 0.6) : 1), 0.042, 0.03, { rng: R, color: mixc(PAL.woodGrey, PAL.woodDark, 0.3), broken: short ? 1 : 0 });
    out.push(xf(sp, { r: [0, 0, an - Math.PI / 2] }));
  }
  return out; // in the XY plane, axle along Z
}

register(
  'cart',
  (seed) => {
    const R = new Rng(seed * 263 + 31);
    const b = new Builder();
    const WR = 0.45,
      HT = 0.52; // wheel radius, half track
    const off = R.sign(); // the side that lost its wheel
    const roll = off * -Math.asin((WR - 0.05) / (2 * HT));
    const M = new THREE.Matrix4()
      .makeTranslation(0, WR - (WR - 0.05) / 2 - 0.025, -0.42)
      .multiply(new THREE.Matrix4().makeRotationZ(roll))
      .multiply(new THREE.Matrix4().makeRotationX(0.075));
    const add = (...gs) => {
      for (const g of gs.flat()) {
        g.applyMatrix4(M);
        b.add(g);
      }
    };
    const grey = () => mixc(PAL.woodGrey, PAL.barkPale, R.range(0, 0.3));
    // axle and the wheel that stayed
    add(aim(timber(2 * HT + 0.2, 0.075, 0.075, { rng: R, color: PAL.woodDark, rot: 0.3 }), [-HT - 0.1, 0, 0], [HT + 0.1, 0, 0]));
    const w1 = wheel(R, { r: WR });
    for (const g of w1) {
      g.rotateY(Math.PI / 2);
      g.translate(-off * (HT + 0.02), 0, 0);
    }
    add(w1);
    // shafts and bearers
    const BY = 0.1; // underside of the bed
    for (const s of [-1, 1]) {
      const whole = s === off; // the one the cart now rests on
      const len = whole ? 2.4 : R.range(1.5, 1.8);
      add(aim(timber(len, 0.06, 0.055, { rng: R, color: PAL.woodGrey, broken: whole ? 0 : 1, rot: 0.2 }), [s * 0.37, BY - 0.03, -0.75], [s * 0.36, BY - 0.05, -0.75 + len]));
    }
    for (const z of [-0.6, 0, 0.6]) add(aim(timber(0.9, 0.06, 0.045, { rng: R, color: PAL.woodGrey, rot: 0.3 }), [-0.45, BY + 0.02, z], [0.45, BY + 0.02, z]));
    // the bed: five boards, one broken through
    for (let i = 0; i < 5; i++) {
      const x = -0.34 + i * 0.17;
      const hole = i === 2 - off;
      const len = hole ? R.range(0.6, 0.9) : 1.5;
      add(aim(timber(len, 0.158, 0.024, { rng: R, color: grey(), broken: hole ? 1 : 0, rot: R.range(0, 0.3) }), [x, BY + 0.055, -0.75], [x + R.range(-0.006, 0.006), BY + 0.055, -0.75 + len]));
    }
    // sides: stakes, a rail on the high side, a broken one on the low side, a headboard
    for (const s of [-1, 1]) {
      for (const z of [-0.68, -0.05, 0.62]) {
        const h = s === off && z > 0 ? 0.16 : 0.36;
        add(aim(timber(h, 0.045, 0.04, { rng: R, color: PAL.woodGrey, broken: h < 0.3 ? 1 : 0 }), [s * 0.43, BY + 0.03, z], [s * 0.45, BY + 0.03 + h, z]));
      }
      const whole = s !== off;
      const len = whole ? 1.46 : 0.8;
      for (const y of whole ? [0.2, 0.33] : [0.2]) {
        const g = timber(len, 0.1, 0.02, { rng: R, color: grey(), broken: whole ? 0 : 1, rot: 0.2 });
        g.rotateY(Math.PI / 2);
        add(aim(g, [s * 0.455, BY + y, -0.73], [s * 0.455, BY + y - (whole ? 0 : 0.06), -0.73 + len]));
      }
    }
    for (const y of [0.2, 0.33]) add(aim(timber(0.9, 0.1, 0.02, { rng: R, color: grey(), rot: 0.2 }), [-0.45, BY + y, 0.735], [0.45, BY + y, 0.735]));

    // the wheel that came off lies beside it, two spokes gone and a felloe split out
    const w2 = wheel(R, { r: WR, missing: [1, 5], snapped: [2], arc: TAU * 0.86 });
    const yaw = R.range(0, TAU);
    for (const g of w2) {
      g.rotateX(Math.PI / 2);
      b.add(xf(g, { r: [0.1, yaw, 0.04], t: [off * 1.05, 0.085, -0.75] }));
    }
    // a board that fell out
    b.add(xf(timber(0.8, 0.15, 0.024, { rng: R, color: grey(), broken: 2, rot: 0.3 }), { r: [Math.PI / 2, 0, 0.5], t: [off * 0.55, 0.02, 0.9] }));
    b.boxCollider(0, 0.4, 0, 0.62, 0.4, 1.2);
    return b.build();
  },
  { kind: 'prop' }
);

// ---------------------------------------------------------------------------------------------
// The gibbet: a post, an arm, the irons hanging empty, what fell out of them underneath.
// ---------------------------------------------------------------------------------------------
register(
  'gibbet',
  (seed) => {
    const R = new Rng(seed * 331 + 23);
    const b = new Builder();
    const shade = weathering({ seed: seed + 19, moss: 0.6, mossTop: 0.5, lichen: 0.6 });
    const lean = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(R.range(-0.03, 0.03), R.range(-0.2, 0.2), R.range(-0.05, -0.025)));
    const put = (g) => {
      g.applyMatrix4(lean);
      return g;
    };
    const at = (p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(lean).toArray();
    const AY = 3.62; // the arm
    const post = timber(5.05, 0.21, 0.2, { rng: R, color: mixc(PAL.woodGrey, PAL.woodDark, 0.4), rot: 0.3 });
    post.translate(0, -1.0, 0);
    b.add(put(post));
    b.add(put(aim(timber(1.75, 0.15, 0.13, { rng: R, color: mixc(PAL.woodGrey, PAL.woodDark, 0.4), rot: 0.3 }), [-0.22, AY, 0], [1.53, AY, 0])));
    b.add(put(aim(timber(1.12, 0.11, 0.09, { rng: R, color: mixc(PAL.woodGrey, PAL.woodDark, 0.3), rot: 0.3 }), [0.08, 2.84, 0], [0.95, AY - 0.06, 0])));
    for (const [x, y, w, h] of [
      [0, AY, 0.25, 0.05],
      [0, AY - 0.14, 0.25, 0.04],
      [1.24, AY, 0.045, 0.2],
    ]) {
      const band = new THREE.BoxGeometry(w, h, x ? 0.16 : 0.235);
      band.translate(x, y, 0);
      b.add(put(iron(band, R, 0.45)));
    }
    // stones wedged round the foot
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * TAU + R.range(-0.4, 0.4),
        r = R.range(0.12, 0.2),
        d = R.range(0.2, 0.3);
      const g = rock(r, { seed: R.int(1, 99999), detail: 1, rough: 0.24, squash: [1, 0.6, R.range(0.75, 1)], facet: true });
      xf(g, { r: [R.range(-0.2, 0.2), R.range(0, TAU), R.range(-0.2, 0.2)], t: [Math.cos(an) * d, r * 0.2, Math.sin(an) * d] });
      b.add(stonePaint(g, { color: stoneTone(R), shadeAt: shade }));
    }

    // the irons: hoops and straps in the shape of whoever they were made for
    const hook = at([1.24, AY - 0.1, 0]);
    const CT = hook[1] - 0.42; // top ring of the cage
    const swayAt = (y) => 0.45 * clamp01((hook[1] - y) / 2.2);
    const hang = (g) => paint(g, { sway: (v) => swayAt(v.y), uvw: false });
    for (const g of chain(hook, [hook[0], CT + 0.03, hook[2]], { link: 0.07, t: 0.011, rng: R, rust: 0.45 })) b.add(hang(g));
    const prof = [
      [0, 0.03],
      [-0.13, 0.115],
      [-0.3, 0.085],
      [-0.42, 0.235],
      [-0.64, 0.225],
      [-0.86, 0.185],
      [-1.03, 0.205],
      [-1.38, 0.14],
      [-1.7, 0.1],
      [-1.79, 0.03],
    ];
    const FLAT = 0.64; // the cage is shallower front to back than it is wide
    const cage = [];
    for (const [i, y, r] of prof.map((p, i) => [i, p[0], p[1]])) {
      if (i === 0 || i === 4 || i === prof.length - 1) continue;
      const burst = i === 6; // the hip hoop has parted
      const h = new THREE.TorusGeometry(r, 0.009, 3, 12, burst ? TAU * 0.8 : TAU);
      h.rotateX(Math.PI / 2);
      h.scale(1, 1, FLAT);
      if (burst) h.rotateY(-0.5);
      h.translate(0, y, 0);
      cage.push(h);
    }
    for (let k = 0; k < 6; k++) {
      const an = (k / 6) * TAU + 0.52;
      const open = k === 0 || k === 5; // these two straps were forced apart between waist and knee
      const pts = [];
      for (let i = 0; i < prof.length; i++) {
        const [y, r] = prof[i];
        const push = open && i >= 6 && i <= 7 ? 0.11 : 0;
        if (open && k === 0 && i > 7) break; // one of them broke off there
        const a2 = an + (open && i >= 6 ? (k === 0 ? -0.35 : 0.3) : 0);
        pts.push([Math.cos(a2) * (r + push), y, Math.sin(a2) * (r + push) * FLAT]);
      }
      cage.push(tube(pts, 0.0085, 3, { samples: pts.length * 2, caps: false }));
    }
    const ring = new THREE.TorusGeometry(0.03, 0.008, 3, 8);
    ring.translate(0, 0.03, 0);
    cage.push(ring);
    const turn = R.range(0, TAU);
    for (const g of cage) b.add(hang(iron(xf(g, { r: [0, turn, 0], t: [hook[0], CT, hook[2]] }), R, 0.45)));

    // bones under it
    const boneC = () => mixc(PAL.boneOld, PAL.stoneWarm, R.range(0.1, 0.45)).multiplyScalar(R.range(0.8, 1));
    const bone = (g) => paint(g, { color: boneC(), rough: 0.85, mat: MAT.PLAIN });
    const under = (dx, dz) => [hook[0] + dx, 0, hook[2] + dz];
    const long = (len, p, yaw, r = 0.012) => {
      const g = tube([[0, 0, 0], [0, len, 0]], (t) => r + r * 1.1 * Math.pow(Math.abs(2 * t - 1), 5), 5, { samples: 6 });
      return xf(bone(g), { r: [Math.PI / 2 + R.range(-0.06, 0.06), 0, yaw], t: [p[0], r * 1.6, p[2]] });
    };
    b.add(long(0.43, under(-0.3, 0.12), 0.4), long(0.41, under(0.1, -0.3), 1.9), long(0.36, under(0.2, 0.16), -0.7, 0.01), long(0.3, under(-0.12, -0.12), 2.6, 0.009), long(0.25, under(0.36, -0.06), 0.9, 0.008));
    const skull = [];
    const cr = new THREE.IcosahedronGeometry(1, 1);
    cr.scale(0.078, 0.074, 0.094);
    skull.push(bone(cr));
    const jaw = new THREE.BoxGeometry(0.066, 0.05, 0.05);
    jaw.translate(0, -0.05, 0.062);
    skull.push(bone(jaw));
    for (const s of [-1, 1]) {
      const eye = new THREE.IcosahedronGeometry(0.02, 0);
      eye.translate(s * 0.03, -0.004, 0.083);
      skull.push(paint(eye, { color: '#0b0908', rough: 1, mat: MAT.PLAIN }));
    }
    const sp = under(-0.05, 0.3);
    for (const g of skull) b.add(xf(g, { r: [0.5, R.range(0, TAU), 1.1], t: [sp[0], 0.07, sp[2]] }));
    // a few ribs still joined, the rest scattered
    const rp = under(0.02, -0.02);
    for (let i = 0; i < 5; i++) {
      const w = 0.1 + i * 0.012;
      const g = tube(
        [
          [-w, 0.0, 0],
          [-w * 0.8, 0.07, 0.02],
          [0, 0.11, 0.03],
          [w * 0.8, 0.07, 0.02],
          [w, 0.0, 0],
        ],
        0.006,
        3,
        { samples: 8 }
      );
      b.add(xf(bone(g), { r: [R.range(-0.5, -0.2), 0.8, R.range(-0.15, 0.15)], t: [rp[0] + i * 0.035 - 0.07, 0.006, rp[2] + i * 0.03] }));
    }
    b.cylCollider(0, 2, 0, 0.2, 4);
    return b.build();
  },
  { kind: 'structure' }
);
