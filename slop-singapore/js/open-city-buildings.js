import * as THREE from 'three/webgpu';
import { createPreWarBuildingMaterial, createCurtainWallMaterial, WALL_KINDS } from './tsl-materials.js';
import { districtAt } from './city-config.js';
import { GEO } from './geodata.js';

// js/open-city-buildings.js
// The real buildings of a city built from OpenStreetMap (GEO.buildings: footprints with courtyards, the heights of
// their tops & bottoms, their types; tools/city/build.mjs), built by main.js instead of buildings.js's generated blocks.
// Kept cheap to build and to draw:
// - every wall is one instanced quad (the outward face of the unit box createFacadeBoxes would place there), so the
//   facade shaders draw its storeys, windows, storefronts & lit rooms exactly as on a box; one instanced mesh per
//   facade for the whole city
// - roofs (and the undersides of parts standing above the ground) are one merged, vertex-tinted mesh
// - colliders: a box turned to the building where it nearly fills one, else a thin one along each wall
// Returns what main.js takes from buildCityBlocks: { group, colliders, allBlocks (footprints for the maps), update }.

// Facades of the city: glass for the towers, painted concrete for the housing blocks, pastel shophouse fronts,
// concrete for the rest, white for the civic buildings (the shaders' styles, see buildings.js for New York's)
const FACADES = [
  [createCurtainWallMaterial, { glassTint: 0x1d4058, frameTint: 0x52606c, windowWidth: 2.7, floorHeight: 3.9, litProbability: 0.6, warmth: 0.5, reflectivity: 0.92, seed: 13.1 }],
  [createCurtainWallMaterial, { glassTint: 0x2a4c68, frameTint: 0xb4c0cb, windowWidth: 2.9, floorHeight: 4.1, litProbability: 0.58, warmth: 0.46, reflectivity: 0.95, seed: 31.7 }],
  [createCurtainWallMaterial, { glassTint: 0x1f2a30, frameTint: 0x39434a, windowWidth: 2.5, floorHeight: 3.8, litProbability: 0.62, warmth: 0.6, reflectivity: 0.88, seed: 52.3 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xe4dfd3, trimColor: 0xa8a198, windowGlassColor: 0x1b2a35, windowWidth: 1.9, floorHeight: 2.9, litProbability: 0.6, warmth: 0.82, seed: 7.9 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xe8c6a2, trimColor: 0xf4ede2, windowGlassColor: 0x1d2a30, windowWidth: 2.0, floorHeight: 3.6, litProbability: 0.52, warmth: 0.88, seed: 19.3 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xc4dcc6, trimColor: 0xf2eee4, windowGlassColor: 0x1d2a30, windowWidth: 2.0, floorHeight: 3.6, litProbability: 0.52, warmth: 0.88, seed: 23.9 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xefdc9f, trimColor: 0xf4ede2, windowGlassColor: 0x1d2a30, windowWidth: 2.0, floorHeight: 3.6, litProbability: 0.52, warmth: 0.88, seed: 29.1 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xb7d0e3, trimColor: 0xf2eee4, windowGlassColor: 0x1d2a30, windowWidth: 2.0, floorHeight: 3.6, litProbability: 0.52, warmth: 0.88, seed: 37.7 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xc9c4ba, trimColor: 0x9a958d, windowGlassColor: 0x19252f, windowWidth: 2.6, floorHeight: 3.8, litProbability: 0.55, warmth: 0.7, seed: 43.3 }],
  [createPreWarBuildingMaterial, { stoneColor: 0xefebe3, trimColor: 0xc9c2b4, windowGlassColor: 0x1a2630, windowWidth: 2.4, floorHeight: 4.5, litProbability: 0.45, warmth: 0.85, seed: 61.1 }]
];
const GLASS = [0, 1, 2];
const HOUSING = 3;
const SHOPHOUSE = [4, 5, 6, 7];
const CONCRETE = 8;
const CIVIC = 9;
const CIVIC_TYPES = new Set(['public', 'civic', 'government', 'church', 'cathedral', 'chapel', 'mosque', 'temple', 'museum', 'courthouse']);
const HOME_TYPES = new Set(['residential', 'apartments', 'house', 'terrace', 'detached', 'dormitory', 'bungalow']);

