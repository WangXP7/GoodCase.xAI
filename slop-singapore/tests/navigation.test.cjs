const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

// The navigator against a synthetic street grid, with the road network's own lane-to-lane curves and the player car's
// own speed model (both lifted from the production sources), so the autopilot is tested on the physics it drives.
const roadSource = readFileSync(join(__dirname, '../js/lane-curves.js'), 'utf8');
const carSource = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');
const pick = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `${what} is present`);
  return m[0];
};
const { makeCurve, curvePoint, updateCar } = vm.runInNewContext(`
  ${pick(roadSource, /function makeCurve\(e, i, f, j\) \{[\s\S]*?\n\}/, 'makeCurve')}
  ${pick(roadSource, /function curvePoint\(c, s, out\) \{[\s\S]*?\n\}/, 'curvePoint')}
  ${pick(carSource, /const CAR_DRIVE = \{[\s\S]*?\n\};/, 'CAR_DRIVE')}
  ${pick(carSource, /function driveSpeed\(speed, throttle, dt, drive\) \{[\s\S]*?\n\}/, 'driveSpeed')}
  // the player car's own update (ThirdPersonControllerManager.updateCar), run on a stand-in manager
  function updateCar${pick(carSource, /  updateCar\(dt\) \{[\s\S]*?\n  \}/, 'updateCar').replace(/^  updateCar/, '')}
  ({ makeCurve, curvePoint, updateCar });
`, { Math, Float32Array });

let phase = 'green';
const perception = loadModule(readFileSync(join(__dirname, '../js/perception.js'), 'utf8'), {
  globals: { Math, Number, Map, Set, WeakMap, Array, Infinity, Object },
  filename: 'perception.js'
});
const nav = loadModule(readFileSync(join(__dirname, '../js/navigation.js'), 'utf8'), {
  imports: {
    './perception.js': perception,
    './city-config.js': {
      signalPhase: () => phase,
      nearestRoads: () => []
    }
  },
  globals: { Math, Number, Map, Set, WeakMap, Array, Infinity, Object, Float64Array },
  filename: 'navigation.js'
});

// A grid of two-way streets `n` x `n` blocks of `block` metres, two lanes each way, keeping left as in Singapore.
// Every corner is signalised; streets running north-south are group 0.
function grid(n = 4, block = 100) {
  const nodes = [];
  const at = (i, j) => nodes[i * (n + 1) + j];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) nodes.push({ x: i * block, z: j * block, signal: true, i, j });
  const edges = [];
  const box = 9; // half the intersection box
  const link = (a, b) => {
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / span;
    const dz = (b.z - a.z) / span;
    edges.push({
      from: a, to: b, dx, dz, rx: -dz, rz: dx,
      sx: a.x + dx * box, sz: a.z + dz * box, len: span - 2 * box,
      lanes: [-5.4, -1.8], // left of the centreline: keep left
      axisIndex: Math.abs(dz) > 0.5 ? 0 : 1, moves: []
    });
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
      // straight on from either lane, left turns from the left lane, right turns & U-turns from the right one
      const out = turn === 'S' ? [0, 1] : turn === 'L' ? [0, -1] : [-1, 1];
      e.moves.push({ to: f, turn, cross, uturn, out });
    }
  }
  const curves = new Map();
  return {
    nodes, edges, keepLeft: true,
    connector(e, i, f, j) {
      const k = `${e.id}:${i}:${f.id}:${j}`;
      if (!curves.has(k)) curves.set(k, makeCurve(e, i, f, j));
      return curves.get(k);
    },
    curvePoint,
    isRoadClear: () => true,
    // pavements: 7.2-11 m either side of each street's centre line
    onSidewalk: (x, z) => {
      const dx = Math.abs(x - Math.round(x / block) * block);
      const dz = Math.abs(z - Math.round(z / block) * block);
      return (dx > 7.2 && dx < 11 && dz > 11) || (dz > 7.2 && dz < 11 && dx > 11);
    }
  };
}

// The player's car, moved by controllers.js's own updateCar (grip, steering, slip), on open ground
function makeCar(x, z, heading) {
  return {
    position: { x, y: 0, z }, heading, speed: 0, steerAngle: 0, angularVel: 0, vx: 0, vz: 0, type: 'car',
    pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0, wheelSpin: 0, wheels: [], carState: null,
    chassisPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
  };
}
function stepCar(c, keys, dt) {
  updateCar.call({ entities: { car: c }, keys, resolveHorizontalCollision() {}, getGroundHeight: () => 0 }, dt);
}

function rig(network, car, traffic = { cars: [], buses: [], peds: [] }, islandTraffic = null) {
  const keys = {};
  const controllers = {
    activeMode: 'car',
    getActiveEntity: () => car,
    setAutopilotInput: (input) => {
      for (const k of ['forward', 'backward', 'left', 'right']) keys[k] = input ? input[k] : 0;
    },
    userDriveInput: () => 0
  };
  const events = [];
  const navigator = new nav.Navigator({ network, trafficSystem: traffic, islandTraffic, controllerManager: controllers, onEvent: (kind, d) => events.push([kind, d]) });
  return { navigator, keys, events };
}

function run({ navigator, keys }, car, seconds, dt = 1 / 60, each = null) {
  let t = 0;
  let maxOff = 0;
  while (t < seconds && !navigator.arrived) {
    navigator.update(dt, t);
    stepCar(car, keys, dt);
    if (navigator.path) {
      const loc = nav.locate(navigator.path, car.position.x, car.position.z, navigator.index, 40);
      maxOff = Math.max(maxOff, loc.dist);
    }
    if (each) each(t);
    t += dt;
  }
  return { t, maxOff };
}

