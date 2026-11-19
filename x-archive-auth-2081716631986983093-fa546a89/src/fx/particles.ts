/**
 * GPU PARTICLE ENGINE — every spark, ember, smoke puff and shield spray in
 * Starfall is drawn by this module, in exactly two draw calls.
 *
 * ---------------------------------------------------------------------------
 * DESIGN
 * ---------------------------------------------------------------------------
 * The CPU writes a particle ONCE, at emit time: birth position, birth velocity,
 * a drag coefficient, two colours, two sizes, a birth timestamp and a lifetime.
 * After that the CPU never touches it again. The vertex shader integrates the
 * closed-form trajectory of a linearly-damped particle
 *
 *     v(t) = v0 * e^(-k t)
 *     p(t) = p0 + v0 * (1 - e^(-k t)) / k          (k -> 0 degenerates to v0*t)
 *
 * which means 120k particles cost one `bufferSubData` of the freshly emitted
 * slots per frame and nothing else. Dead particles collapse to a degenerate
 * quad in the vertex shader and never reach rasterisation.
 *
 * Slots live in a ring buffer per pool. Emission walks the ring forward, so the
 * slot that gets recycled under pressure is always the oldest one — overflow
 * degrades by dropping ancient particles rather than by refusing new ones.
 *
 * ---------------------------------------------------------------------------
 * TWO POOLS
 * ---------------------------------------------------------------------------
 * Additive (fire, sparks, plasma, shield light) and alpha (smoke, dust, vent
 * gas) cannot be interleaved in one draw without a per-particle sort, so each
 * gets its own mesh, its own instance buffers and its own slice of the budget.
 * Alpha draws first (renderOrder 20), additive on top (21).
 *
 * ---------------------------------------------------------------------------
 * INTEGRATOR NOTES
 * ---------------------------------------------------------------------------
 *  - `setDepthTexture(t)` must be fed the scene depth attachment for soft
 *    particles. Without it the system still runs; sprites simply intersect
 *    geometry with a hard edge.
 *  - The fire sprite sheet is requested as `textures.fireSheet(FIRE_SHEET_DIM,
 *    FIRE_SHEET_PX)` and assumed to be a FIRE_SHEET_DIM x FIRE_SHEET_DIM grid
 *    laid out left-to-right, bottom-to-top. A top-down sheet still animates,
 *    just with the rows visited in the other order — harmless.
 *  - The meshes are plain `Mesh` + `InstancedBufferGeometry`, not
 *    `InstancedMesh`: we do not want the 64 bytes/instance `instanceMatrix`
 *    buffer that `InstancedMesh` forces, since the shader builds its own
 *    camera-facing basis.
 *  - `quality.maxParticles` is the ceiling allocated at construction.
 *    `setQuality` may lower the working limit at any time; it cannot raise it
 *    above the originally allocated capacity.
 */

import * as THREE from 'three';
import { GLSL_UTIL, type RenderContext, type RenderSystem, type TextureFactory } from '../core/contracts';
import { Rng, hash3 } from '../core/rng';
import type { QualitySettings } from '../core/types';
import type { World } from '../sim/world';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Fire sheet grid dimension — the sheet holds FIRE_SHEET_DIM^2 frames. */
export const FIRE_SHEET_DIM = 8;
/** Pixel resolution requested for the fire sheet. */
const FIRE_SHEET_PX = 1024;
/** Fraction of the budget handed to the additive pool; the rest goes to alpha. */
const ADDITIVE_SHARE = 0.72;
/** Floats per instance attribute (all six are vec4). */
const V4 = 4;
/** Slots swept per pool per frame while recounting the live population. */
const SWEEP_SLICE = 8192;

/**
 * SPRITE ATLAS — 4 columns x 4 rows of square cells (critique round 1,
 * particles.ts: "every spark, flash and muzzle event is the same soft round
 * gaussian ... no sprite variety, nothing reads as a spark"; round 2 brief:
 * "give the sprite atlas real variety: streaks, irregular shards, smoke wisps,
 * embers, with varied rotation, colour temperature and lifetime").
 *
 * The atlas is FOUR FAMILIES of FOUR cells each — one family per row. A particle
 * picks one of the four siblings of its family from its own stable shader seed,
 * so a burst of thirty sparks draws roughly seven or eight copies of each of
 * four different silhouettes instead of thirty of one:
 *
 *   row 0  glow    soft gaussian | torn hot halo | pinpoint + skirt | lobed flare
 *   row 1  streak  fat capsule   | thin needle   | beaded dash      | curved comet
 *   row 2  shard   lit chip      | ember + spike | long splinter    | angular chunk
 *   row 3  smoke   billow puff   | torn wisp     | sheared veil     | vortex ring
 *
 * Cells are 192 px: sprites are drawn at well under 128 px on screen and the
 * atlas is built on the CPU once at load, so 768x768 is the right trade.
 */
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
/** Edge length of one atlas cell, in pixels. */
const ATLAS_CELL = 192;
/** Siblings per family — one full row. */
const ATLAS_SIBS = 4;

/** First cell of each family; siblings are `+0..+3`. `kind` 1 uses the fire sheet. */
const CELL_GLOW = 0;
const CELL_STREAK = 4;
const CELL_SHARD = 8;
const CELL_SMOKE = 12;

// ---------------------------------------------------------------------------
// Emit record
// ---------------------------------------------------------------------------

/**
 * One particle's spawn description. Never construct these — fill the shared
 * scratch record `P` and call `ParticleSystem.emit()`, which keeps the hot path
 * allocation-free.
 */
export interface EmitParams {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** metres */ size: number; sizeEnd: number;
  /** linear RGB */ r: number; g: number; b: number;
  rEnd: number; gEnd: number; bEnd: number;
  /** 0..1 */ alpha: number; alphaEnd: number;
  life: number;            // seconds
  drag: number;            // per second velocity damping 0..1
  spin: number;            // rad/s billboard rotation
  /**
   * Which sprite FAMILY to draw. The concrete atlas cell is picked from the
   * particle's own seed between the family's two siblings, so a burst is never
   * one repeated sprite:
   *   0 glow (4 siblings)         1 animated fire sheet
   *   2 streak (4 siblings)       3 smoke (4 siblings)
   *   4 shard (4 siblings)
   * Historically typed `0 | 1 | 2 | 3`; widened for family 4. Old call sites
   * assigning 0..3 still type-check.
   */
  kind: number;
  /** additive (true) vs alpha-blended (false) */
  additive: boolean;
  /** velocity-stretch factor for spark streaks, 0 = round */
  stretch: number;
  /** gravity-well style attraction toward a point, 0 = none */
  turbulence: number;
}

/**
 * The shared scratch emit record. Fill it, call `emit()`, repeat. Contents are
 * only read during the `emit()` call, so the same object is safe to reuse
 * immediately.
 */
export const P: EmitParams = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size: 1, sizeEnd: 1,
  r: 1, g: 1, b: 1,
  rEnd: 1, gEnd: 1, bEnd: 1,
  alpha: 1, alphaEnd: 0,
  life: 1,
  drag: 0,
  spin: 0,
  kind: 0,
  additive: true,
  stretch: 0,
  turbulence: 0,
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

// Emission shapes. Plain consts rather than a `const enum`, which `isolatedModules` dislikes.
/** Uniform on the sphere. */
const SHAPE_SPHERE = 0;
/** Cone about the aim axis. */
const SHAPE_CONE = 1;
/** Flat ring in the plane perpendicular to the aim axis. */
const SHAPE_DISC = 2;

