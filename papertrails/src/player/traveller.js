// Paper traveller (owner: player agent). API: docs/ARCHITECTURE.md, player/traveller.js.
//
// A flat paper puppet that walks: smooth acceleration, heading smoothing, sliding collision against
// world.isWalkable, ground height from world.heightAt, and a fully procedural paper walk cycle
// (rotation only - nothing is scaled or stretched):
//   legs / arms swing on paper pivots, one small hop per step, the card leans forward and rolls into
//   turns, rocks once like a settling standee when it stops, the lantern is a lagging pendulum and the
//   idle pose breathes very slightly.
// Works with the procedural placeholder AND the glTF traveller: parts are looked up by name
// ('body','head','leg_l','leg_r','arm_l','arm_r','lantern'); every part that exists is animated, the rest
// of the motion lives on the whole card.
//
// Hierarchy:  group (position, heading)  ->  rig (hop, lean, roll, twist)  ->  model (untouched asset)
// 'step' is emitted exactly when a foot of the visible gait lands (phase crosses k*PI).
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { bus } from '../core/events.js';
import { state } from '../core/state.js';
// integration: V8's Math.hypot allocates (rest-argument array) on every call; this 2-argument form is allocation-free.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const PART_ALIASES = {
  body: ['body', 'torso', 'cloak'],
  head: ['head'],
  leg_l: ['leg_l', 'legl', 'leg_left', 'leftleg', 'left_leg'],
  leg_r: ['leg_r', 'legr', 'leg_right', 'rightleg', 'right_leg'],
  arm_l: ['arm_l', 'arml', 'arm_left', 'leftarm', 'left_arm'],
  arm_r: ['arm_r', 'armr', 'arm_right', 'rightarm', 'right_arm'],
  lantern: ['lantern'],
};

function findPart(model, key) {
  const names = PART_ALIASES[key];
  let exact = null;
  let loose = null;
  model.traverse((o) => {
    if (exact) return;
    // 'Traveller__leg_l', 'traveller.leg_l', 'leg_l' -> 'leg_l' (exporters often prefix the object name)
    const n = String(o.name || '').toLowerCase().replace(/^.*__/, '').replace(/[^a-z0-9]+/g, '_').replace(/^traveller_/, '');
    if (n === names[0]) exact = o;
    else if (!loose && names.includes(n)) loose = o;
  });
  return exact || loose;
}

/** The placeholder puppet has no limbs: give it flat paper legs and arms so the walk cycle can be judged. */
function addPlaceholderLimbs(model, materials) {
  const H = CONFIG.TRAVELLER_HEIGHT;
  const pal = CONFIG.palette || {};
  const ink = pal.ink || pal.brown || '#5A3A28';
  const cream = pal.paper || pal.page || '#EFE0C2';
  const limb = (name, w, h, x, y, z, color) => {
    // a strip in the YZ plane (profile cut-out), origin at its top = the paper pivot
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, -h / 2, 0);
    g.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(g, materials.paper({ color, side: THREE.DoubleSide }));
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    model.add(m);
    return m;
  };
  limb('leg_l', 0.085, H * 0.36, 0.055, H * 0.36, 0, ink);
  limb('leg_r', 0.085, H * 0.36, -0.055, H * 0.36, 0, ink);
  limb('arm_l', 0.06, H * 0.3, 0.1, H * 0.63, 0, cream);
  limb('arm_r', 0.06, H * 0.3, -0.1, H * 0.63, 0, cream);
}