test('routes take the moves between edges and end at the destination', () => {
  const net = grid();
  // heading +z (south) on the grid's west street, in its inner southbound lane (keeping left: +x of the centreline)
  const route = nav.planRoute(net, { x: 1.8, z: 50, heading: 0 }, { x: 300, z: 300 });
  assert.ok(route, 'a route is found');
  for (let k = 0; k < route.moves.length; k++) assert.equal(route.moves[k].to, route.edges[k + 1]);
  const last = route.edges[route.edges.length - 1];
  const end = { x: last.sx + last.dx * route.s1, z: last.sz + last.dz * route.s1 };
  assert.ok(Math.hypot(end.x - 300, end.z - 300) < 12, `ends at the destination (${end.x.toFixed(1)}, ${end.z.toFixed(1)})`);
  // the length is about the Manhattan distance
  assert.ok(route.length > 500 && route.length < 700, `length ${route.length}`);
});

test('a destination behind the car on its own street is reached by going round the block', () => {
  const net = grid();
  const route = nav.planRoute(net, { x: 1.8, z: 70, heading: 0 }, { x: 1.8, z: 30 });
  assert.ok(route);
  assert.ok(route.edges.length > 1, 'drives round rather than reversing');
  // (by a U-turn at the next corner onto the other side of the street, or round the block)
  const last = route.edges[route.edges.length - 1];
  const end = { x: last.sx + last.dx * route.s1, z: last.sz + last.dz * route.s1 };
  assert.ok(Math.hypot(end.x - 1.8, end.z - 30) < 8, 'ends at the destination');
});

test('the path keeps to its lanes, changes lane before a turn and slows for the corner', () => {
  const net = grid();
  const route = nav.planRoute(net, { x: 1.8, z: 20, heading: 0 }, { x: 200, z: 100 });
  const path = nav.buildPath(net, route, 1.8, 20);
  assert.ok(path.pts.length > 20);
  // (after the lead-in from where the car stands onto its lane)
  for (let i = 2; i < path.pts.length; i++) {
    const gap = path.pts[i].s - path.pts[i - 1].s;
    assert.ok(gap > 0.3 && gap < 5, `point spacing ${gap}`);
  }
  // speed: zero at the end, never above cruise, slower in the corner than on the straight
  assert.equal(path.pts[path.pts.length - 1].v, 0);
  assert.ok(Math.max(...path.pts.map((p) => p.v)) <= nav.DRIVERS.self.cruise + 1e-9);
  const turn = path.maneuvers.find((m) => m.turn !== 'S');
  assert.ok(turn, 'there is a turn');
  const cornerV = Math.min(...path.pts.filter((p) => Math.abs(p.s - turn.s - 6) < 6).map((p) => p.v));
  assert.ok(cornerV < 9, `corner speed ${cornerV}`);
  // turning left (east from southbound, keeping left) is taken from the left lane
  assert.equal(turn.turn, 'L');
  const before = path.pts[turn.i];
  const e = turn.from;
  const across = (before.x - e.sx) * e.rx + (before.z - e.sz) * e.rz;
  // (its smoothed line may ease into the corner, within its cut of the lane's middle)
  assert.ok(Math.abs(across - e.lanes[0]) < nav.DRIVERS.self.cut + 0.05, `in the left lane at the turn (${across})`);
});

test('pure pursuit steers toward the target with the right sign', () => {
  // heading 0 faces +z; a target ahead and to +x needs the heading to grow toward pi/2: steering left (+)
  assert.ok(nav.pursuitSteer(0, 0, 0, 10, 5, 20) > 0);
  assert.ok(nav.pursuitSteer(0, 0, 0, 10, -5, 20) < 0);
  assert.equal(Math.round(nav.pursuitSteer(0, 0, 0, 10, 0, 20) * 1e6), 0);
});

test('self-driving drives the car to the destination on its lanes and stops there', () => {
  phase = 'green';
  const net = grid();
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car);
  r.navigator.setDriver('self');
  assert.ok(r.navigator.setDestination(300, 200, 'Test'));
  const { t, maxOff } = run(r, car, 180);
  assert.ok(r.navigator.arrived, `arrived (t ${t.toFixed(1)}s, ${r.navigator.progress.toFixed(0)} / ${r.navigator.path.length.toFixed(0)} m)`);
  assert.ok(maxOff < 2.2, `kept within ${maxOff.toFixed(2)} m of its path`);
  assert.ok(Math.hypot(car.position.x - 300, car.position.z - 200) < 14);
  assert.ok(Math.abs(car.speed) < 1.5);
  assert.ok(r.events.some(([k]) => k === 'arrived'));
});

test('self-driving stops at a red light and goes on green', () => {
  const net = grid();
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car);
  r.navigator.setDriver('self');
  r.navigator.setDestination(1.8, 260, 'South');
  phase = 'red';
  run(r, car, 25);
  const stop = r.navigator.path.stops[0];
  assert.ok(stop, 'there is a signal on the way');
  assert.ok(Math.abs(car.speed) < 0.3, `stopped (${car.speed.toFixed(2)} m/s)`);
  const gap = stop.s - r.navigator.progress;
  assert.ok(gap > 0 && gap < 9, `at the stop line (${gap.toFixed(1)} m short)`);
  phase = 'green';
  run(r, car, 6);
  assert.ok(car.speed > 3, 'pulls away on green');
});

