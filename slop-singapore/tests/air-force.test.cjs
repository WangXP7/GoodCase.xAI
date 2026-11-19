const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
const flight = loadModule(read('js/jet-flight.js'), { globals: { Math, Number }, filename: 'jet-flight.js' });

// Just enough of three.js's vectors and quaternions for js/air-force.js
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addScaledVector(v, k) { return this.set(this.x + v.x * k, this.y + v.y * k, this.z + v.z * k); }
  divideScalar(k) { return this.set(this.x / k, this.y / k, this.z / k); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  applyQuaternion(q) {
    const out = flight.qRotate([q.x, q.y, q.z, q.w], this.x, this.y, this.z);
    return this.set(out[0], out[1], out[2]);
  }
}
class Quaternion {
  constructor() { this.set(0, 0, 0, 1); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  setFromAxisAngle(a, angle) { const s = Math.sin(angle / 2); return this.set(a.x * s, a.y * s, a.z * s, Math.cos(angle / 2)); }
  multiply(q) {
    const { x: ax, y: ay, z: az, w: aw } = this;
    return this.set(aw * q.x + ax * q.w + ay * q.z - az * q.y, aw * q.y - ax * q.z + ay * q.w + az * q.x,
      aw * q.z + ax * q.y - ay * q.x + az * q.w, aw * q.w - ax * q.x - ay * q.y - az * q.z);
  }
  slerp(q, t) {
    // (normalised lerp: close enough here)
    const d = this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w < 0 ? -1 : 1;
    this.set(this.x + (q.x * d - this.x) * t, this.y + (q.y * d - this.y) * t, this.z + (q.z * d - this.z) * t, this.w + (q.w * d - this.w) * t);
    const L = Math.hypot(this.x, this.y, this.z, this.w);
    return this.set(this.x / L, this.y / L, this.z / L, this.w / L);
  }
}
class Group {
  constructor() { this.children = []; }
  add(o) { this.children.push(o); }
}
const model = () => ({
  root: { position: new Vector3(), quaternion: new Quaternion(), visible: true, traverse() {} },
  strobe: { visible: false },
  setGear() {}, setAfterburner(level) { this.ab = level; }, setStabilators() {}, setCockpitView(on) { this.cockpitView = on; }
});
const acoustics = loadModule(read('js/jet-acoustics.js'), { globals: { Math, Number, Float64Array, Float32Array, WeakMap }, filename: 'jet-acoustics.js' });
class ShockCollar { constructor() { this.mach = 0; } set(mach) { this.mach = mach; } }
// the smoke, as the flypast drives it: each trail's colour, and where and whether it was last told to smoke
class SmokeTrails {
  constructor(group, n) { this.colours = new Array(n).fill(null); this.on = new Array(n).fill(false); this.at = []; this.eye = null; this.cleared = 0; }
  setColour(k, c) { this.colours[k] = c; }
  clear() { this.cleared++; }
  update(dt, at, on, eye) { this.at = at.map((p) => ({ x: p.x, y: p.y, z: p.z })); this.on = [...on]; this.eye = eye; }
}

const { createAirForce, FLYPAST, FORMATIONS, RIDES } = loadModule(read('js/air-force.js'), {
  imports: {
    'three/webgpu': { Vector3, Quaternion, Group },
    './jet-model.js': { createJetModel: model },
    './jet-flight.js': flight,
    './jet-effects.js': { WingtipTrails: class { clear() {} update() {} }, ShockCollar, SmokeTrails },
    './jet-acoustics.js': acoustics
  },
  globals: { Math, Number },
  filename: 'air-force.js'
});

function airForce(colliders = []) {
  const jet = {
    position: new Vector3(0, 2.3, 0), heading: 0, crashed: 0, stick: 0,
    flight: { q: flight.attitude(0), onGround: true, gear: 1, afterburner: 0, throttle: 0 }
  };
  const controllers = { entities: { jet }, nearColliders: (x, z, r) => colliders.filter((c) => Math.hypot(c.x - x, c.z - z) < r + 20) };
  return { af: createAirForce({ add() {} }, controllers), jet };
}
const camera = (x, y, z, dx, dz) => ({ position: new Vector3(x, y, z), getWorldDirection: (v) => v.set(dx, -0.2, dz) });
const run = (af, seconds, dt = 1 / 60, each = () => {}, cam = null) => {
  for (let t = 0; t < seconds; t += dt) { each(t); af.update(dt, t, cam); }
};

test('a flypast runs in from 2.5 km ahead of the view, in a diamond, low, and right over the camera', () => {
  const { af } = airForce();
  const cam = camera(100, 2, 200, 0, 1); // looking along +z: its right is -x
  const eta = af.orderFlypast(cam);
  assert.ok(Math.abs(eta - (FLYPAST.approach + FORMATIONS.diamond.past) / FLYPAST.speed) < 1e-9);
  assert.ok(Math.abs(af.flypast.overhead - FLYPAST.approach / FLYPAST.speed) < 1e-9, 'overhead first, then the burst');
  const [lead, left, right, slot] = af.flypast.jets;
  af.update(1 / 60, 0);
  assert.ok(af.flypast.jets.every((j) => j.model.root.visible && j.sound.active && j.contact.visible));
  // 2.5 km out ahead, just to the right, coming towards the camera, 150 m up (nothing tall under it)
  assert.ok(Math.abs(lead.pos.z - (200 + FLYPAST.approach)) < 5 && Math.abs(lead.pos.x - (100 - FLYPAST.side)) < 1);
  assert.ok(Math.abs(Math.abs(lead.heading) - Math.PI) < 1e-9, 'heading for the camera');
  assert.equal(lead.pos.y, FLYPAST.height);
  // the diamond: wings either side and back, the slot behind, all lower than the lead
  const along = (j) => (j.pos.x - lead.pos.x) * Math.sin(lead.heading) + (j.pos.z - lead.pos.z) * Math.cos(lead.heading);
  assert.ok(Math.abs(along(left) + 15) < 0.01 && Math.abs(along(right) + 15) < 0.01 && Math.abs(along(slot) + 30) < 0.01);
  assert.ok(left.pos.y < lead.pos.y && slot.pos.y < left.pos.y);
  // right over the camera: the lead's closest pass within 160 m of it (150 up, 30 aside)
  let closest = Infinity;
  run(af, eta - 1 / 60, 1 / 60, () => { closest = Math.min(closest, Math.hypot(lead.pos.x - 100, lead.pos.y - 2, lead.pos.z - 200)); });
  assert.ok(closest < 160, `closest ${closest.toFixed(0)} m`);
  // and the burst starts 250 m past it
  assert.ok(Math.abs(lead.pos.z - (200 - FORMATIONS.diamond.past)) < 10, `pulls at z ${lead.pos.z.toFixed(0)}`);
  assert.ok(af.flypast.eta < 0.1);
});

test('the bomb burst: in afterburner, the lead straight up, the wings away to each side, then gone', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1));
  const [lead, left, right, slot] = af.flypast.jets;
  run(af, af.flypast.eta + 6);
  assert.ok(lead.pos.y > FLYPAST.height + 600, `the lead pulls up to ${lead.pos.y.toFixed(0)} m`);
  assert.ok(lead.model.ab > 0.9, 'in afterburner');
  const h = lead.heading;
  const side = (j) => (j.pos.x - lead.pos.x) * Math.cos(h) - (j.pos.z - lead.pos.z) * Math.sin(h);
  assert.ok(side(left) > 150 && side(right) < -150, `left ${side(left).toFixed(0)}, right ${side(right).toFixed(0)}`);
  assert.ok(Math.abs(side(slot)) < 20);
  run(af, FORMATIONS.diamond.duration);
  assert.equal(af.flypast.active, false);
  assert.ok(af.flypast.jets.every((j) => !j.model.root.visible && !j.sound.active));
});

