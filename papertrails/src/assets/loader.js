// Loads the runtime glTF models and texture manifest:
//   ./models/tiles.glb      tile models with hinged paper flaps
//   ./models/traveller.glb  the paper traveller (body/head/legs/arms/lantern, clip 'walk')
//   ./textures/manifest.json
// Never throws: anything missing falls back to the procedural PLACEHOLDER tiles / traveller below, which use
// the same hinge convention (source = 'placeholder' | 'mixed' | 'gltf').
// All cardstock uses ONE material, materials.paper({ color: '#ffffff' }), coloured by vertex colours (COLOR_0);
// window panes / lantern glass use ONE emissive material.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, TILE_SIZE, PATH_WIDTH, RIVER_WIDTH, FLAP_LAYER_GAP } from '../core/config.js';
import { MODELS, MODEL_IDS, FALLBACK_MODEL } from '../core/models.js';

const P = CONFIG.palette;

// ---- flat printed base -----------------------------------------------------------------------
function baseTexture(id) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = P.sage;
  g.fillRect(0, 0, N, N);
  const s = MODELS[id].sockets;
  const u = N / TILE_SIZE; // pixels per world unit. Canvas: +x = east, top = north.
  const strip = (dir, width, color) => {
    const w = width * u;
    g.fillStyle = color;
    const m = N / 2;
    if (dir === 'n') g.fillRect(m - w / 2, 0, w, m + w / 2);
    if (dir === 's') g.fillRect(m - w / 2, m - w / 2, w, m + w / 2);
    if (dir === 'e') g.fillRect(m - w / 2, m - w / 2, m + w / 2, w);
    if (dir === 'w') g.fillRect(0, m - w / 2, m + w / 2, w);
  };
  for (const d of ['n', 'e', 's', 'w']) if (s[d] === 'river') strip(d, RIVER_WIDTH, P.teal);
  for (const d of ['n', 'e', 's', 'w']) if (s[d] === 'path') strip(d, PATH_WIDTH, P.kraft);
  if (id === 'pond') {
    g.fillStyle = P.teal;
    g.beginPath();
    g.arc(N / 2, N / 2, 0.6 * u, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(74,52,38,0.18)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, N - 1, N - 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---- upright cut-paper flaps -----------------------------------------------------------------
function shapeFor(kind, w, h) {
  const s = new THREE.Shape();
  const a = w / 2;
  if (kind === 'tri') {
    s.moveTo(-a, 0); s.lineTo(a, 0); s.lineTo(0, h); s.closePath();
  } else if (kind === 'tree') {
    const t = w * 0.12;
    const th = h * 0.22;
    s.moveTo(-t, 0); s.lineTo(t, 0); s.lineTo(t, th); s.lineTo(a, th); s.lineTo(0, h); s.lineTo(-a, th); s.lineTo(-t, th); s.closePath();
  } else if (kind === 'arch') {
    s.moveTo(-a, 0); s.lineTo(a, 0);
    s.absellipse(0, 0, a, h, 0, Math.PI, false);
    s.closePath();
  } else if (kind === 'house') {
    s.moveTo(-a, 0); s.lineTo(a, 0); s.lineTo(a, h * 0.6); s.lineTo(0, h); s.lineTo(-a, h * 0.6); s.closePath();
  } else {
    s.moveTo(-a, 0); s.lineTo(a, 0); s.lineTo(a, h); s.lineTo(-a, h); s.closePath();
  }
  return s;
}

const geoCache = new Map();
function flapGeometry(kind, w, h) {
  const key = kind + '|' + w + '|' + h;
  let geo = geoCache.get(key);
  if (!geo) { geo = new THREE.ShapeGeometry(shapeFor(kind, w, h), 10); geoCache.set(key, geo); }
  return geo;
}

// [kind, w, h, x, z, ryDeg, color, foldSign]
const tuft = (x, z) => ['tri', 0.28, 0.2, x, z, 0, P.olive, 1];
const tree = (x, z, h = 1, c = P.moss) => ['tree', h * 0.62, h, x, z, 0, c, 1];
const RECIPES = {
  meadow: [tuft(-0.5, -0.3), tuft(0.45, 0.4)],
  meadow_flowers: [tuft(-0.55, 0.2), ['tri', 0.16, 0.26, 0.1, -0.4, 0, P.mustard, 1], ['tri', 0.16, 0.22, 0.5, 0.35, 0, P.terracotta, 1]],
  hills: [['arch', 1.7, 0.75, 0, -0.45, 0, P.olive, 1], ['arch', 1.25, 0.5, -0.2, 0, 0, P.sage, 1], ['arch', 0.8, 0.32, 0.35, 0.45, 0, P.moss, 1]],
  forest: [tree(-0.55, -0.6, 1.15), tree(0.45, -0.5, 1.0, P.olive), tree(-0.1, -0.1, 0.95), tree(-0.6, 0.35, 0.8, P.olive), tree(0.55, 0.3, 0.9)],
  grove: [tree(-0.4, -0.3, 1.0), tree(0.45, 0.2, 0.8, P.olive)],
  rocks: [['arch', 0.7, 0.4, -0.2, -0.1, 0, P.paperShade, 1], ['arch', 0.45, 0.26, 0.35, 0.3, 0, P.kraft, 1]],
  pond: [tuft(-0.75, -0.6), ['rect', 0.06, 0.4, 0.7, -0.5, 0, P.olive, 1], ['rect', 0.06, 0.32, 0.8, -0.42, 0, P.moss, 1]],
  windmill: [['rect', 0.42, 1.2, 0, -0.2, 0, P.paper, 1], ['tri', 1.0, 0.5, 0, -0.18, 0, P.terracotta, 1], tuft(0.6, 0.5)],
  path_straight: [tuft(0.65, -0.5), tuft(-0.6, 0.45)],
  path_corner: [tuft(-0.6, 0.55), tree(-0.6, -0.55, 0.7, P.olive)],
  path_t: [tuft(-0.6, -0.6), tuft(0.6, -0.6)],
  path_cross: [tuft(-0.7, -0.7), tuft(0.7, 0.7)],
  path_end: [['rect', 0.07, 0.55, 0, -0.1, 0, P.ink, 1], ['rect', 0.42, 0.16, 0, -0.08, 0, P.kraft, 1], tuft(0.6, -0.5)],
  lantern_post: [['rect', 0.06, 0.95, 0.5, 0, 0, P.ink, 1], ['rect', 0.2, 0.24, 0.5, 0.02, 0, P.lantern, 1], tuft(-0.65, 0.4)],
  house: [['house', 0.9, 0.95, 0, -0.45, 0, P.paper, 1], ['tri', 1.1, 0.5, 0, -0.42, 0, P.terracotta, 1], tree(0.7, -0.1, 0.7, P.olive)],
  village: [['house', 0.6, 0.8, -0.62, -0.3, 0, P.paper, 1], ['house', 0.6, 0.9, 0.62, 0.1, 0, P.paperShade, 1], ['tri', 0.72, 0.4, -0.62, -0.28, 0, P.terracotta, 1], ['tri', 0.72, 0.42, 0.62, 0.12, 0, P.rust, 1]],
  river_straight: [['rect', 0.06, 0.36, 0.6, -0.4, 0, P.olive, 1], tuft(-0.65, 0.5)],
  river_corner: [tuft(-0.6, 0.6), ['rect', 0.06, 0.36, -0.55, -0.2, 0, P.olive, 1]],
  river_source: [['arch', 0.9, 0.5, 0, -0.25, 0, P.paperShade, 1], ['arch', 0.5, 0.3, 0.3, -0.1, 0, P.kraft, 1]],
  bridge: [['arch', 1.3, 0.34, -0.3, 0, 90, P.kraft, 1], ['arch', 1.3, 0.34, 0.3, 0, 90, P.kraft, -1]],
};

function buildPlaceholderTile(id, materials) {
  const group = new THREE.Group();
  group.name = id;
  group.userData.model = id;

  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE).rotateX(-Math.PI / 2),
    materials.paper({ color: '#ffffff', map: baseTexture(id), side: THREE.FrontSide }),
  );
  base.name = 'base';
  base.receiveShadow = true;
  group.add(base);

  const recipe = RECIPES[id] || RECIPES[FALLBACK_MODEL];
  recipe.forEach(([kind, w, h, x, z, ry, color, sign], i) => {
    const flap = new THREE.Group();
    flap.name = 'flap_' + i;
    flap.position.set(x, FLAP_LAYER_GAP * (i + 1), z);
    flap.rotation.y = THREE.MathUtils.degToRad(ry);
    flap.userData = {
      hinge: true,
      foldAngle: sign * Math.PI / 2,
      delay: recipe.length > 1 ? i / (recipe.length - 1) : 0,
      layer: i,
      size: Math.min(1, h / TILE_SIZE),
    };
    const mesh = new THREE.Mesh(flapGeometry(kind, w, h), materials.paper({ color, side: THREE.DoubleSide }));
    mesh.name = 'flap_' + i + '_mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    flap.add(mesh);
    group.add(flap);
  });
  return group;
}

