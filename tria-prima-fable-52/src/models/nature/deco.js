// What is left lying on Morne: a rotten stump, a windthrown trunk, a carcass picked clean, a skull.
import { Builder, Rng, Noise, TAU, MAT, col, paint, ico, flat, smooth, deform, xf } from '../kit.js';
import { register } from '../registry.js';
import { growSkeleton, meshLimbs, addRoots, Soup, clamp01, lerp, smooth01, V3 } from './_shared.js';

const DECO = { kind: 'deco', variants: 4 };

// ---------------------------------------------------------------------------------------------
// stump: what the storm left of a tree, 0.6 m. Snapped, not sawn: a torn rim round a black rot
// hole, bracket fungus on the weather side, roots gripping the ground.
// ---------------------------------------------------------------------------------------------
register(
  'stump',
  (seed) => {
    const R = new Rng(seed * 7919 + 4001);
    const nz = new Noise(seed * 13 + 4001);
    const r0 = R.range(0.23, 0.31),
      H = R.range(0.3, 0.46);
    const skel = growSkeleton(seed * 104729 + 4001, { len: H, radius: r0, tip: 0.84, segs: 5, gnarl: 0.05, root: 0.3, blunt: true, lean: R.range(0, 0.1) });
    addRoots(skel, new Rng(seed * 31 + 4002), { count: [3, 5], radius: 0.32, len: [0.6, 1.1], y: [0.05, 0.18] });
    const mossAz = R.range(0, TAU);
    const cBark = col('#2b241e'),
      cGrey = col('#59544c'),
      cSoil = col('#12100d'),
      cMoss = col('#2a321f'),
      cHeart = col('#4d453b'),
      cRot = col('#070605');
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? { radial: 5, step: 1 } : { radial: 10, step: 1 }),
      mat: MAT.WOOD,
      rough: 0.95,
      flare: 0.55,
      flareH: 0.3,
      burl: 0.1,
      lobes: 0.22,
      colour: (v, c) => {
        if (v.cap) {
          // the break: grey heartwood round a black rot hole
          c.copy(v.r > 0 ? cHeart : cRot);
          return;
        }
        const n = nz.n3(Math.cos(v.a) * 1.4, Math.sin(v.a) * 1.4, v.s * 2.2 + v.rnd * 31) * 0.5 + 0.5;
        c.copy(cBark).lerp(cGrey, clamp01(0.12 + 0.62 * n) * (0.35 + 0.65 * clamp01(v.y / 0.4)));
        // moss on the weather side and along the tops of the roots
        const side = Math.cos(Math.atan2(v.nz, v.nx) - mossAz) * 0.5 + 0.5;
        const m = clamp01((side * 0.9 + v.ny * 0.8 + n * 0.5 - 1.15) * 2.4);
        c.lerp(cMoss, m * 0.6);
        if (v.y < 0.1) c.lerp(cSoil, clamp01((0.1 - v.y) / 0.16) * 0.85);
      },
    });
    const trunk = skel.limbs[0];
    const P = geo.attributes.position;
    const at = (ring, j, out) => out.fromBufferAttribute(P, ring.base + (((j % ring.count) + ring.count) % ring.count));
    const s = new Soup();
    const a = new V3(),
      b = new V3(),
      c = new V3(),
      n = new V3(),
      t = new V3();
    // shards of the trunk left standing on the rim
    const rim = trunk.rings[trunk.rings.length - 1];
    const cSh0 = col('#39322b'),
      cSh1 = col('#6d6458');
    const nS = R.int(2, 4);
    for (let i = 0; i < nS; i++) {
      const j = R.int(0, rim.count - 1);
      at(rim, j, a);
      at(rim, j + 1, b);
      c.copy(a).lerp(b, R.range(0.3, 0.7));
      n.set(c.x, 0, c.z).normalize();
      c.addScaledVector(n, R.range(-0.04, 0.02));
      c.y = Math.max(a.y, b.y) + R.range(0.08, 0.22);
      s.tri(a, b, c, cSh0, cSh0, cSh1);
    }
    // bracket fungus: pale shelves, one above another
    const cTop = col('#6b6150'),
      cEdge = col('#a39a84'),
      cUnder = col('#857c69');
    const nB = R.int(2, 4);
    let jB = 0,
      best = -2;
    for (let j = 0; j < rim.count; j++) {
      at(rim, j, a);
      const k = Math.cos(Math.atan2(a.z, a.x) - mossAz);
      if (k > best) {
        best = k;
        jB = j;
      }
    }
    for (let i = 0; i < nB; i++) {
      const ring = trunk.rings[R.int(3, trunk.rings.length - 2)];
      const j = jB + R.int(-1, 1);
      at(ring, j, a);
      at(ring, j + 1, b);
      a.lerp(b, R.next());
      a.y += R.range(-0.05, 0.05);
      n.set(a.x, 0, a.z).normalize();
      t.set(-n.z, 0, n.x);
      const rb = R.range(0.06, 0.11),
        thick = rb * 0.42,
        droop = R.range(0, 0.25);
      a.addScaledVector(n, -0.03);
      b.copy(a);
      b.y -= thick;
      const K = 4;
      let prev = null;
      for (let k = 0; k <= K; k++) {
        const an = (k / K - 0.5) * Math.PI * 0.96;
        const p = new V3()
          .copy(a)
          .addScaledVector(n, 0.03 + Math.cos(an) * rb)
          .addScaledVector(t, Math.sin(an) * rb * 1.25);
        p.y -= Math.cos(an) * rb * droop + thick * 0.25;
        if (prev) {
          s.tri(a, prev, p, cTop, cEdge, cEdge);
          s.tri(b, p, prev, cUnder, cEdge, cEdge);
        }
        prev = p;
      }
    }
    const extra = s.build(MAT.PLAIN, 0.85);
    return new Builder()
      .add(geo, extra)
      .cylCollider(0, 0.25, 0, r0 * 1.05, 0.5)
      .build();
  },
  DECO
);

