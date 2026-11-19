// js/city-common.js
// Shared by the city configurations (nyc-config.js, open-city-config.js; see city-config.js): flat point arrays, the
// blocks (curb islands) with their spatial index, the nearest-road index, the traffic signal cycle & keyboard focus

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Blocks: [outline, lot rects, park share, park name, rectangular, frontage frames] (js/*-geodata.js) -> block records
// ---------------------------------------------------------------------------------------------------------------------
function createBlocks(geoBlocks) {
  return geoBlocks.map(([flat, rects, park, parkName, isRect, frames], id) => {
    const poly = toPts(flat);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, a = 0, cx = 0, cz = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i], q = poly[j];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      const c = q.x * p.z - p.x * q.z;
      a += c; cx += (q.x + p.x) * c; cz += (q.z + p.z) * c;
    }
    a *= 0.5;
    const area = Math.abs(a);
    return {
      id, poly, rects, frames: frames || null, park, parkName, rect: !!isRect, area,
      minX, maxX, minZ, maxZ,
      cx: a ? cx / (6 * a) : (minX + maxX) / 2,
      cz: a ? cz / (6 * a) : (minZ + maxZ) / 2,
      median: /Malls?$/.test(parkName) || Math.min(maxX - minX, maxZ - minZ) < 9
    };
  });
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// blockAt(x, z) & blocksInRect(minX, maxX, minZ, maxZ) over the blocks
function createBlockIndex(BLOCKS) {
  // Spatial index of the blocks (64 m cells)
  const BLOCK_CELL = 64;
  const BLOCK_GRID = new Map();
  for (const b of BLOCKS) {
    for (let ix = Math.floor(b.minX / BLOCK_CELL); ix <= Math.floor(b.maxX / BLOCK_CELL); ix++) {
      for (let iz = Math.floor(b.minZ / BLOCK_CELL); iz <= Math.floor(b.maxZ / BLOCK_CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!BLOCK_GRID.has(k)) BLOCK_GRID.set(k, []);
        BLOCK_GRID.get(k).push(b);
      }
    }
  }
  /** The block (curb island) under (x, z), or null on the roadway / in the water */
  function blockAt(x, z) {
    const list = BLOCK_GRID.get(Math.floor(x / BLOCK_CELL) * 100000 + Math.floor(z / BLOCK_CELL));
    if (!list) return null;
    for (const b of list) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.rect || pointInPoly(b.poly, x, z)) return b;
    }
    return null;
  }
  /** Blocks whose bounds overlap a rectangle */
  function blocksInRect(minX, maxX, minZ, maxZ) {
    const out = new Set();
    for (let ix = Math.floor(minX / BLOCK_CELL); ix <= Math.floor(maxX / BLOCK_CELL); ix++) {
      for (let iz = Math.floor(minZ / BLOCK_CELL); iz <= Math.floor(maxZ / BLOCK_CELL); iz++) {
        const list = BLOCK_GRID.get(ix * 100000 + iz);
        if (list) for (const b of list) if (b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ) out.add(b);
      }
    }
    return [...out];
  }
  return { blockAt, blocksInRect };
}

// nearestRoads(x, z, radius) over the named roads ({ name, pts: [{ x, z }] })
function createRoadIndex(ROADS) {
  // Nearest-road index (labels, sidewalk tests): uniform grid of road segments
  const ROAD_CELL = 64;
  const ROAD_GRID = new Map();
  for (const r of ROADS) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const seg = { r, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      const ix0 = Math.floor(Math.min(a.x, b.x) / ROAD_CELL), ix1 = Math.floor(Math.max(a.x, b.x) / ROAD_CELL);
      const iz0 = Math.floor(Math.min(a.z, b.z) / ROAD_CELL), iz1 = Math.floor(Math.max(a.z, b.z) / ROAD_CELL);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = ix * 100000 + iz;
        if (!ROAD_GRID.has(k)) ROAD_GRID.set(k, []);
        ROAD_GRID.get(k).push(seg);
      }
    }
  }
  /** Nearest roads to (x, z) within `radius`: [{ road, dist }] sorted by distance (one entry per road name) */
  function nearestRoads(x, z, radius = 60) {
    const best = new Map();
    const ix0 = Math.floor((x - radius) / ROAD_CELL), ix1 = Math.floor((x + radius) / ROAD_CELL);
    const iz0 = Math.floor((z - radius) / ROAD_CELL), iz1 = Math.floor((z + radius) / ROAD_CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const list = ROAD_GRID.get(ix * 100000 + iz);
      if (!list) continue;
      for (const s of list) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
        const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
        if (d > radius) continue;
        const prev = best.get(s.r.name);
        if (!prev || d < prev.dist) best.set(s.r.name, { road: s.r, dist: d, horizontal: Math.abs(dx) > Math.abs(dz) });
      }
    }
    return [...best.values()].sort((a, b) => a.dist - b.dist);
  }
  return nearestRoads;
}

