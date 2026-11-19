// Geometric regressions: compare triangle interiors, not just heights at the source vertices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AREA, PROP, DECAL, decodeTile } from '../../src/shared/tileformat.js';
import { makeSurface } from '../../src/shared/decks.js';
import { roadMesh, terrainMesh } from '../../src/world/meshing.js';
import { createDraper } from '../../src/world/drape.js';
import { decalMesh, DECAL_COLS, DECAL_ROWS } from '../../src/world/decals.js';
import { ROOT } from '../pipeline/config.mjs';

const paint = (a) => a.kind === AREA.MARK_WHITE || a.kind === AREA.MARK_YELLOW;
const asphalt = (a) => a.kind === AREA.ROAD || a.kind === AREA.CARRIAGEWAY || a.kind === AREA.PARKING;
const area = (kind, points) => ({ kind, code: 0, polygons: [[Float32Array.from(points.flat())]] });
const rect = (kind, x0, z0, x1, z1) => area(kind, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);

// Independent vertical ray/triangle intersection with a small spatial index.
function heightAt(mesh) {
  const p = mesh.position, cells = new Map(), step = 8;
  for (let i = 0; i < p.length; i += 9) {
    const x0 = Math.min(p[i], p[i + 3], p[i + 6]), x1 = Math.max(p[i], p[i + 3], p[i + 6]);
    const z0 = Math.min(p[i + 2], p[i + 5], p[i + 8]), z1 = Math.max(p[i + 2], p[i + 5], p[i + 8]);
    for (let x = Math.floor(x0 / step); x <= Math.floor(x1 / step); x++)
      for (let z = Math.floor(z0 / step); z <= Math.floor(z1 / step); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
  }
  return (x, z) => {
    let y = -Infinity;
    for (const i of cells.get(`${Math.floor(x / step)},${Math.floor(z / step)}`) ?? []) {
      const ax = p[i], az = p[i + 2], bx = p[i + 3] - ax, bz = p[i + 5] - az;
      const cx = p[i + 6] - ax, cz = p[i + 8] - az, det = bx * cz - bz * cx;
      if (Math.abs(det) < 1e-10) continue;
      const u = ((x - ax) * cz - (z - az) * cx) / det;
      const v = (bx * (z - az) - bz * (x - ax)) / det;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) y = Math.max(y, p[i + 1] * (1 - u - v) + p[i + 4] * u + p[i + 7] * v);
    }
    return y;
  };
}

const samples = [[1 / 3, 1 / 3], [0.1, 0.1], [0.8, 0.1], [0.1, 0.8], [0.45, 0.1], [0.45, 0.45], [0.1, 0.45]];
function clearance(mesh, below, minimum, label) {
  let checked = 0;
  const p = mesh.position;
  for (let i = 0; i < p.length; i += 9) for (const [u, v] of samples) {
    const at = (k) => p[i + k] * (1 - u - v) + p[i + k + 3] * u + p[i + k + 6] * v;
    const y = below(at(0), at(2));
    if (!Number.isFinite(y)) continue;
    assert.ok(at(1) - y >= minimum - 0.002, `${label}: clearance ${(at(1) - y).toFixed(4)} at ${at(0)},${at(2)}`);
    checked++;
  }
  return checked;
}

const grid = { x0: -30, z0: -30, step: 5, w: 70, h: 70 };
grid.data = Float32Array.from({ length: grid.w * grid.h }, (_, i) => {
  const x = i % grid.w, z = Math.floor(i / grid.w);
  return 12 + 4 * Math.sin(x * 1.7) + 3 * Math.cos(z * 1.3); // crests, dips and cross-slopes
});
for (const [label, decks] of [
  ['hilly terrain', []],
  ['bridge and approaches', [{ pts: [-20, 25, 0, 0, 28, 0, 24, 26, 0], half: 4 }]],
]) {
  const surface = makeSurface(grid, decks), drape = createDraper(grid, surface);
  const road = roadMesh([rect(AREA.ROAD, -24, -24, 30, 30), rect(AREA.CARRIAGEWAY, -22, -22, 28, 28)], grid, surface);
  const below = heightAt(road);
  const marks = roadMesh([
    rect(AREA.MARK_WHITE, -18, -12, 24, -11.5),
    area(AREA.MARK_YELLOW, [[-19, -15], [-18.5, -15], [23, 18.5], [23, 19]]),
    ...Array.from({ length: 9 }, (_, i) => rect(AREA.MARK_WHITE, -3 + i, -5, -2.5 + i, 5)),
  ], grid, surface);
  assert.ok(clearance(marks, below, 0.09, label) > 500);
  const props = Object.values(DECAL).map((variant) => ({ kind: PROP.DECAL, variant, x: variant - 5, z: 3, rot: variant * 0.37, scale: 1 }));
  const decals = decalMesh(props, drape);
  assert.ok(clearance(decals, below, 0.11, `${label} symbols`) > 300);
  console.log(`ok   ${label}: lines, crossings and every symbol stay above asphalt`);
}

