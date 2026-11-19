// The briar: the wall that bars the Saltwood, the seed that sleeps under the Elder Hollow and the
// climbing vine that Verdance wakes from it. Registers briar_wall, seed_mound, briar_vine.
//
// All three are bare canes: a hand-laid skeleton (addLimb) meshed by the tree code (meshLimbs),
// with thorns, twigs, leaves and blooms hung on it as triangle soup.
import { Builder, Rng, Noise, TAU, MAT, THREE, col, paint, leaf, ring, dome, sphere, rock, smooth, noisy, deform } from '../kit.js';
import { register } from '../registry.js';
import { meshLimbs, stations, blade, Soup, clamp01, lerp, smooth01, V3 } from './_shared.js';

const KIND = { kind: 'gameplay', variants: 1 };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const C = {
  // dead briar: near black with a cold purple-brown cast
  bark: col('#1b1418'),
  barkMid: col('#2c2228'),
  barkLit: col('#51464e'),
  twig: col('#2b1c1f'),
  pit: col('#070506'),
  soil: col('#0d0a09'),
  thorn: col('#221818'),
  thornTip: col('#bdb198'),
  rose: col('#4a1619'),
  roseDark: col('#1c0a0b'),
  hip: col('#2a1411'),
  // the living vine
  vine: col('#1f1a15'),
  vineMid: col('#2f281f'),
  vineLit: col('#575040'),
  shoot: col('#232a1b'),
  shootTip: col('#3a4a2c'),
  leaf: col('#1f2f1c'),
  leafLit: col('#3f5832'),
  leafVein: col('#10160f'),
  petal: col('#d3ccba'),
  petalBase: col('#8d957a'),
  boss: col('#8f8c4c'),
  // earth
  earth: col('#17110d'),
  earthLit: col('#2a1f17'),
  crumb: col('#43352a'),
  husk: col('#241a17'),
  huskRib: col('#40302a'),
  root: col('#8a806a'),
  sick: col('#7fd060'),
  sickDeep: col('#58a83c'),
};
const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// A skeleton laid by hand
// ---------------------------------------------------------------------------------------------
const newSkel = (seed) => ({ limbs: [], height: 1, spread: 1, seed: seed >>> 0 });
/** pts: V3[], rad: radius per point. sw0 / sw1: wind sway at the base and at the tip. */
function addLimb(skel, pts, rad, o = {}) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const length = s[s.length - 1];
  const limb = { id: skel.limbs.length, depth: o.depth || 0, parent: o.parent || null, sAttach: o.sAttach || 0, pts, rad, s, broken: !!o.broken, capped: !!o.capped, rnd: o.rnd ?? 0.5, tag: o.tag || null, spec: {}, full: length, length, sw0: o.sw0 || 0, sw1: o.sw1 || 0 };
  skel.limbs.push(limb);
  return limb;
}
/** Sway the way meshLimbs asks for it: nothing from the place, everything from the limb. */
const SWAY = { at: () => 0, own: (l, s) => l.sw0 + (l.sw1 - l.sw0) * Math.pow(s / (l.length || 1), 2) };

const _a = new V3(),
  _b = new V3(),
  _p = new V3(),
  _q = new V3();
/** Direction square to a limb at a station, pulled toward `bias`. Left in _p. */
function sideways(o, R, bias, pull) {
  _p.set(R.range(-1, 1), R.range(-0.7, 1), R.range(-1, 1));
  if (bias) _p.addScaledVector(bias, pull);
  _p.addScaledVector(o.tan, -_p.dot(o.tan));
  if (_p.lengthSq() < 1e-6) _p.set(o.tan.y, -o.tan.x, 0);
  return _p.normalize();
}
/** A three-sided thorn, hooked back toward the root: dark at the foot, bone at the point. */
function thorn(soup, o, R, len, bias, pull, sway = 0, ca = C.thorn, cb = C.thornTip) {
  sideways(o, R, bias, pull);
  _a.copy(o.pos).addScaledVector(_p, o.rad * 0.45);
  _b.copy(o.pos)
    .addScaledVector(_p, o.rad + len)
    .addScaledVector(o.tan, -len * 0.3);
  soup.spike(_a, _b, Math.max(0.005, len * 0.15), ca, cb, sway, sway);
}
/** The same thorn as one flat triangle, for where they come by the hundred. */
function thornFlat(soup, o, R, len, bias, pull, sway = 0) {
  sideways(o, R, bias, pull);
  const w = len * 0.2;
  _a.copy(o.pos).addScaledVector(o.tan, -w);
  _b.copy(o.pos).addScaledVector(o.tan, w);
  _q.copy(o.pos)
    .addScaledVector(_p, o.rad + len)
    .addScaledVector(o.tan, -len * 0.3);
  soup.tri(_a, _b, _q, C.thorn, C.thorn, C.thornTip, sway);
}

const _m = new THREE.Matrix4(),
  _x = new V3(),
  _y = new V3(),
  _z = new V3(),
  _s = new V3();