interface Preset {
  kind: number;
  additive: boolean;
  shape: 0 | 1 | 2;
  /** Cone half-angle, radians (SHAPE_CONE only). */
  cone: number;
  /** Speed range in m/s at `scale` = 1. */
  spdMin: number; spdMax: number;
  /** Birth / death sprite radius in metres at `scale` = 1. */
  sizeA: number; sizeB: number;
  /** Lifetime range in seconds at `scale` = 1. */
  lifeMin: number; lifeMax: number;
  /** Exponential damping RATE in 1/s (converted to the 0..1 `EmitParams.drag` form on use). */
  drag: number;
  /** Max |spin| in rad/s; the sign is randomised. */
  spin: number;
  stretch: number;
  turbulence: number;
  /** Linear HDR start / end colour. Values above 1 are intentional — they bloom. */
  r: number; g: number; b: number;
  rEnd: number; gEnd: number; bEnd: number;
  alpha: number; alphaEnd: number;
  /** +/- fractional jitter applied to size and lifetime. */
  jitter: number;
  /** Birth position scatter radius in units of `scale`. */
  scatter: number;
  /**
   * +/- colour-TEMPERATURE spread applied per particle, 0..1 (critique round 1:
   * "everything is born and dies white ... no hot-to-cool ramp"). 0 keeps the
   * quoted colour exactly; 0.6 means individual particles range from a cool
   * deep-red ember to a blue-white spark inside the same burst.
   */
  temp: number;
  /** Cached max(r,g,b) of the start / end colour, for tinting. Filled at load. */
  iStart: number; iEnd: number;
}

const mkPreset = (p: Omit<Preset, 'iStart' | 'iEnd'>): Preset => ({
  ...p,
  iStart: Math.max(p.r, p.g, p.b),
  iEnd: Math.max(p.rEnd, p.gEnd, p.bEnd),
});

/**
 * Burst distributions. Speeds/sizes/lifetimes are quoted for `scale` = 1, which
 * corresponds to a fighter-calibre weapon impact (a sub-metre event).
 */
const PRESETS: Record<string, Preset> = {
  /**
   * White-hot metal fragments thrown off an impact. Streaked, fast, short.
   * Chroma pushed hard (blue held near zero) so that even when the red channel
   * clips the particle still reads ORANGE rather than white — critique round 1,
   * "particles are blowing out to featureless white".
   */
  spark: mkPreset({
    kind: 2, additive: true, shape: SHAPE_SPHERE, cone: 0,
    spdMin: 30, spdMax: 118, sizeA: 0.30, sizeB: 0.04,
    lifeMin: 0.30, lifeMax: 1.0, drag: 2.2, spin: 0, stretch: 1.35, turbulence: 0,
    r: 3.1, g: 1.18, b: 0.24, rEnd: 0.85, gEnd: 0.11, bEnd: 0.012,
    alpha: 1, alphaEnd: 0, jitter: 0.45, scatter: 0.15, temp: 0.55,
  }),
  /** Cold grey-brown smoke that expands, slows and curls. Alpha-blended. */
  smoke: mkPreset({
    kind: 3, additive: false, shape: SHAPE_SPHERE, cone: 0,
    spdMin: 3, spdMax: 15, sizeA: 1.2, sizeB: 5.4,
    lifeMin: 1.6, lifeMax: 3.4, drag: 1.5, spin: 0.75, stretch: 0, turbulence: 0.55,
    r: 0.16, g: 0.152, b: 0.145, rEnd: 0.035, gEnd: 0.035, bEnd: 0.045,
    alpha: 0.5, alphaEnd: 0, jitter: 0.4, scatter: 0.6, temp: 0.18,
  }),
  /** The hot core of an explosion — animated fire sheet, blows out to white. */
  fireball: mkPreset({
    kind: 1, additive: true, shape: SHAPE_SPHERE, cone: 0,
    spdMin: 4, spdMax: 30, sizeA: 2.0, sizeB: 6.0,
    lifeMin: 0.42, lifeMax: 0.95, drag: 3.0, spin: 1.4, stretch: 0, turbulence: 0.2,
    r: 2.4, g: 0.92, b: 0.20, rEnd: 0.3, gEnd: 0.045, bEnd: 0.012,
    alpha: 0.9, alphaEnd: 0, jitter: 0.35, scatter: 1.1, temp: 0.45,
  }),
  /** Flat expanding ring of lit dust — reads as the shock front. */
  shockdust: mkPreset({
    kind: 3, additive: false, shape: SHAPE_DISC, cone: 0,
    spdMin: 38, spdMax: 72, sizeA: 1.8, sizeB: 9.0,
    lifeMin: 0.75, lifeMax: 1.5, drag: 3.6, spin: 0.6, stretch: 0, turbulence: 0.25,
    r: 0.55, g: 0.45, b: 0.36, rEnd: 0.07, gEnd: 0.07, bEnd: 0.085,
    alpha: 0.42, alphaEnd: 0, jitter: 0.35, scatter: 0.3, temp: 0.2,
  }),
  /**
   * Embers shed by tumbling wreckage. Slow, long-lived, tumbling chips.
   * NB `stretch` must stay 0: velocity-alignment overrides billboard rotation
   * in the vertex shader, and the whole point of this preset is now the tumble.
   */
  debrisTrail: mkPreset({
    kind: 4, additive: true, shape: SHAPE_SPHERE, cone: 0,
    spdMin: 4, spdMax: 20, sizeA: 0.42, sizeB: 0.08,
    lifeMin: 0.6, lifeMax: 1.6, drag: 1.1, spin: 2.6, stretch: 0, turbulence: 0.35,
    r: 1.7, g: 0.48, b: 0.10, rEnd: 0.4, gEnd: 0.045, bEnd: 0.010,
    alpha: 1, alphaEnd: 0, jitter: 0.45, scatter: 0.25, temp: 0.5,
  }),
  /** Barrel flash — a tight forward cone that dies in a couple of frames. */
  muzzle: mkPreset({
    kind: 1, additive: true, shape: SHAPE_CONE, cone: 0.42,
    spdMin: 55, spdMax: 145, sizeA: 1.1, sizeB: 0.18,
    lifeMin: 0.055, lifeMax: 0.14, drag: 6.5, spin: 1.6, stretch: 0.55, turbulence: 0,
    r: 3.6, g: 2.55, b: 1.5, rEnd: 1.1, gEnd: 0.42, bEnd: 0.14,
    alpha: 1, alphaEnd: 0, jitter: 0.3, scatter: 0.1, temp: 0.35,
  }),
  /** Shield hit — a wide hemispherical spray that skids along the bubble. */
  shieldSpray: mkPreset({
    kind: 2, additive: true, shape: SHAPE_CONE, cone: 1.25,
    spdMin: 28, spdMax: 105, sizeA: 0.46, sizeB: 0.05,
    lifeMin: 0.22, lifeMax: 0.6, drag: 3.4, spin: 0, stretch: 1.0, turbulence: 0,
    r: 0.62, g: 1.75, b: 2.7, rEnd: 0.08, gEnd: 0.3, bEnd: 0.7,
    alpha: 1, alphaEnd: 0, jitter: 0.35, scatter: 0.35, temp: 0.25,
  }),
  /**
   * HULL STRIKE — the directional spark cone the critique asks for: a tight
   * cone thrown back along the surface normal, very fast, hard needles, cooling
   * from white through yellow to dark red over its own life.
   */
  hullSpark: mkPreset({
    kind: 2, additive: true, shape: SHAPE_CONE, cone: 0.62,
    spdMin: 55, spdMax: 210, sizeA: 0.30, sizeB: 0.03,
    lifeMin: 0.24, lifeMax: 0.85, drag: 2.6, spin: 0, stretch: 1.7, turbulence: 0.05,
    r: 3.4, g: 2.05, b: 0.85, rEnd: 0.75, gEnd: 0.075, bEnd: 0.008,
    alpha: 1, alphaEnd: 0, jitter: 0.5, scatter: 0.2, temp: 0.6,
  }),
  /**
   * Hard-edged lit chips spalled off armour by a hit. These are SHARDS, not
   * glows — they tumble (high spin) and are what stops an impact reading as one
   * repeated round sprite.
   */
  spall: mkPreset({
    kind: 4, additive: true, shape: SHAPE_CONE, cone: 0.95,
    spdMin: 18, spdMax: 78, sizeA: 0.34, sizeB: 0.12,
    lifeMin: 0.45, lifeMax: 1.5, drag: 1.6, spin: 5.5, stretch: 0, turbulence: 0.25,
    r: 1.9, g: 0.72, b: 0.16, rEnd: 0.22, gEnd: 0.035, bEnd: 0.008,
    alpha: 1, alphaEnd: 0, jitter: 0.55, scatter: 0.35, temp: 0.7,
  }),
  /** Drifting ionised motes — ambient sparkle around drives and ion damage. */
  ionMotes: mkPreset({
    kind: 0, additive: true, shape: SHAPE_SPHERE, cone: 0,
    spdMin: 1, spdMax: 6.5, sizeA: 0.22, sizeB: 0.85,
    lifeMin: 1.2, lifeMax: 2.8, drag: 0.65, spin: 0, stretch: 0, turbulence: 1.25,
    r: 0.18, g: 0.88, b: 1.6, rEnd: 0.02, gEnd: 0.11, bEnd: 0.24,
    alpha: 0.7, alphaEnd: 0, jitter: 0.5, scatter: 1.0, temp: 0.2,
  }),
  /** Atmosphere venting from a breached hull — a directional gas jet. */
  vent: mkPreset({
    kind: 3, additive: false, shape: SHAPE_CONE, cone: 0.2,
    spdMin: 20, spdMax: 58, sizeA: 0.55, sizeB: 3.6,
    lifeMin: 0.7, lifeMax: 1.7, drag: 2.6, spin: 0.9, stretch: 0, turbulence: 0.7,
    r: 0.62, g: 0.6, b: 0.58, rEnd: 0.09, gEnd: 0.1, bEnd: 0.13,
    alpha: 0.5, alphaEnd: 0, jitter: 0.35, scatter: 0.15, temp: 0.15,
  }),
};

