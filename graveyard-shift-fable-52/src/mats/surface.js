// Material library entry point: G.mats. Every surface is a MeshStandardMaterial whose albedo,
// roughness, metalness and normal are computed in the fragment shader from 3D procedural noise
// (noise.glsl.js) by a per-kind `surfaceMain`. This file owns the injection, the shared wetness
// and paint-damage GLSL, the shared uniforms, and the small kinds (rubber, chrome, neon, emissive).
// Kind modules (ground.js, concrete.js, ...) only export a definition and a factory; they never
// import this file.
import {
  MeshStandardMaterial, MeshBasicMaterial, MeshDepthMaterial, MeshDistanceMaterial,
  Vector3, Color, BufferAttribute, ShaderLib, ShaderChunk,
} from 'three';
import { NOISE_GLSL } from './noise.glsl.js';
import { createNoiseTextures, NZ_RES, NZ_BASE, NZ_GRAD, NZ_VORO } from './noiseTex.js';
import { makeGround } from './ground.js';
import { makeConcrete } from './concrete.js';
import { makePaintedMetal } from './paintedMetal.js';
import { makeGlass } from './glass.js';
import { makeGunmetal } from './gunmetal.js';
import { makeSkin, makeCloth } from './skinCloth.js';
import { installMatboard } from './matboard.js';

// ---- shared GLSL ---------------------------------------------------------------------------------

const VERT_PARS = /* glsl */ `
attribute vec3 aRest;
attribute vec4 aSurf;
uniform float uRestMix;
varying vec3 vSWp;
varying vec3 vSP;
varying vec3 vSN;
varying vec4 vSA;
varying vec2 vSUv;
`;

// after <project_vertex>: `transformed` is the skinned/morphed object position
const VERT_MAIN = /* glsl */ `
{
  vec4 sW = vec4(transformed, 1.0);
  vec3 sNrm = normal;
  #ifdef USE_INSTANCING
    sW = instanceMatrix * sW;
    sNrm = mat3(instanceMatrix) * sNrm;
  #endif
  sW = modelMatrix * sW;
  vSWp = sW.xyz;
  vSA = aSurf;
  vSUv = uv;
  #ifdef SURF_LOCAL
    vSP = mix(position, aRest, uRestMix);
    vSN = normal;
  #else
    vSP = sW.xyz;
    vSN = normalize(mat3(modelMatrix) * sNrm);
  #endif
}
`;

