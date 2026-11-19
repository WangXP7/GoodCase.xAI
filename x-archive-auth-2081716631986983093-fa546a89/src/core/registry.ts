/**
 * The ship data table — the single source of truth for every hull in the game.
 *
 * LOCAL SPACE CONVENTION (all geometry builders and mount points obey this):
 *   +Z = forward (nose)      -Z = aft (engines exit here)
 *   +Y = up (dorsal)         -Y = down (ventral)
 *   +X = starboard           -X = port
 * The instance basis is the right-handed matrix [right, up, forward] with
 * right = up x forward, so an untransformed hull faces +Z.
 *
 * Geometry builders MUST produce a hull whose bounding box spans roughly
 * `-length/2 .. +length/2` on Z and whose bounding sphere is <= `radius`.
 */

import {
  FlightModel,
  HullSize,
  ShipClass,
  type ResearchSpec,
  type ShipSpec,
  type WeaponSpec,
} from './types';

const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------
// Weapon prototypes
// ---------------------------------------------------------------------------

const W = {
  scoutPulse: {
    kind: 'pulse', damage: 5, rate: 4, range: 620, speed: 1500, burst: 3, burstGap: 0.55,
    vs: { [HullSize.Fighter]: 1.1, [HullSize.Capital]: 0.25, [HullSize.SuperCapital]: 0.15 },
  },
  interceptorPulse: {
    kind: 'pulse', damage: 9, rate: 6.5, range: 780, speed: 1700, burst: 4, burstGap: 0.5,
    vs: { [HullSize.Fighter]: 1.35, [HullSize.Corvette]: 0.9, [HullSize.Frigate]: 0.4, [HullSize.Capital]: 0.22, [HullSize.SuperCapital]: 0.14 },
  },
  bomberTorpedo: {
    kind: 'torpedo', damage: 210, rate: 0.28, range: 1150, speed: 340, turn: 1.0, splash: 55,
    vs: { [HullSize.Fighter]: 0.25, [HullSize.Corvette]: 0.55, [HullSize.Frigate]: 1.35, [HullSize.Capital]: 1.5, [HullSize.SuperCapital]: 1.6 },
  },
  corvetteMassDriver: {
    kind: 'massdriver', damage: 22, rate: 2.6, range: 1000, speed: 1250, burst: 2, burstGap: 0.6,
    traverse: { yaw: 55 * D2R, pitch: 32 * D2R, speed: 2.6 },
    vs: { [HullSize.Fighter]: 0.75, [HullSize.Corvette]: 1.25, [HullSize.Frigate]: 0.85, [HullSize.Capital]: 0.5, [HullSize.SuperCapital]: 0.4 },
  },
  corvetteMissile: {
    kind: 'missile', damage: 34, rate: 1.1, range: 1500, speed: 620, turn: 2.4, splash: 22, burst: 4, burstGap: 3.2,
    vs: { [HullSize.Fighter]: 0.45, [HullSize.Corvette]: 1.0, [HullSize.Frigate]: 1.2, [HullSize.Capital]: 0.95, [HullSize.SuperCapital]: 0.8 },
  },
  ionBeam: {
    kind: 'ion', damage: 175, rate: 0.34, range: 2600, speed: 0, beamDwell: 1.6,
    traverse: { yaw: 22 * D2R, pitch: 14 * D2R, speed: 0.7 },
    vs: { [HullSize.Fighter]: 0.15, [HullSize.Corvette]: 0.5, [HullSize.Frigate]: 1.3, [HullSize.Capital]: 1.35, [HullSize.SuperCapital]: 1.3 },
  },
  frigateFlak: {
    kind: 'flak', damage: 26, rate: 1.5, range: 1250, speed: 900, splash: 95,
    traverse: { yaw: 180 * D2R, pitch: 70 * D2R, speed: 3.4 },
    vs: { [HullSize.Fighter]: 2.0, [HullSize.Corvette]: 1.1, [HullSize.Frigate]: 0.35, [HullSize.Capital]: 0.2, [HullSize.SuperCapital]: 0.15 },
  },
  frigateMassDriver: {
    kind: 'massdriver', damage: 48, rate: 1.15, range: 1900, speed: 1500,
    traverse: { yaw: 120 * D2R, pitch: 40 * D2R, speed: 1.4 },
    vs: { [HullSize.Fighter]: 0.3, [HullSize.Corvette]: 0.9, [HullSize.Frigate]: 1.15, [HullSize.Capital]: 1.0, [HullSize.SuperCapital]: 0.9 },
  },
  capitalPlasma: {
    kind: 'plasma', damage: 165, rate: 0.55, range: 3100, speed: 780, splash: 120,
    traverse: { yaw: 150 * D2R, pitch: 45 * D2R, speed: 1.1 },
    vs: { [HullSize.Fighter]: 0.2, [HullSize.Corvette]: 0.6, [HullSize.Frigate]: 1.2, [HullSize.Capital]: 1.25, [HullSize.SuperCapital]: 1.2 },
  },
  capitalPoint: {
    kind: 'flak', damage: 18, rate: 3.0, range: 1100, speed: 1100, splash: 60,
    traverse: { yaw: 180 * D2R, pitch: 80 * D2R, speed: 4.2 },
    vs: { [HullSize.Fighter]: 2.2, [HullSize.Corvette]: 1.0, [HullSize.Frigate]: 0.25, [HullSize.Capital]: 0.12, [HullSize.SuperCapital]: 0.1 },
  },
  cruiserSpinal: {
    kind: 'ion', damage: 420, rate: 0.16, range: 4200, speed: 0, beamDwell: 2.6,
    traverse: { yaw: 14 * D2R, pitch: 9 * D2R, speed: 0.35 },
    vs: { [HullSize.Fighter]: 0.05, [HullSize.Corvette]: 0.3, [HullSize.Frigate]: 1.25, [HullSize.Capital]: 1.45, [HullSize.SuperCapital]: 1.5 },
  },
  mothershipBattery: {
    kind: 'plasma', damage: 240, rate: 0.4, range: 4000, speed: 820, splash: 160,
    traverse: { yaw: 170 * D2R, pitch: 60 * D2R, speed: 0.9 },
    vs: { [HullSize.Fighter]: 0.15, [HullSize.Corvette]: 0.55, [HullSize.Frigate]: 1.2, [HullSize.Capital]: 1.3, [HullSize.SuperCapital]: 1.25 },
  },
} satisfies Record<string, WeaponSpec>;

