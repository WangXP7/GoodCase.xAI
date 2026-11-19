import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { makeFrame, gridBearing } from '../tools/city/frame.mjs';
import { roadAttrs, streetPieces, coastLand } from '../tools/city/osm.mjs';
import { buildCity } from '../tools/city/build.mjs';

const LAT0 = 1.3, LON0 = 103.8;
const way = (id, nodes, coords, tags) => ({ type: 'way', id, nodes, geometry: coords.map(([lon, lat]) => ({ lon, lat })), tags });

test('the frame maps longitude / latitude to metres and back', () => {
  const f = makeFrame({ lat0: LAT0, lon0: LON0, theta: 0.5 });
  const [x, z] = f.toWorld(LON0 + 0.01, LAT0 + 0.02);
  assert.ok(Math.abs(Math.hypot(x, z) - Math.hypot(0.01 * 111320, 0.02 * 110570)) < 50);
  const [lon, lat] = f.toLonLat(x, z);
  assert.ok(Math.abs(lon - LON0 - 0.01) < 1e-9 && Math.abs(lat - LAT0 - 0.02) < 1e-9);
  // north is -z with the axes unturned
  assert.ok(makeFrame({ lat0: LAT0, lon0: LON0 }).toWorld(LON0, LAT0 + 0.01)[1] < 0);
});

test('the grid bearing is the streets\' dominant direction modulo 90°', () => {
  const f = makeFrame({ lat0: LAT0, lon0: LON0 });
  const segs = [];
  // a grid turned 30° (clockwise from north) plus some diagonal noise
  for (const deg of [30, 120, 30, 120, 30, 75]) {
    const a = (deg * Math.PI) / 180;
    const de = Math.sin(a) * 100, dn = Math.cos(a) * 100;
    segs.push([LON0, LAT0, LON0 + de / 111320, LAT0 + dn / 110570]);
  }
  assert.ok(Math.abs((gridBearing(f, segs) * 180) / Math.PI - 30) < 0.5);
});

test('street attributes from OSM tags', () => {
  assert.deepEqual(roadAttrs({ highway: 'primary' }), { cls: 'primary', w: 4 * 3.3 + 1, lanes: 4, dir: 0, level: 0 });
  assert.equal(roadAttrs({ highway: 'residential', oneway: 'yes' }).dir, 1);
  assert.equal(roadAttrs({ highway: 'residential', oneway: '-1' }).dir, -1);
  assert.equal(roadAttrs({ highway: 'motorway' }).dir, 1); // implied one-way
  assert.equal(roadAttrs({ highway: 'tertiary', junction: 'roundabout' }).dir, 1);
  assert.equal(roadAttrs({ highway: 'secondary', lanes: '3', oneway: 'yes' }).w, 3 * 3.3 + 1);
  assert.equal(roadAttrs({ highway: 'secondary', width: '12.5 m' }).w, 12.5);
  assert.equal(roadAttrs({ highway: 'trunk', bridge: 'yes' }).level, 1);
  assert.equal(roadAttrs({ highway: 'trunk', bridge: 'viaduct', layer: '2' }).level, 2);
  assert.equal(roadAttrs({ highway: 'motorway', tunnel: 'yes', layer: '-2' }).level, -2);
  assert.equal(roadAttrs({ highway: 'service', tunnel: 'building_passage' }).level, 0);
});

test('highway ways are split into pieces at shared nodes', () => {
  const f = makeFrame({ lat0: LAT0, lon0: LON0 });
  const els = [
    way(1, [1, 2, 3, 4], [[LON0, LAT0], [LON0 + 0.001, LAT0], [LON0 + 0.002, LAT0], [LON0 + 0.003, LAT0]], { highway: 'residential' }),
    way(2, [5, 3, 6], [[LON0 + 0.002, LAT0 - 0.001], [LON0 + 0.002, LAT0], [LON0 + 0.002, LAT0 + 0.001]], { highway: 'residential' }),
    way(3, [7, 2], [[LON0 + 0.001, LAT0 + 0.001], [LON0 + 0.001, LAT0]], { highway: 'footway' }) // not kept: no split at node 2
  ];
  const pieces = streetPieces(els, f.toWorld);
  assert.deepEqual(pieces.map((p) => p.nodes), [[1, 2, 3], [3, 4], [5, 3], [3, 6]]);
  assert.equal(pieces[0].pts.length, 3);
});

