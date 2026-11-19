// Spring-driven fold system (owner: fold agent). Contract: docs/ARCHITECTURE.md (world/fold.js, sec. 1.2).
//
// Each flap has a shown progress p (0 = folded flat on the page, 1 = upright rest pose; p overshoots past 1):
//     flap.quaternion = restQuaternion * RotX(foldAngle * (1 - p)) [* RotY(small flutter twist)]
//
// One degree of freedom per flap, three regimes, integrated with a FIXED sub-step (semi-implicit Euler):
//   RISE    p'' = k (1 - p) - c p'            lightly damped hinge spring: the flap accelerates up and arrives
//                                             at upright with speed (snappy, not floaty).
//   LOCKED  p'' = -w^2 (p - 1) - (2 z w + drag |p'|) p'   (air drag: big swings die fast, the small quiver lingers)
//                                             latched the moment the flap reaches upright: the strut is taut,
//                                             the structure is stiff, and the card whips past by 8-15 % and
//                                             quivers at 4-7 Hz for 2-3 visible cycles (the "paper wobble").
//                                             Force is continuous at the latch (no velocity jump).
//   NESTED  p'' = k_n (p_parent - p) + c_n (p_parent' - p')   a flap hanging off another flap follows it (linkage)
//   FALL    p'' = -k_d p - c_d p' - G         softer, with a constant closing pull so the flap lands with a
//                                             little speed; at the page (p = 0) it collides with a small
//                                             restitution -> one tiny slap-bounce (< 3 %), then it sticks.
// k, c, G scale with the per-flap frequency scale (large flaps slower, small ones snappier; userData.stiffness),
// the flutter frequency scales more weakly, userData.wobble lowers the flutter damping.
// A small twist about the flap's own axis follows the flutter so the card does not look like a rigid board.
//
// update(dt) consumes dt through an accumulator in steps of exactly CONFIG.spring.maxStep and renders the
// interpolated state, so the motion is the same at any frame rate, stable for any dt, and deterministic.
// No allocation in update (one small payload object per 'fold' event, i.e. once per flap per fold).
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { bus } from '../core/events.js';
import { panFor } from '../core/state.js';

const _q = new THREE.Quaternion();
const _box = new THREE.Box3();

// ---- wind (biome pass, motion) ---------------------------------------------------------------------
// A risen, settled flap rocks a little about its own hinge. The angle is a pure function of (time, place):
//   gust g(x, z, t) in 0..1 = two slow sine fronts travelling across the page (one with a fixed spatial warp,
//   so the fronts are not ruler-straight); neighbouring trees meet the same front one after the other.
//   sway = amp * strength * ( lean * (g - 0.3) * (wind . card normal) + (0.35 + 0.65 g) * flutter(t, place) )
// Nothing is integrated, so it is identical at any frame rate. No 'fold' events, `settled` is untouched.
// The windmill sails' angle is the closed-form time integral of speed * (1 + spinGust * (2 g - 1)).
const WIND = CONFIG.spring.wind || { enabled: false };
const DEG = Math.PI / 180;
const W_DIR = (WIND.directionDeg ?? 30) * DEG;
const D1X = Math.cos(W_DIR); const D1Z = Math.sin(W_DIR);
const D2X = Math.cos(W_DIR + 0.9); const D2Z = Math.sin(W_DIR + 0.9);
const K1 = (2 * Math.PI) / (WIND.gustLength ?? 14); const W1 = (2 * Math.PI) / (WIND.gustPeriod ?? 9);
const K2 = (2 * Math.PI) / (WIND.gust2Length ?? 8); const W2 = (2 * Math.PI) / (WIND.gust2Period ?? 5.3);
const G1 = 0.32; const G2 = 0.18; // gust = 0.5 + G1 sin(a) + G2 sin(b)
const WARP = WIND.gustWarp ?? 1.7;
const KF = (2 * Math.PI) / (WIND.flutterLength ?? 5);
const rx = (src) => (src ? new RegExp(src, 'i') : null);
const RX_LOOSE = rx(WIND.loose); const RX_RIGID = rx(WIND.rigid); const RX_STIFF = rx(WIND.stiff);

