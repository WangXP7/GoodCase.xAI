/**
 * Resources, harvesting, production and research.
 *
 * This is the strategic clock of the game: collectors shuttle between rocks and
 * dropoffs, hangars burn resources over time to push hulls out of the tube, and
 * each faction grinds one research project at a time.
 *
 * DESIGN NOTES
 * ------------
 *  - The harvest cycle owns `Ship.harvestPhase` and, while a collector is on a
 *    'harvest' order, its `order.x/y/z` destination. `orders.ts` deliberately
 *    leaves harvest orders alone apart from validating the rock reference, so
 *    the two files never fight over the same fields.
 *  - Production deducts resources INCREMENTALLY (`BuildJob.paid`) rather than
 *    charging up front. A cancel refunds exactly what was sunk, and a bankrupt
 *    faction stalls its line smoothly instead of stopping dead.
 *  - `FactionState` has no fields for combat modifiers, so completed research is
 *    reduced into `factionMods()` — combat/movement read the multipliers there.
 *  - Nothing here imports FX. Everything visual leaves through the bus
 *    ('delivered', 'built', 'notice').
 */

import { Vector3 } from 'three';
import { bus } from '../core/bus';
import { CONFIG } from '../core/config';
import { RESEARCH_BY_ID, SHIP_SPECS, STARTING_UNLOCKS } from '../core/registry';
import {
  ShipClass,
  Team,
  TEAM_COUNT,
  type GameEvents,
  type Producer,
  type Ship,
} from '../core/types';
import type { World } from './world';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Max jobs per hangar queue. */
const MAX_BUILD_QUEUE = 12;
/** Seconds a freshly built hull spends in the launch tube (matches orders.ts). */
const LAUNCH_TIME = 1.4;
/** Extra clearance a collector keeps off a rock surface while mining. */
const MINE_CLEARANCE = 28;
/** Penalty weight per rival collector already working a rock. */
const CONTEST_WEIGHT = 0.85;
/** Seconds between repeats of the same throttled notice. */
const NOTICE_GAP = 14;

/**
 * Asteroids visibly shrink as they are stripped. When the remaining fraction
 * crosses a threshold the radius is scaled once — stateless, monotone, and it
 * needs no extra field on `Asteroid`.
 */
const SHRINK_AT = [0.66, 0.34, 0.14];
const SHRINK_MUL = [0.9, 0.86, 0.78];

// ---------------------------------------------------------------------------
// Module scratch — this file allocates nothing per tick.
// ---------------------------------------------------------------------------

const _v = new Vector3();

/** Rock claim counts, refreshed at most once per tick and only on demand. */
const _claims = new Int32Array(CONFIG.maxAsteroids);
let _claimsTick = -1;

/** Reused bus payloads (the bus contract allows emitter-owned objects). */
const _deliveredEv: GameEvents['delivered'] = { team: Team.Neutral, amount: 0, x: 0, y: 0, z: 0 };
const _builtEv: GameEvents['built'] = { id: -1, cls: ShipClass.Scout, team: Team.Neutral };
const _noticeEv: GameEvents['notice'] = { text: '', kind: 'info' };

/** Throttle stamps for player-facing spam. */
let _lastAttackNotice = -1e9;
let _lastExhaustNotice = -1e9;
let _lastSupplyNotice = -1e9;

/** Set while a pass detects damage on player hulls. */
let _playerHit = false;

// ---------------------------------------------------------------------------
// Research modifiers
// ---------------------------------------------------------------------------

/** Multiplicative combat/movement modifiers granted by completed research. */
export interface FactionMods {
  damage: number;
  armour: number;
  speed: number;
  shield: number;
}

const _mods: FactionMods[] = [];
const _modsStamp = new Int32Array(TEAM_COUNT).fill(-1);
for (let t = 0; t < TEAM_COUNT; t++) _mods.push({ damage: 1, armour: 1, speed: 1, shield: 1 });

/**
 * Current research multipliers for `team`. Recomputed only when that faction
 * completes something, so callers may hit this every frame.
 */
