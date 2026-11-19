/* ============================================================
   RENDER ENGINE
   ------------------------------------------------------------
   WebGL2, linear HDR pipeline, MSAA-backed composer, bloom, and a
   final pass that treats the image as what it is in fiction: a
   camera bolted to a rover, with sensor noise that rises in shadow.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* `pixels` is a hard ceiling on the framebuffer, and it is the single most
   important number here. A Retina MacBook reports devicePixelRatio 2, so a
   naive `setPixelRatio(dpr)` on a 1710-point-wide window renders 3420x2136 —
   7.3 megapixels through a terrain shader that ray-marches and triplanar
   samples. That is what makes it crawl, not the geometry. Capping total pixels
   rather than the ratio keeps the same budget on every display. */
export const QUALITY = {
  low: {
    name: 'LOW', maxDpr: 1.5, pixels: 0.85e6, clipM: 88, clipLevels: 7, clipCell: 0.28,
    stars: 2500, boulders: 420, trailRes: 1024, sunRes: 512, sunSteps: 36, dentRes: 2048,
    shadow: 0, bloom: false, msaa: 0, dust: 500
  },
  medium: {
    name: 'MEDIUM', maxDpr: 1.75, pixels: 1.6e6, clipM: 128, clipLevels: 8, clipCell: 0.20,
    stars: 6000, boulders: 1000, trailRes: 2048, sunRes: 768, sunSteps: 52, dentRes: 2048,
    shadow: 1024, bloom: true, msaa: 0, dust: 1200
  },
  high: {
    name: 'HIGH', maxDpr: 2, pixels: 2.4e6, clipM: 160, clipLevels: 9, clipCell: 0.16,
    stars: 11000, boulders: 1500, trailRes: 4096, sunRes: 1024, sunSteps: 76, dentRes: 4096,
    shadow: 2048, bloom: true, msaa: 4, dust: 2200
  },
  ultra: {
    name: 'ULTRA', maxDpr: 2, pixels: 4.2e6, clipM: 192, clipLevels: 9, clipCell: 0.13,
    stars: 16000, boulders: 2200, trailRes: 4096, sunRes: 1536, sunSteps: 96, dentRes: 4096,
    shadow: 4096, bloom: true, msaa: 4, dust: 3200
  }
};

