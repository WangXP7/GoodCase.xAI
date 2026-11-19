// Scraps (owner: scraps agent): small cut-paper collectables lying on the page. Contract: src/game/index.js.
//
// Placement is a pure function of the seed and the cell: about one cell in six holds a scrap of its biome's kind
// (catalog.js SCRAPS), one in 25 a paper star that exists only at night. The piece stands at a walkable spot of
// its cell (never in water, on a bridge or inside a blocker) and pops up with its tile; flat tiles right next to
// the traveller show theirs too. Walking onto a piece picks it up for good (progress.collect, key "cx,cz").
//
// Rendering: ONE InstancedMesh (10 triangles per piece: the card, a strut and a round glue tab), one small icon atlas.
// The atlas is drawn procedurally first; public/textures/art/game_icons.(png|json) cells named "scrap_<kind>"
// replace the drawn shapes when they exist. Per frame nothing is allocated: slots are pooled, matrices and the
// per-instance animation attribute are written in place.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { bus } from '../core/events.js';
import { hash2f } from '../core/rng.js';
import { biomeAt } from '../core/biomes.js';
import { rotToY } from '../core/models.js';
import { SCRAPS, SCRAP_IDS } from './catalog.js';
import * as gameConfig from '../core/config/game.js';

const DEFAULTS = {
  density: 0.24, starDensity: 0.055, size: 0.21, starSize: 0.22, tilt: 0.62,
  rock: 0.13, rockSpeed: 1.7, turn: 0.42, turnSpeed: 0.8, bob: 0.012,
  pickRadius: 0.3, minClearance: 0.2, openClearance: 0.3, propMargin: 0.1, openOnly: true, spread: 0.72, range: 6.5, nearRadius: 2.3,
  riseDelay: 0.38, popRate: 7, hideRate: 9, pickTime: 0.7, pickHop: 0.5, pickLift: 0.62, pickSpin: 2.5,
  flourishEvery: 10, flourishCount: 8, flourishRadius: 0.62, flourishTime: 0.95,
  glint: 0.4, glintPeriod: 3.4, dayLift: 0.06, nightLift: 0.3, flyLift: 0.4, starGlow: 0.85, pool: 56,
};

const TAU = Math.PI * 2;
const COLS = 4;
const ROWS = 2;
const CELL = 128;
const TAB_CELL = 6; // solid paper core: strut + glue tab
const FREE = 0; const IDLE = 1; const PICK = 2; const FX = 3;
const cellKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

// ---- icon atlas ------------------------------------------------------------------------------------------------
function star(g, n, r0, r1, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n; const r = i % 2 ? r1 : r0;
    if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}
function poly(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }

