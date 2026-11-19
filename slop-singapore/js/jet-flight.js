// js/jet-flight.js
// The F-15SG's flight model: arcade, but built on the numbers that make a fighter feel like one. No three.js, so it
// runs (and is tested) anywhere. World frame as the rest of the city: x, y up, z; a heading h points along
// (sin h, 0, cos h). The jet's body: forward +z, up +y, left wing +x; its attitude a unit quaternion [x, y, z, w].
//
// - Speed along the nose from thrust (dry up to military power, then afterburner), drag that grows with the square of
//   speed (more with the gear or the speed brake out, and from pulling hard), and gravity along the climb: a zoom climb
//   trades speed for height and a dive gives it back. Full afterburner tops out at Mach 1.1 at sea level, military
//   power at about Mach 0.85.
// - Lift, as a point mass: the wings' lift along the jet's up, gravity straight down, and the flight path bends by
//   whatever of the two is across it. The stick commands load factor (g): centred it holds the path's pitch with the
//   wings level (n = cos of the climb angle), back pulls up to 9 g, forward pushes to -3 g, but never more than the wing
//   gives at that speed and weight (n ≤ (v / stall speed)², the 1 g stall at ~120 knots at full fuel). So, as in the
//   real jet, banking with the stick centred tilts the lift away from vertical: it turns, the nose drops and it
//   descends unless you pull back, to 1 / cos(bank) g to hold height (2 g in a 60° bank). `assist` (Bank assist)
//   pulls that for you and rolls a small bank level, so A/D alone fly it round a corner.
// - Roll at up to 200°/s. Pulling hard costs speed (induced drag grows with g², and as speed falls).
// - Too slow to hold even the path it's on, it can't: the nose drops through and it gains speed again; tail-sliding
//   out of a vertical climb it falls.
// - Fuel, as the F-15SG's: 10,400 kg (22,900 lb) in its internal tanks and conformal tanks, burnt by the two F110s at
//   their fuel flow: about 0.25 kg/s at idle, 3.2 kg/s at military power and 14 kg/s in full afterburner at sea
//   level (less as thrust lapses with height): about 12 minutes of full afterburner. Lighter, it accelerates and turns
//   better. Out of fuel the engines flame out and it glides. `unlimitedFuel` keeps the tanks full.
// - On the ground: nosewheel steering, rotate at 140 knots with the stick back, lift off above 150; brakes with the
//   throttle closed. It lands on any land with the gear down, the wings near level and a descent under 7 m/s; anything
//   else, or water, or a building, is a crash.

const G = 9.81;

const JET = {
  gearHeight: 2.3, // m from the wheels to the model's origin (the jet's centre), gear down
  bellyHeight: 1.05, // m from its belly to the origin, gear up
  stallSpeed: 62, // m/s (~120 kt): the 1 g stall at the reference weight
  minG: -3,
  rotateSpeed: 72, // m/s (~140 kt): the nose can come up on the runway
  liftoffSpeed: 78, // m/s (~150 kt)
  maxG: 9,
  maxRollRate: 3.4, // rad/s (~200°/s)
  dryThrust: 7, // m/s² at military power (throttle 0.8): thrust over the jet's weight, ~0.7 g
  wetThrust: 12.5, // m/s² at full afterburner: ~1.25 g, enough to accelerate straight up
  afterburner: 0.8, // throttle above which the afterburner lights
  drag: 8.8e-5, // per metre: drag = drag · v²
  induced: 0.012, // induced drag: induced · g · n² · (150 / v)² m/s²
  gearDrag: 0.8, // extra share of drag with the gear down
  speedBrake: 1.6, // extra share of drag with the speed brake out
  rolling: 0.25, // m/s² on the runway
  wheelBrake: 5.5, // m/s²
  throttleRate: 0.55, // per second
  ceiling: 9000, // m
  thrustLapse: 12000, // m: thrust falls off with height, to nothing at this altitude
  // masses (kg): empty with its missiles and crew; fuel in the internal and conformal tanks
  emptyMass: 15500,
  fuelCapacity: 10400,
  // fuel flow, both engines, at sea level (kg/s): idle, military power, full afterburner
  fuelIdle: 0.25,
  fuelMil: 3.2,
  fuelMax: 14.3
};
// the thrust and lift above are tuned at full fuel
const REF_MASS = JET.emptyMass + JET.fuelCapacity;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------------------------------
// Quaternions ([x, y, z, w]) and the vectors they turn
// ---------------------------------------------------------------------------------------------------------------------
function qMul(a, b, out = [0, 0, 0, 1]) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function qAxis(x, y, z, angle, out = [0, 0, 0, 1]) {
  const s = Math.sin(angle / 2);
  out[0] = x * s; out[1] = y * s; out[2] = z * s; out[3] = Math.cos(angle / 2);
  return out;
}
function qNormalize(q) {
  const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= L; q[1] /= L; q[2] /= L; q[3] /= L;
  return q;
}
/** v turned by q, into out ([x, y, z]) */
function qRotate(q, x, y, z, out = [0, 0, 0]) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}
/** The attitude at heading h, pitched up by `pitch` (rad) and rolled right by `roll` (rad) */
function attitude(h, pitch = 0, roll = 0, out = [0, 0, 0, 1]) {
  qAxis(0, 1, 0, h, out);
  qMul(out, qAxis(1, 0, 0, -pitch, _t), out);
  return qNormalize(qMul(out, qAxis(0, 0, 1, roll, _t), out));
}
const _t = [0, 0, 0, 1], _r = [0, 0, 0, 1];
const _f = [0, 0, 0], _u = [0, 0, 0], _l = [0, 0, 0];

