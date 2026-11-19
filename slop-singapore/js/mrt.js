// js/mrt.js
// Singapore's MRT for the rides (tools/city/mrt.mjs builds tiles/<city>/mrt.json from OpenStreetMap): its lines,
// stations and tracks (each one direction of a line's service, a line of points with its stops in order), a trip's
// plan from one station to another (the fewest minutes, changing lines at interchanges), and the ride itself: a train
// that pulls away, runs at the line's speed (easing for its curves), brakes into each station and stops with its middle
// at the platform's, opens its doors, and on at the end of each leg, the change to the next line's platform.
// No three.js here: js/mrt-scene.js draws it, js/mrt-audio.js is its sounds, js/mrt-ui.js its HUD.
//
// Conventions as the rest of the world: x east, z south, y up (m); a track's s is metres along it from its first point.

const CAR_LENGTH = { NSL: 23, EWL: 23, NEL: 23, CCL: 23, DTL: 23, TEL: 23 };
const CARS = { NSL: 6, EWL: 6, NEL: 6, CCL: 3, DTL: 3, TEL: 4 };
// m/s: each line's top speed in service (80, 90 and 78 km/h)
const TOP_SPEED = { NSL: 22.2, EWL: 22.2, NEL: 25, CCL: 21.7, DTL: 25, TEL: 22.2 };
const ACCEL = 1.0; // m/s²: pulling away
const BRAKE = 0.95; // m/s²: braking into a station
const JERK = 0.7; // m/s³: how fast the acceleration changes (a smooth pull-away and stop)
const LAT = 0.9; // m/s²: the most sideways acceleration on a curve
const DWELL = 22; // s: doors open at a station on the way
const BOARD = 14; // s: doors open at the station the ride starts from
const CLOSING = 3.2; // s: the door chime to the doors shut
const CHANGE = 6; // s: walking to the next line's platform (shortened)
const TRANSFER_COST = 300; // s: a change of line, for the trip planner (the walk and the wait)

/** The network from mrt.json: { lines, stations, tracks, linesAt(station) } */
function parseMrt(json) {
  const lines = json.lines.map((l, i) => ({ ...l, index: i, cars: CARS[l.id] || 4, carLength: CAR_LENGTH[l.id] || 23, top: TOP_SPEED[l.id] || 22 }));
  const stations = json.stations.map((s, i) => ({ ...s, index: i, exits: s.exits || [] }));
  const tracks = json.tracks.map((t, ti) => {
    const n = t.pts.length / 3;
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), s = new Float64Array(n);
    let px = 0, pz = 0, py = 0;
    for (let i = 0; i < n; i++) {
      px += t.pts[i * 3]; pz += t.pts[i * 3 + 1]; py += t.pts[i * 3 + 2];
      x[i] = px / 10; z[i] = pz / 10; y[i] = py / 10;
      if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1], y[i] - y[i - 1]);
    }
    const line = lines[t.line];
    const track = { index: ti, line, towards: t.towards, x, y, z, s, n, length: s[n - 1] };
    track.stops = t.stops.map(([si, pi, side]) => ({ station: stations[si], s: s[Math.min(n - 1, pi)], side }));
    track.limit = speedLimits(track, line.top);
    return track;
  });
  const at = new Map();
  for (const t of tracks) for (const st of t.stops) {
    if (!at.has(st.station)) at.set(st.station, new Set());
    at.get(st.station).add(t.line);
  }
  return {
    lines, stations, tracks, credit: json.credit,
    linesAt: (station) => [...(at.get(station) || [])]
  };
}

