// The main light with cascaded shadows, plus a fixed pool of point lights shared by every fire,
// lantern and glowing thing in the world (a fixed count means no shader recompiles).
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { shared } from './shared.js';
import { installCloudShadows } from './atmos.js';

const POOL = 6;

export class Lighting {
  constructor(scene, camera, { shadowSize = 2048, shadowFar = 190 } = {}) {
    this.camera = camera;
    this.csm = new CSM({
      maxFar: shadowFar,
      cascades: 3,
      mode: 'custom',
      customSplitsCallback: (n, near, far, out) => out.push(26 / far, 78 / far, 1),
      parent: scene,
      shadowMapSize: shadowSize,
      lightDirection: new THREE.Vector3(-0.5, -0.7, -0.5).normalize(),
      camera,
      lightIntensity: 1,
      lightNear: 1,
      lightFar: 900,
      lightMargin: 260,
      shadowBias: -0.00018,
    });
    this.csm.fade = true;
    installCloudShadows();
    const nb = [0.035, 0.09, 0.28];
    this.csm.lights.forEach((l, i) => {
      l.shadow.normalBias = nb[i];
      l.shadow.radius = 1.6;
    });
    this.refresh();

    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.requests = [];
    this._n = 0;
  }

  /** Call when the camera projection or the shadow distance changes. */
  refresh() {
    this.csm.updateFrustums();
    this.csm.getExtendedBreaks(shared.CSM_cascades.value);
    shared.cameraNear.value = this.camera.near;
    shared.shadowFar.value = Math.min(this.camera.far, this.csm.maxFar);
  }

  /** dir points toward the light. */
  setSun(dir, color, intensity) {
    this.csm.lightDirection.set(-dir.x, -dir.y, -dir.z);
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  /** Ask for a point light this frame. Cheap; the nearest and brightest win the pool. */
  point(x, y, z, color, intensity, range, decay = 2) {
    let r = this.requests[this._n];
    if (!r) r = this.requests[this._n] = { x: 0, y: 0, z: 0, c: new THREE.Color(), i: 0, r: 0, s: 0, k: 2 };
    r.k = decay;
    this._n++;
    r.x = x;
    r.y = y;
    r.z = z;
    r.c.set(color);
    r.i = intensity;
    r.r = range;
  }

  update(camPos) {
    this.csm.update();
    const n = this._n;
    const req = this.requests;
    for (let i = 0; i < n; i++) {
      const r = req[i];
      const d = Math.hypot(r.x - camPos.x, r.y - camPos.y, r.z - camPos.z);
      const fade = 1 - Math.min(1, Math.max(0, (d - 42) / 22));
      r.f = fade;
      r.s = fade <= 0 ? -1 : (r.i * r.r) / (1 + d * d * 0.02);
    }
    // partial selection of the best POOL requests
    for (let k = 0; k < POOL; k++) {
      let best = -1,
        bs = 0;
      for (let i = k; i < n; i++)
        if (req[i].s > bs) {
          bs = req[i].s;
          best = i;
        }
      const l = this.pool[k];
      if (best < 0) {
        l.intensity = 0;
        continue;
      }
      const r = req[best];
      req[best] = req[k];
      req[k] = r;
      l.position.set(r.x, r.y, r.z);
      l.color.copy(r.c);
      l.intensity = r.i * r.f;
      l.decay = r.k;
      l.distance = r.r;
    }
    this._n = 0;
  }
}
