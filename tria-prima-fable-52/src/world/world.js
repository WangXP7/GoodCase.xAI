// The Isle of Morne assembled: land, water, grass, everything that stands on it.
import * as THREE from 'three';
import { generateTerrain } from './heightmap.js';
import { Terrain, createTerrainMaterial, bindTerrainTextures } from './terrain.js';
import { makeGroundTextures } from '../gfx/texgen.js';
import { Water } from '../gfx/water.js';
import { Grass } from '../gfx/grass.js';
import { FxMask } from '../gfx/fxmask.js';
import { CollisionWorld } from '../physics/collide.js';
import { createMaterials, Placed, Scatter } from './props.js';
import { populate } from './populate.js';
import { buildModel, hasModel } from '../models/index.js';
import '../models/extra.js';

export async function createWorld(engine, tick = async () => {}) {
  const world = new World(engine);
  await world.build(tick);
  return world;
}

export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.T = null;
    this.updaters = [];
    this.placed = [];
    this.named = {};
    this._cull = 0;
  }

  async build(tick) {
    const e = this.engine;
    await tick(0.02, 'Raising the island');
    this.T = await generateTerrain((p) => tick(0.02 + p * 0.2, 'Raising the island'));
    bindTerrainTextures(this.T);
    this.fx = new FxMask(e.renderer);
    await tick(0.24, 'Grinding stone');
    this.ground = makeGroundTextures(e.renderer, 512);
    await tick(0.3, 'Laying the land');
    this.terrain = new Terrain(this.T, createTerrainMaterial(this.ground));
    this.scene.add(this.terrain.group);
    await tick(0.34, 'Filling the sea');
    this.water = new Water(e, this.T);
    this.grass = new Grass(e);
    await tick(0.4, 'Raising the dead wood');
    this.mats = createMaterials();
    this.collision = new CollisionWorld();
    this.scatter = new Scatter(this.scene, this.mats);
    await populate(this, (p) => tick(0.4 + p * 0.5, 'Raising the dead wood'));
    this.scatter.build();
    this.scatter.update(e.camera.position, true);
    for (const s of this.spots.scorch) this.fx.stamp(s[0], s[1], s[2], 0, s[3]);
    await tick(0.92, 'Lighting the lamps');
  }

  /**
   * Stand one model in the world. Returns the Placed (or null if the model does not exist).
   * o: { seed, scale, opts (model options), collide (default true), tag (put on its colliders), far }
   */
  place(name, x, y, z, ry = 0, o = {}) {
    if (!hasModel(name)) return null;
    let model;
    try {
      model = buildModel(name, o.seed || 1, o.opts || null);
    } catch (err) {
      console.error('[world] ' + name + ' failed to build: ' + err.message);
      return null;
    }
    const p = new Placed(name, model, this.mats, x, y, z, ry, o.scale || 1);
    p.far = o.far || Math.min(1400, Math.max(110, 70 + Math.max(model.radius, model.size[1]) * (o.scale || 1) * 60));
    this.scene.add(p.object);
    if (o.collide !== false) p.addColliders(this.collision, null, o.tag ? { tag: o.tag, owner: p } : { owner: p });
    this.placed.push(p);
    return p;
  }

  remove(p) {
    const i = this.placed.indexOf(p);
    if (i >= 0) this.placed.splice(i, 1);
    p.dispose(this.scene, this.collision);
  }

  update(dt) {
    const cam = this.engine.camera.position;
    this.terrain.update(cam, this.engine.q.detail);
    this.water.update(dt);
    this.grass.update(dt);
    this.scatter.update(cam);
    this.fx.update(dt);
    // hide what is too far to matter (a slice of the list each frame)
    const list = this.placed;
    const n = Math.min(list.length, 160);
    for (let k = 0; k < n; k++) {
      this._cull = (this._cull + 1) % list.length;
      const p = list[this._cull];
      if (p.hidden) {
        p.object.visible = false;
        continue;
      }
      const dx = p.x - cam.x,
        dy = p.y - cam.y,
        dz = p.z - cam.z;
      p.object.visible = dx * dx + dy * dy + dz * dz < p.far * p.far;
    }
    for (const u of this.updaters) u(dt);
  }
}
