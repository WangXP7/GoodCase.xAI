// Shared generators for the nature models: bare-branch skeletons and their meshes, blades and
// fronds for ground cover, chiselled rock. Everything here is deterministic for a given seed.
import { THREE, Rng, Noise, TAU, MAT, PAL, col, paint } from '../kit.js';

const V3 = THREE.Vector3;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** A spec value: constant, [min, max] range or (f, R) => value. A range always consumes one random number. */
const val = (v, f, R) => (typeof v === 'function' ? v(f, R) : Array.isArray(v) ? R.range(v[0], v[1]) : v);

// ---------------------------------------------------------------------------------------------
// Branch skeleton
// ---------------------------------------------------------------------------------------------
/**
 * growSkeleton(seed, trunkSpec) -> { limbs, height, spread, seed }
 *
 * A limb spec:
 *   len, radius      metres (trunk only; children take theirs from their group)
 *   segs             control points along the limb
 *   tip              radius at the end as a fraction of the start radius
 *   taperPow         > 1 keeps the limb thick for longer
 *   gnarl            random wander per segment (radians-ish)
 *   kink             chance per segment of a sharp elbow
 *   up               pull toward +Y per segment, or (u 0..1 along the limb) => pull. Negative droops.
 *   out              pull away from the trunk axis per segment
 *   breakChance      chance the limb snaps off part-way and ends in a jagged stump
 *   blunt            always ends jagged, at full length
 *   capped           ends in a rounded knuckle (use when children fork from the tip)
 *   lean, leanAz, root   trunk only: tilt, its direction, and how far it starts below the ground
 *   tag              free label copied to the limb
 *   children: [group, ...]
 * A child group is a limb spec plus:
 *   count            how many (number | [min, max])
 *   from, to         span of the parent (0..1) where they attach;  atTip: true forks from the end
 *   angle            away from the parent's direction (radians)
 *   len              fraction of the parent's length, or metres when lenAbs is true
 *   lenTip           length multiplier reached at the `to` end of the span
 *   radius           fraction of the parent's radius at the attachment
 *   flat             attach left and right in the horizontal plane (fir boughs) instead of all round
 *   azStep, azJitter spacing of successive children around the parent
 * angle, len and radius may be (f 0..1 along the span, R) => value.
 */
export function growSkeleton(seed, spec) {
  const R = new Rng(seed);
  const limbs = [];
  const lean = spec.lean || 0,
    az = spec.leanAz ?? R.range(0, TAU);
  const dir = new V3(Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az));
  const root = spec.root ?? 0.6;
  const start = new V3(0, -root, 0);
  grow(R, start, dir, spec.len + root, spec.radius, spec, 0, null, 0, limbs);
  let height = 0,
    spread = 0;
  for (const l of limbs)
    for (const p of l.pts) {
      if (p.y > height) height = p.y;
      const h = Math.hypot(p.x, p.z);
      if (h > spread) spread = h;
    }
  return { limbs, height, spread, seed };
}

function grow(R, start, dir, length, r0, lv, depth, parent, sAttach, limbs) {
  const n = Math.max(2, lv.segs | 0);
  const limb = { id: limbs.length, depth, parent, sAttach, pts: [start.clone()], rad: [r0], s: [0], broken: false, capped: !!lv.capped, rnd: R.next(), tag: lv.tag || null, spec: lv, full: length };
  limbs.push(limb);
  const d = dir.clone().normalize();
  const step = length / n;
  const breakAt = R.chance(lv.breakChance || 0) ? R.range(0.3, 0.75) : 9;
  const gn = lv.gnarl || 0,
    tipR = lv.tip ?? 0.1,
    tp = lv.taperPow || 1;
  const p = start.clone();
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    d.x += R.gauss() * gn;
    d.y += R.gauss() * gn * 0.6;
    d.z += R.gauss() * gn;
    if (lv.kink && R.chance(lv.kink)) {
      // an elbow: the limb was broken or pruned here once and grew on at an angle
      d.x += R.gauss() * 0.55;
      d.y += R.gauss() * 0.3;
      d.z += R.gauss() * 0.55;
    }
    d.y += typeof lv.up === 'function' ? lv.up(u, limb) : lv.up || 0;
    if (lv.out) {
      const h = Math.hypot(p.x, p.z) || 1;
      d.x += (p.x / h) * lv.out;
      d.z += (p.z / h) * lv.out;
    }
    d.normalize();
    p.addScaledVector(d, step);
    limb.pts.push(p.clone());
    limb.rad.push(r0 * lerp(1, tipR, Math.pow(u, tp)));
    limb.s.push(limb.s[i - 1] + step);
    if (u >= breakAt) {
      limb.broken = true;
      break;
    }
  }
  if (lv.blunt) limb.broken = true;
  limb.length = limb.s[limb.s.length - 1];

  const smp = { pos: new V3(), tan: new V3(), rad: 0 };
  const e1 = new V3(),
    e2 = new V3(),
    cd = new V3();
  for (const g of lv.children || []) {
    const count = Math.round(val(g.count, 0, R));
    let az = R.range(0, TAU);
    for (let k = 0; k < count; k++) {
      const f = count > 1 ? (k + R.range(0.2, 0.8)) / count : R.range(0.2, 0.8);
      const t = g.atTip ? 1 : lerp(g.from ?? 0.3, g.to ?? 0.95, f);
      az += (g.azStep ?? (g.atTip ? TAU / Math.max(1, count) : 2.39996)) + R.range(-1, 1) * (g.azJitter ?? 0.5);
      const ang = val(g.angle, f, R);
      const len = val(g.len, f, R) * (g.lenAbs ? 1 : length) * lerp(1, g.lenTip ?? 1, f);
      const rr = val(g.radius, f, R);
      const sAt = g.atTip ? limb.length * 0.94 : t * length;
      if (!g.atTip && sAt > limb.length * 0.97) continue; // that part of the parent broke off
      sampleLimb(limb, sAt, smp);
      const T = smp.tan;
      if (g.flat) {
        e1.set(T.z, 0, -T.x);
        if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
        e1.normalize();
        const side = k % 2 ? 1 : -1;
        const tiltA = R.range(-0.35, 0.35);
        e2.crossVectors(T, e1).normalize();
        cd.copy(e1).multiplyScalar(side * Math.cos(tiltA)).addScaledVector(e2, Math.sin(tiltA));
      } else {
        e1.set(T.z, 0, -T.x);
        if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
        e1.normalize();
        e2.crossVectors(T, e1).normalize();
        cd.copy(e1).multiplyScalar(Math.cos(az)).addScaledVector(e2, Math.sin(az));
      }
      cd.multiplyScalar(Math.sin(ang)).addScaledVector(T, Math.cos(ang));
      const cr = Math.min(smp.rad * rr, smp.rad * 0.92);
      grow(R, smp.pos, cd, len, cr, g, depth + 1, limb, sAt, limbs);
    }
  }
  return limb;
}

