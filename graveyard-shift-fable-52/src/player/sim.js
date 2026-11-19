// Pure player simulation: movement against a moveCapsule function, health and regen.
// No DOM, no three.js: vitest drives these directly. Vectors are plain [x,y,z] arrays.
//
// Angles: yaw 0 looks down -Z, positive yaw turns left (three.js camera, rotation order YXZ).
// move.x is right, move.y is forward.
import { tuning } from '../game/tuning.js';

export const PLAYER_HEIGHT = 1.8; // capsule height, feet to crown
export const GRAVITY = 15; // m/s^2: jump 4.8 m/s peaks at ~0.77 m
export const MAX_FRAME_DT = 0.1; // a longer frame (tab switch, stall) is clamped to this
const SUBSTEP = 1 / 60; // integration step; also keeps each moveCapsule delta well under the radius
const GROUND_ACCEL = 60; // 1/s, exponential approach to target speed: snappy, ~0.07 m lost from rest
const AIR_ACCEL = 4;
const SPRINT_MIN_FORWARD = 0.3;
export const PITCH_LIMIT = Math.PI / 2 - 0.02;

export function createPlayerState(start = {}, tune = tuning.player) {
  const s = {
    pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0,
    eye: [0, 0, 0], forward: [0, 0, -1],
    health: tune.health, maxHealth: tune.health, alive: true,
    onGround: true, sprinting: false,
    sinceDamage: Infinity, // seconds since the last damage taken
    distance: 0, // metres walked on the ground (drives head bob and footsteps)
    landSpeed: 0, // downward speed at the last landing, consumed by the view
    armor: 0, // hp of armour plates left (plates of tuning.touch.plate hp each)
    speedScale: 1, // multiplies walk and sprint speed (weapons, machines)
    invulnerable: 0, // seconds of sim time left in which damage is ignored
    lethalHook: null, // fn() -> {health, invuln} | null, asked once when damage would kill
  };
  resetPlayerState(s, start, tune);
  return s;
}

export function resetPlayerState(s, start = {}, tune = tuning.player) {
  const p = toArr(start.pos) || [0, 0, 0];
  s.pos = [p[0], p[1], p[2]];
  s.vel = [0, 0, 0];
  s.yaw = start.yaw || 0;
  s.pitch = 0;
  s.health = s.maxHealth = tune.health;
  s.alive = true;
  s.onGround = true;
  s.sprinting = false;
  s.sinceDamage = Infinity;
  s.landSpeed = 0;
  s.armor = 0;
  s.speedScale = 1;
  s.invulnerable = 0;
  s.lethalHook = null;
  updateDerived(s, tune);
  return s;
}

export const clampFrameDt = (dt) => (dt > 0 && Number.isFinite(dt) ? Math.min(dt, MAX_FRAME_DT) : 0);

export function forwardFlat(yaw) { return [-Math.sin(yaw), 0, -Math.cos(yaw)]; }
export function rightFlat(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
// Yaw that faces world direction (dx, dz).
export const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

export function updateDerived(s, tune = tuning.player, aimYaw = 0, aimPitch = 0) {
  s.eye = [s.pos[0], s.pos[1] + tune.eye, s.pos[2]];
  s.forward = lookDir(s.yaw + aimYaw, clampPitch(s.pitch + aimPitch));
}

export const clampPitch = (p) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));

// Flat ground at y=0, no walls: used when the level has no usable moveCapsule.
export function flatMoveCapsule(pos, _r, _h, d) {
  const y = Math.max(0, pos[1] + d[1]);
  return { pos: [pos[0] + d[0], y, pos[2] + d[2]], onGround: y <= 1e-6 };
}

