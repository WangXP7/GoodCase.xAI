import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundTrail, BoomWatcher, boomIntensity, renderBoom, SOUND } from '../js/jet-acoustics.js';

const C = SOUND.speed;
// A jet flying along +z at `v` m/s, `h` m up, over a listener on the ground at the origin (passing overhead at t = t0)
function fly(trail, { v, h = 150, t0 = 20, until = 40, dt = 1 / 60, throttle = 0.8 }) {
  for (let t = 0; t <= until + 1e-9; t += dt) trail.push(t, 0, h, v * (t - t0), throttle);
}

test('a jet is heard from where it was when the sound left it, that long ago', () => {
  const trail = new SoundTrail();
  fly(trail, { v: 190, until: 40 });
  // at t = 12 it's 1520 m out; what's heard left it when it was further out, distance / c earlier
  const h = trail.hear(12, 0, 0, 0);
  assert.ok(h, 'heard');
  const d = Math.hypot(150, 190 * (h.te - 20));
  assert.ok(Math.abs(C * (12 - h.te) - d) < 0.5, 'the sound took its distance / c to arrive');
  assert.ok(Math.abs(h.z - 190 * (h.te - 20)) < 0.5 && Math.abs(h.y - 150) < 1e-6);
  assert.ok(h.te < 12 - 4, `${(12 - h.te).toFixed(2)} s ago`);
  assert.ok(Math.abs(h.distance - d) < 0.5);
  assert.ok(Math.abs(h.mach - 190 / C) < 0.01);
  assert.equal(h.throttle, 0.8);
});

test('the Doppler shift from it: higher as it comes, lower as it goes, by c / (c - v cos)', () => {
  const trail = new SoundTrail();
  fly(trail, { v: 190, until: 40 });
  const coming = trail.hear(14, 0, 0, 0);
  const cos = -coming.z / coming.distance; // (it's heading +z, from -z towards the listener)
  assert.ok(Math.abs(coming.doppler - C / (C - 190 * cos)) < 0.02, `coming ${coming.doppler.toFixed(3)}`);
  assert.ok(coming.doppler > 2);
  const going = trail.hear(34, 0, 0, 0);
  assert.ok(going.doppler < 0.7, `going ${going.doppler.toFixed(3)}`);
  // right overhead (the sound that left it overhead): no shift
  const overhead = trail.hear(20 + 150 / C, 0, 0, 0);
  assert.ok(Math.abs(overhead.doppler - 1) < 0.03);
});

test('a jet that has not been heard yet, or stopped long enough ago, is silent', () => {
  const trail = new SoundTrail();
  fly(trail, { v: 190, t0: 20, until: 2 }); // appears 3.8 km out at t = 0 (its sound 11 s away)
  assert.equal(trail.hear(2, 0, 0, 0), null, 'not yet');
  assert.equal(new SoundTrail().hear(5, 0, 0, 0), null, 'nothing at all');
  const near = new SoundTrail();
  for (let t = 0; t <= 2; t += 1 / 60) near.push(t, 0, 100, 0, 0.5);
  assert.ok(near.hear(2, 0, 0, 0), 'heard while there');
  assert.ok(near.hear(2.2, 0, 0, 0), 'its last sound still on its way');
  assert.equal(near.hear(2.5, 0, 0, 0), null, 'gone');
  near.clear();
  assert.equal(near.hear(2, 0, 0, 0), null);
});

test('a supersonic jet arrives in silence; the boom comes as its Mach cone reaches the listener, once', () => {
  const v = 390, h = 150, t0 = 20;
  const M = v / C;
  const trail = new SoundTrail();
  fly(trail, { v, h, t0, until: 40 });
  // the cone reaches the ground under its track h * sqrt(M^2 - 1) behind it, that long after it's overhead
  const arrives = t0 + (h * Math.sqrt(M * M - 1)) / v;
  assert.equal(trail.hear(t0 - 1, 0, 0, 0), null, 'coming: silent');
  assert.equal(trail.hear(t0 + 0.05, 0, 0, 0), null, 'overhead: still silent');
  assert.equal(trail.hear(arrives - 0.03, 0, 0, 0), null);
  assert.ok(trail.hear(arrives + 0.05, 0, 0, 0), 'then the roar, after the boom');
  const watch = new BoomWatcher();
  const booms = [];
  for (let t = 0; t <= 40; t += 1 / 60) {
    for (const b of watch.check([trail], t, 0, 0, 0)) booms.push({ ...b, t });
  }
  assert.equal(booms.length, 1, 'one boom');
  assert.ok(Math.abs(booms[0].t - arrives) < 0.1, `at ${booms[0].t.toFixed(2)} s (cone ${arrives.toFixed(2)} s)`);
  assert.ok(Math.abs(booms[0].mach - M) < 0.02);
  assert.ok(booms[0].intensity > 0.8, 'loud, from 150 m');
  // subsonic: no boom
  const slow = new SoundTrail();
  fly(slow, { v: 190, h, t0, until: 40 });
  const w2 = new BoomWatcher();
  let n = 0;
  for (let t = 0; t <= 40; t += 1 / 60) n += w2.check([slow], t, 0, 0, 0).length;
  assert.equal(n, 0);
});

