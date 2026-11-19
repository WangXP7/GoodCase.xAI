// Points for a round through zombies in line: only the first body pays the hit points; bodies behind
// it pay only if they die, then the full kill (headshot kill included). Double Time doubles what is paid.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { econG, memoryStorage } from './fakes/econ.js';
import { tuning } from '../src/game/tuning.js';
import { pointsForHit } from '../src/game/economy.js';

let saved;
beforeEach(() => { saved = globalThis.window; globalThis.window = memoryStorage(); });
afterEach(() => { globalThis.window = saved; });

const P = tuning.points;

// The real game and weapon holding `weapon`, with zombies at `dists` m straight ahead, each `health`.
function lineGame(weapon, dists, health, { head = false } = {}) {
  const g = econG({ points: 0, params: { give: [weapon] } });
  const Z = g.G.zombies;
  for (const d of dists) Z.add({ pos: { x: 0, y: 0, z: -d }, health, maxHealth: health });
  Z.raycast = (o, dir, max) => {
    let best = null;
    for (const r of Z.list) {
      const dist = o[2] - r.pos.z;
      if (dist <= 1e-6 || dist > max) continue;
      if (!best || dist < best.dist) best = { id: r.id, part: head ? 'head' : 'torso', pos: [0, 1.5, r.pos.z], dist };
    }
    return best;
  };
  g.G.level.raycast = () => null;
  g.run(1); // the gun is up
  return g;
}
const fire = (g) => { const before = g.game.points; g.G.weapon.fire(); return g.game.points - before; };

describe('points through a line of zombies', () => {
  it('a line of five, none killed: 10 points (the first body only)', () => {
    const g = lineGame('lmg', [5, 6, 7, 8, 9], 1e6);
    const pts = fire(g);
    expect(g.events('hit:zombie')).toHaveLength(5);
    expect(pts).toBe(P.hit);
  });

  it('three killed in a line of five: three kill payouts and nothing for the two hit behind', () => {
    // the LMG does 62, then x0.8 per body: 62, 49.6, 39.7, 31.7, 25.4; at 35 health the first three die
    const g = lineGame('lmg', [5, 6, 7, 8, 9], 35);
    const pts = fire(g);
    const hits = g.events('hit:zombie');
    expect(hits.map((h) => h.killed)).toEqual([true, true, true, false, false]);
    expect(hits.map((h) => h.pierced)).toEqual([false, true, true, true, true]);
    expect(pts).toBe(3 * P.kill);
  });

  it('a body behind that dies to a headshot pays the headshot kill', () => {
    const g = lineGame('battleRifle', [5, 6], 50, { head: true });
    const pts = fire(g);
    expect(pts).toBe(2 * P.headshotKill);
  });

  it('Double Time doubles only what is paid', () => {
    const g = lineGame('lmg', [5, 6, 7, 8, 9], 1e6);
    g.game.powerups.activate('doubleTime');
    expect(fire(g)).toBe(2 * P.hit);
    const k = lineGame('lmg', [5, 6, 7, 8, 9], 35);
    k.game.powerups.activate('doubleTime');
    expect(fire(k)).toBe(2 * 3 * P.kill);
  });

  it('pointsForHit: a pierced non-kill pays 0, a pierced kill pays as any kill', () => {
    expect(pointsForHit({ killed: false, pierced: true })).toBe(0);
    expect(pointsForHit({ killed: false, pierced: false })).toBe(P.hit);
    expect(pointsForHit({ killed: true, pierced: true })).toBe(P.kill);
    expect(pointsForHit({ killed: true, pierced: true, part: 'head' })).toBe(P.headshotKill);
  });

  it('shotgun pellets: a zombie reached only through another pays no hit points', () => {
    const g = lineGame('pump', [5, 6], 1e6);
    const pts = fire(g);
    const hits = g.events('hit:zombie');
    expect(hits.map((h) => h.pierced)).toEqual([false, true]);
    expect(pts).toBe(P.hit);
  });
});