/** Gust strength 0..1 at a world position and simulation time (pure; the same field that drives the sway). */
export function gustAt(x, z, t) {
  const a = (x * D1X + z * D1Z) * K1 - t * W1 + WARP * Math.sin((z * D1X - x * D1Z) * K1 * 0.6);
  const b = (x * D2X + z * D2Z) * K2 - t * W2;
  return 0.5 + G1 * Math.sin(a) + G2 * Math.sin(b);
}

function hash01(i, salt) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

/** userData is JSON-copied by Object3D.clone, so a cached rest quaternion may come back as an array / plain object. */
function restOf(node) {
  const ud = node.userData;
  const r = ud.restQuaternion;
  if (r && r.isQuaternion) return r;
  const q = new THREE.Quaternion();
  if (Array.isArray(r) && r.length === 4) q.fromArray(r);
  else if (r && typeof r === 'object' && r._x !== undefined) q.set(r._x, r._y, r._z, r._w);
  else if (r && typeof r === 'object' && r.x !== undefined) q.set(r.x, r.y, r.z, r.w);
  else q.copy(node.quaternion);
  ud.restQuaternion = q;
  return q;
}

/**
 * @param {THREE.Group} tileGroup a CLONE of a tile prototype (flaps in their upright rest pose, or
 *        previously processed by createFoldInstance - the rest pose is cached in userData.restQuaternion)
 * @param {{tileId?:string}} info
 */
