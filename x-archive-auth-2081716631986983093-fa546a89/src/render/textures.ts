/**
 * PROCEDURAL TEXTURE FOUNDRY.
 *
 * Starfall ships zero image files. Every texel in the game — the hull plating,
 * the explosion sprite sheet, the star points, the blue-noise dither tile — is
 * generated here at load time. That buys three things: a tiny download, a look
 * that is coherent because one art direction generated all of it, and the
 * ability to re-bake at a different resolution per quality preset.
 *
 * ---------------------------------------------------------------------------
 * HOW THE HULL SET IS BUILT
 * ---------------------------------------------------------------------------
 * The hull maps are baked ON THE GPU: a fullscreen quad is drawn through an
 * orthographic camera into a `WebGLRenderTarget`, and we keep the target's
 * `.texture`. Nothing is ever read back to the CPU, so there is no pipeline
 * stall and a 2048² bake costs a few milliseconds instead of a few seconds.
 *
 * The three hull maps come out of ONE shader source compiled three times with a
 * different `SF_PASS` define, so the panel layout, the height field and the
 * wear masks are guaranteed to agree texel-for-texel between the detail, normal
 * and surface maps. Baking three passes rather than using MRT costs two extra
 * evaluations of a cheap load-time shader and keeps the code (and the driver
 * requirements) simple.
 *
 * The layout itself is a recursive binary subdivision of the tile into plates.
 * The subtle part is SEAMLESSNESS: the first level cuts the tile TWICE per axis
 * and treats the result as a torus, so one macro cell always straddles the tile
 * border. That is what stops every tile from showing the same hard cross at its
 * edge — plates genuinely wrap, and the recursion below the first level is
 * ordinary interval subdivision in wrapped local coordinates.
 *
 * The normal map is a central difference of the same height field, evaluated
 * with the same code path, so bevels, weld beads and rivet domes in the normal
 * land exactly on the panel lines and bolts in the detail map.
 *
 * ---------------------------------------------------------------------------
 * COLOUR SPACE POLICY
 * ---------------------------------------------------------------------------
 * three drives colour management through the texture's INTERNAL FORMAT, not
 * through a shader-side decode, and that means the two directions differ:
 *
 *   - Render targets created with `colorSpace: SRGBColorSpace` allocate an
 *     SRGB8_ALPHA8 attachment. The GPU encodes on write and decodes on read, so
 *     the bake shader must emit LINEAR colour.
 *   - `DataTexture` with `colorSpace: SRGBColorSpace` is storage we fill
 *     ourselves, exactly like a PNG, so those bytes must be sRGB-ENCODED.
 *
 * Everything that is data rather than colour (all three hull maps, the sprite
 * masks, the blue-noise tile) is `NoColorSpace` and passes through untouched.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATOR NOTES
 * ---------------------------------------------------------------------------
 *   - `createTextures(renderer)` is memoised: every caller shares one factory
 *     and therefore one set of GPU textures. `hull()` called twice returns the
 *     same object identities, so hull materials never duplicate uploads.
 *   - Nobody but this module may dispose these textures. Consumers that hold a
 *     reference (particles, backdrop, asteroids, hull material) must leave them
 *     alone; `ProceduralTextures.dispose()` owns their lifetime.
 *   - The bake saves and restores the renderer's render target, clear colour,
 *     clear alpha and `autoClear`. It touches nothing else — no tone mapping,
 *     no output colour space — because the bake materials are raw
 *     `ShaderMaterial`s that emit `gl_FragColor` verbatim.
 *   - `hull().tileMetres` is the world size of one tile of the coarse plate
 *     layer. `hullMaterial` derives its fine (rivet) layer from it, so changing
 *     `HULL_TILE_METRES` rescales both layers coherently.
 *
 * ---------------------------------------------------------------------------
 * THE THREE DETAIL TIERS  (critique round 1, "surface", blocker)
 * ---------------------------------------------------------------------------
 * The review found the detail hierarchy topping out at 6 m: on a 2.1 km hull
 * framed to fill the screen the plate tile is 1/350th of the ship, so it mips
 * and footprint-fades to nothing and the hull collapses to flat albedo plus
 * dither ("diagonal burlap weave"). NOTHING was authored between 6 m and the
 * whole ship. There are now three tiers, and every hull pixel is covered by at
 * least one of them at every distance:
 *
 *   MACRO   ~48 m   `macro` + `macroNormal`. Structural bay seams, armour-belt
 *                   slabs, big raised deck plates, recessed service trenches
 *                   with transverse frames. NEVER footprint-faded — this tier
 *                   is what carries a capital at hero framing AND at fleet
 *                   range, and it is the tier the eye counts to judge length.
 *   COARSE  6 m     `detail` + `surface` + `normal`. Hull plating, hatches,
 *                   vents, grime. Faded out once one pixel covers a plate.
 *   FINE    0.96 m  the same maps re-tiled. Rivets and weld beads. Faded out
 *                   first; a close-up luxury only.
 */

import * as THREE from 'three';
import {
  GLSL_NOISE,
  GLSL_UTIL,
  type HullTextureSet,
  type TextureFactory,
} from '../core/contracts';
import { Rng, hashSeed } from '../core/rng';
import type { QualitySettings } from '../core/types';

// ---------------------------------------------------------------------------
// Art direction constants
// ---------------------------------------------------------------------------

/**
 * World size of one tile of the coarse plate layer, in metres. Plates inside a
 * tile range from ~0.35 m to ~2.5 m across, which is the band that reads as
 * "spacecraft" rather than "shipping container" (too big) or "chainmail" (too
 * small) on hulls from a 12 m interceptor to a 600 m mothership.
 */
const HULL_TILE_METRES = 6.0;

/**
 * World size of one tile of the MACRO structural layer, in metres.
 *
 * 48 m puts the smallest macro feature (a 5 m armour block, a 2.7 m service
 * trench) at roughly 1/400th of a Mothership and 1/60th of a Destroyer, which
 * is the band a Homeworld capital reads in: you can count trenches and frames
 * down the length of the hull and get an honest sense of kilometres. Below
 * ~30 m the tier stops doing distance work; above ~70 m a frigate only sees
 * one block and goes flat again.
 */
const MACRO_TILE_METRES = 48.0;

/**
 * MEAN of the baked surface-map roughness channel (`surface.r`).
 *
 * CRITIQUE ROUND 2 (lighting/surface, blocker, raised by two reviewers):
 * *"widen the plate roughness spread ... and bias the surface bake's roughness
 * channel mean from 0.55 down to 0.35 in textures.ts so most plate is
 * semi-gloss"*. The bake used to be centred on 0.5 because `hullMaterial`
 * read the channel as a signed offset around a hard-coded 0.5 and would
 * otherwise silently change every hull's finish.
 *
 * The mean is now a DOCUMENTED CONSTANT ON BOTH SIDES instead — this value
 * MUST equal `SURFACE_ROUGH_MEAN` in `src/render/hullMaterial.ts` — which
 * frees the bake to carry a real gloss bias while the shader still reads a
 * clean signed offset. 0.38 rather than the requested 0.35 because the base
 * roughness came down to 0.30 at the same time (a hull cannot be biased twice
 * for the same reason without arriving at a mirror), and because grooves,
 * vents and grime push the realised mean back up by ~0.03.
 */
export const SURFACE_ROUGH_MEAN = 0.38;

/** Baked hull map resolution per quality preset (0 = low .. 3 = ultra). */
const HULL_SIZE_BY_PRESET: readonly number[] = [1024, 2048, 2048, 2048];

/**
 * Macro map resolution. The tier's smallest feature is a 0.26 m seam, so at
 * 1024² over a 48 m tile (47 mm/texel) a seam is still five texels wide —
 * half the plate map's resolution is genuinely enough here, and it halves both
 * the bake cost and the resident VRAM of the new tier.
 */
const MACRO_SIZE_BY_PRESET: readonly number[] = [512, 1024, 1024, 1024];

/** Deterministic seeds — the universe must be reproducible from a seed alone. */
const SEED_HULL = hashSeed('starfall.hull.plating');
const SEED_MACRO = hashSeed('starfall.hull.macro');
const SEED_FIRE = hashSeed('starfall.fx.fireball');
const SEED_NOISE = hashSeed('starfall.fx.bluenoise');

/** Default sprite sizes. Callers may override; results are cached per size. */
const SOFT_DEFAULT = 256;
const STAR_DEFAULT = 128;
const NOISE_DEFAULT = 64;
/**
 * Void-and-cluster is O(n⁴) in the tile edge; 128² already costs ~0.4 s of main
 * thread. Anything larger is clamped — consumers read the real size back off
 * `texture.image.width`, so clamping is safe rather than silently wrong.
 */
const NOISE_MAX = 128;

/** Fire sheet defaults. `particles.ts` asks for exactly (8, 1024). */
const FIRE_FRAMES_DEFAULT = 8;
const FIRE_SIZE_DEFAULT = 1024;

/** Plume ramp resolution. 1D lookup, so one row is enough. */
const PLUME_SIZE = 256;

/** Fallback quality if the caller does not supply one (matches the ultra tier). */
const DEFAULT_QUALITY: QualitySettings = {
  preset: 3,
  shadows: true,
  shadowResolution: 2048,
  bloom: true,
  motionBlur: false,
  volumetrics: true,
  ssao: true,
  antialias: 'taa',
  maxParticles: 24000,
  pixelRatio: 1,
  lodBias: 1,
};

// ---------------------------------------------------------------------------
// GLSL — shared vertex stage for every bake
// ---------------------------------------------------------------------------

/**
 * Fullscreen quad. The geometry is a 2x2 plane at z = 0 and the camera is a
 * unit orthographic box, so this is a plain MVP transform — no clip-space
 * trickery that would break if the bake ever needed a real camera.
 */
const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ---------------------------------------------------------------------------
// GLSL — tiling noise built on the shared hashes
// ---------------------------------------------------------------------------

/**
 * Periodic gradient noise and fbm. The lattice maths is the same as `sf_noise`
 * in GLSL_NOISE and the hash is literally `sf_hash33`; the only change is that
 * cell indices are wrapped on `per`, which makes the field exactly periodic on
 * the unit tile. Every noise used by the hull bake goes through here, because a
 * single non-tiling octave anywhere would break the seam.
 *
 * `per` is PER AXIS and must equal the frequency the caller scaled `p` by, and
 * must be a whole number of cells. Anisotropic fields (the grime streaks, which
 * are stretched ten to one) therefore need a vec2 period — a scalar period on a
 * stretched field wraps on one axis and tears on the other.
 */