/** Names accepted by `ParticleSystem.burst`. */
export const PARTICLE_PRESETS = Object.keys(PRESETS) as readonly string[];

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

// --- per instance -----------------------------------------------------------
attribute vec4 aP;   // xyz birth position (world, metres)   w size at birth
attribute vec4 aV;   // xyz birth velocity (world, m/s)      w drag rate k (1/s)
attribute vec4 aCA;  // rgb start colour (linear HDR)        a start alpha
attribute vec4 aCB;  // rgb end colour                       a end alpha
attribute vec4 aL;   // x birth time  y 1/life  z end size   w spin rad/s
attribute vec4 aF;   // x kind  y stretch  z turbulence      w seed 0..1

uniform float uTime;
uniform float uStreakTime;  // seconds of travel a stretch=1 streak spans
uniform float uTurbFreq;    // 1/metres — spatial frequency of the eddy field
uniform float uTurbAmp;     // eddy amplitude in units of birth size

varying vec4 vCol;
varying vec2 vUv;
varying float vKind;
varying float vU;        // normalised age 0..1
varying float vDepth;    // positive view-space depth, metres
varying float vSize;
varying float vSeed;     // stable per-particle 0..1 — picks the atlas sibling

void main() {
  float age = uTime - aL.x;
  float u = age * aL.y;

  if (u < 0.0 || u >= 1.0) {
    // Dead or unborn: collapse the quad behind the far plane. All four corners
    // land on the same clip position so the triangles are degenerate.
    vCol = vec4(0.0);
    vUv = vec2(0.0);
    vKind = 0.0;
    vU = 0.0;
    vDepth = 1.0;
    vSize = 0.0;
    vSeed = 0.0;
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      vFragDepth = 1.0;
      vIsPerspective = 0.0;
    #endif
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // -- closed-form damped trajectory ----------------------------------------
  float k = aV.w;
  float decay = exp(-k * age);
  vec3 disp = (k > 1e-3) ? aV.xyz * ((1.0 - decay) / k) : aV.xyz * age;
  vec3 velNow = aV.xyz * decay;
  vec3 wp = aP.xyz + disp;

  // -- turbulence: a cheap divergence-free-ish eddy field, plus a weak pull
  //    back toward the birth point so plumes curl instead of scattering.
  float turb = aF.z;
  if (turb > 0.0) {
    vec3 q = aP.xyz * uTurbFreq + aF.w * 37.1;
    vec3 eddy = vec3(
      sin(q.y + age * 0.90),
      sin(q.z * 1.13 + age * 0.71),
      sin(q.x * 0.87 + age * 1.29)
    );
    wp += eddy * (turb * aP.w * uTurbAmp * age) - disp * (turb * 0.22 * u);
  }

  float size = mix(aP.w, aL.z, u);

  // -- camera-facing basis, built in view space ------------------------------
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  vec2 corner = position.xy;                 // quad corners are +/-0.5

  float ang = aL.w * age + aF.w * 6.2831853;
  float cs = cos(ang), sn = sin(ang);
  vec2 offs = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs) * size;

  // -- velocity stretch: elongate along the screen-projected velocity --------
  if (aF.y > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(velNow, 0.0)).xyz;
    float l = length(vv.xy);
    if (l > 1e-4) {
      vec2 ax = vv.xy / l;                   // streak axis, screen aligned
      vec2 pp = vec2(-ax.y, ax.x);
      // Half-length covers the distance actually travelled in uStreakTime, so
      // a streak shortens naturally as drag eats the velocity. NB: "half" is a
      // reserved word in GLSL ES, hence halfLen.
      float halfLen = size + aF.y * length(velNow) * uStreakTime;
      offs = pp * (corner.x * size) + ax * (corner.y * halfLen);
    }
  }

  mv.xy += offs;

  vCol = mix(aCA, aCB, u);
  vUv = corner + 0.5;
  vKind = aF.x;
  vU = u;
  vSize = size;
  vSeed = aF.w;
  vDepth = -mv.z;

  gl_Position = projectionMatrix * mv;

  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
${GLSL_UTIL}
#include <logdepthbuf_pars_fragment>
// NOTE: three injects <tonemapping_pars_fragment> and <colorspace_pars_fragment>
// into the fragment prefix for every material — including them here would
// redefine toneMapping()/linearToOutputTexel() and fail to link.

uniform sampler2D uAtlas;
uniform sampler2D uFire;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec2 uNearFar;
uniform float uHasDepth;
uniform float uHasFire;
uniform float uSoftness;   // soft-particle fade distance, in units of sprite size
uniform float uFadeIn;     // normalised age over which a particle fades up

varying vec4 vCol;
varying vec2 vUv;
varying float vKind;
varying float vU;
varying float vDepth;
varying float vSize;
varying float vSeed;

const float ATLAS_INSET = 0.006;
const float FIRE_DIM = ${FIRE_SHEET_DIM.toFixed(1)};
const float ATLAS_C = ${ATLAS_COLS.toFixed(1)};
const float ATLAS_R = ${ATLAS_ROWS.toFixed(1)};
const float ATLAS_S = ${ATLAS_SIBS.toFixed(1)};

/** Map a 0..1 sprite uv into one cell of the 4x4 atlas. */
vec2 sf_cellUv(vec2 uv, float cell) {
  vec2 c = clamp(uv, ATLAS_INSET, 1.0 - ATLAS_INSET);
  vec2 base = vec2(mod(cell, ATLAS_C), floor(cell / ATLAS_C));
  return (base + c) / vec2(ATLAS_C, ATLAS_R);
}

/** Map a 0..1 sprite uv into the fire sheet frame selected by normalised age. */
vec2 sf_fireUv(vec2 uv, float u) {
  float total = FIRE_DIM * FIRE_DIM;
  float f = clamp(floor(u * total), 0.0, total - 1.0);
  vec2 base = vec2(mod(f, FIRE_DIM), floor(f / FIRE_DIM));
  vec2 c = clamp(uv, ATLAS_INSET, 1.0 - ATLAS_INSET);
  return (base + c) / FIRE_DIM;
}

/** Scene depth-buffer value -> positive linear view depth in metres. */
float sf_linearDepth(float d) {
  #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
    // gl_FragDepth was written as log2(1 + w) * logDepthBufFC * 0.5.
    return exp2(2.0 * d / logDepthBufFC) - 1.0;
  #else
    float ndc = d * 2.0 - 1.0;
    float n = uNearFar.x, f = uNearFar.y;
    return (2.0 * n * f) / (f + n - ndc * (f - n));
  #endif
}

