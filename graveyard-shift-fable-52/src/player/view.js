// Camera feel, kept subtle: head bob, landing dip, sprint FOV kick, recoil, shake, damage tilt,
// death slump. Pure: takes the player state and dt, returns offsets. No three.js.
import { damp, clamp } from '../core/mathx.js';
import { rightFlat, forwardFlat } from './sim.js';

const STEP_LEN = 1.9; // metres per footstep walking (2.2 steps/s at 4.2 m/s)
const STEP_LEN_SPRINT = 2.3;
const BOB_Y = 0.028; // metres
const BOB_X = 0.018;
const BOB_ROLL = 0.004; // radians
const SPRINT_BOB = 1.35;
const SPRINT_FOV = 5; // degrees added while sprinting
const DIP_K = 140; // landing dip spring
const DIP_DAMP = 2 * Math.sqrt(DIP_K) * 0.75;
const DIP_MAX = 0.14;
const RECOIL_KEEP = 0.25; // share of recoil that stays in the aim; the rest springs back
const RECOIL_RECOVER = 9;
const SHAKE_DECAY = 1.6; // trauma per second
const SHAKE_ANGLE = 0.025; // radians at full trauma
const HIT_ROLL = 0.05;
const HIT_PITCH = 0.025;
const HIT_RECOVER = 6;
const DEAD_EYE = 0.35;

export function createViewState() {
  return {
    phase: 0, // footstep phase, PI per step
    lastStep: 0,
    bob: 0, // 0..1 bob strength, follows ground speed
    dip: 0, dipVel: 0,
    fovKick: 0,
    recoil: { p: 0, y: 0 },
    trauma: 0, t: 0,
    hit: { roll: 0, pitch: 0 },
    deadT: 0,
    lastDistance: null,
  };
}

export function addRecoil(v, s, pitch, yaw) {
  s.pitch += pitch * RECOIL_KEEP;
  s.yaw += yaw * RECOIL_KEEP;
  v.recoil.p += pitch * (1 - RECOIL_KEEP);
  v.recoil.y += yaw * (1 - RECOIL_KEEP);
}

export function addShake(v, amount) { v.trauma = clamp(v.trauma + amount, 0, 1); }

// dir: world vector from the player toward the source. Returns the source's angle relative to
// facing (0 ahead, +PI/2 right), for the HUD's damage direction.
export function addHit(v, s, amount, dir) {
  let angle = null;
  if (dir && (dir[0] || dir[2])) {
    const r = rightFlat(s.yaw);
    const f = forwardFlat(s.yaw);
    const len = Math.hypot(dir[0], dir[2]);
    const lr = (dir[0] * r[0] + dir[2] * r[2]) / len;
    const lf = (dir[0] * f[0] + dir[2] * f[2]) / len;
    angle = Math.atan2(lr, lf);
    const w = clamp(amount / 34, 0.3, 1.5);
    v.hit.roll += lr * HIT_ROLL * w; // tilt away: hit from the right rolls the head left
    v.hit.pitch += lf * HIT_PITCH * w; // hit from the front knocks the head back
  }
  addShake(v, clamp(amount / 100, 0.15, 0.45));
  return angle;
}

// Returns { stepped, eyeHeight, offset:[x,y,z] (world), pitch, yaw, roll (added), fovAdd, aim:{p,y} }.
// sprintFov: degrees added while sprinting. Touch play passes 0: auto-sprint comes and goes with the
// stick's push, and the FOV pumping with it reads as the view jumping.
export function stepView(v, s, dt, eyeHeight, sprintFov = SPRINT_FOV) {
  v.t += dt;
  // Head bob from distance walked, faded by ground speed.
  if (v.lastDistance === null) v.lastDistance = s.distance;
  const walked = s.distance - v.lastDistance;
  v.lastDistance = s.distance;
  const speed = s.onGround ? Math.hypot(s.vel[0], s.vel[2]) : 0;
  v.bob = damp(v.bob, clamp(speed / 4.2, 0, 1), 10, dt);
  v.phase += (walked * Math.PI) / (s.sprinting ? STEP_LEN_SPRINT : STEP_LEN);
  const stepIndex = Math.floor(v.phase / Math.PI);
  const stepped = stepIndex !== v.lastStep && speed > 0.5;
  v.lastStep = stepIndex;
  const amp = v.bob * (s.sprinting ? SPRINT_BOB : 1);
  const bobY = -BOB_Y * amp * Math.abs(Math.sin(v.phase)); // head lowest mid-stride
  const bobX = BOB_X * amp * Math.sin(v.phase * 0.5); // one sway per stride (two steps)
  const roll = BOB_ROLL * amp * Math.sin(v.phase * 0.5);

  // Landing dip: impulse proportional to fall speed, critically-ish damped spring back.
  if (s.landSpeed > 0) {
    v.dipVel += clamp(s.landSpeed * 0.09, 0, 1.2);
    s.landSpeed = 0;
  }
  const acc = -DIP_K * v.dip - DIP_DAMP * v.dipVel;
  v.dipVel += acc * dt;
  v.dip = clamp(v.dip + v.dipVel * dt, -0.05, DIP_MAX);

  v.fovKick = damp(v.fovKick, s.sprinting && speed > 1 ? sprintFov : 0, 8, dt);
  v.recoil.p = damp(v.recoil.p, 0, RECOIL_RECOVER, dt);
  v.recoil.y = damp(v.recoil.y, 0, RECOIL_RECOVER, dt);
  v.hit.roll = damp(v.hit.roll, 0, HIT_RECOVER, dt);
  v.hit.pitch = damp(v.hit.pitch, 0, HIT_RECOVER, dt);
  v.trauma = Math.max(0, v.trauma - SHAKE_DECAY * dt);
  const sh = v.trauma * v.trauma * SHAKE_ANGLE;
  const n = (a, b, c) => Math.sin(v.t * a) * 0.5 + Math.sin(v.t * b + 1.3) * 0.3 + Math.sin(v.t * c + 2.1) * 0.2;

  // Death: the head sinks and rolls over a second.
  v.deadT = s.alive ? 0 : v.deadT + dt;
  const d = clamp(v.deadT / 0.9, 0, 1);
  const slump = d * d * (3 - 2 * d);
  const eye = eyeHeight + (DEAD_EYE - eyeHeight) * slump;

  const r = rightFlat(s.yaw);
  return {
    stepped,
    eyeHeight: eye,
    offset: [r[0] * bobX, bobY - v.dip, r[2] * bobX],
    pitch: v.recoil.p + v.hit.pitch + sh * n(23, 31, 47),
    yaw: v.recoil.y + sh * n(19, 29, 41),
    roll: roll + v.hit.roll + sh * 0.6 * n(17, 37, 43) + slump * 0.45,
    fovAdd: v.fovKick,
    aim: { p: v.recoil.p, y: v.recoil.y }, // where the gun points: recoil moves aim, bob and shake do not
  };
}
