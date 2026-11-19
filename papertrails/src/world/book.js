// OWNER: world agent. The endless open pop-up book (contract: docs/ARCHITECTURE.md, world/book.js).
//
// Design ("book window", logged in docs/LOG.md under world-book):
//  * The book is ONE finite object - a page spread (gutterPeriod tiles wide), a stacked page block, a cover
//    board - lying on a dark table. It follows the traveller with a small dead zone, so it always frames the
//    walk, while everything printed on it stays fixed in the world (the print scrolls under the margins).
//  * Gutters are fixed world X lines every gutterPeriod tiles. The window is exactly one period wide, so
//    there is always exactly one gutter valley on the spread; walking east/west turns to the next spread.
//  * The page is a single quad-strip with a "tile-map" shader: a 16x16 data texture (model, rot, twin, ink
//    per cell) indexes a texture ARRAY of top-down bakes of every tile model: layer 2i = the base print,
//    layer 2i+1 = the tile with every flap folded flat ("printed twin"). The bakes are rendered once from
//    the real tile prototypes (placeholder or glTF), so a tile that appears flat on the page is identical
//    to the print it covers: nothing pops when tiles spawn, rise or fold away.
//  * Biome pass: byte G of the cell data also carries the cell's biome (bits 2-4); the printed colour goes through
//    the per-biome transform of CONFIG.world.biomeTint, blended across biome borders (heartland = identity).
//  * Un-risen cells are a faded offset print; a cell "inks in" shortly before its tile rises.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { MODELS, MODEL_IDS, FALLBACK_MODEL } from '../core/models.js';
import { createFoldInstance } from './fold.js';
import { isThinned } from './cards.js';
import { BIOMES, BIOME_INDEX } from '../core/biomes.js';
import { state } from '../core/state.js';
import { waterKind, waterConfig, waterUniforms, waterGLSL, groundBodyGLSL, waterBodyGLSL, WATER_GLOW_GLSL, WATER_MIRROR_GLSL, REFLECT, BAKE_COPY_FRAG } from '../render/water.js';

const GRID = 32; // cell-data torus (the page is at most 30 cells across)
const SHIFT = 5;
const MASK = GRID - 1;
const NONE = 0x7fffffff;

// ---- biome pass: per-biome colour transform (CONFIG.world.biomeTint), shared by the page and the tile batches ----
const NB = BIOMES.length;
/** GLSL: affine colour transform (r0..r2 = matrix rows, offset in .w); k = how much of teal / blue water is kept. */
export const BIOME_TINT_GLSL = /* glsl */ `
vec3 biomeTint(vec3 c, vec4 r0, vec4 r1, vec4 r2, float k) {
  vec3 t = max(vec3(dot(r0.xyz, c) + r0.w, dot(r1.xyz, c) + r1.w, dot(r2.xyz, c) + r2.w), 0.0);
  // look pass: very dark printed / cut pieces (wood posts, trunks, ink lines) keep their own colour, so a pale
  // biome tint cannot wash them into ghosts (snow lantern post). Only active for non-identity transforms (k > 0).
  float dk = (1.0 - smoothstep(0.05, 0.2, dot(c, vec3(0.2126, 0.7152, 0.0722)))) * step(0.001, k);
  return mix(t, c, max(smoothstep(0.03, 0.14, min(c.g, c.b) - c.r) * k, dk * 0.85));
}
// the printed ground: no dark-keep (the inked grass ticks of the shared tiles must sink into snow / sand)
vec3 biomeTintGround(vec3 c, vec4 r0, vec4 r1, vec4 r2, float k) {
  vec3 t = max(vec3(dot(r0.xyz, c) + r0.w, dot(r1.xyz, c) + r1.w, dot(r2.xyz, c) + r2.w), 0.0);
  return mix(t, c, smoothstep(0.03, 0.14, min(c.g, c.b) - c.r) * k);
}
`;
const _tintCache = {};
/**
 * Uniform values of one transform kind ('ground' | 'prop') for every biome, in BIOMES order:
 * { rows: Vector4[NB * 3], keep: number[NB], count: NB }. Built once from CONFIG.world.biomeTint (see there for the
 * meaning of hue / sat / tint / amount / gain / lift / mul / keepWater). heartland / missing = exact identity.
 */
export function biomeTintUniforms(kind) {
  if (_tintCache[kind]) return _tintCache[kind];
  const table = (CONFIG.world.biomeTintEnabled !== false && CONFIG.world.biomeTint) || {};
  const rows = []; const keep = [];
  const L = [0.2126, 0.7152, 0.0722];
  const col = new THREE.Color();
  for (let b = 0; b < NB; b++) {
    const t = (BIOMES[b] !== 'heartland' && table[BIOMES[b]] && table[BIOMES[b]][kind]) || {};
    const amount = +t.amount || 0; const sat = t.sat === undefined ? 1 : +t.sat; const mul = t.mul === undefined ? 1 : +t.mul;
    const gain = t.gain === undefined ? 1 : +t.gain; const lift = +t.lift || 0; const hue = ((+t.hue || 0) * Math.PI) / 180;
    col.set(t.tint || '#ffffff'); // sRGB hex -> linear working space
    const tint = [col.r, col.g, col.b];
    // hue rotation about the luma axis (the SVG hueRotate matrix), then saturation
    const c = Math.cos(hue); const sn = Math.sin(hue);
    const H = [
      [0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928],
      [0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.140, 0.072 - c * 0.072 - sn * 0.283],
      [0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072],
    ];
    const identity = !amount && sat === 1 && mul === 1 && !hue;
    for (let i = 0; i < 3; i++) {
      const row = new THREE.Vector4(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, 0);
      if (!identity) {
        for (let j = 0; j < 3; j++) {
          let sh = 0; // (S * H)[i][j], S = sat * I + (1 - sat) * 1 (x) L
          for (let k = 0; k < 3; k++) sh += ((i === k ? sat : 0) + (1 - sat) * L[k]) * H[k][j];
          row.setComponent(j, mul * ((1 - amount) * sh + amount * tint[i] * gain * L[j]));
        }
        row.w = mul * amount * tint[i] * lift;
      }
      rows.push(row);
    }
    keep.push(identity ? 0 : Math.min(1, Math.max(0, +t.keepWater || 0)));
  }
  return (_tintCache[kind] = { rows, keep, count: NB });
}
/** Per-biome path print override (CONFIG.world.biomeTint[b].path = { color, edge, amount, edgeAmount }): Vector4[NB] x 2. */
export function biomePathUniforms() {
  if (_tintCache.__path) return _tintCache.__path;
  const table = (CONFIG.world.biomeTintEnabled !== false && CONFIG.world.biomeTint) || {};
  const tone = []; const edge = [];
  const col = new THREE.Color();
  for (let b = 0; b < NB; b++) {
    const t = (BIOMES[b] !== 'heartland' && table[BIOMES[b]] && table[BIOMES[b]].path) || null;
    if (!t) { tone.push(new THREE.Vector4(1, 1, 1, 0)); edge.push(new THREE.Vector4(0, 0, 0, 0)); continue; }
    col.set(t.color || '#ffffff'); tone.push(new THREE.Vector4(col.r, col.g, col.b, t.amount === undefined ? 1 : +t.amount));
    col.set(t.edge || t.color || '#000000'); edge.push(new THREE.Vector4(col.r, col.g, col.b, +t.edgeAmount || 0));
  }
  return (_tintCache.__path = { tone, edge });
}
/** Biome index stored in the cell-data texture / the batch instance colour. */
export const biomeIndexOf = (cell) => (cell && BIOME_INDEX[cell.biome]) || 0;

