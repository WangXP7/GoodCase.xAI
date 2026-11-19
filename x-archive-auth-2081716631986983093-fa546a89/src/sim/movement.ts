/**
 * The flight model — one integrator per `FlightModel`, plus arrival braking,
 * soft separation and the map boundary.
 *
 * This is the file that decides whether the game *feels* like Homeworld:
 * fighters knife-turn and bank into their arcs, corvettes slide around a
 * broadside orbit, capitals lumber onto a bearing before they burn, and nobody
 * ever jitters against a neighbour.
 *
 * -------------------------------------------------------------------------
 * ORIENTATION CONTRACT
 * -------------------------------------------------------------------------
 * `ship.fwd` is the unit heading. `ship.up` is the unit up **with the bank roll
 * already applied** (as documented on `Ship.up` in core/types.ts) and is
 * re-orthonormalised against `fwd` every step. `ship.bank` is the same roll
 * expressed as an angle (positive = starboard side down) and is published for
 * FX/UI and for renderers that would rather roll the basis themselves:
 *
 *     right = up_level x fwd            (registry convention)
 *     up    = up_level*cos(bank) - right*sin(bank)
 *
 * A renderer that builds its basis from `fwd` + `up` gets the roll for free and
 * must NOT apply `bank` a second time.
 *
 * -------------------------------------------------------------------------
 * ORDERING
 * -------------------------------------------------------------------------
 *   world.rebuildHash();      // separation reads the hash
 *   updateSquads(world, dt);  // publishes formation slots
 *   stepMovement(world, dt);
 *
 * Zero allocation: all vectors are module scope.
 */

import { Vector3, Quaternion } from 'three';
import { CONFIG } from '../core/config';
import { hash3 } from '../core/rng';
import { SHIP_SPECS } from '../core/registry';
import { ALL_SHIP_CLASSES, FlightModel, ShipClass, type Ship, type ShipSpec } from '../core/types';
import type { World } from './world';
import { slotOf } from './formations';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * Fraction of `spec.accel` each model is willing to spend on braking. The
 * arrival profile is built from this number, so a low value simply means the
 * ship starts shedding speed further out — capitals decelerate over kilometres.
 *
 * MUST stay <= 1: a ship cannot decelerate harder than it can accelerate, and a
 * profile the integrator cannot track turns straight into arrival overshoot.
 */
const BRAKE_AUTHORITY = [0.72, 0.7, 0.5, 0.6]; // Agile, Brawler, Capital, Utility

/**
 * Velocity bleed for a hull that has arrived, 1/s. Nothing else in the loop
 * removes residual velocity from a parked ship, so without this every impulse
 * it ever receives is kept. See the station-keeping block in `stepMovement`.
 */
const STATION_DAMP = 2.0;

/** Roll rate limit per model, rad/s. */
const ROLL_RATE = [3.0, 1.3, 0.35, 0.8];

/** How hard bank tracks lateral acceleration (multiplies a_lat / accel). */
const BANK_GAIN = [1.75, 1.1, 2.4, 0.9];

/** Throttle smoothing rate per model, 1/s — capitals spool up slowly. */
const THROTTLE_RATE = [11, 6, 2.2, 4];

/** Turn-rate multiplier per model applied on top of `spec.turnRate`. */
const TURN_SCALE = [1.0, 0.85, 1.0, 0.8];

/** Capital pitch authority as a fraction of yaw authority — yaw-dominant. */
const CAPITAL_PITCH_FRAC = 0.42;

/** Rate (1/s) at which a capital bleeds off-axis velocity. Low = long, heavy arcs. */
const CAPITAL_LATERAL_DAMP = 0.75;

/**
 * Separation stiffness (multiplies spec.accel), the cap on its authority while
 * contact is shallow, and the extra authority unlocked by deep interpenetration.
 * The shallow cap is what keeps a formation from buzzing; the deep term is what
 * stops two capitals ordered to the same point from sitting inside each other.
 */
const SEP_GAIN = 2.4;
const SEP_CAP = 0.6;
const SEP_DEEP_CAP = 1.8;

/** Hulls at or above this radius are pushed via the big-hull list, not the hash. */
const BIG_RADIUS = 150;

/** Boundary turn-back starts at this fraction of `CONFIG.mapRadius`. */
const BOUND_SOFT = 0.9;

/**
 * Throttle floor for a live, undocked hull. Station-keeping ships idle their
 * drives rather than extinguishing them — "dim", not "dead". Docked hulls are
 * forced to a hard 0 because they are not rendered.
 */
const IDLE_GLOW = 0.06;

const TAU = Math.PI * 2;
const WORLD_UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Static per-class lookups (built once at module load)
// ---------------------------------------------------------------------------

