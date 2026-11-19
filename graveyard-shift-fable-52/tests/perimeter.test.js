// The player never sees where the world ends and never walks out
// of it. A pure collision simulation with the player's own movement code against the whole world's
// colliders: every barrier is pushed against from inside, walking, jumping and along it.
import { describe, it, expect, beforeAll } from 'vitest';
import { Vector3 } from 'three';
import { createRng } from '../src/core/rng.js';
import { createAtlas } from '../src/level/atlas.js';
import { createCollision } from '../src/level/collision.js';
import { buildWorld, surfaceAt, noFootingWhy, FOOTING } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';
import * as L from '../src/level/layout.js';
import { buildGrid } from '../src/nav/grid.js';
import { createFlowField, WALK_OVER } from '../src/nav/flowfield.js';
import { createPlayerState, stepMovement } from '../src/player/sim.js';
import { tuning } from '../src/game/tuning.js';

const BARRIERS = ['fenceChained', 'jersey', 'wreck', 'embankment', 'thicket', 'wall', 'roller'];
const R = tuning.player.radius;
const UP = W.navOptions.layers[1].y;

let world, col, drawn;
beforeAll(() => {
  const rng = createRng(1).fork('level');
  world = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')) });
  col = createCollision(world.colliders, { surfaceAt });
  drawn = drawnTriangles(world.B);
}, 60000);

