// OWNER: render agent. Palette, lights, depth-of-field, post and quality levels.

/**
 * Limited warm cardstock palette (sRGB hex, ALBEDO values = what assets/textures are authored in).
 * Every entry is within dE00 <= 5 of a role in ref/TARGET.md sec. 1 (tools/checks/render-look/palette.py).
 * Old key names are kept (other modules read them); new role names were added next to them.
 */
export const palette = {
  paper: '#efe0c2', // 1 page cream: page, house walls, uncoloured card
  paperShade: '#e8d3ac', // 2 kraft cream (reverse faces, path)
  kraft: '#e8d3ac', // 2 kraft cream: path, struts, glue tabs
  cutEdge: '#fbf6ea', // 10 exposed paper core of a cut edge
  ochre: '#d9a441', // 3
  mustard: '#dca848', // 3 (light variant)
  terracotta: '#b9603f', // 4
  rust: '#b25a3b', // 4 (dark variant)
  rose: '#c98374', // 5 dusty rose
  sage: '#8e9a5b', // 6
  olive: '#879356', // 6 (dark variant)
  pine: '#4f6b4a', // 7 dark pine
  moss: '#4f6b4a', // 7
  teal: '#5e9c9a', // 8 river (the one cool paper colour)
  tealDeep: '#3f7f84', // 8 deep strip
  brown: '#5a3a28', // 9 deep brown
  ink: '#5a3a28', // 9 printed linework
  umber: '#2a1a12', // L3 table / deep shadow
  lantern: '#ffc45a', // L1 lantern + window glow
  coolFill: '#9db7d6', // L2
  list: ['#efe0c2', '#e8d3ac', '#d9a441', '#b9603f', '#c98374', '#8e9a5b', '#4f6b4a', '#5e9c9a', '#5a3a28', '#fbf6ea'],
};

