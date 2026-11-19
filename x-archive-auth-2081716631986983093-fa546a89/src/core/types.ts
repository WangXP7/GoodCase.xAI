/**
 * Shared type contracts for Starfall.
 *
 * This file has NO runtime dependencies beyond three's math types and is safe to
 * import from every layer (sim, render, ui, fx). Every subsystem talks through
 * the shapes declared here — do not fork them locally.
 *
 * Units: 1 world unit = 1 metre. Time is in seconds.
 */

import type { Vector3 } from 'three';

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export enum Team {
  Player = 0,
  Enemy = 1,
  Neutral = 2,
}

export const TEAM_COUNT = 3;

// ---------------------------------------------------------------------------
// Ship taxonomy
// ---------------------------------------------------------------------------

export enum ShipClass {
  Scout = 0,
  Interceptor = 1,
  Bomber = 2,
  AssaultCorvette = 3,
  MissileCorvette = 4,
  IonFrigate = 5,
  AssaultFrigate = 6,
  Destroyer = 7,
  HeavyCruiser = 8,
  ResourceCollector = 9,
  ResourceRefinery = 10,
  Carrier = 11,
  Mothership = 12,
}

export const SHIP_CLASS_COUNT = 13;

export const ALL_SHIP_CLASSES: ShipClass[] = [
  ShipClass.Scout,
  ShipClass.Interceptor,
  ShipClass.Bomber,
  ShipClass.AssaultCorvette,
  ShipClass.MissileCorvette,
  ShipClass.IonFrigate,
  ShipClass.AssaultFrigate,
  ShipClass.Destroyer,
  ShipClass.HeavyCruiser,
  ShipClass.ResourceCollector,
  ShipClass.ResourceRefinery,
  ShipClass.Carrier,
  ShipClass.Mothership,
];

/** Broad size band — drives AI targeting preference, formations and UI grouping. */
export enum HullSize {
  Fighter = 0,
  Corvette = 1,
  Frigate = 2,
  Capital = 3,
  SuperCapital = 4,
  Utility = 5,
}

/** Movement personality — how the flight model integrates the ship. */
export enum FlightModel {
  /** Fighters: high thrust, hard banking, dogfight arcs, can strafe-orbit. */
  Agile = 0,
  /** Corvettes: brawler, medium bank, holds broadside. */
  Brawler = 1,
  /** Frigates & capitals: heavy inertia, yaw-limited, no roll authority. */
  Capital = 2,
  /** Utility/harvest: slow, docks, no combat manoeuvring. */
  Utility = 3,
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponKind =
  | 'none'
  | 'pulse' // fighter repeaters — fast tracer bolts
  | 'massdriver' // corvette/frigate kinetic slugs, heavier tracer
  | 'flak' // area burst vs fighters
  | 'ion' // sustained beam
  | 'missile' // homing, small
  | 'torpedo' // homing, big, slow, anti-capital
  | 'plasma'; // capital lob, arcing bolt with heavy bloom

export interface WeaponSpec {
  kind: WeaponKind;
  /** Damage per hit (or per second for `ion`). */
  damage: number;
  /** Shots per second. */
  rate: number;
  /** Max engagement range in metres. */
  range: number;
  /** Projectile muzzle speed (m/s). Ignored for `ion`. */
  speed: number;
  /** Homing turn rate, rad/s. Only for missile/torpedo. */
  turn?: number;
  /** Rounds per burst before recycling. */
  burst?: number;
  /** Delay between bursts, seconds. */
  burstGap?: number;
  /** Splash radius in metres, 0 = single target. */
  splash?: number;
  /** Damage multiplier vs each HullSize (index by HullSize). Defaults to 1. */
  vs?: Partial<Record<HullSize, number>>;
  /** Turret traverse limits. Undefined = fixed forward mount. */
  traverse?: { yaw: number; pitch: number; speed: number };
  /** Seconds the beam stays on target before recycling (ion only). */
  beamDwell?: number;
}

/** A weapon mount point baked into the ship geometry. */
export interface Hardpoint {
  /** Local-space muzzle position, metres. */
  pos: [number, number, number];
  /** Local-space forward direction of the barrel (unit). */
  dir: [number, number, number];
  /** Index into `ShipSpec.weapons`. */
  weapon: number;
  /** Turret ring radius for the render layer, 0 = flush mount. */
  size?: number;
}

/** An engine nozzle baked into the ship geometry. */
export interface EngineMount {
  /** Local-space nozzle centre, metres. */
  pos: [number, number, number];
  /** Nozzle exit radius, metres. Drives plume width + glow sprite size. */
  radius: number;
  /** Local-space thrust exit direction (usually -Z... i.e. [0,0,1] pointing aft). */
  dir?: [number, number, number];
}

// ---------------------------------------------------------------------------
// Ship specification (data-only; see core/registry.ts for the table)
// ---------------------------------------------------------------------------

export interface ShipSpec {
  cls: ShipClass;
  name: string;
  /** 3-letter tag for dense HUD readouts. */
  tag: string;
  size: HullSize;
  flight: FlightModel;

