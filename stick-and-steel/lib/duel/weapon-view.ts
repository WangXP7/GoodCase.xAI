import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Weapon } from './weapons';
import { ALL_WEAPON_ASSETS } from './weapon-assets';
import { createWeaponModel } from './weapon-model';

export function createWeaponViews(scene: T.Scene, environment?: T.Texture) {
  let disposed = false;
  const models = new Map<string, T.Group>();
  if (typeof window !== 'undefined') for (const kind of ['sword', 'greatsword', 'mace', 'ravenblade'] as const) {
    void new GLTFLoader().loadAsync(ALL_WEAPON_ASSETS[kind]).then(gltf => {
      const model = gltf.scene;
      if (disposed) { disposeModel(model); return; }
      model.traverse(object => { if (object instanceof T.Mesh) { if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals(); object.castShadow = object.receiveShadow = true; if (environment) for (const material of Array.isArray(object.material) ? object.material : [object.material]) { if (material instanceof T.MeshStandardMaterial) { material.envMap = environment; material.envMapIntensity = .8; } } } });
      models.set(kind, model);
    }).catch(() => { /* The authored mesh remains usable when an asset cannot load. */ });
  }
  function disposeModel(model: T.Group) {
    const maps = new Set<T.Texture>(), materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
    model.traverse(object => { if (object instanceof T.Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof T.Texture && value !== environment) maps.add(value); } } });
    maps.forEach(m => m.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
  }
  const loaded = new Set<number>();
  const views = new Map<number, ReturnType<typeof createWeaponModel> & { kind: string }>();
  const ringGeo = new T.RingGeometry(.065, .079, 32), ringMat = new T.MeshBasicMaterial({ color: '#aa692d', depthWrite: false, side: T.DoubleSide });
  const marker = new T.Mesh(ringGeo, ringMat); marker.rotation.x = -Math.PI / 2; marker.visible = false;
  function clear() { for (const view of views.values()) { scene.remove(view.group); view.dispose(); } views.clear(); loaded.clear(); scene.remove(marker); }
  return {
    update(items: Weapon[], highlighted?: number) {
      const selected = items.find(w => w.id === highlighted && w.holder === null);
      marker.visible = !!selected;
      if (selected) { if (!marker.parent) scene.add(marker); marker.position.set(0, -selected.spec.center, 0).applyQuaternion(new T.Quaternion().copy(selected.body.rotation())).add(selected.body.translation()); marker.position.y = Math.max(.014, marker.position.y + .006); }
      for (const item of items) {
        const visual = item.skin ?? item.spec.kind;
        let view = views.get(item.id);
        if (!view || view.kind !== visual) {
          if (view) { scene.remove(view.group); view.dispose(); }
          loaded.delete(item.id);
          view = { ...createWeaponModel(item.spec.kind), kind: visual }; scene.add(view.group); views.set(item.id, view);
        }
        const model = models.get(visual);
        if (model && !loaded.has(item.id)) {
          view.dispose(); view.group.clear(); view.group.add(model.clone(true)); loaded.add(item.id);
        }
        view.group.position.copy(item.body.translation()); view.group.quaternion.copy(item.body.rotation());
      }
    },
    reset: clear, dispose() { disposed = true; clear(); models.forEach(disposeModel); models.clear(); ringGeo.dispose(); ringMat.dispose(); },
  };
}