const GLSL_TILE_NOISE = /* glsl */ `
float sf_tnoise(vec2 p, vec2 per, float sd) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, per);
  vec2 b = mod(i + 1.0, per);
  float n00 = dot(sf_hash33(vec3(a.x, a.y, sd)).xy, f - vec2(0.0, 0.0));
  float n10 = dot(sf_hash33(vec3(b.x, a.y, sd)).xy, f - vec2(1.0, 0.0));
  float n01 = dot(sf_hash33(vec3(a.x, b.y, sd)).xy, f - vec2(0.0, 1.0));
  float n11 = dot(sf_hash33(vec3(b.x, b.y, sd)).xy, f - vec2(1.0, 1.0));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 0.72 + 0.5;
}

float sf_tfbm(vec2 p, vec2 per, int oct, float sd) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * sf_tnoise(p, per, sd + float(i) * 19.73);
    n += a;
    p *= 2.0;      // frequency and period double together, so periodicity holds
    per *= 2.0;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
`;

// ---------------------------------------------------------------------------
// GLSL — the hull bake
// ---------------------------------------------------------------------------

/**
 * The hull surface generator.
 *
 * Compiled three times with `SF_PASS` = 0 (detail RGBA), 1 (tangent-space
 * normal) or 2 (surface RGBA). All three share `sfPlate` / `sfHeight`, so the
 * maps cannot drift apart.
 *
 * UNITS. Everything spatial is expressed in TILE UNITS (1.0 = one full tile =
 * `uTileM` metres). `uMM` converts millimetres into tile units, which lets the
 * constants below be written as real engineering dimensions — a 5 mm panel gap,
 * a 9 mm bolt head — and stay physically consistent if the tile size or the
 * bake resolution changes.
 */
