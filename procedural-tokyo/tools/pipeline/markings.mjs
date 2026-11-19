// Road paint and traffic signals. Lane lines are laid out from the *measured* carriageway: at each
// sample the distance to the kerb on both sides (PLATEAU carriageway polygons) gives the true centre
// and width, so paint does not inherit the offset of the OSM centreline.
import { AREA, PROP, DECAL } from '../../src/shared/tileformat.js';
import { hash, forEachAlong } from './landscape.mjs';

const STEP = 2.5;          // sample spacing along a road (m); dashes are 2 samples on, 2 off (5 m / 5 m)
const LINE = 0.15;         // paint width (m)
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

// OSM turn value -> arrow. Unknown values (merge lanes and the like) get no arrow.
const TURN = {
  '': DECAL.THROUGH, none: DECAL.THROUGH, through: DECAL.THROUGH, left: DECAL.LEFT, right: DECAL.RIGHT,
  slight_left: DECAL.LEFT, slight_right: DECAL.RIGHT,
  'left;through': DECAL.THROUGH_LEFT, 'through;left': DECAL.THROUGH_LEFT, through_left: DECAL.THROUGH_LEFT,
  'through;right': DECAL.THROUGH_RIGHT, 'right;through': DECAL.THROUGH_RIGHT, through_right: DECAL.THROUGH_RIGHT,
};
// Untagged approaches, by lane count: the usual Japanese layout.
const defaultTurns = (n) => (n === 2 ? [DECAL.THROUGH_LEFT, DECAL.THROUGH_RIGHT]
  : [DECAL.THROUGH_LEFT, ...Array(n - 2).fill(DECAL.THROUGH), DECAL.RIGHT]);
const SPEED = { 20: DECAL.SPEED_20, 30: DECAL.SPEED_30, 40: DECAL.SPEED_40, 50: DECAL.SPEED_50, 60: DECAL.SPEED_60 };