// turn q about its own (body) axis, or about a world axis
function turnBody(q, x, y, z, angle) {
  if (angle) qNormalize(qMul(q, qAxis(x, y, z, angle, _r), q));
}
function turnWorld(q, x, y, z, angle) {
  if (angle) qNormalize(qMul(qAxis(x, y, z, angle, _r), q.slice(), q));
}

/** The jet's axes and attitude angles: forward, up, left (world vectors), heading, pitch (climb) & bank (right +) */
function axes(q) {
  qRotate(q, 0, 0, 1, _f);
  qRotate(q, 0, 1, 0, _u);
  qRotate(q, 1, 0, 0, _l);
  return {
    forward: _f, up: _u, left: _l,
    pitch: Math.asin(clamp(_f[1], -1, 1)),
    bank: Math.atan2(_l[1], _u[1]),
    horizontal: Math.hypot(_f[0], _f[2])
  };
}

/** Thrust (m/s²) at a throttle setting (0..1): dry up to military power, then the afterburner */
function thrustAt(throttle, altitude = 0) {
  const t = clamp(throttle, 0, 1);
  const a = t <= JET.afterburner ? (t / JET.afterburner) * JET.dryThrust
    : JET.dryThrust + ((t - JET.afterburner) / (1 - JET.afterburner)) * (JET.wetThrust - JET.dryThrust);
  return a * clamp(1 - Math.max(0, altitude) / JET.thrustLapse, 0.05, 1);
}

/** Fuel flow (kg/s) at a throttle setting (0..1) and altitude: with the thrust, dry up to military, then afterburner */
function fuelFlow(throttle, altitude = 0) {
  const t = clamp(throttle, 0, 1);
  const f = t <= JET.afterburner ? JET.fuelIdle + (t / JET.afterburner) * (JET.fuelMil - JET.fuelIdle)
    : JET.fuelMil + ((t - JET.afterburner) / (1 - JET.afterburner)) * (JET.fuelMax - JET.fuelMil);
  return f * clamp(1 - Math.max(0, altitude) / JET.thrustLapse, 0.05, 1);
}

/** The jet's mass now (kg) */
const massOf = (s) => JET.emptyMass + clamp(s.fuel ?? JET.fuelCapacity, 0, JET.fuelCapacity);

/** A fresh jet: parked (onGround) at (x, y, z) facing heading h, or flying at `speed` */
function createJetState({ x = 0, y = JET.gearHeight, z = 0, heading = 0, speed = 0, onGround = true, throttle = 0 } = {}) {
  return {
    position: { x, y, z },
    q: attitude(heading),
    heading,
    speed,
    throttle,
    sink: 0, // m/s downward, tail-sliding
    fuel: JET.fuelCapacity, // kg
    flameout: false, // out of fuel: no thrust
    unlimitedFuel: false,
    assist: false, // Bank assist: holds the height in a bank, levels a small bank
    onGround,
    groundPitch: 0, // the nose up on the runway (rad)
    gear: onGround ? 1 : 0, // 0 up .. 1 down
    g: 1, // load factor, for the HUD
    pitchRate: 0,
    rollRate: 0,
    climbRate: 0,
    afterburner: 0, // 0..1 how lit it is
    stalled: false,
    speedBrake: false
  };
}

