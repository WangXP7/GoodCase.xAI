/**
 * The command layer — everything the player clicks and everything the AI wants
 * funnels through here.
 *
 * DESIGN
 * ------
 * An order is a *goal*, never a trajectory. This module keeps `Ship.order` valid
 * and, every tick, writes a concrete world-space destination into
 * `order.x/order.y/order.z` for whatever the ship is currently trying to do
 * (formation slot, weapon standoff point, orbit station, hangar approach). The
 * flight model therefore only has to answer one question — "fly to
 * `order.x/y/z`, shoot `ship.target`" — and every order kind, including the
 * clever ones, comes out looking deliberate.
 *
 * INTEGRATION CONTRACT (movement / combat must honour this)
 *   - `order.x/y/z`  : the point to fly to this tick. Undefined = hold station.
 *   - `ship.target`  : the entity the weapons should engage, -1 = free.
 *   - `ship.launchT` : counted down HERE. No other system may decrement it.
 *   - `ship.dockedIn`: >= 0 means the ship is inside a hangar; movement, combat
 *                      and rendering must skip it (`World.rebuildHash` already does).
 *
 * Formations are resolved centrally: a multi-ship move builds a `Squad`, sorts
 * its members by hull class so capitals take the centre slots and fighters get
 * pushed to the flanks, and re-derives every member's slot position each tick so
 * the shape stays coherent as ships die.
 */

import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import { SHIP_SPECS } from '../core/registry';
import {
  Formation,
  HullSize,
  ShipClass,
  Stance,
  Team,
  type Order,
  type Ship,
} from '../core/types';
import { enqueueBuild } from './economy';
import type { Squad, World } from './world';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Seconds a ship spends in the launch tube animation after leaving a hangar. */
const LAUNCH_TIME = 1.4;
/** Hard cap on queued follow-up orders per ship (shift-click spam guard). */
const MAX_QUEUE = 12;
/** Ticks between enemy scans for attack-move / guard. Staggered per ship id. */
const SCAN_PERIOD = 8;
/** attackMove: how far off the move line a ship will chase before giving up. */
const ATTACK_MOVE_LEASH = 2600;
/** guard: radius around the guarded hull that gets swept for hostiles. */
const GUARD_LEASH = 2200;

// ---------------------------------------------------------------------------
// Module scratch — nothing in this file allocates per tick.
// ---------------------------------------------------------------------------

const _dest = new Vector3();
const _off = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _tmp = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/** Reused id buffer for squad grouping. */
const _ids: number[] = [];

/**
 * Per-ship attack-move divert state, 6 floats each: [0..2] the parked move-leg
 * destination, [3..5] the point the ship peeled off from (the chase leash is
 * measured from there). `Order` has no spare field for this and a Map would
 * allocate, so it lives in a flat side buffer indexed by ship id.
 */
const _leg = new Float32Array(CONFIG.maxShips * 6);

/** `World` handed to the module-scope sort comparator (avoids a closure). */
let _sortWorld: World | null = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Copy `src` over `dst` in place so no Order object is allocated per tick. */
function copyOrder(dst: Order, src: Order): void {
  dst.kind = src.kind;
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.target = src.target;
  dst.rock = src.rock;
  dst.manual = src.manual;
}

/** Fresh heap copy — only used when pushing onto a ship's queue (a click event). */
function cloneOrder(src: Order): Order {
  return {
    kind: src.kind,
    x: src.x, y: src.y, z: src.z,
    target: src.target, rock: src.rock, manual: src.manual,
  };
}

/** Blank the current order in place, holding at the last destination. */
function setIdle(s: Ship): void {
  s.order.kind = 'idle';
  s.order.target = undefined;
  s.order.rock = undefined;
  s.target = -1;
}

/** Pop the next queued order, or fall idle. Called when an order completes. */
function advance(world: World, s: Ship): void {
  while (s.queue.length > 0) {
    const next = s.queue.shift()!;
    if (!orderIsValid(world, next)) continue;
    copyOrder(s.order, next);
    onOrderBegin(s);
    return;
  }
  setIdle(s);
}

/** Does this order still point at something that exists? */
function orderIsValid(world: World, o: Order): boolean {
  if (o.target !== undefined && o.target >= 0) {
    const t = world.ships.get(o.target);
    if (!t) return o.kind === 'attackMove'; // attackMove keeps its move leg
  }
  if (o.rock !== undefined && o.rock >= 0) {
    const a = world.asteroids.get(o.rock);
    if (!a || a.amount <= 0) return o.kind === 'harvest'; // economy will re-pick
  }
  return true;
}

