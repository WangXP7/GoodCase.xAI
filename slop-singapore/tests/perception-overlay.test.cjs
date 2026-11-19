const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// What the autopilot sees, drawn over the view (js/perception-overlay.js): every track as a box on the ground with its
// predicted course, the car it follows and the one it is avoiding picked out, and the line it plans to drive
const perception = loadModule(readFileSync(join(__dirname, '../js/perception.js'), 'utf8'), {
  globals: { Math, Number, Map, Set, WeakMap, Array, Infinity, Object },
  filename: 'perception.js'
});
const overlay = loadModule(readFileSync(join(__dirname, '../js/perception-overlay.js'), 'utf8'), {
  imports: { './perception.js': perception },
  globals: { Math, Number, Map, Set, Array, Infinity, Object, String },
  filename: 'perception-overlay.js'
});

const ego = { position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 10 };

// A tracker that has watched `cars` (moving at their _v) for a second
function watched(cars) {
  const tracker = new perception.Tracker();
  for (let i = 0; i < 60; i++) {
    for (const c of cars) {
      c.x += (c._vx || 0) / 60;
      c.z += (c._vz || 0) / 60;
    }
    tracker.update(1 / 60, [cars], ego);
  }
  return tracker;
}

function navigatorWith(cars, extra = {}) {
  const tracker = watched(cars);
  return {
    tracker, autopilot: true, threat: null, leadObj: null, status: '',
    planPreview: () => [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0.5, z: 20 }],
    mappedPreview: () => [{ x: 0, z: 0 }, { x: 0.4, z: 10 }, { x: 0.2, z: 20 }],
    ...extra
  };
}

const car = (x, z, vx, vz) => ({ edge: {}, x, z, half: 2.3, halfWidth: 0.9, tx: 0, tz: 1, _vx: vx, _vz: vz });

test('every track becomes a box with its predicted course; the followed car and the threat are picked out', () => {
  const lead = car(0, 30, 0, 8);
  const threat = car(-20, 40, 12, 0);
  const parked = car(5.4, 15, 0, 0);
  const walker = { x: 8, z: 12, placed: true };
  const nav = navigatorWith([lead, threat, parked, walker]);
  nav.leadObj = lead;
  nav.threat = { t: 1.5, gap: 0.2, track: nav.tracker.get(threat) };
  const view = overlay.buildOverlay(nav, ego);
  assert.equal(view.objects.length, 4);
  const role = (o) => view.objects.find((v) => v.obj === o).role;
  assert.equal(role(lead), 'lead');
  assert.equal(role(threat), 'threat');
  assert.equal(role(parked), 'tracked');
  assert.equal(role(walker), 'person');
  // box corners: 4, around the car's estimated position, oriented along its motion
  const t = view.objects.find((v) => v.obj === threat);
  assert.equal(t.box.length, 4);
  const cx = t.box.reduce((a, p) => a + p.x, 0) / 4;
  assert.ok(Math.abs(cx - threat.x) < 0.3, 'box centred on it');
  const xs = t.box.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 4, 'long side along its motion (east)');
  // its course: points ahead along its motion, over the autopilot's horizon
  assert.ok(t.trail.length >= 3);
  assert.ok(t.trail[t.trail.length - 1].x > threat.x + 20, 'predicted on east');
  // a parked car has no course to show
  assert.equal(view.objects.find((v) => v.obj === parked).trail.length, 0);
  // the estimated speed for the picked-out ones, in m/s
  assert.ok(Math.abs(view.objects.find((v) => v.obj === lead).speed - 8) < 0.5);
  // the plan, and where the conflict is
  assert.equal(view.plan.length, 3);
  assert.ok(view.conflict && Math.abs(view.conflict.t - 1.5) < 1e-9);
});

test('nothing to show unless an autopilot is driving', () => {
  const nav = navigatorWith([car(0, 30, 0, 8)], { autopilot: false });
  const view = overlay.buildOverlay(nav, ego);
  assert.equal(view.objects.length, 0);
  assert.equal(view.plan.length, 0);
});

test('drawing projects to the screen, skips what is behind the camera, and colours by role', () => {
  const lead = car(0, 30, 0, 8);
  const behind = car(0, -30, 0, 8);
  const threat = car(-20, 40, 12, 0);
  const nav = navigatorWith([lead, behind, threat]);
  nav.leadObj = lead;
  nav.threat = { t: 1, gap: 0, track: nav.tracker.get(threat) };
  const view = overlay.buildOverlay(nav, ego);
  // a camera looking down +z from the origin: in front when z > 0
  const project = (x, y, z) => (z <= 0.5 ? null : { x: 640 + (x / z) * 600, y: 400 - ((y - 1.5) / z) * 600 });
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 1280, height: 800 } }, {
    get(target, k) {
      if (k in target) return target[k];
      return (...args) => calls.push([k, ...args]);
    },
    set(target, k, v) {
      calls.push(['set', k, v]);
      target[k] = v;
      return true;
    }
  });
  const drawn = overlay.drawOverlay(ctx, view, project, { y: 0, dpr: 1 });
  assert.equal(drawn.objects, 2, 'the one behind the camera is left out');
  const strokes = calls.filter((c) => c[0] === 'set' && c[1] === 'strokeStyle').map((c) => c[2]);
  assert.ok(strokes.includes(overlay.COLORS.lead), 'lead colour used');
  assert.ok(strokes.includes(overlay.COLORS.threat), 'threat colour used');
  assert.ok(strokes.includes(overlay.COLORS.plan), 'plan drawn');
  // the mapped line faintly, before (under) the planned one
  assert.equal(view.mapped.length, 3);
  assert.ok(strokes.includes(overlay.COLORS.mapped), 'mapped line drawn');
  assert.ok(strokes.indexOf(overlay.COLORS.mapped) < strokes.indexOf(overlay.COLORS.plan), 'under the plan');
  // labels: the picked-out ones get their speed
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.some((t) => /29 km\/h/.test(t)), `lead labelled with its speed (${texts.join(' | ')})`);
});

test('only what is near is shown, and people\'s courses only when one is the threat', () => {
  const near = car(0, 30, 0, 8);
  const far = car(0, 90, 0, 8);
  const walker = { x: 8, z: 12, placed: true };
  const nav = navigatorWith([near, far, walker]);
  const tr = nav.tracker.get(walker);
  tr.vz = 1.4; tr.speed = 1.4; // walking
  const view = overlay.buildOverlay(nav, ego);
  assert.equal(JSON.stringify(view.objects.map((o) => o.obj === near ? 'near' : o.obj === walker ? 'walker' : 'far').sort()), '["near","walker"]');
  assert.equal(view.objects.find((o) => o.obj === walker).trail.length, 0, 'a walker\'s course is not drawn');
  nav.threat = { t: 1, gap: 0, track: tr };
  assert.ok(overlay.buildOverlay(nav, ego).objects.find((o) => o.obj === walker).trail.length > 0, 'unless they are the threat');
});
