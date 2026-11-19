// GSI (国土地理院) elevation tiles -> a regular height grid in world metres.
// Tiles are PNG-encoded DEMs on the Web Mercator XYZ grid:
//   v = R * 2^16 + G * 2^8 + B;  v < 2^23: h = 0.01 v;  v = 2^23: no data;  v > 2^23: h = 0.01 (v - 2^24)
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
export { sampleGrid } from '../../src/shared/terrain.js';

export const DEM_SOURCES = [
  { id: 'dem5a', zoom: 15, url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png` },
  { id: 'dem10b', zoom: 14, url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png` },
];

const worldPx = (lon, lat, z) => {
  const s = 256 * 2 ** z, phi = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * s];
};

export function demTileRange({ south, west, north, east }, z) {
  const [ax, ay] = worldPx(west, north, z), [bx, by] = worldPx(east, south, z);
  return { z, x0: Math.floor(ax / 256), x1: Math.floor(bx / 256), y0: Math.floor(ay / 256), y1: Math.floor(by / 256) };
}

// A sampler over one DEM source: bilinear inside a tile, NaN where there is no data.
function demSource(dir, src) {
  const cache = new Map();
  const tile = (x, y) => {
    const key = x + '_' + y;
    if (cache.has(key)) return cache.get(key);
    const f = path.join(dir, src.id, `${src.zoom}_${x}_${y}.png`);
    let h = null;
    if (fs.existsSync(f)) {
      const png = PNG.sync.read(fs.readFileSync(f));
      h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) {
        const v = (png.data[i * 4] << 16) | (png.data[i * 4 + 1] << 8) | png.data[i * 4 + 2];
        h[i] = v === 0x800000 ? NaN : v < 0x800000 ? v * 0.01 : (v - 0x1000000) * 0.01;
      }
    }
    cache.set(key, h);
    return h;
  };
  const px = (gx, gy) => {
    const t = tile(Math.floor(gx / 256), Math.floor(gy / 256));
    return t ? t[(gy & 255) * 256 + (gx & 255)] : NaN;
  };
  return (lon, lat) => {
    // pixel centres sit at +0.5
    const [fx, fy] = worldPx(lon, lat, src.zoom).map((v) => v - 0.5);
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    const a = px(x, y), b = px(x + 1, y), c = px(x, y + 1), d = px(x + 1, y + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// The land around an area: a coarse height grid from the backdrop DEM tiles (the sea, which has no data, is 0).
export function buildBackdropGrid(dir, proj, { minX, maxX, minZ, maxZ }, step, zoom) {
  const sample = demSource(dir, { id: 'backdrop', zoom });
  const w = Math.floor((maxX - minX) / step) + 1, h = Math.floor((maxZ - minZ) / step) + 1, data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = sample(...proj.unproject(minX + i * step, minZ + j * step));
    data[j * w + i] = Number.isNaN(v) ? 0 : v;
  }
  return { x0: minX, z0: minZ, step, w, h, data };
}

// Builds a height grid covering [minX, maxX] x [minZ, maxZ] at `step` metres.
// Gaps in the 5 m DEM fall back to the 10 m DEM, then to a diffusion fill from neighbours.
export function buildHeightGrid(dir, proj, { minX, maxX, minZ, maxZ }, step) {
  const samplers = DEM_SOURCES.map((s) => demSource(dir, s));
  const w = Math.floor((maxX - minX) / step) + 1, h = Math.floor((maxZ - minZ) / step) + 1;
  const data = new Float32Array(w * h);
  let fallback = 0, holes = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const [lon, lat] = proj.unproject(minX + i * step, minZ + j * step);
      let v = samplers[0](lon, lat);
      if (Number.isNaN(v)) { v = samplers[1](lon, lat); fallback++; }
      if (Number.isNaN(v)) holes++;
      data[j * w + i] = v;
    }
  if (holes) fillHoles(data, w, h);
  return { x0: minX, z0: minZ, step, w, h, data, stats: { fallback, holes } };
}

function fillHoles(data, w, h) {
  const missing = [];
  for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) missing.push(i);
  if (missing.length === data.length) { data.fill(0); return; }
  // Grow known values into the gaps, one ring of cells per pass.
  let todo = missing;
  while (todo.length) {
    const next = [], updates = [];
    for (const i of todo) {
      const x = i % w, y = (i - x) / w;
      let s = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = data[yy * w + xx];
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n) updates.push([i, s / n]); else next.push(i);
    }
    for (const [i, v] of updates) data[i] = v;
    todo = next;
  }
}
