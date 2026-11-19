const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

// The island's main roads as a road graph (js/island-network.js) the planner and autopilots drive (js/navigation.js),
// on synthetic roads built through the real js/island-roads.js, and joined to a detailed-city grid at its edge
const read = (f) => readFileSync(join(__dirname, '..', f), 'utf8');
const pick = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `${what} is present`);
  return m[0];
};
const roadSrc = read('js/lane-curves.js');
const carSrc = read('js/controllers.js');
const { makeCurve, curvePoint, updateCar } = vm.runInNewContext(`
  ${pick(roadSrc, /function makeCurve\(e, i, f, j\) \{[\s\S]*?\n\}/, 'makeCurve')}
  ${pick(roadSrc, /function curvePoint\(c, s, out\) \{[\s\S]*?\n\}/, 'curvePoint')}
  ${pick(carSrc, /const CAR_DRIVE = \{[\s\S]*?\n\};/, 'CAR_DRIVE')}
  ${pick(carSrc, /function driveSpeed\(speed, throttle, dt, drive\) \{[\s\S]*?\n\}/, 'driveSpeed')}
  function updateCar${pick(carSrc, /  updateCar\(dt\) \{[\s\S]*?\n  \}/, 'updateCar').replace(/^  updateCar/, '')}
  ({ makeCurve, curvePoint, updateCar });
`, { Math, Float32Array });

const G = { Math, Number, Map, Set, WeakMap, Array, Infinity, Object, String, Float32Array, Float64Array, Int32Array, Promise, performance, setTimeout };
const islandRoads = loadModule(read('js/island-roads.js'), { globals: { ...G, fetch: () => Promise.reject(new Error('no')) }, filename: 'island-roads.js' });
const islandNet = loadModule(read('js/island-network.js'), { imports: { './lane-curves.js': { makeCurve, curvePoint } }, globals: G, filename: 'island-network.js' });
const perception = loadModule(read('js/perception.js'), { globals: G, filename: 'perception.js' });
let cityPhase = 'green';
const nav = loadModule(read('js/navigation.js'), {
  imports: { './perception.js': perception, './city-config.js': { signalPhase: () => cityPhase, nearestRoads: () => [] } },
  globals: G, filename: 'navigation.js'
});

// roads.json's encoding: [class, name, x0, z0, dx1, dz1, ...] (deltas after the first point)
function encode(cls, name, pts) {
  const out = [cls, name];
  let px = 0, pz = 0;
  for (const [x, z] of pts) {
    out.push(x - px, z - pz);
    px = x;
    pz = z;
  }
  return out;
}

// A dual carriageway (two one-way roads 10 m apart, keeping left: southbound +z on the +x side; its two lanes 1.65 m
// either side of each road's line) from z0 to z1 at x = cx, split at
// a junction at zj with an eastbound road off it (a left turn), a traffic light there; classes: 2 = primary
function island({ cx = 0, z0 = 0, zj = 500, z1 = 1000, light = true, cls = 2 } = {}) {
  const S = cx + 5, N = cx - 5;
  const roads = [
    encode(cls, 0, [[S, z0], [S, zj - 5]]), // southbound, up to the junction
    encode(cls, 0, [[S, zj - 5], [S, z1]]), // southbound, beyond it
    encode(cls, 0, [[N, z1], [N, zj + 5]]), // northbound, up to it
    encode(cls, 0, [[N, zj + 5], [N, z0]]),
    encode(cls, 1, [[S, zj - 5], [S + 150, zj - 5], [S + 300, zj - 20], [S + 600, zj - 20]]) // eastbound, with a bend
  ];
  return {
    classes: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
    names: ['Test Avenue', 'Cross Road'],
    roads,
    oneway: [1, 1, 1, 1, 1],
    lanes: [2, 2, 2, 2, 2],
    signals: light ? [cx, zj, 0] : []
  };
}

function makeCar(x, z, heading) {
  return {
    position: { x, y: 0, z }, heading, speed: 0, steerAngle: 0, angularVel: 0, vx: 0, vz: 0, type: 'car',
    pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0, wheelSpin: 0, wheels: [], carState: null,
    chassisPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
  };
}
const stepCar = (c, keys, dt) => updateCar.call({ entities: { car: c }, keys, resolveHorizontalCollision() {}, getGroundHeight: () => 0 }, dt);

