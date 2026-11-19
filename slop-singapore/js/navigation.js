import { signalPhase, nearestRoads } from './city-config.js';
import { Tracker, firstConflict } from './perception.js';

// js/navigation.js
// Drive to a destination over the road graph traffic.js drives on (road-network.js): A* over its directed edges and
// the moves between them, a lane-level path (lane changes before each turn, the network's own lane-to-lane curves
// through the intersections), turn-by-turn guidance, and three drivers for it:
// - you: the route and the next turn are shown, you drive
// - self: a cautious self-driving taxi — pure-pursuit steering and a speed profile from the path's curvature, it keeps
//   its lane, stops for red (and amber it can stop for) lights, follows the vehicle ahead and waits for people in the
//   road
// - crazy: a Crazy Taxi driver on the clock — flat out, every light is green, it swerves around anything slower into
//   whichever lane is free (the oncoming ones too), honks, and scores near misses into the fare
// The autopilots drive the player's own car through the same inputs as the keyboard (controllers.js
// setAutopilotInput), so the car's physics, collisions and the traffic's reactions to it are the ordinary ones.
// Touching the throttle, brake or steering takes over.
//
// Conventions as road-network.js: north = -z, east = +x, an edge's direction (dx, dz) and right normal (rx, rz); the
// player's heading h faces (sin h, cos h) and steering left raises it.

const SAMPLE = 3; // metres between path points along an edge
const CURVE_SAMPLE = 1.5; // and along an intersection curve
// The car (controllers.js): a bicycle model on a 2.76 m wheelbase, steering up to 0.6 rad at parking speeds and less
// with speed (so its tyres corner at up to 10.5 m/s²), 9.5 m/s² of grip for braking and cornering together
const WHEELBASE = 2.76;
const CORNERING = 10.5;
const MAX_LOCK = 0.6;
const maxSteerAt = (v) => Math.atan((WHEELBASE * CORNERING) / Math.max(v * v, (WHEELBASE * CORNERING) / Math.tan(MAX_LOCK)));
const MAX_CURVATURE = Math.tan(MAX_LOCK) / WHEELBASE;
const GRIP = 9.5;
// how far ahead of the car's steering and yaw lag the controller looks by default (s)
const STEER_LAG = 0.1;
const CAR_HALF_L = 2.2;
const CAR_HALF_W = 0.9;

const DRIVERS = {
  you: { id: 'you', label: 'You drive', auto: false, offRoute: 28 },
  self: {
    id: 'self', label: 'Self-driving', auto: true, offRoute: 14,
    limits: true, // keeps to the island roads' speed limits (js/island-roads.js), up to its cruise
    cruise: 25, // 90 km/h, Singapore's expressway limit (slower where the curves, the lights or the traffic say so)
    aLat: 2.0, brake: 2.6, hardBrake: 7, gap0: 4.0, gapTime: 1.3, margin: 0.45,
    cut: 0.6, // m: how far its smoothed line may stray from the lanes' polyline (smoothPath)
    signals: true, peds: true,
    // steering (drive(), step 3): tuned against controllers.js updateCar in tests/navigation.test.cjs
    steerLag: 0.1, steerPreview: 1.4, steerHeading: 1.4, steerCross: 1.6, curveWindow: [0], turnPenalty: 8, signalPenalty: 12,
    // seeing the traffic coming (avoid()): how far ahead it looks (s), the room it keeps (m, growing with how far ahead
    // it is guessing), how hard it will brake before it would rather swerve, how hard it swerves (m/s² across), and
    // whether it may leave its own side of the road to get out of the way
    laneAcc: 0.9, // m/s² across in an ordinary lane change
    safety: { horizon: 4, clearance: 0.7, growth: 0.2, pedClearance: 1.0, comfort: 4.5, maxBrake: 9, latAcc: 3.5, nudges: [0.8, 1.5], ownSide: true, lateralCost: 6 }
  },
  crazy: {
    id: 'crazy', label: 'Crazy Taxi', auto: true, offRoute: 20,
    cruise: 34,
    aLat: 8.0, brake: 7.0, hardBrake: 9, gap0: 1.2, gapTime: 0.25, margin: 0.15,
    cut: 1.0,
    signals: false, peds: false,
    steerLag: 0.1, steerPreview: 2.5, steerHeading: 1.4, steerCross: 0.8, curveWindow: [0], turnPenalty: 14, signalPenalty: 0,
    // a rule breaker: less look-ahead, a hand's breadth of room, swerving hard before braking, anywhere on the road
    laneAcc: 3.5,
    safety: { horizon: 3, clearance: 0.15, growth: 0.15, pedClearance: 0.4, comfort: 2.5, maxBrake: 9, latAcc: 6, nudges: [1.5, 3.4, 6.8], ownSide: false, lateralCost: 0.4 }
  }
};

// (the edge the island traffic's stand-ins drive on: they are on none of the road graph's, but in play)
const ISLAND_EDGE = Object.freeze({ island: true });

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------------------------------

// The moves on from edge e: its own, and any a joined network adds (island-network.js: the city's edges handing over to
// the island's roads, kept off the edges themselves so the city's traffic never takes them)
const movesOf = (network, e) => {
  const extra = network.extraMoves && network.extraMoves.get(e);
  return extra ? [...e.moves, ...extra] : e.moves;
};

// Where (x, z) is on edge e: distance along it (clamped), across it (to its right) and from it
function onEdge(e, x, z) {
  const ax = x - e.sx;
  const az = z - e.sz;
  const along = ax * e.dx + az * e.dz;
  const s = clamp(along, 0, e.len);
  const across = ax * e.rx + az * e.rz;
  // distance to the nearest of its lanes, the overhang past its ends counting in full
  let lateral = Infinity;
  for (const o of e.lanes) lateral = Math.min(lateral, Math.abs(across - o));
  if (!e.lanes.length) lateral = Math.abs(across);
  return { s, across, dist: Math.hypot(along - s, lateral) };
}

// The edge to start from: close by, and facing the way the car does (a car facing the wrong way picks the edge it's on
// all the same when nothing better is near)
function findStartEdge(network, x, z, heading, radius = 45) {
  const hx = Math.sin(heading);
  const hz = Math.cos(heading);
  let best = null;
  for (const e of network.edges) {
    if (Math.abs(e.sx + e.dx * e.len * 0.5 - x) > e.len * 0.5 + radius || Math.abs(e.sz + e.dz * e.len * 0.5 - z) > e.len * 0.5 + radius) continue;
    const p = onEdge(e, x, z);
    if (p.dist > radius) continue;
    const facing = hx * e.dx + hz * e.dz;
    // (an edge cut off from the rest of the roads only when nothing else is near: there is no way on from it)
    const score = p.dist + (1 - facing) * 9 + (e.stranded ? 500 : 0);
    if (!best || score < best.score) best = { edge: e, s: p.s, across: p.across, score };
  }
  return best;
}

// Edges the destination can be reached on, with the distance from each to it: the nearest and others a little further
// (the other way along a two-way street, the street round the corner, the one across the plaza), which the search
// weighs against the drive to each, so a one-way loop doesn't send it round the city for the nearest kerb
function findGoalEdges(network, x, z, radius = 260) {
  const found = [];
  for (const e of network.edges) {
    if (Math.abs(e.sx + e.dx * e.len * 0.5 - x) > e.len * 0.5 + radius || Math.abs(e.sz + e.dz * e.len * 0.5 - z) > e.len * 0.5 + radius) continue;
    const p = onEdge(e, x, z);
    if (p.dist <= radius) found.push({ edge: e, s: clamp(p.s, Math.min(3, e.len * 0.5), e.len), dist: p.dist });
  }
  // (edges cut off from the rest of the roads only when no other is near)
  const connected = found.filter((g) => !g.edge.stranded);
  if (connected.length) found.length = 0, found.push(...connected);
  found.sort((a, b) => a.dist - b.dist);
  if (!found.length) return [];
  const near = found[0].dist + 120;
  return found.filter((g) => g.dist <= near).slice(0, 40).map((g) => ({ ...g, extra: (g.dist - found[0].dist) * 4 }));
}

// Binary min-heap of [priority, ...payload]
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest drive from (start.x, start.z) facing start.heading to (goal.x, goal.z): { edges, moves, s0, s1 } — the edges
 * driven in order, the move taken from each to the next, where along the first it starts and along the last it ends —
 * or null when the destination can't be reached. Turns, U-turns and signals cost a little extra, by driver.
 */
