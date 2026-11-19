// OWNER: world agent. Tile streaming / pooling / batching + walkability queries (contract: docs/ARCHITECTURE.md).
//
// Rendering (decision O3): the per-tile Object3D hierarchy (clone of the prototype) is kept only for the
// fold.js maths - it is NEVER added to the scene. Every mesh of every tile is an instance in one
// THREE.BatchedMesh per material (1 draw call per material + 1 in the shadow pass); instance matrices are
// copied from the flap world matrices only while a tile is moving. Tile `base` patches are not drawn at all:
// the book page shows the identical baked print (see book.js), so tiles can appear/disappear without a pop.
//
// Streaming: a tile rises when it is inside REVEAL_RADIUS of a point `forwardBias` tiles ahead of the
// traveller (or right next to the traveller), after a ripple delay that grows with distance; it folds flat
// beyond FOLD_BACK_RADIUS (and before the page margin reaches it), and is pooled beyond DESPAWN_RADIUS.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE, REVEAL_RADIUS, FOLD_BACK_RADIUS, DESPAWN_RADIUS, PATH_WIDTH, RIVER_WIDTH } from '../core/config.js';
import { rotToY, MODELS, FALLBACK_MODEL } from '../core/models.js';
import { bus } from '../core/events.js';
import { hash2f } from '../core/rng.js';
import { createFoldInstance } from './fold.js';
import { createBook, BIOME_TINT_GLSL, biomeTintUniforms, biomeIndexOf } from './book.js';
import { biomeAt as biomeIdAt, biomeWeights, BIOMES } from '../core/biomes.js';
import { state } from '../core/state.js';
import { isThinned, hashStr } from './cards.js';
// integration: V8's Math.hypot allocates (rest-argument array) on every call; this 2-argument form is allocation-free.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

const HALF = TILE_SIZE / 2;
const GRID = 32; // active-tile torus (cells); active tiles always fit in a 32-cell window
const GMASK = GRID - 1;
const CACHE = 64; // wfc cell cache torus
const CMASK = CACHE - 1;
const SDF_N = 41; // blocker distance field samples across a tile (step 0.05)
const SDF_STEP = TILE_SIZE / (SDF_N - 1);

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tintCol = new THREE.Color();

function isBaseMesh(mesh) {
  if (!/^base/i.test(mesh.name || '')) return false;
  for (let p = mesh.parent; p; p = p.parent) if (p.userData && p.userData.hinge) return false;
  return true;
}

/** Float32, de-normalised, indexed copy of a geometry restricted to `spec` attributes (BatchedMesh needs a uniform layout). */
function normaliseGeometry(src, spec) {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  const count = pos.count;
  let work = src;
  if (spec.normal && !src.getAttribute('normal')) { work = src.clone(); work.computeVertexNormals(); }
  for (const name in spec) {
    const size = spec[name];
    const a = work.getAttribute(name);
    const arr = new Float32Array(count * size);
    if (a) {
      const n = Math.min(size, a.itemSize);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < n; k++) arr[i * size + k] = a.getComponent(i, k);
        for (let k = n; k < size; k++) arr[i * size + k] = name === 'color' ? 1 : 0;
      }
    } else if (name === 'color') arr.fill(1);
    else if (name === 'uv1') arr.fill(-1); // no art-atlas UVs (placeholder / pre-art assets): "no art" marker
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = src.getIndex();
  const ia = new Uint32Array(idx ? idx.count : count);
  if (idx) for (let i = 0; i < ia.length; i++) ia[i] = idx.getX(i); else for (let i = 0; i < ia.length; i++) ia[i] = i;
  g.setIndex(new THREE.BufferAttribute(ia, 1));
  if (src.boundingBox) g.boundingBox = src.boundingBox.clone(); else g.computeBoundingBox();
  if (src.boundingSphere) g.boundingSphere = src.boundingSphere.clone(); else g.computeBoundingSphere();
  return g;
}

/** The live world, for modules that are not handed it (camera/follow.js sight assist). */
export const sight = { world: null };

