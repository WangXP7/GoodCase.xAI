// What potions leave on the land: a world-sized mask the terrain and the grass read.
// r = scorch (stays), g = frost (melts away), b = bloom (stays), a = unused.
import * as THREE from 'three';
import { shared } from './shared.js';
import { WORLD } from '../world/heightmap.js';

const SIZE = 1024;

const VERT = /* glsl */ `
uniform vec4 uRect; // centre (uv), half size (uv)
varying vec2 vP;
void main() {
  vP = position.xy;
  vec2 uv = uRect.xy + position.xy * uRect.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;
const FRAG = /* glsl */ `
precision highp float;
uniform vec4 uMask;
uniform float uStrength;
uniform float uSeed;
varying vec2 vP;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float d = length(vP);
  float n = noise(vP * 3.0 + uSeed) * 0.6 + noise(vP * 8.0 + uSeed * 1.7) * 0.4;
  float a = smoothstep(1.0, 0.35, d + (n - 0.5) * 0.55) * uStrength;
  gl_FragColor = uMask * a;
}
`;

export class FxMask {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = { uRect: { value: new THREE.Vector4() }, uMask: { value: new THREE.Vector4() }, uStrength: { value: 1 }, uSeed: { value: 0 } };
    this.add = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
    this.sub = this.add.clone();
    this.sub.uniforms = this.uniforms;
    this.sub.blendEquation = THREE.ReverseSubtractEquation;
    this.sub.blendEquationAlpha = THREE.ReverseSubtractEquation;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.add);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.queue = [];
    this._melt = 0;
    this._clear = true;
    shared.uFxTex.value = this.rt.texture;
  }

  /** Paint a soft-edged disc. channel 0 scorch, 1 frost, 2 bloom. strength < 0 erases. */
  stamp(x, z, radius, channel = 0, strength = 1) {
    this.queue.push([x, z, radius, channel, strength]);
  }

  update(dt) {
    this._melt += dt;
    const melt = this._melt > 0.5;
    if (!this.queue.length && !melt && !this._clear) return;
    const r = this.renderer;
    const prevRT = r.getRenderTarget(),
      prevAuto = r.autoClear;
    r.setRenderTarget(this.rt);
    r.autoClear = false;
    if (this._clear) {
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      this._clear = false;
    }
    const u = this.uniforms;
    const span = WORLD.size + WORLD.cell;
    for (const [x, z, rad, ch, s] of this.queue) {
      u.uRect.value.set((x + WORLD.half + 0.5 * WORLD.cell) / span, (z + WORLD.half + 0.5 * WORLD.cell) / span, rad / span, rad / span);
      u.uMask.value.set(ch === 0 ? 1 : 0, ch === 1 ? 1 : 0, ch === 2 ? 1 : 0, ch === 3 ? 1 : 0);
      u.uStrength.value = Math.abs(s);
      u.uSeed.value = (x * 0.37 + z * 0.73) % 97;
      this.mesh.material = s < 0 ? this.sub : this.add;
      r.render(this.scene, this.cam);
    }
    this.queue.length = 0;
    if (melt) {
      this._melt = 0;
      // frost fades everywhere, a step at a time
      // a flat field: a disc so large that the whole map lies at its centre
      u.uRect.value.set(0.5, 0.5, 40, 40);
      u.uMask.value.set(0, 1, 0, 0);
      u.uStrength.value = 2.2 / 255;
      this.mesh.material = this.sub;
      r.render(this.scene, this.cam);
    }
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
  }
}