const hash = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// The facade of a building, by its height, type and neighbourhood (city-config.js districtAt)
function facadeOf(b, style, r) {
  const h = b.top;
  if (CIVIC_TYPES.has(b.type) && h < 40) return CIVIC;
  if (h >= 150) return 1;
  if (h >= 60 && !HOME_TYPES.has(b.type)) return GLASS[Math.floor(r * GLASS.length)];
  if (HOME_TYPES.has(b.type) || style === 'housing') return h >= 15 ? HOUSING : SHOPHOUSE[Math.floor(r * SHOPHOUSE.length)];
  if (style === 'shophouses' && h < 20) return SHOPHOUSE[Math.floor(r * SHOPHOUSE.length)];
  if (style === 'glass-towers' && h >= 30) return GLASS[Math.floor(r * GLASS.length)];
  return h < 12 && r < 0.5 ? SHOPHOUSE[Math.floor(r * 2 * SHOPHOUSE.length)] : CONCRETE;
}

// GEO.buildings as [{ rings: [Float32Array x, z, ...] (outer first, clockwise in x, z; then its courtyards), top, bottom,
// type }]
function decode(B) {
  const out = [];
  const d = B.data;
  let i = 0;
  let fx = 0;
  let fz = 0;
  while (i < d.length) {
    const count = d[i];
    const b = { rings: [], top: d[i + 1] / 10, bottom: d[i + 2] / 10, type: B.types[d[i + 3]] };
    i += 4;
    for (let r = 0; r < count; r++) {
      const n = d[i++];
      const pts = new Float32Array(n * 2);
      let px = fx;
      let pz = fz;
      for (let k = 0; k < n; k++) {
        px += d[i++];
        pz += d[i++];
        pts[k * 2] = px / 10;
        pts[k * 2 + 1] = pz / 10;
        if (!k) { fx = px; fz = pz; }
      }
      b.rings.push(pts);
    }
    out.push(b);
  }
  return out;
}

// The smallest box turned to one of the ring's edges holding it: { cx, cz, hx, hz, ux, uz, area }
function orientedBox(pts) {
  const n = pts.length / 2;
  let best = null;
  const step = Math.max(1, Math.floor(n / 24));
  for (let i = 0; i < n; i += step) {
    const j = (i + 1) % n;
    let ux = pts[j * 2] - pts[i * 2];
    let uz = pts[j * 2 + 1] - pts[i * 2 + 1];
    const L = Math.hypot(ux, uz);
    if (L < 0.5) continue;
    ux /= L;
    uz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 2], z = pts[k * 2 + 1];
      const a = x * ux + z * uz, c = -x * uz + z * ux;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (c < b0) b0 = c;
      if (c > b1) b1 = c;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, hx: (a1 - a0) / 2, hz: (b1 - b0) / 2, ux, uz, area };
    }
  }
  return best;
}

function ringArea(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  return a / 2;
}

function obbCollider(cx, cz, hx, hz, ux, uz, minY, maxY) {
  const ex = Math.abs(ux) * hx + Math.abs(uz) * hz;
  const ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs: ux, sn: -uz } };
}