export function createFoldInstance(tileGroup, info = {}) {
  const S = CONFIG.spring;
  const h = S.maxStep;
  const salt = strHash(String(info.tileId ?? tileGroup.userData.tileId ?? ''));
  const flaps = [];
  const byNode = new Map();

  tileGroup.traverse((node) => {
    const ud = node.userData;
    if (!ud || !ud.hinge) return;
    const rest = restOf(node);
    let size = ud.size;
    if (size === undefined) {
      const keep = _q.copy(node.quaternion);
      node.quaternion.copy(rest);
      _box.setFromObject(node);
      node.quaternion.copy(keep);
      size = Math.min(1, Math.max(0.05, (_box.max.y - _box.min.y) / TILE_SIZE));
      if (!Number.isFinite(size)) size = 0.3;
      ud.size = size;
    }
    // nearest flap ancestor (V-fold struts / tabs hang off their parent flap)
    let parent = null;
    for (let a = node.parent; a; a = a.parent) {
      if (byNode.has(a)) { parent = byNode.get(a); break; }
      if (a === tileGroup) break;
    }
    const i = flaps.length;
    const sizeT = Math.min(1, Math.max(0, (size - S.sizeSmall) / (S.sizeLarge - S.sizeSmall)));
    const stiff = Math.max(0.25, ud.stiffness ?? 1);
    const fs = (S.freqSmall + (S.freqLarge - S.freqSmall) * sizeT) * Math.sqrt(stiff)
      * (1 + (hash01(i, salt) * 2 - 1) * S.jitter);
    // large cards (trees, houses, the windmill) whip further past upright and quiver longer than small tufts
    const wob = Math.min(2.5, Math.max(0.2, (ud.wobble ?? 1) * (S.wobble / 0.06) * (1 + (S.wobbleLarge - 1) * sizeT)));
    const tw = hash01(i, salt + 13);
    const wL = 2 * Math.PI * S.flutterHz * Math.pow(fs, S.flutterSizePower) * (1 + (hash01(i, salt + 7) * 2 - 1) * S.jitter);
    const delay = Math.min(1, Math.max(0, ud.delay ?? 0));
    const f = {
      node,
      rest,
      foldAngle: ud.foldAngle ?? Math.PI / 2,
      delay,
      layer: ud.layer ?? 0,
      stiffness: stiff,
      wobble: ud.wobble ?? 1,
      size,
      parent,
      freqScale: fs,
      // dynamics constants
      kUp: S.stiffness * fs * fs,
      cUp: S.damping * fs * (1 + (S.dampingLarge - 1) * sizeT),
      kDn: S.downStiffness * fs * fs,
      cDn: S.downDamping * fs,
      gDn: S.downPull * fs * fs,
      wLsq: wL * wL,
      cL: 2 * (S.flutterDamping / Math.sqrt(wob)) * wL,
      dragL: S.flutterDrag / Math.sqrt(wob),
      fricL: S.flutterFriction * fs * (1 + (S.flutterFrictionLarge - 1) * sizeT), // not scaled by wobble: the tail always ends after 2-3 cycles
      // never near zero: every card visibly twists, alternating sign from flap to flap
      twist: S.twist * (tw < 0.5 ? -1 : 1) * (0.55 + 0.45 * Math.abs(tw * 2 - 1)) * (0.6 + 0.4 * sizeT),
      // nested flap: tracks its parent's progress (one linked mechanism), see stepFlap
      kN: S.nestedStiffness,
      aN: S.nestedMaxAccel + 0.5 - 0.5,
      cN: 2 * S.nestedDamping * Math.sqrt(S.nestedStiffness),
      // stagger times (s after setTarget + tile delay)
      tUp: 0,
      tDown: 0,
      // state
      p: 0, // shown progress (interpolated between fixed steps)
      v: 0, // velocity (1/s)
      m: 0, // progress at the current fixed step
      mPrev: 0, // ... and at the previous one
      locked: false, // LOCKED regime (reached upright since it last started rising)
      // wind (top-level flaps only; children ride along through the hierarchy)
      sw: 0, // current sway angle about the hinge (rad), added to the fold angle in pose()
      swAmp: 0, // amplitude (rad) at wind strength 1; 0 = this flap does not sway
      swHz: 0, // flutter angular frequency (rad/s)
      swPh: 0, // flutter phase
      swTwist: 0, // twist about the card's long axis per rad of sway
      lx: 0, lz: 0, // hinge position in the tile frame
      nx: 0, nz: 1, // card normal in the tile frame
      spin: null, // Object3D turning about the card normal (windmill sails), or null
      spinPh: 0,
      tgt: 0, // target this flap is currently heading for
      started: true, // false while waiting for its stagger slot after a target change
      atRest: true, // at rest at tgt
    };
    byNode.set(node, f);
    flaps.push(f);
  });

  let span = 0;
  for (const f of flaps) {
    f.tUp = f.delay * S.staggerSpan;
    if (f.parent && f.tUp < f.parent.tUp + S.nestedLag) f.tUp = f.parent.tUp + S.nestedLag;
    if (f.tUp > span) span = f.tUp;
  }
  for (const f of flaps) f.tDown = span - f.tUp; // exact reverse: last up = first down, children before parents

  // wind: which top-level flaps sway (amplitude from height / slenderness / name class) or carry a spinner
  const sway = [];
  if (WIND.enabled) {
    const minA = (WIND.minDeg ?? 0.5) * DEG; const maxA = (WIND.maxDeg ?? 1.9) * DEG;
    for (let i = 0; i < flaps.length; i++) {
      const f = flaps[i];
      if (f.parent !== null) continue;
      const node = f.node;
      for (let c = 0; c < node.children.length; c++) if (node.children[c].userData && node.children[c].userData.spin) f.spin = node.children[c];
      const keep = _q.copy(node.quaternion);
      node.quaternion.copy(f.rest);
      _box.setFromObject(node);
      node.quaternion.copy(keep);
      const H = _box.max.y - _box.min.y;
      const Wd = Math.max(_box.max.x - _box.min.x, _box.max.z - _box.min.z, 1e-3);
      const tall = Math.min(1, Math.max(0, (H - WIND.tallLo) / (WIND.tallHi - WIND.tallLo)));
      const thin = Math.min(1, Math.max(0, (H / Wd - WIND.thinLo) / (WIND.thinHi - WIND.thinLo)));
      const nm = String(node.name || '').replace(/^.*__/, '');
      const cls = RX_LOOSE && RX_LOOSE.test(nm) ? WIND.looseMul : RX_RIGID && RX_RIGID.test(nm) ? WIND.rigidMul : RX_STIFF && RX_STIFF.test(nm) ? WIND.stiffMul : 1;
      let amp = Number.isFinite(H) ? (minA + (maxA - minA) * (tall * 0.55 + thin * 0.45)) * cls * (node.userData.sway ?? 1) : 0;
      if (amp < (WIND.cutoffDeg ?? 0.08) * DEG) amp = 0;
      f.swAmp = amp;
      f.swHz = 2 * Math.PI * (WIND.hzSmall + (WIND.hzLarge - WIND.hzSmall) * tall) * (0.85 + 0.3 * hash01(i, salt + 31));
      f.swPh = hash01(i, salt + 37) * Math.PI * 2;
      f.swTwist = (hash01(i, salt + 41) < 0.5 ? -1 : 1) * (WIND.twist ?? 0.5) * (0.6 + 0.4 * hash01(i, salt + 43));
      f.lx = node.position.x; f.lz = node.position.z;
      const r = f.rest;
      f.nx = 2 * (r._x * r._z + r._w * r._y); f.nz = 1 - 2 * (r._x * r._x + r._y * r._y);
      f.spinPh = hash01(i, salt + 47) * Math.PI * 2;
      if (amp > 0 || f.spin !== null) sway.push(f);
    }
  }
  const nSway = sway.length;
  const swFade = Math.max(1e-3, WIND.fadeIn ?? 1.2);
  const swMax = (WIND.limitDeg ?? 2.5) * DEG;
  let swOn = false; // the wind currently owns the sway angle (tile risen and settled)

  let target = 0;
  let steps = 0; // fixed steps since the last setTarget change
  // doubles that change every frame live in a typed array (closure variables would box a new HeapNumber per write)
  const st = new Float64Array(4); // [0] unconsumed time (< h), [1] average shown progress, [2] sway level 0..1, [3] sway fade start time
  let extraDelay = 0;
  let settled = true;
  const n = flaps.length;
  const eps = S.settleEps;
  const veps = S.settleEps * 12;
  const tStart = new Float64Array(2 * n); // [i] rise start, [n + i] fold-down start (typed: no boxed doubles in update)
  for (let i = 0; i < n; i++) { tStart[i] = flaps[i].tUp - 1e-9; tStart[n + i] = flaps[i].tDown - 1e-9; }

  /**
   * quaternion = rest * RotX(foldAngle * (1 - p)) * RotY(twist), written straight into the quaternion's fields:
   * Quaternion.copy/multiply fire three's change callback (Euler sync), which allocates and costs more than the
   * spring itself. `sync` (used whenever a flap comes to rest) goes through set() so node.rotation is correct at rest.
   */
  function pose(f, p, sync) {
    const r = f.rest;
    const half = (f.foldAngle * (1 - p) + f.sw) * 0.5;
    const s = Math.sin(half);
    const c = Math.cos(half);
    let x = r._x * c + r._w * s;
    let y = r._y * c + r._z * s;
    let z = r._z * c - r._y * s;
    let w = r._w * c - r._x * s;
    const tw = (f.locked && p !== 1 ? f.twist * (p - 1) : 0) + f.sw * f.swTwist; // flutter twist (zero at rest, zero while folded) + wind twist
    if (tw !== 0) {
      const ht = tw * 0.5;
      const s2 = Math.sin(ht);
      const c2 = Math.cos(ht);
      const x2 = x * c2 - z * s2;
      const y2 = y * c2 + w * s2;
      const z2 = z * c2 + x * s2;
      w = w * c2 - y * s2;
      x = x2; y = y2; z = z2;
    }
    const q = f.node.quaternion;
    if (sync) q.set(x, y, z, w);
    else { q._x = x; q._y = y; q._z = z; q._w = w; }
  }

  function snap(p) {
    for (let i = 0; i < n; i++) {
      const f = flaps[i];
      f.p = f.m = f.mPrev = p;
      f.v = 0;
      f.locked = p >= 1;
      f.started = true;
      f.atRest = true;
      f.tgt = p >= 0.5 ? 1 : 0;
      f.sw = 0;
      pose(f, p, true);
    }
    target = p >= 0.5 ? 1 : 0;
    st[1] = p;
    st[0] = 0;
    st[2] = 0;
    swOn = false;
    settled = true;
  }
  snap(0);

  function emit(f) {
    const x = tileGroup.position.x;
    const z = tileGroup.position.z;
    bus.emit('fold', {
      x, z,
      dir: f.tgt ? 'up' : 'down',
      tileId: info.tileId ?? tileGroup.userData.tileId ?? 'unknown',
      size: f.size,
      pan: panFor(x, z),
      layer: f.layer,
    });
  }

  /** One fixed step for one flap. */
  function stepFlap(f) {
    let a;
    const par = f.parent;
    if (f.tgt === 1) {
      if (!f.locked && f.m >= 1) f.locked = true;
      a = f.locked
        // flutter: linear loss + air drag (v|v|, eats the big first swing) + crease friction (ends the tail cleanly)
        ? -f.wLsq * (f.m - 1) - (f.cL + f.dragL * Math.abs(f.v) + f.fricL / (Math.abs(f.v) + 0.05)) * f.v
        // a nested flap (crossed tree plane, wall, roof, strut) is pulled open BY its parent: it follows the parent's
        // progress with a short elastic lag instead of racing it on a spring of its own, so sibling planes of one
        // prop open together and never scissor. Once upright it latches and quivers on its own.
        // (the pull is bounded by aN, so catching up with the parent never reads as a jerk, F12)
        : par !== null && par.tgt === 1 && par.started && !par.atRest
          ? Math.max(-f.aN, Math.min(f.aN, f.kN * (par.m - f.m) + f.cN * (par.v - f.v)))
          : f.kUp * (1 - f.m) - f.cUp * f.v;
    } else if (par !== null && par.tgt === 0 && par.started && !par.atRest && f.m <= 1 && par.m <= 1) {
      a = Math.max(-f.aN, Math.min(f.aN, f.kN * (par.m - f.m) + f.cN * (par.v - f.v))); // closing: same linkage
    } else {
      a = -f.kDn * f.m - f.cDn * f.v - f.gDn;
      // reversed while still travelling up: brake like the rise spring, and the end stop still exists past upright
      if (f.v > 0) a -= f.cUp * f.v * (f.m < 1 ? f.m : 1); // (fades out near the page so the slap-bounce is untouched)
      if (f.m > 1) a -= f.wLsq * (f.m - 1) + f.cL * f.v;
    }
    f.mPrev = f.m;
    f.v += a * h;
    f.m += f.v * h;
    if (f.m <= 0 && f.tgt === 0) { // the page: paper cannot pass through it
      f.m = 0;
      f.v = f.v < -S.minBounceSpeed * f.freqScale ? -f.v * S.restitution : 0;
      if (f.v === 0) f.atRest = true;
    } else if (f.m < 0) { f.m = 0; if (f.v < 0) f.v = 0; }
    if (f.tgt === 1 && Math.abs(f.m - 1) < eps && Math.abs(f.v) < veps) { f.m = 1; f.v = 0; f.atRest = true; }
  }

  const api = {
    flaps,
    info,
    get target() { return target; },
    get progress() { return st[1]; },
    get settled() { return settled; },
    /** 1 = rise, 0 = fold flat. `delay` (s) postpones the whole tile (used for ripple). No-op if unchanged. */
    setTarget(t, delay = 0) {
      t = t ? 1 : 0;
      if (t === target) return;
      target = t;
      steps = 0;
      extraDelay = delay > 0 ? delay : 0;
      let any = false;
      for (let i = 0; i < n; i++) {
        const f = flaps[i];
        // a flap that never left for the old target simply stays (no motion, no sound)
        if (f.tgt === t) { f.started = true; if (!f.atRest) any = true; } else { f.started = false; any = true; }
      }
      settled = !any;
      if (n === 0) st[1] = t;
    },
    /** Instantly place every flap at progress p (0 or 1) with zero velocity. */
    snap,
    /** Flaps the wind moves (top-level flaps with swAmp > 0 or a spinner). World reads `.node` to refresh matrices. */
    sway,
    /**
     * Wind pose for time t (s). strength >= 0: sway every flap in `sway` (only while risen + settled; fades in
     * over wind.fadeIn after settling); strength < 0: leave the sway alone (tile is moving).
     * spinK scales the spinner speed (0 = leave spinners alone). cy, sy = cos / sin of the tile's Y rotation.
     * Pure function of t and place apart from the fade-in; allocation-free; emits nothing.
     */
    applyWind(t, strength, spinK, cy, sy) {
      if (nSway === 0) return;
      const doSway = strength >= 0 && settled && target === 1;
      let lvl = 0;
      if (doSway) {
        if (!swOn || t < st[3]) { swOn = true; st[3] = t - st[2] * swFade; }
        lvl = (t - st[3]) / swFade;
        if (lvl > 1) lvl = 1;
        st[2] = lvl;
      }
      const X = tileGroup.position.x; const Z = tileGroup.position.z;
      for (let i = 0; i < nSway; i++) {
        const f = sway[i];
        const px = X + cy * f.lx + sy * f.lz; const pz = Z - sy * f.lx + cy * f.lz;
        const along = px * D1X + pz * D1Z;
        const a = along * K1 - t * W1 + WARP * Math.sin((pz * D1X - px * D1Z) * K1 * 0.6);
        const b = (px * D2X + pz * D2Z) * K2 - t * W2;
        if (f.spin !== null && spinK > 0) {
          const ha = (f.spinPh + spinK * WIND.spinSpeed * (t + WIND.spinGust * ((2 * G1 / W1) * Math.cos(a) + (2 * G2 / W2) * Math.cos(b)))) * 0.5;
          const q = f.spin.quaternion;
          q._x = 0; q._y = 0; q._z = Math.sin(ha); q._w = Math.cos(ha);
        }
        if (doSway && f.swAmp > 0) {
          const g = 0.5 + G1 * Math.sin(a) + G2 * Math.sin(b);
          const e = 0.35 + 0.65 * g;
          const ph = f.swHz * t + f.swPh - along * KF;
          const dotN = (cy * f.nx + sy * f.nz) * D1X + (cy * f.nz - sy * f.nx) * D1Z;
          let A = f.swAmp * strength;
          if (A > swMax) A = swMax;
          f.sw = A * lvl * (0.5 * (g - 0.3) * dotN + e * (0.55 * Math.sin(ph) + 0.1 * Math.sin(2.31 * ph + 1.7)));
          pose(f, f.p, false);
        }
      }
    },
    update(dt) {
      if (settled || !(dt > 0)) return;
      // the springs own the flaps again: whatever sway is left relaxes away (no pop when a swaying tile folds)
      swOn = false;
      const swDec = st[2] > 0 ? Math.exp(-dt / (WIND.release ?? 0.22)) : 1;
      if (st[2] > 0) { st[2] *= swDec; if (st[2] < 1e-4) st[2] = 0; }
      let acc = st[0] + dt;
      let k = Math.floor(acc / h + 1e-7) | 0; // int32, so `steps` stays a small integer (no boxing)
      if (k > S.maxSubSteps) { k = S.maxSubSteps; acc = k * h; }
      acc -= k * h;
      if (acc < 0) acc = 0;
      st[0] = acc;
      const alpha = acc / h;
      const up = target === 1;
      const t0 = steps * h - extraDelay;
      let all = true;
      let sum = 0;
      // steps outside, flaps inside: a nested flap reads its parent's state at the SAME fixed step (parents come
      // first in `flaps`), so the result does not depend on how dt is chopped into frames.
      for (let j = 1; j <= k; j++) {
        const tj = t0 + j * h;
        for (let i = 0; i < n; i++) {
          const f = flaps[i];
          if (f.atRest && f.started) continue;
          if (!f.started && tj >= tStart[up ? i : n + i]) {
            f.started = true;
            f.tgt = target;
            // unlatch twitch: a flap resting upright flicks a degree or two further before it falls (anticipation)
            if (target === 0 && f.atRest && f.m >= 1) f.v = S.downAnticipation * f.freqScale;
            f.atRest = false;
            f.locked = false;
            emit(f);
          }
          if (!f.atRest) stepFlap(f);
        }
      }
      for (let i = 0; i < n; i++) {
        const f = flaps[i];
        const sw = f.sw !== 0;
        if (sw) f.sw = st[2] > 0 ? f.sw * swDec : 0;
        if (f.atRest) {
          if (!f.started) all = false; // waiting for its stagger slot
          if (f.p !== f.m || f.mPrev !== f.m) { f.p = f.mPrev = f.m; pose(f, f.p, true); } else if (sw) pose(f, f.p, false);
        } else {
          all = false;
          f.p = f.mPrev + (f.m - f.mPrev) * alpha;
          pose(f, f.p, false);
        }
        sum += f.p;
      }
      steps = (steps + k) | 0;
      if (n > 0) st[1] = sum / n; // (a double/int ternary here would box a number every frame)
      if (all) { settled = true; st[1] = target; st[0] = 0; }
    },
  };
  return api;
}
