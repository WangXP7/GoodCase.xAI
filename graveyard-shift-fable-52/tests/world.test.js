// The world's state (zones, doors, power, boards, spawn points) and its fixed positions.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { createAtlas } from '../src/level/atlas.js';
import { buildWorld, createWorldState, makeInteractables, doorsTo, navLinks } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';
import { buildGrid } from '../src/nav/grid.js';
import { WALK_OVER } from '../src/nav/flowfield.js';
import { tuning } from '../src/game/tuning.js';

function recorder() {
  const log = [];
  return { log, emit: (name, payload) => log.push({ name, payload }), count: (n) => log.filter((e) => e.name === n).length };
}

let world, grid;
beforeAll(() => {
  const rng = createRng(1).fork('level');
  world = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')) });
  grid = buildGrid(world.colliders.filter((c) => !c.off), W.bounds, 0.5, { bandMin: WALK_OVER, ...W.navOptions });
}, 60000);

// horizontal distance from p to the nearest walkable cell on the floor p is over
function toWalkable(p) {
  const L = grid.layerAt(p[0], p[1], p[2]);
  const k = grid.nearestWalkable(p[0], p[2], L);
  return k < 0 ? Infinity : Math.hypot(grid.centerX(k) - p[0], grid.centerZ(k) - p[2]);
}
const inside = (p, b) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];