/** Point, direction and radius of a limb at arc length s from its base. */
export function sampleLimb(limb, s, out = { pos: new V3(), tan: new V3(), rad: 0 }) {
  const S = limb.s;
  let i = 1;
  while (i < S.length - 1 && S[i] < s) i++;
  const f = clamp01((s - S[i - 1]) / (S[i] - S[i - 1] || 1));
  out.pos.lerpVectors(limb.pts[i - 1], limb.pts[i], f);
  out.tan.subVectors(limb.pts[i], limb.pts[i - 1]).normalize();
  out.rad = lerp(limb.rad[i - 1], limb.rad[i], f);
  return out;
}

/**
 * Wind sway for a skeleton. It is a smooth field of position (so joints stay joined) plus a term
 * that builds along each limb and is handed on to its children.
 *   const sway = makeSway(skel, { amp, y0, twig: (depth) => k });
 *   sway.at(x, y, z)            the field alone
 *   sway.limb(limb, s)          field + inherited + own term at arc length s
 */
export function makeSway(skel, { amp = 2, y0 = 0.6, twig = (d) => (d >= 2 ? 0.25 * (d - 1) : 0) } = {}) {
  const H = Math.max(1, skel.height - y0),
    S = Math.max(1, skel.spread);
  const at = (x, y, z) => {
    const h = clamp01((y - y0) / H);
    const rad = Math.min(1.5, Math.hypot(x, z) / S);
    return amp * (0.6 * Math.pow(h, 1.8) + 0.55 * h * Math.pow(rad, 1.4));
  };
  for (const l of skel.limbs) {
    const p = l.parent;
    l.k = twig(l.depth, l);
    l.extra0 = p ? p.extra0 + p.k * Math.pow(l.sAttach / (p.length || 1), 2) : 0;
  }
  const smp = { pos: new V3(), tan: new V3(), rad: 0 };
  return {
    at,
    own: (limb, s) => limb.extra0 + limb.k * Math.pow(s / (limb.length || 1), 2),
    limb(limb, s) {
      sampleLimb(limb, s, smp);
      return at(smp.pos.x, smp.pos.y, smp.pos.z) + limb.extra0 + limb.k * Math.pow(s / (limb.length || 1), 2);
    },
  };
}

/**
 * Turn limbs into one painted geometry.
 *   pick(limb) -> null (skip) | { radial, step, rMul?, rMin? }
 *   colour(v, out)   write a linear colour into `out` (THREE.Color)
 *   v = { x, y, z, nx, ny, nz, s, a, t, r, depth, rnd, limb, cap }   cap: 0 bark, 1 the face of a break
 *   sway             from makeSway
 *   rough, emissive  number | (v) => number
 *   mat              MAT.*
 *   flare, flareH    root collar on depth 0: radius * (1 + flare * exp(-y / flareH))
 *   burl             bumps along thick limbs;  lobes  out-of-round sections on thick limbs
 *   shape(limb, s, t, j, m)  optional radius multiplier for ring vertex j of m (clefts, flutes)
 */