export function factionMods(world: World, team: Team): FactionMods {
  const f = world.factions[team];
  const m = _mods[team];
  if (!f) return m;
  if (_modsStamp[team] === f.research.size) return m;
  _modsStamp[team] = f.research.size;
  m.damage = 1; m.armour = 1; m.speed = 1; m.shield = 1;
  f.research.forEach((id) => {
    const r = RESEARCH_BY_ID.get(id);
    if (!r || !r.mods) return;
    if (r.mods.damage) m.damage *= r.mods.damage;
    if (r.mods.armour) m.armour *= r.mods.armour;
    if (r.mods.speed) m.speed *= r.mods.speed;
    if (r.mods.shield) m.shield *= r.mods.shield;
  });
  return m;
}

/** True if `team` may build `cls` right now (starting roster + research). */
export function isUnlocked(world: World, team: Team, cls: ShipClass): boolean {
  for (let i = 0; i < STARTING_UNLOCKS.length; i++) if (STARTING_UNLOCKS[i] === cls) return true;
  const f = world.factions[team];
  if (!f) return false;
  let ok = false;
  f.research.forEach((id) => {
    if (ok) return;
    const r = RESEARCH_BY_ID.get(id);
    if (r && r.unlocks.indexOf(cls) >= 0) ok = true;
  });
  return ok;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** Emit a player-facing log line (payload object is reused — consumers copy). */
function notice(text: string, kind: 'info' | 'warn' | 'alert'): void {
  _noticeEv.text = text;
  _noticeEv.kind = kind;
  bus.emit('notice', _noticeEv);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Queue a hull on a producer. Returns false if the order is illegal. */
export function enqueueBuild(world: World, producerId: number, cls: ShipClass): boolean {
  const p = world.producers.get(producerId);
  const host = world.ships.get(producerId);
  if (!p || !host) return false;
  if (SHIP_SPECS[host.cls].builds.indexOf(cls) < 0) return false;
  if (!isUnlocked(world, host.team, cls)) return false;
  if (p.queue.length >= MAX_BUILD_QUEUE) return false;
  const sp = SHIP_SPECS[cls];
  if (sp.buildTime <= 0) return false;
  p.queue.push({ cls, remaining: sp.buildTime, total: sp.buildTime, paid: 0 });
  return true;
}

/** Cancel a queued job and refund exactly what has been paid into it so far. */
export function cancelBuild(world: World, producerId: number, index: number): void {
  const p = world.producers.get(producerId);
  const host = world.ships.get(producerId);
  if (!p || !host) return;
  if (index < 0 || index >= p.queue.length) return;
  const job = p.queue[index];
  world.factions[host.team].resources += job.paid;
  p.queue.splice(index, 1);
  if (host.team === Team.Player) notice(`${SHIP_SPECS[job.cls].name} cancelled`, 'info');
}

/** Begin a research project. One active project per faction; cost is up front. */
export function startResearch(world: World, team: Team, id: string): boolean {
  const f = world.factions[team];
  const r = RESEARCH_BY_ID.get(id);
  if (!f || !r) return false;
  if (f.researching || f.research.has(id)) return false;
  for (let i = 0; i < r.requires.length; i++) if (!f.research.has(r.requires[i])) return false;
  if (f.resources < r.cost) {
    if (team === Team.Player) notice(`Insufficient resources for ${r.name}`, 'warn');
    return false;
  }
  f.resources -= r.cost;
  f.researching = { id, remaining: r.time, total: r.time };
  if (team === Team.Player) notice(`${r.name}: research started`, 'info');
  return true;
}

/**
 * Advance harvesting, production and research by `dt`. Call once per fixed sim
 * step (after orders, before or after combat — it does not read combat state
 * beyond `Ship.sinceHit`).
 */
export function stepEconomy(world: World, dt: number): void {
  _playerHit = false;

  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s.alive) continue;

    if (s.team === Team.Player && s.sinceHit <= dt * 1.5) _playerHit = true;

    if (s.dockedIn < 0 && SHIP_SPECS[s.cls].harvest) {
      // A parked collector is a bug, not a decision. Anything with a harvest
      // capability that has run out of orders puts itself back on the field.
      //
      // Production already hands a newly built collector a harvest order, but
      // the collectors placed at map start never had one, so an opening fleet
      // sat idle next to a resource field until the player noticed. Self-
      // assigning here covers both, and covers a collector that finishes a
      // player-issued move and would otherwise stop for good.
      //
      // Only `idle` is claimed: a manual move, dock or attack-move order is the
      // player overriding the default and must be left alone until it completes.
      if (s.order.kind === 'idle' && s.queue.length === 0) {
        s.order.kind = 'harvest';
        s.order.rock = undefined;
        s.order.manual = false;
        s.harvestPhase = 0;
      }
      if (s.order.kind === 'harvest') stepCollector(world, s, dt);
    }

    const p = world.producers.get(s.id);
    if (p) stepProducer(world, s, p, dt);
  }

  stepResearch(world, dt);

  if (_playerHit && world.time - _lastAttackNotice > NOTICE_GAP) {
    _lastAttackNotice = world.time;
    notice('Fleet under attack', 'alert');
  }
}