export const lights = {
  /** true: azimuths are relative to the camera yaw, so the key always comes from screen-left (gameplay yaw is fixed at 0). */
  cameraRelative: true,
  // azimuth 0 = light comes from the camera side (south at yaw 0), negative = from screen-left.
  // gold pass: higher sun (shadows <= 0.4x height), warm fill, much more ambient (gold shadow / lit is 0.7-0.87)
  key: { color: '#ffd29c', intensity: 2.9, azimuthDeg: -58, elevationDeg: 60 }, // warm golden key, casts shadows
  fill: { color: '#f3cfa6', intensity: 0.95, azimuthDeg: 108, elevationDeg: 24 }, // warm fill from the right, no shadows
  hemi: { sky: '#ffe9cc', ground: '#b98858', intensity: 0.42 },
  /** Left-to-right falloff of the key (lantern-like source at screen-left) and rise of the fill, around the focus point. */
  gobo: { radius: 9, key: 0.12, fill: 0.6, tint: 0.07, closeRelief: 0.7 }, // closeRelief: share of the key falloff removed in macro framing (the radius shrinks with distance and over-lit the left)
  /** Traveller lantern: warm point light. `lift` raises the light above the lantern prop so the pool on the page is wide. */
  lantern: { color: '#ffc45a', intensity: 1.1, distance: 6.5, decay: 0.62, height: 0.5, lift: 0.55, wrap: 0.55 },
  shadow: {
    extent: 16, // legacy key (stub); the real frustum is fitted to the camera footprint each frame
    minExtent: 3.5,
    maxExtent: 20,
    fit: 1.12, // frustum half-size = visible ground radius * fit + pad
    pad: 1.5,
    near: 1,
    far: 70,
    distance: 35, // light position distance from the frustum centre
    bias: 0.0045, // world units along the light direction (layer gap is 0.004: flat layers cast no shadow)
    normalBias: 0.0015,
    radius: 4, // legacy (unused by the PCSS path)
    lightSize: 0.26, // penumbra width (world) per unit of blocker-receiver distance (gold pass: soft, was 0.2)
    maxPenumbra: 0.55, // world units (baked into the shader: also the night cap)
    minPenumbraTexels: 2.4,
    searchRadius: 0.3, // blocker search radius (world units)
    intensity: 1.0,
    leak: '#7c5634', // warm light leaking into the key shadow (bounce off cream paper)
    stockLeak: 0.05, // same for non-paper materials (scalar)
    sheetThickness: 0.07, // blockers closer than this (world, along the light) count as "the sheet itself" for back-lit translucency
  },
  /** Paper response. */
  paper: {
    wrap: 0.3, // wrap lighting (soft terminator, no plastic falloff)
    translucency: 0.3, // back-lit thin card glows warm
    translucencyTint: '#ffb070',
    toneVary: 0.065, // per-sheet tone variation (+-)
    crumple: 0.9, // normal strength of the broad low-relief creases (0 disables)
    crumpleScale: 0.27, // crease frequency relative to the fibre tile (lower = broader)
    fibreScale: 2.6, // world units covered by one fibre tile (procedural fallback)
    fibreTooth: 0.09, // albedo modulation of the tooth octaves
    fibreCloud: 0.085, // albedo modulation of the 0.15-0.3 unit mottling (gold pass: 0.05 -> 0.085)
    fibreBroad: 1.2, // weight of the broad (~1 unit) soft mottle relative to the cloud
    /** Gold pass: pale die-cut rim on every printed card (materials.js): world width, px clamps, albedo, width wobble. */
    rim: { width: 0.0075, minPx: 1.0, maxPx: 1.7, strength: 0, color: '#f1e2c0', wobble: 0.28 }, // integrator: 0.017 / 1.5 / 3.4 -> 0.009 / 1.0 / 2.2: the gold sprite sheets carry their own printed cream edge, the shader band only evens it out (one rim, not two)
    alphaToCoverage: true, // anti-aliased die cut on the MSAA target (med / high quality)
    fibreNormal: 0.32, // normal perturbation strength
    fibreFine: 0.4, // weight of the fine (x3.7) octave
    // same, when the textures agent maps (manifest keys paper / paperNormal, repeat 2.0 units) are in use
    useAssetTextures: true,
    assetFibreScale: 2.0,
    assetFibreTooth: 0.36,
    assetFibreNormal: 1.25,
    assetFibreFine: 0.45,
  },
  /**
   * Hero cut-out (look pass): stand-up paper that would hide the traveller is screen-door dithered inside a cylinder of
   * `radius` (world units) around the camera -> traveller line. keep = share of the card's pixels left in the core,
   * margin = clear distance in front of him before the cut starts, chest = height of the aim point above his feet.
   */
  cutout: { enabled: false, /* user: the dotted see-through circle around the traveller looked wrong - off */ radius: 0.36, keep: 0.0, margin: 0.05, chest: 0.3, strength: 1 },
  /**
   * Lamp-post ground pools at night (look pass; fed by life.js from the lamp nodes of risen tiles, max 6 nearest):
   * radius of the pool (world units, measured from the lamp itself), strength at full night, colour.
   */
  pools: { enabled: true, radius: 1.5, strength: 1.0, color: '#ffc878', offsets: { desert_camp: [[0.0, 0.22, -0.06]] } }, // offsets: extra pools per model, tile-local [x, y, z] (campfire)
  /** World-space fade of everything to the dark surround beyond the lit area (acts as fog-to-dark at the far page). */
  // gold pass: the far page melts into a warm haze instead of a dark surround (corner / centre luma >= 0.58)
  fade: { start: 6.5, end: 13.5, amount: 0.72, color: '#a8804f', colorRight: '#9c7a54' },
  background: '#96744a',
};

export const dof = {
  /** Tilt-shift: sharp band centred on the traveller; blur grows toward top/bottom of frame and with depth. */
  focusBand: 0.36, /* fixer (gold pass): 0.26 -> 0.4, the middle of the frame stays crisp */ // fraction of frame height that stays fully sharp (CoC = 0)
  ramp: 0.42, /* fixer (gold pass): softer falloff again with the weaker blur */ // frame-height fraction over which the blur grows from 0 to max beyond the band (gold pass: 0.42 -> 0.3)
  maxBlurPx: 12.5, /* fixer (gold pass): 19 -> 12.5 */ // blur RADIUS at 1080p frame height
  depthWeight: 0.8, // 0 = pure screen-space tilt-shift, 1 = pure depth-based CoC
  closeBandScale: 1.8, // the sharp band grows up to this factor when the camera is closer than 12 units
  nearGain: 1.6, // extra blur toward the bottom of the frame / the camera
  farGain: 1.0,
  highlightBoost: 0.35, // extra weight of bright taps in the bokeh (lantern / windows)
};

