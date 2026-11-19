// OWNER: audio agent. Tunables for src/audio/paper.js (procedural paper sounds, see the header there).
// Times in seconds, frequencies in Hz (at pitch factor 1), gains linear unless a key ends in Db.
export const audio = {
  /** Final output gain after the soft limiter (limiter ceiling = limiter.ceiling * masterGain). */
  masterGain: 0.95,
  /** Sounding voices at once. On overflow the quietest voice is faded out (stealFade) and replaced. */
  maxVoices: 10,
  /** Extra voice slots that only carry the short fade-out of stolen voices. */
  spareVoices: 4,
  stealFade: 0.008,
  /** Volume falloff: gain *= 1 / (1 + (distance / falloff)^2), i.e. half at `falloff` world units ... */
  falloff: 9,
  /** Exponent of that law: 4 keeps the half-gain point at `falloff` but leaves the nearest tiles in front (5 units: -0.4 dB, 7: -2.7 dB, 11: -10 dB). */
  falloffPow: 4,
  /** ... then faded to nothing between earshotFade and earshot (no sound, no nodes beyond earshot). */
  earshotFade: 13,
  earshot: 19,
  /** Voices quieter than this (linear, after size + distance) are not played at all. */
  minGain: 0.004,
  sampleRate: 48000,
  seed: 0x5eed,
  /** Fraction of the full equal-power pan used at |e.pan| = 1 (0.5 => ~7.7 dB left/right difference). */
  panWidth: 0.5,
  /** New-voice rate limit (token bucket): a wave of flaps becomes a ripple, and node creation stays bounded. */
  rate: { perSecond: 30, burst: 9, reserve: 3 },
  /** Flap onsets get a seeded delay of 0..onsetJitter (one 60 Hz frame: events arrive on the frame grid) ... */
  onsetJitter: 0.016,
  /** ... plus up to this much more when the page is full of voices (breaks machine-gun regularity). */
  rippleJitter: 0.012,
  /** Each already-sounding voice turns a new flap down by this fraction of full density (0..1 scale). */
  densityDuck: 0.22,
  /** Tiny detail flaps (size < detailBelow + detailRange) are ducked harder and cost more rate budget when the page is busy. */
  detailBelow: 0.12,
  detailRange: 0.3,
  detailDuck: 1.6,
  detailCost: 1.2,
  /** Fold events of the same tile + direction within groupWindow seconds are ONE flap gesture (see `tile`). */
  groupWindow: 0.5,
  /** One flap per tile, with air between the flaps (the world fires 6-8 fold events per tile, ~16 tiles per second). */
  tile: {
    voicesPerTile: 1, // the tile's flap + at most one accent ...
    accentBigger: 0.15, // ... from a layer at least this much larger (size units) than the one that spoke
    accentGain: 0.9,
    accentScore: 0.8,
    spacing: 0.55, // user: constant popping was tiring -> a soft flap now and then (was 0.14) // minimum time between flap onsets (+- spacingJitter): at most ~7 flaps per second
    spacingJitter: 0.2,
    queue: 1, // flaps that arrive inside the spacing wait here; the loudest (nearest / largest) goes first
    maxDefer: 0.08, // ... and are dropped when they would start later than this after their fold event
    deferDb: 3.5, // a flap that waited maxDefer is this much quieter (the tail of a ripple fades)
    downScore: 0.7, // rising tiles win the next slot against tiles folding away
    lookahead: 0.03, // live: schedule this far ahead of the audio clock
  },
  /** Each already-sounding voice turns a new sound down: level /= sqrt(1 + overlapDuck * voices). */
  overlapDuck: 0.5,
  densityTickDuck: 0.55,

  flap: {
    gain: 0.13, // user (three times): flaps too loud / too bright -> much quieter, lower, duller
    downGainDb: -9, // fold-down is quieter ...
    downBright: 0.9, // ... and duller than fold-up of the same flap
    sizeGainMin: 0.85, // level of the smallest flap relative to the largest
    // duration to -40 dB: durMin (size 0) .. durMax (size 1), curve > 1 keeps small flaps short
    durMin: 0.096,
    durMax: 0.23,
    durCurve: 1.4,
    durPitch: 0.3, // duration *= pitch^-durPitch (lower = a little longer)
    durJitter: 0.035,
    // pitch factor = 2^(semitones/12), semitones = sizeSt * (1 - 2 size) + random(+-randSt), clamped to [pitchMin, pitchMax]
    pitchMin: 0.5,
    pitchMax: 0.82,
    pitchRandSt: 4.3,
    pitchSizeSt: 0.4,
    pitchMinStepSt: 0.7, // consecutive flaps are pushed at least this far apart
    // spectral voicing: every frequency below is multiplied by pitch * bright(size)
    brightSmall: 0.95,
    brightLarge: 0.72,
    brightFrom: 0.25, // size where the brightness starts to drop ...
    brightTo: 0.75, // ... and where it has reached brightLarge
    bedHz: 2500, // broad "brush / air" noise band
    bedQ: 0.4,
    bedGain: 0.45,
    bedGainDown: 0.4,
    resHz: [1350, 2750, 4900], // short card-body resonances excited by the crackle grains
    resQ: [1.5, 1.8, 2.0],
    resGain: [0.3, 0.15, 0.05],
    grainDirect: 0.7,
    tiltSmall: 4200, // one-pole (-6 dB/oct) tilt corner for the smallest flaps (near white: bright, crisp) ...
    tiltLarge: 1700, // ... and for the largest (pink-brown: fuller, lower); follows the pitch
    tiltSmallDown: 3400, // fold-down: duller
    tiltLargeDown: 1700,
    tiltTrack: 0.5, // the tilt corner follows pitch^tiltTrack (the body modes and grain times follow the pitch fully)
    airTilt: 0.45, // distance softening: tilt corner *= 1 - airTilt * (distance / earshot) ...
    airLp: 0.35, // ... and the band limit likewise
    lpHz: 2600, // fixed 4-pole band limit (95 % roll-off of small flaps at 8-9 kHz, 3-5 % of their energy above 9 kHz)
    stopShare: 0.3, // share of the crackle grains that happen around the stop instead of the release
    patGain: 2.4, // fold-down landing pat (goes through the soft bed band instead of the crisp body modes)
    resJitter: 0.06, // per-card spread of the body-mode frequencies ...
    resGainJitter: 0.18, // ... and of their strengths
    // two-stage decay: a fast part (the release burst) over a slower part (the swing); then the final fade takes over
    decayFast: 8, // nepers at `dur` of the fast part ...
    decayFastMix: 0.42, // ... and its share at t = 0
    decayNepers: 2.2, // nepers at `dur` of the slow part
    downHp: 0.78, // fold-down keeps a little more low-mid
    bedDecayDown: 1.1,
    lumpMin: 0.2, // depth of the random lumps in the bed envelope (1 = none)
    lumpEvery: 0.022, // a new lump about every 22 ms
    gateEvery: 0.00035, // the bed is gated by a heavy-tailed random level, renewed this often
    bedSmooth: 0.35, // un-gated share of the bed (1 = plain hiss)
    refCrest: 8, // peak / rms at which a flap is normalised to peak 1
    downTick: 1.15,
    downGrains: 0.5, // fold-down has fewer crackles
    grainThin: 3.2, // how fast the crackle density thins out
    grainAmp: 0.1,
    microAmp: 0.025,
    tailFrom: 0.82, // final fade starts here (fraction of dur)
    hpHz: 520,
    grainsMin: 16, // macro crackle grains (size 0 .. size 1)
    grainsMax: 38,
    microMin: 50, // micro crackle grains
    microMax: 130,
    tick: 0.04, // onset snap level ...
    onsetGrains: 5, // ... spread over this many grains
    stopTick: 0.15, // tick as the card meets its stop (relative to the onset snap)
    thump: 0.5, // low body thump of large flaps
    thumpHz: 430,
    thumpQ: 1.6,
    thumpGain: 1.0,
    thumpDown: 0.4,
    // air "whoosh": band-passed noise swell (card moving through air), peaks airRise seconds after the onset
    airHz: 1100,
    airQ: 0.75,
    airLpHz: 2400,
    airGain: 0.55,
    airGainDown: 0.3,
    airSmall: 0.7, // level for the smallest flaps relative to the largest
    airRise: 0.016,
    airRiseDown: 0.03,
    // low body thump (120-250 Hz damped noise) of large flaps
    lowHz: 190,
    lowQ: 1.1,
    lowGain: 2.2,
    lowFrom: 0.4,
    lowTau: 0.014,
    lowDown: 0.1,
    // fold-down: the bed swells from downSwellFrom to full with this time constant, the pat lands at downStop..+0.16 of dur
    downSwell: 0.022,
    downSwellFrom: 0.3,
    downStop: 0.5,
    peakKnee: 0.42, // samples after the onset are softly held below ~0.59 x the onset peak (the room reflections add to them)
    loudNorm: 0.85, // 0 = normalise flaps to peak, 1 = to loudness
    normLo: 0.8,
    normHi: 1.25,
    attackUp: 0.0022,
    attackDown: 0.0048,
  },

  step: {
    gain: 0.02, // user: footsteps much quieter
    refCrest: 7,
    dur: 0.07, // to -40 dB (longer = softer)
    pitchRandSt: 1.6,
    footSt: 0.5,
    footPan: 0.07,
    surfaces: { // user: footsteps less sharp -> lower bands, far less grain click, low-pass around 1.5-2 kHz
      grass: { bedHz: 1100, bedQ: 0.6, bedGain: 0.8, resHz: [700, 1300], resQ: [1.0, 1.1], grain: 0.15, grains: 3, lpHz: 1700, knock: 0, gain: 0.9 },
      path: { bedHz: 1400, bedQ: 0.6, bedGain: 0.6, resHz: [900, 1700], resQ: [1.1, 1.2], grain: 0.22, grains: 2, lpHz: 2100, knock: 0, gain: 1.0 },
      bridge: { bedHz: 800, bedQ: 0.7, bedGain: 0.55, resHz: [420, 950], resQ: [1.8, 1.5], grain: 0.2, grains: 2, lpHz: 1600, knock: 0.5, gain: 1.0 },
      water: { bedHz: 900, bedQ: 0.6, bedGain: 1.0, resHz: [650, 1300], resQ: [1.0, 1.1], grain: 0.1, grains: 3, lpHz: 1700, knock: 0, gain: 0.6 },
    },
  },

  /** Early reflections ("the book lies on a table in a small warm room"): one short stereo impulse response. */
  room: {
    length: 0.05,
    taps: [
      // [delay s, gain, pan -1..1]
      [0.0013, 0.26, 0],
      [0.0049, 0.13, -0.6],
      [0.0071, 0.12, 0.6],
      [0.0117, 0.08, -0.8],
      [0.0143, 0.075, 0.8],
      [0.0196, 0.05, -0.4],
      [0.0233, 0.045, 0.5],
    ],
    tail: 0.03, // diffuse tail level
    tailDecay: 0.009,
    tailLpHz: 3200,
  },

  /**
   * Optional bus compressor (DynamicsCompressorNode). OFF: measured in Chrome it flattens the 2-4 ms onset snap of single
   * flaps even at a -8 dB threshold (attack <= 8 ms held for only 59 % of flaps, peaks -10 dB). Density ducking in the
   * voice allocator + the soft-knee limiter below do the same job without touching single flaps.
   */
  comp: { enabled: false, threshold: -8, knee: 6, ratio: 3, attack: 0.006, release: 0.12, makeupComp: 0.78 },
  /** Soft-knee waveshaper limiter: linear below `knee`, tanh above, output never exceeds `ceiling`. */
  limiter: { knee: 0.6, range: 2, ceiling: 0.9 },

  /** Very quiet warm room tone so the silence between flaps is not digital black. 0 gain disables it. */
  /** Generative soft felt-piano background (src/audio/music.js). gain 0 disables. */
  music: { gain: 1.25, bpm: 63, reverb: 0.4, fadeIn: 4 },

  ambience: { gain: 0.0008, length: 3.0, lpHz: 240, fadeIn: 1.5 },
};