/** Procedural fallback shapes, drawn in a [-1, 1] box (y down). `edge` = the cut paper core around the shape. */
const DRAW = {
  leaf(g, P) {
    const pts = [0, -0.95, 0.26, -0.5, 0.74, -0.62, 0.6, -0.14, 0.94, 0.12, 0.5, 0.3, 0.56, 0.62, 0.14, 0.48, 0.05, 0.62, -0.05, 0.62, -0.14, 0.48, -0.56, 0.62, -0.5, 0.3, -0.94, 0.12, -0.6, -0.14, -0.74, -0.62, -0.26, -0.5];
    g.lineJoin = 'round';
    g.fillStyle = P.cutEdge; g.strokeStyle = P.cutEdge; g.lineWidth = 0.16; poly(g, pts); g.fill(); g.stroke();
    g.fillStyle = P.terracotta; poly(g, pts); g.fill();
    g.fillStyle = P.cutEdge; g.fillRect(-0.06, 0.5, 0.12, 0.46);
    g.fillStyle = P.brown; g.fillRect(-0.035, 0.5, 0.07, 0.42);
    g.strokeStyle = P.ochre; g.lineWidth = 0.06; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(0, -0.7); g.moveTo(0, 0.2); g.lineTo(0.55, -0.3); g.moveTo(0, 0.2); g.lineTo(-0.55, -0.3); g.moveTo(0, 0.34); g.lineTo(0.6, 0.2); g.moveTo(0, 0.34); g.lineTo(-0.6, 0.2); g.stroke();
  },
  shell(g, P) {
    g.fillStyle = P.cutEdge; g.beginPath(); g.arc(0, 0, 0.94, 0, TAU); g.fill();
    g.fillStyle = P.kraft; g.beginPath(); g.arc(0, 0, 0.82, 0, TAU); g.fill();
    g.fillStyle = P.paper; g.beginPath(); g.arc(-0.06, -0.06, 0.68, 0, TAU); g.fill();
    g.strokeStyle = P.brown; g.lineWidth = 0.1; g.lineCap = 'round'; g.beginPath();
    for (let a = 0; a <= 15.2; a += 0.15) { const r = 0.05 + a * 0.048; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    g.lineWidth = 0.05; g.strokeStyle = P.terracotta; g.beginPath();
    for (let i = 0; i < 9; i++) { const a = 9.6 + i * 0.62; const r = 0.05 + a * 0.048; g.moveTo(Math.cos(a) * (r + 0.02), Math.sin(a) * (r + 0.02)); g.lineTo(Math.cos(a) * (r + 0.17), Math.sin(a) * (r + 0.17)); }
    g.stroke();
  },
  snowflake(g, P) {
    const arms = (w, col) => {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 2; const c = Math.cos(a); const s = Math.sin(a);
        g.moveTo(0, 0); g.lineTo(c * 0.82, s * 0.82);
        for (const [d, l] of [[0.42, 0.26], [0.64, 0.18]]) for (const sg of [-1, 1]) {
          const b = a + sg * 1.0; g.moveTo(c * d, s * d); g.lineTo(c * d + Math.cos(b) * l, s * d + Math.sin(b) * l);
        }
      }
      g.stroke();
    };
    arms(0.3, P.teal); arms(0.2, '#cfe1ee'); arms(0.1, '#ffffff');
    g.fillStyle = P.teal; star(g, 6, 0.26, 0.15); g.fill();
    g.fillStyle = '#ffffff'; star(g, 6, 0.17, 0.1); g.fill();
  },
  petal(g, P) {
    const petals = (r, rx, ry, col) => {
      g.fillStyle = col;
      for (let i = 0; i < 5; i++) { const a = (i * TAU) / 5 - Math.PI / 2; g.beginPath(); g.ellipse(Math.cos(a) * r, Math.sin(a) * r, rx, ry, a, 0, TAU); g.fill(); }
    };
    petals(0.5, 0.48, 0.38, P.cutEdge);
    petals(0.5, 0.4, 0.3, '#f29db4');
    petals(0.42, 0.24, 0.15, '#fbd3dc');
    g.fillStyle = P.rust; g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.fill();
    g.fillStyle = P.ochre; g.beginPath(); g.arc(0, 0, 0.13, 0, TAU); g.fill();
  },
  feather(g, P) {
    g.save(); g.rotate(0.5);
    g.fillStyle = P.cutEdge; g.beginPath(); g.ellipse(0, -0.12, 0.42, 0.84, 0, 0, TAU); g.fill(); g.fillRect(-0.07, 0.5, 0.14, 0.48);
    g.fillStyle = P.brown; g.beginPath(); g.ellipse(0, -0.12, 0.33, 0.75, 0, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.ellipse(0, -0.12, 0.33, 0.75, 0, 0, TAU); g.clip();
    g.strokeStyle = P.paper; g.lineWidth = 0.11;
    for (let y = -0.7; y < 0.7; y += 0.3) { g.beginPath(); g.moveTo(-0.5, y + 0.22); g.lineTo(0, y); g.lineTo(0.5, y + 0.22); g.stroke(); }
    g.restore();
    g.strokeStyle = P.ochre; g.lineWidth = 0.055; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -0.8); g.lineTo(0, 0.92); g.stroke();
    g.restore();
  },
  star(g, P) {
    g.lineJoin = 'round';
    g.fillStyle = P.cutEdge; star(g, 5, 0.98, 0.46); g.fill();
    g.fillStyle = P.lantern; star(g, 5, 0.84, 0.37); g.fill();
    // folded star: every second facet a tone darker
    g.fillStyle = P.ochre; g.globalAlpha = 0.55;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 5; const b = a + Math.PI / 5;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 0.84, Math.sin(a) * 0.84); g.lineTo(Math.cos(b) * 0.37, Math.sin(b) * 0.37); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  },
};

/** Named pixel rect [x, y, w, h] (top-down) from a game_icons.json of any of the usual shapes, or null. */
function iconRect(json, name, iw, ih) {
  if (!json) return null;
  const table = json.sprites || json.cells || json.icons || json.frames || json;
  let e = table && table[name];
  if (!e && Array.isArray(json.names)) {
    // regular grid: { names: [...], cols, rows } or { grid: [cols, rows] }
    const i = json.names.indexOf(name);
    const cols = json.cols || (json.grid && json.grid[0]); const rows = json.rows || (json.grid && json.grid[1]);
    if (i >= 0 && cols && rows) { const w = iw / cols; const h = ih / rows; return [(i % cols) * w, Math.floor(i / cols) * h, w, h]; }
  }
  if (!e) return null;
  if (e.rect) e = e.rect; else if (e.frame) e = e.frame;
  let r = Array.isArray(e) ? e : (e.x !== undefined ? [e.x, e.y, e.w ?? e.width, e.h ?? e.height] : null);
  if (!r || r.length < 4 || !(r[2] > 0) || !(r[3] > 0)) return null;
  if (r[0] <= 1 && r[1] <= 1 && r[2] <= 1 && r[3] <= 1) r = [r[0] * iw, r[1] * ih, r[2] * iw, r[3] * ih]; // normalised
  return r;
}