export function meshLimbs(skel, opt) {
  const N = new Noise((skel.seed * 31 + 7) >>> 0);
  const P = [],
    I = [];
  const mS = [],
    mA = [],
    mT = [],
    mR = [],
    mL = [],
    mC = [];
  const flare = opt.flare ?? 0.55,
    flareH = opt.flareH ?? 0.45,
    burl = opt.burl ?? 0.12,
    lobes = opt.lobes ?? 0.1;
  const T = new V3(),
    Nn = new V3(),
    B = new V3(),
    q = new V3();
  const push = (v, s, a, t, r, li, cap) => {
    P.push(v.x, v.y, v.z);
    mS.push(s);
    mA.push(a);
    mT.push(t);
    mR.push(r);
    mL.push(li);
    mC.push(cap);
    return P.length / 3 - 1;
  };
  for (const limb of skel.limbs) {
    const pk = opt.pick(limb);
    if (!pk) continue;
    const n = limb.pts.length;
    const step = Math.max(1, pk.step | 0);
    const ids = [];
    for (let i = 0; i < n - 1; i += step) ids.push(i);
    ids.push(n - 1);
    const m = Math.max(3, pk.radial | 0);
    const lobeK = lobes * (limb.depth === 0 ? 1 : limb.depth === 1 ? 0.7 : limb.depth === 2 ? 0.35 : 0);
    const burlK = burl * (limb.depth <= 1 ? 1 : limb.depth === 2 ? 0.6 : 0);
    const end = limb.broken ? 'jag' : limb.capped ? 'dome' : 'point';
    let prevBase = -1,
      prevCount = 0;
    limb.rings = []; // [{ base, count, s }] vertex rows of this limb in the finished geometry
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      const a = limb.pts[ids[Math.max(0, k - 1)]],
        b = limb.pts[ids[Math.min(ids.length - 1, k + 1)]];
      T.subVectors(b, a).normalize();
      if (k === 0) {
        Nn.set(1, 0, 0);
        if (Math.abs(T.x) > 0.9) Nn.set(0, 0, 1);
      }
      Nn.addScaledVector(T, -Nn.dot(T)).normalize();
      B.crossVectors(T, Nn);
      const c = limb.pts[i],
        s = limb.s[i],
        t = s / (limb.length || 1);
      let r = limb.rad[i] * (pk.rMul || 1);
      if (pk.rMin) r = Math.max(r, pk.rMin * (1 - 0.5 * t));
      if (limb.depth === 0 && flare) r *= 1 + flare * Math.exp(-Math.max(0, c.y + 0.05) / flareH);
      if (burlK) {
        const bn = N.n2(s * 1.7 + limb.rnd * 50, limb.id * 7.3);
        r *= 1 + burlK * Math.max(0, bn) * 2.2;
      }
      const last = k === ids.length - 1;
      let base, count;
      if (last && end === 'point') {
        base = push(c, s, 0, t, r, limb.id, 0);
        count = 1;
      } else {
        base = P.length / 3;
        count = m;
        for (let j = 0; j < m; j++) {
          const ang = (j / m) * TAU + limb.rnd * 6;
          const ca = Math.cos(ang),
            sa = Math.sin(ang);
          let rr = r;
          if (lobeK) rr *= 1 + lobeK * N.n2(ca * 1.3 + s * 0.55 + limb.rnd * 40, sa * 1.3 + limb.id * 3.1) * 1.6;
          if (opt.shape) rr *= opt.shape(limb, s, t, j, m);
          q.copy(c).addScaledVector(Nn, ca * rr).addScaledVector(B, sa * rr);
          if (last && end === 'jag') q.addScaledVector(T, (N.n2(j * 2.7 + limb.id, limb.rnd * 30) * 0.9 + 0.2) * r * 1.3);
          push(q, s, ang, t, rr, limb.id, 0);
        }
      }
      limb.rings.push({ base, count, s });
      if (prevBase >= 0) {
        if (count === 1) {
          for (let j = 0; j < prevCount; j++) I.push(prevBase + j, prevBase + ((j + 1) % prevCount), base);
        } else {
          for (let j = 0; j < m; j++) {
            const a0 = prevBase + j,
              a1 = prevBase + ((j + 1) % m),
              b0 = base + j,
              b1 = base + ((j + 1) % m);
            I.push(a0, a1, b0, a1, b1, b0);
          }
        }
      }
      if (last && count > 1) {
        if (end === 'dome') {
          q.copy(c).addScaledVector(T, r * 0.3);
          const apex = push(q, s + r * 0.3, 0, 1, r * 0.2, limb.id, 0);
          for (let j = 0; j < m; j++) I.push(base + j, base + ((j + 1) % m), apex);
        } else if (end === 'jag' && !pk.noCap) {
          // the face of the break: its own ring so the rim stays sharp
          const dup = P.length / 3;
          for (let j = 0; j < m; j++) {
            q.set(P[(base + j) * 3], P[(base + j) * 3 + 1], P[(base + j) * 3 + 2]);
            push(q, s, mA[base + j], t, mR[base + j], limb.id, 1);
          }
          q.copy(c).addScaledVector(T, -r * 0.9);
          const pit = push(q, s, 0, t, 0, limb.id, 1);
          for (let j = 0; j < m; j++) I.push(dup + j, dup + ((j + 1) % m), pit);
        }
      }
      prevBase = base;
      prevCount = count;
    }
  }
  const nV = P.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(nV > 65535 ? new THREE.BufferAttribute(new Uint32Array(I), 1) : new THREE.BufferAttribute(new Uint16Array(I), 1));
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const colA = new Float32Array(nV * 3),
    fx = new Float32Array(nV * 4),
    mat = new Float32Array(nV),
    uvw = new Float32Array(nV * 3);
  const c = new THREE.Color();
  const v = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, s: 0, a: 0, t: 0, r: 0, depth: 0, rnd: 0, limb: null, cap: 0 };
  const ev = (o, d) => (typeof o === 'function' ? o(v) : o === undefined ? d : o);
  const sway = opt.sway;
  for (let i = 0; i < nV; i++) {
    const limb = skel.limbs[mL[i]];
    v.x = P[i * 3];
    v.y = P[i * 3 + 1];
    v.z = P[i * 3 + 2];
    v.nx = nor.getX(i);
    v.ny = nor.getY(i);
    v.nz = nor.getZ(i);
    v.s = mS[i];
    v.a = mA[i];
    v.t = mT[i];
    v.r = mR[i];
    v.depth = limb.depth;
    v.rnd = limb.rnd;
    v.limb = limb;
    v.cap = mC[i];
    c.setRGB(0.2, 0.17, 0.14);
    opt.colour(v, c);
    colA[i * 3] = c.r;
    colA[i * 3 + 1] = c.g;
    colA[i * 3 + 2] = c.b;
    fx[i * 4] = ev(opt.emissive, 0);
    fx[i * 4 + 1] = ev(opt.rough, 0.92);
    fx[i * 4 + 2] = 0;
    fx[i * 4 + 3] = sway ? Math.max(0, sway.at(v.x, v.y, v.z) + sway.own(limb, v.s)) * (opt.swayMul ?? 1) : 0;
    mat[i] = opt.mat ?? MAT.WOOD;
    uvw[i * 3] = Math.cos(v.a) * v.r;
    uvw[i * 3 + 1] = v.s + limb.rnd * 13;
    uvw[i * 3 + 2] = Math.sin(v.a) * v.r;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
  g.setAttribute('aUvw', new THREE.BufferAttribute(uvw, 3));
  return g;
}

/**
 * Usual level-of-detail table for bare trees: per depth radial segments and ring step.
 * row.keep = { depth: n } keeps every n-th limb of that depth; row.cap = { depth: max } thins a
 * depth that came out too crowded (pass the skeleton). A limb whose parent was dropped is dropped.
 */
export function lodPick(lod, table, skel = null) {
  const row = table[Math.min(table.length - 1, lod | 0)];
  const dropped = new Set();
  const ratio = {};
  if (skel && row.cap) {
    const n = {};
    for (const l of skel.limbs) if (l.tag !== 'root') n[l.depth] = (n[l.depth] || 0) + 1;
    for (const d of Object.keys(row.cap)) ratio[d] = n[d] > row.cap[d] ? row.cap[d] / n[d] : 1;
  }
  return (limb) => {
    const d = Math.min(limb.depth, row.radial.length - 1);
    if (limb.depth > row.maxDepth) return null;
    if (limb.parent && dropped.has(limb.parent.id)) {
      dropped.add(limb.id);
      return null;
    }
    const keep = row.keep?.[limb.depth];
    if ((keep && limb.id % keep !== 0) || (ratio[limb.depth] !== undefined && limb.rnd > ratio[limb.depth])) {
      dropped.add(limb.id);
      return null;
    }
    if (row.radial[d] <= 0) return null;
    return { radial: row.radial[d], step: row.step[d], rMul: row.rMul?.[d] || 1, rMin: row.rMin || 0 };
  };
}

/** Roots that leave the trunk above the ground and dive under it. Returns extra limbs (depth 1, tag 'root'). */
export function addRoots(skel, R, { count = [3, 5], radius = 0.34, len = [1.0, 1.9], y = [0.12, 0.42] } = {}) {
  const trunk = skel.limbs[0];
  const n = R.int(count[0], count[1]);
  let az = R.range(0, TAU);
  const r0 = trunk.rad[0];
  for (let i = 0; i < n; i++) {
    az += TAU / n + R.range(-0.4, 0.4);
    const L = R.range(len[0], len[1]);
    const y0 = R.range(y[0], y[1]);
    const dx = Math.cos(az),
      dz = Math.sin(az);
    const rr = r0 * radius * R.range(0.8, 1.2);
    const limb = { id: skel.limbs.length, depth: 1, parent: trunk, sAttach: 0, pts: [], rad: [], s: [0], broken: false, capped: false, rnd: R.next(), tag: 'root', spec: {}, full: L };
    const segs = 5;
    const wob = R.range(-0.7, 0.7);
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const d = u * L;
      const side = Math.sin(u * 3.0) * wob * 0.25 * L * u;
      // ride the surface for most of the way, then dive
      const yy = y0 * Math.pow(1 - u, 1.6) + 0.03 * (1 - u) - Math.pow(Math.max(0, u - 0.6) / 0.4, 2) * 0.32;
      limb.pts.push(new V3(dx * d - dz * side, yy, dz * d + dx * side));
      limb.rad.push(rr * lerp(1, 0.25, u));
      if (k > 0) limb.s.push(limb.s[k - 1] + limb.pts[k].distanceTo(limb.pts[k - 1]));
    }
    limb.length = limb.s[segs];
    limb.k = 0;
    limb.extra0 = 0;
    skel.limbs.push(limb);
  }
}

