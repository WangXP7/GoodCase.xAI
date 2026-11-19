// The rest of what OpenStreetMap maps here (osm_extra.json): the pedestrian network, platforms, canopies,
// car parks, barriers, waterways, pools, gates and small objects.
//
// Returns
//   areas       [{ kind, code, ring }]            ground surfaces (clipped to tiles by the caller)
//   marks       [{ kind, ring }]                  paint: parking bays, hydrant covers
//   props       [{ kind, variant, rot, x, z, scale }]
//   barriers    [[x1, z1, x2, z2, -type]]         fences, walls, hedges (BARRIER codes)
//   structures  { footbridges, platforms, canopies }   built by the client (src/world/structures.js)
//   walkLines   [[[x, z], ...]]                   pedestrian streets and paths, for the road split
import fs from 'node:fs';
import { AREA, PROP, BARRIER } from '../../src/shared/tileformat.js';
import { hash, forEachAlong, inRings } from './landscape.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };
// not out in the open: underground passages, indoor corridors, basements
const hidden = (t) => (t.tunnel && t.tunnel !== 'no') || t.indoor === 'yes' || t.location === 'underground' || (num(t.level) ?? 0) < 0 || (num(t.layer) ?? 0) < 0;

export function readExtra(file, project) {
  const { elements } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pos = new Map(), ways = [], points = [];
  for (const e of elements) if (e.type === 'node') { pos.set(e.id, project(e.lon, e.lat)); if (e.tags) points.push({ id: e.id, tags: e.tags, x: pos.get(e.id)[0], z: pos.get(e.id)[1] }); }
  for (const e of elements) if (e.type === 'way' && e.tags) {
    const ids = e.nodes.filter((id) => pos.has(id)), pts = ids.map((id) => pos.get(id));
    if (pts.length >= 2) ways.push({ id: e.id, tags: e.tags, ids, pts, closed: ids.length >= 4 && ids[0] === ids.at(-1) });
  }
  return { ways, points };
}

const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]; s += x2 * z1 - x1 * z2; } return s / 2; };
const openRing = (pts) => { const r = pts.slice(0, -1); if (ringArea(r) < 0) r.reverse(); return r; };

// Smallest rectangle around a ring, aligned to one of its edges: centre, unit long axis, half lengths a >= b.
function minAreaRect(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of r) { const u = x * dx + z * dz, v = -x * dz + z * dx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, dx, dz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { dx, dz, u0, u1, v0, v1 } = best, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
  const c = { cx: uc * dx - vc * dz, cz: uc * dz + vc * dx };
  return hu >= hv ? { ...c, ax: dx, az: dz, a: hu, b: hv } : { ...c, ax: -dz, az: dx, a: hv, b: hu };
}

// A ribbon of width w along a polyline, as one quad per segment.
function ribbon(pts, w, emit) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const nx = (-(bz - az) / len) * w / 2, nz = ((bx - ax) / len) * w / 2;
    emit([[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]], (ax + bx) / 2, (az + bz) / 2);
  }
}

const WALK_WIDTH = { pedestrian: 5, footway: 2.2, path: 1.6, cycleway: 2, steps: 2.2 };
const BARRIER_OF = { fence: BARRIER.FENCE, wall: BARRIER.WALL, retaining_wall: BARRIER.RETAINING, hedge: BARRIER.HEDGE, guard_rail: BARRIER.GUARD_RAIL };
const WATER_WIDTH = { river: 9, canal: 6, stream: 2.5, ditch: 1 };

