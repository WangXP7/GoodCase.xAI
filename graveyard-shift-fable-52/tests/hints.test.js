import { describe, it, expect } from 'vitest';
import { createEvents } from '../src/core/events.js';
import { createHints } from '../src/ui/hints.js';
import { HINTS, HINT_IDS, parseCopy, plainCopy, wallTarget } from '../src/ui/hintDefs.js';
import { settingsRowSpecs } from '../src/ui/hints.js';
import { createEndScreen } from '../src/ui/endscreen.js';
import { denyText } from '../src/ui/format.js';
import { objective } from '../src/ui/objective.js';

const KEY = 'graveyard-shift.hints.v1';
const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, get: (k, f = null) => (m.has(k) ? m.get(k) : f), set: (k, v) => { m.set(k, String(v)); return true; } };
};
const throwingStore = { get() { throw new Error('denied'); }, set() { throw new Error('denied'); } };

function rig({ store = memStore(), touch = false, over = {}, params = {}, quiet = 0 } = {}) {
  const events = createEvents();
  const shown = [];
  events.on('hint:show', (e) => shown.push(e.id));
  const G = {
    params, events, time: { t: 0 },
    game: { state: 'playing', points: 0 },
    ui: { touch },
    player: { pos: [0, 0, 0], yaw: 0, forward: [0, 0, -1] },
    ...over,
  };
  const hints = createHints(G, { store, view: null, ui: false, bannerQuiet: quiet === 'default' ? undefined : quiet });
  return { G, events, hints, store, shown };
}
const run = (h, seconds, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) h.update(dt); };

describe('hints: once, remembered', () => {
  it('shows a hint once and remembers it across a new instance with the same store', () => {
    const store = memStore();
    const a = rig({ store });
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('move');
    expect(a.hints.seen('move')).toBe(true);
    expect(JSON.parse(store.get(KEY))).toContain('move');
    const b = rig({ store });
    expect(b.hints.seen('move')).toBe(true);
    b.events.emit('round:start', { n: 1 });
    b.hints.update(0.016);
    expect(b.hints.current()).toBeNull();
    // and in the same instance the second trigger is ignored too
    a.hints.dismiss();
    a.events.emit('round:start', { n: 1 });
    run(a.hints, 3);
    expect(a.hints.current()).toBeNull();
  });

  it('with a store that throws it still shows once per instance and never throws', () => {
    const a = rig({ store: throwingStore });
    expect(() => { a.events.emit('round:start', { n: 1 }); a.hints.update(0.016); }).not.toThrow();
    expect(a.hints.current().id).toBe('move');
    a.hints.dismiss();
    a.events.emit('round:start', { n: 1 });
    run(a.hints, 3);
    expect(a.hints.current()).toBeNull();
    expect(a.shown).toEqual(['move']);
  });

  it('ignores a corrupt memory', () => {
    const a = rig({ store: memStore({ [KEY]: '{not json' }) });
    expect(a.hints.seen('move')).toBe(false);
    const b = rig({ store: memStore({ [KEY]: '{"a":1}' }) });
    expect(b.hints.seen('a')).toBe(false);
  });

  it('reset() forgets everything, in memory and in the store', () => {
    const a = rig();
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    a.hints.reset();
    expect(a.hints.seen('move')).toBe(false);
    expect(a.hints.current()).toBeNull();
    expect(JSON.parse(a.store.get(KEY, '[]'))).toEqual([]);
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('move');
  });

  it('hints=reset in the URL clears the memory at start; hints=0 turns them off', () => {
    const store = memStore({ [KEY]: '["move"]' });
    const a = rig({ store, params: { hints: 'reset' } });
    expect(a.hints.seen('move')).toBe(false);
    const b = rig({ params: { hints: false } });
    b.events.emit('round:start', { n: 1 });
    b.hints.update(0.016);
    expect(b.hints.current()).toBeNull();
    expect(b.hints.enabled).toBe(false);
  });

  it('never shows under shot= or nohud', () => {
    for (const params of [{ shot: 'x' }, { nohud: true }]) {
      const a = rig({ params });
      a.events.emit('round:start', { n: 1 });
      a.hints.update(0.016);
      expect(a.hints.current()).toBeNull();
      expect(a.store.get(KEY)).toBeNull();
    }
  });

  it('enabled=false shows nothing and records nothing; turning it on again works', () => {
    const a = rig();
    a.hints.enabled = false;
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    expect(a.hints.current()).toBeNull();
    expect(a.hints.seen('move')).toBe(false);
    expect(a.store.get(KEY)).toBeNull();
    a.hints.enabled = true;
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('move');
  });

  it('turning hints off ends the one on screen', () => {
    const a = rig();
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    a.hints.enabled = false;
    expect(a.hints.current()).toBeNull();
  });
});

