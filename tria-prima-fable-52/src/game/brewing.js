// The cauldron: the rules of a brew (what the chart, the fire and the ladle decide) and the pot
// itself seen from above — a dye field stirred on the GPU, coals, flame, steam, the bellows.
import * as THREE from 'three';
import { INGREDIENTS, POTIONS, OPUS, BREW, PRIME_ORDER, mixOf, regionAt, yieldFor, heatFit } from './data.js';
import { add, count, hasAllPrimes } from './state.js';
import { heatMaterial } from './fx.js';
import { sharedUniforms } from '../gfx/shared.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';
import { clamp, damp, lerp, easeInOutCubic } from '../core/math.js';

const SIM = 256;
const EMPTY = new THREE.Color(0.012, 0.016, 0.02);

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Dye carried round the pot: a swirl from the ladle, turbulence from the heat, splashes of colour.
const SIM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev;
uniform sampler2D uNoise;
uniform float uDt;
uniform float uT;
uniform float uStir;
uniform float uHeat;
uniform float uMix;
uniform vec3 uTarget;
uniform vec4 uSplat[4];
uniform vec3 uSplatCol[4];

float pot(vec2 p) {
  return texture2D(uNoise, p * 0.23 + vec2(uT * 0.011, -uT * 0.008)).r + 0.5 * texture2D(uNoise, p * 0.61 - vec2(uT * 0.017, uT * 0.013)).g;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // the ladle drags the middle round; the wall holds the edge back
  vec2 swirl = vec2(-p.y, p.x) * uStir * (0.25 + 0.75 * smoothstep(0.0, 0.45, r)) * smoothstep(1.02, 0.7, r);
  float e = 0.02;
  float n0 = pot(p), nx = pot(p + vec2(e, 0.0)), ny = pot(p + vec2(0.0, e));
  vec2 curl = vec2(ny - n0, -(nx - n0)) / e;
  vec2 vel = swirl + curl * (0.012 + 0.11 * uHeat + 0.05 * abs(uStir));
  // a slow draw toward the middle while stirring: the vortex
  vel -= p * abs(uStir) * 0.035;
  vec2 src = vUv - vel * uDt * 0.5;
  vec4 c = texture2D(tPrev, src);
  vec2 px = vec2(1.0 / ${SIM}.0);
  vec4 blur = 0.25 * (texture2D(tPrev, src + vec2(px.x, 0.0)) + texture2D(tPrev, src - vec2(px.x, 0.0)) + texture2D(tPrev, src + vec2(0.0, px.y)) + texture2D(tPrev, src - vec2(0.0, px.y)));
  c = mix(c, blur, 0.045);
  c.rgb = mix(c.rgb, uTarget, clamp(uMix * uDt, 0.0, 1.0));
  c.a *= exp(-uDt * 0.9);
  for (int i = 0; i < 4; i++) {
    vec4 s = uSplat[i];
    if (s.w <= 0.0) continue;
    vec2 d = vUv - s.xy;
    float k = exp(-dot(d, d) / (s.z * s.z)) * s.w;
    c.rgb = mix(c.rgb, uSplatCol[i], clamp(k, 0.0, 1.0));
    c.a = max(c.a, clamp(k, 0.0, 1.0));
  }
  gl_FragColor = c;
}
`;

const SURF_VERT = /* glsl */ `
#include <common>
varying vec2 vUv;
varying vec3 vWorld;
uniform float uStirAbs;
uniform float uHeat;
void main() {
  vUv = uv;
  vec3 p = position;
  float r = length(uv * 2.0 - 1.0);
  // the vortex pulls the middle down; the boil lifts it in patches
  p.z -= uStirAbs * 0.075 * exp(-r * r * 5.0);
  p.z += (tpNoise(vec3(uv * 9.0, uTime * 1.4)) - 0.5) * 0.02 * uHeat;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURF_FRAG = /* glsl */ `
#include <common>
varying vec2 vUv;
varying vec3 vWorld;
uniform sampler2D tDye;
uniform float uGlowK;
uniform float uHeat;
uniform float uStirAbs;
uniform vec3 uFire;

float hgt(vec2 uv) {
  vec4 d = texture2D(tDye, uv);
  float l = dot(d.rgb, vec3(0.3, 0.5, 0.2));
  vec2 p = uv * 2.0 - 1.0;
  float r = length(p);
  float rip = sin(r * 30.0 - uTime * 3.0) * 0.012 * uStirAbs;
  float boil = (1.0 - smoothstep(0.0, 0.3, tpCells(vec3(uv * 8.0, uTime * (0.25 + uHeat * 0.9))))) * uHeat * uHeat;
  return l * 0.25 + d.a * 0.06 + rip + boil * 0.07 + tpNoise(vec3(uv * 22.0, uTime * 0.8)) * 0.012 * (0.3 + uHeat);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  vec4 d = texture2D(tDye, vUv);
  float e = 1.0 / ${SIM}.0 * 1.5;
  float h0 = hgt(vUv), hx = hgt(vUv + vec2(e, 0.0)), hy = hgt(vUv + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.09, 1.0, (hy - h0) / e * 0.09));
  vec3 v = normalize(cameraPosition - vWorld);
  // (a little deeper than the dye itself: lit from every side at once it would wash out to cream)
  vec3 base = d.rgb * d.rgb / max(max(d.r, max(d.g, d.b)), 0.08);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 col = base * (uAmbient * 0.8 + uSunColor * ndl * 0.3);
  // firelight creeping over the rim
  col += base * uFire * 0.35 * smoothstep(0.55, 1.0, r);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = tpSkyColor(reflect(-v, n));
  col = mix(col, refl, fres * 0.45);
  vec3 hv = normalize(v + uSunDir);
  col += uSunColor * pow(max(dot(n, hv), 0.0), 220.0) * 1.6;
  // what is bound in it shines by itself
  // (kept inside the gamut: the colour of the work must survive the glow)
  float veins = 0.5 + 0.75 * d.a + 0.45 * tpNoise(vec3(vUv * 14.0, uTime * 0.5));
  col += base * uGlowK * veins * 0.7;
  // the wall of the pot shades the edge
  col *= 1.0 - 0.55 * smoothstep(0.82, 1.0, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _v = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Brewing {
  constructor(game) {
    this.game = game;
    this.pot = null;
    this.k = 0; // 0 walking view .. 1 brew view
    this.angle = 0.7;
    this.dir = 1;
    this.spin = 0; // rad/s of the ladle, signed
    this.autoStir = 0; // tests and keys
    this._phi = null;
    this._splats = [];
    this._pumpT = 0;
    this._bub = 0;
    this._from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.loops = { fire: null, bubble: null, stir: null };
    this.stone = null;
    this.endT = 0;
  }

  build() {
    const g = this.game,
      N = g.world.named,
      r = g.engine.renderer;
    const c = N.cauldron;
    if (!c) return;
    this.pot = c;
    this.surface = c.anchor('surface');
    this.viewAt = c.anchor('view');
    this.fireAt = c.anchor('fire');
    const R = (c.model.meta && c.model.meta.surfaceRadius) || 0.5;
    this.radius = R * c.scale;

    // coals and flame
    this.coals = heatMaterial();
    if (c.parts.coals) c.parts.coals.material = this.coals;
    this.fire = g.fx.source({ x: this.fireAt.x, y: this.fireAt.y, z: this.fireAt.z, kind: 'fire', size: 0.36, smoke: 0.5, light: { color: '#ff8a3c', intensity: 12, range: 10, dy: 0.25 }, on: false, far: 60 });
    this.steam = g.fx.source({ x: this.surface.x, y: this.surface.y + 0.12, z: this.surface.z, kind: 'steam', size: 0.42, rate: 0.55, alpha: 0.085, color: [0.5, 0.47, 0.44], on: false, far: 40 });

    // the ladle on a pivot so it can go round
    if (c.parts.ladle) {
      const la = c.model.anchors.surface;
      this.ladle = new THREE.Group();
      this.ladle.position.set(la[0], la[1], la[2]);
      c.object.add(this.ladle);
      this.ladleArm = new THREE.Group();
      this.ladleArm.position.set(R * 0.5, 0, 0);
      this.ladleArm.rotation.z = -0.3;
      this.ladle.add(this.ladleArm);
      this.ladleArm.add(c.parts.ladle);
      c.parts.ladle.position.set(-la[0], -la[1], -la[2]);
    }
    // the bellows board
    const b = N.bellows;
    if (b && b.parts.top && b.model.anchors.hinge) {
      const h = b.model.anchors.hinge;
      this.bellows = new THREE.Group();
      this.bellows.position.set(h[0], h[1], h[2]);
      b.object.add(this.bellows);
      this.bellows.add(b.parts.top);
      b.parts.top.position.set(-h[0], -h[1], -h[2]);
      this.bellowsAt = b.anchor([0, 0.2, 0]);
    }

    // the dye field
    const mk = () => new THREE.WebGLRenderTarget(SIM, SIM, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt = [mk(), mk()];
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.simMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPrev: { value: null },
        uNoise: { value: g.engine.renderer ? sharedUniforms().uNoiseTex.value : null },
        uDt: { value: 0 },
        uT: { value: 0 },
        uStir: { value: 0 },
        uHeat: { value: 0 },
        uMix: { value: 0.2 },
        uTarget: { value: EMPTY.clone() },
        uSplat: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uSplatCol: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      },
    });
    this.simQuad = new THREE.Mesh(quad, this.simMat);
    this.simQuad.frustumCulled = false;
    this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // start as still dark water
    const old = r.getRenderTarget();
    for (const t of this.rt) {
      r.setRenderTarget(t);
      r.setClearColor(EMPTY, 0);
      r.clear(true, false, false);
    }
    r.setRenderTarget(old);

    this.surfMat = new THREE.ShaderMaterial({
      vertexShader: SURF_VERT,
      fragmentShader: SURF_FRAG,
      uniforms: sharedUniforms({ tDye: { value: this.rt[0].texture }, uGlowK: { value: 0 }, uHeat: { value: 0 }, uStirAbs: { value: 0 }, uFire: { value: new THREE.Color(0, 0, 0) } }),
      fog: false,
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(this.radius * 2, this.radius * 2, 48, 48), this.surfMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(this.surface);
    disc.frustumCulled = false;
    disc.layers.set(LAYER_MAIN_ONLY);
    g.engine.scene.add(disc);
    this.disc = disc;
    this.target = EMPTY.clone();
    this.glow = 0;
  }

  // ------------------------------------------------------------------------------ rules
  _recompute() {
    const b = this.game.brew;
    const plain = b.contents.filter((c) => !c.startsWith('prime:'));
    const m = mixOf(plain);
    b.mix = m.bary;
    if (b.opus) {
      b.mix = OPUS.center.slice();
      b.region = null;
      b.band = OPUS.stages[Math.min(3, b.opus.stage)].heat;
    } else {
      b.region = regionAt(b.mix);
      b.band = b.region ? POTIONS[b.region.id].heat : null;
    }
  }
  _splat(color, strength = 1, radius = 0.16) {
    const a = Math.random() * 6.283,
      r = Math.sqrt(Math.random()) * 0.3;
    this._splats.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, r: radius, w: strength, c: new THREE.Color(color) });
    if (this._splats.length > 4) this._splats.shift();
  }

  add(id) {
    const g = this.game,
      st = g.state,
      b = g.brew;
    if (!b.active) return;
    if (b.ready) return this._refuse('Bottle what is bound first.');
    if (b.opus) return this._refuse('The Work has begun. It wants nothing else.');
    if (id.startsWith('prime:')) {
      const pid = id.slice(6);
      if (!st.inv.primes[pid] || st.inv.stone) return;
      if (b.contents.includes(id)) return;
      if (b.contents.some((c) => !c.startsWith('prime:'))) return this._refuse('Empty the pot first. The Work wants nothing else in it.');
      b.contents.push(id);
      g.audio.sfx('drop_in', { gain: 0.9, pitch: 0.7 });
      this._splat(g.data.PRIME_ITEMS[pid].color, 1.2, 0.2);
      g.particles.splash(this.surface.x, this.surface.y, this.surface.z, 0.5);
      g.bus.emit('brew:add', { id });
      if (PRIME_ORDER.every((p) => b.contents.includes('prime:' + p))) {
        b.opus = { stage: 0, progress: 0, done: false };
        b.progress = 0;
        g.bus.emit('opus:stage', { stage: 0 });
        g.audio.sfx('opus_stage');
      }
      this._recompute();
      return;
    }
    const ing = INGREDIENTS[id];
    if (!ing || count(st.inv.ingredients, id) <= 0) return;
    if (b.contents.some((c) => c.startsWith('prime:'))) return this._refuse('The Primes are in the pot. Nothing else goes with them.');
    if (b.contents.length >= BREW.capacity) return this._refuse('The pot is full.');
    add(st.inv.ingredients, id, -1);
    if (b.mix) b.trail.push(b.mix.slice());
    if (b.trail.length > 12) b.trail.shift();
    const was = b.region && b.region.id;
    b.contents.push(id);
    this._recompute();
    if (!b.region || b.region.id !== was) b.progress = 0;
    else b.progress *= 0.6;
    g.audio.sfx('drop_in');
    this._splat(ing.color, 1.1, 0.14 + ing.weight * 0.04);
    g.particles.splash(this.surface.x + (Math.random() - 0.5) * 0.3, this.surface.y, this.surface.z + (Math.random() - 0.5) * 0.3, 0.45);
    g.bus.emit('brew:add', { id });
  }
  _refuse(line) {
    const g = this.game;
    g.brew.hint = line;
    this._hintHold = 2.6;
    g.audio.sfx('brew_fail', { gain: 0.6 });
  }
  pump(on) {
    this.pumping = !!on;
  }
  damp(on) {
    this.damping = !!on;
  }
  bottle() {
    const g = this.game,
      st = g.state,
      b = g.brew;
    if (!b.ready) return;
    const { potion, count: n } = b.ready;
    const have = count(st.inv.potions, potion);
    const got = Math.min(n, BREW.maxCarry - have);
    if (got <= 0) return this._refuse('You cannot carry more ' + POTIONS[potion].name + '.');
    add(st.inv.potions, potion, got, BREW.maxCarry);
    st.stats.brewed += got;
    if (!st.inv.selected) st.inv.selected = potion;
    g.audio.sfx('bottle_fill');
    g.after.push({ t: 0.5, fn: () => g.audio.sfx('cork') });
    g.bus.emit('brew:bottled', { potion, count: got });
    g.bus.emit('pickup', { kind: 'potion', id: potion, count: st.inv.potions[potion] });
    g.toast('pickup', POTIONS[potion].full, '×' + got, { kind: 'potion', id: potion });
    b.contents = [];
    b.trail = [];
    b.ready = null;
    b.progress = 0;
    this._recompute();
    g.quests.check();
    g.save();
  }
  empty() {
    const g = this.game,
      b = g.brew;
    if (b.opus && b.opus.done) return;
    if (!b.contents.length) return;
    b.contents = [];
    b.trail = [];
    b.ready = null;
    b.progress = 0;
    b.opus = null;
    this._recompute();
    g.audio.sfx('splash', { gain: 0.6 });
    if (b.heat > 0.3) g.audio.sfx('steam', { gain: 0.5 });
    this._splat('#05070a', 2.5, 0.6);
  }

  enter() {
    const g = this.game,
      b = g.brew;
    if (!this.pot || g.state.mode !== 'play') return;
    b.active = true;
    this._from.pos.copy(g.engine.camera.position);
    this._from.quat.copy(g.engine.camera.quaternion);
    this._phi = null;
    g.setMode('brew');
    g.input.releaseLock();
    g.audio.sfx('ui_open', { gain: 0.6 });
  }
  leave() {
    const g = this.game,
      b = g.brew;
    if (!b.active) return;
    if (b.opus && b.opus.done && this.endT > 0) return;
    b.active = false;
    this.pumping = this.damping = false;
    g.setMode('play');
    g.input.requestLock();
    g.audio.sfx('ui_close', { gain: 0.6 });
  }

  // ------------------------------------------------------------------------------ per frame
  /** Runs always: the fire dies down whether or not anyone is watching. */
  update(dt, input) {
    const g = this.game,
      b = g.brew,
      st = g.state;
    if (!this.pot) return;
    const active = b.active && st.mode === 'brew';
    this.k = clamp(this.k + (active ? dt / 0.7 : -dt / 0.5), 0, 1);

    // --- the hands
    let pump = false,
      dampOn = false,
      stirIn = 0;
    if (active) {
      pump = this.pumping || input.held('Space');
      dampOn = this.damping || input.held('KeyC');
      if (input.hit('KeyB')) this.bottle();
      if (input.hit('KeyX')) this.empty();
      // circling the pointer over the pot stirs it
      const cam = g.engine.camera;
      _v.copy(this.surface).project(cam);
      const W = g.engine.canvas.clientWidth || 1,
        H = g.engine.canvas.clientHeight || 1;
      const cx = (_v.x * 0.5 + 0.5) * W,
        cy = (-_v.y * 0.5 + 0.5) * H;
      const dx = input.mx * W - cx,
        dy = input.my * H - cy;
      const rr = Math.hypot(dx, dy);
      if (rr > H * 0.03 && rr < H * 0.46 && input.mx < 0.6) {
        const phi = Math.atan2(dy, dx);
        if (this._phi != null && dt > 0) {
          let d = phi - this._phi;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          const w = clamp(d / dt, -14, 14);
          if (Math.abs(w) > 0.4) {
            stirIn = clamp(Math.abs(w) / 6.5, 0, 1);
            this.dir = w > 0 ? 1 : -1;
          }
        }
        this._phi = phi;
      } else this._phi = null;
      if (input.held('KeyE') || input.held('KeyD')) {
        stirIn = Math.max(stirIn, 0.8);
        this.dir = 1;
      } else if (input.held('KeyQ') || input.held('KeyA')) {
        stirIn = Math.max(stirIn, 0.8);
        this.dir = -1;
      }
      if (this.autoStir) stirIn = Math.max(stirIn, this.autoStir);
      if (input.hit('Escape')) this.leave();
    }
    b.stir = damp(b.stir, stirIn, stirIn > b.stir ? 5 : 2.2, dt);
    // screen angle runs clockwise, the pot is seen from the south: the ladle follows the hand
    this.spin = damp(this.spin, -this.dir * b.stir * 6.5, 6, dt);
    this.angle += this.spin * dt;

    // --- fire and heat
    const fire0 = b.fire;
    b.fire = clamp(b.fire + (pump ? 0.55 : 0) * dt - (dampOn ? 0.5 : 0.045) * dt, 0, 1);
    b.heat += (b.fire - b.heat) * (1 - Math.exp(-0.55 * dt));
    if (pump) {
      this._pumpT -= dt;
      if (this._pumpT <= 0) {
        this._pumpT = 0.62;
        g.audio.sfx('bellows', { gain: 0.7 });
        g.particles.spawn(4, this.fireAt.x + (Math.random() - 0.5) * 0.4, this.fireAt.y + 0.1, this.fireAt.z + 0.3, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, 0.8 + Math.random(), { life: 0.7, size: 0.012, color: [1, 0.5, 0.15], gain: 8, grav: 0.4, drag: 0.8 });
      }
    } else this._pumpT = 0;
    if (dampOn && fire0 > 0.05 && Math.random() < dt * 4) g.particles.spawn(2, this.fireAt.x, this.fireAt.y + 0.2, this.fireAt.z, (Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4, { life: 2, size: 0.3, size1: 0.9, color: [0.25, 0.24, 0.23], alpha: 0.3 });

    // --- binding
    this._hintHold = Math.max(0, (this._hintHold || 0) - dt);
    if (b.opus) this._opus(dt);
    else {
      b.fit = b.band ? heatFit(b.heat, b.band) : null;
      if (b.region && !b.ready && b.contents.length) {
        if (b.fit === 0) {
          if (b.stir > 0.08) b.progress += (dt / BREW.bindSeconds) * (0.3 + b.stir);
        } else b.progress = Math.max(0, b.progress - dt * 0.07);
        if (b.progress >= 1) {
          b.progress = 1;
          b.ready = { potion: b.region.id, stars: b.region.stars, count: yieldFor(b.region.stars) };
          const first = !st.known.potions[b.region.id];
          st.known.potions[b.region.id] = true;
          st.known.charted[b.region.id] = true;
          g.audio.sfx('brew_ready');
          g.bus.emit('brew:ready', { ...b.ready });
          if (first) g.bus.emit('discover', { kind: 'potion', id: b.region.id });
          this._splat(POTIONS[b.region.id].color2, 1.4, 0.3);
        }
      } else if (!b.region) b.progress = Math.max(0, b.progress - dt * 0.3);
      if (this._hintHold <= 0) b.hint = this._hint(b);
    }

    // --- sound
    this._loop('fire', b.fire > 0.03, this.fireAt, b.fire, 0.8);
    this._loop('bubble', b.contents.length > 0 && b.heat > 0.22, this.surface, b.heat, 0.7);
    this._loop('stir', active && b.stir > 0.06, this.surface, b.stir, 0.6);

    // --- the pot
    this.coals.userData.u.uHeat.value = b.fire;
    g.fx.set(this.fire, { on: b.fire > 0.03, power: 0.3 + b.fire * 1.1 });
    this.fire.light.intensity = 5 + 16 * b.fire;
    g.fx.set(this.steam, { on: b.contents.length > 0 && b.heat > 0.25, power: 0.3 + b.heat * 1.4 });
    if (this.ladle) {
      this.ladle.rotation.y = this.angle;
      this.ladleArm.rotation.z = -0.3 - 0.06 * b.stir;
    }
    if (this.bellows) this.bellows.rotation.x = pump ? -(0.16 + 0.14 * Math.sin(g.engine.time * 10)) : damp(this.bellows.rotation.x, 0, 6, dt);
    // bubbles that burst
    if (b.contents.length && b.heat > 0.5) {
      this._bub += dt * (b.heat - 0.4) * 9;
      while (this._bub > 1) {
        this._bub -= 1;
        const a = Math.random() * 6.283,
          r = Math.sqrt(Math.random()) * this.radius * 0.85;
        g.particles.spawn(6, this.surface.x + Math.cos(a) * r, this.surface.y + 0.02, this.surface.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.25, 0.45 + Math.random() * 0.5, (Math.random() - 0.5) * 0.25, { life: 0.42, size: 0.009, color: [this.target.r * 0.7 + 0.03, this.target.g * 0.7 + 0.03, this.target.b * 0.7 + 0.03], gain: 0.8 + this.glow * 0.8, grav: 1, floor: this.surface.y - 0.02 });
      }
    }

    this._simulate(dt, b);

    // --- the Stone rises out of the red
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.stone) {
        const k = clamp(1 - this.endT / 3.2, 0, 1);
        this.stone.object.position.y = this.surface.y - 0.1 + easeInOutCubic(k) * 0.5;
        this.stone.object.rotation.y += dt * 1.4;
      }
      if (this.endT <= 0) {
        if (this.stone) {
          for (const s of this.stoneFx || []) g.fx.remove(s);
          g.world.remove(this.stone);
          this.stone = null;
        }
        b.contents = [];
        b.opus = null;
        b.progress = 0;
        this._recompute();
        this.leave();
        g.quests.check();
        g.save();
      }
    }
  }

  _opus(dt) {
    const g = this.game,
      b = g.brew,
      o = b.opus;
    if (o.done) {
      b.hint = 'The Stone.';
      return;
    }
    const stage = OPUS.stages[o.stage];
    b.band = stage.heat;
    b.fit = heatFit(b.heat, stage.heat);
    if (b.fit === 0 && b.stir > 0.08) o.progress += (dt / stage.seconds) * (0.3 + b.stir);
    else o.progress = Math.max(0, o.progress - dt * 0.04);
    b.progress = o.progress;
    if (o.progress >= 1) {
      this._splat(stage.color, 1.5, 0.5);
      if (o.stage < 3) {
        o.stage++;
        o.progress = 0;
        g.audio.sfx('opus_stage');
        g.bus.emit('opus:stage', { stage: o.stage });
      } else {
        o.done = true;
        o.progress = 1;
        const st = g.state;
        st.inv.stone = true;
        g.audio.sfx('stone_form');
        g.bus.emit('opus:done', {});
        g.fx.flash(this.surface.x, this.surface.y + 0.5, this.surface.z, '#ff3020', 160, 30, 3);
        this.endT = 4.2;
        this.stone = g.world.place('stone', this.surface.x, this.surface.y - 0.1, this.surface.z, 0, { collide: false, scale: 1.5 });
        if (this.stone) this.stoneFx = g.fx.attach(this.stone, { far: 40 });
        g.save();
      }
    }
    if (this._hintHold <= 0) {
      const names = ['Nigredo: the embers almost out. Stir.', 'Albedo: a gentle heat. Stir.', 'Citrinitas: a strong fire. Stir.', 'Rubedo: let the bellows roar. Do not stop.'];
      b.hint = b.fit === 0 ? (b.stir > 0.08 ? stage.name + '. ' + cap(stage.sub) + '.' : 'Stir.') : b.fit < 0 ? names[o.stage] : o.stage === 0 ? 'Too hot for the black. Close the damper.' : 'Too hot. Close the damper.';
    }
  }

  _hint(b) {
    if (b.ready) return 'It is bound. Bottle it.';
    if (!b.contents.length) return hasAllPrimes(this.game.state) && !this.game.state.inv.stone ? 'The three Primes are with you. Give them to the pot.' : 'Add what you have gathered.';
    if (!b.region) return 'The mixture has no name yet. Add more, or empty the pot.';
    if (b.fit < 0) return 'Too cold. Work the bellows.';
    if (b.fit > 0) return 'Too hot. Close the damper and wait.';
    if (b.stir < 0.08) return 'The fire is right. Circle the ladle to stir.';
    return 'It binds.';
  }

  _loop(name, on, at, param, gain) {
    const L = this.loops;
    if (on && !L[name]) L[name] = this.game.audio.loop(name, { pos: [at.x, at.y, at.z], gain });
    if (L[name]) {
      if (on) L[name].set({ param });
      else {
        L[name].stop(0.5);
        L[name] = null;
      }
    }
  }

  /** What colour the pot is working toward, and how much it shines. */
  _look(b) {
    const t = this.target;
    let glow = 0,
      mix = 0.12;
    if (b.opus) {
      const o = b.opus;
      const prev = o.stage > 0 ? OPUS.stages[o.stage - 1].color : '#6c6a70';
      _c.set(prev);
      _c2.set(OPUS.stages[Math.min(3, o.stage)].color);
      t.copy(_c).lerp(_c2, clamp(o.progress * 1.15, 0, 1));
      glow = [0.0, 0.25, 0.7, 1.3][o.stage] * (0.4 + 0.6 * o.progress) + (o.done ? 1.2 : 0);
      mix = 0.5 + b.stir;
    } else if (!b.contents.length) {
      t.copy(EMPTY);
      mix = 0.6;
    } else {
      // the muddle of what went in
      let r = 0,
        gg = 0,
        bl = 0,
        n = 0;
      for (const id of b.contents) {
        const ing = INGREDIENTS[id];
        if (!ing) continue;
        _c.set(ing.color);
        r += _c.r;
        gg += _c.g;
        bl += _c.b;
        n++;
      }
      if (n) t.setRGB((r / n) * 0.42, (gg / n) * 0.42, (bl / n) * 0.42);
      mix = 0.05 + b.stir * 0.5;
      if (b.region) {
        const p = POTIONS[b.region.id];
        _c.set(p.color);
        t.lerp(_c, 0.25 + 0.75 * b.progress);
        glow = b.fit === 0 ? 0.08 + 0.5 * b.progress : 0.03;
        if (b.ready) {
          _c.set(p.color2);
          t.lerp(_c, 0.25);
          glow = 1.0 + 0.25 * Math.sin(this.game.engine.time * 3);
          mix = 0.8;
        }
      }
    }
    this.glow = glow;
    return mix;
  }

  _simulate(dt, b) {
    const g = this.game,
      r = g.engine.renderer;
    const near = this.k > 0 || this._splats.length || Math.hypot(g.player.pos.x - this.surface.x, g.player.pos.z - this.surface.z) < 30;
    const mix = this._look(b);
    const su = this.surfMat.uniforms;
    su.uGlowK.value = damp(su.uGlowK.value, this.glow, 3, dt);
    su.uHeat.value = b.contents.length ? b.heat : b.heat * 0.3;
    su.uStirAbs.value = Math.abs(this.spin) / 6.5;
    su.uFire.value.setRGB(1.0 * b.fire, 0.35 * b.fire, 0.08 * b.fire);
    if (!near || dt <= 0) return;
    const u = this.simMat.uniforms;
    u.tPrev.value = this.rt[0].texture;
    u.uNoise.value = g.engine.renderer ? sharedUniforms().uNoiseTex.value : null;
    u.uDt.value = Math.min(dt, 0.05);
    u.uT.value = g.engine.time;
    u.uStir.value = this.spin * 0.16;
    u.uHeat.value = b.contents.length ? b.heat : 0.1 * b.heat;
    u.uMix.value = mix;
    u.uTarget.value.copy(this.target);
    for (let i = 0; i < 4; i++) {
      const s = this._splats[i];
      if (s) {
        u.uSplat.value[i].set(s.x, s.y, s.r, s.w);
        u.uSplatCol.value[i].copy(s.c);
        // a splash lands over a few frames
        s.w -= dt * 5;
      } else u.uSplat.value[i].set(0, 0, 1, 0);
    }
    this._splats = this._splats.filter((s) => s.w > 0);
    const old = r.getRenderTarget();
    r.setRenderTarget(this.rt[1]);
    r.render(this.simQuad, this.simCam);
    r.setRenderTarget(old);
    this.rt.reverse();
    su.tDye.value = this.rt[0].texture;
  }

  /** The eye over the pot, blended from wherever the apprentice stood. Call after the player has placed the camera. */
  camera() {
    const g = this.game,
      cam = g.engine.camera;
    if (this.k <= 0 || !this.pot) {
      if (this._offset) {
        cam.clearViewOffset();
        this._offset = false;
        g.engine.setFov(g.settings.fov);
        g.engine.post.dof = 0;
      }
      return;
    }
    const e = easeInOutCubic(this.k);
    if (g.state.mode === 'brew') {
      // the walking camera does not move while we brew
    } else {
      this._from.pos.copy(cam.position);
      this._from.quat.copy(cam.quaternion);
    }
    _m.lookAt(this.viewAt, _v.copy(this.surface).setY(this.surface.y + 0.06), UP);
    _q1.setFromRotationMatrix(_m);
    cam.position.lerpVectors(this._from.pos, this.viewAt, e);
    cam.quaternion.copy(_q0.copy(this._from.quat).slerp(_q1, e));
    const W = g.engine.w,
      H = g.engine.h;
    cam.setViewOffset(W, H, 0.21 * W * e, 0, W, H);
    this._offset = true;
    const fov = lerp(g.settings.fov, 52, e);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      g.engine.lighting.refresh();
    }
    g.engine.post.dof = 0.55 * e;
    g.engine.post.focus = this.viewAt.distanceTo(this.surface);
    g.engine.post.focusRange = 1.6;
  }

  /** The pot as a fresh game finds it. */
  reset() {
    const b = this.game.brew;
    Object.assign(b, { active: false, contents: [], mix: null, trail: [], fire: 0, heat: 0, region: null, band: null, fit: null, stir: 0, progress: 0, ready: null, opus: null, hint: '' });
    this.k = 0;
    this.endT = 0;
    this._splats.length = 0;
    this._splat('#05070a', 3, 1.5);
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
