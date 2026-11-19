// Every loose bright or soft thing in the air: flame, sparks, smoke, steam, frost, salt, motes.
// Simulated on the CPU (a few thousand at most), drawn in one instanced call. Additive and
// alpha particles share the call through premultiplied blending.
import * as THREE from 'three';
import { sharedUniforms, shared } from './shared.js';
import './atmos.js';
import { LAYER_MAIN_ONLY } from './engine.js';

// sprite kinds (shader side)
export const P = { GLOW: 0, FLAME: 1, SMOKE: 2, SHARD: 3, STREAK: 4, RING: 5, DROP: 6 };

const VERT = /* glsl */ `
#include <common>
attribute vec4 iPos;   // xyz, size
attribute vec4 iCol;   // rgb (HDR), alpha
attribute vec4 iMisc;  // rotation, kind, age 0..1, seed
attribute vec3 iVel;   // world velocity (streaks stretch along it)
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vMisc;
varying float vFog;
void main() {
  vUv = position.xy;
  vCol = iCol;
  vMisc = iMisc.yzw;
  vec3 wp = iPos.xyz;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float kind = iMisc.y;
  vec2 q = position.xy;
  float size = iPos.w;
  if (kind == 4.0 || kind == 6.0) {
    // stretch along the velocity as seen on screen
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    float sp = length(iVel);
    vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0, 1.0);
    float len = size * (1.0 + sp * (kind == 4.0 ? 0.04 : 0.022) / max(size, 1e-3));
    mv.xy += dir * q.y * len + vec2(-dir.y, dir.x) * q.x * size * 0.5;
  } else {
    float c = cos(iMisc.x), s = sin(iMisc.x);
    mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
  }
  vFog = tpFogAmount(wp);
  // fade out right in front of the eye
  vCol.a *= smoothstep(0.25, 1.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
#include <common>
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vMisc;
varying float vFog;
void main() {
  float kind = vMisc.x, age = vMisc.y, seed = vMisc.z;
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 add = vec3(0.0);
  vec3 lit = vec3(0.0);
  float a = 0.0;
  if (kind < 0.5) {
    // glow: a soft point with a hot core
    float g = exp(-r * r * 5.0) + exp(-r * r * 40.0) * 0.8;
    add = vCol.rgb * g * vCol.a * (1.0 - smoothstep(0.7, 1.0, r));
  } else if (kind < 1.5) {
    // flame: a torn tongue that cools as it rises
    vec2 nuv = vUv * 0.42 + vec2(seed * 7.3, seed * 3.1 - age * 0.55);
    float n = texture2D(uNoiseTex, nuv).r * 0.65 + texture2D(uNoiseTex, nuv * 2.3 + 0.37).g * 0.35;
    float shape = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.95 + age * 0.25);
    float core = smoothstep(0.75, 0.0, r + (n - 0.5) * 0.6);
    vec3 hot = mix(vCol.rgb, vec3(1.0), 0.55) * 1.5;
    vec3 c = mix(mix(vCol.rgb * vec3(0.9, 0.34, 0.12), vCol.rgb, core), hot, core * core * (1.0 - age));
    add = c * shape * vCol.a * (1.0 - age * age);
  } else if (kind < 2.5) {
    // smoke, steam, mist: soft, lit by the sky and a little by the sun
    vec2 nuv = vUv * 0.33 + vec2(seed * 5.1, seed * 9.7) + age * 0.08;
    float n = texture2D(uNoiseTex, nuv).r * 0.6 + texture2D(uNoiseTex, nuv * 2.7).b * 0.4;
    a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9) * vCol.a;
    vec3 light = uAmbient * 1.1 + uSunColor * 0.16 * (0.6 + 0.4 * n);
    lit = vCol.rgb * light;
  } else if (kind < 3.5) {
    // shard: a hard-edged chip that glints
    vec2 p = vUv;
    float d = abs(p.x) * (0.9 + seed * 0.6) + abs(p.y) * (1.5 - seed * 0.5);
    a = step(d, 0.8) * vCol.a;
    float glint = pow(max(0.0, sin(age * 37.0 + seed * 40.0)), 12.0);
    lit = vCol.rgb * (uAmbient * 1.2 + uSunColor * (0.25 + glint * 1.4));
  } else if (kind < 4.5) {
    // streak: a spark drawn out along its path
    float w = exp(-vUv.x * vUv.x * 9.0) * smoothstep(1.0, 0.2, abs(vUv.y));
    add = vCol.rgb * w * vCol.a;
  } else if (kind < 5.5) {
    // ring: a shock front
    float w = smoothstep(0.12, 0.0, abs(r - 0.84)) * (1.0 - age);
    add = vCol.rgb * w * vCol.a;
  } else {
    // drop: a bead of liquid
    float w = smoothstep(1.0, 0.3, abs(vUv.x) * 1.6) * smoothstep(1.0, 0.5, abs(vUv.y));
    a = w * vCol.a * 0.85;
    lit = vCol.rgb * (uAmbient * 1.4 + uSunColor * 0.5 + tpSkyColor(vec3(0.0, 1.0, 0.0)) * 0.6);
  }
  float f = vFog;
  add *= 1.0 - f;
  lit = mix(lit, uFogColor, f);
  gl_FragColor = vec4(add + lit * a, a);
}
`;

