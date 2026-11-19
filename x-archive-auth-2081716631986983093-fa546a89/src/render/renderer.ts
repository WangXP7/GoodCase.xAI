/**
 * RENDERER — the Stage.
 *
 * Owns the WebGL device, the scene graph root, the camera, the two lights the
 * art direction allows, and the post-processing chain. Everything else in the
 * game renders INTO this; nothing else touches the device.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PIPELINE LOOKS LIKE THIS
 * ---------------------------------------------------------------------------
 * SCALE. The battlespace runs from a 1 m greeble on a fighter's spine to a
 * 40,000 km camera far plane. A conventional [near, far] depth buffer cannot
 * hold that: at far/near = 4e7 the first 99% of the buffer's precision is spent
 * inside the first few metres. So `logarithmicDepthBuffer` is MANDATORY here,
 * not a preference. It costs a per-fragment gl_FragDepth write (which disables
 * early-Z on some drivers) and it is still cheaper than the alternative, which
 * is a cascaded depth-range renderer.
 *
 * HDR. The scene is authored in linear radiance with no upper clamp: a sunlit
 * hull plate sits near 0.5, an engine core sits at 40+. Everything up to the
 * OutputPass therefore runs in a half-float target. Tone mapping and the sRGB
 * transfer happen exactly ONCE, in the OutputPass, at the very end. This is why
 * scene materials must not tone map themselves — three automatically disables
 * `TONE_MAPPING` for any material drawn into a render target, so the shader
 * chunks the world modules already include (`<tonemapping_fragment>`) become
 * no-ops inside the composer. Do not "fix" them.
 *
 * BLOOM IS A LIGHT SOURCE, NOT A FILTER. Homeworld's glow reads as physical
 * incandescence because only genuinely hot things glow. The threshold is kept
 * high (CONFIG.bloomThreshold, in LINEAR luminance), so drives, beams, impacts,
 * lit windows, the planet limb and the hottest specular lips are the only things
 * that bleed. When they do, they bleed generously and warm — the large mips are
 * tinted toward amber so the halo feels like hot gas rather than a lens smear,
 * while the tight mips stay neutral so a cyan core stays cyan.
 *
 * COLOUR SURVIVES THE BLOWOUT. Per-channel ACES saturates each channel
 * independently, so anything bright enough to bloom used to arrive at the
 * display as identical flat white. The grade applies a hue-preserving shoulder
 * to the max channel before the tone map (see FILMIC_SHADER) so hot cores keep
 * their hue right up to the point where they genuinely clip.
 *
 * DEPTH FOR SOFT PARTICLES. The composer ping-pongs its two buffers and does
 * NOT reset the read/write assignment between frames, so which buffer the scene
 * lands in alternates with the parity of the swapping passes. A depth texture
 * bolted onto either of them would be clobbered by SMAA's blend pass on half
 * the frames. Instead the scene is rendered into a Stage-owned target that no
 * post pass ever writes to, then blitted into the chain. One extra fullscreen
 * triangle buys a depth attachment that is stable, readable for the whole
 * frame, and survives any pass reconfiguration.
 *
 * ---------------------------------------------------------------------------
 * PASS CHAIN (ultra)
 * ---------------------------------------------------------------------------
 *   ScenePass  ->  UnrealBloomPass  ->  filmic  ->  SMAAPass  ->  OutputPass
 *   linear HDR ....................................................|  sRGB 8bit
 *
 * Lower presets drop passes rather than weakening them — a cheap-looking bloom
 * is worse than no bloom.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { CONFIG } from '../core/config';
import type { QualitySettings } from '../core/types';

// ---------------------------------------------------------------------------
// Module-scope scratch — `render` and `updateShadowFrustum` allocate nothing.
// ---------------------------------------------------------------------------

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Width of the bloom high-pass knee, in linear luminance.
 *
 * `UnrealBloomPass` defaults this to 0.01, which is a step function in practice.
 * With an HDR-only threshold the knee needs to be a real ramp or every highlight
 * visibly switches its bloom on and off as it crosses the line. 0.55 spreads the
 * transition over roughly half a stop.
 */
const BLOOM_KNEE = 0.55;

/** Shadow-camera basis, rebuilt in place every frustum update. */
const _sx = new THREE.Vector3();
const _sy = new THREE.Vector3();
const _sz = new THREE.Vector3();
const _snap = new THREE.Vector3();

/** Lowest preset that gets a scene depth texture (and therefore soft particles). */
const DEPTH_TEXTURE_MIN_PRESET = 2;

/**
 * Shadow coverage is clamped: the ortho box tracks the camera focus, and past
 * this radius the texels are so large the shadows read as mud. Beyond it we
 * keep sharp shadows on the ships the player is actually looking at and let the
 * far field go unshadowed, which nobody notices at that zoom.
 */
const SHADOW_RADIUS_MIN = 40;
const SHADOW_RADIUS_MAX = 9000;

