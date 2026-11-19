import { describe, it, expect } from 'vitest';
import { tuning } from '../src/game/tuning.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import {
  createWeaponState, step, spreadDeg, spreadDir, nearestHit, createWeapon, SPREAD, FIRE_BUFFER, falloffScale,
} from '../src/weapon/firing.js';
import { WEAPONS } from '../src/weapon/defs.js';
import { casingLaunch } from '../src/fx/casing.js';

const T = tuning.pistol;
const DT = 1 / 60;
const idle = { fire: false, reload: false, sprint: false, active: true };
const types = (evs) => evs.map((e) => e.type);
const deg = (a, b) => (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI;

// Run the state for `secs` with no input; returns all events.
function run(s, secs, inp = {}) {
  const out = [];
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) out.push(...step(s, { ...idle, ...inp }, DT, T));
  return out;
}

describe('weapon state machine', () => {
  it('starts with tuning ammo', () => {
    const s = createWeaponState(T);
    expect(s.mag).toBe(12);
    expect(s.reserve).toBe(48);
  });

  it('12 shots empty the magazine; the 13th only dry-fires', () => {
    const s = createWeaponState(T);
    s.reserve = 0; // so the dry fire does not start a reload
    let shots = 0;
    for (let i = 0; i < 12; i++) {
      const ev = step(s, { ...idle, fire: true }, DT, T);
      shots += ev.filter((e) => e.type === 'fire').length;
      run(s, 0.2);
    }
    expect(shots).toBe(12);
    expect(s.mag).toBe(0);
    const ev = step(s, { ...idle, fire: true }, DT, T);
    expect(types(ev)).toEqual(['dry']);
    expect(s.mag).toBe(0);
  });

  it('marks the last round of the magazine', () => {
    const s = createWeaponState(T);
    s.mag = 1;
    const ev = step(s, { ...idle, fire: true }, DT, T);
    expect(ev[0]).toMatchObject({ type: 'fire', last: true });
  });

  it('dry fire on an empty magazine starts a reload when there is reserve', () => {
    const s = createWeaponState(T);
    s.mag = 0;
    const ev = step(s, { ...idle, fire: true }, DT, T);
    expect(types(ev)).toEqual(['dry', 'reload']);
    expect(s.reloading).toBe(true);
    // further presses while reloading do nothing at all
    expect(step(s, { ...idle, fire: true }, DT, T)).toEqual([]);
  });

  it('reload takes 1.6 s and moves min(12, reserve)', () => {
    const s = createWeaponState(T);
    s.mag = 0;
    expect(types(step(s, { ...idle, reload: true }, 0, T))).toEqual(['reload']);
    run(s, 1.0);
    expect(s.mag).toBe(0); // ammo moves at 0.65 of the reload with no view timing
    run(s, 0.1);
    expect(s.mag).toBe(12);
    expect(s.reserve).toBe(36);
    expect(s.reloading).toBe(true); // still cannot fire until the reload ends
    expect(types(step(s, { ...idle, fire: true }, DT, T))).toEqual([]);
    const tail = run(s, 0.4); // about 1.52 s in
    expect(s.reloading).toBe(true);
    tail.push(...run(s, 0.1)); // past 1.6 s
    expect(types(tail)).toContain('reloadDone');
    expect(s.reloading).toBe(false);

    const r = createWeaponState(T);
    r.mag = 0; r.reserve = 5;
    step(r, { ...idle, reload: true }, 0, T);
    run(r, 1.7);
    expect(r.mag).toBe(5);
    expect(r.reserve).toBe(0);
  });

  it('a partial magazine only takes what it needs', () => {
    const s = createWeaponState(T);
    s.mag = 7;
    step(s, { ...idle, reload: true }, 0, T);
    run(s, 1.7);
    expect(s.mag).toBe(12);
    expect(s.reserve).toBe(43);
  });

  it('will not reload a full magazine or with no reserve', () => {
    const s = createWeaponState(T);
    expect(step(s, { ...idle, reload: true }, DT, T)).toEqual([]);
    s.mag = 3; s.reserve = 0;
    expect(step(s, { ...idle, reload: true }, DT, T)).toEqual([]);
  });

  it('uses the view magIn moment when the view gives timing', () => {
    const s = createWeaponState(T);
    s.mag = 0;
    step(s, { ...idle, reload: true, viewTimed: true }, 0, T);
    run(s, 1.2, { viewTimed: true });
    expect(s.mag).toBe(0); // past 0.65 * 1.6 but the view has not said magIn
    step(s, { ...idle, viewTimed: true, magIn: true }, DT, T);
    expect(s.mag).toBe(12);
  });

  it('grants at the end if the view never reports magIn', () => {
    const s = createWeaponState(T);
    s.mag = 0;
    step(s, { ...idle, reload: true, viewTimed: true }, 0, T);
    run(s, 1.7, { viewTimed: true });
    expect(s.mag).toBe(12);
    expect(s.reloading).toBe(false);
  });

  it('a reload cancelled by sprint does not grant ammo', () => {
    const s = createWeaponState(T);
    s.mag = 2;
    step(s, { ...idle, reload: true }, 0, T);
    run(s, 0.8);
    const ev = step(s, { ...idle, sprint: true }, DT, T);
    expect(types(ev)).toEqual(['reloadCancel']);
    expect(s.reloading).toBe(false);
    run(s, 2);
    expect(s.mag).toBe(2);
    expect(s.reserve).toBe(48);
  });

  it('a reload cancelled by leaving play does not grant ammo', () => {
    const s = createWeaponState(T);
    s.mag = 2;
    step(s, { ...idle, reload: true }, 0, T);
    run(s, 0.5);
    expect(types(step(s, { ...idle, active: false }, DT, T))).toEqual(['reloadCancel']);
    run(s, 2);
    expect(s.mag).toBe(2);
  });

  it('cannot fire while sprinting or not active', () => {
    const s = createWeaponState(T);
    expect(step(s, { ...idle, fire: true, sprint: true }, DT, T)).toEqual([]);
    expect(step(s, { ...idle, fire: true, active: false }, DT, T)).toEqual([]);
    expect(s.mag).toBe(12);
  });

  it('fire rate is capped at 400 rpm however fast the trigger is pressed', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 30]) {
      const s = createWeaponState(T);
      s.mag = 1000;
      let shots = 0;
      const n = Math.round(3 / dt);
      for (let i = 0; i < n; i++) shots += step(s, { ...idle, fire: true }, dt, T).filter((e) => e.type === 'fire').length;
      // 3 s at 400 rpm = 20 shots (plus the one at t = 0)
      expect(shots).toBeLessThanOrEqual(21);
      expect(shots).toBeGreaterThanOrEqual(14); // frame quantisation can only make it slower
    }
    // and pressing via fire() calls with dt 0 does not bypass it
    const s = createWeaponState(T);
    let shots = 0;
    for (let i = 0; i < 10; i++) shots += step(s, { ...idle, fire: true }, 0, T).length;
    expect(shots).toBe(1);
  });

  it('buffers one press made in the last 80 ms of the cooldown', () => {
    const s = createWeaponState(T);
    step(s, { ...idle, fire: true }, 0, T); // shot at t = 0, cooldown 0.15 s
    // pressed at t = 0.1 (0.05 s left): no shot now, but one when the cooldown ends
    run(s, 0.1 - DT);
    expect(step(s, { ...idle, fire: true }, DT, T)).toEqual([]);
    expect(s.buffered).toBe(true);
    const ev = run(s, 0.06);
    expect(types(ev)).toEqual(['fire']);
    expect(s.mag).toBe(10);
    expect(run(s, 0.5)).toEqual([]); // only one press is buffered
  });

  it('drops a press made earlier in the cooldown, and sprint clears a buffered one', () => {
    const s = createWeaponState(T);
    step(s, { ...idle, fire: true }, 0, T);
    run(s, 0.03);
    step(s, { ...idle, fire: true }, DT, T); // 0.15 - 0.047 > FIRE_BUFFER left
    expect(0.15 - 0.03 - DT).toBeGreaterThan(FIRE_BUFFER);
    expect(s.buffered).toBe(false);
    expect(run(s, 0.5)).toEqual([]);

    const r = createWeaponState(T);
    step(r, { ...idle, fire: true }, 0, T);
    run(r, 0.1);
    step(r, { ...idle, fire: true }, DT, T);
    expect(r.buffered).toBe(true);
    step(r, { ...idle, sprint: true }, DT, T);
    expect(r.buffered).toBe(false);
    expect(run(r, 0.5)).toEqual([]);
    expect(r.mag).toBe(11);
  });

  it('buffering never beats 400 rpm', () => {
    const s = createWeaponState(T);
    s.mag = 1000;
    let shots = 0;
    let last = -1, minGap = Infinity;
    for (let i = 0; i < 2400; i++) { // 10 s at 240 Hz, pressing every frame
      const n = step(s, { ...idle, fire: true }, 1 / 240, T).length;
      if (n) { if (last >= 0) minGap = Math.min(minGap, (i - last) / 240); last = i; shots += n; }
    }
    expect(minGap).toBeGreaterThanOrEqual(60 / T.rpm - 1e-9);
    expect(shots).toBeLessThanOrEqual(67);
  });

  it('reuses an output array', () => {
    const s = createWeaponState(T);
    const out = [{ stale: true }];
    expect(step(s, idle, DT, T, out)).toBe(out);
    expect(out).toEqual([]);
    step(s, { ...idle, fire: true }, DT, T, out);
    expect(types(out)).toEqual(['fire']);
  });

  it('bloom recovers within 0.25 s', () => {
    const s = createWeaponState(T);
    step(s, { ...idle, fire: true }, 0, T);
    expect(s.bloom).toBeGreaterThan(0);
    run(s, 0.25 + DT);
    expect(s.bloom).toBe(0);
  });
});

