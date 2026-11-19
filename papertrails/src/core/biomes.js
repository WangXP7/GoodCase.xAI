// FROZEN contract (owner: orchestrator): which BIOME a cell belongs to. Pure, deterministic, allocation-free
// lookups shared by the WFC (tile choice), the world, weather / ambient life and the grade.
//
// Layout: a jittered Voronoi diagram of sites on a SITE-tile grid with a gentle domain warp (wobbly borders).
// The site at the origin is always 'heartland' (the original look) and its four neighbours are fixed so every
// biome lies within ~12 tiles of the start: east = desert, west = snow, south = blossom, north = pinewood.
//
//   heartland  the original warm autumn farmland            (leaves drifting, clear)
//   desert     sand, dunes, cacti, tents, oasis              (heat haze, dust motes, hard sun)
//   snow       snowy pines, cabins, frozen ponds             (snowfall, cool light)
//   blossom    spring green, pink blossom trees, gardens     (petals, butterflies)
//   pinewood   dark misty conifer forest, mushrooms, marsh   (light rain / mist, fireflies at night)

export const BIOMES = ['heartland', 'desert', 'snow', 'blossom', 'pinewood'];
export const BIOME_INDEX = { heartland: 0, desert: 1, snow: 2, blossom: 3, pinewood: 4 };
/** Grid pitch of the Voronoi sites, in tiles. */
export const BIOME_SITE = 11;

function h2(seed, x, y, k) {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul((seed | 0) + k * 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function siteBiome(seed, gx, gy) {
  if (gx === 0 && gy === 0) return 0;
  if (gy === 0 && gx === 1) return 1;
  if (gy === 0 && gx === -1) return 2;
  if (gx === 0 && gy === 1) return 3;
  if (gx === 0 && gy === -1) return 4;
  const r = h2(seed, gx, gy, 3);
  return r < 0.3 ? 0 : 1 + Math.min(3, Math.floor(((r - 0.3) / 0.7) * 4));
}

// smooth value noise for the domain warp
function vnoise(seed, x, y, k) {
  const xi = Math.floor(x); const yi = Math.floor(y);
  const fx = x - xi; const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx); const uy = fy * fy * (3 - 2 * fy);
  const a = h2(seed, xi, yi, k); const b = h2(seed, xi + 1, yi, k);
  const c = h2(seed, xi, yi + 1, k); const d = h2(seed, xi + 1, yi + 1, k);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const _d = new Float64Array(BIOMES.length); // nearest site distance per biome (scratch)

/** Fills _d with the distance (tiles) from (x, z) to the nearest site of each biome. x, z in TILE units (floats ok). */
function distances(seed, x, z) {
  const wx = x + (vnoise(seed, x / 5.5, z / 5.5, 11) - 0.5) * 3.2;
  const wz = z + (vnoise(seed, x / 5.5, z / 5.5, 12) - 0.5) * 3.2;
  const gx0 = Math.round(wx / BIOME_SITE); const gy0 = Math.round(wz / BIOME_SITE);
  for (let i = 0; i < _d.length; i++) _d[i] = 1e9;
  for (let gy = gy0 - 2; gy <= gy0 + 2; gy++) {
    for (let gx = gx0 - 2; gx <= gx0 + 2; gx++) {
      const origin = gx === 0 && gy === 0;
      const sx = (gx + (origin ? 0 : (h2(seed, gx, gy, 1) - 0.5) * 0.7)) * BIOME_SITE;
      const sz = (gy + (origin ? 0 : (h2(seed, gx, gy, 2) - 0.5) * 0.7)) * BIOME_SITE;
      const d = Math.sqrt((wx - sx) * (wx - sx) + (wz - sz) * (wz - sz));
      const b = siteBiome(seed, gx, gy);
      if (d < _d[b]) _d[b] = d;
    }
  }
}

/** Biome index (into BIOMES) of the cell / tile-space point. */
export function biomeIndexAt(seed, cx, cz) {
  distances(seed, cx, cz);
  let best = 0;
  for (let i = 1; i < _d.length; i++) if (_d[i] < _d[best]) best = i;
  return best;
}

/** Biome id ('heartland' | 'desert' | ...) of cell (cx, cz). */
export function biomeAt(seed, cx, cz) { return BIOMES[biomeIndexAt(seed, cx, cz)]; }

/**
 * Biome + how deep inside it the point is.
 * @returns {{ id: string, index: number, edge: number }} edge = approx. distance (tiles) to the nearest other biome.
 *          The SAME object is returned on every call (copy the fields you keep).
 */
const _info = { id: 'heartland', index: 0, edge: 0 };
export function biomeInfo(seed, cx, cz) {
  distances(seed, cx, cz);
  let best = 0;
  for (let i = 1; i < _d.length; i++) if (_d[i] < _d[best]) best = i;
  let second = 1e9;
  for (let i = 0; i < _d.length; i++) if (i !== best && _d[i] < second) second = _d[i];
  _info.id = BIOMES[best]; _info.index = best; _info.edge = (second - _d[best]) / 2;
  return _info;
}

/**
 * Smooth blend weights (sum = 1) of every biome around a point, for weather / light / sound cross-fades.
 * @param {number} x tile-space X (world x / TILE_SIZE)  @param {number} z tile-space Z
 * @param {Float32Array|number[]} out length BIOMES.length  @param {number} [soft=1.6] blend half-width in tiles
 */
export function biomeWeights(seed, x, z, out, soft = 1.6) {
  distances(seed, x, z);
  let min = 1e9;
  for (let i = 0; i < _d.length; i++) if (_d[i] < min) min = _d[i];
  let sum = 0;
  for (let i = 0; i < _d.length; i++) { const w = Math.exp(-(_d[i] - min) / soft); out[i] = w; sum += w; }
  for (let i = 0; i < _d.length; i++) out[i] /= sum;
  return out;
}

/** Nearest cell (spiral from cx, cz) that lies at least `depth` tiles inside biome `id`. Returns {x, z} (cell) or null. */
export function findBiome(seed, id, cx = 0, cz = 0, depth = 3, maxR = 90) {
  const want = BIOME_INDEX[id];
  if (want === undefined) return null;
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const info = biomeInfo(seed, cx + dx, cz + dz);
        if (info.index === want && info.edge >= depth) return { x: cx + dx, z: cz + dz };
      }
    }
  }
  return null;
}