/** Longest weapon range per ship class, metres (0 for unarmed hulls -> fallback). */
const CLASS_RANGE = new Float32Array(ALL_SHIP_CLASSES.length + 1);
/** Bounding radius per ship class — flat array so the separation loop never touches a Record. */
const CLASS_RADIUS = new Float32Array(ALL_SHIP_CLASSES.length + 1);
/** radius^3, the mass proxy used to weight who pushes whom. */
const CLASS_MASS = new Float64Array(ALL_SHIP_CLASSES.length + 1);
/** Largest radius among hulls that are NOT on the big-hull list. */
let MAX_SMALL_RADIUS = 1;

for (let i = 0; i < ALL_SHIP_CLASSES.length; i++) {
  const cls = ALL_SHIP_CLASSES[i];
  const sp = SHIP_SPECS[cls];
  let r = 0;
  for (let w = 0; w < sp.weapons.length; w++) if (sp.weapons[w].range > r) r = sp.weapons[w].range;
  CLASS_RANGE[cls] = r > 0 ? r : 900;
  CLASS_RADIUS[cls] = sp.radius;
  CLASS_MASS[cls] = sp.radius * sp.radius * sp.radius;
  if (sp.radius < BIG_RADIUS && sp.radius > MAX_SMALL_RADIUS) MAX_SMALL_RADIUS = sp.radius;
}

// ---------------------------------------------------------------------------
// Scratch — module scope, never allocated in the loop
// ---------------------------------------------------------------------------

const _goal = new Vector3();
const _dir = new Vector3();
const _face = new Vector3();
const _desVel = new Vector3();
const _acc = new Vector3();
const _sep = new Vector3();
const _lvlUp = new Vector3();
const _lvlRight = new Vector3();
const _axis = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _q = new Quaternion();

const _neighbours: number[] = [];
const _big = new Int32Array(CONFIG.maxShips);
let _bigCount = 0;
/** Deepest overlap found by the current separation pass, 0..1. */
let _sepDeep = 0;
/** Cell + ring the cached `_neighbours` candidate list was gathered for. */
let _qcx = 0x7fffffff;
let _qcy = 0;
let _qcz = 0;
let _qcr = -1;

// Resolved-goal state, filled by `resolveGoal`.
let _hasGoal = false;
let _hasFace = false;
let _arriveR = 0;
/** True for attack runs / orbits: fly through at full speed, never brake. */
let _noBrake = false;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Shortest signed angle equivalent to `a`, in (-pi, pi]. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x <= -Math.PI) x += TAU;
  return x;
}

/** Rotate the unit vector `cur` toward the unit vector `tgt` by at most `maxAngle` rad. */
function rotateToward(cur: Vector3, tgt: Vector3, maxAngle: number): void {
  if (maxAngle <= 0) return;
  const d = clamp(cur.dot(tgt), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-5) return;
  if (ang <= maxAngle) {
    cur.copy(tgt);
    return;
  }
  _axis.crossVectors(cur, tgt);
  if (_axis.lengthSq() < 1e-12) {
    _axis.set(-cur.y, cur.x, 0);
    if (_axis.lengthSq() < 1e-12) _axis.set(0, -cur.z, cur.y);
  }
  _axis.normalize();
  _q.setFromAxisAngle(_axis, maxAngle);
  cur.applyQuaternion(_q).normalize();
}

/**
 * Level (unrolled) basis for `fwd`, written into `_lvlUp` / `_lvlRight`.
 * Guards the singular case where the heading is parallel to world up by
 * falling back to the ship's previous up vector.
 */
function levelBasis(s: Ship): void {
  _lvlUp.copy(WORLD_UP);
  const d = _lvlUp.dot(s.fwd);
  if (Math.abs(d) > 0.995) {
    _lvlUp.copy(s.up);
    _lvlUp.addScaledVector(s.fwd, -_lvlUp.dot(s.fwd));
    if (_lvlUp.lengthSq() < 1e-8) {
      _lvlUp.set(0, 0, d > 0 ? -1 : 1);
      _lvlUp.addScaledVector(s.fwd, -_lvlUp.dot(s.fwd));
    }
  } else {
    _lvlUp.addScaledVector(s.fwd, -d);
  }
  _lvlUp.normalize();
  // registry convention: right = up x forward
  _lvlRight.crossVectors(_lvlUp, s.fwd).normalize();
}

/** Rebuild `s.up` from the level basis plus the current bank roll. */
function applyBank(s: Ship): void {
  levelBasis(s);
  const cb = Math.cos(s.bank);
  const sb = Math.sin(s.bank);
  // Rotating the basis about +fwd by b: up' = up*cos(b) - right*sin(b).
  s.up.copy(_lvlUp).multiplyScalar(cb).addScaledVector(_lvlRight, -sb).normalize();
}

/** Move `s.bank` toward `target`, rate-limited. */
function rollToward(s: Ship, target: number, model: FlightModel, dt: number): void {
  const maxStep = ROLL_RATE[model] * dt;
  const d = clamp(target - s.bank, -maxStep, maxStep);
  s.bank += d;
}

