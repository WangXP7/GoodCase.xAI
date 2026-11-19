// The weapon view itself (viewmodel.js), built headless: event timing against each weapon's Def, a
// zero time step, and the interruptions that used to move the gun in one frame (a reload cancelled,
// a shot during a shell reload, a switch in the middle of a reload). Poses come from view.probe:
// what the last frame drew, before recoil and sway.
import { describe, it, expect, beforeAll } from 'vitest';
import { Scene, PerspectiveCamera, MeshBasicMaterial, Vector3 } from 'three';
import { createWeaponView } from '../src/weapon/viewmodel.js';
import { tuning } from '../src/game/tuning.js';
import * as RIG from '../src/weapon/rig.js';

const W = tuning.weapons.table;
const DT = 1 / 60;

function makeG() {
  const mat = () => new MeshBasicMaterial();
  const rng = { next: () => 0.5, range: (a, b) => (a + b) / 2, fork: () => rng };
  return {
    params: {}, rng, scene: new Scene(), camera: new PerspectiveCamera(70, 16 / 9, 0.05, 400),
    mats: { gunmetal: mat, chrome: mat, rubber: mat, emissive: mat, cloth: mat, bakeRest: () => {} },
    // a weapon the view reads its state from (the arsenal's shape, as far as the view looks)
    weapon: { id: 'pistol', def: W.pistol, mods: { reloadScale: 1 }, reloading: false, melee: 'knife', ammo: { mag: 1 } },
  };
}

let G, view;
const hold = (id) => { G.weapon.id = id; G.weapon.def = W[id]; G.weapon.reloading = false; view.use(id); view.release(); settleDown(0.6); };
function settleDown(secs) { for (let t = 0; t < secs; t += DT) view.update(DT); }
const snap = () => { const p = view.probe; return { pos: Array.from(p.pos), rot: Array.from(p.rot), left: p.left.toArray(), state: { ...p.state } }; };
// the largest change between two consecutive frames: metres (gun and support hand), radians, and any model state
function delta(a, b) {
  let pos = 0, rot = 0, left = 0, state = 0;
  for (let i = 0; i < 3; i++) { pos = Math.max(pos, Math.abs(a.pos[i] - b.pos[i])); rot = Math.max(rot, Math.abs(a.rot[i] - b.rot[i])); left = Math.max(left, Math.abs(a.left[i] - b.left[i])); }
  for (const k of ['crane', 'rod', 'cover']) if (k in a.state && k in b.state) state = Math.max(state, Math.abs(a.state[k] - b.state[k]));
  return { pos, rot, left, state };
}
// run `secs`, calling at(frame) before each update; returns the per-frame changes
function run(secs, at) {
  const frames = [];
  let prev = snap();
  const n = Math.round(secs / DT);
  for (let f = 0; f < n; f++) {
    if (at) at(f);
    view.update(DT);
    const now = snap();
    frames.push(delta(prev, now));
    prev = now;
  }
  return frames;
}
// Two tests on every frame. A ceiling: nothing in the rig moves the gun faster than 4.8 m/s or
// 27 rad/s (the fastest thing it does is put a weapon away in 0.2 s), or a crane or ejector rod
// faster than fully in 2.5 frames. And no spike: a frame that moves more than FLOOR and more than
// three times as far as both the frame before and the frame after is a pop, not motion. The pops
// this guards against were 7 cm and 25 degrees in a single frame from rest, and a crane going from
// open to shut in one.
const CEIL = { pos: 0.08, rot: 0.45, left: 0.22, state: 0.4 };
const FLOOR = { pos: 0.012, rot: 0.06, left: 0.03, state: 0.2 };
// the middle of the view a sprinting player must see through: the central 30 % of the width and of the height
const CENTRE = [0.3, 0.3];
function within(frames, keys = Object.keys(CEIL)) {
  for (let i = 0; i < frames.length; i++) {
    for (const k of keys) {
      const d = frames[i][k];
      expect(d, `${k} at frame ${i}`).toBeLessThan(CEIL[k]);
      const a = i > 0 ? frames[i - 1][k] : 0, b = i + 1 < frames.length ? frames[i + 1][k] : 0;
      expect(d > FLOOR[k] && d > 3 * Math.max(a, b), `${k} spike of ${d.toFixed(4)} at frame ${i} (before ${a.toFixed(4)}, after ${b.toFixed(4)})`).toBe(false);
    }
  }
}

