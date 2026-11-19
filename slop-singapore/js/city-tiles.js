import * as THREE from 'three/webgpu';
import { Fn, uv, float, vec2, vec3, vec4, color, mix, step, fract, floor, sin, dot, smoothstep, attribute, texture, instanceIndex, positionGeometry, positionWorld, positionView, specularColor, specularColorBlended, specularF90 } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { buildTileArrays, createLandMask, islandGround } from './city-tiles-build.js';
import { decodePNG } from './png-decode.js';

// js/city-tiles.js
// The rest of the island beyond the detailed city: its land, and its buildings and main roads streamed in tiles around
// the camera (tools/city/tiles.mjs writes tiles/<city>/index.json and a JSON file per tile). Kept cheap: one merged
// mesh of walls, one of roofs and one of roads per tile, sharing three materials across all tiles (the walls' windows
// drawn by their shader, lit at night), its buildings' collision boxes for the player (onTileColliders), no traffic or
// street furniture. A tile is fetched and built in a
// worker (js/city-tiles-worker.js, js/city-tiles-build.js) when the camera comes within `radius` of it (further when
// flying high), handed over as typed arrays, and dropped once well out of range.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nightNode = () => smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
const hash1 = Fn(([x]) => fract(sin(x.mul(12.9898)).mul(43758.5453)));

// Walls: the building's colour, windows in rows of storeys (3 m) and bays (2.4 m); at night a share of them lit
function wallMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0.05 });
  const p = uv();
  const tint = attribute('color', 'vec3');
  const storey = floor(p.y.div(3.0));
  const fy = fract(p.y.div(3.0));
  const fx = fract(p.x.div(2.4));
  const pane = step(0.32, fy).mul(step(fy, 0.82)).mul(step(0.18, fx)).mul(step(fx, 0.82)).mul(step(2.2, p.y));
  const glass = vec3(0.16, 0.2, 0.24);
  // the windows fade into the wall's average tone with distance (no shimmering moiré across an estate)
  const near = smoothstep(1600, 350, positionView.z.negate());
  m.colorNode = mix(mix(tint, glass, 0.22), mix(tint, glass, pane.mul(0.8)), near);
  m.roughnessNode = mix(float(0.85), float(0.2), pane);
  const room = hash1(storey.mul(31.7).add(floor(p.x.div(2.4))));
  m.emissiveNode = vec3(1.0, 0.82, 0.58).mul(pane.mul(step(0.6, room)).mul(room.mul(0.7).add(0.15))).mul(nightNode());
  return m;
}
function roofMaterial() {
  return new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.05, vertexColors: true });
}
function roadMaterial() {
  return new THREE.MeshStandardNodeMaterial({ color: 0x3b3d41, roughness: 0.92, metalness: 0.02 });
}
// Value noise in 0..1 over a unit lattice
const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const a = hash2(i), b = hash2(i.add(vec2(1, 0))), c = hash2(i.add(vec2(0, 1))), d = hash2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// The island's ground, by what it is (tools/city/landuse.mjs's image `lu` over it: the share of each pixel under trees,
// grass, paving and sand): woods as dark mottled canopy, parks and playing fields as the city's lawns, industry and car
// parks as concrete, beaches as sand, and the rest (estates, verges, schools...) a mix of grass and paving in patches of
// a couple of hundred metres. In the city's colours (its lawns, asphalt and pavements), so the island carries on from
// it. Without the image, all of it the mix.
function landMaterial(lu = null, tex = null) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld.xz;
  const big = vnoise(p.mul(1 / 190));
  const mid = vnoise(p.mul(1 / 47).add(13.1));
  const fine = vnoise(p.mul(1 / 11).add(71.7));
  // (sampled a few metres off where it is, in noise, so the 20 m pixels' edges wander like a park's)
  const share = lu && tex
    ? texture(tex, vec2(
      p.x.add(mid.sub(0.5).mul(18)).sub(lu.x0).div(lu.w * lu.res),
      p.y.add(fine.sub(0.5).mul(18)).sub(lu.z0).div(lu.h * lu.res)
    ))
    : vec4(0);
  const urban = mix(mix(color(0x30422a), color(0x46583a), fine), mix(color(0x4c4d48), color(0x5e5d57), fine), smoothstep(0.52, 0.8, big.mul(0.7).add(mid.mul(0.3))).mul(0.85));
  const grass = mix(color(0x2a5424), color(0x47772f), mid.mul(0.55).add(fine.mul(0.45)));
  const wood = mix(color(0x142e15), color(0x2a4a1f), smoothstep(0.3, 0.8, fine.mul(0.65).add(mid.mul(0.35))));
  const paved = mix(color(0x55554f), color(0x75736b), mid.mul(0.5).add(fine.mul(0.5)));
  const sand = mix(color(0xcdbb92), color(0xe2d4b0), mid.mul(0.6).add(fine.mul(0.4)));
  const rest = float(1).sub(share.r).sub(share.g).sub(share.b).sub(share.a).max(0);
  m.colorNode = urban.mul(rest).add(wood.mul(share.r)).add(grass.mul(share.g)).add(paved.mul(share.b)).add(sand.mul(share.a));
  m.roughnessNode = float(1).sub(share.b.mul(0.12)).sub(share.a.mul(0.05));
  // grass and leaves don't mirror the sky at a grazing angle (as the city's lawns, js/tsl-materials.js)
  m.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };
  return m;
}

