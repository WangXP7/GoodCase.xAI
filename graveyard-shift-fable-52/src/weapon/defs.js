// The weapon table as Defs, slots, and the stats of a slot with its upgrade and attachments. Pure.
// Numbers live in src/game/tuning/weapons.js; this file only composes them.
import { tuning } from '../game/tuning.js';
import { applyAttachments } from './attachments.js';

export const WEAPONS = tuning.weapons.table;
export const WEAPON_IDS = tuning.weapons.ids;
export const isWeapon = (id) => Object.prototype.hasOwnProperty.call(WEAPONS, id);

// The Def of a slot: the table entry, the upgrade (one tier) and then the attachments. A new object
// every call: callers cache it and ask again only when the slot changes.
export function statsFor(slot) {
  const base = WEAPONS[slot.id];
  const up = slot.upgraded ? base.upgraded : null;
  const d = up
    ? {
      ...base, name: up.name, damage: up.damage, mag: up.mag, reserve: up.reserve, maxReserve: up.maxReserve, tracer: up.tracer, finish: up.finish,
      penetration: up.penetration, pierce: up.penetration.bodies, upgraded: true,
    }
    : { ...base, upgraded: false };
  return applyAttachments(d, slot.attachments);
}

// A slot is the weapon in a hand and also its fire-control state (firing.js `step` runs on it).
// Slot = { id, mag, reserve, upgraded, attachments:Set } plus the state fields below.
export function createSlot(id) {
  const d = WEAPONS[id];
  return {
    id, mag: d.mag, reserve: d.reserve, upgraded: false, attachments: new Set(),
    cooldown: 0, reloading: false, reloadT: 0, granted: false, bloom: 0, buffered: false, shellT: 0,
    lowSent: false, emptySent: false,
  };
}
