// The serialisable game state and the transient brew state. Pure data + tiny helpers.
import { POTION_ORDER, BREW } from './data.js';

export const SAVE_VERSION = 1;

export function createState() {
  return {
    v: SAVE_VERSION,
    // 'title' | 'play' | 'brew' | 'book' | 'pause' | 'cutscene' | 'photo' | 'dead'
    mode: 'title',
    time: { day: 1, hour: 8.25 },
    player: { hp: 100, hpMax: 100, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, levity: 0, regen: 0 },
    inv: {
      ingredients: {}, // id -> count
      potions: {}, // id -> count
      selected: null, // potion id in hand
      primes: { salt: false, mercury: false, sulfur: false },
      stone: false,
    },
    known: {
      ingredients: {}, // seen at least once
      potions: {}, // brewed at least once
      charted: {}, // region inked on the chart (by lore or by brewing)
      lore: {}, // pages read
      lanterns: {}, // lanterns of the dead that have been lit
      regions: {},
    },
    quest: { stage: 'arrive', gathered: 0 },
    world: {
      gloom: { saltwood: 1, mere: 1, scar: 1 }, // 1 = under the Gloom, 0 = lifted
      flags: {}, // one-off world changes, e.g. 'bramble:gate': true
      picked: {}, // plant id -> game-seconds when it regrows
      athanor: 0, // 0 cold, 1 pilot flame, 2 relit by the Stone
      clock: 0, // total game seconds
    },
    stats: { seconds: 0, brewed: 0, thrown: 0, deaths: 0, picked: 0 },
  };
}

/** Transient state of the cauldron. Not saved: the pot is emptied when you walk away. */
export function createBrew() {
  return {
    active: false,
    contents: [], // ingredient ids, or 'prime:salt' | 'prime:mercury' | 'prime:sulfur'
    mix: null, // [s, m, k] or null when empty
    trail: [], // earlier mix points, oldest first
    fire: 0.0, // 0..1 how hard the fire burns (bellows)
    heat: 0.0, // 0..1 temperature of the liquid (lags the fire)
    region: null, // { id, dist, quality, stars } when the mix sits inside a potion region
    band: null, // [lo, hi] heat band of that region (or of the current Opus stage)
    fit: null, // -1 too cold, 0 right, +1 too hot, null when no region
    stir: 0, // 0..1 smoothed stirring speed
    progress: 0, // 0..1 binding progress
    ready: null, // { potion, stars, count } once bound and waiting to be bottled
    opus: null, // { stage: 0..3, progress: 0..1, done: false } during the Great Work
    hint: '', // one short line for the UI
  };
}

export const count = (bag, id) => bag[id] || 0;
export function add(bag, id, n = 1, max = Infinity) {
  const v = Math.max(0, Math.min(max, (bag[id] || 0) + n));
  if (v === 0) delete bag[id];
  else bag[id] = v;
  return v;
}
export function hasAllPrimes(state) {
  const p = state.inv.primes;
  return p.salt && p.mercury && p.sulfur;
}
export function primeCount(state) {
  const p = state.inv.primes;
  return (p.salt ? 1 : 0) + (p.mercury ? 1 : 0) + (p.sulfur ? 1 : 0);
}
/** Potions the player currently carries, in belt order. */
export function beltOf(state) {
  return POTION_ORDER.filter((id) => (state.inv.potions[id] || 0) > 0);
}
export function canCarryMore(state, potionId) {
  return (state.inv.potions[potionId] || 0) < BREW.maxCarry;
}
