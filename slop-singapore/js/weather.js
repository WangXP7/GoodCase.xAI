import * as THREE from 'three/webgpu';
import { cityUniforms } from './tsl-materials.js';

// js/weather.js
// Singapore's afternoon thunderstorms: the light dims and greys, the haze closes in, the roads go wet and shiny, rain
// streaks fall around the camera and lightning flashes now and then — each flash hands its distance to `onLightning`
// (the audio's thunder follows it at the speed of sound). Laid over the time-of-day preset (js/lighting.js) without
// re-baking its environment map: the preset's values are kept and scaled.

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

const DROPS = 2600;
const BOX = [70, 36, 70]; // m around the camera
const FALL = 11; // m/s
const STREAK = 0.75; // m

class Weather {
  constructor(scene, lightingSystem, { onLightning = () => {} } = {}) {
    this.scene = scene;
    this.lighting = lightingSystem;
    this.onLightning = onLightning;
    this.target = 0;
    this.storm = 0; // 0 clear .. 1 full storm
    this.flash = 0;
    this.nextStrike = 6;
    this.flickers = [];
    this.base = null;
    this.basePreset = null;
    this.random = Math.random;

    // the rain: streaks (line segments) in a box that wraps around the camera
    this.offsets = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      this.offsets[i * 3] = this.random() * BOX[0];
      this.offsets[i * 3 + 1] = this.random() * BOX[1];
      this.offsets[i * 3 + 2] = this.random() * BOX[2];
    }
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(DROPS * 6);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicNodeMaterial({ color: 0xc9d3dc, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(geometry, this.material);
    this.rain.name = 'Rain';
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.castShadow = this.rain.receiveShadow = false;
    scene.add(this.rain);
  }

  get stormy() {
    return this.target > 0;
  }

  // `immediate`: already raining (no build-up), e.g. arriving with ?storm
  setStorm(on, immediate = false) {
    this.target = on ? 1 : 0;
    if (immediate) this.storm = this.target;
    if (on) this.nextStrike = 3 + this.random() * 4;
  }

  toggle() {
    this.setStorm(!this.stormy);
    return this.stormy;
  }

  // The preset's own values, captured whenever the preset changes (applyPreset has just set them)
  captureBase() {
    const L = this.lighting;
    this.basePreset = L.activePresetId;
    this.base = {
      sun: L.sunLight.intensity,
      hemi: L.hemiLight.intensity,
      fog: L.uFogDensity ? L.uFogDensity.value : this.scene.fog?.density ?? 0,
      env: this.scene.environmentIntensity ?? 1,
      wet: cityUniforms.uRoadWetness.value,
      clouds: L.sky?.cloudCoverage?.value ?? 0,
      cloudDensity: L.sky?.cloudDensity?.value ?? 0
    };
  }

  update(dt, camera) {
    if (!this.base || this.basePreset !== this.lighting.activePresetId) this.captureBase();
    // the storm rolls in over ~8 s and clears over ~12 s
    this.storm += clamp(this.target - this.storm, -dt / 12, dt / 8);
    const s = this.storm;

    // lightning: a strike every few seconds at full storm, as one to three quick flickers
    if (s > 0.6) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        const distance = 300 + this.random() ** 1.5 * 7000;
        const bright = 0.35 + 0.65 * (1 - distance / 7300);
        const n = 1 + Math.floor(this.random() * 3);
        for (let k = 0; k < n; k++) this.flickers.push({ at: k * (0.07 + this.random() * 0.12), life: 0.06 + this.random() * 0.08, bright: bright * (k ? 0.6 : 1) });
        this.onLightning(distance);
        this.nextStrike = 4 + this.random() * 11;
      }
    }
    let flash = 0;
    for (let i = this.flickers.length - 1; i >= 0; i--) {
      const f = this.flickers[i];
      f.at -= dt;
      if (f.at > 0) continue;
      f.life -= dt;
      if (f.life <= 0) this.flickers.splice(i, 1);
      else flash = Math.max(flash, f.bright);
    }
    this.flash = flash;

    // (once more when it has cleared, to put the preset's values back)
    if (s > 0 || this.applied) {
      this.applied = s > 0;
      const B = this.base;
      const L = this.lighting;
      L.sunLight.intensity = B.sun * (1 - 0.82 * s);
      L.hemiLight.intensity = B.hemi * (1 - 0.35 * s) + flash * 7;
      this.scene.environmentIntensity = B.env * (1 - 0.45 * s) + flash * 1.5;
      if (L.uFogDensity) L.uFogDensity.value = B.fog * (1 + 2.2 * s) + 0.0005 * s;
      cityUniforms.uRoadWetness.value = Math.max(B.wet, 0.95 * s);
      if (L.sky?.cloudCoverage) L.sky.cloudCoverage.value = B.clouds + (0.95 - B.clouds) * s;
      if (L.sky?.cloudDensity) L.sky.cloudDensity.value = B.cloudDensity + (0.9 - B.cloudDensity) * s;
    }

    // rain streaks around the camera
    const visible = s > 0.02;
    this.rain.visible = visible;
    if (!visible) return;
    this.material.opacity = 0.5 * clamp((s - 0.1) / 0.6);
    const c = camera.position;
    const o = this.offsets;
    const p = this.positions;
    const fall = FALL * dt;
    const x0 = c.x - BOX[0] / 2, y0 = c.y - BOX[1] * 0.6, z0 = c.z - BOX[2] / 2;
    const wrap = (v, m) => ((v % m) + m) % m;
    for (let i = 0; i < DROPS; i++) {
      let y = o[i * 3 + 1] - fall;
      if (y < 0) y += BOX[1];
      o[i * 3 + 1] = y;
      // the box stays put in the world as the camera moves through it (so the rain doesn't travel with it)
      const x = x0 + wrap(o[i * 3] - x0, BOX[0]);
      const z = z0 + wrap(o[i * 3 + 2] - z0, BOX[2]);
      const wy = y0 + y;
      p[i * 6] = x; p[i * 6 + 1] = wy; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.04; p[i * 6 + 4] = wy - STREAK; p[i * 6 + 5] = z + 0.03;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}

export { Weather };
