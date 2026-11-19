// Lens flare and glare ('flare' slot). What a real lens does with a small, very bright source:
// a starburst from the aperture blades, a thin horizontal streak, a faint halo ring, and ghosts
// strung along the line through the middle of the frame. Drawn for the lamps that put the most
// light into the lens (G.lights.fixtures; illuminance at the camera, fog included), as a few
// additive sprites into one target that the composite adds after bloom.
// Occlusion is tested in the vertex shader: twelve depth taps over the lamp's apparent size, so a
// lamp sliding behind a pole or a roof edge dims smoothly instead of popping.
//
// pass.uniforms (all { value }): gain, soft (illuminance where the response starts to flatten),
// spikes, streak, ghosts (strengths relative to the glare), size (glare radius as a fraction of screen height).
import {
  WebGLRenderTarget, RGBAFormat, HalfFloatType, LinearFilter, InstancedBufferGeometry, BufferAttribute,
  InstancedBufferAttribute, RawShaderMaterial, GLSL3, Mesh, AdditiveBlending, DynamicDrawUsage, Vector3, Color,
} from 'three';
import { createLightList, readFog } from './lightlist.js';

const MAX_LIGHTS = 10;
const GHOST_LIGHTS = 3;
// position along the axis lamp -> screen centre (0 = on the lamp, 1 = centre, 2 = mirrored), radius, kind (1 disc, 2 ring), tint
const GHOSTS = [
  [0.42, 0.030, 1, 0.1], [0.78, 0.014, 1, 0.45], [1.28, 0.052, 2, 0.7], [1.62, 0.022, 1, 0.3], [2.05, 0.085, 2, 0.9],
];
const MAX_SPRITES = MAX_LIGHTS + GHOST_LIGHTS * GHOSTS.length;

const VERT = /* glsl */ `precision highp float;
precision highp sampler2D;
in vec2 corner;
in vec3 iPos;
in vec3 iCol;
in vec4 iElem; // kind, radius (fraction of screen height), axis position, seed
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 resolution;
out vec2 vUv;
flat out vec3 vCol;
flat out vec4 vElem;
void main() {
  vec4 vp = viewMatrix * vec4(iPos, 1.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = corner; vCol = vec3(0.0); vElem = iElem;
  if (vp.z > -0.3) return;
  vec4 cp = projectionMatrix * vp;
  vec2 ndc = cp.xy / cp.w;
  float aspect = resolution.x / resolution.y;
  float lightZ = -vp.z;
  // visible fraction of a 0.5 m luminaire
  float rad = clamp(0.25 * projectionMatrix[1][1] / lightZ, 0.004, 0.03);
  float vis = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.3999632;
    vec2 uv = (ndc + vec2(cos(a) / aspect, sin(a)) * rad * sqrt((float(i) + 0.5) / 12.0)) * 0.5 + 0.5;
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) continue;
    float d = textureLod(tDepth, uv, 0.0).r;
    float z = (cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d);
    vis += step(lightZ - 0.4, z);
  }
  vis *= (1.0 / 12.0) * (1.0 - smoothstep(0.92, 1.12, max(abs(ndc.x), abs(ndc.y))));
  if (vis <= 0.0) return;
  float k = iElem.x < 0.5 ? 1.0 : 1.0 - smoothstep(0.75, 1.2, length(ndc)) * 0.6; // ghosts weaken toward the frame edge
  vCol = iCol * vis * k;
  vec2 centre = ndc * (1.0 - iElem.z);
  gl_Position = vec4(centre + corner * vec2(iElem.y * 2.0 / aspect, iElem.y * 2.0), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `precision highp float;
