// Searching. Every searchable is searched once per game by holding interact for 1.5 s, for
// one seeded reward from the round's column of the table.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { tuning } from '../src/game/tuning.js';
import { searchables } from '../src/level/worldLayout.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const T = tuning.loot;
const CAR = searchables.find((s) => s.kind === 'car');
const LOCKER = searchables.find((s) => s.kind === 'locker');

// stand at a searchable (on its floor) and let the game pick it as the focus
function standAt(g, s, dx = 0) {
  g.G.player.pos = [s.pos[0] + dx, s.pos[1] > 2.5 ? 3.04 : 0, s.pos[2]];
  g.step();
}
function hold(g, seconds) {
  g.G.input.press('interact');
  g.run(seconds);
}

describe('the hold', () => {
  it('there is one search interactable per searchable (46), each a 1.5 s hold within 1.6 m', () => {
    const g = econG();
    const its = g.G.level.interactables.filter((i) => i.kind === 'search');
    expect(its).toHaveLength(46);
    for (const it of its) { expect(it.hold).toBe(1.5); expect(it.radius).toBe(1.6); }
  });

  it('releasing at 1.4 s gives nothing, leaves it unsearched and emits search:cancel released', () => {
    const g = econG();
    standAt(g, CAR);
    expect(g.game.focus.id).toBe(CAR.id);
    hold(g, 1.4);
    expect(g.game.loot.active).toMatchObject({ id: CAR.id });
    g.G.input.release('interact');
    g.step();
    expect(g.events('search:start')).toEqual([{ id: CAR.id }]);
    expect(g.events('search:cancel')).toEqual([{ id: CAR.id, reason: 'released' }]);
    expect(g.count('search:done')).toBe(0);
    expect(g.game.loot.searched.has(CAR.id)).toBe(false);
    expect(g.game.loot.progress).toBe(0);
  });

  it('34 damage at 1.0 s cancels with damage', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 1.0);
    g.G.player.damage(34);
    g.run(1);
    expect(g.events('search:cancel')).toEqual([{ id: CAR.id, reason: 'damage' }]);
    expect(g.count('search:done')).toBe(0);
    expect(g.game.loot.progress).toBe(0);
  });

  it('stepping 0.4 m outside the radius cancels with moved; 0.2 m outside does not', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 0.5);
    g.G.player.pos = [CAR.pos[0] + 1.6 + 0.2, 0, CAR.pos[2]];
    g.step();
    expect(g.count('search:cancel')).toBe(0);
    g.G.player.pos = [CAR.pos[0] + 1.6 + 0.4, 0, CAR.pos[2]];
    g.step();
    expect(g.events('search:cancel')).toEqual([{ id: CAR.id, reason: 'moved' }]);
  });

  it('firing cancels with fired', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 0.5);
    g.G.events.emit('weapon:fire', { pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, weapon: 'pistol' });
    g.step();
    expect(g.events('search:cancel')).toEqual([{ id: CAR.id, reason: 'fired' }]);
  });

  it('search:progress comes at most at 0, 25, 50, 75 and 100 %', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 1.6);
    const ps = g.events('search:progress').map((e) => e.progress);
    expect(ps.length).toBeLessThanOrEqual(5);
    expect(ps.length).toBeGreaterThanOrEqual(4);
  });

  it('throwing or a melee swing cancels with fired', () => {
    for (const ev of [['throw', { kind: 'frag', pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: -1 } }], ['weapon:melee', { hit: false, kind: 'knife' }]]) {
      const g = econG();
      standAt(g, CAR);
      hold(g, 0.5);
      g.G.events.emit(ev[0], ev[1]);
      expect(g.events('search:cancel')).toEqual([{ id: CAR.id, reason: 'fired' }]);
    }
  });

  it('G.game.hold follows a search and a board repair', () => {
    const g = econG();
    expect(g.game.hold.active).toBe(false);
    standAt(g, CAR);
    hold(g, 0.75);
    expect(g.game.hold).toMatchObject({ active: true, kind: 'search' });
    expect(g.game.hold.progress).toBeCloseTo(0.5, 1);
    g.G.input.release('interact'); g.step();
    expect(g.game.hold.active).toBe(false);
    g.G.level.windows[0].boards = 2;
    g.G.player.pos = [10, 0, 9.1];
    g.step();
    hold(g, 0.3);
    expect(g.game.hold).toMatchObject({ active: true, kind: 'repair' });
    expect(g.game.hold.progress).toBeCloseTo(0.5, 1);
  });

  it('a cancel needs a fresh press: holding on does not restart it', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 1.0);
    g.G.player.damage(10);
    g.run(3);
    expect(g.count('search:start')).toBe(1);
    expect(g.count('search:done')).toBe(0);
  });

  it('progress is 0.5 at 0.75 s; a full 1.5 s emits one search:done and the object is used for ever', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 0.75);
    expect(g.game.loot.progress).toBeCloseTo(0.5, 1);
    expect(g.events('search:progress').at(-1)).toMatchObject({ id: CAR.id });
    g.run(0.8);
    expect(g.count('search:done')).toBe(1);
    const done = g.events('search:done')[0];
    expect(done.id).toBe(CAR.id);
    expect(done.reward).toHaveProperty('kind');
    expect(g.game.loot.searched.has(CAR.id)).toBe(true);
    expect(g.game.loot.progress).toBe(0);
    expect(g.find(CAR.id).enabled()).toBe(false);
    expect(g.game.interact.nearest(g.G.player.pos)?.id).not.toBe(CAR.id);
    // a second hold on it does nothing, for ever
    g.G.input.release('interact'); g.step();
    hold(g, 5);
    expect(g.count('search:start')).toBe(1);
    expect(g.count('search:done')).toBe(1);
  });

  it('holds and timers use sim time and freeze while paused', () => {
    const g = econG();
    standAt(g, LOCKER);
    hold(g, 1.0);
    g.game.pause();
    g.run(5);
    expect(g.game.loot.active.t).toBeCloseTo(1.0, 1);
    g.game.resume();
    g.run(0.6);
    expect(g.count('search:done')).toBe(1);
  });
});