/** Evenly spaced stations along limbs that pass `filter`: [{ limb, s, pos, tan, rad }]. */
export function stations(skel, filter, spacing, R, { from = 0.15, to = 1.0 } = {}) {
  const out = [];
  for (const limb of skel.limbs) {
    if (!filter(limb)) continue;
    const a = limb.length * from,
      b = limb.length * to;
    for (let s = a + R.range(0, spacing); s <= b; s += spacing * R.range(0.7, 1.3)) {
      const o = sampleLimb(limb, s);
      out.push({ limb, s, pos: o.pos.clone(), tan: o.tan.clone(), rad: o.rad });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Blades, strips and fronds (flat, drawn double sided)
// ---------------------------------------------------------------------------------------------
/**
 * A tapering strip: base at the origin, growing along +Y, facing +Z, ending in a point.
 * bend: total radians the tip leans toward -Z.  2 * segs - 1 triangles.
 */
export function blade(len, width, segs = 3, bend = 0, { base = 1, pow = 1.2, side = 0 } = {}) {
  const pos = [],
    idx = [];
  let y = 0,
    z = 0;
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    if (j > 0) {
      const a = bend * (t - 0.5 / segs);
      y += (Math.cos(a) * len) / segs;
      z -= (Math.sin(a) * len) / segs;
    }
    const w = width * 0.5 * (j === 0 ? base : 1) * Math.pow(1 - t, pow) + (j === segs ? 0 : width * 0.04);
    const sx = side * t * t * len;
    if (j === segs) pos.push(sx, y, z);
    else pos.push(sx - w, y, z, sx + w, y, z);
  }
  for (let j = 0; j < segs; j++) {
    const a = j * 2;
    if (j === segs - 1) idx.push(a, a + 1, a + 2);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A pinnate frond (bracken, a needle spray): spine along +Y from the origin, leaflets both sides,
 * lying in the XY plane facing +Z. 2 * teeth triangles plus the spine.
 *   teeth   leaflets per side;   start  fraction of the spine left bare (the stalk)
 *   fill    how much of its stretch of spine a leaflet's base takes (1: they touch, a saw edge)
 *   sweep   how far the leaflet tips lean toward the tip of the frond
 *   droop   how far the leaflet tips hang toward -Z, as a fraction of their length
 */
export function frond(len, width, teeth = 6, { sweep = 0.6, belly = 0.3, spine = 0.012, R = null, start = 0, fill = 1, droop = 0 } = {}) {
  const pos = [],
    idx = [];
  const y00 = len * start;
  const dy = (len - y00) / teeth;
  const prof = (t) => (t < belly ? Math.sin((t / belly) * Math.PI * 0.5) : Math.cos(((t - belly) / (1 - belly)) * Math.PI * 0.5)) * 0.92 + 0.08;
  for (let k = 0; k < teeth; k++) {
    const y0 = y00 + k * dy + dy * (1 - fill) * 0.5,
      y1 = y0 + dy * fill;
    const t = (k + 0.5) / teeth;
    for (const sgn of [-1, 1]) {
      const w = width * 0.5 * prof(t) * (R ? R.range(0.7, 1.15) : 1);
      const b = pos.length / 3;
      pos.push(0, y0, 0, 0, y1 * 0.999, 0, sgn * w, y00 + k * dy + dy * (0.5 + sweep), -droop * w);
      if (sgn > 0) idx.push(b, b + 2, b + 1);
      else idx.push(b, b + 1, b + 2);
    }
  }
  if (spine > 0) {
    const b = pos.length / 3;
    pos.push(-spine, 0, 0.001, spine, 0, 0.001, 0, len * 1.04, 0.001);
    idx.push(b, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Raw triangle soup -> geometry. tris: flat array of xyz (9 numbers per triangle). */
export function soup(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

/** Thin 3-sided spike from a to b (a thorn, an icicle, a claw). 3 triangles, open base. */
export function spike(a, b, r, out = []) {
  const ax = new V3(a[0], a[1], a[2]),
    bx = new V3(b[0], b[1], b[2]);
  const T = new V3().subVectors(bx, ax).normalize();
  const n = new V3(1, 0, 0);
  if (Math.abs(T.x) > 0.9) n.set(0, 0, 1);
  n.addScaledVector(T, -n.dot(T)).normalize();
  const bi = new V3().crossVectors(T, n);
  const ring = [];
  for (let j = 0; j < 3; j++) {
    const an = (j / 3) * TAU;
    ring.push(new V3().copy(ax).addScaledVector(n, Math.cos(an) * r).addScaledVector(bi, Math.sin(an) * r));
  }
  for (let j = 0; j < 3; j++) {
    const p = ring[j],
      q = ring[(j + 1) % 3];
    out.push(p.x, p.y, p.z, q.x, q.y, q.z, bx.x, bx.y, bx.z);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rock
// ---------------------------------------------------------------------------------------------
/**
 * A chiselled rock: a lumpy icosphere cut by planes so it has flat faces and hard edges.
 * Faceted (non-indexed), centred on the origin, fits roughly inside `size` ([x, y, z] full extents).
 *   cuts       how many random planes
 *   depth      [min, max] distance of the planes from the centre (1 = just touching)
 *   vertical   0..1 share of planes that are steep (cliff-like joints)
 *   planes     extra planes [[nx, ny, nz, d], ...] applied in unit space before scaling
 */
export function cutRock(R, { size = [1, 1, 1], detail = 2, cuts = 9, depth = [0.5, 0.9], rough = 0.14, freq = 1.4, vertical = 0.3, planes = [] } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const nz = new Noise(R.int(1, 1e6));
  const pl = [];
  for (let k = 0; k < cuts; k++) {
    let nx = R.gauss(),
      ny = R.gauss(),
      nzz = R.gauss();
    if (R.chance(vertical)) ny *= 0.12;
    const l = Math.hypot(nx, ny, nzz) || 1;
    pl.push([nx / l, ny / l, nzz / l, R.range(depth[0], depth[1])]);
  }
  for (const p of planes) pl.push(p);
  const pos = g.attributes.position;
  const p = new V3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    p.multiplyScalar(1 + nz.fbm3(p.x * freq, p.y * freq, p.z * freq, 3) * rough * 2);
    for (const [nx, ny, nzz, d] of pl) {
      const e = p.x * nx + p.y * ny + p.z * nzz - d;
      if (e > 0) {
        p.x -= nx * e;
        p.y -= ny * e;
        p.z -= nzz * e;
      }
    }
    pos.setXYZ(i, p.x * size[0] * 0.5, p.y * size[1] * 0.5, p.z * size[2] * 0.5);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

const _hash3 = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Paint a faceted rock in place (call after it is where it belongs, so ground shading is right).
 *   base, dark, light   stone colours;  lichen, moss  growth colours and amounts 0..1
 *   ground              y of the soil line;  seams: [y, ...] level joints to darken
 *   facet               tone difference between faces;  wear  how much the edges of a face are lightened
 *   edge, edgeAmt       a colour laid along the edges of every face (glass, salt)
 *   tone                the whole piece lighter or darker (so stacked blocks tell apart)
 *   streak              dark rain streaks down steep faces, 0..1
 *   stains              [{ colour, amt 0..1, freq, up: need this much ny, k: strength }, ...]
 *   cracks              [{ n: [x, y, z], d, w: width, k: strength }, ...] darken near a plane
 */
export function paintRock(
  geo,
  { base = PAL.stone, dark = PAL.stoneDark, light = PAL.stoneLight, lichen = PAL.lichen, lichenAmt = 0.35, moss = PAL.moss, mossAmt = 0.25, ground = 0, seams = null, rough = 0.93, mat = MAT.STONE, seed = 1, facet = 0.16, soil = 0.5, emissive = 0, metal = 0, wear = 0.12, streak = 0, stains = null, cracks = null, edge = null, edgeAmt = 0.5, tone = 1 } = {}
) {
  const nz = new Noise(seed * 13 + 5);
  const cb = col(base),
    cd = col(dark),
    cl = col(light),
    cli = col(lichen),
    cm = col(moss);
  const st = (stains || []).map((s) => ({ ...s, c: col(s.colour) }));
  const ce = edge ? col(edge) : null;
  const out = new THREE.Color();
  const fN = geo.userData.faceN,
    fW = geo.userData.faceW;
  return paint(geo, {
    color: (v) => {
      const fx = fN ? fN[v.i * 3] : v.nx,
        fy = fN ? fN[v.i * 3 + 1] : v.ny,
        fz = fN ? fN[v.i * 3 + 2] : v.nz;
      const f = _hash3(Math.round(fx * 40), Math.round(fy * 40), Math.round(fz * 40));
      const broad = nz.fbm3(v.x * 0.9, v.y * 0.9, v.z * 0.9, 2) * 0.5 + 0.5;
      out.copy(cd).lerp(cb, clamp01(0.35 + broad * 0.6 + fy * 0.25));
      out.lerp(cl, clamp01((fy - 0.35) * 0.55 * (0.5 + broad)));
      out.multiplyScalar(1 - facet + f * facet * 2);
      if (fW && wear) out.multiplyScalar(1 + wear * (1 - Math.min(1, fW[v.i] * 2.5)) - wear * 0.35);
      if (fW && ce) out.lerp(ce, edgeAmt * (1 - Math.min(1, fW[v.i] * 3)));
      if (streak > 0 && fy < 0.6) {
        const sN = nz.n2(v.x * 5.5 + 3, v.z * 5.5) * 0.5 + 0.5;
        out.multiplyScalar(1 - streak * smooth01(0.5, 0.8, sN) * clamp01(1 - fy * 1.6));
      }
      for (const s of st) {
        const n = nz.fbm3(v.x * (s.freq || 2) + 31, v.y * (s.freq || 2) + 7, v.z * (s.freq || 2), 2) * 0.5 + 0.5;
        const upOk = s.up === undefined ? 1 : clamp01((fy - s.up) * 4 + 0.5);
        out.lerp(s.c, smooth01(1 - s.amt, 1 - s.amt + 0.15, n) * upOk * (s.k ?? 0.8));
      }
      if (lichenAmt > 0) {
        const n = nz.fbm3(v.x * 2.3 + 9, v.y * 2.3, v.z * 2.3, 3) * 0.5 + 0.5;
        const k = smooth01(1 - lichenAmt * 0.8, 1 - lichenAmt * 0.8 + 0.18, n + fy * 0.2) * clamp01(fy * 1.5 + 0.5);
        out.lerp(cli, k * 0.75);
      }
      if (mossAmt > 0) {
        const n = nz.fbm3(v.x * 1.4 - 4, v.y * 1.4, v.z * 1.4 + 2, 2) * 0.5 + 0.5;
        const low = 1 - clamp01((v.y - ground) / 0.9);
        const k = smooth01(1 - mossAmt, 1 - mossAmt + 0.25, n * 0.7 + low * 0.5) * clamp01(0.4 + fy);
        out.lerp(cm, k * 0.8);
      }
      // soil line and underside
      const g = clamp01((v.y - ground) / 0.35);
      out.multiplyScalar(1 - soil * (1 - g) * (1 - g));
      out.multiplyScalar(1 - 0.3 * Math.max(0, -fy));
      if (seams) {
        for (const sy of seams) {
          const d = Math.abs(v.y - sy);
          if (d < 0.07) out.multiplyScalar(0.45 + (d / 0.07) * 0.55);
        }
      }
      if (cracks) {
        for (const cr of cracks) {
          const d = Math.abs(v.x * cr.n[0] + v.y * cr.n[1] + v.z * cr.n[2] - cr.d);
          if (d < cr.w) out.multiplyScalar(1 - (cr.k ?? 0.6) * (1 - d / cr.w));
        }
      }
      if (tone !== 1) out.multiplyScalar(tone);
      return out;
    },
    rough,
    metal,
    emissive,
    mat,
  });
}

/** Per-vertex helper: after placing a faceted geometry, drop the vertices that fell below `y` back onto it. */
export function floorAt(geo, y) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < y) pos.setY(i, y);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Triangle soup with per-vertex colour and sway, for foliage that hangs from swaying limbs
 * (needles, strands, leaves, icicles): every vertex is given the sway of the point it hangs from.
 *   const s = new Soup(); s.v(x, y, z, colour, sway, emissive) three times per triangle;
 *   s.build(MAT.PLANT, rough)
 */
export class Soup {
  constructor() {
    this.p = [];
    this.c = [];
    this.f = [];
  }
  get count() {
    return this.p.length / 9;
  }
  v(x, y, z, c, sway = 0, emissive = 0) {
    this.p.push(x, y, z);
    this.c.push(c.r, c.g, c.b);
    this.f.push(emissive, sway);
    return this;
  }
  tri(a, b, c, ca, cb, cc, sa = 0, sb = sa, sc = sa, emissive = 0) {
    return this.v(a.x, a.y, a.z, ca, sa, emissive).v(b.x, b.y, b.z, cb, sb, emissive).v(c.x, c.y, c.z, cc, sc, emissive);
  }
  /** A 3-sided spike from a to b. */
  spike(a, b, r, ca, cb, sa = 0, sb = sa, emissive = 0) {
    const t = spike([a.x, a.y, a.z], [b.x, b.y, b.z], r);
    for (let i = 0; i < t.length; i += 9) {
      this.v(t[i], t[i + 1], t[i + 2], ca, sa, emissive);
      this.v(t[i + 3], t[i + 4], t[i + 5], ca, sa, emissive);
      this.v(t[i + 6], t[i + 7], t[i + 8], cb, sb, emissive);
    }
    return this;
  }
  /**
   * A tube with flat sides through pts (Vector3[]). rad: number (tapers to a point), array per
   * point, or (t 0..1) => radius; a radius of 0 closes the tube to a point.
   */
  tube(pts, rad, c0, c1 = c0, s0 = 0, s1 = s0, sides = 3, emissive = 0) {
    const n = pts.length;
    if (n < 2) return this;
    const T = new V3(),
      N = new V3(1, 0, 0),
      B = new V3();
    T.subVectors(pts[1], pts[0]).normalize();
    if (Math.abs(T.x) > 0.9) N.set(0, 0, 1);
    const rings = [];
    for (let i = 0; i < n; i++) {
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      N.addScaledVector(T, -N.dot(T)).normalize();
      B.crossVectors(T, N);
      const t = i / (n - 1);
      const r = typeof rad === 'function' ? rad(t) : Array.isArray(rad) ? rad[i] : rad * (1 - t);
      const ring = [];
      if (r <= 1e-5) ring.push(pts[i].clone());
      else
        for (let j = 0; j < sides; j++) {
          const a = (j / sides) * TAU;
          ring.push(new V3().copy(pts[i]).addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r));
        }
      rings.push(ring);
    }
    const ca = new THREE.Color(),
      cb = new THREE.Color();
    for (let i = 0; i < n - 1; i++) {
      const a = rings[i],
        b = rings[i + 1];
      if (a.length === 1 && b.length === 1) continue;
      const ta = i / (n - 1),
        tb = (i + 1) / (n - 1);
      ca.copy(c0).lerp(c1, ta);
      cb.copy(c0).lerp(c1, tb);
      const sa = lerp(s0, s1, ta),
        sb = lerp(s0, s1, tb);
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        if (b.length === 1) this.tri(a[j], a[j1], b[0], ca, ca, cb, sa, sa, sb, emissive);
        else if (a.length === 1) this.tri(a[0], b[j1], b[j], ca, cb, cb, sa, sb, sb, emissive);
        else {
          this.tri(a[j], a[j1], b[j], ca, ca, cb, sa, sa, sb, emissive);
          this.tri(a[j1], b[j1], b[j], ca, cb, cb, sa, sb, sb, emissive);
        }
      }
    }
    return this;
  }
  build(mat = MAT.PLANT, rough = 0.85, metal = 0) {
    const n = this.p.length / 3;
    if (!n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    const fx = new Float32Array(n * 4),
      m = new Float32Array(n).fill(mat);
    for (let i = 0; i < n; i++) {
      fx[i * 4] = this.f[i * 2];
      fx[i * 4 + 1] = rough;
      fx[i * 4 + 2] = metal;
      fx[i * 4 + 3] = this.f[i * 2 + 1];
    }
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(m, 1));
    g.setAttribute('aUvw', new THREE.Float32BufferAttribute(this.p.slice(), 3));
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Convex solids: rock that is cut, not sculpted. A solid is a list of faces, each a loop of
// points that runs counter-clockwise when seen from outside. Cutting keeps every face flat and
// every edge hard; facesToGeo then breaks the faces up so paint and a little relief can vary.
// ---------------------------------------------------------------------------------------------
export function boxFaces(hx = 1, hy = hx, hz = hx) {
  const p = (x, y, z) => new V3(x * hx, y * hy, z * hz);
  return [
    [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)],
    [p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1)],
    [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)],
    [p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1)],
    [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)],
    [p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1)],
  ];
}

/** An upright prism over a polygon [[x, z], ...] listed by increasing angle atan2(z, x), from y0 to y1. */
export function prismFaces(poly, y0, y1) {
  const n = poly.length;
  const top = poly.map(([x, z]) => new V3(x, y1, z)).reverse();
  const bot = poly.map(([x, z]) => new V3(x, y0, z));
  const faces = [top, bot];
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    faces.push([new V3(a[0], y0, a[1]), new V3(a[0], y1, a[1]), new V3(b[0], y1, b[1]), new V3(b[0], y0, b[1])]);
  }
  return faces;
}

/** Keep the part of a convex solid where n . p <= d (n need not be unit length). The cut is closed with a new face. */
export function clipFaces(faces, nx, ny, nz, d) {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  d /= l;
  const EPS = 1e-6;
  const out = [];
  let changed = false;
  for (const f of faces) {
    const m = f.length;
    let inside = 0,
      outside = 0;
    const dist = new Array(m);
    for (let i = 0; i < m; i++) {
      dist[i] = f[i].x * nx + f[i].y * ny + f[i].z * nz - d;
      if (dist[i] > EPS) outside++;
      else if (dist[i] < -EPS) inside++;
    }
    if (!outside) {
      out.push(f);
      continue;
    }
    changed = true;
    if (!inside) continue;
    const g = [];
    for (let i = 0; i < m; i++) {
      const a = f[i],
        b = f[(i + 1) % m];
      const da = dist[i],
        db = dist[(i + 1) % m];
      if (da <= EPS) g.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) g.push(new V3().lerpVectors(a, b, da / (da - db)));
    }
    if (g.length >= 3) out.push(g);
  }
  if (!changed) return out;
  // the new face: every kept point that lies on the plane, in order round the normal
  const pts = [];
  for (const f of out)
    for (const p of f) {
      if (Math.abs(p.x * nx + p.y * ny + p.z * nz - d) > 2e-5) continue;
      let dup = false;
      for (const q of pts)
        if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z) < 3e-5) {
          dup = true;
          break;
        }
      if (!dup) pts.push(p);
    }
  if (pts.length >= 3) {
    const c = new V3();
    for (const p of pts) c.add(p);
    c.multiplyScalar(1 / pts.length);
    const n = new V3(nx, ny, nz);
    const u = new V3(1, 0, 0);
    if (Math.abs(nx) > 0.8) u.set(0, 1, 0);
    u.addScaledVector(n, -u.dot(n)).normalize();
    const v = new V3().crossVectors(n, u);
    const w = new V3();
    const ang = (p) => {
      w.subVectors(p, c);
      return Math.atan2(w.dot(v), w.dot(u));
    };
    out.push(pts.map((p) => [ang(p), p]).sort((a, b) => a[0] - b[0]).map((e) => e[1]));
  }
  return out;
}