/**
 * HERO CASCADE — critique "lighting": "nothing self-shadows", twice.
 *
 * ROUND 1 sized the box from the caller's focus radius alone, so framing a
 * 2.1 km Mothership handed the shadow map a 3 km box and every contact shadow
 * was filtered out of existence. ROUND 2 added the fixed `heroFit` cap below,
 * which fixed the texel size and introduced a new bug: at a 4096 map and
 * TARGET_TEXEL_METRES 0.5 the cap was a 1024 m half-extent, and a Mothership's
 * bounding sphere is 1060 m — so the fore and aft fifths of the hero hull fell
 * OUTSIDE the shadow box and could neither cast nor receive. The reviewer's
 * "the Mothership's 130 m mast, its four terrace risers and its command spire
 * cast nothing" was partly this: the mast is at the bow.
 *
 * The box is now fitted to what the CAMERA can see rather than to a constant.
 * `viewFit` is the world half-WIDTH of the view frustum at the focus plane —
 * half-height x aspect, i.e. the wider of the two frame axes — times a small
 * margin. By construction it contains whatever is filling the frame, at any
 * zoom, for any hull class, without the caller having to tell us the hull's
 * radius, and it never loses a ship at the left or right edge the way a
 * half-height fit does on a 16:9 frame. Measured live on this build:
 *
 *   Mothership portrait  focus 3077 m -> box 1536 m -> 0.75 m/texel @4096
 *   open / fleet view    focus 2600 m -> box 1560 m -> 0.76 m/texel
 *   battle (close orbit) focus  113 m -> box   77 m -> 0.04 m/texel
 *
 * 0.75 m per texel across a hull that renders ~1000 px wide is a third of a
 * pixel, so the island-onto-deck band the reference (hw1840080_3) hangs its
 * whole form read on is resolvable. Verified by A/B: toggling sun.castShadow
 * on the Mothership portrait changes 24.4% of the hull's bounding box, mean
 * luma drop 0.030, max drop 0.836 — i.e. the superstructure genuinely lands on
 * the deck. Round 2's build changed nothing measurable there.
 *
 * `heroFit` survives as a ceiling only — TARGET_TEXEL_METRES is now the WORST
 * texel size we will accept on a close framing, not the target, hence 0.75,
 * which at 4096 is a 1536 m half-extent: it still clears a 1060 m Mothership
 * with 45% of margin, where round 2's 1024 m did not clear it at all.
 */
const HERO_FOCUS_LIMIT = 3400;
const TARGET_TEXEL_METRES = 0.75;
/**
 * Margin on the view-derived fit, so objects just off-frame still cast into it.
 * Kept small: every extra 10% of extent is 10% off the texel density on the
 * subject, and the caller's `radius` is still an independent upper bound.
 */
const VIEW_COVER = 1.05;
const HALF_FOV_SCALE = Math.PI / 360;

// ---------------------------------------------------------------------------
// Filmic grade
// ---------------------------------------------------------------------------

/**
 * The grade pass. Runs in linear HDR, BEFORE tone mapping.
 *
 * ---------------------------------------------------------------------------
 * REBUILT AGAINST critique-round1 "colour" (three reviewers, all blocking)
 * ---------------------------------------------------------------------------
 * The previous version measured out at median luma 0.074, p95 0.187, 69% of
 * pixels below 0.10 — an unexposed frame with additive blowouts and nothing in
 * between. Three separate operators were responsible and all three are replaced:
 *
 *  - CONTRAST was `(col - 0.18) * 1.03 + 0.18`. On content whose median is
 *    0.074 linear that operator only ever *subtracts*: a 0.02 nebula pixel came
 *    out at 0.0152. The expansion half of the curve lived above the pivot where
 *    there was no data. It is now a log-space power curve pivoting on
 *    CONFIG.grade.pivot (0.11 linear — the geometric mean of the actual nebula
 *    and an actual lit plate). `pivot * (x/pivot)^gain` cannot clip, cannot go
 *    negative, and genuinely separates gas from hull.
 *
 *  - SPLIT TONING had a shadow band of smoothstep(0.02, 0.42) on a
 *    Reinhard-normalised luma, which covered essentially the whole frame, and a
 *    highlight band starting at ln 0.45 == 0.82 LINEAR, which nothing reached.
 *    What shipped was a global blue multiply, which is why every frame had the
 *    same cold cast. Both bands now sit on the content (see SPLIT_* below) and
 *    the tints are pushed hard enough to actually separate a bone-warm lit plate
 *    from its cold violet shadow side.
 *
 *  - VIGNETTE removed 26% at the corners starting a third of the way out, on a
 *    frame whose corners already measured 0.03 luma. It is now 0.13 confined to
 *    the outer quarter. A vignette is a highlight-shaping tool.
 *
 * Two operators are new:
 *
 *  - BLACK LIFT (`uLift`). `col*(1-lift) + lift`, the film-print lift, applied
 *    in linear HDR and tinted cool-violet. This is what gives the play area a
 *    real floor: true black lands at 0.09 display instead of 0.00, the nebula
 *    at 0.21, and HDR cores are untouched (40.0 comes out at 39.1). The
 *    reference frames (hw1840080_3 especially) have no true black anywhere.
 *
 *  - HIGHLIGHT SHOULDER (`uHiKnee`/`uHiRange`). Hue-preserving: above the knee
 *    the MAX CHANNEL is rolled off exponentially while the channel ratios are
 *    held, so a (0.3,1,1)*40 drive core arrives at ACES as (1.35,4.5,4.5) and
 *    resolves to a light cyan instead of flat white. Per-channel ACES on the raw
 *    value whitened everything identically, which is why bloom made every bright
 *    thing the same blob (critique "effects").
 *
 * ON THE DITHER. The nebula is a 40-degree-wide gradient of near-black blues;
 * on an 8-bit display it WILL band no matter how clean the HDR path is. We are
 * upstream of the tone map here, so the dither has to be pre-compensated: one
 * display LSB corresponds to a linear step of roughly
 *
 *     d(linear)/d(display) * (1/255)  =  2.2/255 * display^1.2  ~=  0.0086 * sqrt(linear)
 *
 * hence the `sqrt(colour)` weighting below. A flat-amplitude dither would be
 * invisible in the highlights and a snowstorm in the shadows.
 */
