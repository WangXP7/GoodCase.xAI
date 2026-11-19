import { describe, it, expect } from 'vitest';
import { buildGrid } from '../src/nav/grid.js';
import { createFlowField, createNav } from '../src/nav/flowfield.js';

const box = (x0, z0, x1, z1, y0 = 0, y1 = 2) => ({ min: [x0, y0, z0], max: [x1, y1, z1], surface: 'concrete' });
const BOUNDS = { min: [0, -1, 0], max: [10, 10, 10] };

// Walk an agent along the field; returns the visited points.
function follow(field, grid, start, steps = 600, speed = 0.05) {
  const p = [...start];
  const path = [[...p]];
  for (let i = 0; i < steps; i++) {
    const [dx, dz] = field.dir(p[0], p[1]);
    if (dx === 0 && dz === 0) break;
    p[0] += dx * speed; p[1] += dz * speed;
    path.push([...p]);
  }
  return path;
}

describe('buildGrid', () => {
  it('marks cells within 0.35 m of a collider unwalkable, others walkable', () => {
    const g = buildGrid([box(4, 4, 6, 6)], BOUNDS, 0.5);
    expect(g.walkable(5, 5)).toBe(false); // inside
    expect(g.walkable(6.2, 5)).toBe(false); // cell centre 6.25: 0.25 m from the face
    expect(g.walkable(5, 3.8)).toBe(false); // cell centre 3.75: 0.25 m from the face
    expect(g.walkable(6.7, 5)).toBe(true); // cell centre 6.75: 0.75 m away
    expect(g.walkable(6.2, 6.2)).toBe(true); // diagonal corner cell centre (6.25,6.25): 0.354 m from the corner
    expect(g.walkable(6.7, 6.7)).toBe(true); // diagonal: ~1.06 m away
    expect(g.walkable(1, 1)).toBe(true);
  });

  it('only colliders in the 0.1-1.8 m band block walking', () => {
    const g = buildGrid([
      box(1, 1, 3, 3, -0.3, 0.05), // ground slab / kerb top below 0.1
      box(6, 6, 8, 8, 2.0, 3.0), // canopy above 1.8
      box(1, 6, 3, 8, 1.0, 1.2), // waist-height rail
    ], BOUNDS, 0.5);
    expect(g.walkable(2, 2)).toBe(true);
    expect(g.walkable(7, 7)).toBe(true);
    expect(g.walkable(2, 7)).toBe(false);
  });

  it('is unwalkable outside bounds', () => {
    const g = buildGrid([], BOUNDS, 0.5);
    expect(g.walkable(-0.1, 5)).toBe(false);
    expect(g.walkable(5, 10.1)).toBe(false);
    expect(g.walkable(9.9, 9.9)).toBe(true);
  });
});