// The speed allowed at each point of a track: its top speed, slower round its curves (LAT across), slowing in time
// for each (BRAKE)
function speedLimits(t, top) {
  const lim = new Float32Array(t.n);
  // (the turn over 30 m either side of each point: a curve's radius, not the jitter of its points)
  const W = 30;
  let a = 0, b = 0;
  const heading = (p, q) => Math.atan2(t.x[q] - t.x[p], t.z[q] - t.z[p]);
  for (let i = 0; i < t.n; i++) {
    while (a < i && t.s[i] - t.s[a + 1] >= W) a++;
    while (b < t.n - 1 && t.s[b] - t.s[i] < W) b++;
    let k = 0;
    if (a < i && b > i) {
      const d = heading(i, b) - heading(a, i);
      const turn = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      const L = (t.s[b] - t.s[a]) / 2;
      k = L > 1 ? turn / L : 0;
    }
    lim[i] = Math.min(top, k > 1e-5 ? Math.sqrt(LAT / k) : top);
  }
  for (let i = t.n - 2; i >= 0; i--) lim[i] = Math.min(lim[i], Math.sqrt(lim[i + 1] ** 2 + 2 * BRAKE * (t.s[i + 1] - t.s[i])));
  for (let i = 1; i < t.n; i++) lim[i] = Math.min(lim[i], Math.sqrt(lim[i - 1] ** 2 + 2 * ACCEL * (t.s[i] - t.s[i - 1])));
  return lim;
}

/** The index i of the point at or before s on track t (a binary search; `hint` speeds a walk along it) */
function indexAt(t, s, hint = -1) {
  if (hint >= 0 && hint < t.n - 1 && t.s[hint] <= s && t.s[hint + 1] > s) return hint;
  if (hint >= 0 && hint < t.n - 2 && t.s[hint + 1] <= s && t.s[hint + 2] > s) return hint + 1;
  let lo = 0, hi = t.n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.s[m] <= s) lo = m; else hi = m;
  }
  return lo;
}

/** The point at s along track t: { x, y, z, dx, dy, dz (unit, along it), i } into `out` */
function trackPoint(t, s, out = {}) {
  const sc = Math.max(0, Math.min(t.length, s));
  const i = indexAt(t, sc, out.i ?? -1);
  const j = Math.min(t.n - 1, i + 1);
  const L = t.s[j] - t.s[i] || 1;
  const f = Math.max(0, Math.min(1, (sc - t.s[i]) / L));
  out.x = t.x[i] + (t.x[j] - t.x[i]) * f;
  out.y = t.y[i] + (t.y[j] - t.y[i]) * f;
  out.z = t.z[i] + (t.z[j] - t.z[i]) * f;
  // (the direction eased between this stretch's and the next's, so a car doesn't snap round at a point)
  const k = Math.min(t.n - 1, j + 1);
  const dx0 = t.x[j] - t.x[i], dz0 = t.z[j] - t.z[i], dy0 = t.y[j] - t.y[i];
  const L1 = t.s[k] - t.s[j] || L;
  const dx1 = k > j ? t.x[k] - t.x[j] : dx0, dz1 = k > j ? t.z[k] - t.z[j] : dz0, dy1 = k > j ? t.y[k] - t.y[j] : dy0;
  const w = f > 0.5 ? (f - 0.5) : 0;
  let dx = (dx0 / L) * (1 - w) + (dx1 / L1) * w;
  let dy = (dy0 / L) * (1 - w) + (dy1 / L1) * w;
  let dz = (dz0 / L) * (1 - w) + (dz1 / L1) * w;
  const m = Math.hypot(dx, dy, dz) || 1;
  out.dx = dx / m; out.dy = dy / m; out.dz = dz / m;
  out.i = i;
  return out;
}

/** The nearest station to (x, z), and how far it is */
function nearestStation(net, x, z) {
  let best = null, bd = Infinity;
  for (const s of net.stations) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { station: best, distance: bd } : null;
}

/**
 * A trip from station `from` to station `to`: its legs [{ track, from (stop index), to (stop index) }], each a ride
 * on one line, the fewest minutes in all (a change costs TRANSFER_COST). null where no train goes there, or `from` is
 * `to`.
 */
