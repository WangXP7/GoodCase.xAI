// Phone mechanics. Fire mode per weapon def, the auto-fire assist's cadence, tap-to-jump in the
// stick zone, sprint dropping a toggled aim, and the new settings through the store wrapper.
import { describe, it, expect } from 'vitest';
import { createTouchMachine, fireModeOf, touchTrigger } from '../src/player/touch.js';
import { createInput } from '../src/player/input.js';
import { createPlayer } from '../src/player/controller.js';
import { flatMoveCapsule } from '../src/player/sim.js';
import { createWeaponState, step } from '../src/weapon/firing.js';
import { createEvents } from '../src/core/events.js';
import { createSettings } from '../src/ui/settings.js';
import { sanitizeSettings } from '../src/ui/format.js';
import { tuning } from '../src/game/tuning.js';

const T = tuning.touch;
const DT = 1 / 60;
const LAYOUT = {
  stick: { x: 0, y: 120, w: 340, h: 280 }, look: { x: 340, y: 0, w: 460, h: 400 },
  buttons: [
    { name: 'fire', x: 700, y: 300, r: 42, mode: 'hold', look: true },
    { name: 'ads', x: 640, y: 220, r: 28, mode: 'toggle' },
    { name: 'jump', x: 700, y: 200, r: 28, mode: 'hold' },
  ],
};

// A fake weapon table: the gate reads only the def's fire-mode fields.
const FAKE = {
  tapper: { id: 'tapper', auto: false, semiAuto: true, rpm: 600, mag: 99, reserve: 0 },
  hose: { id: 'hose', auto: true, semiAuto: false, rpm: 600, mag: 99, reserve: 0 },
  triple: { id: 'triple', auto: false, burst: 3, rpm: 600, mag: 99, reserve: 0 },
  legacySemi: { id: 'legacySemi', semiAuto: true, rpm: 400, mag: 99, reserve: 0 },
  legacyAuto: { id: 'legacyAuto', semiAuto: false, rpm: 600, mag: 99, reserve: 0 },
};

describe('fire mode from the weapon def', () => {
  it('reads auto / semi / burst from a fake table', () => {
    expect(fireModeOf(FAKE.tapper)).toBe('semi');
    expect(fireModeOf(FAKE.hose)).toBe('auto');
    expect(fireModeOf(FAKE.triple)).toBe('burst');
    expect(fireModeOf(FAKE.legacySemi)).toBe('semi');
    expect(fireModeOf(FAKE.legacyAuto)).toBe('auto');
    expect(fireModeOf(null)).toBe('semi');
    expect(fireModeOf({ fireMode: 'auto' })).toBe('auto');
  });
  it('the real table: only the SMG, rifle and LMG are automatic', () => {
    const modes = {};
    for (const id of tuning.weapons.ids) modes[id] = fireModeOf(tuning.weapons.table[id]);
    expect(modes).toEqual({
      pistol: 'semi', revolver: 'semi', pump: 'semi', autoShotgun: 'semi', smg: 'auto', rifle: 'auto',
      battleRifle: 'semi', lmg: 'auto', jumper: 'semi', flare: 'semi',
    });
  });
  it('touchTrigger: held counts only for automatic guns; a press always counts', () => {
    expect(touchTrigger('auto', true, false)).toBe(true);
    expect(touchTrigger('semi', true, false)).toBe(false);
    expect(touchTrigger('burst', true, false)).toBe(false);
    expect(touchTrigger('semi', true, true)).toBe(true);
    expect(touchTrigger('burst', true, true)).toBe(true);
    expect(touchTrigger('auto', false, false)).toBe(false);
  });
});