function planRoute(network, start, goal, driver = DRIVERS.self) {
  const from = findStartEdge(network, start.x, start.z, start.heading) || findStartEdge(network, start.x, start.z, start.heading, 300);
  // (a destination off the roads: the nearest road to it, out to 1.5 km)
  let goals = findGoalEdges(network, goal.x, goal.z);
  if (!goals.length) goals = findGoalEdges(network, goal.x, goal.z, 1500);
  if (!from || !goals.length) return null;
  const goalS = new Map(goals.map((g) => [g.edge, g.s]));
  const goalExtra = new Map(goals.map((g) => [g.edge, g.extra || 0]));
  const turnPenalty = driver.turnPenalty ?? 6;
  const signalPenalty = driver.signalPenalty ?? 8;
  const h = (e) => Math.hypot(e.sx + e.dx * e.len - goal.x, e.sz + e.dz * e.len - goal.z) * 0.98;
  const stepCost = (e, m) => {
    const f = m.to;
    const ex = e.sx + e.dx * e.len;
    const ez = e.sz + e.dz * e.len;
    let c = Math.hypot(f.sx - ex, f.sz - ez) * 1.15;
    if (m.uturn) c += 45;
    else if (m.turn !== 'S') c += turnPenalty;
    if (e.to.signal) c += signalPenalty;
    return c;
  };

  // Search states are edges, g the cost to the start of the edge. The start edge is left from a virtual start part way
  // along it, so a destination behind the car on the same edge is reached by going round the block
  const g = new Map();
  const prev = new Map(); // edge -> [previous edge, move]
  const heap = new Heap(); // [priority, cost, edge, finish]
  const s0 = from.s;
  const startEdge = from.edge;
  const sGoalStart = goalS.get(startEdge);
  if (sGoalStart !== undefined && sGoalStart > s0 + 4) heap.push([sGoalStart - s0 + goalExtra.get(startEdge), sGoalStart - s0, startEdge, 'direct']);
  for (const m of movesOf(network, startEdge)) {
    const c = (startEdge.len - s0) * (startEdge.costFactor || 1) + stepCost(startEdge, m);
    if (!g.has(m.to) || c < g.get(m.to)) {
      g.set(m.to, c);
      prev.set(m.to, [startEdge, m]);
      heap.push([c + h(m.to), c, m.to, false]);
    }
  }
  const closed = new Set();
  let expansions = 0;
  while (heap.size && expansions++ < 400000) {
    const [, cost, e, finish] = heap.pop();
    if (finish) {
      const edges = [e];
      const moves = [];
      if (finish !== 'direct') {
        // back to the start edge (entered from the virtual start: nothing reached through the start edge driven round
        // the block can beat reaching it directly, so its successors' prev entries are the virtual start's)
        let cur = e;
        for (let guard = 0; guard < 100000; guard++) {
          const [p, m] = prev.get(cur);
          edges.push(p);
          moves.push(m);
          if (p === startEdge) break;
          cur = p;
        }
        edges.reverse();
        moves.reverse();
      }
      return { edges, moves, s0, s1: goalS.get(e), length: cost, start: from };
    }
    if (closed.has(e)) continue;
    closed.add(e);
    if (goalS.has(e)) heap.push([cost + goalS.get(e) + goalExtra.get(e), cost + goalS.get(e), e, 'goal']);
    for (const m of movesOf(network, e)) {
      const f = m.to;
      if (closed.has(f)) continue;
      // (a road's length weighed by how slow it is: an expressway costs its length, a 40 km/h road half as much again)
      const c = cost + e.len * (e.costFactor || 1) + stepCost(e, m);
      if (!g.has(f) || c < g.get(f)) {
        g.set(f, c);
        prev.set(f, [e, m]);
        heap.push([c + h(f), c, f, false]);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Path: lane-level polyline with speed limits, maneuvers and stop lines
// ---------------------------------------------------------------------------------------------------------------------

// The lane of e nearest lane offset `o`, out of the lanes allowed (indices) — all of them when `allowed` is empty
function nearestLaneIndex(e, o, allowed) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < e.lanes.length; i++) {
    if (allowed && !allowed.includes(i)) continue;
    const d = Math.abs(e.lanes[i] - o);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const smooth = (t) => t * t * (3 - 2 * t);

function edgeName(e) {
  if (e.navName !== undefined) return e.navName;
  const x = e.sx + e.dx * e.len * 0.5;
  const z = e.sz + e.dz * e.len * 0.5;
  let name = '';
  try {
    const near = nearestRoads(x, z, 30);
    // the road running the edge's way (not the cross street at its end)
    const along = near.find((r) => r.dist < 18) || near[0];
    name = along ? along.road.name : '';
  } catch { /* no road index (tests) */ }
  e.navName = name;
  return name;
}

/**
 * The path of a route as points { x, z, s (metres along), tx, tz (unit tangent), k (curvature), v (speed limit) },
 * its maneuvers { s, turn, uturn, cross, name, edge } at each intersection and its stop lines { s, edge } at signals,
 * starting at (x, z) where the car is now.
 */
function buildPath(network, route, x, z, driver = DRIVERS.self) {
  const pts = [];
  const maneuvers = [];
  const stops = [];
  const add = (px, pz, edge = null, lane = 0, vmax = edge?.speedLimit) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(px - last.x, pz - last.z) < 0.4) return;
    pts.push({ x: px, z: pz, s: 0, tx: 0, tz: 1, nx: 1, nz: 0, k: 0, ks: 0, v: 0, edge, lane, vmax });
  };
  add(x, z);
  const { edges, moves } = route;
  let entry = -1; // lane index entering the current edge
  const pt = { x: 0, z: 0, dx: 0, dz: 1 };
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const m = moves[k];
    const first = k === 0;
    const last = k === edges.length - 1;
    const sA = first ? route.s0 : 0;
    const sB = last ? route.s1 : e.len;
    if (entry < 0) entry = nearestLaneIndex(e, first ? route.start.across : 0);
    // the lane the move out of e leaves from: the nearest to the one entered that the move allows
    let exit = entry;
    if (m) {
      const allowed = [];
      for (let i = 0; i < e.lanes.length; i++) if (m.out[i] >= 0) allowed.push(i);
      if (allowed.length && !allowed.includes(entry)) exit = nearestLaneIndex(e, e.lanes[entry], allowed);
    } else if (last) {
      // arriving: pull over into the kerbside lane (lanes run left to right)
      exit = network.keepLeft ? 0 : e.lanes.length - 1;
    }
    const oA = e.lanes[entry] ?? 0;
    const oB = e.lanes[exit] ?? 0;
    const span = Math.max(0, sB - sA);
    // lane change: as long as it takes at the speed the car will be doing here to move across at no more than the
    // driver's lane-change sideways acceleration (a sine-shaped move of dy over L m at v m/s peaks at
    // pi^2 dy v^2 / 2 L^2), and at least 10 m per metre across; over at most three quarters of what is left of the edge,
    // starting soon. (The speed: its cruise, the road's limit for a driver who keeps to it, and no more than it can
    // reach and brake from again along the edge.)
    const dy = Math.abs(oB - oA);
    const vHere = Math.min(driver.cruise ?? 13.9, driver.limits ? e.speedLimit ?? Infinity : Infinity, Math.sqrt((driver.brake ?? 3) * span));
    const lc = dy < 0.1 ? 0 : Math.min(span * 0.75, Math.max(10 * dy, Math.PI * vHere * Math.sqrt(dy / (2 * (driver.laneAcc ?? 0.9)))));
    const c0 = sA + Math.min(first ? 6 : 2, span * 0.15);
    const c1 = c0 + lc;
    const lane = (s) => (lc <= 0 || s <= c0 ? (s <= c0 ? oA : oB) : s >= c1 ? oB : oA + (oB - oA) * smooth((s - c0) / lc));
    // the car's own spot leads onto the lane a few metres on
    const begin = first ? Math.min(sB, sA + Math.min(7, span * 0.5)) : sA;
    for (let s = begin; s < sB; s += SAMPLE) add(e.sx + e.dx * s + e.rx * lane(s), e.sz + e.dz * s + e.rz * lane(s), e, lane(s));
    add(e.sx + e.dx * sB + e.rx * oB, e.sz + e.dz * sB + e.rz * oB, e, oB);
    if (!m) break;
    const f = m.to;
    const j = m.out[exit] >= 0 ? m.out[exit] : nearestLaneIndex(f, oB);
    const at = pts.length - 1;
    if (e.to.signal) stops.push({ i: at, edge: e });
    maneuvers.push({ i: at, turn: m.turn, uturn: !!m.uturn, cross: m.cross || 0, edge: f, from: e });
    const c = network.connector(e, exit, f, j);
    // (through the junction at the lower of the two roads' limits)
    const vmax = Math.min(e.speedLimit ?? Infinity, f.speedLimit ?? Infinity);
    for (let s = CURVE_SAMPLE; s < c.len; s += CURVE_SAMPLE) {
      network.curvePoint(c, s, pt);
      add(pt.x, pt.z, null, 0, vmax);
    }
    entry = j;
  }

  // The line it will actually drive: the lanes' polyline smoothed into one a car can follow at speed (island roads are
  // short straights between mapped points, each joint a kink), never more than `cut` m off the lanes, so a corner is
  // still taken in lane and only the kinks and wobbles go. The speed profile and the steering both work from it.
  // (the lanes' own line, point for point, kept for the overlay to show beside the smoothed one)
  const mapped = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => { mapped[i * 2] = p.x; mapped[i * 2 + 1] = p.z; });
  smoothPath(pts, driver.cut ?? 0.35);

  // arc length, tangents, normals, curvature
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const p = pts[i];
    p.tx = (b.x - a.x) / L;
    p.tz = (b.z - a.z) / L;
    p.nx = -p.tz; // right normal, as road-network.js
    p.nz = p.tx;
  }
  // curvature: turning of the tangent over a few metres either side
  for (let i = 0; i < pts.length; i++) {
    let i0 = i;
    let i1 = i;
    while (i0 > 0 && pts[i].s - pts[i0].s < 3) i0--;
    while (i1 < pts.length - 1 && pts[i1].s - pts[i].s < 3) i1++;
    const ds = pts[i1].s - pts[i0].s;
    // (signed: positive turning left, the way the heading grows)
    const turn = wrapAngle(Math.atan2(pts[i1].tx, pts[i1].tz) - Math.atan2(pts[i0].tx, pts[i0].tz));
    pts[i].ks = ds > 0.5 ? turn / ds : 0;
    pts[i].k = Math.abs(pts[i].ks);
  }
  const path = { pts, mapped, maneuvers, stops, length: pts.length ? pts[pts.length - 1].s : 0, route };
  for (const mv of maneuvers) {
    mv.s = pts[mv.i].s;
    mv.name = edgeName(mv.edge);
  }
  for (const st of stops) st.s = pts[st.i].s;
  speedProfile(path, driver);
  return path;
}

