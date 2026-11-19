// The level: the forecourt and the three new areas assembled into culled groups, the doors
// between them, power, boarded windows, the perimeter, and the fixed positions the game systems
// use. buildWorld() authors geometry and colliders (no renderer: tests run it); createWorldState()
// is the pure state (zones, doors, power, boards, active spawn points); createLevel(G) puts the two
// together as G.level.
//
// Groups: 'forecourt' (the lot and everything beyond the wire: always drawn, it carries the
// backdrop), 'shell' (the new buildings' structure, boundaries and perimeter barriers: always
// drawn, a handful of draw calls, so no zone is ever a hole), one per new zone (its props, art and
// lights: drawn only while the zone is in visibleZones), and 'door:<id>' (a door's barrier, drawn
// until it is bought).
import { Group, InstancedMesh, MeshStandardMaterial, BoxGeometry, Matrix4, Vector3, Quaternion, Euler } from 'three';
import { M, box, boxUp, cylUp, rgb } from './build.js';
import { createAtlas } from './atlas.js';
import { createCollision } from './collision.js';
import { canCompileInParallel } from '../render/warm.js';
import * as L from './layout.js';
import * as W from './worldLayout.js';
import { buildForecourt, makeMaterials, registerLights, meshesFor, createForecourtUpdate } from './forecourt.js';
import { buildFence } from './props/fence.js';
import { buildLamp } from './props/lamp.js';
import { buildDiner } from './areas/diner.js';
import { buildMotel } from './areas/motel.js';
import { buildGarage } from './areas/garage.js';
import { world as T } from '../game/tuning/world.js';
import { installVehicles } from './props/vehicleParts.js';
import { installAreaArt } from '../mats/interior.js';

const AREAS = [['diner', buildDiner], ['motel', buildMotel], ['garage', buildGarage]];
const GREY = { wall: 0x8c8a84, floor: 0x77746e, roof: 0x5d5b57, solid: 0x8c8a84, block: 0x7d7b75, rail: 0x6a6e70, post: 0x6a6e70, stair: 0x96938b, table: 0x6b6258, stack: 0x5a4a3c };

// ---- geometry --------------------------------------------------------------------------------------

// art: { diner, motel, garage } area builders (default: the files under areas/). An area builder is
// called as fn(B, W) with B.zone set to the area; it returns { real: true } when it drew the area
// (then the greybox for that zone is skipped), anything else (the placeholders) and the greybox is
// drawn. See the exports below for the whole contract.
// footing: false builds the world without the no-footing rule (tests use it to show what it stops).
export function buildWorld({ rng, atlas, decals, art = {}, footing = true }) {
  const fore = buildForecourt({ rng, atlas, decals });
  const B = fore.B;
  const real = {};
  for (const [name, fn] of AREAS) {
    B.zone(name);
    let res = null;
    try { res = (art[name] || fn)(B, W); } catch (e) { res = null; }
    real[name] = !!(res && res.real === true);
  }
  B.zone('shell');
  greyStructure(B, real);
  greyFloors(B, real);
  buildPerimeter(B);
  for (const [name] of AREAS) if (!real[name]) B.inZone(name, () => greyProps(B, name));
  greyFixtures(B, real);
  const pp = B.prepass;
  B.prepass = null; // a door's barrier is a few plain boxes: no depth pre-pass copy, one draw call fewer
  for (const d of W.doors) B.inZone(`door:${d.id}`, () => greyDoor(B, d));
  B.prepass = pp;
  if (footing) markFooting(B.colliders);
  return { B, colliders: B.colliders, fixtures: B.fixtures, rainOccluders: B.rainOccluders, decals: fore.decals, real };
}

// ---- footing ------------------------------------------------------------------------------------
// What a body may stand on. A thin thing (a rail, a post, a fence, a wall top, a closed door), anything
// topping out above head height (a roof, a pump, a stack of crushed cars) other than the upper floor
// and the furniture on it, and anything standing at
// the perimeter (fences, jersey stacks, wrecks, the walls and roller doors on the line) gives no
// footing: it is a `slip` box, the same as a car body. A body that lands on one is slid off, cannot
// jump from it and cannot step from it to the next one up. At the perimeter, and on any roof or
// rail that has the map on one side only, the slide always runs back into the map. Applied to every
// collider the world builds, the area art's included, so a prop added later is covered by the rule.
export const FOOTING = {
  thin: 0.35, // m: a box no wider than this across is a rail, post, fence or wall
  thinMinH: 0.4, thinMinTop: 0.6, // ... unless it is a low edge (a kerb, a step, a sill board)
  roof: 2.0, // m: a top above head height is a roof (or a pump, or a stack of cars), ...
  upperProp: W.navOptions.layers[1].y + 1.0, // ... unless it is furniture on the upper floor
  edge: 1.0, edgeTop: 0.5, // m: within this of the perimeter, anything taller than edgeTop
  probe: 1.0, // m beyond the box's side where "is the map there?" is asked
};
const UPPER_Y = W.navOptions.layers[1].y;
const inUpper = (x, z) => W.upperFloors.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
// half-widths of a collider across its two horizontal axes, and those axes (an oriented slice: its own)
function axesOf(c) {
  const ob = c.obb;
  if (ob && Math.abs(ob.ay[1]) > 0.99) {
    const hx = [ob.ax[0], ob.ax[2]], hz = [ob.az[0], ob.az[2]];
    const lx = Math.hypot(...hx) || 1, lz = Math.hypot(...hz) || 1;
    return ob.half[0] <= ob.half[2]
      ? { short: [hx[0] / lx, hx[1] / lx], hw: ob.half[0], long: ob.half[2] }
      : { short: [hz[0] / lz, hz[1] / lz], hw: ob.half[2], long: ob.half[0] };
  }
  const wx = (c.max[0] - c.min[0]) / 2, wz = (c.max[2] - c.min[2]) / 2;
  return wx <= wz ? { short: [1, 0], hw: wx, long: wz } : { short: [0, 1], hw: wz, long: wx };
}
// distance in XZ from a collider's footprint to a perimeter segment (segments are axis-aligned)
function rectSegDist(c, s) {
  const sx0 = Math.min(s.from[0], s.to[0]), sx1 = Math.max(s.from[0], s.to[0]);
  const sz0 = Math.min(s.from[1], s.to[1]), sz1 = Math.max(s.from[1], s.to[1]);
  const dx = Math.max(0, sx0 - c.max[0], c.min[0] - sx1), dz = Math.max(0, sz0 - c.max[2], c.min[2] - sz1);
  return Math.hypot(dx, dz);
}
// Why a collider gives no footing ('thin' | 'roof' | 'edge'), or null when it may be stood on.
// Pure geometry: it does not read `slip`, so a test can ask it of a build made without footing.
export function noFootingWhy(c) {
  if (c.stair) return null;
  const top = c.max[1], h = top - c.min[1];
  const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2;
  if (inUpper(cx, cz) && Math.abs(top - UPPER_Y) < 0.02) return null; // the upper floor itself
  const { hw } = axesOf(c);
  if (hw * 2 <= FOOTING.thin && h >= FOOTING.thinMinH && top >= FOOTING.thinMinTop) return 'thin';
  if (top >= FOOTING.roof && !(inUpper(cx, cz) && c.min[1] >= UPPER_Y - 0.05 && top <= FOOTING.upperProp)) return 'roof';
  if (top > FOOTING.edgeTop) for (const s of W.perimeter) if (rectSegDist(c, s) <= FOOTING.edge) return 'edge';
  return null;
}
export function markFooting(colliders) {
  for (const c of colliders) {
    if (c.slip) continue; // a vehicle: already slides off its own flank
    const why = noFootingWhy(c);
    if (!why) continue;
    const { short, hw } = axesOf(c);
    const cx = c.obb ? c.obb.c[0] : (c.min[0] + c.max[0]) / 2, cz = c.obb ? c.obb.c[2] : (c.min[2] + c.max[2]) / 2;
    const d = hw + FOOTING.probe;
    const a = W.insidePolygon(cx + short[0] * d, cz + short[1] * d), b = W.insidePolygon(cx - short[0] * d, cz - short[1] * d);
    c.slip = a !== b ? { c: [cx, cz], side: a ? short.slice() : [-short[0], -short[1]], fixed: true } : { c: [cx, cz], side: short.slice() };
    c.noFooting = why;
  }
  return colliders;
}

