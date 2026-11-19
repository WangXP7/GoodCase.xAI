import { describe, it, expect } from 'vitest';
import { createTouchMachine, touchLook, mirrorLayout, createTouch } from '../src/player/touch.js';
import { tuning } from '../src/game/tuning.js';

const T = tuning.touch;
const LAYOUT = {
  width: 800,
  stick: { x: 150, y: 280, r: 150 },
  look: { x: 340, y: 0, w: 460, h: 400 },
  buttons: [
    { name: 'fire', x: 700, y: 300, r: 42, mode: 'hold', look: true },
    { name: 'reload', x: 600, y: 350, r: 26, mode: 'tap' },
    { name: 'sprint', x: 150, y: 60, r: 24, mode: 'toggle' },
    { name: 'ads', x: 640, y: 220, r: 28, mode: 'toggle' },
  ],
};
const DT = 1 / 60;
const mk = (opts) => createTouchMachine(LAYOUT, T, opts);

describe('touch machine: stick', () => {
  it('56 px up from where the finger lands is full forward; 28 px is about 0.44 after the dead zone', () => {
    const m = mk();
    m.down(1, 120, 300, 0);
    m.move(1, 120, 244, 16);
    let f = m.frame(DT);
    expect(f.moveY).toBeCloseTo(1, 5);
    expect(f.moveX).toBeCloseTo(0, 5);
    m.move(1, 120, 272, 32);
    f = m.frame(DT);
    expect(f.moveY).toBeCloseTo((0.5 - T.deadZone) / (1 - T.deadZone), 5);
    expect(f.moveY).toBeGreaterThan(0.42);
    expect(f.moveY).toBeLessThan(0.45);
  });

  it('is anchored where the finger lands, not at a fixed centre', () => {
    const m = mk();
    m.down(1, 60, 360, 0); // far from the zone centre (150, 280)
    let f = m.frame(DT);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(m.state.stick.active).toBe(true);
    expect(m.state.stick.cx).toBe(60);
    m.move(1, 116, 360, 10);
    f = m.frame(DT);
    expect(f.moveX).toBeCloseTo(1, 5);
  });

  it('a finger sliding out of the radius keeps full deflection, and up returns it to 0', () => {
    const m = mk();
    m.down(1, 150, 280, 0);
    m.move(1, 150, 80, 50); // 200 px up, far outside the 56 px radius and the zone
    let f = m.frame(DT);
    expect(f.moveY).toBeCloseTo(1, 5);
    m.up(1, 100);
    f = m.frame(DT);
    expect(f.moveY).toBe(0);
    expect(m.state.stick.active).toBe(false);
  });

  it('held full forward for 0.25 s turns on auto-sprint; the sprint toggle flips on a tap and goes off with the stick', () => {
    const m = mk();
    m.down(1, 150, 280, 0);
    m.move(1, 150, 220, 10);
    let f;
    for (let i = 0; i < 14; i++) f = m.frame(DT); // 0.233 s
    expect(f.held.has('sprint')).toBe(false);
    for (let i = 0; i < 2; i++) f = m.frame(DT);
    expect(f.held.has('sprint')).toBe(true);
    m.move(1, 150, 250, 300); // pulled back: no auto-sprint
    f = m.frame(DT);
    expect(f.held.has('sprint')).toBe(false);
    m.down(2, 150, 60, 400); m.up(2, 450); // tap the toggle
    f = m.frame(DT);
    expect(f.held.has('sprint')).toBe(true);
    expect(m.state.buttons.sprint).toBe(true);
    m.up(1, 500); // stick released
    f = m.frame(DT);
    expect(f.held.has('sprint')).toBe(false);
  });
});