function chase(driver, slowCars, seconds = 16) {
  const net = grid();
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car, { cars: slowCars, buses: [], peds: [] });
  r.navigator.setDriver(driver);
  r.navigator.setDestination(1.8, 380, 'South');
  let minGap = Infinity;
  let passed = false;
  let minX = Infinity;
  run(r, car, seconds, 1 / 60, (t) => {
    for (const v of slowCars) v.z += v.speed / 60;
    const lead = slowCars[0];
    for (const v of slowCars) {
      const along = v.z - car.position.z;
      if (Math.abs(v.x - car.position.x) < 1.8) minGap = Math.min(minGap, Math.abs(along) - 4.6);
    }
    if (lead.z - car.position.z < -6) passed = true;
    if (car.position.z > 25) minX = Math.min(minX, car.position.x);
  });
  return { car, passed, minGap, minX };
}
const slowCar = (x, z, speed = 3) => ({ edge: {}, x, z, speed, tx: 0, tz: 1, half: 2.3, halfWidth: 0.9 });

test('self-driving overtakes slow traffic in its own direction\'s other lane, Crazy Taxi anywhere through a red', () => {
  phase = 'green';
  const self = chase('self', [slowCar(1.8, 60)]);
  assert.ok(self.passed, 'self-driving gets past in the other lane');
  assert.ok(self.minGap > 0.5, `without coming close (${self.minGap.toFixed(2)} m)`);
  assert.ok(self.minX > 0.3, `never crossing into the oncoming lanes (x ${self.minX.toFixed(2)})`);
  phase = 'red';
  const crazy = chase('crazy', [slowCar(1.8, 60)]);
  assert.ok(crazy.passed, 'Crazy Taxi gets past');
  assert.ok(crazy.minGap > 0, `without hitting it (${crazy.minGap.toFixed(2)} m)`);
  phase = 'green';
});

test('self-driving stays behind when both of its lanes are blocked', () => {
  phase = 'green';
  const r = chase('self', [slowCar(1.8, 60), slowCar(5.4, 60)]);
  assert.ok(!r.passed, 'stays behind');
  assert.ok(r.minGap > 0.5, `keeps its distance (${r.minGap.toFixed(2)} m)`);
  assert.ok(Math.abs(r.car.speed - 3) < 1.5, `matches the speed (${r.car.speed.toFixed(1)})`);
});

test('touching the controls hands the car back', () => {
  const net = grid();
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car);
  let user = 0;
  r.navigator.controllers.userDriveInput = () => user;
  r.navigator.setDriver('self');
  r.navigator.setDestination(300, 300, 'Far');
  run(r, car, 2);
  user = 1;
  r.navigator.update(1 / 60, 2);
  assert.equal(r.navigator.driver.id, 'you');
  assert.ok(r.events.some(([k]) => k === 'takeover'));
  assert.ok(!r.keys.forward && !r.keys.left && !r.keys.right, 'autopilot input released');
});

test('Crazy Taxi gets there much faster than the self-driving taxi, and is paid for it', () => {
  const times = {};
  for (const driver of ['self', 'crazy']) {
    phase = 'green';
    const net = grid(6, 120);
    const car = makeCar(1.8, 20, 0);
    const r = rig(net, car);
    r.navigator.setDriver(driver);
    r.navigator.setDestination(600, 600, 'Far');
    let top = 0;
    const { t, maxOff } = run(r, car, 240, 1 / 60, () => { top = Math.max(top, car.speed); });
    assert.ok(r.navigator.arrived, `${driver} arrived`);
    assert.ok(maxOff < 4, `${driver} stayed near its path (${maxOff.toFixed(2)} m)`);
    times[driver] = { t, top };
    if (driver === 'crazy') {
      const done = r.events.find(([k]) => k === 'arrived')[1];
      assert.ok(done.fare && done.fare.total > done.fare.base, `fare ${done.fare && done.fare.total}`);
    }
  }
  assert.ok(times.crazy.top > 25, `Crazy Taxi floors it (${times.crazy.top.toFixed(1)} m/s)`);
  assert.ok(times.self.top < 25.2, `self-driving keeps to 90 km/h (${(times.self.top * 3.6).toFixed(0)} km/h)`);
  assert.ok(times.crazy.t < times.self.t * 0.85, `faster: ${times.crazy.t.toFixed(0)} s vs ${times.self.t.toFixed(0)} s`);
});

test('self-driving goes round stalled cars through the clear oncoming lane after waiting a while', () => {
  phase = 'green';
  const r = chase('self', [slowCar(1.8, 60, 0), slowCar(5.4, 60, 0)], 30);
  // (up to the cars, ~8 s waiting, then round them)
  assert.ok(r.passed, 'gets past');
  assert.ok(r.minGap > 0.3, `without touching them (${r.minGap.toFixed(2)} m)`);
  assert.ok(r.minX < 0, 'using the oncoming lane');
});

// ---------------------------------------------------------------------------------------------------------------------
// Lane keeping & car following on the car's own physics (updateCar: steering lag, yaw lag, tyre slip)
// ---------------------------------------------------------------------------------------------------------------------

