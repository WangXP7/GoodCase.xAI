// js/city-tiles-build.js
// One island tile's geometry as plain typed arrays (tools/city/tiles.mjs writes the tiles), with no three.js: run in
// js/city-tiles-worker.js so building a tile never stalls a frame, or on the main thread where workers aren't available.
// buildTileArrays(tile) -> { walls, roofs, roads } each { position, normal, uv?, color?, sphere: [x, y, z, r] } or null,
// `outlines` { pts (x, z), offsets (building k's points are offsets[k]..offsets[k + 1]), tops } for the maps, and
// `colliders` [cx, cz, hx, hz, ux, uz, minY, maxY] per oriented box for the player (as js/open-city-buildings.js's:
// one box turned to a building where it nearly fills it, else a thin one along each wall); positions relative to the
// tile's corner. Their arrays are transferable.
// createLandMask(land) -> { at(x, z) } the island's land (index.json land: [[outer, ...holes]]) for the player to keep
// to, by scanlines.
// `trees` too, as instance matrices: NParks' trees where the tile has them (tools/city/tiles.mjs, kept off its buildings
// and carriageways), and with `ground` (buildTileArrays(tile, { ox, oz, size, landuse, onLand, inCore })) the island's
// woods, parks and gardens filled in from its land use (tools/city/landuse.mjs's image) where NParks has none, clear of
// the tile's buildings and roads (scatterTrees).

// Building colours by type: Singapore's HDB estates in their painted pastels, factories in grey and blue steel
const PASTELS = [0xf2efe6, 0xefe6d2, 0xdfe9ef, 0xe5efdf, 0xf3e2d4, 0xe9e1ee, 0xf4f1ea, 0xd9e4e8, 0xf0dccb];
const INDUSTRIAL = [0xb8bcc0, 0xa6b2bd, 0xc6c6be, 0x9aa7b3];
const CONCRETE = [0xd2cec4, 0xc8c3b8, 0xdcd8cf, 0xbfbab0];
const HOME = new Set(['residential', 'apartments', 'house', 'terrace', 'detached', 'semidetached_house', 'dormitory', 'bungalow']);
const WORKS = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage_tank']);

const hash = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
// sRGB hex -> linear rgb (what THREE.Color.setHex gives with colour management on)
const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const rgb = (hex) => [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
const ROOF = rgb(0x9c988f);

// Buildings [rings=1, top dm, bottom dm, type, n, dx dz (dm)...]: [{ top, bottom, type, pts: Float32Array x, z }]
function decodeBuildings(B) {
  const out = [];
  const d = B.data;
  let fx = 0, fz = 0;
  for (let i = 0; i < d.length;) {
    const rings = d[i];
    const b = { top: d[i + 1] / 10, bottom: d[i + 2] / 10, type: B.types[d[i + 3]], pts: null };
    i += 4;
    for (let r = 0; r < rings; r++) {
      const n = d[i++];
      const pts = new Float32Array(n * 2);
      let px = fx, pz = fz;
      for (let k = 0; k < n; k++) {
        px += d[i++]; pz += d[i++];
        pts[k * 2] = px / 10; pts[k * 2 + 1] = pz / 10;
        if (!k) { fx = px; fz = pz; }
      }
      if (!r) b.pts = pts;
    }
    out.push(b);
  }
  return out;
}

// Ear-clipping triangulation of a simple polygon (flat x, z), any winding: [i0, i1, i2, ...]. Footprints are small
// (tens of points), so O(n²) is fine; a polygon it can't clip (self-touching) falls back to a fan.
function triangulate(pts) {
  const n = pts.length / 2;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  const sign = area > 0 ? 1 : -1;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out = [];
  const X = (i) => pts[i * 2], Z = (i) => pts[i * 2 + 1];
  const cross = (a, b, c) => ((X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a))) * sign;
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 1e-9) continue; // reflex or flat
      let ear = true;
      for (const p of idx) if (p !== a && p !== b && p !== c && inside(p, a, b, c)) { ear = false; break; }
      if (!ear) continue;
      out.push(a, b, c);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for (let k = 1; k + 1 < idx.length; k++) out.push(idx[0], idx[k], idx[k + 1]);
  return out;
}

function sphereOf(position) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i], y = position[i + 1], z = position[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2];
}