in vec2 vUv;
flat in vec3 vCol;
flat in vec4 vElem;
uniform float uSpikes;
uniform float uStreak;
uniform float uGhosts;
out vec4 outColor;
void main() {
  float r = length(vUv);
  float rim = 1.0 - smoothstep(0.82, 1.0, r);
  vec3 c;
  if (vElem.x < 0.5) {
    // six-point starburst: three lines through the source, thin at the core, widening outward
    float sp = 0.0;
    for (int k = 0; k < 3; k++) {
      float a = 0.42 + vElem.w * 0.5 + float(k) * 1.0471976;
      vec2 d = vec2(cos(a), sin(a));
      float along = abs(dot(vUv, d));
      float across = abs(vUv.x * d.y - vUv.y * d.x);
      float w = 0.004 + 0.02 * along;
      sp += exp(-across * across / (w * w)) * exp(-along * (k == 0 ? 4.5 : 7.0)) * (k == 0 ? 1.0 : 0.6);
    }
    float streak = exp(-abs(vUv.y) * 70.0) * exp(-abs(vUv.x) * 3.0);
    float veil = exp(-r * 14.0) * 0.5 + exp(-r * 4.0) * 0.03;
    float ring = exp(-pow((r - 0.5) / 0.03, 2.0));
    // the ring disperses: red outside, blue inside
    vec3 ringC = vec3(exp(-pow((r - 0.515) / 0.022, 2.0)), exp(-pow((r - 0.5) / 0.022, 2.0)), exp(-pow((r - 0.485) / 0.022, 2.0))) * ring;
    float lum = dot(vCol, vec3(0.2126, 0.7152, 0.0722));
    c = vCol * (veil + sp * uSpikes) + mix(vCol, vec3(lum) * vec3(0.55, 0.75, 1.3), 0.6) * streak * uStreak + lum * ringC * 0.012;
  } else {
    float lum = dot(vCol, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = 0.55 + 0.45 * cos(6.2831853 * (vElem.w + vec3(0.0, 0.33, 0.67)));
    float shape = vElem.x < 1.5
      ? (1.0 - smoothstep(0.55, 0.95, r)) * (0.55 + 0.45 * r * r)          // disc, slightly brighter at the edge
      : 0.35 * exp(-pow((r - 0.78) / 0.12, 2.0)) + 0.1 * (1.0 - smoothstep(0.0, 0.8, r)); // soft ring
    c = mix(vCol, lum * tint, 0.7) * shape * uGhosts;
  }
  outColor = vec4(c * rim, 1.0);
}`;

export function createFlare(G) {
  const uniforms = {
    gain: { value: 0.35 }, soft: { value: 6 }, spikes: { value: 0.5 }, streak: { value: 0.35 }, ghosts: { value: 0.026 }, size: { value: 0.26 },
  };
  const lights = createLightList(G, MAX_LIGHTS);
  const fog = { density: 0, falloff: 0, r: 0, g: 0, b: 0 };
  const camPos = new Vector3();
  const v = new Vector3();
  const black = new Color(0, 0, 0);
  const savedClear = new Color();
  let proj = null; let view = null;

  // Illuminance the lamp puts on the lens, scene lux; 0 when it is off screen or faces away.
  const lensScore = (l) => {
    v.copy(l.pos).applyMatrix4(view);
    if (v.z > -0.5) return 0;
    if (Math.abs((proj[0] * v.x) / -v.z) > 1.1 || Math.abs((proj[5] * v.y) / -v.z) > 1.1) return 0;
    v.subVectors(camPos, l.pos);
    const d2 = Math.max(v.lengthSq(), 1);
    const d = Math.sqrt(d2);
    let emit = 1;
    if (l.spot) { // a downlight seen from outside its beam still shows its lens, from above it shows nothing
      const c = v.dot(l.dir) / d;
      if (c < -0.05) return 0;
      emit = 0.3 + 0.7 * Math.min(1, Math.max(0, (c - l.cosOuter) / Math.max(l.cosInner - l.cosOuter, 1e-3)));
    }
    const tau = fog.density * Math.exp(-fog.falloff * Math.max(camPos.y, 0)) * d;
    return (l.intensity * emit * Math.exp(-tau)) / d2;
  };

  const geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  const mk = (n) => { const a = new InstancedBufferAttribute(new Float32Array(MAX_SPRITES * n), n); a.setUsage(DynamicDrawUsage); return a; };
  const aPos = mk(3); const aCol = mk(3); const aElem = mk(4);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iCol', aCol); geo.setAttribute('iElem', aElem);
  geo.instanceCount = 0;
  let material; let mesh;
  const target = new WebGLRenderTarget(2, 2, { format: RGBAFormat, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });

  function sprite(n, l, k, kind, radius, axis, seed) {
    aPos.array[n * 3] = l.pos.x; aPos.array[n * 3 + 1] = l.pos.y; aPos.array[n * 3 + 2] = l.pos.z;
    aCol.array[n * 3] = l.r * k; aCol.array[n * 3 + 1] = l.g * k; aCol.array[n * 3 + 2] = l.b * k;
    aElem.array[n * 4] = kind; aElem.array[n * 4 + 1] = radius; aElem.array[n * 4 + 2] = axis; aElem.array[n * 4 + 3] = seed;
  }

  return {
    name: 'flare', uniforms,
    init(post) {
      const s = post.shared;
      material = new RawShaderMaterial({
        glslVersion: GLSL3, vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          tDepth: s.tDepth, cameraNear: s.cameraNear, cameraFar: s.cameraFar, resolution: s.resolution,
          uSpikes: uniforms.spikes, uStreak: uniforms.streak, uGhosts: uniforms.ghosts,
        },
        depthTest: false, depthWrite: false, transparent: true, blending: AdditiveBlending,
      });
      mesh = new Mesh(geo, material);
      mesh.frustumCulled = false;
    },
    resize(w, h) { target.setSize(w, h); },
    render(post) {
      const cam = post.camera;
      camPos.setFromMatrixPosition(cam.matrixWorld);
      view = cam.matrixWorldInverse; proj = cam.projectionMatrix.elements;
      readFog(G, fog);
      const list = lights.gather(lensScore);
      let n = 0;
      const soft = uniforms.soft.value;
      for (let i = 0; i < list.count; i++) {
        const l = list.items[i];
        const e = l.score; // lux at the lens
        const k = (uniforms.gain.value * e) / (1 + e / soft);
        if (k < 1e-4) continue;
        const seed = (l.pos.x * 0.137 + l.pos.z * 0.291) % 1;
        sprite(n++, l, k, 0, uniforms.size.value, 0, seed);
        if (i < GHOST_LIGHTS && uniforms.ghosts.value > 0) for (const g of GHOSTS) sprite(n++, l, k, g[2], g[1], g[0], g[3]);
      }
      if (n === 0) return null;
      geo.instanceCount = n;
      aPos.needsUpdate = true; aCol.needsUpdate = true; aElem.needsUpdate = true;
      const r = post.renderer;
      // the sprites are added to whatever the target holds: clear it to black whatever the renderer's clear colour is
      r.getClearColor(savedClear);
      const savedAlpha = r.getClearAlpha();
      r.setRenderTarget(target);
      r.setClearColor(black, 1);
      r.clear();
      r.setClearColor(savedClear, savedAlpha);
      r.render(mesh, cam);
      return target.texture;
    },
    dispose() { target.dispose(); geo.dispose(); if (material) material.dispose(); },
  };
}
