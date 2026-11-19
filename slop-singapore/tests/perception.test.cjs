const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The autopilot's perception (js/perception.js): tracks from observed positions, velocity estimates, prediction and
// conflict checks, without the scene
const P = loadModule(readFileSync(join(__dirname, '../js/perception.js'), 'utf8'), {
  globals: { Math, Number, Map, Set, WeakMap, Array, Infinity, Object },
  filename: 'perception.js'
});

const car = (x, z, vx = 0, vz = 0, extra = {}) => ({ edge: {}, x, z, half: 2.3, halfWidth: 0.9, tx: 0, tz: 1, ...extra, _vx: vx, _vz: vz });
const ego = { position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0 };

test('velocity is estimated from observed positions, not read from the vehicle', () => {
  const tracker = new P.Tracker();
  // a car reporting a misleading speed field: the tracker never reads it
  const c = car(0, 50, 6, -12, { speed: 99 });
  for (let t = 0; t < 1; t += 1 / 60) {
    c.x += c._vx / 60;
    c.z += c._vz / 60;
    tracker.update(1 / 60, [[c]], ego);
  }
  const tr = tracker.get(c);
  assert.ok(tr, 'tracked');
  assert.ok(Math.abs(tr.vx - 6) < 0.3 && Math.abs(tr.vz + 12) < 0.3, `velocity (${tr.vx.toFixed(2)}, ${tr.vz.toFixed(2)})`);
  assert.ok(Math.abs(tr.speed - Math.hypot(6, 12)) < 0.3);
});

test('estimates stay steady under measurement jitter and follow a car that brakes', () => {
  const tracker = new P.Tracker();
  const c = car(0, 30, 0, 15);
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    const dt = 1 / 60;
    c._vz = i < 90 ? 15 : Math.max(0, 15 - (i - 90) * dt * 6); // brakes at 6 m/s² after 1.5 s
    c.trueZ = (c.trueZ ?? c.z) + c._vz * dt;
    c.z = c.trueZ + rand() * 0.05; // ±5 cm
    tracker.update(dt, [[c]], ego);
    if (i > 40 && i < 90) worst = Math.max(worst, Math.abs(tracker.get(c).vz - 15));
  }
  assert.ok(worst < 1.5, `steady before braking (worst ${worst.toFixed(2)} m/s off)`);
  const tr = tracker.get(c);
  assert.ok(Math.abs(tr.vz - c._vz) < 2, `follows the braking (${tr.vz.toFixed(1)} vs ${c._vz.toFixed(1)} m/s)`);
  assert.ok(tr.az < -2, `and sees it decelerating (${tr.az.toFixed(1)} m/s²)`);
});

test('tracks are dropped out of range and reset when a vehicle is recycled across the map', () => {
  const tracker = new P.Tracker();
  const c = car(0, 30, 0, 10);
  tracker.update(1 / 60, [[c]], ego);
  c.z += 10 / 60;
  tracker.update(1 / 60, [[c]], ego);
  // recycled: jumps 400 m
  c.z = 30;
  c.x = 60;
  tracker.update(1 / 60, [[c]], ego);
  const tr = tracker.get(c);
  assert.ok(tr && tr.speed < 1, 'no 24 km/s spike: the track restarts');
  c.x = 500;
  tracker.update(1 / 60, [[c]], ego);
  assert.equal(tracker.get(c), undefined, 'out of range: dropped');
});