test('coastline land: land on the left of the coast, water on the right', () => {
  const f = makeFrame({ lat0: LAT0, lon0: LON0 });
  const d = 0.003;
  // an island drawn anticlockwise, as OSM draws them
  const coast = [way(1, [1, 2, 3, 4, 1], [[LON0 - d, LAT0 - d], [LON0 + d, LAT0 - d], [LON0 + d, LAT0 + d], [LON0 - d, LAT0 + d], [LON0 - d, LAT0 - d]], { natural: 'coastline' })];
  const e = 0.005;
  const clip = [f.toWorld(LON0 - e, LAT0 + e), f.toWorld(LON0 + e, LAT0 + e), f.toWorld(LON0 + e, LAT0 - e), f.toWorld(LON0 - e, LAT0 - e)];
  const R = coastLand(coast, f.toWorld, clip, 2);
  const at = (lon, lat) => {
    const [x, z] = f.toWorld(lon, lat);
    return R.d[Math.floor((z - R.z0) / R.res) * R.w + Math.floor((x - R.x0) / R.res)];
  };
  assert.equal(at(LON0, LAT0), 1);
  assert.equal(at(LON0 + 0.002, LAT0 - 0.002), 1);
  assert.equal(at(LON0 + 0.004, LAT0), 0);
  assert.equal(at(LON0, LAT0 - 0.004), 0);
});

