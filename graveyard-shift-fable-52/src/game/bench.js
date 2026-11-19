// The upgrade bench: one tier for the held weapon, 4000 points, needs power. Pure.
//   use() -> {ok, reason}   power | owned (already upgraded) | points | unavailable
// Event: bench:upgrade {weapon}.
import { tuning } from './tuning.js';

export function createBench({ economy, weapon, level = () => null, emit = () => {}, spot = null }) {
  return {
    spot,
    use() {
      const L = level();
      if (!(L && L.power && L.power.on)) return { ok: false, reason: 'power' };
      const w = weapon();
      const s = w && w.slots ? w.slots[w.slot] : null;
      if (!s || typeof w.upgrade !== 'function') return { ok: false, reason: 'unavailable' };
      if (s.upgraded) return { ok: false, reason: 'owned' };
      if (!economy.spend(tuning.economy.bench.cost, 'bench', 'bench')) return { ok: false, reason: 'points' };
      w.upgrade();
      emit('bench:upgrade', { weapon: s.id });
      return { ok: true, reason: null };
    },
  };
}
