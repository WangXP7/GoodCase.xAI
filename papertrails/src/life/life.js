// Ambient life + weather. Everything lives in TWO draw calls:
//   bits  one InstancedMesh of small creased cut-paper pieces (alpha-tested shape atlas, lit by the scene
//         lights, written to depth so the post pipeline gives them DOF, AO and the pale paper-core line):
//         leaves, snow, petals, rain streaks + page splashes, dust motes, sand gusts, butterflies, birds, smoke.
//   soft  one InstancedMesh of premultiplied soft quads (no depth write): mist cards, cloud shadows and bird
//         shadows (dark, effectively multiplicative) and fireflies (additive, the only glowing pieces).
// Positions are pure functions of state.time, wrapped in a box around the
// traveller; densities follow core/biomes.js biomeWeights (centre + gradient, so each piece uses the mix at
// its own spot) and a smoothed day/night amount. No per-frame allocation. Tunables: core/config/life.js.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { bus } from '../core/events.js';
import { state } from '../core/state.js';
import { BIOMES, BIOME_INDEX, biomeWeights } from '../core/biomes.js';
import { mulberry32 } from '../core/rng.js';
import { paperUniforms } from '../render/materials.js';

const KINDS = ['leaves', 'dust', 'gusts', 'snow', 'petals', 'rain', 'mist', 'fireflies', 'butterflies', 'clouds', 'birds'];
const K = {};
KINDS.forEach((k, i) => { K[k] = i; });
const NB = BIOMES.length;
const NK = KINDS.length;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const GRAD = 5; // world units between the biome-weight samples

function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const smooth = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const mix = (r, t) => r[0] + (r[1] - r[0]) * t;

// ---- shape atlas (4 x 4 cells, white paper shapes with a darker "thickness" lip) ------------------------
const CELLS = { leaf: 0, flake: 1, petal: 2, bar: 3, ring: 4, smoke: 5, bird: 6, flyWing: 7, dot: 8, leaf2: 9 };
const GRID = 4;

function makeShapeTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * GRID;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const cell = (i, draw, lip = true) => {
    g.save();
    g.translate((i % GRID) * S + S / 2, Math.floor(i / GRID) * S + S / 2);
    g.scale(S * 0.42, S * 0.42);
    if (lip) { g.save(); g.translate(0.07, 0.09); g.fillStyle = g.strokeStyle = '#a9a092'; draw(false); g.restore(); }
    g.fillStyle = g.strokeStyle = '#ffffff';
    draw(true);
    g.restore();
  };
  const crease = (pts) => { g.save(); g.strokeStyle = '#d2cabb'; g.lineWidth = 0.07; g.lineCap = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); g.restore(); };
  const poly = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };

  cell(CELLS.leaf, (top) => {
    g.beginPath(); g.moveTo(0, -1); g.quadraticCurveTo(0.82, -0.1, 0, 1); g.quadraticCurveTo(-0.82, -0.1, 0, -1); g.fill();
    if (top) crease([0, -0.8, 0, 0.9]);
  });
  cell(CELLS.leaf2, (top) => {
    poly([0, -1, 0.3, -0.45, 0.85, -0.55, 0.6, -0.05, 0.95, 0.3, 0.4, 0.4, 0.3, 0.95, 0, 0.6, -0.3, 0.95, -0.4, 0.4, -0.95, 0.3, -0.6, -0.05, -0.85, -0.55, -0.3, -0.45]);
    if (top) crease([0, -0.7, 0, 0.8]);
  });
  cell(CELLS.flake, () => { poly([0, -0.9, 0.8, -0.42, 0.74, 0.5, 0, 0.92, -0.8, 0.46, -0.76, -0.44]); });
  cell(CELLS.petal, (top) => {
    g.beginPath(); g.moveTo(0, 1); g.bezierCurveTo(0.95, 0.5, 0.75, -0.9, 0.12, -0.92); g.lineTo(0, -0.7); g.lineTo(-0.12, -0.92); g.bezierCurveTo(-0.75, -0.9, -0.95, 0.5, 0, 1); g.fill();
    if (top) crease([0, -0.5, 0, 0.8]);
  });
  cell(CELLS.bar, () => { g.fillRect(-1.1, -1.1, 2.2, 2.2); }, false);
  cell(CELLS.ring, () => { g.lineWidth = 0.24; g.beginPath(); g.arc(0, 0, 0.8, 0, TAU); g.stroke(); }, false);
  cell(CELLS.smoke, (top) => {
    // animals round 3: ONE round paper disc with a cut spiral, like the stacked puffs of the gold image (was a five-lobed cloud)
    g.beginPath(); g.arc(0, 0, 0.9, 0, TAU); g.fill();
    if (top) { // cut spiral curl
      g.save(); g.strokeStyle = '#cfc7b9'; g.lineWidth = 0.08; g.lineCap = 'round'; g.beginPath();
      for (let a = 0; a <= 9.5; a += 0.2) { const r = 0.07 + a * 0.062; const x = 0.02 + Math.cos(a) * r; const y = -0.05 + Math.sin(a) * r; if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke(); g.restore();
    }
  });
  // bird seen from above, nose toward the canvas top; the quad's centre crease is its body, so the wings fold on it
  cell(CELLS.bird, (top) => {
    poly([0, -0.78, 0.16, -0.42, 0.62, -0.5, 1.12, -0.08, 0.6, -0.08, 0.2, 0.12, 0.12, 0.5, 0.3, 0.86, 0, 0.72, -0.3, 0.86, -0.12, 0.5, -0.2, 0.12, -0.6, -0.08, -1.12, -0.08, -0.62, -0.5, -0.16, -0.42]);
    if (top) crease([0, -0.6, 0, 0.6]);
  });
  // butterfly wing: hinge on the LEFT cell edge, leading edge toward the canvas top
  cell(CELLS.flyWing, (top) => {
    g.beginPath(); g.ellipse(-0.18, -0.38, 0.95, 0.56, -0.25, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(-0.42, 0.48, 0.62, 0.46, 0.3, 0, TAU); g.fill();
    if (top) { g.save(); g.fillStyle = '#c9c0b0'; g.beginPath(); g.arc(0.25, -0.42, 0.16, 0, TAU); g.fill(); g.beginPath(); g.arc(-0.3, 0.55, 0.12, 0, TAU); g.fill(); g.restore(); }
  });
  cell(CELLS.dot, () => { g.beginPath(); g.arc(0, 0, 0.85, 0, TAU); g.fill(); }, false);

  // Canvas pixels are premultiplied, so everything outside a shape is transparent BLACK and the small mips
  // would darken the rims. Copy to a data texture with white under alpha 0 (rows flipped: v up).
  const N = cv.width;
  const src = g.getImageData(0, 0, N, N).data;
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const s = (y * N + x) * 4; const d = ((N - 1 - y) * N + x) * 4;
      const a = src[s + 3];
      if (a < 8) { px[d] = px[d + 1] = px[d + 2] = 255; px[d + 3] = 0; } else { px[d] = src[s]; px[d + 1] = src[s + 1]; px[d + 2] = src[s + 2]; px[d + 3] = a; }
    }
  }
  const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** uv rect [u0, v0, w, h] of a shape cell (canvas texture, flipY => v up). flip mirrors v. */
