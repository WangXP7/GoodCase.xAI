// Combat effects on top of the particle system and the decals: tracers and pellet streaks, blasts,
// burning pools, the Roadflare in flight and burning, the Jumper's arc, the bloater's cloud, gibs
// and stump spray. Everything here draws; damage is applied elsewhere (weapon/, zombie/).
//
//   G.fx.tracer(from, to, { upgraded, weapon })      G.fx.pellets(from, dirs)
//   G.fx.explosion(pos, radius, kind)        kind: 'frag' | 'decoy' | 'blast' | 'burst'
//   G.fx.firePool(pos, radius, seconds, kind = 'molotov')   kind 'flare' burns red round a flare
//   G.fx.arc(points)                         G.fx.flare(pos, seconds = 6)
//   G.fx.cloud(pos, radius, seconds)         G.fx.gib(pos, dir, part)      G.fx.stump(pos, dir)
//
// Each is also driven by its event: weapon:fire (tracers on every third round of automatic fire
// and on every upgraded round; pellet streaks), explosion, fire:pool, weapon:arc, flare:launch /
// flare:burst, zombie:burst, zombie:sever. Sustained effects (pools, flares, clouds) live in small
// fixed pools and emit from update(): nothing is allocated per frame.
import { Vector3 } from 'three';
import { readVec } from './fxlights.js';
import { P_CELL } from './atlas.js';
import { goreOf } from './decals.js';
import { tuning } from '../game/tuning.js';
import { TRACER_COLOR, upgradeLook } from '../weapon/models/upgrade.js';

// ---- pure parts (tests/fx.test.js) -----------------------------------------------------------------
// Does round number `n` (1-based, counted while the trigger is held) of this weapon carry a tracer?
export function tracerDue(n, auto, upgraded) {
  if (upgraded) return true;
  return !!auto && n % 3 === 0;
}
// A jagged path from a to b: `out` gets (segs + 1) points as x,y,z triples, the ends exact and the
// points between pushed off the line by up to `amp` (largest mid-way). next(): a random in [0, 1).
export function jaggedPath(ax, ay, az, bx, by, bz, segs, amp, next, out) {
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; const k = i === 0 || i === segs ? 0 : amp * Math.sin(Math.PI * t);
    out[i * 3] = ax + (bx - ax) * t + (next() * 2 - 1) * k;
    out[i * 3 + 1] = ay + (by - ay) * t + (next() * 2 - 1) * k;
    out[i * 3 + 2] = az + (bz - az) * t + (next() * 2 - 1) * k;
  }
  return out;
}
// Emission with a rate: how many whole particles to let out this frame, carrying the remainder.
// acc: { v }. Never more than `max` in one frame (a long frame must not flood the ring).
export function emitCount(acc, rate, dt, max = 24) {
  acc.v += rate * dt;
  const n = Math.floor(acc.v);
  acc.v -= n;
  return n > max ? max : n;
}

const WARM = TRACER_COLOR.warm;
const ARC = [0.5, 0.72, 1];
const FLARE_RED = [1, 0.16, 0.1];
const TAU = Math.PI * 2;
const POOLS = 4; const FLIGHTS = 3; const CLOUDS = 3; const LAMPS = 4;