const FRAG_COMMON = /* glsl */ `
varying vec3 vSWp;
varying vec3 vSP;
varying vec3 vSN;
varying vec4 vSA;
varying vec2 vSUv;
uniform float uTime;
uniform float uRain;
uniform float uWetness;
uniform float uShelter;
uniform float uSplash;
uniform float uGroundY;
uniform vec3 uSeedOff;

struct Surf { vec3 albedo; float rough; float metal; vec3 grad; vec2 dH; vec3 emissive; float alpha; float ao; };

// per-fragment context, set once in main()
vec3 gP;    // noise-space position (world, or object/rest space) plus the seed offset
vec3 gN;    // geometric normal in noise space
vec3 gNw;   // geometric normal in world space
vec3 gWp;   // world position
vec3 gV;    // world direction to the camera
vec4 gA;    // aSurf vertex masks: x wear/edge, y blood, z grip zone
float gNdv;

#define NZ_BASE ${NZ_BASE.toFixed(1)}
#define NZ_GRAD ${NZ_GRAD.toFixed(1)}
#define NZ_VORO ${NZ_VORO.toFixed(1)}
// SURF_Q: 2 = high, 1 = medium, 0 = low (from G.quality). Optional layers are dropped below 2.
#ifndef SURF_Q
  #define SURF_Q 2
#endif
${NOISE_GLSL}

// ---- rain ----
// how much rain reaches this fragment: up-facing most, undersides least, nothing under shelter
float sExposure() { return (1.0 - uShelter) * mix(0.25, 1.0, smoothstep(-0.35, 0.65, gNw.y)); }
// 1 where the object meets the ground, gone by about half a metre, with a broken top edge
float gSplash = -1.0;     // computed once per fragment; several layers ask for it
float sSplashBand() {
  if (gSplash >= 0.0) return gSplash;
  float h = gWp.y - uGroundY;
  gSplash = 0.0;
  if (h < 0.8 && uSplash > 0.0) gSplash = uSplash * (1.0 - smoothstep(0.02, 0.3 + 0.35 * sNoise(gP * vec3(7.0, 2.0, 7.0), 7.0), h));
  return gSplash;
}
float sWetAmount() { return clamp(uWetness * max(sExposure(), sSplashBand() * 0.9), 0.0, 1.0); }

// Water beads standing on a surface: coverage, and their slope added to the normal. No fetch.
float sBeadLayer(vec3 p, float cells, float amount, float lift) {
  vec4 b = sDomes(p, cells, amount);
  gGradX += gDomeSlope * lift;
  return b.x;
}

// Non-porous surfaces: water sits on top as a film, beads, and rivulets on vertical faces.
// 'lo' is any slow noise value the caller already has (it places the film).
void sWetHard(inout Surf s, float w, float lo) {
  if (w < 0.01) return;
  float up = smoothstep(0.3, 0.9, gNw.y);
  float f1 = sFade(260.0);
  float film = w * mix(0.25, 0.85, up) * smoothstep(0.3, 0.7, lo * 0.6 + w * 0.5);
  float gloss = film;
  #if SURF_Q > 0
  if (f1 > 0.0) gloss = max(gloss, sBeadLayer(gP, 120.0, 0.5 * w, 0.9) * f1);
  #endif
  #if SURF_Q > 1
  if (sFade(900.0) > 0.3) gloss = max(gloss, sBeadLayer(gP + 3.7, 430.0, 0.65 * w, 0.9));
  #endif
  #if !defined(SURF_LOCAL) && SURF_Q > 0
  float side = 1.0 - smoothstep(0.25, 0.75, abs(gNw.y));
  if (side > 0.01 && uRain > 0.0) {
    float r = sNoise(vec3(gP.x * 64.0, gP.y * 2.2 + uTime * 0.35, gP.z * 64.0), 64.0);
    float riv = smoothstep(0.62, 0.74, r) * side * w * uRain;
    gHt += riv * 0.0004;
    gloss = max(gloss, riv);
  }
  #endif
  s.rough = mix(s.rough, 0.06, gloss);
  // beyond the range where beads resolve they average into a general sheen
  s.rough = mix(s.rough, max(s.rough * 0.7, 0.14), w * (1.0 - f1) * 0.8);
  s.albedo *= 1.0 - 0.12 * film;
}

// Porous surfaces soak: darker, more saturated, smoother. The soak has an edge: rain reaches some
// of a wall and not the rest, and on vertical faces it comes down in broad streaks.
// 'lo' is a slow noise value and 'streak' a vertical-streak value the caller already has.
void sWetPorous(inout Surf s, float w, float porosity, float lo, float streak) {
  if (w < 0.01) return;
  float side = 1.0 - smoothstep(0.3, 0.8, abs(gN.y));
  float n = mix(lo, lo * 0.5 + 0.5 * streak, side);
  float k = smoothstep(0.62, 0.38, n - (w - 0.5) * 0.9) * smoothstep(0.0, 0.25, w);
  s.albedo = sSat(s.albedo, 1.0 + 0.3 * k) * mix(1.0, 1.0 - 0.6 * porosity, k);
  s.rough = mix(s.rough, s.rough * 0.45, k);
}

// ---- paint damage, shared by painted metal and painted concrete ----
// One scalar field; rising through it you cross stained paint (halo), then the primer rim, then the
// substrate. 'grad' is the slope of the paint film's broken edge.
struct Chip { float bare; float primer; float halo; vec3 grad; };
float sChipTh(float wear) { return mix(0.74, 0.47, wear) - 0.07 * sSplashBand(); }
// two fetches: the broad field that decides where paint has failed, and the ragged edge detail
float gChipLo = 0.5;    // the broad half of the chip field, for callers that look nearby (rust runs)
vec4 sChipField(vec3 p, float scale) {
  vec4 a = sFbmD(p + 31.7, 1.1 * scale);
  gChipLo = a.x;
  vec4 b = sFbmD(S_ROT * p, 13.0 * scale);
  return vec4(a.x * 0.42 + b.x * 0.58, a.yzw * 0.42 + (b.yzw * S_ROT) * 0.58);
}
Chip sChips(vec3 p, float wear, float scale) {
  Chip k = Chip(0.0, 0.0, 0.0, vec3(0.0));
  if (wear <= 0.001) return k;
  vec4 n = sChipField(p, scale);
  #if SURF_Q > 1
  // the stored field is three octaves; a finer copy keeps chip outlines ragged up close
  vec4 d = sFbmD(p + 5.3, 60.0 * scale);
  n += vec4(d.x - 0.5, d.yzw) * 0.2;
  #endif
  float th = sChipTh(wear);
  float aa = 0.006 + length(n.yzw) * gFp * 1.2;
  k.bare = smoothstep(th, th + aa, n.x);
  k.primer = smoothstep(th - 0.01, th - 0.01 + aa, n.x);
  k.halo = smoothstep(th - 0.16, th, n.x);
  float e = k.primer * (1.0 - k.primer) * 4.0;
  vec3 g = -n.yzw * (e * 1.5 / aa) * 0.00012;
  k.grad = g / max(1.0, length(g));
  return k;
}
`;

