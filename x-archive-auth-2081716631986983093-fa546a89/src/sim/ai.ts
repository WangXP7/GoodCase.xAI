/**
 * ENEMY COMMANDER — the skirmish AI.
 *
 * WHAT: a layered RTS brain that plays the same game the player does. It banks
 * resources, expands its harvesting, researches up the tech tree, scouts, masses
 * a combined-arms fleet in a staging area, commits it when it believes it can
 * win the engagement, peels off harassment wings onto undefended collectors,
 * recalls to defend its mothership, and pulls damaged capitals out of the line.
 *
 * WHY LAYERED: a single flat "if idle then attack nearest" loop produces the
 * classic hobby-demo behaviour — a permanent trickle of units flying one at a
 * time into a meat grinder. Real RTS AI separates timescales:
 *
 *   ECONOMIC / STRATEGY TICK  (~2-4.5 s, difficulty scaled)
 *       Reads the board, picks a doctrine phase from its own tech level, decides
 *       the economy-vs-military split, drives the research queue and the
 *       production planner.
 *
 *   PRODUCTION PLANNER        (runs inside the strategy tick)
 *       Holds a target composition per phase — early: collectors + interceptors,
 *       mid: corvettes + frigates, late: destroyers / cruisers / carrier — and
 *       queues whichever hull has the biggest supply deficit against that ratio.
 *
 *   TACTICAL TICK             (~0.8-2 s, difficulty scaled)
 *       Owns waves. Recruits idle combat hulls into a forming wave at a staging
 *       point, commits the wave when its combat power clears a threshold, keeps
 *       committed waves pointed at a coherent target, answers defence alerts by
 *       recalling the nearest wave, runs the harass wing and the scout patrol,
 *       and retreats broken capitals.
 *
 * NO CHEATING: every command goes through the public order API in `./orders` —
 * exactly the functions the input layer calls for the player. The AI never
 * writes ship state, never spawns a unit and never sees anything the sim does
 * not already expose. Difficulty scales three honest dials: a logistics subsidy
 * that is *proportional to collectors actually alive* (so it is a harvesting
 * efficiency bonus, never free units), reaction latency, and how much power it
 * insists on massing before it commits.
 *
 * ALLOCATION: `step` does timer bookkeeping and the subsidy only. All decision
 * work runs on the two ticks and reuses module-scope scratch buffers; the only
 * objects ever constructed after the ctor are wave records, and those are pooled.
 */

import { Vector3 } from 'three';
import type { SimSystem } from '../core/contracts';
import { RESEARCH_BY_ID, SHIP_SPECS, STARTING_UNLOCKS } from '../core/registry';
import { Rng } from '../core/rng';
import { CONFIG } from '../core/config';
import {
  HullSize,
  SHIP_CLASS_COUNT,
  ShipClass,
  Stance,
  Team,
  type Ship,
  type ShipSpec,
} from '../core/types';
import type { World } from './world';

// ---------------------------------------------------------------------------
// ORDER API BINDING
// ---------------------------------------------------------------------------
// The AI is a client of `./orders` and of nothing else. If the order module
// lands with different names, this import block is the ONLY thing that has to
// change — every call site below goes through these ten symbols.
//
// Assumed signatures (see the summary handed to the integrator):
//   orderMove(world, ids, x, y, z, manual?)
//   orderAttackMove(world, ids, x, y, z, manual?)
//   orderAttack(world, ids, targetId, manual?)
//   orderGuard(world, ids, targetId, manual?)
//   orderHarvest(world, ids, rockId, manual?)
//   orderStop(world, ids)
//   setStance(world, ids, stance)
//   setRally(world, producerShipId, x, y, z)
//   queueBuild(world, producerShipId, cls) -> boolean   (validates cost/supply)
//   startResearch(world, team, researchId) -> boolean
// ---------------------------------------------------------------------------

import {
  orderAttack,
  orderAttackMove,
  orderGuard,
  orderHarvest,
  orderMove,
  orderStop,
  queueBuild,
  setRally,
  setStance,
  startResearch,
} from './orders';

// ---------------------------------------------------------------------------
// Static tables — built once at module load from the ship registry.
// ---------------------------------------------------------------------------

/**
 * Combat value of one hull, in arbitrary "power points".
 *
 * Lanchester's square law says the strength of a force scales with the product
 * of its staying power and its damage output, so a fair scalar for a single
 * hull is sqrt(ehp * dps): it makes a glass-cannon and a brick of equal cost
 * score similarly, and it makes 4 interceptors worth roughly twice 1
 * interceptor rather than 4x. Utility hulls score 0 — they are never a reason
 * to commit a wave and never a reason to hold one back.
 */
const SHIP_POWER = new Float32Array(SHIP_CLASS_COUNT);

/** True for hulls that belong in an attack wave (armed, mobile, expendable). */
const IS_COMBAT = new Uint8Array(SHIP_CLASS_COUNT);

/** True for hulls the AI treats as capital assets worth retreating. */
const IS_CAPITAL = new Uint8Array(SHIP_CLASS_COUNT);

/** Sustained damage-per-second of a spec, averaging over burst/beam cycles. */
function specDps(sp: ShipSpec): number {
  let dps = 0;
  for (let i = 0; i < sp.hardpoints.length; i++) {
    const w = sp.weapons[sp.hardpoints[i].weapon];
    if (!w || w.kind === 'none') continue;
    if (w.kind === 'ion') {
      // `damage` is per second of dwell; `rate` is how often the beam recycles.
      dps += w.damage * (w.beamDwell ?? 1) * w.rate;
    } else if (w.burst && w.burstGap) {
      // A cycle is `burst` rounds fired at `rate`, then a gap.
      const cycle = w.burst / Math.max(w.rate, 1e-3) + w.burstGap;
      dps += (w.damage * w.burst) / cycle;
    } else {
      dps += w.damage * w.rate;
    }
  }
  return dps;
}

(function buildTables(): void {
  for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
    const sp = SHIP_SPECS[c as ShipClass];
    if (!sp) continue;
    const ehp = sp.maxHp + sp.maxShield;
    const dps = specDps(sp);
    SHIP_POWER[c] = dps > 0 ? Math.sqrt(ehp * dps) * 0.01 : 0;
    const combat =
      c !== ShipClass.Mothership &&
      c !== ShipClass.Carrier &&
      c !== ShipClass.ResourceRefinery &&
      c !== ShipClass.ResourceCollector &&
      dps > 0;
    IS_COMBAT[c] = combat ? 1 : 0;
    IS_CAPITAL[c] = sp.size === HullSize.Frigate || sp.size === HullSize.Capital ? 1 : 0;
  }
})();

