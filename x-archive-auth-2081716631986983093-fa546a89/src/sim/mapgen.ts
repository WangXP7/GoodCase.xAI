/**
 * SKIRMISH MAP GENERATION — how every match begins.
 *
 * Random skirmish is the only mode in Starfall, so this module composes the
 * opening frame of the entire game: where the two motherships hang, which way
 * they face, what the player's camera lands on when the match fades in, and
 * where the fight will happen.
 *
 * LAYOUT DOCTRINE (lifted straight from Homeworld's skirmish maps):
 *
 *   - Two motherships on opposite ends of a random axis through the origin, far
 *     enough apart that the first contact is a decision, not an accident.
 *   - A SAFE POCKET behind each start: a modest cluster of rocks a couple of
 *     minutes from home. This is the opening economy. It is defensible, and it
 *     runs out.
 *   - A CONTESTED CORE at the map centre: the big, rich rocks, split into a few
 *     sub-clusters so there is terrain to fight over rather than one blob. Every
 *     match therefore has the same arc — mine safe, tech up, then go take the
 *     middle — without the map ever repeating itself.
 *   - AMBIENT FIELD everywhere else, from `generateAsteroidField`, so the
 *     battlespace reads as a debris belt rather than three floating islands.
 *   - DERELICT HULKS drifting near the middle: dead Team.Neutral warships with
 *     almost no hull left. They cost nothing, they tell the player this place
 *     had a history before they arrived, and they give the mid-map a sense of
 *     scale that empty vacuum cannot.
 *
 * DETERMINISM: everything here draws from one `Rng` seeded off `opts.seed`,
 * forked per stage, so a seed always rebuilds the same universe — including the
 * ship instance seeds, because `World.spawnShip` pulls from `world.rng`.
 */

import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import { Rng } from '../core/rng';
import { SHIP_SPECS } from '../core/registry';
import { Formation, ShipClass, Stance, Team } from '../core/types';
import type { World } from './world';
import { generateAsteroidField, ROCK_VARIANTS } from '../world/asteroids';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Knobs for a skirmish map. Everything except `seed` has a sane default. */
export interface MapOptions {
  /** Master seed. The same seed always produces the same map. */
  seed: number;
  /** Total asteroids to place across all three tiers. Default 420. */
  asteroidCount?: number;
  /** Size of each side's opening fleet. Default 'standard'. */
  startFleet?: 'small' | 'standard' | 'large';
}

/** Where each side begins. Hand `playerStart` to the camera rig on match start. */
export interface MapResult {
  playerStart: Vector3;
  enemyStart: Vector3;
}

// ---------------------------------------------------------------------------
// Layout constants — all as fractions of CONFIG.mapRadius so retuning the
// battlespace scale does not require retuning the map.
// ---------------------------------------------------------------------------

/** Distance of each mothership from the origin. */
const START_RADIUS = 0.46;
/** Vertical separation of the two starts (they sit on slightly different decks). */
const START_DECK = 0.055;
/** Radius of the contested core cluster group. */
const CORE_SPREAD = 0.16;
/** Number of sub-clusters in the contested core. */
const CORE_CLUSTERS = 3;
/** Fraction of the rock budget that goes to the contested core. */
const CORE_SHARE = 0.28;
/** Fraction of the rock budget that goes to each home pocket. */
const POCKET_SHARE = 0.12;
/**
 * Home pocket geometry. Tight and close on purpose: the round trip out of the
 * berth and back sets the entire pace of the opening, and a pocket parked five
 * kilometres out turns the first three minutes into watching collectors commute.
 * `DIST` is measured *away* from the map centre (behind the mothership), so a
 * raid has to commit past the fleet to reach the mining.
 */
const POCKET_DIST = 0.07;
/** Lateral offset of a home pocket, so it is not on the attack lane. */
const POCKET_OFFSET = 0.055;
/** Radius of a home pocket cluster. */
const POCKET_SPREAD = 0.030;

/** Resource density: a core rock is worth this much more than a pocket rock. */
const CORE_RICHNESS = 2.4;