// ---- what is drawn ----------------------------------------------------------------------------------
// Every triangle the level draws in the main pass (every zone's merged buckets and every instanced
// mesh), in world space. Not drawn as seen: the shadow-caster and depth pre-pass copies and the soft
// contact blobs. A vehicle's own meshes are built at load with the renderer (registerVehicle), so its
// silhouette stand-in ('vcRefl', the shape the shadow and reflection passes draw for it) stands in.
const NOT_SEEN = new Set(['shadow', 'depth', 'uvBlob']);
function drawnTriangles(B) {
  const tris = [];
  const v = new Vector3();
  const push = (pos, idx, m) => {
    const p = (i) => { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)); if (m) v.applyMatrix4(m); return [v.x, v.y, v.z]; };
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = p(idx ? idx.getX(i) : i), b = p(idx ? idx.getX(i + 1) : i + 1), c = p(idx ? idx.getX(i + 2) : i + 2);
      tris.push({ a, b, c, cx: (a[0] + b[0] + c[0]) / 3, cy: (a[1] + b[1] + c[1]) / 3, cz: (a[2] + b[2] + c[2]) / 3 });
    }
  };
  for (const [, geos] of B.finishZones()) for (const [k, g] of geos) if (!NOT_SEEN.has(k)) push(g.getAttribute('position'), g.getIndex(), null);
  for (const [, recs] of B.instances) for (const r of recs.values()) for (const m of r.matrices) push(r.geometry.getAttribute('position'), r.geometry.getIndex(), m);
  return tris;
}
// closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5): squared distance
function triDist2(p, a, b, c) {
  const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]], dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d2 = (q) => { const e = sub(p, q); return dot(e, e); };
  const at = (t, u) => [a[0] + ab[0] * t + ac[0] * u, a[1] + ab[1] * t + ac[1] * u, a[2] + ab[2] * t + ac[2] * u];
  const d1 = dot(ab, ap), e1 = dot(ac, ap);
  if (d1 <= 0 && e1 <= 0) return d2(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return d2(b);
  const vc = d1 * d4 - d3 * e1;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return d2(at(d1 / (d1 - d3), 0));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return d2(c);
  const vb = d5 * e1 - d1 * d6;
  if (vb <= 0 && e1 >= 0 && d6 <= 0) return d2(at(0, e1 / (e1 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return d2([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc);
  return d2(at(vb * den, vc * den));
}
// Points on every face of every collider (the bottom excepted), at most 1 m apart, that are not
// buried in another collider; returns those with no drawn triangle within 0.5 m.
function uncovered(colliders, tris, reach = 0.5) {
  const pts = [];
  const buried = (p, self) => colliders.some((o) => o !== self && !o.off && p[0] > o.min[0] + 0.05 && p[0] < o.max[0] - 0.05 && p[1] > o.min[1] + 0.05 && p[1] < o.max[1] - 0.05 && p[2] > o.min[2] + 0.05 && p[2] < o.max[2] - 0.05);
  const steps = (lo, hi) => { const n = Math.max(1, Math.ceil((hi - lo) / 1)); const o = []; for (let i = 0; i <= n; i++) o.push(lo + ((hi - lo) * i) / n); return o; };
  const obbs = new Set();
  for (const c of colliders) {
    if (c.off) continue;
    if (c.obb) { // a slice of a rotated prop: check the oriented box it was cut from, once
      if (obbs.has(c.obb)) continue;
      obbs.add(c.obb);
      const o = c.obb, ax = [o.ax, o.ay, o.az];
      for (let f = 0; f < 3; f++) for (const sg of f === 1 ? [1] : [-1, 1]) {
        const [g, h] = [0, 1, 2].filter((k) => k !== f);
        for (const u of steps(-o.half[g], o.half[g])) for (const w of steps(-o.half[h], o.half[h])) {
          const l = [0, 0, 0]; l[f] = sg * o.half[f]; l[g] = u; l[h] = w;
          const p = [0, 1, 2].map((k) => o.c[k] + ax[0][k] * l[0] + ax[1][k] * l[1] + ax[2][k] * l[2]);
          if (p[1] >= 0.02 && !buried(p, c)) pts.push({ p, c });
        }
      }
      continue;
    }
    const [x0, y0, z0] = c.min, [x1, y1, z1] = c.max;
    const face = (fix, val, us, vs) => { for (const u of us) for (const w of vs) { const p = fix === 0 ? [val, u, w] : fix === 2 ? [u, w, val] : [u, val, w]; if (p[1] >= 0.02 && !buried(p, c)) pts.push({ p, c }); } };
    face(0, x0, steps(Math.max(y0, 0), y1), steps(z0, z1)); face(0, x1, steps(Math.max(y0, 0), y1), steps(z0, z1));
    face(2, z0, steps(x0, x1), steps(Math.max(y0, 0), y1)); face(2, z1, steps(x0, x1), steps(Math.max(y0, 0), y1));
    face(1, y1, steps(x0, x1), steps(z0, z1));
  }
  // triangles into 1 m XZ cells, only cells some point needs
  const key = (i, k) => i * 100003 + k;
  const want = new Map();
  for (const q of pts) want.set(key(Math.floor(q.p[0]), Math.floor(q.p[2])), []);
  for (const t of tris) {
    const xs = [t.a[0], t.b[0], t.c[0]], zs = [t.a[2], t.b[2], t.c[2]];
    const i0 = Math.floor(Math.min(...xs) - reach), i1 = Math.floor(Math.max(...xs) + reach);
    const k0 = Math.floor(Math.min(...zs) - reach), k1 = Math.floor(Math.max(...zs) + reach);
    if ((i1 - i0 + 1) * (k1 - k0 + 1) > 400) { for (const [kk, list] of want) { const i = Math.floor(kk / 100003 + 0.5), k = kk - i * 100003; if (i >= i0 && i <= i1 && k >= k0 && k <= k1) list.push(t); } continue; }
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) { const l = want.get(key(i, k)); if (l) l.push(t); }
  }
  const bad = [];
  const seenC = new Set();
  for (const { p, c } of pts) {
    if (seenC.has(c)) continue;
    const list = want.get(key(Math.floor(p[0]), Math.floor(p[2])));
    if (!list.some((t) => triDist2(p, t.a, t.b, t.c) <= reach * reach)) {
      seenC.add(c);
      bad.push(`${c.prop} (${c.zone}${c.noFooting ? ', ' + c.noFooting : ''}) ${c.min.map((v) => v.toFixed(2))}..${c.max.map((v) => v.toFixed(2))}: nothing drawn within ${reach} m of ${p.map((v) => v.toFixed(2))}`);
    }
  }
  return bad;
}

// the polygon's winding, for the inward normal of each segment
const area = W.polygon.reduce((a, p, i) => { const q = W.polygon[(i + 1) % W.polygon.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
const inward = (s) => {
  const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1], l = Math.hypot(dx, dz);
  const k = area > 0 ? 1 : -1; // turn left or right of the direction of travel
  return [(-dz / l) * k, (dx / l) * k];
};
const segDist = (s, x, z) => {
  const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1], l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - s.from[0]) * dx + (z - s.from[1]) * dz) / l2));
  return Math.hypot(s.from[0] + dx * t - x, s.from[1] + dz * t - z);
};
// does a standing capsule at (x, y, z) overlap any collider? (y = feet)
function blockedAt(x, y, z) {
  for (const b of world.colliders) {
    if (b.off || b.max[1] <= y + 0.32 || b.min[1] >= y + 1.8) continue;
    const cx = Math.min(Math.max(x, b.min[0]), b.max[0]), cz = Math.min(Math.max(z, b.min[2]), b.max[2]);
    if ((x - cx) ** 2 + (z - cz) ** 2 < (R + 0.05) ** 2) return true;
  }
  return false;
}
// the first free standing spot inward from a point on the barrier, on the floor at height y
function insideStart(x, z, n, y) {
  for (let d = 0.6; d <= 9; d += 0.25) {
    const px = x + n[0] * d, pz = z + n[1] * d;
    if (!W.insidePolygon(px, pz)) continue;
    if (Math.abs(col.heightAt(px, pz, y) - y) > 0.05) continue;
    if (!blockedAt(px, y, pz)) return [px, y, pz];
  }
  return null;
}
// push the player outward for 3 s at a sprint (yaw: facing out, then turned by `turn`), jumping
// at will; returns the first escape or standing-on-top found
function push(start, out, turn, jump) {
  const s = createPlayerState({ pos: start.slice() });
  s.pos = start.slice();
  // yaw 0 looks down -z; forward = (-sin yaw, -cos yaw)
  s.yaw = Math.atan2(-out[0], -out[1]) + turn;
  let worst = null;
  for (let f = 0; f < 180; f++) {
    stepMovement(s, { move: { x: 0, y: 1 }, sprint: true, jump: jump && f % 20 === 10 }, 1 / 60, col.moveCapsule);
    const [x, y, z] = s.pos;
    if (!W.insidePolygon(x, z)) return { why: 'outside', pos: s.pos.slice(), f };
    if (start[1] < 1 && s.onGround && y > 1.2) worst = worst || { why: 'on top', pos: s.pos.slice(), f };
  }
  return worst;
}