// Live zombies are solid to the player: the player's centre may not come within BODY_BLOCK of a
// zombie's, so a gap between two of them narrower than 1.2 m cannot be walked through. `to` (the
// position a move ends at, [x,y,z]) is corrected in place; returns true if it was.
//  - Outside a body's circle the move is stopped at the circle and keeps its sideways part: the
//    player slides round a zombie.
//  - A zombie can come inside the circle on its own (a lunge ends 0.3 m away). The player is never
//    pushed back out, but while it is that close only the part of a move that leads directly away
//    from it is kept: no going deeper and no slipping past it. Otherwise every attacker would
//    shrink its own circle and a crowd in mid-swing could be walked straight through.
//  - Backing away from a body is always free, and zombies give way again once their swing is over
//    (zombie/ai.js playerGap), so this holds the player up; it cannot trap them.
// bodies: [{ pos: {x, z} | [x,y,z] }]. Bodies stand on the ground: a player whose feet are above
// their heads (a car roof) is not blocked.
// 0.6 m = the player's radius (0.35) plus a zombie's (0.25): the two bodies touch. It is also
// the zombies' own AI.playerGap, so a player pressing on a zombie does not make it give way. (At
// 0.45 the player slid between any two zombies 0.9 m apart and walked straight through a crowd.)
export const BODY_BLOCK = 0.6;
const BODY_INSIDE = 0.03; // m inside the circle before a body counts as "inside" (zombies settle right on it)
const BODY_TOP = 1.5;
export function blockByBodies(from, to, bodies, radius = BODY_BLOCK) {
  if (!bodies || !bodies.length || to[1] > BODY_TOP) return false;
  let changed = false;
  for (let pass = 0; pass < 2; pass++) { // twice: the correction for one body can push into the next
    let hit = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i] && bodies[i].pos;
      if (!b) continue;
      const bx = b.x !== undefined ? b.x : b[0], bz = b.z !== undefined ? b.z : b[2];
      const fx = from[0] - bx, fz = from[2] - bz;
      const d0 = Math.hypot(fx, fz);
      if (!(d0 < radius + 2)) continue; // far away (a frame's move is centimetres); also skips NaN
      let nx = to[0] - bx, nz = to[2] - bz;
      const d = Math.hypot(nx, nz);
      if (d0 < radius - BODY_INSIDE) {
        // already inside: keep only the outward part of the move
        const mx = to[0] - from[0], mz = to[2] - from[2];
        if (mx === 0 && mz === 0) continue;
        let out = 0;
        if (d0 > 1e-6) out = Math.max(0, (mx * fx + mz * fz) / d0);
        const tx = d0 > 1e-6 ? from[0] + (fx / d0) * out : from[0];
        const tz = d0 > 1e-6 ? from[2] + (fz / d0) * out : from[2];
        if (Math.abs(tx - to[0]) < 1e-9 && Math.abs(tz - to[2]) < 1e-9) continue;
        to[0] = tx; to[2] = tz;
        hit = true; changed = true;
        continue;
      }
      if (!(d < radius)) continue;
      const keep = Math.min(radius, d0);
      if (d >= keep - 1e-9) continue; // not going deeper
      if (d > 1e-6) { nx /= d; nz /= d; } else { nx = fx / d0; nz = fz / d0; }
      to[0] = bx + nx * keep; to[2] = bz + nz * keep;
      hit = true; changed = true;
    }
    if (!hit) break;
  }
  return changed;
}

// cmd: { move:{x,y}, sprint:bool, jump:bool (pressed this frame) }.
// Returns { landed: downward speed at landing or 0 }.
export function stepMovement(s, cmd, dt, moveCapsule = flatMoveCapsule, tune = tuning.player) {
  dt = clampFrameDt(dt);
  let landed = 0;
  if (!s.alive || dt === 0) { updateDerived(s, tune); return { landed }; }
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
  const h = dt / n;
  let jump = !!cmd.jump;
  const mx = cmd.move ? cmd.move.x || 0 : 0;
  const my = cmd.move ? cmd.move.y || 0 : 0;
  const f = forwardFlat(s.yaw);
  const r = rightFlat(s.yaw);
  const wish = [r[0] * mx + f[0] * my, 0, r[2] * mx + f[2] * my];
  const wishLen = Math.hypot(wish[0], wish[2]);
  if (wishLen > 1) { wish[0] /= wishLen; wish[2] /= wishLen; }

  for (let i = 0; i < n; i++) {
    // Sprint: forward input only; keeps its state through a jump.
    const sprintOk = cmd.sprint && my > SPRINT_MIN_FORWARD;
    s.sprinting = sprintOk && (s.onGround || s.sprinting);
    const speed = (s.sprinting ? tune.sprint : tune.walk) * (s.speedScale > 0 ? s.speedScale : 1);
    const k = 1 - Math.exp(-(s.onGround ? GROUND_ACCEL : AIR_ACCEL) * h);
    s.vel[0] += (wish[0] * speed - s.vel[0]) * k;
    s.vel[2] += (wish[2] * speed - s.vel[2]) * k;
    if (jump && s.onGround) { s.vel[1] = tune.jump; s.onGround = false; }
    jump = false;
    s.vel[1] -= GRAVITY * h;

    const d = [s.vel[0] * h, s.vel[1] * h, s.vel[2] * h];
    const from = s.pos;
    let res = safeMove(moveCapsule, from, tune.radius, d);
    const moved = [res.pos[0] - from[0], res.pos[1] - from[1], res.pos[2] - from[2]];
    // Blocked along an axis: drop the velocity into the obstacle so it does not build up.
    for (const a of [0, 2]) if (Math.abs(moved[a]) < Math.abs(d[a]) - 1e-6) s.vel[a] = moved[a] / h;
    if (res.onGround) {
      if (!s.onGround && s.vel[1] < 0) landed = Math.max(landed, -s.vel[1]);
      if (s.vel[1] < 0) s.vel[1] = 0;
    } else if (d[1] > 0 && moved[1] < d[1] - 1e-6) {
      s.vel[1] = 0; // head hit a ceiling
    } else if (d[1] < 0 && moved[1] > d[1] + 1e-6) {
      // Held up without footing (carried on a car's slip surface): the fall is only what really
      // happened, so sliding off lands from the drop, not from all the time spent on the roof.
      s.vel[1] = Math.min(0, moved[1] / h);
    }
    if (res.onGround) s.distance += Math.hypot(moved[0], moved[2]);
    s.onGround = !!res.onGround;
    s.pos = res.pos;
  }
  if (landed) s.landSpeed = landed;
  updateDerived(s, tune);
  return { landed };
}