void main() {
  #include <logdepthbuf_fragment>

  // -- family -> atlas cell. The sibling is picked from the particle's own seed
  //    across the family's FOUR cells, so a burst of thirty draws four distinct
  //    silhouettes rather than one repeated sprite (round 2 brief: "give the
  //    sprite atlas real variety").
  float sib = floor(fract(vSeed * 7.31) * ATLAS_S);
  vec4 tex;
  if (vKind < 0.5) {
    tex = texture2D(uAtlas, sf_cellUv(vUv, ${CELL_GLOW}.0 + sib));
  } else if (vKind < 1.5) {
    tex = (uHasFire > 0.5)
      ? texture2D(uFire, sf_fireUv(vUv, vU))
      : texture2D(uAtlas, sf_cellUv(vUv, ${CELL_GLOW}.0 + 1.0));
  } else if (vKind < 2.5) {
    tex = texture2D(uAtlas, sf_cellUv(vUv, ${CELL_STREAK}.0 + sib));
  } else if (vKind < 3.5) {
    tex = texture2D(uAtlas, sf_cellUv(vUv, ${CELL_SMOKE}.0 + sib));
  } else {
    tex = texture2D(uAtlas, sf_cellUv(vUv, ${CELL_SHARD}.0 + sib));
  }

  float a = vCol.a * tex.a;

  // -- soft particles: dissolve where the sprite intersects scene geometry ---
  if (uHasDepth > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
    float sceneZ = sf_linearDepth(d);
    a *= clamp((sceneZ - vDepth) / max(vSize * uSoftness, 0.25), 0.0, 1.0);
  }

  // -- and dissolve sprites the camera is flying into, so a big smoke puff
  //    thins out over its last radius of approach instead of clipping ---------
  a *= clamp((vDepth - uNearFar.x) / max(vSize, 0.5), 0.0, 1.0);
  a *= smoothstep(0.0, uFadeIn, vU);

  if (a < 0.0035) discard;

  // tex.rgb is the cell's internal luminance structure (filaments, facet
  // shading, density) — NOT a flat 1.0. Multiplying it in is what stops a hot
  // sprite reading as a featureless disc once its alpha saturates.
  vec3 c = vCol.rgb * tex.rgb;

  // -- blow-out guard (critique round 1 AND round 2 brief: "particles are still
  //    blowing out to featureless white ... preserve hot cores while retaining
  //    internal structure and colour"). Once the peak channel drives past 1 the
  //    weaker channels are pulled toward their squared ratio, so an over-bright
  //    ember clips to a saturated orange with a white filament through it rather
  //    than to a flat white splat.
  //
  //    The strength now PEAKS in the 1..3 range — the band where a sprite would
  //    otherwise wash out across its whole disc — and releases again above ~4,
  //    which is where a genuine hot core lives and where white is correct. That
  //    is the difference between "keeps its colour" and "has been dimmed": the
  //    core is untouched, only the shoulder is re-chromed.
  float pk = max(c.r, max(c.g, c.b));
  if (pk > 1.0) {
    float w = clamp((pk - 1.0) * 0.50, 0.0, 0.72) * (1.0 - smoothstep(4.0, 9.0, pk));
    c = mix(c, c * (c / pk), w);
  }

  gl_FragColor = vec4(c, a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Sprite atlas generation
// ---------------------------------------------------------------------------

/** Bilinear value noise on a hashed integer lattice. */
function vnoise2(x: number, y: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash3(ix, iy, salt);
  const b = hash3(ix + 1, iy, salt);
  const c = hash3(ix, iy + 1, salt);
  const d = hash3(ix + 1, iy + 1, salt);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

/** 4-octave fbm over `vnoise2`. */
function fbm2(x: number, y: number, salt: number): number {
  let s = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < 4; o++) {
    s += amp * vnoise2(x, y, salt + o * 131);
    norm += amp;
    x *= 2.07; y *= 2.03; amp *= 0.5;
  }
  return s / norm;
}

/**
 * Build the 4x4 sprite atlas. Every cell fades to zero alpha at its border so
 * mip generation cannot bleed one sprite into its neighbour.
 *
 * Cell layout (uv origin bottom-left, `flipY` disabled so canvas rows are uv
 * rows). FOUR siblings per family, deliberately different in silhouette, so a
 * burst never reads as one repeated sprite (critique round 1, particles.ts:
 * "eight near-identical white splats"; round 2 brief: "streaks, irregular
 * shards, smoke wisps, embers, with varied rotation, colour temperature and
 * lifetime"):
 *
 *    0 soft glow          1 torn filamented halo   2 pinpoint + skirt   3 lobed flare
 *    4 capsule streak     5 thin needle            6 beaded dash        7 curved comet
 *    8 lit stone chip     9 ember + spike flare   10 long splinter     11 angular chunk
 *   12 billowing puff    13 torn filament wisp    14 sheared veil      15 vortex ring
 *
 * The RGB channel is NOT flat white: it carries per-texel luminance structure
 * (facet shading, density, filaments) which the fragment shader multiplies into
 * the particle colour, so a saturated hot sprite still has internal detail.
 */
function buildAtlas(textures: TextureFactory, rng: Rng): THREE.Texture {
  const H = ATLAS_CELL;
  const NW = ATLAS_COLS * H;
  const NH = ATLAS_ROWS * H;
  const canvas = document.createElement('canvas');
  canvas.width = NW;
  canvas.height = NH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('particles: 2D canvas unavailable');

  const img = ctx.createImageData(NW, NH);
  const px = img.data;
  const salt = rng.int(0, 0xffff);
  const smokeScale = 4.5;

  // Shard silhouettes: convex polygons built from hashed half-planes, plus a
  // fixed "key light" direction so a chip reads as a lit solid, not a decal.
  // Two independent polygons — a many-sided spall flake and a blockier
  // few-sided chunk — so cells 8 and 11 do not share an outline.
  const SHARD_SIDES = 7;
  const shardOff = new Float32Array(SHARD_SIDES);
  const shardAng = new Float32Array(SHARD_SIDES);
  for (let s = 0; s < SHARD_SIDES; s++) {
    shardAng[s] = (s / SHARD_SIDES) * Math.PI * 2 + (hash3(s, 11, salt) - 0.5) * 0.55;
    shardOff[s] = 0.30 + 0.42 * hash3(s, 29, salt);
  }
  const CHUNK_SIDES = 5;
  const chunkOff = new Float32Array(CHUNK_SIDES);
  const chunkAng = new Float32Array(CHUNK_SIDES);
  for (let s = 0; s < CHUNK_SIDES; s++) {
    chunkAng[s] = (s / CHUNK_SIDES) * Math.PI * 2 + (hash3(s, 41, salt) - 0.5) * 0.9;
    chunkOff[s] = 0.34 + 0.46 * hash3(s, 53, salt);
  }
  const keyX = 0.62, keyY = 0.78;

  for (let cell = 0; cell < ATLAS_COLS * ATLAS_ROWS; cell++) {
    const ox = (cell % ATLAS_COLS) * H;
    const oy = Math.floor(cell / ATLAS_COLS) * H;
    for (let j = 0; j < H; j++) {
      // -1..1 cell-local coordinates.
      const v = (j + 0.5) / H * 2 - 1;
      for (let i = 0; i < H; i++) {
        const u = (i + 0.5) / H * 2 - 1;
        const r = Math.sqrt(u * u + v * v);
        let a = 0, lum = 1;

        if (cell === CELL_GLOW) {
          // Gaussian blob, forced to exactly zero at r = 1.
          const g = Math.exp(-r * r * 4.0) - Math.exp(-4.0);
          a = Math.max(0, g) / (1 - Math.exp(-4.0));
          a *= a * 0.85 + a * 0.15;
        } else if (cell === CELL_GLOW + 1) {
          // Hot core inside a TORN halo: the wide lobe is chewed by noise so a
          // flash has an irregular edge and internal filaments instead of being
          // a perfect disc that clips to a white circle.
          const n = fbm2((u + 1) * 3.1, (v + 1) * 3.1, salt + 77);
          const core = Math.exp(-r * r * 30.0);
          const halo = 0.36 * Math.exp(-r * r * 4.2) * (0.35 + 1.15 * n);
          a = Math.min(1, core + halo) * Math.max(0, 1 - Math.pow(r, 5));
          lum = Math.min(1, 0.55 + 0.6 * n + core);
        } else if (cell === CELL_GLOW + 2) {
          // PINPOINT + SKIRT: almost all the energy inside 10% of the radius,
          // then a very wide, very faint skirt. Reads as a distant hot point
          // rather than as a ball of light — the opposite falloff to cell 0, so
          // a burst mixing the two has real size variance for free.
          const dot = Math.exp(-r * r * 130.0);
          const skirt = 0.16 * Math.exp(-r * r * 2.0);
          a = Math.min(1, dot + skirt) * Math.max(0, 1 - Math.pow(r, 6));
          lum = Math.min(1, 0.44 + 1.3 * dot);
        } else if (cell === CELL_GLOW + 3) {
          // LOBED FLARE: a radial mask whose edge is pushed in and out by five
          // azimuthal lobes plus noise, so the silhouette is never a circle.
          const th = Math.atan2(v, u);
          const n = fbm2((u + 1) * 2.3, (v + 1) * 2.3, salt + 191);
          const lobe = 0.62 + 0.20 * Math.sin(th * 5.0 + hash3(2, 7, salt) * 6.28)
                            + 0.24 * n;
          const m = 1 - Math.min(1, r / Math.max(lobe, 0.12));
          a = Math.min(1, Math.pow(Math.max(0, m), 1.5) * 1.25 + Math.exp(-r * r * 40.0));
          lum = Math.min(1, 0.40 + 0.55 * n + Math.exp(-r * r * 40.0));
        } else if (cell === CELL_STREAK) {
          // Capsule along +v with a bright head and a thinning tail. +v is the
          // direction of travel once the vertex shader stretches the quad.
          const halfLen = 0.72, rad = 0.15;
          const vy = Math.max(-halfLen, Math.min(halfLen, v));
          const d = Math.sqrt(u * u + (v - vy) * (v - vy)) / rad;
          const body = Math.exp(-d * d * 2.6);
          const taper = 0.1 + 0.9 * Math.pow(Math.max(0, (v + halfLen) / (2 * halfLen)), 1.6);
          const headD = Math.sqrt(u * u + (v - halfLen * 0.86) * (v - halfLen * 0.86));
          const head = Math.exp(-headD * headD * 160.0);
          a = Math.min(1, body * taper + head);
          lum = Math.min(1, 0.62 + 0.9 * head + 0.25 * body);
        } else if (cell === CELL_STREAK + 1) {
          // NEEDLE: half the width, longer, hotter head, and the tail breaks up
          // into beads so a long spark does not read as a drawn line segment.
          const halfLen = 0.88, rad = 0.062;
          const vy = Math.max(-halfLen, Math.min(halfLen, v));
          const d = Math.sqrt(u * u + (v - vy) * (v - vy)) / rad;
          const t = Math.max(0, (v + halfLen) / (2 * halfLen));
          const beads = 0.72 + 0.28 * Math.sin(t * 22.0 + hash3(0, 5, salt) * 6.28);
          const body = Math.exp(-d * d * 2.1) * Math.pow(t, 1.9) * beads;
          const headD = Math.sqrt(u * u + (v - halfLen * 0.92) * (v - halfLen * 0.92));
          const head = Math.exp(-headD * headD * 300.0);
          a = Math.min(1, body + head);
          lum = Math.min(1, 0.5 + 1.1 * head + 0.3 * body);
        } else if (cell === CELL_STREAK + 2) {
          // BEADED DASH: the streak has broken into three separate dashes with
          // gaps between them. Reads as a spark that is guttering rather than as
          // a continuous line — the single most "not a plume" silhouette here.
          const halfLen = 0.80, rad = 0.085;
          const t = Math.max(0, Math.min(1, (v + halfLen) / (2 * halfLen)));
          const gate = Math.max(0, Math.sin(t * Math.PI * 3.0 - 0.5));
          const vy = Math.max(-halfLen, Math.min(halfLen, v));
          const d = Math.sqrt(u * u + (v - vy) * (v - vy)) / rad;
          const body = Math.exp(-d * d * 2.4) * Math.pow(gate, 0.6) * (0.3 + 0.7 * t);
          const headD = Math.sqrt(u * u + (v - halfLen * 0.9) * (v - halfLen * 0.9));
          const head = Math.exp(-headD * headD * 220.0);
          a = Math.min(1, body + head);
          lum = Math.min(1, 0.55 + 1.0 * head + 0.3 * body);
        } else {
          if (cell === CELL_STREAK + 3) {
            // CURVED COMET: the tail sweeps sideways behind the head, so a burst
            // of these does not draw a family of parallel rules.
            const halfLen = 0.86, rad = 0.075;
            const t = Math.max(0, Math.min(1, (v + halfLen) / (2 * halfLen)));
            const bend = (1 - t) * (1 - t) * 0.42 * (hash3(3, 9, salt) > 0.5 ? 1 : -1);
            const uu = u - bend;
            const vy = Math.max(-halfLen, Math.min(halfLen, v));
            const d = Math.sqrt(uu * uu + (v - vy) * (v - vy)) / (rad * (0.4 + 0.9 * t));
            const body = Math.exp(-d * d * 2.0) * Math.pow(t, 1.1);
            const headD = Math.sqrt(uu * uu + (v - halfLen * 0.9) * (v - halfLen * 0.9));
            const head = Math.exp(-headD * headD * 240.0);
            a = Math.min(1, body + head);
            lum = Math.min(1, 0.50 + 1.1 * head + 0.28 * body);
          } else if (cell === CELL_SHARD) {
            // Irregular convex chip: max over hashed half-planes. Hard edges are
            // the whole point — this is the only non-blurry sprite in the set.
            let m = -1;
            let lit = 0;
            for (let s = 0; s < SHARD_SIDES; s++) {
              const nx = Math.cos(shardAng[s]), ny = Math.sin(shardAng[s]);
              const d = u * nx + v * ny - shardOff[s];
              if (d > m) { m = d; lit = nx * keyX + ny * keyY; }
            }
            // 2-texel soft edge only, so the silhouette stays crisp.
            a = Math.max(0, Math.min(1, -m / 0.035));
            const n = fbm2((u + 1) * 5.0, (v + 1) * 5.0, salt + 13);
            // Facet shading: the face whose outward normal points at the key is
            // bright, the opposite face falls to a dark rim.
            lum = Math.min(1, 0.22 + 0.55 * Math.max(0, lit) + 0.35 * n);
            // Hot rim right on the edge — molten spall.
            const rim = Math.exp(-Math.pow(m / 0.09, 2.0));
            lum = Math.min(1, lum + rim * 0.55);
          } else if (cell === CELL_SHARD + 1) {
            // EMBER: a hard dot with a small anisotropic spike flare.
            const dot = Math.exp(-r * r * 110.0);
            const sx = Math.exp(-u * u * 900.0) * Math.exp(-Math.abs(v) * 5.5) * 0.4;
            const sy = Math.exp(-v * v * 900.0) * Math.exp(-Math.abs(u) * 5.5) * 0.4;
            a = Math.min(1, dot + (sx + sy) * (0.4 + 0.6 * hash3(1, 3, salt)));
            a *= Math.max(0, 1 - Math.pow(r, 4));
            lum = Math.min(1, 0.55 + 1.2 * dot);
          } else if (cell === CELL_SHARD + 2) {
            // SPLINTER: a long narrow shard with chisel ends and a hard bright
            // edge down one side. This is the fragment that reads as torn PLATE.
            const halfW = 0.13, halfL = 0.82;
            const taper = 1 - 0.55 * Math.abs(v) / halfL;
            const inside = Math.abs(u) < halfW * taper && Math.abs(v) < halfL;
            const dEdge = Math.min(halfW * taper - Math.abs(u), halfL - Math.abs(v));
            a = inside ? Math.max(0, Math.min(1, dEdge / 0.02)) : 0;
            const n = fbm2((u + 1) * 6.0, (v + 1) * 3.0, salt + 311);
            // One lit long face, one in shadow: a hard value step across u.
            lum = Math.min(1, (u > 0 ? 0.78 : 0.20) + 0.22 * n);
          } else if (cell === CELL_SHARD + 3) {
            // ANGULAR CHUNK: blockier, fewer sides, more of the cell filled.
            let m = -1;
            let lit = 0;
            for (let s = 0; s < CHUNK_SIDES; s++) {
              const nx = Math.cos(chunkAng[s]), ny = Math.sin(chunkAng[s]);
              const d = u * nx + v * ny - chunkOff[s];
              if (d > m) { m = d; lit = nx * keyX + ny * keyY; }
            }
            a = Math.max(0, Math.min(1, -m / 0.03));
            const n = fbm2((u + 1) * 3.5, (v + 1) * 3.5, salt + 401);
            lum = Math.min(1, 0.16 + 0.62 * Math.max(0, lit) + 0.28 * n);
          } else if (cell === CELL_SMOKE) {
            const n = fbm2((u + 1) * smokeScale, (v + 1) * smokeScale, salt);
            // Warp the radial mask by the noise so the silhouette is ragged.
            const mask = 1 - Math.min(1, r / (0.72 + 0.28 * n));
            a = Math.max(0, mask * (0.25 + 1.05 * n) - 0.05);
            a = Math.min(1, a * 1.35);
            lum = 0.5 + 0.5 * n; // fakes internal density shading
          } else if (cell === CELL_SMOKE + 1) {
            // WISP: a torn filament — narrow across, long along, with holes.
            const n = fbm2((u + 1) * 3.4, (v + 1) * 7.5, salt + 211);
            const across = 1 - Math.min(1, Math.abs(u) / (0.20 + 0.42 * n));
            const along = 1 - Math.min(1, Math.abs(v) / 0.95);
            a = Math.max(0, across * Math.pow(along, 0.7) * (0.15 + 1.25 * n) - 0.08);
            a = Math.min(1, a * 1.3);
            lum = 0.42 + 0.58 * n;
          } else if (cell === CELL_SMOKE + 2) {
            // SHEARED VEIL: very low density, very wide, skewed. This is the cell
            // that supplies the QUIET in a smoke cloud — a field of puffs all at
            // the same density is what makes exhaust read as cotton wool.
            const su = u + v * 0.45;
            const n = fbm2((su + 1) * 2.2, (v + 1) * 5.0, salt + 509);
            const mask = (1 - Math.min(1, Math.abs(su) / 0.92))
                       * (1 - Math.min(1, Math.abs(v) / 0.92));
            a = Math.max(0, Math.pow(mask, 0.8) * (0.05 + 0.70 * n) - 0.04);
            a = Math.min(1, a * 0.9);
            lum = 0.34 + 0.5 * n;
          } else {
            // VORTEX RING: a broken annulus of gas — the silhouette a puff turns
            // into as it entrains and its centre evacuates.
            const n = fbm2((u + 1) * 3.8, (v + 1) * 3.8, salt + 607);
            const ring = Math.exp(-Math.pow((r - 0.56 - 0.14 * n) / 0.26, 2.0));
            a = Math.max(0, ring * (0.2 + 1.0 * n) - 0.05);
            a = Math.min(1, a * 1.2) * Math.max(0, 1 - Math.pow(r, 5));
            lum = 0.40 + 0.55 * n;
          }
        }

        // Hard-kill the last few texels so cells never bleed under mipping.
        const edge = Math.min(1, Math.min(i, j, H - 1 - i, H - 1 - j) / 6);
        a *= edge;

        const o = ((oy + j) * NW + (ox + i)) * 4;
        const c = Math.round(255 * Math.max(0, Math.min(1, lum)));
        px[o] = c;
        px[o + 1] = c;
        px[o + 2] = c;
        px[o + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // Prefer the shared soft sprite from the texture factory so particle falloff
  // matches engine glows and star sprites. Silently keep the procedural blob if
  // the factory hands back something the 2D context cannot draw (e.g. a
  // DataTexture).
  try {
    const soft = textures.soft(H);
    const src = soft.image as CanvasImageSource | undefined;
    if (src && typeof (src as { width?: unknown }).width === 'number') {
      ctx.clearRect(0, 0, H, H);
      ctx.drawImage(src, 0, 0, H, H);
    }
  } catch {
    /* procedural fallback already in place */
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // cell (0,0) stays at uv (0,0)
  tex.colorSpace = THREE.NoColorSpace; // this is a mask, not colour
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Pool — one blend mode's ring buffer, instance attributes and mesh
// ---------------------------------------------------------------------------

class Pool {
  readonly cap: number;
  /** Working limit; `setQuality` may lower this below `cap`. */
  limit: number;

  readonly aP: THREE.InstancedBufferAttribute;
  readonly aV: THREE.InstancedBufferAttribute;
  readonly aCA: THREE.InstancedBufferAttribute;
  readonly aCB: THREE.InstancedBufferAttribute;
  readonly aL: THREE.InstancedBufferAttribute;
  readonly aF: THREE.InstancedBufferAttribute;
  private readonly attrs: THREE.InstancedBufferAttribute[];

  private readonly fP: Float32Array;
  private readonly fV: Float32Array;
  private readonly fCA: Float32Array;
  private readonly fCB: Float32Array;
  private readonly fL: Float32Array;
  private readonly fF: Float32Array;
  /** Absolute time at which each slot dies. */
  private readonly expiry: Float32Array;

  readonly geom: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;

  /** Ring write cursor. */
  private head = 0;
  /** Slots [0, used) are handed to the draw call. Grows on emit, shrinks on sweep. */
  private used = 0;
  /** First slot written this frame, and how many were written. */
  private frameStart = 0;
  private frameCount = 0;

  /** Amortised live-population sweep: cursor, live accumulator, highest live slot. */
  private sweepAt = 0;
  private sweepAcc = 0;
  private sweepMax = 0;
  /** Highest slot written since the current sweep pass began (see `flush`). */
  private writeHigh = 0;
  /** Published live count from the last completed sweep. */
  live = 0;

  constructor(cap: number, material: THREE.ShaderMaterial, renderOrder: number, name: string) {
    this.cap = Math.max(1, cap | 0);
    this.limit = this.cap;

    this.fP = new Float32Array(this.cap * V4);
    this.fV = new Float32Array(this.cap * V4);
    this.fCA = new Float32Array(this.cap * V4);
    this.fCB = new Float32Array(this.cap * V4);
    this.fL = new Float32Array(this.cap * V4);
    this.fF = new Float32Array(this.cap * V4);
    this.expiry = new Float32Array(this.cap);

    const mk = (arr: Float32Array): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, V4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aP = mk(this.fP);
    this.aV = mk(this.fV);
    this.aCA = mk(this.fCA);
    this.aCB = mk(this.fCB);
    this.aL = mk(this.fL);
    this.aF = mk(this.fF);
    this.attrs = [this.aP, this.aV, this.aCA, this.aCB, this.aL, this.aF];

    // A unit quad centred on the origin; the vertex shader supplies the basis.
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aP', this.aP);
    g.setAttribute('aV', this.aV);
    g.setAttribute('aCA', this.aCA);
    g.setAttribute('aCB', this.aCB);
    g.setAttribute('aL', this.aL);
    g.setAttribute('aF', this.aF);
    g.instanceCount = 0;
    // Particles are scattered across the whole battlespace; never cull the draw.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.geom = g;

    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    this.mesh = mesh;
  }

  /**
   * Claim the next ring slot and write the packed instance data.
   * `k` is the pre-solved drag rate, `now` the current time base.
   */
  write(now: number, k: number): void {
    const lim = this.limit;
    if (lim <= 0) return;
    // `limit` can shrink under us when quality drops; keep the cursor in range.
    const s = this.head >= lim ? 0 : this.head;
    this.head = s + 1 >= lim ? 0 : s + 1;
    if (this.frameCount === 0) this.frameStart = s;
    this.frameCount++;
    if (s >= this.used) this.used = s + 1;
    if (s >= this.writeHigh) this.writeHigh = s + 1;

    const life = P.life > 1e-4 ? P.life : 1e-4;
    this.expiry[s] = now + life;

    const o = s * V4;
    const fP = this.fP, fV = this.fV, fCA = this.fCA, fCB = this.fCB, fL = this.fL, fF = this.fF;
    fP[o] = P.x; fP[o + 1] = P.y; fP[o + 2] = P.z; fP[o + 3] = P.size;
    fV[o] = P.vx; fV[o + 1] = P.vy; fV[o + 2] = P.vz; fV[o + 3] = k;
    fCA[o] = P.r; fCA[o + 1] = P.g; fCA[o + 2] = P.b; fCA[o + 3] = P.alpha;
    fCB[o] = P.rEnd; fCB[o + 1] = P.gEnd; fCB[o + 2] = P.bEnd; fCB[o + 3] = P.alphaEnd;
    fL[o] = now; fL[o + 1] = 1 / life; fL[o + 2] = P.sizeEnd; fL[o + 3] = P.spin;
    fF[o] = P.kind; fF[o + 1] = P.stretch; fF[o + 2] = P.turbulence;
    fF[o + 3] = hash3(s, _seedTick++, 0x51ed); // stable per-particle 0..1 shader seed
  }

  /** Upload the slots touched this frame and refresh the draw range. */
  flush(now: number): void {
    const n = this.frameCount;
    if (n > 0) {
      const lim = this.limit;
      const start = this.frameStart;
      const count = Math.min(n, lim);
      const tail = Math.max(0, Math.min(count, lim - start));
      const wrap = count - tail;
      for (let i = 0; i < this.attrs.length; i++) {
        const a = this.attrs[i];
        a.addUpdateRange(start * V4, tail * V4);
        if (wrap > 0) a.addUpdateRange(0, wrap * V4);
        a.needsUpdate = true;
      }
      this.frameCount = 0;
    }

    // Amortised recount, SWEEP_SLICE slots per frame. This does double duty: it
    // publishes `live` for the debug HUD and it finds the highest slot still
    // holding a live particle, which lets the draw range collapse again once a
    // huge burst has died instead of sitting at its high-water mark forever.
    // `writeHigh` guards the slots emitted into *behind* the sweep cursor during
    // the pass, which the sweep would otherwise have already skipped.
    const end = Math.min(this.used, this.sweepAt + SWEEP_SLICE);
    for (let i = this.sweepAt; i < end; i++) {
      if (this.expiry[i] > now) {
        this.sweepAcc++;
        this.sweepMax = i + 1;
      }
    }
    this.sweepAt = end;
    if (this.sweepAt >= this.used) {
      this.live = this.sweepAcc;
      this.used = Math.max(this.sweepMax, this.writeHigh);
      if (this.used === 0) this.head = 0;
      this.sweepAcc = 0;
      this.sweepMax = 0;
      this.sweepAt = 0;
      this.writeHigh = 0;
    }

    this.geom.instanceCount = this.used;
  }

  /** Kill every particle immediately. */
  clear(): void {
    this.expiry.fill(-1);
    this.fL.fill(0);
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true;
    this.head = 0;
    this.used = 0;
    this.frameCount = 0;
    this.sweepAt = 0;
    this.sweepAcc = 0;
    this.sweepMax = 0;
    this.writeHigh = 0;
    this.live = 0;
    this.geom.instanceCount = 0;
  }

  dispose(): void {
    this.geom.dispose();
  }
}

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing in the hot path allocates.
// ---------------------------------------------------------------------------

const _dir = { x: 0, y: 0, z: 0 };
const _res = new THREE.Vector2();
/** Monotonic counter feeding the per-particle shader seed (no `Math.random`). */
let _seedTick = 0;
/** Aim axis + its orthonormal complement, rebuilt once per `burst`. */
let _ax = 0, _ay = 0, _az = 0;
let _t1x = 0, _t1y = 0, _t1z = 0;
let _t2x = 0, _t2y = 0, _t2z = 0;

/**
 * Colour-temperature multiplier for a particle, written into `_tmp`.
 *
 * `t` runs -1 (cool: a dull deep-red ember) .. +1 (hot: a blue-white spark).
 * The curve is a cheap Planckian stand-in — red gains as it cools, blue and
 * green gain as it heats — and it is applied to BOTH the birth and death
 * colours so a burst spans a real temperature range instead of every particle
 * being born and dying at the same white (critique round 1, particles.ts).
 */
const _tmp = { r: 1, g: 1, b: 1 };
function tempTint(t: number): void {
  _tmp.r = 1 - 0.20 * t;
  _tmp.g = 1 + 0.13 * t - 0.06 * t * t;
  _tmp.b = 1 + 0.85 * t + 0.20 * t * t;
  if (_tmp.b < 0.05) _tmp.b = 0.05;
  if (_tmp.g < 0.15) _tmp.g = 0.15;
}

/** Build an orthonormal basis around the unit axis (ax, ay, az). */
function basisFromAxis(ax: number, ay: number, az: number): void {
  _ax = ax; _ay = ay; _az = az;
  // Pick the world axis least aligned with the aim to avoid a degenerate cross.
  const sx = Math.abs(ax), sy = Math.abs(ay), sz = Math.abs(az);
  let ux = 0, uy = 0, uz = 1;
  if (sz <= sx && sz <= sy) { ux = 0; uy = 0; uz = 1; }
  else if (sy <= sx) { ux = 0; uy = 1; uz = 0; }
  else { ux = 1; uy = 0; uz = 0; }
  let cx = ay * uz - az * uy;
  let cy = az * ux - ax * uz;
  let cz = ax * uy - ay * ux;
  const cl = Math.hypot(cx, cy, cz) || 1;
  cx /= cl; cy /= cl; cz /= cl;
  _t1x = cx; _t1y = cy; _t1z = cz;
  _t2x = ay * cz - az * cy;
  _t2y = az * cx - ax * cz;
  _t2z = ax * cy - ay * cx;
}

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

/**
 * The one and only particle renderer. Two draw calls (alpha then additive) for
 * the entire game.
 *
 * ```ts
 * P.x = hx; P.y = hy; P.z = hz;
 * P.vx = nx * 40; P.vy = ny * 40; P.vz = nz * 40;
 * P.size = 0.3; P.sizeEnd = 0.02; P.life = 0.5; ...
 * particles.emit();
 * ```
 * or, for anything that has a preset:
 * ```ts
 * P.vx = nx; P.vy = ny; P.vz = nz;             // aim axis for cone/disc presets
 * particles.burst(hx, hy, hz, 24, 'spark', 1.4);
 * ```
 */
export class ParticleSystem implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.ShaderMaterial;
  private readonly materialAlpha: THREE.ShaderMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly atlas: THREE.Texture;
  private readonly placeholder: THREE.DataTexture;
  private readonly add: Pool;
  private readonly alp: Pool;
  private readonly rng = new Rng(0x5f4a11);

  /** Time base shared by emission and the shader, seconds. */
  private now = 0;
  private quality: QualitySettings;

  /**
   * @param scene    where the two particle meshes are parented
   * @param textures shared procedural texture factory (soft sprite + fire sheet)
   * @param quality  `maxParticles` is the hard capacity allocated here
   */
  constructor(scene: THREE.Scene, textures: TextureFactory, quality: QualitySettings) {
    this.scene = scene;
    this.quality = quality;

    this.atlas = buildAtlas(textures, this.rng);

    let fire: THREE.Texture | null = null;
    try {
      fire = textures.fireSheet(FIRE_SHEET_DIM, FIRE_SHEET_PX);
    } catch {
      fire = null;
    }

    this.placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.placeholder.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0 },
      // Seconds of travel a stretch = 1 streak spans. Raised from 0.012: a
      // spark must read as a STREAK, not a disc (critique round 1).
      uStreakTime: { value: 0.022 },
      uTurbFreq: { value: 0.35 },
      uTurbAmp: { value: 2.5 },
      uAtlas: { value: this.atlas },
      uFire: { value: fire ?? this.placeholder },
      uDepth: { value: this.placeholder as THREE.Texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNearFar: { value: new THREE.Vector2(1, 1e6) },
      uHasDepth: { value: 0 },
      uHasFire: { value: fire ? 1 : 0 },
      uSoftness: { value: 1.6 },
      uFadeIn: { value: 0.05 },
    };

    // Both materials share the uniform objects, so `uTime` is written once.
    const base: THREE.ShaderMaterialParameters = {
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    };
    this.materialAlpha = new THREE.ShaderMaterial({ ...base, blending: THREE.NormalBlending });
    this.materialAlpha.name = 'fx.particles.alpha';
    this.material = new THREE.ShaderMaterial({ ...base, blending: THREE.AdditiveBlending });
    this.material.name = 'fx.particles.add';

    const cap = Math.max(256, quality.maxParticles | 0);
    const addCap = Math.round(cap * ADDITIVE_SHARE);
    this.add = new Pool(addCap, this.material, 21, 'fx.particles.add');
    this.alp = new Pool(cap - addCap, this.materialAlpha, 20, 'fx.particles.alpha');

    scene.add(this.alp.mesh);
    scene.add(this.add.mesh);
  }

  /** Live particle count across both pools (debug HUD). Updated amortised. */
  get live(): number {
    return this.add.live + this.alp.live;
  }

  /** Total slot capacity across both pools. */
  get capacity(): number {
    return this.add.limit + this.alp.limit;
  }

  /**
   * Supply the scene depth attachment so sprites dissolve into geometry instead
   * of slicing through it. Pass `null` to disable soft particles.
   */
  setDepthTexture(t: THREE.Texture | null): void {
    this.uniforms.uDepth.value = t ?? this.placeholder;
    this.uniforms.uHasDepth.value = t ? 1 : 0;
  }

  /** Emit one particle described by the shared scratch record `P`. */
  emit(): void {
    // drag is "fraction of speed lost per second", so the exponential rate that
    // reproduces it is k = -ln(1 - drag). Solved once here, never in the shader.
    const d = P.drag <= 0 ? 0 : P.drag >= 0.999 ? 0.999 : P.drag;
    const k = d <= 1e-4 ? 0 : -Math.log(1 - d);
    (P.additive ? this.add : this.alp).write(this.now, k);
  }

  /**
   * Emit a preset distribution of `count` particles centred on (x, y, z).
   *
   * `scale` is the event radius in metres: sizes scale linearly with it while
   * speeds (^0.75) and lifetimes (^0.35) scale sub-linearly, so a mothership
   * detonation reads as a slow, vast bloom rather than a scaled-up firecracker.
   *
   * Directional presets (`muzzle`, `vent`, `shieldSpray`, `shockdust`) take
   * their aim axis from the current contents of `P.vx/P.vy/P.vz`; it need not be
   * normalised, and a zero-length axis falls back to +Y. `burst` overwrites the
   * whole of `P`, so set the axis immediately before each call.
   *
   * `r`,`g`,`b` optionally retint the burst: the preset's HDR brightness ramp is
   * preserved and only the chroma is replaced, so team colours stay legible
   * without dimming the bloom.
   */
  burst(
    x: number, y: number, z: number,
    count: number, preset: string, scale: number,
    r?: number, g?: number, b?: number,
  ): void {
    const pr = PRESETS[preset];
    if (!pr || count <= 0) return;

    const s = scale > 1e-4 ? scale : 1;
    const sizeK = s;
    const spdK = Math.pow(s, 0.75);
    const lifeK = Math.pow(s, 0.35);

    // Aim axis from the caller's velocity hint.
    const axl = Math.hypot(P.vx, P.vy, P.vz);
    if (axl < 1e-6) basisFromAxis(0, 1, 0);
    else basisFromAxis(P.vx / axl, P.vy / axl, P.vz / axl);

    // Chroma retint: keep the preset's intensity, take the caller's hue.
    let cr = pr.r, cg = pr.g, cb = pr.b;
    let er = pr.rEnd, eg = pr.gEnd, eb = pr.bEnd;
    if (r !== undefined && g !== undefined && b !== undefined) {
      const m = Math.max(r, g, b, 1e-4);
      const nr = r / m, ng = g / m, nb = b / m;
      cr = nr * pr.iStart; cg = ng * pr.iStart; cb = nb * pr.iStart;
      er = nr * pr.iEnd; eg = ng * pr.iEnd; eb = nb * pr.iEnd;
    }

    const rng = this.rng;
    P.kind = pr.kind;
    P.additive = pr.additive;
    P.stretch = pr.stretch;
    P.turbulence = pr.turbulence;
    P.rEnd = er; P.gEnd = eg; P.bEnd = eb;
    P.alpha = pr.alpha;
    P.alphaEnd = pr.alphaEnd;
    P.drag = 1 - Math.exp(-pr.drag);
    const coneCos = Math.cos(pr.cone);

    for (let i = 0; i < count; i++) {
      // -- direction -----------------------------------------------------
      let dx: number, dy: number, dz: number;
      if (pr.shape === SHAPE_SPHERE) {
        rng.onSphere(_dir);
        dx = _dir.x; dy = _dir.y; dz = _dir.z;
      } else if (pr.shape === SHAPE_CONE) {
        // Uniform solid-angle sampling inside the cone half-angle.
        const ct = 1 - rng.next() * (1 - coneCos);
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = rng.next() * Math.PI * 2;
        const cp = Math.cos(ph), sp = Math.sin(ph);
        dx = _ax * ct + (_t1x * cp + _t2x * sp) * st;
        dy = _ay * ct + (_t1y * cp + _t2y * sp) * st;
        dz = _az * ct + (_t1z * cp + _t2z * sp) * st;
      } else {
        // Disc: in the plane normal to the axis, with a little out-of-plane lift.
        const ph = rng.next() * Math.PI * 2;
        const cp = Math.cos(ph), sp = Math.sin(ph);
        const lift = rng.sign() * 0.16;
        dx = _t1x * cp + _t2x * sp + _ax * lift;
        dy = _t1y * cp + _t2y * sp + _ay * lift;
        dz = _t1z * cp + _t2z * sp + _az * lift;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }

      const spd = rng.range(pr.spdMin, pr.spdMax) * spdK;
      const jit = 1 + rng.sign() * pr.jitter;
      const scat = pr.scatter * s * rng.next();

      // -- per-particle colour temperature. Hotter particles are also shorter
      //    lived and slightly smaller, which is how a real spark shower reads:
      //    a few blue-white needles out front, a long tail of dull red embers.
      let tk = 1;
      if (pr.temp > 0) {
        const t = rng.sign() * pr.temp;
        tempTint(t);
        P.r = cr * _tmp.r; P.g = cg * _tmp.g; P.b = cb * _tmp.b;
        P.rEnd = er * _tmp.r; P.gEnd = eg * _tmp.g; P.bEnd = eb * _tmp.b;
        tk = 1 - t * 0.22;
      } else {
        P.r = cr; P.g = cg; P.b = cb;
        P.rEnd = er; P.gEnd = eg; P.bEnd = eb;
      }

      P.x = x + dx * scat;
      P.y = y + dy * scat;
      P.z = z + dz * scat;
      P.vx = dx * spd;
      P.vy = dy * spd;
      P.vz = dz * spd;
      P.size = pr.sizeA * sizeK * jit;
      P.sizeEnd = pr.sizeB * sizeK * jit;
      P.life = rng.range(pr.lifeMin, pr.lifeMax) * lifeK * tk;
      // Random |spin| as well as random sign: a burst of shards must not tumble
      // in lockstep. The shader already offsets start rotation by the seed.
      P.spin = pr.spin > 0 ? rng.sign() * pr.spin * (0.35 + rng.next()) : 0;
      this.emit();
    }
  }

  /** Per-frame: refresh uniforms, upload the freshly emitted slots. */
  update(ctx: RenderContext, _world: World): void {
    this.now = ctx.time;
    this.uniforms.uTime.value = ctx.time;

    ctx.renderer.getDrawingBufferSize(_res);
    (this.uniforms.uResolution.value as THREE.Vector2).set(
      Math.max(1, _res.x), Math.max(1, _res.y),
    );
    (this.uniforms.uNearFar.value as THREE.Vector2).set(ctx.camera.near, ctx.camera.far);

    this.add.flush(ctx.time);
    this.alp.flush(ctx.time);
  }

  /**
   * Lower (or restore) the working budget. The capacity allocated at
   * construction is the ceiling — a preset asking for more particles than the
   * system was built with is clamped, not reallocated.
   */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    const cap = Math.max(256, q.maxParticles | 0);
    this.add.limit = Math.min(this.add.cap, Math.round(cap * ADDITIVE_SHARE));
    this.alp.limit = Math.min(this.alp.cap, cap - Math.round(cap * ADDITIVE_SHARE));
  }

  /** Kill every live particle (scene reset, mission restart). */
  clear(): void {
    this.add.clear();
    this.alp.clear();
  }

  dispose(): void {
    this.scene.remove(this.add.mesh);
    this.scene.remove(this.alp.mesh);
    this.add.dispose();
    this.alp.dispose();
    this.material.dispose();
    this.materialAlpha.dispose();
    this.atlas.dispose();
    this.placeholder.dispose();
    // `uFire` belongs to the TextureFactory; it disposes its own textures.
  }
}
