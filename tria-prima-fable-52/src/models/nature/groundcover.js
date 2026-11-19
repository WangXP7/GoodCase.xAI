// What grows low on Morne: heather, thorn, bracken, reeds, dry grass and pale mushrooms. It is
// instanced in the thousands, so each plant is a few hundred triangles at most. Flat blades are
// drawn double sided by the material.
import { Builder, Rng, Noise, TAU, MAT, col, paint, dome, cyl, disc, bend, deform } from '../kit.js';
import { register } from '../registry.js';
import { growSkeleton, meshLimbs, makeSway, stations, blade, frond, Soup, clamp01, tris, V3 } from './_shared.js';

const SHRUB = { kind: 'shrub', variants: 4 };

// ---------------------------------------------------------------------------------------------
// shrub_heather: a dark cushion of dead heather, 0.4 m. Wiry upright sprigs, black at the root,
// that still carry last year's flowers, gone the colour of dust and dried blood.
// ---------------------------------------------------------------------------------------------
register(
  'shrub_heather',
  (seed) => {
    const R = new Rng(seed * 7919 + 3001);
    const nz = new Noise(seed * 13 + 3001);
    const rx = R.range(0.3, 0.42),
      rz = rx * R.range(0.75, 1.1),
      hh = R.range(0.15, 0.21);
    const lump = (x, z) => 1 + nz.fbm3(x * 2.1, 0.3, z * 2.1, 2) * 0.3;
    const cTwig = col('#14120d'),
      cBody = col('#23221a'),
      cMauve = col('#4f4051'),
      cRust = col('#4a3122'),
      cGrey = col('#524e45'),
      cSoil = col('#0e0c0a');
    // the cushion under the sprigs
    const g = dome(1, 9, 3);
    deform(g, (p) => {
      const k = lump(p.x, p.z);
      p.x *= rx * k * 0.86;
      p.z *= rz * k * 0.86;
      p.y *= hh * k * 0.9;
    });
    const tmp = col('#000000');
    paint(g, {
      color: (v) => {
        const t = clamp01(v.y / hh);
        return tmp.copy(cSoil).lerp(cTwig, clamp01(t * 3)).lerp(cBody, t * t * 0.7);
      },
      rough: 0.97,
      mat: MAT.PLANT,
      sway: (v) => 0.2 * clamp01(v.y / hh),
    });
    // the sprigs: one thin triangle each, standing out of the cushion
    const s = new Soup();
    const N = R.int(280, 330);
    const a = new V3(),
      b = new V3(),
      c = new V3(),
      d = new V3(),
      dir = new V3(),
      side = new V3();
    const cTip = col('#000000'),
      cBase = col('#000000');
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const rr = Math.pow(u, 0.42) * 0.985,
        th = i * 2.39996 + R.range(-0.3, 0.3);
      const ux = Math.cos(th) * rr,
        uz = Math.sin(th) * rr,
        uy = Math.sqrt(Math.max(0, 1 - rr * rr));
      const k = lump(ux, uz);
      a.set(ux * rx * k * 0.9, uy * hh * k * 0.82, uz * rz * k * 0.9);
      const out = 0.35 + 1.1 * rr * rr * rr;
      dir.set(ux * out + R.range(-0.28, 0.28), 1, uz * out + R.range(-0.28, 0.28)).normalize();
      const len = R.range(0.08, 0.17) * (0.7 + 0.45 * uy),
        w = R.range(0.009, 0.016),
        tw = R.range(0, TAU);
      side.set(Math.cos(tw), 0, Math.sin(tw));
      side.addScaledVector(dir, -side.dot(dir)).normalize();
      b.copy(a).addScaledVector(side, w);
      c.copy(a).addScaledVector(side, -w);
      d.copy(a).addScaledVector(dir, len);
      // the dead flower colour comes in patches across the cushion
      const patch = nz.n2(a.x * 4.5 + 7, a.z * 4.5) * 0.5 + 0.5 + R.range(-0.08, 0.08);
      cTip.copy(patch > 0.55 ? cMauve : patch < 0.38 ? cGrey : cRust).multiplyScalar(R.range(0.7, 1.12));
      cBase.copy(cTwig).lerp(cBody, R.next());
      const s0 = 0.2 * uy;
      s.tri(b, c, d, cBase, cBase, cTip, s0, s0, s0 + 0.45);
    }
    return new Builder().add(g, s.build(MAT.PLANT, 0.95)).build();
  },
  SHRUB
);

