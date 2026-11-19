/**
 * The simulation state container.
 *
 * Every system (movement, combat, ai, economy, orders) reads and mutates this.
 * It owns pooled entity arrays with free-lists so nothing allocates per frame.
 *
 * Rendering NEVER mutates the world; it only reads.
 */

import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import { Rng } from '../core/rng';
import { SHIP_SPECS } from '../core/registry';
import {
  Formation,
  ShipClass,
  Stance,
  Team,
  TEAM_COUNT,
  type Asteroid,
  type Beam,
  type FactionState,
  type Producer,
  type Projectile,
  type Ship,
} from '../core/types';

// ---------------------------------------------------------------------------
// Spatial hash — uniform grid over the battlespace for neighbour queries.
// ---------------------------------------------------------------------------

export class SpatialHash {
  readonly cell: number;
  private buckets = new Map<number, number[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(x: number, y: number, z: number): number {
    const cx = Math.floor(x / this.cell) & 1023;
    const cy = Math.floor(y / this.cell) & 1023;
    const cz = Math.floor(z / this.cell) & 1023;
    return (cx << 20) | (cy << 10) | cz;
  }

  clear(): void {
    for (const list of this.buckets.values()) list.length = 0;
  }

  insert(id: number, x: number, y: number, z: number): void {
    const k = this.key(x, y, z);
    let list = this.buckets.get(k);
    if (!list) {
      list = [];
      this.buckets.set(k, list);
    }
    list.push(id);
  }

  /** Append every id within `radius` of the point into `out`. Returns `out`. */
  query(x: number, y: number, z: number, radius: number, out: number[]): number[] {
    const r = Math.max(1, Math.ceil(radius / this.cell));
    const bx = Math.floor(x / this.cell);
    const by = Math.floor(y / this.cell);
    const bz = Math.floor(z / this.cell);
    for (let ix = -r; ix <= r; ix++) {
      for (let iy = -r; iy <= r; iy++) {
        for (let iz = -r; iz <= r; iz++) {
          const cx = (bx + ix) & 1023;
          const cy = (by + iy) & 1023;
          const cz = (bz + iz) & 1023;
          const list = this.buckets.get((cx << 20) | (cy << 10) | cz);
          if (list) for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

function makeShip(id: number): Ship {
  return {
    id, alive: false, cls: ShipClass.Scout, team: Team.Neutral,
    pos: new Vector3(), vel: new Vector3(),
    fwd: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0),
    bank: 0, throttle: 0,
    hp: 0, shield: 0, sinceHit: 99, damage: 0,
    order: { kind: 'idle' }, queue: [], stance: Stance.Aggressive,
    squad: -1, squadSlot: 0,
    target: -1, cool: new Float32Array(0),
    cargo: 0, harvestPhase: 0,
    dockedIn: -1, launchT: 0,
    age: 0, seed: 0, lod: 0, visible: true,
  };
}

function makeProjectile(id: number): Projectile {
  return {
    id, alive: false, kind: 'pulse', team: Team.Neutral,
    pos: new Vector3(), vel: new Vector3(),
    target: -1, damage: 0, splash: 0, ttl: 0, turn: 0, seed: 0, owner: -1,
  };
}

function makeBeam(id: number): Beam {
  return {
    id, alive: false, team: Team.Neutral,
    from: new Vector3(), to: new Vector3(),
    intensity: 0, ttl: 0, width: 1, owner: -1, seed: 0,
  };
}

function makeAsteroid(id: number): Asteroid {
  return {
    id, alive: false, pos: new Vector3(), radius: 10,
    amount: 0, amountMax: 0,
    spin: new Vector3(), rot: new Vector3(),
    variant: 0, seed: 0,
  };
}

class Pool<T extends { id: number; alive: boolean }> {
  readonly items: T[] = [];
  private free: number[] = [];
  /** Highest index ever used + 1 — iterate 0..count. */
  count = 0;

  constructor(readonly cap: number, private factory: (id: number) => T) {}

  spawn(): T | null {
    let id: number;
    if (this.free.length) {
      id = this.free.pop()!;
    } else {
      if (this.count >= this.cap) return null;
      id = this.count++;
      this.items[id] = this.factory(id);
    }
    const it = this.items[id];
    it.alive = true;
    return it;
  }

  kill(id: number): void {
    const it = this.items[id];
    if (!it || !it.alive) return;
    it.alive = false;
    this.free.push(id);
  }

  get(id: number): T | undefined {
    const it = this.items[id];
    return it && it.alive ? it : undefined;
  }

  reset(): void {
    for (const it of this.items) it.alive = false;
    this.free.length = 0;
    this.count = 0;
    this.items.length = 0;
  }

  /** Number of live entities. O(count). */
  liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.items[i].alive) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Squads — a player-issued group of ships that flies in formation.
// ---------------------------------------------------------------------------

export interface Squad {
  id: number;
  team: Team;
  members: number[];
  formation: Formation;
  /** Formation facing, unit vector. */
  fwd: Vector3;
  /** Formation centre target. */
  anchor: Vector3;
  alive: boolean;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  readonly ships = new Pool<Ship>(CONFIG.maxShips, makeShip);
  readonly projectiles = new Pool<Projectile>(CONFIG.maxProjectiles, makeProjectile);
  readonly beams = new Pool<Beam>(CONFIG.maxBeams, makeBeam);
  readonly asteroids = new Pool<Asteroid>(CONFIG.maxAsteroids, makeAsteroid);

  readonly squads: Squad[] = [];
  readonly producers = new Map<number, Producer>();

  readonly factions: FactionState[] = [];

  /** Rebuilt every sim step; cell sized for capital-ship neighbourhoods. */
  readonly hash = new SpatialHash(900);
  /** Coarser grid used by harvest/AI target scans. */
  readonly coarse = new SpatialHash(4200);

  /** Elapsed simulated time, seconds. */
  time = 0;
  /** Sim ticks elapsed. */
  tick = 0;
  rng: Rng;
  seed: number;

  /** Player selection (ship ids). Owned by the input layer, read by UI + orders. */
  selection: number[] = [];

  /** Set when a mothership dies. */
  gameOver: Team | null = null;

  /** Per-team mothership id for quick lookups; -1 if destroyed. */
  motherships: number[] = new Array(TEAM_COUNT).fill(-1);

  private nextSquad = 0;
  private scratch: number[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new Rng(seed);
    for (let t = 0; t < TEAM_COUNT; t++) {
      this.factions.push({
        team: t as Team,
        resources: CONFIG.startResources,
        supply: 0,
        supplyCap: CONFIG.supplyCapBase,
        research: new Set<string>(),
        researching: null,
      });
    }
  }

  // -- ships ---------------------------------------------------------------

  spawnShip(cls: ShipClass, team: Team, x: number, y: number, z: number): Ship | null {
    const s = this.ships.spawn();
    if (!s) return null;
    const sp = SHIP_SPECS[cls];
    s.cls = cls;
    s.team = team;
    s.pos.set(x, y, z);
    s.vel.set(0, 0, 0);
    s.fwd.set(0, 0, 1);
    s.up.set(0, 1, 0);
    s.bank = 0;
    s.throttle = 0;
    s.hp = sp.maxHp;
    s.shield = sp.maxShield;
    s.sinceHit = 99;
    s.damage = 0;
    s.order = { kind: 'idle' };
    s.queue.length = 0;
    s.stance = Stance.Aggressive;
    s.squad = -1;
    s.squadSlot = 0;
    s.target = -1;
    if (s.cool.length !== sp.hardpoints.length) s.cool = new Float32Array(sp.hardpoints.length);
    else s.cool.fill(0);
    s.cargo = 0;
    s.harvestPhase = 0;
    s.dockedIn = -1;
    s.launchT = 0;
    s.age = 0;
    s.seed = this.rng.next();
    s.lod = 0;
    s.visible = true;
    if (cls === ShipClass.Mothership) this.motherships[team] = s.id;
    this.factions[team].supply += sp.supply;
    if (sp.hangar > 0) {
      this.factions[team].supplyCap += cls === ShipClass.Mothership
        ? CONFIG.supplyCapBase
        : CONFIG.supplyPerCarrier;
      this.producers.set(s.id, { shipId: s.id, queue: [], rally: null });
    }
    return s;
  }

  killShip(id: number): void {
    const s = this.ships.get(id);
    if (!s) return;
    const sp = SHIP_SPECS[s.cls];
    this.factions[s.team].supply -= sp.supply;
    if (sp.hangar > 0) {
      this.factions[s.team].supplyCap -= s.cls === ShipClass.Mothership
        ? CONFIG.supplyCapBase
        : CONFIG.supplyPerCarrier;
      this.producers.delete(id);
    }
    if (this.motherships[s.team] === id) {
      this.motherships[s.team] = -1;
      this.gameOver = s.team === Team.Player ? Team.Enemy : Team.Player;
    }
    if (s.squad >= 0) this.leaveSquad(s);
    const si = this.selection.indexOf(id);
    if (si >= 0) this.selection.splice(si, 1);
    this.ships.kill(id);
  }

  ship(id: number): Ship | undefined {
    return this.ships.get(id);
  }

  // -- squads --------------------------------------------------------------

  makeSquad(team: Team, ids: number[], formation: Formation): Squad {
    const sq: Squad = {
      id: this.nextSquad++,
      team,
      members: [],
      formation,
      fwd: new Vector3(0, 0, 1),
      anchor: new Vector3(),
      alive: true,
    };
    this.squads.push(sq);
    for (const id of ids) {
      const s = this.ships.get(id);
      if (!s || s.team !== team) continue;
      if (s.squad >= 0) this.leaveSquad(s);
      s.squad = sq.id;
      s.squadSlot = sq.members.length;
      sq.members.push(id);
    }
    return sq;
  }

  squad(id: number): Squad | undefined {
    const sq = this.squads.find((q) => q.id === id && q.alive);
    return sq;
  }

  leaveSquad(s: Ship): void {
    const sq = this.squad(s.squad);
    s.squad = -1;
    if (!sq) return;
    const i = sq.members.indexOf(s.id);
    if (i >= 0) sq.members.splice(i, 1);
    for (let k = 0; k < sq.members.length; k++) {
      const m = this.ships.get(sq.members[k]);
      if (m) m.squadSlot = k;
    }
    if (sq.members.length === 0) sq.alive = false;
  }

  pruneSquads(): void {
    for (let i = this.squads.length - 1; i >= 0; i--) {
      if (!this.squads[i].alive) this.squads.splice(i, 1);
    }
  }

  // -- clocks --------------------------------------------------------------

  /**
   * Advance the per-ship age clock.
   *
   * `Ship.age` is read by the render layer (spawn fade, per-instance shader
   * variation) and by FX, but no gameplay system owns it — so the world ticks it
   * directly, once per sim step, before anything else runs.
   */
  stepClocks(dt: number): void {
    const ships = this.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (s.alive) s.age += dt;
    }
  }

  // -- spatial -------------------------------------------------------------

  rebuildHash(): void {
    this.hash.clear();
    this.coarse.clear();
    const ships = this.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      this.hash.insert(s.id, s.pos.x, s.pos.y, s.pos.z);
      this.coarse.insert(s.id, s.pos.x, s.pos.y, s.pos.z);
    }
  }

  /** Nearest live enemy ship id within `range`, or -1. */
  nearestEnemy(x: number, y: number, z: number, team: Team, range: number): number {
    const out = this.scratch;
    out.length = 0;
    this.coarse.query(x, y, z, range, out);
    let best = -1;
    let bestD = range * range;
    for (let i = 0; i < out.length; i++) {
      const s = this.ships.items[out[i]];
      if (!s || !s.alive || s.team === team || s.team === Team.Neutral) continue;
      const dx = s.pos.x - x, dy = s.pos.y - y, dz = s.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  /** Nearest asteroid with resources left, or -1. */
  nearestRock(x: number, y: number, z: number, range: number): number {
    let best = -1;
    let bestD = range * range;
    const rocks = this.asteroids;
    for (let i = 0; i < rocks.count; i++) {
      const a = rocks.items[i];
      if (!a.alive || a.amount <= 0) continue;
      const dx = a.pos.x - x, dy = a.pos.y - y, dz = a.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    return best;
  }

  /** Nearest friendly hull that accepts cargo (mothership or refinery). */
  nearestDropoff(x: number, y: number, z: number, team: Team): number {
    let best = -1;
    let bestD = Infinity;
    const ships = this.ships;
    for (let i = 0; i < ships.count; i++) {
      const s = ships.items[i];
      if (!s.alive || s.team !== team) continue;
      if (s.cls !== ShipClass.Mothership && s.cls !== ShipClass.ResourceRefinery) continue;
      const dx = s.pos.x - x, dy = s.pos.y - y, dz = s.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  // -- projectiles ---------------------------------------------------------

  spawnProjectile(): Projectile | null {
    return this.projectiles.spawn();
  }

  spawnBeam(): Beam | null {
    return this.beams.spawn();
  }
}
