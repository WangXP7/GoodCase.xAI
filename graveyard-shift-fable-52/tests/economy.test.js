import { describe, it, expect } from 'vitest';
import { createEconomy, pointsForHit } from '../src/game/economy.js';
import { createInteract } from '../src/game/interact.js';

function econ(start) {
  const log = [];
  const e = createEconomy({ start, emit: (name, p) => log.push([name, p]) });
  return { e, log };
}

describe('economy', () => {
  it('starts at 500 by default', () => {
    expect(createEconomy().points).toBe(500);
  });

  it('points per hit: 10 hit, 60 kill, 100 headshot kill', () => {
    expect(pointsForHit({ killed: false, part: 'torso' })).toBe(10);
    expect(pointsForHit({ killed: false, part: 'head' })).toBe(10);
    expect(pointsForHit({ killed: true, part: 'torso' })).toBe(60);
    expect(pointsForHit({ killed: true, part: 'head' })).toBe(100);
  });

  it('add() credits and emits points:add', () => {
    const { e, log } = econ(0);
    e.add(60, 'kill');
    expect(e.points).toBe(60);
    expect(e.earned).toBe(60);
    expect(log).toEqual([['points:add', { amount: 60, reason: 'kill' }]]);
  });

  it('spend(250) at 240 points returns false and changes nothing', () => {
    const { e, log } = econ(240);
    expect(e.canAfford(250)).toBe(false);
    expect(e.spend(250, 'wallAmmo')).toBe(false);
    expect(e.points).toBe(240);
    expect(log).toEqual([]);
  });

  it('spend() at enough points debits and emits buy', () => {
    const { e, log } = econ(250);
    expect(e.canAfford(250)).toBe(true);
    expect(e.spend(250, 'wallAmmo')).toBe(true);
    expect(e.points).toBe(0);
    expect(log).toEqual([['buy', { item: 'wallAmmo', cost: 250 }]]);
  });

  it('ignores nonsense amounts', () => {
    const { e, log } = econ(100);
    e.add(-5, 'x'); e.add(NaN, 'x');
    expect(e.spend(-10, 'x')).toBe(false);
    expect(e.points).toBe(100);
    expect(log).toEqual([]);
  });

  it('a melee kill pays 130; under One-Tap every kill pays the plain 60', () => {
    expect(pointsForHit({ killed: true, part: 'torso', source: 'melee' })).toBe(130);
    expect(pointsForHit({ killed: true, part: 'head', headshot: true, source: 'melee' })).toBe(130);
    expect(pointsForHit({ killed: true, part: 'head', headshot: true }, { oneTap: true })).toBe(60);
    expect(pointsForHit({ killed: true, source: 'melee' }, { oneTap: true })).toBe(60);
    expect(pointsForHit({ killed: false, source: 'melee' })).toBe(10);
  });

  it('spend() records what was spent and names the interactable in buy', () => {
    const { e, log } = econ(2000);
    expect(e.spend(750, 'door', 'door-d1')).toBe(true);
    expect(e.spent).toBe(750);
    expect(log).toEqual([['buy', { item: 'door', cost: 750, id: 'door-d1' }]]);
    e.reset();
    expect(e.spent).toBe(0);
  });

  it('reset(start) sets a new start balance', () => {
    const { e } = econ(500);
    e.reset(7000);
    expect(e.points).toBe(7000);
    e.reset();
    expect(e.points).toBe(7000);
  });

  it('reset() restores the start balance', () => {
    const { e } = econ(500);
    e.add(100, 'hit'); e.reset();
    expect(e.points).toBe(500);
    expect(e.earned).toBe(0);
  });
});

function setup({ points = 500, reserve = 48 } = {}) {
  const { e, log } = econ(points);
  const weapon = { ammo: { mag: 12, reserve }, addReserve(n) { this.ammo.reserve += n; } };
  const items = [
    { id: 'ammo-1', kind: 'wallAmmo', pos: [10, 1.2, 0], radius: 1.5, cost: 250, label: 'Ammo' },
    { id: 'door-1', kind: 'lockedDoor', pos: [0, 1, 10], radius: 2, cost: 750, label: 'Door' },
  ];
  const denied = [];
  const it = createInteract({
    interactables: () => items, economy: e, weapon: () => weapon, emit: (name, p) => denied.push([name, p]),
  });
  return { e, log, weapon, it, items, denied };
}

