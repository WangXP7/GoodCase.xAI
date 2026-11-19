// City compiler: raw PLATEAU / OSM / GSI data -> streaming tiles in public/tiles/<area>/.
//   manifest.json   area, origin, bounds, tile list, terrain grid description, attribution
//   terrain.bin     Float32 height grid (TP metres), row-major, rows run north -> south (+z)
//   t_<x>_<z>.bin   per 256 m tile: buildings, ground surfaces (roads, paint, parks, water), props (trees,
//                   poles, lights, signals) and wires (format: src/shared/tileformat.js)
//   roads.json      drivable road graph from OSM (junction nodes + polyline edges; y = road level, above the
//                   ground on bridges and the elevated expressway)
//   structures.json footbridges, station platforms and canopies (tools/pipeline/extras.mjs)
//   x_<x>_<z>.bin   per tile, where there are any: PLATEAU's own 3D models of bridges, street furniture and
//                   trees as one static mesh (tools/pipeline/meshes.mjs)
//   r_<x>_<z>.jpg   per tile, where there are any: PLATEAU's aerial photos of the LOD2 roofs, packed into one atlas
//   w_<x>_<z>.jpg   the same for the walls (shown from a distance)
//   rails.json      surface and elevated railway lines from OSM, with their height profile (y = track bed)
// Usage: node tools/pipeline/compile.mjs [--area=shibuya] [--no-ads]   (--no-ads: leave out the invented billboards, screens and banners)
import fs from 'node:fs';
import path from 'node:path';
import { resolveArea, ROOT } from './config.mjs';
import { makeProjection, TILE, tileOf, tileKey } from '../../src/shared/geo.js';
import { encodeTile, AREA, BFLAG, PROP, VERSION } from '../../src/shared/tileformat.js';
import { readBuildings, readRoads } from './citygml.mjs';
import { readOsm, buildRoadGraph, buildRailways } from './osm.mjs';
import { buildHeightGrid, sampleGrid, buildBackdropGrid } from './terrain.mjs';
import { BACKDROP, AREAS } from './config.mjs';
import { PolyIndex, readLand, clipRing, placeProps } from './landscape.mjs';
import { buildMarkings } from './markings.mjs';
import { splitOutlineRoads } from './roadsplit.mjs';
import { profileRailways } from './rails.mjs';
import { readPlaces, placeSigns, placeAds } from './signs.mjs';
import { placeFurniture } from './furniture.mjs';
import { readExtra, buildExtras } from './extras.mjs';
import { readModels, encodeMesh } from './meshes.mjs';
import { bakePhotos } from './photos.mjs';
import { SPORT, MATERIAL } from '../../src/shared/tileformat.js';
import { inRings } from './landscape.mjs';
import { profileRoads, flyover, BANK } from './roadprofile.mjs';
import { DECK_FLAG, CORRIDOR_MARGIN, projectOnDeck } from '../../src/shared/decks.js';

const TERRAIN_STEP = 5; // metres, matches the GSI 5 m DEM

const area = resolveArea();
const proj = makeProjection(...area.origin);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);

const [minX, maxZ] = proj.project(area.bbox.west, area.bbox.south);
const [maxX, minZ] = proj.project(area.bbox.east, area.bbox.north);
const bounds = { minX, maxX, minZ, maxZ };
const inBounds = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
log(`area ${area.id}: ${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m around [${area.origin}]`);

// ---------------------------------------------------------------- geometry helpers
const r2 = (v) => Math.round(v * 100) / 100;
// Signed area seen from above, positive = counter-clockwise (x east, -z north).
const areaEN = (ring) => {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    s += x2 * z1 - x1 * z2;
  }
  return s / 2;
};

// lon/lat ring -> clean world ring: closing point dropped, near-duplicate and collinear points removed.
function cleanRing(ll) {
  let pts = ll.map(([lon, lat]) => proj.project(lon, lat)).map(([x, z]) => [r2(x), r2(z)]);
  if (pts.length > 1) { const [a, b] = [pts[0], pts.at(-1)]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02) pts.pop(); }
  pts = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.02; });
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (Math.abs(cross) / Math.max(len, 1e-6) < 0.01) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts.length >= 3 ? pts : null;
}

// [[outer, ...holes]] in lon/lat -> world polygons with outer CCW and holes CW; drops slivers.
function cleanPolygons(polys, minArea = 0.5) {
  const out = [];
  for (const rings of polys) {
    const outer = cleanRing(rings[0]);
    if (!outer || Math.abs(areaEN(outer)) < minArea) continue;
    if (areaEN(outer) < 0) outer.reverse();
    const holes = [];
    for (const h of rings.slice(1)) {
      const ring = cleanRing(h);
      if (!ring || Math.abs(areaEN(ring)) < 0.1) continue;
      if (areaEN(ring) > 0) ring.reverse();
      holes.push(ring);
    }
    out.push([outer, ...holes]);
  }
  return out;
}

const centroidOf = (polys) => {
  let sx = 0, sz = 0, sa = 0;
  for (const [outer] of polys) {
    const a = Math.abs(areaEN(outer));
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    sx += cx * a; sz += cz * a; sa += a;
  }
  return [sx / sa, sz / sa];
};