// The touch FIRE button through the real input module and the real fire-control step, composed the way
// firing.js's tick composes them: press = pressed('fire'); fire = press || (auto && input.fire).
function holdFire(def, seconds, { taps = 0 } = {}) {
  const G = { params: {}, device: { touch: true, coarse: true }, weapon: { def, reloading: false } };
  const input = createInput(G);
  input.touch.setLayout(LAYOUT);
  const m = input.touch.machine;
  const s = createWeaponState(def);
  const out = [];
  let shots = 0;
  const frames = Math.round(seconds / DT);
  let t = 0;
  const run = () => {
    input.update(DT);
    const press = input.pressed('fire');
    const fire = press || (!!def.auto && input.fire);
    step(s, { fire, press, reload: false, sprint: false, active: true, busy: false }, DT, def, out);
    for (const e of out) if (e.type === 'fire') shots++;
    t += DT * 1000;
  };
  if (taps) {
    for (let k = 0; k < taps; k++) {
      m.down(1, 700, 300, t); run(); run();
      m.up(1, t); for (let i = 0; i < 20; i++) run();
    }
    return { shots, input };
  }
  m.down(1, 700, 300, 0);
  const fireFrames = [];
  for (let i = 0; i < frames; i++) { run(); fireFrames.push(input.fire); }
  m.up(1, t);
  run();
  return { shots, input, fireFrames };
}

describe('the FIRE button follows the fire mode', () => {
  it('semi-automatic: holding FIRE for 1.5 s fires exactly one shot', () => {
    const r = holdFire(FAKE.tapper, 1.5);
    expect(r.shots).toBe(1);
    expect(r.fireFrames.filter(Boolean).length).toBe(1); // input.fire only on the press frame
  });
  it('burst: one press is one trigger pull (one burst), however long it is held', () => {
    expect(holdFire(FAKE.triple, 1.5).shots).toBe(1);
  });
  it('automatic: holding FIRE keeps firing at the rpm', () => {
    const r = holdFire(FAKE.hose, 1.5);
    expect(r.shots).toBeGreaterThanOrEqual(14); // 600 rpm = 10 a second
    expect(r.shots).toBeLessThanOrEqual(16);
    expect(r.fireFrames.every(Boolean)).toBe(true);
  });
  it('semi-automatic: each tap is a shot', () => {
    expect(holdFire(FAKE.tapper, 0, { taps: 4 }).shots).toBe(4);
  });
  it('the real pistol, pump and Jumper: one shot per hold; the SMG: many', () => {
    for (const id of ['pistol', 'pump', 'jumper', 'revolver', 'battleRifle', 'autoShotgun', 'flare']) {
      expect(holdFire(tuning.weapons.table[id], 1.5).shots, id).toBe(1);
    }
    expect(holdFire(tuning.weapons.table.smg, 1.5).shots).toBeGreaterThan(15);
  });
  it('a held FIRE still holds back the stick sprint whatever the mode', () => {
    const G = { params: {}, device: { touch: true, coarse: true }, weapon: { def: FAKE.tapper, reloading: false } };
    const input = createInput(G);
    input.touch.setLayout(LAYOUT);
    const m = input.touch.machine;
    m.down(1, 150, 300, 0); m.move(1, 150, 240, 1);
    for (let i = 0; i < 30; i++) input.update(DT);
    expect(input.sprint).toBe(true);
    m.down(2, 700, 300, 0);
    for (let i = 0; i < 10; i++) input.update(DT);
    expect(input.sprint).toBe(false);
  });
  it('keyboard and mouse fire are not gated (desktop unchanged)', () => {
    const G = { params: {}, weapon: { def: FAKE.tapper, reloading: false } };
    const input = createInput(G);
    input.synth('fire');
    expect(input.fire).toBe(true);
  });
});