// Rock economics, mirrored from `src/world/asteroids.ts` so hand-placed rocks
// and the ambient belt obey one physical convention: value scales with volume.
// (These are private there; duplicating three numbers beats exporting internals
// and beats the map having two contradictory ideas of what a rock is worth.)
const RESOURCE_PER_M3 = 0.0006;
const RESOURCE_MIN = 70;
const RESOURCE_MAX = 12000;
/** Same clamp the field generator applies, so LOD/collision assumptions hold. */
const ROCK_RADIUS_MIN = 9;
const ROCK_RADIUS_MAX = 420;

/** Derelict hulks scattered around the middle. */
const HULK_COUNT_MIN = 5;
const HULK_COUNT_MAX = 8;
/** Radius of the band the hulks drift in, as a fraction of map radius. */
const HULK_BAND = 0.30;

/**
 * Hull classes used for wrecks. Deliberately excludes anything with a hangar
 * (Carrier / Refinery / Mothership): those register a `Producer` and shift the
 * supply cap on spawn, and a corpse should own neither.
 */
const HULK_CLASSES: readonly ShipClass[] = [
  ShipClass.HeavyCruiser,
  ShipClass.Destroyer,
  ShipClass.AssaultFrigate,
  ShipClass.IonFrigate,
  ShipClass.AssaultCorvette,
  ShipClass.MissileCorvette,
  ShipClass.Bomber,
];

// ---------------------------------------------------------------------------
// Starting fleets
// ---------------------------------------------------------------------------

/** Composition of an opening fleet. Every class here is unlocked at tier 0. */
interface FleetPlan {
  collectors: number;
  scouts: number;
  /** Interceptors per wing. */
  wingSize: number;
  /** Number of interceptor wings. */
  wings: number;
}

const FLEETS: Record<'small' | 'standard' | 'large', FleetPlan> = {
  small: { collectors: 3, scouts: 1, wingSize: 4, wings: 1 },
  standard: { collectors: 4, scouts: 2, wingSize: 4, wings: 2 },
  large: { collectors: 6, scouts: 2, wingSize: 5, wings: 3 },
};

// ---------------------------------------------------------------------------
// Scratch — generation is one-shot, but keeping the hot helpers allocation-free
// keeps the loading hitch off the first frame.
// ---------------------------------------------------------------------------

const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _tmp = new Vector3();
const _slot = new Vector3();
const _pocket = new Vector3();
const _spin = new Vector3();
const _ids: number[] = [];

/** Shared origin constant — the contested core is always centred on the map. */
const ZERO = new Vector3(0, 0, 0);

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a complete skirmish map into `world`: asteroids, derelicts, both
 * motherships and both opening fleets, all deterministic from `opts.seed`.
 *
 * The world is expected to be freshly constructed (empty pools). Returns the
 * two mothership positions so the camera can open on the player's fleet and the
 * AI can be told where its opponent lives.
 */
