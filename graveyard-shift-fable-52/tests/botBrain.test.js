// The bot's survival rules without god mode (launch fix): it keeps 8 m from the nearest zombie
// unless buying, enters no other zone through a door while more than 6 are alive, buys wall ammo at
// once below one magazine, and backs off along the route with the fewest zombies to open ground.
import { describe, it, expect } from 'vitest';
import { createBotBrain } from '../src/player/botBrain.js';

// A flat walkable grid (1 m cells): nearestWalkable rounds to a cell, and the bot walks straight.
const grid = { version: 0, walkable: () => true, nearestWalkable: (x, z) => (Math.round(x) + 100) * 1000 + (Math.round(z) + 100), centerX: (k) => Math.floor(k / 1000) - 100, centerZ: (k) => (k % 1000) - 100 };

function setup({ zombies = [], pos = [0, 0, 0], reserve = 48, points = 2000, god = false, items = [], zone = 'forecourt' } = {}) {
  const synth = [], next = [];
  const player = { pos: pos.slice(), eye: [pos[0], 1.7, pos[2]] };
  player.bot = { goal: null, sidestep: 0, watch: { t: 0 }, passive: false, fireAt() {} };
  const wallAmmo = { id: 'ammo-store', kind: 'wallAmmo', pos: [6, 1.3, -19.5], cost: 250, zone: 'forecourt' };
  const G = {
    params: { god },
    nav: { grid, createFlowField: () => ({ grid, setTarget() {}, dirInto(x, z, out) { out[0] = 0; out[1] = 0; } }) },
    level: {
      zone,
      zones: { forecourt: { rects: [{ x0: -22, z0: -20, x1: 22, z1: 20 }], neighbours: [{ zone: 'diner', door: 'd1' }] }, diner: { rects: [{ x0: 7, z0: -32, x1: 26, z1: -20 }], neighbours: [{ zone: 'forecourt', door: 'd1' }] } },
      doors: [{ id: 'd1', a: 'forecourt', b: 'diner', open: true, cost: 750 }],
      playable: { min: [-22, 0, -20], max: [22, 6, 20] },
      zoneAt: (x, z) => (z < -20 && x > 7 ? 'diner' : 'forecourt'),
      interactables: [wallAmmo, ...items],
      raycast: () => null,
    },
    zombies: { list: zombies.map(([x, z], i) => ({ id: i + 1, pos: { x, y: 0, z }, alive: true, type: 'walker' })), raycast: () => null },
    weapon: { id: 'pistol', def: { mag: 12, maxReserve: 96 }, ammo: { mag: 12, reserve }, slots: [{ id: 'pistol' }, { id: 'pump' }], slot: 0, has: () => true, reloading: false },
    game: { points, focus: null, round: 3, box: { state: 'idle' }, loot: { active: null, searched: new Set() }, machines: { has: () => false } },
    input: { synth: (n) => synth.push(n), synthNext: (n) => next.push(n) },
  };
  const brain = createBotBrain(G, player);
  return { G, brain, player, synth, next, wallAmmo };
}