function drive(network, car, driver, dest, { T = 120, each = null } = {}) {
  const keys = {};
  const controllers = {
    activeMode: 'car', getActiveEntity: () => car, userDriveInput: () => 0,
    setAutopilotInput: (i) => { for (const k of ['forward', 'backward', 'left', 'right']) keys[k] = i ? i[k] : 0; }
  };
  const n = new nav.Navigator({ network, trafficSystem: { cars: [], buses: [], peds: [] }, controllerManager: controllers });
  n.setDriver(driver);
  assert.ok(n.setDestination(dest[0], dest[1], 'x'), 'a route');
  const stats = { maxErr: 0, top: 0, maxGap: 0, t: 0, arrived: false, navigator: n, reversals: 0 };
  let t = 0;
  let lastSteer = 0;
  while (t < T && !n.arrived) {
    if (each) each(t, n, car);
    n.update(1 / 60, t);
    stepCar(car, keys, 1 / 60);
    // steering reversals (left to right and back) once under way, clear of the start and the pull-up at the end
    const steer = (keys.left || 0) - (keys.right || 0);
    if (t > 3 && n.progress > 60 && n.progress < n.path.length - 120 && Math.abs(steer) > 0.06) {
      if (lastSteer && Math.sign(steer) !== Math.sign(lastSteer)) stats.reversals++;
      lastSteer = steer;
    }
    const loc = nav.locate(n.path, car.position.x, car.position.z, n.index, 40);
    if (t > 3 && loc.s > 15 && n.progress < n.path.length - 8) stats.maxErr = Math.max(stats.maxErr, Math.abs(loc.across - n.offset));
    stats.top = Math.max(stats.top, car.speed);
    t += 1 / 60;
  }
  // (after the lead-in from where the car stood onto its lane)
  for (let i = 2; i < n.path.pts.length; i++) stats.maxGap = Math.max(stats.maxGap, n.path.pts[i].s - n.path.pts[i - 1].s);
  stats.t = t;
  stats.arrived = n.arrived;
  return stats;
}

test('the island roads become directed edges in their lanes, joined where they meet, with their lights and limits', () => {
  const roads = islandRoads.createIslandRoads(island());
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  const south = net.edges.filter((e) => e.road === roads.roads[0]);
  assert.ok(south.length >= 2, 'split at its stop line');
  for (const e of south) {
    assert.ok(Math.abs(e.dz - 1) < 1e-9, 'running its way');
    // a one-way carriageway's lanes from half a lane to the kerb side of its line (keeping left: left of it) outwards
    assert.deepEqual([...e.lanes].map((o) => +o.toFixed(2)), [-1.65, 1.65]);
    assert.equal(e.speedLimit, 16.7);
    assert.equal(e.navName, 'Test Avenue');
  }
  const atLight = south.find((e) => e.to.signal);
  assert.ok(atLight && typeof atLight.phaseAt === 'function', 'its last stretch ends at the stop line, with its phase');
  assert.ok(Math.abs(atLight.x1 - 5) < 1e-6 && Math.abs(atLight.z1 - (495 - roads.STOP_BACK)) < 1, `stop line at z ${atLight.z1}`);
  const last = south[south.length - 1];
  const turns = [...last.moves].map((m) => `${m.turn}:${m.to.navName}`).sort();
  assert.deepEqual(turns, ['L:Cross Road', 'S:Test Avenue'], 'on to both roads at the junction');
  // and shortened at the bend on the cross road, so the curve rounds it
  const cross = net.edges.filter((e) => e.road === roads.roads[4]);
  assert.ok(cross.some((e) => e.raw - e.len > 1), 'trimmed at its bend');
});