// A triangle on the ground (y), wound to face up
function upTri(out, p, q, r, y) {
  const cy = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
  if (cy < 0) [q, r] = [r, q];
  out.push(p[0], y, p[1], q[0], y, q[1], r[0], y, r[1]);
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

// A building's colliders, pushed onto `out` as [cx, cz, hx, hz, ux, uz, minY, maxY]
function buildingColliders(b, out) {
  if (b.type === 'roof' || b.bottom > 3.5) return; // canopies, and parts clearing even a bus
  const pts = b.pts;
  const box = orientedBox(pts);
  if (box && Math.abs(ringArea(pts)) > box.area * 0.85) {
    out.push(box.cx, box.cz, box.hx, box.hz, box.ux, box.uz, b.bottom, b.top);
    return;
  }
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const ax = pts[k * 2], az = pts[k * 2 + 1];
    const bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.4) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    out.push((ax + bx) / 2 + uz * 0.4, (az + bz) / 2 - ux * 0.4, len / 2, 0.4, ux, uz, b.bottom, b.top);
  }
}

// The island's land for the player to keep to: every `step` m of z, the sorted x where the land's rings (outer & holes)
// cross it; a point is on land where an odd number of crossings lie west of it
function createLandMask(land, step = 4) {
  let z0 = Infinity, z1 = -Infinity;
  const rings = land.flat();
  for (const r of rings) for (let k = 1; k < r.length; k += 2) { z0 = Math.min(z0, r[k]); z1 = Math.max(z1, r[k]); }
  if (!Number.isFinite(z0)) return { at: () => false, rows: 0 };
  const n = Math.floor((z1 - z0) / step) + 1;
  const rows = Array.from({ length: n }, () => []);
  for (const r of rings) {
    const m = r.length / 2;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const ax = r[j * 2], az = r[j * 2 + 1], bx = r[i * 2], bz = r[i * 2 + 1];
      if (az === bz) continue;
      const lo = Math.min(az, bz), hi = Math.max(az, bz);
      for (let k = Math.max(0, Math.ceil((lo - z0) / step - 0.5)); k < n; k++) {
        const z = z0 + (k + 0.5) * step;
        if (z >= hi) break;
        if (z < lo) continue;
        rows[k].push(ax + ((z - az) * (bx - ax)) / (bz - az));
      }
    }
  }
  const sorted = rows.map((xs) => Float64Array.from(xs).sort());
  return {
    rows: n,
    at(x, z) {
      const k = Math.floor((z - z0) / step);
      if (k < 0 || k >= n) return false;
      const xs = sorted[k];
      let lo = 0, hi = xs.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid + 1; else hi = mid; }
      return (lo & 1) === 1;
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------------------------------
// Per class of ground (tools/city/landuse.mjs): how likely a site on the grid is to hold a tree, and its size (m)
const TREE_SPACING = 10; // m between sites (woods' crowns of 9-13 m close over at this)
const TREE_KINDS = [
  { p: 0.85, h: [13, 24], w: [9, 13] }, // woods: tall, closed canopy
  { p: 0.12, h: [8, 15], w: [7, 11.5] }, // parks, playing fields, golf courses, cemeteries: scattered
  { p: 0.0, h: [0, 0], w: [0, 0] }, // paved
  { p: 0.0, h: [0, 0], w: [0, 0] }, // sand
  { p: 0.05, h: [7, 13], w: [6, 10] } // the rest (estates, verges, schools): a few
];
const CLEAR = 2.5; // m kept clear of a building or a road's edge (to a tree's trunk)
const TILE_SIZE = 1500; // m (tools/city/tiles.mjs; index.json tile, passed in `ground`)

// What's in the way of planting in a tile `size` m square: its buildings' footprints and its roads, `clear` m round
// them, on a 3 m grid
function obstacleGrid(buildings, runs, size, clear = CLEAR, cell = 3) {
  const n = Math.ceil(size / cell);
  const g = new Uint8Array(n * n);
  const mark = (i, j) => { if (i >= 0 && j >= 0 && i < n && j < n) g[j * n + i] = 1; };
  const pad = Math.ceil(clear / cell);
  for (const b of buildings) {
    const pts = b.pts, m = pts.length / 2;
    let z0 = Infinity, z1 = -Infinity;
    for (let k = 1; k < pts.length; k += 2) { z0 = Math.min(z0, pts[k]); z1 = Math.max(z1, pts[k]); }
    const j0 = Math.floor(z0 / cell) - pad, j1 = Math.floor(z1 / cell) + pad;
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = Math.min(z1 - 1e-3, Math.max(z0 + 1e-3, (j + 0.5) * cell)); // (the rows past its ends: its ends' outline)
      xs.length = 0;
      for (let k = 0, q = m - 1; k < m; q = k++) {
        const az = pts[q * 2 + 1], bz = pts[k * 2 + 1];
        if ((az > z) !== (bz > z)) xs.push(pts[q * 2] + ((z - az) * (pts[k * 2] - pts[q * 2])) / (bz - az));
      }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let i = Math.floor(xs[k] / cell) - pad; i <= Math.floor(xs[k + 1] / cell) + pad; i++) mark(i, j);
      }
    }
  }
  for (const r of runs) {
    const w = r.w + clear;
    for (let k = 0; k + 3 < r.P.length; k += 2) {
      const ax = r.P[k], az = r.P[k + 1], bx = r.P[k + 2], bz = r.P[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / cell));
      for (let t = 0; t <= steps; t++) {
        const x = ax + ((bx - ax) * t) / steps, z = az + ((bz - az) * t) / steps;
        // every cell coming within w of the point (on the point's own cell: of anywhere in it)
        const ci = Math.floor(x / cell), cj = Math.floor(z / cell), rr = Math.ceil(w / cell) + 1;
        for (let dj = -rr; dj <= rr; dj++) {
          const ej = Math.max(0, Math.abs(dj) - 1);
          for (let di = -rr; di <= rr; di++) {
            const ei = Math.max(0, Math.abs(di) - 1);
            if ((ei * ei + ej * ej) * cell * cell <= w * w) mark(ci + di, cj + dj);
          }
        }
      }
    }
  }
  return { at: (x, z) => { const i = Math.floor(x / cell), j = Math.floor(z / cell); return i >= 0 && j >= 0 && i < n && j < n && g[j * n + i] === 1; } };
}