// ---------------------------------------------------------------- terrain
const grid = buildHeightGrid(path.join(area.rawDir, 'dem'), proj, bounds, TERRAIN_STEP);
let gMin = Infinity, gMax = -Infinity;
for (const v of grid.data) { gMin = Math.min(gMin, v); gMax = Math.max(gMax, v); }
log(`terrain ${grid.w} x ${grid.h} @ ${TERRAIN_STEP} m, ${gMin.toFixed(1)}..${gMax.toFixed(1)} m TP` +
  ` (${grid.stats.fallback} cells from dem10b, ${grid.stats.holes} filled)`);
const ground = (x, z) => sampleGrid(grid, x, z);

// ---------------------------------------------------------------- PLATEAU
const tiles = new Map();
const tileFor = (x, z) => {
  const [tx, tz] = tileOf(x, z), k = tileKey(tx, tz);
  if (!tiles.has(k)) tiles.set(k, { tx, tz, buildings: [], areas: [], props: [], wires: [], walls: [], signs: [] });
  return tiles.get(k);
};
// Point-in-polygon indexes used to place paint, trees and street furniture.
const idx = { building: new PolyIndex(), road: new PolyIndex(), carriageway: new PolyIndex(), sidewalk: new PolyIndex(), water: new PolyIndex() };
const plateauDir = path.join(area.rawDir, 'plateau');
const gmlFiles = (type) => fs.readdirSync(plateauDir).filter((f) => new RegExp(`^\\d{8}_${type}(_\\d+)?\\.gml$`).test(f)).sort();

// bridges, street furniture and trees that PLATEAU gives as finished models
const models = readModels(plateauDir, proj.project, ground);
log(`models (PLATEAU): ${Object.entries(models.count).map(([k, v]) => `${k.split(':')[1]} ${v}`).join(', ')}; ${models.objects.reduce((s, o) => s + o.tris.length, 0)} triangles`);

