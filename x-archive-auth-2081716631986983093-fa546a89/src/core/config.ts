/**
 * Global tuning constants. One place to change scale, pacing and limits.
 */

export const CONFIG = {
  /** Fixed simulation step, seconds. */
  simStep: 1 / 60,
  /** Max sim steps run per frame before we drop time (avoids death spirals). */
  maxCatchupSteps: 4,

  /** Battlespace radius in metres. Ships are clamped inside this. */
  mapRadius: 46000,
  /** Soft vertical band — the sim is fully 3D but content clusters near y = 0. */
  mapHeight: 9000,

  // --- camera ---
  camNear: 1,
  camFar: 4.0e7,
  camFov: 45,
  /** Orbit distance limits, metres. */
  camDistMin: 90,
  camDistMax: 34000,

  // --- entity budgets ---
  maxShips: 1600,
  maxProjectiles: 6000,
  maxBeams: 256,
  maxAsteroids: 900,

  // --- economy ---
  startResources: 2600,
  /**
   * Fleet supply. A mothership grants `supplyCapBase` and each carrier
   * `supplyPerCarrier`, so a starting fleet caps at 150 and a fleet with three
   * carriers at 315.
   *
   * Raised from 60/20. "Fleet supply could loosen, now too tight for
   * MAGNIFICENT battles." At 120 a player who built nothing but interceptors
   * (1 supply each) topped out at roughly 120 hulls, and a real line of battle —
   * destroyers at 8, frigates at 4 — capped out around fifteen ships. That is a
   * skirmish. The renderer is instanced and the sim is pooled and spatially
   * hashed; neither of them was the thing saying no.
   */
  supplyCapBase: 150,
  supplyPerCarrier: 55,

  // --- combat feel ---
  autoAcquireRange: 2400,
  /** Extra spacing multiplier so ships do not intersect while formed up. */
  separationPad: 1.9,

  // --- rendering ---
  /**
   * Bloom is still a light source, not a filter. The threshold is compared
   * against SCENE-LINEAR radiance (UnrealBloomPass runs before the grade and
   * before exposure), so it is not affected by the exposure change below.
   *
   * Round-2 critique "effects" claimed 0.62 was low enough to bleed the gas.
   * Measured, it is not: the nebula sits at 0.105 scene-linear and a lit hull
   * plate at ~0.33 after the key rebalance, both far under 0.62 — the milky
   * look was the sky's own radiance plus exposure 2.0, not bloom. What crosses
   * 0.62 is what should: engine cores (40+), beams, impact flashes and the
   * brightest specular lips on a chamfer. Threshold held; strength trimmed a
   * little because the key light is now 2.5x stronger, so the lips that cross
   * it are hotter than they were.
   */
  /**
   * ROUND 3: "bloom too much, postprocessing gate higher."
   *
   * 1.06 is barely above the diffuse white point, so every drive plume, every
   * tracer sheath and every lit window was crossing it — and once most of the
   * bright pixels in a frame bloom, bloom stops being a highlight and becomes a
   * soft-focus filter over the whole image. It is also what turned the drive
   * columns into smears: the plume's own gradient was being convolved with a
   * screen-space blur on top of its own falloff.
   *
   * At 1.45 the gate passes what is genuinely INCANDESCENT — nozzle throats,
   * beam cores, detonations — and leaves lit hull plating, sheaths and windows
   * to be drawn by the shaders that authored them.
   */
  bloomThreshold: 1.45,
  bloomStrength: 0.46,
  bloomRadius: 0.52,
  /**
   * TONE-MAP EXPOSURE. 2.0 -> 1.22, and this time the comment is the value.
   *
   * Round-2 critique (three reviewers, blocker): "`exposure: 2.0` sits directly
   * beneath a doc comment stating the value was being taken 1.06 -> 1.00". It
   * had been doubled on top of backdrop.ts's 3-5x strata raise, and the measured
   * result was a battle frame with median 0.307 linear, p05 0.147 and only 0.7%
   * of pixels below 0.02 — a two-stop image with no black point at all.
   *
   * 1.22 is solved, not guessed. three's ACES applies `exposure / 0.6`, so the
   * chain from a graded linear value g to display is `ACES(g * exposure/0.6)`.
   * Against the measured content:
   *
   *   clean sunlit plate  scene 0.33 -> graded 0.185 -> display 0.24
   *   hull shadow flank   scene 0.030 -> graded 0.041 -> display 0.077
   *   deep space (lift)   scene 0.000 -> graded 0.013 -> display 0.005
   *
   * i.e. the reference's 0.20-0.30 lit plate over a 0.07-0.10 shadow flank, and
   * a black point that is genuinely black instead of sRGB 0.225.
   *
   * COUPLING — READ BEFORE CHANGING EITHER OF THESE. `src/world/backdrop.ts`
   * owns the sky radiance and is tuned independently. Sky brightness must be
   * taken out of the SKY, never out of this number, and hull brightness must be
   * taken out of `sunIntensity`, never out of this number. Exposure is the last
   * knob to touch, not the first: it moves the sky and the hulls together and
   * therefore cannot fix a hull-to-sky ratio, which is the thing being graded.
   */
  exposure: 1.08,

  /**
   * FILMIC GRADE — see renderer.ts FILMIC_SHADER.
   *
   * Round 1 fixed a frame that had no midtones. Round 2 found the opposite
   * failure — 03-battle measured median 0.307 linear, p05 0.147, only 0.7% of
   * pixels below 0.02 and 0.50% above 0.8, where sixteen genuine Homeworld
   * frames run a median of 0.008-0.21 with 6-90% of pixels below 0.10. The
   * round-1 note below is kept because its *method* is still right; the numbers
   * are re-solved for `exposure` 1.22 and the new key:
   *
   *   true black  0.000 lin -> lift 0.018 -> contrast 0.013 -> display 0.004
   *   deep space  0.005 lin -> lift 0.023 -> contrast 0.017 -> display 0.007
   *   hull shade  0.040 lin -> lift 0.057 -> contrast 0.043 -> display 0.045
   *   nebula      0.105 lin -> lift 0.121 -> contrast 0.122 -> display 0.169
   *   hull lit    0.200 lin -> lift 0.215 -> contrast 0.242 -> display 0.378
   *
   * i.e. a real black point at the bottom, the gas sitting BELOW a lit plate
   * rather than eight times above it, and headroom left for the additive layer
   * (critique "effects": "zero pixels in the play area exceed twice the frame
   * median" — a tracer cannot read against a sky it is dimmer than).
   */
  grade: {
    /**
     * Film-print black lift, applied as `col*(1-lift) + lift` in linear HDR.
     * Tinted cool-violet so the floor reads as nebula haze rather than fogged
     * film. HDR cores are untouched (a 40.0 core comes out at 39.1).
     */
    lift: [0.013, 0.015, 0.026] as [number, number, number],
    /**
     * Log-space contrast gain. The old operator was
     * `(col - 0.18) * 1.03 + 0.18` on a frame whose median was 0.074 linear —
     * a pure luminance *reduction* over ~99% of the image. This is a genuine
     * power curve (`pivot * (col/pivot)^gain`) which cannot clip and cannot go
     * negative, so it separates instead of subtracting.
     */
    contrast: 1.18,
    /**
     * Pivot for the curve, in LINEAR radiance — the geometric mean of the
     * post-lift nebula (0.049) and a post-lift lit plate (0.281). This is where
     * the scene actually lives; 0.18 was not.
     *
     * BOTH HELD at round 1's values, deliberately. The round-2 reviewer flagged
     * the lift / vignette / dither trio as "correct and well-judged ... the
     * problem is the exposure stacked above these", and this curve is part of
     * the same solve. Re-run against `exposure` 1.22 it puts deep space at
     * 0.007 display, the nebula at 0.17 and a lit plate at 0.38, which is the
     * range that was wanted; raising the gain as well would be the third
     * over-correction in three rounds.
     */
    pivot: 0.11,
    /**
     * 1.14 -> 1.06. Critique "colour": "+14% saturation on a frame with a
     * twelve-degree hue spread only intensifies the single cyan cast". The hue
     * spread is now built by the LIGHTS (a warm key against a much weaker and
     * much less violently blue fill — see sunColour/fillColour below), so the
     * grade no longer has to shout at a monochrome field.
     */
    saturation: 1.06,
    /**
     * Split-tone strength. The bands live in renderer.ts and are expressed in
     * POST-EXPOSURE units so that moving `exposure` moves them with the
     * content instead of stranding them (round 2: the shadow band ended up
     * covering 2.3% of the frame and the highlight band covered all of it).
     */
    split: 0.55,
    /** Corner darkening. Was 0.26 starting at 0.34 — it was eating the frame. */
    vignette: 0.13,
    vignetteSoft: 0.6,
    /**
     * Hue-preserving highlight shoulder, in linear radiance. Above `hiKnee` the
     * MAX CHANNEL is rolled off exponentially toward `hiKnee + hiRange` while
     * the channel ratios are held, so a cyan drive core stays cyan into the
     * bloom instead of becoming another identical white blob (critique
     * "effects": bloom makes every bright thing the same white).
     */
    hiKnee: 1.2,
    hiRange: 2.6,
  },

  /**
   * LOD switch distances expressed as multiples of the ship's bounding radius.
   * lod0 (hero) below [0], lod1 below [1], lod2 below [2], billboard beyond.
   */
  lodSwitch: [26, 70, 190] as [number, number, number],

  /**
   * Direction TO the sun (normalised at load).
   *
   * WAS [-0.42, 0.26, 0.87]: ~15 degrees of elevation and 0.87 straight down
   * +Z, which under the default camera (eye on the +Z side of focus) is a key
   * light sitting almost on the view axis. That wraps the model, kills the
   * terminator and puts the specular lobe behind the geometry — critique
   * "lighting", and the reason the Mothership's dorsal deck held one continuous
   * value across 900 px.
   *
   * NOW: 44 degrees of elevation, 47 degrees to port of the view axis. A proper
   * three-quarter rake. Top planes take NdotL 0.70, the port flank 0.52, the bow
   * 0.49 and the starboard flank goes into shadow, so the three families of
   * surface separate and every chamfer catches a lip. Everything downstream
   * (backdrop star placement, planet terminator, weapon rim light) reads this.
   */
  sunDir: [-0.52, 0.7, 0.49] as [number, number, number],
  /**
   * 0xfff1d8 -> 0xffeec6. Round-2 critique "lighting" (blocker): the Mothership
   * measured mean hull RGB (54, 57, 91) — BLUE-dominant, i.e. lit by sky, not
   * by a sun — and "lit faces must be WARM-dominant (R > B)". Linear R/B of the
   * key goes 1.45 -> 1.85, which is roughly a 4500 K star against the cool fill
   * below and is what separates the two families of surface by TEMPERATURE
   * rather than only by value.
   */
  sunColour: 0xffeec6,
  /**
   * THE KEY. 3.2 -> 10.0.
   *
   * Round-2 critique "lighting" (blocker, two reviewers): "The key light is
   * gone. Lit dorsal deck 0.0542 linear, shadow flank 0.0341 — a 1.6:1 ratio
   * across a 2100 m hull, no terminator anywhere ... mean hull RGB (54,57,91),
   * i.e. BLUE-dominant." Reproduced to three decimals on 03-hull-Mothership.png
   * (boxes 900,388-1400,450 and 950,575-1350,608): 0.0520 / 0.0323 = 1.61 with
   * a lit-face R/B of 0.58.
   *
   * Inverting those numbers back through the grade gives the scene radiances:
   * lit 0.0246, shadow 0.0153 — the KEY was worth 0.0093, i.e. 38% of a lit
   * surface, on a hull whose acceptance test is "0.4-0.7x the local sky". It
   * measured 0.17x. Every bit of surface geometry round 1 added was being
   * rendered inside a lightbox.
   *
   * SOLVED, NOT GUESSED. The reviewer's suggested 6.5 was tested and misses:
   * measured live on the Mothership portrait with everything else fixed
   * (scripted sweep, one browser session, one frozen frame, so nothing else in
   * the build could move underneath the numbers) —
   *
   *   sun  6.5   lit box mean 0.082   p90 0.19   0.33x sky   R/B 1.50
   *   sun  8.5   lit box mean 0.092   p90 0.26   0.38x sky   R/B 1.53
   *   sun 10.0   lit box mean 0.107   p90 0.31   0.44x sky   R/B 1.59
   *   sun 12.0   lit box mean 0.132   p90 0.41   0.54x sky   R/B 1.65
   *
   * 10.0 is the lowest value that clears the 0.4x floor of the reviewer's own
   * acceptance band with the lit plate (p90) landing in 0.20-0.30+ and the lit
   * faces genuinely WARM-dominant. It is also what finally gives the shadow map
   * something worth casting: a cast shadow is a subtraction of the KEY, so at
   * 1.6:1 no frustum tuning in renderer.ts could ever have made one visible.
   *
   * DO NOT compensate a bright sky by lowering this. See `exposure`.
   * NOTE FOR src/world/planet.ts: it builds its own irradiance as
   * `sunColour * CONFIG.sunIntensity` (planet.ts ~1257). A 3.1x key means the
   * planet's day side needs re-solving on its side of the fence — the number
   * that moved is here, deliberately, and it is not going back down.
   */
  sunIntensity: 10.0,
  /**
   * INDIRECT. 2.4 -> 1.0, and 1.0 is not a guess either: `src/world/backdrop.ts`
   * now publishes a radiance contract ("THE SKY'S RADIANCE CONTRACT") stating
   * the baked sky's mean linear luma is ~0.09 and that "the renderer should
   * pick envIntensity from THAT number, not from the old 0.008-mean sky". At
   * 1.0 an IBL-only plate sits at ~0.15x the sky, which is the value that
   * contract is written around. This is the coupling the old comment warned
   * about and round 1 then broke by raising both sides at once.
   *
   * MEASURED CAVEAT, and it matters for whoever owns hullMaterial.ts. On a live
   * A/B with the scene frozen, setting envIntensity AND fillIntensity to ZERO
   * moved the Mothership's shadow flank from 0.0138 to 0.0133 — four percent.
   * Killing the sun as well left it at 0.0128. So essentially NONE of a hull's
   * shadow-side value comes from this file: it comes from hullMaterial.ts's
   * aerial-perspective term (HAZE_DENSITY 1/26000 x HAZE_STRENGTH 0.78 blends
   * 8.5% of raw sky radiance into a hull at the 3 km portrait distance, which
   * is 0.016 scene — the whole measured value). That is why round 2's
   * lit/shadow ratio could not be fixed from here, and why it still reads high
   * (7:1 rather than the requested 2.5-3.5:1) after this pass: the numerator is
   * ours, the denominator is not.
   */
  envIntensity: 1.0,
  /**
   * Cool bounce fill from the nebula. 0x4a7bd8 was linear (0.070, 0.198, 0.694)
   * — a red channel one FOURTEENTH of its blue. Any surface it touched went
   * blue-dominant on the spot, which is half of the measured (54, 57, 91) hull.
   * 0x6f8ec2 is linear (0.161, 0.271, 0.539): still unmistakably cool and still
   * nebula-coloured, but it tints instead of dyeing.
   */
  fillColour: 0x6f8ec2,
  /**
   * 0.85 -> 0.30, near the reviewer's suggested 0.22. Measured, this costs the
   * hull nothing (see envIntensity) — it is spent on the asteroids and every
   * other MeshStandardMaterial in the scene, where a 0.85 hemisphere really was
   * flattening form.
   */
  fillIntensity: 0.30,
  /** HemisphereLight ground colour: the void's own faint violet scatter. */
  ambientColour: 0x2a1f38,
  /** 0.35 -> 0.18, in step with fillIntensity — same light, same rebalance. */
  ambientIntensity: 0.18,
};

export type Config = typeof CONFIG;
