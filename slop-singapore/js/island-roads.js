// js/island-roads.js
// The island's main roads beyond the detailed city (tiles/<city>/roads.json, tools/city/tiles.mjs) as a queryable road
// set, for the island's traffic (js/island-traffic.js), teleports beyond the detailed city and the maps:
// - roads: [{ cls, name, pts (Float32Array x, z), cum (arc length at each point), len, oneway (1 along the points, -1
//   against, 0 both), lanes, speed (m/s) }]
// - nearest(x, z, r): the closest point on any road within r m: { road, seg, t, s (arc length), x, z, dx, dz (unit
//   direction along the points) } or null
// - snap(x, z, heading, r, keepLeft, { expressways }): a place to arrive on the nearest road: in a lane of its carriageway, facing its
//   traffic (the way nearest the requested heading where it runs both ways): { x, z, heading } or null
// - next(road, dir, list): the roads carrying on from the end `dir` is heading for (1: its last point, -1: its first),
//   as [{ road, dir }] that may be driven that way
// - inCore(x, z): inside the detailed city (whose own road graph and traffic take over)
// - signals: the island's traffic lights [{ x, z, crossing, axis: [dx, dz], offset (s), approaches }], each attached to
//   the roads through it (road.signals: [{ signal, s (arc length along the points), group (0 travelling along its axis,
//   1 across) }], by s); phase(signal, group, time): 'green' | 'amber' | 'red'
// - approaches: a signal's ways in, [{ road, dir, group, x, z, heading (facing the traffic coming) }]
// - junctions: on each road, where traffic may turn off it part way along (road.junctions, by s along its points): a
//   side road ending on it (a T, which the data does not split it at) and the roads crossing it at a traffic light,
//   [{ s, x, z, exits: [{ road, dir, s (where it joins, counted the way it's driven) }] }]; junctionAhead(road, dir, s,
//   range) the next one ahead
// The world frame is the city's: x east, z south (north = -z); a heading h faces (sin h, cos h).

const CELL = 100; // m: the segment index's cells
const LANE = 3.3; // m per travel lane
// m/s by class: expressways at 90 km/h, Singapore's limit, the main roads 50-70 km/h
const SPEED = { motorway: 25, trunk: 19.4, primary: 16.7, secondary: 13.9, tertiary: 11.1 };
const JOIN = 3; // m: road ends this close are joined
const SIGNAL_REACH = 22; // m: a road passing this close to a traffic light goes through its junction
const STOP_BACK = 11; // m: the stop line, back from the junction's centre
// A junction's cycle (s): the roads along its axis green, then amber, all red, the roads across it green, amber, all red;
// a pedestrian crossing's road green for most of it (as js/city-common.js SIGNAL_TIMING for the detailed city)
const CYCLE = { cycle: 60, aGreen: 26, aAmber: 29, aClear: 30, bGreen: 56, bAmber: 59 };
const CROSSING = { cycle: 60, green: 44, amber: 48 };

function signalPhase(signal, group, time) {
  const t = (((time + signal.offset) % 60) + 60) % 60;
  if (signal.crossing) return t < CROSSING.green ? 'green' : t < CROSSING.amber ? 'amber' : 'red';
  const C = CYCLE;
  if (group === 0) return t < C.aGreen ? 'green' : t < C.aAmber ? 'amber' : 'red';
  return t < C.aClear ? 'red' : t < C.bGreen ? 'green' : t < C.bAmber ? 'amber' : 'red';
}

function ringContains(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const zi = ring[i + 1], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ring[i] + ((z - zi) * (ring[j] - ring[i])) / (zj - zi)) inside = !inside;
  }
  return inside;
}

