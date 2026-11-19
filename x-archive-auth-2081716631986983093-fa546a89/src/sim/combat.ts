/**
 * COMBAT — target acquisition, hardpoint firing, ordnance flight, damage.
 *
 * This module owns everything between "a ship decides who to shoot" and "a hull
 * stops existing". It is a pure simulation system: it reads and mutates `World`
 * and raises `fire` / `hit` / `death` on the event bus for FX + audio, but never
 * touches render state.
 *
 * Responsibilities
 *   1. Threat-weighted target acquisition, modulated by `Stance`.
 *   2. Per-hardpoint cooldowns, bursts, traverse cones and lead-the-target aim.
 *   3. Projectile integration: dumb-fire, proportional-navigation homing, and
 *      ballistic plasma lobs, with continuous (non-tunnelling) collision.
 *   4. Ion beams: dwell timers, target tracking, damage-per-second.
 *   5. The damage pipeline: shields -> armour -> hull, with `vs` hull-size
 *      multipliers and researched damage/armour modifiers.
 *
 * PERFORMANCE CONTRACT
 *   Nothing in `stepCombat` allocates. All vector maths runs through module
 *   scope scalar scratch registers (the `_`-prefixed `let`s below) and every
 *   side table is preallocated to the `CONFIG` entity caps. Event payload
 *   objects are reused, which the bus explicitly permits for hot events.
 */

import { bus } from '../core/bus';
import { CONFIG } from '../core/config';
import { RESEARCH_BY_ID, SHIP_SPECS } from '../core/registry';
import {
  SHIP_CLASS_COUNT,
  ShipClass,
  Stance,
  Team,
  TEAM_COUNT,
  type GameEvents,
  type Hardpoint,
  type HullSize,
  type Projectile,
  type Ship,
  type ShipSpec,
  type WeaponKind,
  type WeaponSpec,
} from '../core/types';
import type { World } from './world';

// ---------------------------------------------------------------------------
// Tunables — feel lives here, not scattered through the code.
// ---------------------------------------------------------------------------

const TUNE = {
  /** Sim ticks between full target re-scans (staggered per ship id). */
  acquireInterval: 12,
  /** A held target is kept until it exceeds acquire range by this factor. */
  targetStickiness: 1.25,
  /** Half-angle of a fixed (non-turreted) mount's firing cone, radians. */
  fixedCone: 0.21,
  /** Extra cooldown per radian of off-axis aim, as a stand-in for turret slew. */
  slewPenalty: 0.09,
  /** Cap on the slew penalty so rear-arc turrets stay useful. */
  slewPenaltyMax: 0.3,
  /** Longest intercept lead we will solve for, seconds. */
  maxLead: 6,
  /** Proportional-navigation gain. 3..5 is the classic band; 3.6 curves nicely. */
  pnGain: 3.6,
  /** Downward acceleration applied to plasma bolts, m/s^2 (pure showmanship). */
  plasmaArc: 9,
  /** Seconds between throttled `hit` events from a sustained beam. */
  beamHitInterval: 0.085,
  /** Beam fade-in / fade-out ramps, seconds. */
  beamRampIn: 0.1,
  beamRampOut: 0.18,
  /** Ships above this bounding radius bypass the spatial hash (see BIG list). */
  bigRadius: 150,
  /** Shield sphere radius as a multiple of the hull bounding radius. */
  shieldScale: 1.14,
  /** Fraction of damage armour can never remove — prevents stalemates. */
  armourFloor: 0.1,
  /** Angular spread applied to unguided kinetic weapons, radians. */
  spread: 0.006,
} as const;

const HULL_SIZE_COUNT = 6;

/** Projectile collision radius by weapon kind, metres. */
function projRadius(kind: WeaponKind): number {
  switch (kind) {
    case 'torpedo': return 5;
    case 'missile': return 3;
    case 'plasma': return 4;
    case 'flak': return 3;
    default: return 1.5;
  }
}

// ---------------------------------------------------------------------------
// Precomputed per-class tables (built once at module load, never mutated).
// ---------------------------------------------------------------------------

/** Longest weapon range on each hull class, metres. 0 = unarmed. */
const CLASS_MAX_RANGE = new Float32Array(SHIP_CLASS_COUNT);
/** Best `vs` multiplier class C can bring against hull size S: [C*6 + S]. */
const CLASS_BEST_VS = new Float32Array(SHIP_CLASS_COUNT * HULL_SIZE_COUNT);

for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
  const sp: ShipSpec | undefined = SHIP_SPECS[c as ShipClass];
  if (!sp) continue;
  let maxRange = 0;
  for (let s = 0; s < HULL_SIZE_COUNT; s++) CLASS_BEST_VS[c * HULL_SIZE_COUNT + s] = 0;
  for (let w = 0; w < sp.weapons.length; w++) {
    const wp = sp.weapons[w];
    if (wp.kind === 'none') continue;
    if (wp.range > maxRange) maxRange = wp.range;
    for (let s = 0; s < HULL_SIZE_COUNT; s++) {
      const m = wp.vs ? (wp.vs[s as HullSize] ?? 1) : 1;
      const k = c * HULL_SIZE_COUNT + s;
      if (m > CLASS_BEST_VS[k]) CLASS_BEST_VS[k] = m;
    }
  }
  CLASS_MAX_RANGE[c] = maxRange;
}

// ---------------------------------------------------------------------------
// Preallocated side tables
// ---------------------------------------------------------------------------

/** Max hardpoints any hull in the registry mounts; sized with headroom. */
const MAX_HARDPOINTS = 32;

/** Rounds already fired in the current burst, per (ship, hardpoint). */
const BURST_COUNT = new Uint8Array(CONFIG.maxShips * MAX_HARDPOINTS);

/** Live beam bookkeeping the `Beam` struct has no room for, indexed by beam id. */
const BEAM_TARGET = new Int32Array(CONFIG.maxBeams);
const BEAM_HARDPOINT = new Int16Array(CONFIG.maxBeams);
const BEAM_WEAPON = new Int16Array(CONFIG.maxBeams);
const BEAM_DWELL = new Float32Array(CONFIG.maxBeams);
const BEAM_HITT = new Float32Array(CONFIG.maxBeams);
const BEAM_ACC = new Float32Array(CONFIG.maxBeams);