/**
 * Advance the jet by h seconds.
 * input: { pitch: -1..1 (+ nose up), roll: -1..1 (+ right), throttle: -1..1 (+ more), brake: bool }
 * env: { groundAt(x, z) -> height of the land there, or null over water }
 * Returns null, or { event: 'landed' | 'liftoff' | 'crash', cause }.
 */
function stepJet(s, input, h, env = {}) {
  if (!(h > 0)) return null;
  const pitchIn = clamp(Number(input.pitch) || 0, -1, 1);
  const rollIn = clamp(Number(input.roll) || 0, -1, 1);
  s.throttle = clamp(s.throttle + (Number(input.throttle) || 0) * JET.throttleRate * h, 0, 1);
  // the speed brake (in the air) or the wheel brakes (on the ground): holding throttle-down with it closed
  s.speedBrake = !!input.brake && s.throttle <= 0;
  const p = s.position;
  // the fuel: burnt at the engines' flow; out of it they flame out
  if (s.unlimitedFuel) s.fuel = JET.fuelCapacity;
  else s.fuel = Math.max(0, (s.fuel ?? JET.fuelCapacity) - fuelFlow(s.throttle, p.y) * h);
  s.flameout = s.fuel <= 0;
  const power = s.flameout ? 0 : s.throttle;
  s.afterburner += ((power > JET.afterburner ? (power - JET.afterburner) / (1 - JET.afterburner) : 0) - s.afterburner) * (1 - Math.exp(-h * 6));
  const ground = env.groundAt ? env.groundAt(p.x, p.z) : 0;
  const groundY = ground ?? 0;
  // thrust over the jet's weight now (lighter as it burns its fuel)
  const lightness = REF_MASS / massOf(s);
  const thrust = thrustAt(power, p.y) * lightness;
  let v = s.speed;
  let event = null;

  if (s.onGround) {
    // Rolling on the gear: steer the nosewheel, the stick lifts the nose once fast enough, lifts off with the nose up
    s.gear = 1;
    const steer = 0.45 * clamp(1 - v / 90, 0.08, 1);
    s.heading -= rollIn * steer * h;
    const nose = v > JET.rotateSpeed ? Math.max(0, pitchIn) * 0.22 : 0;
    s.groundPitch = clamp(s.groundPitch + (nose ? nose * h : -0.15 * h), 0, 0.26);
    const drag = JET.drag * v * v * (1 + JET.gearDrag);
    const brake = s.speedBrake ? JET.wheelBrake : 0;
    v = Math.max(0, v + (thrust - drag - (v > 0 ? JET.rolling + brake : 0)) * h);
    p.x += Math.sin(s.heading) * v * h;
    p.z += Math.cos(s.heading) * v * h;
    p.y = groundY + JET.gearHeight;
    attitude(s.heading, s.groundPitch, 0, s.q);
    s.pitchRate = s.rollRate = s.climbRate = s.sink = 0;
    s.g = 1;
    s.stalled = false;
    if (v > JET.liftoffSpeed && s.groundPitch > 0.1) {
      s.onGround = false;
      p.y += 0.05;
      event = { event: 'liftoff' };
    } else if (ground === null) {
      event = { event: 'crash', cause: 'water' };
    }
    s.speed = v;
    return event;
  }

  // In the air
  const q = s.q;
  // roll
  const rollRate = rollIn * JET.maxRollRate * clamp((v - 20) / 80, 0.25, 1);
  turnBody(q, 0, 0, 1, rollRate * h); // right roll: the left wing up
  let a = axes(q);
  const f = a.forward, u = a.up;
  // the load factor: centred, the path's pitch held (cos of the climb; with Bank assist, over cos of the bank too, up
  // to 60°, and a small bank rolled level); the stick pulls to 9 g or pushes to -3 g, never past what the wing gives
  const climb = Math.cos(a.pitch);
  let n0 = climb;
  if (s.assist && u[1] > 0.5) {
    n0 = climb / Math.max(0.5, Math.cos(a.bank));
    if (!rollIn && Math.abs(a.bank) < 0.45) turnBody(q, 0, 0, 1, -a.bank * Math.min(1, 1.4 * h));
  }
  const nCmd = pitchIn >= 0 ? n0 + pitchIn * (JET.maxG - n0) : n0 + -pitchIn * (JET.minG - n0);
  const nLift = (v / JET.stallSpeed) ** 2 * lightness; // the most the wing gives (both ways)
  const n = clamp(nCmd, -Math.min(-JET.minG, nLift), Math.min(JET.maxG, nLift));
  s.stalled = nCmd > n + 0.02 && nLift < JET.maxG;
  // the path bends by what's across it of lift (n g along the jet's up) and gravity (g down)
  const ax = n * G * u[0], ay = n * G * u[1] - G, az = n * G * u[2];
  const along = ax * f[0] + ay * f[1] + az * f[2];
  const px = ax - along * f[0], py = ay - along * f[1], pz = az - along * f[2];
  const across = Math.hypot(px, py, pz);
  if (across > 1e-6 && v > 1) {
    // about f × (the push across), at |push| / v
    const rx = f[1] * pz - f[2] * py, ry = f[2] * px - f[0] * pz, rz = f[0] * py - f[1] * px;
    const L = Math.hypot(rx, ry, rz);
    if (L > 1e-9) turnWorld(q, rx / L, ry / L, rz / L, (across / Math.max(v, 20)) * h);
  }
  // tail-sliding: too slow to fly at all, the nose falls through towards the ground and it drops
  const slide = clamp(1 - v / (JET.stallSpeed * 0.45), 0, 1);
  a = axes(q);
  if (slide > 0) {
    const hx = a.forward[2], hz = -a.forward[0];
    const H = Math.hypot(hx, hz);
    if (H > 1e-4) turnWorld(q, hx / H, 0, hz / H, slide * 1.6 * h * Math.min(1, H * 4));
    else turnBody(q, 1, 0, 0, slide * 1.6 * h); // straight up: over the top
    a = axes(q);
  }
  // speed: thrust, drag (more with the gear or speed brake), induced drag from the g, gravity along the climb
  const dragShare = 1 + s.gear * JET.gearDrag + (s.speedBrake ? JET.speedBrake : 0);
  const induced = JET.induced * G * n * n * (150 / Math.max(v, 60)) ** 2 / lightness;
  const accel = thrust - JET.drag * v * v * dragShare - induced - G * a.forward[1];
  v = Math.max(0, v + accel * h);
  s.sink = slide > 0 ? Math.min(60, s.sink + G * slide * h) : s.sink * Math.exp(-h * 2.5);
  const fw = a.forward;
  p.x += fw[0] * v * h;
  p.y += (fw[1] * v - s.sink) * h;
  p.z += fw[2] * v * h;
  if (p.y > JET.ceiling) p.y = JET.ceiling;
  if (a.horizontal > 1e-3) s.heading = Math.atan2(fw[0], fw[2]);
  s.speed = v;
  s.pitchRate = ((n - n0) * G) / Math.max(v, 20);
  s.rollRate = rollRate;
  s.climbRate = fw[1] * v - s.sink;
  s.g += (n - s.g) * (1 - Math.exp(-h * 8));
  // the gear: down low and slow, up once climbing away fast
  const agl = p.y - groundY;
  const wantGear = agl < 250 && v < 115 ? 1 : agl > 30 && v > 95 ? 0 : (s.gear > 0.5 ? 1 : 0);
  s.gear = clamp(s.gear + Math.sign(wantGear - s.gear) * h / 2.5, 0, 1);

  // touching down, or hitting the ground
  const contact = s.gear > 0.9 ? JET.gearHeight : JET.bellyHeight;
  if (p.y - groundY <= contact) {
    const gentle = ground !== null && s.gear > 0.9 && s.climbRate > -7 && Math.abs(a.bank) < 0.3
      && a.pitch > -0.12 && a.pitch < 0.35 && a.up[1] > 0;
    if (gentle) {
      s.onGround = true;
      s.groundPitch = clamp(a.pitch, 0, 0.26);
      p.y = groundY + JET.gearHeight;
      s.sink = 0;
      attitude(s.heading, s.groundPitch, 0, s.q);
      event = { event: 'landed' };
    } else {
      p.y = groundY + contact;
      event = { event: 'crash', cause: ground === null ? 'water' : 'ground' };
    }
  }
  return event;
}

export { JET, G, createJetState, stepJet, thrustAt, fuelFlow, attitude, axes, qMul, qAxis, qRotate, qNormalize };