beforeAll(() => {
  G = makeG();
  view = createWeaponView(G);
  G.weapon.view = view;
}, 120000);

describe('event timing', () => {
  it('a magazine reload fires magOut, magIn, slideRelease and done at the plan\'s times', () => {
    for (const id of ['pistol', 'smg', 'revolver']) {
      hold(id);
      const plan = RIG.reloadPlan(W[id]);
      const seen = {};
      const offs = ['magOut', 'magIn', 'slideRelease', 'done'].map((e) => view.events.on(e, () => { if (!(e in seen)) seen[e] = t; }));
      let t = 0;
      view.play('empty');
      const secs = view.play('reload');
      expect(secs).toBeCloseTo(plan.total, 6);
      for (; t < plan.total + 0.2; t += DT) view.update(DT);
      offs.forEach((off) => off());
      for (const e of ['magOut', 'magIn', 'slideRelease', 'done']) {
        expect(seen[e], `${id} ${e}`).toBeDefined();
        expect(Math.abs(seen[e] - plan.at[e]), `${id} ${e}`).toBeLessThan(2 * DT + 1e-9);
      }
      expect(view.anim).toBe(null);
    }
  });
  it('a shell reload seats one shell per period and stops when the weapon stops reloading', () => {
    hold('pump');
    const plan = RIG.reloadPlan(W.pump);
    const at = [];
    let t = 0, done = false;
    const off = view.events.on('shellIn', () => { at.push(t); if (at.length === 3) G.weapon.reloading = false; });
    const off2 = view.events.on('done', () => { done = true; });
    G.weapon.reloading = true;
    view.play('reload');
    for (; t < plan.shellAt(2) + 1.2; t += DT) view.update(DT);
    off(); off2();
    expect(at.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(Math.abs(at[i] - plan.shellAt(i))).toBeLessThan(2 * DT + 1e-9);
    expect(done).toBe(true);
    expect(view.anim).toBe(null);
  });
  it('a zero time step changes nothing and fires nothing', () => {
    hold('pistol');
    view.play('reload');
    settleDown(0.5);
    let fired = 0;
    const offs = ['magOut', 'magIn', 'slideRelease', 'done'].map((e) => view.events.on(e, () => { fired++; }));
    const a = snap();
    for (let i = 0; i < 20; i++) view.update(0);
    view.update(NaN);
    const d = delta(a, snap());
    offs.forEach((off) => off());
    expect(fired).toBe(0);
    expect(d.pos + d.rot + d.left + d.state).toBe(0);
    settleDown(1.5);
  });
  it('durations follow the Def', () => {
    hold('smg');
    expect(view.durations.reload).toBeCloseTo(W.smg.reload, 9);
    expect(view.durations.fire).toBeCloseTo(60 / W.smg.rpm, 9);
    expect(view.durations.draw).toBe(RIG.durationsFor(W.smg).draw);
  });
});

describe('no interruption moves anything in one frame', () => {
  it('a reload played through', () => {
    for (const id of ['pistol', 'revolver', 'smg']) { hold(id); view.play('empty'); view.play('reload'); within(run(W[id].reload + 0.4)); }
  });
  it('a reload cancelled at any point (the revolver\'s crane eases shut)', () => {
    for (const id of ['pistol', 'revolver', 'smg']) {
      for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        hold(id);
        view.play('reload');
        const cut = Math.round((W[id].reload * frac) / DT);
        const w = run(W[id].reload * frac + 0.6, (f) => { if (f === cut) view.play('draw'); });
        within(w);
        expect(view.probe.state.crane || 0).toBeLessThan(1e-6);
      }
    }
  });
  it('a switch in the middle of a reload', () => {
    for (const [from, to] of [['pistol', 'smg'], ['revolver', 'pump'], ['smg', 'pistol'], ['pump', 'revolver']]) {
      for (const frac of [0.25, 0.6]) {
        hold(from);
        G.weapon.reloading = true;
        view.play('reload');
        const cut = Math.round(((W[from].reloadKind === 'shell' ? 1.2 : W[from].reload) * frac) / DT);
        const w = run(cut * DT + 1.4, (f) => { if (f === cut) { G.weapon.reloading = false; G.weapon.id = to; G.weapon.def = W[to]; view.setWeapon(to, {}); } });
        within(w);
        expect(view.weapon).toBe(to);
      }
    }
  });
  it('a shot during a shell reload', () => {
    hold('pump');
    G.weapon.reloading = true;
    view.play('reload');
    const cut = Math.round(0.8 / DT);
    // the shot's recoil is a spring on top of the pose; the pose under it must not jump
    // (the support hand rides the gun, so the shot's recoil moves it: judged on the gun's pose alone)
    within(run(1.6, (f) => { if (f === cut) { G.weapon.reloading = false; view.play('fire'); } }), ['pos', 'rot', 'state']);
  });
  it('a swing, a throw and a second switch started over a switch', () => {
    hold('smg');
    within(run(1.6, (f) => { if (f === 3) view.setWeapon('pump', {}); if (f === 12) view.play('swing'); if (f === 30) view.setWeapon('pistol', {}); if (f === 50) view.play('throw'); }));
  });
});