/** Ships too large for the uniform hash to bucket sanely; rebuilt each step. */
const BIG_LIST = new Int32Array(CONFIG.maxShips);
let bigCount = 0;

/** Reusable neighbour-query result buffer. Never shrinks below its high water. */
const QUERY: number[] = [];

/** Researched combat modifiers, refreshed when a faction's research set grows. */
const MOD_DAMAGE = new Float32Array(TEAM_COUNT).fill(1);
const MOD_ARMOUR = new Float32Array(TEAM_COUNT).fill(1);
const MOD_SHIELD = new Float32Array(TEAM_COUNT).fill(1);
const MOD_COUNT = new Int32Array(TEAM_COUNT).fill(-1);
let modWorld: World | null = null;

// ---------------------------------------------------------------------------
// Reused event payloads (the bus documents that hot events reuse their payload).
// ---------------------------------------------------------------------------

const EV_FIRE: GameEvents['fire'] = {
  x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, kind: 'pulse', team: Team.Neutral, scale: 1,
};
const EV_HIT: GameEvents['hit'] = {
  x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 'pulse', shielded: false,
  team: Team.Neutral, scale: 1,
};
const EV_DEATH: GameEvents['death'] = {
  id: -1, cls: ShipClass.Scout, team: Team.Neutral,
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 1,
};

// ---------------------------------------------------------------------------
// Scalar scratch registers. Helper functions write their results here instead
// of returning objects — that is what keeps the hot loop allocation free.
// ---------------------------------------------------------------------------

/** Starboard basis vector of the ship currently being processed. */
let RGX = 1, RGY = 0, RGZ = 0;
/** Output of `localToWorld`. */
let _wx = 0, _wy = 0, _wz = 0;
/** Output of `dirToWorld`. */
let _dx = 0, _dy = 0, _dz = 0;
/** Output of `dirToLocal`. */
let _lx = 0, _ly = 0, _lz = 0;
/** Output of `aimAt` — unit aim direction plus the solved flight time. */
let _ax = 0, _ay = 0, _az = 0, _at = 0;

// ---------------------------------------------------------------------------
// Basis helpers — LOCAL SPACE is +Z forward, +Y up, +X starboard, and the
// instance basis is [right, up, fwd] with right = up x fwd (see registry.ts).
// ---------------------------------------------------------------------------

/** Cache the starboard vector of `s` into RGX/RGY/RGZ. Call once per ship. */
function setBasis(s: Ship): void {
  RGX = s.up.y * s.fwd.z - s.up.z * s.fwd.y;
  RGY = s.up.z * s.fwd.x - s.up.x * s.fwd.z;
  RGZ = s.up.x * s.fwd.y - s.up.y * s.fwd.x;
}

/** Local point -> world point, using the cached basis. Result in _wx/_wy/_wz. */
function localToWorld(s: Ship, lx: number, ly: number, lz: number): void {
  _wx = s.pos.x + RGX * lx + s.up.x * ly + s.fwd.x * lz;
  _wy = s.pos.y + RGY * lx + s.up.y * ly + s.fwd.y * lz;
  _wz = s.pos.z + RGZ * lx + s.up.z * ly + s.fwd.z * lz;
}

/** Local direction -> world direction. Result in _dx/_dy/_dz. */
function dirToWorld(s: Ship, lx: number, ly: number, lz: number): void {
  _dx = RGX * lx + s.up.x * ly + s.fwd.x * lz;
  _dy = RGY * lx + s.up.y * ly + s.fwd.y * lz;
  _dz = RGZ * lx + s.up.z * ly + s.fwd.z * lz;
}

/** World direction -> local direction (basis is orthonormal, so transpose). */
function dirToLocal(s: Ship, wx: number, wy: number, wz: number): void {
  _lx = RGX * wx + RGY * wy + RGZ * wz;
  _ly = s.up.x * wx + s.up.y * wy + s.up.z * wz;
  _lz = s.fwd.x * wx + s.fwd.y * wy + s.fwd.z * wz;
}

// ---------------------------------------------------------------------------
// Research modifiers
// ---------------------------------------------------------------------------

/**
 * Recompute the cached per-faction damage/armour/shield multipliers when a
 * research set has changed. Research only ever grows, so comparing set size is
 * sufficient within one world; a world swap forces a full refresh.
 */
function refreshMods(world: World): void {
  const force = modWorld !== world;
  modWorld = world;
  for (let t = 0; t < TEAM_COUNT; t++) {
    const f = world.factions[t];
    if (!f) continue;
    if (!force && MOD_COUNT[t] === f.research.size) continue;
    MOD_COUNT[t] = f.research.size;
    let dmg = 1, arm = 1, shd = 1;
    for (const id of f.research) {
      const r = RESEARCH_BY_ID.get(id);
      if (!r || !r.mods) continue;
      if (r.mods.damage) dmg *= r.mods.damage;
      if (r.mods.armour) arm *= r.mods.armour;
      if (r.mods.shield) shd *= r.mods.shield;
    }
    MOD_DAMAGE[t] = dmg;
    MOD_ARMOUR[t] = arm;
    MOD_SHIELD[t] = shd;
  }
}

// ---------------------------------------------------------------------------
// Aiming maths
// ---------------------------------------------------------------------------

/**
 * Solve the intercept quadratic |R + V*t| = speed*t for the earliest positive
 * root, where R is the muzzle->target offset and V the target velocity.
 * Returns the flight time, or -1 when the target simply cannot be caught.
 */