describe('createFlowField', () => {
  it('leads around a wall through the gap', () => {
    // Wall at x=5 from z=0 to z=7; the gap is z 7..10.
    const g = buildGrid([box(4.9, 0, 5.1, 7)], BOUNDS, 0.5);
    const f = createFlowField(g);
    f.setTarget(8, 2);
    const path = follow(f, g, [2, 2]);
    const end = path[path.length - 1];
    expect(Math.hypot(end[0] - 8, end[1] - 2)).toBeLessThan(0.3);
    for (const [x, z] of path) expect(g.walkable(x, z)).toBe(true);
    const crossing = path.find(([x]) => x > 5);
    expect(crossing[1]).toBeGreaterThan(7);
    // Distance is the path length around the wall, not the straight line (6 m).
    expect(f.dist(2, 2)).toBeGreaterThan(10);
    expect(f.dist(2, 2)).toBeLessThan(15);
  });

  it('dist is Infinity inside a sealed box; dir gathers there at the cell nearest the target', () => {
    const g = buildGrid([
      box(3, 3, 7, 3.2), box(3, 6.8, 7, 7), box(3, 3, 3.2, 7), box(6.8, 3, 7, 7),
    ], BOUNDS, 0.5);
    const f = createFlowField(g);
    f.setTarget(1, 1);
    expect(f.dist(5, 5)).toBe(Infinity);
    // cut off from the target, an agent goes to the corner of its box nearest it and stops
    const path = follow(f, g, [5, 5], 400);
    const end = path[path.length - 1];
    expect(Math.hypot(end[0] - 3.75, end[1] - 3.75)).toBeLessThan(0.1);
    expect(f.dir(end[0], end[1])).toEqual([0, 0]);
    for (const [x, z] of path) expect(g.walkable(x, z)).toBe(true);
    expect(Number.isFinite(f.dist(9, 9))).toBe(true);
  });

  it('does not cut corners diagonally between two blocked cells', () => {
    // 1 m cells, no clearance: cells (0,1) and (1,0) are blocked, so (0,0) only touches (1,1) by a corner.
    const tiny = { min: [0, -1, 0], max: [3, 5, 3] };
    const g = buildGrid([box(0, 1, 1, 2), box(1, 0, 2, 1)], tiny, 1, { clearance: 0 });
    expect(g.walkable(0.5, 1.5)).toBe(false);
    expect(g.walkable(1.5, 0.5)).toBe(false);
    const f = createFlowField(g);
    f.setTarget(0.5, 0.5);
    expect(f.dist(1.5, 1.5)).toBe(Infinity);
    // An open diagonal is still taken, at sqrt(2) per step.
    f.setTarget(2.5, 2.5);
    expect(f.dist(1.5, 1.5)).toBeCloseTo(Math.SQRT2, 3);
  });

  it('snaps a target on an unwalkable cell (car roof) to the nearest walkable cell', () => {
    const car = box(4, 4.5, 6, 6.5, 0, 1.5);
    const g = buildGrid([car], BOUNDS, 0.5);
    const f = createFlowField(g);
    f.setTarget(5, 4.6); // standing on the roof near the z=4.5 edge
    expect(Number.isFinite(f.dist(1, 1))).toBe(true);
    // Zombies gather just below that edge, not on the far side and not frozen.
    const path = follow(f, g, [5, 1]);
    const end = path[path.length - 1];
    expect(Math.abs(end[0] - 5)).toBeLessThan(0.5);
    expect(end[1]).toBeGreaterThan(3.4);
    expect(end[1]).toBeLessThan(4.5);
    expect(path.length).toBeGreaterThan(10);
  });

  it('dir from inside a blocked cell steers toward walkable ground', () => {
    const g = buildGrid([box(4, 4, 6, 6)], BOUNDS, 0.5);
    const f = createFlowField(g);
    f.setTarget(8, 5);
    const [dx, dz] = f.dir(6.2, 5); // zombie pressed against the face, inside the clearance band
    expect(dx).toBeGreaterThan(0.5);
    expect(Math.hypot(dx, dz)).toBeCloseTo(1, 5);
    expect(Number.isFinite(f.dist(6.2, 5))).toBe(true);
  });

  it('returns zero and Infinity before any target and outside the grid', () => {
    const f = createFlowField(buildGrid([], BOUNDS, 0.5));
    expect(f.dir(5, 5)).toEqual([0, 0]);
    expect(f.dist(5, 5)).toBe(Infinity);
    f.setTarget(5, 5);
    expect(f.dist(50, 50)).toBe(Infinity);
    expect(f.dir(50, 50)).toEqual([0, 0]);
  });

  it('agents from 24 starts on a cluttered map arrive without entering blocked cells', () => {
    const cols = [];
    for (let i = 0; i < 40; i++) {
      const x = -18 + ((i * 37) % 36), z = -18 + ((i * 53) % 36);
      cols.push(box(x, z, x + 0.5 + (i % 4), z + 0.3 + (i % 3) * 1.5));
    }
    const g = buildGrid(cols, { min: [-20, -1, -20], max: [20, 10, 20] }, 0.5);
    const f = createFlowField(g);
    f.setTarget(0.3, 0.2);
    let arrived = 0;
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const start = [Math.cos(ang) * 17, Math.sin(ang) * 17];
      if (!g.walkable(start[0], start[1]) || f.dist(start[0], start[1]) === Infinity) continue;
      const path = follow(f, g, start, 4000, 0.05);
      for (const [x, z] of path) expect(g.walkable(x, z)).toBe(true);
      const end = path[path.length - 1];
      if (f.dist(end[0], end[1]) < 0.5) arrived++;
      else throw new Error(`agent ${a} stuck at ${end} dist ${f.dist(end[0], end[1])}`);
    }
    expect(arrived).toBeGreaterThan(15);
  });

  it('solves a 100x100 m forecourt-sized grid in under 10 ms', () => {
    const big = { min: [-50, -1, -50], max: [50, 20, 50] };
    const cols = [];
    for (let i = 0; i < 60; i++) {
      const x = -45 + ((i * 37) % 90), z = -45 + ((i * 53) % 90);
      cols.push(box(x, z, x + 1 + (i % 4), z + 1 + (i % 3)));
    }
    const g = buildGrid(cols, big, 0.5);
    const f = createFlowField(g);
    for (let i = 0; i < 5; i++) f.setTarget(i, -i); // warm up the JIT
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) f.setTarget((i % 7) * 3 - 10, (i % 5) * 4 - 10);
    const ms = (performance.now() - t0) / runs;
    expect(ms).toBeLessThan(10);
  });
});

