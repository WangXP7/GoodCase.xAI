// Input (owner: player agent). API: docs/ARCHITECTURE.md, player/controls.js.
//
// - WASD + arrow keys: world-aligned (W / Up = -Z = north = up the screen). Keys always win and clear
//   the click target.
// - Click / tap / drag to walk: the pointer is raycast onto the page plane (y = 0); the traveller steers
//   to that point, feeling its way round obstacles, eases in, and stops on arrival, when it has been
//   stuck for ~0.6 s, or when it has made no progress for ~1 s. Holding and dragging keeps re-aiming.
// - The only feedback is a small inked mark printed on the page at the target that fades away
//   (an in-world flat mesh, not UI).
// - Emits 'input:first' once (inside the first user gesture) and 'input:target' per click / drag move.
// - Touch: pointer events with touch-action none; context menu, text selection, callouts and
//   drag ghosts are suppressed on the canvas.
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { bus } from '../core/events.js';
import { state } from '../core/state.js';
import { mulberry32 } from '../core/rng.js';
// integration: V8's Math.hypot allocates (rest-argument array) on every call; this 2-argument form is allocation-free.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

const KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
// steering offsets (radians) tried in order when the straight line to the target is blocked
const STEER = [0.6, 1.2, 1.75];

/** A hand-inked dashed ring with a small cross: one flat mesh lying on the page. */
function buildMarkerGeometry(radius) {
  const rng = mulberry32(0x1a7e5);
  const pos = [];
  const quad = (ax, az, bx, bz, w0, w1) => {
    // a stroke from a to b with slightly different widths at each end
    const dx = bx - ax;
    const dz = bz - az;
    const l = hypot2(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    pos.push(
      ax + nx * w0, 0, az + nz * w0, bx + nx * w1, 0, bz + nz * w1, bx - nx * w1, 0, bz - nz * w1,
      ax + nx * w0, 0, az + nz * w0, bx - nx * w1, 0, bz - nz * w1, ax - nx * w0, 0, az - nz * w0,
    );
  };
  const dashes = 9;
  const stroke = radius * 0.085;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    const span = (Math.PI * 2 / dashes) * (0.5 + rng() * 0.16);
    const r0 = radius * (0.96 + rng() * 0.08);
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const u0 = a0 + (span * s) / segs;
      const u1 = a0 + (span * (s + 1)) / segs;
      const ra = r0 * (1 + (rng() - 0.5) * 0.03);
      const rb = r0 * (1 + (rng() - 0.5) * 0.03);
      quad(Math.cos(u0) * ra, Math.sin(u0) * ra, Math.cos(u1) * rb, Math.sin(u1) * rb, stroke * (0.75 + rng() * 0.5), stroke * (0.75 + rng() * 0.5));
    }
  }
  const c = radius * 0.2;
  quad(-c, -c * 0.9, c, c * 1.05, stroke * 0.9, stroke * 0.7);
  quad(-c * 0.95, c, c * 1.05, -c * 0.9, stroke * 0.8, stroke * 0.95);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