function interceptTime(
  rx: number, ry: number, rz: number,
  vx: number, vy: number, vz: number,
  speed: number,
): number {
  const a = vx * vx + vy * vy + vz * vz - speed * speed;
  const b = 2 * (rx * vx + ry * vy + rz * vz);
  const c = rx * rx + ry * ry + rz * rz;
  if (c <= 1e-6) return 0;
  if (Math.abs(a) < 1e-4) {
    // Degenerate case: target flees at exactly muzzle speed -> linear solution.
    if (b >= -1e-6) return -1;
    return -c / b;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const inv = 0.5 / a;
  const t1 = (-b - sq) * inv;
  const t2 = (-b + sq) * inv;
  let t = -1;
  if (t1 > 0 && t2 > 0) t = Math.min(t1, t2);
  else if (t1 > 0) t = t1;
  else if (t2 > 0) t = t2;
  return t;
}

/**
 * Produce a unit aim direction from a muzzle toward a moving target, leading it
 * when the weapon has a finite muzzle speed. Writes _ax/_ay/_az (unit) and _at
 * (flight time, 0 for instant-hit weapons). Returns false when no shot exists.
 */
function aimAt(
  mx: number, my: number, mz: number,
  tx: number, ty: number, tz: number,
  tvx: number, tvy: number, tvz: number,
  speed: number,
): boolean {
  let rx = tx - mx, ry = ty - my, rz = tz - mz;
  let t = 0;
  if (speed > 1) {
    t = interceptTime(rx, ry, rz, tvx, tvy, tvz, speed);
    // No closed-form intercept (target outruns the round, or the lead is
    // absurd): fall back to a first-order lead so we still take the shot.
    if (t < 0 || t > TUNE.maxLead) t = Math.min(TUNE.maxLead, Math.sqrt(rx * rx + ry * ry + rz * rz) / speed);
    rx += tvx * t; ry += tvy * t; rz += tvz * t;
  }
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (len < 1e-4) return false;
  const inv = 1 / len;
  _ax = rx * inv; _ay = ry * inv; _az = rz * inv;
  _at = t;
  return true;
}

/**
 * Traverse test in LOCAL space: can the mount actually bring `aim` (a world
 * direction) to bear without firing through its own hull?
 *
 * A hardpoint's rest direction defines a frame; the aim vector is decomposed
 * into yaw (around the mount's local up) and pitch (elevation) and rejected if
 * either exceeds the spec cone. Returns the absolute angular offset from the
 * rest direction in radians, or -1 on rejection. Requires `setBasis` first.
 */
function traverseOffset(s: Ship, h: Hardpoint, w: WeaponSpec, ax: number, ay: number, az: number): number {
  dirToLocal(s, ax, ay, az);
  const lx = _lx, ly = _ly, lz = _lz;
  const fx = h.dir[0], fy = h.dir[1], fz = h.dir[2];
  const dot = lx * fx + ly * fy + lz * fz;
  const off = Math.acos(Math.max(-1, Math.min(1, dot)));

  if (!w.traverse) return off <= TUNE.fixedCone ? off : -1;

  // Build an orthonormal frame around the mount's rest direction. The helper
  // axis flips near the poles so the cross product never degenerates.
  // helper = (0, hy, hz), r = helper x f.
  const hy = Math.abs(fy) > 0.95 ? 0 : 1;
  const hz = hy === 0 ? 1 : 0;
  let rx = hy * fz - hz * fy;
  let ry = hz * fx;
  let rz = -hy * fx;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl < 1e-5) return off <= TUNE.fixedCone ? off : -1;
  rx /= rl; ry /= rl; rz /= rl;
  // u = f x r  (completes the right-handed frame)
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;

  const df = dot;
  const dr = lx * rx + ly * ry + lz * rz;
  const du = lx * ux + ly * uy + lz * uz;
  const yaw = Math.atan2(dr, df);
  const pitch = Math.atan2(du, Math.sqrt(df * df + dr * dr));
  if (Math.abs(yaw) > w.traverse.yaw) return -1;
  if (Math.abs(pitch) > w.traverse.pitch) return -1;
  return off;
}

// ---------------------------------------------------------------------------
// Target acquisition
// ---------------------------------------------------------------------------

/**
 * Score a candidate as a target for `s`. Higher is better. The score folds in
 * how hard we hit that hull size, how dangerous the candidate is to us, how far
 * away it is, and how close to death it already is (finish the wounded).
 */
function score(s: Ship, c: Ship, dist: number, range: number): number {
  const cSpec = SHIP_SPECS[c.cls];
  const sSpec = SHIP_SPECS[s.cls];
  const ourVs = CLASS_BEST_VS[s.cls * HULL_SIZE_COUNT + cSpec.size];
  const theirVs = CLASS_BEST_VS[c.cls * HULL_SIZE_COUNT + sSpec.size];
  // Clamped: hp may legitimately sit outside 0..maxHp (scripted invulnerables,
  // over-healed hulls) and an unclamped term would invert the whole score.
  const wounded = Math.max(0, Math.min(1, 1 - c.hp / cSpec.maxHp));
  const near = 1 - 0.6 * Math.min(1, dist / range);
  return ourVs * (0.55 + 0.45 * theirVs) * near * (1 + 0.35 * wounded);
}

/**
 * Threat-weighted acquisition. Scans the coarse hash rather than taking the
 * literal nearest hull so a flak turret prefers the fighter over the frigate
 * parked next to it; `World.nearestEnemy` is the fallback when the weighted
 * scan comes up empty (e.g. every candidate scored zero).
 */
function acquire(world: World, s: Ship, range: number): number {
  const out = QUERY;
  out.length = 0;
  world.coarse.query(s.pos.x, s.pos.y, s.pos.z, range, out);
  let best = -1;
  let bestScore = 0;
  const r2 = range * range;
  for (let i = 0; i < out.length; i++) {
    const c = world.ships.items[out[i]];
    if (!c || !c.alive || c.team === s.team || c.team === Team.Neutral) continue;
    if (c.dockedIn >= 0) continue;
    const dx = c.pos.x - s.pos.x, dy = c.pos.y - s.pos.y, dz = c.pos.z - s.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const sc = score(s, c, Math.sqrt(d2), range);
    if (sc > bestScore) { bestScore = sc; best = c.id; }
  }
  if (best < 0) best = world.nearestEnemy(s.pos.x, s.pos.y, s.pos.z, s.team, range);
  return best;
}