const seen = new Set();
const bstats = { files: 0, read: 0, dup: 0, noSolid: 0, dropped: 0, lod2: 0, baseDiff: [], heights: [], usage: {} };
for (const f of gmlFiles('bldg')) {
  const list = readBuildings(path.join(plateauDir, f));
  bstats.files++; bstats.read += list.length;
  for (const b of list) {
    if (seen.has(b.id)) { bstats.dup++; continue; }
    seen.add(b.id);
    let polys, base, height, flags = b.lod2 ? BFLAG.LOD2 : 0;
    if (b.solid.length) {
      let lo = Infinity, hi = -Infinity;
      for (const rings of b.solid) for (const [, , h] of rings[0]) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      // The footprint is the solid's floor: the faces lying at the lowest height.
      polys = cleanPolygons(b.solid.filter((rings) => rings[0].every(([, , h]) => h - lo < 0.05)));
      base = lo; height = hi - lo;
    } else {
      polys = cleanPolygons(b.lod0);
      height = b.measuredHeight ?? 3 * (b.storeys || 1);
      flags |= BFLAG.NO_SOLID; bstats.noSolid++;
    }
    if (!polys.length || !(height > 0.5)) { bstats.dropped++; continue; }
    const [cx, cz] = centroidOf(polys);
    if (!inBounds(cx, cz)) { bstats.dropped++; continue; }
    const g = ground(cx, cz);
    if (base === undefined) base = g; else bstats.baseDiff.push(base - g);
    if (b.lod2) bstats.lod2++;
    bstats.heights.push(height);
    bstats.usage[b.usage ?? 0] = (bstats.usage[b.usage ?? 0] ?? 0) + 1;
    // LOD2 shell in world coordinates (closing points dropped; degenerate rings discarded)
    const surfaces = [];
    for (const s of b.surfaces) {
      let uv = s.uv && s.uv.map((u) => [...u]); // photo coordinates, kept in step with the points
      const rings = s.rings.map((ring, r) => {
        const pts = ring.map(([lon, lat, h]) => { const [x, z] = proj.project(lon, lat); return [r2(x), r2(h), r2(z)]; });
        if (pts.length > 1 && pts[0].every((v, k) => Math.abs(v - pts.at(-1)[k]) < 0.02)) { pts.pop(); uv?.[r].splice(-2); }
        return pts;
      });
      if (rings.some((r) => r.length < 3 || r.length >= 65000)) { if (rings[0].length < 3 || rings[0].length >= 65000) continue; rings.length = 1; uv = uv && [uv[0]]; }
      if (rings.length < 256 && surfaces.length < 65000) surfaces.push({ roof: s.roof, rings, image: uv ? s.image : null, photo: uv });
    }
    bstats.surfaces = (bstats.surfaces ?? 0) + surfaces.length;
    tileFor(cx, cz).buildings.push({ usage: b.usage, storeys: b.storeys, flags, base: r2(base), height: r2(height), measuredHeight: b.measuredHeight, polygons: polys, surfaces });
  }
  log(`  ${f}: ${list.length} buildings`);
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const nB = bstats.read - bstats.dup - bstats.dropped;
log(`buildings: ${nB} kept from ${bstats.files} files (${bstats.dup} duplicates across ward files, ${bstats.dropped} dropped, ` +
  `${bstats.noSolid} without LOD1 solid, ${bstats.lod2} with LOD2)`);
log(`  LOD2 shells: ${bstats.surfaces} surfaces`);
log(`  height median ${pct(bstats.heights, 0.5).toFixed(1)} m, p95 ${pct(bstats.heights, 0.95).toFixed(1)} m, max ${pct(bstats.heights, 1).toFixed(1)} m`);
const absDiff = bstats.baseDiff.map(Math.abs);
log(`  building base vs DEM: median |d| ${pct(absDiff, 0.5).toFixed(2)} m, p95 ${pct(absDiff, 0.95).toFixed(2)} m`);
log(`  usage codes: ${Object.entries(bstats.usage).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);

const seenRoads = new Set();
const rstats = { roads: 0, outlines: 0, areas: [0, 0, 0, 0, 0] };
const outlineOnly = []; // roads without a carriageway / sidewalk split: polygons [outer, ...holes]
for (const f of gmlFiles('tran')) {
  for (const r of readRoads(path.join(plateauDir, f))) {
    if (seenRoads.has(r.id)) continue;
    seenRoads.add(r.id); rstats.roads++;
    const push = (kind, code, raw) => {
      const polygons = cleanPolygons(raw, 0.2);
      if (!polygons.length) return;
      const [cx, cz] = centroidOf(polygons);
      if (!inBounds(cx, cz)) return;
      tileFor(cx, cz).areas.push({ kind, code, polygons });
      if (kind === AREA.ROAD) rstats.outlines++; else rstats.areas[kind]++;
      const index = kind === AREA.ROAD ? idx.road : kind === AREA.CARRIAGEWAY ? idx.carriageway : kind === AREA.SIDEWALK ? idx.sidewalk : null;
      if (index) for (const rings of polygons) index.add(rings);
      if (kind === AREA.ROAD && !r.areas.length) outlineOnly.push(...polygons);
    };
    push(AREA.ROAD, r.func ?? 0, r.outline);
    for (const a of r.areas) push(a.kind, a.code, a.polygons);
  }
}
log(`roads (PLATEAU): ${rstats.roads} roads, ${rstats.outlines} outlines; detailed areas: carriageway ${rstats.areas[AREA.CARRIAGEWAY]}, ` +
  `sidewalk ${rstats.areas[AREA.SIDEWALK]}, island ${rstats.areas[AREA.ISLAND]}, other ${rstats.areas[AREA.OTHER]}`);

// PLATEAU's LOD1 "buildings" include structures that are not buildings: expressway and railway decks,
// footbridges, ventilation shafts. Extruded from the ground they become blocks standing in the road.
// They carry no use and no storey count; drop those that lie in a road outline (flyovers and viaducts
// are built from the road and rail data instead).
let structures = 0;
for (const t of tiles.values()) {
  t.buildings = t.buildings.filter((b) => {
    const anonymous = (b.usage === 454 || b.usage === 461 || !b.usage) && !(b.storeys > 0 && b.storeys < 255);
    if (anonymous) {
      const ring = b.polygons[0][0], [cx, cz] = centroidOf(b.polygons);
      const inRoad = ring.filter(([x, z]) => idx.road.has(x, z)).length / ring.length;
      if (idx.road.has(cx, cz) && inRoad > 0.7) { structures++; return false; }
    }
    for (const rings of b.polygons) idx.building.add(rings);
    return true;
  });
}
log(`buildings: dropped ${structures} unnamed structures standing in a road`);

// ---------------------------------------------------------------- OSM
const osm = readOsm(path.join(area.rawDir, 'osm.json'));
const graph = buildRoadGraph(osm, proj.project, inBounds);
// road level per node: the ground, or above it on bridges and the elevated expressway
const { level, spans } = profileRoads(graph.edges, graph.pos, ground);
const roadsOut = {
  nodes: graph.nodes.map(({ id, p }) => [r2(p[0]), r2(level.get(id) ?? ground(p[0], p[1])), r2(p[1])]),
  edges: graph.edges.map((edge) => {
    edge.span = spans.has(edge) ? 1 : 0; // a street-level bridge: treated as an ordinary road from here on
    edge.flyover = flyover(edge) ? 1 : 0; // carried on its own structure above the streets
    const { ids, way, spanLength, spanEnds, ...e } = edge;
    return { ...e, way, pts: ids.flatMap((id) => { const [x, z] = graph.pos(id); return [r2(x), r2(level.get(id)), r2(z)]; }) };
  }),
};
const byClass = {};
let km = 0;
for (const e of graph.edges) {
  let len = 0;
  for (let i = 1; i < e.ids.length; i++) { const p = graph.pos(e.ids[i - 1]), q = graph.pos(e.ids[i]); len += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  byClass[e.highway] = (byClass[e.highway] ?? 0) + len / 1000; km += len / 1000;
}
log(`road graph (OSM): ${roadsOut.nodes.length} nodes, ${roadsOut.edges.length} edges, ${km.toFixed(1)} km`);
log(`  ${Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
log(`  bridges ${roadsOut.edges.filter((e) => e.bridge).length}, tunnels ${roadsOut.edges.filter((e) => e.tunnel).length}, oneway ${roadsOut.edges.filter((e) => e.oneway).length}`);
// The deck line runs BANK metres past each end, level, to cover the ground that slumps towards the dip.
const decks = roadsOut.edges.filter((e) => e.span).map((e) => {
  const p = e.pts, n = p.length;
  const out = (i, j) => { // point BANK metres beyond point i, away from point j
    const len = Math.hypot(p[i] - p[j], p[i + 2] - p[j + 2]) || 1;
    return [r2(p[i] + ((p[i] - p[j]) / len) * BANK), p[i + 1], r2(p[i + 2] + ((p[i + 2] - p[j + 2]) / len) * BANK)];
  };
  return { pts: [...out(0, 3), ...p, ...out(n - 3, n - 6)], half: Math.max(1, e.lanes) * 1.65 + CORRIDOR_MARGIN };
});
// Under a road bridge the terrain model shows the bridge, not the track bed below it.
const underBridge = (x, z) => decks.some((d) => { const p = projectOnDeck(d, x, z); return p.inside && p.dist <= d.half - CORRIDOR_MARGIN + 6; });
const rails = profileRailways(buildRailways(osm, proj.project, inBounds), ground, inBounds, underBridge, (x, z) => models.tops.at(x, z));
// Station buildings stand over the tracks, but PLATEAU gives them as solid blocks. Record where each track
// crosses a building outline so the client can put a tunnel mouth there: [x, y, z, dirX, dirZ], pointing in.
let portals = 0;
for (const line of rails) {
  const p = line.pts; // (line.portals already holds the tunnel mouths)
  for (let i = 3; i < p.length; i += 3) {
    const len = Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]);
    if (len < 0.01) continue;
    const at = (d) => [p[i - 3] + ((p[i] - p[i - 3]) * d) / len, p[i - 2] + ((p[i + 1] - p[i - 2]) * d) / len, p[i - 1] + ((p[i + 2] - p[i - 1]) * d) / len];
    let was = idx.building.has(p[i - 3], p[i - 1]);
    for (let d = 0.5; d <= len; d += 0.5) {
      const q = at(Math.min(d, len)), now = idx.building.has(q[0], q[2]);
      if (now !== was) {
        const s = now ? 1 : -1; // direction pointing into the building
        line.portals.push([r2(q[0]), r2(q[1]), r2(q[2]), r2((s * (p[i] - p[i - 3])) / len), r2((s * (p[i + 2] - p[i - 1])) / len)]);
        portals++; was = now;
      }
    }
  }
}
log(`railways: ${portals} portals where tracks pass through buildings`);
log(`railways (OSM): ${rails.length} lines (${rails.filter((r) => r.bridge).length} elevated sections, ${rails.filter((r) => r.deck.length).length} on surveyed decks)`);

// Roads PLATEAU maps only as an outline get their carriageway from the OSM centrelines; the rest is sidewalk.
const extraRaw = readExtra(path.join(area.rawDir, 'osm_extra.json'), proj.project);
// pedestrian streets and paths in the open, as lines (stairs, bridges and passages are not streets)
const walkLines = extraRaw.ways.filter((w) => ['pedestrian', 'footway', 'path'].includes(w.tags.highway) && !w.closed && !w.tags.bridge && !w.tags.tunnel
  && w.tags.indoor !== 'yes' && !['sidewalk', 'crossing', 'link'].includes(w.tags.footway)).map((w) => w.pts);
const split = splitOutlineRoads({ outlines: outlineOnly, edges: graph.edges, pos: graph.pos, idxRoad: idx.road, walkLines });
for (const [kind, polys, index] of [[AREA.CARRIAGEWAY, split.carriageway, idx.carriageway], [AREA.SIDEWALK, split.sidewalk, idx.sidewalk]]) {
  for (const rings of polys) {
    const polygon = rings.map((r) => r.map(([x, z]) => [r2(x), r2(z)]));
    index.add(polygon);
    const [cx, cz] = centroidOf([polygon]);
    tileFor(Math.min(Math.max(cx, minX), maxX - 0.01), Math.min(Math.max(cz, minZ), maxZ - 0.01)).areas.push({ kind, code: 0, polygons: [polygon] });
  }
}
log(`outline-only roads: ${outlineOnly.length} polygons -> ${split.carriageway.length} carriageway, ${split.sidewalk.length} sidewalk pieces` +
  ` (${split.pedestrian} pedestrian streets, ${split.untouched} without any OSM way, ${split.failed} failed to clip)`);

// ---------------------------------------------------------------- land cover, paint, props
const landRaw = readLand(path.join(area.rawDir, 'osm_land.json'));
const xz = (ll) => ll.map(([lon, lat]) => proj.project(lon, lat));
const land = landRaw.areas.map(({ kind, ring, code }) => {
  const r = xz(ring).slice(0, -1); // drop the closing point
  if (areaEN(r) < 0) r.reverse();
  return { kind, ring: r, code: kind === AREA.PITCH ? code : 0 };
}).filter((a) => a.ring.length >= 3 && Math.abs(areaEN(a.ring)) > 4);
for (const a of land) if (a.kind === AREA.WATER) idx.water.add([a.ring]);
idx.park = new PolyIndex(); // (paths in a park get lamps)
for (const a of land) if (a.kind === AREA.PARK) idx.park.add([a.ring]);
// Large areas (a park can span a kilometre) are cut at tile edges so they stream with their tile.
const lstats = {};
const pushClipped = (kind, ring, code = 0) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let tx = Math.floor(Math.max(x0, minX) / TILE); tx <= Math.floor(Math.min(x1, maxX) / TILE); tx++)
    for (let tz = Math.floor(Math.max(z0, minZ) / TILE); tz <= Math.floor(Math.min(z1, maxZ) / TILE); tz++) {
      const piece = clipRing(ring, tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE);
      if (!piece || Math.abs(areaEN(piece)) < 1) continue;
      tileFor((tx + 0.5) * TILE, (tz + 0.5) * TILE).areas.push({ kind, code, polygons: [[piece.map(([x, z]) => [r2(x), r2(z)])]] });
    }
};
const courtLines = [];
for (const { kind, ring, code } of land) {
  lstats[kind] = (lstats[kind] ?? 0) + 1;
  pushClipped(kind, ring, code);
  // a tennis court gets its lines: the outline, the net and the service boxes, fitted to the pitch
  if (kind === AREA.PITCH && code === SPORT.TENNIS) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      if (!best || len > best.len) best = { len, dx: (bx - ax) / (len || 1), dz: (bz - az) / (len || 1) };
    }
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const { dx, dz } = best, at = (u, v) => [cx + dx * u - dz * v, cz + dz * u + dx * v];
    const line = (u0, v0, u1, v1) => { const w = 0.05, along = Math.abs(u1 - u0) > Math.abs(v1 - v0); courtLines.push(along ? [at(u0, v0 - w), at(u1, v0 - w), at(u1, v0 + w), at(u0, v0 + w)] : [at(u0 - w, v0), at(u0 + w, v0), at(u0 + w, v1), at(u0 - w, v1)]); };
    const L = 11.885, W = 5.485, S = 4.115; // half length, half width (doubles), half width (singles)
    if ([at(-L, -W), at(L, -W), at(L, W), at(-L, W)].every(([x, z]) => inRings(x, z, [ring]))) { // only where a full court fits
      for (const v of [-W, -S, S, W]) line(-L, v, L, v);
      for (const u of [-L, -6.4, 0, 6.4, L]) line(u, Math.abs(u) === 6.4 ? -S : -W, u, Math.abs(u) === 6.4 ? S : W);
      line(-6.4, 0, 6.4, 0);
    }
  }
}
const kindName = Object.fromEntries(Object.entries(AREA).map(([k, v]) => [v, k.toLowerCase()]));
log(`land cover (OSM): ${Object.entries(lstats).map(([k, v]) => `${kindName[k]} ${v}`).join(', ')}`);