describe('createNav (G.nav)', () => {
  const makeG = (level) => ({ level, player: { pos: [8, 0, 2] }, time: { t: 0, dt: 0, frame: 0 } });

  it('builds lazily from G.level and exposes the contract', () => {
    const G = makeG({ colliders: [box(4.9, 0, 5.1, 7)], bounds: BOUNDS });
    const nav = createNav(G);
    expect(typeof nav.buildGrid).toBe('function');
    expect(typeof nav.createFlowField).toBe('function');
    G.nav = nav;
    nav.update(0.016);
    expect(nav.grid.walkable(5, 3)).toBe(false);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    expect(nav.field.dir(2, 2)[1]).toBeGreaterThan(0); // heads for the gap first
  });

  it('works as an open field with the stub level and no-ops without a level or player', () => {
    const G = makeG({ colliders: [], bounds: { min: [-50, -1, -50], max: [50, 20, 50] } });
    const nav = createNav(G);
    nav.update(0.016);
    const [dx, dz] = nav.field.dir(0, 2);
    expect(dx).toBeGreaterThan(0.9);
    expect(Math.abs(dz)).toBeLessThan(0.3);

    const bare = createNav({ time: { t: 0 } });
    expect(() => bare.update(0.016)).not.toThrow();
    expect(bare.field.dir(1, 1)).toEqual([0, 0]);
    expect(bare.field.dist(1, 1)).toBe(Infinity);
  });

  it('retargets from G.player.pos at most 4 times per second', () => {
    const G = makeG({ colliders: [], bounds: BOUNDS });
    const nav = createNav(G);
    nav.update(0);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    G.player.pos = [2, 0, 8];
    G.time.t = 0.1; nav.update(0.1);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5); // too soon: still the old target
    G.time.t = 0.26; nav.update(0.16);
    expect(nav.field.dist(2, 8)).toBeLessThan(0.5);
    expect(nav.field.dist(8, 2)).toBeGreaterThan(5);
  });

  it('retargets lazily from field.dir even if update is never called', () => {
    const G = makeG({ colliders: [], bounds: BOUNDS });
    const nav = createNav(G);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    G.player.pos = [2, 0, 8];
    G.time.t = 1;
    expect(nav.field.dist(2, 8)).toBeLessThan(0.5);
  });

  it('rebuild() picks up new colliders', () => {
    const G = makeG({ colliders: [], bounds: BOUNDS });
    const nav = createNav(G);
    nav.update(0);
    expect(nav.grid.walkable(5, 5)).toBe(true);
    G.level.colliders = [box(4, 4, 6, 6)];
    nav.rebuild();
    expect(nav.grid.walkable(5, 5)).toBe(false);
    expect(Number.isFinite(nav.field.dist(1, 1))).toBe(true);
  });

  it('reads G.player.pos as a {x,y,z} object (three.js Vector3) as well as an array', () => {
    const G = { level: { colliders: [], bounds: BOUNDS }, player: { pos: { x: 8, y: 0, z: 2 } }, time: { t: 0 } };
    const nav = createNav(G);
    nav.update(0);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    expect(nav.field.dir(2, 2)[0]).toBeGreaterThan(0.9);
    G.player.pos = [2, 0, 8];
    G.time.t = 1; nav.update(1);
    expect(nav.field.dist(2, 8)).toBeLessThan(0.5);
  });

  it('keeps the previous target when the player position is not finite, then recovers', () => {
    const G = makeG({ colliders: [], bounds: BOUNDS });
    const nav = createNav(G);
    nav.update(0);
    G.player.pos = { x: NaN, y: 0, z: 3 };
    G.time.t = 1; nav.update(1);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    expect(nav.field.dir(2, 2)[0]).toBeGreaterThan(0.9);
    G.player.pos = [undefined, 0, 3];
    G.time.t = 2; nav.update(1);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
    G.player.pos = { x: 2, y: 0, z: 8 };
    G.time.t = 2.01; nav.update(0.01); // the failed attempts did not use up the 4 Hz slot
    expect(nav.field.dist(2, 8)).toBeLessThan(0.5);
  });

  it('rebuild() before the level exists retries once it does', () => {
    const G = { player: { pos: [8, 0, 2] }, time: { t: 0 } };
    const nav = createNav(G);
    nav.rebuild();
    nav.update(0);
    expect(nav.grid).toBe(null);
    expect(nav.field.dir(2, 2)).toEqual([0, 0]);
    G.level = { colliders: [box(4.9, 0, 5.1, 7)], bounds: BOUNDS };
    expect(nav.grid.walkable(5, 3)).toBe(false);
    expect(nav.field.dist(8, 2)).toBeLessThan(0.5);
  });
});