// Smooths the points into a line a car can follow at speed while keeping each within `cut` m of where it was: blurred
// (which spreads a kink's turn over the points either side) at a ladder of lengths, from a few metres to ~40 m, and each point taking the most blurred
// version that stays within `cut` of it (between two rungs, in proportion). So a mapped kink on an expressway is eased
// over tens of metres, a junction's tight corner barely, and a corner is still taken in lane. The first point (where the
// car stands) and the last (the destination) stay put.
const SIGMAS = [2, 4, 8, 14, 22, 32, 44]; // m: smoothPath's blur lengths
function smoothPath(pts, cut) {
  const n = pts.length;
  if (n < 3 || !(cut > 0)) return;
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  gaps.sort((a, b) => a - b);
  const spacing = Math.max(0.5, gaps[gaps.length >> 1]);
  const ox = Float64Array.from(pts, (p) => p.x);
  const oz = Float64Array.from(pts, (p) => p.z);
  // (relaxing each point towards the middle of the points h either side of it blurs them, adding h^2 / 2 to the blur's
  // variance in points^2; h doubles as the blur grows, never past it, so a ~40 m blur takes a few dozen passes rather
  // than hundreds. The ends are held. Each rung blurs on from the one before.)
  let x = ox.slice();
  let z = oz.slice();
  let tx = x.slice();
  let tz = z.slice();
  const rungs = [];
  let variance = 0;
  for (const sigma of SIGMAS) {
    const target = (sigma / spacing) ** 2;
    while (variance < target - 1e-9) {
      let h = 1;
      while (0.5 * (2 * h) ** 2 <= Math.min(variance, target - variance)) h *= 2;
      for (let i = 1; i < n - 1; i++) {
        // (past an end, the line carried on straight through it: a straight stretch stays as it is)
        let ax, az, bx, bz;
        if (i - h >= 0) { ax = x[i - h]; az = z[i - h]; } else { const k = Math.min(n - 1, h - i); ax = 2 * x[0] - x[k]; az = 2 * z[0] - z[k]; }
        if (i + h <= n - 1) { bx = x[i + h]; bz = z[i + h]; } else { const k = Math.max(0, 2 * (n - 1) - i - h); bx = 2 * x[n - 1] - x[k]; bz = 2 * z[n - 1] - z[k]; }
        tx[i] = 0.5 * x[i] + 0.25 * (ax + bx);
        tz[i] = 0.5 * z[i] + 0.25 * (az + bz);
      }
      [x, tx] = [tx, x];
      [z, tz] = [tz, z];
      variance += 0.5 * h * h;
    }
    rungs.push([x.slice(), z.slice()]);
  }
  // how blurred each point may be: a fractional rung (-1 the points as they are, 0 the first rung, ...), the most blurred
  // that keeps within `cut` of it
  // (across the line only: the blur also slides unevenly spaced points along it, which is harmless)
  const R = rungs.length;
  const level = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const L = Math.hypot(ox[b] - ox[a], oz[b] - oz[a]) || 1;
    const ux = (ox[b] - ox[a]) / L, uz = (oz[b] - oz[a]) / L;
    let lv = -1, pd = 0;
    for (let r = 0; r < R; r++) {
      const d = Math.abs((rungs[r][0][i] - ox[i]) * uz - (rungs[r][1][i] - oz[i]) * ux);
      if (d <= cut) { lv = r; pd = d; continue; }
      lv += (cut - pd) / Math.max(1e-9, d - pd);
      break;
    }
    level[i] = lv;
  }
  // ...varying only gently along the path: a point takes the least of its neighbours' over the length its own blur
  // reaches, then that is averaged over the same length (a blend of two smooth lines by a slowly changing weight is
  // smooth; one changing point to point puts a wiggle in)
  const reachOf = (lv) => Math.max(1, Math.round((2 * (lv < 0 ? 1 : SIGMAS[Math.min(R - 1, Math.ceil(lv))])) / spacing));
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = reachOf(level[i]);
    let m = level[i];
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) m = Math.min(m, level[j]);
    low[i] = m;
  }
  const even = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = reachOf(low[i]);
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { sum += Math.min(low[j], low[i] + 0.5); cnt++; }
    even[i] = Math.min(low[i] + 0.25, sum / cnt);
  }
  const at = (r, i) => (r < 0 ? [ox[i], oz[i]] : [rungs[r][0][i], rungs[r][1][i]]);
  const fx = new Float64Array(n);
  const fz = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const lv = clamp(even[i], -1, R - 1);
    const r0 = Math.floor(lv);
    const t = lv - r0;
    const [ax, az] = at(r0, i);
    const [bx, bz] = at(Math.min(R - 1, r0 + 1), i);
    fx[i] = ax + (bx - ax) * t;
    fz[i] = az + (bz - az) * t;
  }
  for (let i = 1; i < n - 1; i++) {
    pts[i].x = fx[i];
    pts[i].z = fz[i];
  }
}

// The speed limit at each point: what the curve allows (lateral acceleration, and how fast the car can turn), and
// braking in time for slower points ahead and the end
function speedProfile(path, driver) {
  const { pts } = path;
  const cruise = driver.cruise ?? 13.9;
  const aLat = driver.aLat ?? 2.5;
  const b = driver.brake ?? 3;
  for (const p of pts) {
    const k = Math.max(p.k, 1e-4);
    // the road's limit, for a driver who keeps to them
    const limit = driver.limits && p.vmax !== undefined ? p.vmax : Infinity;
    // (a corner tighter than full lock allows is taken at a crawl)
    p.v = k > MAX_CURVATURE * 0.9 ? Math.min(cruise, 2.5) : Math.min(cruise, limit, Math.sqrt(aLat / k));
  }
  if (pts.length) pts[pts.length - 1].v = 0;
  for (let i = pts.length - 2; i >= 0; i--) {
    pts[i].v = Math.min(pts[i].v, Math.sqrt(pts[i + 1].v ** 2 + 2 * b * (pts[i + 1].s - pts[i].s)));
  }
}

// The point at arc length s (interpolated), offset `off` metres to the right of the path
function pointAt(path, s, off = 0, out = {}) {
  const { pts } = path;
  let i = out.hint ?? 0;
  i = clamp(i, 0, pts.length - 1);
  while (i > 0 && pts[i].s > s) i--;
  while (i < pts.length - 2 && pts[i + 1].s < s) i++;
  const a = pts[i];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const L = b.s - a.s;
  const t = L > 1e-6 ? clamp((s - a.s) / L, 0, 1) : 0;
  out.hint = i;
  out.x = a.x + (b.x - a.x) * t + (a.nx + (b.nx - a.nx) * t) * off;
  out.z = a.z + (b.z - a.z) * t + (a.nz + (b.nz - a.nz) * t) * off;
  out.v = a.v + (b.v - a.v) * t;
  out.vMin = Math.min(a.v, b.v); // (a speed limit holds until the point that lifts it)
  out.tx = a.tx + (b.tx - a.tx) * t;
  out.tz = a.tz + (b.tz - a.tz) * t;
  out.ks = a.ks + (b.ks - a.ks) * t;
  out.lane = a.lane + (b.lane - a.lane) * t;
  return out;
}

// Nearest point of the path to (x, z), searched from point index `from` over `window` points: { i, s, dist, across }
function locate(path, x, z, from = 0, window = 60) {
  const { pts } = path;
  let best = { i: from, s: pts[from]?.s ?? 0, dist: Infinity, across: 0 };
  const i0 = Math.max(0, from - 6);
  const i1 = Math.min(pts.length - 1, from + window);
  for (let i = i0; i < i1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const L2 = ex * ex + ez * ez || 1e-9;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist - 1e-6) {
      const L = Math.sqrt(L2);
      best = { i, s: a.s + t * L, dist: d, across: ((x - px) * -ez + (z - pz) * ex) / L };
    }
  }
  if (pts.length === 1) best = { i: 0, s: 0, dist: Math.hypot(x - pts[0].x, z - pts[0].z), across: 0 };
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// Steering & speed
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Steering input (-1 right .. 1 left) to bring a car at (x, z) heading h at speed v round to (tx, tz): pure pursuit,
 * the curvature through the target turned into the steering angle that gives it at this speed.
 */
function pursuitSteer(x, z, heading, speed, tx, tz) {
  const dx = tx - x;
  const dz = tz - z;
  const Ld = Math.hypot(dx, dz);
  if (Ld < 0.05) return 0;
  const alpha = wrapAngle(Math.atan2(dx, dz) - heading);
  const v = Math.abs(speed);
  // the wheel angle whose arc runs through the target, as a share of what the car allows at this speed
  const curvature = (2 * Math.sin(alpha)) / Ld;
  const steer = Math.atan(curvature * WHEELBASE) / maxSteerAt(v);
  return clamp(steer, -1, 1) * Math.sign(speed || 1);
}

// Throttle / brake for a speed target: forward or backward strength 0..1 (backward only brakes while moving)
// The car's pedals (controllers.js CAR_DRIVE): 4.5 m/s² flat out, less above 14.5 m/s where the engine runs out of
// power; 9 m/s² on full brakes; 0.78 m/s² of rolling and coasting drag with neither pedal down
const ACCEL = 4.5;
const POWER_SPEED = 14.5;
const FULL_BRAKE = 9;
const COAST = 0.78;

/**
 * Throttle / brake (forward or backward 0..1) for a speed target: the acceleration that closes the gap in about half a
 * second, no harder than `maxBrake`, turned into pedal by what the car's engine and brakes give at this speed. Feeding
 * the acceleration forward (rather than pedal in proportion to the speed error) brakes smoothly instead of in jabs.
 */