const worldLand = {
  stops: extraRaw.points.filter((p) => p.tags.highway === 'stop').map((p) => p.id),
  crossings: landRaw.crossings.map(xz), signals: landRaw.signals,
  crossingNodes: landRaw.crossingNodes,
};
const paint = buildMarkings({ edges: graph.edges, pos: graph.pos, idx, land: worldLand, inBounds });
for (const m of paint.marks) {
  const ring = m.ring.map(([x, z]) => [r2(x), r2(z)]);
  if (areaEN(ring) < 0) ring.reverse();
  const cx = ring.reduce((s, p) => s + p[0], 0) / 4, cz = ring.reduce((s, p) => s + p[1], 0) / 4;
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: m.kind, code: 0, polygons: [[ring]] });
}
// Street-level bridges. Every road polygon touching a bridge's corridor is tied to that deck (the client
// holds it at deck level between the banks), and the edges of those polygons that face open air over the
// dip get a parapet.
const GROUND_KINDS = new Set([AREA.PARK, AREA.WOOD, AREA.WATER, AREA.PITCH]);
let deckAreas = 0, deckWalls = 0;
for (const t of tiles.values()) {
  for (const a of t.areas) {
    if (GROUND_KINDS.has(a.kind)) continue;
    const deck = decks.findIndex((d) => a.polygons.some((rings) => rings[0].some(([x, z]) => { const p = projectOnDeck(d, x, z); return p.inside && p.dist <= d.half; })));
    if (deck < 0) continue;
    a.code = DECK_FLAG | deck; deckAreas++;
    if (a.kind !== AREA.ROAD) continue;
    // outer rings only: a hole in a road outline is a median or a pier, not the edge of the bridge
    for (const [ring] of a.polygons) for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, p = projectOnDeck(decks[deck], mx, mz);
      if (!p.inside || p.y - ground(mx, mz) < 1.5) continue;                 // on the bank: no drop here
      // Open air beyond? PLATEAU's road polygons leave gaps of a few metres in the middle of a bridge, so
      // an edge counts as the side of the bridge only if no road surface follows within 9 m.
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      if ([0.5, 1.5, 3, 5, 7, 9].some((d) => idx.road.has(mx + nx * d, mz + nz * d)) || len < 1.5) continue;
      t.walls.push([ax, az, bx, bz, deck]); deckWalls++;
    }
  }
}
log(`street bridges: ${decks.length} decks, ${deckAreas} polygons on them, ${deckWalls} parapet segments`);

