import { makeCurve, curvePoint } from './lane-curves.js';

// js/island-network.js
// The island's main roads (js/island-roads.js) as a road graph shaped like the detailed city's (js/road-network.js), so
// the route planner and the autopilots (js/navigation.js) drive them the same way, and the two joined into one where the
// island's roads meet the detailed city at its edge.
//
// Each road becomes, for each way it may be driven, a run of straight directed edges (one per stretch between its
// points, split at the stop lines of its traffic lights), with the lanes of its carriageway as offsets to the right of
// the line (road-network.js's convention, kept to the side traffic keeps to), its speed limit, its name, and moves on
// to the next stretch and, at its end, to the roads carrying on (island-roads.js next()). Each stretch is shortened at a
// bend so the lane-to-lane curves (road-network.js makeCurve) round it. A stretch ending at a stop line carries the
// light's phase (edge.phaseAt(time)).
//
// Joined to the city: an island road ending at (or starting from) the detailed city's edge hands over to the city edge
// starting (or ending) nearest it going the same way. Those moves out of city edges are kept apart (extraMoves), so the
// city's own traffic (traffic.js), which drives its edges' moves, never leaves its graph.
//
// Conventions as road-network.js: north = -z, east = +x, an edge's direction (dx, dz) and right normal (rx, rz).

const MIN_STRETCH = 2; // m: closer points are merged
const CORNER_R = 12; // m: the radius a bend's curve is shaped for
const HANDOVER = 60; // m: how far an island road's end and a city edge may be apart to join
const NEAR_CORE = 45; // m: how close to the city's edge an island road end must be to hand over there
const BRIDGE = 15; // m: a dead end (or a road nothing leads into) is joined to the nearest road this close
const REACH = 40; // m: or, failing that, to a road going on the same way this far off (the data's missing slip roads)