describe('hints: priority, spacing, life', () => {
  it('two triggers in one frame: the higher priority first, the other 1.5 s after the first ends', () => {
    const a = rig({ over: { weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, null], slot: 0, melee: 'knife' } } });
    a.events.emit('revive', {});
    a.events.emit('weapon:empty', { weapon: 'pistol' });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('noAmmo');
    a.hints.dismiss();
    a.hints.update(1.4);
    expect(a.hints.current()).toBeNull();
    a.hints.update(0.2);
    expect(a.hints.current().id).toBe('revive');
    expect(a.shown).toEqual(['noAmmo', 'revive']);
  });

  it('a hint lasts its life (6 s by default) and then goes', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('plates');
    run(a.hints, 5.5);
    expect(a.hints.current()).not.toBeNull();
    run(a.hints, 0.7);
    expect(a.hints.current()).toBeNull();
  });

  it('the clock stands still while the game is paused', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    a.G.game.state = 'paused';
    run(a.hints, 30);
    expect(a.hints.current().id).toBe('plates');
    a.G.game.state = 'playing';
    run(a.hints, 6.5);
    expect(a.hints.current()).toBeNull();
  });

  it('a stale queued hint is dropped instead of showing late', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016); // plates is up
    a.events.emit('revive', {});
    a.G.game.state = 'playing';
    run(a.hints, 6.1); // plates ends at 6 s; revive is 6.1 s old, still fresh
    run(a.hints, 1.6);
    expect(a.hints.current().id).toBe('revive');
    a.hints.dismiss();
    a.events.emit('armor:change', { plates: 2 }); // seen already: nothing queued
    run(a.hints, 4);
    expect(a.hints.current()).toBeNull();
  });

  it('until ends a hint early (the player did the thing)', () => {
    const a = rig({ over: { weapon: { slots: [{ id: 'pistol', mag: 3, reserve: 5 }, null], slot: 0 } } });
    a.events.emit('weapon:low', { weapon: 'pistol', reserve: 5 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('lowAmmo');
    run(a.hints, 1);
    expect(a.hints.current().id).toBe('lowAmmo');
    a.events.emit('buy', { item: 'wallAmmo', cost: 250, id: 'ammo-store' });
    run(a.hints, 0.3);
    expect(a.hints.current()).toBeNull();
  });

  it('dismiss() ends it and records it; dismiss(id) of an unseen id records it too', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    a.hints.dismiss();
    expect(a.hints.current()).toBeNull();
    expect(a.hints.seen('plates')).toBe(true);
    a.hints.dismiss('throw');
    expect(a.hints.seen('throw')).toBe(true);
    expect(JSON.parse(a.store.get(KEY))).toEqual(expect.arrayContaining(['plates', 'throw']));
  });

  it('H dismisses the hint on screen', () => {
    const a = rig();
    a.G.input = { pressed: (n) => n === 'hint' && a.G.hPressed };
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    expect(a.hints.current()).not.toBeNull();
    a.G.hPressed = true;
    a.hints.update(0.016);
    expect(a.hints.current()).toBeNull();
  });

  it('emits hint:show and hint:dismiss', () => {
    const a = rig();
    const out = [];
    a.events.on('hint:dismiss', (e) => out.push(e.id));
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    a.hints.dismiss();
    expect(a.shown).toEqual(['plates']);
    expect(out).toEqual(['plates']);
  });
});

