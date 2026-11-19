// Wave function collapse for the endless page (owner: wfc agent). Contract: docs/ARCHITECTURE.md (world/wfc.js).
//
// HOW IT WORKS
//  * The infinite grid is cut into fixed 8x8 chunks. A chunk is generated from (seed, chunk coords) ONLY,
//    so the world is identical whatever order cells are visited in, and evicted chunks regenerate identically.
//  * Sockets on chunk BORDERS are pre-decided by stateless hash fields, before any collapse:
//      - rivers: every chunk corner gets a 0/1 label from a warped stripe field; a border carries a river
//        iff its two corners differ. Any corner labelling gives every chunk an even number of river
//        crossings, so rivers can never dead-end at a seam; the stripe field makes them endless meanders.
//      - roads: every chunk owns one road to its north or east neighbour (hash) => one connected network
//        over all chunks; extra hash edges add loops and junctions.
//  * Inside a chunk a planner routes the river course between its crossings and a trunk road between the
//    road crossings (noise-cost shortest paths with run-length / hairpin limits). Those edges become
//    pre-decided sockets exactly like the border ones.
//  * Then a real WFC solves the chunk: every cell holds a domain of tile options (bitmask); the cell with
//    the lowest Shannon entropy is collapsed with a weighted pick; socket constraints are propagated to a
//    fixpoint; a contradiction backtracks (bans the pick), a blown budget restarts the chunk with a new
//    plan, and after `maxAttempts` a guaranteed stub fill is used (never observed in the checks).
//    Weights = base weight x biome fields (forest / hills / flowers / settlement value noise) x structure
//    (distance to the road, river banks, keep the camera side of a road low) x adjacency of already
//    collapsed neighbours (forests and hills clump, villages line up, lanterns space out, one windmill).
//    Biome pass: every cell has a biome (core/biomes.js, cell.biome); each tile weight is also multiplied by
//    MODELS[id].biomes[biome] (schema: top of core/models.js). Connector tiles are never banned => always solvable.
//  * The solved chunk is validated (every path connected to the trunk, straight runs bounded, one signpost).
//
// Simulation code: no Math.random / Date / performance here. Everything derives from hash2(seed, ...).
import { CONFIG } from '../core/config.js';
import { hash2 } from '../core/rng.js';
import { TILES, FALLBACK_TILE, getTile, socketsOf, OPTIONS, biomeMultiplier } from './tiles.js';
import { BIOMES, biomeIndexAt, biomeAt } from '../core/biomes.js';

const N = 8; // chunk edge (cells)
const NN = N * N;
const G = 0;
const P = 1;
const R = 2;
const DX = [0, 1, 0, -1]; // n e s w
const DZ = [-1, 0, 1, 0];
const BIT = [1, 2, 4, 8];
const COORD_LIMIT = 1 << 24;

// ---------------------------------------------------------------- option tables (shared by all instances)
const NO = OPTIONS.length;
const SIG = new Uint8Array(NO * 4);
const OPT_T = new Uint8Array(NO);
const MASK_LO = new Int32Array(12); // [dir*3 + socket] -> options having that socket on that side
const MASK_HI = new Int32Array(12);
const MASK_EX = new Int32Array(12); // biome pass: third word (options 64..95)
if (NO > 96) throw new Error('wfc: more than 96 solver options (' + NO + '); widen the domain bitmask');
const PATH_BITS = new Uint8Array(NO); // path sockets of an option as a 4-bit mask
for (let o = 0; o < NO; o++) {
  OPT_T[o] = OPTIONS[o].t;
  for (let d = 0; d < 4; d++) {
    const s = OPTIONS[o].sig[d];
    SIG[o * 4 + d] = s;
    if (o < 32) MASK_LO[d * 3 + s] |= 1 << o;
    else if (o < 64) MASK_HI[d * 3 + s] |= 1 << (o - 32);
    else MASK_EX[d * 3 + s] |= 1 << (o - 64);
    if (s === P) PATH_BITS[o] |= BIT[d];
  }
}
const T = {};
TILES.forEach((t, i) => { T[t.id] = i; });
const NT = TILES.length;
const IS_FILLER = new Uint8Array(NT);
for (const o of OPTIONS) if (o.sig.every((s) => s === G)) IS_FILLER[o.t] = 1;
// fixer (biome pass): the biome-pass fillers follow the same low-frequency fields as the old ones, so trees mass into
// groves and open tiles into clearings instead of an even scatter. 1 = dense trees, 2 = open ground, 3 = dunes / relief.
const NEW_KIND = new Uint8Array(NT);
for (const [id, k] of [['desert_cacti', 1], ['snow_pines', 1], ['blossom_orchard', 1], ['deep_pines', 1], ['snow_drifts', 2], ['blossom_garden', 2], ['mushroom_glade', 2], ['fallen_log', 2], ['desert_dunes', 3], ['desert_dunes_b', 3], ['desert_dunes_c', 3]]) if (T[id] !== undefined) NEW_KIND[T[id]] = k;
// composition pass: landmarks are rare and stand in a clearing (see pick()); tree masses keep away from them
const IS_LM = new Uint8Array(NT); // any 'landmark' tile
const IS_CLEAR = new Uint8Array(NT); // landmarks that want open ground around them
const IS_TREES = new Uint8Array(NT); // tile types that bury a landmark
const IS_OPEN = new Uint8Array(NT); // low, open fillers that make a clearing
const IS_MASS = new Uint8Array(NT); // one-layout fillers that wallpaper when laid side by side
for (let t = 0; t < NT; t++) if ((TILES[t].tags || []).includes('landmark')) IS_LM[t] = 1;
for (const id of ['church', 'manor', 'market_square', 'barn_farm', 'windmill', 'blossom_gazebo', 'watchtower', 'desert_ruin']) if (T[id] !== undefined) IS_CLEAR[T[id]] = 1;
for (const id of ['forest', 'grove', 'blossom_orchard', 'deep_pines', 'snow_pines', 'hills']) if (T[id] !== undefined) IS_TREES[T[id]] = 1;
for (const id of ['meadow', 'meadow_flowers', 'blossom_garden', 'snow_drifts']) if (T[id] !== undefined) IS_OPEN[T[id]] = 1;
for (const id of ['hills', 'rocks', 'deep_pines', 'desert_dunes', 'desert_dunes_b', 'desert_dunes_c']) if (T[id] !== undefined) IS_MASS[T[id]] = 1;
// integrator (round 3): village, village_b and village_green are ONE hamlet family for the settlement factor, the
// clustering bonus and the run limit in computeWeights() / pick(), so the variants gather into 3-4 cottage hamlets.
const IS_HAMLET = new Uint8Array(NT);
for (const id of ['village', 'village_b', 'village_green']) if (T[id] !== undefined) IS_HAMLET[T[id]] = 1;
const PINEWOOD = BIOMES.indexOf('pinewood');
const nbT = new Uint8Array(NT); // pick(): orthogonal neighbours per tile type
const lmSeen = new Uint8Array(NT); // pick(): landmark types already in the chunk
const OPT_BY = new Map(OPTIONS.map((o) => [o.tileId + ':' + o.sig.join(''), o.index]));
const FALLBACK_OPT = OPT_BY.get(FALLBACK_TILE + ':0000');
const HI_ALL = NO >= 64 ? -1 : NO > 32 ? (1 << (NO - 32)) - 1 : 0;
const EX_ALL = NO >= 96 ? -1 : NO > 64 ? (1 << (NO - 64)) - 1 : 0;
/** Is option o in the 96-bit domain (lo, hi, ex)? */
const hasBit = (lo, hi, ex, o) => (o < 32 ? (lo >>> o) & 1 : o < 64 ? (hi >>> (o - 32)) & 1 : (ex >>> (o - 64)) & 1);