test('self-driving drives the island road through the junction and the bend, in lane, at its limit', () => {
  const roads = islandRoads.createIslandRoads(island({ light: false }));
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  const car = makeCar(5 + 1.65, 30, 0);
  const s = drive(net, car, 'self', [700, 475]);
  assert.ok(s.arrived, `arrived (${s.navigator.progress.toFixed(0)} / ${s.navigator.path.length.toFixed(0)} m)`);
  assert.ok(s.navigator.path.maneuvers.some((m) => m.turn === 'L' && m.name === 'Cross Road'), 'turned left onto Cross Road');
  assert.ok(s.maxErr < 0.7, `in lane (${s.maxErr.toFixed(2)} m)`);
  assert.ok(s.top < 16.7 + 0.4, `no faster than the 60 km/h limit (${(s.top * 3.6).toFixed(0)} km/h)`);
  assert.ok(s.top > 15.5, `and up to it (${(s.top * 3.6).toFixed(0)} km/h)`);
});

test('Crazy Taxi ignores the island\'s limits; self-driving keeps to 90 km/h on an expressway', () => {
  for (const [driver, cls, lo, hi] of [['crazy', 2, 25, 40], ['self', 0, 24.2, 25.3]]) {
    const roads = islandRoads.createIslandRoads(island({ light: false, cls, z1: 2000, zj: 1800 }));
    const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
    const s = drive(net, makeCar(6.65, 30, 0), driver, [6.65, 1700]);
    assert.ok(s.arrived);
    assert.ok(s.top > lo && s.top < hi, `${driver} on class ${cls}: top ${(s.top * 3.6).toFixed(0)} km/h`);
  }
});

test('self-driving stops at the island\'s red light and goes on green', () => {
  const roads = islandRoads.createIslandRoads(island());
  let phase = 'red';
  roads.phase = () => phase;
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  const car = makeCar(6.65, 30, 0);
  const s = drive(net, car, 'self', [6.65, 900], { T: 140, each: (t) => { phase = t < 50 ? 'red' : 'green'; } });
  const stop = s.navigator.path.stops[0];
  assert.ok(stop, 'a stop line on the way');
  assert.ok(s.arrived, 'and arrived once green');
  // replay to the stop: where did it wait?
  const car2 = makeCar(6.65, 30, 0);
  phase = 'red';
  const s2 = drive(net, car2, 'self', [6.65, 900], { T: 45 });
  const short = stop.s - s2.navigator.progress;
  assert.ok(Math.abs(car2.speed) < 0.3, `waiting (${car2.speed.toFixed(2)} m/s)`);
  assert.ok(short > 0 && short < 9, `at its stop line (${short.toFixed(1)} m short)`);
});

// The detailed city: a 2 x 2 grid of two-way streets 300 m apart (as tests/navigation.test.cjs), keeping left, over
// [0, 600]; its edge (core ring) 15 m beyond
function cityGrid(n = 2, block = 300) {
  const nodes = [];
  const at = (i, j) => nodes[i * (n + 1) + j];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) nodes.push({ x: i * block, z: j * block, signal: false });
  const edges = [];
  const box = 9;
  const link = (a, b) => {
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span;
    edges.push({ from: a, to: b, dx, dz, rx: -dz, rz: dx, sx: a.x + dx * box, sz: a.z + dz * box, len: span - 2 * box, lanes: [-5.4, -1.8], axisIndex: 0, moves: [] });
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      if (i < n) { link(at(i, j), at(i + 1, j)); link(at(i + 1, j), at(i, j)); }
      if (j < n) { link(at(i, j), at(i, j + 1)); link(at(i, j + 1), at(i, j)); }
    }
  }
  edges.forEach((e, id) => (e.id = id));
  for (const e of edges) {
    for (const f of edges) {
      if (f.from !== e.to) continue;
      const uturn = f.to === e.from;
      const cross = e.dx * f.dz - e.dz * f.dx;
      const turn = uturn ? 'R' : cross < -0.5 ? 'L' : cross > 0.5 ? 'R' : 'S';
      e.moves.push({ to: f, turn, cross, uturn, out: turn === 'S' ? [0, 1] : turn === 'L' ? [0, -1] : [-1, 1] });
    }
  }
  const curves = new Map();
  return {
    nodes, edges, keepLeft: true, curvePoint, isRoadClear: () => true, onSidewalk: () => false,
    connector(e, i, f, j) {
      const k = `${e.id}:${i}:${f.id}:${j}`;
      if (!curves.has(k)) curves.set(k, makeCurve(e, i, f, j));
      return curves.get(k);
    }
  };
}
const CORE = [-15, -15, 615, -15, 615, 615, -15, 615];

