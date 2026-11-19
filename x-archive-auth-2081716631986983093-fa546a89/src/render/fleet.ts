/**
 * FLEET RENDERER — the hot path.
 *
 * WHAT: draws every live ship in the world with one instanced draw call per
 * (class, LOD, variant) bucket, plus a single billboard draw for everything far
 * enough away to be a dot.
 *
 * WHY: a Homeworld-scale engagement is 1000-1600 hulls. One Mesh per ship is
 * 1600 draw calls and 1600 matrix updates and it dies at 20 fps. Bucketed
 * instancing turns that into ~20 draws; the impostor pass turns the long tail
 * of distant fighters into a single additive quad batch that still reads as a
 * fleet — team-coloured motes with hot drive dots — instead of vanishing.
 *
 * PERFORMANCE RULES OBSERVED HERE:
 *   - zero allocation inside `update` / `raycast`. Every vector, matrix and
 *     plane is module-scope scratch or a preallocated typed array.
 *   - no `Object3D.updateMatrix` per instance: the instance matrix is written
 *     straight into the InstancedMesh's Float32Array in column-major order.
 *   - frustum planes are extracted once per frame and tested with six dot
 *     products against the ship's bounding sphere.
 *   - GPU uploads are clipped to the used prefix of each buffer via
 *     `addUpdateRange`, so a bucket holding 8 destroyers never uploads its
 *     full 64-instance capacity.
 *
 * COORDINATE CONVENTION (see core/registry.ts): hulls are modelled facing +Z
 * with +Y up, so the instance basis is [right, up, forward] with
 * right = up x forward.
 *
 * ---------------------------------------------------------------------------
 * DISTANCE BEHAVIOUR (critique round 1, scale: "at fleet distance every capital
 * is an identical tan speckled grain — class is unreadable, team colour is
 * unreadable")
 * ---------------------------------------------------------------------------
 * Three things are done here, all of them the *opposite* of what a naive
 * renderer does as a ship recedes:
 *
 *   1. TEAM COLOUR IS PUSHED UP, NOT DOWN. `aTeamPrimary` / `aTeamSecondary`
 *      are per-instance, so they are interpolated per ship between the natural
 *      close-up paint and a chroma-boosted "fleet range" paint keyed off the
 *      hull's APPARENT PIXEL SIZE. Close up the paint is a subtle sprayed
 *      stripe; at 50 px it is a saturated band, which is the read Homeworld
 *      Remastered fleet shots have (grey wedge + one strong colour band).
 *
 *   2. CLASS IS ENCODED AS VALUE. The same tables give each hull-size band its
 *      own paint value and its own primary/trim convergence, so once geometry
 *      has stopped resolving a super-capital is a bright wide band, a frigate a
 *      mid band and a corvette a dark one. Team = hue, class = value.
 *
 *   3. LOD IS CHOSEN IN PIXELS, NOT IN HULL RADII. The old thresholds were
 *      `CONFIG.lodSwitch * radius`, which is only an angular size at one exact
 *      FOV and one exact resolution — change either (the camera rig now uses a
 *      40 deg lens) and dense meshes are held far past the point where they
 *      alias into the "speckled grain" the critique names. The switch is now a
 *      true projected-pixel diameter derived from the same config numbers, and
 *      trimmed so hulls drop to the flat LOD2 block and then to the impostor
 *      slightly sooner than they used to.
 *
 * The impostor itself is no longer a blob: it is a lit, tapered hull silhouette
 * with a team band and a hot drive, see IMPOSTOR_VERT / IMPOSTOR_FRAG.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { INSTANCE_ATTRS, type RenderContext, type RenderSystem } from '../core/contracts';
import { HULL, PALETTES } from '../core/palette';
import { SHIP_SPECS } from '../core/registry';
import {
  HullSize,
  SHIP_CLASS_COUNT,
  TEAM_COUNT,
  type QualitySettings,
  type ShipClass,
  type Team,
} from '../core/types';
import type { World } from '../sim/world';
import { LOD_COUNT, MAX_VARIANTS, type ShipLibrary } from '../ships/library';
import { createHullDepthMaterial } from './hullMaterial';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** `ship.lod` value written for hulls rendered as billboard impostors. */
export const LOD_IMPOSTOR = 3;

/**
 * Minimum on-screen size of an impostor, in CSS pixels (half-extents). Below
 * roughly this a ship disappears into sub-pixel noise and a 400-strong wing
 * reads as empty space, which is worse than slightly-too-big motes.
 *
 * Expressed in pixels rather than radians (it used to be a fixed 0.0035 rad) so
 * it holds at any FOV and any resolution — the camera rig now runs a 40 deg lens.
 *
 * Round 2 trimmed 6.5/2.4 to 5.2/2.0: the floor is a size LIE (it inflates a
 * sub-pixel hull to a readable one), and at 6.5 px it was firing from ~3.7 km
 * out, which flattened the whole far tier onto one apparent size — the critique's
 * "everything at the same apparent size ... nothing recedes". At 5.2 px the lie
 * starts ~25% further out and the size ladder survives further into the frame,
 * while a 400-strong wing still cannot dissolve into empty space.
 */
const IMPOSTOR_MIN_LEN_PX = 5.2;
const IMPOSTOR_MIN_WID_PX = 2.0;

/** Impostor quad half-length as a multiple of the hull's bounding radius. */
const IMPOSTOR_RADIUS_SCALE = 1.1;

/**
 * AERIAL PERSPECTIVE ON THE IMPOSTOR LAYER.
 *
 * Critique round 2, measured: "Michelson contrast on the far mothership, a
 * mid-depth destroyer and the near destroyer in 03-battle is 0.784, 0.788, 0.783
 * — identical to three decimals across the full depth of the engagement", and
 * "the fleet is a decal sheet pasted on a lightbox". The hull MESH path is being
 * fixed in hullMaterial.ts, but the impostor batch is a separate shader that
 * `GLSL_HAZE` never reached, and at fleet framing most of the ships in frame ARE
 * impostors — so the far tier would still have come back flat.
 *
 * The impostor writes PREMULTIPLIED alpha, which makes this free and exact:
 * attenuating alpha blends the hull toward whatever is behind it, and what is
 * behind it is the sky in that exact view direction. No cube sample, no extra
 * uniform, no dependency on the Backdrop instance — one CPU-side float per
 * instance, computed from a distance the loop already has.
 *
 * Calibrated to the critique's own acceptance test: "nothing inside 3 km
 * receives any haze at all" and "the far plane never blends more than 40%".
 * Contrast against sky scales with alpha, so a hull at 12 km keeps
 * 1 - 0.42*(1-exp(-9/9)) = 0.73 of its contrast and one at 30 km keeps 0.59,
 * decreasing monotonically — which is the ordering the reviewer measured as
 * absent (and, at one point, as non-monotonic).
 */