// A tile's NParks trees ([dx, dz (m), height (m)] flat, from its corner), less those on a building or a carriageway
// (`blocked`): [{ x, z, h }] relative to the tile's corner
function decodeTrees(flat, blocked = () => false) {
  const out = [];
  let px = 0, pz = 0;
  for (let k = 0; k + 2 < flat.length; k += 3) {
    px += flat[k];
    pz += flat[k + 1];
    const x = px, z = pz;
    if (!blocked(x, z)) out.push({ x, z, h: flat[k + 2] });
  }
  return out;
}

// An NParks tree's instance: its recorded height (8 m when there's none), its crown about 0.6 of it (a street tree's
// rain tree or angsana spreads wider than it's tall in the inventory's bands, a palm much less: the spread is jittered)
function realTreeMatrix(out, t) {
  const r1 = hash(t.x * 0.37 + 11, t.z * 0.53), r2 = hash(t.z * 0.29 + 7, t.x * 0.41);
  const h = (t.h > 0 ? t.h : 8) * (0.9 + r1 * 0.2);
  const w = Math.min(15, Math.max(3.5, h * (0.45 + r2 * 0.35)));
  const a = hash(t.x + t.z, t.x - t.z + 3) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
  out.push(c * w, 0, -sn * w, 0, 0, h, 0, 0, sn * w, 0, c * w, 0, t.x, 0, t.z, 1);
  return h;
}

// Where NParks' trees stand, for the filled-in ones to keep away from: `near(x, z, r)` whether one is within r m (r up
// to `reach`), on a 5 m grid
function nearGrid(real, size, reach = 25, cell = 5) {
  const n = Math.ceil(size / cell);
  const d = new Float32Array(n * n).fill(Infinity); // the nearest one's distance from each cell's centre
  const rr = Math.ceil(reach / cell) + 1;
  for (const t of real) {
    const ci = Math.floor(t.x / cell), cj = Math.floor(t.z / cell);
    for (let j = Math.max(0, cj - rr); j <= Math.min(n - 1, cj + rr); j++) {
      for (let i = Math.max(0, ci - rr); i <= Math.min(n - 1, ci + rr); i++) {
        const e = Math.hypot((i + 0.5) * cell - t.x, (j + 0.5) * cell - t.z);
        if (e < d[j * n + i]) d[j * n + i] = e;
      }
    }
  }
  const slack = cell * Math.SQRT1_2;
  return (x, z, r) => {
    const i = Math.floor(x / cell), j = Math.floor(z / cell);
    return i >= 0 && j >= 0 && i < n && j < n && d[j * n + i] < r + slack;
  };
}