// ---- everything else OSM maps: paths, stairs, platforms, car parks, barriers, water, gates, small objects
const roadAt = new Map();
for (const e of graph.edges) e.ids.forEach((id, i) => {
  const p = graph.pos(e.ids[Math.max(0, i - 1)]), q = graph.pos(e.ids[Math.min(e.ids.length - 1, i + 1)]), l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  roadAt.set(id, { dx: (q[0] - p[0]) / l, dz: (q[1] - p[1]) / l });
});
const extras = buildExtras(extraRaw, { idx, ground, inBounds, rails, roadAt });
const centre = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const rounded = (ring) => { const r = ring.map(([x, z]) => [r2(x), r2(z)]); if (areaEN(r) < 0) r.reverse(); return r; };
for (const a of extras.areas) {
  if (a.clip) { pushClipped(a.kind, a.ring, a.code); continue; }
  const [cx, cz] = centre(a.ring);
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: a.kind, code: a.code, polygons: [[rounded(a.ring)]] });
}
for (const m of [...extras.marks, ...courtLines.map((ring) => ({ kind: AREA.MARK_WHITE, ring }))]) {
  const [cx, cz] = centre(m.ring);
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: m.kind, code: 0, polygons: [[rounded(m.ring)]] });
}
// a footbridge PLATEAU has as a model is not built a second time from the OSM line
const osmBridges = extras.structures.footbridges.length;
extras.structures.footbridges = extras.structures.footbridges.filter((f) => models.tops.cover(f.pts) < 0.5);
extras.count['footbridges replaced by PLATEAU models'] = osmBridges - extras.structures.footbridges.length;
for (const b of extras.barriers) tileFor((b[0] + b[2]) / 2, (b[1] + b[3]) / 2).walls.push(b);
fs.mkdirSync(area.outDir, { recursive: true });
log(`OSM extras: ${Object.entries(extras.count).map(([k, v]) => `${k} ${v}`).join(', ')}`);