describe('the rewards', () => {
  it('over 20 000 rolls per bracket each share is within +-1.5 points of the table', () => {
    const g = econG({ seed: 11 });
    for (const [col, round] of [[1, 2], [2, 7], [3, 15]]) {
      const n = {};
      for (let i = 0; i < 20000; i++) {
        const r = g.game.loot.rollReward(`x${i}`, round);
        n[r.kind] = (n[r.kind] || 0) + 1;
      }
      for (const row of T.table) {
        const share = ((n[row[0]] || 0) / 20000) * 100;
        expect(Math.abs(share - row[col])).toBeLessThan(1.5);
      }
    }
  }, 60000);

  it('the same seed gives the same reward for an id whatever the order; restart gives another set', () => {
    const a = econG({ seed: 5 });
    const b = econG({ seed: 5 });
    const ids = searchables.map((s) => s.id);
    const ra = ids.map((id) => a.game.loot.rollReward(id, 3));
    const rb = [...ids].reverse().map((id) => b.game.loot.rollReward(id, 3)).reverse();
    expect(rb).toEqual(ra);
    a.game.restart();
    const rc = ids.map((id) => a.game.loot.rollReward(id, 3));
    expect(rc).not.toEqual(ra);
  });

  it('restart clears the searched set and tells the level to shut every prop', () => {
    const g = econG();
    standAt(g, CAR);
    hold(g, 1.6);
    expect(g.game.loot.searched.size).toBe(1);
    const resets = g.G.level.resets;
    g.game.restart();
    expect(g.game.loot.searched.size).toBe(0);
    expect(g.G.level.resets).toBe(resets + 1);
    expect(g.find(CAR.id).enabled()).toBe(true);
  });

  it('no roll over 100 000 returns jumper, flare, a wall weapon or Resupply', () => {
    const g = econG({ seed: 2 });
    const banned = new Set(['jumper', 'flare', 'pump', 'smg', 'rifle', 'autoShotgun', 'resupply', 'flashover']);
    for (let i = 0; i < 100000; i++) {
      const r = g.game.loot.rollReward(`y${i}`, 1 + (i % 30));
      expect(banned.has(r.item)).toBe(false);
    }
  }, 60000);

  it('points at round 1 are 50-170 and never exceed 400 at round 30, in steps of 10', () => {
    const g = econG({ seed: 4 });
    let lo = Infinity, hi = 0, hi30 = 0;
    for (let i = 0; i < 20000; i++) {
      const r = g.game.loot.rollReward(`p${i}`, 1);
      if (r.kind === 'points') { lo = Math.min(lo, r.amount); hi = Math.max(hi, r.amount); expect(r.amount % 10).toBe(0); }
      const s = g.game.loot.rollReward(`p${i}`, 30);
      if (s.kind === 'points') hi30 = Math.max(hi30, s.amount);
    }
    expect(lo).toBeGreaterThanOrEqual(50);
    expect(hi).toBeLessThanOrEqual(170);
    expect(hi30).toBeLessThanOrEqual(400);
    expect(hi30).toBe(400);
  }, 60000);

  it('ammo with a full reserve pays points instead; otherwise it is 30 % of the max reserve', () => {
    const g = econG({ points: 0 });
    const loot = g.game.loot;
    g.G.weapon.slots[0].reserve = 96;
    const r = loot.grant({ kind: 'ammo', item: null, amount: 0.3, points: 120 });
    expect(r).toEqual({ kind: 'points', item: null, amount: 25 }); // the flat fallback, not the points roll
    expect(g.game.points).toBe(25);
    g.G.weapon.slots[0].reserve = 0;
    const r2 = loot.grant({ kind: 'ammo', item: null, amount: 0.3, points: 120 });
    expect(r2).toEqual({ kind: 'ammo', item: 'pistol', amount: 29 });
    expect(g.G.weapon.slots[0].reserve).toBe(29);
  });

  it('a medkit heals 60; at full health it is a plate; a plate at three pays 25', () => {
    const g = econG({ points: 0 });
    const loot = g.game.loot;
    g.G.player.health = 30;
    expect(loot.grant({ kind: 'medkit', item: null, amount: 60, points: 80 })).toEqual({ kind: 'medkit', item: null, amount: 60 });
    expect(g.G.player.health).toBe(90);
    g.G.player.health = 100;
    expect(loot.grant({ kind: 'medkit', item: null, amount: 60, points: 80 }).kind).toBe('plate');
    expect(g.G.player.plates).toBe(1);
    g.G.player.plates = 3;
    expect(loot.grant({ kind: 'plate', item: null, amount: 1, points: 80 })).toEqual({ kind: 'points', item: null, amount: 25 });
  });

  it('a throwable of a full kind pays 25; an attachment the weapon has all of pays 25', () => {
    const g = econG({ points: 0 });
    const loot = g.game.loot;
    expect(loot.grant({ kind: 'throwable', item: 'decoy', amount: 1, points: 80 }).kind).toBe('throwable');
    expect(g.G.weapon.throwables.decoy).toBe(1);
    g.G.weapon.addThrowable('frag', 3);
    expect(loot.grant({ kind: 'throwable', item: 'frag', amount: 1, points: 80 })).toEqual({ kind: 'points', item: null, amount: 25 });
    const a = loot.grant({ kind: 'attachment', item: 'grip', amount: 1, points: 80 });
    expect(a).toEqual({ kind: 'attachment', item: 'grip', amount: 1 });
    for (const k of ['sight', 'mag', 'suppressor']) loot.grant({ kind: 'attachment', item: k, amount: 1, points: 80 });
    expect(loot.grant({ kind: 'attachment', item: 'grip', amount: 1, points: 80 })).toEqual({ kind: 'points', item: null, amount: 25 });
  });

  it('an attachment the weapon already has gives another it lacks', () => {
    const g = econG();
    g.G.weapon.attach('sight');
    const a = g.game.loot.grant({ kind: 'attachment', item: 'sight', amount: 1, points: 80 });
    expect(a.kind).toBe('attachment');
    expect(a.item).not.toBe('sight');
  });

  it('a searched power-up lasts 15 s', () => {
    const g = econG();
    g.game.loot.grant({ kind: 'powerup', item: 'doubleTime', amount: 15, points: 80 });
    expect(g.game.powerups.active.get('doubleTime')).toBe(15);
  });

  it('a rare weapon is left as a pickup for 30 s with one magazine in reserve; a third pays 25', () => {
    const g = econG({ points: 0 });
    const loot = g.game.loot;
    g.G.player.pos = [50, 0, 50];
    const r = loot.grant({ kind: 'weapon', item: 'revolver', amount: 1, points: 80 }, [50, 1, 50]);
    expect(r).toEqual({ kind: 'weapon', item: 'revolver', amount: 1 });
    expect(g.G.weapon.has('revolver')).toBe(false); // never replaces a weapon unasked
    expect(loot.pickups).toHaveLength(1);
    const p = loot.pickups[0];
    expect(g.G.level.interactables).toContain(p);
    expect(g.game.purchases.use(p)).toEqual({ ok: true, reason: null });
    expect(g.G.weapon.has('revolver')).toBe(true);
    const s = g.G.weapon.slots[g.G.weapon.slot];
    expect(s.reserve).toBe(6);
    expect(g.events('pickup:take')).toEqual([{ kind: 'weapon', item: 'revolver' }]);
    expect(loot.pickups).toHaveLength(0);
    expect(g.G.level.interactables).not.toContain(p);
    loot.grant({ kind: 'weapon', item: 'lmg', amount: 1, points: 80 }, [50, 1, 50]);
    expect(loot.pickups).toHaveLength(1);
    g.run(29.9);
    expect(loot.pickups).toHaveLength(1);
    g.run(0.2);
    expect(loot.pickups).toHaveLength(0);
    expect(loot.grant({ kind: 'weapon', item: 'battleRifle', amount: 1, points: 80 }, [50, 1, 50])).toEqual({ kind: 'points', item: null, amount: 25 });
  });

  it('the fire axe appears at most once a game', () => {
    const g = econG();
    const loot = g.game.loot;
    expect(loot.grant({ kind: 'weapon', item: 'axe', amount: 1, points: 80 }, [0, 1, 0]).item).toBe('axe');
    loot.take(loot.pickups[0]);
    expect(g.G.weapon.melee).toBe('axe');
    const again = loot.grant({ kind: 'weapon', item: 'axe', amount: 1, points: 80 }, [0, 1, 0]);
    expect(again.item).not.toBe('axe');
    let axes = 0;
    for (let i = 0; i < 100000; i++) if (loot.rollReward(`z${i}`, 12).item === 'axe') axes++;
    expect(axes).toBeGreaterThan(0); // the raw roll may name it; grant() keeps it to once
  }, 60000);

  it('expected points over all 46 searchables at round 5 are under 2 200', () => {
    let total = 0;
    const runs = 40;
    for (let s = 1; s <= runs; s++) {
      const g = econG({ seed: s, points: 0 });
      // between searches the player fires and is hit: half a reserve and 60 health each time;
      // plates, throwables and attachments pile up as they would
      for (const sr of searchables) {
        g.G.weapon.slots[0].reserve = 48;
        g.G.player.health = 60;
        g.game.loot.grant(g.game.loot.rollReward(sr.id, 5), sr.pos);
      }
      total += g.game.economy.earned;
    }
    expect(total / runs).toBeLessThan(2200);
  }, 60000);

  it('a medkit at full health with three plates pays a flat 25', () => {
    const g = econG({ points: 0 });
    g.G.player.plates = 3;
    expect(g.game.loot.grant({ kind: 'medkit', item: null, amount: 60, points: 170 })).toEqual({ kind: 'points', item: null, amount: 25 });
  });

  // A player who needs nothing (full reserve, full health, three plates, every throwable carried,
  // every attachment on): only the points rolls and a flat 25 for each unneeded reward.
  // Bound: 46 x (points share x mean points roll + (1 - points - nothing - powerup share) x 100),
  // plus 2 rare weapons, with 5 % slack. Measured over 40 seeds.
  it('a fully stocked player earns a bounded amount from all 46 searchables at rounds 1, 5 and 10', () => {
    const bound = { 1: 1800, 5: 2200, 10: 2600 }; // measured 1717 / 2046 / 2476 (fallback 25)
    for (const round of [1, 5, 10]) {
      let total = 0;
      const runs = 40;
      for (let s = 1; s <= runs; s++) {
        const g = econG({ seed: s, points: 0 });
        const w = g.G.weapon;
        w.addThrowable('frag', 3); w.addThrowable('molotov', 2); w.addThrowable('decoy', 2);
        for (const k of ['sight', 'mag', 'grip', 'suppressor']) w.attach(k);
        g.G.player.plates = 3;
        for (const sr of searchables) {
          w.slots[0].reserve = w.statsFor(w.slots[0]).maxReserve;
          g.G.player.health = g.G.player.maxHealth;
          g.game.loot.grant(g.game.loot.rollReward(sr.id, round), sr.pos);
        }
        total += g.game.economy.earned;
      }
      expect(total / runs).toBeLessThan(bound[round]);
    }
  }, 60000);

  it('a weapon pickup that refills a weapon already held does not shrink its reserve', () => {
    const g = econG();
    const loot = g.game.loot;
    loot.grant({ kind: 'weapon', item: 'lmg', amount: 1, points: 80 }, [0, 1, 0]);
    loot.take(loot.pickups[0]);
    const s = g.G.weapon.slots.find((q) => q && q.id === 'lmg');
    expect(s.reserve).toBe(75); // new: one magazine in reserve
    s.reserve = 200;
    loot.pickups.length = 0;
    // a second pickup of the same weapon (cap permitting, forced here) only tops it up
    g.G.weapon.switchTo(0);
    const pk = { id: 'pickup-x', kind: 'pickup', item: 'lmg', pos: [0, 1, 0], ttl: 30 };
    loot.pickups.push(pk);
    loot.take(pk);
    expect(s.reserve).toBeGreaterThanOrEqual(200);
  });

    it('searched=all starts the game with every searchable used', () => {
    const g = econG({ params: { searched: 'all' } });
    expect(g.game.loot.searched.size).toBe(46);
    expect(g.G.level.interactables.filter((i) => i.kind === 'search' && i.enabled())).toHaveLength(0);
  });
});
