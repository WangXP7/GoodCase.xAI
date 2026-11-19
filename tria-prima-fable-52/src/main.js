// Entry point: builds the game on the page's canvas and runs the frame loop.
// ?q=low|medium|high|ultra forces a quality; ?still=1 hands the clock to a test (window.TP.step);
// ?dev=1 exposes the tool hooks on a running game; ?force=1 skips the keyboard-and-mouse check.
import * as THREE from 'three';
import { createGame } from './game/game.js';
import { add } from './game/state.js';

const P = new URLSearchParams(location.search);
const canvas = document.getElementById('c');

function fail(message, more) {
  const el = document.createElement('div');
  el.className = 'tp-fatal';
  const p = document.createElement('p');
  p.textContent = message;
  el.append(p);
  if (more) el.append(more);
  document.body.append(el);
  return el;
}

/** A phone or a tablet: no keys, no mouse to look with. Say so instead of raising the isle. */
function handsMissing() {
  if (P.has('force') || P.get('still') === '1') return false;
  try {
    return matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

async function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    fail('Tria Prima needs WebGL 2 and a graphics card. This browser did not provide them.');
    return;
  }
  if (handsMissing()) {
    const a = document.createElement('a');
    a.textContent = 'Raise the isle anyway';
    const q = new URLSearchParams(location.search);
    q.set('force', '1');
    a.href = location.pathname + '?' + q;
    fail('Tria Prima is played with a keyboard and a mouse, on a computer with a graphics card. Open this page there.', a);
    return;
  }
  const manual = P.get('still') === '1';
  let game;
  try {
    game = await createGame(canvas, { manual, quality: P.get('q') || undefined });
  } catch (err) {
    console.error(err);
    fail('The island could not be raised: ' + (err && err.message ? err.message : err));
    return;
  }

  let last = performance.now();
  let lost = false;
  function loop(now) {
    if (lost) return;
    const dt = (now - last) / 1000;
    last = now;
    if (!game.manual) game.frame(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // The graphics card can take the picture away (a driver reset, a laptop waking up). Nothing can
  // be drawn after that: keep what can be kept, stop, and say how to go on.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (lost) return;
    lost = true;
    try {
      game.save(true);
    } catch (err) {
      /* the last save stands */
    }
    try {
      game.audio.dispose();
    } catch (err) {
      /* already silent */
    }
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    const a = document.createElement('a');
    a.textContent = 'Load the page again';
    a.href = location.href;
    fail('The graphics card let go of the picture. Load the page again to go on from your last save.', a);
  });

  if (manual || P.has('dev')) hooks(game);
  window.DONE = true;
}

/** Hooks for the tools in tools/ (screenshots, automated play). Not present in a normal visit. */
function hooks(game) {
  const rad = (d) => (d * Math.PI) / 180;
  window.TP = {
    game,
    engine: game.engine,
    world: game.world,
    THREE,
    step(n = 1, dt = 1 / 30) {
      for (let i = 0; i < n; i++) game.frame(dt);
    },
    hour(h) {
      game.state.time.hour = h;
      game.engine.hour = h;
    },
    weather(o) {
      Object.assign(game.engine.want, o);
      Object.assign(game.engine.atmo, o);
    },
    /** Start a fresh game at the dock without the arrival. */
    play() {
      game.debugStart();
    },
    /** Stand the player at (x, z) looking along heading / pitch (degrees). */
    go(x, z, heading = 0, pitch = 0, y = null) {
      game.player.teleport(x, y, z, rad(heading), rad(pitch));
      game.debugCam = null;
    },
    /** A free eye, as in the world viewer. `above` = metres over the ground. null clears it. */
    cam(x, y, z, heading = 0, pitch = 0, above = null) {
      if (x == null) {
        game.debugCam = null;
        return;
      }
      game.debugCam = { x, y: above != null ? game.world.T.heightAt(x, z) + above : y, z, heading: rad(heading), pitch: rad(pitch) };
    },
    give(o = {}) {
      const inv = game.state.inv;
      for (const k in o.potions || {}) add(inv.potions, k, o.potions[k], 9);
      for (const k in o.ingredients || {}) add(inv.ingredients, k, o.ingredients[k], 99);
      for (const k in o.primes || {}) inv.primes[k] = !!o.primes[k];
      if (!inv.selected) inv.selected = Object.keys(inv.potions)[0] || null;
    },
    async shot(name, settle = 30) {
      this.step(settle, 1 / 30);
      const url = canvas.toDataURL('image/jpeg', 0.92);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
      return r.json();
    },
    stats() {
      const e = game.engine;
      return { ...e.stats, w: e.w, h: e.h, gpu: e.gpu, quality: e.quality };
    },
  };
}

boot();