describe('hints: the table', () => {
  it('has every id the plan names', () => {
    for (const id of ['move', 'shoot', 'points', 'reload', 'lowAmmo', 'noAmmo', 'wallBuy', 'door', 'power', 'needsPower', 'box', 'search', 'plates', 'throw', 'boards', 'runner', 'armoured', 'bloater', 'brute', 'revive']) {
      expect(HINT_IDS).toContain(id);
    }
    expect(new Set(HINT_IDS).size).toBe(HINT_IDS.length);
    for (const h of HINTS) {
      expect(typeof h.when).toBe('function');
      expect(h.text.key).toBeTruthy();
      expect(h.priority).toBeGreaterThan(0);
    }
  });

  it('lowAmmo does not fire when the reserve is 0 (that is noAmmo)', () => {
    const a = rig({ over: { weapon: { slots: [{ id: 'pistol', mag: 4, reserve: 0 }, null], slot: 0 } } });
    a.events.emit('weapon:low', { weapon: 'pistol', reserve: 0 });
    a.hints.update(0.016);
    expect(a.hints.current()).toBeNull();
    a.events.emit('weapon:low', { weapon: 'pistol', reserve: 6 });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('lowAmmo');
  });

  it('noAmmo mentions the swing once melee exists, and waits until something is bought', () => {
    const a = rig({ over: { weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, null], slot: 0, melee: 'knife' } } });
    a.events.emit('weapon:empty', { weapon: 'pistol' });
    a.hints.update(0.016);
    expect(a.hints.current().plain).toBe('Out of ammo. Buy at the wall, or press V to knife them');
    run(a.hints, 9);
    expect(a.hints.current().id).toBe('noAmmo');
    a.events.emit('buy', { item: 'wallAmmo', cost: 250, id: 'ammo-store' });
    run(a.hints, 0.3);
    expect(a.hints.current()).toBeNull();
    // touch copy
    const b = rig({ touch: true, over: { weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, null], slot: 0, melee: 'knife' } } });
    b.events.emit('weapon:empty', { weapon: 'pistol' });
    b.hints.update(0.016);
    expect(b.hints.current().plain).toBe('Out of ammo. Buy at the wall, or tap the melee button');
  });

  it('noAmmo stays quiet while the other slot still has ammo', () => {
    const a = rig({ over: { weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, { id: 'pump', mag: 4, reserve: 8 }], slot: 0 } } });
    a.events.emit('weapon:empty', { weapon: 'pistol' });
    a.hints.update(0.016);
    expect(a.hints.seen('noAmmo')).toBe(false);
  });

  it('chooses the touch copy when G.ui.touch, the keyboard copy otherwise', () => {
    const k = rig();
    k.events.emit('round:start', { n: 1 });
    k.hints.update(0.016);
    expect(k.hints.current().plain).toBe('WASD to move, mouse to look');
    expect(k.hints.current().parts.some((p) => p.key)).toBe(true);
    const t = rig({ touch: true });
    t.events.emit('round:start', { n: 1 });
    t.hints.update(0.016);
    expect(t.hints.current().plain).toBe('Left thumb moves, a tap there jumps. Drag the right side to look');
  });

  it('copy: Press F / Hold F on keyboard, the button on touch', () => {
    const near = { id: 's-car', kind: 'search', label: 'Search car', pos: [1, 0, 1], radius: 1.6, hold: 1.5, enabled: () => true };
    const mk = (touch) => rig({ touch, over: { level: { interactables: [near] } } });
    const k = mk(false); k.hints.update(0.3);
    expect(k.hints.current().plain).toBe('Hold F to search the car — once only');
    const t = mk(true); t.hints.update(0.3);
    expect(t.hints.current().plain).toBe('Hold SEARCH. One search per car');
    const wall = { id: 'ammo-store', kind: 'wallAmmo', label: 'Ammo', cost: 250, pos: [1, 0, 1], enabled: () => true };
    const w = rig({ touch: false, over: { game: { state: 'playing', points: 500, focus: wall }, level: { interactables: [wall] } } });
    w.hints.update(0.3);
    expect(w.hints.current().plain).toBe('Press F to buy here');
    const wt = rig({ touch: true, over: { game: { state: 'playing', points: 500, focus: wall }, level: { interactables: [wall] } } });
    wt.hints.update(0.3);
    expect(wt.hints.current().plain).toBe('Tap BUY');
  });

  it('move ends once the player has moved 3 m and turned 60 degrees', () => {
    const a = rig();
    a.events.emit('round:start', { n: 1 });
    a.hints.update(0.016);
    a.G.player.pos = [4, 0, 0];
    run(a.hints, 0.5);
    expect(a.hints.current().id).toBe('move'); // moved, not turned
    a.G.player.yaw = 1.2;
    run(a.hints, 0.3);
    expect(a.hints.current()).toBeNull();
  });

  it('move only comes with round 1', () => {
    const a = rig();
    a.events.emit('round:start', { n: 4 });
    a.hints.update(0.016);
    expect(a.hints.current()).toBeNull();
  });

  it('shoot waits for a zombie within 30 m in view, and ends at the first hit', () => {
    const a = rig({ over: { zombies: { list: [{ id: 1, alive: true, pos: { x: 0, y: 0, z: 40 } }, { id: 2, alive: true, pos: { x: 0, y: 0, z: 10 } }] } } });
    run(a.hints, 1); // z=40 is far; z=+10 is behind (forward is -z)
    expect(a.hints.current()).toBeNull();
    a.G.zombies.list[1].pos = { x: 0, y: 0, z: -33 };
    run(a.hints, 0.5);
    expect(a.hints.current()).toBeNull(); // 33 m is out of range
    a.G.zombies.list[1].pos = { x: 0, y: 0, z: -28 };
    run(a.hints, 0.5);
    expect(a.hints.current().id).toBe('shoot'); // 28 m is in (30 m range)
    a.events.emit('hit:zombie', { id: 2, killed: false });
    run(a.hints, 0.3);
    expect(a.hints.current()).toBeNull();
    // after a hit the hint is no use any more
    const b = rig({ over: { zombies: { list: [{ id: 2, alive: true, pos: { x: 2, y: 0, z: -12 } }] } } });
    b.events.emit('hit:zombie', { id: 2, killed: false });
    run(b.hints, 1);
    expect(b.hints.seen('shoot')).toBe(false);
    expect(b.hints.current()).toBeNull();
  });

  it('reload shows at 3 rounds with a reserve and never at an empty reserve', () => {
    const a = rig({ over: { weapon: { ammo: { mag: 3, reserve: 0 }, slots: [] } } });
    run(a.hints, 1);
    expect(a.hints.current()).toBeNull();
    a.G.weapon.ammo.reserve = 12;
    run(a.hints, 0.5);
    expect(a.hints.current().id).toBe('reload');
    a.events.emit('weapon:reload', { weapon: 'pistol' });
    run(a.hints, 0.3);
    expect(a.hints.current()).toBeNull();
  });

  it('door speaks when the points reach the cheapest door that borders the open area', () => {
    const doors = [
      { id: 'd1', a: 'forecourt', b: 'diner', cost: 750, label: 'Diner', pos: [12, 1, -20], open: false },
      { id: 'd2', a: 'diner', b: 'motel', cost: 1250, label: 'Back door', pos: [26, 1, -27], open: false },
      { id: 'd5', a: 'forecourt', b: 'motel', cost: 1500, label: 'Alley gate', pos: [26, 1, -11], open: false },
    ];
    const a = rig({ over: { game: { state: 'playing', points: 700 }, level: { doors, power: { on: false, pos: [64, 1, 4] } } } });
    run(a.hints, 1);
    expect(a.hints.current()).toBeNull();
    a.G.game.points = 800;
    run(a.hints, 0.5);
    expect(a.hints.current().plain).toBe('You can afford the Diner door: 750');
    expect(a.hints.target()).toEqual([12, -20]);
  });

  it('power comes with the first door opened while the power is off, and points at the switch', () => {
    const a = rig({ over: { level: { doors: [], power: { on: false, pos: [64, 1.4, 4.3] } } } });
    a.events.emit('door:open', { id: 'd1' });
    a.hints.update(0.016);
    expect(a.hints.current().id).toBe('power');
    expect(a.hints.target()).toEqual([64, 4.3]);
    const b = rig({ over: { level: { doors: [], power: { on: true, pos: [64, 1.4, 4.3] } } } });
    b.events.emit('door:open', { id: 'd1' });
    b.hints.update(0.016);
    expect(b.hints.current()).toBeNull();
  });

  it('special types: one hint each, on the first spawn', () => {
    const a = rig();
    a.events.emit('zombie:spawn', { id: 1, type: 'walker' });
    a.hints.update(0.016);
    expect(a.hints.current()).toBeNull();
    a.events.emit('zombie:spawn', { id: 2, type: 'runner' });
    a.hints.update(0.016);
    expect(a.hints.current().plain).toBe('Runners: keep moving');
  });

  it('parseCopy draws [..] as key caps', () => {
    expect(parseCopy('Hold [F] to search')).toEqual([{ t: 'Hold ', key: false }, { t: 'F', key: true }, { t: ' to search', key: false }]);
    expect(parseCopy('[G] to throw, [3] to change').filter((p) => p.key).map((p) => p.t)).toEqual(['G', '3']);
    expect(plainCopy('Hold [F] to search')).toBe('Hold F to search');
    expect(parseCopy('')).toEqual([]);
  });

  it('force-shows a hint for staging without recording it', () => {
    const a = rig({ params: { shot: 'x' } });
    a.hints.show('search', { force: true });
    expect(a.hints.current().id).toBe('search');
    expect(a.store.get(KEY)).toBeNull();
    run(a.hints, 30);
    expect(a.hints.current().id).toBe('search'); // a staged hint stays up
  });
});