describe('touch machine: look', () => {
  it('a second finger in the look zone dragged 100 px right gives lookDx 100 that frame and 0 the next', () => {
    const m = mk();
    m.down(1, 150, 280, 0);
    m.move(1, 150, 224, 5);
    m.down(2, 400, 150, 10);
    m.move(2, 450, 150, 20);
    m.move(2, 500, 150, 30);
    let f = m.frame(DT);
    expect(f.lookDx).toBe(100);
    expect(f.lookDy).toBe(0);
    expect(f.moveY).toBeCloseTo(1, 5); // the stick keeps working
    f = m.frame(DT);
    expect(f.lookDx).toBe(0);
  });

  it('two fingers in the look zone: only the first looks', () => {
    const m = mk();
    m.down(1, 400, 100, 0);
    m.down(2, 500, 100, 0);
    m.move(2, 560, 100, 10);
    m.move(1, 420, 100, 10);
    let f = m.frame(DT);
    expect(f.lookDx).toBe(20);
    m.up(1, 20); // the second finger takes over without a jump
    m.move(2, 570, 100, 30);
    f = m.frame(DT);
    expect(f.lookDx).toBe(10);
  });

  it('a step over 0.35 rad is clamped', () => {
    const big = touchLook(5000, 0, DT, T, {});
    expect(Math.hypot(big.yaw, big.pitch)).toBeCloseTo(T.maxLookStep, 6);
    expect(big.yaw).toBeLessThan(0); // drag right turns right (yaw grows to the left)
    const slow = touchLook(10, 0, 1, T, {}); // 10 px/s: almost no acceleration
    expect(-slow.yaw).toBeCloseTo(10 * T.look * (1 + T.accel * 10 / T.accelSpeed), 9);
    const fast = touchLook(40, 0, DT, T, {}); // 2400 px/s: full acceleration
    expect(-fast.yaw).toBeCloseTo(40 * T.look * (1 + T.accel), 9);
    const ads = touchLook(10, 0, 1, T, { ads: true, sensitivity: 2, scale: 0.5 });
    expect(ads.yaw / slow.yaw).toBeCloseTo(T.adsScale * 2 * 0.5, 9);
    const up = touchLook(0, -10, 1, T, {});
    expect(up.pitch).toBeGreaterThan(0); // drag up looks up
  });
});