test('a flypast stays clear of the tallest building under its track, and passes over a camera up high', () => {
  // a 290 m tower on the run-in line, 1.5 km out
  const { af } = airForce([{ x: -FLYPAST.side, z: 1500, maxY: 290 }]);
  af.orderFlypast(camera(0, 2, 0, 0, 1));
  af.update(1 / 60, 0);
  assert.equal(af.flypast.jets[0].pos.y, 350);
  // from a helicopter at 380 m: still over it
  const high = airForce().af;
  high.orderFlypast(camera(0, 380, 0, 0, 1));
  high.update(1 / 60, 0);
  assert.equal(high.flypast.jets[0].pos.y, 500);
});

test('the flypast\'s focus: the middle of the formation and how far it spreads, for the binoculars', () => {
  const { af } = airForce();
  const out = new Vector3();
  assert.equal(af.flypast.focus(out), 0, 'nothing to see');
  af.orderFlypast(camera(0, 2, 0, 0, 1));
  af.update(1 / 60, 0);
  const r = af.flypast.focus(out);
  const lead = af.flypast.jets[0];
  assert.ok(Math.abs(out.x - lead.pos.x) < 0.5 && out.z > lead.pos.z && out.z < lead.pos.z + 30, 'behind the lead, in the diamond');
  assert.ok(r > 25 && r < 40, `radius ${r.toFixed(1)} m`);
  // in the burst: the lead and the slot, up the middle (the wings peel away out of the frame)
  run(af, af.flypast.eta + 8);
  const [l, , , slot] = af.flypast.jets;
  const r2 = af.flypast.focus(out);
  assert.ok(Math.abs(out.y - (l.pos.y + slot.pos.y) / 2) < 1e-6);
  assert.ok(Math.abs(r2 - (Math.hypot(l.pos.x - slot.pos.x, l.pos.y - slot.pos.y, l.pos.z - slot.pos.z) / 2 + 10)) < 1e-6);
});