/** Reset per-order transient ship state when a new order takes effect. */
function onOrderBegin(s: Ship): void {
  switch (s.order.kind) {
    case 'attack':
      s.target = s.order.target ?? -1;
      break;
    case 'harvest':
      // Phase 0 makes the economy layer (re)acquire a rock next tick, unless the
      // collector is already flying cargo home.
      if (s.harvestPhase !== 3) s.harvestPhase = 0;
      s.target = -1;
      break;
    default:
      s.target = -1;
      break;
  }
}

/** Distance at which a ship counts as "there" for a move-ish order. */
function arriveDist(s: Ship): number {
  const sp = SHIP_SPECS[s.cls];
  return sp.radius * 2.2 + 45;
}

/** Longest weapon range on the hull, 0 if unarmed. */
function bestRange(cls: ShipClass): number {
  const w = SHIP_SPECS[cls].weapons;
  let r = 0;
  for (let i = 0; i < w.length; i++) if (w[i].range > r) r = w[i].range;
  return r;
}

/** Squared distance from a ship to a point. */
function d2To(s: Ship, x: number, y: number, z: number): number {
  const dx = s.pos.x - x, dy = s.pos.y - y, dz = s.pos.z - z;
  return dx * dx + dy * dy + dz * dz;
}

/** Write a destination into the live order without allocating. */
function setDest(o: Order, x: number, y: number, z: number): void {
  o.x = x;
  o.y = y;
  o.z = z;
}

// ---------------------------------------------------------------------------
// Formation geometry
//
// Every formation is indexed "centre out": slot 0 is the core of the shape and
// each following slot steps further onto a flank. Because `assignSlots` sorts a
// squad heaviest-first, capitals land on the low slots (centre / spine) and
// fighters end up on the wings, which is what makes a Homeworld fleet read as
// commanded rather than clumped.
// ---------------------------------------------------------------------------

/** 0, +1, -1, +2, -2, ... — the centre-out ladder used by most shapes. */
function ladder(i: number): number {
  return (i & 1 ? 1 : -1) * Math.ceil(i / 2);
}

/** Class weight for slot sorting: 0 = deserves the protected centre slot. */
function slotRank(cls: ShipClass): number {
  switch (SHIP_SPECS[cls].size) {
    case HullSize.SuperCapital: return 0;
    case HullSize.Capital: return 1;
    case HullSize.Frigate: return 2;
    case HullSize.Utility: return 3;
    case HullSize.Corvette: return 4;
    default: return 5; // Fighter — flanks
  }
}

/** Module-scope comparator (no per-call closure). Heaviest hull first. */
function bySlotRank(a: number, b: number): number {
  const w = _sortWorld!;
  const sa = w.ships.get(a);
  const sb = w.ships.get(b);
  if (!sa) return 1;
  if (!sb) return -1;
  const ra = slotRank(sa.cls);
  const rb = slotRank(sb.cls);
  return ra !== rb ? ra - rb : a - b; // id tie-break keeps it deterministic
}

/**
 * Local-space offset for `idx` of `count` ships in `f`, written into `out`.
 * Axes follow the ship convention: +X starboard, +Y up, +Z forward.
 */
export function formationOffset(
  f: Formation,
  idx: number,
  count: number,
  spacing: number,
  out: Vector3,
): Vector3 {
  switch (f) {
    case Formation.Delta: {
      // Arrowhead: rank 0 is the tip, each rank steps back and out with a small
      // dihedral so the wing does not read as a flat cut-out.
      const rank = Math.ceil(idx / 2);
      const side = idx & 1 ? 1 : -1;
      out.set(side * rank * spacing, side * rank * spacing * 0.09, -rank * spacing * 0.9);
      return out;
    }
    case Formation.Broad: {
      // Line abreast with a shallow swept-back echelon.
      const k = ladder(idx);
      out.set(k * spacing * 1.15, ((idx & 1) - 0.5) * spacing * 0.14, -Math.abs(k) * spacing * 0.12);
      return out;
    }
    case Formation.Wall: {
      // Rectangular curtain in the XY plane, filled centre-out on both axes.
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
      out.set(ladder(idx % cols) * spacing, ladder((idx / cols) | 0) * spacing * 0.78, 0);
      return out;
    }
    case Formation.Sphere: {
      // Golden-angle spiral; radius grows with the cube root of the index so the
      // shell fills evenly and low slots (capitals) sit at the core.
      const n = Math.max(1, count);
      const t = (idx + 0.5) / n;
      const y = 1 - 2 * t;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = idx * 2.399963229728653; // golden angle, radians
      const shell = spacing * (0.55 + 0.8 * Math.cbrt(n)) * Math.cbrt(t);
      out.set(Math.cos(a) * r * shell, y * shell, Math.sin(a) * r * shell);
      return out;
    }
    case Formation.Claw: {
      // Crescent: slots ride an arc that curls forward around the centre.
      const rank = Math.ceil(idx / 2);
      const side = idx & 1 ? 1 : -1;
      const ang = side * rank * 0.38;
      const R = spacing * (1.2 + count * 0.22);
      out.set(Math.sin(ang) * R, side * rank * spacing * 0.12, (Math.cos(ang) - 1) * R);
      return out;
    }
    case Formation.Line: {
      // Line astern — a column that threads gaps and reads as a convoy.
      out.set((idx > 0 ? (idx & 1 ? 1 : -1) : 0) * spacing * 0.12, 0, -idx * spacing * 1.15);
      return out;
    }
    default: {
      // None: a loose, slightly staggered box so a raw move never stacks hulls.
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
      const row = (idx / cols) | 0;
      out.set(ladder(idx % cols) * spacing * 1.35, ladder(row) * spacing * 0.5, -row * spacing * 0.35);
      return out;
    }
  }
}