function buildOpenCityBuildings(scene) {
  if (!GEO.buildings) return null;
  const t0 = performance.now();
  const buildings = decode(GEO.buildings);
  const group = new THREE.Group();
  group.name = 'CityBuildings';

  // Walls: per facade, the instance transforms, `box` (width, height, depth, seed + tone) & `faces` (wall kinds)
  const walls = FACADES.map(() => ({ m: [], box: [], faces: [] }));
  const roofPos = [];
  const roofCol = [];
  const colliders = [];
  const footprints = [];
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const v2 = (pts, k) => new THREE.Vector2(pts[k * 2], pts[k * 2 + 1]);

  buildings.forEach((b, bi) => {
    const outer = b.rings[0];
    const n = outer.length / 2;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += outer[k * 2]; cz += outer[k * 2 + 1]; }
    cx /= n;
    cz /= n;
    const r = hash(cx, cz);
    const facade = facadeOf(b, districtAt(cx, cz), r);
    const tone = hash(cz, cx);
    const shopFront = SHOPHOUSE.includes(facade) || b.type === 'retail' || b.type === 'commercial';
    const kind = b.bottom > 3 ? WALL_KINDS.rear : shopFront ? WALL_KINDS.shop : WALL_KINDS.entry;
    const h = b.top - b.bottom;
    const W = walls[facade];
    const seed = ((bi * 29) % 1000) + 0.1 + 0.8 * tone;
    const wallColliders = [];
    // a canopy (covered walkways, shelters) is a roof on posts: no walls, nothing to bump into
    const canopy = b.type === 'roof';
    for (const ring of canopy ? [] : b.rings) {
      const m = ring.length / 2;
      for (let k = 0; k < m; k++) {
        const ax = ring[k * 2], az = ring[k * 2 + 1];
        const bx = ring[((k + 1) % m) * 2], bz = ring[((k + 1) % m) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.4) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        // outward (clockwise outer rings, anticlockwise courtyards): (-uz, ux); the unit box's +z face on the edge
        pos.set((ax + bx) / 2 + uz * 0.5, (b.top + b.bottom) / 2, (az + bz) / 2 - ux * 0.5);
        quat.setFromAxisAngle(up, Math.atan2(-uz, ux));
        mat.compose(pos, quat, scl.set(len, h, 1));
        W.m.push(...mat.elements);
        W.box.push(len, h, 1, seed);
        W.faces.push(WALL_KINDS.lotLine, WALL_KINDS.lotLine, WALL_KINDS.lotLine, kind);
        wallColliders.push(obbCollider((ax + bx) / 2 + uz * 0.4, (az + bz) / 2 - ux * 0.4, len / 2, 0.4, ux, uz, b.bottom, b.top));
      }
    }
    // Colliders: one turned box where it nearly fills it, else the walls
    if (!canopy) {
      const box = b.rings.length === 1 && orientedBox(outer);
      if (box && Math.abs(ringArea(outer)) > box.area * 0.85) colliders.push(obbCollider(box.cx, box.cz, box.hx, box.hz, box.ux, box.uz, b.bottom, b.top));
      else for (const c of wallColliders) colliders.push(c);
    }

    // Roof (and the underside of a part standing clear of the ground), tinted per building
    const contour = [];
    for (let k = 0; k < n; k++) contour.push(v2(outer, k));
    const holes = b.rings.slice(1).map((ring) => Array.from({ length: ring.length / 2 }, (_, k) => v2(ring, k)));
    const verts = [contour, ...holes].flat();
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const shade = 0.82 + tone * 0.26;
    for (const [y, faceUp] of b.bottom > 0.5 ? [[b.top, true], [b.bottom, false]] : [[b.top, true]]) {
      for (const [i0, i1, i2] of tris) {
        const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
        // facing up: anticlockwise seen from above
        const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
        const [q1, q2] = (cross < 0) === faceUp ? [p1, p2] : [p2, p1];
        roofPos.push(p0.x, y, p0.y, q1.x, y, q1.y, q2.x, y, q2.y);
        roofCol.push(shade, shade, shade, shade, shade, shade, shade, shade, shade);
      }
    }
    footprints.push({ pts: outer, h: b.top });
  });

  // One instanced mesh of wall quads per facade
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0, 0.5);
  let wallCount = 0;
  FACADES.forEach(([create, opts], f) => {
    const W = walls[f];
    const count = W.box.length / 4;
    if (!count) return;
    wallCount += count;
    const geometry = quad.clone();
    geometry.setAttribute('box', new THREE.InstancedBufferAttribute(new Float32Array(W.box), 4));
    geometry.setAttribute('faces', new THREE.InstancedBufferAttribute(new Float32Array(W.faces), 4));
    const mesh = new THREE.InstancedMesh(geometry, create({ ...opts, boxLocal: true }), count);
    mesh.instanceMatrix.array.set(W.m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `CityBuildings_facade${f}`;
    group.add(mesh);
  });
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3));
  roofGeo.computeVertexNormals();
  const roofs = new THREE.Mesh(roofGeo, new THREE.MeshStandardNodeMaterial({ color: 0x9c988f, roughness: 0.9, metalness: 0.05, vertexColors: true }));
  roofs.castShadow = roofs.receiveShadow = true;
  roofs.name = 'CityBuildings_roofs';
  group.add(roofs);

  scene.add(group);
  console.info(`[buildings] ${buildings.length} buildings from OpenStreetMap: ${wallCount} walls, ${roofPos.length / 9} roof triangles, ${colliders.length} colliders in ${Math.round(performance.now() - t0)} ms`);
  return { group, colliders, allBlocks: [{ footprints }], update: () => {}, updateLights: null };
}

export { buildOpenCityBuildings };
