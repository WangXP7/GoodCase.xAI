// OpenStreetMap -> drivable road graph + railway lines.
// The graph is split at junctions: every node shared by two or more drivable ways becomes a graph
// node, and the polyline between two graph nodes is an edge.
import fs from 'node:fs';

// Service roads that are not part of the street network.
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const DEFAULT_LANES = {
  motorway: 2, trunk: 2, primary: 2, secondary: 2, tertiary: 1, unclassified: 1,
  residential: 1, living_street: 1, service: 1,
};
const MINOR = new Set(['unclassified', 'residential', 'living_street', 'service']);
// Japanese defaults when maxspeed is untagged (km/h).
const DEFAULT_SPEED = { motorway: 60, trunk: 50, primary: 50, secondary: 40, tertiary: 40 };

const intTag = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

export function readOsm(file) {
  const { elements } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = new Map(), ways = [];
  for (const e of elements) {
    if (e.type === 'node') nodes.set(e.id, [e.lon, e.lat]);
    else if (e.type === 'way') ways.push(e);
  }
  return { nodes, ways };
}

function roadAttrs(t) {
  const hw = t.highway.replace('_link', '');
  const link = t.highway.endsWith('_link');
  const oneway = t.oneway === 'yes' || t.oneway === '1' ? 1 : t.oneway === '-1' ? -1
    : (t.highway === 'motorway' || t.highway === 'motorway_link' || t.junction === 'roundabout') && t.oneway !== 'no' ? 1 : 0;
  // Untagged lanes: per direction for major roads; minor two-way streets are one shared lane.
  let lanes = intTag(t.lanes);
  if (lanes == null) {
    const perDir = link ? 1 : DEFAULT_LANES[hw] ?? 1;
    lanes = oneway ? perDir : MINOR.has(hw) ? 1 : perDir * 2;
  }
  return {
    highway: t.highway, oneway, lanes,
    lanesForward: intTag(t['lanes:forward']), lanesBackward: intTag(t['lanes:backward']),
    maxspeed: intTag(t.maxspeed) ?? DEFAULT_SPEED[hw] ?? 30, maxspeedTagged: intTag(t.maxspeed) != null,
    // lane arrows, left to right in the direction of travel ("left;through|through|right")
    turnLanes: t['turn:lanes'] ?? null, turnLanesForward: t['turn:lanes:forward'] ?? null, turnLanesBackward: t['turn:lanes:backward'] ?? null,
    width: Number.parseFloat(t.width) || null,
    layer: intTag(t.layer) ?? 0,
    bridge: t.bridge && t.bridge !== 'no' ? 1 : 0,
    tunnel: t.tunnel && t.tunnel !== 'no' ? 1 : 0,
    name: t.name ?? null, nameEn: t['name:en'] ?? null, ref: t.ref ?? null,
  };
}

// inBounds(x, z) decides which nodes are kept; edges are cut where they leave the area,
// keeping the first outside point so roads run to the edge of the map.
export function buildRoadGraph({ nodes, ways }, project, inBounds) {
  const drivable = ways.filter((w) => w.tags?.highway && !(w.tags.highway === 'service' && SKIP_SERVICE.has(w.tags.service))
    && w.tags.area !== 'yes' && w.tags.access !== 'no');

  const xz = new Map();
  const pos = (id) => {
    let p = xz.get(id);
    if (!p) { const ll = nodes.get(id); p = ll ? project(ll[0], ll[1]) : null; xz.set(id, p); }
    return p;
  };
  const inside = (id) => { const p = pos(id); return p && inBounds(p[0], p[1]); };

  // Cut each way into runs that stay inside the area (plus one point beyond each end).
  const runs = [];
  for (const w of drivable) {
    const attrs = roadAttrs(w.tags);
    let run = null;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      if (!pos(id)) { run = null; continue; }
      if (inside(id)) {
        if (!run) { run = { attrs, wayId: w.id, ids: [] }; if (i > 0 && pos(w.nodes[i - 1])) run.ids.push(w.nodes[i - 1]); runs.push(run); }
        run.ids.push(id);
      } else if (run) { run.ids.push(id); run = null; }
    }
  }

  // Junctions: nodes used by more than one run, or at run ends.
  const uses = new Map();
  for (const r of runs) r.ids.forEach((id, i) => {
    const end = i === 0 || i === r.ids.length - 1;
    uses.set(id, (uses.get(id) ?? 0) + (end ? 2 : 1));
  });
  const nodeIndex = new Map(), outNodes = [];
  const graphNode = (id) => {
    let k = nodeIndex.get(id);
    if (k === undefined) { k = outNodes.length; nodeIndex.set(id, k); outNodes.push({ id, p: pos(id) }); }
    return k;
  };

  const edges = [];
  for (const r of runs) {
    let start = 0;
    for (let i = 1; i < r.ids.length; i++) {
      if (i < r.ids.length - 1 && uses.get(r.ids[i]) < 2) continue;
      const ids = r.ids.slice(start, i + 1);
      if (ids.length >= 2 && ids[0] !== ids[ids.length - 1])
        edges.push({ a: graphNode(ids[0]), b: graphNode(ids[ids.length - 1]), way: r.wayId, ids, ...r.attrs });
      start = i;
    }
  }
  return { nodes: outNodes, edges, pos };
}

// Returns the visible lines; a line whose first / last node continues underground gets tunnelStart / tunnelEnd.
export function buildRailways({ nodes, ways }, project, inBounds) {
  const out = [], underground = new Set();
  for (const w of ways) {
    const t = w.tags ?? {};
    if (t.railway && !t.highway && t.tunnel && t.tunnel !== 'no') for (const id of w.nodes) underground.add(id);
  }
  for (const w of ways) {
    const t = w.tags ?? {};
    if (!t.railway || t.highway) continue;
    if (t.tunnel && t.tunnel !== 'no') continue; // underground lines are not visible
    const ids = w.nodes.filter((id) => nodes.has(id));
    const pts = ids.map((id) => nodes.get(id)).map(([lon, lat]) => project(lon, lat));
    if (!pts.some(([x, z]) => inBounds(x, z))) continue;
    out.push({
      way: w.id, railway: t.railway, name: t.name ?? null,
      layer: intTag(t.layer) ?? 0, bridge: t.bridge && t.bridge !== 'no' ? 1 : 0,
      tracks: intTag(t.tracks) ?? 1, ids, pts,
      tunnelStart: underground.has(ids[0]), tunnelEnd: underground.has(ids.at(-1)),
    });
  }
  return out;
}