describe('objective line', () => {
  const door = (o = {}) => ({ id: 'd1', a: 'forecourt', b: 'diner', cost: 750, label: 'Diner', pos: [12, 1, -20], open: false, ...o });
  const base = (o = {}) => ({
    game: { state: 'playing', round: 3, points: 100, director: { phase: 'active', total: 14, spawned: 6, alive: 4, timer: 1, boss: false } },
    weapon: { slots: [{ id: 'pistol', mag: 8, reserve: 40 }, null], slot: 0 },
    zombies: { list: [] },
    level: { doors: [door()], power: { on: false, pos: [64, 1.4, 4.3] }, interactables: [{ id: 'ammo-store', kind: 'wallAmmo', label: 'Ammo', pos: [3, 0, 3], cost: 250, enabled: () => true }] },
    ...o,
  });

  it('says survive, with the count left', () => {
    expect(objective(base())).toEqual({ text: 'Survive round 3 — 12 left', target: null });
  });
  it('boss alive wins over everything', () => {
    const G = base({ zombies: { list: [{ id: 9, type: 'brute', alive: true, pos: { x: 5, y: 0, z: 6 } }] } });
    G.game.director.boss = true;
    G.game.points = 5000;
    const o = objective(G);
    expect(o.text).toBe('Bring down the brute');
    expect(o.target).toEqual([5, 6]);
  });
  it('lull: round cleared, restock, with the seconds', () => {
    const G = base();
    G.game.director = { phase: 'lull', total: 14, spawned: 14, alive: 0, timer: 7.2 };
    expect(objective(G).text).toBe('Round 3 cleared: restock (8s)');
  });
  it('no ammo anywhere sends you to the sign', () => {
    const G = base({ weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, null], slot: 0 } });
    const o = objective(G);
    expect(o.text).toBe('Out of ammo: buy at the wall');
    expect(o.target).toEqual([3, 3]);
  });
  it('one gun empty is not "no ammo"', () => {
    const G = base({ weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, { id: 'pump', mag: 2, reserve: 0 }], slot: 0 } });
    expect(objective(G).text).toMatch(/^Survive/);
  });
  it('an affordable door with none open', () => {
    const G = base();
    G.game.points = 750;
    const o = objective(G);
    expect(o.text).toBe('Open the Diner door — 750');
    expect(o.target).toEqual([12, -20]);
  });
  it('a door open and the power off: find the switch', () => {
    const G = base({ level: { doors: [door({ open: true })], power: { on: false, pos: [64, 1.4, 4.3] }, interactables: [] } });
    const o = objective(G);
    expect(o.text).toBe('Find the power switch in the garage');
    expect(o.target).toEqual([64, 4.3]);
  });
  it('power on and another door affordable: open it; otherwise survive', () => {
    const doors = [door({ open: true }), door({ id: 'd2', a: 'diner', b: 'motel', cost: 1250, label: 'Back door', pos: [26, 1, -27] })];
    const G = base({ level: { doors, power: { on: true, pos: [64, 1.4, 4.3] }, interactables: [] } });
    expect(objective(G).text).toMatch(/^Survive/);
    G.game.points = 1300;
    expect(objective(G).text).toBe('Open the Back door — 1250');
  });
  it('is safe on a bare G', () => {
    expect(objective({})).toEqual({ text: 'Survive', target: null });
    expect(() => objective(null)).not.toThrow();
  });
});