describe('point shapes and non-finite input', () => {
  const g = buildGrid([box(4, 4, 6, 6)], BOUNDS, 0.5);

  it('walkable, setTarget, dir and dist accept (x,z), [x,y,z] and {x,y,z}', () => {
    expect(g.walkable([5, 0, 5])).toBe(false);
    expect(g.walkable({ x: 1, y: 0, z: 1 })).toBe(true);
    const f = createFlowField(g);
    f.setTarget({ x: 8, y: 1.7, z: 5 });
    expect(f.dist(8, 5)).toBeLessThan(0.01);
    expect(f.dist([2, 0, 5])).toBeCloseTo(f.dist(2, 5), 9);
    expect(f.dir({ x: 2, y: 0, z: 2 })).toEqual(f.dir(2, 2));
    f.setTarget([2, 0, 8]);
    expect(f.dist(2, 8)).toBeLessThan(0.01);
  });

  it('ignores a NaN target and keeps the previous one; NaN queries are inert', () => {
    const f = createFlowField(g);
    f.setTarget(8, 5);
    expect(f.setTarget(NaN, 5)).toBe(false);
    expect(f.setTarget({ x: 1, y: 0, z: Infinity })).toBe(false);
    expect(f.setTarget(undefined)).toBe(false);
    expect(f.dist(8, 5)).toBeLessThan(0.01);
    expect(f.dir(2, 2)[0]).toBeGreaterThan(0.5);
    expect(f.dir(NaN, 2)).toEqual([0, 0]);
    expect(f.dist({ x: 2, z: NaN })).toBe(Infinity);
    expect(g.walkable(NaN, NaN)).toBe(false);
  });
});

describe('dirInto (allocation-free dir)', () => {
  const walls = [{ min: [-0.25, 0, -10], max: [0.25, 2, 2], surface: 'concrete' }];
  const bounds = { min: [-10, 0, -10], max: [10, 3, 10] };
  it('writes the same direction as dir() into the caller\'s array, everywhere on a map with a wall', () => {
    const f = createFlowField(buildGrid(walls, bounds, 0.5));
    f.setTarget(6, -6);
    const out = new Float64Array(2);
    for (let x = -9.3; x < 9.5; x += 1.3) for (let z = -9.1; z < 9.5; z += 1.7) {
      const d = f.dir(x, z);
      expect(f.dirInto(x, z, out)).toBe(out);
      expect(out[0]).toBe(d[0]); expect(out[1]).toBe(d[1]);
    }
  });
  it('zeroes a dirty out array when there is no direction (no target, outside, NaN)', () => {
    const f = createFlowField(buildGrid(walls, bounds, 0.5));
    const out = [7, 7];
    f.dirInto(1, 1, out); expect(out).toEqual([0, 0]);
    f.setTarget(6, -6);
    out[0] = 7; f.dirInto(500, 0, out); expect(out).toEqual([0, 0]);
    out[1] = 7; f.dirInto(NaN, 0, out); expect(out).toEqual([0, 0]);
  });
  it('G.nav.field.dirInto follows the player like field.dir', () => {
    const G = { level: { colliders: walls, bounds }, player: { pos: [6, 0, -6] }, time: { t: 0 } };
    const nav = createNav(G);
    const out = [0, 0];
    nav.field.dirInto(-6, -6, out);
    expect(out).toEqual(nav.field.dir(-6, -6));
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1);
  });
});