// ---------------------------------------------------------------------------------------------
// shrub_thorn: a bare thorn bush, 1 m. Black canes that arch out of one root and back toward the
// ground, side shoots at every joint, a thorn every hand's breadth.
// ---------------------------------------------------------------------------------------------
register(
  'shrub_thorn',
  (seed) => {
    const R = new Rng(seed * 7919 + 3101);
    const twig = { count: [2, 4], from: 0.2, to: 0.95, angle: [0.55, 1.2], len: [0.2, 0.42], radius: [0.55, 0.75], segs: 2, gnarl: 0.3, up: 0.1, tip: 0.2 };
    const cane = {
      atTip: true,
      count: [6, 8],
      angle: [0.12, 0.95],
      len: [0.85, 1.35],
      lenAbs: true,
      radius: [0.5, 0.75],
      azJitter: 0.55,
      segs: 5,
      gnarl: 0.2,
      kink: 0.22,
      up: (u) => 0.3 - 0.78 * u,
      tip: 0.14,
      taperPow: 0.8,
      breakChance: 0.12,
      children: [twig],
    };
    const skel = growSkeleton(seed * 104729 + 3101, { len: 0.05, radius: R.range(0.03, 0.04), tip: 0.95, segs: 2, root: 0.1, capped: true, children: [cane] });
    const sway = makeSway(skel, { amp: 0.85, y0: 0.05, twig: (d) => (d >= 2 ? 0.2 : 0) });
    const cBark = col('#211a15'),
      cGrey = col('#5a4e44'),
      cSoil = col('#0e0b09');
    const geo = meshLimbs(skel, {
      // side shoots are a single spike each
      pick: (l) => (l.depth >= 2 ? { radial: 3, step: 2 } : { radial: 3, step: 1 }),
      sway,
      mat: MAT.WOOD,
      rough: 0.9,
      flare: 0,
      burl: 0,
      lobes: 0,
      colour: (v, c) => {
        c.copy(cBark).lerp(cGrey, clamp01(0.15 + v.ny * 0.6) * (0.4 + 0.3 * clamp01(v.depth / 2)));
        if (v.y < 0.08) c.lerp(cSoil, clamp01((0.08 - v.y) / 0.12));
      },
    });
    // thorns: one triangle each, hooked back toward the root
    const s = new Soup();
    const st = stations(skel, (l) => l.depth >= 1, 0.085, R, { from: 0.1, to: 0.96 });
    const room = Math.max(0, 396 - tris(geo));
    const every = Math.max(1, Math.ceil(st.length / Math.min(70, room)));
    const cTh = col('#15100d'),
      cTip = col('#4c3d31');
    const a = new V3(),
      b = new V3(),
      c = new V3(),
      p = new V3();
    st.forEach((o, i) => {
      const az = R.range(0, TAU),
        len = R.range(0.05, 0.085) * (o.limb.depth === 1 ? 1 : 0.7),
        el = R.range(-0.2, 0.6);
      if (i % every || !room) return;
      p.set(Math.cos(az), el, Math.sin(az));
      p.addScaledVector(o.tan, -p.dot(o.tan)).normalize();
      a.copy(o.pos).addScaledVector(o.tan, -0.01);
      b.copy(o.pos).addScaledVector(o.tan, 0.01);
      c.copy(o.pos).addScaledVector(p, len).addScaledVector(o.tan, -0.012);
      s.tri(a, b, c, cTh, cTh, cTip, sway.limb(o.limb, o.s));
    });
    return new Builder().add(geo, s.build(MAT.WOOD, 0.8)).build();
  },
  SHRUB
);

