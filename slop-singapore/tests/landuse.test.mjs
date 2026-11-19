import assert from 'node:assert/strict';
import test from 'node:test';
import { landuseClass, landuseImage, LANDUSE } from '../tools/city/landuse.mjs';
import { encodePNG, decodePNG } from '../tools/city/png.mjs';
import { islandQueries } from '../tools/city/fetch-island.mjs';
import { decodePNG as decodeInBrowser } from '../js/png-decode.js';

// a world frame of metres: lon = x, lat = z
const toWorld = (lon, lat) => [lon, lat];
let id = 1;
const poly = (pts, tags) => {
  const n = id++;
  return { type: 'way', id: n, tags, nodes: [...pts.map((_, k) => n * 100 + k), n * 100], geometry: [...pts, pts[0]].map(([x, z]) => ({ lon: x, lat: z })) };
};
const rect = (x0, z0, x1, z1, tags) => poly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], tags);
const px = (img, x, z) => {
  const i = Math.floor((x - img.x0) / img.res), j = Math.floor((z - img.z0) / img.res);
  return Array.from(img.rgba.subarray((j * img.w + i) * 4, (j * img.w + i) * 4 + 4));
};

test('land use classes: woods, grass, paved, sand, or left to the land\'s own mix', () => {
  assert.deepEqual(LANDUSE, ['wood', 'grass', 'paved', 'sand']);
  assert.equal(landuseClass({ natural: 'beach' }), 3);
  assert.equal(landuseClass({ natural: 'sand' }), 3);
  assert.equal(landuseClass({ natural: 'beach', leisure: 'park' }), 3, 'a park\'s beach');
  assert.equal(landuseClass({ natural: 'bare_rock' }), 2);
  assert.equal(landuseClass({ landuse: 'forest' }), 0);
  assert.equal(landuseClass({ natural: 'wood' }), 0);
  assert.equal(landuseClass({ leisure: 'nature_reserve' }), 0);
  assert.equal(landuseClass({ leisure: 'park' }), 1);
  assert.equal(landuseClass({ leisure: 'golf_course' }), 1);
  assert.equal(landuseClass({ landuse: 'cemetery' }), 1);
  assert.equal(landuseClass({ aeroway: 'aerodrome' }), 1);
  assert.equal(landuseClass({ landuse: 'industrial' }), 2);
  assert.equal(landuseClass({ amenity: 'parking' }), 2);
  assert.equal(landuseClass({ aeroway: 'apron' }), 2);
  // the more specific tag wins
  assert.equal(landuseClass({ leisure: 'park', natural: 'wood' }), 0, 'woods in a park');
  assert.equal(landuseClass({ landuse: 'grass', amenity: 'parking' }), 2);
  assert.equal(landuseClass({ landuse: 'residential' }), -1);
  assert.equal(landuseClass({ landuse: 'military' }), -1);
  assert.equal(landuseClass({}), -1);
});

test('the land-use image: each pixel\'s share of woods, grass and paving, the smaller areas inside the larger winning', () => {
  const elements = [
    rect(0, 0, 400, 400, { leisure: 'park' }),
    rect(100, 100, 200, 200, { natural: 'wood' }), // woods in the park
    rect(250, 250, 300, 300, { amenity: 'parking' }), // its car park
    rect(500, 0, 700, 200, { landuse: 'industrial' }),
    rect(530, 30, 570, 70, { leisure: 'pitch' }), // a pitch in the industrial estate
    rect(0, 500, 300, 700, { landuse: 'residential' }), // not a class: left out
    rect(410, 0, 412, 1, { leisure: 'park' }), // too small to count (< 100 m²)
    rect(0, 750, 300, 800, { natural: 'beach' })
  ];
  elements.push(elements[0]); // (an area in two downloads: once)
  const img = landuseImage(elements, toWorld, [0, 0, 800, 800], { res: 20 });
  assert.equal(img.res, 20);
  assert.ok(img.w >= 40 && img.h >= 40);
  assert.equal(img.rgba.length, img.w * img.h * 4);
  assert.deepEqual(img.counts, [1, 2, 2, 1]);
  assert.deepEqual(px(img, 150, 770), [0, 0, 0, 255], 'the beach');
  assert.deepEqual(px(img, 50, 50), [0, 255, 0, 0], 'park: grass');
  assert.deepEqual(px(img, 150, 150), [255, 0, 0, 0], 'its woods');
  assert.deepEqual(px(img, 270, 270), [0, 0, 255, 0], 'its car park');
  assert.deepEqual(px(img, 650, 150), [0, 0, 255, 0], 'industry: paved');
  assert.deepEqual(px(img, 550, 50), [0, 255, 0, 0], 'the pitch in it');
  assert.deepEqual(px(img, 150, 600), [0, 0, 0, 0], 'homes: the land\'s own');
  assert.deepEqual(px(img, 750, 650), [0, 0, 0, 0]);
  // an edge half way across a pixel: shared
  const edge = landuseImage([rect(0, 0, 110, 400, { leisure: 'park' })], toWorld, [0, 0, 400, 400], { res: 20 });
  assert.deepEqual(px(edge, 105, 50), [0, 128, 0, 0], 'half the pixel park');
});