function buildPlaceholderTraveller(materials) {
  const H = CONFIG.TRAVELLER_HEIGHT;
  const root = new THREE.Group();
  root.name = 'traveller';
  const cloak = new THREE.Shape();
  cloak.moveTo(-0.15, 0); cloak.lineTo(0.15, 0); cloak.lineTo(0.08, H * 0.68); cloak.lineTo(-0.08, H * 0.68); cloak.closePath();
  const bodyMat = materials.paper({ color: P.terracotta, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ShapeGeometry(cloak), bodyMat);
  body.name = 'body';
  const side = body.clone();
  side.name = 'body_side';
  side.rotation.y = Math.PI / 2;
  side.scale.x = 0.7;
  const head = new THREE.Mesh(new THREE.CircleGeometry(H * 0.17, 20), materials.paper({ color: P.paper, side: THREE.DoubleSide }));
  head.name = 'head';
  head.position.y = H * 0.8;
  const hat = new THREE.Mesh(flapGeometry('tri', 0.3, 0.16), materials.paper({ color: P.ink, side: THREE.DoubleSide }));
  hat.name = 'hat';
  hat.position.set(0, H * 0.9, 0.002);
  const lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.07),
    new THREE.MeshStandardMaterial({ color: P.lantern, emissive: P.lantern, emissiveIntensity: 2, roughness: 1 }),
  );
  lantern.name = 'lantern';
  lantern.position.set(0.2, H * 0.42, 0.06);
  for (const m of [body, side, head, hat, lantern]) { m.castShadow = true; root.add(m); }
  lantern.castShadow = false;
  root.animations = [];
  return root;
}