// The shares of wood, grass, paving and sand at a world point (nearest pixel of tools/city/landuse.mjs's image)
function landuseAt(lu, x, z) {
  const i = Math.floor((x - lu.x0) / lu.res), j = Math.floor((z - lu.z0) / lu.res);
  if (i < 0 || j < 0 || i >= lu.w || j >= lu.h) return null;
  const k = (j * lu.w + i) * 4, p = lu.pixels;
  return [p[k] / 255, p[k + 1] / 255, p[k + 2] / 255, p[k + 3] / 255];
}

// How far a filled-in tree keeps from an NParks one (m): in woods just its crown's room (NParks records few trees there,
// its own estate's edges), elsewhere well clear (parks and verges NParks has planted are in its inventory already)
const REAL_ROOM = [6, 28, 0, 0, 28];

/**
 * The trees of a tile at (ox, oz), `size` m square: NParks' `real` ones ([{ x, z, h }] relative to its corner), then
 * with `landuse` a site every TREE_SPACING m (jittered), planted with the chance of its ground's kind (its shares of
 * each), not where `blocked`, near a real one (REAL_ROOM), off the land or in the detailed city -> { matrices
 * (Float32Array, 16 a tree, relative to the tile's corner), count, real (how many of them NParks'), sphere }. Seeded by
 * the world position, so a tile grows the same trees every time it's built.
 */
function scatterTrees({ ox, oz, size, landuse = null, real = [], onLand = () => true, inCore = () => false, blocked = () => false }) {
  const out = [];
  const s = TREE_SPACING;
  const n = landuse ? Math.floor(size / s) : 0;
  let top = 0;
  for (const t of real) top = Math.max(top, realTreeMatrix(out, t));
  const near = real.length ? nearGrid(real, size) : () => false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = ox + i * s, gz = oz + j * s;
      const x = gx + hash(gx, gz) * s, z = gz + hash(gz + 0.37, gx - 0.71) * s;
      const share = landuseAt(landuse, x, z);
      if (!share) continue;
      const rest = Math.max(0, 1 - share[0] - share[1] - share[2] - share[3]);
      const roll = hash(x * 1.13 + 5.1, z * 0.91 - 2.3);
      // which kind of ground this site is (by its shares), and whether it holds a tree
      let kind = -1, acc = 0;
      const pick = hash(z * 1.7 - 9.1, x * 0.6 + 3.3);
      for (const [c, w] of [[0, share[0]], [1, share[1]], [2, share[2]], [3, share[3]], [4, rest]]) {
        acc += w;
        if (pick < acc) { kind = c; break; }
      }
      if (kind < 0) kind = 4;
      const K = TREE_KINDS[kind];
      if (roll >= K.p) continue;
      const lx = x - ox, lz = z - oz;
      if (blocked(lx, lz) || near(lx, lz, REAL_ROOM[kind]) || inCore(x, z) || !onLand(x, z)) continue;
      const r1 = hash(x * 0.37, z * 0.53), r2 = hash(z * 0.29 + 1, x * 0.41 - 1), r3 = hash(x + z, x - z);
      const h = K.h[0] + (K.h[1] - K.h[0]) * r1;
      const w = K.w[0] + (K.w[1] - K.w[0]) * (r2 * 0.7 + r1 * 0.3);
      const a = r3 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      // column-major: x axis (c, 0, -sn) * w, y up * h, z axis (sn, 0, c) * w, at (lx, 0, lz)
      out.push(c * w, 0, -sn * w, 0, 0, h, 0, 0, sn * w, 0, c * w, 0, lx, 0, lz, 1);
      top = Math.max(top, h);
    }
  }
  const half = size / 2;
  return { matrices: new Float32Array(out), count: out.length / 16, real: real.length, sphere: [half, top / 2, half, Math.hypot(half, half, top / 2) + 8] };
}

/**
 * What scatterTrees needs to know about the island, for tile (i, j): its land use ({ x0, z0, res, w, h } of index.json's
 * landuse, with the image's RGBA `pixels`), its land (index.json land) and the detailed city it leaves out (coreRing,
 * flat x, z). -> (i, j) => buildTileArrays's `ground`
 */