test('a city builds from OSM layers: land, blocks with lots, parks, the road graph and its trees', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'city geodata 島 '));
  try {
    const d = 0.003, r = 0.0035;
    const write = (layer, elements) => fs.writeFileSync(path.join(dir, `osm_${layer}.json`), JSON.stringify({ elements }));
    write('coast', [way(1, [1, 2, 3, 4, 1], [[LON0 - d, LAT0 - d], [LON0 + d, LAT0 - d], [LON0 + d, LAT0 + d], [LON0 - d, LAT0 + d], [LON0 - d, LAT0 - d]], { natural: 'coastline' })]);
    write('roads', [
      way(10, [11, 12, 13], [[LON0, LAT0 - r], [LON0, LAT0], [LON0, LAT0 + r]], { highway: 'primary', name: 'North Road' }),
      way(20, [21, 12, 23], [[LON0 - r, LAT0], [LON0, LAT0], [LON0 + r, LAT0]], { highway: 'residential', oneway: 'yes', name: 'East Street' }),
      way(30, [31, 32], [[LON0 - 0.002, LAT0 - 0.001], [LON0 - 0.001, LAT0 - 0.001]], { highway: 'service' })
    ]);
    const w = [-0.0025, -0.0012]; // a pond in the south-west quarter
    write('water', [way(50, [51, 52, 53, 54, 51], [[LON0 + w[0], LAT0 + w[0]], [LON0 + w[1], LAT0 + w[0]], [LON0 + w[1], LAT0 + w[1]], [LON0 + w[0], LAT0 + w[1]], [LON0 + w[0], LAT0 + w[0]]], { natural: 'water', name: 'Test Pond' })]);
    const p = [0.0003, 0.0029];
    write('parks', [way(40, [41, 42, 43, 44, 41], [[LON0 + p[0], LAT0 + p[0]], [LON0 + p[1], LAT0 + p[0]], [LON0 + p[1], LAT0 + p[1]], [LON0 + p[0], LAT0 + p[1]], [LON0 + p[0], LAT0 + p[0]]], { leisure: 'park', name: 'Test Park' })]);
    // Trees at metres east (x) & south (z) of the crossing: in the sea, mid-carriageway on North Road (14.2 m wide), just
    // inside its roadway by the kerb, in the north-east park, deep in the south-east block's lots, on its sidewalk
    const ll = (x, z) => [LON0 + x / (111320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 - z / 110574];
    const treeAt = { sea: [500, 0], road: [0, 200], kerb: [6.5, 200], park: [150, -150], lot: [160, 160], sidewalk: [9, 160] };
    fs.writeFileSync(path.join(dir, 'trees.csv'), ['lng,lat,height,family', ...Object.entries(treeAt).map(([k, [x, z]], i) =>
      `${ll(x, z).join(',')},${6 + i * 3},"${k === 'park' ? 'Fabaceae (Leguminosae)' : 'Myrtaceae'}"`)].join('\n') + '\n');
    // Buildings: one of 10 storeys over the lot tree, one drawn by its part (from the ground up to 50 m), a canopy
    const square = (id, x, z, half, tags) => {
      const c = [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half], [x - half, z - half]];
      return way(id, [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3, id * 10], c.map(([px, pz]) => ll(px, pz)), tags);
    };
    write('buildings', [
      square(60, 160, 160, 10, { building: 'apartments', 'building:levels': '10' }),
      square(61, 160, -40 + 200, 0, { building: 'yes' }), // degenerate: dropped
      square(62, -150, -150, 15, { building: 'yes', height: '20' }),
      square(63, -150, -150, 8, { 'building:part': 'yes', height: '50' }),
      square(64, -60, -220, 6, { building: 'roof' }),
      square(65, 150, -60, 12, { building: 'hotel', height: '193' }) // a landmark modelled by hand: left out
    ]);
    // An ERP gantry on North Road, a speed camera by East Street, a red light camera on North Road's southern approach
    const node = (id, [lon, lat], tags) => ({ type: 'node', id, lon, lat, tags });
    write('enforcement', [
      node(70, ll(0, 120), { highway: 'toll_gantry', name: 'ERP' }),
      node(71, ll(100, 0), { highway: 'speed_camera', maxspeed: '40' }),
      { type: 'relation', id: 72, tags: { type: 'enforcement', enforcement: 'traffic_signals' }, members: [
        { type: 'node', role: 'from', ...Object.fromEntries([['lon', ll(0, 60)[0]], ['lat', ll(0, 60)[1]]]) },
        { type: 'node', role: 'to', ...Object.fromEntries([['lon', ll(0, 10)[0]], ['lat', ll(0, 10)[1]]]) }
      ] }
    ]);
    const city = {
      id: 'testcity', name: 'Test City', origin: { lat: LAT0, lon: LON0, label: 'the crossing' }, bearing: 'auto',
      detail: [LAT0 - 0.0032, LON0 - 0.0032, LAT0 + 0.0032, LON0 + 0.0032], margin: 0.001, sidewalk: 5, strip: 6, driveSide: 'left',
      trees: { credit: 'test', shapes: { 'Fabaceae (Leguminosae)': 'locust' } },
      landmarks: [{ id: 'tower', name: 'Test Tower', hide: [65] }]
    };
    const out = path.join(dir, 'testcity-geodata.js');
    await buildCity(city, { out, data: dir });
    const { GEO } = await import(pathToFileURL(out).href);
    assert.equal(GEO.version, 2);
    assert.equal(GEO.frame.bearingDeg, 0);
    assert.equal(GEO.land.length, 1);
    assert.equal(GEO.land[0].length, 2, 'the pond is a hole in the island');
    // the two streets cut the island into four blocks, each with lots; the north-east one is the park
    assert.equal(GEO.blocks.length, 4);
    for (const b of GEO.blocks) assert.ok(b[1].length > 0, 'every block has lots');
    const parkBlocks = GEO.blocks.filter((b) => b[2] > 0.6);
    assert.equal(parkBlocks.length, 1);
    assert.equal(parkBlocks[0][3], 'Test Park');
    const ne = parkBlocks[0][0];
    assert.ok(ne[0] > 0 && ne[1] < 0, 'north-east is +x, -z');
    // road graph: the crossing and four ends, the service road left out
    const RG = GEO.roadGraph;
    assert.equal(RG.nodes.length / 2, 5);
    assert.equal(RG.links.length, 4);
    const ns = RG.links.filter((l) => RG.names[l[2]] === 'North Road');
    const ew = RG.links.filter((l) => RG.names[l[2]] === 'East Street');
    assert.equal(ns.length, 2);
    assert.ok(ns.every((l) => l[4] === 4 && l[5] === 0 && RG.classes[l[7]] === 'primary' && l[8] === 0));
    assert.ok(ew.every((l) => l[5] === 1 && RG.nodes[l[1] * 2] > RG.nodes[l[0] * 2]), 'one-way eastbound along its links');
    // road pricing & cameras
    const E = GEO.enforcement;
    assert.deepEqual([E.gantries.length / 2, E.speed.length / 3, E.redLight.length / 4], [1, 1, 1]);
    assert.ok(Math.abs(E.gantries[0] / 10) < 1 && Math.abs(E.gantries[1] / 10 - 120) < 1);
    assert.equal(E.speed[2], 40, 'the speed limit');
    assert.deepEqual([E.redLight[2], E.redLight[3]], [0, -100], 'watching the northbound approach (towards -z)');
    // buildings: [rings, top dm, bottom dm, type, per ring: points, dx dz (dm) from the point before...]
    const B = GEO.buildings, built = [];
    for (let i = 0, fx = 0, fz = 0; i < B.data.length;) {
      const b = { rings: B.data[i], top: B.data[i + 1] / 10, bottom: B.data[i + 2] / 10, type: B.types[B.data[i + 3]], pts: [] };
      i += 4;
      for (let r = 0; r < b.rings; r++) {
        const n = B.data[i++];
        let px = fx, pz = fz;
        for (let k = 0; k < n; k++) {
          px += B.data[i++]; pz += B.data[i++];
          if (!r) b.pts.push([px / 10, pz / 10]);
          if (!k) { fx = px; fz = pz; }
        }
      }
      built.push(b);
    }
    assert.equal(built.length, 3, JSON.stringify(built.map((b) => [b.type, b.top])));
    assert.ok(!built.some((b) => b.top === 193), 'the modelled landmark is left out');
    const at = (x, z) => built.find((b) => b.pts.every(([px, pz]) => Math.abs(px - x) < 17 && Math.abs(pz - z) < 17));
    assert.equal(at(160, 160).top, 32, 'ten storeys of 3.2 m');
    assert.equal(at(-150, -150).top, 50, 'the part stands for its outline');
    assert.ok(at(-60, -220).bottom >= 2.6, 'a canopy stands clear of the ground');
    // trees: the park's, the sidewalk's and the kerbside one (moved off the roadway) stand; the rest (in the sea,
    // mid-carriageway, inside the apartment block) don't
    assert.deepEqual(GEO.trees.shapes, ['plane', 'locust']);
    const planted = [];
    let tx = 0, tz = 0;
    GEO.trees.heights.forEach((h, i) => {
      tx += GEO.trees.xz[i * 2];
      tz += GEO.trees.xz[i * 2 + 1];
      planted.push([tx, tz, h, GEO.trees.shape[i]]);
    });
    assert.equal(planted.length, 3, JSON.stringify(planted));
    const near = ([x, z], r) => planted.find((t) => Math.hypot(t[0] / 10 - x, t[1] / 10 - z) < r);
    assert.equal(near(treeAt.park, 1)[3], 1, 'a legume grows as a locust');
    assert.ok(near(treeAt.sidewalk, 1));
    const kerb = near(treeAt.kerb, 3);
    assert.ok(kerb && kerb[0] / 10 > 7.1, 'the kerbside tree moved out of the roadway');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