// tools/city/landuse.mjs's image as a texture of raw values (not colours): its rows from z0 down, filtered linearly so
// the shares blend from pixel to pixel. Empty (all the land's own mix) until its pixels arrive (setLanduse).
function landuseTexture(lu) {
  const tex = new THREE.DataTexture(new Uint8Array(lu.w * lu.h * 4), lu.w, lu.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------------
// The island's trees (js/city-tiles-build.js scatterTrees: one instance matrix each, a unit tree scaled to its height
// and crown, in 500 m squares, chunkTrees): a rounded crown on a trunk, one instanced mesh per square, drawn only within
// TREE_RANGE of the camera (beyond, the ground's canopy shading carries the woods). Each square by its distance (to its
// nearest point), by the tree-detail setting (TREE_DETAIL): ~90 triangles a tree within `near`, ~26 within `mid`, then
// a crown of 8, fewer of them drawn from `thin` on, down to `keep` of them by `range` (the first n of a square's trees,
// which are in a random order), none beyond. Worst case at medium, low over Pulau Ubin's woods: ~2M triangles in range
// all round, about a third of them in view.
// ---------------------------------------------------------------------------------------------------------------------
const TREE_DETAIL = {
  off: { range: 0, near: 0, mid: 0, thin: 0, keep: 0 },
  low: { range: 1300, near: 120, mid: 500, thin: 600, keep: 0.35 },
  medium: { range: 2300, near: 300, mid: 1000, thin: 1300, keep: 0.45 },
  high: { range: 3400, near: 500, mid: 1600, thin: 2200, keep: 0.6 }
};
const TREE_RANGE = TREE_DETAIL.medium.range; // m

/** How a square of trees `d` m away (over the ground, with the camera's height) is drawn at a detail `p`: { lod 0-2, share 0-1 } */
function treeLod(d, p = TREE_DETAIL.medium) {
  if (typeof p === 'number') p = { ...TREE_DETAIL.medium, range: p };
  if (!(d < p.range)) return { lod: -1, share: 0 };
  const lod = d < p.near ? 0 : d < p.mid ? 1 : 2;
  const share = d <= p.thin ? 1 : 1 - (1 - p.keep) * Math.min(1, (d - p.thin) / Math.max(1, p.range - p.thin));
  return { lod, share };
}

// A unit tree 1 m tall and 1 m across: its crown (an icosphere, its normals pointing out from the crown's centre for soft
// light) from 0.38 to 1, on a trunk up to 0.5; `crown` 1 on the crown's vertices, 0 on the trunk's
function treeGeometry(detail = 1) {
  // the far crown an octahedron with no trunk
  const crown = detail < 0 ? new THREE.OctahedronGeometry(0.5, 0) : new THREE.IcosahedronGeometry(0.5, detail); // (not indexed)
  const cp = crown.attributes.position;
  const pos = [], nrm = [], isCrown = [];
  for (let k = 0; k < cp.count; k++) {
    const x = cp.getX(k), y = cp.getY(k), z = cp.getZ(k);
    // a little flattened underneath, lumpy round the edge (by direction, so the faces stay joined)
    const lump = 1 + 0.12 * Math.sin(x * 23.1 + z * 17.3) * Math.cos(y * 19.7 - x * 7.1);
    const yy = y < 0 ? y * 0.55 : y * 0.75;
    pos.push(x * lump, 0.69 + yy * lump * 1.24, z * lump);
    const l = Math.hypot(x, y, z) || 1;
    nrm.push(x / l, y / l, z / l);
    isCrown.push(1);
  }
  const trunk = new THREE.CylinderGeometry(0.022, 0.035, 0.52, detail ? 5 : 3, 1, true).translate(0, 0.26, 0).toNonIndexed();
  const tp = trunk.attributes.position, tn = trunk.attributes.normal;
  for (let k = 0; k < (detail < 0 ? 0 : tp.count); k++) {
    pos.push(tp.getX(k), tp.getY(k), tp.getZ(k));
    nrm.push(tn.getX(k), tn.getY(k), tn.getZ(k));
    isCrown.push(0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('crown', new THREE.Float32BufferAttribute(isCrown, 1));
  crown.dispose();
  trunk.dispose();
  return g;
}

// Tropical greens, a different one per tree, darker inside and underneath the crown, clumped by a noise in the world
function treeMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const isCrown = attribute('crown', 'float');
  const tone = hash1(float(instanceIndex).mul(0.6180339));
  const tone2 = hash1(float(instanceIndex).mul(1.3247).add(7.0));
  const leaf = mix(mix(color(0x1d3f19), color(0x335f22), tone), color(0x4a6e26), tone2.mul(tone2).mul(0.5));
  const clump = vnoise(positionWorld.xz.mul(0.45).add(positionWorld.y.mul(0.6)));
  const under = smoothstep(0.35, 0.95, positionGeometry.y); // the crown's underside in its own shade
  const crownColour = leaf.mul(clump.mul(0.45).add(0.7)).mul(under.mul(0.55).add(0.45));
  m.colorNode = mix(color(0x4a3c2c), crownColour, isCrown);
  m.setupSpecular = function () {
    specularColor.assign(vec3(0.02));
    specularColorBlended.assign(vec3(0.02));
    specularF90.assign(0.25);
  };
  return m;
}

// One square of a tile's trees (chunkTrees) as an instanced mesh over its stretch of the tile's matrices
function treeMesh(trees, chunk, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, chunk.count);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(trees.matrices.subarray(chunk.start * 16, (chunk.start + chunk.count) * 16), 16);
  const [x, y, z, r] = chunk.sphere;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
  mesh.receiveShadow = true;
  mesh.visible = false; // (shown from the next frame, if near enough)
  mesh.name = 'IslandTrees';
  return mesh;
}

// A tile's collision boxes ([cx, cz, hx, hz, ux, uz, minY, maxY] relative to its corner at ox, oz) as the player's
// colliders (js/controllers.js: world bounds and the oriented box, as js/open-city-buildings.js's obbCollider)
function tileColliders(boxes, ox, oz) {
  const out = [];
  for (let i = 0; i < boxes.length; i += 8) {
    const cx = ox + boxes[i], cz = oz + boxes[i + 1], hx = boxes[i + 2], hz = boxes[i + 3], ux = boxes[i + 4], uz = boxes[i + 5];
    const ex = Math.abs(ux) * hx + Math.abs(uz) * hz;
    const ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
    out.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: boxes[i + 6], maxY: boxes[i + 7], obb: { cx, cz, hx, hz, cs: ux, sn: -uz } });
  }
  return out;
}

