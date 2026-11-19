import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createIslandRoads, signalPhase } from '../js/island-roads.js';
import * as STREET_COLLIDERS from '../js/street-colliders.js';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');

// roads.json as tools/city/tiles.mjs writes it: [class, name, x0, z0, dx, dz, ...]
function encode(list) {
  const classes = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
  const names = [];
  const roads = list.map(({ cls, name = '', pts }) => {
    if (name && !names.includes(name)) names.push(name);
    const r = [classes.indexOf(cls), name ? names.indexOf(name) : -1];
    let px = 0, pz = 0;
    for (const [x, z] of pts) { r.push(x - px, z - pz); px = x; pz = z; }
    return r;
  });
  return { classes, names, roads, oneway: list.map((r) => r.oneway || 0), lanes: list.map((r) => r.lanes || 2) };
}

// An east-west primary road through the island (two-way, 4 lanes), a one-way road carrying on from its east end, a
// north-south expressway; the detailed city a square around the origin
const ROADS = encode([
  { cls: 'primary', name: 'Test Avenue', pts: [[1000, 0], [1500, 0], [2000, 0]], lanes: 4 },
  { cls: 'secondary', name: 'One Way Street', pts: [[2000, 0], [2400, 0]], oneway: 1, lanes: 2 },
  { cls: 'secondary', name: 'Wrong Way Street', pts: [[2400, 300], [2000, 0]], oneway: 1, lanes: 2 },
  { cls: 'motorway', name: 'Test Expressway', pts: [[3000, -2000], [3000, 2000]], oneway: 1, lanes: 3 }
]);
const CORE = [-500, -500, 500, -500, 500, 500, -500, 500];

test('the island\'s roads: the nearest point, and arrivals in a lane of the nearest road, facing its traffic', () => {
  const roads = createIslandRoads(ROADS, { coreRing: CORE });
  assert.equal(roads.roads.length, 4);
  const p = roads.nearest(1200, 30, 100);
  assert.equal(p.road.name, 'Test Avenue');
  assert.deepEqual([p.x, p.z, Math.round(p.dist)], [1200, 0, 30]);
  assert.equal(roads.nearest(1200, 300, 100), null, 'nothing within 100 m');
  // heading east (h = pi / 2 faces +x): keeping left of the centre line (north of it, -z), in the kerbside lane
  const east = roads.snap(1200, 30, Math.PI / 2, 500, true);
  assert.ok(Math.abs(east.heading - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(east.z - -1.5 * 3.3) < 1e-6, `two lanes each way: the kerbside one, 1.5 lanes left (${east.z})`);
  // heading west: the other carriageway, south of the centre line
  const west = roads.snap(1200, 30, -Math.PI / 2, 500, true);
  assert.ok(Math.abs(west.heading + Math.PI / 2) < 1e-9 && west.z > 0);
  // the expressway runs one way only (south, +z): heading north still arrives facing south; walkers stay off it
  const exp = roads.snap(2950, 0, Math.PI, 500, true);
  assert.ok(Math.abs(exp.heading) < 1e-9, 'facing south, with the traffic');
  assert.equal(roads.snap(2950, 0, 0, 2000, true, { expressways: false }).road.name, 'One Way Street');
  // in the detailed city: none (its own road graph takes the arrival)
  assert.equal(roads.snap(0, 100, 0, 600, true), null);
});

test('the island\'s roads carry on into the ones that may be driven onwards, never against a one-way', () => {
  const roads = createIslandRoads(ROADS, { coreRing: CORE });
  const avenue = roads.roads[0];
  const east = roads.next(avenue, 1);
  assert.deepEqual(east.map((o) => o.road.name), ['One Way Street'], 'Wrong Way Street only arrives here');
  assert.equal(east[0].dir, 1);
  assert.deepEqual(roads.next(avenue, -1), [], 'a dead end at the west end');
  // a pose along a road driven against its points, offset to the left of travel
  const p = roads.pose(avenue, -1, 250, 2);
  assert.deepEqual([p.x, p.z, p.dx, p.dz + 0], [1750, 2, -1, 0], 'driving west, 2 m to its left is south (+z)');
});

// js/island-traffic.js with three.js & the car models stubbed (the driving runs unchanged)
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } }
const THREE = {
  Group: class { constructor() { this.children = []; } add(...c) { this.children.push(...c); } },
  Color: class { constructor(hex) { this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; } },
  InstancedMesh: class { constructor(geometry, material, n) { this.geometry = geometry; this.count = n; this.instanceMatrix = { array: new Float32Array(n * 16) }; } },
  InstancedBufferAttribute: class { constructor(array) { this.array = array; } },
  Matrix4: class { compose() { return this; } toArray() {} },
  Quaternion: class { setFromAxisAngle() { return this; } },
  Vector3: V3
};
const geometry = () => ({ attributes: {}, setAttribute(k, a) { this.attributes[k] = a; } });
const { vehicleContact } = loadModule(fs.readFileSync(new URL('../js/vehicle-physics.js', import.meta.url), 'utf8'), { globals: { Math } });
const { createIslandTraffic } = loadModule(fs.readFileSync(new URL('../js/island-traffic.js', import.meta.url), 'utf8'), {
  imports: {
    'three/webgpu': THREE,
    './actor-models.js': { BODY_SPECS: { taxi: {}, sedan: {}, suv: {} }, buildCarGeometry: geometry, buildCarProxyGeometry: geometry, createLoftedCarMaterial: () => ({}) },
    './vehicle-physics.js': { vehicleContact }
  },
  globals: { Math, Float32Array, Infinity }
});

