/**
 * MODULE CONTRACTS — the wiring diagram for Starfall.
 *
 * Every subsystem is written against the interfaces in this file so the pieces
 * can be developed independently and still snap together in `src/main.ts`.
 * If you are implementing a module listed here, implement the interface exactly:
 * the integration layer calls nothing else.
 *
 * ---------------------------------------------------------------------------
 * GEOMETRY ATTRIBUTE CONTRACT (every ship / station / asteroid mesh)
 * ---------------------------------------------------------------------------
 *   position  vec3   metres, local space, +Z forward, +Y up, +X starboard
 *   normal    vec3
 *   uv        vec2   only used for decals; triplanar detail does not need it
 *   aMask     vec4   x = team-paint mask      (0 bare hull .. 1 full faction paint)
 *                    y = emissive mask        (0 none .. 1 window/engine glow)
 *                    z = metalness bias       (-1 dielectric .. +1 raw metal)
 *                    w = roughness bias       (-1 polished .. +1 matte/worn)
 *   aAO       float  baked cavity occlusion, 0 fully occluded .. 1 open
 *
 * All ship geometry MUST be indexed, non-interleaved, and have its bounding
 * sphere computed. Triangle budgets per LOD are in `LOD_BUDGET`.
 */

import type {
  BufferGeometry,
  Camera,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import type { Rng } from './rng';
import type { QualitySettings, ShipClass, Team } from './types';
import type { World } from '../sim/world';

// ---------------------------------------------------------------------------

/** Triangle budget per LOD level, per hull size band (indexed by HullSize). */
export const LOD_BUDGET: Record<number, [number, number, number]> = {
  0: [2200, 700, 180], // Fighter
  1: [4000, 1200, 300], // Corvette
  2: [12000, 3600, 900], // Frigate
  3: [30000, 9000, 2200], // Capital
  4: [70000, 20000, 5000], // SuperCapital
  5: [6000, 1800, 450], // Utility
};

// ---------------------------------------------------------------------------
// Procedural textures  —  src/render/textures.ts
// ---------------------------------------------------------------------------

export interface HullTextureSet {
  /** RGBA: r = panel-line mask, g = plate value variation, b = grime, a = rivet/greeble mask. */
  detail: Texture;
  /** Tangent-space normal for micro surface (rivets, weld seams, plate warp). */
  normal: Texture;
  /** R = roughness, G = metalness modulation, B = edge wear, A = decal alpha. */
  surface: Texture;
  /** Scale in metres that one tile of the detail texture covers. */
  tileMetres: number;
  dispose(): void;
}

export interface TextureFactory {
  /** Baked once at load; shared by every hull in the game. */
  hull(): HullTextureSet;
  /** Radial soft particle sprite (RGBA, premultiplied-friendly). */
  soft(size?: number): Texture;
  /** Fiery turbulent sprite sheet for explosions, `frames` x `frames` grid. */
  fireSheet(frames?: number, size?: number): Texture;
  /** Engine plume gradient ramp (1D lookup). */
  plumeRamp(): Texture;
  /** Star sprite with diffraction spikes. */
  starSprite(size?: number): Texture;
  /** Blue-noise tile used to dither banding in volumetrics. */
  blueNoise(size?: number): Texture;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Renderer  —  src/render/renderer.ts
// ---------------------------------------------------------------------------

export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** PMREM-filtered environment used for image-based lighting. */
  envMap: Texture | null;
  quality: QualitySettings;
  /** Seconds since start. */
  time: number;
  /** Wall-clock delta for this frame, seconds. */
  dt: number;
}

// ---------------------------------------------------------------------------
// Ship geometry  —  src/ships/*.ts
// ---------------------------------------------------------------------------

/**
 * Build the hull for `cls` at the given LOD.
 *
 * MUST honour `SHIP_SPECS[cls].length` / `.radius`, emit the attribute set
 * described at the top of this file, and be deterministic for a given `rng`
 * seed. LOD 0 is the hero mesh; LOD 2 must still read as the same silhouette.
 */
export type ShipGeometryBuilder = (cls: ShipClass, lod: 0 | 1 | 2, rng: Rng) => BufferGeometry;

// ---------------------------------------------------------------------------
// The system interface every runtime subsystem implements
// ---------------------------------------------------------------------------

/**
 * A render-side subsystem. `update` runs once per rendered frame with the
 * interpolated wall-clock delta — never the fixed sim step.
 */
export interface RenderSystem {
  update(ctx: RenderContext, world: World): void;
  /** Called when quality settings change. Optional. */
  setQuality?(q: QualitySettings): void;
  /**
   * Receive the scene depth attachment for soft-particle depth fading.
   *
   * Optional: only systems that draw camera-facing billboards intersecting solid
   * geometry need it. The integrator feeds this every frame, so implementors
   * must tolerate `null` (below the quality preset that allocates a depth
   * target) and tolerate the texture identity changing on resize.
   */
  setDepthTexture?(t: Texture | null): void;
  dispose(): void;
}

/** A simulation subsystem. `step` runs at the fixed rate with `CONFIG.simStep`. */
export interface SimSystem {
  step(world: World, dt: number): void;
}

// ---------------------------------------------------------------------------
// Camera  —  src/render/cameraRig.ts
// ---------------------------------------------------------------------------

export interface CameraRig {
  camera: PerspectiveCamera;
  /** Point the camera orbits. */
  readonly focus: { x: number; y: number; z: number };
  /** Orbit distance in metres. */
  distance: number;
  update(dt: number, world: World): void;
  /** Smoothly move focus to a world point. */
  moveTo(x: number, y: number, z: number, snap?: boolean): void;
  /** Frame a set of ships. */
  frame(ids: number[], world: World): void;
  /** Screen-space ray for picking, returns origin+dir in world space. */
  ray(ndcX: number, ndcY: number): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number };
  /** True while the player is dragging the camera (suppresses selection). */
  readonly dragging: boolean;
}