function planTrip(net, from, to) {
  if (!from || !to || from === to) return null;
  // nodes: a stop of a track; each runs on to the track's next stop, or changes to another track at its station
  const key = (t, k) => t * 1000 + k;
  const dist = new Map();
  const prev = new Map();
  const queue = [];
  const push = (t, k, d, p) => {
    const id = key(t, k);
    if (dist.has(id) && dist.get(id) <= d) return;
    dist.set(id, d);
    prev.set(id, p);
    queue.push([d, t, k]);
  };
  const atStation = new Map();
  for (const t of net.tracks) t.stops.forEach((st, k) => {
    if (!atStation.has(st.station)) atStation.set(st.station, []);
    atStation.get(st.station).push([t.index, k]);
  });
  for (const [t, k] of atStation.get(from) || []) push(t, k, 0, null);
  let goal = null;
  while (queue.length) {
    // (a few hundred stops: a sorted list is plenty)
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
    const [d, t, k] = queue.splice(bi, 1)[0];
    if (d > dist.get(key(t, k))) continue;
    const track = net.tracks[t];
    const st = track.stops[k];
    if (st.station === to) { goal = [t, k]; break; }
    // on along the line
    if (k + 1 < track.stops.length) {
      const run = track.stops[k + 1].s - st.s;
      push(t, k + 1, d + run / 14 + DWELL, [t, k, 'ride']);
    }
    // or change here (to another line, or the same line's other way)
    for (const [t2, k2] of atStation.get(st.station)) {
      if (t2 === t) continue;
      push(t2, k2, d + (net.tracks[t2].line === track.line ? TRANSFER_COST * 2 : TRANSFER_COST), [t, k, 'change']);
    }
  }
  if (!goal) return null;
  // back from the goal: the stops it rode through, then the legs
  const steps = [];
  let cur = goal;
  while (cur) {
    steps.unshift(cur);
    const p = prev.get(key(cur[0], cur[1]));
    cur = p ? [p[0], p[1]] : null;
  }
  const legs = [];
  for (const [t, k] of steps) {
    const last = legs[legs.length - 1];
    if (last && last.track.index === t) last.to = k;
    else legs.push({ track: net.tracks[t], from: k, to: k });
  }
  const out = legs.filter((l) => l.to > l.from);
  return out.length ? out : null;
}

/**
 * The ride: the train of each leg in turn from its first stop to its last, with `onEvent(kind, data)` told as it
 * happens: 'board' (the doors open where the ride starts), 'closing' (the door chime), 'depart', 'next' (the next
 * station announced, a little after leaving), 'approach' (pulling in), 'arrive' (stopped, doors opening), 'change'
 * (the walk to the next line), 'end' (the last station). update(dt) runs it; its state: leg, track, front (s of the
 * train's front), v, a, phase ('doors', 'closing', 'run', 'change', 'done'), stop (the stop index it's at or making
 * for).
 */
class MrtRide {
  constructor(net, legs, { onEvent = () => {} } = {}) {
    this.net = net;
    this.legs = legs;
    this.onEvent = onEvent;
    this.legIndex = 0;
    this.time = 0;
    this.startLeg(true);
  }

  get leg() { return this.legs[this.legIndex]; }
  get track() { return this.leg.track; }
  get line() { return this.track.line; }
  get trainLength() { return this.line.cars * this.line.carLength; }
  get station() { return this.track.stops[this.stop].station; }
  get destination() { const l = this.legs[this.legs.length - 1]; return l.track.stops[l.to].station; }
  get done() { return this.phase === 'done'; }

  // where the front of the train stops at stop k: the train's middle at the platform's
  stopFront(k) {
    return Math.min(this.track.length - 1, this.track.stops[k].s + this.trainLength / 2);
  }

  startLeg(first) {
    const leg = this.leg;
    this.stop = leg.from;
    this.front = this.stopFront(this.stop);
    this.v = 0;
    this.a = 0;
    this.phase = 'doors';
    this.timer = first ? BOARD : DWELL;
    this.announced = false;
    this.approached = false;
    this.event('board', { station: this.station, track: this.track, change: !first });
  }

  event(kind, data = {}) {
    this.onEvent(kind, { ride: this, ...data });
  }

  /** The stops left on this leg, from the one it is at or making for: [{ station, s }] */
  stopsAhead() {
    return this.track.stops.slice(this.stop, this.leg.to + 1);
  }

  /** Metres to the next stop's stopping point, and the seconds to it at about the line's pace */
  toNext() {
    const d = Math.max(0, this.stopFront(this.stop) - this.front);
    return { distance: d, seconds: d / Math.max(8, Math.min(this.line.top * 0.7, this.v || 12)) };
  }

  update(dt) {
    let left = dt;
    // (a long step, fast-forwarding, in pieces short enough to stop where the train stops)
    while (left > 1e-6 && !this.done) {
      const h = Math.min(left, 0.1);
      this.step(h);
      left -= h;
    }
  }