function cellRect(out, o, c, flip = false) {
  const col = c % GRID; const row = Math.floor(c / GRID);
  if (c === CELLS.bar) { out[o] = (col + 0.5) / GRID; out[o + 1] = 1 - (row + 0.5) / GRID; out[o + 2] = 0; out[o + 3] = 0; return; }
  out[o] = col / GRID; out[o + 2] = 1 / GRID;
  if (flip) { out[o + 1] = 1 - row / GRID; out[o + 3] = -1 / GRID; } else { out[o + 1] = 1 - (row + 1) / GRID; out[o + 3] = 1 / GRID; }
}

function creasedQuad() {
  const b = 0.16;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, b, 0, -0.5, 0, 0, 0.5, 0, -0.5, 0.5, b, 0, -0.5, 0, 0.5, -0.5, b, 0.5, 0.5, b, 0, 0.5, 0], 3));
  const nx = 0.305; const nz = 0.952;
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz, -nx, 0, nz, -nx, 0, nz, -nx, 0, nz, -nx, 0, nz], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geo;
}

const SOFT_VERT = /* glsl */ `
attribute vec4 aCol; attribute vec4 aPar;
varying vec4 vCol; varying vec4 vPar; varying vec2 vUv;
void main() {
  vCol = aCol; vPar = aPar; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( position, 1.0 );
  if ( aPar.y > 0.5 ) gl_Position.z = -0.999 * gl_Position.w; // ground shadows darken whatever stands on them
}`;
const SOFT_FRAG = /* glsl */ `
varying vec4 vCol; varying vec4 vPar; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length( p );
  float a;
  if ( vPar.w < 0.5 ) { a = pow( max( 0.0, 1.0 - r ), 2.2 ); }
  else {
    float ang = atan( p.y, p.x );
    r *= 1.0 + 0.13 * sin( ang * 3.0 + vPar.z * 6.283 ) + 0.07 * sin( ang * 5.0 + vPar.z * 17.0 );
    a = smoothstep( 1.0, 0.2, r );
  }
  a *= vCol.a;
  gl_FragColor = vec4( vCol.rgb * a, a * vPar.x ); // premultiplied; vPar.x = 0 => additive
}`;

