// Gameplay layer (owner: orchestrator): exploration progress, scraps, lantern lighting and the
// atlas map page. Each feature is one module with the same shape:
//   create<Feature>(ctx) -> { update(dt), settle(), dispose(), ...own API }
// ctx = { scene, renderer, world, wfc, traveller, follow, controls, lights, post, daynight, music, audio, life, assets,
//         materials, progress, seed, quality, game }  (ctx.game = this object: features may call each other through it)
// update order each tick (after world/life update): explore tracking -> scraps -> lanterns -> atlasmap.
import { TILE_SIZE } from '../core/config.js';
import { biomeAt } from '../core/biomes.js';
import { createProgress } from './progress.js';
import { createScraps } from './scraps.js';
import { createLanterns } from './lanterns.js';
import { createAtlasMap } from './atlasmap.js';

export function createGame(deps) {
  const { seed, traveller, persist = true } = deps;
  const progress = createProgress({ seed, persist });
  const game = { progress };
  // Nothing is lit before the traveller has taken his first steps: the start tile sits next to a market
  // and one of its lamps, and a reward that plays while the book is still opening is not felt (and not earned).
  game.armed = false;
  const spawnX = traveller.position.x;
  const spawnZ = traveller.position.z;
  const ctx = { ...deps, progress, game };
  game.scraps = createScraps(ctx);
  game.lanterns = createLanterns(ctx);
  game.atlasmap = createAtlasMap(ctx);
  const parts = [game.scraps, game.lanterns, game.atlasmap];
  let lastCx = NaN;
  let lastCz = NaN;

  game.update = (dt) => {
    const p = traveller.position;
    if (!game.armed && Math.hypot(p.x - spawnX, p.z - spawnZ) > 0.6) game.armed = true;
    const cx = Math.round(p.x / TILE_SIZE);
    const cz = Math.round(p.z / TILE_SIZE);
    if (cx !== lastCx || cz !== lastCz) { lastCx = cx; lastCz = cz; progress.explore(cx, cz, biomeAt(seed, cx, cz)); }
    for (const part of parts) part.update(dt);
  };
  game.settle = () => { for (const part of parts) if (part.settle) part.settle(); };
  /** True while a full-screen game view (the atlas map) is open: walking input should be ignored. */
  game.modal = () => !!(game.atlasmap && game.atlasmap.open);
  game.dispose = () => { for (const part of parts) part.dispose(); };
  return game;
}
