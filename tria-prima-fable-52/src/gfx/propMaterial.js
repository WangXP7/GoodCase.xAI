// The "prop" surface: one PBR material for every hand-built model.
// Reads the kit attributes (color, aFx, aMat, aUvw) and adds procedural surface detail per material id:
// wood grain, stone mottling, hammered metal, soft plant lighting, crystal sparkle, cloth weave.
import * as THREE from 'three';
import { addPatch, after } from './patch.js';
import { bindShared } from './shared.js';
import './atmos.js'; // declares the shared uniforms and the noise helpers in <common>

const VERT_PARS = /* glsl */ `
attribute vec4 aFx;
attribute float aMat;
attribute vec3 aUvw;
varying vec4 vFx;
varying float vMat;
varying vec3 vUvw;
`;

const VERT_BEGIN = /* glsl */ `
vFx = aFx;
vMat = aMat;
vUvw = aUvw;
if (aFx.w > 0.0) {
  #ifdef USE_INSTANCING
    mat4 tpM = modelMatrix * instanceMatrix;
  #else
    mat4 tpM = modelMatrix;
  #endif
  vec3 tpO = tpM[3].xyz;
  vec3 tpW = (tpM * vec4(transformed, 1.0)).xyz;
  float ph = dot(tpO.xz, vec2(0.37, 0.71));
  float gust = sin(uTime * 1.9 + ph + tpW.y * 1.3) * 0.5
             + sin(uTime * 3.1 + ph * 1.7 + tpW.x * 0.6) * 0.25
             + sin(uTime * 0.7 + ph * 0.31) * 0.6 + 0.35;
  vec3 wOff = vec3(uWind.x, 0.0, uWind.y) * (gust * uWind.z * aFx.w * 0.35);
  wOff.y = -abs(gust) * uWind.z * aFx.w * 0.05;
  transformed += (wOff * mat3(tpM)) / max(dot(tpM[0].xyz, tpM[0].xyz), 1e-5);
}
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vFx;
varying float vMat;
varying vec3 vUvw;
`;

// Runs right after vertex colour is applied: albedo detail + a bump height for later.
const FRAG_DETAIL = /* glsl */ `
float tpMat = floor(vMat + 0.5);
float tpRough = vFx.y;
float tpMetal = vFx.z;
float tpEmis = vFx.x;
float tpBump = 0.0;
float tpBumpAmt = 0.0;
vec3 tpQ = vUvw;
float tpLod = clamp(1.0 - length(fwidth(tpQ)) * 5.0, 0.0, 1.0);
// how squarely this face cuts across the part's Y: the face normal in detail space, from the
// two screen derivatives of the detail coordinates (taken here, outside the branches)
vec3 tpNq = cross(dFdx(tpQ) * 1000.0, dFdy(tpQ) * 1000.0);
float tpAcross = smoothstep(0.55, 0.85, abs(tpNq.y) / max(length(tpNq), 1e-9));
if (tpMat == 1.0) {
  // wood: long grain along the part's Y, soft growth rings. On a face that cuts across the grain
  // (a barrel head, the top of a post) the rings are circles round the part's axis: drawn there
  // as on the flanks they are the contour lines of a noise field, and read as a maze.
  vec3 q = tpQ * vec3(11.0, 1.6, 11.0);
  float g = tpNoise(q) * 0.6 + tpNoise(q * vec3(3.1, 1.2, 3.1) + 7.1) * 0.4;
  float flank = sin((g * 5.0 + tpQ.y * 0.7) * 6.2831) * 0.5 + 0.5;
  float cut = sin((length(tpQ.xz) * 15.0 + g * 0.45) * 6.2831) * 0.5 + 0.5;
  float rings = mix(flank, cut, tpAcross);
  float d = mix(1.0, mix(0.80, 1.12, g) * mix(0.93, 1.04, rings), tpLod);
  diffuseColor.rgb *= d;
  tpBump = g * 0.7 + rings * 0.2;
  tpBumpAmt = 0.012;
  tpRough = clamp(tpRough + (g - 0.5) * 0.25 * tpLod, 0.05, 1.0);
} else if (tpMat == 2.0) {
  // stone: broad mottling, fine grain, damp stains that run down the face, lichen in the stains
  float n1 = tpNoise(tpQ * 2.7);
  float n2 = tpNoise(tpQ * 9.0 + 3.7);
  float n3 = tpNoise(tpQ * 53.0 + 1.3);
  float st = tpNoise(tpQ * vec3(2.3, 0.5, 2.3) + 9.1) * 0.65 + tpNoise(tpQ * vec3(6.1, 1.1, 6.1) + 2.2) * 0.35;
  float stain = smoothstep(0.5, 0.82, st);
  float d = mix(0.80, 1.14, n1) * mix(0.90, 1.07, n2) * mix(0.93, 1.05, n3);
  d *= 1.0 - stain * 0.3;
  diffuseColor.rgb *= mix(1.0, d, tpLod);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.97, 0.78), stain * 0.55 * tpLod);
  // (the fine grain stays in the colour: as relief its slope swamps the rest, and a light held low
  //  draws smooth noise that small as worm-tracks all over the stone)
  tpBump = n1 * 0.52 + n2 * 0.42 + n3 * 0.035;
  tpBumpAmt = 0.02;
  tpRough = clamp(tpRough + ((n2 - 0.5) * 0.2 - stain * 0.12) * tpLod, 0.05, 1.0);
} else if (tpMat == 3.0) {
  // metal: hammered dimples, streaky polish, a little tarnish in the lows
  float c = tpCells(tpQ * 16.0);
  float dim = smoothstep(0.0, 0.62, c);
  float streak = tpNoise(tpQ * vec3(46.0, 5.0, 46.0));
  float tarn = tpNoise(tpQ * 3.3 + 11.0);
  diffuseColor.rgb *= mix(1.0, mix(0.78, 1.08, dim) * mix(0.86, 1.06, tarn), tpLod);
  tpBump = dim;
  tpBumpAmt = 0.006;
  tpRough = clamp(tpRough + ((streak - 0.5) * 0.22 + (1.0 - dim) * 0.18 + (tarn - 0.5) * 0.2) * tpLod, 0.04, 1.0);
} else if (tpMat == 4.0) {
  // plant: gentle blotches
  float n1 = tpNoise(tpQ * 13.0);
  float n2 = tpNoise(tpQ * 41.0 + 5.0);
  diffuseColor.rgb *= mix(1.0, mix(0.84, 1.12, n1) * mix(0.95, 1.04, n2), tpLod);
} else if (tpMat == 5.0) {
  // crystal: inner veils
  float n1 = tpNoise(tpQ * 7.0 + 2.0);
  diffuseColor.rgb *= mix(0.88, 1.1, n1);
  tpRough = min(tpRough, 0.22);
} else if (tpMat == 6.0) {
  // cloth: woven threads
  vec3 w = sin(tpQ * 260.0);
  float weave = (w.x * w.y + w.y * w.z + w.z * w.x) * 0.33;
  float n1 = tpNoise(tpQ * 6.0);
  diffuseColor.rgb *= mix(1.0, mix(0.88, 1.08, n1) * (1.0 + weave * 0.07), tpLod);
  tpBump = weave;
  tpBumpAmt = 0.004;
}
#ifndef TP_NO_GRIME
{
  // where a thing meets the ground it is damp, dark and a little green: it stands in the world
  float tpAbove = vTpWorld.y - tpHeight(vTpWorld.xz);
  float tpGr = (1.0 - smoothstep(0.02, 0.5, tpAbove + (tpNoise(vTpWorld * 2.1) - 0.5) * 0.3)) * step(tpEmis, 0.05);
  vec3 tpDamp = diffuseColor.rgb * mix(vec3(0.6), vec3(0.5, 0.6, 0.42), step(0.5, tpMat) * step(tpMat, 2.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, tpDamp, tpGr * 0.8);
  tpRough = mix(tpRough, min(tpRough, 0.62), tpGr * 0.6);
}
#endif
`;