// A built tile (js/city-tiles-build.js) as meshes, positions relative to its corner
function tileMeshes(built, materials) {
  const group = new THREE.Group();
  for (const [part, material] of [[built.walls, materials.walls], [built.roofs, materials.roofs], [built.roads, materials.roads]]) {
    if (!part) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
    if (part.uv) g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    if (part.color) g.setAttribute('color', new THREE.BufferAttribute(part.color, 3));
    const [x, y, z, r] = part.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// The island's land (index.json land: [[outer, ...holes]] flat x, z) as a ground just under the city's own, over a
// sea wall down to the water
function buildLand(land, material, wallMaterial) {
  const group = new THREE.Group();
  group.name = 'IslandLand';
  const toPath = (flat, P) => {
    const path = new P();
    for (let k = 0; k < flat.length; k += 2) (k ? path.lineTo(flat[k], -flat[k + 1]) : path.moveTo(flat[k], -flat[k + 1]));
    path.closePath();
    return path;
  };
  for (const [outer, ...holes] of land) {
    const shape = toPath(outer, THREE.Shape);
    for (const h of holes) shape.holes.push(toPath(h, THREE.Path));
    const top = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2).translate(0, -0.1, 0);
    const mesh = new THREE.Mesh(top, material);
    mesh.receiveShadow = true;
    const side = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, -2.35, 0);
    const wall = new THREE.Mesh(side, wallMaterial);
    group.add(mesh, wall);
  }
  return group;
}

