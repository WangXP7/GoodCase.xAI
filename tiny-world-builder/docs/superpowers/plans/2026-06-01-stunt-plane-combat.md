# Stunt-plane Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wing guns, a full targeting HUD, and guided missiles to the tinyworld stunt plane, with persistent destructible scenery and message-based PvP hits.

**Architecture:** All combat lives in a new scene-space module `engine/world/41-flight-combat.js`, hooked from `34-flight-sim.js` through optional globals (the same pattern as the multiplayer `broadcastFlight` hook). The flight physics is never modified. A single target-adapter interface lets guns/HUD/missiles treat MP ghosts and destructible world cells uniformly. Scenery destruction routes through the existing `setCell(kind:null)` path, which already broadcasts to peers, persists, and is undoable. Player hits use a `combat.hit` message; each client owns its own plane's health and death.

**Tech Stack:** Vanilla ES5-ish browser JS, THREE r128 (vendored global), partykit multiplayer, node `--test` for pure-logic tests, playwright-mcp + `window.__flightCombat.telemetry()` for in-browser 3D-math verification.

**Spec:** `docs/superpowers/specs/2026-06-01-stunt-plane-combat-design.md`

---

## Conventions for this plan

- **Module style:** `engine/world/*.js` files are plain script-tag globals that
  run inside the app's shared closure (they reference `THREE`, `scene`,
  `camera`, `cellMeshes`, `setCell`, etc. as ambient globals — there are no
  imports). `41-flight-combat.js` wraps its internals in an IIFE and publishes a
  single `window.__flightCombat` object, mirroring how `34-flight-sim.js`
  publishes `window.enterFlight` / `window.__flightJet`.
- **Static gate (run after every task):**
  `npm run check && npm run smoke` — these concatenate all engine modules and
  assert they parse and contain expected markers. A new module that throws a
  syntax error fails here.
- **Pure-logic tests:** `tests/flight-combat-math.test.mjs` run via
  `node --test tests/*.test.mjs`. THREE is not available in node, so these tests
  use a tiny inlined vec/quat helper (provided in Task 2) — they verify the
  geometry decisions (fire-direction back-out, aim magnet, proximity), which are
  the highest-risk math.
- **Browser verification:** `npm run dev` serves
  `http://localhost:3000/tiny-world-builder`. Verification drives flight via the
  exposed globals and reads `window.__flightCombat.telemetry()`, asserting with
  3D vector math — never screenshots or synthetic clicks (project lesson:
  `test-with-3d-math-not-screenshots`, `verify-in-real-app-not-synthetic`).
- **No emoji** anywhere in code, UI, or commit messages (project rule).
- **Commits:** the user commits/pushes; this repo auto-pushes `main` to prod.
  Each task ends with a *prepared* commit command the user can run. Do not push.

---

## File structure

| File | Responsibility |
|------|----------------|
| `engine/world/41-flight-combat.js` (new) | All combat state, guns, missiles, target adapter, HUD, damage, telemetry. Publishes `window.__flightCombat`. |
| `engine/world/34-flight-sim.js` (modify) | 3 guarded hook calls + `window.__flightSceneForward()` helper + Space/mouse fire-intent capture. No combat logic. |
| `engine/world/38-multiplayer-partykit.js` (modify) | `flightGhosts()` getter on the export object; route inbound `combat.hit` messages to `window.__flightCombat.onIncomingHit`. |
| `tiny-world-builder.html` (modify) | One `<script src="engine/world/41-flight-combat.js">` after the file-40 script tag; flight-combat HUD CSS in the existing `<style>`. |
| `tests/flight-combat-math.test.mjs` (new) | Pure-logic node tests for fire-direction, aim magnet, proximity guidance. |

---

## Phase 0 — Scaffolding and hooks

### Task 1: Create the combat module skeleton and wire it into file 34

**Files:**
- Create: `engine/world/41-flight-combat.js`
- Modify: `tiny-world-builder.html` (after line 1502, the file-40 script tag is `engine/world/40-shield-system.js`; insert 41 after the highest-numbered flight-related script — verify ordering so 41 loads after 34 and 38)
- Modify: `engine/world/34-flight-sim.js` (`tickFlight` ~563-579, `enterFlight` ~595-645, `exitFlight` ~647-669)

- [ ] **Step 1: Create `engine/world/41-flight-combat.js` with a no-op published API**

```javascript
// engine/world/41-flight-combat.js
// -------- flight combat: guns, targeting HUD, missiles --------
// Scene-space combat for the stunt plane. Hooked from 34-flight-sim.js via
// optional globals (same pattern as window.__tinyworldMultiplayer.broadcastFlight).
// Reads the rendered plane transform off window.__flightJet each tick; never
// touches the sim-space flight physics.
(function flightCombatModule() {
  'use strict';
  if (typeof THREE === 'undefined') return;

  let active = false;
  let jet = null; // window.__flightJet while flying

  function onEnter(flyingJet) {
    jet = flyingJet || window.__flightJet || null;
    active = true;
  }

  function onExit() {
    active = false;
    jet = null;
  }

  function tick(dt) {
    if (!active || !(dt > 0)) return;
    // systems added in later tasks
  }

  function telemetry() {
    return {
      active,
      hasJet: !!jet,
    };
  }

  window.__flightCombat = { onEnter, onExit, tick, telemetry };
})();
```

- [ ] **Step 2: Add the script tag in `tiny-world-builder.html`**

Find the line `<script src="engine/world/40-shield-system.js"></script>` (or the
highest-numbered `engine/world/*` script). Insert immediately after it:

```html
  <script src="engine/world/41-flight-combat.js"></script>
```

Confirm with: `grep -n "engine/world/4" tiny-world-builder.html` — `41-flight-combat.js` must appear AFTER `34-flight-sim.js` and `38-multiplayer-partykit.js`.

- [ ] **Step 3: Add `window.__flightSceneForward` helper to file 34**

In `engine/world/34-flight-sim.js`, immediately after the `tickFlight`
definition / `window.tickFlight = tickFlight;` line (~579), add:

```javascript
  // Scene-space travel-forward of the plane (unit vector), with the visual
  // FLIGHT_MODEL_FWD_FIX 180-degree spin backed out. This is the direction the
  // nose actually travels, which combat fires along. Exposed for 41-flight-combat.js.
  const _flSceneFwd = new THREE.Vector3();
  const _flSceneFwdQuat = new THREE.Quaternion();
  window.__flightSceneForward = function (out) {
    const v = out || _flSceneFwd;
    _flSceneFwdQuat.copy(flightYawQuat).multiply(flightPlane.quat);
    return v.set(0, 0, -1).applyQuaternion(_flSceneFwdQuat).normalize();
  };
```

- [ ] **Step 4: Wire the three combat hooks into file 34**

In `tickFlight` (after `updateFlightCamera(dt);` and the multiplayer broadcast
block, before the closing brace ~578), add:

```javascript
    if (window.__flightCombat && typeof window.__flightCombat.tick === 'function') {
      window.__flightCombat.tick(dt);
    }
```

In `enterFlight`, just before `return true;` (~644), add:

```javascript
    if (window.__flightCombat && typeof window.__flightCombat.onEnter === 'function') {
      window.__flightCombat.onEnter(jet);
    }
```

In `exitFlight`, after `window.__flightActive = false;` (~657), add:

```javascript
    if (window.__flightCombat && typeof window.__flightCombat.onExit === 'function') {
      window.__flightCombat.onExit();
    }
```

- [ ] **Step 5: Run the static gate**

Run: `npm run check && npm run smoke`
Expected: both pass (exit 0). If `check` complains about an unknown new file, read its output — it concatenates modules and checks markers; a syntax error in 41 shows here.

