import assert from 'node:assert/strict';
import test from 'node:test';
import { JET, createJetState, stepJet, axes, attitude, thrustAt, fuelFlow } from '../js/jet-flight.js';

const land = { groundAt: () => 0 };
const sea = { groundAt: () => null };

// fly for `seconds` at 120 Hz with a constant (or per-step) input, collecting events
function fly(s, input, seconds, env = land) {
  const events = [];
  const h = 1 / 120;
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    const e = stepJet(s, typeof input === 'function' ? input(s, i * h) : input, h, env);
    if (e) events.push(e.event + (e.cause ? `:${e.cause}` : ''));
    if (e?.event === 'crash') break;
  }
  return events;
}
const airborne = (y = 1500, speed = 200, throttle = 0.6, heading = 0) =>
  createJetState({ y, speed, throttle, heading, onGround: false });

test('thrust: dry up to military power, the afterburner above it', () => {
  assert.equal(thrustAt(0), 0);
  assert.equal(thrustAt(JET.afterburner), JET.dryThrust);
  assert.equal(thrustAt(1), JET.wetThrust);
  assert.ok(thrustAt(1, 6000) < thrustAt(1, 0));
});

test('top speed: about Mach 1.1 in full afterburner and Mach 0.85 at military power, at low level', () => {
  const wet = airborne(800, 250, 1);
  fly(wet, { throttle: 1 }, 90);
  assert.ok(wet.speed > 360 && wet.speed < 400, `afterburner ${wet.speed.toFixed(0)} m/s`);
  const dry = airborne(800, 200, JET.afterburner);
  fly(dry, {}, 90);
  assert.ok(dry.speed > 265 && dry.speed < 300, `military ${dry.speed.toFixed(0)} m/s`);
});

test('hands off, it flies straight and level', () => {
  const s = airborne(1500, 220, 0.75, 1.2);
  fly(s, {}, 20);
  assert.ok(Math.abs(s.position.y - 1500) < 25, `altitude ${s.position.y.toFixed(1)}`);
  assert.ok(Math.abs(s.heading - 1.2) < 0.01, `heading ${s.heading}`);
  assert.ok(Math.abs(axes(s.q).bank) < 0.01);
});

test('banked with the stick centred it turns, but the nose drops and it descends: as the real jet', () => {
  const s = airborne(1500, 200, 0.8, 0);
  fly(s, { roll: 1 }, 0.3); // ~60° right
  const bank = axes(s.q).bank;
  assert.ok(bank > 0.8 && bank < 1.3, `bank ${bank}`);
  const before = s.heading;
  fly(s, {}, 5);
  // right turn: the heading decreases (forward (sin h, cos h), right of it is -x at h = 0)
  assert.ok(s.heading < before - 0.1, `heading ${before} -> ${s.heading}`);
  assert.ok(s.position.y < 1500 - 40, `sinks: ${s.position.y.toFixed(0)} m`);
  assert.ok(axes(s.q).pitch < -0.05, `nose down ${axes(s.q).pitch.toFixed(2)}`);
  assert.ok(Math.abs(s.g - 1) < 0.05, 'still at 1 g');
});

test('pulling 1 / cos(bank) g holds the height in the turn, and turns it harder', () => {
  const s = airborne(1500, 200, 0.8, 0);
  fly(s, { roll: 1 }, 0.3);
  const need = 1 / Math.cos(axes(s.q).bank);
  const before = s.heading;
  // the stick's travel from 1 g (centred, level) to 9 g (full back)
  fly(s, (st) => ({ pitch: (need - Math.cos(axes(st.q).pitch)) / (JET.maxG - 1) }), 5);
  assert.ok(Math.abs(s.position.y - 1500) < 15, `held: ${s.position.y.toFixed(0)} m`);
  assert.ok(Math.abs(s.g - need) < 0.1, `${s.g.toFixed(2)} g for ${need.toFixed(2)}`);
  assert.ok(s.heading < before - 0.35);
});

test('Bank assist pulls it for you, and levels a small bank', () => {
  const s = airborne(1500, 200, 0.8, 0);
  s.assist = true;
  fly(s, { roll: 1 }, 0.3);
  const need = 1 / Math.cos(axes(s.q).bank);
  fly(s, {}, 5);
  assert.ok(Math.abs(s.position.y - 1500) < 15, `held: ${s.position.y.toFixed(0)} m`);
  assert.ok(Math.abs(s.g - need) < 0.1);
  const shallow = airborne(1500, 200, 0.8, 0);
  shallow.assist = true;
  fly(shallow, { roll: 1 }, 0.08);
  fly(shallow, {}, 6);
  assert.ok(Math.abs(axes(shallow.q).bank) < 0.02, `levelled to ${axes(shallow.q).bank}`);
  // without it, a small bank stays
  const off = airborne(1500, 200, 0.8, 0);
  fly(off, { roll: 1 }, 0.08);
  fly(off, {}, 3);
  assert.ok(Math.abs(axes(off.q).bank) > 0.15);
});

test('a climb or a dive holds its angle with the stick centred', () => {
  const s = airborne(1500, 220, 0.75);
  s.q = attitude(0, 0.5, 0);
  fly(s, {}, 4);
  assert.ok(Math.abs(axes(s.q).pitch - 0.5) < 0.005);
});

