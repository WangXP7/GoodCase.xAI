// The renderer: owns the WebGL context, the scene and camera, the HDR target, the sky, the
// lights, the atmosphere and the post chain, and draws one frame when asked.
import * as THREE from 'three';
import { shared } from './shared.js';
import './atmos.js';
import { Sky } from './sky.js';
import { Lighting } from './lighting.js';
import { Post } from './post.js';
import { makeNoiseTexture } from './texgen.js';
import { damp, lerp, clamp } from '../core/math.js';

// `pixels` is the most the picture may hold: a very dense screen (4K at 200 %, a Retina laptop)
// gets a slightly softer picture rather than a slow one. High holds 2560 x 1600, ultra 3840 x 2160.
export const QUALITY = {
  low: { scale: 0.7, pixels: 2.1e6, msaa: 0, shadow: 1024, shadowFar: 110, vol: false, reflect: false, grass: 0.35, detail: 0.6 },
  medium: { scale: 0.85, pixels: 3.0e6, msaa: 0, shadow: 2048, shadowFar: 150, vol: true, reflect: false, grass: 0.65, detail: 0.8 },
  high: { scale: 1.0, pixels: 4.2e6, msaa: 4, shadow: 2048, shadowFar: 190, vol: true, reflect: true, grass: 1.0, detail: 1.0 },
  ultra: { scale: 1.0, pixels: 8.4e6, msaa: 4, shadow: 4096, shadowFar: 230, vol: true, reflect: true, grass: 1.5, detail: 1.25 },
};

// Layer 0: the world (also seen in the water's reflection). Layer 1: main view only.
export const LAYER_MAIN_ONLY = 1;