/** True if `id` is a live, undocked hull hostile to `team`. */
function validEnemy(world: World, id: number, team: Team): boolean {
  if (id < 0) return false;
  const t = world.ships.get(id);
  return !!t && t.team !== team && t.team !== Team.Neutral && t.dockedIn < 0;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

/** Muzzle-flash / impact scale heuristic, so FX reads weapon weight for free. */
function fxScale(w: WeaponSpec, hpSize: number): number {
  const dmg = Math.min(4, Math.pow(Math.max(1, w.damage), 0.34));
  return Math.max(0.5, dmg * 0.7 + hpSize * 0.55);
}

/**
 * Resolve one hardpoint for one ship: cooldown, cone, lead, spawn, event.
 * Returns true if a shot was taken. `setBasis(s)` must already be current.
 */
function fireHardpoint(
  world: World, s: Ship, i: number, h: Hardpoint, w: WeaponSpec, tgt: Ship, dt: number,
): boolean {
  const burstIdx = s.id * MAX_HARDPOINTS + i;

  if (s.cool[i] > 0) {
    s.cool[i] -= dt;
    return false;
  }

  localToWorld(s, h.pos[0], h.pos[1], h.pos[2]);
  const mx = _wx, my = _wy, mz = _wz;

  const dx = tgt.pos.x - mx, dy = tgt.pos.y - my, dz = tgt.pos.z - mz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > w.range) return false;

  const speed = w.kind === 'ion' ? 0 : w.speed;
  if (!aimAt(mx, my, mz, tgt.pos.x, tgt.pos.y, tgt.pos.z, tgt.vel.x, tgt.vel.y, tgt.vel.z, speed)) return false;
  let ax = _ax, ay = _ay, az = _az;
  const flight = _at;

  const off = traverseOffset(s, h, w, ax, ay, az);
  if (off < 0) {
    // Cannot bear: recycle the burst so the next engagement starts clean.
    BURST_COUNT[burstIdx] = 0;
    return false;
  }

  // Kinetic weapons get a whisker of spread so massed fire reads as a cone of
  // tracers rather than a laser-straight line. Deterministic via world.rng.
  if (w.kind === 'pulse' || w.kind === 'massdriver' || w.kind === 'flak') {
    const sx = world.rng.sign() * TUNE.spread;
    const sy = world.rng.sign() * TUNE.spread;
    ax += RGX * sx + s.up.x * sy;
    ay += RGY * sx + s.up.y * sy;
    az += RGZ * sx + s.up.z * sy;
    const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= l; ay /= l; az /= l;
  }

  // --- commit the shot ---------------------------------------------------
  const scale = fxScale(w, h.size ?? 0);
  EV_FIRE.x = mx; EV_FIRE.y = my; EV_FIRE.z = mz;
  EV_FIRE.dx = ax; EV_FIRE.dy = ay; EV_FIRE.dz = az;
  EV_FIRE.kind = w.kind;
  EV_FIRE.team = s.team;
  EV_FIRE.scale = scale;
  bus.emit('fire', EV_FIRE);

  if (w.kind === 'ion') spawnBeam(world, s, i, h, w, tgt, mx, my, mz);
  else spawnBolt(world, s, w, h, tgt, mx, my, mz, ax, ay, az, flight);

  // --- recycle -----------------------------------------------------------
  const n = BURST_COUNT[burstIdx] + 1;
  const slew = w.traverse
    ? Math.min(TUNE.slewPenaltyMax, off * TUNE.slewPenalty / Math.max(0.2, w.traverse.speed))
    : 0;
  if (!w.burst) {
    s.cool[i] = 1 / w.rate + slew;
  } else if (n >= w.burst) {
    // Magazine empty: fall into the long recycle gap.
    BURST_COUNT[burstIdx] = 0;
    s.cool[i] = (w.burstGap ?? 1 / w.rate) + slew;
  } else {
    BURST_COUNT[burstIdx] = n;
    s.cool[i] = 1 / w.rate + slew;
  }
  return true;
}

/** Spawn a projectile for every non-beam weapon kind. */
function spawnBolt(
  world: World, s: Ship, w: WeaponSpec, h: Hardpoint, tgt: Ship,
  mx: number, my: number, mz: number,
  ax: number, ay: number, az: number, flight: number,
): void {
  const p = world.spawnProjectile();
  if (!p) return;
  p.kind = w.kind;
  p.team = s.team;
  p.owner = s.id;
  p.damage = w.damage;
  p.splash = w.splash ?? 0;
  p.turn = w.turn ?? 0;
  p.seed = world.rng.next();
  p.vs = w.vs;
  p.pos.set(mx, my, mz);

  const homing = w.kind === 'missile' || w.kind === 'torpedo';
  if (homing) {
    // Launch along the barrel and let proportional navigation reel the target
    // in — that is what produces the long curved trails instead of a straight
    // line drawn from muzzle to victim.
    dirToWorld(s, h.dir[0], h.dir[1], h.dir[2]);
    p.vel.set(_dx * w.speed, _dy * w.speed, _dz * w.speed);
    p.target = tgt.id;
    p.ttl = Math.min(20, (w.range / w.speed) * 2.2);
  } else {
    p.vel.set(ax * w.speed, ay * w.speed, az * w.speed);
    p.target = -1;
    p.ttl = (w.range / w.speed) * 1.25 + 0.15;
    // Ballistic lob: pre-compensate the arc so the drop still lands on target.
    if (w.kind === 'plasma') p.vel.y += 0.5 * TUNE.plasmaArc * flight;
  }
}

/** Spawn a sustained ion beam and register its bookkeeping. */
function spawnBeam(
  world: World, s: Ship, hpIndex: number, h: Hardpoint, w: WeaponSpec, tgt: Ship,
  mx: number, my: number, mz: number,
): void {
  const b = world.spawnBeam();
  if (!b) return;
  b.team = s.team;
  b.owner = s.id;
  b.seed = world.rng.next();
  b.intensity = 0;
  b.ttl = w.beamDwell ?? 1;
  b.width = Math.max(1.2, (h.size ?? 1) * 0.55);
  b.from.set(mx, my, mz);
  b.to.copy(tgt.pos);
  BEAM_TARGET[b.id] = tgt.id;
  BEAM_HARDPOINT[b.id] = hpIndex;
  BEAM_WEAPON[b.id] = h.weapon;
  BEAM_DWELL[b.id] = b.ttl;
  BEAM_HITT[b.id] = 0;
  BEAM_ACC[b.id] = 0;
}

