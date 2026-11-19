import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTiles } from '../tools/city/tiles.mjs';
import { islandQueries } from '../tools/city/fetch-island.mjs';
import { decodePNG } from '../tools/city/png.mjs';
import { decodeBuildings, decodeTrees, buildTileArrays, triangulate, transferables, islandGround, TREE_SPACING, REAL_ROOM, TREE_CHUNK } from '../js/city-tiles-build.js';

const LAT0 = 1.3, LON0 = 103.8;
const way = (id, coords, tags) => ({ type: 'way', id, nodes: coords.map((_, i) => (i === coords.length - 1 ? id * 100 : id * 100 + i)), geometry: coords.map(([lon, lat]) => ({ lon, lat })), tags });
// metres east (x) & south (z) of the origin as lon, lat (the frame is turned 0°)
const ll = (x, z) => [LON0 + x / (111320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 - z / 110574];
const square = (id, x, z, half, tags) => way(id, [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half], [x - half, z - half]].map(([a, b]) => ll(a, b)), tags);

test('the island is fetched in cells covering its box, plus its coastline and water', async () => {
  const q = islandQueries({ island: { box: [1.2, 103.6, 1.32, 103.72], fetchCell: 0.06 } });
  const cells = Object.keys(q).filter((k) => k.startsWith('cell_'));
  assert.equal(cells.length, 4);
  assert.ok(q.coast.includes('"natural"="coastline"') && q.water.includes('reservoir'));
  assert.ok(q[cells[0]].includes('building') && q[cells[0]].includes('motorway'));
});

test('island tiles: the buildings and main roads beyond the detailed area, by tile, and the island\'s land', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'city tiles '));
  try {
    const data = path.join(dir, 'island');
    fs.mkdirSync(data);
    const D = 4000; // m: the island is 8 km across
    // (a coastline runs with the land on its left: anticlockwise on the map)
    const coast = way(1, [[-D, -D], [-D, D], [D, D], [D, -D], [-D, -D]].map(([x, z]) => ll(x, z)), { natural: 'coastline' });
    fs.writeFileSync(path.join(data, 'coast.json'), JSON.stringify({ elements: [coast] }));
    fs.writeFileSync(path.join(data, 'water.json'), JSON.stringify({ elements: [] }));
    const elements = [
      square(10, 0, 0, 10, { building: 'office', height: '80' }), // in the detailed area: left to the city
      square(11, 2000, 0, 15, { building: 'apartments', 'building:levels': '16' }),
      square(12, -2500, 1800, 20, { building: 'residential' }), // no height: an HDB block's 12 storeys
      square(13, 1200, -2600, 25, { building: 'yes' }), // drawn by its part
      square(14, 1200, -2600, 10, { 'building:part': 'yes', height: '40' }),
      way(20, [ll(-3000, 400), ll(-1000, 400), ll(1000, 400), ll(3000, 400)], { highway: 'trunk', name: 'Test Expressway' }),
      way(21, [ll(-3000, -400), ll(3000, -400)], { highway: 'residential' }) // not a main road
    ];
    fs.writeFileSync(path.join(data, 'cell_a.json'), JSON.stringify({ elements }));
    fs.writeFileSync(path.join(data, 'cell_b.json'), JSON.stringify({ elements: [elements[1]] })); // in two cells: once
    const city = {
      id: 'testisle', detail: [LAT0 - 0.003, LON0 - 0.003, LAT0 + 0.003, LON0 + 0.003], margin: 0.001,
      island: { box: [LAT0 - 0.045, LON0 - 0.045, LAT0 + 0.045, LON0 + 0.045], tile: 1500 }
    };
    const geo = { frame: { lat0: LAT0, lon0: LON0, bearingDeg: 0 } };
    const out = path.join(dir, 'tiles');
    const index = await buildTiles(city, { data, out, geo });
    assert.equal(index.tile, 1500);
    assert.equal(index.land.length, 1, 'one island');
    const xs = index.land[0][0].filter((_, k) => k % 2 === 0);
    assert.ok(Math.min(...xs) < -3900 && Math.max(...xs) > 3900, 'the land reaches the coast');
    // every building but the detailed area's, each in the tile its centre is in
    const all = [];
    for (const t of index.tiles) {
      const tile = JSON.parse(fs.readFileSync(path.join(out, t.file), 'utf8'));
      for (const b of decodeBuildings(tile.buildings)) {
        let cx = 0, cz = 0;
        const n = b.pts.length / 2;
        for (let k = 0; k < n; k++) { cx += b.pts[k * 2]; cz += b.pts[k * 2 + 1]; }
        all.push({ ...b, x: t.i * 1500 + cx / n, z: t.j * 1500 + cz / n, tile: t });
      }
      if (t.roads) assert.ok(tile.roads.every((r) => index.roadClasses[r[0]] === 'trunk'));
    }
    assert.equal(all.length, 3, JSON.stringify(all.map((b) => [b.type, b.top])));
    const at = (x, z) => all.find((b) => Math.hypot(b.x - x, b.z - z) < 2);
    assert.equal(at(2000, 0).top, 51.2);
    assert.equal(at(-2500, 1800).top, 38.4, 'an untagged residential block');
    assert.equal(at(1200, -2600).top, 40, 'the part stands for its outline');
    assert.ok(!at(0, 0), 'the detailed area is the city\'s own');
    for (const b of all) assert.ok(b.x >= b.tile.i * 1500 && b.x < (b.tile.i + 1) * 1500 && b.z >= b.tile.j * 1500 && b.z < (b.tile.j + 1) * 1500);
    // the expressway, cut by tile and left out of the detailed area
    const runs = index.tiles.reduce((n, t) => n + t.roads, 0);
    assert.ok(runs >= 4, `the trunk road runs through several tiles (${runs})`);
    // the frame is the city's
    assert.deepEqual(index.frame, geo.frame);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ear clipping triangulates concave footprints, either way round, covering their area', () => {
  // an L of 3 x 3 cells less one: area 3
  const L = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2];
  for (const pts of [L, L.slice().reverse().reduce((a, _, i, r) => (i % 2 ? a : a.concat([r[i + 1], r[i]])), [])]) {
    const tris = triangulate(new Float32Array(pts));
    assert.equal(tris.length, 4 * 3);
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [pts[i * 2], pts[i * 2 + 1]]);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    assert.ok(Math.abs(area - 3) < 1e-9, `area ${area}`);
  }
});