const placed = placeProps({
  land, trees: landRaw.trees.map(([lon, lat, g]) => [...proj.project(lon, lat), g]), treeRows: landRaw.treeRows.map((row) => Object.assign(xz(row), { genus: row.genus })), vending: xz(landRaw.vending),
  edges: roadsOut.edges, idx, inBounds,
});
const allProps = [...placed.props, ...paint.props, ...extras.props];
for (const p of allProps) tileFor(p.x, p.z).props.push({ ...p, x: r2(p.x), z: r2(p.z) });
for (const w of placed.wires) tileFor(w[0], w[1]).wires.push(w.map(r2));
const propName = Object.fromEntries(Object.entries(PROP).map(([k, v]) => [v, k.toLowerCase()]));
const pcount = {};
for (const p of allProps) pcount[propName[p.kind]] = (pcount[propName[p.kind]] ?? 0) + 1;
log(`paint: ${paint.marks.length} marks; props: ${Object.entries(pcount).map(([k, v]) => `${k} ${v}`).join(', ')}; wires ${placed.wires.length}`);

// ---------------------------------------------------------------- OSM building hints
// building:colour and building:material, where a mapper recorded them, override the generated finish.
const CSS = { white: 0xf2f2f0, black: 0x1c1c1e, grey: 0x9a9a9a, gray: 0x9a9a9a, gainsboro: 0xdcdcdc, yellow: 0xe6cf5a, brown: 0x7a5236, beige: 0xe6dcc0, red: 0xa83232, blue: 0x3a5f95, green: 0x4f7d4f, orange: 0xd98a3a, pink: 0xe6a8b8, silver: 0xc0c0c0, cream: 0xf3ead2 };
const MATERIALS = { concrete: MATERIAL.CONCRETE, cement: MATERIAL.CONCRETE, glass: MATERIAL.GLASS, 'concrete/glass': MATERIAL.GLASS, metal: MATERIAL.METAL, metal_plates: MATERIAL.METAL,
  wood: MATERIAL.METAL, tiles: MATERIAL.TILE, brick: MATERIAL.BRICK, plaster: MATERIAL.PLASTER };
let hinted = 0;
for (const w of extraRaw.ways) {
  const colour = (w.tags['building:colour'] ?? '').split(';')[0].trim().toLowerCase(), material = MATERIALS[w.tags['building:material']];
  if (!w.tags.building || (!colour && !material)) continue;
  const rgb = /^#?[0-9a-f]{6}$/.test(colour) ? Number.parseInt(colour.replace('#', ''), 16) : CSS[colour];
  const hint = ((rgb != null ? 0x80000000 | rgb : 0) | ((material ?? 0) << 24)) >>> 0;
  if (!hint) continue;
  const [cx, cz] = centre(w.pts);
  if (!inBounds(cx, cz)) continue;
  // the PLATEAU building under the middle of the OSM outline (it may be filed under a neighbouring tile)
  const [tx, tz] = [Math.floor(cx / TILE), Math.floor(cz / TILE)];
  search: for (let i = tx - 1; i <= tx + 1; i++) for (let j = tz - 1; j <= tz + 1; j++)
    for (const b of tiles.get(tileKey(i, j))?.buildings ?? []) if (b.polygons.some((rings) => inRings(cx, cz, rings))) { b.hint = hint; hinted++; break search; }
}
log(`OSM building hints: ${hinted} buildings with a mapped colour or material`);
// Steel lattice towers (Tokyo Tower): PLATEAU has their outline as a closed shell; the client draws it as open steelwork.
let lattice = 0;
for (const e of JSON.parse(fs.readFileSync(path.join(area.rawDir, 'osm_poi.json'), 'utf8')).elements) {
  const t = e.tags ?? {}, at = e.center ?? e;
  if (t.man_made !== 'tower' || t['tower:construction'] !== 'lattice' || at.lat == null) continue;
  const [cx, cz] = proj.project(at.lon, at.lat), [tx, tz] = [Math.floor(cx / TILE), Math.floor(cz / TILE)];
  search: for (let i = tx - 1; i <= tx + 1; i++) for (let j = tz - 1; j <= tz + 1; j++)
    for (const b of tiles.get(tileKey(i, j))?.buildings ?? []) if (b.polygons.some((rings) => inRings(cx, cz, rings))) { b.flags |= BFLAG.LATTICE; lattice++; break search; }
}
log(`lattice towers (OSM): ${lattice}`);