describe('tap the stick zone to jump', () => {
  const mk = () => createTouchMachine(LAYOUT, T);
  const tap = (m, ms, px, id = 1) => {
    m.down(id, 100, 300, 1000);
    const f0 = m.frame(DT);
    const jumpAtStart = f0.pressed.has('jump');
    if (px) m.move(id, 100 + px, 300, 1000 + ms / 2);
    m.up(id, 1000 + ms);
    const f1 = m.frame(DT);
    return { jumpAtStart, jump: f1.pressed.has('jump') };
  };
  it('a quick tap (up within 180 ms, under 12 px) jumps, on release', () => {
    const m = mk();
    const r = tap(m, 120, 4);
    expect(r.jumpAtStart).toBe(false); // nothing on landing: the start of a move never jumps
    expect(r.jump).toBe(true);
    expect(m.frame(DT).pressed.has('jump')).toBe(false); // one frame only
  });
  it('edge timings: 180 ms jumps, 181 ms does not', () => {
    expect(tap(mk(), 180, 0).jump).toBe(true);
    expect(tap(mk(), 181, 0).jump).toBe(false);
  });
  it('edge travel: 11.9 px jumps, 12 px does not (a fast flick is a move)', () => {
    expect(tap(mk(), 60, 11.9).jump).toBe(true);
    expect(tap(mk(), 60, 12).jump).toBe(false);
    expect(tap(mk(), 60, 40).jump).toBe(false);
  });
  it('a fast flick still moves the player while it lasts', () => {
    const m = mk();
    m.down(1, 100, 300, 0);
    m.move(1, 100, 250, 40);
    const f = m.frame(DT);
    expect(f.moveY).toBeGreaterThan(0.8);
    m.up(1, 80);
    expect(m.frame(DT).pressed.has('jump')).toBe(false);
  });
  it('a long press with no movement does not jump', () => {
    expect(tap(mk(), 400, 0).jump).toBe(false);
  });
  it('a cancelled finger does not jump; a tap in the look zone does not jump', () => {
    const m = mk();
    m.down(1, 100, 300, 0); m.cancel(1);
    expect(m.frame(DT).pressed.has('jump')).toBe(false);
    m.down(2, 500, 100, 0); m.up(2, 50);
    expect(m.frame(DT).pressed.has('jump')).toBe(false);
  });
  it('a second finger landing in the zone while the stick is held is not a jump', () => {
    const m = mk();
    m.down(1, 100, 300, 0); m.move(1, 100, 260, 10);
    m.down(2, 200, 300, 20); m.up(2, 60);
    expect(m.frame(DT).pressed.has('jump')).toBe(false);
  });
  it('reaches G.input as a jump press', () => {
    const input = createInput({ params: {}, device: { touch: true, coarse: true } });
    input.touch.setLayout(LAYOUT);
    input.touch.machine.down(1, 100, 300, 0); input.touch.machine.up(1, 90);
    input.update(DT);
    expect(input.pressed('jump')).toBe(true);
    input.update(DT);
    expect(input.pressed('jump')).toBe(false);
  });
});

describe('sprint drops a toggled aim', () => {
  const setup = (weapon = { def: FAKE.tapper, reloading: false }) => {
    const G = { params: {}, device: { touch: true, coarse: true }, weapon };
    const input = createInput(G);
    input.touch.setLayout(LAYOUT);
    const m = input.touch.machine;
    m.down(9, 640, 220, 0); m.up(9, 50); // tap AIM: on
    input.update(DT);
    return { input, m };
  };
  it('pushing the stick all the way turns aim off and sprints', () => {
    const { input, m } = setup();
    expect(input.ads).toBe(true);
    m.down(1, 150, 300, 0); m.move(1, 150, 240, 1);
    for (let i = 0; i < 10; i++) input.update(DT);
    expect(input.ads).toBe(true); // a short push keeps it
    for (let i = 0; i < 20; i++) input.update(DT);
    expect(input.ads).toBe(false);
    expect(input.sprint).toBe(true);
    expect(input.touch.state.buttons.ads).toBe(false);
  });
  it('not while FIRE is held (firing while aimed keeps the aim)', () => {
    const { input, m } = setup();
    m.down(2, 700, 300, 0);
    m.down(1, 150, 300, 0); m.move(1, 150, 240, 1);
    for (let i = 0; i < 40; i++) input.update(DT);
    expect(input.ads).toBe(true);
    expect(input.sprint).toBe(false);
  });
});

