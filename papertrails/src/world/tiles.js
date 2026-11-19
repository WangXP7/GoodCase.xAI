// Tile catalogue (owner: wfc agent). Built on the frozen model table in core/models.js.
// Contract: docs/ARCHITECTURE.md (world/tiles.js). One tile per model id; weights and the rotation limits
// of all-grass tiles are tunables in core/config/wfc.js.
import { MODELS, FALLBACK_MODEL, DIRS, rotateSockets } from '../core/models.js';
import { wfc as CFG } from '../core/config/wfc.js';

const ALL = [0, 1, 2, 3];
const isAllGrass = (s) => s.n === 'grass' && s.e === 'grass' && s.s === 'grass' && s.w === 'grass';

/** @type {Array<{id:string, model:string, sockets:{n:string,e:string,s:string,w:string}, weight:number, rotations:number[], tags:string[], biomes:Object<string,number>|null}>} */
export const TILES = Object.entries(MODELS).map(([id, m]) =>
  Object.freeze({
    id,
    model: id,
    sockets: Object.freeze({ ...m.sockets }),
    weight: CFG.weights[id] ?? 1,
    // socketed tiles: every rotation is legal (the sockets decide which one is used);
    // all-grass tiles: rotation is free for the solver, so it is limited per tile for readability.
    rotations: Object.freeze((isAllGrass(m.sockets) ? CFG.rotations[id] || ALL : ALL).slice()),
    tags: Object.freeze(m.tags.slice()),
    // biome pass: optional per-biome weight multipliers (schema: top of core/models.js); null = everywhere, x1
    biomes: m.biomes ? Object.freeze({ ...m.biomes }) : null,
  }),
);

const BY_ID = new Map(TILES.map((t) => [t.id, t]));

export const FALLBACK_TILE = FALLBACK_MODEL;

export function getTile(id) {
  return BY_ID.get(id) || BY_ID.get(FALLBACK_TILE);
}

// rotated socket objects are shared + frozen (cells point at them; no per-cell allocation)
const SOCKET_CACHE = new Map();
/** Sockets of tile `id` after `rot` clockwise quarter turns (shared frozen object). */
export function socketsOf(id, rot = 0) {
  const t = getTile(id);
  const r = ((rot % 4) + 4) % 4;
  const key = t.id + ':' + r;
  let s = SOCKET_CACHE.get(key);
  if (!s) { s = Object.freeze(rotateSockets(t.sockets, r)); SOCKET_CACHE.set(key, s); }
  return s;
}

export const SOCKET_CODE = Object.freeze({ grass: 0, path: 1, river: 2 });

/**
 * Solver options: one per (tile, distinct rotated socket signature). Rotations that give the same
 * signature (path_straight rot 0/2, every rotation of an all-grass tile) are ONE option; the visible
 * rotation is picked afterwards by a per-cell hash from `rots`.
 * sig = socket codes [n, e, s, w].
 */
export const OPTIONS = (() => {
  const out = [];
  TILES.forEach((tile, t) => {
    const groups = new Map();
    for (const rot of tile.rotations) {
      const s = socketsOf(tile.id, rot);
      const sig = DIRS.map((d) => SOCKET_CODE[s[d]]);
      const key = sig.join('');
      if (!groups.has(key)) groups.set(key, { sig, rots: [] });
      groups.get(key).rots.push(rot);
    }
    for (const g of groups.values()) {
      out.push(Object.freeze({ index: out.length, t, tileId: tile.id, tile, sig: Object.freeze(g.sig), rots: Object.freeze(g.rots) }));
    }
  });
  return Object.freeze(out);
})();

/** Tiles the solver needs in every biome (sockets must always connect across biome borders): never banned. */
export const UNIVERSAL_TILES = Object.freeze(['meadow', 'path_straight', 'path_corner', 'path_t', 'path_cross', 'path_end', 'river_straight', 'river_corner', 'river_source', 'bridge']);

/** WFC weight multiplier of a tile in a biome (schema: top of core/models.js). 0 = not allowed there. */
export function biomeMultiplier(tileOrId, biomeId) {
  const t = typeof tileOrId === 'string' ? getTile(tileOrId) : tileOrId;
  if (!t || !t.biomes) return 1;
  const v = +t.biomes[biomeId];
  if (v > 0) return v;
  return UNIVERSAL_TILES.includes(t.id) ? 1 : 0;
}