describe('zones', () => {
  it('zoneAt names one point in each zone and null in the trees', () => {
    const s = createWorldState();
    expect(s.zoneAt(0, 0)).toBe('forecourt');
    expect(s.zoneAt([15, 0, -25])).toBe('diner');
    expect(s.zoneAt({ x: 40, y: 0, z: -20 })).toBe('motel');
    expect(s.zoneAt(40, 10)).toBe('garage');
    expect(s.zoneAt(-30, 0)).toBe(null); // west, in the wood
    expect(s.zoneAt(10, -40)).toBe(null); // behind the diner
    expect(s.zoneAt(70, 10)).toBe(null); // east of the garage
  });
  it('every zone\'s neighbour list matches the door table', () => {
    const s = createWorldState();
    for (const name of W.ZONE_NAMES) {
      const want = W.doors.filter((d) => d.a === name || d.b === name).map((d) => `${d.a === name ? d.b : d.a}:${d.id}`).sort();
      expect(s.zones[name].neighbours.map((n) => `${n.zone}:${n.door}`).sort()).toEqual(want);
    }
    // the ring and the cross-cut; every zone has at least two exits
    expect(W.doors.map((d) => d.id).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    for (const name of W.ZONE_NAMES) expect(s.zones[name].neighbours.length).toBeGreaterThanOrEqual(2);
    expect(W.doors.find((d) => d.id === 'd1').cost).toBe(tuning.world.doors.d1);
    expect(tuning.world.doors).toEqual({ d1: 750, d2: 1000, d3: 1250, d4: 1000, d5: 1500 });
  });
  it('zones carry the reverb names and the floor', () => {
    const s = createWorldState();
    const names = ['open', 'canopy', 'diner', 'kitchen', 'motelRoom', 'walkway', 'garage', 'scrapyard'];
    for (const z of Object.values(s.zones)) {
      expect(names).toContain(z.reverb);
      expect(['asphalt', 'tile', 'concrete', 'dirt']).toContain(z.floor);
      expect(z.rects.length).toBeGreaterThan(0);
    }
  });
  it('moving into another zone emits zone:enter once and changes what is drawn', () => {
    const r = recorder();
    const fixtures = [{ zone: 'diner', needsPower: false }, { zone: 'motel', needsPower: false }];
    const s = createWorldState({ emit: r.emit, fixtures });
    expect(s.zone).toBe('forecourt');
    expect([...s.visibleZones].sort()).toEqual(['forecourt', 'garage']); // the scrapyard shows through the east fence
    expect(fixtures.map((f) => f.enabled)).toEqual([false, false]); // hidden zones' lights do not compete
    s.openDoor('d1');
    expect(s.visibleZones.has('diner')).toBe(true);
    expect(fixtures[0].enabled).toBe(true);
    s.update([15, 0, -25]);
    s.update([15.5, 0, -25]);
    expect(r.count('zone:enter')).toBe(1);
    expect(r.log.find((e) => e.name === 'zone:enter').payload).toEqual({ name: 'diner', from: 'forecourt' });
    expect(s.zone).toBe('diner');
    s.update([-30, 0, 0]); // nowhere (in the trees): keeps the last zone
    expect(s.zone).toBe('diner');
  });
});

describe('doors and spawn points', () => {
  it('with all doors shut only the forecourt\'s points are active, none on the east fence', () => {
    const s = createWorldState();
    const act = s.activeSpawnPoints();
    expect(act.length).toBe(W.spawnPoints.filter((p) => p.zone === 'forecourt').length);
    for (const p of act) {
      expect(p.zone).toBe('forecourt');
      expect(p.pos[0]).toBeLessThan(20); // nothing comes over the east fence any more
    }
  });
  it('after openDoor(\'d1\') the diner\'s windows are active too', () => {
    const s = createWorldState();
    const act = s.activeSpawnPoints();
    expect(s.openDoor('d1')).toBe(true);
    expect(s.activeSpawnPoints()).toBe(act); // the same live array, refilled
    const ids = act.map((p) => p.id);
    for (const w of W.windows.filter((q) => q.zone === 'diner')) expect(ids).toContain(`sp-${w.id}`);
    expect(act.some((p) => p.zone === 'motel')).toBe(false);
  });
  it('openDoor twice returns false the second time and emits one door:open', () => {
    const r = recorder();
    const s = createWorldState({ emit: r.emit });
    expect(s.openDoor('d3')).toBe(true);
    expect(s.openDoor('d3')).toBe(false);
    expect(s.openDoor('nope')).toBe(false);
    expect(r.count('door:open')).toBe(1);
    expect(r.log[0].payload).toEqual({ id: 'd3', a: 'motel', b: 'garage' });
  });
  it('opening a door turns its colliders off and reopens its cells for the nav', () => {
    const calls = [];
    const nav = { setBlocked: (rect, v) => calls.push([rect, v]), field: { invalidate() {} } };
    const s = createWorldState({ colliders: world.colliders, nav: () => nav });
    const d = s.doors.find((q) => q.id === 'd2');
    expect(d.colliders.length).toBeGreaterThan(0);
    s.openDoor('d2');
    for (const c of d.colliders) expect(c.off).toBe(true);
    expect(calls).toHaveLength(1);
    const [u, v] = calls[0];
    expect(v).toBe(false); // always a reopen: the nav recomputes blocked cells from the colliders still on
    expect(u.x0).toBeLessThanOrEqual(d.rect.x0); expect(u.z0).toBeLessThanOrEqual(d.rect.z0);
    expect(u.x1).toBeGreaterThanOrEqual(d.rect.x1); expect(u.z1).toBeGreaterThanOrEqual(d.rect.z1);
    for (const c of d.colliders) {
      expect(u.x0).toBeLessThanOrEqual(c.min[0]); expect(u.z0).toBeLessThanOrEqual(c.min[2]);
      expect(u.x1).toBeGreaterThanOrEqual(c.max[0]); expect(u.z1).toBeGreaterThanOrEqual(c.max[2]);
    }
    s.reset();
    for (const c of d.colliders) expect(c.off).toBe(false);
    expect(calls[1][1]).toBe(false); // closing is a recompute too, not setBlocked(true)
    expect(calls[1][0]).toEqual(u);
  });
  it('a door\'s doorway is walkable in the real nav grid once open and blocked again after reset()', () => {
    const g = buildGrid(world.colliders.filter((c) => !c.off), W.bounds, 0.5, { bandMin: WALK_OVER, ...W.navOptions });
    const nav = { setBlocked: (rect, v) => g.setBlocked(rect, v), field: { invalidate() {} } };
    const s = createWorldState({ colliders: world.colliders, nav: () => nav });
    const d = s.doors.find((q) => q.id === 'd2');
    const cx = (d.rect.x0 + d.rect.x1) / 2, cz = (d.rect.z0 + d.rect.z1) / 2;
    expect(g.walkable(cx, cz, 0)).toBe(false); // shut
    s.openDoor('d2');
    expect(g.walkable(cx, cz, 0)).toBe(true); // open: the doorway is a way through
    s.reset();
    expect(g.walkable(cx, cz, 0)).toBe(false); // closed again: blocked from the colliders that are back on
  });
  it('doorsTo gives the doors on the way from the forecourt', () => {
    expect(doorsTo('forecourt')).toEqual([]);
    expect(doorsTo('diner')).toEqual(['d1']);
    expect(doorsTo('motel')).toEqual(['d5']);
    expect(doorsTo('garage')).toEqual(['d4']);
  });
});

describe('power and boards', () => {
  it('setPower(true) emits power:on once and enables the needsPower fixtures', () => {
    const r = recorder();
    const fixtures = [{ zone: 'forecourt', needsPower: true }, { zone: 'forecourt', needsPower: false }];
    const s = createWorldState({ emit: r.emit, fixtures });
    expect(fixtures.map((f) => f.enabled)).toEqual([false, true]);
    expect(s.setPower(true)).toBe(true);
    expect(s.setPower(true)).toBe(false);
    expect(r.count('power:on')).toBe(1);
    expect(s.power.on).toBe(true);
    expect(fixtures.map((f) => f.enabled)).toEqual([true, true]);
  });
  it('tearBoard goes 6 -> 0 and stays at 0; repairBoard stops at 6', () => {
    const r = recorder();
    const s = createWorldState({ emit: r.emit });
    const id = s.windows[0].id;
    expect(s.windows[0].boards).toBe(tuning.world.boards.max);
    const left = [];
    for (let i = 0; i < 8; i++) left.push(s.tearBoard(id));
    expect(left).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
    expect(r.count('board:break')).toBe(6);
    expect(r.log.filter((e) => e.name === 'board:break').at(-1).payload).toEqual({ id, left: 0 });
    const back = [];
    for (let i = 0; i < 8; i++) back.push(s.repairBoard(id));
    expect(back).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
    expect(r.count('board:repair')).toBe(6);
  });
  it('a window\'s nav link opens only when its boards are gone', () => {
    const s = createWorldState();
    const links = navLinks(s);
    const w = s.windows.find((q) => q.id === 'w-d1');
    const l = links.find((q) => q.id === 'sp-w-d1');
    expect(l.kind).toBe('window');
    expect(l.open()).toBe(false);
    for (let i = 0; i < 6; i++) s.tearBoard(w.id);
    expect(l.open()).toBe(true);
  });
  it('reset() shuts every door, cuts power and restores every board', () => {
    const s = createWorldState({ colliders: world.colliders });
    for (const d of s.doors) s.openDoor(d.id);
    s.setPower(true);
    for (const w of s.windows) for (let i = 0; i < 3; i++) s.tearBoard(w.id);
    s.reset();
    for (const d of s.doors) { expect(d.open).toBe(false); for (const c of d.colliders) expect(!!c.off).toBe(false); }
    expect(s.power.on).toBe(false);
    for (const w of s.windows) expect(w.boards).toBe(w.max);
    expect(s.activeSpawnPoints().every((p) => p.zone === 'forecourt')).toBe(true);
  });
});

describe('reset, culling and spawn points', () => {
  it('reset() restores doors, nav blocks, power, fixtures, boards and the tracked zone', () => {
    const calls = [];
    const nav = { setBlocked: (rect, v) => calls.push([rect.x0, v]), field: { invalidate() { calls.push(['inv']); } } };
    const fixtures = W.fixtures.map((f) => ({ zone: f.zone, needsPower: f.needsPower }));
    const seen = { zone: [], boards: 0, power: [] };
    const s = createWorldState({ colliders: world.colliders, nav: () => nav, fixtures, hooks: { onZone: (z) => seen.zone.push(z), onBoards: () => seen.boards++, onPower: (v) => seen.power.push(v) } });
    const before = { visible: [...s.visibleZones].sort(), active: s.activeSpawnPoints().map((p) => p.id), fixtures: fixtures.map((f) => f.enabled) };
    for (const d of s.doors) s.openDoor(d.id);
    s.setPower(true);
    for (const w of s.windows) for (let i = 0; i < 6; i++) s.tearBoard(w.id);
    s.update([40, 0, -20]); // walk into the motel
    expect(s.zone).toBe('motel');
    calls.length = 0; seen.boards = 0;
    s.reset();
    expect(s.zone).toBe('forecourt');
    expect(seen.zone.at(-1)).toBe('forecourt'); // the level's playable box follows
    expect(calls.filter((c) => c[1] === false)).toHaveLength(s.doors.length); // every door recomputes its doorway from the colliders back on (never setBlocked(true))
    expect(calls.some((c) => c[1] === true)).toBe(false);
    expect(calls.some((c) => c[0] === 'inv')).toBe(true);
    for (const d of s.doors) { expect(d.open).toBe(false); for (const c of d.colliders) expect(!!c.off).toBe(false); }
    expect(s.power.on).toBe(false);
    expect(seen.power.at(-1)).toBe(false);
    expect(seen.boards).toBe(s.windows.length);
    for (const w of s.windows) expect(w.boards).toBe(w.max);
    expect([...s.visibleZones].sort()).toEqual(before.visible);
    expect(s.activeSpawnPoints().map((p) => p.id)).toEqual(before.active);
    expect(fixtures.map((f) => f.enabled)).toEqual(before.fixtures);
    // and tracking goes on from the start zone: a step into the diner is a zone change again
    const r = recorder();
    const s2 = createWorldState({ emit: r.emit, startZone: 'forecourt' });
    s2.openDoor('d1'); s2.update([15, 0, -25]); s2.reset(); s2.update([15, 0, -25]);
    expect(r.log.filter((e) => e.name === 'zone:enter').map((e) => e.payload)).toEqual([{ name: 'diner', from: 'forecourt' }, { name: 'diner', from: 'forecourt' }]);
  });
  it('the forecourt and the scrapyard see each other through the chain-link, whatever the doors', () => {
    const s = createWorldState();
    expect(s.visibleZones.has('garage')).toBe(true); // at the start, every door shut
    expect(s.activeSpawnPoints().some((p) => p.zone === 'garage')).toBe(false); // drawn, but no way in
    s.setZone('garage');
    expect(s.visibleZones.has('forecourt')).toBe(true);
    s.setZone('diner');
    expect(s.visibleZones.has('garage')).toBe(false); // shut in the diner: the yard is out of sight
    s.openDoor('d1');
    expect(s.visibleZones.has('garage')).toBe(true); // through the front door, across the lot
  });
  it('spawn points come only from zones that are drawn', () => {
    const s = createWorldState({ startZone: 'motel' });
    for (const id of ['d2', 'd1', 'd4']) s.openDoor(id); // motel -> diner -> forecourt -> garage: three doors
    expect(s.reachable('motel').has('garage')).toBe(true);
    expect(s.visibleZones.has('garage')).toBe(false);
    expect(s.activeSpawnPoints().some((p) => p.zone === 'garage')).toBe(false);
    for (const p of s.activeSpawnPoints()) expect(s.visibleZones.has(p.zone)).toBe(true);
  });
});

describe('fixed positions', () => {
  it('46 searchables with unique ids, 12 / 8 / 14 / 12 by zone, of the known kinds', () => {
    expect(W.searchables.length).toBe(46);
    expect(new Set(W.searchables.map((s) => s.id)).size).toBe(46);
    const n = {};
    for (const s of W.searchables) n[s.zone] = (n[s.zone] || 0) + 1;
    expect(n).toEqual({ forecourt: 12, diner: 8, motel: 14, garage: 12 });
    const kinds = ['car', 'barrel', 'crate', 'bin', 'locker', 'icebox', 'suitcase', 'dresser', 'toolchest'];
    for (const s of W.searchables) {
      expect(kinds).toContain(s.kind);
      expect(typeof s.prop).toBe('string');
      expect(Number.isFinite(s.yaw)).toBe(true);
      expect(W.zoneAt(s.pos[0], s.pos[2]), s.id).toBe(s.zone);
    }
  });
  it('every searchable is within 1.6 m of walkable ground and none is inside a collider', () => {
    for (const s of W.searchables) {
      expect(toWalkable(s.pos), `${s.id} far from walkable ground`).toBeLessThanOrEqual(1.6);
      const hit = world.colliders.find((c) => inside(s.pos, c));
      expect(hit, `${s.id} inside collider ${hit && hit.prop}`).toBeFalsy();
    }
  });
  it('3 box spots, one in each zone but the start', () => {
    expect(W.boxSpots.length).toBe(3);
    expect(W.boxSpots.map((b) => b.zone).sort()).toEqual(['diner', 'garage', 'motel']);
    for (const b of W.boxSpots) expect(W.zoneAt(b.pos[0], b.pos[2])).toBe(b.zone);
  });
  it('every interactable has a zone and lies within 2 m of walkable ground', () => {
    const s = createWorldState({ colliders: world.colliders });
    const list = makeInteractables(s);
    expect(list.filter((i) => i.kind === 'door').length).toBe(5);
    expect(list.filter((i) => i.kind === 'boards').length).toBe(W.windows.length);
    expect(list.filter((i) => i.kind === 'power').length).toBe(1);
    const spots = [...W.wallBuys, ...W.machineSpots, ...W.boxSpots, W.benchSpot, { id: 'power', zone: 'garage', pos: W.power.pos }];
    for (const i of [...list, ...spots]) {
      expect(W.ZONE_NAMES, i.id).toContain(i.zone);
      expect(toWalkable(i.pos), `${i.id} far from walkable ground`).toBeLessThanOrEqual(2);
    }
    // a door is reachable from both its sides
    for (const d of s.doors) {
      const n = d.rect.x1 - d.rect.x0 > d.rect.z1 - d.rect.z0 ? [0, 1] : [1, 0];
      for (const sgn of [-1, 1]) expect(toWalkable([d.pos[0] + n[0] * sgn * 1.2, 0, d.pos[2] + n[1] * sgn * 1.2]), `${d.id} side ${sgn}`).toBeLessThanOrEqual(0.8);
    }
  });
  it('every zone has a machine spot and a wall buy; the bench and the power are in the garage', () => {
    for (const z of W.ZONE_NAMES) {
      expect(W.machineSpots.filter((m) => m.zone === z).length).toBe(1);
      expect(W.wallBuys.filter((m) => m.zone === z).length).toBe(1);
    }
    expect(W.benchSpot.zone).toBe('garage');
    expect(W.zoneAt(W.power.pos[0], W.power.pos[2])).toBe('garage');
  });
});