/** Ease `s.throttle` toward `target` with an exponential the frame rate cannot break. */
function easeThrottle(s: Ship, target: number, model: FlightModel, dt: number): void {
  const k = 1 - Math.exp(-THROTTLE_RATE[model] * dt);
  s.throttle += (clamp(target, 0, 1) - s.throttle) * k;
  if (s.throttle < 1e-3) s.throttle = 0;
}

// ---------------------------------------------------------------------------
// Goal resolution
// ---------------------------------------------------------------------------

/**
 * Work out where this ship wants to be (`_goal`) and, optionally, where it
 * wants to point (`_face`). Also sets `_hasGoal`, `_arriveR` (the radius at
 * which the destination counts as reached) and `_noBrake`.
 *
 * Priority: combat/utility manoeuvres for the models that own them, then the
 * formation slot, then the raw order destination, then hold station. Capitals
 * and utility hulls keep their formation slot even while attacking — only
 * strike craft and brawlers break formation to fight, which is exactly how
 * Homeworld reads on screen.
 */
function resolveGoal(world: World, s: Ship, sp: ShipSpec): void {
  _hasGoal = false;
  _hasFace = false;
  _noBrake = false;
  _arriveR = Math.max(sp.radius * 0.4, 4);

  const model = sp.flight;
  const ord = s.order;
  const breaksFormation = model === FlightModel.Agile || model === FlightModel.Brawler;

  // --- combat / utility manoeuvres --------------------------------------
  switch (ord.kind) {
    case 'attack': {
      const t = world.ship(ord.target ?? s.target);
      if (!t) break;
      const range = CLASS_RANGE[s.cls];
      if (model === FlightModel.Agile && breaksFormation) {
        attackRun(s, t, sp, range);
        return;
      }
      if (model === FlightModel.Brawler && breaksFormation) {
        broadsideOrbit(s, t, sp, range);
        return;
      }
      if (model === FlightModel.Capital) {
        // Nose on, hold at a standoff just inside our longest gun.
        _face.subVectors(t.pos, s.pos);
        if (_face.lengthSq() > 1e-6) {
          _face.normalize();
          _hasFace = true;
        }
        if (!slotGoal(s)) {
          const stand = range * 0.85 + SHIP_SPECS[t.cls].radius;
          _tmp.subVectors(s.pos, t.pos);
          const d = _tmp.length();
          if (d > 1e-3) _tmp.multiplyScalar(1 / d);
          else _tmp.copy(s.fwd).negate();
          _goal.copy(t.pos).addScaledVector(_tmp, stand);
          _hasGoal = true;
          _arriveR = Math.max(sp.radius, range * 0.08);
        }
        return;
      }
      break; // Utility hulls do not fight — fall through to the slot/order.
    }

    case 'guard': {
      const t = world.ship(ord.target ?? -1);
      if (!t) break;
      if (slotGoal(s)) return;
      // Deterministic station on a ring around the guarded hull.
      const a = hash3(s.id, 7, 3) * TAU + s.squadSlot * 0.9;
      const r = (SHIP_SPECS[t.cls].radius + sp.radius) * 3 + 40;
      _goal.set(t.pos.x + Math.cos(a) * r, t.pos.y + Math.sin(a * 0.5) * r * 0.25, t.pos.z + Math.sin(a) * r);
      _hasGoal = true;
      return;
    }

    case 'dock': {
      const t = world.ship(ord.target ?? -1);
      if (!t) break;
      // Approach gate ahead of the parent's nose, then face the parent so the
      // final metres are flown nose-first into the hangar.
      const tr = SHIP_SPECS[t.cls].radius;
      _goal.copy(t.pos).addScaledVector(t.fwd, tr * 0.95);
      _hasGoal = true;
      _arriveR = Math.max(sp.radius, tr * 0.15);
      _face.subVectors(t.pos, s.pos);
      if (_face.lengthSq() > 1e-6) {
        _face.normalize();
        _hasFace = true;
      }
      return;
    }

    case 'harvest': {
      if (ord.x !== undefined) {
        _goal.set(ord.x, ord.y ?? 0, ord.z ?? 0);
        _hasGoal = true;
        return;
      }
      const rock = ord.rock !== undefined ? world.asteroids.get(ord.rock) : undefined;
      if (rock) {
        _goal.copy(rock.pos);
        _hasGoal = true;
        _arriveR = rock.radius + sp.radius * 1.5;
        return;
      }
      const t = world.ship(ord.target ?? -1);
      if (t) {
        _goal.copy(t.pos);
        _hasGoal = true;
        _arriveR = SHIP_SPECS[t.cls].radius + sp.radius;
        return;
      }
      break;
    }

    default:
      break;
  }

  // --- formation slot ----------------------------------------------------
  if (slotGoal(s)) return;

  // --- raw order destination --------------------------------------------
  if ((ord.kind === 'move' || ord.kind === 'attackMove' || ord.kind === 'formUp') && ord.x !== undefined) {
    _goal.set(ord.x, ord.y ?? 0, ord.z ?? 0);
    _hasGoal = true;
    return;
  }

  // --- hold station ------------------------------------------------------
  _hasGoal = false;
}

