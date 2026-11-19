// The atmosphere, installed once into three's shader chunks so every built-in material gets it:
//  - TP_COMMON: declarations of the shared uniforms plus noise, land and cloud helpers (both stages)
//  - a world-position varying for every lit material
//  - height fog with a sun lobe in place of three's fog
//  - cloud shadows on the sun, hooked into the cascaded-shadow light loop (see lighting.js)
// Importing this module performs the install; it is safe to import from several places.
import * as THREE from 'three';
import { addPatch } from './patch.js';
import { bindShared } from './shared.js';

export const TP_COMMON = /* glsl */ `
#ifndef TP_COMMON
#define TP_COMMON
uniform float uTime;
uniform vec4 uWind;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlow;
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec4 uFogA;
uniform vec4 uFogB;
uniform sampler2D uNoiseTex;
uniform vec4 uCloud;
uniform vec4 uCloudB;
uniform sampler2D uHeightTex;
uniform sampler2D uNrmTex;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uFxTex;
uniform vec4 uWorld;
uniform vec4 uPlayer;

float tpHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tpHash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 tpHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float tpNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(tpHash31(i), tpHash31(i + vec3(1, 0, 0)), f.x), mix(tpHash31(i + vec3(0, 1, 0)), tpHash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(tpHash31(i + vec3(0, 0, 1)), tpHash31(i + vec3(1, 0, 1)), f.x), mix(tpHash31(i + vec3(0, 1, 1)), tpHash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Distance to the nearest cell centre (hammer dimples, scales).
float tpCells(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float d = 1.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    vec3 g = vec3(float(a), float(b), float(c));
    vec3 o = tpHash33(i + g);
    vec3 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
// Height of the land at a world position (bilinear, no filtering extension needed).
float tpHeight(vec2 xz) {
  vec2 f = clamp((xz + uWorld.x) / uWorld.w, vec2(0.0), vec2(uWorld.z - 1.001));
  ivec2 i = ivec2(f);
  vec2 u = f - vec2(i);
  float a = texelFetch(uHeightTex, i, 0).r, b = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r, d = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 tpLandUV(vec2 xz) {
  return (xz + uWorld.x + 0.5 * uWorld.w) / (uWorld.y + uWorld.w);
}
// Cloud field on its plane, 0..1 (p in metres).
float tpCloudField(vec2 p) {
  vec2 q = p * uCloud.y + uCloud.zw;
  float n = texture2D(uNoiseTex, q).r * 0.56 + texture2D(uNoiseTex, q * 2.63 + 0.31).g * 0.29 + texture2D(uNoiseTex, q * 6.9 + 0.7).b * 0.15;
  return n;
}
float tpCloudCover(float n) {
  float c = uCloud.x;
  return smoothstep(0.84 - c * 0.62, 1.06 - c * 0.56, n + 0.22);
}
// How much sun gets through the clouds to a world position.
float tpCloudShadow(vec3 wp) {
  vec2 p = wp.xz + uSunDir.xz * ((uCloudB.y - wp.y) / max(uSunDir.y, 0.12));
  return 1.0 - uCloudB.x * tpCloudCover(tpCloudField(p));
}
// Height fog with a glow toward the sun. Colour in, colour out.
vec3 tpFog(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  float t = uFogA.y * v.y;
  float d0 = uFogA.x * exp(-uFogA.y * (cameraPosition.y - uFogA.z));
  float integ = d0 * dist * (abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0) + uFogA.w * dist;
  float f = min(1.0 - exp(-integ), uFogB.y);
  float sun = pow(max(dot(dir, uSunDir), 0.0), max(uFogB.x, 0.01));
  vec3 fc = uFogColor + uFogSunColor * sun * (1.0 - 0.7 * uFogB.z);
  return mix(col, fc, f);
}
// The sky in a direction, without sun or clouds (cheap reflections).
vec3 tpSkyColor(vec3 d) {
  vec3 c = mix(uSkyHor, uSkyZen, 1.0 - exp(-max(d.y, 0.0) * 3.4));
  return mix(c, uFogColor, exp(-max(d.y, 0.0) * 6.0) * 0.8);
}
float tpFogAmount(vec3 wp) {
  vec3 v = wp - cameraPosition;
  float dist = length(v);
  float t = uFogA.y * v.y;
  float d0 = uFogA.x * exp(-uFogA.y * (cameraPosition.y - uFogA.z));
  float integ = d0 * dist * (abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0) + uFogA.w * dist;
  return min(1.0 - exp(-integ), uFogB.y);
}
#endif
`;

const WORLD_VERTEX = /* glsl */ `
{
  vec4 tpWp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    tpWp = batchingMatrix * tpWp;
  #endif
  #ifdef USE_INSTANCING
    tpWp = instanceMatrix * tpWp;
  #endif
  vTpWorld = (modelMatrix * tpWp).xyz;
}
`;

let installed = false;
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.common = C.common + '\n' + TP_COMMON;
  C.fog_pars_vertex = 'varying vec3 vTpWorld;';
  C.fog_vertex = WORLD_VERTEX;
  C.fog_pars_fragment = 'varying vec3 vTpWorld;';
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = tpFog(gl_FragColor.rgb, vTpWorld);
#endif
`;
}
installAtmosphere();

/**
 * Hook cloud shadows into the cascaded-shadow light loop. Call once, after the CSM object exists
 * (its constructor replaces lights_fragment_begin).
 */
export function installCloudShadows() {
  const C = THREE.ShaderChunk;
  const a = C.lights_fragment_begin.indexOf('defined( USE_CSM ) && defined( CSM_CASCADES )');
  const b = C.lights_fragment_begin.indexOf('!defined( USE_CSM )');
  if (a < 0 || b < a) {
    console.error('[atmos] cascaded shadow chunk not found, cloud shadows are off');
    return;
  }
  const head = C.lights_fragment_begin.slice(0, a),
    mid = C.lights_fragment_begin.slice(a, b),
    tail = C.lights_fragment_begin.slice(b);
  if (mid.includes('tpSunVis')) return;
  const patched = mid
    .replace('DirectionalLight directionalLight;', 'DirectionalLight directionalLight;\n\tfloat tpSunVis = tpCloudShadow( vTpWorld );')
    .split('RE_Direct( directLight,')
    .join('directLight.color *= tpSunVis; RE_Direct( directLight,');
  C.lights_fragment_begin = head + patched + tail;
}

/**
 * Make a built-in material part of the world: shared uniforms bound, cascaded shadows on.
 * Every lit material in the game scene must pass through here (or through a helper that calls it).
 */
export function worldMaterial(material, { csm = true } = {}) {
  if (material.userData._world) return material;
  material.userData._world = true;
  if (csm) {
    material.defines = material.defines || {};
    material.defines.USE_CSM = 1;
    material.defines.CSM_CASCADES = 3;
    material.defines.CSM_FADE = '';
  }
  addPatch(material, (shader) => bindShared(shader), csm ? 'world+csm' : 'world');
  return material;
}