export function createWorld({ scene, assets, wfc, materials, quality }) {
  const W = CONFIG.world;
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);
  const book = createBook({ scene, assets, wfc, materials, quality });

  // ================================================================================================
  // Batches: one BatchedMesh per material
  // ================================================================================================
  const origin = new THREE.Vector3(); // batch origin (re-based far from the world origin)
  const batchRoot = new THREE.Group();
  batchRoot.name = 'tile-batches';
  group.add(batchRoot);
  /** material.uuid -> { mesh, geoIds: Map<geometry.uuid, id>, spec, verts, indices } */
  const batches = new Map();
  const batchList = [];

  function renderable(o) {
    return o.isMesh && o.geometry && o.geometry.getAttribute('position') && o.material && !o.isSkinnedMesh
      && (W.renderBases || !isBaseMesh(o));
  }
  const matOf = (o) => (Array.isArray(o.material) ? o.material[0] : o.material);

  // biome tint state (used by createBatch below; see "biome pass: per-instance biome tint")
  const TINT = W.biomeTintEnabled !== false && !!W.biomeTint;
  const OWN_ART = new Set(Object.keys(MODELS).filter((id) => { const b = MODELS[id].biomes; return b && Object.keys(b).length === 1 && !b.heartland; }));
  const tintU = TINT ? biomeTintUniforms('prop') : null;
  const tintUniforms = TINT ? { uBiomeP: { value: tintU.rows }, uBiomePK: { value: tintU.keep } } : null;

  // ---- motion (biome pass): wind sway + windmill sails -------------------------------------------------
  // The sway itself lives in fold.js (fold.applyWind); here: per-tile wind strength from the biome blend, the
  // matrix refresh of ONLY the swaying flaps' instances, and the sail split below.
  const WIND = CONFIG.spring.wind || { enabled: false };
  const WIND_ON = !!WIND.enabled;
  const windStrength = new Float32Array(BIOMES.length);
  for (let i = 0; i < BIOMES.length; i++) windStrength[i] = (WIND.strength && WIND.strength[BIOMES[i]]) ?? 1;
  const _bw = new Float32Array(BIOMES.length);
  const SPIN_RX = WIND_ON && WIND.spinMatch ? new RegExp(WIND.spinMatch, 'i') : null;
  /** geometry.uuid -> null | { body, part, hub }: the sail layer of a windmill card split off as its own geometry. */
  const spinCache = new Map();

  function subGeometry(src, tris, pick, ox, oy) {
    const idx = src.getIndex();
    const pos = src.getAttribute('position');
    const remap = new Int32Array(pos.count).fill(-1);
    const order = []; const index = [];
    for (let t = 0; t < tris.length; t++) {
      if (tris[t] !== pick) continue;
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        if (remap[v] < 0) { remap[v] = order.length; order.push(v); }
        index.push(remap[v]);
      }
    }
    const g = new THREE.BufferGeometry();
    for (const name in src.attributes) {
      const a = src.attributes[name];
      const arr = new Float32Array(order.length * a.itemSize);
      for (let i = 0; i < order.length; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(order[i], k);
      if (name === 'position') for (let i = 0; i < order.length; i++) { arr[i * 3] -= ox; arr[i * 3 + 1] -= oy; }
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    g.setIndex(index);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /** Sail split for a mesh (cached per source geometry); null when the mesh has no sail layer. */
  function spinSplit(mesh) {
    if (SPIN_RX === null || !SPIN_RX.test(mesh.name || '')) return null;
    const src = mesh.geometry;
    if (spinCache.has(src.uuid)) return spinCache.get(src.uuid);
    let out = null;
    const pos = src.getAttribute('position');
    const idx = src.getIndex();
    const nt = ((idx ? idx.count : pos.count) / 3) | 0;
    const tris = new Uint8Array(nt);
    let n = 0; let x0 = 1e9; let x1 = -1e9; let y0 = 1e9; let y1 = -1e9;
    for (let t = 0; t < nt; t++) {
      let ok = true;
      for (let k = 0; k < 3; k++) if (pos.getZ(idx ? idx.getX(t * 3 + k) : t * 3 + k) < WIND.spinZMin) ok = false;
      if (!ok) continue;
      tris[t] = 1; n++;
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        const x = pos.getX(v); const y = pos.getY(v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (n > 0 && n < nt) {
      const hub = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0);
      out = { body: subGeometry(src, tris, 0, 0, 0), part: subGeometry(src, tris, 1, hub.x, hub.y), hub };
    }
    spinCache.set(src.uuid, out);
    return out;
  }

  // pre-scan every prototype so each batch can be created with its final geometry capacity
  {
    const plan = new Map(); // material.uuid -> { material, geos: Map, spec }
    const ids = assets.modelIds && assets.modelIds.length ? assets.modelIds : Object.keys(MODELS);
    for (const id of ids) {
      let proto = null;
      try { proto = assets.getTilePrototype(id); } catch { proto = null; }
      if (!proto) continue;
      proto.traverse((o) => {
        if (!renderable(o)) return;
        const mat = matOf(o);
        let p = plan.get(mat.uuid);
        if (!p) plan.set(mat.uuid, (p = { material: mat, geos: new Map(), spec: {} }));
        const sp = spinSplit(o);
        if (sp) { p.geos.set(sp.body.uuid, sp.body); p.geos.set(sp.part.uuid, sp.part); } else p.geos.set(o.geometry.uuid, o.geometry);
      });
    }
    for (const p of plan.values()) createBatch(p.material, [...p.geos.values()]);
  }

  // ---- biome pass: per-instance biome tint ---------------------------------------------------------
  // The instance colour of a tinted batch is NOT a colour: r = 1 + biome index (1 = heartland = three's default).
  // The chained shader hook turns it into the `prop` transform of CONFIG.world.biomeTint, applied to the albedo
  // (vertex colour x art) before fibre and lighting. Glow materials (emissive panes, lantern glass) are left alone.
  function isGlow(material) {
    const e = material.emissive;
    return !!(e && e.isColor && e.r + e.g + e.b > 0 && (material.emissiveIntensity === undefined || material.emissiveIntensity > 0));
  }
  function tintMaterial(m) {
    if (m.userData.biomeTint) return;
    m.userData.biomeTint = true;
    const NB = tintU.count;
    const prev = m.onBeforeCompile; const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(m, shader, renderer);
      Object.assign(shader.uniforms, tintUniforms);
      // (three defines USE_BATCHING_COLOR only in the VERTEX stage: the varyings are unconditional and default to identity)
      const pars = '\nvarying vec4 vBt0;\nvarying vec4 vBt1;\nvarying vec4 vBt2;\nvarying float vBtK;\n';
      const stock = 'vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );';
      const mine = `{ int bi = clamp( int( getBatchingColor( getIndirectIndex( gl_DrawID ) ).r - 0.5 ), 0, ${NB - 1} );
        vBt0 = uBiomeP[ bi * 3 ]; vBt1 = uBiomeP[ bi * 3 + 1 ]; vBt2 = uBiomeP[ bi * 3 + 2 ]; vBtK = uBiomePK[ bi ]; }`;
      let vs = shader.vertexShader;
      if (!vs.includes(stock)) vs = vs.replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex);
      if (!vs.includes(stock)) { console.warn('[world] biome tint hook not applied (unexpected shader)'); return; }
      shader.vertexShader = vs.replace(stock, mine)
        .replace('void main() {', 'void main() {\n\tvBt0 = vec4( 1.0, 0.0, 0.0, 0.0 ); vBt1 = vec4( 0.0, 1.0, 0.0, 0.0 ); vBt2 = vec4( 0.0, 0.0, 1.0, 0.0 ); vBtK = 0.0;')
        .replace('#include <common>', `#include <common>${pars}#ifdef USE_BATCHING_COLOR\nuniform vec4 uBiomeP[${NB * 3}];\nuniform float uBiomePK[${NB}];\n#endif\n`);
      const apply = '\ndiffuseColor.rgb = biomeTint( diffuseColor.rgb, vBt0, vBt1, vBt2, vBtK );\n';
      let fs = shader.fragmentShader.replace('#include <common>', '#include <common>' + pars + BIOME_TINT_GLSL);
      const anchor = 'vec3 paperAN = abs( vPaperNrm );'; // right after the art print of the paper material, before fibre
      fs = fs.includes(anchor) ? fs.replace(anchor, apply + anchor) : fs.replace('#include <color_fragment>', '#include <color_fragment>' + apply);
      shader.fragmentShader = fs;
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|biome-tint-v2';
    m.needsUpdate = true;
  }

  function specFor(material, geos) {
    const spec = { position: 3, normal: 3 };
    for (const g of geos) for (const name in g.attributes) {
      if (name === 'position' || name === 'normal') continue;
      const a = g.attributes[name];
      spec[name] = Math.max(spec[name] || 0, a.itemSize);
    }
    if (material.vertexColors && !spec.color) spec.color = 3;
    return spec;
  }

  function createBatch(material, geos) {
    const spec = specFor(material, geos);
    let verts = 0; let indices = 0;
    for (const g of geos) { verts += g.getAttribute('position').count; indices += g.getIndex() ? g.getIndex().count : g.getAttribute('position').count; }
    const mesh = new THREE.BatchedMesh(1024, Math.max(verts, 64) + 256, Math.max(indices, 64) + 512, material);
    mesh.name = 'tiles:' + (material.name || material.uuid.slice(0, 8));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = true;
    mesh.frustumCulled = false;
    const b = { mesh, material, geoIds: new Map(), spec, verts: Math.max(verts, 64) + 256, indices: Math.max(indices, 64) + 512, usedV: 0, usedI: 0, instances: 0, tinted: TINT && !isGlow(material) };
    if (b.tinted) tintMaterial(material);
    batches.set(material.uuid, b);
    batchList.push(b);
    batchRoot.add(mesh);
    for (const g of geos) addGeometry(b, g);
    return b;
  }

  function addGeometry(b, geometry) {
    let id = b.geoIds.get(geometry.uuid);
    if (id !== undefined) return id;
    const ng = normaliseGeometry(geometry, b.spec);
    const nv = ng.getAttribute('position').count;
    const ni = ng.getIndex().count;
    if (b.usedV + nv > b.verts || b.usedI + ni > b.indices) {
      b.verts = Math.max(b.verts * 2, b.usedV + nv);
      b.indices = Math.max(b.indices * 2, b.usedI + ni);
      b.mesh.setGeometrySize(b.verts, b.indices);
    }
    id = b.mesh.addGeometry(ng);
    b.usedV += nv; b.usedI += ni;
    b.geoIds.set(geometry.uuid, id);
    return id;
  }

  function addInstance(mesh) {
    const mat = matOf(mesh);
    let b = batches.get(mat.uuid);
    if (!b) b = createBatch(mat, [mesh.geometry]);
    for (const name in mesh.geometry.attributes) {
      if (!(name in b.spec)) { // attribute layout unknown to this batch: it is simply dropped (logged once)
        if (!b.warned) { b.warned = true; console.warn('[world] geometry attribute not in batch layout, ignored:', name); }
      }
    }
    const gid = addGeometry(b, mesh.geometry);
    if (b.instances + 1 > b.mesh.maxInstanceCount) b.mesh.setInstanceCount(b.mesh.maxInstanceCount * 2);
    const id = b.mesh.addInstance(gid);
    b.instances++;
    b.mesh.setVisibleAt(id, false);
    // heartland (also creates the colour texture up front). integrator (round 3): glow batches too - their instance colour is the
    // lantern level (game/lanterns.js); a recycled instance id kept the level of the unlit lamp pane it last held (dark windows).
    if (b.tinted || isGlow(b.material)) b.mesh.setColorAt(id, _tintCol.setRGB(1, 1, 1));
    return { b, id };
  }

  // ================================================================================================
  // Model analysis: soft blockers (distance field) + bridge deck profile, derived from the prototypes
  // ================================================================================================
  /** model id -> { sdf: Float32Array | null, deck: Float32Array | null, pond: boolean } */
  const modelData = new Map();

  const PIECE_CLASS = (base) => (/^(tree|flowers|haystack|scarecrow|hedge|beehive)/.test(base) ? 1 : /^fence/.test(base) ? 2 : /^(bush|tuft)/.test(base) ? 3 : 0);
  const LOW_RX = /(^|_)(log|boulder|rock|stone|crag|hedge|fence|hive|woodpile|crate|barrel|cart|well|fountain|bench|stall|sled|bed|stump|side_[ew]|ridge|dune|drift|ice|column|steps|pots|snowman|trough|bale|back_\d|front_\d|hay|tent|fire|pear|lamp|lantern|milestone|spring)/;
  const SOFT_RX = /^(bush|tuft|flowers?|reeds?|fern|mushroom|shroom|sheep|cow|chicken|hen|pig|dog|cat|pet|goat|horse|duck|bird|grass)/;
  const _dT = new Float32Array(SDF_N * SDF_N);
  const _dL = new Float32Array(SDF_N * SDF_N);
  const _dK = new Float32Array(SDF_N * SDF_N);
  const _K = new Uint8Array(SDF_N * SDF_N);
  const _open = new Uint8Array(SDF_N * SDF_N);
  const _stack = new Int32Array(SDF_N * SDF_N);

  /** Two-pass chamfer distance (world units) to the cells of `occ` carrying `bit`. */
  function chamfer(occ, bit, d, outside) {
    const BIG = 1e3; const s1 = SDF_STEP; const s2 = SDF_STEP * Math.SQRT2;
    const OUT = outside === true ? 0 : BIG; // outside === true: everything beyond the tile counts as occupied
    for (let i = 0; i < d.length; i++) d[i] = (occ[i] & bit) ? 0 : BIG;
    const at = (x, y) => (x < 0 || y < 0 || x >= SDF_N || y >= SDF_N ? OUT : d[y * SDF_N + x]);
    for (let y = 0; y < SDF_N; y++) for (let x = 0; x < SDF_N; x++) {
      const i = y * SDF_N + x;
      d[i] = Math.min(d[i], at(x - 1, y) + s1, at(x, y - 1) + s1, at(x - 1, y - 1) + s2, at(x + 1, y - 1) + s2);
    }
    for (let y = SDF_N - 1; y >= 0; y--) for (let x = SDF_N - 1; x >= 0; x--) {
      const i = y * SDF_N + x;
      d[i] = Math.min(d[i], at(x + 1, y) + s1, at(x, y + 1) + s1, at(x + 1, y + 1) + s2, at(x - 1, y + 1) + s2);
    }
  }

  /** Marks (as tall-occupied) every open cell that cannot be reached from the tile border: hollow buildings, prop rings. */
  function fillEnclosed(occ, bitT, padT, padL, kind) {
    let n = 0; let filled = 0;
    const onPath = W.blockerPadding - W.pathPadding; // same rule as clearanceAt: a path strip keeps only pathPadding
    for (let i = 0; i < _open.length; i++) {
      const k = kind[i];
      _open[i] = k === 3 ? 0 : k === 2 ? 1 : k === 1 ? (Math.min(_dT[i] - W.blockerPadding, _dL[i] - padL) + onPath > 0 ? 1 : 0) : _dT[i] > padT && _dL[i] > padL && _K[i] === 0 ? 1 : 0;
    }
    const push = (i) => { if (_open[i] === 1) { _open[i] = 2; _stack[n++] = i; } };
    for (let k = 0; k < SDF_N; k++) { push(k); push((SDF_N - 1) * SDF_N + k); push(k * SDF_N); push(k * SDF_N + SDF_N - 1); }
    while (n > 0) {
      const i = _stack[--n]; const x = i % SDF_N; const y = (i / SDF_N) | 0;
      if (x > 0) push(i - 1); if (x < SDF_N - 1) push(i + 1); if (y > 0) push(i - SDF_N); if (y < SDF_N - 1) push(i + SDF_N);
    }
    for (let i = 0; i < _open.length; i++) if (_open[i] === 1) { occ[i] |= bitT; filled++; }
    return filled;
  }

  /**
   * Clearance field of one occupancy variant: min(distance to tall - blockerPadding, distance to low - lowBlockerPadding);
   * > 0 = the feet may stand there. Interiors (cells not reachable from the tile border) are solid.
   */
  function buildField(occ, bitT, bitL, kind) {
    const padT = W.blockerPadding; const padL = W.lowBlockerPadding;
    // Pockets: the crossed cards of one tree make four concave quadrants, two props meet in a V ... a walker pushed
    // into one is wedged. Morphological closing (grow by closeRadius, shrink by the same) fills every nook the
    // traveller's body could not turn round in; convex shapes (houses, single cards) are unchanged. Path strips,
    // bridge decks and water are never filled.
    _K.fill(0);
    const cr = W.closeRadius || 0;
    if (cr > 0) {
      chamfer(occ, bitT | bitL, _dK);
      for (let i = 0; i < _open.length; i++) _open[i] = _dK[i] <= cr ? 0 : 1; // 1 = outside the grown shape
      chamfer(_open, 1, _dT, true);
      for (let i = 0; i < _K.length; i++) _K[i] = _dT[i] > cr + 1e-4 && kind[i] === 0 && !(occ[i] & (bitT | bitL)) ? 1 : 0;
    }
    chamfer(_K, 1, _dK);
    chamfer(occ, bitT, _dT); chamfer(occ, bitL, _dL);
    if (W.fillEnclosed !== false) {
      if (fillEnclosed(occ, bitT, Math.max(padT, W.fillPadding), padL, kind) > 0) chamfer(occ, bitT, _dT);
      if (fillEnclosed(occ, bitT, padT, padL, kind) > 0) chamfer(occ, bitT, _dT);
    }
    const f = new Float32Array(SDF_N * SDF_N);
    for (let i = 0; i < f.length; i++) f[i] = Math.min(_dT[i] - padT, _dL[i] - padL, _dK[i] - W.closePadding);
    return f;
  }

  function analyse(model, parity = 0) {
    const md = { sdf: null, sdfDry: null, sdfDryNF: null, deck: null, pond: model === 'pond', viewDep: false, odd: null, pivots: null, houseS: 1 };
    if (parity === 0) modelData.set(model, md);
    let root = null;
    try { root = assets.getTilePrototype(model).clone(true); } catch { return md; }
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    const def = MODELS[model] || MODELS[FALLBACK_MODEL];
    const s = def.sockets;
    const isBridge = (s.n === 'path' && s.s === 'path' && (s.e === 'river' || s.w === 'river'));
    // occupancy bits: 1 / 2 / 4 = tall blocker in variant 0 (all pieces) / 1 (dry biomes: culled class-1 props removed)
    // / 2 (desert: fences removed too); 8 / 16 / 32 = the same for LOW solid pieces (logs, boulders, fences ...)
    const occ = new Uint8Array(SDF_N * SDF_N);
    let any = false;
    const generic = !OWN_ART.has(model);
    /** slot-together props (tree + tree_xf + tree_xb ...): base name -> { cells, bits, cross } for the hull fill below */
    const hulls = new Map();
    const deck = isBridge ? new Float32Array(SDF_N).fill(-1) : null;
    const lo = W.blockBandLo; const hi = W.blockBandHi;
    const box = new THREE.Box3();
    // shortfall pass: the field is built from the pieces AS DRAWN - houses grown about their pivot, cards turned to the
    // camera and scaled, crossed cards on the view diagonals; thinned cards never stand. parity = cell.rot & 1 (staticFix).
    const list = [];
    root.traverse((o) => { if (o.isMesh && o.geometry && !isBaseMesh(o)) list.push(o); });
    const sp = W.cards && W.cards.enabled !== false && W.cards.collide !== false ? cardSpecs(model, root, list) : null;
    if (sp !== null) { md.houseS = sp.houseS || 1; md.pivots = [...sp.pivots.values()].filter(Boolean); }
    const fx = new THREE.Matrix4();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || isBaseMesh(o)) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      const li = list.indexOf(o);
      fx.copy(o.matrixWorld);
      const turned = sp !== null && staticFix(sp, li, parity);
      if (turned) fx.premultiply(_cm);
      box.setFromBufferAttribute(pos).applyMatrix4(fx);
      // physics pass: what blocks is decided by piece class, not by height alone. Tall pieces block (padding
      // blockerPadding); waist-high SOLID pieces (name list) block with the smaller lowBlockerPadding; soft fillers
      // (bush, tuft, flowers, reeds, ferns, mushrooms, animals) never block.
      let pc = 0; let lowName = false; let soft = false; let first = true; let hull = null;
      for (let a = o; a && a !== root; a = a.parent) {
        const raw = String(a.name || '').replace(/^.*__/, '');
        const base = raw.replace(/_x[bf]$/, '');
        if (!base) continue;
        if (!pc) pc = PIECE_CLASS(base);
        if (first) {
          soft = SOFT_RX.test(base); first = false;
          hull = hulls.get(base);
          if (!hull) hulls.set(base, (hull = { cells: new Set(), bits: 0, cross: false }));
          if (raw !== base) hull.cross = true;
        }
        if (LOW_RX.test(base)) lowName = true;
      }
      const top = box.max.y;
      const isTall = top >= W.blockMinHeight && pc !== 3 && !(soft && top < W.blockMinHeight + 0.25);
      const isLow = !isTall && !soft && pc !== 3 && lowName && top >= W.lowBlockMinHeight;
      const tall = (isTall || isLow) && !(sp !== null && sp.thin[li] === 1);
      if (tall && turned && sp.cardJ[li] < 50) md.viewDep = true;
      let bits = 0;
      if (tall) {
        bits = 1;
        if (generic && pc !== 1) { bits |= 2; if (pc !== 2) bits |= 4; }
        if (!generic) bits = 7;
        if (isLow) bits <<= 3;
      }
      if (W.debugPieces !== false) (md.pieces || (md.pieces = [])).push([o.name, +top.toFixed(2), isTall ? 'T' : isLow ? 'L' : '-']);
      if (!tall && !deck) return;
      const idx = o.geometry.getIndex();
      const tris = (idx ? idx.count : pos.count) / 3;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3; const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1; const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(fx);
        _b.fromBufferAttribute(pos, i1).applyMatrix4(fx);
        _c.fromBufferAttribute(pos, i2).applyMatrix4(fx);
        const ymin = Math.min(_a.y, _b.y, _c.y); const ymax = Math.max(_a.y, _b.y, _c.y);
        const inBand = tall && ymax >= lo && ymin <= hi;
        // deck candidates: roughly horizontal faces above the page, near the path centre line
        let deckTri = false;
        if (deck && ymax > 0.03) {
          _v.subVectors(_b, _a).cross(_c.clone().sub(_a));
          const len = _v.length();
          deckTri = len > 1e-9 && Math.abs(_v.y) / len > 0.6;
        }
        if (!inBand && !deckTri) continue;
        const e = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
        const n = Math.min(160, Math.max(1, Math.ceil(e / 0.02)));
        for (let i = 0; i <= n; i++) {
          for (let j = 0; j <= n - i; j++) {
            const u = i / n; const w = j / n;
            const x = _a.x + (_b.x - _a.x) * u + (_c.x - _a.x) * w;
            const y = _a.y + (_b.y - _a.y) * u + (_c.y - _a.y) * w;
            const z = _a.z + (_b.z - _a.z) * u + (_c.z - _a.z) * w;
            if (inBand && y >= lo && y <= hi && Math.abs(x) <= HALF && Math.abs(z) <= HALF && !(deck && Math.abs(x) <= W.deckClearHalf)) {
              const ci = Math.round((z + HALF) / SDF_STEP) * SDF_N + Math.round((x + HALF) / SDF_STEP);
              occ[ci] |= bits;
              if (hull !== null) { hull.cells.add(ci); hull.bits |= bits; }
              any = true;
            }
            if (deckTri && Math.abs(x) <= 0.16 && Math.abs(z) <= HALF && y < 0.7) {
              const k = Math.round((z + HALF) / SDF_STEP);
              if (y > deck[k]) deck[k] = y;
            }
          }
        }
      }
    });
    if (any) {
      // surface of every field cell in the model's own (rot 0) frame: 0 grass, 1 path, 2 bridge deck, 3 water
      const kind = new Uint8Array(SDF_N * SDF_N);
      const pd = W.ponds && W.ponds[model];
      for (let zi = 0; zi < SDF_N; zi++) for (let xi = 0; xi < SDF_N; xi++) {
        const x = xi * SDF_STEP - HALF; const z = zi * SDF_STEP - HALF;
        const onP = onKind(s, 'path', x, z, PW); const onR = onKind(s, 'river', x, z, RW);
        let k = onP && onR ? 2 : onR ? 3 : onP ? 1 : 0;
        if (k === 0 && model === 'pond' && x * x + z * z < (W.pondRadius + W.waterPadding) * (W.pondRadius + W.waterPadding)) k = 3;
        if (k === 0 && pd) { const pu = x - pd[0]; const pv = z - pd[1]; const pr = pd[2] + W.waterPadding; if (pu * pu + pv * pv < pr * pr) k = 3; }
        kind[zi * SDF_N + xi] = k;
      }
      // A prop built from crossed cards is solid over its whole footprint (convex hull of the cards): the four
      // quadrants between the cards of a tree were pockets a walker got wedged in. Never on path strips / decks.
      if (W.hullFill !== false) {
        for (const h of hulls.values()) {
          if (!h.cross || h.cells.size < 3) continue;
          const pts = [...h.cells].map((c) => [c % SDF_N, (c / SDF_N) | 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
          const lower = []; const upper = [];
          for (const p of pts) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
          for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
          const poly = lower.slice(0, -1).concat(upper.slice(0, -1));
          if (poly.length < 3) continue;
          let x0 = SDF_N; let x1 = 0; let z0 = SDF_N; let z1 = 0;
          for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
          if ((x1 - x0) * SDF_STEP > W.hullMaxSize || (z1 - z0) * SDF_STEP > W.hullMaxSize) continue; // long ridge / wall cards: not a single prop
          for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) {
            if (kind[zi * SDF_N + xi] !== 0) continue;
            let inside = true;
            for (let k = 0; k < poly.length && inside; k++) if (cr(poly[k], poly[(k + 1) % poly.length], [xi, zi]) < 0) inside = false;
            if (inside) occ[zi * SDF_N + xi] |= h.bits;
          }
        }
      }
      md.sdf = buildField(occ, 1, 8, kind);
      let dry = false; let nf = false;
      for (let i = 0; i < occ.length; i++) { const o = occ[i]; if (((o & 1) !== 0) !== ((o & 2) !== 0) || ((o & 8) !== 0) !== ((o & 16) !== 0)) dry = true; if (((o & 2) !== 0) !== ((o & 4) !== 0) || ((o & 16) !== 0) !== ((o & 32) !== 0)) nf = true; }
      md.sdfDry = dry ? buildField(occ, 2, 16, kind) : md.sdf;
      md.sdfDryNF = nf ? buildField(occ, 4, 32, kind) : md.sdfDry;
    }
    if (deck) {
      let has = false;
      for (let k = 0; k < SDF_N; k++) if (deck[k] > 0.03) has = true;
      const p = new Float32Array(SDF_N);
      if (has) {
        // fill gaps by linear interpolation between sampled bins (ends are on the page)
        let last = -1; let lastV = 0;
        for (let k = 0; k <= SDF_N; k++) {
          const v = k === SDF_N ? 0 : deck[k];
          if (k === SDF_N || v >= 0) {
            for (let q = last + 1; q < k; q++) p[q] = lastV + (v - lastV) * ((q - last) / (k - last));
            if (k < SDF_N) p[k] = v;
            last = k; lastV = v;
          }
        }
      } else if (W.deckFallbackHeight > 0) {
        for (let k = 0; k < SDF_N; k++) { const v = (k / (SDF_N - 1)) * 2 - 1; p[k] = W.deckFallbackHeight * Math.max(0, Math.cos(v * Math.PI * 0.62)); }
      }
      // pin the ends to the page, smooth, then limit the slope so heightAt stays continuous and walkable
      const tmp = new Float32Array(SDF_N);
      for (let k = 0; k < SDF_N; k++) { const v = Math.abs((k / (SDF_N - 1)) * 2 - 1); p[k] *= 1 - THREE.MathUtils.smoothstep(v, 0.72, 0.97); }
      for (let pass = 0; pass < 3; pass++) {
        for (let k = 0; k < SDF_N; k++) tmp[k] = (p[Math.max(0, k - 1)] + p[k] * 2 + p[Math.min(SDF_N - 1, k + 1)]) / 4;
        p.set(tmp);
      }
      p[0] = p[SDF_N - 1] = 0;
      const maxStep = W.deckMaxSlope * SDF_STEP;
      for (let k = 1; k < SDF_N; k++) if (p[k] > p[k - 1] + maxStep) p[k] = p[k - 1] + maxStep;
      for (let k = SDF_N - 2; k >= 0; k--) if (p[k] > p[k + 1] + maxStep) p[k] = p[k + 1] + maxStep;
      let peak = 0;
      for (let k = 0; k < SDF_N; k++) peak = Math.max(peak, p[k]);
      md.deck = peak > 0.01 ? p : null;
    }
    return md;
  }
  const dataFor = (model) => modelData.get(model) || analyse(model);

  // ================================================================================================
  // Cells, records, pool
  // ================================================================================================
  const cellCache = new Array(CACHE * CACHE).fill(null);
  function cellAt(cx, cz) {
    const i = ((cz & CMASK) << 6) | (cx & CMASK);
    const c = cellCache[i];
    if (c !== null && c.x === cx && c.z === cz) return c;
    const n = wfc.get(cx, cz);
    cellCache[i] = n;
    return n;
  }

  const grid = new Array(GRID * GRID).fill(null);
  const activeList = [];
  const pool = new Map(); // model -> rec[]
  let pooledCount = 0;
  let created = 0;

  function lookup(cx, cz) {
    const r = grid[((cz & GMASK) << 5) | (cx & GMASK)];
    return r !== null && r.cx === cx && r.cz === cz ? r : null;
  }

  function createRecord(model) {
    const g = assets.getTilePrototype(model).clone(true);
    g.matrixAutoUpdate = true;
    const info = { tileId: model };
    // windmill sails: the clone (never the shared prototype) gets its sail layer as a child mesh turning about the hub
    if (SPIN_RX !== null) {
      const hits = [];
      g.traverse((o) => { if (renderable(o) && spinSplit(o)) hits.push(o); });
      for (const o of hits) {
        const sp = spinSplit(o);
        o.geometry = sp.body;
        const sail = new THREE.Mesh(sp.part, o.material);
        sail.name = o.name + '_spin';
        sail.userData.spin = true;
        sail.position.copy(sp.hub);
        sail.castShadow = o.castShadow; sail.receiveShadow = o.receiveShadow;
        o.add(sail);
        sail.updateMatrixWorld(true);
      }
    }
    // shortfall pass (make room): upright height / half width of every top flap, measured before the fold takes over
    let dims = null;
    if (MR !== null) {
      dims = new Map();
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if (!renderable(o)) return;
        let top = o;
        while (top.parent && top.parent !== g) top = top.parent;
        if (top.parent !== g) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox; const te = top.matrixWorld.elements;
        let d = dims.get(top);
        if (!d) dims.set(top, (d = [0, 0]));
        for (let q = 0; q < 8; q++) {
          _v.set(q & 1 ? bb.max.x : bb.min.x, q & 2 ? bb.max.y : bb.min.y, q & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
          if (_v.y - te[13] > d[0]) d[0] = _v.y - te[13];
          const w = hypot2(_v.x - te[12], _v.z - te[14]);
          if (w > d[1]) d[1] = w;
        }
      });
    }
    const fold = createFoldInstance(g, info);
    const meshes = [];
    const inst = [];
    g.traverse((o) => { if (renderable(o) && o.visible !== false) { meshes.push(o); inst.push(addInstance(o)); } });
    // instances that ride on a swaying (or spinning) flap: only these get new matrices while the tile idles
    const swayIdx = [];
    const sway = fold.sway || [];
    for (let i = 0; i < meshes.length; i++) {
      for (let a = meshes[i]; a && a !== g; a = a.parent) {
        let hit = false;
        for (let k = 0; k < sway.length; k++) if (sway[k].node === a) hit = true;
        if (hit) { swayIdx.push(i); break; }
      }
    }
    let spins = false;
    for (let k = 0; k < sway.length; k++) if (sway[k].spin !== null) spins = true;
    created++;
    // fixer (biome pass): piece class per instance, for the per-biome prop allowlist (see cullFor)
    // bit 0-1: 1 = heartland-only prop (tree / flowers / haystack / scarecrow / hedge), 2 = fence, 3 = thin filler (bush / tuft); bits 2+: prop group
    let cls = null; let bushy = null; let keep = null;
    if (!OWN_ART.has(model)) {
      cls = new Uint8Array(meshes.length);
      bushy = new Uint8Array(meshes.length);
      keep = new Uint8Array(meshes.length);
      const groups = [];
      for (let i = 0; i < meshes.length; i++) {
        let c = 0; let base = '';
        for (let a = meshes[i]; a && a !== g && !c; a = a.parent) { // the loader strips the 'tileid__' prefix: names are 'tree', 'tree_xf', 'bush' ...
          base = String(a.name || '').replace(/^.*__/, '').replace(/_x[bf]$/, '');
          c = PIECE_CLASS(base);
        }
        if (KEEP_TINT_RX.test(base) || KEEP_TINT_RX.test(String(meshes[i].name || '').replace(/^.*__/, ''))) keep[i] = 1;
        if (!c) continue;
        if (c === 3 && /^bush/.test(base)) bushy[i] = 1;
        if ((model === 'meadow' && /^haystack/.test(base)) || (model === 'meadow_flowers' && /^beehive/.test(base))) bushy[i] = 2; // integrator: thinned per cell (hayHidden)
        let gi = groups.indexOf(base);
        if (gi < 0) { gi = groups.length; groups.push(base); }
        cls[i] = c | ((gi & 31) << 2);
      }
    }
    // fixer (gold pass): small single cards turn to face the camera once upright (no more edge-on slivers), trees shrink a little
    const sp = cardSpecs(model, g, meshes);
    // shortfall pass (make room): height and half width of every card, for the sight-line test
    let room = null; let roomH = null; let roomW = null;
    if (dims !== null && sp.card !== null) {
      room = new Float32Array(meshes.length); roomH = new Float32Array(meshes.length); roomW = new Float32Array(meshes.length);
      for (let i = 0; i < meshes.length; i++) { const d = sp.card[i] !== null ? dims.get(sp.card[i]) : undefined; if (d) { roomH[i] = d[0]; roomW[i] = d[1]; } }
    }
    return { card: sp.card, cardS: sp.cardS, cardJ: sp.cardJ, cardP: sp.cardP, thin: sp.thin, thinAny: sp.thinAny, room, roomH, roomW, roomOn: false, cls, bushy, keep, hide: null, key: '', cx: 0, cz: 0, cell: null, group: g, fold, info, model, meshes, inst, shown: false, pending: false, guard: false, held: 0, timer: 0, dirty: false, index: -1, flipAt: -1e9, biome: 0, swayIdx: Int16Array.from(swayIdx), spins, wind: 1, cy: 1, sy: 0 };
  }

  /**
   * What the gold pass does to each mesh of a tile once it stands - shared by the drawn instances, the walk field and
   * the scraps' open-ground test, so they agree. card[i] = the top flap the mesh rides on (null = untouched), cardS =
   * scale, cardJ < 50: faces the camera (+ jitter) / >= 100: crossed cards / 99: scale only / 200: house (pivot cardP[i]);
   * thin[i] = 1: a soft filler card that never stands (fixed per model, so the page print leaves it out too).
   */
  function cardSpecs(model, g, meshes) {
    const card = new Array(meshes.length).fill(null);
    const cardS = new Float32Array(meshes.length);
    const cardJ = new Float32Array(meshes.length);
    const thin = new Uint8Array(meshes.length); // 1 = a soft filler card that never stands (cards.js isThinned)
    let thinAny = false;
    let anyCard = false; let cardP = null; const housePivots = new Map();
    const houseS = W.cards ? (/^(village|village_b|snow_hamlet)$/.test(model) ? W.cards.houseRow : W.cards.house) || 0 : 0; // rows of houses stand close: they grow less
    if (W.cards && W.cards.enabled !== false) {
      for (let i = 0; i < meshes.length; i++) {
        let top = meshes[i];
        while (top.parent && top.parent !== g) top = top.parent;
        if (top.parent !== g) continue;
        const nm = String(top.name || '').replace(/^.*__/, '');
        let sc = 0; let face = false; let cross = false;
        if (isThinned(model, nm)) { thin[i] = 1; thinAny = true; }
        if (CROSS_RX.test(nm) && top.children.some((c) => /_x[bf]$/.test(c.name || ''))) { cross = true; sc = TREE_RX.test(nm) ? W.cards.tree : 1; }
        else if (CARD_RX.test(nm)) { face = true; sc = /^reeds/.test(nm) ? W.cards.reeds : /^(bush|snowbush|thorn)/.test(nm) ? W.cards.bush : /^(flowers|desert_flowers|tuft|fern|mushrooms)/.test(nm) ? W.cards.small : W.cards.prop; }
        else if (TREE_RX.test(nm)) sc = W.cards.tree;
        if (!sc && houseS > 0 && houseS !== 1) {
          // houses grow about the middle of their footprint (all their flaps share one pivot, so the box stays closed)
          const hm = HOUSE_RX.exec(nm);
          if (hm) {
            let pv = housePivots.get(hm[1]);
            if (pv === undefined) {
              let fr = null; let bk = null;
              for (const c of g.children) { const cn = String(c.name || '').replace(/^.*__/, ''); if (cn === hm[1] + '_front') fr = c; else if (cn === hm[1] + '_back') bk = c; }
              pv = fr && bk ? new THREE.Vector3().addVectors(fr.position, bk.position).multiplyScalar(0.5).setY(0) : null;
              housePivots.set(hm[1], pv);
            }
            if (pv) { card[i] = top; cardS[i] = houseS; cardJ[i] = 200; (cardP || (cardP = new Array(meshes.length).fill(null)))[i] = pv; anyCard = true; }
          }
          continue;
        }
        if (!sc || (!face && !cross && sc === 1)) continue;
        card[i] = top; cardS[i] = sc; anyCard = true;
        const jit = ((hashStr(nm) % 1000) / 1000 - 0.5) * 2 * (W.cards.jitterDeg || 0) * Math.PI / 180;
        cardJ[i] = face ? jit : cross ? 100 + jit * 0.6 : 99; // < 50: face the camera; >= 100: crossed cards stand on the view diagonals
      }
    }
    return { card: anyCard ? card : null, cardS, cardJ, cardP, thin, thinAny, pivots: housePivots, houseS };
  }

  const CARD_RX = /^(bush|flowers|tuft|rock|fern|mushrooms|desert_flowers|thorn|snowbush|reeds|stump|pebble|stone_[a-d](_|$)|ice_rock|mossy_boulder|barrel|pots|crates|hay|hives|beehive|woodpile|sled|snowman|cart|bench|sign(_|$)|guidepost|scarecrow|picnic|shroom_c|well|fence$|fence(?:_(?:l|r|ne|yard_[ab]))?_0$)/; // shortfall fixer: + single fence sections (one flat diagonal card: a blade in yawed views); paddocks and longer runs keep their plan
  const TREE_RX = /^(tree|birch|pear)/;
  const HOUSE_RX = /^((?:house|cottage|cabin|manor)(?:_[a-z])?)_(?:front|back|roof_[bf]|wall_[lr]|chim|chim_lid|chim_x)$/;
  const _pv = new THREE.Vector3();
  const CROSS_RX = /^(tree|birch|pear|pine|cactus|palm|dead_tree|shroom|column)/;
  // shortfall pass: CONFIG.world.makeRoom (cards in the sight line fold down a little; needs the card fix)
  const MR = W.makeRoom && W.makeRoom.enabled !== false && W.cards && W.cards.enabled !== false ? W.makeRoom : null;
  const MR_LEAN = MR !== null ? (MR.leanDeg ?? 50) * Math.PI / 180 : 0;
  const view = { rx: 1, rz: 0 }; // camera right vector on the page (state.listener), as last used for the cards
  const _cm = new THREE.Matrix4();
  /**
   * fixer (gold pass): `_m` (world matrix of instance i) gets a turn about the vertical through its flap's hinge origin so
   * the card faces the camera (hinge axis parallel to the camera's right vector, +- a seeded jitter), and a scale.
   * Both fade in with the uprightness of the flap, so a card still rises out of its own flat print.
   */
  /** _cm = turn th about the vertical through the hinge origin of a flap (matrix elements ne) and scale s: T(p) RotY(th) S(s) T(-p). */
  function turnMat(ne, th, s) {
    const c = Math.cos(th) * s; const sn = Math.sin(th) * s;
    const px = ne[12]; const py = ne[13]; const pz = ne[14];
    _cm.set(
      c, 0, sn, px - c * px - sn * pz,
      0, s, 0, py - s * py,
      -sn, 0, c, pz + sn * px - c * pz,
      0, 0, 0, 1,
    );
  }
  /** Full turn of a card (mode j, see cardSpecs) whose flap has matrix elements ne, for a view whose right vector stands at angle va. */
  function cardTurn(ne, j, va) {
    if (j < 50) {
      const th = Math.atan2(ne[2], ne[0]) - va + j;
      return th - Math.PI * Math.round(th / Math.PI); // both faces are printed: the nearest of the two
    }
    if (j >= 99.5) {
      const th = Math.atan2(ne[2], ne[0]) - va + (W.cards.crossDeg ?? 45) * Math.PI / 180 + (j - 100);
      return th - Math.PI / 2 * Math.round(th / (Math.PI / 2)); // two crossed planes: the nearer one ends up crossDeg off the view
    }
    return 0;
  }
  /**
   * shortfall pass: _cm = the same correction for a tile at rest in TILE space (rot 0), fully upright, for the gameplay
   * camera (yaw 0). A camera-facing card then lies along world X: along tile x for even cell.rot, tile z for odd (parity).
   */
  const _tm = new THREE.Matrix4();
  function staticFix(sp, i, parity) {
    if (sp.card === null || sp.card[i] === null) return false;
    const top = sp.card[i]; const j = sp.cardJ[i]; const s = sp.cardS[i];
    if (j > 150) { const p = sp.cardP[i]; _cm.set(s, 0, 0, p.x - s * p.x, 0, s, 0, 0, 0, 0, s, p.z - s * p.z, 0, 0, 0, 1); return true; }
    const ne = _tm.compose(top.position, top.quaternion, top.scale).elements;
    turnMat(ne, cardTurn(ne, j, rotToY(parity)), s);
    return true;
  }
  const _ax = new THREE.Vector3();
  const _sv = new THREE.Vector3(); const _sd = new THREE.Vector3(); const _si = new THREE.Matrix4(); // sightBlocked scratch
  function cardFix(rec, i) {
    const top = rec.card[i];
    const j = rec.cardJ[i];
    if (j > 150) { // house: one pivot and one factor for every flap of the box
      let kh = (rec.fold.progress - 0.2) / 0.7; if (!(kh > 0)) return; if (kh > 1) kh = 1; kh = kh * kh * (3 - 2 * kh);
      _pv.copy(rec.cardP[i]).applyMatrix4(rec.group.matrixWorld);
      const sh = 1 + (rec.cardS[i] - 1) * kh;
      _cm.set(sh, 0, 0, _pv.x - sh * _pv.x, 0, sh, 0, _pv.y - sh * _pv.y, 0, 0, sh, _pv.z - sh * _pv.z, 0, 0, 0, 1);
      _m.premultiply(_cm);
      return;
    }
    const ne = top.matrixWorld.elements;
    const up = ne[5] / (Math.hypot(ne[4], ne[5], ne[6]) || 1);
    let k = (up - 0.3) / 0.65; if (k <= 0) return; if (k > 1) k = 1; k = k * k * (3 - 2 * k);
    turnMat(ne, cardTurn(ne, j, Math.atan2(view.rz, view.rx)) * k, 1 + (rec.cardS[i] - 1) * k);
    _m.premultiply(_cm);
    // make room: a card standing between the camera and the traveller tips sideways out of the sight line, about the
    // view direction through its hinge origin (so it keeps facing the camera and keeps its light; folding it toward
    // the camera put its face in shade and showed card backs). rec.room[i] = -1 .. 1, the sign is the side it tips to.
    if (rec.room !== null && rec.room[i] !== 0) {
      const r = Math.abs(rec.room[i]);
      _cm.makeRotationAxis(_ax.set(-view.rz, 0, view.rx), (rec.room[i] > 0 ? -1 : 1) * MR_LEAN * k * r * r * (3 - 2 * r));
      const e = _cm.elements; const px = ne[12]; const py = ne[13]; const pz = ne[14];
      e[12] = px - (e[0] * px + e[4] * py + e[8] * pz); e[13] = py - (e[1] * px + e[5] * py + e[9] * pz); e[14] = pz - (e[2] * px + e[6] * py + e[10] * pz);
      _m.premultiply(_cm);
    }
  }

  /** New matrices for the instances on swaying flaps only (the rest of the tile is untouched). */
  function writeSway(rec) {
    const sway = rec.fold.sway;
    for (let k = 0; k < sway.length; k++) sway[k].node.updateMatrixWorld(true);
    const ms = rec.meshes; const ix = rec.swayIdx;
    for (let j = 0; j < ix.length; j++) {
      const i = ix[j];
      _m.copy(ms[i].matrixWorld);
      if (rec.card !== null && rec.card[i] !== null) cardFix(rec, i);
      const e = _m.elements;
      e[12] -= origin.x; e[13] -= origin.y; e[14] -= origin.z;
      rec.inst[i].b.mesh.setMatrixAt(rec.inst[i].id, _m);
    }
  }

  function writeMatrices(rec) {
    rec.group.updateMatrixWorld(true);
    const ms = rec.meshes;
    for (let i = 0; i < ms.length; i++) {
      _m.copy(ms[i].matrixWorld);
      if (rec.card !== null && rec.card[i] !== null) cardFix(rec, i);
      const e = _m.elements;
      e[12] -= origin.x; e[13] -= origin.y; e[14] -= origin.z;
      rec.inst[i].b.mesh.setMatrixAt(rec.inst[i].id, _m);
    }
    rec.dirty = false;
  }

  function setShown(rec, on) {
    if (rec.shown === on) return;
    rec.shown = on;
    if (on) writeMatrices(rec);
    const hide = rec.hide;
    for (let i = 0; i < rec.inst.length; i++) rec.inst[i].b.mesh.setVisibleAt(rec.inst[i].id, on && !(hide && hide[i]));
    book.setHold(rec.cx, rec.cz, on);
    if (!on) book.setTwin(rec.cx, rec.cz, 1);
  }

  /**
   * fixer (biome pass): per-biome prop allowlist for the generic tiles (paths, rivers, meadow, rocks ...), whose pieces are
   * heartland art. Desert / snow drop the leafy trees, flowers, haystacks, scarecrows and hedges (desert also the picket
   * fences); outside heartland half of the small bush / tuft cards are dropped per cell (seeded) so they stop reading as
   * an even scatter. Heartland is untouched. Only the stand-up is hidden: the print on the page and the walk field stay.
   */
  const KEEP_TINT_RX = /^(reeds?|rock|boulder|stone|crag|haystack|fence|roof|log|well|bridge|ramp|side_|post|lantern|sign)/;
  /** integrator: the meadow model carries a hay rick and meadow_flowers a beehive; each stands on about 4 of its cells in 10 so meadows stop repeating like wallpaper. */
  const hayHidden = (cx, cz) => ((Math.imul(cx * 73856093 ^ cz * 19349663 ^ 0x5bd1e995, 2654435761) >>> 9) % 100) < (W.hayDrop ?? 60);
  function cullFor(rec, cell, cx, cz) {
    cullBiome(rec, cell, cx, cz);
    // fixer (gold pass): fewer, larger clumps with rest space between them - a share of the soft filler cards stays down.
    // shortfall pass: WHICH cards is fixed per model (cards.js isThinned), so book.js leaves them out of the flat print.
    if (!rec.thinAny) return;
    const th = rec.thin; let hide = rec.hide;
    if (hide === null) { hide = rec.hideBuf || (rec.hideBuf = new Uint8Array(th.length)); hide.fill(0); }
    for (let i = 0; i < th.length; i++) if (th[i] === 1) hide[i] = 1;
    rec.hide = hide;
  }
  function cullBiome(rec, cell, cx, cz) {
    const cls = rec.cls;
    const bi = cls && W.biomeCull !== false ? biomeIndexOf(cell) : 0;
    const noHay = cls && (rec.model === 'meadow' || rec.model === 'meadow_flowers') && W.biomeCull !== false && hayHidden(cx, cz);
    if (!bi) {
      if (!noHay) { rec.hide = null; return; }
      const hd = rec.hideBuf || (rec.hideBuf = new Uint8Array(cls.length));
      for (let i = 0; i < cls.length; i++) hd[i] = rec.bushy[i] === 2 ? 1 : 0;
      rec.hide = hd; return;
    }
    const name = BIOMES[bi];
    const dry = name === 'desert' || name === 'snow';
    let any = false;
    const hide = rec.hideBuf || (rec.hideBuf = new Uint8Array(cls.length));
    for (let i = 0; i < cls.length; i++) {
      const c = cls[i] & 3;
      let h = 0;
      if (c === 1) h = dry ? 1 : 0;
      else if (c === 2) h = name === 'desert' ? 1 : 0;
      else if (c === 3) {
        // the teal heartland bushes never stand on sand or snow. shortfall pass: this was a seeded share per cell (70 % of
        // bushes on snow, 30-45 % of tufts), which left prints with nothing rising; the dry flat print (book.js DRY_RX)
        // carries no bushes, so now none rise there, and the per-model thinning (cullFor) does the rest in every biome.
        h = dry && rec.bushy[i] === 1 ? 1 : 0;
      }
      if (noHay && rec.bushy[i] === 2) h = 1;
      hide[i] = h; if (h) any = true;
    }
    rec.hide = any ? hide : null;
  }

  function spawn(cx, cz) {
    const gi = ((cz & GMASK) << 5) | (cx & GMASK);
    if (grid[gi] !== null) despawn(grid[gi], true);
    const cell = cellAt(cx, cz);
    const list = pool.get(cell.model);
    let rec;
    if (list && list.length) { rec = list.pop(); pooledCount--; } else rec = createRecord(cell.model);
    rec.cx = cx; rec.cz = cz; rec.cell = cell; rec.key = cx + ',' + cz;
    rec.info.tileId = cell.tileId;
    rec.group.userData.tileId = cell.tileId;
    rec.group.position.set(cx * TILE_SIZE, 0, cz * TILE_SIZE);
    rec.group.rotation.y = rotToY(cell.rot);
    rec.cy = Math.cos(rec.group.rotation.y); rec.sy = Math.sin(rec.group.rotation.y);
    if (WIND_ON) { // wind strength: biome blend at the tile (desert gusty, pinewood still)
      biomeWeights(wfc.seed, cx, cz, _bw);
      let s = 0;
      for (let i = 0; i < _bw.length; i++) s += _bw[i] * windStrength[i];
      rec.wind = s;
    }
    // integrator (biome pass): single-biome tiles carry art drawn in their biome's colours - no prop tint on top
    const bi = OWN_ART.has(rec.model) && W.biomeTintOwnArt !== true ? 0 : biomeIndexOf(cell);
    if (bi !== rec.biome) { // pooled records keep their instances: re-colour only when the biome changes
      rec.biome = bi;
      _tintCol.setRGB(1 + bi, 1, 1);
      const sel = rec.keep !== null && W.biomeTintKeep && W.biomeTintKeep[BIOMES[bi]] === true; // selective tint: reeds stay green, rocks grey, roofs red
      for (let i = 0; i < rec.inst.length; i++) {
        if (!rec.inst[i].b.tinted) continue;
        if (sel && rec.keep[i] === 1) { _tintCol.setRGB(1, 1, 1); rec.inst[i].b.mesh.setColorAt(rec.inst[i].id, _tintCol); _tintCol.setRGB(1 + bi, 1, 1); } else rec.inst[i].b.mesh.setColorAt(rec.inst[i].id, _tintCol);
      }
    }
    cullFor(rec, cell, cx, cz);
    if (rec.room !== null) { rec.room.fill(0); rec.roomOn = false; }
    rec.fold.snap(0);
    rec.shown = false; rec.pending = false; rec.timer = 0; rec.dirty = true; rec.flipAt = -1e9;
    rec.index = activeList.length;
    activeList.push(rec);
    grid[gi] = rec;
    bus.emit('tile:spawn', { x: cx, z: cz, tileId: cell.tileId, rot: cell.rot });
    return rec;
  }

  function despawn(rec, force) {
    if (force && !rec.fold.settled) rec.fold.snap(0);
    setShown(rec, false);
    rec.pending = false;
    const gi = ((rec.cz & GMASK) << 5) | (rec.cx & GMASK);
    if (grid[gi] === rec) grid[gi] = null;
    const last = activeList.pop();
    if (last !== rec) { activeList[rec.index] = last; last.index = rec.index; }
    rec.index = -1;
    let list = pool.get(rec.model);
    if (!list) pool.set(rec.model, (list = []));
    list.push(rec);
    pooledCount++;
    bus.emit('tile:despawn', { x: rec.cx, z: rec.cz, tileId: rec.cell.tileId });
  }

  function rise(rec) {
    rec.pending = false;
    setShown(rec, true);
    rec.flipAt = clock;
    rec.fold.setTarget(1, 0);
    bus.emit('tile:rise', { x: rec.cx, z: rec.cz, tileId: rec.cell.tileId });
  }

  // ================================================================================================
  // Streaming
  // ================================================================================================
  const last = { x: 0, z: 0, px: 0, pz: 0, dx: 0, dz: -1, sx: 0, sz: -1, valid: false, fresh: false };
  let regionX = NaN; let regionZ = NaN;
  const NEAR = REVEAL_RADIUS * W.nearRadiusMul;
  const BACK_FOLD = W.foldBehind;
  const BACK_RISE = W.foldBehind - W.foldBehindHysteresis;
  let movingCount = 0;
  let reach = 0; // extra reveal radius (tiles) for far camera views, eased toward state.viewReach
  let clock = 0; // world-local simulation time (s)

  function twinFor(p) {
    // the printed twin fades out as the flaps lift off the page and returns as they come down
    const t = Math.min(1, Math.max(0, (p - 0.04) / 0.5));
    return 1 - t * t * (3 - 2 * t);
  }

  /** Camera right vector on the page changed (pose / clear-sight swing): the camera-facing cards are re-posed. */
  function syncView() {
    const L = state.listener;
    if (!L || !(Math.abs(L.rightX) + Math.abs(L.rightZ) > 0.5)) return;
    if (Math.abs(L.rightX - view.rx) + Math.abs(L.rightZ - view.rz) < 0.015) return;
    view.rx = L.rightX; view.rz = L.rightZ;
    for (let i = 0; i < activeList.length; i++) if (activeList[i].card !== null) activeList[i].dirty = true;
  }

  /**
   * shortfall pass (make room; the dotted see-through circle is off): a card whose hinge stands in the sight line between
   * the camera and the traveller, and tall enough to cover him from the knees up, eases over to one side (cardFix).
   * Only the gold-pass cards (trees, bushes, single props) take part; houses and other boxes stay as they are.
   */
  function makeRoom(dt, snap) {
    if (MR === null || !last.valid) return;
    const tx = -view.rz; const tz = view.rx; // toward the camera, on the page
    // round 3: the real camera pitch (follow.js publishes it): in the low views the sight line climbs slowly, so cards further off cover him
    const pitchNow = Math.max(18, Math.min(60, state.camPitch || (MR.pitchDeg ?? 42)));
    const tanP = Math.tan(pitchNow * Math.PI / 180);
    const k = snap ? 1 : 1 - Math.exp(-dt / (MR.ease || 0.22));
    const reach = Math.min(3.4, Math.max(MR.reach ?? 1.6, 1.15 / tanP)) + HALF;
    for (let n = 0; n < activeList.length; n++) {
      const rec = activeList[n];
      if (rec.room === null || !rec.shown) continue;
      const near = MR.enabled !== false && rec.fold.target === 1 && Math.abs(rec.cx * TILE_SIZE - last.px) < reach && Math.abs(rec.cz * TILE_SIZE - last.pz) < reach;
      if (!near && !rec.roomOn) continue;
      let on = false;
      const room = rec.room;
      for (let i = 0; i < room.length; i++) {
        const top = rec.card[i];
        if (top === null || rec.cardJ[i] > 150) continue;
        let want = 0;
        const cur = room[i];
        if (near && !(rec.hide !== null && rec.hide[i])) {
          const e = top.matrixWorld.elements;
          const dx = e[12] - last.px; const dz = e[14] - last.pz;
          const along = dx * tx + dz * tz; const side = dx * view.rx + dz * view.rz; const s = rec.cardS[i];
          if (along > (MR.minAhead ?? 0.05) && Math.abs(side) < rec.roomW[i] * s * (MR.width ?? 0.75) + (MR.side ?? 0.1) && rec.roomH[i] * s - along * tanP > (MR.cover ?? 0.3)) want = cur !== 0 ? (cur > 0 ? 1 : -1) : side >= 0 ? 1 : -1; // tips to the side it stands on, and keeps that side
        }
        if (cur === want) { if (want !== 0) on = true; continue; }
        let v = cur + (want - cur) * k;
        if (Math.abs(want - v) < 0.004) v = want;
        room[i] = v; rec.dirty = true;
        if (v !== 0) on = true;
      }
      rec.roomOn = on;
    }
  }

  function stream(dt, budget, instant) {
    // round 3 (camera views): a far view (views.js 'wide') sees past the reveal ring, so the ring grows by state.viewReach
    // tiles while such a view is active and shrinks back afterwards (eased: about one tile per 1.2 s, tiles ripple up / fold).
    {
      const wantReach = Math.max(0, Math.min(W.viewReachMax ?? 1.5, state.viewReach || 0));
      if (instant || last.fresh) reach = wantReach;
      else if (reach !== wantReach) { const st = dt * (W.viewReachRate ?? 0.85); reach += Math.max(-st, Math.min(st, wantReach - reach)); }
    }
    const RV = REVEAL_RADIUS + reach; const NEARV = NEAR + reach;
    syncView();
    makeRoom(dt, instant || last.fresh);
    const tx = last.x / TILE_SIZE; const tz = last.z / TILE_SIZE;
    const fx = tx + last.dx * W.forwardBias; const fz = tz + last.dz * W.forwardBias;
    const c0x = Math.round(tx); const c0z = Math.round(tz);
    const lead = W.inkLead;
    const R = Math.ceil(RV + W.forwardBias + lead) + 1;
    if (c0x !== regionX || c0z !== regionZ) { regionX = c0x; regionZ = c0z; if (wfc.ensureRegion) wfc.ensureRegion(c0x, c0z, R + 1); }

    clock += dt;
    // 1. cells that should exist / ink in / rise
    for (let cz = c0z - R; cz <= c0z + R; cz++) {
      for (let cx = c0x - R; cx <= c0x + R; cx++) {
        const dT = hypot2(cx - tx, cz - tz);
        const dF = hypot2(cx - fx, cz - fz);
        if (dF >= RV + lead && dT >= NEARV + lead) continue;
        if (!book.cellTouchesPage(cx, cz)) continue;
        book.markInk(cx, cz); // the print inks in one `inkLead` before the tile is asked to rise
        // tiles further than `foldBehind` rows BEHIND the heading are left flat (the page closes behind you)
        const back = -((cx - tx) * last.dx + (cz - tz) * last.dz);
        if ((dF < RV || dT < NEARV) && (instant || back < BACK_RISE)) {
          // a tile instance only exists while it is pending / moving / risen (flat tiles are just print)
          let rec = lookup(cx, cz);
          if (rec === null) {
            if (budget <= 0) continue;
            budget--;
            rec = spawn(cx, cz);
          }
          if (rec.shown) {
            if (rec.fold.target !== 1 && book.cellOnPage(cx, cz, 0) && (dT < W.reflipRadius || clock - rec.flipAt >= W.minFlipInterval)) { rec.flipAt = clock; rec.fold.setTarget(1, 0); bus.emit('tile:rise', { x: cx, z: cz, tileId: rec.cell.tileId }); }
          } else if (!rec.pending) {
            rec.pending = true;
            rec.guard = !last.fresh && !instant; rec.held = 0;
            rec.timer = instant || dT < RV - 0.75 && !last.fresh ? 0
              : dT * W.rippleDelay + (hash2f(cx, cz, 911) - 0.5) * 2 * W.rippleJitter;
            if (rec.timer < 0) rec.timer = 0;
          }
        }
      }
    }

    // 2. every active tile: timers, fold-back, springs, matrices, pooling
    let rises = 0;
    movingCount = 0;
    for (let i = activeList.length - 1; i >= 0; i--) {
      const rec = activeList[i];
      const dT = hypot2(rec.cx - tx, rec.cz - tz);
      const dF = hypot2(rec.cx - fx, rec.cz - fz);
      const back = -((rec.cx - tx) * last.dx + (rec.cz - tz) * last.dz);
      const want = (dF < RV || dT < NEARV) && back < BACK_FOLD;
      if (rec.pending) {
        if (!want) rec.pending = false;
        else if (book.cellOnPage(rec.cx, rec.cz, 0)) { // a tile only rises once it is wholly on the printed page
          if (instant) rise(rec);
          else if (book.inkReady(rec.cx, rec.cz)) {
            rec.timer -= dt;
            if (rec.timer <= 0 && rises < W.maxRisePerFrame) {
              // physics pass: a tile does not swing its flaps up through the traveller - while he is walking across a
              // still-flat tile it waits (at most riseHoldMax seconds; the opening ripple and teleports are exempt)
              if (rec.guard && rec.held < (W.riseHoldMax ?? 0) && Math.abs(last.px - rec.cx * TILE_SIZE) < HALF + 0.15 && Math.abs(last.pz - rec.cz * TILE_SIZE) < HALF + 0.15) rec.held += dt;
              else { rises++; rise(rec); }
            }
          }
        } else if (!instant && book.inkReady(rec.cx, rec.cz)) rec.timer -= dt;
      }
      // ... and folds away before the page margin reaches it (small hysteresis against edge flicker)
      const onPage = book.cellOnPage(rec.cx, rec.cz, W.pageHysteresis);
      if (rec.shown) {
        const fold = rec.fold;
        const behind = back >= BACK_FOLD && !instant;
        if (fold.target === 1 && (!onPage || (!want && (behind || (dT > (FOLD_BACK_RADIUS + reach) && dF >= RV + W.foldHysteresis)) && (instant || clock - rec.flipAt >= W.minFlipInterval)))) {
          rec.flipAt = clock;
          // the row behind closes from the traveller's track outward (stagger by sideways distance)
          let delay = 0;
          if (behind && onPage) {
            const side = Math.abs((rec.cx - tx) * last.dz - (rec.cz - tz) * last.dx);
            delay = side * W.foldBehindStagger + hash2f(rec.cx, rec.cz, 517) * W.rippleJitter;
          }
          fold.setTarget(0, delay);
          bus.emit('tile:flat', { x: rec.cx, z: rec.cz, tileId: rec.cell.tileId });
        }
        const moving = !fold.settled;
        if (moving) { fold.update(dt); movingCount++; }
        if (WIND_ON && rec.spins && (moving || rec.dirty)) fold.applyWind(state.time, -1, 0.6 + 0.4 * rec.wind, rec.cy, rec.sy); // sails keep turning while the tile folds
        if (moving || rec.dirty) {
          writeMatrices(rec);
          book.setTwin(rec.cx, rec.cz, twinFor(fold.progress));
        } else if (WIND_ON && fold.target === 1 && rec.swayIdx.length > 0 && dT < WIND.radius) {
          // idle life: a risen, settled tile rocks in the wind (pure function of state.time; no 'fold' events)
          fold.applyWind(state.time, rec.wind, 0.6 + 0.4 * rec.wind, rec.cy, rec.sy);
          writeSway(rec);
        }
        if (fold.settled && fold.target === 0) setShown(rec, false);
      }
      if (!rec.shown && !rec.pending) despawn(rec, false); // folded flat + settled: back to the pool
      else if (dT > DESPAWN_RADIUS + 4) despawn(rec, true); // left far behind by a teleport
    }
  }

  function rebase() {
    const D = W.rebaseDistance;
    if (Math.abs(last.x - origin.x) <= D && Math.abs(last.z - origin.z) <= D) return;
    origin.set(Math.round(last.x / 64) * 64, 0, Math.round(last.z / 64) * 64);
    batchRoot.position.copy(origin);
    batchRoot.updateMatrixWorld(true);
    for (let i = 0; i < activeList.length; i++) if (activeList[i].shown) writeMatrices(activeList[i]);
  }

  // ================================================================================================
  // Queries (allocation-free)
  // ================================================================================================
  const RW = RIVER_WIDTH / 2 + W.waterPadding;
  const PW = PATH_WIDTH / 2 + 0.05;
  let qU = 0; let qV = 0; // tile-local (rot 0) coordinates of the last query

  function inStrip(dx, dz, dir, w) {
    if (dir === 0) return dx >= -w && dx <= w && dz <= w && dz >= -HALF; // n
    if (dir === 1) return dz >= -w && dz <= w && dx >= -w && dx <= HALF; // e
    if (dir === 2) return dx >= -w && dx <= w && dz >= -w && dz <= HALF; // s
    return dz >= -w && dz <= w && dx <= w && dx >= -HALF; // w
  }

  /** Is tile-centred (dx,dz) on the path/river network of a cell? Two sockets on ADJACENT edges are joined by a
   *  quarter-circle around their shared tile corner (as the tile art draws them); everything else runs to the centre. */
  function onKind(s, kind, dx, dz, w) {
    const n = s.n === kind; const e = s.e === kind; const so = s.s === kind; const we = s.w === kind;
    const count = (n ? 1 : 0) + (e ? 1 : 0) + (so ? 1 : 0) + (we ? 1 : 0);
    if (count === 0) return false;
    if (count === 2 && !(n && so) && !(e && we)) {
      const kx = e ? HALF : -HALF; const kz = n ? -HALF : HALF;
      const r = hypot2(dx - kx, dz - kz) - HALF;
      return r >= -w && r <= w;
    }
    return (n && inStrip(dx, dz, 0, w)) || (e && inStrip(dx, dz, 1, w)) || (so && inStrip(dx, dz, 2, w)) || (we && inStrip(dx, dz, 3, w));
  }

  /** 0 grass, 1 path, 2 bridge, 3 water. Also leaves the tile-local point in qU/qV and the cell in qCell. */
  let qCell = null;
  function classify(x, z) {
    const cx = Math.round(x / TILE_SIZE); const cz = Math.round(z / TILE_SIZE);
    const cell = cellAt(cx, cz);
    qCell = cell;
    const dx = x - cx * TILE_SIZE; const dz = z - cz * TILE_SIZE;
    // tile-local frame (undo `rot` clockwise quarter turns)
    let u = dx; let v = dz;
    const rot = ((cell.rot % 4) + 4) % 4;
    for (let i = 0; i < rot; i++) { const t = u; u = v; v = -t; }
    qU = u; qV = v;
    const s = cell.sockets;
    const onPath = onKind(s, 'path', dx, dz, PW);
    const onRiver = onKind(s, 'river', dx, dz, RW);
    if (onPath && onRiver) return 2;
    if (onRiver) return 3;
    if (onPath) return 1;
    if (cell.model === 'pond' && dx * dx + dz * dz < (W.pondRadius + W.waterPadding) * (W.pondRadius + W.waterPadding)) return 3;
    // biome pass: off-centre ponds of the biome tiles (tile-local centre + radius, CONFIG.world.ponds)
    const pd = W.ponds && W.ponds[cell.model];
    if (pd) { const pu = u - pd[0]; const pv = v - pd[1]; const pr = pd[2] + W.waterPadding; if (pu * pu + pv * pv < pr * pr) return 3; }
    return 0;
  }

  function sampleField(d, u, v) {
    const fx = (u + HALF) / SDF_STEP; const fz = (v + HALF) / SDF_STEP;
    let x0 = Math.floor(fx); let z0 = Math.floor(fz);
    if (x0 < 0) x0 = 0; else if (x0 > SDF_N - 2) x0 = SDF_N - 2;
    if (z0 < 0) z0 = 0; else if (z0 > SDF_N - 2) z0 = SDF_N - 2;
    const ax = Math.min(1, Math.max(0, fx - x0)); const az = Math.min(1, Math.max(0, fz - z0));
    const i = z0 * SDF_N + x0;
    return (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - az) + (d[i + SDF_N] * (1 - ax) + d[i + SDF_N + 1] * ax) * az;
  }

  /** The clearance field that matches what is VISIBLE in the cell's biome (props hidden by cullFor do not block). */
  function fieldFor(cell) {
    let md = dataFor(cell.model);
    if (md.viewDep && (cell.rot & 1)) md = md.odd || (md.odd = analyse(cell.model, 1)); // camera-facing blockers lie along the other tile axis
    if (md.sdf === null || W.biomeCull === false) return md.sdf;
    if (cell.biome === 'snow') return md.sdfDry;
    if (cell.biome === 'desert') return md.sdfDryNF;
    if ((cell.model === 'meadow' || cell.model === 'meadow_flowers') && hayHidden(cell.x, cell.z)) return md.sdfDry; // hidden hay rick does not block
    return md.sdf;
  }

  const FREE = 4; // clearance of open ground with no blocker field
  const PATH_FREE = CONFIG.player.radius + 0.01;
  /**
   * Signed room (world units) around a point: <= 0 = the feet cannot stand there, >= the traveller's radius = free to move.
   * Water is a small negative constant (bridge decks are free). On a path the blocker padding shrinks to pathPadding
   * and anything standable counts as free, so lanes that brush a lamp or a trunk stay open - but a path never leads
   * through a wall any more.
   */
  function clearanceAt(x, z) {
    const s = classify(x, z);
    if (s === 3) return -0.05;
    if (s === 2) return FREE;
    const f = fieldFor(qCell);
    if (f === null) return FREE;
    const c = sampleField(f, qU, qV);
    if (s === 1) { const v = c + (W.blockerPadding - W.pathPadding); return v > 0 ? v + PATH_FREE : v; }
    return c;
  }

  const SURFACES = ['grass', 'path', 'bridge', 'water'];

  const api = {
    group,
    book,
    wfc,
    /** game-hook(lanterns): the live tile record of a cell (meshes + batch instances), or null. Read only. */
    tileRecord: lookup,
    /** Stream tiles around the traveller and advance every fold spring. */
    update(dt, travellerPos, moveDir) {
      const jump = !last.valid || hypot2(travellerPos.x - last.px, travellerPos.z - last.pz) > 1.5;
      last.px = travellerPos.x; last.pz = travellerPos.z; last.valid = true;
      // Grace area: the streaming anchor trails the traveller on a "rope" of length graceRadius. Small moves and
      // turns on the spot leave the anchor (and so every tile's rise / fold decision) untouched; only real
      // travel drags it along, and the heading for the forward bias is the direction of that travel.
      const G = W.graceRadius || 0;
      const gx = travellerPos.x - last.x; const gz = travellerPos.z - last.z;
      const gl = hypot2(gx, gz);
      if (jump) {
        last.x = travellerPos.x; last.z = travellerPos.z;
        if (moveDir && hypot2(moveDir.x, moveDir.z) > 1e-4) { last.sx = moveDir.x; last.sz = moveDir.z; last.dx = moveDir.x; last.dz = moveDir.z; }
      } else if (gl > G) {
        if (G > 0) {
          const k = W.dirSmooth <= 0 ? 1 : 1 - Math.exp(-dt / W.dirSmooth);
          last.sx += (gx / gl - last.sx) * k; last.sz += (gz / gl - last.sz) * k;
          const l = hypot2(last.sx, last.sz);
          if (l > 1e-4) { last.dx = last.sx / l; last.dz = last.sz / l; }
          last.x = travellerPos.x - (gx / gl) * G; last.z = travellerPos.z - (gz / gl) * G;
        } else {
          last.x = travellerPos.x; last.z = travellerPos.z;
          if (moveDir) {
            const k = W.dirSmooth <= 0 ? 1 : 1 - Math.exp(-dt / W.dirSmooth);
            last.sx += (moveDir.x - last.sx) * k; last.sz += (moveDir.z - last.sz) * k;
            const l = hypot2(last.sx, last.sz);
            if (l > 1e-4) { last.dx = last.sx / l; last.dz = last.sz / l; }
          }
        }
      }
      last.fresh = jump;
      rebase();
      book.follow(travellerPos);
      // teleport / first frame: spawn everything at once and ink the print around the new place immediately
      stream(dt, jump ? Infinity : W.spawnBudget, false);
      if (jump) book.settle(); else book.update(dt, travellerPos);
    },
    /** fixer (gold pass): re-pose the camera-facing cards for the current camera (state.listener) right now. */
    debugView() { return { rx: view.rx, rz: view.rz, lx: state.listener.rightX, lz: state.listener.rightZ, cards: activeList.filter((r) => r.card !== null).length, n: activeList.length }; },
    /** checks: forget the cached walk fields (after a CONFIG.world change). */
    debugResetFields() { modelData.clear(); },
    /** checks: bake layout of the page print (book.js debugBake). */
    get debugBake() { return book.debugBake; },
    /** checks: the DRAWN world matrix of instance i of a live record (fold pose + the gold-pass card / house fix). */
    drawnMatrix(rec, i, out) {
      _m.copy(rec.meshes[i].matrixWorld);
      if (rec.card !== null && rec.card[i] !== null) cardFix(rec, i);
      return out.copy(_m);
    },
    /** A point [x, y, z] of a tile model in authored tile space (rot 0), moved to where it is DRAWN (houses grow about their pivot). In place. */
    standPoint(model, p) {
      const md = dataFor(model);
      if (md.pivots === null || md.pivots.length === 0 || md.houseS === 1) return p;
      let best = md.pivots[0]; let bd = 1e9;
      for (let i = 0; i < md.pivots.length; i++) { const d = hypot2(md.pivots[i].x - p[0], md.pivots[i].z - p[2]); if (d < bd) { bd = d; best = md.pivots[i]; } }
      p[0] = best.x + (p[0] - best.x) * md.houseS; p[1] *= md.houseS; p[2] = best.z + (p[2] - best.z) * md.houseS;
      return p;
    },
    /** scraps: the stand spec of a prototype's meshes (cardSpecs) and its tile-space correction premultiplied onto `out` (false = untouched). */
    standSpecs(model, root, meshes) { return W.cards && W.cards.enabled !== false ? cardSpecs(model, root, meshes) : null; },
    standFix(sp, i, parity, out) { if (!staticFix(sp, i, parity)) return false; out.premultiply(_cm); return true; },
    /**
     * round 3 (camera sight assist): does a LARGE drawn piece (house wall / roof, tower, stall, dune ... - everything that
     * make-room cannot tip aside) stand on the segment from (ox, oy, oz) along the unit direction (dx, dy, dz) up to `far`?
     * Tested against each piece's box in its own flap space (thin slabs), as drawn. Allocation-free; a few dozen boxes.
     */
    sightBlocked(ox, oy, oz, dx, dy, dz, far) {
      const tTop = dy > 1e-4 ? Math.min(far, (3.2 - oy) / dy) : far; // nothing stands taller than this
      if (!(tTop > 0)) return false;
      const ex = ox + dx * tTop; const ez = oz + dz * tTop;
      const sl = hypot2(ex - ox, ez - oz) || 1e-6;
      for (let n = 0; n < activeList.length; n++) {
        const rec = activeList[n];
        if (!rec.shown || rec.fold.target !== 1 || rec.fold.progress < 0.55) continue;
        const cxw = rec.cx * TILE_SIZE - ox; const czw = rec.cz * TILE_SIZE - oz;
        let u = (cxw * (ex - ox) + czw * (ez - oz)) / (sl * sl); if (u < 0) u = 0; else if (u > 1) u = 1;
        if (hypot2(cxw - (ex - ox) * u, czw - (ez - oz) * u) > HALF * 1.5 + 0.35) continue;
        const ms = rec.meshes; const hide = rec.hide;
        for (let i = 0; i < ms.length; i++) {
          if (hide !== null && hide[i]) continue;
          if (rec.card !== null && rec.card[i] !== null && rec.cardJ[i] <= 150) continue; // trees / bushes / props: make-room tips them
          const g = ms[i].geometry; if (!g) continue;
          if (g.boundingBox === null) g.computeBoundingBox();
          const bb = g.boundingBox;
          _m.copy(ms[i].matrixWorld);
          if (rec.card !== null && rec.card[i] !== null) cardFix(rec, i);
          const me = _m.elements;
          // world-space top of the box: flat prints and low pieces (kerbs, rails under the knee) never hide him
          _sv.set(ox, oy, oz).applyMatrix4(_si.copy(_m).invert());
          _sd.set(dx, dy, dz).transformDirection(_si); // unit in local space (uniform scale)
          const sc = Math.hypot(me[0], me[1], me[2]) || 1;
          let t0 = 0.08 / sc; let t1 = tTop / sc; let ok = true;
          for (let a = 0; a < 3 && ok; a++) {
            const o = a === 0 ? _sv.x : a === 1 ? _sv.y : _sv.z; const d = a === 0 ? _sd.x : a === 1 ? _sd.y : _sd.z;
            const lo = (a === 0 ? bb.min.x : a === 1 ? bb.min.y : bb.min.z) - 0.004; const hi = (a === 0 ? bb.max.x : a === 1 ? bb.max.y : bb.max.z) + 0.004;
            if (Math.abs(d) < 1e-7) { if (o < lo || o > hi) ok = false; continue; }
            let ta = (lo - o) / d; let tb = (hi - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
            if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
          }
          if (!ok) continue;
          // where the ray meets the box it must be above knee height over the page (the base print is a flat box at y = 0)
          if (oy + dy * t0 * sc < 0.12 && oy + dy * t1 * sc < 0.12) continue;
          sight.last = ms[i].name || (ms[i].parent && ms[i].parent.name) || rec.model; sight.lastModel = rec.model;
          return true;
        }
      }
      return false;
    },
    get viewReach() { return reach; },
    faceCamera() {
      syncView();
      makeRoom(0, true);
      for (let i = 0; i < activeList.length; i++) { const rec = activeList[i]; if (rec.shown && rec.dirty) writeMatrices(rec); }
    },
    /** Force-spawn everything in range now and snap every fold to its target (deterministic stills). */
    settle() {
      if (!last.valid) return;
      last.fresh = true;
      book.follow(last);
      stream(0, Infinity, true);
      for (let i = activeList.length - 1; i >= 0; i--) {
        const rec = activeList[i];
        rec.fold.snap(rec.fold.target);
        if (rec.shown) {
          if (rec.fold.target === 0) setShown(rec, false);
          else {
            if (WIND_ON && rec.spins) rec.fold.applyWind(state.time, -1, 0.6 + 0.4 * rec.wind, rec.cy, rec.sy);
            writeMatrices(rec); book.setTwin(rec.cx, rec.cz, twinFor(1));
          }
        }
      }
      book.settle();
    },
    /** Can the traveller stand at world (x,z)? Rivers/ponds block unless on a bridge; trees/houses block softly. */
    isWalkable(x, z) {
      return clearanceAt(x, z) > 0;
    },
    /** Signed room around world (x,z): <= 0 blocked (water, wall, solid prop), >= CONFIG.player.radius fully free. */
    clearance: clearanceAt,
    /** Debug: [mesh name, top, 'T' tall | 'L' low | '-' walk-through] of a model (CONFIG.world.debugPieces !== false). */
    debugPieces(model) { return dataFor(model).pieces || []; },
    /** Ground height (world Y) under (x,z): 0 on the page, raised on a bridge deck, slightly below 0 in the gutter. */
    heightAt(x, z) {
      const cx = Math.round(x / TILE_SIZE); const cz = Math.round(z / TILE_SIZE);
      const cell = cellAt(cx, cz);
      let h = book.gutterDip(x, z);
      const md = dataFor(cell.model);
      if (md.deck !== null) {
        let u = x - cx * TILE_SIZE; let v = z - cz * TILE_SIZE;
        const rot = ((cell.rot % 4) + 4) % 4;
        for (let i = 0; i < rot; i++) { const t = u; u = v; v = -t; }
        const au = Math.abs(u);
        if (au < W.deckHalfWidth + 0.12) {
          const f = (v + HALF) / SDF_STEP;
          let k = Math.floor(f);
          if (k < 0) k = 0; else if (k > SDF_N - 2) k = SDF_N - 2;
          const a = Math.min(1, Math.max(0, f - k));
          let side = 1 - (au - W.deckHalfWidth) / 0.12;
          if (side > 1) side = 1;
          h += (md.deck[k] * (1 - a) + md.deck[k + 1] * a) * side * side * (3 - 2 * side);
        }
      }
      return h;
    },
    /** 'grass' | 'path' | 'bridge' | 'water' at world (x,z). */
    surfaceAt(x, z) { return SURFACES[classify(x, z)]; },
    /** WFC cell record for a cell coordinate. */
    tileAt(cx, cz) { return cellAt(cx, cz); },
    /** Biome id ('heartland' | 'desert' | 'snow' | 'blossom' | 'pinewood') at WORLD position (x, z). Pure, allocation-free. */
    biomeAt(x, z) { return biomeIdAt(wfc.seed, Math.round(x / TILE_SIZE), Math.round(z / TILE_SIZE)); },
    /** Live tile instances: [{key,cx,cz,cell,group,fold,shown}] (a copy of the list). */
    activeTiles() { return activeList.slice(); },
    stats() {
      let shown = 0; let instances = 0;
      for (let i = 0; i < activeList.length; i++) if (activeList[i].shown) shown++;
      for (let i = 0; i < batchList.length; i++) instances += batchList[i].instances;
      return { active: activeList.length, pooled: pooledCount, moving: movingCount, collapsed: wfc.size ?? 0, shown, created, batches: batchList.length, instances };
    },
    dispose() {
      scene.remove(group);
      for (const b of batchList) { b.mesh.dispose(); }
      book.dispose();
    },
  };
  sight.world = api;
  return api;
}
