// tools/build-geodata.mjs
// Builds js/nyc-geodata.js: real New York geography in the simulation's 1:1 world frame, from NYC Open Data and
// OpenStreetMap. Frame: 1 unit = 1 m, x = Manhattan-grid east, z = grid south (north = -z), origin at the centreline
// intersection of 5th Ave & 42nd St, axes turned 29.0° from true north (the grid's measured bearing).
//
// Inputs (tools/data/, see tools/fetch-geodata.sh):
//   dcp_boroughs.json      NYC DCP Borough Boundaries (water areas excluded)  data.cityofnewyork.us gthc-hcne
//   cscl_manhattan.json    NYC street centerline (CSCL), Manhattan             data.cityofnewyork.us inkn-q76z
//   nycparks_manhattan.json NYC Parks properties, Manhattan                    data.cityofnewyork.us enfh-gkve
//   osm_*.json             OpenStreetMap via Overpass (Central Park features, piers, NJ coastline)
//
// usage: GEO_DATA=tools/data node tools/build-geodata.mjs [outFile]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFrame } from './city/frame.mjs';
import { r1, ringArea, bbox, rdp, rdpRing, pointInRing, centroid, Raster } from './city/geom.mjs';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const log = (...a) => console.log('[geodata]', ...a);

// =====================================================================================================================
// 1. FRAME
// =====================================================================================================================
const frame = makeFrame({
  lat0: 40.75318,
  lon0: -73.98185,
  theta: (29.017 * Math.PI) / 180, // refined below from the avenues
  origin: [0, 0] // grid (u, v) of 5th Ave & 42nd St, refined below
});
const { enu, gridUV, toWorld } = frame;

// =====================================================================================================================
// 2. FRAME CALIBRATION FROM THE CENTERLINE
// =====================================================================================================================
const cscl = load('cscl_manhattan.json');
function segLines(s) {
  const g = s.the_geom;
  if (!g) return [];
  return g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
}
{
  // Bearing: length-weighted median direction of the long straight avenue segments
  const AVE = new Set(['1 AVE', '2 AVE', '3 AVE', 'LEXINGTON AVE', 'PARK AVE', 'MADISON AVE', '5 AVE', 'AVE OF THE AMERICAS', '7 AVE', '8 AVE',
    '9 AVE', '10 AVE', 'AMSTERDAM AVE', 'COLUMBUS AVE', 'CENTRAL PARK W', 'YORK AVE', 'W  END AVE']);
  const angs = [];
  for (const s of cscl) {
    if (!AVE.has(s.full_street_name) || s.rw_type !== '1') continue;
    for (const ln of segLines(s)) {
      const [e0, n0] = enu(...ln[0]);
      const [e1, n1] = enu(...ln[ln.length - 1]);
      const L = Math.hypot(e1 - e0, n1 - n0);
      if (L < 60) continue;
      let a = (Math.atan2(e1 - e0, n1 - n0) * 180) / Math.PI;
      a = ((a % 180) + 180) % 180;
      angs.push([a, L]);
    }
  }
  angs.sort((p, q) => p[0] - q[0]);
  const tot = angs.reduce((t, a) => t + a[1], 0);
  let acc = 0;
  for (const [a, L] of angs) {
    acc += L;
    if (acc >= tot / 2) { frame.theta = (a * Math.PI) / 180; break; }
  }
  // Origin: the shared endpoint of 5 AVE and E/W 42 ST
  const ends = new Map();
  for (const s of cscl) {
    for (const ln of segLines(s)) {
      for (const p of [ln[0], ln[ln.length - 1]]) {
        const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
        if (!ends.has(k)) ends.set(k, { p, names: new Set() });
        ends.get(k).names.add(s.full_street_name);
      }
    }
  }
  for (const { p, names } of ends.values()) {
    if (names.has('5 AVE') && (names.has('E  42 ST') || names.has('W  42 ST'))) frame.origin = gridUV(p[0], p[1]);
  }
  log(`bearing ${(frame.theta * 180 / Math.PI).toFixed(3)}°, origin (5 Ave & 42 St) at grid ${frame.origin.map((v) => v.toFixed(1))}`);
}

// =====================================================================================================================
// 3. SHORELINES
// =====================================================================================================================
const dcp = load('dcp_boroughs.json');
const boro = {};
for (const f of dcp.features) {
  const rings = f.geometry.coordinates.map((poly) => poly[0].map(([lon, lat]) => toWorld(lon, lat)));
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  boro[f.properties.boroname] = rings;
}

// OSM piers (closed ways & multipolygons) in world coordinates, with names
const osmPiers = load('osm_piers.json');
const pierPolys = [];
for (const e of osmPiers.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && e.geometry && e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1]) {
    pierPolys.push({ name: t.name || '', ring: e.geometry.map((g) => toWorld(g.lon, g.lat)) });
  } else if (e.type === 'relation') {
    for (const m of e.members || []) {
      if (m.role === 'outer' && m.geometry) pierPolys.push({ name: t.name || '', ring: m.geometry.map((g) => toWorld(g.lon, g.lat)) });
    }
  }
}
log(`${pierPolys.length} OSM pier polygons`);

