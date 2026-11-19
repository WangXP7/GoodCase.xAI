// One input record fed by keyboard, mouse and touch. Modes:
//   'lock'  - pointer lock (desktop default). Losing a lock we had pauses the game. If the page may
//             not lock (sandboxed frame), or two re-locks in a row are refused, it falls back to
//             'drag' for good, with an on-screen notice.
//   'drag'  - drag to look, click to fire.
//   'touch' - G.device.touch: on-screen controls through G.input.touch (touch.js). Never asks for
//             pointer lock and never shows the drag notice. Pauses on hidden, blur and pagehide
//             (not on portrait: it plays upright too); resume is the pause screen's button.
// Keyboard and mouse stay live in every mode (a tablet with a keyboard).
//
// Read once per frame after update(): move {x:right, y:forward} in [-1,1], look {dx,dy} in mouse
// pixels since last frame, touchLook {dx,dy} in CSS px of touch drag since last frame (the
// controller turns it into radians), held booleans per action, pressed(name) = went down this
// frame, held(name) = seconds it has been held (0 when up).
// Touch FIRE follows the held weapon's fire mode (touch.js fireModeOf): `fire` is held while the finger
// is down only for an automatic weapon; for a semi-automatic (or burst) one it is on for the frame the
// finger lands, so holding the button is one shot. Keyboard and mouse are not gated.
import { createTouch, fireModeOf, touchTrigger } from './touch.js';

const ACTIONS = ['fire', 'ads', 'sprint', 'jump', 'reload', 'interact', 'pause', 'swap', 'melee', 'throw', 'cycle', 'slot1', 'slot2', 'hint'];
const KEYMAP = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyR: 'reload', KeyF: 'interact', KeyE: 'interact',
  KeyP: 'pause', KeyQ: 'swap', KeyV: 'melee', KeyG: 'throw', Digit3: 'cycle', Digit1: 'slot1', Digit2: 'slot2', KeyH: 'hint',
  ArrowLeft: 'lookLeft', ArrowRight: 'lookRight', ArrowUp: 'lookUp', ArrowDown: 'lookDown',
};
const ARROW_LOOK_RATE = 1.8; // rad/s for arrow-key look (trackpad / no-mouse fallback)
const TAP_MAX_PX = 6; // drag mode: a press that moves less than this and is short counts as a click
const TAP_MAX_MS = 300;
const WHEEL_STEP = 50; // wheel delta (px) per swap
const WHEEL_GAP_MS = 180; // at most one swap per this long (trackpads send a stream)
const LOCK_REFUSALS = 2; // refused re-locks in a row before lock mode gives up for drag
const LOCK_COOLDOWN_MS = 1500; // refusals this soon after losing the lock are the browser's cooldown: not counted