function greyStructure(B, real) {
  for (const s of W.structure) {
    if (real[s.zone]) continue;
    const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
    const geo = box(x1 - x0, y1 - y0, z1 - z0);
    const big = s.kind === 'wall' || s.kind === 'solid' || s.kind === 'block' || s.kind === 'roof';
    if (s.kind === 'rail' || s.kind === 'post') B.add('paintGalv', geo, { m: M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) });
    else B.add('vcMatte', geo, { m: M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color: rgb(GREY[s.kind] || GREY.wall, 0.55), shadow: big });
    B.tag(`grey:${s.kind}`, () => B.collide(s.min, s.max, s.surface));
    if (s.kind === 'stair') B.colliders[B.colliders.length - 1].stair = s.stair;
    if (s.shelter) B.rainOccluders.push({ min: s.min.slice(), max: s.max.slice() });
  }
  // the diner's ceiling: most of it is the facade's roof slab (props/store.js), which never kept rain off
  if (!real.diner) B.rainOccluders.push({ min: [7, 3.55, -32], max: [26.6, 3.85, -20.3] });
  // under the walkway it is dry
  for (const w of W.walkway) B.rainOccluders.push({ min: [w.x0, W.navOptions.layers[1].y - 0.2, w.z0], max: [w.x1, W.navOptions.layers[1].y, w.z1] });
}

// floors of the new ground (the terrain sits 6 cm under y = 0 there)
function greyFloors(B, real) {
  const plane = (x0, z0, x1, z1, hex) => B.add('vcMatte', box(x1 - x0, 0.02, z1 - z0), { m: M((x0 + x1) / 2, -0.008, (z0 + z1) / 2), color: rgb(hex, 0.5) });
  if (!real.diner) { plane(7.3, -31.7, 20, -20.3, 0x3d3a36); plane(20.3, -31.7, 26.3, -20.3, 0x4a4844); }
  if (!real.motel) { plane(26.6, -38, 60, -3.2, 0x2c2c2e); plane(60, -17, 66, -3.2, 0x2f2e2c); for (const r of W.rooms.filter((q) => q.floor === 0)) plane(...(r.wing === 'n' ? [r.a0, -43.7, r.a1, -38.3] : [60.3, r.a0, 65.7, r.a1]), 0x3a3631); }
  if (!real.garage) { plane(22.4, -0.8, 66, 23.5, 0x3b3a37); plane(46.3, 4.3, 65.7, 19.7, 0x4f4d49); }
  plane(22.4, -12.75, 26.6, -10.25, 0x3a3936); // the alley
}

// What stands on the perimeter beyond the forecourt's own fences (forecourt.js draws those, its
// drive closures included): the motel's back fence and the garage's fences, the wrecks across the
// motel's road, the roller doors in the bays' back wall.
function buildPerimeter(B) {
  const segs = W.perimeter;
  const fenceRun = (a, b, out, cuts) => buildFence(B, a, b, { out, ...cuts });
  // motel back fence: three sagging rails, a padlocked gate where the service road carries on
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const sag = (at) => ({ at, depth: L.SAG.depth, width: L.SAG.width });
  fenceRun([66, -17], [66, -2], 1, { sags: [-15, -10.5, -3.5].map((z) => sag(z + 17)), gates: [{ at: (W.MOTEL_GATE.z0 + W.MOTEL_GATE.z1) / 2 + 17, width: W.MOTEL_GATE.z1 - W.MOTEL_GATE.z0 }] });
  fenceRun([66, -2], [66, 4], 1, { gaps: [[3 - 0.25, 3 + 0.25]] }); // the east gap: a torn panel
  fenceRun([66, 20], [66, 23.5], 1, {});
  fenceRun([66, 23.5], [22.3, 23.5], -1, { sags: [56, 30].map((x) => sag(66 - x)) });
  fenceRun([22.3, 23.5], [22.3, L.FENCE.s], 1, {});
  void len; void segs;
  // the motel's road in: burnt-out cars on their sides, bumper to bumper, a 0.5 m gap. Nothing is
  // drawn above the collider's 1.75 m: the underside (axles, wheels) faces one way, the crushed roof
  // the other, both within the body's height and the collider's width.
  const wreck = (z0, z1, k) => {
    const L2 = z1 - z0, cz = (z0 + z1) / 2, under = k ? 1 : -1;
    B.tag('wreck', () => {
      B.add('vcMatte', box(1.4, 1.72, L2 - 0.04, 0.05, 2), { m: M(26.6, 0.86, cz, 0, 0, k ? 0.012 : -0.012), color: rgb(k ? 0x2a1d16 : 0x3a2a20), shadow: true });
      B.add('vcMatte', box(0.14, 1.1, L2 * 0.62), { m: M(26.6 - under * 0.77, 0.75, cz), color: rgb(0x14110f) }); // the roof, crushed flat
      for (const dz of [-L2 / 2 + 0.75, L2 / 2 - 0.75]) for (const y of [0.42, 1.3]) B.add('vcMatte', cylUp(0.32, 0.32, 0.14, 12).rotateZ(Math.PI / 2), { m: M(26.6 + under * 0.70 + (under > 0 ? 0.14 : 0), y, cz + dz), color: rgb(0x0c0c0c) });
      B.collide([25.75, 0, z0], [27.45, 1.75, z1], 'metal');
    });
  };
  wreck(-32.0, -34.75, 0);
  wreck(-35.25, -38.0, 1);
  // roller doors in the bays' back wall: slats on both faces; one dropped to the floor, one stuck up
  for (const r of W.rollers) {
    for (const x of [66.02, 65.68]) for (let y = Math.max(0.05, r.gap); y < 4.2; y += 0.16) {
      B.add('paintGalv', box(0.02, 0.12, r.z1 - r.z0), { m: M(x, y + 0.06, (r.z0 + r.z1) / 2) });
    }
    if (r.gap > 0) B.add('vcMatte', box(0.04, 0.05, r.z1 - r.z0), { m: M(66.03, r.gap, (r.z0 + r.z1) / 2), color: rgb(0x111111) }); // its bottom rail
  }
}