export function generateMap(world: World, opts: MapOptions): MapResult {
  const rng = new Rng(opts.seed >>> 0);
  const total = Math.max(60, opts.asteroidCount ?? 420);
  const fleet = FLEETS[opts.startFleet ?? 'standard'];
  const R = CONFIG.mapRadius;

  // -- 1. Choose the contest axis ------------------------------------------
  // A random bearing in the XZ plane plus a small deck separation on Y. Keeping
  // the axis horizontal keeps both starts inside the band where the nebula and
  // dust look best, while the deck offset stops the map reading as 2D.
  const bearing = rng.range(0, Math.PI * 2);
  const ax = Math.cos(bearing);
  const az = Math.sin(bearing);
  const d = R * START_RADIUS;
  const deck = R * START_DECK * 0.5;

  const playerStart = new Vector3(ax * d, -deck, az * d);
  const enemyStart = new Vector3(-ax * d, deck, -az * d);

  // -- 2. Asteroids ---------------------------------------------------------
  const coreCount = Math.round(total * CORE_SHARE);
  const pocketCount = Math.round(total * POCKET_SHARE);
  const ambientCount = Math.max(0, total - coreCount - pocketCount * 2);

  const coreRng = rng.fork(11);
  const pocketRng = rng.fork(12);
  const ambientRng = rng.fork(13);
  const hulkRng = rng.fork(14);

  // ORDER MATTERS: `generateAsteroidField` resets the asteroid pool, so the
  // ambient belt must be laid down BEFORE anything hand-placed. It shapes a
  // belt disc between ~0.30R and ~0.66R, which leaves the map centre bare —
  // exactly the hole the contested core is meant to fill.
  if (ambientCount > 0) {
    generateAsteroidField(world, ambientRng, {
      count: ambientCount,
      clusters: Math.max(4, Math.round(ambientCount / 34)),
    });
  }

  placeCluster(world, coreRng, coreCount, CORE_CLUSTERS, ZERO, R * CORE_SPREAD, CORE_RICHNESS);
  placePocket(world, pocketRng, pocketCount, playerStart, ax, az, R);
  placePocket(world, pocketRng, pocketCount, enemyStart, -ax, -az, R);

  // Both starts sit inside the belt band, which is the right call — you begin
  // *in* the resource field — but a 2 km mothership must not spawn with a rock
  // buried in its dorsal spine. Sweep a berth around each start.
  clearBerth(world, playerStart);
  clearBerth(world, enemyStart);

  // -- 3. Derelicts ---------------------------------------------------------
  placeHulks(world, hulkRng, R);

  // -- 4. Fleets ------------------------------------------------------------
  // Both sides face the origin: the opening camera looks down the attack lane,
  // and the first order the player gives is already pointed the right way.
  deploy(world, Team.Player, playerStart, rng.fork(21), fleet);
  deploy(world, Team.Enemy, enemyStart, rng.fork(22), fleet);

  return { playerStart, enemyStart };
}

// ---------------------------------------------------------------------------
// Asteroid placement
// ---------------------------------------------------------------------------

/**
 * Spawn one rock, obeying the same value-per-volume law and the same spin/mass
 * relationship the ambient field generator uses. `richness` multiplies value
 * only — a core rock is not bigger than a pocket rock of the same radius, it is
 * denser, which is what lets the player learn "the middle is worth taking"
 * without the middle looking like a different map.
 */
function spawnRock(
  world: World, rng: Rng, x: number, y: number, z: number,
  radius: number, richness: number,
): boolean {
  const a = world.asteroids.spawn();
  if (!a) return false;
  const rad = clamp(radius, ROCK_RADIUS_MIN, ROCK_RADIUS_MAX);
  a.pos.set(x, y, z);
  a.radius = rad;
  const vol = rad * rad * rad;
  a.amountMax = Math.round(clamp(RESOURCE_PER_M3 * vol * richness, RESOURCE_MIN, RESOURCE_MAX));
  a.amount = a.amountMax;
  // Angular momentum falls off with mass: pebbles visibly tumble, monsters
  // barely drift. That contrast is a large part of how the eye reads scale.
  rng.onSphere(_spin);
  const w = clamp(rng.range(0.012, 0.14) * Math.pow(36 / rad, 0.45), 0.003, 0.24);
  a.spin.set(_spin.x * w, _spin.y * w, _spin.z * w);
  a.rot.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
  a.variant = rng.int(0, ROCK_VARIANTS - 1);
  a.seed = rng.next();
  return true;
}

const TAU = Math.PI * 2;

/** Clamp helper — local so this module has no cross-imports for three lines. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Scatter `count` rocks over `clusters` sub-clumps inside `spread` of `centre`.
 * Clumping (rather than uniform noise) is what makes a field navigable: there
 * are lanes between the clumps, so fleets have somewhere to manoeuvre and
 * collectors have a reason to prefer one patch over another.
 */