function islandGround({ landuse, land, coreRing, tile }) {
  const mask = createLandMask(land);
  const ring = [];
  for (let k = 0; k + 1 < (coreRing || []).length; k += 2) ring.push([coreRing[k], coreRing[k + 1]]);
  const inCore = (x, z) => {
    let inside = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, za] = ring[a], [xb, zb] = ring[b];
      if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
    }
    return inside;
  };
  return (i, j) => ({ ox: i * tile, oz: j * tile, size: tile, landuse, onLand: mask.at, inCore });
}

/**
 * A tile's trees in TREE_CHUNK m squares, for the renderer to choose each one's detail and how many of it to draw by its
 * distance (js/city-tiles.js): the matrices regrouped by square, each square's in a seeded random order (so drawing the
 * first n of them thins it evenly) -> { matrices, count, real, chunks: [{ start, count, sphere: [x, y, z, r] }] }
 */
const TREE_CHUNK = 500; // m
function chunkTrees(trees, size) {
  const per = Math.max(1, Math.ceil(size / TREE_CHUNK));
  const M = trees.matrices;
  const groups = Array.from({ length: per * per }, () => []);
  for (let k = 0; k < trees.count; k++) {
    const x = M[k * 16 + 12], z = M[k * 16 + 14];
    const i = Math.min(per - 1, Math.max(0, Math.floor(x / TREE_CHUNK))), j = Math.min(per - 1, Math.max(0, Math.floor(z / TREE_CHUNK)));
    groups[j * per + i].push([hash(x * 3.1 + 0.7, z * 2.3 - 1.9), k]);
  }
  const out = new Float32Array(M.length);
  const chunks = [];
  let at = 0;
  groups.forEach((g, c) => {
    if (!g.length) return;
    g.sort((a, b) => a[0] - b[0]);
    let top = 0;
    for (const [, k] of g) {
      out.set(M.subarray(k * 16, k * 16 + 16), at * 16);
      top = Math.max(top, M[k * 16 + 5]);
      at++;
    }
    const i = c % per, j = Math.floor(c / per);
    const half = TREE_CHUNK / 2;
    chunks.push({ start: at - g.length, count: g.length, sphere: [i * TREE_CHUNK + half, top / 2, j * TREE_CHUNK + half, Math.hypot(half, half, top / 2) + 8] });
  });
  return { ...trees, matrices: out, chunks };
}

