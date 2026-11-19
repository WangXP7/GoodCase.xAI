// Points economy. Pure: no DOM, no three.js.
import { tuning } from './tuning.js';

const P = tuning.points;
const MELEE_KILL = tuning.economy.points?.meleeKill ?? P.kill;

// Points for one `hit:zombie` event: a plain hit, or instead a kill, a headshot kill or a melee kill.
// Under One-Tap (`mods.oneTap`) every kill pays the plain kill points. A round that went through
// another zombie first (`pierced`) pays no hit points on this one; a kill pays as usual.
export function pointsForHit({ killed, part, headshot, source, pierced } = {}, mods) {
  if (!killed) return pierced ? 0 : P.hit;
  if (mods && mods.oneTap) return P.kill;
  if (source === 'melee') return MELEE_KILL;
  return part === 'head' || headshot ? P.headshotKill : P.kill;
}

export function createEconomy({ start = P.start, emit = () => {} } = {}) {
  let startPoints = start;
  const e = {
    points: start,
    earned: 0, // total credited this run (death screen)
    spent: 0, // total debited this run

    add(amount, reason) {
      if (!(amount > 0)) return;
      e.points += amount;
      e.earned += amount;
      emit('points:add', { amount, reason });
    },

    canAfford(cost) { return e.points >= cost; },

    // Debits and emits `buy {item, cost, id}` only if affordable; otherwise changes nothing.
    spend(cost, item, id) {
      if (!(cost >= 0) || !e.canAfford(cost)) return false;
      e.points -= cost;
      e.spent += cost;
      emit('buy', { item, cost, id });
      return true;
    },

    // A new run. `start` (optional) becomes the start balance from now on (the points= param).
    reset(s) {
      if (Number.isFinite(s) && s >= 0) startPoints = s;
      e.points = startPoints; e.earned = 0; e.spent = 0;
    },
  };
  return e;
}
