// The power-up drops, the weapon display the box shows, and the upgrade station, without a renderer.
import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { createEvents } from '../src/core/events.js';
import { CHANNELS, createObj, resetChannels } from '../src/mats/yard.js';
import { powerupGeometry, POWERUP_KINDS, POWERUP_COLOR } from '../src/level/objects/powerup.js';
import { buildPickup, buildPowerup, installLoot } from '../src/level/objects/pickup.js';
import { bakeModel, createGunDisplay } from '../src/level/objects/gunDisplay.js';
import { placeBench } from '../src/level/objects/bench.js';
import { tuning } from '../src/game/tuning.js';

const mats = () => ({ object: new MeshStandardMaterial(), gain: new Float32Array(CHANNELS), lift: { value: 0 } });
const size = (g) => { g.computeBoundingBox(); const b = g.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]; };

describe('power-up drops', () => {
  it('has a shape and a colour for every kind the game drops', () => {
    expect(POWERUP_KINDS).toEqual(tuning.economy.powerups.kinds);
    for (const k of POWERUP_KINDS) expect(POWERUP_COLOR[k], k).toHaveLength(3);
  });
  it('each kind is a different outline, between 0.4 and 1 m tall, and glows on the channel given', () => {
    const ratios = [];
    for (const k of POWERUP_KINDS) {
      const g = powerupGeometry(k, 7);
      const [w, h] = size(g);
      expect(h, k).toBeGreaterThan(0.4); expect(h, k).toBeLessThan(1.0);
      ratios.push(w / h);
      const gl = g.getAttribute('aGlow');
      let lit = 0, hot = 0;
      for (let i = 0; i < gl.count; i++) { const m = Math.max(gl.getX(i), gl.getY(i), gl.getZ(i)); if (m > 0) { lit++; expect(gl.getW(i)).toBe(7); } if (m > 3.5) hot++; }
      expect(lit / gl.count, k).toBeGreaterThan(0.5); // most of it gives light
      expect(hot, k).toBeGreaterThan(0); // and some of it is bright trim
      expect(g.getIndex().count / 3, k).toBeLessThan(2600); // triangles
    }
    // no two kinds share proportions (wide tin, tall cartridge in a ring, round watch, pot and flame)
    for (let i = 0; i < ratios.length; i++) for (let j = i + 1; j < ratios.length; j++) expect(Math.abs(ratios[i] - ratios[j]), `${POWERUP_KINDS[i]} / ${POWERUP_KINDS[j]}`).toBeGreaterThan(0.08);
  });
  it('the strongest colour of each kind is its own', () => {
    const top = (c) => c.indexOf(Math.max(...c));
    expect(POWERUP_KINDS.map((k) => top(POWERUP_COLOR[k]))).toEqual([1, 0, 2, 0]); // green, red, blue, and a red-led orange
    expect(POWERUP_COLOR.flashover[1]).toBeGreaterThan(POWERUP_COLOR.oneTap[1] * 4); // the orange is far from the red
  });
  it('grows in, holds steady, then blinks faster and faster through its last seconds', () => {
    resetChannels();
    const m = mats();
    const p = buildPowerup(m);
    p.setKind('doubleTime'); p.appear();
    let t = 0;
    const run = (secs, ttl) => { const seen = []; for (let i = 0; i < Math.round(secs * 60); i++) { t += 1 / 60; p.update(1 / 60, t, ttl(i / 60)); seen.push(m.gain[p.channel]); } return seen; };
    const first = run(0.1, () => 20);
    expect(first[0]).toBeLessThan(0.3); // not there all at once
    run(0.5, () => 20);
    const steady = run(2, () => 20);
    expect(Math.min(...steady)).toBeGreaterThan(0.7);
    const flips = (a) => a.reduce((n, v, i) => n + (i > 0 && (v > 0.4) !== (a[i - 1] > 0.4) ? 1 : 0), 0);
    const early = run(2, (s) => 6 - s), late = run(2, (s) => 2 - s);
    expect(flips(early)).toBeGreaterThanOrEqual(4);
    expect(flips(late)).toBeGreaterThan(flips(early) * 1.5);
  });
  it('a drop that is walked over bursts; one that lapses or is cleared does not', () => {
    resetChannels();
    const events = createEvents();
    let emitted = 0;
    const drops = [];
    const G = { events, fx: { emit() { emitted++; } }, game: { powerups: { drops } } };
    const loot = installLoot(G, mats(), { root: new Group() });
    const frame = (t) => loot.update(1 / 60, t);
    drops.push({ id: 1, kind: 'resupply', pos: { x: 1, y: 0, z: 2 }, ttl: 20 }, { id: 2, kind: 'oneTap', pos: { x: 4, y: 0, z: 2 }, ttl: 20 });
    frame(0.1);
    expect(loot.drops.filter((d) => d.group.visible).map((d) => d.kind).sort()).toEqual(['oneTap', 'resupply']);
    // the first is taken: the other keeps its slot and its place
    const slot2 = loot.drops.find((d) => d.kind === 'oneTap');
    drops.splice(0, 1); events.emit('powerup:take', { kind: 'resupply', seconds: 0 });
    frame(0.12);
    expect(emitted).toBeGreaterThan(8);
    expect(slot2.group.visible).toBe(true);
    expect(slot2.group.position.x).toBe(4);
    expect(loot.drops.filter((d) => d.group.visible)).toHaveLength(1);
    // the second lapses: nothing
    const before = emitted;
    drops.splice(0, 1); events.emit('powerup:lapse', { id: 2, kind: 'oneTap' });
    frame(1.0);
    expect(emitted).toBe(before);
    expect(loot.drops.some((d) => d.group.visible)).toBe(false);
    // a new game clears the list: nothing either
    drops.push({ id: 3, kind: 'flashover', pos: { x: 0, y: 0, z: 0 }, ttl: 20 });
    frame(2.0); drops.length = 0; frame(2.02);
    expect(emitted).toBe(before);
  });
});