// after <normal_fragment_maps>: three's diffuseColor / roughnessFactor / metalnessFactor / normal
// exist and nothing has been lit yet
const FRAG_MAIN = /* glsl */ `
gWp = vSWp; gA = vSA;
gNw = normalize(inverseTransformDirection(normal, viewMatrix));
#ifdef SURF_LOCAL
  gN = normalize(vSN) * faceDirection;
#else
  gN = gNw;
#endif
gP = vSP + uSeedOff;
gFp = max(length(dFdx(vSP)), length(dFdy(vSP)));
gLod = log2(gFp * ${NZ_RES.toFixed(1)}) + 1.0;
gV = normalize(cameraPosition - vSWp);
gNdv = saturate(dot(gNw, gV));
Surf sS = Surf(diffuseColor.rgb, roughnessFactor, metalnessFactor, vec3(0.0), vec2(0.0), vec3(0.0), diffuseColor.a, 1.0);
surfaceMain(sS);
diffuseColor = vec4(max(sS.albedo, 0.0), sS.alpha);
metalnessFactor = saturate(sS.metal);
totalEmissiveRadiance += sS.emissive;
float sAO = sS.ao;
#if SURF_Q < 1
// low: the surface keeps its colour and roughness layers and gives up fine relief
roughnessFactor = clamp(sS.rough, 0.03, 1.0);
#else
{
  // slope in noise space -> screen-space height derivatives -> perturbed view normal. The slope is
  // analytic per pixel, so there is no 2x2 derivative blockiness however close the camera gets.
  vec3 sGr = sS.grad + gGradX;
  vec2 sdH = sS.dH + vec2(dot(sGr, dFdx(vSP)), dot(sGr, dFdy(vSP))) + vec2(dFdx(gHt), dFdy(gHt));
  vec3 sSx = dFdx(-vViewPosition), sSy = dFdy(-vViewPosition);
  vec3 sR1 = cross(sSy, normal), sR2 = cross(normal, sSx);
  float sDet = dot(sSx, sR1) * faceDirection;
  if (abs(sDet) > 1e-14) normal = normalize(abs(sDet) * normal - sign(sDet) * (sdH.x * sR1 + sdH.y * sR2));
  // specular anti-aliasing: normal variation inside the pixel becomes roughness
  vec3 sNx = dFdx(normal), sNy = dFdy(normal);
  float sVar = min(0.5 * (dot(sNx, sNx) + dot(sNy, sNy)), 0.2);
  roughnessFactor = sqrt(clamp(sS.rough * sS.rough + sVar, 0.0009, 1.0));
}
#endif
`;

