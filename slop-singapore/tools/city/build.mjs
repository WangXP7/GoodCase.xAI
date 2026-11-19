// tools/city/build.mjs — writes js/<city>-geodata.js: a city's geography in its 1:1 world frame from OpenStreetMap
// (tools/city/fetch.mjs downloads the layers). City-neutral counterpart of tools/build-geodata.mjs (New York's own data).
// usage: node --max-old-space-size=8192 tools/city/build.mjs <city> [out.js]
//
// Output (GEO, version 2): x = grid east, z = grid south (north = -z), 1 unit = 1 m, origin at the city's origin point,
// axes turned frame.bearingDeg from true north. Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.
//   detail      the detailed area's outline (blocks are kept inside it)
//   land        land masses (coastline land minus inland water): [outline, ...holes] each; water [{ name, ring }] the
//               inland water bodies
//   parks       [{ name, kind, rings }]
//   roadGraph   street centreline graph (tools/city/graph.mjs) of the vehicle roads at every level; each link ends with
//               [class index (roadGraph.classes), level (0 at grade, > 0 viaducts, < 0 tunnels), over water (1: a
//               bridge carrying its street across water at grade)]
//   blocks      as js/nyc-geodata.js: [outline, lot rects, park share, park name, rectangular, frontage frames | 0]
//   districts   [{ name, style, x, z, r }] building styles by neighbourhood (nearest centre within r), places [{ id, name,
//               sub, x, z }] teleport destinations & landmarks, labels [{ name, x, z, kind }] map labels (the config's)
//   trees       { shapes, credit, xz: [dx, dz (dm) from the tree before, ...], heights (m), shape: [index into shapes] }
//               the city's trees (or null)
//   vehicles    the city's vehicle liveries (js/city-common.js vehiclesFor), from its config
//   lawns       the land inside the blocks' property lines: [points, then each point's dx dz (dm) from the one before
//               (a ring's first from the previous ring's first), ...]
//   enforcement { gantries: [x, z (dm), ...] road pricing, speed: [x, z, limit km/h, ...] speed cameras, redLight: [x, z,
//               approach dx, dz (x100), ...] red light cameras } (or null)
//   buildings   { types, data: [rings, top dm, bottom dm, type index, per ring: points, then each point's dx dz (dm)
//               from the one before, a ring's first from the previous ring's first, ...] } OpenStreetMap's buildings &
//               building parts (or null: generated on the lots)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity, dataDir } from './config.mjs';
import { makeFrame, gridBearing } from './frame.mjs';
import { bbox, centroid, pointInRing, rdp, rdpRing, ringArea } from './geom.mjs';
import { extractBlocks, parkCoverage } from './blocks.mjs';
import { createGraph } from './graph.mjs';
import { areaPolygons, areaRings, coastLand, num, streetPieces, traceRegions, yes as yesTag, VEHICLE_CLASSES } from './osm.mjs';

const log = (...a) => console.log('[city]', ...a);
const q = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);

// Street classes whose carriageways bound blocks, and those the drivable graph keeps
const BLOCK_CLASSES = new Set([...VEHICLE_CLASSES.filter((c) => c !== 'service'), 'pedestrian']);
const GRAPH_CLASSES = VEHICLE_CLASSES.filter((c) => c !== 'service');