/** Take the published formation slot as the goal, if this ship has one. */
function slotGoal(s: Ship): boolean {
  if (s.squad < 0) return false;
  if (!slotOf(s.id, _goal)) return false;
  _hasGoal = true;
  _arriveR = Math.max(_arriveR, 2);
  return true;
}

/**
 * Fighter attack geometry: bore straight in, and once the target has slipped
 * behind the nose keep extending in a straight line until there is room to
 * turn and re-attack. Stateless — the decision falls out of the geometry — so
 * it costs nothing and never desyncs.
 */
function attackRun(s: Ship, t: Ship, sp: ShipSpec, range: number): void {
  _tmp.subVectors(t.pos, s.pos);
  const d = _tmp.length();
  const behind = d > 1e-3 ? _tmp.dot(s.fwd) / d < 0.0 : false;
  _noBrake = true;
  _arriveR = Math.max(sp.radius * 2, range * 0.15);
  if (behind && d < range * 0.9) {
    // Blew past: extend on the current heading rather than pirouetting.
    _goal.copy(s.pos).addScaledVector(s.fwd, range * 1.2);
  } else {
    _goal.copy(t.pos);
    // Aim to slide past rather than through: a deterministic lateral bias of a
    // couple of hull widths turns a head-on merge into a proper gun pass.
    if (d > 1e-3) {
      _tmp.multiplyScalar(1 / d);
      _tmp2.crossVectors(_tmp, WORLD_UP);
      if (_tmp2.lengthSq() < 1e-8) _tmp2.set(1, 0, 0);
      _tmp2.normalize();
      _axis.crossVectors(_tmp, _tmp2);
      const a = hash3(s.id, t.id, 5) * TAU;
      const miss = (sp.radius + SHIP_SPECS[t.cls].radius) * 2.2;
      _goal.addScaledVector(_tmp2, Math.cos(a) * miss);
      _goal.addScaledVector(_axis, Math.sin(a) * miss);
    }
  }
  _hasGoal = true;
}

/**
 * Corvette brawling: hold a circular orbit at ~60% of weapon range so the
 * broadside mounts bear. The steering carrot is placed along the tangent with
 * a radial correction, and the hull simply faces its own velocity — which puts
 * the target square on the beam.
 */
function broadsideOrbit(s: Ship, t: Ship, sp: ShipSpec, range: number): void {
  const r0 = range * 0.6 + SHIP_SPECS[t.cls].radius;
  _tmp.subVectors(s.pos, t.pos);
  const d = _tmp.length();
  if (d < 1e-3) _tmp.copy(s.fwd).negate().multiplyScalar(r0);
  _tmp.normalize();

  // Orbit plane: world up unless we are directly over/under the target.
  _axis.copy(WORLD_UP);
  if (Math.abs(_axis.dot(_tmp)) > 0.95) _axis.copy(s.fwd);
  _tmp2.crossVectors(_axis, _tmp);
  if (_tmp2.lengthSq() < 1e-8) _tmp2.set(1, 0, 0);
  _tmp2.normalize();
  // Half the squadron circles the other way — reads as a proper furball.
  if (s.seed < 0.5) _tmp2.negate();

  // Radial gain has to beat the turn lag that otherwise widens the circle.
  const radialErr = clamp((r0 - d) / Math.max(1, r0 * 0.5), -1, 1);
  _tmp2.addScaledVector(_tmp, radialErr * 1.5).normalize();
  _goal.copy(s.pos).addScaledVector(_tmp2, sp.speed * 2.2);
  _hasGoal = true;
  _noBrake = true;
  _arriveR = sp.radius;
}

// ---------------------------------------------------------------------------
// Separation
// ---------------------------------------------------------------------------

/** Rebuild the list of hulls too large to be found by a fighter's hash query. */
function collectBigHulls(world: World): void {
  _bigCount = 0;
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s.alive || s.dockedIn >= 0) continue;
    if (CLASS_RADIUS[s.cls] >= BIG_RADIUS) _big[_bigCount++] = s.id;
  }
  // The hash was rebuilt this step, so any cached candidate list is stale.
  _qcr = -1;
}

/**
 * Accumulate one pairwise repulsion into `_sep`.
 *
 * The push is weighted by mass ratio (mass ~ radius^3), so a mothership shoves
 * an interceptor almost the full amount while the interceptor moves the
 * mothership by ~1e-6 of it: capitals push fighters, never the reverse. The
 * quadratic overlap ramp plus a closing-velocity damper keeps a packed fleet
 * from buzzing.
 */
