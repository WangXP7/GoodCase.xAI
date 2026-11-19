/**
 * Formation geometry and squad shepherding.
 *
 * A squad is a player-issued group that flies as one body. `updateSquads` moves
 * the squad *anchor* (the formation origin) toward the group's order goal,
 * turns the squad's facing, and publishes a world-space slot position for every
 * member. `stepMovement` then flies each hull to its own slot with its own
 * flight model — the formation never teleports anyone.
 *
 * -------------------------------------------------------------------------
 * FORMATION LOCAL SPACE
 * -------------------------------------------------------------------------
 * Offsets returned by `formationOffset` are expressed in the same convention
 * as ship local space (see core/registry.ts):
 *     +Z = direction of travel   +Y = up   +X = starboard
 * `updateSquads` maps them to world space with the orthonormal squad basis
 * [right, up, fwd], right = up x fwd.
 *
 * -------------------------------------------------------------------------
 * SLOT PUBLICATION (side channel)
 * -------------------------------------------------------------------------
 * `Ship` has no slot field in core/types.ts, so slots are published through the
 * module-scope tables below, indexed by ship id. They are rewritten from
 * scratch every call, so `updateSquads` MUST run before `stepMovement` in the
 * same sim step. Read them with `slotOf`.
 *
 * Zero allocation: every vector used per step is module scope.
 */

import { Vector3, Quaternion } from 'three';
import { CONFIG } from '../core/config';
import { SHIP_SPECS } from '../core/registry';
import { Formation, type Ship } from '../core/types';
import type { Squad, World } from './world';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Golden angle (rad) — gives maximally even radial/spherical spreads. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Arc swept by each arm of the Claw formation, radians. */
const CLAW_SWEEP = 1.25;

/**
 * Cohesion tolerance as a multiple of formation spacing. A member lagging by
 * less than this costs the squad nothing; beyond it the squad throttles back.
 */
const COHESION_TOL = 1.6;

/** Hard floor on the squad throttle so a hopelessly lost member cannot stall the fleet. */
const COHESION_MIN = 0.14;

/** Anchor is snapped to the live centroid if it drifts further than this many spacings. */
const ANCHOR_RESYNC = 40;

// ---------------------------------------------------------------------------
// Slot side channel
// ---------------------------------------------------------------------------

/** Packed world-space slot positions, 3 floats per ship id. Written by `updateSquads`. */
const SLOT_POS = new Float32Array(CONFIG.maxShips * 3);
/** 1 where `SLOT_POS` holds a valid slot for that ship id this step. */
const SLOT_VALID = new Uint8Array(CONFIG.maxShips);

/**
 * Read the world-space formation slot published for `shipId` this step.
 * Returns false (and leaves `out` untouched) if the ship has no slot.
 */
export function slotOf(shipId: number, out: Vector3): boolean {
  if (shipId < 0 || shipId >= SLOT_VALID.length || SLOT_VALID[shipId] === 0) return false;
  const i = shipId * 3;
  out.set(SLOT_POS[i], SLOT_POS[i + 1], SLOT_POS[i + 2]);
  return true;
}

// ---------------------------------------------------------------------------
// Scratch
// ---------------------------------------------------------------------------

const _off = new Vector3();
const _slot = new Vector3();
const _goal = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _axis = new Vector3();
const _cent = new Vector3();
const _q = new Quaternion();
const WORLD_UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Formation shapes
// ---------------------------------------------------------------------------

/**
 * Position of formation slot `slot` (0 = leader/first) inside a formation of
 * `count` members, written into `out` and returned.
 *
 * `spacing` is the centre-to-centre distance between adjacent members in
 * metres — see `squadSpacing`. Offsets are in formation local space
 * (+Z forward, +Y up, +X starboard) and always place slot 0 at or near the
 * origin so the anchor reads as the head of the formation.
 */