function makeAtlas() {
  const P = CONFIG.palette;
  const W = COLS * CELL; const H = ROWS * CELL;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const px = new Uint8Array(W * H * 4);
  const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  const origin = (c) => [(c % COLS) * CELL, Math.floor(c / COLS) * CELL];

  function drawFallback(c, kind) {
    const [x, y] = origin(c);
    g.clearRect(x, y, CELL, CELL);
    g.save();
    g.beginPath(); g.rect(x, y, CELL, CELL); g.clip();
    g.translate(x + CELL / 2, y + CELL / 2); g.scale(CELL * 0.45, CELL * 0.45);
    DRAW[kind](g, P);
    g.restore();
  }
  function drawIcon(c, img, r, backing) {
    const [x, y] = origin(c);
    const m = CELL * 0.05; const box = CELL - m * 2;
    const k = Math.min(box / r[2], box / r[3]);
    g.clearRect(x, y, CELL, CELL);
    g.imageSmoothingQuality = 'high';
    const dx = x + (CELL - r[2] * k) / 2; const dy = y + (CELL - r[3] * k) / 2;
    if (backing) {
      // a pale piece on pale ground (the snowflake on snow): mount it on a darker backing sheet cut a little larger
      const o = document.createElement('canvas'); o.width = CELL; o.height = CELL;
      const og = o.getContext('2d');
      og.imageSmoothingQuality = 'high';
      og.drawImage(img, r[0], r[1], r[2], r[3], dx - x, dy - y, r[2] * k, r[3] * k);
      og.globalCompositeOperation = 'source-in'; og.fillStyle = backing; og.fillRect(0, 0, CELL, CELL);
      const rim = CELL * 0.035;
      g.save(); g.beginPath(); g.rect(x, y, CELL, CELL); g.clip();
      for (let i = 0; i < 12; i++) g.drawImage(o, x + Math.cos((i / 12) * TAU) * rim, y + Math.sin((i / 12) * TAU) * rim);
      g.restore();
    }
    g.drawImage(img, r[0], r[1], r[2], r[3], dx, dy, r[2] * k, r[3] * k);
  }
  /** Canvas -> texture (rows flipped: v up). Transparent pixels take the cell's mean colour so mips do not darken the rim. */
  function upload() {
    const src = g.getImageData(0, 0, W, H).data;
    for (let c = 0; c < COLS * ROWS; c++) {
      const [ox, oy] = origin(c);
      let r = 0; let gg = 0; let b = 0; let n = 0;
      for (let y = oy; y < oy + CELL; y++) for (let x = ox; x < ox + CELL; x++) { const s = (y * W + x) * 4; if (src[s + 3] > 200) { r += src[s]; gg += src[s + 1]; b += src[s + 2]; n++; } }
      if (n) { r /= n; gg /= n; b /= n; } else { r = gg = b = 255; }
      for (let y = oy; y < oy + CELL; y++) for (let x = ox; x < ox + CELL; x++) {
        const s = (y * W + x) * 4; const d = ((H - 1 - y) * W + x) * 4; const a = src[s + 3];
        if (a < 8) { px[d] = r; px[d + 1] = gg; px[d + 2] = b; px[d + 3] = 0; } else { px[d] = src[s]; px[d + 1] = src[s + 1]; px[d + 2] = src[s + 2]; px[d + 3] = a; }
      }
    }
    tex.needsUpdate = true;
  }

  SCRAP_IDS.forEach((kind, i) => { if (DRAW[kind]) drawFallback(i, kind); });
  { const [x, y] = origin(TAB_CELL); g.fillStyle = P.cutEdge; g.fillRect(x, y, CELL, CELL); }
  upload();

  let art = false;
  /** Replace the drawn shapes by the art icons named "scrap_<kind>" (any that exist). */
  function useIcons(img, json) {
    let n = 0;
    SCRAP_IDS.forEach((kind, i) => {
      const r = iconRect(json, 'scrap_' + kind, img.naturalWidth || img.width, img.naturalHeight || img.height);
      if (r) { drawIcon(i, img, r, kind === 'snowflake' ? '#5f86b4' : null); n++; }
    });
    if (n) { upload(); art = true; }
    return n;
  }
  return { tex, useIcons, get art() { return art; } };
}

// ---- geometry: card (leans + rocks), strut (leans), glue tab (flat on the page) ---------------------------------
function pieceGeometry() {
  const geo = new THREE.BufferGeometry();
  const pos = [
    -0.5, 0.12, 0, 0.5, 0.12, 0, 0.5, 1.12, 0, -0.5, 1.12, 0, // card
    -0.06, 0, -0.012, 0.06, 0, -0.012, 0.06, 0.34, -0.012, -0.06, 0.34, -0.012, // strut behind the card
  ];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const part = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1]; // x: leans, y: plain paper (no icon)
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  // round paper tab glued to the page under the card: a pale disc that marks the spot from the high camera
  const TAB_N = 8; const TAB_R = 0.36;
  for (let i = 0; i < TAB_N; i++) {
    const a = ((i + 0.5) / TAB_N) * TAU;
    pos.push(Math.cos(a) * TAB_R, 0.012, -0.1 + Math.sin(a) * TAB_R * 0.92);
    nor.push(0, 1, 0); uv.push(0.5, 0.5); part.push(0, 1);
  }
  for (let i = 1; i < TAB_N - 1; i++) idx.push(8, 8 + i + 1, 8 + i);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
  geo.setIndex(idx);
  return geo;
}
const TRIS_PER_PIECE = 10;