describe('createNav: ground the player can step onto is walkable', () => {
  it('a 0.15 m pavement slab does not block; a 0.5 m planter on it does', () => {
    const bounds = { min: [-10, 0, -10], max: [10, 3, 10] };
    const colliders = [
      { min: [-10, 0, -10], max: [10, 0.15, -5], surface: 'concrete' }, // pavement along the north side
      { min: [-10, 0, -10.5], max: [10, 4, -9.5], surface: 'concrete' }, // the wall behind it
      { min: [2, 0.15, -8], max: [3, 0.65, -7], surface: 'concrete' }, // planter standing on the pavement
    ];
    const G = { level: { colliders, bounds }, player: { pos: [0, 0.15, -8.6] }, time: { t: 0 } };
    const nav = createNav(G);
    expect(nav.grid.walkable(0, -8.6)).toBe(true); // where the player stands, at the wall
    expect(nav.grid.walkable(2.5, -7.5)).toBe(false);
    expect(nav.field.dist(0, 5)).toBeLessThan(15); // reachable from the lot: zombies come all the way
    const d = nav.field.dir(0, -4);
    expect(d[1]).toBeLessThan(-0.9); // from the kerb line, straight on up the pavement
  });
});


// ---- layers, stairs, doors, links ----------------------------------------------------
// A walkway at 3.04 m along the north wall (x 2..18, z 2..3.6), reached by a 16-step stair beside it
// (foot at x 10, rising toward +x, landing x 14.5..15.7), a rail along the walkway's edge with an
// opening at the landing, and rails on the stair's open side and end.
const UP = 3.04;
function walkwayMap() {
  const s = { ...box(0, 0, 0, 0), stair: true };
  const cols = [
    box(0, 1.7, 20, 2, 0, 6.5), // the building behind the walkway
    box(2, 2, 18, 3.6, 2.84, UP), // walkway slab
    box(2, 3.6, 14.5, 3.7, UP, UP + 1.2), box(15.7, 3.6, 18, 3.7, UP, UP + 1.2), // its rail, open at the landing
    box(15.7, 3.7, 15.8, 5.1, 0, UP + 1.2), // landing end rail
  ];
  for (let k = 0; k < 16; k++) {
    const x0 = 10 + k * 0.3, x1 = k < 15 ? x0 + 0.3 : 15.7, top = (k + 1) * 0.19;
    cols.push({ ...s, min: [x0, 0, 3.7], max: [x1, top, 5.1] });
    cols.push(box(x0, 5.1, x1, 5.2, 0, top + 1.1)); // stair rail
  }
  const opts = {
    layers: [{ y: 0 }, { y: UP, floors: [{ x0: 2, z0: 2, x1: 18, z1: 3.6 }] }],
    ramps: [{ foot: [10, 4.4], dir: [1, 0], width: 1.4, steps: 16, rise: 0.19, tread: 0.3, landing: 1.2 }],
  };
  return { cols, opts, bounds: { min: [0, -1, 0], max: [20, 10, 20] } };
}
// walk an agent that tracks its own floor, as a zombie on the stairs would
function follow3(field, grid, start, layer0, steps = 3000, speed = 0.05) {
  const p = [start[0], start[1]];
  let layer = layer0, y = grid.floorAt(p[0], p[1], layer), len = 0;
  const out = [0, 0];
  for (let i = 0; i < steps; i++) {
    field.dirInto(p[0], p[1], out, layer);
    if (out[0] === 0 && out[1] === 0) break;
    p[0] += out[0] * speed; p[1] += out[1] * speed; len += speed;
    layer = grid.layerAt(p[0], y, p[1]);
    const f = grid.floorAt(p[0], p[1], layer);
    if (Number.isFinite(f)) y = f;
  }
  return { x: p[0], z: p[1], layer, y, len };
}