describe('spread', () => {
  it('is larger from the hip than in ADS, and larger when moving or airborne', () => {
    const s = createWeaponState(T);
    const ads = spreadDeg(s, { ads: 1 });
    const hip = spreadDeg(s, { ads: 0 });
    expect(ads).toBeCloseTo(SPREAD.ads, 5);
    expect(hip).toBeCloseTo(SPREAD.hip, 5);
    expect(hip).toBeGreaterThan(ads);
    expect(spreadDeg(s, { ads: 0, moving: true })).toBeCloseTo(hip + 1.0, 5);
    expect(spreadDeg(s, { ads: 1, moving: true })).toBeGreaterThan(ads);
    expect(spreadDeg(s, { ads: 0, airborne: true })).toBeCloseTo(hip + 2.0, 5);
    step(s, { ...idle, fire: true }, 0, T);
    expect(spreadDeg(s, { ads: 0 })).toBeGreaterThan(hip);
  });

  it('sampled directions stay inside the cone and fill it', () => {
    const rng = createRng(7);
    const f = [0, 0, -1];
    for (const d of [0.15, 1.2, 4.2]) {
      let max = 0;
      for (let i = 0; i < 500; i++) {
        const v = spreadDir(f, d, rng);
        expect(Math.hypot(...v)).toBeCloseTo(1, 6);
        max = Math.max(max, deg(f, v));
      }
      expect(max).toBeLessThanOrEqual(d + 1e-6);
      expect(max).toBeGreaterThan(d * 0.8);
    }
    // works for a straight-up forward too
    const up = spreadDir([0, 1, 0], 1, rng);
    expect(deg([0, 1, 0], up)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('is deterministic for a seed', () => {
    const a = spreadDir([0, 0, -1], 1.2, createRng(3));
    const b = spreadDir([0, 0, -1], 1.2, createRng(3));
    expect(a).toEqual(b);
  });
});

describe('nearestHit', () => {
  const z = { id: 4, part: 'torso', pos: [0, 1, -10], dist: 10 };
  const w = { pos: [0, 1, -6], normal: [0, 0, 1], surface: 'metal', dist: 6 };
  it('the nearer of world and zombie wins', () => {
    expect(nearestHit(z, w)).toEqual({ kind: 'world', hit: w });
    expect(nearestHit({ ...z, dist: 3 }, w)).toEqual({ kind: 'zombie', hit: { ...z, dist: 3 } });
    expect(nearestHit(z, null)).toEqual({ kind: 'zombie', hit: z });
    expect(nearestHit(null, w)).toEqual({ kind: 'world', hit: w });
    expect(nearestHit(null, null)).toBe(null);
  });
  it('ignores malformed hits', () => {
    expect(nearestHit({ id: 1 }, w)).toEqual({ kind: 'world', hit: w });
    expect(nearestHit(z, { dist: NaN })).toEqual({ kind: 'zombie', hit: z });
  });
});

// G-facing layer with mocks and no view (createWeaponView needs a scene; it is allowed to fail).
function mockG({ zHit = null, wHit = null, state = 'playing' } = {}) {
  const events = createEvents();
  const log = [];
  for (const n of ['weapon:fire', 'weapon:reload', 'hit:world', 'hit:zombie']) events.on(n, (p) => log.push([n, p]));
  const pressed = new Set();
  const damaged = [];
  const recoil = [];
  const G = {
    params: {}, events, rng: createRng(1), time: { t: 0 },
    input: { pressed: (n) => pressed.has(n), ads: false, sprint: false },
    player: {
      eye: [0, 1.7, 0], forward: [0, 0, -1], vel: [0, 0, 0], onGround: true, sprinting: false, alive: true,
      addRecoil: (p, y) => recoil.push([p, y]), addShake: () => {},
    },
    game: { state },
    zombies: {
      raycast: () => zHit,
      damage: (id, amount, part, dir) => { damaged.push({ id, amount, part, dir }); return { killed: part === 'head' }; },
    },
    level: { raycast: () => wHit },
  };
  return { G, log, pressed, damaged, recoil };
}

describe('G.weapon', () => {
  const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

  it('fires through pressed("fire"), emits events and hits the nearer target', () => {
    const restore = quiet();
    const m = mockG({
      zHit: { id: 9, part: 'head', pos: [0, 1.7, -8], dist: 8 },
      wHit: { pos: [0, 1.7, -20], normal: [0, 0, 1], surface: 'concrete', dist: 20 },
    });
    const w = createWeapon(m.G);
    restore();
    m.G.weapon = w;
    expect(w.name).toBe('Wren 9');
    w.update(DT);
    expect(m.log).toEqual([]);
    m.pressed.add('fire');
    w.update(DT);
    m.pressed.clear();
    expect(w.ammo.mag).toBe(11);
    expect(m.log.map((l) => l[0])).toEqual(['weapon:fire', 'hit:zombie']);
    const fire = m.log[0][1];
    expect(fire.weapon).toBe('pistol');
    expect(fire.pos).toBeTruthy();
    expect(fire.dir).toBeTruthy();
    const hz = m.log[1][1];
    expect(hz).toMatchObject({ id: 9, part: 'head', killed: true, headshot: true });
    expect(hz.damage).toBe(T.damage * tuning.walker.headMultiplier);
    expect(m.damaged[0]).toMatchObject({ id: 9, amount: 40, part: 'head' });
    expect(m.recoil.length).toBe(1);
    expect(m.recoil[0][0]).toBeGreaterThan(0);
  });

  it('emits hit:world when the wall is nearer and respects range', () => {
    const restore = quiet();
    const m = mockG({ zHit: { id: 1, part: 'torso', pos: [0, 1.7, -8], dist: 8 }, wHit: { pos: [0, 1.7, -3], normal: [0, 0, 1], surface: 'metal', dist: 3 } });
    const w = createWeapon(m.G);
    restore();
    w.fire();
    expect(m.log.map((l) => l[0])).toEqual(['weapon:fire', 'hit:world']);
    expect(m.log[1][1]).toMatchObject({ surface: 'metal' });
    expect(m.damaged).toEqual([]);
  });

  it('dry-fires once per press, auto-reloads, and refuses outside play', () => {
    const restore = quiet();
    const m = mockG();
    const w = createWeapon(m.G);
    restore();
    for (let i = 0; i < 12; i++) { w.fire(); w.update(0.2); }
    expect(w.ammo.mag).toBe(0);
    m.log.length = 0;
    w.fire();
    expect(m.log.map((l) => l[0])).toEqual(['weapon:fire', 'weapon:reload']);
    expect(m.log[0][1]).toEqual({ dry: true, weapon: 'pistol' });
    for (let i = 0; i < 100; i++) w.update(DT);
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 36 });
    m.G.game.state = 'paused';
    m.log.length = 0;
    w.fire();
    expect(m.log).toEqual([]);
  });

  it('addReserve caps at maxReserve; reset restores the start and cancels a reload', () => {
    const restore = quiet();
    const m = mockG();
    const w = createWeapon(m.G);
    restore();
    expect(w.addReserve(10)).toBe(10);
    expect(w.ammo.reserve).toBe(58);
    expect(w.addReserve()).toBe(38);
    expect(w.ammo.reserve).toBe(96);
    expect(w.addReserve(5)).toBe(0);
    expect(w.addReserve(-5)).toBe(0);
    w.fire(); w.update(0.2); w.reload();
    w.reset();
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 48 });
    for (let i = 0; i < 120; i++) w.update(DT);
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 48 });
  });

  it('resets ammo when a new run starts after death', () => {
    const restore = quiet();
    const m = mockG();
    const w = createWeapon(m.G);
    restore();
    w.fire(); w.update(0.2); w.fire();
    expect(w.ammo.mag).toBe(10);
    m.G.events.emit('game:state', { state: 'paused' });
    m.G.events.emit('game:state', { state: 'playing' });
    expect(w.ammo.mag).toBe(10); // resume keeps ammo
    m.G.events.emit('game:state', { state: 'dead' });
    m.G.events.emit('game:state', { state: 'playing' });
    expect(w.ammo.mag).toBe(12);
  });

  it('a synthesised bot press reaches the fire path', () => {
    const restore = quiet();
    const m = mockG();
    const w = createWeapon(m.G);
    restore();
    // the bot calls input.synth('fire'), which makes pressed('fire') true for this frame
    m.pressed.add('fire');
    w.update(DT);
    expect(w.ammo.mag).toBe(11);
  });
});

