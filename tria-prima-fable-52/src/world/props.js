// Kit models in the world: the shared materials, one-off placed models (structures, gameplay
// objects) and instanced crowds (trees, rocks, shrubs) with distance levels of detail.
import * as THREE from 'three';
import { createPropMaterial } from '../gfx/propMaterial.js';
import { worldMaterial } from '../gfx/atmos.js';
import { buildModel, hasModel, modelMeta } from '../models/index.js';
import { placeCollider } from '../physics/collide.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';

export function createMaterials() {
  const prop = worldMaterial(createPropMaterial());
  const liquid = worldMaterial(createPropMaterial({ roughness: 0.2, grime: false }));
  // glass without a transmission pass: thin, glossy, mostly a reflection
  const glass = worldMaterial(
    new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.2 })
  );
  return { prop, liquid, glass };
}

const _m = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _p = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _e = new THREE.Euler();

/** One placed model: a group with its meshes, named parts, anchors and world colliders. */
export class Placed {
  constructor(name, model, mats, x, y, z, ry = 0, scale = 1) {
    this.name = name;
    this.model = model;
    this.x = x;
    this.y = y;
    this.z = z;
    this.ry = ry;
    this.scale = scale;
    const g = (this.object = new THREE.Group());
    g.name = name;
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.scale.setScalar(scale);
    this.parts = {};
    const add = (geo, mat, shadow = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    if (model.opaque) this.body = add(model.opaque, mats.prop);
    for (const [k, geo] of Object.entries(model.parts || {})) this.parts[k] = add(geo, mats.prop);
    if (model.liquid) this.liquid = add(model.liquid, mats.liquid, false);
    if (model.glass) {
      this.glass = add(model.glass, mats.glass, false);
      this.glass.renderOrder = 3;
    }
    g.updateMatrixWorld(true);
    this.colliderIds = [];
  }
  /** World position of a named anchor (or of a model-space point). */
  anchor(nameOrPoint, out = new THREE.Vector3()) {
    const a = typeof nameOrPoint === 'string' ? this.model.anchors[nameOrPoint] : nameOrPoint;
    if (!a) return null;
    return out.set(a[0], a[1], a[2]).applyMatrix4(this.object.matrixWorld);
  }
  hasAnchor(name) {
    return !!this.model.anchors[name];
  }
  /** Register this model's colliders with the collision world (and optionally the physics world). */
  addColliders(collision, physics = null, extra = null) {
    for (const c of this.model.colliders || []) {
      const w = placeCollider(c, this.x, this.y, this.z, this.ry, this.scale);
      if (extra) Object.assign(w, extra);
      this.colliderIds.push(collision.add(w));
      if (physics) physics.addStatic(w);
    }
    return this;
  }
  removeColliders(collision) {
    for (const id of this.colliderIds) collision.remove(id);
    this.colliderIds.length = 0;
  }
  dispose(scene, collision) {
    if (collision) this.removeColliders(collision);
    scene.remove(this.object);
  }
}

/**
 * Instanced crowds. add() queues instances; build() makes the buckets; update() refills them by
 * distance when the camera has moved.
 */
export class Scatter {
  constructor(scene, mats) {
    this.scene = scene;
    this.mats = mats;
    this.kinds = new Map(); // key -> { name, seed, lods:[geo...], dist:[d0,d1,d2], items:[] }
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    scene.add(this.group);
    this._last = new THREE.Vector3(1e9, 0, 0);
    this.count = 0;
  }

