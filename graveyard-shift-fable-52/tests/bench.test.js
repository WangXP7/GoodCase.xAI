// The upgrade bench: the upgrade is applied inside the purchase itself. Nothing is queued, timed or
// collected afterwards.
import { describe, it, expect } from 'vitest';
import { createBench } from '../src/game/bench.js';
import { tuning } from '../src/game/tuning.js';

function rig({ points = 10000, power = true } = {}) {
  const events = [];
  const slot = { id: 'pump', upgraded: false };
  const weapon = { slots: [slot, null], slot: 0, upgrade() { events.push('weapon.upgrade'); slot.upgraded = true; return true; } };
  const economy = { points, spend(n) { if (this.points < n) return false; this.points -= n; return true; } };
  const bench = createBench({ economy, weapon: () => weapon, level: () => ({ power: { on: power } }), emit: (name, p) => events.push(`${name}:${p.weapon}`) });
  return { bench, weapon, slot, economy, events };
}

describe('upgrade bench', () => {
  it('upgrades the held weapon in the same call that takes the points', () => {
    const r = rig();
    expect(r.bench.use()).toEqual({ ok: true, reason: null });
    expect(r.slot.upgraded).toBe(true);
    expect(r.economy.points).toBe(10000 - tuning.economy.bench.cost);
    expect(r.events).toEqual(['weapon.upgrade', 'bench:upgrade:pump']); // the weapon first, then the announcement
  });
  it('has no state to wait in: a second use is refused as owned straight away', () => {
    const r = rig();
    r.bench.use();
    expect(r.bench.use()).toEqual({ ok: false, reason: 'owned' });
    expect(Object.keys(r.bench).sort()).toEqual(['spot', 'use']);
  });
  it('refuses without power or points and changes nothing', () => {
    const a = rig({ power: false });
    expect(a.bench.use().reason).toBe('power');
    const b = rig({ points: 100 });
    expect(b.bench.use().reason).toBe('points');
    expect(a.slot.upgraded || b.slot.upgraded).toBe(false);
    expect(b.economy.points).toBe(100);
  });
});