export function buildMarkings({ edges, pos, idx, land, inBounds }) {
  const marks = [], props = [];
  const signalled = new Set(land.signals);
  // A symbol painted on the road at (x, z), read by traffic heading along (dx, dz).
  const decal = (variant, x, z, dx, dz) => {
    if (inBounds(x, z) && idx.carriageway.has(x, z)) props.push({ kind: PROP.DECAL, variant, rot: Math.atan2(dx, dz), x, z, scale: 1 });
  };
  const quad = (kind, a, b, c, d) => marks.push({ kind, ring: [a, b, c, d] });
  const reach = (x, z, nx, nz, side, max = 18) => {
    for (let d = 0.5; d <= max; d += 0.25) if (!idx.carriageway.has(x + nx * d * side, z + nz * d * side)) return d;
    return null;
  };

  // junctions: graph nodes where three or more edge ends meet
  const degree = new Map(), at = new Map(); // node id -> count; node id -> [{ e, i }]
  for (const e of edges) {
    for (const id of [e.ids[0], e.ids.at(-1)]) degree.set(id, (degree.get(id) ?? 0) + 1);
    e.ids.forEach((id, i) => { if (!at.has(id)) at.set(id, []); at.get(id).push({ e, i }); });
  }
  const junctions = [...degree].filter(([, n]) => n >= 3).map(([id]) => pos(id));
  const nearestJunction = (x, z, max) => {
    let best = null, bd = max;
    for (const j of junctions) { const d = Math.hypot(j[0] - x, j[1] - z); if (d < bd) { bd = d; best = j; } }
    return best;
  };

  // ---- lane lines
  const spoken = new Set(); // road + direction that already carries its speed number
  for (const e of edges) {
    const hw = e.highway.replace('_link', '');
    if ((e.bridge && !e.span) || e.tunnel || hw === 'motorway' || e.highway.endsWith('_link')) continue;
    if (!MAJOR.has(hw) && e.lanes < 2) continue;
    const pts = e.ids.map(pos);
    // Where the carriageway is far wider than the road needs (a bus terminal, a station forecourt, one
    // polygon for two carriageways) or has no measurable edge, the road is painted at its nominal width
    // along the OSM line, with edge lines, so it still reads as a road across open asphalt.
    const nominal = Math.max(1, e.lanes) * 3.0 + 0.8;
    const samples = [];
    let open = 0;
    forEachAlong(pts, STEP, (x, z, dx, dz, n) => {
      const nx = -dz, nz = dx; // right of travel
      let s = null;
      if (idx.carriageway.has(x, z)) {
        const R = reach(x, z, nx, nz, 1), L = reach(x, z, nx, nz, -1);
        if (R != null && L != null && R + L <= nominal * 1.6 + 3) s = { x: x + nx * (R - L) / 2, z: z + nz * (R - L) / 2, nx, nz, w: R + L, n };
        // (not inside a junction: within reach of a junction node the open asphalt is the crossing itself)
        else if (!nearestJunction(x, z, 16 + Math.max(1, e.lanes) * 2)) { s = { x, z, nx, nz, w: nominal, n, open: true }; open++; }
      }
      samples.push(s);
    }, STEP / 2);
    const widths = samples.filter(Boolean).map((s) => s.w).sort((a, b) => a - b);
    if (widths.length < 4) continue;
    const median = widths[widths.length >> 1];
    // keep the regular stretch of road: junctions and bays show up as jumps in width
    const ok = samples.map((s) => s && s.w > median * 0.8 && s.w < median * 1.25);
    let lanes = Math.min(e.lanes, Math.floor(median / 2.6));
    if (lanes < 2 && !(MAJOR.has(hw) && median > 5) && open < 4) continue;
    lanes = Math.max(lanes, 1);
    const lw = median / lanes;
    const lines = []; // { o: lateral offset, kind, dashed }
    if (!e.oneway && lanes >= 2) {
      const yellow = lanes === 2 && hash(e.way, 21) < 0.35;
      lines.push({ o: 0, kind: yellow ? AREA.MARK_YELLOW : AREA.MARK_WHITE, dashed: lanes === 2 && !yellow });
    }
    for (let k = 1; k < lanes; k++) {
      const o = -median / 2 + k * lw;
      if (!e.oneway && Math.abs(o) < 0.4) continue; // the centre line is already there
      lines.push({ o, kind: AREA.MARK_WHITE, dashed: true });
    }
    if (hw !== 'tertiary' && median > 6) for (const s of [-1, 1]) lines.push({ o: s * (median / 2 - 0.35), kind: AREA.MARK_WHITE, dashed: false });
    // edge lines for stretches across open asphalt, whatever the road class
    const openEdges = [-1, 1].map((s) => ({ o: s * (nominal / 2 - 0.2), kind: AREA.MARK_WHITE, dashed: false }));
    for (let i = 0; i + 1 < samples.length; i++) {
      if (!ok[i] || !ok[i + 1]) continue;
      const a = samples[i], b = samples[i + 1];
      for (const l of a.open && b.open && lines.every((o) => Math.abs(o.o) < nominal / 2 - 0.5) ? [...lines, ...openEdges] : lines) {
        if (l.dashed && Math.floor(a.n / 2) % 2) continue;
        const p = (s, o) => [s.x + s.nx * o, s.z + s.nz * o];
        quad(l.kind, p(a, l.o - LINE / 2), p(b, l.o - LINE / 2), p(b, l.o + LINE / 2), p(a, l.o + LINE / 2));
      }
    }

    // Symbols in the lanes. Lanes of one direction fill the road from the left kerb (left-hand traffic);
    // `fwd` is travel along the edge, otherwise against it.
    const lanesDir = e.oneway ? lanes : Math.floor(lanes / 2);
    for (const fwd of [true, false]) {
      if (fwd ? e.oneway === -1 : e.oneway === 1) continue;
      if (lanesDir < 1) continue;
      const sign = fwd ? 1 : -1;
      // lane j (0 = leftmost) centre, at sample i
      const lane = (i, j) => {
        const s = samples[i], o = -median / 2 + (j + 0.5) * lw;
        return [s.x + s.nx * sign * o, s.z + s.nz * sign * o, s.nz * sign, -s.nx * sign]; // x, z, travel dx, dz
      };
      // arrows before a junction
      const end = fwd ? e.ids.at(-1) : e.ids[0];
      if (lanesDir >= 2 && (degree.get(end) ?? 0) >= 3) {
        const tagged = (e.oneway ? e.turnLanes : fwd ? e.turnLanesForward : e.turnLanesBackward)?.split('|').map((t) => TURN[t.trim()]);
        const turns = tagged?.length === lanesDir ? tagged : defaultTurns(lanesDir);
        for (const back of [26, 56]) {
          if (back > 30 && samples.length * STEP < 110) continue;
          const i = fwd ? samples.length - 1 - Math.round(back / STEP) : Math.round(back / STEP);
          if (i < 1 || i >= samples.length - 1 || !ok[i]) continue;
          turns.forEach((turn, j) => { if (turn != null) decal(turn, ...lane(i, j)); });
        }
      }
      // the speed limit, once per road and direction, in the left lane
      const speed = e.maxspeedTagged && SPEED[e.maxspeed], key = e.way + (fwd ? 'f' : 'b');
      if (speed != null && !spoken.has(key) && samples.length * STEP > 70) {
        const i = samples.length >> 1;
        if (ok[i]) { spoken.add(key); decal(speed, ...lane(i, 0)); }
      }
    }
  }

  // ---- 止まれ where a side street meets a main road without signals
  const pointBack = (pts, fromEnd, dist) => { // point `dist` metres before one end of a polyline, with the travel direction
    const p = fromEnd ? [...pts].reverse() : pts;
    let left = dist;
    for (let i = 1; i < p.length; i++) {
      const len = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (len >= left && len > 1e-6) {
        const t = left / len;
        return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, (p[i - 1][0] - p[i][0]) / len, (p[i - 1][1] - p[i][1]) / len];
      }
      left -= len;
    }
    return null;
  };
  // The stops to paint: [edge, at its end?, distance of the stop line from that end]. OSM maps stop signs as
  // nodes on the road (highway=stop); without any, guess: side streets meeting a main road without signals.
  const stops = [];
  for (const id of land.stops ?? []) for (const { e, i } of at.get(id) ?? []) {
    if (e.bridge || e.tunnel) continue;
    const pts = e.ids.map(pos);
    let before = 0, total = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); total += d; if (k <= i) before += d; }
    // the sign faces whoever is driving to the nearer end of the road
    const atEnd = total - before <= before ? e.oneway !== -1 : e.oneway === 1;
    stops.push([e, atEnd, atEnd ? total - before : before]);
  }
  const SIDE = new Set(['residential', 'unclassified', 'living_street']);
  if (!stops.length) for (const e of edges) {
    if (!SIDE.has(e.highway) || e.bridge || e.tunnel) continue;
    for (const atEnd of [true, false]) {
      if (atEnd ? e.oneway === -1 : e.oneway === 1) continue; // nobody arrives at this end
      const id = atEnd ? e.ids.at(-1) : e.ids[0];
      if ((degree.get(id) ?? 0) < 3 || signalled.has(id)) continue;
      if ((at.get(id) ?? []).some((o) => o.e !== e && MAJOR.has(o.e.highway.replace('_link', '')))) stops.push([e, atEnd, 6.5]);
    }
  }
  for (const [e, atEnd, back] of stops) {
    const pts = e.ids.map(pos);
    {
      const text = pointBack(pts, atEnd, back + 4.5), line = pointBack(pts, atEnd, Math.max(0.5, back));
      if (!text || !line) continue;
      for (const [x, z, dx, dz, isLine] of [[...text, false], [...line, true]]) {
        const nx = -dz, nz = dx; // right of travel
        if (!idx.carriageway.has(x, z)) continue;
        const R = reach(x, z, nx, nz, 1, 8), L = reach(x, z, nx, nz, -1, 8);
        if (R == null || L == null) continue;
        const w = R + L, cx = x + nx * (R - L) / 2, cz = z + nz * (R - L) / 2;
        // narrow or one-way streets use the whole width, wider ones the left half
        const whole = e.oneway || w < 5.4, off = whole ? 0 : -w / 4, half = (whole ? w / 2 : w / 4) - 0.25;
        const px = cx + nx * off, pz = cz + nz * off;
        if (isLine) quad(AREA.MARK_WHITE, [px - nx * half - dx * 0.2, pz - nz * half - dz * 0.2], [px + nx * half - dx * 0.2, pz + nz * half - dz * 0.2],
          [px + nx * half + dx * 0.2, pz + nz * half + dz * 0.2], [px - nx * half + dx * 0.2, pz - nz * half + dz * 0.2]);
        else if (half * 2 > 1.7) decal(DECAL.STOP, px, pz, dx, dz);
      }
    }
  }

  // ---- zebra crossings (Japanese style: bars parallel to the traffic) and stop lines
  const zebraAt = [];
  const zebra = (path) => {
    // A crossing runs from kerb to kerb. A path whose ends both lie out in the carriageway (inside a bus
    // terminal, a car park) would leave a few stripes floating in the asphalt: skip it.
    // (looking 3 and 6 m past each end: crossing paths often stop a little short of the kerb)
    const beyond = (p, q) => { const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [3, 6].every((d) => idx.carriageway.has(p[0] + ((p[0] - q[0]) / l) * d, p[1] + ((p[1] - q[1]) / l) * d)); };
    if (path.length < 2 || (beyond(path[0], path[1]) && beyond(path.at(-1), path.at(-2)))) return;
    // the stripes on the carriageway, as unbroken runs; a run shorter than a lane is a stray fragment
    const runs = [[]];
    forEachAlong(path, 0.9, (x, z, dx, dz) => {
      if (inBounds(x, z) && idx.carriageway.has(x, z)) runs.at(-1).push([x, z, dx, dz]);
      else if (runs.at(-1).length) runs.push([]);
    }, 0.45);
    const run = runs.reduce((a, b) => (b.length > a.length ? b : a));
    if (run.length < 5) return;
    for (const [x, z, dx, dz] of runs.filter((r) => r.length >= 5).flat()) {
      const rx = -dz, rz = dx; // road direction: across the crossing path
      quad(AREA.MARK_WHITE, [x - dx * 0.225 - rx * 1.8, z - dz * 0.225 - rz * 1.8], [x + dx * 0.225 - rx * 1.8, z + dz * 0.225 - rz * 1.8],
        [x + dx * 0.225 + rx * 1.8, z + dz * 0.225 + rz * 1.8], [x - dx * 0.225 + rx * 1.8, z - dz * 0.225 + rz * 1.8]);
    }
    const [ax, az] = run[0], [bx, bz, dx, dz] = run.at(-1);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, half = Math.hypot(bx - ax, bz - az) / 2 + 0.45;
    zebraAt.push([cx, cz]);
    // tactile paving (the yellow studded blocks) on the sidewalk at both ends of the crossing
    for (const [ex, ez, s] of [[ax, az, -1], [bx, bz, 1]]) {
      const tx = ex + dx * s * 1.15, tz = ez + dz * s * 1.15, px = -dz, pz = dx;
      if (idx.carriageway.has(tx, tz) || idx.building.has(tx, tz)) continue;
      marks.push({ kind: AREA.TACTILE, ring: [[tx - dx * 0.3 - px * 1.5, tz - dz * 0.3 - pz * 1.5], [tx + dx * 0.3 - px * 1.5, tz + dz * 0.3 - pz * 1.5],
        [tx + dx * 0.3 + px * 1.5, tz + dz * 0.3 + pz * 1.5], [tx - dx * 0.3 + px * 1.5, tz - dz * 0.3 + pz * 1.5]] });
    }
    // Stop lines: 2.5 m before the bars, across the left half of the road (left-hand traffic),
    // only on the side facing away from the junction.
    const rx = -dz, rz = dx, j = nearestJunction(cx, cz, 35);
    for (const s of [-1, 1]) {
      const px = cx + rx * 4.4 * s, pz = cz + rz * 4.4 * s;
      if (j && Math.hypot(px - j[0], pz - j[1]) < Math.hypot(cx - j[0], cz - j[1])) continue;
      // traffic here drives towards the crossing along -s * r; its left-hand side is -s * (dx, dz)
      const lx = -dx * s, lz = -dz * s;
      if (!idx.carriageway.has(px + lx * half * 0.5, pz + lz * half * 0.5)) continue;
      quad(AREA.MARK_WHITE, [px - rx * 0.225, pz - rz * 0.225], [px + rx * 0.225, pz + rz * 0.225],
        [px + rx * 0.225 + lx * (half - 0.3), pz + rz * 0.225 + lz * (half - 0.3)], [px - rx * 0.225 + lx * (half - 0.3), pz - rz * 0.225 + lz * (half - 0.3)]);
    }
  };
  for (const path of land.crossings) zebra(path);
  // crossings mapped only as a node on the road: build the path across the carriageway
  for (const c of land.crossingNodes) {
    const hit = at.get(c.id)?.[0];
    if (!hit || hit.e.bridge || hit.e.tunnel) continue;
    const [x, z] = pos(c.id);
    if (zebraAt.some(([zx, zz]) => Math.hypot(zx - x, zz - z) < 9) || !idx.carriageway.has(x, z)) continue;
    const ids = hit.e.ids, p = pos(ids[Math.max(0, hit.i - 1)]), q = pos(ids[Math.min(ids.length - 1, hit.i + 1)]);
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len;
    const R = reach(x, z, nx, nz, 1), L = reach(x, z, nx, nz, -1);
    if (R != null && L != null) zebra([[x - nx * (L + 0.5), z - nz * (L + 0.5)], [x + nx * (R + 0.5), z + nz * (R + 0.5)]]);
  }

  // ---- traffic signals: one mast per approach, at the left kerb a few metres before the junction
  const taken = new Set();
  for (const id of land.signals) {
    for (const { e, i } of at.get(id) ?? []) {
      if (e.tunnel || e.bridge || e.highway.startsWith('motorway')) continue;
      const here = pos(id);
      for (const [j, allowed] of [[i - 1, e.oneway !== -1], [i + 1, e.oneway !== 1]]) {
        if (!allowed || j < 0 || j >= e.ids.length) continue;
        const from = pos(e.ids[j]), len = Math.hypot(here[0] - from[0], here[1] - from[1]);
        if (len < 1) continue;
        const dx = (here[0] - from[0]) / len, dz = (here[1] - from[1]) / len, nx = -dz, nz = dx;
        const back = Math.min(8, len * 0.8), qx = here[0] - dx * back, qz = here[1] - dz * back;
        if (!idx.carriageway.has(qx, qz)) continue;
        const L = reach(qx, qz, nx, nz, -1);
        if (L == null) continue;
        const x = qx - nx * (L + 0.4), z = qz - nz * (L + 0.4), key = Math.floor(x / 6) + ',' + Math.floor(z / 6);
        if (!inBounds(x, z) || idx.building.has(x, z) || taken.has(key)) continue;
        taken.add(key);
        // faces the approaching traffic; the arm length (scale) reaches towards the middle of the road
        props.push({ kind: PROP.SIGNAL, variant: 0, rot: Math.atan2(-dx, -dz), x, z, scale: Math.min(1.6, Math.max(0.7, L / 4)) });
      }
    }
  }
  return { marks, props };
}