  /** Bounding radius in metres — used for picking, collision, LOD, formations. */
  radius: number;
  /** Overall hull length in metres. Geometry builders MUST honour this. */
  length: number;

  maxHp: number;
  /** Regenerating shield pool; 0 = no shields. */
  maxShield: number;
  shieldRegen: number; // per second, after `shieldDelay`
  shieldDelay: number; // seconds without damage before regen resumes
  /** Flat damage reduction from armour, applied after multipliers. */
  armour: number;

  /** Cruise speed, m/s. */
  speed: number;
  /** Linear acceleration, m/s^2. */
  accel: number;
  /** Max yaw/pitch rate, rad/s. */
  turnRate: number;
  /** Max roll for banking, radians. */
  bankMax: number;

  weapons: WeaponSpec[];
  hardpoints: Hardpoint[];
  engines: EngineMount[];

  /** Build cost in resource units. */
  cost: number;
  /** Build time in seconds at 1x. */
  buildTime: number;
  /** Population/support cost against the fleet cap. */
  supply: number;
  /** What this hull can produce, if anything. */
  builds: ShipClass[];
  /** Fighter/corvette docking capacity, 0 = cannot dock others. */
  hangar: number;

  /** Resource collector only. */
  harvest?: { rate: number; capacity: number };

  /** Sensor radius in metres for fog/awareness. */
  sensor: number;

  /** Research tier required (0 = available at start). */
  tier: number;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderKind =
  | 'idle'
  | 'move'
  | 'attackMove'
  | 'attack'
  | 'guard'
  | 'harvest'
  | 'dock'
  | 'launch'
  | 'formUp';

export interface Order {
  kind: OrderKind;
  /** World-space destination for move-ish orders. */
  x?: number;
  y?: number;
  z?: number;
  /** Target entity id for attack/guard/dock. */
  target?: number;
  /** Target asteroid id for harvest. */
  rock?: number;
  /** True if issued by the player (vs. AI/auto-acquire). Player orders win. */
  manual?: boolean;
}

export enum Formation {
  None = 0,
  Delta = 1,
  Broad = 2,
  Wall = 3,
  Sphere = 4,
  Claw = 5,
  Line = 6,
}

export enum Stance {
  Aggressive = 0,
  Neutral = 1,
  Passive = 2,
  Evasive = 3,
}

// ---------------------------------------------------------------------------
// Runtime entities
// ---------------------------------------------------------------------------

/** Live ship instance. Plain object, pooled in `World.ships`. */
export interface Ship {
  id: number;
  alive: boolean;
  cls: ShipClass;
  team: Team;

  // --- kinematics (world space) ---
  pos: Vector3;
  vel: Vector3;
  /** Unit forward. */
  fwd: Vector3;
  /** Unit up (rolls with banking). */
  up: Vector3;
  /** Current bank angle, radians. */
  bank: number;
  /** Current throttle 0..1, drives engine plume length. */
  throttle: number;

  hp: number;
  shield: number;
  /** Seconds since last damage taken. */
  sinceHit: number;
  /** 0..1 accumulated visual damage (scorch, venting, sparks). */
  damage: number;

  order: Order;
  /** Queued follow-up orders (shift-click chaining). */
  queue: Order[];
  stance: Stance;

  /** Group/squadron id for formation offsets; -1 = ungrouped. */
  squad: number;
  /** Index within the squad — determines formation slot. */
  squadSlot: number;

  /** Auto-acquired combat target, -1 = none. */
  target: number;
  /** Per-hardpoint cooldown timers, seconds. */
  cool: Float32Array;

  /** Harvest state. */
  cargo: number;
  harvestPhase: 0 | 1 | 2 | 3; // none | toRock | mining | returning

  /** Docked inside carrier/mothership id, -1 = flying. */
  dockedIn: number;
  /** Seconds remaining of launch animation, 0 = flying free. */
  launchT: number;

  /** Time alive, seconds — for shader-side variation. */
  age: number;
  /** Stable per-instance random 0..1 for shader variation. */
  seed: number;