export function createInput(G) {
  const hasDom = typeof document !== 'undefined';
  const held = new Set(); // logical names currently down (keys + mouse)
  let pending = new Set(); // went down since last update
  let justPressed = new Set(); // went down during the previous update window (this frame)
  const synth = new Set(); // injected for this frame only (bot)
  const synthQueued = new Set(); // injected for the next frame (for modules that update before the bot)
  const holdTime = Object.create(null);
  for (const a of ACTIONS) holdTime[a] = 0;
  let rawDx = 0;
  let rawDy = 0;
  let everLocked = false;
  let refusals = 0;
  let lostAt = -Infinity; // when a lock we held was last lost (performance.now ms)
  let pointerMode = 'lock'; // the mode a mouse goes back to: 'lock', or 'drag' once lock has failed for good
  let drag = null; // drag mode: {x, y, moved, t}
  let notice = null;
  const touch = createTouch(G);

  const input = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    touchLook: { dx: 0, dy: 0 },
    fire: false, ads: false, sprint: false, jump: false, reload: false, interact: false,
    swap: false, melee: false, throw: false, cycle: false, slot1: false, slot2: false, hint: false,
    locked: false,
    mode: 'lock', // 'lock' | 'drag' | 'touch'
    paused: false, // lock was lost; used only while G.game is still a stub
    sensitivity: 0.0022, // radians per mouse pixel; the settings screen may change it
    touch, // G.input.touch: setLayout, layout, rects, state, autoFire, assist, sensitivity, lefty
    pressed: (name) => justPressed.has(name) || synth.has(name),
    held: (name) => holdTime[name] || 0,
    // Bot / scripted input: action held and pressed for the current frame only.
    synth(name) {
      synth.add(name);
      if (name in input && typeof input[name] === 'boolean') input[name] = true;
    },
    // The same, for the whole of the next frame: game.update reads `interact` before the player
    // (and so the bot) has run, so a press made this frame would be cleared before it was seen.
    synthNext(name) { synthQueued.add(name); },
    requestLock,
    update,
  };

  function setMode(mode) {
    if (input.mode === mode) return;
    input.mode = mode;
    touch.active = mode === 'touch';
    if (G.events && typeof G.events.emit === 'function') G.events.emit('input:mode', { mode });
  }
  if (G.device && G.device.touch) { input.mode = 'touch'; touch.active = true; }

  function down(name) {
    if (!held.has(name)) pending.add(name);
    held.add(name);
  }
  function up(name) { held.delete(name); }

  function update(dt) {
    const was = justPressed;
    justPressed = pending;
    pending = was;
    pending.clear();
    synth.clear();
    if (synthQueued.size) { for (const n of synthQueued) synth.add(n); synthQueued.clear(); }
    const tf = touch.frame(dt);
    for (const n of tf.pressed) justPressed.add(n);
    const axis = (a, b) => (held.has(a) ? 1 : 0) - (held.has(b) ? 1 : 0);
    let mx = axis('right', 'left') + tf.moveX;
    let my = axis('fwd', 'back') + tf.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    input.move.x = mx;
    input.move.y = my;
    const arrowPx = (ARROW_LOOK_RATE * dt) / input.sensitivity;
    input.look.dx = rawDx + axis('lookRight', 'lookLeft') * arrowPx;
    input.look.dy = rawDy + axis('lookDown', 'lookUp') * arrowPx;
    rawDx = 0;
    rawDy = 0;
    input.touchLook.dx = tf.lookDx;
    input.touchLook.dy = tf.lookDy;
    const reloading = !!(G.weapon && G.weapon.reloading);
    const firing = held.has('fire') || synth.has('fire') || tf.held.has('fire') || touch.onTarget;
    // Pushing the stick all the way to run drops a toggled aim (as sprinting does on a pad), unless the
    // player is firing or reloading: then the aim stays and the sprint waits, as before.
    if (tf.autoSprint && !firing && !reloading && touch.machine.toggled('ads') && !held.has('ads') && !synth.has('ads')) {
      touch.machine.clearToggle('ads');
      tf.held.delete('ads');
    }
    // The touch stick's sprint (auto-sprint or the toggle) is held back while the player fires,
    // aims or reloads, or auto-fire is on a target: sprinting blocks shots and cancels reloads.
    const busy = firing || held.has('ads') || synth.has('ads') || tf.held.has('ads') || reloading;
    const mode = G.weapon && G.weapon.def ? fireModeOf(G.weapon.def) : 'auto';
    for (const a of ACTIONS) {
      if (a === 'pause') continue;
      const fromTouch = a === 'sprint' ? tf.held.has(a) && !busy
        : a === 'fire' ? touchTrigger(mode, tf.held.has(a), tf.pressed.has(a)) : tf.held.has(a);
      const on = held.has(a) || synth.has(a) || fromTouch;
      input[a] = on;
      holdTime[a] = on ? holdTime[a] + dt : 0;
    }
    if (hasDom && justPressed.has('pause')) setPaused(!isPaused());
  }

  if (!hasDom) return input; // non-DOM (tests)

  const gameState = () => (G.game && !G.game.stub ? G.game.state : null);
  const isPaused = () => (gameState() ? gameState() === 'paused' : input.paused);
  function setPaused(p) {
    if (p && input.locked) document.exitPointerLock?.();
    if (p) touch.cancelAll();
    if (gameState()) {
      if (p && gameState() === 'playing') G.game.pause?.();
      else if (!p && gameState() === 'paused') { G.game.resume?.(); requestLock(); }
    } else {
      input.paused = p;
      if (!p) requestLock();
    }
  }
  const wantsLock = () => !G.params.bot && !G.shotCam && (gameState() ? gameState() === 'playing' : !input.paused);
  const lockTarget = () => document.querySelector('#app canvas') || document.getElementById('app') || document.body;

  function showNotice(text) {
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('role', 'status');
      Object.assign(notice.style, {
        position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: 20,
        padding: '8px 14px', background: 'rgba(5,7,10,.72)', color: '#c9d1d8', borderRadius: '4px',
        font: '13px/1.3 ui-monospace, Menlo, monospace', letterSpacing: '.04em', pointerEvents: 'none',
        transition: 'opacity .6s', maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
      });
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.style.opacity = '1';
    clearTimeout(notice._t);
    notice._t = setTimeout(() => { notice.style.opacity = '0.35'; }, 6000);
  }

  function enterDragMode() {
    pointerMode = 'drag';
    if (input.mode !== 'lock') return; // touch mode never shows the notice
    setMode('drag');
    input.locked = false;
    showNotice('Mouse lock is unavailable here: drag to look, click to fire.');
  }

  function enterTouchMode() {
    if (input.mode === 'touch') return;
    if (document.pointerLockElement) document.exitPointerLock?.();
    input.locked = false;
    drag = null;
    setMode('touch');
  }

  function requestLock() {
    if (input.mode !== 'lock' || input.locked) return;
    const el = lockTarget();
    if (!el.requestPointerLock) { enterDragMode(); return; }
    try {
      const r = el.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(onLockError);
    } catch (e) {
      onLockError();
    }
  }
  // Before any successful lock an error means the frame denies it: fall back for good. After a
  // successful lock, errors are usually the browser's re-lock cooldown after Esc; the next click
  // retries. A refused re-lock must not leave the game running under a free cursor (resume() has
  // already happened by the time the browser answers): pause again, which puts the click-to-resume
  // screen back. Two refusals in a row and lock mode gives up for drag (no pause/resume loop).
  function onLockError() {
    if (input.mode !== 'lock') return;
    if (!everLocked) { enterDragMode(); return; }
    if (performance.now() - lostAt >= LOCK_COOLDOWN_MS) refusals++;
    if (refusals >= LOCK_REFUSALS) { enterDragMode(); return; }
    if (!document.pointerLockElement && wantsLock()) setPaused(true);
  }

  document.addEventListener('pointerlockerror', onLockError);
  document.addEventListener('pointerlockchange', () => {
    const now = !!document.pointerLockElement;
    const lost = input.locked && !now;
    input.locked = now;
    if (now) { everLocked = true; refusals = 0; }
    if (lost) lostAt = performance.now();
    if (lost && input.mode === 'lock') setPaused(true);
  });

  if (G.events && typeof G.events.on === 'function') {
    G.events.on('game:state', (e) => {
      // A menu is up (death screen, pause, title): give the cursor back so its buttons can be
      // clicked. Without this a player who died with the mouse locked had to press Esc first.
      if (e && e.state !== 'playing' && document.pointerLockElement) document.exitPointerLock?.();
      // No finger and no latched toggle (ADS) carries over a state change: nothing stays held behind
      // a menu, and a death, a restart or a resume starts unaimed.
      touch.clearToggles();
    });
  }

  // Touch: a device that is (or turns out to be) touch plays in touch mode. Upright or sideways both
  // play (orient.js only suggests sideways); a turn either way re-lays the controls, so no finger
  // survives it (a resize alone, without orientationchange, lands here too).
  let wasPortrait = !!(G.device && G.device.portrait);
  if (G.device && typeof G.device.onChange === 'function') {
    G.device.onChange((d) => {
      if (d.touch) enterTouchMode();
      if (!!d.portrait !== wasPortrait) { wasPortrait = !!d.portrait; touch.cancelAll(); }
    });
  }
  // A touchstart on the game surface (touch laptop back to its screen) puts touch mode back.
  touch.attach(window, document, { onStart: () => enterTouchMode() });
  // A mouse on a touch laptop (fine pointer) takes the game back to lock (or drag) mode, and asks
  // for the lock on this very click (a user gesture). A phone (coarse) ignores mouse events.
  window.addEventListener('pointerdown', (e) => {
    if (input.mode !== 'touch' || e.pointerType !== 'mouse' || !G.device || G.device.coarse) return;
    touch.cancelAll();
    setMode(pointerMode);
    if (pointerMode === 'lock' && onGameSurface(e) && wantsLock() && !isPaused()) requestLock();
  }, true);
  // Rotating the screen moves every control: no finger survives it.
  const onRotate = () => { touch.cancelAll(); };
  window.addEventListener('orientationchange', onRotate);
  if (window.screen && window.screen.orientation && typeof window.screen.orientation.addEventListener === 'function') {
    window.screen.orientation.addEventListener('change', onRotate);
  }

  // iOS only starts audio inside the gesture's own call stack: unlock synchronously in the handler.
  const unlockAudio = () => { try { G.audio?.unlock?.(); } catch (e) { /* audio reports its own failure */ } };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('touchend', unlockAudio, true);

  const isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    // In lock mode the browser owns Esc (it releases the lock, which pauses). Otherwise it is ours.
    const name = e.code === 'Escape' && input.mode !== 'lock' ? 'pause' : KEYMAP[e.code];
    if (!name) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) down(name);
  });
  window.addEventListener('keyup', (e) => {
    const name = e.code === 'Escape' ? 'pause' : KEYMAP[e.code];
    if (name) up(name);
  });
  const releaseAll = () => { held.clear(); drag = null; touch.cancelAll(); };
  // In lock mode losing focus also loses the lock, and that pauses. In drag and touch mode nothing
  // else would, and the game ran on behind another window.
  const awayPause = () => { if (input.mode !== 'lock' && wantsLock() && !isPaused()) setPaused(true); };
  window.addEventListener('blur', () => { releaseAll(); awayPause(); });
  window.addEventListener('pagehide', () => { releaseAll(); awayPause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); awayPause(); } });

  const onGameSurface = (e) => {
    const t = e.target;
    return t && (t.tagName === 'CANVAS' || t.id === 'app' || t === document.body || t === document.documentElement);
  };
  window.addEventListener('mousedown', (e) => {
    if (!onGameSurface(e)) return;
    if (input.mode === 'lock') {
      if (!input.locked) {
        if (isPaused()) setPaused(false);
        else if (wantsLock()) requestLock();
        return; // the click that takes the lock does not fire
      }
      if (e.button === 0) down('fire');
      if (e.button === 2) down('ads');
      return;
    }
    // drag mode, or a mouse on a touch device (resume there is the pause screen's button)
    if (isPaused()) { if (input.mode === 'drag') setPaused(false); return; }
    drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), button: e.button };
    if (e.button === 2) down('ads');
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) up('fire');
    if (e.button === 2) up('ads');
    if (input.mode !== 'lock' && drag && drag.button === 0) {
      if (drag.moved < TAP_MAX_PX && performance.now() - drag.t < TAP_MAX_MS) {
        // A tap fires. Held for one frame so weapons that read `fire` see it too.
        down('fire');
        setTimeout(() => up('fire'), 0);
      }
    }
    if (e.button === drag?.button) drag = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (input.mode === 'lock') {
      if (!input.locked) return;
    } else {
      if (!drag) return;
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    }
    rawDx += e.movementX || 0;
    rawDy += e.movementY || 0;
  });
  let wheelAcc = 0, wheelAt = -Infinity;
  window.addEventListener('wheel', (e) => {
    if (!onGameSurface(e)) return;
    wheelAcc += e.deltaY || 0;
    const now = performance.now();
    if (Math.abs(wheelAcc) >= WHEEL_STEP && now - wheelAt >= WHEEL_GAP_MS) {
      pending.add('swap'); // a press for one frame, never held
      wheelAt = now;
      wheelAcc = 0;
    }
  }, { passive: true });
  window.addEventListener('contextmenu', (e) => { if (onGameSurface(e)) e.preventDefault(); });

  // Pointer lock API missing or the document is in a frame without allow-pointer-lock.
  if (input.mode === 'lock' && !('pointerLockElement' in document)) enterDragMode();

  return input;
}
