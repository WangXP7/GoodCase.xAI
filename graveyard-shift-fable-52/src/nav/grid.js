// Walkability grid over the level's XZ footprint, in one or more floor layers. Pure logic: no
// three.js, no DOM.
//
// A cell of layer L has a floor: the layer's height (layer 0 everywhere; upper layers only inside
// their `floors` rectangles), or the height of a stair (`ramps`) over the cell, which belongs to
// whichever layer's height it is nearer. A cell is unwalkable when it has no floor, or when its
// centre lies within `clearance` metres of the XZ footprint of a collider that intersects the body
// band [floor + bandMin, floor + bandMax]. Kerb tops, ground slabs, the walkway seen from under it
// and overhead canopies therefore do not block; cars, walls, rails and pumps do. Colliders marked
// `stair` (the step boxes: their tops are the ramp) and `off` (an opened door) never block.
//
// Index of a cell: L * nc + j * nx + i (nc = nx * nz); layer 0 indices are the single-layer ones,
// so `index(x, z)` and `blocked[k]` mean what they always meant.
//
// options.layers: [{ y, floors?: [{ x0, z0, x1, z1 }] }]  (default one layer at groundY, everywhere)
// options.ramps:  [{ foot: [x, z], dir: [dx, dz] (uphill, axis-aligned), width, steps, rise, tread, landing }]
// options.links:  [{ id, kind, from: [x, z, layer], to: [x, z, layer], open() }]  one-way ways in
//                 (a window, a fence climb) that the flow field may use while open() is true

// Positions arrive as scalars (x, z), as [x, y, z] arrays, or as {x, y, z} objects (three.js
// Vector3). pointXZ normalises any of them into PX/PZ (and PY, NaN when there is none) without
// allocating and reports whether x and z are finite numbers.
export let PX = 0;
export let PZ = 0;
export let PY = NaN;
export function pointXZ(a, b) {
  PY = NaN;
  if (typeof a === 'number') { PX = a; PZ = b; }
  else if (a && typeof a === 'object') {
    if (typeof a.x === 'number' || typeof a.z === 'number') { PX = a.x; PZ = a.z; PY = typeof a.y === 'number' ? a.y : NaN; }
    else { PX = a[0]; PZ = a[2]; PY = typeof a[1] === 'number' ? a[1] : NaN; }
  } else { PX = NaN; PZ = NaN; }
  return Number.isFinite(PX) && Number.isFinite(PZ);
}

export const NAV_DEFAULTS = { clearance: 0.35, bandMin: 0.1, bandMax: 1.8, groundY: 0, maxStep: 0.45 };

// Height of a stair's surface at (x, z), or NaN outside it. Steps are boxes: the height jumps at
// each riser (k + 1) * rise, and the landing (the last step, `landing` long) is flat at the top.
export function rampHeight(r, x, z) {
  const ux = r.dir[0], uz = r.dir[1];
  const along = (x - r.foot[0]) * ux + (z - r.foot[1]) * uz;
  const across = Math.abs((x - r.foot[0]) * -uz + (z - r.foot[1]) * ux);
  const run = (r.steps - 1) * r.tread + (r.landing ?? r.tread);
  if (along < 0 || along >= run || across > r.width / 2) return NaN;
  const k = Math.min(r.steps - 1, Math.floor(along / r.tread));
  return (k + 1) * r.rise;
}