function speedControl(speed, target, maxBrake = 3, stopAccel = 0, aCap = Infinity) {
  const v = Math.max(0, speed);
  let a = clamp((target - v) * 2, -maxBrake, ACCEL);
  // (no more than what keeps it clear of the traffic it sees coming)
  if (aCap < a) a = Math.max(aCap, -FULL_BRAKE);
  // stopping at a line: the steady deceleration that stops it there (give or take), not chasing the profile's tail
  if (stopAccel < 0 && a < 0 && aCap === Infinity) a = clamp(a, Math.max(-maxBrake, stopAccel * 1.15), stopAccel * 0.9);
  // stopping: the last half metre per second rolls out on its own (a brake pedal on a standing car reverses it)
  if (target <= 0.3 && v < 0.6) return { forward: 0, backward: 0 };
  if (a > 0.05 || (a > -COAST && v > 0.3)) {
    const available = ACCEL * Math.min(1, POWER_SPEED / Math.max(POWER_SPEED, v));
    return { forward: clamp((a + 0.18 + 0.0012 * v * v) / available, 0.02, 1), backward: 0 };
  }
  if (v < 0.05 && target > 0.05) return { forward: 0, backward: 0 };
  if (a > -COAST) return { forward: 0, backward: 0 };
  return { forward: 0, backward: clamp((-a - 0.18) / FULL_BRAKE, 0.04, 1) };
}

// Speed allowed to stop `d` metres ahead decelerating at b
const stopSpeed = (d, b) => (d <= 0 ? 0 : Math.sqrt(2 * b * d));

// ---------------------------------------------------------------------------------------------------------------------
// The navigator
// ---------------------------------------------------------------------------------------------------------------------

class Navigator {
  /**
   * @param {object} deps network (road-network.js), trafficSystem (cars, buses, peds), controllerManager, audioSystem,
   *   and onChange(state) / onEvent(kind, detail) callbacks for the HUD
   */
  constructor({ network, trafficSystem, islandTraffic = null, controllerManager, audioSystem = null, onChange = null, onEvent = null, resolveNetwork = null }) {
    this.network = network;
    this.resolveNetwork = resolveNetwork;
    this.traffic = trafficSystem;
    // the island's main-road traffic (js/island-traffic.js), seen through stand-ins shaped like the city's vehicles
    this.island = islandTraffic;
    this.islandProxies = new WeakMap();
    this.islandList = [];
    this.controllers = controllerManager;
    this.audio = audioSystem;
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.driver = DRIVERS.you;
    this.destination = null; // { x, z, name }
    this.path = null;
    this.progress = 0; // metres along the path
    this.index = 0; // its point index
    this.offRouteTime = 0;
    this.lastReroute = -Infinity;
    this.time = 0;
    this.arrived = false;
    // autopilot state
    this.offset = 0; // metres right of the path (Crazy Taxi swerving)
    this.offsetTarget = 0;
    this.swerveHold = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.lastSpeed = 0;
    this.status = '';
    this.input = { forward: 0, backward: 0, left: 0, right: 0 };
    this.honkTimer = 0;
    // Crazy Taxi
    this.fare = null; // { start, base, bonus, timeLeft, nearMisses, combo, crashes }
    this.nearMissSeen = new WeakMap();
    this.nextFareAt = 0;
    this._pt = {};
    this._pk = {};
    this._ph = {};
    this._pe = {};
    this.tracker = new Tracker();
    this.evadeHold = 0;
    this.evadeOffset = 0;
    this.threat = null;
    this.leadObj = null;
    this.holdLane = null;

    this.line = null;
    this.lineAcc = 1;
  }

  get active() { return Boolean(this.destination); }

  /** Drive on another road graph (the city's joined with the island's, once those load): a trip on the go replans */
  setNetwork(network) {
    this.network = network;
    if (this.destination && !this.arrived) this.reroute(true);
  }
  get autopilot() { return this.active && this.driver.auto && !this.arrived && this.controllers.activeMode === 'car'; }

  setDriver(id) {
    const d = DRIVERS[id] || DRIVERS.you;
    if (d === this.driver) return;
    this.driver = d;
    this.offset = this.offsetTarget = 0;
    this.line = null;
    this.stuckTime = this.reverseTime = 0;
    if (!d.auto) this.controllers.setAutopilotInput(null);
    if (d.id === 'crazy' && this.destination && !this.arrived) this.startFare();
    if (d.id !== 'crazy') this.fare = null;
    if (this.destination && !this.arrived) this.reroute(true);
    this.changed();
  }

  /** Plan a trip to (x, z) from where the player is; false if no road leads there */
  setDestination(x, z, name = '') {
    this.destination = { x, z, name };
    this.arrived = false;
    this.nextFareAt = 0;
    const ok = this.reroute(true);
    if (!ok) {
      this.destination = null;
      this.path = null;
      this.controllers.setAutopilotInput(null);
      this.changed();
      this.event('noroute', { name });
      return false;
    }
    if (this.driver.id === 'crazy') this.startFare();
    this.changed();
    return true;
  }

  clear() {
    this.destination = null;
    this.path = null;
    this.fare = null;
    this.arrived = false;
    this.controllers.setAutopilotInput(null);
    this.changed();
  }

  reroute(force = false) {
    if (!this.destination) return false;
    if (!force && this.time - this.lastReroute < 1.5) return Boolean(this.path);
    this.lastReroute = this.time;
    const ent = this.controllers.getActiveEntity();
    const start = { x: ent.position.x, z: ent.position.z, heading: ent.heading };
    // (the road graph for this trip: the app may join the island's roads to the city's the first time one needs them)
    if (this.resolveNetwork) this.network = this.resolveNetwork(start, this.destination) || this.network;
    const route = planRoute(this.network, start, this.destination, this.driver.auto ? this.driver : DRIVERS.self);
    if (!route) return false;
    this.path = buildPath(this.network, route, ent.position.x, ent.position.z, this.driver.auto ? this.driver : DRIVERS.self);
    this.index = 0;
    this.progress = 0;
    this.offRouteTime = 0;
    this.offset = this.offsetTarget = 0;
    this.line = null;
    if (this.fare && !force) this.fare.reroutes++;
    this.changed();
    return true;
  }

  startFare() {
    const len = this.path ? this.path.length : 1000;
    this.fare = {
      // a Singapore taxi's flag-down, a fare by the kilometre (fareTotal), and the clock: the trip at a brisk 15 m/s
      base: 4.1, distance: 0, bonus: 0, timeLeft: Math.round(len / 15 + 12),
      nearMisses: 0, combo: 0, comboTimer: 0, crashes: 0, reroutes: 0, total: 0, tip: 0
    };
  }

  changed() { if (this.onChange) this.onChange(this.state()); }
  event(kind, detail = {}) { if (this.onEvent) this.onEvent(kind, detail); }

  /** For the HUD: the next maneuver, distances, the driver, the fare */
  state() {
    const path = this.path;
    const remaining = path ? Math.max(0, path.length - this.progress) : 0;
    let next = null;
    if (path) {
      for (const mv of path.maneuvers) {
        if (mv.s < this.progress - 2) continue;
        if (mv.turn === 'S' && !mv.uturn) continue;
        next = { kind: mv.uturn ? 'uturn' : Math.abs(mv.cross) < 0.75 ? (mv.turn === 'L' ? 'keepleft' : 'keepright') : mv.turn === 'L' ? 'left' : 'right', name: mv.name, distance: Math.max(0, mv.s - this.progress) };
        break;
      }
      if (!next || next.distance > remaining) next = { kind: 'arrive', name: this.destination?.name || '', distance: remaining };
    }
    const ent = this.controllers.getActiveEntity();
    const speed = Math.max(Math.abs(ent?.speed || 0), this.driver.id === 'crazy' ? 16 : 9);
    return {
      active: this.active,
      arrived: this.arrived,
      driver: this.driver.id,
      driverLabel: this.driver.label,
      destination: this.destination,
      remaining,
      eta: remaining / speed,
      next,
      status: this.status,
      autopilot: this.autopilot,
      carMode: this.controllers.activeMode === 'car',
      fare: this.fare ? { ...this.fare, total: this.fareTotal() } : null,
      route: path ? this.routeLine() : null
    };
  }

  fareTotal() {
    const f = this.fare;
    if (!f) return 0;
    return f.base + (f.distance / 1000) * 2.2 + f.bonus;
  }

  // The rest of the route as a polyline for the maps (every few metres)
  routeLine() {
    const pts = this.path.pts;
    const out = [];
    const ent = this.controllers.getActiveEntity();
    out.push({ x: ent.position.x, z: ent.position.z });
    let lastS = -Infinity;
    for (let i = this.index + 1; i < pts.length; i++) {
      if (pts[i].s - lastS < 6 && i < pts.length - 1) continue;
      lastS = pts[i].s;
      out.push({ x: pts[i].x, z: pts[i].z });
    }
    return out;
  }

  /** The vehicles it knows of: the city's cars and buses, and the island traffic's (as stand-ins) */
  vehicleLists() {
    return [this.traffic.cars, this.traffic.buses, this.islandList];
  }

  /**
   * The stand-in for island car `c`: the same object every frame (the tracker keys its tracks by it), shaped like the
   * city's vehicles ({ edge, x, z, tx, tz, half, halfWidth, speed }; edge null while the car is out of play)
   */
  islandProxy(c) {
    let p = this.islandProxies.get(c);
    if (!p) this.islandProxies.set(c, (p = { island: c, edge: null, x: 0, z: 0, tx: 0, tz: 1, half: 2.3, halfWidth: 0.9, speed: 0 }));
    return p;
  }

  // Refresh the island traffic's stand-ins: those within sight, in play
  seeIsland() {
    const cars = this.island?.cars;
    const list = this.islandList;
    list.length = 0;
    if (!cars) return;
    const ent = this.controllers.getActiveEntity();
    const ex = ent.position.x;
    const ez = ent.position.z;
    for (const c of cars) {
      const p = this.islandProxy(c);
      if (!c.active) {
        p.edge = null;
        continue;
      }
      if (Math.abs(c.x - ex) > 160 || Math.abs(c.z - ez) > 160) continue;
      p.edge = ISLAND_EDGE;
      p.x = c.x;
      p.z = c.z;
      p.tx = c.dx;
      p.tz = c.dz;
      p.speed = c.v;
      list.push(p);
    }
  }