// props the greybox stands in for searchables and machines no other prop draws yet
function greyProps(B, zone) {
  for (const s of W.searchables) {
    if (s.zone !== zone) continue;
    const st = W.standIns[s.id];
    if (st) {
      const [x, z, w, d, h, y0 = 0] = st;
      B.tag(`search:${s.id}`, () => {
        B.add('vcMatte', boxUp(w, h, d, 0.02, 1), { m: M(x, y0, z), color: rgb(s.kind === 'barrel' ? 0x2b4f7a : s.kind === 'locker' ? 0x4a5560 : s.kind === 'bin' ? 0x23352a : 0x6b5a40, 0.7), shadow: true });
        B.collide([x - w / 2, y0, z - d / 2], [x + w / 2, y0 + h, z + d / 2], s.kind === 'barrel' || s.kind === 'locker' ? 'metal' : 'cloth');
      });
    }
    const car = W.standInCars[s.id];
    if (car) B.at(M(car.x, 0, car.z, 0, car.yaw, 0), () => B.tag(`search:${s.id}`, () => greyCar(B, car)));
  }
}

// a car-shaped block: body to the belt line, a shorter cabin; no footing on it (slip, as the
// forecourt's cars)
function greyCar(B, c) {
  B.add('vcMatte', boxUp(c.L, 0.85, c.W, 0.08, 2), { m: M(0, 0.18, 0), color: rgb(0x3a3f45, 0.6), shadow: true });
  B.add('vcMatte', boxUp(c.L * 0.5, c.H - 1.03, c.W * 0.86, 0.1, 2), { m: M(-c.L * 0.06, 1.03, 0), color: rgb(0x14181b, 0.6) });
  for (const x of [-c.L * 0.32, c.L * 0.32]) for (const s of [-1, 1]) B.add('vcMatte', cylUp(0.32, 0.32, 0.2, 12).rotateX(Math.PI / 2), { m: M(x, 0.32, s * (c.W / 2 - 0.08)), color: rgb(0x0b0b0b) });
  const n0 = B.colliders.length;
  B.collide([-c.L / 2, 0, -c.W / 2], [c.L / 2, 1.03, c.W / 2], 'metal');
  B.collide([-c.L * 0.31, 1.03, -c.W * 0.43], [c.L * 0.19, c.H, c.W * 0.43], 'glass');
  const p0 = B.point(0, 0, 0), p1 = B.point(0, 0, 1);
  const sl = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  const slip = { c: [p0[0], p0[2]], side: [(p1[0] - p0[0]) / sl, (p1[2] - p0[2]) / sl] };
  for (let i = n0; i < B.colliders.length; i++) B.colliders[i].slip = slip;
}

// lamps and the faces of the fixtures in each zone (registered by createLevel)
function greyFixtures(B, real) {
  for (const f of W.fixtures) {
    B.zone(f.zone);
    if (f.kind === 'sodium') {
      const n = B.fixtures.length;
      B.at(M(f.pos[0] - 2.17, 0, f.pos[2], 0, 0, 0), () => B.tag('lamp', () => buildLamp(B, { state: 'on' })));
      for (let i = n; i < B.fixtures.length; i++) Object.assign(B.fixtures[i], { zone: f.zone, needsPower: !!f.needsPower });
      continue;
    }
    if (!real[f.zone]) {
      const lit = !f.needsPower;
      const geo = f.kind === 'neon' ? box(2.4, 0.5, 0.08) : box(1.2, 0.06, 0.14);
      B.add(lit ? 'vcGlow' : 'vcGloss', geo, { m: M(f.pos[0], f.pos[1] + 0.05, f.pos[2]), color: lit ? rgb(0xe8fff0, 6) : rgb(0x1a1c1c) });
    }
    B.fixture({ ...f });
  }
  B.zone('shell');
}

// a door's barrier as the greybox draws it (d1's is the forecourt's boarded front door): planks,
// a corrugated sheet in a frame, or a roller; the collider fills the opening
function greyDoor(B, d) {
  const r = d.rect, h = d.h;
  const alongX = r.x1 - r.x0 > r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const yaw = alongX ? 0 : Math.PI / 2;
  B.at(M(cx, 0, cz, 0, yaw, 0), () => {
    if (d.look === 'boarded' && d.id !== 'd1') {
      B.add('vcMatte', box(w, h, 0.03), { color: rgb(0x0a0a0a) , m: M(0, h / 2, 0) });
      for (let i = 0; i < 7; i++) B.add('vcMatte', box(w + 0.25, 0.18, 0.035), { m: M(0, 0.25 + i * (h - 0.4) / 6, 0.05, 0, 0, (i % 2 ? 0.05 : -0.04)), color: rgb([0x6b5236, 0x7a6040, 0x54412c][i % 3], 0.7) });
    } else if (d.look === 'sheet') {
      B.add('paintGalv', box(w, h, 0.04), { m: M(0, h / 2, 0) });
      for (let x = -w / 2 + 0.1; x < w / 2; x += 0.2) B.add('paintGalv', box(0.05, h - 0.1, 0.07), { m: M(x, h / 2, 0) });
      B.add('paintGalv', box(w, 0.08, 0.1), { m: M(0, h - 0.04, 0) });
    } else if (d.look === 'roller') {
      for (let y = 0.05; y < h; y += 0.16) B.add('paintGalv', box(w, 0.12, 0.05), { m: M(0, y + 0.06, 0) });
    }
  });
  const before = B.colliders.length;
  B.tag(`door:${d.id}`, () => B.collide([r.x0, 0, r.z0], [r.x1, h, r.z1], d.look === 'boarded' ? 'cloth' : 'metal'));
  for (let i = before; i < B.colliders.length; i++) B.colliders[i].door = d.id;
}

// ---- state -----------------------------------------------------------------------------------------

const xz = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? [p[0], p[2]] : p ? [p.x, p.z] : [NaN, NaN]);