const popcnt = (v) => {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
const smooth = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- scratch (module level; collapse is not re-entrant)
const req = new Int8Array(NN * 4); // required socket per cell side: -1 = grass or path (free), else G/P/R
const rivMask = new Uint8Array(NN); // river sockets per cell (4-bit)
const trunkMask = new Uint8Array(NN); // trunk-road sockets per cell (4-bit)
const isSource = new Uint8Array(NN);
const distTrunk = new Uint8Array(NN);
const nearRiver = new Uint8Array(NN);
const runLen = new Uint8Array(NN * 4); // forced straight-through path cells beyond each side of a cell
const runEdge = new Uint8Array(NN * 4); // ... and whether that run reaches the chunk border
const rCost = new Float32Array(NN);
const rBlocked = new Uint8Array(NN);
const edgeF = new Float32Array(NN * 4);
const W = new Float64Array(NN * NO);
const WL = new Float64Array(NN * NO);
const domLo = new Int32Array(NN);
const domHi = new Int32Array(NN);
const domEx = new Int32Array(NN);
const res = new Int8Array(NN);
const ent = new Float64Array(NN);
const entOk = new Uint8Array(NN);
const QCAP = 1024;
const queue = new Int16Array(QCAP);
const inQueue = new Uint8Array(NN);
const MAX_DEPTH = NN + 2;
const stLo = new Int32Array(MAX_DEPTH * NN);
const stHi = new Int32Array(MAX_DEPTH * NN);
const stEx = new Int32Array(MAX_DEPTH * NN);
const stRes = new Int8Array(MAX_DEPTH * NN);
const stCell = new Int16Array(MAX_DEPTH);
const stOpt = new Int16Array(MAX_DEPTH);
const pickW = new Float64Array(NO);
const fForest = new Float32Array(NN);
const fHill = new Float32Array(NN);
const fFlower = new Float32Array(NN);
const fSettle = new Float32Array(NN);
const cBiome = new Uint8Array(NN); // biome index (core/biomes.js) per cell of the chunk being generated
// biome pass: weight multiplier per (biome, tile) from MODELS[id].biomes (schema: top of core/models.js)
const BMUL = new Float32Array(BIOMES.length * NT);
for (let b = 0; b < BIOMES.length; b++) for (let t = 0; t < NT; t++) BMUL[b * NT + t] = biomeMultiplier(TILES[t], BIOMES[b]);
const bfs = new Int16Array(NN);
const seen = new Uint8Array(NN);
// router
const MAXR = 6;
const NSTATE = NN * 4 * MAXR * 3;
const rDist = new Float32Array(NSTATE);
const rPrev = new Int32Array(NSTATE);
const rStamp = new Int32Array(NSTATE);
let rStampId = 0;
const heapS = new Int32Array(NSTATE * 4);
const heapD = new Float32Array(NSTATE * 4);
let heapN = 0;
const outPath = new Int16Array(NN * 2);
let outLen = 0;

function heapPush(s, d) {
  let i = heapN++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapD[p] <= d) break;
    heapS[i] = heapS[p]; heapD[i] = heapD[p];
    i = p;
  }
  heapS[i] = s; heapD[i] = d;
}
function heapPop() {
  const top = heapS[0];
  const s = heapS[--heapN];
  const d = heapD[heapN];
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= heapN) break;
    if (c + 1 < heapN && heapD[c + 1] < heapD[c]) c++;
    if (heapD[c] >= d) break;
    heapS[i] = heapS[c]; heapD[i] = heapD[c];
    i = c;
  }
  heapS[i] = s; heapD[i] = d;
  return top;
}
function routeBegin() { heapN = 0; rStampId++; }
function routeStart(cell, dir) {
  if (rBlocked[cell]) return;
  const s = ((cell * 4 + dir) * MAXR) * 3 + 2;
  const d = rCost[cell];
  if (rStamp[s] === rStampId && rDist[s] <= d) return;
  rStamp[s] = rStampId; rDist[s] = d; rPrev[s] = -1;
  heapPush(s, d);
}
const stateCell = (q) => (((q / 3) | 0) / MAXR | 0) >> 2;
/**
 * Shortest path over (cell, heading, straight run, last turn sense). Limits straight runs to `maxRun`
 * moves and forbids hairpins (two successive turns of the same sense). `road` routes may cross a straight
 * river cell at right angles only (that cell becomes a bridge). Target: `targetCell`, or any trunk cell
 * when targetCell < 0. With `exitDir` >= 0 the path leaves the chunk through that side of the target.
 * Result in outPath[0..outLen).
 */
function routeRun(road, maxRun, turnCost, bridgeCost, targetCell, exitDir) {
  while (heapN > 0) {
    const d0 = heapD[0];
    const s = heapPop();
    if (d0 > rDist[s]) continue;
    const sense = s % 3;
    let t = (s / 3) | 0;
    const run = (t % MAXR) + 1;
    t = (t / MAXR) | 0;
    const d = t & 3;
    const c = t >> 2;
    if (targetCell >= 0 ? c === targetCell : trunkMask[c] !== 0) {
      if (targetCell >= 0 && exitDir >= 0 && (d === ((exitDir + 2) & 3) || (d === exitDir && run >= maxRun))) continue;
      let n = 0;
      for (let q = s; q >= 0; q = rPrev[q]) n++;
      if (n > NN) return false;
      outLen = n;
      for (let q = s; q >= 0; q = rPrev[q]) outPath[--n] = stateCell(q);
      seen.fill(0); // must be a simple path
      for (let i = 0; i < outLen; i++) { if (seen[outPath[i]]) return false; seen[outPath[i]] = 1; }
      return true;
    }
    const onRiver = road && rivMask[c] !== 0;
    const cx = c % N;
    const cz = (c / N) | 0;
    for (let k = 0; k < 3; k++) {
      let nd; let nrun; let nsense;
      if (k === 0) {
        nd = d; nrun = run + 1; nsense = sense;
        if (nrun > maxRun) continue;
      } else {
        if (onRiver) continue;
        nsense = k - 1;
        if (run === 1 && sense === nsense) continue; // hairpin
        nd = k === 1 ? (d + 3) & 3 : (d + 1) & 3;
        nrun = 1;
      }
      const x = cx + DX[nd];
      const z = cz + DZ[nd];
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const c2 = z * N + x;
      if (rBlocked[c2]) continue;
      let w = 1 + rCost[c2] + (k ? turnCost : 0);
      if (road) {
        const rm = rivMask[c2];
        if (rm) {
          if (trunkMask[c2] || isSource[c2]) continue;
          if (!((rm === 5 && (nd & 1)) || (rm === 10 && !(nd & 1)))) continue;
          // no two bridges side by side
          const step = rm === 5 ? N : 1;
          if ((c2 - step >= 0 && rivMask[c2 - step] && trunkMask[c2 - step]) || (c2 + step < NN && rivMask[c2 + step] && trunkMask[c2 + step])) continue;
          w += bridgeCost;
        }
      }
      const s2 = ((c2 * 4 + nd) * MAXR + nrun - 1) * 3 + nsense;
      const nd2 = d0 + w;
      if (rStamp[s2] !== rStampId || nd2 < rDist[s2]) {
        rStamp[s2] = rStampId; rDist[s2] = nd2; rPrev[s2] = s;
        if (heapN < heapS.length) heapPush(s2, nd2);
      }
    }
  }
  return false;
}

/** Mark outPath as river (mask = rivMask) or trunk road (mask = trunkMask). */
function applyPath(mask) {
  for (let i = 0; i + 1 < outLen; i++) {
    const a = outPath[i];
    const b = outPath[i + 1];
    const d = b === a - N ? 0 : b === a + 1 ? 1 : b === a + N ? 2 : 3;
    mask[a] |= BIT[d];
    mask[b] |= BIT[(d + 2) & 3];
  }
}

// ---------------------------------------------------------------- the start, hand laid (world cell coords)
// Road: from the south border up through (0,0), over the bridge at (0,-2), out through the north border.
// River: west border -> past the house -> under the bridge -> east border.
const ORIGIN_ROAD = [[1, 3], [1, 2], [1, 1], [0, 1], [0, 0], [0, -1], [0, -2], [0, -3], [1, -3], [1, -4]];
const ORIGIN_RIVER = [[-3, -3], [-2, -3], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [2, -3], [3, -3], [4, -3]];
const ORIGIN_FIXED = [[0, 0, 'lantern_post:1010'], [-1, -1, 'house:0100'], [0, -1, 'path_t:1011']];