  /** Render-side scratch: current LOD level chosen this frame. */
  lod: number;
  /** True if inside the camera frustum this frame. */
  visible: boolean;
}

export interface Asteroid {
  id: number;
  alive: boolean;
  pos: Vector3;
  radius: number;
  /** Remaining resource units. */
  amount: number;
  amountMax: number;
  /** Slow tumble. */
  spin: Vector3;
  rot: Vector3;
  /** Geometry variant index. */
  variant: number;
  seed: number;
}

export interface Projectile {
  id: number;
  alive: boolean;
  kind: WeaponKind;
  team: Team;
  pos: Vector3;
  vel: Vector3;
  /** Homing target entity id, -1 for dumb-fire. */
  target: number;
  damage: number;
  splash: number;
  /** Seconds until self-destruct. */
  ttl: number;
  turn: number;
  seed: number;
  /** Source ship id (no friendly self-hits). */
  owner: number;
  vs?: Partial<Record<HullSize, number>>;
}

/** Sustained beam, rendered as a screen-facing quad strip. */
export interface Beam {
  id: number;
  alive: boolean;
  team: Team;
  from: Vector3;
  to: Vector3;
  /** 0..1 intensity ramp for fade in/out. */
  intensity: number;
  ttl: number;
  width: number;
  owner: number;
  seed: number;
}

// ---------------------------------------------------------------------------
// Economy / production
// ---------------------------------------------------------------------------

export interface BuildJob {
  cls: ShipClass;
  /** Seconds of work remaining. */
  remaining: number;
  /** Total seconds of work for progress bars. */
  total: number;
  /** Resources already sunk (refunded on cancel). */
  paid: number;
}

export interface Producer {
  /** Ship id that owns this queue. */
  shipId: number;
  queue: BuildJob[];
  /** Rally point, world space; null = launch and hold. */
  rally: Vector3 | null;
}

export interface FactionState {
  team: Team;
  resources: number;
  /** Fleet supply used / cap. */
  supply: number;
  supplyCap: number;
  /** Completed research ids. */
  research: Set<string>;
  /** Active research id + seconds remaining. */
  researching: { id: string; remaining: number; total: number } | null;
}

export interface ResearchSpec {
  id: string;
  name: string;
  desc: string;
  cost: number;
  time: number;
  requires: string[];
  /** Ship classes unlocked on completion. */
  unlocks: ShipClass[];
  /** Multiplicative combat modifiers granted. */
  mods?: { damage?: number; armour?: number; speed?: number; shield?: number };
}

// ---------------------------------------------------------------------------
// Events — the sim raises these, FX/audio/UI consume them.
// ---------------------------------------------------------------------------

export interface GameEvents {
  /** A projectile or beam connected. */
  hit: {
    x: number; y: number; z: number;
    nx: number; ny: number; nz: number;
    kind: WeaponKind;
    shielded: boolean;
    team: Team;
    scale: number;
  };
  /** A weapon fired — spawn muzzle flash. */
  fire: {
    x: number; y: number; z: number;
    dx: number; dy: number; dz: number;
    kind: WeaponKind;
    team: Team;
    scale: number;
  };
  /** A ship died. */
  death: {
    id: number;
    cls: ShipClass;
    team: Team;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    radius: number;
  };
  /** A ship rolled off the production line. */
  built: { id: number; cls: ShipClass; team: Team };
  /** Selection changed (UI). */
  selection: { ids: number[] };
  /** Player-facing log line. */
  notice: { text: string; kind: 'info' | 'warn' | 'alert' };
  /** Collector delivered cargo. */
  delivered: { team: Team; amount: number; x: number; y: number; z: number };
  /**
   * The player did something and deserves an answer.
   *
   * The game had no channel for this at all: it made a noise for gunfire, for
   * hull impacts and for deaths — every one of them somebody else's — and was
   * silent for selecting a ship, giving it an order, or pressing a button. An
   * interface that never answers reads as broken long before it reads as quiet.
   */
  ack: {
    kind: 'select' | 'order' | 'attack' | 'queued' | 'research' | 'dock' | 'click' | 'deny';
    /** Number of units involved, for scaling the response. Optional. */
    count?: number;
  };
}

// ---------------------------------------------------------------------------
// Quality settings
// ---------------------------------------------------------------------------

export interface QualitySettings {
  /** 0 = low, 1 = medium, 2 = high, 3 = ultra. */
  preset: 0 | 1 | 2 | 3;
  shadows: boolean;
  shadowResolution: number;
  bloom: boolean;
  motionBlur: boolean;
  volumetrics: boolean;
  ssao: boolean;
  antialias: 'none' | 'fxaa' | 'smaa' | 'taa';
  maxParticles: number;
  pixelRatio: number;
  /** Distance multiplier for LOD switching (>1 keeps detail longer). */
  lodBias: number;
}
