// Gameplay tunables (CONFIG.game). One section per feature module in src/game; each section is owned by that
// module's agent. Read live, so values can be tuned from the console through __atlas.config.game.
export const game = {
  // ---- scraps (src/game/scraps.js) -------------------------------------------------------------------------
  scraps: {
    /** Share of cells that MAY hold a biome scrap / a night-only star. With openOnly about 40 % of them find a spot:
     *  roughly one scrap per 7 cells and one star per 30 (tools/checks/game/scraps-count.mjs). */
    density: 0.42, // shortfall fixer: 0.5 -> 0.42 (thinning is back on at 0.38, more open ground)
    // was: // integrator (shortfall pass): 0.44 -> 0.5, the rebuilt tiles with thinning off leave less open ground (397 -> about 450 pieces in 3125 cells)
    starDensity: 0.08,
    /** World size of a piece (edge of its square card) and how far it leans back toward the camera (radians). */
    size: 0.21,
    starSize: 0.22,
    tilt: 0.62,
    /** Idle motion: rocking (radians), turning (radians) and their speeds; a tiny bob. */
    rock: 0.13, rockSpeed: 1.7, turn: 0.42, turnSpeed: 0.8, bob: 0.012,
    /** Walk this close (world units) to pick a piece up. */
    pickRadius: 0.3,
    /** Room (world.clearance) a spot needs (open ground is tried first), and how far from the cell centre it may lie. */
    minClearance: 0.2,
    openClearance: 0.3,
    /** Open ground = this far outside the footprint of every standing prop of the tile (plus a share of its height). */
    propMargin: 0.1,
    /** true: a cell whose open ground is all taken or hidden behind tall props holds no piece (never one inside a prop). */
    openOnly: true,
    spread: 0.72,
    /** Pieces are live on risen tiles within `range` units, and on flat tiles within `nearRadius` of the traveller. */
    range: 6.5,
    nearRadius: 2.3,
    /** Seconds after a tile starts to rise before its piece pops up; pop / hide rates (1 / s). */
    riseDelay: 0.38, popRate: 7, hideRate: 9,
    /** Pick-up flight: seconds, hop height, height above his feet where it ends (over the hat), turns. */
    pickTime: 0.7, pickHop: 0.5, pickLift: 0.62, pickSpin: 2.5,
    /** Every `flourishEvery`-th piece of a kind: a ring of `flourishCount` pieces bursts outward. */
    flourishEvery: 10, flourishCount: 8, flourishRadius: 0.62, flourishTime: 0.95,
    /** Sheen: a faint band of light that crosses the card every `glintPeriod` seconds (emissive share of its colour). */
    glint: 0.4, glintPeriod: 3.4,
    /** Self-light by day / at night so the pieces stay readable (paper, not lamps); stars glow a little more. */
    dayLift: 0.06, nightLift: 0.3, starGlow: 0.85,
    /** Extra self-light of a piece in flight (it turns its unlit back to the camera; thin paper lets light through). */
    flyLift: 0.4,
    /** Instances in the pool (visible pieces + pick-up / flourish pieces). 10 triangles each. */
    pool: 56,
  },
  // ---- lanterns (src/game/lanterns.js): lamps the traveller lights for good ------------------------------------
  lanterns: {
    /** Walk this close (world units, on the page) to a lamp and it catches; seconds a tile must have been rising first. */
    catchRadius: 0.9, riseDelay: 0.45,
    /** Catching: seconds of the ramp, overshoot above the settled glow, size of the flicker that follows. */
    ramp: 0.6, overshoot: 0.35, flicker: 0.16,
    /** Unlit pane: paper tone, and the cold glint it shows at night (colour, linear strength). */
    dark: '#8a6f4a', glint: '#6f9cff', glintStrength: 0.42, // integrator (gold pass): '#34333d' -> dim amber paper, the unlit pane no longer reads as a black blob on the printed lantern by day
    /** Paper sparks per catch: count, seconds alive, rise speed, size (world units), colour and brightness. */
    sparks: 7, sparkLife: 1.05, sparkRise: 0.55, sparkSize: 0.045, sparkColor: '#ffc45a', sparkGain: 2.2,
  },
  // ---- atlasmap (src/game/atlasmap.js): the atlas page (Tab / E). Read once when the game is created. ------------
  atlasmap: {
    /** Seconds of the eased slide in / out; how far the follow camera pulls back (share of its distance) and tips (degrees). */
    duration: 0.7, lift: 0.75, liftPitch: 74,
    /** Zoom limits (cells across the map frame height), widest opening view, blank cells kept round the land when fitting. */
    minSpan: 5, maxSpan: 90, fitMax: 24, fitPad: 1.5,
    /** Longest side (px) of the page / map canvases; px per tile print read back from the book bake. */
    texture: 2048, thumb: 128,
    /** 'twin' = folded-flat print (houses and trees printed on the land), 'base' = bare ground print; dashed ink lanes on top. */
    print: 'twin', inkPaths: true,
    /** Key panning speed (view heights per second). */
    panSpeed: 0.9,
  },
};