const FRAG_AFTER_LIGHTS = /* glsl */ `
reflectedLight.indirectDiffuse *= sAO;
reflectedLight.indirectSpecular *= mix(1.0, sAO, 0.8);
`;

// Every injection goes through here. A missing target would otherwise leave a plain white
// MeshStandardMaterial with no sign anything went wrong, so it is reported to window.__errors.
const reported = new Set();
function report(msg) {
  if (reported.has(msg)) return;
  reported.add(msg);
  console.error(msg);       // the harness mirrors console.error into window.__errors
}
function put(src, target, text, kind, before = false) {
  if (!src.includes(target)) {
    report(`[mats] ${kind}: shader injection target "${target}" not found; this material will not render correctly`);
    return src;
  }
  return src.replace(target, before ? `${text}\n${target}` : `${target}\n${text}`);
}

function injectVertex(src, kind) {
  return put(put(src, '#include <common>', VERT_PARS, kind), '#include <project_vertex>', VERT_MAIN, kind);
}

// ?mbcold=1 (matboard only) perturbs one constant so the driver's shader cache misses and the
// overlay shows a true cold compile time.
let coldSalt = 0;

function injectFragment(src, def) {
  const k = def.kind;
  let out = put(src, '#include <clipping_planes_pars_fragment>', `${FRAG_COMMON}\n${def.glsl}`, k);
  out = put(out, '#include <normal_fragment_maps>', FRAG_MAIN, k);
  out = put(out, '#include <lights_fragment_end>', `${FRAG_AFTER_LIGHTS}\n${def.post || ''}`, k);
  if (def.lightPars) out = put(out, '#include <lights_physical_pars_fragment>', def.lightPars, k);
  if (def.out) out = put(out, '#include <opaque_fragment>', def.out, k);
  if (coldSalt) out = out.replace('0.0009, 1.0));', `${(0.0009 + coldSalt).toFixed(12)}, 1.0));`);
  return out;
}

// Depth / distance (shadow) variants for materials that discard: same vertex data, same cut.
const FRAG_CUT_MAIN = /* glsl */ `
gA = vSA; gWp = vSWp;
gN = normalize(vSN);
gNw = gN;
gP = vSP + uSeedOff;
gFp = max(length(dFdx(vSP)), length(dFdy(vSP)));
gLod = log2(gFp * ${NZ_RES.toFixed(1)}) + 1.0;
if (surfaceCut()) discard;
`;
function injectCut(shader, def) {
  const k = `${def.kind}:shadow`;
  shader.vertexShader = injectVertex(shader.vertexShader, k);
  let f = put(shader.fragmentShader, '#include <clipping_planes_pars_fragment>', `${FRAG_COMMON}\n${def.cut}`, k);
  shader.fragmentShader = put(f, '#include <clipping_planes_fragment>', FRAG_CUT_MAIN, k);
}

