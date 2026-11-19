// Touch controls. Two layers:
//  - createTouchMachine(layout, T, opts): pure gesture machine (no DOM). Fingers go in by id with
//    CSS-px positions and a time in ms; frame(dt) turns them into move, look, held and pressed.
//  - createTouch(G): G.input.touch, the machine plus the DOM binding (touch events on the game
//    surface) and the player's touch settings. input.js builds it and reads frame() once a frame.
//
// Layout, CSS px, in screen coordinates (as drawn):
//   { stick:{x,y,r}, look:{x,y,w,h}, buttons:[{name, x, y, r, mode:'hold'|'tap'|'toggle', look?}], width? }
//   stick: a finger landing in the zone becomes the stick, anchored where it lands; full deflection
//          at T.stickRadius from the anchor, and it stays full however far it slides. The zone is
//          the circle of radius r round (x,y), or the rectangle {x,y,w,h} when w and h are given.
//   look:  a finger landing in this rectangle turns the view. Only one finger looks at a time: the
//          first look-capable finger (look zone, or a button with look:true such as FIRE). When it
//          lifts, the next look-capable finger to move takes over from where it is (no jump).
//   buttons (hit before the stick and look zones):
//     hold   - held while the finger is down; pressed the frame it lands.
//     tap    - pressed the frame it lands (with look:true: pressed on release, only if it was a tap,
//              because a drag from it is looking).
//     toggle - flips on a tap (<= T.tapPx, <= T.tapMs) and is held while on. The `sprint` toggle
//              also turns off when the stick is released.
// Auto-sprint: the stick held at >= T.sprintPush forward for T.sprintHold adds `sprint` to held.
// Tap to jump: a stick finger that lifts within T.stickTapMs, never having moved T.stickTapPx from
// where it landed, adds `jump` to pressed (on release: a move never starts with a jump).
import { tuning } from '../game/tuning.js';

const NO_BUTTONS = [];

// How a weapon's trigger works, from its Def: 'auto' (fires while held), 'burst' (one burst a press)
// or 'semi' (one shot a press: pistols, revolvers, pump and other manually cycled guns, specials).
// Reads `fireMode`, then `burst` (> 0), then `auto`, then the original `semiAuto`. No def: 'semi'.
export function fireModeOf(def) {
  if (!def) return 'semi';
  if (def.fireMode === 'auto' || def.fireMode === 'semi' || def.fireMode === 'burst') return def.fireMode;
  if (def.burst > 0) return 'burst';
  if (def.auto === true) return 'auto';
  if (def.auto === undefined && def.semiAuto === false) return 'auto';
  return 'semi';
}
// The touch FIRE button as the `fire` input: held counts only for an automatic weapon; otherwise only
// the frame the finger lands (holding a pistol's FIRE is one shot, as on a real trigger).
export const touchTrigger = (mode, held, pressed) => (mode === 'auto' ? !!(held || pressed) : !!pressed);

export function mirrorLayout(layout, width) {
  if (!layout) return layout;
  const W = width ?? layout.width ?? 0;
  const out = { ...layout };
  if (layout.stick) {
    const st = layout.stick;
    out.stick = { ...st, x: st.w !== undefined ? W - st.x - st.w : W - st.x };
  }
  if (layout.look) out.look = { ...layout.look, x: W - layout.look.x - layout.look.w };
  if (layout.buttons) out.buttons = layout.buttons.map((b) => ({ ...b, x: W - b.x }));
  return out;
}

// Look drag (px since last frame) -> camera turn in radians. Drag right turns right (yaw falls,
// yaw grows to the left); drag up looks up. Speed acceleration, ADS and an aim-assist friction
// `scale`; the whole step is clamped to T.maxLookStep. Pass `out` to avoid allocating.
export function touchLook(dx, dy, dt, T = tuning.touch, opts = {}, out = { yaw: 0, pitch: 0 }) {
  const dist = Math.hypot(dx, dy);
  const speed = dt > 0 ? dist / dt : 0;
  const k = T.look * (1 + T.accel * Math.min(1, speed / T.accelSpeed))
    * (opts.sensitivity ?? 1) * (opts.scale ?? 1) * (opts.ads ? T.adsScale : 1);
  let yaw = -dx * k, pitch = -dy * k;
  const mag = Math.hypot(yaw, pitch);
  if (mag > T.maxLookStep) { yaw *= T.maxLookStep / mag; pitch *= T.maxLookStep / mag; }
  out.yaw = yaw; out.pitch = pitch;
  return out;
}