// ---------------------------------------------------------------------------
// Harvesting
// ---------------------------------------------------------------------------

/** Refresh the per-rock claim counts, at most once per tick. */
function refreshClaims(world: World): void {
  if (_claimsTick === world.tick) return;
  _claimsTick = world.tick;
  _claims.fill(0);
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s.alive || s.order.kind !== 'harvest') continue;
    const r = s.order.rock;
    if (r !== undefined && r >= 0 && r < _claims.length) _claims[r]++;
  }
}

/**
 * Choose the next rock for `s`: nearest, but weighted against rocks other
 * collectors are already working so a fleet fans out over the field.
 */
function pickRock(world: World, s: Ship): number {
  refreshClaims(world);
  const rocks = world.asteroids;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rocks.count; i++) {
    const a = rocks.items[i];
    if (!a.alive || a.amount <= 0) continue;
    const dx = a.pos.x - s.pos.x, dy = a.pos.y - s.pos.y, dz = a.pos.z - s.pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const score = d * (1 + CONTEST_WEIGHT * _claims[a.id]);
    if (score < bestScore) {
      bestScore = score;
      best = a.id;
    }
  }
  return best;
}

/** Drive one collector through acquire -> mine -> haul -> deliver. */
function stepCollector(world: World, s: Ship, dt: number): void {
  const sp = SHIP_SPECS[s.cls];
  const harvest = sp.harvest!;

  // Full holds always head home, whatever the rock situation is.
  if (s.cargo >= harvest.capacity && s.harvestPhase !== 3) s.harvestPhase = 3;

  if (s.harvestPhase === 0 || s.order.rock === undefined) {
    if (s.harvestPhase === 3) {
      // Hauling; the rock is re-picked after delivery.
    } else {
      const id = pickRock(world, s);
      if (id < 0) {
        if (s.cargo > 0) {
          s.harvestPhase = 3;
        } else {
          s.order.rock = undefined;
          if (s.team === Team.Player && world.time - _lastExhaustNotice > NOTICE_GAP * 2) {
            _lastExhaustNotice = world.time;
            notice('Resource field exhausted', 'warn');
          }
          return;
        }
      } else {
        s.order.rock = id;
        s.harvestPhase = 1;
      }
    }
  }

  switch (s.harvestPhase) {
    case 1: approachRock(world, s, sp.radius); break;
    case 2: mineRock(world, s, dt, harvest.rate, harvest.capacity); break;
    case 3: deliver(world, s); break;
    default: break;
  }
}