describe('weapon display', () => {
  const model = () => {
    const root = new Group();
    const steel = new MeshStandardMaterial();
    steel.userData.surfDef = { kind: 'gunmetal' }; steel.surf = { uGFinish: { value: 1 } };
    const body = new Mesh(new BoxGeometry(0.04, 0.12, 0.8, 8, 8, 40), steel);
    body.position.set(0, 0.3, -0.5);
    const hidden = new Mesh(new BoxGeometry(1, 1, 1), steel); hidden.visible = false;
    const spare = new Group(); spare.add(new Mesh(new BoxGeometry(0.03, 0.1, 0.05), steel));
    const casing = new Mesh(new BoxGeometry(0.01, 0.01, 0.03), steel);
    root.add(body, hidden, spare, casing);
    return { root, spare, casing, materials: { steel } };
  };
  it('bakes what shows of a model into one centred mesh in the colours of its materials', () => {
    const b = bakeModel(model());
    expect(b.triangles).toBe(new BoxGeometry(1, 1, 1, 8, 8, 40).getIndex().count / 3); // the body only
    expect(b.length).toBeCloseTo(0.8, 5);
    const [w, h, l] = size(b.geometry);
    expect([w, h, l].map((v) => +v.toFixed(3))).toEqual([0.04, 0.12, 0.8]);
    b.geometry.computeBoundingBox();
    expect(b.geometry.boundingBox.min.z).toBeCloseTo(-0.4, 5); // centred
    const c = b.geometry.getAttribute('color');
    expect(c.getX(0)).toBeCloseTo(0.36, 2); // bare steel
  });
  it('the welded version keeps the shape with far fewer triangles', () => {
    const full = bakeModel(model()), lite = bakeModel(model(), 0.02);
    expect(lite.triangles).toBeLessThan(full.triangles * 0.5);
    expect(lite.triangles).toBeGreaterThan(20);
    const a = size(full.geometry), b = size(lite.geometry);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.025);
  });
  it('shows one weapon at a time and builds nothing it cannot', () => {
    const D = createGunDisplay({}, { ids: ['pump', 'smg'] });
    expect(D.show('pump')).toBeTruthy();
    expect(D.shown).toBe('pump');
    D.show('smg'); expect(D.shown).toBe('smg');
    D.show(null); expect(D.shown).toBe(null);
    expect(D.root.children).toHaveLength(0); // no materials to build from here: no meshes, no error
  });
});

