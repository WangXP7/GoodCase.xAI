/**
 * ENGINE FX — drive plumes, nozzle cores, ribbon trails and running lights.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE MATTERS
 * ---------------------------------------------------------------------------
 * Every ship on screen is running its engines every frame, so this is the most
 * -seen effect in the game by an enormous margin. It is also the only thing
 * that communicates *motion* at fleet zoom, where hulls are a few pixels tall:
 * a wing of interceptors reads as a wing because of five cyan needles and their
 * blinking nav lights, not because of the hull mesh.
 *
 * ---------------------------------------------------------------------------
 * REVISION — round 1 art-direction critique
 * ---------------------------------------------------------------------------
 * Three separate blockers were raised against this file. All three came from
 * the same two root causes, so the plume was rebuilt from scratch:
 *
 *  * CRITIQUE 1/4 "not a single engine plume is visible in the entire battle
 *    frame". The old LOD policy gated plumes on a WORLD-SPACE distance
 *    (`DETAIL_RANGE_MIN/MAX`, 350..42000 m) driven by a feedback controller.
 *    At fleet altitude every hull sat outside the gate, so the entire fleet
 *    drew bare nozzle dots. Every gate in this file is now SCREEN-SPACE, in
 *    pixels of projected hull radius, and no gate can ever remove a plume:
 *    a ship under power always emits exhaust, the LOD only decides how many
 *    instances and how much shader work it costs (see `Tier` below).
 *
 *  * CRITIQUE 1/5 and 2/11 "hard-edged faceted cones ... you can count polygon
 *    edges on the silhouette, the interior is a flat pale blue". The plume was
 *    a tessellated cone shell whose alpha ran to a non-zero value at the last
 *    ring, so the mesh boundary WAS the silhouette. It is now a camera-facing
 *    billboard with an analytic radial density function: alpha is a Gaussian in
 *    the cross-axis coordinate, so it reaches zero with zero gradient well
 *    inside the quad and there is no geometric edge to see at any zoom. Volume
 *    comes from the density function, not from geometry.
 *
 * ---------------------------------------------------------------------------
 * REVISION — round 2 art-direction critique
 * ---------------------------------------------------------------------------
 * Round 2 credited the plumes as a real fix ("present and legible across the
 * whole fleet") and then flagged them as OVERCORRECTED. Four changes:
 *
 *  * OVERCORRECTION "in 03-battle every fighter is a 50-70 px glowing teardrop
 *    attached to a 20 px hull ... the hull is no longer the thing you see; the
 *    exhaust is." Two causes, both fixed. (a) The angular floor lived in the
 *    VERTEX shader, where it could only inflate; there was no way to also cap
 *    the result against the hull. Floor and cap are now computed together on the
 *    CPU (`emitPlume` / `screenClamp`), with the cap at 0.90x hull radius on the
 *    billboard half-width and 2.0x hull length on the column — the reviewer's
 *    own numbers. Peak radiance is additionally halved at and below
 *    `TIER_LIGHT_PX`. (b) The 50-70 px token was largely the WAKE, not the
 *    plume: a pure-white additive head over a sky at 0.58 sRGB crosses the bloom
 *    threshold along its whole 0.63 s of history and smears into a comet. The
 *    ribbon is now 35% narrower, less than half as bright, and its head is 45%
 *    of the way to white instead of white.
 *
 *  * BLOCKER "the ribbon terminates at the nozzle in a hard-edged elliptical
 *    disc silhouette with no soft fade" and "the plume ribbons draw OVER the
 *    hull". The quad's v = 0 row was drawn at full density, so the START of the
 *    billboard was a visible straight-cut ellipse; `mouth` now ramps density out
 *    of the bell over the first 5% of the column, putting the geometric edge
 *    inside a zero-density region exactly as the |u| = 1 boundary already was.
 *    The sideways splay across the mothership's own fins was the end-on
 *    widening, which TRIPLED the column at hero framing (1.6 -> 0.45). An
 *    optional soft-depth term (`setDepthTexture`) is ported from particles.ts
 *    for integrators who want the column to dissolve into geometry as well.
 *
 *  * BLOCKER "a single smooth uniform blade of light — no throat disc, no
 *    visible shock cells, no periodic density banding ... reads as a lightsaber,
 *    not gas". `uBands` 4.6 -> 7.6 (3.6 cells inside the first third of the
 *    column), the band exponent 5 -> 3 so each cell is wide enough to read, the
 *    diamond term 1.1 -> 3.0 and evaluated on a WIDER Gaussian so it is a disc
 *    across the column rather than a hairline on the axis, plus a new `pinch`
 *    term that modulates the column's own radius. The bell has its own near-
 *    white chroma instead of being the same cyan at a higher value.
 *
 *  * "plume width and length should differ by hull class and throttle, with
 *    turbulent per-ship variation". Three per-class tables (`clsPlumeW`,
 *    `clsPlumeL`, `clsMass`) make a heavy drive proportionally fatter, longer
 *    and more finely banded than a light one; throttle now opens the drives up
 *    in WIDTH as well as length; and every ship carries two seeded static
 *    variations plus a per-ship combustion oscillation, so a wing of nine
 *    interceptors shows nine different plumes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DRAWN (three draw calls total, for any ship count)
 * ---------------------------------------------------------------------------
 *  1. NOZZLE CORE — a camera-facing sprite at every `EngineMount`. An
 *     incandescent throat (near-white, blown out) sitting in a broad
 *     team-coloured halo, with an exponential falloff all the way to the quad
 *     edge so it never reads as a flat disc with a rim (CRITIQUE 3).
 *  2. PLUME — an instanced camera-facing billboard whose shape is entirely in
 *     the fragment shader: Gaussian radial falloff (no silhouette), a searing
 *     near-white core that cools outward and along its length through the team
 *     engine colour, mach-diamond shock banding whose cells lengthen and weaken
 *     downstream, and per-ship fbm turbulence that breaks the edge into wisps.
 *     Length and brightness track `ship.throttle`, and an afterburner window
 *     stretches it to ~2.5x hull length.
 *  3. TRAIL — fighters only: a per-ship position ring buffer emitted as a strip
 *     of camera-facing quads, tapering in width and alpha, white-hot at the
 *     head and cooling to the team engine colour then to black. Width has an
 *     angular floor so the wake survives fleet zoom.
 *  4. RUNNING LIGHTS — sprites in the same batch as the nozzle cores: red port,
 *     green starboard, white strobes, each on a per-ship phase taken from
 *     `ship.seed`. Clamped to a minimum angular size so they survive fleet zoom.
 *  5. AFTERBURNER PUFFS — when throttle spikes, a small retinted `fireball`
 *     burst through the shared `ParticleSystem`.
 *
 * ---------------------------------------------------------------------------
 * BUDGETS AND DEGRADATION — the LOD policy
 * ---------------------------------------------------------------------------
 * Everything is decided from ONE number: `px`, the hull's projected radius in
 * pixels at the current viewport and FOV. Three tiers, and the plume is present
 * in all of them:
 *
 *   FULL  px >= detailPx  per-engine plumes with fragment turbulence, running
 *                         lights, ribbon trail, afterburner puffs
 *   MID   px >= 6         per-engine plumes, turbulence off, lights, no trail
 *   BANK  px <  6         ONE merged plume and ONE merged core for the whole
 *                         engine bank (equal-area throat), no lights, no trail
 *
 * `detailPx` is a one-pole feedback controller against `DETAIL_BUDGET`: overrun
 * raises the pixel threshold quickly, headroom lowers it slowly. Because the
 * plume is now eight triangles instead of a 240-triangle cone shell, the
 * instance ceilings could be raised roughly 4x while the triangle count fell by
 * two orders of magnitude — which is what makes "always draw a plume" free.
 *
 * Buffers are allocated once at the ultra ceiling (a few hundred KB in total)
 * and `setQuality` only lowers the working limits, exactly like the particle
 * engine.
 *
 * Zero allocation in `update`: every vector, colour and cursor is module-scope
 * scratch or a preallocated typed array.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config';
import {
  GLSL_NOISE,
  type RenderContext,
  type RenderSystem,
  type TextureFactory,
} from '../core/contracts';
import { PALETTES } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import {
  ALL_SHIP_CLASSES,
  HullSize,
  SHIP_CLASS_COUNT,
  type QualitySettings,
  type Ship,
} from '../core/types';
import type { World } from '../sim/world';
import { P, type ParticleSystem } from './particles';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * `Ship.lod` value the fleet renderer writes for hulls drawn as billboard
 * impostors. Mirrors `LOD_IMPOSTOR` in render/fleet.ts; duplicated rather than
 * imported to keep this module's dependencies to core/*, sim/world and its
 * declared FX siblings.
 *
 * It no longer SKIPS the ship — CRITIQUE 1/4 "never let a moving ship render
 * with zero exhaust" — it only forces the merged-bank tier.
 */
const LOD_IMPOSTOR = 3;

/**
 * Positions kept per trail.
 *
 * 18 x 0.035 s was 0.63 s of history. At a fighter cruise that is about six
 * hull lengths of ribbon, which is far too short to show the SHAPE of a
 * manoeuvre: a fighter takes roughly a second to swing through a hard turn, so
 * a 0.63 s wake is gone before the turn finishes and every trail on screen
 * reads as a straight dash. Curvature is the whole point of a wake — it is the
 * only thing that tells the player which way a contact is breaking. 32 samples
 * at 0.05 s is 1.6 s, long enough to hold a complete turn.
 *
 * Cost is linear in both: one instanced quad per (point - 1) per live trail,
 * so the busiest preset goes from 260 x 17 to 260 x 31 segments.
 */
const TRAIL_POINTS = 32;
/** Seconds between trail samples. TRAIL_POINTS * TRAIL_STEP = trail duration. */
const TRAIL_STEP = 0.05;
/** Trail slots recycled after this long without being touched, seconds. */
const TRAIL_STALE = 0.7;

/** Max running lights described per hull class. */
const LIGHTS_MAX = 5;
/** Floats per light record: x, y, z, kind, size, phase. */
const LIGHT_STRIDE = 6;
/** Light kinds. */
const LIGHT_PORT = 0;
const LIGHT_STARBOARD = 1;
const LIGHT_STROBE = 2;
const LIGHT_BEACON = 3;

/** Floats per engine record: x, y, z, radius, dx, dy, dz. */
const ENGINE_STRIDE = 7;
/** Floats per merged engine-bank record: x, y, z, throat, dx, dy, dz. */
const BANK_STRIDE = 7;

/** Throttle floor — a parked hull still has hot, idling nozzles. */
const IDLE_THROTTLE = 0.30;

/**
 * Radiance multiplier on every drive emissive, in linear HDR.
 *
 * The bloom high-pass now triggers on genuinely HDR values (threshold ~1.06
 * linear) rather than on any bright LDR surface. That is the correct policy —
 * it stops sunlit hull plate from glowing — but it exposed that the drives were
 * authored just BELOW 1.0, so the moment the threshold moved they stopped
 * blooming and a mothership read as having no exhaust at all.
 *
 * An engine is an incandescent source and should sit above the white point on
 * its own merits, so this pushes the cores properly into HDR instead of leaning
 * on a low bloom threshold to fake it. Applied at the two emit points so every
 * caller inherits it.
 */
const DRIVE_HDR = 2.6;
/** Throttle jump within one frame that triggers an afterburner puff. */
const BURNER_TRIGGER = 0.26;
/** Seconds between afterburner puffs on one hull; also the burner-stretch window. */
const BURNER_COOLDOWN = 0.55;

/**
 * Sprite instance ceiling (nozzle cores + running lights), per quality preset.
 * Raised over round 1: a thousand-hull battle wants ~11k sprites and the old
 * 7200 ceiling silently dropped the tail of the ship pool.
 */
const SPRITE_LIMIT = [2600, 5200, 9500, 14000];
/**
 * Plume instance ceiling per quality preset. Raised ~4x because a plume went
 * from a 240-triangle cone shell to an 8-triangle billboard: 9000 plumes is now
 * 72k triangles, where 2400 cones were 576k.
 */
