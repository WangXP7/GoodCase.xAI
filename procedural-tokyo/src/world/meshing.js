// Tile meshing: decoded tile + terrain grid -> typed arrays for three.js BufferGeometry.
// Pure functions with no three.js dependency, so they run in the tile worker (and in Node tests).
import earcut from 'earcut';
import { AREA, SPORT, BARRIER, MATERIAL, BFLAG } from '../shared/tileformat.js';
import { sampleGrid } from '../shared/terrain.js';
import { KIND, CAT, WALL, GROUND } from './constants.js';
import { buildTower } from './tower.js';
import { createDraper } from './drape.js';
import { decalMesh } from './decals.js';

// ---------------------------------------------------------------- helpers
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (rgb) => rgb.map(srgbToLinear);

function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Buf {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  push(...v) {
    if (this.n + v.length > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length)); b.set(this.a); this.a = b; }
    for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i];
  }
  get length() { return this.n; }
  done() { return this.a.slice(0, this.n); }
}

function groundNormal(grid, x, z) {
  const e = grid.step;
  const dx = (sampleGrid(grid, x + e, z) - sampleGrid(grid, x - e, z)) / (2 * e);
  const dz = (sampleGrid(grid, x, z + e) - sampleGrid(grid, x, z - e)) / (2 * e);
  const l = Math.hypot(dx, 1, dz);
  return [-dx / l, 1 / l, -dz / l];
}

// Triangulates rings of Float32Array [x, z, ...] -> list of triangles [[x, z] x 3], counter-clockwise from above.
function triangulate(rings) {
  const flat = [], holes = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holes.push(flat.length / 2);
    for (const v of rings[r]) flat.push(v);
  }
  const idx = earcut(flat, holes, 2), tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = [flat[idx[i] * 2], flat[idx[i] * 2 + 1]], b = [flat[idx[i + 1] * 2], flat[idx[i + 1] * 2 + 1]], c = [flat[idx[i + 2] * 2], flat[idx[i + 2] * 2 + 1]];
    // counter-clockwise seen from above (x east, -z north) <=> (b - a) x (c - a) < 0 in x/z
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    tris.push(cross < 0 ? [a, b, c] : [a, c, b]);
  }
  return tris;
}

// ---------------------------------------------------------------- terrain
export function terrainMesh(grid, tx, tz, tileSize) {
  const seg = Math.ceil(tileSize / grid.step), n = seg + 1, d = tileSize / seg;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), idx = new Uint16Array(seg * seg * 6);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = tx * tileSize + i * d, z = tz * tileSize + j * d, k = (j * n + i) * 3;
      pos[k] = x; pos[k + 1] = sampleGrid(grid, x, z); pos[k + 2] = z;
      const [nx, ny, nz] = groundNormal(grid, x, z);
      nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
    }
  let o = 0;
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, e = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = e;
    }
  return { position: pos, normal: nor, index: idx };
}

// ---------------------------------------------------------------- road surfaces
// Lifted above the terrain by kind so detailed areas draw over the plain road outline; sidewalks and
// islands stand a kerb's height above the carriageway. Colours tint the ground textures.
const ROAD_STYLE = {
  [AREA.ROAD]: { lift: 0.04, color: lin([0.4, 0.4, 0.41]), layer: GROUND.ASPHALT },
  [AREA.CARRIAGEWAY]: { lift: 0.06, color: lin([0.36, 0.36, 0.38]), layer: GROUND.ASPHALT },
  [AREA.SIDEWALK]: { lift: 0.2, color: lin([0.63, 0.61, 0.58]), layer: GROUND.PAVERS, kerb: true },
  [AREA.ISLAND]: { lift: 0.22, color: lin([0.36, 0.47, 0.27]), layer: GROUND.GRASS, kerb: true },
  [AREA.OTHER]: { lift: 0.05, color: lin([0.45, 0.45, 0.45]), layer: GROUND.CONCRETE },
  [AREA.PARK]: { lift: 0.02, color: lin([0.4, 0.5, 0.28]), layer: GROUND.GRASS },
  [AREA.WOOD]: { lift: 0.02, color: lin([0.3, 0.4, 0.23]), layer: GROUND.GRASS },
  [AREA.PITCH]: { lift: 0.025, color: lin([0.63, 0.56, 0.43]), layer: GROUND.CONCRETE },
  [AREA.WATER]: { lift: 0.08, color: lin([0.12, 0.27, 0.35]), layer: GROUND.WATER },
  [AREA.MARK_WHITE]: { lift: 0.15, color: lin([0.9, 0.9, 0.87]), layer: GROUND.CONCRETE },
  [AREA.MARK_YELLOW]: { lift: 0.15, color: lin([0.88, 0.66, 0.12]), layer: GROUND.CONCRETE },
  [AREA.PATH]: { lift: 0.035, color: lin([0.7, 0.68, 0.63]), layer: GROUND.CONCRETE },
  [AREA.STEPS]: { lift: 0.05, color: lin([0.6, 0.6, 0.58]), layer: GROUND.PAVERS },
  [AREA.PARKING]: { lift: 0.03, color: lin([0.36, 0.36, 0.37]), layer: GROUND.ASPHALT },
  [AREA.TACTILE]: { lift: 0.24, color: lin([0.92, 0.74, 0.1]), layer: GROUND.PAVERS },   // on top of the sidewalk
  [AREA.POOL]: { lift: 0.06, color: lin([0.3, 0.62, 0.74]), layer: GROUND.WATER },
  [AREA.PLAZA]: { lift: 0.21, color: lin([0.66, 0.64, 0.6]), layer: GROUND.PAVERS },
};
// variants selected by the area's code
const UNPAVED_PATH = { lift: 0.035, color: lin([0.62, 0.55, 0.42]), layer: GROUND.CONCRETE };
const COURTS = {
  [SPORT.TENNIS]: { lift: 0.03, color: lin([0.22, 0.42, 0.36]), layer: GROUND.CONCRETE },
  [SPORT.TURF]: { lift: 0.03, color: lin([0.3, 0.5, 0.25]), layer: GROUND.GRASS },
  [SPORT.DIRT]: { lift: 0.03, color: lin([0.6, 0.48, 0.34]), layer: GROUND.CONCRETE },
};
const styleOf = (a) => (a.kind === AREA.PITCH && COURTS[a.code]) || (a.kind === AREA.PATH && a.code === 1 && UNPAVED_PATH) || ROAD_STYLE[a.kind] || ROAD_STYLE[AREA.OTHER];
// barriers: [height, width (0 = a thin panel), colour, layer]
const BARRIERS = {
  [BARRIER.FENCE]: [1.3, 0, lin([0.5, 0.52, 0.53]), GROUND.CONCRETE],
  [BARRIER.WALL]: [1.8, 0.2, lin([0.72, 0.71, 0.68]), GROUND.CONCRETE],
  [BARRIER.RETAINING]: [2.2, 0.3, lin([0.6, 0.6, 0.58]), GROUND.CONCRETE],
  [BARRIER.HEDGE]: [1.3, 0.8, lin([0.22, 0.36, 0.17]), GROUND.GRASS],
  [BARRIER.GUARD_RAIL]: [0.8, 0, lin([0.86, 0.86, 0.84]), GROUND.CONCRETE],
};
const isPaint = (a) => a.kind === AREA.MARK_WHITE || a.kind === AREA.MARK_YELLOW;
const KERB = { color: lin([0.68, 0.68, 0.66]), layer: GROUND.CONCRETE, foot: 0.03 };
// Maximum segment length for vertical walls (ground layers use the shared terrain triangulation).
const DRAPE_EDGE = 6;