// ---- prop footprints: walk-through props (tufts, flowers, mushrooms) are not in the walk field, and a tree crown
// hides the ground under it, so a spot is "open" only outside every standing piece of its tile model.
const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
/** [minX, minZ, maxX, maxZ, top, ...] of every standing piece of a tile prototype, in tile space (rot 0). */
function propBoxes(proto, world, model, parity) {
  const out = [];
  if (!proto) return out;
  // shortfall pass: the pieces AS DRAWN (world.standSpecs / standFix: cards turned to the camera and scaled, houses
  // grown; parity = cell.rot & 1), and never the thinned cards - nothing stands there, so the ground is open.
  const list = [];
  proto.traverse((o) => { if (o.isMesh && o.geometry && !/^base/i.test(o.name || '') && o.geometry.getAttribute('position')) list.push(o); });
  const sp = world && world.standSpecs && CONFIG.world.cards && CONFIG.world.cards.collide !== false ? world.standSpecs(model, proto, list) : null;
  list.forEach((o, li) => {
    if (sp && sp.thin[li] === 1) return;
    const pos = o.geometry.getAttribute('position');
    _m.identity();
    for (let a = o; a && a !== proto; a = a.parent) { _l.compose(a.position, a.quaternion, a.scale); _m.premultiply(_l); }
    if (sp) world.standFix(sp, li, parity, _m);
    // integrator (gold pass): the tiles now stand most small cards on the diagonals; the axis-aligned box of such a
    // card is a square many times its real footprint and left almost no open ground (42 pieces in 3125 cells, was
    // ~450). The footprint test uses the card's own base line (a segment with a half thickness) instead; the
    // axis-aligned box is kept for the strip a tall prop hides from the camera.
    _box.setFromBufferAttribute(pos);
    const e = _m.elements;
    const sx = _box.max.x - _box.min.x, sy = _box.max.y - _box.min.y, sz = _box.max.z - _box.min.z;
    const cx = (_box.min.x + _box.max.x) / 2, cy = (_box.min.y + _box.max.y) / 2, cz = (_box.min.z + _box.max.z) / 2;
    const px = e[0] * cx + e[4] * cy + e[8] * cz + e[12], pz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    const hx = [e[0] * sx, e[4] * sy, e[8] * sz], hz = [e[2] * sx, e[6] * sy, e[10] * sz]; // horizontal span of each local axis
    let j = 0;
    for (let i = 1; i < 3; i++) if (hx[i] * hx[i] + hz[i] * hz[i] > hx[j] * hx[j] + hz[j] * hz[j]) j = i;
    const len = Math.hypot(hx[j], hz[j]) || 1e-6;
    let thick = 0;
    for (let i = 0; i < 3; i++) if (i !== j) thick += Math.abs(hx[i] * hz[j] - hz[i] * hx[j]) / len;
    _box.applyMatrix4(_m);
    if (_box.max.y < 0.07) return; // flat print / flap
    out.push(_box.min.x, _box.min.z, _box.max.x, _box.max.z, _box.max.y,
      px - hx[j] / 2, pz - hz[j] / 2, px + hx[j] / 2, pz + hz[j] / 2, thick / 2);
  });
  return out;
}