export const post = {
  exposure: 0.79, // integrator (gold pass): 0.76 -> 0.79 with the paler, less saturated grade below
  closeExposure: 0.82, // exposure multiplier for macro framing (camera within ~4 units of the focus point; blends out by 8)
  tint: [1.05, 0.96, 1.0], // white balance before the tone curve (integrator, gold pass: blue 0.93 -> 1.0, the gold-style sprites are already warm and the crowns clipped to pure orange)
  contrast: 1.1,
  saturation: 0.92, // integrator (gold pass): 1.04 -> 0.92 for the saturated gold sprite sheets (gold crown sat 0.85, game was 1.0)
  greenDesat: 0.7, // 0..1: pulls the yellow-green field toward sage in the grade (cream/ochre/terracotta/teal untouched)
  shadowTint: '#3a200c', // warm lift added in the darkest tones
  shadowLift: 0.03,
  vignette: 0.1, // lens vignette (corner darkening, before the dark surround)
  grain: 0.008, // luma amplitude (sigma-ish); 0 disables. Deterministic from state.time.
  grainSize: 1.35, // px
  chroma: 0.55, // chromatic softness at the frame edge (px of R/B shift at 1080p)
  bloom: 0.5, // user: day bloom washed out the traveller
  bloomThreshold: 1.7,
  spill: 0, // screen-space light spill from glowing panes / lanterns (night mode raises it) // linear scene luminance
  ao: 1.25, // contact-darkening strength
  aoRadius: 0.26, // world units
  aoTint: '#5a3214', // AO darkens toward warm brown, not grey
  edgeRim: 0.8, // pale paper-core band on depth silhouettes (0 disables)
  edgeRimColor: '#ffe6b8', // cream (gold: #f5cf94 after the grade), never cool white
  edgeRimPx: 0.9, // inner ring radius in px at 900 px frame height (outer ring = 1.55x). fixer r3: 1.25 -> 0.9 (a thin line)
  // fixer (round 3): the cream band read as a white sticker halo round every piece; gold shows a thin DARKER card edge.
  // edgeRimDark: true = the band multiplies the piece's own colour by edgeRimDarkColor (false = the cream band above).
  edgeRimDark: true,
  edgeRimDarkColor: '#c2aa94',
  sharpen: 0.35, // unsharp mask amount in the focus band (high quality only)
  split: 0.025, // screen-space warm-left / cool-right grade (very slight)
};

/**
 * Quality levels. dofTaps = bokeh gather taps at half res; shadowTaps = [blocker search, PCF];
 * msaa = samples of the HDR scene target; aoTaps 0 = no contact-darkening pass.
 */
export const QUALITY = {
  low: { maxDpr: 1, shadowMapSize: 1024, shadows: true, dof: 'cheap', dofTaps: 14, postScale: 0.5, grain: true, anisotropy: 2, msaa: 0, aoTaps: 0, bloom: false, shadowTaps: [6, 8], chroma: false, fill: false },
  med: { maxDpr: 1.25, shadowMapSize: 2048, shadows: true, dof: 'full', dofTaps: 22, postScale: 0.5, grain: true, anisotropy: 4, msaa: 2, aoTaps: 6, bloom: true, shadowTaps: [8, 12], chroma: true, fill: true, sharpen: true },
  high: { maxDpr: 2, shadowMapSize: 4096, shadows: true, dof: 'full', dofTaps: 36, postScale: 0.5, grain: true, anisotropy: 8, msaa: 4, aoTaps: 10, bloom: true, shadowTaps: [12, 20], chroma: true, fill: true, sharpen: true },
};