function camera(x, z) {
  return { position: new V3(x, 40, z), getWorldDirection(v) { return v.set(1, 0, 0); } };
}

test('island traffic: cars appear on the roads around the camera, keep their lane, carry on and keep their distance', () => {
  const roads = createIslandRoads(ROADS, { coreRing: CORE });
  const scene = { add() {} };
  const traffic = createIslandTraffic(scene, { vehicles: { taxis: [0x1f63c3] }, keepLeft: true, count: 12 });
  traffic.setRoads(roads);
  const cam = camera(1600, 0);
  for (let i = 0; i < 30 * 60; i++) traffic.update(1 / 30, cam, null, 'helicopter');
  const active = traffic.cars.filter((c) => c.active);
  assert.ok(active.length >= 6, `cars on the nearby roads (${active.length})`);
  for (const c of active) {
    assert.ok(!roads.inCore(c.x, c.z), 'none in the detailed city');
    assert.ok(Math.hypot(c.x - cam.position.x, c.z - cam.position.z) <= 760 + 30, 'kept around the camera');
    // keeping left: the left of travel is (dz, -dx); a two-way road's cars are on their own side of its centre line
    const p = roads.nearest(c.x, c.z, 20);
    assert.ok(p, 'on a road');
    if (!p.road.oneway) {
      const side = (c.x - p.x) * c.dz - (c.z - p.z) * c.dx;
      assert.ok(side > 1, `left of the centre line (${side.toFixed(2)})`);
    } else {
      assert.ok(c.dx * p.dx + c.dz * p.dz > 0.99, 'with a one-way road\'s traffic');
    }
    assert.ok(c.v <= 16.7 * 1.1 + 0.01, 'within the fastest of these roads\' limits');
  }
  // no two cars in one lane closer than a car length and the standstill gap
  for (const a of active) {
    for (const b of active) {
      if (a === b || a.road !== b.road || a.dir !== b.dir || Math.abs(a.off - b.off) > 1) continue;
      assert.ok(Math.abs(a.s - b.s) > 4.6 + 1.5, `gap ${Math.abs(a.s - b.s).toFixed(1)} m`);
    }
  }
  assert.ok(traffic.stats.recycled > 0, 'cars leave and come back');
});