// A stand-in viewmodel through createWeapon's createView seam.
function fakeView() {
  const handlers = {};
  const v = {
    played: [], rounds: [], visible: true, adsTarget: 0, ads: 0, throwOnUpdate: false, updates: 0,
    events: { on(n, fn) { (handlers[n] = handlers[n] || []).push(fn); return () => {}; } },
    emit(n) { for (const fn of handlers[n] || []) fn({ anim: 'reload' }); },
    play(name, opts) { v.played.push(opts && opts.last ? `${name}:last` : name); return 1; },
    setRounds(n) { v.rounds.push(n); },
    setAds(a) { v.adsTarget = a; },
    setVisible(b) { v.visible = b; },
    update() { v.updates++; if (v.throwOnUpdate) throw new Error('boom'); },
    muzzleWorld: () => ({ x: 0.1, y: 1.5, z: -0.5 }),
    ejectWorld: () => ({ x: 0.15, y: 1.55, z: -0.35 }),
  };
  return v;
}

describe('G.weapon with a view', () => {
  function setup() {
    const m = mockG();
    const v = fakeView();
    const w = createWeapon(m.G, { createView: () => v });
    m.G.weapon = w;
    return { ...m, v, w };
  }

  it('drives the view and passes muzzle and eject positions', () => {
    const { w, v, log } = setup();
    expect(w.view).toBe(v);
    w.fire();
    expect(v.played).toEqual(['fire']);
    expect(log[0][1].pos).toEqual({ x: 0.1, y: 1.5, z: -0.5 });
    expect(log[0][1].eject).toEqual({ x: 0.15, y: 1.55, z: -0.35 });
    w.update(DT);
    expect(v.updates).toBe(1);
    w.state.mag = 1; w.update(0.2);
    w.fire();
    expect(v.played).toEqual(['fire', 'fire:last']);
  });

  it('moves ammo at the view magIn, not on the timer', () => {
    const { w, v } = setup();
    w.state.mag = 0;
    w.reload();
    expect(v.played).toEqual(['reload']);
    for (let i = 0; i < 70; i++) w.update(DT); // 1.17 s, past 0.65 * 1.6
    expect(w.ammo.mag).toBe(0);
    v.emit('magIn');
    w.update(DT);
    expect(w.ammo).toMatchObject({ mag: 12, reserve: 36 });
    expect(v.rounds[v.rounds.length - 1]).toBe(12);
  });

  it('a magIn from an earlier, cancelled reload does not count', () => {
    const { w, v, G } = setup();
    w.state.mag = 0;
    w.reload();
    w.update(0.5);
    v.emit('magIn');
    G.player.sprinting = true; w.update(DT); G.player.sprinting = false;
    w.reload();
    w.update(DT);
    expect(w.ammo.mag).toBe(0);
  });

  it('sprinting through update cancels the reload, plays draw and grants nothing', () => {
    const { w, v, G } = setup();
    w.state.mag = 4;
    G.input.pressed = (n) => n === 'reload';
    w.update(DT);
    G.input.pressed = () => false;
    expect(w.reloading).toBe(true);
    for (let i = 0; i < 30; i++) w.update(DT);
    G.player.sprinting = true;
    w.update(DT);
    expect(w.reloading).toBe(false);
    expect(v.played).toEqual(['reload', 'draw']);
    expect(v.adsTarget).toBe(0);
    for (let i = 0; i < 120; i++) w.update(DT);
    expect(w.ammo).toMatchObject({ mag: 4, reserve: 48 });
    // and cannot fire while sprinting
    G.input.pressed = (n) => n === 'fire';
    w.update(DT);
    expect(w.ammo.mag).toBe(4);
    G.player.sprinting = false;
    w.update(DT);
    expect(w.ammo.mag).toBe(3);
  });

  it('drops a view that throws, once, and keeps working on the timer', () => {
    const { w, v } = setup();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a[0]);
    try {
      v.throwOnUpdate = true;
      w.update(DT);
      w.update(DT);
    } finally { console.warn = orig; }
    expect(w.view).toBe(null);
    expect(v.visible).toBe(false);
    expect(v.updates).toBe(1);
    expect(warns.length).toBe(1);
    w.state.mag = 0;
    w.reload();
    for (let i = 0; i < 70; i++) w.update(DT);
    expect(w.ammo.mag).toBe(12); // timer grant (0.65 * 1.6 s) without a view
    for (let i = 0; i < 40; i++) w.update(DT); // reload ends at 1.6 s
    w.fire();
    expect(w.ammo.mag).toBe(11);
  });

  it('an idle update does not run the state machine', () => {
    const { w, G } = setup();
    let reads = 0;
    const game = { get state() { reads++; return 'playing'; } };
    G.game = game;
    w.update(DT);
    const idleReads = reads;
    w.fire(); // reads state once in the active check
    expect(reads).toBeGreaterThan(idleReads);
    reads = 0;
    for (let i = 0; i < 30; i++) w.update(DT); // cooldown and bloom still running: ticks
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    w.update(DT);
    // idle and not aiming: nothing reads the game state (the state machine did not run)
    expect(reads).toBe(0);
  });
});