function accumulate(s: Ship, myR: number, myMass: number, o: Ship, oR: number, accel: number): void {
  const want = (myR + oR) * CONFIG.separationPad;
  let dx = s.pos.x - o.pos.x;
  let dy = s.pos.y - o.pos.y;
  let dz = s.pos.z - o.pos.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= want * want) return;
  let d = Math.sqrt(d2);
  if (d < 1e-3) {
    // Perfectly co-located: pick a deterministic escape axis from the ids.
    const a = hash3(s.id, o.id, 11) * TAU;
    const b = hash3(o.id, s.id, 29) * Math.PI - Math.PI * 0.5;
    dx = Math.cos(a) * Math.cos(b);
    dy = Math.sin(b);
    dz = Math.sin(a) * Math.cos(b);
    d = 1;
  }
  const inv = 1 / d;
  const nx = dx * inv;
  const ny = dy * inv;
  const nz = dz * inv;

  const overlap = (want - d) / want; // 0 at the shell, 1 at coincident
  if (overlap > _sepDeep) _sepDeep = overlap;
  const oMass = CLASS_MASS[o.cls];
  const w = oMass / (oMass + myMass);

  let push = accel * SEP_GAIN * overlap * overlap * w;
  // Damp the closing rate so contacts settle instead of bouncing.
  const rel = (s.vel.x - o.vel.x) * nx + (s.vel.y - o.vel.y) * ny + (s.vel.z - o.vel.z) * nz;
  if (rel < 0) push += -rel * 0.9 * w;

  _sep.x += nx * push;
  _sep.y += ny * push;
  _sep.z += nz * push;
}

/**
 * Gather the soft mutual repulsion for this ship into `_sep` and record the
 * deepest contact in `_sepDeep`. Nothing is committed to the velocity yet —
 * the steering pass wants to know how crowded the ship is *before* it decides
 * how hard to push toward its goal, but the push itself has to land after the
 * integrator or the capital lateral damper would swallow it.
 */
function gatherSeparation(world: World, s: Ship, sp: ShipSpec): void {
  const myR = sp.radius;
  const myMass = CLASS_MASS[s.cls];
  _sep.set(0, 0, 0);
  _sepDeep = 0;

  // Small hulls come from the spatial hash. The query radius only has to cover
  // the largest *small* hull, which keeps a fighter's query to a single cell
  // ring; anything bigger lives on the big-hull list below.
  const qr = (myR + MAX_SMALL_RADIUS) * CONFIG.separationPad;
  const cell = world.hash.cell;
  const bx = Math.floor(s.pos.x / cell);
  const by = Math.floor(s.pos.y / cell);
  const bz = Math.floor(s.pos.z / cell);
  const ring = Math.max(1, Math.ceil(qr / cell));
  const list = _neighbours;
  // Every ship in the same cell with the same ring size gets the same candidate
  // set, so a packed formation pays for one hash walk instead of one each.
  if (bx !== _qcx || by !== _qcy || bz !== _qcz || ring !== _qcr) {
    _qcx = bx; _qcy = by; _qcz = bz; _qcr = ring;
    list.length = 0;
    world.hash.query(s.pos.x, s.pos.y, s.pos.z, qr, list);
  }
  const items = world.ships.items;
  for (let i = 0; i < list.length; i++) {
    const o = items[list[i]];
    if (o === undefined || o === s || !o.alive || o.dockedIn >= 0) continue;
    const oR = CLASS_RADIUS[o.cls];
    if (oR >= BIG_RADIUS) continue;
    accumulate(s, myR, myMass, o, oR, sp.accel);
  }
  for (let i = 0; i < _bigCount; i++) {
    const o = items[_big[i]];
    if (o === undefined || o === s || !o.alive) continue;
    accumulate(s, myR, myMass, o, CLASS_RADIUS[o.cls], sp.accel);
  }

  const m2 = _sep.lengthSq();
  // Shallow contact stays firmly subordinate to the order; real interpenetration
  // escalates until the hulls are apart again.
  const cap = sp.accel * (SEP_CAP + SEP_DEEP_CAP * _sepDeep * _sepDeep * _sepDeep);
  if (m2 > cap * cap) _sep.multiplyScalar(cap / Math.sqrt(m2));
}

/**
 * How much of the order a crowded ship is still willing to fly, 0..1.
 *
 * A hull that is already inside a neighbour's shell stops burning toward a
 * destination it cannot physically reach — which is what keeps two capitals
 * ordered to the same point from grinding through each other. It reaches zero
 * well before the hulls actually touch (`separationPad` gives the margin).
 */