test('prediction extrapolates a track and its footprint', () => {
  const tracker = new P.Tracker();
  const c = car(0, 0, 10, 0);
  for (let i = 0; i < 60; i++) {
    c.x += 10 / 60;
    tracker.update(1 / 60, [[c]], ego);
  }
  const tr = tracker.get(c);
  const p = P.predict(tr, 2, {});
  assert.ok(Math.abs(p.x - (c.x + 20)) < 0.8 && Math.abs(p.z) < 0.3, `2 s on (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  // its heading follows its motion (east), not its stale orientation field
  assert.ok(Math.abs(p.hx - 1) < 0.05, 'heads the way it moves');
});

test('conflict checks: a crossing car, a car in the next lane, and clearance by driver', () => {
  const tracker = new P.Tracker();
  // crossing from the west 30 m ahead, timed to meet a taxi doing 15 m/s there in 2 s; and a car alongside in the next
  // lane at the taxi's speed
  const crossing = car(-37.5, 30, 15, 0, { tx: 1, tz: 0 });
  const beside = car(3.6, -7.5, 0, 15);
  for (let i = 0; i < 30; i++) {
    crossing.x += 15 / 60;
    beside.z += 15 / 60;
    tracker.update(1 / 60, [[crossing, beside]], ego);
  }
  // the taxi's plan: straight on south (+z) at 15 m/s from z = 0
  const egoAt = (t) => ({ x: 0, z: 15 * t, hx: 0, hz: 1 });
  const hit = P.firstConflict(egoAt, tracker.tracks, { horizon: 4, step: 0.05, clearance: 0.6, growth: 0.2 });
  assert.ok(hit, 'the crossing car is a conflict');
  assert.equal(hit.track.obj, crossing);
  assert.ok(hit.t > 1.4 && hit.t < 2.1, `about 2 s out (${hit.t.toFixed(2)} s)`);
  // the car in the next lane, 3.6 m across, is not
  const others = new Map([...tracker.tracks].filter(([o]) => o === beside));
  assert.equal(P.firstConflict(egoAt, others, { horizon: 4, step: 0.05, clearance: 0.6, growth: 0.2 }), null);
  // but squeezing past it 2.2 m across is fine for a Crazy Taxi and not for the self-driving taxi
  const close = (t) => ({ x: 1.4, z: 15 * t, hx: 0, hz: 1 });
  assert.ok(P.firstConflict(close, others, { horizon: 4, step: 0.05, clearance: 0.7, growth: 0.2 }), 'too close for self-driving');
  assert.equal(P.firstConflict(close, others, { horizon: 2.5, step: 0.05, clearance: 0.1, growth: 0.02 }), null, 'fine for Crazy Taxi');
});

test('a car going round a bend is predicted round the bend (its turn rate is estimated too)', () => {
  const tracker = new P.Tracker();
  // 15 m/s round a 40 m radius curve (turning left: heading growing)
  const R = 40, v = 15, w = v / R;
  let th = 0;
  const c = car(R, 0, 0, 0);
  const place = () => { c.x = R * Math.cos(th); c.z = R * Math.sin(th); };
  place();
  for (let i = 0; i < 90; i++) {
    th += w / 60;
    place();
    tracker.update(1 / 60, [[c]], ego);
  }
  const tr = tracker.get(c);
  const p = P.predict(tr, 2, {});
  const thAt = th + w * 2;
  const err = Math.hypot(p.x - R * Math.cos(thAt), p.z - R * Math.sin(thAt));
  assert.ok(err < 1.5, `on the curve 2 s on (${err.toFixed(2)} m off; straight on would be ${(R * (1 / Math.cos(w * 2) - 1) + 0).toFixed(1)} m out)`);
});

test('people predicted to stay on the pavement are no conflict', () => {
  const tracker = new P.Tracker();
  const walker = { x: 4.2, z: 10, placed: true };
  for (let i = 0; i < 60; i++) {
    walker.z += 1.4 / 60;
    tracker.update(1 / 60, [[walker]], ego);
  }
  const egoAt = (t) => ({ x: 1.8, z: 11 * t, hx: 0, hz: 1 });
  const opts = { horizon: 4, step: 0.1, clearance: 0.7, growth: 0.2, pedClearance: 1.0 };
  assert.ok(P.firstConflict(egoAt, tracker.tracks, opts), 'close to the lane: a conflict on its own');
  // the pavement starts 3.6 m out
  const onPavement = (tr, p) => tr.ped && p.x > 3.6;
  assert.equal(P.firstConflict(egoAt, tracker.tracks, { ...opts, ignore: onPavement }), null, 'but not while it stays on the pavement');
});