describe('touch machine: buttons', () => {
  it('a third finger on fire is held while the stick and look fingers keep working', () => {
    const m = mk();
    m.down(1, 150, 280, 0); m.move(1, 150, 224, 5);
    m.down(2, 400, 150, 0); m.move(2, 430, 150, 5);
    m.down(3, 700, 300, 8);
    let f = m.frame(DT);
    expect(f.held.has('fire')).toBe(true);
    expect(f.pressed.has('fire')).toBe(true);
    expect(f.moveY).toBeCloseTo(1, 5);
    expect(f.lookDx).toBe(30);
    f = m.frame(DT);
    expect(f.held.has('fire')).toBe(true);
    expect(f.pressed.has('fire')).toBe(false);
    m.up(3, 100);
    f = m.frame(DT);
    expect(f.held.has('fire')).toBe(false);
    expect(f.moveY).toBeCloseTo(1, 5);
  });

  it('a finger that starts on fire and drags turns the view and keeps firing', () => {
    const m = mk();
    m.down(3, 700, 300, 0);
    m.move(3, 740, 280, 30);
    let f = m.frame(DT);
    expect(f.held.has('fire')).toBe(true);
    expect(f.lookDx).toBe(40);
    expect(f.lookDy).toBe(-20);
    m.move(3, 790, 380, 60); // off the button: still firing, still looking
    f = m.frame(DT);
    expect(f.held.has('fire')).toBe(true);
    expect(f.lookDx).toBe(50);
  });

  it('cancel(id) releases everything that finger held: no stuck fire, no stuck movement', () => {
    const m = mk();
    m.down(1, 150, 280, 0); m.move(1, 150, 224, 5);
    m.down(3, 700, 300, 0);
    m.frame(DT);
    m.cancel(1); m.cancel(3);
    const f = m.frame(DT);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.held.size).toBe(0);
    expect(m.state.buttons.fire).toBe(false);
    // a later up or move for a cancelled id does nothing
    m.move(3, 750, 300, 50); m.up(3, 60);
    expect(m.frame(DT).lookDx).toBe(0);
  });

  it('cancelAll releases every finger', () => {
    const m = mk();
    m.down(1, 150, 280, 0); m.move(1, 150, 224, 5);
    m.down(3, 700, 300, 0);
    m.down(4, 400, 100, 0);
    m.cancelAll();
    const f = m.frame(DT);
    expect(f.moveY).toBe(0);
    expect(f.held.size).toBe(0);
  });

  it('a tap on reload gives pressed reload for exactly one frame', () => {
    const m = mk();
    m.down(5, 600, 350, 0);
    m.up(5, 80);
    let f = m.frame(DT);
    expect(f.pressed.has('reload')).toBe(true);
    expect(f.held.has('reload')).toBe(false);
    f = m.frame(DT);
    expect(f.pressed.has('reload')).toBe(false);
  });

  it('toggle buttons flip on a tap and not on a long press or a slide', () => {
    const m = mk();
    m.down(6, 640, 220, 0); m.up(6, 100);
    expect(m.frame(DT).held.has('ads')).toBe(true);
    m.down(6, 640, 220, 200); m.up(6, 900); // too long
    expect(m.frame(DT).held.has('ads')).toBe(true);
    m.down(6, 640, 220, 1000); m.move(6, 660, 220, 1050); m.up(6, 1100); // slid 20 px
    expect(m.frame(DT).held.has('ads')).toBe(true);
    m.down(6, 640, 220, 1200); m.up(6, 1300);
    expect(m.frame(DT).held.has('ads')).toBe(false);
  });

  it('clearToggles turns every latched toggle off at once (and the pressed look with it), fingers released', () => {
    const m = mk();
    m.down(6, 640, 220, 0); m.up(6, 100); // ADS on
    m.down(1, 120, 300, 0); m.move(1, 120, 244, 16); // stick held
    m.down(2, 150, 60, 200); m.up(2, 250); // sprint toggle on
    let f = m.frame(DT);
    expect(f.held.has('ads') && f.held.has('sprint')).toBe(true);
    m.clearToggles();
    expect(m.state.buttons.ads).toBe(false); // at once, before the next frame (the HUD reads it)
    expect(m.state.buttons.sprint).toBe(false);
    f = m.frame(DT);
    expect(f.held.has('ads')).toBe(false);
    expect(f.held.has('sprint')).toBe(false);
    expect(m.fingers).toBe(0); // no finger survives it either
    m.clearToggles(); // nothing latched: a no-op, never a flip back on
    expect(m.frame(DT).held.has('ads')).toBe(false);
  });

  it('G.input.touch.clearToggles clears ADS through the machine', () => {
    const t = createTouch({}, T);
    t.setLayout(LAYOUT);
    t.machine.down(6, 640, 220, 0); t.machine.up(6, 100);
    expect(t.frame(DT).held.has('ads')).toBe(true);
    t.clearToggles();
    expect(t.state.buttons.ads).toBe(false);
    expect(t.frame(DT).held.has('ads')).toBe(false);
  });

  it('lefty mirrors the layout', () => {
    const mir = mirrorLayout(LAYOUT, 800);
    expect(mir.stick.x).toBe(650);
    expect(mir.look.x).toBe(0);
    expect(mir.buttons[0].x).toBe(100);
    const m = mk({ lefty: true });
    m.down(1, 100, 300, 0); // fire, mirrored
    expect(m.frame(DT).held.has('fire')).toBe(true);
    m.down(2, 650, 280, 0); m.move(2, 650, 224, 5); // stick, mirrored
    expect(m.frame(DT).moveY).toBeCloseTo(1, 5);
    m.up(1, 10); // fire looks too: lift it so the look zone finger owns the look
    m.down(3, 300, 100, 0); m.move(3, 330, 100, 5); // look zone, mirrored
    expect(m.frame(DT).lookDx).toBe(30);
  });

  it('frame() returns the same objects every time (no per-frame allocation)', () => {
    const m = mk();
    const a = m.frame(DT);
    const b = m.frame(DT);
    expect(a).toBe(b);
    expect(a.held).toBe(b.held);
  });
});