- [ ] **Step 6: Browser smoke — hooks fire**

Run `npm run dev`. With playwright-mcp, navigate to
`http://localhost:3000/tiny-world-builder`, then in the page evaluate:

```javascript
// Confirm the module published and file 34 can call it.
JSON.stringify({
  hasCombat: !!window.__flightCombat,
  hasForward: typeof window.__flightSceneForward,
  telem: window.__flightCombat && window.__flightCombat.telemetry(),
});
```

Expected: `hasCombat: true`, `hasForward: "function"`, `telem.active: false`.

- [ ] **Step 7: Prepare commit**

```bash
git add engine/world/41-flight-combat.js engine/world/34-flight-sim.js tiny-world-builder.html
git commit -m "flight-combat: scaffold module 41 and wire hooks into flight-sim"
```

---

## Phase 1 — Guns and reticle (no targets); verify aim with 3D math

### Task 2: Fire-direction + muzzle math, with pure-logic tests

**Files:**
- Create: `tests/flight-combat-math.test.mjs`
- Modify: `engine/world/41-flight-combat.js`

This task isolates the highest-risk math (the FWD_FIX back-out and muzzle
derivation) into pure helpers and tests them in node without THREE.

- [ ] **Step 1: Write the failing pure-logic test**

```javascript
// tests/flight-combat-math.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quatFromAxisAngle, applyQuatToVec, normalize } from './helpers/mini-vec.mjs';
import { combatForwardFromQuats } from '../engine/world/flight-combat-math.mjs';

// Plane level, yaw 0: scene-forward must be -Z (the travel direction), NOT +Z.
// combatForwardFromQuats composes yawQuat * planeQuat and applies to (0,0,-1).
test('forward is -Z when level and unrotated', () => {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const fwd = combatForwardFromQuats(identity, identity);
  assert.ok(Math.abs(fwd.x) < 1e-9);
  assert.ok(Math.abs(fwd.y) < 1e-9);
  assert.ok(Math.abs(fwd.z + 1) < 1e-9, `expected z=-1, got ${fwd.z}`);
});

// Yaw 90 deg about +Y rotates -Z toward -X (right-handed). Confirms we compose
// yaw correctly and do NOT accidentally include the 180 model-fix.
test('yaw 90 about Y turns forward toward -X', () => {
  const yaw = quatFromAxisAngle(0, 1, 0, Math.PI / 2);
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const fwd = combatForwardFromQuats(yaw, identity);
  assert.ok(Math.abs(fwd.x + 1) < 1e-6, `expected x=-1, got ${fwd.x}`);
  assert.ok(Math.abs(fwd.z) < 1e-6, `expected z=0, got ${fwd.z}`);
});
```

- [ ] **Step 2: Add the tiny node vec/quat helper**

```javascript
// tests/helpers/mini-vec.mjs
// Minimal quaternion/vector math for node tests (THREE is browser-only here).
export function quatFromAxisAngle(ax, ay, az, angle) {
  const h = angle / 2, s = Math.sin(h);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}
export function multiplyQuat(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function applyQuatToVec(q, v) {
  // t = 2 * cross(q.xyz, v); result = v + q.w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
export function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
```

- [ ] **Step 3: Add the pure math module (shared, framework-free)**

```javascript
// engine/world/flight-combat-math.mjs
// Pure geometry shared by the browser module and node tests. No THREE, no DOM.
// IMPORTANT: this composes yawQuat * planeQuat and applies (0,0,-1) — it does
// NOT include FLIGHT_MODEL_FWD_FIX. The model's 180 visual spin must stay out
// of the firing direction or bullets fly out the tail.
function mulQuat(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function applyQuat(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
export function combatForwardFromQuats(yawQuat, planeQuat) {
  const q = mulQuat(yawQuat, planeQuat);
  const v = applyQuat(q, { x: 0, y: 0, z: -1 });
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
```

Note: the browser module (Task 3) uses file 34's `window.__flightSceneForward`
at runtime; this `.mjs` exists so the same decision is unit-testable. They must
agree — both compose `yawQuat * planeQuat` and apply `(0,0,-1)`.

- [ ] **Step 4: Run the tests — verify pass**

Run: `node --test tests/*.test.mjs`
Expected: the two new tests PASS plus the existing `party.test.mjs`. If `party.test.mjs` has unrelated failures, note them but don't fix here.

- [ ] **Step 5: Run static gate**

Run: `npm run check && npm run smoke`
Expected: pass. (`.mjs` files under `engine/` are concatenated by the guards; ESM `export` is valid syntax for the parse check. If `check` chokes on `export` in concatenation, move `flight-combat-math.mjs` to `tests/helpers/` and have the browser module not depend on it — keep the runtime forward in file 34. Decide based on actual `check` output.)

- [ ] **Step 6: Prepare commit**

```bash
git add tests/flight-combat-math.test.mjs tests/helpers/mini-vec.mjs engine/world/flight-combat-math.mjs
git commit -m "flight-combat: pure fire-direction math with node tests"
```

### Task 3: Gun tracers, muzzle flash, fire input, hitscan stub

**Files:**
- Modify: `engine/world/41-flight-combat.js`
- Modify: `engine/world/34-flight-sim.js` (add `Space` to `FLIGHT_KEYCODES`; expose a mouse-fire flag)
- Reference: `engine/world/23-particles-clouds.js` (reuse an existing emitter if present)

- [ ] **Step 1: Inspect the existing particle system for a reusable emitter**

Run: `grep -nE "function .*[Ee]mit|emitCluster|ParticlePool|class .*Pool|spawn\b|burst" engine/world/23-particles-clouds.js | head -30`
Decide: if a cluster/burst emitter exists and is reachable as a global, use it
for muzzle flash. If not, the tracer meshes alone (Step 3) carry the visual and
muzzle flash is a short-lived emissive sprite added in 41. Record which path
you took in a code comment.

- [ ] **Step 2: Add `Space` capture + mouse-fire flag in file 34**

In `engine/world/34-flight-sim.js`, in the `FLIGHT_KEYCODES` object (~713-717),
add `Space: 1,`. Then after the keyup listener block (~734), add a pointer
fire-intent capture that 41 reads:

```javascript
  // Mouse fire-intent: left button while flying. 41-flight-combat reads
  // window.__flightFireHeld. Kept here so the key/pointer capture all lives in
  // one place and is gated on flightActive.
  window.__flightFireHeld = false;
  window.addEventListener('pointerdown', e => {
    if (flightActive && e.button === 0) { window.__flightFireHeld = true; }
  }, true);
  window.addEventListener('pointerup', e => {
    if (e.button === 0) window.__flightFireHeld = false;
  }, true);
```

Also expose the live key state for Space so 41 can read it without re-capturing:

```javascript
  window.__flightKeys = flightKeys;
```
(Place this right after the `const flightKeys = {};` declaration area is set up,
or at the end of the IIFE — anywhere after `flightKeys` exists.)

- [ ] **Step 3: Add the tracer pool + fire logic in 41**

In `engine/world/41-flight-combat.js`, add module-scope state and a fire routine.
Muzzle offsets are derived from the jet bbox in `onEnter` (Step 4). The fire
direction comes from `window.__flightSceneForward`.