function buildTileArrays(tile, ground = null) {
  const walls = { pos: [], nrm: [], uv: [], col: [] };
  const roofs = { pos: [], col: [] };
  const buildings = decodeBuildings(tile.buildings);
  const outlines = {
    pts: new Float32Array(buildings.reduce((n, b) => n + b.pts.length, 0)),
    offsets: new Uint32Array(buildings.length + 1),
    tops: new Float32Array(buildings.length)
  };
  buildings.forEach((b, k) => {
    outlines.pts.set(b.pts, outlines.offsets[k] * 2);
    outlines.offsets[k + 1] = outlines.offsets[k] + b.pts.length / 2;
    outlines.tops[k] = b.top;
  });
  const colliders = [];
  for (const b of buildings) {
    buildingColliders(b, colliders);
    const pts = b.pts;
    const n = pts.length / 2;
    const r = hash(pts[0], pts[1]);
    const palette = HOME.has(b.type) ? PASTELS : WORKS.has(b.type) ? INDUSTRIAL : CONCRETE;
    const [cr, cg, cb] = rgb(palette[Math.floor(r * palette.length)]);
    // walls: each edge a quad, its uv in metres along the walls (from a random start) and up from the ground
    let along = r * 37;
    if (b.type !== 'roof') {
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2], az = pts[k * 2 + 1];
        const bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.3) continue;
        const nx = -(bz - az) / len, nz = (bx - ax) / len; // outward for clockwise rings
        walls.pos.push(ax, b.bottom, az, bx, b.bottom, bz, bx, b.top, bz, ax, b.bottom, az, bx, b.top, bz, ax, b.top, az);
        for (let v = 0; v < 6; v++) { walls.nrm.push(nx, 0, nz); walls.col.push(cr, cg, cb); }
        const u0 = along, u1 = along + len;
        walls.uv.push(u0, b.bottom, u1, b.bottom, u1, b.top, u0, b.bottom, u1, b.top, u0, b.top);
        along = u1;
      }
    }
    // roof, facing up: weathered concrete and tar, as the city's (js/open-city-buildings.js), a little of the walls' tint
    const shade = 0.82 + r * 0.26;
    const tris = triangulate(pts);
    for (let t = 0; t < tris.length; t += 3) {
      const p0 = [pts[tris[t] * 2], pts[tris[t] * 2 + 1]];
      const p1 = [pts[tris[t + 1] * 2], pts[tris[t + 1] * 2 + 1]];
      const p2 = [pts[tris[t + 2] * 2], pts[tris[t + 2] * 2 + 1]];
      upTri(roofs.pos, p0, p1, p2, b.top);
      for (let v = 0; v < 3; v++) roofs.col.push((ROOF[0] * 0.8 + cr * 0.2) * shade, (ROOF[1] * 0.8 + cg * 0.2) * shade, (ROOF[2] * 0.8 + cb * 0.2) * shade);
    }
  }
  // main roads: a ribbon per run, its segments overlapping at the joints
  const roads = [];
  const runs = [];
  for (const run of tile.roads) {
    const [, wdm, level, n] = run;
    const w = wdm / 20;
    const y = level ? 0.04 : -0.02;
    let px = 0, pz = 0;
    const P = [];
    for (let k = 0; k < n; k++) {
      px += run[4 + k * 2]; pz += run[5 + k * 2];
      P.push(px / 10, pz / 10);
    }
    runs.push({ w, P });
    for (let k = 0; k + 1 < n; k++) {
      const ax = P[k * 2], az = P[k * 2 + 1], bx = P[k * 2 + 2], bz = P[k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const ex = ux * w * 0.5, ez = uz * w * 0.5; // overlap the joints by half a width
      const sx = -uz * w, sz = ux * w;
      const a0 = [ax - ex + sx, az - ez + sz], a1 = [ax - ex - sx, az - ez - sz];
      const b0 = [bx + ex + sx, bz + ez + sz], b1 = [bx + ex - sx, bz + ez - sz];
      upTri(roads, a0, b0, b1, y);
      upTri(roads, a0, b1, a1, y);
    }
  }
  const up = (count) => {
    const a = new Float32Array(count * 3);
    for (let i = 1; i < a.length; i += 3) a[i] = 1;
    return a;
  };
  const pack = (pos, extra) => {
    if (!pos.length) return null;
    const position = new Float32Array(pos);
    return { position, sphere: sphereOf(position), ...extra(position.length / 3) };
  };
  let trees = null;
  if ((ground && ground.landuse) || (tile.trees && tile.trees.length)) {
    const size = ground ? ground.size : TILE_SIZE;
    // NParks' trees off the buildings and carriageways (kerbside ones a metre clear of the estimated road edge)
    const strict = tile.trees ? obstacleGrid(buildings, runs, size, 0.5, 1).at : null;
    const real = tile.trees ? decodeTrees(tile.trees, strict) : [];
    const blocked = ground && ground.landuse ? obstacleGrid(buildings, runs, size).at : undefined;
    trees = chunkTrees(scatterTrees({ ox: 0, oz: 0, size, ...(ground || {}), real, blocked }), size);
  }
  return {
    trees,
    walls: pack(walls.pos, () => ({ normal: new Float32Array(walls.nrm), uv: new Float32Array(walls.uv), color: new Float32Array(walls.col) })),
    roofs: pack(roofs.pos, (count) => ({ normal: up(count), color: new Float32Array(roofs.col) })),
    roads: pack(roads, (count) => ({ normal: up(count) })),
    outlines,
    colliders: new Float32Array(colliders),
    counts: { walls: walls.pos.length / 18, roofs: roofs.pos.length / 9, roads: roads.length / 18 }
  };
}

// The typed arrays of a built tile, to transfer to the main thread rather than copy
function transferables(built) {
  const list = [];
  for (const part of [built.walls, built.roofs, built.roads]) {
    if (!part) continue;
    for (const k of ['position', 'normal', 'uv', 'color']) if (part[k]) list.push(part[k].buffer);
  }
  if (built.outlines) for (const k of ['pts', 'offsets', 'tops']) list.push(built.outlines[k].buffer);
  if (built.colliders) list.push(built.colliders.buffer);
  if (built.trees) list.push(built.trees.matrices.buffer);
  return list;
}

export { buildTileArrays, chunkTrees, TREE_CHUNK, decodeBuildings, decodeTrees, triangulate, transferables, createLandMask, scatterTrees, landuseAt, islandGround, TREE_SPACING, REAL_ROOM };
