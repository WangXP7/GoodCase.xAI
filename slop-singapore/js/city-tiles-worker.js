import { buildTileArrays, transferables, islandGround } from './city-tiles-build.js';
import { decodePNG } from './png-decode.js';

// js/city-tiles-worker.js
// Fetches and builds island tiles off the main thread (js/city-tiles.js):
// - { type: 'ground', url, landuse, land, coreRing, tile } first: reads the island's land-use image (url) to plant the
//   tiles' trees by, and answers { type: 'ground', pixels } (a copy of its RGBA, transferred) for the ground's texture,
//   or { type: 'ground', error }
// - { id, url, i, j } a tile: { id, built } or { id, error }, the built tile's arrays transferred (built with its trees
//   once the ground is read; a tile asked for before that waits for it)

let ground = null; // a promise of (i, j) => buildTileArrays's ground, or null

async function readGround({ url, landuse, land, coreRing, tile }) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const png = await decodePNG(new Uint8Array(await r.arrayBuffer()));
  if (png.channels !== 4 || png.w !== landuse.w || png.h !== landuse.h) throw new Error('land use image does not match index.json');
  return { pixels: png.pixels, at: islandGround({ landuse: { ...landuse, pixels: png.pixels }, land, coreRing, tile }) };
}

self.onmessage = async ({ data }) => {
  if (data.type === 'ground') {
    const reading = readGround(data);
    ground = reading.then((g) => g.at, () => null);
    try {
      const { pixels } = await reading;
      const copy = pixels.slice();
      self.postMessage({ type: 'ground', pixels: copy }, [copy.buffer]);
    } catch (e) {
      self.postMessage({ type: 'ground', error: e.message || String(e) });
    }
    return;
  }
  const { id, url, i, j } = data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const at = ground ? await ground : null;
    const built = buildTileArrays(await r.json(), at && Number.isFinite(i) ? at(i, j) : null);
    self.postMessage({ id, built }, transferables(built));
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