// ---------------------------------------------------------------- signboards
const places = readPlaces(path.join(area.rawDir, 'osm_poi.json'), proj.project);
const signBuildings = [...tiles.values()].flatMap((t) => t.buildings.map((b) => ({ ring: b.polygons[0][0], base: b.base, height: b.height, usage: b.usage, storeys: b.storeys < 255 ? b.storeys : 0 })));
const signs = placeSigns(places, signBuildings, (x, z) => idx.road.has(x, z));
// Billboards, screens and banners are invented, not mapped data: --no-ads leaves them out.
const ads = process.argv.includes('--no-ads') ? [] : placeAds(signBuildings); // (the origin is the Scramble Crossing)
signs.push(...ads);
log(`ads: ${ads.filter((s) => s.style === 3).length} billboards, ${ads.filter((s) => s.style === 4).length} screens, ${ads.filter((s) => s.style === 5).length} rooftop boards, ${ads.filter((s) => s.style === 6).length} banners`);
for (const s of signs) if (inBounds(s.x, s.z)) tileFor(s.x, s.z).signs.push({ ...s, x: r2(s.x), y: r2(s.y), z: r2(s.z), w: r2(s.w), h: r2(s.h) });
log(`signs: ${signs.length} from ${places.length} named places (fascia ${signs.filter((s) => s.style === 0).length}, blade ${signs.filter((s) => s.style === 1).length}, building names ${signs.filter((s) => s.style === 2).length})`);

// ---------------------------------------------------------------- street furniture
const furniture = placeFurniture(path.join(area.rawDir, 'osm_poi.json'), proj.project, idx, ground, inBounds);
for (const p of furniture.props) tileFor(p.x, p.z).props.push({ ...p, x: r2(p.x), z: r2(p.z) });
for (const s of furniture.signs) tileFor(s.x, s.z).signs.push({ ...s, x: r2(s.x), y: r2(s.y), z: r2(s.z), w: r2(s.w), h: r2(s.h) });
log(`street furniture (OSM): ${Object.entries(furniture.count).map(([k, v]) => `${propName[k]} ${v}`).join(', ')}`);

// ---------------------------------------------------------------- PLATEAU models against generated objects
// One of each: a surveyed tree or subway entrance replaces the generated one; a generated street light or
// signal (they light up, and the signals run with the traffic) keeps its place and the model is left out.
{
  const near = (list, x, z, r) => list.some((p) => Math.hypot(p.x - x, p.z - z) < r);
  const all = [...tiles.values()].flatMap((t) => t.props);
  const lights = all.filter((p) => p.kind === PROP.LIGHT), signals = all.filter((p) => p.kind === PROP.SIGNAL);
  const before = models.objects.length;
  models.objects = models.objects.filter((o) => !(o.type === 'frn' && ((o.code === 4200 && near(lights, o.x, o.z, 8)) || (o.code === 4900 && near(signals, o.x, o.z, 10)))));
  const trees = models.objects.filter((o) => o.type === 'veg' && o.code === 0), entrances = models.objects.filter((o) => o.type === 'frn' && o.code === 4020);
  let removed = 0;
  for (const t of tiles.values()) {
    const n = t.props.length;
    t.props = t.props.filter((p) => !((p.kind === PROP.TREE && near(trees, p.x, p.z, 4)) || (p.kind === PROP.SUBWAY && near(entrances, p.x, p.z, 12))));
    removed += n - t.props.length;
  }
  let tris = 0;
  for (const o of models.objects) for (const t of o.tris) {
    const x = (t.a[0] + t.b[0] + t.c[0]) / 3, z = (t.a[2] + t.b[2] + t.c[2]) / 3;
    if (!inBounds(x, z)) continue;
    (tileFor(x, z).mesh ??= []).push(t); tris++;
  }
  log(`models: ${models.objects.length} objects kept (${before - models.objects.length} lights and signals left to the generated ones), ${tris} triangles; ${removed} generated trees and subway entrances replaced`);
}