// ---------------------------------------------------------------------------------------------
// fern_dead: brown bracken, 0.5 m. Last year's fronds on bare stalks: rust and bleached straw,
// the leaflets curled down, most still arching, a few gone flat.
// ---------------------------------------------------------------------------------------------
register(
  'fern_dead',
  (seed) => {
    const R = new Rng(seed * 7919 + 3201);
    const b = new Builder();
    const n = R.int(6, 8);
    const cBase = col('#1a120b'),
      cRust = col('#3b2313'),
      cDark = col('#27180e'),
      cStraw = col('#57462b');
    const tmp = col('#000000');
    let az = R.range(0, TAU);
    for (let i = 0; i < 8; i++) {
      az += TAU / n + R.range(-0.35, 0.35);
      const len = R.range(0.55, 0.8),
        wid = len * R.range(0.5, 0.64),
        teeth = R.int(9, 11),
        fallen = R.chance(0.2),
        tilt = fallen ? R.range(1.2, 1.42) : R.range(0.3, 0.8),
        arch = fallen ? R.range(0.1, 0.4) : R.range(0.8, 1.7),
        start = R.range(0.2, 0.3),
        tone = R.range(0, 1),
        dim = R.range(0.75, 1.1),
        roll = R.range(-0.3, 0.3),
        droop = R.range(0.25, 0.75);
      if (i >= n) continue;
      const g = frond(len, wid, teeth, { sweep: 0.45, belly: 0.16, spine: 0.011, R, start, fill: 0.88, droop });
      paint(g, {
        color: (v) => {
          const t = clamp01(v.y / len),
            e = clamp01(Math.abs(v.x) / (wid * 0.5));
          tmp.copy(cBase).lerp(tone > 0.5 ? cRust : cDark, clamp01(t * 2.8));
          tmp.lerp(cStraw, e * (0.3 + 0.55 * tone) + t * 0.2);
          return tmp.multiplyScalar(dim);
        },
        rough: 0.92,
        mat: MAT.PLANT,
        sway: (v) => 0.1 + 0.6 * Math.pow(clamp01(v.y / len), 2),
      });
      bend(g, arch / (len * (1 - start * 0.7)), len * start * 0.7);
      g.rotateY(roll);
      g.rotateX(-tilt);
      g.rotateY(az);
      g.computeVertexNormals();
      b.add(g);
    }
    return b.build();
  },
  SHRUB
);

