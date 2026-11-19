// Roads that PLATEAU maps only as an outline (the whole right-of-way, building line to building line)
// are split here into a carriageway and sidewalks: the carriageway is the OSM centreline buffered to the
// width its lanes need, clipped to the outline; what is left of the outline is sidewalk.
// Where two one-way carriageways share an outline, the strip between them comes out as a median.
import polygonClipping from 'polygon-clipping';
import { forEachAlong, inRings } from './landscape.mjs';

const LANE = 3.0;        // lane width (m)
const MIN_SIDEWALK = 1.5; // narrower leftovers are not worth a kerb: the street is carriageway wall to wall

const close = (r) => [...r, r[0]];
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]; s += x2 * z1 - x1 * z2; } return s / 2; };
// polygon-clipping multipolygon -> our polygons: open rings, outline counter-clockwise, holes clockwise
function fromClip(multi, minArea) {
  const out = [];
  for (const poly of multi) {
    const rings = poly.map((r) => r.slice(0, -1)).filter((r) => r.length >= 3);
    if (!rings.length || Math.abs(area(rings[0])) < minArea) continue;
    out.push(rings.map((r, i) => ((area(r) > 0) === (i === 0) ? r : [...r].reverse())));
  }
  return out;
}

// edges: road graph edges ({ ids, lanes, oneway, highway, bridge, tunnel }); pos: node id -> [x, z];
// idxRoad: PolyIndex of all road outlines; outlines: [[outer, ...holes]] of the outline-only roads.
// Returns { carriageway: [polygon], sidewalk: [polygon], untouched: number }.
// walkLines: pedestrian streets and footpaths ([[x, z], ...]): an outline with no road for cars but one of
// these running through it is a pedestrian street, paved like a sidewalk.
export function splitOutlineRoads({ outlines, edges, pos, idxRoad, walkLines = [] }) {
  const walkPoints = [];
  for (const line of walkLines) forEachAlong(line, 4, (x, z) => walkPoints.push([x, z]), 1);
  // 1. a buffer around every surface road, as convex pieces (a box per segment, an octagon per vertex)
  const pieces = [], cell = 40, grid = new Map();
  const add = (ring) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const piece = { poly: [close(ring)], x0, x1, z0, z1 };
    pieces.push(piece);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = i + ',' + j;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(piece);
      }
  };
  const reach = (x, z, nx, nz, side) => {
    for (let d = 0.5; d <= 30; d += 0.5) if (!idxRoad.has(x + nx * d * side, z + nz * d * side)) return d;
    return null;
  };
  for (const e of edges) {
    if ((e.bridge && !e.span) || e.tunnel || e.highway.startsWith('motorway')) continue;
    const pts = e.ids.map(pos);
    // width of the right-of-way around this edge
    const widths = [];
    forEachAlong(pts, 10, (x, z, dx, dz) => {
      if (!idxRoad.has(x, z)) return;
      const R = reach(x, z, -dz, dx, 1), L = reach(x, z, -dz, dx, -1);
      if (R != null && L != null) widths.push(R + L);
    }, 3);
    if (!widths.length) continue;
    const row = widths.sort((a, b) => a - b)[widths.length >> 1];
    const carriage = e.lanes >= 2 ? e.lanes * LANE + 1 : e.oneway ? 4 : 4.5;
    // room for a sidewalk on both sides? otherwise the buffer swallows the whole outline
    const h = row < carriage + 2 * MIN_SIDEWALK ? row : Math.min(carriage / 2, row / 2 - MIN_SIDEWALK);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      add(Array.from({ length: 8 }, (_, k) => [x + Math.cos((k + 0.5) * Math.PI / 4) * h * 1.08, z + Math.sin((k + 0.5) * Math.PI / 4) * h * 1.08]));
      if (i === 0) continue;
      const [px, pz] = pts[i - 1], len = Math.hypot(x - px, z - pz);
      if (len < 0.01) continue;
      const nx = (-(z - pz) / len) * h, nz = ((x - px) / len) * h;
      add([[px - nx, pz - nz], [x - nx, z - nz], [x + nx, z + nz], [px + nx, pz + nz]]);
    }
  }

  // 2. clip each outline against the buffers that touch it
  const out = { carriageway: [], sidewalk: [], untouched: 0, pedestrian: 0, failed: 0 };
  for (const rings of outlines) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const near = new Set();
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++)
        for (const p of grid.get(i + ',' + j) ?? []) if (p.x1 >= x0 && p.x0 <= x1 && p.z1 >= z0 && p.z0 <= z1) near.add(p);
    const subject = [rings.map(close)];
    // no road runs through it (a forecourt, a lane OSM does not have): leave it as plain road surface
    if (!near.size) {
      const walked = walkPoints.some(([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && inRings(x, z, rings));
      if (walked) { out.pedestrian++; out.sidewalk.push(rings); } else { out.untouched++; out.carriageway.push(rings); }
      continue;
    }
    try {
      const buffer = polygonClipping.union(...[...near].map((p) => p.poly));
      out.carriageway.push(...fromClip(polygonClipping.intersection(subject, buffer), 1));
      out.sidewalk.push(...fromClip(polygonClipping.difference(subject, buffer), 1.5));
    } catch {
      out.failed++; out.carriageway.push(rings); // degenerate input: keep the old behaviour for this one
    }
  }
  return out;
}