/** GLSL shared by page + page block: height of the gutter valley at local (x,z); y = local height (0 = page top). */
const GUTTER_GLSL = /* glsl */ `
uniform vec4 uGut;  // x: gutter x (book-local), y: half width, z: depth on the print area, w: depth at head/tail
uniform vec4 uGut2; // x: fade (0 near a fore-edge), y: shade, z: page curve, w: page curve width
uniform vec4 uBk;   // x: half width, y: half depth, z: margin, w: faded ink
float gutterEdge(float z) { return smoothstep(uBk.y - uBk.z * 1.6, uBk.y - uBk.z * 0.2, abs(z)); }
float gutterDx(float x) { const float GP = ${(CONFIG.book.gutterPeriod * TILE_SIZE).toFixed(1)}; return mod(x - uGut.x + GP * 0.5, GP) - GP * 0.5; }
float gutterH(vec2 p, float y) {
  float e = gutterEdge(p.y);
  float hw = uGut.y * (1.0 + 0.7 * e);
  float a = clamp(1.0 - abs(gutterDx(p.x)) / hw, 0.0, 1.0);
  float k = clamp(1.0 + y / ${(CONFIG.book.blockThickness).toFixed(4)}, 0.0, 1.0);
  return -mix(uGut.z, uGut.w, e) * a * a * uGut2.x * k;
}
`;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Small deterministic PRNG for procedural fallback textures / geometry jitter (no Math.random in the app). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Procedural page fibre (tileable): grey tooth + clouding + short fibres. Used when no texture set is loaded. */
function fibreFallback() {
  const N = 512;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const rnd = lcg(1234);
  const img = g.createImageData(N, N);
  // two octaves of value noise (tileable) + per-pixel tooth
  const cells = [8, 37];
  const grids = cells.map((n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; });
  const sample = (gi, u, v) => {
    const n = cells[gi]; const a = grids[gi];
    const x = u * n; const y = v * n;
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    const fx = x - x0; const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
    const i = (xx, yy) => a[((yy % n + n) % n) * n + ((xx % n + n) % n)];
    return (i(x0, y0) * (1 - sx) + i(x0 + 1, y0) * sx) * (1 - sy) + (i(x0, y0 + 1) * (1 - sx) + i(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N; const v = y / N;
      const val = 0.80 + (sample(0, u, v) - 0.5) * 0.07 + (sample(1, u, v) - 0.5) * 0.06 + (rnd() - 0.5) * 0.085;
      const b = Math.max(0, Math.min(255, Math.round(val * 255)));
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // fibres: short curved strokes, lighter and darker, wrapped
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * N; const y = rnd() * N;
    const a = rnd() * Math.PI * 2; const len = 5 + rnd() * 20; const bend = (rnd() - 0.5) * 9;
    const light = rnd() < 0.62;
    g.strokeStyle = light ? `rgba(255,252,240,${0.07 + rnd() * 0.16})` : `rgba(96,70,44,${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * 0.8;
    for (let ox = -N; ox <= N; ox += N) {
      for (let oy = -N; oy <= N; oy += N) {
        if (x + ox < -30 || x + ox > N + 30 || y + oy < -30 || y + oy > N + 30) continue;
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + oy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        g.stroke();
      }
    }
  }
  return c;
}

/** Procedural stacked-sheet lines for the page-block edges (tileable along u). */
function sheetLinesFallback() {
  const W = 1024; const H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = lcg(77);
  g.fillStyle = '#e9dcc0';
  g.fillRect(0, 0, W, H);
  // sheets: bands of slightly different cream, separated by irregular dark gaps
  let y = 0;
  while (y < H) {
    const h = 3 + rnd() * 7;
    const tone = 205 + Math.floor(rnd() * 40);
    const k1 = 1 + Math.floor(rnd() * 3); const k2 = 3 + Math.floor(rnd() * 5);
    const p1 = rnd() * 6.28; const p2 = rnd() * 6.28; const amp = 0.4 + rnd() * 1.6;
    const gap = rnd() < 0.3 ? 1.6 + rnd() * 1.4 : 0.8 + rnd() * 0.6;
    const dark = 0.25 + rnd() * 0.45;
    for (let x = 0; x < W; x += 4) {
      const wob = Math.sin((x / W) * 6.2832 * k1 + p1) * amp + Math.sin((x / W) * 6.2832 * k2 + p2) * amp * 0.4;
      g.fillStyle = `rgb(${tone + 8},${tone},${tone - 26})`;
      g.fillRect(x, y + wob, 4, h + 1);
      g.fillStyle = `rgba(92,62,40,${dark})`;
      g.fillRect(x, y + wob + h - gap, 4, gap);
      g.fillStyle = 'rgba(255,250,236,0.35)';
      g.fillRect(x, y + wob, 4, 0.8);
    }
    y += h;
  }
  // tooth
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Procedural dark warm table (tileable): umber with soft long grain. */
function tableFallback() {
  const N = 512;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const rnd = lcg(4242);
  g.fillStyle = '#6a4630';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {
    const y = rnd() * N; const x = rnd() * N; const len = 60 + rnd() * 300;
    g.strokeStyle = rnd() < 0.5 ? `rgba(30,16,8,${0.05 + rnd() * 0.12})` : `rgba(150,100,62,${0.03 + rnd() * 0.07})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    for (let ox = -N; ox <= N; ox += N) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.bezierCurveTo(x + ox + len * 0.3, y + (rnd() - 0.5) * 5, x + ox + len * 0.7, y + (rnd() - 0.5) * 5, x + ox + len, y + (rnd() - 0.5) * 3);
      g.stroke();
    }
  }
  return c;
}

function canvasTexture(canvas, srgb, aniso = 8) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Mean luma (0..1, as stored) of a texture image; 0.8 if it cannot be read. */
function imageMean(tex) {
  try {
    const img = tex.image;
    if (!img || !(img.width > 0)) return 0.8;
    const c = makeCanvas(32, 32);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return Math.max(0.05, s / (d.length / 4) / 255);
  } catch { return 0.8; }
}

export function createBook({ scene, assets, wfc, materials, quality }) {
  const B = CONFIG.book;
  const palette = CONFIG.palette || {};
  const HW = B.pageHalfExtent; // the page reaches past the lit area on every side: no visible edge ("endless" book)
  const HD = B.halfDepth;
  const T = B.blockThickness;
  const PERIOD = B.gutterPeriod * TILE_SIZE;
  const cream = new THREE.Color(palette.paper || '#efe0c2');

  const group = new THREE.Group();
  group.name = 'book';
  scene.add(group);

  // ---- model -> atlas layer ----------------------------------------------------------------------
  const modelIds = (assets && assets.modelIds && assets.modelIds.length ? assets.modelIds : MODEL_IDS).slice(0, 120);
  if (!modelIds.includes(FALLBACK_MODEL)) modelIds.push(FALLBACK_MODEL);
  // integrator (quality pass): desert / snow hide the heartland-only stand-ups of the generic tiles (world.js cullFor), so
  // their folded-flat print must not show them either (a printed tree that vanished as the tile rose). Models that occur
  // in desert / snow come FIRST (index < VAR_N) and get one extra layer: 2 N + i = the twin without those pieces.
  // Layers 2 N + VAR_N / + 1 = the meadow twin without its hay rick / meadow_flowers without its beehive (world.js hayHidden).
  const DRY_RX = /^(tree|flowers|haystack|scarecrow|hedge|beehive|bush)/;
  const hasDry = (id) => { const m = MODELS[id]; const b = m && m.biomes; return !!m && (!b || b.desert > 0 || b.snow > 0) && !(b && Object.keys(b).length === 1 && !b.heartland); };
  // round 3: desert also hides the fences of the generic tiles (world.js cullBiome class 2), so those models get one more
  // folded-flat twin without them: they come first of all (index < FEN_N), layer 2 N + VAR_N + 2 + i.
  const FENCE_RX = /^(tree|flowers|haystack|scarecrow|hedge|beehive|bush|fence)/;
  const hasFence = (id) => {
    const m = MODELS[id]; const b = m && m.biomes;
    if (!hasDry(id) || (b && !(b.desert > 0)) || CONFIG.world.biomeCull === false) return false;
    try { const t = assets.getTilePrototype(id); let f = false; t.traverse((o) => { if (/^fence/.test(String(o.name || '').replace(/^.*__/, ''))) f = true; }); return f; } catch (err) { return false; }
  };
  const fenceSet = new Set(modelIds.filter(hasFence));
  modelIds.sort((p, q) => (fenceSet.has(q) ? 2 : hasDry(q) ? 1 : 0) - (fenceSet.has(p) ? 2 : hasDry(p) ? 1 : 0));
  const FEN_N = fenceSet.size;
  const VAR_N = CONFIG.world.biomeCull === false ? 0 : modelIds.filter(hasDry).length;
  const hayHidden = (cx, cz) => ((Math.imul(cx * 73856093 ^ cz * 19349663 ^ 0x5bd1e995, 2654435761) >>> 9) % 100) < (CONFIG.world.hayDrop ?? 60); // same hash as world.js
  const modelIndex = new Map();
  modelIds.forEach((id, i) => modelIndex.set(id, i));
  const fallbackIndex = modelIndex.get(FALLBACK_MODEL) || 0;

  // ---- per-cell state (torus) --------------------------------------------------------------------
  const kx = new Int32Array(GRID * GRID).fill(NONE);
  const kz = new Int32Array(GRID * GRID).fill(NONE);
  const ink = new Float32Array(GRID * GRID);
  const twin = new Float32Array(GRID * GRID);
  const mark = new Uint8Array(GRID * GRID);
  const hold = new Uint8Array(GRID * GRID);
  const data = new Uint8Array(GRID * GRID * 4);
  const cellTex = new THREE.DataTexture(data, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
  cellTex.minFilter = cellTex.magFilter = THREE.NearestFilter;
  cellTex.wrapS = cellTex.wrapT = THREE.RepeatWrapping;
  cellTex.generateMipmaps = false;
  cellTex.needsUpdate = true;

  function slot(cx, cz) {
    const i = ((cz & MASK) << SHIFT) | (cx & MASK);
    if (kx[i] !== cx || kz[i] !== cz) {
      kx[i] = cx; kz[i] = cz;
      const cell = wfc.get(cx, cz);
      const mi = modelIndex.get(cell.model);
      data[i * 4] = mi === undefined ? fallbackIndex : mi;
      // bits 0-1 rot, bits 2-4 biome, bit 5 = the tile carries a printed road (look pass: per-biome path tone)
      data[i * 4 + 1] = (((cell.rot % 4) + 4) % 4) | (biomeIndexOf(cell) << 2) | (cell.tags && cell.tags.includes('path') ? 32 : 0)
        | (mi !== undefined && mi < FEN_N && cell.biome === 'desert' ? 192 : mi !== undefined && mi < VAR_N && (cell.biome === 'desert' || cell.biome === 'snow') ? 64 : VAR_N && (cell.model === 'meadow' || cell.model === 'meadow_flowers') && hayHidden(cx, cz) ? 128 : 0);
      ink[i] = 0; twin[i] = 1; mark[i] = 0; hold[i] = 0;
      data[i * 4 + 2] = 255; data[i * 4 + 3] = 0;
      cellTex.needsUpdate = true;
    }
    return i;
  }

  // ---- textures ----------------------------------------------------------------------------------
  const tx = (assets && assets.textures) || {};
  const man = (tx.manifest && typeof tx.manifest === 'object' && !tx.manifest.isTexture) ? tx.manifest : {};
  const pick = (name) => (tx[name] && tx[name].isTexture ? tx[name] : null);
  let fibreTex = pick('pagePaper');
  let fibreNormalTex = fibreTex ? pick('pagePaperNormal') : null;
  let ownFibre = null;
  if (!fibreTex) { fibreTex = ownFibre = canvasTexture(fibreFallback(), false); fibreNormalTex = null; }
  const fibreMean = imageMean(fibreTex);
  const fibreScale = (!ownFibre && man.pagePaper && man.pagePaper.repeat) || B.fibreScale;
  const fibreScale2 = (!ownFibre && man.pagePaper && man.pagePaper.repeat2) || fibreScale * 2.9;
  let sheetTex = pick('edgeStrip');
  let ownSheet = null;
  // v range of the stacked-sheet band in the edge texture (top of the block .. bottom) and world units per u repeat
  let sheetV = [0.99, 0.325];
  let sheetU = (man.edgeStrip && man.edgeStrip.repeat) || 2;
  if (!sheetTex) { sheetTex = ownSheet = canvasTexture(sheetLinesFallback(), true); sheetV = [0.98, 0.3]; sheetU = 3.2; }
  let tableTex = pick('table');
  let ownTable = null;
  const tableScale = (tableTex && man.table && man.table.repeat) || B.tableScale;
  if (!tableTex) tableTex = ownTable = canvasTexture(tableFallback(), true);

  // ---- baked print atlas (texture array) ---------------------------------------------------------
  const bakeSize = (B.bakeSize && B.bakeSize[quality]) || 512;
  const layers = modelIds.length * 2 + (VAR_N ? VAR_N + 2 + FEN_N : 0);
  const atlas = new THREE.WebGLArrayRenderTarget(bakeSize, bakeSize, layers, { depthBuffer: false });
  atlas.texture.colorSpace = THREE.SRGBColorSpace;
  atlas.texture.generateMipmaps = true;
  atlas.texture.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.texture.magFilter = THREE.LinearFilter;
  atlas.texture.wrapS = atlas.texture.wrapT = THREE.ClampToEdgeWrapping;
  atlas.texture.anisotropy = 8;
  let baked = false;

  function bake(renderer) {
    baked = true;
    const ms = new THREE.WebGLRenderTarget(bakeSize, bakeSize, { samples: 4, depthBuffer: true });
    ms.texture.colorSpace = THREE.SRGBColorSpace;
    ms.texture.minFilter = ms.texture.magFilter = THREE.LinearFilter;
    ms.texture.generateMipmaps = false;
    const bakeScene = new THREE.Scene();
    bakeScene.add(new THREE.AmbientLight(0xffffff, Math.PI)); // irradiance * albedo / PI => pure albedo
    const cam = new THREE.OrthographicCamera(-TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2, -TILE_SIZE / 2, 0.1, 20);
    cam.position.set(0, 10, 0);
    cam.up.set(0, 0, -1); // north (-Z) at the top of the image
    cam.lookAt(0, 0, 0);
    const copyScene = new THREE.Scene();
    const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyMat = new THREE.ShaderMaterial({
      // gold pass (water): alpha of a water tile's base print = blurred water mask (see render/water.js)
      uniforms: { t: { value: ms.texture }, uWk: { value: new THREE.Vector4(0, 0.5, 0.5, 0) }, uR: { value: waterConfig().shoreBlur } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BAKE_COPY_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    quad.frustumCulled = false;
    copyScene.add(quad);

    const prevRT = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;
    const prevTone = renderer.toneMapping;
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.xr.enabled = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(cream, 0);
    try {
      for (let i = 0; i < modelIds.length; i++) {
        let tile = null;
        const hinges = [];
        const thinOff = [];
        try {
          tile = assets.getTilePrototype(modelIds[i]).clone(true);
          tile.position.set(0, 0, 0);
          tile.rotation.set(0, 0, 0);
          const fold = createFoldInstance(tile, { tileId: modelIds[i] });
          fold.snap(0);
          tile.traverse((o) => { if (o.userData && o.userData.hinge) hinges.push(o); });
          // shortfall pass: soft filler cards that never stand (cards.js isThinned, same rule as world.js) are left out of every twin
          for (const c of tile.children) if (isThinned(modelIds[i], String(c.name || '').replace(/^.*__/, ''))) thinOff.push(c);
        } catch (err) {
          console.warn('[book] could not bake tile', modelIds[i], err);
        }
        if (tile) bakeScene.add(tile);
        for (let pass = 0; pass < 2; pass++) {
          for (const h of hinges) h.visible = pass === 1;
          for (const c of thinOff) c.visible = false;
          const wkd = pass === 0 ? waterKind(modelIds[i]) : null;
          if (wkd && wkd.kind) copyMat.uniforms.uWk.value.set(wkd.kind === 6 ? 2 : 1, 0.5 + (wkd.disc ? wkd.disc[0] : 0) / TILE_SIZE, 0.5 - (wkd.disc ? wkd.disc[1] : 0) / TILE_SIZE, wkd.disc ? wkd.disc[2] / TILE_SIZE : 0);
          else copyMat.uniforms.uWk.value.set(0, 0.5, 0.5, 0);
          renderer.setRenderTarget(ms);
          renderer.render(bakeScene, cam);
          renderer.setRenderTarget(atlas, i * 2 + pass);
          renderer.render(copyScene, copyCam);
        }
        // variant twins (see VAR_N): pass 0 = without the heartland-only stand-ups, pass 1 (meadow) = without the hay rick
        if (tile && i < VAR_N) {
          const base = (o) => String(o.name || '').replace(/^.*__/, '').replace(/_x[bf]$/, '');
          copyMat.uniforms.uWk.value.set(0, 0.5, 0.5, 0);
          for (let pass = 0; pass < 3; pass++) {
            if (pass === 1 && !(modelIds[i] === 'meadow' || modelIds[i] === 'meadow_flowers')) continue;
            if (pass === 2 && i >= FEN_N) continue; // round 3: the desert twin (no fences either)
            const rx = pass === 0 ? DRY_RX : pass === 1 ? /^(haystack|beehive)/ : FENCE_RX;
            const off = [];
            for (const h of hinges) h.visible = true;
            for (const c of thinOff) c.visible = false;
            tile.traverse((o) => { if (o.visible && rx.test(base(o))) { o.visible = false; off.push(o); } });
            renderer.setRenderTarget(ms);
            renderer.render(bakeScene, cam);
            renderer.setRenderTarget(atlas, modelIds.length * 2 + (pass === 0 ? i : pass === 2 ? VAR_N + 2 + i : VAR_N + (modelIds[i] === 'meadow' ? 0 : 1)));
            renderer.render(copyScene, copyCam);
            for (const o of off) o.visible = true;
          }
        }
        if (tile) bakeScene.remove(tile);
      }
    } finally {
      renderer.setRenderTarget(prevRT, prevFace, prevMip);
      renderer.autoClear = prevAutoClear;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.xr.enabled = prevXr;
      renderer.toneMapping = prevTone;
      renderer.setClearColor(prevColor, prevAlpha);
      ms.dispose();
      copyMat.dispose();
      quad.geometry.dispose();
    }
  }

  // ---- shared uniforms ---------------------------------------------------------------------------
  const U = {
    uAtlas: { value: atlas.texture },
    uCells: { value: cellTex },
    uFibre: { value: fibreTex },
    uFibreN: { value: fibreNormalTex || fibreTex },
    uOff: { value: new THREE.Vector4() },
    uAnchorMod: { value: new THREE.Vector2() },
    uBk: { value: new THREE.Vector4(HW, HD, B.margin, B.fadedInk) },
    uGut: { value: new THREE.Vector4(0, B.gutterHalfWidth, B.gutterDepth, B.gutterEdgeDepth) },
    uGut2: { value: new THREE.Vector4(1, B.gutterShade, B.pageCurve, B.pageCurveWidth) },
    uCrease: { value: new THREE.Vector4(B.creaseWidth, B.creaseDark, B.creaseEmboss, B.twinGhost) },
    uFib: { value: new THREE.Vector4(1 / fibreScale, B.fibreNormal, B.fibreAlbedo, fibreNormalTex ? 1 : 0) },
    uFib2: { value: 1 / fibreScale2 },
    uFibMean: { value: fibreMean },
    uCream: { value: cream.clone() },
    uBiomeG: { value: biomeTintUniforms('ground').rows },
    uBiomeGK: { value: biomeTintUniforms('ground').keep },
    uBiomeP: { value: biomeTintUniforms('prop').rows },
    uBiomePK: { value: biomeTintUniforms('prop').keep },
    uBiomePath: { value: biomePathUniforms().tone },
    uBiomePathE: { value: biomePathUniforms().edge },
    uWorld0: { value: new THREE.Vector2() },
    uTrav: { value: new THREE.Vector4(0, 0, B.fadeNear ?? 8, B.fadeFar ?? 13.5) },
    ...waterUniforms(),
    ...REFLECT.uniforms,   // shortfall pass: planar mirror image of the upright paper (render/water.js renderReflection)
  };
  const isWaterModel = new Uint8Array(256);
  modelIds.forEach((id, index) => { if (waterKind(id).kind > 0) isWaterModel[index] = 1; });
  const waterKinds = modelIds.map((id, index) => ({ index, ...waterKind(id) })).filter((k) => k.kind > 0);
  const bind = (shader, names) => { for (const n of names) shader.uniforms[n] = U[n]; };

  // ---- page --------------------------------------------------------------------------------------
  // Page / block / cover are built from the render agent's cardstock material (same paper lighting as the
  // tiles, so a flat tile and its print match), with the book shader code chained after its own hook.
  const usePaper = B.usePaperMaterial !== false && materials && typeof materials.paper === 'function';
  const ownMaterials = [];
  const uniqueMap = () => { // a private 1x1 white map => a private cache entry in materials.paper()
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  };
  function paperLike(opts) {
    let m = null;
    if (usePaper) { try { m = materials.paper(opts); } catch { m = null; } }
    if (!m || !m.isMaterial) {
      m = new THREE.MeshStandardMaterial({ color: opts.color, roughness: 1, metalness: 0, side: opts.side, map: opts.map || null, vertexColors: !!opts.vertexColors });
      ownMaterials.push(m);
    }
    return m;
  }
  function chain(m, fn, key) {
    const prev = m.onBeforeCompile; const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, renderer) => { if (prev) prev.call(m, shader, renderer); fn(shader); };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|' + key;
    m.needsUpdate = true;
  }
  const pageMat = paperLike({ color: '#ffffff', side: THREE.FrontSide, map: uniqueMap(), fibre: 'none', vary: false });
  chain(pageMat, (shader) => {
    bind(shader, ['uAtlas', 'uCells', 'uFibre', 'uFibreN', 'uOff', 'uAnchorMod', 'uBk', 'uGut', 'uGut2', 'uCrease', 'uFib', 'uFib2', 'uFibMean', 'uCream', 'uBiomeG', 'uBiomeGK', 'uBiomeP', 'uBiomePK', 'uBiomePath', 'uBiomePathE', 'uWorld0', 'uTrav', 'uWat', 'uWat2', 'uGnd', 'uWatPal', 'uReflTex', 'uReflMat', 'uRefl', 'uRefl2']);
    const hasPools = shader.fragmentShader.includes('uPaperPoolCol') && shader.fragmentShader.includes('varying vec3 vPaperW');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPg;\nvarying vec4 vReflP;\nuniform mat4 uReflMat;\n' + GUTTER_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPg = position.xz;\nvReflP = uReflMat * (modelMatrix * vec4(position.x, 0.0, position.z, 1.0));\ntransformed.y += gutterH(position.xz, 0.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
varying vec2 vPg;
uniform highp sampler2DArray uAtlas;
uniform sampler2D uCells;
uniform sampler2D uFibre;
uniform sampler2D uFibreN;
uniform vec4 uOff;
uniform vec2 uAnchorMod;
uniform vec4 uCrease;
uniform vec4 uFib;
uniform float uFib2;
uniform float uFibMean;
uniform vec3 uCream;
uniform vec4 uBiomeG[${NB * 3}];
uniform float uBiomeGK[${NB}];
uniform vec4 uBiomeP[${NB * 3}];
uniform float uBiomePK[${NB}];
uniform vec4 uBiomePath[${NB}];
uniform vec4 uBiomePathE[${NB}];
uniform vec2 uWorld0;
uniform vec4 uTrav;   // xy: traveller in the frame of p, z / w: radius where the colour starts to fade / is gone
// printed path (the warm pale kraft strip of the base print; sage / teal / ink fail the warmth test): 1 on the path
float pathMask(vec3 c) { return smoothstep(0.03, 0.085, c.r - c.g) * smoothstep(0.3, 0.44, dot(c, vec3(0.3, 0.59, 0.11))) * smoothstep(0.2, 0.3, c.b); }
${BIOME_TINT_GLSL}
${GUTTER_GLSL}
${waterGLSL()}
vec2 gPageTilt;
vec3 pageColor() {
  const float TILE = ${TILE_SIZE.toFixed(1)};
  vec2 p = vPg + uOff.xy;                 // world position relative to the anchor cell centre
  vec2 cf = p / TILE + 0.5;
  vec2 ci = floor(cf);
  vec2 f = cf - ci;                       // 0..1 inside the cell (x east, y south)
  vec4 d = texelFetch(uCells, ivec2(mod(ci + uAnchorMod, ${GRID}.0)), 0);
  float layer = floor(d.r * 255.0 + 0.5) * 2.0;
  int gb = int(d.g * 255.0 + 0.5);
  int rot = gb & 3;
  vec2 l = f * 2.0 - 1.0;
  vec2 gx = dFdx(p) / TILE;
  vec2 gy = dFdy(p) / TILE;
  for (int i = 0; i < 3; i++) {
    if (i < rot) { l = vec2(l.y, -l.x); gx = vec2(gx.y, -gx.x); gy = vec2(gy.y, -gy.x); }
  }
  vec2 uv = vec2(l.x * 0.5 + 0.5, 0.5 - l.y * 0.5);
  vec2 dx = vec2(gx.x, -gx.y);
  vec2 dy = vec2(gy.x, -gy.y);
  vec4 base4 = textureGrad(uAtlas, vec3(uv, layer), dx, dy);
  float twinLayer = (gb & 192) == 192 ? ${(modelIds.length * 2 + VAR_N + 2).toFixed(1)} + layer * 0.5 : (gb & 64) != 0 ? ${(modelIds.length * 2).toFixed(1)} + layer * 0.5 : (gb & 128) != 0 ? ${(modelIds.length * 2).toFixed(1)} + ${VAR_N.toFixed(1)} + (layer == ${((modelIndex.get('meadow') ?? 0) * 2).toFixed(1)} ? 0.0 : 1.0) : layer + 1.0;
  vec3 flat_ = textureGrad(uAtlas, vec3(uv, twinLayer), dx, dy).rgb;
  ${groundBodyGLSL(bakeSize)}
  // neighbour cells of this quadrant (ink halo + biome blend)
  vec2 hq = sign(f - 0.5);
  vec2 hd = 0.5 - abs(f - 0.5);
  vec4 n1 = texelFetch(uCells, ivec2(mod(ci + uAnchorMod + vec2(hq.x, 0.0), ${GRID}.0)), 0);
  vec4 n2 = texelFetch(uCells, ivec2(mod(ci + uAnchorMod + vec2(0.0, hq.y), ${GRID}.0)), 0);
  vec4 n3 = texelFetch(uCells, ivec2(mod(ci + uAnchorMod + hq, ${GRID}.0)), 0);
  // biome tint (look pass): the colour transforms of the 4 nearest cells around a NOISE-WARPED position, so a biome
  // border is a wobbly hand-torn edge with a soft band instead of a ruler line along the tile seams.
  // (all warp frequencies are multiples of 2 pi / 256, the wrap of uWorld0)
  vec2 wp = p + uWorld0;
  vec2 warp = 0.32 * vec2(sin(wp.y * 1.2517 + 1.7 * sin(wp.x * 0.7854)), sin(wp.x * 1.2517 + 1.7 * sin(wp.y * 0.7854) + 2.1))
            + 0.11 * vec2(sin(wp.y * 3.1907 + wp.x * 2.0371), sin(wp.x * 3.1907 - wp.y * 2.0371));
  vec2 cb = cf + warp - 0.5;
  vec2 ib = floor(cb);
  vec2 bt = smoothstep(0.12, 0.88, cb - ib);
  int b0 = min((int(texelFetch(uCells, ivec2(mod(ib + uAnchorMod, ${GRID}.0)), 0).g * 255.0 + 0.5) >> 2) & 7, ${NB - 1});
  int b1 = min((int(texelFetch(uCells, ivec2(mod(ib + uAnchorMod + vec2(1.0, 0.0), ${GRID}.0)), 0).g * 255.0 + 0.5) >> 2) & 7, ${NB - 1});
  int b2 = min((int(texelFetch(uCells, ivec2(mod(ib + uAnchorMod + vec2(0.0, 1.0), ${GRID}.0)), 0).g * 255.0 + 0.5) >> 2) & 7, ${NB - 1});
  int b3 = min((int(texelFetch(uCells, ivec2(mod(ib + uAnchorMod + vec2(1.0, 1.0), ${GRID}.0)), 0).g * 255.0 + 0.5) >> 2) & 7, ${NB - 1});
  float w1 = bt.x * (1.0 - bt.y); float w2 = (1.0 - bt.x) * bt.y; float w3 = bt.x * bt.y; float w0 = 1.0 - w1 - w2 - w3;
  if (b0 + b1 + b2 + b3 > 0) {
    #define BMIX(A, o) (w0 * A[b0 * 3 + o] + w1 * A[b1 * 3 + o] + w2 * A[b2 * 3 + o] + w3 * A[b3 * 3 + o])
    vec4 g0 = BMIX(uBiomeG, 0); vec4 g1 = BMIX(uBiomeG, 1); vec4 g2 = BMIX(uBiomeG, 2);
    vec4 p0 = BMIX(uBiomeP, 0); vec4 p1 = BMIX(uBiomeP, 1); vec4 p2 = BMIX(uBiomeP, 2);
    float gk = w0 * uBiomeGK[b0] + w1 * uBiomeGK[b1] + w2 * uBiomeGK[b2] + w3 * uBiomeGK[b3];
    float pk = w0 * uBiomePK[b0] + w1 * uBiomePK[b1] + w2 * uBiomePK[b2] + w3 * uBiomePK[b3];
    // the folded-flat print differs from the bare ground where a paper piece lies on it: those pixels get the prop transform
    vec3 ground = biomeTintGround(base, g0, g1, g2, gk);
    // the road keeps its own tone per biome (trodden blue-grey track on snow, packed pale sand in the desert):
    // the ground tint alone would whiten / yellow it into the page and the main line of the composition is lost
    vec4 pt = w0 * uBiomePath[b0] + w1 * uBiomePath[b1] + w2 * uBiomePath[b2] + w3 * uBiomePath[b3];
    if (pt.w > 0.002 && ((gb >> 5) & 1) == 1) {
      vec4 pe = w0 * uBiomePathE[b0] + w1 * uBiomePathE[b1] + w2 * uBiomePathE[b2] + w3 * uBiomePathE[b3];
      float pm0 = gPathM;   // round 3: the ground print's own road mask (the road is repainted there, so a colour test no longer finds it)
      // fixer pass: the tinted track is narrower than the printed road and its edge wanders (trodden paper, not a
      // road): the mask is eroded by a radius that follows a slow world-space wobble
      float wob = 0.5 + 0.25 * sin(p.x * 2.3 + 1.7 * sin(p.y * 1.1)) + 0.25 * sin(p.y * 2.9 + 1.3 * sin(p.x * 1.7) + 2.0);
      float er = 0.02 + 0.034 * wob;       // uv units (1 = one tile)
      float m1 = pathMask(textureGrad(uAtlas, vec3(uv + er * vec2(0.92, 0.38), layer), dx, dy).rgb);
      float m2 = pathMask(textureGrad(uAtlas, vec3(uv + er * vec2(-0.38, 0.92), layer), dx, dy).rgb);
      float m3 = pathMask(textureGrad(uAtlas, vec3(uv + er * vec2(-0.92, -0.38), layer), dx, dy).rgb);
      float m4 = pathMask(textureGrad(uAtlas, vec3(uv + er * vec2(0.38, -0.92), layer), dx, dy).rgb);
      // (ratio of the neighbourhood mean to the centre, so a faint or hatched print is thinned, not erased)
      float pm = pm0 * smoothstep(0.45, 0.85, 0.25 * (m1 + m2 + m3 + m4) / max(pm0, 0.08));
      // amount > 0.9 = mask gain for a faint / stippled road print (snow): the neighbourhood mean is boosted instead
      // (before this the snow track was painted by the EDGE colour alone, as a hard dark slab)
      float pgain = 1.0 + 5.0 * clamp(pt.w - 0.9, 0.0, 1.0);
      pm = mix(pm, smoothstep(0.3, 0.8, 0.2 * (pm0 + m1 + m2 + m3 + m4) * pgain), clamp(pgain - 1.0, 0.0, 1.0));
      // soft shoulder between the track and the page (was a hard printed line)
      float ed = clamp(pm0 - pm, 0.0, 1.0) * 0.8;
      float lumB = dot(base, vec3(0.3, 0.59, 0.11));
      vec3 tone = pt.rgb * (0.93 + 0.1 * lumB / 0.66);      // keeps a little of the print's own tone variation
      ground = mix(ground, tone, pm * min(pt.w, 0.9));
      ground = mix(ground, pe.rgb, ed * pe.w);
    }
    flat_ = mix(ground, biomeTint(flat_, p0, p1, p2, pk), isProp);
    base = ground;
  }
  ${waterBodyGLSL(waterKinds)}
  float tw = max(d.b, uCrease.w);
  vec3 pr = mix(base, flat_, tw);
  float lum = dot(pr, vec3(0.3, 0.59, 0.11));
  // shortfall fixer: the printed twins of pieces that have not risen sit back (paler, greyer) behind the standing ones
  float fpk = tw * isProp;
  // round 3 (page): land far from the traveller is the unpainted part of the book: a pale wash with pencil outlines
  // and a little hatching in the dark areas. Outlines = luma gradient of the print itself (no extra fetch).
  float lgr = length(vec2(dFdx(lum), dFdy(lum))) / max(wpx, 1e-5);
  float skLine = smoothstep(0.5, 2.6, lgr);
  float skHatch = smoothstep(0.35, 0.9, sin((wq.x - wq.y) * WKF(5120) + 2.0 * wNoise(wq, 2.0))) * (1.0 - smoothstep(0.3, 0.52, lum)) * (1.0 - smoothstep(0.012, 0.03, wpx));
  vec3 skWash = mix(uCream, mix(pr, vec3(lum) * vec3(1.04, 1.0, 0.93), 0.5 + 0.25 * fpk), uBk.w * (0.72 - 0.2 * fpk));
  vec3 faded = mix(skWash, vec3(0.34, 0.29, 0.25), clamp(0.5 * skLine + 0.2 * skHatch, 0.0, 0.6) * uBk.w);
  // ink: full on cells about to rise / risen, with a soft halo into the neighbours (no hard tile steps)
  float i1 = n1.a; float i2 = n2.a; float i3 = n3.a;
  float inkv = max(max(d.a, i1 * (1.0 - smoothstep(0.0, 0.5, hd.x))), max(i2 * (1.0 - smoothstep(0.0, 0.5, hd.y)), i3 * (1.0 - smoothstep(0.0, 0.5, length(hd)))));
  // soft radial fade around the traveller (noise-warped rim, no tile-shaped steps); the per-cell ink stays as the
  // floor under tiles that stand outside it
  float rdT = distance(p, uTrav.xy) + 2.4 * (wNoise(wq + 14.2, 0.5) - 0.5) + 0.8 * (wNoise(wq + 3.7, 2.0) - 0.5);
  float inkC = inkv;
  inkv = max(inkv, 1.0 - smoothstep(uTrav.z, uTrav.w, rdT));
  // the land takes the radial colour; the flat print of a piece stays a pencil plan until its own cell inks in
  // (and even then it comes up with the distance: full colour where tiles rise, a pencil plan one tile further out)
  float inkM = mix(inkv, inkC * (1.0 - ${(B.printFade ?? 0.75).toFixed(2)} * smoothstep(${(B.printNear ?? 6.8).toFixed(2)}, ${(B.printFar ?? 9.6).toFixed(2)}, distance(p, uTrav.xy))), fpk);
  vec3 col = mix(faded, pr, inkM * inkM * (3.0 - 2.0 * inkM));
  gWatRefl.z *= inkv * (1.0 - tw * isProp);   // mirror image: only on inked water, never over a flat-folded piece
  // unprinted margin along the page edges
  float e = min(uBk.x - abs(vPg.x), uBk.y - abs(vPg.y));
  col = mix(uCream, col, smoothstep(uBk.z * 0.62, uBk.z, e));

  vec2 tilt = vec2(0.0);
  float aa = max(fwidth(p.x), fwidth(p.y));
  // tile seams: a scored crease (thin dark line + tiny V groove)
  vec2 sd = (f - floor(f + 0.5)) * TILE;  // signed distance to the nearest seam on each axis
  vec2 ad = abs(sd);
  float w = uCrease.x;
  vec2 line = 1.0 - smoothstep(vec2(w * 0.5), vec2(w * 0.5 + aa), ad);
  float inPrint = smoothstep(uBk.z * 0.5, uBk.z, e);
  col *= 1.0 - uCrease.y * uGnd.z * max(line.x, line.y) * inPrint;
  vec2 groove = (1.0 - smoothstep(vec2(0.0), vec2(w * 3.0 + aa), ad)) * sign(sd);
  tilt -= groove * uCrease.z * uGnd.z * inPrint;
  // gutter valley + broad page curvature toward the spine
  float ge = gutterEdge(vPg.y);
  float hw = uGut.y * (1.0 + 0.7 * ge);
  float gd = gutterDx(vPg.x);
  float ga = clamp(1.0 - abs(gd) / hw, 0.0, 1.0);
  float gs = sign(gd);
  // round 3 (page): both tilts ease to zero at the fold, so the normal is continuous there: a lamp beside the gutter
  // used to light one leaf and not the other with a ruler-straight step between them (night)
  tilt.x -= gs * (2.0 * mix(uGut.z, uGut.w, ge) * ga / hw * uGut2.y * smoothstep(0.0, 0.1, abs(gd)) + uGut2.z * exp(-abs(gd) / uGut2.w) * smoothstep(0.0, 1.1, abs(gd))) * uGut2.x;
  const float GK = ${(CONFIG.book.gutterDark ?? 1).toFixed(3)};   // shortfall fixer: strength of the gutter darkening
  col *= 1.0 - GK * (0.30 * ga * ga * ga + 0.38 * (1.0 - smoothstep(0.004, 0.022 + aa, abs(gd)))) * uGut2.x;
  // spine valley: the page rolling down into the gutter turns away from the (left) key on the west leaf
  // (broad soft shadow) and toward it on the east leaf (tight shadow in the fold, then a faint lit shoulder)
  float gw = abs(gd);
  col *= 1.0 - GK * uGut2.x * (gd < 0.0 ? 0.34 * exp(-gw / 1.0) : 0.26 * exp(-gw / 0.28) - 0.07 * exp(-gw / 1.5) * (1.0 - exp(-gw / 0.28)));
  // fibre: fine tooth + coarse clouding (albedo) and a tooth normal
  vec2 fuv = (p + uOff.zw) * uFib.x;
  float fa = texture2D(uFibre, fuv).g / uFibMean - 1.0;
  float fc = texture2D(uFibre, (p.yx + uOff.wz) * vec2(uFib2, -uFib2) + vec2(0.31, 0.67)).g / uFibMean - 1.0;
  col *= 1.0 + (fa * 0.75 + fc * 0.6) * uFib.z;
  if (uFib.w > 0.5) {
    vec3 n = texture2D(uFibreN, fuv).xyz * 2.0 - 1.0;
    tilt += n.xy * uFib.y;
  } else {
    float e1 = 1.0 / 512.0;
    float hx = texture2D(uFibre, fuv + vec2(e1, 0.0)).g - texture2D(uFibre, fuv - vec2(e1, 0.0)).g;
    float hy = texture2D(uFibre, fuv + vec2(0.0, e1)).g - texture2D(uFibre, fuv - vec2(0.0, e1)).g;
    tilt -= vec2(hx, hy) * 2.2 * uFib.y;
  }
  gPageTilt = tilt;
  return col;
}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = pageColor();' + (hasPools ? WATER_GLOW_GLSL : '') + WATER_MIRROR_GLSL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * vec3(gPageTilt.x, 0.0, gPageTilt.y));');
    if (!shader.fragmentShader.includes('diffuseColor.rgb = pageColor();')) console.warn('[book] page shader hook not applied (unexpected material)');
  }, 'book-page-v12-page');

  const pageGeo = new THREE.PlaneGeometry(HW * 2, HD * 2, Math.round(HW * 2 / 0.1), 8).rotateX(-Math.PI / 2);
  const page = new THREE.Mesh(pageGeo, pageMat);
  page.name = 'page';
  page.position.y = -0.002;
  page.receiveShadow = true;
  page.frustumCulled = false;
  page.onBeforeRender = (renderer) => { if (!baked) bake(renderer); U.uWat.value.x = state.time || 0; };
  group.add(page);

  // ---- page block (stacked sheet edges) -----------------------------------------------------------
  // Profile from the page edge outward/downward: N signatures, each a riser (sheet lines) + a small tread.
  const rnd = lcg(9001);
  const N = Math.max(3, B.pageStackLayers | 0);
  const prof = [{ ox: 0, oz: 0, y: 0, v: 0, tread: false }];
  {
    let ox = 0; let oz = 0;
    for (let i = 0; i < N; i++) {
      const y = -T * (i + 1) / N;
      ox += (T / N) * (0.5 + rnd() * 0.2); // riser leans out: the bevelled fore-edge of an open book
      oz += B.pageStackStep * 0.08;
      prof.push({ ox, oz, y, v: (i + 1) / N, tread: false });
      if (i < N - 1) {
        ox += B.pageStackStep * (0.12 + rnd() * 0.5);
        oz += B.pageStackStep * (0.1 + rnd() * 0.3);
        prof.push({ ox, oz, y, v: (i + 1) / N, tread: true });
      }
    }
  }
  const footX = prof[prof.length - 1].ox;
  const footZ = prof[prof.length - 1].oz;
  // ring of base points around the page rectangle (clockwise seen from above), with outward flags
  const ring = [];
  {
    const nxSeg = Math.round(HW * 2 / 0.125);
    const nzSeg = Math.round(HD * 2 / 0.5);
    for (let i = 0; i < nxSeg; i++) ring.push({ x: -HW + (i / nxSeg) * HW * 2, z: -HD, sx: i === 0 ? -1 : 0, sz: -1 }); // north edge, west->east
    for (let i = 0; i < nzSeg; i++) ring.push({ x: HW, z: -HD + (i / nzSeg) * HD * 2, sx: 1, sz: i === 0 ? -1 : 0 }); // east
    for (let i = 0; i < nxSeg; i++) ring.push({ x: HW - (i / nxSeg) * HW * 2, z: HD, sx: i === 0 ? 1 : 0, sz: 1 }); // south
    for (let i = 0; i < nzSeg; i++) ring.push({ x: -HW, z: HD - (i / nzSeg) * HD * 2, sx: -1, sz: i === 0 ? 1 : 0 }); // west
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      ring[i].s = s;
      const b = ring[(i + 1) % ring.length];
      s += Math.hypot(b.x - ring[i].x, b.z - ring[i].z);
    }
    ring.total = s;
  }
  const blockGeo = (() => {
    const pos = []; const col = []; const uv = [];
    const M = prof.length;
    const R = ring.length;
    // per (profile row, ring vertex) jitter so sheets are not ruler straight
    const jit = new Float32Array(M * R);
    for (let m = 0; m < M; m++) {
      let j = 0;
      for (let r = 0; r < R; r++) { j = j * 0.9 + (rnd() - 0.5) * 0.004; jit[m * R + r] = m === 0 ? 0 : j; }
    }
    const tone = new Float32Array(M);
    for (let m = 0; m < M; m++) tone[m] = 0.86 + rnd() * 0.14;
    const P = (m, r) => {
      const a = ring[r % R]; const p = prof[m]; const j = jit[m * R + (r % R)];
      return [a.x + a.sx * (p.ox + j), p.y, a.z + a.sz * (p.oz + j)];
    };
    const uPer = 1 / sheetU;
    for (let m = 0; m < M - 1; m++) {
      const tread = prof[m + 1].tread;
      const t0 = tread ? 1.0 : tone[m];
      for (let r = 0; r < R; r++) {
        const a = P(m, r); const b = P(m, r + 1); const c = P(m + 1, r + 1); const d = P(m + 1, r);
        const u0 = ring[r].s * uPer; const u1 = (r + 1 < R ? ring[r + 1].s : ring.total) * uPer;
        // sheet-line texture: v spans a random slice per signature so the lines differ between risers
        const v0 = sheetV[0] + (sheetV[1] - sheetV[0]) * prof[m].v; const v1 = tread ? v0 : sheetV[0] + (sheetV[1] - sheetV[0]) * prof[m + 1].v;
        pos.push(...a, ...d, ...b, ...b, ...d, ...c);
        uv.push(u0, v0, u0, v1, u1, v0, u1, v0, u0, v1, u1, v1);
        for (let k = 0; k < 6; k++) col.push(t0, t0, t0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  })();
  const blockMat = paperLike({ color: palette.cutEdge || '#fbf6ea', side: THREE.DoubleSide, map: uniqueMap(), fibre: 'local', vary: false, vertexColors: true });
  const uSheet = { value: sheetTex };
  chain(blockMat, (shader) => {
    bind(shader, ['uGut', 'uGut2', 'uBk']);
    shader.uniforms.uSheet = uSheet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheetUv;\n' + GUTTER_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSheetUv = uv;\ntransformed.y += gutterH(position.xz, position.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheetUv;\nuniform sampler2D uSheet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  { // stacked sheets: cream paper with thin warm-brown gaps (the strip is a luminance map)
    float sl = texture2D(uSheet, vSheetUv).g;
    diffuseColor.rgb *= mix(vec3(0.46, 0.33, 0.23), vec3(1.0), smoothstep(0.02, 0.42, sl));
  }`);
  }, 'book-block-v2');
  const block = new THREE.Mesh(blockGeo, blockMat);
  block.name = 'page-block';
  block.position.y = -0.002;
  block.castShadow = true;
  block.receiveShadow = true;
  block.frustumCulled = false;
  group.add(block);

  // ---- cover board -------------------------------------------------------------------------------
  const cw = HW + footX + B.coverOverhang;
  const cd = HD + footZ + B.coverOverhang;
  const coverMat = paperLike({ color: B.coverColor, side: THREE.FrontSide, fibre: 'local', vary: false });
  const cover = new THREE.Mesh(new THREE.BoxGeometry(cw * 2, B.coverThickness, cd * 2), coverMat);
  cover.name = 'cover';
  cover.position.y = -0.002 - T - B.coverThickness / 2;
  cover.castShadow = true;
  cover.receiveShadow = true;
  cover.frustumCulled = false;
  group.add(cover);

  // ---- table ------------------------------------------------------------------------------------
  const TABLE = 260;
  const tableY = -0.002 - T - B.coverThickness - 0.001;
  const uBookRect = { value: new THREE.Vector4(0, 0, cw, cd) };
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  tableMat.name = 'book:table';
  const uTable = { value: new THREE.Vector4(1 / tableScale, 0, 0, B.tableGain ?? 1) };
  tableMat.onBeforeCompile = (shader) => {
    shader.uniforms.uBookRect = uBookRect;
    shader.uniforms.uTable = uTable;
    shader.uniforms.uTableTex = { value: tableTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTb = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTb;\nuniform vec4 uBookRect;\nuniform vec4 uTable;\nuniform sampler2D uTableTex;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec2 q = (vTb + uTable.yz) * uTable.x;
    diffuseColor.rgb = texture2D(uTableTex, q).rgb * uTable.w;
    vec2 bd = abs(vTb - uBookRect.xy) - uBookRect.zw;
    float dist = length(max(bd, 0.0)) + min(max(bd.x, bd.y), 0.0);
    diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(0.0, 1.5, dist));   // contact occlusion around the book
  }`);
  };
  tableMat.customProgramCacheKey = () => 'book-table-v1';
  const table = new THREE.Mesh(new THREE.PlaneGeometry(TABLE, TABLE).rotateX(-Math.PI / 2), tableMat);
  table.name = 'table';
  table.receiveShadow = true;
  table.frustumCulled = false;
  scene.add(table);

  // ---- window state -----------------------------------------------------------------------------
  const centre = { x: 0, z: 0 };
  let first = true;
  let gutterLocal = 0;
  let gutterFade = 1;
  let gutterWorld = B.gutterX0;
  const fmod = (a, m) => a - Math.floor(a / m) * m;

  function place(px, pz) {
    if (first) { centre.x = px; centre.z = pz; first = false; }
    centre.x = Math.min(px + B.slackX, Math.max(px - B.slackX, centre.x));
    centre.z = Math.min(pz + B.slackZ, Math.max(pz - B.slackZ, centre.z));
    group.position.set(centre.x, 0, centre.z);
    const ax = Math.round(centre.x / TILE_SIZE);
    const az = Math.round(centre.z / TILE_SIZE);
    U.uOff.value.set(centre.x - ax * TILE_SIZE, centre.z - az * TILE_SIZE, fmod(ax * TILE_SIZE, fibreScale * fibreScale2 * 4), fmod(az * TILE_SIZE, fibreScale * fibreScale2 * 4));
    U.uAnchorMod.value.set(ax & MASK, az & MASK);
    U.uWorld0.value.set(fmod(ax * TILE_SIZE, 256), fmod(az * TILE_SIZE, 256));
    U.uTrav.value.x = px - ax * TILE_SIZE; U.uTrav.value.y = pz - az * TILE_SIZE;
    gutterWorld = B.gutterX0 + PERIOD * Math.round((centre.x - B.gutterX0) / PERIOD);
    gutterLocal = gutterWorld - centre.x;
    gutterFade = 1;
    U.uGut.value.x = gutterLocal;
    U.uGut2.value.x = gutterFade;
    const tpx = Math.round(centre.x);
    const tpz = Math.round(centre.z);
    table.position.set(tpx, tableY, tpz);
    uTable.value.y = fmod(tpx, tableScale);
    uTable.value.z = fmod(tpz, tableScale);
    uBookRect.value.x = centre.x - tpx;
    uBookRect.value.y = centre.z - tpz;
  }

  function cells(dt, snap) {
    const x0 = Math.floor((centre.x - HW) / TILE_SIZE + 0.5);
    const x1 = Math.floor((centre.x + HW) / TILE_SIZE + 0.5);
    const z0 = Math.floor((centre.z - HD) / TILE_SIZE + 0.5);
    const z1 = Math.floor((centre.z + HD) / TILE_SIZE + 0.5);
    const up = dt / B.inkInTime;
    const down = dt / B.inkOutTime;
    let dirty = false;
    let nw = 0;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = slot(cx, cz);
        const target = mark[i] | hold[i];
        mark[i] = 0;
        let v = ink[i];
        if (snap) v = target; else if (target) v = Math.min(1, v + up); else v = Math.max(0, v - down);
        ink[i] = v;
        // ease so the print saturates softly; byte 255 only when fully inked
        const b = v >= 1 ? 255 : Math.min(254, Math.round(v * v * (3 - 2 * v) * 255));
        const t = Math.round(twin[i] * 255);
        const o = i * 4;
        if (data[o + 3] !== b || data[o + 2] !== t) { data[o + 3] = b; data[o + 2] = t; dirty = true; }
        if (b > 0 && isWaterModel[data[o]] && nw < 256) { REFLECT.cells[nw * 2] = cx * TILE_SIZE; REFLECT.cells[nw * 2 + 1] = cz * TILE_SIZE; nw++; }
      }
    }
    REFLECT.count = nw;
    if (dirty) cellTex.needsUpdate = true;
  }

  place(0, 0);
  first = true;

  const api = {
    group,
    page,
    table,
    /** checks: bake layout (round 3): twin layers, the dry twins (VAR_N) and the desert twins without fences (FEN_N). */
    debugBake: { layers, VAR_N, FEN_N, fence: [...fenceSet] },
    centre,
    halfWidth: HW,
    halfDepth: HD,
    /** Keep the book around the traveller; advance the ink fades. Call AFTER the world marked its cells. */
    update(dt, travellerPos) {
      place(travellerPos.x, travellerPos.z);
      cells(dt, false);
    },
    /** Move the window only (so cellOnPage is valid for this frame's streaming decisions). */
    follow(travellerPos) { place(travellerPos.x, travellerPos.z); },
    /** Snap every ink fade to its target (teleports, settle()). */
    settle() { cells(0, true); },
    /** World -> book: this cell is about to rise / is risen: ink it in (call every frame while true). */
    markInk(cx, cz) { mark[slot(cx, cz)] = 1; },
    /** World -> book: a tile is shown on this cell (keeps the ink at full until released). */
    setHold(cx, cz, on) {
      const i = ((cz & MASK) << SHIFT) | (cx & MASK);
      if (kx[i] === cx && kz[i] === cz) hold[i] = on ? 1 : 0;
    },
    /** World -> book: weight (0..1) of the folded-flat "printed twin" on this cell (1 = tile lies flat). */
    setTwin(cx, cz, w) {
      const i = ((cz & MASK) << SHIFT) | (cx & MASK);
      if (kx[i] === cx && kz[i] === cz) twin[i] = w < 0 ? 0 : w > 1 ? 1 : w;
    },
    /** True once the cell's print is at full ink (a flat tile may then appear on it without a pop). */
    inkReady(cx, cz) {
      const i = ((cz & MASK) << SHIFT) | (cx & MASK);
      return kx[i] === cx && kz[i] === cz && ink[i] >= 1;
    },
    /** Is the whole cell on the printed part of the page (not on the margin / off the book)? */
    cellOnPage(cx, cz, slop = 0) {
      const half = TILE_SIZE / 2;
      return Math.abs(cx * TILE_SIZE - centre.x) + half <= HW - B.margin + slop + 1e-6
        && Math.abs(cz * TILE_SIZE - centre.z) + half <= HD - B.margin + slop + 1e-6;
    },
    /** Does the cell overlap the page at all (so it has a slot in the cell-data window)? */
    cellTouchesPage(cx, cz) {
      const half = TILE_SIZE / 2;
      return Math.abs(cx * TILE_SIZE - centre.x) - half < HW && Math.abs(cz * TILE_SIZE - centre.z) - half < HD;
    },
    /** Height (<= 0) of the page surface at world (x, z): the gutter valley. Allocation-free. */
    gutterDip(x, z) {
      const gx = x - B.gutterX0; const a = 1 - Math.abs(gx - PERIOD * Math.round(gx / PERIOD)) / B.gutterHalfWidth;
      if (a <= 0) return 0;
      return -B.gutterDepth * a * a * gutterFade;
    },
    get gutterX() { return gutterWorld; },
    get baked() { return baked; },
    atlas,
    modelIndex,
    dispose() {
      scene.remove(group);
      scene.remove(table);
      atlas.dispose();
      cellTex.dispose();
      pageGeo.dispose(); blockGeo.dispose(); cover.geometry.dispose(); table.geometry.dispose();
      for (const m of ownMaterials) m.dispose();
      tableMat.dispose();
      if (ownFibre) ownFibre.dispose();
      if (ownSheet) ownSheet.dispose();
      if (ownTable) ownTable.dispose();
    },
  };
  return api;
}