// ---------------------------------------------------------------------------------------------
// log: a windthrown trunk, 3 to 5 m, lying along X. The butt end still carries its plate of torn
// roots and a clod of earth; the other end snapped where it struck. Boughs it fell on are gone.
// ---------------------------------------------------------------------------------------------
register(
  'log',
  (seed) => {
    const R = new Rng(seed * 7919 + 4101);
    const nz = new Noise(seed * 13 + 4101);
    const L = R.range(3, 5),
      r0 = R.range(0.2, 0.27);
    const yOff = r0 * 0.88; // height of the axis: the trunk has settled a little into the ground
    const stub = { count: [4, 6], from: 0.18, to: 0.92, angle: [0.9, 1.4], len: [0.14, 0.4], lenAbs: true, radius: [0.35, 0.55], segs: 2, gnarl: 0.12, tip: 0.8, blunt: true };
    const twig = { count: [0, 2], from: 0.3, to: 0.9, angle: [0.6, 1.0], len: [0.35, 0.6], radius: [0.5, 0.7], segs: 2, gnarl: 0.25, tip: 0.3, breakChance: 0.6 };
    const bough = { count: [2, 3], from: 0.4, to: 0.88, angle: [0.7, 1.15], len: [0.7, 1.4], lenAbs: true, radius: [0.45, 0.6], segs: 4, gnarl: 0.22, kink: 0.3, tip: 0.5, blunt: true, children: [twig] };
    const skel = growSkeleton(seed * 104729 + 4101, { len: L, radius: r0, tip: 0.6, segs: 7, gnarl: 0.045, root: 0, blunt: true, leanAz: 0, children: [stub, bough] });
    const trunk = skel.limbs[0];
    // the root plate: torn roots standing out round the butt
    const nR = R.int(6, 8);
    let az = R.range(0, TAU);
    for (let i = 0; i < nR; i++) {
      az += TAU / nR + R.range(-0.3, 0.3);
      const dx = Math.cos(az),
        dz = Math.sin(az),
        len = R.range(0.3, 0.7),
        rr = r0 * R.range(0.28, 0.42),
        back = R.range(0.1, 0.42);
      const pts = [new V3(dx * r0 * 0.5, 0.18, dz * r0 * 0.5), new V3(dx * (r0 + len * 0.4), 0.02 - back * 0.3, dz * (r0 + len * 0.4)), new V3(dx * (r0 + len), -back + R.range(-0.08, 0.08), dz * (r0 + len))];
      const d1 = pts[0].distanceTo(pts[1]),
        d2 = pts[1].distanceTo(pts[2]);
      skel.limbs.push({ id: skel.limbs.length, depth: 1, parent: trunk, sAttach: 0, pts, rad: [rr, rr * 0.7, rr * 0.4], s: [0, d1, d1 + d2], broken: true, capped: false, rnd: R.next(), tag: 'root', spec: {}, full: d1 + d2, length: d1 + d2, k: 0, extra0: 0 });
    }
    // the model is grown upright and then laid down: old +x ends up pointing into the ground
    const gone = new Set();
    const pick = (l) => {
      if (l.tag === 'root') return { radial: 4, step: 1 };
      if (l.parent && gone.has(l.parent.id)) {
        gone.add(l.id);
        return null;
      }
      if (l.depth >= 1 && l.pts[l.pts.length - 1].x > yOff + 0.1) {
        gone.add(l.id);
        return null;
      }
      return l.depth === 0 ? { radial: 8, step: 1 } : l.depth === 1 ? { radial: 5, step: 1 } : { radial: 3, step: 1 };
    };
    const cBark = col('#2a231d'),
      cGrey = col('#5c5750'),
      cSoil = col('#110f0c'),
      cMoss = col('#2c3420'),
      cHeart = col('#5a5147'),
      cRot = col('#0c0a08');
    const geo = meshLimbs(skel, {
      pick,
      mat: MAT.WOOD,
      rough: 0.95,
      flare: 0.3,
      flareH: 0.35,
      burl: 0.2,
      lobes: 0.18,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(v.r > 0 ? cHeart : cRot);
          return;
        }
        const up = -v.nx;
        const n = nz.n3(Math.cos(v.a) * 1.4, Math.sin(v.a) * 1.4, v.s * 1.7 + v.rnd * 31) * 0.5 + 0.5;
        // bark has sloughed off the top in sheets and left grey wood
        c.copy(cBark).lerp(cGrey, clamp01(0.1 + 0.55 * n + 0.45 * up * smooth01(0.4, 0.62, n)));
        const m = clamp01((up * 1.1 + nz.n3(v.x * 2.3, v.y * 1.1, v.z * 2.3) * 0.9 - 0.85) * 2.6);
        c.lerp(cMoss, m * 0.7);
        if (up < 0) c.lerp(cSoil, clamp01(-up) * 0.55);
        if (v.limb.tag === 'root') c.lerp(cSoil, 0.5);
      },
    });
    // the clod of earth the roots tore out
    let clod = ico(1, 2);
    const cz = new Noise(seed * 13 + 4102);
    deform(clod, (p) => {
      const k = 1 + cz.fbm3(p.x * 1.7, p.y * 1.7, p.z * 1.7, 2) * 0.35;
      p.set(p.x * r0 * 1.55 * k, p.y * 0.2 * k - 0.05, p.z * r0 * 1.55 * k);
    });
    clod = flat(clod);
    const cE0 = col('#0f0d0b'),
      cE1 = col('#2b2520');
    const tmp = col('#000000');
    paint(clod, { color: (v) => tmp.copy(cE0).lerp(cE1, clamp01(cz.n3(v.x * 6, v.y * 6, v.z * 6) * 0.5 + 0.5)), rough: 1, mat: MAT.PLAIN });
    const lay = { r: [0, 0, -Math.PI / 2], t: [-L / 2, yOff, 0] };
    xf(geo, lay);
    xf(clod, lay);
    return new Builder()
      .add(geo, clod)
      .boxCollider(0, yOff * 0.95, 0, L / 2, yOff * 0.95, r0)
      .build();
  },
  DECO
);