// ---------------------------------------------------------------------------
// Mount helpers — keep the table readable.
// ---------------------------------------------------------------------------

const hp = (
  x: number, y: number, z: number, weapon = 0, size = 0,
  dir: [number, number, number] = [0, 0, 1],
) => ({ pos: [x, y, z] as [number, number, number], dir, weapon, size });

const eng = (x: number, y: number, z: number, radius: number) => ({
  pos: [x, y, z] as [number, number, number],
  radius,
  dir: [0, 0, -1] as [number, number, number],
});

/** Mirror a list of mounts across the YZ plane (port <-> starboard). */
function mirrorX<T extends { pos: [number, number, number]; dir?: [number, number, number] }>(
  mounts: T[],
): T[] {
  const out: T[] = [];
  for (const m of mounts) {
    out.push(m);
    if (Math.abs(m.pos[0]) < 1e-4) continue;
    out.push({
      ...m,
      pos: [-m.pos[0], m.pos[1], m.pos[2]],
      dir: m.dir ? [-m.dir[0], m.dir[1], m.dir[2]] : undefined,
    } as T);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const SHIP_SPECS: Record<ShipClass, ShipSpec> = {
  [ShipClass.Scout]: {
    cls: ShipClass.Scout, name: 'Probe Scout', tag: 'SCT',
    size: HullSize.Fighter, flight: FlightModel.Agile,
    radius: 11, length: 19,
    maxHp: 90, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 0,
    speed: 340, accel: 260, turnRate: 2.9, bankMax: 1.15,
    weapons: [W.scoutPulse],
    hardpoints: mirrorX([hp(1.6, -0.2, 7.5, 0)]),
    engines: mirrorX([eng(2.1, 0.1, -8.2, 0.85)]),
    cost: 70, buildTime: 9, supply: 1, builds: [], hangar: 0,
    sensor: 9000, tier: 0,
  },

  [ShipClass.Interceptor]: {
    cls: ShipClass.Interceptor, name: 'Talon Interceptor', tag: 'INT',
    size: HullSize.Fighter, flight: FlightModel.Agile,
    radius: 13, length: 23,
    maxHp: 150, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 1,
    speed: 300, accel: 220, turnRate: 2.6, bankMax: 1.3,
    weapons: [W.interceptorPulse],
    hardpoints: mirrorX([hp(2.4, -0.35, 8.4, 0)]),
    engines: mirrorX([eng(2.6, 0.15, -9.6, 1.05)]),
    cost: 110, buildTime: 12, supply: 1, builds: [], hangar: 0,
    sensor: 4200, tier: 0,
  },

  [ShipClass.Bomber]: {
    cls: ShipClass.Bomber, name: 'Lance Bomber', tag: 'BMB',
    size: HullSize.Fighter, flight: FlightModel.Agile,
    radius: 15, length: 27,
    maxHp: 210, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 2,
    speed: 235, accel: 155, turnRate: 1.8, bankMax: 1.0,
    weapons: [W.bomberTorpedo],
    hardpoints: mirrorX([hp(3.2, -1.4, 5.0, 0, 0.9)]),
    engines: mirrorX([eng(3.0, 0.2, -11.0, 1.25)]),
    cost: 190, buildTime: 18, supply: 2, builds: [], hangar: 0,
    sensor: 3800, tier: 1,
  },

  [ShipClass.AssaultCorvette]: {
    cls: ShipClass.AssaultCorvette, name: 'Hammer Corvette', tag: 'ACV',
    size: HullSize.Corvette, flight: FlightModel.Brawler,
    radius: 25, length: 44,
    maxHp: 560, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 4,
    speed: 210, accel: 120, turnRate: 1.35, bankMax: 0.7,
    weapons: [W.corvetteMassDriver],
    hardpoints: mirrorX([hp(4.6, 2.2, 9.0, 0, 1.6), hp(3.9, -2.4, 2.0, 0, 1.6)]),
    engines: mirrorX([eng(4.4, 0.4, -18.0, 1.9)]),
    cost: 320, buildTime: 24, supply: 3, builds: [], hangar: 0,
    sensor: 3600, tier: 1,
  },

  [ShipClass.MissileCorvette]: {
    cls: ShipClass.MissileCorvette, name: 'Quiver Corvette', tag: 'MCV',
    size: HullSize.Corvette, flight: FlightModel.Brawler,
    radius: 27, length: 47,
    maxHp: 490, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 3,
    speed: 200, accel: 115, turnRate: 1.25, bankMax: 0.65,
    weapons: [W.corvetteMissile],
    hardpoints: mirrorX([hp(5.2, 3.0, 1.0, 0, 1.2), hp(5.2, 3.0, -4.0, 0, 1.2)]),
    engines: mirrorX([eng(4.8, 0.3, -19.5, 2.0)]),
    cost: 380, buildTime: 27, supply: 3, builds: [], hangar: 0,
    sensor: 4400, tier: 2,
  },

  [ShipClass.IonFrigate]: {
    cls: ShipClass.IonFrigate, name: 'Lumen Ion Frigate', tag: 'ION',
    size: HullSize.Frigate, flight: FlightModel.Capital,
    radius: 58, length: 108,
    maxHp: 2400, maxShield: 600, shieldRegen: 24, shieldDelay: 7, armour: 9,
    speed: 128, accel: 46, turnRate: 0.5, bankMax: 0.12,
    weapons: [W.ionBeam, W.capitalPoint],
    hardpoints: [hp(0, 0.5, 44, 0, 4.5), ...mirrorX([hp(6.5, 5.0, -12, 1, 2.0)])],
    engines: mirrorX([eng(7.5, 1.0, -47, 4.2), eng(0, 6.5, -45, 3.0)]),
    cost: 900, buildTime: 48, supply: 8, builds: [], hangar: 0,
    sensor: 5200, tier: 2,
  },

  [ShipClass.AssaultFrigate]: {
    cls: ShipClass.AssaultFrigate, name: 'Bulwark Frigate', tag: 'AFG',
    size: HullSize.Frigate, flight: FlightModel.Capital,
    radius: 55, length: 101,
    maxHp: 3000, maxShield: 450, shieldRegen: 20, shieldDelay: 7, armour: 12,
    speed: 118, accel: 42, turnRate: 0.46, bankMax: 0.1,
    weapons: [W.frigateFlak, W.frigateMassDriver],
    hardpoints: [
      ...mirrorX([hp(8.0, 6.5, 14, 0, 2.6), hp(8.0, 6.5, -8, 0, 2.6)]),
      hp(0, 8.5, 30, 1, 3.4),
      hp(0, -7.5, 6, 1, 3.4),
    ],
    engines: mirrorX([eng(9.0, 0.5, -44, 4.6)]),
    cost: 820, buildTime: 44, supply: 8, builds: [], hangar: 0,
    sensor: 4800, tier: 2,
  },

  [ShipClass.Destroyer]: {
    cls: ShipClass.Destroyer, name: 'Aegis Destroyer', tag: 'DST',
    size: HullSize.Capital, flight: FlightModel.Capital,
    radius: 130, length: 245,
    maxHp: 9500, maxShield: 2200, shieldRegen: 60, shieldDelay: 9, armour: 22,
    speed: 96, accel: 26, turnRate: 0.3, bankMax: 0.06,
    weapons: [W.capitalPlasma, W.capitalPoint, W.frigateMassDriver],
    hardpoints: [
      hp(0, 14, 78, 0, 7.5),
      hp(0, 14, 44, 0, 7.5),
      ...mirrorX([hp(17, 6, -20, 2, 5.0), hp(17, 6, -52, 2, 5.0)]),
      ...mirrorX([hp(13, 16, 10, 1, 3.0), hp(13, -13, -30, 1, 3.0)]),
    ],
    engines: mirrorX([eng(16, 2, -110, 9.0), eng(6, 13, -106, 6.0)]),
    cost: 2400, buildTime: 96, supply: 20, builds: [], hangar: 0,
    sensor: 6200, tier: 3,
  },

  [ShipClass.HeavyCruiser]: {
    cls: ShipClass.HeavyCruiser, name: 'Sovereign Cruiser', tag: 'HVC',
    size: HullSize.Capital, flight: FlightModel.Capital,
    radius: 230, length: 430,
    maxHp: 26000, maxShield: 6000, shieldRegen: 110, shieldDelay: 10, armour: 34,
    speed: 78, accel: 17, turnRate: 0.2, bankMax: 0.04,
    weapons: [W.cruiserSpinal, W.capitalPlasma, W.capitalPoint],
    hardpoints: [
      hp(0, 6, 190, 0, 13),
      ...mirrorX([hp(26, 22, 60, 1, 9.0), hp(26, 22, 4, 1, 9.0), hp(26, -18, -60, 1, 9.0)]),
      ...mirrorX([hp(22, 30, 100, 2, 4.5), hp(22, 30, -30, 2, 4.5), hp(30, -6, -110, 2, 4.5)]),
    ],
    engines: mirrorX([eng(30, 4, -196, 15), eng(11, 26, -190, 10), eng(11, -20, -190, 10)]),
    cost: 5600, buildTime: 165, supply: 40, builds: [], hangar: 0,
    sensor: 7000, tier: 4,
  },

  [ShipClass.ResourceCollector]: {
    cls: ShipClass.ResourceCollector, name: 'Ladle Collector', tag: 'COL',
    size: HullSize.Utility, flight: FlightModel.Utility,
    radius: 31, length: 56,
    maxHp: 700, maxShield: 0, shieldRegen: 0, shieldDelay: 0, armour: 5,
    speed: 165, accel: 80, turnRate: 0.95, bankMax: 0.25,
    weapons: [],
    hardpoints: [],
    engines: mirrorX([eng(6.0, -1.0, -23, 2.6)]),
    cost: 400, buildTime: 30, supply: 2, builds: [], hangar: 0,
    harvest: { rate: 26, capacity: 620 },
    sensor: 3600, tier: 0,
  },

  [ShipClass.ResourceRefinery]: {
    cls: ShipClass.ResourceRefinery, name: 'Crucible Refinery', tag: 'REF',
    size: HullSize.Capital, flight: FlightModel.Utility,
    radius: 108, length: 196,
    maxHp: 6800, maxShield: 900, shieldRegen: 30, shieldDelay: 9, armour: 16,
    speed: 62, accel: 14, turnRate: 0.18, bankMax: 0.03,
    weapons: [W.capitalPoint],
    hardpoints: mirrorX([hp(15, 14, 30, 0, 3.4), hp(15, -12, -40, 0, 3.4)]),
    engines: mirrorX([eng(15, 0, -88, 7.0)]),
    cost: 1500, buildTime: 78, supply: 10, builds: [ShipClass.ResourceCollector], hangar: 4,
    sensor: 4600, tier: 1,
  },

  [ShipClass.Carrier]: {
    cls: ShipClass.Carrier, name: 'Anvil Carrier', tag: 'CAR',
    size: HullSize.SuperCapital, flight: FlightModel.Capital,
    radius: 330, length: 630,
    maxHp: 22000, maxShield: 4200, shieldRegen: 95, shieldDelay: 10, armour: 26,
    speed: 74, accel: 15, turnRate: 0.16, bankMax: 0.03,
    weapons: [W.capitalPoint, W.frigateFlak],
    hardpoints: [
      ...mirrorX([hp(40, 30, 150, 0, 6.0), hp(40, 30, -60, 0, 6.0), hp(40, -26, 40, 0, 6.0)]),
      ...mirrorX([hp(30, 44, 60, 1, 7.0)]),
    ],
    engines: mirrorX([eng(44, 4, -290, 20), eng(16, 34, -282, 13)]),
    cost: 4200, buildTime: 150, supply: 30,
    builds: [
      ShipClass.Scout, ShipClass.Interceptor, ShipClass.Bomber,
      ShipClass.AssaultCorvette, ShipClass.MissileCorvette,
      ShipClass.ResourceCollector,
    ],
    hangar: 24,
    sensor: 8000, tier: 3,
  },

  [ShipClass.Mothership]: {
    cls: ShipClass.Mothership, name: 'Starfall Mothership', tag: 'MSH',
    size: HullSize.SuperCapital, flight: FlightModel.Capital,
    radius: 1060, length: 2100,
    maxHp: 120000, maxShield: 24000, shieldRegen: 320, shieldDelay: 12, armour: 55,
    speed: 42, accel: 6, turnRate: 0.07, bankMax: 0.015,
    weapons: [W.mothershipBattery, W.capitalPoint, W.ionBeam],
    hardpoints: [
      ...mirrorX([hp(130, 105, 480, 0, 26), hp(130, 105, 60, 0, 26), hp(140, -85, -260, 0, 26)]),
      ...mirrorX([hp(100, 150, 260, 1, 14), hp(100, 150, -160, 1, 14), hp(150, -40, 380, 1, 14), hp(150, -40, -420, 1, 14)]),
      ...mirrorX([hp(60, 190, 700, 2, 18)]),
    ],
    engines: mirrorX([eng(150, 10, -960, 62), eng(58, 120, -940, 42), eng(58, -105, -940, 42)]),
    cost: 0, buildTime: 0, supply: 0,
    builds: [
      ShipClass.Scout, ShipClass.Interceptor, ShipClass.Bomber,
      ShipClass.AssaultCorvette, ShipClass.MissileCorvette,
      ShipClass.IonFrigate, ShipClass.AssaultFrigate,
      ShipClass.Destroyer, ShipClass.HeavyCruiser,
      ShipClass.ResourceCollector, ShipClass.ResourceRefinery,
      ShipClass.Carrier,
    ],
    hangar: 40,
    sensor: 14000, tier: 0,
  },
};

export function spec(cls: ShipClass): ShipSpec {
  return SHIP_SPECS[cls];
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export const RESEARCH: ResearchSpec[] = [
  {
    id: 'strikecraft', name: 'Strike Craft Doctrine',
    desc: 'Unlocks bomber wings and assault corvettes.',
    cost: 450, time: 45, requires: [],
    unlocks: [ShipClass.Bomber, ShipClass.AssaultCorvette],
  },
  {
    id: 'refining', name: 'Mobile Refining',
    desc: 'Unlocks the Crucible refinery. Collectors dock closer to the field.',
    cost: 380, time: 40, requires: [],
    unlocks: [ShipClass.ResourceRefinery],
  },
  {
    id: 'capships', name: 'Capital Ship Frames',
    desc: 'Unlocks ion and assault frigates.',
    cost: 900, time: 80, requires: ['strikecraft'],
    unlocks: [ShipClass.IonFrigate, ShipClass.AssaultFrigate],
  },
  {
    id: 'guidance', name: 'Guided Ordnance',
    desc: 'Unlocks missile corvettes. +12% weapon damage fleet-wide.',
    cost: 700, time: 65, requires: ['strikecraft'],
    unlocks: [ShipClass.MissileCorvette], mods: { damage: 1.12 },
  },
  {
    id: 'plating', name: 'Composite Plating',
    desc: '+20% armour on every hull.',
    cost: 850, time: 70, requires: ['capships'],
    unlocks: [], mods: { armour: 1.2 },
  },
  {
    id: 'destroyers', name: 'Destroyer Programme',
    desc: 'Unlocks the Aegis destroyer and Anvil carrier.',
    cost: 1600, time: 120, requires: ['capships'],
    unlocks: [ShipClass.Destroyer, ShipClass.Carrier],
  },
  {
    id: 'shields', name: 'Deflector Lattice',
    desc: '+30% shield capacity fleet-wide.',
    cost: 1400, time: 105, requires: ['capships'],
    unlocks: [], mods: { shield: 1.3 },
  },
  {
    id: 'cruisers', name: 'Sovereign Programme',
    desc: 'Unlocks the Sovereign heavy cruiser.',
    cost: 3000, time: 180, requires: ['destroyers', 'shields'],
    unlocks: [ShipClass.HeavyCruiser],
  },
  {
    id: 'drives', name: 'Ion Drive Tuning',
    desc: '+15% speed on every hull.',
    cost: 750, time: 60, requires: ['refining'],
    unlocks: [], mods: { speed: 1.15 },
  },
];

export const RESEARCH_BY_ID = new Map(RESEARCH.map((r) => [r.id, r]));

/** Ship classes available before any research completes. */
export const STARTING_UNLOCKS: ShipClass[] = [
  ShipClass.Scout,
  ShipClass.Interceptor,
  ShipClass.ResourceCollector,
];
