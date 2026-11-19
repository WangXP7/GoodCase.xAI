import { describe, it, expect, beforeAll } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { buildForecourt } from '../src/level/forecourt.js';
import { createAtlas } from '../src/level/atlas.js';
import { createCollision, STEP_HEIGHT } from '../src/level/collision.js';
import { createMaskPainter } from '../src/level/groundMask.js';
import { paintGroundMask } from '../src/level/props/ground.js';
import * as L from '../src/level/layout.js';
import { buildGrid } from '../src/nav/grid.js';
import { tuning } from '../src/game/tuning.js';
import { buildWorld, surfaceAt as worldSurfaceAt } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';

const R = tuning.player.radius;
const H = 1.8;

let level;
let col;
beforeAll(() => {
  const rng = createRng(1).fork('level');
  level = buildForecourt({ rng, atlas: createAtlas(rng.fork('atlas')) });
  col = createCollision(level.colliders, { surfaceAt: L.surfaceAt });
}, 60000);

// walk in a straight line in small steps, the way the player controller does
function walk(from, dir, metres, step = 0.07) {
  let p = from.slice();
  let onGround = true;
  for (let d = 0; d < metres; d += step) {
    const r = col.moveCapsule(p, R, H, [dir[0] * step, -0.02, dir[2] * step]);
    p = r.pos; onGround = r.onGround;
  }
  return { pos: p, onGround };
}

// cells of the nav grid reachable from a point (8-connected, no corner cutting)
function reachable(grid, x, z) {
  const start = grid.index(x, z);
  const seen = new Uint8Array(grid.nx * grid.nz);
  if (start < 0 || grid.blocked[start]) return seen;
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const k = q.pop();
    const i = k % grid.nx, j = (k - i) / grid.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= grid.nx || b >= grid.nz) continue;
      const n = b * grid.nx + a;
      if (!seen[n] && !grid.blocked[n]) { seen[n] = 1; q.push(n); }
    }
  }
  return seen;
}