// surface(x, z, deck): the height roads lie on — the terrain, or a bridge deck (src/shared/decks.js).
// walls: bridge parapets as rows of [x1, z1, x2, z2, deck].
export function roadMesh(areas, grid, surface, walls = [], drape = createDraper(grid, surface)) {
  const pos = new Buf(), nor = new Buf(), col = new Buf(), lay = new Buf();
  let deck = -1; // deck of the parapet being meshed
  const emit = (p, style) => {
    const y = drape.height(p[0], p[1]) + style.lift;
    pos.push(p[0], y, p[1]); nor.push(...groundNormal(grid, p[0], p[1])); col.push(...style.color); lay.push(style.layer);
  };
  // Vertical walls are independent of the ground-layer triangulation.
  const long = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > DRAPE_EDGE * DRAPE_EDGE;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  // Vertical kerb face; its caller splits it at the same boundaries as the sidewalk above it.
  const kerb = (x0, z0, x1, z1, lift) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-8) return;
    const n = [-(z1 - z0) / len, 0, (x1 - x0) / len];
    const ga = drape.height(x0, z0), gb = drape.height(x1, z1);
    const quad = [[x0, ga + KERB.foot, z0], [x1, gb + KERB.foot, z1], [x1, gb + lift, z1], [x0, ga + KERB.foot, z0], [x1, gb + lift, z1], [x0, ga + lift, z0]];
    for (const p of quad) { pos.push(...p); nor.push(...n); col.push(...KERB.color); lay.push(KERB.layer); }
  };
  // Bridge parapet: a wall from below the deck to a metre above it, visible from both sides.
  const parapet = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (long([x0, z0], [x1, z1])) { const [mx, mz] = mid([x0, z0], [x1, z1]); parapet(x0, z0, mx, mz); parapet(mx, mz, x1, z1); return; }
    const n = [-(z1 - z0) / len, 0, (x1 - x0) / len], ya = surface(x0, z0, deck), yb = surface(x1, z1, deck);
    const a = [x0, ya - 1.7, z0], b = [x1, yb - 1.7, z1], c = [x1, yb + 1.05, z1], d = [x0, ya + 1.05, z0];
    for (const [quad, sign] of [[[a, b, c, a, c, d], 1], [[b, a, d, b, d, c], -1]])
      for (const p of quad) { pos.push(...p); nor.push(n[0] * sign, 0, n[2] * sign); col.push(...KERB.color); lay.push(KERB.layer); }
  };
  // A barrier standing on the ground: a thin panel seen from both sides, or a box with a top for hedges and walls.
  const barrier = (x0, z0, x1, z1, type) => {
    if (long([x0, z0], [x1, z1])) { const [mx, mz] = mid([x0, z0], [x1, z1]); barrier(x0, z0, mx, mz, type); barrier(mx, mz, x1, z1, type); return; }
    const [h, w, color, layer] = BARRIERS[type] ?? BARRIERS[BARRIER.FENCE];
    const len = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    const face = (ox, oz, sign) => {
      const ax = x0 + nx * ox, az = z0 + nz * oz, bx = x1 + nx * ox, bz = z1 + nz * oz, ya = sampleGrid(grid, x0, z0), yb = sampleGrid(grid, x1, z1);
      const a = [ax, ya - 0.2, az], b = [bx, yb - 0.2, bz], c = [bx, yb + h, bz], d = [ax, ya + h, az];
      for (const p of sign > 0 ? [a, b, c, a, c, d] : [b, a, d, b, d, c]) { pos.push(...p); nor.push(nx * sign, 0, nz * sign); col.push(...color); lay.push(layer); }
      return [d, c];
    };
    const [d1, c1] = face(w / 2, w / 2, 1), [d2, c2] = face(-w / 2, -w / 2, -1);
    if (w) for (const p of [d2, c2, c1, d2, c1, d1]) { pos.push(...p); nor.push(0, 1, 0); col.push(...color); lay.push(layer); }
  };
  for (let i = 0; i < walls.length; i += 5) {
    deck = walls[i + 4];
    if (deck < 0) barrier(walls[i], walls[i + 1], walls[i + 2], walls[i + 3], -deck);
    else parapet(walls[i], walls[i + 1], walls[i + 2], walls[i + 3]);
  }
  for (const a of areas) {
    const style = styleOf(a);
    for (const rings of a.polygons) {
      for (const [p, q, r] of triangulate(rings)) drape.triangle(p, q, r, (a, b, c) => {
        emit(a, style); emit(b, style); emit(c, style);
      });
      if (style.kerb) for (const ring of rings) {
        const n = ring.length / 2;
        for (let k = 0; k < n; k++) drape.segment(
          [ring[k * 2], ring[k * 2 + 1]], [ring[((k + 1) % n) * 2], ring[((k + 1) % n) * 2 + 1]],
          (a, b) => kerb(a[0], a[1], b[0], b[1], style.lift));
      }
    }
  }
  return { position: pos.done(), normal: nor.done(), color: col.done(), aLayer: lay.done() };
}