test('island traffic stops behind the player and gets bumped out of the way', () => {
  const roads = createIslandRoads(ROADS, { coreRing: CORE });
  const traffic = createIslandTraffic({ add() {} }, { keepLeft: true, count: 1 });
  traffic.setRoads(roads);
  const cam = camera(2200, 0);
  traffic.update(1 / 30, cam, null, 'helicopter');
  const c = traffic.cars[0];
  assert.ok(c.active);
  // put the car on One Way Street heading east and a stopped player 40 m ahead of it in its lane
  Object.assign(c, { road: roads.roads[1], dir: 1, s: 100, lane: 0, off: roads.laneOffset(roads.roads[1], 0), v: 12 });
  const ahead = roads.pose(c.road, 1, 140, c.off);
  const player = { position: new V3(ahead.x, 0, ahead.z), heading: Math.PI / 2, speed: 0 };
  for (let i = 0; i < 30 * 20; i++) traffic.update(1 / 30, cam, player, 'car');
  const gap = Math.hypot(player.position.x - c.x, player.position.z - c.z);
  assert.ok(c.v < 0.2 && gap > 4.6 && gap < 4.6 + 6, `stopped behind the player (${gap.toFixed(1)} m, ${c.v.toFixed(2)} m/s)`);
  assert.equal(c.byPlayer, true, 'held up by the player (the audio honks)');
  // the player reverses into it: pushed back out
  player.position.x = c.x + 2;
  player.position.z = c.z;
  traffic.update(1 / 30, cam, player, 'car');
  const hit = {};
  const overlap = vehicleContact({ x: player.position.x, z: player.position.z, sin: 1, cos: 0, halfW: 0.92, halfL: 2.25 },
    { x: c.x, z: c.z, sin: c.dx, cos: c.dz, halfW: 0.92, halfL: 2.25 }, hit);
  assert.ok(!overlap || hit.depth < 1e-6, `no overlap left (${overlap && hit.depth})`);
  assert.ok(c.stunned > 0 && c.v < 0.2, 'the car stops for a moment');
});

// A crossroads with traffic lights at (1500, 0): Test Avenue east-west and a two-way north-south road through it
function crossroads() {
  const data = encode([
    { cls: 'primary', name: 'Test Avenue', pts: [[1000, 0], [1500, 0], [2000, 0]], lanes: 4 },
    { cls: 'secondary', name: 'Cross Street', pts: [[1500, -500], [1500, 0], [1500, 500]], lanes: 2 },
    { cls: 'motorway', name: 'Test Expressway', pts: [[1520, -500], [1520, 500]], oneway: 1, lanes: 3 }
  ]);
  data.signals = [1500, 0, 0];
  return createIslandRoads(data, { coreRing: CORE });
}

test('traffic lights: on the roads through their junction, the widest one\'s axis green while the other\'s is red', () => {
  const roads = crossroads();
  assert.equal(roads.signals.length, 1);
  const [avenue, cross, expressway] = roads.roads;
  const signal = roads.signals[0];
  assert.deepEqual(avenue.signals.map((g) => [g.group, Math.round(g.s)]), [[0, 500]], 'the avenue along the axis');
  assert.deepEqual(cross.signals.map((g) => g.group), [1], 'the cross street across it');
  assert.equal(expressway.signals, undefined, 'none on the expressway passing by');
  assert.equal(signal.approaches.length, 4, 'two ways in on each road');
  // the two groups are never green together, and each gets its turn
  const seen = { 0: new Set(), 1: new Set() };
  for (let t = 0; t < 60; t += 0.25) {
    const a = signalPhase(signal, 0, t), b = signalPhase(signal, 1, t);
    assert.ok(a === 'red' || b === 'red', `t ${t}: ${a} / ${b}`);
    seen[0].add(a); seen[1].add(b);
  }
  assert.deepEqual([...seen[0]].sort(), ['amber', 'green', 'red']);
  assert.deepEqual([...seen[1]].sort(), ['amber', 'green', 'red']);
  // the stop line ahead of a car driving east, 11 m before the junction; none once past it
  const ahead = roads.signalAhead(avenue, 1, 400);
  assert.equal(Math.round(ahead.d), 500 - 11 - 400);
  assert.equal(roads.signalAhead(avenue, 1, 495), null);
  // and driving west from the far end
  assert.equal(Math.round(roads.signalAhead(avenue, -1, 400).d), 500 - 11 - 400);
});