/** The faces of a solid for which keep(normal, face) is true. */
export function filterFaces(faces, keep) {
  const n = new V3();
  return faces.filter((f) => {
    n.set(0, 0, 0);
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    n.normalize();
    return keep(n, f);
  });
}

/** Split a solid in two along a plane, leaving `gap` between the halves. */
export function splitFaces(faces, nx, ny, nz, d, gap = 0) {
  const l = Math.hypot(nx, ny, nz) || 1;
  return [clipFaces(faces, nx / l, ny / l, nz / l, d / l - gap / 2), clipFaces(faces, -nx / l, -ny / l, -nz / l, -d / l - gap / 2)];
}

const _fm = new THREE.Matrix4(),
  _fq = new THREE.Quaternion(),
  _fe = new THREE.Euler();
/** A moved copy of a solid: scale (number | [x, y, z]), then rotate (XYZ radians) about `pivot`, then translate. */
export function xfFaces(faces, { t = [0, 0, 0], r = [0, 0, 0], s = 1, pivot = null } = {}) {
  _fe.set(r[0], r[1], r[2], 'XYZ');
  _fq.setFromEuler(_fe);
  const sv = typeof s === 'number' ? new V3(s, s, s) : new V3(s[0], s[1], s[2]);
  _fm.compose(new V3(0, 0, 0), _fq, sv);
  const pv = pivot ? new V3(pivot[0], pivot[1], pivot[2]) : new V3();
  return faces.map((f) => f.map((p) => new V3().copy(p).sub(pv).applyMatrix4(_fm).add(pv).add(new V3(t[0], t[1], t[2]))));
}