// ---------------------------------------------------------------------------
// Doctrine — what the fleet should look like at each stage of the match.
// ---------------------------------------------------------------------------

/** One rung of the build doctrine. Phase is chosen purely from own tech. */
interface PhasePlan {
  /** Debug/telemetry label. */
  readonly name: string;
  /** Live resource collectors the AI wants before it stops prioritising econ. */
  readonly collectors: number;
  /** Refineries it wants standing (forward drop-off shortens harvest loops). */
  readonly refineries: number;
  /** Carriers it wants (second production line + supply cap). */
  readonly carriers: number;
  /**
   * Share of the combat supply budget each class should occupy. Weights are
   * relative, not normalised — the planner compares deficits, not absolutes.
   */
  readonly weights: Partial<Record<ShipClass, number>>;
}

const PHASES: readonly PhasePlan[] = [
  {
    name: 'opening',
    collectors: 5,
    refineries: 0,
    carriers: 0,
    weights: { [ShipClass.Scout]: 0.12, [ShipClass.Interceptor]: 0.88 },
  },
  {
    name: 'strike',
    collectors: 8,
    refineries: 1,
    carriers: 0,
    weights: {
      [ShipClass.Scout]: 0.05,
      [ShipClass.Interceptor]: 0.32,
      [ShipClass.Bomber]: 0.18,
      [ShipClass.AssaultCorvette]: 0.32,
      [ShipClass.MissileCorvette]: 0.13,
    },
  },
  {
    name: 'line',
    collectors: 10,
    refineries: 1,
    carriers: 0,
    weights: {
      [ShipClass.Scout]: 0.03,
      [ShipClass.Interceptor]: 0.16,
      [ShipClass.Bomber]: 0.14,
      [ShipClass.AssaultCorvette]: 0.17,
      [ShipClass.MissileCorvette]: 0.12,
      [ShipClass.IonFrigate]: 0.18,
      [ShipClass.AssaultFrigate]: 0.20,
    },
  },
  {
    name: 'capital',
    collectors: 12,
    refineries: 2,
    carriers: 1,
    weights: {
      [ShipClass.Interceptor]: 0.10,
      [ShipClass.Bomber]: 0.12,
      [ShipClass.AssaultCorvette]: 0.10,
      [ShipClass.MissileCorvette]: 0.10,
      [ShipClass.IonFrigate]: 0.16,
      [ShipClass.AssaultFrigate]: 0.14,
      [ShipClass.Destroyer]: 0.19,
      [ShipClass.HeavyCruiser]: 0.09,
    },
  },
];

/**
 * Research order of preference. The planner walks this list and starts the
 * first entry whose prerequisites are met — economy first so the tech that
 * follows is actually payable, then the strike-craft/capital spine.
 */
const RESEARCH_PLAN: readonly string[] = [
  'refining',    // forward drop-off: shortens every harvest loop from here on
  'strikecraft', // bombers + assault corvettes, the first real fleet
  'capships',    // frigates — the line that stops a fighter ball
  'destroyers',  // deliberately early: it also unlocks the Carrier, and a
                 // second production line is worth more than any single stat
  'guidance',
  'drives',
  'plating',
  'shields',
  'cruisers',
];

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/**
 * Honest difficulty dials. None of these hand the AI a unit it did not pay for.
 * `incomeMult` is applied as a per-collector harvesting subsidy, so an AI whose
 * collectors are dead earns exactly nothing from it.
 */
interface DifficultyTuning {
  /** Harvesting efficiency multiplier, applied per live collector. */
  readonly incomeMult: number;
  /** Seconds between strategy ticks (economy, research, production). */
  readonly strategyPeriod: number;
  /** Seconds between tactical ticks (waves, defence, harass, retreat). */
  readonly tacticalPeriod: number;
  /** Extra seconds of latency before a defence alert is acted on. */
  readonly reaction: number;
  /** Absolute power floor before a wave may be committed. */
  readonly minWavePower: number;
  /** Wave power required as a multiple of the enemy's standing combat power. */
  readonly commitRatio: number;
  /** Whether the harassment wing is used at all. */
  readonly harass: boolean;
  /** Maximum simultaneously committed waves (beyond the forming one). */
  readonly maxWaves: number;
  /** HP fraction below which a capital is pulled out of the line. */
  readonly retreatHp: number;
  /** HP fraction at which a retreated capital rejoins the fleet. */
  readonly rejoinHp: number;
}

