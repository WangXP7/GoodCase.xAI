// js/perception.js
// What the autopilot (js/navigation.js) knows about the traffic around it, worked out the way a driver (or a camera
// and radar) would: from where each vehicle and person is seen, frame by frame. A track per object near the car keeps a
// filtered position, velocity and acceleration estimated from those positions (the traffic's own speed fields are never
// read), its size, and the way it is heading (its motion, or its body when it stands). From a track, predict() says
// where the object will be in t seconds (holding its acceleration until it stops), and firstConflict() finds the first
// moment a planned path of the car comes closer to any predicted object than the driver's clearance allows.
//
// Conventions as road-network.js: north = -z, east = +x; footprints are runs of circles along a body's length.

const TELEPORT = 70; // m/s: a "move" faster than this is a vehicle recycled elsewhere (traffic.js), not motion
const VEL_RATE = 8; // 1/s: how quickly the velocity estimate follows what is seen
const ACC_RATE = 3; // and the acceleration estimate

class Tracker {
  constructor() {
    this.tracks = new Map(); // object -> track
    this.time = 0;
  }

  get(obj) {
    return this.tracks.get(obj);
  }

  /**
   * Take in a frame: `lists` of objects ({ x, z, half?, halfWidth?, tx?, tz? }; vehicles out of play have edge null,
   * people not placed have placed false), seen from `ego` (its position); objects beyond `radius` are let go.
   */
  update(dt, lists, ego, radius = 140) {
    this.time += dt;
    const ex = ego.position.x;
    const ez = ego.position.z;
    const r2 = radius * radius;
    const stamp = this.time;
    for (const list of lists) {
      if (!list) continue;
      for (const o of list) {
        if (o === ego || o.edge === null || o.placed === false) continue;
        const dx = o.x - ex;
        const dz = o.z - ez;
        if (dx * dx + dz * dz > r2) continue;
        let t = this.tracks.get(o);
        if (!t) {
          this.tracks.set(o, (t = this.fresh(o)));
          t.stamp = stamp;
          continue;
        }
        if (dt > 0) {
          const mvx = (o.x - t.mx) / dt;
          const mvz = (o.z - t.mz) / dt;
          if (Math.hypot(mvx, mvz) > TELEPORT) {
            Object.assign(t, this.fresh(o));
          } else {
            const kv = 1 - Math.exp(-dt * VEL_RATE);
            const ka = 1 - Math.exp(-dt * ACC_RATE);
            const pvx = t.vx;
            const pvz = t.vz;
            t.vx += (mvx - t.vx) * kv;
            t.vz += (mvz - t.vz) * kv;
            if (t.age > 0.5) { // (once the velocity estimate has settled)
              t.ax += ((t.vx - pvx) / dt - t.ax) * ka;
              t.az += ((t.vz - pvz) / dt - t.az) * ka;
            }
            t.age += dt;
          }
        }
        t.mx = o.x;
        t.mz = o.z;
        t.x = o.x;
        t.z = o.z;
        t.speed = Math.hypot(t.vx, t.vz);
        // the way it heads: its motion once it moves, else its body; and how fast that turns (heading grows turning
        // left, as the player's does: atan2(x, z))
        if (t.speed > 1.5) {
          const nx = t.vx / t.speed;
          const nz = t.vz / t.speed;
          if (dt > 0 && t.age > 0.3) {
            const turn = Math.atan2(t.hx * nz - t.hz * nx, t.hx * nx + t.hz * nz);
            // (sign: from (hx, hz) to (nx, nz), turning towards +x from +z is a growing atan2(x, z))
            t.omega += (-turn / dt - t.omega) * (1 - Math.exp(-dt * ACC_RATE));
          }
          t.hx = nx;
          t.hz = nz;
        } else {
          t.omega = 0;
          if (Number.isFinite(o.tx) && Number.isFinite(o.tz) && (o.tx || o.tz)) {
            const l = Math.hypot(o.tx, o.tz);
            t.hx = o.tx / l;
            t.hz = o.tz / l;
          }
        }
        t.stamp = stamp;
      }
    }
    for (const [o, t] of this.tracks) if (t.stamp !== stamp) this.tracks.delete(o);
  }

  fresh(o) {
    const l = Math.hypot(o.tx || 0, o.tz || 0);
    const ped = o.half === undefined && o.halfWidth === undefined;
    return {
      obj: o, x: o.x, z: o.z, mx: o.x, mz: o.z, vx: 0, vz: 0, ax: 0, az: 0, speed: 0, omega: 0, age: 0, stamp: 0,
      hx: l > 0 ? o.tx / l : 0, hz: l > 0 ? o.tz / l : 1,
      half: ped ? 0.35 : o.half ?? 2.3, hw: ped ? 0.35 : o.halfWidth ?? 0.9, ped
    };
  }
}

