// The diner and motel art layer: parts with bounds that are culled, installAreaArt and
// layer.update safe to call twice, optional dressing that follows the tier, searchables that
// visibly open, boards and glass in one draw call each with no shadow pass.
import { describe, it, expect, beforeAll } from 'vitest';
import { Group, InstancedMesh, MeshBasicMaterial } from 'three';
import { createRng } from '../src/core/rng.js';
import { createAtlas } from '../src/level/atlas.js';
import { buildWorld } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';
import { installAreaArt } from '../src/mats/interior.js';

let G, layer, levelUpdates = 0;
const listeners = [];

beforeAll(() => {
  const rng = createRng(7);
  const built = buildWorld({ rng: rng.fork('level'), atlas: createAtlas(rng.fork('atlas')) });
  const root = new Group();
  const groups = {};
  const plain = new MeshBasicMaterial();
  for (const zone of ['forecourt', 'shell', 'diner', 'motel', 'garage']) { groups[zone] = new Group(); root.add(groups[zone]); }
  for (const [zone, recs] of built.B.instances) {
    for (const rec of recs.values()) {
      const im = new InstancedMesh(rec.geometry, plain, rec.matrices.length);
      rec.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.frustumCulled = false; // as world.js makes them
      (groups[zone] || root).add(im);
    }
  }
  const level = {
    root, groups, props: {}, shots: {}, power: { on: false },
    windows: W.windows.map((w) => ({ ...w, boards: 6, max: 6 })),
    doors: W.doors.map((d) => ({ id: d.id, open: false })),
    update() { levelUpdates++; },
  };
  G = {
    level, scene: {}, params: {}, lights: null, rng: createRng(3), mats: { noise: null },
    time: { t: 0, frame: 0, dt: 1 / 60 },
    quality: { propDensity: 1, onChange(fn) { listeners.push(fn); } },
  };
  layer = installAreaArt(G);
}, 60000); // builds the whole level and bakes both zones' light: seconds on a busy machine

describe('area art layer', () => {
  it('installs once: a second call returns the same layer and wraps nothing again', () => {
    const update = G.level.update;
    expect(installAreaArt(G)).toBe(layer);
    expect(G.level.update).toBe(update);
    expect(typeof layer.update).toBe('function');
  });

  it('every part of both zones has its own bounds and is frustum-culled', () => {
    for (const zone of ['diner', 'motel']) {
      const meshes = layer.meshes[zone];
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        expect(m.frustumCulled).toBe(true);
        expect(m.boundingSphere.radius).toBeGreaterThan(1);
        expect(m.boundingSphere.radius).toBeLessThan(45);
        expect(m.castShadow).toBe(false);
      }
    }
    expect(layer.meshes.motel.length).toBeGreaterThan(1); // the lot and the rooms are separate pieces
  });

  it('runs once a frame however many callers there are', () => {
    let runs = 0;
    layer.updaters.push(() => { runs++; });
    G.time.frame = 10; G.time.t = 1;
    G.level.update(); layer.update(); layer.update(); G.level.update();
    expect(runs).toBe(1);
    G.time.frame = 11; G.time.t = 1.016;
    layer.update(); G.level.update();
    expect(runs).toBe(2);
    expect(levelUpdates).toBe(3); // the level's own update is still called every time
    layer.updaters.pop();
  });

  it('powered light groups are dark until the power is on', () => {
    const g = layer.mats.groups;
    const used = layer.recs.reduce((n, r) => n + r.groups.length - 1, 0);
    const powered = () => { let s = 0; for (let o = 4; o < 4 + used * 4; o += 4) s += g[o + 1] + g[o + 3]; return s; };
    G.level.power.on = false; G.time.frame++; layer.update();
    expect(powered()).toBe(0);
    G.level.power.on = true; G.time.frame++; layer.update();
    expect(powered()).toBeGreaterThan(10);
    G.level.power.on = false;
  });

  it('optional dressing follows the tier whenever it changes', () => {
    const parts = layer.recs.flatMap((r) => r.parts);
    expect(listeners.length).toBe(1);
    for (const p of parts) expect(p.geometry.drawRange.count).toBe(p.total);
    G.quality.propDensity = 0.5; listeners[0]();
    let cut = 0;
    for (const p of parts) {
      expect(p.geometry.drawRange.count).toBeGreaterThanOrEqual(p.coreCount);
      expect(p.geometry.drawRange.count % 3).toBe(0);
      cut += p.total - p.geometry.drawRange.count;
    }
    expect(cut).toBeGreaterThan(3000);
    G.quality.propDensity = 1; listeners[0]();
    for (const p of parts) expect(p.geometry.drawRange.count).toBe(p.total);
  });

  it('the till visibly opens when searched and shuts again on reset', () => {
    const till = W.searchables.find((s) => s.id === 's-till');
    const prop = G.level.props[till.prop];
    expect(prop).toBeTruthy();
    const pos = layer.recs.find((r) => r.zone === 'diner').parts[0].geometry.getAttribute('position');
    const before = Float32Array.from(pos.array);
    prop.setSearched(true);
    let moved = 0, far = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.array[i * 3] - before[i * 3], pos.array[i * 3 + 1] - before[i * 3 + 1], pos.array[i * 3 + 2] - before[i * 3 + 2]);
      if (d > 1e-6) moved++;
      if (d > 0.3) far++;
    }
    expect(moved).toBeGreaterThan(100);
    expect(far).toBeGreaterThan(50); // the drawer comes more than 0.3 m out
    prop.setSearched(false);
    let off = 0;
    for (let i = 0; i < pos.array.length; i++) off = Math.max(off, Math.abs(pos.array[i] - before[i]));
    expect(off).toBeLessThan(1e-4);
  });

  it('every searchable of the two zones that is drawn in the art has an opening part', () => {
    const drawn = W.searchables.filter((s) => (s.zone === 'diner' || s.zone === 'motel') && !/car/.test(s.id));
    for (const s of drawn) expect(G.level.props[s.prop], s.id).toBeTruthy();
  });

  it('boards and glass are one mesh each and neither casts a shadow', () => {
    const boarded = W.windows.filter((w) => w.zone === 'diner' || w.zone === 'motel').length;
    expect(layer.boards.count).toBe(boarded * 6);
    expect(layer.boards.castShadow).toBe(false);
    expect(layer.glass.castShadow).toBe(false);
    expect(layer.glass.material.transparent).toBe(true);
    expect(layer.glass.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(4 * 20);
  });
});