// Pure world state. o: { emit(name, payload), colliders (door ones carry `door`), nav() -> G.nav or
// null, fixtures: [{ zone, needsPower, enabled, setEnabled(on) }], startZone, hooks: { onDoor(door),
// onPower(on), onBoards(window), onVisible(set), onZone(name) } }.
export function createWorldState(o = {}) {
  const emit = o.emit || (() => {});
  const nav = o.nav || (() => null);
  const hooks = o.hooks || {};
  const colliders = o.colliders || [];
  const fixtures = o.fixtures || [];

  const zones = {};
  for (const name of W.ZONE_NAMES) {
    const z = W.zones[name];
    zones[name] = { name, rects: z.rects, floor: z.floor, reverb: z.reverb, playable: z.playable, neighbours: [] };
  }
  const doors = W.doors.map((d) => ({ id: d.id, a: d.a, b: d.b, cost: d.cost, pos: d.pos, rect: d.rect, h: d.h, look: d.look, label: d.label, open: false, colliders: colliders.filter((c) => c.door === d.id) }));
  for (const d of doors) { zones[d.a].neighbours.push({ zone: d.b, door: d.id }); zones[d.b].neighbours.push({ zone: d.a, door: d.id }); }
  const byDoor = new Map(doors.map((d) => [d.id, d]));
  const power = { on: false, pos: W.power.pos, zone: W.power.zone };
  const windows = W.windows.map((w) => ({ id: w.id, zone: w.zone, pos: w.pos, normal: w.normal, w: w.w, sill: w.sill, head: w.head, boards: w.max, max: w.max }));
  const byWindow = new Map(windows.map((w) => [w.id, w]));
  const spawnPoints = W.spawnPoints.map((s) => ({ ...s }));
  const active = []; // live: refilled in place
  const visibleZones = new Set();
  const startZone = zones[o.startZone] ? o.startZone : 'forecourt';
  let zone = startZone;

  // zones reachable from `from` through open doors, within `hops`
  const seen = new Set();
  const queue = [];
  function reachable(from, hops = Infinity) {
    seen.clear(); queue.length = 0;
    seen.add(from); queue.push(from, 0);
    for (let q = 0; q < queue.length; q += 2) {
      const z = queue[q], h = queue[q + 1];
      if (h >= hops) continue;
      for (const n of zones[z].neighbours) if (!seen.has(n.zone) && byDoor.get(n.door).open) { seen.add(n.zone); queue.push(n.zone, h + 1); }
    }
    return seen;
  }
  // Spawn points in zones the player can be reached from through open doors, and only in zones that
  // are drawn: a zone three doors away is culled, and zombies must not climb in through nothing.
  function refreshActive() {
    const r = reachable(zone);
    active.length = 0;
    for (const s of spawnPoints) if (r.has(s.zone) && visibleZones.has(s.zone)) active.push(s);
  }
  function applyFixtures() {
    for (const f of fixtures) {
      f.powered = !f.needsPower || power.on;
      const on = f.powered && visibleZones.has(f.zone);
      if (f.enabled !== on) { f.enabled = on; if (f.setEnabled) f.setEnabled(on); }
    }
  }
  // Drawn: the zones within two open doors, the forecourt (it carries the backdrop), and across each
  // see-through boundary (W.seeThrough: the forecourt's east chain-link looks into the scrapyard)
  // from the player's zone or a zone it looks into through an open door.
  const near = [];
  function refreshVisible() {
    near.length = 0;
    for (const z of reachable(zone, 1)) near.push(z);
    const r = reachable(zone, 2);
    visibleZones.clear();
    visibleZones.add('forecourt'); // it carries the backdrop: always drawn
    for (const z of r) visibleZones.add(z);
    for (const [a, b] of W.seeThrough) {
      if (near.includes(a)) visibleZones.add(b);
      if (near.includes(b)) visibleZones.add(a);
    }
    if (hooks.onVisible) hooks.onVisible(visibleZones);
    applyFixtures();
  }
  // After a door's colliders are switched (off when opened, on when shut): the cells under the union of
  // its rect and every collider tagged to it (facade boxes tagged by their centre reach past the rect)
  // are recomputed from the colliders now on, so an opened doorway is clear all through and a shut one
  // blocked by its barrier.
  function navDoor(d) {
    const n = nav();
    if (!n || typeof n.setBlocked !== 'function') return;
    const u = { x0: d.rect.x0, z0: d.rect.z0, x1: d.rect.x1, z1: d.rect.z1 };
    for (const c of d.colliders) {
      if (c.min[0] < u.x0) u.x0 = c.min[0];
      if (c.min[2] < u.z0) u.z0 = c.min[2];
      if (c.max[0] > u.x1) u.x1 = c.max[0];
      if (c.max[2] > u.z1) u.z1 = c.max[2];
    }
    n.setBlocked(u, false);
  }
  function navInvalidate() {
    const n = nav();
    if (n && n.field && typeof n.field.invalidate === 'function') n.field.invalidate();
  }

  function openDoor(id) {
    const d = byDoor.get(id);
    if (!d || d.open) return false;
    d.open = true;
    for (const c of d.colliders) c.off = true;
    navDoor(d);
    emit('door:open', { id: d.id, a: d.a, b: d.b });
    if (hooks.onDoor) hooks.onDoor(d);
    refresh();
    return true;
  }
  function closeDoor(d) {
    if (!d.open) return;
    d.open = false;
    for (const c of d.colliders) c.off = false;
    navDoor(d);
    if (hooks.onDoor) hooks.onDoor(d);
  }
  function setPower(on) {
    const v = !!on;
    if (power.on === v) return false;
    power.on = v;
    if (v) emit('power:on', {});
    if (hooks.onPower) hooks.onPower(v);
    applyFixtures();
    return true;
  }
  function tearBoard(id) {
    const w = byWindow.get(id);
    if (!w) return -1;
    if (w.boards > 0) {
      w.boards--;
      emit('board:break', { id, left: w.boards });
      if (hooks.onBoards) hooks.onBoards(w);
      if (w.boards === 0) navInvalidate();
    }
    return w.boards;
  }
  function repairBoard(id) {
    const w = byWindow.get(id);
    if (!w) return -1;
    if (w.boards < w.max) {
      const was = w.boards;
      w.boards++;
      emit('board:repair', { id, left: w.boards });
      if (hooks.onBoards) hooks.onBoards(w);
      if (was === 0) navInvalidate();
    }
    return w.boards;
  }
  // track the player: zone:enter on a change, then what is drawn and where zombies may come from
  function update(pos) {
    if (!pos) return;
    const arr = Array.isArray(pos) || ArrayBuffer.isView(pos);
    const x = arr ? pos[0] : pos.x, z = arr ? pos[2] : pos.z; // no allocation: this runs every frame
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const now = W.zoneAt(x, z);
    if (!now || now === zone) return;
    const from = zone;
    zone = now;
    emit('zone:enter', { name: now, from });
    if (hooks.onZone) hooks.onZone(now);
    refresh();
  }
  function refresh() { refreshVisible(); refreshActive(); }
  // A new game: every door shut (colliders back on, the nav blocked again), the power cut, every
  // board back, and the player tracked from the start zone again (its playable box, what is drawn,
  // where zombies come from). Emits nothing.
  function reset() {
    for (const d of doors) closeDoor(d);
    if (power.on) { power.on = false; if (hooks.onPower) hooks.onPower(false); }
    for (const w of windows) if (w.boards !== w.max) { w.boards = w.max; if (hooks.onBoards) hooks.onBoards(w); }
    navInvalidate();
    zone = startZone;
    if (hooks.onZone) hooks.onZone(zone);
    refresh();
  }

  refresh();
  return {
    zones, doors, power, windows, spawnPoints, visibleZones, fixtures,
    get zone() { return zone; },
    zoneAt: (p, maybeZ) => (typeof p === 'number' ? W.zoneAt(p, maybeZ) : W.zoneAt(...xz(p))),
    openDoor, setPower, tearBoard, repairBoard, reset, update,
    activeSpawnPoints: () => active,
    reachable: (from) => new Set(reachable(from)),
    // where the player is put at the start (the zone=<name> harness param)
    setZone(name) { if (zones[name]) { zone = name; refresh(); } },
  };
}

