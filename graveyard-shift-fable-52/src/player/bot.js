// bot=1 autopilot. Walks to a goal (setGoal) or, with none, a 10 m square loop from its start.
// fireAt(pos) snaps the aim to pos and pulls the trigger on the next player update.
// Pure: produces a movement command and a facing; the controller applies them.
import { forwardFlat, rightFlat, yawToward, clampPitch } from './sim.js';

const LOOP_SIDE = 10;
const ARRIVE = 0.4; // metres
const TURN_RATE = 6; // rad/s while walking
const STUCK_WINDOW = 1.2; // s: must close this much distance on the target in this window...
const STUCK_PROGRESS = 0.3; // ...metres, or it counts as stuck
const AIM_HOLD = 0.6; // s the bot keeps facing its last fireAt target

export function createBot(start) {
  const p = start.pos;
  const f = forwardFlat(start.yaw || 0);
  const r = rightFlat(start.yaw || 0);
  const at = (a, b) => [p[0] + f[0] * a + r[0] * b, p[2] + f[2] * a + r[2] * b];
  const bot = {
    goal: null, // [x, z]
    loop: [at(0, 0), at(LOOP_SIDE, 0), at(LOOP_SIDE, LOOP_SIDE), at(0, LOOP_SIDE)],
    wp: 1, // next loop corner
    laps: 0,
    stuck: 0, // times the stuck guard fired
    aim: null, // [x,y,z] target of the last fireAt
    aimT: 0,
    fireQueued: false,
    watch: { t: 0, dist: Infinity },
    sidestep: 0, // seconds left of a sidestep after getting stuck on a goal
    setGoal(x, z) {
      bot.goal = x === null || x === undefined ? null : [x, z];
      bot.watch = { t: 0, dist: Infinity };
    },
    fireAt(pos) {
      const v = Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z];
      bot.aim = [v[0], v[1], v[2]];
      bot.aimT = AIM_HOLD;
      bot.fireQueued = true;
    },
  };
  return bot;
}

// Returns { move:{x,y}, sprint, jump, yaw, pitch, fire }. s is the player state.
export function botCommand(bot, s, dt) {
  const cmd = { move: { x: 0, y: 0 }, sprint: false, jump: false, yaw: s.yaw, pitch: s.pitch, fire: false };
  const target = bot.goal || bot.loop[bot.wp];
  const dx = target[0] - s.pos[0];
  const dz = target[1] - s.pos[2];
  const dist = Math.hypot(dx, dz);
  let wish = null; // world-space walk direction, scaled 0..1

  if (dist < ARRIVE) {
    if (!bot.goal) advanceLoop(bot);
  } else {
    // Stuck guard: no progress for a while -> jump once, then give up on this corner (loop) or
    // sidestep for a moment (goal).
    bot.watch.t += dt;
    if (dist < bot.watch.dist - STUCK_PROGRESS) bot.watch = { t: 0, dist };
    if (bot.watch.t > STUCK_WINDOW) {
      bot.stuck++;
      bot.watch = { t: 0, dist };
      cmd.jump = true;
      if (bot.goal) bot.sidestep = 0.8;
      else advanceLoop(bot);
    }
    let wx = dx / dist;
    let wz = dz / dist;
    if (bot.sidestep > 0) {
      bot.sidestep -= dt;
      const l = Math.hypot(0.3, 1);
      [wx, wz] = [(wx * 0.3 - wz) / l, (wz * 0.3 + wx) / l];
    }
    const slow = Math.min(1, dist / 1.2); // ease into the goal instead of overshooting
    wish = [wx * slow, wz * slow];
  }

  if (bot.aimT > 0) {
    // Face the last fireAt target; keep walking (strafing) toward the goal meanwhile.
    bot.aimT -= dt;
    const ax = bot.aim[0] - s.eye[0];
    const ay = bot.aim[1] - s.eye[1];
    const az = bot.aim[2] - s.eye[2];
    cmd.yaw = yawToward(ax, az);
    cmd.pitch = clampPitch(Math.atan2(ay, Math.hypot(ax, az)));
  } else {
    if (wish) cmd.yaw = turnToward(s.yaw, yawToward(wish[0], wish[1]), TURN_RATE * dt);
    cmd.pitch = s.pitch * Math.max(0, 1 - 6 * dt); // level the view while walking
  }
  if (wish) {
    const f = forwardFlat(cmd.yaw);
    const r = rightFlat(cmd.yaw);
    cmd.move.x = wish[0] * r[0] + wish[1] * r[2];
    cmd.move.y = wish[0] * f[0] + wish[1] * f[2];
  }
  if (bot.fireQueued) { cmd.fire = true; bot.fireQueued = false; }
  return cmd;
}

function advanceLoop(bot) {
  bot.wp = (bot.wp + 1) % bot.loop.length;
  if (bot.wp === 1) bot.laps++;
  bot.watch = { t: 0, dist: Infinity };
}

function turnToward(a, b, max) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + Math.max(-max, Math.min(max, d));
}