// ---------------------------------------------------------------- buildings
// PLATEAU usage code -> facade category.
function category(usage, height, seed) {
  if (usage === 411 || usage === 415) return CAT.HOUSE;
  if (usage === 412) return CAT.APARTMENT;
  if (usage === 413 || usage === 414) return CAT.MIXED;
  if (usage >= 401 && usage <= 404) return height > 45 || (height > 24 && seed < 0.25) ? CAT.GLASS : CAT.COMMERCIAL;
  if (usage >= 421 && usage <= 454) return CAT.PUBLIC;
  // unknown (461): low buildings read as houses, taller ones as apartments or offices
  return height < 9 ? CAT.HOUSE : seed < 0.5 ? CAT.APARTMENT : CAT.COMMERCIAL;
}

// Tokyo wall finishes per category: [r, g, b, texture layer].
const PALETTE = {
  [CAT.HOUSE]: [
    [0.86, 0.83, 0.75, WALL.PLASTER], [0.9, 0.9, 0.87, WALL.PLASTER], [0.5, 0.4, 0.33, WALL.BRICK], [0.66, 0.66, 0.65, WALL.SIDING],
    [0.3, 0.33, 0.37, WALL.SIDING], [0.78, 0.72, 0.62, WALL.PLASTER], [0.82, 0.8, 0.74, WALL.SIDING], [0.42, 0.36, 0.32, WALL.SIDING],
  ],
  [CAT.APARTMENT]: [
    [0.9, 0.89, 0.85, WALL.TILE], [0.82, 0.77, 0.68, WALL.TILE], [0.55, 0.4, 0.31, WALL.BRICK], [0.72, 0.72, 0.7, WALL.PLASTER],
    [0.76, 0.66, 0.55, WALL.TILE], [0.62, 0.48, 0.38, WALL.BRICK],
  ],
  [CAT.MIXED]: [[0.84, 0.82, 0.78, WALL.TILE], [0.6, 0.45, 0.36, WALL.BRICK], [0.72, 0.72, 0.71, WALL.CONCRETE], [0.88, 0.84, 0.74, WALL.TILE]],
  [CAT.COMMERCIAL]: [
    [0.68, 0.69, 0.7, WALL.CONCRETE], [0.86, 0.86, 0.84, WALL.TILE], [0.76, 0.71, 0.63, WALL.TILE], [0.34, 0.35, 0.37, WALL.CONCRETE],
    [0.56, 0.57, 0.59, WALL.CONCRETE], [0.8, 0.8, 0.79, WALL.PLASTER],
  ],
  [CAT.PUBLIC]: [[0.78, 0.76, 0.72, WALL.TILE], [0.64, 0.64, 0.62, WALL.CONCRETE], [0.7, 0.62, 0.54, WALL.BRICK]],
  [CAT.GLASS]: [[0.5, 0.53, 0.56, WALL.CONCRETE], [0.62, 0.63, 0.64, WALL.CONCRETE], [0.32, 0.35, 0.38, WALL.CONCRETE]],
};
// Metal and tile roofs on houses.
const PITCHED_ROOFS = [[0.2, 0.21, 0.23], [0.22, 0.28, 0.36], [0.3, 0.22, 0.18], [0.42, 0.25, 0.2], [0.2, 0.28, 0.25], [0.34, 0.34, 0.35]];
// Window bay width (m) per category; a whole number of bays is fitted to each wall.
const BAY = { [CAT.HOUSE]: 3.4, [CAT.APARTMENT]: 3.3, [CAT.MIXED]: 3.2, [CAT.COMMERCIAL]: 3.0, [CAT.PUBLIC]: 3.4, [CAT.GLASS]: 1.5 };
const HINT_LAYER = { [MATERIAL.TILE]: WALL.TILE, [MATERIAL.CONCRETE]: WALL.CONCRETE, [MATERIAL.PLASTER]: WALL.PLASTER, [MATERIAL.BRICK]: WALL.BRICK, [MATERIAL.METAL]: WALL.SIDING };
const SINK = 4; // walls run this far below the base so they meet sloping ground