/** Phase 1 — fly to a point just off the rock's surface. */
function approachRock(world: World, s: Ship, shipRadius: number): void {
  const a = world.asteroids.get(s.order.rock ?? -1);
  if (!a || a.amount <= 0) {
    s.order.rock = undefined;
    s.harvestPhase = s.cargo > 0 ? 3 : 0;
    return;
  }
  const stand = a.radius + shipRadius * 1.6 + MINE_CLEARANCE;
  _v.copy(s.pos).sub(a.pos);
  if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
  _v.normalize().multiplyScalar(stand).add(a.pos);
  s.order.x = _v.x;
  s.order.y = _v.y;
  s.order.z = _v.z;

  const dx = s.pos.x - _v.x, dy = s.pos.y - _v.y, dz = s.pos.z - _v.z;
  const reach = shipRadius * 1.4 + 60;
  if (dx * dx + dy * dy + dz * dz <= reach * reach) s.harvestPhase = 2;
}

/** Phase 2 — strip the rock, shrinking it as its reserves drop. */
function mineRock(world: World, s: Ship, dt: number, rate: number, capacity: number): void {
  const a = world.asteroids.get(s.order.rock ?? -1);
  if (!a || a.amount <= 0) {
    s.order.rock = undefined;
    s.harvestPhase = s.cargo > 0 ? 3 : 0;
    return;
  }
  // Hold station on the surface point while the beam runs.
  approachHold(s, a.pos.x, a.pos.y, a.pos.z, a.radius + SHIP_SPECS[s.cls].radius * 1.6 + MINE_CLEARANCE);

  let take = rate * dt;
  const room = capacity - s.cargo;
  if (take > room) take = room;
  if (take > a.amount) take = a.amount;
  if (take <= 0) {
    s.harvestPhase = 3;
    return;
  }

  const before = a.amountMax > 0 ? a.amount / a.amountMax : 0;
  a.amount -= take;
  s.cargo += take;
  const after = a.amountMax > 0 ? a.amount / a.amountMax : 0;
  for (let i = 0; i < SHRINK_AT.length; i++) {
    if (before > SHRINK_AT[i] && after <= SHRINK_AT[i]) a.radius *= SHRINK_MUL[i];
  }

  if (a.amount <= 0) {
    a.amount = 0;
    s.order.rock = undefined;
    s.harvestPhase = s.cargo > 0 ? 3 : 0;
    return;
  }
  if (s.cargo >= capacity) s.harvestPhase = 3;
}

/** Keep the mining destination pinned to the surface point (no drift). */
function approachHold(s: Ship, cx: number, cy: number, cz: number, stand: number): void {
  _v.set(s.pos.x - cx, s.pos.y - cy, s.pos.z - cz);
  if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
  _v.normalize().multiplyScalar(stand);
  s.order.x = cx + _v.x;
  s.order.y = cy + _v.y;
  s.order.z = cz + _v.z;
}