test('island traffic stops at a red light and goes on green', () => {
  const roads = crossroads();
  const traffic = createIslandTraffic({ add() {} }, { keepLeft: true, count: 1 });
  traffic.setRoads(roads);
  const cam = camera(1500, 300);
  traffic.update(1 / 30, cam, null, 'helicopter', 0);
  const c = traffic.cars[0];
  const signal = roads.signals[0];
  // the time the avenue turns red: drive at it from 150 m out
  let t = 0;
  while (signalPhase(signal, 0, t) !== 'red') t += 0.1;
  Object.assign(c, { road: roads.roads[0], dir: 1, s: 350, lane: 0, off: roads.laneOffset(roads.roads[0], 0), v: 14, desire: 1 });
  for (let i = 0; i < 30 * 25 && signalPhase(signal, 0, t) === 'red'; i++, t += 1 / 30) traffic.update(1 / 30, cam, null, 'helicopter', t);
  const stopLine = 500 - 11;
  assert.ok(c.v < 0.3, `stopped (${c.v.toFixed(2)} m/s)`);
  assert.ok(c.s + 2.3 <= stopLine + 0.5 && c.s > stopLine - 12, `at the stop line (front ${(c.s + 2.3).toFixed(1)}, line ${stopLine})`);
  // then green: it pulls away through the junction
  while (signalPhase(signal, 0, t) !== 'green') t += 0.5;
  for (let i = 0; i < 30 * 15; i++, t += 1 / 30) traffic.update(1 / 30, cam, null, 'helicopter', t);
  assert.ok(c.road !== roads.roads[0] || c.s > 520, `through the junction (${c.road.name} at ${c.s.toFixed(0)})`);
});

test('junctions part way along a road: the T where a side road ends on it, the crossing at a light', () => {
  const data = encode([
    { cls: 'primary', name: 'Main Road', pts: [[1000, 0], [1500, 0], [2000, 0]], lanes: 4 },
    { cls: 'secondary', name: 'Side Road', pts: [[1300, 0], [1300, 400]], lanes: 2 },
    { cls: 'secondary', name: 'Cross Street', pts: [[1700, -400], [1700, 400]], lanes: 2 }
  ]);
  data.signals = [1700, 0, 0];
  const roads = createIslandRoads(data, { coreRing: CORE });
  const [main, side, cross] = roads.roads;
  assert.deepEqual(main.junctions.map((j) => [Math.round(j.s), j.exits.map((e) => `${e.road.name} ${e.dir}`).sort()]),
    [[300, ['Side Road 1']], [700, ['Cross Street -1', 'Cross Street 1']]]);
  assert.deepEqual(side.junctions, undefined, 'none along the side road');
  // where the side road ends on Main Road part way, it carries on along it either way
  const fromSide = roads.next(side, -1).map((o) => [o.road.name, o.dir, Math.round(o.s)]).sort();
  assert.deepEqual(fromSide, [['Main Road', -1, 700], ['Main Road', 1, 300]], '300 m along it, 700 m in driving west');
  const ahead = roads.junctionAhead(main, 1, 600, 150);
  assert.equal(Math.round(ahead.d), 100);
  assert.equal(roads.junctionAhead(main, -1, 0, 400).junction.s, 700, 'driving west, the crossing first');
  void cross;
});

test('island traffic turns off at a junction: slows, indicates, rounds the corner into the new road\'s lane', () => {
  const roads = crossroads();
  const traffic = createIslandTraffic({ add() {} }, { keepLeft: true, count: 1 });
  traffic.setRoads(roads);
  const cam = camera(1500, 300);
  traffic.update(1 / 30, cam, null, 'helicopter', 0);
  const c = traffic.cars[0];
  const signal = roads.signals[0];
  const [avenue, cross] = roads.roads;
  // green for the avenue from here on: driving east at it from 120 m out, planning to turn right (south, across the
  // oncoming lanes: the inside lane) at the crossing
  let t = 0;
  while (signalPhase(signal, 0, t) !== 'green' || signalPhase(signal, 0, t + 12) !== 'green') t += 0.1;
  Object.assign(c, { road: avenue, dir: 1, s: 380, lane: 1, off: roads.laneOffset(avenue, 1), v: 14, desire: 1, plan: null, curve: null });
  const J = avenue.junctions[0];
  const south = J.exits.find((e) => e.road === cross && e.dir === 1);
  assert.ok(south, 'the crossing leads south');
  c.plan = { road: avenue, dir: 1, at: J.s, exit: south, side: 1 };
  c.blink = 1;
  let prev = null, maxStep = 0, minSpeedInTurn = Infinity, blinked = false;
  for (let i = 0; i < 30 * 14; i++, t += 1 / 30) {
    traffic.update(1 / 30, cam, null, 'helicopter', t);
    if (prev) maxStep = Math.max(maxStep, Math.hypot(c.x - prev[0], c.z - prev[1]));
    prev = [c.x, c.z];
    if (c.curve) minSpeedInTurn = Math.min(minSpeedInTurn, c.v);
    blinked ||= c.blink === 1;
  }
  assert.equal(c.road, cross);
  assert.equal(c.dir, 1);
  assert.ok(blinked, 'indicating right');
  assert.ok(c.blink === 0 && !c.curve, 'the turn done');
  assert.ok(minSpeedInTurn <= 7, `slowed for the corner (${minSpeedInTurn.toFixed(1)} m/s)`);
  assert.ok(maxStep < 0.75, `no jumps (${maxStep.toFixed(2)} m in a frame)`);
  // heading south keeping left: east of the centre line (x > 1500), in the inside lane (next to the line)
  assert.ok(c.x > 1500 && c.x < 1500 + 3.3, `in the inside lane (${(c.x - 1500).toFixed(2)} m from the line)`);
  assert.ok(Math.abs(c.dx) < 0.02 && c.dz > 0.99, 'facing south');
});