// ---------------------------------------------------------------------------------------------
// reeds: a clump of dead bulrush, 1.2 m. Straw stalks, some snapped and hanging; the seed heads
// are the dark clubs that say water is near.
// ---------------------------------------------------------------------------------------------
register(
  'reeds',
  (seed) => {
    const R = new Rng(seed * 7919 + 3301);
    const s = new Soup();
    const n = R.int(8, 11);
    const cBase = col('#2a2619'),
      cStraw = col('#6a6040'),
      cPale = col('#857a55'),
      cHead = col('#2e2018'),
      cHeadHi = col('#49352a');
    const b = new Builder();
    const p0 = new V3(),
      p1 = new V3(),
      p2 = new V3(),
      p3 = new V3(),
      dir = new V3();
    const sw = (y, H) => 0.85 * Math.pow(clamp01(y / H), 1.6);
    let heads = 0;
    for (let i = 0; i < 11; i++) {
      const an = R.range(0, TAU),
        rr = Math.sqrt(R.next()) * 0.15,
        H = R.range(0.62, 1.0),
        lean = R.range(0.02, 0.2),
        la = an + R.range(-0.8, 0.8),
        wantHead = R.chance(0.62),
        snap = R.chance(0.45),
        r0 = R.range(0.007, 0.01),
        hl = R.range(0.11, 0.17),
        hr = R.range(0.015, 0.02),
        sy = R.range(0.35, 0.7),
        sa = R.range(0, TAU),
        dim = R.range(0.8, 1.1),
        spk = R.range(0.05, 0.09);
      if (i >= n) continue;
      const head = wantHead && heads < 7,
        snapped = !head && snap;
      const c0 = cBase.clone().multiplyScalar(dim),
        c1 = (i % 3 ? cStraw : cPale).clone().multiplyScalar(dim);
      p0.set(Math.cos(an) * rr, 0, Math.sin(an) * rr);
      dir.set(Math.cos(la) * lean, 1, Math.sin(la) * lean).normalize();
      p1.copy(p0).addScaledVector(dir, H * 0.5);
      p2.copy(p0).addScaledVector(dir, H);
      p2.x += Math.cos(la) * lean * 0.25;
      p2.z += Math.sin(la) * lean * 0.25;
      if (snapped) {
        // broken over: the top hangs from the break
        p1.copy(p0).addScaledVector(dir, H * sy);
        p3.set(Math.cos(sa) * 0.55, -0.83, Math.sin(sa) * 0.55);
        p2.copy(p1).addScaledVector(p3, Math.min(H * (1 - sy), p1.y * 0.9));
        s.tube([p0.clone(), p1.clone()], [r0, r0 * 0.8], c0, c1, 0, sw(p1.y, H), 3);
        s.tube([p1.clone(), p2.clone()], [r0 * 0.8, 0], c1, c1, sw(p1.y, H), sw(p1.y, H) + 0.3, 3);
        continue;
      }
      s.tube([p0.clone(), p1.clone(), p2.clone()], [r0, r0 * 0.8, head ? r0 * 0.6 : 0], c0, c1, 0, sw(p2.y, H), 3);
      if (head) {
        heads++;
        // the club, and the bare spike above it
        const a1 = p2.clone().addScaledVector(dir, hl * 0.12),
          a2 = p2.clone().addScaledVector(dir, hl * 0.9),
          a3 = p2.clone().addScaledVector(dir, hl),
          a4 = p2.clone().addScaledVector(dir, hl + spk);
        const s0 = sw(p2.y, H),
          s1 = sw(a4.y, H);
        s.tube([p2.clone(), a1, a2, a3], [r0 * 0.6, hr, hr * 0.92, 0], cHead, cHeadHi, s0, s1, 4);
        s.spike(a2, a4, 0.004, cHead, c1, s1, s1);
      }
    }
    // long leaves, most of them folded over
    const nl = R.int(5, 8);
    for (let i = 0; i < 8; i++) {
      const an = R.range(0, TAU),
        rr = Math.sqrt(R.next()) * 0.13,
        len = R.range(0.45, 0.85),
        bd = R.range(0.2, 1.3),
        tilt = R.range(0.08, 0.38),
        dim = R.range(0.7, 1.0);
      if (i >= nl) continue;
      const g = blade(len, 0.03, 3, bd, { pow: 0.9 });
      paint(g, { color: (v) => cBase.clone().lerp(cStraw, clamp01((v.y / len) * 2)).multiplyScalar(dim), rough: 0.9, mat: MAT.PLANT, sway: (v) => sw(v.y, 1.1) });
      g.rotateX(-tilt);
      g.rotateY(an);
      g.translate(-Math.sin(an) * rr, 0, -Math.cos(an) * rr);
      b.add(g);
    }
    return b.add(s.build(MAT.PLANT, 0.88)).build();
  },
  SHRUB
);

// ---------------------------------------------------------------------------------------------
// grass_tall: a tussock of dry grass, 0.7 m. Bleached blades standing out of a dark crown, the
// outer ones bowed over.
// ---------------------------------------------------------------------------------------------
register(
  'grass_tall',
  (seed) => {
    const R = new Rng(seed * 7919 + 3401);
    const b = new Builder();
    const n = R.int(50, 62);
    const cBase = col('#23211a'),
      cA = col('#665f45'),
      cB = col('#514b38'),
      cTip = col('#8a815f');
    const tmp = col('#000000');
    for (let i = 0; i < n; i++) {
      const an = R.range(0, TAU),
        f = Math.sqrt(R.next()), // 0 at the heart of the tussock, 1 at its edge
        rr = f * 0.1,
        len = R.range(0.38, 0.66) * (1.3 - 0.55 * f),
        w = R.range(0.016, 0.03),
        bd = R.range(0.2, 0.9) + f * 0.7,
        tilt = R.range(0.02, 0.2) + f * 0.4,
        tone = R.next(),
        dim = R.range(0.75, 1.1),
        segs = len > 0.45 ? 3 : 2;
      const g = blade(len, w, segs, bd, { pow: 0.8, side: R.range(-0.07, 0.07) });
      paint(g, {
        color: (v) => {
          const t = clamp01(v.y / len);
          return tmp
            .copy(cBase)
            .lerp(tone > 0.45 ? cA : cB, clamp01(t * 2.6))
            .lerp(cTip, t * t * 0.7)
            .multiplyScalar(dim);
        },
        rough: 0.9,
        mat: MAT.PLANT,
        sway: (v) => 0.75 * Math.pow(clamp01(v.y / 0.7), 1.6),
      });
      g.rotateX(-tilt);
      g.rotateY(an);
      g.translate(-Math.sin(an) * rr, 0, -Math.cos(an) * rr);
      b.add(g);
    }
    return b.build();
  },
  SHRUB
);