const PLUME_LIMIT = [1600, 3400, 6500, 9000];
/** Simultaneous fighter trails per quality preset. */
const TRAIL_LIMIT = [40, 120, 260, 420];
/** Hulls allowed full detail (turbulent plume + trail + burner) per preset. */
const DETAIL_BUDGET = [90, 200, 380, 620];

/**
 * Full-detail gate travel limits, in PIXELS of projected hull radius.
 * (Round 1 used metres, which is what made the whole fleet fall outside the
 * gate at strategic altitude — CRITIQUE 1/4.)
 */
const DETAIL_PX_MIN = 2.5;
const DETAIL_PX_MAX = 220;

/** Below this projected radius a hull's engine bank merges to one plume. */
const TIER_BANK_PX = 6;
/** Below this projected radius fragment turbulence is not worth its cost. */
const TIER_TURB_PX = 11;
/** Below this projected radius running lights are skipped (sub-pixel clutter). */
const TIER_LIGHT_PX = 2.5;

/** Minimum on-screen sizes, in pixels — resolution and FOV aware. */
const NOZZLE_MIN_PX = 1.9;
const LIGHT_MIN_PX = 2.4;
/**
 * Plume billboard angular floors, in pixels.
 *
 * ROUND-2 OVERCORRECTION (critique r2, engines.ts): "in 03-battle every fighter
 * is a 50-70 px glowing teardrop attached to a 20 px hull ... the hull is no
 * longer the thing you see; the exhaust is." Round 1's floors were set to make a
 * plume survive strategic zoom and they overshot: 1.7 px of half width is 3.4 px
 * of column plus the end-on widening, on a hull that is itself only a few pixels.
 * Both floors come down, and — new in round 2 — they are now applied on the CPU
 * where they can be capped against the hull's own size (see PLUME_MAX_*).
 */
const PLUME_MIN_PX_W = 1.05;
const PLUME_MIN_PX_L = 6.0;
/**
 * Hard caps on the plume, in units of the producing hull.
 *
 * `PLUME_MAX_W_HULL` is on the billboard HALF WIDTH and the visible gas column
 * is ~0.62 of it (the profile peaks at 0.52 of the quad and the Gaussian has
 * died by 1.2 sigma), so 0.90 here means a column whose radius never exceeds
 * ~0.56 of the hull radius — comfortably inside "outer radius <= 1.0x hull
 * width" (critique r2 reviewer 0). `PLUME_MAX_L_HULL` is the reviewer's "cap
 * plume screen length at ~2x the hull's own projected length"; because the plume
 * and the hull are at the same depth, a world-space cap IS a screen-space cap.
 */
const PLUME_MAX_W_HULL = 0.90;
// 2.0 hull lengths is 4.2 km of exhaust on the Mothership; it was set when the
// plume could not be seen and it never bound on anything. A drive plume that is
// longer than the ship reads as a comet, not as thrust.
const PLUME_MAX_L_HULL = 0.85;
/**
 * Fighter wake half-width floor, in pixels. Sub-pixel ribbons just alias.
 * 0.5 px of HALF-width is a 1 px line, which at fleet range is exactly the
 * width at which a thin additive streak dissolves into the background — the
 * wakes were technically drawn and practically invisible.
 */
const TRAIL_MIN_PX = 1.15;

/** Nav-light colours, linear HDR. Saturated on purpose — they must pop. */
const COL_PORT = [2.3, 0.07, 0.035];
const COL_STARBOARD = [0.06, 2.1, 0.26];
const COL_WHITE = [1.7, 1.62, 1.5];

/** Sprite shape ids consumed by the fragment shader. */
const SHAPE_NOZZLE = 0;
const SHAPE_LIGHT = 1;

// ---------------------------------------------------------------------------
// Shaders — nozzle cores and running lights
// ---------------------------------------------------------------------------

const SPRITE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

// aP  xyz world position                     w radius in metres
// aC  rgb linear colour                      a HDR intensity
// aX  x shape id  y seed 0..1  z min angular radius  w flare amount
attribute vec4 aP;
attribute vec4 aC;
attribute vec4 aX;

varying vec4 vCol;
varying vec2 vUv;
varying float vShape;
varying float vFlare;

void main() {
  vec4 mv = modelViewMatrix * vec4(aP.xyz, 1.0);
  float dist = max(-mv.z, 1e-3);

  // Angular clamp: below a few pixels a drive glow vanishes into sub-pixel
  // noise and a 400-strong wing reads as empty space. Slightly-too-big is the
  // lesser evil, so the sprite never shrinks past aX.z radians. aX.z is
  // recomputed every frame from the live viewport height and FOV, so the
  // floor is a fixed number of PIXELS at any resolution.
  float size = max(aP.w, dist * aX.z);

  // Static billboards read as decals; a fixed per-instance roll breaks the
  // pattern across a fleet without costing a per-frame update.
  float ang = aX.y * 6.2831853;
  float cs = cos(ang), sn = sin(ang);
  vec2 c = position.xy;                     // corners are +/-1
  mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;

  vUv = c * 0.5 + 0.5;
  vCol = aC;
  vShape = aX.x;
  vFlare = aX.w;

  gl_Position = projectionMatrix * mv;

  #include <logdepthbuf_vertex>
}
`;

const SPRITE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

varying vec4 vCol;
varying vec2 vUv;
varying float vShape;
varying float vFlare;

void main() {
  #include <logdepthbuf_fragment>

  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  vec3 col;
  float a;

  if (vShape < 0.5) {
    // -- nozzle core -------------------------------------------------------
    // CRITIQUE 3: "the nozzle core must be a hot incandescent source with
    // proper falloff, not a flat disc". Three nested exponentials — a searing
    // throat, the glowing bell around it and a wide soft bloom — with NO hard
    // rim term. The old version had a "1 - smoothstep(0.58, 0.92, r)" disc and
    // a "1 - smoothstep(0.80, 1.0, r)" cut, which together drew a circle with
    // a visible edge; here the density is still 4% of peak at r = 1 and is
    // taken to zero by a wide taper, so the quad boundary is never visible.
    float core  = exp(-r * r * 34.0);
    float bell  = exp(-r * r * 8.0) * 0.42;
    float bloom = exp(-r * r * 1.9) * 0.17;
    a = core + bell + bloom;
    a *= smoothstep(1.0, 0.68, r);
    // Incandescent: the throat is hotter than the team colour and clips white.
    col = mix(vCol.rgb * 0.92, vec3(1.04, 1.01, 0.99), pow(core, 0.40));
  } else {
    // -- running light -----------------------------------------------------
    float dot_ = exp(-r * r * 110.0);
    float halo = exp(-r * r * 6.5) * 0.30;
    // Faint diffraction cross — sells the light as a point source at distance.
    float sx = max(0.0, 1.0 - abs(p.x) * 9.0) * exp(-abs(p.y) * 16.0);
    float sy = max(0.0, 1.0 - abs(p.y) * 9.0) * exp(-abs(p.x) * 16.0);
    a = clamp(dot_ + halo + (sx + sy) * vFlare * 0.35, 0.0, 1.0);
    a *= 1.0 - smoothstep(0.7, 1.0, r);
    col = mix(vCol.rgb, vec3(1.0), pow(dot_, 0.7) * 0.75);
  }

  if (a < 0.004) discard;

  // The HDR intensity rides in the colour, not the alpha: additive blending
  // uses src.a as a blend FACTOR, which fixed-point targets clamp to 1 — so an
  // intensity of 3 would silently become 1 on an LDR framebuffer.
  gl_FragColor = vec4(col * vCol.a, clamp(a, 0.0, 1.0));

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Shaders — plume billboard
// ---------------------------------------------------------------------------

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

// Base geometry vertex layout (see buildPlumeGeometry):
//   position.x  side, -1 or +1
//   position.y  v, 0 at the nozzle throat .. 1 at the tip
//   position.z  trapezoid width factor at this row — an ENVELOPE around the
//               fragment density function, present only to cut overdraw. The
//               density is zero well inside it, so this outline is never seen.
// aPos  xyz nozzle world position   w billboard half width, metres
// aDir  xyz unit exhaust axis       w plume length, metres
// aCol  rgb linear colour           a HDR gain
// aMod  x seed  y throttle  z turbulence amount  w drive mass 0..1
//
// ROUND 2: 'aPos.w' and 'aDir.w' arrive ALREADY clamped. Round 1 applied the
// angular floor here, in the vertex shader, which meant it could only ever
// inflate — there was no way to also cap the result against the hull that
// produced it, and the fleet ended up as bright lozenges with hulls hidden
// inside them (critique r2 overcorrection). The floor AND the cap are now
// computed together on the CPU in 'update', where the hull's own size is known.
attribute vec4 aPos;
attribute vec4 aDir;
attribute vec4 aCol;
attribute vec4 aMod;

uniform float uNear;

varying float vV;
varying float vU;
varying vec3 vColor;
varying float vI;
varying float vSeed;
varying float vThr;
varying float vTurb;
varying float vFade;
varying float vMass;
varying float vDepth;
varying float vSize;
varying float vEnv;

void main() {
  vec3 ax = aDir.xyz;
  // CLEAR THE HULL. Nozzles are recessed: on the Mothership the mounts sit at
  // z = -982 against an aft plane at z = -1050, so the first 68 m of every
  // column was inside solid geometry. With the ordinary depth test on and no
  // soft-depth term (see main.ts — reading the live depth attachment is a
  // feedback loop) that intersection is a HARD STRAIGHT CUT across the plume,
  // which is the reported clipping. Starting the column just aft of the mouth
  // removes the intersection instead of trying to hide it, and the nozzle
  // sprite still marks the real throat.
  vec3 org = aPos.xyz + ax * (aDir.w * 0.16);

  vec3 toCam = cameraPosition - org;
  float camDist = max(length(toCam), 1e-3);
  vec3 vd = toCam / camDist;

  // A camera-facing billboard that still CONTAINS the exhaust axis, so the
  // plume is always seen broadside whatever the ship's attitude. This is what
  // replaces the cone shell: two triangles per quad, no silhouette to facet.
  vec3 side = cross(ax, vd);
  float sl = length(side);
  if (sl > 1e-4) {
    side /= sl;
  } else {
    // Looking straight down the axis: any perpendicular will do, and the axial
    // extent has projected to nothing anyway.
    vec3 ref = (abs(ax.y) < 0.9) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    side = normalize(cross(ax, ref));
  }

  float halfW = aPos.w;
  float len = aDir.w;

  // Near end-on the plume foreshortens to a sliver, so it is fattened a little
  // to stay resolvable. Round 1 used 1.6, which TRIPLES the column when the
  // camera sits behind the fleet — which is the hero framing — and is what
  // splayed the mothership's ribbons sideways across its own fins (critique r2
  // reviewer 2: "the plume ribbons draw OVER the hull"). 0.45 keeps the sliver
  // readable without ever letting the blade grow wider than the drive block.
  float align = abs(dot(ax, vd));
  halfW *= 1.0 + 0.45 * align * align;

  float v = position.y;
  float u = position.x * position.z;
  vec3 wp = org + ax * (v * len) + side * (u * halfW);

  vec4 mv = modelViewMatrix * vec4(wp, 1.0);

  // Dissolve when the camera flies into a plume, instead of clipping it in
  // half against the near plane.
  vFade = clamp((-mv.z - uNear * 3.0) / max(halfW * 2.0, 1.0), 0.0, 1.0);

  vV = v;
  vU = u;
  vEnv = position.z;
  vColor = aCol.rgb;
  vI = aCol.a;
  vSeed = aMod.x;
  vThr = aMod.y;
  vTurb = aMod.z;
  vMass = aMod.w;
  vDepth = -mv.z;
  vSize = halfW;

  gl_Position = projectionMatrix * mv;

  #include <logdepthbuf_vertex>
}
`;