test('a built tile: walls facing out, roofs and roads facing up, bounding spheres around them', () => {
  // one clockwise (x, z) square building 10 m across and 20 m tall at (50, 50) in the tile, one road run
  const pts = [[45, 45], [45, 55], [55, 55], [55, 45]];
  const data = [1, 200, 0, 0, 4];
  let px = 0, pz = 0;
  for (const [x, z] of pts) { data.push(x * 10 - px, z * 10 - pz); px = x * 10; pz = z * 10; }
  const tile = { buildings: { types: ['apartments'], data }, roads: [[1, 140, 0, 2, 0, 0, 1000, 0]] };
  const built = buildTileArrays(tile);
  assert.deepEqual(built.counts, { walls: 4, roofs: 2, roads: 1 });
  const P = built.walls.position, N = built.walls.normal;
  for (let v = 0; v < P.length / 3; v++) {
    const out = (P[v * 3] - 50) * N[v * 3] + (P[v * 3 + 2] - 50) * N[v * 3 + 2];
    assert.ok(out > 0, 'wall normals point away from the building');
  }
  for (const part of [built.roofs, built.roads]) {
    const p = part.position;
    for (let t = 0; t < p.length; t += 9) {
      // y of (b - a) x (c - a) > 0 is facing up
      const cy = (p[t + 5] - p[t + 2]) * (p[t + 6] - p[t]) - (p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]);
      assert.ok(cy > 0, 'faces up');
    }
  }
  const [cx, cy, cz, r] = built.walls.sphere;
  assert.ok(Math.abs(cx - 50) < 1e-6 && Math.abs(cy - 10) < 1e-6 && Math.abs(cz - 50) < 1e-6 && Math.abs(r - Math.hypot(10, 20, 10) / 2) < 1e-6);
  assert.equal(decodeBuildings(tile.buildings)[0].top, 20);
});