// js/island-signals.js with three.js stubbed: the lights and their red light camera
const geo = class { translate() { return this; } scale() { return this; } };
const SIGNAL_THREE = {
  ...THREE,
  InstancedMesh: class { constructor(g, m, n) { this.count = n; this.instanceMatrix = { array: new Float32Array(n * 16) }; } setMatrixAt() {} setColorAt() {} },
  CylinderGeometry: geo, BoxGeometry: geo, SphereGeometry: geo,
  MeshStandardNodeMaterial: class {}, MeshBasicNodeMaterial: class {},
  Color: class { constructor() {} }
};
const { createIslandSignals } = loadModule(fs.readFileSync(new URL('../js/island-signals.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': SIGNAL_THREE, './street-colliders.js': STREET_COLLIDERS }, globals: { Math, Float32Array, Map, Infinity, Number }
});

test('the island\'s red light cameras: crossing a stop line on red is fined, on green or across it not', () => {
  const roads = crossroads();
  const lights = createIslandSignals({ add() {} }, { keepLeft: true });
  lights.setRoads(roads);
  const cam = camera(1480, 0);
  lights.update(cam, 0);
  const signal = roads.signals[0];
  let red = 0, green = 0;
  while (signalPhase(signal, 0, red) !== 'red') red += 0.25;
  while (signalPhase(signal, 0, green) !== 'green') green += 0.25;
  // driving east on the avenue's left carriageway (north of its line, -z), through the stop line 11 m before the crossing
  const drive = (time, z = -3, heading = Math.PI / 2, speed = 12) => {
    const player = { type: 'car', position: { x: 1480, z }, heading, speed };
    let fined = false;
    for (let x = 1480; x <= 1495; x += 0.5) { player.position.x = x; fined ||= lights.ranRed(player, time); }
    return fined;
  };
  assert.equal(drive(green), false, 'on green');
  assert.equal(drive(red), true, 'on red');
  assert.equal(drive(red + 1), false, 'once per light for a while');
  assert.equal(drive(red + 60 * 3, -3, Math.PI / 2, 1), false, 'not crawling over it at walking pace');
  assert.equal(drive(red + 60 * 4, 3), false, 'not on the other carriageway (going the other way)');
  assert.equal(drive(red + 60 * 5, -3, -Math.PI / 2), false, 'not reversing over it');
  assert.equal(drive(red + 60 * 6), true, 'again later');
  assert.equal(lights.ranRed({ type: 'cyclist', position: { x: 1490, z: -3 }, heading: Math.PI / 2, speed: 8 }, red), false);
});