test('the stick pulls up to 9 g at speed, and only what the wing gives when slow', () => {
  const s = airborne(3000, 250, 1);
  let peak = 0;
  fly(s, (st) => { peak = Math.max(peak, st.g); return { pitch: 1 }; }, 1.5);
  assert.ok(axes(s.q).pitch > 0.3, `nose up ${axes(s.q).pitch}`);
  assert.ok(peak <= JET.maxG + 0.01 && peak > JET.maxG - 0.2, `peak ${peak.toFixed(2)} g`);
  // at 100 m/s the wing gives (100 / 62)² ≈ 2.6 g: not 9
  const slow = airborne(3000, 100, 1);
  fly(slow, { pitch: 1 }, 0.3);
  assert.ok(slow.g < 2.8 && slow.g > 2.3, `${slow.g.toFixed(2)} g at 100 m/s`);
  assert.ok(slow.stalled, 'on the stall');
  // pushing: to -3 g
  const d = airborne(3000, 250, 1);
  fly(d, { pitch: -1 }, 1);
  assert.ok(d.g < -2.8, `${d.g.toFixed(2)} g`);
  assert.ok(axes(d.q).pitch < -0.1);
});

test('fuel: about 12 minutes of full afterburner from full tanks, an hour at military power; out of it, a glide', () => {
  assert.ok(Math.abs(fuelFlow(1) - JET.fuelMax) < 1e-9 && Math.abs(fuelFlow(JET.afterburner) - JET.fuelMil) < 1e-9);
  assert.ok(fuelFlow(0) === JET.fuelIdle && fuelFlow(1, 6000) < fuelFlow(1, 0));
  const minutes = JET.fuelCapacity / fuelFlow(1) / 60;
  assert.ok(minutes > 11 && minutes < 13.5, `${minutes.toFixed(1)} min`);
  const s = airborne(800, 250, 1);
  fly(s, { throttle: 1 }, 60);
  assert.ok(Math.abs(JET.fuelCapacity - s.fuel - 60 * JET.fuelMax) < 60, `burnt ${(JET.fuelCapacity - s.fuel).toFixed(0)} kg in a minute`);
  // lighter, it accelerates harder
  const light = airborne(800, 150, 1);
  light.fuel = 1000;
  const heavy = airborne(800, 150, 1);
  fly(light, {}, 5);
  fly(heavy, {}, 5);
  assert.ok(light.speed > heavy.speed + 3, `${light.speed.toFixed(0)} vs ${heavy.speed.toFixed(0)} m/s`);
  // empty: the engines flame out, no afterburner, and it slows
  const dry = airborne(3000, 250, 1);
  dry.fuel = 5;
  fly(dry, {}, 10);
  assert.ok(dry.flameout && dry.fuel === 0 && dry.afterburner < 0.01);
  assert.ok(dry.speed < 230);
  // unlimited fuel: always full
  const free = airborne(3000, 250, 1);
  free.unlimitedFuel = true;
  fly(free, {}, 30);
  assert.equal(free.fuel, JET.fuelCapacity);
});

test('a zoom climb trades speed for height; at the top it stalls and the nose falls through', () => {
  const s = airborne(1000, 160, 0);
  s.q = attitude(0, 1.3, 0); // nearly vertical, throttle idle
  let stalled = false, top = 0;
  fly(s, (st) => { stalled ||= st.stalled; top = Math.max(top, st.position.y); return {}; }, 25);
  assert.ok(stalled, 'stalled');
  assert.ok(top > 1800, `zoomed to ${top.toFixed(0)} m`);
  assert.ok(axes(s.q).pitch < 0, `nose fell to ${axes(s.q).pitch}`);
});

test('takes off from the runway in full afterburner, inside Paya Lebar\'s 3.8 km', () => {
  const s = createJetState({ heading: 0.4 });
  assert.equal(s.position.y, JET.gearHeight);
  let liftoffAt = null;
  const events = fly(s, (st) => {
    if (!st.onGround && liftoffAt === null) liftoffAt = Math.hypot(st.position.x, st.position.z);
    // stick back at rotation speed, then hold a 15° climb
    return { throttle: 1, pitch: st.speed < JET.rotateSpeed ? 0 : st.onGround ? 1 : axes(st.q).pitch < 0.25 ? 0.5 : 0 };
  }, 40);
  assert.ok(events.includes('liftoff'), events.join());
  assert.ok(liftoffAt > 200 && liftoffAt < 2500, `rolled ${liftoffAt?.toFixed(0)} m`);
  assert.ok(s.position.y > 200, `climbed to ${s.position.y.toFixed(0)} m`);
  assert.equal(s.gear, 0, 'gear up once climbing away fast');
});

test('rolls, steers and brakes on the ground', () => {
  const s = createJetState({ speed: 40 });
  fly(s, { roll: 1 }, 2);
  assert.ok(s.heading < -0.2, `steered right to ${s.heading}`);
  const before = s.speed;
  fly(s, { throttle: -1, brake: true }, 3);
  assert.ok(s.speed < before - 12, `braked ${before.toFixed(0)} -> ${s.speed.toFixed(0)}`);
});

test('lands gently with the gear down; crashes diving in, or onto the sea', () => {
  const s = airborne(60, 75, 0.35);
  s.gear = 1;
  s.q = attitude(0, -0.03, 0);
  const events = fly(s, (st) => ({ pitch: st.climbRate < -3 ? 0.4 : st.climbRate > -1 ? -0.2 : 0 }), 40);
  assert.ok(events.includes('landed'), events.join());
  assert.ok(s.onGround);

  const dive = airborne(300, 200, 0.8);
  dive.q = attitude(0, -0.6, 0);
  assert.deepEqual(fly(dive, {}, 10).slice(-1), ['crash:ground']);

  const ditch = airborne(60, 75, 0.35);
  ditch.gear = 1;
  ditch.q = attitude(0, -0.03, 0);
  assert.deepEqual(fly(ditch, {}, 40, sea).slice(-1), ['crash:water']);
});