describe('level collision', () => {
  it('colliders are well-formed axis-aligned boxes with known surfaces', () => {
    expect(level.colliders.length).toBeGreaterThan(100);
    const surfaces = new Set(['asphalt', 'concrete', 'metal', 'glass', 'flesh', 'cloth', 'dirt']);
    for (const b of level.colliders) {
      for (let a = 0; a < 3; a++) {
        expect(Number.isFinite(b.min[a]) && Number.isFinite(b.max[a])).toBe(true);
        expect(b.max[a]).toBeGreaterThan(b.min[a]);
      }
      expect(surfaces.has(b.surface)).toBe(true);
    }
  });

  it('a ray down from 10 m above the player start hits asphalt at y = 0', () => {
    const [x, , z] = L.playerStart.pos;
    const hit = col.raycast([x, 10, z], [0, -1, 0], 50);
    expect(hit).not.toBeNull();
    expect(hit.surface).toBe('asphalt');
    expect(hit.pos[1]).toBeCloseTo(0, 6);
    expect(hit.dist).toBeCloseTo(10, 6);
    expect(hit.normal).toEqual([0, 1, 0]);
  });

  it('raycast takes {x,y,z}, returns arrays, reports the face it hit and respects maxDist', () => {
    // the red saloon at the pumps: centre (-8.4, 1.62), lying east-west; shoot it from the south
    const hit = col.raycast({ x: -8.4, y: 0.6, z: 8 }, { x: 0, y: 0, z: -1 }, 30);
    expect(hit.surface).toBe('metal');
    expect(Array.isArray(hit.pos)).toBe(true);
    expect(hit.normal).toEqual([0, 0, 1]);
    expect(hit.pos[2]).toBeCloseTo(1.62 + 0.91, 1);
    expect(col.raycast([-8.4, 0.6, 8], [0, 0, -1], 3)).toBeNull();
    // over the roof of the car there is the canopy
    expect(col.raycast([-8.4, 2.5, 1.6], [0, 1, 0], 10).pos[1]).toBeCloseTo(L.CANOPY.under, 6);
  });

  it('moveCapsule walking into a car stops at its side and slides along it', () => {
    const start = [-8.4, 0, 6];
    const blocked = walk(start, [0, 0, -1], 6);
    expect(blocked.pos[2]).toBeCloseTo(1.62 + 0.91 + R, 1); // stopped a radius short of the door side
    expect(blocked.pos[0]).toBeCloseTo(-8.4, 3);
    // pushing diagonally keeps the body out and carries it along the car
    const slid = walk(blocked.pos, [Math.SQRT1_2, 0, -Math.SQRT1_2], 1.2);
    expect(slid.pos[0]).toBeGreaterThan(blocked.pos[0] + 0.6);
    expect(slid.pos[2]).toBeGreaterThan(1.62 + 0.91 + R - 0.02);
  });

  it('moveCapsule does not let the body through a car parked at an angle', () => {
    // the hatchback at (-14.5, 10.5), yaw 0.45: cross its position from every side
    for (let a = 0; a < 8; a++) {
      const dir = [Math.cos((a * Math.PI) / 4), 0, Math.sin((a * Math.PI) / 4)];
      const from = [-14.5 - dir[0] * 5, 0, 10.5 - dir[2] * 5];
      const end = walk(from, dir, 10);
      const along = (end.pos[0] - from[0]) * dir[0] + (end.pos[2] - from[2]) * dir[2];
      const side = Math.abs((end.pos[0] - from[0]) * -dir[2] + (end.pos[2] - from[2]) * dir[0]);
      // either stopped in front of it, or was deflected round it: never straight through
      expect(along < 5 || side > 0.6).toBe(true);
    }
  });

  it('moveCapsule leaves its inputs alone and accepts {x,y,z}', () => {
    const pos = [1, 0, 12];
    const delta = [0.05, 0, 0.05];
    const r = col.moveCapsule(pos, R, H, delta);
    expect(pos).toEqual([1, 0, 12]);
    expect(delta).toEqual([0.05, 0, 0.05]);
    expect(r.pos).not.toBe(pos);
    expect(r.pos[0]).toBeCloseTo(1.05, 6);
    expect(r.onGround).toBe(true);
    const o = col.moveCapsule({ x: 1, y: 0, z: 12 }, R, H, { x: 0.05, y: 0, z: 0 });
    expect(Array.isArray(o.pos)).toBe(true);
    expect(o.pos[0]).toBeCloseTo(1.05, 6);
  });

  it('kerbs and pump islands are stepped onto; a pump is not walked through', () => {
    expect(0.18).toBeLessThan(STEP_HEIGHT);
    // onto the store pavement from the lot
    const up = walk([-6, 0, -15], [0, 0, -1], 3.5);
    expect(up.pos[1]).toBeCloseTo(0.15, 3);
    expect(up.onGround).toBe(true);
    // across island 1 (centre -7.5, -6.5) between its dispenser and the column: up and down again
    const over = walk([-8.4, 0, -4.5], [0, 0, -1], 4);
    expect(over.pos[2]).toBeLessThan(-7.6);
    expect(over.pos[1]).toBeCloseTo(0, 3);
    // straight at the dispenser (centre x = -9.25): stopped at the kerb side of it
    const pump = walk([-9.25, 0, -4.5], [0, 0, -1], 4);
    expect(pump.pos[2]).toBeGreaterThan(-6.5 + 0.3);
  });

  it('a car gives no footing: a body dropped on the bonnet or the roof slides off its flank to the ground', () => {
    // the saloon faces west (nose at x = -10.76): above its bonnet, and above its roof
    for (const start of [[-10.2, 1.6, 1.62], [-8.2, 2.2, 1.7]]) {
      let p = start.slice();
      let onGround = false; let perched = 0; let top = 0;
      for (let i = 0; i < 400 && !onGround; i++) {
        ({ pos: p, onGround } = col.moveCapsule(p, R, H, [0, -0.03, 0]));
        if (!onGround && p[1] > STEP_HEIGHT && p[1] < start[1] - 0.2) { perched++; top = Math.max(top, p[1]); }
      }
      expect(onGround).toBe(true); // and never while it was on the car: there is nothing to jump from
      expect(p[1]).toBeLessThanOrEqual(0.2); // the tarmac, or the pump island beside the car
      expect(Math.abs(p[2] - 1.62)).toBeGreaterThan(0.8); // beside the car, not on it
      expect(perched).toBeLessThan(90); // off within a second and a half
    }
  });

  it('a slip box is never a floor, even when it is low enough to step onto', () => {
    const slip = { c: [0, 0], side: [0, 1] };
    const c2 = createCollision([{ min: [-1, 0, -1], max: [1, 0.2, 1], surface: 'metal', slip }]);
    let p = [0, 0.6, 0.3]; let onGround = false;
    for (let i = 0; i < 200 && !onGround; i++) ({ pos: p, onGround } = c2.moveCapsule(p, R, H, [0, -0.03, 0]));
    expect(onGround).toBe(true);
    expect(p[1]).toBe(0);
    expect(p[2]).toBeGreaterThan(1); // carried off the +z side, the nearer one
    expect(p[0]).toBe(0);
  });

  it('a ceiling stops a rising body', () => {
    const r = col.moveCapsule([-2, L.CANOPY.under - H - 0.05, -3.5], R, H, [0, 0.4, 0]);
    expect(r.pos[1]).toBeCloseTo(L.CANOPY.under - H, 6);
  });
});

