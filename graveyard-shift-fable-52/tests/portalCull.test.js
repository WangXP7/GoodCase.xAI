// Portal culling (world.js createPortalCull): from inside an enclosed room only what shows through
// its openings is drawn; what is left out stays in the shadow passes (SHADOW_LAYER).
import { describe, it, expect } from 'vitest';
import { Scene, Group, Mesh, SkinnedMesh, BoxGeometry, MeshBasicMaterial, PerspectiveCamera, SpotLight } from 'three';
import { createPortalCull, SHADOW_LAYER } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';

const mat = new MeshBasicMaterial();
function boxAt(name, x, y, z, s = 1) {
  const m = new Mesh(new BoxGeometry(s, s, s), mat);
  m.name = name; m.position.set(x, y, z); m.updateMatrixWorld(true);
  return m;
}
function setup() {
  const scene = new Scene();
  const root = new Group(); root.name = 'world'; scene.add(root);
  const zone = new Group(); zone.name = 'zone'; root.add(zone);
  const meshes = {
    dinerTable: boxAt('dinerTable', 16, 0.5, -26),
    lotPump: boxAt('lotPump', 12.2, 0.8, -14), // straight out of the front door, d1
    motelCar: boxAt('motelCar', 45, 0.7, -20), // the motel lot, behind the diner's east wall
    behindStore: boxAt('behindStore', 0, 1, -26), // west of the diner, beyond a solid wall
  };
  for (const m of Object.values(meshes)) zone.add(m);
  const shadowProxy = boxAt('shadow', 45, 1, -20, 4); zone.add(shadowProxy);
  const spot = new SpotLight(); spot.castShadow = true; scene.add(spot);
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 500);
  scene.add(camera);
  const G = { scene, camera };
  const level = { root };
  const cull = createPortalCull(G, level);
  const look = (x, y, z, yaw, pitch = 0) => {
    camera.position.set(x, y, z); camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, yaw, 0);
    camera.updateMatrixWorld(true);
    cull.update(camera);
  };
  const drawn = (m) => (m.layers.mask & 1) === 1;
  return { scene, camera, cull, look, drawn, meshes, shadowProxy, spot };
}

describe('enclosed cells (worldLayout.cells)', () => {
  it('the diner, every motel room and office, and the garage bays are cells', () => {
    const ids = W.cells.map((c) => c.id);
    expect(ids).toContain('diner');
    expect(ids).toContain('bays');
    for (const r of W.rooms) expect(ids).toContain(`room-${r.id}`);
  });
  it('every opening sits on its cell box (within a wall thickness), and every door and window of the room is one', () => {
    for (const c of W.cells) {
      for (const p of c.portals) {
        for (let k = 0; k < 3; k++) {
          expect(p.max[k]).toBeGreaterThan(c.box.min[k] - 0.35);
          expect(p.min[k]).toBeLessThan(c.box.max[k] + 0.35);
        }
      }
    }
    const diner = W.cells.find((c) => c.id === 'diner');
    expect(diner.portals.length).toBe(2 + W.windows.filter((w) => w.zone === 'diner').length); // d1, d2, the back windows
    const n1 = W.cells.find((c) => c.id === 'room-n1');
    expect(n1.portals.length).toBe(2); // door and boarded window
    const bays = W.cells.find((c) => c.id === 'bays');
    expect(bays.portals.length).toBe(3 + W.rollers.filter((r) => r.gap > 0).length);
  });
});

describe('createPortalCull', () => {
  it('inside the diner facing a solid wall: what is beyond is left out of the view, kept for shadows', () => {
    const t = setup();
    t.look(16, 1.7, -26, Math.PI / 2); // facing west: the store wall
    expect(t.cull.stats.cell).toBe('diner');
    expect(t.drawn(t.meshes.dinerTable)).toBe(true);
    expect(t.drawn(t.meshes.motelCar)).toBe(false);
    expect(t.drawn(t.meshes.behindStore)).toBe(false);
    expect(t.meshes.motelCar.layers.isEnabled(SHADOW_LAYER)).toBe(true);
    // the shadow proxy is never culled, and the shadow cameras see the culled layer
    expect(t.drawn(t.shadowProxy)).toBe(true);
    expect(t.spot.shadow.camera.layers.isEnabled(SHADOW_LAYER)).toBe(true);
  });
  it('facing an opening: what shows through it is drawn, what is behind the camera is not', () => {
    const t = setup();
    t.look(12.2, 1.7, -24, Math.PI); // facing south, out through d1
    expect(t.cull.stats.portals).toBeGreaterThan(0);
    expect(t.drawn(t.meshes.lotPump)).toBe(true);
    expect(t.drawn(t.meshes.behindStore)).toBe(false);
  });
  it('an opening just off screen counts (the guard band): turning toward it never pops', () => {
    const t = setup();
    // d1 is about 50 degrees to the left of the view's edge here; the pump is drawn before d1 enters the view
    let firstDrawn = null, firstSeen = null;
    for (let deg = 0; deg <= 180; deg += 1) {
      t.look(12.2, 1.7, -24, Math.PI / 2 + (deg * Math.PI) / 180);
      if (firstDrawn === null && t.drawn(t.meshes.lotPump)) firstDrawn = deg;
      // the pump on screen: inside the camera's own frustum
      const v = t.meshes.lotPump.position.clone().project(t.camera);
      if (firstSeen === null && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) firstSeen = deg;
    }
    expect(firstSeen).not.toBe(null);
    expect(firstDrawn).not.toBe(null);
    expect(firstDrawn).toBeLessThan(firstSeen);
  });
  it('outside every cell nothing is culled, and leaving a cell puts everything back', () => {
    const t = setup();
    t.look(16, 1.7, -26, Math.PI / 2);
    expect(t.drawn(t.meshes.motelCar)).toBe(false);
    t.look(40, 1.7, -20, 0); // the motel lot: open air
    expect(t.cull.stats.cell).toBe(null);
    for (const m of Object.values(t.meshes)) expect(t.drawn(m)).toBe(true);
  });
  it('bodies: one outside the room behind a wall is left out of the view, one inside is drawn', () => {
    const t = setup();
    const geo = new BoxGeometry(0.5, 1.8, 0.5);
    const out = new SkinnedMesh(geo, mat); out.name = 'zombie:a'; out.position.set(45, 0, -20); t.scene.add(out);
    const twin = new SkinnedMesh(geo, mat); twin.name = 'zombie:depth'; out.add(twin);
    const inside = new SkinnedMesh(geo, mat); inside.name = 'zombie:b'; inside.position.set(18, 0, -27); t.scene.add(inside);
    t.scene.updateMatrixWorld(true);
    t.look(16, 1.7, -26, Math.PI / 2);
    expect(t.drawn(out)).toBe(false);
    expect(t.drawn(twin)).toBe(false);
    expect(out.layers.isEnabled(SHADOW_LAYER)).toBe(true); // still casts
    expect(t.drawn(inside)).toBe(true);
    t.cull.enabled = false;
    t.look(16, 1.7, -26, Math.PI / 2);
    expect(t.drawn(out)).toBe(true);
    expect(t.drawn(twin)).toBe(true);
  });
});
