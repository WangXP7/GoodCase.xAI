// Purchases at every interactable kind (wall weapons and their ammo, doors, power, the
// bench, the machines, board repairs).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { crateAmmoPrice } from '../src/game/purchases.js';
import { promptString, formatPoints } from '../src/ui/format.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const use = (g, id) => g.game.purchases.use(g.find(id));

describe('wall weapons', () => {
  it('at 999 points the Hollis 12 is refused with points and nothing changes', () => {
    const g = econG({ points: 999 });
    expect(use(g, 'wall-hollis12')).toEqual({ ok: false, reason: 'points' });
    expect(g.game.points).toBe(999);
    expect(g.G.weapon.has('pump')).toBe(false);
    expect(g.events('buy:denied')).toEqual([{ item: 'wallWeapon', reason: 'points' }]);
  });

  it('at 1000 it gives the Hollis 12, emits buy, and the same spot then sells its ammo for 400', () => {
    const g = econG({ points: 1000 });
    expect(use(g, 'wall-hollis12')).toEqual({ ok: true, reason: null });
    expect(g.G.weapon.has('pump')).toBe(true);
    expect(g.G.weapon.id).toBe('pump');
    expect(g.game.points).toBe(0);
    expect(g.events('buy')).toEqual([{ item: 'wallWeapon', cost: 1000, id: 'wall-hollis12' }]);
    const it = g.find('wall-hollis12');
    expect(it.cost).toBe(400);
    expect(it.label).toMatch(/ammo/i);
    // full reserve: refused with `full`
    g.game.economy.points = 5000;
    g.G.weapon.slots[1].reserve = 54;
    expect(use(g, 'wall-hollis12')).toEqual({ ok: false, reason: 'full' });
    expect(g.game.points).toBe(5000);
    // spend some reserve, then buy it back for 400
    g.G.weapon.slots[1].reserve = 3;
    expect(use(g, 'wall-hollis12')).toEqual({ ok: true, reason: null });
    expect(g.game.points).toBe(4600);
    expect(g.G.weapon.slots[1].reserve).toBe(54);
    expect(g.events('buy').at(-1)).toEqual({ item: 'wallAmmo', cost: 400, id: 'wall-hollis12' });
  });

  it('ammo for an upgraded weapon at its wall costs what the crate asks (3x stock: 1200 for the pump) and fills it', () => {
    const g = econG({ points: 1000, params: {} });
    use(g, 'wall-hollis12');
    g.G.weapon.upgrade('pump');
    g.G.weapon.slots[1].reserve = 0;
    g.game.economy.points = 1199;
    expect(g.find('wall-hollis12').cost).toBe(1200);
    expect(g.find('wall-hollis12').cost).toBe(crateAmmoPrice('pump', true));
    expect(g.find('wall-hollis12').label).toMatch(/ammo/i);
    expect(use(g, 'wall-hollis12')).toEqual({ ok: false, reason: 'points' });
    g.game.economy.points = 1200;
    expect(use(g, 'wall-hollis12').ok).toBe(true);
    expect(g.game.points).toBe(0);
    expect(g.G.weapon.slots[1].reserve).toBe(g.G.weapon.statsFor(g.G.weapon.slots[1]).maxReserve);
  });

  it("the store's ammo is the pistol's, at 250, up to the pistol's max", () => {
    const g = econG({ points: 300 });
    g.G.weapon.slots[0].reserve = 10;
    expect(use(g, 'ammo-store')).toEqual({ ok: true, reason: null });
    expect(g.G.weapon.slots[0].reserve).toBe(96);
    expect(g.game.points).toBe(50);
    expect(use(g, 'ammo-store')).toEqual({ ok: false, reason: 'full' });
  });
});