// ---- glTF -> prototypes ----------------------------------------------------------------------------
const warnings = [];
function warn(...a) { warnings.push(a.join(' ')); console.warn('[assets]', ...a); }

async function loadGLTF(url) {
  try {
    return await new GLTFLoader().loadAsync(url);
  } catch (err) {
    warn('could not load', url, '-', err && err.message ? err.message : String(err));
    return null;
  }
}

/** Blender object names are globally unique, so they carry a '<model>__' prefix: strip it. */
function stripName(name, prefix) {
  let n = String(name || '');
  if (n.startsWith(prefix)) n = n.slice(prefix.length);
  return n;
}

function renameClips(clips, prefix) {
  return (clips || []).map((c) => {
    const clip = c.clone();
    for (const t of clip.tracks) {
      const i = t.name.indexOf(prefix);
      if (i >= 0) t.name = t.name.slice(0, i) + t.name.slice(i + prefix.length);
    }
    return clip;
  });
}

/**
 * Turn one exported top-level node into a prototype: strip name prefixes, swap in the shared materials,
 * normalise the hinge userData, set shadow flags. Returns { hinges, triangles, meshes }.
 */
function adopt(root, prefix, mats, opts = {}) {
  const stats = { hinges: 0, triangles: 0, meshes: 0, bad: 0 };
  root.traverse((o) => {
    o.name = stripName(o.name, prefix);
    const ud = o.userData || (o.userData = {});
    if (ud.hinge) {
      ud.hinge = true;
      ud.foldAngle = Number(ud.foldAngle);
      ud.delay = Math.min(1, Math.max(0, Number(ud.delay) || 0));
      ud.layer = Math.max(0, Math.round(Number(ud.layer) || 0));
      if (!Number.isFinite(ud.foldAngle)) { ud.foldAngle = Math.PI / 2; stats.bad++; }
      stats.hinges++;
    }
    if (o.isMesh) {
      const glow = o.material && /glow/i.test(o.material.name || '');
      if (o.material && o.material.dispose) o.material.dispose();
      o.material = glow ? mats.glow : mats.paper;
      const isBase = !glow && (o.name === 'base' || (o.parent && o.parent.name === 'base'));
      o.castShadow = !glow && !isBase && opts.castShadow !== false;
      o.receiveShadow = !glow;
      if (glow) o.userData.glow = true;
      const g = o.geometry;
      if (g) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        stats.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
      stats.meshes++;
    }
  });
  return stats;
}