// ---------------------------------------------------------------------------
// Stance + per-ship combat tick
// ---------------------------------------------------------------------------

/**
 * Apply stance-driven order pressure. Combat only ever writes AUTO orders: a
 * manual (player) order is never overwritten, and neither is an AI order of a
 * kind combat does not own (harvest, dock, move-to-rally...).
 */
function applyStance(world: World, s: Ship, tgtId: number, weaponRange: number): void {
  const o = s.order;
  if (o.manual) return;
  // Combat only ever authors 'idle' <-> 'attack' (and 'move' when fleeing).
  // Anything else on the order slot belongs to another system: leave it alone.
  if (o.kind !== 'idle' && o.kind !== 'attack' && o.kind !== 'move') return;

  if (s.stance === Stance.Evasive) {
    if (tgtId < 0) return;
    const t = world.ships.get(tgtId);
    if (!t) return;
    // Re-plot the escape vector only on the acquire beat — recomputing it every
    // tick would jitter the heading and make the flight model twitch.
    if (o.kind === 'move' && (world.tick + s.id) % TUNE.acquireInterval !== 0) return;
    let fx = s.pos.x - t.pos.x, fy = s.pos.y - t.pos.y, fz = s.pos.z - t.pos.z;
    const l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= l; fy /= l; fz /= l;
    o.kind = 'move';
    o.target = undefined;
    o.x = s.pos.x + fx * CONFIG.autoAcquireRange;
    o.y = s.pos.y + fy * CONFIG.autoAcquireRange;
    o.z = s.pos.z + fz * CONFIG.autoAcquireRange;
    return;
  }

  if (s.stance !== Stance.Aggressive) {
    // Neutral and Passive hold station and shoot from where they stand. Only
    // clean up an auto-attack whose victim no longer exists.
    if (o.kind === 'attack' && !o.manual && !validEnemy(world, o.target ?? -1, s.team)) {
      o.kind = 'idle';
      o.target = undefined;
    }
    return;
  }

  // Aggressive: break formation and close until the guns bear.
  if (tgtId < 0) {
    if (o.kind === 'attack' && !o.manual && !validEnemy(world, o.target ?? -1, s.team)) {
      o.kind = 'idle';
      o.target = undefined;
    }
    return;
  }
  if (o.kind === 'move') return; // an auto move order outranks pursuit
  const t = world.ships.get(tgtId);
  if (!t) return;
  const dx = t.pos.x - s.pos.x, dy = t.pos.y - s.pos.y, dz = t.pos.z - s.pos.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const hold = weaponRange * 0.85;
  if (d2 > hold * hold) {
    o.kind = 'attack';
    o.target = tgtId;
  } else if (o.kind === 'attack' && !o.manual && o.target === tgtId) {
    // In the pocket — stop chasing so the flight model can hold the firing arc.
    o.kind = 'idle';
    o.target = undefined;
  }
}

/** Targeting + firing for every armed hull. */
function stepTargeting(world: World, dt: number): void {
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s || !s.alive || s.dockedIn >= 0 || s.launchT > 0) continue;
    const sp = SHIP_SPECS[s.cls];
    const nHp = sp.hardpoints.length;
    if (nHp === 0) continue;

    // Capitals must be allowed to use their reach; the config value is a floor.
    const range = Math.max(CONFIG.autoAcquireRange, CLASS_MAX_RANGE[s.cls]);

    // --- pick a target --------------------------------------------------
    let tgtId = -1;
    const o = s.order;
    if (o.kind === 'attack' && o.manual && o.target !== undefined) {
      if (validEnemy(world, o.target, s.team)) tgtId = o.target;
      else { o.kind = 'idle'; o.target = undefined; }
    }

    if (tgtId < 0 && s.stance !== Stance.Passive) {
      const keep = validEnemy(world, s.target, s.team);
      if (keep) {
        const t = world.ships.items[s.target];
        const dx = t.pos.x - s.pos.x, dy = t.pos.y - s.pos.y, dz = t.pos.z - s.pos.z;
        const lim = range * TUNE.targetStickiness;
        if (dx * dx + dy * dy + dz * dz <= lim * lim) tgtId = s.target;
      }
      // Staggered rescan: one twelfth of the fleet re-evaluates per tick.
      if (tgtId < 0 || (world.tick + s.id) % TUNE.acquireInterval === 0) {
        const found = acquire(world, s, range);
        if (found >= 0) tgtId = found;
      }
    }

    s.target = tgtId;
    applyStance(world, s, tgtId, CLASS_MAX_RANGE[s.cls] || range);

    // --- run the guns ---------------------------------------------------
    if (s.stance === Stance.Passive || tgtId < 0) {
      for (let k = 0; k < nHp && k < s.cool.length; k++) {
        if (s.cool[k] > 0) s.cool[k] -= dt;
        else BURST_COUNT[s.id * MAX_HARDPOINTS + k] = 0;
      }
      continue;
    }

    const tgt = world.ships.items[tgtId];
    setBasis(s);
    for (let k = 0; k < nHp && k < MAX_HARDPOINTS; k++) {
      const h = sp.hardpoints[k];
      const w = sp.weapons[h.weapon];
      if (!w || w.kind === 'none') continue;
      fireHardpoint(world, s, k, h, w, tgt, dt);
    }
  }
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

