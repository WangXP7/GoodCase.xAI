// Uniforms shared by reference across every material in the game. Update the .value once per
// frame and every shader sees it. The matching GLSL declarations live in atmos.js (TP_COMMON),
// which is appended to three's <common> chunk, so no material may declare these again.
import * as THREE from 'three';

const v4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

export const shared = {
  uTime: { value: 0 },
  // xy = wind direction on the XZ plane (normalised), z = strength 0..1, w = gust phase offset
  uWind: { value: v4(0.83, 0.55, 0.35, 0) },
  // World-space unit vector pointing toward the main light (sun by day, moon by night)
  uSunDir: { value: new THREE.Vector3(0.45, 0.75, 0.48).normalize() },
  // Colour x intensity of the main light
  uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
  // Multiplier on every emissive surface (rises at night so glowing flora reads)
  uGlow: { value: 1.0 },
  uCamPos: { value: new THREE.Vector3() },
  // Sky light, for shaders that do their own lighting
  uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) },
  // Atmosphere. uFogA = (density at base height, height falloff 1/m, base height, uniform haze density)
  // uFogB = (sun lobe power, max opacity, 1 when the volumetric pass adds the sun shafts, unused)
  // Sky colours after weather (for shaders that fake a sky reflection)
  uSkyZen: { value: new THREE.Color(0.2, 0.25, 0.3) },
  uSkyHor: { value: new THREE.Color(0.4, 0.42, 0.45) },
  uFogColor: { value: new THREE.Color(0, 0, 0) },
  uFogSunColor: { value: new THREE.Color(0, 0, 0) },
  uFogA: { value: v4(0, 0.02, 0, 0) },
  uFogB: { value: v4(8, 1, 0, 0) },
  // Tiling noise, four independent channels
  uNoiseTex: { value: null },
  // Clouds. uCloud = (cover 0..1, 1 / scale in metres, offset x, offset z); uCloudB = (shadow strength, altitude, unused, unused)
  uCloud: { value: v4(0, 1 / 1900, 0, 0) },
  uCloudB: { value: v4(0, 600, 0, 0) },
  // The land. uWorld = (half size, size, samples per side, cell size)
  uHeightTex: { value: null },
  uNrmTex: { value: null },
  uMaskA: { value: null },
  uMaskB: { value: null },
  // World-space effects painted by potions: r scorch, g frost, b bloom, a unused
  uFxTex: { value: null },
  uWorld: { value: v4(384, 768, 513, 1.5) },
  // xyz = player feet, w = radius within which grass bends away
  uPlayer: { value: v4(0, -999, 0, 0.9) },
  // Cascaded shadows (declared by the CSM chunk, bound here)
  CSM_cascades: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  cameraNear: { value: 0.1 },
  shadowFar: { value: 200 },
};

/** Attach every shared uniform to a shader's uniform table (inside onBeforeCompile). */
export function bindShared(shader) {
  for (const k in shared) shader.uniforms[k] = shared[k];
}
/** Same for a hand-written ShaderMaterial: returns an object to spread into its uniforms. */
export function sharedUniforms(extra = {}) {
  return { ...shared, ...extra };
}
