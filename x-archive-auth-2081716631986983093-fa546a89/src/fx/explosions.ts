/**
 * SHIP DEATH — the staged destruction sequence.
 *
 * ---------------------------------------------------------------------------
 * DESIGN
 * ---------------------------------------------------------------------------
 * In Homeworld a fighter popping is punctuation; a capital ship dying is an
 * EVENT the player stops to watch. This module encodes that difference as three
 * tiers keyed off the dead hull's bounding radius:
 *
 *   tier 0  r <  32 m   fighters, corvettes, collectors
 *           One frame of white, a fast fireball, a spark sphere, a handful of
 *           tumbling chunks. Over in well under a second.
 *
 *   tier 1  r <  90 m   frigates
 *           A half-second of venting and internal flashes, then the detonation.
 *
 *   tier 2  r >= 90 m   destroyer, cruiser, refinery, carrier, mothership
 *           A 4-8 second sequence:
 *             A. VENT       hull breaches jet atmosphere, internal detonations
 *                           flicker along the spine, drives stutter out.
 *             B. CHAIN      a walking chain of secondary explosions marches the
 *                           length of the hull, each bigger than the last.
 *             C. DETONATION blinding core flash, an incandescent fireball that
 *                           cools through blackbody colours, a thin bright
 *                           shockwave ring, a slower dust wave behind it, a
 *                           blast light, and a cloud of hull sections.
 *             D. BURN       the fireball keeps cooling into black smoke while
 *                           the wreckage drifts apart.
 *
 * ---------------------------------------------------------------------------
 * THE FIREBALL IS A VOLUME, NOT A SPRITE  (critique r1 #1, blocker)
 * ---------------------------------------------------------------------------
 * Round 1 was rejected because the fireball was "an isotropic radial gradient —
 * a single orange falloff around a blown white core, with no internal structure
 * at all". A cloud of soft additive sprites can only ever integrate to a
 * gaussian, so the sprite cloud was demoted to flying tongues of flame and the
 * BODY of the fireball is now a pooled camera-facing quad running
 * `FIREBALL_FRAG`: a domain-warped fbm sampled on the hemisphere of a sphere,
 * hard-thresholded so the silhouette is LOBED and torn instead of circular,
 * with per-cell hot spots, a temperature that falls with radius and age, and a
 * blackbody ramp that carries white -> yellow -> orange -> ember -> dark smoke.
 *
 * It draws with PREMULTIPLIED alpha (src ONE, dst ONE_MINUS_SRC_ALPHA), not
 * additive, which is what lets the cool outer billows and the late smoke
 * OCCLUDE — you get dark lobes silhouetted against the incandescence, exactly
 * what the reference frames do, and it is impossible with additive blending.
 *
 * Every stage is sized off the dead hull's TRUE bounding radius and the main
 * fireball is capped at `FIREBALL_MAX_R` x that radius (critique r1 #4), so a
 * destroyer death can never eat a third of the screen again.
 *
 * Debris is real geometry: six jagged chunk meshes baked at construction from a
 * displaced icosphere (rock) and a displaced box (hull plate), drawn through six
 * `InstancedMesh` draws. Each chunk carries its own tumble, an exponentially
 * cooling emissive term evaluated with the shared `sf_blackbody` ramp, an ember
 * and smoke trail, and a hashed-dither dissolve at the end of its ~20 s life.
 *
 * ---------------------------------------------------------------------------
 * REVISION — round 2 art-direction critique
 * ---------------------------------------------------------------------------
 * Round 2 raised two blockers, both against things that were BUILT and not SEEN:
 *
 *  * "The event log reads 2x LANCE BOMBER LOST / 3x TALON INTERCEPTOR LOST at
 *    00:10 and the frame at 00:12 contains no fireball, no flash, no smoke and
 *    no blast light anywhere — five kills, zero visible death." The tier-0
 *    record retired at 0.9 s and its fireball at 0.62 s, so a two-second gap
 *    between the kill and the shutter left nothing at all. A fighter death now
 *    runs 3.8 s: a 250 ms white-core flash whose radius is allowed to EXCEED the
 *    hull (0.75x -> 1.6x r; a 13 m radius clamped to 0.75x is sub-pixel at
 *    engagement range), a 1.1 s three-lobe fireball capped at 2.4x r, and a
 *    sparse 3.2 s smoke tail. Capitals and frigates are unchanged in shape;
 *    frigates gained a second of tail.
 *
 *  * "What debris survives renders as roughly two hundred pure red-orange dots
 *    at 3-4 px, evenly coloured, unlit, indistinguishable from nav lights or
 *    dead pixels." Three causes. (a) Chunk incandescence was keyed to chunk
 *    MASS, so a 78 m capital plate cooled at 0.24/s and was still emitting eight
 *    seconds after the kill; the rate is now derived from the chunk's own
 *    lifetime and `stepDebris` snaps it to exactly zero at 0.15 * life, per the
 *    reviewer's number, after which the fragment is lit only by the key and the
 *    blast light. (b) Sub-capital fragments were 0.14-0.28 of the hull radius;
 *    they are now 0.20-0.36, so a 27 m hull throws 5-9 m pieces. (c) Most of the
 *    dots were not chunks at all but `debrisTrail` sprites — the detonation
 *    burst is roughly halved and the per-chunk ember trail now stops at heat
 *    0.30 instead of 0.08.
 *
 * `takeBlast` was also hardened: with a fighter record holding its slot for
 * 3.8 s a brawl can saturate the pool, and the round-robin victim selection
 * would happily discard a capital three seconds into a sequence that had not
 * detonated yet.
 *
 * ---------------------------------------------------------------------------
 * BUDGETS
 * ---------------------------------------------------------------------------
 * Everything is pooled and capacity bounded, and every particle emission passes
 * through a per-frame budget, so a 40-ship simultaneous wipe degrades in
 * fidelity instead of stalling the frame. Nothing in `update` allocates.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATOR NOTES
 * ---------------------------------------------------------------------------
 *  - The blast lights are created ONCE and parented to the scene permanently at
 *    zero intensity. Adding or removing a light at runtime invalidates every
 *    material program in three, so the light COUNT must never change; only the
 *    intensity does. The count is chosen from the quality preset at construction
 *    (2 / 4 / 8 / 8) and `setQuality` cannot change it.
 *  - `flash` is a 0..1 screen-flash suggestion for the compositor. Read it after
 *    `update` and fold it into exposure or a white overlay, e.g.
 *    `renderer.toneMappingExposure = CONFIG.exposure * (1 + 1.6 * fx.flash)`.
 *  - Death events are queued on the bus and drained at the top of `update`, so
 *    the particle time base is always the current frame.
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import {
  GLSL_NOISE,
  GLSL_UTIL,
  type RenderContext,
  type RenderSystem,
  type TextureFactory,
} from '../core/contracts';
import { HULL, palette } from '../core/palette';
import { Rng, hash3 } from '../core/rng';
import { Team, type GameEvents, type QualitySettings } from '../core/types';
import type { World } from '../sim/world';
import { P, type ParticleSystem } from './particles';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Bounding radius below which a death is instant (fighters, corvettes). */
const TIER1_RADIUS = 32;
/** Bounding radius at or above which a death gets the full capital sequence. */
const TIER2_RADIUS = 90;

/** Simultaneous death sequences. Beyond this, new deaths recycle the oldest. */
const MAX_BLASTS = 64;
/** Death events bufferable between two frames. */
const MAX_QUEUE = 128;
/** Shockwave ring slots (one draw call each, only while alive). */
const RING_SLOTS = 10;
/** Hard ceiling on live debris chunks across all wrecks. */
const DEBRIS_CAP = 288;
/** Distinct baked chunk meshes: 0-2 rock-like, 3-5 plate-like hull sections. */
const CHUNK_VARIANTS = 6;
/** First plate-like variant index. */
const CHUNK_PLATE0 = 3;
/** Blast light slots. The active count is fixed at construction. */
const MAX_LIGHTS = 8;
/**
 * Inner radius of the shockwave geometry, in units of its outer radius.
 *
 * Round 1 used 0.22, which is precisely what produced the critique's "Saturn
 * ring pasted on": a constant-width annulus whose inner edge is a hard
 * geometric cut. The mesh is now effectively a disc and the ENTIRE radial
 * profile — thin leading rim, soft trailing wash, thickening with age — is
 * shaped in the fragment shader, where it can also be broken up azimuthally.
 */
const RING_INNER = 0.02;
/** Blue-noise dither tile edge, pixels. */
const DITHER_PX = 64;

/** Fireball volume slots (one draw call each, only while alive). */
const FIREBALL_SLOTS = 28;
/**
 * Hard cap on a fireball's outer radius, as a multiple of the dead hull's TRUE
 * bounding radius. Critique r1 #1/#4: "cap the fireball outer radius at 1.6x
 * the dead hull's bounding radius so a destroyer death cannot occupy a third of
 * the screen".
 */
const FIREBALL_MAX_R = 1.6;

/** Per-frame particle emission budget, indexed by quality preset. */
const EMIT_BUDGET = [420, 950, 1900, 3200];
/** Live debris ceiling, indexed by quality preset. */
const DEBRIS_LIMIT = [64, 132, 224, DEBRIS_CAP];
/** Concurrent fireball volumes, indexed by quality preset. Fill-rate bound. */
const FIREBALL_LIMIT = [6, 12, 20, FIREBALL_SLOTS];
/** fbm octaves in the fireball body, indexed by quality preset. */
const FIREBALL_OCT = [2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Module-scope scratch — the hot path never allocates.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _cam = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: 0 };
const UNIT_Z = new THREE.Vector3(0, 0, 1);

/**
 * Blackbody-ish emission ramp used for fireball tints on the CPU. `h` runs
 * 0 (a dull dying ember) .. 1 (a white-hot detonation core). Values well above
 * 1 are intentional: they are linear HDR and are meant to blow out through the
 * bloom pass. Mirrors the feel of `sf_blackbody` in GLSL_UTIL without the cost
 * of matching it exactly.
 */
function bbR(h: number): number { return 0.35 + 5.2 * h; }
function bbG(h: number): number { return 0.05 + 3.4 * h * h; }
function bbB(h: number): number { const q = h * h; return 0.02 + 2.6 * q * q; }

// ---------------------------------------------------------------------------
// Shockwave ring shader
// ---------------------------------------------------------------------------

const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vLocal;   // unit-ring space, |vLocal| in [RING_INNER, 1]
varying vec3 vView;    // view-space vector toward the eye
varying vec3 vNrm;     // view-space ring normal