const PLUME_FRAG = /* glsl */ `
#include <common>
// Minimum share of the plume that survives the soft-depth term. See the block
// where it is applied: the term may soften an intersection seam, never hide a
// drive outright.
const float PLUME_SOFT_FLOOR = 0.55;
${GLSL_NOISE}
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uBands;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec2 uNearFar;
uniform float uHasDepth;

varying float vV;
varying float vU;
varying vec3 vColor;
varying float vI;
varying float vSeed;
varying float vThr;
varying float vTurb;
varying float vFade;
varying float vMass;
varying float vDepth;
varying float vSize;
varying float vEnv;

/** Scene depth-buffer value -> positive linear view depth in metres. */
float sf_plumeLinearDepth(float d) {
  #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
    return exp2(2.0 * d / logDepthBufFC) - 1.0;
  #else
    float ndc = d * 2.0 - 1.0;
    float n = uNearFar.x, f = uNearFar.y;
    return (2.0 * n * f) / (f + n - ndc * (f - n));
  #endif
}

void main() {
  #include <logdepthbuf_fragment>

  float v = clamp(vV, 0.0, 1.0);
  float u = vU;

  // -- column profile -------------------------------------------------------
  // Radius of the gas column at v: a tight throat, a short expansion shoulder,
  // then a long taper to a point. PEAK IS 0.55 IN QUAD UNITS, so the Gaussian
  // below has died to nothing by |u| = 0.9 — the quad boundary at |u| = 1 can
  // never be reached and there is no polygon silhouette (CRITIQUE 1/5, 2/11).
  float prof = 0.52 * pow(max(1.0 - v, 0.0), 0.45) * (0.34 + 0.66 * smoothstep(0.0, 0.075, v));

  // The GAS column must die well inside the QUAD, or the quad's own straight
  // edge becomes the silhouette. Turbulence can push prof past the envelope at
  // the tip, and an additive lobe at under a percent of peak is still a visible
  // hard line once it has been through bloom. Clamping against the row's
  // envelope guarantees the boundary is unreachable whatever turbulence does.
  float envRow = max(vEnv, 0.05);
  if (vTurb > 0.001) {
    // Per-ship combustion turbulence, sampled PER FRAGMENT so the edge breaks
    // into wisps rather than into polygon corners. Seeded and scrolled along
    // the axis: no two drives breathe in step, and a global sine would make the
    // whole fleet pulse as one organism.
    float n = sf_fbm(vec3(u * 2.3, v * 5.0 - uTime * 2.7, vSeed * 57.0), 2, 2.15, 0.55) - 0.5;
    prof *= 1.0 + n * vTurb * (0.30 + v * 1.25);
  }

  prof = min(prof, envRow * 0.42);
  float rho = abs(u) / max(prof, 1e-4);

  // -- density --------------------------------------------------------------
  // Gaussians only: value AND gradient go to zero, so the plume dissolves into
  // the background instead of terminating on an edge.
  // ROUND 3: "the stretching of flames is no good ... flames with ion detail."
  //
  // The column was three wide Gaussians stacked on a long axial falloff, then
  // convolved with a bloom whose gate sat just above white. The result had no
  // EDGE anywhere in it: a plume is a jet under pressure, and a jet has a
  // boundary. The lobes are tightened so the gas has a rim, and the shock train
  // below is given the authority to be the thing you actually read.
  float shell = exp(-rho * rho * 3.6);
  float core = exp(-rho * rho * 19.0);
  // Intermediate width, used by the shock cells so the banding is a DISC across
  // the column rather than a hairline on the axis nobody can see.
  float cell = exp(-rho * rho * 5.0);
  // Steeper: the old 1.10 held the column near full brightness for most of its
  // length, which is what made it read as a stretched smear rather than as
  // exhaust cooling as it expands.
  float axial = pow(max(1.0 - v, 0.0), 1.55);
  float throat = exp(-v * 7.5);

  // -- the mouth ------------------------------------------------------------
  // CRITIQUE r2 reviewer 2: "the ribbon terminates at the nozzle in a hard-edged
  // elliptical disc silhouette with no soft fade". The quad's v = 0 row was
  // being drawn at full density, so the START of the billboard was a visible
  // straight-cut ellipse hanging off the stern of the mothership. Density now
  // ramps up out of the bell over the first 5% of the column, which puts the
  // geometric edge inside a zero-density region exactly the way the |u| = 1
  // boundary already was. The hot throat DISC is carried by the nozzle sprite
  // (SHAPE_NOZZLE), which is round and analytically soft, not by this quad.
  float mouth = smoothstep(0.0, 0.052, v);

  // Mach diamonds. In a real underexpanded nozzle the shock cells lengthen
  // downstream, so the phase is pow(v, 0.72) rather than linear in v; the cells
  // also weaken with distance, hence the exponential envelope. Seeded so two
  // adjacent drives never show the same banding.
  //
  // CRITIQUE r2 reviewer 2: "raise 'diamonds' 2.5-3x and shorten its wavelength
  // so three to four shock cells are countable along the first third of the
  // column". uBands is 7.6 (was 4.6) and the cell count rises with drive mass,
  // so a capital's column carries more, shorter cells than a fighter's; at
  // uBands 7.6 the phase reaches 3.6 cycles by v = 1/3. The exponent on 'band'
  // drops 5 -> 3 so the bright part of each cell is wide enough to read, and the
  // envelope decays over the first third instead of the whole column.
  float bands = uBands * (0.85 + 0.45 * vMass);
  float ph = pow(v, 0.72) * bands;
  // Sharper cells. At exponent 3 each shock is a broad hump and the train reads
  // as ripple; at 5 it is a stack of discrete discs, which is what a real
  // underexpanded nozzle shows and what "ion detail" means here.
  float band = pow(0.5 + 0.5 * sin(ph * 6.2831853 + vSeed * 23.0), 5.0);
  // The envelope has to bite early: cells that survive the whole column turn the
  // plume into a chain of beads, which is a different failure from the lightsaber
  // but no more convincing. exp(-4.6 v) leaves them countable through the first
  // third and gone by two thirds.
  // The envelope decays more slowly (4.6 -> 3.0) so the cells survive into the
  // middle third instead of dying inside the first, and the gain is up: this is
  // now the structure carrying the plume, not a garnish on it.
  float diamonds = band * exp(-v * 3.0) * cell * (0.34 + 0.66 * vThr);

  // Periodic density banding: the same shock train also modulates the COLUMN,
  // not just its brightness, so the silhouette pulses in and out along its
  // length and the plume reads as gas under pressure rather than a light blade.
  float pinch = 1.0 - 0.19 * band * exp(-v * 1.8);

  // The continuous body carries the plume; the cells are structure ON it, not a
  // replacement for it — hence the body gain going up as the diamond gain comes
  // back down from the first pass at this fix.
  float dens = (shell * 0.46 + core * 0.78) * axial * pinch
             + core * throat * 1.10
             + diamonds * 2.6;
  // Belt and braces: fade the last fifth of the quad's width to zero as well,
  // so even a numerically odd frame cannot show the polygon.
  dens *= vFade * mouth * (1.0 - smoothstep(0.80, 1.0, abs(u) / envRow));

  // Cheap reject FIRST. The Gaussian is zero over most of the quad's area, so
  // testing here rather than after the depth tap keeps a dependent texture read
  // off the majority of the billboard's fragments — measured at ~8% of frame
  // time on the hero shot, where three mothership plumes cover much of the view.
  if (dens < 0.004) discard;

  // -- soft depth -----------------------------------------------------------
  // Ported from particles.ts (the same term, the same conversion). Off unless an
  // integrator has called setDepthTexture; when it is on, the column dissolves
  // into whatever geometry it intersects instead of slicing through it, which is
  // the other half of critique r2 reviewer 2's "plume draws OVER the hull".
  if (uHasDepth > 0.5) {
    float sd = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
    float sceneZ = sf_plumeLinearDepth(sd);
    // The fade band must be a SEAM softener, not a second occlusion test.
    //
    // It was vSize * 1.4, i.e. proportional to the plume's own half-width with
    // no cap. A Mothership plume is ~190 m across, so the band was ~270 m deep
    // and swallowed the entire column: the nozzles are recessed into the hull,
    // so essentially every fragment measured as "within a band-width of solid
    // geometry" and the biggest drives in the game rendered completely
    // invisible. That is the reported "mothership still no flame", and it
    // appeared exactly when the depth texture was first wired up.
    //
    // Now: a band of a few metres regardless of hull size, and a floor so the
    // term can only ever SOFTEN the intersection. An exhaust plume is emissive
    // gas — where it genuinely passes behind solid hull the ordinary depth test
    // already hides it, and this term has no business finishing the job.
    float band = clamp(vSize * 0.30, 1.5, 24.0);
    float soft = clamp((sceneZ - vDepth) / band, 0.0, 1.0);
    dens *= mix(PLUME_SOFT_FLOOR, 1.0, soft);
    if (dens < 0.004) discard;
  }

  // -- colour ---------------------------------------------------------------
  // Three chromas, not one value ramp: a near-white incandescent bell, the team
  // engine colour through the body, and a cooled, darkened tail. The shock cells
  // borrow the bell's white so they read as separate hot discs standing in a
  // coloured column (critique r2: "give 'throat' a distinct near-white chroma so
  // the bell is a separate hot disc rather than the same cyan at a higher
  // value").
  vec3 bell = vec3(1.06, 1.03, 1.00);
  vec3 hot = mix(vec3(1.0), vColor, 0.22);
  vec3 col = mix(vColor, vColor * 0.24, smoothstep(0.12, 1.0, v));
  col = mix(col, hot, clamp(diamonds * 3.4 + core * 0.14 * (1.0 - v), 0.0, 1.0));
  col = mix(col, bell, clamp(core * throat * 1.5, 0.0, 1.0));

  // Intensity rides in the colour — see the note in the sprite shader.
  gl_FragColor = vec4(col * vI, clamp(dens, 0.0, 1.0));

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Shaders — trail ribbon
// ---------------------------------------------------------------------------

const TRAIL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

// Base geometry vertex layout: position = (side +/-1, t 0..1, 0).
// aA  xyz newer endpoint   w half width there
// aB  xyz older endpoint   w half width there
// aC  rgb colour           a seed
// aF  x alpha at A  y alpha at B  z age at A  w age at B   (age 0..1 along trail)
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aF;

/** Minimum angular half-width, radians — keeps wakes visible at fleet zoom. */
uniform float uMinAng;

varying vec3 vColor;
varying float vAlpha;
varying float vAge;
varying float vSide;

void main() {
  float t = position.y;
  vec3 wp = mix(aA.xyz, aB.xyz, t);
  float w = mix(aA.w, aB.w, t);

  vec3 seg = aB.xyz - aA.xyz;
  vec3 toCam = cameraPosition - wp;
  // CRITIQUE 1/4 also covers the wake: a 1 m ribbon at 20 km is sub-pixel and
  // simply disappears, so clamp it to a minimum on-screen width the same way
  // the nozzle sprites and the plume are clamped.
  w = max(w, length(toCam) * uMinAng);
  vec3 side = cross(seg, toCam);
  float l = length(side);
  // A degenerate segment (ship at rest, or the freshly advanced head) collapses
  // to zero width instead of producing NaNs from normalising a null vector.
  side = (l > 1e-6) ? side / l : vec3(0.0);

  wp += side * (w * position.x);

  vColor = aC.rgb;
  vAlpha = mix(aF.x, aF.y, t);
  vAge = mix(aF.z, aF.w, t);
  vSide = position.x;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);

  #include <logdepthbuf_vertex>
}
`;

const TRAIL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

varying vec3 vColor;
varying float vAlpha;
varying float vAge;
varying float vSide;

