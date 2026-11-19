// G.player: wires input (or the bot) into the pure simulation (sim.js), camera feel (view.js) and
// the camera. Positions are [x,y,z] arrays; pos is the feet, eye the un-bobbed eye position (use it
// as the shot origin), forward the aim direction including recoil.
//
// Other modules may set: player.baseFov (settings), player.fovScale (weapon ADS, multiplies FOV),
// player.maxHealth (health clamps to it), and call setSpeedScale(source, k) (speedScale is the
// read-only product of the named factors), addPlates(n) -> added, setLethalHook(fn). Read: plates (0-3), plateHp, invulnerable (s). Touch look and aim
// assist are applied here (input.touchLook, G.input.touch, aimAssist.js).
import { tuning } from '../game/tuning.js';
import {
  createPlayerState, resetPlayerState, stepMovement, stepHealth, applyDamage, applyHeal,
  updateDerived, clampPitch, clampFrameDt, flatMoveCapsule, forwardFlat, blockByBodies,
  platesOf, plateHpOf, addPlates,
} from './sim.js';
import { touchLook, fireModeOf } from './touch.js';
import { createAimState, step as aimStep, fireStep } from './aimAssist.js';
import { createViewState, stepView, addRecoil, addShake, addHit } from './view.js';
import { createBot, botCommand } from './bot.js';
import { createBotBrain } from './botBrain.js';

const NO_LOOK = { dx: 0, dy: 0 };
const NO_ASSIST = { scale: 1, yaw: 0, pitch: 0, fire: false };