/** A plane { n: [x, y, z] (unit), d, ... } carried along by the same move as xfFaces (no scale). */
export function xfPlane(pl, { t = [0, 0, 0], r = [0, 0, 0], pivot = null } = {}) {
  _fe.set(r[0], r[1], r[2], 'XYZ');
  _fq.setFromEuler(_fe);
  const v = new V3(pl.n[0], pl.n[1], pl.n[2]).applyQuaternion(_fq);
  const pv = pivot || [0, 0, 0];
  const d = pl.d - (pl.n[0] * pv[0] + pl.n[1] * pv[1] + pl.n[2] * pv[2]) + v.x * (pv[0] + t[0]) + v.y * (pv[1] + t[1]) + v.z * (pv[2] + t[2]);
  return { ...pl, n: [v.x, v.y, v.z], d };
}

/** Bounds and vertex centre of a solid: { min, max, centre }. */
export function facesInfo(faces) {
  const min = new V3(Infinity, Infinity, Infinity),
    max = new V3(-Infinity, -Infinity, -Infinity),
    centre = new V3();
  let n = 0;
  for (const f of faces)
    for (const p of f) {
      min.min(p);
      max.max(p);
      centre.add(p);
      n++;
    }
  if (n) centre.multiplyScalar(1 / n);
  return { min, max, centre, empty: n === 0 };
}