describe('the perimeter', () => {
  it('is a closed loop of named barriers with no gap between consecutive segments', () => {
    expect(W.perimeter.length).toBeGreaterThan(20);
    for (let i = 0; i < W.perimeter.length; i++) {
      const a = W.perimeter[i], b = W.perimeter[(i + 1) % W.perimeter.length];
      expect(Math.hypot(a.to[0] - b.from[0], a.to[1] - b.from[1]), `${a.id} -> ${b.id}`).toBeLessThan(1e-3);
      expect(BARRIERS, a.id).toContain(a.barrier);
      expect(W.ZONE_NAMES).toContain(a.zone);
    }
    expect(new Set(W.perimeter.map((s) => s.id)).size).toBe(W.perimeter.length);
    // the drives to the highway are closed by jersey barriers, the motel's road by wrecks
    expect(W.perimeter.filter((s) => s.barrier === 'jersey').length).toBeGreaterThanOrEqual(2);
    expect(W.perimeter.some((s) => s.barrier === 'wreck')).toBe(true);
  });

  it('every spawn point is outside the polygon, within 6 m of its breach, and names its segment', () => {
    for (const p of W.spawnPoints) {
      const s = W.perimeter.find((q) => q.id === p.segment);
      expect(s, p.id).toBeTruthy();
      expect(s.breach).toBe(p.id);
      expect(W.insidePolygon(p.pos[0], p.pos[2]), p.id).toBe(false);
      expect(segDist(s, p.pos[0], p.pos[2]), p.id).toBeLessThanOrEqual(6);
    }
    // and every breach has its spawn point
    for (const s of W.perimeter.filter((q) => q.breach)) expect(W.spawnPoints.find((p) => p.id === s.breach), s.id).toBeTruthy();
  });

  it('from inside every segment, every 0.5 m, a sprinting, jumping player never gets out or on top', () => {
    const fails = [];
    let tried = 0;
    for (const s of W.perimeter) {
      const n = inward(s);
      const len = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
      const ts = [];
      for (let d = 0.25; d < len; d += 0.5) ts.push(d);
      if (!ts.length) ts.push(len / 2);
      for (const d of ts) {
        const x = s.from[0] + ((s.to[0] - s.from[0]) * d) / len, z = s.from[1] + ((s.to[1] - s.from[1]) * d) / len;
        for (const y of [0, UP]) {
          const start = insideStart(x, z, n, y);
          if (!start) continue;
          tried++;
          const out = [-n[0], -n[1]];
          for (const [turn, jump] of [[0, false], [0, true], [Math.PI / 4, true], [-Math.PI / 4, true]]) {
            const r = push(start, out, turn, jump);
            if (r) { fails.push(`${s.id} (${s.barrier}${s.breach ? `, breach ${s.breach}` : ''}) at ${x.toFixed(2)},${z.toFixed(2)} y${y} turn ${turn.toFixed(2)} jump ${jump}: ${r.why} at ${r.pos.map((v) => v.toFixed(2))} frame ${r.f}`); break; }
          }
        }
      }
    }
    expect(fails, fails.slice(0, 12).join('\n')).toEqual([]);
    expect(tried).toBeGreaterThan(600);
  }, 120000);

  it('with every door open, nothing reachable from the player start lies outside the polygon', () => {
    const doorCols = world.colliders.filter((c) => c.door);
    for (const c of doorCols) c.off = true;
    try {
      const g = buildGrid(world.colliders, W.bounds, 0.5, { bandMin: WALK_OVER, ...W.navOptions });
      const f = createFlowField(g);
      f.setTarget(L.playerStart.pos[0], L.playerStart.pos[2], 0);
      let reached = 0;
      const outside = [];
      for (let L2 = 0; L2 < g.layers; L2++) for (let k = 0; k < g.nc; k++) {
        const x = g.centerX(k), z = g.centerZ(k);
        if (f.dist(x, z, L2) === Infinity || g.blocked[L2 * g.nc + k]) continue;
        reached++;
        if (!W.insidePolygon(x, z)) outside.push(`${x},${z} layer ${L2}`);
      }
      expect(outside, outside.slice(0, 10).join('; ')).toEqual([]);
      // all four zones and the upper floor are on the ring
      for (const [x, z, L2] of [[15, -25, 0], [40, -20, 0], [40, 10, 0], [45, -37.2, 1], [41.5, -41, 1]]) expect(f.dist(x, z, L2), `${x},${z},${L2}`).toBeLessThan(200);
      expect(reached).toBeGreaterThan(8000);
    } finally { for (const c of doorCols) c.off = false; }
  });

  it('no invisible wall: drawn triangles lie within 0.5 m of every face of every collider', () => {
    const bad = uncovered(world.colliders, drawn);
    // Known and out of scope here: the pallet barricade by the diner front (props/clutter.js) has
    // a collider whose west top corner stands 0.6 m from its leaning pallets. Listed so that fixing it
    // makes this test say so.
    const KNOWN = [/^drawn \(forecourt\) 10\.59,0\.00,-16\.62\.\.11\.07,1\.05,-16\.05:/];
    expect(bad.filter((b) => !KNOWN.some((k) => k.test(b))), bad.slice(0, 20).join('\n')).toEqual([]);
    expect(bad.length).toBe(KNOWN.length);
  }, 120000);

  it('... and the check fails when a drawn mesh is taken away (the motel road wrecks)', () => {
    const wrecks = world.colliders.filter((c) => c.prop === 'wreck');
    expect(wrecks.length).toBe(2);
    const near = (t) => wrecks.some((c) => t.cx > c.min[0] - 0.6 && t.cx < c.max[0] + 0.6 && t.cz > c.min[2] - 0.6 && t.cz < c.max[2] + 0.6 && t.cy < c.max[1] + 0.6);
    const without = drawn.filter((t) => !near(t));
    const bad = uncovered(wrecks, without);
    expect(bad.length).toBeGreaterThan(0);
    expect(uncovered(wrecks, drawn)).toEqual([]);
  }, 120000);
});