function placeCluster(
  world: World, rng: Rng, count: number, clusters: number,
  centre: Vector3, spread: number, richness: number,
): void {
  if (count <= 0) return;
  // Snapshot the centre: `_tmp` is our scratch below, and callers legitimately
  // pass a scratch vector in, so reading `centre` after the first sphere draw
  // would read back our own working state.
  const ox = centre.x, oy = centre.y, oz = centre.z;
  const per = Math.max(1, Math.round(count / clusters));
  for (let c = 0; c < clusters; c++) {
    // Sub-clump centre on a shell inside `spread`; cbrt keeps them from all
    // piling into the middle of the group.
    rng.onSphere(_tmp);
    const rad = spread * Math.cbrt(rng.next()) * 0.85;
    const cx = ox + _tmp.x * rad;
    // Squash Y — content clusters near the ecliptic, which is what gives the
    // battlespace a readable "up".
    const cy = oy + _tmp.y * rad * 0.34;
    const cz = oz + _tmp.z * rad;
    const clumpR = spread * rng.range(0.18, 0.38);

    for (let i = 0; i < per; i++) {
      rng.onSphere(_tmp);
      const rr = clumpR * Math.cbrt(rng.next());
      // Rock size: a long tail of small debris with a few anchors.
      const t = rng.next();
      const radius = 34 + t * t * t * 230 * (0.6 + richness * 0.35);
      spawnRock(
        world, rng,
        cx + _tmp.x * rr,
        cy + _tmp.y * rr * 0.4,
        cz + _tmp.z * rr,
        radius,
        richness * rng.range(0.8, 1.25),
      );
    }
  }
}

/**
 * Radius swept clear of rock around a mothership berth. Sized off the hull
 * itself (2100 m long) plus the screen the opening fleet forms in front of it.
 */
const BERTH_RADIUS = SHIP_SPECS[ShipClass.Mothership].length * 1.15;

/** Delete every asteroid intersecting the berth around `at`. */
function clearBerth(world: World, at: Vector3): void {
  const pool = world.asteroids;
  for (let i = 0; i < pool.count; i++) {
    const a = pool.items[i];
    if (!a.alive) continue;
    const r = BERTH_RADIUS + a.radius;
    if (a.pos.distanceToSquared(at) < r * r) pool.kill(a.id);
  }
}

/**
 * The defensible opening field. Offset laterally from the home-to-centre axis
 * so early collectors are not parked in the middle of the attack lane, and
 * pulled slightly *behind* the mothership so a raid has to commit to reach it.
 */
function placePocket(
  world: World, rng: Rng, count: number,
  start: Vector3, ax: number, az: number, R: number,
): void {
  // `(ax, az)` points from the origin toward this start, so +axis is "behind".
  const px = -az, pz = ax; // perpendicular in the XZ plane
  const side = rng.chance(0.5) ? 1 : -1;
  const cx = start.x + ax * R * POCKET_DIST + px * side * R * POCKET_OFFSET;
  const cz = start.z + az * R * POCKET_DIST + pz * side * R * POCKET_OFFSET;
  const cy = start.y + rng.sign() * CONFIG.mapHeight * 0.08;
  _pocket.set(cx, cy, cz);
  placeCluster(world, rng, count, 2, _pocket, R * POCKET_SPREAD, 1.0);
}

// ---------------------------------------------------------------------------
// Derelicts
// ---------------------------------------------------------------------------

/**
 * Dead ships drifting through the contested band. They are real `Ship` entities
 * on `Team.Neutral` with a sliver of hull left and no orders, so they collide,
 * occlude, catch the sun and can be finished off by a bored interceptor — but
 * they never move, never shoot and never join the supply war.
 */
function placeHulks(world: World, rng: Rng, R: number): void {
  const n = rng.int(HULK_COUNT_MIN, HULK_COUNT_MAX);
  for (let i = 0; i < n; i++) {
    const cls = rng.pick(HULK_CLASSES);
    const sp = SHIP_SPECS[cls];

    // Position: a shell around the middle, biased outward so wrecks frame the
    // contested core instead of sitting inside the mining field.
    const a = rng.range(0, Math.PI * 2);
    const rad = R * HULK_BAND * rng.range(0.45, 1.0);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const y = rng.gauss() * CONFIG.mapHeight * 0.16;

    const s = world.spawnShip(cls, Team.Neutral, x, y, z);
    if (!s) return;

    // Attitude: a wreck tumbled to a stop at whatever angle it died at.
    rng.onSphere(s.fwd);
    rng.onSphere(_up);
    // Gram-Schmidt the up vector against fwd; if they were near-parallel, fall
    // back to a world axis so we never build a degenerate basis.
    _up.addScaledVector(s.fwd, -_up.dot(s.fwd));
    if (_up.lengthSq() < 1e-4) _up.set(0, 1, 0).addScaledVector(s.fwd, -s.fwd.y);
    if (_up.lengthSq() < 1e-4) _up.set(1, 0, 0).addScaledVector(s.fwd, -s.fwd.x);
    s.up.copy(_up).normalize();
    s.bank = 0;

    s.hp = Math.max(1, sp.maxHp * rng.range(0.015, 0.05));
    s.shield = 0;
    s.sinceHit = 999;
    s.damage = rng.range(0.82, 1.0);
    s.throttle = 0;
    s.vel.set(0, 0, 0);
    s.stance = Stance.Passive;
    s.order.kind = 'idle';
    s.queue.length = 0;
    s.target = -1;
  }
}