export function formationOffset(
  f: Formation,
  slot: number,
  count: number,
  spacing: number,
  out: Vector3,
): Vector3 {
  const n = Math.max(1, count);
  const i = slot < 0 ? 0 : slot;

  switch (f) {
    // V wedge: leader at the apex, pairs stepping out and back.
    case Formation.Delta: {
      const rank = Math.ceil(i / 2);
      if (rank === 0) return out.set(0, 0, 0);
      const side = i % 2 === 1 ? 1 : -1;
      // Alternating rank height keeps the wings from occluding each other.
      const ripple = (rank & 1) === 1 ? 1 : -1;
      return out.set(side * rank * spacing * 0.92, ripple * spacing * 0.11, -rank * spacing * 0.78);
    }

    // Line abreast, very slightly bowed back at the tips so the centre leads.
    case Formation.Broad: {
      const k = i - (n - 1) * 0.5;
      return out.set(k * spacing, 0, -Math.abs(k) * spacing * 0.06);
    }

    // Rectangular grid in the plane normal to travel (z = 0), wider than tall.
    case Formation.Wall: {
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const c = i % cols;
      const r = Math.floor(i / cols);
      return out.set(
        (c - (cols - 1) * 0.5) * spacing,
        ((rows - 1) * 0.5 - r) * spacing * 0.82,
        0,
      );
    }

    // Fibonacci sphere — radius chosen so each member owns ~spacing^2 of surface.
    case Formation.Sphere: {
      if (n === 1) return out.set(0, 0, 0);
      const radius = Math.max(spacing * 0.5, spacing * Math.sqrt(n / (4 * Math.PI)));
      const k = i + 0.5;
      const y = 1 - (2 * k) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = k * GOLDEN_ANGLE;
      return out.set(Math.cos(phi) * r * radius, y * radius, Math.sin(phi) * r * radius);
    }

    // Two arms sweeping back and apart, with opposite dihedral — a pincer.
    case Formation.Claw: {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const arm = Math.max(1, Math.ceil(n / 2));
      const t = arm > 1 ? k / (arm - 1) : 0;
      // Arc radius from arc-length: (arm-1) gaps of `spacing` over CLAW_SWEEP radians.
      const radius = arm > 1 ? ((arm - 1) * spacing) / CLAW_SWEEP : spacing;
      const a = t * CLAW_SWEEP;
      return out.set(
        side * (spacing * 0.55 + radius * Math.sin(a)),
        side * t * spacing * 0.42,
        -radius * (1 - Math.cos(a)),
      );
    }

    // Column astern.
    case Formation.Line:
      return out.set(0, 0, -i * spacing);

    // Ungrouped / loose: golden-angle cloud in the plane normal to travel so
    // nobody stacks, with a shallow trailing rake.
    case Formation.None:
    default: {
      if (i === 0) return out.set(0, 0, 0);
      const a = i * GOLDEN_ANGLE;
      const r = spacing * 0.55 * Math.sqrt(i);
      return out.set(Math.cos(a) * r, Math.sin(a) * r * 0.6, -r * 0.15);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Centre-to-centre formation spacing for a squad, metres.
 *
 * Driven by the largest member so a mixed wing never clips its capital ships:
 * two hulls of radius R need 2R of clearance, padded by `CONFIG.separationPad`
 * (the same pad the movement separation solver uses, so formation slots sit
 * exactly outside the repulsion shell and the two systems never fight).
 */
export function squadSpacing(world: World, sq: Squad): number {
  let maxR = 1;
  for (let i = 0; i < sq.members.length; i++) {
    const s = world.ship(sq.members[i]);
    if (!s) continue;
    const r = SHIP_SPECS[s.cls].radius;
    if (r > maxR) maxR = r;
  }
  return maxR * 2 * CONFIG.separationPad;
}

/** Rotate the unit vector `cur` toward the unit vector `tgt` by at most `maxAngle` rad. */
function rotateToward(cur: Vector3, tgt: Vector3, maxAngle: number): void {
  if (maxAngle <= 0) return;
  const d = Math.min(1, Math.max(-1, cur.dot(tgt)));
  const ang = Math.acos(d);
  if (ang < 1e-5) return;
  if (ang <= maxAngle) {
    cur.copy(tgt);
    return;
  }
  _axis.crossVectors(cur, tgt);
  if (_axis.lengthSq() < 1e-12) {
    // Exactly antiparallel: any perpendicular axis will do.
    _axis.set(-cur.y, cur.x, 0);
    if (_axis.lengthSq() < 1e-12) _axis.set(0, -cur.z, cur.y);
  }
  _axis.normalize();
  _q.setFromAxisAngle(_axis, maxAngle);
  cur.applyQuaternion(_q).normalize();
}

/** Build the squad's orthonormal basis into `_right` / `_up` from `sq.fwd`. */
function squadBasis(sq: Squad): void {
  _up.copy(WORLD_UP);
  const d = _up.dot(sq.fwd);
  if (Math.abs(d) > 0.995) {
    // Travelling nearly straight up/down — fall back to a lateral reference.
    _up.set(0, 0, d > 0 ? -1 : 1);
    _up.addScaledVector(sq.fwd, -_up.dot(sq.fwd));
  } else {
    _up.addScaledVector(sq.fwd, -d);
  }
  _up.normalize();
  _right.crossVectors(_up, sq.fwd).normalize();
}

/** World position of `slot`, using the basis currently in `_right`/`_up`. */
function slotWorld(sq: Squad, slot: number, count: number, spacing: number, out: Vector3): Vector3 {
  formationOffset(sq.formation, slot, count, spacing, _off);
  out.copy(sq.anchor);
  out.addScaledVector(_right, _off.x);
  out.addScaledVector(_up, _off.y);
  out.addScaledVector(sq.fwd, _off.z);
  return out;
}

/**
 * Resolve the world-space goal this squad is flying to, into `_goal`.
 * Returns false if the squad has no move-ish order (it should hold station).
 *
 * All members of a squad share an order, so the first live member with a
 * non-idle order speaks for the group.
 */
function squadGoal(world: World, sq: Squad): boolean {
  for (let i = 0; i < sq.members.length; i++) {
    const s = world.ship(sq.members[i]);
    if (!s) continue;
    const o = s.order;
    switch (o.kind) {
      case 'move':
      case 'attackMove':
      case 'formUp':
        if (o.x !== undefined) {
          _goal.set(o.x, o.y ?? 0, o.z ?? 0);
          return true;
        }
        break;
      case 'attack':
      case 'guard':
      case 'dock': {
        const t = world.ship(o.target ?? -1);
        if (t) {
          _goal.copy(t.pos);
          return true;
        }
        break;
      }
      default:
        break;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Squad update
// ---------------------------------------------------------------------------

/**
 * Advance every live squad by `dt`.
 *
 * Per squad: measure formation cohesion, throttle the anchor to the pace of
 * the worst laggard, slide the anchor toward the order goal at the slowest
 * member's cruise speed, turn `sq.fwd` at the slowest member's turn rate, then
 * publish a world slot for every member.
 *
 * MUST be called before `stepMovement` each sim step.
 */
export function updateSquads(world: World, dt: number): void {
  SLOT_VALID.fill(0);
  if (dt <= 0) return;

  const squads = world.squads;
  for (let qi = 0; qi < squads.length; qi++) {
    const sq = squads[qi];
    if (!sq.alive || sq.members.length === 0) continue;

    // --- gather group stats (one pass, no allocation) ---------------------
    let live = 0;
    let slowest = Infinity;
    let slowestTurn = Infinity;
    _cent.set(0, 0, 0);
    for (let i = 0; i < sq.members.length; i++) {
      const s = world.ship(sq.members[i]);
      if (!s || s.dockedIn >= 0) continue;
      const sp = SHIP_SPECS[s.cls];
      if (sp.speed < slowest) slowest = sp.speed;
      if (sp.turnRate < slowestTurn) slowestTurn = sp.turnRate;
      _cent.add(s.pos);
      live++;
    }
    if (live === 0) continue;
    _cent.multiplyScalar(1 / live);
    if (!isFinite(slowest)) slowest = 100;
    if (!isFinite(slowestTurn)) slowestTurn = 0.5;

    const count = sq.members.length;
    const spacing = squadSpacing(world, sq);

    // --- initialise / resync the anchor -----------------------------------
    // A brand-new squad has anchor (0,0,0); a squad whose members were moved
    // by something outside the flight model gets snapped back too.
    if (sq.anchor.lengthSq() === 0 ||
        sq.anchor.distanceToSquared(_cent) > (ANCHOR_RESYNC * spacing) * (ANCHOR_RESYNC * spacing)) {
      sq.anchor.copy(_cent);
    }
    if (sq.fwd.lengthSq() < 1e-6) sq.fwd.set(0, 0, 1);
    else sq.fwd.normalize();

    const hasGoal = squadGoal(world, sq);

    // --- cohesion: how far is the worst member from its current slot? -----
    squadBasis(sq);
    let worstLag = 0;
    for (let i = 0; i < sq.members.length; i++) {
      const s = world.ship(sq.members[i]);
      if (!s || s.dockedIn >= 0 || s.launchT > 0) continue;
      slotWorld(sq, s.squadSlot, count, spacing, _slot);
      const lag = _slot.distanceTo(s.pos);
      if (lag > worstLag) worstLag = lag;
    }
    // Beyond the tolerance the squad bleeds speed linearly; three tolerances
    // of lag brings it down to the floor. This is what stops a destroyer from
    // out-running the interceptors slotted behind it.
    const tol = spacing * COHESION_TOL;
    let cohesion = 1;
    if (worstLag > tol) cohesion = 1 - (worstLag - tol) / (tol * 3);
    if (cohesion < COHESION_MIN) cohesion = COHESION_MIN;

    // --- slide the anchor -------------------------------------------------
    if (hasGoal) {
      _dir.subVectors(_goal, sq.anchor);
      const dist = _dir.length();
      if (dist > 1e-3) {
        _dir.multiplyScalar(1 / dist);
        const step = Math.min(dist, slowest * cohesion * dt);
        sq.anchor.addScaledVector(_dir, step);
        // Turn the formation onto the goal bearing. Only bother steering while
        // there is meaningful distance left, or the facing spins on arrival.
        if (dist > spacing * 0.75) rotateToward(sq.fwd, _dir, slowestTurn * 0.9 * dt);
      }
    }

    // --- publish slots ----------------------------------------------------
    squadBasis(sq);
    for (let i = 0; i < sq.members.length; i++) {
      const id = sq.members[i];
      const s: Ship | undefined = world.ship(id);
      if (!s || s.dockedIn >= 0) continue;
      slotWorld(sq, s.squadSlot, count, spacing, _slot);
      const k = id * 3;
      SLOT_POS[k] = _slot.x;
      SLOT_POS[k + 1] = _slot.y;
      SLOT_POS[k + 2] = _slot.z;
      SLOT_VALID[id] = 1;
    }
  }
}