test('the land mask: inside the island, not in its lakes or the sea', async () => {
  const { createLandMask } = await import('../js/city-tiles-build.js');
  const island = [-100, -100, 100, -100, 100, 100, -100, 100];
  const lake = [-20, -20, 20, -20, 20, 20, -20, 20];
  const mask = createLandMask([[island, lake]], 2);
  assert.equal(mask.at(50, 50), true);
  assert.equal(mask.at(0, 0), false, 'the lake');
  assert.equal(mask.at(150, 0), false, 'the sea');
  assert.equal(mask.at(-99, 99), true);
});

test('a tile\'s colliders: one turned box for a building that nearly fills it, a thin one per wall otherwise', () => {
  const enc = (pts, top) => {
    const data = [1, top * 10, 0, 0, pts.length];
    let px = 0, pz = 0;
    for (const [x, z] of pts) { data.push(x * 10 - px, z * 10 - pz); px = x * 10; pz = z * 10; }
    return data;
  };
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const ell = [[100, 100], [100, 140], [140, 140], [140, 130], [110, 130], [110, 100]];
  const built = buildTileArrays({ buildings: { types: ['yes'], data: [...enc(square, 20), ...enc(ell, 12)] }, roads: [] });
  const c = built.colliders;
  assert.equal(c.length / 8, 1 + 6, 'the square as one box, the L by its six walls');
  assert.deepEqual([...c.slice(0, 4)].map((v) => Math.round(Math.abs(v) * 10) / 10), [5, 5, 5, 5]);
  assert.deepEqual([c[6], c[7]], [0, 20]);
});

