// The weapon box.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { tuning } from '../src/game/tuning.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const SPECIAL = ['jumper', 'flare'];

describe('weapon box', () => {
  it('starts idle at one of the three spots; the box interactable stands there', () => {
    const g = econG();
    const box = g.game.box;
    expect(box.state).toBe('idle');
    expect(g.G.level.boxSpots.map((s) => s.id)).toContain(box.spot);
    expect(g.find('box').pos).toEqual(g.G.level.boxSpots.find((s) => s.id === box.spot).pos);
  });

  it('a roll costs 950 and offers after 3.5 s; the offer is never a held weapon', () => {
    const g = econG({ points: 950 });
    const box = g.game.box;
    expect(box.roll()).toEqual({ ok: true, reason: null });
    expect(g.game.points).toBe(0);
    expect(g.events('buy')).toEqual([{ item: 'box', cost: 950, id: 'box' }]);
    expect(g.events('box:roll')).toEqual([{ spot: box.spot }]);
    expect(box.state).toBe('rolling');
    g.run(3.4);
    expect(box.state).toBe('rolling');
    g.run(0.15);
    expect(box.state).toBe('offering');
    expect(box.offer).not.toBe('pistol');
    expect(g.events('box:result')).toEqual([{ weapon: box.offer }]);
  });

  it('never offers a weapon already held, over many rolls', () => {
    const g = econG({ points: 1e7, params: { give: ['smg', 'lmg'] } });
    g.G.weapon.reset();
    const box = g.game.box;
    for (let i = 0; i < 300; i++) {
      box.roll();
      g.run(4, 0.25);
      expect(['smg', 'lmg', 'pistol']).not.toContain(box.offer);
      g.run(10.5, 0.25); // let it lapse
      if (box.state === 'moving') g.run(4.5, 0.25);
    }
  }, 60000);

  it('take gives the offer; with both slots full it replaces the held one', () => {
    const g = econG({ points: 5000, params: { give: ['smg', 'lmg'] } });
    g.G.weapon.reset();
    expect(g.G.weapon.slots.map((s) => s.id)).toEqual(['smg', 'lmg']);
    const held = g.G.weapon.id;
    const box = g.game.box;
    box.roll(); g.run(3.6);
    const offer = box.offer;
    expect(box.take()).toEqual({ ok: true, reason: null });
    expect(g.G.weapon.has(offer)).toBe(true);
    expect(g.G.weapon.has(held)).toBe(false);
    expect(g.events('box:take')).toEqual([{ weapon: offer, spot: expect.any(String) }]);
    expect(['idle', 'moving']).toContain(box.state);
    expect(box.offer).toBe(null);
  });

  it('pressing the box while it offers takes the weapon', () => {
    const g = econG({ points: 5000 });
    g.game.box.roll(); g.run(3.6);
    const offer = g.game.box.offer;
    expect(g.find('box').label).toBe(g.G.weapon.statsFor({ id: offer, upgraded: false, attachments: new Set() }).name);
    expect(g.game.purchases.use(g.find('box')).ok).toBe(true);
    expect(g.G.weapon.has(offer)).toBe(true);
  });

  it('an untaken offer is gone at 10 s with no refund', () => {
    const g = econG({ points: 950 });
    const box = g.game.box;
    box.roll(); g.run(3.6);
    g.run(9.8);
    expect(box.state).toBe('offering');
    g.run(0.3);
    expect(box.offer).toBe(null);
    expect(box.take()).toEqual({ ok: false, reason: 'none' });
    expect(g.game.points).toBe(0);
    expect(g.events('box:expire')).toEqual([{ weapon: expect.any(String), spot: box.spot }]);
  });

  it('a roll during rolling, offering or moving is refused with busy', () => {
    const g = econG({ points: 1e6 });
    const box = g.game.box;
    box.roll();
    expect(box.roll()).toEqual({ ok: false, reason: 'busy' });
    g.run(3.6);
    expect(box.roll()).toEqual({ ok: false, reason: 'busy' });
    box.usesLeft = 0; // this was the last use before it moves
    box.take();
    expect(box.state).toBe('moving');
    expect(box.roll()).toEqual({ ok: false, reason: 'busy' });
    expect(g.game.points).toBe(1e6 - 950);
  });

  it('too few points is refused with points', () => {
    const g = econG({ points: 949 });
    expect(g.game.box.roll()).toEqual({ ok: false, reason: 'points' });
    expect(g.game.box.state).toBe('idle');
  });

  it('with seed 1 it moves after its seeded number of uses, to a different spot, after 4 s', () => {
    const g = econG({ seed: 1, points: 1e6 });
    const box = g.game.box;
    const uses = box.usesLeft;
    const from = box.spot;
    for (let i = 0; i < uses; i++) {
      expect(box.state).toBe('idle');
      box.roll(); g.run(3.6); box.take();
    }
    expect(box.state).toBe('moving');
    const mv = g.events('box:move').filter((e) => e.from);
    expect(mv).toHaveLength(1);
    expect(mv[0].from).toBe(from);
    expect(mv[0].to).not.toBe(from);
    g.run(3.9);
    expect(box.state).toBe('moving');
    g.run(0.2);
    expect(box.state).toBe('idle');
    expect(box.spot).toBe(mv[0].to);
    expect(g.find('box').pos).toEqual(g.G.level.boxSpots.find((s) => s.id === box.spot).pos);
  });

  it('the number of uses is always 4-8 over 200 seeds, and the start spot varies', () => {
    const starts = new Set();
    for (let s = 1; s <= 200; s++) {
      const g = econG({ seed: s });
      expect(g.game.box.usesLeft).toBeGreaterThanOrEqual(4);
      expect(g.game.box.usesLeft).toBeLessThanOrEqual(8);
      starts.add(g.game.box.spot);
    }
    expect(starts.size).toBe(3);
  }, 60000);

  it('over 5000 rolls the specials come up at their weight +-20 %', () => {
    const g = econG({ points: 1e9 });
    const box = g.game.box;
    const n = {};
    for (let i = 0; i < 5000; i++) {
      box.roll(); g.run(4, 0.5);
      n[box.offer] = (n[box.offer] || 0) + 1;
      g.run(10.5, 0.5);
      if (box.state === 'moving') g.run(4.5, 0.5);
    }
    const T = tuning.weapons.table;
    const total = Object.keys(T).filter((id) => id !== 'pistol').reduce((a, id) => a + T[id].box, 0);
    for (const id of SPECIAL) {
      const want = (5000 * T[id].box) / total;
      expect(n[id]).toBeGreaterThan(want * 0.8);
      expect(n[id]).toBeLessThan(want * 1.2);
    }
    expect(n.pistol).toBeUndefined();
  }, 60000);

  it('timers run on sim time: a paused box does not finish its roll', () => {
    const g = econG({ points: 950 });
    g.game.box.roll();
    g.game.pause();
    g.run(10);
    expect(g.game.box.state).toBe('rolling');
    g.game.resume();
    g.run(3.6);
    expect(g.game.box.state).toBe('offering');
  });

  it('restart puts the box back idle at a seeded spot with no offer', () => {
    const g = econG({ points: 950 });
    g.game.box.roll();
    g.game.restart();
    expect(g.game.box.state).toBe('idle');
    expect(g.game.box.offer).toBe(null);
  });
});
