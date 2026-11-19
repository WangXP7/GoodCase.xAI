// OWNER: render agent. Light rig (docs/ARCHITECTURE.md, render/lights.js):
//   warm key from screen-left (directional, PCSS soft shadows via materials.js, frustum fitted to the
//   camera footprint and snapped to shadow texels), cool fill from the right (no shadows), warm hemisphere,
//   the traveller's lantern (point light with a wide wrapped pool) and the dark warm surround.
import { setColorCached } from './colorcache.js';
import * as THREE from 'three';
import { CONFIG, qualitySettings } from '../core/config.js';
import { paperState, paperUniforms } from './materials.js';

export function createLights({ scene, quality = 'high' }) {
  const L = CONFIG.lights;
  let q = qualitySettings(quality);
  // post.js replaces this each frame with the value that tone-maps to L.background.
  scene.background = new THREE.Color(L.background);

  const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
  hemi.name = 'hemi';

  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  key.name = 'key';
  key.castShadow = q.shadows;
  key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  // The PCSS in materials.js reinterprets two stock shadow uniforms (see patchShadowChunk):
  //   shadow.radius = world size of the shadow map, shadow.bias = light size. Real biasing is baked in.
  key.shadow.bias = L.shadow.lightSize;
  key.shadow.normalBias = L.shadow.normalBias;
  key.shadow.radius = 2 * L.shadow.extent;

  const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
  fill.name = 'fill';

  const lantern = new THREE.PointLight(L.lantern.color, L.lantern.intensity, L.lantern.distance, L.lantern.decay);
  lantern.name = 'lantern-light';

  scene.add(hemi, key, key.target, fill, fill.target, lantern);

  const keyDir = new THREE.Vector3(-0.6, 0.7, 0.3).normalize();
  const fillDir = new THREE.Vector3(0.9, 0.3, -0.2).normalize();
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _back = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _lr = new THREE.Vector3();
  const _lu = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  let extent = -1;

  function setDir(out, azDeg, elDeg) {
    const az = THREE.MathUtils.degToRad(azDeg);
    const el = THREE.MathUtils.degToRad(elDeg);
    // azimuth 0 = from the camera side, positive = toward screen-right
    out.copy(_back).multiplyScalar(Math.cos(az) * Math.cos(el)).addScaledVector(_right, Math.sin(az) * Math.cos(el));
    out.y = Math.sin(el);
    return out.normalize();
  }

  function applyTunables() {
    setColorCached(key.color, L.key.color); key.intensity = L.key.intensity;
    setColorCached(fill.color, L.fill.color); fill.intensity = L.fill.intensity;
    setColorCached(hemi.color, L.hemi.sky); setColorCached(hemi.groundColor, L.hemi.ground); hemi.intensity = L.hemi.intensity;
    setColorCached(lantern.color, L.lantern.color); lantern.intensity = L.lantern.intensity;
    lantern.distance = L.lantern.distance; lantern.decay = L.lantern.decay;
    key.shadow.normalBias = L.shadow.normalBias;
    key.shadow.intensity = L.shadow.intensity;
  }

  return {
    key, fill, hemi, lantern,
    /** Keep the rig, the shadow frustum and the lantern on the traveller / camera. */
    update(dt, traveller, camera) {
      applyTunables();
      const S = L.shadow;
      const p = traveller.position;

      // --- camera frame on the ground plane -------------------------------------------------------
      let dist = 18;
      let sinPitch = 0.8;
      let fovTan = 0.27;
      let aspect = 16 / 9;
      _c.set(p.x, 0, p.z);
      _right.set(1, 0, 0);
      _back.set(0, 0, 1);
      if (camera) {
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        _right.set(e[0], 0, e[2]);
        _up.set(e[4], 0, e[6]);
        _fwd.set(-e[8], -e[9], -e[10]);
        sinPitch = Math.min(1, Math.max(0.2, -_fwd.y));
        // forward on the ground (the camera's up vector takes over when looking straight down)
        _back.set(-(_fwd.x + _up.x), 0, -(_fwd.z + _up.z));
        if (!L.cameraRelative) { _right.set(1, 0, 0); _back.set(0, 0, 1); }
        if (_back.lengthSq() < 1e-8) _back.set(0, 0, 1);
        _back.normalize();
        if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
        _right.normalize();
        // ground point at the centre of the screen
        _v.setFromMatrixPosition(camera.matrixWorld);
        if (_fwd.y < -0.05) {
          const t = Math.min(200, _v.y / -_fwd.y);
          _c.copy(_v).addScaledVector(_fwd, t);
          _c.y = 0;
          dist = t;
        } else dist = _v.distanceTo(_c);
        if (camera.isPerspectiveCamera) { fovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2); aspect = camera.aspect; }
      }
      setDir(keyDir, L.key.azimuthDeg, L.key.elevationDeg);
      setDir(fillDir, L.fill.azimuthDeg, L.fill.elevationDeg);

      // --- key shadow frustum: fitted to the visible ground, quantised size, texel-snapped centre ----
      const halfW = dist * fovTan * aspect;
      const halfD = (dist * fovTan) / sinPitch;
      let want = Math.max(halfW, halfD) * S.fit + S.pad;
      want = Math.min(S.maxExtent, Math.max(S.minExtent, Math.ceil(want * 2) / 2));
      const size = q.shadowMapSize;
      const cam = key.shadow.camera;
      if (want !== extent || cam.far !== S.far || cam.near !== S.near) {
        extent = want;
        cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
        cam.near = S.near; cam.far = S.far;
        cam.updateProjectionMatrix();
      }
      const texel = (2 * extent) / size;
      _lr.crossVectors(WORLD_UP, keyDir).normalize();
      _lu.crossVectors(keyDir, _lr).normalize();
      const a = Math.round(_c.dot(_lr) / texel) * texel;
      const b = Math.round(_c.dot(_lu) / texel) * texel;
      key.target.position.set(0, 0, 0).addScaledVector(_lr, a).addScaledVector(_lu, b).addScaledVector(keyDir, _c.dot(keyDir));
      key.position.copy(key.target.position).addScaledVector(keyDir, S.distance);
      key.target.updateMatrixWorld();
      key.updateMatrixWorld();

      fill.target.position.copy(_c);
      fill.position.copy(_c).addScaledVector(fillDir, 30);
      fill.target.updateMatrixWorld();

      // stock hard-shadow fallback (only if three.js changed its shader chunk): give the stock filter sane values
      key.shadow.radius = paperState.pcss ? 2 * extent : 1;
      key.shadow.bias = paperState.pcss ? S.lightSize : -0.0004;

      // --- hero cut-out (materials.js): cards between the camera and the traveller are dithered away -----
      {
        const H = L.cutout || {};
        // off when the camera looks almost straight down (nothing can hide him) and in macro shots closer than 3 units
        let k = H.enabled === false || !camera ? 0 : 1;
        if (k) {
          _v.setFromMatrixPosition(camera.matrixWorld);
          const d = _v.distanceTo(p);
          k = Math.min(1, Math.max(0, (d - 2.5) / 1.5)) * Math.min(1, Math.max(0, (0.985 - sinPitch) / 0.03));
        }
        paperUniforms.uPaperHero.value.set(p.x, p.y + (H.chest ?? 0.3), p.z, H.radius ?? 0.45);
        paperUniforms.uPaperHero2.value.x = p.y;
        paperUniforms.uPaperHero2.value.y = k * (H.strength ?? 1);
      }

      // --- lantern -----------------------------------------------------------------------------------
      const holder = traveller.group && traveller.group.getObjectByName('lantern');
      if (holder) { holder.getWorldPosition(_v); lantern.position.set(_v.x, _v.y + L.lantern.lift, _v.z); }
      else lantern.position.set(p.x, p.y + L.lantern.height + L.lantern.lift, p.z);
    },
    setQuality(level) {
      q = qualitySettings(level);
      key.castShadow = q.shadows;
      if (key.shadow.mapSize.x !== q.shadowMapSize) {
        key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
      extent = -1;
    },
    dispose() {
      scene.remove(hemi, key, key.target, fill, fill.target, lantern);
      if (key.shadow.map) key.shadow.map.dispose();
    },
  };
}
