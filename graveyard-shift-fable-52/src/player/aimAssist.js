// Aim assist for touch play (pure: no DOM, no three.js). Vectors are [x,y,z] arrays.
//   step(state, { camPos, camDir, targets, dt, moving, T, assist = 2, range = Infinity, hit? })
//     -> { scale, yaw, pitch, fire }   (the same object every call: copy what you keep)
//   scale - friction: multiply the touch look step by this (T.frictionScale within T.frictionDeg
//           of the nearest target, else 1).
//   yaw, pitch - magnetism: radians to add this frame, toward the nearest target within
//           T.magnetDeg, at most T.magnetDegPerS and T.magnetMaxStepDeg per frame, never past it,
//           and only while `moving` (the stick is deflected). Yaw grows to the left (sim.js).
//   fire  - auto-fire: on target continuously for T.autoFireDelay; false the frame it leaves.
//           On target is `hit` when given (a real ray), else within T.targetRadius of a target point.
//           ctx.skipFire: leave fire alone (call fireStep(state, on, dt, T) once the look is applied).
// Targets are points (head and chest of each live zombie); those beyond `range` are ignored.
// assist: 0 = identity (no friction, magnetism or auto-fire), 1 = friction, 2 = friction and magnetism.
// (The controller runs the auto-fire assist from its own setting, G.input.touch.autoFire, off by default,
// through fireStep; it no longer depends on this level.)
import { tuning } from '../game/tuning.js';

const DEG = Math.PI / 180;

export function createAimState() {
  return { onT: 0, out: { scale: 1, yaw: 0, pitch: 0, fire: false } };
}

const px = (p) => (p.x !== undefined ? p.x : p[0]);
const py = (p) => (p.y !== undefined ? p.y : p[1]);
const pz = (p) => (p.z !== undefined ? p.z : p[2]);

export function step(state, ctx) {
  const T = ctx.T || tuning.touch;
  const out = state.out;
  out.scale = 1; out.yaw = 0; out.pitch = 0; out.fire = false;
  const assist = ctx.assist ?? 2;
  if (!assist) { state.onT = 0; return out; }

  const cx = px(ctx.camPos), cy = py(ctx.camPos), cz = pz(ctx.camPos);
  let fx = px(ctx.camDir), fy = py(ctx.camDir), fz = pz(ctx.camDir);
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  const range = ctx.range ?? Infinity;

  // nearest target by angle
  let best = -1, bestAng = Infinity, bestDist = 0, bx = 0, by = 0, bz = 0;
  const targets = ctx.targets || [];
  const n = ctx.count ?? targets.length;
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    if (!t) continue;
    const dx = px(t) - cx, dy = py(t) - cy, dz = pz(t) - cz;
    const d = Math.hypot(dx, dy, dz);
    if (!(d > 1e-6) || d > range) continue;
    const c = (dx * fx + dy * fy + dz * fz) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, c)));
    if (ang < bestAng) { bestAng = ang; best = i; bestDist = d; bx = dx / d; by = dy / d; bz = dz / d; }
  }

  if (best >= 0) {
    if (bestAng <= T.frictionDeg * DEG) out.scale = T.frictionScale;
    if (assist >= 2 && ctx.moving && bestAng <= T.magnetDeg * DEG && bestAng > 1e-9) {
      const camYaw = Math.atan2(-fx, -fz), camPitch = Math.asin(Math.max(-1, Math.min(1, fy)));
      const tYaw = Math.atan2(-bx, -bz), tPitch = Math.asin(Math.max(-1, Math.min(1, by)));
      let dYaw = tYaw - camYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      const dPitch = tPitch - camPitch;
      // angular size of the (yaw, pitch) step on the sphere: yaw shrinks by cos(pitch)
      const len = Math.hypot(dYaw * Math.cos(camPitch), dPitch) || 1e-9;
      const maxStep = Math.min(T.magnetDegPerS * DEG * (ctx.dt || 0), T.magnetMaxStepDeg * DEG, bestAng);
      const k = Math.min(1, maxStep / len);
      out.yaw = dYaw * k; out.pitch = dPitch * k;
    }
  }

  if (ctx.skipFire) return out; // the caller decides fire later (fireStep), after the look is applied
  const on = ctx.hit !== undefined
    ? !!ctx.hit
    : best >= 0 && bestAng <= Math.atan2(T.targetRadius, bestDist);
  out.fire = fireStep(state, on, ctx.dt || 0, T);
  return out;
}

// The auto-fire timer alone: on target continuously for T.autoFireDelay. Also sets state.out.fire.
export function fireStep(state, on, dt, T = tuning.touch) {
  state.onT = on ? state.onT + dt : 0;
  state.out.fire = on && state.onT >= T.autoFireDelay - 1e-9;
  return state.out.fire;
}