export function createLife({ scene, assets, wfc, daynight, camera, quality = 'high', seed = state.seed, world = null }) {
  // Weather lands on the world surface, including bridge decks.
  const L = CONFIG.life;
  const C = L.counts;
  const qScale = quality === 'low' ? 0.5 : quality === 'med' ? 0.8 : 1;

  // ---- slot layout -------------------------------------------------------------------------------------
  let n = 0;
  const slot = (count) => { const s = n; n += count; return s; };
  const S = {
    leaves: slot(C.leaves), snow: slot(C.snow), petals: slot(C.petals), rain: slot(C.rain), dust: slot(C.dust), gusts: slot(C.gusts),
    butterflies: slot(C.butterflies * 2), birds: slot(C.flocks * C.flockSize * 2), smoke: slot(C.smokeEmitters * C.smokePuffs),
  };
  const NBITS = n;
  n = 0;
  const T = { mist: slot(C.mist), clouds: slot(C.clouds), birdShadows: slot(C.flocks * C.flockSize), fireflies: slot(C.fireflies) };
  const NSOFT = n;

  const rng = mulberry32(0x51f3 + 977);
  const R = new Float32Array(NBITS * 6);
  for (let i = 0; i < R.length; i++) R[i] = rng();
  const Q = new Float32Array(NSOFT * 6);
  for (let i = 0; i < Q.length; i++) Q[i] = rng();

  // ---- bits mesh ---------------------------------------------------------------------------------------
  const shapeTex = makeShapeTexture();
  const artTex = (assets && assets.textures && assets.textures.art) || null;
  const bitsMat = new THREE.MeshLambertMaterial({ map: shapeTex, side: THREE.DoubleSide, alphaTest: 0.5 });
  const artUniform = { value: artTex || shapeTex };
  const liftUniform = { value: 0 }; // night: a little self-light on the plain paper bits, so flakes stay paper-white instead of ambient blue
  bitsMat.onBeforeCompile = (shader) => {
    shader.uniforms.uLifeArt = artUniform;
    shader.uniforms.uLifeLift = liftUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute float aTex;\nvarying float vLifeTex;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aRect.xy + uv * aRect.zw;\n\tvLifeTex = aTex;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLifeArt;\nuniform float uLifeLift;\nvarying float vLifeTex;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uLifeLift * ( 1.0 - step( 0.5, vLifeTex ) );')
      .replace('#include <map_fragment>', '\tvec4 lifeTexel = texture2D( map, vMapUv );\n\tif ( vLifeTex > 0.5 ) lifeTexel = texture2D( uLifeArt, vMapUv );\n\tdiffuseColor *= lifeTexel;');
  };
  bitsMat.customProgramCacheKey = () => 'life-bits';
  const bitsGeo = creasedQuad();
  const rectArr = new Float32Array(NBITS * 4);
  const texArr = new Float32Array(NBITS);
  const rectAttr = new THREE.InstancedBufferAttribute(rectArr, 4);
  rectAttr.setUsage(THREE.DynamicDrawUsage);
  const texAttr = new THREE.InstancedBufferAttribute(texArr, 1);
  bitsGeo.setAttribute('aRect', rectAttr);
  bitsGeo.setAttribute('aTex', texAttr);
  const bits = new THREE.InstancedMesh(bitsGeo, bitsMat, NBITS);
  bits.name = 'life_bits';
  bits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bits.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NBITS * 3), 3);
  bits.frustumCulled = false;
  bits.castShadow = false;
  bits.receiveShadow = false;
  const M = bits.instanceMatrix.array;
  M.fill(0);
  for (let i = 0; i < NBITS; i++) M[i * 16 + 15] = 1;

  const col = new THREE.Color();
  function paint(start, count, colors, cells, stride = 1) {
    const ca = bits.instanceColor.array;
    for (let j = 0; j < count; j++) {
      const i = start + j;
      const pick = Math.floor(j / stride);
      col.set(colors[Math.floor(hash3(pick, start, 3) * colors.length) % colors.length]);
      const shade = 0.9 + 0.1 * hash3(pick, start, 4);
      ca[i * 3] = col.r * shade; ca[i * 3 + 1] = col.g * shade; ca[i * 3 + 2] = col.b * shade;
      cellRect(rectArr, i * 4, cells[Math.floor(hash3(pick, start, 5) * cells.length) % cells.length], stride === 2 && j % 2 === 1);
    }
  }
  paint(S.leaves, C.leaves, L.leaves.colors, [CELLS.leaf, CELLS.leaf2, CELLS.leaf]);
  paint(S.snow, C.snow, L.snow.colors, [CELLS.flake, CELLS.dot]);
  paint(S.petals, C.petals, L.petals.colors, [CELLS.petal]);
  paint(S.rain, C.rain, L.rain.colors, [CELLS.bar]);
  paint(S.dust, C.dust, L.dust.colors, [CELLS.dot, CELLS.flake]);
  paint(S.gusts, C.gusts, L.gusts.colors, [CELLS.bar]);
  paint(S.butterflies, C.butterflies * 2, L.butterflies.colors, [CELLS.flyWing], 2);
  paint(S.birds, C.flocks * C.flockSize * 2, L.birds.colors, [CELLS.bird]);
  paint(S.smoke, C.smokeEmitters * C.smokePuffs, L.smoke.color, [CELLS.smoke]);

  // ---- soft mesh ---------------------------------------------------------------------------------------
  const softGeo = new THREE.PlaneGeometry(1, 1);
  const colArr = new Float32Array(NSOFT * 4);
  const parArr = new Float32Array(NSOFT * 4);
  const colAttr = new THREE.InstancedBufferAttribute(colArr, 4);
  const parAttr = new THREE.InstancedBufferAttribute(parArr, 4);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  parAttr.setUsage(THREE.DynamicDrawUsage);
  softGeo.setAttribute('aCol', colAttr);
  softGeo.setAttribute('aPar', parAttr);
  const softMat = new THREE.ShaderMaterial({
    vertexShader: SOFT_VERT, fragmentShader: SOFT_FRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const soft = new THREE.InstancedMesh(softGeo, softMat, NSOFT);
  soft.name = 'life_soft';
  soft.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  soft.frustumCulled = false;
  soft.castShadow = soft.receiveShadow = false;
  soft.renderOrder = 50;
  const SM = soft.instanceMatrix.array;
  SM.fill(0);
  for (let i = 0; i < NSOFT; i++) SM[i * 16 + 15] = 1;

  const group = new THREE.Group();
  group.name = 'life';
  group.add(bits, soft);
  scene.add(group);

  // ---- instance writers (allocation-free) ----------------------------------------------------------------
  function hide(A, i) { const o = i * 16; A[o] = A[o + 1] = A[o + 2] = A[o + 4] = A[o + 5] = A[o + 6] = A[o + 8] = A[o + 9] = A[o + 10] = 0; }
  /** R = Ry(yaw) * Rx(pitch) * Rz(roll); the quad lies in local XY (normal +Z), scaled sx / sy. */
  function put(A, i, x, y, z, yaw, pitch, roll, sx, sy) {
    const o = i * 16;
    const cy = Math.cos(yaw); const sy_ = Math.sin(yaw); const cx = Math.cos(pitch); const sx_ = Math.sin(pitch); const cz = Math.cos(roll); const sz = Math.sin(roll);
    A[o] = (cy * cz + sy_ * sx_ * sz) * sx; A[o + 1] = cx * sz * sx; A[o + 2] = (-sy_ * cz + cy * sx_ * sz) * sx;
    A[o + 4] = (-cy * sz + sy_ * sx_ * cz) * sy; A[o + 5] = cx * cz * sy; A[o + 6] = (sy_ * sz + cy * sx_ * cz) * sy;
    A[o + 8] = sy_ * cx * sx; A[o + 9] = -sx_ * sx; A[o + 10] = cy * cx * sx;
    A[o + 12] = x; A[o + 13] = y; A[o + 14] = z;
  }
  /** Explicit basis: X (unit) and Y (unit) axes, Z = X x Y (sz scales the crease depth: the fold angle). */
  function putBasis(A, i, x, y, z, Xx, Xy, Xz, Yx, Yy, Yz, sx, sy, sz = sx) {
    const o = i * 16;
    A[o] = Xx * sx; A[o + 1] = Xy * sx; A[o + 2] = Xz * sx;
    A[o + 4] = Yx * sy; A[o + 5] = Yy * sy; A[o + 6] = Yz * sy;
    A[o + 8] = (Xy * Yz - Xz * Yy) * sz; A[o + 9] = (Xz * Yx - Xx * Yz) * sz; A[o + 10] = (Xx * Yy - Xy * Yx) * sz;
    A[o + 12] = x; A[o + 13] = y; A[o + 14] = z;
  }
  function softPut(i, x, y, z, yaw, pitch, sx, sy, r, g, b, a, opacity, front, shape) {
    put(SM, i, x, y, z, yaw, pitch, 0, sx, sy);
    const o = i * 4;
    colArr[o] = r; colArr[o + 1] = g; colArr[o + 2] = b; colArr[o + 3] = a;
    parArr[o] = opacity; parArr[o + 1] = front; parArr[o + 2] = Q[i * 6 + 5]; parArr[o + 3] = shape;
  }
  function softHide(i) { hide(SM, i); colArr[i * 4 + 3] = 0; }

  // ---- state ----------------------------------------------------------------------------------------------
  const wC = new Float32Array(NB); const wE = new Float32Array(NB); const wW = new Float32Array(NB); const wN = new Float32Array(NB); const wS = new Float32Array(NB);
  const dC = new Float32Array(NK); const dGx = new Float32Array(NK); const dGz = new Float32Array(NK);
  let forced = -1;
  let enabled = L.enabled !== false;
  let nightAmt = daynight && daynight.night ? 1 : 0;
  let time = 0; let fx = 0; let fz = 0; let camYaw = 0; let camElev = 0.9; let camHX = 0; let camHZ = 0.8; // camHX/Z: ground offset toward the camera per unit of height
  let windX = 0.94; let windZ = 0.34;
  let lightX = 0.4; let lightZ = 0.3; // ground offset of a shadow per unit of height
  let keyLight = null; let keySearched = false;
  const findKey = (o) => { if (!keyLight && o.isDirectionalLight && o.castShadow) keyLight = o; };
  const cMist = new THREE.Color(); const cMistN = new THREE.Color('#2a3350'); const cMistD = new THREE.Color('#e3e9ea');
  const cCloud = new THREE.Color(); const cFly = new THREE.Color();

  // chimney emitters (filled from tile:rise / tile:flat)
  const NE = C.smokeEmitters;
  const _sp = [0, 0, 0];
  const eOn = new Uint8Array(NE); const eX = new Float32Array(NE); const eY = new Float32Array(NE); const eZ = new Float32Array(NE);
  const eSince = new Float64Array(NE); const eCx = new Int32Array(NE); const eCz = new Int32Array(NE);
  function dropCell(cx, cz) { for (let e = 0; e < NE; e++) if (eOn[e] && eCx[e] === cx && eCz[e] === cz) eOn[e] = 0; }
  const offRise = bus.on('tile:rise', (ev) => {
    const cell = wfc.get(ev.x, ev.z);
    if (!cell || !cell.tags || !cell.tags.includes('house')) return;
    for (let e = 0; e < NE; e++) if (eOn[e] && eCx[e] === ev.x && eCz[e] === ev.z) return;
    const offs = L.smoke.offsets[cell.model] || L.smoke.offsets.default;
    const ry = -(cell.rot || 0) * HALF_PI; const c = Math.cos(ry); const s = Math.sin(ry);
    for (let k = 0; k < offs.length; k++) {
      let e = 0;
      while (e < NE && eOn[e]) e++;
      if (e >= NE) return;
      // shortfall pass: the offsets are authored chimney tops; houses are drawn larger (world.standPoint moves the point with them)
      _sp[0] = offs[k][0]; _sp[1] = offs[k][1]; _sp[2] = offs[k][2];
      const wd = world;
      if (wd && wd.standPoint && CONFIG.world.cards && CONFIG.world.cards.collide !== false) wd.standPoint(cell.model, _sp);
      const u = _sp[0]; const v = _sp[2];
      eOn[e] = 1; eCx[e] = ev.x; eCz[e] = ev.z; eSince[e] = state.time;
      eX[e] = ev.x * TILE_SIZE + u * c + v * s; eY[e] = _sp[1]; eZ[e] = ev.z * TILE_SIZE - u * s + v * c;
    }
  });
  const offFlat = bus.on('tile:flat', (ev) => dropCell(ev.x, ev.z));
  const offDespawn = bus.on('tile:despawn', (ev) => dropCell(ev.x, ev.z));

  // bird flocks: the crossing is latched to where the traveller was when it started
  const NF = C.flocks; const FS = C.flockSize;
  const fCyc = new Float64Array(NF).fill(-1e9); const fCx = new Float32Array(NF); const fCz = new Float32Array(NF);
  let birdSprites = null; // [u0, v0, w, h, aspect] per sprite when the art atlas has sky_bits_* birds
  if (artTex) {
    fetch('./textures/art/atlas.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || !j.sprites || !j.size) return;
      const want = L.birds.spriteNames || [];
      const list = [];
      for (const name of Object.keys(j.sprites)) {
        const sp = j.sprites[name];
        const isBird = want.includes(name) || (name.startsWith('sky_bits_') && /bird/i.test(String(sp.kind || sp.label || '')));
        if (!isBird || !sp.rect) continue;
        const [x, y, w, h] = sp.rect;
        list.push([x / j.size[0], (y + h) / j.size[1], w / j.size[0], -h / j.size[1], w / h]); // atlas is top-down (flipY false)
      }
      if (list.length) birdSprites = list;
    }).catch(() => {});
  }

  // ---- look pass: where a faller lands (sampled once per particle cycle) ---------------------------------
  const landX = new Float32Array(NBITS).fill(1e9); const landZ = new Float32Array(NBITS).fill(1e9);
  const landT = new Uint8Array(NBITS); const landH = new Float32Array(NBITS); // type: 0 ground, 1 water, 2 roof / tree / wall
  function landing(i, x, z) {
    if (Math.abs(landX[i] - x) < 0.01 && Math.abs(landZ[i] - z) < 0.01) return landT[i];
    landX[i] = x; landZ[i] = z; landT[i] = 0; landH[i] = 0;
    const w = world;
    if (w) {
      try {
        if (w.surfaceAt(x, z) === 'water') landT[i] = 1;
        else if (!w.isWalkable(x, z)) landT[i] = 2;
        else landH[i] = w.heightAt(x, z) || 0;
      } catch (err) { /* outside the generated world: flat page */ }
    }
    return landT[i];
  }
  const ROOF_Y = 0.55; // falls that end on a roof / in a tree stop (and fade) here
  // animals round 3: what an anchor point has near it, looked up once per anchor (it changes only when the piece wraps):
  // kind 0 = water within 2.4 units (spotX / spotZ = the way to it), kind 1 = a tile with flowers under it
  const NSPOT = NBITS + C.fireflies;
  const spotAX = new Float32Array(NSPOT).fill(1e9); const spotAZ = new Float32Array(NSPOT).fill(1e9);
  const spotF = new Uint8Array(NSPOT); const spotX = new Float32Array(NSPOT); const spotZ = new Float32Array(NSPOT);
  const FLOWER_RX = /flower|garden|orchard|gazebo|blossom|house|village|manor|church|windmill/;
  function spotFlag(i, x, z, kind) {
    if (Math.abs(spotAX[i] - x) < 0.01 && Math.abs(spotAZ[i] - z) < 0.01) return spotF[i];
    spotAX[i] = x; spotAZ[i] = z; spotF[i] = 0; spotX[i] = 0; spotZ[i] = 0;
    try {
      if (kind === 1) {
        const cell = wfc.get(Math.round(x / TILE_SIZE), Math.round(z / TILE_SIZE));
        if (cell && FLOWER_RX.test(cell.model)) spotF[i] = 1;
      } else {
        const w = world;
        if (w) {
          for (let ri = 0; ri < 4 && !spotF[i]; ri++) {
            for (let k = 0; k < 8; k++) {
              const a = (k + (i % 8) * 0.37) * (TAU / 8); const ox = Math.cos(a) * ri * 0.8; const oz = Math.sin(a) * ri * 0.8;
              if (w.surfaceAt(x + ox, z + oz) === 'water') { spotF[i] = 1; spotX[i] = ox * 0.85; spotZ[i] = oz * 0.85; break; }
              if (ri === 0) break;
            }
          }
        }
      }
    } catch (err) { /* outside the generated world */ }
    return spotF[i];
  }

  // ---- look pass: nothing flies between the camera and the traveller ---------------------------------------
  let hOx = 0; let hOy = 10; let hOz = 10; let hDx = 0; let hDy = -0.7; let hDz = -0.7; let hLen = 0;
  /** 0 on the camera -> traveller line, 1 from 0.42 units off it (and behind him). */
  function clearK(x, y, z) {
    if (hLen <= 0) return 1;
    const rx = x - hOx; const ry = y - hOy; const rz = z - hOz;
    const t = rx * hDx + ry * hDy + rz * hDz;
    if (t < 0 || t > hLen + 0.1) return 1;
    const px = rx - hDx * t; const py = ry - hDy * t; const pz = rz - hDz * t;
    const d2 = px * px + py * py + pz * pz;
    if (d2 > 0.1764) return 1;
    return smooth(0.24, 0.42, Math.sqrt(d2));
  }
  /** Near-camera fade (pieces close to the lens become big blurred discs). */
  function camK(x, y, z) {
    const rx = x - hOx; const ry = y - hOy; const rz = z - hOz;
    return smooth(2.2, 5.0, Math.sqrt(rx * rx + ry * ry + rz * rz));
  }

  // ---- look pass: lamp posts light a warm pool at night (uniforms of the paper material, no extra draw) ---
  const NL = 24;
  const lOn = new Uint8Array(NL); const lX = new Float32Array(NL); const lY = new Float32Array(NL); const lZ = new Float32Array(NL);
  const lCx = new Int32Array(NL); const lCz = new Int32Array(NL); const lSince = new Float64Array(NL); const lUsed = new Uint8Array(NL);
  const lK = new Uint8Array(NL); const lG = new Float32Array(NL); let lampGate = null; // game-hook(lanterns): lamp index in its tile, gate 0..1 per lamp (null = all lit)
  const lampCache = new Map();
  const LAMP_RE = /(^|_)(lamp|stone_lantern)(_[a-z]|_xf)?$/; // lamp, lamp_a, stone_lantern, and the cross plane lamp_xf of lantern_post
  function lampOffsets(model) {
    if (lampCache.has(model)) return lampCache.get(model);
    const list = [];
    try {
      const proto = assets && assets.getTilePrototype && assets.getTilePrototype(model);
      if (proto) {
        proto.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(proto.matrixWorld).invert();
        const box = new THREE.Box3(); const c = new THREE.Vector3();
        proto.traverse((n) => {
          if (!n.name || !LAMP_RE.test(n.name)) return;
          box.setFromObject(n);
          if (box.isEmpty()) return;
          box.applyMatrix4(inv);
          box.getCenter(c);
          for (const q of list) if (Math.abs(q[0] - c.x) + Math.abs(q[2] - c.z) < 0.15) return;
          list.push([c.x, Math.max(0.22, box.max.y * 0.72), c.z]);
        });
      }
    } catch (err) { /* no lamps */ }
    const extra = (CONFIG.lights.pools && CONFIG.lights.pools.offsets && CONFIG.lights.pools.offsets[model]) || null;
    if (extra) for (const q of extra) list.push(q);
    lampCache.set(model, list);
    return list;
  }
  function dropLamps(cx, cz) { for (let e = 0; e < NL; e++) if (lOn[e] && lCx[e] === cx && lCz[e] === cz) lOn[e] = 0; }
  const offLampRise = bus.on('tile:rise', (ev) => {
    const cell = wfc.get(ev.x, ev.z);
    if (!cell) return;
    const offs = lampOffsets(cell.model);
    if (!offs.length) return;
    for (let e = 0; e < NL; e++) if (lOn[e] && lCx[e] === ev.x && lCz[e] === ev.z) return;
    const ry = -(cell.rot || 0) * HALF_PI; const c = Math.cos(ry); const s = Math.sin(ry);
    for (let k = 0; k < offs.length; k++) {
      let e = 0;
      while (e < NL && lOn[e]) e++;
      if (e >= NL) return;
      const u = offs[k][0]; const v = offs[k][2];
      lOn[e] = 1; lCx[e] = ev.x; lCz[e] = ev.z; lSince[e] = state.time; lK[e] = k;
      lX[e] = ev.x * TILE_SIZE + u * c + v * s; lY[e] = offs[k][1]; lZ[e] = ev.z * TILE_SIZE - u * s + v * c;
    }
  });
  const offLampFlat = bus.on('tile:flat', (ev) => dropLamps(ev.x, ev.z));
  const offLampGone = bus.on('tile:despawn', (ev) => dropLamps(ev.x, ev.z));
  const cPool = new THREE.Color();
  function pools() {
    const P = CONFIG.lights.pools || {};
    const U = paperUniforms.uPaperPool.value; const UC = paperUniforms.uPaperPoolCol.value;
    const k = P.enabled === false ? 0 : nightAmt * (P.strength ?? 1);
    if (k <= 0.004) { UC.w = 0; return; }
    cPool.set(P.color || '#ffc878');
    UC.set(cPool.r * k, cPool.g * k, cPool.b * k, P.radius ?? 1.5);
    lUsed.fill(0);
    for (let e = 0; e < NL; e++) lG[e] = lOn[e] && lampGate ? lampGate(lCx[e], lCz[e], lK[e]) : 1; // game-hook(lanterns)
    for (let s = 0; s < U.length; s++) {
      let best = -1; let bd = 1e9;
      for (let e = 0; e < NL; e++) {
        if (!lOn[e] || lUsed[e] || lG[e] <= 0) continue;
        const d = (lX[e] - fx) * (lX[e] - fx) + (lZ[e] - fz) * (lZ[e] - fz);
        if (d < bd) { bd = d; best = e; }
      }
      if (best < 0) { U[s].w = 0; continue; }
      lUsed[best] = 1;
      U[s].set(lX[best], lY[best], lZ[best], smooth(0.5, 1.6, time - lSince[best]) * (1 - smooth(9, 12, Math.sqrt(bd))) * lG[best]);
    }
  }

  function gate(k, dx, dz, rank, W, D) {
    let d = (dC[k] + dGx[k] * dx + dGz[k] * dz - rank * 0.88) / 0.12;
    if (d <= 0) return 0;
    if (d > 1) d = 1;
    const ax = Math.abs(dx) / (W * 0.5); const az = Math.abs(dz) / (D * 0.5);
    const e = ax > az ? ax : az;
    return d * d * (3 - 2 * d) * (e < 0.86 ? 1 : Math.max(0, (1 - e) / 0.14));
  }

  // ---- fallers: leaves, snow, petals ------------------------------------------------------------------------
  function fallers(k, cfg, start, count) {
    const W = L.box.w; const D = L.box.d; const H = L.box.h;
    for (let j = 0; j < count; j++) {
      const i = start + j; const r = i * 6;
      const fall = mix(cfg.fall, R[r]);
      const tFall = H / fall; const period = tFall + cfg.land;
      const ph = time / period + R[r + 1] * 7;
      const cyc = Math.floor(ph); const u = (ph - cyc) * period;
      let dx = hash3(i, cyc, 11) * W - fx; dx -= W * Math.round(dx / W);
      let dz = hash3(i, cyc, 23) * D - fz; dz -= D * Math.round(dz / D);
      const g = gate(k, dx, dz, (j + 0.5) / count, W, D);
      if (g <= 0) { hide(M, i); continue; }
      const size = mix(cfg.size, R[r + 2]) * g;
      const lt = landing(i, fx + dx, fz + dz);
      if (u < tFall) {
        const rem = tFall - u; const y = rem * fall;
        if (lt === 2 && y < ROOF_Y) { hide(M, i); continue; }
        const sw = Math.sin(time * (0.8 + R[r + 3]) + R[r + 4] * TAU) * cfg.sway * (y < 1 ? y : 1);
        const px = fx + dx - windX * cfg.wind * rem - windZ * sw; const pz = fz + dz - windZ * cfg.wind * rem + windX * sw;
        const py = y + 0.03 + landH[i];
        const s = size * smooth(0, 0.6, u) * clearK(px, py, pz) * camK(px, py, pz) * (lt === 2 ? smooth(ROOF_Y, ROOF_Y + 0.3, y) : 1);
        if (s <= 0.0005) { hide(M, i); continue; }
        put(M, i, px, py, pz,
          R[r + 4] * TAU + time * cfg.tumble * (0.5 + R[r + 5]), -HALF_PI + 0.8 * Math.sin(time * cfg.tumble * 0.9 + R[r + 3] * TAU), sw * 1.4, s, s * 1.15); // rocks around face-up, so it always catches the key light
      } else {
        if (lt !== 0) { hide(M, i); continue; } // nothing rests on water, roofs or inside a tree
        const s = size * (1 - smooth(0.55, 1, (u - tFall) / cfg.land));
        put(M, i, fx + dx, 0.028 + R[r + 5] * 0.012 + landH[i], fz + dz, R[r + 4] * TAU, -HALF_PI + (R[r + 3] - 0.5) * 0.3, 0, s, s * 1.15);
      }
    }
  }

  function rain() {
    const cfg = L.rain; const W = L.box.w; const D = L.box.d; const H = L.box.h; const count = C.rain;
    const slant = Math.atan2(cfg.wind, 7) * (Math.cos(camYaw) * windX - Math.sin(camYaw) * windZ);
    for (let j = 0; j < count; j++) {
      const i = S.rain + j; const r = i * 6;
      const fall = mix(cfg.fall, R[r]);
      const tFall = H / fall; const period = tFall + cfg.land;
      const ph = time / period + R[r + 1] * 7;
      const cyc = Math.floor(ph); const u = (ph - cyc) * period;
      let dx = hash3(i, cyc, 11) * W - fx; dx -= W * Math.round(dx / W);
      let dz = hash3(i, cyc, 23) * D - fz; dz -= D * Math.round(dz / D);
      const g = gate(K.rain, dx, dz, (j + 0.5) / count, W, D);
      if (g <= 0) { hide(M, i); continue; }
      const lt = landing(i, fx + dx, fz + dz);
      if (u < tFall) {
        const rem = tFall - u; const len = mix(cfg.size, R[r + 2]);
        if (lt === 2 && rem * fall < ROOF_Y) { hide(M, i); continue; }
        const px = fx + dx - windX * cfg.wind * rem; const py = rem * fall + len * 0.5 + landH[i]; const pz = fz + dz - windZ * cfg.wind * rem;
        const wd = cfg.width * g * clearK(px, py, pz) * camK(px, py, pz);
        if (wd <= 0.0003) { hide(M, i); continue; }
        cellRect(rectArr, i * 4, CELLS.bar);
        put(M, i, px, py, pz, camYaw, -0.35, -slant, wd, len);
      } else {
        if (lt === 2) { hide(M, i); continue; } // no splash ring under a roof / inside a tree
        const l = (u - tFall) / cfg.land; const s = cfg.splash * (0.3 + 0.7 * l) * g * (l > 0.8 ? (1 - l) / 0.2 : 1);
        cellRect(rectArr, i * 4, CELLS.ring);
        put(M, i, fx + dx, 0.03 + landH[i], fz + dz, 0, -HALF_PI, 0, s, s);
      }
    }
  }

  function dust() {
    const cfg = L.dust; const W = L.box.w; const D = L.box.d; const count = C.dust;
    for (let j = 0; j < count; j++) {
      const i = S.dust + j; const r = i * 6;
      const sp = mix(cfg.speed, R[r]);
      let dx = R[r + 1] * W + windX * sp * time - fx; dx -= W * Math.round(dx / W);
      let dz = R[r + 2] * D + windZ * sp * time - fz; dz -= D * Math.round(dz / D);
      const g = gate(K.dust, dx, dz, (j + 0.5) / count, W, D);
      if (g <= 0) { hide(M, i); continue; }
      const py = mix(cfg.height, R[r + 3]) + 0.14 * Math.sin(time * 0.5 + R[r + 5] * TAU);
      const s = mix(cfg.size, R[r + 4]) * g * clearK(fx + dx, py, fz + dz) * camK(fx + dx, py, fz + dz);
      if (s <= 0.0005) { hide(M, i); continue; }
      put(M, i, fx + dx, py, fz + dz, camYaw + Math.sin(time * 0.7 + R[r + 5] * TAU), -camElev, time * 0.4 + R[r] * TAU, s, s);
    }
  }

  function gusts() {
    const cfg = L.gusts; const W = L.box.w; const D = L.box.d; const count = C.gusts;
    const yaw = Math.atan2(-windZ, windX);
    for (let j = 0; j < count; j++) {
      const i = S.gusts + j; const r = i * 6;
      let env = Math.sin(time * TAU / cfg.period + R[r + 2] * 1.4);
      env = env > 0 ? env * env * env : 0;
      let dx = R[r + 1] * W + windX * cfg.speed * time - fx; dx -= W * Math.round(dx / W);
      let dz = R[r + 4] * D + windZ * cfg.speed * time * 0.6 - fz; dz -= D * Math.round(dz / D);
      const g = gate(K.gusts, dx, dz, (j + 0.5) / count, W, D) * env;
      if (g <= 0.02) { hide(M, i); continue; }
      put(M, i, fx + dx, mix(cfg.height, R[r + 3]), fz + dz, yaw, -HALF_PI + 0.25, 0, mix(cfg.length, R[r]) * g, cfg.width);
    }
  }

  /** Two wing instances hinged on the body axis. flap = wing angle above the horizontal. */
  function wings(i, x, y, z, heading, flap, span, chord) {
    const sh = Math.sin(heading); const ch = Math.cos(heading); const ca = Math.cos(flap); const sa = Math.sin(flap);
    let Xx = ch * ca; let Xz = -sh * ca;
    putBasis(M, i, x + Xx * span * 0.42, y + sa * span * 0.42, z + Xz * span * 0.42, Xx, sa, Xz, sh, 0, ch, span, chord);
    Xx = -Xx; Xz = -Xz;
    putBasis(M, i + 1, x + Xx * span * 0.42, y + sa * span * 0.42, z + Xz * span * 0.42, Xx, sa, Xz, -sh, 0, -ch, span, chord);
  }

  function butterflies() {
    const cfg = L.butterflies; const W = L.box.w; const D = L.box.d; const count = C.butterflies;
    for (let j = 0; j < count; j++) {
      const i = S.butterflies + j * 2; const r = i * 6;
      let dx = R[r] * W - fx; dx -= W * Math.round(dx / W);
      let dz = R[r + 1] * D - fz; dz -= D * Math.round(dz / D);
      let g = gate(K.butterflies, dx * 0.8, dz * 0.8, (j + 0.5) / count, W, D);
      // animals round 3: over a flower tile a butterfly flies whatever its rank, and keeps closer to the flowers
      const fl = cfg.flowers > 0 && dC[K.butterflies] > 0.02 ? spotFlag(i, fx + dx, fz + dz, 1) : 0;
      if (fl) { const ax = Math.abs(dx) / (W * 0.5); const az = Math.abs(dz) / (D * 0.5); const e = ax > az ? ax : az; g = Math.max(g, cfg.flowers * smooth(0.02, 0.2, dC[K.butterflies]) * (e < 0.86 ? 1 : Math.max(0, (1 - e) / 0.14))); }
      if (g <= 0) { hide(M, i); hide(M, i + 1); continue; }
      const a = time * 0.45 + R[r + 2] * TAU; const b = time * 0.31 + R[r + 3] * TAU;
      const rm = fl ? cfg.roam * 0.6 : cfg.roam; const ox = rm * (Math.sin(a) + 0.4 * Math.sin(2.3 * b)); const oz = rm * (Math.cos(1.2 * b) + 0.4 * Math.sin(1.7 * a));
      const vx = 0.45 * Math.cos(a) + 0.285 * Math.cos(2.3 * b); const vz = -0.372 * Math.sin(1.2 * b) + 0.306 * Math.cos(1.7 * a);
      const y = mix(cfg.height, 0.5 + 0.5 * Math.sin(time * 0.8 + R[r + 4] * TAU)) + 0.04 * Math.sin(time * cfg.flap);
      const ck = g * clearK(fx + dx + ox, y, fz + dz + oz);
      if (ck <= 0.01) { hide(M, i); hide(M, i + 1); continue; }
      wings(i, fx + dx + ox, y, fz + dz + oz, Math.atan2(vx, vz), 0.1 + 1.05 * Math.abs(Math.sin(time * cfg.flap + R[r + 5] * TAU)), cfg.size * ck, cfg.size * 1.25 * ck);
    }
  }

  function birds() {
    const cfg = L.birds;
    const dens = dC[K.birds];
    const sprites = birdSprites;
    for (let f = 0; f < NF; f++) {
      const period = cfg.period * (1 + 0.23 * f);
      const ph = time / period + 0.37 * f + 0.12;
      const cyc = Math.floor(ph); const u = (ph - cyc) * period;
      const active = u < cfg.cross && dens > (f + 0.4) / NF * 0.9;
      if (active && (fCyc[f] !== cyc || Math.abs(fCx[f] - fx) + Math.abs(fCz[f] - fz) > 30)) {
        // aim the crossing at the point above the page that the camera sees over the traveller (birds fly high,
        // so a path centred on the traveller itself would pass above the top of the frame)
        const h = cfg.height + 0.35 * f;
        fCyc[f] = cyc; fCx[f] = fx + camHX * h; fCz[f] = fz + camHZ * h;
      }
      const ang = hash3(f, cyc, 5) * TAU; const dirx = Math.cos(ang); const dirz = Math.sin(ang);
      const s = u / cfg.cross;
      const along = (s - 0.5) * cfg.span; const lat = (hash3(f, cyc, 7) - 0.5) * 5 + Math.sin(s * 5 + f) * 0.8;
      const bx = fCx[f] + dirx * along - dirz * lat; const bz = fCz[f] + dirz * along + dirx * lat;
      const nBirds = 3 + Math.floor(hash3(f, cyc, 9) * (FS - 2));
      const heading = Math.atan2(dirx, dirz);
      for (let j = 0; j < FS; j++) {
        const i = S.birds + (f * FS + j) * 2; const si = T.birdShadows + f * FS + j;
        if (!active || j >= nBirds) { hide(M, i); hide(M, i + 1); softHide(si); continue; }
        const row = (j + 1) >> 1; const side = j % 2 ? 1 : -1;
        const px = bx - dirx * row * 0.55 - dirz * side * row * 0.45;
        const pz = bz - dirz * row * 0.55 + dirx * side * row * 0.45;
        const py = cfg.height + 0.35 * f + 0.12 * Math.sin(time * 1.3 + j * 1.7);
        const beat = Math.sin(time * cfg.flap + j * 0.9 + f);
        if (sprites) {
          const sp = sprites[(f + j) % sprites.length]; const o = i * 4;
          rectArr[o] = sp[0]; rectArr[o + 1] = sp[1]; rectArr[o + 2] = sp[2]; rectArr[o + 3] = sp[3]; texArr[i] = 1;
          put(M, i, px, py, pz, heading + Math.PI, -HALF_PI + 0.35, beat * 0.12, cfg.wing * 2 * sp[4] * (0.9 + 0.1 * beat), cfg.wing * 2);
          hide(M, i + 1);
        } else {
          // one creased card per bird: the crease is the body, scaling its depth flaps the wings up and down
          const sp = cfg.wing * 2; const sh = Math.sin(heading); const ch = Math.cos(heading);
          putBasis(M, i, px, py, pz, -ch, 0, sh, sh, 0, ch, sp * (0.92 - 0.1 * beat), sp, sp * (1.1 + 2.3 * beat));
          hide(M, i + 1);
        }
        const sa = cfg.shadow * (1 - nightAmt);
        if (sa > 0.003) softPut(si, px - lightX * py, 0.03, pz - lightZ * py, 0, -HALF_PI, 0.6, 0.46, cCloud.r, cCloud.g, cCloud.b, sa, 1, 1, 1);
        else softHide(si);
      }
    }
    if (sprites) texAttr.needsUpdate = true;
  }

  function smoke() {
    const cfg = L.smoke; const P = C.smokePuffs;
    for (let e = 0; e < NE; e++) {
      const on = eOn[e] ? smooth(0.7, 1.7, time - eSince[e]) * (1 + ((cfg.night ?? 1) - 1) * nightAmt) : 0;
      for (let p = 0; p < P; p++) {
        const i = S.smoke + e * P + p;
        if (on <= 0) { hide(M, i); continue; }
        const ph = time / cfg.life + p / P + e * 0.37;
        const u = ph - Math.floor(ph);
        const s = mix(cfg.size, u) * smooth(0, 0.14, u) * (1 - smooth(0.68, 1, u)) * on;
        const d = cfg.drift * u * u; const r = i * 6;
        // animals round 3: a slow stack of discs that never covers the traveller (clearK) and fades near the lens (camK)
        const px = eX[e] + windX * d + (cfg.wobble ?? 0.05) * Math.sin(time * 0.9 + p * 2.1 + e) * u; const py = eY[e] + u * cfg.rise; const pz = eZ[e] + windZ * d;
        const sk = s * clearK(px, py, pz) * camK(px, py, pz);
        if (sk <= 0.002) { hide(M, i); continue; }
        put(M, i, px, py, pz, camYaw, -camElev * 0.7, R[r] * TAU + u * (cfg.spin ?? 1.6) * (R[r + 1] < 0.5 ? -1 : 1), sk, sk);
      }
    }
  }

  function mist() {
    const cfg = L.mist; const W = L.box.w + 4; const D = L.box.d; const count = C.mist;
    for (let j = 0; j < count; j++) {
      const i = T.mist + j; const q = i * 6;
      let dx = Q[q] * W + windX * cfg.drift * (0.6 + Q[q + 2]) * time - fx; dx -= W * Math.round(dx / W);
      let dz = Q[q + 1] * D - fz; dz -= D * Math.round(dz / D);
      const g = gate(K.mist, dx, dz, (j + 0.5) / count, W, D);
      if (g <= 0) { softHide(i); continue; }
      softPut(i, fx + dx, cfg.y + 0.06 * Math.sin(time * 0.3 + Q[q + 3] * TAU), fz + dz, camYaw, -0.3, mix(cfg.size, Q[q + 3]), cfg.height * (0.8 + 0.4 * Q[q + 4]),
        cMist.r, cMist.g, cMist.b, cfg.alpha * g, 1, 0, 1);
    }
  }

  function clouds() {
    const cfg = L.clouds; const W = cfg.span; const count = C.clouds;
    for (let j = 0; j < count; j++) {
      const i = T.clouds + j; const q = i * 6;
      let dx = Q[q] * W + windX * cfg.speed * time - fx; dx -= W * Math.round(dx / W);
      let dz = Q[q + 1] * W + windZ * cfg.speed * time - fz; dz -= W * Math.round(dz / W);
      const g = gate(K.clouds, 0, 0, (j + 0.5) / count, 1, 1) * (1 - smooth(0.8, 1, Math.max(Math.abs(dx), Math.abs(dz)) / (W * 0.5)));
      if (g <= 0) { softHide(i); continue; }
      const s = mix(cfg.size, Q[q + 2]);
      softPut(i, fx + dx, 0.02, fz + dz, Q[q + 3] * TAU, -HALF_PI, s, s * (0.62 + 0.25 * Q[q + 4]), cCloud.r, cCloud.g, cCloud.b, cfg.alpha * g, 1, 1, 1);
    }
  }

  function fireflies() {
    const cfg = L.fireflies; const W = L.box.w; const D = L.box.d; const count = C.fireflies;
    for (let j = 0; j < count; j++) {
      const i = T.fireflies + j; const q = i * 6;
      let dx = Q[q] * W - fx; dx -= W * Math.round(dx / W);
      let dz = Q[q + 1] * D - fz; dz -= D * Math.round(dz / D);
      let g = gate(K.fireflies, dx, dz, (j + 0.5) / count, W, D);
      // animals round 3: a firefly with water within reach hovers over the bank, whatever its rank
      let wx = 0; let wz = 0;
      if (cfg.water > 0 && dC[K.fireflies] > 0.02 && spotFlag(NBITS + j, fx + dx, fz + dz, 0)) {
        wx = spotX[NBITS + j]; wz = spotZ[NBITS + j];
        const ax = Math.abs(dx) / (W * 0.5); const az = Math.abs(dz) / (D * 0.5); const e = ax > az ? ax : az;
        g = Math.max(g, cfg.water * smooth(0.02, 0.2, dC[K.fireflies]) * (e < 0.86 ? 1 : Math.max(0, (1 - e) / 0.14)));
      }
      if (g <= 0) { softHide(i); continue; }
      dx += wx; dz += wz;
      const a = time * 0.33 + Q[q + 2] * TAU; const b = time * 0.21 + Q[q + 3] * TAU;
      let pulse = Math.sin(time * (0.9 + Q[q + 4] * 0.9) + Q[q + 5] * TAU);
      pulse = pulse > 0 ? pulse * pulse : 0;
      const glow = cfg.glow * g * (0.12 + 0.88 * pulse);
      const s = cfg.size * (0.75 + 0.5 * Q[q + 4]);
      softPut(i, fx + dx + cfg.roam * (Math.sin(a) + 0.5 * Math.sin(2.1 * b)), mix(cfg.height, 0.5 + 0.5 * Math.sin(time * 0.4 + Q[q + 2] * TAU)),
        fz + dz + cfg.roam * (Math.cos(1.3 * b) + 0.5 * Math.sin(1.6 * a)), camYaw, -camElev, s, s, cFly.r * glow, cFly.g * glow, cFly.b * glow, 1, 0, 0, 0);
    }
  }

  function sharpen(w) {
    let s = 0;
    for (let b = 0; b < NB; b++) { w[b] = smooth(0.2, 0.8, w[b]); s += w[b]; }
    if (s > 0) for (let b = 0; b < NB; b++) w[b] /= s; else w[0] = 1;
  }

  function densities() {
    const ts = 1 / TILE_SIZE;
    if (forced >= 0) {
      for (let b = 0; b < NB; b++) { wC[b] = b === forced ? 1 : 0; wE[b] = wW[b] = wN[b] = wS[b] = wC[b]; }
    } else {
      biomeWeights(seed, fx * ts, fz * ts, wC);
      biomeWeights(seed, (fx + GRAD) * ts, fz * ts, wE); biomeWeights(seed, (fx - GRAD) * ts, fz * ts, wW);
      biomeWeights(seed, fx * ts, (fz + GRAD) * ts, wS); biomeWeights(seed, fx * ts, (fz - GRAD) * ts, wN);
    }
    // look pass: sharpen the cross-fade, so a 20 % share of a neighbour biome brings none of its life (a butterfly
    // and petals over the snow, fireflies in the desert) while the border itself still blends
    sharpen(wC); sharpen(wE); sharpen(wW); sharpen(wN); sharpen(wS);
    const N = L.night;
    for (let k = 0; k < NK; k++) {
      const name = KINDS[k];
      let c = 0; let gx = 0; let gz = 0;
      for (let b = 0; b < NB; b++) {
        const row = L.biomes[BIOMES[b]];
        const v = (row && row[name]) || 0;
        c += wC[b] * v; gx += (wE[b] - wW[b]) * v; gz += (wS[b] - wN[b]) * v;
      }
      const nf = name === 'fireflies' ? nightAmt * (N.fireflies ?? 1) : 1 + ((N[name] ?? 1) - 1) * nightAmt;
      const q = name === 'clouds' || name === 'birds' || name === 'butterflies' ? 1 : qScale;
      dC[k] = c * nf * q; dGx[k] = gx * nf * q / (2 * GRAD); dGz[k] = gz * nf * q / (2 * GRAD);
    }
    // fewer fireflies in the rain (fixer pass: was none at all, so the pinewood night had no life)
    const dry = 1 - (L.fireflies.rainCut ?? 0.4) * Math.min(1, Math.max(0, dC[K.rain]) * 1.5);
    dC[K.fireflies] *= dry; dGx[K.fireflies] *= dry; dGz[K.fireflies] *= dry;
  }

  function update(dt, focus, cam = camera) {
    if (!enabled) return;
    time = state.time;
    fx = focus.x; fz = focus.z;
    const target = daynight && daynight.night ? 1 : 0;
    if (dt <= 0) nightAmt = target;
    else if (nightAmt !== target) nightAmt = target > nightAmt ? Math.min(1, nightAmt + dt / 1.6) : Math.max(0, nightAmt - dt / 1.6);
    if (cam) {
      const cx = cam.position.x - fx; const cz = cam.position.z - fz;
      camYaw = Math.atan2(cx, cz);
      camElev = Math.atan2(cam.position.y, Math.sqrt(cx * cx + cz * cz) || 1);
      if (cam.position.y > 0.5) { camHX = cx / cam.position.y; camHZ = cz / cam.position.y; }
    }
    hLen = 0;
    if (cam) {
      hOx = cam.position.x; hOy = cam.position.y; hOz = cam.position.z;
      const ax = fx - hOx; const ay = (focus.y || 0) + 0.3 - hOy; const az = fz - hOz;
      hLen = Math.sqrt(ax * ax + ay * ay + az * az);
      if (hLen > 1e-3) { hDx = ax / hLen; hDy = ay / hLen; hDz = az / hLen; }
    }
    const wl = Math.sqrt(L.wind[0] * L.wind[0] + L.wind[1] * L.wind[1]) || 1;
    windX = L.wind[0] / wl; windZ = L.wind[1] / wl;
    if (!keyLight && !keySearched) { keySearched = true; scene.traverse(findKey); }
    if (keyLight) {
      const lx = keyLight.position.x - keyLight.target.position.x; const ly = keyLight.position.y - keyLight.target.position.y; const lz = keyLight.position.z - keyLight.target.position.z;
      if (ly > 0.01) { lightX = lx / ly; lightZ = lz / ly; }
    }
    cMist.copy(cMistD).lerp(cMistN, nightAmt);
    liftUniform.value = 0.09 * nightAmt;
    cCloud.set(L.clouds.color);
    cFly.set(L.fireflies.color);
    densities();

    fallers(K.leaves, L.leaves, S.leaves, C.leaves);
    fallers(K.snow, L.snow, S.snow, C.snow);
    fallers(K.petals, L.petals, S.petals, C.petals);
    rain();
    dust();
    gusts();
    butterflies();
    birds();
    smoke();
    mist();
    clouds();
    fireflies();
    pools();

    bits.instanceMatrix.needsUpdate = true;
    rectAttr.needsUpdate = true;
    soft.instanceMatrix.needsUpdate = true;
    colAttr.needsUpdate = true;
    parAttr.needsUpdate = true;
  }

  return {
    group, bits, soft,
    update,
    /** Chimneys of every risen house smoke at once (called after world.settle()). */
    settle() { for (let e = 0; e < NE; e++) if (eOn[e]) eSince[e] = -1e9; },
    /** Debug: pin the weather to one biome ('snow', 'desert', ...); null / undefined = follow the world again. */
    forceBiome(id) { forced = id == null ? -1 : (BIOME_INDEX[id] ?? -1); return forced >= 0 ? BIOMES[forced] : null; },
    setEnabled(v) { enabled = !!v; group.visible = enabled; },
    get enabled() { return enabled; },
    get night() { return nightAmt; },
    /** Current densities per kind at the traveller (after day / night), for debugging. */
    densities() { const o = {}; for (let k = 0; k < NK; k++) o[KINDS[k]] = +dC[k].toFixed(3); return o; },
    /** game-hook(lanterns): tile-local lamp anchors of a model [[x, y, z]], and a per-lamp gate fn(cx, cz, lampIndex) -> 0..1 for the night pools. */
    lampOffsets, setLampGate(fn) { lampGate = fn || null; },
    /** Debug: lamp-post pool anchors currently alive [{x, y, z}]. */
    lamps() { const a = []; for (let e = 0; e < NL; e++) if (lOn[e]) a.push({ x: +lX[e].toFixed(2), y: +lY[e].toFixed(2), z: +lZ[e].toFixed(2) }); return a; },
    stats() { let em = 0; for (let e = 0; e < NE; e++) em += eOn[e];
      let lw = 0; let lb = 0; let lm = 0;
      for (let i = 0; i < NBITS; i++) { if (landT[i] === 1) lw++; else if (landT[i] === 2) lb++; if (landH[i] > 0.02) lm++; }
      const land = { water: lw, blocked: lb, raised: lm, world: !!world }; return { bits: NBITS, soft: NSOFT, drawCalls: 2, triangles: NBITS * 4 + NSOFT * 2, chimneys: em, birdSprites: birdSprites ? birdSprites.length : 0, land }; },
    dispose() {
      offRise(); offFlat(); offDespawn(); offLampRise(); offLampFlat(); offLampGone();
      paperUniforms.uPaperPoolCol.value.w = 0;
      scene.remove(group);
      bitsGeo.dispose(); bitsMat.dispose(); shapeTex.dispose(); softGeo.dispose(); softMat.dispose();
    },
  };
}