export class Engine {
  constructor(canvas, { quality = 'high', renderScale = 1 } = {}) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.info.autoReset = false;
    r.setPixelRatio(1);
    this.gpu = '';
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    } catch (e) {
      /* not available */
    }

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0001); // switches the fog chunks on; atmos.js does the work
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.12, 2600);
    this.camera.layers.enable(LAYER_MAIN_ONLY);
    this.scene.add(this.camera);

    shared.uNoiseTex.value = makeNoiseTexture(256);

    this.quality = quality;
    this.q = { ...QUALITY[quality] };
    this.renderScale = renderScale;
    this.sky = new Sky(r);
    this.scene.add(this.sky.mesh);
    this.lighting = new Lighting(this.scene, this.camera, { shadowSize: this.q.shadow, shadowFar: this.q.shadowFar });
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.scene.add(this.hemi);
    this.post = new Post(r);
    this.post.volumetric = this.q.vol;
    this.main = null;

    // the hour and the weather. `atmo` is what the air is now, `want` what it drifts toward.
    this.hour = 15;
    this.atmo = { overcast: 0.6, fog: 0.4, tint: new THREE.Color(1, 1, 1), lift: 0, dim: 1, wind: 0.35 };
    this.want = { overcast: 0.6, fog: 0.4, tint: new THREE.Color(1, 1, 1), lift: 0, dim: 1, wind: 0.35 };
    this.brightness = 1;
    this.time = 0;
    this.hooks = { before: [], reflect: null };
    this.stats = { fps: 0, ms: 0, calls: 0, tris: 0 };
    this._acc = 0;
    this._frames = 0;
    this.w = 2;
    this.h = 2;
    this.resize();
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    const old = this.q;
    this.quality = name;
    this.q = { ...QUALITY[name] };
    this.post.volumetric = this.q.vol;
    if (old.shadow !== this.q.shadow || old.shadowFar !== this.q.shadowFar) {
      this.lighting.csm.maxFar = this.q.shadowFar;
      for (const l of this.lighting.csm.lights) {
        l.shadow.mapSize.set(this.q.shadow, this.q.shadow);
        if (l.shadow.map) {
          l.shadow.map.dispose();
          l.shadow.map = null;
        }
      }
      this.lighting.csm.shadowMapSize = this.q.shadow;
      this.lighting.refresh();
    }
    this.resize(true);
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.lighting.refresh();
  }

  /** Match the drawing buffer to the canvas' CSS size times the render scale. */
  resize(force = false) {
    const cw = Math.max(2, this.canvas.clientWidth || this.canvas.width),
      ch = Math.max(2, this.canvas.clientHeight || this.canvas.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let s = this.q.scale * this.renderScale * dpr;
    const px = cw * ch * s * s;
    if (this.q.pixels && px > this.q.pixels) s *= Math.sqrt(this.q.pixels / px);
    const w = Math.max(2, Math.round(cw * s)),
      h = Math.max(2, Math.round(ch * s));
    if (!force && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    if (this.main) {
      this.main.depthTexture.dispose();
      this.main.dispose();
    }
    this.main = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: this.q.msaa,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.post.setSize(w, h);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    this.lighting.refresh();
  }

  /** Advance sky, weather and lights. Call once per frame before render(). */
  update(dt) {
    this.time += dt;
    shared.uTime.value = this.time;
    const a = this.atmo,
      w = this.want;
    const k = 0.35;
    a.overcast = damp(a.overcast, w.overcast, k, dt);
    a.fog = damp(a.fog, w.fog, k, dt);
    a.lift = damp(a.lift, w.lift, k, dt);
    a.dim = damp(a.dim, w.dim, k, dt);
    a.wind = damp(a.wind, w.wind, k, dt);
    a.tint.lerp(w.tint, 1 - Math.exp(-k * dt));
    // slow breathing of the weather on top of the regional target
    const drift = Math.sin(this.time * 0.021) * 0.5 + Math.sin(this.time * 0.0083 + 1.7) * 0.5;
    const sky = this.sky;
    sky.overcast = clamp(a.overcast + drift * 0.14, 0, 1);
    sky.fog = clamp(a.fog + Math.sin(this.time * 0.013 + 4.0) * 0.07, 0, 1);
    sky.fogTint.copy(a.tint);
    sky.fogLift = a.lift;
    sky.dim = a.dim;
    const gust = 0.75 + 0.25 * Math.sin(this.time * 0.11) + 0.15 * Math.sin(this.time * 0.37);
    const wa = 0.6 + Math.sin(this.time * 0.007) * 0.5;
    shared.uWind.value.set(Math.cos(wa), Math.sin(wa), a.wind * gust, 0);

    sky.update(dt, this.hour, this.camera);
    this.lighting.setSun(sky.lightDir, sky.lightColor, sky.lightIntensity);
    this.hemi.color.copy(sky.ambient).multiplyScalar(1.15);
    this.hemi.groundColor.copy(sky.ambient).multiplyScalar(0.5);
    this.hemi.intensity = 1.3;
    const f = sky.fog;
    shared.uFogA.value.set(lerp(0.0014, 0.024, Math.pow(f, 1.5)), 0.042, 0, lerp(0.0005, 0.0042, f * f));
    shared.uFogB.value.set(lerp(14, 5, f), 1, this.post.volumetric ? 1 : 0, 0);
    this.post.exposure = sky.exposure * this.brightness;
  }

  /** Draw the frame. */
  render(dt) {
    const r = this.renderer,
      cam = this.camera;
    cam.updateMatrixWorld();
    shared.uCamPos.value.copy(cam.position);
    this.lighting.update(cam.position);
    this.sky.updateEnvironment(this.scene);
    for (const fn of this.hooks.before) fn(dt);
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    if (this.hooks.reflect && this.q.reflect) this.hooks.reflect(r, this.scene, cam);
    r.setRenderTarget(this.main);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    this.stats.calls = r.info.render.calls;
    this.stats.tris = r.info.render.triangles;
    this.post.render(this.main, cam, this.lighting, dt);
    this._acc += dt;
    this._frames++;
    if (this._acc >= 0.5) {
      this.stats.fps = this._frames / this._acc;
      this.stats.ms = (this._acc / this._frames) * 1000;
      this._acc = 0;
      this._frames = 0;
    }
  }

  /** The finished frame as a JPEG data URL (call right after render()). */
  snapshot(quality = 0.9) {
    return this.canvas.toDataURL('image/jpeg', quality);
  }
}