/** Put a part built along +Y with its face to +Z at `pos`, pointing along `dir`, its face turned to `face`. */
function aim(geo, pos, dir, face, s = 1) {
  _y.copy(dir).normalize();
  _z.copy(face).addScaledVector(_y, -face.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(_y.y, -_y.x, 0.01);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  _m.scale(_s.set(s, s, s));
  _m.setPosition(pos);
  geo.applyMatrix4(_m);
  return geo;
}

// ---------------------------------------------------------------------------------------------
// briar_wall: the barricade across the road into the Saltwood. 7 m wide (X), 3.6 m tall, 2.2 m
// deep. A lightless heart, a hundred canes woven over it, a thorn every hand's breadth, and the
// last of its roses, dead on the stem. Ember burns it away.
// ---------------------------------------------------------------------------------------------
register(
  'briar_wall',
  (seed) => {
    const R = new Rng(seed * 7919 + 4201);
    const nz = new Noise(seed * 13 + 4201);
    const HX = 3.5,
      HZ = 1.08,
      TOP = 3.66;
    /** How high the thicket stands at x: ragged, and lower at the two ends. */
    const crest = (x) => (2.5 + 0.62 * nz.fbm3(x * 0.85, 0.37, 1.7, 2)) * (0.62 + 0.38 * smooth01(0, 1.1, HX - Math.abs(x)));
    /** Half depth of the dark heart at height y, and how it thins toward the ends. */
    const heart = (y) => lerp(0.78, 0.44, clamp01(y / 3));
    const endK = (x) => 0.5 + 0.5 * smooth01(0, 1.1, HX - 0.25 - Math.abs(x));
    const skin = (x, y) => heart(y) * endK(x);
    const keep = (p) => p.set(clamp(p.x, -HX + 0.03, HX - 0.03), clamp(p.y, 0.04, TOP), clamp(p.z, -HZ, HZ));

    // ---- the heart: nothing can be seen through the middle of the wall
    let core = smooth(new THREE.BoxGeometry(2, 2, 2, 14, 6, 3));
    deform(core, (p) => {
      const x = p.x * 3.02;
      const t = (p.y + 1) * 0.5;
      const top = crest(x) * 0.94;
      const y = -0.5 + t * (top + 0.5) - 0.32 * Math.pow(t, 4) * p.z * p.z;
      p.set(x, y, p.z * skin(x, y) * (1 - 0.3 * Math.pow(t, 3)));
    });
    core = noisy(core, 0.2, 2.0, seed + 41, 3);
    paint(core, { color: (v) => _c.copy(C.pit).lerp(C.bark, clamp01(0.12 + 0.3 * nz.n3(v.x * 2.3, v.y * 2.3, v.z * 2.3))), rough: 1, mat: MAT.PLAIN, sway: 0 });

    // ---- canes
    const skel = newSkel(seed * 104729 + 4201);
    const N_ROOT = 22;
    for (let i = 0; i < N_ROOT; i++) {
      // they come out of the ground on both faces, lean along the wall, arch and come down again
      const zs = i % 2 ? 1 : -1;
      const x0 = lerp(-3.2, 3.2, (i + R.range(0.15, 0.85)) / N_ROOT);
      let dirX = R.chance(0.5) ? 1 : -1;
      if (x0 > 2.2) dirX = -1;
      else if (x0 < -2.2) dirX = 1;
      const run = R.range(1.3, 3.0);
      const peak = Math.min(3.5, crest(clamp(x0 + dirX * run * 0.6, -3.3, 3.3)) + R.range(0.0, 0.5));
      const tp = R.range(0.58, 0.8),
        droop = R.range(0.5, 1.7);
      const over = i % 4 === 1; // these cross the top and come down the other face
      const r0 = R.range(0.05, 0.085);
      const ph1 = R.range(0, TAU),
        ph2 = R.range(0, TAU),
        wf = R.range(5, 9);
      const n = 13;
      const pts = [],
        rad = [];
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const x = clamp(x0 + dirX * run * Math.pow(t, 1.1) + 0.12 * Math.sin(t * 7 + ph1), -3.42, 3.42);
        const y = t < tp ? -0.6 + (peak + 0.6) * Math.sin((t / tp) * Math.PI * 0.5) : peak - droop * Math.pow((t - tp) / (1 - tp), 1.6);
        const flip = over ? Math.cos(Math.PI * smooth01(tp - 0.22, tp + 0.22, t)) : 1;
        const out = Math.min(HZ - 0.03, skin(x, y) + 0.05 + 0.26 * (0.5 + 0.5 * Math.sin(t * wf + ph2)));
        pts.push(new V3(x, y, zs * flip * out));
        rad.push(r0 * (1 - 0.86 * Math.pow(t, 1.25)));
      }
      addLimb(skel, pts, rad, { rnd: R.next(), tag: 'cane' });
    }
    // the two ends: canes that climb the end of the heart and lean in over it
    for (const sx of [-1, 1])
      for (const zq of [-0.62, -0.2, 0.22, 0.6]) {
        const zs = zq < 0 ? -1 : 1;
        const x0 = sx * R.range(3.0, 3.3),
          z0 = zq + R.range(-0.1, 0.1);
        const peak = R.range(2.1, 2.9),
          run = R.range(1.3, 2.3),
          r0 = R.range(0.05, 0.075),
          ph = R.range(0, TAU);
        const n = 10;
        const pts = [],
          rad = [];
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1);
          const x = clamp(x0 - sx * run * Math.pow(t, 1.5) + sx * 0.3 * Math.sin(t * Math.PI) * (1 - t), -3.44, 3.44);
          const y = -0.6 + (peak + 0.6) * Math.sin(Math.min(1, t / 0.75) * Math.PI * 0.5) - (t > 0.75 ? 0.7 * Math.pow((t - 0.75) / 0.25, 1.6) : 0);
          pts.push(new V3(x, y, z0 * (1 - 0.4 * t) + zs * 0.1 * Math.sin(t * 6 + ph)));
          rad.push(r0 * (1 - 0.86 * Math.pow(t, 1.25)));
        }
        addLimb(skel, pts, rad, { rnd: R.next(), tag: 'cane' });
      }
    // binders: long canes laid along the wall, in front of some uprights and behind others
    const N_BIND = 7;
    for (let i = 0; i < N_BIND; i++) {
      const zs = i % 2 ? -1 : 1;
      const y0 = 0.3 + (i / (N_BIND - 1)) * 2.4 + R.range(-0.12, 0.12);
      const xa = -R.range(2.3, 3.4),
        xb = R.range(2.3, 3.4);
      const slope = R.range(-1.5, 1.5),
        r0 = R.range(0.034, 0.055);
      const ph = R.range(0, TAU),
        ph2 = R.range(0, TAU);
      const n = 19;
      const pts = [],
        rad = [];
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const x = lerp(xa, xb, t);
        const y = clamp(y0 + slope * (t - 0.5) + 0.3 * Math.sin(t * 5 + ph), 0.12, crest(x) + 0.1);
        const out = Math.min(HZ - 0.03, skin(x, y) + 0.07 + 0.24 * (0.5 + 0.5 * Math.sin(t * 11 + ph2)));
        pts.push(new V3(x, y, zs * out));
        rad.push(k === 0 ? 0.004 : r0 * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * clamp(t, 0.03, 0.97)), 0.5)));
      }
      addLimb(skel, pts, rad, { rnd: R.next(), tag: 'bind' });
    }
    // side shoots: what makes the outline bristle. Near the crest they stand up out of it.
    const mains = skel.limbs.slice();
    for (const o of stations({ limbs: mains }, () => true, 0.62, R, { from: 0.18, to: 0.96 })) {
      if (o.pos.y < 0.15) continue;
      const out = o.pos.z >= 0 ? 1 : -1;
      const high = o.pos.y > crest(o.pos.x) - 0.45;
      _p.set(R.range(-0.8, 0.8), high ? R.range(0.6, 1.3) : R.range(-0.2, 0.7), out * R.range(0.25, 0.9)).normalize();
      const len = high ? R.range(0.45, 0.95) : R.range(0.3, 0.7);
      const r = clamp(o.rad * 0.55, 0.012, 0.028);
      const p1 = keep(new V3().copy(o.pos).addScaledVector(_p, len * 0.45));
      _p.x += R.range(-0.5, 0.5);
      _p.y += R.range(-0.1, 0.5);
      _p.z += R.range(-0.4, 0.4);
      _p.normalize();
      const p2 = keep(new V3().copy(p1).addScaledVector(_p, len * 0.55));
      addLimb(skel, [o.pos.clone(), p1, p2], [r, r * 0.62, 0], { depth: 1, parent: o.limb, sAttach: o.s, rnd: R.next(), tag: 'twig', sw1: R.range(0.3, 0.6) });
    }
    const canes = meshLimbs(skel, {
      pick: (l) => (l.depth >= 1 ? { radial: 3, step: 1 } : { radial: l.tag === 'bind' ? 4 : 5, step: 1 }),
      sway: SWAY,
      mat: MAT.WOOD,
      rough: 0.9,
      flare: 0,
      burl: 0.16,
      lobes: 0.08,
      colour: (v, c) => {
        c.copy(v.depth === 0 ? C.bark : C.twig).lerp(C.barkMid, 0.5 + 0.5 * nz.n3(v.x * 3.1, v.y * 3.1, v.z * 3.1));
        c.lerp(C.barkLit, clamp01(0.1 + v.ny * 0.6) * 0.6);
        if (v.y < 0.3) c.lerp(C.soil, clamp01((0.3 - v.y) / 0.5));
        // no light gets down between the canes
        const deep = clamp01(1 - (Math.abs(v.z) - skin(v.x, Math.max(0, v.y)) + 0.04) / 0.26);
        c.multiplyScalar(1 - 0.55 * deep * clamp01((3.0 - v.y) / 1.2 + 0.3));
      },
    });

    // ---- the tangle on the heart, and the spikes that stand out of the crest
    const tangle = new Soup();
    for (let i = 0; i < 400; i++) {
      const zs = i % 2 ? 1 : -1;
      const x = R.range(-3.25, 3.25);
      const y = R.range(0.02, Math.max(0.3, crest(x) * 0.95));
      const ang = R.range(-0.5, 1.45),
        sx = R.chance(0.5) ? 1 : -1;
      const len = R.range(0.35, 1.3);
      _a.set(x, y, zs * (skin(x, y) * (1 - 0.3 * Math.pow(clamp01(y / (crest(x) * 0.94)), 3)) + 0.02));
      _b.set(x + Math.cos(ang) * sx * len, y + Math.sin(ang) * len, 0);
      keep(_b);
      _b.z = zs * Math.min(HZ, skin(_b.x, _b.y) + R.range(0.1, 0.34));
      const k = R.range(0, 1);
      tangle.tube([_a.clone(), _b.clone()], R.range(0.016, 0.03), _c.copy(C.pit).lerp(C.bark, 0.5).clone(), C.twig.clone().lerp(C.barkLit, 0.15 + 0.35 * k), 0, 0.12 * k, 3);
    }
    // the two ends are as shut as the faces
    for (let i = 0; i < 90; i++) {
      const sx = i % 2 ? 1 : -1;
      const y = R.range(0.02, 2.0),
        z = R.range(-0.55, 0.55) * endK(3.0);
      const len = R.range(0.35, 0.95);
      _a.set(sx * 2.95, y, z);
      _b.set(sx * (2.95 + R.range(0.18, 0.5)), y + R.range(-0.25, 0.75) * len, z + R.range(-0.6, 0.6) * len);
      keep(_b);
      const k = R.range(0, 1);
      tangle.tube([_a.clone(), _b.clone()], R.range(0.016, 0.03), _c.copy(C.pit).lerp(C.bark, 0.5).clone(), C.twig.clone().lerp(C.barkLit, 0.15 + 0.35 * k), 0, 0.12 * k, 3);
    }
    for (let i = 0; i < 46; i++) {
      const x = lerp(-3.3, 3.3, (i + R.range(0, 1)) / 46);
      const z = R.range(-0.4, 0.4);
      const cy = crest(x) * 0.9;
      const len = R.range(0.4, 0.95);
      _a.set(x, cy - 0.15, z);
      _p.set(R.range(-0.55, 0.55), 1, R.range(-0.6, 0.6)).normalize();
      _b.copy(_a).addScaledVector(_p, len * 0.55);
      _p.x += R.range(-0.5, 0.5);
      _p.z += R.range(-0.5, 0.5);
      _p.normalize();
      _q.copy(_b).addScaledVector(_p, len * 0.45);
      keep(_b);
      keep(_q);
      const r = R.range(0.018, 0.03);
      tangle.tube([_a.clone(), _b.clone(), _q.clone()], [r, r * 0.6, 0], C.bark, C.twig.clone().lerp(C.barkLit, 0.35), 0, R.range(0.3, 0.6), 3);
    }

    // ---- thorns: as long as a finger on the old canes
    const th = new Soup();
    const bias = new V3();
    const outOf = (o) => bias.set(0, 0.25, o.pos.z >= 0 ? 1 : -1);
    for (const o of stations(skel, (l) => l.tag === 'cane', 0.2, R, { from: 0.12, to: 0.97 })) if (o.pos.y > 0.05) thorn(th, o, R, R.range(0.09, 0.15), outOf(o), 1.0, SWAY.own(o.limb, o.s));
    for (const o of stations(skel, (l) => l.tag === 'bind', 0.13, R, { from: 0.03, to: 0.97 })) thornFlat(th, o, R, R.range(0.08, 0.13), outOf(o), 1.0, 0);
    for (const o of stations(skel, (l) => l.tag === 'twig', 0.2, R, { from: 0.2, to: 0.9 })) thornFlat(th, o, R, R.range(0.05, 0.08), outOf(o), 0.6, SWAY.own(o.limb, o.s));

    // ---- dead roses: the last thing the wall grew
    const roses = [];
    const spots = stations(skel, (l) => l.tag === 'cane', 0.5, R, { from: 0.3, to: 0.85 }).filter((o) => o.pos.y > 1.0 && o.pos.y < 2.7 && Math.abs(o.pos.z) > skin(o.pos.x, o.pos.y) + 0.14 && Math.abs(o.pos.x) < 3.1);
    const taken = [];
    const want = { 1: 5, '-1': 4 };
    for (const o of spots) {
      const out = o.pos.z >= 0 ? 1 : -1;
      if (!want[out] || taken.some((t) => t.out === out && Math.abs(t.x - o.pos.x) < 0.9)) continue;
      want[out]--;
      taken.push({ out, x: o.pos.x });
      const rr = R.fork(taken.length * 17);
      // the stalk leaves the cane, bows under the weight and lets the head hang
      const p0 = o.pos.clone();
      const p1 = new V3(p0.x + rr.range(-0.03, 0.03), p0.y + 0.05, p0.z + out * 0.13);
      const p2 = new V3(p1.x + rr.range(-0.03, 0.03), p1.y - 0.05, p1.z + out * 0.09);
      const p3 = new V3(p2.x, p2.y - 0.1, p2.z + out * 0.02);
      th.tube([p0, p1, p2, p3], [0.012, 0.01, 0.008, 0.007], C.twig, C.hip, 0, 0.25, 3);
      const facing = new V3(rr.range(-0.35, 0.35), -0.85, out * 0.5),
        turn = new V3(1, 0, rr.range(-0.5, 0.5));
      for (const g of roseHead(rr)) roses.push(aim(g, p3, facing, turn, 1.9));
    }

    const b = new Builder();
    b.add(core, canes, tangle.build(MAT.WOOD, 0.95), th.build(MAT.WOOD, 0.7), roses);
    b.boxCollider(0, 1.8, 0, 3.5, 1.8, 1.0);
    return b.build();
  },
  KIND
);