function mulberry(a) {
  a >>>= 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWFC({ seed = 1, _weights = null, _fault = 0 } = {}) {
  seed = (Number(seed) || 0) | 0;
  const cfg = CONFIG.wfc;
  const OX = cfg.originLocal[0];
  const OZ = cfg.originLocal[1];
  const BW = _weights || TILES.map((t) => t.weight); // _weights / _fault: test hooks (tools/checks/wfc/stress.mjs)
  const chunks = new Map();
  let lastKey = NaN;
  let lastChunk = null;
  const stats = { chunks: 0, attempts: 0, backtracks: 0, restarts: 0, strictChunks: 0, fallbackChunks: 0, planFails: 0, validateFails: 0, vOrphan: 0, vEnds: 0, vRun: 0, evicted: 0 };

  // ------------------------------------------------------------ stateless fields
  const u01 = (x, z, s) => hash2(x, z, seed + s) / 4294967296;
  function vnoise(x, z, period, s) {
    const gx = x / period;
    const gz = z / period;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    let fx = gx - x0;
    let fz = gz - z0;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = u01(x0, z0, s);
    const b = u01(x0 + 1, z0, s);
    const c = u01(x0, z0 + 1, s);
    const d = u01(x0 + 1, z0 + 1, s);
    const top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fz;
  }
  const field = (x, z, period, s) => 0.68 * vnoise(x, z, period, s) + 0.32 * vnoise(x + 31, z - 17, period * 0.47, s + 1);

  // rivers: stripe labels on chunk corners
  const phi = (u01(11, 23, 901) - 0.5) * 2 * cfg.riverTilt;
  const na = Math.sin(phi);
  const nb = Math.cos(phi);
  const warp = (kx, kz) => (vnoise(kx, kz, cfg.riverWarpPeriod, 911) - 0.5) * 2 + (vnoise(kx, kz, cfg.riverWarpPeriod * 0.5, 913) - 0.5) * 0.8;
  const warp0 = (warp(0, 0) + warp(1, 0) + warp(0, 1) + warp(1, 1)) / 4;
  function label(kx, kz) {
    if ((kx === 0 || kx === 1) && (kz === 0 || kz === 1)) return kz === 0 ? 1 : 0; // a river runs W-E through the start chunk
    const f = ((kx - 0.5) * na + (kz - 0.5) * nb + cfg.riverWarp * (warp(kx, kz) - warp0)) / cfg.riverSpacing;
    return Math.floor(f) & 1;
  }
  // border ids: H(kx,kz) = north border of chunk (kx,kz); V(kx,kz) = west border of chunk (kx,kz)
  const riverH = (kx, kz) => label(kx, kz) !== label(kx + 1, kz);
  const riverV = (kx, kz) => label(kx, kz) !== label(kx, kz + 1);
  const riverPosH = (kx, kz) => 1 + (hash2(kx, kz, seed + 921) % (N - 2));
  const riverPosV = (kx, kz) => ((kx === 0 || kx === 1) && kz === 0 ? -3 + OZ : 1 + (hash2(kx, kz, seed + 923) % (N - 2)));
  // roads
  const isStartCol = (cx, cz) => (cx === 0 && (cz === 0 || cz === 1)) || (cx === -1 && cz === 0);
  const roadChoice = (cx, cz) => (isStartCol(cx, cz) ? 0 : hash2(cx, cz, seed + 931) & 1); // 0 = north, 1 = east
  const roadExtra = (cx, cz) => !isStartCol(cx, cz) && u01(cx, cz, 933) < cfg.roadExtra;
  const roadH = (kx, kz) => roadChoice(kx, kz) === 0 || roadExtra(kx, kz);
  const roadV = (kx, kz) => !((kx === 0 || kx === 1) && kz === 0) && (roadChoice(kx - 1, kz) === 1 || roadExtra(kx - 1, kz));
  function roadPos(p, hasRiver, q) {
    if (hasRiver && Math.abs(p - q) < 2) p = q + 2 <= N - 2 ? q + 2 : q - 2;
    return p;
  }
  const roadPosH = (kx, kz) => (kx === 0 && (kz === 0 || kz === 1) ? 1 + OX : roadPos(1 + (hash2(kx, kz, seed + 941) % (N - 2)), riverH(kx, kz), riverPosH(kx, kz)));
  const roadPosV = (kx, kz) => roadPos(1 + (hash2(kx, kz, seed + 943) % (N - 2)), riverV(kx, kz), riverPosV(kx, kz));

  /** Border crossings of a chunk: [{ cell, out }] for rivers and roads (order n, e, s, w). */
  function crossings(cx, cz) {
    const rivers = [];
    const roads = [];
    if (riverH(cx, cz)) rivers.push({ cell: riverPosH(cx, cz), out: 0 });
    if (riverV(cx + 1, cz)) rivers.push({ cell: riverPosV(cx + 1, cz) * N + N - 1, out: 1 });
    if (riverH(cx, cz + 1)) rivers.push({ cell: (N - 1) * N + riverPosH(cx, cz + 1), out: 2 });
    if (riverV(cx, cz)) rivers.push({ cell: riverPosV(cx, cz) * N, out: 3 });
    if (roadH(cx, cz)) roads.push({ cell: roadPosH(cx, cz), out: 0 });
    if (roadV(cx + 1, cz)) roads.push({ cell: roadPosV(cx + 1, cz) * N + N - 1, out: 1 });
    if (roadH(cx, cz + 1)) roads.push({ cell: (N - 1) * N + roadPosH(cx, cz + 1), out: 2 });
    if (roadV(cx, cz)) roads.push({ cell: roadPosV(cx, cz) * N, out: 3 });
    return { rivers, roads };
  }

  // ------------------------------------------------------------ planner
  let hub = -1;
  let originChunk = false; // integrator (round 3): computeWeights() boosts hamlets / ponds around the start cell
  function fillCost(rng, amp, ringPenalty) {
    for (let i = 0; i < NN; i++) {
      const x = i % N;
      const z = (i / N) | 0;
      const r = rng();
      rCost[i] = amp * r * r + (x === 0 || z === 0 || x === N - 1 || z === N - 1 ? ringPenalty : 0);
    }
  }
  /** Roads should not run side by side: make cells next to the existing trunk expensive. */
  function avoidTrunk(amount) {
    for (let i = 0; i < NN; i++) {
      if (trunkMask[i]) continue;
      const x = i % N;
      const z = (i / N) | 0;
      if ((x > 0 && trunkMask[i - 1]) || (x < N - 1 && trunkMask[i + 1]) || (z > 0 && trunkMask[i - N]) || (z < N - 1 && trunkMask[i + N])) rCost[i] += amount;
    }
  }
  function markNearRiver() {
    nearRiver.fill(0);
    for (let i = 0; i < NN; i++) {
      if (!rivMask[i]) continue;
      const x = i % N;
      const z = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d];
        const z2 = z + DZ[d];
        if (x2 >= 0 && z2 >= 0 && x2 < N && z2 < N) nearRiver[z2 * N + x2] = 1;
      }
    }
  }

  function plan(cx, cz, X, rng, isOrigin, attempt) {
    req.fill(-1);
    rivMask.fill(0);
    trunkMask.fill(0);
    isSource.fill(0);
    hub = -1;
    const { rivers, roads } = X;
    const roadRun = attempt >= 4 ? cfg.roadMaxRun - 1 : cfg.roadMaxRun; // later attempts leave more slack for the run check

    if (isOrigin) {
      const set = (list, mask) => {
        outLen = 0;
        for (const [x, z] of list) outPath[outLen++] = (z + OZ) * N + x + OX;
        applyPath(mask);
      };
      set(ORIGIN_RIVER, rivMask);
      set(ORIGIN_ROAD, trunkMask);
      for (const r of rivers) rivMask[r.cell] |= BIT[r.out];
      for (const r of roads) trunkMask[r.cell] |= BIT[r.out];
    } else {
      // ---- rivers
      const nr = rivers.length;
      const order = [];
      if (nr === 2) order.push(0, 1);
      else if (nr === 4) { if (rng() < 0.5) order.push(0, 1, 2, 3); else order.push(0, 3, 1, 2); } else if (nr === 3) order.push(0, 1);
      for (let k = 0; k + 1 < order.length; k += 2) {
        const a = rivers[order[k]];
        const b = rivers[order[k + 1]];
        fillCost(rng, cfg.riverNoise, 2.5);
        markNearRiver();
        for (let i = 0; i < NN; i++) { rBlocked[i] = rivMask[i] ? 1 : 0; if (nearRiver[i]) rCost[i] += 6; }
        for (const r of roads) rBlocked[r.cell] = 1;
        for (const r of rivers) if (r !== a && r !== b) rBlocked[r.cell] = 1;
        rCost[a.cell] = 0; rCost[b.cell] = 0;
        routeBegin();
        routeStart(a.cell, (a.out + 2) & 3);
        if (!routeRun(false, cfg.riverMaxRun, cfg.riverTurnCost, 0, b.cell, b.out)) return false;
        applyPath(rivMask);
        rivMask[a.cell] |= BIT[a.out];
        rivMask[b.cell] |= BIT[b.out];
      }
      if (nr === 1 || nr === 3) { // cannot happen with corner labels; kept so any border set is solvable
        const a = rivers[nr - 1];
        if (rivMask[a.cell]) return false;
        rivMask[a.cell] |= BIT[a.out];
        isSource[a.cell] = 1;
      }
      // ---- brook: a spring, a short stream, a sink in the rocks
      if (nr === 0 && u01(cx, cz, 951) < cfg.brookChance) {
        for (let tries = 0; tries < 9; tries++) {
          const ax = 1 + ((rng() * (N - 2)) | 0);
          const az = 1 + ((rng() * (N - 2)) | 0);
          const bx = 1 + ((rng() * (N - 2)) | 0);
          const bz = 1 + ((rng() * (N - 2)) | 0);
          if (Math.abs(ax - bx) + Math.abs(az - bz) < cfg.brookMinSpan) continue;
          const a = az * N + ax;
          const b = bz * N + bx;
          fillCost(rng, cfg.riverNoise, 0);
          for (let i = 0; i < NN; i++) { const x = i % N; const z = (i / N) | 0; rBlocked[i] = x === 0 || z === 0 || x === N - 1 || z === N - 1 ? 1 : 0; }
          rBlocked[a] = 1;
          routeBegin();
          for (let d = 0; d < 4; d++) routeStart((az + DZ[d]) * N + ax + DX[d], d);
          if (!routeRun(false, cfg.riverMaxRun, cfg.riverTurnCost, 0, b, -1)) continue;
          if (outLen + 1 < cfg.brookMinLen) continue;
          for (let i = outLen; i > 0; i--) outPath[i] = outPath[i - 1];
          outPath[0] = a;
          outLen++;
          applyPath(rivMask);
          isSource[a] = 1;
          isSource[b] = 1;
          break;
        }
      }
      // ---- trunk road
      const nq = roads.length;
      const ro = roads.slice();
      for (let i = nq - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = ro[i]; ro[i] = ro[j]; ro[j] = t; }
      markNearRiver();
      if (nq === 1) {
        const a = ro[0];
        const ax = a.cell % N;
        const az = (a.cell / N) | 0;
        for (let tries = 0; tries < 12 && hub < 0; tries++) {
          const hx = 1 + ((rng() * (N - 2)) | 0);
          const hz = 1 + ((rng() * (N - 2)) | 0);
          const h = hz * N + hx;
          if (rivMask[h] || nearRiver[h] || Math.abs(hx - ax) + Math.abs(hz - az) < 3) continue;
          hub = h;
        }
        if (hub < 0) return false;
        fillCost(rng, cfg.roadNoise, 1.5);
        rBlocked.fill(0);
        rCost[a.cell] = 0;
        routeBegin();
        routeStart(a.cell, (a.out + 2) & 3);
        if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, hub, -1)) return false;
        applyPath(trunkMask);
        trunkMask[a.cell] |= BIT[a.out];
      } else if (nq >= 2) {
        const crossroads = () => {
        // four roads meet at one crossroads (and a hamlet grows around it)
          for (let tries = 0; tries < 12 && hub < 0; tries++) {
            const hx = 2 + ((rng() * (N - 4)) | 0);
            const hz = 2 + ((rng() * (N - 4)) | 0);
            const h = hz * N + hx;
            if (!rivMask[h] && !nearRiver[h]) hub = h;
          }
          if (hub < 0) return false;
          for (let k = 0; k < 4; k++) {
            const a = ro[k];
            fillCost(rng, cfg.roadNoise, 1.5);
            for (let i = 0; i < NN; i++) rBlocked[i] = trunkMask[i] && i !== hub ? 1 : 0;
            for (const r of roads) if (r !== a) rBlocked[r.cell] = 1;
            avoidTrunk(2.5);
            rCost[hub] = 0;
            rCost[a.cell] = 0;
            routeBegin();
            routeStart(a.cell, (a.out + 2) & 3);
            if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, hub, -1)) return false;
            applyPath(trunkMask);
            trunkMask[a.cell] |= BIT[a.out];
          }
          if (trunkMask[hub] !== 15) return false;
          return true;
        };
        const detour = () => {
        // a through road wanders via a waypoint instead of cutting straight across
          const a = ro[0];
          const b = ro[1];
          let way = -1;
          for (let tries = 0; tries < 12 && way < 0; tries++) {
            const hx = 1 + ((rng() * (N - 2)) | 0);
            const hz = 1 + ((rng() * (N - 2)) | 0);
            const h = hz * N + hx;
            if (rivMask[h] || nearRiver[h]) continue;
            if (Math.abs(hx - (a.cell % N)) + Math.abs(hz - ((a.cell / N) | 0)) < 3 || Math.abs(hx - (b.cell % N)) + Math.abs(hz - ((b.cell / N) | 0)) < 3) continue;
            way = h;
          }
          if (way < 0) return false;
          for (let k = 0; k < 2; k++) {
            const c = k ? b : a;
            fillCost(rng, cfg.roadNoise, 1.5);
            for (let i = 0; i < NN; i++) rBlocked[i] = trunkMask[i] && i !== way ? 1 : 0;
            rBlocked[(k ? a : b).cell] = 1;
            avoidTrunk(2.5);
            rCost[way] = 0;
            rCost[c.cell] = 0;
            routeBegin();
            routeStart(c.cell, (c.out + 2) & 3);
            if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, way, -1)) return false;
            applyPath(trunkMask);
            trunkMask[c.cell] |= BIT[c.out];
          }
          return true;
        };
        // the fancy layouts are tried first; if they do not fit, the plain trunk below always can
        let special = false;
        if (attempt < 3) {
          if (nq === 4 && rng() < cfg.crossroads) special = crossroads();
          else if (nq === 2 && rng() < cfg.roadDetour) special = detour();
          if (!special) { trunkMask.fill(0); hub = -1; }
        }
        for (let k = 1; k < nq && !special; k++) {
          const a = k === 1 ? ro[0] : ro[k];
          fillCost(rng, cfg.roadNoise, 1.5);
          rBlocked.fill(0);
          for (const r of roads) rCost[r.cell] = 0;
          if (k === 1) {
            const b = ro[1];
            routeBegin();
            routeStart(a.cell, (a.out + 2) & 3);
            if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, b.cell, b.out)) return false;
            applyPath(trunkMask);
            trunkMask[a.cell] |= BIT[a.out];
            trunkMask[b.cell] |= BIT[b.out];
          } else {
            if (!trunkMask[a.cell]) {
              avoidTrunk(1.5);
              routeBegin();
              routeStart(a.cell, (a.out + 2) & 3);
              if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, -1, -1)) return false;
              applyPath(trunkMask);
            }
            trunkMask[a.cell] |= BIT[a.out];
          }
        }
      }
    }
    // ---- a river with a road nearby gets a bridge: a short lane over the water to a cottage on the far bank
    if (!isOrigin && rivers.length >= 2 && roads.length) {
      let bridged = false;
      for (let i = 0; i < NN; i++) if (rivMask[i] && trunkMask[i]) bridged = true;
      for (let tries = 0; tries < 10 && !bridged; tries++) {
        const c = (rng() * NN) | 0;
        const rm = rivMask[c];
        if ((rm !== 5 && rm !== 10) || isSource[c]) continue;
        const d = (rm === 5 ? 1 : 0) + (rng() < 0.5 ? 2 : 0); // heading over the water
        const fx = (c % N) - DX[d];
        const fz = ((c / N) | 0) - DZ[d];
        const nx = (c % N) + DX[d];
        const nz = ((c / N) | 0) + DZ[d];
        if (fx < 1 || fz < 1 || fx >= N - 1 || fz >= N - 1 || nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const far = fz * N + fx;
        if (rivMask[far] || trunkMask[far]) continue;
        fillCost(rng, cfg.roadNoise, 1.5);
        rBlocked.fill(0);
        rBlocked[far] = 1;
        for (const r of roads) if (!trunkMask[r.cell]) rBlocked[r.cell] = 1;
        routeBegin();
        routeStart(c, d);
        if (!routeRun(true, roadRun, cfg.roadTurnCost, cfg.bridgeCost, -1, -1) || outLen > 6) continue;
        for (let i = outLen; i > 0; i--) outPath[i] = outPath[i - 1];
        outPath[0] = far;
        outLen++;
        applyPath(trunkMask);
        bridged = true;
      }
    }
    // no 2x2 knot of road (tight squiggles, one-cell detour bumps, mini ring roads)
    if (!isOrigin && attempt < 4) {
      for (let z = 0; z < N - 1; z++) for (let x = 0; x < N - 1; x++) {
        const i = z * N + x;
        if (trunkMask[i] && trunkMask[i + 1] && trunkMask[i + N] && trunkMask[i + N + 1]) return false;
      }
    }
    // every planned cell must have a tile: river + road on one cell is only legal as a right-angle bridge
    for (let i = 0; i < NN; i++) {
      const rm = rivMask[i];
      const tm = trunkMask[i];
      if (rm && tm && !((rm === 5 && tm === 10) || (rm === 10 && tm === 5))) return false;
    }
    // required sockets
    for (let i = 0; i < NN; i++) {
      const x = i % N;
      const z = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d];
        const z2 = z + DZ[d];
        const border = x2 < 0 || z2 < 0 || x2 >= N || z2 >= N;
        req[i * 4 + d] = rivMask[i] & BIT[d] ? R : trunkMask[i] & BIT[d] ? P : border ? G : -1;
      }
    }
    // distance to the trunk road
    distTrunk.fill(99);
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < NN; i++) if (trunkMask[i]) { distTrunk[i] = 0; bfs[qt++] = i; }
    while (qh < qt) {
      const i = bfs[qh++];
      const x = i % N;
      const z = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d];
        const z2 = z + DZ[d];
        if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
        const j = z2 * N + x2;
        if (distTrunk[j] > distTrunk[i] + 1) { distTrunk[j] = distTrunk[i] + 1; bfs[qt++] = j; }
      }
    }
    markNearRiver();
    // straight runs the trunk already forces (a cell with both opposite trunk sockets is crossed straight through)
    for (let d = 0; d < 4; d++) {
      const od = (d + 2) & 3;
      const through = BIT[d] | BIT[od];
      for (let a = 0; a < N; a++) {
        // walk against d so that the neighbour on side d is already known
        for (let k = 0; k < N; k++) {
          const b = d === 0 || d === 3 ? k : N - 1 - k;
          const i = d & 1 ? a * N + b : b * N + a;
          const x2 = (i % N) + DX[d];
          const z2 = ((i / N) | 0) + DZ[d];
          let len = 0;
          let edge = 0;
          if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) edge = trunkMask[i] & BIT[d] ? 1 : 0;
          else {
            const j = z2 * N + x2;
            if ((trunkMask[j] & through) === through) { len = 1 + runLen[j * 4 + d]; edge = runEdge[j * 4 + d]; }
          }
          runLen[i * 4 + d] = len;
          runEdge[i * 4 + d] = edge;
          if ((trunkMask[i] & through) === through && d < 2) {
            // total run through i along this axis = both sides + itself; the other side is checked when d flips
          }
        }
      }
    }
    for (let i = 0; i < NN; i++) {
      for (let d = 0; d < 2; d++) {
        const through = BIT[d] | BIT[d + 2];
        if ((trunkMask[i] & through) !== through) continue;
        const total = 1 + runLen[i * 4 + d] + runLen[i * 4 + d + 2];
        const lim = runEdge[i * 4 + d] || runEdge[i * 4 + d + 2] ? cfg.maxBorderRun : cfg.maxInnerRun;
        if (total > lim) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------ weights
  function computeFields(cx, cz) {
    for (let i = 0; i < NN; i++) {
      const x = cx * N + (i % N) - OX;
      const z = cz * N + ((i / N) | 0) - OZ;
      fForest[i] = smooth(0.41, 0.6, field(x, z, cfg.forestPeriod, 961));
      fHill[i] = smooth(cfg.hillLo ?? 0.42, cfg.hillHi ?? 0.6, field(x, z, cfg.hillPeriod, 965));
      fFlower[i] = smooth(0.45, 0.7, field(x, z, cfg.flowerPeriod, 969));
      fSettle[i] = smooth(0.42, 0.62, field(x, z, cfg.settlePeriod, 973));
      cBiome[i] = biomeIndexAt(seed, x, z);
    }
  }

  function computeWeights(strict) {
    for (let i = 0; i < NN; i++) {
      const x = i % N;
      const z = (i / N) | 0;
      const F = fForest[i];
      const H = fHill[i];
      const Fl = fFlower[i];
      let S = fSettle[i];
      const nearStart = originChunk && Math.max(Math.abs(x - OX), Math.abs(z - OZ)) <= (cfg.startNear ?? 0);
      if (hub >= 0) S = Math.max(S, 1 - (Math.abs(x - (hub % N)) + Math.abs(z - ((hub / N) | 0))) / 3.5); // a road's end is a hamlet
      // side-lane factor per free cell edge
      const f1 = cfg.spurBase + cfg.spurSettle * S;
      for (let d = 0; d < 4; d++) {
        let f = 0;
        if (!strict && req[i * 4 + d] === -1) {
          const j = (z + DZ[d]) * N + x + DX[d];
          const a = Math.min(distTrunk[i], distTrunk[j]);
          const b = Math.max(distTrunk[i], distTrunk[j]);
          if (a === 0 && b === 1) f = f1; // a lane leaving the trunk road
          else if (a >= 1 && a <= 2 && b === a + 1) f = cfg.laneOn; // ... and running on, away from it
          // lateral edges stay banned: with the "one socket must point home" rule below, every lane hangs on the trunk
        }
        edgeF[i * 4 + d] = f;
      }
      const dT = distTrunk[i];
      const nearRoad = dT === 1;
      const southOfRoad = z > 0 && trunkMask[i - N] !== 0; // between the default camera and a road: keep it low
      const bank = nearRiver[i] && !rivMask[i];
      const base = i * NO;
      const bm = cBiome[i] * NT;
      for (let o = 0; o < NO; o++) {
        const t = OPT_T[o];
        let w = BW[t] * BMUL[bm + t];
        if (IS_FILLER[t]) {
          const open = 1 - Math.max(F, H);
          if (t === T.meadow) w *= 0.3 + 0.95 * open * open;
          else if (t === T.meadow_flowers) w *= (0.5 + 2.6 * Fl) * (0.5 + 0.5 * open) * (bank ? 1.5 : 1) * (nearRoad ? 1.25 : 1);
          else if (t === T.forest) w *= (0.06 + 5.2 * F * F) * (nearRoad ? 0.9 : 1) * (southOfRoad ? 0.4 : 1) * (1 - 0.6 * S);
          else if (t === T.grove) w *= (0.4 + 3.4 * smooth(0.05, 0.5, F) * (1 - 0.55 * F)) * (bank ? 1.35 : 1) * (southOfRoad ? 0.7 : 1);
          else if (t === T.hills) w *= (0.08 + 5.0 * H * H) * (1 - 0.45 * F) * (nearRoad ? 0.9 : 1) * (southOfRoad ? 0.45 : 1) * (bank ? 0.5 : 1) * (cBiome[i] === PINEWOOD ? 0 : 1); // no pale hill cards in the dark pinewood
          else if (t === T.rocks) w *= (0.13 + 1.6 * H) * (bank ? 0.7 : 1) * (1 - 0.5 * S);
          else if (t === T.pond) w *= 0.3 * (1 - 0.7 * H) * (nearRiver[i] ? 0.15 : 1) * (0.6 + 0.8 * Fl) * (nearStart ? cfg.startPond ?? 1 : 1);
          else if (NEW_KIND[t] === 1) w *= (0.07 + 3.6 * F * F) * (southOfRoad ? 0.6 : 1) * (1 - 0.5 * S);
          else if (NEW_KIND[t] === 2) w *= 0.25 + 1.9 * open * open;
          else if (NEW_KIND[t] === 3) w *= (0.5 + 2.2 * H) * (1 - 0.5 * F);
          else if (t === T.windmill) w *= (x >= 2 && x <= 5 && z >= 2 && z <= 5 ? 1.0 : 0) * open * (dT >= 1 && dT <= 2 ? 3 : 1) * (southOfRoad ? 0.3 : 1) * (bank ? 0.5 : 1) * (0.7 + S);
        } else {
          if (IS_HAMLET[t]) w *= (0.05 + 3.2 * S * S) * (nearStart ? cfg.startHamlet ?? 1 : 1);
          else if (t === T.lantern_post) w *= (0.75 + 1.3 * S) * (OPTIONS[o].rots[0] & 1 ? 0.7 : 1.3); // quality pass: the post is turned 35 deg with a fin pair, so it also reads on an east-west road (was banned there)
          else if (t === T.house) w *= 0.8 + 0.6 * S;
          const pb = PATH_BITS[o];
          if (pb) {
            let home = dT === 0;
            for (let d = 0; d < 4; d++) {
              if (!(pb & BIT[d]) || req[i * 4 + d] !== -1) continue;
              w *= edgeF[i * 4 + d];
              if (distTrunk[(z + DZ[d]) * N + x + DX[d]] < dT) home = true;
            }
            if (!home) w = 0;
            // a lane must not stretch a straight run of the road past the limit
            for (let d = 0; d < 2 && w > 0; d++) {
              const through = BIT[d] | BIT[d + 2];
              if ((pb & through) !== through || (trunkMask[i] & through) === through) continue;
              const total = 1 + runLen[i * 4 + d] + runLen[i * 4 + d + 2];
              if (total > (runEdge[i * 4 + d] || runEdge[i * 4 + d + 2] ? cfg.maxBorderRun : cfg.maxInnerRun)) w = 0;
            }
          }
        }
        W[base + o] = w;
        WL[base + o] = w > 0 ? w * Math.log(w) : 0;
      }
    }
  }

  // ------------------------------------------------------------ WFC core
  let qHead = 0;
  let qTail = 0;
  function enqueue(i) { if (!inQueue[i]) { inQueue[i] = 1; queue[qTail++ & (QCAP - 1)] = i; } }

  /** Propagate socket constraints from the queued cells to a fixpoint. false = contradiction. */
  function propagate() {
    while (qHead < qTail) {
      const i = queue[qHead++ & (QCAP - 1)];
      inQueue[i] = 0;
      const lo = domLo[i];
      const hi = domHi[i];
      const ex = domEx[i];
      const x = i % N;
      const z = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d];
        const z2 = z + DZ[d];
        if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
        const j = z2 * N + x2;
        const od = (d + 2) & 3;
        let aLo = 0;
        let aHi = 0;
        let aEx = 0;
        for (let s = 0; s < 3; s++) {
          if ((lo & MASK_LO[d * 3 + s]) | (hi & MASK_HI[d * 3 + s]) | (ex & MASK_EX[d * 3 + s])) { aLo |= MASK_LO[od * 3 + s]; aHi |= MASK_HI[od * 3 + s]; aEx |= MASK_EX[od * 3 + s]; }
        }
        const nLo = domLo[j] & aLo;
        const nHi = domHi[j] & aHi;
        const nEx = domEx[j] & aEx;
        if (nLo !== domLo[j] || nHi !== domHi[j] || nEx !== domEx[j]) {
          domLo[j] = nLo; domHi[j] = nHi; domEx[j] = nEx; entOk[j] = 0;
          if ((nLo | nHi | nEx) === 0) { qHead = qTail = 0; inQueue.fill(0); return false; }
          enqueue(j);
        }
      }
    }
    qHead = qTail = 0;
    return true;
  }

  function entropy(i, rng) {
    const lo = domLo[i];
    const hi = domHi[i];
    const ex = domEx[i];
    const base = i * NO;
    let sum = 0;
    let sl = 0;
    for (let o = 0; o < NO; o++) {
      if (hasBit(lo, hi, ex, o)) { sum += W[base + o]; sl += WL[base + o]; }
    }
    return Math.log(sum) - sl / sum + rng() * 1e-4;
  }

  const sameOpt = (x, z, o) => x >= 0 && z >= 0 && x < N && z < N && res[z * N + x] === o;

  /** Weighted pick among the domain of cell i; weights get the adjacency (soft) factors of collapsed neighbours. */
  function pick(i, rng) {
    const lo = domLo[i];
    const hi = domHi[i];
    const ex = domEx[i];
    const base = i * NO;
    const x = i % N;
    const z = (i / N) | 0;
    let nJunction = 0; let nForest = 0; let nGrove = 0; let nHills = 0; let nRocks = 0; let nFlow = 0; let nHome = 0; let nHouse = 0; let nVillage = 0; let nLantern = 0; let nPond = 0;
    for (let d = 0; d < 4; d++) {
      const x2 = x + DX[d];
      const z2 = z + DZ[d];
      if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
      const r = res[z2 * N + x2];
      if (r < 0) continue;
      const t = OPT_T[r];
      if (t === T.forest) nForest++;
      else if (t === T.grove) nGrove++;
      else if (t === T.hills) nHills++;
      else if (t === T.rocks) nRocks++;
      else if (t === T.meadow_flowers) nFlow++;
      else if (t === T.house) { nHome++; nHouse++; } else if (IS_HAMLET[t]) { nVillage++; if (t !== T.village_green) nHome++; } else if (t === T.lantern_post) nLantern++;
      else if (t === T.pond) nPond++;
      else if (t === T.path_t || t === T.path_cross) nJunction++;
    }
    // composition pass: neighbours per tile type, landmarks around this cell and in the chunk
    nbT.fill(0); lmSeen.fill(0);
    let nTrees = 0; let nClear = 0; let nClearDiag = 0; let lmTouch = 0; let lmNear = 0;
    for (let d = 0; d < 4; d++) {
      const x2 = x + DX[d]; const z2 = z + DZ[d];
      if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
      const r = res[z2 * N + x2];
      if (r < 0) continue;
      const t = OPT_T[r];
      nbT[t]++;
      if (IS_TREES[t]) nTrees++;
      if (IS_CLEAR[t]) nClear++;
    }
    let mills = 0; let ponds = 0; let ends = 0; let lanterns = 0;
    for (let k = 0; k < NN; k++) {
      if (res[k] < 0) continue;
      if (IS_LM[OPT_T[res[k]]]) {
        lmSeen[OPT_T[res[k]]] = 1;
        const cd = Math.max(Math.abs((k % N) - x), Math.abs(((k / N) | 0) - z));
        if (cd === 1) { lmTouch++; if ((k % N) !== x && ((k / N) | 0) !== z && IS_CLEAR[OPT_T[res[k]]]) nClearDiag++; }
        if (cd <= (cfg.landmarkSpacing ?? 3)) lmNear++;
      }
      const t = OPT_T[res[k]];
      if (t === T.windmill) mills++;
      else if (t === T.pond) ponds++;
      else if (t === T.path_end) ends++;
      else if (t === T.lantern_post) lanterns++;
    }
    let sum = 0;
    for (let o = 0; o < NO; o++) {
      let w = 0;
      if (hasBit(lo, hi, ex, o)) {
        w = W[base + o];
        const t = OPT_T[o];
        // landmarks: one of a kind per chunk, never side by side, spaced out, and not dropped into a tree mass
        if (IS_LM[t]) w *= (lmSeen[t] ? 0 : 1) * (lmTouch ? 0 : 1) * (lmNear ? 0.12 : 1) * (IS_CLEAR[t] && nTrees ? (nTrees > 1 ? 0.05 : 0.3) : 1);
        // ... and the ground beside them is a clearing: no forest / grove / orchard / hill cards against their walls
        if (nClear + nClearDiag > 0) {
          if (IS_TREES[t]) w *= nClear ? 0.03 : 0.35;
          else if (IS_OPEN[t]) w *= 1 + 1.6 * nClear + 0.5 * nClearDiag;
        }
        // one-layout fillers (hills, rocks, dunes, deep pines) must not tile like wallpaper: break up long runs
        if (IS_MASS[t] && nbT[t] >= 1) w *= t === T.deep_pines ? (nbT[t] >= 3 ? 0.25 : nbT[t] === 2 ? 0.5 : 1) : NEW_KIND[t] === 3 ? (nbT[t] >= 2 ? 0.2 : 0.55) : nbT[t] >= 2 ? 0.25 : 1;
        if (IS_OPEN[t] || t === T.grove || t === T.rocks) { const hb = T.hills !== undefined ? nbT[T.hills] : 0; if (hb >= 2 && t !== T.rocks) w *= 1 + 0.9 * hb; }
        // integrator: one-layout settlement tiles do not repeat side by side (hamlet | hamlet, camp | camp, camp | market)
        if (t === T.snow_hamlet || t === T.desert_camp || t === T.desert_market) { if (nbT[t] || (t === T.desert_camp && nbT[T.desert_market]) || (t === T.desert_market && nbT[T.desert_camp])) w *= 0.06; }
        // a village is a short street: never more than two 'village' tiles in a straight run; integrator (round 3): the hamlet
        // family (village / village_b / village_green) may make a run of three, and its variants do not repeat side by side
        if (IS_HAMLET[t] && w > 0) {
          const ax = (PATH_BITS[o] & 5) === 5 ? 0 : 1; // 0: street runs north-south, 1: east-west
          let run = 0; let same = 0;
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            let sameOn = true;
            for (let k = 1; k <= 3; k++) {
              const x2 = ax ? x + sgn * k : x; const z2 = ax ? z : z + sgn * k;
              if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N || res[z2 * N + x2] < 0 || !IS_HAMLET[OPT_T[res[z2 * N + x2]]]) break;
              run++;
              if (sameOn && OPT_T[res[z2 * N + x2]] === t) same++; else sameOn = false;
            }
          }
          if (run >= 3 || (t === T.village && same >= 2)) w = 0;
          else if (t !== T.village && nbT[t]) w *= 0.1;
        }
        if (IS_FILLER[t]) {
          if (t === T.forest) w *= (1 + 0.8 * nForest + 0.3 * nGrove) * (nForest >= 4 ? 0.35 : 1);
          else if (t === T.grove) w *= (1 + 0.45 * nForest) * (nGrove ? 0.6 : 1) * (1 + 0.3 * nHome);
          else if (t === T.hills) w *= (1 + (nHills >= 2 ? 0 : 0.8 * nHills) + 0.3 * nRocks) * (nHills >= 4 ? 0.35 : 1);
          else if (t === T.rocks) w *= (1 + 0.9 * nHills) * (nRocks ? 0.25 : 1);
          else if (t === T.meadow_flowers) w *= 1 + 0.45 * nFlow + 0.6 * nHome;
          else if (t === T.pond) w *= (ponds ? 0.05 : 1) * (nPond ? 0 : 1);
          else if (t === T.windmill) w *= (mills ? 0 : 1) * (nForest + nHills ? 0.3 : 1);
          // never a solid 2x2 block of one scenic tile (keeps clumps irregular; rotation-limited tiles would stamp)
          if (t !== T.meadow && w > 0) {
            for (let k = 0; k < 4; k++) {
              const sx = k & 1 ? 1 : -1;
              const sz = k & 2 ? 1 : -1;
              if (sameOpt(x + sx, z, o) && sameOpt(x, z + sz, o) && sameOpt(x + sx, z + sz, o)) { w *= t === T.meadow_flowers ? 0.25 : t === T.forest || t === T.hills ? 0.03 : 0.01; break; }
            }
          }
        } else if (nJunction && (PATH_BITS[o] & ~trunkMask[i]) && trunkMask[i]) w *= 0.3; // do not stack junctions
        else if (t === T.lantern_post) w *= (nLantern ? 0.08 : 1) * (lanterns >= 2 ? 0.35 : 1) * (1 + 0.5 * nVillage);
        else if (IS_HAMLET[t]) w *= (1 + 1.6 * nVillage + 0.6 * nHouse) * (t === T.village ? 1 : nVillage + nHouse ? 2.2 : 0.3); // variants lean on a village / house
        else if (t === T.house) w *= 1 + 0.5 * nHome;
        else if (t === T.path_end) w *= ends ? 0.1 : 1;
      }
      pickW[o] = w;
      sum += w;
    }
    if (!(sum > 0)) { // all soft factors hit zero: fall back to the plain domain
      sum = 0;
      for (let o = 0; o < NO; o++) { pickW[o] = (hasBit(lo, hi, ex, o)) ? 1 : 0; sum += pickW[o]; }
    }
    let r = rng() * sum;
    let last = -1;
    for (let o = 0; o < NO; o++) {
      if (pickW[o] <= 0) continue;
      last = o;
      r -= pickW[o];
      if (r < 0) return o;
    }
    return last;
  }

  function setSingle(i, o) {
    domLo[i] = o < 32 ? 1 << o : 0; domHi[i] = o >= 32 && o < 64 ? 1 << (o - 32) : 0; domEx[i] = o >= 64 ? 1 << (o - 64) : 0;
    entOk[i] = 0;
  }
  const singleOf = (i) => (domLo[i] ? 31 - Math.clz32(domLo[i]) : domHi[i] ? 63 - Math.clz32(domHi[i]) : 95 - Math.clz32(domEx[i]));
  const inDom = (i, o) => hasBit(domLo[i], domHi[i], domEx[i], o);

  /** One WFC run over the planned chunk. Returns false when the backtrack budget is exhausted. */
  function solve(rng, isOrigin) {
    // initial domains from the pre-decided sockets and banned (zero weight) options
    qHead = qTail = 0;
    inQueue.fill(0);
    for (let i = 0; i < NN; i++) {
      let lo = -1;
      let hi = HI_ALL;
      let ex = EX_ALL;
      for (let d = 0; d < 4; d++) {
        const q = req[i * 4 + d];
        if (q < 0) { lo &= MASK_LO[d * 3 + G] | MASK_LO[d * 3 + P]; hi &= MASK_HI[d * 3 + G] | MASK_HI[d * 3 + P]; ex &= MASK_EX[d * 3 + G] | MASK_EX[d * 3 + P]; } else { lo &= MASK_LO[d * 3 + q]; hi &= MASK_HI[d * 3 + q]; ex &= MASK_EX[d * 3 + q]; }
      }
      for (let o = 0; o < NO; o++) if (!(W[i * NO + o] > 0)) { if (o < 32) lo &= ~(1 << o); else if (o < 64) hi &= ~(1 << (o - 32)); else ex &= ~(1 << (o - 64)); }
      if ((lo | hi | ex) === 0) return false;
      domLo[i] = lo; domHi[i] = hi; domEx[i] = ex; res[i] = -1; entOk[i] = 0;
      enqueue(i);
    }
    if (isOrigin) {
      for (const [x, z, key] of ORIGIN_FIXED) {
        const i = (z + OZ) * N + x + OX;
        const o = OPT_BY.get(key);
        if (o === undefined || !inDom(i, o)) return false;
        setSingle(i, o);
      }
    }
    if (!propagate()) return false;

    let depth = 0;
    let backtracks = 0;
    for (;;) {
      let best = -1;
      let bestE = Infinity;
      for (let i = 0; i < NN; i++) {
        if (res[i] >= 0) continue;
        if (popcnt(domLo[i]) + popcnt(domHi[i]) + popcnt(domEx[i]) === 1) { res[i] = singleOf(i); continue; } // decided by propagation
        if (!entOk[i]) { ent[i] = entropy(i, rng); entOk[i] = 1; }
        if (ent[i] < bestE) { bestE = ent[i]; best = i; }
      }
      if (best < 0) return true;
      // observe: push a frame, collapse the lowest-entropy cell
      stLo.set(domLo, depth * NN);
      stHi.set(domHi, depth * NN);
      stEx.set(domEx, depth * NN);
      stRes.set(res, depth * NN);
      const o = pick(best, rng);
      stCell[depth] = best;
      stOpt[depth] = o;
      depth++;
      setSingle(best, o);
      res[best] = o;
      enqueue(best);
      let ok = propagate();
      if (_fault && ok && rng() < _fault) ok = false; // test hook: pretend this pick was a contradiction
      while (!ok) {
        // contradiction: undo the newest decision, ban it, try again from there
        stats.backtracks++;
        if (++backtracks > cfg.maxBacktracks || depth === 0) return false;
        depth--;
        domLo.set(stLo.subarray(depth * NN, depth * NN + NN));
        domHi.set(stHi.subarray(depth * NN, depth * NN + NN));
        domEx.set(stEx.subarray(depth * NN, depth * NN + NN));
        res.set(stRes.subarray(depth * NN, depth * NN + NN));
        entOk.fill(0);
        const c = stCell[depth];
        const b = stOpt[depth];
        if (b < 32) domLo[c] &= ~(1 << b); else if (b < 64) domHi[c] &= ~(1 << (b - 32)); else domEx[c] &= ~(1 << (b - 64));
        if ((domLo[c] | domHi[c] | domEx[c]) === 0) { ok = false; continue; }
        enqueue(c);
        ok = propagate();
      }
    }
  }

  // ------------------------------------------------------------ validation of a solved chunk
  function validate() {
    // 1. every path cell hangs on the trunk road (no orphan lanes / house pairs)
    seen.fill(0);
    let qh = 0;
    let qt = 0;
    let any = false;
    for (let i = 0; i < NN; i++) if (trunkMask[i]) { seen[i] = 1; bfs[qt++] = i; any = true; }
    while (qh < qt) {
      const i = bfs[qh++];
      const pb = PATH_BITS[res[i]];
      for (let d = 0; d < 4; d++) {
        if (!(pb & BIT[d])) continue;
        const x2 = (i % N) + DX[d];
        const z2 = ((i / N) | 0) + DZ[d];
        if (x2 < 0 || z2 < 0 || x2 >= N || z2 >= N) continue;
        const j = z2 * N + x2;
        if (!seen[j]) { seen[j] = 1; bfs[qt++] = j; }
      }
    }
    let ends = 0;
    for (let i = 0; i < NN; i++) {
      if (PATH_BITS[res[i]] && !seen[i]) { stats.vOrphan++; return false; }
      if (OPT_T[res[i]] === T.path_end) ends++;
    }
    if (ends > 1 || (!any && ends > 0)) { stats.vEnds++; return false; }
    // 2. straight runs of path / river (cells crossed straight through), per axis
    for (let axis = 0; axis < 2; axis++) {
      const dA = axis === 0 ? 0 : 3; // n / w side
      const dB = axis === 0 ? 2 : 1; // s / e side
      for (let s = 1; s <= 2; s++) {
        for (let a = 0; a < N; a++) {
          let run = 0;
          let fromBorder = false;
          for (let b = 0; b < N; b++) {
            const i = axis === 0 ? b * N + a : a * N + b;
            const o = res[i];
            if (SIG[o * 4 + dA] === s && SIG[o * 4 + dB] === s) {
              if (run === 0) fromBorder = b === 0;
              run++;
              const lim = fromBorder || b === N - 1 ? cfg.maxBorderRun : cfg.maxInnerRun;
              if (run > lim) { stats.vRun++; return false; }
            } else run = 0;
          }
        }
      }
    }
    return true;
  }

  // ------------------------------------------------------------ chunk generation
  function stubFill(X) {
    // guaranteed-valid last resort: terminate every crossing where it enters, meadow elsewhere
    res.fill(FALLBACK_OPT);
    const key = (id, out, code) => { const s = [0, 0, 0, 0]; s[out] = code; return id + ':' + s.join(''); };
    for (const r of X.rivers) res[r.cell] = OPT_BY.get(key('river_source', r.out, R));
    for (const r of X.roads) res[r.cell] = OPT_BY.get(key('path_end', r.out, P));
  }

  function generate(cx, cz) {
    const isOrigin = cx === 0 && cz === 0;
    originChunk = isOrigin;
    const X = crossings(cx, cz);
    computeFields(cx, cz);
    let done = false;
    let attempt = 0;
    for (; attempt < cfg.maxAttempts && !done; attempt++) {
      stats.attempts++;
      const rng = mulberry(hash2(cx, cz, (seed * 31 + attempt * 7919 + 17) | 0));
      const strict = attempt >= cfg.maxAttempts - cfg.strictAttempts;
      if (!plan(cx, cz, X, rng, isOrigin, attempt)) { stats.planFails++; continue; }
      computeWeights(strict);
      if (!solve(rng, isOrigin)) { stats.restarts++; continue; }
      if (!validate()) { stats.validateFails++; continue; }
      done = true;
      if (strict) stats.strictChunks++;
    }
    if (!done) { stubFill(X); stats.fallbackChunks++; }
    const cells = new Array(NN);
    for (let i = 0; i < NN; i++) {
      const opt = OPTIONS[res[i]];
      const x = cx * N + (i % N) - OX;
      const z = cz * N + ((i / N) | 0) - OZ;
      const rot = opt.rots.length === 1 ? opt.rots[0] : opt.rots[hash2(x, z, seed + 77) % opt.rots.length];
      cells[i] = Object.freeze({ x, z, tileId: opt.tileId, model: opt.tile.model, rot, sockets: socketsOf(opt.tileId, rot), tags: opt.tile.tags, biome: BIOMES[cBiome[i]] });
    }
    stats.chunks++;
    return { cells, attempts: attempt, fallback: !done };
  }

  const keyOf = (cx, cz) => (cx + 4194304) * 8388608 + (cz + 4194304);

  function chunkAt(cx, cz) {
    const key = keyOf(cx, cz);
    if (key === lastKey) return lastChunk;
    let ch = chunks.get(key);
    if (!ch) {
      ch = generate(cx, cz);
      chunks.set(key, ch);
      if (chunks.size > cfg.maxChunks) { // evict the oldest; it regenerates identically on demand
        chunks.delete(chunks.keys().next().value);
        stats.evicted++;
      }
    }
    lastKey = key;
    lastChunk = ch;
    return ch;
  }

  const sane = (v) => {
    if (!(v >= -COORD_LIMIT && v <= COORD_LIMIT)) v = v > COORD_LIMIT ? COORD_LIMIT : v < -COORD_LIMIT ? -COORD_LIMIT : 0;
    return Math.round(v);
  };

  let fallbackProto = null;
  const fallbackCell = (x, z) => {
    const t = fallbackProto || (fallbackProto = getTile(FALLBACK_TILE));
    return Object.freeze({ x, z, tileId: t.id, model: t.model, rot: 0, sockets: socketsOf(t.id, 0), tags: t.tags, biome: biomeAt(seed, x, z) });
  };

  return {
    seed,
    /** Collapsed cell (collapsing its chunk on demand). Always returns a valid cell; never throws. O(1) once collapsed. */
    get(x, z) {
      if ((x | 0) !== x || (z | 0) !== z || x > COORD_LIMIT || x < -COORD_LIMIT || z > COORD_LIMIT || z < -COORD_LIMIT) { x = sane(+x); z = sane(+z); }
      const gx = x + OX;
      const gz = z + OZ;
      const cx = gx >> 3;
      const cz = gz >> 3;
      const ch = keyOf(cx, cz) === lastKey ? lastChunk : chunkAt(cx, cz);
      return ch.cells[(gz & 7) * N + (gx & 7)] || fallbackCell(x, z);
    },
    /** Like get() but returns null if the cell has not been collapsed yet (no side effects). */
    peek(x, z) {
      x = sane(+x); z = sane(+z);
      const gx = x + OX;
      const gz = z + OZ;
      const ch = chunks.get(keyOf(gx >> 3, gz >> 3));
      return ch ? ch.cells[(gz & 7) * N + (gx & 7)] : null;
    },
    /** Make sure every cell within r cells (Chebyshev) of (cx,cz) is collapsed. */
    ensureRegion(cx, cz, r) {
      cx = sane(+cx); cz = sane(+cz);
      const Rr = Math.min(4096, Math.max(0, Math.ceil(+r || 0)));
      const c0x = (cx - Rr + OX) >> 3;
      const c1x = (cx + Rr + OX) >> 3;
      const c0z = (cz - Rr + OZ) >> 3;
      const c1z = (cz + Rr + OZ) >> 3;
      for (let z = c0z; z <= c1z; z++) for (let x = c0x; x <= c1x; x++) chunkAt(x, z);
    },
    get size() { return chunks.size * NN; },
    /** Solver counters (checks / debugging): chunks, attempts, backtracks, restarts, fallbackChunks, ... */
    stats,
    chunkSize: N,
    /** Debug: how the chunk holding cell (x,z) was solved ({ attempts, fallback }). */
    chunkInfo(x, z) {
      const ch = chunkAt((sane(+x) + OX) >> 3, (sane(+z) + OZ) >> 3);
      const cx = (sane(+x) + OX) >> 3;
      const cz = (sane(+z) + OZ) >> 3;
      return { cx, cz, attempts: ch.attempts, fallback: ch.fallback, crossings: crossings(cx, cz) };
    },
  };
}