export function createControls({ domElement, camera, traveller }) {
  const C = CONFIG.player;
  const down = new Set();
  const out = { x: 0, z: 0 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const canStand = typeof traveller.canStand === 'function' ? traveller.canStand : () => true;
  // physics pass: room for the traveller's body (he cannot enter points tighter than his radius)
  const canPass = typeof traveller.canPass === 'function' ? traveller.canPass : canStand;

  // ---- route finding (grid A* around the traveller; only used when the straight line is blocked) ---------------
  const RS = C.routeCell ?? 0.15; // cell size (world units)
  const RN = Math.max(16, Math.round((C.routeSpan ?? 12) / RS) | 1); // cells across
  const RNN = RN * RN;
  const rOpen = new Int8Array(RNN); // -1 unknown, 0 blocked, 1 open
  const rG = new Float32Array(RNN);
  const rFrom = new Int32Array(RNN);
  const rState = new Uint8Array(RNN); // 0 new, 1 queued, 2 done
  const rHeap = new Int32Array(RNN * 4);
  const rHeapF = new Float32Array(RNN * 4);
  let rHeapN = 0;
  let rX0 = 0; let rZ0 = 0;
  const route = []; // waypoints [x0, z0, x1, z1, ...] from the traveller to the target
  let routeI = 0; // index of the waypoint being walked to
  let routeFor = null; // target the route was planned for {x, z}
  let routeFail = 0; // state.time until which no new plan is tried
  const NBX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NBZ = [0, 0, 1, -1, 1, -1, 1, -1];

  function rPush(i, f) {
    let k = rHeapN++;
    while (k > 0) { const pa = (k - 1) >> 1; if (rHeapF[pa] <= f) break; rHeap[k] = rHeap[pa]; rHeapF[k] = rHeapF[pa]; k = pa; }
    rHeap[k] = i; rHeapF[k] = f;
  }
  function rPop() {
    const top = rHeap[0];
    const i = rHeap[--rHeapN]; const f = rHeapF[rHeapN];
    let k = 0;
    for (;;) {
      let c = k * 2 + 1;
      if (c >= rHeapN) break;
      if (c + 1 < rHeapN && rHeapF[c + 1] < rHeapF[c]) c++;
      if (rHeapF[c] >= f) break;
      rHeap[k] = rHeap[c]; rHeapF[k] = rHeapF[c]; k = c;
    }
    rHeap[k] = i; rHeapF[k] = f;
    return top;
  }
  function rIsOpen(i) {
    let o = rOpen[i];
    if (o < 0) { o = canPass(rX0 + (i % RN) * RS, rZ0 + ((i / RN) | 0) * RS) ? 1 : 0; rOpen[i] = o; }
    return o === 1;
  }
  /** Straight segment passable for the body? (sampled every 0.06) */
  function segClear(ax, az, bx, bz) {
    const d = hypot2(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.06));
    for (let i = 1; i <= n; i++) { const k = i / n; if (!canPass(ax + (bx - ax) * k, az + (bz - az) * k)) return false; }
    return true;
  }

  /** Plans a route from the traveller to (tx,tz). Fills `route`; false when there is none inside the window. */
  function planRoute(px, pz, tx, tz) {
    route.length = 0; routeI = 0;
    rX0 = (px + tx) / 2 - ((RN - 1) / 2) * RS;
    rZ0 = (pz + tz) / 2 - ((RN - 1) / 2) * RS;
    const sx = Math.round((px - rX0) / RS); const sz = Math.round((pz - rZ0) / RS);
    const gx = Math.round((tx - rX0) / RS); const gz = Math.round((tz - rZ0) / RS);
    if (sx < 0 || sz < 0 || sx >= RN || sz >= RN || gx < 0 || gz < 0 || gx >= RN || gz >= RN) return false;
    rOpen.fill(-1); rState.fill(0); rHeapN = 0;
    const start = sz * RN + sx;
    let goal = gz * RN + gx;
    rOpen[start] = 1; // wherever he stands, he can leave
    if (!rIsOpen(goal)) { // target in a tight spot: aim for the nearest passable cell (within 3 cells)
      let best = -1; let bd = 1e9;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = gx + dx; const z = gz + dz;
        if (x < 0 || z < 0 || x >= RN || z >= RN) continue;
        const d = dx * dx + dz * dz;
        if (d < bd && rIsOpen(z * RN + x)) { bd = d; best = z * RN + x; }
      }
      if (best < 0) return false;
      goal = best;
    }
    const ggx = goal % RN; const ggz = (goal / RN) | 0;
    rG[start] = 0; rFrom[start] = -1; rState[start] = 1;
    rPush(start, hypot2(sx - ggx, sz - ggz));
    let found = false;
    let near = start; let nearH = hypot2(sx - ggx, sz - ggz); const startH = nearH;
    while (rHeapN > 0) {
      const i = rPop();
      if (rState[i] === 2) continue;
      rState[i] = 2;
      if (i === goal) { found = true; break; }
      const x = i % RN; const z = (i / RN) | 0;
      const h = hypot2(x - ggx, z - ggz);
      if (h < nearH) { nearH = h; near = i; }
      for (let k = 0; k < 8; k++) {
        const nx = x + NBX[k]; const nz = z + NBZ[k];
        if (nx < 0 || nz < 0 || nx >= RN || nz >= RN) continue;
        const j = nz * RN + nx;
        if (rState[j] === 2 || !rIsOpen(j)) continue;
        if (k >= 4 && (!rIsOpen(z * RN + nx) || !rIsOpen(nz * RN + x))) continue; // no corner cutting
        const g = rG[i] + (k >= 4 ? 1.4142 : 1);
        if (rState[j] === 1 && g >= rG[j]) continue;
        rG[j] = g; rFrom[j] = i; rState[j] = 1;
        rPush(j, g + hypot2(nx - ggx, nz - ggz));
      }
    }
    if (!found) {
      // no way there (across a river, inside a ring of props): walk as close as the ground allows, if that is a real gain
      if (startH - nearH < 3) return false;
      goal = near;
    }
    // cells start -> goal, then string-pulled into a few straight legs
    const cells = [];
    for (let i = goal; i >= 0; i = rFrom[i]) cells.push(i);
    cells.reverse();
    const wx = (i) => rX0 + (i % RN) * RS;
    const wz = (i) => rZ0 + ((i / RN) | 0) * RS;
    let ax = px; let az = pz; let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !segClear(ax, az, wx(cells[b]), wz(cells[b]))) b--;
      ax = wx(cells[b]); az = wz(cells[b]);
      route.push(ax, az);
      a = b;
    }
    if (goal === gz * RN + gx && canStand(tx, tz) && segClear(ax, az, tx, tz)) route.push(tx, tz);
    return route.length > 0;
  }
  let target = null;
  let activePointer = null; // pointerId of the finger / button that is steering
  let first = false;
  // progress tracking for the click target
  let stuckT = 0;
  let noProgressT = 0;
  let bestDist = Infinity;
  let side = 0; // which way round an obstacle we are going (-1 / 0 / +1)
  let sideHold = 0;
  let lastEmitX = 0;
  let lastEmitZ = 0;
  let lastPollTime = -1; // state.time of the last getInput (the marker hides when nobody polls us)

  // ---- target mark (in-world ink on the page) ---------------------------------------------------
  const pal = CONFIG.palette || {};
  const markMat = new THREE.MeshBasicMaterial({
    color: pal.ink || pal.brown || '#5A3A28', transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  });
  const mark = new THREE.Mesh(buildMarkerGeometry(C.markerSize), markMat);
  mark.name = 'target-mark';
  mark.visible = false;
  mark.renderOrder = 5;
  mark.matrixAutoUpdate = true;
  let markShown = -1; // state.time when it was stamped
  let markHidden = -1; // state.time when it started to fade (-1 = still wanted)
  mark.onBeforeRender = () => {
    const t = state.time;
    let o = Math.min(1, Math.max(0, (t - markShown) / 0.1));
    if (markHidden >= 0) o *= Math.max(0, 1 - (t - markHidden) / Math.max(0.01, C.markerFade));
    if (lastPollTime >= 0 && t - lastPollTime > 0.5) o = 0; // controls are not being used (autopilot)
    markMat.opacity = o * C.markerOpacity;
    if (o <= 0 && (markHidden >= 0 || t - lastPollTime > 0.5) && t > markShown + 0.1) mark.visible = false;
  };
  const sceneRoot = traveller.group && traveller.group.parent;
  if (sceneRoot) sceneRoot.add(mark);

  function stampMark(x, z) {
    const y = typeof traveller.groundAt === 'function' ? traveller.groundAt(x, z) : 0;
    mark.position.set(x, y + 0.012, z);
    mark.rotation.y = ((x * 12.9898 + z * 78.233) % 1) * Math.PI; // each stamp sits at its own angle
    if (!mark.visible || markHidden >= 0) markShown = state.time;
    markHidden = -1;
    markMat.opacity = 0;
    mark.visible = true;
  }
  function fadeMark() {
    if (mark.visible && markHidden < 0) markHidden = state.time;
  }

  function firstInput() {
    if (first) return;
    first = true;
    bus.emit('input:first', {});
  }

  function dropTarget() {
    target = null;
    side = 0;
    route.length = 0; routeFor = null;
    fadeMark();
  }

  function setTarget(x, z, isDrag) {
    // a click on water / inside a blocker walks to the nearest standable point on the way there
    if (!canStand(x, z)) {
      const px = traveller.position.x;
      const pz = traveller.position.z;
      const d = hypot2(px - x, pz - z);
      const n = Math.min(60, Math.floor(d / 0.08));
      for (let i = 1; i <= n; i++) {
        const k = (i * 0.08) / d;
        const qx = x + (px - x) * k;
        const qz = z + (pz - z) * k;
        if (canStand(qx, qz)) { x = qx; z = qz; break; }
      }
    }
    if (!target) target = { x, z }; else { target.x = x; target.z = z; }
    stuckT = 0;
    noProgressT = 0;
    bestDist = Infinity;
    if (!isDrag) { side = 0; sideHold = 0; }
    if (!isDrag || (routeFor && hypot2(x - routeFor.x, z - routeFor.z) > 0.3)) { route.length = 0; routeFor = null; routeFail = 0; }
    stampMark(x, z);
    if (!isDrag || hypot2(x - lastEmitX, z - lastEmitZ) > 0.25) {
      lastEmitX = x; lastEmitZ = z;
      bus.emit('input:target', { x, z });
    }
  }

  function pick(ev, isDrag) {
    const r = domElement.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) setTarget(hit.x, hit.z, isDrag);
  }

  // Shift held = run, a lone tap of Ctrl toggles a slow stroll (only when Ctrl is pressed and released on its own,
  // so Ctrl shortcuts never flip it). Shift wins while held.
  let running = false;
  let strolling = false;
  let ctrlAlone = false;
  const applySpeed = () => { state.speedMul = running ? (CONFIG.player.runMul ?? 1.8) : strolling ? (CONFIG.player.slowMul ?? 0.6) : 1; };
  const onModDown = (e) => {
    if (e.key === 'Shift') { running = true; applySpeed(); }
    if (e.key === 'Control') { if (!e.repeat) ctrlAlone = true; } else ctrlAlone = false;
  };
  const onModUp = (e) => {
    if (e.key === 'Shift') { running = false; applySpeed(); }
    if (e.key === 'Control' && ctrlAlone) { ctrlAlone = false; strolling = !strolling; applySpeed(); }
  };
  window.addEventListener('keydown', onModDown);
  window.addEventListener('keyup', onModUp);
  const onKeyDown = (e) => {
    if (!KEYS[e.code] || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    firstInput();
    down.add(e.code);
    if (target) dropTarget();
  };
  const onKeyUp = (e) => { down.delete(e.code); };
  const onBlur = () => { down.clear(); activePointer = null; running = false; ctrlAlone = false; applySpeed(); };
  const onVisibility = () => { if (document.hidden) onBlur(); };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activePointer !== null && e.pointerId !== activePointer) return; // second finger: ignore
    firstInput();
    activePointer = e.pointerId;
    try { domElement.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
    pick(e, false);
  };
  const onPointerMove = (e) => { if (activePointer !== null && e.pointerId === activePointer) pick(e, true); };
  const onPointerUp = (e) => {
    if (activePointer === null || e.pointerId !== activePointer) return;
    activePointer = null;
    try { domElement.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const prevent = (e) => { e.preventDefault(); };

  // no long-press menu, no selection / magnifier / tap flash, no browser panning or zooming on the canvas
  const st = domElement.style;
  st.touchAction = 'none';
  st.userSelect = 'none';
  st.webkitUserSelect = 'none';
  st.webkitTouchCallout = 'none';
  st.webkitTapHighlightColor = 'transparent';
  st.outline = 'none';

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('contextmenu', prevent);
  domElement.addEventListener('selectstart', prevent);
  domElement.addEventListener('dragstart', prevent);

  /** Is the short path from the traveller along (dx,dz) clear? */
  function clear(px, pz, dx, dz, dist) {
    return canStand(px + dx * dist, pz + dz * dist) && canStand(px + dx * dist * 0.5, pz + dz * dist * 0.5);
  }

  return {
    /** Current click-to-walk target {x,z} in world space, or null. */
    get target() { return target; },
    clearTarget() { if (target) dropTarget(); },
    /** The inked target mark (THREE.Mesh on the page). */
    mark,
    /** @returns {{x:number,z:number}} desired WORLD-space move direction (length 0..1). W = -Z (north). */
    getInput(dt) {
      lastPollTime = state.time;
      let x = 0;
      let z = 0;
      for (const code of down) { x += KEYS[code][0]; z += KEYS[code][1]; }
      if (x || z) {
        const l = hypot2(x, z);
        // round 3: keys are SCREEN-relative (W = up the screen). At camera yaw 0 that is world north as before; in the yawed
        // views (low, postcard) and under the sight assist the key vector turns with the camera's right vector on the page.
        const me = camera.matrixWorld.elements; let rx = me[0]; let rz = me[2]; const rl = hypot2(rx, rz);
        if (rl > 0.5) { rx /= rl; rz /= rl; } else { rx = 1; rz = 0; }
        out.x = (x * rx - z * rz) / l; out.z = (x * rz + z * rx) / l;
        return out;
      }
      out.x = 0; out.z = 0;
      if (!target) return out;

      const px = traveller.position.x;
      const pz = traveller.position.z;
      const tx = target.x - px;
      const tz = target.z - pz;
      const d = hypot2(tx, tz);
      if (d < C.arriveRadius) { dropTarget(); return out; }

      // give up when stuck or when hugging an obstacle without getting any closer
      if (dt > 0) {
        if (traveller.speed < C.speed * 0.15) stuckT += dt; else stuckT = 0;
        if (stuckT > 0.35 && route.length > 0) route.length = 0; // a route that does not move him is re-planned
        if (d < bestDist - 0.02) { bestDist = d; noProgressT = 0; } else noProgressT += dt;
        if (stuckT >= C.targetStuckTime || noProgressT >= C.targetNoProgressTime) { dropTarget(); return out; }
      }

      // steer: straight at the target while that is clear; otherwise plan a route round the obstacle (grid A*)
      // and follow its waypoints. The old feel-your-way steering is the fallback when no route exists.
      let dx = tx / d;
      let dz = tz / d;
      let routed = false;
      if (route.length > 0) {
        // skip waypoints already reached, cut ahead when the next one is in plain sight
        while (routeI < route.length - 2 && hypot2(route[routeI] - px, route[routeI + 1] - pz) < 0.12) routeI += 2;
        while (routeI < route.length - 2 && segClear(px, pz, route[routeI + 2], route[routeI + 3])) routeI += 2;
        const wx = route[routeI] - px; const wz = route[routeI + 1] - pz;
        const wl = hypot2(wx, wz);
        if (routeI >= route.length - 2 && wl < C.arriveRadius) {
          // end of the route: if the target itself was not reachable (tight spot) this is as close as it gets
          if (hypot2(route[routeI] - target.x, route[routeI + 1] - target.z) > 1e-3) { dropTarget(); return out; }
          route.length = 0;
        } else if (wl > 1e-4) { dx = wx / wl; dz = wz / wl; routed = true; }
      }
      const probe = Math.min(C.targetProbe, d);
      if (routed) {
        // on a route
      } else if (clear(px, pz, dx, dz, probe) && (d > 1.2 || segClear(px, pz, target.x, target.z))) {
        if (side !== 0 && dt > 0) { sideHold -= dt; if (sideHold <= 0) side = 0; }
      } else if (state.time >= routeFail && planRoute(px, pz, target.x, target.z)) {
        routeFor = { x: target.x, z: target.z };
        stuckT = 0; noProgressT = 0; bestDist = Infinity;
        const wx = route[0] - px; const wz = route[1] - pz;
        const wl = hypot2(wx, wz);
        if (wl > 1e-4) { dx = wx / wl; dz = wz / wl; }
        routed = true;
      } else {
        if (state.time >= routeFail) routeFail = state.time + 0.5; // no route: do not re-plan every frame
        const base = Math.atan2(dx, dz);
        let found = false;
        for (let pass = 0; pass < 2 && !found; pass++) {
          const sgn = pass === 0 ? (side || 1) : -(side || 1);
          for (let i = 0; i < STEER.length; i++) {
            const a = base + sgn * STEER[i];
            const sx = Math.sin(a);
            const sz = Math.cos(a);
            if (clear(px, pz, sx, sz, C.targetProbe)) { dx = sx; dz = sz; side = sgn; sideHold = 0.3; found = true; break; }
          }
        }
        // nothing clear: push straight on and let the traveller slide (the stuck timer ends it)
      }
      if (routed) noProgressT = 0; // a route may lead away from the target first; the stuck timer still guards it

      // ease in so it stops on the mark instead of orbiting it
      const s = Math.max(0.14, Math.min(1, Math.sqrt(2 * C.accel * 0.5 * Math.max(0, d - C.arriveRadius * 0.5)) / C.speed));
      out.x = dx * s; out.z = dz * s;
      return out;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      domElement.removeEventListener('contextmenu', prevent);
      domElement.removeEventListener('selectstart', prevent);
      domElement.removeEventListener('dragstart', prevent);
      if (mark.parent) mark.parent.remove(mark);
      mark.geometry.dispose();
      markMat.dispose();
    },
  };
}