function crowdRelief(): number {
  return clamp(1 - (_sepDeep - 0.1) / 0.28, 0, 1);
}

// ---------------------------------------------------------------------------
// Boundary
// ---------------------------------------------------------------------------

/** Soft turn-back toward the battlespace centre; a hard clamp only as a failsafe. */
function applyBounds(s: Ship, sp: ShipSpec, dt: number): void {
  const R = CONFIG.mapRadius;
  const soft = R * BOUND_SOFT;
  const d2 = s.pos.lengthSq();
  if (d2 > soft * soft) {
    const d = Math.sqrt(d2);
    const t = clamp((d - soft) / (R - soft), 0, 1);
    // Quadratic ramp: barely felt at the soft edge, full authority at the wall.
    const a = sp.accel * t * t * 1.6;
    const inv = -a * dt / d;
    s.vel.x += s.pos.x * inv;
    s.vel.y += s.pos.y * inv;
    s.vel.z += s.pos.z * inv;
    if (d > R) {
      // Failsafe only — the ramp above should make this unreachable.
      const k = R / d;
      s.pos.multiplyScalar(k);
      const out = (s.vel.x * s.pos.x + s.vel.y * s.pos.y + s.vel.z * s.pos.z) / (R * R);
      if (out > 0) s.vel.addScaledVector(s.pos, -out);
    }
  }
  // Gentle restore toward the ecliptic band, but never fight an order that
  // deliberately sits outside it.
  const H = CONFIG.mapHeight;
  if (Math.abs(s.pos.y) > H && !(_hasGoal && Math.abs(_goal.y) > H)) {
    const t = clamp((Math.abs(s.pos.y) - H) / H, 0, 1);
    s.vel.y -= Math.sign(s.pos.y) * sp.accel * 0.18 * t * dt;
  }
}

// ---------------------------------------------------------------------------
// Per-model integrators
// ---------------------------------------------------------------------------

/**
 * Arrival speed profile: the fastest speed from which this ship can still stop
 * on the destination using `BRAKE_AUTHORITY` of its acceleration.
 * v = sqrt(2*a*d) is the exact solution of the constant-decel stop, so tracking
 * it gives a clean asymptotic arrival with no oscillation.
 */
function arrivalSpeed(sp: ShipSpec, dist: number): number {
  const brake = sp.accel * BRAKE_AUTHORITY[sp.flight];
  const stopD = Math.max(0, dist - _arriveR);
  return Math.min(sp.speed, Math.sqrt(2 * brake * stopD));
}

/**
 * Agile / Utility: direct velocity seek. Utility gets a nose-on gate and much
 * softer gains so it reads as a slow freighter rather than a fighter.
 * Returns the thrust demand 0..1 for the engine FX.
 */
function seekIntegrate(s: Ship, sp: ShipSpec, want: number, dt: number): number {
  _desVel.copy(_dir).multiplyScalar(want);
  _acc.subVectors(_desVel, s.vel);
  const am = _acc.length();
  let maxA = sp.accel;
  if (sp.flight === FlightModel.Utility && am > 1e-6) {
    // Freighters have main drives and retros but no side thrusters: authority
    // falls off with the angle between the demand and the hull axis, in either
    // direction, so braking stays available while sliding sideways does not.
    maxA *= 0.35 + 0.65 * Math.abs(_acc.dot(s.fwd)) / am;
  }
  if (am > maxA && am > 1e-6) _acc.multiplyScalar(maxA / am);
  s.vel.addScaledVector(_acc, dt);
  return maxA > 1e-6 ? Math.min(1, am / maxA) : 0;
}

/**
 * Capital: thrust is applied along the hull axis only — no strafing, ever.
 * Forward thrust is gated on nose alignment (squared), so a capital swings onto
 * the bearing first and only then lights the main drives. Off-axis velocity is
 * bled away slowly, which is what turns a heading change into a long, heavy arc
 * instead of a snap.
 *
 * Returns the thrust demand 0..1 (retro burns read as 0 — the main plumes are
 * not what is firing).
 */
function capitalIntegrate(s: Ship, sp: ShipSpec, want: number, dt: number): number {
  const align = Math.max(0, s.fwd.dot(_dir));
  const gate = align * align;
  const vAlong = s.vel.dot(s.fwd);
  let thrust = clamp((want - vAlong) / Math.max(dt, 1e-4), -sp.accel, sp.accel);
  if (thrust > 0) thrust *= gate;
  s.vel.addScaledVector(s.fwd, thrust * dt);

  // Bleed the component perpendicular to the hull axis.
  const vA2 = s.vel.dot(s.fwd);
  _tmp.copy(s.vel).addScaledVector(s.fwd, -vA2);
  s.vel.addScaledVector(_tmp, -(1 - Math.exp(-CAPITAL_LATERAL_DAMP * dt)));

  return Math.max(0, thrust) / sp.accel;
}