/** Slot spacing for a squad: the biggest hull in it decides the grid. */
function squadSpacing(world: World, sq: Squad): number {
  let r = 12;
  for (let i = 0; i < sq.members.length; i++) {
    const m = world.ships.get(sq.members[i]);
    if (m) {
      const mr = SHIP_SPECS[m.cls].radius;
      if (mr > r) r = mr;
    }
  }
  return r * 2 * CONFIG.separationPad;
}

/** Sort members heaviest-first and re-stamp `squadSlot`. Called on command. */
function assignSlots(world: World, sq: Squad): void {
  _sortWorld = world;
  sq.members.sort(bySlotRank);
  _sortWorld = null;
  for (let i = 0; i < sq.members.length; i++) {
    const m = world.ships.get(sq.members[i]);
    if (m) m.squadSlot = i;
  }
}

/** Build an orthonormal basis from a squad heading into `_right/_up/_fwd`. */
function basisFrom(f: Vector3): void {
  _fwd.copy(f);
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
  _fwd.normalize();
  // right = up x forward (registry convention). Degenerate when looking straight up.
  _right.copy(WORLD_UP).cross(_fwd);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.copy(_fwd).cross(_right).normalize();
}

/**
 * Re-derive every squad member's slot destination. Runs before the per-ship
 * order step so arrival tests see this tick's target point.
 */
function updateSquads(world: World, _dt: number): void {
  for (let q = 0; q < world.squads.length; q++) {
    const sq = world.squads[q];
    if (!sq.alive) continue;

    // Drop dead members; kill the squad when it empties out.
    for (let i = sq.members.length - 1; i >= 0; i--) {
      if (!world.ships.get(sq.members[i])) {
        sq.members.splice(i, 1);
        for (let k = i; k < sq.members.length; k++) {
          const m = world.ships.get(sq.members[k]);
          if (m) m.squadSlot = k;
        }
      }
    }
    if (sq.members.length === 0) {
      sq.alive = false;
      continue;
    }

    const spacing = squadSpacing(world, sq);
    basisFrom(sq.fwd);
    const n = sq.members.length;
    for (let i = 0; i < n; i++) {
      const m = world.ships.get(sq.members[i]);
      if (!m || m.dockedIn >= 0) continue;
      const k = m.order.kind;
      // Only shape-holding orders are slot driven; attack/harvest/dock steer
      // themselves. `idle` is included so a squad that arrived keeps its shape.
      if (k !== 'move' && k !== 'attackMove' && k !== 'formUp' && k !== 'idle') continue;
      if (k === 'attackMove' && m.order.target !== undefined && m.order.target >= 0) continue;

      formationOffset(sq.formation, m.squadSlot, n, spacing, _off);
      _dest.copy(sq.anchor)
        .addScaledVector(_right, _off.x)
        .addScaledVector(_up, _off.y)
        .addScaledVector(_fwd, _off.z);
      setDest(m.order, _dest.x, _dest.y, _dest.z);
    }
  }
  world.pruneSquads();
}

// ---------------------------------------------------------------------------
// Public command API
// ---------------------------------------------------------------------------

/**
 * Apply `order` to every live id. `queue` appends instead of replacing.
 * The order is copied per ship — callers may reuse their template object.
 */
export function issueOrder(world: World, ids: number[], order: Order, queue: boolean): void {
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s) continue;
    applyOrder(world, s, order, queue);
  }
}

/** Give one ship an order, honouring the queue flag and formation membership. */
function applyOrder(world: World, s: Ship, order: Order, queue: boolean): void {
  if (queue) {
    if (s.queue.length < MAX_QUEUE) s.queue.push(cloneOrder(order));
    // An idle ship with a fresh queue starts immediately.
    if (s.order.kind === 'idle') advance(world, s);
    return;
  }
  s.queue.length = 0;
  copyOrder(s.order, order);
  onOrderBegin(s);
}