// idx: PolyIndex { building, road, carriageway, sidewalk, water }; ground(x, z); rails: profiled railway lines
// ({ pts: [x, y, z, ...] }); roadAt: Map of OSM node id -> { dx, dz } direction of the road through it.
export function buildExtras({ ways, points }, { idx, ground, inBounds, rails, roadAt }) {
  const out = { areas: [], marks: [], props: [], barriers: [], walkLines: [], structures: { footbridges: [], platforms: [], canopies: [] }, count: {} };
  const tally = (k, n = 1) => { out.count[k] = (out.count[k] ?? 0) + n; };
  const lampCells = new Set(); // (one path lamp per 14 m square: paths that run side by side share them)
  const quadArea = (kind, code) => (ring, mx, mz) => { if (inBounds(mx, mz)) out.areas.push({ kind, code, ring }); };

  // rail level near a point (platforms sit beside the track)
  const railNear = (x, z) => {
    let best = null, bd = 14;
    for (const l of rails) for (let i = 0; i < l.pts.length; i += 3) { const d = Math.hypot(l.pts[i] - x, l.pts[i + 2] - z); if (d < bd) { bd = d; best = l.pts[i + 1]; } }
    return best;
  };

  // ---- the pedestrian network
  // Deck level of every footbridge node: a bridge either spans a dip from bank to bank or stands a storey up.
  const deck = new Map();
  for (const w of ways) {
    const t = w.tags;
    if (!WALK_WIDTH[t.highway] || t.highway === 'steps' || !t.bridge || t.bridge === 'no' || hidden(t) || w.closed) continue;
    const g = w.pts.map(([x, z]) => ground(x, z)), ends = Math.min(g[0], g.at(-1));
    let low = Infinity;
    forEachAlong(w.pts, 3, (x, z) => { low = Math.min(low, ground(x, z)); }, 0);
    const level = ends - low > 2.5 ? Math.max(g[0], g.at(-1)) : Math.max(...g) + 4.9 * Math.max(1, num(t.layer) ?? 1);
    for (const id of w.ids) deck.set(id, Math.max(deck.get(id) ?? -Infinity, level));
  }
  for (const w of ways) {
    const t = w.tags, hw = t.highway;
    if (!WALK_WIDTH[hw] || hidden(t)) continue;
    if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.footway === 'link') continue; // already on the map as road surfaces and zebra crossings
    const width = Math.min(8, num(t.width) ?? WALK_WIDTH[hw]);
    if (w.closed && (t.area === 'yes' || hw === 'pedestrian') && w.pts.length >= 4 && Math.abs(ringArea(w.pts.slice(0, -1))) > 20 && !(t.bridge && t.bridge !== 'no')) {
      out.areas.push({ kind: AREA.PLAZA, code: 0, ring: openRing(w.pts), clip: true }); tally('plaza');
      continue;
    }
    // level of each point: on a deck, or the ground; stairs run from one to the other
    const y = w.ids.map((id, i) => deck.get(id) ?? ground(w.pts[i][0], w.pts[i][1]));
    if (hw === 'steps') { const a = y[0], b = y.at(-1); y.forEach((_, i) => { y[i] = a + ((b - a) * i) / (y.length - 1); }); }
    const raised = y.some((v, i) => v - ground(w.pts[i][0], w.pts[i][1]) > 1.2);
    if (raised) {
      out.structures.footbridges.push({ pts: w.pts.flatMap(([x, z], i) => [r2(x), r2(y[i]), r2(z)]), width: r2(Math.max(2, width)), steps: hw === 'steps' });
      tally(hw === 'steps' ? 'bridge stairs' : 'footbridge');
      continue;
    }
    if (hw !== 'steps') out.walkLines.push(w.pts);
    const unpaved = /gravel|unpaved|dirt|ground|compacted|earth|sand/.test(t.surface ?? '');
    ribbon(w.pts, width, (ring, mx, mz) => {
      // on a road outline the surface is already there (as carriageway, sidewalk or a pedestrian street)
      if (!inBounds(mx, mz) || idx.road.has(mx, mz) || idx.building.has(mx, mz)) return;
      out.areas.push({ kind: hw === 'steps' ? AREA.STEPS : AREA.PATH, code: unpaved ? 1 : 0, ring });
    });
    // Lamps along a path that is mapped as lit, or runs through a park (unless mapped as unlit): OSM seldom has the lamps
    // themselves, so they are set out beside the path, on alternating sides. A park lamp is half a street light.
    const mid = w.pts[w.pts.length >> 1];
    if (hw !== 'steps' && (t.lit === 'yes' || (t.lit !== 'no' && idx.park?.has(mid[0], mid[1])))) {
      forEachAlong(w.pts, 26, (x, z, dx, dz, n) => {
        const side = n % 2 ? 1 : -1, off = width / 2 + 0.5, lx = x - dz * off * side, lz = z + dx * off * side;
        const cell = Math.floor(lx / 14) + ',' + Math.floor(lz / 14);
        if (!inBounds(lx, lz) || idx.road.has(lx, lz) || idx.building.has(lx, lz) || idx.water.has(lx, lz) || lampCells.has(cell)) return;
        lampCells.add(cell);
        out.props.push({ kind: PROP.LIGHT, variant: 1, rot: Math.atan2(dz * side, -dx * side), x: lx, z: lz, scale: 0.5 }); tally('path lamp');
      }, 8 + (w.id % 13));
    }
    tally(hw === 'steps' ? 'stairs' : hw);
  }

  // ---- platforms and canopies
  for (const w of ways) {
    const t = w.tags;
    if ((t.railway === 'platform' || t.public_transport === 'platform') && !hidden(t) && t.bus !== 'yes' && t.highway !== 'bus_stop') {
      // a closed outline, or a line widened to a platform
      let ring = w.closed ? openRing(w.pts) : null;
      if (!ring) { const left = [], right = []; ribbon(w.pts, 3.2, (q) => { left.push(q[0], q[1]); right.unshift(q[3], q[2]); }); ring = [...left, ...right]; if (ringArea(ring) < 0) ring.reverse(); }
      if (ring.length < 3) continue;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const rail = railNear(cx, cz);
      if (rail == null || !inBounds(cx, cz)) continue; // no visible track beside it: an underground platform
      out.structures.platforms.push({ ring: ring.map(([x, z]) => [r2(x), r2(z)]), y: r2(rail + 0.95), covered: t.covered === 'yes' || Math.abs(ringArea(ring)) > 250 });
      tally('platform');
    } else if (t.building === 'roof' && w.closed && !hidden(t)) {
      const ring = openRing(w.pts), cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      if (!inBounds(cx, cz)) continue;
      // A roof far above the ground is part of a larger structure (the platforms in the legs of Tokyo Tower),
      // not a canopy standing on posts.
      const height = num(t.height) ?? 4.4;
      if (height > 12) continue;
      const base = Math.max(...ring.map(([x, z]) => ground(x, z)));
      out.structures.canopies.push({ ring: ring.map(([x, z]) => [r2(x), r2(z)]), y: r2(base + height) });
      tally('canopy');
    }
  }

  // ---- car parks: asphalt, painted bays, parked cars
  for (const w of ways) {
    const t = w.tags;
    if (t.amenity !== 'parking' || !w.closed || hidden(t) || (t.parking && t.parking !== 'surface') || t.access === 'no') continue;
    const ring = openRing(w.pts), rect = minAreaRect(ring);
    if (!rect || Math.abs(ringArea(ring)) < 40) continue;
    out.areas.push({ kind: AREA.PARKING, code: 0, ring, clip: true }); tally('car park');
    const { cx, cz, ax, az, a, b } = rect, sx = -az, sz = ax; // long axis (ax, az), short axis (sx, sz)
    const at = (u, v) => [cx + ax * u + sx * v, cz + az * u + sz * v];
    const inside = (p) => inRings(p[0], p[1], [ring]) && !idx.building.has(p[0], p[1]);
    // rows of bays across the short axis: a row against each side, then pairs of rows between aisles
    const rows = [];
    for (let v = -b + 0.3, k = 0; v + 5 <= b - 0.2; k++) { rows.push(v); v += k % 2 === 0 ? 5 + 6 : 5; }
    for (const v of rows) for (let u = -a + 0.4; u + 2.5 <= a - 0.3; u += 2.5) {
      const corners = [at(u, v), at(u + 2.5, v), at(u + 2.5, v + 5), at(u, v + 5)];
      if (!corners.every(inside)) continue;
      // the two long sides of the bay, as paint
      for (const du of [0, 2.5]) out.marks.push({ kind: AREA.MARK_WHITE, ring: [at(u + du - 0.05, v), at(u + du + 0.05, v), at(u + du + 0.05, v + 5), at(u + du - 0.05, v + 5)] });
      const h = hash(Math.round(u * 7 + w.id), Math.round(v * 13), 3);
      if (h < 0.55) {
        const [x, z] = at(u + 1.25, v + 2.5), type = Math.floor(hash(w.id, Math.round(u * 3), Math.round(v)) * 3), color = Math.floor(h * 100) % 4;
        out.props.push({ kind: PROP.PARKED, variant: type + 4 * color, rot: Math.atan2(sx, sz) + (hash(Math.round(u), Math.round(v), w.id) < 0.5 ? 0 : Math.PI), x, z, scale: 1 });
        tally('parked car');
      }
    }
  }

  // ---- barriers, waterways, pools
  for (const w of ways) {
    const t = w.tags;
    if (BARRIER_OF[t.barrier] && !hidden(t)) {
      for (let i = 1; i < w.pts.length; i++) {
        const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
        if (inBounds((ax + bx) / 2, (az + bz) / 2) && Math.hypot(bx - ax, bz - az) > 0.3) out.barriers.push([r2(ax), r2(az), r2(bx), r2(bz), -BARRIER_OF[t.barrier]]);
      }
      tally(t.barrier);
    } else if (WATER_WIDTH[t.waterway] && !hidden(t)) {
      ribbon(w.pts, num(t.width) ?? WATER_WIDTH[t.waterway], quadArea(AREA.WATER, 0)); tally(t.waterway);
    } else if (t.leisure === 'swimming_pool' && w.closed && !hidden(t)) {
      out.areas.push({ kind: AREA.POOL, code: 0, ring: openRing(w.pts) }); tally('pool');
    } else if (t.man_made === 'ceremonial_gate') {
      // a torii spans its way: as wide as the way is long
      const [ax, az] = w.pts[0], [bx, bz] = w.pts.at(-1), len = Math.hypot(bx - ax, bz - az) || 1;
      out.props.push({ kind: PROP.TORII, variant: 0, rot: Math.atan2(-(bz - az) / len, (bx - ax) / len), x: (ax + bx) / 2, z: (az + bz) / 2, scale: Math.min(3.4, Math.max(0.7, len / 5)) });
      tally('torii');
    }
  }

  // ---- small objects
  for (const p of points) {
    const t = p.tags, { x, z } = p;
    if (!inBounds(x, z)) continue;
    const road = roadAt.get(p.id), h = hash(Math.round(x * 10), Math.round(z * 10), 9);
    if (t.emergency === 'fire_hydrant') {
      // in Japan the hydrant is under a cover in the road, edged in yellow; beside the road it is a red sign on a pole
      if (idx.carriageway.has(x, z)) out.marks.push({ kind: AREA.MARK_YELLOW, ring: [[x - 0.45, z - 0.45], [x + 0.45, z - 0.45], [x + 0.45, z + 0.45], [x - 0.45, z + 0.45]] });
      else if (!idx.building.has(x, z)) out.props.push({ kind: PROP.HYDRANT, variant: 0, rot: h * 6.28, x, z, scale: 1 });
      tally('hydrant');
    } else if (t.railway === 'level_crossing' && road) {
      out.props.push({ kind: PROP.RAIL_CROSSING, variant: 0, rot: Math.atan2(road.dx, road.dz), x, z, scale: 1 }); tally('level crossing');
    } else if (t.man_made === 'ceremonial_gate') {
      out.props.push({ kind: PROP.TORII, variant: 0, rot: h * 3.14, x, z, scale: 1 }); tally('torii');
    } else if (idx.building.has(x, z) || idx.carriageway.has(x, z)) {
      continue;
    } else if (t.tourism === 'information') {
      out.props.push({ kind: PROP.INFO, variant: 0, rot: h * 6.28, x, z, scale: 1 }); tally('info board');
    } else if (t.leisure === 'picnic_table') {
      out.props.push({ kind: PROP.TABLE, variant: 0, rot: h * 6.28, x, z, scale: 1 }); tally('picnic table');
    } else if (t.playground) {
      out.props.push({ kind: PROP.PLAY, variant: /swing/.test(t.playground) ? 1 : 0, rot: h * 6.28, x, z, scale: 1 }); tally('playground');
    }
  }
  return out;
}