// ---------------------------------------------------------------- write
fs.rmSync(area.outDir, { recursive: true, force: true });
fs.mkdirSync(area.outDir, { recursive: true });
// PLATEAU's photos: a roof atlas per tile, and the colour of each building's walls
const photos = { tiles: 0, roofs: 0, walls: 0, colours: 0, bytes: 0 };
for (const t of tiles.values()) {
  const roofFile = `r_${t.tx}_${t.tz}.jpg`, wallFile = `w_${t.tx}_${t.tz}.jpg`;
  const baked = await bakePhotos(t, plateauDir, path.join(area.outDir, roofFile), path.join(area.outDir, wallFile));
  if (baked.roofs) t.atlas = roofFile;
  if (baked.walls) t.wallAtlas = wallFile;
  if (baked.roofs || baked.walls) photos.tiles++;
  for (const k of ['roofs', 'walls', 'colours', 'bytes']) photos[k] += baked[k];
}
log(`photos (PLATEAU): ${photos.roofs} roofs and ${photos.walls} sets of walls in the atlases of ${photos.tiles} tiles (${(photos.bytes / 1e6).toFixed(1)} MB), ${photos.colours} buildings take their wall colour from the photo`);
let bytes = 0;
const tileList = [];
for (const t of [...tiles.values()].sort((a, b) => a.tz - b.tz || a.tx - b.tx)) {
  const file = `t_${t.tx}_${t.tz}.bin`, buf = encodeTile(t);
  fs.writeFileSync(path.join(area.outDir, file), buf);
  bytes += buf.length;
  const entry = { x: t.tx, z: t.tz, file, buildings: t.buildings.length, areas: t.areas.length, props: t.props.length, signs: t.signs.length, bytes: buf.length };
  if (t.atlas) entry.atlas = t.atlas;
  if (t.wallAtlas) entry.walls = t.wallAtlas;
  if (t.mesh) {
    entry.mesh = `x_${t.tx}_${t.tz}.bin`;
    const m = encodeMesh(t.mesh);
    fs.writeFileSync(path.join(area.outDir, entry.mesh), m);
    bytes += m.length;
  }
  tileList.push(entry);
}
fs.writeFileSync(path.join(area.outDir, 'terrain.bin'), Buffer.from(grid.data.buffer));
// junction nodes with traffic signals (indices into roads.json nodes), for the traffic simulation
const signalIds = new Set(landRaw.signals);
roadsOut.signals = graph.nodes.map((n, i) => (signalIds.has(n.id) ? i : -1)).filter((i) => i >= 0);
fs.writeFileSync(path.join(area.outDir, 'roads.json'), JSON.stringify(roadsOut));
fs.writeFileSync(path.join(area.outDir, 'rails.json'), JSON.stringify(rails));
fs.writeFileSync(path.join(area.outDir, 'structures.json'), JSON.stringify(extras.structures));
// the land around the area, for the horizon (config: backdrop)
let backdrop = null;
if (area.backdropBbox) {
  const b = area.backdropBbox, [bx0, bz1] = proj.project(b.west, b.south), [bx1, bz0] = proj.project(b.east, b.north);
  const g = buildBackdropGrid(path.join(area.rawDir, 'dem'), proj, { minX: bx0, maxX: bx1, minZ: bz0, maxZ: bz1 }, BACKDROP.step, BACKDROP.zoom);
  fs.writeFileSync(path.join(area.outDir, 'backdrop.bin'), Buffer.from(g.data.buffer));
  let top = 0;
  for (const v of g.data) top = Math.max(top, v);
  backdrop = { file: 'backdrop.bin', x0: r2(g.x0), z0: r2(g.z0), step: g.step, w: g.w, h: g.h };
  log(`backdrop ${g.w} x ${g.h} @ ${g.step} m, up to ${top.toFixed(0)} m`);
}
const manifest = {
  format: VERSION, area: area.id, name: area.name, compiled: new Date().toISOString(),
  origin: { lon: area.origin[0], lat: area.origin[1] },
  frame: 'metres; x east, y up (TP height), z south',
  tileSize: TILE, bounds: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, r2(v)])),
  meshes: area.meshes,
  terrain: { file: 'terrain.bin', x0: r2(grid.x0), z0: r2(grid.z0), step: grid.step, w: grid.w, h: grid.h, min: r2(gMin), max: r2(gMax) },
  roads: 'roads.json', rails: 'rails.json', structures: 'structures.json',
  ...(backdrop ? { backdrop } : {}),
  ...(area.view ? { view: area.view } : {}),
  // street-level bridge decks: road polygons marked with a deck, and street objects, follow these instead of the terrain (src/shared/decks.js)
  decks,
  tiles: tileList,
  attribution: [
    '3D city model, roof photos, bridges, street furniture: Project PLATEAU, MLIT Japan (CC BY 4.0 compatible PLATEAU terms)',
    'Elevation: Geospatial Information Authority of Japan (GSI) DEM tiles',
    'Road network and railways: © OpenStreetMap contributors (ODbL 1.0)',
  ],
};
fs.writeFileSync(path.join(area.outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
// the list of compiled areas, for the client's city switch
const order = (id) => { const i = Object.keys(AREAS).indexOf(id); return i < 0 ? 1e9 : i; };
const tilesDir = path.join(ROOT, 'public/tiles');
const compiled = fs.readdirSync(tilesDir).filter((d) => fs.existsSync(path.join(tilesDir, d, 'manifest.json')))
  .map((d) => ({ id: d, name: JSON.parse(fs.readFileSync(path.join(tilesDir, d, 'manifest.json'), 'utf8')).name }))
  .sort((p, q) => order(p.id) - order(q.id)); // (as listed in config.mjs)
fs.writeFileSync(path.join(tilesDir, 'areas.json'), JSON.stringify(compiled));
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
const size = (f) => fs.statSync(path.join(area.outDir, f)).size;
log(`wrote ${tileList.length} tiles (${mb(bytes)}), terrain ${mb(size('terrain.bin'))}, roads ${mb(size('roads.json'))}, rails ${mb(size('rails.json'))} -> ${path.relative(process.cwd(), area.outDir)}`);