describe('layered grid', () => {
  it('has a walkway layer over walkable ground, joined by the stair', () => {
    const { cols, opts, bounds } = walkwayMap();
    const g = buildGrid(cols, bounds, 0.5, { bandMin: 0.32, ...opts });
    expect(g.layers).toBe(2);
    expect(g.layerAt(5, UP, 2.8)).toBe(1);
    expect(g.layerAt(5, 0, 2.8)).toBe(0);
    expect(g.walkable(5, 2.75, 0)).toBe(true); // under the walkway
    expect(g.walkable(5, 2.75, 1)).toBe(true); // on it
    expect(g.walkable(5, 8, 1)).toBe(false); // no upper floor over the yard
    expect(g.floorAt(5, 2.75, 1)).toBeCloseTo(UP, 5);
    expect(g.floorAt(11.75, 4.25, 0)).toBeCloseTo(0.19 * 6, 5); // the cell over the sixth step
  });

  it('a target on the walkway is reached by the stairs, and the path is about the hand-measured route', () => {
    const { cols, opts, bounds } = walkwayMap();
    const g = buildGrid(cols, bounds, 0.5, { bandMin: 0.32, ...opts });
    const f = createFlowField(g);
    f.setTarget(5, 2.75, UP);
    // foot of the stair, up it, onto the walkway at the landing, west along it
    const route = Math.hypot(10 - 5, 4.4 - 8) + (15.1 - 10) + (4.4 - 2.75) + (15.1 - 5);
    const d = f.dist(5, 8, 0);
    expect(Math.abs(d - route) / route).toBeLessThan(0.1);
    const end = follow3(f, g, [5, 8], 0);
    expect(end.layer).toBe(1);
    expect(Math.hypot(end.x - 5, end.z - 2.75)).toBeLessThan(0.5);
    expect(Math.abs(end.len - route) / route).toBeLessThan(0.15);
  });

  it('a zombie under the walkway has not arrived: it is sent round by the stairs', () => {
    const { cols, opts, bounds } = walkwayMap();
    const g = buildGrid(cols, bounds, 0.5, { bandMin: 0.32, ...opts });
    const f = createFlowField(g);
    f.setTarget(5, 2.75, UP);
    expect(f.dist(5, 2.75, 0)).toBeGreaterThan(15);
    const d = f.dir(5, 2.75, 0);
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 5);
    expect(f.dist(5, 2.75, 1)).toBeLessThan(0.1);
  });
});

