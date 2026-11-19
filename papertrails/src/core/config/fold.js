// OWNER: fold agent. Spring tunables for src/world/fold.js.
// Target feel (ref/CHECKLIST.md F1-F12): a flap snaps up in ~0.25 s, overshoots upright by 8-15 %, the
// strut "goes taut" and the card quivers 2-3 times (4-7 Hz flutter) before it is dead still at 0.6-1.1 s.
// Fold-down is softer and ends with a tiny slap-bounce on the page. Large flaps are slower than small ones.
//
// Model per flap (see fold.js header): RISE spring -> LOCKED flutter about upright; FALL spring + pull + page bounce.
export const spring = {
  /** RISE: p'' = k (1 - p) - c p' at frequency scale 1. Light damping: the flap arrives at upright with speed. */
  stiffness: 62,
  damping: 5.0,
  /** Rise damping multiplier for the largest flaps (size >= sizeLarge; 1 at sizeSmall): big cards arrive faster -> more overshoot. */
  dampingLarge: 0.5,
  /** FALL: p'' = -k p - c p' - downPull (softer than the rise). */
  downStiffness: 10,
  downDamping: 4.5,
  downPull: 5,
  /** Fold-down anticipation: initial outward speed (1/s) of a flap that was resting upright (peaks ~2 deg past upright). */
  downAnticipation: 1.2,
  /** Total time span (s) over which flaps of one tile start, ordered by userData.delay (0..1). */
  staggerSpan: 0.34,
  /** A nested flap (V-fold strut, glue tab) starts at least this long after its parent flap (rise). */
  nestedLag: 0.02,
  /** Settled when |p - target| < eps (and velocities < eps * 10 /s) for every flap. 0.002 = 0.18 deg. */
  settleEps: 0.002,
  /** Fixed simulation step (s). update(dt) consumes dt in steps of exactly this size (accumulator + lerp). */
  maxStep: 1 / 240,
  /** Global multiplier on the secondary flutter amplitude (0 = rigid card). 0.06 is the calibrated default. */
  wobble: 0.06,
  /** Flutter multiplier for the largest flaps (1 at sizeSmall): trees / houses / the windmill quiver visibly at hero distance. */
  wobbleLarge: 2,
  /** Nested flap linkage: p'' = k (p_parent - p) + 2 z sqrt(k) (p_parent' - p'). Higher k = tighter (smaller lag). */
  nestedStiffness: 1500,
  nestedDamping: 0.8,
  nestedMaxAccel: 125, // cap (1/s^2) on the linkage pull (keeps retargets continuous, F12)

  // --- LOCKED: once upright the strut is taut and the card flutters about upright: p'' = -w^2 (p - 1) - 2 z w p' ---
  flutterHz: 4.5, // at frequency scale 1 (4-7 Hz over all flap sizes)
  flutterSizePower: 0, // flutter frequency ~ frequencyScale ^ power (0: the same quiver rate for every flap size)
  flutterDamping: 0.04, // damping ratio z, divided by sqrt(userData.wobble * wobble / 0.06) -> 2-3 visible cycles
  flutterDrag: 3.5, // air drag coefficient on the flutter (x |p'| p'), divided by the wobble multiplier
  flutterFrictionLarge: 1.8, // friction multiplier for the largest flaps (their bigger flutter still ends after 2-3 cycles)
  flutterFriction: 2.2, // dry crease friction (1/s^2) on the flutter: makes the last tiny cycles stop instead of ringing on
  /** Small twist about the flap's long axis proportional to the flutter (rad per unit p); sign/size vary per flap. */
  twist: 1.1,

  // --- size response: frequency scale = lerp(freqSmall, freqLarge, (size - sizeSmall) / (sizeLarge - sizeSmall)) * sqrt(userData.stiffness) ---
  sizeSmall: 0.12,
  sizeLarge: 0.7,
  freqSmall: 1.14,
  freqLarge: 0.88,
  /** Deterministic per-flap variation of the frequency scale (+-), so neighbours do not move in lockstep. */
  jitter: 0.03,

  // --- page stop (fold-down) ---
  restitution: 0.25, // fraction of the impact speed returned when the flap slaps the page
  minBounceSpeed: 0.5, // (1/s, x frequency scale) slower impacts just stick
  /** Safety cap on fixed steps consumed by one update call (dt is capped at 1/20 s by the loop anyway). */
  maxSubSteps: 30,

  // --- wind (biome pass): idle sway of risen flaps + windmill sails. See the wind block at the top of fold.js. ---
  wind: {
    enabled: true,
    /** Sway amplitude (deg, at wind strength 1) for the shortest / squattest and the tallest / thinnest flaps. */
    minDeg: 0.6,
    maxDeg: 2.2,
    /** Hard cap (deg) after the biome strength is applied. */
    limitDeg: 2.5,
    /** Below this amplitude (deg) a flap is left alone entirely (no matrix updates). */
    cutoffDeg: 0.08,
    /** Height (world units) and height / width ratio ranges that map to "short..tall" and "squat..thin". */
    tallLo: 0.25, tallHi: 1.25,
    thinLo: 0.7, thinHi: 1.9,
    /** Flutter rate (Hz) of small and of tall flaps (tall cards rock slower). */
    hzSmall: 0.8, hzLarge: 0.42,
    /** Twist about the card's long axis per rad of sway (so a swaying card is not a rigid board). */
    twist: 0.5,
    /** Name classes (regex on the flap name after the model prefix), tested in this order; unlisted names = x1.
     *  A flap can also carry userData.sway (multiplier) in the glb. */
    loose: 'flag|banner|bunting|reed|cattail|grass|tuft|wheat|flower|palm|poplar|kite|laundry|willow|fern',
    looseMul: 1.3,
    rigid: 'wall|roof|house|cottage|cabin|barn|church|manor|tower|mill|bridge|deck|arch|rail|well|rock|boulder|stone|dune|drift|hill|mound|cart|boat|bench|stall|crate|barrel|statue|snowman|igloo|gate|pier|dock|ruin|pillar|obelisk|pyramid|mesa|cliff|stump|log|chimney|door|step|stair|gable|front|side|back|ridge|hive|scarecrow|ziggurat|zig|gazebo|granary|greenhouse|fountain|column|pile|ice|nave|steeple|sled|pots|bale|block|picnic',
    rigidMul: 0.04,
    stiff: 'fence|hedge|cactus|lantern|lamp|post|sign|mushroom|tent|hay|stack|sheep|cow|hen|camel|deer|fox|goat|horse|dog|cat|rabbit',
    stiffMul: 0.35,
    /** Wind strength per biome (blended with biomeWeights at the tile): desert gusty, pinewood still, snow gentle. */
    strength: { heartland: 1, desert: 1.35, snow: 0.6, blossom: 0.85, pinewood: 0.32 },
    /** Gust field: two travelling sine fronts. Direction (deg from +X toward +Z), wavelength (world units), period (s). */
    directionDeg: 30,
    gustLength: 14, gustPeriod: 9,
    gust2Length: 8, gust2Period: 5.3,
    gustWarp: 1.7, // fixed sideways bend of the main front (rad)
    /** Wavelength (world units) of the flutter phase along the wind: neighbours rock one after the other. */
    flutterLength: 5,
    /** Seconds for the sway to fade in after a tile settles upright / to relax away when it starts to fold. */
    fadeIn: 1.2,
    release: 0.22,
    /** Sway only tiles within this many tiles of the traveller (every risen tile is normally inside it). */
    radius: 5.5,
    /** Windmill sails: the triangles of a mesh whose name matches `spinMatch` and that lie at local z >= spinZMin
     *  (the sail layer stands proud of the tower card) are split off at load and turn about their own centre. */
    spinMatch: '(^|__)mill$',
    spinZMin: 0.012,
    spinSpeed: 0.5, // rad/s at wind strength 1 (one turn in ~12.5 s)
    spinGust: 0.35, // speed varies by +- this fraction with the gust
  },
};