function safeMove(moveCapsule, from, radius, d) {
  let res = null;
  try { res = moveCapsule(from, radius, PLAYER_HEIGHT, d); } catch (e) { res = null; }
  const p = res && toArr(res.pos);
  if (!p || !p.every(Number.isFinite)) return flatMoveCapsule(from, radius, PLAYER_HEIGHT, d);
  return { pos: p, onGround: !!res.onGround };
}

function toArr(v) {
  if (!v) return null;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return [Number(v[0]), Number(v[1]), Number(v[2])];
  if (typeof v.x === 'number') return [v.x, v.y, v.z];
  return null;
}

// Health: regen starts regenDelay seconds after the last hit, at regenRate per second.
export function stepHealth(s, dt, tune = tuning.player) {
  dt = clampFrameDt(dt);
  s.sinceDamage += dt;
  if (s.invulnerable > 0) s.invulnerable = Math.max(0, s.invulnerable - dt);
  if (s.alive && s.sinceDamage >= tune.regenDelay && s.health < s.maxHealth) {
    s.health = Math.min(s.maxHealth, s.health + tune.regenRate * dt);
  }
}

// Returns true if the damage was applied. Armour takes it first, all of it while it lasts. A hit
// that would kill asks s.lethalHook once (then forgets it): a non-null answer {health, invuln}
// keeps the player alive at that health and immune for invuln seconds. Sets alive=false at 0.
export function applyDamage(s, amount, { god = false } = {}) {
  if (!s.alive || god || !(amount > 0) || s.invulnerable > 0) return false;
  const absorbed = Math.min(s.armor || 0, amount);
  s.armor = (s.armor || 0) - absorbed;
  const rest = amount - absorbed;
  s.sinceDamage = 0;
  if (rest >= s.health && s.lethalHook) {
    const hook = s.lethalHook;
    s.lethalHook = null;
    let r = null;
    try { r = hook(); } catch (e) { r = null; }
    if (r && r.health > 0) {
      s.health = Math.min(s.maxHealth, r.health);
      s.invulnerable = Math.max(0, r.invuln || 0);
      return true;
    }
  }
  s.health = Math.max(0, s.health - rest);
  if (s.health <= 0) { s.alive = false; s.sprinting = false; }
  return true;
}

// Armour plates: `armor` hp in plates of `plate` hp. plates = plates with any hp left; plateHp =
// what the outer one has left. addPlates(n): a cracked plate counts as missing and is replaced.
export const platesOf = (s, plate) => Math.max(0, Math.ceil((s.armor || 0) / plate - 1e-9));
export const plateHpOf = (s, plate) => {
  const n = platesOf(s, plate);
  return n ? (s.armor || 0) - (n - 1) * plate : 0;
};
export function addPlates(s, n, plate, maxPlates) {
  const whole = Math.floor((s.armor || 0) / plate + 1e-9);
  const added = Math.max(0, Math.min(Math.floor(n) || 0, maxPlates - whole));
  if (added) s.armor = (whole + added) * plate;
  return added;
}

export function applyHeal(s, n) {
  if (!s.alive || !(n > 0)) return;
  s.health = Math.min(s.maxHealth, s.health + n);
}