test('island tiles: the land use, as an image over the land', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'city landuse '));
  try {
    const data = path.join(dir, 'island');
    fs.mkdirSync(data);
    const D = 4000;
    const coast = way(1, [[-D, -D], [-D, D], [D, D], [D, -D], [-D, -D]].map(([x, z]) => ll(x, z)), { natural: 'coastline' });
    fs.writeFileSync(path.join(data, 'coast.json'), JSON.stringify({ elements: [coast] }));
    fs.writeFileSync(path.join(data, 'water.json'), JSON.stringify({ elements: [] }));
    fs.writeFileSync(path.join(data, 'cell_a.json'), JSON.stringify({ elements: [] }));
    fs.writeFileSync(path.join(data, 'landuse_a.json'), JSON.stringify({ elements: [square(30, 2000, 1000, 300, { leisure: 'park' }), square(31, -2000, -1000, 200, { landuse: 'forest' })] }));
    const city = {
      id: 'testisle', detail: [LAT0 - 0.003, LON0 - 0.003, LAT0 + 0.003, LON0 + 0.003], margin: 0.001,
      island: { box: [LAT0 - 0.045, LON0 - 0.045, LAT0 + 0.045, LON0 + 0.045], tile: 1500 }
    };
    const out = path.join(dir, 'tiles');
    const index = await buildTiles(city, { data, out, geo: { frame: { lat0: LAT0, lon0: LON0, bearingDeg: 0 } } });
    const lu = index.landuse;
    assert.ok(lu, 'in the index');
    assert.equal(lu.file, 'landuse.png');
    assert.deepEqual(lu.channels, ['wood', 'grass', 'paved', 'sand']);
    assert.ok(lu.x0 <= -3900 && lu.x0 + lu.w * lu.res >= 3900, 'over the land');
    const img = decodePNG(fs.readFileSync(path.join(out, 'landuse.png')));
    assert.equal(img.w, lu.w);
    assert.equal(img.h, lu.h);
    const at = (x, z) => {
      const i = Math.floor((x - lu.x0) / lu.res), j = Math.floor((z - lu.z0) / lu.res);
      return Array.from(img.pixels.subarray((j * img.w + i) * 4, (j * img.w + i) * 4 + 4));
    };
    assert.equal(img.channels, 4);
    assert.deepEqual(at(2000, 1000), [0, 255, 0, 0], 'the park');
    assert.deepEqual(at(-2000, -1000), [255, 0, 0, 0], 'the woods');
    assert.deepEqual(at(0, 2500), [0, 0, 0, 0], 'the rest');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The island's trees, planted by its land use
// ---------------------------------------------------------------------------------------------------------------------
// A 600 m tile at (1200, 0): woods in its west third, grass in the middle, paving in the east, its top 100 m the land's
// own mix; a 60 m building in the woods and a road (14 m) across the tile at z = 450
function treeTile() {
  const ox = 1200, oz = 0, size = 600;
  const res = 20, w = 30, h = 30;
  const pixels = new Uint8Array(w * h * 4);
  for (let j = 5; j < h; j++) for (let i = 0; i < w; i++) pixels[(j * w + i) * 4 + (i < 10 ? 0 : i < 20 ? 1 : 2)] = 255;
  const landuse = { x0: ox, z0: oz, res, w, h, pixels };
  const enc = (pts) => { const d = [1, 200, 0, 0, pts.length]; let px = 0, pz = 0; for (const [x, z] of pts) { d.push(x * 10 - px, z * 10 - pz); px = x * 10; pz = z * 10; } return d; };
  const tile = {
    buildings: { types: ['apartments'], data: enc([[70, 270], [70, 330], [130, 330], [130, 270]]) },
    roads: [[1, 140, 0, 2, 0, 4500, 6000, 0]]
  };
  return { ox, oz, size, landuse, tile };
}
const treesOf = (m) => Array.from({ length: m.count }, (_, k) => ({ x: m.matrices[k * 16 + 12], z: m.matrices[k * 16 + 14], h: m.matrices[k * 16 + 5], w: Math.hypot(m.matrices[k * 16], m.matrices[k * 16 + 2]) }));

test('island trees: dense in the woods, scattered in parks, a few elsewhere, none on paving', () => {
  const { ox, oz, size, landuse, tile } = treeTile();
  const built = buildTileArrays(tile, { ox, oz, size, landuse });
  const trees = treesOf(built.trees);
  assert.ok(built.trees.count > 500, `${built.trees.count} trees`);
  const per = (x0, x1, z0, z1) => trees.filter((t) => t.x >= x0 && t.x < x1 && t.z >= z0 && t.z < z1).length / ((x1 - x0) * (z1 - z0));
  const site = 1 / (TREE_SPACING * TREE_SPACING);
  const woods = per(0, 190, 110, 260), park = per(210, 390, 110, 430), paved = per(410, 600, 110, 430), rest = per(0, 600, 0, 90);
  assert.ok(Math.abs(woods / site - 0.85) < 0.1, `woods ${(woods / site).toFixed(2)} a site`);
  assert.ok(Math.abs(park / site - 0.12) < 0.05, `parks ${(park / site).toFixed(2)} a site`);
  assert.equal(paved, 0, 'none on paving');
  assert.ok(rest > 0 && rest / site < 0.08, `the rest ${(rest / site).toFixed(3)} a site`);
  // sizes: the woods' tall, a unit tree scaled up (column-major, translation in the last column, on the ground)
  for (const t of trees.filter((q) => q.x < 190 && q.z > 110)) assert.ok(t.h >= 13 && t.h <= 24 && t.w >= 9 && t.w <= 13);
  for (let k = 0; k < built.trees.count; k++) assert.equal(built.trees.matrices[k * 16 + 13], 0);
  assert.ok(transferables(built).includes(built.trees.matrices.buffer), 'transferred');
  // the same trees every time
  assert.deepEqual(buildTileArrays(tile, { ox, oz, size, landuse }).trees.matrices, built.trees.matrices);
  // and none without the land use
  assert.equal(buildTileArrays(tile).trees, null);
});

test('island trees keep clear of buildings, roads, the sea and the detailed city', () => {
  const { ox, oz, size, landuse, tile } = treeTile();
  const onLand = (x, z) => z < 560;
  const inCore = (x, z) => x < ox + 40;
  const trees = treesOf(buildTileArrays(tile, { ox, oz, size, landuse, onLand, inCore }).trees);
  assert.ok(trees.length > 300);
  for (const t of trees) {
    assert.ok(!(t.x > 70 - 2.5 && t.x < 130 + 2.5 && t.z > 270 - 2.5 && t.z < 330 + 2.5), `in the building at ${t.x}, ${t.z}`);
    assert.ok(Math.abs(t.z - 450) > 7 + 2.5 - 0.01, `on the road at ${t.x}, ${t.z}`);
    assert.ok(t.z + oz < 560, 'in the sea');
    assert.ok(t.x + ox >= ox + 40, 'in the detailed city');
  }
  // (the woods do reach right up to them)
  assert.ok(trees.some((t) => t.x > 50 && t.x < 150 && t.z > 255 && t.z < 268), 'up to the building');
});

test('islandGround: the tiles\' corners, the land and the detailed city from the index', () => {
  const { landuse } = treeTile();
  const at = islandGround({ landuse, land: [[[0, 0, 3000, 0, 3000, 560, 0, 560]]], coreRing: [0, 0, 1240, 0, 1240, 600, 0, 600], tile: 600 });
  const g = at(2, 0);
  assert.equal(g.ox, 1200);
  assert.equal(g.oz, 0);
  assert.equal(g.size, 600);
  assert.equal(g.landuse, landuse);
  assert.equal(g.inCore(1230, 100), true);
  assert.equal(g.inCore(1250, 100), false);
  assert.equal(g.onLand(1300, 100), true);
  assert.equal(g.onLand(1300, 580), false);
});

test('the tile worker: reads the land use once, hands it back, and plants the tiles it builds', async () => {
  const { landuse, tile } = treeTile();
  const { encodePNG } = await import('../tools/city/png.mjs');
  const png = encodePNG(landuse.pixels, landuse.w, landuse.h, 4);
  const src = fs.readFileSync(new URL('../js/city-tiles-worker.js', import.meta.url), 'utf8');
  const posted = [];
  const self = { postMessage: (msg, transfer) => posted.push({ msg, transfer }) };
  globalThis.self = self;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (url === 'landuse.png' ? new Response(png) : url === 'tile.json' ? new Response(JSON.stringify(tile)) : new Response('', { status: 404 }));
  try {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'js');
    const file = path.join(dir, `.city-tiles-worker.test.${process.pid}.mjs`);
    fs.writeFileSync(file, src);
    try {
      await import(file);
    } finally {
      fs.rmSync(file, { force: true });
    }
    const meta = { x0: landuse.x0, z0: landuse.z0, res: landuse.res, w: landuse.w, h: landuse.h };
    // a tile asked for while the ground is being read waits for it
    const reading = self.onmessage({ data: { type: 'ground', url: 'landuse.png', landuse: meta, land: [[[0, 0, 3000, 0, 3000, 600, 0, 600]]], coreRing: [], tile: 600 } });
    const building = self.onmessage({ data: { id: 5, url: 'tile.json', i: 2, j: 0 } });
    await Promise.all([reading, building]);
    const ground = posted.find((p) => p.msg.type === 'ground');
    assert.deepEqual(ground.msg.pixels, landuse.pixels, 'the pixels, for the texture');
    assert.deepEqual(ground.transfer, [ground.msg.pixels.buffer]);
    const built = posted.find((p) => p.msg.id === 5).msg.built;
    assert.ok(built.trees && built.trees.count > 300, 'planted');
    await self.onmessage({ data: { id: 6, url: 'missing.json', i: 0, j: 0 } });
    assert.equal(posted.find((p) => p.msg.id === 6).msg.error, 'HTTP 404');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.self;
  }
});