```javascript
  // ---- tracers ----
  const TRACER_POOL = 48;
  const TRACER_SPEED = 46;     // scene units/sec (scene is ~0.09x sim scale)
  const TRACER_LIFE = 0.55;
  const FIRE_COOLDOWN = 0.11;
  let tracerGroup = null;
  const tracers = [];
  let fireCooldown = 0;
  let shotsFired = 0;
  const gunMuzzleL = new THREE.Vector3(); // jet-local offsets, set in onEnter
  const gunMuzzleR = new THREE.Vector3();
  const _muzzleWorld = new THREE.Vector3();
  const _fireDir = new THREE.Vector3();
  const _tracerQuat = new THREE.Quaternion();

  function ensureTracerPool() {
    if (tracerGroup) return;
    tracerGroup = new THREE.Group();
    tracerGroup.name = 'tw_flight_tracers';
    scene.add(tracerGroup);
    const geo = new THREE.BoxGeometry(0.03, 0.03, 0.6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffce6a, toneMapped: false, transparent: true,
      opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < TRACER_POOL; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.renderOrder = 30;
      m.raycast = () => {};
      tracerGroup.add(m);
      tracers.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
    }
  }

  function spawnTracer(origin, dir) {
    const t = tracers.find(s => !s.active);
    if (!t) return;
    t.active = true;
    t.life = TRACER_LIFE;
    t.vel.copy(dir).multiplyScalar(TRACER_SPEED);
    t.mesh.position.copy(origin);
    t.mesh.quaternion.copy(_tracerQuat.setFromUnitVectors(_projForward, dir));
    t.mesh.visible = true;
  }
  const _projForward = new THREE.Vector3(0, 0, 1);

  function updateTracers(dt) {
    for (const t of tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.addScaledVector(t.vel, dt);
    }
  }

  function fireGuns() {
    if (!jet) return;
    const dir = window.__flightSceneForward
      ? window.__flightSceneForward(_fireDir)
      : _fireDir.set(0, 0, -1);
    for (const local of [gunMuzzleL, gunMuzzleR]) {
      _muzzleWorld.copy(local);
      jet.localToWorld(_muzzleWorld);
      spawnTracer(_muzzleWorld, dir);
      attemptInstantHit(_muzzleWorld, dir); // no-op until Task 9
    }
    shotsFired++;
  }

  function attemptInstantHit(origin, dir) { /* implemented in Task 9 */ }
```

- [ ] **Step 4: Derive muzzle offsets from the jet bbox in `onEnter`**

Replace the `onEnter` body so it computes wing-tip muzzles from the actual
tinyworld plane bounds (NOT the ships numbers):

```javascript
  const _bbox = new THREE.Box3();
  const _bsize = new THREE.Vector3();
  const _bcenter = new THREE.Vector3();
  function onEnter(flyingJet) {
    jet = flyingJet || window.__flightJet || null;
    active = true;
    fireCooldown = 0;
    shotsFired = 0;
    ensureTracerPool();
    if (jet) {
      jet.updateMatrixWorld(true);
      _bbox.setFromObject(jet);
      _bbox.getSize(_bsize);
      _bbox.getCenter(_bcenter);
      // Convert the world-space bbox into jet-local by undoing jet world matrix.
      // Half-wingspan along local X; nose is local -Z after the model fwd-fix,
      // so muzzles sit slightly forward (toward -Z in jet-local? the model's
      // visual nose is +Z because of FWD_FIX) -> place muzzles toward +Z local
      // (visual nose) and out along X. Verified empirically in Step 7.
      const halfSpan = (_bsize.x * 0.5) * 0.62;
      const noseZ = (_bsize.z * 0.5) * 0.55;
      const dropY = -_bsize.y * 0.05;
      gunMuzzleL.set(-halfSpan, dropY, noseZ);
      gunMuzzleR.set(halfSpan, dropY, noseZ);
    }
  }
```

Note the sign of `noseZ`: `jet` carries `FLIGHT_MODEL_FWD_FIX` so its visual nose
is +Z in jet-local space. Muzzles go toward the visual nose (+Z local), but
bullets travel along `__flightSceneForward` (scene -Z), which is correct because
that helper backs out the fix. Confirm the muzzle sits at the nose, not the
tail, in Step 7; flip `noseZ` sign if it is behind the plane.

- [ ] **Step 5: Drive fire from input in `tick`, update tracers, extend telemetry**

```javascript
  function tick(dt) {
    if (!active || !(dt > 0)) return;
    fireCooldown = Math.max(0, fireCooldown - dt);
    const keys = window.__flightKeys || {};
    const firing = !!keys['Space'] || !!window.__flightFireHeld;
    if (firing && fireCooldown <= 0) {
      fireGuns();
      fireCooldown = FIRE_COOLDOWN;
    }
    updateTracers(dt);
  }
```

Extend `telemetry()`:

```javascript
  function telemetry() {
    const dir = (active && window.__flightSceneForward)
      ? window.__flightSceneForward(_fireDir).clone() : null;
    return {
      active, hasJet: !!jet, shotsFired,
      fireDir: dir ? { x: dir.x, y: dir.y, z: dir.z } : null,
      muzzleL: jet ? jet.localToWorld(gunMuzzleL.clone()).toArray() : null,
      muzzleR: jet ? jet.localToWorld(gunMuzzleR.clone()).toArray() : null,
    };
  }
```

- [ ] **Step 6: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 7: Browser verify — aim is forward, by 3D math (NOT screenshot)**

`npm run dev`, playwright-mcp navigate to the app. Place/enter a stunt plane in
flight (use the app's normal flow, or if a test hook exists call
`window.enterFlight(x,z)` on a known plane cell). Then evaluate:

```javascript
(() => {
  const t = window.__flightCombat.telemetry();
  // The plane spawns flying along scene -Z (file 34: initial vel (0,0,-34) in
  // sim, mapped through yaw). fireDir must have a clearly negative dot with the
  // tail and point AHEAD of the plane. Compare muzzle->fireDir vs plane center.
  const jet = window.__flightJet;
  const c = new THREE.Vector3(); jet.getWorldPosition(c);
  const mL = new THREE.Vector3().fromArray(t.muzzleL);
  // muzzle should be ahead of center along fireDir:
  const ahead = mL.clone().sub(c);
  const fd = new THREE.Vector3(t.fireDir.x, t.fireDir.y, t.fireDir.z);
  return { aheadDot: ahead.dot(fd), shotsFired: t.shotsFired, fireDir: t.fireDir };
})();
```

Expected: `aheadDot > 0` (muzzle is forward of the plane center along the fire
direction). Hold Space (dispatch a real keydown for `Space` with `flightActive`)
for ~0.3s, re-read telemetry: `shotsFired` increased. If `aheadDot < 0`, flip
the `noseZ` sign in `onEnter` and re-verify.

- [ ] **Step 8: Prepare commit**

```bash
git add engine/world/41-flight-combat.js engine/world/34-flight-sim.js
git commit -m "flight-combat: gun tracers, fire input, bbox-derived muzzles"
```

### Task 4: Reticle HUD (lagged, raised)

**Files:**
- Modify: `engine/world/41-flight-combat.js`
- Modify: `tiny-world-builder.html` (flight-combat CSS in the `<style>` block)

- [ ] **Step 1: Add reticle + HUD CSS to the HTML `<style>` block**

Find the existing `.flight-hud` rule in `tiny-world-builder.html` (the flight HUD
created by file 34). Add nearby:

```css
  #flight-combat-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 60; display: none; }
  body.flight-active #flight-combat-overlay { display: block; }
  #flight-reticle { position: absolute; width: 38px; height: 38px; margin: -19px 0 0 -19px;
    border: 1.5px solid rgba(120,230,255,0.85); border-radius: 50%;
    box-shadow: 0 0 6px rgba(120,230,255,0.4); transition: none; }
  #flight-reticle::before, #flight-reticle::after { content: ''; position: absolute; background: rgba(120,230,255,0.85); }
  #flight-reticle::before { left: 50%; top: -8px; width: 1px; height: 8px; }
  #flight-reticle::after { top: 50%; left: -8px; height: 1px; width: 8px; }
  .fc-target-bracket { position: absolute; border: 1px solid rgba(255,179,106,0.9); box-sizing: border-box; }
  .fc-target-card { position: absolute; font: 10px/1.35 ui-monospace, Menlo, monospace;
    color: #ffd9a8; background: rgba(8,14,25,0.7); border: 1px solid rgba(255,179,106,0.5);
    padding: 2px 5px; white-space: pre; border-radius: 3px; }
  .fc-target-bracket.locked { border-color: rgba(120,255,150,0.95); box-shadow: 0 0 8px rgba(120,255,150,0.5); }
```

- [ ] **Step 2: Build the overlay + reticle DOM in 41**

```javascript
  // ---- HUD overlay ----
  let overlayEl = null, reticleEl = null;
  const reticleState = { x: 0, y: 0, vx: 0, vy: 0, init: false };
  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'flight-combat-overlay';
    reticleEl = document.createElement('div');
    reticleEl.id = 'flight-reticle';
    overlayEl.appendChild(reticleEl);
    document.body.appendChild(overlayEl);
  }
```

Call `ensureOverlay()` in `onEnter`. In `onExit`, hide brackets/cards
(`active=false` + `body.flight-active` removal by file 34 already hides the
overlay via CSS).

- [ ] **Step 3: Project a forward aim point and spring-smooth the reticle**

```javascript
  const _aimWorld = new THREE.Vector3();
  const _aimProj = new THREE.Vector3();
  function updateReticle(dt) {
    if (!jet || !reticleEl) return;
    const dir = window.__flightSceneForward(_fireDir);
    jet.getWorldPosition(_aimWorld);
    // Aim point: a lookahead along the fire dir, biased slightly up so the
    // sight sits above the nose for practical gunnery.
    _aimWorld.addScaledVector(dir, 60).add(_aimUp.set(0, 1.2, 0));
    _aimProj.copy(_aimWorld).project(camera); // NDC -1..1
    const tx = (_aimProj.x * 0.5 + 0.5) * window.innerWidth;
    const ty = (-_aimProj.y * 0.5 + 0.5) * window.innerHeight;
    if (!reticleState.init) { reticleState.x = tx; reticleState.y = ty; reticleState.init = true; }
    // critically-damped-ish spring for natural lag
    const k = 90, c = 18;
    reticleState.vx += (-(reticleState.x - tx) * k - reticleState.vx * c) * dt;
    reticleState.vy += (-(reticleState.y - ty) * k - reticleState.vy * c) * dt;
    reticleState.x += reticleState.vx * dt;
    reticleState.y += reticleState.vy * dt;
    const behind = _aimProj.z > 1;
    reticleEl.style.display = behind ? 'none' : 'block';
    reticleEl.style.left = reticleState.x + 'px';
    reticleEl.style.top = reticleState.y + 'px';
  }
  const _aimUp = new THREE.Vector3();
```

Call `updateReticle(dt)` in `tick`. Add `reticleState.init = false;` to `onEnter`.
Add `reticle_x`/`reticle_y` to telemetry.

- [ ] **Step 4: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 5: Browser verify reticle position**

Enter flight, evaluate:

```javascript
(() => { const t = window.__flightCombat.telemetry();
  return { rx: t.reticle_x, ry: t.reticle_y, w: innerWidth, h: innerHeight }; })();
```

Expected (level flight, looking forward): `rx` near horizontal center
(`|rx - innerWidth/2| < innerWidth*0.25`), `ry` in the upper-middle band
(`ry < innerHeight*0.6`). Pitch the plane (dispatch KeyW/KeyS keydowns while
flightActive) and confirm `ry` moves and lags (re-read across two frames).

- [ ] **Step 6: Prepare commit**

```bash
git add engine/world/41-flight-combat.js tiny-world-builder.html
git commit -m "flight-combat: lagged forward-projected reticle HUD"
```

---

## Phase 2 — Target adapter + HUD over MP ghosts

### Task 5: Expose MP flight ghosts from module 38

**Files:**
- Modify: `engine/world/38-multiplayer-partykit.js` (export object ~1833-1860)

- [ ] **Step 1: Add a `flightGhosts()` getter to the published API**

In the `window.__tinyworldMultiplayer = { ... }` object, add:

```javascript
      // Live remote-player flight ghosts for combat targeting (41-flight-combat).
      // Returns lightweight refs; consumers must not mutate the groups.
      flightGhosts: () => {
        const out = [];
        flightGhosts.forEach((ghost, id) => {
          if (ghost && ghost.group && ghost.group.visible) out.push({ id, group: ghost.group });
        });
        return out;
      },
```

(`flightGhosts` Map is in scope at ~line 44.)

- [ ] **Step 2: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 3: Browser verify the getter exists**

Evaluate:

```javascript
({ hasMP: !!window.__tinyworldMultiplayer,
   ghostsType: window.__tinyworldMultiplayer && typeof window.__tinyworldMultiplayer.flightGhosts,
   ghosts: window.__tinyworldMultiplayer && window.__tinyworldMultiplayer.flightGhosts() });
```

Expected: `ghostsType: "function"`, `ghosts: []` solo (or populated with a second client). Full 2-client population is exercised in Task 7.

- [ ] **Step 4: Prepare commit**

```bash
git add engine/world/38-multiplayer-partykit.js
git commit -m "multiplayer: expose flightGhosts() for combat targeting"
```

### Task 6: Target adapter + candidate collection (ghost provider)

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Define the adapter shape and a ghost-backed implementation**

```javascript
  // ---- target adapter ----
  // Uniform target interface so guns/missiles/HUD never special-case kinds.
  //   { id, kind, getWorldPos(out), radius, isAlive(), label(), speedKts(),
  //     applyDamage(amount, hitScenePos, source) }
  const targets = [];                 // rebuilt each frame
  const _prevGhostPos = new Map();    // id -> {pos, t} for speed estimation
  const _tgPos = new Vector3Cache();

  function makeGhostTarget(g, dt) {
    const pos = new THREE.Vector3();
    g.group.getWorldPosition(pos);
    // speed estimate from frame delta
    const prev = _prevGhostPos.get(g.id);
    let speed = 0;
    if (prev && dt > 0) speed = prev.pos.distanceTo(pos) / dt;
    _prevGhostPos.set(g.id, { pos: pos.clone() });
    return {
      id: 'ghost:' + g.id,
      kind: 'player',
      _pos: pos,
      getWorldPos(out) { return (out || new THREE.Vector3()).copy(this._pos); },
      radius: 1.6,
      isAlive() { return true; }, // players don't "die" locally; see Task 11
      label() { return 'PLAYER'; },
      speedKts() { return speed * 1.94; },
      applyDamage(amount, hitPos, source) { onHitPlayer(g.id, amount, source); },
    };
  }

  function onHitPlayer(/* id, amount, source */) { /* Task 11 */ }
```

(`Vector3Cache` is a trivial helper if you want pooled temporaries; otherwise
inline `new THREE.Vector3()`. Keep it simple — remove the cache line if unused.)

- [ ] **Step 2: Collect candidates each tick**

```javascript
  function collectTargets(dt) {
    targets.length = 0;
    const mp = window.__tinyworldMultiplayer;
    if (mp && typeof mp.flightGhosts === 'function') {
      for (const g of mp.flightGhosts()) targets.push(makeGhostTarget(g, dt));
    }
    // world-cell targets appended in Task 13
  }
```

Call `collectTargets(dt)` first in `tick`. Add `targetCount: targets.length` to
telemetry.

- [ ] **Step 3: Static gate + browser smoke**