// `city`: a config (tools/city/cities/*.mjs) or its id; `data`: the downloads' directory (default: dataDir(city))
export async function buildCity(cityOrId, { out, data } = {}) {
  const city = typeof cityOrId === 'string' ? await loadCity(cityOrId) : cityOrId;
  const dir = data || dataDir(city);
  const load = (layer) => JSON.parse(fs.readFileSync(path.join(dir, `osm_${layer}.json`), 'utf8')).elements;
  const roadsOSM = load('roads');
  const coastOSM = load('coast');
  const waterOSM = load('water');
  const parksOSM = load('parks');
  log(`${city.name}: ${roadsOSM.length} highway ways, ${coastOSM.length} coastline ways, ${waterOSM.length} water & ${parksOSM.length} park areas`);

  // --- Frame -----------------------------------------------------------------------------------------------------------
  const frame = makeFrame({ lat0: city.origin.lat, lon0: city.origin.lon });
  const [S, Wd, N, E] = city.detail;
  const inDetailLL = (lon, lat) => lat > S && lat < N && lon > Wd && lon < E;
  if (city.bearing === 'auto') {
    const segs = [];
    for (const e of roadsOSM) {
      const t = e.tags || {};
      if (e.type !== 'way' || !e.geometry || !GRAPH_CLASSES.includes(t.highway) || /_link$/.test(t.highway) || t.bridge || t.tunnel) continue;
      for (let i = 0; i + 1 < e.geometry.length; i++) {
        const a = e.geometry[i], b = e.geometry[i + 1];
        if (inDetailLL(a.lon, a.lat)) segs.push([a.lon, a.lat, b.lon, b.lat]);
      }
    }
    frame.theta = gridBearing(frame, segs);
  } else {
    frame.theta = ((city.bearing || 0) * Math.PI) / 180;
  }
  const { toWorld } = frame;
  const bearingDeg = Math.round(((frame.theta * 180) / Math.PI) * 100) / 100;
  log(`frame: origin ${city.origin.label} (${city.origin.lat}, ${city.origin.lon}), bearing ${bearingDeg}°`);
  const box = (s, w, n, e) => [toWorld(w, n), toWorld(e, n), toWorld(e, s), toWorld(w, s)];
  const detail = box(S, Wd, N, E);
  const m = city.margin;
  const fetched = box(S - m, Wd - m, N + m, E + m);
  const fb = bbox(fetched);
  const X0 = Math.floor(fb.x0), X1 = Math.ceil(fb.x1), Z0 = Math.floor(fb.z0), Z1 = Math.ceil(fb.z1);

  // --- Land & water (2 m) ----------------------------------------------------------------------------------------------
  const land = coastLand(coastOSM, toWorld, fetched, 2);
  const water = [];
  for (const e of waterOSM) {
    const t = e.tags || {};
    if (yesTag(t.covered) || yesTag(t.tunnel) || t.water === 'wastewater') continue;
    for (const ring of areaRings(e, toWorld, 50)) {
      land.fillRing(ring, 0);
      if (Math.abs(ringArea(ring)) >= 400) water.push({ name: t.name || '', ring: rdpRing(ring, 0.8) });
    }
  }
  const [ox, oz] = toWorld(city.origin.lon, city.origin.lat);
  const landAt = (x, z) => land.d[Math.floor((z - land.z0) / land.res) * land.w + Math.floor((x - land.x0) / land.res)];
  if (!landAt(ox, oz)) throw new Error(`the origin (${city.origin.label}) came out as water: check the coastline data`);
  let landCells = 0;
  for (const v of land.d) landCells += v;
  const landRegions = traceRegions(land, 2000);
  log(`land: ${((landCells * 4) / 1e6).toFixed(2)} km² in the fetched box, ${landRegions.length} outlines with ${landRegions.reduce((t, r) => t + r.holes.length, 0)} holes; ${water.length} inland water bodies`);

  // Buildable: land more than `strip` m from water (or the data's edge)
  const buildable = new Uint8Array(land.d.length);
  {
    const toWater = land.edt((v) => v === 0);
    const rc = (city.strip / land.res) ** 2;
    for (let k = 0; k < buildable.length; k++) buildable[k] = land.d[k] && toWater[k] > rc ? 1 : 0;
  }

  // --- Streets -----------------------------------------------------------------------------------------------------------
  const pieces = streetPieces(roadsOSM, toWorld, (t) => BLOCK_CLASSES.has(t.highway));
  const roads = [];
  for (const p of pieces) {
    if (p.level !== 0) continue;
    for (let i = 0; i + 1 < p.pts.length; i++) roads.push({ x0: p.pts[i][0], z0: p.pts[i][1], x1: p.pts[i + 1][0], z1: p.pts[i + 1][1], r: p.w / 2 });
  }
  log(`${pieces.length} street pieces between junctions; ${roads.length} at-grade carriageway segments bound blocks`);

  // --- Blocks (1 m) ------------------------------------------------------------------------------------------------------
  const { blocks: all, raster: R, labels: lab } = extractBlocks({
    x0: X0, z0: Z0, x1: X1, z1: Z1, res: 1, sidewalk: city.sidewalk, roads, lawns: true, log,
    fillLand: (r) => {
      for (let j = 0; j < r.h; j++) {
        const jj = Math.floor((r.z0 + j + 0.5 - land.z0) / land.res);
        if (jj < 0 || jj >= land.h) continue;
        for (let i = 0; i < r.w; i++) {
          const ii = Math.floor((r.x0 + i + 0.5 - land.x0) / land.res);
          if (ii >= 0 && ii < land.w && buildable[jj * land.w + ii]) r.d[j * r.w + i] = 1;
        }
      }
    }
  });
  const blocks = all.filter((b) => pointInRing(...centroid(b.poly), detail));
  log(`${blocks.length} blocks inside the detail area (${blocks.filter((b) => b.rect).length} rectangular, ${blocks.filter((b) => b.frames).length} with frontage frames, ${blocks.filter((b) => !b.rects.length).length} without lots)`);

  // --- Parks -------------------------------------------------------------------------------------------------------------
  const parks = [];
  for (const e of parksOSM) {
    const t = e.tags || {};
    if (t.access === 'private' || t.access === 'no') continue;
    const rings = areaRings(e, toWorld, 300);
    if (rings.length) parks.push({ name: t.name || '', kind: t.leisure || t.landuse, rings });
  }
  parkCoverage(blocks, R, lab, parks);
  log(`${parks.length} parks; ${blocks.filter((b) => b.park > 0.6).length} blocks mostly park`);

  // --- Road graph --------------------------------------------------------------------------------------------------------
  const g = createGraph();
  const classIds = new Map(GRAPH_CLASSES.map((c, i) => [c, i]));
  // Share of a polyline over water (every 2 m)
  const overWater = (pts) => {
    let n = 0, wet = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s < steps; s++) {
        const x = ax + ((bx - ax) * (s + 0.5)) / steps, z = az + ((bz - az) * (s + 0.5)) / steps;
        n++;
        if (!landAt(x, z)) wet++;
      }
    }
    return n ? wet / n : 0;
  };
  let waterBridges = 0;
  for (const p of streetPieces(roadsOSM, toWorld, (t) => classIds.has(t.highway))) {
    if (!p.pts.some((pt) => pointInRing(pt[0], pt[1], fetched))) continue;
    const a = g.nodeByKey(p.nodes[0], ...p.pts[0]);
    const b = g.nodeByKey(p.nodes[p.nodes.length - 1], ...p.pts[p.pts.length - 1]);
    if (a === b && p.pts.length < 3) continue;
    // a bridge mostly over water carries its street across at grade (on a deck); one over land is a viaduct
    const wet = p.level > 0 && overWater(p.pts) >= 0.4 ? 1 : 0;
    waterBridges += wet;
    g.addLink(a, b, p.name, p.w, p.lanes, p.dir, rdp(p.pts, 0.4), [classIds.get(p.cls), wet ? 0 : p.level, wet]);
  }
  const roadGraph = { ...g.build(), classes: GRAPH_CLASSES };
  log(`road graph: ${roadGraph.nodes.length / 2} nodes, ${roadGraph.links.length} links (${waterBridges} bridges over water at grade)`);

  // --- Neighbourhoods, places & labels from the config, in the world frame ---------------------------------------------
  const at = ([lat, lon]) => toWorld(lon, lat).map(q);
  const districts = (city.districts || []).map((d) => { const [x, z] = at(d.at); return { name: d.name, style: d.style, x, z, r: d.r }; });
  const places = (city.places || []).map((p) => { const [x, z] = at(p.at); return { id: p.id, name: p.name, sub: p.sub || '', x, z }; });
  const labels = (city.labels || []).map((l) => { const [x, z] = at(l.at); return { name: l.name, x, z, kind: l.kind }; });

  // --- Buildings (osm_buildings.json, where fetched) ------------------------------------------------------------------
  // Footprints with courtyards, the height of their tops & bottoms (m) from their tags, or a typical height for their
  // type in their neighbourhood. A building drawn in parts (building:part) is its parts, unless they all stand above its
  // own height (a tower on its podium).
  let buildings = null;
  const groundFootprints = []; // rings standing on the ground (trees can't grow there)
  if (fs.existsSync(path.join(dir, 'osm_buildings.json'))) {
    const LEVEL = 3.2;
    const levelsOf = (t) => num(t['building:levels']);
    const districtStyle = (x, z) => {
      let best = null, bd = Infinity;
      for (const d of districts) { const dd = Math.hypot(x - d.x, z - d.z); if (dd < d.r && dd < bd) { bd = dd; best = d; } }
      return best ? best.style : 'generic';
    };
    // Storeys of a building without heights, by its type and neighbourhood
    const TYPICAL = {
      house: 2, detached: 2, terrace: 2, bungalow: 2, semidetached_house: 2, garage: 1, garages: 1, shed: 1, hut: 1, kiosk: 1,
      service: 1, toilets: 1, train_station: 1, transportation: 1, roof: 1, temple: 2, church: 3, mosque: 2, chapel: 2,
      school: 4, hospital: 8, hotel: 15, industrial: 2, warehouse: 2, parking: 5, civic: 4, public: 4, government: 5
    };
    const BY_STYLE = { 'glass-towers': 18, offices: 10, shophouses: 3, housing: 12, midrise: 6, lowrise: 3, generic: 4 };
    const storeysOf = (type, style, area) => {
      if (TYPICAL[type]) return TYPICAL[type];
      if (type === 'residential' || type === 'apartments') return style === 'shophouses' ? 3 : style === 'housing' ? 14 : 6;
      if (type === 'commercial' || type === 'office' || type === 'retail') return style === 'shophouses' ? 3 : (BY_STYLE[style] || 4);
      return (BY_STYLE[style] || 4) + (area > 2500 ? 2 : 0);
    };
    const els = JSON.parse(fs.readFileSync(path.join(dir, 'osm_buildings.json'), 'utf8')).elements;
    // the outlines of the landmarks the city models by hand (config.landmarks: way ids)
    const hidden = new Set((city.landmarks || []).flatMap((l) => l.hide || []));
    let hiddenCount = 0;
    const items = [];
    for (const e of els) {
      const t = e.tags || {};
      if (e.type === 'way' && hidden.has(e.id)) {
        // (no trees where the modelled landmark stands either)
        if (!(num(t.min_height) > 0)) for (const { outer } of areaPolygons(e, toWorld, 8)) groundFootprints.push(outer);
        hiddenCount++;
        continue;
      }
      const part = !t.building && !!t['building:part'];
      if (t.building === 'no' || t['building:part'] === 'no') continue;
      for (const { outer, holes } of areaPolygons(e, toWorld, 8)) {
        const o = rdpRing(outer, 0.3);
        if (o.length < 3) continue;
        const [cx, cz] = centroid(o);
        if (!landAt(cx, cz) || !pointInRing(cx, cz, fetched)) continue;
        if (ringArea(o) > 0) o.reverse();
        const hs = holes.map((h) => rdpRing(h, 0.3)).filter((h) => h.length >= 3).map((h) => (ringArea(h) < 0 ? h.reverse() : h));
        const type = t.building && t.building !== 'yes' ? t.building : t['building:part'] && t['building:part'] !== 'yes' ? t['building:part'] : 'yes';
        const area = Math.abs(ringArea(o));
        let top = num(t.height) > 0 ? num(t.height) : levelsOf(t) > 0 ? levelsOf(t) * LEVEL : 0;
        const tagged = top > 0;
        if (!tagged) top = storeysOf(type, districtStyle(cx, cz), area) * LEVEL;
        let bottom = num(t.min_height) > 0 ? num(t.min_height) : num(t['building:min_level']) > 0 ? num(t['building:min_level']) * LEVEL : 0;
        if (type === 'roof') { bottom = Math.max(bottom, top - 0.6, 2.6); top = Math.max(top, bottom + 0.4); } // canopies & covered walkways
        if (top - bottom < 0.3) continue;
        items.push({ part, type, outer: o, holes: hs, cx, cz, top, bottom, area });
      }
    }
    // Outlines whose parts start at the ground are drawn by their parts
    const parts = items.filter((b) => b.part);
    const CELL = 64;
    const partCells = new Map();
    for (const p of parts) { const k = `${Math.floor(p.cx / CELL)},${Math.floor(p.cz / CELL)}`; if (!partCells.has(k)) partCells.set(k, []); partCells.get(k).push(p); }
    const kept = items.filter((b) => {
      if (b.part) return true;
      const bb = bbox(b.outer);
      for (let i = Math.floor(bb.x0 / CELL); i <= Math.floor(bb.x1 / CELL); i++) {
        for (let j = Math.floor(bb.z0 / CELL); j <= Math.floor(bb.z1 / CELL); j++) {
          for (const p of partCells.get(`${i},${j}`) || []) if (p.bottom < 1 && pointInRing(p.cx, p.cz, b.outer)) return false;
        }
      }
      return true;
    });
    const types = [...new Set(kept.map((b) => b.type))];
    // Neighbours next to each other (64 m cells, row by row): every coordinate is a short step from the one before
    const cellKey = (b) => Math.floor(b.cz / CELL) * 1e6 + Math.floor(b.cx / CELL);
    kept.sort((a, b) => cellKey(a) - cellKey(b) || a.cx - b.cx);
    // [rings, top dm, bottom dm, type, then per ring: points, then each point's dx dz (dm) from the point before (the
    // first from the previous ring's first point)]
    const data = [];
    let fx = 0, fz = 0;
    for (const b of kept) {
      const rings = [b.outer, ...b.holes];
      data.push(rings.length, Math.round(b.top * 10), Math.round(b.bottom * 10), types.indexOf(b.type));
      for (const r of rings) {
        data.push(r.length);
        let px = fx, pz = fz;
        r.forEach(([x, z], i) => {
          const qx = Math.round(x * 10), qz = Math.round(z * 10);
          data.push(qx - px, qz - pz);
          px = qx; pz = qz;
          if (!i) { fx = qx; fz = qz; }
        });
      }
      if (b.bottom < 3) groundFootprints.push(b.outer);
    }
    buildings = { types, data };
    log(`${kept.length} buildings & parts (${items.length - kept.length} outlines drawn by their parts; ${kept.filter((b) => b.top > 60).length} over 60 m; ${hiddenCount} left to the modelled landmarks)`);
  }

  // --- Trees (where the config names an inventory: tools/city/fetch.mjs) ------------------------------------------------
  // Each at its place with its height and crown shape, but none in the water, on a carriageway or on a building lot (the
  // buildings fill them). A kerbside tree the estimated roadway widths reach over moves up to 3 m onto the sidewalk.
  let trees = null;
  const treesFile = path.join(dir, 'trees.csv');
  if (city.trees && fs.existsSync(treesFile)) {
    const base = city.trees.shape || 'plane';
    const shapes = [...new Set([base, ...Object.values(city.trees.shapes || {})])];
    const shapeOf = (family) => shapes.indexOf((city.trees.shapes || {})[family] || base);
    const byLabel = new Map(all.map((b) => [b.label, b]));
    const cellOf = (x, z) => {
      const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
      return i >= 0 && j >= 0 && i < R.w && j < R.h ? j * R.w + i : -1;
    };
    const buildableAt = (x, z) => buildable[Math.floor((z - land.z0) / land.res) * land.w + Math.floor((x - land.x0) / land.res)];
    const onLot = (b, x, z) => {
      for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
        const cs = Math.cos(th), sn = Math.sin(th);
        const dx = x - px, dz = z - pz;
        const u = th ? px + dx * cs - dz * sn : x, v = th ? pz + dx * sn + dz * cs : z; // R_y(-θ) into the frame
        for (const [x0, x1, z0, z1] of rects) if (u > x0 && u < x1 && v > z0 && v < z1) return true;
      }
      return false;
    };
    // The nearest block cell within 3 m of (x, z), as its centre, or null
    const RINGS = [];
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (di * di + dj * dj <= 9) RINGS.push([di, dj, di * di + dj * dj]);
    RINGS.sort((a, b) => a[2] - b[2]);
    const nearestBlockCell = (x, z) => {
      const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
      for (const [di, dj] of RINGS) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < R.w && jj < R.h && R.d[jj * R.w + ii]) return [R.x0 + (ii + 0.5) * R.res, R.z0 + (jj + 0.5) * R.res];
      }
      return null;
    };
    // Ground-floor footprints by 32 m cell: a tree can't stand inside one
    const FP_CELL = 32;
    const fpCells = new Map();
    for (const r of groundFootprints) {
      const bb = bbox(r);
      for (let i = Math.floor(bb.x0 / FP_CELL); i <= Math.floor(bb.x1 / FP_CELL); i++) {
        for (let j = Math.floor(bb.z0 / FP_CELL); j <= Math.floor(bb.z1 / FP_CELL); j++) {
          const key = i * 100000 + j;
          if (!fpCells.has(key)) fpCells.set(key, []);
          fpCells.get(key).push(r);
        }
      }
    }
    const underBuilding = (x, z) => (fpCells.get(Math.floor(x / FP_CELL) * 100000 + Math.floor(z / FP_CELL)) || []).some((r) => pointInRing(x, z, r));
    const data = [];
    const dropped = { water: 0, road: 0, lot: 0 };
    let moved = 0;
    const rows = fs.readFileSync(treesFile, 'utf8').trim().split('\n').slice(1);
    for (const row of rows) {
      const [lng, lat, height, family] = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      let [x, z] = toWorld(parseFloat(lng), parseFloat(lat));
      if (!landAt(x, z)) { dropped.water++; continue; }
      let k = cellOf(x, z);
      if (k < 0) { dropped.water++; continue; }
      if (buildableAt(x, z) && !R.d[k]) { // buildable land the roads took
        const kerb = nearestBlockCell(x, z);
        if (!kerb) { dropped.road++; continue; }
        [x, z] = kerb;
        k = cellOf(x, z);
        moved++;
      }
      // with real buildings, not inside one; else not on a lot of the generated ones
      const b = byLabel.get(lab[k]);
      if (buildings ? underBuilding(x, z) : b && !(b.park > 0.6) && pointInRing(...centroid(b.poly), detail) && onLot(b, x, z)) { dropped.lot++; continue; }
      data.push([Math.round(x * 10), Math.round(z * 10), Math.max(3, Math.round(parseFloat(height) || 0)), shapeOf(family.replace(/"/g, ''))]);
    }
    // Neighbours next to each other (64 m cells, row by row), each tree's place a short step from the one before
    const treeKey = (t) => Math.floor(t[1] / 640) * 1e6 + Math.floor(t[0] / 640);
    data.sort((a, b) => treeKey(a) - treeKey(b) || a[0] - b[0]);
    const xz = [], heights = [], shapeIds = [];
    let px = 0, pz = 0;
    for (const [qx, qz, h, sh] of data) { xz.push(qx - px, qz - pz); heights.push(h); shapeIds.push(sh); px = qx; pz = qz; }
    trees = { shapes, credit: city.trees.credit, xz, heights, shape: shapeIds };
    log(`${data.length} trees planted of ${rows.length} (${moved} moved off the roadway onto the kerb; ${dropped.water} in the water or beyond the map, ${dropped.road} on carriageways, ${dropped.lot} ${buildings ? 'inside buildings' : 'on building lots'})`);
  }

  // --- Road pricing & traffic cameras (osm_enforcement.json, where fetched) ----------------------------------------------
  // Toll (ERP) gantries, speed cameras with their limits, red light cameras with the approach they watch (from -> to)
  let enforcement = null;
  if (fs.existsSync(path.join(dir, 'osm_enforcement.json'))) {
    const els = JSON.parse(fs.readFileSync(path.join(dir, 'osm_enforcement.json'), 'utf8')).elements;
    const kept = (x, z) => landAt(x, z) && pointInRing(x, z, fetched);
    const near = (list, x, z, r) => { for (let i = 0; i < list.length; i += list.stride) if (Math.hypot(list[i] / 10 - x, list[i + 1] / 10 - z) < r) return true; return false; };
    const gantries = Object.assign([], { stride: 2 });
    const speed = Object.assign([], { stride: 3 });
    const redLight = Object.assign([], { stride: 4 });
    const at = (g) => toWorld(g.lon, g.lat);
    for (const e of els) {
      const t = e.tags || {};
      if (t.highway === 'toll_gantry') {
        const g = e.type === 'node' ? e : { lon: e.geometry.reduce((a, p) => a + p.lon, 0) / e.geometry.length, lat: e.geometry.reduce((a, p) => a + p.lat, 0) / e.geometry.length };
        const [x, z] = at(g);
        if (kept(x, z) && !near(gantries, x, z, 4)) gantries.push(Math.round(x * 10), Math.round(z * 10));
      } else if (t.highway === 'speed_camera' && e.type === 'node') {
        const [x, z] = at(e);
        if (kept(x, z) && !near(speed, x, z, 10)) speed.push(Math.round(x * 10), Math.round(z * 10), num(t.maxspeed) || 50);
      } else if (e.type === 'relation' && (t.enforcement === 'red_light_camera' || t.enforcement === 'traffic_signals')) {
        const m = (role) => (e.members || []).find((mm) => mm.role === role && mm.type === 'node' && mm.lat !== undefined);
        const to = m('to') || m('device'), from = m('from');
        if (!to) continue;
        const [x, z] = at(to);
        const [fx, fz] = from ? at(from) : [x, z - 1];
        const L = Math.hypot(x - fx, z - fz) || 1;
        if (kept(x, z) && !near(redLight, x, z, 6)) redLight.push(Math.round(x * 10), Math.round(z * 10), Math.round(((x - fx) / L) * 100), Math.round(((z - fz) / L) * 100));
      }
    }
    enforcement = { gantries: [...gantries], speed: [...speed], redLight: [...redLight] };
    log(`${gantries.length / 2} road pricing gantries, ${speed.length / 3} speed cameras, ${redLight.length / 4} red light cameras`);
  }

  // --- Lawns: the land inside each block's property line (what its sidewalks ring), ring by ring ------------------------
  // [points, then each point's dx dz (dm) from the one before, a ring's first from the previous ring's first, ...]
  const lawns = [];
  {
    let fx = 0, fz = 0;
    for (const b of blocks) {
      for (const r of b.lawns || []) {
        lawns.push(r.length);
        let px = fx, pz = fz;
        r.forEach(([x, z], i) => {
          const qx = Math.round(x * 10), qz = Math.round(z * 10);
          lawns.push(qx - px, qz - pz);
          px = qx; pz = qz;
          if (!i) { fx = qx; fz = qz; }
        });
      }
    }
  }

  // --- Assemble ----------------------------------------------------------------------------------------------------------
  const GEO = {
    version: 2,
    city: city.id,
    name: city.name,
    short: city.short || city.id.slice(0, 2).toUpperCase(),
    frame: { lat0: city.origin.lat, lon0: city.origin.lon, bearingDeg, origin: city.origin.label, units: 'm', sidewalk: city.sidewalk, strip: city.strip, driveSide: city.driveSide },
    detail: flat(detail),
    land: landRegions.map((r) => [r.outer, ...r.holes].map(flat)),
    water: water.map((w) => ({ name: w.name, ring: flat(w.ring) })),
    parks: parks.map((p) => ({ name: p.name, kind: p.kind, rings: p.rings.map((r) => flat(rdpRing(r, 0.8))) })),
    roadGraph,
    blocks: blocks.map((b) => [flat(b.poly), b.rects.map((r) => r.map(q)), b.park || 0, b.parkName || '', b.rect ? 1 : 0,
      b.frames ? b.frames.map(([th, px, pz, rs]) => [Math.round(th * 1e4) / 1e4, q(px), q(pz), rs.map((r) => r.map(q))]) : 0]),
    districts,
    places,
    labels,
    trees,
    buildings,
    vehicles: city.vehicles || null,
    enforcement,
    lawns
  };
  const file = out || fileURLToPath(new URL(`../../js/${city.id}-geodata.js`, import.meta.url));
  const header = `// js/${city.id}-geodata.js — GENERATED by tools/city/build.mjs ${city.id}, do not edit by hand.
// ${city.name} in the simulation's world frame (see tools/city/build.mjs for the layout): 1 unit = 1 m, x = grid east,
// z = grid south, origin at ${city.origin.label}, axes turned ${bearingDeg}° from true north.
// Source: © OpenStreetMap contributors (ODbL).
`;
  // (as a JSON string: engines parse JSON faster than an object literal this size)
  fs.writeFileSync(file, `${header}export const GEO = JSON.parse(${JSON.stringify(JSON.stringify(GEO))});\n`);
  log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
  return GEO;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await buildCity(process.argv[2], { out: process.argv[3] });
}