export function buildGrid(colliders, bounds, cell = 0.5, options = {}) {
  const o = { ...NAV_DEFAULTS, ...options };
  const { clearance, bandMin, bandMax, groundY, maxStep } = o;
  const layerDefs = o.layers && o.layers.length ? o.layers : [{ y: groundY }];
  const ramps = o.ramps || [];
  const ox = bounds.min[0];
  const oz = bounds.min[2];
  const nx = Math.max(1, Math.ceil((bounds.max[0] - ox) / cell - 1e-9));
  const nz = Math.max(1, Math.ceil((bounds.max[2] - oz) / cell - 1e-9));
  const nc = nx * nz;
  const NL = layerDefs.length;
  const blocked = new Uint8Array(NL * nc);
  const floorY = new Float32Array(NL * nc);
  const isRamp = new Uint8Array(NL * nc);
  const c2 = clearance * clearance;
  const cols = colliders || [];

  // nearest layer for a height (a stair cell belongs to the floor it is closer to)
  const nearestLayer = (h) => {
    let best = 0;
    for (let L = 1; L < NL; L++) if (Math.abs(h - layerDefs[L].y) < Math.abs(h - layerDefs[best].y)) best = L;
    return best;
  };
  const inFloors = (L, x, z) => {
    const f = layerDefs[L].floors;
    if (!f) return L === 0;
    for (const r of f) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    return false;
  };

  // floors: the layer's own, or a stair over the cell
  function floorCell(k) {
    const r = k % nc, i = r % nx, j = (r - i) / nx;
    const x = ox + (i + 0.5) * cell, z = oz + (j + 0.5) * cell;
    for (let L = 0; L < NL; L++) {
      const kk = L * nc + r;
      floorY[kk] = inFloors(L, x, z) ? layerDefs[L].y : NaN;
      isRamp[kk] = 0;
    }
    for (const rp of ramps) {
      const h = rampHeight(rp, x, z);
      if (!Number.isFinite(h)) continue;
      const L = nearestLayer(h);
      for (let M = 0; M < NL; M++) { floorY[M * nc + r] = M === L ? h : NaN; isRamp[M * nc + r] = M === L ? 1 : 0; }
    }
    for (let L = 0; L < NL; L++) blocked[L * nc + r] = Number.isFinite(floorY[L * nc + r]) ? 0 : 1;
  }
  for (let r = 0; r < nc; r++) floorCell(r);

  // block the cells in [i0..i1] x [j0..j1] that collider b reaches, layer by layer
  function stamp(b, i0, i1, j0, j1) {
    if (b.off || b.stair) return;
    const x0 = b.min[0], x1 = b.max[0], z0 = b.min[2], z1 = b.max[2];
    const ci0 = Math.max(i0, Math.floor((x0 - clearance - ox) / cell));
    const ci1 = Math.min(i1, Math.floor((x1 + clearance - ox) / cell));
    const cj0 = Math.max(j0, Math.floor((z0 - clearance - oz) / cell));
    const cj1 = Math.min(j1, Math.floor((z1 + clearance - oz) / cell));
    if (ci0 > ci1 || cj0 > cj1) return;
    for (let L = 0; L < NL; L++) {
      // quick reject on the layer's own height (stair cells are tested one by one below)
      const ly = layerDefs[L].y;
      const flatHit = b.max[1] > ly + bandMin && b.min[1] < ly + bandMax;
      for (let j = cj0; j <= cj1; j++) {
        const cz = oz + (j + 0.5) * cell;
        const dz = cz < z0 ? z0 - cz : cz > z1 ? cz - z1 : 0;
        for (let i = ci0; i <= ci1; i++) {
          const k = L * nc + j * nx + i;
          if (blocked[k]) continue;
          const f = floorY[k];
          const hit = isRamp[k] ? b.max[1] > f + bandMin && b.min[1] < f + bandMax : flatHit;
          if (!hit) continue;
          const cx = ox + (i + 0.5) * cell;
          const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
          if (dx * dx + dz * dz <= c2) blocked[k] = 1;
        }
      }
    }
  }
  for (const b of cols) stamp(b, 0, nx - 1, 0, nz - 1);

  // Index of the cell containing (x,z) on layer L, or -1 outside the grid.
  function index3(x, z, L = 0) {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    if (!(i >= 0 && j >= 0 && i < nx && j < nz) || !(L >= 0 && L < NL)) return -1; // also rejects NaN
    return L * nc + j * nx + i;
  }
  const index = (x, z) => index3(x, z, 0);

  function nearestWalkable(x, z, L = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return -1;
    const k = index3(x, z, L);
    if (k >= 0 && blocked[k] === 0) return k;
    const base = L * nc;
    const ci = Math.min(nx - 1, Math.max(0, Math.floor((x - ox) / cell)));
    const cj = Math.min(nz - 1, Math.max(0, Math.floor((z - oz) / cell)));
    let best = -1;
    let bestD2 = Infinity;
    const maxR = Math.max(nx, nz);
    for (let r = 0; r <= maxR; r++) {
      // Every cell in ring r is at least (r - 1) * cell away from (x,z); stop once that exceeds best.
      const ringMin = Math.max(0, r - 1) * cell;
      if (ringMin * ringMin > bestD2) break;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= nz) continue;
        const edgeRow = j === cj - r || j === cj + r;
        const step = edgeRow ? 1 : 2 * r || 1;
        for (let i = ci - r; i <= ci + r; i += step) {
          if (i < 0 || i >= nx) continue;
          const kk = base + j * nx + i;
          if (blocked[kk]) continue;
          const dx = ox + (i + 0.5) * cell - x;
          const dz = oz + (j + 0.5) * cell - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = kk; }
        }
      }
    }
    return best;
  }

  const grid = {
    cell, nx, nz, nc, ox, oz, blocked, floorY, layers: NL, layerDefs, maxStep,
    version: 0, // bumped by setBlocked: a flow field built on this grid re-solves on invalidate()
    index, index3,
    // walkable(x, z, layer = 0) or walkable(point, _, layer) with point [x,y,z] or {x,y,z}.
    walkable(x, z, L = 0) {
      if (!pointXZ(x, z)) return false;
      const k = index3(PX, PZ, L);
      return k >= 0 && blocked[k] === 0;
    },
    centerX: (k) => ox + (((k % nc) % nx) + 0.5) * cell,
    centerZ: (k) => oz + (Math.floor((k % nc) / nx) + 0.5) * cell,
    layerOf: (k) => Math.floor(k / nc),
    // floor height of (x, z) on layer L, NaN where that layer has none
    floorAt(x, z, L = 0) { const k = index3(x, z, L); return k < 0 ? NaN : floorY[k]; },
    // The layer a body at height y stands on at (x, z): the highest floor no more than half a metre
    // above its feet (a stair step it is climbing counts), else layer 0.
    layerAt(x, y, z) {
      const r = index3(x, z, 0);
      if (r < 0) return 0;
      const yy = Number.isFinite(y) ? y : 0;
      let best = 0, bestY = -Infinity;
      for (let L = 0; L < NL; L++) {
        const f = floorY[L * nc + r];
        if (Number.isFinite(f) && f <= yy + 0.5 && f > bestY) { best = L; bestY = f; }
      }
      return best;
    },
    nearestWalkable,
    // Close (true) or reopen (false) the cells whose centres lie within `clearance` of rect
    // ({ x0, z0, x1, z1 } or { min:[x,y,z], max:[x,y,z] }). Reopening recomputes them from the
    // colliders that are not `off`, so a door's jambs stay blocked. Call field.invalidate() after.
    setBlocked(rect, value) {
      const x0 = rect.min ? rect.min[0] : rect.x0, x1 = rect.max ? rect.max[0] : rect.x1;
      const z0 = rect.min ? rect.min[2] : rect.z0, z1 = rect.max ? rect.max[2] : rect.z1;
      const i0 = Math.max(0, Math.floor((x0 - clearance - ox) / cell)), i1 = Math.min(nx - 1, Math.floor((x1 + clearance - ox) / cell));
      const j0 = Math.max(0, Math.floor((z0 - clearance - oz) / cell)), j1 = Math.min(nz - 1, Math.floor((z1 + clearance - oz) / cell));
      if (i0 > i1 || j0 > j1) return;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const r = j * nx + i;
        if (value) { for (let L = 0; L < NL; L++) blocked[L * nc + r] = 1; } else floorCell(r);
      }
      if (!value) {
        const lo = [x0 - clearance - 0.01, z0 - clearance - 0.01], hi = [x1 + clearance + 0.01, z1 + clearance + 0.01];
        for (const b of cols) {
          if (b.max[0] < lo[0] || b.min[0] > hi[0] || b.max[2] < lo[1] || b.min[2] > hi[1]) continue;
          stamp(b, i0, i1, j0, j1);
        }
      }
      grid.version++;
    },
    links: [],
  };

  // one-way links (windows, climbs): resolved to cells once; open() is asked during each solve
  for (const l of o.links || []) {
    const fromCell = nearestWalkable(l.from[0], l.from[1], l.from[2] || 0);
    const toCell = nearestWalkable(l.to[0], l.to[1], l.to[2] || 0);
    if (fromCell < 0 || toCell < 0) continue;
    grid.links.push({ ...l, link: l, fromCell, toCell, length: Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]) });
  }
  return grid;
}