/**
 * Move a selection. With more than one ship this creates or refreshes a `Squad`
 * so the group flies as a shape instead of a swarm of independent dots;
 * `Formation.None` still gets a loose, staggered box rather than a pile-up.
 */
export function commandMove(
  world: World,
  ids: number[],
  x: number, y: number, z: number,
  queue: boolean,
  formation: Formation,
): void {
  // Collect the live ships and the dominant team.
  _ids.length = 0;
  let team = -1;
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.dockedIn >= 0) continue;
    if (team < 0) team = s.team;
    if (s.team === team) _ids.push(s.id);
  }
  if (_ids.length === 0) return;

  const solo = _ids.length === 1;
  if (solo) {
    const s = world.ships.get(_ids[0])!;
    if (s.squad >= 0 && !queue) world.leaveSquad(s);
    _tmp.set(x, y, z);
    orderMoveTo(world, s, _tmp, queue);
    return;
  }

  // Reuse the existing squad when the whole selection already shares one.
  let sq: Squad | undefined;
  const first = world.ships.get(_ids[0])!;
  if (first.squad >= 0) {
    const cand = world.squad(first.squad);
    if (cand && cand.members.length === _ids.length) {
      let same = true;
      for (let i = 0; i < _ids.length; i++) {
        const s = world.ships.get(_ids[i])!;
        if (s.squad !== cand.id) { same = false; break; }
      }
      if (same) sq = cand;
    }
  }
  if (!sq) sq = world.makeSquad(team as Team, _ids, formation);
  sq.formation = formation;

  // Heading = centroid -> destination, so the shape points where it is going.
  _dest.set(0, 0, 0);
  for (let i = 0; i < sq.members.length; i++) {
    const m = world.ships.get(sq.members[i]);
    if (m) _dest.add(m.pos);
  }
  _dest.multiplyScalar(1 / Math.max(1, sq.members.length));
  _tmp.set(x - _dest.x, y - _dest.y, z - _dest.z);
  if (_tmp.lengthSq() > 1) sq.fwd.copy(_tmp).normalize();
  sq.anchor.set(x, y, z);
  assignSlots(world, sq);

  // Each member gets the order; the slot destination is stamped by updateSquads.
  const spacing = squadSpacing(world, sq);
  basisFrom(sq.fwd);
  const n = sq.members.length;
  for (let i = 0; i < n; i++) {
    const m = world.ships.get(sq.members[i]);
    if (!m) continue;
    formationOffset(sq.formation, m.squadSlot, n, spacing, _off);
    _dest.copy(sq.anchor)
      .addScaledVector(_right, _off.x)
      .addScaledVector(_up, _off.y)
      .addScaledVector(_fwd, _off.z);
    orderMoveTo(world, m, _dest, queue);
  }
}

/** Shared move-order plumbing for one ship (respects the queue flag). */
function orderMoveTo(world: World, s: Ship, p: Vector3, queue: boolean): void {
  if (queue) {
    if (s.queue.length < MAX_QUEUE) {
      s.queue.push({ kind: 'move', x: p.x, y: p.y, z: p.z, manual: true });
    }
    if (s.order.kind === 'idle') advance(world, s);
    return;
  }
  s.queue.length = 0;
  s.order.kind = 'move';
  s.order.target = undefined;
  s.order.rock = undefined;
  s.order.manual = true;
  setDest(s.order, p.x, p.y, p.z);
  s.target = -1;
  s.harvestPhase = 0;
}

/** Order a selection to engage one hull. Attackers leave their formation. */
export function commandAttack(world: World, ids: number[], targetId: number, queue: boolean): void {
  const t = world.ships.get(targetId);
  if (!t) return;
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.id === targetId || s.dockedIn >= 0) continue;
    if (SHIP_SPECS[s.cls].weapons.length === 0) continue; // collectors do not brawl
    if (!queue && s.squad >= 0) world.leaveSquad(s);
    if (queue) {
      if (s.queue.length < MAX_QUEUE) s.queue.push({ kind: 'attack', target: targetId, manual: true });
      if (s.order.kind === 'idle') advance(world, s);
      continue;
    }
    s.queue.length = 0;
    s.order.kind = 'attack';
    s.order.target = targetId;
    s.order.rock = undefined;
    s.order.manual = true;
    s.target = targetId;
    s.harvestPhase = 0;
  }
}