describe('upgraded ammo costs the same at a wall and at the crate', () => {
  for (const [wall, id] of [['wall-hollis12', 'pump'], ['wall-pike45', 'smg'], ['wall-calder556', 'rifle'], ['wall-brandt12', 'autoShotgun']]) {
    it(`${id}: wall price == crate price, stock and upgraded; the wall prompt quotes it`, () => {
      const g = econG({ points: 20000, params: { give: [id] } });
      const w = g.find(wall);
      if (!w) return; // (a wall this layout does not place)
      const crate = g.find('ammo-store');
      g.G.player.pos = [crate.pos[0] - 0.8, 0, crate.pos[2]];
      g.step();
      expect(w.cost).toBe(g.game.focus.cost);
      g.G.weapon.upgrade(id);
      g.step();
      expect(w.cost).toBe(crateAmmoPrice(id, true));
      expect(w.cost).toBe(g.game.focus.cost);
      expect(w.cost).toBeLessThanOrEqual(3000);
      expect(promptString(w).endsWith(`ammo · ${formatPoints(w.cost)}`)).toBe(true);
    });
  }
});

describe('doors and power', () => {
  it('a door at its cost opens once and is owned after', () => {
    const g = econG({ points: 750 });
    expect(use(g, 'door-d1')).toEqual({ ok: true, reason: null });
    expect(g.G.level.doors[0].open).toBe(true);
    expect(g.game.points).toBe(0);
    expect(g.events('buy')).toEqual([{ item: 'door', cost: 750, id: 'door-d1' }]);
    g.game.economy.points = 5000;
    expect(use(g, 'door-d1')).toEqual({ ok: false, reason: 'owned' });
    expect(g.game.points).toBe(5000);
    expect(g.count('door:open')).toBe(1);
  });

  it('a door short of its cost is refused with points', () => {
    const g = econG({ points: 749 });
    expect(use(g, 'door-d1')).toEqual({ ok: false, reason: 'points' });
    expect(g.G.level.doors[0].open).toBe(false);
  });

  it('the power switch is free, turns the power on once, and G.game.power mirrors it', () => {
    const g = econG();
    expect(g.game.power.on).toBe(false);
    expect(use(g, 'power')).toEqual({ ok: true, reason: null });
    expect(g.game.power.on).toBe(true);
    expect(use(g, 'power')).toEqual({ ok: false, reason: 'owned' });
    expect(g.count('power:on')).toBe(1);
  });
});

describe('bench and machines', () => {
  it('the bench and each machine are refused with power until power:on', () => {
    const g = econG({ points: 50000 });
    expect(use(g, 'bench')).toEqual({ ok: false, reason: 'power' });
    for (const k of ['jumpStart', 'secondHelping', 'shortOrder', 'longHaul']) expect(use(g, `machine-${k}`)).toEqual({ ok: false, reason: 'power' });
    expect(g.game.points).toBe(50000);
    g.G.level.setPower(true);
    expect(use(g, 'bench')).toEqual({ ok: true, reason: null });
    expect(g.events('bench:upgrade')).toEqual([{ weapon: 'pistol' }]);
    for (const k of ['jumpStart', 'secondHelping', 'shortOrder', 'longHaul']) expect(use(g, `machine-${k}`).ok).toBe(true);
  });

  it('the bench costs 4000 and is refused with owned for an upgraded weapon', () => {
    const g = econG({ points: 9000 });
    g.G.level.setPower(true);
    expect(use(g, 'bench').ok).toBe(true);
    expect(g.game.points).toBe(5000);
    expect(g.G.weapon.slots[0].upgraded).toBe(true);
    expect(use(g, 'bench')).toEqual({ ok: false, reason: 'owned' });
    expect(g.game.points).toBe(5000);
  });

  it('machine effects: max health 175, reload x0.6, speed x1.12', () => {
    const g = econG({ points: 50000 });
    g.G.level.setPower(true);
    use(g, 'machine-secondHelping'); use(g, 'machine-shortOrder'); use(g, 'machine-longHaul');
    expect(g.G.player.maxHealth).toBe(175);
    expect(g.G.weapon.mods.reloadScale).toBe(0.6);
    expect(g.G.player.speedScale).toBeCloseTo(1.12, 10);
    expect(g.events('machine:buy').map((e) => e.kind)).toEqual(['secondHelping', 'shortOrder', 'longHaul']);
    expect(g.game.points).toBe(50000 - 2500 - 3000 - 2000);
  });

  it('a machine bought twice is refused with owned and its prompt goes', () => {
    const g = econG({ points: 50000 });
    g.G.level.setPower(true);
    expect(use(g, 'machine-longHaul').ok).toBe(true);
    expect(use(g, 'machine-longHaul')).toEqual({ ok: false, reason: 'owned' });
    expect(g.find('machine-longHaul').enabled()).toBe(false);
    expect(g.game.machines.has('longHaul')).toBe(true);
  });

  it('Jump Start costs 1500, then 2500 after it is used', () => {
    const g = econG({ points: 50000 });
    g.G.level.setPower(true);
    expect(g.find('machine-jumpStart').cost).toBe(1500);
    use(g, 'machine-jumpStart');
    expect(g.game.points).toBe(48500);
    g.G.player.damage(500); // the killing hit spends it
    expect(g.G.player.alive).toBe(true);
    expect(g.game.machines.has('jumpStart')).toBe(false);
    expect(g.find('machine-jumpStart').cost).toBe(2500);
    use(g, 'machine-jumpStart');
    expect(g.game.points).toBe(46000);
  });
});

