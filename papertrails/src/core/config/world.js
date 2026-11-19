// OWNER: world agent. Tunables for src/world/world.js + src/world/book.js.
export const world = {
  /** The reveal circle is centred FORWARD_BIAS tiles ahead of the traveller along the movement direction. */
  forwardBias: 1.35, // was 0.9; the anchor now trails the traveller by graceRadius
  /** Grace area (world units): the traveller can move this far around the streaming anchor without anything rising or folding. */
  graceRadius: 1.0,
  /** integrator (round 3): share (%) of meadow / meadow_flowers cells whose hay rick / beehive stays down (hash per cell, same in
   *  world.js and the book.js print). Was 60 (default); at 60 two or three identical beehives stood side by side near the start. */
  hayDrop: 72,
  // fixer (gold pass): small single cards (bushes, flowers, tufts, rocks, barrels, carts ...) turn about the vertical to face
  // the camera once upright (+- jitterDeg, seeded), so nothing stands edge-on; scales per kind (tree < 1 = cottages read bigger).
  // Crossed cards (trees, pines, cacti, palms) turn so both planes stand about 45 degrees off the view. thin = share of the
  // soft filler cards (bush / tuft / flowers / fern ...) that stays down per cell (thinHouse on house tiles: door clusters stay).
  // shortfall pass: thinning is fixed per model + card name (src/world/cards.js), so the page print leaves the same cards out
  // (no print with nothing rising). thin: 0 (and thinHouse: 0) switches thinning off - use that once the tile builders carry
  // fewer filler cards. collide: the walk field, scraps and smoke use the pieces as DRAWN (false = authored sizes).
  cards: { enabled: true, jitterDeg: 14, bush: 1.22, small: 1.3, prop: 1.15, tree: 0.86, reeds: 0.8, house: 1.3, houseRow: 1.34, crossDeg: 24, thin: 0, thinHouse: 0, collide: true },
  // shortfall pass (the dotted see-through circle is off): a tree / bush / single prop standing in the sight line between
  // the camera and the traveller tips leanDeg to the side (still facing the camera) and stands up again when he
  // has passed. cover = how much of the card must show above his knees before it moves, side = extra half width of the
  // sight corridor, reach = how far around him cards are tested, ease = time constant (s), pitchDeg = camera pitch assumed.
  // width = share of the card's half width that counts.
  makeRoom: { enabled: false, /* user 2026-11-17: nothing bends aside as he walks */ leanDeg: 44, pitchDeg: 42, reach: 1.6, minAhead: 0.05, side: 0.08, width: 0.75, cover: 0.3, ease: 0.25 },
  /** Max tile instances created per update (streaming budget). settle() ignores the budget. */
  spawnBudget: 4,
  /** Extra per-tile rise delay (s) per tile of distance from the traveller, so a ring ripples outward. */
  rippleDelay: 0.055,
  /** Radius (world units) of soft blockers (trees, houses) used by isWalkable. */
  blockerPadding: 0.06, // physics pass: was 0.12 (the traveller stopped 0.3 short of the card); his own radius is added by traveller.js
  /** Padding around LOW solid pieces (logs, boulders, fences, crates ...: tops between lowBlockMinHeight and blockMinHeight). */
  lowBlockerPadding: 0.04,
  lowBlockMinHeight: 0.2,
  /** Padding kept on a path strip (lamps / lane trees brush the strip; walls and doors still stop the traveller). */
  pathPadding: 0.03,
  /** Hollow shapes (cabins, prop rings) are filled solid: cells not reachable from the tile border at this padding. */
  fillEnclosed: true,
  fillPadding: 0.12,
  /** Nooks narrower than 2 x closeRadius between blocker cards (tree crosses, V pockets) are filled so nobody gets wedged; 0 = off. */
  closeRadius: 0.2,
  closePadding: 0.02,
  /** Props made of crossed cards (trees, cacti, tents) block over the convex hull of their cards, up to this footprint size. */
  hullFill: true,
  hullMaxSize: 1.1,
  /** Bridge: half width of the deck corridor whose ramp / deck geometry never counts as a blocker. */
  deckClearHalf: 0.24,
  /** true: world.debugPieces(model) lists every mesh with its blocking class (checks only). */
  debugPieces: true,

  // ---- world-owned multipliers / extras (shared radii stay frozen in shared.js) ----
  /** Tiles within REVEAL_RADIUS * nearRadiusMul of the TRAVELLER rise too (so nothing next to you stays flat). */
  nearRadiusMul: 1.07,
  /** Extra distance (tiles) beyond REVEAL_RADIUS before a risen tile may fold back (hysteresis with FOLD_BACK_RADIUS). */
  foldHysteresis: 0.35,
  /** A risen tile may hang this far (world units) into the page margin before it is folded flat. */
  pageHysteresis: 0.5,
  /** Tiles more than this many rows BEHIND the (smoothed) heading fold flat, inside the frame's readable band. */
  foldBehind: 2.6,
  /** ... and only rise again when closer than foldBehind - this (rows), so a row does not flicker. */
  foldBehindHysteresis: 0.5,
  /** Extra fold-back delay (s) per tile of sideways distance from the traveller's track (the row closes outward). */
  foldBehindStagger: 0.07,
  /** A tile this close (tiles) to the traveller may rise again at once, ignoring minFlipInterval. */
  reflipRadius: 1.75,
  /** Time constant (s) of the heading low-pass used for the forward bias. */
  dirSmooth: 0.3,
  /** A tile's target may flip at most once per this many seconds (except next to the traveller / at the page edge). */
  minFlipInterval: 2.0,
  /** Tiles are pre-spawned (hidden, flat) and their print "inks in" this many tiles before they are told to rise. */
  inkLead: 1.0,
  /** +- random extra rise delay (s) per tile so a ring does not rise in perfect lockstep. */
  rippleJitter: 0.035,
  /** A still-flat tile the traveller is walking across waits up to this long (s) before it rises (flaps would swing through him). */
  riseHoldMax: 0.8,
  /** Hard cap of tiles that may START rising in one update (the rest wait a frame). */
  maxRisePerFrame: 6,
  /** Draw the per-tile `base` meshes (false: the book page shows the same baked print => fewer triangles, no pop). */
  renderBases: false,
  /** Blockers = geometry of upright flaps between these heights (world units); shorter pieces never block. */
  blockBandLo: 0.07,
  blockBandHi: 0.3,
  blockMinHeight: 0.45,
  /** Extra half-width (world units) added to river strips / pond radius for walkability. */
  waterPadding: 0.03,
  pondRadius: 0.62,
  /** Biome tiles with an off-centre pond: model id -> [u (east), v (south), radius] in the tile's rot-0 frame. */
  ponds: { desert_oasis: [0.12, 0.16, 0.48], frozen_pond: [0.08, 0.2, 0.56] },
  /** Bridge deck: walkable half-width and height profile fallback when the model has no deck surface. */
  deckHalfWidth: 0.31,
  deckFallbackHeight: 0.0,
  deckMaxSlope: 0.36,
  /** BatchedMesh origin is re-based when the traveller is further than this from it (float precision far from 0). */
  rebaseDistance: 512,

  // ---- biome pass: per-biome colour transform of the printed page (`ground`) and of the risen paper (`prop`) ----
  // Applied to the ALBEDO (linear RGB) before lighting, in this order:
  //   hue    degrees of hue rotation (+ turns orange -> yellow -> green, - turns orange -> red -> pink)
  //   sat    saturation (1 = unchanged, 0 = grey)
  //   tint + amount + gain + lift   colourise: mix(colour, tint * (luma * gain + lift), amount)
  //   mul    final brightness
  //   keepWater  0..1: how much teal / blue (river, pond) is left untouched
  // path (look pass): { color, edge, amount, edgeAmount } = the tone the printed road takes in this biome (the ground tint
  //   alone would whiten / yellow it into the page) and its thin printed edge line. Missing = the tinted print.
  // Very dark pieces (wood posts, trunks, ink) are kept out of every tint (see BIOME_TINT_GLSL in world/book.js).
  // Missing keys = neutral. heartland MUST stay empty (identity: the start area keeps its look). Glow panes are never tinted.
  // The page blends the transforms of neighbouring cells over one tile; a risen tile uses the biome of its own cell.
  biomeTintEnabled: true,
  /** Biomes whose prop tint skips reeds, rocks, haystacks, fences, roofs, logs (they keep their heartland colours). */
  biomeTintKeep: { blossom: true },
  biomeTint: {
    heartland: { ground: {}, prop: {} },
    desert: {
      ground: { tint: '#e2b878', amount: 0.86, gain: 0.5, lift: 0.86, keepWater: 0.75 },
      prop: { hue: 8, sat: 0.66, tint: '#d8b877', amount: 0.36, gain: 1.1, lift: 0.3, keepWater: 0.6 },
      path: { color: '#eed199', edge: '#c99a5e', amount: 0.9, edgeAmount: 0.3 }, // fixer pass: warm packed sand ~10 % lighter than the ground (was near-white tape)
    },
    snow: {
      ground: { sat: 0.7, tint: '#d6e3f6', amount: 0.9, gain: 0.17, lift: 0.88, keepWater: 0.45 }, // look pass: flatter (gain 0.3 -> 0.17): the inked grass ticks of shared tiles read as dotted streaks on the snow
      // look pass: amount 0.58 -> 0.34, lift 0.92 -> 0.7: shared props (bushes, reeds, hills card) were washed into pale ghosts
      prop: { hue: 10, sat: 0.6, tint: '#d3e2f5', amount: 0.34, gain: 0.7, lift: 0.7, keepWater: 0.4 },
      path: { color: '#b0c0da', edge: '#a3b3cf', amount: 1.9 /* 0.9 + mask gain, see book.js */, edgeAmount: 0.3 }, // fixer pass: trodden snow ~9 % darker than the snow (was a blue-grey asphalt slab)
    },
    blossom: {
      ground: { hue: 14, sat: 1.15, tint: '#9cc468', amount: 0.3, gain: 1.6, lift: 0.55, keepWater: 0.9 },
      // look pass: hue -13 -> -5, amount 0.16 -> 0.07: generic bushes / reeds were turning red-pink
      prop: { hue: -5, sat: 1.04, tint: '#f7bfcd', amount: 0.07, gain: 1.0, lift: 0.35, keepWater: 0.9 },
      path: { color: '#f1e3c2', edge: '#b3975f', amount: 0.6, edgeAmount: 0.3 }, // cream garden path (the ground tint turned it lime)
    },
    pinewood: {
      ground: { hue: 10, sat: 0.9, tint: '#55766a', amount: 0.62, gain: 1.6, lift: 0.5, keepWater: 0.7 },
      prop: { hue: 34, sat: 0.85, tint: '#4d7468', amount: 0.36, gain: 1.5, lift: 0.4, mul: 0.92, keepWater: 0.7 },
      path: { color: '#c2b187', edge: '#5d5b3e', amount: 0.75, edgeAmount: 0.3 }, // pine-needle track: the one warm line in the teal wood
    },
  },
};