describe('when the display models are built', () => {
  const built = (D) => D.ids.filter((id) => D.has(id)).length;
  it('one model a call while nobody plays; during play only while a roll wants them, one every 0.2 s', () => {
    const D = createGunDisplay({}, { ids: ['pump', 'smg', 'rifle', 'lmg', 'revolver'] });
    D.tick(1 / 60, false); expect(built(D)).toBe(1);
    D.tick(1 / 60, false); expect(built(D)).toBe(2);
    for (let i = 0; i < 120; i++) D.tick(1 / 60, true);
    expect(built(D)).toBe(2); // playing, no roll: nothing
    D.wanted = true; D.tick(1 / 60, true); expect(built(D)).toBe(3);
    for (let i = 0; i < 6; i++) { D.wanted = true; D.tick(1 / 60, true); }
    expect(built(D)).toBe(3); // 0.1 s later: not yet
    for (let i = 0; i < 8; i++) { D.wanted = true; D.tick(1 / 60, true); }
    expect(built(D)).toBe(4);
    expect(D.wanted).toBe(false); // a box has to ask again every frame
  });
  it('the boxes build nothing by standing there, however many there are, and a roll turns over what is built', async () => {
    resetChannels();
    const { placeBox } = await import('../src/level/objects/box.js');
    const { sharedGunDisplay } = await import('../src/level/objects/gunDisplay.js');
    const G = { time: { t: 0 }, level: { power: { on: false } }, events: { on() {} } };
    const O = createObj(), recs = [];
    const ctx = { B: { inZone: (z, fn) => fn(), at: (m, fn) => fn(), tag: (n, fn) => fn(), collide() {}, blob() {} }, stat: () => O, reg: (d) => recs.push(d) };
    for (let i = 0; i < 3; i++) placeBox(ctx, { id: `b${i}`, zone: 'stage', pos: [i * 5, 0, 0] }, 0);
    const m = mats();
    const boxes = recs.map((r) => r.make(G, m));
    const D = sharedGunDisplay(G);
    for (const b of boxes) b.setState('idle');
    for (let i = 0; i < 600; i++) for (const b of boxes) b.update(1 / 60, i / 60);
    expect(built(D)).toBe(0); // ten seconds of three boxes: no model built
    D.ensure('pump'); D.ensure('lmg');
    boxes[0].setState('rolling');
    const seen = new Set();
    for (let i = 0; i < 150; i++) { boxes[0].update(1 / 60, 10 + i / 60); seen.add(boxes[0].showing); }
    expect([...seen].sort()).toEqual(['lmg', 'pump']); // only what was there
    expect(built(D)).toBe(2); // and the roll itself built nothing
    expect(D.wanted).toBe(true); // it asked for the rest to be made
  });
});

describe('a weapon lying to be taken', () => {
  it('is the weapon itself when the display set has it, and its outline on a card when it has not', () => {
    resetChannels();
    const geo = new BoxGeometry(0.05, 0.2, 0.9);
    const display = {
      newMaterial: () => ({ material: new MeshStandardMaterial(), lift: { value: null } }),
      geometryOf: (id) => (id === 'rifle' ? geo : null),
      ensure: () => ({ length: 0.9 }),
    };
    const p = buildPickup(mats(), display);
    p.setItem('rifle'); p.update(1 / 60, 1);
    expect(p.real).toBe(true);
    expect(p.gun.visible).toBe(true); expect(p.card.visible).toBe(false);
    expect(p.gun.geometry).toBe(geo);
    expect(p.gun.scale.x * 0.9).toBeGreaterThan(0.9); // larger than life
    p.setItem('smg'); p.update(1 / 60, 1.1);
    expect(p.real).toBe(false);
    expect(p.gun.visible).toBe(false); expect(p.card.visible).toBe(true);
    const bare = buildPickup(mats());
    bare.setItem('rifle'); bare.update(1 / 60, 1);
    expect(bare.real).toBe(false); expect(bare.card.visible).toBe(true);
  });
});

describe('upgrade station', () => {
  const make = (power) => {
    resetChannels();
    let rec = null;
    const O = createObj();
    placeBench({ stat: () => O, reg: (d) => { rec = d; } }, { id: 'bench', zone: 'garage', pos: [55, 0, 12] }, -Math.PI / 2, 1);
    const events = createEvents();
    const m = mats();
    let sparks = 0;
    const G = { events, level: { power: { on: power } }, fx: { emit() { sparks++; } } };
    return { obj: rec.make(G, m), m, events, G, sparks: () => sparks, tris: O.geometry().getIndex().count / 3 };
  };
  it('is dead without the power and ready with it', () => {
    const off = make(false);
    off.obj.update(1 / 60, 1);
    expect(off.obj.state).toBe('dead');
    expect(Math.max(...off.m.gain)).toBe(0);
    const on = make(true);
    on.obj.update(1 / 60, 1);
    expect(on.obj.state).toBe('ready');
    expect(Math.max(...on.m.gain)).toBeGreaterThan(0.25);
    expect(on.tris).toBeLessThan(1400);
  });
  it('an upgrade is a short burst of arc and sparks, then it cools back to ready', () => {
    const s = make(true);
    s.obj.update(1 / 60, 1);
    const ready = Math.max(...s.m.gain);
    s.events.emit('bench:upgrade', { weapon: 'pistol' });
    expect(s.sparks()).toBeGreaterThan(20);
    let peak = 0, t = 1, frames = 0;
    while (s.obj.state !== 'working' || frames === 0) { t += 1 / 60; s.obj.update(1 / 60, t); frames++; if (frames > 2) break; }
    expect(s.obj.state).toBe('working');
    while (s.obj.state === 'working') { t += 1 / 60; s.obj.update(1 / 60, t); frames++; peak = Math.max(peak, ...s.m.gain); }
    expect(frames / 60).toBeLessThan(1.2); // brief
    expect(peak).toBeGreaterThan(ready * 4);
    for (let i = 0; i < 180; i++) { t += 1 / 60; s.obj.update(1 / 60, t); }
    expect(s.obj.state).toBe('ready');
    expect(Math.max(...s.m.gain)).toBeLessThan(ready * 1.6);
  });
});