describe('interact', () => {
  it('nearest returns the closest interactable within its radius, else null', () => {
    const { it, items } = setup();
    expect(it.nearest([0, 0, 0])).toBe(null);
    expect(it.nearest([9, 0, 0])).toBe(items[0]);
    expect(it.nearest({ x: 0, y: 0, z: 8.5 })).toBe(items[1]);
    expect(it.nearest([10, 0, 1.6])).toBe(null);
  });

  it('nearest picks the closer of two in range', () => {
    const items = [
      { id: 'a', kind: 'wallAmmo', pos: [0, 0, 0], radius: 3 },
      { id: 'b', kind: 'wallAmmo', pos: [2, 0, 0], radius: 3 },
    ];
    const it = createInteract({ interactables: () => items, economy: createEconomy(), weapon: () => null });
    expect(it.nearest([1.5, 0, 0]).id).toBe('b');
    expect(it.nearest([0.5, 0, 0]).id).toBe('a');
  });

  it('wall ammo fills reserve to max for 250', () => {
    const { it, e, weapon, log } = setup({ points: 500, reserve: 10 });
    expect(it.use('ammo-1')).toEqual({ ok: true, reason: null });
    expect(weapon.ammo.reserve).toBe(96);
    expect(e.points).toBe(250);
    expect(log).toContainEqual(['buy', { item: 'wallAmmo', cost: 250, id: 'ammo-1' }]);
  });

  it('ammo buy at full reserve is refused and costs nothing', () => {
    const { it, e, weapon, log } = setup({ points: 500, reserve: 96 });
    expect(it.use('ammo-1')).toEqual({ ok: false, reason: 'full' });
    expect(weapon.ammo.reserve).toBe(96);
    expect(e.points).toBe(500);
    expect(log).toEqual([]);
  });

  it('ammo buy without enough points is refused and changes nothing', () => {
    const { it, e, weapon } = setup({ points: 240, reserve: 0 });
    expect(it.use('ammo-1')).toEqual({ ok: false, reason: 'points' });
    expect(weapon.ammo.reserve).toBe(0);
    expect(e.points).toBe(240);
  });

  it('locked door always refuses with reason locked', () => {
    const { it, e } = setup({ points: 5000 });
    expect(it.use('door-1')).toEqual({ ok: false, reason: 'locked' });
    expect(e.points).toBe(5000);
  });

  it('every refusal emits buy:denied {item: kind, reason}; success emits nothing', () => {
    const full = setup({ points: 500, reserve: 96 });
    full.it.use('ammo-1');
    expect(full.denied).toEqual([['buy:denied', { item: 'wallAmmo', reason: 'full' }]]);
    const poor = setup({ points: 100, reserve: 0 });
    poor.it.use('ammo-1');
    expect(poor.denied).toEqual([['buy:denied', { item: 'wallAmmo', reason: 'points' }]]);
    const door = setup();
    door.it.use('door-1');
    expect(door.denied).toEqual([['buy:denied', { item: 'lockedDoor', reason: 'locked' }]]);
    const ok = setup({ points: 500, reserve: 0 });
    ok.it.use('ammo-1');
    expect(ok.denied).toEqual([]);
  });

  it('unknown id, or no weapon yet, is refused without throwing', () => {
    const { it } = setup();
    expect(it.use('nope')).toEqual({ ok: false, reason: 'none' });
    const items = [{ id: 'a', kind: 'wallAmmo', pos: [0, 0, 0], radius: 1, cost: 250 }];
    const e = createEconomy();
    const noWeapon = createInteract({ interactables: () => items, economy: e, weapon: () => ({ stub: true }) });
    expect(noWeapon.use('a')).toEqual({ ok: false, reason: 'unavailable' });
    expect(e.points).toBe(500);
  });
});