// How far apart the taxi and `o` are (m, < 0 overlapping), body to body: each as a run of circles along its length
function clearance(car, o) {
  const body = (x, z, hx, hz, half, hw) => {
    const n = Math.max(1, Math.round(half / hw));
    const span = Math.max(0, half - hw);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
      out.push([x + hx * a, z + hz * a]);
    }
    return { out, r: hw + 0.12 };
  };
  const a = body(car.position.x, car.position.z, Math.sin(car.heading), Math.cos(car.heading), 2.25, 0.9);
  const l = Math.hypot(o.tx ?? 0, o.tz ?? 1) || 1;
  const b = o.half === undefined ? body(o.x, o.z, 0, 1, 0.35, 0.35) : body(o.x, o.z, (o.tx ?? 0) / l, (o.tz ?? 1) / l, o.half, o.halfWidth);
  let gap = Infinity;
  for (const [ax, az] of a.out) for (const [bx, bz] of b.out) gap = Math.min(gap, Math.hypot(ax - bx, az - bz) - a.r - b.r);
  return gap;
}

// Drives `driver` to `dest` on a grid, measuring how far the car strays from its line (the path plus the
// autopilot's chosen offset) and how often the steering reverses on straight road
function track(driver, dest, { dt = 1 / 60, T = 240, cars = [], peds = [], each = null, start = [1.8, 20, 0], net = grid(6, 120) } = {}) {
  const car = makeCar(...start);
  const r = rig(net, car, { cars, buses: [], peds });
  r.navigator.setDriver(driver);
  assert.ok(r.navigator.setDestination(dest[0], dest[1], 'x'), 'route found');
  const stats = { maxErr: 0, straightErr: 0, reversals: 0, minGap: Infinity, minClear: Infinity, t: 0 };
  let lastSteer = 0;
  let t = 0;
  let minSpeed = Infinity;
  let topSpeed = 0;
  while (t < T && !r.navigator.arrived) {
    if (t > 5) minSpeed = Math.min(minSpeed, car.speed);
    topSpeed = Math.max(topSpeed, car.speed);
    r.navigator.update(dt, t);
    stepCar(car, r.keys, dt);
    for (const v of cars) {
      if (each) each(v, t, car, r.navigator);
      v.x += (v.tx ?? 0) * v.speed * dt;
      v.z += (v.tz ?? 1) * v.speed * dt;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const along = (v.x - car.position.x) * fx + (v.z - car.position.z) * fz;
      const across = Math.abs((v.x - car.position.x) * fz - (v.z - car.position.z) * fx);
      if (across < 1.8 && along > -2) stats.minGap = Math.min(stats.minGap, along - 4.5);
    }
    for (const o of [...cars, ...peds]) {
      if (o.placed === false) continue;
      stats.minClear = Math.min(stats.minClear, clearance(car, o));
    }
    const p = r.navigator.path;
    const loc = nav.locate(p, car.position.x, car.position.z, r.navigator.index, 40);
    // once moving and clear of the lead-in from where the car stood
    if (t > 2 && loc.s > 12 && r.navigator.progress < p.length - 6) {
      const err = Math.abs(loc.across - r.navigator.offset);
      // (not while it holds its lane against the path's own lane change: its line is then the lane, not the path)
      if (r.navigator.holdLane == null) stats.maxErr = Math.max(stats.maxErr, err);
      // straight road: no curvature within 25 m either side, and no lane change of the path's (a long, gentle one at
      // speed curves too little to count as a bend)
      const quiet = p.pts.every((q, i) => Math.abs(q.s - loc.s) > 25 || (q.k < 0.004 && !(p.pts[i + 1] && Math.abs(p.pts[i + 1].lane - q.lane) > 0.005)));
      if (quiet && Math.abs(r.navigator.offsetTarget - r.navigator.offset) < 0.05 && !r.navigator.holdLane) {
        stats.straightErr = Math.max(stats.straightErr, err);
        const s = (r.keys.left || 0) - (r.keys.right || 0);
        if (Math.abs(s) > 0.08) {
          if (lastSteer && Math.sign(s) !== Math.sign(lastSteer)) stats.reversals++;
          lastSteer = s;
        }
      }
    }
    t += dt;
  }
  stats.t = t;
  stats.arrived = r.navigator.arrived;
  stats.car = car;
  stats.navigator = r.navigator;
  stats.minSpeedAfter5 = minSpeed;
  stats.topSpeed = topSpeed;
  return stats;
}

test('self-driving holds its lane: through lane changes and turns, at 30, 60 and 120 fps', () => {
  phase = 'green';
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const s = track('self', [600, 600], { dt });
    const fps = Math.round(1 / dt);
    assert.ok(s.arrived, `${fps} fps: arrived`);
    assert.ok(s.maxErr < 0.6, `${fps} fps: never more than 0.6 m off its line (${s.maxErr.toFixed(2)} m)`);
    assert.ok(s.straightErr < 0.15, `${fps} fps: on straights within 0.15 m (${s.straightErr.toFixed(2)} m)`);
    assert.ok(s.reversals <= 2, `${fps} fps: no weaving on straights (${s.reversals} steering reversals)`);
  }
});

test('Crazy Taxi holds its line at speed, through its swerves and the corners', () => {
  phase = 'green';
  for (const dt of [1 / 30, 1 / 60]) {
    const s = track('crazy', [600, 600], { dt });
    assert.ok(s.arrived, 'arrived');
    assert.ok(s.maxErr < 0.9, `within 0.9 m of its line (${s.maxErr.toFixed(2)} m)`);
    assert.ok(s.straightErr < 0.25, `on straights within 0.25 m (${s.straightErr.toFixed(2)} m)`);
    assert.ok(s.reversals <= 3, `no weaving (${s.reversals} reversals)`);
  }
});

