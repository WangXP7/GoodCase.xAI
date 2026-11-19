// The six trees of Morne. They are bare or nearly bare, so the branching is the whole look.
// opts.lod: 0 full, 1 about a third of the triangles, 2 about a tenth. Same seed, same limbs.
import { Builder, Rng, Noise, TAU, MAT, PAL, col, paint, crystal, xf, gradY } from '../kit.js';
import { register } from '../registry.js';
import { growSkeleton, meshLimbs, makeSway, addRoots, lodPick, stations, sampleLimb, Soup, clamp01, lerp, smooth01, V3 } from './_shared.js';

const lodOf = (opts) => Math.max(0, Math.min(2, (opts && opts.lod) | 0));
const ROOT_PICK = [{ radial: 5, step: 1 }, { radial: 3, step: 2 }, null];

// radial segments and ring step per branching depth, for each lod
const BARE = [
  { maxDepth: 9, radial: [8, 6, 5, 3, 3], step: [1, 1, 1, 1, 2], cap: { 3: 56, 4: 120 } },
  { maxDepth: 4, radial: [6, 4, 3, 3, 3], step: [2, 2, 2, 2, 3], keep: { 4: 3 }, cap: { 3: 56, 4: 120 }, rMul: [1, 1, 1.1, 1.4, 1.9], rMin: 0.012 },
  { maxDepth: 3, radial: [5, 3, 3, 3], step: [3, 3, 3, 4], keep: { 3: 2 }, cap: { 3: 56 }, rMul: [1, 1.1, 1.5, 2.4], rMin: 0.05 },
];

// noise that wraps around the limb
const barkN = (nz, v, f = 1.6) => nz.n3(Math.cos(v.a) * 1.3, Math.sin(v.a) * 1.3, v.s * f + v.rnd * 31) * 0.5 + 0.5;

function assemble(b, geos, r, h, lean = 0) {
  b.add(geos);
  b.cylCollider(0, h / 2, 0, r, h);
  return b.build();
}