test('island roads meeting the city hand over to its streets, and back, without the city\'s own edges changing', () => {
  const city = cityGrid();
  const movesBefore = city.edges.map((e) => e.moves.length);
  // a dual carriageway south from the city's edge at x 300, from z 640
  const roads = islandRoads.createIslandRoads(island({ cx: 300, z0: 640, zj: 1300, z1: 1600, light: false }), { coreRing: CORE });
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true, city, coreRing: CORE });
  assert.deepEqual(city.edges.map((e) => e.moves.length), movesBefore, 'the city\'s edges keep their own moves');
  const handIn = net.islandEdges.flatMap((e) => e.moves).filter((m) => m.handover);
  assert.ok(handIn.length >= 1, 'island -> city');
  assert.ok([...net.extraMoves.values()].flat().length >= 1, 'city -> island');

  // into town: from the island's northbound carriageway to a corner in the city
  const inbound = drive(net, makeCar(300 - 6.65, 1500, Math.PI), 'self', [150, 300 + 5], { T: 200 });
  assert.ok(inbound.arrived, `drove into town (${inbound.navigator.progress.toFixed(0)} / ${inbound.navigator.path.length.toFixed(0)} m)`);
  assert.ok(inbound.maxGap < 5, `a continuous path (${inbound.maxGap.toFixed(1)} m gaps)`);
  assert.ok(inbound.maxErr < 1.2, `in lane (${inbound.maxErr.toFixed(2)} m)`);
  // and out: from a city street to the island
  const outbound = drive(net, makeCar(301.8, 100, 0), 'self', [300 + 6.65, 1500], { T: 200 });
  assert.ok(outbound.arrived, `drove out of town (${outbound.navigator.progress.toFixed(0)} / ${outbound.navigator.path.length.toFixed(0)} m)`);
  assert.ok(outbound.maxErr < 1.2, `in lane (${outbound.maxErr.toFixed(2)} m)`);
});

test('swerves are only taken onto the island\'s carriageways, not off them', () => {
  const roads = islandRoads.createIslandRoads(island());
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  assert.equal(net.isRoadClear(5, 200, 0.5), true, 'on the carriageway');
  assert.equal(net.isRoadClear(5 + 2.5, 200, 0.5), true, 'its outer lane');
  assert.equal(net.isRoadClear(5 + 6, 200, 0.5), false, 'off its edge');
  assert.equal(net.isRoadClear(0, 200, 0.5), false, 'the median between the carriageways');
  assert.equal(net.isRoadClear(-5, 200, 0.5), true, 'the other carriageway');
});

test('a trip on the go replans when the road graph is swapped (the island\'s roads arriving)', () => {
  const city = cityGrid();
  const roads = islandRoads.createIslandRoads(island({ cx: 300, z0: 640, zj: 1300, z1: 1600, light: false }), { coreRing: CORE });
  const joined = islandNet.createIslandNetwork(roads, { keepLeft: true, city, coreRing: CORE });
  const car = makeCar(301.8, 100, 0);
  const controllers = { activeMode: 'car', getActiveEntity: () => car, userDriveInput: () => 0, setAutopilotInput() {} };
  const n = new nav.Navigator({ network: city, trafficSystem: { cars: [], buses: [], peds: [] }, controllerManager: controllers });
  n.setDriver('self');
  const endOf = () => n.path.pts[n.path.pts.length - 1];
  assert.ok(n.setDestination(306.65, 1500, 'far'));
  assert.ok(endOf().z < 620, `the city alone gets it to its edge (z ${endOf().z.toFixed(0)})`);
  n.setNetwork(joined);
  assert.equal(n.network, joined);
  assert.ok(n.path, 'replanned');
  assert.ok(Math.hypot(endOf().x - 306.65, endOf().z - 1500) < 15, `and now all the way (${endOf().x.toFixed(0)}, ${endOf().z.toFixed(0)})`);
});