describe('touch machine: zones, cancelling and sprint', () => {
  it('a rectangle stick zone anchors the stick under the finger anywhere inside it', () => {
    const m = createTouchMachine({ width: 800, stick: { x: 0, y: 100, w: 336, h: 300 }, look: { x: 336, y: 0, w: 464, h: 400 }, buttons: [] }, T);
    m.down(1, 300, 380, 0);
    expect(m.state.stick.active).toBe(true);
    expect(m.state.stick.cx).toBe(300);
    m.move(1, 300, 324, 5);
    expect(m.frame(DT).moveY).toBeCloseTo(1, 5);
    m.down(2, 340, 380, 0); // just outside: the look zone
    m.move(2, 350, 380, 5);
    expect(m.frame(DT).lookDx).toBe(10);
    const mir = mirrorLayout({ width: 800, stick: { x: 0, y: 100, w: 336, h: 300 } }, 800);
    expect(mir.stick).toMatchObject({ x: 464, w: 336 });
  });

  it('cancelMissing releases every finger whose id is not in the list', () => {
    const m = mk();
    m.down(1, 150, 280, 0); m.move(1, 150, 224, 5);
    m.down(3, 700, 300, 0);
    m.cancelMissing([{ identifier: 3 }]);
    let f = m.frame(DT);
    expect(f.moveY).toBe(0);
    expect(f.held.has('fire')).toBe(true);
    m.cancelMissing({ length: 0 });
    f = m.frame(DT);
    expect(f.held.has('fire')).toBe(false);
  });

  it('frame reports autoSprint apart from the sprint toggle', () => {
    const m = mk();
    m.down(1, 150, 280, 0); m.move(1, 150, 220, 5);
    let f;
    for (let i = 0; i < 20; i++) f = m.frame(DT);
    expect(f.autoSprint).toBe(true);
    m.down(2, 150, 60, 0); m.up(2, 50); // toggle on
    f = m.frame(DT);
    expect(f.sprintToggle).toBe(true);
  });
});

describe('touch machine: DOM binding', () => {
  const fakeTarget = () => {
    const l = {};
    return { l, addEventListener(t, f) { (l[t] ||= []).push(f); }, removeEventListener() {}, fire(t, e) { for (const f of l[t] || []) f(e); } };
  };
  const ev = (target, changed, touches = changed) => {
    const e = { target, cancelable: true, prevented: false, changedTouches: changed, touches };
    e.preventDefault = () => { e.prevented = true; };
    return e;
  };
  const pt = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
  const setup = () => {
    const win = fakeTarget();
    win.performance = { now: () => 0 };
    const doc = fakeTarget();
    doc.body = { tagName: 'BODY' }; doc.documentElement = { tagName: 'HTML' };
    const touch = createTouch({ params: {} });
    touch.setLayout(LAYOUT);
    touch.attach(win, doc);
    return { win, doc, touch };
  };
  const canvas = { tagName: 'CANVAS', closest: () => null };
  const button = { tagName: 'BUTTON', closest: () => null };
  const marked = { tagName: 'DIV', closest: (s) => (s === '[data-touch-surface]' ? {} : null) };

  it('takes touches that start on the game surface, leaves UI touches alone', () => {
    const { win, touch } = setup();
    const a = ev(canvas, [pt(1, 700, 300)]);
    win.fire('touchstart', a);
    expect(a.prevented).toBe(true);
    expect(touch.frame(DT).held.has('fire')).toBe(true);
    const b = ev(button, [pt(2, 600, 350)], [pt(1, 700, 300), pt(2, 600, 350)]);
    win.fire('touchstart', b);
    expect(b.prevented).toBe(false);
    expect(touch.frame(DT).pressed.has('reload')).toBe(false);
    const c = ev(marked, [pt(3, 600, 350)], [pt(1, 700, 300), pt(2, 600, 350), pt(3, 600, 350)]);
    win.fire('touchstart', c);
    expect(c.prevented).toBe(true);
    expect(touch.frame(DT).pressed.has('reload')).toBe(true);
    const d = ev(canvas, [pt(1, 700, 300)], []);
    d.cancelable = false; // touchcancel is not cancelable: no preventDefault, no console error
    win.fire('touchcancel', d);
    expect(d.prevented).toBe(false);
    expect(touch.frame(DT).held.has('fire')).toBe(false);
  });

  it('a finger whose element left the DOM (its end never arrives) is cancelled by the next event', () => {
    const { win, touch } = setup();
    win.fire('touchstart', ev(canvas, [pt(1, 150, 280)]));
    win.fire('touchmove', ev(canvas, [pt(1, 150, 224)]));
    expect(touch.frame(DT).moveY).toBeCloseTo(1, 5);
    // finger 1 lifted somewhere we never heard; finger 5 lands: e.touches no longer has 1
    win.fire('touchstart', ev(canvas, [pt(5, 400, 100)], [pt(5, 400, 100)]));
    expect(touch.frame(DT).moveY).toBe(0);
    expect(touch.machine.has(1)).toBe(false);
  });
});