// ---------------------------------------------------------------------------------------------
// tree_dead: a leafless gnarled oak. Short thick trunk that splits into heavy tortured boughs.
// ---------------------------------------------------------------------------------------------
register(
  'tree_dead',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 101);
    const H = R.range(7, 11);
    const twig = { count: [2, 4], from: 0.2, to: 1, angle: [0.4, 1.0], len: [0.45, 0.8], radius: [0.65, 0.85], segs: 3, gnarl: 0.35, tip: 0.25 };
    const d3 = { count: [3, 5], from: 0.25, to: 1, angle: [0.5, 1.1], len: [0.45, 0.7], radius: [0.55, 0.7], segs: 4, gnarl: 0.3, kink: 0.25, up: 0.04, tip: 0.14, taperPow: 0.8, breakChance: 0.12, children: [twig] };
    const stub = { count: [1, 3], from: 0.15, to: 0.8, angle: [0.7, 1.3], len: [0.25, 0.7], lenAbs: true, radius: [0.3, 0.45], segs: 2, gnarl: 0.2, tip: 0.6, blunt: true };
    const d2 = { count: [3, 5], from: 0.3, to: 0.97, angle: [0.6, 1.2], len: [0.4, 0.65], lenTip: 0.6, radius: [0.5, 0.68], segs: 5, gnarl: 0.3, kink: 0.3, up: 0.06, tip: 0.1, taperPow: 0.8, breakChance: 0.18, children: [d3] };
    const r0 = R.range(0.36, 0.5);
    const spec = {
      len: Math.max(2.2, H * 0.3),
      radius: r0,
      tip: 0.7,
      segs: 7,
      gnarl: 0.07,
      up: 0.03,
      lean: R.range(0, 0.14),
      capped: true,
      children: [
        { atTip: true, count: [2, 3], angle: [0.4, 0.8], len: [H * 0.45, H * 0.62], lenAbs: true, radius: [0.72, 0.88], azJitter: 0.5, segs: 8, gnarl: 0.24, kink: 0.35, up: 0.06, out: 0.05, tip: 0.07, taperPow: 0.75, breakChance: 0.22, children: [d2, stub] },
        { count: [1, 2], from: 0.5, to: 0.85, angle: [1.1, 1.5], len: [H * 0.32, H * 0.5], lenAbs: true, radius: [0.45, 0.6], segs: 7, gnarl: 0.26, kink: 0.35, up: 0.07, tip: 0.08, taperPow: 0.75, breakChance: 0.4, children: [d2, stub] },
        { ...stub, count: [0, 2], from: 0.35, to: 0.8 },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 101, spec);
    addRoots(skel, new Rng(seed * 31 + 106), { count: [4, 6], radius: 0.36, len: [1.0, 2.0] });
    const sway = makeSway(skel, { amp: 2.2 });
    const nz = new Noise(seed * 17 + 3);
    const cBark = col(PAL.bark),
      cDark = col(PAL.barkDark),
      cGrey = col(PAL.woodGrey),
      cMoss = col(PAL.moss),
      cHeart = col('#3a2f25'),
      cSoil = col('#120f0c');
    const pick = lodPick(lod, BARE, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? ROOT_PICK[lod] : pick(l)),
      sway,
      mat: MAT.WOOD,
      rough: 0.95,
      flare: 0.7,
      burl: 0.26,
      lobes: 0.2,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cHeart).multiplyScalar(0.5 + 0.5 * v.rnd);
          return;
        }
        c.copy(cDark).lerp(cBark, barkN(nz, v, 1.8));
        const thin = clamp01(v.depth / 3);
        c.lerp(cGrey, clamp01(0.15 + v.ny * 0.45) * (0.3 + 0.55 * thin));
        if (v.depth === 0) {
          const m = clamp01(1 - v.y / 1.6) * clamp01(nz.n2(Math.cos(v.a) * 2 + 4, v.s * 1.3) * 0.8 + 0.45);
          c.lerp(cMoss, m * 0.55);
        }
        if (v.y < 0.25) c.lerp(cSoil, clamp01((0.25 - v.y) / 0.45));
      },
    });
    return assemble(new Builder(), [geo], r0 * 1.15, Math.min(3.2, H * 0.34));
  },
  { kind: 'tree', lods: 3, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// tree_birch: thin and pale, peeling bark with dark scars, a few rust leaves left.
// ---------------------------------------------------------------------------------------------
const BIRCH = [
  { maxDepth: 9, radial: [6, 4, 3, 3], step: [1, 1, 1, 2] },
  { maxDepth: 3, radial: [5, 3, 3, 3], step: [2, 2, 2, 3], keep: { 3: 3 }, rMul: [1, 1.1, 1.4, 2.0], rMin: 0.01 },
  { maxDepth: 2, radial: [4, 3, 3], step: [5, 3, 4], keep: { 2: 2 }, rMul: [1.1, 1.6, 2.6], rMin: 0.04 },
];
register(
  'tree_birch',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 211);
    const H = R.range(6, 9);
    const d3 = { count: [1, 3], from: 0.3, to: 1, angle: [0.3, 0.8], len: [0.5, 0.9], radius: [0.6, 0.7], segs: 3, gnarl: 0.15, up: -0.12, tip: 0.15 };
    const d2 = { count: [3, 5], from: 0.25, to: 1, angle: [0.4, 0.9], len: [0.3, 0.55], radius: [0.5, 0.65], segs: 4, gnarl: 0.14, up: -0.05, tip: 0.2, children: [d3] };
    const r0 = R.range(0.085, 0.125);
    const spec = {
      len: H * 0.93,
      radius: r0,
      tip: 0.1,
      taperPow: 1.2,
      segs: 20,
      gnarl: 0.03,
      up: 0.012,
      lean: R.range(0.02, 0.12),
      children: [
        {
          count: [9, 13],
          from: 0.32,
          to: 0.97,
          angle: [0.45, 0.8],
          len: (f, Rr) => lerp(H * 0.3, H * 0.1, f) * Rr.range(0.7, 1.1),
          lenAbs: true,
          radius: [0.35, 0.5],
          segs: 6,
          gnarl: 0.1,
          up: (u) => 0.08 - 0.14 * u,
          tip: 0.15,
          breakChance: 0.12,
          children: [d2],
        },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 211, spec);
    addRoots(skel, new Rng(seed * 31 + 216), { count: [3, 4], radius: 0.5, len: [0.5, 1.0], y: [0.05, 0.18] });
    const sway = makeSway(skel, { amp: 3.0, twig: (d) => (d >= 1 ? 0.3 * d : 0) });
    const nz = new Noise(seed * 17 + 5);
    const cWhite = col('#bfbbae'),
      cCream = col('#a59f8f'),
      cScar = col('#1a1614'),
      cTwig = col('#2a1c19'),
      cFoot = col('#2b2622'),
      cSoil = col('#120f0c');
    // dark eyebrow scars where a branch leaves the trunk
    const scarS = skel.limbs.filter((l) => l.depth === 1 && l.tag !== 'root').map((l) => l.sAttach);
    const pick = lodPick(lod, BIRCH, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? ROOT_PICK[lod] : pick(l)),
      sway,
      mat: MAT.WOOD,
      rough: (v) => (v.depth === 0 ? 0.7 : 0.9),
      flare: 0.5,
      flareH: 0.25,
      burl: 0.05,
      lobes: 0.05,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cCream).multiplyScalar(0.6);
          return;
        }
        if (v.limb.tag === 'root') {
          c.copy(cFoot);
          if (v.y < 0.1) c.lerp(cSoil, clamp01((0.1 - v.y) / 0.3));
          return;
        }
        const n = barkN(nz, v, 2.6);
        if (v.depth === 0) {
          c.copy(cCream).lerp(cWhite, n);
          let scar = 0;
          for (const s of scarS) scar = Math.max(scar, 1 - Math.abs(v.s - s) / 0.3);
          c.lerp(cScar, clamp01(scar) * 0.75);
          const band = nz.n2(v.s * 3.3, 7.7 + Math.cos(v.a));
          if (band > 0.45) c.lerp(cScar, (band - 0.45) * 1.3);
          c.lerp(cFoot, clamp01(1 - v.y / 1.1) * 0.9);
          if (v.y < 0.1) c.lerp(cSoil, clamp01((0.1 - v.y) / 0.3));
        } else if (v.depth === 1) {
          c.copy(cCream).lerp(cWhite, n).lerp(cTwig, clamp01(v.t * 1.5));
        } else c.copy(cTwig).multiplyScalar(0.8 + 0.5 * n);
      },
    });
    const parts = [geo];

    // lenticels: thin dark dashes that hug the trunk
    if (lod < 2) {
      const LR = new Rng(seed * 59 + 7);
      const sp = new Soup();
      const dark = col('#110e0c');
      const trunk = skel.limbs[0];
      const P = geo.attributes.position,
        Nr = geo.attributes.normal;
      const a = new V3(),
        b = new V3(),
        c = new V3(),
        up = new V3(),
        nrm = new V3();
      const at = (ring, j, out) => out.fromBufferAttribute(P, ring.base + (((j % ring.count) + ring.count) % ring.count));
      const rings = trunk.rings || [];
      const n = lod === 0 ? 46 : 20;
      for (let i = 0; i < n; i++) {
        const k = LR.int(1, Math.max(1, rings.length - 5));
        const j = LR.int(0, 5),
          f = LR.next(),
          hgt = LR.range(0.006, 0.016),
          wide = LR.range(0.5, 1.0);
        const r0k = rings[k],
          r1k = rings[k + 1];
        if (!r0k || !r1k || r0k.count < 3 || r1k.count < 3 || r0k.count !== r1k.count) continue;
        const pt = (jj, out) => {
          at(r0k, jj, a);
          at(r1k, jj, b);
          return out.lerpVectors(a, b, f);
        };
        const pm = pt(j, new V3()),
          pl = pt(j - 1, new V3()),
          pr = pt(j + 1, new V3());
        if (pm.y < 0.7) continue;
        nrm.fromBufferAttribute(Nr, r0k.base + (j % r0k.count));
        pl.lerpVectors(pm, pl, 0.5 * wide);
        pr.lerpVectors(pm, pr, 0.5 * wide);
        up.subVectors(at(r1k, j, b), at(r0k, j, a)).normalize().multiplyScalar(hgt);
        for (const q of [pm, pl, pr]) q.addScaledVector(nrm, 0.003);
        const quad = (p0, p1) => {
          a.copy(p0).sub(up);
          b.copy(p1).sub(up);
          c.copy(p1).add(up);
          const d = new V3().copy(p0).add(up);
          sp.tri(a, b, c, dark, dark, dark).tri(a, c, d, dark, dark, dark);
        };
        quad(pl, pm);
        quad(pm, pr);
      }
      const g = sp.build(MAT.PLAIN, 0.95);
      if (g) parts.push(g);
    }

    // the last leaves
    if (lod < 2) {
      const LR = new Rng(seed * 67 + 23);
      const sp = new Soup();
      const cols = [col('#6e3516'), col('#8a6524'), col('#4a3a26'), col('#7a4a1c')];
      const st = stations(skel, (l) => l.depth >= 3, 0.26, LR, { from: 0.3 });
      const p0 = new V3(),
        pl = new V3(),
        pr = new V3(),
        pb = new V3();
      st.forEach((q, i) => {
        const keep = LR.next(),
          yaw = LR.range(0, TAU),
          tilt = LR.range(-0.7, 0.7),
          size = LR.range(0.04, 0.065),
          ci = LR.int(0, 3);
        if (keep > 0.5) return;
        if (lod === 1 && i % 3) return;
        const k = lod === 1 ? 1.9 : 1;
        const sw = sway.limb(q.limb, q.s);
        const ux = Math.cos(yaw) * size * 0.4 * k,
          uz = Math.sin(yaw) * size * 0.4 * k;
        const dx = -Math.sin(yaw) * Math.sin(tilt) * size * k,
          dy = -Math.cos(tilt) * size * k,
          dz = Math.cos(yaw) * Math.sin(tilt) * size * k;
        p0.copy(q.pos);
        pl.set(q.pos.x + dx * 0.5 - ux, q.pos.y + dy * 0.5, q.pos.z + dz * 0.5 - uz);
        pr.set(q.pos.x + dx * 0.5 + ux, q.pos.y + dy * 0.5, q.pos.z + dz * 0.5 + uz);
        pb.set(q.pos.x + dx, q.pos.y + dy, q.pos.z + dz);
        const cc = cols[ci];
        sp.tri(p0, pl, pr, cc, cc, cc, sw, sw + 0.4, sw + 0.4).tri(pl, pb, pr, cc, cc, cc, sw + 0.4, sw + 0.7, sw + 0.4);
      });
      const g = sp.build(MAT.PLANT, 0.8);
      if (g) parts.push(g);
    }
    return assemble(new Builder(), parts, r0 * 1.4, 3.0);
  },
  { kind: 'tree', lods: 3, variants: 5 }
);

