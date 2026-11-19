// World viewer: the engine and the island with a free camera. Used for look development and by
// tools/shot-game.mjs. URL: ?q=high&hour=15&still=1&x=..&y=..&z=..&yaw=..&pitch=..
import * as THREE from 'three';
import { Engine } from '../src/gfx/engine.js';
import { createWorld } from '../src/world/world.js';

const P = new URLSearchParams(location.search);
const num = (k, d) => (P.has(k) ? Number(P.get(k)) : d);
const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const still = P.get('still') === '1';

const engine = new Engine(canvas, { quality: P.get('q') || 'high' });
engine.hour = num('hour', 15);
const world = await createWorld(engine, async (p, label) => {
  hud.textContent = `${label} ${(p * 100) | 0}%`;
  await new Promise((r) => setTimeout(r, 0));
});

const cam = engine.camera;
const view = { x: num('x', 0), y: num('y', 30), z: num('z', 330), heading: num('yaw', 0), pitch: num('pitch', -8) };
function applyView() {
  cam.position.set(view.x, view.y, view.z);
  cam.rotation.set((view.pitch * Math.PI) / 180, (-view.heading * Math.PI) / 180, 0, 'YXZ');
}
applyView();

// free flight: WASD + QE, drag to look, shift = fast
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = false;
canvas.addEventListener('mousedown', () => (drag = true));
addEventListener('mouseup', () => (drag = false));
addEventListener('mousemove', (e) => {
  if (!drag) return;
  view.heading += e.movementX * 0.2;
  view.pitch = Math.max(-89, Math.min(89, view.pitch - e.movementY * 0.2));
});
function fly(dt) {
  const sp = (keys.has('ShiftLeft') ? 90 : 18) * dt;
  const h = (view.heading * Math.PI) / 180;
  const fx = Math.sin(h),
    fz = -Math.cos(h);
  let mx = 0,
    mz = 0,
    my = 0;
  if (keys.has('KeyW')) mz += 1;
  if (keys.has('KeyS')) mz -= 1;
  if (keys.has('KeyD')) mx += 1;
  if (keys.has('KeyA')) mx -= 1;
  if (keys.has('KeyE')) my += 1;
  if (keys.has('KeyQ')) my -= 1;
  view.x += (fx * mz - fz * mx) * sp;
  view.z += (fz * mz + fx * mx) * sp;
  view.y += my * sp;
}

function frame(dt) {
  fly(dt);
  applyView();
  engine.resize();
  engine.update(dt);
  world.update(dt);
  engine.render(dt);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(dt);
  const s = engine.stats;
  hud.textContent = `${s.fps.toFixed(0)} fps  ${s.calls} calls  ${(s.tris / 1000) | 0}k tris  ${engine.w}x${engine.h}\n` + `pos ${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.z.toFixed(1)}  heading ${view.heading.toFixed(0)} pitch ${view.pitch.toFixed(0)}  hour ${engine.hour.toFixed(2)}`;
  requestAnimationFrame(loop);
}
if (!still) requestAnimationFrame(loop);
else hud.style.display = 'none';

window.TP = {
  engine,
  world,
  THREE,
  view,
  /** Place the camera. y < -900 means "this many metres above the ground" (pass eye height as `above`). */
  cam(x, y, z, heading = 0, pitch = 0, above = null) {
    view.x = x;
    view.z = z;
    view.y = above != null ? world.T.heightAt(x, z) + above : y;
    view.heading = heading;
    view.pitch = pitch;
    applyView();
  },
  hour(h) {
    engine.hour = h;
  },
  weather(o) {
    Object.assign(engine.want, o);
    Object.assign(engine.atmo, o);
  },
  /** Run n frames at a fixed step so exposure, lights and LODs settle. */
  step(n = 30, dt = 1 / 30) {
    for (let i = 0; i < n; i++) frame(dt);
  },
  async shot(name, settle = 40) {
    this.step(settle, 1 / 30);
    const url = canvas.toDataURL('image/jpeg', 0.92);
    const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
    return r.json();
  },
  stats() {
    return { ...engine.stats, w: engine.w, h: engine.h, gpu: engine.gpu };
  },
};
window.DONE = true;