describe('shell casing: one source, from the ejection port', () => {
  const rngMid = { range: (a, b) => (a + b) / 2 };

  it('starts at the payload\'s eject position, not the muzzle', () => {
    const e = { pos: { x: 0.1, y: 1.5, z: -0.6 }, dir: { x: 0, y: 0, z: -1 }, eject: { x: 0.14, y: 1.52, z: -0.42 } };
    const out = casingLaunch(e, rngMid, null);
    expect(out.slice(0, 3)).toEqual([0.14, 1.52, -0.42]);
  });

  it('flies to the shooter\'s right, up and a little back, whichever way they face', () => {
    for (const yaw of [0, 1, 2.5, -2]) {
      const dir = [-Math.sin(yaw), 0, -Math.cos(yaw)];
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const o = casingLaunch({ pos: [0, 1.5, 0], dir, eject: [0, 1.5, 0] }, rngMid, null);
      const v = o.slice(3);
      expect(v[0] * right[0] + v[2] * right[2]).toBeGreaterThan(1);
      expect(v[1]).toBeGreaterThan(1.3);
      expect(v[0] * dir[0] + v[2] * dir[2]).toBeLessThan(0);
    }
  });

  it('inherits the shooter\'s velocity', () => {
    const e = { pos: [0, 1.5, 0], dir: [0, 0, -1], eject: [0, 1.5, 0] };
    const a = casingLaunch(e, rngMid, null).slice(3);
    const b = casingLaunch(e, rngMid, [3, 0, -4]).slice(3);
    expect(b[0] - a[0]).toBeCloseTo(3); expect(b[2] - a[2]).toBeCloseTo(-4);
  });

  it('without eject (no viewmodel) estimates the port behind the muzzle; bad payloads give null', () => {
    const o = casingLaunch({ pos: [0, 1.5, -1], dir: [0, 0, -1] }, rngMid, null);
    expect(o[2]).toBeGreaterThan(-1); // behind the muzzle
    expect(Math.hypot(o[0], o[1] - 1.5, o[2] + 1)).toBeLessThan(0.2);
    expect(casingLaunch({ pos: [0, 0, 0] }, rngMid, null)).toBe(null);
    expect(casingLaunch({ dir: [0, 0, 0], eject: [0, 0, 0] }, rngMid, null)).toBe(null);
    expect(casingLaunch({ dir: [0, 0, -1], eject: [NaN, 0, 0] }, rngMid, null)).toBe(null);
    expect(casingLaunch(null, rngMid, null)).toBe(null);
  });

  it('G.weapon throws no brass itself: it passes eject on weapon:fire and never asks the view to', () => {
    const m = mockG();
    const plays = [];
    let fxCasings = 0;
    m.G.fx = { casing: () => { fxCasings++; }, ejectCasing: () => { fxCasings++; }, muzzle() {} };
    const view = {
      ads: 0, events: null,
      muzzleWorld: () => ({ x: 0, y: 1.6, z: -0.6 }), ejectWorld: () => ({ x: 0.05, y: 1.62, z: -0.4 }),
      play: (name, opts) => plays.push([name, opts]), setRounds() {}, setAds() {}, update() {}, setVisible() {},
    };
    const w = createWeapon(m.G, { createView: () => view });
    m.G.weapon = w;
    m.pressed.add('fire');
    w.update(DT);
    const fires = m.log.filter((l) => l[0] === 'weapon:fire');
    expect(fires).toHaveLength(1);
    expect(fires[0][1].eject).toEqual({ x: 0.05, y: 1.62, z: -0.4 });
    expect(fxCasings).toBe(0); // the weapon itself spawns none: G.fx does, once, from the event
    const fire = plays.find((p) => p[0] === 'fire');
    expect(fire).toBeTruthy();
    expect(fire[1] && fire[1].casing).toBeFalsy(); // and the view is not told to throw one either
  });
});