/** Send collectors to a rock. The economy layer drives the mining cycle. */
export function commandHarvest(world: World, ids: number[], rockId: number): void {
  const rock = world.asteroids.get(rockId);
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.dockedIn >= 0) continue;
    if (!SHIP_SPECS[s.cls].harvest) continue;
    if (s.squad >= 0) world.leaveSquad(s);
    s.queue.length = 0;
    s.order.kind = 'harvest';
    s.order.target = undefined;
    s.order.rock = rock ? rockId : undefined;
    s.order.manual = true;
    s.target = -1;
    // Keep phase 3 so a loaded collector finishes its delivery run first.
    if (s.harvestPhase !== 3) s.harvestPhase = 0;
  }
}

/** Send ships into a carrier/mothership/refinery hangar. */
export function commandDock(world: World, ids: number[], hostId: number): void {
  const host = world.ships.get(hostId);
  if (!host || SHIP_SPECS[host.cls].hangar <= 0) return;
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.id === hostId || s.dockedIn >= 0) continue;
    if (s.team !== host.team) continue;
    if (SHIP_SPECS[s.cls].size === HullSize.Capital) continue;
    if (SHIP_SPECS[s.cls].size === HullSize.SuperCapital) continue;
    if (s.squad >= 0) world.leaveSquad(s);
    s.queue.length = 0;
    s.order.kind = 'dock';
    s.order.target = hostId;
    s.order.rock = undefined;
    s.order.manual = true;
    s.target = -1;
  }
}

/** Cancel everything: clear the queue, drop the target, hold position. */
export function commandStop(world: World, ids: number[]): void {
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s) continue;
    s.queue.length = 0;
    setIdle(s);
    setDest(s.order, s.pos.x, s.pos.y, s.pos.z);
    s.order.manual = true;
    s.harvestPhase = 0;
    if (s.squad >= 0) world.leaveSquad(s);
  }
}

// ---------------------------------------------------------------------------
// Per-tick step
// ---------------------------------------------------------------------------

/**
 * Advance every ship's order by `dt`. Call once per fixed sim step, before
 * movement and combat.
 */
export function stepOrders(world: World, dt: number): void {
  updateSquads(world, dt);

  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (!s.alive) continue;

    if (s.launchT > 0) {
      s.launchT -= dt;
      if (s.launchT < 0) s.launchT = 0;
    }

    sanitize(world, s);

    if (s.dockedIn >= 0) {
      // Docked hulls only respond to a launch order.
      if (s.order.kind === 'launch') stepLaunch(world, s);
      continue;
    }

    switch (s.order.kind) {
      case 'move': stepMove(world, s); break;
      case 'attackMove': stepAttackMove(world, s); break;
      case 'attack': stepAttack(world, s); break;
      case 'guard': stepGuard(world, s); break;
      case 'dock': stepDock(world, s); break;
      case 'launch': stepLaunch(world, s); break;
      case 'formUp': stepFormUp(world, s); break;
      case 'harvest': break; // owned by economy.ts
      case 'idle': break;
    }
  }
}

/** Strip dead references out of the live order and the queue. */
function sanitize(world: World, s: Ship): void {
  const o = s.order;

  if (o.target !== undefined && o.target >= 0 && !world.ships.get(o.target)) {
    if (o.kind === 'attackMove') {
      // Divert finished — put the parked move leg back as the destination.
      o.target = undefined;
      s.target = -1;
      const b = s.id * 6;
      setDest(o, _leg[b], _leg[b + 1], _leg[b + 2]);
    } else {
      o.target = undefined;
      advance(world, s);
    }
  }
  if (o.rock !== undefined && o.rock >= 0) {
    const a = world.asteroids.get(o.rock);
    // Keep the reference while hauling cargo home (phase 3) — the economy layer
    // re-picks once the delivery lands.
    if ((!a || a.amount <= 0) && s.harvestPhase !== 3) o.rock = undefined;
  }
  if (s.target >= 0 && !world.ships.get(s.target)) s.target = -1;

  for (let i = s.queue.length - 1; i >= 0; i--) {
    if (!orderIsValid(world, s.queue[i])) s.queue.splice(i, 1);
  }
}

/** Plain move: fly to the (possibly formation-derived) point, then advance. */
function stepMove(world: World, s: Ship): void {
  const o = s.order;
  if (o.x === undefined || o.y === undefined || o.z === undefined) {
    advance(world, s);
    return;
  }
  const r = arriveDist(s);
  if (d2To(s, o.x, o.y, o.z) <= r * r) advance(world, s);
}

/**
 * Attack-move: sweep for hostiles each scan tick. A contact becomes a divert —
 * the move leg is parked in `_legDest` while the ship's destination is driven by
 * the engagement — and the leg is restored the moment the contact dies or pulls
 * the ship too far off its line.
 */