describe('the flame of a shot that interrupts a shell reload', () => {
  it('is never drawn with the bore more than 10 degrees from where the gun is aimed, and is drawn', () => {
    for (const dt of [1 / 60, 1 / 30, 1 / 144]) {
      for (const at of [0.12, 0.3, 0.8, 1.15]) {
        hold('pump');
        G.weapon.reloading = true;
        view.play('reload');
        for (let t = 0; t < at; t += dt) view.update(dt);
        expect(view.probe.boreOff, 'the loading pose is turned away').toBeGreaterThan(at > 0.2 ? 0.2 : 0.05);
        G.weapon.reloading = false;
        view.play('fire');
        let shown = 0, first = -1;
        for (let t = 0, f = 0; t < 0.3; t += dt, f++) {
          view.update(dt);
          const p = view.probe;
          if (p.flame) { shown++; if (first < 0) first = t + dt; expect(p.boreOff, `dt ${dt.toFixed(4)} at ${at} frame ${f}`).toBeLessThan((10 * Math.PI) / 180); expect(p.blend, 'and the gun has all but arrived').toBeLessThan(0.3); }
        }
        expect(shown, `flame drawn (dt ${dt.toFixed(4)}, at ${at})`).toBeGreaterThan(0);
        expect(first, 'and within 0.08 s of the shot').toBeLessThan(0.08);
      }
    }
  });
  it('a shot from the hip shows its flame on the first frame', () => {
    hold('pump');
    view.play('fire');
    view.update(DT);
    expect(view.probe.flame).toBe(true);
    settleDown(0.8);
  });
});

describe('sprinting with a long gun', () => {
  it('keeps the gun and the support hand on screen and out of the middle of the view', () => {
    const v = new Vector3(), o = new Vector3();
    for (const id of ['pump', 'smg']) {
      hold(id);
      for (const t of [0, 0.3, 0.9]) {
        view.stage('sprint', t);
        const A = view.model.anchors;
        let onScreen = 0, n = 0;
        // the gun as a box of points from the muzzle to the back of the receiver
        for (let i = 0; i <= 24; i++) for (const x of [-0.02, 0.02]) for (const y of [-0.05, 0.025]) {
          view.screen(v.set(x, y, A.muzzle.z + (0.04 - A.muzzle.z) * (i / 24)), o);
          n++;
          if (Math.abs(o.x) < 1 && Math.abs(o.y) < 1) onScreen++;
          expect(Math.abs(o.x) < CENTRE[0] && Math.abs(o.y) < CENTRE[1], `${id} t ${t}: gun point ${i} at ${o.x.toFixed(2)}, ${o.y.toFixed(2)}`).toBe(false);
        }
        expect(onScreen / n, `${id}: share of the gun in frame`).toBeGreaterThan(0.25);
        expect(Math.max(o.x, 0)).toBeGreaterThan(0); // the receiver end is on the right
        const L = view.probe.left; // view space: project by hand (fov 55, the hip lens)
        const k = 1 / Math.tan((55 * Math.PI) / 360), aspect = G.camera.aspect;
        const lx = (L.x * k) / aspect / -L.z, ly = (L.y * k) / -L.z;
        expect(Math.abs(lx) < CENTRE[0] && Math.abs(ly) < CENTRE[1], `${id}: support hand at ${lx.toFixed(2)}, ${ly.toFixed(2)}`).toBe(false);
      }
      view.release();
    }
  });
});

