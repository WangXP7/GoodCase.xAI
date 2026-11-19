// Scoring for the end screen and the leaderboard, Jump Start, and what restart() clears.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { searchables } from '../src/level/worldLayout.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const fire = (g) => g.G.events.emit('weapon:fire', { pos: { x: 0, y: 1.7, z: 0 }, dir: { x: 0, y: 0, z: -1 }, weapon: 'pistol', pellets: 1 });
const hit = (g, o) => g.G.events.emit('hit:zombie', { id: 1, part: 'torso', damage: 40, killed: false, source: 'bullet', ...o });
const die = (g, o = {}) => g.G.events.emit('zombie:die', { id: 1, pos: [0, 0, 0], headshot: false, ...o });

describe('Jump Start', () => {
  it('a revive keeps the run going and is consumed; the next killing hit ends the game', () => {
    const g = econG({ points: 1500 });
    g.G.level.setPower(true);
    for (let i = 0; i < 3; i++) g.G.zombies.add({ pos: { x: 2, y: 0, z: 0 } });
    g.G.zombies.add({ pos: { x: 9, y: 0, z: 0 } });
    expect(g.game.purchases.use(g.find('machine-jumpStart')).ok).toBe(true);
    g.G.player.damage(200);
    expect(g.game.state).toBe('playing');
    expect(g.G.player.health).toBe(50);
    expect(g.G.player.invulnerable).toBe(3);
    expect(g.count('revive')).toBe(1);
    expect(g.G.zombies.staggered.map((s) => s.id)).toHaveLength(3); // the one 9 m away is left alone
    for (const st of g.G.zombies.staggered) expect(Math.hypot(st.dir.x, st.dir.z)).toBeCloseTo(1.5, 5); // metres of push
    expect(g.game.machines.has('jumpStart')).toBe(false);
    g.G.player.invulnerable = 0;
    g.G.player.damage(200);
    expect(g.game.state).toBe('dead');
  });

  it('death without it ends the game', () => {
    const g = econG();
    g.G.player.damage(200);
    expect(g.game.state).toBe('dead');
  });
});

describe('summary', () => {
  it('reports exact kills, headshots, accuracy = hits / shots, earned, spent and doors', () => {
    const g2 = econG({ points: 500 });
    fire(g2); hit(g2); // 10
    fire(g2); hit(g2, { killed: true }); die(g2); // 60
    fire(g2); hit(g2, { part: 'head', headshot: true, killed: true }); die(g2, { headshot: true }); // 100
    fire(g2); hit(g2); hit(g2); // one shot, two pellets: one hit, 20 points
    fire(g2); // a miss
    g2.G.events.emit('hit:zombie', { id: 2, part: 'torso', killed: true, source: 'melee' }); die(g2); // 130, not a shot
    g2.game.purchases.use(g2.find('door-d1')); // 750 spent
    g2.run(12.25);
    const s = g2.game.summary();
    expect(s.kills).toBe(3);
    expect(s.headshots).toBe(1);
    expect(s.accuracy).toBeCloseTo(4 / 5, 10);
    expect(s.earned).toBe(10 + 60 + 100 + 20 + 130);
    expect(s.spent).toBe(750);
    expect(s.doors).toBe(1);
    expect(s.round).toBe(1);
    expect(s.seconds).toBeCloseTo(12.25, 1);
    expect(Array.isArray(s.rows)).toBe(true);
    for (const r of s.rows) { expect(typeof r.label).toBe('string'); expect(typeof r.value).toBe('string'); }
    expect(s.rows.map((r) => r.label)).toContain('Kills');
  });

  it('accuracy is 0 with no shots, never above 1', () => {
    const g = econG();
    expect(g.game.summary().accuracy).toBe(0);
  });

  it('runSummary(): the leaderboard run, with active play seconds only', () => {
    const g = econG({ points: 500 });
    fire(g); hit(g, { part: 'head', headshot: true, killed: true }); die(g, { headshot: true });
    g.run(10);
    g.game.pause();
    g.run(30);
    g.game.resume();
    g.run(5.5);
    g.G.player.damage(500);
    expect(g.game.state).toBe('dead');
    const r = g.game.runSummary();
    expect(r).toEqual({ round: 1, kills: 1, headshots: 1, points: 100, timeSec: 15, version: expect.any(String), device: 'desktop' });
    expect(r.version).toMatch(/^[A-Za-z0-9._+-]{1,32}$/);
    g.G.device.phone = true;
    expect(g.game.runSummary().device).toBe('phone');
  });

  it('newBest only when the stored best is beaten', () => {
    const a = econG();
    a.game.start({ round: 3 });
    a.G.player.damage(500);
    expect(a.game.summary().newBest).toBe(true);
    expect(a.game.summary().best).toBe(3);
    const b = econG();
    b.game.start({ round: 3 });
    b.G.player.damage(500);
    expect(b.game.summary().newBest).toBe(false);
    expect(b.game.summary().best).toBe(3);
  });
});

describe('restart', () => {
  it('clears doors, power, machines, the box, every searched flag and the score', () => {
    const g = econG({ points: 50000 });
    const use = (id) => g.game.purchases.use(g.find(id));
    use('door-d1'); use('power'); use('machine-secondHelping'); use('machine-longHaul');
    g.game.box.roll();
    const s = searchables[0];
    g.G.player.pos = [s.pos[0], 0, s.pos[2]];
    g.step();
    g.G.input.press('interact'); g.run(1.6); g.G.input.release('interact');
    expect(g.game.loot.searched.size).toBe(1);
    fire(g); hit(g, { killed: true }); die(g);
    g.game.powerups.activate('doubleTime');
    g.game.restart();
    expect(g.G.level.doors[0].open).toBe(false);
    expect(g.game.power.on).toBe(false);
    expect(g.game.machines.has('secondHelping')).toBe(false);
    expect(g.game.machines.has('longHaul')).toBe(false);
    expect(g.find('machine-jumpStart').cost).toBe(1500);
    expect(g.game.box.state).toBe('idle');
    expect(g.game.loot.searched.size).toBe(0);
    expect(g.game.powerups.active.size).toBe(0);
    const sum = g.game.summary();
    expect(sum).toMatchObject({ kills: 0, headshots: 0, accuracy: 0, earned: 0, spent: 0, doors: 0, round: 1 });
    expect(g.game.points).toBe(500);
  });

  it('points=<n> sets the starting points of every game', () => {
    const g = econG({ params: { points: 7000 } });
    expect(g.game.points).toBe(7000);
    g.game.economy.spend(1000, 'x');
    g.game.restart();
    expect(g.game.points).toBe(7000);
  });
});