// ---- jump chains --------------------------------------------------------------------
// A breadth-first search over standing spots: from every standing spot, sprint-jump in 16 directions
// (from a standstill, and after a run-up that can also carry the body off an edge), and every spot
// landed on above the ground is searched again in turn, to any depth. Every frame of every jump is
// checked: the body never leaves the playable polygon, never stands on anything that gives no footing
// (rail, post, fence, wall top, barrier, wreck, roof) and never stands higher than the upper floor.
// Ground spots are seeded on a grid near anything a jump could get onto, sampled with the seeded RNG;
// GS_JUMPCHAIN=full seeds every ground spot on a 0.5 m grid and searches from every landing.
const FULL = typeof process !== 'undefined' && process.env && process.env.GS_JUMPCHAIN === 'full';
const DIRS = 16;
// escapesOnly: count only leaving the map, and let chains go on over whatever is stood on (how the
// review measured the build without the footing rule)
function jumpSearch(cols, colliders, { seeds, rng, maxDepth = 8, expandGround = false, limit = Infinity, escapesOnly = false }) {
  const supportOf = (x, y, z) => { // the boxes the feet rest on (empty: the ground)
    const out = [];
    for (const b of colliders) {
      if (b.off || Math.abs(b.max[1] - y) > 2e-3) continue;
      const dx = x < b.min[0] ? b.min[0] - x : x > b.max[0] ? x - b.max[0] : 0;
      const dz = z < b.min[2] ? b.min[2] - z : z > b.max[2] ? z - b.max[2] : 0;
      if (dx * dx + dz * dz < (R * 0.85) ** 2) out.push(b);
    }
    return out;
  };
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[2] * 2)},${Math.round(p[1] * 10)}`;
  const seen = new Set();
  const queue = [];
  for (const s of seeds) { const k = key(s); if (!seen.has(k)) { seen.add(k); queue.push({ pos: s, depth: 0 }); } }
  const fails = [];
  let attempts = 0, deepest = 0;
  for (let qi = 0; qi < queue.length && attempts < limit; qi++) {
    const node = queue[qi];
    deepest = Math.max(deepest, node.depth);
    const off = rng.next() * (Math.PI * 2 / DIRS);
    for (let d = 0; d < DIRS; d++) {
      for (const runUp of [0, 8]) {
        attempts++;
        const s = createPlayerState({ pos: node.pos.slice() });
        s.pos = node.pos.slice();
        s.yaw = off + (d * Math.PI * 2) / DIRS;
        let air = false;
        for (let f = 0; f < 110; f++) {
          stepMovement(s, { move: { x: 0, y: 1 }, sprint: true, jump: f === runUp }, 1 / 60, cols.moveCapsule);
          const [x, y, z] = s.pos;
          let why = null;
          if (!W.insidePolygon(x, z)) why = 'outside the map';
          else if (escapesOnly) why = null;
          else if (s.onGround && y > FOOTING.upperProp + 1e-3) why = 'above every floor and the furniture on it';
          else if (s.onGround && y > 0.01) {
            const sup = supportOf(x, y, z);
            if (sup.length && sup.every((b) => noFootingWhy(b) || b.slip)) why = `standing on ${noFootingWhy(sup[0]) || 'a slip box'} (${sup[0].prop})`;
          }
          if (why) { fails.push(`${why} at ${s.pos.map((v) => v.toFixed(2))} from ${node.pos.map((v) => v.toFixed(2))} yaw ${s.yaw.toFixed(2)} runUp ${runUp} depth ${node.depth} frame ${f}`); break; }
          if (!s.onGround) air = true;
          else if (air) {
            if ((y > 0.05 || expandGround) && node.depth < maxDepth) {
              const k = key(s.pos);
              if (!seen.has(k)) { seen.add(k); queue.push({ pos: s.pos.slice(), depth: node.depth + 1 }); }
            }
            break;
          }
        }
      }
    }
  }
  return { fails, attempts, spots: queue.length, deepest };
}
// standing spots: the top of everything that may be stood on, every 0.5 m, and the ground on a grid
function standingSpots(cols, colliders, { groundStep, nearClimb, rng, groundKeep = 1, near = null }) {
  const spots = [];
  const ok = (x, y, z) => W.insidePolygon(x, z) && Math.abs(cols.heightAt(x, z, y) - y) < 1e-3 && !blocked(colliders, x, y, z) && (!near || near(x, z));
  for (const b of colliders) {
    if (b.off || b.slip || noFootingWhy(b) || b.max[1] < 0.05) continue;
    for (let x = b.min[0] + 0.1; x <= b.max[0] - 0.1 + 1e-9; x += Math.max(0.25, Math.min(0.5, (b.max[0] - b.min[0] - 0.2) / 2 || 0.5))) {
      for (let z = b.min[2] + 0.1; z <= b.max[2] - 0.1 + 1e-9; z += Math.max(0.25, Math.min(0.5, (b.max[2] - b.min[2] - 0.2) / 2 || 0.5))) {
        if (ok(x, b.max[1], z)) spots.push([x, b.max[1], z]);
      }
    }
  }
  const climbs = colliders.filter((b) => !b.slip && !noFootingWhy(b) && b.max[1] > 0.33 && b.max[1] < 1.2);
  for (let x = -23; x <= 67; x += groundStep) for (let z = -45; z <= 25; z += groundStep) {
    if (!ok(x, 0, z)) continue;
    if (nearClimb && !climbs.some((b) => x > b.min[0] - nearClimb && x < b.max[0] + nearClimb && z > b.min[2] - nearClimb && z < b.max[2] + nearClimb)) continue;
    if (groundKeep < 1 && rng.next() > groundKeep) continue;
    spots.push([x, 0, z]);
  }
  return spots;
}
function blocked(colliders, x, y, z) {
  for (const b of colliders) {
    if (b.off || b.max[1] <= y + 0.32 || b.min[1] >= y + 1.8) continue;
    const cx = Math.min(Math.max(x, b.min[0]), b.max[0]), cz = Math.min(Math.max(z, b.min[2]), b.max[2]);
    if ((x - cx) ** 2 + (z - cz) ** 2 < (R + 0.02) ** 2) return true;
  }
  return false;
}
const nearDoor = (x, z) => W.doors.some((d) => x > d.rect.x0 - 4 && x < d.rect.x1 + 4 && z > d.rect.z0 - 4 && z < d.rect.z1 + 4);

describe('jump chains: no way out and no footing on barriers, rails or roofs', () => {
  const run = (open, rngLabel, near) => {
    const doorCols = world.colliders.filter((c) => c.door);
    for (const c of doorCols) c.off = open;
    try {
      const rng = createRng(7).fork(rngLabel);
      const seeds = standingSpots(col, world.colliders, FULL ? { groundStep: 0.5, rng } : { groundStep: 1, nearClimb: 2.5, groundKeep: 0.5, rng, near });
      return { seeds: seeds.length, ...jumpSearch(col, world.colliders, { seeds, rng, expandGround: FULL }) };
    } finally { for (const c of doorCols) c.off = false; }
  };
  it('every door open: from every standing spot, chains of sprint-jumps in 16 directions', () => {
    const r = run(true, 'open');
    console.log(`jump chains, doors open: ${r.seeds} seeds, ${r.spots} spots, ${r.attempts} jumps, deepest chain ${r.deepest}, ${r.fails.length} failures`);
    expect(r.fails, r.fails.slice(0, 12).join('\n')).toEqual([]);
    expect(r.attempts).toBeGreaterThan(20000);
    // chains: every landing above the ground is searched again (in the full run every standing spot
    // is already a seed, so the closure is reached in fewer generations)
    if (!FULL) expect(r.deepest).toBeGreaterThanOrEqual(4);
  }, 600000);
  it('every door shut: the same round each door (the shut doors are something more to climb)', () => {
    const r = run(false, 'shut', FULL ? null : nearDoor);
    console.log(`jump chains, doors shut: ${r.seeds} seeds, ${r.spots} spots, ${r.attempts} jumps, deepest chain ${r.deepest}, ${r.fails.length} failures`);
    expect(r.fails, r.fails.slice(0, 12).join('\n')).toEqual([]);
    expect(r.attempts).toBeGreaterThan(2000);
  }, 600000);
  it('the search can fail: built without the footing rule (as 8d529f0 was), the motel stair rails are a ladder out of the map', () => {
    const rng = createRng(1).fork('level');
    const bare = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')), footing: false });
    const bcol = createCollision(bare.colliders, { surfaceAt });
    // the east motel walkway, by the east stair (the review's first escape)
    const seeds = [[59.2, UP, -18.0], [59.2, UP, -20.0], [59.2, UP, -24.0]];
    const r = jumpSearch(bcol, bare.colliders, { seeds, rng: createRng(7).fork('bare') });
    console.log(`without the footing rule: ${r.attempts} jumps, ${r.fails.length} failures, e.g.\n${r.fails.slice(0, 4).join('\n')}`);
    expect(r.fails.length).toBeGreaterThan(0);
    expect(r.fails.some((f) => f.startsWith('standing on thin'))).toBe(true);
    // and, let on up the rails, the chain gets out of the map
    const e = jumpSearch(bcol, bare.colliders, { seeds, rng: createRng(7).fork('bare'), escapesOnly: true, limit: 60000 });
    console.log(`... counting escapes only: ${e.attempts} jumps, ${e.fails.length} escapes, e.g.\n${e.fails.slice(0, 2).join('\n')}`);
    expect(e.fails.length).toBeGreaterThan(0);
  }, 600000);
});