export function createScraps(ctx) {
  const { scene, world, traveller, progress, daynight, seed = 0 } = ctx;
  // the config section itself (missing keys filled in), so values stay tunable live; plain defaults without it
  const section = (CONFIG.game && CONFIG.game.scraps) || (gameConfig.game && gameConfig.game.scraps) || null;
  const S = section ? Object.assign(section, { ...DEFAULTS, ...section }) : { ...DEFAULTS };
  const N = Math.max(16, S.pool | 0);
  const HASH_A = ((seed | 0) ^ 0x5c4a91) >>> 0;
  const HASH_B = ((seed | 0) ^ 0x1b873593) >>> 0;
  const KIND_OF_BIOME = {};
  for (const id of SCRAP_IDS) if (SCRAPS[id].biome) KIND_OF_BIOME[SCRAPS[id].biome] = id;
  const KIND_INDEX = {};
  SCRAP_IDS.forEach((id, i) => { KIND_INDEX[id] = i; });

  // ---- mesh ------------------------------------------------------------------------------------------------
  const atlas = makeAtlas();
  const fx = { value: new THREE.Vector4(0, S.glint, 0, 0) }; // x: sheen clock (cycles), y: sheen strength, z: night self-light
  const tabUv = new THREE.Vector2(((TAB_CELL % COLS) + 0.5) / COLS, 1 - (Math.floor(TAB_CELL / COLS) + 0.5) / ROWS);
  const mat = new THREE.MeshLambertMaterial({ map: atlas.tex, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uScrapFx = fx;
    shader.uniforms.uScrapTab = { value: tabUv };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRect; attribute vec4 aAnim; attribute vec2 aPart;
uniform vec2 uScrapTab;
varying vec4 vScrap; varying float vScrapFly;
vec3 scrapBend( vec3 p ) {
  float sr = sin( aAnim.x ), cr = cos( aAnim.x ), st = sin( aAnim.y ), ct = cos( aAnim.y );
  vec3 q = vec3( p.x * cr - p.y * sr, p.x * sr + p.y * cr, p.z );
  return vec3( q.x, q.y * ct + q.z * st, -q.y * st + q.z * ct );
}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = mix( aRect.xy + uv * aRect.zw, uScrapTab, aPart.y );\n\tvScrap = vec4( uv, abs( aAnim.z ) * ( 1.0 - aPart.y ), aAnim.w );\n\tvScrapFly = step( aAnim.z, 0.0 );')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tif ( aPart.x > 0.5 ) objectNormal = scrapBend( objectNormal );')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif ( aPart.y > 0.5 && aAnim.z < 0.0 ) transformed = vec3( 0.0 ); // flying piece (negative glow): no strut, no tab\n\tif ( aPart.x > 0.5 ) transformed = scrapBend( transformed );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uScrapFx;\nvarying vec4 vScrap; varying float vScrapFly;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		float sweep = fract( uScrapFx.x + vScrap.w ) * 4.0 - 1.0;
		float band = smoothstep( 0.2, 0.0, abs( ( vScrap.x + vScrap.y ) * 0.5 - sweep ) );
		float card = step( 0.0001, vScrap.z );
		totalEmissiveRadiance += diffuseColor.rgb * ( ( band * uScrapFx.y + uScrapFx.z + uScrapFx.w * vScrapFly ) * card + max( 0.0, vScrap.z - 1.0 ) );
	}`);
  };
  mat.customProgramCacheKey = () => 'game-scraps';
  const geo = pieceGeometry();
  const rectArr = new Float32Array(N * 4);
  const animArr = new Float32Array(N * 4);
  const rectAttr = new THREE.InstancedBufferAttribute(rectArr, 4);
  const animAttr = new THREE.InstancedBufferAttribute(animArr, 4);
  animAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRect', rectAttr);
  geo.setAttribute('aAnim', animAttr);
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'game_scraps';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const M = mesh.instanceMatrix.array;
  M.fill(0);
  for (let i = 0; i < N; i++) M[i * 16 + 15] = 1;
  scene.add(mesh);

  // art icons, when the art agent's sheet exists (vite answers a missing file with index.html: the parse then fails)
  let disposed = false;
  (async () => {
    try {
      const res = await fetch('./textures/art/game_icons.json');
      if (!res.ok) return;
      const json = await res.json();
      const img = new Image();
      img.onload = () => { if (!disposed) atlas.useIcons(img, json); };
      img.src = './textures/art/' + (json.image || json.file || 'game_icons.png');
    } catch { /* no icon sheet: the drawn shapes stay */ }
  })();

  // ---- placement -----------------------------------------------------------------------------------------------
  const boxCache = new Map(); // tile model -> prop footprints
  function boxesFor(model, parity) {
    const key = parity ? model + '/1' : model;
    let b = boxCache.get(key);
    if (b === undefined) {
      b = null;
      try { if (ctx.assets && ctx.assets.getTilePrototype) b = propBoxes(ctx.assets.getTilePrototype(model), world, model, parity); } catch { b = null; }
      boxCache.set(key, b);
    }
    return b;
  }
  const defs = new Map(); // cellKey -> { key, kind, cx, cz, x, y, z, gone } | null
  function defAt(cx, cz) {
    const k = cellKey(cx, cz);
    let d = defs.get(k);
    if (d !== undefined) return d;
    d = null;
    const h = hash2f(cx, cz, HASH_A);
    let kind = null;
    if (h < S.density) kind = KIND_OF_BIOME[biomeAt(seed, cx, cz)] || null;
    else if (h < S.density + S.starDensity) kind = 'star';
    if (kind) {
      // three passes: open ground clear of every prop, then clear of the props' own footprint, then anywhere he can stand
      const cell = world.tileAt(cx, cz);
      const boxes = cell ? boxesFor(cell.model, (cell.rot || 0) & 1) : null;
      const th = cell ? rotToY(cell.rot || 0) : 0;
      const co = Math.cos(th); const si = Math.sin(th);
      for (let i = 0; i < (S.openOnly ? 24 : 48) && !d; i++) { // openOnly: a crowded tile simply holds no piece
        const pass = i < 24 ? 0 : i < 36 ? 1 : 2;
        const ox = (hash2f(cx * 3 + 1, cz * 3 + i * 7, HASH_B) - 0.5) * 2 * S.spread;
        const oz = (hash2f(cx * 3 + i * 5, cz * 3 + 1, HASH_B + 17) - 0.5) * 2 * S.spread;
        const x = cx * TILE_SIZE + ox; const z = cz * TILE_SIZE + oz;
        const surf = world.surfaceAt(x, z);
        if (surf !== 'grass' && surf !== 'path') continue;
        if (world.clearance(x, z) < (pass === 0 ? S.openClearance : S.minClearance)) continue;
        if (pass < 2 && boxes) {
          // world offset -> tile space (inverse of rotation.y = th)
          const u = ox * co - oz * si; const v = ox * si + oz * co;
          let hit = false;
          for (let k = 0; k < boxes.length && !hit; k += 10) {
            const m = (pass === 0 ? S.propMargin + Math.min(0.4, boxes[k + 4] * 0.5) : S.propMargin) + boxes[k + 9];
            // distance to the prop's base line (see propBoxes)
            const sx = boxes[k + 7] - boxes[k + 5]; const sz = boxes[k + 8] - boxes[k + 6];
            const tt = Math.max(0, Math.min(1, ((u - boxes[k + 5]) * sx + (v - boxes[k + 6]) * sz) / (sx * sx + sz * sz || 1e-9)));
            const qx = u - boxes[k + 5] - sx * tt; const qz = v - boxes[k + 6] - sz * tt;
            hit = qx * qx + qz * qz < m * m;
            if (!hit && pass === 0 && boxes[k + 4] > 0.45) {
              // not in the strip a standing prop hides from the camera (it looks north: the strip lies behind the prop)
              const ax = boxes[k] * co + boxes[k + 1] * si; const az = -boxes[k] * si + boxes[k + 1] * co;
              const bx = boxes[k + 2] * co + boxes[k + 3] * si; const bz = -boxes[k + 2] * si + boxes[k + 3] * co;
              const hide = Math.min(1.1, boxes[k + 4] * 0.85);
              hit = ox > Math.min(ax, bx) - 0.12 && ox < Math.max(ax, bx) + 0.12 && oz < Math.max(az, bz) && oz > Math.min(az, bz) - hide;
            }
          }
          if (hit) continue;
        }
        d = { key: cx + ',' + cz, kind, cx, cz, x, y: world.heightAt(x, z), z, gone: false };
      }
    }
    if (defs.size > 6000) defs.clear();
    defs.set(k, d);
    return d;
  }

  // ---- slots -------------------------------------------------------------------------------------------------------
  const slots = [];
  for (let i = 0; i < N; i++) slots.push({ i, state: FREE, def: null, ck: 0, kind: 0, x: 0, y: 0, z: 0, s: 0, delay: 0, t: 0, ph: 0, ang: 0, size: S.size, seen: 0, stale: false });
  const byCell = new Map(); // cellKey -> idle slot
  const risen = new Map(); // cellKey -> 1 while the tile stands (bus tile:rise / tile:flat / tile:despawn)
  let scanId = 0;
  let lastCx = NaN; let lastCz = NaN;
  let dirty = true;
  let night = !!(daynight && daynight.night);
  let nightK = night ? 1 : 0;
  let clock = 0;
  let live = 0;

  function setKind(sl, kind) {
    const c = KIND_INDEX[kind] || 0;
    const o = sl.i * 4;
    const e = 0.5 / (COLS * CELL); // half-texel inset: no bleeding from the neighbour cell
    rectArr[o] = (c % COLS) / COLS + e; rectArr[o + 1] = 1 - (Math.floor(c / COLS) + 1) / ROWS + e;
    rectArr[o + 2] = 1 / COLS - 2 * e; rectArr[o + 3] = 1 / ROWS - 2 * e;
    rectAttr.needsUpdate = true;
    sl.kind = kind;
    sl.size = kind === 'star' ? S.starSize : S.size;
  }
  function freeSlot() { for (let i = 0; i < N; i++) if (slots[i].state === FREE) return slots[i]; return null; }
  function release(sl) {
    if (sl.state === IDLE && byCell.get(sl.ck) === sl) byCell.delete(sl.ck);
    sl.state = FREE; sl.def = null; sl.s = 0;
    const o = sl.i * 16;
    M[o] = M[o + 2] = M[o + 5] = M[o + 8] = M[o + 10] = 0;
  }
  function write(sl, x, y, z, yaw, scale, roll, tilt, glow) {
    const o = sl.i * 16;
    const c = Math.cos(yaw) * scale; const sn = Math.sin(yaw) * scale;
    M[o] = c; M[o + 2] = -sn; M[o + 5] = scale; M[o + 8] = sn; M[o + 10] = c;
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z;
    const a = sl.i * 4;
    animArr[a] = roll; animArr[a + 1] = tilt; animArr[a + 2] = glow; animArr[a + 3] = sl.ph;
  }

  const onRise = (e) => {
    const k = cellKey(e.x, e.z);
    risen.set(k, 1);
    const sl = byCell.get(k);
    if (sl && sl.s <= 0) sl.delay = S.riseDelay;
  };
  const onFlat = (e) => { risen.delete(cellKey(e.x, e.z)); };
  const offs = [bus.on('tile:rise', onRise), bus.on('tile:flat', onFlat), bus.on('tile:despawn', onFlat), bus.on('game:reset', () => { defs.clear(); dirty = true; })];

  /** Rebuild `risen` from the live tiles (settle / teleports snap folds without events). Allocates: not per frame. */
  function reconcile() {
    risen.clear();
    const tiles = world.activeTiles ? world.activeTiles() : [];
    for (let i = 0; i < tiles.length; i++) { const r = tiles[i]; if (r.shown && r.fold && r.fold.target === 1) risen.set(cellKey(r.cx, r.cz), 1); }
  }

  /** Give every un-collected scrap in range a slot; mark the others stale (they shrink away, then free their slot). */
  function rescan() {
    dirty = false;
    scanId++;
    const p = traveller.position;
    const tcx = Math.round(p.x / TILE_SIZE); const tcz = Math.round(p.z / TILE_SIZE);
    lastCx = tcx; lastCz = tcz;
    const R = Math.ceil(S.range / TILE_SIZE);
    const r2 = S.range * S.range;
    for (let cz = tcz - R; cz <= tcz + R; cz++) {
      for (let cx = tcx - R; cx <= tcx + R; cx++) {
        const d = defAt(cx, cz);
        if (d === null || d.gone) continue;
        if (d.kind === 'star' && !night) continue;
        const dx = d.x - p.x; const dz = d.z - p.z;
        if (dx * dx + dz * dz > r2) continue;
        const k = cellKey(cx, cz);
        let sl = byCell.get(k);
        if (!sl) {
          if (progress.collected(d.key)) { d.gone = true; continue; }
          sl = freeSlot();
          if (!sl) continue;
          sl.state = IDLE; sl.def = d; sl.ck = k; sl.s = 0; sl.delay = 0; sl.t = 0;
          sl.x = d.x; sl.y = d.y; sl.z = d.z;
          sl.ph = hash2f(cx, cz, HASH_B + 3);
          setKind(sl, d.kind);
          byCell.set(k, sl);
        }
        sl.seen = scanId; sl.stale = false;
      }
    }
    for (let i = 0; i < N; i++) { const sl = slots[i]; if (sl.state === IDLE && sl.seen !== scanId) sl.stale = true; }
  }

  function pick(sl) {
    const d = sl.def;
    d.gone = true;
    byCell.delete(sl.ck);
    if (!progress.collect(d.key, d.kind, d.x, d.z)) { release(sl); return; }
    sl.state = PICK; sl.t = 0;
    if (ctx.music && ctx.music.chime) ctx.music.chime('scrap');
    const n = progress.scrapCount(d.kind);
    if (S.flourishEvery > 0 && n > 0 && n % S.flourishEvery === 0) {
      for (let i = 0; i < S.flourishCount; i++) {
        const f = freeSlot();
        if (!f) break;
        f.state = FX; f.def = null; f.t = 0; f.x = d.x; f.y = d.y; f.z = d.z;
        f.ang = (i / S.flourishCount) * TAU + 0.3; f.ph = i / S.flourishCount;
        setKind(f, d.kind);
      }
    }
  }

  function update(dt) {
    clock += dt;
    const nowNight = !!(daynight && daynight.night);
    if (nowNight !== night) { night = nowNight; dirty = true; }
    nightK += ((night ? 1 : 0) - nightK) * Math.min(1, dt * 1.6);
    const p = traveller.position;
    const tcx = Math.round(p.x / TILE_SIZE); const tcz = Math.round(p.z / TILE_SIZE);
    if (dirty || tcx !== lastCx || tcz !== lastCz) rescan();
    fx.value.x = clock / S.glintPeriod;
    fx.value.y = S.glint * (1 - 0.5 * nightK);
    fx.value.z = S.dayLift + (S.nightLift - S.dayLift) * nightK;
    fx.value.w = S.flyLift * (1 - 0.55 * nightK); // a turning piece shows its unlit back: thin paper lets light through
    const modal = !!(ctx.game && ctx.game.modal && ctx.game.modal());
    const near2 = S.nearRadius * S.nearRadius;
    const pick2 = S.pickRadius * S.pickRadius;
    live = 0;
    for (let i = 0; i < N; i++) {
      const sl = slots[i];
      if (sl.state === FREE) continue;
      if (sl.state === IDLE) {
        const d = sl.def;
        const dx = d.x - p.x; const dz = d.z - p.z;
        const d2 = dx * dx + dz * dz;
        const want = !sl.stale && (d.kind !== 'star' || night) && (d2 < near2 || risen.has(sl.ck));
        if (want) {
          if (sl.delay > 0 && d2 >= pick2 * 4) sl.delay -= dt; else { sl.delay = 0; sl.s = Math.min(1, sl.s + dt * S.popRate * 0.35); }
        } else {
          sl.s = Math.max(0, sl.s - dt * S.hideRate * 0.35);
          if (sl.s <= 0 && (sl.stale || (d.kind === 'star' && !night))) { release(sl); continue; }
        }
        if (sl.s <= 0) { const o = sl.i * 16; M[o] = M[o + 2] = M[o + 5] = M[o + 8] = M[o + 10] = 0; continue; }
        live++;
        if (!modal && sl.s > 0.5 && d2 < pick2) { pick(sl); if (sl.state !== PICK) continue; }
        // pop: overshoot a little, like a card springing up
        const u = sl.s; const k = u - 1;
        const pop = 1 + 2.4 * k * k * k + 1.4 * k * k;
        const a = clock + sl.ph * 20;
        const star = d.kind === 'star';
        write(sl, d.x, d.y + 0.006 + S.bob * (0.5 + 0.5 * Math.sin(a * 1.3)), d.z,
          S.turn * Math.sin(a * S.turnSpeed), sl.size * pop,
          S.rock * Math.sin(a * S.rockSpeed), S.tilt + (1 - u) * 0.7,
          star ? 1 + S.starGlow * nightK * (0.82 + 0.18 * Math.sin(a * 2.1)) : 1);
      } else if (sl.state === PICK) {
        sl.t += dt;
        const u = sl.t / S.pickTime;
        if (u >= 1) { release(sl); continue; }
        live++;
        // hop up on the spot, then fly to the traveller's hand while spinning and shrinking
        const e = u < 0.3 ? 0 : (u - 0.3) / 0.7;
        const e2 = e * e * (3 - 2 * e);
        const x = sl.x + (p.x - sl.x) * e2; const z = sl.z + (p.z - sl.z) * e2;
        // it rises clear of his hat (the camera looks down from behind him) and ends just above the crown
        const y = sl.y + S.pickHop * Math.sin(Math.min(1, u / 0.45) * Math.PI * 0.5) * (1 - e2) + (p.y + S.pickLift - sl.y) * e2;
        const sc = sl.size * (1 + 0.3 * Math.sin(Math.min(1, u / 0.3) * Math.PI)) * (1 - e2 * e2);
        write(sl, x, y, z, u * u * S.pickSpin * TAU, sc, 0, S.tilt * (1 - u), -(sl.kind === 'star' ? 1 + S.starGlow * nightK : 1));
      } else {
        sl.t += dt;
        const u = sl.t / S.flourishTime;
        if (u >= 1) { release(sl); continue; }
        live++;
        const e = 1 - (1 - u) * (1 - u);
        const r = 0.08 + S.flourishRadius * e;
        write(sl, sl.x + Math.cos(sl.ang) * r, sl.y + 0.04 + 0.42 * Math.sin(u * Math.PI) * (1 - 0.3 * u), sl.z + Math.sin(sl.ang) * r,
          0.5 * Math.sin(u * 7 + sl.ang), sl.size * 0.62 * Math.min(1, u * 8) * (1 - u * u * u), 0.7 * Math.sin(u * 11 + sl.ang), S.tilt, // faces the camera and flutters
          -(sl.kind === 'star' ? 1 + S.starGlow * nightK : 1));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    animAttr.needsUpdate = true;
  }

  return {
    update,
    /** Deterministic stills: every piece in range stands (or is hidden) at once, pick-ups and flourishes are finished. */
    settle() {
      reconcile();
      for (let i = 0; i < N; i++) { const sl = slots[i]; if (sl.state === PICK || sl.state === FX) release(sl); }
      night = !!(daynight && daynight.night);
      nightK = night ? 1 : 0;
      rescan();
      const p = traveller.position;
      const near2 = S.nearRadius * S.nearRadius;
      for (let i = 0; i < N; i++) {
        const sl = slots[i];
        if (sl.state !== IDLE) continue;
        if (sl.stale) { release(sl); continue; }
        const dx = sl.def.x - p.x; const dz = sl.def.z - p.z;
        sl.delay = 0;
        sl.s = dx * dx + dz * dz < near2 || risen.has(sl.ck) ? 1 : 0;
      }
      update(0);
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      scene.remove(mesh);
      geo.dispose(); mat.dispose(); atlas.tex.dispose();
      mesh.dispose();
    },
    /** Pieces that are visible right now (standing, being picked up or part of a flourish). */
    count() { return live; },
    /** Nearest scrap that can be collected now: { x, z, kind, key, dist, visible } or null. `kind` filters. */
    debugNearest(kind = null) {
      const p = traveller.position;
      let best = null; let bd = Infinity;
      for (let i = 0; i < N; i++) {
        const sl = slots[i];
        if (sl.state !== IDLE || sl.stale || (kind && sl.def.kind !== kind)) continue;
        const d = Math.hypot(sl.def.x - p.x, sl.def.z - p.z);
        if (d < bd) { bd = d; best = sl; }
      }
      return best ? { x: best.def.x, z: best.def.z, kind: best.def.kind, key: best.def.key, dist: bd, visible: best.s > 0.5 } : null;
    },
    /** Debug: every scrap of the cells in a square window: [{ x, z, kind, key, collected }]. */
    debugCells(cx, cz, r = 6) {
      const out = [];
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) { const d = defAt(x, z); if (d) out.push({ x: d.x, z: d.z, kind: d.kind, key: d.key, collected: progress.collected(d.key) }); }
      return out;
    },
    get art() { return atlas.art; },
    mesh,
    trianglesPerPiece: TRIS_PER_PIECE,
  };
}