// doors on the way from the forecourt to a zone (fewest doors)
export function doorsTo(zone) {
  const prev = new Map([['forecourt', null]]);
  const q = ['forecourt'];
  while (q.length) {
    const z = q.shift();
    if (z === zone) break;
    for (const d of W.doors) {
      const n = d.a === z ? d.b : d.b === z ? d.a : null;
      if (n && !prev.has(n)) { prev.set(n, { z, d: d.id }); q.push(n); }
    }
  }
  const out = [];
  for (let z = zone; prev.get(z); z = prev.get(z).z) out.push(prev.get(z).d);
  return out;
}

// what the ground is made of (footsteps, bullet impacts)
export function surfaceAt(x, z) {
  const s = L.surfaceAt(x, z);
  if (s === 'asphalt') return s;
  const zn = W.zoneAt(x, z);
  if (!zn) return 'dirt';
  const f = W.zones[zn].floor;
  return f === 'asphalt' ? 'asphalt' : f === 'dirt' ? 'dirt' : 'concrete';
}

// nav links: zombies through a window once its boards are off, and over or through each breach
export function navLinks(state) {
  return state.spawnPoints.map((s) => {
    const w = s.window ? state.windows.find((q) => q.id === s.window) : null;
    return { id: s.id, kind: w ? 'window' : 'fence', from: [s.pos[0], s.pos[2], 0], to: [s.to[0], s.to[2], 0], open: w ? () => w.boards === 0 : () => true };
  });
}

// interactables: the forecourt's ammo, a door each, the power switch, a board pile at each window
// (wall buys, machines, the box, the bench and the searchables come from the spots)
export function makeInteractables(state) {
  return [
    ...L.interactables,
    ...state.doors.map((d) => ({ id: `door-${d.id}`, kind: 'door', door: d.id, pos: d.pos, radius: 2, cost: d.cost, label: d.label, zone: d.a, zones: [d.a, d.b], enabled: () => !d.open })),
    { id: 'power', kind: 'power', pos: state.power.pos, radius: 1.6, cost: 0, label: 'Power', zone: state.power.zone, enabled: () => !state.power.on },
    ...state.windows.map((w) => ({
      id: `boards-${w.id}`, kind: 'boards', window: w.id, pos: [w.pos[0] - w.normal[0] * 0.9, 1.0, w.pos[2] - w.normal[2] * 0.9],
      radius: 1.6, cost: 0, label: 'Rebuild', zone: w.zone, hold: T.boards.repairEvery, enabled: () => w.boards < w.max,
    })),
  ];
}

// ---- the level ----------------------------------------------------------------------------------