test('the app\'s resolver picks the road graph per trip: the city\'s in town, the joined one once a trip leaves it', () => {
  const city = cityGrid();
  const roads = islandRoads.createIslandRoads(island({ cx: 300, z0: 640, zj: 1300, z1: 1600, light: false }), { coreRing: CORE });
  let built = 0;
  let joined = null;
  const resolveNetwork = (a, b) => {
    if (joined) return joined;
    if (roads.inCore(a.x, a.z) && roads.inCore(b.x, b.z)) return city;
    built++;
    return (joined = islandNet.createIslandNetwork(roads, { keepLeft: true, city, coreRing: CORE }));
  };
  const car = makeCar(301.8, 100, 0);
  const controllers = { activeMode: 'car', getActiveEntity: () => car, userDriveInput: () => 0, setAutopilotInput() {} };
  const n = new nav.Navigator({ network: city, trafficSystem: { cars: [], buses: [], peds: [] }, controllerManager: controllers, resolveNetwork });
  n.setDriver('self');
  assert.ok(n.setDestination(150, 305, 'in town'));
  assert.equal(n.network, city, 'in town: the city\'s graph');
  assert.equal(built, 0);
  assert.ok(n.setDestination(306.65, 1500, 'out of town'));
  assert.equal(built, 1, 'joined once');
  assert.notEqual(n.network, city);
  assert.ok(n.setDestination(150, 305, 'back'));
  assert.equal(built, 1, 'and kept');
});