/** Phase 3 — haul to the nearest dropoff and unload. */
function deliver(world: World, s: Ship): void {
  const hostId = world.nearestDropoff(s.pos.x, s.pos.y, s.pos.z, s.team);
  const host = world.ships.get(hostId);
  if (!host) {
    // Nowhere to unload — sit on the cargo until a refinery exists again.
    s.order.x = s.pos.x;
    s.order.y = s.pos.y;
    s.order.z = s.pos.z;
    return;
  }
  const hs = SHIP_SPECS[host.cls];
  // Same hangar approach convention orders.ts uses: host position + local -Z * radius.
  _v.copy(host.pos).addScaledVector(host.fwd, -hs.radius);
  s.order.x = _v.x;
  s.order.y = _v.y;
  s.order.z = _v.z;

  const dx = s.pos.x - _v.x, dy = s.pos.y - _v.y, dz = s.pos.z - _v.z;
  const reach = hs.radius * 0.55 + SHIP_SPECS[s.cls].radius + 70;
  if (dx * dx + dy * dy + dz * dz > reach * reach) return;

  const amount = s.cargo;
  if (amount > 0) {
    world.factions[s.team].resources += amount;
    _deliveredEv.team = s.team;
    _deliveredEv.amount = amount;
    _deliveredEv.x = s.pos.x;
    _deliveredEv.y = s.pos.y;
    _deliveredEv.z = s.pos.z;
    bus.emit('delivered', _deliveredEv);
  }
  s.cargo = 0;
  s.order.rock = undefined;
  s.harvestPhase = 0; // re-acquire next tick, contest-weighted
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/** Tick one hangar's build queue. */
function stepProducer(world: World, host: Ship, p: Producer, dt: number): void {
  if (p.queue.length === 0) return;
  const job = p.queue[0];
  const sp = SHIP_SPECS[job.cls];
  const f = world.factions[host.team];

  if (job.remaining > 0) {
    // Pay as we go: the line runs at whatever fraction of the tick we can afford.
    const owed = sp.cost - job.paid;
    let progress = dt;
    if (owed > 0) {
      let want = (sp.cost / Math.max(0.001, sp.buildTime)) * dt;
      if (want > owed) want = owed;
      if (f.resources >= want) {
        f.resources -= want;
        job.paid += want;
      } else if (f.resources > 0) {
        const got = f.resources;
        f.resources = 0;
        job.paid += got;
        progress = dt * (got / want);
      } else {
        progress = 0;
      }
    }
    job.remaining -= progress;
    if (job.remaining > 0) return;
    job.remaining = 0;
  }

  // Work finished — gate on supply, then roll the hull out.
  if (f.supply + sp.supply > f.supplyCap) {
    if (host.team === Team.Player && world.time - _lastSupplyNotice > NOTICE_GAP) {
      _lastSupplyNotice = world.time;
      notice('Fleet support capacity reached', 'warn');
    }
    return;
  }

  const hs = SHIP_SPECS[host.cls];
  // Spawn at the hangar mouth (host local -Z), fanned so a queue does not stack.
  const fan = (world.rng.next() - 0.5) * hs.radius * 0.5;
  _v.copy(host.pos).addScaledVector(host.fwd, -hs.radius * 0.9).addScaledVector(host.up, fan * 0.4);
  const ns = world.spawnShip(job.cls, host.team, _v.x, _v.y, _v.z);
  if (!ns) return; // pool exhausted — retry next tick

  ns.fwd.copy(host.fwd);
  ns.up.copy(host.up);
  ns.vel.copy(host.vel).addScaledVector(host.fwd, -sp.speed * 0.3);
  ns.launchT = LAUNCH_TIME;
  ns.throttle = 1;

  if (p.rally) {
    ns.order.kind = 'move';
    ns.order.x = p.rally.x;
    ns.order.y = p.rally.y;
    ns.order.z = p.rally.z;
    ns.order.manual = false;
  } else if (sp.harvest) {
    // Collectors are useless parked — put them straight on the field.
    ns.order.kind = 'harvest';
    ns.order.rock = undefined;
    ns.harvestPhase = 0;
  } else {
    // Hold just clear of the hangar so the next hull is not blocked.
    ns.order.kind = 'move';
    _v.copy(host.pos).addScaledVector(host.fwd, -(hs.radius + sp.radius * 6));
    ns.order.x = _v.x;
    ns.order.y = _v.y;
    ns.order.z = _v.z;
    ns.order.manual = false;
  }

  p.queue.shift();

  _builtEv.id = ns.id;
  _builtEv.cls = ns.cls;
  _builtEv.team = ns.team;
  bus.emit('built', _builtEv);
  if (host.team === Team.Player) notice(`${sp.name} ready`, 'info');
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

/** Advance each faction's active project. */
function stepResearch(world: World, dt: number): void {
  for (let t = 0; t < world.factions.length; t++) {
    const f = world.factions[t];
    const job = f.researching;
    if (!job) continue;
    job.remaining -= dt;
    if (job.remaining > 0) continue;
    f.research.add(job.id);
    f.researching = null;
    // Invalidate the modifier cache; factionMods() rebuilds on next read.
    _modsStamp[f.team] = -1;
    const r = RESEARCH_BY_ID.get(job.id);
    if (f.team === Team.Player) {
      notice(r ? `${r.name}: research complete` : 'Research complete', 'info');
    }
  }
}