const _m = new Matrix4(), _p = new Vector3(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3();
const PLANK = { h: 0.15, d: 0.035 };

export function createLevel(G) {
  const rng = G.rng.fork('level');
  const atlas = createAtlas(rng.fork('atlas'));
  const built = buildWorld({ rng, atlas });
  const zoneGeos = built.B.finishZones();
  const mats = makeMaterials(G, atlas, built.decals);

  const root = new Group();
  root.name = 'world';
  const groups = {};
  let meshes = {};
  for (const [zone, geos] of zoneGeos) {
    const g = new Group();
    g.name = zone;
    const r = meshesFor(G, geos, mats, g);
    if (zone === 'forecourt') meshes = r.meshes;
    root.add(g);
    groups[zone] = g;
  }
  for (const [zone, recs] of built.B.instances) {
    for (const rec of recs.values()) {
      const im = new InstancedMesh(rec.geometry, mats[rec.material], rec.matrices.length);
      rec.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere(); // the instances' spread: culled by three's own frustum test like any mesh
      im.frustumCulled = true;
      im.userData.noReflect = true;
      (groups[zone] || root).add(im);
    }
  }
  // boards: six planks a window, one instanced mesh per zone; a plank torn off is scaled to nothing
  const plankGeo = new BoxGeometry(1, PLANK.h, PLANK.d);
  const plankMat = new MeshStandardMaterial({ color: 0x6b5236, roughness: 0.85 });
  const boardMesh = {};
  const plankAt = new Map(); // window id -> { mesh, base }
  for (const zone of ['diner', 'motel']) {
    const ws = W.windows.filter((w) => w.zone === zone);
    const im = new InstancedMesh(plankGeo, plankMat, ws.length * T.boards.max);
    im.frustumCulled = false;
    im.userData.noReflect = true;
    ws.forEach((w, wi) => plankAt.set(w.id, { mesh: im, base: wi * T.boards.max }));
    boardMesh[zone] = im;
    (groups[zone] || root).add(im);
  }
  function setBoards(w) {
    const pa = plankAt.get(w.id);
    if (!pa) return;
    for (let i = 0; i < w.max; i++) {
      const on = i < w.boards;
      const t = (i + 0.5) / w.max;
      const y = w.sill + 0.08 + t * (w.head - w.sill - 0.16);
      const out = 0.18 + (i % 2) * 0.02;
      _p.set(w.pos[0] + w.normal[0] * out, y, w.pos[2] + w.normal[2] * out);
      _e.set(0, w.normal[0] !== 0 ? Math.PI / 2 : 0, ((i * 37) % 7 - 3) * 0.035, 'YXZ');
      _q.setFromEuler(_e);
      _s.set(on ? w.w + 0.3 : 1e-4, on ? 1 : 1e-4, on ? 1 : 1e-4);
      pa.mesh.setMatrixAt(pa.base + i, _m.compose(_p, _q, _s));
    }
    pa.mesh.instanceMatrix.needsUpdate = true;
  }
  G.scene.add(root);

  // ---- lights: the forecourt's as before (same order: their flicker phases come from one stream),
  // then each zone's, which follow the zone's visibility and the power
  const foreFix = built.fixtures.filter((f) => !f.zone);
  const lit = registerLights(G, foreFix);
  const c = G.lights && G.lights.colors ? G.lights.colors : {};
  const zoneFix = [];
  for (const f of built.fixtures.filter((q) => q.zone)) {
    if (!G.lights || typeof G.lights.add !== 'function') break;
    let h = null;
    if (f.kind === 'sodium') h = G.lights.add({ type: 'spot', pos: f.pos, dir: f.dir || [0, -1, 0], color: c.sodium, lumens: 26000, range: 24, cone: 0.98, penumbra: 0.4, size: 0.3, castShadow: true, flicker: 0.04 });
    else if (f.kind === 'tube') h = G.lights.add({ type: 'point', pos: f.pos, color: c.fluorescent, lumens: 900, range: 8, priority: 0.9, flicker: f.flicker ? { amount: 0.5, speed: 2.4, kind: 'stutter' } : 0.03 });
    else if (f.kind === 'neon') h = G.lights.add({ type: 'point', pos: f.pos, color: [1.0, 0.18, 0.4], lumens: 700, range: 9, priority: 0.8, flicker: 0.05 });
    if (!h) continue;
    zoneFix.push({ zone: f.zone, needsPower: !!f.needsPower, enabled: true, handle: h, setEnabled(on) { if (h.set) h.set({ enabled: on }); } });
  }
  G.lights.poolAlbedo = 0.04;
  G.lights.poolRoughness = 0.3;
  // Exposure for the real lot. Under the canopy the meter wants less than the post default allows,
  // and in the dark corners it must not lift the night into grey: narrow the range at both ends.
  if (G.post && G.post.uniforms && !G.post.stub) {
    G.post.uniforms.adaptMin = 0.40;
    G.post.uniforms.adaptMax = 1.5;
  }

  const col = createCollision(built.colliders, { surfaceAt });
  const activeColliders = () => built.colliders.filter((b) => !b.off);

  // ---- state, wired to the groups, the lights, the colliders and the nav
  const p = G.params || {};
  const doorOpen = (id) => !!(level && level.doors.find((q) => q.id === id).open);
  const startZone = W.zones[p.zone] ? p.zone : 'forecourt';
  let level = null;
  const state = createWorldState({
    emit: (name, payload) => G.events && G.events.emit(name, payload),
    colliders: built.colliders,
    nav: () => G.nav,
    fixtures: zoneFix,
    startZone,
    hooks: {
      // a closed door is drawn while either of its zones is
      onVisible(set) {
        for (const [name] of AREAS) if (groups[name]) groups[name].visible = set.has(name);
        for (const d of W.doors) { const g = groups[`door:${d.id}`]; if (g) g.visible = !doorOpen(d.id) && (set.has(d.a) || set.has(d.b)); }
      },
      onDoor(d) {
        const g = groups[`door:${d.id}`];
        if (g) g.visible = !d.open;
        if (level) level.colliders = activeColliders();
      },
      onPower(on) { const n = mats.neonOff && mats.neonOff.surf; if (n && n.uEOn) n.uEOn.value = on ? 1 : 0; },
      onBoards: setBoards,
      onZone(name) { const pl = W.zones[name].playable; level.playable.min = pl.min; level.playable.max = pl.max; },
    },
  });
  for (const w of state.windows) setBoards(w);
  const start = startZone === 'forecourt' ? L.playerStart : W.zoneStarts[startZone];
  const opens = new Set(p.open === 'all' ? W.doors.map((d) => d.id) : Array.isArray(p.open) ? p.open : []);
  for (const id of doorsTo(startZone)) opens.add(id);

  const interactables = makeInteractables(state);

  // Searchables, machines, the box and the bench are drawn by other tasks' props. A prop registers
  // itself in level.props[searchable.prop] or level.objects[id] with setState(state) / setSearched(b);
  // these bindings drive them from the game's events (so neither side imports the other).
  const props = {};
  const objects = {};
  const searchById = new Map(W.searchables.map((s) => [s.id, s]));
  const propOf = (id) => { const s = searchById.get(id); return s ? props[s.prop] : null; };
  const call = (o, fn, a) => { if (o && typeof o[fn] === 'function') o[fn](a); };
  const on = (name, fn) => G.events && G.events.on(name, fn);
  on('search:start', (e) => call(propOf(e && e.id), 'setState', 'searching'));
  on('search:cancel', (e) => call(propOf(e && e.id), 'setState', 'shut'));
  on('search:done', (e) => { const pr = propOf(e && e.id); call(pr, 'setState', 'open'); call(pr, 'setSearched', true); });
  on('box:roll', (e) => call(objects[e && e.spot], 'setState', 'rolling'));
  on('box:result', () => { for (const s of W.boxSpots) if (objects[s.id] && objects[s.id].state === 'rolling') call(objects[s.id], 'setState', 'offering'); });
  on('box:take', () => { for (const s of W.boxSpots) call(objects[s.id], 'setState', objects[s.id] && objects[s.id].state === 'offering' ? 'idle' : objects[s.id] && objects[s.id].state); });
  on('box:expire', (e) => call(objects[e && e.spot], 'setState', 'idle')); // the offer lapsed: the weapon goes
  on('box:move', (e) => { call(objects[e && e.from], 'setState', 'moving'); call(objects[e && e.to], 'setState', 'idle'); });
  on('power:on', () => { for (const m of W.machineSpots) call(objects[m.id], 'setState', 'live'); });
  on('machine:buy', (e) => call(objects[e && e.kind], 'setState', 'bought'));

  const foreUpdate = createForecourtUpdate(G, mats, lit);
  const playable = { min: W.zones[startZone].playable.min, max: W.zones[startZone].playable.max };
  level = {
    colliders: activeColliders(),
    raycast: col.raycast,
    moveCapsule: col.moveCapsule,
    heightAt: col.heightAt,
    bounds: W.bounds,
    playable,
    spawnPoints: state.activeSpawnPoints(), // live: refilled in place as doors open and the player moves
    allSpawnPoints: state.spawnPoints,
    playerStart: start,
    interactables,
    shots: { ...L.shots, ...W.shots },
    areas: [...L.areas, ...W.areas],
    rainOccluders: built.rainOccluders,
    reflecting: false, // a mirrored-view pass may set this true while it draws (see forecourt.js isReflection)
    root, groups, meshes, materials: mats,
    navOptions: { ...W.navOptions, links: navLinks(state) },
    // world
    zones: state.zones,
    zoneAt: state.zoneAt,
    get zone() { return state.zone; },
    visibleZones: state.visibleZones,
    doors: state.doors,
    openDoor: state.openDoor,
    power: state.power,
    setPower: state.setPower,
    windows: state.windows,
    tearBoard: state.tearBoard,
    repairBoard: state.repairBoard,
    searchables: W.searchables,
    perimeter: W.perimeter,
    polygon: W.polygon,
    insidePolygon: W.insidePolygon,
    boxSpots: W.boxSpots,
    machineSpots: W.machineSpots,
    benchSpot: W.benchSpot,
    wallBuys: W.wallBuys,
    activeSpawnPoints: state.activeSpawnPoints,
    props, objects,
    // A new game (state.js's restart calls it): doors, power, boards, nav blocks and the tracked zone
    // back to the start (the harness's open= and power= are applied again, as at boot), every
    // searchable prop shut and unsearched, every machine and box spot told to reset.
    reset() {
      state.reset();
      // machines unpowered and no box anywhere until the game places it (box:move {from:null, to});
      // before the harness's power= is applied again, which lights them
      for (const m of W.machineSpots) call(objects[m.id], 'setState', 'dead');
      for (const b of W.boxSpots) call(objects[b.id], 'setState', 'gone');
      for (const id of opens) state.openDoor(id);
      if (p.power) state.setPower(true);
      for (const s of W.searchables) { const pr = props[s.prop]; call(pr, 'setState', 'shut'); call(pr, 'setSearched', false); }
      for (const id of Object.keys(objects)) call(objects[id], 'reset');
      level.colliders = activeColliders();
    },
    update() {
      foreUpdate();
      const pos = G.player && G.player.pos;
      if (pos) state.update(pos);
    },
  };
  G.level = level;
  for (const id of opens) state.openDoor(id);
  if (p.power) state.setPower(true);
  installLayers(G);
  if (G.nav && typeof G.nav.rebuild === 'function') G.nav.rebuild();
  // portal culling, run just before the main view is drawn (the camera is final then)
  level.cull = createPortalCull(G, level);
  if (G.scene && G.camera) {
    const before = G.scene.onBeforeRender;
    G.scene.onBeforeRender = function portalCull(r, s, cam, t) {
      if (before) before.call(this, r, s, cam, t);
      if (cam === G.camera) level.cull.update(cam);
    };
  }

  // Start the shader compiles now, against the HDR target the scene is really drawn into, so the
  // driver links them in parallel while the remaining modules boot behind the progress bar. Only where
  // it can (KHR_parallel_shader_compile): elsewhere the boot's warm-up compiles them a few at a time.
  try {
    const target = G.post && G.post.targets && G.post.targets.scene;
    if (target && G.renderer.compileAsync && canCompileInParallel(G.renderer)) {
      const prev = G.renderer.getRenderTarget();
      G.renderer.setRenderTarget(target);
      level.compiled = G.renderer.compileAsync(root, G.camera, G.scene).catch(() => {});
      G.renderer.setRenderTarget(prev);
    }
  } catch (e) { /* the first frame compiles them instead */ }
  return level;
}

// ---- portal culling ----------------------------------------------------------------------------
// From inside an enclosed cell (W.cells: the diner, a motel room, the garage bays) nothing beyond its
// walls can be seen except through its openings. Each frame, just before the main view is drawn
// (scene.onBeforeRender with G.camera), every mesh of the level (each zone's buckets and art, the
// vehicles, the glass and boards) and every zombie is tested: it is drawn if its box touches the
// cell, or if its box (or its mirror image in the ground, for the puddle reflection) falls on the
// screen inside one of the cell's openings that are themselves on screen. The screen test is of
// the projected boxes' extents (conservative: anything that can show through an opening is drawn),
// and the openings are looked for in a view CULL_GUARD times wider than the camera's, so what is
// about to turn into view is already drawn (and already in the reflection the pass may hold over).
// Outside every cell nothing is culled here (three's own frustum test still runs on every mesh).
//
// A mesh left out is not hidden: it is moved to SHADOW_LAYER, which the shadow cameras see and the
// main and reflection cameras do not. So shadows stay exactly as they were (a culled zone's shadow
// proxy is what keeps a lamp outside from lighting a room through its wall), and nothing touches
// `visible`, which other code owns. No allocation per frame.
export const SHADOW_LAYER = 7;
const CULL_GUARD = 1.25; // openings are looked for this far past the screen's edge (NDC)
const CULL_MARGIN = 0.3; // metres added round every opening and every mesh box
const ZOMBIE_HALF = 1.5; // metres: a body's box round its position (arms, a lean, a corpse lying full length)
const ZOMBIE_TOP = 2.4;
const REBOX = 30; // frames between new measurements of the level's moving parts while culling
export function createPortalCull(G, level, cells = W.cells) {
  const ON = 1; // layer 0 only
  const OFF = 1 << SHADOW_LAYER;
  const entries = []; // { obj, box: Float32Array(6), mask }
  const seen = new WeakSet();
  const portals = new Float32Array(4 * 16); // visible openings' screen rects
  const corner = new Float32Array(24); // 8 corners' clip x, y, w
  const rect = new Float32Array(4);
  const vp = new Matrix4();
  const zb = new Float32Array(6);
  let scanned = -1;
  let culling = false;
  let culled = 0;
  const stats = { cell: null, portals: 0, culled: 0, zombiesCulled: 0 };
  const _b = new Box3Lite();

  function add(o) {
    if (!o.isMesh || seen.has(o)) return;
    seen.add(o);
    if (o.name === 'shadow' || o.isSkinnedMesh) return; // the shadow proxy draws in shadow passes only
    if (!_b.fromMesh(o)) return;
    // a zone's buckets and art never move; anything else (a box's lid, a pickup, a vehicle's part) is
    // measured again every REBOX frames
    const fixed = !!o.parent && (o.parent === level.root || o.parent.parent === level.root) && !o.isInstancedMesh;
    entries.push({ obj: o, box: _b.toArray(new Float32Array(6), CULL_MARGIN), mask: o.layers.mask, fixed });
  }
  let rebox = 0;
  function reboxMoving() {
    for (let i = 0; i < entries.length; i++) { const e = entries[i]; if (!e.fixed && _b.fromMesh(e.obj)) _b.toArray(e.box, CULL_MARGIN); }
  }
  function scan() {
    level.root.traverse(add);
    const v = G.scene.getObjectByName('vehicles');
    if (v) v.traverse(add);
    // the shadow cameras see the culled layer: the moon's (sky.js) and the shadowed spots' (lights.js)
    G.scene.traverse((o) => { if (o.isLight && o.shadow && o.shadow.camera) o.shadow.camera.layers.enable(SHADOW_LAYER); });
  }
  const count = () => level.root.children.length * 1000 + G.scene.children.length;

  // the screen extent of a box (min x, y, max x, y in NDC) into `rect`, clipped at the near plane;
  // false when it is wholly behind the camera
  function project(b, mirror) {
    const e = vp.elements;
    let front = 0;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? b[3] : b[0], z = k & 4 ? b[5] : b[2];
      const y = mirror ? -(k & 2 ? b[1] : b[4]) : (k & 2 ? b[4] : b[1]);
      corner[k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      corner[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      corner[k * 3 + 2] = w;
      if (w > 1e-3) front++;
    }
    if (!front) return false;
    rect[0] = Infinity; rect[1] = Infinity; rect[2] = -Infinity; rect[3] = -Infinity;
    for (let k = 0; k < 8; k++) {
      const w = corner[k * 3 + 2];
      if (w > 1e-3) put(corner[k * 3], corner[k * 3 + 1], w);
      if (front === 8) continue;
      // edges to the corners that differ in one axis: where one crosses the near plane, its crossing
      for (let bit = 1; bit < 8; bit <<= 1) {
        const j = k | bit;
        if (j === k) continue;
        const wj = corner[j * 3 + 2];
        if ((w > 1e-3) === (wj > 1e-3)) continue;
        const t = (1e-3 - w) / (wj - w);
        put(corner[k * 3] + (corner[j * 3] - corner[k * 3]) * t, corner[k * 3 + 1] + (corner[j * 3 + 1] - corner[k * 3 + 1]) * t, 1e-3);
      }
    }
    return true;
  }
  function put(x, y, w) {
    const px = x / w, py = y / w;
    if (px < rect[0]) rect[0] = px;
    if (px > rect[2]) rect[2] = px;
    if (py < rect[1]) rect[1] = py;
    if (py > rect[3]) rect[3] = py;
  }
  function throughPortal(b, n) {
    for (let m = 0; m < 2; m++) {
      if (m === 1 && b[1] <= 0.02) break; // nothing of it above the ground: no mirror image
      if (!project(b, m === 1)) continue;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        if (rect[2] >= portals[p] && rect[0] <= portals[p + 2] && rect[3] >= portals[p + 1] && rect[1] <= portals[p + 3]) return true;
      }
    }
    return false;
  }
  const touches = (b, c) => b[3] >= c.min[0] && b[0] <= c.max[0] && b[4] >= c.min[1] && b[1] <= c.max[1] && b[5] >= c.min[2] && b[2] <= c.max[2];
  const inside = (x, y, z, c) => x > c.min[0] && x < c.max[0] && y > c.min[1] && y < c.max[1] && z > c.min[2] && z < c.max[2];
  const setOn = (o, on, mask) => {
    const want = on ? mask : (mask & ~ON) | OFF;
    if (o.layers.mask === want) return false;
    o.layers.mask = want;
    return true;
  };
  function restore() {
    for (let i = 0; i < entries.length; i++) setOn(entries[i].obj, true, entries[i].mask);
    const ch = G.scene.children;
    for (let i = 0; i < ch.length; i++) if (ch[i].userData.portalCulled) zombie(ch[i], true);
    culling = false; culled = 0;
    stats.cell = null; stats.portals = 0; stats.culled = 0; stats.zombiesCulled = 0;
  }
  function zombie(o, on) {
    o.userData.portalCulled = !on;
    setOn(o, on, ON);
    const c = o.children;
    for (let i = 0; i < c.length; i++) if (c[i].isMesh) setOn(c[i], on, ON);
  }

  // The puddle reflection redraws the scene for the wet ground, which a room's floor is not: while
  // every opening of the room the camera is in is behind it, no ground can be seen and the pass is
  // switched off (by this code only: a pass someone else switched off stays off). It comes back on
  // as soon as an opening is anywhere ahead of the camera, so even a fast turn finds the image ready
  // (the ground reads it in the frame after it is drawn); only a camera cut straight to an opening
  // can show one frame of puddles without it.
  let reflection = null;
  let reflOff = false;
  let reflLook = 0;
  function reflectionWanted(want) {
    if (!reflection && reflLook-- <= 0) { reflLook = 120; reflection = G.post && !G.post.stub && G.post.getPass ? G.post.getPass('reflection') : null; }
    if (!reflection) return;
    if (!want && reflection.enabled) { reflection.enabled = false; reflOff = true; } else if (want && reflOff) { reflection.enabled = true; reflOff = false; }
  }

  function update(camera) {
    const n = count();
    if (n !== scanned) { scanned = n; scan(); }
    const ce = camera.matrixWorld.elements;
    let cell = null;
    if (api.enabled) for (let i = 0; i < cells.length; i++) if (inside(ce[12], ce[13], ce[14], cells[i].box)) { cell = cells[i]; break; }
    if (!cell) { if (culling) restore(); reflectionWanted(true); return; }
    if (!culling || ++rebox >= REBOX) { rebox = 0; reboxMoving(); }
    culling = true;
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let np = 0, ahead = 0;
    for (let i = 0; i < cell.portals.length && np < 16; i++) {
      const q = cell.portals[i];
      zb[0] = q.min[0] - CULL_MARGIN; zb[1] = q.min[1] - CULL_MARGIN; zb[2] = q.min[2] - CULL_MARGIN;
      zb[3] = q.max[0] + CULL_MARGIN; zb[4] = q.max[1] + CULL_MARGIN; zb[5] = q.max[2] + CULL_MARGIN;
      if (!project(zb, false)) continue;
      ahead++;
      if (rect[2] < -CULL_GUARD || rect[0] > CULL_GUARD || rect[3] < -CULL_GUARD || rect[1] > CULL_GUARD) continue;
      portals[np * 4] = Math.max(rect[0], -CULL_GUARD); portals[np * 4 + 1] = Math.max(rect[1], -CULL_GUARD);
      portals[np * 4 + 2] = Math.min(rect[2], CULL_GUARD); portals[np * 4 + 3] = Math.min(rect[3], CULL_GUARD);
      np++;
    }
    culled = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const on = touches(e.box, cell.box) || (np > 0 && throughPortal(e.box, np));
      setOn(e.obj, on, e.mask);
      if (!on) culled++;
    }
    // zombies (and the dead) hang straight off the scene: a box round each
    let zc = 0;
    const ch = G.scene.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (!o.isSkinnedMesh || !o.name.startsWith('zombie')) continue;
      const p = o.position;
      zb[0] = p.x - ZOMBIE_HALF; zb[1] = p.y - 0.2; zb[2] = p.z - ZOMBIE_HALF; zb[3] = p.x + ZOMBIE_HALF; zb[4] = p.y + ZOMBIE_TOP; zb[5] = p.z + ZOMBIE_HALF;
      const on = touches(zb, cell.box) || (np > 0 && throughPortal(zb, np));
      if (on === !!o.userData.portalCulled) zombie(o, on);
      if (!on) zc++;
    }
    stats.cell = cell.id; stats.portals = np; stats.culled = culled; stats.zombiesCulled = zc;
    reflectionWanted(ahead > 0);
  }

  // cells and entries are read by the walk test (scripts/perf.mjs --walk)
  const api = { enabled: true, update, stats, restore, cells, entries, get cell() { return stats.cell ? cells.find((c) => c.id === stats.cell) : null; } };
  return api;
}