describe('bot survival (no god mode)', () => {
  it('backs off when a zombie is within 8 m (it used to wait for 5)', () => {
    const { brain, player } = setup({ zombies: [[0, 6.5]] });
    brain.update(1 / 60);
    expect(brain.mode).toBe('fight');
    expect(player.bot.goal).not.toEqual([0, 0]); // moving off
  });

  it('backs off along the route with the fewest zombies, to open ground', () => {
    // zombies close on its east and a wall of them to the north: the way out is south-west
    const zs = [[7, 0], [0, -7], [3, -9], [-3, -9], [6, -6], [-6, -8]];
    const { brain, player } = setup({ zombies: zs });
    brain.update(1 / 60);
    const g = player.bot.goal;
    expect(g).toBeTruthy();
    expect(g[1]).toBeGreaterThan(0); // south (+z), away from the northern crowd
    expect(g[0]).toBeLessThanOrEqual(0.5); // not east into the near one
  });

  it('buys wall ammo at once below one magazine, even with a zombie near', () => {
    const { brain, player, wallAmmo } = setup({ reserve: 6, zombies: [[0, 4]], pos: [2, 0, -12] });
    brain.update(1 / 60);
    expect(brain.mode).toBe('resupply');
    expect(player.bot.goal).toBeTruthy();
    // heads for the store, not away
    const d0 = Math.hypot(wallAmmo.pos[0] - 2, wallAmmo.pos[2] + 12);
    const g = player.bot.goal;
    expect(Math.hypot(wallAmmo.pos[0] - g[0], wallAmmo.pos[2] - g[1])).toBeLessThan(d0);
  });

  it('a routine top-up waits while a zombie is within 8 m', () => {
    const { brain } = setup({ reserve: 30, zombies: [[0, 6]] }); // 30 <= 36: low, but above a magazine
    brain.update(1 / 60);
    expect(brain.mode).toBe('fight');
    const quiet = setup({ reserve: 30, zombies: [[0, 15]] });
    quiet.brain.update(1 / 60);
    expect(quiet.brain.mode).toBe('resupply');
  });

  it('no errand into another zone through a door while more than 6 are alive', () => {
    const wall = { id: 'wall-pike45', kind: 'wallWeapon', weapon: 'pike45', pos: [8, 1.4, -26], cost: 1000, zone: 'diner' };
    const mk = (n) => {
      const zs = []; for (let k = 0; k < n; k++) zs.push([-20 + k, 18]); // far off, in the south-west corner
      const s = setup({ zombies: zs, reserve: 96, points: 5000, items: [wall], pos: [10, 0, -15] });
      s.G.weapon.slots = [{ id: 'pistol' }, null]; s.G.weapon.has = (id) => id === 'pistol';
      s.brain.update(1 / 60);
      return s.brain;
    };
    expect(mk(7).errand).toBe(null);
    const b = mk(6);
    expect(b.errand && b.errand.it.id).toBe('wall-pike45');
  });

  it('with nothing to do in another zone it walks back out to the forecourt', () => {
    const { brain, player } = setup({ zone: 'diner', pos: [15, 0, -26], reserve: 96 });
    brain.update(1 / 60);
    const g = player.bot.goal;
    expect(g[1]).toBeGreaterThan(-26); // toward the forecourt (south of the diner)
  });

  it('god mode keeps its old 5 m', () => {
    const { brain, player, G } = setup({ zombies: [[0, 6.5]], god: true, reserve: 96 });
    G.level.interactables.length = 0; // nothing to camp at
    brain.update(1 / 60);
    expect(player.bot.goal).toEqual([0, 0]); // stands
  });
});

describe('ammo for any held gun at the crate', () => {
  const lmg = (o) => {
    const s = setup({ zombies: [[0, 30]], pos: [2, 0, -12], ...o });
    s.G.weapon = { ...s.G.weapon, id: 'lmg', def: { mag: 75, maxReserve: 300 }, ammo: { mag: 75, reserve: 6 }, slots: [{ id: 'lmg' }, { id: 'battleRifle' }] };
    return s;
  };
  it('holding a box gun with no wall, it goes to the crate for ammo', () => {
    const { brain, player, wallAmmo } = lmg({ points: 2000 });
    brain.update(1 / 60);
    expect(brain.mode).toBe('resupply');
    const g = player.bot.goal;
    expect(Math.hypot(wallAmmo.pos[0] - g[0], wallAmmo.pos[2] - g[1])).toBeLessThan(Math.hypot(wallAmmo.pos[0] - 2, wallAmmo.pos[2] + 12));
  });
  it('it pays the held gun\'s crate price (the LMG\'s 1000), not the pistol\'s 250', () => {
    const { brain } = lmg({ points: 999 });
    brain.update(1 / 60);
    expect(brain.mode).not.toBe('resupply');
  });
});

describe('a scripted errand to the ammo crate', () => {
  it('presses at the crate though the game offers a view of it, and ends once the press is answered', () => {
    const { G, brain, next, wallAmmo, player } = setup({ pos: [6, 0, -18.5], reserve: 90 });
    G.game.focus = Object.create(wallAmmo); // interact.nearest() gives a live view, not the object itself
    G.game.lastUse = null;
    expect(brain.errandTo('ammo-store')).toBe(true);
    for (let i = 0; i < 30 && !next.includes('interact'); i++) brain.update(1 / 60);
    expect(next).toContain('interact');
    expect(player.bot.goal).toEqual([player.pos[0], player.pos[2]]); // stands at it, not walking on
    G.game.lastUse = { id: 'ammo-store', ok: true, reason: null };
    brain.update(1 / 60);
    expect(brain.errand).toBe(null);
  });
});