describe('doors and links', () => {
  // two rooms split by a wall at x 10; a doorway z 9..11 shut by a door collider
  function rooms() {
    const door = { ...box(10, 9, 10.3, 11, 0, 2.5), door: 'd1' };
    const cols = [box(10, 0, 10.3, 9, 0, 3), box(10, 11, 10.3, 20, 0, 3), door];
    return { cols, door, bounds: { min: [0, -1, 0], max: [20, 10, 20] } };
  }
  it('with the door shut a zombie has dist Infinity and gathers at the nearest reachable cell', () => {
    const { cols, bounds } = rooms();
    const g = buildGrid(cols, bounds, 0.5);
    const f = createFlowField(g);
    f.setTarget(15, 10);
    expect(f.dist(3, 3)).toBe(Infinity);
    const path = follow(f, g, [3, 3], 2000);
    const end = path[path.length - 1];
    expect(end[0]).toBeGreaterThan(9.0); // against the door
    expect(Math.abs(end[1] - 10)).toBeLessThan(0.8);
    for (const [x, z] of path) expect(g.walkable(x, z)).toBe(true);
  });
  it('after setBlocked clears the doorway and invalidate(), the next dir leads through it', () => {
    const { cols, door, bounds } = rooms();
    const g = buildGrid(cols, bounds, 0.5);
    const f = createFlowField(g);
    f.setTarget(15, 10);
    door.off = true;
    g.setBlocked({ x0: 10, z0: 9, x1: 10.3, z1: 11 }, false);
    expect(g.walkable(10.15, 10)).toBe(true);
    expect(g.walkable(10.15, 9.25)).toBe(false); // the jamb's clearance stays blocked
    expect(f.dist(3, 3)).toBe(Infinity); // not until the field is told
    f.invalidate();
    expect(f.dist(3, 3)).toBeLessThan(20);
    const path = follow(f, g, [3, 3], 4000);
    const end = path[path.length - 1];
    expect(Math.hypot(end[0] - 15, end[1] - 10)).toBeLessThan(0.1);
    // and shut again
    door.off = false;
    g.setBlocked({ x0: 10, z0: 9, x1: 10.3, z1: 11 }, true);
    f.invalidate();
    expect(f.dist(3, 3)).toBe(Infinity);
  });
  it('a window link is used only while open() is true, and next() reports it one cell before', () => {
    let open = false;
    const cols = [box(10, 0, 10.3, 20, 0, 3)];
    const links = [{ id: 'w1', kind: 'window', from: [9.25, 10.25, 0], to: [11.25, 10.25, 0], open: () => open }];
    const g = buildGrid(cols, { min: [0, -1, 0], max: [20, 10, 20] }, 0.5, { links });
    expect(g.links.length).toBe(1);
    const f = createFlowField(g);
    f.setTarget(15, 10);
    expect(f.dist(3, 10)).toBe(Infinity);
    open = true;
    f.invalidate();
    const d = f.dist(3, 10);
    expect(d).toBeGreaterThan(11.5);
    expect(d).toBeLessThan(16);
    expect(f.next(9.25, 10.25, 0)).toMatchObject({ link: links[0] }); // at the window
    expect(f.next(8.75, 10.25, 0)).toMatchObject({ link: links[0] }); // one cell before
    expect(f.next(5, 10.25, 0)).toBe(null);
    // on the far side the zombie is let through: the direction from the sill points inside
    const dd = f.dir(9.25, 10.25, 0);
    expect(dd[0]).toBeGreaterThan(0.9);
    open = false;
    f.invalidate();
    expect(f.dist(3, 10)).toBe(Infinity);
    expect(f.next(9.25, 10.25, 0)).toBe(null);
  });
});

describe('dirInto with layers', () => {
  it('returns the same values as dir into the caller\'s array, on both layers', () => {
    const { cols, opts, bounds } = walkwayMap();
    const g = buildGrid(cols, bounds, 0.5, { bandMin: 0.32, ...opts });
    const f = createFlowField(g);
    f.setTarget(5, 2.75, UP);
    const out = new Float64Array(2);
    for (let x = 0.25; x < 20; x += 1.5) for (let z = 0.25; z < 20; z += 1.5) for (const L of [0, 1]) {
      const r = f.dirInto(x, z, out, L);
      expect(r).toBe(out);
      const d = f.dir(x, z, L);
      expect(out[0]).toBe(d[0]); expect(out[1]).toBe(d[1]);
    }
  });
  it('a full solve of the 90 x 70 m two-layer grid takes under 15 ms in node', () => {
    const cols = [];
    for (let i = 0; i < 300; i++) {
      const x = -23 + ((i * 37) % 88), z = -45 + ((i * 53) % 68);
      cols.push(box(x, z, x + 0.5 + (i % 4), z + 0.3 + (i % 3) * 1.5));
    }
    const floors = [{ x0: 27, z0: -38, x1: 60, z1: -36.4 }, { x0: 58.4, z0: -38, x1: 60, z1: -12 }, { x0: 39, z0: -44, x1: 44, z1: -38 }];
    const g = buildGrid(cols, { min: [-23, -2, -45], max: [67, 14, 25] }, 0.5, { bandMin: 0.32, layers: [{ y: 0 }, { y: UP, floors }] });
    const f = createFlowField(g);
    for (let i = 0; i < 5; i++) f.setTarget(i, -i); // warm up the JIT
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) f.setTarget((i % 7) * 9 - 10, (i % 5) * 9 - 30);
    expect((performance.now() - t0) / runs).toBeLessThan(15);
  });
});
