// FROZEN contract (owner: scaffold): the canonical list of tile MODELS and what each edge of the
// model connects to in its canonical orientation (rot = 0). The Blender tiles (assets agent), the
// tile catalogue + WFC (wfc agent), walkability (world agent) and the printed flat page (book) all
// rely on this table, so geometry and sockets can never disagree.
//
// Axes: +X = east, -Z = north, +Y = up. Camera looks toward -Z by default, so north is "up" on screen.
// Sockets: 'grass' | 'path' | 'river'. A 'path'/'river' socket crosses the MIDPOINT of that edge
// (width PATH_WIDTH / RIVER_WIDTH) and runs to the tile centre.
// rot = number of clockwise quarter turns seen from above (+Y looking down): what was at N moves to E.
// Runtime: tileGroup.rotation.y = rotToY(rot) = -rot * PI / 2.

export const SOCKETS = ['grass', 'path', 'river'];
export const DIRS = ['n', 'e', 's', 'w'];
/** Cell offset for each direction: n = -Z, e = +X, s = +Z, w = -X. */
export const DIR_OFFSET = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export const OPPOSITE = { n: 's', e: 'w', s: 'n', w: 'e' };

// ---- BIOME SCHEMA (biome pass; biome ids are the ones in core/biomes.js) -----------------------------------
// MODELS[id].biomes = OPTIONAL table of WFC weight multipliers per biome:
//     biomes: { heartland: 1, desert: 0.3, snow: 0.8, blossom: 1.5, pinewood: 1 }
//   * no `biomes` key            -> the model is allowed in EVERY biome with multiplier 1
//   * key present, entry missing -> the model is NOT allowed in that biome (same as 0)
//   * the WFC uses  CONFIG.wfc.weights[id] (default 1)  x  biomes[cell biome]  x  its own field factors
// A biome-specific tile is one line, e.g.  cactus: { sockets: S(g, g, g, g), tags: ['blocker'], biomes: { desert: 2 } }.
// All-grass models are picked freely by the solver. Socketed NEW models are only used where the sockets fit, so
// keep the generic connectors (meadow, path_*, river_*, bridge) allowed everywhere: wfc.js refuses to ban them.
// To keep the heartland start area as it is, give existing models heartland: 1 and new models no heartland entry.

const g = 'grass';
const p = 'path';
const r = 'river';
const S = (n, e, s, w) => ({ n, e, s, w });
/** Shorthand for a full biome table (multipliers in the order of BIOMES in core/biomes.js). */
const B = (heartland, desert, snow, blossom, pinewood) => ({ heartland, desert, snow, blossom, pinewood });

/**
 * model id -> { sockets (rot 0), tags, biomes? }   (biomes: see BIOME SCHEMA above; paths / rivers / bridge have none = everywhere)
 * tags (standard vocabulary, used by shots/world/audio): 'open' (walk anywhere), 'path', 'water',
 * 'bridge', 'house', 'village', 'forest', 'hills', 'landmark', 'lantern', 'blocker' (has soft obstacles).
 */