describe('viewmodel visibility follows the game state', () => {
  const mkView = (vis) => ({
    ads: 0, events: null, muzzleWorld: () => ({ x: 0, y: 1.6, z: -0.6 }), ejectWorld: () => null,
    play() {}, setRounds() {}, setAds() {}, update() {}, setVisible: (b) => vis.push(b),
  });
  it('hidden on the title screen, shown when play starts; noweapon keeps it hidden', () => {
    const vis = [];
    const m = mockG({ state: 'title' });
    const w = createWeapon(m.G, { createView: () => mkView(vis) });
    w.setVisible(false); // what main.js does at boot on the title
    m.G.events.emit('game:state', { state: 'playing' });
    m.G.events.emit('game:state', { state: 'paused' });
    m.G.events.emit('game:state', { state: 'playing' });
    m.G.events.emit('game:state', { state: 'dead' });
    expect(vis).toEqual([false, true]); // shown once on leaving the title, untouched by pause and death
    // boot order: the weapon is built before G.game exists, main.js hides it on the title, and
    // an autostart (or a staged shot) then goes straight to playing
    const vis3 = [];
    const b = mockG();
    delete b.G.game;
    const wb = createWeapon(b.G, { createView: () => mkView(vis3) });
    b.G.game = { state: 'title' };
    wb.setVisible(false);
    b.G.game.state = 'playing';
    b.G.events.emit('game:state', { state: 'playing' });
    expect(vis3).toEqual([false, true]);
    const vis2 = [];
    const n = mockG({ state: 'title' });
    n.G.params.noweapon = true;
    createWeapon(n.G, { createView: () => mkView(vis2) });
    n.G.events.emit('game:state', { state: 'playing' });
    expect(vis2).toEqual([false]);
  });
});