test('self-driving follows a car that brakes to a stop and pulls away, keeping its distance', () => {
  phase = 'green';
  const lead = slowCar(1.8, 70, 10);
  const s = track('self', [1.8, 700], {
    T: 40, cars: [lead],
    each: (v, t) => { v.speed = t < 8 ? 10 : t < 11 ? Math.max(0, 10 - (t - 8) * 4) : t < 18 ? 0 : Math.min(12, (t - 18) * 2); }
  });
  assert.ok(s.minGap > 1.2, `never closer than 1.2 m (${s.minGap.toFixed(2)} m)`);
  assert.ok(s.navigator.progress > 300, 'and goes on with it');
});

test('self-driving brakes for a slower car that cuts in close ahead, without hitting it', () => {
  phase = 'green';
  // out of sight until the taxi is up to speed, then in the next lane just ahead, moving over into the taxi's
  const lead = slowCar(5.4, -500, 4);
  let cut = false;
  const s = track('self', [1.8, 700], {
    T: 25, cars: [lead],
    each: (v, t, car) => {
      // at a second's headway, doing half the taxi's speed
      if (!cut && t > 6) {
        cut = true;
        v.z = car.position.z + 4.5 + car.speed * 1.0;
        v.speed = car.speed * 0.5;
      }
      if (cut && v.x > 1.8) v.x = Math.max(1.8, v.x - 2 / 60);
    }
  });
  assert.ok(cut, 'the cut-in happened');
  assert.ok(s.minGap > 0.5, `no collision (${s.minGap.toFixed(2)} m)`);
});

test('self-driving follows a car along its route, round the corner, without closing in', () => {
  phase = 'green';
  // the lead drives the taxi's own path 25 m ahead at 8 m/s, slowing to 3 m/s round the left turn
  const lead = slowCar(1.8, 45, 8);
  lead.s = 25;
  const at = {};
  const s = track('self', [200, 120], {
    T: 60, cars: [lead],
    each: (v, t, car, navigator) => {
      const p = navigator.path;
      const q = nav.pointAt(p, Math.min(p.length, v.s), 0, at);
      v.speed = Math.min(8, Math.max(3, q.v));
      v.s += v.speed / 60;
      const q2 = nav.pointAt(p, Math.min(p.length, v.s), 0, at);
      // placed so the harness's own integration lands it on the path
      v.tx = q2.tx; v.tz = q2.tz;
      v.x = q2.x - v.tx * v.speed / 60;
      v.z = q2.z - v.tz * v.speed / 60;
    }
  });
  assert.ok(s.minGap > 1.5, `keeps at least 1.5 m (${s.minGap.toFixed(2)} m)`);
  assert.ok(s.maxErr < 0.6, `in its lane while following (${s.maxErr.toFixed(2)} m)`);
});

test('self-driving keeps going past cars in the next lane and oncoming ones', () => {
  phase = 'green';
  // a slow car alongside in the next lane its way, and a stream of oncoming cars on the other side of the road
  const beside = slowCar(5.4, 40, 3);
  const oncoming = [0, 1, 2, 3, 4].map((k) => ({ ...slowCar(-1.8, 300 + k * 40, 10), tz: -1 }));
  const s = track('self', [1.8, 700], { T: 30, cars: [beside, ...oncoming] });
  assert.ok(s.minSpeedAfter5 > 11, `never slows for them (${s.minSpeedAfter5.toFixed(1)} m/s)`);
  assert.ok(s.navigator.offsetTarget === 0, 'and stays in its lane');
});

// ---------------------------------------------------------------------------------------------------------------------
// 90 km/h: up to the limit on a long straight, and able to stop from it
// ---------------------------------------------------------------------------------------------------------------------

test('self-driving cruises at 90 km/h on a long clear road, no faster', () => {
  phase = 'green';
  let top = 0;
  const s = track('self', [1.8, 1400], { net: grid(2, 750), T: 120 });
  top = s.topSpeed;
  assert.ok(s.arrived, 'arrived');
  assert.ok(top > 24.5 && top < 25.2, `reaches 90 km/h (${(top * 3.6).toFixed(1)} km/h)`);
  assert.ok(s.maxErr < 0.6, `in its lane at speed (${s.maxErr.toFixed(2)} m)`);
});

test('self-driving stops for a red light from 90 km/h', () => {
  phase = 'green';
  const net = grid(2, 750);
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car);
  r.navigator.setDriver('self');
  r.navigator.setDestination(1.8, 1450, 'x');
  // up to speed, then the light at the end of the block turns red ~190 m out
  let t = 0;
  while (car.speed < 24.5 && t < 40) { r.navigator.update(1 / 60, t); stepCar(car, r.keys, 1 / 60); t += 1 / 60; }
  const stop = r.navigator.path.stops[0];
  while (stop.s - r.navigator.progress > 190) { r.navigator.update(1 / 60, t); stepCar(car, r.keys, 1 / 60); t += 1 / 60; }
  phase = 'red';
  let hardest = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const v0 = car.speed;
    r.navigator.update(1 / 60, t); stepCar(car, r.keys, 1 / 60); t += 1 / 60;
    hardest = Math.max(hardest, (v0 - car.speed) * 60);
  }
  phase = 'green';
  const short = stop.s - r.navigator.progress;
  assert.ok(Math.abs(car.speed) < 0.3, `stopped (${car.speed.toFixed(2)} m/s)`);
  assert.ok(short > 0 && short < 9, `at the line (${short.toFixed(1)} m short)`);
  assert.ok(hardest < 4.5, `without slamming the brakes (${hardest.toFixed(1)} m/s²)`);
});