export const MODELS = {
  // --- all-grass fillers -------------------------------------------------------------------
  meadow: { sockets: S(g, g, g, g), tags: ['open'], biomes: B(1, 0.75, 0.7, 0.8, 0.45) }, // grass tufts only; the guaranteed FALLBACK
  meadow_flowers: { sockets: S(g, g, g, g), tags: ['open'], biomes: B(1, 0, 0.1, 2.4, 0.5) },
  hills: { sockets: S(g, g, g, g), tags: ['hills', 'blocker'], biomes: B(1, 0, 0.12, 0.6, 0.3) }, // layered rolling-hill silhouettes
  forest: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: B(1, 0, 0, 0.6, 0.7) }, // 4-6 layered trees
  grove: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: B(1, 0, 0, 1.7, 0.3) }, // 1-2 trees, mostly open
  rocks: { sockets: S(g, g, g, g), tags: ['blocker'], biomes: B(1, 1.5, 1.1, 0.4, 0.9) },
  pond: { sockets: S(g, g, g, g), tags: ['water', 'blocker'], biomes: B(1, 0, 0, 1.4, 1.3) }, // round pond in the middle + reeds
  windmill: { sockets: S(g, g, g, g), tags: ['landmark', 'blocker'], biomes: B(1, 0, 0, 1.0, 0.1) },
  // --- paths (rot 0 layout in comments) -------------------------------------------------------
  path_straight: { sockets: S(p, g, p, g), tags: ['path'] }, // N-S
  path_corner: { sockets: S(p, p, g, g), tags: ['path'] }, // N-E
  path_t: { sockets: S(g, p, p, p), tags: ['path'] }, // E-S-W (no north arm)
  path_cross: { sockets: S(p, p, p, p), tags: ['path'] },
  path_end: { sockets: S(g, g, p, g), tags: ['path'] }, // path comes from S, ends at centre (signpost)
  lantern_post: { sockets: S(p, g, p, g), tags: ['path', 'lantern'], biomes: B(1, 1.6, 2.6, 1.8, 2.2) }, // N-S path + lantern post on the east side
  house: { sockets: S(g, g, p, g), tags: ['path', 'house', 'blocker'], biomes: B(1, 0, 0, 1.1, 0.45) }, // house in the north half, door + path to S
  village: { sockets: S(p, g, p, g), tags: ['path', 'house', 'village', 'blocker'], biomes: B(1, 0, 0, 1.0, 0.08) }, // N-S street, houses both sides
  // round 3 (tiles): the hamlet set. village / village_b / village_green share the N-S street sockets and their lanes swing to
  // opposite sides, so two or three of them in a row read as one winding street. Every cottage shows its door gable to the lane.
  village_b: { sockets: S(p, g, p, g), tags: ['path', 'house', 'village', 'blocker'], biomes: { heartland: 1, blossom: 1.0 } }, // one large cottage east of the lane + flower garden
  village_green: { sockets: S(p, g, p, g), tags: ['path', 'village'], biomes: { heartland: 1, blossom: 1.0 } }, // no house: well, bench, lamp post, two trees
  // (house_garden / house_paddock exist as builders in tiles_more.py but are not registered: wfc.js allows 96 solver options, 95 are used)
  // --- rivers ---------------------------------------------------------------------------------
  river_reeds: { sockets: S(r, g, r, g), tags: ['water'], biomes: { heartland: 1, blossom: 1, pinewood: 0.8 } }, // N-S river with a reed bank, a jetty and a boat (river_straight stays the universal piece)
  river_straight: { sockets: S(r, g, r, g), tags: ['water'] }, // N-S
  river_corner: { sockets: S(r, r, g, g), tags: ['water'] }, // N-E
  river_source: { sockets: S(g, g, r, g), tags: ['water', 'blocker'] }, // spring/rocks at centre, flows out S
  bridge: { sockets: S(p, r, p, r), tags: ['path', 'water', 'bridge'] }, // path N-S on a bridge over an E-W river
  // --- biome pass: biome tiles (tools/blender/tiles_desert_snow.py, tiles_more.py). No heartland entry = never in the start biome.
  // The 'village' tag stays with the cottage street only (the `village` capture pose finds its nearest cell).
  desert_dunes: { sockets: S(g, g, g, g), tags: ['hills', 'blocker'], biomes: { desert: 0.8 } },
  desert_dunes_b: { sockets: S(g, g, g, g), tags: ['hills', 'blocker'], biomes: { desert: 0.7 } }, // long low slanted pair
  desert_dunes_c: { sockets: S(g, g, g, g), tags: ['hills', 'blocker'], biomes: { desert: 0.7 } }, // tall pointed crest
  desert_cacti: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: { desert: 1.8 } },
  desert_camp: { sockets: S(g, g, p, g), tags: ['path', 'house', 'blocker'], biomes: { desert: 2.2 } },
  desert_oasis: { sockets: S(g, g, g, g), tags: ['water', 'blocker'], biomes: { desert: 0.3 } },
  desert_market: { sockets: S(p, g, p, g), tags: ['path', 'blocker'], biomes: { desert: 1.6 } },
  desert_ruin: { sockets: S(g, g, g, g), tags: ['landmark', 'blocker'], biomes: { desert: 0.5 } },
  snow_pines: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: { snow: 2.2 } },
  snow_drifts: { sockets: S(g, g, g, g), tags: ['open'], biomes: { snow: 2.0 } },
  snow_cabin: { sockets: S(g, g, p, g), tags: ['path', 'house', 'blocker'], biomes: { snow: 3.0 } },
  snow_hamlet: { sockets: S(p, g, p, g), tags: ['path', 'house', 'blocker'], biomes: { snow: 1.5 } },
  frozen_pond: { sockets: S(g, g, g, g), tags: ['water', 'blocker'], biomes: { snow: 0.3 } },
  blossom_orchard: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: { blossom: 3.0 } },
  blossom_garden: { sockets: S(g, g, g, g), tags: ['open'], biomes: { blossom: 2.0 } },
  blossom_gazebo: { sockets: S(g, g, p, g), tags: ['path', 'landmark', 'blocker'], biomes: { blossom: 3.0 } },
  blossom_lane: { sockets: S(p, g, p, g), tags: ['path', 'forest'], biomes: { blossom: 1.6 } },
  deep_pines: { sockets: S(g, g, g, g), tags: ['forest', 'blocker'], biomes: { pinewood: 6.0 } },
  mushroom_glade: { sockets: S(g, g, g, g), tags: ['open', 'landmark'], biomes: { pinewood: 1.5 } },
  fallen_log: { sockets: S(g, g, g, g), tags: ['blocker'], biomes: { pinewood: 1.8 } },
  watchtower: { sockets: S(g, g, p, g), tags: ['path', 'landmark', 'blocker'], biomes: { pinewood: 2.5 } },
  church: { sockets: S(g, g, p, g), tags: ['path', 'landmark', 'blocker'], biomes: { heartland: 0.6, blossom: 0.5 } },
  barn_farm: { sockets: S(g, g, g, g), tags: ['landmark', 'blocker'], biomes: { heartland: 0.16, blossom: 0.12 } },
  market_square: { sockets: S(p, p, p, p), tags: ['path', 'landmark'], biomes: { heartland: 1.0, blossom: 0.6 } },
  manor: { sockets: S(g, g, p, g), tags: ['path', 'house', 'landmark', 'blocker'], biomes: { heartland: 0.7, blossom: 0.5 } },
};