test('island cars are heard: the nearest active ones become engine voices, the far and parked-away ones not', () => {
  const { CityAudioSources } = loadModule(fs.readFileSync(new URL('../js/audio-sources.js', import.meta.url), 'utf8'), {
    imports: { './city-config.js': { signalPhase: () => 'green', walkSignal: () => false } },
    globals: { Math, Number, Float64Array, Array }
  });
  const heli = { type: 'helicopter', position: { x: 0, y: 300, z: 0 }, mesh: { visible: true }, speed: 0, heading: 0, verticalSpeed: 0 };
  const car = (x, z, v, active = true, extra = {}) => ({ active, x, z, dx: 1, dz: 0, v, acc: 0, kind: 'sedan', ...extra });
  const islandCars = [car(2010, 0, 12), car(2050, 0, 0, true, { light: 'red' }), car(2100, 0, 0), car(2600, 0, 14), car(2005, 0, 9, false)];
  const sources = new CityAudioSources({
    controllerManager: { entities: { helicopter: heli }, getActiveEntity: () => heli, keys: {}, getGroundHeight: () => 0 },
    trafficSystem: { cars: [], buses: [], peds: [] }, highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] },
    islandTraffic: { cars: islandCars }
  });
  const snap = sources.collect({ x: 2000, y: 1.5, z: 0 }, 0);
  const heard = [...snap.motors].filter((m) => islandCars.includes(m.id));
  assert.deepEqual(heard.map((m) => islandCars.indexOf(m.id)), [0, 1, 2], 'the three nearby active cars, nearest first');
  assert.equal(heard[0].kind, 'sedan');
  assert.ok(Math.abs(heard[0].heading - Math.PI / 2) < 1e-9, 'facing its way (east)');
  assert.deepEqual(heard.map((m) => m.blocked), [false, false, true], 'waiting at a red light is not stuck; standing for nothing is');
  assert.ok(snap.traffic > 0, 'counted in the traffic rumble');
});

test('where a road ends at a junction, cars go straight on mostly and turn now and then, rounding the corner', () => {
  // three roads meeting end to end at (2000, 0): one in from the west, one on east, one off south
  const data = encode([
    { cls: 'secondary', name: 'In', pts: [[1600, 0], [2000, 0]], oneway: 1, lanes: 2 },
    { cls: 'secondary', name: 'On', pts: [[2000, 0], [2400, 0]], oneway: 1, lanes: 2 },
    { cls: 'secondary', name: 'Off', pts: [[2000, 0], [2000, 400]], oneway: 1, lanes: 2 }
  ]);
  const roads = createIslandRoads(data, { coreRing: CORE });
  const [inRoad, on, off] = roads.roads;
  const went = { On: 0, Off: 0 };
  let maxStep = 0, blinkedOff = 0;
  const traffic = createIslandTraffic({ add() {} }, { keepLeft: true, count: 1 });
  traffic.setRoads(roads);
  const cam = camera(2000, 0);
  traffic.update(1 / 30, cam, null, 'helicopter', 0);
  const c = traffic.cars[0];
  for (let k = 0; k < 60; k++) {
    Object.assign(c, { road: inRoad, dir: 1, s: 300, lane: 1, off: roads.laneOffset(inRoad, 1), v: 12, desire: 1, plan: null, curve: null, blink: 0, active: true });
    traffic.update(1 / 30, cam, null, 'helicopter', 0);
    let prev = [c.x, c.z], blinked = 0;
    for (let i = 0; i < 30 * 30 && (c.road === inRoad || c.curve); i++) {
      traffic.update(1 / 30, cam, null, 'helicopter', 0);
      maxStep = Math.max(maxStep, Math.hypot(c.x - prev[0], c.z - prev[1]));
      prev = [c.x, c.z];
      if (c.blink) blinked = c.blink;
    }
    if (c.road === on) went.On++;
    if (c.road === off) { went.Off++; if (blinked === 1) blinkedOff++; }
  }
  assert.equal(went.On + went.Off, 60);
  assert.ok(went.On > went.Off && went.Off > 0, `straight on mostly, some turning (${JSON.stringify(went)})`);
  assert.equal(blinkedOff, went.Off, 'indicating right before turning off south');
  assert.ok(maxStep < 0.75, `round the corner, no jumps (${maxStep.toFixed(2)} m in a frame)`);
});

test('the island\'s signal poles are solid for the player: one collider per approach, where its pole stands', () => {
  const roads = crossroads();
  const lights = createIslandSignals({ add() {} }, { keepLeft: true });
  assert.equal(lights.colliders().length, 0, 'none before the roads');
  lights.setRoads(roads);
  const cols = lights.colliders();
  const approaches = roads.signals.flatMap((s) => s.approaches);
  assert.equal(cols.length, approaches.length);
  for (const [i, a] of approaches.entries()) {
    const c = cols[i];
    assert.ok(c.minX < a.x && a.x < c.maxX && c.minZ < a.z && a.z < c.maxZ, 'around the pole');
    assert.ok(c.maxX - c.minX < 0.4 && c.maxY > 3.5, 'thin and tall');
  }
});