const _c = new THREE.Color();
const rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();

export class Particles {
  constructor(engine, max = 7000) {
    this.engine = engine;
    this.max = max;
    const n = max;
    this.n = 0;
    // simulation state
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.cr = new Float32Array(n);
    this.cg = new Float32Array(n);
    this.cb = new Float32Array(n);
    this.al = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.rot = new Float32Array(n);
    this.vrot = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.fade = new Float32Array(n); // fraction of life spent fading in
    this.floor = new Float32Array(n); // y below which a particle dies (-Infinity = none)

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(4);
    this.aCol = mk(4);
    this.aMisc = mk(4);
    this.aVel = mk(3);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iCol', this.aCol);
    g.setAttribute('iMisc', this.aMisc);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: sharedUniforms(),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.layers.set(LAYER_MAIN_ONLY);
    engine.scene.add(this.mesh);
    this.emitters = [];
  }

  /** One particle. o: { life, size, size1, color, alpha, rot, vrot, drag, grav, fade, floor } */
  spawn(kind, x, y, z, vx, vy, vz, o) {
    let i = this.n;
    if (i >= this.max) {
      // full: overwrite a random one (cheap, and nobody notices)
      i = (rnd() * this.max) | 0;
    } else this.n++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = o.life || 1;
    this.s0[i] = o.size || 0.1;
    this.s1[i] = o.size1 != null ? o.size1 : this.s0[i];
    const c = o.color;
    if (c && c.isColor) {
      this.cr[i] = c.r;
      this.cg[i] = c.g;
      this.cb[i] = c.b;
    } else if (Array.isArray(c)) {
      this.cr[i] = c[0];
      this.cg[i] = c[1];
      this.cb[i] = c[2];
    } else {
      _c.set(c || 0xffffff);
      this.cr[i] = _c.r;
      this.cg[i] = _c.g;
      this.cb[i] = _c.b;
    }
    const k = o.gain || 1;
    this.cr[i] *= k;
    this.cg[i] *= k;
    this.cb[i] *= k;
    this.al[i] = o.alpha != null ? o.alpha : 1;
    this.kind[i] = kind;
    this.rot[i] = o.rot != null ? o.rot : rnd() * 6.283;
    this.vrot[i] = o.vrot || 0;
    this.drag[i] = o.drag || 0;
    this.grav[i] = o.grav || 0;
    this.seed[i] = rnd();
    this.fade[i] = o.fade != null ? o.fade : 0.12;
    this.floor[i] = o.floor != null ? o.floor : -1e9;
  }