function createIslandRoads(data, { coreRing = null } = {}) {
  const roads = data.roads.map((r, k) => {
    const cls = data.classes[r[0]];
    const n = (r.length - 2) / 2;
    const pts = new Float32Array(n * 2);
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) {
      x += r[2 + i * 2];
      z += r[3 + i * 2];
      pts[i * 2] = x;
      pts[i * 2 + 1] = z;
    }
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    return {
      id: k, cls, name: r[1] >= 0 ? data.names[r[1]] : '', pts, cum, len: cum[n - 1] || 0,
      oneway: data.oneway ? data.oneway[k] : 0, lanes: data.lanes ? data.lanes[k] : 2, speed: SPEED[cls] || 11
    };
  }).filter((r) => r.len > 1);

  // Segments by cell
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const road of roads) {
    const P = road.pts;
    for (let s = 0; s + 1 < P.length / 2; s++) {
      const x0 = Math.min(P[s * 2], P[s * 2 + 2]), x1 = Math.max(P[s * 2], P[s * 2 + 2]);
      const z0 = Math.min(P[s * 2 + 1], P[s * 2 + 3]), z1 = Math.max(P[s * 2 + 1], P[s * 2 + 3]);
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
          const k = key(i, j);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(road, s);
        }
      }
    }
  }

  // Road ends, to carry on from one road to the next
  const ends = new Map();
  const endKey = (x, z) => key(Math.round(x / JOIN), Math.round(z / JOIN));
  const endsNear = (x, z) => {
    const out = [];
    const i0 = Math.round(x / JOIN), j0 = Math.round(z / JOIN);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const e of ends.get(key(i, j)) || []) out.push(e);
    return out;
  };
  for (const road of roads) {
    const P = road.pts, n = P.length / 2;
    for (const [end, x, z] of [[0, P[0], P[1]], [1, P[n * 2 - 2], P[n * 2 - 1]]]) {
      const k = endKey(x, z);
      let list = ends.get(k);
      if (!list) ends.set(k, (list = []));
      list.push({ road, end, x, z });
    }
  }

  const inCore = (x, z) => !!coreRing && ringContains(coreRing, x, z);

  function nearest(x, z, r = 200, filter = null) {
    let best = null, bd = r * r;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const road = list[k], s = list[k + 1];
          if (filter && !filter(road)) continue;
          const P = road.pts;
          const ax = P[s * 2], az = P[s * 2 + 1], bx = P[s * 2 + 2], bz = P[s * 2 + 3];
          const sx = bx - ax, sz = bz - az;
          const L2 = sx * sx + sz * sz;
          if (!L2) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / L2));
          const px = ax + sx * t, pz = az + sz * t;
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bd) {
            bd = d;
            const L = Math.sqrt(L2);
            best = { road, seg: s, t, s: road.cum[s] + L * t, x: px, z: pz, dx: sx / L, dz: sz / L, dist: Math.sqrt(d) };
          }
        }
      }
    }
    return best;
  }

  // The lateral offset (m, to the left of travel) of lane `k` of a road driven one way
  function laneOffset(road, k, keepLeft = true) {
    if (road.oneway) return (k - (road.lanes - 1) / 2) * LANE;
    const perSide = Math.max(1, Math.floor(road.lanes / 2));
    return (Math.min(k, perSide - 1) + 0.5) * LANE * (keepLeft ? 1 : -1);
  }

  // (`expressways`: false keeps walkers and cyclists off the motorways and trunk roads where there's another road)
  function snap(x, z, heading = 0, r = 600, keepLeft = true, { expressways = true } = {}) {
    const street = (road) => road.cls !== 'motorway' && road.cls !== 'trunk';
    const p = (!expressways && nearest(x, z, r, street)) || nearest(x, z, r);
    if (!p || inCore(p.x, p.z)) return null;
    // which way: the road's own one way, else the one nearest the heading asked for
    let dir = p.road.oneway || 1;
    if (!p.road.oneway && p.dx * Math.sin(heading) + p.dz * Math.cos(heading) < 0) dir = -1;
    const dx = p.dx * dir, dz = p.dz * dir;
    // the kerbside lane: left of travel where traffic keeps left (left of (dx, dz) is (dz, -dx))
    const off = laneOffset(p.road, p.road.oneway ? (keepLeft ? p.road.lanes - 1 : 0) : 99, keepLeft);
    return { x: p.x + dz * off, z: p.z - dx * off, heading: Math.atan2(dx, dz), road: p.road, dir };
  }

  // Where each road's ends meet another road part way along it (a T): road.endJoins[end] = [{ road, s }]
  for (const A of roads) {
    const n = A.pts.length / 2;
    for (const end of [0, 1]) {
      const x = end ? A.pts[n * 2 - 2] : A.pts[0], z = end ? A.pts[n * 2 - 1] : A.pts[1];
      for (const p of near(x, z, 3)) {
        if (p.road === A || p.s <= 3 || p.s >= p.road.len - 3) continue;
        ((A.endJoins || (A.endJoins = [[], []]))[end]).push({ road: p.road, s: p.s, x: p.x, z: p.z });
      }
    }
  }

  // Roads carrying on from the end of `road` driven `dir`, their own direction of travel away from it, and where they
  // start: [{ road, dir, turn (cosine of the angle turned: 1 straight on), s (counted the way it's driven) }]
  function next(road, dir) {
    const P = road.pts, n = P.length / 2;
    const [ex, ez] = dir > 0 ? [P[n * 2 - 2], P[n * 2 - 1]] : [P[0], P[1]];
    // the direction arriving
    const [ax, az] = dir > 0 ? [P[n * 2 - 4], P[n * 2 - 3]] : [P[2], P[3]];
    const inL = Math.hypot(ex - ax, ez - az) || 1;
    const ix = (ex - ax) / inL, iz = (ez - az) / inL;
    const out = [];
    for (const e of endsNear(ex, ez)) {
      if (e.road === road || Math.hypot(e.x - ex, e.z - ez) > JOIN * 1.5) continue;
      const d = e.end === 0 ? 1 : -1; // leaving from its first point runs along it
      if (e.road.oneway && e.road.oneway !== d) continue;
      const Q = e.road.pts, m = Q.length / 2;
      const [bx, bz] = d > 0 ? [Q[2], Q[3]] : [Q[m * 2 - 4], Q[m * 2 - 3]];
      const oL = Math.hypot(bx - e.x, bz - e.z) || 1;
      const turn = (ix * (bx - e.x) + iz * (bz - e.z)) / oL;
      if (turn < -0.2) continue; // no U-turns onto the other carriageway
      out.push({ road: e.road, dir: d, turn, s: 0 });
    }
    // ...and the roads it ends on part way along, either way they may be driven from there
    for (const j of road.endJoins?.[dir > 0 ? 1 : 0] || []) {
      for (const d of [1, -1]) {
        if (j.road.oneway && j.road.oneway !== d) continue;
        const at = d > 0 ? j.s : j.road.len - j.s;
        const o = pose(j.road, d, Math.min(j.road.len, at + 1), 0, {});
        const turn = ix * o.dx + iz * o.dz;
        if (turn < -0.2) continue;
        out.push({ road: j.road, dir: d, turn, s: at });
      }
    }
    return out;
  }

  // A point and the travel direction at arc length s along a road driven `dir`, offset `off` m to its left
  function pose(road, dir, s, off, out = {}) {
    const P = road.pts, cum = road.cum, n = P.length / 2;
    const u = dir > 0 ? s : road.len - s; // arc length along the points
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= u) lo = mid; else hi = mid; }
    const L = cum[hi] - cum[lo] || 1;
    const t = Math.max(0, Math.min(1, (u - cum[lo]) / L));
    let dx = (P[hi * 2] - P[lo * 2]) / L, dz = (P[hi * 2 + 1] - P[lo * 2 + 1]) / L;
    if (dir < 0) { dx = -dx; dz = -dz; }
    out.x = P[lo * 2] + (P[hi * 2] - P[lo * 2]) * t + dz * off;
    out.z = P[lo * 2 + 1] + (P[hi * 2 + 1] - P[lo * 2 + 1]) * t - dx * off;
    out.dx = dx;
    out.dz = dz;
    return out;
  }

  // The closest point of every road within r of (x, z): [{ road, s, x, z, dx, dz, dist }]
  function near(x, z, r) {
    const best = new Map();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const road = list[k], sg = list[k + 1];
          const P = road.pts;
          const ax = P[sg * 2], az = P[sg * 2 + 1], sx = P[sg * 2 + 2] - ax, sz = P[sg * 2 + 3] - az;
          const L2 = sx * sx + sz * sz;
          if (!L2) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / L2));
          const px = ax + sx * t, pz = az + sz * t;
          const d = Math.hypot(px - x, pz - z);
          if (d > r) continue;
          const prev = best.get(road);
          if (prev && prev.dist <= d) continue;
          const L = Math.sqrt(L2);
          best.set(road, { road, s: road.cum[sg] + L * t, x: px, z: pz, dx: sx / L, dz: sz / L, dist: d });
        }
      }
    }
    return [...best.values()];
  }

  // Traffic lights onto the roads through them; each junction's axis the widest of its roads (by lanes, then class)
  const RANK = { motorway: 5, trunk: 4, primary: 3, secondary: 2, tertiary: 1 };
  const signals = [];
  const sig = data.signals || [];
  for (let i = 0; i < sig.length; i += 3) {
    const x = sig[i], z = sig[i + 1];
    if (inCore(x, z)) continue;
    const through = near(x, z, SIGNAL_REACH).filter((p) => p.road.cls !== 'motorway');
    if (!through.length) continue;
    through.sort((a, b) => b.road.lanes - a.road.lanes || RANK[b.road.cls] - RANK[a.road.cls] || a.dist - b.dist);
    const axis = [through[0].dx, through[0].dz];
    // a junction's own offset in the cycle, so neighbouring ones aren't all in step
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    const signal = { x, z, crossing: sig[i + 2] === 1, axis, offset: (h - Math.floor(h)) * 60, approaches: [] };
    for (const p of through) {
      const group = Math.abs(p.dx * axis[0] + p.dz * axis[1]) >= Math.SQRT1_2 ? 0 : 1;
      (p.road.signals || (p.road.signals = [])).push({ signal, s: p.s, group });
      // its ways in: from each end the road may be driven towards the junction, if there's room for a stop line
      for (const dir of [1, -1]) {
        if (p.road.oneway && p.road.oneway !== dir) continue;
        const sIn = dir > 0 ? p.s - STOP_BACK : p.s + STOP_BACK;
        if (sIn < 0 || sIn > p.road.len) continue;
        signal.approaches.push({ road: p.road, dir, group, s: sIn });
      }
    }
    signals.push(signal);
  }
  for (const road of roads) if (road.signals) road.signals.sort((a, b) => a.s - b.s);

  // Junctions part way along the roads, to turn off at: the T's (a side road's end on a road), each way the side road
  // may be driven away from it; and the crossings at the traffic lights (where two roads through one cross)
  const addExit = (road, s, x, z, exit) => {
    const list = road.junctions || (road.junctions = []);
    let J = list.find((j) => Math.abs(j.s - s) < 6);
    if (!J) list.push((J = { s, x, z, exits: [] }));
    if (!J.exits.some((e) => e.road === exit.road && e.dir === exit.dir)) J.exits.push(exit);
  };
  for (const A of roads) {
    if (!A.endJoins) continue;
    for (const end of [0, 1]) {
      const away = end === 0 ? 1 : -1; // leaving the junction from this end runs along its points or against them
      if (A.oneway && A.oneway !== away) continue;
      for (const j of A.endJoins[end]) addExit(j.road, j.s, j.x, j.z, { road: A, dir: away, s: 0 });
    }
  }
  // the point where two roads' lines cross within r of (x, z): [sA, sB] along their points, or null
  const crossing = (A, B, x, z, r) => {
    const segs = (R) => {
      const out = [];
      const P = R.pts;
      for (let i = 0; i + 1 < P.length / 2; i++) {
        const mx = (P[i * 2] + P[i * 2 + 2]) / 2, mz = (P[i * 2 + 1] + P[i * 2 + 3]) / 2;
        const half = Math.hypot(P[i * 2 + 2] - P[i * 2], P[i * 2 + 3] - P[i * 2 + 1]) / 2;
        if (Math.hypot(mx - x, mz - z) <= r + half) out.push(i);
      }
      return out;
    };
    const PA = A.pts, PB = B.pts;
    for (const i of segs(A)) {
      const ax = PA[i * 2], az = PA[i * 2 + 1], ux = PA[i * 2 + 2] - ax, uz = PA[i * 2 + 3] - az;
      for (const k of segs(B)) {
        const bx = PB[k * 2], bz = PB[k * 2 + 1], vx = PB[k * 2 + 2] - bx, vz = PB[k * 2 + 3] - bz;
        const den = ux * vz - uz * vx;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((bx - ax) * vz - (bz - az) * vx) / den;
        const u = ((bx - ax) * uz - (bz - az) * ux) / den;
        if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
        return [A.cum[i] + (A.cum[i + 1] - A.cum[i]) * Math.max(0, Math.min(1, t)), B.cum[k] + (B.cum[k + 1] - B.cum[k]) * Math.max(0, Math.min(1, u))];
      }
    }
    return null;
  };
  for (const signal of signals) {
    if (signal.crossing) continue;
    const through = [...new Set(signal.approaches.map((a) => a.road))];
    for (const A of through) {
      for (const B of through) {
        if (A === B) continue;
        const at = crossing(A, B, signal.x, signal.z, 30);
        if (!at) continue;
        const [sA, sB] = at;
        for (const d of [1, -1]) {
          if (B.oneway && B.oneway !== d) continue;
          const sDriven = d > 0 ? sB : B.len - sB;
          if (sDriven > B.len - 5) continue; // (no road left that way)
          addExit(A, sA, signal.x, signal.z, { road: B, dir: d, s: sDriven });
        }
      }
    }
  }
  for (const road of roads) if (road.junctions) road.junctions.sort((a, b) => a.s - b.s);

  // The next junction ahead of s on `road` driven `dir` (both counted the way it's driven), within `range` m:
  // { junction, d (m to it), at (its s the way it's driven) } or null
  function junctionAhead(road, dir, s, range = 50) {
    if (!road.junctions) return null;
    let best = null;
    for (const J of road.junctions) {
      const at = dir > 0 ? J.s : road.len - J.s;
      const d = at - s;
      if (d <= 0 || d > range) continue;
      if (!best || d < best.d) best = { junction: J, d, at };
    }
    return best;
  }

  // The next traffic light ahead of arc length s on `road` driven `dir` (s counted the way it's driven), within `range`
  // m: { signal, group, d (m to its stop line) } or null; lights whose stop line is already behind are passed
  function signalAhead(road, dir, s, range = 90) {
    if (!road.signals) return null;
    let best = null;
    for (const g of road.signals) {
      const at = dir > 0 ? g.s : road.len - g.s;
      const d = at - STOP_BACK - s;
      if (d < 0.5 || d > range) continue;
      if (!best || d < best.d) best = { signal: g.signal, group: g.group, d };
    }
    return best;
  }

  return { roads, data, nearest, near, snap, next, pose, laneOffset, inCore, signals, signalAhead, junctionAhead, phase: signalPhase, LANE, STOP_BACK };
}

// roads.json, fetched once and shared
let loading = null;
function loadIslandRoads(url, options) {
  if (!loading) {
    loading = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then((data) => createIslandRoads(data, options));
  }
  return loading;
}

export { createIslandRoads, loadIslandRoads, signalPhase, SPEED, STOP_BACK };
