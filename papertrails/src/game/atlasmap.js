// The ATLAS page (owner: atlasmap agent, gameplay pass). Contract: src/game/index.js.
//
// Tab / E lifts the view off the diorama and slides a flat paper map page over it: a patchwork of every explored
// cell (the printed tile art read back once from the book bake, washed per biome), an inked coast line round the
// explored land, lit lanterns, a pin for the traveller, and a legend strip printed along the
// bottom margin. Escape / Tab / E (or a plain click) closes it; WASD / arrows / drag pan, wheel / + - zoom.
//
// Cost: nothing while closed (no object in the world scene, no draw call, no per-frame work). While open: ONE
// draw call (a screen quad drawn after the post chain) + two canvas textures that are redrawn only when the
// map opens, the view leaves the drawn window, or progress changes.
//
// Hooks outside this file (marked "// game-hook(atlasmap)" in src/main.js): idle walking input while
// game.modal() is true, and atlasmap.render() after post.render().
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { bus } from '../core/events.js';
import { MODELS } from '../core/models.js';
import { mulberry32 } from '../core/rng.js';
import { SCRAP_IDS } from './catalog.js';

const DEFAULTS = {
  duration: 0.7, // seconds, eased both ways
  lift: 0.75, // the follow camera pulls back by this fraction of its distance while the page comes in
  liftPitch: 74, // ... and tips toward a top-down view (degrees)
  minSpan: 5, // closest zoom: cells across the map frame height
  maxSpan: 90, // widest zoom
  fitMax: 24, // the opening view never shows more cells than this across the frame height (zoom out for more)
  fitPad: 1.5, // blank cells kept round the explored land when fitting
  texture: 2048, // longest side of the two canvases (px)
  thumb: 128, // px per tile thumbnail read back from the book bake
  print: 'twin', // 'twin' = folded-flat print (houses and trees lie printed on the land), 'base' = bare ground print
  inkPaths: true, // dashed ink lanes over the print
  iconsUrl: 'textures/art/game_icons', // .png + .json (optional; procedural shapes are used when missing)
  panSpeed: 0.9, // view heights per second with the keys
};

const INK = '#5a3a28';
// flat ground tones (fallback patchwork when the book bake cannot be read)
const BIOME_GROUND = { heartland: '#c3c084', desert: '#e3c68f', snow: '#e7ecef', blossom: '#cdd596', pinewood: '#8fa07a' };
// washes laid over the heartland print of SHARED tiles so each biome reads in its own colour: [blend, colour, alpha] ...
const BIOME_WASH = {
  heartland: [],
  desert: [['color', '#dcb878', 0.85], ['source-over', '#ecd3a0', 0.3]],
  snow: [['color', '#c9d8ea', 0.9], ['source-over', '#f1f4f6', 0.58]],
  blossom: [['color', '#b3c070', 0.3], ['source-over', '#f0c9c4', 0.1]],
  pinewood: [['color', '#557250', 0.55], ['multiply', '#b9c7b0', 0.55]],
};
const SERIF = "Georgia, 'Times New Roman', serif";
const TAU = Math.PI * 2;
const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (x, z, k) => {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

// ---- procedural icons (used when game_icons has no cell of that name) --------------------------------------------
function scrapShape(ctx, kind, s) {
  ctx.lineWidth = Math.max(1, s * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const fill = { leaf: '#b9603f', shell: '#e8d3ac', snowflake: '#fbf6ea', petal: '#c98374', feather: '#8a6a4c', star: '#dca848' }[kind] || '#d9a441';
  ctx.fillStyle = fill; ctx.strokeStyle = INK;
  ctx.beginPath();
  if (kind === 'leaf') { ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.95, -s * 0.5, s * 0.8, s * 0.5, 0, s); ctx.bezierCurveTo(-s * 0.8, s * 0.5, -s * 0.95, -s * 0.5, 0, -s); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(0, s * 1.15); ctx.stroke(); }
  else if (kind === 'shell') { ctx.arc(0, 0, s * 0.9, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); for (let a = 0; a < 14; a += 0.3) { const r = s * 0.06 * a; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke(); }
  else if (kind === 'snowflake') { ctx.arc(0, 0, s * 0.95, 0, TAU); ctx.fillStyle = '#dfe9ee'; ctx.fill(); ctx.strokeStyle = '#5e9c9a'; ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI; ctx.moveTo(Math.cos(a) * s * 0.75, Math.sin(a) * s * 0.75); ctx.lineTo(-Math.cos(a) * s * 0.75, -Math.sin(a) * s * 0.75); } ctx.stroke(); }
  else if (kind === 'petal') { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; ctx.moveTo(Math.cos(a) * s * 0.55 + s * 0.42, Math.sin(a) * s * 0.55); ctx.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.42, 0, TAU); } ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, TAU); ctx.fillStyle = '#d9a441'; ctx.fill(); }
  else if (kind === 'feather') { ctx.save(); ctx.rotate(0.5); ctx.ellipse(0, -s * 0.1, s * 0.36, s * 0.95, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.9); ctx.lineTo(0, s * 1.2); ctx.stroke(); ctx.restore(); }
  else { for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2; const r = i % 2 ? s * 0.45 : s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
}

