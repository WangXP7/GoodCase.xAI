// What the player carries: two weapon slots, the melee weapon, throwables and mods. Pure: no G, no
// events. firing.js's createWeapon wraps a loadout as G.weapon and emits the events around these.
import { tuning } from '../game/tuning.js';
import { WEAPONS, isWeapon, createSlot, statsFor } from './defs.js';
import { isAttachment } from './attachments.js';

const TW = tuning.weapons.throwables;
export const THROWABLES = TW.kinds;
export const MELEE = Object.keys(tuning.weapons.melee);

// A fresh game: [pistol, null], the knife, no throwables. `give` (the harness param): one id goes
// beside the pistol and is held; two ids replace it. Unknown ids are ignored.
export function createLoadout(give) {
  const ids = [...new Set((Array.isArray(give) ? give : []).filter(isWeapon))].slice(0, 2);
  const slots = ids.length === 2 ? [createSlot(ids[0]), createSlot(ids[1])] : [createSlot('pistol'), ids[0] ? createSlot(ids[0]) : null];
  if (ids.length === 1 && ids[0] === 'pistol') slots[1] = null;
  return {
    slots,
    slot: slots[1] && ids.length === 1 ? 1 : 0,
    melee: 'knife',
    throwables: { frag: 0, molotov: 0, decoy: 0 },
    throwable: 'frag',
    mods: { reloadScale: 1, instantKill: false },
  };
}

export const indexOf = (L, id) => (L.slots[0] && L.slots[0].id === id ? 0 : L.slots[1] && L.slots[1].id === id ? 1 : -1);

// Where `give(id, {slot})` puts a weapon and what it replaces. Returns null for an unknown id.
//  - already held: refilled in place (magazine full, reserve to its max), no duplicate;
//  - opts.slot 0|1: there, replacing whatever is in it;
//  - else the first empty slot, else the held one.
export function give(L, id, opts = {}) {
  if (!isWeapon(id)) return null;
  const have = indexOf(L, id);
  if (have >= 0) {
    const s = L.slots[have];
    const d = statsFor(s);
    s.mag = d.mag; s.reserve = d.maxReserve;
    s.lowSent = false; s.emptySent = false;
    return { slot: have, replaced: null };
  }
  let i = opts.slot === 0 || opts.slot === 1 ? opts.slot : !L.slots[0] ? 0 : !L.slots[1] ? 1 : L.slot;
  const old = L.slots[i];
  L.slots[i] = createSlot(id);
  return { slot: i, replaced: old ? old.id : null };
}

// Adds up to n rounds (n omitted: to the max) to the weapon `id` (omitted: the held one). Returns the
// number added; 0 when that weapon is not carried.
export function addReserve(L, n, id) {
  const i = id === undefined || id === null ? L.slot : indexOf(L, id);
  const s = i >= 0 ? L.slots[i] : null;
  if (!s) return 0;
  const room = Math.max(0, statsFor(s).maxReserve - s.reserve);
  const want = n === undefined || n === null ? room : Math.floor(Number(n) || 0);
  const add = Math.max(0, Math.min(room, want));
  s.reserve += add;
  if (add > 0) { s.emptySent = false; if (s.reserve > statsFor(s).mag) s.lowSent = false; }
  return add;
}

// Fills the reserve of every carried weapon. Returns the total added.
export function fillAll(L) {
  let n = 0;
  for (const s of L.slots) if (s) n += addReserve(L, undefined, s.id);
  return n;
}

// One tier, refused when already upgraded or not carried. An upgrade comes full.
export function upgrade(L, id) {
  const i = id === undefined || id === null ? L.slot : indexOf(L, id);
  const s = i >= 0 ? L.slots[i] : null;
  if (!s || s.upgraded) return false;
  s.upgraded = true;
  const d = statsFor(s);
  s.mag = d.mag; s.reserve = d.reserve;
  s.lowSent = false; s.emptySent = false;
  return true;
}

// One of each kind on the held weapon. The magazine attachment takes effect at the next reload.
export function attach(L, kind) {
  const s = L.slots[L.slot];
  if (!s || !isAttachment(kind) || s.attachments.has(kind)) return false;
  s.attachments.add(kind);
  return true;
}

export function addThrowable(L, kind, n = 1) {
  if (!THROWABLES.includes(kind)) return 0;
  const add = Math.max(0, Math.min(TW[kind].carry - L.throwables[kind], Math.floor(Number(n) || 0)));
  L.throwables[kind] += add;
  return add;
}

// The next kind after the selected one that is in hand (the selected one stays if none is).
export function nextThrowable(L, from = L.throwable) {
  const k = THROWABLES.indexOf(from);
  for (let j = 1; j <= THROWABLES.length; j++) {
    const c = THROWABLES[(k + j) % THROWABLES.length];
    if (L.throwables[c] > 0) return c;
  }
  return from;
}

export const meleeDef = (L) => tuning.weapons.melee[L.melee];
export const weaponName = (id) => (WEAPONS[id] ? WEAPONS[id].name : id);
