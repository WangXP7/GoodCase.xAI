import { describe, it, expect, vi } from 'vitest';
import { tuning } from '../src/game/tuning.js';

describe('tuning aggregator', () => {
  it('keeps the original keys alive with every section file a placeholder', () => {
    expect(tuning.pistol.mag).toBe(12);
    expect(tuning.walker.health(9)).toBe(950);
    expect(tuning.round.total(5)).toBe(26);
    expect(tuning.points.kill).toBe(60);
    expect(tuning.wallAmmo.cost).toBe(250);
    expect(tuning.player.eye).toBe(1.7);
  });
  it('has a section per module', () => {
    for (const k of ['touch', 'weapons', 'world', 'economy', 'loot', 'zombies']) expect(typeof tuning[k]).toBe('object');
  });
  it('a module section that defines a key overrides the core fallback', async () => {
    vi.resetModules();
    vi.doMock('../src/game/tuning/weapons.js', () => ({ weapons: { pistol: { mag: 99 } } }));
    const { tuning: t } = await import('../src/game/tuning.js');
    expect(t.pistol.mag).toBe(99);
    expect(t.walker.health(9)).toBe(950); // untouched aliases still fall back
    vi.doUnmock('../src/game/tuning/weapons.js');
    vi.resetModules();
  });
});