// ---- the auto-fire assist through the real controller -------------------------------------------
describe('auto-fire assist cadence', () => {
  const touchG = (def, { autoFire = true } = {}) => {
    const G = {
      params: { touch: true }, events: createEvents(), time: { t: 0 }, game: { stub: true },
      device: { touch: true, coarse: true, onChange() {} },
      level: { moveCapsule: flatMoveCapsule, playerStart: { pos: [0, 0, 0], yaw: 0 }, bounds: { min: [-50, -1, -50], max: [50, 20, 50] }, raycast: () => null },
      zombies: { list: [{ id: 1, pos: { x: 0, y: 0, z: -10 }, alive: true }], raycast: () => ({ id: 1, dist: 10 }) },
      weapon: { def, ammo: { mag: 10, reserve: 10 }, reloading: false },
    };
    G.input = createInput(G);
    G.input.touch.setLayout(LAYOUT);
    G.input.touch.autoFire = autoFire;
    G.player = createPlayer(G);
    G.player.pitch = Math.atan2(-0.5, 10);
    const times = [];
    let n = 0;
    const synth = G.input.synth;
    G.input.synth = (name) => { if (name === 'fire') times.push(n * DT); synth(name); };
    const frames = (k) => { for (let i = 0; i < k; i++) { n++; G.input.update(DT); G.player.update(DT); } };
    return { G, times, frames };
  };
  it('is off by default', () => {
    expect(T.defaultAutoFire).toBe(false);
    const input = createInput({ params: {} });
    expect(input.touch.autoFire).toBe(false);
  });
  it('off: a zombie in the crosshair fires nothing', () => {
    const r = touchG(tuning.weapons.table.pistol, { autoFire: false });
    r.frames(120);
    expect(r.times.length).toBe(0);
    expect(r.G.input.touch.onTarget).toBe(false);
  });
  it('semi-automatic pistol: single shots at most 4 a second (its rpm would allow 6.7)', () => {
    const r = touchG(tuning.weapons.table.pistol);
    r.frames(120); // 2 s
    expect(r.times.length).toBeGreaterThanOrEqual(7);
    expect(r.times.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < r.times.length; i++) expect(r.times[i] - r.times[i - 1]).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });
  it('never above the weapon rpm (the Jumper: 60 rpm, one a second)', () => {
    const r = touchG(tuning.weapons.table.jumper);
    r.frames(180); // 3 s
    expect(r.times.length).toBeGreaterThanOrEqual(3);
    expect(r.times.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < r.times.length; i++) expect(r.times[i] - r.times[i - 1]).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('automatic SMG: holds the trigger every frame on target', () => {
    const r = touchG(tuning.weapons.table.smg);
    r.frames(60);
    expect(r.times.length).toBeGreaterThanOrEqual(52); // all but the 0.12 s settle
  });
  it('works with aim assist (friction, magnetism) off', () => {
    const r = touchG(tuning.weapons.table.pistol);
    r.G.input.touch.assist = 0;
    r.frames(60);
    expect(r.times.length).toBeGreaterThanOrEqual(3);
  });
});

// ---- settings -------------------------------------------------------------------------------------
const withStorage = (ls, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = { localStorage: ls };
  try { return fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
};
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const settingsG = () => ({ params: {}, input: { sensitivity: 0.002, touch: { autoFire: false, assist: 2, sensitivity: 1, lefty: false } }, fx: {}, game: { state: 'title' } });

describe('settings: auto-fire assist (tilt to look was removed)', () => {
  it('an old saved look / tiltSens is dropped harmlessly', () => {
    expect(sanitizeSettings({ look: 'tilt', tiltSens: 2 })).toEqual({});
    const ls = memory();
    ls.setItem('graveyard-shift.settings', JSON.stringify({ look: 'tilt', tiltSens: 2.2, autoFire: true }));
    withStorage(ls, () => {
      const G = settingsG();
      const s = createSettings(G);
      expect(() => s.applyAll()).not.toThrow();
      expect(s.autoFire).toBe(true);
      expect(s.look).toBeUndefined();
      expect(s.set('look', 'tilt')).toBe(false);
      s.set('lefty', true);
      expect(JSON.parse(ls.getItem('graveyard-shift.settings'))).toEqual({ autoFire: true, lefty: true });
    });
  });
  it('defaults: auto-fire assist off', () => {
    withStorage(memory(), () => { expect(createSettings(settingsG()).autoFire).toBe(false); });
  });
  it('persists through the store', () => {
    const ls = memory();
    withStorage(ls, () => {
      const G = settingsG();
      createSettings(G).set('autoFire', true);
      expect(G.input.touch.autoFire).toBe(true);
    });
    withStorage(ls, () => {
      const G = settingsG();
      const b = createSettings(G);
      b.applyAll();
      expect(b.autoFire).toBe(true); expect(G.input.touch.autoFire).toBe(true);
    });
  });
  it('survives a store that throws on every call', () => {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    withStorage(boom, () => {
      const s = createSettings(settingsG());
      expect(() => s.applyAll()).not.toThrow();
      expect(() => s.set('autoFire', true)).not.toThrow();
      expect(s.autoFire).toBe(true); // this visit only
    });
  });
});

describe('copy and the FIRE glyph', () => {
  it('FIRE shows one bullet for a tap-a-shot gun, three for an automatic', async () => {
    const { fireGlyph, ICONS } = await import('../src/ui/touchHud.js');
    expect(fireGlyph(fireModeOf(tuning.weapons.table.pistol))).toBe('fire');
    expect(fireGlyph(fireModeOf(tuning.weapons.table.pump))).toBe('fire');
    expect(fireGlyph(fireModeOf(tuning.weapons.table.smg))).toBe('fireAuto');
    expect(fireGlyph('burst')).toBe('fire');
    expect(ICONS.fireAuto).toContain('<path');
  });
  it('no hint mentions tilt any more', async () => {
    const { HINTS, hintById } = await import('../src/ui/hintDefs.js');
    expect(hintById('tilt')).toBeNull();
    expect(JSON.stringify(HINTS.map((h) => h.text))).not.toMatch(/tilt/i);
  });
  it('the controls card says tap to shoot, hold with automatics, tap the left side to jump, drag to look', async () => {
    const { CONTROLS } = await import('../src/ui/format.js');
    const row = (id) => CONTROLS.find((c) => c.id === id).touch;
    expect(row('fire')).toMatch(/^Tap; hold for automatics/);
    expect(row('jump')).toMatch(/Tap left side/);
    expect(row('look')).toBe('Drag right side');
    expect(CONTROLS.find((c) => c.id === 'fire').key).toBe('Left click'); // keyboard column unchanged
  });
});

describe('sweep: a shell-by-shell reload stops for a FIRE tap', () => {
  it('pump: tapping FIRE mid-reload stops loading (keeps what went in) and shoots', () => {
    const def = tuning.weapons.table.pump;
    const G = { params: {}, device: { touch: true, coarse: true }, weapon: { def, reloading: false } };
    const input = createInput(G);
    input.touch.setLayout(LAYOUT);
    const s = createWeaponState(def);
    s.mag = 2; s.reserve = 10;
    const out = [];
    const ev = [];
    const run = (reload = false) => {
      input.update(DT);
      G.weapon.reloading = s.reloading;
      const press = input.pressed('fire');
      step(s, { fire: press, press, reload, sprint: false, active: true, busy: false }, DT, def, out);
      for (const e of out) ev.push(e.type);
    };
    run(true);
    expect(s.reloading).toBe(true);
    for (let i = 0; i < 40; i++) run(); // one shell in (0.55 s each)
    expect(s.mag).toBe(3);
    input.touch.machine.down(1, 700, 300, 0);
    run();
    expect(ev).toContain('reloadCancel');
    expect(ev[ev.length - 1]).toBe('fire');
    expect(s.mag).toBe(2);
    expect(s.reloading).toBe(false);
  });
});