test('the wingman parks beside the jet, then holds right echelon in the air', () => {
  const { af, jet } = airForce();
  af.setWingman(true);
  af.update(1 / 60, 0);
  const w = af.wingman.jet;
  assert.ok(w.model.root.visible);
  // on the runway: abreast, 15 m to the right (-x at heading 0)
  assert.ok(Math.abs(w.pos.x + 15) < 0.01 && Math.abs(w.pos.z - 2) < 0.01, `(${w.pos.x}, ${w.pos.z})`);
  // airborne at 200 m/s along +z
  jet.flight.onGround = false;
  jet.flight.gear = 0;
  jet.position.y = 500;
  run(af, 8, 1 / 60, () => { jet.position.z += 200 / 60; });
  assert.ok(Math.abs(w.pos.x + 16) < 0.5, `x ${w.pos.x.toFixed(2)}`);
  assert.ok(Math.abs(w.pos.z - (jet.position.z - 16)) < 1.5, `${(w.pos.z - jet.position.z).toFixed(1)} m behind`);
  assert.ok(Math.abs(w.pos.y - 498) < 0.5);
  assert.ok(Math.abs(w.sound.speed - 200) < 1);
  // the leader goes down: the wingman flies on
  jet.crashed = 3;
  const z = w.pos.z;
  run(af, 1);
  assert.ok(w.pos.z > z + 190, 'carried on');
  // it respawns 3 km away: the wingman is in place at once
  jet.crashed = 0;
  jet.position.set(0, 450, 3000 + z);
  af.update(1 / 60, 10);
  assert.ok(Math.abs(w.pos.x + 16) < 0.01 && Math.abs(w.pos.z - (jet.position.z - 16)) < 0.01);
  af.setWingman(false);
  assert.ok(!w.model.root.visible && !w.sound.active);
});

test('a supersonic run-in: Mach 1.14, from twice as far out, the same pass over the camera', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1), { supersonic: true });
  const f = af.flypast;
  assert.equal(f.speed, FLYPAST.supersonic);
  assert.ok(f.speed / acoustics.SOUND.speed > 1.1);
  assert.ok(Math.abs(f.overhead - FLYPAST.approach / FLYPAST.speed) < 0.5, 'about as long to wait');
  const lead = f.jets[0];
  af.update(1 / 60, 0);
  assert.ok(lead.pos.z > 4500, `starts ${lead.pos.z.toFixed(0)} m out`);
  assert.ok(f.jets.every((j) => j.collar.mach > 1.1), 'the vapour cone round each');
  let closest = Infinity;
  run(af, f.eta - 1 / 60, 1 / 60, () => { closest = Math.min(closest, Math.hypot(lead.pos.x, lead.pos.y - 2, lead.pos.z)); });
  assert.ok(closest < 160);
  // subsonic: no vapour cone
  const slow = airForce().af;
  slow.orderFlypast(camera(0, 2, 0, 0, 1));
  slow.update(1 / 60, 0);
  assert.ok(slow.flypast.jets.every((j) => j.collar.mach < 0.95));
});