  /** Queue one instance. Returns false when the model does not exist. */
  add(name, seed, x, y, z, ry = 0, scale = 1, tilt = 0, tiltDir = 0) {
    if (!hasModel(name)) return false;
    const key = name + '#' + seed;
    let k = this.kinds.get(key);
    if (!k) {
      const meta = modelMeta(name) || {};
      const lods = [];
      const nl = meta.lods || 1;
      for (let l = 0; l < nl; l++) {
        let model;
        try {
          model = nl > 1 ? buildModel(name, seed, { lod: l }) : buildModel(name, seed);
        } catch (e) {
          console.error('[scatter] ' + name + ' lod ' + l + ' failed: ' + e.message);
          break;
        }
        if (!model.opaque) break;
        lods.push(model);
      }
      if (!lods.length) return false;
      const r = Math.max(lods[0].radius, lods[0].size[1] * 0.5, 0.3);
      // how far each level of detail reaches depends on how big the thing is
      const far = Math.min(520, 60 + r * 70);
      const dist = lods.length >= 3 ? [Math.min(48, 14 + r * 7), Math.min(130, 40 + r * 18), far] : lods.length === 2 ? [Math.min(60, 16 + r * 9), far] : [far];
      // small things throw no shadow and are left out of the water's reflection
      const small = lods[0].radius < 1.3 && lods[0].size[1] < 1.7;
      k = { name, seed, lods, dist, items: [], radius: r, meshes: [], small };
      this.kinds.set(key, k);
    }
    _e.set(tilt * Math.cos(tiltDir), ry, tilt * Math.sin(tiltDir), 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale));
    k.items.push({ x, y, z, m: Float32Array.from(_m.elements) });
    this.count++;
    return true;
  }

  /** Model-space colliders of a kind that has been added at least once. */
  colliders(name, seed) {
    const k = this.kinds.get(name + '#' + seed);
    return k ? k.lods[0].colliders || [] : [];
  }

  build() {
    for (const k of this.kinds.values()) {
      const n = k.items.length;
      k.mat = new Float32Array(n * 16);
      k.xs = new Float32Array(n);
      k.ys = new Float32Array(n);
      k.zs = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        k.mat.set(k.items[i].m, i * 16);
        k.xs[i] = k.items[i].x;
        k.ys[i] = k.items[i].y;
        k.zs[i] = k.items[i].z;
      }
      k.n = n;
      k.items = null;
      for (let l = 0; l < k.lods.length; l++) {
        const cap = Math.min(n, l === 0 ? 220 : l === 1 ? 900 : n);
        const mesh = new THREE.InstancedMesh(k.lods[l].opaque, this.mats.prop, cap);
        mesh.count = 0;
        mesh.frustumCulled = false;
        // only what is near enough to matter throws a shadow
        mesh.castShadow = !k.small && (l === 0 || (l === 1 && k.lods.length === 3));
        if (k.small) mesh.layers.set(LAYER_MAIN_ONLY);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.cap = cap;
        k.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  update(cam, force = false) {
    if (!force && this._last.distanceToSquared(cam) < 16) return;
    this._last.copy(cam);
    for (const k of this.kinds.values()) {
      const L = k.lods.length;
      const counts = [0, 0, 0];
      const d0 = k.dist[0] * k.dist[0],
        d1 = L > 1 ? k.dist[1] * k.dist[1] : 0,
        d2 = L > 2 ? k.dist[2] * k.dist[2] : 0;
      const far2 = k.dist[L - 1] * k.dist[L - 1];
      for (let i = 0; i < k.n; i++) {
        const dx = k.xs[i] - cam.x,
          dy = k.ys[i] - cam.y,
          dz = k.zs[i] - cam.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > far2) continue;
        const l = L === 1 ? 0 : d < d0 ? 0 : L === 2 || d < d1 ? 1 : 2;
        const mesh = k.meshes[l];
        const c = counts[l];
        if (c >= mesh.userData.cap) {
          // out of room at this level: fall through to a coarser one if there is one
          if (l + 1 < L && counts[l + 1] < k.meshes[l + 1].userData.cap) {
            k.meshes[l + 1].instanceMatrix.array.set(k.mat.subarray(i * 16, i * 16 + 16), counts[l + 1] * 16);
            counts[l + 1]++;
          }
          continue;
        }
        mesh.instanceMatrix.array.set(k.mat.subarray(i * 16, i * 16 + 16), c * 16);
        counts[l] = c + 1;
      }
      for (let l = 0; l < L; l++) {
        const mesh = k.meshes[l];
        mesh.count = counts[l];
        mesh.visible = counts[l] > 0;
        if (counts[l] > 0) {
          mesh.instanceMatrix.clearUpdateRanges();
          mesh.instanceMatrix.addUpdateRange(0, counts[l] * 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}