// ---------------------------------------------------------------------------------------------
// tree_pine: a ragged dark fir. Dead snags low on the trunk, sparse drooping boughs above.
// ---------------------------------------------------------------------------------------------
const PINE = [
  { maxDepth: 3, radial: [7, 3, 3, 3], step: [1, 1, 1, 1] },
  { maxDepth: 1, radial: [5, 3], step: [2, 2], rMin: 0.015 },
  { maxDepth: 1, radial: [4, 3], step: [4, 4], rMin: 0.06 },
];
/**
 * The needles of a fir bough hang from it as two ragged curtains splayed apart like a tent, so
 * the bough has mass from the side, from the end and from above. The lower edge follows noise
 * along the bough, which keeps the same outline at every lod.
 */
function firNeedles(skel, seed, lod, sway) {
  const sp = new Soup();
  const nz = new Noise(seed * 23 + 5);
  const cIn = col('#080d09'),
    cTip = col('#18251a'),
    cDead = col('#2b2016'),
    cDeadTip = col('#4f3d27');
  const side = new V3(),
    T0 = new V3(),
    T1 = new V3(),
    L0 = new V3(),
    L1 = new V3(),
    R0 = new V3(),
    R1 = new V3();
  const o = { pos: new V3(), tan: new V3(), rad: 0 };
  const c0 = cIn.clone(),
    c1 = cIn.clone(),
    e0 = cTip.clone(),
    e1 = cTip.clone();
  for (const limb of skel.limbs) {
    if (limb.tag !== 'live') continue;
    if (lod >= 1 && limb.depth > 1) continue;
    const L = limb.length;
    if (L < 0.3) continue;
    const LR = new Rng((seed * 977 + limb.id * 131) >>> 0);
    const main = limb.depth === 1;
    const splay = LR.range(0.5, 0.85);
    const hang = (main ? Math.max(0.16, Math.min(1.0, L * 0.32)) : Math.max(0.14, Math.min(0.5, L * 0.5))) * LR.range(0.75, 1.15) * (lod === 0 ? 1 : lod === 1 ? 1.3 : 1.7);
    const stepLen = lod === 0 ? (main ? 0.17 : 0.15) : lod === 1 ? 0.5 : 1.6;
    const sStart = L * (main ? 0.13 : 0.06);
    const n = Math.max(1, Math.min(lod === 2 ? 2 : 40, Math.round((L - sStart) / stepLen)));
    const sn = Math.sin(splay),
      cs = Math.cos(splay);
    let sw0 = 0,
      swb0 = 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const s = lerp(sStart, L, u);
      sampleLimb(limb, s, o);
      side.set(o.tan.z, 0, -o.tan.x);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      // long belly, nothing left at the tip
      const prof = lerp(0.5, 1, smoothK(u / 0.3)) * (1 - Math.pow(u, 3.2));
      const gap = nz.n2(s * 1.25 + 80, limb.id * 2.1) > 0.42 ? 0.16 : 1;
      const jl = 0.62 + 0.5 * nz.n2(s * 3.1, limb.id * 3.7) + 0.2 * nz.n2(s * 9.0, limb.id * 1.9),
        jr = 0.62 + 0.5 * nz.n2(s * 3.1 + 31, limb.id * 3.7 + 9) + 0.2 * nz.n2(s * 9.0 + 5, limb.id * 1.9 + 3);
      // every other station hangs short, so the lower edge is a row of uneven tatters
      const zl = lod === 2 ? 1 : i % 2 ? 0.42 : 1,
        zr = lod === 2 ? 1 : i % 2 ? 1 : 0.42;
      const dl = i === n && !limb.broken ? 0 : hang * prof * gap * Math.max(0.2, jl) * zl,
        dr = i === n && !limb.broken ? 0 : hang * prof * gap * Math.max(0.2, jr) * zr;
      const dead = nz.n2(s * 0.8 + 40, limb.id * 1.3) > 0.34;
      T1.copy(o.pos);
      L1.copy(o.pos).addScaledVector(side, -sn * dl).addScaledVector(o.tan, dl * 0.3);
      L1.y -= cs * dl;
      R1.copy(o.pos).addScaledVector(side, sn * dr).addScaledVector(o.tan, dr * 0.3);
      R1.y -= cs * dr;
      c1.copy(dead ? cDead : cIn);
      e1.copy(dead ? cDeadTip : cTip).multiplyScalar(0.75 + 0.5 * LR.next());
      const sw1 = sway.limb(limb, s),
        swb1 = sw1 + 0.25 + 0.5 * Math.max(dl, dr);
      if (i > 0) {
        sp.tri(T0, T1, L0, c0, c1, e0, sw0, sw1, swb0);
        if (dl > 0.01) sp.tri(T1, L1, L0, c1, e1, e0, sw1, swb1, swb0);
        sp.tri(T1, T0, R0, c1, c0, e0, sw1, sw0, swb0);
        if (dr > 0.01) sp.tri(T1, R0, R1, c1, e0, e1, sw1, swb0, swb1);
      }
      T0.copy(T1);
      L0.copy(L1);
      R0.copy(R1);
      c0.copy(c1);
      e0.copy(e1);
      sw0 = sw1;
      swb0 = swb1;
    }
  }
  return sp.build(MAT.PLANT, 0.92);
}
const smoothK = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
register(
  'tree_pine',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 307);
    const H = R.range(10, 16);
    const r0 = R.range(0.2, 0.3);
    const spec = {
      len: H,
      radius: r0,
      tip: 0.05,
      segs: 14,
      gnarl: 0.02,
      up: 0.02,
      lean: R.range(0, 0.06),
      children: [
        {
          tag: 'dead',
          count: [7, 11],
          from: 0.08,
          to: 0.4,
          angle: [1.2, 1.75],
          len: [0.5, 1.9],
          lenAbs: true,
          radius: [0.2, 0.3],
          segs: 4,
          gnarl: 0.12,
          up: -0.06,
          tip: 0.3,
          breakChance: 0.7,
          children: [{ tag: 'dead', count: [0, 2], from: 0.3, to: 0.9, angle: [0.5, 1.1], len: [0.25, 0.5], radius: [0.5, 0.6], segs: 2, gnarl: 0.2, tip: 0.2 }],
        },
        {
          tag: 'live',
          count: [30, 38],
          from: 0.34,
          to: 0.985,
          angle: (f, Rr) => lerp(1.9, 0.95, f) + Rr.range(-0.15, 0.15),
          len: (f, Rr) => lerp(H * 0.23, H * 0.035, Math.pow(f, 0.85)) * Rr.range(0.55, 1.15),
          lenAbs: true,
          radius: [0.14, 0.22],
          segs: 5,
          gnarl: 0.06,
          up: (u) => -0.07 + 0.16 * u,
          tip: 0.2,
          breakChance: 0.1,
          children: [{ tag: 'live', count: [1, 3], from: 0.3, to: 0.85, flat: true, angle: [0.55, 0.95], len: [0.3, 0.5], radius: [0.5, 0.6], segs: 3, gnarl: 0.08, up: -0.04, tip: 0.2 }],
        },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 307, spec);
    addRoots(skel, new Rng(seed * 31 + 311), { count: [3, 5], radius: 0.4, len: [0.8, 1.5] });
    const sway = makeSway(skel, { amp: 2.6, twig: (d) => (d >= 1 ? 0.35 : 0) });
    const nz = new Noise(seed * 17 + 9);
    const cBark = col('#33271f'),
      cDark = col('#1c1512'),
      cGrey = col('#4c4740'),
      cSoil = col('#120f0c'),
      cHeart = col('#57452f');
    const base = lodPick(lod, PINE, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => {
        if (l.tag === 'root') return ROOT_PICK[lod];
        if (l.tag === 'live' && l.depth >= 2) return null; // hidden under its needles
        if (lod === 2 && l.depth === 1 && l.tag === 'live') return null;
        if (lod === 2 && l.depth === 1 && l.id % 2) return null;
        return base(l);
      },
      sway,
      mat: MAT.WOOD,
      rough: 0.95,
      flare: 0.45,
      burl: 0.05,
      lobes: 0.06,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cHeart).multiplyScalar(0.5 + 0.4 * v.rnd);
          return;
        }
        c.copy(cDark).lerp(cBark, barkN(nz, v, 2.2));
        if (v.limb.tag === 'dead') c.lerp(cGrey, 0.55 + 0.3 * clamp01(v.ny));
        else if (v.depth >= 1) c.multiplyScalar(0.8);
        if (v.y < 0.25) c.lerp(cSoil, clamp01((0.25 - v.y) / 0.45));
      },
    });
    return assemble(new Builder(), [geo, firNeedles(skel, seed, lod, sway)], r0 * 1.2, 3.5);
  },
  { kind: 'tree', lods: 3, variants: 5 }
);