// ---------------------------------------------------------------------------------------------
// bones: something that died here and was picked clean, 1 m. The spine lies in the dirt, the ribs
// stand up from it like fingers, some snapped, a few fallen; long bones dragged a little way off.
// ---------------------------------------------------------------------------------------------
register(
  'bones',
  (seed) => {
    const R = new Rng(seed * 7919 + 4201);
    const s = new Soup();
    const cBone = col('#958a74'),
      cPale = col('#bdb39d'),
      cOld = col('#5f5747'),
      cDirt = col('#3a3429');
    const yaw = R.range(0, TAU),
      roll = R.range(0.12, 0.45) * R.sign(),
      Ls = R.range(0.72, 0.92),
      bow = R.range(-0.1, 0.1),
      Rc = R.range(0.16, 0.2),
      sweep = R.range(0.22, 0.38);
    const nV = R.int(10, 12),
      nRib = Math.min(nV - 3, 7);
    const ys = 0.03;
    const spineAt = (t) => new V3(bow * Math.sin(t * Math.PI), ys + 0.01 * Math.sin(t * 9 + seed), (0.5 - t) * Ls);
    // vertebrae: beads, a hair apart
    for (let k = 0; k < nV; k++) {
      const a = spineAt(k / nV),
        b = spineAt((k + 0.8) / nV),
        m = a.clone().lerp(b, 0.5);
      const rv = 0.021 * (1 - 0.3 * Math.abs(k / (nV - 1) - 0.35));
      s.tube([a, m, b], [rv * 0.55, rv, rv * 0.55], cOld, cBone, 0, 0, 4);
    }
    // ribs, in pairs, from the front of the spine back
    const cr = Math.cos(roll),
      sr = Math.sin(roll);
    for (let k = 0; k < nRib; k++) {
      const P = spineAt((k + 1.3) / nV);
      const Rk = Rc * (0.68 + 0.32 * Math.sin((Math.PI * (k + 0.8)) / (nRib + 0.6)));
      for (const sg of [-1, 1]) {
        const broken = R.chance(0.3),
          th1 = broken ? R.range(0.7, 1.5) : R.range(2.0, 2.55),
          wob = R.range(-0.12, 0.12),
          sq = R.range(0.9, 1.12),
          missing = R.chance(0.1);
        if (missing) continue;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const th = 0.1 + ((th1 - 0.1) * i) / 4;
          const lx = sg * Rk * Math.sin(th) * sq,
            ly = Rk * (1 - Math.cos(th)) * 1.12,
            lz = -sweep * Rk * th + wob * Rk * th * 0.5;
          pts.push(new V3(P.x + lx * cr - ly * sr, P.y + lx * sr + ly * cr, P.z + lz));
        }
        s.tube(pts, [0.0115, 0.011, 0.0098, 0.0082, broken ? 0.007 : 0], cOld, broken ? cBone : cPale, 0, 0, 3);
      }
    }
    // ribs that have dropped off and lie flat
    const nLoose = R.int(1, 3);
    for (let i = 0; i < nLoose; i++) {
      const an = R.range(0, TAU),
        d = R.range(0.22, 0.42),
        rot = R.range(0, TAU),
        Rk = Rc * R.range(0.75, 1),
        cx = Math.cos(an) * d,
        cz = Math.sin(an) * d;
      const pts = [];
      for (let j = 0; j < 4; j++) {
        const th = rot + (j / 3) * 1.9;
        pts.push(new V3(cx + Math.cos(th) * Rk, 0.012 + 0.006 * j, cz + Math.sin(th) * Rk));
      }
      s.tube(pts, [0.011, 0.0105, 0.009, 0], cDirt, cBone, 0, 0, 3);
    }
    // long bones: a shaft between two knuckles
    const nL = R.int(2, 4);
    for (let i = 0; i < nL; i++) {
      const an = (i / nL) * TAU + R.range(-0.6, 0.6),
        d = R.range(0.3, 0.5),
        dir = R.range(0, TAU),
        len = R.range(0.26, 0.4),
        k = R.range(0.85, 1.15),
        snapped = R.chance(0.3),
        tip = R.range(0, 0.25);
      const c = new V3(Math.cos(an) * d, 0.022 * k, Math.sin(an) * d);
      const ax = new V3(Math.cos(dir), tip, Math.sin(dir)).normalize();
      const T = snapped ? [-0.04, 0, 0.07, 0.16, 0.5, 0.62] : [-0.04, 0, 0.07, 0.16, 0.5, 0.84, 0.93, 1, 1.04];
      const Rr = snapped ? [0, 0.012, 0.022, 0.013, 0.011, 0.0105] : [0, 0.012, 0.022, 0.013, 0.011, 0.013, 0.021, 0.012, 0];
      const pts = T.map((t) => c.clone().addScaledVector(ax, (t - 0.5) * len));
      s.tube(
        pts,
        Rr.map((r) => r * k),
        i % 2 ? cBone : cOld,
        i % 2 ? cOld : cPale,
        0,
        0,
        4
      );
    }
    const g = s.build(MAT.PLAIN, 0.72);
    g.rotateY(yaw);
    return new Builder().add(g).build();
  },
  DECO
);