export function createTouchMachine(layout, T = tuning.touch, opts = {}) {
  let L = { buttons: NO_BUTTONS };
  const fingers = new Map(); // id -> finger record
  const pool = [];
  let stickF = null; // the stick finger
  let lookF = null; // the finger that looks
  let lookDx = 0, lookDy = 0;
  let pushT = 0;
  const holdCount = Object.create(null); // hold-mode fingers per button
  const downCount = Object.create(null); // any finger per button (for the HUD)
  const toggles = Object.create(null);
  const pending = new Set(); // pressed since the last frame
  // autoSprint / sprintToggle: where a held 'sprint' came from (input.js holds auto-sprint back
  // while firing, aiming or reloading).
  const out = { moveX: 0, moveY: 0, lookDx: 0, lookDy: 0, held: new Set(), pressed: new Set(), autoSprint: false, sprintToggle: false };
  const state = { stick: { x: 0, y: 0, active: false, cx: 0, cy: 0 }, buttons: Object.create(null) };

  function setLayout(next, o = opts) {
    opts = o || {};
    const src = next || { buttons: NO_BUTTONS };
    L = opts.lefty ? mirrorLayout(src, opts.width ?? src.width) : src;
    if (!L.buttons) L = { ...L, buttons: NO_BUTTONS };
    for (const b of L.buttons) {
      if (!(b.name in state.buttons)) state.buttons[b.name] = false;
      if (!(b.name in holdCount)) { holdCount[b.name] = 0; downCount[b.name] = 0; toggles[b.name] = false; }
    }
  }
  setLayout(layout, opts);

  function hitButton(x, y) {
    let best = null, bestD = Infinity;
    for (const b of L.buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }
  const inStick = (x, y) => {
    const st = L.stick;
    if (!st) return false;
    if (st.w !== undefined && st.h !== undefined) return x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.h;
    return Math.hypot(x - st.x, y - st.y) <= st.r;
  };
  const inLook = (x, y) => !!L.look && x >= L.look.x && x <= L.look.x + L.look.w && y >= L.look.y && y <= L.look.y + L.look.h;

  function down(id, x, y, t = 0) {
    if (fingers.has(id)) cancel(id);
    const f = pool.pop() || {};
    f.id = id; f.x0 = x; f.y0 = y; f.t0 = t; f.lx = x; f.ly = y; f.moved = 0;
    f.kind = 'none'; f.name = null; f.mode = null; f.canLook = false;
    const b = hitButton(x, y);
    if (b) {
      f.kind = 'button'; f.name = b.name; f.mode = b.mode || 'hold'; f.canLook = !!b.look;
      downCount[b.name] = (downCount[b.name] || 0) + 1;
      if (f.mode === 'hold') { holdCount[b.name] = (holdCount[b.name] || 0) + 1; pending.add(b.name); }
      else if (f.mode === 'tap' && !f.canLook) pending.add(b.name);
    } else if (!stickF && inStick(x, y)) {
      f.kind = 'stick'; stickF = f;
      state.stick.cx = x; state.stick.cy = y; state.stick.active = true;
    } else if (inLook(x, y)) {
      f.kind = 'look'; f.canLook = true;
    }
    if (f.canLook && !lookF) lookF = f;
    fingers.set(id, f);
  }

  function move(id, x, y) {
    const f = fingers.get(id);
    if (!f) return;
    f.moved = Math.max(f.moved, Math.hypot(x - f.x0, y - f.y0));
    if (f.canLook && !lookF) lookF = f; // takes over from where it is
    if (lookF === f) { lookDx += x - f.lx; lookDy += y - f.ly; }
    f.lx = x; f.ly = y;
  }

  function release(f, t, asTap) {
    if (f.kind === 'button') {
      const n = f.name;
      downCount[n] = Math.max(0, (downCount[n] || 0) - 1);
      if (f.mode === 'hold') holdCount[n] = Math.max(0, (holdCount[n] || 0) - 1);
      const tap = asTap && f.moved <= T.tapPx && t - f.t0 <= T.tapMs;
      if (tap && f.mode === 'toggle') toggles[n] = !toggles[n];
      if (tap && f.mode === 'tap' && f.canLook) pending.add(n);
    }
    if (stickF === f) {
      stickF = null; state.stick.active = false;
      if (asTap && f.moved < T.stickTapPx && t - f.t0 <= T.stickTapMs) pending.add('jump');
    }
    if (lookF === f) lookF = null;
    fingers.delete(f.id);
    pool.push(f);
  }
  function up(id, t = 0) { const f = fingers.get(id); if (f) release(f, t, true); }
  function cancel(id) { const f = fingers.get(id); if (f) release(f, 0, false); }
  function cancelAll() { for (const f of fingers.values()) release(f, 0, false); pushT = 0; }
  // Every latched toggle off (ADS, sprint), and every finger released: nothing carries over a death,
  // a restart or a resume. The pressed look follows at once (the HUD reads state.buttons).
  function clearToggles() {
    cancelAll();
    for (const n in toggles) {
      if (!toggles[n]) continue;
      toggles[n] = false;
      if (n in state.buttons) state.buttons[n] = (downCount[n] || 0) > 0;
    }
  }
  // One latched toggle off (sprint drops a toggled aim). The pressed look follows at once.
  function clearToggle(n) {
    if (!toggles[n]) return;
    toggles[n] = false;
    if (n in state.buttons) state.buttons[n] = (downCount[n] || 0) > 0;
  }
  // Cancel every finger whose id is not in `list` (a TouchList or [{identifier}]): a finger whose
  // element left the DOM never sends its end, but it is missing from the next event's e.touches.
  function cancelMissing(list) {
    if (!fingers.size) return;
    for (const f of fingers.values()) {
      let found = false;
      for (let i = 0; i < list.length; i++) if (list[i].identifier === f.id) { found = true; break; }
      if (!found) release(f, 0, false);
    }
  }

  function frame(dt) {
    let mx = 0, my = 0, raw = 0;
    const st = state.stick;
    if (stickF) {
      let dx = (stickF.lx - st.cx) / T.stickRadius, dy = (stickF.ly - st.cy) / T.stickRadius;
      raw = Math.hypot(dx, dy);
      if (raw > 1) { dx /= raw; dy /= raw; raw = 1; }
      st.x = dx; st.y = dy;
      if (raw > T.deadZone) {
        const k = (raw - T.deadZone) / (1 - T.deadZone) / raw;
        mx = dx * k; my = -dy * k;
      }
    } else { st.x = 0; st.y = 0; }
    out.moveX = mx; out.moveY = my;
    pushT = stickF && raw >= T.sprintPush && my >= T.sprintForward ? pushT + dt : 0;
    if (!stickF && toggles.sprint) toggles.sprint = false;

    out.lookDx = lookDx; out.lookDy = lookDy;
    lookDx = 0; lookDy = 0;

    const held = out.held;
    held.clear();
    for (const n in holdCount) if (holdCount[n] > 0) held.add(n);
    for (const n in toggles) if (toggles[n]) held.add(n);
    out.autoSprint = pushT >= T.sprintHold - 1e-9;
    out.sprintToggle = !!toggles.sprint;
    if (out.autoSprint) held.add('sprint');
    out.pressed.clear();
    for (const n of pending) out.pressed.add(n);
    pending.clear();
    for (const n in state.buttons) state.buttons[n] = (downCount[n] || 0) > 0 || !!toggles[n];
    return out;
  }

  return {
    down, move, up, cancel, cancelAll, clearToggles, clearToggle, cancelMissing, frame, setLayout, state,
    toggled: (n) => !!toggles[n],
    has: (id) => fingers.has(id),
    get layout() { return L; },
    get fingers() { return fingers.size; },
    get stickActive() { return !!stickF && out.moveX * out.moveX + out.moveY * out.moveY > 0; },
  };
}

// ---- G.input.touch: the machine, its DOM binding and the player's touch settings -------------
// Layout is in screen coordinates as drawn: the HUD (layoutTouch) applies `lefty` itself,
// so this layer never mirrors. `layout` is the last argument given to setLayout; `rects` is what
// __touch reports.
export function createTouch(G, T = tuning.touch) {
  const machine = createTouchMachine(null, T);
  const touch = {
    active: false, // input mode is 'touch' (set by input.js)
    machine,
    layout: null,
    rects: { sticks: [], buttons: [] },
    state: machine.state,
    autoFire: T.defaultAutoFire, // auto-fire assist: shoot when the crosshair is on a zombie (off by default)
    assist: T.defaultAssist, // 0 off, 1 friction, 2 friction + magnetism (auto-fire is separate)
    sensitivity: 1, // multiplies T.look
    lefty: false, // preference for the HUD's layout; this layer does not mirror
    onTarget: false, // auto-fire is on a target this frame (set by the controller)
    setLayout(layout) {
      touch.layout = layout || null;
      machine.setLayout(layout || null, {});
      const sticks = [], buttons = [];
      if (layout && layout.stick) {
        const s = layout.stick;
        if (s.w !== undefined && s.h !== undefined) sticks.push({ x: s.x, y: s.y, w: s.w, h: s.h });
        else sticks.push({ x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r, cx: s.x, cy: s.y, r: s.r });
      }
      if (layout && layout.buttons) {
        for (const b of layout.buttons) buttons.push({ name: b.name, x: b.x - b.r, y: b.y - b.r, w: 2 * b.r, h: 2 * b.r, cx: b.x, cy: b.y, r: b.r, mode: b.mode || 'hold' });
      }
      touch.rects = { sticks, buttons, look: layout && layout.look ? { ...layout.look } : null };
    },
    cancelAll() { machine.cancelAll(); },
    clearToggles() { machine.clearToggles(); }, // ADS and any other latched toggle off (and every finger)
    frame(dt) { return machine.frame(dt); },
    attach,
  };

  // Touch events on the game surface: passive:false and preventDefault, so the page never scrolls,
  // zooms or makes compatibility mouse events and clicks. Touches that start on UI (menu buttons)
  // are left alone. Nothing here reads window.top: the same in a frame and at top level.
  function attach(win, doc, hooks = {}) {
    if (!win || !doc) return;
    const surface = (t) => !!t && (t.tagName === 'CANVAS' || t.id === 'app' || t === doc.body || t === doc.documentElement
      || (typeof t.closest === 'function' && !!t.closest('[data-touch-surface]')));
    const now = () => (win.performance ? win.performance.now() : Date.now());
    const opt = { passive: false };
    // touchcancel (and a move during a browser scroll) is not cancelable: calling preventDefault on
    // it only logs a console error.
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    const prune = (e) => { if (e.touches) machine.cancelMissing(e.touches); };
    win.addEventListener('touchstart', (e) => {
      prune(e);
      if (!surface(e.target)) return;
      stop(e);
      if (hooks.onStart) hooks.onStart(e);
      const t = now();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const c = e.changedTouches[i];
        machine.down(c.identifier, c.clientX, c.clientY, t);
      }
    }, opt);
    win.addEventListener('touchmove', (e) => {
      prune(e);
      let ours = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const c = e.changedTouches[i];
        if (!machine.has(c.identifier)) continue;
        ours = true;
        machine.move(c.identifier, c.clientX, c.clientY);
      }
      if (ours || surface(e.target)) stop(e);
    }, opt);
    const end = (cancel) => (e) => {
      let ours = false;
      const t = now();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const c = e.changedTouches[i];
        if (!machine.has(c.identifier)) continue;
        ours = true;
        if (cancel) machine.cancel(c.identifier);
        else { machine.move(c.identifier, c.clientX, c.clientY); machine.up(c.identifier, t); }
      }
      prune(e);
      if (ours || surface(e.target)) stop(e);
    };
    win.addEventListener('touchend', end(false), opt);
    win.addEventListener('touchcancel', end(true), opt);
    const block = (e) => { if (surface(e.target) || e.type === 'gesturestart') stop(e); };
    doc.addEventListener('gesturestart', block, opt); // iOS pinch
    doc.addEventListener('dblclick', block, opt); // double-tap zoom
    doc.addEventListener('contextmenu', block, opt); // long-press menu
  }

  return touch;
}