// Where PLATEAU has photographs, a building takes its colour from them: seen from the air that is a cool grey,
// of middling brightness and little colour (measured: about sRGB 125, 138, 146). A building without photographs
// takes its colour from the palette above, which is brighter and warmer — the two met at a line across the city.
// A generated colour is brought most of the way to the photographed city's: its brightness into the same
// range, its hue towards the same cool grey, some of its own character left.
const AERIAL = 0.72;
const aerial = (c) => {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], to = 0.41 + 0.24 * Math.min(1, Math.max(0, (l - 0.3) / 0.6)), k = to / Math.max(l, 0.05);
  const grey = [to * 0.93, to * 1.02, to * 1.08];
  return c.map((v, i) => v * k + (grey[i] - v * k) * AERIAL);
};

// A colour a mapper gave a building (OSM building:colour) is a word as often as a measurement: "red" comes as
// pure signal red, which no wall is. It is read as the paint of that name: its colour kept, but no more
// saturated and no brighter than paint on a wall in daylight.
const paint = (c) => {
  const top = Math.max(...c), low = Math.min(...c), sat = top ? (top - low) / top : 0, keep = sat > 0.55 ? 0.55 / sat : 1, to = Math.min(top, 0.72);
  return c.map((v) => (top ? (top - (top - v) * keep) * (to / top) : v));
};

const ringArea = (r) => { let s = 0; for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n; s += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1]; } return s / 2; };