// Keyboard shortcuts are ignored while typing into a form field (e.g. the map's street search box)
function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
}

// Traffic signal cycle shared by the signal heads (street-details.js) and the traffic (traffic.js), in seconds:
// avenues green until avenueAmber, amber until avenueRed; cross streets green from avenueRed until streetAmber,
// amber until the end of the cycle. Pedestrians cross with the traffic that runs parallel to them, stepping off
// only on the WALK, the first `walk` seconds of its green: long enough before the cross traffic's green for the
// slowest walker to get across the widest avenue.
const SIGNAL_TIMING = { cycle: 60, avenueAmber: 26, avenueRed: 30, streetAmber: 56, walk: 7 };

// 'green', 'amber' or 'red' for avenue or cross street traffic at a given time
function signalPhase(time, isAvenue) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const t = ((time % cycle) + cycle) % cycle;
  if (isAvenue) return t < avenueAmber ? 'green' : t < avenueRed ? 'amber' : 'red';
  return t < avenueRed ? 'red' : t < streetAmber ? 'green' : 'amber';
}

// Do pedestrians walking alongside avenue (or cross street) traffic have the WALK at a given time?
function walkSignal(time, isAvenue) {
  const { cycle, avenueRed, walk } = SIGNAL_TIMING;
  const t = (((time - (isAvenue ? 0 : avenueRed)) % cycle) + cycle) % cycle;
  return t < walk;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vehicle liveries (CITY.vehicles): New York's, which a city's config may override part by part (GEO.vehicles)
//   taxis: the taxi fleet's paints (repeat one to make it commoner); taxiBadge: the door badge's plate (null: the
//   lettering straight on the paint), taxiLettering, taxiMedallion: the medallion number on the rear quarter;
//   plate: front plate colour & the rear plates' atlas (bg, ink, labels); playerTaxi: the player's taxi's door decal
//   & plates; bus: livery & destination sign; labels: the HUD's names for the player's car & bicycle
// ---------------------------------------------------------------------------------------------------------------------
const NYC_VEHICLES = {
  taxis: [0xffbe14],
  taxiBadge: 0x121417,
  taxiLettering: 0xffbe14,
  taxiMedallion: true,
  plate: { front: 0xf2b718, bg: '#f2b718', ink: '#17212c', labels: ['4KM 728', '7TR 319', '2BJ 506', '6XL 842'] },
  playerTaxi: {
    door: { bg: '#ffbe14', ink: '#111317', emblem: 'T', title: 'NYC TAXI', lines: ['7Y48 · MEDALLION', '$3.00 INITIAL FARE'] },
    plate: { bg: '#ffb81c', band: '#0d2244', ink: '#0d2244', top: 'NEW YORK', number: '7Y48A', bottom: 'NYC T&LC' }
  },
  bus: { body: 0xf0f4f8, stripe: 0x0058b8, ribbon: 0x00a8e8, skirt: 0x1c2026, route: 'M1', routeBadge: '#0058b8', destination: '5 AV / HARLEM' },
  labels: { car: 'NYC Yellow Taxi', cyclist: 'NYC Bike Lane Cyclist' }
};
function vehiclesFor(overrides = {}) {
  const o = overrides || {};
  return {
    ...NYC_VEHICLES,
    ...o,
    plate: { ...NYC_VEHICLES.plate, ...o.plate },
    playerTaxi: {
      door: { ...NYC_VEHICLES.playerTaxi.door, ...(o.playerTaxi || {}).door },
      plate: { ...NYC_VEHICLES.playerTaxi.plate, ...(o.playerTaxi || {}).plate }
    },
    bus: { ...NYC_VEHICLES.bus, ...o.bus },
    labels: { ...NYC_VEHICLES.labels, ...o.labels }
  };
}

export { toPts, createBlocks, createBlockIndex, createRoadIndex, isTypingInField, SIGNAL_TIMING, signalPhase, walkSignal, NYC_VEHICLES, vehiclesFor };