test('a boom is softer further off and nearer Mach 1, and the sound of one is an N-wave and its rumble', () => {
  assert.ok(boomIntensity(150, 1.14) > boomIntensity(1500, 1.14));
  assert.ok(boomIntensity(150, 1.14) > boomIntensity(150, 1.01));
  assert.ok(boomIntensity(150, 1.14) <= 1 && boomIntensity(20000, 1.01) > 0);
  const rate = 8000;
  const s = renderBoom(rate, 7);
  assert.ok(s.length >= rate * 1.5, 'a second and more of rumble');
  let peak = 0, at = 0;
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > peak) { peak = Math.abs(s[i]); at = i; }
  assert.ok(Math.abs(peak - 1) < 1e-6, 'normalised');
  // the N: a sharp rise at its front, a fall through zero, a sharp return about 0.1 s later
  const front = s.findIndex((x) => x > 0.5);
  assert.ok(front >= 0 && front < rate * 0.01, 'its front at once');
  assert.ok(s[front] > 0.5 && s[front - 4 >= 0 ? front - 4 : 0] < s[front]);
  const tail = Math.round(front + rate * 0.09);
  assert.ok(s[tail] < -0.3, `below zero at its back: ${s[tail].toFixed(2)}`);
  assert.ok(at < rate * 0.15, 'the N is the loudest');
  // and the same boom every time for a seed
  assert.deepEqual(renderBoom(rate, 7), s);
});

test('the city\'s sound sources hear a flypast jet through its trail: late, shifted, and not before its sound arrives', async () => {
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { loadModule } = createRequire(import.meta.url)('./helpers/module.cjs');
  const { CityAudioSources } = loadModule(fs.readFileSync(new URL('../js/audio-sources.js', import.meta.url), 'utf8'), {
    imports: { './city-config.js': { signalPhase: () => 'green', walkSignal: () => false } },
    globals: { Math, Number, Float64Array, Array }
  });
  const taxi = { type: 'car', position: { x: 0, y: 0, z: 0 }, mesh: { visible: true }, speed: 0, heading: 0 };
  const jet = { active: true, x: 0, y: 150, z: 0, speed: 390, throttle: 0.9, heading: 0, gain: 1, trail: new SoundTrail(), direct: false };
  const cars = Array.from({ length: 12 }, (_, k) => ({ active: true, x: 5 + k, z: 3, dx: 1, dz: 0, v: 8, acc: 0, kind: 'sedan' }));
  const sources = new CityAudioSources({
    controllerManager: { entities: { car: taxi }, getActiveEntity: () => taxi, keys: {}, getGroundHeight: () => 0 },
    trafficSystem: { cars: [], buses: [], peds: [] }, highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] },
    islandTraffic: { cars }, aircraft: [jet]
  });
  const heard = (t) => [...sources.collect({ x: 0, y: 2, z: 0 }, t).motors].find((m) => m.id === jet);
  const v = 390, t0 = 20;
  for (let t = 0; t <= 30; t += 1 / 60) jet.trail.push(t, 0, 150, v * (t - t0), 0.9);
  // (where it is now: overhead at 20 s)
  assert.equal(heard(19), undefined, 'coming in at Mach 1.14: silent');
  assert.equal(heard(20.1), undefined, 'overhead: still silent');
  const m = heard(22);
  assert.ok(m, 'heard after the boom, over a dozen cars close by');
  assert.ok(m.z > 0 && m.z < v * 2, 'from where it was');
  assert.ok(m.doppler > 0 && m.doppler < 0.6, `going away: ${m.doppler.toFixed(2)}`);
  // riding along with it: as it is
  jet.direct = true;
  jet.x = 0; jet.y = 4; jet.z = 0;
  assert.ok(heard(22), 'from inside the formation');
  assert.equal(heard(22).doppler, 0);
});
