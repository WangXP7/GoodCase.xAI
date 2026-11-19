// Fetches, decodes and meshes tiles off the main thread.
import { decodeTile } from '../shared/tileformat.js';
import { buildTile } from './meshing.js';
import { makeSurface } from '../shared/decks.js';

let grid = null, surface = null, marks = [];

// All typed arrays in a result, so they are transferred rather than copied.
function buffers(o, out = []) {
  for (const v of Object.values(o)) {
    if (ArrayBuffer.isView(v)) out.push(v.buffer);
    else if (v && typeof v === 'object') buffers(v, out);
  }
  return out;
}

// Static mesh of a tile (PLATEAU models; format: encodeMesh in tools/pipeline/meshes.mjs) -> flat-shaded arrays.
async function models(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer(), n = new DataView(buf).getUint32(0, true);
  const position = new Float32Array(buf.slice(4, 4 + n * 12)), rgb = new Uint8Array(buf, 4 + n * 12, n * 3);
  const normal = new Float32Array(n * 3), color = new Float32Array(n * 3);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  for (let i = 0; i < n * 3; i++) color[i] = lin(rgb[i] / 255);
  for (let i = 0; i < n * 3; i += 9) {
    const ux = position[i + 3] - position[i], uy = position[i + 4] - position[i + 1], uz = position[i + 5] - position[i + 2];
    const vx = position[i + 6] - position[i], vy = position[i + 7] - position[i + 1], vz = position[i + 8] - position[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { normal[i + k] = nx; normal[i + k + 1] = ny; normal[i + k + 2] = nz; }
  }
  return { position, normal, color };
}

self.onmessage = async ({ data: m }) => {
  if (m.type === 'init') {
    grid = { ...m.grid, data: new Float32Array(m.grid.data) };
    surface = makeSurface(grid, m.decks);
    marks = m.marks ?? [];
    return;
  }
  if (m.type === 'tile') {
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tile = decodeTile(await res.arrayBuffer());
      const mesh = buildTile(tile, grid, m.tileSize, surface, marks);
      if (m.meshUrl) mesh.models = await models(m.meshUrl);
      self.postMessage({ type: 'tile', key: m.key, mesh }, buffers(mesh));
    } catch (e) {
      self.postMessage({ type: 'error', key: m.key, message: e.message });
    }
  }
};