class CityTiles {
  // `url`: the tiles' directory; `radius` (m) of tiles kept around the camera at street level
  constructor(scene, { url, radius = 3500 } = {}) {
    this.scene = scene;
    this.url = url;
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.name = 'CityTiles';
    scene.add(this.group);
    this.materials = { walls: wallMaterial(), roofs: roofMaterial(), roads: roadMaterial(), trees: treeMaterial() };
    this.treeGeometries = [treeGeometry(1), treeGeometry(0), treeGeometry(-1)];
    this.treeDetail = 'medium';
    this.treeLodParams = TREE_DETAIL.medium;
    this.groundAt = null; // (i, j) => buildTileArrays's ground, for the main thread's builds
    this.loaded = new Map(); // key -> { group } | { pending: true }
    this.queue = []; // built tiles waiting to be added, one a frame
    this.inflight = 0;
    this.requests = new Map(); // worker request id -> { key, t }
    this.nextId = 1;
    // the worker fetches & builds; without one (or if it fails to start) the main thread does
    try {
      this.worker = new Worker(new URL('./city-tiles-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => this.received(data);
      this.worker.onerror = (e) => {
        console.warn(`[tiles] worker failed (${e.message || 'error'}): building tiles on the main thread`);
        this.worker = null;
        this.readGroundHere();
        for (const { key } of this.requests.values()) this.loaded.delete(key);
        this.requests.clear();
        this.inflight = 0;
      };
    } catch {
      this.worker = null;
    }
    this.index = null;
    this.stats = { tiles: 0, walls: 0, trees: 0, treesShown: 0, treeTriangles: 0 };
    // called with (key, tile corner x, z, outlines) as each tile is added (the maps draw its buildings), with (key,
    // colliders) as it's added and (key, null) as it's dropped (the player bumps into its buildings)
    this.onTileOutlines = null;
    this.onTileColliders = null;
    this.landMask = null; // the island's land (createLandMask), once the index arrives
    // a stand-in using each material, so the shaders compile behind the loading screen with the rest
    const stand = new THREE.BufferGeometry();
    stand.setAttribute('position', new THREE.Float32BufferAttribute([0, -50, 0, 1, -50, 0, 0, -50, 1], 3));
    stand.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    stand.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    stand.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    for (const [k, mat] of Object.entries(this.materials)) if (k !== 'trees') this.group.add(new THREE.Mesh(stand, mat));
    const standTree = new THREE.InstancedMesh(this.treeGeometries[2], this.materials.trees, 1);
    standTree.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -60, 0));
    this.group.add(standTree);
  }