test('each jet\'s path is kept for its sound: heard late from the ground, a boom each as the Mach cones arrive', () => {
  for (const supersonic of [false, true]) {
    const { af } = airForce();
    af.orderFlypast(camera(0, 2, 0, 0, 1), { supersonic });
    const trails = af.aircraft.map((a) => a.trail);
    assert.ok(trails.every((t) => t && typeof t.hear === 'function'));
    const watch = new acoustics.BoomWatcher();
    const booms = [];
    let heardLate = false;
    let t = 0;
    run(af, af.flypast.eta + 4, 1 / 60, (tt) => {
      t = tt;
      for (const b of watch.check(trails, tt, 0, 2, 0)) booms.push(tt);
      const lead = af.flypast.jets[0];
      const h = af.flypast.jets[0].sound.trail.hear(tt, 0, 2, 0);
      if (h && Math.hypot(lead.pos.x - h.x, lead.pos.y - h.y, lead.pos.z - h.z) > 100) heardLate = true;
    });
    if (supersonic) {
      assert.equal(booms.length, 4, `${booms.length} booms`);
      const over = FLYPAST.approach * FLYPAST.supersonic / FLYPAST.speed / FLYPAST.supersonic;
      assert.ok(booms.every((b) => b > over && b < over + 1.5), `booms at ${booms.map((b) => b.toFixed(2)).join(', ')} (overhead ${over.toFixed(2)})`);
    } else {
      assert.equal(booms.length, 0);
      assert.ok(heardLate, 'heard from well behind where it is');
    }
  }
  // the wingman's path too, cleared as it's turned on
  const { af, jet } = airForce();
  af.setWingman(true);
  af.update(1 / 60, 0);
  assert.ok(af.wingman.jet.sound.trail.length > 0);
});

test('watching it from inside the formation: a wingman\'s or the slot\'s cockpit, or a chase plane behind', () => {
  assert.equal(JSON.stringify(RIDES), JSON.stringify(['wing', 'slot', 'chase']));
  const { af } = airForce();
  const cam = {
    position: new Vector3(), quaternion: new Quaternion(), up: new Vector3(0, 1, 0), target: null,
    lookAt(v) { this.target = new Vector3().copy(v); }
  };
  assert.equal(af.flypast.ride('slot', cam), false, 'nothing to ride');
  af.orderFlypast(camera(0, 2, 0, 0, 1));
  run(af, 5);
  const [lead, left, , slot] = af.flypast.jets;
  // from the slot: in its front seat, looking ahead at the lead
  assert.equal(af.flypast.ride('slot', cam), true);
  assert.ok(slot.model.cockpitView && !lead.model.cockpitView, 'its cockpit in, the others\' out');
  assert.ok(slot.collar.hidden && !lead.collar.hidden, 'its own vapour cone not drawn round the camera');
  const eye = new Vector3(0, 1.12, 4.1).applyQuaternion(slot.q).add(slot.pos);
  assert.ok(cam.position.distanceTo(eye) < 1e-6);
  const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const toLead = new Vector3().subVectors(lead.pos, cam.position);
  const cos = (fwd.x * toLead.x + fwd.y * toLead.y + fwd.z * toLead.z) / toLead.length();
  assert.ok(cos > 0.99, `the lead dead ahead (cos ${cos.toFixed(4)})`);
  // from the left wing: the lead ahead and to the right
  af.flypast.ride('wing', cam);
  assert.ok(left.model.cockpitView && !slot.model.cockpitView);
  const f2 = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const to2 = new Vector3().subVectors(lead.pos, cam.position);
  assert.ok((f2.x * to2.x + f2.y * to2.y + f2.z * to2.z) / to2.length() > 0.9, 'looking towards the lead');
  // the chase plane: behind and above the lead, looking at the formation
  af.flypast.ride('chase', cam);
  assert.ok(af.flypast.jets.every((j) => !j.model.cockpitView));
  const back = new Vector3().subVectors(cam.position, lead.pos);
  const along = back.x * Math.sin(lead.heading) + back.z * Math.cos(lead.heading);
  assert.ok(along < -40 && back.y > 5, `${along.toFixed(0)} m behind, ${back.y.toFixed(0)} m up`);
  assert.ok(cam.target && cam.target.distanceTo(lead.pos) < 60);
  assert.equal(cam.up.y, 1, 'its up left as it was');
  // off: the cockpits out again; and when it's over
  af.flypast.ride(null, cam);
  assert.ok(af.flypast.jets.every((j) => !j.model.cockpitView));
  af.flypast.ride('slot', cam);
  af.flypast.end();
  assert.ok(af.flypast.jets.every((j) => !j.model.cockpitView));
});