function insideRings(x, z, rings) {
  let inside = false;
  for (const r of rings) for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function edgeDistance(x, z, rings) {
  let best = Infinity;
  for (const r of rings) for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], dx = r[j * 2] - ax, dz = r[j * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// Smallest rectangle around a ring, aligned to one of its edges:
// { cx, cz, ax, az (unit long axis), a, b (half lengths, a >= b) }.
function minAreaRect(r) {
  const n = r.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = r[j * 2] - r[i * 2], dz = r[j * 2 + 1] - r[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    dx /= len; dz /= len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = r[k * 2] * dx + r[k * 2 + 1] * dz, v = -r[k * 2] * dz + r[k * 2 + 1] * dx;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, dx, dz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { dx, dz, u0, u1, v0, v1 } = best, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cx = uc * dx - vc * dz, cz = uc * dz + vc * dx, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
  return hu >= hv ? { cx, cz, ax: dx, az: dz, a: hu, b: hv, area: best.area } : { cx, cz, ax: -dz, az: dx, a: hv, b: hu, area: best.area };
}

// marks: [x, z] of points inside the landmarks (landmarks.js): their buildings are flagged (aMark) for the
// abstract model.
export function buildingMesh(buildings, tx, tz, marks = []) {
  // a mark is its building's if it lies inside it; one that lies in none (a courtyard, a point a little off) goes
  // to the nearest building within 30 m
  const marked = new Set();
  for (const [x, z] of marks) {
    let hit = buildings.findIndex((b) => b.polygons.some((rings) => insideRings(x, z, rings)));
    if (hit < 0) {
      let best = 30;
      buildings.forEach((b, i) => { const r = b.polygons[0][0]; for (let k = 0; k < r.length; k += 2) { const d = Math.hypot(r[k] - x, r[k + 1] - z); if (d < best) { best = d; hit = i; } } });
    }
    if (hit >= 0) marked.add(hit);
  }
  const mrk = new Buf(1 << 14);
  const pos = new Buf(1 << 16), nor = new Buf(1 << 16), col = new Buf(1 << 16), fac = new Buf(1 << 16), bld = new Buf(1 << 16), pho = new Buf(1 << 15);
  let pu = -1, pv = -1; // photo coordinates of the vertices being added (-1: none)
  const ends = new Buf(1 << 12);
  const photo = { pos: new Buf(1 << 12), nor: new Buf(1 << 12), uv: new Buf(1 << 12), mark: new Buf(1 << 10) }; // roofs with an aerial photo

  buildings.forEach((b, i) => {
    let k = 0;
    const mark = marked.has(i) ? 1 : 0; // a landmark
    const rnd = () => hash3(i * 31 + k++, tx * 13 + 5, tz * 17 + 3);
    const seed = Math.floor(hash3(tx, tz, i) * 4096) / 4096; // quantised: the shader hashes it per room
    // OSM's building:material / building:colour, where mapped, replace the generated finish
    const material = (b.hint >>> 24) & 15, painted = b.hint >>> 31;
    // A tall tower that PLATEAU gives a detailed shell but no photographs is a recent one (modelled from its
    // plans): a curtain wall of dark glass, whatever it is used for, with a plain dark roof.
    // (how tall is taken from the shell itself: the height on record is not always that of the whole tower)
    const shellTop = (list) => { let y = -Infinity; for (const f of list) for (let k = 1; k < f.rings[0].length; k += 3) y = Math.max(y, f.rings[0][k]); return y; };
    const glassTower = !!b.surfaces?.length && !b.surfaces.some((f) => f.uv) && Math.max(b.height, shellTop(b.surfaces) - b.base) > 90;
    const cat = material === MATERIAL.GLASS || glassTower ? CAT.GLASS : category(b.usage, b.height, seed);
    const pal = PALETTE[cat], pick = pal[Math.floor(rnd() * pal.length)], tone = 0.92 + 0.16 * rnd();
    const wallCol = glassTower ? lin([0.3, 0.35, 0.41].map((c) => c * tone)) : painted ? lin(b.surfaces?.some((f) => f.uv) ? [((b.hint >> 16) & 255) / 255, ((b.hint >> 8) & 255) / 255, (b.hint & 255) / 255] : paint([((b.hint >> 16) & 255) / 255, ((b.hint >> 8) & 255) / 255, (b.hint & 255) / 255])) : lin(aerial(pick.slice(0, 3)).map((c) => Math.min(1, c * tone)));
    const wallLayer = HINT_LAYER[material] ?? pick[3];
    const top = b.base + b.height, bottom = b.base - SINK;
    const outer = b.polygons[0][0];
    const area = b.polygons.reduce((s, rings) => s + rings.reduce((t, r) => t + ringArea(r), 0), 0);

    // Houses with a simple footprint get a pitched roof; everything else a flat roof with a parapet.
    let roof = null, rise = 0;
    if (cat === CAT.HOUSE && b.height < 13 && b.polygons.length === 1 && b.polygons[0].length === 1) {
      const rect = minAreaRect(outer);
      if (rect && area / rect.area > 0.78 && rect.b > 1.8) {
        rise = Math.min(2.6, rect.b * 0.5, b.height - 2.4);
        if (rise > 0.7) roof = rect;
      }
    }
    const wallTop = roof ? top - rise : top;
    let wallH = wallTop - b.base; // (per wall for LOD2 shells)
    const parapet = roof ? 0 : cat === CAT.HOUSE ? 0.3 : b.height > 30 ? 1.2 : 0.75;
    const floors = b.storeys > 0 ? b.storeys : Math.max(1, Math.round(wallH / 3.2));
    const floorH = Math.min(6, Math.max(2.5, wallH / floors));

    // One vertex. (u, v) feed the window grid; kind / bay / layer select the shading (see materials.js).
    const vtx = (x, y, z, n, c, u, v, kind, bay, layer) => {
      pos.push(x, y, z); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]);
      fac.push(u, v, floorH, seed); bld.push(wallH, cat + 8 * layer, kind, bay); pho.push(pu, pv); mrk.push(mark);
    };
    // Triangle and quad with the winding chosen to face `ref`.
    const tri = (p, q, r, ref, c, kind, layer) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) { [q, r] = [r, q]; n = [-n[0], -n[1], -n[2]]; }
      for (const s of [p, q, r]) vtx(s[0], s[1], s[2], n, c, 0, s[1] - b.base, kind, 0, layer);
    };
    const quad = (p, q, r, s, ref, c, kind, layer) => { tri(p, q, r, ref, c, kind, layer); tri(p, r, s, ref, c, kind, layer); };
    // Box sitting on y0, aligned to (dx, dz), without a bottom face.
    const box = (cx, cz, y0, y1, hx, hz, dx, dz, c, layer) => {
      const P = (sx, sz, y) => [cx + dx * hx * sx - dz * hz * sz, y, cz + dz * hx * sx + dx * hz * sz];
      quad(P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), [0, 1, 0], c, KIND.SOLID, layer);
      quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), [dz, 0, -dx], c, KIND.SOLID, layer);
      quad(P(-1, 1, y0), P(1, 1, y0), P(1, 1, y1), P(-1, 1, y1), [-dz, 0, dx], c, KIND.SOLID, layer);
      quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), [dx, 0, dz], c, KIND.SOLID, layer);
      quad(P(-1, -1, y0), P(-1, 1, y0), P(-1, 1, y1), P(-1, -1, y1), [-dx, 0, -dz], c, KIND.SOLID, layer);
    };

    // ---- LOD2: PLATEAU's own walls and roof planes replace everything generated below
    if (b.surfaces?.length) {
      const roofCol = lin(cat === CAT.HOUSE ? PITCHED_ROOFS[Math.floor(rnd() * PITCHED_ROOFS.length)] : [0.5, 0.5, 0.49]);
      const flatCol = lin(glassTower ? [0.36, 0.37, 0.39] : (() => { const g = 0.5 + 0.2 * rnd(); return [g, g, g * 0.97]; })());
      // A steel lattice tower is built member by member (tower.js) where the shell stands: on its axis, as
      // wide as its foot, as high as its top, and turned as its foot is turned.
      if (b.flags & BFLAG.LATTICE) {
        let lo = Infinity, hi = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, far = 0, angle = 0;
        const each = (fn) => { for (const s of b.surfaces) for (const r of s.rings) for (let i = 0; i < r.length; i += 3) fn(r[i], r[i + 1], r[i + 2]); };
        each((x, y, z) => { lo = Math.min(lo, y); hi = Math.max(hi, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
        const ax = (x0 + x1) / 2, az = (z0 + z1) / 2;
        // the farthest point of the foot is a corner of its square: the faces lie 45 degrees from it
        each((x, y, z) => { const d = Math.hypot(x - ax, z - az); if (y < lo + 4 && d > far) { far = d; angle = Math.atan2(z - az, x - ax) - Math.PI / 4; } });
        wallH = hi - lo;
        buildTower({ x: ax, z: az, y0: lo, H: hi - lo, R: far / Math.SQRT2, angle }, (p, q, r, s, n, c) => quad(p, q, r, s, n, c, KIND.LATTICE, WALL.SIDING));
        ends.push(pos.length / 3);
        return;
      }
      for (const { roof: isRoof, rings, uv } of b.surfaces) {
        // Newell normal of the outline; CityGML surfaces face outwards
        const o = rings[0], n = o.length / 3;
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, px = o[i * 3], py = o[i * 3 + 1], pz = o[i * 3 + 2], qx = o[j * 3], qy = o[j * 3 + 1], qz = o[j * 3 + 2];
          nx += (py - qy) * (pz + qz); ny += (pz - qz) * (px + qx); nz += (px - qx) * (py + qy);
        }
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-6) continue;
        nx /= nl; ny /= nl; nz /= nl;
        const steep = Math.abs(ny) < 0.5;
        // 2D frame for triangulation: (along the wall, height) for walls, the ground plan for roofs
        const hl = Math.hypot(nx, nz) || 1, tx = nz / hl, tz = -nx / hl;
        const flat = [], holes = [], verts = [];
        let s0 = Infinity, s1 = -Infinity, y1 = -Infinity, y0 = Infinity;
        rings.forEach((r, ri) => {
          if (ri) holes.push(flat.length / 2);
          for (let i = 0; i < r.length; i += 3) {
            const s = r[i] * tx + r[i + 2] * tz;
            if (steep) flat.push(s, r[i + 1]); else flat.push(r[i], r[i + 2]);
            verts.push([r[i], r[i + 1], r[i + 2], s, uv ? uv[ri][(i / 3) * 2] : 0, uv ? uv[ri][(i / 3) * 2 + 1] : 0]);
            s0 = Math.min(s0, s); s1 = Math.max(s1, s); y1 = Math.max(y1, r[i + 1]); y0 = Math.min(y0, r[i + 1]);
          }
        });
        const wall = !isRoof && steep, len = s1 - s0;
        let bays = wall && len >= 1.8 ? Math.max(1, Math.round(len / BAY[cat])) : 0, bay = bays ? len / bays : 0;
        // A wall modelled as many narrow strips (a curved tower, a facade with its piers) has no strip wide enough
        // for a window: there the bays are counted along the wall as a whole — the same measure for every strip in
        // the same plane, so the windows run on across them. (Its photograph is left out: a few texels a strip.)
        const strip = wall && len < 3 && y1 - y0 > 2.4 && b.surfaces.length > 150;
        if (strip) { bay = BAY[cat]; bays = len / bay; s0 = 0; }
        const kind = wall ? KIND.WALL : ny > 0.985 ? KIND.FLAT_ROOF : steep ? KIND.SOLID : KIND.PITCHED_ROOF;
        const color = wall || kind === KIND.SOLID ? wallCol : kind === KIND.FLAT_ROOF ? flatCol : roofCol;
        const layer = wall || kind === KIND.SOLID ? wallLayer : kind === KIND.FLAT_ROOF ? WALL.ROOF : WALL.SIDING;
        wallH = y1 - b.base; // windows stop under this wall's own top
        const idx = earcut(flat, holes, 2), N = [nx, ny, nz];
        for (let i = 0; i < idx.length; i += 3) {
          let p = verts[idx[i]], q = verts[idx[i + 1]], r = verts[idx[i + 2]];
          // keep the triangle facing the same way as the surface
          const cx = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]), cy = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
            cz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
          if (cx * nx + cy * ny + cz * nz < 0) [q, r] = [r, q];
          if (uv && isRoof) { for (const v of [p, q, r]) { photo.pos.push(v[0], v[1], v[2]); photo.nor.push(nx, ny, nz); photo.uv.push(v[4], v[5]); photo.mark.push(mark); } continue; }
          for (const v of [p, q, r]) {
            if (uv && !strip) { pu = v[4]; pv = v[5]; }
            vtx(v[0], v[1], v[2], N, color, bays ? ((v[3] - s0) / len) * bays : 0, v[1] - b.base, kind, bay, layer);
          }
          pu = pv = -1;
        }
      }
      ends.push(pos.length / 3);
      return;
    }

    // ---- walls, parapet, flat roof
    const inner = wallCol.map((c) => c * 0.8);
    const flatRoof = lin(rnd() < 0.1 ? [0.4, 0.45, 0.44] : (() => { const g = 0.46 + 0.16 * rnd(); return [g * 0.96, g, g * 1.04]; })());
    let longest = { len: 0, dx: 1, dz: 0 };
    const fronts = []; // candidate balcony edges
    for (const rings of b.polygons) {
      for (const r of rings) {
        const n = r.length / 2;
        for (let e = 0; e < n; e++) {
          const x0 = r[e * 2], z0 = r[e * 2 + 1], x1 = r[((e + 1) % n) * 2], z1 = r[((e + 1) % n) * 2 + 1];
          const len = Math.hypot(x1 - x0, z1 - z0);
          if (len < 0.05) continue;
          const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
          const nrm = [-dz, 0, dx]; // outward for CCW outlines and CW holes (see tileformat.js)
          const bays = len < 1.8 ? 0 : Math.max(1, Math.round(len / BAY[cat])), bay = bays ? len / bays : 0;
          const yT = wallTop + parapet, vT = yT - b.base;
          vtx(x0, bottom, z0, nrm, wallCol, 0, -SINK, KIND.WALL, bay, wallLayer);
          vtx(x1, bottom, z1, nrm, wallCol, bays, -SINK, KIND.WALL, bay, wallLayer);
          vtx(x1, yT, z1, nrm, wallCol, bays, vT, KIND.WALL, bay, wallLayer);
          vtx(x0, bottom, z0, nrm, wallCol, 0, -SINK, KIND.WALL, bay, wallLayer);
          vtx(x1, yT, z1, nrm, wallCol, bays, vT, KIND.WALL, bay, wallLayer);
          vtx(x0, yT, z0, nrm, wallCol, 0, vT, KIND.WALL, bay, wallLayer);
          if (parapet) quad([x0, wallTop, z0], [x1, wallTop, z1], [x1, yT, z1], [x0, yT, z0], [dz, 0, -dx], inner, KIND.SOLID, wallLayer);
          if (len > longest.len) longest = { len, dx, dz };
          if (r === rings[0] && len >= 3.5) fronts.push({ x0, z0, len, dx, dz, nrm });
        }
      }
      if (!roof) for (const [p, q, s] of triangulate(rings)) {
        for (const [x, z] of [p, q, s]) vtx(x, wallTop, z, [0, 1, 0], flatRoof, 0, wallH, KIND.FLAT_ROOF, 0, WALL.ROOF);
      }
    }

    // ---- pitched roof over the bounding rectangle: hipped or gabled
    if (roof) {
      const { cx, cz, ax, az, a, b: hb } = roof, sx = -az, sz = ax, over = 0.4;
      const c = lin(aerial(PITCHED_ROOFS[Math.floor(rnd() * PITCHED_ROOFS.length)]).map((v) => v * 0.8));
      const eave = wallTop - (over * rise) / hb;
      const corner = (sa, sb) => [cx + ax * sa * (a + over) + sx * sb * (hb + over), eave, cz + az * sa * (a + over) + sz * sb * (hb + over)];
      const hip = rnd() < 0.5 && a - hb > 0.3;
      const reach = hip ? a - hb : a + over;
      const r0 = [cx - ax * reach, top, cz - az * reach], r1 = [cx + ax * reach, top, cz + az * reach];
      const up = [0, 1, 0];
      quad(corner(-1, 1), corner(1, 1), r1, r0, up, c, KIND.PITCHED_ROOF, WALL.SIDING);
      quad(corner(1, -1), corner(-1, -1), r0, r1, up, c, KIND.PITCHED_ROOF, WALL.SIDING);
      if (hip) {
        tri(corner(1, 1), corner(1, -1), r1, up, c, KIND.PITCHED_ROOF, WALL.SIDING);
        tri(corner(-1, -1), corner(-1, 1), r0, up, c, KIND.PITCHED_ROOF, WALL.SIDING);
      } else {
        // gable walls close the triangle under the ridge
        for (const s of [-1, 1]) {
          const g = (sb) => [cx + ax * s * a + sx * sb * hb, wallTop, cz + az * s * a + sz * sb * hb];
          tri(g(-1), g(1), [cx + ax * s * a, top, cz + az * s * a], [ax * s, 0, az * s], wallCol, KIND.SOLID, wallLayer);
        }
      }
    }

    // ---- rooftop equipment on flat roofs: stair/lift housing, air conditioners, tanks, ducts
    if (!roof && area > 70 && b.height > 7) {
      const rings = b.polygons[0];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let e = 0; e < outer.length; e += 2) { x0 = Math.min(x0, outer[e]); x1 = Math.max(x1, outer[e]); z0 = Math.min(z0, outer[e + 1]); z1 = Math.max(z1, outer[e + 1]); }
      const place = (half) => {
        for (let t = 0; t < 10; t++) {
          const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
          if (insideRings(x, z, rings) && edgeDistance(x, z, rings) > half + 0.7) return [x, z];
        }
        return null;
      };
      const { dx, dz } = longest, grey = lin([0.74, 0.75, 0.75]);
      if (floors >= 4 && area > 110) {
        const hx = 1.6 + rnd() * 1.2, hz = 1.5 + rnd() * 0.8, p = place(Math.hypot(hx, hz));
        if (p) box(p[0], p[1], wallTop, wallTop + 2.7 + rnd() * 0.9, hx, hz, dx, dz, wallCol, wallLayer);
      }
      const count = Math.min(cat === CAT.GLASS ? 5 : 7, Math.floor(area / 120) + 1);
      for (let e = 0; e < count; e++) {
        const type = rnd();
        if (type < 0.6) { // a row of air-conditioner condensers
          const units = 1 + Math.floor(rnd() * 4), p = place(units * 0.6 + 0.3);
          if (p) for (let u = 0; u < units; u++) {
            const off = (u - (units - 1) / 2) * 1.15;
            box(p[0] + dx * off, p[1] + dz * off, wallTop, wallTop + 0.95, 0.48, 0.24, dx, dz, grey, WALL.SIDING);
          }
        } else if (type < 0.78 && cat !== CAT.GLASS) { // water tank on a frame
          const p = place(1.3);
          if (p) { box(p[0], p[1], wallTop + 0.7, wallTop + 2.7, 1.0, 1.0, dx, dz, lin([0.82, 0.82, 0.78]), WALL.PLASTER); box(p[0], p[1], wallTop, wallTop + 0.7, 0.8, 0.8, dx, dz, lin([0.4, 0.4, 0.4]), WALL.SIDING); }
        } else { // plant enclosure / duct
          const hx = 1 + rnd() * (cat === CAT.GLASS ? 4 : 1.5), hz = 0.7 + rnd() * (cat === CAT.GLASS ? 3 : 0.8), p = place(Math.hypot(hx, hz));
          if (p) box(p[0], p[1], wallTop, wallTop + 1.1 + rnd() * 1.4, hx, hz, dx, dz, lin([0.6, 0.61, 0.62]), WALL.SIDING);
        }
      }
    }

    // ---- balconies on the sunny (or longest) side of apartment blocks
    if ((cat === CAT.APARTMENT || cat === CAT.MIXED) && floors >= 2 && fronts.length) {
      const score = (f) => f.len * (0.65 + 0.35 * f.nrm[2]);
      const main = fronts.reduce((m, f) => (score(f) > score(m) ? f : m));
      const depth = 1.05, c = rnd() < 0.6 ? wallCol.map((v) => v + (1 - v) * 0.35) : lin([0.5, 0.51, 0.52]);
      for (const f of fronts) {
        if (f.nrm[0] * main.nrm[0] + f.nrm[2] * main.nrm[2] < 0.85 || f.len < 4) continue;
        const { dx, dz, nrm } = f, inset = 0.3;
        const ax = f.x0 + dx * inset, az = f.z0 + dz * inset, bx = f.x0 + dx * (f.len - inset), bz = f.z0 + dz * (f.len - inset);
        const ox = nrm[0] * depth, oz = nrm[2] * depth;
        for (let fl = 1; fl < floors; fl++) {
          const y0 = b.base + fl * floorH - 0.12, y1 = y0 + 1.2;
          if (y1 > wallTop - 0.4) break;
          const A = (y) => [ax, y, az], B = (y) => [bx, y, bz], C = (y) => [bx + ox, y, bz + oz], D = (y) => [ax + ox, y, az + oz];
          quad(A(y0), B(y0), C(y0), D(y0), [0, -1, 0], c, KIND.SOLID, WALL.PLASTER);            // slab underside
          quad(A(y0 + 0.12), B(y0 + 0.12), C(y0 + 0.12), D(y0 + 0.12), [0, 1, 0], c, KIND.SOLID, WALL.PLASTER); // floor
          quad(D(y0), C(y0), C(y1), D(y1), nrm, c, KIND.SOLID, WALL.PLASTER);                     // front panel
          quad(D(y0), C(y0), C(y1), D(y1), [-nrm[0], 0, -nrm[2]], inner, KIND.SOLID, WALL.PLASTER);
          quad(A(y0), D(y0), D(y1), A(y1), [-dx, 0, -dz], c, KIND.SOLID, WALL.PLASTER);           // side panels
          quad(B(y0), C(y0), C(y1), B(y1), [dx, 0, dz], c, KIND.SOLID, WALL.PLASTER);
        }
      }
    }
    ends.push(pos.length / 3);
  });
  return {
    position: pos.done(), normal: nor.done(), color: col.done(), aFacade: fac.done(), aBldg: bld.done(), aPhoto: pho.done(), aMark: mrk.done(),
    // first vertex index after each building (for picking: vertex -> building)
    ends: ends.done(), triangles: pos.length / 9,
    photo: { position: photo.pos.done(), normal: photo.nor.done(), uv: photo.uv.done(), aMark: photo.mark.done() },
  };
}

export function buildTile(tile, grid, tileSize, surface = (x, z) => sampleGrid(grid, x, z), marks = []) {
  // (the default surface ignores decks: fine for tests, the worker passes makeSurface())
  const drape = createDraper(grid, surface, tileSize);
  return {
    terrain: terrainMesh(grid, tile.tx, tile.tz, tileSize),
    roads: roadMesh(tile.areas.filter((a) => !isPaint(a)), grid, surface, tile.walls, drape),
    paint: roadMesh(tile.areas.filter(isPaint), grid, surface, [], drape),
    decals: decalMesh(tile.props, drape),
    buildings: buildingMesh(tile.buildings, tile.tx, tile.tz, marks),
    info: tile.buildings.map((b) => [b.usage, b.storeys, b.height, b.base]),
    props: Float32Array.from(tile.props.flatMap((p) => [p.kind, p.variant, p.rot, p.x, p.z, p.scale])),
    wires: tile.wires,
    signs: tile.signs, // plain objects; the text is drawn on the main thread
  };
}