// ---------------------------------------------------------------------------------------------
// skull: a human skull, 0.2 m, the jaw long gone. It rests the way such skulls do, on its teeth
// and the back of its head, so the sockets look a little upward. The brain case is one skin drawn
// over a ball; the sockets and the nose are dents with a black lid set a little way into each.
// ---------------------------------------------------------------------------------------------
const SX = 0.0315, // socket centres, off the midline
  SY = -0.003,
  NY = -0.027; // the nose
const sockM = (X, Y) => Math.exp(-(((Math.abs(X) - SX) / 0.0165) ** 2) - ((Y - SY) / 0.0155) ** 2);
const noseM = (X, Y) => Math.exp(-((X / 0.011) ** 2) - ((Y - NY) / 0.016) ** 2);
// outlines in the plane of the face, +x toward the ear
const EYE = [
  [-0.016, 0.004],
  [-0.011, 0.014],
  [0.004, 0.0155],
  [0.0155, 0.009],
  [0.0175, -0.004],
  [0.011, -0.0145],
  [-0.004, -0.015],
  [-0.014, -0.008],
];
const NOSE = [
  [0, 0.015],
  [0.006, 0.006],
  [0.0115, -0.006],
  [0.009, -0.013],
  [0.003, -0.0115],
  [0, -0.008],
  [-0.003, -0.0115],
  [-0.009, -0.013],
  [-0.0115, -0.006],
  [-0.006, 0.006],
];