// Runs once the shading normal exists.
const FRAG_NORMAL = /* glsl */ `
if (tpBumpAmt > 0.0 && tpLod > 0.01) {
  vec3 tpP = -vViewPosition;
  vec3 dpx = dFdx(tpP), dpy = dFdy(tpP);
  float dhx = dFdx(tpBump), dhy = dFdy(tpBump);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - tpBumpAmt * tpLod * grad);
}
if (tpMat == 4.0) {
  // light wraps around leaves and petals: lean the shading normal toward the light
  vec3 sunV = normalize(mat3(viewMatrix) * uSunDir);
  normal = normalize(mix(normal, sunV, 0.32));
}
roughnessFactor = tpRough;
metalnessFactor = tpMetal;
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float pulse = 0.9 + 0.1 * sin(uTime * 1.7 + vUvw.x * 3.0 + vUvw.y * 2.0);
  vec3 e = diffuseColor.rgb * tpEmis * pulse;
  if (tpMat == 5.0) {
    vec3 vd = normalize(vViewPosition);
    float fres = pow(1.0 - abs(dot(normal, vd)), 2.5);
    float sp = pow(tpNoise(vUvw * 55.0 + vd * 5.0), 14.0) * 6.0;
    e += diffuseColor.rgb * (fres * 0.55 + sp) * (0.35 + tpEmis);
  }
  totalEmissiveRadiance += e * uGlow;
  if (tpMat == 7.0) diffuseColor.rgb *= 0.15;
}
`;

/** Patch any MeshStandardMaterial / MeshPhysicalMaterial so it understands kit geometry. */
export function patchProp(material) {
  material.vertexColors = true;
  addPatch(
    material,
    (shader) => {
      bindShared(shader);
      shader.vertexShader = after(shader.vertexShader, '#include <common>', VERT_PARS, 'prop vs pars');
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', VERT_BEGIN, 'prop vs begin');
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', FRAG_PARS, 'prop fs pars');
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', FRAG_DETAIL, 'prop fs detail');
      shader.fragmentShader = after(shader.fragmentShader, '#include <normal_fragment_maps>', FRAG_NORMAL, 'prop fs normal');
      shader.fragmentShader = after(shader.fragmentShader, '#include <emissivemap_fragment>', FRAG_EMISSIVE, 'prop fs emissive');
    },
    'prop'
  );
  return material;
}

/** `grime: false` for things that are not standing in the world (icons, the model viewer). */
export function createPropMaterial({ grime = true, ...opts } = {}) {
  const m = new THREE.MeshStandardMaterial({
    defines: grime ? {} : { TP_NO_GRIME: 1 },
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 1.0,
    ...opts,
  });
  return patchProp(m);
}