// A world box of a mesh (geometry bounds, instanced spread included, times its world matrix).
class Box3Lite {
  constructor() { this.min = new Vector3(); this.max = new Vector3(); }
  fromMesh(o) {
    let bb = null;
    if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); bb = o.boundingBox; } else if (o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      bb = o.geometry.boundingBox;
    }
    if (!bb || bb.isEmpty()) return false;
    o.updateWorldMatrix(true, false);
    this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity);
    for (let k = 0; k < 8; k++) {
      _p.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
      this.min.min(_p); this.max.max(_p);
    }
    return true;
  }
  toArray(a, m) { a[0] = this.min.x - m; a[1] = this.min.y - m; a[2] = this.min.z - m; a[3] = this.max.x + m; a[4] = this.max.y + m; a[5] = this.max.z + m; return a; }
}

// The vehicle layer and the diner and motel art are installed here, once G.level
// and G.lights exist, rather than by their own poll of window.__G a frame after boot: their meshes
// are then in the shader warm-up below and in the first frame. Both are idempotent (their polls
// become no-ops; a second call returns the same layer). A failure is reported, never fatal.
function installLayers(G) {
  if (!G.lights || G.lights.stub || !G.mats || G.mats.stub || !G.scene) return;
  const report = (name, err) => {
    if (typeof window !== 'undefined' && window.__errors) window.__errors.push(`[${name}] ${err && err.message}`);
    console.error(`[${name}] ${err && err.stack ? err.stack : err}`);
  };
  try { installVehicles(G); } catch (err) { report('vehicles', err); }
  try { installAreaArt(G); } catch (err) { report('areaArt', err); }
}