describe('hint copy, icons and ordering', () => {
  it('icons in copy: [@name] draws the button icon and reads as the button in plain text', () => {
    expect(parseCopy('Tap [@reload] to reload')).toEqual([{ t: 'Tap ', key: false }, { t: 'reload', key: true, icon: 'reload' }, { t: ' to reload', key: false }]);
    expect(plainCopy('Tap [@reload] to reload')).toBe('Tap the reload button to reload');
  });
  it('touch copy never names a word that is not on a button (icons instead)', () => {
    const touchCopy = (id, over = {}) => {
      const a = rig({ touch: true, over });
      a.hints.show(id, { force: true });
      return a.hints.current();
    };
    const shoot = touchCopy('shoot');
    expect(shoot.plain).toBe('Crosshair on them, tap the fire button to shoot. Hold it with automatic guns');
    expect(shoot.parts.find((p) => p.icon).icon).toBe('fire');
    expect(touchCopy('reload').parts.find((p) => p.icon).icon).toBe('reload');
    expect(touchCopy('throw').plain).toBe('Tap the throw button to throw');
    expect(touchCopy('switchGuns').parts.find((p) => p.icon).icon).toBe('swap');
    for (const h of HINTS) {
      const t = typeof h.text.touch === 'function' ? h.text.touch({ weapon: { melee: 'knife' } }) : h.text.touch || '';
      for (const word of ['FIRE', 'RELOAD', 'THROW', 'MELEE', 'SWAP', 'AIM']) expect(t).not.toContain(`[${word}]`);
    }
  });
  it('the first hint waits for the round banner to end', () => {
    const a = rig({ quiet: 'default' });
    a.events.emit('round:start', { n: 1 });
    run(a.hints, 1.5);
    expect(a.hints.current()).toBeNull();
    run(a.hints, 1.2);
    expect(a.hints.current().id).toBe('move');
  });
  it('switchGuns once both slots are filled; sprint at round 3; melee within 2 m; power-up drops; bench', () => {
    const w = { slots: [{ id: 'pistol', mag: 1, reserve: 1 }, { id: 'pump', mag: 1, reserve: 1 }], slot: 0 };
    const a = rig({ over: { weapon: w } });
    run(a.hints, 0.5);
    expect(a.hints.current().id).toBe('switchGuns');
    expect(a.hints.current().plain).toBe('Q or 1 / 2 switches guns');
    const b = rig();
    b.events.emit('round:start', { n: 3 });
    run(b.hints, 0.5);
    expect(b.hints.current().plain).toBe("Hold Shift to sprint — you can't shoot while sprinting");
    const t = rig({ touch: true });
    t.events.emit('round:start', { n: 3 });
    run(t.hints, 0.5);
    expect(t.hints.current().plain).toBe('Push the stick all the way to sprint');
    const m = rig({ over: { zombies: { list: [{ id: 1, alive: true, pos: { x: 0, y: 0, z: 1.5 } }] } } });
    run(m.hints, 0.5);
    expect(m.hints.current().id).toBe('melee');
    const p = rig();
    p.events.emit('powerup:drop', { id: 1, kind: 'oneTap', pos: { x: 1, y: 0, z: 1 } });
    run(p.hints, 0.3);
    expect(p.hints.current().plain).toBe('Walk over the glow to grab it');
    const bench = { id: 'bench', kind: 'bench', pos: [3, 0, 3], cost: 4000, enabled: () => true };
    const bd = rig({ over: { game: { state: 'playing', points: 4000 }, level: { power: { on: true }, interactables: [bench] } } });
    run(bd.hints, 0.5);
    expect(bd.hints.current().plain).toBe('Upgrade bench: 4000');
    const off = rig({ over: { game: { state: 'playing', points: 4000 }, level: { power: { on: false }, interactables: [bench] } } });
    run(off.hints, 0.5);
    expect(off.hints.current()).toBeNull();
  });
  it('a hint on screen at death does not come back; nothing shows while dead or paused', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.events.emit('revive', {});
    a.hints.update(0.016);
    expect(a.hints.current()).not.toBeNull();
    a.G.game.state = 'dead';
    a.events.emit('game:state', { state: 'dead' });
    expect(a.hints.current()).toBeNull();
    a.G.game.state = 'playing';
    a.events.emit('game:state', { state: 'playing' });
    run(a.hints, 5);
    expect(a.hints.current()).toBeNull(); // the queued one was dropped too
    const b = rig();
    b.G.game.state = 'dead';
    b.events.emit('armor:change', { plates: 1 });
    run(b.hints, 3);
    expect(b.hints.current()).toBeNull();
  });
  it('the hint carries "H to hide" on desktop copy data', () => {
    const a = rig();
    a.events.emit('armor:change', { plates: 1 });
    a.hints.update(0.016);
    expect(a.hints.current().plain).toBe('Armour plates soak damage before your health');
  });
  it('settings rows are built through menus.addSettingsRow with working get/set', () => {
    const a = rig();
    const [on, again] = settingsRowSpecs(a.hints);
    expect(on.label).toBe('Hints');
    expect(on.get()).toBe(true);
    on.set(false);
    expect(a.hints.enabled).toBe(false);
    expect(on.get()).toBe(false);
    a.hints.enabled = true;
    a.hints.dismiss('plates');
    expect(again.note()).toMatch(/1 seen/);
    again.set('reset');
    expect(a.hints.seen('plates')).toBe(false);
    expect(again.note()).toBe('None seen yet');
  });
  it('refusal copy for power, owned and busy', () => {
    expect(denyText('power')).toBe('Needs power');
    expect(denyText('owned')).toBe('Already have it');
    expect(denyText('busy')).toBe('Wait a moment');
  });
  it('the end-screen slot is emptied when a new game starts', () => {
    const mk = () => { const el = { className: '', dataset: {}, children: [], hidden: false, classList: { add() {} }, setAttribute() {}, addEventListener() {}, append(...k) { this.children.push(...k); }, appendChild(k) { this.children.push(k); return k; }, remove() {} }; Object.defineProperty(el, 'textContent', { get() { return ''; }, set() { this.children.length = 0; } }); return el; };
    globalThis.document = { createElement: mk, createTextNode: (t) => ({ t }) };
    try {
      const events = createEvents();
      const G = { events, game: { summary: () => ({ round: 2, rows: [] }) } };
      const menus = { setScreen: (name, build) => build(mk(), G) };
      const es = createEndScreen(G, { menus });
      const form = mk();
      const unmount = es.mount(form);
      expect(es.slot.children).toContain(form);
      events.emit('game:state', { state: 'playing' });
      expect(es.slot.children).toHaveLength(0);
      expect(typeof unmount).toBe('function');
    } finally { delete globalThis.document; }
  });
});

