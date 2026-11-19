// Item pictures. Each thing the apprentice can hold is stood on an empty table, lit like a still
// life, drawn once, tone-mapped on the GPU and read back into a canvas for the book and the belt.
import * as THREE from 'three';
import { createPropMaterial } from './propMaterial.js';
import { buildModel, hasModel } from '../models/index.js';
import { Placed } from '../world/props.js';

const SIZE = 256;
const SUPER = 2;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uExposure;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec4 c = texture2D(tSrc, vUv);
  float a = clamp(c.a, 0.0, 1.0);
  vec3 col = max(c.rgb, 0.0) / max(a, 1e-3);
  col = aces(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, a);
}
`;

// view per kind: [azimuth, elevation] in radians and a little extra room round the thing
const VIEW = {
  ingredient: [0.55, 0.42, 1.06],
  potion: [0.4, 0.16, 1.1],
  prime: [0.6, 0.3, 1.16],
  stone: [0.6, 0.34, 1.3],
};

export class Icons {
  constructor(engine) {
    this.engine = engine;
    this.cache = new Map();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
    const key = new THREE.DirectionalLight(0xffe2c0, 3.4);
    key.position.set(-2.2, 3.4, 2.6);
    const rim = new THREE.DirectionalLight(0x9db8e8, 2.2);
    rim.position.set(2.6, 1.6, -3.0);
    const fill = new THREE.DirectionalLight(0xc8b8a8, 0.7);
    fill.position.set(2.0, 0.6, 2.4);
    this.scene.add(key, rim, fill, new THREE.HemisphereLight(0x8a94a8, 0x2a2420, 0.9));
    this.mats = {
      prop: createPropMaterial({ fog: false, grime: false }),
      liquid: createPropMaterial({ roughness: 0.2, fog: false, grime: false }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6, fog: false }),
    };
    const S = SIZE * SUPER;
    this.rtA = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: 4, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rtB = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.tone = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: this.rtA.texture }, uExposure: { value: 1.0 } } }));
    this.tone.frustumCulled = false;
    this.toneCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.buf = new Uint8Array(SIZE * SIZE * 4);
  }

  /** A canvas for (kind, id), or null when there is no picture of it. */
  get(kind, id) {
    return this.cache.get(kind + ':' + id) || null;
  }

  /** Draw every picture the game needs. Call once the models are registered and the sky has been lit. */
  renderAll(data) {
    this.scene.environment = this.engine.scene.environment || null;
    this.scene.environmentIntensity = 0.5;
    for (const id of data.INGREDIENT_ORDER) this._make('ingredient', id, id);
    for (const id of data.POTION_ORDER) this._make('potion', id, 'bottle_' + id);
    for (const id of data.PRIME_ORDER) this._make('prime', id, 'prime_' + id);
    this._make('stone', 'stone', 'stone');
    this.scene.environment = null;
  }

  _make(kind, id, name) {
    if (!hasModel(name)) return;
    let model;
    try {
      model = buildModel(name, 3, null);
    } catch (e) {
      console.error('[icons] ' + name + ': ' + e.message);
      return;
    }
    const p = new Placed(name, model, this.mats, 0, 0, 0, 0, 1);
    p.object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    this.scene.add(p.object);
    const box = new THREE.Box3().setFromObject(p.object);
    // a plant's root below the soil is not part of its picture
    if (kind === 'ingredient') box.min.y = Math.max(box.min.y, -0.02);
    const c = box.getCenter(new THREE.Vector3());
    const [az, el, room] = VIEW[kind] || VIEW.ingredient;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    let d = 0.1;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      d = Math.max(d, v.dot(dir) + Math.max(Math.abs(v.dot(right)), Math.abs(v.dot(up))) / tan);
    }
    d *= room;
    this.camera.position.copy(c).addScaledVector(dir, d);
    this.camera.near = Math.max(0.02, d * 0.1);
    this.camera.far = d * 4 + 10;
    this.camera.lookAt(c);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const r = this.engine.renderer;
    const old = r.getRenderTarget();
    const oldColor = r.getClearColor(new THREE.Color());
    const oldAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rtA);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(this.rtB);
    r.clear(true, false, false);
    r.render(this.tone, this.toneCam);
    r.readRenderTargetPixels(this.rtB, 0, 0, SIZE, SIZE, this.buf);
    r.setRenderTarget(old);
    r.setClearColor(oldColor, oldAlpha);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) img.data.set(this.buf.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    this.cache.set(kind + ':' + id, canvas);

    this.scene.remove(p.object);
    p.object.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    for (const k in this.mats) this.mats[k].dispose();
  }
}