// ---------------------------------------------------------------------------------------------
// tree_salt: a dead tree bleached white and crusted with salt, salt icicles under the limbs.
// ---------------------------------------------------------------------------------------------
register(
  'tree_salt',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 401);
    const H = R.range(6, 10);
    const d3 = { count: [1, 3], from: 0.3, to: 1, angle: [0.4, 0.9], len: [0.4, 0.7], radius: [0.55, 0.7], segs: 3, gnarl: 0.25, tip: 0.15 };
    const d2 = { count: [2, 4], from: 0.3, to: 0.95, angle: [0.5, 1.0], len: [0.35, 0.6], radius: [0.5, 0.6], segs: 4, gnarl: 0.22, kink: 0.2, up: 0.02, tip: 0.2, breakChance: 0.3, children: [d3] };
    const r0 = R.range(0.22, 0.32);
    const spec = {
      len: H * 0.46,
      radius: r0,
      tip: 0.66,
      segs: 7,
      gnarl: 0.08,
      up: 0.08,
      lean: R.range(0.03, 0.2),
      capped: true,
      children: [
        { atTip: true, count: [2, 3], angle: [0.3, 0.7], len: [H * 0.35, H * 0.55], lenAbs: true, radius: [0.66, 0.82], segs: 7, gnarl: 0.17, kink: 0.3, up: 0.07, tip: 0.14, taperPow: 0.8, breakChance: 0.22, children: [d2] },
        { count: [2, 4], from: 0.4, to: 0.9, angle: [0.9, 1.4], len: [H * 0.22, H * 0.42], lenAbs: true, radius: [0.38, 0.55], segs: 6, gnarl: 0.2, kink: 0.3, up: (u) => 0.1 - 0.12 * u, tip: 0.16, taperPow: 0.8, breakChance: 0.5, children: [d2] },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 401, spec);
    addRoots(skel, new Rng(seed * 31 + 411), { count: [3, 5], radius: 0.38, len: [0.8, 1.6] });
    const sway = makeSway(skel, { amp: 1.6 });
    const nz = new Noise(seed * 17 + 11);
    const cWood = col('#5d5953'),
      cShade = col('#2f2c2a'),
      cSalt = col('#d9cfcb'),
      cRose = col('#a89695'),
      cPit = col('#3d3936');
    const pick = lodPick(lod, BARE, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? ROOT_PICK[lod] : pick(l)),
      sway,
      mat: MAT.STONE,
      rough: (v) => 0.72 + 0.2 * clamp01(-v.ny),
      flare: 0.7,
      burl: 0.2,
      lobes: 0.14,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cPit);
          return;
        }
        const n = barkN(nz, v, 1.4);
        c.copy(cShade).lerp(cWood, n);
        // salt settles on the upper sides, creeps up from the ground and flakes off in patches
        const patch = nz.n3(Math.cos(v.a) * 0.9 + 5, Math.sin(v.a) * 0.9, v.s * 0.75 + v.rnd * 17);
        const crust = smooth01(0.34, 0.6, v.ny * 0.45 + 0.44 + patch * 1.15 + clamp01(1 - v.y / 1.2) * 0.4 + clamp01(v.depth / 3) * 0.2);
        c.lerp(cSalt, crust * (0.82 + 0.18 * n));
        c.lerp(cRose, clamp01(nz.n2(v.s * 0.7 + v.rnd * 9, 3.3) - 0.2) * 0.45 * crust);
      },
    });
    const parts = [geo];
    if (lod < 2) {
      // icicles of salt under every limb that runs level
      const LR = new Rng(seed * 71 + 31);
      const sp = new Soup();
      const cTop = col('#cfc4c0'),
        cTip = col('#efe7e3');
      const st = stations(skel, (l) => l.depth >= 1 && l.depth <= 3 && l.tag !== 'root', 0.13, LR, { from: 0.1 });
      const a = new V3(),
        b = new V3();
      st.forEach((q, i) => {
        const keep = LR.next(),
          len = LR.range(0.08, 0.42) * (LR.chance(0.12) ? 2.1 : 1),
          lx = LR.range(-0.03, 0.03),
          lz = LR.range(-0.03, 0.03);
        if (keep > 0.72 || Math.abs(q.tan.y) > 0.8) return;
        if (lod === 1 && i % 3) return;
        const L = len * Math.max(0.5, Math.min(1.7, q.rad / 0.045)) * (lod ? 1.5 : 1);
        const sw = sway.limb(q.limb, q.s);
        a.set(q.pos.x, q.pos.y - q.rad * 0.4, q.pos.z);
        b.set(a.x + lx, a.y - L, a.z + lz);
        sp.spike(a, b, 0.008 + L * 0.07 + (lod ? 0.01 : 0), cTop, cTip, sw, sw);
      });
      const g = sp.build(MAT.CRYSTAL, 0.3);
      if (g) parts.push(g);
      // crystals grown on the limbs and round the foot
      const KR = new Rng(seed * 73 + 37);
      const lumps = stations(skel, (l) => l.depth <= 1 && l.tag !== 'root', 0.7, KR, { from: 0.35 });
      lumps.forEach((q, i) => {
        const keep = KR.next(),
          h = KR.range(0.08, 0.22),
          yaw = KR.range(0, TAU),
          tilt = KR.range(-0.5, 0.5);
        if (keep > 0.5 || q.pos.y < 0.5 || (lod === 1 && i % 2)) return;
        const cg = crystal(h * 0.32, h, { sides: 4, tip: 0.4, rng: KR });
        paint(cg, { color: gradY('#b9aba8', '#efe6e2', 0, h), rough: 0.3, mat: MAT.CRYSTAL, sway: sway.limb(q.limb, q.s) });
        xf(cg, { r: [tilt, yaw, tilt * 0.6], t: [q.pos.x, q.pos.y + q.rad * 0.5, q.pos.z] });
        parts.push(cg);
      });
      const nFoot = lod === 0 ? KR.int(5, 8) : 3;
      for (let i = 0; i < nFoot; i++) {
        const an = KR.range(0, TAU),
          d = r0 * KR.range(1.3, 3.2),
          h = KR.range(0.12, 0.4);
        const cg = crystal(h * 0.3, h, { sides: 4, tip: 0.35, rng: KR });
        paint(cg, { color: gradY('#a89c99', '#ece3df', 0, h), rough: 0.32, mat: MAT.CRYSTAL });
        xf(cg, { r: [Math.sin(an) * 0.35, KR.range(0, TAU), -Math.cos(an) * 0.35], t: [Math.cos(an) * d, -0.03, Math.sin(an) * d] });
        parts.push(cg);
      }
    }
    return assemble(new Builder(), parts, r0 * 1.2, 3.2);
  },
  { kind: 'tree', lods: 3, variants: 6 }
);

