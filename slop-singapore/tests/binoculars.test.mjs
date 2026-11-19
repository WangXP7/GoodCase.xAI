import assert from 'node:assert/strict';
import test from 'node:test';
import { Binoculars, frameFov, BINOCULARS } from '../js/binoculars.js';

// Just enough of a three.js camera: where it is, which way it looks, its lens
class V {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V(this.x, this.y, this.z); }
}
function fakeCamera(fov = 56) {
  const cam = {
    fov, position: new V(0, 2, 0), up: new V(0, 1, 0), dir: new V(0, 0, 1), projections: 0, upWhenLooking: null,
    getWorldDirection(out) { return out.copy(this.dir); },
    lookAt(x, y, z) {
      const L = Math.hypot(x - this.position.x, y - this.position.y, z - this.position.z);
      this.dir.set((x - this.position.x) / L, (y - this.position.y) / L, (z - this.position.z) / L);
      this.upWhenLooking = this.up.clone();
    },
    updateProjectionMatrix() { this.projections++; }
  };
  return cam;
}
const element = () => ({ style: {}, hidden: true, textContent: '', toggleAttribute(k, on) { if (k === 'hidden') this.hidden = on; } });
// A frame: the camera system's view (here: looking ahead, its lens left as it is), then the binoculars
function frames(b, cam, seconds, { dt = 1 / 60, view = () => cam.dir.set(0, 0, 1), each = () => {} } = {}) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    b.before();
    view();
    each(t);
    b.update(dt, t);
  }
}
const deg = (r) => (r * 180) / Math.PI;

test('the lens that frames a target: its spread across half the view, within the binoculars\' range', () => {
  assert.ok(Math.abs(frameFov(2500, 30) - deg(2 * Math.atan(30 / (2500 * BINOCULARS.fill)))) < 1e-9);
  assert.ok(Math.abs(frameFov(2500, 30) - 2.75) < 0.05);
  assert.equal(frameFov(100000, 10), BINOCULARS.minFov, 'no further than the binoculars go');
  assert.equal(frameFov(50, 300), BINOCULARS.maxFov, 'nor wider');
});

test('raised on a target, the view turns to it and zooms in; lowered, it is back as it was', () => {
  const cam = fakeCamera(56);
  const overlay = element(), label = element();
  const b = new Binoculars(cam, { overlay, label });
  const target = { at: new V(0, 150, 2500), r: 30, focus(out) { out.copy(this.at); return this.r; } };
  frames(b, cam, 0.5);
  assert.equal(cam.fov, 56, 'nothing until raised');
  assert.equal(b.active, false);
  assert.ok(overlay.hidden);
  b.watch(target);
  assert.ok(b.active);
  frames(b, cam, 0.2);
  assert.ok(cam.fov < 56 && cam.fov > frameFov(2500, 30), `half way up: ${cam.fov.toFixed(1)}`);
  frames(b, cam, 1.5);
  assert.ok(Math.abs(cam.fov - frameFov(Math.hypot(148, 2500), 30)) < 0.05, `fov ${cam.fov.toFixed(2)}`);
  // aimed at it (within the hand's shake)
  const want = [0, 148 / Math.hypot(148, 2500), 2500 / Math.hypot(148, 2500)];
  const off = Math.acos(cam.dir.x * want[0] + cam.dir.y * want[1] + cam.dir.z * want[2]);
  assert.ok(deg(off) < cam.fov * 0.05, `${deg(off).toFixed(3)} deg off`);
  assert.equal(cam.upWhenLooking.y, 1, 'upright');
  assert.ok(b.zoom > 15 && b.zoom < 30, `x${b.zoom.toFixed(1)}`);
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style.opacity, '1');
  assert.match(label.textContent, /^×\d+ · 2\.5 km$/);
  // it comes over: the aim follows, the lens widens as it nears
  frames(b, cam, 12, { each: () => target.at.set(0, 150, target.at.z - 190 / 60) });
  assert.ok(cam.dir.y > 0.2, 'looking up');
  assert.ok(cam.fov > 4);
  b.lower();
  frames(b, cam, 1.2);
  assert.equal(b.active, false);
  assert.equal(cam.fov, 56, 'the view\'s own lens again');
  assert.ok(overlay.hidden);
});

test('the view\'s own lens carries on under the binoculars (a view that eases its lens, as the jet\'s)', () => {
  const cam = fakeCamera(56);
  const b = new Binoculars(cam);
  const target = { focus(out) { out.set(0, 200, 1500); return 40; } };
  b.watch(target);
  // the view eases its lens towards 74 from wherever it is
  const view = () => { cam.dir.set(0, 0, 1); cam.fov += (74 - cam.fov) * 0.05; };
  frames(b, cam, 3, { view });
  assert.ok(cam.fov < 10, 'zoomed in');
  b.lower();
  frames(b, cam, 1.2, { view });
  assert.ok(Math.abs(cam.fov - 74) < 0.5, `back to the view's eased lens: ${cam.fov.toFixed(2)}`);
});

test('the binoculars come down by themselves once there is nothing left to see', () => {
  const cam = fakeCamera(60);
  const b = new Binoculars(cam);
  let r = 30;
  b.watch({ focus(out) { out.set(0, 100, 800); return r; } });
  frames(b, cam, 1);
  assert.ok(cam.fov < 20);
  r = 0;
  frames(b, cam, 1.2);
  assert.equal(b.active, false);
  assert.equal(cam.fov, 60);
  // toggled: up on the target given, down again
  const t = { focus(out) { out.set(0, 100, 800); return 30; } };
  assert.equal(b.toggle(t), true);
  assert.equal(b.toggle(t), false);
});