const HULL_FRAG = /* glsl */ `
uniform float uRes;    // texels along one edge of the baked tile
uniform float uTileM;  // metres covered by one tile
uniform float uMM;     // one millimetre, expressed in tile units
uniform float uSeed;

varying vec2 vUv;

${GLSL_NOISE}
${GLSL_UTIL}
${GLSL_TILE_NOISE}

/** Centre of the baked roughness distribution. Interpolated from the exported
 *  TS constant, and read back by hullMaterial.ts from the same constant. */
const float SF_ROUGH_MEAN = ${SURFACE_ROUGH_MEAN.toFixed(4)};

const float SF_PI2 = 6.28318530718;
/** Max recursive splits below the macro cell. 7 gives ~1:8 plate size spread. */
const int   SF_DEPTH = 7;
/** Smallest permitted plate edge, tile units (0.055 * 6 m = 33 cm). */
const float SF_MIN_PLATE = 0.055;

// --- engineering dimensions, millimetres -----------------------------------
// These are deliberately at the coarse end of plausible: a 22 mm panel gap is
// wide for an aircraft and normal for a pressure-hull segment, and it is what
// keeps the plating readable at fleet zoom instead of dissolving into the mip
// chain. Everything scales together, so the surface stays self-consistent.
const float MM_GROOVE_MAJ  = 11.0;  // half-width of a structural seam
const float MM_GROOVE_MIN  = 4.5;   // half-width of a hairline plate joint
const float MM_CHAMFER     = 11.0;  // bevel run at the lip of a groove
const float MM_GROOVE_DEEP = 9.0;   // groove depth
const float MM_PLATE_STEP  = 3.0;   // peak-to-peak plate-to-plate level change
const float MM_WARP        = 2.6;   // oil-canning across a plate
const float MM_WELD        = 2.2;   // weld bead height
const float MM_WELD_W      = 11.0;  // weld bead half-width
const float MM_RIVET_R     = 12.0;  // bolt head radius
const float MM_RIVET_H     = 3.4;   // bolt head height
const float MM_RIVET_INSET = 36.0;  // bolt row inset from the plate edge
const float MM_RIVET_PITCH = 92.0;  // nominal bolt spacing
const float MM_HATCH_LIP   = 2.6;   // raised hatch lid
const float MM_SLAT        = 6.0;   // vent louvre depth

// --- scale constants, resolved once per fragment from the uniforms ----------
float gTx;          // one texel, tile units
float gGrooveMaj;
float gGrooveMin;
float gChamfer;

// --- plate state, written by sfPlate ---------------------------------------
vec2  gQ;     // 0..1 position inside the plate
vec2  gS;     // plate size, tile units
vec4  gLvl;   // subdivision level of the (-x, +x, -y, +y) edges
vec4  gE;     // ABSOLUTE tile coordinate of those four edges
float gId;    // stable per-plate hash
float gMac;   // per-macro-cell hash
float gBusy;  // 0..1 DETAIL BUDGET for this plate: 0 = quiet armour, 1 = machinery

// --- surface state, written by sfHeight ------------------------------------
float gGroove;  // panel-line mask, 0 on the plate, 1 in the gap
float gRivet;   // bolt / fastener mask
float gWeld;    // weld bead mask
float gEdgeD;   // distance to the nearest plate edge, tile units
float gVent;    // inside a louvred vent
float gHatch;   // inside a maintenance hatch lid
float gPlateH;  // the plate's own base level (no local features)

/** Rounded-box signed distance, used for hatches, vents and registry blocks. */
float sfSdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/** Capsule signed distance — one stroke of a stencilled glyph. */
float sfSdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/**
 * Resolve which plate the coordinate uv belongs to.
 *
 * LEVEL 0 — the seamless trick. Cutting the unit tile once per axis would put a
 * plate boundary on the tile border, and every tile would then show the same
 * full-length cross. Instead we cut TWICE per axis and read the result as a
 * torus: the interval between the two cuts is one macro cell, the interval that
 * wraps through the border is the other. Nothing is special about the border
 * any more, and plates genuinely straddle it.
 *
 * LEVELS 1..N — ordinary binary subdivision inside the macro cell, in local
 * coordinates, so wrapping never has to be thought about again. The split axis
 * follows the ABSOLUTE aspect ratio (so plates stay roughly rectangular rather
 * than degenerating into ribbons), the split ratio is hashed, and a stochastic
 * early stop leaves a mix of large panels and dense small plating.
 *
 * Every hash is keyed on the current rectangle, which is bitwise identical for
 * every fragment inside it, so the layout is stable and hard-edged.
 */
void sfPlate(vec2 uv) {
  float ax0 = 0.05 + 0.34 * sf_hash11(uSeed + 1.73);
  float ax1 = 0.55 + 0.36 * sf_hash11(uSeed + 5.31);
  float ay0 = 0.07 + 0.32 * sf_hash11(uSeed + 9.17);
  float ay1 = 0.57 + 0.34 * sf_hash11(uSeed + 13.77);

  vec2 mo, ms;
  if (uv.x >= ax0 && uv.x < ax1) { mo.x = ax0; ms.x = ax1 - ax0; }
  else                           { mo.x = ax1; ms.x = 1.0 - (ax1 - ax0); }
  if (uv.y >= ay0 && uv.y < ay1) { mo.y = ay0; ms.y = ay1 - ay0; }
  else                           { mo.y = ay1; ms.y = 1.0 - (ay1 - ay0); }

  // fract() does the wrap for the cell that crosses the tile border, and also
  // absorbs the out-of-range taps the normal pass makes at the tile edges.
  vec2 q = fract(uv - mo) / ms;

  gMac = sf_hash11(mo.x * 191.31 + mo.y * 77.71 + uSeed * 3.77);

  vec2 o = vec2(0.0), s = vec2(1.0);
  vec4 lvl = vec4(0.0);

  for (int i = 0; i < SF_DEPTH; i++) {
    float k  = sf_hash11(o.x * 311.7 + o.y * 127.1 + s.x * 53.3 + s.y * 97.1 + gMac * 23.0);
    float k2 = sf_hash11(k * 91.7 + 13.1);
    float k3 = sf_hash11(k2 * 57.3 + 7.9);

    vec2 abs2 = s * ms;                       // rectangle size in tile units
    // 0.30 is the smallest split fraction below, so this is the true test for
    // "can this rectangle be cut without producing a sliver".
    bool canX = abs2.x * 0.30 > SF_MIN_PLATE;
    bool canY = abs2.y * 0.30 > SF_MIN_PLATE;
    if (!canX && !canY) break;
    if (i >= 2 && k3 < 0.26) break;           // stochastic stop -> mixed sizes

    bool splitX = canX && (!canY || abs2.x > abs2.y * mix(0.70, 1.50, k2));
    float t = mix(0.30, 0.70, k);

    if (splitX) {
      float c = o.x + s.x * t;
      if (q.x < c) { s.x *= t;                  lvl.y = float(i + 1); }
      else         { o.x = c; s.x *= (1.0 - t); lvl.x = float(i + 1); }
    } else {
      float c = o.y + s.y * t;
      if (q.y < c) { s.y *= t;                  lvl.w = float(i + 1); }
      else         { o.y = c; s.y *= (1.0 - t); lvl.z = float(i + 1); }
    }
  }

  gQ   = (q - o) / s;
  gS   = s * ms;
  gLvl = lvl;
  // Absolute edge coordinates. Both plates sharing an edge evaluate the SAME
  // expression from the same values, so a hash of this agrees on both sides —
  // that is what lets a weld seam be welded along its whole length instead of
  // welded on one side and grooved on the other.
  gE = vec4(mo.x + o.x * ms.x, mo.x + (o.x + s.x) * ms.x,
            mo.y + o.y * ms.y, mo.y + (o.y + s.y) * ms.y);
  gId = sf_hash11(o.x * 443.1 + o.y * 197.7 + s.x * 71.3 + s.y * 131.9 + gMac * 51.0);

  // -------------------------------------------------------------------------
  // THE DETAIL BUDGET, at plate scale       (critique round 2, headline note)
  // -------------------------------------------------------------------------
  // *"Our quietest 24 px tile measures 1.02-1.70 of detail energy where the
  // reference measures 0.05. The reference is ~70% large smooth armour plate
  // carrying only scribed panel lines, with greeble concentrated into three or
  // four deliberate clusters."*
  //
  // Measured, as the standard deviation of sRGB luma inside 24 px hull tiles:
  // the reference's quiet armour face runs min 2.11 / p25 3.33 and its
  // machinery band runs min 8.87 / p25 18.8 — a 22x spread across one hull.
  // The Carrier deck ran min 18.2 / p25 24.7 — a 1.9x spread, i.e. no silence
  // anywhere. So detail is BUDGETED per plate here, exactly as it is budgeted
  // per 90 m district in the hull shader.
  //
  // The field is a low-frequency tiling fbm sampled at the plate's ORIGIN, so
  // every fragment of a plate gets the same value and neighbouring plates get
  // similar ones: the busy plates arrive in CLUSTERS (a machinery district)
  // rather than as salt-and-pepper. A per-plate hash is folded in at 40% so a
  // cluster is not a solid rectangle of greeble.
  //
  // What it gates: fastener rows, hatches, vents, stencilled decals, grime
  // streaks, plate-to-plate albedo scatter and the rolled-sheet micro-tooth.
  // What it NEVER gates: panel lines, weld beads, plate level steps, the wear
  // band and the roughness spread — the scribing and the finish that make
  // silence read as armour rather than as blank plastic.
  float cluster = sf_tfbm(vec2(gE.x, gE.z) * 3.0, vec2(3.0), 3, uSeed * 67.3);
  gBusy = smoothstep(0.42, 0.60, cluster * 0.72 + sf_hash11(gId * 163.1 + 3.3) * 0.40);
}

/**
 * The hull height field, in tile units, and the masks that go with it.
 *
 * Called five times per fragment on the normal pass (centre plus four taps) and
 * once on the others. Writing the masks to globals means the colour passes get
 * them for free from the centre evaluation.
 */
float sfHeight(vec2 uv) {
  sfPlate(uv);

  vec2 P = gS;
  vec2 Q = gQ;

  // -- panel lines ----------------------------------------------------------
  // Distance to each of the four edges. A level-0 macro seam is a structural
  // joint and stays wide; a level-6 cut is a hairline between two plates of the
  // same panel. Grooves are floored at ~1.4 texels so they survive mipping.
  vec4 d  = vec4(Q.x * P.x, (1.0 - Q.x) * P.x, Q.y * P.y, (1.0 - Q.y) * P.y);
  vec4 gw = mix(vec4(gGrooveMaj), vec4(gGrooveMin), clamp(gLvl / float(SF_DEPTH), 0.0, 1.0));

  // Which lines are welded shut rather than left as a gap. Hashed on the
  // absolute edge coordinate so the decision is shared across the seam.
  vec4 weldK = vec4(sf_hash11(gE.x * 613.7 + uSeed * 2.3),
                    sf_hash11(gE.y * 613.7 + uSeed * 2.3),
                    sf_hash11(gE.z * 419.3 + uSeed * 5.1),
                    sf_hash11(gE.w * 419.3 + uSeed * 5.1));
  vec4 isWeld = step(0.66, weldK);

  vec4 gprof = (1.0 - smoothstep(gw, gw + gChamfer, d)) * (1.0 - isWeld);
  float groove = max(max(gprof.x, gprof.y), max(gprof.z, gprof.w));

  // Weld beads: a rounded ridge sitting on the joint, with a fine ripple along
  // its length (the bead of an actual weld run) and a slow wander in width.
  float bw = max(MM_WELD_W * uMM, 1.6 * gTx);
  vec4 bprof = sqrt(max(vec4(0.0), 1.0 - min(d / bw, 1.0) * min(d / bw, 1.0))) * isWeld;
  float bead = max(max(bprof.x, bprof.y), max(bprof.z, bprof.w));
  float ripple = 0.78 + 0.22 * sin(uv.x * SF_PI2 * 96.0) * sin(uv.y * SF_PI2 * 96.0 + 1.7);
  bead *= ripple;

  float edgeD = min(min(d.x, d.y), min(d.z, d.w));

  // -- plate body -----------------------------------------------------------
  // Each plate sits at its own level; the step is small compared with the
  // groove depth, so the discontinuity is buried at the bottom of the gap.
  float plateH = (sf_hash11(gId * 17.31 + 2.7) - 0.5) * MM_PLATE_STEP * uMM;
  // Oil-canning: a shallow dome over the plate, sign and amount hashed. This is
  // the single cheapest cue that a hull is thin metal stretched over a frame.
  float warp = (sin(Q.x * 3.14159) * sin(Q.y * 3.14159) - 0.45)
             * (sf_hash11(gId * 39.7 + 8.3) - 0.5) * 2.0 * MM_WARP * uMM;
  // Plus a long-wavelength sag across the whole tile, unrelated to the plating.
  warp += (sf_tfbm(uv * 4.0, vec2(4.0), 3, uSeed * 0.31) - 0.5) * 1.6 * MM_WARP * uMM;
  // Rolled-sheet tooth: a few tenths of a millimetre at ~7 cm, far too small to
  // see as shape but enough to stop a big plate reading as a mirror-flat panel
  // once a hard key light rakes across it. Budgeted: a quiet armour face keeps
  // only a fifth of it, because at the new base gloss this tooth is the single
  // biggest contributor to the "detail everywhere" floor.
  warp += (sf_tfbm(uv * 88.0, vec2(88.0), 2, uSeed * 61.3) - 0.5)
        * mix(0.11, 0.60, gBusy) * uMM;

  float h = plateH + warp;
  h -= groove * MM_GROOVE_DEEP * uMM;
  h += bead * MM_WELD * uMM;

  // -- fastener rows --------------------------------------------------------
  // Bolts run parallel to the plate edges at a fixed inset. The pitch is
  // rounded so a whole number of bolts fits the edge — a half bolt in a corner
  // is the fastest way to make procedural plating look procedural.
  float rivet = 0.0;
  float rivH = 0.0;
  float inset = MM_RIVET_INSET * uMM;
  float rr = max(MM_RIVET_R * uMM, 1.3 * gTx);
  // Budgeted: a quiet armour plate is almost never bolted (threshold 0.93), a
  // plate in a machinery district almost always is (0.22). Bolt rows are the
  // highest-frequency albedo feature in the bake and were previously on two
  // thirds of every plate on every hull.
  if (sf_hash11(gId * 13.77 + 1.3) > mix(0.93, 0.22, gBusy) && min(P.x, P.y) > inset * 4.0) {
    float pitch = MM_RIVET_PITCH * uMM;
    float nX = max(2.0, floor(P.y / pitch + 0.5));
    float nY = max(2.0, floor(P.x / pitch + 0.5));
    float pX = P.y / nX;
    float pY = P.x / nY;
    // nearest vertical edge + tangential coordinate along it, then the same for
    // the nearest horizontal edge; the union covers corners sensibly.
    float dxE = min(d.x, d.y);
    float dyE = min(d.z, d.w);
    float ax = length(vec2(dxE - inset, mod(Q.y * P.y, pX) - pX * 0.5));
    float ay = length(vec2(dyE - inset, mod(Q.x * P.x, pY) - pY * 0.5));
    float ra = min(ax, ay);
    // Dome profile: a spherical cap, not a gaussian — bolts have a hard rim and
    // that rim is what catches the key light.
    float t = clamp(ra / rr, 0.0, 1.0);
    rivH = sqrt(max(0.0, 1.0 - t * t));
    rivet = 1.0 - smoothstep(0.80, 1.0, t);
    h += rivH * rivet * MM_RIVET_H * uMM;
  }

  // -- hatches and vents ----------------------------------------------------
  float hs = sf_hash11(gId * 29.31 + 4.7);
  float vent = 0.0;
  float hatch = 0.0;
  vec2 hp = (Q - 0.5) * P;                       // absolute offset from centre
  float small = min(P.x, P.y);

  // Hatches and vents are machinery, so they are budgeted too: on a quiet
  // armour face the thresholds are effectively unreachable.
  if (hs > mix(0.985, 0.84, gBusy) && small > 0.16) {
    // Maintenance hatch: recessed outline, slightly proud lid, corner bolts.
    vec2 hb = P * 0.5 - vec2(small * 0.24);
    float sd = sfSdBox(hp, hb, small * 0.06);
    float outline = 1.0 - smoothstep(gGrooveMin, gGrooveMin + gChamfer, abs(sd));
    hatch = 1.0 - smoothstep(0.0, gChamfer, sd);
    h -= outline * MM_GROOVE_DEEP * uMM * 0.85;
    h += hatch * MM_HATCH_LIP * uMM;
    groove = max(groove, outline);
    // four corner bolts, folded into one quadrant by abs()
    float bd = length(abs(hp) - (hb - vec2(small * 0.10)));
    float bt = clamp(bd / rr, 0.0, 1.0);
    float bm = 1.0 - smoothstep(0.80, 1.0, bt);
    h += sqrt(max(0.0, 1.0 - bt * bt)) * bm * MM_RIVET_H * uMM * 1.15;
    rivet = max(rivet, bm);
  } else if (hs > mix(0.965, 0.70, gBusy) && small > 0.11) {
    // Louvred vent: a sunken box full of slats. The slat pitch is absolute, so
    // vents on a fighter and on a mothership have the same physical louvres.
    vec2 vb = P * 0.5 - vec2(small * 0.22);
    float sd = sfSdBox(hp, vb, small * 0.04);
    float inside = 1.0 - smoothstep(-gChamfer, 0.0, sd);
    float pitchV = 34.0 * uMM;
    float ph = fract((hp.y + vb.y) / pitchV);
    float slot = smoothstep(0.26, 0.40, ph) * (1.0 - smoothstep(0.60, 0.74, ph));
    vent = inside * slot;
    float rim = 1.0 - smoothstep(gGrooveMin, gGrooveMin + gChamfer, abs(sd));
    h -= vent * MM_SLAT * uMM;
    h -= rim * MM_GROOVE_DEEP * uMM * 0.55;      // the vent frame is recessed too
    groove = max(groove, max(vent, rim));
  }

  gGroove = clamp(groove, 0.0, 1.0);
  gRivet  = clamp(rivet, 0.0, 1.0);
  gWeld   = clamp(bead, 0.0, 1.0);
  gEdgeD  = edgeD;
  gVent   = vent;
  gHatch  = hatch;
  gPlateH = plateH;
  return h;
}

/**
 * Streaked grime.
 *
 * Two anisotropic fbm layers — high frequency across the tile, very low along
 * it — give the vertical drip structure. They are gated by an exponential bleed
 * running away from the plate's -v edge and pooled in the panel gaps, so the
 * dirt is anchored to the plating instead of floating over it as a noise layer.
 */
float sfGrime(vec2 uv) {
  float fine  = sf_tfbm(vec2(uv.x * 32.0, uv.y * 3.0), vec2(32.0, 3.0), 4, uSeed * 7.1);
  float broad = sf_tfbm(vec2(uv.x * 8.0,  uv.y * 2.0), vec2(8.0, 2.0), 3, uSeed * 11.3);
  float soil  = sf_tfbm(uv * 3.0, vec2(3.0), 4, uSeed * 17.7);

  float streak = clamp(fine * 0.55 + broad * 0.45, 0.0, 1.0);
  // Run length ~ 55 cm of hull below whatever the streak came out of, and only
  // on plates that are dirty at all — a uniformly filthy hull reads as fog.
  float dirty = smoothstep(0.30, 0.72, sf_hash11(gId * 23.7 + 6.1));
  float bleed = exp(-gQ.y * gS.y / 0.09);
  float run = smoothstep(0.34, 0.88, streak) * bleed * mix(0.35, 1.0, dirty);

  // Budgeted. Grime is what dirt DOES, and what it does is run out of vents,
  // pool in seams and streak below machinery — it does not settle evenly over
  // a clean armour belt. The broad soil field and the drip runs are therefore
  // gated hard on the plate's detail budget, while the seam and vent pooling
  // is not, because those are anchored to real features.
  float budget = mix(0.16, 1.0, gBusy);
  float g = soil * 0.30 * budget       // broad dirt fields
          + run * 1.05 * budget        // drip streaks off the plate edges
          + gGroove * 0.30             // dirt pools in the seams
          + gVent * 0.50;              // and blows out of the vents
  return clamp(g * 0.94, 0.0, 1.0);
}

/**
 * Stencilled decals: hazard chevrons, registry blocks and seven-segment
 * numerals. Sparse on purpose — roughly one plate in eight carries anything,
 * because a hull covered in markings reads as a decal sheet, not a warship.
 */
float sfDecal(vec2 uv) {
  vec2 P = gS, Q = gQ;
  float small = min(P.x, P.y);
  if (small < 0.09) return 0.0;

  // Budgeted: stencilling belongs beside the machinery it labels. Pushing the
  // hash up by (1 - gBusy) takes markings off quiet armour entirely, which is
  // what the reference does — its big plates carry paint graphics and nothing
  // else, and its markings cluster around hatches and bays.
  float k = sf_hash11(gId * 61.31 + 9.1) - (1.0 - gBusy) * 0.30;
  vec2 hp = (Q - 0.5) * P;
  float a = 0.0;
  float sw = max(2.0 * gTx, 1.2 * uMM);        // stroke softening

  if (k > 0.945) {
    // Hazard chevrons in a band along the long axis of the plate.
    float band = (1.0 - smoothstep(0.14, 0.19, abs(Q.y - 0.16)))
               * (1.0 - smoothstep(0.40, 0.46, abs(Q.x - 0.5)));
    float stripe = fract((hp.x + hp.y) / (46.0 * uMM));
    a = band * (1.0 - smoothstep(0.46, 0.54, abs(stripe - 0.25) * 2.0));
  } else if (k > 0.905) {
    // Registry block: a solid slab with a knocked-out bar, like a painted
    // rectangle with the hull number reversed out of it.
    vec2 b = vec2(small * 0.30, small * 0.12);
    float sd = sfSdBox(hp - vec2(0.0, small * 0.18), b, small * 0.02);
    float slab = 1.0 - smoothstep(0.0, sw, sd);
    float bar = 1.0 - smoothstep(0.0, sw, abs(hp.y - small * 0.18) - small * 0.03);
    a = clamp(slab - bar * slab, 0.0, 1.0);
  } else if (k > 0.855) {
    // Two stencilled digits. Seven-segment shapes read as machine-painted at
    // any distance and cost seven capsule distances to draw.
    float gh = min(small * 0.30, 0.075);        // glyph half height, tile units
    float gwid = gh * 0.62;
    float pitch = gwid * 2.9;
    float which = step(0.0, hp.x);
    vec2 gp = vec2((hp.x - (which - 0.5) * pitch) / gwid, hp.y / gh);
    float dg = sf_hash11(gId * 83.1 + which * 27.3 + 3.9);
    float digit = floor(dg * 10.0);

    // Seven-segment bit field: 1 top, 2 upper-right, 4 lower-right, 8 bottom,
    // 16 lower-left, 32 upper-left, 64 middle.
    float bits = 127.0;
    if      (digit < 0.5) bits = 63.0;
    else if (digit < 1.5) bits = 6.0;
    else if (digit < 2.5) bits = 91.0;
    else if (digit < 3.5) bits = 79.0;
    else if (digit < 4.5) bits = 102.0;
    else if (digit < 5.5) bits = 109.0;
    else if (digit < 6.5) bits = 125.0;
    else if (digit < 7.5) bits = 7.0;
    else if (digit < 8.5) bits = 127.0;
    else                  bits = 111.0;

    float sr = 0.16;
    float sd = 1e9;
    if (mod(floor(bits /  1.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2(-0.5,  1.0), vec2( 0.5,  1.0), sr));
    if (mod(floor(bits /  2.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2( 0.5,  1.0), vec2( 0.5,  0.0), sr));
    if (mod(floor(bits /  4.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2( 0.5,  0.0), vec2( 0.5, -1.0), sr));
    if (mod(floor(bits /  8.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2(-0.5, -1.0), vec2( 0.5, -1.0), sr));
    if (mod(floor(bits / 16.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2(-0.5,  0.0), vec2(-0.5, -1.0), sr));
    if (mod(floor(bits / 32.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2(-0.5,  1.0), vec2(-0.5,  0.0), sr));
    if (mod(floor(bits / 64.0), 2.0) > 0.5) sd = min(sd, sfSdSeg(gp, vec2(-0.5,  0.0), vec2( 0.5,  0.0), sr));
    a = 1.0 - smoothstep(0.0, sw / gh + 0.04, sd);
  }

  // Paint does not survive on a seam or on a bolt head, and it wears at the
  // stroke edges, so break the alpha with the same noise that drives the wear.
  float chew = sf_tfbm(uv * 46.0, vec2(46.0), 3, uSeed * 23.9);
  a *= 1.0 - gGroove;
  a *= 1.0 - gRivet * 0.75;
  a *= smoothstep(0.30, 0.62, chew * 0.55 + 0.45);
  return clamp(a, 0.0, 1.0);
}

void main() {
  vec2 uv = fract(vUv);

  gTx        = 1.0 / uRes;
  gGrooveMaj = max(MM_GROOVE_MAJ * uMM, 1.4 * gTx);
  gGrooveMin = max(MM_GROOVE_MIN * uMM, 0.8 * gTx);
  gChamfer   = max(MM_CHAMFER    * uMM, 1.7 * gTx);

#if SF_PASS == 1
  // --- tangent-space normal from a central difference of the height field ---
  // The taps are wrapped, so the derivative is correct across the tile seam and
  // the normal map tiles as cleanly as the layout does.
  float e = gTx;
  float hL = sfHeight(fract(uv - vec2(e, 0.0)));
  float hR = sfHeight(fract(uv + vec2(e, 0.0)));
  float hD = sfHeight(fract(uv - vec2(0.0, e)));
  float hU = sfHeight(fract(uv + vec2(0.0, e)));
  float hC = sfHeight(uv);                       // last, so the globals are the centre's

  // Heights and uv share units, so this is a true slope. It is clamped because
  // the plate-to-plate step is a genuine discontinuity at the bottom of a
  // groove and an unclamped one texel spike there aliases into sparkle.
  float dx = clamp((hR - hL) / (2.0 * e), -6.0, 6.0);
  float dy = clamp((hU - hD) / (2.0 * e), -6.0, 6.0);
  vec3 n = normalize(vec3(-dx, -dy, 1.0));
  // .a carries the height field itself, remapped about 0.5. Nothing samples it
  // today; it is there for parallax or decal projection later.
  gl_FragColor = vec4(n * 0.5 + 0.5, clamp(hC / (18.0 * uMM) + 0.5, 0.0, 1.0));

#else
  sfHeight(uv);

  // Plate-to-plate value break-up. This is the channel that stops a hull from
  // reading as one continuous painted shell: hard steps at every seam, plus a
  // low-frequency drift so the steps do not look randomly assigned.
  //
  // Budgeted, and this is the single biggest lever on the measured detail
  // floor: a +/-0.275 albedo step on EVERY plate is a permanent 24 px tile
  // energy of ~18 no matter how the hull is lit. An armour belt now steps by
  // +/-0.075 (a value drift you read as one plated surface) while a machinery
  // district keeps the full break-up. The low-frequency drift is NOT budgeted
  // — it is what stops a quiet face going dead flat.
  float plateVal = 0.5
    + (sf_hash11(gId * 71.3 + 5.9) - 0.5) * mix(0.15, 0.62, gBusy)
    + (sf_tfbm(uv * 7.0, vec2(7.0), 3, uSeed * 29.1) - 0.5) * 0.22
    + (gQ.y - 0.5) * 0.06;
  plateVal = clamp(plateVal, 0.0, 1.0);

  float grime = sfGrime(uv);

  // Wear rides the plate edges and the bolt crowns: a thin band just outside
  // the groove, chewed by noise so it is not a uniform outline.
  float chew = sf_tfbm(uv * 24.0, vec2(24.0), 4, uSeed * 37.7);
  float wearBand = 1.0 - smoothstep(gGrooveMaj, gGrooveMaj + 9.0 * uMM, gEdgeD);
  float wear = clamp(wearBand * (0.25 + 0.95 * chew)
                   + gRivet * 0.55 * chew
                   + gWeld * 0.35, 0.0, 1.0);
  wear *= 0.55 + 0.45 * sf_tfbm(uv * 2.0, vec2(2.0), 3, uSeed * 43.3);

  #if SF_PASS == 0
    // r panel-line mask, g plate value, b grime, a rivet / greeble mask
    gl_FragColor = vec4(gGroove,
                        plateVal,
                        grime,
                        clamp(gRivet + gWeld * 0.55 + gHatch * 0.18, 0.0, 1.0));
  #else
    // r roughness. The hull shader reads this as a SIGNED OFFSET around
    //   SURFACE_ROUGH_MEAN. That constant is exported from this file, imported
    //   by hullMaterial.ts and interpolated into BOTH shaders, so the bake and
    //   the reader are one source of truth and cannot drift.
    //
    //   CRITIQUE ROUND 2 (blocker, two reviewers): "widen the plate roughness
    //   spread ... and bias the surface bake's roughness channel mean down so
    //   most plate is semi-gloss". The distribution is now centred on 0.38 with
    //   a +/-0.34 plate-to-plate spread, which the shader amplifies by 1.05:
    //   most plate is semi-gloss, some plates are near-mirror and their
    //   neighbours are matte, and under one key light that difference IS the
    //   broken moving highlight the review says reads as metal.
    //
    //   NOT budgeted by gBusy — see the note in sfPlate. Roughness carries no
    //   albedo texture and is invisible until light hits it, so it costs
    //   nothing against the detail floor and it is precisely what a large quiet
    //   armour face needs in order to read as metal instead of as plastic.
    float rough = SF_ROUGH_MEAN + (sf_hash11(gId * 97.7 + 11.1) - 0.5) * 0.68;
    rough = mix(rough, 0.92, gGroove * 0.80);
    rough = mix(rough, 0.94, gVent * 0.85);
    rough = mix(rough, 0.06, wear * 0.75);          // machined edges are polished
    rough = mix(rough, min(1.0, rough + 0.22), grime * 0.55);
    rough = clamp(rough + (sf_tfbm(uv * 64.0, vec2(64.0), 2, uSeed * 53.1) - 0.5) * 0.10, 0.02, 1.0);

    // g metalness modulation, centred on 0.5 because the hull shader reads it
    //   as a signed offset. Bare metal shows through where paint has worn.
    float metal = 0.5 + (sf_hash11(gId * 131.7 + 17.3) - 0.5) * 0.30;
    metal = mix(metal, 0.92, wear * 0.70);
    metal = mix(metal, 0.30, grime * 0.45);

    // b edge wear, a decal alpha
    gl_FragColor = vec4(clamp(rough, 0.0, 1.0),
                        clamp(metal, 0.0, 1.0),
                        wear,
                        sfDecal(uv));
  #endif
#endif
}
`;