test('a multipolygon\'s holes are left out of it', () => {
  const outer = [[0, 0], [400, 0], [400, 400], [0, 400]].map(([x, z]) => ({ lon: x, lat: z }));
  const inner = [[150, 150], [250, 150], [250, 250], [150, 250]].map(([x, z]) => ({ lon: x, lat: z }));
  const rel = { type: 'relation', id: 999, tags: { landuse: 'forest' }, members: [{ role: 'outer', geometry: [...outer, outer[0]] }, { role: 'inner', geometry: [...inner, inner[0]] }] };
  const img = landuseImage([rel], toWorld, [0, 0, 400, 400], { res: 20 });
  assert.deepEqual(px(img, 50, 50), [255, 0, 0, 0]);
  assert.deepEqual(px(img, 200, 200), [0, 0, 0, 0], 'the clearing');
});

test('PNG: written and read back exactly, rows top first', () => {
  const w = 37, h = 11;
  const rgb = new Uint8Array(w * h * 3).map((_, k) => (k * 7919) % 256);
  const png = encodePNG(rgb, w, h, 3);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const back = decodePNG(png);
  assert.equal(back.w, w);
  assert.equal(back.h, h);
  assert.equal(back.channels, 3);
  assert.deepEqual(back.pixels, rgb);
  // and RGBA, and read by the browser's decoder (DecompressionStream) the same
  const rgba = new Uint8Array(w * h * 4).map((_, k) => (k * 104729) % 256);
  const png4 = encodePNG(rgba, w, h, 4);
  assert.deepEqual(decodePNG(png4).pixels, rgba);
  // a big even image is small
  assert.ok(encodePNG(new Uint8Array(1000 * 1000 * 3), 1000, 1000, 3).length < 10000);
});

test('the island\'s land use is fetched in cells twice the size of its buildings\'', () => {
  const q = islandQueries({ island: { box: [1.2, 103.6, 1.32, 103.72], fetchCell: 0.06 } });
  const lu = Object.keys(q).filter((k) => k.startsWith('landuse_'));
  assert.equal(lu.length, 1);
  for (const tag of ['leisure', 'landuse', 'natural', 'golf_course', 'forest', 'industrial', 'parking']) assert.ok(q[lu[0]].includes(tag), tag);
  assert.ok(q[lu[0]].includes('relation['), 'multipolygons too');
});

test('the browser\'s PNG decoder: raw values of every filter, and refusals', async () => {
  const w = 23, h = 9;
  const rgba = new Uint8Array(w * h * 4).map((_, k) => (k * 104729 + (k >> 5) * 7) % 256);
  const back = await decodeInBrowser(encodePNG(rgba, w, h, 4));
  assert.equal(back.w, w);
  assert.equal(back.h, h);
  assert.equal(back.channels, 4);
  assert.deepEqual(back.pixels, rgba);
  const grey = new Uint8Array(w * h).map((_, k) => k % 251);
  assert.deepEqual((await decodeInBrowser(encodePNG(grey, w, h, 1))).pixels, grey);
  // filters 1, 3 and 4 too (other encoders' files): one row of each, re-filtered by hand from an RGB image
  const zlib = await import('node:zlib');
  const rgb = new Uint8Array(4 * 4 * 3).map((_, k) => (k * 37 + 11) % 256);
  const stride = 12;
  const raw = Buffer.alloc(4 * (stride + 1));
  const at = (y, x) => (y < 0 || x < 0 ? 0 : rgb[y * stride + x]);
  [0, 1, 3, 4].forEach((f, y) => {
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const a = at(y, x - 3), b = at(y - 1, x), c = at(y - 1, x - 3), v = at(y, x);
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  });
  const png = encodePNG(rgb, 4, 4, 3);
  // swap its IDAT for the hand-filtered one
  const ihdr = png.subarray(0, 33);
  const idat = zlib.deflateSync(raw);
  const chunk = Buffer.alloc(12 + idat.length);
  chunk.writeUInt32BE(idat.length, 0);
  chunk.write('IDAT', 4, 'ascii');
  idat.copy(chunk, 8);
  const file = Buffer.concat([ihdr, chunk, png.subarray(png.length - 12)]);
  assert.deepEqual((await decodeInBrowser(file)).pixels, rgb, '(the decoder does not check CRCs)');
  await assert.rejects(decodeInBrowser(new Uint8Array(40)), /not a PNG/);
});