Run: `npm run check && npm run smoke` (pass). Browser: solo, telemetry
`targetCount: 0`. Deeper check in Task 7.

- [ ] **Step 4: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: target adapter and ghost candidate collection"
```

### Task 7: Target brackets + data cards

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Pool bracket/card DOM nodes**

```javascript
  const HUD_TARGET_LIMIT = 6;
  const hudPool = [];
  function ensureHudPool() {
    if (hudPool.length || !overlayEl) return;
    for (let i = 0; i < HUD_TARGET_LIMIT; i++) {
      const bracket = document.createElement('div');
      bracket.className = 'fc-target-bracket';
      bracket.style.display = 'none';
      const card = document.createElement('div');
      card.className = 'fc-target-card';
      card.style.display = 'none';
      overlayEl.appendChild(bracket);
      overlayEl.appendChild(card);
      hudPool.push({ bracket, card });
    }
  }
```

Call `ensureHudPool()` in `onEnter` after `ensureOverlay()`.

- [ ] **Step 2: Project targets and fill brackets/cards each tick**

```javascript
  const _tpos = new THREE.Vector3();
  const _tproj = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  function updateTargetHud() {
    if (!overlayEl) return;
    camera.getWorldPosition(_camPos);
    let used = 0;
    for (const tgt of targets) {
      if (used >= HUD_TARGET_LIMIT) break;
      tgt.getWorldPos(_tpos);
      _tproj.copy(_tpos).project(camera);
      if (_tproj.z > 1) continue; // behind camera
      const sx = (_tproj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_tproj.y * 0.5 + 0.5) * innerHeight;
      const dist = _camPos.distanceTo(_tpos);
      // bracket size shrinks with distance; clamp readable bounds
      const px = Math.max(18, Math.min(160, (tgt.radius * 2 / dist) * innerHeight * 0.9));
      const slot = hudPool[used++];
      slot.bracket.style.display = 'block';
      slot.bracket.style.left = (sx - px / 2) + 'px';
      slot.bracket.style.top = (sy - px / 2) + 'px';
      slot.bracket.style.width = px + 'px';
      slot.bracket.style.height = px + 'px';
      slot.bracket.classList.toggle('locked', tgt.id === lockId);
      slot.card.style.display = 'block';
      slot.card.style.left = (sx + px / 2 + 4) + 'px';
      slot.card.style.top = (sy - px / 2) + 'px';
      const altM = Math.round(tgt._pos ? tgt._pos.y : 0);
      slot.card.textContent =
        tgt.label() + '\nDST ' + Math.round(dist) +
        '\nSPD ' + Math.round(tgt.speedKts()) + 'kt' +
        '\nALT ' + altM;
    }
    for (let i = used; i < hudPool.length; i++) {
      hudPool[i].bracket.style.display = 'none';
      hudPool[i].card.style.display = 'none';
    }
  }
  let lockId = ''; // set in Task 8
```

Call `updateTargetHud()` in `tick` after `collectTargets`/`updateReticle`.

- [ ] **Step 2b: Note on ALT units** — `tgt._pos.y` is scene-space height, not
metres. For players this is fine as a relative readout. Label it `ALT` (scene
units). Do not claim metres.

- [ ] **Step 3: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 4: Browser verify with TWO clients (real ghost)**

Start partykit: `npm run party:dev` (port 1999) and ensure the app points at it
(the app's multiplayer URL config). Open the app in two playwright contexts/tabs
in the same room. In tab A enter flight; in tab B enter flight. In tab A:

```javascript
(() => { const t = window.__flightCombat.telemetry();
  const g = window.__tinyworldMultiplayer.flightGhosts();
  return { targetCount: t.targetCount, ghostCount: g.length,
           bracketShown: document.querySelectorAll('.fc-target-bracket').length }; })();
```

Expected: `ghostCount >= 1`, `targetCount >= 1`. Inspect that at least one
`.fc-target-bracket` has `display: block` while the ghost is in front of tab A's
camera (move/orient so it is). Verify the bracket center is within a few percent
of the ghost's projected screen position computed independently:

```javascript
(() => { const g = window.__tinyworldMultiplayer.flightGhosts()[0];
  const p = new THREE.Vector3(); g.group.getWorldPosition(p); p.project(camera);
  return { sx: (p.x*0.5+0.5)*innerWidth, sy: (-p.y*0.5+0.5)*innerHeight, z: p.z }; })();
```

Compare to the bracket's `left+width/2`, `top+height/2`. Match within ~6px.

- [ ] **Step 5: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: on-screen target brackets and data cards"
```

### Task 8: Lock build-up + lock tone

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Pick the nearest-to-reticle target and build lock**

```javascript
  // ---- lock ----
  let lockAmount = 0;     // 0..1
  let lockCandidateId = '';
  const LOCK_TIME = 1.1;  // seconds on-target to full lock
  const _lpos = new THREE.Vector3();
  const _lproj = new THREE.Vector3();
  function updateLock(dt) {
    // nearest target to the reticle in screen space, in front of camera
    let best = null, bestD = Infinity;
    for (const tgt of targets) {
      tgt.getWorldPos(_lpos); _lproj.copy(_lpos).project(camera);
      if (_lproj.z > 1) continue;
      const sx = (_lproj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_lproj.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - reticleState.x, sy - reticleState.y);
      if (d < bestD && d < 120) { bestD = d; best = tgt; }
    }
    if (best && best.id === lockCandidateId) {
      lockAmount = Math.min(1, lockAmount + dt / LOCK_TIME);
    } else {
      lockCandidateId = best ? best.id : '';
      lockAmount = best ? Math.max(0, lockAmount - dt / LOCK_TIME) : 0;
    }
    lockId = lockAmount >= 1 ? lockCandidateId : '';
    updateLockTone(lockAmount, !!best);
  }
```

Call `updateLock(dt)` in `tick` before `updateTargetHud()`. Add
`target_lock: lockAmount`, `target_lock_label`, `target_lock_distance` to
telemetry (compute label/dist from the locked target).

- [ ] **Step 2: Add a WebAudio lock tone (graceful if unavailable)**

```javascript
  let _audioCtx = null, _toneOsc = null, _toneGain = null;
  function updateLockTone(amount, hasCandidate) {
    if (!hasCandidate || amount <= 0.02) { stopLockTone(); return; }
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!_toneOsc) {
        _toneOsc = _audioCtx.createOscillator();
        _toneGain = _audioCtx.createGain();
        _toneOsc.type = 'square';
        _toneGain.gain.value = 0.0;
        _toneOsc.connect(_toneGain).connect(_audioCtx.destination);
        _toneOsc.start();
      }
      // pitch climbs with lock; steady tone at full lock
      _toneOsc.frequency.value = 420 + amount * 520;
      _toneGain.gain.value = amount >= 1 ? 0.05 : 0.02;
    } catch (_) { /* no audio: silent */ }
  }
  function stopLockTone() {
    if (_toneGain) { try { _toneGain.gain.value = 0; } catch (_) {} }
  }
```

Call `stopLockTone()` in `onExit`.

- [ ] **Step 3: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 4: Browser verify lock builds**

Two clients (as Task 7). In tab A, orient so the ghost sits under the reticle.
Sample telemetry across ~1.5s:

```javascript
() => window.__flightCombat.telemetry().target_lock
```

Expected: `target_lock` climbs from ~0 toward 1.0 while on-target, and one
`.fc-target-bracket` gains the `locked` class when it reaches 1. Move the
reticle off the ghost: `target_lock` decays back toward 0.