/** A withered rose, built on +Y (the way it faces), its calyx at the origin. About 0.13 m across. */
function roseHead(R) {
  const parts = [];
  const petal = (len, wid, curl, fold) => {
    const k = R.range(0, 1);
    const g = leaf(len, wid, { segs: 2, belly: 0.55, point: 0.8, curl, fold });
    return paint(g, { color: (v) => _c.copy(C.rose).lerp(C.roseDark, clamp01(Math.pow(v.y / len, 1.5) * 0.9 + k * 0.25)), rough: 0.9, mat: MAT.PLANT, sway: 0.25 });
  };
  parts.push(...ring(() => petal(R.range(0.066, 0.08), R.range(0.06, 0.075), R.range(0.7, 1.2), 0.5), 5, { tilt: 0.78, radius: 0.008, jitter: 0.2, rng: R }));
  parts.push(...ring(() => petal(R.range(0.05, 0.062), R.range(0.045, 0.055), R.range(1.1, 1.6), 0.6), 4, { tilt: 0.34, radius: 0.004, yaw0: 0.6, jitter: 0.2, rng: R }));
  const sep = paint(blade(0.05, 0.016, 2, 0.5), { color: C.hip, rough: 0.9, mat: MAT.PLANT, sway: 0.25 });
  parts.push(...ring(sep, 5, { tilt: 2.1, radius: 0.01, yaw0: 0.3 }));
  const hip = sphere(0.017, 6, 4);
  hip.scale(1, 1.25, 1);
  hip.translate(0, -0.014, 0);
  parts.push(paint(hip, { color: C.hip, rough: 0.8, mat: MAT.PLANT, sway: 0.25 }));
  return parts;
}