  step(dt) {
    this.time += dt;
    if (this.phase === 'doors') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'closing';
        this.timer = CLOSING;
        this.event('closing', { station: this.station });
      }
      return;
    }
    if (this.phase === 'closing') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'run';
        this.stop++;
        this.announced = false;
        this.approached = false;
        this.departedAt = this.time;
        this.event('depart', { from: this.track.stops[this.stop - 1].station, next: this.station });
      }
      return;
    }
    if (this.phase === 'change') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.legIndex++;
        this.startLeg(false);
      }
      return;
    }
    if (this.phase !== 'run') return;
    const t = this.track;
    const target = this.stopFront(this.stop);
    const togo = target - this.front;
    // the speed it may do: the line's limit here and just ahead, and no more than it can stop from in time
    const i = indexAt(t, Math.max(0, this.front), this._i ?? -1);
    this._i = i;
    const j = Math.min(t.n - 1, i + 1);
    const vLine = Math.min(t.limit[i], t.limit[j]);
    const vStop = Math.sqrt(Math.max(0, 2 * BRAKE * Math.max(0, togo - 0.3)));
    const vWant = Math.min(vLine, vStop + 0.05);
    // the acceleration that gets there, eased (jerk-limited), harder braking only when it must
    let aWant = clamp((vWant - this.v) * 1.2, -BRAKE * 1.25, ACCEL);
    if (togo < 6 && this.v < 1.5) aWant = Math.min(aWant, (0.25 * togo) - this.v);
    this.a += clamp(aWant - this.a, -JERK * dt * 2, JERK * dt * 2);
    this.v = Math.max(0, this.v + this.a * dt);
    this.front = Math.min(target, this.front + this.v * dt);
    // (the next station announced once under way: some seconds out, or at once on a short hop)
    if (!this.announced && (this.time - this.departedAt > 7 || togo < 400)) {
      this.announced = true;
      this.event('next', { next: this.station, last: this.stop === this.leg.to, lines: this.net.linesAt(this.station).filter((l) => l !== this.line) });
    }
    if (!this.approached && togo < Math.max(160, (this.v * this.v) / (2 * BRAKE) + 40)) {
      this.approached = true;
      this.event('approach', { next: this.station, last: this.stop === this.leg.to });
    }
    if (togo < 0.05 && this.v < 0.3) {
      this.front = target;
      this.v = this.a = 0;
      const last = this.stop === this.leg.to;
      this.event('arrive', { station: this.station, last, final: last && this.legIndex === this.legs.length - 1 });
      if (!last) {
        this.phase = 'doors';
        this.timer = DWELL;
      } else if (this.legIndex < this.legs.length - 1) {
        this.phase = 'change';
        this.timer = CHANGE + DWELL * 0.4;
        this.event('change', { station: this.station, to: this.legs[this.legIndex + 1].track });
      } else {
        this.phase = 'done';
        this.event('end', { station: this.station });
      }
    }
  }

  /** On to just before the next station, at the speed it would be doing there (fast-forward through a stretch) */
  skip() {
    if (this.phase === 'doors' || this.phase === 'closing') {
      this.timer = Math.min(this.timer, 0.01);
      return;
    }
    if (this.phase === 'change') { this.timer = 0.01; return; }
    if (this.phase !== 'run') return;
    const target = this.stopFront(this.stop);
    const s = Math.max(this.front, target - 380);
    if (s <= this.front) return;
    this.front = s;
    const i = indexAt(this.track, s);
    this.v = Math.min(this.track.limit[i], Math.sqrt(2 * BRAKE * (target - s)));
    this.a = 0;
    this._i = i;
    this.announced = true;
  }

  /** Get off at the next station: the trip ends there */
  alightNext() {
    const k = this.phase === 'run' ? this.stop : Math.min(this.leg.to, this.stop + (this.phase === 'doors' ? 0 : 1));
    this.legs = this.legs.slice(0, this.legIndex + 1);
    this.leg.to = k;
    if (this.phase === 'doors' && k === this.stop) {
      // (at a station with the doors open: off here)
      this.phase = 'done';
      this.event('end', { station: this.station });
    }
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export { parseMrt, planTrip, nearestStation, trackPoint, indexAt, MrtRide, CARS, TOP_SPEED };