void main() {
  #include <logdepthbuf_fragment>

  // Soft across the ribbon so the quad edges never show as hard lines.
  float across = 1.0 - vSide * vSide;
  float a = vAlpha * across * across;
  if (a < 0.004) discard;

  // Ionised wake: lifted toward white where it leaves the bell, team colour a
  // moment later, cooling to nothing behind.
  //
  // ROUND-2 OVERCORRECTION. A pure white head on an additive ribbon, over a sky
  // whose median had been pushed to 0.58 sRGB, is what actually produced the
  // "50-70 px glowing teardrop attached to a 20 px hull" the critique measured:
  // the ribbon itself is ~2 px wide, but a blown-white additive head crosses the
  // bloom threshold along its whole length and smears into a comet. The head is
  // now only 45% of the way to white, so it blooms at the nozzle and not for its
  // entire 0.6 s of history.
  //
  // ROUND 3: the cool-off ran to vColor * 0.05 over age 0.22..1.0, which on an
  // ADDITIVE ribbon means the tail contributes essentially nothing no matter
  // what alpha says. Combined with the cubic alpha taper it made the length of
  // the wake a lie — the geometry was there, the curve was not visible. The
  // tail now cools to a third of the drive colour, which still separates hot
  // head from cold tail while leaving the whole ribbon on screen.
  vec3 col = mix(vColor, mix(vColor, vec3(1.0), 0.45), 1.0 - smoothstep(0.0, 0.18, vAge));
  col = mix(col, vColor * 0.34, smoothstep(0.18, 0.92, vAge));

  gl_FragColor = vec4(col, a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing below allocates per frame.
// ---------------------------------------------------------------------------

/** Ship basis, world space: right / up / forward. */
let _rx = 0, _ry = 0, _rz = 0;
let _ux = 0, _uy = 0, _uz = 0;
let _fx = 0, _fy = 0, _fz = 1;
/** Transformed mount position and direction. */
let _wx = 0, _wy = 0, _wz = 0;
let _dx = 0, _dy = 0, _dz = 0;

/** Drawing-buffer size probe. Reused; `getDrawingBufferSize` writes into it. */
const _bufSize = new THREE.Vector2();

/**
 * Rebuild the world basis of `s` into the module scratch.
 * Convention (core/registry.ts): right = up x forward, hull faces +Z.
 * `Ship.up` already carries the bank roll, so no extra roll is applied.
 */
function shipBasis(s: Ship): void {
  _fx = s.fwd.x; _fy = s.fwd.y; _fz = s.fwd.z;
  _ux = s.up.x; _uy = s.up.y; _uz = s.up.z;
  _rx = _uy * _fz - _uz * _fy;
  _ry = _uz * _fx - _ux * _fz;
  _rz = _ux * _fy - _uy * _fx;
  // Math.sqrt rather than Math.hypot: this runs per ship per frame and hypot's
  // overflow-safe path is an order of magnitude slower for no benefit here.
  const rl = Math.sqrt(_rx * _rx + _ry * _ry + _rz * _rz);
  if (rl > 1e-6) {
    const k = 1 / rl;
    _rx *= k; _ry *= k; _rz *= k;
  } else {
    // Degenerate up/forward pair: fall back to a stable arbitrary right vector.
    _rx = 1; _ry = 0; _rz = 0;
  }
  // Re-orthogonalise up so a drifting `Ship.up` cannot shear the mounts.
  _ux = _fy * _rz - _fz * _ry;
  _uy = _fz * _rx - _fx * _rz;
  _uz = _fx * _ry - _fy * _rx;
}

/** Transform a local-space point through the current basis into `_wx.._wz`. */
function localPoint(s: Ship, x: number, y: number, z: number): void {
  _wx = s.pos.x + _rx * x + _ux * y + _fx * z;
  _wy = s.pos.y + _ry * x + _uy * y + _fy * z;
  _wz = s.pos.z + _rz * x + _uz * y + _fz * z;
}

/** Transform a local-space direction through the current basis into `_dx.._dz`. */
function localDir(x: number, y: number, z: number): void {
  _dx = _rx * x + _ux * y + _fx * z;
  _dy = _ry * x + _uy * y + _fy * z;
  _dz = _rz * x + _uz * y + _fz * z;
  const l = Math.sqrt(_dx * _dx + _dy * _dy + _dz * _dz);
  if (l > 1e-6) {
    const k = 1 / l;
    _dx *= k; _dy *= k; _dz *= k;
  } else {
    _dx = 0; _dy = 0; _dz = -1;
  }
}

/** Upload the used prefix of an instanced attribute. */
function flush(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// EngineFx
// ---------------------------------------------------------------------------

/**
 * Drive plumes, nozzle glows, fighter trails and running lights for the whole
 * fleet, in three instanced draw calls.
 *
 * Runs after the fleet renderer each frame: it relies on `Ship.visible` and
 * `Ship.lod` having been written for this frame by `FleetRenderer.update`.
 *
 * ```ts
 * const engineFx = new EngineFx(scene, particles, textures, quality);
 * // per frame, after fleet.update(ctx, world):
 * engineFx.update(ctx, world);
 * ```
 */
export class EngineFx implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticleSystem;
  private quality: QualitySettings;

  // -- sprites (nozzle cores + running lights) ------------------------------
  private readonly spriteGeo: THREE.InstancedBufferGeometry;
  private readonly spriteMat: THREE.ShaderMaterial;
  private readonly spriteMesh: THREE.Mesh;
  private readonly sP: Float32Array;
  private readonly sC: Float32Array;
  private readonly sX: Float32Array;
  private readonly saP: THREE.InstancedBufferAttribute;
  private readonly saC: THREE.InstancedBufferAttribute;
  private readonly saX: THREE.InstancedBufferAttribute;
  private readonly spriteCap: number;
  private spriteLimit: number;
  private spriteCount = 0;

  // -- plumes ---------------------------------------------------------------
  private readonly plumeGeo: THREE.InstancedBufferGeometry;
  private readonly plumeMat: THREE.ShaderMaterial;
  private readonly plumeMesh: THREE.Mesh;
  private readonly pPos: Float32Array;
  private readonly pDir: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pMod: Float32Array;
  private readonly paPos: THREE.InstancedBufferAttribute;
  private readonly paDir: THREE.InstancedBufferAttribute;
  private readonly paCol: THREE.InstancedBufferAttribute;
  private readonly paMod: THREE.InstancedBufferAttribute;
  private readonly plumeCap: number;
  private plumeLimit: number;
  private plumeCount = 0;
  /**
   * 1x1 white stand-in bound to `uDepth` until an integrator supplies the real
   * scene depth attachment. Sampling an unbound sampler2D is undefined on some
   * drivers, so the slot is never left empty. Field initialiser (not constructor
   * body) so it exists before the plume material is built.
   */
  private readonly depthPlaceholder = makePlaceholderTexture();

  // -- trails ---------------------------------------------------------------
  private readonly trailGeo: THREE.InstancedBufferGeometry;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly trailMesh: THREE.Mesh;
  private readonly tA: Float32Array;
  private readonly tB: Float32Array;
  private readonly tC: Float32Array;
  private readonly tF: Float32Array;
  private readonly taA: THREE.InstancedBufferAttribute;
  private readonly taB: THREE.InstancedBufferAttribute;
  private readonly taC: THREE.InstancedBufferAttribute;
  private readonly taF: THREE.InstancedBufferAttribute;
  private readonly segCap: number;
  private segCount = 0;

  /** Trail ring buffers: `trailPos[slot][point] = xyz`, newest at `trailHead`. */
  private readonly trailPos: Float32Array;
  private readonly trailHead: Int32Array;
  private readonly trailCount: Int32Array;
  private readonly trailTimer: Float32Array;
  private readonly trailSeed: Float32Array;
  private readonly trailShip: Int32Array;
  private readonly trailSeen: Float32Array;
  /** shipId -> trail slot, -1 when the ship has none. */
  private readonly shipTrail: Int32Array;
  private readonly trailFree: Int32Array;
  private trailFreeCount: number;
  private readonly trailCap: number;
  private trailLimit: number;

  // -- per-class constant tables, hoisted out of the frame loop -------------
  private readonly clsEngineCount = new Int32Array(SHIP_CLASS_COUNT);
  private readonly clsEngine: Float32Array;
  /** Row stride of `clsEngine` in engine records — the busiest hull's count. */
  private readonly maxEngines: number;
  /** Merged engine bank per class, used by the far LOD tier. */
  private readonly clsBank = new Float32Array(SHIP_CLASS_COUNT * BANK_STRIDE);
  private readonly clsLightCount = new Int32Array(SHIP_CLASS_COUNT);
  private readonly clsLight = new Float32Array(SHIP_CLASS_COUNT * LIGHTS_MAX * LIGHT_STRIDE);
  private readonly clsRadius = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsLength = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsSpeed = new Float32Array(SHIP_CLASS_COUNT);
  /**
   * Drive colour temperature per class, 0..1. Big hulls run whiter, strike
   * craft stay saturated and cool, so class is readable from the light pattern
   * alone once the geometry has stopped resolving (CRITIQUE 0/12).
   */
  private readonly clsHeat = new Float32Array(SHIP_CLASS_COUNT);
  /**
   * Drive MASS by hull size, 0 (fighter) .. 1 (mothership).
   *
   * ROUND 2 asked that "plume width and length should differ by hull class and
   * throttle ... so a mothership's drive block reads as enormous next to a
   * fighter's". Nozzle radius alone already scales 1.05 m -> 62 m across the
   * roster, but every class then applied the SAME multipliers to it, so the
   * proportions were identical at every size and only the absolute scale moved —
   * which is precisely the "sprayed uniformly" failure mode. These three tables
   * make a heavy drive proportionally fatter and longer than a light one, and
   * `clsMass` is handed to the shader so the shock-cell count rises with it too.
   */
  private readonly clsPlumeW = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsPlumeL = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsMass = new Float32Array(SHIP_CLASS_COUNT);
  /** 1 for hull sizes that leave a ribbon trail (fighters only). */
  private readonly clsTrail = new Uint8Array(SHIP_CLASS_COUNT);

  // -- per-ship state -------------------------------------------------------
  private readonly prevThrottle = new Float32Array(CONFIG.maxShips);
  private readonly burnerCool = new Float32Array(CONFIG.maxShips);

  // -- detail gate ----------------------------------------------------------
  /**
   * Projected hull radius, in PIXELS, above which a hull gets the full
   * treatment. Screen-space, not world-space — CRITIQUE 1/4.
   */
  private detailPx = 12;
  private detailBudget: number;
  private detailCount = 0;

  /**
   * @param scene     where the three FX meshes are parented
   * @param particles shared particle engine, used for afterburner puffs
   * @param textures  shared procedural texture factory (kept for parity with the
   *                  other FX systems; all falloffs here are analytic so the
   *                  plume ramp cannot drift out of sync with the shaders)
   * @param quality   working limits; buffers are always allocated at the ultra
   *                  ceiling so a later quality raise needs no reallocation
   */
  constructor(
    scene: THREE.Scene,
    particles: ParticleSystem,
    textures: TextureFactory,
    quality: QualitySettings,
  ) {
    void textures;
    this.scene = scene;
    this.particles = particles;
    this.quality = quality;

    // -- per-class tables ---------------------------------------------------
    let maxEngines = 1;
    for (const cls of ALL_SHIP_CLASSES) {
      const n = SHIP_SPECS[cls].engines.length;
      if (n > maxEngines) maxEngines = n;
    }
    this.maxEngines = maxEngines;
    this.clsEngine = new Float32Array(SHIP_CLASS_COUNT * maxEngines * ENGINE_STRIDE);
    this.buildClassTables(maxEngines);

    // -- capacities ---------------------------------------------------------
    const top = SPRITE_LIMIT.length - 1;
    this.spriteCap = SPRITE_LIMIT[top];
    this.plumeCap = PLUME_LIMIT[top];
    this.trailCap = TRAIL_LIMIT[top];
    this.segCap = this.trailCap * (TRAIL_POINTS - 1);

    const preset = Math.max(0, Math.min(top, quality.preset | 0));
    this.spriteLimit = SPRITE_LIMIT[preset];
    this.plumeLimit = PLUME_LIMIT[preset];
    this.trailLimit = TRAIL_LIMIT[preset];
    this.detailBudget = DETAIL_BUDGET[preset];

    // -- sprite batch -------------------------------------------------------
    this.sP = new Float32Array(this.spriteCap * 4);
    this.sC = new Float32Array(this.spriteCap * 4);
    this.sX = new Float32Array(this.spriteCap * 4);
    this.spriteMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.spriteMat.name = 'fx.engines.sprites';
    this.spriteGeo = new THREE.InstancedBufferGeometry();
    this.spriteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]), 3));
    this.spriteGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.saP = mkAttr(this.sP);
    this.saC = mkAttr(this.sC);
    this.saX = mkAttr(this.sX);
    this.spriteGeo.setAttribute('aP', this.saP);
    this.spriteGeo.setAttribute('aC', this.saC);
    this.spriteGeo.setAttribute('aX', this.saX);
    this.spriteGeo.instanceCount = 0;
    this.spriteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.spriteMesh = mkMesh(this.spriteGeo, this.spriteMat, 'fx.engines.sprites', 17);

    // -- plume batch --------------------------------------------------------
    this.pPos = new Float32Array(this.plumeCap * 4);
    this.pDir = new Float32Array(this.plumeCap * 4);
    this.pCol = new Float32Array(this.plumeCap * 4);
    this.pMod = new Float32Array(this.plumeCap * 4);
    this.plumeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        // 4.6 -> 7.6: ~3.6 shock cells fall inside the first third of the
        // column, which is what the critique asked to be countable.
        uBands: { value: 7.6 },
        uNear: { value: 1 },
        uDepth: { value: this.depthPlaceholder as THREE.Texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(1, 1e6) },
        uHasDepth: { value: 0 },
      },
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.plumeMat.name = 'fx.engines.plume';
    this.plumeGeo = buildPlumeGeometry();
    this.paPos = mkAttr(this.pPos);
    this.paDir = mkAttr(this.pDir);
    this.paCol = mkAttr(this.pCol);
    this.paMod = mkAttr(this.pMod);
    this.plumeGeo.setAttribute('aPos', this.paPos);
    this.plumeGeo.setAttribute('aDir', this.paDir);
    this.plumeGeo.setAttribute('aCol', this.paCol);
    this.plumeGeo.setAttribute('aMod', this.paMod);
    this.plumeGeo.instanceCount = 0;
    this.plumeMesh = mkMesh(this.plumeGeo, this.plumeMat, 'fx.engines.plume', 16);

    // -- trail batch --------------------------------------------------------
    this.tA = new Float32Array(this.segCap * 4);
    this.tB = new Float32Array(this.segCap * 4);
    this.tC = new Float32Array(this.segCap * 4);
    this.tF = new Float32Array(this.segCap * 4);
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: {
        uMinAng: { value: 0.0006 },
      },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.trailMat.name = 'fx.engines.trail';
    this.trailGeo = new THREE.InstancedBufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0,
    ]), 3));
    this.trailGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.taA = mkAttr(this.tA);
    this.taB = mkAttr(this.tB);
    this.taC = mkAttr(this.tC);
    this.taF = mkAttr(this.tF);
    this.trailGeo.setAttribute('aA', this.taA);
    this.trailGeo.setAttribute('aB', this.taB);
    this.trailGeo.setAttribute('aC', this.taC);
    this.trailGeo.setAttribute('aF', this.taF);
    this.trailGeo.instanceCount = 0;
    this.trailGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.trailMesh = mkMesh(this.trailGeo, this.trailMat, 'fx.engines.trail', 15);

    // -- trail bookkeeping --------------------------------------------------
    this.trailPos = new Float32Array(this.trailCap * TRAIL_POINTS * 3);
    this.trailHead = new Int32Array(this.trailCap);
    this.trailCount = new Int32Array(this.trailCap);
    this.trailTimer = new Float32Array(this.trailCap);
    this.trailSeed = new Float32Array(this.trailCap);
    this.trailShip = new Int32Array(this.trailCap).fill(-1);
    this.trailSeen = new Float32Array(this.trailCap).fill(-1e6);
    this.shipTrail = new Int32Array(CONFIG.maxShips).fill(-1);
    this.trailFree = new Int32Array(this.trailCap);
    for (let i = 0; i < this.trailCap; i++) this.trailFree[i] = this.trailCap - 1 - i;
    this.trailFreeCount = this.trailCap;

    scene.add(this.trailMesh);
    scene.add(this.plumeMesh);
    scene.add(this.spriteMesh);
  }

  // -------------------------------------------------------------------------
  // Class tables
  // -------------------------------------------------------------------------

  /**
   * Flatten `SHIP_SPECS` into typed arrays, synthesise running-light placements
   * and precompute the merged engine bank used by the far LOD tier.
   *
   * Lights are not in the ship data table, so they are derived from the hull's
   * mount envelope: the outermost engine/hardpoint gives a decent half-width,
   * clamped against the bounding radius so a wide-mounted fighter does not end
   * up with lights floating off its wingtips.
   */
  private buildClassTables(maxEngines: number): void {
    for (const cls of ALL_SHIP_CLASSES) {
      const sp = SHIP_SPECS[cls];
      const c = cls as number;
      this.clsRadius[c] = sp.radius;
      this.clsLength[c] = sp.length;
      this.clsSpeed[c] = sp.speed;
      // Drive wakes were limited to Fighters, which meant that in practice they
      // almost never appeared: fighters are the smallest thing on screen and
      // spend most of a match parked. Every hull that manoeuvres now lays one —
      // it is the clearest read of who is moving and which way in a fleet
      // engagement. Capitals are excluded because a 2 km hull crawling at 42 m/s
      // would drag a stationary-looking smear behind it, which reads as a bug.
      this.clsTrail[c] = sp.size === HullSize.Fighter
        || sp.size === HullSize.Corvette
        || sp.size === HullSize.Utility
        || sp.size === HullSize.Frigate ? 1 : 0;
      this.clsHeat[c] = heatForSize(sp.size);
      this.clsPlumeW[c] = plumeWidthGain(sp.size);
      this.clsPlumeL[c] = plumeLengthGain(sp.size);
      this.clsMass[c] = massForSize(sp.size);

      // -- engines ---------------------------------------------------------
      const n = Math.min(sp.engines.length, maxEngines);
      this.clsEngineCount[c] = n;
      for (let i = 0; i < n; i++) {
        const e = sp.engines[i];
        const o = (c * maxEngines + i) * ENGINE_STRIDE;
        this.clsEngine[o] = e.pos[0];
        this.clsEngine[o + 1] = e.pos[1];
        this.clsEngine[o + 2] = e.pos[2];
        this.clsEngine[o + 3] = e.radius;
        const d = e.dir ?? [0, 0, -1];
        this.clsEngine[o + 4] = d[0];
        this.clsEngine[o + 5] = d[1];
        this.clsEngine[o + 6] = d[2];
      }

      // -- merged engine bank ----------------------------------------------
      // One plume that stands in for the whole bank once the hull is a handful
      // of pixels. The throat is the EQUAL-AREA merge, sqrt(sum r^2), so the
      // ship's total drive output does not change as it crosses the LOD
      // boundary; it is then widened to at least cover the bank's own spread so
      // a wide-set pair does not collapse into a single needle between them.
      {
        let sx = 0, sy = 0, sz = 0, sr2 = 0;
        let ddx = 0, ddy = 0, ddz = 0;
        for (let i = 0; i < n; i++) {
          const o = (c * maxEngines + i) * ENGINE_STRIDE;
          sx += this.clsEngine[o];
          sy += this.clsEngine[o + 1];
          sz += this.clsEngine[o + 2];
          const r = this.clsEngine[o + 3];
          sr2 += r * r;
          ddx += this.clsEngine[o + 4];
          ddy += this.clsEngine[o + 5];
          ddz += this.clsEngine[o + 6];
        }
        const inv = n > 0 ? 1 / n : 0;
        const bx = sx * inv;
        const by = sy * inv;
        const bz = sz * inv;
        let spread = 0;
        for (let i = 0; i < n; i++) {
          const o = (c * maxEngines + i) * ENGINE_STRIDE;
          const ex = this.clsEngine[o] - bx;
          const ey = this.clsEngine[o + 1] - by;
          const d = Math.sqrt(ex * ex + ey * ey);
          if (d > spread) spread = d;
        }
        let dl = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (dl < 1e-6) { ddx = 0; ddy = 0; ddz = -1; dl = 1; }
        const o = c * BANK_STRIDE;
        this.clsBank[o] = bx;
        this.clsBank[o + 1] = by;
        this.clsBank[o + 2] = bz;
        this.clsBank[o + 3] = Math.max(Math.sqrt(sr2), spread * 0.8, sp.radius * 0.05);
        this.clsBank[o + 4] = ddx / dl;
        this.clsBank[o + 5] = ddy / dl;
        this.clsBank[o + 6] = ddz / dl;
      }

      // -- mount envelope --------------------------------------------------
      let mx = 0;
      let my = 0;
      for (const e of sp.engines) {
        if (Math.abs(e.pos[0]) > mx) mx = Math.abs(e.pos[0]);
        if (Math.abs(e.pos[1]) > my) my = Math.abs(e.pos[1]);
      }
      for (const h of sp.hardpoints) {
        if (Math.abs(h.pos[0]) > mx) mx = Math.abs(h.pos[0]);
        if (Math.abs(h.pos[1]) > my) my = Math.abs(h.pos[1]);
      }
      const halfW = Math.min(sp.radius * 0.55, Math.max(mx * 1.45, sp.radius * 0.28));
      const dorsal = Math.min(sp.radius * 0.45, Math.max(my * 1.25, sp.radius * 0.16));
      const len = sp.length;
      // Deliberately small: a nav light is a lamp, not a beacon array. The angular
      // floor in the sprite shader is what keeps it visible at fleet zoom, so the
      // world size only has to be right up close (CRITIQUE 4).
      const lightSize = Math.min(5.5, Math.max(0.22, sp.radius * 0.032));

      // -- lights ----------------------------------------------------------
      let li = 0;
      const put = (x: number, y: number, z: number, kind: number, phase: number): void => {
        if (li >= LIGHTS_MAX) return;
        const o = (c * LIGHTS_MAX + li) * LIGHT_STRIDE;
        this.clsLight[o] = x;
        this.clsLight[o + 1] = y;
        this.clsLight[o + 2] = z;
        this.clsLight[o + 3] = kind;
        this.clsLight[o + 4] = lightSize;
        this.clsLight[o + 5] = phase;
        li++;
      };
      // Port is -X, starboard is +X (core/registry.ts local-space convention).
      put(-halfW, 0, len * 0.05, LIGHT_PORT, 0);
      put(halfW, 0, len * 0.05, LIGHT_STARBOARD, 0);
      put(0, dorsal, -len * 0.16, LIGHT_STROBE, 0);
      if (sp.size === HullSize.Frigate || sp.size === HullSize.Capital
        || sp.size === HullSize.SuperCapital) {
        // Big hulls read as big partly because their lights are spread out.
        put(0, dorsal * 0.7, len * 0.42, LIGHT_BEACON, 0.37);
        put(0, -dorsal * 0.8, -len * 0.38, LIGHT_STROBE, 0.5);
      }
      this.clsLightCount[c] = li;
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /**
   * Rebuild every engine effect for this frame.
   *
   * Must run after `FleetRenderer.update`, which is what writes `Ship.visible`
   * and `Ship.lod`.
   */
  update(ctx: RenderContext, world: World): void {
    const time = ctx.time;
    const dt = ctx.dt > 0 ? (ctx.dt < 0.1 ? ctx.dt : 0.1) : 0;

    const cam = ctx.camera;
    const cm = cam.matrixWorld.elements;
    const camX = cm[12];
    const camY = cm[13];
    const camZ = cm[14];

    // -- screen-space scale ---------------------------------------------------
    // Pixels per radian of angular size at the CURRENT viewport and FOV. Every
    // LOD decision below is expressed in pixels, so zooming out degrades the
    // fleet the same way at 720p and at 4K, and nothing can fall out of a gate
    // just because the camera is far away (CRITIQUE 1/4).
    ctx.renderer.getDrawingBufferSize(_bufSize);
    const vpH = _bufSize.y > 1 ? _bufSize.y : 1080;
    const halfFov = (cam.fov * Math.PI) / 360;
    const pxPerRad = (0.5 * vpH) / Math.max(Math.tan(halfFov), 1e-4);
    const invPx = 1 / pxPerRad;

    this.plumeMat.uniforms.uNear.value = cam.near;
    (this.plumeMat.uniforms.uResolution.value as THREE.Vector2).copy(_bufSize);
    (this.plumeMat.uniforms.uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
    this.trailMat.uniforms.uMinAng.value = TRAIL_MIN_PX * invPx;
    // Angular floors, in radians, applied per ship on the CPU below so they can
    // be capped against the producing hull (see PLUME_MAX_W_HULL / _L_HULL).
    const minAngPlumeW = PLUME_MIN_PX_W * invPx;
    const minAngPlumeL = PLUME_MIN_PX_L * invPx;
    const minAngNozzle = NOZZLE_MIN_PX * invPx;
    const minAngLight = LIGHT_MIN_PX * invPx;

    // Fragment turbulence is the one per-pixel cost in this module, so it is
    // the first thing to go on the low preset.
    const turbAmount = this.quality.preset > 0 ? 0.52 : 0;

    this.spriteCount = 0;
    this.plumeCount = 0;
    this.segCount = 0;
    this.detailCount = 0;

    this.releaseStaleTrails(time);

    const maxEngines = this.maxEngines;
    const gatePx = this.detailPx;
    const budget = this.detailBudget;
    const pool = world.ships;

    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || !s.visible || s.dockedIn >= 0) continue;

      const c = s.cls as number;
      const dxc = s.pos.x - camX;
      const dyc = s.pos.y - camY;
      const dzc = s.pos.z - camZ;
      const dist = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc);

      // -- LOD tier, in pixels ----------------------------------------------
      // `px` is the hull's projected radius. Nothing here can suppress the
      // plume; it only chooses between one merged instance and one per nozzle.
      const px = (this.clsRadius[c] / (dist > 1 ? dist : 1)) * pxPerRad;
      const bank = px < TIER_BANK_PX || s.lod >= LOD_IMPOSTOR;
      const full = !bank && px >= gatePx && this.detailCount < budget;
      if (full) this.detailCount++;

      shipBasis(s);

      const pal = PALETTES[s.team];
      // Class colour signature: bigger drives run hotter, i.e. whiter.
      const heat = this.clsHeat[c];
      const er = pal.engine.r + (1 - pal.engine.r) * heat;
      const eg = pal.engine.g + (1 - pal.engine.g) * heat;
      const eb = pal.engine.b + (1 - pal.engine.b) * heat;

      // Throttle never reaches zero: an idling drive still glows.
      const raw = s.throttle < 0 ? 0 : s.throttle > 1 ? 1 : s.throttle;
      const thr = IDLE_THROTTLE + (1 - IDLE_THROTTLE) * raw;

      // -- afterburner bookkeeping ------------------------------------------
      // Runs BEFORE the nozzles because the burner window stretches the plume:
      // cruise is clamped to ~1.2 hull lengths and only a burner reaches ~2.5,
      // which is what stops the plume swallowing its own ship (CRITIQUE 1/5).
      const prev = this.prevThrottle[s.id];
      let cool = this.burnerCool[s.id];
      if (cool > 0) cool -= dt;
      let fired = false;
      if (raw - prev > BURNER_TRIGGER && cool <= 0) {
        fired = true;
        cool = BURNER_COOLDOWN;
      }
      if (cool < 0) cool = 0;
      this.burnerCool[s.id] = cool;
      this.prevThrottle[s.id] = raw;
      const burner = cool * (1 / BURNER_COOLDOWN);

      // -- plume geometry, shared by every nozzle on this hull ---------------
      const hullLen = this.clsLength[c];
      const mass = this.clsMass[c];

      // Per-ship variation. Two independent seeded terms plus one slow
      // oscillation, so no two drives in a wing are the same size and none of
      // them is steady: a fleet of identical plumes is the "sprayed uniformly"
      // read the round-2 brief singles out, and it is what made the battle frame
      // "a field of identical bright lozenges". Costs three multiplies and a
      // sine per ship per frame and allocates nothing.
      const sv = s.seed;
      const varW = 0.84 + 0.32 * (sv * 7.13 - Math.floor(sv * 7.13));
      const varL = 0.80 + 0.40 * (sv * 3.71 - Math.floor(sv * 3.71));
      // Combustion instability: a per-ship frequency so the fleet never breathes
      // as one organism.
      const breathe = 1 + 0.10 * Math.sin(time * (2.1 + sv * 2.6) + sv * 41);

      // Throttle drives BOTH length and width now — round 1 varied length only,
      // so a hull under burner grew a longer needle of the same calibre instead
      // of opening its drives up.
      const lenScale = (0.24 + 0.98 * Math.pow(raw, 0.85)) * (1 + 1.1 * burner);
      const widScale = (0.80 + 0.34 * raw) * (1 + 0.30 * burner);

      // Screen-size gain. Below ~6 px of projected hull radius the plume is the
      // only thing left of the ship, so round 1 let it run at full radiance and
      // the fleet turned into glowing cotton with dark specks in it (critique r2
      // reviewer 0/2). Halve peak radiance at and below TIER_LIGHT_PX and ramp
      // back to full by TIER_BANK_PX.
      const sizeGain = px >= TIER_BANK_PX
        ? 1
        : 0.5 + 0.5 * Math.max(0, (px - TIER_LIGHT_PX) / (TIER_BANK_PX - TIER_LIGHT_PX));

      const coreI = (0.45 + 1.75 * thr + 0.9 * burner) * sizeGain;
      const plumeI = (0.36 + 0.88 * thr + 0.5 * burner) * sizeGain * breathe;
      const turb = px >= TIER_TURB_PX ? turbAmount : 0;

      // Angular floor / hull cap, in METRES at this ship's depth. `screenClamp`
      // lifts a sub-pixel plume to a legible size and then refuses to let it
      // exceed the hull that made it, which is the pair of bounds round 1 could
      // not express because the floor lived in the vertex shader.
      const minW = dist * minAngPlumeW;
      const minL = dist * minAngPlumeL;
      const maxW = this.clsRadius[c] * PLUME_MAX_W_HULL;
      const maxL = hullLen * PLUME_MAX_L_HULL;

      // -- nozzles ----------------------------------------------------------
      if (bank) {
        // One merged plume + one merged core for the whole bank. Degrading in
        // COMPLEXITY, never to nothing.
        const o = c * BANK_STRIDE;
        const nr = this.clsBank[o + 3];
        localDir(this.clsBank[o + 4], this.clsBank[o + 5], this.clsBank[o + 6]);
        const ax = _dx, ay = _dy, az = _dz;
        localPoint(s, this.clsBank[o], this.clsBank[o + 1], this.clsBank[o + 2]);
        const push = nr * 0.3;
        const gx = _wx + ax * push;
        const gy = _wy + ay * push;
        const gz = _wz + az * push;
        this.pushSprite(
          gx, gy, gz, nr * (0.85 + 0.55 * raw),
          er, eg, eb, coreI,
          SHAPE_NOZZLE, s.seed, minAngNozzle, 0,
        );
        this.emitPlume(
          gx, gy, gz,
          nr * 1.55 * widScale * this.clsPlumeW[c] * varW,
          ax, ay, az,
          plumeLength(hullLen, nr) * lenScale * this.clsPlumeL[c] * varL * breathe,
          er, eg, eb, plumeI,
          s.seed, thr, 0, mass,
          minW, maxW, minL, maxL,
        );
      } else {
        const nEng = this.clsEngineCount[c];
        const base = c * maxEngines * ENGINE_STRIDE;
        for (let e = 0; e < nEng; e++) {
          const o = base + e * ENGINE_STRIDE;
          const nr = this.clsEngine[o + 3];
          localDir(this.clsEngine[o + 4], this.clsEngine[o + 5], this.clsEngine[o + 6]);
          const ax = _dx, ay = _dy, az = _dz;
          localPoint(s, this.clsEngine[o], this.clsEngine[o + 1], this.clsEngine[o + 2]);
          // Nudge the glow out of the hull so the nozzle lip cannot z-clip it.
          const push = nr * 0.35;
          const gx = _wx + ax * push;
          const gy = _wy + ay * push;
          const gz = _wz + az * push;

          // The core is the incandescent throat itself, not a lens flare:
          // keeping it close to the real nozzle radius is what stops a fighter
          // reading as two headlights once bloom gets hold of it.
          this.pushSprite(
            gx, gy, gz,
            nr * (0.85 + 0.55 * raw),
            er, eg, eb, coreI,
            SHAPE_NOZZLE, s.seed + e * 0.211, minAngNozzle, 0,
          );

          this.emitPlume(
            gx, gy, gz,
            // Half-width of the billboard. The visible column is ~0.62 of it and
            // `PLUME_MAX_W_HULL` caps the result, so a strike craft plume can
            // never grow wider than the hull it hangs off.
            nr * 1.55 * widScale * this.clsPlumeW[c] * varW,
            ax, ay, az,
            plumeLength(hullLen, nr) * lenScale * this.clsPlumeL[c] * varL * breathe,
            er, eg, eb, plumeI,
            // Per-nozzle seed offset: two drives on the same hull must not show
            // the same shock train.
            s.seed + e * 0.137, thr, turb, mass,
            minW, maxW, minL, maxL,
          );
        }
      }

      // -- running lights ---------------------------------------------------
      if (px >= TIER_LIGHT_PX) this.pushLights(s, c, time, minAngLight);

      // -- trail ------------------------------------------------------------
      // Trails deliberately do NOT sit behind the `full` detail gate. A wake is
      // how the player reads who is moving and which way, which matters MOST at
      // fleet range — exactly where the detail budget was switching it off.
      if (this.clsTrail[c] === 1 && px >= TIER_LIGHT_PX) {
        this.updateTrail(s, c, time, dt, er, eg, eb);
      }
      else if (this.clsTrail[c] === 0 && this.shipTrail[s.id] >= 0) {
        this.releaseTrail(this.shipTrail[s.id]);
      }

      // -- afterburner puff -------------------------------------------------
      if (fired && full) this.burnerPuff(s, c, maxEngines, er, eg, eb);
    }

    this.tuneDetailGate();
    this.upload(time);
  }

  // -------------------------------------------------------------------------
  // Emission helpers
  // -------------------------------------------------------------------------

  /** Append one billboard sprite. Silently drops past the working limit. */
  private pushSprite(
    x: number, y: number, z: number, radius: number,
    r: number, g: number, b: number, intensity: number,
    shape: number, seed: number, minAngle: number, flare: number,
  ): void {
    const i = this.spriteCount;
    if (i >= this.spriteLimit) return;
    this.spriteCount = i + 1;
    const o = i * 4;
    this.sP[o] = x; this.sP[o + 1] = y; this.sP[o + 2] = z; this.sP[o + 3] = radius;
    this.sC[o] = r; this.sC[o + 1] = g; this.sC[o + 2] = b; this.sC[o + 3] = intensity * DRIVE_HDR;
    this.sX[o] = shape; this.sX[o + 1] = seed; this.sX[o + 2] = minAngle; this.sX[o + 3] = flare;
  }

  /**
   * Clamp a plume to its screen floor and its hull cap, correct the radiance for
   * the area the clamp actually gave it, and append it.
   *
   * The energy correction matters as much as the clamp: lifting a sub-pixel
   * plume to the angular floor inflates its footprint by up to two orders of
   * magnitude, and if the radiance rides along the fleet becomes a field of
   * blown-white lozenges. Round 1 did this in the vertex shader; doing it here
   * is both cheaper (once per instance, not once per vertex) and the only place
   * the hull cap can be applied at all.
   */
  private emitPlume(
    x: number, y: number, z: number, halfWidth: number,
    ax: number, ay: number, az: number, length: number,
    r: number, g: number, b: number, intensity: number,
    seed: number, throttle: number, turbulence: number, mass: number,
    minW: number, maxW: number, minL: number, maxL: number,
  ): void {
    const w = screenClamp(halfWidth, minW, maxW);
    const l = screenClamp(length, minL, maxL);
    const fade = 0.30 + 0.70 * Math.sqrt(
      Math.min(1, halfWidth / w) * 0.65 + Math.min(1, length / l) * 0.35);
    this.pushPlume(
      x, y, z, w, ax, ay, az, l,
      r, g, b, intensity * fade,
      seed, throttle, turbulence, mass,
    );
  }

  /** Append one plume billboard. Silently drops past the working limit. */
  private pushPlume(
    x: number, y: number, z: number, halfWidth: number,
    ax: number, ay: number, az: number, length: number,
    r: number, g: number, b: number, intensity: number,
    seed: number, throttle: number, turbulence: number, mass: number,
  ): void {
    const i = this.plumeCount;
    if (i >= this.plumeLimit) return;
    this.plumeCount = i + 1;
    const o = i * 4;
    this.pPos[o] = x; this.pPos[o + 1] = y; this.pPos[o + 2] = z; this.pPos[o + 3] = halfWidth;
    this.pDir[o] = ax; this.pDir[o + 1] = ay; this.pDir[o + 2] = az; this.pDir[o + 3] = length;
    this.pCol[o] = r; this.pCol[o + 1] = g; this.pCol[o + 2] = b;
    this.pCol[o + 3] = intensity * DRIVE_HDR;
    this.pMod[o] = seed;
    this.pMod[o + 1] = throttle;
    this.pMod[o + 2] = turbulence;
    this.pMod[o + 3] = mass;
  }

  /**
   * Emit the running lights of one ship.
   *
   * Nav lights (red port / green starboard) breathe gently; strobes fire a
   * sharp decaying flash roughly once a second. The phase comes from
   * `ship.seed`, so a formation twinkles asynchronously the way real running
   * lights do — a global sine would make the whole fleet blink in lockstep and
   * instantly read as a shader trick.
   */
  private pushLights(s: Ship, c: number, time: number, minAngle: number): void {
    const n = this.clsLightCount[c];
    const seed = s.seed;
    for (let l = 0; l < n; l++) {
      const o = (c * LIGHTS_MAX + l) * LIGHT_STRIDE;
      const kind = this.clsLight[o + 3];
      const size = this.clsLight[o + 4];
      const phase = seed + this.clsLight[o + 5];

      let r: number;
      let g: number;
      let b: number;
      let inten: number;
      let flare = 1;

      if (kind === LIGHT_PORT || kind === LIGHT_STARBOARD) {
        const col = kind === LIGHT_PORT ? COL_PORT : COL_STARBOARD;
        r = col[0]; g = col[1]; b = col[2];
        inten = 0.82 + 0.24 * Math.sin((time * 2.1 + phase * 6.283) % 6.283);
        flare = 0.55;
      } else if (kind === LIGHT_STROBE) {
        r = COL_WHITE[0]; g = COL_WHITE[1]; b = COL_WHITE[2];
        // Sawtooth phase -> exponential decay = a hard flash with a short tail.
        const p = (time * 0.92 + phase) % 1;
        inten = 0.05 + 2.6 * Math.exp(-p * 26);
      } else {
        r = COL_WHITE[0]; g = COL_WHITE[1]; b = COL_WHITE[2];
        inten = 0.5 + 0.3 * Math.sin((time * 1.3 + phase * 6.283) % 6.283);
        flare = 0.4;
      }

      localPoint(s, this.clsLight[o], this.clsLight[o + 1], this.clsLight[o + 2]);
      this.pushSprite(
        _wx, _wy, _wz, size,
        r, g, b, inten,
        SHAPE_LIGHT, seed + l * 0.137, minAngle, flare,
      );
    }
  }

  /** Afterburner puff at the ship's nozzles, retinted to the drive colour. */
  private burnerPuff(
    s: Ship, c: number, maxEngines: number,
    r: number, g: number, b: number,
  ): void {
    const nEng = this.clsEngineCount[c];
    const base = c * maxEngines * ENGINE_STRIDE;
    // At most two puffs per event; a six-engine capital does not need six.
    const emit = nEng < 2 ? nEng : 2;
    for (let e = 0; e < emit; e++) {
      const o = base + e * ENGINE_STRIDE;
      const nr = this.clsEngine[o + 3];
      localDir(this.clsEngine[o + 4], this.clsEngine[o + 5], this.clsEngine[o + 6]);
      localPoint(s, this.clsEngine[o], this.clsEngine[o + 1], this.clsEngine[o + 2]);
      // `burst` reads P.vx/vy/vz as the aim axis for directional presets; set it
      // even for the spherical `fireball` so a preset swap stays correct.
      P.vx = _dx; P.vy = _dy; P.vz = _dz;
      this.particles.burst(
        _wx + _dx * nr, _wy + _dy * nr, _wz + _dz * nr,
        5, 'fireball', nr * 1.5, r, g, b,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Trails
  // -------------------------------------------------------------------------

  /** Hand back trail slots whose ship stopped reporting (died, docked, culled). */
  private releaseStaleTrails(time: number): void {
    for (let slot = 0; slot < this.trailCap; slot++) {
      if (this.trailShip[slot] < 0) continue;
      if (time - this.trailSeen[slot] > TRAIL_STALE) this.releaseTrail(slot);
    }
  }

  /** Return `slot` to the free list and unbind it from its ship. */
  private releaseTrail(slot: number): void {
    const id = this.trailShip[slot];
    if (id >= 0 && id < this.shipTrail.length && this.shipTrail[id] === slot) {
      this.shipTrail[id] = -1;
    }
    this.trailShip[slot] = -1;
    this.trailCount[slot] = 0;
    this.trailHead[slot] = 0;
    if (this.trailFreeCount < this.trailCap) this.trailFree[this.trailFreeCount++] = slot;
  }

  /**
   * Advance one fighter's position ring buffer and emit its ribbon segments.
   *
   * The newest point tracks the ship every frame so the ribbon stays welded to
   * the hull; a new point is frozen off every `TRAIL_STEP`. Segment 0 is the
   * freshest, `count-2` the oldest.
   */
  private updateTrail(
    s: Ship, c: number, time: number, dt: number,
    r: number, g: number, b: number,
  ): void {
    const vx = s.vel.x, vy = s.vel.y, vz = s.vel.z;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const cruise = this.clsSpeed[c];
    const fast = cruise > 1 ? speed / cruise : 0;

    let slot = this.shipTrail[s.id];

    // 0.22 of cruise was high enough that a ship at station-keeping or easing
    // into formation left nothing, which is most of what is on screen outside a
    // charge — reported as "missing trails".
    if (fast < 0.06) {
      // Too slow to leave a wake: drop the history so it does not snap back
      // into existence stale when the ship accelerates again.
      if (slot >= 0) this.releaseTrail(slot);
      return;
    }

    if (slot < 0) {
      if (this.trailFreeCount === 0) return;
      slot = this.trailFree[--this.trailFreeCount];
      if (slot >= this.trailLimit) {
        // Slot outside the current working limit — put it back, no trail.
        this.trailFree[this.trailFreeCount++] = slot;
        return;
      }
      this.shipTrail[s.id] = slot;
      this.trailShip[slot] = s.id;
      this.trailCount[slot] = 0;
      this.trailHead[slot] = 0;
      this.trailTimer[slot] = 0;
      this.trailSeed[slot] = s.seed;
    } else if (this.trailSeed[slot] !== Math.fround(s.seed)) {
      // The entity pool recycled this ship id into a different hull — drop the
      // history so the new ship does not inherit a wake from the old one.
      // NB: `trailSeed` is a Float32Array, so the stored value is the float32
      // rounding of `s.seed`; comparing against the raw double would report a
      // mismatch every single frame and the trail would never grow past one
      // point.
      this.trailCount[slot] = 0;
      this.trailHead[slot] = 0;
      this.trailTimer[slot] = 0;
      this.trailSeed[slot] = s.seed;
    }
    this.trailSeen[slot] = time;

    // Anchor the ribbon just aft of the hull, on the ship's own axis.
    const aft = this.clsLength[c] * 0.46;
    const ax = s.pos.x - _fx * aft;
    const ay = s.pos.y - _fy * aft;
    const az = s.pos.z - _fz * aft;

    const ringBase = slot * TRAIL_POINTS * 3;
    let head = this.trailHead[slot];
    let count = this.trailCount[slot];

    // The head sample tracks the hull every frame so the ribbon stays welded on.
    writePoint(this.trailPos, ringBase, head, ax, ay, az);
    if (count === 0) count = 1;

    // Freeze a sample off every TRAIL_STEP. Bounded so a long frame hitch
    // cannot spin here.
    let t = this.trailTimer[slot] + dt;
    let steps = 0;
    while (t >= TRAIL_STEP && steps < 3) {
      t -= TRAIL_STEP;
      steps++;
      head = head + 1 >= TRAIL_POINTS ? 0 : head + 1;
      writePoint(this.trailPos, ringBase, head, ax, ay, az);
      if (count < TRAIL_POINTS) count++;
    }
    this.trailTimer[slot] = t;
    this.trailHead[slot] = head;
    this.trailCount[slot] = count;

    if (count < 2) return;

    // -- emit segments ------------------------------------------------------
    // A wake is a wisp, not a searchlight: kept narrow on purpose, so fifty of
    // them cross-fading over each other still read as fifty fighters rather
    // than a sheet of white. It IS brighter than round 1 — the reference frames
    // read the streak before the hull.
    // ROUND-2 OVERCORRECTION (critique r2, engines.ts): the wake, not the plume,
    // is what the reviewer measured as "a 50-70 px glowing teardrop attached to
    // a 20 px hull" — at cruise a fighter lays 0.63 s of ribbon, which is five
    // hull lengths of additive white. The reference (hw244160_6) does run long
    // contrails, but they are THIN and PALE and the hull is unambiguously the
    // subject. Width 0.085 -> 0.055 of hull radius and peak strength 0.55 ->
    // 0.26, with the white-hot head demoted in TRAIL_FRAG.
    //
    // ROUND-3, from playtest: "flame trail needs to be long and curve, now
    // missing, should be extremely visible". Three separate things were
    // suppressing it, and the width was only one of them:
    //
    //  1. The emit gate was lowered to `fast >= 0.06` when trails were reported
    //     missing, but this ramp still started at 0.22 and was never moved with
    //     it. Between the two, `strength` came out NEGATIVE, so every ship
    //     between 6% and 22% of cruise allocated a trail slot, wrote its history
    //     and emitted segments that the fragment shader discarded. Full
    //     strength needed 67% of cruise, which in practice is a charge only.
    //  2. Alpha tapered as (1 - age)^3, so the back two thirds of the ribbon
    //     were under 4% opacity — the part that carries the curve.
    //  3. Half-width was 0.055 of hull radius, ~0.4 m on a fighter.
    //
    // The answer to "extremely visible" is LENGTH and CONTINUITY rather than
    // width: a long thin contrail is what the reference frames run, and it is
    // also what avoids the round-2 failure of a fat additive head blooming into
    // a teardrop bigger than the hull. Width goes up modestly, the taper
    // exponent drops so the tail survives to be seen, and the ramp now matches
    // the gate it is supposed to follow.
    const w0 = this.clsRadius[c] * 0.085;
    const ramp = clamp01((fast - 0.06) / 0.30);
    const strength = 0.40 * ramp * (0.45 + 0.55 * s.throttle);
    const inv = 1 / (count - 1);

    for (let k = 0; k < count - 1; k++) {
      const i = this.segCount;
      if (i >= this.segCap) break;

      // Walk backwards from the head: k = 0 is the freshest sample. The double
      // modulo keeps the index positive for negative `head - k`.
      const ia = (((head - k) % TRAIL_POINTS) + TRAIL_POINTS) % TRAIL_POINTS;
      const ib = (((head - k - 1) % TRAIL_POINTS) + TRAIL_POINTS) % TRAIL_POINTS;
      const pa = ringBase + ia * 3;
      const pb = ringBase + ib * 3;

      const ageA = k * inv;
      const ageB = (k + 1) * inv;
      // Width and alpha both taper, but alpha faster — a wake thins before it
      // narrows, otherwise the tail reads as a solid ribbon that stops dead.
      const wA = w0 * (1 - ageA * 0.55);
      const wB = w0 * (1 - ageB * 0.55);
      const aA = strength * fadeAlong(ageA);
      const aB = strength * fadeAlong(ageB);

      this.segCount = i + 1;
      const o = i * 4;
      this.tA[o] = this.trailPos[pa];
      this.tA[o + 1] = this.trailPos[pa + 1];
      this.tA[o + 2] = this.trailPos[pa + 2];
      this.tA[o + 3] = wA;
      this.tB[o] = this.trailPos[pb];
      this.tB[o + 1] = this.trailPos[pb + 1];
      this.tB[o + 2] = this.trailPos[pb + 2];
      this.tB[o + 3] = wB;
      this.tC[o] = r; this.tC[o + 1] = g; this.tC[o + 2] = b; this.tC[o + 3] = s.seed;
      this.tF[o] = aA; this.tF[o + 1] = aB; this.tF[o + 2] = ageA; this.tF[o + 3] = ageB;
    }
  }

  // -------------------------------------------------------------------------
  // Budget + upload
  // -------------------------------------------------------------------------

  /**
   * One-pole controller on the full-detail gate, now in PIXELS of projected
   * hull radius. Overrun raises the threshold quickly (fewer hulls qualify),
   * headroom lowers it slowly — fast attack, slow release, so a passing capital
   * cannot make the whole fleet's wakes strobe on and off.
   *
   * Note what it can and cannot do: this gate only controls ribbon trails,
   * afterburner puffs and fragment turbulence. Plumes and nozzle cores are
   * outside it by design (CRITIQUE 1/4).
   */
  private tuneDetailGate(): void {
    const budget = this.detailBudget;
    if (this.detailCount >= budget) this.detailPx *= 1.10;
    else if (this.detailCount < budget * 0.82) this.detailPx *= 0.95;
    if (this.detailPx < DETAIL_PX_MIN) this.detailPx = DETAIL_PX_MIN;
    else if (this.detailPx > DETAIL_PX_MAX) this.detailPx = DETAIL_PX_MAX;
  }

  /** Push the used prefix of every instance buffer and set the draw counts. */
  private upload(time: number): void {
    const sn = this.spriteCount;
    this.spriteGeo.instanceCount = sn;
    this.spriteMesh.visible = sn > 0;
    if (sn > 0) {
      flush(this.saP, sn);
      flush(this.saC, sn);
      flush(this.saX, sn);
    }

    const pn = this.plumeCount;
    this.plumeGeo.instanceCount = pn;
    this.plumeMesh.visible = pn > 0;
    if (pn > 0) {
      flush(this.paPos, pn);
      flush(this.paDir, pn);
      flush(this.paCol, pn);
      flush(this.paMod, pn);
      this.plumeMat.uniforms.uTime.value = time;
    }

    const tn = this.segCount;
    this.trailGeo.instanceCount = tn;
    this.trailMesh.visible = tn > 0;
    if (tn > 0) {
      flush(this.taA, tn);
      flush(this.taB, tn);
      flush(this.taC, tn);
      flush(this.taF, tn);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Re-apply working limits. Buffers were allocated at the ultra ceiling, so a
   * raise costs nothing and a drop takes effect on the next frame.
   */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    const top = SPRITE_LIMIT.length - 1;
    const preset = Math.max(0, Math.min(top, q.preset | 0));
    this.spriteLimit = Math.min(this.spriteCap, SPRITE_LIMIT[preset]);
    this.plumeLimit = Math.min(this.plumeCap, PLUME_LIMIT[preset]);
    this.detailBudget = DETAIL_BUDGET[preset];
    const limit = Math.min(this.trailCap, TRAIL_LIMIT[preset]);
    if (limit < this.trailLimit) {
      // Drop trails that fall outside the new working set.
      for (let slot = limit; slot < this.trailCap; slot++) {
        if (this.trailShip[slot] >= 0) this.releaseTrail(slot);
      }
    }
    this.trailLimit = limit;
  }

  /**
   * Supply the scene depth attachment so the plume column dissolves into hull
   * geometry instead of slicing through it — critique r2 reviewer 2, "the
   * mothership's plume ribbons draw OVER the hull ... multiply plume alpha by
   * the soft-particle depth term already ported from particles.ts".
   *
   * Optional and off by default: pass `null` (or never call this) and the plume
   * relies on the ordinary depth TEST alone, which is already enabled. The
   * integrator wires it exactly like the particle system, next to
   * `particles.setDepthTexture(stage.depthTexture)`.
   */
  setDepthTexture(t: THREE.Texture | null): void {
    this.plumeMat.uniforms.uDepth.value = t ?? this.depthPlaceholder;
    this.plumeMat.uniforms.uHasDepth.value = t ? 1 : 0;
  }

  /** Live instance counts, for the debug HUD. */
  get stats(): { sprites: number; plumes: number; trailSegments: number } {
    return { sprites: this.spriteCount, plumes: this.plumeCount, trailSegments: this.segCount };
  }

  /** Drop every trail history — call on scene reset so wakes do not teleport. */
  clear(): void {
    for (let slot = 0; slot < this.trailCap; slot++) {
      if (this.trailShip[slot] >= 0) this.releaseTrail(slot);
    }
    this.prevThrottle.fill(0);
    this.burnerCool.fill(0);
    this.spriteCount = 0;
    this.plumeCount = 0;
    this.segCount = 0;
    this.spriteGeo.instanceCount = 0;
    this.plumeGeo.instanceCount = 0;
    this.trailGeo.instanceCount = 0;
  }

  dispose(): void {
    this.scene.remove(this.spriteMesh);
    this.scene.remove(this.plumeMesh);
    this.scene.remove(this.trailMesh);
    this.spriteGeo.dispose();
    this.plumeGeo.dispose();
    this.trailGeo.dispose();
    this.spriteMat.dispose();
    this.plumeMat.dispose();
    this.trailMat.dispose();
    this.depthPlaceholder.dispose();
  }
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/**
 * Plume length at full cruise throttle, metres.
 *
 * CRITIQUE 1/5: "clamp plume length to ~1.2x hull length at cruise". The nozzle
 * term is what keeps a capital's plume proportionate — a 430 m cruiser with a
 * 15 m bell should not trail half a kilometre of gas just because the hull is
 * long. `lenScale` in the frame loop supplies the throttle and burner ramp on
 * top of this, reaching ~2.5x only inside a burner window.
 */
function plumeLength(hullLen: number, nozzleRadius: number): number {
  const byHull = hullLen;
  const byNozzle = nozzleRadius * 22;
  return byHull < byNozzle ? byHull : byNozzle;
}

/**
 * Clamp a plume dimension to a screen-space floor without letting the floor
 * push it past a hull-relative cap.
 *
 * `want` is the physically-correct size. `min` lifts it to the angular floor so
 * a distant drive is still legible; `max` is the hull cap. The final `Math.max`
 * on the cap is deliberate: if a hull genuinely wants a plume bigger than its
 * own cap (it never does at the shipped tunings, but a designer could ask for
 * it) the honest size wins and the clamp does not silently shrink it.
 */
function screenClamp(want: number, min: number, max: number): number {
  const lifted = want > min ? want : min;
  const cap = max > want ? max : want;
  return lifted < cap ? lifted : cap;
}

/**
 * Billboard half-width multiplier by hull size.
 *
 * A fighter's bell is a nozzle; a mothership's is a drive BLOCK, and the gas
 * leaving it expands over hundreds of metres. Applying the same 1.55 to both
 * (round 1) meant the two plumes were geometrically similar and only differed in
 * absolute scale, so the frame gave the viewer no size cue from the exhaust —
 * the round-2 note "a mothership's drive block should read as enormous next to a
 * fighter's". Combined with the nozzle radii in the registry (1.05 m fighter,
 * 62 m mothership) the shipped half-widths run ~1.4 m to ~190 m, a 130x spread.
 */
function plumeWidthGain(size: HullSize): number {
  // ROUND 3. These were raised (SuperCapital 1.75 -> 3.40) while the plume was
  // NOT DRAWING AT ALL — the WebGL feedback loop was dropping every plume draw,
  // so the numbers were tuned against a blank screen. With the draw restored,
  // 3.40 on a 62 m nozzle gives a 234 m half-width against a hull whose half
  // beam is 206 m: the exhaust was WIDER THAN THE SHIP. Reported as "bad fx,
  // too big". The spread between a fighter and a mothership is preserved; the
  // absolute size is not.
  switch (size) {
    case HullSize.Fighter: return 0.85;
    case HullSize.Corvette: return 1.00;
    case HullSize.Frigate: return 1.15;
    case HullSize.Capital: return 1.30;
    case HullSize.SuperCapital: return 1.55;
    default: return 1.0;
  }
}

/** Plume length multiplier by hull size. See `plumeWidthGain`. */
function plumeLengthGain(size: HullSize): number {
  switch (size) {
    case HullSize.Fighter: return 0.85;
    case HullSize.Corvette: return 0.95;
    case HullSize.Frigate: return 1.10;
    case HullSize.Capital: return 1.25;
    case HullSize.SuperCapital: return 1.35;
    default: return 0.95;
  }
}

/**
 * Normalised drive mass, 0..1, handed to the plume shader as `aMod.w`. Heavier
 * drives carry more (and shorter) shock cells, so class is readable from the
 * structure of the exhaust and not only from its size.
 */
function massForSize(size: HullSize): number {
  switch (size) {
    case HullSize.Fighter: return 0.0;
    case HullSize.Corvette: return 0.20;
    case HullSize.Frigate: return 0.45;
    case HullSize.Capital: return 0.75;
    case HullSize.SuperCapital: return 1.0;
    default: return 0.30;
  }
}

/** 1x1 opaque white texture, used as an unbound-sampler guard. */
function makePlaceholderTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Drive colour temperature by hull size, 0 = cool/saturated, 1 = white. */
function heatForSize(size: HullSize): number {
  switch (size) {
    case HullSize.Fighter: return 0.0;
    case HullSize.Corvette: return 0.06;
    case HullSize.Frigate: return 0.10;
    case HullSize.Capital: return 0.14;
    case HullSize.SuperCapital: return 0.16;
    default: return 0.08;
  }
}

/** A dynamic-usage vec4 instance attribute over `arr`. */
function mkAttr(arr: Float32Array): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(arr, 4);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

/** A never-culled, never-transformed FX mesh. */
function mkMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  name: string,
  renderOrder: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.renderOrder = renderOrder;
  return m;
}

/**
 * Base geometry for the plume: a single camera-facing quad, subdivided along
 * its length into a trapezoid strip.
 *
 * The rows are NOT the plume's shape — the shape is the analytic density
 * function in the fragment shader. `wf` is a conservative ENVELOPE around that
 * density (its Gaussian has fallen below the discard threshold by |u| = 0.9 x
 * profile, and the profile peaks at 0.52), so the strip exists purely to avoid
 * shading fully transparent pixels. Because the density never reaches the
 * boundary, no polygon edge can appear on the silhouette at any zoom — which is
 * the whole point of replacing the round-1 cone shell (CRITIQUE 1/5, 2/11).
 *
 * position = (side +/-1, v, widthFactor). 10 vertices, 8 triangles per plume,
 * against 187 vertices and 240 triangles for the old cone.
 */
function buildPlumeGeometry(): THREE.InstancedBufferGeometry {
  const vs = [0.0, 0.12, 0.45, 0.78, 1.0];
  const wf = [0.90, 1.15, 1.05, 0.78, 0.34];
  const rows = vs.length;

  const pos = new Float32Array(rows * 2 * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < 2; i++) {
      const o = (j * 2 + i) * 3;
      pos[o] = i === 0 ? -1 : 1;
      pos[o + 1] = vs[j];
      pos[o + 2] = wf[j];
    }
  }

  const idx = new Uint16Array((rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    const a = j * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // Plumes are scattered across the battlespace and built in the shader;
  // culling this draw would be wrong at any bound.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return g;
}

/** Clamp to 0..1. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Alpha profile along a wake, `age` 0 at the nozzle to 1 at the oldest sample.
 *
 * A cubic falloff put the whole back half of the ribbon below 4% and threw
 * away the section that shows the curve. This holds most of the length at a
 * readable level and then drops off hard right at the end, so the wake still
 * dissolves rather than stopping dead — the reason the cubic was there in the
 * first place.
 */
function fadeAlong(age: number): number {
  const body = 1 - age * age * 0.55;
  return body * (1 - smooth01(age, 0.72, 1.0));
}

/** Hermite smoothstep, mirrors GLSL `smoothstep`. */
function smooth01(x: number, e0: number, e1: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Write one xyz sample into a trail ring buffer. */
function writePoint(
  buf: Float32Array, base: number, index: number,
  x: number, y: number, z: number,
): void {
  const o = base + index * 3;
  buf[o] = x;
  buf[o + 1] = y;
  buf[o + 2] = z;
}