/**
 * Where track `tr` will be in `t` s: along its velocity, holding its acceleration along it until it stops, and turning at
 * the rate it is turning (round a bend, or a turn at a junction), up to a quarter turn
 */
function predict(tr, t, out = {}) {
  const v = tr.speed;
  out.half = tr.half;
  out.hw = tr.hw;
  out.hx = tr.hx;
  out.hz = tr.hz;
  if (v < 0.3) {
    out.x = tr.x;
    out.z = tr.z;
    return out;
  }
  const ux = tr.vx / v;
  const uz = tr.vz / v;
  // braking is believed in full, speeding up only partly (it may be pulling away from a light, or not)
  const along = Math.max(-9, Math.min(1.5, tr.ax * ux + tr.az * uz));
  let d;
  if (along < 0 && v / -along < t) d = (v * v) / (-2 * along); // stops before t
  else d = v * t + 0.5 * along * t * t;
  const w = Math.abs(tr.omega) > 0.02 ? tr.omega : 0;
  if (!w) {
    out.x = tr.x + ux * d;
    out.z = tr.z + uz * d;
    return out;
  }
  // an arc of d metres at the turn rate's radius (r = v / w), the heading turning no further than a quarter turn
  // (the filtered velocity trails a turning car's heading by about its filter's time constant)
  const h0 = Math.atan2(ux, uz) + w / VEL_RATE;
  const r = v / w;
  const dh = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d / r));
  const arc = Math.abs(dh * r);
  const h1 = h0 + dh;
  out.x = tr.x + r * (Math.cos(h0) - Math.cos(h1));
  out.z = tr.z + r * (Math.sin(h1) - Math.sin(h0));
  // (beyond a quarter turn: straight on)
  if (arc < d) {
    out.x += Math.sin(h1) * (d - arc);
    out.z += Math.cos(h1) * (d - arc);
  }
  out.hx = Math.sin(h1);
  out.hz = Math.cos(h1);
  return out;
}

// Centres of the circles covering a body of half-length `half`, half-width `hw` (n of them, offsets along its length)
function circles(half, hw) {
  const n = Math.max(1, Math.round(half / hw));
  if (n === 1) return [0];
  const span = Math.max(0, half - hw);
  const out = [];
  for (let i = 0; i < n; i++) out.push(-span + (2 * span * i) / (n - 1));
  return out;
}

const EGO_HALF = 2.25;
const EGO_HW = 0.9;
const EGO_CIRCLES = circles(EGO_HALF, EGO_HW);
const R_PAD = 0.12; // a circle of radius hw leaves a body's corners just outside it

/**
 * The first moment, within `horizon` s (sampled every `step`), that the car following `egoAt(t)` ({ x, z, hx, hz }) comes
 * closer to a predicted track than `clearance + growth * t` metres (the margin grows with how far ahead it is guessing):
 * { t, track, gap } or null. Objects behind the car at that moment are left out: one closing from behind is theirs to
 * avoid. `skip(track)` leaves out others; `ignore(track, predicted)` leaves out a moment of one (a person predicted to
 * be on the pavement).
 */
function firstConflict(egoAt, tracks, { horizon = 4, step = 0.1, clearance = 0.5, growth = 0.2, skip = null, ignore = null, pedClearance = null } = {}) {
  const p = {};
  const re = EGO_HW + R_PAD;
  for (let t = 0; t <= horizon + 1e-9; t += step) {
    const e = egoAt(t);
    if (!e) break;
    let best = null;
    for (const tr of tracks.values ? tracks.values() : tracks) {
      if (skip && skip(tr)) continue;
      predict(tr, t, p);
      if (ignore && ignore(tr, p)) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const reach = EGO_HALF + p.half + 4;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      // behind the car: not its to avoid
      if (dx * e.hx + dz * e.hz < -EGO_HALF) continue;
      const margin = (tr.ped && pedClearance !== null ? pedClearance : clearance) + growth * t;
      const ro = p.hw + R_PAD;
      const oc = circles(p.half, p.hw);
      let gap = Infinity;
      for (const a of EGO_CIRCLES) {
        const ax = e.x + e.hx * a;
        const az = e.z + e.hz * a;
        for (const b of oc) {
          const g = Math.hypot(p.x + p.hx * b - ax, p.z + p.hz * b - az) - re - ro;
          if (g < gap) gap = g;
        }
      }
      if (gap < margin && (!best || gap < best.gap)) best = { t, track: tr, gap };
    }
    if (best) return best;
  }
  return null;
}

export { Tracker, predict, firstConflict, circles, EGO_HALF, EGO_HW };
