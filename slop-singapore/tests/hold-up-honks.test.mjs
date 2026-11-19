import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');

// Holding up traffic: a car stopped right behind a player that is going nowhere, on green, honks after a few seconds
// (js/audio-sources.js decides who is held up, js/audio-system.js when it honks)
const { CityAudioSources } = loadModule(fs.readFileSync(new URL('../js/audio-sources.js', import.meta.url), 'utf8'), {
  imports: { './city-config.js': { signalPhase: () => 'green', walkSignal: () => false } },
  globals: { Math, Number, Float64Array, Array }
});
const stub = (names) => Object.fromEntries(names.map((n) => [n, () => {}]));
const { CityAudioSystem } = loadModule(fs.readFileSync(new URL('../js/audio-system.js', import.meta.url), 'utf8'), {
  imports: {
    './audio-synthesis.js': stub(['createSynthResources', 'createMotorVoice', 'setControlRate']),
    './audio-events.js': stub(['createEventResources', 'playEvent', 'createWindVoice']),
    './audio-sources.js': { CityAudioSources },
    './audio-acoustics.js': { CityAcoustics: class {} },
    './audio-tropics.js': stub(['createTropicalAmbience']),
    './jet-acoustics.js': stub(['renderBoom'])
  },
  globals: { Math, Number, Array, Object, WeakMap, Map }
});

// The player's taxi stopped at (2000, 0) facing east; island cars pointing east along the same lane
function scene({ speed = 0, extra = [] } = {}) {
  const taxi = { type: 'car', position: { x: 2000, y: 0, z: 0 }, mesh: { visible: true }, speed, heading: Math.PI / 2 };
  const car = (x, z, v, more = {}) => ({ active: true, x, z, dx: 1, dz: 0, v, acc: 0, kind: 'sedan', ...more });
  const behind = car(1993, 0, 0, { byPlayer: true });
  const islandCars = [behind, ...extra.map((e) => car(...e))];
  const sources = new CityAudioSources({
    controllerManager: { entities: { car: taxi }, getActiveEntity: () => taxi, keys: {}, getGroundHeight: () => 0 },
    trafficSystem: { cars: [], buses: [], peds: [] }, highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] },
    islandTraffic: { cars: islandCars }
  });
  const held = () => [...sources.collect({ x: 2000, y: 1.5, z: 0 }, 0).motors].find((m) => m.id === behind)?.held;
  return { behind, held, taxi };
}

test('a car stopped behind a stopped player, on green, is held up by it', () => {
  const s = scene();
  assert.equal(s.held(), true);
  s.behind.lightPhase = 'red';
  assert.equal(s.held(), false, 'not while its light is red (the player is waiting at it too)');
  s.behind.lightPhase = 'green';
  s.behind.v = 3;
  assert.equal(s.held(), false, 'not while it is still rolling');
  s.behind.v = 0;
  s.behind.byPlayer = false;
  assert.equal(s.held(), false, 'not when something else is what it waits for');
});

test('not held up by a player that is moving, or queueing itself', () => {
  assert.equal(scene({ speed: 3 }).held(), false, 'the player is moving');
  // (motion is the player's speed: collect() reads entity.speed for a car)
  assert.equal(scene({ extra: [[2008, 0, 0]] }).held(), false, 'a car just ahead of the player: it is in the queue too');
  assert.equal(scene({ extra: [[2008, 6, 0]] }).held(), true, 'a car in the next lane over does not count');
  assert.equal(scene({ extra: [[2030, 0, 0]] }).held(), true, 'nor one well up the road');
});

test('held up: a honk after about 3 s, then more, harder and closer together; none once it moves on', () => {
  const horns = [];
  const sys = Object.create(CityAudioSystem.prototype);
  sys.states = new Map();
  sys.lastHorn = -Infinity;
  sys.emit = (kind, source, opts) => { horns.push({ kind, t: now, intensity: opts.intensity }); return true; };
  const car = { id: {}, kind: 'sedan', seed: 7, held: true, blocked: true };
  let now = 0;
  const run = (seconds) => { for (const end = now + seconds; now < end - 1e-9; now += 0.1) sys.trafficHorns([car], now, 0.1); };
  run(2.9);
  assert.equal(horns.length, 0, 'not straight away');
  run(1.2);
  assert.equal(horns.length, 1, 'one after 3-4 s');
  assert.ok(horns[0].t >= 3 && horns[0].t <= 4.1, `at ${horns[0].t.toFixed(1)} s`);
  run(16);
  assert.ok(horns.length >= 4, `keeps honking (${horns.length})`);
  const gaps = horns.slice(1).map((h, i) => h.t - horns[i].t);
  assert.ok(gaps[gaps.length - 1] < gaps[0], 'closer together');
  assert.ok(horns[horns.length - 1].intensity > horns[0].intensity, 'and harder');
  const n = horns.length;
  car.held = false;
  car.blocked = false;
  run(10);
  assert.equal(horns.length, n, 'the player moved off: quiet');
  car.held = true;
  run(2.5);
  assert.equal(horns.length, n, 'held up again: the wait starts over');
});

test('a second car held up honks too, not shut out by the first one\'s horn', () => {
  let now = 0;
  const horns = [];
  const sys = Object.create(CityAudioSystem.prototype);
  sys.states = new Map();
  sys.lastHorn = -Infinity;
  sys.emit = (kind, source) => { horns.push(source); return true; };
  const a = { id: {}, kind: 'sedan', seed: 1, held: true };
  const b = { id: {}, kind: 'suv', seed: 2, held: true };
  for (; now < 6; now += 0.1) sys.trafficHorns([a, b], now, 0.1);
  assert.ok(horns.includes(a) && horns.includes(b));
});