describe('level data', () => {
  let world, wcol;
  beforeAll(() => {
    const rng = createRng(1).fork('level');
    world = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')) });
    wcol = createCollision(world.colliders, { surfaceAt: worldSurfaceAt });
  }, 60000);

  it('every spawn point is outside the playable polygon, inside bounds, and lands inside', () => {
    expect(W.spawnPoints.length).toBe(20);
    const inside = (p, b) => p[0] > b.min[0] && p[0] < b.max[0] && p[2] > b.min[2] && p[2] < b.max[2];
    for (const s of W.spawnPoints) {
      expect(s.kind).toBe('fence'); // every way in is climbed, squeezed or crawled through (manager.js's climb-in)
      expect(['panel', 'rail', 'gap', 'window', 'roller']).toContain(s.breach);
      expect(W.insidePolygon(s.pos[0], s.pos[2]), s.id).toBe(false);
      expect(inside(s.pos, W.bounds)).toBe(true);
      expect(W.insidePolygon(s.to[0], s.to[2]), s.id).toBe(true);
      expect(s.top).toBeGreaterThan(0.3);
    }
  });

  it('with the doors shut the player start and every forecourt landing are connected; the other zones are not', () => {
    const grid = buildGrid(world.colliders, W.bounds, 0.5);
    const seen = reachable(grid, L.playerStart.pos[0], L.playerStart.pos[2]);
    const ok = (p) => { const k = grid.index(p[0], p[2]); return k >= 0 && seen[k] === 1; };
    expect(ok(L.playerStart.pos)).toBe(true);
    for (const s of W.spawnPoints) expect(ok(s.to), `landing of ${s.id}`).toBe(s.zone === 'forecourt');
    // the loop: all four corners, the narrow lane behind the trailer, both sides of the canopy, the
    // alley behind the store, the service alley up to its gate
    for (const p of [[-19, 0, -14], [19, 0, -14], [20.6, 0, 17.5], [-19, 0, 17], [-2, 0, -13], [-2, 0, -3.5], [15, 0, 4], [-18, 0, -25], [25, 0, -11.5]]) expect(ok(p), `point ${p}`).toBe(true);
    for (const p of [[15, 0, -25], [40, 0, -20], [40, 0, 10]]) expect(ok(p), `point ${p}`).toBe(false);
    // and the player cannot get out: nothing reachable lies outside the perimeter
    for (let k = 0; k < seen.length; k++) {
      if (!seen[k]) continue;
      expect(W.insidePolygon(grid.centerX(k), grid.centerZ(k))).toBe(true);
    }
  });

  it('interactables, areas, rain occluders and named shots are as the contract says', () => {
    const ammo = L.interactables.find((i) => i.kind === 'wallAmmo');
    expect(ammo).toMatchObject({ radius: 1.6, cost: tuning.wallAmmo.cost, label: 'Ammo', zone: 'forecourt' });
    for (const i of L.interactables) { expect(typeof i.id).toBe('string'); expect(i.pos.length).toBe(3); }
    expect(L.areas.find((a) => a.name === 'canopy')).toBeTruthy();
    expect(level.rainOccluders.length).toBeGreaterThanOrEqual(3);
    const shots = { ...L.shots, ...W.shots };
    for (const name of ['title', 'wide', 'canopy', 'pumps', 'lane', 'zombies-near', 'zombies-far', 'weapon', 'store', 'door', 'highway', 'ground', 'story', 'firing', 'p2-grey-diner', 'p2-grey-motel', 'p2-grey-garage', 'p2-grey-top', 'p2-walkway', 'p2-east-fence', 'p2-sag', 'p2-stairs', 'p2-wrecks']) {
      const s = shots[name];
      expect(s, name).toBeTruthy();
      expect(s.cam.length).toBe(5);
      expect(s.fov).toBeGreaterThan(20);
      // a camera must not be inside a collider
      const [x, y, z] = s.cam;
      const hitBox = world.colliders.some((b) => x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]);
      expect(hitBox, `shot ${name} camera inside a collider`).toBe(false);
    }
  });

  // ---- stairs, the walkway, doors ----
  const walkW = (from, dir, metres, step = 0.07) => {
    let p = from.slice(), onGround = true, allGround = true;
    for (let d = 0; d < metres; d += step) {
      const r = wcol.moveCapsule(p, R, H, [dir[0] * step, -0.02, dir[2] * step]);
      p = r.pos; onGround = r.onGround; allGround = allGround && onGround;
    }
    return { pos: p, onGround, allGround };
  };
  it('walking up the 16 stairs raises the player to the walkway, on the ground all the way', () => {
    const up = W.navOptions.layers[1].y;
    // the west stair: foot at x 37.5, rising toward -x
    const a = walkW([38.4, 0, -35.75], [-1, 0, 0], 6.2);
    expect(a.pos[1]).toBeCloseTo(up, 1);
    expect(Math.abs(a.pos[1] - up)).toBeLessThanOrEqual(0.02);
    expect(a.allGround).toBe(true);
    // the east stair, rising toward -z, ends on the walkway
    const b = walkW([59.2, 0, -10.4], [0, 0, -1], 9);
    expect(Math.abs(b.pos[1] - up)).toBeLessThanOrEqual(0.02);
    expect(b.allGround).toBe(true);
    expect(b.pos[2]).toBeLessThan(-17);
  });
  it('walking off the walkway edge is stopped by the rail', () => {
    const up = W.navOptions.layers[1].y;
    const a = walkW([45, up, -37.2], [0, 0, 1], 3);
    expect(a.pos[1]).toBeCloseTo(up, 5);
    expect(a.pos[2]).toBeLessThan(-36.4 - R + 0.01);
    const b = walkW([59.2, up, -25], [-1, 0, 0], 3); // the east walkway's rail
    expect(b.pos[1]).toBeCloseTo(up, 5);
    expect(b.pos[0]).toBeGreaterThan(58.5 + R - 0.01);
  });
  it('a closed door\'s collider blocks and an opened one does not', () => {
    const d1 = world.colliders.filter((c) => c.door === 'd1');
    expect(d1.length).toBeGreaterThan(0);
    const shut = walkW([12.2, 0.15, -18.5], [0, 0, -1], 4);
    expect(shut.pos[2]).toBeGreaterThan(-20.0 + R - 0.05);
    for (const c of d1) c.off = true;
    try {
      const open = walkW([12.2, 0.15, -18.5], [0, 0, -1], 4);
      expect(open.pos[2]).toBeLessThan(-21.5);
      expect(open.pos[1]).toBe(0); // down off the pavement onto the diner's floor
    } finally { for (const c of d1) c.off = false; }
  });
  it('heightAt is 3.04 on the walkway and 0 under it', () => {
    const up = W.navOptions.layers[1].y;
    expect(wcol.heightAt(45, -37.2, up)).toBeCloseTo(up, 5);
    expect(wcol.heightAt(45, -37.2, up + 0.1)).toBeCloseTo(up, 5);
    expect(wcol.heightAt(45, -37.2, 0)).toBe(0);
    expect(wcol.heightAt(45, -37.2, 1.5)).toBe(0);
    expect(wcol.heightAt(0, 12, 0)).toBe(0);
  });
});