// ---------------------------------------------------------------------------
// GLSL — the MACRO structural bake
// ---------------------------------------------------------------------------

/**
 * The macro structural generator — the tier that was missing entirely.
 *
 * Compiled twice with `SF_PASS` = 0 (mask RGBA) or 1 (tangent-space normal),
 * both driven by the same height field so relief and masks cannot drift apart,
 * exactly like the plate bake.
 *
 * WHAT IT AUTHORS, and why each thing is there:
 *   - ARMOUR BLOCKS, 5-28 m, from the same seamless double-cut subdivision the
 *     plate layer uses. Each block sits at one of three tiers — recessed bay,
 *     deck level, proud armour slab — with a bevelled edge, so a capital's
 *     flank is a mosaic of large hard-edged plates with their own values
 *     rather than one continuous painted shell.
 *   - STRUCTURAL BAY SEAMS between them, 0.26-0.62 m wide and 0.85 m deep.
 *     These are the lines the eye follows down a kilometre of hull.
 *   - SERVICE TRENCHES, 5.4 m wide and 2.4 m deep, running the length of the
 *     tile in hashed segments, with transverse frames every 6 m inside them.
 *     Countable features at a fixed physical pitch are the cheapest honest
 *     scale cue there is — a 2.1 km hull shows ~350 of them, a 300 m destroyer
 *     ~50, and the difference is legible without a size reference in frame.
 *   - A POLISHED EDGE LIP band just outboard of every seam, trench lip and
 *     slab bevel. The hull shader drives roughness and metalness off it, which
 *     is where the 1-2 px specular line along every machined edge comes from.
 *
 * UNITS: tile units throughout (1.0 = one tile = `uTileM` metres); `gM` is one
 * metre expressed in tile units, so every constant below is a real dimension.
 */
