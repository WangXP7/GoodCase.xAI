// Rounds through zombies standing in line: how many, how much damage each keeps, how far past the
// first, walls stopping them, and one report (points, blood, death direction) per zombie hit.
import { describe, it, expect } from 'vitest';
import { tuning } from '../src/game/tuning.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { createWeapon, penetrationScale, spreadDir } from '../src/weapon/firing.js';
import { WEAPONS, statsFor, createSlot } from '../src/weapon/defs.js';
import { pointsForHit } from '../src/game/economy.js';

const P = tuning.weapons.penetration;

// Zombies straight ahead (-z) of an eye at the origin, at the given distances, each with `health`.
// raycast finds the nearest live one in front of the origin; damage kills at 0 health (and takes
// it out of the line, as the manager does).
function line(dists, { health = 1e6, wall = null } = {}) {
  const events = createEvents();
  const hits = [], world = [], damaged = [];
  events.on('hit:zombie', (e) => hits.push(e));
  events.on('hit:world', (e) => world.push(e));
  const zs = dists.map((d, i) => ({ id: i + 1, d, health, alive: true }));
  const G = {
    params: {}, events, rng: createRng(7), time: { t: 0 }, input: { pressed: () => false },
    player: { eye: [0, 1.5, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true, alive: true, addRecoil() {}, addShake() {} },
    game: { state: 'playing' },
    zombies: {
      list: [],
      raycast(o, dir, max) {
        let best = null;
        for (const z of zs) {
          const dist = o[2] + z.d; // the eye looks down -z
          if (!z.alive || dist <= 1e-6 || dist > max) continue;
          if (!best || dist < best.dist) best = { id: z.id, part: 'torso', pos: [0, 1.5, -z.d], dist };
        }
        return best;
      },
      damage(id, amount, part, dir) {
        const z = zs.find((q) => q.id === id);
        damaged.push({ id, amount, dir });
        z.health -= amount;
        if (z.health <= 0) z.alive = false;
        return { killed: !z.alive, damage: amount, headshot: false };
      },
    },
    level: { raycast: (o, d, max) => (wall !== null && wall <= max ? { dist: wall, pos: [0, 1.5, -wall], normal: [0, 0, 1], surface: 'concrete' } : null) },
  };
  return { G, hits, world, damaged, zs };
}

// One shot from weapon `id` (upgraded when asked) at zombies at `dists`.
function shoot(id, dists, opts = {}) {
  const m = line(dists, opts);
  m.G.params.give = id === 'pistol' ? ['pistol'] : [id];
  const w = createWeapon(m.G, { createView: () => null });
  if (opts.upgraded) w.upgrade();
  w.fire();
  return m;
}

const amounts = (m) => m.damaged.map((d) => d.amount);
const ids = (m) => m.hits.map((h) => h.id);
const RIGHT = [5, 6, 7, 8, 9, 10, 11, 12, 13]; // nine zombies a metre apart from 5 m

describe('penetration tables', () => {
  it('every weapon has a penetration and pierce is its body count', () => {
    for (const id of Object.keys(WEAPONS)) {
      const d = WEAPONS[id];
      expect(d.penetration).toBeTruthy();
      expect(d.pierce).toBe(d.penetration.bodies);
    }
  });

  it('rifles and the LMG go furthest, the heavy rifle further still, pistols and the SMG a little', () => {
    const b = (id) => WEAPONS[id].penetration.bodies;
    expect(b('battleRifle')).toBeGreaterThan(b('lmg'));
    expect(b('lmg')).toBeGreaterThanOrEqual(b('rifle'));
    expect(b('rifle')).toBeGreaterThan(b('smg'));
    expect(b('smg')).toBeLessThanOrEqual(1);
    expect(b('pistol')).toBeLessThanOrEqual(1);
    expect(WEAPONS.pump.penetration.reach).toBeLessThan(2);
    expect(b('jumper')).toBe(0);
  });

  it('an upgrade goes one body further and keeps more', () => {
    for (const id of ['pistol', 'smg', 'rifle', 'lmg', 'battleRifle', 'pump']) {
      const base = WEAPONS[id].penetration;
      const slot = createSlot(id); slot.upgraded = true;
      const up = statsFor(slot);
      expect(up.penetration.bodies).toBe(base.bodies + 1);
      expect(up.penetration.keep).toBeGreaterThan(base.keep);
      expect(up.penetration.reach).toBeGreaterThan(base.reach);
      expect(up.pierce).toBe(up.penetration.bodies);
    }
  });

  it('penetrationScale: keep^n, 0 past the body count or the reach', () => {
    const pen = { bodies: 2, keep: 0.5, reach: 3 };
    expect(penetrationScale(0, 0, pen)).toBe(1);
    expect(penetrationScale(1, 1, pen)).toBe(0.5);
    expect(penetrationScale(2, 2, pen)).toBe(0.25);
    expect(penetrationScale(3, 2, pen)).toBe(0);
    expect(penetrationScale(1, 3.5, pen)).toBe(0);
  });

  it('spreadDir fills the array it is given', () => {
    const out = [0, 0, 0];
    expect(spreadDir([0, 0, -1], 1, createRng(1), out)).toBe(out);
    expect(Math.hypot(...out)).toBeCloseTo(1);
  });
});

describe('zombies in line, one metre apart, by weapon class', () => {
  const expectLine = (m, D, n) => {
    const k = D.penetration.keep;
    expect(ids(m)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    amounts(m).forEach((a, i) => expect(a).toBeCloseTo(D.damage * k ** i));
    expect(m.world).toHaveLength(0); // no wall: nothing to mark
  };

  it('pistol: through one more at half damage', () => expectLine(shoot('pistol', RIGHT), WEAPONS.pistol, 1 + P.pistol.bodies));
  it('revolver: three', () => expectLine(shoot('revolver', RIGHT), WEAPONS.revolver, 1 + P.revolver.bodies));
  it('SMG: two', () => expectLine(shoot('smg', RIGHT), WEAPONS.smg, 1 + P.smg.bodies));
  it('rifle: four', () => expectLine(shoot('rifle', RIGHT), WEAPONS.rifle, 1 + P.rifle.bodies));
  it('LMG: five', () => expectLine(shoot('lmg', RIGHT), WEAPONS.lmg, 1 + P.lmg.bodies));
  it('heavy rifle: six', () => expectLine(shoot('battleRifle', RIGHT), WEAPONS.battleRifle, 1 + WEAPONS.battleRifle.penetration.bodies));

  it('upgraded rifle: one more body, double damage, keeping more', () => {
    const slot = createSlot('rifle'); slot.upgraded = true;
    const D = statsFor(slot);
    const m = shoot('rifle', RIGHT, { upgraded: true });
    expect(D.damage).toBe(WEAPONS.rifle.damage * 2);
    expectLine(m, D, 1 + P.rifle.bodies + 1);
  });

  it('shotgun: each pellet into the second body, reported once per zombie with the damage summed', () => {
    const D = WEAPONS.pump;
    const m = shoot('pump', [5, 6, 7]);
    expect(ids(m)).toEqual([1, 2]);
    expect(m.hits[0].damage).toBeCloseTo(D.damage * D.pellets);
    expect(m.hits[1].damage).toBeCloseTo(D.damage * D.pellets * D.penetration.keep);
    expect(m.damaged).toHaveLength(D.pellets * 2);
  });

  it('shotgun: a short way only: a zombie two metres behind is not reached', () => {
    const m = shoot('pump', [5, 7]);
    expect(ids(m)).toEqual([1]);
  });

  it('the Jumper does not penetrate (it arcs)', () => {
    const m = shoot('jumper', [5, 6]);
    expect(m.damaged[0]).toMatchObject({ id: 1, amount: WEAPONS.jumper.damage });
    expect(m.hits.filter((h) => h.source === 'bullet').map((h) => h.id)).toEqual([1]);
  });
});

describe('reach and walls', () => {
  it('a rifle round reaches 8 m past the first zombie and no further', () => {
    const m = shoot('rifle', [5, 9, 12.5, 17]);
    expect(ids(m)).toEqual([1, 2, 3]);
  });

  it('a pistol round reaches 3 m past the first', () => {
    expect(ids(shoot('pistol', [5, 9]))).toEqual([1]);
    expect(ids(shoot('pistol', [5, 7.5]))).toEqual([1, 2]);
  });

  it('a wall between zombies stops the round and is marked', () => {
    const m = shoot('battleRifle', [5, 6, 7, 8], { wall: 6.5 });
    expect(ids(m)).toEqual([1, 2]);
    expect(m.world).toHaveLength(1);
  });

  it('a round used up on zombies leaves no mark on the wall behind them', () => {
    const m = shoot('smg', [5, 6, 7], { wall: 7.5 });
    expect(ids(m)).toEqual([1, 2]);
    expect(m.world).toHaveLength(0);
  });

  it('a wall in front stops every zombie behind it', () => {
    const m = shoot('lmg', [5, 6], { wall: 3 });
    expect(m.hits).toHaveLength(0);
    expect(m.world).toHaveLength(1);
  });
});

describe('every zombie hit is a full hit', () => {
  it('a rifle kills three in a row: three kill reports with the shot direction and kill points each, none for the fourth', () => {
    const health = WEAPONS.rifle.damage * 0.5; // the third takes 0.75^2 = 0.56 of the damage
    const m = shoot('rifle', [5, 6, 7, 8], { health });
    expect(ids(m)).toEqual([1, 2, 3, 4]);
    expect(m.hits.slice(0, 3).every((h) => h.killed)).toBe(true);
    expect(m.hits[3].killed).toBe(false); // 0.42 of the damage left for the fourth
    for (const h of m.hits) {
      expect(h).toMatchObject({ source: 'bullet', weapon: 'rifle' });
      expect(h.dir.z).toBeLessThan(-0.99); // shot down -z: dies falling away from the shooter
      expect(h.pos).toBeTruthy();
    }
    for (const d of m.damaged) expect(d.dir.z).toBeLessThan(-0.99);
    const pts = m.hits.reduce((a, h) => a + pointsForHit(h), 0);
    expect(pts).toBe(3 * tuning.points.kill); // the fourth was hit through the others: no hit points
  });
});