- [ ] **Step 5: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: reticle-proximity lock build-up and tone"
```

---

## Phase 3 — Gun damage on players + combat.hit messaging + death/reset

### Task 9: Hitscan against the target adapter + hit FX

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Implement `attemptInstantHit` against `targets`**

Replace the Task-3 stub:

```javascript
  const _hitToTarget = new THREE.Vector3();
  const _hitNearest = new THREE.Vector3();
  const _hitPos = new THREE.Vector3();
  const GUN_DAMAGE = 8;
  function attemptInstantHit(origin, dir) {
    let best = null, bestAlong = Infinity;
    for (const tgt of targets) {
      if (!tgt.isAlive()) continue;
      tgt.getWorldPos(_hitToTarget); _hitToTarget.sub(origin);
      const along = _hitToTarget.dot(dir);
      if (along < 0 || along > 400) continue;
      _hitNearest.copy(dir).multiplyScalar(along).add(origin);
      tgt.getWorldPos(_hitPos);
      const miss = _hitNearest.distanceTo(_hitPos);
      // aim magnet: locked target is more forgiving
      const magnet = (tgt.id === lockId ? 1.4 : 0.4) + lockAmount * 1.2;
      if (miss > tgt.radius + magnet) continue;
      if (along < bestAlong) { bestAlong = along; best = tgt; }
    }
    if (best) {
      best.getWorldPos(_hitPos);
      best.applyDamage(GUN_DAMAGE, _hitPos, 'gun');
      spawnHitSparks(_hitPos);
    }
  }
```

- [ ] **Step 2: Add a lightweight hit-spark burst**

Use the reusable emitter found in Task 3 Step 1 if available; otherwise a tiny
pooled additive-sprite burst in 41. Keep it short-lived (~0.25s). Provide a
real implementation, not a placeholder — if using your own pool, mirror the
tracer pool structure.

- [ ] **Step 3: Static gate + browser**

Run: `npm run check && npm run smoke` (pass). Two-client browser check is folded
into Task 11 (it needs the messaging round-trip).

- [ ] **Step 4: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: hitscan against target adapter with hit sparks"
```

### Task 10: Local flight-health + HUD readout

**Files:**
- Modify: `engine/world/41-flight-combat.js`
- Modify: `tiny-world-builder.html` (one HUD line)

- [ ] **Step 1: Add health state seeded on enter**

```javascript
  const MAX_HEALTH = 100;
  let health = MAX_HEALTH;
  // in onEnter: health = MAX_HEALTH;
```

- [ ] **Step 2: Add a health readout element**

In `ensureOverlay`, append:

```javascript
    healthEl = document.createElement('div');
    healthEl.id = 'flight-combat-health';
    healthEl.style.cssText = 'position:absolute;left:14px;bottom:64px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#9ff;background:rgba(8,14,25,0.6);padding:3px 8px;border:1px solid #1f2a44;border-radius:4px;';
    overlayEl.appendChild(healthEl);
```

Declare `let healthEl = null;`. Update it in `tick`:

```javascript
    if (healthEl) healthEl.textContent = 'HULL ' + Math.max(0, Math.round(health)) + '%';
```

Add `health` to telemetry.

- [ ] **Step 3: Static gate + browser**

Run: `npm run check && npm run smoke` (pass). Browser: enter flight, telemetry
`health: 100`, HUD shows `HULL 100%`.

- [ ] **Step 4: Prepare commit**

```bash
git add engine/world/41-flight-combat.js tiny-world-builder.html
git commit -m "flight-combat: local flight-health state and HUD readout"
```

### Task 11: combat.hit messaging + target-owned death/re-launch

**Files:**
- Modify: `engine/world/41-flight-combat.js`
- Modify: `engine/world/38-multiplayer-partykit.js` (inbound message routing)

- [ ] **Step 1: Send a hit message when hitting a player**

Implement `onHitPlayer` (stub from Task 6):

```javascript
  function onHitPlayer(peerId, amount, source) {
    const mp = window.__tinyworldMultiplayer;
    if (mp && typeof mp.send === 'function') {
      mp.send({ type: 'combat.hit', to: peerId, damage: amount, source: source || 'gun' });
    }
  }
```

- [ ] **Step 2: Route inbound combat.hit in module 38**

Find the inbound message handler (where `cell.set`, `chat`, `env`, `entity`
message types are dispatched — search `msg.type ===` in
`38-multiplayer-partykit.js`). Add a branch:

```javascript
      if (msg.type === 'combat.hit') {
        // Only the targeted client applies damage to its own plane.
        if (msg.to && msg.to === localClientId &&
            window.__flightCombat && typeof window.__flightCombat.onIncomingHit === 'function') {
          window.__flightCombat.onIncomingHit(msg);
        }
        return;
      }
```

Confirm `localClientId` is the right self-id variable in that file (it is used in
`sendCellSnapshot`). Match the existing dispatch style (some handlers key off
`data`/`msg`).

- [ ] **Step 3: Apply incoming damage + death/re-launch in 41**

```javascript
  function onIncomingHit(msg) {
    if (!active) return;
    health -= Number(msg.damage) || 0;
    // hit feedback on self
    if (jet) { const p = new THREE.Vector3(); jet.getWorldPosition(p); spawnHitSparks(p); }
    if (health <= 0) {
      health = 0;
      doDeathAndRelaunch();
    }
  }

  function doDeathAndRelaunch() {
    // local destruction FX at the plane, then re-launch at spawn (stay in flight)
    if (jet) { const p = new THREE.Vector3(); jet.getWorldPosition(p); spawnExplosionFX(p); }
    health = MAX_HEALTH;
    if (typeof window.__flightRelaunch === 'function') window.__flightRelaunch();
  }
  window.__flightCombat.onIncomingHit = onIncomingHit; // ensure exported
```

Make sure `onIncomingHit` is on the published object (add to the
`window.__flightCombat = {...}` literal).

- [ ] **Step 4: Add `window.__flightRelaunch` to file 34**

In `engine/world/34-flight-sim.js`, expose a re-launch that resets the sim plane
to its spawn state without exiting flight. Reuse the spawn block from
`enterFlight` (~614-631):

```javascript
  window.__flightRelaunch = function () {
    if (!flightActive) return;
    const launchSimY = (FLIGHT_SCENE_GEAR_CLEARANCE + FLIGHT_SCENE_LAUNCH_CLEARANCE) / FLIGHT_SIM_TO_SCENE;
    flightPlane.pos.set(0, launchSimY, 0);
    flightPlane.vel.set(0, 0, -34);
    flightPlane.angVel.set(0, 0, 0);
    flightPlane.quat.identity();
    flightPlane.throttle = flightPlane.throttleTarget = 0.6;
    flightPlane.onGround = false;
    flightImpactCooldown = 0;
    _flCamInit = false;
    flightSetHudStatus('FLYING');
  };
```

- [ ] **Step 5: Add `spawnExplosionFX` (reuse emitter or own pool)**

Provide a real explosion burst (bigger than hit sparks). Reuse the particle
emitter from Task 3 Step 1 if available; otherwise extend the local pool.

- [ ] **Step 6: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 7: Browser verify the full PvP round-trip (two clients)**

Two clients in one room, both in flight, ghost in front of tab A's reticle.
- In tab A, fire (hold Space) until lock + several hits land.
- In tab B (the target), sample telemetry over time:

```javascript
() => window.__flightCombat.telemetry().health
```

Expected: tab B's `health` decreases as tab A fires; tab A's own health is
unchanged. When tab B's health hits 0, it shows explosion FX, `health` resets to
100, and the plane is re-launched (position jumps to spawn, still in flight; tab
B did NOT drop to the editor). Confirm tab A never applied damage to itself
(its `health` stays 100).

- [ ] **Step 8: Prepare commit**