export const book = {
  /** Page thickness look: number of visible stacked page signatures and their outward step (world units). */
  pageStackLayers: 8,
  pageStackStep: 0.06,
  /** Half extent (world units) of the page surface that follows the traveller (X = gutterPeriod tiles / 2). */
  pageHalfExtent: 26,
  /** Distance (tiles) between gutters/spines of the endless book along X (= width of the book window). */
  gutterPeriod: 7,

  // ---- book window (see docs/LOG.md world-book: "endless book" assumption) ----
  /** Half depth (Z, world units) of the page. */
  halfDepth: 26,
  /** Cream unprinted margin (world units) along the page edges; tiles never rise on it. */
  margin: 0.7,
  /** Dead zone (world units): the book only slides once the traveller is this far from its centre. */
  slackX: 0.2,
  slackZ: 0.5,
  /** World X of gutter number 0 (must be on a tile seam: odd number). */
  gutterX0: -1,
  /** Gutter valley: half width, depth on the printed area, extra depth toward head/tail edge (world units). */
  gutterHalfWidth: 0.7,
  gutterDepth: 0.045,
  gutterEdgeDepth: 0.16,
  /** Shading strength of the valley (normal exaggeration) and of the broad page curvature toward the spine. */
  gutterShade: 3.2, // shortfall fixer: 5 -> 3.2 (the gutter read as a hard dark line through the frame)
  /** shortfall fixer: strength of the dark fold line + valley shadow of the gutter (1 = as before the shortfall pass). */
  gutterDark: 0.32, // round 3: 0.5 -> 0.32
  pageCurve: 0.2,
  pageCurveWidth: 2.0,
  /** Thickness (world units) of the page block and the cover board; cover overhang beyond the block foot. */
  blockThickness: 0.25,
  coverThickness: 0.07,
  coverOverhang: 0.5,
  coverColor: '#6e3a26',
  /** Build page / block / cover from materials.paper() (same lighting as the tiles); false = private materials. */
  usePaperMaterial: true,
  /** Baked print atlas: pixels per tile for quality low / med / high. */
  bakeSize: { low: 256, med: 384, high: 512 }, // 43 models x 2 layers: 512 = ~115 MB with mips, 384 = ~65 MB
  /** How un-risen terrain looks: 0 = blank page, 1 = full ink. */
  fadedInk: 0.8,
  /** round 3 (page): full colour within fadeNear world units of the traveller, pencil-sketch look beyond fadeFar (soft, noise-warped). */
  fadeNear: 8,
  fadeFar: 13.5,
  /** ... and the flat print of pieces that have not risen: full colour inside printNear, a pencil plan (1 - printFade of the colour) beyond printFar. */
  printNear: 6.8,
  printFar: 9.6,
  printFade: 0.75,
  /** Seconds for a cell to ink in / fade out. */
  inkInTime: 0.45,
  inkOutTime: 1.3,
  /** Opacity of the printed twin of the folded-flat pieces that stays under a risen tile (0 = plain ground print). */
  twinGhost: 0.0,
  /** Tile seam crease: half width (world units) and darkness / emboss strength. */
  creaseWidth: 0.012,
  creaseDark: 0.04,
  creaseEmboss: 0.5,
  /** Fibre: world units per repeat of the page fibre maps, normal + albedo strength. */
  fibreScale: 2.5,
  fibreNormal: 0.55,
  fibreAlbedo: 0.8,
  /** Table: world units per repeat of the wood map; y is derived from the thicknesses. */
  tableScale: 6,
  tableGain: 1.0,
  // ---- gold pass: living water + ground print (src/render/water.js; every key is optional, defaults live there) ----
  /** Printed, animated water of rivers / ponds / oasis / ice. shoreBlur = bake-time blur of the shore mask (tile uv). */
  water: {
    enabled: true,
    shoreBlur: 0.1,
    ripple: 0.95, // opacity of the cream ripple dashes and rings
    reflection: 0.9, // darkness of the mirrored far-bank band
    caustic: 0.07, // slow light net
    floaters: 1, // lily pads / leaves / petals / ice plates (0 = none)
    flow: 0.17, // world units per second along rivers
    streak: 0.85, // fixer (gold pass): 0.55 -> 0.85. night: warm streaks on the water under lit lamps
    // palette: { heartland: [shallow, deep, rim, river floater], desert: [...], ... } overrides per biome
    // shortfall pass: real mirrored reflections (planar pass, render/water.js renderReflection; all keys + defaults in
    // WATER_DEFAULTS.mirror: scale, maxWidth, gain, tint, distort, ice, band, clip, night, minQuality ...). Listed keys override.
    mirror: { enabled: true, strength: 0.7 }, // shortfall fixer: 0.95 -> 0.7, tint 0.6 (WATER_DEFAULTS): a teal mirror, not a brown smear
  },
  /** Ground print: soft read of the baked print, hand-cut wobble, paper mottling, printed tufts, fainter seams. */
  groundPrint: {
    enabled: true,
    soften: 2.3, // mip level (512 bake) of the soft read: feathered blob / path edges
    wobble: 0.011, // tile uv
    mottle: 0.15, // round 3: 0.085 -> 0.15 (the printed tone patches are gone, the mottle is the only field). large-scale value swing
    clumps: 0.7, // printed grass tufts + flower dots on open grass
    seam: 0.06, // round 3: 0.1 -> 0.06. shortfall fixer: 0.32 -> 0.1. fixer (gold pass): 0.45 -> 0.32. tile seam strength relative to creaseDark / creaseEmboss
    path: 1, // road treatment (0 = raw print)
    // round 3 (page): defaults in render/water.js GROUND_DEFAULTS
    wobbleSlow: 0.016, // slow wander of printed edges (tile uv): gentle width variation of the roads
    flatten: 0.94, // printed tone patches + the bake's per-tile value gradient -> the one ground colour (0 = keep the print)
    groundColor: '#a8a374', // round 3 resumed: #b4aa77 -> #a8a374 (a touch darker, greener: path/grass luma 1.15 -> ~1.22). the one ground tone (albedo, sRGB hex); biome tints act on it
    pathColor: '#ffd5b4', // round 3 resumed: #eed3a8 -> #ffd5b4 (peachier, like the gold road). heartland road tone: warm cream-beige (the other biomes: biomeTint[b].path)
    contact: 0.13, // soft darker contact patch where the bake is darkest (under the props of a tile)
    pathWorn: 0.17, // darker worn centre line
  },
};
