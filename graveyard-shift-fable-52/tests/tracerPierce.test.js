// A round that goes through zombies draws its tracer to the furthest zombie it hit when it stopped
// there, and on to the world when it went on to hit it.
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { createEvents } from '../src/core/events.js';
import { createCombat } from '../src/fx/combat.js';

function rig() {
  const events = createEvents();
  const spawns = [];
  const K = {
    spawn: (kind, x, y, z, vx, vy, vz, life) => spawns.push({ kind, x, y, z, vx, vy, vz, life }),
    cloud() {}, basis() {}, cone() {}, W: new Vector3(), rr: (a) => a, rng: { next: () => 0.5, int: (a) => a, range: (a) => a },
    floorBelow: () => 0, levelRay: () => ({ pos: [0, 1.5, -40] }), lights: { muzzle: { pos: new Vector3(), t0: 0 } },
    clock: { now: 0 }, decals: { addBlood() {} }, bloodAt() {}, KIND: { tracer: 'tracer', drop: 'drop' },
  };
  const combat = createCombat({ events }, { gore: 'full' }, K);
  // where the drawn streak ends, as a distance from the muzzle along -z (lead + life x speed)
  const end = () => {
    const s = spawns.filter((q) => q.kind === 'tracer').at(-1);
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    return -(s.z + (s.vz / speed) * s.life * speed);
  };
  const shoot = (weapon, zombies, world) => {
    events.emit('weapon:fire', { pos: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 }, weapon, pellets: 1, upgraded: true });
    for (const z of zombies) events.emit('hit:zombie', { id: z, pos: { x: 0, y: 1.5, z: -z }, source: 'bullet' });
    if (world) events.emit('hit:world', { pos: { x: 0, y: 1.5, z: -40 }, normal: { x: 0, y: 0, z: 1 }, surface: 'concrete' });
    combat.update(1 / 60);
    return end();
  };
  const shootOnly = (weapon, zombies) => {
    events.emit('weapon:fire', { pos: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 }, weapon, pellets: 1, upgraded: true });
    for (const z of zombies) events.emit('hit:zombie', { id: z, pos: { x: 0, y: 1.5, z: -z }, source: 'bullet' });
    combat.update(1 / 60);
  };
  const count = () => spawns.filter((q) => q.kind === 'tracer').length;
  return { shoot, shootOnly, count };
}

describe('tracer of a round through zombies', () => {
  it('stopped in the third of three: ends on the third', () => {
    expect(rig().shoot('rifle', [6, 7, 8], false)).toBeCloseTo(8, 1);
  });
  it('went on to the wall: ends on the wall', () => {
    expect(rig().shoot('rifle', [6, 7], true)).toBeCloseTo(40, 1);
  });
  it('no zombie hit: ends on the wall', () => {
    expect(rig().shoot('rifle', [], false)).toBeCloseTo(40, 1);
  });
  it('a round that does not go through (one hit, no world) ends on that zombie, not the wall behind', async () => {
    const { tuning } = await import('../src/game/tuning.js');
    tuning.weapons.table.__solid = { id: '__solid', pierce: 0, auto: false, range: 60 };
    try { expect(rig().shoot('__solid', [6], false)).toBeCloseTo(6, 1); } finally { delete tuning.weapons.table.__solid; }
  });
  it('the specials (no penetration) draw no tracer: the arc and the flare draw themselves', () => {
    const r = rig();
    expect(r.shoot('rifle', [6], false)).toBeCloseTo(6, 1);
    expect(r.count()).toBe(1);
    r.shootOnly('jumper', [6]);
    expect(r.count()).toBe(1);
  });
});