```bash
git add engine/world/41-flight-combat.js engine/world/38-multiplayer-partykit.js engine/world/34-flight-sim.js
git commit -m "flight-combat: combat.hit messaging, target-owned death and re-launch"
```

---

## Phase 4 — Guided missiles

### Task 12: Missile pool, fire, guidance, proximity damage

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Build a missile pool**

```javascript
  // ---- missiles ----
  const MISSILE_COUNT = 6;
  let missilesAmmo = MISSILE_COUNT;
  let missileGroup = null;
  const missiles = [];
  let missileCooldown = 0;
  let missileSide = -1;
  const MISSILE_SPEED = 70, MISSILE_LIFE = 5.5, MISSILE_TURN = 2.4;
  function ensureMissilePool() {
    if (missileGroup) return;
    missileGroup = new THREE.Group();
    missileGroup.name = 'tw_flight_missiles';
    scene.add(missileGroup);
    const body = new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8);
    const nose = new THREE.ConeGeometry(0.05, 0.14, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.5, metalness: 0.3 });
    for (let i = 0; i < MISSILE_COUNT; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(body, mat.clone()); b.rotation.x = Math.PI / 2;
      const n = new THREE.Mesh(nose, mat.clone()); n.rotation.x = -Math.PI / 2; n.position.z = -0.3;
      g.add(b, n); g.visible = false; g.raycast = () => {};
      missileGroup.add(g);
      missiles.push({ mesh: g, vel: new THREE.Vector3(), pos: new THREE.Vector3(),
        targetId: '', life: 0, active: false });
    }
  }
```

Call `ensureMissilePool()` in `onEnter`; reset `missilesAmmo = MISSILE_COUNT;`.

- [ ] **Step 2: Fire a missile (X key), alternating rails, guided or dumb**

```javascript
  const _mForward = new THREE.Vector3();
  const _mLocalL = new THREE.Vector3(); // set in onEnter from bbox
  const _mLocalR = new THREE.Vector3();
  function fireMissile() {
    if (missileCooldown > 0 || missilesAmmo <= 0 || !jet) return;
    const m = missiles.find(s => !s.active);
    if (!m) return;
    const side = missileSide > 0 ? 1 : -1; missileSide = -side;
    missilesAmmo--; missileCooldown = 0.7;
    const dir = window.__flightSceneForward(_mForward);
    const local = side < 0 ? _mLocalL : _mLocalR;
    m.pos.copy(local); jet.localToWorld(m.pos);
    m.vel.copy(dir).multiplyScalar(MISSILE_SPEED);
    m.targetId = (lockAmount > 0.3 && lockId) ? lockId : '';
    m.life = MISSILE_LIFE; m.active = true;
    m.mesh.visible = true; m.mesh.position.copy(m.pos);
    spawnHitSparks(m.pos); // launch puff
  }
```

Set `_mLocalL/_mLocalR` in `onEnter` from bbox (under-wing, slightly below
guns): e.g. `_mLocalL.set(-halfSpan*0.8, dropY-0.1, noseZ*0.4)` and mirrored.