const DIFFICULTIES: readonly DifficultyTuning[] = [
  {
    incomeMult: 1.0, strategyPeriod: 4.5, tacticalPeriod: 2.0, reaction: 4.0,
    minWavePower: 4, commitRatio: 0.55, harass: false, maxWaves: 1,
    retreatHp: 0.18, rejoinHp: 0.5,
  },
  {
    incomeMult: 1.15, strategyPeriod: 3.0, tacticalPeriod: 1.2, reaction: 2.0,
    minWavePower: 9, commitRatio: 0.95, harass: true, maxWaves: 2,
    retreatHp: 0.30, rejoinHp: 0.62,
  },
  {
    incomeMult: 1.35, strategyPeriod: 2.2, tacticalPeriod: 0.8, reaction: 0.8,
    minWavePower: 14, commitRatio: 1.15, harass: true, maxWaves: 3,
    retreatHp: 0.38, rejoinHp: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Tunables that do not vary with difficulty
// ---------------------------------------------------------------------------

/** Enemies inside this radius of the mothership raise a home defence alert. */
const DEFEND_HOME_RADIUS = 8000;
/** Enemies inside this radius of a collector raise a mining defence alert. */
const DEFEND_MINE_RADIUS = 3600;
/** A wave switches from attack-move to a focused attack inside this range. */
const ENGAGE_RANGE = 2600;
/** Committed waves refresh their orders this often (seconds). */
const REISSUE_PERIOD = 3.5;
/** Fraction of the way to the enemy that the forming wave stages at. */
const STAGE_FRACTION = 0.24;
/** Build queue depth the planner will not exceed on any one producer. */
const MAX_QUEUE_DEPTH = 3;
/** Build orders the planner may issue in a single strategy tick. */
const MAX_QUEUES_PER_TICK = 4;
/** Resource cushion kept in the bank so production never fully starves. */
const RESEARCH_RESERVE = 700;
/** Fighters assigned to the harassment wing. */
const HARASS_WING = 3;
/** Scouts kept on patrol duty. */
const SCOUT_WING = 2;
/** Waypoints in the deterministic patrol ring. */
const PATROL_POINTS = 8;
/**
 * Average duty cycle of a collector: it only mines for part of its loop, the
 * rest is transit. Used to size the harvesting subsidy realistically.
 */
const HARVEST_DUTY = 0.5;

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

type WaveState = 'forming' | 'attacking' | 'defending';

/** A cohesive group of combat hulls under one tactical intent. */
interface Wave {
  alive: boolean;
  state: WaveState;
  /** Ship ids. Compacted in place every tactical tick. */
  members: number[];
  /** Cached combat power of the live members. */
  power: number;
  /** Cached centroid of the live members. */
  centre: Vector3;
  /** Focused enemy ship id, or -1 for a positional objective. */
  target: number;
  /** World-space objective (staging point, threat position, target position). */
  goal: Vector3;
  /** Seconds until the wave re-issues its movement order. */
  reissue: number;
}

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing in the tick path allocates.
// ---------------------------------------------------------------------------

const _goal = new Vector3();
const _dir = new Vector3();
const _stage = new Vector3();
const _threat = new Vector3();

/** Scratch id buffers. Each has exactly one owner call-path; never nest them. */
const _one: number[] = [0];
const _issue: number[] = [];
const _query: number[] = [];
const _idle: number[] = [];
const _collectors: number[] = [];
const _scouts: number[] = [];

// ---------------------------------------------------------------------------
// EnemyAI
// ---------------------------------------------------------------------------

/**
 * The skirmish opponent. Construct one per non-player faction and step it from
 * the fixed-rate sim loop alongside movement/combat/economy.
 *
 * ```ts
 * const ai = new EnemyAI(world, Team.Enemy, 1);
 * // inside the fixed step:
 * ai.step(world, CONFIG.simStep);
 * ```
 */
export class EnemyAI implements SimSystem {
  /** Faction this brain commands. */
  readonly team: Team;
  /** The faction it is trying to kill. */
  readonly foe: Team;
  /** 0 = cadet, 1 = veteran, 2 = admiral. */
  readonly difficulty: 0 | 1 | 2;

  private readonly tune: DifficultyTuning;
  private readonly rng: Rng;

  // -- tick timers ---------------------------------------------------------
  private strategyT = 0;
  private tacticalT = 0;
  /** Counts down after a defence alert fires; the recall happens at zero. */
  private alertT = -1;
  /** Position of the threat that raised the pending alert. */
  private readonly alertPos = new Vector3();

  // -- cached board state, refreshed on the tactical tick -------------------
  private readonly own = new Int32Array(SHIP_CLASS_COUNT);
  private readonly foeCount = new Int32Array(SHIP_CLASS_COUNT);
  private ownPower = 0;
  private foePower = 0;
  private ownCollectors = 0;
  /** Centroid of our mothership, or the fleet if it is gone. */
  private readonly home = new Vector3();
  /** Best-known enemy anchor (their mothership, else their fleet centroid). */
  private readonly foeHome = new Vector3();
  private foeHomeKnown = false;

  // -- tactical bookkeeping ------------------------------------------------
  private readonly waves: Wave[] = [];
  /** Index into `waves` of the wave currently recruiting, or -1. */
  private forming = -1;
  /** Ship ids currently pulled out of the line for repair/withdrawal. */
  private readonly retreating = new Set<number>();
  /** Ship ids on harassment duty. */
  private readonly harassers: number[] = [];
  /** Ship ids on scouting duty, parallel to `patrolIndex`. */
  private readonly patrollers: number[] = [];
  private readonly patrolIndex: number[] = [];
  /** Deterministic patrol ring. */
  private readonly patrol: Vector3[] = [];
  /** Last rally point pushed to producers — avoids re-issuing every tick. */
  private readonly rally = new Vector3();
  private rallySet = false;

  constructor(world: World, team: Team, difficulty: 0 | 1 | 2) {
    this.team = team;
    this.foe = team === Team.Player ? Team.Enemy : Team.Player;
    this.difficulty = difficulty;
    this.tune = DIFFICULTIES[difficulty];
    // Fork off the world seed so the AI's cosmetic jitter is reproducible but
    // does not perturb the world's own generation stream.
    this.rng = new Rng((world.seed ^ (0x5bf03635 + team * 0x9e3779b9)) >>> 0);

    // Patrol ring: evenly spaced around the battlespace at ~55% of map radius,
    // with a deterministic phase offset and a shallow vertical wobble so the
    // scouts do not fly a flat circle.
    const r = CONFIG.mapRadius * 0.55;
    const phase = this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < PATROL_POINTS; i++) {
      const a = phase + (i / PATROL_POINTS) * Math.PI * 2;
      this.patrol.push(new Vector3(
        Math.cos(a) * r,
        this.rng.range(-1, 1) * CONFIG.mapHeight * 0.22,
        Math.sin(a) * r,
      ));
    }

    // Stagger the first ticks so several AIs never think on the same frame.
    this.strategyT = this.rng.range(0.2, this.tune.strategyPeriod);
    this.tacticalT = this.rng.range(0.1, this.tune.tacticalPeriod);
  }

  // -----------------------------------------------------------------------
  // SimSystem
  // -----------------------------------------------------------------------

  /** Advance the commander. Cheap on most frames; thinks on its two timers. */
  step(world: World, dt: number): void {
    if (world.gameOver !== null) return;

    this.applySubsidy(world, dt);

    this.tacticalT -= dt;
    if (this.tacticalT <= 0) {
      this.tacticalT += this.tune.tacticalPeriod;
      this.survey(world);
      this.tactical(world, this.tune.tacticalPeriod);
    }

    this.strategyT -= dt;
    if (this.strategyT <= 0) {
      this.strategyT += this.tune.strategyPeriod;
      this.strategy(world);
    }

    if (this.alertT >= 0) {
      this.alertT -= dt;
      if (this.alertT <= 0) {
        this.alertT = -1;
        this.respondToAlert(world);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Economy subsidy
  // -----------------------------------------------------------------------

  /**
   * The only resource the AI is handed. It is a *harvesting efficiency* bonus
   * proportional to the collectors it currently keeps alive, so killing its
   * mining fleet removes it entirely — it can never buy the AI a unit it did
   * not earn by holding a resource field.
   */
  private applySubsidy(world: World, dt: number): void {
    const mult = this.tune.incomeMult;
    if (mult <= 1 || this.ownCollectors === 0) return;
    const h = SHIP_SPECS[ShipClass.ResourceCollector].harvest;
    if (!h) return;
    world.factions[this.team].resources +=
      (mult - 1) * this.ownCollectors * h.rate * HARVEST_DUTY * dt;
  }

  // -----------------------------------------------------------------------
  // Board survey — one pass over the ship pool per tactical tick.
  // -----------------------------------------------------------------------

  private survey(world: World): void {
    this.own.fill(0);
    this.foeCount.fill(0);
    this.ownPower = 0;
    this.foePower = 0;
    this.ownCollectors = 0;
    _idle.length = 0;
    _collectors.length = 0;
    _scouts.length = 0;

    let ownFleetX = 0, ownFleetY = 0, ownFleetZ = 0, ownFleetN = 0;
    let foeFleetX = 0, foeFleetY = 0, foeFleetZ = 0, foeFleetN = 0;

    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive) continue;

      if (s.team === this.team) {
        this.own[s.cls]++;
        if (s.cls === ShipClass.ResourceCollector) {
          this.ownCollectors++;
          _collectors.push(s.id);
        }
        if (IS_COMBAT[s.cls]) {
          this.ownPower += SHIP_POWER[s.cls];
          ownFleetX += s.pos.x; ownFleetY += s.pos.y; ownFleetZ += s.pos.z; ownFleetN++;
          if (s.cls === ShipClass.Scout) _scouts.push(s.id);
          // Unassigned + idle + not withdrawn = available for recruitment.
          if (
            s.dockedIn < 0 &&
            s.order.kind === 'idle' &&
            !this.retreating.has(s.id) &&
            this.waveOf(s.id) < 0 &&
            this.harassers.indexOf(s.id) < 0 &&
            this.patrollers.indexOf(s.id) < 0
          ) {
            _idle.push(s.id);
          }
        }
      } else if (s.team === this.foe) {
        this.foeCount[s.cls]++;
        if (IS_COMBAT[s.cls]) {
          this.foePower += SHIP_POWER[s.cls];
          foeFleetX += s.pos.x; foeFleetY += s.pos.y; foeFleetZ += s.pos.z; foeFleetN++;
        }
      }
    }

    // Fold in-flight production into the headcount. Without this the planner
    // re-orders the same hull on every strategy tick until the first one rolls
    // out — a 30 s collector against a 3 s tick is ten collectors nobody asked
    // for, and the fleet composition never matches the doctrine.
    for (const p of world.producers.values()) {
      const host = world.ship(p.shipId);
      if (!host || host.team !== this.team) continue;
      for (let i = 0; i < p.queue.length; i++) this.own[p.queue[i].cls]++;
    }

    // Home anchor: the mothership if we still have one, else the fleet.
    const msId = world.motherships[this.team];
    const ms = msId >= 0 ? world.ship(msId) : undefined;
    if (ms) this.home.copy(ms.pos);
    else if (ownFleetN > 0) this.home.set(ownFleetX / ownFleetN, ownFleetY / ownFleetN, ownFleetZ / ownFleetN);

    const fmsId = world.motherships[this.foe];
    const fms = fmsId >= 0 ? world.ship(fmsId) : undefined;
    if (fms) {
      this.foeHome.copy(fms.pos);
      this.foeHomeKnown = true;
    } else if (foeFleetN > 0) {
      this.foeHome.set(foeFleetX / foeFleetN, foeFleetY / foeFleetN, foeFleetZ / foeFleetN);
      this.foeHomeKnown = true;
    }
  }

  // -----------------------------------------------------------------------
  // STRATEGY LAYER — economy, research, production.
  // -----------------------------------------------------------------------

  private strategy(world: World): void {
    const plan = PHASES[this.phase(world)];
    this.keepCollectorsMining(world);
    this.pushRally(world);
    this.research(world, plan);
    this.produce(world, plan);
  }

  /**
   * Doctrine phase, derived from completed research rather than the clock so a
   * starved AI does not pretend it has a capital fleet it cannot afford.
   */
  private phase(world: World): number {
    const done = world.factions[this.team].research;
    if (done.has('destroyers')) return 3;
    if (done.has('capships')) return 2;
    if (done.has('strikecraft')) return 1;
    return 0;
  }

  /** Any collector sitting idle is put back on the nearest live rock. */
  private keepCollectorsMining(world: World): void {
    for (let i = 0; i < _collectors.length; i++) {
      const s = world.ship(_collectors[i]);
      if (!s || s.dockedIn >= 0) continue;
      if (s.order.kind === 'harvest' || s.cargo > 0) continue;
      if (s.order.kind !== 'idle') continue;
      const rock = world.nearestRock(s.pos.x, s.pos.y, s.pos.z, CONFIG.mapRadius);
      if (rock < 0) continue;
      _one[0] = s.id;
      orderHarvest(world, _one, rock, false);
    }
  }

  /**
   * Producers rally to the staging point so freshly built hulls walk themselves
   * into the forming wave instead of loitering in the mothership's shadow.
   */
  private pushRally(world: World): void {
    this.stagingPoint(_stage);
    // Only re-issue when the point has moved meaningfully — rally changes are
    // cheap but they churn the producer state for no benefit.
    if (this.rallySet && this.rally.distanceToSquared(_stage) < 400 * 400) return;
    this.rally.copy(_stage);
    this.rallySet = true;
    for (const p of world.producers.values()) {
      const s = world.ship(p.shipId);
      if (!s || s.team !== this.team) continue;
      setRally(world, p.shipId, _stage.x, _stage.y, _stage.z);
    }
  }

  /** Start the first affordable, unblocked entry in the research plan. */
  private research(world: World, plan: PhasePlan): void {
    const f = world.factions[this.team];
    if (f.researching) return;
    for (let i = 0; i < RESEARCH_PLAN.length; i++) {
      const id = RESEARCH_PLAN[i];
      if (f.research.has(id)) continue;
      const spec = RESEARCH_BY_ID.get(id);
      if (!spec) continue;
      let ready = true;
      for (let k = 0; k < spec.requires.length; k++) {
        if (!f.research.has(spec.requires[k])) { ready = false; break; }
      }
      if (!ready) continue;
      // Never tech into an empty bank: keep enough to replace losses. Early on
      // the reserve is small so the opening tech comes down fast.
      const reserve = plan.collectors > 6 ? RESEARCH_RESERVE : RESEARCH_RESERVE * 0.4;
      if (f.resources < spec.cost + reserve) return;
      if (startResearch(world, this.team, id)) return;
      return;
    }
  }

  /**
   * Production planner. Spends down the bank in priority order:
   *   1. economy until the phase's collector target is met,
   *   2. infrastructure (refinery, carrier) once unlocked,
   *   3. whichever combat hull is furthest below its share of the doctrine.
   */
  private produce(world: World, plan: PhasePlan): void {
    const f = world.factions[this.team];
    // A fat bank means the bottleneck is the yard, not the wallet: let the AI
    // queue deeper so it converts banked resources into hulls instead of
    // sitting on five figures it will never spend.
    const depth = Math.min(10, MAX_QUEUE_DEPTH + Math.floor(f.resources / 4000));

    // Rich and nearly supply-capped is a dead end: the bank grows and nothing
    // can be spent on. An extra carrier is the only answer that buys both
    // headroom (+supplyPerCarrier) and throughput (a second hangar queue), so
    // the doctrine's carrier target flexes upward under cap pressure.
    const capPressure = f.supply >= f.supplyCap * 0.8 && f.resources > 8000;
    const carrierTarget = Math.min(3, plan.carriers + (capPressure ? 2 : 0));

    for (let issued = 0; issued < MAX_QUEUES_PER_TICK; issued++) {
      let want: ShipClass | -1 = -1;

      // --- economy first ---------------------------------------------------
      // Collectors are the only thing the AI will *save* for. Falling through
      // to a cheap interceptor every time a 400-credit collector is out of
      // reach is how an AI ends a match at zero resources with no economy —
      // it can never accumulate past the cost of its cheapest unit.
      if (this.own[ShipClass.ResourceCollector] < plan.collectors) {
        if (this.unlocked(world, ShipClass.ResourceCollector) &&
            this.supplyFits(world, ShipClass.ResourceCollector)) {
          if (f.resources < SHIP_SPECS[ShipClass.ResourceCollector].cost) return; // save up
          want = ShipClass.ResourceCollector;
        }
      }

      // --- infrastructure --------------------------------------------------
      // Refineries and carriers are expensive enough that stalling the entire
      // military queue to save for one is a losing trade, so these only get
      // built out of surplus.
      if (want === -1 && this.own[ShipClass.ResourceRefinery] < plan.refineries &&
          this.canBuild(world, ShipClass.ResourceRefinery, f.resources)) {
        want = ShipClass.ResourceRefinery;
      }
      if (want === -1 && this.own[ShipClass.Carrier] < carrierTarget &&
          this.canBuild(world, ShipClass.Carrier, f.resources)) {
        want = ShipClass.Carrier;
      }

      // --- military --------------------------------------------------------
      if (want === -1) want = this.pickCombatClass(world, plan, f.resources, f.supplyCap);
      // -1 means either nothing is affordable or `pickSave` is set and we are
      // deliberately banking toward a capital. Either way: queue nothing.
      if (want === -1) return;
      const cls: ShipClass = want;

      if (!this.queueOn(world, cls, depth)) return;
      // `queueBuild` owns the resource/supply debit. We mirror the headcount
      // locally so the next iteration of this same tick plans against the fleet
      // it just ordered rather than queueing the same hull four times.
      this.own[cls]++;
      if (f.resources < SHIP_SPECS[cls].cost) return;
    }
  }

  /**
   * True when the last `pickCombatClass` deliberately declined to spend because
   * it is banking toward a capital hull. Exposed for debug overlays.
   */
  private pickSave = false;

  /**
   * Pick the combat hull with the largest *supply* deficit against the doctrine
   * weights. Measuring in supply rather than headcount is the whole point: one
   * destroyer is twenty interceptors' worth of fleet, so a doctrine that asks
   * for 19% destroyers is satisfied by one destroyer, not by nineteen of them.
   *
   * If the biggest gap is a hull the AI cannot yet afford but is close to
   * affording, it returns -1 and sets `pickSave`, which stalls production for
   * one tick. Without that, an AI whose doctrine wants a 2400-credit destroyer
   * spends every tick's income on 110-credit interceptors and never fields a
   * capital ship at all — the single most common way an RTS AI ends a long
   * match with a swarm of obsolete fighters.
   */
  private pickCombatClass(
    world: World, plan: PhasePlan, bank: number, supplyCap: number,
  ): ShipClass | -1 {
    this.pickSave = false;

    // Combat gets whatever supply the utility fleet is not already using.
    let utility = 0;
    utility += this.own[ShipClass.ResourceCollector] * SHIP_SPECS[ShipClass.ResourceCollector].supply;
    utility += this.own[ShipClass.ResourceRefinery] * SHIP_SPECS[ShipClass.ResourceRefinery].supply;
    utility += this.own[ShipClass.Carrier] * SHIP_SPECS[ShipClass.Carrier].supply;
    const combatBudget = Math.max(0, supplyCap - utility);

    let best: ShipClass | -1 = -1;      // biggest gap, affordability ignored
    let bestGap = -Infinity;
    let afford: ShipClass | -1 = -1;    // biggest gap we can pay for right now
    let affordGap = -Infinity;

    for (const key in plan.weights) {
      const cls = Number(key) as ShipClass;
      const weight = plan.weights[cls];
      if (weight === undefined) continue;
      if (!this.unlocked(world, cls) || !this.supplyFits(world, cls)) continue;
      const sp = SHIP_SPECS[cls];
      const gap = weight * combatBudget - this.own[cls] * sp.supply;
      if (gap > bestGap) {
        bestGap = gap;
        best = cls;
      }
      if (bank >= sp.cost && gap > affordGap) {
        affordGap = gap;
        afford = cls;
      }
    }

    if (best !== -1 && bank < SHIP_SPECS[best].cost) {
      // Within striking distance of the hull the doctrine actually wants: hold
      // the bank for a tick rather than frittering it away.
      if (bank >= SHIP_SPECS[best].cost * 0.5) {
        this.pickSave = true;
        return -1;
      }
    }
    return afford;
  }

  /** Unlocked, affordable, and inside the supply cap. */
  private canBuild(world: World, cls: ShipClass, bank: number): boolean {
    if (bank < SHIP_SPECS[cls].cost) return false;
    return this.unlocked(world, cls) && this.supplyFits(world, cls);
  }

  /** Available at start, or unlocked by a completed research. */
  private unlocked(world: World, cls: ShipClass): boolean {
    if (STARTING_UNLOCKS.indexOf(cls) >= 0) return true;
    for (const id of world.factions[this.team].research) {
      const r = RESEARCH_BY_ID.get(id);
      if (r && r.unlocks.indexOf(cls) >= 0) return true;
    }
    return false;
  }

  /** Room under the supply cap for one more of `cls`. */
  private supplyFits(world: World, cls: ShipClass): boolean {
    const f = world.factions[this.team];
    return f.supply + SHIP_SPECS[cls].supply <= f.supplyCap;
  }

  /** Queue `cls` on the shallowest producer that is allowed to build it. */
  private queueOn(world: World, cls: ShipClass, maxDepth: number): boolean {
    let bestId = -1;
    let bestDepth = maxDepth;
    for (const p of world.producers.values()) {
      const s = world.ship(p.shipId);
      if (!s || s.team !== this.team) continue;
      if (SHIP_SPECS[s.cls].builds.indexOf(cls) < 0) continue;
      if (p.queue.length < bestDepth) {
        bestDepth = p.queue.length;
        bestId = p.shipId;
      }
    }
    if (bestId < 0) return false;
    return queueBuild(world, bestId, cls);
  }

  // -----------------------------------------------------------------------
  // TACTICAL LAYER — waves, defence, harassment, scouting, withdrawal.
  // -----------------------------------------------------------------------

  private tactical(world: World, dt: number): void {
    this.pruneWaves(world);
    this.withdrawBroken(world);
    this.runScouts(world);
    this.runHarass(world);
    this.recruit(world);
    this.driveWaves(world, dt);
    this.checkDefence(world);
  }

  /** Compact member lists, recompute power/centroid, retire empty waves. */
  private pruneWaves(world: World): void {
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (!wave.alive) continue;
      const m = wave.members;
      let n = 0;
      let power = 0;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < m.length; i++) {
        const s = world.ship(m[i]);
        if (!s || s.team !== this.team || this.retreating.has(s.id)) continue;
        m[n++] = s.id;
        power += SHIP_POWER[s.cls];
        cx += s.pos.x; cy += s.pos.y; cz += s.pos.z;
      }
      m.length = n;
      wave.power = power;
      if (n > 0) wave.centre.set(cx / n, cy / n, cz / n);
      if (n === 0) {
        wave.alive = false;
        if (this.forming === w) this.forming = -1;
      }
    }
  }

  /**
   * Broken capitals are worth more alive: a 30%-hp destroyer that dies adds
   * nothing, one that withdraws is a destroyer again in the next wave. Fighters
   * are not worth the micro and are left in the fight.
   */
  private withdrawBroken(world: World): void {
    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || s.team !== this.team || !IS_CAPITAL[s.cls]) continue;
      const sp = SHIP_SPECS[s.cls];
      const ratio = s.hp / sp.maxHp;
      if (!this.retreating.has(s.id)) {
        if (ratio < this.tune.retreatHp) {
          this.retreating.add(s.id);
          this.dropFromWaves(s.id);
          _one[0] = s.id;
          setStance(world, _one, Stance.Evasive);
          // Fall back behind the mothership so the withdrawal path does not
          // cut back through the engagement it is leaving.
          this.behindHome(_goal, sp.radius * 6 + 900);
          orderMove(world, _one, _goal.x, _goal.y, _goal.z, false);
        }
      } else if (ratio >= this.tune.rejoinHp) {
        this.retreating.delete(s.id);
        _one[0] = s.id;
        setStance(world, _one, Stance.Aggressive);
        orderStop(world, _one);
      }
    }
  }

  /** Keep up to `SCOUT_WING` scouts walking the patrol ring. */
  private runScouts(world: World): void {
    // Drop dead or reassigned scouts.
    for (let i = this.patrollers.length - 1; i >= 0; i--) {
      const s = world.ship(this.patrollers[i]);
      if (!s || s.team !== this.team || s.cls !== ShipClass.Scout) {
        this.patrollers.splice(i, 1);
        this.patrolIndex.splice(i, 1);
      }
    }
    // Recruit from the live scout pool.
    for (let i = 0; i < _scouts.length && this.patrollers.length < SCOUT_WING; i++) {
      const id = _scouts[i];
      if (this.patrollers.indexOf(id) >= 0) continue;
      if (this.retreating.has(id)) continue;
      this.dropFromWaves(id);
      this.patrollers.push(id);
      // Start each scout on the ring segment nearest the enemy so the first
      // sweep actually produces intel instead of touring our own back yard.
      this.patrolIndex.push(this.rng.int(0, PATROL_POINTS - 1));
      _one[0] = id;
      setStance(world, _one, Stance.Evasive);
    }
    // Advance anyone who has arrived.
    for (let i = 0; i < this.patrollers.length; i++) {
      const s = world.ship(this.patrollers[i]);
      if (!s) continue;
      if (s.order.kind !== 'idle') continue;
      const next = (this.patrolIndex[i] + 1) % PATROL_POINTS;
      this.patrolIndex[i] = next;
      const p = this.patrol[next];
      _one[0] = s.id;
      orderMove(world, _one, p.x, p.y, p.z, false);
    }
  }

  /**
   * Harassment: a small fighter wing hunts enemy collectors that have no combat
   * escort. Killing mining is the cheapest way to win an economic race, and it
   * forces the player to split attention — the thing that makes an RTS AI feel
   * like an opponent rather than an obstacle.
   */
  private runHarass(world: World): void {
    if (!this.tune.harass) return;

    for (let i = this.harassers.length - 1; i >= 0; i--) {
      const s = world.ship(this.harassers[i]);
      if (!s || s.team !== this.team || this.retreating.has(this.harassers[i])) {
        this.harassers.splice(i, 1);
      }
    }

    const prey = this.findUndefendedCollector(world);
    if (prey < 0) {
      // Nothing to hunt — release the wing back into the wave pool.
      if (this.harassers.length > 0) {
        _issue.length = 0;
        for (let i = 0; i < this.harassers.length; i++) _issue.push(this.harassers[i]);
        this.harassers.length = 0;
        orderStop(world, _issue);
      }
      return;
    }

    // Top the wing up from idle fighters only; never strip a frigate for this.
    for (let i = 0; i < _idle.length && this.harassers.length < HARASS_WING; i++) {
      const s = world.ship(_idle[i]);
      if (!s) continue;
      if (SHIP_SPECS[s.cls].size !== HullSize.Fighter) continue;
      if (s.cls === ShipClass.Scout) continue;
      this.dropFromWaves(s.id);
      this.harassers.push(s.id);
    }
    if (this.harassers.length === 0) return;

    _issue.length = 0;
    for (let i = 0; i < this.harassers.length; i++) _issue.push(this.harassers[i]);
    setStance(world, _issue, Stance.Aggressive);
    orderAttack(world, _issue, prey, false);
  }

  /** Nearest enemy collector with no enemy combat hull covering it. */
  private findUndefendedCollector(world: World): number {
    let best = -1;
    let bestD = Infinity;
    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || s.team !== this.foe) continue;
      if (s.cls !== ShipClass.ResourceCollector) continue;
      const d = s.pos.distanceToSquared(this.home);
      if (d >= bestD) continue;
      if (this.escortedBy(world, s, 3000)) continue;
      bestD = d;
      best = s.id;
    }
    return best;
  }

  /** True if any enemy combat hull sits within `r` of `s`. */
  private escortedBy(world: World, s: Ship, r: number): boolean {
    _query.length = 0;
    world.coarse.query(s.pos.x, s.pos.y, s.pos.z, r, _query);
    const r2 = r * r;
    for (let i = 0; i < _query.length; i++) {
      const o = world.ships.items[_query[i]];
      if (!o || !o.alive || o.team !== s.team || !IS_COMBAT[o.cls]) continue;
      if (o.pos.distanceToSquared(s.pos) <= r2) return true;
    }
    return false;
  }

  // -- wave lifecycle ------------------------------------------------------

  /** Index of the wave containing `id`, or -1. */
  private waveOf(id: number): number {
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (wave.alive && wave.members.indexOf(id) >= 0) return w;
    }
    return -1;
  }

  private dropFromWaves(id: number): void {
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (!wave.alive) continue;
      const i = wave.members.indexOf(id);
      if (i >= 0) wave.members.splice(i, 1);
    }
  }

  /** Reuse a dead wave record if one exists, else grow the pool. */
  private acquireWave(): number {
    for (let w = 0; w < this.waves.length; w++) {
      if (!this.waves[w].alive) {
        const wave = this.waves[w];
        wave.alive = true;
        wave.state = 'forming';
        wave.members.length = 0;
        wave.power = 0;
        wave.target = -1;
        wave.reissue = 0;
        return w;
      }
    }
    this.waves.push({
      alive: true, state: 'forming', members: [], power: 0,
      centre: new Vector3(), target: -1, goal: new Vector3(), reissue: 0,
    });
    return this.waves.length - 1;
  }

  /** Fold every unassigned idle combat hull into the forming wave. */
  private recruit(world: World): void {
    if (_idle.length === 0) return;
    if (this.forming < 0 || !this.waves[this.forming].alive) {
      this.forming = this.acquireWave();
      this.waves[this.forming].state = 'forming';
    }
    const wave = this.waves[this.forming];
    _issue.length = 0;
    for (let i = 0; i < _idle.length; i++) {
      const id = _idle[i];
      if (this.harassers.indexOf(id) >= 0) continue;
      if (this.patrollers.indexOf(id) >= 0) continue;
      if (wave.members.indexOf(id) >= 0) continue;
      wave.members.push(id);
      wave.power += SHIP_POWER[world.ships.items[id].cls];
      _issue.push(id);
    }
    if (_issue.length === 0) return;
    this.stagingPoint(_stage);
    wave.goal.copy(_stage);
    setStance(world, _issue, Stance.Aggressive);
    orderAttackMove(world, _issue, _stage.x, _stage.y, _stage.z, false);
  }

  /**
   * Per-tick wave logic: commit the forming wave when it is strong enough,
   * keep committed waves pointed at a live objective, and re-issue movement
   * orders periodically so ships that finished their move do not stall.
   */
  private driveWaves(world: World, dt: number): void {
    const commitPower = Math.max(
      this.tune.minWavePower,
      this.foePower * this.tune.commitRatio,
    );
    const committed = this.countCommitted();

    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (!wave.alive || wave.members.length === 0) continue;
      wave.reissue -= dt;

      if (wave.state === 'forming') {
        // Hold at the staging point until the wave clears the bar AND we have
        // room for another committed group. A wave that never commits is a
        // wave that keeps growing — that is the intended failure mode.
        if (wave.power >= commitPower && committed < this.tune.maxWaves && this.foeHomeKnown) {
          wave.state = 'attacking';
          wave.reissue = 0;
          wave.target = this.chooseTarget(world);
          if (this.forming === w) this.forming = -1;
        } else if (wave.reissue <= 0) {
          this.stagingPoint(_stage);
          wave.goal.copy(_stage);
          wave.reissue = REISSUE_PERIOD * 2;
          this.issueMoveWave(world, wave, _stage, false);
        }
        continue;
      }

      if (wave.state === 'defending') {
        // Defence ends when the threat area is clear; the wave then re-forms.
        const hostile = world.nearestEnemy(
          wave.goal.x, wave.goal.y, wave.goal.z, this.team, DEFEND_MINE_RADIUS * 2,
        );
        if (hostile < 0) {
          wave.state = 'forming';
          wave.reissue = 0;
          if (this.forming < 0) this.forming = w;
        } else if (wave.reissue <= 0) {
          wave.reissue = REISSUE_PERIOD;
          const h = world.ship(hostile);
          if (h) wave.goal.copy(h.pos);
          this.issueMoveWave(world, wave, wave.goal, true);
        }
        continue;
      }

      // --- attacking ---
      let tgt = wave.target >= 0 ? world.ship(wave.target) : undefined;
      if (!tgt || tgt.team !== this.foe) {
        wave.target = this.chooseTarget(world);
        tgt = wave.target >= 0 ? world.ship(wave.target) : undefined;
        wave.reissue = 0;
      }
      if (!tgt) {
        // Nothing left to shoot: fall back to forming so the hulls regroup.
        wave.state = 'forming';
        if (this.forming < 0) this.forming = w;
        continue;
      }
      if (wave.reissue > 0) continue;
      wave.reissue = REISSUE_PERIOD;
      const d2 = wave.centre.distanceToSquared(tgt.pos);
      if (d2 <= ENGAGE_RANGE * ENGAGE_RANGE) {
        _issue.length = 0;
        for (let i = 0; i < wave.members.length; i++) _issue.push(wave.members[i]);
        orderAttack(world, _issue, tgt.id, false);
      } else {
        // Approach on an attack-move so escorts and pickets get chewed up on
        // the way in rather than being flown past.
        wave.goal.copy(tgt.pos);
        this.issueMoveWave(world, wave, wave.goal, true);
      }
    }
  }

  private countCommitted(): number {
    let n = 0;
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (wave.alive && wave.members.length > 0 && wave.state !== 'forming') n++;
    }
    return n;
  }

  private issueMoveWave(world: World, wave: Wave, to: Vector3, aggressive: boolean): void {
    _issue.length = 0;
    for (let i = 0; i < wave.members.length; i++) _issue.push(wave.members[i]);
    if (_issue.length === 0) return;
    if (aggressive) orderAttackMove(world, _issue, to.x, to.y, to.z, false);
    else orderMove(world, _issue, to.x, to.y, to.z, false);
  }

  /**
   * Objective priority: enemy production and refining first (killing the
   * economy wins the long game), then the mothership. Undefended collectors
   * belong to the harass wing, not to a capital wave.
   */
  private chooseTarget(world: World): number {
    let best = -1;
    let bestScore = -Infinity;
    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || s.team !== this.foe) continue;
      let value: number;
      switch (s.cls) {
        case ShipClass.Carrier: value = 900; break;
        case ShipClass.ResourceRefinery: value = 700; break;
        case ShipClass.Mothership: value = 500; break;
        default: continue;
      }
      // Prefer close, valuable things: value decays with distance from home.
      const d = Math.sqrt(s.pos.distanceToSquared(this.home));
      const score = value - d * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = s.id;
      }
    }
    if (best >= 0) return best;
    // No strategic target left: take the nearest enemy hull to our fleet.
    return world.nearestEnemy(
      this.home.x, this.home.y, this.home.z, this.team, CONFIG.mapRadius * 2,
    );
  }

  // -- defence -------------------------------------------------------------

  /**
   * Raise an alert if anything hostile is loitering near the mothership or the
   * mining fleet. The alert is deliberately delayed by `tune.reaction` so lower
   * difficulties can actually be raided.
   */
  private checkDefence(world: World): void {
    if (this.alertT >= 0) return;

    const msId = world.motherships[this.team];
    const ms = msId >= 0 ? world.ship(msId) : undefined;
    if (ms) {
      const e = world.nearestEnemy(ms.pos.x, ms.pos.y, ms.pos.z, this.team, DEFEND_HOME_RADIUS);
      if (e >= 0) {
        const s = world.ship(e);
        if (s) {
          this.alertPos.copy(s.pos);
          this.alertT = this.tune.reaction;
          return;
        }
      }
    }

    for (let i = 0; i < _collectors.length; i++) {
      const c = world.ship(_collectors[i]);
      if (!c) continue;
      const e = world.nearestEnemy(c.pos.x, c.pos.y, c.pos.z, this.team, DEFEND_MINE_RADIUS);
      if (e < 0) continue;
      const s = world.ship(e);
      if (!s) continue;
      this.alertPos.copy(s.pos);
      this.alertT = this.tune.reaction;
      return;
    }
  }

  /** Recall the closest wave onto the threat that raised the alert. */
  private respondToAlert(world: World): void {
    _threat.copy(this.alertPos);
    // Confirm the threat is still there — do not recall a fleet at a ghost.
    const still = world.nearestEnemy(
      _threat.x, _threat.y, _threat.z, this.team, DEFEND_MINE_RADIUS,
    );
    if (still < 0) return;
    const s = world.ship(still);
    if (s) _threat.copy(s.pos);

    let bestW = -1;
    let bestD = Infinity;
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (!wave.alive || wave.members.length === 0) continue;
      const d = wave.centre.distanceToSquared(_threat);
      // Prefer the forming (home) wave: it is already the reserve.
      const bias = wave.state === 'forming' ? 0.4 : 1.0;
      if (d * bias < bestD) {
        bestD = d * bias;
        bestW = w;
      }
    }
    if (bestW < 0) {
      // No wave at all — the mothership's own batteries are the last line, but
      // pull any collectors in the blast area out of the way.
      this.evacuateMiners(world, _threat);
      return;
    }

    const wave = this.waves[bestW];
    wave.state = 'defending';
    wave.target = still;
    wave.goal.copy(_threat);
    wave.reissue = REISSUE_PERIOD;
    if (this.forming === bestW) this.forming = -1;
    this.issueMoveWave(world, wave, _threat, true);
  }

  /** Send collectors near `at` home; a dead collector is a dead economy. */
  private evacuateMiners(world: World, at: Vector3): void {
    _issue.length = 0;
    for (let i = 0; i < _collectors.length; i++) {
      const c = world.ship(_collectors[i]);
      if (!c) continue;
      if (c.pos.distanceToSquared(at) > DEFEND_MINE_RADIUS * DEFEND_MINE_RADIUS) continue;
      _issue.push(c.id);
    }
    if (_issue.length === 0) return;
    const msId = world.motherships[this.team];
    if (msId >= 0) {
      orderGuard(world, _issue, msId, false);
    } else {
      this.behindHome(_goal, 1400);
      orderMove(world, _issue, _goal.x, _goal.y, _goal.z, false);
    }
  }

  // -- geometry helpers ----------------------------------------------------

  /**
   * The forming wave stages a short way toward the enemy: far enough forward
   * that a commit is not a full-map transit, close enough that a home defence
   * recall arrives before the mining fleet is gone.
   */
  private stagingPoint(out: Vector3): void {
    if (!this.foeHomeKnown) {
      // No intel yet — stage between home and the map centre.
      out.copy(this.home).multiplyScalar(1 - STAGE_FRACTION);
      return;
    }
    _dir.copy(this.foeHome).sub(this.home);
    const len = _dir.length();
    if (len < 1e-3) {
      out.copy(this.home);
      return;
    }
    _dir.multiplyScalar(1 / len);
    out.copy(this.home).addScaledVector(_dir, len * STAGE_FRACTION);
    // Lift the staging plane slightly so the reserve is not inside the
    // mothership's silhouette from the player's usual camera angle.
    out.y += CONFIG.mapHeight * 0.04;
  }

  /** A point `dist` metres behind home, on the axis away from the enemy. */
  private behindHome(out: Vector3, dist: number): void {
    if (this.foeHomeKnown) {
      _dir.copy(this.home).sub(this.foeHome);
      if (_dir.lengthSq() > 1e-6) _dir.normalize();
      else _dir.set(0, 0, 1);
    } else {
      _dir.set(0, 0, 1);
    }
    out.copy(this.home).addScaledVector(_dir, dist);
  }
}