export function createAtlasMap(ctx) {
  const { renderer, world, wfc, traveller, follow, controls, daynight, progress, seed, quality } = ctx;
  const A = { ...DEFAULTS, ...((CONFIG.game && CONFIG.game.atlasmap) || {}) };
  const P = CONFIG.palette || {};
  const PAPER = P.paper || '#efe0c2';
  const headless = typeof document === 'undefined' || !renderer;

  // ---- state ---------------------------------------------------------------------------------------------------
  let want = false; // target: open?
  let t = 0; // 0 closed .. 1 open (linear time; eased on use)
  let basePose = null; // the follow pose to return to
  let mapDirty = true; let pageDirty = true; let cellsDirty = true;
  let zoomIdle = 0;
  let night = 0; // 0 day .. 1 night (the page light follows the world's)
  const nightGoal = () => (daynight && daynight.night ? 1 : 0);
  const cells = new Map(); // key -> biome id
  const bounds = { x0: 0, x1: 0, z0: 0, z1: 0 };
  const view = { x: 0, z: 0, span: 12, tx: 0, tz: 0, tspan: 12, fit: 12 };
  const win = { x: 0, z: 0, ppc: 32, span: 12, ok: false }; // what the map canvas currently shows
  const frame = { x0: 0, y0: 0, x1: 1, y1: 1 }; // map frame on the page canvas (px, y down)
  const held = new Set();
  const lamps = new Map(); // key -> [cellX, cellZ] (floats)

  // lit lanterns: the save API has no iterator, so positions come from the events of this session plus the keys
  // of the stored save ("cx,cz" / "cx,cz,node" by contract).
  function lampFromKey(k) {
    const m = /^(-?\d+),(-?\d+)/.exec(k);
    if (m && !lamps.has(k)) lamps.set(k, [+m[1], +m[2]]);
  }
  function loadLamps() {
    if (!progress.persist) return;
    try {
      const raw = localStorage.getItem('popup-atlas:v1:' + seed);
      const d = raw && JSON.parse(raw);
      if (d && d.lanterns) for (const k in d.lanterns) lampFromKey(k);
    } catch { /* no stored save */ }
  }
  loadLamps();

  const offs = [
    bus.on('game:explore', () => { cellsDirty = true; mapDirty = true; pageDirty = true; }),
    bus.on('game:collect', () => { pageDirty = true; }),
    bus.on('game:lantern', (e) => { if (e && e.key !== undefined) lamps.set(e.key, [e.x / TILE_SIZE, e.z / TILE_SIZE]); mapDirty = true; pageDirty = true; }),
    bus.on('game:reset', () => { lamps.clear(); cellsDirty = true; mapDirty = true; pageDirty = true; }),
    bus.on('resize', () => { pageDirty = true; mapDirty = true; }),
  ];

  // ---- GPU objects (created on first open) -----------------------------------------------------------------------
  let gfx = null;
  let iconTable = null; let iconImg = null; // the art sheet, loaded at start-up so the first opening already shows it
  function ensureGfx() {
    if (gfx || headless) return gfx;
    const pageCanvas = document.createElement('canvas');
    const mapCanvas = document.createElement('canvas');
    const layer = document.createElement('canvas');
    const mask = document.createElement('canvas');
    const mk = (c) => {
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace; // the shader works in display space and writes straight to the canvas
      tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    };
    const tPage = mk(pageCanvas);
    const tMap = mk(mapCanvas);
    tMap.premultiplyAlpha = true;
    const geo = new THREE.BufferGeometry();
    // the page (y -1..1) plus a strip above it that carries the shadow of its leading edge
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1.2, -1.2, 0, 1.2, -1.2, 0, 1.2, 1.5, 0, -1.2, -1.2, 0, 1.2, 1.5, 0, -1.2, 1.5, 0], 3));
    const mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      uniforms: {
        tPage: { value: tPage }, tMap: { value: tMap },
        uView: { value: new THREE.Vector4() }, uWin: { value: new THREE.Vector4() }, uFrame: { value: new THREE.Vector4() },
        uSlide: { value: new THREE.Vector3() }, uPaper: { value: new THREE.Color(PAPER) }, uNight: { value: 0 },
        uAspect: { value: 1 }, uInk: { value: new THREE.Color(INK) }, uFeather: { value: new THREE.Vector2(0.002, 0.002) },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uSlide; uniform float uAspect;
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          vec2 p = position.xy;
          float c = cos(uSlide.z), s = sin(uSlide.z);
          p.x *= uAspect; p = vec2(c * p.x - s * p.y, s * p.x + c * p.y); p.x /= uAspect;
          gl_Position = vec4(p + uSlide.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPage; uniform sampler2D tMap;
        uniform vec4 uView; uniform vec4 uWin; uniform vec4 uFrame;
        uniform vec3 uPaper; uniform vec3 uInk; uniform float uNight; uniform float uAspect; uniform vec2 uFeather;
        varying vec2 vUv;
        float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        void main() {
          if (vUv.y > 1.0 || vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0) {
            // the shadow the page throws on the diorama it slides over
            float d = max(max(vUv.y - 1.0, 0.0) / 0.25, max(max(-vUv.x, vUv.x - 1.0), -vUv.y) / 0.1);
            float a = clamp(1.0 - d, 0.0, 1.0);
            gl_FragColor = vec4(0.07, 0.04, 0.02, a * a * 0.5);
            return;
          }
          vec3 page = texture2D(tPage, vUv).rgb;
          vec3 col = page;
          // the map lives inside the inked frame and pans / zooms under it
          vec2 e = min(vUv - uFrame.xy, uFrame.zw - vUv) / uFeather;
          float inside = clamp(min(e.x, e.y), 0.0, 1.0);
          if (inside > 0.0) {
            vec2 cell = uView.xy + (vUv - 0.5 * (uFrame.xy + uFrame.zw)) * uView.zw * vec2(1.0, -1.0);
            vec2 muv = vec2(0.5 + (cell.x - uWin.x) * uWin.z, 0.5 - (cell.y - uWin.y) * uWin.w);
            vec4 m = texture2D(tMap, muv);
            vec2 b = min(muv, 1.0 - muv);
            float ma = m.a * inside * step(0.0, min(b.x, b.y));
            vec3 mc = m.a > 0.001 ? m.rgb / m.a : uPaper;
            // the print sits IN the paper: fibres and the page's own ink show through it
            col = mix(col, mc * clamp(page / uPaper, 0.0, 1.08), ma);
          }
          // paper under light: fine tooth, a soft pool of light, darker corners
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float r = length(q);
          col *= 0.985 + 0.03 * hash(floor(gl_FragCoord.xy));
          float vig = smoothstep(0.25, 1.05, r);
          vec3 day = col * mix(vec3(1.03, 1.02, 1.0), vec3(0.78, 0.7, 0.6), vig * vig);
          // night: the page is read by lantern light
          float pool = exp(-r * r * 3.2);
          vec3 night = col * (vec3(0.2, 0.22, 0.34) + vec3(1.0, 0.76, 0.46) * pool * 0.92);
          gl_FragColor = vec4(mix(day, night, uNight), 1.0);
        }`,
    });
    const quad = new THREE.Mesh(geo, mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.Camera();
    gfx = { pageCanvas, mapCanvas, layer, mask, tPage, tMap, geo, mat, scene, cam, thumbs: null, thumbTried: 0, icons: null, iconImg: null };
    return gfx;
  }

  // ---- icons (optional sheet; procedural otherwise) ---------------------------------------------------------------
  function loadIcons() {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    const url = base + A.iconsUrl;
    fetch(url + '.json').then((r) => (r.ok ? r.json() : null)).then((json) => {
      if (!json) return;
      const src = json.sprites || json.cells || json.icons || json.frames || json;
      const table = {};
      for (const name in src) {
        const v = src[name];
        const r = Array.isArray(v) ? v : v && (v.rect || v.frame || v);
        if (!r) continue;
        const rect = Array.isArray(r) ? r : [r.x, r.y, r.w ?? r.width, r.h ?? r.height];
        if (rect.length >= 4 && rect.every((n) => Number.isFinite(n))) table[name] = rect;
      }
      const img = new Image();
      img.onload = () => { iconTable = table; iconImg = img; mapDirty = true; pageDirty = true; };
      img.src = url + '.png';
    }).catch(() => { /* no sheet: procedural icons */ });
  }
  /** Draw a named icon centred at (x, y) fitting a box of `size`. @returns false when the sheet has no such cell */
  function icon(c, name, x, y, size) {
    const r = iconTable && iconTable[name];
    if (!r) return false;
    const k = size / Math.max(r[2], r[3]);
    c.drawImage(iconImg, r[0], r[1], r[2], r[3], x - (r[2] * k) / 2, y - (r[3] * k) / 2, r[2] * k, r[3] * k);
    return true;
  }

  function drawScrap(c, kind, x, y, size) {
    if (icon(c, 'scrap_' + kind, x, y, size)) return;
    c.save(); c.translate(x, y); scrapShape(c, kind, size * 0.4); c.restore();
  }
  function drawLamp(c, x, y, r) {
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, 'rgba(255, 196, 90, 0.75)'); g.addColorStop(1, 'rgba(255, 196, 90, 0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3, 0, TAU); c.fill();
    c.fillStyle = '#ffc45a'; c.strokeStyle = INK; c.lineWidth = Math.max(0.75, r * 0.3);
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.stroke();
  }
  function drawPin(c, x, y, size, dx, dz) {
    c.save();
    // small facing arrow on the ground
    const l = Math.hypot(dx, dz) || 1; const ax = dx / l; const az = dz / l;
    c.fillStyle = INK; c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(x + ax * size * 0.62, y + az * size * 0.62);
    c.lineTo(x + ax * size * 0.3 - az * size * 0.16, y + az * size * 0.3 + ax * size * 0.16);
    c.lineTo(x + ax * size * 0.3 + az * size * 0.16, y + az * size * 0.3 - ax * size * 0.16);
    c.closePath(); c.fill();
    c.globalAlpha = 1;
    if (!icon(c, 'pin', x, y - size * 0.42, size)) {
      c.fillStyle = 'rgba(42, 26, 18, 0.28)'; c.beginPath(); c.ellipse(x + size * 0.1, y + size * 0.02, size * 0.2, size * 0.08, 0, 0, TAU); c.fill();
      c.strokeStyle = INK; c.lineWidth = Math.max(1, size * 0.06); c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - size * 0.55); c.stroke();
      c.fillStyle = '#b9603f'; c.beginPath(); c.arc(x, y - size * 0.66, size * 0.24, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = 'rgba(251, 246, 234, 0.7)'; c.beginPath(); c.arc(x - size * 0.07, y - size * 0.73, size * 0.07, 0, TAU); c.fill();
    }
    c.restore();
  }
  function drawRose(c, x, y, size) {
    if (icon(c, 'compass_rose', x, y, size)) return;
    const r = size * 0.5;
    c.save(); c.translate(x, y); c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = Math.max(0.75, size * 0.025);
    c.globalAlpha = 0.8; c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2; const len = i % 2 ? r * 0.5 : r * (i === 0 ? 1 : 0.86); const w = i % 2 ? r * 0.09 : r * 0.15;
      c.beginPath(); c.moveTo(Math.cos(a) * len, Math.sin(a) * len); c.lineTo(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w); c.lineTo(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w); c.closePath();
      if (i === 0) { c.fillStyle = '#b9603f'; c.fill(); c.fillStyle = INK; } else if (i % 2) c.stroke(); else c.fill();
    }
    c.restore();
  }

  // ---- tile thumbnails: the book's top-down bake, read back once ------------------------------------------------
  function buildThumbs() {
    const book = world && world.book;
    if (!book || !book.atlas || !book.baked || !book.modelIndex || gfx.thumbs) return;
    if (gfx.thumbTried++ > 3) return;
    try {
      const n = book.modelIndex.size;
      const cols = 8; const rows = Math.ceil(n / cols); const S = A.thumb;
      const w = cols * S; const h = rows * S;
      const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
        uniforms: { uAtlas: { value: book.atlas.texture }, uGrid: { value: new THREE.Vector2(cols, rows) }, uOdd: { value: A.print === 'base' ? 0 : 1 }, uLod: { value: Math.max(0, Math.log2(book.atlas.width / S)) } },
        vertexShader: 'in vec3 position; out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: /* glsl */ `precision highp float; precision highp sampler2DArray;
          uniform sampler2DArray uAtlas; uniform vec2 uGrid; uniform float uOdd; uniform float uLod;
          in vec2 vUv; out vec4 o;
          void main() {
            vec2 g = vUv * uGrid; vec2 c = floor(g); vec2 f = g - c;
            float idx = c.x + (uGrid.y - 1.0 - c.y) * uGrid.x;
            vec3 col = textureLod(uAtlas, vec3(f, idx * 2.0 + uOdd), uLod).rgb;
            col = mix(col * 12.92, 1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
            o = vec4(col, 1.0);
          }`,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
      const sc = new THREE.Scene(); sc.add(mesh);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(sc, gfx.cam);
      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      renderer.setRenderTarget(prev);
      rt.dispose(); mat.dispose(); geo.dispose();
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d');
      const img = c2.createImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      c2.putImageData(img, 0, 0);
      gfx.thumbs = { canvas: cv, cols, S, index: book.modelIndex };
    } catch (err) { console.warn('[atlasmap] tile prints unavailable, drawing symbols instead', err); }
  }

  // ---- data ------------------------------------------------------------------------------------------------------
  function readCells() {
    cells.clear();
    let x0 = 1e9; let x1 = -1e9; let z0 = 1e9; let z1 = -1e9;
    progress.eachCell((cx, cz, biome) => {
      cells.set(key(cx, cz), typeof biome === 'string' ? biome : 'heartland');
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
    });
    const px = Math.round(traveller.position.x / TILE_SIZE); const pz = Math.round(traveller.position.z / TILE_SIZE);
    if (!cells.size) { x0 = x1 = px; z0 = z1 = pz; }
    bounds.x0 = x0; bounds.x1 = x1; bounds.z0 = z0; bounds.z1 = z1;
    cellsDirty = false;
  }
  const frameAspect = () => (frame.x1 - frame.x0) / Math.max(1, frame.y1 - frame.y0);

  /** Centre on the traveller and zoom so the explored land fits round him (clamped). */
  function fitView() {
    const px = traveller.position.x / TILE_SIZE; const pz = traveller.position.z / TILE_SIZE;
    const hx = Math.max(px - bounds.x0, bounds.x1 - px) + 0.5 + A.fitPad;
    const hz = Math.max(pz - bounds.z0, bounds.z1 - pz) + 0.5 + A.fitPad;
    const span = clamp(Math.max(hz * 2, (hx * 2) / frameAspect()), Math.max(A.minSpan, 8), A.fitMax);
    view.fit = span;
    // centred on the traveller; when all the explored land fits anyway, the frame leans halfway toward its middle
    let ox = px; let oz = pz;
    const bw = bounds.x1 - bounds.x0 + 1 + A.fitPad * 2; const bh = bounds.z1 - bounds.z0 + 1 + A.fitPad * 2;
    const whole = Math.max(bh, bw / frameAspect());
    if (whole <= A.fitMax) {
      ox = (px + (bounds.x0 + bounds.x1) / 2) / 2; oz = (pz + (bounds.z0 + bounds.z1) / 2) / 2;
      const qx = Math.max(ox - bounds.x0, bounds.x1 - ox) + 0.5 + A.fitPad; const qz = Math.max(oz - bounds.z0, bounds.z1 - oz) + 0.5 + A.fitPad;
      view.fit = clamp(Math.max(qz * 2, (qx * 2) / frameAspect()), Math.max(A.minSpan, 8), A.fitMax);
    }
    view.x = view.tx = ox; view.z = view.tz = oz; view.span = view.tspan = view.fit;
  }
  function clampView() {
    view.tspan = clamp(view.tspan, A.minSpan, Math.max(A.maxSpan * 0.25, Math.min(A.maxSpan, view.fit * 1.6)));
    view.tx = clamp(view.tx, bounds.x0 - 2, bounds.x1 + 2);
    view.tz = clamp(view.tz, bounds.z0 - 2, bounds.z1 + 2);
  }

  // ---- the page: paper, frame, legend ------------------------------------------------------------------------
  function drawPage() {
    const g = gfx;
    const dw = renderer.domElement.width || 1280; const dh = renderer.domElement.height || 720;
    const k = Math.min(1, A.texture / Math.max(dw, dh));
    const W = Math.max(64, Math.round(dw * k)); const H = Math.max(64, Math.round(dh * k));
    const cv = g.pageCanvas;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; g.tPage.dispose(); }
    const c = cv.getContext('2d');
    const u = Math.min(W, H) / 100;
    const rng = mulberry32(0xa71a5 ^ seed);
    // cream cardstock: mottling, fibres, specks
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      const x = rng() * W; const y = rng() * H; const r = (8 + rng() * 22) * u;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      const light = rng() < 0.5;
      gr.addColorStop(0, light ? 'rgba(251, 246, 234, 0.16)' : 'rgba(205, 180, 134, 0.13)'); gr.addColorStop(1, light ? 'rgba(251, 246, 234, 0)' : 'rgba(205, 180, 134, 0)');
      c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.lineCap = 'round';
    const fibres = Math.round((W * H) / 520);
    for (let i = 0; i < fibres; i++) {
      const x = rng() * W; const y = rng() * H; const a = rng() * Math.PI; const l = (0.5 + rng() * 1.7) * u; const bend = (rng() - 0.5) * l * 0.6;
      c.strokeStyle = rng() < 0.55 ? `rgba(253, 249, 240, ${0.2 + rng() * 0.3})` : `rgba(176, 146, 100, ${0.1 + rng() * 0.16})`;
      c.lineWidth = Math.max(0.5, (0.05 + rng() * 0.09) * u);
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * l * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    for (let i = 0; i < fibres / 3; i++) { c.fillStyle = `rgba(120, 88, 56, ${0.05 + rng() * 0.12})`; c.fillRect(rng() * W, rng() * H, Math.max(1, 0.1 * u), Math.max(1, 0.1 * u)); }

    // ---- legend layout: groups flow into 1-3 rows along the bottom margin
    const s = progress.summary();
    const groups = [];
    groups.push({ label: 'Scraps', kind: 'scraps', w: SCRAP_IDS.length * 1.3 });
    groups.push({ label: 'Lanterns', kind: 'lamps', w: 2.3 });
    groups.push({ label: 'Explored', kind: 'cells', w: 2.5 });
    groups.push({ label: '', kind: 'rose', w: 1.5 });
    const GAP = 0.7;
    const margin = Math.max(10, 3.4 * u);
    const avail = W - margin * 2;
    let best = null;
    for (let R = 1; R <= 3; R++) {
      const total = groups.reduce((a, gq) => a + gq.w + GAP, 0);
      const rows = [[]]; let acc = 0;
      for (const gq of groups) {
        if (rows.length < R && acc > 0 && acc + gq.w * 0.5 > (total / R)) { rows.push([]); acc = 0; }
        rows[rows.length - 1].push(gq); acc += gq.w + GAP;
      }
      const widest = Math.max(...rows.map((r) => r.reduce((a, gq) => a + gq.w, 0) + (r.length - 1) * GAP));
      const size = Math.min(avail / widest, 5.6 * u, (H * 0.3) / (rows.length * 1.62));
      if (!best || size > best.size * 1.12) best = { rows, size };
      if (best.size >= 3.7 * u) break;
    }
    const S = best.size; const rowH = S * 1.62;
    const legendH = best.rows.length * rowH + S * 0.25;
    frame.x0 = margin; frame.y0 = margin; frame.x1 = W - margin; frame.y1 = H - margin * 0.75 - legendH;

    // ---- neatline round the map
    c.strokeStyle = INK; c.globalAlpha = 0.8; c.lineWidth = Math.max(1, 0.2 * u);
    const o1 = 0.55 * u;
    c.strokeRect(frame.x0 - o1, frame.y0 - o1, frame.x1 - frame.x0 + o1 * 2, frame.y1 - frame.y0 + o1 * 2);
    c.globalAlpha = 0.55; c.lineWidth = Math.max(0.75, 0.08 * u);
    c.strokeRect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0);
    // ticks along the frame, like the degree marks of an atlas plate
    c.globalAlpha = 0.5; c.beginPath();
    const tick = (frame.y1 - frame.y0) / 12;
    for (let x = frame.x0 + tick; x < frame.x1 - 1; x += tick) { c.moveTo(x, frame.y0 - o1); c.lineTo(x, frame.y0); c.moveTo(x, frame.y1 + o1); c.lineTo(x, frame.y1); }
    for (let y = frame.y0 + tick; y < frame.y1 - 1; y += tick) { c.moveTo(frame.x0 - o1, y); c.lineTo(frame.x0, y); c.moveTo(frame.x1 + o1, y); c.lineTo(frame.x1, y); }
    c.stroke();
    c.globalAlpha = 1;

    // ---- legend
    const label = (text, x, y, px, align = 'left', alpha = 0.72) => {
      c.save(); c.font = `600 ${px}px ${SERIF}`; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = INK; c.globalAlpha = alpha;
      if ('letterSpacing' in c) c.letterSpacing = (px * 0.16).toFixed(2) + 'px';
      c.fillText(text.toUpperCase(), x, y); c.restore();
    };
    const numeral = (text, x, y, px, align = 'left') => {
      c.save(); c.font = `italic ${px}px ${SERIF}`; c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = INK; c.globalAlpha = 0.86;
      c.fillText(String(text), x, y); c.restore();
    };
    let y = frame.y1 + o1 + S * 0.42;
    for (const row of best.rows) {
      const rw = row.reduce((a, gq) => a + gq.w, 0) + (row.length - 1) * GAP;
      let x = W / 2 - (rw * S) / 2;
      const ly = y + S * 0.3; // label baseline
      const cy = y + S * 0.48 + S * 0.55; // icon centre line
      row.forEach((gq, gi) => {
        if (gi > 0) { // a thin printed rule between groups
          c.strokeStyle = INK; c.globalAlpha = 0.22; c.lineWidth = Math.max(0.75, 0.07 * u);
          c.beginPath(); c.moveTo(x - GAP * S * 0.5, y + S * 0.1); c.lineTo(x - GAP * S * 0.5, y + S * 1.5); c.stroke(); c.globalAlpha = 1;
        }
        if (gq.label) label(gq.label, x + S * 0.04, ly, Math.max(7, S * 0.21));
        if (gq.kind === 'scraps') {
          SCRAP_IDS.forEach((id, i) => {
            const n = s.scraps[id] || 0;
            const ix = x + S * 0.42 + i * S * 1.3;
            c.save(); if (!n) c.globalAlpha = 0.32; drawScrap(c, id, ix, cy, S * 0.78); c.restore();
            numeral(n, ix + S * 0.46, cy + S * 0.16, Math.max(8, S * 0.36));
          });
        } else if (gq.kind === 'lamps') {
          drawLamp(c, x + S * 0.5, cy, S * 0.17);
          numeral(s.lanterns, x + S * 1.08, cy + S * 0.02, Math.max(9, S * 0.46));
        } else if (gq.kind === 'cells') {
          // a tiny patchwork swatch
          const q = S * 0.26; const sx = x + S * 0.1; const sy = cy - q;
          const tones = [BIOME_GROUND.heartland, BIOME_GROUND.desert, BIOME_GROUND.pinewood, BIOME_GROUND.blossom];
          for (let i = 0; i < 4; i++) { c.fillStyle = tones[i]; c.fillRect(sx + (i % 2) * q, sy + (i >> 1) * q, q, q); }
          c.strokeStyle = INK; c.globalAlpha = 0.7; c.lineWidth = Math.max(0.75, 0.08 * u); c.strokeRect(sx, sy, q * 2, q * 2); c.globalAlpha = 1;
          numeral(s.cells, x + S * 0.86, cy + S * 0.02, Math.max(9, S * 0.46));
        } else if (gq.kind === 'rose') {
          drawRose(c, x + gq.w * S * 0.5, y + S * 0.86, S * 1.3);
          label('N', x + gq.w * S * 0.5, y + S * 0.1, Math.max(7, S * 0.2), 'center', 0.8);
        }
        x += (gq.w + GAP) * S;
      });
      y += rowH;
    }
    g.tPage.needsUpdate = true;
    pageDirty = false;
  }

  // ---- the map: explored cells as a printed patchwork ------------------------------------------------------------
  function cellInfo(cx, cz) { try { return wfc.get(cx, cz); } catch { return null; } }
  const ownArt = (id) => { const m = MODELS[id]; const b = m && m.biomes; if (!b) return false; const ks = Object.keys(b).filter((q) => b[q] > 0); return ks.length === 1 && ks[0] !== 'heartland'; };

  function drawMap() {
    const g = gfx;
    if (cellsDirty) readCells();
    buildThumbs();
    const fa = frameAspect();
    const TW = fa >= 1 ? A.texture : Math.round(A.texture * fa);
    const TH = fa >= 1 ? Math.round(A.texture / fa) : A.texture;
    const cv = g.mapCanvas;
    if (cv.width !== TW || cv.height !== TH) { cv.width = TW; cv.height = TH; g.layer.width = TW; g.layer.height = TH; g.tMap.dispose(); }
    const span = view.tspan;
    const ppc = Math.min(A.thumb * 1.25, TH / (span * 1.5));
    win.x = view.tx; win.z = view.tz; win.ppc = ppc; win.span = span; win.ok = true;
    const X = (cx) => (cx - win.x) * ppc + TW / 2;
    const Y = (cz) => (cz - win.z) * ppc + TH / 2;
    const cx0 = Math.floor(win.x - TW / 2 / ppc) - 1; const cx1 = Math.ceil(win.x + TW / 2 / ppc) + 1;
    const cz0 = Math.floor(win.z - TH / 2 / ppc) - 1; const cz1 = Math.ceil(win.z + TH / 2 / ppc) + 1;
    const has = (cx, cz) => cells.has(key(cx, cz));
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, TW, TH);

    // faint graticule on the blank paper
    c.strokeStyle = INK; c.globalAlpha = 0.075; c.lineWidth = Math.max(0.75, ppc * 0.012);
    const stepG = ppc < 14 ? 4 : ppc < 28 ? 2 : 1;
    c.beginPath();
    for (let x = Math.ceil(cx0 / stepG) * stepG; x <= cx1; x += stepG) { c.moveTo(X(x - 0.5), 0); c.lineTo(X(x - 0.5), TH); }
    for (let z = Math.ceil(cz0 / stepG) * stepG; z <= cz1; z += stepG) { c.moveTo(0, Y(z - 0.5)); c.lineTo(TW, Y(z - 0.5)); }
    c.stroke(); c.globalAlpha = 1;

    // 1. the print: explored cells plus their fringe, on a work layer
    const l = g.layer.getContext('2d');
    l.setTransform(1, 0, 0, 1, 0, 0); l.globalAlpha = 1; l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, TW, TH);
    const th = g.thumbs;
    const list = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const mine = has(cx, cz);
        if (!mine && !(has(cx - 1, cz) || has(cx + 1, cz) || has(cx, cz - 1) || has(cx, cz + 1) || has(cx - 1, cz - 1) || has(cx + 1, cz - 1) || has(cx - 1, cz + 1) || has(cx + 1, cz + 1))) continue;
        const info = cellInfo(cx, cz);
        if (!info) continue;
        const biome = info.biome || cells.get(key(cx, cz)) || 'heartland';
        const x = X(cx - 0.5); const y = Y(cz - 0.5); const sz = ppc + 0.6;
        const idx = th ? th.index.get(info.model) : undefined;
        if (th && idx !== undefined) {
          l.save();
          l.translate(X(cx), Y(cz)); l.rotate((info.rot || 0) * Math.PI / 2);
          l.drawImage(th.canvas, (idx % th.cols) * th.S + 1, Math.floor(idx / th.cols) * th.S + 1, th.S - 2, th.S - 2, -sz / 2, -sz / 2, sz, sz);
          l.restore();
          if (!ownArt(info.model)) {
            for (const w of BIOME_WASH[biome] || []) { l.globalCompositeOperation = w[0]; l.globalAlpha = w[2]; l.fillStyle = w[1]; l.fillRect(x, y, sz, sz); }
            l.globalCompositeOperation = 'source-over'; l.globalAlpha = 1;
          }
        } else {
          l.fillStyle = BIOME_GROUND[biome] || BIOME_GROUND.heartland; l.fillRect(x, y, sz, sz);
        }
        if (mine) list.push(cx, cz, info);
      }
    }
    // a thin veil of paper keeps the print matte and a little faded, like an old plate
    l.globalAlpha = 0.16; l.fillStyle = PAPER; l.fillRect(0, 0, TW, TH); l.globalAlpha = 1;

    // 2. soft torn edge: keep the print only where the land is explored (low-res mask, smoothed on upscale)
    const MS = 4; const mw = (cx1 - cx0 + 1) * MS; const mh = (cz1 - cz0 + 1) * MS;
    g.mask.width = mw; g.mask.height = mh;
    const m = g.mask.getContext('2d');
    m.fillStyle = '#fff';
    for (let i = 0; i < list.length; i += 3) {
      const cx = list[i]; const cz = list[i + 1];
      // ragged by a deterministic nibble on the open sides
      const n = has(cx, cz - 1) ? 0 : hash(cx, cz, 1) < 0.5 ? 0 : 1; const so = has(cx, cz + 1) ? 0 : hash(cx, cz, 2) < 0.5 ? 0 : 1;
      const we = has(cx - 1, cz) ? 0 : hash(cx, cz, 3) < 0.5 ? 0 : 1; const ea = has(cx + 1, cz) ? 0 : hash(cx, cz, 4) < 0.5 ? 0 : 1;
      m.fillRect((cx - cx0) * MS - 1 + we, (cz - cz0) * MS - 1 + n, MS + 2 - we - ea, MS + 2 - n - so);
    }
    l.globalCompositeOperation = 'destination-in'; l.imageSmoothingEnabled = true; l.imageSmoothingQuality = 'high';
    l.drawImage(g.mask, X(cx0 - 0.5), Y(cz0 - 0.5), (cx1 - cx0 + 1) * ppc, (cz1 - cz0 + 1) * ppc);
    l.globalCompositeOperation = 'source-over';
    c.drawImage(g.layer, 0, 0);

    // 3. ink: the coast line round the explored land (corner points are shared, so the wobbling line is continuous)
    const jx = (vx, vz) => X(vx - 0.5 + (hash(vx, vz, 11) - 0.5) * 0.2);
    const jz = (vx, vz) => Y(vz - 0.5 + (hash(vx, vz, 12) - 0.5) * 0.2);
    const coast = new Path2D();
    const edge = (ax, az, bx, bz, k) => {
      const x0 = jx(ax, az); const y0 = jz(ax, az); const x1 = jx(bx, bz); const y1 = jz(bx, bz);
      const w = (hash(ax + bx, az + bz, 13 + k) - 0.5) * 0.22 * ppc;
      const nx = -(y1 - y0); const ny = x1 - x0; const nl = Math.hypot(nx, ny) || 1;
      coast.moveTo(x0, y0); coast.quadraticCurveTo((x0 + x1) / 2 + (nx / nl) * w, (y0 + y1) / 2 + (ny / nl) * w, x1, y1);
    };
    for (let i = 0; i < list.length; i += 3) {
      const cx = list[i]; const cz = list[i + 1];
      if (!has(cx, cz - 1)) edge(cx, cz, cx + 1, cz, 0);
      if (!has(cx, cz + 1)) edge(cx, cz + 1, cx + 1, cz + 1, 0);
      if (!has(cx - 1, cz)) edge(cx, cz, cx, cz + 1, 1);
      if (!has(cx + 1, cz)) edge(cx + 1, cz, cx + 1, cz + 1, 1);
    }
    c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK;
    c.globalAlpha = 0.1; c.lineWidth = Math.max(3, ppc * 0.3); c.stroke(coast);
    c.globalAlpha = 0.1; c.lineWidth = Math.max(2, ppc * 0.13); c.stroke(coast);
    c.globalAlpha = 0.78; c.lineWidth = Math.max(1.1, ppc * 0.035); c.stroke(coast);

    // dashed lanes inked over the print
    if (A.inkPaths || !th) {
      const lanes = new Path2D(); const water = new Path2D();
      const DX = { n: 0, e: 1, s: 0, w: -1 }; const DZ = { n: -1, e: 0, s: 1, w: 0 };
      for (let i = 0; i < list.length; i += 3) {
        const cx = list[i]; const cz = list[i + 1]; const so = list[i + 2].sockets;
        if (!so) continue;
        for (const d in DX) {
          const p = so[d] === 'path' ? lanes : so[d] === 'river' ? water : null;
          if (!p) continue;
          p.moveTo(X(cx), Y(cz)); p.lineTo(X(cx + DX[d] * 0.5), Y(cz + DZ[d] * 0.5));
        }
      }
      if (!th) { c.globalAlpha = 0.6; c.strokeStyle = P.teal || '#5e9c9a'; c.lineWidth = Math.max(1.5, ppc * 0.2); c.stroke(water); }
      c.globalAlpha = 0.62; c.strokeStyle = INK; c.lineWidth = Math.max(1, ppc * 0.034);
      c.setLineDash([ppc * 0.11, ppc * 0.09]); c.stroke(lanes); c.setLineDash([]);
    }
    c.globalAlpha = 1;

    // 4. marks: lanterns, the traveller's pin (sized for the zoom they were drawn at)
    const mark = Math.max(1.1, span * 0.075) * ppc;
    for (const p of lamps.values()) {
      const x = X(p[0]); const y = Y(p[1]);
      if (x > -20 && y > -20 && x < TW + 20 && y < TH + 20) drawLamp(c, x, y, Math.max(2, mark * 0.07));
    }
    const md = traveller.moveDir || { x: 0, z: -1 };
    drawPin(c, X(traveller.position.x / TILE_SIZE), Y(traveller.position.z / TILE_SIZE), mark * 0.8, md.x, md.z);

    g.tMap.needsUpdate = true;
    mapDirty = false;
  }

  function syncUniforms(e) {
    const U = gfx.mat.uniforms;
    const W = gfx.pageCanvas.width; const H = gfx.pageCanvas.height;
    const cpp = view.span / Math.max(1, frame.y1 - frame.y0); // cells per page pixel
    U.uView.value.set(view.x, view.z, cpp * W, cpp * H);
    U.uWin.value.set(win.x, win.z, win.ppc / gfx.mapCanvas.width, win.ppc / gfx.mapCanvas.height);
    U.uFrame.value.set(frame.x0 / W, 1 - frame.y1 / H, frame.x1 / W, 1 - frame.y0 / H);
    U.uFeather.value.set(1.5 / W, 1.5 / H);
    U.uAspect.value = W / H;
    U.uSlide.value.set(0, -(1 - e) * 2.75, (1 - e) * -0.07);
    U.uNight.value = night;
  }

  /** Does the drawn window still cover the view at a fair resolution? */
  function windowStale() {
    if (!win.ok) return 2;
    const tw = gfx.mapCanvas.width / win.ppc; const thh = gfx.mapCanvas.height / win.ppc;
    const vh = view.span; const vw = vh * frameAspect();
    if (Math.abs(view.x - win.x) + vw / 2 > tw / 2 || Math.abs(view.z - win.z) + vh / 2 > thh / 2) return 2; // the view left the window
    const r = view.tspan / win.span;
    if (r < 0.62 || r > 1.25 || Math.abs(view.tx - win.x) > vw * 0.2 || Math.abs(view.tz - win.z) > vh * 0.2) return 1; // worth a redraw once the hand rests
    return 0;
  }

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function liftCamera(e) {
    if (!follow || !follow.setPose || !basePose) return;
    if (e <= 0) { follow.setPose(basePose); return; }
    const d = basePose.distance ?? CONFIG.camera.distance; const p = basePose.pitchDeg ?? CONFIG.camera.pitchDeg;
    follow.setPose({ ...basePose, distance: d * (1 + A.lift * e), pitchDeg: p + (Math.max(p, A.liftPitch) - p) * e, driftAmp: (basePose.driftAmp || 0) * (1 - e) });
  }

  function setOpen(v) {
    v = !!v;
    if (v === want || headless) return;
    want = v;
    if (v) {
      ensureGfx();
      if (t <= 0 && follow) basePose = follow.pose;
      progress.save && loadLamps();
      night = t > 0 ? night : nightGoal();
      readCells();
      drawPage(); // sets the frame
      fitView();
      drawMap();
      held.clear();
    } else {
      held.clear(); drag = null;
      if (controls && controls.clearTarget) controls.clearTarget();
    }
  }

  // ---- input (only consumed while the page is open) ----------------------------------------------------------------
  const PAN = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  let drag = null;
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Tab' || e.code === 'KeyE') {
      e.preventDefault();
      if (!e.repeat) api.toggle();
      return;
    }
    if (!want) return;
    if (e.code === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (PAN[e.code]) { held.add(e.code); e.stopPropagation(); e.preventDefault(); return; }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { view.tspan *= 0.8; zoomIdle = 0; clampView(); } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { view.tspan *= 1.25; zoomIdle = 0; clampView(); }
  }
  function onKeyUp(e) { held.delete(e.code); }
  function onPointerDown(e) {
    if (!want) return;
    e.stopPropagation();
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
  }
  function onPointerMove(e) {
    if (!want) return;
    e.stopPropagation();
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    const fh = ((frame.y1 - frame.y0) / Math.max(1, gfx.pageCanvas.height)) * Math.max(1, window.innerHeight);
    const k = view.span / Math.max(1, fh);
    view.tx -= dx * k; view.tz -= dy * k; clampView();
    view.x = view.tx; view.z = view.tz; // the paper follows the hand exactly
  }
  function onPointerUp(e) {
    if (!want && !drag) return;
    if (want) e.stopPropagation();
    const d = drag; drag = null;
    if (want && d && d.moved < 6) setOpen(false); // a plain click puts the map away
  }
  function onWheel(e) {
    if (!want) return;
    e.preventDefault();
    view.tspan *= Math.exp(clamp(e.deltaY, -240, 240) * 0.0016); zoomIdle = 0; clampView();
  }
  function onBlur() { held.clear(); drag = null; }
  if (!headless) {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('blur', onBlur);
  }

  function refresh(force) {
    if (!gfx) return;
    if (pageDirty) { const fy = frame.y1; drawPage(); if (fy !== frame.y1) mapDirty = true; }
    if (mapDirty || force) drawMap();
  }

  loadIcons();
  const api = {
    /** True from the key press that opens the page until the one that closes it (walking input is ignored). */
    get open() { return want; },
    /** 0 closed .. 1 fully open (eased). */
    get amount() { return ease(t); },
    toggle() { setOpen(!want); return want; },
    show(v = true) { setOpen(v); },
    /** Redraw the page and the map now (they otherwise redraw only when progress changes while open). */
    redraw() { if (!gfx) return; pageDirty = true; mapDirty = true; refresh(true); },
    update(dt) {
      if (!gfx || (!want && t <= 0)) return; // closed: nothing to do
      const before = t;
      t = clamp(t + (want ? dt : -dt) / Math.max(0.05, A.duration), 0, 1);
      if (t !== before || (t > 0 && t < 1)) liftCamera(ease(t));
      if (t <= 0) { basePose = null; return; }
      night += (nightGoal() - night) * Math.min(1, dt * 3.5);
      if (!want) return;
      // pan / zoom
      if (held.size) {
        let px = 0; let pz = 0;
        for (const k of held) { px += PAN[k][0]; pz += PAN[k][1]; }
        view.tx += px * view.span * A.panSpeed * dt; view.tz += pz * view.span * A.panSpeed * dt; clampView();
      }
      clampView();
      const k = 1 - Math.exp(-dt * 14);
      view.x += (view.tx - view.x) * k; view.z += (view.tz - view.z) * k; view.span += (view.tspan - view.span) * k;
      zoomIdle += dt;
      refresh(false);
      const stale = windowStale();
      if (stale === 2 || (stale === 1 && zoomIdle > 0.18 && !drag && !held.size)) drawMap();
    },
    /** Finish the transition at once (captures). */
    settle() {
      if (!gfx) return;
      t = want ? 1 : 0;
      night = nightGoal();
      clampView();
      liftCamera(t);
      if (!want) basePose = null;
      view.x = view.tx; view.z = view.tz; view.span = view.tspan;
      if (want) { refresh(false); if (windowStale()) drawMap(); }
    },
    /** Draw the page over the finished frame (called by main.js right after post.render). Free while closed. */
    render() {
      if (!gfx || t <= 0) return;
      syncUniforms(ease(t));
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.render(gfx.scene, gfx.cam);
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(prevTarget);
    },
    /** Debug / checks: the view, the frame and the helper canvases. */
    get view() { return view; },
    get debug() { return gfx ? { thumbs: gfx.thumbs && gfx.thumbs.canvas, map: gfx.mapCanvas, page: gfx.pageCanvas, icons: !!iconTable, frame, win, lamps: lamps.size } : null; },
    dispose() {
      for (const off of offs) off();
      if (!headless) {
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);
        window.removeEventListener('wheel', onWheel, { capture: true });
        window.removeEventListener('blur', onBlur);
      }
      if (basePose && follow) follow.setPose(basePose);
      if (gfx) { gfx.tPage.dispose(); gfx.tMap.dispose(); gfx.geo.dispose(); gfx.mat.dispose(); gfx = null; }
      want = false; t = 0;
    },
  };
  void quality;
  return api;
}