// ---------------------------------------------------------------------------
// Fleet deployment
// ---------------------------------------------------------------------------

/**
 * Spawn one side: mothership plus its opening fleet, all facing the map centre
 * and already sitting in their formation slots. Nothing here issues orders —
 * the world is handed over pre-arranged so frame zero looks like a fleet that
 * has been holding station, not a pile of ships that just materialised.
 */
function deploy(world: World, team: Team, start: Vector3, rng: Rng, plan: FleetPlan): void {
  // Basis: forward toward the origin, up world-Y orthonormalised, right = up x
  // fwd (the registry's right-handed [right, up, forward] convention).
  _fwd.copy(start).multiplyScalar(-1);
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _up.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y);
  if (_up.lengthSq() < 1e-4) _up.set(0, 0, 1).addScaledVector(_fwd, -_fwd.z);
  _up.normalize();
  _right.copy(_up).cross(_fwd).normalize();

  const msSpec = SHIP_SPECS[ShipClass.Mothership];
  const ms = world.spawnShip(ShipClass.Mothership, team, start.x, start.y, start.z);
  if (ms) {
    ms.fwd.copy(_fwd);
    ms.up.copy(_up);
    ms.stance = Stance.Neutral;
    // Rally the yard out in front of the bow so new hulls do not launch into
    // the hull they were built in.
    const p = world.producers.get(ms.id);
    if (p) {
      p.rally = new Vector3()
        .copy(start)
        .addScaledVector(_fwd, msSpec.length * 1.1)
        .addScaledVector(_up, msSpec.radius * 0.25);
    }
  }

  // Screen distance: everything forms up ahead of and above the mothership so
  // the opening camera shot has the fleet in front of the hull, not inside it.
  const screen = msSpec.length * 0.75;

  // -- collectors: a loose line abeam, dropped low toward the pocket ---------
  _ids.length = 0;
  const colSpec = SHIP_SPECS[ShipClass.ResourceCollector];
  const colGap = colSpec.radius * CONFIG.separationPad * 3.2;
  for (let i = 0; i < plan.collectors; i++) {
    lineSlot(i, plan.collectors, colGap, _slot);
    const s = spawnAt(world, ShipClass.ResourceCollector, team, start, screen * 0.55, _slot, -msSpec.radius * 0.35, rng);
    if (!s) break;
    s.stance = Stance.Passive;
    _ids.push(s.id);
    // Put them straight onto the nearest rock: the home pocket. A skirmish that
    // opens with an idle mining fleet feels broken before the player has moved.
    const rock = world.nearestRock(s.pos.x, s.pos.y, s.pos.z, CONFIG.mapRadius);
    if (rock >= 0) {
      // Mutate in place rather than replacing the object: the order layer keeps
      // `Ship.order` identity stable and writes destinations into it every tick.
      s.order.kind = 'harvest';
      s.order.rock = rock;
      s.order.target = undefined;
      s.order.manual = false;
      s.harvestPhase = 0;
    }
  }
  if (_ids.length > 1) {
    const sq = world.makeSquad(team, _ids, Formation.Line);
    sq.fwd.copy(_fwd);
    squadAnchor(world, sq.members, sq.anchor);
  }

  // -- scout wing: high and forward, the eyes of the fleet -------------------
  if (plan.scouts > 0) {
    _ids.length = 0;
    const scSpec = SHIP_SPECS[ShipClass.Scout];
    const gap = scSpec.radius * CONFIG.separationPad * 4.0;
    for (let i = 0; i < plan.scouts; i++) {
      deltaSlot(i, gap, _slot);
      const s = spawnAt(world, ShipClass.Scout, team, start, screen * 1.35, _slot, msSpec.radius * 0.42, rng);
      if (!s) break;
      s.stance = Stance.Evasive;
      _ids.push(s.id);
    }
    if (_ids.length > 0) {
      const sq = world.makeSquad(team, _ids, Formation.Delta);
      sq.fwd.copy(_fwd);
      squadAnchor(world, sq.members, sq.anchor);
    }
  }

  // -- interceptor wings: staggered echelon either side of the bow -----------
  const intSpec = SHIP_SPECS[ShipClass.Interceptor];
  const intGap = intSpec.radius * CONFIG.separationPad * 3.4;
  for (let w = 0; w < plan.wings; w++) {
    _ids.length = 0;
    // Alternate wings port/starboard, each one a little further out and back.
    const side = w % 2 === 0 ? 1 : -1;
    const tier = Math.floor(w / 2);
    const lateral = side * (msSpec.radius * 0.55 + tier * msSpec.radius * 0.42);
    const depth = screen * (1.0 - tier * 0.22);
    for (let i = 0; i < plan.wingSize; i++) {
      deltaSlot(i, intGap, _slot);
      _slot.x += lateral;
      const s = spawnAt(world, ShipClass.Interceptor, team, start, depth, _slot, msSpec.radius * 0.12, rng);
      if (!s) break;
      _ids.push(s.id);
    }
    if (_ids.length > 0) {
      const sq = world.makeSquad(team, _ids, Formation.Delta);
      sq.fwd.copy(_fwd);
      squadAnchor(world, sq.members, sq.anchor);
    }
  }
}