  async init() {
    try {
      const r = await fetch(`${this.url}index.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.index = await r.json();
    } catch (e) {
      console.warn(`[tiles] no island tiles at ${this.url}: ${e.message}`);
      return false;
    }
    const seawall = new THREE.MeshStandardNodeMaterial({ color: 0x5c5a55, roughness: 0.82, metalness: 0.1 });
    // the ground's land use: read by the worker (which plants the tiles' trees by it) and handed back for the texture
    const lu = this.index.landuse;
    this.landuse = lu ? landuseTexture(lu) : null;
    this.land = buildLand(this.index.land, landMaterial(lu || null, this.landuse), seawall);
    if (lu) {
      const ground = { type: 'ground', url: new URL(`${this.url}${lu.file}`, location.href).href, landuse: { x0: lu.x0, z0: lu.z0, res: lu.res, w: lu.w, h: lu.h }, land: this.index.land, coreRing: this.index.coreRing, tile: this.index.tile };
      this.groundMessage = ground;
      if (this.worker) this.worker.postMessage(ground);
      else this.readGroundHere();
    }
    this.group.add(this.land);
    this.byKey = new Map(this.index.tiles.map((t) => [`${t.i},${t.j}`, t]));
    this.landMask = createLandMask(this.index.land);
    console.info(`[tiles] ${this.index.tiles.length} island tiles of ${this.index.tile} m (${this.index.tiles.reduce((n, t) => n + t.buildings, 0)} buildings)`);
    return true;
  }

  // Which tiles to keep for a camera at (x, y, z): those within the radius (wider with altitude) of it
  wanted(x, y, z) {
    const T = this.index.tile;
    const R = clamp(this.radius + Math.max(0, y) * 12, this.radius, 12000);
    const out = [];
    const i0 = Math.floor((x - R) / T), i1 = Math.floor((x + R) / T);
    const j0 = Math.floor((z - R) / T), j1 = Math.floor((z + R) / T);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const t = this.byKey.get(`${i},${j}`);
        if (!t) continue;
        const d = Math.hypot(clamp(x, i * T, (i + 1) * T) - x, clamp(z, j * T, (j + 1) * T) - z);
        if (d <= R) out.push([d, t]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    return { R, tiles: out.map(([, t]) => t) };
  }

  /** The trees' detail: 'off', 'low', 'medium' or 'high' (TREE_DETAIL); applied from the next frame */
  setTreeDetail(name) {
    if (!TREE_DETAIL[name]) return false;
    this.treeDetail = name;
    this.treeLodParams = TREE_DETAIL[name];
    return true;
  }
  // (how far trees are drawn, m: a detail's own range, or any other with medium's levels)
  get treeRange() {
    return this.treeLodParams.range;
  }
  set treeRange(m) {
    this.treeLodParams = { ...TREE_DETAIL.medium, range: Math.max(0, m) };
  }

  // The land-use image's pixels: into the ground's texture
  setLanduse(pixels) {
    if (!this.landuse || !pixels || pixels.length !== this.landuse.image.data.length) return;
    this.landuse.image.data = pixels;
    this.landuse.needsUpdate = true;
    console.info(`[tiles] land use: ${this.landuse.image.width} × ${this.landuse.image.height} at ${this.index.landuse.res} m`);
  }

  // Without the worker: read the land use here (for the texture, and the trees of the tiles built here from then on)
  async readGroundHere() {
    const g = this.groundMessage;
    if (!g || this.groundAt) return;
    try {
      const r = await fetch(g.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const png = await decodePNG(new Uint8Array(await r.arrayBuffer()));
      this.groundAt = islandGround({ landuse: { ...g.landuse, pixels: png.pixels }, land: g.land, coreRing: g.coreRing, tile: g.tile });
      this.setLanduse(png.pixels.slice());
    } catch (e) {
      console.warn(`[tiles] no land use (${e.message || e}): the island's ground all one mix, and no trees`);
    }
  }

  // A tile back from the worker (or the main-thread fallback)
  received(data) {
    if (data.type === 'ground') {
      if (data.error) console.warn(`[tiles] no land use (${data.error}): the island's ground all one mix, and no trees`);
      else this.setLanduse(data.pixels);
      return;
    }
    let { id, key, t, built, error } = data;
    if (id !== undefined) {
      const request = this.requests.get(id);
      if (!request) return; // (the worker was replaced)
      this.requests.delete(id);
      ({ key, t } = request);
    }
    this.inflight = Math.max(0, this.inflight - 1);
    if (error) {
      console.warn(`[tiles] ${t.file}: ${error}`);
      this.loaded.delete(key);
      return;
    }
    // dropped while it was being built: forget it
    if (!this.loaded.has(key)) return;
    this.queue.push({ key, t, built });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }

  update(camera) {
    if (!this.index) return;
    const { x, y, z } = camera.position;
    const { R, tiles } = this.wanted(x, y, z);
    const T = this.index.tile;
    // fetch & build the nearest missing tiles, a few at a time
    for (const t of tiles) {
      if (this.inflight >= (this.worker ? 3 : 1)) break;
      const key = `${t.i},${t.j}`;
      if (this.loaded.has(key)) continue;
      this.loaded.set(key, { pending: true });
      this.inflight++;
      const url = new URL(`${this.url}${t.file}`, location.href).href;
      if (this.worker) {
        const id = this.nextId++;
        this.requests.set(id, { key, t });
        this.worker.postMessage({ id, url, i: t.i, j: t.j });
      } else {
        fetch(url).then((r) => r.json()).then((data) => this.received({ key, t, built: buildTileArrays(data, this.groundAt ? this.groundAt(t.i, t.j) : null) }))
          .catch((e) => this.received({ key, t, error: e.message }));
      }
    }
    // add at most one built tile a frame (a few typed arrays: cheap)
    const job = this.queue.shift();
    if (job && this.loaded.has(job.key)) {
      const group = tileMeshes(job.built, this.materials);
      group.position.set(job.t.i * T, 0, job.t.j * T);
      group.name = `tile_${job.key}`;
      let trees = null;
      if (job.built.trees && job.built.trees.count) {
        trees = job.built.trees.chunks.map((c) => {
          const mesh = treeMesh(job.built.trees, c, this.treeGeometries[2], this.materials.trees);
          group.add(mesh);
          return { mesh, x0: job.t.i * T + c.sphere[0] - 250, z0: job.t.j * T + c.sphere[2] - 250, total: c.count, drawn: 0, tris: 0 };
        });
        this.stats.trees += job.built.trees.count;
      }
      this.group.add(group);
      this.loaded.set(job.key, { group, trees, walls: job.built.counts.walls });
      this.stats.tiles++;
      this.stats.walls += job.built.counts.walls;
      if (this.onTileOutlines && job.built.outlines) this.onTileOutlines(job.key, job.t.i * T, job.t.j * T, job.built.outlines);
      if (this.onTileColliders && job.built.colliders) this.onTileColliders(job.key, tileColliders(job.built.colliders, job.t.i * T, job.t.j * T));
    }
    // drop the tiles well out of range
    for (const [key, entry] of this.loaded) {
      if (!entry.group) continue;
      const t = this.byKey.get(key);
      const d = Math.hypot(clamp(x, t.i * T, (t.i + 1) * T) - x, clamp(z, t.j * T, (t.j + 1) * T) - z);
      // its trees by each square's distance: how detailed, and how many
      const drop = d > R + T;
      if (entry.trees) {
        for (const sq of entry.trees) {
          const far = drop ? Infinity : Math.hypot(clamp(x, sq.x0, sq.x0 + 500) - x, clamp(z, sq.z0, sq.z0 + 500) - z, y);
          const { lod, share } = treeLod(far, this.treeLodParams);
          const drawn = lod < 0 ? 0 : Math.max(1, Math.round(sq.total * share));
          const geometry = lod < 0 ? sq.mesh.geometry : this.treeGeometries[lod];
          const tris = drawn * (geometry.attributes.position.count / 3);
          this.stats.treesShown += drawn - sq.drawn;
          this.stats.treeTriangles += tris - sq.tris;
          sq.drawn = drawn;
          sq.tris = tris;
          sq.mesh.visible = drawn > 0;
          sq.mesh.count = drawn;
          if (sq.mesh.geometry !== geometry) sq.mesh.geometry = geometry;
        }
      }
      if (drop) {
        this.group.remove(entry.group);
        const treeMeshes = new Set((entry.trees || []).map((sq) => sq.mesh));
        if (entry.trees) {
          this.stats.trees -= entry.trees.reduce((n, sq) => n + sq.total, 0);
          for (const sq of entry.trees) sq.mesh.dispose();
        }
        if (this.onTileColliders) this.onTileColliders(key, null);
        for (const mesh of entry.group.children) if (!treeMeshes.has(mesh)) mesh.geometry.dispose();
        this.loaded.delete(key);
        this.stats.tiles--;
        this.stats.walls -= entry.walls;
      }
    }
  }
}

export { CityTiles, tileMeshes, tileColliders, treeLod, TREE_RANGE, TREE_DETAIL };