const IMPOSTOR_HAZE_START = 3000;
const IMPOSTOR_HAZE_SCALE = 9000;
const IMPOSTOR_HAZE_MAX = 0.42;
/**
 * Fraction of the recede the DRIVE resists. A receding hull must lose contrast,
 * but a distant wing must not lose its light signature — the drive is the only
 * faction/class cue left at 6 px, and round 1 rejected a fleet that "reads as
 * empty space" far more harshly than one that reads as motes.
 */
const IMPOSTOR_DRIVE_KEEP = 0.55;

/**
 * Pixels per radian of the reference frame the LOD table in `CONFIG.lodSwitch`
 * was authored against: 1440 px tall, 45 deg vertical FOV.
 * `1440 / (2 * tan(22.5deg))`.
 */
const REF_PX_PER_RAD = 1738.6;

/**
 * Per-level trim on the LOD switch distances, applied on top of
 * `CONFIG.lodSwitch`. <1 drops to the simpler mesh sooner.
 *
 * Critique, scale: a 30 000-triangle destroyer rasterised into 40 px is not
 * detail, it is aliasing — "flat mid-tan with residual noise, the worst possible
 * fleet-range read". Switching down earlier gives the clean value block that
 * reads as a hull instead.
 */
/**
 * These were 0.9 / 0.85 / 0.82, i.e. every level switched down EARLIER than the
 * authored distance, on the theory that a dense mesh rasterised small is
 * aliasing rather than detail. True in the abstract, wrong in practice: it put
 * hulls onto the flat LOD2 block while they still occupied a good chunk of the
 * screen, so ships visibly popped down to blocky silhouettes at ordinary
 * gameplay range — reported as "LOD too aggressive". Holding detail well past
 * the switch is far cheaper than it looks (the fleet is instanced and the frame
 * is fragment-bound, not vertex-bound), so the trims now push the switches OUT.
 */
const LOD_PX_TRIM: [number, number, number] = [2.6, 2.4, 3.2];

/**
 * Floor on the projected DIAMETER, in pixels, below which a hull may become an
 * impostor. Small hulls were the worst case for the old policy: a 23 m
 * interceptor crosses any radius-derived threshold almost immediately, so a wing
 * turned into billboards while each ship still covered 20-30 px and the pop was
 * obvious. Nothing drops to a billboard while it is still this big on screen,
 * whatever its class.
 */
const IMPOSTOR_MIN_HULL_PX = 14;

/**
 * Extra trim on the impostor threshold per hull-size band (multiplies
 * `LOD_PX_TRIM[2]`). Smaller = becomes an impostor at a LARGER pixel size.
 *
 * The LOD2 triangle budget is 180 tris for a fighter and 900 for a frigate
 * (contracts.ts `LOD_BUDGET`), so a fighter's mesh runs out of silhouette long
 * before a capital's does — and a 25 px hull made of 180 aliasing triangles is
 * exactly the "identical tan speckled grain" the critique rejected. Below these
 * sizes the authored impostor (lit wedge + team band + drive) reads better than
 * the mesh it replaces.
 */
const IMPOSTOR_TRIM_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 0.62,
  [HullSize.Corvette]: 0.72,
  [HullSize.Frigate]: 0.86,
  [HullSize.Capital]: 1,
  [HullSize.SuperCapital]: 1,
  [HullSize.Utility]: 0.76,
};

/**
 * Apparent hull DIAMETER, in pixels, over which paint stays natural and under
 * which it is fully pushed to the fleet-range read. Interpolated in between.
 */
const PAINT_FAR_PX = 60;
const PAINT_NEAR_PX = 240;

/**
 * Fleet-range paint: chroma multiplier about the colour's own luminance, and
 * the value multiplier applied afterwards. Team colour has to survive being
 * averaged with the bone hull inside 40 px, so it is pushed well past the
 * close-up paint — the close-up paint is unchanged.
 */
const PAINT_FAR_CHROMA = 2.1;
const PAINT_FAR_VALUE = 1.18;
const TRIM_FAR_CHROMA = 2.3;
const TRIM_FAR_VALUE = 1.02;

/**
 * CLASS = VALUE. Multiplies the fleet-range paint value per hull-size band, so
 * at ranges where geometry no longer resolves the size ladder is still readable
 * as a brightness ladder.
 */
const PAINT_VALUE_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 0.80,
  [HullSize.Corvette]: 0.90,
  [HullSize.Frigate]: 1.04,
  [HullSize.Capital]: 1.18,
  [HullSize.SuperCapital]: 1.32,
  [HullSize.Utility]: 0.96,
};

/**
 * How far the trim colour converges onto the primary at fleet range, per size
 * band. Capitals become one broad saturated band; strike craft keep the dark
 * two-tone, so the two classes do not average to the same mid value.
 */
const TRIM_CONVERGE_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 0.10,
  [HullSize.Corvette]: 0.26,
  [HullSize.Frigate]: 0.52,
  [HullSize.Capital]: 0.78,
  [HullSize.SuperCapital]: 0.90,
  [HullSize.Utility]: 0.38,
};

/**
 * Impostor silhouette proportion (length : width) per hull-size band. Bounding
 * radii are near-spherical for every hull, so the readable proportion has to be
 * authored here — this is what makes a distant frigate a long wedge and a
 * distant fighter a short winged dart rather than the same dot.
 */
const IMPOSTOR_ASPECT_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 2.0,
  [HullSize.Corvette]: 2.6,
  [HullSize.Frigate]: 3.4,
  [HullSize.Capital]: 4.0,
  [HullSize.SuperCapital]: 4.4,
  [HullSize.Utility]: 2.3,
};

/** Seconds a freshly spawned or launching hull takes to dissolve in. */
const SPAWN_FADE = 0.8;
const LAUNCH_FADE = 1.0;

/** Per-bucket instance capacity, by hull size band. */
const CAPACITY_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 640,
  [HullSize.Corvette]: 320,
  [HullSize.Frigate]: 160,
  [HullSize.Capital]: 64,
  [HullSize.SuperCapital]: 12,
  [HullSize.Utility]: 160,
};

/** Subtle per-hull scale variation so a squadron is not a stamped repeat. */
const JITTER_BY_SIZE: Record<HullSize, number> = {
  [HullSize.Fighter]: 0.07,
  [HullSize.Corvette]: 0.05,
  [HullSize.Frigate]: 0.025,
  [HullSize.Capital]: 0,
  [HullSize.SuperCapital]: 0,
  [HullSize.Utility]: 0.04,
};

// Attribute names come from the contract, not from string literals here, so a
// rename in contracts.ts breaks the build instead of silently breaking paint.
const A_PRIMARY = INSTANCE_ATTRS[0];
const A_SECONDARY = INSTANCE_ATTRS[1];
const A_DAMAGE = INSTANCE_ATTRS[2];
const A_SEED = INSTANCE_ATTRS[3];
const A_FADE = INSTANCE_ATTRS[4];
const A_SELECTED = INSTANCE_ATTRS[5];
const A_HULL_R = INSTANCE_ATTRS[6];