test('self-driving stops behind a stalled car from 90 km/h', () => {
  phase = 'green';
  const stalled = slowCar(1.8, 900, 0);
  const s = track('self', [1.8, 1450], { net: grid(2, 750), T: 70, cars: [stalled] });
  assert.ok(s.minGap > 1.5, `stops clear of it (${s.minGap.toFixed(2)} m)`);
});

test('self-driving follows traffic at its speed: settles behind a car doing 60 km/h', () => {
  phase = 'green';
  // its other lane blocked by a car alongside at the same speed, so it can only follow
  const lead = slowCar(1.8, 200, 16.7);
  const beside = slowCar(5.4, 200, 16.7);
  let speedAt40 = 0;
  const s = track('self', [1.8, 2200], {
    net: grid(3, 750), T: 50, cars: [lead, beside],
    each: (v, t, car) => { if (t > 40 && !speedAt40) speedAt40 = car.speed; }
  });
  assert.ok(Math.abs(speedAt40 - 16.7) < 1, `matches its speed (${(speedAt40 * 3.6).toFixed(0)} km/h)`);
  assert.ok(s.minGap > 8, `at a safe distance (${s.minGap.toFixed(1)} m)`);
});

test('self-driving waits for a gap before moving over for a turn, instead of merging into a car alongside', () => {
  phase = 'green';
  // its route turns left at the end of the block, from the kerbside lane (x 5.4, keeping left); a car rides in that lane
  // beside it
  const net = grid(2, 300);
  const car = makeCar(1.8, 20, 0);
  const beside = slowCar(5.4, 20, 0);
  const r = rig(net, car, { cars: [beside], buses: [], peds: [] });
  r.navigator.setDriver('self');
  assert.ok(r.navigator.setDestination(200, 300, 'east'), 'route found');
  assert.ok(r.navigator.path.maneuvers.some((m) => m.turn === 'L'), 'the route turns left');
  let overlap = 0;
  let t = 0;
  let changedAt = null;
  while (t < 60 && !r.navigator.arrived) {
    // the car alongside keeps pace until 200 m, then drops back
    beside.speed = beside.z < 200 ? car.speed : Math.max(0, beside.speed - 4 / 60);
    beside.z += beside.speed / 60;
    r.navigator.update(1 / 60, t);
    stepCar(car, r.keys, 1 / 60);
    if (Math.abs(car.position.x - beside.x) < 1.9 && Math.abs(car.position.z - beside.z) < 4.6) overlap++;
    if (changedAt === null && car.position.x > 3.6 && car.position.z < 300) changedAt = car.position.z;
    t += 1 / 60;
  }
  assert.equal(overlap, 0, 'never in the same space as the car alongside');
  assert.ok(changedAt === null || changedAt > 200, `moves over once it's clear (at z ${changedAt && changedAt.toFixed(0)})`);
  assert.ok(r.navigator.arrived, 'and makes the turn');
});

// ---------------------------------------------------------------------------------------------------------------------
// Seeing the traffic coming: tracks estimated from what it sees, predicted ahead, and avoided
// ---------------------------------------------------------------------------------------------------------------------

// A car that runs the red across the taxi's junction (z 300 on a 300 m grid), timed to arrive just as the taxi does
function redRunner(driver) {
  phase = 'green';
  const runner = { edge: {}, x: -400, z: 300 - 1.8, speed: 0, tx: 1, tz: 0, half: 2.3, halfWidth: 0.9 };
  let launched = false;
  const s = track(driver, [1.8, 560], {
    net: grid(2, 300), T: 60, cars: [runner],
    each: (v, t, car) => {
      // once the taxi is 70 m short of the junction, the runner appears 70 m to its side doing what the taxi does
      if (!launched && 300 - car.position.z < 70 + 2.25) {
        launched = true;
        v.speed = Math.max(12, car.speed);
        v.x = -(300 - car.position.z) * (v.speed / Math.max(1, car.speed)) + 0.5;
      }
    }
  });
  assert.ok(launched, 'the runner went');
  return s;
}

test('self-driving sees a car running the red across its junction and stops for it', () => {
  const s = redRunner('self');
  assert.ok(s.minClear > 0.8, `well clear of it (${s.minClear.toFixed(2)} m)`);
  assert.ok(s.navigator.progress > 400, 'and goes on after it');
});

test('Crazy Taxi gets out of the red runner\'s way too, closer', () => {
  const s = redRunner('crazy');
  assert.ok(s.minClear > 0, `no collision (${s.minClear.toFixed(2)} m)`);
});

test('self-driving avoids an oncoming car drifting into its lane', () => {
  phase = 'green';
  // oncoming on the other side of the road, wandering across the centre line into the taxi's lane
  const drifter = { edge: {}, x: -1.8, z: 420, speed: 14, tx: 0, tz: -1, half: 2.3, halfWidth: 0.9 };
  const s = track('self', [1.8, 560], {
    net: grid(2, 300), T: 40, cars: [drifter],
    each: (v, t, car) => {
      const ahead = v.z - car.position.z;
      if (ahead < 110 && v.x < 1.8) v.x = Math.min(1.8, v.x + 1.4 / 60); // drifts over at 1.4 m/s, ends up head-on
      v.tx = 0; v.tz = -1;
    }
  });
  assert.ok(s.minClear > 0.3, `no collision (${s.minClear.toFixed(2)} m)`);
});