export const MODEL_IDS = Object.keys(MODELS);
export const FALLBACK_MODEL = 'meadow';

/** Sockets of a model after `rot` clockwise quarter turns. */
export function rotateSockets(s, rot = 0) {
  let out = s;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) out = { n: out.w, e: out.n, s: out.e, w: out.s };
  return out;
}

/** three.js Y rotation for a tile with `rot` clockwise quarter turns. */
export function rotToY(rot) {
  return -rot * Math.PI * 0.5;
}

/** World-space centre of a cell. */
export function cellCentre(cx, cz, tileSize = 2) {
  return { x: cx * tileSize, z: cz * tileSize };
}

/** Cell containing a world position. */
export function worldToCell(x, z, tileSize = 2) {
  return { cx: Math.round(x / tileSize), cz: Math.round(z / tileSize) };
}

/**
 * Transform a world position into a tile's LOCAL (rot 0) frame: returns {u, v} in tile units
 * where u = local +X (east at rot 0), v = local +Z (south at rot 0), both in [-tileSize/2, tileSize/2].
 */
export function worldToTileLocal(x, z, cx, cz, rot, tileSize = 2) {
  let dx = x - cx * tileSize;
  let dz = z - cz * tileSize;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    // undo one clockwise quarter turn (i.e. rotate the point counter-clockwise seen from above)
    const t = dx;
    dx = dz;
    dz = -t;
  }
  return { u: dx, v: dz };
}