// ---------------------------------------------------------------------------
// Module-scope scratch — nothing in the frame loop may allocate.
// ---------------------------------------------------------------------------

const _viewInv = /* @__PURE__ */ new THREE.Matrix4();
const _viewProj = /* @__PURE__ */ new THREE.Matrix4();
const _frustum = /* @__PURE__ */ new THREE.Frustum();
/** 6 planes x (nx, ny, nz, d), extracted once per frame. */
const _planes = /* @__PURE__ */ new Float32Array(24);
/** Viewport size, refilled every frame by `renderer.getSize`. */
const _size = /* @__PURE__ */ new THREE.Vector2(1920, 1080);
/** Key-light direction in view space, refilled every frame. */
const _sunView = /* @__PURE__ */ new THREE.Vector3();
/** World-space direction TO the key light — matches renderer.ts's sun. */
const _sunWorld = /* @__PURE__ */ new THREE.Vector3(
  CONFIG.sunDir[0], CONFIG.sunDir[1], CONFIG.sunDir[2],
).normalize();

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** One instanced draw: all ships of a class at a LOD sharing a hull variant. */
interface Bucket {
  cls: ShipClass;
  lod: 0 | 1 | 2;
  variant: number;
  mesh: THREE.InstancedMesh;
  capacity: number;
  /** Instances written this frame. */
  count: number;
  /** Instances that wanted in but did not fit — drives deferred growth. */
  wanted: number;

  matrix: Float32Array;
  primary: Float32Array;
  secondary: Float32Array;
  damage: Float32Array;
  seed: Float32Array;
  fade: Float32Array;
  selected: Float32Array;

  aMatrix: THREE.InstancedBufferAttribute;
  aPrimary: THREE.InstancedBufferAttribute;
  aSecondary: THREE.InstancedBufferAttribute;
  aDamage: THREE.InstancedBufferAttribute;
  aSeed: THREE.InstancedBufferAttribute;
  aFade: THREE.InstancedBufferAttribute;
  aSelected: THREE.InstancedBufferAttribute;
  aHullR: THREE.InstancedBufferAttribute;
}

// ---------------------------------------------------------------------------
// Impostor shader
// ---------------------------------------------------------------------------

/**
 * IMPOSTOR — a ship, not a mote.
 *
 * Critique, scale: "make the impostor path actually look like a ship silhouette
 * with a drive glow rather than a blob". The old pass was an additive radial
 * falloff, which can only ever add light to the nebula: it could never produce
 * the dark tapered wedge a hull actually is, and it had no value structure at
 * all. This one:
 *
 *   - builds a real half-width profile along the spine (tapered nose, broad
 *     shoulder, narrowed tail, one sponson/wing break) so the alpha edge is a
 *     silhouette, antialiased from its own screen-space derivative;
 *   - shades that silhouette with the scene key light using a cylindrical
 *     cross-section normal, so it has a lit side and a dark side — the value
 *     contrast that makes it read as a metal object at 10 px;
 *   - carries the fleet-range team colour as a painted belt;
 *   - writes PREMULTIPLIED alpha, so the hull occludes the background (grey
 *     wedge) while the drive still adds light on top of it (bloom source).
 */
const IMPOSTOR_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iFwd;
attribute vec3 iPrimary;
attribute vec3 iEngine;
attribute float iSize;   // half LENGTH in metres, already floored to min pixels
attribute float iShape;  // effective length : width ratio
attribute float iDrive;  // drive count, 1..4
attribute float iFade;
attribute float iSeed;
/** 1 = full contrast, <1 = receded toward sky. See IMPOSTOR_HAZE_*. */
attribute float iSolid;

uniform vec3 uHull;

varying vec2 vQuad;
varying vec2 vAx;
varying vec3 vHull;
varying vec3 vTeam;
varying vec3 vEngine;
varying float vFade;
varying float vSeed;
varying float vDrive;
varying float vSolid;

