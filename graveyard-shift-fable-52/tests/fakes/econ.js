// The fake G for the economy tests (purchases, box, powerups, loot, score): the real game
// (createGame), the real weapon (createWeapon, no view), and small stand-ins for the player, the
// level, the zombies and the input. Not a test file itself.
import { createGame } from '../../src/game/state.js';
import { createWeapon } from '../../src/weapon/firing.js';
import { createRng } from '../../src/core/rng.js';
import { createEvents } from '../../src/core/events.js';
import * as W from '../../src/level/worldLayout.js';

export function memoryStorage() {
  const mem = new Map();
  return { localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) } };
}

export function fakePlayer(G) {
  const p = {
    pos: [0, 0, 0], eye: [0, 1.7, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true,
    alive: true, health: 100, maxHealth: 100, plates: 0, invulnerable: 0, lethalHook: null,
    speed: new Map(),
    get speedScale() { let k = 1; for (const v of p.speed.values()) k *= v; return k; },
    setSpeedScale(source, k) { if (k === 1) p.speed.delete(source); else p.speed.set(source, k); },
    addPlates(n) { const add = Math.max(0, Math.min(3 - p.plates, n)); p.plates += add; if (add) G.events.emit('armor:change', { plates: p.plates }); return add; },
    heal(n) { p.health = Math.min(p.maxHealth, p.health + n); },
    setLethalHook(fn) { p.lethalHook = fn; },
    // the controller's damage, reduced: a killing hit asks the lethal hook once
    damage(amount) {
      if (!p.alive || p.invulnerable > 0) return false;
      if (amount >= p.health && p.lethalHook) {
        const h = p.lethalHook; p.lethalHook = null;
        const r = h();
        if (r && r.health > 0) { p.health = r.health; p.invulnerable = r.invuln; G.events.emit('player:damage', { amount, dir: null }); return true; }
      }
      p.health = Math.max(0, p.health - amount);
      G.events.emit('player:damage', { amount, dir: null });
      if (p.health <= 0) { p.alive = false; G.events.emit('player:dead'); }
      return true;
    },
    reset() {
      p.pos = [0, 0, 0]; p.alive = true; p.health = 100; p.maxHealth = 100; p.plates = 0;
      p.invulnerable = 0; p.lethalHook = null; p.speed.clear();
    },
  };
  return p;
}

// A level with the world's shape: the real searchables and spots, a door, the power switch, a window.
export function fakeLevel(G) {
  const doors = [{ id: 'd1', a: 'forecourt', b: 'diner', cost: 750, pos: [5, 1, 5], open: false }];
  const power = { on: false, pos: [64, 1.4, 4.34], zone: 'garage' };
  const windows = [{ id: 'w1', zone: 'diner', pos: [10, 1, 10], normal: [0, 0, 1], boards: 6, max: 6 }];
  const props = {};
  const L = {
    doors, power, windows, props, objects: {},
    searchables: W.searchables, boxSpots: W.boxSpots, machineSpots: W.machineSpots,
    benchSpot: W.benchSpot, wallBuys: W.wallBuys,
    spawnPoints: [{ pos: [0, 0, 0], kind: 'fence' }],
    interactables: [
      { id: 'ammo-store', kind: 'wallAmmo', pos: [6.02, 1.3, -19.5], radius: 1.6, cost: 250, label: 'Ammo', zone: 'forecourt' },
      { id: 'door-d1', kind: 'door', door: 'd1', pos: [5, 1, 5], radius: 2, cost: 750, label: 'Diner', zone: 'forecourt', enabled: () => !doors[0].open },
      { id: 'power', kind: 'power', pos: power.pos, radius: 1.6, cost: 0, label: 'Power', zone: 'garage', enabled: () => !power.on },
      { id: 'boards-w1', kind: 'boards', window: 'w1', pos: [10, 1, 9.1], radius: 1.6, cost: 0, label: 'Rebuild', zone: 'diner', hold: 0.6, enabled: () => windows[0].boards < 6 },
    ],
    openDoor(id) { const d = doors.find((q) => q.id === id); if (!d || d.open) return false; d.open = true; G.events.emit('door:open', { id, a: d.a, b: d.b }); return true; },
    setPower(on) { if (power.on === !!on) return false; power.on = !!on; if (on) G.events.emit('power:on', {}); return true; },
    tearBoard(id) { const w = windows.find((q) => q.id === id); if (w.boards > 0) w.boards--; return w.boards; },
    repairBoard(id) { const w = windows.find((q) => q.id === id); if (w.boards < w.max) { w.boards++; G.events.emit('board:repair', { id, left: w.boards }); } return w.boards; },
    resets: 0,
    reset() { L.resets++; for (const d of doors) d.open = false; power.on = false; for (const w of windows) w.boards = w.max; },
  };
  return L;
}

export function fakeZombies(G) {
  let next = 1;
  const Z = {
    list: [],
    staggered: [],
    spawn: () => null, // the round director waits: tests add zombies with add()
    add(o = {}) { const r = { id: next++, pos: { x: 0, y: 0, z: 0 }, health: 150, maxHealth: 150, type: 'walker', alive: true, ...o }; Z.list.push(r); return r; },
    damage(id, amount) {
      const i = Z.list.findIndex((r) => r.id === id);
      if (i < 0) return { killed: false, damage: 0, headshot: false };
      const r = Z.list[i];
      r.health -= amount;
      if (r.health <= 0) {
        G.events.emit('zombie:die', { id, pos: [r.pos.x, 0, r.pos.z], headshot: false, type: r.type });
        Z.list.splice(i, 1);
        return { killed: true, damage: amount, headshot: false };
      }
      return { killed: false, damage: amount, headshot: false };
    },
    stagger(id, dir, seconds) { Z.staggered.push({ id, dir, seconds }); },
    clear() { Z.list.length = 0; },
  };
  return Z;
}

export function fakeInput() {
  const I = {
    down: new Set(), // held actions
    presses: new Set(), // pressed this frame
    t: new Map(),
    held: (n) => (I.down.has(n) ? I.t.get(n) || 1e-3 : 0),
    pressed: (n) => I.presses.has(n),
    press(n) { I.presses.add(n); I.down.add(n); I.t.set(n, 0); },
    release(n) { I.down.delete(n); I.t.delete(n); },
    tick(dt) { I.presses.clear(); for (const n of I.down) I.t.set(n, I.t.get(n) + dt); },
  };
  return I;
}

// opts: { seed, points, params, give }
export function econG(opts = {}) {
  const events = createEvents((e) => { throw e; });
  const log = [];
  const emit = events.emit.bind(events);
  events.emit = (name, payload) => { log.push([name, payload]); emit(name, payload); };
  const G = {
    params: { ...(opts.params || {}) },
    events,
    rng: createRng(opts.seed ?? 1),
    time: { t: 0, sim: 0 },
    device: { touch: false, phone: false, coarse: false },
  };
  G.player = fakePlayer(G);
  G.level = fakeLevel(G);
  G.zombies = fakeZombies(G);
  G.input = fakeInput();
  const warn = console.warn; console.warn = () => {};
  G.weapon = createWeapon(G, { createView: () => null });
  console.warn = warn;
  G.game = createGame(G);
  G.game.start();
  if (opts.points !== undefined) G.game.economy.points = opts.points;
  const step = (dt = 1 / 60) => { G.time.t += dt; G.time.sim += dt; G.game.update(dt); G.input.tick(dt); };
  const run = (seconds, dt = 1 / 60) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) step(dt); };
  const count = (name) => log.filter(([n]) => n === name).length;
  const events_ = (name) => log.filter(([n]) => n === name).map(([, p]) => p);
  const find = (id) => G.level.interactables.find((it) => it.id === id);
  return { G, game: G.game, log, step, run, count, events: events_, find };
}