function createIslandNetwork(roads, { keepLeft = true, city = null, coreRing = null } = {}) {
  const edges = [];
  const firstEdge = new Map(); // road -> dir -> its first edge that way
  const lastEdge = new Map();
  const set = (map, road, dir, e) => {
    if (!map.has(road)) map.set(road, new Map());
    map.get(road).set(dir, e);
  };
  const get = (map, road, dir) => map.get(road)?.get(dir) || null;
  let uid = 0;

  // Where a road ends on another road part way along it (a side road at a T, which the data does not split the main road
  // at): joins to split that road at, with the roads ending there
  const joins = [];
  const joinsOf = new Map(); // road -> its joins
  for (const A of roads.roads) {
    const n = A.pts.length / 2;
    for (const end of [0, 1]) {
      const x = end ? A.pts[n * 2 - 2] : A.pts[0];
      const z = end ? A.pts[n * 2 - 1] : A.pts[1];
      for (const p of roads.near(x, z, 3)) {
        if (p.road === A || p.s <= 3 || p.s >= p.road.len - 3) continue;
        const list = joinsOf.get(p.road) || [];
        let J = list.find((q) => Math.abs(q.s - p.s) < 2);
        if (!J) {
          J = { road: p.road, s: p.s, x: p.x, z: p.z, ends: [], in: [], out: [] };
          list.push(J);
          joinsOf.set(p.road, list);
          joins.push(J);
        }
        J.ends.push({ road: A, end });
      }
    }
  }

  // The lanes of `road` driven one way, as offsets to the right of its line (ascending). A one-way carriageway's lanes
  // run from the one half a lane to the kerb side of its line outwards (the lanes a road gains at a junction are added on
  // the far side, as they are), so a carriageway changing its count of lanes from one stretch to the next keeps its
  // kerbside lanes where they were instead of jogging half a lane
  function lanesOf(road) {
    const out = [];
    if (road.oneway) {
      const kerb = keepLeft ? -1 : 1;
      for (let k = 0; k < road.lanes; k++) out.push(kerb * (roads.LANE / 2) - kerb * k * roads.LANE);
    } else {
      const perSide = Math.max(1, Math.floor(road.lanes / 2));
      for (let k = 0; k < perSide; k++) out.push(-roads.laneOffset(road, k, keepLeft));
    }
    return out.sort((a, b) => a - b);
  }

  // 1. Stretches, way by way
  for (const road of roads.roads) {
    const dirs = road.oneway ? [road.oneway] : [1, -1];
    const n = road.pts.length / 2;
    for (const dir of dirs) {
      // its points in the order driven, with travel arc length u
      const pts = [];
      for (let k = 0; k < n; k++) {
        const i = dir > 0 ? k : n - 1 - k;
        pts.push({ x: road.pts[i * 2], z: road.pts[i * 2 + 1], u: dir > 0 ? road.cum[i] : road.len - road.cum[i], stop: null });
      }
      // its stop lines
      for (const g of road.signals || []) {
        const at = (dir > 0 ? g.s : road.len - g.s) - roads.STOP_BACK;
        if (at <= 1 || at >= road.len - 1) continue;
        let k = 1;
        while (k < pts.length && pts[k].u < at) k++;
        const a = pts[k - 1];
        const b = pts[k];
        const t = (at - a.u) / (b.u - a.u || 1);
        pts.splice(k, 0, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, u: at, stop: g });
      }
      // its joins with the roads ending on it
      for (const J of joinsOf.get(road) || []) {
        const at = dir > 0 ? J.s : road.len - J.s;
        let k = 1;
        while (k < pts.length && pts[k].u < at) k++;
        if (k >= pts.length) continue;
        const a = pts[k - 1];
        const b = pts[k];
        const t = (at - a.u) / (b.u - a.u || 1);
        pts.splice(k, 0, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, u: at, stop: null, join: J });
      }
      // merged where too close (keeping the ends, the stop lines and the joins)
      const keep = [pts[0]];
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k];
        const last = keep[keep.length - 1];
        if (k < pts.length - 1 && !p.stop && !p.join && p.u - last.u < MIN_STRETCH) continue;
        if (p.u - last.u < 0.2) {
          if (p.stop) last.stop = p.stop;
          if (p.join) last.join = p.join;
          continue;
        }
        keep.push(p);
      }
      if (keep.length < 2) continue;
      const lanes = lanesOf(road);
      let prev = null;
      for (let k = 0; k + 1 < keep.length; k++) {
        const a = keep[k];
        const b = keep[k + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const dx = (b.x - a.x) / L;
        const dz = (b.z - a.z) / L;
        const stop = b.stop;
        const e = {
          uid: uid++, island: true, road, dir, x0: a.x, z0: a.z, x1: b.x, z1: b.z, raw: L,
          dx, dz, rx: -dz, rz: dx, sx: a.x, sz: a.z, len: L, trimStart: 0, trimEnd: 0,
          lanes, moves: [], axisIndex: 0, speedLimit: road.speed, navName: road.name || '',
          costFactor: Math.sqrt(25 / Math.max(5, road.speed)),
          from: prev ? prev.to : { signal: false }, to: { signal: Boolean(stop) }
        };
        if (stop) {
          e.stop = stop;
          e.phaseAt = (time) => roads.phase(stop.signal, stop.group, time);
        }
        if (b.join && k + 1 < keep.length - 1) b.join.in.push(e);
        if (a.join && k > 0) a.join.out.push(e);
        edges.push(e);
        if (prev) prev.moves.push(moveTo(prev, e));
        else set(firstEdge, road, dir, e);
        prev = e;
      }
      set(lastEdge, road, dir, prev);
    }
  }

  function moveTo(e, f, extra = {}) {
    const cross = e.dx * f.dz - e.dz * f.dx;
    const out = e.lanes.map((o) => {
      // the lane of f nearest the same offset (or the same place in the road, when the counts differ)
      let best = 0;
      for (let j = 1; j < f.lanes.length; j++) if (Math.abs(f.lanes[j] - o) < Math.abs(f.lanes[best] - o)) best = j;
      return best;
    });
    return { to: f, turn: cross < -0.5 ? 'L' : cross > 0.5 ? 'R' : 'S', cross, uturn: false, out, ...extra };
  }

  // 2. Road to road, where they meet
  for (const [road, byDir] of lastEdge) {
    for (const [dir, e] of byDir) {
      for (const nx of roads.next(road, dir)) {
        const f = get(firstEdge, nx.road, nx.dir);
        if (f) e.moves.push(moveTo(e, f));
      }
    }
  }

  // 2b. At the joins: from the road ending there onto the other road either way, and from it into a road starting there
  const ahead = (a, b) => a.dx * b.dx + a.dz * b.dz > -0.2; // (no U-turns)
  for (const J of joins) {
    for (const { road: A, end } of J.ends) {
      for (const dir of A.oneway ? [A.oneway] : [1, -1]) {
        const arriving = (end === 1) === (dir > 0);
        if (arriving) {
          const a = get(lastEdge, A, dir);
          if (a) for (const o of J.out) if (ahead(a, o) && !a.moves.some((m) => m.to === o)) a.moves.push(moveTo(a, o));
        } else {
          const f = get(firstEdge, A, dir);
          if (f) for (const i of J.in) if (ahead(i, f) && !i.moves.some((m) => m.to === f)) i.moves.push(moveTo(i, f));
        }
      }
    }
  }

  // 2c. Loose ends, where the data leaves a road with no way on (or no way in): joined to the nearest road within BRIDGE
  //     m, going on ahead if one does, else turning back (a U-turn at a cul-de-sac or onto the other carriageway)
  bridgeLooseEnds(edges, moveTo);

  // 3. Handing over to the city where the island's roads meet it
  const extraMoves = new Map();
  if (city) {
    const ring = coreRing;
    const toCore = (x, z) => (roads.inCore(x, z) ? 0 : ring ? ringDistance(ring, x, z) : Infinity);
    const cityStarts = city.edges.map((c) => ({ c, x: c.sx, z: c.sz }));
    const cityEnds = city.edges.map((c) => ({ c, x: c.sx + c.dx * c.len, z: c.sz + c.dz * c.len }));
    const bestCity = (list, x, z, dx, dz) => {
      let best = null;
      for (const q of list) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d > HANDOVER) continue;
        const dot = q.c.dx * dx + q.c.dz * dz;
        if (dot < 0.6) continue;
        const score = d + (1 - dot) * 40;
        if (!best || score < best.score) best = { c: q.c, score };
      }
      return best && best.c;
    };
    for (const [, byDir] of lastEdge) {
      for (const [, e] of byDir) {
        if (toCore(e.x1, e.z1) > NEAR_CORE) continue;
        const c = bestCity(cityStarts, e.x1, e.z1, e.dx, e.dz);
        if (c) e.moves.push(moveTo(e, c, { handover: true }));
      }
    }
    for (const [, byDir] of firstEdge) {
      for (const [, f] of byDir) {
        if (toCore(f.x0, f.z0) > NEAR_CORE) continue;
        const c = bestCity(cityEnds, f.x0, f.z0, f.dx, f.dz);
        if (!c) continue;
        if (!extraMoves.has(c)) extraMoves.set(c, []);
        extraMoves.get(c).push(moveTo(c, f, { handover: true }));
      }
    }
  }

  // 3b. The island's edges outside its largest strongly connected set (with the city, when joined): a route can neither
  //     start nor end on them (they lead nowhere, or nothing leads to them)
  markStranded(edges, city ? city.edges : [], extraMoves);

  // 4. Shortened at their bends, for the curves round them (handovers leave the city's edges as they are)
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz)));
  for (const e of edges) {
    for (const m of e.moves) {
      if (m.handover) continue;
      const f = m.to;
      const need = Math.max(0.3, CORNER_R * Math.tan(Math.min(Math.PI / 2 - 0.05, angle(e, f)) / 2));
      e.trimEnd = Math.max(e.trimEnd, need);
      f.trimStart = Math.max(f.trimStart, need);
    }
  }
  for (const e of edges) {
    const a = Math.min(e.trimStart, e.raw * 0.35);
    const b = Math.min(e.trimEnd, e.raw * 0.35);
    e.sx = e.x0 + e.dx * a;
    e.sz = e.z0 + e.dz * a;
    e.len = e.raw - a - b;
  }

  return assemble(edges, extraMoves, roads, city, keepLeft);
}