// Called once at start-up: if this three version has moved a chunk we inject at, fail the factory
// so boot reports "[boot] mats failed" instead of shipping white materials.
function checkTargets() {
  const need = {
    standard: [['vertexShader', ['#include <common>', '#include <project_vertex>']],
      ['fragmentShader', ['#include <clipping_planes_pars_fragment>', '#include <normal_fragment_maps>', '#include <lights_fragment_end>', '#include <lights_physical_pars_fragment>', '#include <opaque_fragment>']]],
    basic: [['vertexShader', ['#include <common>', '#include <project_vertex>']], ['fragmentShader', ['#include <clipping_planes_pars_fragment>', '#include <opaque_fragment>']]],
    depth: [['vertexShader', ['#include <common>', '#include <project_vertex>']], ['fragmentShader', ['#include <clipping_planes_pars_fragment>', '#include <clipping_planes_fragment>']]],
    distance: [['vertexShader', ['#include <common>', '#include <project_vertex>']], ['fragmentShader', ['#include <clipping_planes_pars_fragment>', '#include <clipping_planes_fragment>']]],
  };
  const missing = [];
  for (const [lib, parts] of Object.entries(need)) {
    const L = ShaderLib[lib];
    if (!L) { missing.push(`ShaderLib.${lib}`); continue; }
    for (const [part, targets] of parts) for (const t of targets) if (!L[part].includes(t)) missing.push(`${lib}.${part} ${t}`);
  }
  if (!/void RE_Direct_Physical\(/.test(ShaderChunk.lights_physical_pars_fragment || '')) missing.push('RE_Direct_Physical');
  if (missing.length) throw new Error(`shader injection targets missing in this three version: ${missing.join('; ')}`);
}

// ---- small kinds that live here -------------------------------------------------------------------

const hardDef = {
  kind: 'hard',
  glsl: /* glsl */ `
uniform vec3 uHColor;
uniform float uHRough;
uniform float uHMetal;
uniform float uHGrain;
uniform float uHAge;
uniform float uHDust;
void surfaceMain(inout Surf s) {
  vec3 p = gP;
  float lo = sFbm(p + 4.0, 3.0);
  #if SURF_Q > 0
  vec4 gr = sFbmD(p, 600.0);
  #else
  vec4 gr = vec4(0.5, 0.0, 0.0, 0.0);
  #endif
  vec3 alb = uHColor * mix(0.85 + 0.3 * lo, 1.0, uHMetal);
  float rough = uHRough * (0.85 + 0.3 * gr.x);
  float metal = uHMetal;
  vec3 g = gr.yzw * 0.00002 * uHGrain;
  if (uHMetal > 0.5) {
    // wiping haze: micro scratches drawn out along one axis (the grain field, squeezed)
    float fs = sFade(1800.0);
    #if SURF_Q > 1
    if (fs > 0.0) g += sAnisoD(p, vec3(0.0, 1.0, 0.0), 40.0, 1800.0).yzw * 0.000004 * fs;
    #endif
    rough += 0.05 * (1.0 - fs);
    // pits and tea-stain rust
    #if SURF_Q > 0
    vec4 v = sFade(520.0) > 0.0 ? sVoro(p, 260.0) : vec4(1.0, 1.0, 1.0, 0.5);
    #else
    vec4 v = vec4(1.0, 1.0, 1.0, 0.5);
    #endif
    float pit = (1.0 - smoothstep(0.05, 0.16, v.x)) * (1.0 - smoothstep(uHAge * 0.5 - 0.04, uHAge * 0.5, v.z)) * sFade(520.0);
    float stain = smoothstep(0.7, 0.85, lo) * uHAge * (0.3 + 0.7 * v.w);
    float corr = max(pit, stain * 0.35);
    alb = mix(alb, vec3(0.2, 0.08, 0.02) * (0.6 + 0.8 * gr.x), corr);
    rough = mix(rough, 0.7, corr);
    metal *= 1.0 - corr;
  } else {
    // rubber: brown bloom and pale scuffs with age
    alb = mix(alb, vec3(0.06, 0.045, 0.035), uHAge * smoothstep(0.4, 0.8, lo) * 0.6);
    #if SURF_Q > 0
    float scuff = smoothstep(0.7, 0.85, sFbm(p + 50.0, 14.0)) * uHAge;
    #else
    float scuff = 0.0;
    #endif
    alb = mix(alb, vec3(0.09), scuff * 0.5);
  }
  float dust = uHDust * clamp(smoothstep(0.5, 0.8, lo) * (1.0 - uHMetal) + sSplashBand() * 1.5 + 0.3 * smoothstep(0.3, 0.9, gNw.y) * (1.0 - uHMetal), 0.0, 1.0);
  alb = mix(alb, vec3(0.085, 0.07, 0.055), dust * 0.75);
  rough = mix(rough, 0.95, dust * 0.8);
  metal *= 1.0 - dust * 0.9;
  s.albedo = alb; s.rough = rough; s.metal = metal; s.grad = g;
  float w = sWetAmount();
  sWetHard(s, w, lo);
  s.albedo *= 1.0 - 0.4 * w * dust;
}
`,
};

// Unlit emitters (neon tubes, lamp lenses, signs) on MeshBasicMaterial: one program for both.
const EMIT_VERT_PARS = /* glsl */ `
varying vec3 vENv;
varying vec3 vEVp;
varying vec3 vEP;
`;
const EMIT_VERT_MAIN = /* glsl */ `
vENv = normalize(normalMatrix * normal);
vEVp = mvPosition.xyz;
vEP = position;
`;
const EMIT_FRAG_PARS = /* glsl */ `
varying vec3 vENv;
varying vec3 vEVp;
varying vec3 vEP;
uniform float uTime;
uniform vec3 uEColor;
uniform float uENits;
uniform float uEOn;
uniform float uEFlicker;
uniform float uETube;
uniform float uESeed;
float eHash(float n) { return fract(sin(n * 127.1 + uESeed * 31.7) * 43758.5453); }
`;
const EMIT_FRAG_MAIN = /* glsl */ `
{
  float ndv = abs(dot(normalize(vENv), normalize(-vEVp)));
  // failing-tube flicker: mains hum plus irregular dropouts
  float tk = floor(uTime * 24.0);
  float drop = step(eHash(floor(uTime * 1.7)), 0.45) * step(0.55, eHash(tk));
  float fl = 1.0 - uEFlicker * (0.12 * (0.5 + 0.5 * sin(uTime * 754.0)) + 0.85 * drop);
  float on = uEOn * fl;
  vec3 c = uEColor * uENits;
  vec3 offCol = vec3(0.012, 0.013, 0.015);
  if (uETube > 0.5) {
    // gas column: hot desaturated core facing the eye, saturated limb, glass shell when off
    float core = pow(ndv, 2.2);
    vec3 lit = mix(c * 0.5, mix(c, vec3(dot(c, vec3(0.3333))), 0.6) * 1.9, core);
    offCol = mix(vec3(0.05, 0.052, 0.055), vec3(0.01), core) * (0.4 + 0.6 * dot(uEColor, vec3(0.3333)));
    outgoingLight = mix(offCol, lit, on);
  } else {
    // lens/diffuser: slightly hotter in the middle of the face than at grazing angles
    outgoingLight = mix(offCol, c * (0.85 + 0.15 * ndv), on);
  }
}
`;

function injectEmit(shader) {
  shader.vertexShader = put(put(shader.vertexShader, '#include <common>', EMIT_VERT_PARS, 'emit'), '#include <project_vertex>', EMIT_VERT_MAIN, 'emit');
  shader.fragmentShader = put(put(shader.fragmentShader, '#include <clipping_planes_pars_fragment>', EMIT_FRAG_PARS, 'emit'),
    '#include <opaque_fragment>', EMIT_FRAG_MAIN, 'emit', true);
}

// ---- factory --------------------------------------------------------------------------------------

export const toColor = (c, fallback) => {
  if (c === undefined || c === null) return new Color(fallback);
  return c.isColor ? c.clone() : new Color(c);
};

function seedOffset(seed) {
  if (!seed) return new Vector3(0, 0, 0);
  const f = (k) => ((seed * k) % 1 + 1) % 1;
  return new Vector3(f(0.61803398) * 53 + 3, f(0.75487766) * 47 + 5, f(0.56984029) * 59 + 7);
}

export function createMats(G) {
  checkTargets();
  const rng = G.rng.fork('mats');
  const shared = { uTime: { value: 0 }, uRain: { value: 0.7 }, uWetness: { value: 0.85 } };
  // noise textures: generated once here, on the GPU (noiseTex.js); every material samples them
  const noise = createNoiseTextures(G.renderer);
  const noiseU = { tNzA: { value: noise.tNzA }, tNzB: { value: noise.tNzB } };
  // quality: SURF_Q define on every material, kept in step with G.quality
  const qLevel = () => ({ low: 0, medium: 1, high: 2 })[(G.quality && (G.quality.name || G.quality.preset)) || 'high'] ?? 2;
  const live = new Set();
  if (G.quality && G.quality.onChange) {
    G.quality.onChange(() => {
      const q = qLevel();
      for (const m of live) if (m.defines.SURF_Q !== q) { m.defines.SURF_Q = q; m.needsUpdate = true; }
    });
  }
  const syncTime = () => { if (G.time) shared.uTime.value = G.time.t; };
  // per draw: keep time current, and catch space:'rest' on a geometry that was never baked
  function beforeRender(_r, _s, _c, geometry) {
    syncTime();
    if (this.surf.uRestMix.value === 1 && geometry && !geometry.attributes.aRest) {
      this.surf.uRestMix.value = 0;
      console.warn(`[mats] ${this.name}: space:'rest' but the geometry has no aRest attribute (call G.mats.bakeRest); using object space`);
    }
  }

  // Build a surface material. def: { kind, glsl, post?, lightPars?, out?, space? }.
  // Common options (every factory): space 'world'|'object'|'rest', seed, shelter 0..1, splash 0..1,
  // groundY, side, name.
  function build(def, opts = {}, uniforms = {}, params = {}) {
    const space = opts.space ?? def.space ?? 'world';
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, ...params });
    if (opts.side !== undefined) mat.side = opts.side;
    const u = {
      ...shared,
      ...noiseU,
      uSeedOff: { value: seedOffset(opts.seed) },
      uShelter: { value: opts.shelter ?? 0 },
      uSplash: { value: opts.splash ?? def.splash ?? 1 },
      uGroundY: { value: opts.groundY ?? 0 },
      uRestMix: { value: space === 'rest' ? 1 : 0 },
      ...uniforms,
    };
    mat.surf = u;
    mat.defines = { ...mat.defines, [space === 'world' ? 'SURF_WORLD' : 'SURF_LOCAL']: 1, SURF_Q: qLevel() };
    live.add(mat);
    mat.addEventListener('dispose', () => live.delete(mat));
    mat.customProgramCacheKey = () => `surf:${def.kind}`;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = injectVertex(shader.vertexShader, def.kind);
      shader.fragmentShader = injectFragment(shader.fragmentShader, def);
    };
    mat.onBeforeRender = beforeRender;
    mat.name = opts.name ?? def.kind;
    mat.userData.surfDef = def;
    return mat;
  }

  function hard(opts, d) {
    return build(hardDef, opts, {
      uHColor: { value: toColor(opts.color, d.color) },
      uHRough: { value: opts.roughness ?? d.roughness },
      uHMetal: { value: d.metal },
      uHGrain: { value: d.grain },
      uHAge: { value: opts.age ?? d.age },
      uHDust: { value: opts.dust ?? d.dust },
    });
  }

  function emit(opts, tube) {
    const mat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    const u = {
      uTime: shared.uTime,
      uEColor: { value: toColor(opts.color, tube ? 0xff2a3a : 0xffffff) },
      uENits: { value: opts.nits ?? (tube ? 40 : 50) },
      uEOn: { value: opts.on === undefined ? 1 : Number(opts.on) },
      uEFlicker: { value: opts.flicker ?? 0 },
      uETube: { value: tube ? 1 : 0 },
      uESeed: { value: opts.seed ?? 0 },
    };
    mat.surf = u;
    mat.customProgramCacheKey = () => 'surf:emit';
    mat.onBeforeCompile = (shader) => { Object.assign(shader.uniforms, u); injectEmit(shader); };
    mat.onBeforeRender = syncTime;
    mat.name = tube ? 'neon' : 'emissive';
    return mat;
  }

  const ctx = { build, rng, shared, toColor, G, noise };

  const mats = {
    shared,
    update() { syncTime(); },
    // the generated noise textures and what they cost at load: { tNzA, tNzB, tAgg, ms }
    noise,

    asphalt: (opts = {}) => makeGround(opts, ctx),
    concrete: (opts = {}) => makeConcrete(opts, ctx),
    paintedMetal: (opts = {}) => makePaintedMetal(opts, ctx),
    glass: (opts = {}) => makeGlass(opts, ctx),
    rubber: (opts = {}) => hard(opts, { color: 0x2a2a2b, roughness: 0.82, metal: 0, grain: 6, age: 0.4, dust: 0.5 }),
    chrome: (opts = {}) => hard(opts, { color: 0xdfe2e6, roughness: 0.07, metal: 1, grain: 0.4, age: 0.3, dust: 0.25 }),
    gunmetal: (opts = {}) => makeGunmetal(opts, ctx),
    skin: (opts = {}) => makeSkin(opts, ctx),
    cloth: (opts = {}) => makeCloth(opts, ctx),
    neon: (opts = {}) => emit(opts, true),
    emissive: (opts = {}) => emit(opts, false),

    // Shadow-pass twins for a material that discards (torn cloth): the depth and distance passes
    // cut the same pixels, skinned or not. Returns null for materials with nothing to cut.
    shadowMaterials(material) {
      const def = material.userData.surfDef;
      if (!def || !def.cut) return null;
      if (material.userData.shadowMats) return material.userData.shadowMats;
      const make = (M, params) => {
        const m = new M(params);
        m.side = material.side;
        m.defines = { ...m.defines, [material.defines.SURF_LOCAL ? 'SURF_LOCAL' : 'SURF_WORLD']: 1 };
        m.customProgramCacheKey = () => `surf:${def.kind}:shadow`;
        m.onBeforeCompile = (shader) => { Object.assign(shader.uniforms, material.surf); injectCut(shader, def); };
        return m;
      };
      const out = { depth: make(MeshDepthMaterial, {}), distance: make(MeshDistanceMaterial, {}) };
      material.userData.shadowMats = out;
      return out;
    },
    // Convenience: set mesh.customDepthMaterial / customDistanceMaterial from its material.
    castCutShadows(mesh) {
      const sm = mats.shadowMaterials(mesh.material);
      if (sm) { mesh.customDepthMaterial = sm.depth; mesh.customDistanceMaterial = sm.distance; }
      return mesh;
    },

    // Bake the rest pose into `aRest` (and make sure `aSurf` exists) so materials created with
    // space:'rest' sample noise in a space that never moves. `matrix` places a part in the shared
    // model space (weapon parts, merged body parts); omit it to copy positions as they are.
    // masks: { wear, blood, grip } each a number or (x, y, z, i) => number, written to aSurf.xyz.
    // Aliases: wound / tear = wear (x), fold = grip (z).
    bakeRest(geometry, { matrix = null, masks = null } = {}) {
      const pos = geometry.getAttribute('position');
      const rest = new Float32Array(pos.count * 3);
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (matrix) v.applyMatrix4(matrix);
        rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
      }
      geometry.setAttribute('aRest', new BufferAttribute(rest, 3));
      if (masks || !geometry.getAttribute('aSurf')) {
        const a = new Float32Array(pos.count * 4);
        const keys = [['wear', 'wound', 'tear'], ['blood'], ['grip', 'fold']];
        for (let i = 0; i < pos.count; i++) {
          for (let k = 0; k < 3; k++) {
            const name = masks && keys[k].find((n) => masks[n] !== undefined);
            const m = name && masks[name];
            a[i * 4 + k] = typeof m === 'function' ? m(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], i) : (m || 0);
          }
        }
        geometry.setAttribute('aSurf', new BufferAttribute(a, 4));
      }
      return geometry;
    },
  };

  if (G.params.shot === 'matboard') {
    if (/[?&]mbcold=1/.test(window.location.search)) coldSalt = (1 + (Date.now() % 100000)) * 1e-10;
    installMatboard(G, mats);
  }
  return mats;
}