describe('board repairs', () => {
  it('pay 10 each up to 200 a round and nothing after; a new round pays again', () => {
    const g = econG({ points: 0 });
    const w = g.G.level.windows[0];
    let paid = 0;
    for (let i = 0; i < 30; i++) {
      w.boards = 0;
      for (let k = 0; k < 6; k++) g.game.purchases.repairBoard(g.find('boards-w1'));
    }
    paid = g.game.points;
    expect(paid).toBe(200);
    expect(w.boards).toBe(6);
    g.G.events.emit('round:start', { n: 2, total: 14 });
    w.boards = 5;
    g.game.purchases.repairBoard(g.find('boards-w1'));
    expect(g.game.points).toBe(210);
  });

  it('holding interact at a window puts a board back every 0.6 s', () => {
    const g = econG({ points: 0 });
    const w = g.G.level.windows[0];
    w.boards = 2;
    g.G.player.pos = [10, 0, 9.1];
    g.step();
    expect(g.game.focus.id).toBe('boards-w1');
    g.G.input.press('interact');
    g.run(0.65);
    expect(w.boards).toBe(3);
    g.run(0.6);
    expect(w.boards).toBe(4);
    g.G.input.release('interact');
    g.run(2);
    expect(w.boards).toBe(4);
    expect(g.game.points).toBe(20);
  });

  it('a press on a hold interactable is not a refusal (no buy:denied)', () => {
    const g = econG();
    expect(use(g, 'boards-w1')).toEqual({ ok: false, reason: 'hold' });
    expect(g.count('buy:denied')).toBe(0);
  });
});

describe('interact.nearest', () => {
  it('skips disabled interactables and ones on another floor', () => {
    const g = econG({ points: 5000 });
    g.G.player.pos = [5, 0, 5];
    g.step();
    expect(g.game.focus.id).toBe('door-d1');
    use(g, 'door-d1');
    g.step();
    expect(g.game.focus).toBe(null);
    // the Calder wall buy hangs on the upper walkway: not from the ground below it
    const calder = g.find('wall-calder556');
    g.G.player.pos = [calder.pos[0], 0, calder.pos[2] + 0.8];
    g.step();
    expect(g.game.focus && g.game.focus.id).not.toBe('wall-calder556');
    g.G.player.pos = [calder.pos[0], 3.04, calder.pos[2] + 0.8];
    g.step();
    expect(g.game.focus.id).toBe('wall-calder556');
  });
});