const MACRO_FRAG = /* glsl */ `
uniform float uRes;    // texels along one edge of the baked tile
uniform float uTileM;  // metres covered by one tile
uniform float uSeed;

varying vec2 vUv;

${GLSL_NOISE}
${GLSL_TILE_NOISE}

/** Subdivisions below the macro cell. 4 gives blocks from ~5 m to ~28 m. */
const int   MC_DEPTH = 4;
/** Transverse frames per tile inside a trench — a whole number, so it tiles. */
const float MC_RIBS  = 8.0;

// --- structural dimensions, METRES ------------------------------------------
const float M_SEAM_MAJ  = 0.62;   // half-width of a primary bay seam
const float M_SEAM_MIN  = 0.26;   // half-width of a block joint
const float M_SEAM_CHAM = 0.55;   // bevel run at the lip of a seam
const float M_SEAM_DEEP = 0.85;   // seam depth
const float M_SLAB      = 1.25;   // armour slab standing proud of the deck
const float M_BAY       = 0.70;   // recessed bay floor below the deck
const float M_TRENCH_W  = 2.70;   // service trench half-width
const float M_TRENCH_D  = 2.40;   // service trench depth
const float M_RIB       = 1.45;   // transverse frame height inside a trench
const float M_LIP       = 1.50;   // width of the polished edge band

float gM;    // one metre, tile units
float gTx;   // one texel, tile units
float gMin;  // smallest permitted block edge, tile units

// --- block state ------------------------------------------------------------
vec2  bQ;    // 0..1 inside the block
vec2  bS;    // block size, tile units
vec4  bLvl;  // subdivision level of the (-x, +x, -y, +y) edges
float bId;   // stable per-block hash
float bMac;  // per-macro-cell hash

// --- surface state ----------------------------------------------------------
float gSeam;   // seam / recess mask
float gLip;    // polished machined edge band
float gChan;   // inside a service trench
float gRib;    // on a transverse frame inside a trench

/**
 * Which armour block this coordinate belongs to. Same construction as the
 * plate bake: cut the tile TWICE per axis and read the result as a torus so no
 * block boundary is pinned to the tile border, then subdivide inside the macro
 * cell in local coordinates.
 */
void sfMacroBlock(vec2 uv) {
  float ax0 = 0.06 + 0.30 * sf_hash11(uSeed +  3.11);
  float ax1 = 0.54 + 0.34 * sf_hash11(uSeed +  7.53);
  float ay0 = 0.08 + 0.28 * sf_hash11(uSeed + 11.71);
  float ay1 = 0.56 + 0.32 * sf_hash11(uSeed + 17.93);

  vec2 mo, ms;
  if (uv.x >= ax0 && uv.x < ax1) { mo.x = ax0; ms.x = ax1 - ax0; }
  else                           { mo.x = ax1; ms.x = 1.0 - (ax1 - ax0); }
  if (uv.y >= ay0 && uv.y < ay1) { mo.y = ay0; ms.y = ay1 - ay0; }
  else                           { mo.y = ay1; ms.y = 1.0 - (ay1 - ay0); }

  vec2 q = fract(uv - mo) / ms;
  bMac = sf_hash11(mo.x * 157.31 + mo.y * 91.71 + uSeed * 5.77);

  vec2 o = vec2(0.0), s = vec2(1.0);
  vec4 lvl = vec4(0.0);

  for (int i = 0; i < MC_DEPTH; i++) {
    float k  = sf_hash11(o.x * 271.7 + o.y * 143.1 + s.x * 61.3 + s.y * 89.1 + bMac * 29.0);
    float k2 = sf_hash11(k * 83.7 + 11.1);
    float k3 = sf_hash11(k2 * 47.3 + 5.9);

    vec2 abs2 = s * ms;
    bool canX = abs2.x * 0.32 > gMin;
    bool canY = abs2.y * 0.32 > gMin;
    if (!canX && !canY) break;
    if (i >= 1 && k3 < 0.22) break;             // stochastic stop -> mixed sizes

    bool splitX = canX && (!canY || abs2.x > abs2.y * mix(0.65, 1.55, k2));
    float t = mix(0.32, 0.68, k);

    if (splitX) {
      float c = o.x + s.x * t;
      if (q.x < c) { s.x *= t;                  lvl.y = float(i + 1); }
      else         { o.x = c; s.x *= (1.0 - t); lvl.x = float(i + 1); }
    } else {
      float c = o.y + s.y * t;
      if (q.y < c) { s.y *= t;                  lvl.w = float(i + 1); }
      else         { o.y = c; s.y *= (1.0 - t); lvl.z = float(i + 1); }
    }
  }

  bQ   = (q - o) / s;
  bS   = s * ms;
  bLvl = lvl;
  bId  = sf_hash11(o.x * 389.1 + o.y * 211.7 + s.x * 67.3 + s.y * 127.9 + bMac * 43.0);
}

/** The macro height field, tile units, plus the masks that go with it. */
float sfMacroH(vec2 uv) {
  sfMacroBlock(uv);

  vec2 P = bS, Q = bQ;
  vec4 d = vec4(Q.x * P.x, (1.0 - Q.x) * P.x, Q.y * P.y, (1.0 - Q.y) * P.y);

  // A level-0 cut is a structural bay seam and stays wide; deeper cuts are
  // ordinary block joints. Floored at ~1.2 texels so they survive mipping.
  vec4 w = mix(vec4(M_SEAM_MAJ), vec4(M_SEAM_MIN),
               clamp(bLvl / float(MC_DEPTH), 0.0, 1.0)) * gM;
  w = max(w, vec4(1.2 * gTx));
  float cham = max(M_SEAM_CHAM * gM, 1.4 * gTx);

  vec4 sprof = 1.0 - smoothstep(w, w + cham, d);
  float seam = max(max(sprof.x, sprof.y), max(sprof.z, sprof.w));
  float edgeD = min(min(d.x, d.y), min(d.z, d.w));

  // -- block tier -----------------------------------------------------------
  // Three levels, bevelled at the edge so a slab is a chamfered armour block
  // and not a card lying on the deck. The bevel is also where the specular
  // lip lives, which is the single strongest "this is metal" cue on the hull.
  float k = sf_hash11(bId * 23.13 + 1.77);
  float tier = k < 0.28 ? -M_BAY : (k < 0.72 ? 0.0 : M_SLAB);
  float bevelW = max(1.0 * gM, 2.0 * gTx);
  float bevel = smoothstep(0.0, bevelW, edgeD);
  float h = tier * gM * bevel;

  // A slight rake across the larger slabs so a hard key light cannot land on
  // the whole flank at one angle — this is half of the "moving highlight".
  h += (Q.x - 0.5) * (sf_hash11(bId * 61.7 + 3.3) - 0.5) * 0.55 * gM
     * step(0.16, min(P.x, P.y));

  h -= seam * M_SEAM_DEEP * gM;

  // -- service trenches -----------------------------------------------------
  // Two channels per tile at hashed offsets, running the full tile length (so
  // they tile), broken into segments along their run so the hull does not read
  // as corduroy, with transverse frames inside at a fixed 6 m pitch.
  float o1 = sf_hash11(uSeed * 3.17 + 0.71);
  float o2 = sf_hash11(uSeed * 5.93 + 2.31);
  float dA = min(abs(fract(uv.y - o1 + 0.5) - 0.5), abs(fract(uv.y - o2 + 0.5) - 0.5));
  float hw = max(M_TRENCH_W * gM, 2.0 * gTx);
  float chamT = max(0.9 * gM, 1.4 * gTx);
  float gate = smoothstep(0.42, 0.58,
                          sf_tfbm(vec2(uv.x * 3.0, o1 * 11.0), vec2(3.0, 3.0), 2, uSeed * 13.3));
  float chan = (1.0 - smoothstep(hw, hw + chamT, dA)) * gate;
  float rp = fract(uv.x * MC_RIBS);
  float rib = (1.0 - smoothstep(0.12, 0.26, abs(rp - 0.5))) * chan;

  h -= chan * M_TRENCH_D * gM;
  h += rib * M_RIB * gM;

  // -- polished edge band ---------------------------------------------------
  // Just OUTBOARD of the groove, not inside it: the machined lip of the plate.
  vec4 lipV = smoothstep(w, w + 0.35 * gM, d)
            * (1.0 - smoothstep(w + 0.45 * gM, w + M_LIP * gM, d));
  float lip = max(max(lipV.x, lipV.y), max(lipV.z, lipV.w));
  float tlip = smoothstep(hw, hw + chamT, dA)
             * (1.0 - smoothstep(hw + chamT, hw + chamT + M_LIP * gM, dA)) * gate;
  lip = max(lip, tlip);
  lip = max(lip, (1.0 - bevel) * step(0.30, abs(tier)));   // the slab chamfer itself

  gSeam = clamp(seam + chan * 0.85, 0.0, 1.0);
  gLip  = clamp(lip, 0.0, 1.0);
  gChan = chan;
  gRib  = rib;
  return h;
}

void main() {
  vec2 uv = fract(vUv);

  gM   = 1.0 / uTileM;
  gTx  = 1.0 / uRes;
  gMin = 5.0 * gM;                      // smallest armour block, 5 m

#if SF_PASS == 1
  // Central difference of the same height field, wrapped, so the macro normal
  // tiles as cleanly as the layout and lands exactly on the seams.
  float e = gTx;
  float hL = sfMacroH(fract(uv - vec2(e, 0.0)));
  float hR = sfMacroH(fract(uv + vec2(e, 0.0)));
  float hD = sfMacroH(fract(uv - vec2(0.0, e)));
  float hU = sfMacroH(fract(uv + vec2(0.0, e)));
  float hC = sfMacroH(uv);              // last, so the globals are the centre's

  // Height and uv share units, so this is a true slope. Clamped because a seam
  // wall is a genuine near-vertical discontinuity and an unclamped spike there
  // aliases into sparkle at fleet range.
  float dx = clamp((hR - hL) / (2.0 * e), -8.0, 8.0);
  float dy = clamp((hU - hD) / (2.0 * e), -8.0, 8.0);
  vec3 n = normalize(vec3(-dx, -dy, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, clamp(hC / (4.0 * gM) + 0.5, 0.0, 1.0));

#else
  sfMacroH(uv);

  // g — block value. This is the channel that gives one hull a 2:1 internal
  // value range at 48 m instead of the 8% bow-to-stern range the review
  // measured, and it is the only value channel that survives to fleet range.
  float val = 0.5
    + (sf_hash11(bId * 77.3 + 7.9) - 0.5) * 0.92
    + (sf_tfbm(uv * 2.0, vec2(2.0), 3, uSeed * 31.1) - 0.5) * 0.34;
  val = clamp(val, 0.0, 1.0);

  // Chew the lip with mid-frequency noise so the specular line is a broken
  // machined edge rather than a uniform outline traced round every plate.
  float chew = sf_tfbm(uv * 14.0, vec2(14.0), 3, uSeed * 47.7);
  float lip = clamp(gLip * (0.45 + 0.90 * chew), 0.0, 1.0);

  // a — macro cavity occlusion. Trenches and bay seams pool shadow; the ribs
  // standing inside a trench catch light again, so the channel is not flat.
  float ao = clamp(1.0 - gSeam * 0.42 - gChan * 0.45 * (1.0 - gRib * 0.8), 0.05, 1.0);

  // r recess mask, g block value, b polished edge, a macro cavity AO
  gl_FragColor = vec4(gSeam, val, lip, ao);
#endif
}
`;