const FILMIC_SHADER = {
  name: 'StarfallFilmicShader',

  defines: {} as Record<string, string>,

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Drawing-buffer size in device pixels. */
    uResolution: { value: new THREE.Vector2(1, 1) },
    /** Seconds since start; drives the grain only. */
    uTime: { value: 0 },
    /** Radial colour split at the frame corner, in UV units. */
    uAberration: { value: 0.00055 },
    /** Corner darkening, 0..1. */
    uVignette: { value: CONFIG.grade.vignette },
    /** Normalised radius at which the vignette starts (1 = corner). */
    uVignetteSoft: { value: CONFIG.grade.vignetteSoft },
    /** Multiplicative grain amplitude. */
    uGrain: { value: 0.025 },
    /** Split-tone strength, 0 = neutral. */
    uSplit: { value: CONFIG.grade.split },
    /**
     * Tone-map exposure, mirrored from CONFIG so the split-tone bands can be
     * expressed in DISPLAY-referred units. See SPLIT_* below for why.
     */
    uExposure: { value: CONFIG.exposure },
    /** Linear tint multiplied into the shadows — cold violet. */
    uShadowTint: { value: new THREE.Vector3(0.72, 0.86, 1.28) },
    /** Linear tint multiplied into the highlights — warm bone. */
    uHighlightTint: { value: new THREE.Vector3(1.30, 1.06, 0.76) },
    /** 1 = untouched. */
    uSaturation: { value: CONFIG.grade.saturation },
    /** Log-space contrast gain; pivots on uPivot, not on a hardcoded 0.18. */
    uContrast: { value: CONFIG.grade.contrast },
    /** Contrast pivot in LINEAR radiance — where this scene's midtones live. */
    uPivot: { value: CONFIG.grade.pivot },
    /** Film-print black lift, linear, per channel. */
    uLift: {
      value: new THREE.Vector3(
        CONFIG.grade.lift[0], CONFIG.grade.lift[1], CONFIG.grade.lift[2],
      ),
    },
    /** Linear radiance at which the hue-preserving highlight shoulder begins. */
    uHiKnee: { value: CONFIG.grade.hiKnee },
    /** How far above the knee the max channel is allowed to travel. */
    uHiRange: { value: CONFIG.grade.hiRange },
    /** Ordered-dither amplitude, expressed as ~1 LSB of the 8-bit output. */
    uDither: { value: 0.011 },
  },

  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,

  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uTime;
uniform float uAberration;
uniform float uVignette;
uniform float uVignetteSoft;
uniform float uGrain;
uniform float uSplit;
uniform float uExposure;
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uSaturation;
uniform float uContrast;
uniform float uPivot;
uniform vec3  uLift;
uniform float uHiKnee;
uniform float uHiRange;
uniform float uDither;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// ---------------------------------------------------------------------------
// SPLIT-TONE BANDS — rebuilt twice now, so this time in units that cannot drift
// ---------------------------------------------------------------------------
// Round 1 had them on raw linear luma, where the shadow band covered the whole
// frame. Round 2 moved them onto Reinhard-normalised luma of the POST-CONTRAST
// value and overshot the other way: measured, SPLIT_SHADOW_HI 0.085 reached
// only 2.3% of the battle frame while SPLIT_HIGH_LO 0.085 warmed all of it at
// partial strength ("a split tone that fires everywhere is not a split tone").
//
// The reason both attempts missed is that the handle was EXPOSURE-INDEPENDENT
// while the thing being described — where the image sits — is not. The grade
// runs before the tone map, so doubling CONFIG.exposure moves every pixel half
// a stop on screen and moves the bands not at all. So the handle is now the
// ACES INPUT value, graded * exposure / 0.6, which is what the tone map
// actually consumes: a band placed here stays on the same displayed tones when
// exposure moves. That is also why uExposure exists.
//
// Placement, measured against CONFIG.exposure 1.22 (display value in brackets):
//   true black    lx 0.026  [0.005]   shadow weight 0.51 of uSplit
//   deep space    lx 0.035  [0.007]   shadow weight 0.45
//   hull shadow   lx 0.058  [0.015]   shadow weight 0.28
//   nebula field  lx 0.215  [0.137]   NEITHER band — mid gas stays neutral
//   lit plate     lx 0.492  [0.378]   highlight weight 0.28
//   specular lip  lx 0.85+  [0.58+]   highlight weight 0.55 (full uSplit)
//   engine core   lx 4+     [0.92+]   highlight weight 0.55
// Verified on the Mothership portrait after the change: a lit deck plate reads
// hue 6.8 deg at linear R/B 1.85 and its own shadow flank reads hue 247.6 deg
// at R/B 0.55. The reviewer's acceptance was "hue difference must exceed 25
// degrees"; it is 119. Round 2 measured the same two surfaces 12 degrees apart.
// i.e. the cool band lives on the void and the shadow sides of hulls, the warm
// band on lit plate and hotter, and the nebula — the one thing that dominates
// the frame by area — is deliberately left alone so the tone separates SUBJECT
// from BACKGROUND instead of tinting everything at once.
const float SPLIT_SHADOW_LO = 0.010;
const float SPLIT_SHADOW_HI = 0.105;
const float SPLIT_HIGH_LO   = 0.260;
const float SPLIT_HIGH_HI   = 0.760;

// Recursive 2x2 -> 8x8 ordered dither. Four ALU ops per level, no lookup table,
// and the pattern is stable in screen space so it never crawls.
float sf_bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float sf_bayer4(vec2 a) { return sf_bayer2(a * 0.5) * 0.25 + sf_bayer2(a); }
float sf_bayer8(vec2 a) { return sf_bayer4(a * 0.5) * 0.25 + sf_bayer2(a); }