// The network around its island edges and the city's moves onto them: the lane-to-lane curves (built on first use),
// the room on the roads, and the city's graph joined in when there is one
function assemble(edges, extraMoves, roads, city, keepLeft) {
  const curves = new Map();
  const cityIds = new WeakMap(); // (the city's edges have their own ids; these keep clear of the island's)
  let next = 0;
  const idOf = (e) => {
    if (e.island) return e.uid;
    let id = cityIds.get(e);
    if (id === undefined) cityIds.set(e, (id = `c${next++}`));
    return id;
  };
  function connector(e, i, f, j) {
    if (city && !e.island && !f.island) return city.connector(e, i, f, j);
    const k = `${idOf(e)}:${i}:${idOf(f)}:${j}`;
    let c = curves.get(k);
    if (!c) curves.set(k, (c = makeCurve(e, i, f, j)));
    return c;
  }

  // On the island's roads: within a carriageway's width of the nearest road's line (its lanes, as lanesOf lays them)
  function onIslandRoad(x, z, clear = 0) {
    const p = roads.nearest(x, z, 24);
    if (!p) return false;
    const L = roads.LANE;
    const n = Math.max(1, p.road.lanes);
    if (!p.road.oneway) return p.dist + clear <= (n * L) / 2 + 0.6;
    // a one-way carriageway: from a lane's width to the kerb side of its line to its last lane's far edge
    const right = ((x - p.x) * -p.dz + (z - p.z) * p.dx) * p.road.oneway; // m right of its travel
    const [lo, hi] = keepLeft ? [-L, (n - 1) * L] : [-(n - 1) * L, L];
    return right - clear >= lo - 0.6 && right + clear <= hi + 0.6;
  }

  const islandOnly = { edges, keepLeft, connector, curvePoint, isRoadClear: onIslandRoad, onSidewalk: () => false, extraMoves, inCore: roads.inCore };
  if (!city) return islandOnly;
  return {
    edges: [...city.edges, ...edges],
    islandEdges: edges,
    keepLeft,
    connector,
    curvePoint,
    extraMoves,
    inCore: roads.inCore,
    isRoadClear: (x, z, clear) => (roads.inCore(x, z) ? city.isRoadClear(x, z, clear) : onIslandRoad(x, z, clear)),
    onSidewalk: (x, z) => (city.onSidewalk ? city.onSidewalk(x, z) : false),
    walkable: city.walkable,
    city
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Building in a worker (js/island-network-worker.js): the city's graph goes in as its topology, the island's edges and
// the moves between the two come back as flat typed arrays (transferred, not copied), and are put back together into
// objects on the main thread around the island roads it already has (js/island-roads.js, built from the same data, so
// its roads and traffic lights line up index for index)
// -------------------------------------------------------------------------------------------------------------------

const TURN_CODE = { S: 0, L: 1, R: 2 };
const TURN_OF = ['S', 'L', 'R'];

/** The city graph's shape for a worker: { n, geo (Float64Array sx sz dx dz len per edge), laneStart, lanes, moveStart, moveTo } */
function cityTopology(city) {
  const n = city.edges.length;
  const index = new Map(city.edges.map((e, i) => [e, i]));
  const geo = new Float64Array(n * 5);
  const laneStart = new Int32Array(n + 1);
  const moveStart = new Int32Array(n + 1);
  let nl = 0, nm = 0;
  city.edges.forEach((e, i) => {
    geo.set([e.sx, e.sz, e.dx, e.dz, e.len], i * 5);
    laneStart[i] = nl;
    nl += e.lanes.length;
    moveStart[i] = nm;
    nm += e.moves.length;
  });
  laneStart[n] = nl;
  moveStart[n] = nm;
  const lanes = new Float32Array(nl);
  const moveTo = new Int32Array(nm);
  city.edges.forEach((e, i) => {
    lanes.set(e.lanes, laneStart[i]);
    e.moves.forEach((m, k) => (moveTo[moveStart[i] + k] = index.get(m.to) ?? -1));
  });
  return { n, geo, laneStart, lanes, moveStart, moveTo };
}

/** Stand-ins for the city's edges from their topology (enough to join the island's to them and find what is cut off) */
function cityFromTopology(t) {
  const edges = [];
  for (let i = 0; i < t.n; i++) {
    const [sx, sz, dx, dz, len] = t.geo.subarray(i * 5, i * 5 + 5);
    edges.push({ sx, sz, dx, dz, rx: -dz, rz: dx, len, lanes: Array.from(t.lanes.subarray(t.laneStart[i], t.laneStart[i + 1])), moves: [], cityIndex: i });
  }
  for (let i = 0; i < t.n; i++) {
    for (let k = t.moveStart[i]; k < t.moveStart[i + 1]; k++) if (t.moveTo[k] >= 0) edges[i].moves.push({ to: edges[t.moveTo[k]] });
  }
  return { edges };
}

/**
 * A built network (createIslandNetwork, its city stand-ins carrying cityIndex) as transferable arrays: per island edge
 * its road (index in roads.roads) and way, geometry, flags and stop line, lanes, and moves (to an island edge i as i, to
 * a city edge c as -1 - c, with turn, flags, cross and the lane each lane goes on to); and the city's moves onto it
 */
function packIslandNetwork(net, roads) {
  const edges = net.islandEdges || net.edges;
  const index = new Map(edges.map((e, i) => [e, i]));
  const roadIndex = new Map(roads.roads.map((r, i) => [r, i]));
  const signalIndex = new Map(roads.signals.map((g, i) => [g, i]));
  const target = (e) => (e.island ? index.get(e) : -1 - e.cityIndex);
  const n = edges.length;
  const geo = new Float64Array(n * 12);
  const meta = new Int32Array(n * 5); // road, dir, stranded, stop signal (-1 none), stop group
  const laneStart = new Int32Array(n + 1);
  const moveStart = new Int32Array(n + 1);
  let nl = 0, nm = 0, no = 0;
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    laneStart[i] = nl;
    nl += e.lanes.length;
    moveStart[i] = nm;
    nm += e.moves.length;
    for (const m of e.moves) no += m.out.length;
  }
  laneStart[n] = nl;
  moveStart[n] = nm;
  const extra = [...net.extraMoves].flatMap(([c, list]) => list.map((m) => [c, m]));
  for (const [, m] of extra) no += m.out.length;
  const lanes = new Float32Array(nl);
  const mTo = new Int32Array(nm + extra.length);
  const mFlags = new Int32Array(nm + extra.length); // turn code | uturn << 2 | handover << 3 | bridge << 4
  const mCross = new Float32Array(nm + extra.length);
  const mOut = new Int32Array(no);
  const extraFrom = new Int32Array(extra.length);
  let o = 0;
  const putMove = (k, m) => {
    mTo[k] = target(m.to);
    mFlags[k] = TURN_CODE[m.turn] | (m.uturn ? 4 : 0) | (m.handover ? 8 : 0) | (m.bridge ? 16 : 0);
    mCross[k] = m.cross;
    mOut.set(m.out, o);
    o += m.out.length;
  };
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    geo.set([e.x0, e.z0, e.x1, e.z1, e.raw, e.dx, e.dz, e.sx, e.sz, e.len, e.trimStart, e.trimEnd], i * 12);
    meta.set([roadIndex.get(e.road), e.dir, e.stranded ? 1 : 0, e.stop ? signalIndex.get(e.stop.signal) : -1, e.stop ? e.stop.group : 0], i * 5);
    lanes.set(e.lanes, laneStart[i]);
    e.moves.forEach((m, k) => putMove(moveStart[i] + k, m));
  }
  extra.forEach(([c, m], k) => {
    extraFrom[k] = c.cityIndex;
    putMove(nm + k, m);
  });
  return { n, geo, meta, laneStart, lanes, moveStart, mTo, mFlags, mCross, mOut, extraFrom };
}