// ---------------------------------------------------------------------------------------------
// seed_mound: a mound of turned earth, 0.9 m across, with the briar's pod half out of it. The
// husk is ribbed and thorned and has split a finger wide; what is inside is not dead.
// ---------------------------------------------------------------------------------------------
register(
  'seed_mound',
  (seed) => {
    const R = new Rng(seed * 7919 + 4301);
    const nz = new Noise(seed * 13 + 4301);
    const b = new Builder();
    const RM = 0.46;
    /** Height of the earth at (x, z). */
    const mh = (x, z) => {
      const q = Math.hypot(x, z * 1.06) / RM;
      if (q >= 1) return -0.05;
      return 0.2 * Math.pow(1 - q * q, 1.2) * (1 + 0.28 * nz.fbm3(x * 5, 0.2, z * 5, 2)) - 0.05 * Math.pow(q, 3);
    };

    // ---- the mound
    {
      const rings = 6,
        segs = 14;
      const pos = [],
        idx = [];
      pos.push(0, mh(0, 0), 0);
      for (let i = 1; i <= rings; i++)
        for (let j = 0; j < segs; j++) {
          const a = (j / segs) * TAU + i * 0.21;
          const r = (i / rings) * RM * (i === rings ? 1.04 : 1 + 0.07 * nz.n2(j * 1.9, i * 2.7));
          const x = Math.cos(a) * r,
            z = Math.sin(a) * r;
          pos.push(x, i === rings ? -0.06 : mh(x, z), z);
        }
      for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
      for (let i = 1; i < rings; i++)
        for (let j = 0; j < segs; j++) {
          const a = 1 + (i - 1) * segs + j,
            a1 = 1 + (i - 1) * segs + ((j + 1) % segs),
            c0 = a + segs,
            c1 = a1 + segs;
          idx.push(a, a1, c0, a1, c1, c0);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      paint(g, { color: (v) => _c.copy(C.earth).lerp(C.earthLit, clamp01(0.45 + 0.6 * nz.n3(v.x * 9, v.y * 9, v.z * 9))).lerp(C.soil, clamp01(1 - (v.y + 0.02) / 0.1) * 0.6), rough: 1, mat: MAT.STONE });
      b.add(g);
    }
    // clods thrown up when the earth was turned
    for (let i = 0; i < 8; i++) {
      const a = R.range(0, TAU),
        r = R.range(0.14, 0.43);
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (Math.hypot(x, z - 0.02) < 0.13) continue;
      const s = R.range(0.025, 0.055);
      const g = rock(s, { seed: seed * 31 + i, detail: 0, rough: 0.3, squash: [1, 0.7, 1], facet: true });
      g.rotateY(R.range(0, TAU));
      g.translate(x, mh(x, z) + s * 0.3, z);
      b.add(paint(g, { color: _c.copy(C.earthLit).lerp(C.crumb, R.range(0, 0.7)).clone(), rough: 1, mat: MAT.STONE }));
    }

    // ---- the pod, built along +Y with the split toward +Z, then laid back into the earth
    const L = 0.25,
      W = 0.088;
    const prof = (v) => W * Math.pow(Math.sin(Math.PI * Math.pow(clamp01(v), 0.72)), 0.8) * (v > 0.82 ? 1 - 0.35 * (v - 0.82) / 0.18 : 1) + 0.004;
    const gap = (v) => 0.02 + 0.12 * Math.pow(Math.sin(Math.PI * clamp01((v - 0.12) / 0.88)), 0.6);
    const rib = (a) => 1 + 0.13 * Math.pow(Math.sin(a * 5), 2);
    const husk = [];
    {
      const nv = 11,
        na = 16;
      const pos = [],
        idx = [],
        ribK = [];
      for (let i = 0; i <= nv; i++) {
        const v = i / nv;
        const r = prof(v),
          g0 = gap(v);
        for (let j = 0; j <= na; j++) {
          // angle from the split, all the way round to the split again
          const a = lerp(g0, TAU - g0, j / na);
          // the lips of the split curl outward
          const lip = 1 + 0.12 * Math.exp(-Math.min(a - g0, TAU - g0 - a) / 0.22);
          const rr = r * rib(a) * lip;
          pos.push(Math.sin(a) * rr, v * L, Math.cos(a) * rr);
          ribK.push(Math.pow(Math.sin(a * 5), 2));
        }
      }
      for (let i = 0; i < nv; i++)
        for (let j = 0; j < na; j++) {
          const a = i * (na + 1) + j,
            c0 = a + na + 1;
          idx.push(a, a + 1, c0, a + 1, c0 + 1, c0);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      paint(g, { color: (v) => _c.copy(C.husk).lerp(C.huskRib, ribK[v.i] * 0.8).lerp(C.soil, clamp01(1 - v.y / (L * 0.45)) * 0.55), rough: 0.85, mat: MAT.WOOD });
      husk.push(g);
      // what is inside
      const heart = sphere(1, 8, 6);
      heart.scale(W * 0.72, L * 0.4, W * 0.72);
      heart.translate(0, L * 0.47, 0);
      husk.push(paint(heart, { color: C.sickDeep, emissive: (v) => 0.3 + 0.65 * clamp01(v.nz), rough: 0.5, mat: MAT.GLOW }));
      // thorns down the ribs
      const sp = new Soup();
      for (let k = 0; k < 10; k++) {
        const a = Math.PI / 10 + (k * Math.PI) / 5;
        for (const v of [0.26, 0.46, 0.66, 0.84]) {
          if (Math.min(a, TAU - a) < gap(v) + 0.12 || R.chance(0.15)) continue;
          const r = prof(v) * rib(a);
          const len = R.range(0.022, 0.04) * (1 - 0.3 * v);
          _a.set(Math.sin(a) * r * 0.9, v * L, Math.cos(a) * r * 0.9);
          _b.set(Math.sin(a) * (r + len), v * L + len * 0.7, Math.cos(a) * (r + len));
          sp.spike(_a, _b, 0.007, C.huskRib, C.thornTip);
        }
      }
      husk.push(sp.build(MAT.WOOD, 0.7));
    }
    const tilt = -0.95,
      yaw = 0.4;
    const base = new V3(0.02, 0.105, 0.085);
    const rotP = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(tilt));
    rotP.setPosition(base);
    for (const g of husk) g.applyMatrix4(rotP);
    b.add(husk);
    const mid = new V3(0, L * 0.5, 0).applyMatrix4(rotP);
    const mouth = new V3(0, L * 0.55, W * 0.9).applyMatrix4(rotP);

    // ---- pale root threads feeling their way down the mound
    const rt = new Soup();
    for (let i = 0; i < 4; i++) {
      const a0 = R.range(0.5, 2.6) + (i % 2 ? Math.PI * 0.2 : 0),
        wob = R.range(-0.6, 0.6);
      const pts = [];
      const far = R.range(0.2, 0.36),
        ph = R.range(0, TAU);
      for (let k = 0; k <= 7; k++) {
        const u = k / 7;
        const a = a0 + wob * u * u + 0.22 * Math.sin(u * 9 + ph) * u;
        const r = 0.04 + u * far;
        const x = base.x + Math.cos(a) * r,
          z = base.z + Math.sin(a) * r;
        // they ride the surface and go under at the end
        pts.push(new V3(x, Math.max(mh(x, z), -0.04) + 0.004 - (k === 0 ? 0.03 : 0) - (k === 7 ? 0.02 : 0), z));
      }
      rt.tube(pts, [0.006, 0.0058, 0.0054, 0.005, 0.0044, 0.0038, 0.003, 0], C.root, C.root.clone().lerp(C.earth, 0.75), 0, 0, 3);
    }
    b.add(rt.build(MAT.PLANT, 0.8));

    b.anchor('seed', +mid.x.toFixed(3), +mid.y.toFixed(3), +mid.z.toFixed(3));
    b.emitter('glow', +mouth.x.toFixed(3), +mouth.y.toFixed(3), +mouth.z.toFixed(3), { color: '#7fd060', size: 0.14 });
    b.light(+mouth.x.toFixed(3), +(mouth.y + 0.04).toFixed(3), +mouth.z.toFixed(3), '#7fd060', 0.45, 2.2);
    return b.build();
  },
  KIND
);

// ---------------------------------------------------------------------------------------------
// briar_vine: what the seed becomes. Three trunks, thigh-thick at the foot, wound round each other
// like rope up the face of the Elder Hollow; a shoot to either side every half metre, which is as
// good as a ladder; thorns, a few dark leaves, and near the top, pale flowers.
// opts.height (default 9). The back (-Z) leans on the trunk of the Hollow. No collider.
// ---------------------------------------------------------------------------------------------
register(
  'briar_vine',
  (seed, opts = {}) => {
    const H = clamp(Number(opts.height) || 9, 3, 30);
    const R = new Rng(seed * 7919 + 4401);
    const nz = new Noise(seed * 13 + 4401);
    const skel = newSkel(seed * 104729 + 4401);
    const PH = [0.3, 2.45, 4.5],
      TOPS = [H + 0.2, H + 0.02, H * 0.87],
      R0 = [0.095, 0.078, 0.06],
      R1 = [0.042, 0.034, 0.027];
    /** Centre of trunk k at height y. */
    const trunkAt = (k, y, out = new V3()) => {
      const u = clamp01(y / H);
      const th = PH[k] + 1.2 * y + 0.45 * Math.sin(y * 0.9 + k * 2.1);
      const shrink = (1 - 0.45 * smooth01(0.8, 1, u)) * (y < 0 ? 1 - y * 0.8 : 1);
      const rx = (0.2 + 0.05 * Math.sin(y * 1.7 + k * 2)) * shrink,
        rz = 0.115 * shrink;
      // the tips hook over the lip of the ledge
      const hook = 0.2 * Math.pow(smooth01(H - 0.5, H + 0.2, y), 1.5) * (k === 2 ? 0 : 1);
      return out.set(rx * Math.cos(th) + 0.05 * nz.n2(y * 0.6, k * 9.1), y, 0.035 + rz * Math.sin(th) + 0.03 * nz.n2(y * 0.7 + 40, k * 5.3) - hook);
    };
    const trunks = [];
    for (let k = 0; k < 3; k++) {
      const pts = [],
        rad = [];
      const top = TOPS[k];
      const n = Math.ceil((top + 0.4) / 0.2);
      for (let i = 0; i <= n; i++) {
        const y = lerp(-0.4, top, i / n);
        pts.push(trunkAt(k, y));
        rad.push(lerp(R0[k], R1[k], Math.pow(clamp01(y / H), 0.8)) * (1 - 0.9 * smooth01(top - 0.55, top, y)));
      }
      trunks.push(addLimb(skel, pts, rad, { rnd: R.next(), tag: 'trunk' }));
    }
    // roots: out to the front and the sides, and under
    for (let i = 0; i < 5; i++) {
      const az = lerp(-0.2, Math.PI + 0.2, (i + R.range(0.2, 0.8)) / 5);
      const dx = Math.cos(az),
        dz = Math.sin(az);
      const reach = R.range(0.42, 0.58),
        wob = R.range(-0.5, 0.5),
        r0 = R.range(0.036, 0.05);
      const pts = [],
        rad = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        const d = 0.1 + u * reach,
          side = Math.sin(u * 3) * wob * 0.12;
        pts.push(new V3(clamp(dx * d - dz * side, -0.64, 0.64), 0.16 * Math.pow(1 - u, 1.6) + 0.02 * (1 - u) - Math.pow(Math.max(0, u - 0.55) / 0.45, 2) * 0.32, clamp(0.035 + dz * d * 0.75 + dx * side, -0.3, 0.42)));
        rad.push(r0 * lerp(1, 0.25, u));
      }
      addLimb(skel, pts, rad, { depth: 1, parent: trunks[0], rnd: R.next(), tag: 'root' });
    }
    // the rungs: a shoot to the left and one to the right, each turning up at its end
    const p0 = new V3();
    const outer = (y, sx, sz) => {
      let best = -1,
        bv = -1e9;
      for (let k = 0; k < 3; k++) {
        if (y > TOPS[k] - 0.45) continue;
        trunkAt(k, y, p0);
        const v = p0.x * sx + p0.z * sz;
        if (v > bv) {
          bv = v;
          best = k;
        }
      }
      return best;
    };
    let ry = 0.5 + R.range(0, 0.08),
      row = 0;
    while (ry < H - 0.3) {
      for (const sx of [-1, 1]) {
        const y = ry + (sx > 0 ? R.range(-0.06, 0.06) : 0);
        const k = outer(y, sx, 0);
        if (k < 0) continue;
        trunkAt(k, y, p0);
        const reach = R.range(0.5, 0.66),
          rise = R.range(-0.02, 0.1),
          sag = R.range(0, 0.05),
          zf = R.range(-0.04, 0.12);
        const X = (f) => lerp(p0.x, sx * reach, f);
        const pts = [
          p0.clone(),
          new V3(X(0.3), y + rise * 0.15 + 0.02, p0.z + zf * 0.4),
          new V3(X(0.62), y + rise * 0.5 - sag, p0.z + zf),
          new V3(X(0.88), y + rise * 0.85 - sag * 0.5 + 0.01, p0.z + zf * 0.9),
          new V3(sx * reach, y + rise + 0.06, p0.z + zf * 0.75),
          new V3(sx * (reach + 0.015), y + rise + 0.16, p0.z + zf * 0.55),
          new V3(sx * (reach - 0.03 - R.range(0, 0.05)), y + rise + 0.26 + R.range(0, 0.08), p0.z + zf * 0.3),
        ];
        const r = R.range(0.026, 0.035);
        addLimb(skel, pts, [r, r * 0.93, r * 0.8, r * 0.68, r * 0.52, r * 0.34, 0.004], { depth: 1, parent: trunks[k], sAttach: y + 0.4, rnd: R.next(), tag: 'rung', sw1: 0.22 });
      }
      // every few rungs a spur stands out of the front and up
      if (row % 3 === 1 && ry < H - 0.9) {
        const y = ry + 0.22;
        const k = outer(y, 0, 1);
        if (k >= 0) {
          trunkAt(k, y, p0);
          const x1 = p0.x + R.range(-0.14, 0.14);
          const pts = [p0.clone(), new V3(lerp(p0.x, x1, 0.5), y + 0.1, 0.22), new V3(x1, y + 0.28, R.range(0.3, 0.34)), new V3(x1 + R.range(-0.05, 0.05), y + 0.46, 0.3)];
          addLimb(skel, pts, [0.022, 0.018, 0.012, 0.004], { depth: 1, parent: trunks[k], sAttach: y + 0.4, rnd: R.next(), tag: 'spur', sw1: 0.35 });
        }
      }
      ry += R.range(0.45, 0.6);
      row++;
    }

    const wood = meshLimbs(skel, {
      pick: (l) => (l.depth === 0 ? { radial: 6, step: 1 } : l.tag === 'root' ? { radial: 4, step: 1 } : { radial: 4, step: 1 }),
      sway: SWAY,
      mat: MAT.WOOD,
      rough: 0.88,
      flare: 0.45,
      flareH: 0.3,
      burl: 0.14,
      lobes: 0.12,
      colour: (v, c) => {
        if (v.depth === 0 || v.limb.tag === 'root') {
          c.copy(C.vine).lerp(C.vineMid, 0.5 + 0.5 * nz.n3(v.x * 4, v.y * 2.2, v.z * 4));
          c.lerp(C.vineLit, clamp01(0.08 + v.ny * 0.5 + v.nz * 0.25) * 0.55);
          // the back lies in the shadow of the Hollow
          c.multiplyScalar(0.62 + 0.38 * clamp01(0.55 + v.nz * 0.6));
        } else {
          c.copy(C.vineMid).lerp(C.shoot, clamp01(v.t * 2.2)).lerp(C.shootTip, clamp01((v.t - 0.55) / 0.45) * 0.8);
          c.lerp(C.vineLit, clamp01(v.ny) * 0.35);
        }
        if (v.y < 0.2) c.lerp(C.soil, clamp01((0.2 - v.y) / 0.4));
      },
    });

    // ---- thorns
    const th = new Soup();
    const bias = new V3();
    for (const o of stations(skel, (l) => l.depth === 0, 0.14, R, { from: 0.06, to: 0.985 })) {
      if (o.pos.y < 0.12) continue;
      bias.set(o.pos.x, 0.2, o.pos.z - 0.035 + 0.12).normalize();
      thorn(th, o, R, R.range(0.06, 0.11) * (0.7 + (0.3 * o.rad) / 0.09), bias, 1.3, 0, C.thorn, C.thornTip);
    }
    // under the rungs, never on top where a hand or a foot goes
    bias.set(0, -1, 0.2);
    for (const o of stations(skel, (l) => l.tag === 'rung' || l.tag === 'spur', 0.17, R, { from: 0.25, to: 0.85 })) thornFlat(th, o, R, R.range(0.03, 0.05), bias, 1.6, SWAY.own(o.limb, o.s));

    // ---- leaves: three leaflets on a stalk, dark, the colour of a bottle
    const green = [];
    const stalks = new Soup();
    const up = new V3(0, 1, 0);
    const dir = new V3(),
      side = new V3(),
      at = new V3(),
      d2 = new V3(),
      face = new V3();
    const leaflet = (len, wid, sway) => {
      const k = R.range(0, 1),
        hw = wid * 0.5;
      const g = leaf(len, wid, { segs: 2, belly: 0.42, point: 1.5, curl: R.range(0.15, 0.7), fold: R.range(0.2, 0.42) });
      return paint(g, { color: (v) => _c.copy(C.leaf).lerp(C.leafLit, clamp01((v.y / len) * 0.55 + k * 0.35)).lerp(C.leafVein, clamp01(1 - Math.abs(v.x) / (hw * 0.3)) * 0.65), rough: 0.68, mat: MAT.PLANT, sway });
    };
    const spray = (pos, d, size, sway) => {
      dir.copy(d).normalize();
      face.set(R.range(-0.3, 0.3), 1, 0.35 + R.range(-0.2, 0.3));
      side.crossVectors(dir, face).normalize();
      at.copy(pos).addScaledVector(dir, size * 0.55);
      stalks.tube([pos.clone(), at.clone()], [0.006, 0.004], C.shoot, C.shootTip, sway * 0.6, sway, 3);
      green.push(aim(leaflet(size, size * 0.55, sway + 0.15), at, dir, face));
      for (const sg of [-1, 1]) {
        d2.copy(dir)
          .multiplyScalar(0.55)
          .addScaledVector(side, sg * 0.82)
          .addScaledVector(up, R.range(-0.15, 0.1));
        _q.copy(pos).addScaledVector(dir, size * 0.42);
        green.push(aim(leaflet(size * 0.8, size * 0.46, sway + 0.1), _q.clone(), d2, face));
      }
    };
    const leafAt = stations(skel, (l) => l.tag === 'rung' || l.tag === 'spur', 0.3, R, { from: 0.45, to: 0.98 });
    leafAt.forEach((o, i) => {
      if (i % 2 === 0 && o.limb.tag === 'rung') return;
      const sx = o.pos.x >= 0 ? 1 : -1;
      d2.set(sx * R.range(0.2, 0.9), R.range(0.25, 0.8), R.range(0.25, 0.9));
      spray(o.pos, d2, R.range(0.13, 0.19), SWAY.own(o.limb, o.s) + 0.3);
    });
    // a few straight off the trunks
    for (const o of stations(skel, (l) => l.depth === 0, 0.95, R, { from: 0.1, to: 0.97 })) {
      d2.set(o.pos.x * 3 + R.range(-0.4, 0.4), R.range(0.3, 0.8), R.range(0.5, 1));
      at.copy(o.pos).addScaledVector(d2.normalize(), o.rad * 0.8);
      spray(at.clone(), d2, R.range(0.12, 0.17), 0.3);
    }

    // ---- pale flowers where it comes into the light
    const blooms = [];
    const tips = skel.limbs.filter((l) => (l.tag === 'rung' || l.tag === 'spur') && l.pts[0].y > H * 0.64);
    const nBloom = Math.min(tips.length, 7);
    for (let i = 0; i < nBloom; i++) {
      const l = tips[Math.floor(((i + 0.5) / nBloom) * tips.length)];
      const tip = l.pts[l.pts.length - 1];
      const sx = tip.x >= 0 ? 1 : -1;
      at.copy(tip);
      d2.set(sx * R.range(0.1, 0.5), R.range(0.35, 0.8), R.range(0.6, 1)).normalize();
      _q.copy(at).addScaledVector(d2, 0.07);
      stalks.tube([at.clone(), _q.clone()], [0.005, 0.004], C.shootTip, C.shootTip, 0.3, 0.45, 3);
      const parts = [];
      parts.push(
        ...ring(
          () => {
            const len = R.range(0.058, 0.07);
            return paint(leaf(len, len * 0.92, { segs: 2, belly: 0.62, point: 0.6, curl: -0.4, fold: 0.16 }), { color: (v) => _c.copy(C.petalBase).lerp(C.petal, clamp01(v.y / (len * 0.45))), emissive: 0.05, rough: 0.6, mat: MAT.PLANT, sway: 0.5 });
          },
          5,
          { tilt: 1.12, radius: 0.007, jitter: 0.12, rng: R }
        )
      );
      const boss = dome(0.013, 6, 3);
      parts.push(paint(boss, { color: C.boss, emissive: 0.3, rough: 0.6, mat: MAT.PLANT, sway: 0.5 }));
      const sep = paint(blade(0.035, 0.014, 2, 0.3), { color: C.shootTip, rough: 0.8, mat: MAT.PLANT, sway: 0.5 });
      parts.push(...ring(sep, 5, { tilt: 1.75, radius: 0.006, yaw0: 0.63 }));
      for (const g of parts) blooms.push(aim(g, _q, d2, up, 1.15));
    }

    const b = new Builder();
    b.add(wood, th.build(MAT.WOOD, 0.7), stalks.build(MAT.PLANT, 0.8), green, blooms);
    b.anchor('top', 0, H, 0);
    return b.build();
  },
  KIND
);