/** Advance every live beam: track, damage, ramp, expire. */
function stepBeams(world: World, dt: number): void {
  const beams = world.beams;
  for (let i = 0; i < beams.count; i++) {
    const b = beams.items[i];
    if (!b || !b.alive) continue;

    b.ttl -= dt;
    if (b.ttl <= 0) { beams.kill(b.id); continue; }

    const owner = world.ships.get(b.owner);
    const tgt = world.ships.get(BEAM_TARGET[b.id]);
    if (!owner || !tgt) {
      // Lost the shooter or the victim: snap into a short fade-out.
      if (b.ttl > TUNE.beamRampOut) b.ttl = TUNE.beamRampOut;
      b.intensity = Math.min(b.intensity, b.ttl / TUNE.beamRampOut);
      continue;
    }

    const sp = SHIP_SPECS[owner.cls];
    const h = sp.hardpoints[BEAM_HARDPOINT[b.id]];
    const w = sp.weapons[BEAM_WEAPON[b.id]];
    if (!h || !w) { beams.kill(b.id); continue; }

    setBasis(owner);
    localToWorld(owner, h.pos[0], h.pos[1], h.pos[2]);
    b.from.set(_wx, _wy, _wz);

    let dx = tgt.pos.x - _wx, dy = tgt.pos.y - _wy, dz = tgt.pos.z - _wz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dist; dy /= dist; dz /= dist;

    // Out of range or swung outside the traverse cone -> cut the beam.
    if (dist > w.range * 1.1 || traverseOffset(owner, h, w, dx, dy, dz) < 0) {
      if (b.ttl > TUNE.beamRampOut) b.ttl = TUNE.beamRampOut;
      continue;
    }

    // Terminate the beam on the hull surface (or the shield shell) so the FX
    // layer does not have to guess where the impact sits.
    const tSpec = SHIP_SPECS[tgt.cls];
    const stop = tgt.shield > 0 ? tSpec.radius * TUNE.shieldScale : tSpec.radius * 0.72;
    b.to.set(tgt.pos.x - dx * stop, tgt.pos.y - dy * stop, tgt.pos.z - dz * stop);

    // Ramp: fade in at the head of the dwell, out at the tail.
    const elapsed = BEAM_DWELL[b.id] - b.ttl;
    const inK = Math.min(1, elapsed / TUNE.beamRampIn);
    const outK = Math.min(1, b.ttl / TUNE.beamRampOut);
    b.intensity = Math.min(inK, outK);

    // `WeaponSpec.damage` is damage-per-SECOND for ion. Pool it and flush on a
    // throttle: the hull loses the same total either way, but FX gets a steady
    // drip of impact sparks instead of sixty events a second.
    BEAM_ACC[b.id] += w.damage * dt * b.intensity;
    BEAM_HITT[b.id] += dt;
    if (BEAM_HITT[b.id] >= TUNE.beamHitInterval) {
      BEAM_HITT[b.id] -= TUNE.beamHitInterval;
      const acc = BEAM_ACC[b.id];
      BEAM_ACC[b.id] = 0;
      damage(world, tgt.id, acc, 'ion', b.to.x, b.to.y, b.to.z, owner.id, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

/**
 * Proportional navigation. The command acceleration is
 *   a = N * Vc * (omega x vHat),   omega = (R x Vr) / (R . R)
 * i.e. the missile turns to null the line-of-sight rotation rate rather than
 * chasing the target's current position. That is what makes the trail lead the
 * target and sweep in a smooth arc instead of snaking behind it.
 */
function guide(
  p: Projectile,
  tx: number, ty: number, tz: number,
  tvx: number, tvy: number, tvz: number,
  dt: number,
): void {
  const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (sp < 1e-3) return;
  const ux = vx / sp, uy = vy / sp, uz = vz / sp;

  const rx = tx - p.pos.x, ry = ty - p.pos.y, rz = tz - p.pos.z;
  const r2 = rx * rx + ry * ry + rz * rz;
  if (r2 < 1) return;
  const rlen = Math.sqrt(r2);

  const vrx = tvx - vx, vry = tvy - vy, vrz = tvz - vz;
  // omega = (R x Vr) / |R|^2
  const ox = (ry * vrz - rz * vry) / r2;
  const oy = (rz * vrx - rx * vrz) / r2;
  const oz = (rx * vry - ry * vrx) / r2;
  // Closing speed, floored so a receding target does not invert the command.
  let vc = -(rx * vrx + ry * vry + rz * vrz) / rlen;
  if (vc < sp * 0.3) vc = sp * 0.3;

  const n = TUNE.pnGain * vc;
  const ax = n * (oy * uz - oz * uy);
  const ay = n * (oz * ux - ox * uz);
  const az = n * (ox * uy - oy * ux);

  let nx = vx + ax * dt, ny = vy + ay * dt, nz = vz + az * dt;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-4) return;
  nx /= nl; ny /= nl; nz /= nl;

  // Clamp the heading change to the airframe's turn rate via an exact slerp.
  const cosA = Math.max(-1, Math.min(1, ux * nx + uy * ny + uz * nz));
  const maxA = p.turn * dt;
  if (cosA < Math.cos(maxA)) {
    const A = Math.acos(cosA);
    const sinA = Math.sin(A);
    if (sinA > 1e-5) {
      const k0 = Math.sin(A - maxA) / sinA;
      const k1 = Math.sin(maxA) / sinA;
      nx = ux * k0 + nx * k1;
      ny = uy * k0 + ny * k1;
      nz = uz * k0 + nz * k1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
  }
  p.vel.x = nx * sp; p.vel.y = ny * sp; p.vel.z = nz * sp;
}

/**
 * Ray/sphere entry parameter along a unit-direction segment, or -1 for a miss.
 * Solving for the ENTRY point (not the closest approach) keeps impact FX on the
 * facing side of the hull, and clamping t to 0 handles spawn-inside cases.
 */
function segmentSphere(
  px: number, py: number, pz: number,
  dx: number, dy: number, dz: number, segLen: number,
  cx: number, cy: number, cz: number, rad: number,
): number {
  const mx = px - cx, my = py - cy, mz = pz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - rad * rad;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= segLen ? t : -1;
}

/** Integrate, guide and collide every live projectile. */
function stepProjectiles(world: World, dt: number): void {
  const pool = world.projectiles;
  for (let i = 0; i < pool.count; i++) {
    const p = pool.items[i];
    if (!p || !p.alive) continue;

    p.ttl -= dt;
    if (p.ttl <= 0) { pool.kill(p.id); continue; }

    // --- guidance -------------------------------------------------------
    if (p.target >= 0) {
      const t = world.ships.get(p.target);
      if (t) guide(p, t.pos.x, t.pos.y, t.pos.z, t.vel.x, t.vel.y, t.vel.z, dt);
      else p.target = -1; // lost lock: fly on ballistically
    } else if (p.kind === 'plasma') {
      p.vel.y -= TUNE.plasmaArc * dt;
    }

    // --- integrate ------------------------------------------------------
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    const mx = p.vel.x * dt, my = p.vel.y * dt, mz = p.vel.z * dt;
    const segLen = Math.sqrt(mx * mx + my * my + mz * mz);
    p.pos.x = px + mx; p.pos.y = py + my; p.pos.z = pz + mz;
    if (segLen < 1e-5) continue;
    const dx = mx / segLen, dy = my / segLen, dz = mz / segLen;

    // --- continuous collision -------------------------------------------
    // Swept sphere against every hull whose bucket the segment touches, plus
    // the big-hull list (capitals are far larger than the hash cell, so the
    // uniform grid cannot be trusted to bucket them near a passing round).
    const pr = projRadius(p.kind);
    const hx = px + mx * 0.5, hy = py + my * 0.5, hz = pz + mz * 0.5;
    const out = QUERY;
    out.length = 0;
    world.hash.query(hx, hy, hz, segLen * 0.5 + TUNE.bigRadius * 2, out);

    let hitId = -1;
    let hitT = segLen + 1;
    for (let k = 0; k < out.length; k++) {
      const c = world.ships.items[out[k]];
      if (!c || !c.alive || c.id === p.owner || c.team === p.team || c.dockedIn >= 0) continue;
      const cr = SHIP_SPECS[c.cls].radius;
      if (cr > TUNE.bigRadius) continue; // handled by the big list below
      const t = segmentSphere(px, py, pz, dx, dy, dz, segLen, c.pos.x, c.pos.y, c.pos.z, cr + pr);
      if (t >= 0 && t < hitT) { hitT = t; hitId = c.id; }
    }
    for (let k = 0; k < bigCount; k++) {
      const c = world.ships.items[BIG_LIST[k]];
      if (!c || !c.alive || c.id === p.owner || c.team === p.team) continue;
      const cr = SHIP_SPECS[c.cls].radius;
      const t = segmentSphere(px, py, pz, dx, dy, dz, segLen, c.pos.x, c.pos.y, c.pos.z, cr + pr);
      if (t >= 0 && t < hitT) { hitT = t; hitId = c.id; }
    }
    if (hitId < 0) continue;

    // --- detonate --------------------------------------------------------
    const ix = px + dx * hitT, iy = py + dy * hitT, iz = pz + dz * hitT;
    damage(world, hitId, p.damage, p.kind, ix, iy, iz, p.owner, true);
    if (p.splash > 0) splash(world, hitId, p.damage, p.kind, ix, iy, iz, p.owner, p.splash);
    pool.kill(p.id);
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/** The `vs` table of the first weapon of `kind` mounted by the shooter. */
function vsMultiplier(world: World, ownerId: number, kind: WeaponKind, size: HullSize): number {
  const o = world.ships.get(ownerId);
  if (!o) return 1;
  const sp = SHIP_SPECS[o.cls];
  for (let i = 0; i < sp.weapons.length; i++) {
    const w = sp.weapons[i];
    if (w.kind !== kind) continue;
    return w.vs ? (w.vs[size] ?? 1) : 1;
  }
  return 1;
}

/**
 * Full damage resolution against one hull.
 *
 * Pipeline: `vs` hull-size multiplier -> researched damage mod -> shields
 * (which emit their own impact on the shield shell) -> flat armour with a floor
 * -> hull. Sets `sinceHit` and bumps the visual damage accumulator, and raises
 * `death` + `World.killShip` when the hull is gone.
 *
 * `emit` is internal-only: sustained beams call in every step but only surface
 * a `hit` event on their throttle.
 */
function damage(
  world: World, targetId: number, amount: number, kind: WeaponKind,
  hx: number, hy: number, hz: number, ownerId: number, emit: boolean,
): void {
  const t = world.ships.get(targetId);
  if (!t) return;
  if (amount <= 0) return;

  const tSpec = SHIP_SPECS[t.cls];
  const owner = world.ships.get(ownerId);
  const shooterTeam = owner ? owner.team : t.team;

  let dmg = amount * vsMultiplier(world, ownerId, kind, tSpec.size) * MOD_DAMAGE[shooterTeam];

  t.sinceHit = 0;

  // --- shields ----------------------------------------------------------
  if (t.shield > 0) {
    const absorbed = Math.min(t.shield, dmg);
    t.shield -= absorbed;
    dmg -= absorbed;
    if (emit) {
      // Project the impact onto the shield shell rather than the hull, so the
      // FX layer can splash a bubble ripple at the right radius.
      let nx = hx - t.pos.x, ny = hy - t.pos.y, nz = hz - t.pos.z;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-4) { nx = 0; ny = 1; nz = 0; }
      else { nx /= l; ny /= l; nz /= l; }
      const r = tSpec.radius * TUNE.shieldScale;
      EV_HIT.x = t.pos.x + nx * r; EV_HIT.y = t.pos.y + ny * r; EV_HIT.z = t.pos.z + nz * r;
      EV_HIT.nx = nx; EV_HIT.ny = ny; EV_HIT.nz = nz;
      EV_HIT.kind = kind;
      EV_HIT.shielded = true;
      EV_HIT.team = shooterTeam;
      EV_HIT.scale = Math.max(0.4, Math.min(7, Math.sqrt(absorbed) * 0.45));
      bus.emit('hit', EV_HIT);
    }
    if (dmg <= 0) return;
  }

  // --- armour -----------------------------------------------------------
  const armour = tSpec.armour * MOD_ARMOUR[t.team];
  dmg = Math.max(dmg * TUNE.armourFloor, dmg - armour);

  // --- hull -------------------------------------------------------------
  t.hp -= dmg;
  const wear = 1 - t.hp / tSpec.maxHp;
  if (wear > t.damage) t.damage = Math.min(1, wear);

  if (emit) {
    let nx = hx - t.pos.x, ny = hy - t.pos.y, nz = hz - t.pos.z;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-4) { nx = 0; ny = 1; nz = 0; }
    else { nx /= l; ny /= l; nz /= l; }
    EV_HIT.x = hx; EV_HIT.y = hy; EV_HIT.z = hz;
    EV_HIT.nx = nx; EV_HIT.ny = ny; EV_HIT.nz = nz;
    EV_HIT.kind = kind;
    EV_HIT.shielded = false;
    EV_HIT.team = shooterTeam;
    EV_HIT.scale = Math.max(0.4, Math.min(8, Math.sqrt(dmg) * 0.5));
    bus.emit('hit', EV_HIT);
  }

  if (t.hp <= 0) {
    t.hp = 0;
    EV_DEATH.id = t.id;
    EV_DEATH.cls = t.cls;
    EV_DEATH.team = t.team;
    EV_DEATH.x = t.pos.x; EV_DEATH.y = t.pos.y; EV_DEATH.z = t.pos.z;
    EV_DEATH.vx = t.vel.x; EV_DEATH.vy = t.vel.y; EV_DEATH.vz = t.vel.z;
    EV_DEATH.radius = tSpec.radius;
    bus.emit('death', EV_DEATH);
    world.killShip(t.id);
  }
}

/**
 * Area damage around an impact. Falloff is quadratic in the surface distance,
 * the directly-hit hull is skipped (it already ate the full round) and friendly
 * hulls are immune — no friendly fire in a fleet this size.
 */
function splash(
  world: World, skipId: number, amount: number, kind: WeaponKind,
  x: number, y: number, z: number, ownerId: number, radius: number,
): void {
  const owner = world.ships.get(ownerId);
  const ownerTeam = owner ? owner.team : Team.Neutral;
  const out = QUERY;
  out.length = 0;
  world.hash.query(x, y, z, radius, out);

  for (let i = 0; i < out.length; i++) {
    const c = world.ships.items[out[i]];
    if (!c || !c.alive || c.id === skipId || c.team === ownerTeam || c.dockedIn >= 0) continue;
    const cr = SHIP_SPECS[c.cls].radius;
    if (cr > TUNE.bigRadius) continue; // covered by the big list pass below
    applySplashTo(world, c, amount, kind, x, y, z, ownerId, radius, cr);
  }
  for (let i = 0; i < bigCount; i++) {
    const c = world.ships.items[BIG_LIST[i]];
    if (!c || !c.alive || c.id === skipId || c.team === ownerTeam) continue;
    applySplashTo(world, c, amount, kind, x, y, z, ownerId, radius, SHIP_SPECS[c.cls].radius);
  }
}

/** Single splash victim — distance falloff then the normal damage pipeline. */
function applySplashTo(
  world: World, c: Ship, amount: number, kind: WeaponKind,
  x: number, y: number, z: number, ownerId: number, radius: number, cr: number,
): void {
  const dx = c.pos.x - x, dy = c.pos.y - y, dz = c.pos.z - z;
  // Measure to the hull surface so capitals are not treated as points.
  const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - cr * 0.6);
  if (d >= radius) return;
  const k = 1 - d / radius;
  damage(world, c.id, amount * k * k, kind, x, y, z, ownerId, true);
}

// ---------------------------------------------------------------------------
// Shields
// ---------------------------------------------------------------------------

/** Age the since-hit timer and regenerate shields once the delay has passed. */
function stepShields(world: World, dt: number): void {
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s || !s.alive) continue;
    s.sinceHit += dt;
    const sp = SHIP_SPECS[s.cls];
    if (sp.maxShield <= 0) continue;
    const cap = sp.maxShield * MOD_SHIELD[s.team];
    if (s.shield >= cap) { if (s.shield > cap) s.shield = cap; continue; }
    if (s.sinceHit < sp.shieldDelay) continue;
    s.shield = Math.min(cap, s.shield + sp.shieldRegen * dt);
  }
}

/** Refresh the oversized-hull list used to bypass the uniform spatial hash. */
function rebuildBigList(world: World): void {
  bigCount = 0;
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s || !s.alive || s.dockedIn >= 0) continue;
    if (SHIP_SPECS[s.cls].radius <= TUNE.bigRadius) continue;
    BIG_LIST[bigCount++] = s.id;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Advance all combat by one fixed sim step.
 *
 * Call order inside: shield/timer ageing, big-hull list rebuild, targeting and
 * firing, beam tracking, then projectile flight. Shields age first so a hull
 * damaged during this step correctly reads `sinceHit === 0` afterwards.
 *
 * `World.rebuildHash()` must have run this step — collision and acquisition
 * both read the spatial hashes.
 */
export function stepCombat(world: World, dt: number): void {
  refreshMods(world);
  stepShields(world, dt);
  rebuildBigList(world);
  stepTargeting(world, dt);
  stepBeams(world, dt);
  stepProjectiles(world, dt);
}

/**
 * Apply damage to a hull from outside the normal weapon path (collisions,
 * scripted events, self-destructs, AI abilities).
 *
 * `amount` is raw weapon damage BEFORE multipliers: the hull-size `vs` table is
 * resolved from `ownerId`'s first weapon of `kind`, then the shooter's
 * researched damage mod, then shields, then armour. `hx/hy/hz` is the world
 * impact point and drives the `hit` event (projected onto the shield shell when
 * shields absorb). Pass `ownerId = -1` for unattributed damage.
 *
 * Safe to call outside `stepCombat` — it refreshes the research modifier cache
 * itself (a no-op when nothing has been researched since the last call).
 */
export function applyDamage(
  world: World, targetId: number, amount: number, kind: WeaponKind,
  hx: number, hy: number, hz: number, ownerId: number,
): void {
  refreshMods(world);
  damage(world, targetId, amount, kind, hx, hy, hz, ownerId, true);
}