  /**
   * The line it means to drive over the next `ahead` metres (every `step`), on the lane change or swerve it is making:
   * [{ x, z }], for the perception overlay
   */
  planPreview(ahead = 60, step = 3) {
    if (!this.path || !this.autopilot) return [];
    const ent = this.controllers.getActiveEntity();
    const speed = Math.max(1, Math.abs(ent.speed));
    const out = [{ x: ent.position.x, z: ent.position.z }];
    const q = {};
    for (let d = step; d <= ahead && this.progress + d <= this.path.length; d += step) {
      pointAt(this.path, this.progress + d, this.lineAt(d / speed).y, q);
      out.push({ x: q.x, z: q.z });
    }
    return out;
  }

  /**
   * The lanes' line as mapped, before it was smoothed into the one the car drives (buildPath), over the next `ahead`
   * metres: for the overlay to draw faintly beside planPreview()
   */
  mappedPreview(ahead = 60) {
    const path = this.path;
    if (!path || !this.autopilot || !path.mapped) return [];
    const out = [];
    const { pts, mapped } = path;
    for (let i = Math.max(0, this.index); i < pts.length && pts[i].s <= this.progress + ahead; i++) {
      if (pts[i].s < this.progress - 3) continue;
      out.push({ x: mapped[i * 2], z: mapped[i * 2 + 1] });
    }
    return out;
  }

  /** Call before controllerManager.update: follow the route, drive it when an autopilot is on */
  update(dt, elapsed) {
    this.time += dt;
    if (!this.destination) return;
    const ent = this.controllers.getActiveEntity();
    const mode = this.controllers.activeMode;
    const x = ent.position.x;
    const z = ent.position.z;

    // Crazy Taxi: next fare after a pause at the drop-off
    if (this.arrived) {
      // pull up at the drop-off, then hand the car back
      const braking = this.driver.auto && mode === 'car' && ent.speed > 0.3 && this.controllers.userDriveInput() < 0.15;
      this.controllers.setAutopilotInput(braking ? { forward: 0, backward: 0.7, left: 0, right: 0 } : null);
      if (this.nextFareAt && this.time >= this.nextFareAt) {
        this.nextFareAt = 0;
        this.event('nextfare', {});
      }
      return;
    }
    if (!this.path) {
      this.reroute();
      return;
    }

    // Where along the route the player is
    const loc = locate(this.path, x, z, this.index, 40);
    if (loc.dist < 30) {
      this.index = loc.i;
      this.progress = loc.s;
    }
    const offLimit = this.driver.offRoute + Math.abs(this.offset);
    this.offRouteTime = loc.dist > offLimit ? this.offRouteTime + dt : 0;
    if (this.offRouteTime > (this.driver.auto ? 0.6 : 1.2)) {
      this.offRouteTime = 0;
      if (this.reroute()) this.event('reroute', {});
      return;
    }

    // Arrival
    const end = this.path.pts[this.path.pts.length - 1];
    const toEnd = this.path.length - this.progress;
    const nearEnd = Math.hypot(end.x - x, end.z - z);
    if ((toEnd < 6 && nearEnd < 9 && Math.abs(ent.speed) < (this.driver.auto ? 1.2 : 4)) || (!this.driver.auto && nearEnd < 14)) {
      this.arrive();
      return;
    }

    if (this.fare) this.updateFare(dt, ent);

    if (!this.driver.auto) return;
    if (mode !== 'car') {
      this.status = 'Switch to the car to let it drive';
      this.controllers.setAutopilotInput(null);
      return;
    }
    // Taking over: any throttle, brake or steering of your own
    if (this.controllers.userDriveInput() > 0.15) {
      this.setDriver('you');
      this.event('takeover', {});
      return;
    }
    // what it sees around it
    this.seeIsland();
    this.tracker.update(dt, [this.traffic.cars, this.traffic.buses, this.islandList, this.traffic.peds], ent);
    this.drive(dt, elapsed, ent);
  }

  arrive() {
    this.arrived = true;
    this.status = '';
    const fare = this.fare ? { ...this.fare, total: this.fareTotal() } : null;
    if (fare) {
      // a tip for the time left on the clock
      fare.tip = Math.max(0, fare.timeLeft) * 0.25;
      fare.total += fare.tip;
      this.fare.total = fare.total;
      this.nextFareAt = this.time + 4.5;
    }
    this.event('arrived', { name: this.destination?.name || '', fare });
    if (this.audio && this.audio.chime) this.audio.chime('erp');
    this.changed();
  }

  updateFare(dt, ent) {
    const f = this.fare;
    f.timeLeft = Math.max(0, f.timeLeft - dt);
    f.distance += Math.abs(ent.speed) * dt;
    f.comboTimer -= dt;
    if (f.comboTimer <= 0) f.combo = 0;
    // a crash: most of the speed gone in a moment
    const dv = this.lastSpeed - Math.abs(ent.speed);
    // (braking takes at most 9 m/s² x 0.05 s off in a frame)
    if (dv > 6 && this.lastSpeed > 9) {
      f.crashes++;
      f.combo = 0;
      f.bonus = Math.max(0, f.bonus - 1);
      this.event('crash', {});
    }
    this.lastSpeed = Math.abs(ent.speed);
    // near misses: passing another vehicle within a hand's breadth, fast
    const hx = Math.sin(ent.heading);
    const hz = Math.cos(ent.heading);
    for (const list of this.vehicleLists()) {
      if (!list) continue;
      for (const v of list) {
        if (!v.edge) continue;
        const dx = v.x - ent.position.x;
        const dz = v.z - ent.position.z;
        if (Math.abs(dx) > 9 || Math.abs(dz) > 9) continue;
        const along = dx * hx + dz * hz;
        const across = Math.abs(-dx * hz + dz * hx);
        const relSpeed = Math.abs(ent.speed - (v.speed || 0) * ((v.tx ?? 0) * hx + (v.tz ?? 1) * hz));
        const clearance = across - (v.halfWidth || 0.9) - CAR_HALF_W;
        if (Math.abs(along) < (v.half || 2.3) + CAR_HALF_L && clearance > 0.05 && clearance < 1.4 && relSpeed > 7) {
          const seen = this.nearMissSeen.get(v);
          if (seen && this.time - seen < 3) continue;
          this.nearMissSeen.set(v, this.time);
          f.nearMisses++;
          f.combo++;
          f.comboTimer = 3;
          const award = Math.min(5, f.combo) * 0.5;
          f.bonus += award;
          f.timeLeft += 1;
          this.event('nearmiss', { combo: f.combo, award });
        }
      }
    }
  }

  // ---- autopilot ----------------------------------------------------------------------------------------------------

  drive(dt, elapsed, car) {
    const d = this.driver;
    const path = this.path;
    const x = car.position.x;
    const z = car.position.z;
    const v = car.speed;
    const speed = Math.max(0, v);
    const s = this.progress;
    this.honkTimer -= dt;

    // Stuck against something (a kerb, a bollard, a car that won't move): back off a little, then try again
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      const target = pointAt(path, s + 8, this.offset, this._pt);
      const steer = -pursuitSteer(x, z, car.heading, 2, target.x, target.z);
      // (backing off at a walking pace: reverse up to 2.5 m/s, braking beyond)
      this.setInput(v < -2.6 ? 0.3 : 0, v > -2.4 ? 0.5 : 0, steer);
      this.status = 'Backing up';
      return;
    }

    // 1. Speed: the path's profile (a little ahead, so curves are met slowed down), then whatever is in the way
    let vTarget = Infinity;
    for (let ahead = 0; ahead <= speed * 0.5 + 2; ahead += 1.5) vTarget = Math.min(vTarget, pointAt(path, Math.min(path.length, s + ahead), 0, this._pt).vMin);
    let reason = '';
    // the braking it needs: what stopping where it must (a line, behind a car) takes, at least its comfortable rate
    let need = 0;
    let stopAccel = 0; // the steady deceleration that stops it at the line it is stopping for (when it is)

    // Signals
    if (d.signals) {
      for (const st of path.stops) {
        const dist = st.s - s - CAR_HALF_L - 0.8;
        if (dist < -2) continue;
        if (dist > Math.max(90, (speed * speed) / (2 * d.brake) + 30)) break;
        const phase = st.edge.phaseAt ? st.edge.phaseAt(elapsed) : signalPhase(elapsed, st.edge.axisIndex === 0);
        if (phase === 'green') continue;
        // amber: go on if it's too late to stop comfortably
        if (phase === 'amber' && speed * speed > 2 * d.brake * 1.6 * Math.max(0, dist)) continue;
        const vs = stopSpeed(dist, d.brake);
        if (vs < vTarget) {
          vTarget = vs;
          reason = phase === 'red' ? 'Red light' : 'Amber light';
          need = Math.max(need, (speed * speed) / (2 * Math.max(0.5, dist)));
          stopAccel = -(speed * speed) / (2 * Math.max(0.3, dist));
        }
        break;
      }
    }