// ---------------------------------------------------------------------------------------------------------------------
// The other formations, chosen or a surprise, and their smoke
// ---------------------------------------------------------------------------------------------------------------------
const lowest = (af) => Math.min(...af.flypast.jets.map((j) => j.pos.y));
const highest = (af) => Math.max(...af.flypast.jets.map((j) => j.pos.y));

test('each formation flies in its own shape and starts its display where it is seen best', () => {
  for (const [id, f] of Object.entries(FORMATIONS)) {
    const { af } = airForce();
    af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: id });
    assert.equal(af.flypast.id, id);
    af.update(1 / 60, 0);
    const lead = af.flypast.jets[0];
    // every jet in its slot of the shape, in the formation's frame (heading pi: left +x is -x, forward +z is -z)
    const [x0, y0, z0] = f.slots[0].at;
    af.flypast.jets.forEach((j, k) => {
      const [x, y, z] = f.slots[k].at;
      const ok = Math.abs(j.pos.x - lead.pos.x + (x - x0)) < 1e-6 && Math.abs(j.pos.y - lead.pos.y - (y - y0)) < 1e-6
        && Math.abs(j.pos.z - lead.pos.z + (z - z0)) < 1e-6;
      assert.ok(ok, `${id} #${k + 1}`);
    });
    // the display starts `past` metres past the camera (negative: in front of it)
    run(af, af.flypast.eta - 1 / 60);
    assert.ok(Math.abs(lead.pos.z - z0 + f.past) < 10, `${id} starts at z ${lead.pos.z.toFixed(0)}`);
    assert.equal(f.slots.length, 4);
    assert.equal(f.smoke.length, 4);
  }
});

test('the missing man: #3 pulls up out of the finger four over you, the others fly on level, the binoculars on him', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: 'missingMan' });
  af.update(1 / 60, 0);
  const ys = af.flypast.jets.map((j) => j.pos.y);
  run(af, af.flypast.eta + 8);
  const [lead, , three] = af.flypast.jets;
  assert.ok(three.pos.y > ys[2] + 800, `#3 up to ${three.pos.y.toFixed(0)} m`);
  for (const k of [0, 1, 3]) assert.ok(Math.abs(af.flypast.jets[k].pos.y - ys[k]) < 1e-6, 'the others level');
  assert.ok(three.model.ab > 0.9 && lead.model.ab < 0.01, 'only #3 in afterburner');
  const at = new Vector3();
  const r = af.flypast.focus(at);
  assert.ok(at.distanceTo(three.pos) < 1e-6 && r === 10, 'the binoculars follow him');
});

test('the fan break: one by one, each rolls left into a turn away', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: 'echelonBreak' });
  const jets = af.flypast.jets;
  const h0 = jets[0].heading;
  run(af, af.flypast.eta + 1.5);
  assert.ok(jets[0].bank < -0.8 && jets[0].heading > h0 + 0.05, 'the lead first');
  assert.ok(Math.abs(jets[3].bank) < 1e-9 && jets[3].heading === h0, '#4 still in echelon');
  run(af, 6);
  for (let k = 1; k < 4; k++) assert.ok(jets[k].heading < jets[k - 1].heading - 0.1, `#${k + 1} after #${k}`);
  assert.ok(jets.every((j) => j.bank < -1.1 && j.heading > h0 + 0.3));
});

