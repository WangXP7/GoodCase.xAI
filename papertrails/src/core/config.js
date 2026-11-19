// All tunables, aggregated. Import: import { CONFIG, TILE_SIZE, QUALITY } from '../core/config.js'
import * as shared from './config/shared.js';
import { wfc } from './config/wfc.js';
import { spring } from './config/fold.js';
import { world, book } from './config/world.js';
import { player, camera } from './config/player.js';
import { palette, lights, dof, post, QUALITY } from './config/render.js';
import { audio } from './config/audio.js';
import { assets } from './config/assets.js';
import { life } from './config/life.js';
import { game } from './config/game.js';
import { animals } from './config/animals.js';

export const TILE_SIZE = shared.TILE_SIZE;
export const REVEAL_RADIUS = shared.REVEAL_RADIUS;
export const FOLD_BACK_RADIUS = shared.FOLD_BACK_RADIUS;
export const DESPAWN_RADIUS = shared.DESPAWN_RADIUS;
export const PATH_WIDTH = shared.PATH_WIDTH;
export const RIVER_WIDTH = shared.RIVER_WIDTH;
export const FLAP_LAYER_GAP = shared.FLAP_LAYER_GAP;
export { QUALITY };

export const CONFIG = {
  ...shared,
  wfc,
  spring,
  world,
  book,
  player,
  camera,
  palette,
  lights,
  dof,
  post,
  audio,
  assets,
  life,
  game,
  animals,
  QUALITY,
};

/** Resolve a quality level name ('low'|'med'|'high') to its settings object (falls back to default). */
export function qualitySettings(level) {
  return QUALITY[level] || QUALITY[shared.DEFAULT_QUALITY];
}