test('NParks\' trees: each at its place and height, off buildings and carriageways, the filled-in ones kept clear', () => {
  const { ox, oz, size, landuse, tile } = treeTile();
  // in the park (x 210-390): a row of street trees at z 200, one in the building (100, 300), one on the road (300, 450),
  // one at the kerb 9 m off its line (the carriageway's 7 m half-width and a little), one with no height
  const real = [[250, 200, 12], [280, 200, 15], [310, 200, 9], [100, 300, 10], [300, 450, 8], [300, 459, 11], [340, 200, 0]];
  const flat = [];
  let px = 0, pz = 0;
  for (const [x, z, h] of real) { flat.push(x - px, z - pz, h); px = x; pz = z; }
  assert.deepEqual(decodeTrees(flat).map((t) => [t.x, t.z, t.h]), real);
  const withReal = { ...tile, trees: flat };
  const built = buildTileArrays(withReal, { ox, oz, size, landuse });
  assert.equal(built.trees.real, 5, 'less the one in the building and the one on the road');
  const all = treesOf(built.trees);
  const kept = [[250, 200], [280, 200], [310, 200], [300, 459], [340, 200]];
  const nparks = kept.map(([x, z]) => all.find((t) => Math.abs(t.x - x) < 1e-3 && Math.abs(t.z - z) < 1e-3));
  assert.ok(nparks.every(Boolean), 'each at its place');
  for (const [k, t] of nparks.entries()) {
    const want = [12, 15, 9, 11, 8][k];
    assert.ok(Math.abs(t.h - want) <= want * 0.1 + 1e-6, `height ${t.h} for ${want}`);
    assert.ok(t.w >= 3.5 && t.w <= 15);
  }
  // none of the filled-in ones within the park's REAL_ROOM of them; in the woods only their crown's room
  for (const t of all.filter((q) => !nparks.includes(q))) {
    for (const r of nparks) {
      const d = Math.hypot(t.x - r.x, t.z - r.z);
      if (t.x > 200 && t.x < 400) assert.ok(d > REAL_ROOM[1] - 4, `a park tree ${d.toFixed(1)} m from an NParks one`);
    }
  }
  // without the land use: NParks' alone
  const alone = buildTileArrays(withReal, null);
  assert.equal(alone.trees.count, 5);
  assert.equal(alone.trees.real, 5);
});