void main() {
  vLocal = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNrm = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Shock-front profile. Critique r1 #2: round 1 read as "a thin white torus of
 * uniform thickness with a hard inner edge — a Saturn ring pasted on".
 *
 * What a blast front actually looks like, and what this now builds:
 *   - a THIN, very bright compression rim at the leading edge, which is the
 *     only part that is ever near-white;
 *   - a soft trailing wash of entrained, lit dust behind it that THICKENS and
 *     dims as the front expands (`w` grows with `uAge`);
 *   - an azimuthally lobed front — the rim radius and its brightness are both
 *     modulated by seamless angular fbm, so no two arcs of the circle match;
 *   - a dark compression band immediately behind the rim which, drawn with
 *     premultiplied alpha, DARKENS whatever is behind it. That is the cheapest
 *     honest stand-in for refraction available from inside a forward pass:
 *     true backdrop distortion needs a scene-colour tap, which is owned by
 *     renderer.ts, not by this module.
 */
const RING_FRAG = /* glsl */ `
#include <common>
${GLSL_NOISE}
#include <logdepthbuf_pars_fragment>
// NOTE: three injects <tonemapping_pars_fragment> / <colorspace_pars_fragment>
// into every fragment prefix; redeclaring them here would fail to link.

uniform float uAge;      // 0..1 normalised life
uniform float uSeed;     // decorrelates the angular noise between rings
uniform vec3  uCore;     // colour of the front itself
uniform vec3  uEdge;     // colour of the wake behind it
uniform float uOpacity;  // includes the CPU-side r^-1.5 intensity falloff
uniform float uSharp;    // 1 = thin incandescent front, 0 = fat soft dust wave

varying vec2 vLocal;
varying vec3 vView;
varying vec3 vNrm;

void main() {
  #include <logdepthbuf_fragment>

  float r = length(vLocal);
  float t = uAge;

  // Angular noise sampled on the ring's own circumference, so the wobble is
  // seamless across theta = 0. Two scales: one lobes the front, one breaks up
  // its brightness into arcs.
  float ang = atan(vLocal.y, vLocal.x);
  vec2 dir = vec2(cos(ang), sin(ang));
  float nLo = sf_fbm(vec3(dir * 1.6, uSeed * 23.0), 3, 2.0, 0.55);
  float nHi = sf_noise(vec3(dir * 6.1, uSeed * 11.0 + t * 0.35));

  // The front sits at the rim of the (expanding) disc and is lobed, never a
  // perfect circle.
  float c = 0.962 + (nLo - 0.5) * 0.075 * (1.0 - 0.35 * t);
  float x = r - c;

  // Leading rim: tight ahead of the front, and it does NOT fatten with age —
  // a shock front stays thin, it is the wash behind it that spreads.
  float wLead = mix(0.012, 0.030, t) * mix(2.6, 1.0, uSharp) * (0.7 + 0.6 * nHi);
  // Trailing wash: thickens hard as the shell expands and sweeps up dust.
  float wTrail = mix(0.06, 0.46, pow(t, 0.65)) * mix(2.0, 1.0, uSharp) * (0.7 + 0.5 * nLo);

  // Per-channel radial offset — the front splits into a prismatic edge, which
  // is what a steep density gradient does to the light crossing it.
  float disp = 0.016 * uSharp * (0.4 + 0.6 * nHi);
  vec3 rimRgb = vec3(
    exp(-pow((x + disp) / wLead, 2.0)),
    exp(-pow(x / wLead, 2.0)),
    exp(-pow((x - disp) / wLead, 2.0))
  );
  float rim = rimRgb.g;

  // Wash lives strictly INSIDE the front and ramps to nothing going inward.
  float inside = step(x, 0.0);
  float wash = pow(clamp(1.0 + x / wTrail, 0.0, 1.0), 2.4) * inside;
  // Arcs: the wash is not uniform around the circle either.
  wash *= 0.55 + 0.75 * nLo;

  // Compression shadow: a dark hairline immediately behind the rim. With
  // premultiplied alpha this multiplies the backdrop down, so the front reads
  // as a lens of dense gas rather than a decal.
  float lens = exp(-pow((x + wLead * 2.1) / (wLead * 1.6), 2.0)) * inside * uSharp;

  float bright = 0.55 + 0.85 * nHi;
  vec3 col = uCore * rimRgb * bright + uEdge * wash * 0.55;

  // View-angle shaping. A real shell has the most gas along a glancing sight
  // line, so brighten as the normal turns away — but a FLAT disc seen dead
  // edge-on degenerates into a hard bar across the screen, so the last few
  // degrees are faded out instead.
  float face = abs(dot(normalize(vNrm), normalize(vView)));
  float graze = 1.0 - face;
  float edgeFade = smoothstep(0.0, 0.22, face);
  col *= mix(1.0, 1.0 + 0.9 * graze * graze, uSharp);

  // Coverage: the rim is nearly opaque, the wash is thin gas, the lens band is
  // opaque-but-black.
  float a = clamp(rim * 0.85 + wash * 0.30 + lens * 0.34, 0.0, 1.0);
  a *= uOpacity * edgeFade * (1.0 - smoothstep(0.72, 1.0, t)) * smoothstep(0.0, 0.04, t);
  if (a < 0.004) discard;

  gl_FragColor = vec4(col, a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Premultiply AFTER grading: the blend is (src.rgb + dst * (1 - src.a)), so
  // the dark lens band subtracts from the backdrop and the hot rim adds to it.
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;

// ---------------------------------------------------------------------------
// Fireball volume shader  (critique r1 #1, blocker)
// ---------------------------------------------------------------------------

/**
 * Camera-facing quad built entirely in view space, so the billboard costs no
 * CPU work at all: the model matrix contributes only a translation and the
 * corner offset is applied after the view transform. `uRoll` spins the sprite
 * about the view axis so overlapping lobes never share a noise orientation.
 */
const FIREBALL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uRadius;
uniform float uRoll;

varying vec2 vP;

void main() {
  vP = position.xy;
  float c = cos(uRoll), s = sin(uRoll);
  vec2 rp = vec2(vP.x * c - vP.y * s, vP.x * s + vP.y * c);
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += rp * uRadius;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

/**
 * The body of the fireball.
 *
 * `vP` is the unit disc. Lifting it onto the front hemisphere gives a genuine
 * 3D sample point, so the fbm reads as a VOLUME that rolls, not as a flat
 * texture. The density is then hard-thresholded: that is the single most
 * important line in the file, because a threshold on fbm produces a torn,
 * lobed boundary whereas any smooth falloff — the round-1 failure — can only
 * produce a gaussian.
 *
 * Temperature is a separate field from density: it falls with radius and with
 * age, and a sharpened copy of the density adds discrete internal hot spots.
 * `sf_blackbody` then carries white -> yellow -> orange -> ember, and once the
 * temperature is gone the same density is drawn as dark, OCCLUDING smoke.
 */
const FIREBALL_FRAG = /* glsl */ `
#include <common>
${GLSL_NOISE}
${GLSL_UTIL}
#include <logdepthbuf_pars_fragment>

uniform float uAge;      // 0..1 normalised life
uniform float uSeed;
uniform float uHeat;     // 0..1 peak temperature at birth
uniform float uOpacity;
uniform vec3  uTint;     // slight faction/soot tint on the cool end
uniform int   uOct;      // fbm octaves, from the quality preset

varying vec2 vP;

/**
 * Fire ramp, 0 = dead ember .. 1 = white-hot core, linear HDR.
 *
 * NOT sf_blackbody: that ramp is calibrated for METAL (it is what the debris
 * uses) and reaches white by t = 0.5, so a fireball driven through it is a
 * washed cream ball with no hue at all — which is exactly how the first two
 * attempts at this shader read. This is the GLSL twin of the module's CPU-side
 * bbR/bbG/bbB: red rises linearly, green quadratically and blue quartically, so
 * the gas holds a saturated orange over most of its life and only the hottest
 * cells go yellow-white.
 */
vec3 sfFire(float h) {
  float q = h * h;
  return vec3(0.35 + 5.2 * h, 0.05 + 3.4 * q, 0.02 + 2.6 * q * q);
}

void main() {
  #include <logdepthbuf_fragment>

  float r2 = dot(vP, vP);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  float t = uAge;

  // -- volume sample point: the front hemisphere of the ball.
  vec3 sp = vec3(vP, sqrt(max(0.0, 1.0 - r2)) * 0.85);
  vec3 off = vec3(uSeed * 37.0, uSeed * 61.0, uSeed * 91.0);

  // Features grow as the ball expands, so the cells inflate with it instead of
  // crawling through a fixed field.
  float fr = mix(3.1, 1.5, t);
  vec3 q = sp * fr + off;

  // -- domain warp: this is what makes the mass BILLOW.
  vec3 w = vec3(
    sf_noise(q * 0.85 + vec3(3.1, 1.7, 0.0)),
    sf_noise(q * 0.85 + vec3(8.3, 2.8, 5.0)),
    sf_noise(q * 0.85 + vec3(1.1, 6.5, 9.0))
  ) - 0.5;
  float d = sf_fbm(q + w * (1.6 + 1.1 * t) - vec3(0.0, 0.0, t * 1.15), uOct, 2.15, 0.55);

  // -- lobed silhouette. The boundary radius is pushed and pulled by a low
  //    frequency field, then the density is THRESHOLDED, so the edge is torn.
  float lobe = sf_noise(vec3(normalize(vec3(vP, 0.55)) * 2.2 + off));
  float rad = r * (1.22 - 0.42 * lobe);
  float body = 1.0 - smoothstep(0.34, 1.0, rad);
  float dens = body * (0.30 + 1.45 * d);
  // Late in life the ball is torn apart rather than shrunk: raising the
  // threshold eats it from the thin parts inward.
  float thr = mix(0.28, 0.60, smoothstep(0.45, 1.0, t));
  float mask = smoothstep(thr, thr + 0.30, dens);
  if (mask < 0.004) discard;

  // -- temperature. Interior + dense cells are hot; everything cools with age.
  float core = smoothstep(1.0, 0.05, rad);
  float spot = pow(clamp(d * 1.35, 0.0, 1.0), 5.0);           // discrete hot cells
  float cool = pow(clamp(1.0 - t, 0.0, 1.0), 1.35);
  // ROUND 2: the weights were tuned so that a typical BODY sample (core ~1,
  // d ~0.6, spot 0) reached T = 1.27, i.e. every channel of sfFire several
  // stops over white — the whole ball clipped to flat cream and every bit of
  // internal structure the fbm was computing died in the tone map. The body now
  // lands near T = 0.8, where sfFire is (4.6, 2.3, 1.2): red clips, green and
  // blue do not, so the mass rolls off through ORANGE and only the discrete hot
  // CELLS (the "spot" term, weight 1.5 -> 1.9) go to white. That contrast is the
  // whole reason for computing a volume instead of a radial gradient.
  float T = uHeat * cool * (0.14 + 0.40 * core + 0.46 * clamp(d, 0.0, 1.0) + 1.9 * spot);
  T = clamp(T, 0.0, 1.15);

  // Incandescence, HDR so the hot cells punch through the bloom. The low-end
  // gate is what keeps the cool fringes genuinely DARK instead of a uniform
  // wash — most of the ball's structure lives in that contrast.
  vec3 fire = sfFire(T) * (0.80 * smoothstep(0.03, 0.30, T));
  // -- soot. What is left once the temperature has gone: it must be DARK and
  //    it must occlude, so cool lobes silhouette against hot ones.
  float soot = clamp(1.0 - T * 2.2, 0.0, 1.0);
  vec3 smoke = uTint * (0.030 + 0.055 * d) * (0.4 + 0.6 * core);
  vec3 col = fire + smoke * soot;

  // Thin gas at the fringe stays translucent; dense mass is opaque.
  float a = mask * mix(0.22, 1.0, clamp(dens * 1.15, 0.0, 1.0));
  a *= uOpacity * (1.0 - smoothstep(0.78, 1.0, t)) * smoothstep(0.0, 0.05, t);
  if (a < 0.004) discard;

  gl_FragColor = vec4(col, a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  gl_FragColor.rgb *= gl_FragColor.a;
}
`;

// ---------------------------------------------------------------------------
// Pooled records
// ---------------------------------------------------------------------------

/** One staged death sequence in flight. Plain fields; never reallocated. */
class Blast {
  alive = false;
  /** Seconds since the ship died. */
  t = 0;
  /** Tier: 0 fighter, 1 frigate, 2 capital. */
  tier: 0 | 1 | 2 = 0;
  /** Absolute local time at which the chain stage starts. */
  chainAt = 0;
  /** Absolute local time of the main detonation. */
  detAt = 0;
  /** Absolute local time at which the record retires (debris outlives it). */
  endAt = 0;
  detonated = false;

  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Hull long axis (unit) and an orthonormal complement for hull offsets. */
  ax = 0; ay = 0; az = 1;
  bx = 1; by = 0; bz = 0;
  cx = 0; cy = 1; cz = 0;

  radius = 10;
  /** Half the hull length along `a`, metres. */
  halfLen = 10;
  seed = 0;
  team: Team = Team.Neutral;
  /** Team drive colour, used to tint the shock front and the vent glow. */
  tr = 1; tg = 1; tb = 1;

  /** Countdown to the next vent jet / internal flicker. */
  ventT = 0;
  /** Countdown to the next secondary in the walking chain. */
  chainT = 0;
  /** Secondaries fired so far, and how many the chain holds. */
  chainI = 0;
  chainN = 0;
  /** Countdown to the next cooling puff during the burn stage. */
  burnT = 0;
}

/** One live debris chunk. */
class Chunk {
  alive = false;
  variant = 0;
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Orientation quaternion, integrated from the angular velocity below. */
  qx = 0; qy = 0; qz = 0; qw = 1;
  wx = 0; wy = 0; wz = 0;
  sx = 1; sy = 1; sz = 1;
  /** Largest world-space half-extent, metres — drives trail scale. */
  size = 1;
  age = 0;
  life = 1;
  /** Seconds of dissolve at the end of life. */
  fadeFor = 1;
  /** 0..1 incandescence, cooling exponentially at `cool` per second. */
  heat = 1;
  cool = 1;
  /** Seconds after which incandescence is forced to exactly zero. */
  heat0 = 1;
  /** Velocity damping rate, 1/s. Space is empty; this is purely for grace. */
  drag = 0;
  trailT = 0;
  trailGap = 0.1;
  /** Alternates so smoke is emitted on half the trail ticks. */
  trailFlip = false;
  rand = 0;
}

/** One shockwave ring slot: its own mesh and uniforms, shared geometry. */
class Ring {
  alive = false;
  t = 0;
  life = 1;
  r0 = 1;
  r1 = 10;
  /** Drift with the wreck so the ring does not sit still in a moving fight. */
  vx = 0; vy = 0; vz = 0;
  /** Base opacity before the r^-n expansion falloff is applied per frame. */
  opacity = 1;
  mesh!: THREE.Mesh;
  mat!: THREE.ShaderMaterial;
}

/**
 * One fireball volume: a pooled camera-facing quad running `FIREBALL_FRAG`.
 *
 * `t` starts NEGATIVE for staggered lobes — a capital detonation lights four
 * of these a few frames apart so the ball unfolds instead of appearing whole.
 */
class Fireball {
  alive = false;
  /** Seconds since birth; negative while the lobe is still waiting its turn. */
  t = 0;
  life = 1;
  r0 = 1;
  r1 = 10;
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  roll = 0;
  spin = 0;
  mesh!: THREE.Mesh;
  mat!: THREE.ShaderMaterial;
}

/** One pooled blast light. */
class Flare {
  light!: THREE.PointLight;
  t = 0;
  life = 0;
  peak = 0;
}

/** A queued death event, copied out of the (reusable) bus payload. */
class Queued {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  radius = 0;
  team: Team = Team.Neutral;
}

// ---------------------------------------------------------------------------
// Chunk geometry baking
// ---------------------------------------------------------------------------

/**
 * Bake one jagged debris chunk.
 *
 * The displacement is keyed off the QUANTISED vertex position rather than the
 * vertex index, so vertices that share a location across a seam (every corner
 * of a `BoxGeometry`) receive the identical offset and the shell stays closed.
 * The result is converted to non-indexed and re-normalled, giving hard faceted
 * shading that reads as torn plate at any distance.
 *
 * @param rng   deterministic source for this variant
 * @param plate true for a flat hull-section slab, false for a rock-like lump
 */
function buildChunkGeometry(rng: Rng, plate: boolean): THREE.BufferGeometry {
  const src: THREE.BufferGeometry = plate
    ? new THREE.BoxGeometry(1.9, 0.62, 1.2, 3, 1, 2)
    : new THREE.IcosahedronGeometry(0.75, 1);

  const salt = rng.int(0, 0xffff);
  const amp = plate ? 0.30 : 0.46;
  const pos = src.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const kx = Math.round(x * 64), ky = Math.round(y * 64), kz = Math.round(z * 64);
    // Radial swell/pinch plus a small independent lateral shear.
    const d = 1 + (hash3(kx, ky, kz + salt) - 0.5) * 2 * amp;
    const jx = (hash3(kx + 71, ky, kz + salt) - 0.5) * amp * 0.55;
    const jy = (hash3(kx, ky + 131, kz + salt) - 0.5) * amp * 0.55;
    const jz = (hash3(kx, ky, kz + 197 + salt) - 0.5) * amp * 0.55;
    pos.setXYZ(i, x * d + jx, y * d + jy, z * d + jz);
  }

  // NB: `IcosahedronGeometry` is already non-indexed, and `toNonIndexed` hands
  // back `this` in that case — disposing unconditionally would kill the result.
  const geo = src.index ? src.toNonIndexed() : src;
  if (geo !== src) src.dispose();
  geo.computeBoundingSphere();
  // Normalise to a unit bounding radius so per-chunk scale is in real metres.
  const r = geo.boundingSphere ? Math.max(1e-4, geo.boundingSphere.radius) : 1;
  geo.scale(1 / r, 1 / r, 1 / r);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// ExplosionFx
// ---------------------------------------------------------------------------

/**
 * Ship-death effects: staged detonations, shockwave rings, blast lights and
 * instanced tumbling debris.
 *
 * Subscribe-and-forget — construct it, call `update` every frame, and it drives
 * itself off the `death` event.
 *
 * ```ts
 * const boom = new ExplosionFx(scene, particles, textures, quality);
 * // per frame, after particles have been given the frame's context:
 * boom.update(ctx, world);
 * renderer.toneMappingExposure = CONFIG.exposure * (1 + 1.6 * boom.flash);
 * ```
 */
export class ExplosionFx implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticleSystem;
  private readonly rng = new Rng(0x9e12ab3);
  private quality: QualitySettings;

  // -- death event queue ----------------------------------------------------
  private readonly queue: Queued[] = [];
  private queueN = 0;
  private readonly unsubscribe: () => void;

  // -- blasts ---------------------------------------------------------------
  private readonly blasts: Blast[] = [];
  private blastCursor = 0;

  // -- debris ---------------------------------------------------------------
  private readonly chunks: Chunk[] = [];
  private readonly chunkFree: number[] = [];
  private chunkCursor = 0;
  private chunkLimit = DEBRIS_CAP;
  private readonly chunkGeom: THREE.BufferGeometry[] = [];
  private readonly chunkMesh: THREE.InstancedMesh[] = [];
  private readonly chunkHeat: THREE.InstancedBufferAttribute[] = [];
  private readonly chunkFade: THREE.InstancedBufferAttribute[] = [];
  private readonly chunkRand: THREE.InstancedBufferAttribute[] = [];
  private readonly chunkCount: Int32Array = new Int32Array(CHUNK_VARIANTS);
  private readonly debrisMat: THREE.MeshStandardMaterial;
  private readonly dither: THREE.Texture;
  private readonly ownDither: boolean;

  // -- rings ----------------------------------------------------------------
  private readonly rings: Ring[] = [];
  private readonly ringGeom: THREE.RingGeometry;

  // -- fireball volumes -----------------------------------------------------
  private readonly fireballs: Fireball[] = [];
  private readonly fireballGeom: THREE.PlaneGeometry;
  private fireballLimit = FIREBALL_SLOTS;

  // -- lights ---------------------------------------------------------------
  private readonly flares: Flare[] = [];

  // -- per-frame state ------------------------------------------------------
  /** Remaining particle allowance this frame. */
  private budget = 0;
  private emitPerFrame = EMIT_BUDGET[2];
  private _flash = 0;

  /**
   * @param scene     where debris, rings and blast lights are parented
   * @param particles the shared particle engine — all sprites route through it
   * @param textures  procedural texture factory (blue noise for the dissolve)
   * @param quality   drives emission budgets, debris count and the light count
   */
  constructor(
    scene: THREE.Scene,
    particles: ParticleSystem,
    textures: TextureFactory,
    quality: QualitySettings,
  ) {
    this.scene = scene;
    this.particles = particles;
    this.quality = quality;

    for (let i = 0; i < MAX_QUEUE; i++) this.queue.push(new Queued());
    for (let i = 0; i < MAX_BLASTS; i++) this.blasts.push(new Blast());

    // -- dither tile ------------------------------------------------------
    let dither: THREE.Texture | null = null;
    let owned = false;
    try {
      dither = textures.blueNoise(DITHER_PX);
    } catch {
      dither = null;
    }
    if (!dither) {
      // Deterministic white-noise fallback. Slightly worse dissolve pattern
      // than blue noise, identical cost.
      const n = DITHER_PX * DITHER_PX;
      const data = new Uint8Array(n * 4);
      const r = this.rng.fork(7);
      for (let i = 0; i < n; i++) {
        const v = (r.next() * 255) | 0;
        data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, DITHER_PX, DITHER_PX);
      tex.needsUpdate = true;
      dither = tex;
      owned = true;
    }
    dither.wrapS = THREE.RepeatWrapping;
    dither.wrapT = THREE.RepeatWrapping;
    dither.minFilter = THREE.NearestFilter;
    dither.magFilter = THREE.NearestFilter;
    dither.generateMipmaps = false;
    this.dither = dither;
    this.ownDither = owned;

    // -- debris material --------------------------------------------------
    this.debrisMat = this.buildDebrisMaterial();

    // -- debris geometry + instanced meshes -------------------------------
    const grng = this.rng.fork(31);
    for (let v = 0; v < CHUNK_VARIANTS; v++) {
      const geo = buildChunkGeometry(grng.fork(v), v >= CHUNK_PLATE0);
      const heat = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAP), 1);
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAP), 1);
      const rand = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAP), 1);
      heat.setUsage(THREE.DynamicDrawUsage);
      fade.setUsage(THREE.DynamicDrawUsage);
      rand.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aHeat', heat);
      geo.setAttribute('aFade', fade);
      geo.setAttribute('aRand', rand);

      const im = new THREE.InstancedMesh(geo, this.debrisMat, DEBRIS_CAP);
      im.name = `fx.debris.${v}`;
      im.count = 0;
      im.frustumCulled = false; // wreckage scatters far beyond any local bound
      im.matrixAutoUpdate = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);

      this.chunkGeom.push(geo);
      this.chunkMesh.push(im);
      this.chunkHeat.push(heat);
      this.chunkFade.push(fade);
      this.chunkRand.push(rand);
    }
    for (let i = 0; i < DEBRIS_CAP; i++) {
      this.chunks.push(new Chunk());
      this.chunkFree.push(DEBRIS_CAP - 1 - i);
    }

    // -- shockwave rings ---------------------------------------------------
    // Effectively a disc: the radial profile is entirely the shader's business
    // now, so the geometry must not impose an inner edge of its own.
    this.ringGeom = new THREE.RingGeometry(RING_INNER, 1, 160, 2);
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = new Ring();
      r.mat = new THREE.ShaderMaterial({
        uniforms: {
          uAge: { value: 0 },
          uSeed: { value: 0 },
          uCore: { value: new THREE.Color(1, 1, 1) },
          uEdge: { value: new THREE.Color(1, 0.5, 0.2) },
          uOpacity: { value: 1 },
          uSharp: { value: 1 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        // Premultiplied, not additive: the compression band behind the rim has
        // to be able to DARKEN the backdrop (critique r1 #2 — "distorts what is
        // behind it"). See RING_FRAG.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      });
      r.mat.name = `fx.shockwave.${i}`;
      r.mesh = new THREE.Mesh(this.ringGeom, r.mat);
      r.mesh.name = `fx.shockwave.${i}`;
      r.mesh.frustumCulled = false;
      r.mesh.matrixAutoUpdate = false;
      r.mesh.renderOrder = 22; // above both particle pools
      r.mesh.visible = false;
      scene.add(r.mesh);
      this.rings.push(r);
    }

    // -- fireball volumes --------------------------------------------------
    // A single 2x2 quad shared by every slot; the vertex shader turns it into
    // a view-space billboard, so no CPU orientation work is ever done.
    this.fireballGeom = new THREE.PlaneGeometry(2, 2, 1, 1);
    for (let i = 0; i < FIREBALL_SLOTS; i++) {
      const f = new Fireball();
      f.mat = new THREE.ShaderMaterial({
        uniforms: {
          uAge: { value: 0 },
          uSeed: { value: 0 },
          uHeat: { value: 1 },
          uOpacity: { value: 1 },
          uRadius: { value: 1 },
          uRoll: { value: 0 },
          uTint: { value: new THREE.Color(1, 0.85, 0.75) },
          uOct: { value: FIREBALL_OCT[2] },
        },
        vertexShader: FIREBALL_VERT,
        fragmentShader: FIREBALL_FRAG,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        // PREMULTIPLIED alpha. Additive cannot darken, and a fireball whose
        // cool lobes cannot darken is the gaussian blob round 1 was rejected
        // for. See the module header.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      });
      f.mat.name = `fx.fireball.${i}`;
      f.mesh = new THREE.Mesh(this.fireballGeom, f.mat);
      f.mesh.name = `fx.fireball.${i}`;
      f.mesh.frustumCulled = false;
      f.mesh.matrixAutoUpdate = false;
      f.mesh.renderOrder = 21; // under the shock front, over the particles
      f.mesh.visible = false;
      scene.add(f.mesh);
      this.fireballs.push(f);
    }

    // -- blast lights ------------------------------------------------------
    // The COUNT is frozen here: mutating it at runtime would recompile every
    // material in the scene.
    const lightCount = quality.preset <= 0 ? 2 : quality.preset === 1 ? 4 : MAX_LIGHTS;
    for (let i = 0; i < lightCount; i++) {
      const f = new Flare();
      f.light = new THREE.PointLight(0xffb070, 0, 1000, 2);
      f.light.name = `fx.blastLight.${i}`;
      f.light.castShadow = false;
      f.light.visible = false;
      scene.add(f.light);
      this.flares.push(f);
    }

    this.applyQuality(quality);

    this.unsubscribe = bus.on('death', this.onDeath);
  }

  // -- public readouts ------------------------------------------------------

  /**
   * Screen-flash suggestion, 0..1, spiked by every detonation in proportion to
   * its size and inverse camera distance and decaying fast. Fold it into
   * exposure or a white overlay; ignoring it is harmless.
   */
  get flash(): number {
    return this._flash;
  }

  /** Live death sequences (debug HUD). */
  get liveBlasts(): number {
    let n = 0;
    for (let i = 0; i < MAX_BLASTS; i++) if (this.blasts[i].alive) n++;
    return n;
  }

  /** Live debris chunks (debug HUD). */
  get liveDebris(): number {
    return DEBRIS_CAP - this.chunkFree.length;
  }

  /** Live fireball volumes (debug HUD / capture probes). */
  get liveFireballs(): number {
    let n = 0;
    for (let i = 0; i < this.fireballs.length; i++) if (this.fireballs[i].alive) n++;
    return n;
  }

  // -- event intake ---------------------------------------------------------

  /**
   * Bus handler. Bound as a field so `dispose` can unsubscribe the exact
   * reference. The payload may be recycled by the emitter, so every field is
   * copied into the queue immediately; the sequence itself starts at the top of
   * the next `update`, where the particle time base is correct.
   */
  private onDeath = (e: GameEvents['death']): void => {
    if (this.queueN >= MAX_QUEUE) return; // pathological wipe: drop the extras
    const q = this.queue[this.queueN++];
    q.x = e.x; q.y = e.y; q.z = e.z;
    q.vx = e.vx; q.vy = e.vy; q.vz = e.vz;
    q.radius = e.radius > 0.5 ? e.radius : 0.5;
    q.team = e.team;
  };

  // -- frame ----------------------------------------------------------------

  /** Advance every stage, integrate debris, refresh instance buffers. */
  update(ctx: RenderContext, _world: World): void {
    // Clamp the step: a tab-out must not teleport a whole sequence.
    const dt = ctx.dt > 0.1 ? 0.1 : ctx.dt > 0 ? ctx.dt : 0;
    this.budget = this.emitPerFrame;
    ctx.camera.getWorldPosition(_cam);

    // Screen flash decays at ~6/s, so a spike is gone inside a quarter second.
    this._flash *= Math.exp(-dt * 6);
    if (this._flash < 1e-3) this._flash = 0;

    for (let i = 0; i < this.queueN; i++) this.spawnBlast(this.queue[i]);
    this.queueN = 0;

    for (let i = 0; i < MAX_BLASTS; i++) {
      const b = this.blasts[i];
      if (b.alive) this.stepBlast(b, dt);
    }

    this.stepDebris(dt);
    this.stepFireballs(dt);
    this.stepRings(dt);
    this.stepLights(dt);
  }

  /**
   * Re-budget for a new quality preset. The blast LIGHT COUNT is fixed at
   * construction and is deliberately not touched here.
   */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.applyQuality(q);
  }

  private applyQuality(q: QualitySettings): void {
    const p = q.preset < 0 ? 0 : q.preset > 3 ? 3 : q.preset;
    this.emitPerFrame = EMIT_BUDGET[p];
    this.chunkLimit = DEBRIS_LIMIT[p];
    // The fireball body is fill-rate bound, so both the concurrent count and
    // the fbm octave count come off the preset.
    this.fireballLimit = FIREBALL_LIMIT[p];
    const oct = FIREBALL_OCT[p];
    for (let i = 0; i < this.fireballs.length; i++) {
      this.fireballs[i].mat.uniforms.uOct.value = oct;
    }
  }

  /** Kill every live effect immediately (mission restart). */
  clear(): void {
    for (let i = 0; i < MAX_BLASTS; i++) this.blasts[i].alive = false;
    for (let i = 0; i < DEBRIS_CAP; i++) {
      if (this.chunks[i].alive) {
        this.chunks[i].alive = false;
        this.chunkFree.push(i);
      }
    }
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].alive = false;
      this.rings[i].mesh.visible = false;
    }
    for (let i = 0; i < this.fireballs.length; i++) {
      this.fireballs[i].alive = false;
      this.fireballs[i].mesh.visible = false;
    }
    for (let i = 0; i < this.flares.length; i++) {
      this.flares[i].life = 0;
      this.flares[i].light.intensity = 0;
      this.flares[i].light.visible = false;
    }
    for (let v = 0; v < CHUNK_VARIANTS; v++) this.chunkMesh[v].count = 0;
    this.queueN = 0;
    this._flash = 0;
  }

  dispose(): void {
    this.unsubscribe();
    for (let v = 0; v < CHUNK_VARIANTS; v++) {
      this.scene.remove(this.chunkMesh[v]);
      this.chunkMesh[v].dispose();
      this.chunkGeom[v].dispose();
    }
    for (let i = 0; i < this.rings.length; i++) {
      this.scene.remove(this.rings[i].mesh);
      this.rings[i].mat.dispose();
    }
    this.ringGeom.dispose();
    for (let i = 0; i < this.fireballs.length; i++) {
      this.scene.remove(this.fireballs[i].mesh);
      this.fireballs[i].mat.dispose();
    }
    this.fireballGeom.dispose();
    for (let i = 0; i < this.flares.length; i++) {
      this.scene.remove(this.flares[i].light);
      this.flares[i].light.dispose();
    }
    this.debrisMat.dispose();
    if (this.ownDither) this.dither.dispose();
  }

  // =========================================================================
  // Emission budget
  // =========================================================================

  /**
   * Claim up to `n` particles from this frame's allowance. Returns what was
   * actually granted — callers must honour it, which is what keeps a 40-ship
   * wipe from spending 100k particles in one frame.
   */
  private take(n: number): number {
    if (n <= 0 || this.budget <= 0) return 0;
    const k = n < this.budget ? n : this.budget;
    this.budget -= k;
    return k | 0;
  }

  /** Budgeted `ParticleSystem.burst`. Aim axis (for cone/disc presets) is P.v*. */
  private pb(
    x: number, y: number, z: number,
    count: number, preset: string, scale: number,
    r?: number, g?: number, b?: number,
  ): void {
    const n = this.take(count);
    if (n > 0) this.particles.burst(x, y, z, n, preset, scale, r, g, b);
  }

  /**
   * Perceptual event scale for particle presets, metres.
   *
   * `ParticleSystem.burst` multiplies sprite SIZE linearly and LIFETIME by
   * scale^0.35, so feeding it the true radius of a 1 km hull asks for 2 km
   * sprites that live for half a minute — three of those and the screen is a
   * white sheet. Compressing the scale sub-linearly keeps fighters exactly as
   * calibrated (pscale(13) ~ 13) while a mothership emits a cloud of many
   * readable puffs instead of one opaque wall. Geometry — hull sample points,
   * rings, debris — always uses the TRUE radius; only particles use this.
   */
  private pscale(r: number): number {
    return 18 * Math.pow(r / 18, 0.62);
  }

  /**
   * Emit a cloud of incandescent gas with an explicit blackbody tint, so a
   * fireball can be aged by the CALLER instead of being locked to a preset's
   * ramp. This is what lets the capital fireball cool visibly from white
   * through orange into black smoke over a second and a half.
   *
   * @param spread birth scatter radius, metres
   * @param speed  peak outward speed, m/s
   * @param heat   0..1 blackbody temperature at birth
   * @param kind   0 soft blob, 1 animated fire sheet
   */
  private hotCloud(
    x: number, y: number, z: number,
    count: number, spread: number, speed: number,
    size: number, sizeEnd: number, life: number,
    heat: number, kind: 0 | 1, drag: number,
  ): void {
    const n = this.take(count);
    if (n <= 0) return;
    const rng = this.rng;
    const hEnd = heat * 0.3;
    P.kind = kind;
    P.additive = true;
    P.stretch = 0;
    P.turbulence = 0.35;
    P.r = bbR(heat); P.g = bbG(heat); P.b = bbB(heat);
    P.rEnd = bbR(hEnd) * 0.22; P.gEnd = bbG(hEnd) * 0.22; P.bEnd = bbB(hEnd) * 0.22;
    P.alpha = 1;
    P.alphaEnd = 0;
    P.drag = drag;
    for (let i = 0; i < n; i++) {
      rng.onSphere(_dir);
      // Cube-root-ish bias pushes samples toward the shell of the sphere.
      const rr = Math.pow(rng.next(), 0.4);
      P.x = x + _dir.x * spread * rr;
      P.y = y + _dir.y * spread * rr;
      P.z = z + _dir.z * spread * rr;
      const sp = speed * (0.3 + 0.7 * rng.next());
      P.vx = _dir.x * sp;
      P.vy = _dir.y * sp;
      P.vz = _dir.z * sp;
      const j = 0.68 + 0.64 * rng.next();
      P.size = size * j;
      P.sizeEnd = sizeEnd * j;
      P.life = life * (0.7 + 0.6 * rng.next());
      P.spin = rng.sign() * 0.9;
      this.particles.emit();
    }
  }

  // =========================================================================
  // Blast lifecycle
  // =========================================================================

  /**
   * Claim a blast slot, recycling the one closest to finishing if the pool is
   * saturated.
   *
   * Round 1 recycled in round-robin order, which was fine when a fighter record
   * lived 0.9 s. Now that a fighter's smoke tail holds its slot for 3.8 s, a
   * brawl can saturate the pool, and a blind round-robin would happily steal the
   * slot of a capital that is three seconds into its vent-chain-detonate
   * sequence and has not gone off yet — the sequence would simply vanish. An
   * un-detonated capital is therefore the LAST thing given up: its score is
   * pushed below anything else in flight.
   */
  private takeBlast(): Blast {
    for (let i = 0; i < MAX_BLASTS; i++) {
      const b = this.blasts[i];
      if (!b.alive) return b;
    }
    let victim = this.blasts[this.blastCursor];
    let worst = -1;
    for (let i = 0; i < MAX_BLASTS; i++) {
      const b = this.blasts[i];
      // Fraction of the record's own life already spent; higher = closer to done.
      let score = b.endAt > 1e-3 ? b.t / b.endAt : 1;
      if (b.tier === 2 && !b.detonated) score -= 2;
      if (score > worst) { worst = score; victim = b; }
    }
    this.blastCursor = (this.blastCursor + 1) % MAX_BLASTS;
    return victim;
  }

  /** Turn a queued death into a staged sequence. */
  private spawnBlast(q: Queued): void {
    const b = this.takeBlast();
    const rng = this.rng;
    const r = q.radius;

    b.alive = true;
    b.t = 0;
    b.detonated = false;
    b.x = q.x; b.y = q.y; b.z = q.z;
    b.vx = q.vx; b.vy = q.vy; b.vz = q.vz;
    b.radius = r;
    // The registry keeps length ~= 2 * radius for every hull, so the bounding
    // radius doubles as the half-length along the spine.
    b.halfLen = r * 0.95;
    b.seed = rng.next();
    b.team = q.team;
    b.tier = r < TIER1_RADIUS ? 0 : r < TIER2_RADIUS ? 1 : 2;

    const pal = palette(q.team === Team.Player || q.team === Team.Enemy ? q.team : Team.Neutral);
    b.tr = pal.engine.r; b.tg = pal.engine.g; b.tb = pal.engine.b;

    // -- hull axis: the direction of travel is the ship's spine to within a
    //    few degrees. Fall back to a seeded direction for a dead stop.
    const sp = Math.hypot(q.vx, q.vy, q.vz);
    if (sp > 1) {
      b.ax = q.vx / sp; b.ay = q.vy / sp; b.az = q.vz / sp;
    } else {
      rng.onSphere(_dir);
      b.ax = _dir.x; b.ay = _dir.y; b.az = _dir.z;
    }
    this.basis(b);

    // -- stage timings ------------------------------------------------------
    if (b.tier === 2) {
      const vent = Math.min(3.2, 1.1 + r * 0.0021);
      const chain = Math.min(2.6, 0.85 + r * 0.0016);
      b.chainAt = vent;
      b.detAt = vent + chain;
      b.endAt = b.detAt + 3.0;
      b.chainN = rng.int(5, 9);
    } else if (b.tier === 1) {
      b.chainAt = 0.26;
      b.detAt = 0.5;
      b.endAt = b.detAt + 2.6;
      b.chainN = 2;
    } else {
      // CRITIQUE r2 reviewer 2 (blocker): "the event log reads 2x LANCE BOMBER
      // LOST / 3x TALON INTERCEPTOR LOST at 00:10 and the frame at 00:12
      // contains no fireball, no flash, no smoke and no blast light anywhere —
      // five kills, zero visible death." The whole tier-0 record retired at 0.9 s
      // and its fireball at 0.62 s, so a two-second gap between the kill and the
      // shutter left literally nothing on screen. The record now lives 3.8 s,
      // which is the smoke tail; the fireball itself is at 1.1 s (see
      // `detonate`) so the incandescent stage still reads as punctuation.
      b.chainAt = 0;
      b.detAt = 0;
      b.endAt = 3.8;
      b.chainN = 0;
    }
    b.chainI = 0;
    b.ventT = 0;
    b.chainT = 0;
    b.burnT = 0;

    if (b.tier === 0) this.detonate(b);
  }

  /** Rebuild the orthonormal complement (b, c) of the hull axis a. */
  private basis(b: Blast): void {
    const ax = b.ax, ay = b.ay, az = b.az;
    // Cross with whichever world axis is least aligned, to dodge degeneracy.
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
    b.bx = cx; b.by = cy; b.bz = cz;
    b.cx = ay * cz - az * cy;
    b.cy = az * cx - ax * cz;
    b.cz = ax * cy - ay * cx;
  }

  /**
   * Sample a point on the hull surface into `_v`: `u` runs -1..1 along the
   * spine, `phi` around it, `rad` in units of the hull radius.
   */
  private hullPoint(b: Blast, u: number, phi: number, rad: number): void {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const rr = b.radius * rad;
    _v.set(
      b.x + b.ax * b.halfLen * u + (b.bx * cp + b.cx * sp) * rr,
      b.y + b.ay * b.halfLen * u + (b.by * cp + b.cy * sp) * rr,
      b.z + b.az * b.halfLen * u + (b.bz * cp + b.cz * sp) * rr,
    );
    // The outward normal at that point, in _sc.
    _sc.set(b.bx * cp + b.cx * sp, b.by * cp + b.cy * sp, b.bz * cp + b.cz * sp);
  }

  /** Advance one sequence by `dt`. */
  private stepBlast(b: Blast, dt: number): void {
    b.t += dt;
    // The wreck keeps its momentum through the whole sequence.
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    if (!b.detonated) {
      if (b.t < b.chainAt) this.stageVent(b, dt);
      else this.stageChain(b, dt);
      if (b.t >= b.detAt) this.detonate(b);
    } else {
      this.stageBurn(b, dt);
    }

    if (b.t >= b.endAt) b.alive = false;
  }

  // -- stage A: venting -----------------------------------------------------

  /**
   * Breached compartments dump atmosphere in hard jets while fires flicker
   * behind the plating. Deliberately restrained: this stage is the inhale
   * before the bang.
   */
  private stageVent(b: Blast, dt: number): void {
    b.ventT -= dt;
    if (b.ventT > 0) return;
    const rng = this.rng;
    b.ventT = rng.range(0.07, 0.16);

    const u = rng.sign() * 0.92;
    this.hullPoint(b, u, rng.range(0, Math.PI * 2), 0.55);
    const px = _v.x, py = _v.y, pz = _v.z;
    const nx = _sc.x, ny = _sc.y, nz = _sc.z;
    const es = this.pscale(b.radius);

    // Gas jet — aimed straight out of the breach.
    P.vx = nx; P.vy = ny; P.vz = nz;
    this.pb(px, py, pz, 5, 'vent', es * 0.16);

    // Something cooking inside: a small fire glow washing over the breach.
    if (rng.chance(0.5)) {
      const heat = 0.55 + 0.3 * rng.next();
      this.hotCloud(
        px + nx * b.radius * 0.02, py + ny * b.radius * 0.02, pz + nz * b.radius * 0.02,
        4, es * 0.14, b.radius * 0.35,
        es * 0.14, es * 0.32, 0.35, heat, 1, 0.55,
      );
    }
    // Occasional internal detonation punching sparks out of the breach.
    if (rng.chance(0.28)) {
      this.pb(px, py, pz, 7, 'spark', es * 0.3);
    }
    // ...and on a big hull it is a real, if small, fireball flaring out of the
    // breach, not just a sprite. This is the STAGE A read the critique asked to
    // be able to see (r1 #5): fires flickering along the hull for a second or
    // two BEFORE anything catastrophic happens.
    if (b.tier >= 1 && rng.chance(0.3)) {
      const fr = b.radius * rng.range(0.10, 0.19);
      this.spawnFireball(
        px + nx * fr * 0.5, py + ny * fr * 0.5, pz + nz * fr * 0.5,
        b.vx, b.vy, b.vz,
        fr * 0.3, fr, rng.range(0.26, 0.45),
        0.9, 0.95, 0, 1.0, 0.72, 0.6,
      );
    }
    // ...and, rarely, a drive/reactor arc flaring in the team's drive colour.
    if (b.tier === 2 && rng.chance(0.12)) {
      this.pb(px, py, pz, 6, 'ionMotes', es * 0.26, b.tr, b.tg, b.tb);
    }
  }

  // -- stage B: walking secondaries ----------------------------------------

  /**
   * A chain of secondaries marches bow-to-stern, each larger than the last, so
   * the eye is led along the hull and arrives at the nose exactly when the main
   * charge goes. Every third one throws a light.
   */
  private stageChain(b: Blast, dt: number): void {
    // Keep venting underneath the chain, just sparser.
    this.stageVent(b, dt * 0.45);

    if (b.chainI >= b.chainN) return;
    b.chainT -= dt;
    if (b.chainT > 0) return;
    const span = Math.max(0.05, b.detAt - b.chainAt);
    b.chainT = span / (b.chainN + 1);

    const rng = this.rng;
    const f = b.chainN > 1 ? b.chainI / (b.chainN - 1) : 1;
    b.chainI++;
    // Walk from the stern (-0.85) forward, with a little wander.
    const u = -0.85 + 1.7 * f + rng.sign() * 0.08;
    this.hullPoint(b, u, rng.range(0, Math.PI * 2), 0.5);
    const px = _v.x, py = _v.y, pz = _v.z;

    // Grows toward the finale.
    const grow = 0.45 + 0.85 * f;
    const s = this.pscale(b.radius) * 0.3 * grow;

    // Each secondary is a real (small) fireball volume, so the walk down the
    // hull is a sequence of visible detonations rather than a sequence of
    // sprite puffs — critique r1 #5, "verify that staging actually happens".
    // Sized off the TRUE hull radius so it stays a fraction of the ship.
    const fr = b.radius * (0.16 + 0.20 * f);
    // Heat ramps 0.72 -> 0.92 across the chain: a secondary must be visibly
    // cooler than the main charge or the finale has nothing left to escalate to,
    // and at 1.0 every secondary clipped to the same flat white lozenge.
    this.spawnFireball(
      px, py, pz, b.vx, b.vy, b.vz,
      fr * 0.28, fr, 0.42 + 0.30 * f,
      0.72 + 0.20 * f, 1.0, 0, 1.0, 0.74, 0.62,
    );

    this.hotCloud(px, py, pz, 8 + (b.tier === 2 ? 6 : 0), s * 0.9, b.radius * 0.6 * grow,
      s * 0.8, s * 1.7, 0.42, 0.82, 1, 0.6);
    this.pb(px, py, pz, 16, 'spark', s * 1.6);
    this.pb(px, py, pz, 6, 'smoke', s * 1.1);

    P.vx = _sc.x; P.vy = _sc.y; P.vz = _sc.z;
    this.pb(px, py, pz, 6, 'vent', s * 0.9);

    // A couple of plates blow off with every secondary, so the wreck is
    // already shedding mass before the main charge.
    if (b.tier === 2 && (b.chainI & 1) === 1) this.spawnDebris(b, 2);

    if (b.tier === 2 && (b.chainI & 1) === 0) {
      this.lightPop(px, py, pz, b.radius * 1.4 * grow, 0.22, 1.0, 0.55, 0.24);
    }
  }

  // =========================================================================
  // The main detonation
  // =========================================================================

  private detonate(b: Blast): void {
    b.detonated = true;
    b.burnT = 0;
    const r = b.radius;
    const es = this.pscale(r); // particle scale; `r` stays the geometric scale
    const rng = this.rng;
    const tier = b.tier;
    const big = tier === 2;

    // -- 1. core flash: a few enormous, very short-lived white sprites. These
    //       are the frames that blow the bloom out and read as "blinding".
    const flashN = this.take(big ? 6 : tier === 1 ? 4 : 3);
    if (flashN > 0) {
      P.kind = 0;
      P.additive = true;
      P.stretch = 0;
      P.turbulence = 0;
      P.drag = 0;
      P.alpha = 1;
      P.alphaEnd = 0;
      P.spin = 0;
      // CRITIQUE r2 reviewer 2: "give sub-DEBRIS_SMALL hulls a 250 ms white-core
      // flash that cannot be missed". A capital's flash is clamped hard against
      // its own radius because a 1 km hull would otherwise white out the frame;
      // a fighter has the opposite problem — 0.75 x 13 m is under a pixel at
      // engagement range. The cap is therefore per tier, and a fighter's flash is
      // ALLOWED to be bigger than the fighter, which is what the references do.
      const flashCap = tier === 0 ? r * 1.6 : tier === 1 ? r * 1.1 : r * 0.75;
      const flashLife = big ? 0.18 : tier === 1 ? 0.20 : 0.25;
      for (let i = 0; i < flashN; i++) {
        const k = i / flashN;
        P.x = b.x + rng.sign() * r * 0.08;
        P.y = b.y + rng.sign() * r * 0.08;
        P.z = b.z + rng.sign() * r * 0.08;
        P.vx = 0; P.vy = 0; P.vz = 0;
        const fs = Math.min(es, flashCap);
        P.size = fs * (0.5 + 0.55 * k);
        P.sizeEnd = fs * (1.0 + 1.1 * k);
        // Blue-white at the centre, cooling outward through the stack.
        const h = 1 - 0.35 * k;
        P.r = 8.5 * h; P.g = 7.4 * h * h; P.b = 6.2 * h * h;
        P.rEnd = 2.2; P.gEnd = 0.75; P.bEnd = 0.22;
        P.life = flashLife * (1 + k * 0.8);
        this.particles.emit();
      }
    }

    // -- 2. THE FIREBALL (critique r1 #1). The body is 3-5 overlapping volume
    //       lobes on a jittered sphere, each with its own seed, roll, radius,
    //       lifetime and — crucially — its own start delay and peak heat, so
    //       the outer lobes are already cooling to smoke while the core is
    //       still white. Everything is derived from the hull's true radius and
    //       capped at FIREBALL_MAX_R * r.
    // Scale sanity across tiers (round-2 brief point 3, "explosion scale must be
    // sensible against the hull that produced it"). The cap is a MULTIPLE of the
    // hull radius, so a capital's ball is bounded to 1.6x its own 230-1060 m
    // radius and cannot eat the frame, while a fighter — whose 13 m radius makes
    // 1.6x sub-pixel at engagement range — is allowed 2.4x, i.e. a ~31 m ball on
    // a 27 m hull, which is what the reference frames show a strike craft doing.
    const fbMax = r * (tier === 0 ? 2.4 : tier === 1 ? 1.9 : FIREBALL_MAX_R);
    const lobes = big ? 5 : tier === 1 ? 4 : 3;
    // Core lobe: biggest, hottest, born instantly. Fighter life 0.62 -> 1.1 s:
    // critique r2 reviewer 2, "extend the fighter fireball to 0.9-1.3 s".
    this.spawnFireball(
      b.x, b.y, b.z, b.vx * 0.5, b.vy * 0.5, b.vz * 0.5,
      r * 0.20, fbMax, big ? 2.4 : tier === 1 ? 1.5 : 1.1,
      1.0, 1.0, 0, 1.0, 0.78, 0.66,
    );
    for (let i = 1; i < lobes; i++) {
      // Lobes are placed ALONG THE SPINE, not on an isotropic sphere: a long
      // hull tears open along its length, so the cluster inherits the ship's
      // proportions instead of collapsing back into the ball round 1 was
      // rejected for. `hullPoint` also leaves the outward normal in `_sc`.
      const u = rng.range(-0.85, 0.85) * (i / lobes + 0.4);
      this.hullPoint(b, u, rng.range(0, Math.PI * 2), rng.range(0.0, 0.5));
      const lr = fbMax * rng.range(0.40, 0.72);
      this.spawnFireball(
        _v.x, _v.y, _v.z,
        b.vx * 0.5 + _sc.x * r * 0.3,
        b.vy * 0.5 + _sc.y * r * 0.3,
        b.vz * 0.5 + _sc.z * r * 0.3,
        lr * 0.25, lr, (big ? 1.9 : tier === 1 ? 1.25 : 0.95) * rng.range(0.75, 1.2),
        rng.range(0.55, 0.9), 1.0,
        // Staggered ignition — the ball unfolds over ~200 ms.
        (big ? 0.075 : 0.035) * i,
        1.0, 0.7, 0.58,
      );
    }

    // -- 2b. tongues of flame torn off the ball. These are now a GARNISH on
    //        the volume, not the fireball itself, so they are small, fast and
    //        few: sprite radius is capped at a third of the hull radius.
    const tongue = Math.min(es * 0.5, r * 0.34);
    this.hotCloud(b.x, b.y, b.z, big ? 34 : tier === 1 ? 20 : 10,
      r * 0.5, r * (big ? 1.5 : 3.2),
      tongue, tongue * 2.0, big ? 0.85 : 0.5, 1.0, 1, 0.9);

    // -- 3. sparks and shed plating. The references make radial spark rays the
    //       loudest read on a kill, so they are thrown well past the fireball.
    this.pb(b.x, b.y, b.z, big ? 90 : tier === 1 ? 52 : 26, 'spark', es * 0.85);
    // Halved: `debrisTrail` is an unlit orange sprite and it was the dominant
    // token in the round-2 battle frame, where the reviewer counted "roughly two
    // hundred pure red-orange dots at 3-4 px ... indistinguishable from nav
    // lights or dead pixels". Real wreckage is the InstancedMesh chunks below.
    this.pb(b.x, b.y, b.z, big ? 14 : tier === 1 ? 6 : 3, 'debrisTrail', es * 0.7);

    // -- 4. dust shock front, thrown out in the hull's broadside plane.
    P.vx = b.ax; P.vy = b.ay; P.vz = b.az;
    this.pb(b.x, b.y, b.z, big ? 40 : tier === 1 ? 24 : 0, 'shockdust', es * 0.8);

    // -- 5. smoke that the fireball will cool into.
    this.pb(b.x, b.y, b.z, big ? 26 : tier === 1 ? 16 : 6, 'smoke', es * 0.75);

    // -- 6. shockwave rings (critique r1 #2/#4). r1 was 5.0-7.5 hull radii,
    //       which let the front out-run its own fireball and turned it into a
    //       free-floating hoop; it now dies at ~3 hull radii.
    if (big || tier === 1 || this.quality.preset >= 2) {
      this.spawnRing(
        b, r * 0.55, r * (big ? 3.2 : 2.7),
        big ? 0.5 + r * 0.0011 : 0.32,
        1, big ? 0.85 : 0.7,
        2.4 + 0.5 * b.tr, 1.9 + 0.4 * b.tg, 1.4 + 0.6 * b.tb,
        1.1, 0.5, 0.24,
      );
    }
    if (big) {
      // The slow dust wave behind the light: wider, fatter, dim and brown.
      this.spawnRing(
        b, r * 0.7, r * 5.0, 2.0 + r * 0.003,
        0, 0.2,
        0.85, 0.7, 0.55,
        0.42, 0.3, 0.24,
      );
    }

    // -- 7. hull sections. Critique r1 #3: EVERY tier throws wreckage now, and
    //       a capital throws enough of it to read as a broken-up ship.
    this.spawnDebris(b, big ? 24 : tier === 1 ? 13 : 6);

    // -- 8. blast light. Long enough to still be lighting the wreckage as the
    //       fireball cools (critique r1 #16: "the blast lights are
    //       contributing nothing visible").
    this.lightPop(b.x, b.y, b.z, r * (big ? 16 : 11), big ? 1.9 : tier === 1 ? 0.95 : 0.4,
      1.0, 0.66, 0.36);

    // -- 9. exposure spike, weighted down hard for small hulls so a fighter
    //       brawl does not strobe the whole screen.
    const d = Math.max(1, Math.hypot(b.x - _cam.x, b.y - _cam.y, b.z - _cam.z));
    const w = big ? 1 : tier === 1 ? 0.55 : 0.22;
    const contrib = Math.min(1, (w * r * 9) / d);
    if (contrib > this._flash) this._flash = contrib;
  }

  // -- stage D: the long cool-down ------------------------------------------

  /**
   * For a second or two after the bang the fireball is still shedding heat.
   * Puffs are emitted with a heat that falls with time, so the cloud visibly
   * darkens from orange through ember red into black smoke.
   */
  private stageBurn(b: Blast, dt: number): void {
    // CRITIQUE r2 reviewer 2: fighters need "a 3-4 s smoke tail". Round 1
    // returned here immediately for tier 0, so a strike-craft kill left a 0.6 s
    // fireball and then vacuum. The tail is deliberately sparse — one or two
    // puffs every third of a second — because forty of these can be running at
    // once in a brawl and the frame must not fog over.
    const span = b.tier === 2 ? 1.8 : b.tier === 1 ? 1.4 : 3.2;
    const k = (b.t - b.detAt) / span;
    if (k >= 1) return;

    b.burnT -= dt;
    if (b.burnT > 0) return;
    const rng = this.rng;
    b.burnT = b.tier === 0 ? rng.range(0.26, 0.40) : rng.range(0.05, 0.11);

    const r = b.radius;
    const es = this.pscale(r);
    rng.onSphere(_dir);
    // Copy out of the shared scratch: `hotCloud` below overwrites `_dir`.
    const dx = _dir.x, dy = _dir.y, dz = _dir.z;
    const rr = r * (0.2 + 0.9 * rng.next());
    const px = b.x + dx * rr;
    const py = b.y + dy * rr;
    const pz = b.z + dz * rr;

    const heat = Math.max(0, 0.85 * (1 - k) * (1 - k));
    this.hotCloud(px, py, pz, b.tier === 2 ? 5 : b.tier === 1 ? 3 : 1,
      es * 0.3, r * 0.25, es * 0.35, es * 0.95, 0.9 + 0.8 * k, heat, 1, 0.9);
    // The smoke puffs are the part that has to survive the whole tail, so they
    // grow (and slow) as the cloud cools and they outnumber the embers.
    this.pb(px, py, pz, b.tier === 2 ? 5 : 2, 'smoke', es * (0.4 + 0.7 * k));
    // Embers only while there is still heat in the wreck. Round 1 kept spitting
    // `debrisTrail` for the whole burn, which is a large part of the "roughly two
    // hundred pure red-orange dots at 3-4 px" the reviewer counted.
    if (b.tier > 0 && k < 0.45 && rng.chance(0.25)) {
      this.pb(px, py, pz, 3, 'debrisTrail', es * 0.4);
    }

    // Cool, slow volume lobes rolling off the wreck. Born at a low temperature
    // they are almost pure soot, which is what gives the late frames of a
    // capital death dark billows crossing in front of the last embers instead
    // of a uniformly fading orange wash.
    if (b.tier === 2 && rng.chance(0.3)) {
      const fr = r * rng.range(0.28, 0.55);
      this.spawnFireball(
        px, py, pz,
        b.vx + dx * r * 0.1, b.vy + dy * r * 0.1, b.vz + dz * r * 0.1,
        fr * 0.45, fr, rng.range(1.3, 2.4),
        Math.max(0.1, heat * 0.55), 0.9, 0, 0.95, 0.78, 0.72,
      );
    }
  }

  // =========================================================================
  // Fireball volumes
  // =========================================================================

  /**
   * Light a fireball volume.
   *
   * @param r1     OUTER radius in metres. Callers must derive this from the
   *               dead hull's true bounding radius and keep it under
   *               `FIREBALL_MAX_R * radius` — critique r1 #4.
   * @param heat   0..1 peak temperature; below ~0.5 the ball is born already
   *               cooling and reads as burning debris rather than a detonation.
   * @param delay  seconds to wait before it starts, for staggered lobes.
   */
  private spawnFireball(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r0: number, r1: number, life: number,
    heat: number, opacity: number, delay: number,
    tr: number, tg: number, tb: number,
  ): void {
    const limit = this.fireballLimit;
    let slot: Fireball | null = null;
    let worst = -1;
    for (let i = 0; i < limit; i++) {
      const f = this.fireballs[i];
      if (!f.alive) { slot = f; break; }
      const prog = f.t / Math.max(1e-3, f.life);
      if (prog > worst) { worst = prog; slot = f; }
    }
    if (!slot) return;

    const rng = this.rng;
    slot.alive = true;
    slot.t = -delay;
    slot.life = life;
    slot.r0 = r0;
    slot.r1 = r1;
    slot.x = x; slot.y = y; slot.z = z;
    slot.vx = vx; slot.vy = vy; slot.vz = vz;
    slot.roll = rng.range(0, Math.PI * 2);
    // Slow roll only: a fireball that spins visibly reads as a spinning decal.
    slot.spin = rng.sign() * 0.22;

    const u = slot.mat.uniforms;
    u.uAge.value = 0;
    u.uSeed.value = rng.next();
    u.uHeat.value = heat;
    u.uOpacity.value = opacity;
    u.uRadius.value = r0;
    u.uRoll.value = slot.roll;
    (u.uTint.value as THREE.Color).setRGB(tr, tg, tb);
    slot.mesh.position.set(x, y, z);
    slot.mesh.updateMatrix();
    slot.mesh.visible = delay <= 0;
  }

  private stepFireballs(dt: number): void {
    for (let i = 0; i < this.fireballs.length; i++) {
      const f = this.fireballs[i];
      if (!f.alive) continue;
      f.t += dt;
      if (f.t < 0) continue; // still queued behind its stagger delay
      const u = f.t / f.life;
      if (u >= 1) {
        f.alive = false;
        f.mesh.visible = false;
        continue;
      }
      // Ease-out expansion: the gas front decelerates hard as it does work on
      // the vacuum it is displacing, so most of the growth is in the first
      // third of the life.
      const k = 1 - Math.pow(1 - u, 2.6);
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.updateMatrix();
      f.mesh.visible = true;
      const uni = f.mat.uniforms;
      uni.uAge.value = u;
      uni.uRadius.value = f.r0 + (f.r1 - f.r0) * k;
      uni.uRoll.value = f.roll + f.spin * f.t;
    }
  }

  // =========================================================================
  // Shockwave rings
  // =========================================================================

  /**
   * Light a ring slot. The plane of the ring is normal to the hull axis — the
   * blast escapes most easily out of the ship's broadside, which is also where
   * the debris goes, so the two agree.
   *
   * @param life  seconds to expand from `r0` to `r1`
   * @param sharp 1 = thin incandescent front, 0 = fat soft dust wave
   */
  private spawnRing(
    b: Blast, r0: number, r1: number, life: number,
    sharp: number, opacity: number,
    cr: number, cg: number, cb: number,
    er: number, eg: number, eb: number,
  ): void {
    let slot: Ring | null = null;
    let worst = -1;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.alive) { slot = r; break; }
      // Otherwise steal whichever ring is closest to finishing.
      const prog = r.t / Math.max(1e-3, r.life);
      if (prog > worst) { worst = prog; slot = r; }
    }
    if (!slot) return;

    slot.alive = true;
    slot.t = 0;
    slot.life = life;
    slot.r0 = r0;
    slot.r1 = r1;
    slot.vx = b.vx; slot.vy = b.vy; slot.vz = b.vz;
    slot.opacity = opacity;

    const u = slot.mat.uniforms;
    u.uAge.value = 0;
    u.uSeed.value = b.seed;
    (u.uCore.value as THREE.Color).setRGB(cr, cg, cb);
    (u.uEdge.value as THREE.Color).setRGB(er, eg, eb);
    u.uOpacity.value = opacity;
    u.uSharp.value = sharp;

    _axis.set(b.ax, b.ay, b.az);
    _q.setFromUnitVectors(UNIT_Z, _axis);
    slot.mesh.position.set(b.x, b.y, b.z);
    slot.mesh.quaternion.copy(_q);
    slot.mesh.scale.setScalar(r0);
    slot.mesh.updateMatrix();
    slot.mesh.visible = true;
  }

  private stepRings(dt: number): void {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.alive) continue;
      r.t += dt;
      const u = r.t / r.life;
      if (u >= 1) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      // Ease-out expansion: a shock front decelerates as it sweeps up mass.
      const k = 1 - Math.pow(1 - u, 2.2);
      const rad = r.r0 + (r.r1 - r.r0) * k;
      r.mesh.position.x += r.vx * dt;
      r.mesh.position.y += r.vy * dt;
      r.mesh.position.z += r.vz * dt;
      r.mesh.scale.setScalar(rad);
      r.mesh.updateMatrix();
      r.mat.uniforms.uAge.value = u;
      // Surface brightness of a thin expanding shell falls off as the same gas
      // is spread over a growing circumference (critique r1 #2: "drop opacity
      // as r^-1.5 so it dies before it out-runs the fireball"). 1.2 rather than
      // 1.5 because at this exposure a strict r^-1.5 has the front invisible by
      // a third of the way out; the front still dies well inside its travel.
      r.mat.uniforms.uOpacity.value = r.opacity * Math.pow(r.r0 / rad, 1.2);
    }
  }

  // =========================================================================
  // Blast lights
  // =========================================================================

  /**
   * Fire a pooled point light. `reach` is the light's distance cutoff in metres;
   * the peak intensity is derived from it so that irradiance at half the reach
   * stays roughly constant across hull sizes.
   */
  private lightPop(
    x: number, y: number, z: number, reach: number, life: number,
    cr: number, cg: number, cb: number,
  ): void {
    if (this.flares.length === 0) return;
    let slot: Flare | null = null;
    let worst = -1;
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i];
      if (f.life <= 0) { slot = f; break; }
      const prog = f.t / Math.max(1e-3, f.life);
      if (prog > worst) { worst = prog; slot = f; }
    }
    if (!slot) return;

    // decay = 2 (physical inverse-square), so intensity must scale with area.
    // Coefficient raised from 0.05: critique r1 #16 reports the blast lights
    // "contributing nothing visible" — a capital detonation has to put a warm
    // rim on every hull within a few kilometres.
    const rr = Math.max(1, reach);
    slot.peak = Math.min(8.0e6, rr * rr * 0.13);
    slot.t = 0;
    slot.life = life;
    slot.light.position.set(x, y, z);
    slot.light.distance = rr;
    slot.light.color.setRGB(cr, cg, cb);
    slot.light.intensity = slot.peak;
    slot.light.visible = true;
  }

  private stepLights(dt: number): void {
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i];
      if (f.life <= 0) continue;
      f.t += dt;
      const u = f.t / f.life;
      if (u >= 1) {
        f.life = 0;
        f.light.intensity = 0;
        f.light.visible = false;
        continue;
      }
      // Fast exponential decay with a hard tail-off at the end of life.
      const fall = Math.exp(-u * 4.2) * (1 - u * u);
      f.light.intensity = f.peak * fall;
      // Cools from white-hot toward ember red as it dies.
      const h = 1 - u;
      f.light.color.setRGB(1, 0.4 + 0.45 * h, 0.12 + 0.4 * h * h);
    }
  }

  // =========================================================================
  // Debris
  // =========================================================================

  /**
   * Claim a chunk slot. Under the live limit this pops the free list; at the
   * limit it recycles an already-live chunk in round-robin order, which keeps
   * the `alive` flag and the free list consistent (a stolen chunk was never on
   * the free list and stays off it).
   */
  private takeChunk(): Chunk | null {
    if (this.liveDebris < this.chunkLimit) {
      const idx = this.chunkFree.pop();
      if (idx !== undefined) {
        const c = this.chunks[idx];
        c.alive = true;
        return c;
      }
    }
    for (let k = 0; k < DEBRIS_CAP; k++) {
      const i = this.chunkCursor;
      this.chunkCursor = this.chunkCursor + 1 >= DEBRIS_CAP ? 0 : this.chunkCursor + 1;
      const c = this.chunks[i];
      if (c.alive) return c;
    }
    return null;
  }

  /**
   * Throw `count` hull sections out of the wreck. Chunks inherit the ship's
   * velocity plus an impulse biased into the broadside plane, are sized as a
   * fraction of the hull radius (so a mothership sheds 100 m plates and a scout
   * sheds 2 m shards), and cool at a rate that scales with their mass.
   *
   * CRITIQUE r1 #3 — "there is not one debris chunk anywhere in the battle
   * frame". A live probe showed the system spawning and drawing 30-45 chunks
   * throughout the capture, so nothing was broken: the chunks were simply
   * unreadable. Only fighters and corvettes (r = 13..25 m) had died, and each
   * was shedding 5 fragments of 0.12-0.30 x radius — 1.5-7 m of near-black
   * 0x4a4d52 plate, sub-pixel at the capture's 15 km stand-off, gone in 1.2-2.6
   * seconds. Three changes make wreckage read:
   *   - FEWER, BIGGER pieces: a ship breaks into hull SECTIONS, not gravel.
   *   - it outlives the flash everywhere (~5 s for a fighter, ~20 s for a
   *     capital, per the brief), so the wreck is still there when the light
   *     has gone;
   *   - the albedo is a real mid grey, so the key light and the blast light
   *     have something to hit (see `buildDebrisMaterial`).
   */
  private spawnDebris(b: Blast, count: number): void {
    const rng = this.rng;
    const r = b.radius;
    const big = b.tier === 2;
    const baseSpeed = 6 + 2.2 * Math.sqrt(r);

    for (let i = 0; i < count; i++) {
      const c = this.takeChunk();
      if (!c) return;

      // Plate-like sections for capitals, shards for everything smaller.
      c.variant = big
        ? (rng.chance(0.72) ? rng.int(CHUNK_PLATE0, CHUNK_VARIANTS - 1) : rng.int(0, CHUNK_PLATE0 - 1))
        : (rng.chance(0.3) ? rng.int(CHUNK_PLATE0, CHUNK_VARIANTS - 1) : rng.int(0, CHUNK_PLATE0 - 1));

      const u = rng.sign() * 0.9;
      this.hullPoint(b, u, rng.range(0, Math.PI * 2), rng.range(0.1, 0.6));
      c.x = _v.x; c.y = _v.y; c.z = _v.z;
      const nx = _sc.x, ny = _sc.y, nz = _sc.z;

      // Outward impulse, mostly broadside, with a little axial spill.
      const sp = baseSpeed * rng.range(0.45, 1.35);
      const axial = rng.sign() * 0.35;
      c.vx = b.vx + nx * sp + b.ax * sp * axial;
      c.vy = b.vy + ny * sp + b.ay * sp * axial;
      c.vz = b.vz + nz * sp + b.az * sp * axial;

      // Size: `s` is the chunk's bounding RADIUS (the baked geometry is
      // normalised to a unit bounding sphere), so a section spans 2s. A
      // capital therefore sheds plates 45-110 m across off a 260 m hull, which
      // reads as torn structure without any single piece dominating the wreck.
      //
      // CRITIQUE r2 reviewer 2: "raise fighter chunk scale so a 27 m hull throws
      // 5-9 m fragments". A 27 m hull has r = 13.5, so the sub-capital fraction
      // moves 0.14-0.28 -> 0.20-0.36 of the radius, giving a bounding radius of
      // 2.7-4.9 m and a span of 5.4-9.7 m. Capitals are unchanged: 0.07-0.17 of
      // a 230 m radius is already 32-78 m of plate.
      const frac = big ? rng.range(0.07, 0.17) : rng.range(0.20, 0.36);
      const s = Math.max(0.5, r * frac);
      const stretch = rng.range(1.0, 1.8);
      if (c.variant >= CHUNK_PLATE0) {
        c.sx = s * stretch; c.sy = s * rng.range(0.7, 1.0); c.sz = s;
      } else {
        c.sx = s * rng.range(0.75, 1.25);
        c.sy = s * rng.range(0.75, 1.25);
        c.sz = s * rng.range(0.75, 1.25);
      }
      c.size = Math.max(c.sx, Math.max(c.sy, c.sz));

      // Random start ORIENTATION on the full sphere, then a tumble about an
      // independently random axis at an independently random rate — three
      // independent draws per chunk, so no two fragments present the same
      // silhouette at the same moment (critique r2 reviewer 2, "give every chunk
      // a random 3-axis tumble so no two silhouettes match"). The rate range is
      // widened 0.3-1.0 -> 0.25-1.6 so the spread is visible within a second.
      rng.onSphere(_dir);
      const ang = rng.range(0, Math.PI * 2);
      const sa = Math.sin(ang * 0.5);
      c.qx = _dir.x * sa; c.qy = _dir.y * sa; c.qz = _dir.z * sa;
      c.qw = Math.cos(ang * 0.5);
      const wmag = rng.range(0.25, 1.6) * Math.min(3.0, Math.max(0.25, 30 / c.size));
      rng.onSphere(_dir);
      c.wx = _dir.x * wmag; c.wy = _dir.y * wmag; c.wz = _dir.z * wmag;

      c.age = 0;
      // Wreckage must outlive the flash at every tier — a kill that leaves
      // nothing behind did not read as a kill (critique r1 #3).
      c.life = big ? rng.range(18, 26) : b.tier === 1 ? rng.range(9, 15) : rng.range(4.5, 8);
      c.fadeFor = Math.min(4.0, c.life * 0.3);
      c.heat = 1;
      // CRITIQUE r2 reviewer 2 (blocker): "drive the emissive heat term to zero
      // by ~15% of `c.life` so a chunk is lit by the key rather than glowing red
      // for its whole life." Round 1 keyed the cooling rate to chunk MASS, which
      // is physically right and visually fatal: a 78 m capital plate cools at
      // 0.24/s and is therefore still emitting at half strength eight seconds
      // after the kill — the "two hundred pure red-orange dots, evenly coloured,
      // unlit" the reviewer counted. The rate is now derived from the chunk's own
      // lifetime so heat has decayed 98% by 0.15 * life at every size, and
      // `stepDebris` snaps the residue to exactly zero at that point.
      c.heat0 = Math.max(0.25, c.life * 0.15);
      c.cool = 4.2 / c.heat0;
      c.drag = 0.06;
      c.rand = rng.next();
      // Big sections emit far less often: their puffs are correspondingly huge
      // and a dozen of them at fighter cadence would fog the whole engagement.
      c.trailGap = rng.range(0.06, 0.12) * (1 + c.size / 22);
      c.trailT = rng.next() * c.trailGap;
      c.trailFlip = rng.chance(0.5);
    }
  }

  /** Integrate every chunk and refill the per-variant instance buffers. */
  private stepDebris(dt: number): void {
    const q = this.quality.preset;
    const trails = q >= 1;
    const smoke = q >= 2;
    const counts = this.chunkCount;
    for (let v = 0; v < CHUNK_VARIANTS; v++) counts[v] = 0;

    for (let i = 0; i < DEBRIS_CAP; i++) {
      const c = this.chunks[i];
      if (!c.alive) continue;

      c.age += dt;
      if (c.age >= c.life) {
        c.alive = false;
        this.chunkFree.push(i);
        continue;
      }

      // -- linear motion, with a token drag so clouds settle rather than fly
      //    apart forever.
      const damp = Math.exp(-c.drag * dt);
      c.vx *= damp; c.vy *= damp; c.vz *= damp;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;

      // -- tumble: dq = 0.5 * (0, w) (x) q, then renormalise.
      const hx = c.wx * 0.5 * dt, hy = c.wy * 0.5 * dt, hz = c.wz * 0.5 * dt;
      const nx = c.qx + (hx * c.qw + hy * c.qz - hz * c.qy);
      const ny = c.qy + (hy * c.qw + hz * c.qx - hx * c.qz);
      const nz = c.qz + (hz * c.qw + hx * c.qy - hy * c.qx);
      const nw = c.qw - (hx * c.qx + hy * c.qy + hz * c.qz);
      const inv = 1 / (Math.hypot(nx, ny, nz, nw) || 1);
      c.qx = nx * inv; c.qy = ny * inv; c.qz = nz * inv; c.qw = nw * inv;

      // -- cooling and dissolve. Past `heat0` (0.15 of the chunk's life) the
      //    residue is snapped to zero: from there on the fragment is lit only by
      //    the scene key and the decaying blast light, which is the whole point
      //    of debris — "that darkness against the glow" (critique r2).
      c.heat = c.age >= c.heat0 ? 0 : c.heat * Math.exp(-c.cool * dt);
      const rem = c.life - c.age;
      const fade = rem < c.fadeFor ? rem / c.fadeFor : 1;

      // -- ember + smoke trail. Embers stop with the glow, but the smoke keeps
      //    streaming off the section for most of its life: a tumbling wreck
      //    trailing smoke for twenty seconds is the thing that says a capital
      //    ship died here, long after the fireball has gone (critique r1 #3).
      if (trails) {
        c.trailT -= dt;
        if (c.trailT <= 0) {
          c.trailT = c.trailGap;
          c.trailFlip = !c.trailFlip;
          const es = this.pscale(c.size);
          // Embers only while the chunk is genuinely hot. The threshold was 0.08,
          // which with the old mass-keyed cooling meant a capital plate spat
          // orange sprites for fifteen seconds; combined across a wreck that is
          // most of the "two hundred red-orange dots" the reviewer counted.
          if (c.heat > 0.30) this.pb(c.x, c.y, c.z, 1, 'debrisTrail', es * 0.8);
          if (smoke && c.trailFlip && c.age < c.life * 0.8) {
            this.pb(c.x, c.y, c.z, 1, 'smoke', es * 0.7);
          }
        }
      }

      // -- write the instance.
      const v = c.variant;
      const n = counts[v];
      if (n >= DEBRIS_CAP) continue;
      _v.set(c.x, c.y, c.z);
      _q.set(c.qx, c.qy, c.qz, c.qw);
      _sc.set(c.sx, c.sy, c.sz);
      _m.compose(_v, _q, _sc);
      this.chunkMesh[v].setMatrixAt(n, _m);
      (this.chunkHeat[v].array as Float32Array)[n] = c.heat;
      (this.chunkFade[v].array as Float32Array)[n] = fade;
      (this.chunkRand[v].array as Float32Array)[n] = c.rand;
      counts[v] = n + 1;
    }

    for (let v = 0; v < CHUNK_VARIANTS; v++) {
      const im = this.chunkMesh[v];
      const n = counts[v];
      // Skip the upload entirely for variants that had nothing last frame too.
      if (n === 0 && im.count === 0) continue;
      im.count = n;
      if (n > 0) {
        im.instanceMatrix.addUpdateRange(0, n * 16);
        im.instanceMatrix.needsUpdate = true;
        this.chunkHeat[v].addUpdateRange(0, n);
        this.chunkHeat[v].needsUpdate = true;
        this.chunkFade[v].addUpdateRange(0, n);
        this.chunkFade[v].needsUpdate = true;
        this.chunkRand[v].addUpdateRange(0, n);
        this.chunkRand[v].needsUpdate = true;
      }
    }
  }

  // =========================================================================
  // Debris material
  // =========================================================================

  /**
   * A standard PBR hull material extended with three per-instance floats:
   *
   *   aHeat  0..1 incandescence, fed through the shared `sf_blackbody` ramp and
   *          added to the emissive term, so a chunk cools from white through
   *          orange to dead metal on the GPU.
   *   aFade  0..1 dissolve. Compared against a blue-noise threshold and
   *          discarded, which keeps the material fully OPAQUE — no transparency
   *          sorting, no depth-write compromise, and it composites correctly
   *          under bloom.
   *   aRand  per-chunk 0..1, decorrelating the dither pattern and adding albedo
   *          variation so a cloud of chunks does not read as clones.
   */
  private buildDebrisMaterial(): THREE.MeshStandardMaterial {
    // Albedo is deliberately NOT HULL.dark (critique r1 #3: chunks "must be lit
    // by the scene key plus a decaying blast light, not emissive, so they read
    // as solid mass against the glow"). Recessed-greeble graphite at 0x4a4d52
    // is ~0.07 linear — black metal in a black scene, which is why round 1
    // rendered 40 live chunks that nobody could see. This sits between the
    // graphite and the sunlit plate, so a chunk crossing a fireball reads as a
    // lit silhouette either way round.
    const albedo = new THREE.Color().lerpColors(HULL.dark, HULL.base, 0.26);
    const mat = new THREE.MeshStandardMaterial({
      color: albedo,
      roughness: 0.84,
      metalness: 0.35,
      flatShading: true,
      emissive: new THREE.Color(0, 0, 0),
    });
    mat.name = 'fx.debris';

    const ditherScale = 1 / DITHER_PX;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDither = { value: this.dither };
      shader.uniforms.uDitherScale = { value: ditherScale };

      shader.vertexShader =
        'attribute float aHeat;\nattribute float aFade;\nattribute float aRand;\n' +
        'varying float vHeat;\nvarying float vFade;\nvarying float vRand;\n' +
        shader.vertexShader.replace(
          'void main() {',
          'void main() {\n  vHeat = aHeat;\n  vFade = aFade;\n  vRand = aRand;',
        );

      shader.fragmentShader =
        'uniform sampler2D uDither;\nuniform float uDitherScale;\n' +
        'varying float vHeat;\nvarying float vFade;\nvarying float vRand;\n' +
        GLSL_UTIL +
        shader.fragmentShader
          .replace(
            'void main() {',
            `void main() {
  // Hashed dissolve: screen-space blue-noise threshold, offset per instance.
  float sfDith = texture2D(uDither, gl_FragCoord.xy * uDitherScale + vRand).r;
  if (vFade < sfDith) discard;`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
  // Soot and plate-to-plate value variation. The floor keeps a chunk out of
  // the black-on-black band; the ceiling keeps it from out-running the hulls
  // it came off, which turned the first pass of this fix into flying cardboard.
  diffuseColor.rgb *= (0.45 + 0.55 * vRand);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
  // Cooling metal. The quartic keeps the glow tight to the first seconds and
  // the blackbody ramp carries it orange -> ember -> nothing. Deliberately
  // weaker than round 1 (6.0 -> 2.8): a hull section is hot METAL, and if the
  // emissive dominates it stops reading as mass and becomes another glowing
  // dot (critique r1 #3).
  // ROUND 2: 2.8 -> 2.0, and the cooling SCHEDULE (see spawnDebris) now takes
  // vHeat to zero by 15% of the chunk's life rather than by its mass, so the
  // emissive is a brief flare on a freshly torn plate instead of the thing the
  // chunk is made of. A chunk must read as MASS — dark on its shadow side,
  // silhouetted against the fireball — and it cannot do that while it glows.
  float sfH = clamp(vHeat, 0.0, 1.0);
  totalEmissiveRadiance += sf_blackbody(sfH * 0.55) * (sfH * sfH * 2.0);`,
          );
    };
    // Without a stable cache key three would recompile per material clone.
    mat.customProgramCacheKey = () => 'sf.fx.debris.v2';
    return mat;
  }
}
