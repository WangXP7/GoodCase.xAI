// Power-ups dropped by kills.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const die = (g, id, o = {}) => g.G.events.emit('zombie:die', { id, pos: [3, 0, 3], headshot: false, ...o });

describe('drops', () => {
  it('over 10 000 kills the drop rate is 3 % +- 0.5, never more than 4 in a round', () => {
    const g = econG({ seed: 7 });
    const pu = g.game.powerups;
    let drops = 0, inRound = 0, maxInRound = 0;
    g.G.events.on('powerup:drop', () => { drops++; inRound++; });
    for (let i = 0; i < 10000; i++) {
      if (i % 50 === 0) { g.G.events.emit('round:start', { n: 2 + i / 50, total: 50 }); maxInRound = Math.max(maxInRound, inRound); inRound = 0; }
      die(g, i + 1);
      pu.update(10.5); // past the gap; old drops lapse
    }
    expect(drops / 10000).toBeGreaterThan(0.025);
    expect(drops / 10000).toBeLessThan(0.035);
    expect(maxInRound).toBeLessThanOrEqual(4);
  }, 60000);

  it('never more than 4 in one round however many die, and never two within 10 s', () => {
    const g = econG({ seed: 3 });
    const pu = g.game.powerups;
    const t = [];
    let clock = 0;
    g.G.events.on('powerup:drop', () => t.push(clock));
    for (let i = 0; i < 3000; i++) { die(g, i + 1); pu.update(1); clock += 1; }
    expect(t.length).toBeLessThanOrEqual(4);
    expect(t.length).toBeGreaterThan(0);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(10);
  });

  it('a brute always drops one', () => {
    const g = econG();
    for (let i = 0; i < 5; i++) { die(g, i + 1, { type: 'brute' }); }
    expect(g.count('powerup:drop')).toBe(5);
  });

  it('the brute type is read from the zombie list when the event has none', () => {
    const g = econG();
    const z = g.G.zombies.add({ type: 'brute' });
    die(g, z.id);
    expect(g.count('powerup:drop')).toBe(1);
  });

  it('a drop untouched for 25 s is removed; one walked over within 1.2 m is taken', () => {
    const g = econG();
    const pu = g.game.powerups;
    pu.drop('doubleTime', [20, 0, 20]);
    expect(pu.drops).toHaveLength(1);
    expect(g.events('powerup:drop')[0]).toMatchObject({ kind: 'doubleTime', pos: { x: 20, y: 0, z: 20 } });
    g.run(24.9);
    expect(pu.drops).toHaveLength(1);
    g.run(0.2);
    expect(pu.drops).toHaveLength(0);
    pu.drop('oneTap', [1.0, 0, 0]);
    g.G.player.pos = [0, 0, 0];
    g.step();
    expect(pu.drops).toHaveLength(0);
    expect(g.events('powerup:take')).toEqual([{ kind: 'oneTap', seconds: 30 }]);
  });
});

describe('effects', () => {
  it('Double Time doubles a 60 to 120 and stops after 30 s of sim time, not real time', () => {
    const g = econG({ points: 0 });
    g.game.powerups.activate('doubleTime');
    g.G.events.emit('hit:zombie', { id: 1, part: 'torso', killed: true, source: 'bullet' });
    expect(g.game.points).toBe(120);
    g.game.pause();
    g.run(60); // paused: the game does not tick
    g.game.resume();
    expect(g.game.powerups.active.get('doubleTime')).toBeCloseTo(30, 5);
    g.run(29.9);
    g.G.events.emit('hit:zombie', { id: 2, part: 'torso', killed: true, source: 'bullet' });
    expect(g.game.points).toBe(240);
    g.run(0.2);
    expect(g.game.powerups.active.has('doubleTime')).toBe(false);
    expect(g.events('powerup:end')).toEqual([{ kind: 'doubleTime' }]);
    g.G.events.emit('hit:zombie', { id: 3, part: 'torso', killed: true, source: 'bullet' });
    expect(g.game.points).toBe(300);
  });

  it('One-Tap sets G.weapon.mods.instantKill, kills pay kill points only, and it clears', () => {
    const g = econG({ points: 0 });
    g.game.powerups.activate('oneTap');
    expect(g.G.weapon.mods.instantKill).toBe(true);
    g.G.events.emit('hit:zombie', { id: 1, part: 'head', killed: true, headshot: true, source: 'bullet' });
    g.G.events.emit('hit:zombie', { id: 2, part: 'torso', killed: true, source: 'melee' });
    expect(g.game.points).toBe(120);
    g.run(30.1);
    expect(g.G.weapon.mods.instantKill).toBe(false);
  });

  it('Flashover kills every zombie alive and awards 400 once however many die; brutes take half', () => {
    const g = econG({ points: 0 });
    for (let i = 0; i < 9; i++) g.G.zombies.add();
    const brute = g.G.zombies.add({ type: 'brute', health: 5000, maxHealth: 5000 });
    g.game.powerups.activate('flashover');
    expect(g.G.zombies.list).toEqual([brute]);
    expect(brute.health).toBe(2500);
    expect(g.game.points).toBe(400);
    expect(g.events('points:add')).toEqual([{ amount: 400, reason: 'flashover' }]);
  });

  it('Resupply fills every held weapon and throwable', () => {
    const g = econG({ points: 1000 });
    g.game.purchases.use(g.find('wall-hollis12'));
    g.G.weapon.slots[0].reserve = 0; g.G.weapon.slots[1].reserve = 0;
    g.game.powerups.activate('resupply');
    expect(g.G.weapon.slots[0].reserve).toBe(96);
    expect(g.G.weapon.slots[1].reserve).toBe(54);
    expect(g.G.weapon.throwables).toEqual({ frag: 3, molotov: 2, decoy: 2 });
  });

  it('timers do not run while paused, and restart clears them', () => {
    const g = econG();
    g.game.powerups.activate('oneTap');
    g.game.pause();
    g.run(100);
    expect(g.game.powerups.active.get('oneTap')).toBeCloseTo(30, 5);
    g.game.resume();
    g.game.powerups.drop('resupply', [9, 0, 9]);
    g.game.restart();
    expect(g.game.powerups.active.size).toBe(0);
    expect(g.game.powerups.drops).toHaveLength(0);
    expect(g.G.weapon.mods.instantKill).toBe(false);
  });
});