function stepAttackMove(world: World, s: Ship): void {
  const o = s.order;
  const scan = (world.tick + s.id) % SCAN_PERIOD === 0;
  const b = s.id * 6;

  if (o.target !== undefined && o.target >= 0) {
    const t = world.ships.get(o.target);
    let broke = !t;
    if (t) {
      const leash = ATTACK_MOVE_LEASH + SHIP_SPECS[s.cls].radius * 4;
      // Break off if the contact outruns us, or if the chase has dragged the
      // ship too far from where it left the line.
      broke = d2To(s, t.pos.x, t.pos.y, t.pos.z) > leash * leash
        || d2To(s, _leg[b + 3], _leg[b + 4], _leg[b + 5]) > (leash * 1.5) * (leash * 1.5);
    }
    if (broke) {
      o.target = undefined;
      s.target = -1;
      setDest(o, _leg[b], _leg[b + 1], _leg[b + 2]); // resume the move
    } else {
      s.target = t!.id;
      standoffPoint(s, t!, _dest);
      setDest(o, _dest.x, _dest.y, _dest.z); // slot dest is skipped while diverted
      return;
    }
  }

  if (scan && SHIP_SPECS[s.cls].weapons.length > 0) {
    const range = Math.max(CONFIG.autoAcquireRange, bestRange(s.cls) * 1.15);
    const e = world.nearestEnemy(s.pos.x, s.pos.y, s.pos.z, s.team, range);
    if (e >= 0) {
      // Park the leg (and the peel-off point) before the engagement takes over.
      _leg[b] = o.x ?? s.pos.x;
      _leg[b + 1] = o.y ?? s.pos.y;
      _leg[b + 2] = o.z ?? s.pos.z;
      _leg[b + 3] = s.pos.x;
      _leg[b + 4] = s.pos.y;
      _leg[b + 5] = s.pos.z;
      o.target = e;
      s.target = e;
      return;
    }
  }

  if (o.x === undefined || o.y === undefined || o.z === undefined) return;
  const r = arriveDist(s);
  if (d2To(s, o.x, o.y, o.z) <= r * r) advance(world, s);
}

/** Dedicated attack: hold at weapon standoff until the target dies. */
function stepAttack(world: World, s: Ship): void {
  const t = world.ships.get(s.order.target ?? -1);
  if (!t) {
    advance(world, s);
    return;
  }
  s.target = t.id;
  standoffPoint(s, t, _dest);
  setDest(s.order, _dest.x, _dest.y, _dest.z);
}

/**
 * The point this hull wants to occupy while shooting `t`: on the line to the
 * target, backed off to ~80% of its best weapon range. Fighters (short range)
 * end up nose-on; capitals hold at distance and broadside.
 */
function standoffPoint(s: Ship, t: Ship, out: Vector3): void {
  const stand = bestRange(s.cls) * 0.8;
  out.copy(t.pos).sub(s.pos);
  const d = out.length();
  if (d < 1e-3 || stand <= 0) {
    out.copy(t.pos);
    return;
  }
  out.multiplyScalar(1 / d);
  const step = Math.max(0, d - stand - SHIP_SPECS[t.cls].radius);
  out.multiplyScalar(step).add(s.pos);
}

/**
 * Guard: orbit the ward on a slow, slot-phased ring and peel off to intercept
 * anything that comes at it.
 */
function stepGuard(world: World, s: Ship): void {
  const host = world.ships.get(s.order.target ?? -1);
  if (!host) {
    advance(world, s);
    return;
  }
  const hs = SHIP_SPECS[host.cls];
  const ms = SHIP_SPECS[s.cls];

  // Intercept sweep around the ward, not around ourselves.
  if ((world.tick + s.id) % SCAN_PERIOD === 0 && ms.weapons.length > 0) {
    const range = GUARD_LEASH + hs.radius * 2;
    s.target = world.nearestEnemy(host.pos.x, host.pos.y, host.pos.z, s.team, range);
  }
  if (s.target >= 0) {
    const t = world.ships.get(s.target);
    if (t) {
      standoffPoint(s, t, _dest);
      setDest(s.order, _dest.x, _dest.y, _dest.z);
      return;
    }
    s.target = -1;
  }

  // Orbit station: ring radius scales with both hulls, phase offset per slot.
  const R = hs.radius * 1.7 + ms.radius * 4 + 90;
  const phase = (s.squad >= 0 ? s.squadSlot : s.id % 7) * 1.05 + world.time * 0.16;
  setDest(
    s.order,
    host.pos.x + Math.cos(phase) * R,
    host.pos.y + Math.sin(phase * 0.5) * R * 0.14,
    host.pos.z + Math.sin(phase) * R,
  );
}

/**
 * Dock: fly the hangar approach (host position + host local -Z * host radius),
 * then slip inside — the ship leaves the flying set entirely.
 */