test('self-driving stops for a person stepping out into its lane; Crazy Taxi goes round them', () => {
  for (const driver of ['self', 'crazy']) {
    phase = 'green';
    const net = grid(2, 300);
    const car = makeCar(1.8, 20, 0);
    const person = { placed: false, x: 6.5, z: 0 };
    const r = rig(net, car, { cars: [], buses: [], peds: [person] });
    r.navigator.setDriver(driver);
    r.navigator.setDestination(1.8, 560, 'x');
    let minClear = Infinity;
    let t = 0;
    while (t < 30 && !r.navigator.arrived) {
      // up to speed, then a person steps off the kerb 35 m ahead and walks into the lane at 1.4 m/s
      if (!person.placed && car.speed > 12) {
        person.placed = true;
        person.z = car.position.z + 35;
      }
      if (person.placed && person.x > 1.8) person.x = Math.max(1.8, person.x - 1.4 / 60);
      r.navigator.update(1 / 60, t);
      stepCar(car, r.keys, 1 / 60);
      if (person.placed) minClear = Math.min(minClear, clearance(car, person));
      t += 1 / 60;
    }
    assert.ok(minClear > (driver === 'self' ? 1.0 : 0.2), `${driver}: misses them (${minClear.toFixed(2)} m)`);
  }
});

test('self-driving survives a car ahead braking at 8 m/s² from 90 km/h', () => {
  phase = 'green';
  const lead = slowCar(1.8, 80, 25);
  const s = track('self', [1.8, 1450], {
    net: grid(2, 750), T: 40, cars: [lead],
    // matches the taxi's speed, then at 20 s slams on the brakes
    each: (v, t, car) => { v.speed = t < 20 ? 25 : Math.max(0, v.speed - 8 / 60); }
  });
  assert.ok(s.minClear > 0.5, `stops behind it (${s.minClear.toFixed(2)} m)`);
});

test('Crazy Taxi keeps less room than self-driving: passing a slow car, and behind traffic', () => {
  const close = {};
  for (const driver of ['self', 'crazy']) {
    phase = 'green';
    const slow = slowCar(1.8, 70, 5);
    const s = track(driver, [1.8, 560], { net: grid(2, 300), T: 30, cars: [slow] });
    close[driver] = s.minClear;
  }
  assert.ok(close.crazy < close.self - 0.3, `Crazy Taxi cuts it finer (${close.crazy.toFixed(2)} m vs ${close.self.toFixed(2)} m)`);
  assert.ok(close.crazy > 0, 'without hitting it');
});

test('self-driving keeps going past people walking along the pavement beside its lane', () => {
  phase = 'green';
  // its route moves into the kerbside lane (x 5.4) for a left turn; people walk along the pavement 2.2 m beyond it
  const net = grid(2, 300);
  const car = makeCar(1.8, 20, 0);
  const walkers = [60, 120, 180, 230].map((z, k) => ({ placed: true, x: 7.6, z, dir: k % 2 ? 1 : -1 }));
  const r = rig(net, car, { cars: [], buses: [], peds: walkers });
  r.navigator.setDriver('self');
  r.navigator.setDestination(200, 300, 'east');
  let t = 0;
  let slowest = Infinity;
  while (t < 30 && car.position.z < 240) {
    for (const w of walkers) w.z += w.dir * 1.4 / 60;
    r.navigator.update(1 / 60, t);
    stepCar(car, r.keys, 1 / 60);
    if (car.position.z > 50) slowest = Math.min(slowest, car.speed);
    t += 1 / 60;
  }
  assert.ok(slowest > 12, `never brakes for them (${slowest.toFixed(1)} m/s)`);
});

test('the plan preview (for the overlay) starts at the car and runs along its line ahead', () => {
  phase = 'green';
  const net = grid(2, 300);
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car);
  assert.equal(r.navigator.planPreview().length, 0, 'nothing before a trip');
  r.navigator.setDriver('self');
  r.navigator.setDestination(1.8, 560, 'x');
  for (let t = 0; t < 5; t += 1 / 60) { r.navigator.update(1 / 60, t); stepCar(car, r.keys, 1 / 60); }
  const plan = r.navigator.planPreview(60, 3);
  assert.ok(plan.length > 15, `${plan.length} points`);
  assert.ok(Math.hypot(plan[0].x - car.position.x, plan[0].z - car.position.z) < 1e-9, 'from the car');
  for (const q of plan.slice(1)) assert.ok(Math.abs(q.x - 1.8) < 0.3 && q.z > car.position.z, 'down its lane ahead');
  r.navigator.setDriver('you');
  assert.equal(r.navigator.planPreview().length, 0, 'and none once you drive');
});

// ---------------------------------------------------------------------------------------------------------------------
// The island's traffic (js/island-traffic.js) is seen too: its cars carry { active, x, z, dx, dz, v } and no road graph
// edge, and are recycled across the map
// ---------------------------------------------------------------------------------------------------------------------

const islandCar = (x, z, v, dz = 1) => ({ active: true, x, z, dx: 0, dz, v });