/** How far a solid reaches along a direction: the largest n . p (n need not be unit length). */
export function support(faces, nx, ny, nz) {
  const l = Math.hypot(nx, ny, nz) || 1;
  let m = -Infinity;
  for (const f of faces) for (const p of f) m = Math.max(m, (p.x * nx + p.y * ny + p.z * nz) / l);
  return m;
}

/** Knock a corner or an edge off: a cut `depth` deep along n, measured from the farthest point that way. */
export function nick(faces, nx, ny, nz, depth) {
  const l = Math.hypot(nx, ny, nz) || 1;
  const g = clipFaces(faces, nx, ny, nz, (support(faces, nx, ny, nz) - depth) * l);
  return g.length >= 4 ? g : faces;
}

/**
 * A convex rock: the unit box chipped by random planes, then scaled to `size` (full extents).
 *   cuts       how many random planes
 *   depth      [min, max] distance of the planes from the centre (1 = touching the box faces)
 *   block      0 keeps that distance whatever the direction, which rounds the rock off;
 *              1 measures it against how far the box reaches that way, which keeps it a block
 *   vertical   0..1 share of planes that are steep (joints);  level  0..1 share that are near level (beds)
 *   tilt       how far a steep plane may lean, in unit space (use less for thin slabs)
 *   nicks      how many corners are then knocked off, each nickDepth [min, max] deep (unit space)
 *   fit        stretch the chipped rock back out to exactly `size`
 *   planes     extra planes [[nx, ny, nz, d], ...] in unit space
 */
