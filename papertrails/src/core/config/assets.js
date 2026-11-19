// Runtime asset paths and options. Files live under public/ (served at ./).
export const assets = {
  tilesUrl: './models/tiles.glb',
  travellerUrl: './models/traveller.glb',
  /** Per-tile numbers written by the Blender build (flaps, triangles, layers, bridge deck profile). Optional. */
  metaUrl: './models/assets_meta.json',
  /** Texture manifest (key -> { file, colorSpace, repeat, wrap }). Tolerated if absent. */
  manifestUrl: './textures/manifest.json',
  texturesBase: './textures/',
  /** Window panes / lantern glass: the one emissive material. */
  glowColor: '#ffc45a',
  glowIntensity: 3.0,
  /** The traveller stands on a small paper base tab (node 'base_tab'); false hides it. */
  travellerBaseTab: true,
  /** Card thickness of the Blender flaps (world units) and of glued-on layers. */
  cardThickness: 0.016,
  /**
   * Bridge deck (tile-local, rot 0): the path runs along local Z over an E-W river. Height above the page as a
   * piecewise-linear function of |z|: [[|z|, y], ...]. Walkable strip |x| <= halfWidth. Use for world.heightAt.
   */
  bridge: { axis: 'z', halfWidth: 0.25, halfSpan: 0.63, deckProfile: [[0.63, 0], [0.3064, 0.1578], [0, 0.2009]], railX: 0.295 },
  /** Lantern post tile (rot 0): post at (x, z), lantern glass centre at (lanternX, lanternY, z). */
  lanternPost: { x: 0.5, z: 0, lanternX: 0.34, lanternY: 0.37 },
};