describe('refresh', () => {
  it('attachments reach the model without a switch, and come off again', () => {
    hold('smg');
    const m = view.model;
    const sight0 = m.anchors.sight.y, muzzle0 = m.anchors.muzzle.z;
    expect(view.refresh('smg', { upgraded: false, attachments: new Set(['sight', 'suppressor', 'mag', 'grip']) })).toBe(true);
    expect(m.parts.att_sight.visible).toBe(true);
    expect(m.parts.att_suppressor.visible).toBe(true);
    expect(m.anchors.sight.y).toBeGreaterThan(sight0);
    expect(m.anchors.muzzle.z).toBeLessThan(muzzle0);
    view.refresh('smg', { upgraded: false, attachments: new Set() });
    expect(m.parts.att_sight.visible).toBe(false);
    expect(m.anchors.sight.y).toBeCloseTo(sight0, 9);
    expect(m.anchors.muzzle.z).toBeCloseTo(muzzle0, 9);
  });
  it('every weapon takes the upgraded finish: its steel and its furniture are marked, and it comes off again', () => {
    for (const id of Object.keys(W)) {
      const m = view.entry(id).model;
      view.refresh(id, { upgraded: true, attachments: new Set() });
      expect(m.upgraded, id).toBe(true);
      const kinds = new Set();
      for (const mesh of m.meshes) { const u = mesh.material.vmUp; if (u && u.value > 0) kinds.add(u.value); }
      expect(kinds.size, `${id}: materials the finish is drawn on`).toBeGreaterThanOrEqual(1);
      expect(kinds.has(1) || kinds.has(3), `${id}: steel or a moulded body`).toBe(true);
      view.refresh(id, { upgraded: false, attachments: new Set() });
      expect(m.upgraded, id).toBe(false);
    }
  });
  it('an upgrade bought with the weapon in the hands shows at once, as a transformation under a second long that moves nothing in one frame', () => {
    for (const id of ['pistol', 'pump', 'lmg']) {
      hold(id);
      view.refresh(id, { upgraded: false, attachments: new Set() });
      expect(view.upgraded).toBe(false);
      expect(view.morph).toBe(null);
      let frames;
      frames = run(1.0, (f) => { if (f === 2) { view.refresh(id, { upgraded: true, attachments: new Set() }); expect(view.upgraded).toBe(true); expect(view.morph).toBe(0); } });
      within(frames);
      expect(view.morph, `${id}: over within a second`).toBe(null);
      expect(view.upgraded).toBe(true);
      expect(view.busy, `${id}: no animation holds the weapon`).toBe(false);
      // the same weapon handed back stock: no transformation
      view.refresh(id, { upgraded: false, attachments: new Set() });
      expect(view.morph).toBe(null);
    }
  });
  it('each upgraded weapon has its own colours, tracer and flame', async () => {
    const { UPGRADE_LOOK, upgradeLook, TRACER_COLOR } = await import('../src/weapon/models/upgrade.js');
    const seen = new Set();
    for (const id of Object.keys(W)) {
      const L = UPGRADE_LOOK[id];
      expect(L, id).toBeTruthy();
      expect(L.tracer.length).toBe(3); expect(L.flash.length).toBe(2);
      seen.add(L.a.join());
    }
    expect(seen.size).toBe(Object.keys(W).length);
    expect(upgradeLook('pump').tracer).toBe(UPGRADE_LOOK.pump.tracer);
    expect(upgradeLook(undefined).tracer).toEqual(TRACER_COLOR.violet); // a round whose weapon is not known
  });
  it('every built model answers attach for every kind without throwing', () => {
    for (const id of ['pistol', 'revolver', 'pump', 'smg']) {
      const m = view.entry(id).model;
      for (const kind of tuning.weapons.attachments.kinds) { expect(typeof m.attach(kind, true)).toBe('boolean'); m.attach(kind, false); }
    }
  });
});