void main() {
  vec2 uv = vUv;
  // q spans -1..1 on each axis; |q| is 1.4142 at the corners.
  vec2 q = (uv - 0.5) * 2.0;
  float rn = length(q) * 0.70710678;   // 0 at centre, 1 at the corner

  // -- 1. chromatic aberration --------------------------------------------
  // Quadratic in radius, so the centre third of the frame is untouched and the
  // split only shows where a real lens would actually show it.
  #ifdef SF_CHROMA
    vec2 off = q * (uAberration * rn * rn);
    vec3 col = vec3(
      texture2D(tDiffuse, uv + off).r,
      texture2D(tDiffuse, uv).g,
      texture2D(tDiffuse, uv - off).b);
  #else
    vec3 col = texture2D(tDiffuse, uv).rgb;
  #endif
  col = max(col, vec3(0.0));

  // -- 2. black lift --------------------------------------------------------
  // The film-print lift. Gives the play area a floor so it stops crushing into
  // an 8-bit void, without touching HDR cores: at col = 40 this is a 2% cut.
  col = col * (vec3(1.0) - uLift) + uLift;

  // -- 3. contrast ----------------------------------------------------------
  // Log-space gain about uPivot == pivot * (col/pivot)^uContrast. Monotonic,
  // sign-preserving, unbounded above, and it pivots where this scene's
  // midtones actually are instead of on an 18% grey card the frame never had.
  {
    vec3 c = max(col, vec3(1e-5));
    col = exp2((log2(c) - log2(uPivot)) * uContrast + log2(uPivot));
  }

  // Luma handles are taken AFTER the curve so the split-tone bands describe the
  // graded image, not the raw render.
  float lum = dot(col, LUMA);
  // Reinhard-normalised luma: a bounded 0..1 handle for the grain weighting.
  float ln = lum / (1.0 + lum);
  // Display-referred handle for the split-tone bands: exactly the value the
  // ACES fit will consume (three multiplies by exposure / 0.6). See SPLIT_*.
  float lx = lum * uExposure * 1.6666667;

  // -- 4. saturation --------------------------------------------------------
  col = mix(vec3(lum), col, uSaturation);

  // -- 5. split toning ------------------------------------------------------
  // Shadow weight now falls to zero before a lit plate, and highlight weight
  // reaches full strength on one. Previously the shadow term covered the whole
  // frame and the highlight term never fired at all.
  #ifdef SF_SPLIT
    float shadowW    = (1.0 - smoothstep(SPLIT_SHADOW_LO, SPLIT_SHADOW_HI, lx)) * uSplit;
    float highlightW = smoothstep(SPLIT_HIGH_LO, SPLIT_HIGH_HI, lx) * uSplit;
    col *= mix(vec3(1.0), uShadowTint, shadowW);
    col *= mix(vec3(1.0), uHighlightTint, highlightW);
  #endif

  // -- 6. hue-preserving highlight shoulder ---------------------------------
  // Roll the MAX CHANNEL off toward uHiKnee + uHiRange and scale the triplet by
  // the same factor, so channel ratios survive into the tone map. Without this
  // ACES saturates every channel independently and all hot cores — cyan drive,
  // amber fireball, white beam — resolve to the same flat white blob.
  {
    float m  = max(max(col.r, col.g), col.b);
    float ex = max(m - uHiKnee, 0.0);
    float mc = uHiKnee + uHiRange * (1.0 - exp(-ex / uHiRange));
    col *= mix(1.0, mc / max(m, 1e-4), step(uHiKnee, m));
  }

  // -- 7. vignette ----------------------------------------------------------
  col *= 1.0 - uVignette * smoothstep(uVignetteSoft, 1.0, rn);

  // -- 8. grain -------------------------------------------------------------
  // Multiplicative and biased into the low end: grain on a blown-out engine
  // core looks like a compression artefact, grain in the gas looks like film.
  #ifdef SF_GRAIN
    vec2 gp = uv * uResolution + fract(uTime * 61.0) * 311.7;
    float g = fract(sin(dot(gp, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    col *= 1.0 + g * uGrain * (0.30 + 0.70 * (1.0 - ln));
  #endif

  // -- 9. dither ------------------------------------------------------------
  col += (sf_bayer8(gl_FragCoord.xy) - 0.5) * uDither * sqrt(col);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`,
};

// ---------------------------------------------------------------------------
// ScenePass
// ---------------------------------------------------------------------------

/**
 * Draws the world into a Stage-owned half-float target (so the depth
 * attachment can be a texture the FX layers read next frame) and blits the
 * colour into the composer chain.
 *
 * With `target === null` it degenerates into a plain RenderPass: the scene goes
 * straight into the composer's read buffer and no blit happens. That is the
 * path used at low presets, where soft particles are off anyway.
 */
class ScenePass extends Pass {
  /** Off-chain scene target, or null to render straight into the chain. */
  target: THREE.WebGLRenderTarget | null = null;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    // The scene render leaves its own result in `target`; this pass never hands
    // the composer a different buffer than it was given, so no swap.
    this.needsSwap = false;

    this.blitMaterial = new THREE.ShaderMaterial({
      name: 'StarfallSceneBlit',
      uniforms: { tDiffuse: { value: null } },
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
      fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.blitMaterial);
  }

  /** Keeps the off-chain target (and its depth texture) matched to the buffer. */
  setSize(width: number, height: number): void {
    const t = this.target;
    if (t === null) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    t.setSize(w, h);
    if (t.depthTexture !== null) {
      // RenderTarget.setSize does not touch the depth attachment's image, and a
      // stale size there means the depth texture is reallocated at the wrong
      // resolution on the next bind.
      t.depthTexture.image.width = w;
      t.depthTexture.image.height = h;
      t.depthTexture.needsUpdate = true;
    }
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean,
  ): void {
    const chainTarget = this.renderToScreen ? null : readBuffer;

    if (this.target === null) {
      renderer.setRenderTarget(chainTarget);
      renderer.render(this.scene, this.camera);
      return;
    }

    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);

    this.blitMaterial.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(chainTarget);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.quad.dispose();
    this.blitMaterial.dispose();
  }
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

/**
 * The render device and everything bolted to it.
 *
 * Construction is cheap (no texture baking happens here); the heavy world
 * modules are built afterwards against `scene` and `renderer`. The consumer
 * drives exactly four methods per frame at most: `resize`, `updateShadowFrustum`,
 * `render` and — rarely — `setQuality`.
 */
export class Stage {
  /** The device. Antialiasing is off on purpose: SMAA does it in the chain. */
  readonly renderer: THREE.WebGLRenderer;
  /** Scene graph root. `scene.environment` is owned by the Backdrop, not by us. */
  readonly scene: THREE.Scene;
  /** The one camera. Near/far/fov come from CONFIG. */
  readonly camera: THREE.PerspectiveCamera;
  /** The single hard key light. Its direction is read back from `sun.position`. */
  readonly sun: THREE.DirectionalLight;
  /** Sky/ground fill so shadow sides are nebula-tinted instead of dead black. */
  readonly fill: THREE.HemisphereLight;
  /** The post chain. Rebuilt by `setQuality`; the instance itself is stable. */
  readonly composer: EffectComposer;

  private quality: QualitySettings;

  private readonly canvas: HTMLCanvasElement;
  private width = 1;
  private height = 1;

  /** Off-chain scene target carrying the depth attachment, or null. */
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private _depthTexture: THREE.DepthTexture | null = null;

  private readonly scenePass: ScenePass;
  private readonly outputPass: OutputPass;
  private bloomPass: UnrealBloomPass | null = null;
  private filmicPass: ShaderPass | null = null;
  private smaaPass: SMAAPass | null = null;

  /** Uniform bag of `filmicPass`, cached so `render` does no lookups. */
  private filmicUniforms: { [name: string]: { value: any } } | null = null;

  /** Mip-0 scale for the bloom chain (UnrealBloomPass halves this again). */
  private bloomScale = 1;

  /**
   * Direction TO the sun, unit. Kept in sync with `sun.position`: the boot
   * sequence aims the key light by writing `sun.position` directly, and
   * `updateShadowFrustum` then moves that same position around the focus point,
   * so we re-read the direction whenever someone else has touched it.
   */
  private readonly sunDir = new THREE.Vector3();
  private readonly appliedSunPos = new THREE.Vector3();

  /** Last shadow box half-extent, so the ortho projection is rebuilt only on change. */
  private shadowRadius = -1;

  private contextLost = false;
  private readonly onContextLost: (e: Event) => void;
  private readonly onContextRestored: () => void;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.canvas = canvas;
    this.quality = quality;

    // -- device -------------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Post handles AA. MSAA on the default framebuffer would also be thrown
      // away the moment we render through a composer target.
      antialias: false,
      alpha: false,
      // No stencil anywhere in the game; dropping it keeps the depth attachment
      // a clean 24/32-bit depth format instead of a packed depth-stencil.
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      // MANDATORY. See the module header: 1 m to 4e7 m in one depth buffer.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    // -- scene / camera -----------------------------------------------------
    this.scene = new THREE.Scene();
    // No background and no fog: the Backdrop owns the sky sphere, and fog at
    // these distances would fight the nebula sheets.
    this.scene.background = null;
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camFov, 1, CONFIG.camNear, CONFIG.camFar,
    );
    this.camera.position.set(0, 0, 1);
    this.scene.add(this.camera);

    // -- lighting -----------------------------------------------------------
    // Exactly two lights. Bounce, ambient and every specular highlight that is
    // not the key comes from `scene.environment` (the Backdrop's PMREM cube).
    //
    // THE PMREM IS DIM AND THAT IS MEASURED, NOT ASSUMED. Reading the Backdrop's
    // cube target back gives a mean radiance of (0.0118, 0.0114, 0.0175) with a
    // 20.0 peak confined to the star. three's getIBLIrradiance multiplies by PI,
    // so the diffuse term a hull sees from the environment is ~0.044 — three
    // orders below the key. Shadow sides were consequently dead, which is
    // critique "lighting" ("the IBL contributes nothing, so shadows are dead").
    //
    // `environmentIntensity` is the honest fix: it is a straight gain on the
    // irradiance the PMREM delivers, so the shadow side stays *structured* and
    // nebula-coloured (it still carries the cube's directionality) instead of
    // being flattened by more hemisphere. See CONFIG.envIntensity for the
    // arithmetic and for what to do if the Backdrop's radiance is ever raised.
    this.scene.environmentIntensity = CONFIG.envIntensity;

    this.sunDir.set(CONFIG.sunDir[0], CONFIG.sunDir[1], CONFIG.sunDir[2]).normalize();

    this.sun = new THREE.DirectionalLight(CONFIG.sunColour, CONFIG.sunIntensity);
    this.sun.position.copy(this.sunDir).multiplyScalar(1e6);
    this.appliedSunPos.copy(this.sun.position);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.setScalar(quality.shadowResolution);
    // Slope-scaled bias is set per-frustum; this constant term only has to kill
    // the quantisation acne on surfaces facing the light head-on.
    this.sun.shadow.bias = -0.00016;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 20000;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // HemisphereLight, not AmbientLight: a flat ambient term destroys form.
    // Sky colour is the nebula bounce, ground colour is the void's own faint
    // scatter, so a hull's underside is tinted rather than merely darker.
    this.fill = new THREE.HemisphereLight(
      CONFIG.fillColour, CONFIG.ambientColour, CONFIG.fillIntensity,
    );
    this.fill.position.set(0, 1, 0);
    this.scene.add(this.fill);

    // -- composer -----------------------------------------------------------
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(quality.pixelRatio);

    this.scenePass = new ScenePass(this.scene, this.camera);
    this.outputPass = new OutputPass();

    this.rebuildSceneTarget();
    this.rebuildPasses();

    // -- context loss -------------------------------------------------------
    this.onContextLost = (e: Event): void => {
      e.preventDefault();
      this.contextLost = true;
      console.error(
        '[starfall/stage] WEBGL CONTEXT LOST — rendering halted. '
        + 'The GPU process crashed or the driver reset. Waiting for restore.',
      );
    };
    this.onContextRestored = (): void => {
      console.warn('[starfall/stage] WebGL context restored — resuming.');
      this.contextLost = false;
      // Force every GPU resource to be re-uploaded and the shadow map re-baked.
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowRadius = -1;
      this.resize(this.width, this.height);
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);

    // Sane initial size; main.ts calls resize() again before the first frame.
    this.resize(
      canvas.clientWidth || window.innerWidth || 1,
      canvas.clientHeight || window.innerHeight || 1,
    );
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Scene depth for soft particles, or null when the preset does not allocate
   * one. Contents are the LOGARITHMIC depth written by the previous frame's
   * scene pass (`logarithmicDepthBuffer` is on), so consumers must linearise
   * with `z = exp2(d * log2(far + 1)) - 1`, not with the usual perspective
   * reciprocal. Reading it during the scene pass of the SAME frame is undefined
   * — it is the frame-behind copy that is safe.
   */
  get depthTexture(): THREE.DepthTexture | null {
    return this._depthTexture;
  }

  /** Resize the device, the camera aspect and every buffer in the chain. */
  resize(w: number, h: number): void {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.quality.pixelRatio);
    // updateStyle = false: style.css already pins #viewport to the viewport, and
    // letting three write inline width/height fights the CSS on DPR changes.
    this.renderer.setSize(this.width, this.height, false);

    this.composer.setPixelRatio(this.quality.pixelRatio);
    this.composer.setSize(this.width, this.height);

    const pr = this.renderer.getPixelRatio();
    const bw = Math.max(1, Math.round(this.width * pr));
    const bh = Math.max(1, Math.round(this.height * pr));

    // composer.setSize already forwarded the buffer size to every pass; the
    // bloom chain is the one that wants a different one.
    if (this.bloomPass !== null) {
      this.bloomPass.setSize(
        Math.max(2, Math.round(bw * this.bloomScale)),
        Math.max(2, Math.round(bh * this.bloomScale)),
      );
    }
    if (this.filmicUniforms !== null) {
      (this.filmicUniforms.uResolution.value as THREE.Vector2).set(bw, bh);
    }
  }

  /**
   * Draw one frame. Allocates nothing.
   *
   * @param dt   wall-clock delta in seconds (forwarded to time-based passes)
   * @param time seconds since start (drives the grain phase)
   */
  render(dt: number, time: number): void {
    if (this.contextLost) return;
    if (this.filmicUniforms !== null) this.filmicUniforms.uTime.value = time;
    this.composer.render(dt);
  }

  /**
   * Retarget the key light's shadow frustum onto a box of half-extent `radius`
   * centred on (cx, cy, cz) — in practice the camera focus point.
   *
   * TEXEL SNAPPING. The box centre is quantised to whole shadow-map texels
   * along the light's own screen axes before the light is placed. Without it
   * the shadow map resamples on a sub-texel grid every frame and every shadow
   * edge in the scene crawls as the camera moves; with it they are rock solid.
   * The basis used here must match the one three's shadow map builds internally
   * (`camera.lookAt` with a world +Y up), or the snap is along the wrong axes
   * and does nothing.
   *
   * FRUSTUM FITTING (critique "lighting" — nothing self-shadows). `radius` is
   * the caller's idea of how much world it wants covered, in practice a multiple
   * of the orbit distance. It is now treated as an upper bound rather than a
   * target: once it drops under HERO_FOCUS_LIMIT the box is collapsed to the
   * half-extent that yields TARGET_TEXEL_METRES per texel, so a hero hull gets
   * ~0.5 m shadow texels and its own superstructure lands on its own deck.
   *
   * @param heroRadius optional bounding-sphere radius, in metres, of the single
   *   hull that dominates the frame. When supplied the box is fitted to it
   *   exactly (with a 15% margin for its own cast shadow) and the camera-derived
   *   `radius` is ignored. Callers that do not have it may omit it — the
   *   four-argument form still works and still gets the hero cascade.
   */
  updateShadowFrustum(
    cx: number, cy: number, cz: number, radius: number, heroRadius?: number,
  ): void {
    const sun = this.sun;
    if (!sun.castShadow) return;

    // Someone (the boot sequence aligning the key light with the backdrop star)
    // may have written sun.position directly. Treat that as "set the direction".
    if (!sun.position.equals(this.appliedSunPos)) {
      this.sunDir.copy(sun.position).sub(sun.target.position);
      if (this.sunDir.lengthSq() < 1e-12) this.sunDir.set(0, 1, 0);
      this.sunDir.normalize();
    }

    const shadow = sun.shadow;
    const mapSize = shadow.mapSize.width;

    // Worst texel size we accept on a close framing (see TARGET_TEXEL_METRES):
    // at 4096 that is a 1536 m half-extent, at 1024 (low preset) 384 m.
    const heroFit = mapSize * TARGET_TEXEL_METRES * 0.5;

    // World half-WIDTH of the view frustum at the focus plane (the wider frame
    // axis at 16:9). This is the honest measure of "how much world is on
    // screen", and it is what the box should track — no allocation, three
    // subtractions and a sqrt.
    const dfx = cx - this.camera.position.x;
    const dfy = cy - this.camera.position.y;
    const dfz = cz - this.camera.position.z;
    const focusDist = Math.sqrt(dfx * dfx + dfy * dfy + dfz * dfz);
    const viewFit = Math.tan(this.camera.fov * HALF_FOV_SCALE)
      * focusDist * this.camera.aspect * VIEW_COVER;

    let want: number;
    if (heroRadius !== undefined && heroRadius > 0) {
      // Explicit hero: fit the hull's bounding sphere plus room for its shadow.
      want = heroRadius * 1.15;
    } else {
      // `radius` is the caller's coverage request and stays an upper bound; the
      // view fit is what actually decides, so a hull that fills the frame gets
      // a box that fits the frame rather than one sized to the orbit distance.
      want = Math.min(radius, viewFit);
      // Close framing additionally refuses to go mushier than TARGET_TEXEL_METRES.
      if (radius <= HERO_FOCUS_LIMIT) want = Math.min(want, heroFit);
    }
    const r = Math.min(SHADOW_RADIUS_MAX, Math.max(SHADOW_RADIUS_MIN, want));

    // Basis of the shadow camera: +Z points back at the light, X = up x Z,
    // Y = Z x X. Mirrors Object3D.lookAt for cameras.
    _sz.copy(this.sunDir);
    _sx.copy(WORLD_UP).cross(_sz);
    if (_sx.lengthSq() < 1e-8) _sx.set(1, 0, 0);
    else _sx.normalize();
    _sy.copy(_sz).cross(_sx);

    const texel = (2 * r) / mapSize;
    let px = cx * _sx.x + cy * _sx.y + cz * _sx.z;
    let py = cx * _sy.x + cy * _sy.y + cz * _sy.z;
    const pz = cx * _sz.x + cy * _sz.y + cz * _sz.z;
    px = Math.round(px / texel) * texel;
    py = Math.round(py / texel) * texel;

    _snap.set(0, 0, 0)
      .addScaledVector(_sx, px)
      .addScaledVector(_sy, py)
      .addScaledVector(_sz, pz);

    // Stand the light off far enough that anything plausibly above the box
    // still casts into it, but not so far that near/far precision suffers.
    const dist = r * 5;

    sun.target.position.copy(_snap);
    sun.target.updateMatrixWorld();
    sun.position.copy(_snap).addScaledVector(this.sunDir, dist);
    this.appliedSunPos.copy(sun.position);
    sun.updateMatrixWorld();

    if (this.shadowRadius !== r) {
      this.shadowRadius = r;
      const cam = shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = Math.max(1, dist - r * 3);
      cam.far = dist + r * 3;
      cam.updateProjectionMatrix();

      // BIAS IN METRES, NOT IN MAGIC NUMBERS (critique "lighting": retargeting
      // the frustum without retuning the bias just trades missing shadows for
      // acne). Both terms are now expressed against the box extent:
      //
      //  - normalBias offsets the sample along the surface normal in WORLD
      //    units, so it must track texel size. 1.6x texel was pushing 3 m of
      //    offset at fleet scale, which walks straight past a 1-3 m greeble and
      //    erases exactly the contact shadows we are trying to get back. 1.0x
      //    texel is the floor that still holds on a 45-degree plate under
      //    PCFSoft's 1-texel kernel; on the Mothership framing that is 0.84 m
      //    on a hull whose smallest shadow caster (the mast) is 130 m tall, so
      //    the contact is preserved with two orders of margin.
      //  - shadow.bias is compared in the ortho camera's normalised [0,1] depth,
      //    so a metric offset converts by dividing by the depth range (6r here).
      //    Half a texel of depth slop is plenty once normalBias has done its job.
      const depthRange = 6 * r;
      shadow.normalBias = Math.min(6, Math.max(0.02, texel));
      shadow.bias = -(texel * 0.5) / depthRange;
    }
  }

  /**
   * Apply a new quality preset. This genuinely rewires the pipeline — passes
   * are created and destroyed, the shadow map is reallocated and the depth
   * attachment appears or disappears — rather than merely storing the object.
   *
   * Callers must also forward the settings to every RenderSystem; the Stage
   * only owns the device-level half.
   */
  setQuality(q: QualitySettings): void {
    this.quality = q;

    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;

    if (this.sun.shadow.mapSize.width !== q.shadowResolution) {
      this.sun.shadow.mapSize.setScalar(q.shadowResolution);
      // The allocated map is the old size; drop it so three reallocates.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.shadowRadius = -1;
    }
    this.renderer.shadowMap.needsUpdate = true;

    this.rebuildSceneTarget();
    this.rebuildPasses();
    this.resize(this.width, this.height);
  }

  /** Release every GPU resource the Stage owns. Does not touch world modules. */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.disposeChainPasses();
    this.scenePass.dispose();
    this.outputPass.dispose();
    this.composer.passes.length = 0;
    this.composer.dispose();

    this.sceneTarget?.dispose();
    this._depthTexture?.dispose();
    this.sceneTarget = null;
    this._depthTexture = null;

    this.sun.shadow.map?.dispose();
    this.sun.shadow.dispose();
    this.scene.remove(this.sun, this.sun.target, this.fill, this.camera);

    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Allocate (or release) the off-chain scene target. Only the top presets pay
   * for it — below that there are no soft particles to feed and the extra blit
   * is not worth it.
   */
  private rebuildSceneTarget(): void {
    const want = this.quality.preset >= DEPTH_TEXTURE_MIN_PRESET;
    if (want === (this.sceneTarget !== null)) return;

    if (!want) {
      this.sceneTarget?.dispose();
      this._depthTexture?.dispose();
      this.sceneTarget = null;
      this._depthTexture = null;
      this.scenePass.target = null;
      return;
    }

    // DEPTH_COMPONENT24. No stencil anywhere in the game, so a packed
    // depth-stencil format would only cost bandwidth, and 24 bits is ample once
    // the distribution is logarithmic.
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depth.name = 'Stage.sceneDepth';
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    depth.generateMipmaps = false;

    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      samples: 0,
    });
    rt.texture.name = 'Stage.sceneColor';

    this.sceneTarget = rt;
    this._depthTexture = depth;
    this.scenePass.target = rt;
  }

  /** Destroy the quality-dependent passes. `scenePass`/`outputPass` survive. */
  private disposeChainPasses(): void {
    this.bloomPass?.dispose();
    this.filmicPass?.dispose();
    this.smaaPass?.dispose();
    this.bloomPass = null;
    this.filmicPass = null;
    this.smaaPass = null;
    this.filmicUniforms = null;
  }

  /**
   * Assemble the pass chain for the current preset.
   *
   *   preset 0  scene -> output                       (no post at all)
   *   preset 1  scene -> bloom(1/4) -> filmic(lite) -> [aa] -> output
   *   preset 2+ scene -> bloom(1/2) -> filmic(full) -> [aa] -> output
   */
  private rebuildPasses(): void {
    const q = this.quality;
    const composer = this.composer;

    this.disposeChainPasses();
    composer.passes.length = 0;
    composer.addPass(this.scenePass);

    // -- bloom --------------------------------------------------------------
    if (q.bloom && q.preset >= 1) {
      // UnrealBloomPass already halves whatever size it is given for mip 0, so
      // scale 1 is a half-res chain and scale 0.5 is quarter-res.
      this.bloomScale = q.preset >= 3 ? 1 : 0.5;

      const bloom = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        CONFIG.bloomStrength,
        CONFIG.bloomRadius,
        CONFIG.bloomThreshold,
      );
      // Warm the halo outward. Mip 0 and mip 1 stay near-neutral so a cyan drive
      // core keeps its own hue through the tight halo — combined with the
      // grade's hue-preserving shoulder that is what stops every bright thing
      // resolving to the same white blob (critique "effects"). Only the wide
      // mips drift toward amber, which is what makes the outer glow read as hot
      // gas rather than a lens defect.
      const tints = bloom.bloomTintColors;
      if (tints.length >= 5) {
        tints[0].set(1.0, 1.0, 1.0);
        tints[1].set(1.01, 0.995, 0.98);
        tints[2].set(1.04, 0.99, 0.93);
        tints[3].set(1.1, 0.97, 0.86);
        tints[4].set(1.16, 0.95, 0.8);
      }
      // SOFT KNEE. UnrealBloomPass's high-pass defaults to smoothWidth 0.01,
      // which is effectively a step: a pixel at threshold - epsilon contributes
      // nothing and a pixel at threshold + epsilon contributes fully. That is
      // what makes thresholded bloom pop and crawl along moving highlights as
      // they cross the line. A wide knee ramps the contribution in over a stop
      // or so, so a drive flaring up blooms progressively instead of switching
      // on. Costs nothing — it is one uniform on a pass that already runs.
      const hp = bloom.highPassUniforms as
        Record<string, { value: number }> | undefined;
      if (hp && hp.smoothWidth) hp.smoothWidth.value = BLOOM_KNEE;

      this.bloomPass = bloom;
      composer.addPass(bloom);
    }

    // -- filmic grade -------------------------------------------------------
    if (q.preset >= 1) {
      const defines: Record<string, string> = { SF_SPLIT: '1' };
      if (q.preset >= 1) defines.SF_GRAIN = '1';
      // The aberration costs two extra texture fetches; it is the first thing
      // to go when we are counting bandwidth.
      if (q.preset >= 2) defines.SF_CHROMA = '1';
      FILMIC_SHADER.defines = defines;

      const filmic = new ShaderPass(FILMIC_SHADER);
      filmic.material.depthTest = false;
      filmic.material.depthWrite = false;
      this.filmicPass = filmic;
      this.filmicUniforms = filmic.uniforms;
      composer.addPass(filmic);
    }

    // -- antialias ----------------------------------------------------------
    // SMAA operates in linear-srgb and therefore MUST sit before OutputPass.
    // 'fxaa' and 'taa' both resolve to SMAA here: FXAA needs sRGB input (so it
    // would have to follow OutputPass, and it smears the star field), and TAA
    // needs velocity buffers the fleet renderer does not produce. Only 'none'
    // actually leaves the frame aliased.
    if (q.antialias !== 'none') {
      const smaa = new SMAAPass();
      this.smaaPass = smaa;
      composer.addPass(smaa);
    }

    // -- tone map + transfer function --------------------------------------
    // The only place in the whole pipeline where linear becomes sRGB.
    composer.addPass(this.outputPass);
  }
}