test('a destination well off the roads is driven to the road nearest it', () => {
  const roads = islandRoads.createIslandRoads(island({ light: false }));
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  // 600 m east of the carriageways, level with z 300: the nearest road is Test Avenue there
  const r = nav.planRoute(net, { x: 6.65, z: 30, heading: 0 }, { x: 600, z: 300 });
  assert.ok(r, 'a route');
  const last = r.edges[r.edges.length - 1];
  const end = { x: last.sx + last.dx * r.s1, z: last.sz + last.dz * r.s1 };
  assert.ok(Math.hypot(end.x - 600, end.z - 300) < 300, `to the nearest road (ends at ${end.x.toFixed(0)}, ${end.z.toFixed(0)})`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Built in a worker: packed to typed arrays there, put back together on the main thread, the same network
// ---------------------------------------------------------------------------------------------------------------------

function sameNetwork(a, b) {
  assert.equal(b.islandEdges.length, a.islandEdges.length, 'as many island edges');
  const ia = new Map(a.islandEdges.map((e, i) => [e, i]));
  const ib = new Map(b.islandEdges.map((e, i) => [e, i]));
  const ca = new Map(a.city.edges.map((e, i) => [e, i]));
  const cb = new Map(b.city.edges.map((e, i) => [e, i]));
  const ref = (e, im, cm) => (e.island ? `i${im.get(e)}` : `c${cm.get(e)}`);
  const close = (x, y, what) => assert.ok(Math.abs(x - y) < 1e-4, `${what}: ${x} vs ${y}`);
  for (let i = 0; i < a.islandEdges.length; i++) {
    const e = a.islandEdges[i], f = b.islandEdges[i];
    assert.equal(f.road, e.road);
    assert.equal(f.dir, e.dir);
    for (const k of ['x0', 'z0', 'x1', 'z1', 'dx', 'dz', 'sx', 'sz', 'len', 'raw']) close(f[k], e[k], `${k} of edge ${i}`);
    assert.equal(JSON.stringify(f.lanes.map((v) => +v.toFixed(4))), JSON.stringify(e.lanes.map((v) => +v.toFixed(4))));
    assert.equal(f.stranded, e.stranded);
    assert.equal(f.to.signal, e.to.signal);
    assert.equal(Boolean(f.phaseAt), Boolean(e.phaseAt));
    if (e.phaseAt) for (const t of [0, 17, 33, 51]) assert.equal(f.phaseAt(t), e.phaseAt(t));
    assert.equal(f.speedLimit, e.speedLimit);
    assert.equal(f.navName, e.navName);
    assert.equal(
      JSON.stringify(f.moves.map((m) => [ref(m.to, ib, cb), m.turn, !!m.uturn, !!m.handover, !!m.bridge, [...m.out]])),
      JSON.stringify(e.moves.map((m) => [ref(m.to, ia, ca), m.turn, !!m.uturn, !!m.handover, !!m.bridge, [...m.out]]))
    );
  }
  const extra = (n, im, cm) => JSON.stringify([...n.extraMoves].map(([c, list]) => [cm.get(c), list.map((m) => [ref(m.to, im, cm), m.turn, [...m.out]])]).sort((x, y) => x[0] - y[0]));
  assert.equal(extra(b, ib, cb), extra(a, ia, ca), 'the same city moves onto the island');
  assert.ok(a.extraMoves.size > 0 && a.islandEdges.some((e) => e.moves.some((m) => m.handover)), '(and there are some both ways)');
}

test('a network built from the city\'s topology, packed and unpacked, is the network built directly', () => {
  const city = cityGrid();
  const data = island({ cx: 300, z0: 640, zj: 1300, z1: 1600 });
  const roads = islandRoads.createIslandRoads(data, { coreRing: CORE });
  const direct = islandNet.createIslandNetwork(roads, { keepLeft: true, city, coreRing: CORE });
  // what the worker does, through a structured clone as postMessage would
  const topology = structuredClone(islandNet.cityTopology(city));
  const packed = structuredClone(islandNet.buildPackedIslandNetwork(structuredClone(data), topology, { keepLeft: true, coreRing: CORE, createRoads: islandRoads.createIslandRoads }));
  for (const k of ['geo', 'meta', 'lanes', 'mTo', 'mOut']) assert.ok(ArrayBuffer.isView(packed[k]), `${k} is a typed array`);
  assert.equal(islandNet.packedTransferables(packed).length, 10);
  const unpacked = islandNet.unpackIslandNetwork(packed, roads, { keepLeft: true, city });
  sameNetwork(direct, unpacked);
  // and it drives: into town from the island
  const s = drive(unpacked, makeCar(300 - 6.65, 1500, Math.PI), 'self', [150, 305], { T: 200 });
  assert.ok(s.arrived, 'drove into town on the unpacked network');
});

test('the worker answers a request with the packed network, and an error when it cannot', async () => {
  const data = island({ cx: 300, z0: 640, zj: 1300, z1: 1600 });
  const city = cityGrid();
  const source = read('js/island-network-worker.js');
  const posted = [];
  const self = { postMessage: (msg, transfer) => posted.push({ msg, transfer }) };
  const fetch = async (url) => (url === 'roads.json' ? { ok: true, json: async () => structuredClone(data) } : { ok: false, status: 404 });
  loadModule(source, {
    imports: {
      './island-roads.js': islandRoads,
      './island-network.js': islandNet
    },
    globals: { self, fetch, Error, String },
    filename: 'island-network-worker.js'
  });
  await self.onmessage({ data: { id: 7, url: 'roads.json', topology: islandNet.cityTopology(city), keepLeft: true, coreRing: CORE } });
  assert.equal(posted[0].msg.id, 7);
  assert.ok(posted[0].msg.packed && posted[0].msg.packed.n > 0, 'packed');
  assert.equal(posted[0].transfer.length, 10, 'its arrays transferred');
  await self.onmessage({ data: { id: 8, url: 'missing.json', topology: null, keepLeft: true, coreRing: CORE } });
  assert.equal(JSON.stringify(posted[1].msg), JSON.stringify({ id: 8, error: 'HTTP 404' }));
});

test('unpacking in slices gives the same network, a slice per pause', async () => {
  const city = cityGrid();
  const data = island({ cx: 300, z0: 640, zj: 1300, z1: 1600 });
  const roads = islandRoads.createIslandRoads(data, { coreRing: CORE });
  const packed = islandNet.buildPackedIslandNetwork(data, islandNet.cityTopology(city), { keepLeft: true, coreRing: CORE, createRoads: islandRoads.createIslandRoads });
  let pauses = 0;
  const yieldTo = (fn) => { pauses++; setImmediate(fn); };
  // a zero budget: one step (2 edges here) per slice
  const sliced = await islandNet.unpackIslandNetworkInSlices(packed, roads, { keepLeft: true, city }, { budget: 0, yieldTo, sliceEvery: 2 });
  assert.ok(pauses >= 2, `paused (${pauses})`);
  sameNetwork(islandNet.unpackIslandNetwork(packed, roads, { keepLeft: true, city }), sliced);
});

// The app's use of it (js/main.js): built in a (fake) worker that runs the real worker module
function fakeWorkerFor(data, { fail = null } = {}) {
  const source = read('js/island-network-worker.js');
  return () => {
    const w = { posted: 0, terminated: false };
    const self = {
      postMessage: (msg) => setImmediate(() => w.onmessage && w.onmessage({ data: msg }))
    };
    const fetch = async () => (fail ? { ok: false, status: fail } : { ok: true, json: async () => structuredClone(data) });
    loadModule(source, { imports: { './island-roads.js': islandRoads, './island-network.js': islandNet }, globals: { self, fetch, Error, String }, filename: 'worker' });
    w.postMessage = (msg) => { w.posted++; setImmediate(() => self.onmessage({ data: structuredClone(msg) })); };
    w.terminate = () => { w.terminated = true; };
    return w;
  };
}
const until = async (f, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const quiet = { warn() {}, info() {} };

test('the app\'s island graph: built in the worker, a trip out of town waits on the city\'s graph and gets it when ready', async () => {
  const city = cityGrid();
  const data = island({ cx: 300, z0: 640, zj: 1300, z1: 1600 });
  const roads = islandRoads.createIslandRoads(data, { coreRing: CORE });
  const handed = [];
  const graph = islandNet.createIslandGraph({ city, keepLeft: true, coreRing: CORE, makeWorker: fakeWorkerFor(data), onReady: (n) => handed.push(n), log: quiet });
  const inTown = [{ x: 100, z: 100 }, { x: 500, z: 500 }];
  const outOfTown = [{ x: 100, z: 100 }, { x: 306, z: 1500 }];
  assert.equal(graph.resolve(...outOfTown), city, 'before the roads: the city\'s');
  graph.start(roads, 'roads.json');
  assert.equal(graph.state, 'building');
  assert.equal(graph.resolve(...inTown), city);
  assert.equal(graph.resolve(...outOfTown), city, 'building: the city\'s for now');
  await until(() => graph.state === 'ready');
  assert.equal(handed.length, 1, 'handed to the waiting trip');
  const net = handed[0];
  assert.ok(net.islandEdges.length > 0 && net.city === city, 'joined to the city');
  assert.equal(graph.resolve(...inTown), net, 'and used from then on');
  assert.equal(graph.resolve(...outOfTown), net);
});

test('the app\'s island graph falls back to the main thread when the worker fails, or there is none', async () => {
  const city = cityGrid();
  const data = island({ cx: 300, z0: 640, zj: 1300, z1: 1600 });
  const roads = islandRoads.createIslandRoads(data, { coreRing: CORE });
  const outOfTown = [{ x: 100, z: 100 }, { x: 306, z: 1500 }];
  // the worker fails while a trip waits: it gets one built here
  const handed = [];
  const failing = islandNet.createIslandGraph({ city, keepLeft: true, coreRing: CORE, makeWorker: fakeWorkerFor(data, { fail: 500 }), onReady: (n) => handed.push(n), log: quiet });
  failing.start(roads, 'roads.json');
  assert.equal(failing.resolve(...outOfTown), city);
  await until(() => handed.length === 1);
  assert.equal(failing.state, 'ready');
  // no worker at all: built the first time a trip needs it
  const none = islandNet.createIslandGraph({ city, keepLeft: true, coreRing: CORE, makeWorker: () => { throw new Error('no workers'); }, log: quiet });
  none.start(roads, 'roads.json');
  assert.equal(none.state, 'main');
  const net = none.resolve(...outOfTown);
  assert.ok(net !== city && net.islandEdges.length > 0, 'built on demand');
});

// A mapped expressway: points every 8 m along a long, gentle bend, each a little off the true line (as traced from
// imagery), so the stretches between them meet at small kinks, alternately one way and the other
function kinkedExpressway({ R = 600, step = 8, jitter = 0.3, arc = 0.9 } = {}) {
  const pts = [[0, 0], [0, 200]];
  let k = 0;
  for (let a = 0; a < arc; k++) {
    a += step / R;
    const j = (k % 2 ? 1 : -1) * jitter;
    pts.push([R - (R + j) * Math.cos(a), 200 + (R + j) * Math.sin(a)]);
  }
  const L = pts[pts.length - 1];
  pts.push([L[0] + 600 * Math.sin(arc), L[1] + 600 * Math.cos(arc)]);
  return {
    data: { classes: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], names: ['Kinked Expressway'], roads: [encode(0, 0, pts)], oneway: [1], lanes: [3], signals: [] },
    end: [L[0] + 300 * Math.sin(arc), L[1] + 300 * Math.cos(arc)]
  };
}

test('on a kinked mapped bend the autopilots drive a smooth line at speed, without weaving to every kink', () => {
  const { data, end } = kinkedExpressway();
  const roads = islandRoads.createIslandRoads(data);
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  const e0 = net.edges[0];
  // (before the line was smoothed: self-driving slowed to 36 km/h on this bend and reversed its steering 70 times)
  for (const [driver, minV, maxRev] of [['self', 19, 10], ['crazy', 26, 10]]) {
    const car = makeCar(e0.sx + e0.rx * e0.lanes[1], e0.sz + e0.rz * e0.lanes[1] + 5, 0);
    let slowest = Infinity;
    const s = drive(net, car, driver, end, {
      T: 90,
      each: (t, n) => {
        // along the bend, once up to speed
        if (!n.path || n.progress < 240 || n.progress > n.path.length - 320) return;
        slowest = Math.min(slowest, car.speed);
      }
    });
    assert.ok(s.arrived, `${driver}: arrived`);
    assert.ok(slowest > minV, `${driver}: keeps its speed round the bend (slowest ${(slowest * 3.6).toFixed(0)} km/h)`);
    assert.ok(s.maxErr < (driver === 'self' ? 0.7 : 1.4), `${driver}: on its line (${s.maxErr.toFixed(2)} m)`);
    assert.ok(s.reversals <= maxRev, `${driver}: no weaving (${s.reversals} steering reversals)`);
  }
});

test('the overlay\'s mapped line is the lanes\' own, kinks and all; the planned line keeps within the cut of it', () => {
  const { data, end } = kinkedExpressway();
  const roads = islandRoads.createIslandRoads(data);
  const net = islandNet.createIslandNetwork(roads, { keepLeft: true });
  const e0 = net.edges[0];
  const car = makeCar(e0.sx + e0.rx * e0.lanes[1], e0.sz + e0.rz * e0.lanes[1] + 5, 0);
  const controllers = { activeMode: 'car', getActiveEntity: () => car, userDriveInput: () => 0, setAutopilotInput() {} };
  const n = new nav.Navigator({ network: net, trafficSystem: { cars: [], buses: [], peds: [] }, controllerManager: controllers });
  n.setDriver('self');
  assert.ok(n.setDestination(end[0], end[1], 'x'));
  const { pts, mapped } = n.path;
  // (how far each point of the planned line is from the mapped line: points also slide along it, which is no matter)
  const toMapped = (x, z, i) => {
    let d = Infinity;
    for (let j = Math.max(0, i - 8); j < Math.min(pts.length - 1, i + 8); j++) {
      const ax = mapped[j * 2], az = mapped[j * 2 + 1], ex = mapped[j * 2 + 2] - ax, ez = mapped[j * 2 + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return d;
  };
  let most = 0;
  for (let i = 0; i < pts.length; i++) most = Math.max(most, toMapped(pts[i].x, pts[i].z, i));
  assert.ok(most > 0.1, `smoothed away from the mapped line on the bend (${most.toFixed(2)} m)`);
  assert.ok(most <= nav.DRIVERS.self.cut + 1e-3, `within the cut (${most.toFixed(2)} m)`);
  const preview = n.mappedPreview(60);
  assert.ok(preview.length > 10, 'the next 60 m of it');
  assert.ok(Math.hypot(preview[0].x - car.position.x, preview[0].z - car.position.z) < 6, 'starting at the car');
  n.setDriver('you');
  assert.equal(n.mappedPreview().length, 0, 'only while an autopilot drives');
});