// ---------------------------------------------------------------------------------------------
// mushrooms: a small pale cluster for logs and roots. Thin-stalked bells the colour of old bone,
// crowded together and leaning out from one another.
// ---------------------------------------------------------------------------------------------
register(
  'mushrooms',
  (seed) => {
    const R = new Rng(seed * 7919 + 3501);
    const b = new Builder();
    const n = R.int(7, 10);
    const cCap = col('#b1a998'),
      cCentre = col('#857b66'),
      cStem = col('#9c9482'),
      cGill = col('#4a4035'),
      cFoot = col('#37322a');
    const tmp = col('#000000');
    let an = R.range(0, TAU);
    for (let i = 0; i < 10; i++) {
      an += 2.39996 + R.range(-0.5, 0.5);
      const big = i < 3,
        cr = big ? R.range(0.022, 0.034) : R.range(0.01, 0.02),
        h = big ? R.range(0.09, 0.16) : R.range(0.04, 0.1),
        bell = R.range(0.8, 1.3),
        dist = i === 0 ? 0 : Math.sqrt(i / 10) * 0.085 * R.range(0.7, 1.2),
        lean = R.range(0.1, 0.55),
        la = Math.atan2(-Math.cos(an), -Math.sin(an)) + R.range(-0.7, 0.7),
        dim = R.range(0.82, 1.05);
      if (i >= n) continue;
      // the stalk: three-sided, bent, thicker at the foot
      const sr = Math.max(0.0035, cr * 0.17);
      const stem = cyl(sr * 0.8, sr * 1.3, h, 3, 2, true);
      stem.translate(0, h / 2, 0);
      bend(stem, lean / h, 0);
      paint(stem, { color: (v) => tmp.copy(cFoot).lerp(cStem, clamp01((v.y / h) * 2.5)).multiplyScalar(dim), rough: 0.8, mat: MAT.PLAIN });
      // the cap: a bell with a lip
      const cap = dome(cr, 6, 2, bell);
      deform(cap, (p) => {
        const t = clamp01(p.y / (cr * bell));
        const k = t < 0.1 ? 1.14 : 1 - 0.12 * t;
        p.x *= k;
        p.z *= k;
        p.y -= cr * 0.18;
      });
      paint(cap, {
        color: (v) => tmp.copy(cCentre).lerp(cCap, clamp01((Math.hypot(v.x, v.z) / cr) * 1.1)).multiplyScalar(dim),
        rough: 0.5,
        mat: MAT.PLAIN,
      });
      const caps = [cap];
      if (big) {
        // the gills, where they can be seen
        const und = disc(cr * 1.1, 6);
        und.translate(0, -cr * 0.17, 0);
        paint(und, { color: cGill, rough: 0.9, mat: MAT.PLAIN });
        caps.push(und);
      }
      for (const g of caps) {
        // the cap sits where the bent stalk ends, square to it
        g.rotateX(-lean);
        g.translate(0, (h / lean) * Math.sin(lean), -(h / lean) * (1 - Math.cos(lean)));
      }
      for (const g of [stem, ...caps]) {
        g.rotateY(la);
        g.translate(Math.cos(an) * dist, 0, Math.sin(an) * dist);
        b.add(g);
      }
    }
    return b.build();
  },
  SHRUB
);