export function createCombat(G, fx, K) {
  const { spawn, cloud, basis, cone, W, rr, rng, floorBelow, levelRay, lights, clock, decals, bloodAt, KIND } = K;
  const A = new Vector3(); const B = new Vector3(); const D = new Vector3(); const P = new Vector3(); const Q = new Vector3();
  const UP = new Vector3(0, 1, 0); const N = new Vector3();
  const gore = () => goreOf(fx.gore);
  const weapons = (tuning.weapons && tuning.weapons.table) || {};

  // ---- lamps: light from fire. A few fixtures in G.lights' pool, switched on where something burns.
  const lamps = [];
  const lampSet = { pos: null, color: 0, lumens: 0, range: 14, enabled: true };
  const lampOff = { enabled: false };
  function lampFor(owner, pos, color, lumens, range, groundY) {
    const L = G.lights;
    if (!L || typeof L.add !== 'function') return null;
    let slot = null;
    for (const l of lamps) if (!l.owner) { slot = l; break; }
    if (!slot) {
      if (lamps.length >= LAMPS) return null;
      slot = { owner: null, fixture: L.add({ type: 'point', pos: [0, -50, 0], color, lumens: 1, range, pool: true, priority: 3, flicker: { amount: 0.4, speed: 9, kind: 'waver' } }) };
      lamps.push(slot);
    }
    slot.owner = owner;
    lampSet.pos = pos; lampSet.color = color; lampSet.lumens = lumens; lampSet.range = range;
    slot.fixture.groundY = groundY; slot.fixture.pool = groundY > -1e4; // a light in the air throws no pool on the ground
    slot.fixture.set(lampSet);
    return slot;
  }
  function lampFree(slot) { if (slot) { slot.owner = null; slot.fixture.set(lampOff); } }

  // ---- the flash of a blast on the world, held for its 80 ms -------------------------------------
  const flash = { pos: new Vector3(), left: 0, total: 0.08, level: 6 };
  function flashAt(pos, level, seconds) {
    flash.pos.copy(pos); flash.left = seconds; flash.total = seconds; flash.level = level;
    const ml = lights.muzzle; ml.pos.copy(pos); ml.t0 = clock.now;
    if (G.lights && G.lights.setMuzzleFlash) G.lights.setMuzzleFlash(pos, level);
  }

  // ---- tracers --------------------------------------------------------------------------------
  function streak(from, to, c, width, emis, speed, len, lead) {
    D.subVectors(to, from);
    const dist = D.length();
    if (dist < lead + 1) return;
    D.multiplyScalar(1 / dist);
    spawn(KIND.tracer, from.x + D.x * lead, from.y + D.y * lead, from.z + D.z * lead, D.x * speed, D.y * speed, D.z * speed, (dist - lead) / speed,
      width, width, 0, 0, c[0], c[1], c[2], 1, 0, 0, -1e5, emis, P_CELL.streak, Math.min(len, dist * 0.5));
  }
  function tracer(from, to, o) {
    readVec(from, A); readVec(to, B);
    const up = !!(o && o.upgraded);
    streak(A, B, up ? upgradeLook(o.weapon).tracer : WARM, 0.03, up ? 40 : 30, 150, 6, 0.5); // an upgraded round flies in its weapon's colour
  }
  // one faint streak per pellet, to where each lands
  function pelletTo(from, to, up, weapon) { streak(from, to, up ? upgradeLook(weapon).tracer : WARM, 0.012, up ? 14 : 9, 150, 2.5, 0.4); }
  function pellets(from, dirs, o) {
    readVec(from, A);
    for (let i = 0; i < dirs.length; i++) {
      readVec(dirs[i], Q).normalize();
      const hit = levelRay(A, Q, 30);
      if (hit && hit.pos) readVec(hit.pos, B); else B.copy(A).addScaledVector(Q, 30);
      pelletTo(A, B, !!(o && o.upgraded), o && o.weapon);
    }
  }

  // ---- blasts ---------------------------------------------------------------------------------
  const scorchOpts = { size: 1, burn: true };
  function explosion(pos, radius = 5, kind = 'frag') {
    readVec(pos, P);
    const fy = floorBelow(P);
    const onGround = P.y - fy < 1.2;
    const s = Math.min(1.5, Math.max(0.5, radius / 5));
    const dirt = kind === 'frag' || kind === 'blast';
    const dens = K.dens;
    if (kind === 'burst') { burst(P, radius); return; }
    A.set(P.x, Math.max(P.y, fy + 0.2) + 0.5, P.z);
    flashAt(A, dirt ? 6 : 3.5, 0.08);
    basis(UP);
    if (dirt) {
      // dirt: a dark column thrown up and out, fast and soon stopped, that falls back as it thins
      cloud(A, UP, 150, 0.05, 2, 20 * s, 3.2, 0.7, 1.4, 0.9, 0.3 * s, 0.8 * s, 1.7 * s, 0.07, 0.058, 0.046, 0.85, 0.7, 0.3, fy, 0.35, 0.03, 1.5);
      // clods and grit
      for (let i = 0, n = Math.round(44 * dens); i < n; i++) {
        cone(UP, 1.2);
        const sp = rr(4, 16) * s; const sz = rr(0.012, 0.055); const j = rr(0.6, 1.3);
        spawn(KIND.chip, A.x, fy + 0.1, A.z, W.x * sp, W.y * sp, W.z * sp, rr(1.6, 2.6), sz, sz, rr(0, TAU), rr(-25, 25), 0.06 * j, 0.055 * j, 0.05 * j, 1, 0, 1, fy, 0, P_CELL.chip + rng.int(0, 7), 1);
      }
    }
    // dust driven out along the ground
    if (onGround) {
      for (let i = 0, n = Math.round(40 * dens); i < n; i++) {
        const a = (i / n) * TAU + rr(-0.1, 0.1); const sp = rr(5, 12) * s;
        K.setDelay(rr(0, 0.04));
        spawn(KIND.mote, P.x, fy + 0.15, P.z, Math.cos(a) * sp, rr(0.2, 1.4), Math.sin(a) * sp, rr(1.1, 2.0), 0.25 * s, rr(0.8, 1.5) * s, Math.cos(a), 0.4, 0.2, 0.185, 0.165, 0.3, 3.6, 0.04, fy + 0.02, 0.2, Math.sin(a), 0.7 + 8 * 20);
      }
      K.setDelay(0);
    }
    // (drawn after the dirt: particles are not sorted, and the fire is in front of what it throws up)
    // the flash itself: a white core, a star and the ring it throws along the ground
    spawn(KIND.glint, A.x, A.y - 0.1, A.z, 0, 0, 0, 0.09, 2.2 * s, 5.5 * s, 0, 0, 1, 0.78, 0.5, 1, 0, 0, -1e5, 30, 0, 1);
    for (let i = 0; i < 2; i++) spawn(KIND.fire, A.x, A.y - 0.2, A.z, 0, 2, 0, 0.1 + i * 0.04, 1.6 * s, 4.4 * s, rr(0, TAU), 0, 1, 0.9, 0.7, 1, 8, 0, -1e5, 48, P_CELL.star + rng.int(0, 3), 1);
    // its heart: a body of fire over the centre itself (the rolling flames below stand round it and
    // left a hole in the middle), white-hot for a moment, then orange as it lifts
    for (let i = 0; i < 3; i++) spawn(KIND.fire, A.x + rr(-0.2, 0.2) * s, A.y + rr(-0.1, 0.3) * s, A.z + rr(-0.2, 0.2) * s, 0, rr(1, 2.5), 0, rr(0.2, 0.34), (1.5 + i * 0.5) * s, (2.6 + i * 0.6) * s, rr(0, TAU), rr(-1, 1), 1, 0.85, 0.62, 1, 3, -0.1, -1e5, 30 - i * 6, P_CELL.glow, 1);
    // the fireball: a few rolling bodies of flame that burn out in a quarter of a second
    // (each stands on the blast's centre and points its own way across the view, so they overlap in the middle)
    const e = G.camera.matrixWorld.elements;
    for (let i = 0, n = Math.round(10 * dens); i < n; i++) {
      const rot = (i / n) * TAU + rr(-0.3, 0.3); const size = rr(1.6, 2.6) * s; const off = size * rr(0.08, 0.3);
      const ux = -Math.sin(rot) * e[0] + Math.cos(rot) * e[4]; const uy = -Math.sin(rot) * e[1] + Math.cos(rot) * e[5]; const uz = -Math.sin(rot) * e[2] + Math.cos(rot) * e[6];
      const sp = rr(1.5, 4) * s;
      spawn(KIND.fire, A.x + ux * off, A.y + uy * off, A.z + uz * off, ux * sp, uy * sp + 1, uz * sp, rr(0.22, 0.4), size, size * 1.5, rot, 0, 1, 0.85, 0.65, 0.95, 4, -0.1, -1e5, rr(22, 34), P_CELL.flame, P_CELL.flameFrames);
    }
    if (onGround) spawn(KIND.flat, P.x, fy, P.z, 0, 1, 0, 0.11, 1.2 * s, 5.5 * s, rr(0, TAU), 0, 1, 0.8, 0.55, 0.9, 0, 0, -1e5, 30, P_CELL.burst, 1);
    // tongues of flame out of the fireball
    for (let i = 0, n = Math.round(12 * dens); i < n; i++) {
      cone(UP, 1.35);
      const sp = rr(7, 17) * s;
      spawn(KIND.jet, A.x, A.y - 0.3, A.z, W.x * sp, W.y * sp, W.z * sp, rr(0.08, 0.16), 0.3 * s, 0.55 * s, 0, 0, 1, 0.85, 0.65, 1, 9, 0, -1e5, 38, P_CELL.tongue + rng.int(0, 3), 0.05);
    }
    for (let i = 0, n = Math.round((dirt ? 46 : 70) * dens); i < n; i++) {
      cone(UP, 1.45);
      const sp = rr(6, 28) * s;
      spawn(KIND.spark, A.x, A.y - 0.3, A.z, W.x * sp, W.y * sp, W.z * sp, rr(0.25, 1.0), rr(0.006, 0.012), 0.004, 0, 0, 1, 0.9, 0.7, 1, 2.4, 1, fy, rr(18, 40), P_CELL.streak, 0.02);
    }
    // smoke: what is left hanging when the dirt has fallen, rising slowly
    A.y += 0.2;
    cloud(A, UP, dirt ? 80 : 46, 0.35, 0.4, 6 * s, 1.7, -0.1, 7.5, 5, 0.5 * s, 1.5 * s, 2.8 * s, 0.035, 0.035, 0.04, 0.8, 0.95, 0.4, fy, 0.25);
    // and a column that goes on rising out of the crater for a few seconds
    for (let i = 0, n = Math.round(16 * dens); i < n; i++) {
      K.setDelay(0.3 + i * 0.16);
      spawn(KIND.mote, P.x + rr(-0.4, 0.4), fy + 0.3, P.z + rr(-0.4, 0.4), rr(-0.3, 0.3), rr(1.2, 2.2), rr(-0.3, 0.3), rr(4, 6), 0.5 * s, rr(1.6, 2.4) * s, rr(-1, 1), 0.4, 0.04, 0.04, 0.045, 0.6, 0.5, -0.08, fy, 0.4, rr(-1, 1), 0.3);
    }
    K.setDelay(0);
    if (onGround) {
      scorchOpts.size = Math.min(radius * 0.7, 3.4);
      decals.add(Q.set(P.x, fy, P.z), UP, 'scorch', scorchOpts);
      if (lights.uniforms.uWetness.value > 0.4) { // standing water thrown out
        for (let i = 0, n = Math.round(24 * dens); i < n; i++) {
          cone(UP, 1.1);
          const sp = rr(3, 9);
          spawn(KIND.drop, P.x, fy + 0.05, P.z, W.x * sp, W.y * sp, W.z * sp, 1.2, rr(0.004, 0.008), 0.003, 0, 0, 0.05, 0.055, 0.06, 0.3, 0.8, 1, fy, 0, P_CELL.drop + rng.int(0, 3), 0.014);
        }
      }
    }
  }

  // a body going off (the bloater, 'burst'): a wet red burst and the cloud it leaves
  function burst(p, radius) {
    const g = gore();
    basis(UP);
    bloodAt(p, UP, 1.6 * g);
    if (g >= 1) for (let i = 0; i < 6; i++) { cone(UP, 1.4); gibAt(p, W, 0.5); basis(UP); }
    startCloud(p, radius, 5);
  }

  // ---- burning pools and the flare on the ground ---------------------------------------------------
  const pools = [];
  for (let i = 0; i < POOLS; i++) pools.push({ on: false, pos: new Vector3(), r: 1, t0: 0, dur: 0, flare: false, lamp: null, fl: { v: 0 }, sm: { v: 0 }, em: { v: 0 }, gl: { v: 0 }, level: 0 });
  function firePool(pos, radius = 2.8, seconds = 8, kind = 'molotov') {
    let p = null;
    for (const q of pools) if (!q.on) { p = q; break; }
    if (!p) { p = pools[0]; for (const q of pools) if (q.t0 < p.t0) p = q; lampFree(p.lamp); }
    readVec(pos, p.pos);
    p.on = true; p.r = radius; p.t0 = clock.now; p.dur = seconds; p.flare = kind === 'flare'; p.level = 0;
    p.fl.v = p.sm.v = p.em.v = p.gl.v = 0;
    A.set(p.pos.x, p.pos.y + (p.flare ? 1.1 : 1.6), p.pos.z); // above the flames: a lamp on the ground is a hot spot under itself
    p.lamp = lampFor(p, A, p.flare ? 0xff3524 : 0xff8a3a, p.flare ? 14000 : POOL_LUMENS, p.flare ? 18 : 16, p.pos.y);
    scorchOpts.size = radius * (p.flare ? 0.7 : 1.5);
    decals.add(p.pos, UP, 'scorch', scorchOpts);
    // it catches: a low flash and a rush of flame across the pool
    if (!p.flare) {
      flashAt(A, 2, 0.06);
      spawn(KIND.flat, p.pos.x, p.pos.y, p.pos.z, 0, 1, 0, 0.3, radius * 0.6, radius * 2.4, rr(0, TAU), 0, 1, 0.75, 0.5, 0.8, 0, 0, -1e5, 2.5, P_CELL.burst, 1);
    }
    return p;
  }
  function flare(pos, seconds = 6) { return firePool(pos, 3, seconds, 'flare'); }

  function flameAt(x, y, z, size, tint, emis) {
    // a standing flame from the flipbook, its base on the fuel: it rises as it burns through its frames
    spawn(KIND.fire, x, y + size * 0.4, z, rr(-0.25, 0.25), rr(0.5, 1.3), rr(-0.25, 0.25), rr(0.45, 0.8), size, size * rr(1.0, 1.3), rr(-0.12, 0.12), 0, tint[0], tint[1], tint[2], 0.85, 0.6, -0.08, -1e5, emis, P_CELL.flame, P_CELL.flameFrames);
  }
  const FIRE_TINT = [1, 0.9, 0.75]; const FLARE_TINT = [1, 0.5, 0.45];
  const POOL_LUMENS = 16000; // the burning pool's light on the ground, the pumps and whoever stands by it
  function burnPool(p, dt) {
    const age = clock.now - p.t0;
    if (age >= p.dur) { p.on = false; lampFree(p.lamp); p.lamp = null; return; }
    const k = Math.min(1, age / 0.35) * Math.min(1, (p.dur - age) / 1.6);
    const dens = K.dens;
    basis(UP);
    // the lamp follows the fire's strength in a few steps (set() is not free)
    const step = Math.round(k * 6) / 6;
    if (p.lamp && step !== p.level) { p.level = step; lampSet.pos = null; lampSet.color = p.flare ? 0xff3524 : 0xff8a3a; lampSet.lumens = (p.flare ? 14000 : POOL_LUMENS) * Math.max(step, 0.05); lampSet.range = p.flare ? 18 : 16; p.lamp.fixture.set(lampSet); }
    const x = p.pos.x; const y = p.pos.y; const z = p.pos.z; const r = p.r;
    if (p.flare) {
      // the flare itself: a core too bright to look at, spitting sparks, in a red haze
      for (let i = 0, n = emitCount(p.gl, 40, dt, 3); i < n; i++) spawn(KIND.glint, x, y + 0.1, z, 0, 0, 0, 0.06, rr(0.5, 0.9), 0.4, 0, 0, FLARE_RED[0], FLARE_RED[1] + 0.2, FLARE_RED[2] + 0.15, k, 0, 0, -1e5, 34, 0, 1);
      for (let i = 0, n = emitCount(p.em, 90 * k * dens, dt, 8); i < n; i++) {
        cone(UP, 0.9);
        const sp = rr(2, 7);
        spawn(KIND.spark, x, y + 0.08, z, W.x * sp, W.y * sp, W.z * sp, rr(0.2, 0.6), 0.006, 0.003, 0, 0, 1, 0.5, 0.45, 1, 1.5, 1, y, rr(20, 40), P_CELL.streak, 0.014);
      }
      for (let i = 0, n = emitCount(p.sm, 22 * k * dens, dt, 4); i < n; i++) cloud(A.set(x + rr(-0.1, 0.1), y + 0.2, z + rr(-0.1, 0.1)), UP, 1, 0, 1.2, 2.6, 0.7, -0.12, 2.0, 2.8, 0.2, 0.7, 1.2, 0.3, 0.2, 0.2, 0.3, 0.3, 0.1, y, 1.2);
      for (let i = 0, n = emitCount(p.fl, 5 * r * r * k * dens, dt, 6); i < n; i++) {
        const a = rng.next() * TAU; const d = Math.sqrt(rng.next()) * r * 0.9;
        flameAt(x + Math.cos(a) * d, y + 0.02, z + Math.sin(a) * d, rr(0.35, 0.6), FLARE_TINT, rr(5, 8));
      }
      return;
    }
    // The burning sheet. Fuel alight on wet ground is one thing, not a bed of separate fires:
    //  - a glowing base: the whole pool lit from underneath (wide soft patches that overlap in time), hot
    //    ragged patches crawling over it, brightest toward the middle;
    //  - a flame front: low flames packed along the pool's wandering edge and along two fronts inside it,
    //    close enough to stand as a wall, with soft bodies of fire between them so no flame stands alone;
    //  - tongues of every height licking up out of it and leaning on the draught toward the middle;
    //  - smoke that the fire lights from below, and the lamp on what stands near.
    // (Same emission rates as before: the budget is spent differently, not raised.)
    const wob = clock.now * 0.7;
    for (let i = 0, n = emitCount(p.gl, 7 * r * r * k * dens, dt, 8); i < n; i++) {
      const a = rng.next() * TAU; const q = rng.next();
      if (q < 0.22) { // the base: wide, long-lived, always several alive
        const d = rng.next() * r * 0.35;
        spawn(KIND.flat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0, 1, 0, rr(0.9, 1.4), r * rr(1.3, 1.6), r * rr(1.7, 2.1), rr(0, TAU), 0, 1, 0.62, 0.3, 0.85 * k, 0, 0, -1e5, rr(5, 6.5), P_CELL.glow, 1);
      } else if (q < 0.7) { // hot patches crawling over the fuel
        const d = Math.sqrt(rng.next()) * r * 0.85;
        spawn(KIND.flat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0, 1, 0, rr(0.3, 0.6), r * rr(0.2, 0.35), r * rr(0.35, 0.6), rr(0, TAU), 0, 1, 0.85, 0.6, 0.7 * k, 0, 0, -1e5, rr(5, 9) * (1.2 - 0.5 * d / r), P_CELL.glow, 1);
      } else { // a body of fire just over the fuel: what the flames stand in
        const d = Math.sqrt(rng.next()) * r * 0.8; const sz = rr(1.1, 1.8) * (1.15 - 0.4 * d / r);
        spawn(KIND.fire, x + Math.cos(a) * d, y + sz * 0.22, z + Math.sin(a) * d, rr(-0.2, 0.2), rr(0.25, 0.7), rr(-0.2, 0.2), rr(0.45, 0.8), sz, sz * rr(1.2, 1.5), rr(0, TAU), rr(-0.6, 0.6), 1, 0.8, 0.55, 0.42 * k, 0.8, -0.05, -1e5, rr(2.6, 4), P_CELL.glow, 1);
      }
    }
    for (let i = 0, n = emitCount(p.fl, 15 * r * r * k * dens, dt, 14); i < n; i++) {
      const a = rng.next() * TAU; const q = rng.next(); const w = rng.next();
      // where: on the edge front (it wanders in and out as it burns), on one of two fronts inside, or anywhere
      const edge = 0.86 + 0.1 * Math.sin(a * 3 + wob) + 0.05 * Math.sin(a * 7 - wob * 1.7);
      const d = r * (w < 0.42 ? edge + rr(-0.04, 0.04) : w < 0.72 ? (w < 0.57 ? 0.56 : 0.3) * (1 + 0.22 * Math.sin(a * 2 - wob + (w < 0.57 ? 0 : 2))) + rr(-0.05, 0.05) : Math.sqrt(rng.next()) * 0.8);
      const fx0 = x + Math.cos(a) * d; const fz0 = z + Math.sin(a) * d; const mid = 1.35 - 0.75 * d / r; // taller toward the middle
      if (q < 0.38) { // a tongue: stretched up its own rise, leaning inward, of any height
        const up = rr(1.2, 4.2) * mid; const t = rng.next();
        spawn(KIND.jet, fx0, y + 0.02, fz0, -Math.cos(a) * rr(0.1, 0.9) * (d / r) + rr(-0.5, 0.5), up, -Math.sin(a) * rr(0.1, 0.9) * (d / r) + rr(-0.5, 0.5), rr(0.22, 0.5), rr(0.35, 0.9) * (0.7 + 0.6 * t), rr(0.16, 0.4), 0, 0, 1, 0.85, 0.65, 0.9, 1.2, -0.1, -1e5, rr(3.5, 6), P_CELL.tongue + rng.int(0, 3), rr(0.08, 0.2));
      } else { // a flame of the front: low at the edge, and never alone (they stand a hand apart)
        const size = (q < 0.86 ? rr(1.0, 1.6) : rr(1.9, 2.8)) * mid; // (the flame fills about half its quad)
        spawn(KIND.fire, fx0, y + size * 0.34, fz0, rr(-0.3, 0.3), rr(0.4, 1.2), rr(-0.3, 0.3), rr(0.5, 0.85), size, size * rr(1.0, 1.3), rr(-0.4, 0.4), rr(-0.5, 0.5), FIRE_TINT[0], FIRE_TINT[1], FIRE_TINT[2], 0.85, 0.6, -0.08, -1e5, rr(5, 8), P_CELL.flame, P_CELL.flameFrames);
      }
    }
    // smoke off the top: brown-grey and lit from below, so it is seen against a night sky
    for (let i = 0, n = emitCount(p.sm, 11 * r * k * dens, dt, 4); i < n; i++) {
      const a = rng.next() * TAU; const d = Math.sqrt(rng.next()) * r * 0.6;
      cloud(A.set(x + Math.cos(a) * d, y + rr(0.9, 1.5), z + Math.sin(a) * d), UP, 1, 0, 1.1, 2.6, 0.5, -0.16, 2.8, 4.2, 0.5, 1.3, 2.3, 0.2, 0.13, 0.09, 0.62, 0.35, 0.25, y, 0.5);
    }
    // embers
    for (let i = 0, n = emitCount(p.em, 12 * r * k * dens, dt, 4); i < n; i++) {
      const a = rng.next() * TAU; const d = Math.sqrt(rng.next()) * r;
      spawn(KIND.spark, x + Math.cos(a) * d, y + 0.3, z + Math.sin(a) * d, rr(-0.6, 0.6), rr(1.5, 4.5), rr(-0.6, 0.6), rr(0.6, 1.5), 0.006, 0.003, 0, 0, 1, 0.8, 0.5, 1, 1.2, -0.25, y, rr(8, 16), P_CELL.streak, 0.01);
    }
  }

  // ---- the flare in flight: pos + vel t + 1/2 (0, -gravity, 0) t^2 until its burst ------------------
  const flights = [];
  for (let i = 0; i < FLIGHTS; i++) flights.push({ on: false, id: 0, p0: new Vector3(), v: new Vector3(), g: 3, t0: 0, life: 4, lamp: null, tr: { v: 0 }, last: new Vector3() });
  function launch(e) {
    let f = null;
    for (const q of flights) if (!q.on) { f = q; break; }
    if (!f) { f = flights[0]; lampFree(f.lamp); }
    f.on = true; f.id = e.id; readVec(e.pos, f.p0); readVec(e.vel, f.v); f.g = e.gravity || 0; f.t0 = clock.now; f.life = 4.2; f.tr.v = 0;
    f.last.copy(f.p0);
    f.lamp = lampFor(f, f.p0, 0xff3524, 9000, 16, -1e5);
    return f;
  }
  function fly(f, dt) {
    const t = clock.now - f.t0;
    if (t > f.life) { f.on = false; lampFree(f.lamp); f.lamp = null; return; }
    P.copy(f.p0).addScaledVector(f.v, t); P.y -= 0.5 * f.g * t * t;
    basis(UP);
    // the lamp rides with it: its record is moved in place (fixture.set() builds an array per call)
    if (f.lamp) { const fp = f.lamp.fixture.pos; if (fp && typeof fp.copy === 'function') { fp.copy(P); if (f.lamp.fixture.foot && typeof f.lamp.fixture.foot.copy === 'function') f.lamp.fixture.foot.copy(P); } else if (fp && fp.length >= 3) { fp[0] = P.x; fp[1] = P.y; fp[2] = P.z; } else { lampSet.pos = P; lampSet.color = 0xff3524; lampSet.lumens = 9000; lampSet.range = 16; f.lamp.fixture.set(lampSet); } }
    // the burning head, and what it leaves along the way it came this frame: sparks that fall, smoke that hangs
    spawn(KIND.glint, P.x, P.y, P.z, 0, 0, 0, Math.max(dt * 1.6, 0.03), 0.7, 0.7, 0, 0, FLARE_RED[0], FLARE_RED[1] + 0.2, FLARE_RED[2] + 0.15, 1, 0, 0, -1e5, 40, 0, 1);
    D.subVectors(P, f.last);
    const n = emitCount(f.tr, 140 * K.dens, dt, 10);
    for (let i = 0; i < n; i++) {
      const u = rng.next();
      A.copy(f.last).addScaledVector(D, u);
      spawn(KIND.spark, A.x, A.y, A.z, rr(-1.5, 1.5), rr(-1, 2), rr(-1.5, 1.5), rr(0.25, 0.7), 0.006, 0.003, 0, 0, 1, 0.45, 0.4, 1, 1.5, 0.8, -1e5, rr(16, 34), P_CELL.streak, 0.012);
      if (i % 3 === 0) cloud(A, UP, 1, 0, 0.1, 0.6, 1.5, -0.03, 1.4, 2.0, 0.1, 0.3, 0.5, 0.3, 0.2, 0.2, 0.12, 1.5, 0.1, -1e5, 1.4);
    }
    f.last.copy(P);
  }
  function landed(e) {
    for (const f of flights) if (f.on && f.id === e.id) { f.on = false; lampFree(f.lamp); f.lamp = null; }
    if (!e.pos) return;
    readVec(e.pos, P); basis(UP);
    flashAt(A.set(P.x, P.y + 0.3, P.z), 2.5, 0.06);
    spawn(KIND.glint, P.x, P.y + 0.1, P.z, 0, 0, 0, 0.12, 1.2, 2.6, 0, 0, FLARE_RED[0], FLARE_RED[1] + 0.2, FLARE_RED[2] + 0.15, 1, 0, 0, -1e5, 40, 0, 1);
    for (let i = 0, n = Math.round(50 * K.dens); i < n; i++) {
      cone(UP, 1.5);
      const sp = rr(3, 14);
      spawn(KIND.spark, P.x, P.y + 0.1, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.3, 0.9), 0.007, 0.003, 0, 0, 1, 0.5, 0.45, 1, 1.6, 1, P.y - 0.05, rr(20, 40), P_CELL.streak, 0.016);
    }
  }

  // ---- the Jumper's arc: ribbons from point to point that jump and fork for a few frames -----------
  const path = new Float32Array(3 * 16);
  const next = () => rng.next();
  function ribbon(ax, ay, az, bx, by, bz, width, emis, life, amp) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const segs = Math.min(14, Math.max(3, Math.round(len / 0.32)));
    jaggedPath(ax, ay, az, bx, by, bz, segs, amp, next, path);
    for (let i = 0; i < segs; i++) {
      const k = i * 3;
      spawn(KIND.bolt, path[k], path[k + 1], path[k + 2], path[k + 3] - path[k], path[k + 4] - path[k + 1], path[k + 5] - path[k + 2], life, width, width, 0, 0, ARC[0], ARC[1], ARC[2], 1, 0, 0, -1e5, emis, P_CELL.streak, 0);
      // the air round it glows: a soft blue body at every kink, so the bolt is a lit thing and not a drawn line
      if (width > 0.025) spawn(KIND.glint, path[k + 3], path[k + 4], path[k + 5], 0, 0, 0, life + 0.03, width * 7, width * 10, 0, 0, ARC[0], ARC[1], ARC[2], 0.5, 0, 0, -1e5, emis * 0.07, 0, 1);
    }
    return segs;
  }
  const from = new Vector3(); let fromAt = -1;
  const arcLamp = { slot: null, left: 0 };
  const forkAt = new Float32Array(9);
  function arc(points, start) {
    if (!points || !points.length) return;
    let has = false;
    if (start) { readVec(start, A); has = true; } else if (clock.now - fromAt < 0.05) { A.copy(from); has = true; }
    for (let i = 0; i < points.length; i++) {
      readVec(points[i], B);
      if (has) {
        const len = A.distanceTo(B);
        // three strikes over a tenth of a second, each along a different path, the first the brightest
        for (let s = 0; s < 3; s++) {
          K.setDelay(s * 0.04);
          const segs = ribbon(A.x, A.y, A.z, B.x, B.y, B.z, s === 0 ? 0.05 : 0.03, s === 0 ? 46 : 26, 0.06, Math.min(0.5, 0.1 + len * 0.07));
          // forks: short offshoots from a point along the path
          const nb = 2 + (rng.next() < 0.6 ? 1 : 0);
          for (let b = 0; b < nb; b++) { const k = rng.int(1, segs - 1) * 3; forkAt[b * 3] = path[k]; forkAt[b * 3 + 1] = path[k + 1]; forkAt[b * 3 + 2] = path[k + 2]; } // (ribbon() rewrites `path`)
          for (let b = 0; b < nb; b++) {
            const l = rr(0.4, 1.1); const fx0 = forkAt[b * 3]; const fy0 = forkAt[b * 3 + 1]; const fz0 = forkAt[b * 3 + 2];
            const ex = fx0 + rr(-1, 1) * l; const ey = fy0 + rr(-0.6, 1) * l; const ez = fz0 + rr(-1, 1) * l;
            ribbon(fx0, fy0, fz0, ex, ey, ez, 0.02, 20, 0.05, 0.16);
            if (rng.next() < 0.5) ribbon(ex, ey, ez, ex + rr(-0.5, 0.5), ey + rr(-0.5, 0.3), ez + rr(-0.5, 0.5), 0.012, 12, 0.04, 0.08); // a twig off the fork
          }
        }
        K.setDelay(0);
      }
      // where it lands: a hard blue-white knot and a shower off the body
      spawn(KIND.glint, B.x, B.y, B.z, 0, 0, 0, 0.14, 0.35, 0.8, 0, 0, ARC[0], ARC[1], ARC[2], 1, 0, 0, -1e5, 16, 0, 1);
      basis(UP);
      for (let j = 0, n = Math.round(10 * K.dens); j < n; j++) {
        cone(UP, 1.5);
        const sp = rr(2, 7);
        spawn(KIND.spark, B.x, B.y, B.z, W.x * sp, W.y * sp, W.z * sp, rr(0.15, 0.5), 0.005, 0.003, 0, 0, 0.75, 0.85, 1, 1, 2, 1, -1e5, rr(16, 30), P_CELL.streak, 0.012);
      }
      A.copy(B); has = true;
    }
    // its light is its own and cold (it used to flash through the shared, warm muzzle light)
    readVec(points[0], B);
    if (!arcLamp.slot) arcLamp.slot = lampFor(arcLamp, B, 0xa8c8ff, 26000, 14, -1e5);
    else { lampSet.pos = B; lampSet.color = 0xa8c8ff; lampSet.lumens = 26000; lampSet.range = 14; arcLamp.slot.fixture.set(lampSet); }
    arcLamp.left = 0.1;
  }

  // ---- the bloater's cloud: lit puffs that fill a volume and hide what is behind them -------------
  const clouds = [];
  for (let i = 0; i < CLOUDS; i++) clouds.push({ on: false, pos: new Vector3(), r: 2, t0: 0, dur: 0, acc: { v: 0 }, floor: 0 });
  const GAS = [0.055, 0.08, 0.036];
  function puffIn(c, speed) {
    // a point in the flattened ball, a slow drift outward and up
    const a = rng.next() * TAU; const d = Math.pow(rng.next(), 0.6) * c.r; const h = rng.next() * rng.next() * c.r * 0.9;
    A.set(c.pos.x + Math.cos(a) * d * 0.8, c.floor + 0.25 + h, c.pos.z + Math.sin(a) * d * 0.8);
    N.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
    basis(N);
    cloud(A, N, 1, 0, 0.1, speed, 1.6, -0.01, 3.4, 4.4, 0.55 * c.r, 0.8 * c.r, 1.15 * c.r, GAS[0], GAS[1], GAS[2], 1, 0.6, 0.3, c.floor, 0.45);
  }
  function startCloud(pos, radius = 2.5, seconds = 5) {
    let c = null;
    for (const q of clouds) if (!q.on) { c = q; break; }
    if (!c) c = clouds[0];
    readVec(pos, c.pos);
    c.on = true; c.r = radius; c.t0 = clock.now; c.dur = seconds; c.acc.v = 0; c.floor = floorBelow(c.pos);
    for (let i = 0, n = Math.round(110 * K.dens); i < n; i++) puffIn(c, 2.8);
    return c;
  }
  function gasCloud(c, dt) {
    const age = clock.now - c.t0;
    if (age >= c.dur) { c.on = false; return; }
    const k = Math.min(1, (c.dur - age) / 1.5);
    for (let i = 0, n = emitCount(c.acc, 50 * k * K.dens * Math.max(1, c.r / 2.5), dt, 6); i < n; i++) puffIn(c, 0.6);
  }

  // ---- gibs and stumps: the blood system with pieces in it ----------------------------------------
  const landOpts = { kind: 'spatter', size: 0.3, dir: null };
  function gibAt(p, d, scale) {
    const fy = floorBelow(p);
    const sp = rr(2.2, 5.5);
    // a piece of meat: a wet chunk the size of a fist or less, dark red with a pale side now and then
    const sz = rr(0.06, 0.15) * scale; const pale = rng.next() < 0.25;
    spawn(KIND.chip, p.x, p.y, p.z, d.x * sp, d.y * sp + 1.6, d.z * sp, rr(2.6, 3.6), sz, sz, rr(0, TAU), rr(-14, 14), pale ? 0.17 : 0.055, pale ? 0.075 : 0.004, pale ? 0.055 : 0.003, 1, 0, 1, fy, 1, P_CELL.chip + rng.int(0, 7), 1);
    // it trails blood: a string of fat drops, and a wet burst as it tears free
    spawn(KIND.splash, p.x, p.y, p.z, d.x * sp * 0.5, d.y * sp * 0.5 + 0.8, d.z * sp * 0.5, rr(0.22, 0.32), 0.08, rr(0.3, 0.5) * scale, rr(0, TAU), rr(-2, 2), 0.085, 0.0016, 0.0012, 0.9, 2.5, 0.4, fy, 0, P_CELL.splash, P_CELL.splashFrames);
    for (let j = 0; j < 5; j++) {
      K.setDelay(j * 0.04);
      spawn(KIND.drop, p.x, p.y, p.z, d.x * sp * 0.85 + rr(-0.5, 0.5), d.y * sp * 0.85 + 1.4, d.z * sp * 0.85 + rr(-0.5, 0.5), 1.5, rr(0.012, 0.024), 0.008, 0, 0, 0.1, 0.0016, 0.0012, 0.95, 0.7, 1, fy, 0, P_CELL.drop + rng.int(0, 3), 0.01);
    }
    K.setDelay(0);
  }
  // part: 'head' | 'arm' | 'leg' | ... (a head throws bone as well). Reduced gore: a puff, no pieces.
  function gib(pos, dir, part) {
    readVec(pos, P); readVec(dir || UP, Q);
    if (Q.lengthSq() < 1e-8) Q.set(0, 1, 0);
    Q.normalize();
    const g = gore();
    if (g < 1) { bloodAt(P, Q, 0.6, part); return; }
    bloodAt(P, Q, 1.5, part);
    basis(Q);
    const fy = floorBelow(P);
    for (let i = 0, n = Math.round((part === 'head' ? 10 : 8) * K.dens); i < n; i++) { cone(Q, 0.9); D.copy(W); gibAt(P, D, part === 'head' ? 0.8 : 1); basis(Q); }
    if (part === 'head') for (let i = 0; i < 4; i++) { // splinters of bone
      cone(Q, 1.0);
      const sp = rr(2, 6); const sz = rr(0.025, 0.06);
      spawn(KIND.chip, P.x, P.y, P.z, W.x * sp, W.y * sp + 1, W.z * sp, rr(1.6, 2.4), sz, sz, rr(0, TAU), rr(-30, 30), 0.42, 0.38, 0.3, 1, 0, 1, fy, 0.6, P_CELL.chip + rng.int(0, 7), 1);
    }
    // where the pieces come down
    for (let i = 0; i < 2; i++) {
      const reach = rr(0.6, 1.9);
      A.set(P.x + Q.x * reach + rr(-0.3, 0.3), P.y, P.z + Q.z * reach + rr(-0.3, 0.3));
      landOpts.size = rr(0.3, 0.55); landOpts.dir = Q;
      decals.addBlood(A.setY(floorBelow(A)), UP, landOpts);
    }
  }
  // an opened limb: four beats of spray along dir, each weaker, and what falls under it
  const dripOpts = { kind: 'pool', size: 0.3, dir: null, grow: 2.5 };
  function stump(pos, dir) {
    if (gore() < 1) return;
    readVec(pos, P); readVec(dir || UP, Q);
    if (Q.lengthSq() < 1e-8) Q.set(0, 1, 0);
    Q.normalize(); basis(Q);
    const fy = floorBelow(P);
    for (let beat = 0; beat < 4; beat++) {
      const force = 1 - beat * 0.22;
      for (let i = 0, n = Math.round(11 * K.dens); i < n; i++) {
        cone(Q, 0.22);
        const sp = rr(1.8, 4.6) * force;
        K.setDelay(beat * 0.36 + rr(0, 0.12));
        spawn(KIND.drop, P.x, P.y, P.z, W.x * sp, W.y * sp + 0.5, W.z * sp, 1.5, rr(0.01, 0.022), 0.007, 0, 0, 0.1, 0.0016, 0.0012, 0.95, 0.7, 1, fy, 0, P_CELL.drop + rng.int(0, 3), 0.012);
      }
    }
    K.setDelay(0);
    cloud(P, Q, 50, 1.2, 0.4, 3.5, 10, 0.4, 0.34, 0.22, 0.03, 0.06, 0.12, 0.05, 0.002, 0.0015, 0.6, 0.3, 2, fy, 3, 0.012, 1.4);
    if (P.y - fy < 2.2) { dripOpts.size = rr(0.28, 0.42); decals.addBlood(A.set(P.x + Q.x * 0.35, fy, P.z + Q.z * 0.35), UP, dripOpts); }
  }

  // ---- events ---------------------------------------------------------------------------------
  // A shot's tracer waits for the frame's hits: it ends on the furthest zombie the round hit (the only
  // one, for a round that does not go through), unless the round went on to the world.
  const pend = { on: false, from: new Vector3(), to: new Vector3(), upgraded: false, weapon: '', pellets: 0, far: new Vector3(), farOn: false, world: false };
  let run = 0; let lastShot = -1; let lastWeapon = '';
  if (G.events) {
    G.events.on('weapon:fire', (e) => {
      if (!e || e.dry || !e.pos || !e.dir) return;
      const def = weapons[e.weapon] || null;
      if (e.weapon !== lastWeapon || clock.now - lastShot > 0.35) run = 0;
      run++; lastShot = clock.now; lastWeapon = e.weapon;
      readVec(e.pos, pend.from); readVec(e.dir, Q).normalize();
      from.copy(pend.from); fromAt = clock.now;
      if (def && def.special) { pend.on = false; return; } // the arc and the flare draw themselves
      pend.pellets = e.pellets > 1 ? e.pellets : 0;
      pend.upgraded = !!e.upgraded; pend.weapon = e.weapon;
      pend.on = pend.pellets > 0 || tracerDue(run, def && def.auto, pend.upgraded);
      if (!pend.on) return;
      const range = (def && def.range) || 60;
      const hit = levelRay(pend.from, Q, range);
      if (hit && hit.pos) readVec(hit.pos, pend.to); else pend.to.copy(pend.from).addScaledVector(Q, range);
      pend.farOn = false; pend.world = false;
    });
    G.events.on('hit:zombie', (e) => {
      if (!pend.on || !e || !e.pos || (e.source && e.source !== 'bullet')) return;
      if (pend.pellets > 0) { pelletTo(pend.from, readVec(e.pos, B), pend.upgraded, lastWeapon); return; }
      readVec(e.pos, B);
      if (!pend.farOn || B.distanceToSquared(pend.from) > pend.far.distanceToSquared(pend.from)) { pend.far.copy(B); pend.farOn = true; }
    });
    G.events.on('hit:world', (e) => {
      if (pend.on && pend.pellets === 0) pend.world = true;
      if (pend.on && pend.pellets > 0 && e && e.pos) pelletTo(pend.from, readVec(e.pos, B), pend.upgraded, lastWeapon);
    });
    G.events.on('explosion', (e) => { if (e && e.pos) explosion(e.pos, e.radius, e.kind); });
    G.events.on('fire:pool', (e) => { if (e && e.pos) firePool(e.pos, e.radius, e.seconds, e.kind); });
    G.events.on('weapon:arc', (e) => { if (e && e.points) arc(e.points); });
    G.events.on('flare:launch', (e) => { if (e && e.pos && e.vel) launch(e); });
    G.events.on('flare:burst', (e) => { if (e) landed(e); });
    G.events.on('zombie:burst', (e) => { if (e && e.pos) explosion(e.pos, e.radius || 2.5, 'burst'); });
    G.events.on('zombie:sever', (e) => { if (e && e.pos) { gib(e.pos, e.dir || UP, e.part); stump(e.pos, e.dir || UP); } });
  }

  function update(dt) {
    if (pend.on) {
      if (pend.farOn && !pend.world) pend.to.copy(pend.far); // stopped in the last zombie it hit
      if (pend.pellets === 0) tracer(pend.from, pend.to, pend);
      pend.on = false;
    }
    if (flash.left > 0) {
      flash.left -= dt;
      const ml = lights.muzzle; ml.pos.copy(flash.pos); ml.t0 = clock.now - 0.012; // held near full for its time
      if (flash.left > 0 && G.lights && G.lights.setMuzzleFlash) G.lights.setMuzzleFlash(flash.pos, flash.level);
    }
    if (arcLamp.slot && (arcLamp.left -= dt) <= 0 && dt > 0) { lampFree(arcLamp.slot); arcLamp.slot = null; }
    if (dt <= 0) return;
    for (let i = 0; i < POOLS; i++) if (pools[i].on) burnPool(pools[i], dt);
    for (let i = 0; i < FLIGHTS; i++) if (flights[i].on) fly(flights[i], dt);
    for (let i = 0; i < CLOUDS; i++) if (clouds[i].on) gasCloud(clouds[i], dt);
  }
  function clear() {
    for (const p of pools) { p.on = false; lampFree(p.lamp); p.lamp = null; }
    for (const f of flights) { f.on = false; lampFree(f.lamp); f.lamp = null; }
    for (const c of clouds) c.on = false;
    pend.on = false; flash.left = 0; run = 0;
    if (arcLamp.slot) { lampFree(arcLamp.slot); arcLamp.slot = null; }
  }

  // ---- staged shots: fx=fx-explosion and friends. A sustained effect is run forward to `age` here,
  // because the stage pins the clock.
  const SV = { pos: new Vector3(), vel: new Vector3() };
  function stage(name, at, s, age) {
    const run = (fn) => { fn(); const t0 = clock.now; for (let t = 0; t < age; t += 1 / 60) { clock.now = t0 + t; update(1 / 60); } clock.now = t0; };
    let a;
    switch (name) {
      case 'fx-explosion': a = at('asphalt'); explosion(a.pos, 5 * s, 'frag'); break;
      case 'fx-firepool': a = at('asphalt'); run(() => firePool(a.pos, 2.8 * s, 8, 'molotov')); break;
      case 'fx-flare': a = at('asphalt'); run(() => firePool(a.pos, 3 * s, 6, 'flare')); break;
      case 'fx-flare-flight':
        a = at('muzzle');
        run(() => launch({ id: 1, pos: SV.pos.copy(a.pos), vel: SV.vel.copy(a.dir).normalize().multiplyScalar(14).setY(2), gravity: 3 }));
        break;
      case 'fx-arc': a = at('muzzle'); P.copy(a.pos); arc([Q.set(P.x + 2.2, P.y + 0.1, P.z - 0.3).clone(), Q.set(P.x + 3.4, P.y - 0.3, P.z + 0.9).clone(), Q.set(P.x + 4.6, P.y + 0.2, P.z - 0.6).clone()], P.clone()); break;
      case 'fx-cloud': a = at('asphalt'); run(() => startCloud(a.pos, 2.5 * s, 6)); break;
      case 'fx-tracer-burst':
        a = at('muzzle');
        for (let i = 0; i < 3; i++) { K.setDelay(i * 0.077 * 3); tracer(a.pos, Q.copy(a.pos).addScaledVector(a.dir, 40).add(A.set(0, rr(-0.4, 0.4), rr(-0.4, 0.4))), { upgraded: i === 2 }); }
        K.setDelay(0);
        break;
      case 'fx-pellets': {
        a = at('muzzle');
        const dirs = [];
        basis(D.copy(a.dir).normalize());
        for (let i = 0; i < 8; i++) { cone(D, 0.061); dirs.push(W.clone()); }
        pellets(a.pos, dirs);
        break;
      }
      case 'fx-gib': a = at('mist'); gib(a.pos, a.dir, 'arm'); stump(a.pos, a.dir); break;
      default: return false;
    }
    flash.left = Math.max(0, flash.left - age); // the clock is pinned: the flash is as old as the effect
    if (flash.left <= 0 && G.lights && G.lights.setMuzzleFlash) G.lights.setMuzzleFlash(null, 0);
    return true;
  }

  Object.assign(fx, { tracer, pellets, explosion, firePool, arc, flare, cloud: startCloud, gib, stump });
  return { update, clear, stage, pools, flights, clouds, lamps };
}