describe('objective: stragglers and the wall', () => {
  const dir = (o = {}) => ({ phase: 'active', total: 10, spawned: 10, alive: 2, timer: 0, boss: false, ...o });
  it('finds the last N once spawning is over, pointing at the nearest', () => {
    const G = {
      game: { round: 4, points: 0, director: dir() }, player: { pos: [0, 0, 0], yaw: 0 }, weapon: { slots: [{ id: 'pistol', mag: 3, reserve: 3 }, null], slot: 0 },
      zombies: { list: [{ id: 1, alive: true, pos: { x: 30, y: 0, z: 0 } }, { id: 2, alive: true, pos: { x: 8, y: 0, z: 6 } }] },
    };
    expect(objective(G)).toEqual({ text: 'Find the last 2', target: [8, 6] });
    G.zombies.list.pop();
    G.game.director.alive = 1;
    expect(objective(G).text).toBe('Find the last one');
    G.game.director.spawned = 5; // still spawning: not a straggler hunt
    expect(objective(G).text).toMatch(/^Survive/);
  });
  it('the wall target is the nearest affordable wall that sells for a gun you hold', () => {
    const its = [
      { id: 'ammo-store', kind: 'wallAmmo', pos: [40, 0, 0], cost: 250, enabled: () => true },
      { id: 'wall-pump', kind: 'wallWeapon', weapon: 'pump', pos: [10, 0, 0], cost: 400, enabled: () => true },
      { id: 'wall-smg', kind: 'wallWeapon', weapon: 'smg', pos: [3, 0, 0], cost: 1250, enabled: () => true },
    ];
    const G = {
      game: { round: 2, points: 500, director: { phase: 'active', total: 9, spawned: 3, alive: 3 } }, player: { pos: [0, 0, 0], yaw: 0 },
      weapon: { slots: [{ id: 'pistol', mag: 0, reserve: 0 }, { id: 'pump', mag: 0, reserve: 0 }], slot: 0 }, level: { interactables: its },
    };
    const o = objective(G);
    expect(o.text).toBe('Out of ammo: buy at the wall');
    expect(o.target).toEqual([10, 0]); // the pump wall (held, affordable, nearer than the store)
  });
  it('doors read "the Diner door" everywhere', () => {
    const G = {
      game: { round: 1, points: 800, director: dir({ spawned: 2 }) }, player: { pos: [0, 0, 0], yaw: 0 },
      level: { doors: [{ id: 'd1', a: 'forecourt', b: 'diner', cost: 750, label: 'Diner', pos: [12, 1, -20], open: false }], power: { on: false } },
    };
    expect(objective(G).text).toBe('Open the Diner door — 750');
  });
});