register(
  'skull',
  (seed) => {
    const R = new Rng(seed * 7919 + 4301);
    const nz = new Noise(seed * 13 + 4301);
    const W = R.range(0.96, 1.05),
      Lz = R.range(0.97, 1.04);
    // the skin of the skull before the holes: where the ball's point (ux, uy, uz) ends up
    const skin = (ux, uy, uz, o) => {
      let X = ux * 0.069 * W * (1 - 0.12 * Math.max(0, uz)) * (1 + 0.06 * clamp01(uy)),
        Z = uz * 0.09 * Lz;
      const Y = uy > 0 ? uy * 0.092 : Math.max(uy * 0.05, -0.04);
      const aX = Math.abs(X),
        sg = Math.sign(X);
      if (uz > 0.25) {
        // the face below the sockets stands forward of the ball: the upper jaw in the middle,
        // the cheeks set back on either side of it and wider
        if (uy > -0.86) {
          const zf = 0.0835 * Lz + 0.11 * (Y + 0.004) - 13 * Math.max(0, aX - 0.02) ** 2;
          const wide = lerp(0.062, 0.05, smooth01(-0.03, -0.038, Y));
          Z = lerp(Z, Math.max(Z, zf), smooth01(wide, wide - 0.02, aX) * smooth01(-0.012, -0.024, Y));
        }
        // brow ridge
        Z += 0.0045 * Math.exp(-(((Y - 0.02) / 0.0065) ** 2)) * smooth01(0.058, 0.04, aX);
        // cheekbones
        const ck = Math.exp(-(((aX - 0.05) / 0.012) ** 2) - ((Y + 0.022) / 0.01) ** 2);
        X += sg * 0.005 * ck;
        Z += 0.004 * ck;
      }
      // the hollow of the temple, behind the cheekbone
      const tm = Math.exp(-(((Y + 0.004) / 0.02) ** 2) - ((Z - 0.02) / 0.02) ** 2) * smooth01(0.035, 0.055, aX);
      X -= sg * 0.006 * tm;
      return o.set(X, Y, Z);
    };
    // a blow that broke the vault, on some
    const holed = R.chance(0.4),
      hAz = R.range(-2.6, 2.6),
      hEl = R.range(0.55, 1.1);
    const hole = new V3(Math.sin(hAz) * Math.cos(hEl), Math.sin(hEl), -Math.abs(Math.cos(hAz)) * Math.cos(hEl)).normalize();
    const holeM = (ux, uy, uz) => (holed ? Math.exp(-((Math.acos(clamp01(ux * hole.x + uy * hole.y + uz * hole.z)) / 0.22) ** 2)) : 0);
    let g = ico(1, 5);
    const Q = new V3();
    deform(
      g,
      (p) => {
        const hm = holeM(p.x, p.y, p.z);
        skin(p.x, p.y, p.z, Q);
        if (Q.z > 0.02) Q.z -= 0.03 * sockM(Q.x, Q.y) + 0.026 * noseM(Q.x, Q.y);
        if (hm > 0.01) Q.addScaledVector(p, -0.02 * hm);
        p.copy(Q);
      },
      false
    );
    g = smooth(g);
    const cBone = col('#93886f'),
      cPale = col('#b5ab94'),
      cStain = col('#5d5341'),
      cDirt = col('#3a3428'),
      cShade = col('#2a251d'),
      cHole = col('#050404'),
      cRim = col('#14110d'),
      cTooth = col('#aaa089');
    const tmp = col('#000000');
    const dir = new V3();
    paint(g, {
      color: (v) => {
        const n = nz.fbm3(v.x * 38, v.y * 38, v.z * 38, 3) * 0.5 + 0.5;
        tmp.copy(cBone).lerp(cPale, clamp01(0.25 + v.ny * 0.6) * (0.4 + 0.6 * n));
        tmp.lerp(cStain, clamp01((n - 0.5) * 2.4) * 0.55);
        if (v.y < -0.015) tmp.lerp(cDirt, clamp01((-0.015 - v.y) / 0.05) * 0.6);
        // the dents lie in their own shadow
        if (v.z > 0.02) tmp.lerp(cShade, clamp01(Math.max(sockM(v.x, v.y), noseM(v.x, v.y)) * 1.5) * 0.85);
        if (holed) {
          dir.set(v.x / 0.069, v.y / 0.092, v.z / 0.09).normalize();
          tmp.lerp(cShade, clamp01(holeM(dir.x, dir.y, dir.z) * 1.6) * 0.85);
        }
        return tmp;
      },
      rough: 0.66,
      mat: MAT.PLAIN,
    });

    const s = new Soup(),
      dark = new Soup();
    // the frame of the skin at a point of the ball
    const frame = (u) => {
      const P = skin(u.x, u.y, u.z, new V3());
      const a = new V3(u.x + 0.02, u.y, u.z).normalize(),
        b = new V3(u.x, u.y + 0.02, u.z).normalize();
      const Pa = skin(a.x, a.y, a.z, new V3()).sub(P),
        Pb = skin(b.x, b.y, b.z, new V3()).sub(P);
      const n = Pa.cross(Pb).normalize();
      if (n.dot(u) < 0) n.negate();
      const ex = new V3(0, 1, 0).cross(n);
      if (ex.lengthSq() < 1e-6) ex.set(1, 0, 0);
      ex.normalize();
      return { P, n, ex, ey: n.clone().cross(ex) };
    };
    // the point of the ball whose skin lies at (tx, ty) on the face
    const facing = (tx, ty) => {
      let ux = tx / 0.064,
        uy = ty / 0.05;
      for (let i = 0; i < 8; i++) {
        skin(ux, uy, Math.sqrt(Math.max(0.01, 1 - ux * ux - uy * uy)), Q);
        ux += (tx - Q.x) / 0.064;
        uy += (ty - Q.y) / (uy > 0 ? 0.092 : 0.05);
      }
      return new V3(ux, uy, Math.sqrt(Math.max(0.01, 1 - ux * ux - uy * uy)));
    };
    // a black lid set `back` behind the skin, sagging by `bowl` in the middle
    const lid = (fr, outline, mirror, back, bowl) => {
      const c = fr.P.clone().addScaledVector(fr.n, -(back + bowl));
      const pts = outline.map(([x, y]) =>
        fr.P.clone()
          .addScaledVector(fr.ex, mirror ? -x : x)
          .addScaledVector(fr.ey, y)
          .addScaledVector(fr.n, -back)
      );
      for (let i = 0; i < pts.length; i++) dark.tri(c, pts[i], pts[(i + 1) % pts.length], cHole, cRim, cRim);
    };
    lid(frame(facing(SX, SY)), EYE, false, 0.0035, 0.008);
    lid(frame(facing(-SX, SY)), EYE, true, 0.0035, 0.008);
    lid(frame(facing(0, NY)), NOSE, false, 0.003, 0.006);
    if (holed) {
      const out = [];
      const nh = 7;
      for (let i = 0; i < nh; i++) {
        const a = (i / nh) * TAU,
          r = R.range(0.011, 0.021);
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      lid(frame(hole), out, false, 0.006, 0.006);
    }
    // the ridge of the upper jaw, and what is left of the teeth in it
    const arch = (f, y, k, o) => o.set(Math.sin(f) * 0.031 * k, y, (0.042 + Math.cos(f) * 0.038 * k) * Lz);
    const a = new V3(),
      b = new V3(),
      c = new V3(),
      d = new V3();
    const cJaw = cBone.clone().multiplyScalar(0.92),
      cJawTop = cBone.clone().multiplyScalar(0.7);
    const nA = 10;
    const palate = new V3(0, -0.049, 0.04 * Lz);
    for (let i = 0; i < nA; i++) {
      const f0 = -1.75 + (3.5 * i) / nA,
        f1 = -1.75 + (3.5 * (i + 1)) / nA;
      arch(f0, -0.034, 0.88, a);
      arch(f1, -0.034, 0.88, b);
      arch(f1, -0.053, 1, c);
      arch(f0, -0.053, 1, d);
      s.tri(a, d, b, cJawTop, cJaw, cJawTop);
      s.tri(b, d, c, cJawTop, cJaw, cJaw);
      s.tri(palate, c, d, cShade, cStain, cStain);
    }
    const nT = 14;
    let longest = 0;
    for (let i = 0; i < nT; i++) {
      const f0 = -1.5 + (3 * (i + 0.1)) / nT,
        f1 = -1.5 + (3 * (i + 0.9)) / nT,
        mid = Math.abs(i + 0.5 - nT / 2), // 0.5 at the front pair
        len = (mid < 2 ? 0.0105 : mid < 3 ? 0.0118 : 0.0075) * R.range(0.8, 1.08),
        lost = R.chance(mid < 2 ? 0.4 : 0.22),
        tone = R.range(0.78, 1.05);
      if (lost) continue;
      longest = Math.max(longest, len);
      arch(f0, -0.052, 1.01, a);
      arch(f1, -0.052, 1.01, b);
      arch(f1, -0.052 - len, 0.99, c);
      arch(f0, -0.052 - len, 0.99, d);
      const ct = cTooth.clone().multiplyScalar(tone);
      s.tri(a, d, b, cStain, ct, cStain);
      s.tri(b, d, c, cStain, ct, ct);
    }
    // cheek arches, standing clear of the temples
    for (const sg of [-1, 1]) {
      const pts = [new V3(sg * 0.056 * W, -0.026, 0.052), new V3(sg * 0.0655 * W, -0.0235, 0.027), new V3(sg * 0.06 * W, -0.02, -0.004)];
      s.tube(pts, [0.0048, 0.0036, 0.0042], cBone, cBone, 0, 0, 4);
    }
    const extra = s.build(MAT.PLAIN, 0.62),
      lids = dark.build(MAT.PLAIN, 1);
    // lay it down: tip it back until the back of the head meets the ground too
    const P = g.attributes.position;
    let tilt = 0.2;
    for (let it = 0; it < 24; it++) {
      const ct = Math.cos(tilt),
        st = Math.sin(tilt);
      let front = 1,
        back = 1;
      for (let i = 0; i < P.count; i++) {
        const y = P.getY(i) * ct + P.getZ(i) * st;
        if (P.getZ(i) > 0.02) front = Math.min(front, y);
        else back = Math.min(back, y);
      }
      front = Math.min(front, (-0.052 - longest) * ct + 0.08 * Lz * st); // the teeth
      tilt += (back - front) * 3;
    }
    tilt = Math.max(0.03, Math.min(0.45, tilt));
    const yaw = R.range(-0.25, 0.25);
    const geos = [g, extra, lids];
    let low = 1;
    for (const q of geos) {
      xf(q, { r: [-tilt, 0, 0] });
      q.computeBoundingBox();
      low = Math.min(low, q.boundingBox.min.y);
    }
    for (const q of geos) xf(q, { r: [0, yaw, 0], t: [0, -low, 0] });
    return new Builder().add(geos).sphereCollider(0, 0.086, 0, 0.086).build();
  },
  DECO
);