export function createTraveller({ scene, assets, world, materials }) {
  const C = CONFIG.player;
  const group = new THREE.Group();
  group.name = 'traveller-root';
  const rig = new THREE.Group();
  rig.name = 'traveller-rig';
  const model = assets.traveller;
  // user: the pale standee disc under the feet read as a weird white circle -> hidden
  model.traverse((o) => { if (/base_tab/.test(o.name)) o.visible = false; });

  if (model.getObjectByName('body_side') && !findPart(model, 'leg_l') && materials && materials.paper) {
    try { addPlaceholderLimbs(model, materials); } catch (err) { /* limbs are optional */ }
  }

  // ---- paper pivots ---------------------------------------------------------------------------
  // Each animated part is re-parented under a pivot group placed on its hinge (hip, shoulder, neck,
  // lantern hook). The pivot keeps the authored transform of the part intact; only the pivot rotates.
  model.updateMatrixWorld(true); // model is still un-parented: "world" here = rig space
  const _box = new THREE.Box3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const parts = {};

  function makePivot(key, where /* 'top' | 'bottom' */, atY) {
    const part = findPart(model, key);
    if (!part || part === model || !part.parent) return null;
    _box.setFromObject(part);
    if (_box.isEmpty()) return null;
    const h = Math.max(1e-4, _box.max.y - _box.min.y);
    const origin = part.getWorldPosition(new THREE.Vector3());
    const at = new THREE.Vector3((_box.min.x + _box.max.x) / 2, 0, (_box.min.z + _box.max.z) / 2);
    const inside = origin.x >= _box.min.x - 0.03 && origin.x <= _box.max.x + 0.03 && origin.z >= _box.min.z - 0.03 && origin.z <= _box.max.z + 0.03;
    if (where === 'top') {
      // trust an authored origin in the top 40 % of the piece (a real hip / shoulder), else use the top edge
      if (inside && origin.y <= _box.max.y + 1e-3 && origin.y >= _box.max.y - h * 0.4) at.copy(origin);
      else at.y = _box.max.y - h * 0.08;
    } else if (inside && origin.y >= _box.min.y - 1e-3 && origin.y <= _box.min.y + h * 0.4) at.copy(origin);
    else at.y = _box.min.y + h * 0.05;
    if (atY !== undefined) { at.set(0, atY, 0); at.x = (_box.min.x + _box.max.x) / 2; }
    const parent = part.parent;
    const pivot = new THREE.Group();
    pivot.name = key + '_pivot';
    pivot.position.copy(parent.worldToLocal(at.clone()));
    parent.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(part);
    // rig-space X (hinge) and Z (forward) expressed in the pivot parent space
    parent.getWorldQuaternion(_q).invert();
    const rec = {
      key, part, pivot,
      axisX: new THREE.Vector3(1, 0, 0).applyQuaternion(_q).normalize(),
      axisZ: new THREE.Vector3(0, 0, 1).applyQuaternion(_q).normalize(),
      at, box: _box.clone(),
    };
    parts[key] = rec;
    return rec;
  }

  const legL = makePivot('leg_l', 'top');
  const legR = makePivot('leg_r', 'top');
  const armL = makePivot('arm_l', 'top');
  const armR = makePivot('arm_r', 'top');
  const head = makePivot('head', 'bottom');
  model.updateMatrixWorld(true);
  const lantern = makePivot('lantern', 'top');
  // torso hinge at the hips: the pack / upper card lags the legs by a few degrees each step (secondary motion).
  // Only when the legs are separate pieces (otherwise the whole card would fold in the middle).
  const torso = legL && legR ? makePivot('body', 'bottom', (legL.at.y + legR.at.y) / 2) : null;
  model.updateMatrixWorld(true);

  // which arm carries the lantern? (it swings much less, so the lantern does not tear off the hand)
  // an arm whose cut-out reaches the ground carries a walking staff: it swings less too (the staff plants)
  const staffFactor = (arm) => (arm && arm.box.min.y < CONFIG.TRAVELLER_HEIGHT * 0.12 ? C.staffArmFactor ?? 0.4 : 1);
  let armLFactor = staffFactor(armL);
  let armRFactor = staffFactor(armR);
  if (lantern) {
    const holds = (arm) => {
      if (!arm) return false;
      for (let o = lantern.pivot; o; o = o.parent) if (o === arm.part) return true;
      return arm.box.clone().expandByScalar(0.09).containsPoint(lantern.at);
    };
    if (holds(armL)) armLFactor = C.holdArmFactor;
    else if (holds(armR)) armRFactor = C.holdArmFactor;
  }

  rig.add(model);
  group.add(rig);
  scene.add(group);

  // ---- state ------------------------------------------------------------------------------------
  const velocity = new THREE.Vector3();
  const moveDir = new THREE.Vector3(0, 0, -1);
  let heading = Math.PI; // rotation.y; model faces +Z, so PI = facing north (-Z)
  let yawRate = 0; // rad / s (smoothed)
  let phase = 0; // gait phase in [0, 2PI): a foot lands at 0 (left) and PI (right)
  let gait = 0; // 0 idle .. 1 walking (pose blend)
  let clock = 0; // local animation clock (sum of dt)
  let lean = 0; // rad, forward lean (under-damped spring)
  let leanVel = 0;
  let roll = 0; // rad, roll into turns
  let rollVel = 0;
  let lanX = 0; let lanVX = 0; let lanZ = 0; let lanVZ = 0; // lantern pendulum
  let prevForward = 0; // forward speed last tick (for acceleration)
  let groundY = 0;
  let actualSpeed = 0;

  // ---- collision ----------------------------------------------------------------------------------
  // physics pass: a circle against the world's clearance field (world.clearance: room to the nearest blocker, <= 0 inside
  // one / on water, >= radius = free). A step is taken when the new point is free, or at least no tighter than where
  // we stand (so we can always walk OUT of a tight or bad spot, never deeper into one). A rejected step slides along
  // the field gradient; a head-on hit walks round the obstacle on one side, chosen once (sidleSide) and kept.
  const R = C.radius;
  const clearance = typeof world.clearance === 'function' ? (x, z) => world.clearance(x, z) : (x, z) => (world.isWalkable(x, z) ? R : -0.05);
  const room = (x, z) => { const c = clearance(x, z); return c > R ? R : c; };
  let curC = NaN; // clearance where we stand (NaN = unknown)
  let blocked = false; // sliding / sidling since the last run of free steps
  let freeRun = 0; // consecutive free sub-steps
  let stallRun = 0; // consecutive sub-steps with no movement at all
  let sidleSide = 1; // which way round an obstacle we are going (kept so it never flip-flops)

  let flipAt = 0; // stalled sub-steps needed before the committed side may be reversed (doubles per reversal)
  let stepUX = 0; let stepUZ = 1; // travel direction of the current sub-step (for the side test)

  // shortfall pass: state of "rounding an obstacle" (see update) and the outward normal of the clearance field at a point
  const fol = { on: false, done: false, ix: 0, iz: 0, t: 0, slow: 0, flips: 0, left: 0, ux: 0, uz: 1, prog: 0, hand: 1, tx: 1, tz: 0 };
  let folNX = 0; let folNZ = 0; let folN = 0;
  // fix 2026-11-18: the outline is traced in a band just OUTSIDE his radius (FOL_SEE), not with room() (clamped at R): pressed
  // against an edge (c == R, the only place tryStep lets him stand) the clamped field had no gradient, the follower lost the
  // outline, curled back into the prop and he stood there although the way round was wide open.
  const FOL_SEE = R + 0.22;
  const FOL_KEEP = R + 0.035; // room the follower keeps from the outline
  const roomF = (x, z) => { const c = clearance(x, z); return c > FOL_SEE ? FOL_SEE : c; };
  function folNormal(x, z) {
    let gx = 0; let gz = 0; let gl = 0;
    for (let e = 0.04; e < 0.2 && gl < 1e-4; e += 0.06) {
      gx = roomF(x + e, z) - roomF(x - e, z); gz = roomF(x, z + e) - roomF(x, z - e); gl = hypot2(gx, gz);
    }
    if (gl < 1e-4) { folN = 0; return; }
    folNX = gx / gl; folNZ = gz / gl; folN = 1;
  }

  /** A slide / sidle candidate. Steps to the side we are NOT committed to wait until we have been wedged for a moment:
   *  without this a concave pocket bounces the traveller between its two walls every frame. */
  function trySide(dx, dz) {
    const lat = dx * -stepUZ + dz * stepUX;
    const wrong = blocked && lat * sidleSide < -0.2 * hypot2(dx, dz);
    if (wrong && stallRun < flipAt) return false;
    if (!tryStep(dx, dz)) return false;
    if (wrong) { sidleSide = -sidleSide; flipAt = Math.min(flipAt * 2, 480); }
    stallRun = 0;
    return true;
  }

  function tryStep(dx, dz) {
    const p = group.position;
    const nx = p.x + dx;
    const nz = p.z + dz;
    const c = clearance(nx, nz);
    // round 3: world.clearance is boosted on a path strip (anything standable there is free), so the field has a SEAM at the
    // strip's edge: a drop far larger than the step (a true distance field falls by at most the step length). Standing free on
    // the path he may step across it onto standable ground (c > 0) - he was held there on every lane that passes a prop.
    if (c >= R || c >= curC || (c >= 0.05 && curC >= R && curC - c > hypot2(dx, dz) + 0.06)) { p.x = nx; p.z = nz; curC = c; return true; }
    return false;
  }

  /** Move by (dx,dz) with sliding. Returns true when the full displacement was applied. */
  function moveSlide(dx, dz) {
    const p = group.position;
    if (curC !== curC) curC = clearance(p.x, p.z);
    if (tryStep(dx, dz)) { stallRun = 0; if (++freeRun > 8) { blocked = false; flipAt = C.stallFlipSteps ?? 24; } return true; }
    freeRun = 0;
    const len = hypot2(dx, dz);
    if (len < 1e-9) return false;
    const ux = dx / len;
    const uz = dz / len;
    stepUX = ux; stepUZ = uz;
    if (flipAt === 0) flipAt = C.stallFlipSteps ?? 24;
    // outward normal of whatever is in the way: gradient of the (clamped) clearance just ahead of the feet
    const E = 0.06;
    const qx = p.x + ux * 0.04;
    const qz = p.z + uz * 0.04;
    let gx = room(qx + E, qz) - room(qx - E, qz);
    let gz = room(qx, qz + E) - room(qx, qz - E);
    let gl = hypot2(gx, gz);
    if (gl < 1e-4) { gx = room(p.x + E, p.z) - room(p.x - E, p.z); gz = room(p.x, p.z + E) - room(p.x, p.z - E); gl = hypot2(gx, gz); }
    if (gl < 1e-4) { gx = -ux; gz = -uz; gl = 1; }
    const nx = gx / gl;
    const nz = gz / gl;
    const dn = ux * nx + uz * nz;
    // tangent along the obstacle in the direction of travel
    let tx = ux - dn * nx;
    let tz = uz - dn * nz;
    let tl = hypot2(tx, tz);
    if (dn < 0 && tl >= 0.3) {
      // a clear glancing hit decides the side for the head-on case too (lateral sign of the slide)
      if (!blocked) sidleSide = tx * -uz + tz * ux >= 0 ? 1 : -1;
    } else {
      // head-on: go round on the roomier side, decided once per obstacle
      if (!blocked) {
        const a = room(p.x - uz * 0.3, p.z + ux * 0.3) + room(p.x - uz * 0.15, p.z + ux * 0.15);
        const b = room(p.x + uz * 0.3, p.z - ux * 0.3) + room(p.x + uz * 0.15, p.z - ux * 0.15);
        if (a > b + 1e-4) sidleSide = 1; else if (b > a + 1e-4) sidleSide = -1;
      }
      // perpendicular to the normal, on the chosen side of the travel direction
      tx = -nz; tz = nx;
      if ((tx * -uz + tz * ux) * sidleSide < 0) { tx = -tx; tz = -tz; }
      tl = 1;
    }
    const wasBlocked = blocked;
    blocked = true;
    tx /= tl; tz /= tl;
    // never slower than slideMin of the speed along the obstacle, never backwards against the input
    const k = len * Math.max(C.slideMin ?? 0.6, Math.min(1, tl));
    if (tx * ux + tz * uz > -0.05) {
      if (trySide((tx + nx * 0.12) * k, (tz + nz * 0.12) * k) || trySide(tx * k, tz * k) || trySide((tx + nx * 0.35) * k, (tz + nz * 0.35) * k)) return false;
    }
    // fan: turn away from the travel direction until something gives (committed side first; the other side
    // only on the first contact or after being wedged, see trySide)
    for (let pass = 0; pass < 2; pass++) {
      const sgn = pass === 0 ? sidleSide : -sidleSide;
      if (pass === 1 && wasBlocked && stallRun < flipAt) break;
      for (let i = 0; i < 3; i++) {
        const a = sgn * (i === 0 ? 0.6 : i === 1 ? 1.05 : 1.45);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const f = len * Math.max(C.slideMin ?? 0.6, ca);
        if (trySide((ux * ca - uz * sa) * f, (ux * sa + uz * ca) * f)) return false;
      }
    }
    // wedged in a pocket (two props meeting in a corner, a prop against a bank): he simply stops, without jitter
    stallRun++;
    return false;
  }

  // ---- pose ---------------------------------------------------------------------------------------
  function setHinge(rec, angle) {
    if (rec) rec.pivot.quaternion.setFromAxisAngle(rec.axisX, angle);
  }

  function applyPose() {
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);
    const idle = 1 - gait;
    const breathe = Math.sin(clock * TWO_PI * C.idleHz);
    const breathe2 = Math.sin(clock * TWO_PI * C.idleHz * 0.63 + 1.3);
    const idleSway = C.idleSwayDeg * DEG * idle;

    rig.position.y = C.hopHeight * gait * Math.abs(sinP);
    rig.rotation.set(
      lean + idleSway * 0.5 * breathe2,
      C.twistDeg * DEG * gait * sinP,
      roll + C.waddleDeg * DEG * gait * sinP + idleSway * breathe,
    );

    const leg = C.legSwingDeg * DEG * gait * cosP;
    setHinge(legL, -leg);
    setHinge(legR, leg);
    const arm = C.armSwingDeg * DEG * gait * cosP;
    const armIdle = idleSway * 1.5 * breathe2;
    setHinge(armL, arm * armLFactor + armIdle);
    setHinge(armR, -arm * armRFactor - armIdle);
    // secondary motion: the torso (pack) rocks back as each hop takes off and catches up on landing,
    // the head / hat follows about one frame later
    const lag = C.secondaryLag ?? 1.2;
    setHinge(torso, (C.torsoLagDeg ?? 0) * DEG * gait * Math.sin(phase * 2 - lag));
    setHinge(head, C.headNodDeg * DEG * (gait * Math.sin(phase * 2 - lag - (C.hatLag ?? 0.7)) + idle * 0.5 * breathe));
    if (lantern) {
      _q.setFromAxisAngle(lantern.axisX, lanX);
      _q2.setFromAxisAngle(lantern.axisZ, lanZ);
      lantern.pivot.quaternion.multiplyQuaternions(_q, _q2);
    }
    group.rotation.y = heading;
  }

  function resetPose() {
    phase = 0; gait = 0; lean = 0; leanVel = 0; roll = 0; rollVel = 0;
    lanX = 0; lanVX = 0; lanZ = 0; lanVZ = 0; prevForward = 0; yawRate = 0; actualSpeed = 0;
    curC = NaN; blocked = false; freeRun = 0; stallRun = 0; flipAt = 0;
    fol.on = false; fol.done = false; fol.t = 0;
  }

  const gaitInfo = { phase: 0, blend: 0, lean: 0, roll: 0, hop: 0, lanternX: 0, lanternZ: 0, yawRate: 0 };

  const api = {
    group,
    model,
    rig,
    /** Named parts that were found and are animated: { leg_l: {part, pivot}, ... } */
    parts,
    /** World position (feet). Same object as group.position. */
    position: group.position,
    velocity,
    /** Unit vector of the last movement direction on XZ (never zero). */
    moveDir,
    get heading() { return heading; },
    get speed() { return actualSpeed; },
    /** Walk-cycle state for checks: phase (rad, a foot lands at k*PI), blend 0..1, lean/roll (rad). */
    get gait() {
      gaitInfo.phase = phase; gaitInfo.blend = gait; gaitInfo.lean = lean; gaitInfo.roll = roll;
      gaitInfo.hop = rig.position.y; gaitInfo.lanternX = lanX; gaitInfo.lanternZ = lanZ; gaitInfo.yawRate = yawRate;
      return gaitInfo;
    },
    /** Collision state for checks: { c: clearance here, blocked, side, stall }. */
    get collide() { return { c: curC, blocked, side: sidleSide, stall: stallRun, rounding: fol.on, gaveUp: fol.done }; },
    /** True if the feet may stand at world (x,z). */
    canStand(x, z) { return world.isWalkable(x, z); },
    /** True if the whole body fits at world (x,z) (clearance >= radius): what click-to-walk routes through. */
    canPass(x, z) { return clearance(x, z) >= R; },
    /** Ground height (world Y) at (x,z). */
    groundAt(x, z) { return world.heightAt(x, z) || 0; },
    /** @param {{x:number,z:number}} input desired world-space move direction, length 0..1 */
    update(dt, input) {
      if (!(dt > 0)) return;
      clock += dt;
      let ix = (input && input.x) || 0;
      let iz = (input && input.z) || 0;
      const il = hypot2(ix, iz);
      if (il > 1) { ix /= il; iz /= il; }

      // -- shortfall pass: rounding an obstacle. Held against a wall, a corner or a bank for roundAfter seconds, he follows
      // its outline (the contour of the clearance field, one hand kept) until he is past the point where he was held and
      // the way on is free, then walks on. Gives up after roundMax units; a new input direction starts afresh.
      const SPD = C.speed * (state.speedMul || 1); // Shift = run, Ctrl toggle = stroll (controls.js)
      let wx = ix; let wz = iz; let wsp = SPD;
      if (C.round !== false) {
        const q = group.position;
        const iN = il > 1 ? 1 : il;
        if (iN < 0.5 || ((fol.on || fol.done) && ix * fol.ux + iz * fol.uz < 0.92 * iN)) { fol.on = false; fol.done = false; fol.t = 0; }
        if (fol.done && q.x * fol.ux + q.z * fol.uz > fol.prog + 0.15) fol.done = false;
        if (!fol.on && !fol.done && iN >= 0.5) {
          // held = pushing one way, hardly moving, and the step ahead is not free (never on open ground: starts, turns)
          const same = ix * fol.ix + iz * fol.iz > 0.92 * iN;
          fol.ix = ix / iN; fol.iz = iz / iN;
          if (same && blocked && actualSpeed < 0.15 * C.speed && room(q.x + fol.ix * 0.1, q.z + fol.iz * 0.1) < R) fol.t += dt; else fol.t = 0;
          if (fol.t >= (C.roundAfter ?? 0.3)) {
            fol.on = true; fol.t = 0; fol.slow = 0; fol.flips = 0; fol.left = C.roundMax ?? 4;
            fol.ux = ix / iN; fol.uz = iz / iN; fol.prog = q.x * fol.ux + q.z * fol.uz;
            folNormal(q.x + fol.ux * 0.04, q.z + fol.uz * 0.04);
            if (folN === 0) { folNX = -fol.ux; folNZ = -fol.uz; }
            // the hand that agrees with the side the slide was already committed to
            fol.hand = (-folNZ * -fol.uz + folNX * fol.ux) * sidleSide >= 0 ? 1 : -1;
            fol.tx = -folNZ * fol.hand; fol.tz = folNX * fol.hand;
          }
        }
        if (fol.on) {
          const rc = roomF(q.x, q.z);
          folNormal(q.x, q.z);
          let fx; let fz;
          if (folN > 0 && rc < FOL_SEE) {
            fol.tx = -folNZ * fol.hand; fol.tz = folNX * fol.hand;
            let g = ((FOL_KEEP - rc) / R) * 2.5; // keep FOL_KEEP of room: out when tighter, in when looser
            if (g < -0.8) g = -0.8; else if (g > 1.2) g = 1.2;
            fx = fol.tx + folNX * g; fz = fol.tz + folNZ * g;
          } else { fx = fol.tx * 0.75 + fol.ux * 0.65; fz = fol.tz * 0.75 + fol.uz * 0.65; } // lost the outline (convex corner): curl back toward it
          const fl = hypot2(fx, fz) || 1;
          wx = (fx / fl) * iN; wz = (fz / fl) * iN; wsp = SPD * (C.roundSpeed ?? 0.8);
          if (q.x * fol.ux + q.z * fol.uz > fol.prog + 0.15 && room(q.x + fol.ux * 0.14, q.z + fol.uz * 0.14) >= R - 1e-3 && room(q.x + fol.ux * 0.28, q.z + fol.uz * 0.28) >= R - 1e-3) {
            fol.on = false; wx = ix; wz = iz; wsp = SPD; // past it and the way on is free
          } else {
            if (actualSpeed < 0.12 * C.speed) {
              fol.slow += dt;
              if (fol.slow > 0.45) { // held again while following: the other way round once, then he stops
                if (fol.flips++ === 0) { fol.hand = -fol.hand; fol.tx = -fol.tx; fol.tz = -fol.tz; fol.slow = 0; } else { fol.on = false; fol.done = true; }
              }
            } else fol.slow = 0;
            fol.left -= actualSpeed * dt;
            if (fol.left <= 0) { fol.on = false; fol.done = true; }
          }
        }
      }

      // -- velocity: constant-rate approach to the desired velocity (snappy start, clean stop)
      const v0x = velocity.x;
      const v0z = velocity.z;
      const dvx = wx * wsp - velocity.x;
      const dvz = wz * wsp - velocity.z;
      const dvl = hypot2(dvx, dvz);
      const maxDv = C.accel * dt;
      if (dvl <= maxDv) { velocity.x = wx * wsp; velocity.z = wz * wsp; } else { velocity.x += (dvx / dvl) * maxDv; velocity.z += (dvz / dvl) * maxDv; }

      // -- heading follows the input direction (or the remaining velocity while coasting)
      let dh = 0;
      const sp0 = hypot2(velocity.x, velocity.z);
      if (il > 0.05 || sp0 > 0.5) {
        const want = il > 0.05 ? Math.atan2(wx, wz) : Math.atan2(velocity.x, velocity.z);
        let d = want - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        dh = d * (1 - Math.exp(-C.turnRate * dt));
        heading += dh;
        if (heading > Math.PI) heading -= TWO_PI; else if (heading < -Math.PI) heading += TWO_PI;
      }
      yawRate += (dh / dt - yawRate) * (1 - Math.exp(-20 * dt));

      // -- move with sliding collision (sub-stepped so thin obstacles cannot be skipped)
      const p = group.position;
      const ox = p.x;
      const oz = p.z;
      let moved = 0;
      // trapezoidal step (mean of old and new velocity): the path is the same at 30, 60 or 144 Hz
      const mvx = (v0x + velocity.x) * 0.5;
      const mvz = (v0z + velocity.z) * 0.5;
      const mvl = hypot2(mvx, mvz);
      if (mvl > 1e-4 || sp0 > 1e-4) {
        const len = mvl * dt;
        const n = Math.max(1, Math.ceil(len / 0.03));
        const sx = (mvx * dt) / n;
        const sz = (mvz * dt) / n;
        let free = true;
        curC = NaN; // the world may have changed under us (tiles, biome fields): re-read where we stand
        for (let i = 0; i < n; i++) if (!moveSlide(sx, sz)) free = false;
        const mx = p.x - ox;
        const mz = p.z - oz;
        moved = hypot2(mx, mz);
        if (!free) { velocity.x = mx / dt; velocity.z = mz / dt; } // keep only what the obstacle allowed
      } else { velocity.x = 0; velocity.z = 0; }
      actualSpeed = moved / dt;
      if (actualSpeed > 0.2) moveDir.set((p.x - ox) / moved, 0, (p.z - oz) / moved);

      // -- ground height (bridge decks), smoothed so steps in heightAt do not pop
      const gy = world.heightAt(p.x, p.z) || 0;
      groundY += (gy - groundY) * (1 - Math.exp(-C.heightRate * dt));
      if (Math.abs(gy - groundY) < 1e-4) groundY = gy;
      p.y = groundY;

      // -- gait phase + footfalls (driven by the distance really covered, so feet never skate)
      const speedFrac = Math.min(1, actualSpeed / C.speed);
      const gaitTarget = Math.min(1, speedFrac / 0.55);
      gait += (gaitTarget - gait) * (1 - Math.exp(-C.gaitRate * dt));
      if (gait < 1e-4 && gaitTarget === 0) gait = 0;
      if (moved > 1e-6) {
        const before = phase;
        phase += (moved / C.stepLength) * Math.PI;
        let foot = -1;
        if (before < Math.PI && phase >= Math.PI) foot = 1;
        if (phase >= TWO_PI) { phase -= TWO_PI; foot = 0; }
        if (foot >= 0 && actualSpeed > 0.3) {
          bus.emit('step', { x: p.x, z: p.z, foot, speed: actualSpeed, surface: world.surfaceAt ? world.surfaceAt(p.x, p.z) : 'grass' });
        }
      } else if (phase !== 0) {
        // standing: bring the feet together under the body without a footfall
        const rest = Math.round(phase / Math.PI) * Math.PI;
        phase += (rest - phase) * (1 - Math.exp(-14 * dt));
        if (Math.abs(rest - phase) < 1e-3) phase = rest >= TWO_PI ? 0 : rest;
      }

      // -- lean (forward) and roll (into turns): springs, sub-stepped for frame-rate independence
      const fwdX = Math.sin(heading);
      const fwdZ = Math.cos(heading);
      const forward = velocity.x * fwdX + velocity.z * fwdZ;
      const accF = Math.max(-C.accel, Math.min(C.accel, (forward - prevForward) / dt));
      prevForward = forward;
      const accL = Math.max(-C.accel, Math.min(C.accel, actualSpeed * yawRate));
      const leanTarget = C.leanDeg * DEG * Math.max(-0.4, Math.min(1, forward / C.speed));
      const rollMax = C.turnLeanDeg * DEG;
      const rollTarget = Math.max(-rollMax, Math.min(rollMax, -yawRate * C.turnLeanGain)) * speedFrac;
      const wl = TWO_PI * C.leanHz;
      const wp = TWO_PI * C.lanternHz;
      const lanTX = C.lanternDrive * accF + C.lanternGaitDeg * DEG * gait * Math.sin(phase);
      const lanTZ = -C.lanternDrive * accL + C.lanternGaitDeg * 0.6 * DEG * gait * Math.cos(phase);
      const sub = Math.max(1, Math.ceil(dt * 120));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        leanVel += (wl * wl * (leanTarget - lean) - 2 * C.leanDamping * wl * leanVel) * h;
        lean += leanVel * h;
        rollVel += (wl * wl * (rollTarget - roll) - 2 * 0.6 * wl * rollVel) * h;
        roll += rollVel * h;
        lanVX += (wp * wp * (lanTX - lanX) - 2 * C.lanternDamping * wp * lanVX) * h;
        lanX += lanVX * h;
        lanVZ += (wp * wp * (lanTZ - lanZ) - 2 * C.lanternDamping * wp * lanVZ) * h;
        lanZ += lanVZ * h;
      }
      const lanMax = C.lanternMaxDeg * DEG;
      if (lanX > lanMax) { lanX = lanMax; lanVX = 0; } else if (lanX < -lanMax) { lanX = -lanMax; lanVX = 0; }
      if (lanZ > lanMax) { lanZ = lanMax; lanVZ = 0; } else if (lanZ < -lanMax) { lanZ = -lanMax; lanVZ = 0; }

      applyPose();
    },
    /** Instantly move to world (x,z), zero velocity. Optional facing direction (dx,dz). */
    teleport(x, z, dx, dz) {
      groundY = world.heightAt(x, z) || 0;
      group.position.set(x, groundY, z);
      velocity.set(0, 0, 0);
      resetPose();
      if (dx !== undefined && (dx || dz)) {
        const l = hypot2(dx, dz);
        moveDir.set(dx / l, 0, dz / l);
        heading = Math.atan2(moveDir.x, moveDir.z);
      }
      applyPose();
    },
    dispose() { scene.remove(group); },
  };
  applyPose();
  return api;
}