Add to `tick` (missile input): read `window.__flightKeys['KeyX']` with an
edge-trigger (don't auto-repeat every frame):

```javascript
    const xDown = !!(window.__flightKeys && window.__flightKeys['KeyX']);
    if (xDown && !_xPrev) fireMissile();
    _xPrev = xDown;
    missileCooldown = Math.max(0, missileCooldown - dt);
    updateMissiles(dt);
```

Declare `let _xPrev = false;`. (`KeyX` is already in file 34's
`FLIGHT_KEYCODES`.)

- [ ] **Step 3: Guidance + proximity detonation**

```javascript
  const _mToTarget = new THREE.Vector3();
  const _mDesired = new THREE.Vector3();
  const _mTgtPos = new THREE.Vector3();
  const _mq = new THREE.Quaternion();
  function findTargetById(id) { return targets.find(t => t.id === id) || null; }
  function updateMissiles(dt) {
    for (const m of missiles) {
      if (!m.active) continue;
      m.life -= dt;
      const tgt = m.targetId ? findTargetById(m.targetId) : null;
      if (tgt) {
        tgt.getWorldPos(_mTgtPos);
        _mToTarget.copy(_mTgtPos).sub(m.pos).normalize();
        _mDesired.copy(m.vel).normalize();
        // steer velocity toward target, limited turn rate
        const maxStep = MISSILE_TURN * dt;
        _mDesired.lerp(_mToTarget, Math.min(1, maxStep)).normalize();
        m.vel.copy(_mDesired).multiplyScalar(MISSILE_SPEED);
        // proximity detonation
        if (m.pos.distanceTo(_mTgtPos) < (tgt.radius + 0.8)) {
          tgt.applyDamage(40, _mTgtPos.clone(), 'missile');
          spawnExplosionFX(_mTgtPos);
          deactivateMissile(m); continue;
        }
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.copy(_mq.setFromUnitVectors(_projForward, _mDesired.copy(m.vel).normalize()));
      spawnMissileTrail(m.pos); // small smoke puff, throttled
      if (m.life <= 0) deactivateMissile(m);
    }
  }
  function deactivateMissile(m) { m.active = false; m.mesh.visible = false; m.targetId = ''; }
```

Implement `spawnMissileTrail` as a throttled small smoke puff (reuse emitter or
local pool). Add `missilesAmmo` to telemetry.

- [ ] **Step 4: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 5: Browser verify dumb-fire and guided**

Solo: enter flight, press X (dispatch KeyX keydown while flightActive). Telemetry
`missilesAmmo` decrements; a missile mesh appears and travels forward along
`fireDir` (sample its world position across frames; displacement dot fireDir > 0).
Two clients with a lock: fire X at a locked ghost; the missile curves toward the
ghost (its velocity direction's dot with to-target increases over time) and on
proximity the target client's `health` drops by ~40 and FX play.

- [ ] **Step 6: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: guided missiles with proximity detonation"
```

---

## Phase 5 — Destructible scenery (persistent)

### Task 13: World-cell target provider (raycast to cell) + per-cell health

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Build a raycaster-based cell hit resolver**

World cells are static; rather than adding every nearby cell to the per-frame
`targets` list (expensive), resolve scenery hits on-demand inside
`attemptInstantHit` and `updateMissiles` using a `THREE.Raycaster` against nearby
object meshes. Add:

```javascript
  // ---- destructible scenery ----
  const _ray = new THREE.Raycaster();
  _ray.far = 400;
  const cellHealth = new Map(); // 'x,z' -> remaining hp
  function objectMeshCandidates(origin) {
    // Collect nearby rendered object meshes from cellMeshes. cellMeshes is the
    // global map 'x,z' -> { object, x, z, tile } used by the flight collision
    // scan in file 34. Filter to visible object groups near the origin.
    const out = [];
    if (typeof cellMeshes === 'undefined') return out;
    for (const key in cellMeshes) {
      const entry = cellMeshes[key];
      if (!entry || !entry.object || !entry.object.visible) continue;
      // cheap distance gate using object world position
      out.push(entry);
    }
    return out;
  }
```

Note: confirm `cellMeshes` is reachable as a global from 41 (file 34 uses it
ambiently). If it is NOT in 41's scope, expose a resolver from file 34 instead:
`window.__flightResolveCellHit(origin, dir) -> { x, z, point } | null`. Decide
based on whether `cellMeshes` is global; prefer the file-34 resolver if unsure,
since file 34 already has the collision-candidate machinery.

- [ ] **Step 2: Add a scenery hit test used by guns + missiles**

```javascript
  const _rayDir = new THREE.Vector3();
  function attemptSceneryHit(origin, dir, damage) {
    if (typeof getWorldCell !== 'function' || typeof setCell !== 'function') return false;
    _ray.set(origin, _rayDir.copy(dir).normalize());
    const cands = objectMeshCandidates(origin);
    let nearest = null, nearestDist = Infinity, nearestEntry = null;
    for (const entry of cands) {
      const hits = _ray.intersectObject(entry.object, true);
      if (hits.length && hits[0].distance < nearestDist) {
        nearestDist = hits[0].distance; nearest = hits[0]; nearestEntry = entry;
      }
    }
    if (!nearest || nearestDist > 400) return false;
    damageCell(nearestEntry.x, nearestEntry.z, damage, nearest.point);
    return true;
  }
```

- [ ] **Step 3: Per-cell health seeded from object size**

```javascript
  const _cellBox = new THREE.Box3();
  function cellMaxHealth(entry) {
    _cellBox.setFromObject(entry.object);
    const s = new THREE.Vector3(); _cellBox.getSize(s);
    const vol = Math.max(0.2, s.x * s.y * s.z);
    return Math.min(120, 12 + vol * 18); // small props pop fast, big builds tank
  }
  function damageCell(x, z, damage, hitPoint) {
    const key = x + ',' + z;
    let hp = cellHealth.has(key) ? cellHealth.get(key) : null;
    if (hp == null) {
      const entry = (typeof cellMeshes !== 'undefined') ? cellMeshes[key] : null;
      hp = entry ? cellMaxHealth(entry) : 20;
    }
    hp -= damage;
    spawnHitSparks(hitPoint);
    if (hp <= 0) { cellHealth.delete(key); destroyCell(x, z, hitPoint); }
    else cellHealth.set(key, hp);
  }
```

- [ ] **Step 4: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 5: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: scenery raycast hit resolver and per-cell health"
```

### Task 14: Persistent cell destruction with role gate

**Files:**
- Modify: `engine/world/41-flight-combat.js`

- [ ] **Step 1: Destroy a cell via setCell, gated by canEdit**

```javascript
  function destroyCell(x, z, hitPoint) {
    const cell = (typeof getWorldCell === 'function') ? getWorldCell(x, z) : null;
    if (!cell || !cell.kind) return; // only object kinds; never carve terrain
    const mp = window.__tinyworldMultiplayer;
    const allowed = !mp || typeof mp.canEdit !== 'function' || mp.canEdit(x, z);
    if (!allowed) {
      // role-blocked (viewer/player, or outside editor island): show a cue, no damage
      spawnHitSparks(hitPoint);
      return;
    }
    spawnExplosionFX(hitPoint);
    // Clear the object, preserve terrain. Mirrors the erase path in
    // 20-input-place-erase.js. setCell broadcasts (sendCellSnapshot), persists,
    // and pushes undo history for free.
    setCell(x, z, {
      terrain: cell.terrain,
      terrainFloors: (typeof terrainLevelForCell === 'function') ? terrainLevelForCell(cell) : undefined,
      kind: null,
      floors: 1,
    });
  }
```

- [ ] **Step 2: Wire scenery hits into guns and missiles**

In `attemptInstantHit`, after the player-target loop, if no player was hit, try
scenery: `if (!best) attemptSceneryHit(origin, dir, GUN_DAMAGE);` (only when no
player target intercepted the shot). In `updateMissiles`, when a missile has no
locked target (dumb-fire) or its target is gone, raycast a short segment ahead
each frame for scenery proximity, and on hit call `attemptSceneryHit` /
`damageCell` then detonate. Keep it simple: for missiles, test
`attemptSceneryHit(m.pos, m.vel.normalized, 60)` each tick and detonate on a
true return.

- [ ] **Step 3: Static gate**

Run: `npm run check && npm run smoke`
Expected: pass.

- [ ] **Step 4: Browser verify persistent destruction + role gate + sync**

Solo (editor role / un-upgraded server):
- Build a few objects (houses/trees) in the world via the normal tools.
- Enter flight, fly at one and fire. After enough hits, evaluate before/after:

```javascript
(() => { const c = getWorldCell(X, Z); return c && c.kind; })() // X,Z = the object cell
```

Expected: `kind` becomes `null` (object gone), terrain preserved (`c.terrain`
unchanged). Confirm it persists: trigger the app's save/reload path (or check
the persistence layer wrote it) and the object stays gone. Confirm undo
(`Ctrl+Z` / the app's undo) restores it — proves it went through `setCell`'s
history.

Two clients: destroy an object in tab A; confirm it disappears in tab B
(broadcast via `cell.set`). In a viewer/player role (if a role server is
running), confirm firing at scenery does NOT destroy it (role gate) and shows
the spark cue.

- [ ] **Step 5: Prepare commit**

```bash
git add engine/world/41-flight-combat.js
git commit -m "flight-combat: persistent role-gated scenery destruction via setCell"
```

---

## Final integration verification

### Task 15: End-to-end pass + regression gates

- [ ] **Step 1: Full static + unit gate**

Run: `npm run check && npm run smoke && node --test tests/*.test.mjs`
Expected: all pass.

- [ ] **Step 2: Solo end-to-end**

`npm run dev`, enter flight on a stunt plane:
- Guns fire (Space + left mouse), tracers visible, reticle tracks and lags.
- Fly into built objects and shoot them — they take hits and are destroyed
  persistently; terrain remains.
- Missiles fire on X, dumb-fire travels straight, ammo decrements, refills only
  on re-enter (no mid-flight refill — confirms economy was cut as specced).
- Exit flight (Esc): overlay hides, no console errors, editor camera restored.

- [ ] **Step 3: Two-client end-to-end**

- Both fly; brackets/cards show the other player with type/dist/speed/alt.
- Lock builds under the reticle; tone climbs; bracket shows `locked`.
- Guns + a guided missile reduce the target client's hull; at 0 the target
  client explodes and re-launches at spawn (stays in flight). Shooter's own
  hull never changes from its own fire.
- Scenery destroyed by one client disappears for the other.

- [ ] **Step 4: Confirm physics untouched**

`git diff` on `engine/world/34-flight-sim.js`: the only changes are the 3 hook
calls, `__flightSceneForward`, `__flightRelaunch`, `__flightKeys`/`__flightFireHeld`
exposure, and `Space` added to `FLIGHT_KEYCODES`. No edits inside
`updateFlightPhysics`. This is the spec's core invariant.

- [ ] **Step 5: Prepare final commit (if any cleanup)**

```bash
git add -A
git commit -m "flight-combat: end-to-end verification and cleanup"
```

---

## Spec coverage check (self-review)

- Guns (hitscan + tracers + muzzle flash + cooldown): Tasks 3, 9. Covered.
- Targeting HUD (reticle, brackets, cards type/dist/speed/alt, lock, tone): Tasks 4, 7, 8. Covered.
- Missiles (alternating rails, guided/dumb, proximity, trail): Task 12. Covered.
- Target adapter abstraction: Task 6. Covered.
- MP ghost targeting + flightGhosts() getter: Tasks 5, 6, 7. Covered.
- Player hits via combat.hit + target-owned death + re-launch at spawn: Tasks 10, 11. Covered.
- Persistent scenery destruction via setCell + role gate + sync + undo: Tasks 13, 14. Covered.
- Cuts (no ammo economy/heat/flares/countermeasures/alien): honored — guns
  unlimited-cooldown, missiles finite no-refill, none of the cut systems built.
- Scene-space combat, physics untouched: Task 1 (hooks only) + Task 15 Step 4
  (diff invariant). Covered.
- Bug traps: muzzle from bbox (Task 3 Step 4), fwd-fix back-out
  (Task 2 + `__flightSceneForward`), 3D-math verification (every browser step).
  Covered.