async function loadTexture(url, { srgb = false, repeat = true, flipY = true, anisotropy = 4 } = {}) {
  try {
    const t = await new THREE.TextureLoader().loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.flipY = flipY;
    t.anisotropy = anisotropy;
    return t;
  } catch (err) {
    return null;
  }
}

async function fetchJSON(url) {
  try {
    if (typeof fetch !== 'function') return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

/** Paper, page and print maps from the runtime texture manifest (tolerates absence). */
async function loadTextures(A, anisotropy) {
  const out = { paper: null, paperNormal: null, paperRough: null, manifest: null };
  const jobs = [];
  const manifest = await fetchJSON(A.manifestUrl);
  if (manifest && typeof manifest === 'object') {
    out.manifest = manifest;
    for (const key of Object.keys(manifest)) {
      const e = manifest[key];
      if (!e || typeof e !== 'object' || !e.file) continue;
      const wrap = String(e.wrap || 'repeat');
      jobs.push(loadTexture(A.texturesBase + e.file, { srgb: e.colorSpace === 'srgb', repeat: wrap.indexOf('repeat') >= 0, flipY: e.flipY !== false, anisotropy })
        .then((t) => {
          if (!t) { warn('texture missing:', e.file); return; }
          if (wrap === 'repeat,clamp') { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
          t.userData = { key, repeat: e.repeat || 1, type: e.type || '', manifest: e };
          // glTF TEXCOORD_1 addresses the art atlas top-down, so the manifest says flipY:false.
          if (e.type === 'art-atlas') { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
          out[key] = t;
        }));
    }
  }
  await Promise.all(jobs);
  // aliases other modules look for
  if (out.paper && !out.card) out.card = out.paper;
  if (out.paperNormal && !out.cardNormal) out.cardNormal = out.paperNormal;
  return out;
}

/**
 * @returns {Promise<{getTilePrototype:(modelId:string)=>THREE.Group, traveller:THREE.Group,
 *   textures:Record<string,any>, modelIds:string[], source:'placeholder'|'gltf'|'mixed',
 *   meta:object|null, warnings:string[], stats:object}>}
 */
export async function loadAssets({ materials, renderer, quality } = {}) {
  const A = CONFIG.assets;
  const caps = renderer && renderer.capabilities;
  const anisotropy = Math.min(8, (caps && caps.getMaxAnisotropy && caps.getMaxAnisotropy()) || 4);
  const mats = {
    paper: materials.paper({ color: '#ffffff', side: THREE.DoubleSide }),
    glow: materials.paper({ color: '#ffffff', side: THREE.DoubleSide, emissive: A.glowColor, emissiveIntensity: A.glowIntensity, fibre: 'none', vary: false }),
  };
  // The tiles are drawn through a BatchedMesh, the traveller as plain meshes: separate material instances
  // (same look) so three does not re-derive the program parameters on every batch <-> mesh switch.
  const travMats = {
    paper: materials.paper({ color: '#ffffff', side: THREE.DoubleSide, variant: 'traveller' }),
    glow: materials.paper({ color: '#ffffff', side: THREE.DoubleSide, emissive: A.glowColor, emissiveIntensity: A.glowIntensity, fibre: 'none', vary: false, variant: 'traveller' }),
  };
  const noTex = () => ({ paper: null, paperNormal: null, paperRough: null, manifest: null });

  const [tilesGltf, travGltf, textures, meta] = await Promise.all([
    loadGLTF(A.tilesUrl), loadGLTF(A.travellerUrl), loadTextures(A, anisotropy).catch(noTex), fetchJSON(A.metaUrl),
  ]);

  const protos = new Map();
  const stats = { tiles: {}, traveller: null };
  let fromGltf = 0;
  if (tilesGltf && tilesGltf.scene) {
    const byName = new Map();
    for (const c of [...tilesGltf.scene.children]) byName.set(c.name, c);
    for (const id of MODEL_IDS) {
      const node = byName.get(id);
      if (!node) continue;
      try {
        node.removeFromParent();
        node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.set(1, 1, 1);
        const st = adopt(node, id + '__', mats);
        const base = node.getObjectByName('base');
        if (!base || st.hinges === 0) { warn('tile', id, 'has no base / flaps in tiles.glb - using placeholder'); continue; }
        node.name = id;
        node.userData.model = id;
        node.updateMatrixWorld(true);
        protos.set(id, node);
        stats.tiles[id] = st;
        fromGltf++;
      } catch (err) {
        warn('tile', id, 'failed:', err && err.message);
      }
    }
  }
  for (const id of MODEL_IDS) {
    if (!protos.has(id)) {
      if (tilesGltf) warn('tile', id, 'missing in tiles.glb - placeholder');
      protos.set(id, buildPlaceholderTile(id, materials));
    }
  }

  let traveller = null;
  if (travGltf && travGltf.scene) {
    try {
      const node = travGltf.scene.getObjectByName('traveller') || travGltf.scene.children[0];
      node.removeFromParent();
      node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.set(1, 1, 1);
      stats.traveller = adopt(node, 'traveller__', travMats);
      node.name = 'traveller';
      node.animations = renameClips(travGltf.animations, 'traveller__');
      const s = CONFIG.TRAVELLER_HEIGHT / (node.userData.height || CONFIG.TRAVELLER_HEIGHT);
      if (Math.abs(s - 1) > 1e-3) node.scale.setScalar(s);
      const tab = node.getObjectByName('base_tab');
      if (tab && A.travellerBaseTab === false) tab.visible = false;
      traveller = node;
    } catch (err) {
      warn('traveller failed:', err && err.message);
      traveller = null;
    }
  }
  const travFromGltf = !!traveller;
  if (!traveller) traveller = buildPlaceholderTraveller(materials);

  const n = MODEL_IDS.length;
  const source = fromGltf === n && travFromGltf ? 'gltf' : (fromGltf === 0 && !travFromGltf ? 'placeholder' : 'mixed');
  const warned = new Set();
  return {
    /** Shared prototype (do NOT mutate or add to the scene): use getTilePrototype(id).clone(true). */
    getTilePrototype(modelId) {
      const p = protos.get(modelId);
      if (p) return p;
      if (!warned.has(modelId)) { warned.add(modelId); console.warn('[assets] unknown tile model', modelId); }
      return protos.get(FALLBACK_MODEL);
    },
    traveller,
    textures,
    modelIds: [...MODEL_IDS],
    source,
    /** public/models/assets_meta.json (per-tile numbers, bridge deck profile, lantern post position) or null. */
    meta,
    materials: mats,
    warnings,
    stats,
  };
}