/** Centroid of a squad's live members, written into `out`. */
function squadAnchor(world: World, members: readonly number[], out: Vector3): void {
  out.set(0, 0, 0);
  let n = 0;
  for (let i = 0; i < members.length; i++) {
    const s = world.ship(members[i]);
    if (!s) continue;
    out.add(s.pos);
    n++;
  }
  if (n > 0) out.multiplyScalar(1 / n);
}

/**
 * Spawn one ship at `origin + fwd*depth + right*slot.x + up*(rise + slot.y) +
 * fwd*slot.z`, oriented down the fleet axis with a whisper of deterministic
 * jitter so the formation reads as flown rather than instanced.
 */
function spawnAt(
  world: World, cls: ShipClass, team: Team, origin: Vector3,
  depth: number, slot: Vector3, rise: number, rng: Rng,
) {
  const jitter = SHIP_SPECS[cls].radius * 0.6;
  _tmp.copy(origin)
    .addScaledVector(_fwd, depth + slot.z + rng.sign() * jitter)
    .addScaledVector(_right, slot.x + rng.sign() * jitter)
    .addScaledVector(_up, rise + slot.y + rng.sign() * jitter);
  const s = world.spawnShip(cls, team, _tmp.x, _tmp.y, _tmp.z);
  if (!s) return null;
  s.fwd.copy(_fwd);
  s.up.copy(_up);
  s.bank = 0;
  return s;
}

/** Delta (V) slot: leader at 0, then alternating wingmen swept aft. */
function deltaSlot(i: number, gap: number, out: Vector3): void {
  if (i === 0) {
    out.set(0, 0, 0);
    return;
  }
  const rank = Math.ceil(i / 2);
  const side = i % 2 === 1 ? 1 : -1;
  out.set(side * rank * gap, (rank & 1) === 0 ? gap * 0.22 : -gap * 0.18, -rank * gap * 0.8);
}

/** Line-abreast slot, centred on the formation axis. */
function lineSlot(i: number, n: number, gap: number, out: Vector3): void {
  const half = (n - 1) * 0.5;
  out.set((i - half) * gap, 0, (i & 1) === 0 ? 0 : -gap * 0.25);
}