    // Vehicles (and people) on the path ahead, at the current swerve offset
    // (at the line it's steering for and where the car actually is, which lags it during a lane change)
    const across = locate(path, x, z, this.index, 8).across;
    // (looking as far ahead as it takes to stop, and a car's following distance more)
    const range = Math.max(70, (speed * speed) / (2 * d.brake) + d.gap0 + speed * d.gapTime + 10);
    const leadA = this.leadOnPath(s, this.offset, range, d.margin);
    const leadB = Math.abs(across - this.offset) > 0.6 ? this.leadOnPath(s, across, range, d.margin) : null;
    const lead = leadB && (!leadA || leadB.gap < leadA.gap) ? leadB : leadA;
    this.leadObj = lead && !lead.oncoming && !lead.ped ? lead.obj : null; // (for the overlay: the car it follows)
    // (a car coming the other way in its lane is no car to follow: getting out of its way is 2b's)
    if (lead && !lead.oncoming) {
      // edging out round it (the car still behind it, steering for the other lane): creep up to a metre short
      const gap0 = lead === leadB ? 1.0 : d.gap0;
      const eff = lead.gap - gap0 - lead.speed * d.gapTime;
      const vl = eff >= 0 ? Math.sqrt(lead.speed * lead.speed + 2 * d.brake * eff) : Math.max(0, lead.speed + eff * 0.6);
      if (vl < vTarget) {
        vTarget = vl;
        reason = lead.ped ? 'Waiting for pedestrians' : 'Following traffic';
        if (lead.speed < speed) need = Math.max(need, (speed * speed - lead.speed * lead.speed) / (2 * Math.max(0.5, lead.gap - gap0)));
        stopAccel = lead.speed < 0.5 && eff > 0 ? -(speed * speed) / (2 * Math.max(0.3, eff)) : 0;
      }
    }

    // Pinned behind a vehicle that isn't moving (a jam, a stalled car), and not for a red light: how long for
    this.blockedTime = lead && !lead.ped && lead.gap < 12 && lead.speed < 0.3 && speed < 0.6 && reason === 'Following traffic' ? (this.blockedTime || 0) + dt : 0;

    // 2. Lane choice (left to the swerve while it is getting out of the way of something, see 2b)
    const evading = this.evadeHold > 0;
    let holding = null;
    // Crazy Taxi: anything slower ahead gets passed, on whichever side is free
    if (evading) {
      // (2b holds the line)
    } else if (d.id === 'crazy') {
      this.swerveHold -= dt;
      // nose against a stopped car: reverse out and try another line
      if (this.blockedTime > 1.5) {
        this.blockedTime = 0;
        this.reverseTime = clamp((10 - lead.gap) / 3, 0.6, 2.2);
        const choice = this.findGap(s, 0);
        if (choice !== null) this.offsetTarget = choice;
        this.swerveHold = 2;
        this.honk(car);
      }
      const blocked = lead && lead.gap < 32 && vTarget < Math.min(d.cruise, pointAt(path, s + 10, 0, this._pt).v) - 3;
      if (blocked) {
        // (the line it is already moving over to, while that stays clear; else the nearest free one)
        const keep = Math.abs(this.offsetTarget) > 0.1 && this.lineClear(s, this.offsetTarget, 2, clamp(14 + speed * 1.2, 18, 45));
        const choice = keep ? this.offsetTarget : this.findGap(s, speed);
        if (choice !== null && choice !== this.offsetTarget) {
          this.offsetTarget = choice;
          this.swerveHold = 1.6;
          this.honk(car);
        } else if (choice === null) {
          this.honk(car);
        }
        if (choice !== null) {
          // the new line is clear: no need to slow for the old one
          const lead2 = this.leadOnPath(s, choice, 70, d.margin);
          const eff2 = lead2 ? lead2.gap - d.gap0 : Infinity;
          vTarget = Math.max(vTarget, Math.min(pointAt(path, s + speed * 0.35, 0, this._pt).v, eff2 === Infinity ? Infinity : Math.sqrt(2 * d.brake * Math.max(0, eff2))));
          reason = 'Overtaking';
        }
      } else if (this.offsetTarget !== 0 && this.swerveHold <= 0 && this.lineClear(s, 0, 4, 26)) {
        this.offsetTarget = 0;
      }
      this.lineAcc = d.laneAcc;
    } else {
      // Self-driving: the route moves over a lane (for a turn ahead) where a car is alongside in that lane: keep to the
      // lane it is in until there is a gap, dropping back behind the car if the turn comes first
      holding = this.holdLaneChange(s, speed, dt);
      if (holding) {
        if (holding.vMax < vTarget) {
          vTarget = holding.vMax;
          reason = 'Waiting to change lanes';
        }
      }

      // Self-driving: overtake slow traffic in another lane of the same road going the same way, where there's one, and
      // be back in the path's lane well before the next turn
      this.swerveHold -= dt;
      const here = path.pts[this.index];
      const nextTurn = path.maneuvers.find((mv) => mv.s > s && (mv.turn !== 'S' || mv.uturn));
      // (and none in the last stretch before the drop-off)
      const turnSoon = (nextTurn && nextTurn.s - s < 70) || path.length - s < 90;
      const lanes = here && here.edge ? here.edge.lanes.map((o) => o - here.lane).filter((o) => Math.abs(o) > 0.5) : [];
      // slow for the road, not just slower than its cruise (a car slowing for a corner the taxi would slow for too isn't);
      // and not on or just out of a bend
      let roadSpeed = d.cruise;
      let bendy = Math.abs(car.angularVel || 0) > 0.06;
      for (let i = this.index; i < path.pts.length && path.pts[i].s - s < 40; i++) {
        roadSpeed = Math.min(roadSpeed, path.pts[i].v);
        if (path.pts[i].k > 0.01) bendy = true;
      }
      const slowAhead = lead && !lead.ped && lead.gap < 30 && !bendy && lead.speed < Math.max(4, roadSpeed) * 0.6;
      // stuck behind a stopped vehicle (not a red light) for a while: go round it, oncoming lanes too when they're clear
      const stalled = this.blockedTime > 8;
      if (holding) {
        // (the hold sets the offset)
      } else if ((stalled || (!turnSoon && slowAhead)) && this.swerveHold <= 0 && Math.abs(this.offsetTarget) < 0.5) {
        const options = stalled ? [...new Set([...lanes, -3.4, 3.4])] : lanes;
        options.sort((a, b) => Math.abs(a) - Math.abs(b));
        const free = options.find((o) => this.lineClear(s, o, -6, stalled ? 25 : 40));
        if (free !== undefined) {
          this.offsetTarget = free;
          this.swerveHold = stalled ? 2.5 : 4;
          this.blockedTime = 0;
          reason = stalled ? 'Going round a stalled car' : 'Changing lanes';
          // too close to steer round it: back off a little first
          if (stalled && lead.gap < 9) this.reverseTime = clamp((10 - lead.gap) / 2.2, 0.8, 3);
        }
      } else if (this.offsetTarget !== 0 && this.swerveHold <= 0 && (turnSoon || !lanes.some((o) => Math.abs(o - this.offsetTarget) < 0.5) || this.lineClear(s, 0, -6, 30))) {
        if (this.lineClear(s, 0, -6, 20)) {
          this.offsetTarget = 0;
          this.swerveHold = 3;
        }
      }
      // the slower traffic stops holding it up only once it's actually in the other lane
      if (Math.abs(this.offsetTarget) > 0.1 && Math.abs(this.offsetTarget - this.offset) < 1.2 && Math.abs(this.offsetTarget - across) < 1.0) {
        const lead2 = this.leadOnPath(s, this.offsetTarget, 70, d.margin);
        if (!lead2 || lead2.gap > (lead?.gap ?? 0)) {
          const eff2 = lead2 ? lead2.gap - d.gap0 - lead2.speed * d.gapTime : Infinity;
          vTarget = Math.max(vTarget, Math.min(pointAt(path, s + speed * 0.35, 0, this._pt).v, eff2 === Infinity ? Infinity : Math.sqrt((lead2.speed ** 2) + 2 * d.brake * Math.max(0, eff2))));
        }
      }
      this.lineAcc = d.laneAcc;
    }

    // 2b. What it sees coming: the traffic and people around it, predicted ahead, against what it plans to do
    const aPlan = clamp((vTarget - speed) * 2, -9, ACCEL);
    // (the car it is following and the line it is stopping at are its following's to deal with: left out, and the plan
    // stops where it would)
    const stopAt = reason === 'Red light' || reason === 'Amber light' ? s + Math.max(0, vTarget * vTarget / (2 * d.brake)) + 0.5 : Infinity;
    const evade = this.avoid(s, speed, across, aPlan, dt, reason === 'Following traffic' && lead && !lead.oncoming ? lead.obj : null, stopAt);
    let aCap = Infinity;
    // (a braking it chose to keep clear is kept up a moment: let off as soon as the plan looks clear and it may well not
    // be any more)
    this.brakeHold = Math.max(0, (this.brakeHold || 0) - dt);
    if (evade) {
      this.brakeA = evade.a;
      this.brakeHold = 0.6;
    }
    if (this.brakeHold > 0) aCap = this.brakeA;
    if (evade) {
      if (evade.offset !== undefined) {
        this.evadeOffset = evade.offset;
        this.evadeHold = 1.2;
      }
      reason = evade.reason;
    }
    if (this.evadeHold > 0) {
      // (holding the line it swerved to a moment, whatever the lane logic above wanted)
      this.evadeHold -= dt;
      this.offsetTarget = this.evadeOffset;
      this.lineAcc = d.safety.latAcc;
      if (this.evadeHold <= 0 && d.id !== 'crazy') this.swerveHold = 0;
    }
    // over to the line it wants, as a smooth manoeuvre (unless a held lane change sets the line itself)
    if (holding) this.line = null;
    else this.updateLine(dt);