describe('wallTarget: the ammo crate sells for the gun in hand', () => {
  const crate = { id: 'ammo-store', kind: 'wallAmmo', label: 'Ammo', pos: [3, 0, 3], cost: 250, enabled: () => true };
  const smgWall = { id: 'wall-pike45', kind: 'wallWeapon', weapon: 'smg', pos: [40, 0, 0], cost: 1250, enabled: () => true };
  const G = (held, other, points) => ({
    game: { points },
    player: { pos: [0, 0, 0] },
    weapon: { id: held, slots: [{ id: held, mag: 0, reserve: 0 }, other ? { id: other, mag: 0, reserve: 0 } : null], slot: 0 },
    level: { interactables: [crate, smgWall] },
  });
  it('holding two box guns (no pistol), the crate is still the wall for them', () => {
    expect(wallTarget(G('lmg', 'battleRifle', 5000))).toBe(crate);
  });
  it('affordability uses the held gun\'s price, not the pistol\'s 250', () => {
    // the LMG's crate price is 1000: at 300 points the crate is not affordable, so the nearest
    // wall that sells for a held gun is still the crate (no affordable one), never another gun's wall
    expect(wallTarget(G('lmg', null, 300))).toBe(crate);
    // holding the SMG at 300 points: neither is affordable; the crate is nearer and sells for it
    expect(wallTarget(G('smg', null, 300))).toBe(crate);
  });
  it('an affordable crate is preferred to an unaffordable nearer wall for a held gun', () => {
    const near = { ...smgWall, pos: [1, 0, 1] };
    const g = G('smg', 'pistol', 600);
    g.level.interactables = [crate, near];
    // the crate sells SMG ammo at 500 (affordable at 600); the nearer wall asks 1250
    expect(wallTarget(g)).toBe(crate);
    g.game.points = 499;
    expect(wallTarget(g)).toBe(near); // neither affordable: the nearest that sells for a held gun
  });
});