test('island tiles: NParks\' trees beyond the detailed area, by tile, and a tile for land with nothing else on it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'city trees '));
  try {
    const data = path.join(dir, 'island');
    fs.mkdirSync(data);
    const D = 4000;
    const coast = way(1, [[-D, -D], [-D, D], [D, D], [D, -D], [-D, -D]].map(([x, z]) => ll(x, z)), { natural: 'coastline' });
    fs.writeFileSync(path.join(data, 'coast.json'), JSON.stringify({ elements: [coast] }));
    fs.writeFileSync(path.join(data, 'water.json'), JSON.stringify({ elements: [] }));
    fs.writeFileSync(path.join(data, 'cell_a.json'), JSON.stringify({ elements: [square(11, 2000, 0, 15, { building: 'apartments' })] }));
    const trees = [[2100, 50, 12], [2110.37, 61.2, 9], [-2600, -2600, 0], [10, 10, 15], [5000, 0, 9]]; // (in town; at sea; to the metre)
    fs.writeFileSync(path.join(data, 'trees.csv'), 'lng,lat,height,family\n' + trees.map(([x, z, h]) => `${ll(x, z).join(',')},${h},"Fabaceae"`).join('\n') + '\n');
    const city = {
      id: 'testisle', detail: [LAT0 - 0.003, LON0 - 0.003, LAT0 + 0.003, LON0 + 0.003], margin: 0.001,
      island: { box: [LAT0 - 0.045, LON0 - 0.045, LAT0 + 0.045, LON0 + 0.045], tile: 1500 }
    };
    const out = path.join(dir, 'tiles');
    const index = await buildTiles(city, { data, out, geo: { frame: { lat0: LAT0, lon0: LON0, bearingDeg: 0 } } });
    const got = [];
    for (const t of index.tiles) {
      const tile = JSON.parse(fs.readFileSync(path.join(out, t.file), 'utf8'));
      const list = decodeTrees(tile.trees || []);
      assert.equal(list.length, t.trees, 'counted in the index');
      for (const tr of list) got.push([tr.x + t.i * 1500, tr.z + t.j * 1500, tr.h]);
    }
    got.sort((a, b) => a[0] - b[0]);
    const near = (a, b) => Math.abs(a - b) <= 0.5 + 0.11; // (rounded to the metre: the frame's rounding as well)
    assert.equal(got.length, 3, 'not in town or at sea');
    for (const [x, z, h] of [[-2600, -2600, 0], [2100, 50, 12], [2110.4, 61.2, 9]]) assert.ok(got.some((g) => near(g[0], x) && near(g[1], z) && g[2] === h), `${x}, ${z}`);
    // the island is 8 km of land in 1.5 km tiles: every one with land outside town has a tile, buildings or not
    assert.ok(index.tiles.length >= 30, `${index.tiles.length} tiles`);
    assert.ok(index.tiles.some((t) => t.buildings === 0 && t.roads === 0 && t.trees === 0), 'bare land too');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a tile\'s trees come in 500 m squares, each its own run of the matrices in a seeded order', () => {
  const { ox, oz, size, landuse, tile } = treeTile();
  const built = buildTileArrays(tile, { ox, oz, size, landuse });
  const t = built.trees;
  assert.ok(t.chunks.length >= 2 && t.chunks.length <= 4, `${t.chunks.length} squares of a 600 m tile`);
  assert.equal(t.chunks.reduce((n, c) => n + c.count, 0), t.count);
  let at = 0;
  for (const c of t.chunks) {
    assert.equal(c.start, at, 'one after another');
    at += c.count;
    const [cx, , cz, r] = c.sphere;
    for (let k = c.start; k < c.start + c.count; k++) {
      const x = t.matrices[k * 16 + 12], z = t.matrices[k * 16 + 14];
      assert.ok(Math.floor(x / TREE_CHUNK) === Math.floor(cx / TREE_CHUNK) && Math.floor(z / TREE_CHUNK) === Math.floor(cz / TREE_CHUNK), 'in its square');
      assert.ok(Math.hypot(x - cx, z - cz) < r);
    }
  }
  // the first half of a square spread across it, not bunched in one corner (what thinning it by count relies on)
  const big = t.chunks.reduce((a, c) => (c.count > a.count ? c : a));
  const half = Array.from({ length: Math.floor(big.count / 2) }, (_, k) => t.matrices[(big.start + k) * 16 + 14]);
  const zs = Array.from({ length: big.count }, (_, k) => t.matrices[(big.start + k) * 16 + 14]);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  assert.ok(Math.abs(mean(half) - mean(zs)) < 25, 'thinning keeps it even');
});

test('the trees\' detail and thinning by distance', async () => {
  const src = fs.readFileSync(new URL('../js/city-tiles.js', import.meta.url), 'utf8');
  // treeLod has no three.js in it: pull it out with its constants
  const body = src.slice(src.indexOf('const TREE_DETAIL ='), src.indexOf('// A unit tree 1 m tall'));
  const { treeLod, TREE_DETAIL } = new Function(`${body}; return { treeLod, TREE_DETAIL };`)();
  assert.deepEqual(treeLod(100), { lod: 0, share: 1 });
  assert.deepEqual(treeLod(600), { lod: 1, share: 1 });
  assert.deepEqual(treeLod(1200), { lod: 2, share: 1 });
  const at = treeLod(2200);
  assert.equal(at.lod, 2);
  assert.ok(at.share < 0.6 && at.share > 0.45);
  assert.deepEqual(treeLod(2400), { lod: -1, share: 0 });
  assert.deepEqual(treeLod(500, 400), { lod: -1, share: 0 }, 'a shorter range');
  // the settings: off draws none, each level further and finer than the one before
  assert.deepEqual(treeLod(1, TREE_DETAIL.off), { lod: -1, share: 0 });
  assert.deepEqual(treeLod(200, TREE_DETAIL.low), { lod: 1, share: 1 });
  assert.deepEqual(treeLod(200, TREE_DETAIL.medium), { lod: 0, share: 1 });
  assert.equal(treeLod(1400, TREE_DETAIL.low).lod, -1);
  assert.deepEqual(treeLod(1400, TREE_DETAIL.high), { lod: 1, share: 1 });
  assert.equal(treeLod(3000, TREE_DETAIL.high).lod, 2);
  const levels = ['low', 'medium', 'high'].map((k) => TREE_DETAIL[k]);
  for (let k = 1; k < levels.length; k++) {
    for (const f of ['range', 'near', 'mid', 'thin', 'keep']) assert.ok(levels[k][f] > levels[k - 1][f], f);
  }
  for (const p of levels) assert.ok(p.near < p.mid && p.mid < p.thin && p.thin < p.range && p.range <= 3500, '(within the tiles kept round the camera)');
});