/* ACES fitted + the rover-camera conceit */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 1.0 },
    uAberr: { value: 1.0 },
    uGlitch: { value: 0.0 },
    uFlash: { value: 0.0 },
    uLetterbox: { value: 0.0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSunUV: { value: new THREE.Vector3(0.5, 0.5, 0) }   // xy = screen pos, z = visibility
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uVignette, uGrain, uAberr, uGlitch, uFlash, uLetterbox;
    uniform vec2 uRes; uniform vec3 uSunUV;

    vec3 aces(vec3 x){
      const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
    }
    // Integer hash. The usual fract(sin(dot(...))) trick correlates hard on an
    // integer lattice like gl_FragCoord and lays a visible diagonal weave over
    // the whole frame — this one is actually white.
    float hash(vec2 p){
      uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
      uint n = (q.x ^ q.y) * 1597334673u;
      n = (n ^ (n >> 15u)) * 2246822519u;
      n = (n ^ (n >> 13u)) * 3266489917u;
      return float(n ^ (n >> 16u)) * (1.0 / 4294967295.0);
    }

    void main(){
      vec2 uv = vUv;
      float aspect = uRes.x / uRes.y;

      /* sensor tear when the chassis takes a hit */
      if (uGlitch > 0.001){
        float band = step(0.985 - uGlitch*0.25, hash(vec2(floor(uv.y*140.0), floor(uTime*22.0))));
        uv.x += band * (hash(vec2(floor(uv.y*140.0), 7.0))-0.5) * 0.055 * uGlitch;
      }

      /* lateral chromatic aberration, zero at centre */
      vec2 d = uv - 0.5;
      float r2 = dot(d,d);
      float k = uAberr * (0.0004 + 0.0026*r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d*k).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d*k).b;

      /* anamorphic-ish veiling glare toward the sun — the one thing a vacuum
         cannot give you, but a scratched lens can */
      if (uSunUV.z > 0.001){
        vec2 sp = uSunUV.xy - uv;
        sp.x *= aspect;
        float dd = length(sp);
        float streak = exp(-abs(sp.y)*46.0) * exp(-abs(sp.x)*2.2);
        float halo = exp(-dd*7.0)*0.30 + exp(-dd*1.7)*0.06;
        col += vec3(1.0,0.93,0.80) * (streak*0.16 + halo) * uSunUV.z;
        // a couple of ghosts along the optical axis
        vec2 g1 = mix(uv, uSunUV.xy, 1.62); vec2 g2 = mix(uv, uSunUV.xy, 2.35);
        col += vec3(0.35,0.55,0.75) * exp(-length((g1-uSunUV.xy)*vec2(aspect,1.0))*16.0) * 0.13 * uSunUV.z;
        col += vec3(0.75,0.42,0.25) * exp(-length((g2-uSunUV.xy)*vec2(aspect,1.0))*22.0) * 0.10 * uSunUV.z;
      }

      col *= uExposure;
      col += uFlash;

      /* tone map in linear, then encode */
      col = aces(col);

      /* vignette + a faint barrel darkening at the corners */
      float vig = 1.0 - uVignette * smoothstep(0.28, 0.92, r2*1.65);
      col *= vig;

      /* sensor noise: rises where the signal is low, exactly like a real CMOS */
      float lum = dot(col, vec3(0.299,0.587,0.114));
      float n = hash(gl_FragCoord.xy + vec2(floor(uTime*61.0), floor(uTime*37.0))) - 0.5;
      col += n * uGrain * (0.012 + 0.034*(1.0 - smoothstep(0.0, 0.26, lum)));

      /* photo-mode letterbox */
      float lb = step(uv.y, uLetterbox*0.5) + step(1.0-uLetterbox*0.5, uv.y);
      col *= 1.0 - lb;

      col = pow(max(col, 0.0), vec3(1.0/2.2));
      gl_FragColor = vec4(col, 1.0);
    }`
};

export class Engine {
  constructor(canvas, qualityKey = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY[qualityKey] || QUALITY.high;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false,
      powerPreference: 'high-performance', depth: true
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;      // the final pass owns tone mapping
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = true;

    this.renderScale = 1;      // governor multiplier on top of the pixel budget
    this.adaptive = true;
    this.caps = {
      floatLinear: this.renderer.extensions.has('OES_texture_float_linear'),
      maxTex: this.renderer.capabilities.maxTextureSize,
      aniso: this.renderer.capabilities.getMaxAnisotropy()
    };
    if (!this.caps.floatLinear) {
      console.warn('[REGOLITH] OES_texture_float_linear unavailable — terrain sampling will be blocky.');
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.08, 26000);
    this.camera.position.set(0, 3, -8);

    /* ---- sun: one hard, parallel, uncompromising light source ---- */
    this.sun = new THREE.DirectionalLight(0xfff4e4, 3.0);
    this.sun.castShadow = this.quality.shadow > 0;
    if (this.sun.castShadow) {
      const S = this.quality.shadow;
      this.sun.shadow.mapSize.set(S, S);
      const d = 26;
      this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
      this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
      this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 180;
      this.sun.shadow.bias = -0.0009;
      this.sun.shadow.normalBias = 0.045;
      this.sun.shadow.radius = 1.4;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // earthshine: the only soft light for 380 000 km
    this.fill = new THREE.HemisphereLight(0x2a4270, 0x3a3128, 0.34);
    this.scene.add(this.fill);

    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildComposer() {
    const q = this.quality;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const w = Math.max(2, size.x), h = Math.max(2, size.y);
    // MSAA on a phone GPU costs more than it returns; the budget is better
    // spent on resolution.
    const samples = q.msaa && w * h <= 3.2e6 ? q.msaa : 0;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace
    });
    // EffectComposer.dispose() frees its own two targets and nothing else.
    // UnrealBloomPass carries a mip chain of eleven more, so rebuilding the
    // composer without walking the passes leaks eleven render targets every
    // time the quality tier changes — which used to be rare enough not to show.
    if (this.composer) {
      for (const p of this.composer.passes) p.dispose?.();
      this.composer.dispose();
    }
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold sits above a sunlit white radiator on purpose: at 0.72 the
    // rover's own thermal panels bloomed and veiled the entire frame.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.70, 1.15);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
  }

  setQuality(key) {
    this.quality = QUALITY[key] || QUALITY.high;
    this.renderer.shadowMap.enabled = this.quality.shadow > 0;
    this.sun.castShadow = this.quality.shadow > 0;
    if (this.sun.castShadow && this.sun.shadow.map) {
      this.sun.shadow.map.dispose(); this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    }
    this.resize();
    this.buildComposer();
    this.resize();
  }

  /** Device pixel ratio, clamped so the framebuffer never exceeds the budget. */
  _pixelRatio() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    let px = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    const over = (w * h * px * px) / this.quality.pixels;
    if (over > 1) px /= Math.sqrt(over);
    return Math.max(0.5, px * this.renderScale);
  }

  /** Rolling frame-time governor. Trades resolution for a steady frame rate
      before the player ever notices, and gives it back when there is headroom. */
  governor(dt) {
    if (!this.adaptive) return;
    this._ft = this._ft === undefined ? dt : this._ft * 0.92 + dt * 0.08;
    this._govT = (this._govT || 0) + dt;
    if (this._govT < 1.1) return;
    this._govT = 0;
    const ms = this._ft * 1000;
    const before = this.renderScale;
    if (ms > 23 && this.renderScale > 0.62) this.renderScale = Math.max(0.62, this.renderScale - 0.08);
    else if (ms < 13.5 && this.renderScale < 1) this.renderScale = Math.min(1, this.renderScale + 0.06);
    if (Math.abs(this.renderScale - before) > 0.005) this.resize();
  }

  resize() {
    const px = this._pixelRatio();
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(px);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const bw = Math.max(2, Math.floor(w * px)), bh = Math.max(2, Math.floor(h * px));
    if (this.composer) {
      this.composer.setSize(w, h);
      this.final.uniforms.uRes.value.set(bw, bh);
      if (this.bloom) this.bloom.setSize(bw, bh);
    }
  }

  /** keep the shadow frustum tight around the rover so 2 k feels like 8 k */
  aimShadow(target, sunDir) {
    if (!this.sun.castShadow) return;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(sunDir, 90);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  render(dt) {
    this.final.uniforms.uTime.value += dt;
    this.composer.render(dt);
    this.governor(dt);
  }
}