export function chipRock(R, { size = [1, 1, 1], cuts = 14, depth = [0.62, 0.95], vertical = 0.3, level = 0, tilt = 0.12, block = 0, nicks = 0, nickDepth = [0.05, 0.2], fit = false, planes = [] } = {}) {
  let f = boxFaces(1, 1, 1);
  for (let k = 0; k < cuts; k++) {
    let nx = R.gauss(),
      ny = R.gauss(),
      nz = R.gauss();
    const kind = R.next();
    if (kind < vertical) ny *= tilt;
    else if (kind < vertical + level) {
      nx *= 0.15;
      nz *= 0.15;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const reach = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
    const d = R.range(depth[0], depth[1]) * (1 + (reach - 1) * block);
    const g = clipFaces(f, nx, ny, nz, d);
    if (g.length >= 4) f = g;
  }
  for (const p of planes) f = clipFaces(f, p[0], p[1], p[2], p[3]);
  for (let k = 0; k < nicks; k++) {
    const nx = R.gauss(),
      ny = R.gauss(),
      nz = R.gauss(),
      dep = R.range(nickDepth[0], nickDepth[1]);
    f = nick(f, nx, ny, nz, dep);
  }
  let sx = size[0] / 2,
    sy = size[1] / 2,
    sz = size[2] / 2;
  if (fit) {
    const i = facesInfo(f);
    f = xfFaces(f, { t: [-(i.min.x + i.max.x) / 2, -(i.min.y + i.max.y) / 2, -(i.min.z + i.max.z) / 2] });
    sx = size[0] / Math.max(1e-6, i.max.x - i.min.x);
    sy = size[1] / Math.max(1e-6, i.max.y - i.min.y);
    sz = size[2] / Math.max(1e-6, i.max.z - i.min.z);
  }
  return xfFaces(f, { s: [sx, sy, sz] });
}

/**
 * Faces -> faceted geometry. Every edge of a face is cut into pieces about `edge` long (at most
 * 2^maxLvl of them), the count depending on the length of the edge alone, so the two faces that
 * share it agree; the face is then filled with rings closing on its centre.
 *   bump     pushes the inner points of a face in and out along its normal (the rim stays put)
 *   warp     moves every point by a field that depends on the place alone, so edges stop being
 *            ruled lines and neighbouring faces still meet; warpFreq is its grain, per metre
 *   minimal  true (or (n, face) => true) gives the fewest triangles, for far lods and hidden faces
 *   skip     (n, face) => true leaves a face out, e.g. undersides nobody sees
 * The result remembers, per vertex, the normal of its face (userData.faceN) and how far it is
 * from the rim of the face, 0 on the rim to 1 at the centre (userData.faceW).
 */
export function facesToGeo(faces, { edge = 0.35, maxLvl = 2, bump = 0, warp = 0, warpFreq = 1.3, seed = 1, freq = 2.2, minimal = false, skip = null } = {}) {
  const nzz = new Noise((seed * 97 + 13) >>> 0);
  const P = [],
    FN = [],
    FW = [];
  const n = new V3(),
    c = new V3(),
    wv = new V3();
  for (const f of faces) {
    const m = f.length;
    if (m < 3) continue;
    n.set(0, 0, 0);
    c.set(0, 0, 0);
    for (let i = 0; i < m; i++) {
      const a = f[i],
        b = f[(i + 1) % m];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
      c.add(a);
    }
    const a2 = n.length();
    if (a2 < 1e-10) continue;
    n.multiplyScalar(1 / a2);
    if (skip && skip(n, f)) continue;
    c.multiplyScalar(1 / m);
    const fx = n.x,
      fy = n.y,
      fz = n.z;
    const put = (p, w) => {
      FN.push(fx, fy, fz);
      FW.push(w);
      let x = p.x,
        y = p.y,
        z = p.z;
      if (bump && w > 0) {
        const k = nzz.fbm3(x * freq, y * freq, z * freq, 2) * bump * Math.min(1, w * 2.5);
        x += fx * k;
        y += fy * k;
        z += fz * k;
      }
      if (warp) {
        warpAt(nzz, p.x, p.y, p.z, warp, warpFreq, wv);
        x += wv.x;
        y += wv.y;
        z += wv.z;
      }
      P.push(x, y, z);
    };
    const tri = (a, wa, b, wb, d, wd) => {
      put(a, wa);
      put(b, wb);
      put(d, wd);
    };
    let size = 0,
      L = 0;
    const lv = [];
    for (let i = 0; i < m; i++) {
      size = Math.max(size, f[i].distanceTo(c));
      const l = Math.max(0, Math.min(maxLvl, Math.round(Math.log2(Math.max(1e-6, f[i].distanceTo(f[(i + 1) % m]) / edge)))));
      lv.push(l);
      if (l > L) L = l;
    }
    L = Math.max(L, Math.max(0, Math.min(maxLvl, Math.round(Math.log2(Math.max(1e-6, size / edge))))));
    if ((typeof minimal === 'function' ? minimal(n, f) : minimal) || (L === 0 && (m === 3 || size < edge * 0.7))) {
      for (let i = 1; i < m - 1; i++) tri(f[0], 0, f[i], 0, f[i + 1], 0);
      continue;
    }
    // ring r: the rim drawn in toward the centre, each edge cut half as finely as on the ring outside it
    const ring = (r) => {
      const t = (L + 1 - r) / (L + 1);
      const pts = [];
      for (let i = 0; i < m; i++) {
        const k = 1 << Math.max(0, lv[i] - r);
        const a = f[i],
          b = f[(i + 1) % m];
        const row = [];
        for (let j = 0; j < k; j++) {
          let q = j === 0 ? a : new V3().lerpVectors(a, b, j / k);
          if (r > 0) q = new V3().lerpVectors(c, q, t);
          row.push(q);
        }
        pts.push(row);
      }
      return { pts, w: 1 - t };
    };
    let outer = ring(0);
    for (let r = 0; r < L; r++) {
      const inner = ring(r + 1);
      for (let i = 0; i < m; i++) {
        const o = outer.pts[i],
          q = inner.pts[i];
        const oEnd = outer.pts[(i + 1) % m][0],
          qEnd = inner.pts[(i + 1) % m][0];
        const O = (j) => (j < o.length ? o[j] : oEnd),
          Q = (j) => (j < q.length ? q[j] : qEnd);
        if (o.length === q.length) {
          tri(O(0), outer.w, O(1), outer.w, Q(1), inner.w);
          tri(O(0), outer.w, Q(1), inner.w, Q(0), inner.w);
        } else
          for (let j = 0; j < q.length; j++) {
            tri(O(2 * j), outer.w, O(2 * j + 1), outer.w, Q(j), inner.w);
            tri(O(2 * j + 1), outer.w, Q(j + 1), inner.w, Q(j), inner.w);
            tri(O(2 * j + 1), outer.w, O(2 * j + 2), outer.w, Q(j + 1), inner.w);
          }
      }
      outer = inner;
    }
    const cc = c.clone();
    for (let i = 0; i < m; i++) tri(cc, 1, outer.pts[i][0], outer.w, outer.pts[(i + 1) % m][0], outer.w);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  g.userData.faceN = FN;
  g.userData.faceW = FW;
  return g;
}

/** The warp of facesToGeo at one place, for things that must stay on a warped face. */
export function warpAt(nzz, x, y, z, warp, warpFreq, out = new V3()) {
  const a = x * warpFreq,
    b = y * warpFreq,
    c = z * warpFreq;
  return out.set(nzz.fbm3(a + 11.3, b, c, 2) * warp, nzz.fbm3(a, b + 23.7, c, 2) * warp * 0.7, nzz.fbm3(a, b, c + 37.1, 2) * warp);
}

/** The noise facesToGeo warps with for a given seed. */
export const warpNoise = (seed) => new Noise((seed * 97 + 13) >>> 0);

/** Triangle count of a geometry. */
export const tris = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
export { V3 };
