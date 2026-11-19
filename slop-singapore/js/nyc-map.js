import { GEO } from './geodata.js';
import {
  ROADS,
  BLOCKS,
  NYC_LANDMARKS,
  LANDMARK_SITES,
  ISLAND_BOUNDS,
  getIslandBoundsAtZ,
  MANHATTAN_COASTLINE,
  WATERFRONT_PIERS,
  NJ_SHORELINE_POLYGON,
  BROOKLYN_POLYGONS,
  QUEENS_POLYGONS,
  BRONX_POLYGONS,
  STATEN_ISLAND_POLYGON,
  UPPER_MANHATTAN_POLYGON,
  WESTCHESTER_POLYGON,
  NASSAU_POLYGON,
  ROOSEVELT_ISLAND_POLYGON,
  GOVERNORS_ISLAND_POLYGON,
  RANDALLS_ISLAND_POLYGON,
  LIBERTY_ISLAND_POLYGON,
  ELLIS_ISLAND_POLYGON,
  MILL_ROCK_POLYGON,
  EAST_RIVER_BRIDGES,
  OUTER_BRIDGES,
  getLocationLabel,
  isTypingInField,
  LAND_REGIONS,
  CITY
} from './city-config.js';

// js/nyc-map.js
// GTA 6-Style Live Radar Minimap + Full-Screen Interactive New York City Cartographic Atlas.
// Synchronized 1:1 with the 3D world (1 unit = 1 m; x = grid east, z = grid south, the world's axes turned along the
// city's street grid, 29° east of true north in Manhattan, 31.8° in Singapore). Both maps turn that back, so true north
// is up (MapView), with the names upright. They draw the very geography the
// city is built from (GEO, from NYC Open Data & OpenStreetMap): Manhattan's bulkhead line and piers, every
// curb island (block) with the building footprints standing on it, the parks, Central Park's meadows, water bodies &
// drives, the shore highways, the real street centrelines (labelled along their course), the surrounding boroughs and
// New Jersey, the harbour islands and the bridges.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MIN_ZOOM = 0.015; // full map, pixels per metre: the whole harbour, Staten Island to the Bronx
const MAX_ZOOM = 3.0; // single lots
const RADAR_SCALE = 0.32; // radar pixels per metre on the ground (zooms out with altitude)
const GRID_BEARING = (GEO.frame && GEO.frame.bearingDeg) || 29.02; // Manhattan's grid north, degrees east of true north
// The maps' turn (radians, clockwise on screen) that puts true north up: true north in the world frame is
// (x, z) = (-sin b, -cos b) (tools/city/frame.mjs), and turning the screen by b brings it to (0, -1)
const MAP_ROTATION = (GRID_BEARING * Math.PI) / 180;
// An angle in screen space kept within (-90°, 90°], for text that reads left to right
const upright = (a) => {
  let r = Math.atan2(Math.sin(a), Math.cos(a));
  if (r > Math.PI * 0.5 + 0.01) r -= Math.PI;
  else if (r <= -Math.PI * 0.5 - 0.01) r += Math.PI;
  return r;
};

// Map palette, shared by the radar & the atlas (in step with css/style.css): graphite ground with the streets a shade
// lighter than the blocks they run between, muted parks & water; a taxi-yellow GPS route, white landmarks & player,
// cyan search hits and amber highways
const MAP = {
  water: '#0a1118',
  land: '#151a20',
  landEdge: '#252c35',
  islands: '#162019',
  islandsEdge: '#26392c',
  piers: '#283039',
  streets: '#363f4b', // Manhattan inside its bulkhead line: the roadway left between the blocks
  shore: '#4f5b6b',
  park: '#19301f',
  parkEdge: '#24432f',
  block: '#1c2128',
  blockEdge: '#272e37',
  lawn: '#1e3a26',
  drive: '#2c4033',
  transverse: '#22332a',
  pond: '#0f2535',
  pondEdge: '#1d3d54',
  buildings: ['#242a32', '#2b323c', '#343c48'],
  buildingEdge: '#171b21',
  landmarkFill: 'rgba(255, 255, 255, 0.06)',
  landmarkEdge: 'rgba(255, 255, 255, 0.38)',
  mainRoads: '#3a434f',
  highway: '#b27a35',
  bridge: '#c08a3e',
  route: '#ffc21a',
  runway: '#5d6573',
  runwayMark: 'rgba(235, 240, 245, 0.75)',
  aircraft: '#7dffa8',
  search: '#5fd0ff',
  halo: 'rgba(8, 11, 15, 0.9)'
};

// Landmarks modelled by landmarks.js on their real OpenStreetMap lots (outlined in amber)
const MODELLED_LANDMARKS = [
  'Empire State Building', 'Chrysler Building', 'One Vanderbilt', 'Grand Central Terminal', 'MetLife Building',
  'Stephen A. Schwarzman Building', 'One Times Square', '30 Rockefeller Plaza', 'Citigroup Center', 'Seagram Building',
  'Flatiron Building', 'One World Trade Center', 'New York Stock Exchange'
];

// Borough (0), waterway (1) & neighbourhood (2) names at their real places (world metres); a city built from
// OpenStreetMap labels its config's places of note and neighbourhoods (GEO.labels, GEO.districts)
const AREA_LABELS = CITY.open ? [
  ...(GEO.labels || []).map((l) => [l.name, l.x, l.z, l.kind]),
  ...(GEO.districts || []).map((d) => [d.name.toUpperCase(), d.x, d.z, 2])
] : [
  ['MANHATTAN', 120, -1500, 0], ['NEW JERSEY', -7000, 2000, 0], ['BROOKLYN', 7850, 8780, 0], ['QUEENS', 8810, -1680, 0],
  ['THE BRONX', 1010, -9640, 0], ['STATEN ISLAND', -1800, 19220, 0],
  ['HUDSON RIVER', -2680, -300, 1], ['HUDSON RIVER', -2650, -5600, 1], ['EAST RIVER', 1700, 800, 1],
  ['HARLEM RIVER', 220, -7930, 1], ['UPPER NEW YORK BAY', 130, 10530, 1],
  ['HARLEM', -320, -6750, 2], ['MORNINGSIDE HEIGHTS', -1600, -6160, 2], ['EAST HARLEM', 830, -5820, 2],
  ['UPPER WEST SIDE', -1410, -3070, 2], ['CENTRAL PARK', -430, -3280, 2], ['UPPER EAST SIDE', 590, -2680, 2],
  ['ROOSEVELT ISLAND', 1810, -2030, 2], ["HELL'S KITCHEN", -1350, -590, 2], ['MIDTOWN', 100, -500, 2],
  ['MURRAY HILL', 680, 330, 2], ['HUDSON YARDS', -1510, 770, 2], ['CHELSEA', -1030, 1650, 2],
  ['FLATIRON · GRAMERCY', 330, 1660, 2], ['GREENWICH VILLAGE', -540, 2830, 2], ['EAST VILLAGE', 1250, 2800, 2],
  ['SOHO', 200, 3560, 2], ['LOWER EAST SIDE', 1690, 3760, 2], ['TRIBECA', -140, 4460, 2], ['CHINATOWN', 850, 4420, 2],
  ['BATTERY PARK CITY', -370, 5540, 2], ['FINANCIAL DISTRICT', 455, 5715, 2], ['GOVERNORS ISLAND', 795, 7685, 2],
  ['LIBERTY ISLAND', -1234, 8849, 2], ['ELLIS ISLAND', -1427, 7648, 2], ["RANDALL'S ISLAND", 2268, -6301, 2],
  ['WASHINGTON HEIGHTS', -1690, -10270, 2], ['DOWNTOWN BROOKLYN', 2570, 6280, 2], ['WILLIAMSBURG', 3670, 2980, 2],
  ['GREENPOINT', 3305, 1277, 2], ['LONG ISLAND CITY', 2865, -473, 2], ['ASTORIA', 3345, -3699, 2],
  ['HOBOKEN', -3293, 3032, 2], ['JERSEY CITY', -2671, 6014, 2], ['WEEHAWKEN', -3670, 193, 2], ['FORT LEE', -4456, -9911, 2],
  ['RED HOOK', 2005, 8855, 2], ['BAYONNE', -5284, 13699, 2]
];

