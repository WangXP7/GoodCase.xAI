// Shared world dimensions and default game settings.

/** World units per tile edge. A tile is TILE_SIZE x TILE_SIZE on the XZ plane, centred on its cell. */
export const TILE_SIZE = 2;

/** Tiles (cell distance from the traveller, in tiles) inside which a tile is told to rise. */
export const REVEAL_RADIUS = 3.0;
/** Tiles beyond this distance (behind the traveller) fold back flat. Between the two radii: keep state (hysteresis). */
export const FOLD_BACK_RADIUS = 4.25;
/** Tiles beyond this distance may be despawned/pooled once folded flat and settled. */
export const DESPAWN_RADIUS = 6.0;

/** Width (world units) of a path / river where it crosses a tile edge, centred on the edge midpoint. */
export const PATH_WIDTH = 0.5;
export const RIVER_WIDTH = 0.7;

/** Y gap between stacked folded-flat paper layers: a flap of layer L has its hinge at y = FLAP_LAYER_GAP * (L + 1). */
export const FLAP_LAYER_GAP = 0.004;

/** Traveller height in world units (feet at y = 0). */
export const TRAVELLER_HEIGHT = 0.6;

export const DEFAULT_SEED = 7;
export const DEFAULT_QUALITY = 'high';