/** The arrays of a packed network as a transfer list */
const packedTransferables = (p) => [p.geo, p.meta, p.laneStart, p.lanes, p.moveStart, p.mTo, p.mFlags, p.mCross, p.mOut, p.extraFrom].map((a) => a.buffer);

/** A packed network back as objects, joined to `city` (its edges in the order its topology was taken) */
function unpackIslandNetwork(p, roads, options = {}) {
  const steps = unpackSteps(p, roads, options);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/**
 * The same, a slice at a time (~100 ms of work in all for the whole island): resolves once done, running `budget` ms
 * per slice (more on a slow page) and yielding to the page between slices
 */
function unpackIslandNetworkInSlices(p, roads, options = {}, { budget = 6, yieldTo = null, sliceEvery = 512 } = {}) {
  const steps = unpackSteps(p, roads, { ...options, sliceEvery });
  // (a task between frames: requestIdleCallback was starved for over a minute on a page busy every frame)
  const pause = yieldTo || ((fn) => setTimeout(fn, 0));
  const stats = { slices: 0, first: 0, started: performance.now() };
  unpackIslandNetworkInSlices.last = stats;
  return new Promise((resolve, reject) => {
    let last = performance.now();
    const run = () => {
      try {
        // (more per slice the longer the page took to come back: on a page managing a frame a second, a few ms a frame
        // would take minutes; 8% of the wait adds little to frames that slow)
        const now = performance.now();
        const wait = now - last;
        const until = now + (wait > 100 ? Math.max(budget, Math.min(200, wait * 0.08)) : budget);
        stats.slices++;
        if (!stats.first) stats.first = now;
        let r;
        do r = steps.next(); while (!r.done && performance.now() < until);
        last = performance.now();
        if (r.done) resolve(r.value);
        else pause(run);
      } catch (e) {
        reject(e);
      }
    };
    pause(run);
  });
}

// unpackIslandNetwork's work, pausing (yield) every `sliceEvery` edges
function* unpackSteps(p, roads, { keepLeft = true, city = null, sliceEvery = Infinity } = {}) {
  const edges = new Array(p.n);
  for (let i = 0; i < p.n; i++) {
    if (i % sliceEvery === sliceEvery - 1) yield;
    const g = p.geo.subarray(i * 12, i * 12 + 12);
    const road = roads.roads[p.meta[i * 5]];
    const sig = p.meta[i * 5 + 3];
    const e = {
      uid: i, island: true, road, dir: p.meta[i * 5 + 1], x0: g[0], z0: g[1], x1: g[2], z1: g[3], raw: g[4],
      dx: g[5], dz: g[6], rx: -g[6], rz: g[5], sx: g[7], sz: g[8], len: g[9], trimStart: g[10], trimEnd: g[11],
      lanes: Array.from(p.lanes.subarray(p.laneStart[i], p.laneStart[i + 1])), moves: [], axisIndex: 0,
      speedLimit: road.speed, navName: road.name || '', costFactor: Math.sqrt(25 / Math.max(5, road.speed)),
      to: { signal: sig >= 0 }, stranded: p.meta[i * 5 + 2] === 1
    };
    if (sig >= 0) {
      const stop = { signal: roads.signals[sig], group: p.meta[i * 5 + 4] };
      e.stop = stop;
      e.phaseAt = (time) => roads.phase(stop.signal, stop.group, time);
    }
    edges[i] = e;
  }
  const cityEdges = city ? city.edges : [];
  const to = (t) => (t >= 0 ? edges[t] : cityEdges[-1 - t]);
  let o = 0;
  const move = (k, fromLanes) => {
    const f = p.mFlags[k];
    const m = { to: to(p.mTo[k]), turn: TURN_OF[f & 3], cross: p.mCross[k], uturn: Boolean(f & 4), out: Array.from(p.mOut.subarray(o, o + fromLanes)) };
    if (f & 8) m.handover = true;
    if (f & 16) m.bridge = true;
    o += fromLanes;
    return m;
  };
  for (let i = 0; i < p.n; i++) {
    if (i % sliceEvery === sliceEvery - 1) yield;
    const e = edges[i];
    for (let k = p.moveStart[i]; k < p.moveStart[i + 1]; k++) e.moves.push(move(k, e.lanes.length));
  }
  const extraMoves = new Map();
  const nm = p.moveStart[p.n];
  for (let k = 0; k < p.extraFrom.length; k++) {
    const c = cityEdges[p.extraFrom[k]];
    if (!c) continue;
    if (!extraMoves.has(c)) extraMoves.set(c, []);
    extraMoves.get(c).push(move(nm + k, c.lanes.length));
  }
  return assemble(edges, extraMoves, roads, city, keepLeft);
}

/** The worker's whole job: roads.json's data and the city's topology in, the packed network out */
function buildPackedIslandNetwork(data, topology, { keepLeft = true, coreRing = null, createRoads }) {
  const roads = createRoads(data, { coreRing });
  const city = topology ? cityFromTopology(topology) : null;
  const net = createIslandNetwork(roads, { keepLeft, city, coreRing });
  return packIslandNetwork(net, roads);
}

/**
 * The joined graph for the app: start(roads, url) builds it in a worker (makeWorker()) and puts it together here between
 * frames; resolve(a, b) gives a trip from a to b the graph to plan on: the city's while both ends are in town, the joined
 * one once it is ready. A trip out of town before then plans on the city's graph (to its edge) and gets the joined one
 * through onReady(net) the moment it is ready. Without a worker (or if it fails) the graph is built here the first time a
 * trip needs it. state: 'waiting' (for the roads), 'building', 'ready' or 'main' (to build here when needed).
 */
function createIslandGraph({ city, keepLeft = true, coreRing = null, makeWorker = null, onReady = () => {}, log = console }) {
  let roads = null;
  let net = null;
  let waiting = false; // a trip out of town is on the city's graph for now
  const g = { state: 'waiting', started: 0, ms: 0 };
  const buildHere = () => (net = createIslandNetwork(roads, { keepLeft, city, coreRing }));
  const ready = (n) => {
    net = n;
    g.state = 'ready';
    if (waiting) {
      waiting = false;
      onReady(n);
    }
  };
  const fallBack = (why) => {
    if (g.state === 'ready') return;
    log.warn?.(`[island] road graph worker: ${why}; building it on the main thread when needed`);
    g.state = 'main';
    if (waiting) ready(buildHere());
  };
  g.start = (r, url) => {
    roads = r;
    let worker;
    try {
      worker = makeWorker ? makeWorker() : null;
    } catch (e) {
      worker = null;
      fallBack(e.message || 'unavailable');
      return;
    }
    if (!worker) return fallBack('none');
    g.state = 'building';
    g.started = performance.now();
    worker.onerror = (e) => {
      worker.terminate?.();
      fallBack(e.message || 'failed');
    };
    worker.onmessage = ({ data }) => {
      worker.terminate?.();
      if (data.error) return fallBack(data.error);
      g.workerMs = performance.now() - g.started;
      unpackIslandNetworkInSlices(data.packed, roads, { keepLeft, city }).then((n) => {
        g.ms = performance.now() - g.started;
        log.info?.(`[island] road graph: ${n.islandEdges ? n.islandEdges.length : n.edges.length} edges, ready in ${Math.round(g.ms)} ms (built off the main thread in ${Math.round(g.workerMs)} ms; put together in ${unpackIslandNetworkInSlices.last.slices} slices, the first ${Math.round(unpackIslandNetworkInSlices.last.first - unpackIslandNetworkInSlices.last.started)} ms after it arrived)`);
        ready(n);
      }, (e) => fallBack(e.message || String(e)));
    };
    worker.postMessage({ id: 1, url, topology: city ? cityTopology(city) : null, keepLeft, coreRing });
  };
  g.resolve = (a, b) => {
    if (net) return net;
    if (!roads || (roads.inCore(a.x, a.z) && roads.inCore(b.x, b.z))) return city;
    if (g.state === 'main') {
      g.state = 'ready';
      return buildHere();
    }
    waiting = true;
    return city;
  };
  return g;
}

// Joins dead ends (edges with no moves) to the edges starting nearest their ends, and edges nothing leads into from the
// edges ending nearest their starts, within BRIDGE m: ahead where there is a way ahead, else back
function bridgeLooseEnds(edges, moveTo) {
  const CELL = 20;
  const grid = (pick) => {
    const g = new Map();
    for (const e of edges) {
      const [x, z] = pick(e);
      const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(e);
    }
    return g;
  };
  const near = (g, x, z) => {
    const out = [];
    for (let i = Math.floor((x - REACH) / CELL); i <= Math.floor((x + REACH) / CELL); i++) {
      for (let j = Math.floor((z - REACH) / CELL); j <= Math.floor((z + REACH) / CELL); j++) out.push(...(g.get(i * 100003 + j) || []));
    }
    return out;
  };
  const starts = grid((e) => [e.x0, e.z0]);
  const ends = grid((e) => [e.x1, e.z1]);
  const fed = new Set();
  for (const e of edges) for (const m of e.moves) fed.add(m.to);
  // the nearest within BRIDGE going on ahead (else turning back), else the nearest within REACH going the same way
  const choose = (cands, d, dot) => {
    const close = cands.filter((c) => d(c) <= BRIDGE);
    const ahead = close.filter((c) => dot(c) > -0.2);
    let pool = ahead.length ? ahead : close;
    if (!pool.length) pool = cands.filter((c) => d(c) <= REACH && dot(c) > 0.5);
    pool.sort((a, b) => d(a) - d(b));
    return pool.slice(0, ahead.length ? 2 : 1);
  };
  for (const e of edges) {
    if (e.moves.length) continue;
    const cands = near(starts, e.x1, e.z1).filter((f) => f !== e && f.road !== e.road && Math.hypot(f.x0 - e.x1, f.z0 - e.z1) <= REACH);
    // (turning back on its own road too, where it runs both ways)
    for (const f of near(starts, e.x1, e.z1)) if (f.road === e.road && f.dir !== e.dir && Math.hypot(f.x0 - e.x1, f.z0 - e.z1) <= BRIDGE) cands.push(f);
    for (const f of choose(cands, (f) => Math.hypot(f.x0 - e.x1, f.z0 - e.z1), (f) => e.dx * f.dx + e.dz * f.dz)) {
      e.moves.push(moveTo(e, f, { uturn: e.dx * f.dx + e.dz * f.dz < -0.2, bridge: true }));
      fed.add(f);
    }
  }
  for (const f of edges) {
    if (fed.has(f)) continue;
    const cands = near(ends, f.x0, f.z0).filter((e) => e !== f && Math.hypot(e.x1 - f.x0, e.z1 - f.z0) <= REACH && !e.moves.some((m) => m.to === f));
    for (const e of choose(cands, (e) => Math.hypot(e.x1 - f.x0, e.z1 - f.z0), (e) => e.dx * f.dx + e.dz * f.dz)) {
      e.moves.push(moveTo(e, f, { uturn: e.dx * f.dx + e.dz * f.dz < -0.2, bridge: true }));
    }
  }
}

// Marks the island edges (e.stranded) outside the largest strongly connected set of all the edges (Kosaraju)
function markStranded(island, cityEdges, extraMoves) {
  const all = [...cityEdges, ...island];
  const index = new Map(all.map((e, i) => [e, i]));
  const succ = all.map((e) => {
    const out = [];
    for (const m of e.moves) if (index.has(m.to)) out.push(index.get(m.to));
    for (const m of extraMoves.get(e) || []) if (index.has(m.to)) out.push(index.get(m.to));
    return out;
  });
  const pred = all.map(() => []);
  succ.forEach((list, i) => { for (const j of list) pred[j].push(i); });
  const seen = new Uint8Array(all.length);
  const order = [];
  for (let r = 0; r < all.length; r++) {
    if (seen[r]) continue;
    seen[r] = 1;
    const stack = [[r, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] < succ[top[0]].length) {
        const j = succ[top[0]][top[1]++];
        if (!seen[j]) { seen[j] = 1; stack.push([j, 0]); }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(all.length).fill(-1);
  let best = -1, bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k]] >= 0) continue;
    const stack = [order[k]];
    comp[order[k]] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      for (const p of pred[i]) if (comp[p] < 0) { comp[p] = c; stack.push(p); }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  for (const e of island) e.stranded = comp[index.get(e)] !== best;
}

// The distance from (x, z) to a ring's edge (flat [x0, z0, x1, z1, ...])
function ringDistance(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1];
    const ex = ring[i] - ax, ez = ring[i + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

export { createIslandNetwork, createIslandGraph, ringDistance, cityTopology, cityFromTopology, packIslandNetwork, unpackIslandNetwork, unpackIslandNetworkInSlices, packedTransferables, buildPackedIslandNetwork };