  /**
   * A standing source: { kind:'fire'|'candle'|'smoke'|'steam'|'spark'|'drip'|'glow'|'vent'|'embers',
   * x, y, z, size, color, rate, active }. Returns the object; set .active / .x.. freely,
   * call remove(e) to drop it.
   */
  emitter(spec) {
    const e = { kind: 'fire', x: 0, y: 0, z: 0, size: 0.3, color: null, rate: 1, active: true, power: 1, _acc: rnd(), ...spec };
    if (e.color != null && !Array.isArray(e.color)) {
      _c.set(e.color);
      e.color = [_c.r, _c.g, _c.b];
    }
    this.emitters.push(e);
    return e;
  }
  remove(e) {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  _emit(e, dt, wind) {
    const s = e.size,
      pw = e.power;
    const c = e.color;
    let rate = 0;
    switch (e.kind) {
      case 'fire':
        rate = (22 + s * 26) * pw;
        break;
      case 'candle':
        rate = 13;
        break;
      case 'smoke':
        rate = 5 * (e.rate || 1) * pw;
        break;
      case 'steam':
        rate = 9 * (e.rate || 1) * pw;
        break;
      case 'spark':
        rate = 1.6 * (e.rate || 1);
        break;
      case 'drip':
        rate = 0.6 * (e.rate || 1);
        break;
      case 'glow':
        rate = 2.2;
        break;
      case 'vent':
        rate = 10 * pw;
        break;
      case 'embers':
        rate = 7 * pw;
        break;
      default:
        rate = e.rate || 1;
    }
    e._acc += rate * dt;
    while (e._acc >= 1) {
      e._acc -= 1;
      const x = e.x,
        y = e.y,
        z = e.z;
      switch (e.kind) {
        case 'fire': {
          const a = rnd() * 6.283,
            r = Math.sqrt(rnd()) * s * 0.32;
          this.spawn(P.FLAME, x + Math.cos(a) * r, y + rnd() * s * 0.15, z + Math.sin(a) * r, rr(-0.12, 0.12) + wind[0] * 0.25, rr(0.7, 1.5) * Math.sqrt(s) * 1.5, rr(-0.12, 0.12) + wind[1] * 0.25, { life: rr(0.45, 0.85), size: s * rr(0.42, 0.62), size1: s * 0.12, color: c || [1.0, 0.42, 0.1], gain: 3.2 * pw, fade: 0.2, vrot: rr(-1.5, 1.5) });
          if (rnd() < 0.09) this.spawn(P.STREAK, x + rr(-0.1, 0.1) * s, y + s * 0.4, z + rr(-0.1, 0.1) * s, rr(-0.5, 0.5), rr(1.2, 2.6), rr(-0.5, 0.5), { life: rr(0.5, 1.2), size: 0.012, color: c || [1.0, 0.5, 0.15], gain: 7, grav: -0.15, drag: 0.6 });
          if (rnd() < 0.07 * (e.smoke != null ? e.smoke : 1)) this.spawn(P.SMOKE, x, y + s * 1.1, z, wind[0] * 0.7 + rr(-0.1, 0.1), rr(0.5, 0.9), wind[1] * 0.7 + rr(-0.1, 0.1), { life: rr(2, 3.6), size: s * 0.5, size1: s * 2.2, color: [0.2, 0.19, 0.19], alpha: 0.3, fade: 0.25, vrot: rr(-0.4, 0.4) });
          break;
        }
        case 'candle':
          this.spawn(P.FLAME, x + rr(-0.004, 0.004), y + 0.012, z + rr(-0.004, 0.004), wind[0] * 0.04, rr(0.1, 0.17), wind[1] * 0.04, { life: rr(0.28, 0.42), size: 0.03 * (s / 0.3 || 1) * rr(0.9, 1.2), size1: 0.008, color: c || [1.0, 0.55, 0.18], gain: 3.4, fade: 0.15, vrot: 0 });
          break;
        case 'smoke':
          this.spawn(P.SMOKE, x + rr(-0.1, 0.1) * s, y, z + rr(-0.1, 0.1) * s, wind[0] * 0.9 + rr(-0.08, 0.08), rr(0.35, 0.7), wind[1] * 0.9 + rr(-0.08, 0.08), { life: rr(2.6, 4.6), size: s * 0.45, size1: s * 2.6, color: c || [0.3, 0.29, 0.28], alpha: 0.26 * Math.min(1, pw), fade: 0.3, vrot: rr(-0.4, 0.4) });
          break;
        case 'steam':
          this.spawn(P.SMOKE, x + rr(-0.5, 0.5) * s, y, z + rr(-0.5, 0.5) * s, wind[0] * 0.5 + rr(-0.06, 0.06), rr(0.3, 0.75), wind[1] * 0.5 + rr(-0.06, 0.06), { life: rr(1.2, 2.4), size: s * 0.3, size1: s * 1.5, color: c || [0.85, 0.87, 0.9], alpha: (e.alpha != null ? e.alpha : 0.2) * Math.min(1.4, pw), fade: 0.3, vrot: rr(-0.5, 0.5) });
          break;
        case 'spark': {
          const rad = e.radius || s || 0.1;
          const n = 2 + ((rnd() * 3) | 0);
          for (let k = 0; k < n; k++) this.spawn(P.STREAK, x + rr(-rad, rad), y + rr(-rad, rad) * 0.5, z + rr(-rad, rad), rr(-0.9, 0.9), rr(0.2, 1.4), rr(-0.9, 0.9), { life: rr(0.25, 0.7), size: 0.009, color: c || [1.0, 0.55, 0.2], gain: 8, grav: 0.25, drag: 1.2 });
          break;
        }
        case 'drip':
          this.spawn(P.DROP, x, y, z, 0, 0, 0, { life: 1.1, size: 0.014, color: c || [0.2, 0.4, 0.5], grav: 1, fade: 0.05, floor: y - 0.6 });
          break;
        case 'glow': {
          const a = rnd() * 6.283,
            r = rr(0.2, 1) * s * 1.6;
          this.spawn(P.GLOW, x + Math.cos(a) * r, y + rr(-0.5, 0.6) * s, z + Math.sin(a) * r, rr(-0.04, 0.04), rr(0.02, 0.12), rr(-0.04, 0.04), { life: rr(1.6, 3.2), size: rr(0.012, 0.03), color: c || [0.7, 0.9, 1], gain: 5, fade: 0.4 });
          break;
        }
        case 'vent': {
          // a fumarole: yellow-grey smoke and now and then a blue lick
          this.spawn(P.SMOKE, x + rr(-0.2, 0.2) * s, y, z + rr(-0.2, 0.2) * s, wind[0] * 1.2 + rr(-0.1, 0.1), rr(0.7, 1.4), wind[1] * 1.2 + rr(-0.1, 0.1), { life: rr(3, 5.5), size: s * 0.5, size1: s * 3.4, color: c || [0.5, 0.47, 0.33], alpha: 0.24, fade: 0.25, vrot: rr(-0.3, 0.3) });
          break;
        }
        case 'embers': {
          const a = rnd() * 6.283,
            r = Math.sqrt(rnd()) * s;
          this.spawn(P.GLOW, x + Math.cos(a) * r, y, z + Math.sin(a) * r, wind[0] * 0.8 + rr(-0.3, 0.3), rr(0.5, 1.8), wind[1] * 0.8 + rr(-0.3, 0.3), { life: rr(2.5, 5), size: rr(0.012, 0.028), color: c || [1.0, 0.36, 0.08], gain: 9, fade: 0.1, drag: 0.15 });
          break;
        }
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------------- bursts
  /** A ball of fire. */
  fireball(x, y, z, radius = 2.5, color = null) {
    const c = color || [1.0, 0.42, 0.1];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.283,
        e = Math.acos(rr(-0.2, 1)),
        sp = rr(1.5, 5) * (radius / 2.5);
      this.spawn(P.FLAME, x, y + 0.1, z, Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp * 0.9 + 0.8, Math.sin(a) * Math.sin(e) * sp, { life: rr(0.5, 1.1), size: radius * rr(0.3, 0.55), size1: radius * 0.12, color: c, gain: 5, drag: 2.4, fade: 0.08, vrot: rr(-2, 2) });
    }
    for (let i = 0; i < 44; i++) {
      const a = rnd() * 6.283,
        sp = rr(2, 9);
      this.spawn(P.STREAK, x, y + 0.2, z, Math.cos(a) * sp, rr(1.5, 7), Math.sin(a) * sp, { life: rr(0.6, 1.6), size: 0.014, color: c, gain: 10, grav: 0.8, drag: 0.5 });
    }
    for (let i = 0; i < 10; i++) this.spawn(P.SMOKE, x + rr(-1, 1) * radius * 0.4, y + rr(0.3, 1.2), z + rr(-1, 1) * radius * 0.4, rr(-0.4, 0.4), rr(0.8, 2), rr(-0.4, 0.4), { life: rr(2.5, 4.5), size: radius * 0.4, size1: radius * 1.5, color: [0.12, 0.11, 0.11], alpha: 0.45, fade: 0.15, vrot: rr(-0.5, 0.5), drag: 0.4 });
    this.spawn(P.GLOW, x, y + 0.4, z, 0, 0, 0, { life: 0.28, size: radius * 2.2, size1: radius * 3.2, color: c, gain: 6, fade: 0.02 });
  }
  /** A burst of cold: chips of ice, a breath of mist. */
  frost(x, y, z, radius = 3) {
    for (let i = 0; i < 60; i++) {
      const a = rnd() * 6.283,
        sp = rr(1.5, 7) * (radius / 3);
      this.spawn(P.SHARD, x, y + 0.15, z, Math.cos(a) * sp, rr(0.5, 4.5), Math.sin(a) * sp, { life: rr(0.7, 1.7), size: rr(0.02, 0.06), color: [0.75, 0.9, 1.0], alpha: 0.95, grav: 0.9, drag: 0.8, vrot: rr(-9, 9), fade: 0.02 });
    }
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.283,
        r = rr(0, radius * 0.8);
      this.spawn(P.SMOKE, x + Math.cos(a) * r, y + rr(0.1, 0.5), z + Math.sin(a) * r, Math.cos(a) * rr(0.3, 1.2), rr(0.05, 0.4), Math.sin(a) * rr(0.3, 1.2), { life: rr(2.2, 4.2), size: radius * 0.35, size1: radius * 0.95, color: [0.8, 0.92, 1.0], alpha: 0.32, fade: 0.12, vrot: rr(-0.3, 0.3), drag: 0.9 });
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.283,
        r = rr(0, radius);
      this.spawn(P.GLOW, x + Math.cos(a) * r, y + rr(0.1, 1.4), z + Math.sin(a) * r, 0, rr(0.05, 0.4), 0, { life: rr(1, 2.6), size: rr(0.012, 0.03), color: [0.7, 0.9, 1], gain: 6, fade: 0.2 });
    }
    this.spawn(P.RING, x, y + 0.3, z, 0, 0, 0, { life: 0.45, size: radius * 0.3, size1: radius * 1.5, color: [0.6, 0.85, 1], gain: 3, rot: 0, fade: 0.01 });
  }
  /** Green waking: motes and leaves climbing a spiral. */
  verdance(x, y, z, radius = 2.5) {
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.283,
        r = rr(0.1, radius);
      this.spawn(P.GLOW, x + Math.cos(a) * r, y + rr(0, 0.5), z + Math.sin(a) * r, -Math.sin(a) * 0.9, rr(0.6, 2.4), Math.cos(a) * 0.9, { life: rr(1.4, 3), size: rr(0.014, 0.036), color: [0.45, 1.0, 0.35], gain: 5, fade: 0.2, drag: 0.3 });
    }
    for (let i = 0; i < 24; i++) {
      const a = rnd() * 6.283,
        sp = rr(0.6, 3);
      this.spawn(P.SHARD, x, y + 0.2, z, Math.cos(a) * sp, rr(1.2, 4), Math.sin(a) * sp, { life: rr(1.4, 2.8), size: rr(0.03, 0.06), color: [0.25, 0.42, 0.16], alpha: 0.95, grav: 0.35, drag: 1.3, vrot: rr(-5, 5) });
    }
    this.spawn(P.RING, x, y + 0.2, z, 0, 0, 0, { life: 0.6, size: radius * 0.2, size1: radius * 1.4, color: [0.4, 1, 0.3], gain: 2, fade: 0.01 });
  }
  /** Weight leaving: violet motes that only go up. */
  levity(x, y, z, radius = 3) {
    for (let i = 0; i < 60; i++) {
      const a = rnd() * 6.283,
        r = Math.sqrt(rnd()) * radius;
      this.spawn(P.GLOW, x + Math.cos(a) * r, y + rr(0, 0.6), z + Math.sin(a) * r, rr(-0.1, 0.1), rr(0.3, 1.6), rr(-0.1, 0.1), { life: rr(2, 4.5), size: rr(0.014, 0.04), color: [0.7, 0.6, 1.0], gain: 5, fade: 0.25 });
    }
    this.spawn(P.RING, x, y + 0.3, z, 0, 0, 0, { life: 0.8, size: radius * 0.2, size1: radius * 1.3, color: [0.6, 0.5, 1], gain: 2.4, fade: 0.01 });
  }
  /** Thunder: flash, shock front, sparks, a column of smoke, flying grit. */
  blast(x, y, z, radius = 5) {
    this.spawn(P.GLOW, x, y + 0.5, z, 0, 0, 0, { life: 0.22, size: radius * 1.6, size1: radius * 3.4, color: [1.0, 0.9, 0.55], gain: 14, fade: 0.01 });
    this.spawn(P.RING, x, y + 0.5, z, 0, 0, 0, { life: 0.5, size: radius * 0.4, size1: radius * 3.2, color: [1, 0.9, 0.6], gain: 4, fade: 0.01 });
    for (let i = 0; i < 90; i++) {
      const a = rnd() * 6.283,
        e = Math.acos(rr(-0.1, 1)),
        sp = rr(5, 19);
      this.spawn(P.STREAK, x, y + 0.3, z, Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp, Math.sin(a) * Math.sin(e) * sp, { life: rr(0.5, 1.5), size: 0.018, color: [1.0, 0.8, 0.35], gain: 12, grav: 0.9, drag: 0.7 });
    }
    for (let i = 0; i < 34; i++) {
      const a = rnd() * 6.283,
        sp = rr(1, 6);
      this.spawn(P.FLAME, x, y + 0.3, z, Math.cos(a) * sp, rr(1, 5), Math.sin(a) * sp, { life: rr(0.4, 0.9), size: radius * rr(0.2, 0.42), size1: radius * 0.1, color: [1.0, 0.72, 0.25], gain: 6, drag: 2.6, fade: 0.05 });
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.283,
        r = rr(0, radius * 0.5);
      this.spawn(P.SMOKE, x + Math.cos(a) * r, y + rr(0.2, 1.5), z + Math.sin(a) * r, Math.cos(a) * rr(0.5, 2.5), rr(1, 4.5), Math.sin(a) * rr(0.5, 2.5), { life: rr(3, 6), size: radius * 0.3, size1: radius * 1.3, color: [0.16, 0.15, 0.14], alpha: 0.55, fade: 0.08, vrot: rr(-0.6, 0.6), drag: 0.8 });
    }
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.283,
        sp = rr(3, 13);
      this.spawn(P.SHARD, x, y + 0.2, z, Math.cos(a) * sp, rr(3, 12), Math.sin(a) * sp, { life: rr(1, 2.4), size: rr(0.03, 0.09), color: [0.2, 0.19, 0.18], alpha: 1, grav: 1, drag: 0.25, vrot: rr(-12, 12) });
    }
  }
  /** Salt thrown up as a pillar rises. */
  salt(x, y, z, radius = 1.5) {
    for (let i = 0; i < 50; i++) {
      const a = rnd() * 6.283,
        sp = rr(0.8, 4);
      this.spawn(P.SHARD, x + Math.cos(a) * radius * 0.5, y + 0.1, z + Math.sin(a) * radius * 0.5, Math.cos(a) * sp, rr(1, 5.5), Math.sin(a) * sp, { life: rr(0.8, 1.9), size: rr(0.02, 0.055), color: [0.95, 0.88, 0.88], alpha: 1, grav: 1, drag: 0.5, vrot: rr(-9, 9) });
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * 6.283;
      this.spawn(P.SMOKE, x + Math.cos(a) * radius * 0.6, y + 0.2, z + Math.sin(a) * radius * 0.6, Math.cos(a) * rr(0.4, 1.4), rr(0.2, 0.9), Math.sin(a) * rr(0.4, 1.4), { life: rr(1.6, 3), size: radius * 0.4, size1: radius * 1.2, color: [0.85, 0.82, 0.8], alpha: 0.3, fade: 0.1, drag: 1.2 });
    }
  }
  /** Glass breaking: chips and a spray of what was inside. */
  shatter(x, y, z, color) {
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.283,
        sp = rr(0.8, 3.5);
      this.spawn(P.SHARD, x, y, z, Math.cos(a) * sp, rr(0.5, 3.2), Math.sin(a) * sp, { life: rr(0.5, 1.1), size: rr(0.012, 0.03), color: [0.7, 0.78, 0.76], alpha: 0.85, grav: 1, drag: 0.4, vrot: rr(-14, 14) });
    }
    for (let i = 0; i < 18; i++) {
      const a = rnd() * 6.283,
        sp = rr(0.6, 3);
      this.spawn(P.DROP, x, y, z, Math.cos(a) * sp, rr(0.6, 3.4), Math.sin(a) * sp, { life: rr(0.4, 0.9), size: rr(0.012, 0.026), color, grav: 1, drag: 0.3 });
    }
  }
  /** Water thrown up. */
  splash(x, y, z, power = 1) {
    const n = Math.round(18 * power);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283,
        sp = rr(0.5, 2.6) * Math.sqrt(power);
      this.spawn(P.DROP, x + Math.cos(a) * 0.1, y + 0.05, z + Math.sin(a) * 0.1, Math.cos(a) * sp, rr(1.5, 4.6) * Math.sqrt(power), Math.sin(a) * sp, { life: rr(0.5, 1.1), size: rr(0.015, 0.04), color: [0.5, 0.62, 0.66], grav: 1, drag: 0.2, floor: y - 0.05 });
    }
    this.spawn(P.RING, x, y + 0.05, z, 0, 0, 0, { life: 0.7, size: 0.2, size1: 1.3 * power, color: [0.5, 0.6, 0.65], gain: 0.5, fade: 0.01 });
  }
  /** Dust kicked off the ground. */
  dust(x, y, z, radius = 0.6, color = [0.42, 0.38, 0.33], n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283;
      this.spawn(P.SMOKE, x + Math.cos(a) * radius * 0.4, y + 0.1, z + Math.sin(a) * radius * 0.4, Math.cos(a) * rr(0.2, 1), rr(0.1, 0.6), Math.sin(a) * rr(0.2, 1), { life: rr(0.9, 1.9), size: radius * 0.5, size1: radius * 1.5, color, alpha: 0.22, fade: 0.15, drag: 1.5 });
    }
  }
  /** A Shade coming apart. */
  /** A plant taken from the ground: a few motes of its colour let go, and nothing to hide the view. */
  pluck(x, y, z, color = [1, 0.8, 0.5], n = 14) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283;
      this.spawn(P.GLOW, x + rr(-0.12, 0.12), y + rr(-0.3, 0.1), z + rr(-0.12, 0.12), Math.cos(a) * rr(0.1, 0.7), rr(0.5, 2), Math.sin(a) * rr(0.1, 0.7), { life: rr(0.7, 1.6), size: rr(0.012, 0.028), color, gain: 6, fade: 0.1, drag: 0.5 });
    }
  }
  wisp(x, y, z, color = [0.5, 0.35, 0.8], n = 40) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283;
      this.spawn(P.SMOKE, x + rr(-0.4, 0.4), y + rr(0, 2), z + rr(-0.4, 0.4), Math.cos(a) * rr(0.2, 1.4), rr(0.3, 1.8), Math.sin(a) * rr(0.2, 1.4), { life: rr(1, 2.6), size: 0.3, size1: rr(0.8, 1.5), color: [0.05, 0.04, 0.07], alpha: 0.6, fade: 0.05, drag: 0.8, vrot: rr(-1, 1) });
      if (i % 2) this.spawn(P.GLOW, x + rr(-0.4, 0.4), y + rr(0.2, 2), z + rr(-0.4, 0.4), Math.cos(a) * rr(0.2, 1), rr(0.4, 2.2), Math.sin(a) * rr(0.2, 1), { life: rr(1, 2.4), size: rr(0.012, 0.03), color, gain: 6, fade: 0.1 });
    }
  }

  update(dt, camera) {
    const wv = shared.uWind.value;
    const wind = [wv.x * wv.z * 1.6, wv.y * wv.z * 1.6];
    const cx = camera.position.x,
      cy = camera.position.y,
      cz = camera.position.z;
    for (const e of this.emitters) {
      if (!e.active) continue;
      const dx = e.x - cx,
        dy = e.y - cy,
        dz = e.z - cz;
      const far = e.far || 70;
      if (dx * dx + dy * dy + dz * dz > far * far) continue;
      this._emit(e, dt, wind);
    }
    // integrate; dead particles are replaced by the last live one
    const pos = this.aPos.array,
      col = this.aCol.array,
      misc = this.aMisc.array,
      vel = this.aVel.array;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      const a = this.age[i] + dt;
      if (a >= this.life[i] || this.py[i] < this.floor[i]) {
        n--;
        if (i < n) {
          this.px[i] = this.px[n];
          this.py[i] = this.py[n];
          this.pz[i] = this.pz[n];
          this.vx[i] = this.vx[n];
          this.vy[i] = this.vy[n];
          this.vz[i] = this.vz[n];
          this.age[i] = this.age[n];
          this.life[i] = this.life[n];
          this.s0[i] = this.s0[n];
          this.s1[i] = this.s1[n];
          this.cr[i] = this.cr[n];
          this.cg[i] = this.cg[n];
          this.cb[i] = this.cb[n];
          this.al[i] = this.al[n];
          this.kind[i] = this.kind[n];
          this.rot[i] = this.rot[n];
          this.vrot[i] = this.vrot[n];
          this.drag[i] = this.drag[n];
          this.grav[i] = this.grav[n];
          this.seed[i] = this.seed[n];
          this.fade[i] = this.fade[n];
          this.floor[i] = this.floor[n];
          i--;
        }
        continue;
      }
      this.age[i] = a;
      const d = this.drag[i];
      if (d > 0) {
        const k = Math.exp(-d * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
        this.vz[i] *= k;
      }
      this.vy[i] -= 9.8 * this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.vrot[i] * dt;
      const t = a / this.life[i];
      const f = this.fade[i];
      const env = t < f ? t / f : 1 - Math.max(0, (t - 0.55) / 0.45);
      const j4 = i * 4,
        j3 = i * 3;
      pos[j4] = this.px[i];
      pos[j4 + 1] = this.py[i];
      pos[j4 + 2] = this.pz[i];
      pos[j4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      col[j4] = this.cr[i];
      col[j4 + 1] = this.cg[i];
      col[j4 + 2] = this.cb[i];
      col[j4 + 3] = this.al[i] * env;
      misc[j4] = this.rot[i];
      misc[j4 + 1] = this.kind[i];
      misc[j4 + 2] = t;
      misc[j4 + 3] = this.seed[i];
      vel[j3] = this.vx[i];
      vel[j3 + 1] = this.vy[i];
      vel[j3 + 2] = this.vz[i];
    }
    this.n = n;
    const g = this.mesh.geometry;
    g.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const [a, size] of [
        [this.aPos, 4],
        [this.aCol, 4],
        [this.aMisc, 4],
        [this.aVel, 3],
      ]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * size);
        a.needsUpdate = true;
      }
    }
  }
}