// --- Manhattan island: DCP polygon, minus the piers, opened to drop slivers, as a bulkhead line ---------------------
const RES = 2;
const mnRing = boro.Manhattan[0];
const mbb = bbox(mnRing);
const ras = new Raster(mbb.x0 - 60, mbb.z0 - 60, mbb.x1 + 60, mbb.z1 + 60, RES);
ras.fillRing(mnRing, 1);
const pierCells = new Raster(mbb.x0 - 60, mbb.z0 - 60, mbb.x1 + 60, mbb.z1 + 60, RES);
// Piers off the island: OSM pier polygons whose area lies mostly beyond a slightly eroded shore get cut out
for (const p of pierPolys) {
  const [cx, cz] = centroid(p.ring);
  if (cz < mbb.z0 - 200 || cz > mbb.z1 + 200 || cx < mbb.x0 - 600 || cx > mbb.x1 + 600) continue;
  pierCells.fillRing(p.ring, 1);
}
{
  // Grow the pier mask by 4 m: OSM pier outlines and DCP's pier decks differ by a few metres
  const toPier = pierCells.edt((x) => x === 1);
  const grow = (4 / RES) ** 2;
  for (let i = 0; i < ras.d.length; i++) if (toPier[i] <= grow) ras.d[i] = 0;
}
ras.open(9); // slivers & stubs narrower than ~18 m (pier necks, fender lines, pile fields)
ras.close(5); // notches left where pier decks met the bulkhead
ras.keepLargest();
let manhattan = ras.traceOuter();
manhattan = rdpRing(manhattan, 1.6);
if (ringArea(manhattan) > 0) manhattan.reverse(); // same winding as the old MANHATTAN_COASTLINE (negative shoelace area in x, z)
log(`Manhattan bulkhead ring: ${manhattan.length} pts, area ${(Math.abs(ringArea(manhattan)) / 1e6).toFixed(2)} km² (DCP ${(Math.abs(ringArea(mnRing)) / 1e6).toFixed(2)})`);

// Shore profile: westernmost / easternmost land x at every 2 m of z (outer crossings of the ring)
function shoreProfile(ring, step = 2) {
  const bb = bbox(ring);
  const z0 = Math.ceil(bb.z0 / step) * step;
  const n = Math.floor((bb.z1 - z0) / step) + 1;
  const west = new Float32Array(n), east = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const z = z0 + k * step + 1e-3;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, za] = ring[j];
      const [xb, zb] = ring[i];
      if ((za > z) !== (zb > z)) {
        const x = xa + ((z - za) * (xb - xa)) / (zb - za);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    west[k] = lo;
    east[k] = hi;
  }
  return { z0, step, west, east };
}

// --- Harbour islands (Manhattan borough parts) -----------------------------------------------------------------------
function nearestPart(rings, x, z) {
  let best = null, bd = Infinity;
  for (const r of rings) {
    const [cx, cz] = centroid(r);
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
const islands = {
  roosevelt: nearestPart(boro.Manhattan, 1793 - 54, -1825 + 69),
  randalls: nearestPart(boro.Manhattan, 1961 - 54, -6032 + 69),
  governors: nearestPart(boro.Manhattan, 750 - 54, 7705 + 69),
  liberty: nearestPart(boro.Manhattan, -1389 - 54, 8791 + 69),
  millRock: nearestPart(boro.Manhattan, 1674 - 54, -4358 + 69)
};
for (const k of Object.keys(islands)) {
  islands[k] = rdpRing(islands[k], 1.6);
  if (ringArea(islands[k]) > 0) islands[k].reverse();
  log(`island ${k}: ${islands[k].length} pts, ${(Math.abs(ringArea(islands[k])) / 1e6).toFixed(3)} km²`);
}

// --- Outer boroughs ---------------------------------------------------------------------------------------------------
function simplifyRings(rings, eps, minArea) {
  return rings.filter((r) => Math.abs(ringArea(r)) >= minArea).map((r) => {
    const s = rdpRing(r, eps);
    if (ringArea(s) > 0) s.reverse();
    return s;
  });
}
const boroughs = {
  brooklyn: simplifyRings(boro.Brooklyn, 6, 60000),
  queens: simplifyRings(boro.Queens, 6, 60000),
  bronx: simplifyRings(boro.Bronx, 6, 60000),
  statenIsland: simplifyRings(boro['Staten Island'], 8, 60000)
};
for (const [k, v] of Object.entries(boroughs)) log(`borough ${k}: ${v.length} rings, ${v.reduce((t, r) => t + r.length, 0)} pts`);

// --- New Jersey from the OSM coastline (land on the left of each way) -------------------------------------------------
function chainCoastline(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry);
  const byStart = new Map();
  for (const w of ways) byStart.set(w.nodes[0], w);
  const used = new Set();
  const chains = [];
  for (const w of ways) {
    if (used.has(w.id)) continue;
    // Walk back to the chain's first way
    let first = w;
    const seen = new Set([w.id]);
    for (;;) {
      const prev = ways.find((u) => !seen.has(u.id) && u.nodes[u.nodes.length - 1] === first.nodes[0]);
      if (!prev) break;
      seen.add(prev.id);
      first = prev;
      if (prev.id === w.id) break;
    }
    const nodes = [];
    let cur = first;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      const g = cur.geometry.map((p) => toWorld(p.lon, p.lat));
      nodes.push(...(nodes.length ? g.slice(1) : g));
      cur = byStart.get(cur.nodes[cur.nodes.length - 1]);
    }
    chains.push(nodes);
  }
  return chains;
}
const coastChains = chainCoastline(load('osm_coastline.json'));
coastChains.sort((a, b) => b.length - a.length);
log(`OSM coastline: ${coastChains.length} chains; longest ${coastChains.slice(0, 6).map((c) => c.length).join(', ')}`);

const geo = { THETA: frame.theta, ORIGIN: frame.origin, manhattan, islands, boroughs, coastChains, pierPolys, mnRing, shoreProfile };
export { geo, toWorld, gridUV, rdp, rdpRing, ringArea, bbox, pointInRing, Raster, r1, load, log, segLines, cscl, centroid };