    // 3. Steering, from where the car will be once its steering and yaw catch up with the wheel (controllers.js eases
    //    both, ~0.2 s): the wheel angle the path's curvature there needs, plus corrections for the heading and for how
    //    far the car is off its line (a Stanley controller). Pure pursuit cut tight corners and ran wide out of them.
    const yawRate = car.angularVel || 0;
    const tau = d.steerLag ?? STEER_LAG;
    const mid = car.heading + yawRate * tau * 0.5;
    const hp = car.heading + yawRate * tau;
    const px = x + Math.sin(mid) * v * tau;
    const pz = z + Math.cos(mid) * v * tau;
    const sRef = Math.min(path.length, s + Math.max(0, v) * tau + (d.steerPreview ?? 1.4)); // about the front axle
    // the line as it will be once the steering has caught up (the moment its error is measured at)
    const lineAhead = this.lineAt(tau);
    const ref = pointAt(path, sRef, lineAhead.y, this._pt);
    // the curvature over the next couple of metres (an offset line turns tighter on the inside of a bend)
    let kRef = 0;
    const win = d.curveWindow ?? [-1.5, 0, 1.5, 3];
    // (looked for a little further on the faster it goes: a bend's curvature is fed in as the car reaches it, not after)
    const kLead = Math.abs(v) * (d.curveLead ?? 0.15);
    for (const ds of win) kRef += pointAt(path, clamp(sRef + ds + kLead, 0, path.length), 0, this._pk).ks;
    kRef /= win.length;
    kRef = kRef / Math.max(0.3, 1 + lineAhead.y * kRef);
    // and the turning the manoeuvre across itself takes (moving right turns right: lower curvature)
    if (Math.abs(v) > 2) kRef -= lineAhead.a / (v * v);
    const crossErr = (px - ref.x) * -ref.tz + (pz - ref.z) * ref.tx; // right of the line
    // moving across to a new line (overtaking, back in): head across at the rate the line moves (to the right lowers
    // the heading)
    const offRate = lineAhead.v;
    const headingErr = wrapAngle(Math.atan2(ref.tx, ref.tz) - Math.atan2(offRate, Math.max(2, Math.abs(v))) - hp);
    const delta = Math.atan(WHEELBASE * kRef) + headingErr * d.steerHeading + Math.atan((d.steerCross * crossErr) / (Math.abs(v) + 1.5));
    const target = ref;
    const steer = clamp(delta / maxSteerAt(Math.abs(v)), -1, 1) * (v < -0.2 ? -1 : 1);
    // still turning hard (out of a corner): no faster than the grip allows for the turn it is actually making
    if (Math.abs(yawRate) > 0.05) vTarget = Math.min(vTarget, Math.max(speed, Math.min(d.aLat, GRIP * 0.8) / Math.abs(yawRate)));
    // far off line (just started, after a shove): aim back for it before speeding on
    const heading = Math.atan2(target.x - x, target.z - z);
    const misalign = Math.abs(wrapAngle(heading - car.heading));
    if (misalign > 1.2) vTarget = Math.min(vTarget, 4);
    else if (misalign > 0.6) vTarget = Math.min(vTarget, 8);

    // 4. Stuck?
    const wantsToGo = vTarget > 2 && aCap > -0.5;
    this.stuckTime = wantsToGo && speed < 0.6 ? this.stuckTime + dt : 0;
    if (this.stuckTime > (d.id === 'crazy' ? 1.0 : 2.2)) {
      this.stuckTime = 0;
      this.reverseTime = d.id === 'crazy' ? 0.9 : 1.4;
      if (d.id === 'crazy') this.honk(car);
    }