// Shorter map names for a few real street names
const LABEL_ALIAS = { 'Franklin D Roosevelt Dr': 'FDR Drive', 'Battery Park Underpass': 'Battery Underpass' };

// ---------------------------------------------------------------------------------------------------------------------
// World-space vector layers: built once into Path2D objects (world metres) and drawn through a canvas transform
// ---------------------------------------------------------------------------------------------------------------------

// Point accessors for rings / polylines given as [{x, z}, ...] or flat [x0, z0, x1, z1, ...]
function accessor(pts) {
  const flat = typeof pts[0] === 'number';
  return {
    n: flat ? pts.length >> 1 : pts.length,
    X: flat ? (i) => pts[2 * i] : (i) => pts[i].x,
    Z: flat ? (i) => pts[2 * i + 1] : (i) => pts[i].z
  };
}

function boundsOf(pts) {
  const { n, X, Z } = accessor(pts);
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = X(i);
    const z = Z(i);
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

// Appends a closed ring, always wound the same way as Path2D.rect (so overlapping rings of one path union under the
// nonzero fill rule instead of cancelling out)
function addRing(path, pts) {
  if (!pts || pts.length < 3) return;
  const { n, X, Z } = accessor(pts);
  if (n < 3) return;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += X(j) * Z(i) - X(i) * Z(j);
  if (a >= 0) {
    path.moveTo(X(0), Z(0));
    for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
  } else {
    path.moveTo(X(n - 1), Z(n - 1));
    for (let i = n - 2; i >= 0; i--) path.lineTo(X(i), Z(i));
  }
  path.closePath();
}

function addLine(path, pts) {
  if (!pts || pts.length < 2) return;
  const { n, X, Z } = accessor(pts);
  path.moveTo(X(0), Z(0));
  for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
}

/**
 * A vector layer split into square tiles of Path2D, so a view only rasterizes the tiles it overlaps. Every item goes
 * to the tile holding its centre; a tile's bounds grow to cover its items.
 */
class TiledLayer {
  constructor(size = 500) {
    this.size = size;
    this.tiles = new Map();
  }

  pathFor(b) {
    const ix = Math.floor((b.minX + b.maxX) * 0.5 / this.size);
    const iz = Math.floor((b.minZ + b.maxZ) * 0.5 / this.size);
    const key = `${ix},${iz}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { path: new Path2D(), minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
      this.tiles.set(key, t);
    } else {
      t.minX = Math.min(t.minX, b.minX);
      t.maxX = Math.max(t.maxX, b.maxX);
      t.minZ = Math.min(t.minZ, b.minZ);
      t.maxZ = Math.max(t.maxZ, b.maxZ);
    }
    return t.path;
  }

  ring(pts) {
    if (pts && pts.length > 2) addRing(this.pathFor(boundsOf(pts)), pts);
  }

  line(pts) {
    if (pts && pts.length > 1) addLine(this.pathFor(boundsOf(pts)), pts);
  }

  rect(x0, z0, x1, z1) {
    this.pathFor({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }).rect(x0, z0, x1 - x0, z1 - z0);
  }

  /** Calls fn(path) for every tile overlapping the view */
  each(v, fn) {
    for (const t of this.tiles.values()) {
      if (t.maxX < v.minX || t.minX > v.maxX || t.maxZ < v.minZ || t.minZ > v.maxZ) continue;
      fn(t.path);
    }
  }
}

let LAYERS = null;
function mapLayers() {
  if (LAYERS) return LAYERS;
  const L = {};
  const rings = (list) => list.filter((p) => p && p.length > 2);

  // Land around the harbour: New Jersey, Brooklyn, Queens, the Bronx, Staten Island and Upper Manhattan (outlined), the
  // horizon fillers beyond the city line (not outlined); the East River & harbour islands
  L.land = new Path2D();
  for (const ring of rings([NJ_SHORELINE_POLYGON, ...(BROOKLYN_POLYGONS || []), ...(QUEENS_POLYGONS || []), ...(BRONX_POLYGONS || []),
    STATEN_ISLAND_POLYGON, UPPER_MANHATTAN_POLYGON])) addRing(L.land, ring);
  L.fillers = new Path2D();
  for (const ring of rings([WESTCHESTER_POLYGON, NASSAU_POLYGON])) addRing(L.fillers, ring);
  L.islands = new Path2D();
  for (const ring of rings([RANDALLS_ISLAND_POLYGON, ROOSEVELT_ISLAND_POLYGON, GOVERNORS_ISLAND_POLYGON, LIBERTY_ISLAND_POLYGON,
    ELLIS_ISLAND_POLYGON, MILL_ROCK_POLYGON])) addRing(L.islands, ring);

  // Manhattan inside its bulkhead line, and its piers (a city built from OpenStreetMap: its detailed land, less its
  // inland water)
  L.manhattan = new Path2D();
  addRing(L.manhattan, MANHATTAN_COASTLINE);
  L.inlandWater = new Path2D();
  if (CITY.open) {
    for (const r of LAND_REGIONS) {
      addRing(L.manhattan, r.outer);
      for (const h of r.holes) addRing(L.inlandWater, h);
    }
  }
  L.piers = new Path2D();
  for (const p of WATERFRONT_PIERS) if (p.ring) addRing(L.piers, p.ring);

  // Parkland (NYC Parks properties), the curb islands (blocks: raised sidewalks & lots) and the park blocks, exactly
  // as city-grid.js / buildings.js treat them
  L.parkLand = new TiledLayer();
  for (const park of GEO.parks || []) for (const ring of park.rings || []) L.parkLand.ring(ring);
  L.blocks = new TiledLayer();
  L.parkBlocks = new TiledLayer();
  for (const b of BLOCKS) (b.park > 0.6 && !b.median ? L.parkBlocks : L.blocks).ring(b.poly);

  // Central Park: meadows, water bodies, the drives and the sunken transverse roads
  const cp = GEO.centralPark || {};
  L.cpBounds = cp.bounds || null;
  L.cpLawns = new Path2D();
  for (const l of cp.lawns || []) addRing(L.cpLawns, l.ring);
  L.cpWater = new Path2D();
  for (const w of cp.water || []) addRing(L.cpWater, w.ring);
  L.cpDrives = new Path2D();
  L.cpTransverses = new Path2D();
  for (const d of cp.drives || []) addLine(d.transverse ? L.cpTransverses : L.cpDrives, d.pts);

  // Street network at low zoom (avenues & wide streets, once the gaps between blocks are under a pixel) and the shore
  // highways (FDR Drive, West St / West Side Hwy, Harlem River Dr, Henry Hudson Pkwy)
  L.mainRoads = new TiledLayer(1000);
  L.highways = new Path2D();
  for (const r of ROADS) {
    if (r.highway) {
      if (!/Underpass|Tunnel/.test(r.name)) addLine(L.highways, r.pts);
    } else if (r.w >= 15) L.mainRoads.line(r.pts);
  }

  // Landmark lots
  L.landmarks = new Path2D();
  for (const name of MODELLED_LANDMARKS) {
    const s = LANDMARK_SITES[name];
    if (s && s.ring) addRing(L.landmarks, s.ring);
  }

  // Bridges, Manhattan landing to the far landing, deck width to scale
  L.bridges = [...EAST_RIVER_BRIDGES, ...OUTER_BRIDGES].map((br) => {
    const path = new Path2D();
    path.moveTo(br.a.x, br.a.z);
    path.lineTo(br.b.x, br.b.z);
    return { path, width: br.width || 25 };
  });

  LAYERS = L;
  return L;
}

// Building footprints as generated by buildings.js, by height: up to 45 m, 95 m, taller
let FOOTPRINTS = null;
function footprintLayers(all) {
  if (!all || !all.length) return null;
  if (FOOTPRINTS && FOOTPRINTS.src === all && FOOTPRINTS.n === all.length) return FOOTPRINTS;
  const tones = [new TiledLayer(), new TiledLayer(), new TiledLayer()];
  for (const blk of all) {
    for (const f of blk.footprints || []) {
      const layer = tones[f.h > 95 ? 2 : f.h > 45 ? 1 : 0];
      if (f.pts) layer.ring(f.pts); // turned to follow a non-grid street
      else layer.rect(f.x0, f.z0, f.x1, f.z1);
    }
  }
  FOOTPRINTS = { src: all, n: all.length, tones, version: FOOTPRINTS ? FOOTPRINTS.version + 1 : 1 };
  return FOOTPRINTS;
}

// Street name labels: anchors every ~260 m along each straight run of a real centreline (fixed in the world, so labels
// never slide while the map pans), with the direction of the street there (never upside down: vertical names read
// upwards)
const ROAD_LABELS = [];
for (const r of ROADS) addRoadLabel(r);
// A road's label anchors (`r`: { name, pts [{ x, z }], highway, w })
function addRoadLabel(r) {
  const text = LABEL_ALIAS[r.name] || r.name;
  if (!text || /^Unnamed/.test(text)) return;
  const anchors = [];
  const pts = r.pts;
  for (let i = 0; i + 1 < pts.length;) {
    // the straight run from pts[i]: consecutive segments within ~5° of its first one (the CSCL has a vertex at every
    // intersection, so an avenue is a chain of 80 m blocks)
    const a = pts[i];
    const dir = Math.atan2(pts[i + 1].z - a.z, pts[i + 1].x - a.x);
    let j = i + 1;
    while (j + 1 < pts.length) {
      const d = Math.atan2(pts[j + 1].z - pts[j].z, pts[j + 1].x - pts[j].x);
      let turn = Math.abs(d - dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.09) break;
      j++;
    }
    const c = pts[j];
    i = j;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 20) continue;
    let ang = Math.atan2(c.z - a.z, c.x - a.x);
    if (ang >= Math.PI * 0.5 - 0.01) ang -= Math.PI;
    else if (ang < -Math.PI * 0.5 - 0.01) ang += Math.PI;
    const k = Math.max(1, Math.round(len / 260));
    for (let m = 0; m < k; m++) {
      const t = (m + 0.5) / k;
      anchors.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, ang, len: len / k });
    }
  }
  if (!anchors.length) return;
  ROAD_LABELS.push({
    text,
    lower: text.toLowerCase(),
    raw: r.name.toLowerCase(),
    road: r,
    major: r.highway || r.w >= 15,
    highway: r.highway,
    anchors,
    ...boundsOf(r.pts)
  });
}
let ROAD_NAME_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;

// The rest of the island beyond the detailed city (js/city-tiles.js: tiles/<city>/index.json's land, roads.json's main
// roads), set once they arrive: land, lakes, the expressways & main roads by class
const ISLAND = { land: null, lakes: null, highways: null, roads: null, bounds: null, version: 0 };
function setIslandLayers({ land = [], roads = null } = {}) {
  ISLAND.land = new Path2D();
  ISLAND.lakes = new Path2D();
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [outer, ...holes] of land) {
    addRing(ISLAND.land, outer);
    for (const h of holes) addRing(ISLAND.lakes, h);
    const ob = boundsOf(outer);
    b.minX = Math.min(b.minX, ob.minX); b.maxX = Math.max(b.maxX, ob.maxX);
    b.minZ = Math.min(b.minZ, ob.minZ); b.maxZ = Math.max(b.maxZ, ob.maxZ);
  }
  ISLAND.bounds = Number.isFinite(b.minX) ? b : null;
  if (roads) {
    // [highways (motorway & trunk), primary, secondary, tertiary]
    ISLAND.highways = new TiledLayer(2000);
    ISLAND.roads = [new TiledLayer(2000), new TiledLayer(2000), new TiledLayer(2000)];
    const named = new Map();
    for (const r of roads.roads) {
      const cls = roads.classes[r[0]];
      const pts = [];
      let x = 0, z = 0;
      for (let k = 2; k < r.length; k += 2) { x += r[k]; z += r[k + 1]; pts.push(x, z); }
      if (cls === 'motorway' || cls === 'trunk') ISLAND.highways.line(pts);
      else ISLAND.roads[cls === 'primary' ? 0 : cls === 'secondary' ? 1 : 2].line(pts);
      // labels for the named expressways & main roads
      if (r[1] >= 0 && cls !== 'tertiary') {
        const name = roads.names[r[1]];
        const list = named.get(name) || [];
        list.push({ pts, highway: cls === 'motorway' || cls === 'trunk' });
        named.set(name, list);
      }
    }
    for (const [name, list] of named) {
      for (const { pts, highway } of list) {
        const P = [];
        for (let k = 0; k < pts.length; k += 2) P.push({ x: pts[k], z: pts[k + 1] });
        addRoadLabel({ name, pts: P, highway, w: highway ? 20 : 15 });
      }
    }
    ROAD_NAME_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;
  }
  ISLAND.version++;
}

// The jet's runways (js/airbases.js runways), drawn when shown: { x, z, heading, length, width, name } each
const RUNWAY_LAYER = { list: [], show: false, version: 0 };

// Buildings of the island tiles streamed in so far (js/city-tiles.js onTileOutlines), by height as FOOTPRINTS
const TILE_FOOTPRINTS = { tones: [new TiledLayer(), new TiledLayer(), new TiledLayer()], keys: new Set(), version: 0 };
function addTileFootprints(key, ox, oz, { pts, offsets, tops }) {
  if (TILE_FOOTPRINTS.keys.has(key)) return; // (a tile dropped & streamed in again)
  TILE_FOOTPRINTS.keys.add(key);
  for (let k = 0; k + 1 < offsets.length; k++) {
    const ring = [];
    for (let i = offsets[k]; i < offsets[k + 1]; i++) ring.push(ox + pts[i * 2], oz + pts[i * 2 + 1]);
    TILE_FOOTPRINTS.tones[tops[k] > 95 ? 2 : tops[k] > 45 ? 1 : 0].ring(ring);
  }
  TILE_FOOTPRINTS.version++;
}

/**
 * A map viewport: centre (cx, cz) in world metres, s pixels per metre, w x h CSS pixels on a canvas of pixel ratio dpr,
 * the world turned `rot` radians (clockwise) on screen so true north is up. min/max X/Z bound what it sees.
 */
class MapView {
  constructor(cx, cz, s, w, h, dpr = 1, rot = MAP_ROTATION) {
    this.cx = cx;
    this.cz = cz;
    this.s = s;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.rot = rot;
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    // the world box around the turned screen rectangle
    const hx = w / (2 * s);
    const hz = h / (2 * s);
    const ex = hx * Math.abs(this.cos) + hz * Math.abs(this.sin);
    const ez = hx * Math.abs(this.sin) + hz * Math.abs(this.cos);
    this.minX = cx - ex;
    this.maxX = cx + ex;
    this.minZ = cz - ez;
    this.maxZ = cz + ez;
  }

  /** Canvas transform for world metres */
  world(ctx) {
    const { s, dpr, cos, sin, cx, cz } = this;
    const a = s * cos;
    const b = s * sin;
    const c = -s * sin;
    const d = s * cos;
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, dpr * (this.w * 0.5 - (a * cx + c * cz)), dpr * (this.h * 0.5 - (b * cx + d * cz)));
  }

  /** Canvas transform for CSS pixels from the canvas centre (what pt returns) */
  screen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5);
  }

  /** World (x, z) as CSS pixels from the canvas centre: [X, Y] */
  pt(x, z, out = [0, 0]) {
    const dx = x - this.cx;
    const dz = z - this.cz;
    out[0] = (dx * this.cos - dz * this.sin) * this.s;
    out[1] = (dx * this.sin + dz * this.cos) * this.s;
    return out;
  }

  /** CSS pixels from the canvas centre as world { x, z } */
  unproject(X, Y) {
    const u = X / this.s;
    const v = Y / this.s;
    return { x: this.cx + u * this.cos + v * this.sin, z: this.cz - u * this.sin + v * this.cos };
  }

  /** A world direction (heading h faces (sin h, cos h)) as a canvas rotation for an arrow drawn pointing up */
  headingAngle(h) {
    return -h + Math.PI + this.rot;
  }

  sees(b) {
    return b && b.maxX >= this.minX && b.minX <= this.maxX && b.maxZ >= this.minZ && b.minZ <= this.maxZ;
  }
}

// How far a world box reaches across the turned map, in metres: { w, h }
function turnedExtent(b, rot = MAP_ROTATION) {
  const bw = b.maxX - b.minX;
  const bh = b.maxZ - b.minZ;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return { w: bw * c + bh * s, h: bw * s + bh * c };
}

// Player heading arrow at the (already rotated) origin: white, on a dark halo
function drawPlayerArrow(ctx, tipY, halfWidth, tailY) {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// GPS route from the player to the waypoint along the grid (x first, then z: an L turned with the map), world
// coordinates in view v: taxi yellow on a dark casing
function drawRoute(ctx, v, ax, az, bx, bz, width) {
  const p0 = v.pt(ax, az);
  const p1 = v.pt(bx, az);
  const p2 = v.pt(bx, bz);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = MAP.route;
  ctx.lineWidth = width;
  ctx.stroke();
}

// The navigator's route (js/navigation.js): the road it actually takes, [{ x, z }] in world metres
function drawRoutePath(ctx, pts, v, width) {
  if (!pts || pts.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  const q = [0, 0];
  v.pt(pts[0].x, pts[0].z, q);
  ctx.moveTo(q[0], q[1]);
  for (let i = 1; i < pts.length; i++) {
    v.pt(pts[i].x, pts[i].z, q);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = MAP.route;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Waypoint: a taxi-yellow target
function drawWaypoint(ctx, x, y, r) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.route;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

const overlaps = (boxes, b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

class NYCMapSystem {
  constructor({ controllerManager, cameraSystem, trafficSystem, allBlocks = [], onTeleport, onToggle, onPick = null }) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.allBlocks = allBlocks;
    this.onTeleport = onTeleport;
    // (set by the app to offer what to do at a tapped spot: onPick(x, z, name, clientX, clientY); else a tap teleports)
    this.onPick = onPick;
    this.onToggle = onToggle;

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.elMiniStreet = document.getElementById('minimap-street-label');
    this.miniStreetText = '';
    this.miniScale = RADAR_SCALE;
    this.miniCache = null; // { canvas, cx, cz, s, version }: the radar's ground layers, twice the radar's size
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) elCounts.textContent = `${ROAD_NAME_COUNT} streets · ${BLOCKS.length.toLocaleString('en-US')} blocks`;

    // The map is drawn true north up: the compass needle points straight up
    const needle = document.getElementById('map-compass-needle');
    if (needle) needle.removeAttribute('transform');

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullStatic = null; // the full map's ground layers & labels for the current view
    this.fullStaticKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    if (this.elSearchInput) this.elSearchInput.placeholder = `Search ${ROAD_NAME_COUNT} streets & landmarks…`;

    this.isFullMapOpen = false;
    // Full map viewport state (world metres; zoom in CSS pixels per metre)
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.22;
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;

    this.hoverWorld = null;
    this.searchHighlight = '';
    this.searchPath = null;
    this.textWidths = new Map();
    // Default GTA 6-style active GPS waypoint (Times Square / Broadway)
    const ts = NYC_LANDMARKS.find((l) => l.id === 'timessquare') || { x: 0, z: 0 };
    this.waypoint = { x: ts.x, z: ts.z, name: 'Times Square & 42nd St' };
    // Set by main.js while navigating: the route to draw instead of the straight GPS line, and a handler that takes the
    // next click on the full map as the destination instead of a teleport
    this.routeLine = null;
    this.pickHandler = null;

    // Street names measured before the web font arrived would be spaced for the fallback font: measure & draw again
    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullStaticKey = '';
      });
    }

    this.initEvents();
  }

  // The rest of the island (js/city-tiles.js): its land & main roads, then each tile's buildings as it streams in
  setIsland(island) {
    setIslandLayers(island);
    if (this.elSearchInput) this.elSearchInput.placeholder = `Search ${ROAD_NAME_COUNT} streets & landmarks…`;
  }

  /** The jet's runways, and whether the maps show them */
  setRunways(list, show = RUNWAY_LAYER.show) {
    RUNWAY_LAYER.list = list || [];
    RUNWAY_LAYER.show = !!show;
    RUNWAY_LAYER.version++;
    if (this.isFullMapOpen) this.renderFullMap();
  }

  get runwaysShown() { return RUNWAY_LAYER.show; }

  // The other F-15SGs in the air (js/air-force.js contacts: { visible, x, z, heading }), as blips on the radar & map
  setAircraft(contacts) {
    this.aircraft = contacts || [];
  }

  // the aircraft blips (a screen transform from the view's centre)
  drawAircraft(ctx, v, size) {
    if (!this.aircraft) return;
    ctx.fillStyle = MAP.aircraft;
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 1.5;
    for (const a of this.aircraft) {
      if (!a.visible) continue;
      const [x, y] = v.pt(a.x, a.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(v.headingAngle(a.heading));
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.8, size * 0.6);
      ctx.lineTo(0, size * 0.25);
      ctx.lineTo(-size * 0.8, size * 0.6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
  }

  addTile(key, ox, oz, outlines) {
    addTileFootprints(key, ox, oz, outlines);
  }

  initEvents() {
    const closeBtn = document.getElementById('close-fullmap-btn');
    const miniCard = document.getElementById('minimap-card');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const centerPlayerBtn = document.getElementById('map-center-player');
    const fullIslandBtn = document.getElementById('map-view-all');

    if (miniCard) {
      miniCard.addEventListener('click', () => this.toggleFullMap(true));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleFullMap(false));
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45);
        this.renderFullMap();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.viewZoom = Math.max(MIN_ZOOM, this.viewZoom / 1.45);
        this.renderFullMap();
      });
    }
    if (centerPlayerBtn) {
      centerPlayerBtn.addEventListener('click', () => {
        const ent = this.controllerManager.getActiveEntity();
        this.viewCenterX = ent.position.x;
        this.viewCenterZ = ent.position.z;
        this.viewZoom = 0.9; // Street-by-street detail zoom
        this.renderFullMap();
      });
    }
    if (fullIslandBtn) {
      fullIslandBtn.addEventListener('click', () => {
        // Fits all of Manhattan, from the Harlem River to the Battery (or the whole island beyond a detailed city)
        const b = ISLAND.bounds || ISLAND_BOUNDS;
        const { w, h } = this.fullSize();
        const e = turnedExtent(b);
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(w / (e.w * 1.15), h / (e.h * 1.06)));
        this.renderFullMap();
      });
    }

    if (this.elSearchInput) {
      this.elSearchInput.addEventListener('input', () => this.search(this.elSearchInput.value));
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) {
        this.toggleFullMap(false);
      } else if (e.code === 'KeyM' && !isTypingInField(e)) {
        this.toggleFullMap(!this.isFullMapOpen);
      }
    });

    if (this.fullCanvas) {
      this.fullCanvas.style.touchAction = 'none';
      this.fullCanvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.isFullMapOpen || this.panPointerId !== null) return;
        e.preventDefault();
        this.panPointerId = e.pointerId;
        this.fullCanvas.setPointerCapture(e.pointerId);
        this.isPanning = true;
        this.dragMoved = false;
        this.panStart.x = e.clientX;
        this.panStart.y = e.clientY;
        this.panStart.cx = this.viewCenterX;
        this.panStart.cz = this.viewCenterZ;
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
      });

      this.fullCanvas.addEventListener('pointermove', (e) => {
        if (!this.isFullMapOpen || !this.fullCanvas) return;
        if (this.isPanning ? e.pointerId !== this.panPointerId : e.pointerType !== 'mouse') return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isPanning) {
          e.preventDefault();
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
          // (the world under the pointer stays under it: the drag turned back into the world frame)
          const c = Math.cos(MAP_ROTATION);
          const sn = Math.sin(MAP_ROTATION);
          this.viewCenterX = this.panStart.cx - (dx * c + dy * sn) / this.viewZoom;
          this.viewCenterZ = this.panStart.cz - (-dx * sn + dy * c) / this.viewZoom;
          this.renderFullMap();
          return;
        }

        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const wPos = this.screenToWorld(mx, my, rect.width, rect.height);
          this.hoverWorld = wPos;
          if (this.elHoverInfo) {
            this.elHoverInfo.textContent = `${getLocationLabel(wPos.x, wPos.z)} · ${this.pickHandler ? 'Click to go here' : this.onPick ? 'Click to drive, take a taxi or teleport here' : 'Click to teleport here'}`;
          }
        }
      });

      this.fullCanvas.addEventListener('pointerup', (e) => {
        if (e.pointerId !== this.panPointerId) return;
        const clicked = !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.cancelPan();
        if (clicked && this.isFullMapOpen && this.fullCanvas) {
          const rect = this.fullCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
            const wPos = this.clampToManhattan(this.screenToWorld(mx, my, rect.width, rect.height));
            if (this.pickHandler) {
              const pick = this.pickHandler;
              this.pickHandler = null;
              pick(wPos.x, wPos.z, getLocationLabel(wPos.x, wPos.z));
              this.renderFullMap();
              return;
            }
            if (this.onPick) {
              this.onPick(wPos.x, wPos.z, getLocationLabel(wPos.x, wPos.z), e.clientX, e.clientY);
              return;
            }
            this.waypoint = {
              x: wPos.x,
              z: wPos.z,
              name: getLocationLabel(wPos.x, wPos.z)
            };
            if (this.onTeleport) {
              this.onTeleport(wPos.x, wPos.z);
            }
            this.renderFullMap();
          }
        }
      });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        this.fullCanvas.addEventListener(type, (e) => {
          if (e.pointerId === this.panPointerId) this.cancelPan();
        });
      }
      window.addEventListener('blur', () => this.cancelPan());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancelPan();
      });

      // Wheel zoom about the cursor (the place under it stays put)
      this.fullCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = this.screenToWorld(mx, my, rect.width, rect.height);
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * factor));
        const c = Math.cos(MAP_ROTATION);
        const sn = Math.sin(MAP_ROTATION);
        const ux = (mx - rect.width * 0.5) / this.viewZoom;
        const uy = (my - rect.height * 0.5) / this.viewZoom;
        this.viewCenterX = before.x - (ux * c + uy * sn);
        this.viewCenterZ = before.z - (-ux * sn + uy * c);
        this.renderFullMap();
      }, { passive: false });
    }
  }

  /**
   * Street / landmark search: highlights every stretch of the matching streets and frames them (or flies to the
   * matching landmark)
   */
  search(text) {
    const q = String(text || '').trim().toLowerCase();
    this.searchHighlight = q;
    this.searchPath = null;
    if (q.length > 0) {
      const lmMatch = NYC_LANDMARKS.find((l) => l.name.toLowerCase().includes(q) || l.short.toLowerCase().includes(q));
      const roads = ROAD_LABELS.filter((l) => l.lower.includes(q) || l.raw.includes(q));
      if (roads.length) {
        this.searchPath = new Path2D();
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of roads) {
          addLine(this.searchPath, l.road.pts);
          b.minX = Math.min(b.minX, l.minX);
          b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ);
          b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      if (lmMatch) {
        this.viewCenterX = lmMatch.x;
        this.viewCenterZ = lmMatch.z;
        this.viewZoom = Math.max(this.viewZoom, 0.9);
      } else if (roads.length) {
        const b = this.searchBounds;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        const e = turnedExtent(b);
        const fit = Math.min(w / (e.w * 1.3 + 1), h / (e.h * 1.3 + 1));
        this.viewZoom = Math.max(0.05, Math.min(1.2, fit));
      }
    }
    this.renderFullMap();
  }

  cancelPan() {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.isPanning = false;
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
    if (id !== null && this.fullCanvas && this.fullCanvas.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) {
      this.cancelPan();
      this.pickHandler = null; // a destination pick ends with the map
      document.body?.classList.remove('nav-picking');
    }
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      // the HUD's popovers live in the top layer, above the map
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    // Layout size (the opening animation's transforms don't change it), at most ~6 megapixels however large the screen
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  // Full map size in CSS pixels
  fullSize() {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  screenToWorld(sx, sy, width, height) {
    return new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, width, height).unproject(sx - width * 0.5, sy - height * 0.5);
  }

  // Teleports land on Manhattan: inside the island's extent at that latitude (anywhere on the island once its land is
  // known: the helicopter arrives over it, the others at its nearest street in the detailed city)
  clampToManhattan(p) {
    if (ISLAND.bounds && CITY.open) return p;
    const z = Math.max(ISLAND_BOUNDS.minZ + 25, Math.min(ISLAND_BOUNDS.maxZ - 25, p.z));
    const shore = getIslandBoundsAtZ(z);
    return { x: Math.max(shore.westX + 12, Math.min(shore.eastX - 12, p.x)), z };
  }

  textWidth(ctx, text) {
    const key = `${ctx.font}|${ctx.letterSpacing || ''}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.textWidths.set(key, w);
    }
    return w;
  }

  /**
   * The ground: land & water, Manhattan with its piers, parkland, blocks, Central Park, building footprints, landmark
   * lots, the main streets at low zoom, shore highways, bridges and the search highlight (world transform of view v)
   */
  drawWorld(ctx, v, isMinimap) {
    const L = mapLayers();
    const s = v.s;
    const px = (n) => n / s; // screen pixels -> metres (line widths)
    v.world(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 0. The rest of the island (js/city-tiles.js), its lakes & reservoirs
    if (ISLAND.land) {
      ctx.fillStyle = MAP.land;
      ctx.fill(ISLAND.land);
      ctx.fillStyle = MAP.water;
      ctx.fill(ISLAND.lakes);
      if (!isMinimap) {
        ctx.lineWidth = px(1.4);
        ctx.strokeStyle = MAP.landEdge;
        ctx.stroke(ISLAND.land);
      }
    }

    // 1. Land around the harbour & the islands
    ctx.fillStyle = MAP.land;
    ctx.fill(L.fillers);
    ctx.fill(L.land);
    ctx.fillStyle = MAP.islands;
    ctx.fill(L.islands);
    if (!isMinimap) {
      ctx.lineWidth = px(1.4);
      ctx.strokeStyle = MAP.landEdge;
      ctx.stroke(L.land);
      ctx.strokeStyle = MAP.islandsEdge;
      ctx.stroke(L.islands);
    }

    // 2. Piers, then Manhattan (roadway deck colour: the streets are the gaps between the blocks) in its bulkhead line
    ctx.fillStyle = MAP.piers;
    ctx.fill(L.piers);
    ctx.fillStyle = MAP.streets;
    ctx.fill(L.manhattan);
    ctx.strokeStyle = MAP.shore;
    ctx.lineWidth = px(isMinimap ? 1.6 : 2.0);
    ctx.stroke(L.manhattan);
    ctx.fillStyle = MAP.water;
    ctx.fill(L.inlandWater);

    // 2b. The island's main roads as lines (to scale where they're wider than a pixel), under the detailed city
    if (ISLAND.roads) {
      ctx.strokeStyle = MAP.mainRoads;
      const widths = [14, 11, 8];
      for (let i = 2; i >= 0; i--) {
        if (i === 2 && s < 0.04) continue; // tertiary roads only once zoomed in
        ctx.lineWidth = Math.max(px(i === 0 ? 1.2 : 0.8), widths[i]);
        ISLAND.roads[i].each(v, (p) => ctx.stroke(p));
      }
    }

    // 2c. The jet's runways (shown from the Air Force menu): the strip to scale, its centreline once zoomed in
    if (RUNWAY_LAYER.show) {
      for (const r of RUNWAY_LAYER.list) {
        const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
        const half = r.length / 2, w = Math.max(r.width / 2, px(2.5));
        ctx.beginPath();
        ctx.moveTo(r.x - fx * half - fz * w, r.z - fz * half + fx * w);
        ctx.lineTo(r.x + fx * half - fz * w, r.z + fz * half + fx * w);
        ctx.lineTo(r.x + fx * half + fz * w, r.z + fz * half - fx * w);
        ctx.lineTo(r.x - fx * half + fz * w, r.z - fz * half - fx * w);
        ctx.closePath();
        ctx.fillStyle = MAP.runway;
        ctx.fill();
        if (s > 0.06) {
          ctx.strokeStyle = MAP.runwayMark;
          ctx.lineWidth = px(1);
          ctx.setLineDash([px(6), px(5)]);
          ctx.beginPath();
          ctx.moveTo(r.x - fx * (half - 60), r.z - fz * (half - 60));
          ctx.lineTo(r.x + fx * (half - 60), r.z + fz * (half - 60));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // 3. Parkland, blocks (curb islands) and park blocks
    ctx.fillStyle = MAP.park;
    L.parkLand.each(v, (p) => ctx.fill(p));
    ctx.fillStyle = MAP.block;
    L.blocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.22) {
      ctx.strokeStyle = MAP.blockEdge;
      ctx.lineWidth = px(Math.min(1.2, 0.5 + s));
      L.blocks.each(v, (p) => ctx.stroke(p));
    }
    ctx.fillStyle = MAP.park;
    L.parkBlocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.1) {
      ctx.strokeStyle = MAP.parkEdge;
      ctx.lineWidth = px(1);
      L.parkBlocks.each(v, (p) => ctx.stroke(p));
    }

    // 4. Central Park: meadows, drives & transverses, water bodies
    if (v.sees(L.cpBounds)) {
      ctx.fillStyle = MAP.lawn;
      ctx.fill(L.cpLawns);
      ctx.strokeStyle = MAP.drive;
      ctx.lineWidth = Math.max(px(1), 7);
      ctx.stroke(L.cpDrives);
      ctx.strokeStyle = MAP.transverse;
      ctx.lineWidth = Math.max(px(1), 10);
      ctx.stroke(L.cpTransverses);
      ctx.fillStyle = MAP.pond;
      ctx.fill(L.cpWater);
      ctx.strokeStyle = MAP.pondEdge;
      ctx.lineWidth = px(1);
      ctx.stroke(L.cpWater);
    }

    // 5. Building footprints, lowest first
    if (s >= 0.18) {
      const fp = footprintLayers(this.allBlocks);
      if (fp) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = MAP.buildings[i];
          fp.tones[i].each(v, (p) => ctx.fill(p));
        }
        if (s >= 0.6) {
          ctx.strokeStyle = MAP.buildingEdge;
          ctx.lineWidth = px(0.8);
          for (let i = 0; i < 3; i++) fp.tones[i].each(v, (p) => ctx.stroke(p));
        }
      }
    }

    // 5b. The island tiles' buildings streamed in so far
    if (s >= 0.18 && TILE_FOOTPRINTS.version) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = MAP.buildings[i];
        TILE_FOOTPRINTS.tones[i].each(v, (p) => ctx.fill(p));
      }
    }

    // 6. Landmark lots (real OpenStreetMap outlines)
    if (s >= 0.05) {
      ctx.fillStyle = MAP.block;
      ctx.fill(L.landmarks);
      ctx.fillStyle = MAP.landmarkFill;
      ctx.fill(L.landmarks);
      ctx.strokeStyle = MAP.landmarkEdge;
      ctx.lineWidth = px(Math.max(0.9, Math.min(1.6, 1.4 * s)));
      ctx.stroke(L.landmarks);
    }

    // 7. Main streets as lines at low zoom
    if (s < 0.16) {
      ctx.strokeStyle = MAP.mainRoads;
      ctx.lineWidth = px(s < 0.05 ? 0.7 : 1.1);
      L.mainRoads.each(v, (p) => ctx.stroke(p));
    }

    // 8. Shore highways (and the island's expressways)
    ctx.strokeStyle = MAP.highway;
    ctx.lineWidth = Math.max(px(isMinimap ? 2.4 : 1.6), 14);
    ctx.stroke(L.highways);
    if (ISLAND.highways) {
      ctx.lineWidth = Math.max(px(isMinimap ? 2 : 1.4), 16);
      ISLAND.highways.each(v, (p) => ctx.stroke(p));
    }

    // 9. Bridges
    ctx.strokeStyle = MAP.bridge;
    ctx.lineCap = 'butt';
    for (const br of L.bridges) {
      ctx.lineWidth = Math.max(px(2), br.width);
      ctx.stroke(br.path);
    }
    ctx.lineCap = 'round';

    // 10. Search highlight: every stretch of the matching streets
    if (this.searchPath && !isMinimap) {
      ctx.strokeStyle = MAP.search;
      ctx.lineWidth = Math.max(px(3), 9);
      ctx.stroke(this.searchPath);
    }
  }

  /**
   * Street names along the streets (screen transform of view v): the best anchor of each street that fits its name,
   * one label per street per `sameNameGap` pixels, none overlapping another (or the boxes already in `placed`)
   */
  drawRoadLabels(ctx, v, { fontPx = 10, maxLabels = 400, sameNameGap = 260, placed = [], majorOnly = false } = {}) {
    const s = v.s;
    const q = this.searchHighlight;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    const inset = (fontPx * 2.5) / s;
    const minX = v.minX + inset;
    const maxX = v.maxX - inset;
    const minZ = v.minZ + inset;
    const maxZ = v.maxZ - inset;
    const cands = [];
    for (const l of ROAD_LABELS) {
      if (l.maxX < minX || l.minX > maxX || l.maxZ < minZ || l.minZ > maxZ) continue;
      const hit = q.length > 0 && (l.lower.includes(q) || l.raw.includes(q));
      if (majorOnly && !l.major && !hit) continue;
      const width = this.textWidth(ctx, l.text);
      const need = (width + 14) / s;
      for (const a of l.anchors) {
        if (a.len < need || a.x < minX || a.x > maxX || a.z < minZ || a.z > maxZ) continue;
        const d = Math.hypot(a.x - v.cx, a.z - v.cz) * s;
        cands.push({ l, a, width, hit, score: (hit ? 1e6 : 0) + (l.highway ? 3000 : 0) + (l.major ? 2000 : 0) + Math.min(a.len * s, 400) - d * 0.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    const byName = new Map();
    let n = 0;
    for (const c of cands) {
      if (n >= maxLabels) break;
      const [X, Y] = v.pt(c.a.x, c.a.z);
      // (on screen: inside the view, with room for the name; and turned with the map, kept upright)
      if (Math.abs(X) > v.w * 0.5 - fontPx * 2.5 || Math.abs(Y) > v.h * 0.5 - fontPx * 2.5) continue;
      const ang = upright(c.a.ang + v.rot);
      const same = byName.get(c.l.text);
      if (same && same.some(([x, y]) => Math.hypot(x - X, y - Y) < sameNameGap)) continue;
      const hw = c.width * 0.5 + 3;
      const hh = fontPx * 0.5 + 2;
      const ca = Math.abs(Math.cos(ang));
      const sa = Math.abs(Math.sin(ang));
      const bx = hw * ca + hh * sa;
      const by = hw * sa + hh * ca;
      const box = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(ang);
      ctx.fillStyle = c.hit ? MAP.search : c.l.highway ? '#e3a857' : c.l.major ? '#e8ebf0' : '#9ba5b3';
      ctx.strokeText(c.l.text, 0, 0);
      ctx.fillText(c.l.text, 0, 0);
      ctx.restore();
      n++;
    }
    ctx.textBaseline = 'alphabetic';
  }

  update() {
    // The full map covers the whole screen, radar included
    if (this.isFullMapOpen) {
      this.renderFullMap();
    } else {
      this.renderMinimap();
    }
  }

  // =========================================================================
  // 1. GTA 6-STYLE LIVE RADAR MINIMAP (BOTTOM-LEFT HUD)
  // =========================================================================
  renderMinimap() {
    if (!this.miniCtx || !this.miniCanvas) return;
    // Nothing to draw while the radar is hidden (narrow screens, clean view)
    if (!this.miniCanvas.offsetParent || document.body.classList.contains('hud-minimized')) return;
    const ctx = this.miniCtx;
    // Radar size in CSS pixels, backed at the device pixel ratio (crisp street names on HiDPI screens)
    const w = this.miniCanvas.clientWidth;
    const h = this.miniCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.miniCanvas.width !== bw || this.miniCanvas.height !== bh) {
      this.miniCanvas.width = bw;
      this.miniCanvas.height = bh;
      this.miniCache = null;
    }

    const ent = this.controllerManager.getActiveEntity();
    const px = ent.position.x;
    const pz = ent.position.z;
    // Ground-level radar shows ~800 m of the city; it zooms out as the camera climbs (helicopter)
    const target = Math.max(0.05, RADAR_SCALE / (1 + Math.max(0, ent.position.y - 25) / 180));
    this.miniScale += (target - this.miniScale) * 0.08;
    const scale = this.miniScale;

    if (this.elMiniStreet) {
      const label = getLocationLabel(px, pz);
      if (label !== this.miniStreetText) {
        this.miniStreetText = label;
        this.elMiniStreet.textContent = label;
      }
    }

    // Ground layers & street names come from a cached render twice the radar's size, redrawn when the player nears its
    // edge or the zoom drifts (or the buildings arrive)
    const fp = footprintLayers(this.allBlocks);
    const version = `${fp ? fp.version : 0}|${ISLAND.version}|${TILE_FOOTPRINTS.version}|${RUNWAY_LAYER.version}`;
    let c = this.miniCache;
    // (where the cache's centre is on the radar now, in pixels: it covers the radar while that is under its half size)
    const off = c ? new MapView(px, pz, scale, w, h, dpr).pt(c.cx, c.cz) : null;
    const kc = c ? scale / c.s : 1;
    if (!c || c.version !== version || Math.abs(scale / c.s - 1) > 0.12 ||
      Math.abs(off[0]) > w * kc - w / 2 - 8 ||
      Math.abs(off[1]) > h * kc - h / 2 - 8) {
      if (!c) {
        c = this.miniCache = { canvas: document.createElement('canvas') };
        c.canvas.width = bw * 2;
        c.canvas.height = bh * 2;
        c.ctx = c.canvas.getContext('2d');
      }
      c.cx = px;
      c.cz = pz;
      c.s = scale;
      c.version = version;
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = MAP.water;
      c.ctx.fillRect(0, 0, bw * 2, bh * 2);
      const cv = new MapView(px, pz, scale, w * 2, h * 2, dpr);
      this.drawWorld(c.ctx, cv, true);
      cv.screen(c.ctx);
      this.drawRoadLabels(c.ctx, cv, { fontPx: 9.5, maxLabels: 28, sameNameGap: 180 });
    }

    const v = new MapView(px, pz, scale, w, h, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, bw, bh);
    const k = scale / c.s;
    const [ox, oy] = v.pt(c.cx, c.cz);
    ctx.drawImage(c.canvas, dpr * (ox - w * k + w * 0.5), dpr * (oy - h * k + h * 0.5), dpr * w * 2 * k, dpr * h * 2 * k);

    v.screen(ctx);
    const q = [0, 0];

    // Live moving traffic blips on radar
    if (this.trafficSystem && this.trafficSystem.cars) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      for (let i = 0; i < this.trafficSystem.cars.length; i += 2) {
        const car = this.trafficSystem.cars[i];
        const [cx, cy] = v.pt(car.x, car.z, q);
        if (Math.abs(cx) < w * 0.5 && Math.abs(cy) < h * 0.5) {
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // GPS route to the active waypoint
    if (this.waypoint) {
      const [wx, wy] = v.pt(this.waypoint.x, this.waypoint.z);
      if (this.routeLine) drawRoutePath(ctx, this.routeLine, v, 3);
      else drawRoute(ctx, v, px, pz, this.waypoint.x, this.waypoint.z, 3);
      drawWaypoint(ctx, wx, wy, 4.5);
    }

    // Landmark blips
    for (const lm of NYC_LANDMARKS) {
      const [lx, ly] = v.pt(lm.x, lm.z, q);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The other F-15SGs in the air
    this.drawAircraft(ctx, v, 5);

    // Camera FOV Cone & Player Arrow at center (0, 0)
    const camDir = this.cameraSystem.currentLookAt.clone().sub(this.cameraSystem.currentPos);
    const camAngle = Math.atan2(camDir.x, camDir.z);

    ctx.save();
    ctx.rotate(v.headingAngle(camAngle));
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.rotate(v.headingAngle(ent.heading));
    drawPlayerArrow(ctx, -9, 6.5, 7);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 2. FULL NEW YORK CITY INTERACTIVE STREET MAP MODAL ([M])
  // =========================================================================
  renderFullMap() {
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);

    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are at ${getLocationLabel(ent.position.x, ent.position.z)}`;
      if (text !== this.playerInfoText) {
        this.playerInfoText = text;
        this.elPlayerInfo.textContent = text;
      }
    }

    // Ground layers, names & landmark pins: re-rendered only when the view, the search or the buildings change
    const fp = footprintLayers(this.allBlocks);
    const key = `${v.cx}|${v.cz}|${v.s}|${this.fullCanvas.width}|${this.fullCanvas.height}|${this.searchHighlight}|${fp ? fp.version : 0}|${ISLAND.version}|${TILE_FOOTPRINTS.version}|${RUNWAY_LAYER.version}`;
    if (!this.fullStatic) this.fullStatic = document.createElement('canvas');
    if (key !== this.fullStaticKey) {
      this.fullStaticKey = key;
      const sc = this.fullStatic;
      if (sc.width !== this.fullCanvas.width || sc.height !== this.fullCanvas.height) {
        sc.width = this.fullCanvas.width;
        sc.height = this.fullCanvas.height;
      }
      this.renderFullMapStatic(sc.getContext('2d'), v);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fullStatic, 0, 0);
    v.screen(ctx);

    // GPS route on the full map
    if (this.waypoint) {
      const [wx, wy] = v.pt(this.waypoint.x, this.waypoint.z);
      if (this.routeLine) drawRoutePath(ctx, this.routeLine, v, 4);
      else drawRoute(ctx, v, ent.position.x, ent.position.z, this.waypoint.x, this.waypoint.z, 4);
      drawWaypoint(ctx, wx, wy, 7);
    }

    // The other F-15SGs in the air
    this.drawAircraft(ctx, v, 7);

    // Live Player Blip & Heading Arrow, with a slow pulse to find it at a glance
    const [px, py] = v.pt(ent.position.x, ent.position.z);

    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.24 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(v.headingAngle(ent.heading));
    drawPlayerArrow(ctx, -11, 7.5, 8);
    ctx.restore();

    ctx.restore();
  }

  renderFullMapStatic(ctx, v) {
    const { w, h, s } = v;
    ctx.save();
    // 1. Harbor & River Water Base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 2. The ground: boroughs, islands, Manhattan's blocks, parks, footprints, highways & bridges
    this.drawWorld(ctx, v, false);

    v.screen(ctx);
    const q = [0, 0];

    // 3. Iconic Landmark Pins & Collision-Free Labels (placed first: their boxes keep the other names clear)
    ctx.font = `700 11px ${FONT}`;
    const placed = [];
    const pins = [];
    for (const lm of NYC_LANDMARKS) {
      const [lx, ly] = v.pt(lm.x, lm.z, q);
      if (Math.abs(lx) > w * 0.48 || Math.abs(ly) > h * 0.48) continue;
      const labelW = this.textWidth(ctx, lm.short) + 6;
      const box = [lx + 6, ly - 8, lx + 8 + labelW, ly + 7];
      const showLabel = !overlaps(placed, box);
      placed.push([lx - 6, ly - 6, lx + 6, ly + 6]);
      if (showLabel) placed.push(box);
      pins.push({ lm, lx, ly, showLabel });
    }

    // 3b. The airbases' names, over their runways (one name for Changi's four)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (RUNWAY_LAYER.show) {
      const bases = new Map();
      for (const r of RUNWAY_LAYER.list) {
        const b = bases.get(r.name) || { x: 0, z: 0, n: 0 };
        b.x += r.x; b.z += r.z; b.n++;
        bases.set(r.name, b);
      }
      ctx.font = `700 11px ${FONT}`;
      for (const [name, b] of bases) {
        const [dx, dy] = v.pt(b.x / b.n, b.z / b.n, q);
        if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
        const half = this.textWidth(ctx, name) * 0.5 + 4;
        const box = [dx - half, dy - 9, dx + half, dy + 9];
        if (overlaps(placed, box)) continue;
        placed.push(box);
        ctx.fillStyle = MAP.halo;
        ctx.fillText(name, dx + 1, dy + 1);
        ctx.fillStyle = 'rgba(220, 228, 238, 0.9)';
        ctx.fillText(name, dx, dy);
      }
    }

    // 4. Borough, waterway & neighbourhood watermark titles (wherever they fit), letter-spaced like a printed atlas
    const tracking = 'letterSpacing' in ctx;
    for (const [label, x, z, kind] of AREA_LABELS) {
      if (kind === 0 && s > 0.07) continue;
      if (kind === 2 && (s < 0.035 || s > 1.2)) continue;
      const [dx, dy] = v.pt(x, z, q);
      if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
      if (kind === 0) {
        ctx.font = `700 15px ${FONT}`;
        ctx.fillStyle = 'rgba(168, 178, 192, 0.5)';
        if (tracking) ctx.letterSpacing = '3px';
      } else if (kind === 1) {
        ctx.font = `italic 500 12px ${FONT}`;
        ctx.fillStyle = 'rgba(112, 168, 214, 0.55)';
        if (tracking) ctx.letterSpacing = '1.5px';
      } else {
        ctx.font = `700 10.5px ${FONT}`;
        ctx.fillStyle = 'rgba(168, 178, 192, 0.46)';
        if (tracking) ctx.letterSpacing = '1.8px';
      }
      const half = this.textWidth(ctx, label) * 0.5 + 4;
      const box = [dx - half, dy - 8, dx + half, dy + 8];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      ctx.fillText(label, dx, dy);
    }
    if (tracking) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'alphabetic';

    // 5. Street & Avenue names along their real course (collision-free at all zoom levels)
    const fontPx = Math.max(9, Math.min(12, Math.round(9.5 * Math.sqrt(Math.max(s, 0.4)))));
    this.drawRoadLabels(ctx, v, { fontPx, maxLabels: 420, sameNameGap: 300, placed, majorOnly: s < 0.3 });

    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    for (const { lm, lx, ly, showLabel } of pins) {
      ctx.fillStyle = MAP.halo;
      ctx.beginPath();
      ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (showLabel) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP.halo;
        ctx.strokeText(lm.short, lx + 9, ly + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lm.short, lx + 9, ly + 4);
      }
    }

    // 6. Scale bar (true metres); the true-north compass sits with the map controls (index.html)
    this.drawScaleBar(ctx, v);
    ctx.restore();
  }

  drawScaleBar(ctx, v) {
    const target = 120 / v.s; // metres in ~120 px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    const x0 = -v.w * 0.5 + 24;
    const y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 239, 244, 0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, x0 + len + 8, y0 + 3);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.95)';
    ctx.fillText(label, x0 + len + 8, y0 + 3);
  }
}

export { NYCMapSystem, MapView, MAP_ROTATION };