// ---------------------------------------------------------------------------
// GLSL — the explosion sprite sheet
// ---------------------------------------------------------------------------

/**
 * Turbulent fireball sheet.
 *
 * Each cell of the `uDim` x `uDim` grid is one frame of a single expanding
 * fireball, indexed left-to-right then bottom-to-top to match `particles.ts`.
 *
 * The motion is a cheap curl advection: two fbm samples form a vector field,
 * that field is rotated 90 degrees (which makes it approximately
 * divergence-free, i.e. it swirls instead of sourcing), and the sample point is
 * pushed along it by an amount that grows with the frame. Adding a radial push
 * on top turns the swirl into the boiling, outward-rolling motion of a real
 * fireball rather than a noise field that simply scrolls.
 *
 * Colour is Planckian so the sprite can be tinted per weapon without going
 * green in the midtones; alpha falls to zero well inside the cell so mip
 * generation can never bleed one frame into the next.
 */
const FIRE_FRAG = /* glsl */ `
uniform float uDim;
uniform float uSeed;
varying vec2 vUv;

${GLSL_NOISE}
${GLSL_UTIL}

void main() {
  vec2 cell = floor(vUv * uDim);
  float f = cell.x + cell.y * uDim;             // frame index, bottom-left first
  float total = uDim * uDim;
  float t = (f + 0.5) / total;                  // 0..1 life of the fireball

  vec2 p = fract(vUv * uDim) * 2.0 - 1.0;       // -1..1 inside the frame
  float r = length(p);

  // --- curl-ish advection --------------------------------------------------
  vec3 q = vec3(p * 2.1, t * 1.7 + uSeed);
  float wx = sf_fbm(q + vec3(11.3, 5.1, 0.0), 3, 2.1, 0.55) - 0.5;
  float wy = sf_fbm(q + vec3(-7.7, 3.3, 4.4), 3, 2.1, 0.55) - 0.5;
  vec2 flow = vec2(-wy, wx);                    // rotate 90 deg -> swirl
  vec2 dir = p / max(r, 1e-4);
  vec2 pw = p + flow * (0.20 + 0.55 * t) - dir * t * 0.22;

  // --- density -------------------------------------------------------------
  float rad = mix(0.20, 0.94, pow(t, 0.55));    // the ball expands, fast then slow
  float n = sf_fbm(vec3(pw * 3.3, t * 2.6 + uSeed * 3.0), 4, 2.15, 0.55);
  float ridge = sf_ridge(vec3(pw * 5.6, t * 3.4 + uSeed), 3);
  float dens = (rad - length(pw)) / max(rad, 1e-3)
             + (n - 0.5) * 1.05
             + (ridge - 0.5) * 0.30;

  float a = smoothstep(0.02, 0.42, dens);
  a *= 1.0 - smoothstep(0.55, 1.0, t);          // dissipate towards the last frames
  a *= 1.0 - smoothstep(0.72, 0.94, r);         // soft edge, dead before the cell wall
  a *= 1.0 - smoothstep(0.86, 1.0, max(abs(p.x), abs(p.y)));

  // --- blackbody colour ----------------------------------------------------
  // Hot only where the density is high and the frame is young; the tail cools
  // through orange into dark smoke, which is what sells scale.
  float temp = clamp(dens * 0.55 + (1.0 - t) * 0.45 - 0.10, 0.0, 1.0);
  vec3 col = sf_blackbody(temp * 0.16) * (0.35 + 3.4 * temp * temp);
  col *= mix(1.0, 0.16, smoothstep(0.25, 0.85, t));
  col = mix(col, vec3(0.045, 0.040, 0.038), smoothstep(0.42, 0.95, t));

  // Linear out: the render target is sRGB, so the GPU encodes on write.
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Linear 0..1 -> sRGB byte. Used for the CPU-side ramps we store ourselves. */
function srgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Clamp to a byte. */
function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ---------------------------------------------------------------------------
// ProceduralTextures
// ---------------------------------------------------------------------------

/**
 * The hull set plus the MACRO structural tier.
 *
 * `HullTextureSet` lives in `core/contracts.ts` and is consumed by modules
 * outside the render layer, so the new tier is added here as a structural
 * extension rather than by widening the shared contract: every existing
 * consumer keeps working untouched, and `hullMaterial` picks the macro maps up
 * when they are present (it degrades to the two-tier look when they are not).
 */
export interface MacroHullTextureSet extends HullTextureSet {
  /** RGBA: r = seam/trench recess, g = block value, b = polished edge, a = macro AO. */
  macro: THREE.Texture;
  /** Tangent-space normal of the macro relief; a = height about 0.5. */
  macroNormal: THREE.Texture;
  /** Scale in metres that one tile of the macro maps covers. */
  macroTileMetres: number;
}

/**
 * The one texture factory. Bakes on construction-demand (nothing is generated
 * until it is first asked for) and caches everything it makes, so the second
 * caller of `hull()` pays nothing and shares the same GPU objects.
 */
export class ProceduralTextures implements TextureFactory {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly quality: QualitySettings;
  private readonly aniso: number;

  // --- caches --------------------------------------------------------------
  private hullSet: MacroHullTextureSet | null = null;
  private plumeTex: THREE.Texture | null = null;
  private readonly softCache = new Map<number, THREE.Texture>();
  private readonly starCache = new Map<number, THREE.Texture>();
  private readonly noiseCache = new Map<number, THREE.Texture>();
  private readonly fireCache = new Map<string, THREE.Texture>();

  /** Everything we own and must destroy in `dispose`. */
  private readonly targets: THREE.WebGLRenderTarget[] = [];
  private readonly cpuTextures: THREE.Texture[] = [];

  // --- reusable bake rig ---------------------------------------------------
  private bakeScene: THREE.Scene | null = null;
  private bakeMesh: THREE.Mesh | null = null;
  private bakeGeo: THREE.PlaneGeometry | null = null;
  private readonly bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  /** Scratch for saving the renderer clear colour — never allocated per call. */
  private readonly savedClear = new THREE.Color();

  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, quality?: QualitySettings) {
    this.renderer = renderer;
    this.quality = quality ?? DEFAULT_QUALITY;
    this.aniso = renderer.capabilities.getMaxAnisotropy();
    this.bakeCamera.position.set(0, 0, 1);
    this.bakeCamera.lookAt(0, 0, 0);
    this.bakeCamera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Hull
  // -------------------------------------------------------------------------

  /**
   * The hull texture set: the macro structural tier, the hierarchical plating,
   * their matching normals, and the roughness / metalness / wear / decal
   * packing.
   *
   * Baked once and cached forever — calling this twice returns the identical
   * object, which is what lets every hull material in the game share one set of
   * uploads. Five bakes at load, ~8 ms total on a 2048 preset.
   */
  hull(): MacroHullTextureSet {
    if (this.hullSet) return this.hullSet;

    const size = HULL_SIZE_BY_PRESET[this.quality.preset] ?? 2048;
    const uniforms: Record<string, THREE.IUniform> = {
      uRes: { value: size },
      uTileM: { value: HULL_TILE_METRES },
      uMM: { value: 0.001 / HULL_TILE_METRES },
      uSeed: { value: (SEED_HULL % 65536) / 65536 },
    };

    // All the maps are DATA, not colour: the hull shader treats them as
    // masks, slopes and material parameters, so any sRGB transfer would be a
    // straight error rather than a look choice.
    const detailRt = this.makeTarget(size, THREE.NoColorSpace, THREE.RepeatWrapping);
    const normalRt = this.makeTarget(size, THREE.NoColorSpace, THREE.RepeatWrapping);
    const surfaceRt = this.makeTarget(size, THREE.NoColorSpace, THREE.RepeatWrapping);

    this.bake(HULL_FRAG, uniforms, detailRt, { SF_PASS: 0 });
    this.bake(HULL_FRAG, uniforms, normalRt, { SF_PASS: 1 });
    this.bake(HULL_FRAG, uniforms, surfaceRt, { SF_PASS: 2 });

    // --- the macro tier: its own tile, its own seed, its own resolution -----
    const mSize = MACRO_SIZE_BY_PRESET[this.quality.preset] ?? 1024;
    const macroUniforms: Record<string, THREE.IUniform> = {
      uRes: { value: mSize },
      uTileM: { value: MACRO_TILE_METRES },
      uSeed: { value: (SEED_MACRO % 65536) / 65536 },
    };
    const macroRt = this.makeTarget(mSize, THREE.NoColorSpace, THREE.RepeatWrapping);
    const macroNrmRt = this.makeTarget(mSize, THREE.NoColorSpace, THREE.RepeatWrapping);
    this.bake(MACRO_FRAG, macroUniforms, macroRt, { SF_PASS: 0 });
    this.bake(MACRO_FRAG, macroUniforms, macroNrmRt, { SF_PASS: 1 });

    const set: MacroHullTextureSet = {
      detail: detailRt.texture,
      normal: normalRt.texture,
      surface: surfaceRt.texture,
      macro: macroRt.texture,
      macroNormal: macroNrmRt.texture,
      tileMetres: HULL_TILE_METRES,
      macroTileMetres: MACRO_TILE_METRES,
      dispose: () => {
        detailRt.dispose();
        normalRt.dispose();
        surfaceRt.dispose();
        macroRt.dispose();
        macroNrmRt.dispose();
      },
    };
    this.hullSet = set;
    return set;
  }

  // -------------------------------------------------------------------------
  // Sprites
  // -------------------------------------------------------------------------

  /**
   * Radial soft sprite: white RGB with the shape carried entirely in alpha, so
   * it works for additive glows, premultiplied blends and as a plain mask.
   *
   * Deliberately a `CanvasTexture`: `particles.ts` draws this into its own 2x2
   * atlas with `drawImage`, which needs a real `CanvasImageSource`.
   */
  soft(size: number = SOFT_DEFAULT): THREE.Texture {
    const s = Math.max(8, Math.floor(size));
    const hit = this.softCache.get(s);
    if (hit) return hit;

    const { ctx, canvas } = this.canvas2d(s, s);
    const img = ctx.createImageData(s, s);
    const px = img.data;
    // Normalisation so the profile is exactly 0 at r = 1 with no clipped shelf.
    const k = 4.2;
    const base = Math.exp(-k);
    for (let j = 0; j < s; j++) {
      const v = ((j + 0.5) / s) * 2 - 1;
      for (let i = 0; i < s; i++) {
        const u = ((i + 0.5) / s) * 2 - 1;
        const r = Math.sqrt(u * u + v * v);
        // Gaussian core plus a wide, faint skirt. The skirt is what makes a
        // cloud of these read as volume instead of a field of dots.
        const core = Math.max(0, (Math.exp(-r * r * k) - base) / (1 - base));
        const skirt = Math.max(0, 1 - r) * Math.max(0, 1 - r) * 0.30;
        let a = Math.min(1, core * 0.86 + skirt);
        // Hard-kill the outermost texels: bilinear + mips must not leak.
        a *= Math.min(1, Math.min(i, Math.min(j, Math.min(s - 1 - i, s - 1 - j))) / 3);
        const o = (j * s + i) * 4;
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
        px[o + 3] = byte(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;         // a mask, not colour
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.aniso;
    tex.needsUpdate = true;
    this.softCache.set(s, tex);
    this.cpuTextures.push(tex);
    return tex;
  }

  /**
   * Star point sprite: a very tight core, a broad halo and four diffraction
   * spikes with a fainter secondary pair at 45 degrees. Shape is in alpha and
   * RGB is white, so `backdrop.ts`'s `t.a * max(t.rgb)` reduces to the alpha.
   */
  starSprite(size: number = STAR_DEFAULT): THREE.Texture {
    const s = Math.max(16, Math.floor(size));
    const hit = this.starCache.get(s);
    if (hit) return hit;

    const { ctx, canvas } = this.canvas2d(s, s);
    const img = ctx.createImageData(s, s);
    const px = img.data;
    const inv = Math.SQRT1_2;
    for (let j = 0; j < s; j++) {
      const v = ((j + 0.5) / s) * 2 - 1;
      for (let i = 0; i < s; i++) {
        const u = ((i + 0.5) / s) * 2 - 1;
        const r = Math.sqrt(u * u + v * v);

        const core = Math.exp(-r * r * 320);
        const halo = 0.42 * Math.exp(-r * r * 34) + 0.13 * Math.exp(-r * 8.5);
        // A spike is a product of a very tight falloff across the spike and a
        // slow one along it — the same separable form a real aperture gives.
        const spikeH = Math.exp(-Math.abs(u) * 150) * Math.exp(-Math.abs(v) * 4.4);
        const spikeV = Math.exp(-Math.abs(v) * 150) * Math.exp(-Math.abs(u) * 4.4);
        const du = (u + v) * inv;
        const dv = (u - v) * inv;
        const spikeD = (Math.exp(-Math.abs(du) * 210) * Math.exp(-Math.abs(dv) * 6.5)
          + Math.exp(-Math.abs(dv) * 210) * Math.exp(-Math.abs(du) * 6.5)) * 0.32;

        let a = core + halo + (spikeH + spikeV) * 0.62 + spikeD;
        // Window the whole sprite to zero at the rim so points never show a box.
        a *= Math.max(0, 1 - Math.pow(Math.min(1, r), 3));
        a *= Math.min(1, Math.min(i, Math.min(j, Math.min(s - 1 - i, s - 1 - j))) / 2);

        const o = (j * s + i) * 4;
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
        px[o + 3] = byte(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.aniso;
    tex.needsUpdate = true;
    this.starCache.set(s, tex);
    this.cpuTextures.push(tex);
    return tex;
  }

  /**
   * Explosion sprite sheet, `frames` x `frames` cells, laid out left-to-right
   * then bottom-to-top (frame 0 at uv 0,0) exactly as `particles.ts` indexes it.
   *
   * Colour is sRGB-encoded by the render target's internal format; alpha is
   * linear and falls to zero inside each cell.
   */
  fireSheet(frames: number = FIRE_FRAMES_DEFAULT, size: number = FIRE_SIZE_DEFAULT): THREE.Texture {
    const f = Math.max(1, Math.floor(frames));
    const s = Math.max(f * 16, Math.floor(size));
    const key = `${f}x${s}`;
    const hit = this.fireCache.get(key);
    if (hit) return hit;

    const rt = this.makeTarget(s, THREE.SRGBColorSpace, THREE.ClampToEdgeWrapping);
    this.bake(
      FIRE_FRAG,
      { uDim: { value: f }, uSeed: { value: (SEED_FIRE % 65536) / 65536 } },
      rt,
      null,
    );
    this.fireCache.set(key, rt.texture);
    return rt.texture;
  }

  /**
   * Engine plume ramp: a 1D lookup from nozzle (t = 0) to tail (t = 1).
   *
   * RGB is a cooling blackbody-ish curve that stays close to neutral so faction
   * colour can tint it, and alpha is the opacity envelope: a near-instant rise
   * at the throat, three decaying shock diamonds, then a long exponential tail.
   * Stored as sRGB bytes because we are filling the storage ourselves.
   */
  plumeRamp(): THREE.Texture {
    if (this.plumeTex) return this.plumeTex;

    const n = PLUME_SIZE;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;

      // Shock diamonds: three bright compressions, each weaker than the last.
      const shock = 1 + 0.42 * Math.exp(-t * 5.5) * Math.pow(Math.max(0, Math.sin(t * Math.PI * 9)), 2);
      // Intensity: blown out at the throat, exponential decay down the plume.
      const inten = Math.exp(-t * 3.1) * shock;
      // Colour: white-hot core cooling to the faction tint carrier. Kept
      // desaturated on purpose; the tint comes from the material, not here.
      const warm = Math.exp(-t * 6.0);
      const rL = inten * (0.86 + 0.14 * warm);
      const gL = inten * (0.86 + 0.06 * warm);
      const bL = inten * (0.90 - 0.04 * warm);
      // Opacity: rises over the first 2% (the throat is optically thick almost
      // immediately), then a soft tail forced to exactly zero at t = 1.
      const rise = Math.min(1, t / 0.02);
      const tail = Math.pow(Math.max(0, 1 - t), 1.7);
      const a = rise * tail * (0.35 + 0.65 * Math.exp(-t * 2.4));

      const o = i * 4;
      data[o] = srgbByte(rL);
      data[o + 1] = srgbByte(gL);
      data[o + 2] = srgbByte(bL);
      data[o + 3] = byte(a * 255);
    }

    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;       // colour, so it decodes on read
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;                 // a 1D ramp must not be mipped
    tex.needsUpdate = true;
    this.plumeTex = tex;
    this.cpuTextures.push(tex);
    return tex;
  }

  /**
   * Blue-noise tile, generated with Ulichney's void-and-cluster.
   *
   * Why not white noise: dither patterns are judged by their spectrum, not
   * their histogram. White noise clumps, and clumps in a dither become visible
   * blotches exactly where volumetrics are smoothest. Void-and-cluster produces
   * a high-pass spectrum, so the error lands where the eye is least sensitive.
   *
   * R holds the field; G, B and A hold the same field shifted by mutually prime
   * offsets, which decorrelates the channels cheaply enough to be worth doing.
   * Sampled with `NearestFilter` — filtering blue noise destroys the property
   * that makes it blue.
   */
  blueNoise(size: number = NOISE_DEFAULT): THREE.Texture {
    const s = Math.max(8, Math.min(NOISE_MAX, Math.floor(size)));
    const hit = this.noiseCache.get(s);
    if (hit) return hit;

    const rank = this.voidAndCluster(s);
    const n = s * s;
    const data = new Uint8Array(n * 4);
    const off = [
      [0, 0],
      [17, 29],
      [37, 11],
      [5, 43],
    ];
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const o = (y * s + x) * 4;
        for (let c = 0; c < 4; c++) {
          const sx = (x + off[c][0]) % s;
          const sy = (y + off[c][1]) % s;
          // +0.5 centres each level in its bucket, so the dither is unbiased.
          data[o + c] = byte(((rank[sy * s + sx] + 0.5) / n) * 255);
        }
      }
    }

    const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.noiseCache.set(s, tex);
    this.cpuTextures.push(tex);
    return tex;
  }

  /**
   * Destroy every texture, render target and bake resource this factory owns.
   * Consumers holding references must drop them first; nothing here is
   * reference counted.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const rt of this.targets) rt.dispose();
    this.targets.length = 0;
    for (const t of this.cpuTextures) t.dispose();
    this.cpuTextures.length = 0;

    this.hullSet = null;
    this.plumeTex = null;
    this.softCache.clear();
    this.starCache.clear();
    this.noiseCache.clear();
    this.fireCache.clear();

    if (this.bakeMesh && this.bakeScene) this.bakeScene.remove(this.bakeMesh);
    if (this.bakeGeo) this.bakeGeo.dispose();
    const mat = this.bakeMesh?.material;
    if (mat && !Array.isArray(mat)) mat.dispose();
    this.bakeMesh = null;
    this.bakeGeo = null;
    this.bakeScene = null;
  }

  // -------------------------------------------------------------------------
  // Internals — GPU bake
  // -------------------------------------------------------------------------

  /** Allocate a square 8-bit render target set up for sampling as a map. */
  private makeTarget(
    size: number,
    colorSpace: THREE.ColorSpace,
    wrap: THREE.Wrapping,
  ): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace,
      wrapS: wrap,
      wrapT: wrap,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      // Render-target textures default to generateMipmaps = false. three only
      // calls updateRenderTargetMipmap() when this flag is set, so without it
      // the maps would sample mip 0 at every distance and sizzle.
      generateMipmaps: true,
      anisotropy: this.aniso,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.needsUpdate = true;
    this.targets.push(rt);
    return rt;
  }

  /**
   * Draw one fullscreen shader into `rt`.
   *
   * Renderer state is saved and restored around the draw: render target, clear
   * colour, clear alpha and `autoClear`. Nothing else is touched — the bake
   * materials are raw `ShaderMaterial`s with no tone mapping or colour space
   * chunk, so `gl_FragColor` reaches the attachment unmodified.
   */
  private bake(
    fragment: string,
    uniforms: Record<string, THREE.IUniform>,
    rt: THREE.WebGLRenderTarget,
    defines: Record<string, number> | null,
  ): void {
    const renderer = this.renderer;

    if (!this.bakeScene) {
      this.bakeScene = new THREE.Scene();
      this.bakeGeo = new THREE.PlaneGeometry(2, 2);
      this.bakeMesh = new THREE.Mesh(this.bakeGeo, new THREE.MeshBasicMaterial());
      this.bakeMesh.frustumCulled = false;
      this.bakeScene.add(this.bakeMesh);
    }
    const mesh = this.bakeMesh as THREE.Mesh;
    const scene = this.bakeScene;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: BAKE_VERT,
      fragmentShader: fragment,
      defines: defines ?? {},
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const prevMat = mesh.material;
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this.savedClear);

    mesh.material = material;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.render(scene, this.bakeCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.savedClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    mesh.material = prevMat;

    material.dispose();
  }

  // -------------------------------------------------------------------------
  // Internals — CPU generation
  // -------------------------------------------------------------------------

  /** Create a 2D canvas, throwing loudly if the context is unavailable. */
  private canvas2d(w: number, h: number): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('textures: 2D canvas unavailable');
    return { ctx, canvas };
  }

  /**
   * Void-and-cluster ordering (Ulichney 1993), returning a rank in [0, n) per
   * texel — the threshold level at which that texel turns on.
   *
   * The energy field is the binary pattern convolved with a wrapped Gaussian,
   * maintained incrementally: toggling one texel only touches a small window,
   * so each step is a full scan for the extreme plus a tiny kernel update.
   *
   * Note the second half needs no special case. For a symmetric kernel the sum
   * over ALL texels is a constant S, so the energy of the zeros is S minus the
   * energy of the ones; "tightest cluster of zeros" and "largest void" are
   * therefore the same query, and phase 3 simply runs to the end.
   */
  private voidAndCluster(size: number): Int32Array {
    const n = size * size;
    const bin = new Uint8Array(n);
    const proto = new Uint8Array(n);
    const energy = new Float32Array(n);
    const rank = new Int32Array(n);

    // Truncated Gaussian, sigma 1.9, radius 3 sigma. Wider does not measurably
    // improve the spectrum and costs quadratically.
    const R = 6;
    const sigma = 1.9;
    const kw = R * 2 + 1;
    const kernel = new Float32Array(kw * kw);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        kernel[(dy + R) * kw + (dx + R)] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      }
    }

    const toggle = (pos: number, sign: number): void => {
      const px = pos % size;
      const py = (pos / size) | 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = (py + dy + size) % size;
        const row = yy * size;
        const krow = (dy + R) * kw;
        for (let dx = -R; dx <= R; dx++) {
          const xx = (px + dx + size) % size;
          energy[row + xx] += sign * kernel[krow + dx + R];
        }
      }
    };

    const rebuild = (): void => {
      energy.fill(0);
      for (let i = 0; i < n; i++) if (bin[i] === 1) toggle(i, 1);
    };

    /** Tightest cluster: the "1" sitting in the highest energy. */
    const tightest = (): number => {
      let best = -1;
      let bestE = -Infinity;
      for (let i = 0; i < n; i++) {
        if (bin[i] === 1 && energy[i] > bestE) {
          bestE = energy[i];
          best = i;
        }
      }
      return best;
    };

    /** Largest void: the "0" sitting in the lowest energy. */
    const largestVoid = (): number => {
      let best = -1;
      let bestE = Infinity;
      for (let i = 0; i < n; i++) {
        if (bin[i] === 0 && energy[i] < bestE) {
          bestE = energy[i];
          best = i;
        }
      }
      return best;
    };

    // --- seed: ~10% ones, from the deterministic project Rng -----------------
    const rng = new Rng(SEED_NOISE ^ (size * 2654435761));
    const ones = Math.max(1, Math.round(n * 0.1));
    let placed = 0;
    while (placed < ones) {
      const p = rng.int(0, n - 1);
      if (bin[p] === 0) {
        bin[p] = 1;
        placed++;
      }
    }
    rebuild();

    // --- phase 1: relax the seed into a well-spread prototype ----------------
    // Move the tightest cluster into the largest void until the two coincide.
    const guard = ones * 6;
    for (let it = 0; it < guard; it++) {
      const t = tightest();
      if (t < 0) break;
      bin[t] = 0;
      toggle(t, -1);
      const v = largestVoid();
      if (v < 0 || v === t) {
        bin[t] = 1;
        toggle(t, 1);
        break;
      }
      bin[v] = 1;
      toggle(v, 1);
    }
    proto.set(bin);

    // --- phase 2: rank the prototype downwards, ones-1 .. 0 ------------------
    for (let r = ones - 1; r >= 0; r--) {
      const t = tightest();
      if (t < 0) break;
      bin[t] = 0;
      toggle(t, -1);
      rank[t] = r;
    }

    // --- phase 3: rank upwards from the prototype, ones .. n-1 ---------------
    bin.set(proto);
    rebuild();
    for (let r = ones; r < n; r++) {
      const v = largestVoid();
      if (v < 0) break;
      bin[v] = 1;
      toggle(v, 1);
      rank[v] = r;
    }

    return rank;
  }
}

// ---------------------------------------------------------------------------
// Memoised singleton
// ---------------------------------------------------------------------------

let cached: ProceduralTextures | null = null;
let cachedRenderer: THREE.WebGLRenderer | null = null;

/**
 * Get the shared texture factory for `renderer`.
 *
 * Memoised, so every subsystem that asks receives the same instance and the
 * same GPU textures. Passing a different renderer (a context loss rebuild, a
 * second viewport) drops the old factory and bakes a fresh set, because GPU
 * resources cannot cross WebGL contexts.
 */
export function createTextures(renderer: THREE.WebGLRenderer): ProceduralTextures {
  if (cached && cachedRenderer === renderer) return cached;
  if (cached) cached.dispose();
  cached = new ProceduralTextures(renderer);
  cachedRenderer = renderer;
  return cached;
}