// ---------------------------------------------------------------- the arsenal's fire control

describe('fire control by weapon', () => {
  it('the SMG fires 13 rounds in 1.0 s with the trigger held (780 rpm)', () => {
    const S = WEAPONS.smg;
    const s = createWeaponState(S);
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      shots += step(s, { ...idle, fire: true, press: i === 0 }, DT, S).filter((e) => e.type === 'fire').length;
    }
    expect(shots).toBe(13);
    expect(s.mag).toBe(17);
  });

  it('through G.weapon: the SMG fires while the trigger is held, the pistol once per press', () => {
    const count = (m) => m.log.filter((l) => l[0] === 'weapon:fire' && !l[1].dry).length;
    const smg = mockG();
    smg.G.params.give = ['smg'];
    const a = createWeapon(smg.G, { createView: () => null });
    smg.G.input.fire = true;
    smg.pressed.add('fire');
    a.update(DT);
    smg.pressed.clear();
    for (let i = 1; i < 60; i++) a.update(DT);
    expect(a.id).toBe('smg');
    expect(count(smg)).toBe(13);

    const pis = mockG();
    const b = createWeapon(pis.G, { createView: () => null });
    pis.G.input.fire = true;
    pis.pressed.add('fire');
    b.update(DT);
    pis.pressed.clear();
    for (let i = 1; i < 60; i++) b.update(DT);
    expect(count(pis)).toBe(1);
  });

  it('an automatic weapon dry-fires once per press, not once per cycle', () => {
    const S = WEAPONS.smg;
    const s = createWeaponState(S);
    s.mag = 0; s.reserve = 0;
    let dry = 0;
    for (let i = 0; i < 60; i++) dry += step(s, { ...idle, fire: true, press: i === 0 }, DT, S).filter((e) => e.type === 'dry').length;
    expect(dry).toBe(1);
  });

  it('an automatic weapon run dry with the trigger held starts its reload without a dry fire', () => {
    const S = WEAPONS.smg;
    const s = createWeaponState(S);
    s.mag = 2;
    const out = [];
    for (let i = 0; i < 30; i++) out.push(...step(s, { ...idle, fire: true, press: i === 0 }, DT, S));
    expect(types(out).filter((t) => t !== 'ammo')).toEqual(['fire', 'fire', 'reload']);
    expect(s.reloading).toBe(true);
  });

  it('the pump fires 8 rays per shot and one shot costs one shell', () => {
    const m = mockG({ wHit: { pos: [0, 1.7, -10], normal: [0, 0, 1], surface: 'metal', dist: 10 } });
    let casts = 0;
    m.G.level.raycast = () => { casts++; return { pos: [0, 1.7, -10], normal: [0, 0, 1], surface: 'metal', dist: 10 }; };
    m.G.params.give = ['pump'];
    const w = createWeapon(m.G, { createView: () => null });
    w.fire();
    expect(w.ammo.mag).toBe(5);
    expect(casts).toBe(8);
    const fire = m.log.find((l) => l[0] === 'weapon:fire')[1];
    expect(fire).toMatchObject({ weapon: 'pump', pellets: 8, upgraded: false });
    expect(m.log.filter((l) => l[0] === 'hit:world')).toHaveLength(8);
  });

  it('a shell reload adds one round per 0.55 s and firing interrupts it with the rounds so far kept', () => {
    const P = WEAPONS.pump;
    const s = createWeaponState(P);
    s.mag = 2;
    expect(types(step(s, { ...idle, reload: true }, 0, P))).toEqual(['reload']);
    const steps = (secs) => { const out = []; for (let i = 0, n = Math.round(secs / DT); i < n; i++) out.push(...step(s, idle, DT, P)); return out; };
    steps(0.5);
    expect(s.mag).toBe(2);
    steps(0.1);
    expect(s.mag).toBe(3);
    steps(0.55);
    expect(s.mag).toBe(4);
    expect(s.reserve).toBe(28);
    const ev = step(s, { ...idle, fire: true }, DT, P);
    expect(types(ev)).toEqual(['reloadCancel', 'fire']);
    expect(s.reloading).toBe(false);
    expect(s.mag).toBe(3);
    expect(s.reserve).toBe(28);
  });

  it('a shell reload ends itself when the tube is full or the reserve runs out', () => {
    const P = WEAPONS.pump;
    const s = createWeaponState(P);
    s.mag = 4; s.reserve = 1;
    step(s, { ...idle, reload: true }, 0, P);
    const out = [];
    for (let i = 0; i < 120; i++) out.push(...step(s, idle, DT, P));
    expect(s.mag).toBe(5);
    expect(s.reserve).toBe(0);
    expect(types(out)).toContain('reloadDone');
    expect(s.reloading).toBe(false);
    // the semi-automatic shotgun waits 0.5 s before its first shell
    const A = WEAPONS.autoShotgun;
    const b = createWeaponState(A);
    b.mag = 0;
    step(b, { ...idle, reload: true }, 0, A);
    for (let i = 0; i < Math.round(0.9 / DT); i++) step(b, idle, DT, A);
    expect(b.mag).toBe(0);
    for (let i = 0; i < Math.round(0.1 / DT); i++) step(b, idle, DT, A);
    expect(b.mag).toBe(1);
  });

  it('pellet damage at 22 m is 0.35x that at 8 m', () => {
    expect(falloffScale(8, [8, 22, 0.35])).toBe(1);
    expect(falloffScale(2, [8, 22, 0.35])).toBe(1);
    expect(falloffScale(22, [8, 22, 0.35])).toBeCloseTo(0.35);
    expect(falloffScale(15, [8, 22, 0.35])).toBeCloseTo(0.675);
    expect(falloffScale(50, null)).toBe(1);
    const at = (dist) => {
      const m = mockG({ zHit: { id: 1, part: 'torso', pos: [0, 1.7, -dist], dist } });
      m.G.params.give = ['pump'];
      const w = createWeapon(m.G, { createView: () => null });
      w.fire();
      return m.damaged.map((d) => d.amount);
    };
    const near = at(8), far = at(22);
    expect(near).toHaveLength(8);
    expect(far).toHaveLength(8);
    expect(far[0] / near[0]).toBeCloseTo(0.35);
    expect(near[0]).toBe(28);
  });

  it('a revolver round goes through three zombies in line, keeping 0.7 of its damage each time', () => {
    const m = mockG();
    const line = [5, 6, 7]; // three zombies straight ahead
    m.G.zombies.raycast = (o, d, max) => {
      const oz = o[2];
      for (let i = 0; i < line.length; i++) {
        const zz = -line[i], dist = oz - zz;
        if (dist > 0 && dist <= max) return { id: i + 1, part: 'torso', pos: [0, 1.7, zz], dist };
      }
      return null;
    };
    m.G.params.give = ['revolver'];
    const w = createWeapon(m.G, { createView: () => null });
    w.fire();
    expect(m.damaged.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(m.damaged[0].amount).toBe(140);
    expect(m.damaged[1].amount).toBeCloseTo(98);
    expect(m.damaged[2].amount).toBeCloseTo(68.6);
    const hits = m.log.filter((l) => l[0] === 'hit:zombie').map((l) => l[1]);
    expect(hits.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(hits[0].dir).toBeTruthy();
    // the pistol goes through one more at half damage
    m.damaged.length = 0;
    w.give('pistol', { slot: 0 });
    for (let i = 0; i < 60; i++) w.update(DT);
    w.switchTo(0);
    for (let i = 0; i < 60; i++) w.update(DT);
    w.fire();
    expect(m.damaged.map((d) => d.id)).toEqual([1, 2]);
    expect(m.damaged[1].amount).toBe(20);
  });

  it('a world hit stops a piercing round', () => {
    const m = mockG({ wHit: { pos: [0, 1.7, -5.5], normal: [0, 0, 1], surface: 'concrete', dist: 5.5 } });
    m.G.zombies.raycast = (o, d, max) => {
      for (const [id, zz] of [[1, -5], [2, -6]]) { const dist = o[2] - zz; if (dist > 0 && dist <= max) return { id, part: 'torso', pos: [0, 1.7, zz], dist }; }
      return null;
    };
    m.G.params.give = ['battleRifle'];
    const w = createWeapon(m.G, { createView: () => null });
    w.fire();
    expect(m.damaged.map((d) => d.id)).toEqual([1]);
    expect(m.log.filter((l) => l[0] === 'hit:world')).toHaveLength(1);
  });

  it('LMG moveScale 0.9 reaches G.player.setSpeedScale("weapon") while held and leaves on switch', () => {
    const m = mockG();
    const f = new Map([['machine', 1.12]]);
    const calls = [];
    m.G.player.setSpeedScale = (src, k) => { calls.push([src, k]); f.set(src, k); };
    Object.defineProperty(m.G.player, 'speedScale', { get() { let v = 1; for (const k of f.values()) v *= k; return v; } });
    const w = createWeapon(m.G, { createView: () => null });
    w.give('lmg');
    expect(m.G.player.speedScale).toBeCloseTo(0.9 * 1.12);
    w.switchTo(0);
    expect(m.G.player.speedScale).toBeCloseTo(1.12);
    w.switchTo(1);
    w.reset();
    expect(f.get('weapon')).toBe(1);
    expect(calls.every((c) => c[0] === 'weapon')).toBe(true);
    // a player without the hook is left alone
    const n = mockG();
    const v = createWeapon(n.G, { createView: () => null });
    expect(() => v.give('lmg')).not.toThrow();
  });

  it('held fire for 10 s keeps the rate at 30 and 144 fps', () => {
    for (const id of ['smg', 'rifle', 'lmg']) {
      const S = WEAPONS[id];
      for (const fps of [30, 144]) {
        const s = createWeaponState(S);
        s.mag = 100000;
        let shots = 0;
        for (let i = 0; i < 10 * fps; i++) shots += step(s, { ...idle, fire: true, press: i === 0 }, 1 / fps, S).filter((e) => e.type === 'fire').length;
        const want = (10 * S.rpm) / 60;
        expect(Math.abs(shots - want)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('with mods.instantKill any hit kills', () => {
    const m = mockG({ zHit: { id: 3, part: 'legL', pos: [0, 0.5, -8], dist: 8 } });
    const rec = { id: 3, health: 2000, pos: { x: 0, y: 0, z: -8 } };
    m.G.zombies.list = [rec];
    m.G.zombies.damage = (id, amount, part) => { m.damaged.push({ id, amount, part }); rec.health -= amount; return { killed: rec.health <= 0, damage: amount }; };
    const w = createWeapon(m.G, { createView: () => null });
    w.mods.instantKill = true;
    w.fire();
    const hit = m.log.find((l) => l[0] === 'hit:zombie')[1];
    expect(hit.killed).toBe(true);
    expect(rec.health).toBeLessThanOrEqual(0);
  });

  it('One-Tap spares oneTapImmune zombies: they take the plain amount, others take health + 1', () => {
    const run1 = (extra) => {
      const m = mockG({ zHit: { id: 3, part: 'legL', pos: [0, 0.5, -8], dist: 8 } });
      const rec = { id: 3, health: 2000, pos: { x: 0, y: 0, z: -8 }, ...extra };
      m.G.zombies.list = [rec];
      m.G.zombies.damage = (id, amount, part) => { m.damaged.push({ id, amount, part }); return { killed: false, damage: amount }; };
      const w = createWeapon(m.G, { createView: () => null });
      w.mods.instantKill = true;
      w.fire();
      return m.damaged[0].amount;
    };
    const plain = run1({ oneTapImmune: true });
    expect(plain).toBeLessThan(2000);
    expect(run1({})).toBe(2001);
  });

  it('weapon:low once at the threshold and weapon:empty once', () => {
    const m = mockG();
    const seen = [];
    for (const n of ['weapon:low', 'weapon:empty']) m.G.events.on(n, (p) => seen.push([n, p]));
    const w = createWeapon(m.G, { createView: () => null });
    w.state.reserve = 14;
    const emptyMag = () => { for (let i = 0; i < 12; i++) { w.fire(); for (let k = 0; k < 12; k++) w.update(DT); } };
    const reload = () => { w.reload(); for (let k = 0; k < 110; k++) w.update(DT); };
    emptyMag(); reload(); // reserve 2
    expect(seen).toEqual([['weapon:low', { weapon: 'pistol', reserve: 2 }]]);
    emptyMag(); reload(); // reserve 0, mag 2
    expect(seen).toHaveLength(1);
    w.fire(); for (let k = 0; k < 12; k++) w.update(DT);
    w.fire(); for (let k = 0; k < 12; k++) w.update(DT);
    expect(w.ammo).toMatchObject({ mag: 0, reserve: 0 });
    expect(seen[1]).toEqual(['weapon:empty', { weapon: 'pistol' }]);
    w.fire(); w.fire();
    expect(seen).toHaveLength(2);
    // more ammo re-arms both
    w.addReserve(30);
    reload();
    emptyMag();
    reload(); // 30 - 12 - 12 = 6
    expect(seen.filter((s) => s[0] === 'weapon:low')).toHaveLength(2);
  });

  it('the pistol payloads keep their original fields and gain pellets, upgraded and dir', () => {
    const m = mockG({ zHit: { id: 9, part: 'torso', pos: [0, 1.7, -8], dist: 8 } });
    const w = createWeapon(m.G, { createView: () => null });
    w.fire();
    const fire = m.log[0][1];
    expect(Object.keys(fire).sort()).toEqual(['dir', 'pellets', 'pos', 'suppressed', 'upgraded', 'weapon']);
    expect(fire).toMatchObject({ weapon: 'pistol', pellets: 1, upgraded: false, suppressed: false });
    const hz = m.log[1][1];
    expect(hz).toMatchObject({ id: 9, part: 'torso', damage: 40, killed: false, headshot: false, weapon: 'pistol' });
    expect(Math.hypot(hz.dir.x, hz.dir.y, hz.dir.z)).toBeCloseTo(1);
    expect(hz.dir).toEqual(fire.dir);
  });
});
