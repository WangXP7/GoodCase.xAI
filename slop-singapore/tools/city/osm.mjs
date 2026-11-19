// tools/city/osm.mjs — OpenStreetMap (Overpass `out geom` JSON) into the world frame: polygons, streets & coastline land
import { Raster, labelComponents, traceLabel, destair, rdpRing, ringArea, bbox, pointInRing } from './geom.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------------------------------------------------
// The outline of a closed way, or the longest outer member of a multipolygon relation
export function elemRing(e, toWorld) {
  if (e.type === 'way') return (e.geometry || []).map((g) => toWorld(g.lon, g.lat));
  let best = [];
  for (const m of e.members || []) if (m.role === 'outer' && m.geometry && m.geometry.length > best.length) best = m.geometry.map((g) => toWorld(g.lon, g.lat));
  return best;
}
// Every outer ring: a relation's outer ways (several per ring in the larger multipolygons) chained into closed rings
export function elemRings(e, toWorld) {
  if (e.type === 'way') return [(e.geometry || []).map((g) => toWorld(g.lon, g.lat))];
  const parts = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => toWorld(g.lon, g.lat)));
  const rings = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 500 && !close(ring[0], ring[ring.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], ring[ring.length - 1]) || close(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(close(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
// Closed outer rings of an area element (open chains, e.g. cut by the query's bbox, dropped), clockwise in (x, z)
export function areaRings(e, toWorld, minArea = 0) {
  if (e.type === 'way' && !(e.nodes && e.nodes.length > 3 && e.nodes[0] === e.nodes[e.nodes.length - 1])) return [];
  const out = [];
  for (const r of elemRings(e, toWorld)) {
    if (r.length < 4 || Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 0.5) continue;
    const ring = r.slice(0, -1);
    if (Math.abs(ringArea(ring)) < minArea) continue;
    if (ringArea(ring) > 0) ring.reverse();
    out.push(ring);
  }
  return out;
}

// Polygons of an area element with their holes (a multipolygon's inner rings, in the outer ring containing them):
// [{ outer, holes }], outer rings clockwise in (x, z) and holes the other way round
export function areaPolygons(e, toWorld, minArea = 0) {
  const polys = areaRings(e, toWorld, minArea).map((outer) => ({ outer, holes: [] }));
  if (e.type !== 'relation' || !polys.length) return polys;
  const inner = { ...e, members: (e.members || []).filter((m) => m.role === 'inner').map((m) => ({ ...m, role: 'outer' })) };
  for (const ring of areaRings(inner, toWorld, 1)) {
    const owner = polys.find((p) => pointInRing(ring[0][0], ring[0][1], p.outer));
    if (owner) owner.holes.push(ring.reverse());
  }
  return polys;
}

// ---------------------------------------------------------------------------------------------------------------------
// Streets
// ---------------------------------------------------------------------------------------------------------------------
// Travel lanes when the way has no lanes tag: [two-way total, one-way]
const DEFAULT_LANES = {
  motorway: [6, 3], trunk: [6, 3], primary: [4, 3], secondary: [4, 2], tertiary: [2, 2],
  unclassified: [2, 1], residential: [2, 1], living_street: [2, 1], service: [1, 1],
  motorway_link: [2, 1], trunk_link: [2, 1], primary_link: [2, 1], secondary_link: [2, 1], tertiary_link: [2, 1]
};
export const VEHICLE_CLASSES = Object.keys(DEFAULT_LANES);
const LANE = 3.3; // m per travel lane
const GUTTERS = 1.0; // m of gutter & kerb edge across the carriageway

// The number a tag starts with ("12.5 m" -> 12.5), or NaN
export const num = (v) => {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(v || '');
  return m ? parseFloat(m[1]) : NaN;
};
// A yes-ish tag (present, not "no")
export const yes = (v) => v !== undefined && v !== 'no';

// Class, curb-to-curb width (m), travel lanes, direction of travel (1: along the way, -1: against it, 0: both) and level
// (0 at grade, > 0 bridges & viaducts, < 0 tunnels) of a highway=* way's tags
export function roadAttrs(t) {
  const cls = t.highway;
  let dir = 0;
  if (['yes', 'true', '1'].includes(t.oneway)) dir = 1;
  else if (t.oneway === '-1' || t.oneway === 'reverse') dir = -1;
  else if (t.oneway !== 'no' && (cls === 'motorway' || t.junction === 'roundabout' || t.junction === 'circular')) dir = 1;
  const defaults = DEFAULT_LANES[cls] || [2, 1];
  let lanes = parseInt(t.lanes || '', 10);
  if (!(lanes > 0 && lanes < 16)) lanes = dir ? defaults[1] : defaults[0];
  let w = num(t.width);
  if (!(w >= 2 && w <= 60)) w = cls === 'pedestrian' ? 6 : Math.max(dir ? 4 : 5.5, lanes * LANE + GUTTERS);
  const layer = parseInt(t.layer || '0', 10) || 0;
  let level = layer > 0 ? layer : 0;
  if (yes(t.bridge)) level = Math.max(1, layer);
  else if (yes(t.tunnel) && t.tunnel !== 'building_passage') level = Math.min(-1, layer);
  return { cls, w, lanes, dir, level };
}

// Highway ways split into pieces between junctions: a piece ends wherever another kept way shares its node (and at the
// way's ends). Each piece: { name, cls, w, lanes, dir, level, nodes (OSM ids), pts (world) }
export function streetPieces(elements, toWorld, keep = (t) => VEHICLE_CLASSES.includes(t.highway)) {
  const ways = elements.filter((e) => e.type === 'way' && e.tags && e.tags.highway && e.tags.area !== 'yes' && e.geometry && keep(e.tags));
  const uses = new Map();
  for (const w of ways) for (const id of new Set(w.nodes)) uses.set(id, (uses.get(id) || 0) + 1);
  const pieces = [];
  for (const w of ways) {
    const t = w.tags;
    const attrs = roadAttrs(t);
    const name = t.name || t.ref || '';
    const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
    let s = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && uses.get(w.nodes[i]) < 2) continue;
      pieces.push({ name, ...attrs, osm: w.id, nodes: w.nodes.slice(s, i + 1), pts: pts.slice(s, i + 1) });
      s = i;
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------------------------------------------------
// Land from the coastline
// ---------------------------------------------------------------------------------------------------------------------
// OSM coastline ways keep the land on their left (geographically). Drawn into a raster as an 8-connected barrier, they
// split it into 4-connected regions; samples just beside every coastline segment vote each region land or water.
// Regions without votes (no coastline anywhere near) count as land. Only the cells inside `clip` (the ring the data was
// fetched over: coastline beyond it is missing) are classified, the rest is water. Returns a Raster: 1 land, 0 water.
export function coastLand(coastWays, toWorld, clip, res = 2) {
  const cb = bbox(clip);
  const x0 = cb.x0, z0 = cb.z0, x1 = cb.x1, z1 = cb.z1;
  const R = new Raster(x0, z0, x1, z1, res);
  const { w: W, h: H } = R;
  const cellOf = (x, z) => {
    const i = Math.floor((x - R.x0) / res), j = Math.floor((z - R.z0) / res);
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  const lines = coastWays.filter((e) => e.type === 'way' && e.geometry).map((e) => e.geometry.map((g) => toWorld(g.lon, g.lat)));
  const BARRIER = 2;
  for (const pts of lines) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const n = Math.ceil((Math.hypot(bx - ax, bz - az) * 3) / res) + 1;
      for (let s = 0; s <= n; s++) {
        const c = cellOf(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
        if (c >= 0) R.d[c] = BARRIER;
      }
    }
  }
  const inside = new Raster(x0, z0, x1, z1, res);
  inside.fillRing(clip, 1);
  const open = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) open[k] = inside.d[k] && R.d[k] !== BARRIER ? 1 : 0;
  const { lab, comps } = labelComponents(open, W, H);
  const votes = new Float64Array(comps.length + 1);
  for (const pts of lines) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      // world (x east, z south) is a mirror image of (east, north): the geographic right (water) is (-dz, dx)
      const wx = -(bz - az) / L, wz = (bx - ax) / L;
      const n = Math.max(1, Math.round(L / res));
      for (let s = 0; s < n; s++) {
        const px = ax + ((bx - ax) * (s + 0.5)) / n, pz = az + ((bz - az) * (s + 0.5)) / n;
        for (const [side, v] of [[1, 1], [-1, -1]]) {
          const c = cellOf(px + side * wx * res * 1.2, pz + side * wz * res * 1.2);
          if (c >= 0 && lab[c]) votes[lab[c]] += v; // + water side, - land side
        }
      }
    }
  }
  for (let k = 0; k < W * H; k++) R.d[k] = inside.d[k] && !(lab[k] && votes[lab[k]] > 0) ? 1 : 0;
  return R;
}

// Outlines of the raster's 4-connected regions of 1-cells of at least `minArea` m², clockwise in (x, z), each with the
// enclosed regions of 0-cells (lakes, rivers) of at least `minArea` as holes: [{ outer, holes }]
export function traceRegions(R, minArea, eps = 1.5) {
  const { w: W, h: H } = R;
  const trace = (lab, c) => {
    const ring = rdpRing(destair(traceLabel(lab, W, H, c, R.x0, R.z0, R.res), R.res * 1.5), eps);
    if (ringArea(ring) > 0) ring.reverse();
    return ring;
  };
  const big = (c) => c.n * R.res * R.res >= minArea;
  const land = labelComponents(R.d, W, H);
  const regions = [];
  for (const c of land.comps) {
    if (!big(c)) continue;
    const outer = trace(land.lab, c);
    if (outer.length >= 3) regions.push({ outer, holes: [] });
  }
  const wet = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) wet[k] = R.d[k] ? 0 : 1;
  const water = labelComponents(wet, W, H);
  for (const c of water.comps) {
    if (!big(c) || c.i0 === 0 || c.j0 === 0 || c.i1 === W - 1 || c.j1 === H - 1) continue; // open water reaches the edge
    const hole = trace(water.lab, c);
    if (hole.length < 3) continue;
    const owner = regions.find((r) => pointInRing(hole[0][0], hole[0][1], r.outer));
    if (owner) owner.holes.push(hole);
  }
  return regions;
}