function islandRun(driver, islandCars, { T = 30, each = null, dest = [1.8, 560], onNav = null } = {}) {
  phase = 'green';
  const net = grid(2, 300);
  const car = makeCar(1.8, 20, 0);
  const r = rig(net, car, { cars: [], buses: [], peds: [] }, { cars: islandCars });
  r.navigator.setDriver(driver);
  r.navigator.setDestination(dest[0], dest[1], 'x');
  if (onNav) onNav(r.navigator);
  let minClear = Infinity;
  let t = 0;
  while (t < T && !r.navigator.arrived) {
    for (const c of islandCars) {
      if (each) each(c, t, car);
      if (c.active) {
        c.x += c.dx * c.v / 60;
        c.z += c.dz * c.v / 60;
      }
    }
    r.navigator.update(1 / 60, t);
    stepCar(car, r.keys, 1 / 60);
    for (const c of islandCars) {
      if (!c.active) continue;
      minClear = Math.min(minClear, clearance(car, { x: c.x, z: c.z, tx: c.dx, tz: c.dz, half: 2.3, halfWidth: 0.9 }));
    }
    t += 1 / 60;
  }
  return { car, navigator: r.navigator, minClear };
}

test('self-driving follows an island car in its lane, estimating its speed, and never closes on it', () => {
  // ahead in its lane at 6 m/s, then stopping at 15 s
  const ic = islandCar(1.8, 70, 6);
  let seen = 0;
  let followed = 0;
  let nv = null;
  const s = islandRun('self', [ic], {
    T: 22,
    onNav: (n) => { nv = n; },
    each: (c, t) => {
      c.v = t < 15 ? 6 : Math.max(0, c.v - 4 / 60);
      if (nv) {
        const tr = nv.tracker.get(nv.islandProxy(c));
        if (tr) seen = Math.max(seen, tr.speed);
        if (nv.leadObj === nv.islandProxy(c)) followed++;
      }
    }
  });
  assert.ok(Math.abs(seen - 6) < 0.6, `its speed estimated (${seen.toFixed(1)} m/s)`);
  assert.ok(followed > 60, 'followed it');
  assert.ok(s.minClear > 1, `never closer than 1 m, behind it or passing it (${s.minClear.toFixed(2)} m)`);
});

test('self-driving sees an island car crossing its junction and lets it pass', () => {
  // crossing west to east along z 298.2 at 14 m/s, timed to meet the taxi at the junction
  const ic = { active: true, x: -400, z: 298.2, dx: 1, dz: 0, v: 14 };
  let launched = false;
  const s = islandRun('self', [ic], {
    T: 40,
    each: (c, t, car) => {
      if (!launched && 300 - car.position.z < 72) {
        launched = true;
        c.x = -(300 - car.position.z) * (14 / Math.max(1, car.speed));
      }
    }
  });
  assert.ok(launched, 'it went');
  assert.ok(s.minClear > 0.8, `well clear (${s.minClear.toFixed(2)} m)`);
});

test('inactive island cars are not seen, and a recycled one is not mistaken for a fast one', () => {
  const parked = { active: false, x: 1.8, z: 60, dx: 0, dz: 1, v: 0 };
  const ic = islandCar(1.8, 200, 8);
  let jumped = false;
  const s = islandRun('self', [parked, ic], {
    T: 12,
    each: (c, t) => {
      // recycled at 5 s: back 90 m further on, coming the other way
      if (c === ic && !jumped && t > 5) {
        jumped = true;
        c.x = -1.8; c.z += 90; c.dz = -1;
      }
    }
  });
  assert.ok(!s.navigator.tracker.get(s.navigator.islandProxy(parked)), 'the inactive car is not tracked');
  const tr = s.navigator.tracker.get(s.navigator.islandProxy(ic));
  assert.ok(tr && tr.speed < 12, `the recycled car's speed is its own (${tr && tr.speed.toFixed(1)} m/s)`);
  assert.ok(s.car.speed > 15, 'and the taxi drives on (the inactive car in its lane does not stop it)');
});

test('lane changes at speed are long and gentle: the sideways acceleration stays low at 90 km/h', () => {
  // long blocks, so the car is at its cruise when it moves over for the next turn
  phase = 'green';
  for (const [driver, limit] of [['self', 0.8], ['crazy', 1.5]]) {
    const net = grid(4, 300);
    const car = makeCar(1.8, 20, 0);
    const r = rig(net, car);
    r.navigator.setDriver(driver);
    assert.ok(r.navigator.setDestination(1200, 1200, 'x'));
    const p = r.navigator.path;
    let t = 0, peak = 0, fastest = 0;
    while (t < 200 && !r.navigator.arrived) {
      r.navigator.update(1 / 60, t);
      stepCar(car, r.keys, 1 / 60);
      const loc = nav.locate(p, car.position.x, car.position.z, r.navigator.index, 40);
      const P = p.pts, i = loc.i;
      // inside one of the path's lane changes, clear of the junctions' curves
      const inChange = P[i]?.edge && P[i + 1]?.edge === P[i].edge && Math.abs(P[i + 1].lane - P[i].lane) > 0.005
        && P.every((q) => q.edge || Math.abs(q.s - loc.s) > 12);
      if (t > 2 && inChange) {
        peak = Math.max(peak, Math.abs(car.speed * car.angularVel));
        fastest = Math.max(fastest, car.speed);
      }
      t += 1 / 60;
    }
    assert.ok(r.navigator.arrived, `${driver}: arrived`);
    assert.ok(fastest > 20, `${driver}: changing lanes at speed (${(fastest * 3.6).toFixed(0)} km/h)`);
    // (squeezed into 36 m as they were: 2.2 m/s² self-driving, 1.6 Crazy Taxi)
    assert.ok(peak < limit, `${driver}: at most ${limit} m/s² across (${peak.toFixed(2)})`);
  }
});