function stepDock(world: World, s: Ship): void {
  const host = world.ships.get(s.order.target ?? -1);
  if (!host) {
    advance(world, s);
    return;
  }
  const hs = SHIP_SPECS[host.cls];
  // Approach point behind the host, fanned sideways per ship so a wing queues up
  // instead of stacking on one pixel.
  const fan = ((s.id % 5) - 2) * (hs.radius * 0.16);
  _dest.copy(host.pos)
    .addScaledVector(host.fwd, -hs.radius)
    .addScaledVector(host.up, fan * 0.35);
  _tmp.copy(WORLD_UP).cross(host.fwd);
  if (_tmp.lengthSq() > 1e-6) _dest.addScaledVector(_tmp.normalize(), fan);
  setDest(s.order, _dest.x, _dest.y, _dest.z);

  const touch = hs.radius * 0.42 + SHIP_SPECS[s.cls].radius + 35;
  if (d2To(s, _dest.x, _dest.y, _dest.z) <= touch * touch) {
    if (hangarFree(world, host.id, hs.hangar)) {
      s.dockedIn = host.id;
      s.launchT = 0;
      s.vel.set(0, 0, 0);
      s.throttle = 0;
      s.target = -1;
      // Park the hull at the hangar mouth so it emerges from the right place.
      s.pos.copy(host.pos).addScaledVector(host.fwd, -hs.radius * 0.35);
      s.queue.length = 0;
      setIdle(s);
      s.order.x = undefined;
      s.order.y = undefined;
      s.order.z = undefined;
    }
    // Hangar full: keep loitering on the approach until a bay frees up.
  }
}

/** Count the hulls already inside `hostId` and compare with capacity. */
function hangarFree(world: World, hostId: number, cap: number): boolean {
  if (cap <= 0) return false;
  let n = 0;
  const ships = world.ships;
  for (let i = 0; i < ships.count; i++) {
    const s = ships.items[i];
    if (s.alive && s.dockedIn === hostId && ++n >= cap) return false;
  }
  return true;
}

/** Launch: the exact reverse of docking, with `launchT` driving the tube FX. */
function stepLaunch(world: World, s: Ship): void {
  if (s.dockedIn < 0) {
    advance(world, s);
    return;
  }
  const host = world.ships.get(s.dockedIn);
  if (!host) {
    // Carrier died with ships inside — they die with it.
    world.killShip(s.id);
    return;
  }
  const hs = SHIP_SPECS[host.cls];
  const fan = ((s.id % 5) - 2) * (hs.radius * 0.16);
  s.pos.copy(host.pos).addScaledVector(host.fwd, -hs.radius * 0.9);
  _tmp.copy(WORLD_UP).cross(host.fwd);
  if (_tmp.lengthSq() > 1e-6) s.pos.addScaledVector(_tmp.normalize(), fan);
  s.fwd.copy(host.fwd);
  s.up.copy(host.up);
  s.vel.copy(host.vel).addScaledVector(host.fwd, -SHIP_SPECS[s.cls].speed * 0.35);
  s.dockedIn = -1;
  s.launchT = LAUNCH_TIME;
  s.throttle = 1;
  advance(world, s);
}

/** Form up: hold the slot the squad step already wrote; done when parked. */
function stepFormUp(world: World, s: Ship): void {
  const o = s.order;
  if (s.squad < 0 || o.x === undefined || o.y === undefined || o.z === undefined) {
    advance(world, s);
    return;
  }
  const r = arriveDist(s) * 0.7;
  if (d2To(s, o.x, o.y, o.z) <= r * r && s.queue.length > 0) advance(world, s);
}

/** Seconds a launched ship spends in its tube animation. Shared with economy.ts. */
export const LAUNCH_DURATION = LAUNCH_TIME;

// ---------------------------------------------------------------------------
// Integration facade
//
// `src/sim/ai.ts` binds to a shorter verb set (`orderMove`, `orderAttack`, ...)
// with a trailing `manual` flag instead of a queue flag. These wrappers are that
// binding — the command functions above remain the canonical API for the input
// layer, which needs the queue and formation arguments.
// ---------------------------------------------------------------------------

/** Stamp the manual flag on a batch after a command has been applied. */
function markManual(world: World, ids: number[], manual: boolean): void {
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (s) s.order.manual = manual;
  }
}

/**
 * Pick a sensible default shape for a selection: pure strike craft fly an
 * arrowhead, anything with a frigate or bigger in it goes line-abreast so the
 * heavy guns all bear.
 */
export function defaultFormation(world: World, ids: number[]): Formation {
  if (ids.length < 2) return Formation.None;
  let heavy = false;
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s) continue;
    const sz = SHIP_SPECS[s.cls].size;
    if (sz === HullSize.Frigate || sz === HullSize.Capital || sz === HullSize.SuperCapital) {
      heavy = true;
      break;
    }
  }
  return heavy ? Formation.Broad : Formation.Delta;
}