export function createPlayer(G) {
  const tune = tuning.player;
  const level = () => G.level || {};
  const start = () => level().playerStart || { pos: [0, 0, 0], yaw: 0 };
  const levelMove = (pos, r, h, d) => {
    const fn = level().moveCapsule;
    return typeof fn === 'function' ? fn(pos, r, h, d) : flatMoveCapsule(pos, r, h, d);
  };
  // The level, then the crowd: live zombies are solid (sim.js blockByBodies). The correction is
  // itself moved through the level, so being stopped by a body never puts the player in a wall.
  // Scratch for the body check (run every movement substep): the level and sim copy what they are
  // given and what they get back, so one array and one result can be reused.
  const bodyTo = [0, 0, 0];
  const bodyFix = [0, 0, 0];
  const bodyRes = { pos: null, onGround: false };
  const moveCapsule = (pos, r, h, d) => {
    const res = levelMove(pos, r, h, d);
    const bodies = G.zombies && G.zombies.list;
    if (!Array.isArray(bodies) || !bodies.length || !res || !res.pos) return res;
    const to = bodyTo;
    to[0] = res.pos[0]; to[1] = res.pos[1]; to[2] = res.pos[2];
    if (!blockByBodies(pos, to, bodies)) return res;
    bodyFix[0] = to[0] - res.pos[0]; bodyFix[1] = 0; bodyFix[2] = to[2] - res.pos[2];
    const back = levelMove(res.pos, r, h, bodyFix);
    bodyRes.pos = back && back.pos ? back.pos : res.pos;
    bodyRes.onGround = res.onGround;
    return bodyRes;
  };

  const p = createPlayerState(start(), tune);
  let view = createViewState();
  const TT = tuning.touch;

  // maxHealth is settable; health clamps to it. Reset puts it back to tuning.player.health.
  let maxHealth = p.maxHealth;
  Object.defineProperty(p, 'maxHealth', {
    enumerable: true,
    get: () => maxHealth,
    set: (v) => {
      v = Number(v);
      if (!(v > 0)) return;
      maxHealth = v;
      if (p.health > v) p.health = v;
    },
  });
  // Speed: several writers (a weapon's moveScale, a perk) each own a named factor; the sim reads
  // the product. Assigning speedScale directly does nothing.
  const speedFactors = new Map();
  let speedScale = 1;
  Object.defineProperty(p, 'speedScale', { enumerable: true, get: () => speedScale, set: () => {} });
  const setSpeedScale = (source, k) => {
    k = Number(k);
    if (!(k > 0) || k === 1) speedFactors.delete(source); else speedFactors.set(source, k);
    speedScale = 1;
    for (const v of speedFactors.values()) speedScale *= v;
  };
  let lastPlates = 0;
  const platesChanged = () => {
    const n = platesOf(p, TT.plate);
    if (n !== lastPlates) { lastPlates = n; G.events.emit('armor:change', { plates: n }); }
  };
  const startPlates = () => {
    const n = G.params.plates;
    if (Number.isFinite(n) && n > 0) addPlates(p, n, TT.plate, TT.maxPlates);
    platesChanged();
  };

  Object.assign(p, {
    baseFov: G.params.fov ?? 70,
    fovScale: 1,
    lastDamage: null, // { amount, dir, angle (relative to facing, 0 ahead, +right), t }
    bot: null,
    update,
    addPlates(n) {
      const added = addPlates(p, n, TT.plate, TT.maxPlates);
      platesChanged();
      return added;
    },
    setSpeedScale,
    setLethalHook(fn) { p.lethalHook = typeof fn === 'function' ? fn : null; },
    damage(amount, dir) {
      const d = dir ? (Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z]) : null;
      if (!applyDamage(p, amount, { god: !!G.params.god })) return false;
      platesChanged();
      const angle = addHit(view, p, amount, d);
      p.lastDamage = { amount, dir: d, angle, t: G.time ? G.time.t : 0 };
      G.events.emit('player:damage', { amount, dir: d });
      if (!p.alive) G.events.emit('player:dead');
      return true;
    },
    heal(n) { applyHeal(p, n); },
    addRecoil(pitch, yaw = 0) { addRecoil(view, p, pitch || 0, yaw || 0); },
    addShake(amount) { addShake(view, amount || 0); },
    moveCapsule, // the move the player makes: level plus live zombies (exposed for tests)
    reset() {
      resetPlayerState(p, start(), tune);
      view = createViewState();
      p.lastDamage = null;
      aim.onT = 0; autoT = 0;
      speedFactors.clear(); speedScale = 1;
      startPlates();
      if (p.bot) {
        const goal = p.bot.goal;
        p.bot = createBot({ pos: p.pos.slice(), yaw: p.yaw });
        if (brain) p.bot.brain = brain;
        else if (goal) p.bot.setGoal(goal[0], goal[1]);
      }
      applyCamera(0);
    },
  });

  // bot=1: { setGoal(x,z), fireAt(pos) } plus read-only progress (laps, stuck, goal).
  // With a real game the bot also plays it (botBrain.js): shoots, reloads, buys ammo.
  let brain = null;
  if (G.params.bot) {
    p.bot = createBot({ pos: p.pos.slice(), yaw: p.yaw });
    if (G.events) { brain = createBotBrain(G, p); p.bot.brain = brain; }
  }

  // Is the simulation running? Real game: only while 'playing'. Stub game: unless input paused.
  function active() {
    const g = G.game;
    if (g && !g.stub) return g.state === 'playing';
    return !(G.input && G.input.paused);
  }

  function update(dt) {
    dt = clampFrameDt(dt);
    const input = G.input || {};
    const running = active();
    if (running && p.alive) {
      let cmd;
      if (p.bot) {
        if (brain && G.game && !G.game.stub) brain.update(dt);
        cmd = botCommand(p.bot, p, dt);
        p.yaw = cmd.yaw;
        p.pitch = cmd.pitch;
        if (cmd.fire && input.synth) input.synth('fire');
      } else {
        const look = input.look || NO_LOOK;
        const sens = input.sensitivity || 0.0022;
        p.yaw -= look.dx * sens;
        p.pitch = clampPitch(p.pitch - look.dy * sens);
        if (input.mode === 'touch' && input.touch) touchAim(input, dt);
        const pressed = typeof input.pressed === 'function' ? input.pressed : () => false;
        cmd = { move: input.move || { x: 0, y: 0 }, sprint: !!input.sprint, jump: pressed('jump') };
      }
      p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)); // keep yaw in [-PI, PI]
      stepMovement(p, cmd, dt, moveCapsule, tune);
      failsafe();
      stepHealth(p, dt, tune);
    }
    applyCamera(running || !p.alive ? dt : 0); // paused: the view holds still
  }

  // Touch: assist (friction, magnetism) and the auto-fire assist from the live zombies' head and chest
  // points, and the drag turned into radians. Scratch is reused; nothing is
  // allocated per frame.
  const aim = createAimState();
  const targets = [];
  const targetPool = [];
  const aimCtx = { camPos: null, camDir: null, targets, count: 0, dt: 0, moving: false, T: TT, assist: 0, range: 60, hit: undefined };
  const lookOut = { yaw: 0, pitch: 0 };
  const lookOpts = { sensitivity: 1, scale: 1, ads: false };
  let autoT = 0;
  const losDir = [0, 0, 0];
  const aimDir = [0, 0, 0];
  function touchAim(input, dt) {
    const tch = input.touch;
    const def = (G.weapon && G.weapon.def) || tuning.pistol;
    const range = def.range || tuning.pistol.range;
    const assist = tch.assist | 0;
    const autoFire = !!tch.autoFire;
    const lvl = G.level && typeof G.level.raycast === 'function' ? G.level : null;
    // Targets: head and chest points of live zombies. Only points near the crosshair (within the
    // magnetism cone) can matter to friction, magnetism or auto-fire, so only those are kept, and
    // only with a clear line from the eye (a ray per point, on the frames there is one).
    let count = 0;
    const list = (assist > 0 || autoFire) && G.zombies && G.zombies.list;
    if (Array.isArray(list)) {
      const e = p.eye, f = p.forward;
      const cosNear = Math.cos(TT.magnetDeg * Math.PI / 180);
      for (let i = 0; i < list.length; i++) {
        const z = list[i];
        if (!z || z.alive === false || !z.pos) continue;
        const zx = z.pos.x ?? z.pos[0], zy = z.pos.y ?? z.pos[1], zz = z.pos.z ?? z.pos[2];
        for (let k = 0; k < 2; k++) {
          const ty = zy + (k ? TT.chestY : TT.headY);
          const dx = zx - e[0], dy = ty - e[1], dz = zz - e[2];
          const d = Math.hypot(dx, dy, dz);
          if (!(d > 0) || d > range || (dx * f[0] + dy * f[1] + dz * f[2]) / d < cosNear) continue;
          if (lvl) {
            losDir[0] = dx / d; losDir[1] = dy / d; losDir[2] = dz / d;
            let block = null;
            try { block = lvl.raycast(e, losDir, d); } catch (err) { block = null; }
            if (block && block.dist < d - 0.05) continue;
          }
          const pt = targetPool[count] || (targetPool[count] = [0, 0, 0]);
          pt[0] = zx; pt[1] = ty; pt[2] = zz;
          targets[count++] = pt;
        }
      }
    }
    // Friction and magnetism only with aim assist on (level 0 is no step at all: the auto-fire timer
    // below keeps its own count).
    let a = NO_ASSIST;
    if (assist > 0) {
      aimCtx.camPos = p.eye; aimCtx.camDir = p.forward; aimCtx.count = count; aimCtx.dt = dt;
      aimCtx.moving = !!(tch.state && tch.state.stick.active) && (input.move.x !== 0 || input.move.y !== 0);
      aimCtx.assist = assist; aimCtx.range = range; aimCtx.hit = undefined; aimCtx.skipFire = true;
      a = aimStep(aim, aimCtx);
    }

    const tl = input.touchLook;
    if (tl && (tl.dx || tl.dy)) {
      lookOpts.sensitivity = tch.sensitivity || 1;
      lookOpts.scale = a.scale;
      lookOpts.ads = !!input.ads;
      touchLook(tl.dx, tl.dy, dt, TT, lookOpts, lookOut);
      p.yaw += lookOut.yaw;
      p.pitch = clampPitch(p.pitch + lookOut.pitch);
    }
    p.yaw += a.yaw;
    p.pitch = clampPitch(p.pitch + a.pitch);

    // Auto-fire assist: a real ray along this frame's aim (after the look above) decides "on target";
    // a level hit in front of the zombie says no. Cast only when a visible target is near.
    let hit = false;
    if (count && autoFire && G.zombies && typeof G.zombies.raycast === 'function') {
      // the aim as player.forward has it: this frame's yaw and pitch plus the recoil still springing back
      const ay = p.yaw + view.recoil.y, ap = clampPitch(p.pitch + view.recoil.p);
      const cp = Math.cos(ap);
      aimDir[0] = -Math.sin(ay) * cp; aimDir[1] = Math.sin(ap); aimDir[2] = -Math.cos(ay) * cp;
      try {
        const zh = G.zombies.raycast(p.eye, aimDir, range);
        if (zh) {
          const lh = lvl ? lvl.raycast(p.eye, aimDir, zh.dist) : null;
          hit = !(lh && lh.dist < zh.dist);
        }
      } catch (err) { hit = false; }
    }
    const fire = fireStep(aim, hit, dt, TT);
    // It respects the fire mode: an automatic weapon holds the trigger; a semi-automatic (or burst) one
    // gets single presses no faster than a person tapping (T.assistSemiRate a second) and never above
    // its rpm, the first at once. Nothing at all with no rounds left anywhere, and then nothing is "on
    // target" either (input.js holds the touch sprint back while it is).
    const ammo = G.weapon && G.weapon.ammo;
    const dry = !!ammo && ammo.mag === 0 && ammo.reserve === 0;
    tch.onTarget = fire && !dry;
    if (fire && autoFire && !dry && input.synth) {
      if (fireModeOf(def) === 'auto') input.synth('fire');
      else {
        autoT -= dt;
        if (autoT <= 1e-9) {
          input.synth('fire');
          autoT = Math.max(60 / (def.rpm > 0 ? def.rpm : 400), 1 / TT.assistSemiRate);
        }
      }
    } else autoT = 0;
  }

  // Fell out of the world (bad collider, stub level): put the player back at the start.
  function failsafe() {
    const minY = (level().bounds && level().bounds.min && level().bounds.min[1]) ?? -50;
    if (p.pos[1] < minY - 10 || !p.pos.every(Number.isFinite)) {
      const keep = { health: p.health, alive: p.alive };
      resetPlayerState(p, start(), tune);
      Object.assign(p, keep);
    }
  }

  function applyCamera(dt) {
    const v = stepView(view, p, dt, tune.eye, G.input && G.input.mode === 'touch' ? 0 : undefined);
    updateDerived(p, tune, v.aim.y, v.aim.p);
    if (v.stepped) {
      const hit = level().raycast && safeRaycast([p.pos[0], p.pos[1] + 0.5, p.pos[2]]);
      G.events.emit('step', { pos: p.pos.slice(), surface: (hit && hit.surface) || 'asphalt' });
    }
    const cam = G.camera;
    if (!cam || G.shotCam) return; // a staged shot owns the camera
    cam.position.set(p.pos[0] + v.offset[0], p.pos[1] + v.eyeHeight + v.offset[1], p.pos[2] + v.offset[2]);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(clampPitch(p.pitch + v.pitch), p.yaw + v.yaw, v.roll);
    const fov = (p.baseFov + v.fovAdd) * (p.fovScale || 1);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  function safeRaycast(origin) {
    try { return level().raycast(origin, [0, -1, 0], 1.5); } catch (e) { return null; }
  }

  Object.defineProperty(p, 'plates', { get: () => platesOf(p, TT.plate), enumerable: true });
  Object.defineProperty(p, 'plateHp', { get: () => plateHpOf(p, TT.plate), enumerable: true });
  startPlates();

  // The player's flat facing, handy for HUD and AI.
  Object.defineProperty(p, 'facing', { get: () => forwardFlat(p.yaw), enumerable: false });

  applyCamera(0);
  return p;
}