test('the loop: abreast all the way round in front of the camera, back level on the heading they came in on', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: 'abreastLoop' });
  af.update(1 / 60, 0);
  const y0 = af.flypast.jets[0].pos.y;
  const h0 = af.flypast.jets[0].heading;
  const loop = (2 * Math.PI) / 0.35;
  let nearest = Infinity;
  run(af, af.flypast.eta + loop / 2);
  assert.ok(lowest(af) > y0 + 1000 && highest(af) - lowest(af) < 1, `top ${lowest(af).toFixed(0)} m`);
  run(af, loop / 2 + 0.5, 1 / 60, () => { nearest = Math.min(nearest, af.flypast.jets[0].pos.z); });
  assert.ok(nearest > 0, `the whole loop in front of the camera (nearest at z ${nearest.toFixed(0)})`);
  assert.ok(Math.abs(lowest(af) - y0) < 15, `back at ${lowest(af).toFixed(0)} m`);
  assert.ok(highest(af) - lowest(af) < 1, 'abreast');
  assert.ok(af.flypast.jets.every((j) => Math.abs(j.pitch - 2 * Math.PI) < 1e-6 && j.heading === h0));
});

test('line astern: two rolls each in turn, then up into the climb', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: 'trailRolls' });
  const jets = af.flypast.jets;
  run(af, af.flypast.eta + 1);
  assert.ok(jets[0].rollAngle > jets[1].rollAngle && jets[1].rollAngle > jets[2].rollAngle, 'in turn');
  run(af, 5.5);
  assert.ok(jets.every((j) => Math.abs(j.rollAngle - 4 * Math.PI) < 1e-9), 'two rolls each, then wings level');
  run(af, 4);
  assert.ok(jets.every((j) => j.pitch > 0.5), 'climbing');
});

test('a surprise is a different formation each time; the diamond unless one is asked for', () => {
  const { af } = airForce();
  af.orderFlypast(camera(0, 2, 0, 0, 1));
  assert.equal(af.flypast.id, 'diamond');
  const seen = new Set();
  let last = af.flypast.id;
  for (let k = 0; k < 40; k++) {
    af.flypast.end();
    af.orderFlypast(camera(0, 2, 0, 0, 1), { formation: 'random' });
    assert.notEqual(af.flypast.id, last);
    last = af.flypast.id;
    seen.add(last);
  }
  assert.equal(seen.size, Object.keys(FORMATIONS).length, [...seen].join());
});

test('red and white smoke from behind each jet, on through the display, facing the camera; or none', () => {
  const { af } = airForce();
  const cam = camera(0, 2, 0, 0, 1);
  af.orderFlypast(cam, { formation: 'diamond' });
  const smoke = af.flypast.smoke;
  assert.equal(JSON.stringify(smoke.colours), JSON.stringify(FORMATIONS.diamond.smoke));
  assert.ok(smoke.colours.includes('red') && smoke.colours.includes('white'));
  // off on the run-in, until a few seconds before the display
  run(af, af.flypast.eta - 4, 1 / 60, () => {}, cam);
  assert.ok(smoke.on.every((on) => !on), 'not yet');
  assert.equal(smoke.eye, cam.position, 'facing the camera');
  run(af, 2, 1 / 60, () => {}, cam);
  assert.ok(smoke.on.every((on) => on), 'smoke on');
  // from 10.5 m behind each jet's centre: just aft of its nozzles
  af.flypast.jets.forEach((j, k) => {
    const tail = new Vector3(0, 0, -10.5).applyQuaternion(j.q).add(j.pos);
    assert.ok(Math.hypot(smoke.at[k].x - tail.x, smoke.at[k].y - tail.y, smoke.at[k].z - tail.z) < 1e-6);
  });
  run(af, 14, 1 / 60, () => {}, cam);
  assert.ok(smoke.on.every((on) => !on), 'off again well into it');
  // ordered without smoke
  const { af: plain } = airForce();
  plain.orderFlypast(cam, { smoke: false });
  run(plain, plain.flypast.eta + 1, 1 / 60, () => {}, cam);
  assert.ok(plain.flypast.smoke.on.every((on) => !on));
});