void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);

  // Project the hull's forward axis into view space. Its screen-plane length is
  // the foreshortening factor: 1 = broadside (full length), 0 = nose-on (the
  // hull collapses onto its own cross-section). This is what stops a wing of
  // impostors reading as identical shapes regardless of heading.
  vec3 fv = (modelViewMatrix * vec4(iFwd, 0.0)).xyz;
  vec2 dir = fv.xy;
  float dl = length(dir);
  vec2 ax = dl > 1e-4 ? dir / dl : vec2(1.0, 0.0);

  float halfW = iSize / max(iShape, 1.0);
  float halfL = mix(halfW, iSize, clamp(dl, 0.0, 1.0));

  vQuad = position.xy;
  // Stretch along the projected forward axis, then rotate that 2D frame into
  // view space (ax = local +x = nose, perp(ax) = local +y).
  mv.xy += ax * (position.x * halfL) + vec2(-ax.y, ax.x) * (position.y * halfW);

  vAx = ax;
  vHull = uHull;
  // The fleet-range paint is authored bright enough to survive being averaged
  // with bone hull inside a mesh; on the impostor it IS the surface, so it is
  // knocked back to sit near the hull's own value. A distant fighter must never
  // out-glow a nearer frigate — the drive is the only thing allowed to.
  vTeam = iPrimary * 0.72;
  vEngine = iEngine;
  vFade = iFade;
  vSeed = iSeed;
  vDrive = iDrive;
  vSolid = iSolid;

  gl_Position = projectionMatrix * mv;
}
`;

const IMPOSTOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunView;   // direction TO the key light, view space

varying vec2 vQuad;
varying vec2 vAx;
varying vec3 vHull;
varying vec3 vTeam;
varying vec3 vEngine;
varying float vFade;
varying float vSeed;
varying float vDrive;
varying float vSolid;

void main() {
  float x = clamp(vQuad.x, -1.0, 1.0);   // +1 = nose, -1 = stern
  float y = vQuad.y;

  // -- silhouette: half width along the spine --------------------------------
  float prof = sqrt(max(0.0, 1.0 - x * x * 0.96));
  prof *= mix(1.0, 0.30, smoothstep(-0.05, 1.0, x));   // long tapered nose
  prof *= mix(1.0, 0.80, smoothstep(-0.2, -1.0, x));   // narrowed tail
  prof += 0.22 * exp(-40.0 * (x + 0.18) * (x + 0.18)); // sponson / wing break
  prof = max(prof, 1e-4);

  float d = abs(y) / prof;
  // Screen-space derivative gives free, resolution-correct antialiasing on a
  // shape that is often only six pixels across.
  float aa = clamp(fwidth(d), 0.06, 0.9);
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);

  // -- key light on a cylindrical cross-section ------------------------------
  float ny = clamp(y / prof, -1.0, 1.0);
  float nz = sqrt(max(0.0, 1.0 - ny * ny));
  vec3 n = vec3(vec2(-vAx.y, vAx.x) * ny, nz);
  float lam = max(dot(n, uSunView), 0.0);
  float lit = 0.14 + 1.05 * lam * lam;                 // hard terminator
  lit *= mix(0.72, 1.0, smoothstep(-1.0, 0.2, x));     // aft sits in its own shade

  // -- team band -------------------------------------------------------------
  // A broad painted belt over the forward two thirds. At this range the belt is
  // the only thing carrying faction identity, so it is wide and saturated.
  // The reference read is a GREY WEDGE WITH ONE COLOUR BAND, not a coloured
  // blob — so the hull keeps most of the silhouette and a narrow belt carries
  // the faction. The fleet-range team colour is several times brighter than the
  // hull, so even a 10% tint outside the belt would swamp it.
  float band = smoothstep(0.50, 0.12, abs(x + 0.10));
  vec3 col = mix(vHull, vTeam, 0.09 + 0.63 * band) * lit;
  // Bright chamfer along the lit rim keeps the silhouette crisp against nebula.
  col += vTeam * (smoothstep(0.72, 1.0, d) * lam * 0.32);

  // -- drives ----------------------------------------------------------------
  float gx = (x + 0.90) * 3.4;
  float gw = 0.20 + 0.11 * vDrive;
  float gy = y / gw;
  float glow = exp(-(gx * gx + gy * gy) * 2.1);
  float flick = 0.88 + 0.12 * sin(uTime * (6.0 + vSeed * 8.0) + vSeed * 31.4);
  // The drive is the most reliable faction cue at this size (the two fleets'
  // paint is warm-on-warm but their drive colours are cyan vs amber), so it is
  // deliberately the brightest thing on the impostor.
  vec3 emis = vEngine * (glow * (1.55 + 0.55 * vDrive) * flick) * vFade
            * mix(vSolid, 1.0, ${IMPOSTOR_DRIVE_KEEP.toFixed(2)});

  // AERIAL PERSPECTIVE. Premultiplied alpha means attenuating coverage IS a
  // blend toward the sky radiance in this exact view direction, so one multiply
  // buys the depth cue the critique measured as absent (0.784 / 0.788 / 0.783
  // across the whole engagement). Body only — the drive keeps its signature.
  float a = clamp(body, 0.0, 1.0) * vFade * vSolid;
  float peak = max(max(emis.r, emis.g), emis.b);
  if (a < 0.004 && peak < 0.004) discard;

  // Premultiplied: rgb already carries the coverage, so emissive can exceed the
  // alpha and read as light instead of paint.
  gl_FragColor = vec4(col * a + emis, a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// FleetRenderer
// ---------------------------------------------------------------------------

/**
 * Instanced renderer for every ship hull in the world.
 *
 * Owns its InstancedMeshes and the impostor batch; borrows the hull geometry
 * (from `ShipLibrary`) and the hull material, and disposes neither.
 */
export class FleetRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly library: ShipLibrary;
  private readonly material: THREE.MeshStandardMaterial;
  private quality: QualitySettings;

  /** Flat bucket table indexed by `bucketKey`. Buckets are created on demand. */
  private readonly buckets: (Bucket | null)[];
  /** Buckets that overflowed last frame and must be reallocated bigger. */
  private readonly growQueue: Bucket[] = [];
  /** Every live bucket, for cheap per-frame flush / teardown iteration. */
  private readonly live: Bucket[] = [];

  /** Shared custom depth material so shadows match the hull's dissolve. */
  private readonly depthMaterial: THREE.MeshDepthMaterial;

  /**
   * Extra visual roll applied about the forward axis, as a multiple of
   * `Ship.bank`.
   *
   * `Ship.up` is specified to roll with banking already, so double-applying it
   * would over-bank every fighter — hence 0 by default. If the flight model
   * ends up keeping `up` world-referenced instead, set this to 1 and the hulls
   * bank into their turns with no other change.
   */
  bankBlend = 0;

  // -- per-class constants, hoisted out of the frame loop -------------------
  private readonly clsRadius = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsJitter = new Float32Array(SHIP_CLASS_COUNT);
  /**
   * LOD switch distances per hull radius, BEFORE the per-frame pixel scale.
   * `dist < radius * clsLodK[n] * pxScale` selects LOD n; see `update`.
   */
  private readonly clsLodK = new Float32Array(3);
  /** Per-class impostor switch distance per hull radius; see IMPOSTOR_TRIM_BY_SIZE. */
  private readonly clsImpK = new Float32Array(SHIP_CLASS_COUNT);
  /** 1 = capital-scale hull, never allowed to drop to an impostor. */
  private readonly clsNoImpostor = new Uint8Array(SHIP_CLASS_COUNT);
  private readonly clsCapacity = new Int32Array(SHIP_CLASS_COUNT);
  /** Impostor silhouette proportion and drive count, per class. */
  private readonly clsAspect = new Float32Array(SHIP_CLASS_COUNT);
  private readonly clsDrives = new Float32Array(SHIP_CLASS_COUNT);

  /**
   * Per (team, class) paint tables, RGB triplets.
   *
   * `*Near` is the authored close-up paint, `*Far` is the fleet-range read
   * (chroma boosted, value laddered by hull size). The write loop lerps between
   * them by apparent pixel size — critique, scale: team colour and class must
   * get MORE legible as a hull recedes, not less.
   */
  private readonly paintNear = new Float32Array(TEAM_COUNT * SHIP_CLASS_COUNT * 3);
  private readonly paintFar = new Float32Array(TEAM_COUNT * SHIP_CLASS_COUNT * 3);
  private readonly trimNear = new Float32Array(TEAM_COUNT * SHIP_CLASS_COUNT * 3);
  private readonly trimFar = new Float32Array(TEAM_COUNT * SHIP_CLASS_COUNT * 3);

  // -- selection lookup ----------------------------------------------------
  private readonly selFlags = new Uint8Array(CONFIG.maxShips);

  // -- impostor batch ------------------------------------------------------
  private readonly impGeo: THREE.InstancedBufferGeometry;
  private readonly impMat: THREE.ShaderMaterial;
  private readonly impMesh: THREE.Mesh;
  private readonly impPos: Float32Array;
  private readonly impFwd: Float32Array;
  private readonly impPrimary: Float32Array;
  private readonly impEngine: Float32Array;
  private readonly impSize: Float32Array;
  private readonly impShape: Float32Array;
  private readonly impDrive: Float32Array;
  private readonly impFade: Float32Array;
  private readonly impSeed: Float32Array;
  /** Aerial-perspective survival factor per instance; see IMPOSTOR_HAZE_*. */
  private readonly impSolid: Float32Array;
  private readonly impAttrs: THREE.InstancedBufferAttribute[] = [];

  constructor(
    scene: THREE.Scene,
    library: ShipLibrary,
    material: THREE.MeshStandardMaterial,
    quality: QualitySettings,
  ) {
    this.scene = scene;
    this.library = library;
    this.material = material;
    this.quality = quality;
    this.buckets = new Array<Bucket | null>(SHIP_CLASS_COUNT * LOD_COUNT * MAX_VARIANTS).fill(null);
    this.depthMaterial = createHullDepthMaterial();

    for (let i = 0; i < 3; i++) this.clsLodK[i] = CONFIG.lodSwitch[i] * LOD_PX_TRIM[i];

    for (let c = 0; c < SHIP_CLASS_COUNT; c++) {
      const spec = SHIP_SPECS[c as ShipClass];
      this.clsRadius[c] = spec.radius;
      this.clsJitter[c] = JITTER_BY_SIZE[spec.size];
      this.clsNoImpostor[c] =
        spec.size === HullSize.Capital || spec.size === HullSize.SuperCapital ? 1 : 0;
      this.clsAspect[c] = IMPOSTOR_ASPECT_BY_SIZE[spec.size];
      this.clsImpK[c] = this.clsLodK[2] * IMPOSTOR_TRIM_BY_SIZE[spec.size];
      // Real drive count from the ship table, so an impostor's light signature
      // is class-specific (one dot for a fighter, a wide bar for a frigate).
      this.clsDrives[c] = Math.max(1, Math.min(4, spec.engines.length));
      const variants = Math.max(1, library.variantCount(c as ShipClass));
      this.clsCapacity[c] = Math.min(
        CONFIG.maxShips,
        Math.max(8, Math.ceil((CAPACITY_BY_SIZE[spec.size] / variants) * 1.4)),
      );
    }

    this.buildPaintTables();

    // --- impostor batch, allocated once at the world ship cap -------------
    const cap = CONFIG.maxShips;
    this.impPos = new Float32Array(cap * 3);
    this.impFwd = new Float32Array(cap * 3);
    this.impPrimary = new Float32Array(cap * 3);
    this.impEngine = new Float32Array(cap * 3);
    this.impSize = new Float32Array(cap);
    this.impShape = new Float32Array(cap);
    this.impDrive = new Float32Array(cap);
    this.impFade = new Float32Array(cap);
    this.impSeed = new Float32Array(cap);
    this.impSolid = new Float32Array(cap);

    this.impGeo = new THREE.InstancedBufferGeometry();
    this.impGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    this.impGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.impGeo.instanceCount = 0;
    const addImp = (name: string, arr: Float32Array, size: number): void => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.impGeo.setAttribute(name, a);
      this.impAttrs.push(a);
    };
    addImp('iPos', this.impPos, 3);
    addImp('iFwd', this.impFwd, 3);
    addImp('iPrimary', this.impPrimary, 3);
    addImp('iEngine', this.impEngine, 3);
    addImp('iSize', this.impSize, 1);
    addImp('iShape', this.impShape, 1);
    addImp('iDrive', this.impDrive, 1);
    addImp('iFade', this.impFade, 1);
    addImp('iSeed', this.impSeed, 1);
    addImp('iSolid', this.impSolid, 1);

    this.impMat = new THREE.ShaderMaterial({
      vertexShader: IMPOSTOR_VERT,
      fragmentShader: IMPOSTOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        // Distant hulls are LIT, not emissive: a bone value the key light and
        // the team band push around, so the impostor still reads as a metal
        // object rather than a glowing dot.
        uHull: { value: new THREE.Color().copy(HULL.base).multiplyScalar(0.5) },
        uSunView: { value: new THREE.Vector3(0, 0, 1) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied alpha rather than additive: an additive quad can only ADD
      // light, so a distant hull could never be the dark tapered wedge the
      // reference frames show. Premultiplied lets the body occlude the nebula
      // while the drive still adds on top of it.
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      toneMapped: true,
    });

    this.impMesh = new THREE.Mesh(this.impGeo, this.impMat);
    this.impMesh.frustumCulled = false;
    this.impMesh.matrixAutoUpdate = false;
    this.impMesh.matrixWorldAutoUpdate = false;
    this.impMesh.renderOrder = 2;
    this.impMesh.visible = false;
    this.scene.add(this.impMesh);
  }

  // -------------------------------------------------------------------------
  // Paint tables
  // -------------------------------------------------------------------------

  /**
   * Bake the close-up and fleet-range paint for every (team, class) pair.
   *
   * Fleet-range paint is derived by expanding chroma about the colour's own
   * luminance (a linear-space saturation boost that never shifts hue), then
   * applying the per-size value ladder. Trim additionally converges onto the
   * primary by hull size, so a capital ends up wearing one broad band and a
   * fighter keeps its dark two-tone.
   *
   * Runs once at construction — the frame loop only lerps.
   */
  private buildPaintTables(): void {
    const c = new THREE.Color();
    for (let t = 0; t < TEAM_COUNT; t++) {
      const pal = PALETTES[t as Team];
      for (let cl = 0; cl < SHIP_CLASS_COUNT; cl++) {
        const size = SHIP_SPECS[cl as ShipClass].size;
        const val = PAINT_VALUE_BY_SIZE[size];
        const conv = TRIM_CONVERGE_BY_SIZE[size];
        const o = (t * SHIP_CLASS_COUNT + cl) * 3;

        this.paintNear[o] = pal.primary.r;
        this.paintNear[o + 1] = pal.primary.g;
        this.paintNear[o + 2] = pal.primary.b;
        this.trimNear[o] = pal.secondary.r;
        this.trimNear[o + 1] = pal.secondary.g;
        this.trimNear[o + 2] = pal.secondary.b;

        chromaBoost(pal.primary, PAINT_FAR_CHROMA, PAINT_FAR_VALUE * val, c);
        const fr = c.r, fg = c.g, fb = c.b;
        this.paintFar[o] = fr;
        this.paintFar[o + 1] = fg;
        this.paintFar[o + 2] = fb;

        chromaBoost(pal.secondary, TRIM_FAR_CHROMA, TRIM_FAR_VALUE * val, c);
        this.trimFar[o] = c.r + (fr - c.r) * conv;
        this.trimFar[o + 1] = c.g + (fg - c.g) * conv;
        this.trimFar[o + 2] = c.b + (fb - c.b) * conv;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(ctx: RenderContext, world: World): void {
    const camera = ctx.camera;
    camera.updateMatrixWorld();

    // Deferred bucket growth from last frame's overflow. Done here (not at the
    // end of the previous frame) so the old bucket got to draw its full set.
    if (this.growQueue.length > 0) this.flushGrowth();

    // --- frustum planes, once ---------------------------------------------
    _viewInv.copy(camera.matrixWorld).invert();
    _viewProj.multiplyMatrices(camera.projectionMatrix, _viewInv);
    _frustum.setFromProjectionMatrix(_viewProj);
    for (let p = 0; p < 6; p++) {
      const pl = _frustum.planes[p];
      const o = p * 4;
      _planes[o] = pl.normal.x;
      _planes[o + 1] = pl.normal.y;
      _planes[o + 2] = pl.normal.z;
      _planes[o + 3] = pl.constant;
    }

    const cm = camera.matrixWorld.elements;
    const camX = cm[12];
    const camY = cm[13];
    const camZ = cm[14];

    // Guard against a zero/negative bias collapsing every hull to an impostor.
    const bias = this.quality.lodBias > 0.05 ? this.quality.lodBias : 0.05;

    // --- projection scale --------------------------------------------------
    // Pixels per radian for this frame's lens and viewport. Everything
    // distance-dependent below (LOD, paint boost, impostor floor) is expressed
    // in projected pixels through this, so none of it silently mis-tunes when
    // the camera rig changes FOV or the player resizes the window.
    ctx.renderer.getSize(_size);
    const pxPerRad = _size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const pxScale = (pxPerRad / REF_PX_PER_RAD) * bias;
    const kLod0 = this.clsLodK[0] * pxScale;
    const kLod1 = this.clsLodK[1] * pxScale;
    // Metres per pixel per metre of depth — the impostor size floors.
    const mppd = 1 / pxPerRad;
    const minImpLen = IMPOSTOR_MIN_LEN_PX * mppd;
    const minImpWid = IMPOSTOR_MIN_WID_PX * mppd;
    // Paint-boost ramp, in apparent hull RADIUS pixels (px diameter / 2).
    const paintLo = PAINT_FAR_PX * 0.5;
    const paintK = 1 / (PAINT_NEAR_PX * 0.5 - paintLo);
    // Hoisted out of the impostor write so the loop does one exp() and no divide.
    const invHazeScale = 1 / IMPOSTOR_HAZE_SCALE;

    // Key light in view space for the impostor pass. One uniform write.
    _sunView.copy(_sunWorld).transformDirection(_viewInv);
    (this.impMat.uniforms.uSunView.value as THREE.Vector3).copy(_sunView);

    // --- selection lookup table -------------------------------------------
    const sel = this.selFlags;
    sel.fill(0);
    const selIds = world.selection;
    for (let i = 0; i < selIds.length; i++) {
      const id = selIds[i];
      if (id >= 0 && id < sel.length) sel[id] = 1;
    }

    // --- reset counts ------------------------------------------------------
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      live[i].count = 0;
      live[i].wanted = 0;
    }
    let impCount = 0;
    const impCap = this.impSize.length;

    // --- the loop ----------------------------------------------------------
    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive) continue;
      if (s.dockedIn >= 0) {
        // Inside a hangar: nothing to draw, and downstream FX must know.
        s.visible = false;
        s.lod = LOD_IMPOSTOR;
        continue;
      }

      const cls = s.cls as number;
      const radius = this.clsRadius[cls];
      const px = s.pos.x;
      const py = s.pos.y;
      const pz = s.pos.z;

      // -- frustum cull (bounding sphere vs 6 planes) ----------------------
      let inside = true;
      for (let p = 0; p < 24; p += 4) {
        if (_planes[p] * px + _planes[p + 1] * py + _planes[p + 2] * pz + _planes[p + 3] < -radius) {
          inside = false;
          break;
        }
      }

      const dx = px - camX;
      const dy = py - camY;
      const dz = pz - camZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // -- LOD selection, in projected pixels -------------------------------
      let lod: number;
      if (dist < radius * kLod0) lod = 0;
      else if (dist < radius * kLod1) lod = 1;
      else if (dist < radius * this.clsImpK[cls] * pxScale) lod = 2;
      else lod = this.clsNoImpostor[cls] ? 2 : LOD_IMPOSTOR;

      // Absolute pixel floor on becoming a billboard. Every threshold above is
      // derived from the hull's own radius, which is exactly why SMALL ships
      // were the worst case: a 23 m interceptor crosses a radius-scaled distance
      // almost immediately, so a wing flipped to impostors while each ship still
      // covered tens of pixels and the pop was plainly visible. Nothing becomes
      // a billboard while it is still this big on screen, whatever its class.
      if (lod === LOD_IMPOSTOR) {
        const pxDiameter = 2 * radius * (pxPerRad / Math.max(dist, 1));
        if (pxDiameter > IMPOSTOR_MIN_HULL_PX) lod = 2;
      }

      s.lod = lod;
      s.visible = inside;
      if (!inside) continue;

      // -- fades ------------------------------------------------------------
      let fade = s.age < SPAWN_FADE ? s.age / SPAWN_FADE : 1;
      if (s.launchT > 0) {
        const lf = 1 - s.launchT / LAUNCH_FADE;
        if (lf < fade) fade = lf;
      }
      if (fade <= 0) continue;
      if (fade > 1) fade = 1;

      const pal = PALETTES[s.team];

      // -- distance-driven paint --------------------------------------------
      // `far` is 0 for a hero-framed hull and 1 once the ship is small enough
      // that its paint would otherwise average into the bone hull. Critique,
      // scale: team colour and class contrast must go UP as ships recede.
      const pxRad = (radius * pxPerRad) / dist;
      let far = (PAINT_NEAR_PX * 0.5 - pxRad) * paintK;
      if (far < 0) far = 0;
      else if (far > 1) far = 1;
      const po = (s.team * SHIP_CLASS_COUNT + cls) * 3;
      const pn = this.paintNear;
      const pf = this.paintFar;
      const tn = this.trimNear;
      const tf = this.trimFar;
      const primR = pn[po] + (pf[po] - pn[po]) * far;
      const primG = pn[po + 1] + (pf[po + 1] - pn[po + 1]) * far;
      const primB = pn[po + 2] + (pf[po + 2] - pn[po + 2]) * far;

      // -- impostor path ----------------------------------------------------
      if (lod === LOD_IMPOSTOR) {
        if (impCount >= impCap) continue;
        const o3 = impCount * 3;
        this.impPos[o3] = px;
        this.impPos[o3 + 1] = py;
        this.impPos[o3 + 2] = pz;
        this.impFwd[o3] = s.fwd.x;
        this.impFwd[o3 + 1] = s.fwd.y;
        this.impFwd[o3 + 2] = s.fwd.z;
        this.impPrimary[o3] = primR;
        this.impPrimary[o3 + 1] = primG;
        this.impPrimary[o3 + 2] = primB;
        this.impEngine[o3] = pal.engine.r;
        this.impEngine[o3 + 1] = pal.engine.g;
        this.impEngine[o3 + 2] = pal.engine.b;
        // Never let the silhouette shrink below a readable pixel size — on
        // EITHER axis. Flooring only the length used to produce needles.
        const floorLen = dist * minImpLen;
        let halfLen = radius * IMPOSTOR_RADIUS_SCALE;
        if (halfLen < floorLen) halfLen = floorLen;
        const floorWid = dist * minImpWid;
        let halfWid = halfLen / this.clsAspect[cls];
        if (halfWid < floorWid) halfWid = floorWid;
        this.impSize[impCount] = halfLen;
        this.impShape[impCount] = halfLen / halfWid;
        this.impDrive[impCount] = this.clsDrives[cls];
        this.impFade[impCount] = fade;
        this.impSeed[impCount] = s.seed;
        // Aerial perspective: exponential blend toward the sky behind the hull,
        // dead inside IMPOSTOR_HAZE_START so near framing stays crisp. One exp
        // per impostor, no allocation. See the IMPOSTOR_HAZE_* block.
        const hz = dist > IMPOSTOR_HAZE_START
          ? (1 - Math.exp((IMPOSTOR_HAZE_START - dist) * invHazeScale)) * IMPOSTOR_HAZE_MAX
          : 0;
        this.impSolid[impCount] = 1 - hz;
        impCount++;
        continue;
      }

      // -- mesh path --------------------------------------------------------
      const variants = this.library.variantCount(s.cls);
      let variant = (s.seed * variants) | 0;
      if (variant >= variants) variant = variants - 1;

      const key = (cls * LOD_COUNT + lod) * MAX_VARIANTS + variant;
      let b = this.buckets[key];
      if (!b) b = this.makeBucket(s.cls, lod as 0 | 1 | 2, variant, key);

      const idx = b.count;
      b.wanted++;
      if (idx >= b.capacity) continue; // grows next frame
      b.count = idx + 1;

      // -- orthonormal basis: right = up x fwd, up' = fwd x right ----------
      let fx = s.fwd.x;
      let fy = s.fwd.y;
      let fz = s.fwd.z;
      let l = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (l > 1e-6) {
        l = 1 / l;
        fx *= l;
        fy *= l;
        fz *= l;
      } else {
        fx = 0;
        fy = 0;
        fz = 1;
      }

      let rx = s.up.y * fz - s.up.z * fy;
      let ry = s.up.z * fx - s.up.x * fz;
      let rz = s.up.x * fy - s.up.y * fx;
      let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rl < 1e-5) {
        // `up` is parallel to `fwd` (degenerate sim state) — pick any
        // perpendicular so the hull still draws instead of collapsing.
        const ax = Math.abs(fy) < 0.99 ? 0 : 1;
        const ay = Math.abs(fy) < 0.99 ? 1 : 0;
        rx = ay * fz - 0 * fy;
        ry = 0 * fx - ax * fz;
        rz = ax * fy - ay * fx;
        rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      }
      rl = 1 / rl;
      rx *= rl;
      ry *= rl;
      rz *= rl;

      let ux = fy * rz - fz * ry;
      let uy = fz * rx - fx * rz;
      let uz = fx * ry - fy * rx;

      // Optional extra roll about the forward axis. `Ship.up` is documented to
      // already carry the bank, so `bankBlend` defaults to 0; see the field.
      if (this.bankBlend !== 0 && s.bank !== 0) {
        const ang = s.bank * this.bankBlend;
        const cb = Math.cos(ang);
        const sb = Math.sin(ang);
        const nrx = rx * cb + ux * sb;
        const nry = ry * cb + uy * sb;
        const nrz = rz * cb + uz * sb;
        ux = ux * cb - rx * sb;
        uy = uy * cb - ry * sb;
        uz = uz * cb - rz * sb;
        rx = nrx;
        ry = nry;
        rz = nrz;
      }

      // -- write the instance matrix (column-major, no Matrix4 round-trip) --
      const jitter = this.clsJitter[cls];
      const sc = jitter > 0 ? 1 + (s.seed - 0.5) * 2 * jitter : 1;
      const m = b.matrix;
      const mo = idx * 16;
      m[mo] = rx * sc;
      m[mo + 1] = ry * sc;
      m[mo + 2] = rz * sc;
      m[mo + 3] = 0;
      m[mo + 4] = ux * sc;
      m[mo + 5] = uy * sc;
      m[mo + 6] = uz * sc;
      m[mo + 7] = 0;
      m[mo + 8] = fx * sc;
      m[mo + 9] = fy * sc;
      m[mo + 10] = fz * sc;
      m[mo + 11] = 0;
      m[mo + 12] = px;
      m[mo + 13] = py;
      m[mo + 14] = pz;
      m[mo + 15] = 1;

      const c3 = idx * 3;
      b.primary[c3] = primR;
      b.primary[c3 + 1] = primG;
      b.primary[c3 + 2] = primB;
      b.secondary[c3] = tn[po] + (tf[po] - tn[po]) * far;
      b.secondary[c3 + 1] = tn[po + 1] + (tf[po + 1] - tn[po + 1]) * far;
      b.secondary[c3 + 2] = tn[po + 2] + (tf[po + 2] - tn[po + 2]) * far;
      b.damage[idx] = s.damage;
      b.seed[idx] = s.seed;
      // `fade` is local visibility (1 = fully materialised) but the hull shader's
      // `aFade` is a DISSOLVE AMOUNT (0 = solid, 1 = gone), so invert on write.
      b.fade[idx] = 1 - fade;
      b.selected[idx] = sel[s.id];
    }

    // --- flush buckets -----------------------------------------------------
    for (let i = 0; i < live.length; i++) {
      const b = live[i];
      const n = b.count;
      if (n === 0) {
        b.mesh.visible = false;
      } else {
        b.mesh.visible = true;
        b.mesh.count = n;
        flush(b.aMatrix, n);
        flush(b.aPrimary, n);
        flush(b.aSecondary, n);
        flush(b.aDamage, n);
        flush(b.aSeed, n);
        flush(b.aFade, n);
        flush(b.aSelected, n);
      }
      if (b.wanted > b.capacity) this.growQueue.push(b);
    }

    // --- flush impostors ---------------------------------------------------
    this.impGeo.instanceCount = impCount;
    this.impMesh.visible = impCount > 0;
    if (impCount > 0) {
      const attrs = this.impAttrs;
      for (let i = 0; i < attrs.length; i++) flush(attrs[i], impCount);
      this.impMat.uniforms.uTime.value = ctx.time;
    }
  }

  // -------------------------------------------------------------------------
  // Quality
  // -------------------------------------------------------------------------

  /** Re-apply shadow flags and LOD bias after a settings change. */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    for (let i = 0; i < this.live.length; i++) this.applyShadow(this.live[i]);
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  /**
   * Ray vs. ship bounding spheres. Returns the id of the nearest hit along the
   * ray or -1.
   *
   * The pick radius grows slightly with distance so a fighter that is four
   * pixels across is still clickable — RTS players expect to hit what they can
   * see, not what the collision hull technically covers. Docked ships are not
   * pickable because they are not drawn.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    world: World,
  ): number {
    // Normalise defensively; callers may hand us an unnormalised direction.
    let l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) return -1;
    l = 1 / l;
    const ux = dx * l;
    const uy = dy * l;
    const uz = dz * l;

    let best = -1;
    let bestT = Infinity;
    const pool = world.ships;
    for (let i = 0; i < pool.count; i++) {
      const s = pool.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      const cx = s.pos.x - ox;
      const cy = s.pos.y - oy;
      const cz = s.pos.z - oz;
      const t = cx * ux + cy * uy + cz * uz;
      if (t <= 0 || t >= bestT) continue; // behind the eye, or already beaten
      const r = this.clsRadius[s.cls as number] + t * 0.006;
      const perp2 = cx * cx + cy * cy + cz * cz - t * t;
      if (perp2 > r * r) continue;
      bestT = t;
      best = s.id;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Buckets
  // -------------------------------------------------------------------------

  private makeBucket(cls: ShipClass, lod: 0 | 1 | 2, variant: number, key: number): Bucket {
    const capacity = this.clsCapacity[cls as number];
    const b = this.buildBucket(cls, lod, variant, capacity);
    this.buckets[key] = b;
    this.live.push(b);
    return b;
  }

  private buildBucket(
    cls: ShipClass,
    lod: 0 | 1 | 2,
    variant: number,
    capacity: number,
  ): Bucket {
    const geo = this.library.geometry(cls, lod, variant);
    const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false; // we cull per instance ourselves
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.visible = false;
    mesh.name = `fleet_${SHIP_SPECS[cls].tag}_L${lod}_v${variant}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Dissolve/damage must match in the shadow pass, so shadows use the hull's
    // own depth program rather than the stock MeshDepthMaterial.
    mesh.customDepthMaterial = this.depthMaterial;

    const primary = new Float32Array(capacity * 3);
    const secondary = new Float32Array(capacity * 3);
    const damage = new Float32Array(capacity);
    const seed = new Float32Array(capacity);
    const fade = new Float32Array(capacity);
    const selected = new Float32Array(capacity);
    // Constant for the whole bucket: the shader scales its plating tiles off
    // it so a 2.1 km Mothership is not panelled in the same 6 m plates as a
    // 27 m interceptor.
    const hullR = new Float32Array(capacity).fill(SHIP_SPECS[cls].radius);

    const mk = (arr: Float32Array, size: number, name: string): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };

    const b: Bucket = {
      cls,
      lod,
      variant,
      mesh,
      capacity,
      count: 0,
      wanted: 0,
      matrix: mesh.instanceMatrix.array as Float32Array,
      primary,
      secondary,
      damage,
      seed,
      fade,
      selected,
      aMatrix: mesh.instanceMatrix,
      aPrimary: mk(primary, 3, A_PRIMARY),
      aSecondary: mk(secondary, 3, A_SECONDARY),
      aDamage: mk(damage, 1, A_DAMAGE),
      aSeed: mk(seed, 1, A_SEED),
      aFade: mk(fade, 1, A_FADE),
      aSelected: mk(selected, 1, A_SELECTED),
      aHullR: mk(hullR, 1, A_HULL_R),
    };

    this.applyShadow(b);
    this.scene.add(mesh);
    return b;
  }

  /**
   * Shadow policy: only the near buckets participate. Casting from LOD2 hulls
   * that are ~2 km out contributes nothing but shadow-map fill cost, and the
   * cascade never resolves them anyway.
   */
  private applyShadow(b: Bucket): void {
    const on = this.quality.shadows;
    b.mesh.castShadow = on && (b.lod === 0 || (b.lod === 1 && this.quality.preset >= 2));
    b.mesh.receiveShadow = on && b.lod === 0;
  }

  /**
   * Reallocate any bucket that ran out of instance slots last frame. Rare (the
   * per-class capacities are sized for a full 1600-ship battle), never inside
   * the write loop, and the replacement keeps the same geometry.
   */
  private flushGrowth(): void {
    for (let i = 0; i < this.growQueue.length; i++) {
      const old = this.growQueue[i];
      const key = ((old.cls as number) * LOD_COUNT + old.lod) * MAX_VARIANTS + old.variant;
      if (this.buckets[key] !== old) continue;
      const capacity = Math.min(CONFIG.maxShips, Math.ceil(old.wanted * 1.5) + 8);
      if (capacity <= old.capacity) continue;
      this.retireBucket(old);
      const fresh = this.buildBucket(old.cls, old.lod, old.variant, capacity);
      this.buckets[key] = fresh;
      this.live.push(fresh);
    }
    this.growQueue.length = 0;
  }

  /** Remove a bucket's mesh from the scene and drop its GPU buffers. */
  private retireBucket(b: Bucket): void {
    const i = this.live.indexOf(b);
    if (i >= 0) this.live.splice(i, 1);
    this.scene.remove(b.mesh);
    // Detach our instance attributes: the geometry belongs to the library and
    // may be handed to the replacement bucket immediately.
    const geo = b.mesh.geometry;
    geo.deleteAttribute(A_PRIMARY);
    geo.deleteAttribute(A_SECONDARY);
    geo.deleteAttribute(A_DAMAGE);
    geo.deleteAttribute(A_SEED);
    geo.deleteAttribute(A_FADE);
    geo.deleteAttribute(A_HULL_R);
    geo.deleteAttribute(A_SELECTED);
    b.mesh.dispose(); // frees instanceMatrix only, never the shared geometry
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /** Drops every mesh this renderer owns. Library geometry and the hull
   * material are borrowed and are NOT disposed here. */
  dispose(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retireBucket(this.live[i]);
    this.live.length = 0;
    this.growQueue.length = 0;
    this.buckets.fill(null);
    this.scene.remove(this.impMesh);
    this.impGeo.dispose();
    this.impMat.dispose();
    this.depthMaterial.dispose();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark the used prefix of an instanced attribute dirty.
 *
 * Uploading only `count * itemSize` elements keeps a 12-instance mothership
 * bucket from re-uploading its whole allocation every frame.
 */
/**
 * Expand a linear colour's chroma about its own luminance, then scale value.
 *
 * Hue is preserved exactly (the operation is a scale about the achromatic axis),
 * which is what keeps a "hotter" fleet-range team colour still recognisably the
 * same faction colour. Results are clamped to a mild over-range so the paint can
 * catch a little bloom on a capital but never blows out to white.
 */
function chromaBoost(src: THREE.Color, chroma: number, value: number, out: THREE.Color): void {
  const l = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;
  // Floor each channel at a fraction of its original: without it the weak
  // channel clips to zero and every warm colour collapses to the same orange,
  // which would make two warm factions indistinguishable at fleet range.
  const fr = src.r * 0.55, fg = src.g * 0.55, fb = src.b * 0.55;
  let r = l + (src.r - l) * chroma;
  let g = l + (src.g - l) * chroma;
  let b = l + (src.b - l) * chroma;
  r = (r > fr ? r : fr) * value;
  g = (g > fg ? g : fg) * value;
  b = (b > fb ? b : fb) * value;
  out.setRGB(
    r < 0 ? 0 : r > 1.4 ? 1.4 : r,
    g < 0 ? 0 : g > 1.4 ? 1.4 : g,
    b < 0 ? 0 : b > 1.4 ? 1.4 : b,
  );
}

function flush(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}