// Separate calls/tile owners must agree, including negative coordinates and a 256 m tile boundary.
{
  const surface = makeSurface(grid, []);
  for (const x of [-0.8, 255.2]) {
    const road = roadMesh([rect(AREA.CARRIAGEWAY, x - 3, 0, x + 4, 12)], grid, surface);
    const marks = roadMesh([rect(AREA.MARK_WHITE, x, 1, x + 1.6, 11)], grid, surface);
    assert.ok(clearance(marks, heightAt(road), 0.09, 'tile boundary') > 30);
  }
  const terrain = terrainMesh(grid, 0, 0, 256);
  const flat = { position: Float32Array.from(Array.from(terrain.index).flatMap((i) => Array.from(terrain.position.slice(i * 3, i * 3 + 3)))) };
  const road = roadMesh([rect(AREA.CARRIAGEWAY, 1, 1, 30, 30)], grid, surface);
  assert.ok(clearance(road, heightAt(flat), 0.06, 'road over terrain') > 100);
  console.log('ok   tile boundaries and road/terrain alignment');
}

// Clipping must retain holes, winding, painted area, and the symbol atlas mapping.
{
  const flatGrid = { x0: -20, z0: -20, step: 5, w: 10, h: 10, data: new Float32Array(100) };
  const drape = createDraper(flatGrid, () => 0);
  const outer = rect(AREA.MARK_WHITE, -10, -10, 10, 10);
  outer.polygons[0].push(Float32Array.from([-2, -2, 2, -2, 2, 2, -2, 2]));
  const mesh = roadMesh([outer], flatGrid, () => 0);
  assert.equal(heightAt(mesh)(0, 0), -Infinity);
  const projectedArea = (p) => {
    let total = 0;
    for (let i = 0; i < p.length; i += 9) {
      const cross = (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]);
      assert.ok(cross <= 1e-7, 'triangles face upwards');
      total -= cross / 2;
    }
    return total;
  };
  assert.ok(Math.abs(projectedArea(mesh.position) - 384) < 0.001);
  const variant = DECAL.STOP, symbol = decalMesh([{ kind: PROP.DECAL, variant, x: 0, z: 0, rot: 0 }], drape);
  assert.ok(Math.abs(projectedArea(symbol.position) - 1.6 * 5.4) < 0.001);
  for (let i = 0; i < symbol.uv.length / 2; i++) {
    const x = symbol.position[i * 3], z = symbol.position[i * 3 + 2];
    assert.ok(Math.abs(symbol.uv[i * 2] - ((variant % DECAL_COLS) + 0.5 - x / 1.6) / DECAL_COLS) < 1e-6);
    assert.ok(Math.abs(symbol.uv[i * 2 + 1] - (1 - (Math.floor(variant / DECAL_COLS) + 0.5 - z / 5.4) / DECAL_ROWS)) < 1e-6);
  }
  console.log('ok   holes, winding, coverage and symbol UVs');
}

// Exercise real compiled data when present. --all checks every compiled tile.
for (const id of ['shibuya', 'tokyo', 'shiba']) {
  const base = path.join(ROOT, 'public/tiles', id), manifestFile = path.join(base, 'manifest.json');
  if (!fs.existsSync(manifestFile)) { console.log(`skip ${id} (no compiled tiles)`); continue; }
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const bytes = fs.readFileSync(path.join(base, m.terrain.file));
  const g = { ...m.terrain, data: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
  const surface = makeSurface(g, m.decks ?? []);
  let checked = 0, tiles = 0;
  for (const entry of m.tiles) {
    if (!process.argv.includes('--all') && (Math.abs(entry.x) > 1 || Math.abs(entry.z) > 1)) continue;
    const tile = decodeTile(Uint8Array.from(fs.readFileSync(path.join(base, entry.file))).buffer);
    const below = heightAt(roadMesh(tile.areas.filter(asphalt), g, surface));
    checked += clearance(roadMesh(tile.areas.filter(paint), g, surface), below, 0.09, `${id}/${entry.file}`);
    checked += clearance(decalMesh(tile.props, createDraper(g, surface)), below, 0.11, `${id}/${entry.file} symbols`);
    tiles++;
  }
  assert.ok(checked > 0);
  console.log(`ok   ${id}: ${checked} paint/asphalt intersections across ${tiles} tiles`);
}