describe('ground detail maps', () => {
  let m, P;
  beforeAll(() => {
    const rng = createRng(1).fork('ground');
    P = createMaskPainter(rng.fork('mask'));
    paintGroundMask(P, rng.fork('paint'));
    m = P.finish();
  });
  const texel = (x, z) => {
    const [x0, z0, x1, z1] = m.rect;
    const i = Math.floor(((x - x0) / (x1 - x0)) * m.size), j = Math.floor(((z - z0) / (z1 - z0)) * m.size);
    return [0, 1, 2, 3].map((c) => m.data[(j * m.size + i) * 4 + c]);
  };

  it('are neutral along every border, so the clamped lookup outside the lot finds nothing', () => {
    const S = m.size;
    for (let k = 0; k < S; k++) for (const [i, j] of [[k, 0], [k, S - 1], [0, k], [S - 1, k]]) {
      const o = (j * S + i) * 4;
      expect([m.data[o], m.data[o + 1], m.data[o + 2], m.data[o + 3]]).toEqual([0, 0, 0, 127]);
    }
    const C = m.crackSize;
    for (let k = 0; k < C; k += 7) for (const [i, j] of [[k, 0], [k, C - 1], [0, k], [C - 1, k]]) expect(m.crack[(j * C + i) * 2]).toBe(255);
    const Bn = m.bloodSize;
    for (let k = 0; k < Bn; k += 5) for (const [i, j] of [[k, 0], [k, Bn - 1], [0, k], [Bn - 1, k]]) expect(m.blood[j * Bn + i]).toBe(0);
  });

  it('put a soak at every fuelling position, polish in the pump lanes and a patch where one was cut', () => {
    for (const [ix, iz] of L.ISLANDS) for (const f of [1, -1]) {
      let best = 0;
      for (let dx = -2.6; dx <= 2.6; dx += 0.1) for (let dz = -0.5; dz <= 0.6; dz += 0.1) best = Math.max(best, texel(ix + dx, iz + f * 1.63 + dz)[0]);
      expect(best, `island ${ix},${iz} face ${f}`).toBeGreaterThan(150); // past the level where the film starts
    }
    let lane = 0;
    for (let x = -10; x < 6; x += 0.25) lane = Math.max(lane, texel(x, -3.5 - 0.775)[1], texel(x, -3.5 + 0.775)[1]);
    expect(lane).toBeGreaterThan(100);
    expect(texel(-8.0, 11.4)[2]).toBe(255); // inside a patch
    expect(texel(0, 8)[2]).toBe(0); // open lot
    expect(texel(L.playerStart.pos[0], L.playerStart.pos[2])[3]).toBeGreaterThan(100); // corridor is a number, not NaN
  });

  it('store, beside every crack, the offset to its centre line', () => {
    expect(P.cracks.length).toBeGreaterThan(40);
    const [x0, z0, x1, z1] = m.rect, C = m.crackSize;
    let checked = 0;
    for (const cr of P.cracks.slice(0, 60)) {
      const a = cr.pts[0], b = cr.pts[1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.1) continue;
      // a point 2 cm to one side of the middle of the first run
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      const px = (a.x + b.x) / 2 + nx * 0.02, pz = (a.z + b.z) / 2 + nz * 0.02;
      const i = Math.floor(((px - x0) / (x1 - x0)) * C), j = Math.floor(((pz - z0) / (z1 - z0)) * C);
      if (i < 2 || j < 2 || i > C - 3 || j > C - 3) continue;
      // texel centre, and where its stored offset says the crack is
      const cx = x0 + ((i + 0.5) / C) * (x1 - x0), cz = z0 + ((j + 0.5) / C) * (z1 - z0);
      const vx = ((m.crack[(j * C + i) * 2] - 128) / 127) * m.crackRange, vz = ((m.crack[(j * C + i) * 2 + 1] - 128) / 127) * m.crackRange;
      const qx = cx + vx, qz = cz + vz;
      // that point lies on some crack: within a millimetre of the nearest segment of any of them
      let d = Infinity;
      for (const other of P.cracks) for (let k = 0; k < other.pts.length - 1; k++) {
        const s = other.pts[k], e = other.pts[k + 1], sl = Math.hypot(e.x - s.x, e.z - s.z) || 1e-9;
        const t = Math.min(sl, Math.max(0, ((qx - s.x) * (e.x - s.x) + (qz - s.z) * (e.z - s.z)) / sl));
        d = Math.min(d, Math.hypot(qx - s.x - ((e.x - s.x) / sl) * t, qz - s.z - ((e.z - s.z) / sl) * t));
      }
      expect(d, `crack ${checked}`).toBeLessThan(0.0012);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('are the same every time for the same seed', () => {
    const rng = createRng(1).fork('ground');
    const P2 = createMaskPainter(rng.fork('mask'));
    paintGroundMask(P2, rng.fork('paint'));
    const m2 = P2.finish();
    let diff = 0;
    for (let k = 0; k < m.data.length; k += 97) if (m.data[k] !== m2.data[k]) diff++;
    for (let k = 0; k < m.crack.length; k += 89) if (m.crack[k] !== m2.crack[k]) diff++;
    expect(diff).toBe(0);
  });
});

describe('raycast against rotated props', () => {
  // local frame of a prop placed with M(x, 0, z, 0, yaw, 0): +x forward, +z right
  const frame = (v) => ({ fwd: [Math.cos(v.yaw), 0, -Math.sin(v.yaw)], right: [Math.sin(v.yaw), 0, Math.cos(v.yaw)] });
  const at = (v, lx, y, lz) => { const f = frame(v); return [v.x + f.fwd[0] * lx + f.right[0] * lz, y, v.z + f.fwd[2] * lx + f.right[2] * lz]; };
  const rotY = (d, a) => [d[0] * Math.cos(a) + d[2] * Math.sin(a), d[1], -d[0] * Math.sin(a) + d[2] * Math.cos(a)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // shoot at a point on a panel from several angles; every hit must lie on the panel's plane
  function checkPanel(v, lx, y, lz, n, dist = 1.2) {
    const target = at(v, lx, y, lz);
    for (const a of [-1.0, -0.5, 0, 0.5, 1.0]) for (const pitch of [0, -0.25]) {
      let d = rotY([-n[0], 0, -n[2]], a);
      d = [d[0] * Math.cos(pitch), Math.sin(pitch), d[2] * Math.cos(pitch)];
      const o = [target[0] - d[0] * dist, target[1] - d[1] * dist, target[2] - d[2] * dist];
      const hit = col.raycast(o, d, 20);
      const tag = `${v.id} local (${lx}, ${y}, ${lz}) angle ${a} pitch ${pitch}`;
      expect(hit, tag).not.toBeNull();
      expect(Math.abs(dot([hit.pos[0] - target[0], hit.pos[1] - target[1], hit.pos[2] - target[2]], n)), `${tag}: off the panel plane`).toBeLessThan(0.02);
      expect(hit.dist, tag).toBeCloseTo(dist, 1);
      expect(dot(hit.normal, n), `${tag}: normal`).toBeGreaterThan(0.9999);
      expect(Math.hypot(...hit.normal)).toBeCloseTo(1, 6);
    }
  }

  it('cars parked at an angle are hit on their side panels, with the panel normal', async () => {
    const { CAR_TYPES } = await import('../src/level/props/car.js');
    const angled = L.vehicles.filter((v) => Math.abs(Math.sin(2 * v.yaw)) > 0.05);
    expect(angled.map((v) => v.id).sort()).toEqual(['cruiser', 'hatch', 'wagon']);
    for (const v of angled) {
      const t = CAR_TYPES[v.type];
      const f = frame(v);
      for (const s of v.doorAjar ? [1] : [1, -1]) { // an open door hangs in front of the left side
        const n = f.right.map((c) => c * s);
        for (const lx of [t.rearBaseX + 0.25, (t.rearBaseX + t.cowlX) / 2, t.cowlX - 0.25]) checkPanel(v, lx, 0.55, s * t.W / 2, n);
      }
      // tail panel (its normal points backwards)
      if (t.rearBaseX < -t.L / 2 + 0.3) checkPanel(v, -t.L / 2, 0.55, 0.2, f.fwd.map((c) => -c));
    }
  });

  it('the jack-knifed trailer is hit on its flanks, with the flank normal', async () => {
    const { TRAILER } = await import('../src/level/props/truck.js');
    const v = { id: 'trailer', ...L.LORRY };
    const f = frame(v);
    for (const lx of [-4, -1.5, 1, 3]) checkPanel(v, lx, 2.6, -TRAILER.W / 2, f.right.map((c) => -c));
    checkPanel(v, -3, 2.6, TRAILER.W / 2, f.right);
  });

  it('a rotated box from the builder gives exact hits on every face, top included', async () => {
    const { createBuilder, M } = await import('../src/level/build.js');
    const B = createBuilder();
    const yaw = 0.6;
    B.at(M(3, 0, -2, 0, yaw, 0), () => B.collide([-2, 0, -1], [2, 1.5, 1], 'metal'));
    const c = createCollision(B.colliders);
    const v = { x: 3, z: -2, yaw };
    const f = frame(v);
    const down = c.raycast(at(v, 1.9, 5, 0.9), [0, -1, 0], 10);
    expect(down.pos[1]).toBeCloseTo(1.5, 6);
    expect(down.normal).toEqual([0, 1, 0]);
    // just outside the true corner there is nothing but the ground, although a slice box may cover it
    expect(c.raycast(at(v, 2.03, 5, 1.03), [0, -1, 0], 10).pos[1]).toBeCloseTo(0, 6);
    const nose = c.raycast(at(v, 6, 0.7, 0.3), f.fwd.map((k) => -k), 10);
    expect(nose.dist).toBeCloseTo(4, 5);
    expect(dot(nose.normal, f.fwd)).toBeGreaterThan(0.9999);
    // capsule movement still uses axis-aligned slices
    expect(B.colliders.length).toBeGreaterThan(1);
    for (const b of B.colliders) for (let a = 0; a < 3; a++) expect(b.max[a]).toBeGreaterThan(b.min[a]);
  });

  it('a ray that starts exactly on a face hits that face at distance 0 when it points inward', () => {
    const c = createCollision([{ min: [0, 0, 0], max: [1, 1, 1], surface: 'metal' }]);
    const on = c.raycast([0, 0.5, 0.5], [1, 0, 0], 5);
    expect(on).not.toBeNull();
    expect(on.dist).toBe(0);
    expect(on.normal).toEqual([-1, 0, 0]);
    expect(c.raycast([0, 0.5, 0.5], [-1, 0, 0], 5)).toBeNull(); // pointing away from the box
    expect(c.raycast([1, 0.5, 0.5], [1, 0, 0], 5)).toBeNull(); // leaving through the far face
    expect(c.raycast([0.5, 0.5, 0.5], [1, 0, 0], 5)).toBeNull(); // inside: the box is ignored
    const top = c.raycast([0.5, 1, 0.5], [0.3, -1, 0], 5);
    expect(top.dist).toBe(0);
    expect(top.normal).toEqual([0, 1, 0]);
  });

  it('raycast keeps its once-per-ray marker to itself: shared colliders are never written to', () => {
    // two collision instances over the same collider list (the game's and a test's, or two levels)
    const frozen = level.colliders.map((b) => (b.obb ? Object.freeze(b.obb) : null)).filter(Boolean);
    expect(frozen.length).toBeGreaterThan(20);
    const a = createCollision(level.colliders, { surfaceAt: L.surfaceAt });
    const b = createCollision(level.colliders, { surfaceAt: L.surfaceAt });
    const hatch = L.vehicles.find((v) => v.id === 'hatch');
    const o = [hatch.x - 6, 0.6, hatch.z + 0.3], d = [1, 0, 0];
    const h1 = a.raycast(o, d, 20); // would throw on a frozen box if the marker were written onto it
    expect(h1).not.toBeNull();
    // the same ray through the other instance, and again through the first: every call sees the car
    for (const c of [b, a, b, b, a]) expect(c.raycast(o, d, 20).dist).toBeCloseTo(h1.dist, 9);
    for (const ob of frozen) expect(Object.keys(ob).sort()).toEqual(['ax', 'ay', 'az', 'c', 'half', 'surface']);
  });
});