// ---------------------------------------------------------------------------------------------
// tree_willow: a dead weeping willow. Boughs rise, arch over and let long strands hang.
// ---------------------------------------------------------------------------------------------
const WILLOW = [
  { maxDepth: 9, radial: [8, 5, 3], step: [1, 1, 1], cap: { 2: 34 } },
  { maxDepth: 2, radial: [6, 4, 3], step: [2, 2, 2], cap: { 2: 34 }, rMul: [1, 1, 1.5], rMin: 0.012 },
  { maxDepth: 2, radial: [5, 3, 3], step: [3, 3, 5], cap: { 2: 34 }, keep: { 2: 2 }, rMul: [1, 1.1, 2.4], rMin: 0.05 },
];
register(
  'tree_willow',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 503);
    const H = R.range(6, 9);
    const d2 = { count: [5, 8], from: 0.25, to: 1.0, angle: [0.4, 0.95], len: [0.25, 0.45], radius: [0.4, 0.55], segs: 5, gnarl: 0.14, up: -0.13, tip: 0.15 };
    const r0 = R.range(0.3, 0.42);
    const spec = {
      len: H * 0.36,
      radius: r0,
      tip: 0.72,
      segs: 6,
      gnarl: 0.1,
      up: 0.02,
      lean: R.range(0.08, 0.28),
      capped: true,
      children: [
        { atTip: true, count: [3, 5], angle: [0.45, 0.95], len: [H * 0.55, H * 0.82], lenAbs: true, radius: [0.55, 0.72], segs: 9, gnarl: 0.11, kink: 0.12, up: (u) => 0.17 - 0.4 * u, out: 0.03, tip: 0.1, taperPow: 0.8, breakChance: 0.08, children: [d2] },
        { count: [1, 3], from: 0.55, to: 0.9, angle: [0.9, 1.3], len: [H * 0.4, H * 0.62], lenAbs: true, radius: [0.35, 0.5], segs: 8, gnarl: 0.12, kink: 0.12, up: (u) => 0.14 - 0.36 * u, out: 0.03, tip: 0.1, taperPow: 0.8, breakChance: 0.25, children: [d2] },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 503, spec);
    addRoots(skel, new Rng(seed * 31 + 511), { count: [4, 6], radius: 0.4, len: [1.2, 2.4] });
    const sway = makeSway(skel, { amp: 2.0, twig: (d) => (d >= 1 ? 0.3 * d : 0) });
    const nz = new Noise(seed * 17 + 13);
    const cBark = col('#342d26'),
      cDark = col('#1b1714'),
      cWithe = col('#4a3f25'),
      cMoss = col('#2f3a22'),
      cSoil = col('#120f0c'),
      cHeart = col('#5b4733');
    const pick = lodPick(lod, WILLOW, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? ROOT_PICK[lod] : pick(l)),
      sway,
      mat: MAT.WOOD,
      rough: 0.95,
      flare: 0.75,
      flareH: 0.5,
      burl: 0.22,
      lobes: 0.16,
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cHeart).multiplyScalar(0.5 + 0.4 * v.rnd);
          return;
        }
        c.copy(cDark).lerp(cBark, barkN(nz, v, 1.5));
        if (v.depth >= 2) c.lerp(cWithe, 0.7);
        else if (v.depth === 1) c.lerp(cWithe, clamp01(v.t - 0.4) * 0.8);
        if (v.depth === 0) c.lerp(cMoss, clamp01(1 - v.y / 2.0) * clamp01(nz.n2(Math.cos(v.a) * 2, v.s) + 0.4) * 0.6);
        if (v.y < 0.25) c.lerp(cSoil, clamp01((0.25 - v.y) / 0.45));
      },
    });
    // the hanging strands: each leaves its twig the way the twig was going, then gives up and hangs
    const LR = new Rng(seed * 61 + 17);
    const sp = new Soup();
    const cTop = col('#1c1a13'),
      cLow = col('#48422a'),
      cGrey = col('#4a463c');
    const ca = cTop.clone(),
      cb = cTop.clone();
    const st = stations(skel, (l) => l.depth >= 1 && l.tag !== 'root', 0.2, LR, { from: 0.3 });
    const l0 = new V3(),
      r0v = new V3(),
      l1 = new V3(),
      r1v = new V3(),
      tip = new V3();
    const US = [[0.07, 0.3, 0.65, 1], [0.2, 1], [1]][lod];
    // the same strands at every lod: choose them first, thin them afterwards
    const hung = [];
    for (const q of st) {
      const o = { q, yaw: LR.range(0, TAU), Lr: LR.range(1.2, 4.6), clear: LR.range(0.2, 1.1), dx: LR.range(-0.3, 0.3), dz: LR.range(-0.3, 0.3), wv: LR.range(0.8, 1.3), reach: LR.range(0.1, 0.5), tone: LR.range(0.7, 1.25), grey: LR.chance(0.25) };
      if (q.limb.depth === 1 && q.s < q.limb.length * 0.45) continue;
      o.L = Math.min(o.Lr, q.pos.y - o.clear);
      if (o.L >= 0.5) hung.push(o);
    }
    const MAXS = 300;
    const stride = Math.max(1, hung.length / MAXS);
    const chosen = [];
    for (let f = 0; f < hung.length - 0.5; f += stride) chosen.push(hung[Math.floor(f)]);
    chosen.forEach(({ q, yaw, dx, dz, wv, reach, tone, grey, L }, i) => {
      if ((lod === 1 && i % 2) || (lod === 2 && i % 4)) return;
      const w = 0.026 * wv * (lod === 0 ? 1 : lod === 1 ? 1.9 : 4.2);
      const sw0 = sway.limb(q.limb, q.s);
      const ax = Math.cos(yaw) * w,
        az = Math.sin(yaw) * w;
      const th = Math.hypot(q.tan.x, q.tan.z) || 1;
      const ox = (q.tan.x / th) * reach,
        oz = (q.tan.z / th) * reach;
      l0.set(q.pos.x - ax, q.pos.y, q.pos.z - az);
      r0v.set(q.pos.x + ax, q.pos.y, q.pos.z + az);
      let swP = sw0;
      ca.copy(cTop).multiplyScalar(tone);
      for (let k = 0; k < US.length; k++) {
        const u = US[k];
        const o = 1 - Math.pow(1 - u, 3);
        const cx = q.pos.x + ox * o + dx * u * u * L * 0.3,
          cy = q.pos.y - L * Math.pow(u, 1.25),
          cz = q.pos.z + oz * o + dz * u * u * L * 0.3;
        const sw = sw0 + 1.7 * u * u;
        cb.copy(cTop).lerp(grey ? cGrey : cLow, u).multiplyScalar(tone);
        if (k === US.length - 1) {
          tip.set(cx, cy, cz);
          sp.tri(l0, r0v, tip, ca, ca, cb, swP, swP, sw);
        } else {
          const k2 = 1 - 0.5 * u;
          l1.set(cx - ax * k2, cy, cz - az * k2);
          r1v.set(cx + ax * k2, cy, cz + az * k2);
          sp.tri(l0, r0v, l1, ca, ca, cb, swP, swP, sw).tri(r0v, r1v, l1, ca, cb, cb, swP, sw, sw);
          l0.copy(l1);
          r0v.copy(r1v);
        }
        swP = sw;
        ca.copy(cb);
      }
    });
    return assemble(new Builder(), [geo, sp.build(MAT.PLANT, 0.9)], r0 * 1.2, 2.6);
  },
  { kind: 'tree', lods: 3, variants: 5 }
);