/**
 * Yaw-dominant heading integrator for capitals. Heading is decomposed into
 * (yaw, pitch); pitch is rate-limited to a fraction of yaw so the hull turns
 * like a ship rather than a plane. Returns the applied yaw rate (rad/s, signed)
 * so the caller can derive the token amount of roll a capital shows in a turn.
 */
function capitalHeading(s: Ship, tgt: Vector3, sp: ShipSpec, dt: number): number {
  const yawRate = sp.turnRate * TURN_SCALE[FlightModel.Capital];
  const pitchRate = yawRate * CAPITAL_PITCH_FRAC;
  const curYaw = Math.atan2(s.fwd.x, s.fwd.z);
  const curPitch = Math.asin(clamp(s.fwd.y, -1, 1));
  const tgtYaw = Math.atan2(tgt.x, tgt.z);
  const tgtPitch = Math.asin(clamp(tgt.y, -1, 1));
  const dYaw = clamp(wrapPi(tgtYaw - curYaw), -yawRate * dt, yawRate * dt);
  const dPitch = clamp(tgtPitch - curPitch, -pitchRate * dt, pitchRate * dt);
  const ny = curYaw + dYaw;
  const np = clamp(curPitch + dPitch, -1.45, 1.45); // keep clear of the pole
  const cp = Math.cos(np);
  s.fwd.set(Math.sin(ny) * cp, Math.sin(np), Math.cos(ny) * cp).normalize();
  return dt > 1e-6 ? dYaw / dt : 0;
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * A ship still clearing the hangar. It flies straight out along the parent's
 * local forward at cruise, ignores orders, and ignores both separation (so the
 * parent hull cannot shove it back inside) and the map boundary (the parent is
 * inside the map, and the run is over in a second or two). Roll levels out.
 *
 * The parent is taken from `order.target` while `order.kind === 'launch'`; if
 * that is missing the ship simply extends on its own heading.
 */
function stepLaunch(world: World, s: Ship, sp: ShipSpec, dt: number): void {
  s.launchT = Math.max(0, s.launchT - dt);
  const parent = s.order.kind === 'launch' ? world.ship(s.order.target ?? -1) : undefined;
  _dir.copy(parent ? parent.fwd : s.fwd);
  if (_dir.lengthSq() < 1e-8) _dir.copy(s.fwd);
  _dir.normalize();
  rotateToward(s.fwd, _dir, sp.turnRate * 2.5 * dt);
  s.vel.copy(s.fwd).multiplyScalar(sp.speed * 0.9);
  s.pos.addScaledVector(s.vel, dt);
  rollToward(s, 0, sp.flight, dt);
  easeThrottle(s, 1, sp.flight, dt);
  applyBank(s);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Integrate every live ship for one fixed sim step.
 *
 * Requires `world.rebuildHash()` and `updateSquads()` to have run first.
 * Docked hulls are skipped entirely; launching hulls take the hangar exit path.
 */
export function stepMovement(world: World, dt: number): void {
  if (dt <= 0) return;
  collectBigHulls(world);

  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s.alive) continue;
    const sp = SHIP_SPECS[s.cls];

    // --- docked: parked inside a hangar, the render layer hides it ---------
    if (s.dockedIn >= 0) {
      s.vel.set(0, 0, 0);
      s.throttle = 0;
      continue;
    }

    // --- launching --------------------------------------------------------
    if (s.launchT > 0) {
      stepLaunch(world, s, sp, dt);
      continue;
    }

    const model = sp.flight;
    gatherSeparation(world, s, sp);
    resolveGoal(world, s, sp);

    // --- steering ---------------------------------------------------------
    let dist = 0;
    if (_hasGoal) {
      _dir.subVectors(_goal, s.pos);
      dist = _dir.length();
      if (dist > 1e-4) _dir.multiplyScalar(1 / dist);
      else _dir.copy(s.fwd);
    } else {
      _dir.copy(s.fwd);
    }

    let want = 0;
    if (_hasGoal) {
      want = _noBrake ? sp.speed : arrivalSpeed(sp, dist);
      if (!_noBrake && dist <= _arriveR) want = 0;
      want *= crowdRelief();
    }
    // With no goal `want` is 0 and `_dir` is the current heading, so the seek
    // degenerates into pure braking — the ship parks where it is.
    const idling = want <= 0.5;

    let demand: number;
    if (model === FlightModel.Capital) {
      demand = capitalIntegrate(s, sp, want, dt);
    } else {
      demand = seekIntegrate(s, sp, want, dt);
    }

    // --- desired heading --------------------------------------------------
    const speed = s.vel.length();
    if (_hasFace) {
      _face.normalize();
    } else if (model === FlightModel.Capital || model === FlightModel.Utility) {
      // Nose onto the destination; hold the current heading when parked.
      _face.copy(_hasGoal && dist > _arriveR ? _dir : s.fwd);
    } else if (speed > Math.max(6, sp.speed * 0.04)) {
      // Strike craft and brawlers point where they are actually going, with a
      // touch of lead toward the goal so the nose leads the drift slightly.
      _face.copy(s.vel).multiplyScalar(1 / speed);
      if (_hasGoal) _face.addScaledVector(_dir, 0.3);
      _face.normalize();
    } else {
      _face.copy(_hasGoal ? _dir : s.fwd);
    }

    // --- rotate + bank ----------------------------------------------------
    levelBasis(s); // level right axis, used to measure lateral demand
    let bankTarget = 0;

    if (model === FlightModel.Capital) {
      const yawRate = capitalHeading(s, _face, sp, dt);
      // A capital shows only a token amount of roll into its yaw.
      bankTarget = clamp((yawRate / Math.max(1e-4, sp.turnRate)) * BANK_GAIN[model], -1, 1) * sp.bankMax;
    } else {
      // Lateral acceleration in the level starboard axis -> bank into the turn.
      const aLat = _acc.dot(_lvlRight);
      bankTarget = clamp((aLat / sp.accel) * BANK_GAIN[model], -1, 1) * sp.bankMax;
      if (model === FlightModel.Agile && idling && !_hasFace) {
        // A whisper of roll so a parked wing is not perfectly rigid.
        //
        // This was 0.6 of bankMax, which on an interceptor (bankMax 1.3 rad) is
        // a continuous +-45 degree roll: a holding wing visibly rotated back and
        // forth and read as ships spinning in place rather than station-keeping.
        // At 0.09 and half the rate it is life, not motion.
        bankTarget = Math.sin(world.time * 0.22 + s.seed * TAU) * sp.bankMax * 0.09;
      }
      rotateToward(s.fwd, _face, sp.turnRate * TURN_SCALE[model] * dt);
    }
    rollToward(s, bankTarget, model, dt);

    // --- separation, bounds ----------------------------------------------
    //
    // STATION KEEPING. A ship that has reached its slot has `want = 0`, but
    // separation kept injecting velocity into it every tick with nothing
    // damping the result. That closes a limit cycle: separation shoves the hull
    // out past `_arriveR`, the seek wakes up and pulls it back, it coasts
    // through the slot, separation shoves it out again. The oscillation has the
    // period of the round trip and an amplitude of roughly `_arriveR`, which is
    // exactly the reported "click a destination and the ships go UP and DOWN
    // and SPREAD" — measured on a wing of eight interceptors as a +-6 m bob in
    // Y that never settled, with the group's vertical span breathing between
    // 14 m and 54 m indefinitely.
    //
    // Two changes, both only while parked:
    //
    //  1. Shallow separation is scaled back. It exists to stop hulls occupying
    //     the same space, and at rest in a formation they already do not. Deep
    //     interpenetration still gets full authority through `_sepDeep`, so two
    //     capitals ordered onto the same point still push apart.
    //  2. Residual velocity is damped toward zero. Without this, ANY impulse a
    //     parked hull picks up — separation, a bounds nudge, a blast — is kept
    //     forever, because nothing else in the loop removes it.
    const parked = !_hasGoal || (!_noBrake && dist <= _arriveR);
    if (parked) {
      const authority = 0.22 + 0.78 * clamp(_sepDeep * 3, 0, 1);
      s.vel.addScaledVector(_sep, dt * authority);
      // ~86% of the residual bled off per second. Fast enough to settle inside
      // a second, slow enough that it reads as a hull easing to a stop.
      const damp = Math.exp(-STATION_DAMP * dt);
      s.vel.multiplyScalar(damp);
    } else {
      s.vel.addScaledVector(_sep, dt);
    }
    applyBounds(s, sp, dt);

    // --- clamp + integrate ------------------------------------------------
    const v2 = s.vel.lengthSq();
    const vMax = sp.speed;
    if (v2 > vMax * vMax) s.vel.multiplyScalar(vMax / Math.sqrt(v2));
    s.pos.addScaledVector(s.vel, dt);

    // --- orientation + FX state ------------------------------------------
    applyBank(s);
    // Throttle blends idle glow, cruise glow and thrust demand: a parked hull
    // ticks over dim, a cruising hull glows warm, a hard burn saturates.
    const cruise = clamp(Math.sqrt(v2) / Math.max(1, sp.speed), 0, 1);
    easeThrottle(s, IDLE_GLOW + cruise * 0.35 + demand * 0.75, model, dt);
  }
}

/**
 * True if `cls` is heavy enough to shoulder other hulls aside rather than be
 * pushed. Exposed for AI/UI code that wants the same notion of "capital mass".
 */
export function isHeavyHull(cls: ShipClass): boolean {
  return SHIP_SPECS[cls].radius >= BIG_RADIUS;
}