// ---------------------------------------------------------------------------
// UI  —  src/ui/*.ts
// ---------------------------------------------------------------------------

export interface UiLayer {
  /** Called once per frame after the sim. */
  update(world: World, camera: Camera, dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Shared shader chunks — modules may import these to stay visually consistent.
// ---------------------------------------------------------------------------

/** Simplex-ish 3D value noise + fbm, usable in any GLSL stage. */
export const GLSL_NOISE = /* glsl */ `
float sf_hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
/**
 * Gradient hash. SIN-FREE ON PURPOSE — this is the hottest function in the
 * renderer.
 *
 * Every octave of 'sf_noise' calls this eight times, and the sky, the planet and
 * every hull run multi-octave fbm per pixel. The classic
 * 'fract(sin(dot(p, k)) * 43758.5)' formulation therefore costs ~24 transcendental
 * ops per octave, which measured as the dominant term in a 77 ms frame at 1440p.
 * This is the Hoskins-style integer-ish mix: same statistical quality, all
 * multiply-add and fract, no transcendentals.
 *
 * Note it also removes a real correctness hazard — 'sin()' at large coordinates
 * loses precision badly on mobile and on some drivers, which is why sin-based
 * hashes band or repeat far from the origin. Our coordinates reach 1e6.
 */
vec3 sf_hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
float sf_noise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(sf_hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(sf_hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(sf_hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(sf_hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(sf_hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(sf_hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(sf_hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(sf_hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z) * 0.5 + 0.5;
}
float sf_fbm(vec3 p, int oct, float lac, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * sf_noise(p); n += a; p *= lac; a *= gain;
  }
  return s / max(n, 1e-4);
}
float sf_ridge(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float v = 1.0 - abs(sf_noise(p) * 2.0 - 1.0);
    s += a * v * v; n += a; p *= 2.03; a *= 0.5;
  }
  return s / max(n, 1e-4);
}
`;

/** Utility helpers shared by fx shaders. */
export const GLSL_UTIL = /* glsl */ `
float sf_remap(float v, float a, float b, float c, float d){
  return c + (clamp(v, a, b) - a) * (d - c) / max(b - a, 1e-5);
}
vec3 sf_blackbody(float t){
  // t in 0..1 maps ~1000K..12000K, roughly Planckian, already in linear space.
  vec3 c = vec3(1.0);
  float k = mix(1.0, 12.0, clamp(t, 0.0, 1.0));
  c.r = clamp(1.4 - 0.06 * k, 0.0, 1.0) + 0.25;
  c.g = clamp(0.35 + 0.10 * k - 0.004 * k * k, 0.0, 1.0);
  c.b = clamp(-0.35 + 0.20 * k, 0.0, 1.0);
  return max(c, vec3(0.0));
}
`;

// ---------------------------------------------------------------------------
// Instanced attribute contract for the fleet renderer.
// ---------------------------------------------------------------------------

/**
 * Every instanced hull draw exposes these per-instance attributes. FX layers
 * that piggy-back on the fleet transform buffer must use the same names.
 *
 *   instanceMatrix   mat4  (three built-in)
 *   aTeamPrimary     vec3  faction paint colour, linear
 *   aTeamSecondary   vec3  faction trim colour, linear
 *   aDamage          float 0..1 scorch/venting amount
 *   aSeed            float stable per-ship random 0..1
 *   aFade            float 0..1 spawn/despawn dissolve
 *   aSelected        float 0..1 selection rim highlight
 */
export const INSTANCE_ATTRS = [
  'aTeamPrimary',
  'aTeamSecondary',
  'aDamage',
  'aSeed',
  'aFade',
  'aSelected',
  /**
   * Hull radius in metres. Constant for every instance in a bucket, but it has
   * to reach the shader somehow and the fleet shares ONE material across all
   * classes, so a uniform cannot carry it. Written once at bucket construction
   * and never touched again.
   */
  'aHullR',
] as const;

export type TeamColorSource = (team: Team) => { primary: number[]; secondary: number[] };