// ---------------------------------------------------------------------------------------------
// tree_charred: a burnt snag, split and black, with a few cracks that still smoulder.
// ---------------------------------------------------------------------------------------------
const CHAR = [
  { maxDepth: 9, radial: [12, 6, 4], step: [1, 1, 1] },
  { maxDepth: 2, radial: [8, 4, 3], step: [2, 1, 2], rMin: 0.012 },
  { maxDepth: 1, radial: [6, 3], step: [4, 3], rMin: 0.04 },
];
register(
  'tree_charred',
  (seed, opts = {}) => {
    const lod = lodOf(opts);
    const R = new Rng(seed * 7919 + 601);
    const H = R.range(2, 6);
    const r0 = R.range(0.22, 0.4) * (0.75 + H * 0.06);
    const spec = {
      len: H * 0.8,
      radius: r0,
      tip: 0.55,
      segs: 12,
      gnarl: 0.05,
      up: 0.02,
      lean: R.range(0, 0.22),
      blunt: true,
      children: [
        { atTip: true, count: [1, 2], angle: [0.12, 0.4], len: [H * 0.15, H * 0.42], lenAbs: true, radius: [0.5, 0.72], segs: 4, gnarl: 0.1, tip: 0.3, blunt: true },
        {
          count: [1, 4],
          from: 0.3,
          to: 0.9,
          angle: [0.8, 1.4],
          len: [0.3, 1.5],
          lenAbs: true,
          radius: [0.3, 0.5],
          segs: 4,
          gnarl: 0.15,
          up: 0.04,
          tip: 0.45,
          blunt: true,
          children: [{ count: [0, 2], from: 0.3, to: 0.9, angle: [0.5, 1.1], len: [0.3, 0.6], radius: [0.5, 0.65], segs: 2, gnarl: 0.2, tip: 0.3, blunt: true }],
        },
      ],
    };
    const skel = growSkeleton(seed * 104729 + 601, spec);
    addRoots(skel, new Rng(seed * 31 + 611), { count: [3, 5], radius: 0.4, len: [0.7, 1.4] });
    const sway = makeSway(skel, { amp: 0.25, twig: () => 0 });
    const nz = new Noise(seed * 17 + 19);
    const cChar = col('#0b0a0a'),
      cCoal = col('#1c1918'),
      cAsh = col('#4d4a47'),
      cEmber = col('#ff5a14'),
      cSoil = col('#0d0b0a');
    // only stretches of the cleft still smoulder
    const ember = (v) => smooth01(0.3, 0.55, v.t) * (1 - smooth01(0.7, 0.98, v.t)) * clamp01(nz.n2(v.s * 1.9, 9.1) * 2.2 - 0.05);
    const inCleft = (v) => {
      if (v.depth !== 0 || lod === 2) return false;
      const da = (((v.a - v.limb.rnd * 6) % TAU) + TAU) % TAU;
      return da < 0.02 || da > TAU - 0.02;
    };
    const pick = lodPick(lod, CHAR, skel);
    const geo = meshLimbs(skel, {
      pick: (l) => (l.tag === 'root' ? ROOT_PICK[lod] : pick(l)),
      sway,
      mat: MAT.WOOD,
      rough: (v) => 0.75 + 0.2 * barkN(nz, v, 3),
      flare: 0.5,
      burl: 0.16,
      lobes: 0.3,
      // the trunk split down one side when it burnt: one row of vertices is pulled into the heart
      shape: (limb, sAt, t, j, m) => {
        if (limb.depth !== 0) return 1;
        const k = smooth01(0.28, 0.9, t);
        return j === 0 ? 1 - 0.82 * k : j === 1 || j === m - 1 ? 1 - 0.12 * k : 1;
      },
      emissive: (v) => (inCleft(v) ? 0.85 * ember(v) : 0),
      colour: (v, c) => {
        if (v.cap) {
          c.copy(cChar);
          return;
        }
        const n = barkN(nz, v, 2.4);
        c.copy(cChar).lerp(cCoal, n);
        // ash settles on what faces the sky
        c.lerp(cAsh, clamp01(v.ny - 0.25) * 0.6 * (0.4 + n));
        if (inCleft(v)) c.lerp(cEmber, 0.8 * ember(v));
        if (v.y < 0.2) c.lerp(cSoil, clamp01((0.2 - v.y) / 0.4));
      },
    });
    const parts = [geo];
    const P = geo.attributes.position,
      Nr = geo.attributes.normal;
    if (lod < 2) {
      const LR = new Rng(seed * 79 + 41);
      // splinters standing on every break
      const sp = new Soup();
      const cA = col('#0b0a0a'),
        cB = col('#2a2624');
      const a = new V3(),
        b = new V3();
      for (const limb of skel.limbs) {
        if (!limb.broken || !limb.rings || limb.depth > 1) continue;
        const ring = limb.rings[limb.rings.length - 1];
        if (!ring || ring.count < 3) continue;
        const n = limb.pts.length;
        const T = new V3().subVectors(limb.pts[n - 1], limb.pts[n - 2]).normalize();
        const c0 = limb.pts[n - 1];
        const r = limb.rad[n - 1];
        for (let j = 0; j < ring.count; j++) {
          const h = LR.range(0.6, 3.4),
            inw = LR.range(0.45, 0.9),
            keep = LR.next();
          if (keep > (lod ? 0.4 : 0.75)) continue;
          a.fromBufferAttribute(P, ring.base + j);
          a.lerp(c0, 1 - inw);
          b.copy(a).addScaledVector(T, r * h);
          b.x += (a.x - c0.x) * 0.25;
          b.z += (a.z - c0.z) * 0.25;
          sp.spike(a, b, r * 0.2, cA, cB);
        }
      }
      const sg = sp.build(MAT.WOOD, 0.85);
      if (sg) parts.push(sg);
      // cracks that still glow: thin ribbons laid along the ridges of the trunk
      const trunk = skel.limbs[0];
      const rings = trunk.rings || [];
      const gl = new Soup();
      const hot = col('#ff6a1c'),
        dim = col('#a8250a');
      const nSeams = LR.int(2, 4);
      const p = new V3(),
        nrm = new V3(),
        tg = new V3(),
        q0 = new V3(),
        q1 = new V3();
      for (let sI = 0; sI < nSeams; sI++) {
        const k0 = LR.int(2, Math.max(2, rings.length - 5)),
          span = LR.int(2, 4),
          w0 = LR.range(0.009, 0.016);
        let j = LR.int(0, 99);
        let pl = null,
          pr = null,
          pe = 0;
        for (let k = k0; k <= k0 + span && k < rings.length - 1; k++) {
          const ring = rings[k];
          if (ring.count < 3) break;
          if (LR.chance(0.35)) j += LR.sign();
          const jj = ((j % ring.count) + ring.count) % ring.count;
          p.fromBufferAttribute(P, ring.base + jj);
          if (p.y < 0.25) continue;
          nrm.fromBufferAttribute(Nr, ring.base + jj);
          q0.fromBufferAttribute(P, ring.base + ((jj + 1) % ring.count));
          q1.fromBufferAttribute(P, ring.base + ((jj + ring.count - 1) % ring.count));
          tg.subVectors(q0, q1).normalize();
          const u = (k - k0) / span;
          const w = w0 * Math.sin(Math.max(0.12, u) * Math.PI * 0.92 + 0.12);
          const e = 2.4 * Math.sin(Math.max(0.15, u) * Math.PI * 0.9 + 0.15);
          const L = new V3().copy(p).addScaledVector(nrm, 0.004).addScaledVector(tg, -w);
          const Rr = new V3().copy(p).addScaledVector(nrm, 0.004).addScaledVector(tg, w);
          if (pl) {
            gl.v(pl.x, pl.y, pl.z, dim, 0, pe).v(pr.x, pr.y, pr.z, dim, 0, pe).v(L.x, L.y, L.z, hot, 0, e);
            gl.v(pr.x, pr.y, pr.z, dim, 0, pe).v(Rr.x, Rr.y, Rr.z, hot, 0, e).v(L.x, L.y, L.z, hot, 0, e);
          }
          pl = L;
          pr = Rr;
          pe = e;
        }
      }
      const gg = gl.build(MAT.GLOW, 0.6);
      if (gg) parts.push(gg);
    }
    return assemble(new Builder(), parts, r0 * 1.15, Math.min(3, H * 0.8));
  },
  { kind: 'tree', lods: 3, variants: 6 }
);