    const pedal = speedControl(v, vTarget, clamp(need * 1.15, d.brake * (d.id === 'crazy' ? 1.25 : 1.4), d.hardBrake), reason === 'Red light' || reason === 'Amber light' || reason === 'Following traffic' ? stopAccel : 0, aCap);
    this.setInput(pedal.forward, pedal.backward, steer);
    this.status = reason;
  }

  /**
   * The line it keeps to across the path: a smooth manoeuvre (half a cosine) from where the line was to offsetTarget,
   * taking as long as moving that far at a peak sideways acceleration of this.lineAcc does. Sets this.offset to where
   * the line is now.
   */
  updateLine(dt) {
    const target = this.offsetTarget;
    const acc = Math.max(0.3, this.lineAcc || 1);
    const m = this.line;
    if (!m || Math.abs(m.to - target) > 0.02 || (m.acc < acc - 0.01 && m.t < m.T)) {
      // a new manoeuvre from where the line is, at least as fast as it is already moving across
      const from = this.offset;
      const dy = Math.abs(target - from);
      this.line = { from, to: target, acc, t: 0, T: dy < 0.02 ? 0 : Math.PI * Math.sqrt(dy / (2 * acc)) };
    }
    this.line.t = Math.min(this.line.T, this.line.t + dt);
    this.offset = this.lineAt(0).y;
  }

  /** The line `ahead` s from now: { y (m right of the path), v (m/s across), a (m/s² across) } */
  lineAt(ahead = 0) {
    const m = this.line;
    if (!m || m.T <= 0) return { y: m ? m.to : this.offset, v: 0, a: 0 };
    const t = Math.min(m.T, m.t + ahead);
    const dy = m.to - m.from;
    const w = Math.PI / m.T;
    return {
      y: m.from + (dy * (1 - Math.cos(w * t))) / 2,
      v: t < m.T ? (dy * w * Math.sin(w * t)) / 2 : 0,
      a: t < m.T ? (dy * w * w * Math.cos(w * t)) / 2 : 0
    };
  }

  /**
   * Seeing the traffic coming. Rolls the car forward along its path (from where it is across it, moving over to the line
   * it is steering for) at the acceleration it means to drive with, and checks the predicted traffic and people against
   * it (perception.js). Clear: null. Otherwise the mildest change that keeps clear: a gentler acceleration or braking
   * (up to the driver's comfort), else a swerve to another line with as little braking as will do (self-driving keeps to
   * its own side of the road unless nothing else works; Crazy Taxi swerves first and anywhere), else full brakes.
   * Returns { a: acceleration cap, offset?: line to swerve to, reason }.
   */
  avoid(s, speed, across, aPlan, dt, followed = null, stopAt = Infinity) {
    const d = this.driver;
    const sf = d.safety;
    const tracks = this.tracker.tracks;
    if (!sf || !tracks.size) return (this.threat = null);
    const path = this.path;
    const pe = this._pe;
    // (people predicted to stay on the pavement are none of its business)
    const onSidewalk = this.network.onSidewalk;
    const ignore = onSidewalk ? (tr, p) => tr.ped && onSidewalk(p.x, p.z) : null;
    const opts = { horizon: sf.horizon, step: 0.1, clearance: sf.clearance, growth: sf.growth, pedClearance: sf.pedClearance, skip: followed ? (tr) => tr.obj === followed : null, ignore };
    const vmax = Math.max(speed, d.cruise);
    // (speeding up no faster than the engine manages at this speed)
    // (less the rolling resistance and the air)
    const aEngine = Math.max(0, ACCEL * Math.min(1, POWER_SPEED / Math.max(POWER_SPEED, speed + 2)) - 0.18 - 0.0012 * speed * speed);
    // across the road: on the line's manoeuvre it is already making (for its own line), else a new one to off1 at
    // `latAcc` (less the harder it brakes: the tyres share their grip), starting once the steering has caught up
    const lag = 0.2;
    const offAt = (off1, latAcc, a, t) => {
      if (Math.abs(off1 - this.offsetTarget) < 0.02) return this.lineAt(t).y + (across - this.offset) * Math.max(0, 1 - t / 2);
      const acc = Math.max(0.5, Math.min(latAcc, Math.sqrt(Math.max(0, GRIP * GRIP - a * a)) * 0.7));
      const dy = off1 - across;
      const T = Math.PI * Math.sqrt(Math.abs(dy) / (2 * acc));
      const tt = Math.max(0, Math.min(T, t - lag));
      return across + (dy * (1 - Math.cos((Math.PI * tt) / Math.max(1e-6, T)))) / 2;
    };
    const plan = (a0, off1, latAcc) => (t) => {
      const a = Math.min(a0, aEngine);
      // speed under a constant acceleration, never below 0 or above its cruise
      let dist;
      if (a < 0 && speed / -a < t) dist = (speed * speed) / (-2 * a);
      else if (a > 0 && speed + a * t > vmax) {
        const t1 = (vmax - speed) / a;
        dist = speed * t1 + 0.5 * a * t1 * t1 + vmax * (t - t1);
      } else dist = speed * t + 0.5 * a * t * t;
      dist = Math.min(dist, stopAt - s);
      // (and only as far across as it has gone along: a car standing still goes nowhere sideways)
      const off = across + clamp(offAt(off1, latAcc, a, t) - across, -0.45 * dist, 0.45 * dist);
      const q = pointAt(path, Math.min(path.length, s + dist), off, pe);
      if (s + dist > path.length + 1) return null;
      return { x: q.x, z: q.z, hx: q.tx, hz: q.tz };
    };
    const planned = firstConflict(plan(aPlan, this.offsetTarget, 0), tracks, opts);
    if (!planned) return (this.threat = null);
    this.threat = planned;
    const who = planned.track.ped ? 'a person' : 'a vehicle';

    // 1. Slow down (or speed up less) on the same line, up to the driver's comfortable braking
    for (const a of [Math.min(aPlan, 0.5), 0, -1, -2, -3, -4.5, -6, -7.5, -9]) {
      if (a > aPlan || a < -Math.min(sf.comfort, sf.maxBrake)) continue;
      if (!firstConflict(plan(a, this.offsetTarget, 0), tracks, opts)) return { a, reason: a < -2.5 ? `Braking for ${who}` : `Yielding to ${who}` };
    }

    // 2. Swerve to another line, braking as little as will do (cost: how far across, how hard it brakes)
    const pts = path.pts;
    const here = pts[this.index];
    const base = this.offsetTarget;
    const lines = new Set();
    // (and a lane over either way, whichever way that is, for when nothing on its own side will do)
    for (const n of [...sf.nudges, 3.6]) {
      lines.add(base + n);
      lines.add(base - n);
    }
    // the lanes of its own road going its way
    if (here && here.edge) for (const o of here.edge.lanes) lines.add(o - here.lane);
    const clearRoad = this.network.isRoadClear;
    const swerveOpts = { ...opts, clearance: opts.clearance + 0.4 };
    let best = null;
    for (const off of lines) {
      if (Math.abs(off - base) < 0.3) continue;
      // self-driving: within the lanes going its way (and a nudge past them) unless it has no other way out
      const ownLanes = here && here.edge ? here.edge.lanes.map((o) => o - here.lane) : [0];
      const outside = off < Math.min(...ownLanes) - 1.6 || off > Math.max(...ownLanes) + 1.6;
      // the road must be there: no kerb, plaza or median along the swerve
      let onRoad = true;
      if (clearRoad) {
        for (let k = 0; k < pts.length && onRoad; k++) {
          const q = pts[this.index + k];
          if (!q || q.s - s > Math.max(12, speed * 1.5)) break;
          if (q.s < s) continue;
          if (!clearRoad(q.x + q.nx * off, q.z + q.nz * off, 1.0)) onRoad = false;
        }
      }
      if (!onRoad) continue;
      // (speeding up too, if that is what it takes: a car crawling goes nowhere sideways)
      for (const a of [Math.min(aPlan, 0), -1.5, -3, -4.5, -6, -9, aEngine]) {
        if (a > aPlan + 1e-9 && a !== Math.min(aPlan, 0) && a !== aEngine) continue;
        // (and sticking to the way out it already chose, rather than flip-flopping between two)
        const sticky = this.evadeHold > 0 ? Math.abs(off - this.evadeOffset) * 3 : 0;
        const cost = Math.abs(off - base) * sf.lateralCost + Math.abs(a) + (outside && sf.ownSide ? 40 : 0) + sticky;
        if (best && cost >= best.cost) continue;
        // (a swerve is taken only with room to spare: the car may not get across quite as the plan says)
        if (!firstConflict(plan(a, off, sf.latAcc), tracks, swerveOpts)) best = { a, offset: off, cost };
      }
    }
    // (braking alone does not keep it clear, so any line that does beats it)
    if (best) return { a: best.a, offset: best.offset, reason: `Swerving round ${who}` };

    // 3. Nothing keeps clear: everything on the brakes (on the line that puts the conflict off longest)
    return { a: -sf.maxBrake, reason: `Emergency stop for ${who}` };
  }

  /**
   * The lane change the path makes on this edge, held off while its lane is taken alongside: sets the offset that keeps
   * the car in the lane it is in, and returns { vMax } (how fast to go to drop behind the car alongside before the turn
   * the change is for), or null when there is nothing to hold.
   */
  holdLaneChange(s, speed, dt) {
    const pts = this.path.pts;
    const here = pts[this.index];
    if (!here || !here.edge) return (this.holdLane = null);
    // where the path is going on this edge
    let ahead = null;
    for (let i = this.index; i < pts.length && pts[i].s - s < 50; i++) {
      if (pts[i].edge !== here.edge) break;
      ahead = pts[i];
    }
    const lane = this.holdLane ?? here.lane + this.offset;
    if (!ahead || Math.abs(ahead.lane - lane) < 0.5) return (this.holdLane = null);
    const blocker = this.besideBlocker(ahead.lane - here.lane);
    if (!blocker) {
      // clear: merge from the held line at the usual pace (the offset unwinds to the path's)
      if (this.holdLane != null) {
        this.holdLane = null;
        this.offsetTarget = 0;
      }
      return null;
    }
    this.holdLane = lane;
    // keep the line it is in where the steering looks (a few metres on, on this edge)
    let at = here;
    for (let i = this.index; i < pts.length && pts[i].edge === here.edge; i++) {
      at = pts[i];
      if (pts[i].s >= s + 3) break;
    }
    this.offset = this.offsetTarget = lane - at.lane;
    // the change has to be done by the end of the edge: drop behind the car alongside in time
    const left = ahead.s - s + (pts.length > this.index ? 0 : 0);
    const edgeEnd = here.edge.len - ((here.x - here.edge.sx) * here.edge.dx + (here.z - here.edge.sz) * here.edge.dz);
    const room = Math.max(0, Math.min(left + 40, edgeEnd) - 25);
    const vMax = room < (speed * speed) / 2.6 + 10 ? Math.max(0, (blocker.speed || 0) - 3) : Infinity;
    return { vMax };
  }

  setInput(forward, backward, steer) {
    const i = this.input;
    i.forward = forward;
    i.backward = backward;
    i.left = steer > 0 ? steer : 0;
    i.right = steer < 0 ? -steer : 0;
    this.controllers.setAutopilotInput(i);
  }

  honk(car) {
    if (this.honkTimer > 0 || !this.audio) return;
    this.honkTimer = 1.4;
    this.audio.honk(car);
  }

  // The nearest vehicle (or pedestrian, for drivers who stop for them) on the path ahead of s at lateral offset `off`:
  // { gap (bumper to bumper), speed (along the path), ped }
  leadOnPath(s, off, range, margin) {
    const path = this.path;
    const pts = path.pts;
    const i0 = this.index;
    let best = null;
    const ent = this.controllers.getActiveEntity();
    const cx = ent.position.x;
    const cz = ent.position.z;
    const consider = (o, half, halfWidth, speed, tx, tz, ped) => {
      if (Math.abs(o.x - cx) > range + 10 || Math.abs(o.z - cz) > range + 10) return;
      for (let i = i0; i < pts.length; i++) {
        const p = pts[i];
        const ahead = p.s - s;
        if (ahead > range) break;
        if (ahead < -3) continue;
        const px = p.x + p.nx * off;
        const pz = p.z + p.nz * off;
        const dx = o.x - px;
        const dz = o.z - pz;
        const along = dx * p.tx + dz * p.tz;
        if (Math.abs(along) > SAMPLE) continue;
        const across = Math.abs(dx * p.nx + dz * p.nz);
        if (across > halfWidth + CAR_HALF_W + margin) continue;
        const gap = ahead + along - half - CAR_HALF_L;
        if (gap < -CAR_HALF_L * 1.5) return; // beside or behind us
        if (!best || gap < best.gap) best = { gap, speed: Math.max(0, speed * (tx * p.tx + tz * p.tz)), ped, obj: o, oncoming: speed > 1 && tx * p.tx + tz * p.tz < -0.3 };
        return;
      }
    };
    for (const list of this.vehicleLists()) {
      if (!list) continue;
      for (const v of list) {
        if (!v.edge) continue;
        // its speed and direction as seen (perception.js), not read off it
        const tr = this.tracker.get(v);
        if (tr) consider(v, tr.half, tr.hw, tr.speed, tr.speed > 0.3 ? tr.vx / tr.speed : tr.hx, tr.speed > 0.3 ? tr.vz / tr.speed : tr.hz, false);
        else consider(v, v.half || 2.3, v.halfWidth || 0.9, 0, v.tx ?? 0, v.tz ?? 1, false);
      }
    }
    if (this.driver.peds && this.traffic.peds) {
      for (const p of this.traffic.peds) {
        if (!p.placed) continue;
        consider(p, 0.4, 0.4, 0, 0, 1, true);
      }
    }
    return best;
  }

  // Is the line at offset `off` free of vehicles and kerbs from from..to metres ahead?
  lineClear(s, off, from, to) {
    const pts = this.path.pts;
    const clearRoad = this.network.isRoadClear;
    for (let i = this.index; i < pts.length; i++) {
      const p = pts[i];
      const ahead = p.s - s;
      if (ahead > to) break;
      if (ahead < from) continue;
      if (clearRoad && !clearRoad(p.x + p.nx * off, p.z + p.nz * off, 1.0)) return false;
    }
    if (!this.besideClear(off)) return false;
    const lead = this.leadOnPath(s, off, to, 0.35);
    // (a vehicle in it is fine if it's far enough, or moving and no slower than us)
    return !lead || lead.gap > to - 4 || lead.speed > Math.max(2.5, Math.abs(this.controllers.getActiveEntity().speed) - 1);
  }

  // Nothing alongside (or just behind) the car on the line `off` metres right of the path
  besideClear(off) {
    return !this.besideBlocker(off);
  }

  // The vehicle alongside (or just behind) the car on the line `off` metres right of the path, if any
  besideBlocker(off) {
    const ent = this.controllers.getActiveEntity();
    const p = this.path.pts[this.index];
    if (!p) return null;
    const cx = ent.position.x + p.nx * (off - this.offset);
    const cz = ent.position.z + p.nz * (off - this.offset);
    for (const list of this.vehicleLists()) {
      if (!list) continue;
      for (const v of list) {
        if (!v.edge) continue;
        const dx = v.x - cx;
        const dz = v.z - cz;
        const along = dx * p.tx + dz * p.tz;
        const across = Math.abs(dx * p.nx + dz * p.nz);
        if (along > -12 && along < 6 && across < (v.halfWidth || 0.9) + CAR_HALF_W + 0.4) return v;
      }
    }
    return null;
  }

  // The nearest free line to swerve into: a lane's width either side, then two
  findGap(s, speed) {
    const reach = clamp(14 + speed * 1.2, 18, 45);
    // (squeezing past at 2.6 m, half in the next lane, before taking the whole lane)
    const options = [-2.6, 2.6, -3.4, 3.4, -6.8, 6.8, -10.2, 10.2];
    options.sort((a, b) => Math.abs(a - this.offset) - Math.abs(b - this.offset));
    for (const o of options) {
      if (Math.abs(o) > 11) continue;
      if (Math.abs(o - this.offset) < 0.5) continue;
      if (this.lineClear(s, o, 2, reach)) return o;
    }
    return null;
  }
}

export { Navigator, DRIVERS, planRoute, buildPath, findStartEdge, findGoalEdges, locate, pointAt, pursuitSteer, speedControl, speedProfile };