/**
 * Move to a point, sweeping for hostiles on the way. Shares all of the squad /
 * formation machinery with `commandMove` — only the order kind differs.
 */
export function commandAttackMove(
  world: World,
  ids: number[],
  x: number, y: number, z: number,
  queue: boolean,
  formation: Formation,
): void {
  commandMove(world, ids, x, y, z, queue, formation);
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s) continue;
    if (queue) {
      const last = s.queue[s.queue.length - 1];
      if (last && last.kind === 'move') last.kind = 'attackMove';
    } else if (s.order.kind === 'move') {
      s.order.kind = 'attackMove';
      s.order.target = undefined;
    }
  }
}

/** AI/UI shorthand: move now, auto-formation. */
export function orderMove(
  world: World, ids: number[], x: number, y: number, z: number, manual = true,
): void {
  commandMove(world, ids, x, y, z, false, defaultFormation(world, ids));
  markManual(world, ids, manual);
}

/** AI/UI shorthand: attack-move now, auto-formation. */
export function orderAttackMove(
  world: World, ids: number[], x: number, y: number, z: number, manual = true,
): void {
  commandAttackMove(world, ids, x, y, z, false, defaultFormation(world, ids));
  markManual(world, ids, manual);
}

/** AI/UI shorthand: engage a hull. */
export function orderAttack(world: World, ids: number[], targetId: number, manual = true): void {
  commandAttack(world, ids, targetId, false);
  markManual(world, ids, manual);
}

/** AI/UI shorthand: escort a hull. */
export function orderGuard(world: World, ids: number[], targetId: number, manual = true): void {
  const t = world.ships.get(targetId);
  if (!t) return;
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.id === targetId || s.dockedIn >= 0) continue;
    if (s.squad >= 0) world.leaveSquad(s);
    s.queue.length = 0;
    s.order.kind = 'guard';
    s.order.target = targetId;
    s.order.rock = undefined;
    s.order.manual = manual;
    s.target = -1;
    s.harvestPhase = 0;
  }
}

/** AI/UI shorthand: mine a rock. */
export function orderHarvest(world: World, ids: number[], rockId: number, manual = true): void {
  commandHarvest(world, ids, rockId);
  markManual(world, ids, manual);
}

/** AI/UI shorthand: cancel everything. */
export function orderStop(world: World, ids: number[]): void {
  commandStop(world, ids);
}

/** AI/UI shorthand: send ships back into a hangar. */
export function orderDock(world: World, ids: number[], hostId: number, manual = true): void {
  commandDock(world, ids, hostId);
  markManual(world, ids, manual);
}

/** Eject a docked ship. It resumes its queue (or idles) once clear of the tube. */
export function orderLaunch(world: World, ids: number[]): void {
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (!s || s.dockedIn < 0) continue;
    s.order.kind = 'launch';
    s.order.target = s.dockedIn;
    s.order.manual = true;
  }
}

/** Set combat stance on a batch. */
export function setStance(world: World, ids: number[], stance: Stance): void {
  for (let i = 0; i < ids.length; i++) {
    const s = world.ships.get(ids[i]);
    if (s) s.stance = stance;
  }
}

/** Set (or move) a producer's rally point. Allocates the vector once. */
export function setRally(world: World, producerShipId: number, x: number, y: number, z: number): void {
  const p = world.producers.get(producerShipId);
  if (!p) return;
  if (p.rally) p.rally.set(x, y, z);
  else p.rally = new Vector3(x, y, z);
}

/** Clear a producer's rally point — new hulls hold station at the hangar. */
export function clearRally(world: World, producerShipId: number): void {
  const p = world.producers.get(producerShipId);
  if (p) p.rally = null;
}

/**
 * Queue a hull, validating cost and supply headroom up front (the economy layer
 * itself only enforces supply at roll-out time, which is too late for the AI's
 * spend planner).
 */
export function queueBuild(world: World, producerShipId: number, cls: ShipClass): boolean {
  const host = world.ships.get(producerShipId);
  if (!host) return false;
  const sp = SHIP_SPECS[cls];
  const f = world.factions[host.team];
  if (f.resources < sp.cost) return false;

  // Count supply already promised to in-flight jobs across the faction.
  let pledged = 0;
  world.producers.forEach((p) => {
    const h = world.ships.get(p.shipId);
    if (!h || h.team !== host.team) return;
    for (let i = 0; i < p.queue.length; i++) pledged += SHIP_SPECS[p.queue[i].cls].supply;
  });
  if (f.supply + pledged + sp.supply > f.supplyCap) return false;

  return enqueueBuild(world, producerShipId, cls);
}

export { startResearch } from './economy';
