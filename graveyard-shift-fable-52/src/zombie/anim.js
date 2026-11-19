// Procedural zombie animation. Nothing is keyed joint by joint: every frame the animator decides
// where the pelvis is, how the spine and head are turned, and where the two feet and two hands
// are, then solves all four limbs by two-bone IK.
//
// Layers, in order:
//   feet     planted feet are locked in WORLD space, so they cannot slide whatever the root does;
//            a gait clock (cadence = speed / step length) lifts each foot in turn and swings it to
//            where the body will be; heel strike, flat, heel-off roll about the heel and the ball
//   pelvis   carried between the feet: sways over the planted foot, drops on the swinging side,
//            turns with the stride, and sinks when the legs are spread (never over-extends a leg):
//            it starts down in the second half of a swing toward the height the landing needs, so
//            each step is a fall onto the leading foot and a rise over it, with no corner in it
//   weight   the root's turning and its change of pace are measured each frame: a turn reaches the
//            body from the ground up (feet step round, pelvis, chest, the head last and a little
//            past), banked into; picking up speed throws the trunk forward, stopping rocks it back
//   spine    lean and hunch from the seed, shoulders counter-rotating the pelvis, lurch over the
//            stance leg; head forward and lolling
//   arms     hang by gravity and trail on springs; rise toward the target when it is near
//   springs  secondary motion and hit reactions: head, chest, pelvis, hands, leg buckle
//   clips    the fence climb is keyed limb-end poses (animClips.js) played through the same IK
//   collapse a small ragdoll (ragdoll.js): the body falls under gravity and the bones follow it
// rootSpeed is the ground speed the feet are producing this frame along the facing direction; the
// caller moves the root by exactly that so body and feet agree.
import { B, solveFK } from './skeleton.js';
import { createRng } from '../core/rng.js';
import { qEuler, qMul, qInvMul, vRot, qFromTo, qBasis, ik2, clamp, smooth, lerp, springTo } from './ik.js';
import { climbKeys, windowKeys, buildClip, clipAt } from './animClips.js';
import { createRagdoll, R as RG } from './ragdoll.js';
import { ensureGore } from './gore.js';

const TAU = Math.PI * 2;
const ID_Q = new Float32Array([0, 0, 0, 1]);
const ZERO3 = [0, 0, 0];
const _v = new Float32Array(3), _q = new Float32Array(16), _seg = { a: null, b: null, u: 0 };
const LEG = [{ b1: B.thighL, b2: B.shinL, end: B.footL, toe: B.toeL, side: 1 }, { b1: B.thighR, b2: B.shinR, end: B.footR, toe: B.toeR, side: -1 }];
const ARM = [
  { clav: B.clavL, b1: B.upperArmL, b2: B.foreArmL, end: B.handL, fa: B.fingAL, fb: B.fingBL, th: B.thumbL, side: 1 },
  { clav: B.clavR, b1: B.upperArmR, b2: B.foreArmR, end: B.handR, fa: B.fingAR, fb: B.fingBR, th: B.thumbR, side: -1 },
];
// the bone each ragdoll point starts on (ragdoll.js start)
const SWELL = [B.hips, B.spine1, B.spine2];
const TIP_TOP = [3, 4, 5, 6];   // shoulders, neck, head
const RAG_J = [B.thighL, B.thighR, B.spine1, B.upperArmL, B.upperArmR, B.neck, B.head, B.foreArmL, B.handL, B.foreArmR, B.handR, B.shinL, B.footL, B.shinR, B.footR];
// a - b brought into (-pi, pi]
const angDiff = (a, b) => { let d = a - b; if (d > Math.PI || d < -Math.PI) d -= TAU * Math.round(d / TAU); return d; };
// the lower of two heights with the corner between them rounded off over k (never above either)
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const SWING_MAX = 0.62;   // s: the longest a walking foot hangs in the air, however slow the walk
const STRIDE = 1.22;   // a walker's step against the step length its seed draws: long slow steps, not a patter
const xyz = (p, i) => (p ? (p.x !== undefined ? (i === 0 ? p.x : i === 1 ? p.y : p.z) : p[i]) : 0);

// Bare feet have a few toe-tip vertices that carry no weights and so follow the hips (body files,
// the body builder). Standing, the hips are over the feet and it does not show; lying, crawling or thrown,
// they draw a spike from the toes to the pelvis. Give them to the toe bone, once per shared geometry.
function mendToes(zombie) {
  const g = zombie.mesh && zombie.mesh.geometry;
  if (!g || !g.attributes || !g.attributes.skinIndex || g.userData.toesMended) return;
  g.userData.toesMended = true;
  const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  let n = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.getY(i) > 0.12 || SW.getX(i) < 0.99 || SI.getX(i) !== B.hips) continue;
    SI.setX(i, P.getX(i) >= 0 ? B.toeL : B.toeR); n++;
  }
  if (n) SI.needsUpdate = true;
}

export const STATES = ['idle', 'walk', 'run', 'crawl', 'attack', 'slam', 'stagger', 'climb', 'window', 'tear', 'burst', 'dead'];
// How long each timed state lasts (s), for the AI's timeouts (tests): the climbs must end inside tuning.zombies.climbMax
export const DURATION = { attack: 1.55, slam: 1.55, stagger: 0.8, climb: 2.78, window: 2.8, tear: 0.85, burst: 0.8 };

export function createAnimator(zombie) {
  const { pose } = zombie;
  const bones = zombie.skeleton.bones;
  const { off, lq, wq, wp } = pose;   // wq / wp hold MODEL-space transforms (root at the origin)
  const worldPose = { ...pose, wq: new Float32Array(wq.length), wp: new Float32Array(wp.length) };
  const rng = createRng(((zombie.seed | 0) + 7919) | 0).fork('anim');
  const hS = zombie.proportions ? zombie.proportions.height : 1;
  const len = (b) => Math.hypot(off[b * 3], off[b * 3 + 1], off[b * 3 + 2]);
  const L1 = len(B.shinL), L2 = len(B.footL), A1 = len(B.foreArmL), A2 = len(B.handL);
  const LEGLEN = L1 + L2, ARMLEN = A1 + A2;
  const ankleH = 0.092 * hS, heelBack = 0.075 * hS, ballFwd = 0.13 * hS;
  const hipY = off[B.thighL * 3 + 1];
  const pelvisR = 0.112 * pose.scale[B.hips * 3 + 2];

  // rest-direction corrections so IK lands the end joint exactly on its target
  const corr = new Float32Array(32);
  [[B.shinL, 0], [B.footL, 1], [B.shinR, 2], [B.footR, 3], [B.foreArmL, 4], [B.handL, 5], [B.foreArmR, 6], [B.handR, 7]].forEach(([c, k]) => {
    const l = len(c);
    qFromTo(corr, k * 4, off[c * 3] / l, off[c * 3 + 1] / l, off[c * 3 + 2] / l, 0, -1, 0);
  });

  // ---- the individual: posture and gait that never change for this zombie ------------------------
  const r = rng;
  const limpRoll = r.next();
  const ch = {
    lean: r.range(0.1, 0.3), hunch: r.range(0.08, 0.3), headFwd: r.range(0.12, 0.42),
    headRoll: r.range(-0.32, 0.32), headYaw: r.range(-0.25, 0.25),
    shoulderDrop: r.range(0.05, 0.17) * (r.next() < 0.5 ? -1 : 1), twist: r.range(-0.2, 0.2),
    crouch: r.range(0.962, 0.988), stanceW: r.range(0.085, 0.125) * hS,
    toeOut: [r.range(0.05, 0.42), r.range(0.05, 0.42)],
    limpSide: limpRoll < 0.3 ? -1 : limpRoll < 0.65 ? 0 : 1, limp: r.range(0.35, 1), drag: r.next() < 0.45,
    stepLen: r.range(0.46, 0.6) * (LEGLEN / 0.84), swing: r.range(0.34, 0.4), lurch: r.range(0.1, 0.3), lurchLean: r.range(0.04, 0.12),
    armOut: [r.range(0.03, 0.1), r.range(0.03, 0.1)], armFwd: [r.range(-0.03, 0.1), r.range(-0.03, 0.1)], armBend: [r.range(0.9, 0.985), r.range(0.9, 0.985)],
    reachStart: [r.range(2.6, 4.6), r.range(1.4, 3.2)], reachExt: [r.range(0.72, 0.9), r.range(0.55, 0.82)], reachDroop: [r.range(-0.22, 0.0), r.range(-0.32, -0.05)],
    domArm: r.next() < 0.5 ? 0 : 1, jaw: r.range(0.07, 0.22), jawSide: r.range(-0.2, 0.2), curl: [r.range(0.25, 0.8), r.range(0.25, 0.8)],
    armSwing: [r.range(0.2, 1.2), r.range(0.2, 1.2)], neckFwd: r.range(0.28, 0.5),
    attackStyle: r.int(0, 2), swayT: r.range(3, 5.5), swayA: r.range(0.02, 0.045), twitch: r.range(1.2, 3.5), pelvisTilt: r.range(0.03, 0.12),
  };
  if (ch.limpSide < 0) ch.limp = 0;
  if (r.next() < 0.5) { ch.reachStart.reverse(); ch.reachExt.reverse(); }
  if (zombie.look && zombie.look.severed) { const s = zombie.look.severed === 'L' ? 0 : 1; ch.reachStart[s] = 0.9; ch.domArm = 1 - s; }
  const isBrute = zombie.build === 'brute', isBloat = zombie.build === 'bloated', isArmoured = !!(zombie.gear && zombie.gear.armour);
  let gait = 'walk';   // the last way of going the manager asked for: walk | run | crawl
  let prone = 0;   // 0 on its feet .. 1 down on its forearms (a crawler)
  const sevArm = zombie.look && zombie.look.severed ? (zombie.look.severed === 'L' ? 0 : 1) : -1;
  // ---- the type: what the body is tells how it carries itself (the manager only names the gait)
  if (isArmoured) {
    // a vest and pads: the trunk is held stiff and upright, the arms stand off it, the step is even
    ch.lean *= 0.45; ch.hunch *= 0.3; ch.twist = 0; ch.lurch *= 0.4; ch.lurchLean *= 0.35; ch.shoulderDrop *= 0.3; ch.headRoll *= 0.4;
    ch.armOut[0] += 0.07; ch.armOut[1] += 0.07; ch.armSwing[0] *= 0.5; ch.armSwing[1] *= 0.5; ch.limp = 0; ch.limpSide = -1; ch.drag = false; ch.pelvisTilt *= 0.5;
  } else if (isBloat) {
    // wide and slow: the feet far apart and turned out, the weight rolled from one to the other, the
    // belly carried in front with the shoulders back, the arms held off the body
    ch.stanceW *= 1.75; ch.toeOut[0] = 0.5; ch.toeOut[1] = 0.5; ch.lean = -0.04; ch.hunch = 0.12; ch.pelvisTilt = -0.06;
    ch.stepLen *= 0.72; ch.armOut[0] = 0.2; ch.armOut[1] = 0.2; ch.swayA = 0.06; ch.limp = 0; ch.limpSide = -1; ch.drag = false; ch.lurch = 0.12; ch.lurchLean = 0.2;
  } else if (isBrute) {
    ch.stanceW *= 1.5; ch.lean = 0.26; ch.hunch = 0.3; ch.limp = 0; ch.limpSide = -1; ch.drag = false; ch.lurch = 0.22; ch.lurchLean = 0.16;
    ch.armOut[0] = 0.2; ch.armOut[1] = 0.2; ch.armFwd[0] = 0.14; ch.armFwd[1] = 0.1; ch.armBend[0] = 0.93; ch.armBend[1] = 0.93; ch.toeOut[0] = 0.3; ch.toeOut[1] = 0.3;
  }
  const waddle = isBloat ? 2.3 : isBrute ? 1.5 : 1;
  const stiff = isArmoured ? 0.5 : isBrute ? 1.7 : 1;
  const stiff2 = isArmoured ? 0.4 : 1;   // how loosely the trunk and head are carried
  // the trunk a bloater swells (and a pooled body is given back as it was built)
  if (!zombie.baseScale) zombie.baseScale = pose.scale.slice();
  else pose.scale.set(zombie.baseScale);
  const stand = LEGLEN * ch.crouch + ankleH - hipY;
  const REACH2 = (LEGLEN * 0.992) ** 2, RISE = 0.3 * hS * (isBrute ? 1.5 : 1);

  // ---- state -----------------------------------------------------------------------------------
  let state = 'idle', sT = 0, time = r.range(0, 10), started = false, settled = false;
  let Rx = 0, Ry = 0, Rz = 0, yaw = 0, cy = 1, sy = 0;
  let vCur = 0, phase = r.next(), cycleT = 1, prevSpeed = 0, rootAcc = 0;
  let gaitOn = false;                    // the walking clock is running
  let yawPrev = 0, turnW = 0, accS = 0;   // rad/s the root is being turned, m/s^2 its pace is changing (both smoothed)
  let turnLive = false;
  const sTurn = new Float32Array(4);     // how far the chest and the head trail a turn: [x, v] pairs
  let target = null, lookYaw = 0, lookPitch = 0, tDist = 99;
  const targetBuf = [0, 0, 0], _dir = [0, 0, -1];
  const rag = createRagdoll();
  const rq = new Float32Array(56);   // collapse: frames and bone rotations captured at the moment of death
  let nextTwitch = time + r.range(0.5, 3), stepCool = 0, tick = 0, accDt = 0;
  let clipT0 = 0.45, slamHit = false;
  let clip = null, clipEnd = 0, clipMom = 0, clipYaw0 = 0, clipX0 = 0, clipZ0 = 0, clipSpeed = 0;
  let atkArm = 0, atkStyle = 0, atkTravel = 0.5, atkHit = false, onHit = null, stagDir = -1;
  const pending = [false, false];
  // feet: world plant point, yaw, swing bookkeeping, and this frame's ankle in model space
  const foot = [0, 1].map((i) => ({
    side: i === 0 ? 1 : -1, px: 0, pz: 0, yaw: 0, planted: true, s: 0, dur: 0.4, sx: 0, sz: 0, syaw: 0, tx: 0, tz: 0, mode: 0, lift: 0.05,
    st: 0, sd: 0.6, walkPlant: false, push: 0, lx: 0, lz: 0, lf: 0, lu: ankleH, hold: 0.4, cap: 0.5, ax: 0, ay: ankleH, az: 0, pitch: 0, roll: 0, myaw: 0, y: 0, sup: 1, poleY: 0, bad: false,
  }));
  if (ch.limpSide >= 0) foot[ch.limpSide].bad = true;
  // smoothed body pose
  const pel = new Float32Array([0, stand, 0, 0, 0, 0]), pelT = new Float32Array(6);
  const sp = new Float32Array(5), spT = new Float32Array(5);
  const hd = new Float32Array(5), hdT = new Float32Array(5);
  // springs: [x, v] pairs
  const sHead = new Float32Array(6), sChest = new Float32Array(6), sPel = new Float32Array(6), sBuckle = new Float32Array(4);
  const hand = [0, 1].map(() => ({ s: new Float32Array(6), tx: 0, ty: 0, tz: 0, pole: [0, 0, -1], wrist: 0.15, curl: 0.4, w: 0, init: false }));
  const footKey = [new Float32Array(7), new Float32Array(7)];

  const api = {
    rootSpeed: 0, done: false, settled: false, onStep: null, lod: 0, states: STATES,
    get state() { return state; },
    get gait() { return gait; },
    get prone() { return prone; },
    get time() { return sT; },
    character: ch,
    feet: foot,   // read-only view for tests: planted flags and world plant points
    ragdoll: rag, // read-only view for tests: the fallen points (model space) once dead
    // state: 'idle' | 'walk' | 'attack' | 'stagger' | 'climb' | 'dead'
    // opts: target ({x,y,z} | [x,y,z] | null) for any state; attack: { onHit, arm: 0|1 };
    //       stagger: { dir, part }; climb: { height (m, default 1.2), distance (m to the fence, default 0.35) };
    //       dead: { dir, impulse }
    set(next, opts = {}) {
      if (state === 'dead') return;
      if (opts.target !== undefined) api.setTarget(opts.target);
      // leaving an attack early: the hands go back to the body and the lunge offsets are dropped
      if ((state === 'attack' || state === 'slam' || state === 'tear' || state === 'burst') && next !== state) endAttack();
      if (next === 'dead') { api.collapse(opts.dir, opts.impulse); return; }
      if (next === 'walk' || next === 'run' || next === 'crawl') gait = next;
      // a bloater's fuse has run out: the second 'burst' is the burst itself
      if (next === 'burst' && state === 'burst') { if (sT > 0.4) api.collapse(null, 1, 'burst'); return; }
      if (next === 'tear' && state === 'tear' && !api.done) return;
      if (next === 'slam') {
        if (state === 'slam' && !api.done) return;
        atkHit = false; onHit = opts.onHit || null; slamHit = false;
      }
      if (next === 'window') {
        if (!started) init();
        const h = opts.sill ?? opts.height ?? 1.0, d0 = opts.depth ?? opts.distance ?? 0.35;
        clip = buildClip(windowKeys(h, d0, stand, ankleH), capture(), 1, false);
        clipEnd = clip[clip.length - 1].t; clipYaw0 = yaw; clipX0 = Rx; clipZ0 = Rz; clipMom = 0; clipT0 = 0.4;
        clipSpeed = (d0 + 0.62) / (clipEnd - clipT0);
        prone = 0; gait = gait === 'crawl' ? 'crawl' : gait;
      }
      if (next === 'attack') {
        if (state === 'attack' && !api.done) return;
        atkArm = opts.arm ?? ch.domArm; atkStyle = ch.attackStyle; atkHit = false; onHit = opts.onHit || null;
        atkTravel = -1;
        atkScale = isBrute ? 1.2 : gait === 'run' ? 0.7 : 1; atkLunge = gait === 'run' && !isBrute ? 1.5 : 1;
      } else if (next === 'stagger') {
        const d = toModelDir(opts.dir);
        stagDir = d[2] <= 0.2 ? -1 : 1;
        api.hitReact(opts.part || 'torso', opts.dir, 2.2);
      } else if (next === 'climb') {
        if (!started) init();
        const h = opts.height ?? 1.2, d0 = opts.distance ?? 0.35;
        clip = buildClip(climbKeys(h, d0, stand, ankleH), capture(), 1, false);
        clipEnd = clip[clip.length - 1].t; clipYaw0 = yaw; clipX0 = Rx; clipZ0 = Rz; clipMom = 0;
        clipT0 = 0.45; clipSpeed = (d0 + 0.56) / (clipEnd - clipT0);
      } else if (next === state && !api.done) return;
      state = next; sT = 0; api.done = false;
    },
    // where the prey is (world), or null. Drives head look and reaching arms.
    setTarget(p) {
      if (!p) { target = null; return; }
      targetBuf[0] = xyz(p, 0); targetBuf[1] = xyz(p, 1); targetBuf[2] = xyz(p, 2); target = targetBuf;
    },
    // additive flinch. part: head | torso | armL | armR | legL | legR. dir: world direction the hit travels.
    hitReact(part, dir, k = 1) {
      const d = toModelDir(dir);
      const dx = d[0], dz = d[2];
      const side = part.endsWith('L') ? 1 : part.endsWith('R') ? -1 : (r.next() < 0.5 ? 1 : -1);
      if (part === 'head') {
        sHead[1] += dz * 9 * k; sHead[5] += -dx * 7 * k + side * 2 * k; sHead[3] += side * 3 * k;
        sChest[1] += dz * 2.2 * k;
      } else if (part === 'torso') {
        sChest[1] += dz * 5.5 * k; sChest[3] += side * 3 * k; sChest[5] += -dx * 4 * k;
        sPel[1] += dx * 0.9 * k; sPel[5] += dz * 1.1 * k; sHead[1] += -dz * 4 * k;
      } else if (part.startsWith('arm')) {
        const h = hand[side > 0 ? 0 : 1];
        h.s[1] += dx * 3.5 * k; h.s[3] += 1.2 * k; h.s[5] += dz * 4.5 * k;
        sChest[3] += -side * dz * 4.5 * k; sChest[1] += dz * 1.5 * k;
      } else {
        sBuckle[side > 0 ? 1 : 3] += 7 * k;
        sPel[5] += dz * 0.5 * k; sChest[1] += 2.2 * k; sChest[5] += -side * 2 * k;
      }
    },
    // die. dir: world direction the killing hit travels (default: from the front). impulse scales the
    // throw. style (optional): 'head' a headshot drop, 'crumple' a body shot, 'spin' a close shotgun
    // blast, 'blast' thrown by an explosion, 'tumble' killed at a run, 'crawl' killed on the ground,
    // 'brute' the boss going down, 'burst' a bloater's own burst. Without one it is chosen from what
    // the body was doing. Every number below is drawn from the zombie's seed, so neighbours killed by
    // the same shot never fall alike.
    collapse(dir, impulse = 1, style) {
      if (state === 'dead') return;
      if (!started) init();
      if (state === 'attack' || state === 'slam' || state === 'tear') endAttack();
      fallDir[0] = xyz(dir, 0); fallDir[1] = 0; fallDir[2] = xyz(dir, 2); fallHas = !!dir; fallImp = impulse; fallV = vCur;
      startFall(style || autoStyle());
      state = 'dead'; sT = 0; api.done = false; api.rootSpeed = 0; vCur = 0;
    },
    // the killing hit turned out to be something else (the event with its weapon and part arrives
    // after the manager has already called collapse): fall that way instead. Only before the body has moved.
    restyle(style, dir, impulse) {
      if (state !== 'dead' || sT > 0.051 || !style || style === api.deathStyle) return false;
      if (dir) { fallDir[0] = xyz(dir, 0); fallDir[2] = xyz(dir, 2); fallHas = true; }
      if (impulse !== undefined) fallImp = impulse;
      // the boss is too heavy to be thrown or spun, and a body on the ground stays on it
      if (isBrute || api.deathStyle === 'crawl' || api.deathStyle === 'burst') return false;
      startFall(style);
      return true;
    },
    deathStyle: '',
    update,
  };

  // ---- dying -----------------------------------------------------------------------------------------
  const fallDir = [0, 0, -1];
  let fallHas = false, fallImp = 1, fallV = 0, kickN = 0, kickAt = 0;
  const kicks = new Float32Array(8 * 5);     // [time, point, vx, vy, vz] x 8, in time order
  const fv = new Float32Array(15 * 3);       // starting velocity of each ragdoll point
  const addV = (i, x, y, z) => { fv[i * 3] += x; fv[i * 3 + 1] += y; fv[i * 3 + 2] += z; };
  const later = (t, i, x, y, z) => { if (kickN < 8) { const o = kickN++ * 5; kicks[o] = t; kicks[o + 1] = i; kicks[o + 2] = x; kicks[o + 3] = y; kicks[o + 4] = z; } };
  const fallOpts = { calm: 1.2, slack: 1, size: 1 };
  function autoStyle() {
    if (isBrute) return 'brute';
    if (prone > 0.5) return 'crawl';
    if (fallV > 2.2) return 'tumble';
    return 'crumple';
  }
  // the floor under a fallen point: the level's own (stairs, kerbs, the drop off a step), relative to the root
  function floorAt(mx, my, mz) {
    const h = levelFloor(toWorldX(mx, mz), toWorldZ(mx, mz), Ry + Math.min(my, 0.45) + 0.2) - Ry;
    return h > 0.45 ? 0 : h < -1.5 ? -1.5 : h;
  }
  function startFall(style) {
    api.deathStyle = style;
    readRoot();
    const d = toModelDir(fallHas ? fallDir : null);
    let dx = d[0], dz = d[2];
    // what it can fall against: the level's boxes near the root. Something close in the way of the
    // throw shortens it, so the body goes down against the pump or the car instead of being flung at it
    rag.world(zombie.colliders, Rx, Ry, Rz, yaw);
    const lf = typeof globalThis !== 'undefined' && globalThis.__G && globalThis.__G.level && typeof globalThis.__G.level.heightAt === 'function' ? globalThis.__G.level.heightAt : null;
    levelFloor = lf; rag.floor = lf ? floorAt : null;
    const clear = Math.min(rag.ray(0, 1.15 * hS, 0, dx, dz, 1.6), rag.ray(0, 0.5 * hS, 0, dx, dz, 1.6));
    const room = clamp(clear / 1.6, 0.25, 1);
    let k = fallImp * room;
    const side = r.next() < 0.5 ? 1 : -1, s1 = r.range(-1, 1), s2 = r.range(0, 1), s3 = r.range(0, 1);
    const kneeA = r.next() < 0.5 ? RG.kneeL : RG.kneeR, kneeB = kneeA === RG.kneeL ? RG.kneeR : RG.kneeL;
    const shA = side > 0 ? RG.shL : RG.shR, shB = side > 0 ? RG.shR : RG.shL;
    const handA = side > 0 ? RG.handL : RG.handR, handB = side > 0 ? RG.handR : RG.handL;
    fv.fill(0); kickN = 0; kickAt = 0; tips = 0; tipAt = 0.8; tipSide = side; sprawled = false;
    for (let n = 0; n < 4; n++) sprawl[n] = r.range(0.25, 1);
    let pinT = r.range(0.12, 0.3);
    fallOpts.calm = 1.3; fallOpts.slack = 0.35; fallOpts.size = isBrute ? 1.3 : 1;
    const all = (x, y, z) => { for (let i = 0; i < 15; i++) addV(i, x, y, z); };
    const fwd = fallV * 0.9;
    if (style === 'head') {
      // the head is snapped the way the round went and everything under it lets go at once: both
      // knees fold, the pelvis drops straight down, and the trunk follows the head over
      all(0, 0, fwd * 0.6);
      addV(RG.head, dx * 4.6 * k, 0.9, dz * 4.6 * k); addV(RG.neck, dx * 2.4 * k, 0.3, dz * 2.4 * k);
      addV(shA, dx * (1.5 + s2) * k + side * (0.4 + 0.7 * s3), 0, dz * (1.5 + s2) * k); addV(shB, dx * 1.3 * k, 0, dz * 1.3 * k);
      addV(RG.waist, dx * 0.5 * k, -0.4, dz * 0.5 * k);
      addV(kneeA, side * 0.3, 0, 1.7 + 0.5 * s2); addV(kneeB, -side * 0.2, 0, 1.0 + 0.8 * s3);
      addV(RG.hipL, 0, -0.9, -0.2); addV(RG.hipR, 0, -0.9, -0.2);
      addV(handA, side * 0.9, 1.6 + s2, 0.4); addV(handB, -side * 0.6, 1.0 + s3, 0.2);
      later(0.14, kneeB, 0, 0, 1.2); later(0.2, shA, dx * 1.2 * k - side * 0.3, -0.4, dz * 1.2 * k); later(0.2, shB, dx * 1.2 * k, -0.4, dz * 1.2 * k);
      later(0.36, RG.footL, 0, -1.4, 0); later(0.36, RG.footR, 0, -1.4, 0);
      pinT = r.range(0.2, 0.34); fallOpts.slack = 0.15;
    } else if (style === 'spin') {
      // a load of shot in one shoulder: that side is torn round and back, the feet leave the ground,
      // the arms are flung out and it lands a body length away, turned over
      all(dx * 2.3 * k, 0.5 + 0.4 * s2, dz * 2.3 * k + fwd * 0.3);
      addV(shA, dx * 3.4 * k, 0.6, dz * 3.4 * k); addV(shB, -dx * 2.1 * k, -0.2, -dz * 2.1 * k);
      addV(RG.head, dx * 1.4 * k + side * 0.6, 0.3, dz * 1.4 * k);
      addV(side > 0 ? RG.hipL : RG.hipR, dx * 0.9 * k, 0, dz * 0.9 * k); addV(side > 0 ? RG.hipR : RG.hipL, -dx * 0.7 * k, 0, -dz * 0.7 * k);
      addV(handA, dx * 2.5 * k - dz * side * 1.5, 1.8, dz * 2.5 * k + dx * side * 1.5); addV(handB, -dz * side * -2.2, 1.2 + s3, dx * side * -2.2);
      addV(kneeA, 0, 0.6, 0.9); addV(RG.footL, dx * 0.8 * k, 0.9 * s2, dz * 0.8 * k); addV(RG.footR, dx * 0.8 * k, 0.9 * s3, dz * 0.8 * k);
      later(0.25, RG.head, 0, -1.2, 0);
      pinT = 0.04; fallOpts.calm = 1.55; fallOpts.slack = 0.3;
    } else if (style === 'blast') {
      // thrown: up and away from the blast, a little off its line, turning over as it goes (about the
      // axis across the throw, and about its own length), arms and legs flung wide
      const off = s1 * 0.4, c = Math.cos(off), sn = Math.sin(off);
      const bx = dx * c - dz * sn, bz = dx * sn + dz * c;
      const V = (3.4 + 1.4 * s2) * Math.min(k, 1.4), U = 2.9 + 1.0 * s3;
      const P = wp, cx = P[B.spine1 * 3], cyy = P[B.spine1 * 3 + 1], cz = P[B.spine1 * 3 + 2];
      const om = (r.next() < 0.75 ? 1 : -1) * (3.2 + 3 * s2), oy = s1 * 3.5;   // rad/s: head over heels, and a twist
      const J = RAG_J;
      for (let i = 0; i < 15; i++) {
        const rx = P[J[i] * 3] - cx, ry = P[J[i] * 3 + 1] - cyy, rz = P[J[i] * 3 + 2] - cz;
        const along = rx * bx + rz * bz;
        // omega = om * (bz, 0, -bx) + oy * (0, 1, 0);  v = omega x r
        addV(i, bx * V + om * (bx * ry) + oy * rz, U - om * along, bz * V + om * (bz * ry) - oy * rx);
      }
      addV(handA, side * 2.2, 1.2, 0); addV(handB, -side * 2.2, 0.6, 0);
      addV(RG.footL, 1.2, 0.5 * s2, 0); addV(RG.footR, -1.2, 0.5 * s3, 0);
      pinT = 0; fallOpts.calm = 2.1; fallOpts.slack = 0.5;
    } else if (style === 'tumble') {
      // killed at a run: the legs stop and the body does not. It goes over its own feet, shoulder or
      // face first, arms thrown out ahead, and slides
      const v = Math.max(fallV, 2.4), way = r.int(0, 2);
      all(dx * 0.5 * k, 0, v * 0.9 + dz * 0.5 * k);
      addV(RG.waist, 0, 0.5, 0.6); addV(RG.hipL, 0, 1.2, 0.3); addV(RG.hipR, 0, 1.2, 0.3);
      if (way === 0) {
        // a shoulder goes down first and the body rolls over it, ending on its side or its back
        addV(shA, side * 0.6, -2.6, 2.0); addV(shB, -side * 0.4, 1.6, 1.2); addV(RG.head, side * 0.8, -1.6, 2.0);
        addV(side > 0 ? RG.hipL : RG.hipR, 0, -1.2, 0); addV(side > 0 ? RG.hipR : RG.hipL, 0, 1.6, 0);
        addV(handA, side * 0.6, -1.0, 1.0); addV(handB, -side * 1.6, 2.0, 1.4); addV(kneeA, 0, 0, 1.4); addV(kneeB, -side * 1.2, 1.0, 0.2);
        later(0.3, shB, side * 1.6, 0, 0); later(0.3, kneeB, side * 1.4, 0.4, 0);
      } else if (way === 1) {
        // face first, and the legs come up and over behind it before they drop to one side
        addV(RG.head, s1 * 0.5, -2.0, 2.4); addV(shA, 0, -1.4, 2.2); addV(shB, 0, -1.8, 1.9);
        addV(handA, side * 1.4, 0.6, 2.4); addV(handB, -side * 0.9, -0.5, 1.4); addV(kneeA, 0, 0.4, 0.8);
        later(0.12, RG.footL, side * 0.8, 3.0 + s2, 1.2); later(0.12, RG.footR, side * 1.4, 2.2 + s3, 1.0);
        later(0.12, kneeA, side * 0.6, 1.6, 0.6); later(0.5, RG.footL, side * 1.2, 0, 0); later(0.5, RG.footR, side * 1.2, 0, 0);
      } else {
        // the knees go, it slides on them and pitches onto an arm, twisting
        addV(kneeA, 0, -0.6, 1.8); addV(kneeB, 0, -0.4, 1.3); addV(RG.hipL, 0, -1.6, 0); addV(RG.hipR, 0, -1.6, 0);
        addV(shA, side * 1.0, -0.4, 1.2); addV(shB, -side * 0.6, 0.3, 0.6); addV(RG.head, side * 0.6, -0.5, 1.2);
        addV(handA, side * 0.8, -0.6, 1.8); addV(handB, -side * 1.8, 1.6, 0.2);
        later(0.25, shA, side * 0.8, -1.4, 1.2); later(0.25, shB, side * 1.4, 0.6, 0.4); later(0.3, RG.head, 0, -1.2, 0.6);
      }
      pinT = way === 2 ? 0.02 : r.range(0.06, 0.11); fallOpts.calm = 1.7; fallOpts.slack = 0.2;
    } else if (style === 'crawl') {
      // already down: the arms give, the head drops, and by its seed it stays on its face or rolls half over
      all(dx * 0.5 * k, 0, dz * 0.5 * k + fwd);
      addV(RG.head, 0, -1.5, 0.3);
      if (Math.abs(s1) > 0.35) { addV(shA, -side * 0.9, 1.5 + s2 * 0.6, 0); addV(shB, -side * 0.5, -0.4, 0); addV(handA, -side * 1.2, 1.4, -0.4); addV(side > 0 ? RG.hipL : RG.hipR, -side * 0.4, 0.7 * s3, 0); }
      addV(handB, -side * 0.5, 0.2, -0.6 * s3);
      pinT = 0; fallOpts.calm = 1.0;
    } else if (style === 'brute') {
      // too heavy to be thrown: it stops, one knee goes, it hangs there, then the other, and the whole
      // weight comes down forward or to the side like something felled
      k *= 0.35;
      all(dx * 0.8 * k, 0, dz * 0.8 * k + fwd * 0.5);
      addV(kneeA, side * 0.2, 0, 1.4); addV(shA, side * 0.5, -0.2, 0.3); addV(RG.head, 0, -0.6, 0.5);
      const back = dz * k < -0.25 && s2 < 0.35;      // now and then, shot from the front, it goes over backward
      later(0.34 + 0.12 * s3, kneeB, -side * 0.2, 0, 1.6);
      later(0.5 + 0.12 * s3, shA, side * (0.7 + 0.6 * s2), -0.8, back ? -1.9 : 1.7); later(0.5 + 0.12 * s3, shB, side * 0.3, -0.6, back ? -1.9 : 1.3);
      later(0.56 + 0.12 * s3, RG.head, 0, -1, back ? -1.5 : 1.4);
      pinT = 0.6; fallOpts.calm = 1.9; fallOpts.slack = 0.5;
    } else if (style === 'burst') {
      // a bloater's own burst: blown open from the middle, the chest and head thrown back, arms wide
      for (const b of SWELL) { pose.scale[b * 3] = zombie.baseScale[b * 3] * 0.9; pose.scale[b * 3 + 2] = zombie.baseScale[b * 3 + 2] * 0.86; }
      all(0, 0.4, -1.2);
      addV(RG.shL, 0.8, 1.2, -1.8); addV(RG.shR, -0.8, 1.2, -1.8); addV(RG.head, s1 * 0.6, 1.0, -2.6);
      addV(RG.handL, 3, 1.5, 0); addV(RG.handR, -3, 1.5, 0); addV(RG.hipL, 0, -0.3, 0.6); addV(RG.hipR, 0, -0.3, 0.6);
      addV(kneeA, 0, 0, 1.2); addV(kneeB, 0, 0, 0.7);
      pinT = 0.1; fallOpts.calm = 1.5; fallOpts.slack = 0.3;
    } else {
      // a body shot. Three ways down, by the seed, each turned by which knee goes and how the shoulders are spun
      api.deathStyle = 'crumple';
      const way = fallV > 1.6 ? 0 : r.int(0, 2);
      all(dx * 0.5 * k, 0, dz * 0.5 * k + fwd);
      if (way === 0) {
        // folds over the wound and goes down forward: knee, hip, shoulder, then the head
        addV(kneeA, side * 0.4, 0, 1.6); addV(kneeB, 0, 0, 0.5);
        addV(RG.waist, dx * 0.9 * k, -0.3, dz * 0.9 * k - 0.4); addV(shA, side * 0.6 * s2, -0.9, 1.0 + s2); addV(shB, 0, -0.5, 0.6 + 0.8 * s3);
        addV(RG.head, s1 * 0.5, -0.8, 0.9); addV(handA, side * 0.5, 0.4, 0.8); addV(handB, -side * 0.3, 1.0 * s3, 0.3);
        later(0.18 + 0.1 * s3, kneeB, -side * 0.3, 0, 1.4); later(0.3, shB, -side * 0.5, -0.6, 0.9);
      } else if (way === 1) {
        // the struck side is thrown back, the body turns under it and it goes down on its side
        addV(shA, dx * 2.6 * k, 0.2, dz * 2.6 * k); addV(shB, -dx * 1.0 * k, -0.3, -dz * 1.0 * k); addV(RG.head, dx * 1.2 * k + side * 0.5, 0, dz * 1.2 * k);
        addV(kneeA, side * 1.0, 0, 1.0); addV(kneeB, side * 0.5, 0, 0.3);
        addV(RG.hipL, -side * 0.7, -0.3, 0); addV(RG.hipR, -side * 0.7, -0.3, 0);
        addV(handA, side * 1.5, 1.4, -0.5); addV(handB, 0, 0.3, 0.6);
        later(0.2, kneeB, side * 0.6, 0, 1.2); later(0.28, shA, side * 0.9, -1.0, 0); later(0.28, shB, side * 0.9, -0.6, 0);
      } else {
        // knocked back off its heels: the shoulders go first, the knees come up, flat on its back
        addV(RG.shL, dx * 2.4 * k, 0.2, dz * 2.4 * k - 0.6); addV(RG.shR, dx * 2.4 * k, 0.2, dz * 2.4 * k - 0.6); addV(shA, side * 0.5 * s2, 0, 0);
        addV(RG.head, dx * 2.9 * k, 0.4, dz * 2.9 * k - 0.8); addV(RG.waist, dx * 1.0 * k, 0, dz * 1.0 * k - 0.3);
        addV(kneeA, 0, 0, 1.3); addV(kneeB, 0, 0, 0.9 * s3);
        addV(handA, side * 1.4, 1.5 + s2, 0.6); addV(handB, -side * 1.0, 1.0, 0.4);
        later(0.22, RG.shL, 0, -0.5, -1.2); later(0.22, RG.shR, 0, -0.5, -1.2); later(0.3, kneeB, 0, 0.5, 1.0);
      }
      pinT = r.range(0.16, 0.34); fallOpts.calm = 1.35; fallOpts.slack = 0.3;
    }
    if (api.deathStyle === 'tumble') for (let n = 0; n < 4; n++) sprawl[n] *= 1.7;
    sprawlAt = (api.deathStyle === 'blast' ? 1.05 : api.deathStyle === 'spin' ? 0.75 : api.deathStyle === 'brute' ? 1.0 : api.deathStyle === 'crawl' ? 0.25 : 0.55) + 0.15 * s3;
    // the live pose in model space (the last frame's)
    rag.start(wp, wq, (i, out) => { out[0] = fv[i * 3]; out[1] = fv[i * 3 + 1]; out[2] = fv[i * 3 + 2]; }, pinT, fallOpts);
    ragFrames(0);
    for (let n = 0; n < 4; n++) { rq[16 + n] = wq[B.hips * 4 + n]; rq[20 + n] = wq[B.spine1 * 4 + n]; rq[24 + n] = wq[B.spine2 * 4 + n]; rq[28 + n] = wq[B.neck * 4 + n]; rq[32 + n] = wq[B.head * 4 + n]; }
    // where the hips bone sits relative to the middle of the hip joints, in the pelvis frame
    const P = rag.p;
    _v[0] = wp[B.hips * 3] - (P[0] + P[3]) * 0.5; _v[1] = wp[B.hips * 3 + 1] - (P[1] + P[4]) * 0.5; _v[2] = wp[B.hips * 3 + 2] - (P[2] + P[5]) * 0.5;
    rq[36] = -rq[0]; rq[37] = -rq[1]; rq[38] = -rq[2]; rq[39] = rq[3];
    vRot(_v, rq, 36, _v[0], _v[1], _v[2]);
    rq[40] = _v[0]; rq[41] = _v[1]; rq[42] = _v[2];
  }
  // what the dying body still does on the way down, and what a dead one cannot do: once the fall is
  // over nothing holds a body up, so one found propped on its folded knees with the hips in the air,
  // or sitting upright, is tipped over (to the side its seed chose) and given time to come to rest
  function fallKicks() {
    while (kickAt < kickN && rag.time >= kicks[kickAt * 5]) {
      const o = kickAt++ * 5;
      rag.kick(kicks[o + 1], kicks[o + 2], kicks[o + 3], kicks[o + 4]);
    }
    // limbs do not land laid out straight: once the trunk is down, a knee is drawn up to one side, an
    // arm folds in, the head turns, the shoulders twist against the hips (which, and how far, by the seed)
    if (!sprawled && rag.time >= sprawlAt) {
      sprawled = true;
      const P = rag.p;
      let ax = P[0] - P[3], az = P[2] - P[5];
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      let lx = (P[9] + P[12] - P[0] - P[3]) * 0.5, lz = (P[11] + P[14] - P[2] - P[5]) * 0.5;
      const ll = Math.hypot(lx, lz) || 1;
      lx /= ll; lz /= ll;
      const sd = tipSide, a = sprawl;
      const kA = sd > 0 ? RG.kneeL : RG.kneeR, fB = sd > 0 ? RG.footR : RG.footL, eA = sd > 0 ? RG.elbL : RG.elbR, hB = sd > 0 ? RG.handR : RG.handL, sA = sd > 0 ? RG.shL : RG.shR;
      rag.kick(kA, sd * ax * 1.9 * a[0] + lx * 0.9 * a[1], 0.3, sd * az * 1.9 * a[0] + lz * 0.9 * a[1]);
      rag.kick(fB, -sd * ax * 0.9 * a[1], 0, -sd * az * 0.9 * a[1]);
      rag.kick(eA, sd * ax * 1.3 * a[2] - lx * 0.6, 0.2, sd * az * 1.3 * a[2] - lz * 0.6);
      rag.kick(hB, -lx * 1.4 * a[3] + sd * ax * 0.5, 0.2, -lz * 1.4 * a[3] + sd * az * 0.5);
      rag.kick(RG.head, sd * ax * 0.9 * (a[0] - 0.5), 0, sd * az * 0.9 * (a[0] - 0.5));
      rag.kick(sA, 0, 0.9 * a[2], 0); rag.kick(RG.waist, -sd * ax * 0.5 * a[3], 0, -sd * az * 0.5 * a[3]);
    }
    if (rag.time < tipAt || tips >= 3 || rag.settled) return;
    tipAt = rag.time + 0.3;
    const P = rag.p, Gd = rag.ground, sz = fallOpts.size;
    const hipY = (P[1] + P[4]) * 0.5 - Gd[RG.hipL], shY = (P[10] + P[13]) * 0.5 - Gd[RG.shL];
    // across the body, along the ground
    let ax = P[0] - P[3], az = P[2] - P[5];
    const al = Math.hypot(ax, az) || 1;
    ax = (ax / al) * tipSide; az = (az / al) * tipSide;
    if (hipY > 0.32 * sz && shY < hipY + 0.05) {
      rag.kick(RG.hipL, ax * 1.5, -0.3, az * 1.5); rag.kick(RG.hipR, ax * 1.5, -0.3, az * 1.5); rag.kick(RG.waist, ax * 0.8, 0, az * 0.8);
      rag.kick(RG.kneeL, -ax * 0.7, 0, -az * 0.7); rag.kick(RG.kneeR, -ax * 0.7, 0, -az * 0.7);
      rag.extend(0.55); tips++;
    } else if (shY > 0.6 * sz && hipY < 0.3 * sz) {
      // the way from the knees to the hips is "back" for a sitting body
      let bx = (P[0] + P[3]) * 0.5 - (P[33] + P[39]) * 0.5, bz = (P[2] + P[5]) * 0.5 - (P[35] + P[41]) * 0.5;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl; bz /= bl;
      for (const i of TIP_TOP) rag.kick(i, bx * 1.5 + ax * 0.8, -0.3, bz * 1.5 + az * 0.8);
      rag.extend(0.55); tips++;
    }
  }
  let tipAt = 0, tips = 0, tipSide = 1, sprawled = false, sprawlAt = 0.5;
  const sprawl = new Float32Array(4);
  let levelFloor = null;

  mendToes(zombie);
  zombie.anim = api;            // the gore module reaches a body's animator through the body
  let gore = ensureGore();

  // a world direction in the zombie's own frame (shared scratch: use it before the next call)
  function toModelDir(dir) {
    if (!dir) { _dir[0] = 0; _dir[1] = 0; _dir[2] = -1; return _dir; }
    const x = xyz(dir, 0), z = xyz(dir, 2);
    const l = Math.hypot(x, z) || 1;
    _dir[0] = (x * cy - z * sy) / l; _dir[1] = 0; _dir[2] = (x * sy + z * cy) / l;
    return _dir;
  }
  function endAttack() {
    stateAdd.pz = stateAdd.py = stateAdd.pitch = stateAdd.yaw = stateAdd.head = stateAdd.neck = stateAdd.jaw = 0; atkAim = 0;
    for (const hnd of hand) hnd.locked = false;
  }

  function readRoot() {
    const m = zombie.mesh;
    m.updateWorldMatrix(true, false);
    const e = m.matrixWorld.elements;
    Rx = e[12]; Ry = e[13]; Rz = e[14];
    yaw = Math.atan2(e[8], e[10]); cy = Math.cos(yaw); sy = Math.sin(yaw);
  }
  const toWorldX = (mx, mz) => Rx + mx * cy + mz * sy;
  const toWorldZ = (mx, mz) => Rz - mx * sy + mz * cy;
  const toModelX = (wx, wz) => (wx - Rx) * cy - (wz - Rz) * sy;
  const toModelZ = (wx, wz) => (wx - Rx) * sy + (wz - Rz) * cy;

  function init() {
    started = true;
    readRoot();
    yawPrev = yaw;
    for (const f of foot) {
      const mx = f.side * ch.stanceW, mz = f.side * 0.03 * (ch.domArm ? 1 : -1);
      f.px = toWorldX(mx, mz); f.pz = toWorldZ(mx, mz); f.yaw = yaw + f.side * ch.toeOut[f.side > 0 ? 0 : 1];
      f.planted = true; f.ax = mx; f.az = mz; f.ay = ankleH;
    }
    sp[0] = ch.lean * 0.4; sp[2] = ch.lean * 0.6 + ch.hunch; hd[0] = ch.headFwd * 0.6; hd[1] = ch.headFwd * 0.4; hd[3] = ch.headRoll;
  }

  // the live pose as a clip key, so a clip always starts exactly where the body is
  function capture() {
    return {
      t: 0, e: 0, pel: Array.from(pel), sp: Array.from(sp), hd: Array.from(hd),
      hand: hand.map((h) => [h.s[0], h.s[2], h.s[4], 0, 0]),
      foot: foot.map((f) => [f.ax, f.ay, f.az, f.pitch, f.myaw, 0, 0]),
    };
  }

  // ---- feet --------------------------------------------------------------------------------------
  function startSwing(i, dur, mode, tx, tz) {
    const f = foot[i];
    f.planted = false; f.s = 0; f.dur = dur; f.mode = mode;
    f.sx = f.px; f.sz = f.pz; f.syaw = f.yaw; f.tx = tx; f.tz = tz; f.push = f.pitch;
    // how long it will then stand, and the furthest ahead it may be set down: fixed for this step, so a
    // change of gait while it is in the air does not move where it lands
    f.hold = Math.max(0.2, cycleT - dur); f.cap = ch.stepLen * (runW > 0.5 ? 1.3 : 0.8);
    f.lx = mode === 0 ? f.side * ch.stanceW : toModelX(tx, tz); f.lz = mode === 0 ? 0.1 : toModelZ(tx, tz);
    // where the ankle is over the contact point at the moment the foot comes down (heel first, or toe first when dragged)
    const p = mode === 0 ? (f.bad && ch.drag ? 0.22 : -0.2) : -0.05, c = Math.cos(p), sn = Math.sin(p);
    f.lf = p > 0 ? ballFwd - ballFwd * c + ankleH * sn : -heelBack + heelBack * c + ankleH * sn;
    f.lu = p > 0 ? ballFwd * sn + ankleH * c : -heelBack * sn + ankleH * c;
    const drag = f.bad && ch.drag;
    f.lift = mode === 0 ? (runW > 0.5 ? r.range(0.13, 0.2) : isBrute ? 0.1 : drag ? 0.004 : f.bad ? 0.025 : r.range(0.04, 0.075)) * hS : 0.035 * hS;
    pending[i] = false;
  }
  function plant(f, i) {
    f.planted = true; f.st = 0; f.walkPlant = f.mode === 0; f.sd = Math.max(0.2, cycleT - f.dur);
    // footfall: the body takes the weight
    const k = (f.mode === 0 ? 0.5 + ch.lurch * 2 : 0.4) * (f.bad ? 1 + ch.limp : 1) * stiff;
    sChest[1] += 0.55 * k; sHead[1] += 0.9 * k; sPel[3] -= 0.16 * k;
    if (api.onStep) api.onStep(i, f.px, f.pz);
    if (gore && f.mode === 0) gore.step(zombie, f.px, Ry, f.pz, gait, i);
  }

  function feet(dt, v, walking) {
    for (let i = 0; i < 2; i++) {
      const f = foot[i];
      const idx = f.side > 0 ? 0 : 1;
      if (!f.planted) {
        f.s += dt / f.dur;
        const s = Math.min(1, f.s);
        if (f.mode === 0) {
          // where the body will be when this foot comes down, plus the lead it lands with
          // (the pace it will have by then: a body picking up speed reaches further, one pulling up less)
          const left = (1 - s) * f.dur, vL = clamp(v + accS * left, 0, v + 0.6);
          const lead = Math.min(vL * f.hold * (f.bad ? 0.5 - 0.22 * ch.limp : 0.5 + (foot[1 - i].bad ? 0.1 * ch.limp : 0)), f.cap) + 0.02;
          const mz = (v + vL) * 0.5 * left + lead;
          f.lz = lead;
          f.tx = toWorldX(f.side * ch.stanceW, mz); f.tz = toWorldZ(f.side * ch.stanceW, mz);
        }
        const drag = f.bad && ch.drag && f.mode === 0;
        const e = drag ? s * (0.6 + 0.4 * s) : s * s * (3 - 2 * s);
        f.px = lerp(f.sx, f.tx, e); f.pz = lerp(f.sz, f.tz, e);
        // set down turned a little past the body, the way it is turning, so the turn is shared between
        // this stance and the next instead of twisting one leg
        f.yaw = f.syaw + angDiff(yaw + f.side * ch.toeOut[idx] * (drag ? 1.6 : 1) + clamp(turnW * 0.2, -0.5, 0.5), f.syaw) * e;
        f.y = f.lift * Math.sin(Math.PI * Math.min(1, s * 1.08));
        const strike = f.mode === 0 ? (drag ? -0.22 : 0.2) : 0.05;
        f.pitch = lerp(f.push, -strike, smooth(0.15, 0.95, s)) + (drag ? 0 : (0.25 + 0.75 * runW) * Math.sin(Math.PI * s) * (f.mode === 0 ? 1 : 0.3));
        if (f.s >= 1) plant(f, i);
      } else {
        f.st += dt; f.y = 0;
        const u = f.st / f.sd;
        const drag = f.bad && ch.drag;
        if (f.walkPlant && walking) {
          const strike = drag ? -0.22 : 0.2;
          const heelOff = (drag ? 0.2 : 0.62) * clamp(v / 1.2, 0.3, 1.1) * smooth(0.58, 1.02, u);
          f.pitch = u < 0.14 ? -strike * (1 - u / 0.14) : heelOff;
        } else f.pitch += (0 - f.pitch) * Math.min(1, dt * 8);
        if (pending[i] && (foot[1 - i].planted || foot[1 - i].s > (runW > 0.5 ? 0.3 : 0.94))) startSwing(i, runW > 0.5 ? clamp(0.58 * cycleT, 0.16, 0.5) : clamp(ch.swing * cycleT * (f.bad ? 1.12 : foot[1 - i].bad ? 0.88 : 1), 0.22, SWING_MAX), 0, 0, 0);
      }
      f.sup += ((f.planted ? 1 : 0) - f.sup) * Math.min(1, dt * 9);
      // ankle from the contact point: roll about the heel while the toe is up, about the ball once the heel lifts
      const c = Math.cos(f.pitch), sn = Math.sin(f.pitch);
      const fwd = f.pitch > 0 ? ballFwd - ballFwd * c + ankleH * sn : -heelBack + heelBack * c + ankleH * sn;
      const up = f.pitch > 0 ? ballFwd * sn + ankleH * c : -heelBack * sn + ankleH * c;
      const wx = f.px + Math.sin(f.yaw) * fwd, wz = f.pz + Math.cos(f.yaw) * fwd;
      f.ax = toModelX(wx, wz); f.az = toModelZ(wx, wz); f.ay = f.y + up;
      f.myaw = angDiff(f.yaw, yaw); f.roll = 0; f.poleY = 0;
    }
    // standing corrections: a foot too far from where it belongs steps home
    stepCool -= dt;
    if (!walking && foot[0].planted && foot[1].planted && stepCool <= 0) {
      // (being turned on the spot, the feet are walked round in quick short steps)
      const turning = Math.abs(turnW) > 0.6;
      let worst = -1, wErr = state === 'stagger' ? 0.1 : state === 'attack' ? 0.3 : 0.2;
      for (let i = 0; i < 2; i++) {
        const f = foot[i];
        const hx = f.side * ch.stanceW, hz = api.rootSpeed * 0.18;
        const err = Math.hypot(toModelX(f.px, f.pz) - hx, toModelZ(f.px, f.pz) - hz) + Math.abs(angDiff(f.yaw, yaw + f.side * ch.toeOut[i])) * 0.42;
        if (err > wErr) { wErr = err; worst = i; }
      }
      if (worst >= 0) {
        const f = foot[worst];
        const jx = r.range(-0.03, 0.03), jz = r.range(-0.05, 0.05) + api.rootSpeed * 0.3;
        startSwing(worst, state === 'stagger' ? 0.2 : turning ? 0.23 : 0.34, 1, toWorldX(f.side * ch.stanceW + jx, jz), toWorldZ(f.side * ch.stanceW + jx, jz));
        stepCool = state === 'stagger' ? 0.05 : turning ? 0.02 : 0.15;
      }
    }
  }

  // ---- one frame -----------------------------------------------------------------------------------
  // speed: ground speed asked for while walking (m/s). camDist: metres to the camera, for animation LOD.
  function update(dt, speed = 0, camDist = 0) {
    if (settled) return;
    const lod = camDist > 40 ? 3 : camDist > 20 ? 1 : 0;
    api.lod = lod;
    if (lod && (tick++ & lod)) { accDt += dt; return; }
    dt = Math.min(dt + accDt, 0.1); accDt = 0;
    if (!started) init();
    if (!gore) gore = ensureGore();
    readRoot();
    time += dt; sT += dt;
    // how fast the simulation is turning the root (a placement or a snap to a fence is not a turn)
    let dy = yaw - yawPrev;
    if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
    yawPrev = yaw;
    turnW += ((dy > 0.5 || dy < -0.5 ? 0 : clamp(dy / Math.max(dt, 1e-3), -4, 4)) - turnW) * Math.min(1, dt * 9);
    if (dy === 0 && turnW < 0.02 && turnW > -0.02) turnW = 0;
    const dead = state === 'dead';
    const inClip = dead || state === 'climb' || state === 'window';
    let walkW = 0;

    if (dead) {
      fallKicks();
      const t0 = rag.time;
      rag.update(dt); ragTorso(); api.rootSpeed = 0;
      // the boss reaching the ground is felt
      if (isBrute && gore && t0 < 0.95 && rag.time >= 0.95) gore.thud(zombie, Rx, Ry, Rz);
    } else if (inClip) playClip(dt);
    else {
      // ---- speed and gait clock
      const walking = state === 'walk' || state === 'run' || state === 'crawl';
      const running = state === 'run' && !isBrute;
      // down on its forearms once a leg is gone, whatever it is doing; back up never
      const crawling = gait === 'crawl';
      prone += clamp((crawling ? 1 : 0) - prone, -dt * 2, dt * 2.3);
      // a limb lost since the last frame: the body flinches from it and carries on without
      if (zombie.severed.size !== sevN) { sevN = zombie.severed.size; sChest[1] += 3; sChest[3] += (zombie.severed.has('armL') ? 1 : -1) * 3; sHead[1] += 4; }
      let vT = walking ? speed : 0;
      let direct = null;
      if (state === 'attack') direct = prone > 0.5 ? 0 : attackSpeed();
      else if (state === 'slam' || state === 'tear' || state === 'burst') direct = 0;
      else if (state === 'stagger') direct = stagDir * 1.5 * Math.exp(-sT * 4.5);
      const dv = clamp(vT - vCur, -3 * dt, 2 * dt);
      vCur += dv;
      accS += (dv / Math.max(dt, 1e-3) - accS) * Math.min(1, dt * 6);
      const buck = Math.max(sBuckle[0], sBuckle[2], 0);
      const v = vCur * (1 - 0.5 * Math.min(1, buck));
      runW += ((running && v > 1.6 ? 1 : 0) - runW) * Math.min(1, dt * 5);
      // the long stride with both feet off the ground belongs to real speed: a runner held to a
      // walk (turning hard, closing on a fence, pulling up) walks
      const fast = running && runW > 0.5;
      if (prone > 0.5) crawlClock(dt, v, walking);
      else if (walking && v > 0.04) {
        // a run is long strides off the toes with both feet in the air between them; the brute's is a
        // lumber: long heavy steps, never off the ground
        const S = fast ? ch.stepLen * (1.7 + 0.25 * Math.min(v / 3.8, 1.2)) : ch.stepLen * (0.72 + 0.28 * Math.min(v / 1.3, 1.5)) * (isBrute ? 1.15 : STRIDE);
        // turning costs steps too: a body being turned on the spot still has to walk its feet round
        cycleT = (2 * S) / (v + Math.abs(turnW) * 0.2);
        const pR = 0.5 + (ch.limpSide === 1 ? 0.06 : ch.limpSide === 0 ? -0.06 : 0) * ch.limp;
        // setting off: the first step is taken at once, with the foot that is further behind, so the
        // body does not slide away from two planted feet while the clock comes round
        if (!gaitOn) {
          gaitOn = true;
          const first = toModelZ(foot[0].px, foot[0].pz) <= toModelZ(foot[1].px, foot[1].pz) ? 0 : 1;
          phase = first ? pR : 0; pending[first] = true; pending[1 - first] = false;
        }
        const p0 = phase;
        phase += dt / cycleT;
        if (phase >= 1) { phase -= 1; pending[0] = true; }
        if (p0 < pR && phase >= pR) pending[1] = true;
        for (let i = 0; i < 2; i++) {
          // a planted foot the body has turned away from is lifted early
          if (turnW !== 0 && !pending[i] && foot[i].planted && foot[i].st > 0.1 && foot[1 - i].planted && foot[1 - i].st > 0.06 && Math.abs(angDiff(foot[i].yaw, yaw + foot[i].side * ch.toeOut[i])) > 0.5) pending[i] = true;
          if (pending[i] && foot[i].planted && (foot[1 - i].planted || (fast && foot[1 - i].s > 0.3))) startSwing(i, fast ? clamp(0.58 * cycleT, 0.16, 0.5) : clamp(ch.swing * cycleT * (foot[i].bad ? 1.12 : foot[1 - i].bad ? 0.88 : 1) / (1 + 0.3 * Math.abs(turnW)), 0.22, SWING_MAX), 0, 0, 0);
        }
        // the lurch: the body surges and checks within each stride; the mean stays v
        api.rootSpeed = v * (1 + ch.lurch * (fast ? 0.3 : 1) * Math.cos(TAU * 2 * phase + 0.6) + 0.25 * ch.limp * (fast ? 0 : 1) * Math.sin(TAU * phase + (ch.limpSide === 1 ? Math.PI : 0)));
      } else {
        api.rootSpeed = direct !== null ? direct : v;
        pending[0] = pending[1] = false; gaitOn = false;
      }
      walkW = smooth(0.05, 0.6, v);
      feet(dt, v, walking && v > 0.04 && prone <= 0.5);
      if (state === 'attack' || state === 'stagger') { if (prone > 0.5 && state === 'attack') crawlAttack(); else stateLayer(dt); }
      else if (state === 'slam') slamLayer(dt);
      else if (state === 'tear') tearLayer();
      else if (state === 'burst') burstLayer();
      else if (sT > 1e9) sT = 0;
      bodyTargets(dt, walkW);
      if (prone > 0) crawlBody(dt, v);
    }
    rootAcc += ((api.rootSpeed - prevSpeed) / Math.max(dt, 1e-3) - rootAcc) * Math.min(1, dt * 12);
    prevSpeed = api.rootSpeed;

    // ---- smoothing and springs
    const k = inClip ? 1 : 1 - Math.exp(-dt * 11);
    if (!dead) {
      for (let i = 0; i < 6; i++) pel[i] += (pelT[i] - pel[i]) * (inClip ? 1 : i === 1 ? 1 - Math.exp(-dt * 16) : k);
      for (let i = 0; i < 5; i++) { sp[i] += (spT[i] - sp[i]) * k; hd[i] += (hdT[i] - hd[i]) * k; }
    }
    const sub = dt > 0.034 ? 2 : 1, h = dt / sub;
    for (let n = 0; n < sub; n++) {
      for (let i = 0; i < 6; i += 2) { springTo(sHead, i, 0, 9, 0.28, h); springTo(sChest, i, 0, 10, 0.42, h); springTo(sPel, i, 0, 12, 0.5, h); }
      springTo(sBuckle, 0, 0, 8, 0.55, h); springTo(sBuckle, 2, 0, 8, 0.55, h);
    }
    // legs must reach: cap the pelvis height by what each planted leg allows
    if (!inClip) {
      qEuler(_q, 0, pel[3] + sChest[0] * 0.15, pel[4], pel[5]);
      const b = Math.max(sBuckle[0], 0) + Math.max(sBuckle[2], 0);
      let y = pel[1] + sPel[2] - 0.13 * Math.min(1, b);
      for (let i = 0; i < 2; i++) {
        const f = foot[i];
        vRot(_v, _q, 0, off[LEG[i].b1 * 3], off[LEG[i].b1 * 3 + 1], off[LEG[i].b1 * 3 + 2]);
        const px = pel[0] + sPel[0] + _v[0], pz = pel[2] + sPel[4] + _v[2];
        let hx = px - f.ax, hz = pz - f.az;
        // (a foot in the air need not be reached exactly in the middle of its swing: the leg trails)
        y = smin(y, f.ay + Math.sqrt(Math.max(0.01, REACH2 - hx * hx - hz * hz)) - _v[1] + (f.planted || runW < 0.01 ? 0 : 0.3 * runW * Math.sin(Math.PI * Math.min(1, f.s))), 0.04);
        // a foot in the air: where it will come down is known, so the pelvis is already on its way to
        // the height that landing needs and arrives with the foot
        if (!f.planted && f.s < 1) {
          hx = px - f.lx; hz = pz - f.lz - f.lf;
          y = smin(y, f.lu + Math.sqrt(Math.max(0.01, REACH2 - hx * hx - hz * hz)) - _v[1] + 0.1 * (1 - smooth(0.1, 0.9, f.s)), 0.04);
        }
      }
      // down as fast as the legs demand; up only as fast as a loaded knee straightens
      pelY = prone > 0.5 ? pel[1] : Math.min(y, pelY + RISE * (1 + 3 * runW) * dt);
    } else pelY = pel[1];

    // ---- torso, then limbs by IK
    if (!dead) {
      const i3 = B.hips * 3;
      off[i3] = pel[0] + (inClip ? 0 : sPel[0]); off[i3 + 1] = pelY; off[i3 + 2] = pel[2] + (inClip ? 0 : sPel[4]);
      const lean = Math.max(sBuckle[0], 0) - Math.max(sBuckle[2], 0);
      qEuler(lq, B.hips * 4, pel[3] + sChest[0] * 0.2, pel[4] + sChest[2] * 0.25, pel[5] + sChest[4] * 0.2 - lean * 0.12);
      qEuler(lq, B.spine1 * 4, sp[0] + sChest[0] * 0.4, sChest[2] * 0.3, sp[1] + sChest[4] * 0.4);
      qEuler(lq, B.spine2 * 4, sp[2] + sChest[0] * 0.5, sp[3] + sChest[2] * 0.6, sp[4] + sChest[4] * 0.5);
      qEuler(lq, B.neck * 4, hd[0] + sHead[0] * 0.45, hd[2] * 0.4 + sHead[2] * 0.4, hd[3] * 0.4 + sHead[4] * 0.4);
      qEuler(lq, B.head * 4, hd[1] + sHead[0] * 0.6, hd[2] * 0.6 + sHead[2] * 0.6, hd[3] * 0.6 + sHead[4] * 0.6);
      if (lod === 0) qEuler(lq, B.jaw * 4, hd[4] + Math.max(0, -sHead[1]) * 0.03, 0, ch.jawSide);
    }
    solveFK(bones, pose, ZERO3, ID_Q, 0, false);
    if (dead) groundTorso();

    if (!inClip) hands(dt, walkW);
    const P = rag.p;
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], A = ARM[i];
      let o;
      if (dead) {
        // the arm follows the fallen wrist and elbow
        const hi = (i ? RG.handR : RG.handL) * 3, ei = (i ? RG.elbR : RG.elbL) * 3;
        _h[0] = P[hi]; _h[1] = P[hi + 1]; _h[2] = P[hi + 2]; o = _h;
        hnd.pole[0] = P[ei] - wp[A.b1 * 3]; hnd.pole[1] = P[ei + 1] - wp[A.b1 * 3 + 1]; hnd.pole[2] = P[ei + 2] - wp[A.b1 * 3 + 2];
        hnd.wrist += (0.25 - hnd.wrist) * 0.1; hnd.curl += (0.85 - hnd.curl) * 0.08;
      } else o = h3(hnd, dt, inClip);
      let sx = wp[A.b1 * 3], sy2 = wp[A.b1 * 3 + 1], sz = wp[A.b1 * 3 + 2];
      // the collar bone lifts as the hand goes above the shoulder; the arm is then solved from where
      // the shoulder has moved to, so the hand lands on its target
      const raise = dead ? 0 : clamp((o[1] - sy2 + 0.25) * 1.2, 0, 0.45);
      qEuler(lq, A.clav * 4, 0, 0, A.side * raise * 0.5);
      qEuler(_q, 8, 0, 0, A.side * raise * 0.5);
      qMul(_q, 12, wq, PARENT_CLAV * 4, _q, 8);
      if (raise > 0) {
        vRot(_v, _q, 12, off[A.b1 * 3], off[A.b1 * 3 + 1], off[A.b1 * 3 + 2]);
        sx = wp[A.clav * 3] + _v[0]; sy2 = wp[A.clav * 3 + 1] + _v[1]; sz = wp[A.clav * 3 + 2] + _v[2];
      }
      ik2(_q, 0, _q, 4, sx, sy2, sz, o[0], o[1], o[2], A1, A2, hnd.pole[0], hnd.pole[1], hnd.pole[2], -1, corr, (4 + i * 2) * 4, (5 + i * 2) * 4, A.side, -0.3, -0.6);
      qInvMul(lq, A.b1 * 4, _q, 12, _q, 0);
      qInvMul(lq, A.b2 * 4, _q, 0, _q, 4);
      qEuler(lq, A.end * 4, hnd.wrist, 0, -A.side * 0.1);
      if (lod === 0) {
        qEuler(lq, A.fa * 4, 0, 0, -A.side * hnd.curl * 0.7);
        qEuler(lq, A.fb * 4, 0, 0, -A.side * hnd.curl);
        qEuler(lq, A.th * 4, 0.1, 0, -A.side * hnd.curl * 0.5);
      }
    }
    for (let i = 0; i < 2; i++) {
      const f = foot[i], Lg = LEG[i];
      const hx = wp[Lg.b1 * 3], hy = wp[Lg.b1 * 3 + 1], hz = wp[Lg.b1 * 3 + 2];
      // knees point the way the foot does, a little outward; clips can aim them up or down
      if (dead) {
        // the leg follows the fallen ankle and knee; the foot goes slack on the shin
        const fi = (i ? RG.footR : RG.footL) * 3, ki = (i ? RG.kneeR : RG.kneeL) * 3;
        ik2(_q, 0, _q, 4, hx, hy, hz, P[fi], P[fi + 1], P[fi + 2], L1, L2, P[ki] - hx, P[ki + 1] - hy, P[ki + 2] - hz, 1, corr, i * 8, i * 8 + 4, 0, 0.3, 1);
        qInvMul(lq, Lg.b1 * 4, wq, B.hips * 4, _q, 0);
        qInvMul(lq, Lg.b2 * 4, _q, 0, _q, 4);
        // slack, but turned whichever way keeps the toes out of the ground
        let bestP = 0.45, bestY = -9;
        for (let c = 0; c < 4; c++) {
          const pc = DEAD_FOOT[c];
          qEuler(_q, 8, pc, 0, Lg.side * 0.1);
          qMul(_q, 12, _q, 4, _q, 8);
          vRot(_v, _q, 12, off[Lg.toe * 3], off[Lg.toe * 3 + 1], off[Lg.toe * 3 + 2] + 0.07);
          const ty = P[fi + 1] + _v[1];
          if (ty > bestY) { bestY = ty; bestP = pc; }
          if (ty >= 0.03 + rag.ground[i ? RG.footR : RG.footL]) break;
        }
        qEuler(lq, Lg.end * 4, bestP, 0, Lg.side * 0.1);
        qEuler(lq, Lg.toe * 4, 0, 0, 0);
        continue;
      }
      const py = f.poleY;
      const ky = clamp(f.myaw, -0.8, 0.8);
      const kx = Math.sin(ky) * 0.6 + Lg.side * 0.18, kz = Math.cos(ky) * 0.6 + 0.4;
      // py > 0 lifts the knee, py < 0 splays it sideways along the ground (the far side of a fence)
      const pa = Math.abs(py);
      ik2(_q, 0, _q, 4, hx, hy, hz, f.ax, f.ay, f.az, L1, L2, kx * (1 - pa) + (py < 0 ? Lg.side * pa : 0), (py > 0 ? py : 0.12 * pa) + 0.05, kz * (1 - pa) + 0.15 * (1 - pa), 1, corr, i * 8, i * 8 + 4, Lg.side * 0.3, 0.2, 1);
      qInvMul(lq, Lg.b1 * 4, wq, B.hips * 4, _q, 0);
      qInvMul(lq, Lg.b2 * 4, _q, 0, _q, 4);
      qEuler(_q, 8, f.pitch, f.myaw, f.roll);
      qInvMul(lq, Lg.end * 4, _q, 4, _q, 8);
      qEuler(lq, Lg.toe * 4, f.planted && f.pitch > 0 ? -f.pitch : -0.25 * Math.max(0, f.pitch), 0, 0);
    }
    _v[0] = Rx; _v[1] = Ry; _v[2] = Rz;
    _q[0] = 0; _q[1] = Math.sin(yaw * 0.5); _q[2] = 0; _q[3] = Math.cos(yaw * 0.5);
    solveFK(bones, worldPose, _v, _q, 0, true);
    if (dead && rag.settled) { settled = true; api.done = true; if (gore) gore.settle(zombie, api); }
    api.settled = settled;
    if (gore && lod === 0) gore.frame(zombie, api, dt);
  }

  // ---- collapse: bones from the fallen points --------------------------------------------------------
  // pelvis, chest and neck frames from the ragdoll, as quaternions at rq[o], rq[o + 4], rq[o + 8]
  function frameQ(o, ax, ay, az, ux, uy, uz) {
    let l = Math.hypot(ax, ay, az) || 1;
    ax /= l; ay /= l; az /= l;
    const d = ux * ax + uy * ay + uz * az;
    ux -= ax * d; uy -= ay * d; uz -= az * d;
    l = Math.hypot(ux, uy, uz) || 1;
    ux /= l; uy /= l; uz /= l;
    qBasis(rq, o, ax, ay, az, ux, uy, uz, ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux);
  }
  function ragFrames(o) {
    const P = rag.p;
    frameQ(o, P[0] - P[3], P[1] - P[4], P[2] - P[5], P[6] - (P[0] + P[3]) * 0.5, P[7] - (P[1] + P[4]) * 0.5, P[8] - (P[2] + P[5]) * 0.5);
    frameQ(o + 4, P[9] - P[12], P[10] - P[13], P[11] - P[14], P[15] - P[6], P[16] - P[7], P[17] - P[8]);
    frameQ(o + 8, P[9] - P[12], P[10] - P[13], P[11] - P[14], P[18] - P[15], P[19] - P[16], P[20] - P[17]);
  }
  // rq: [0, 12) the three frames at death, [16, 36) world rotations of hips, spine1, spine2, neck and
  // head at death, [40, 43) the hips bone relative to the hip points, [44, 56) the frames now.
  // world rotation of a bone now = (frame now) * conj(frame at death) * (bone at death) -> _q[8..12)
  function ragBone(frame0, boneAt) {
    _q[0] = -rq[frame0]; _q[1] = -rq[frame0 + 1]; _q[2] = -rq[frame0 + 2]; _q[3] = rq[frame0 + 3];
    qMul(_q, 4, rq, 44 + frame0, _q, 0);
    qMul(_q, 8, _q, 4, rq, boneAt);
  }
  function ragTorso() {
    const P = rag.p;
    ragFrames(44);
    // world rotations: hips, spine1 (halfway between pelvis and chest), spine2, neck, head
    ragBone(0, 16); for (let k = 0; k < 4; k++) rqW[k] = _q[8 + k];
    ragBone(4, 24); for (let k = 0; k < 4; k++) rqW[8 + k] = _q[8 + k];
    ragBone(0, 20); for (let k = 0; k < 4; k++) rqW[4 + k] = _q[8 + k];
    ragBone(4, 20);
    const sgn = rqW[4] * _q[8] + rqW[5] * _q[9] + rqW[6] * _q[10] + rqW[7] * _q[11] < 0 ? -1 : 1;
    let l = 0;
    for (let k = 0; k < 4; k++) { rqW[4 + k] += sgn * _q[8 + k]; l += rqW[4 + k] * rqW[4 + k]; }
    l = Math.sqrt(l) || 1;
    for (let k = 0; k < 4; k++) rqW[4 + k] /= l;
    ragBone(8, 28); for (let k = 0; k < 4; k++) rqW[12 + k] = _q[8 + k];
    ragBone(8, 32); for (let k = 0; k < 4; k++) rqW[16 + k] = _q[8 + k];
    // local rotations down the spine (the root is the model frame)
    for (let k = 0; k < 4; k++) lq[B.hips * 4 + k] = rqW[k];
    qInvMul(lq, B.spine1 * 4, rqW, 0, rqW, 4);
    qInvMul(lq, B.spine2 * 4, rqW, 4, rqW, 8);
    qInvMul(lq, B.neck * 4, rqW, 8, rqW, 12);
    qInvMul(lq, B.head * 4, rqW, 12, rqW, 16);
    qEuler(lq, B.jaw * 4, Math.min(0.5, ch.jaw + 0.25), 0, ch.jawSide);
    // the hips bone rides on the middle of the two hip points
    vRot(_v, rq, 44, rq[40], rq[41], rq[42]);
    off[B.hips * 3] = (P[0] + P[3]) * 0.5 + _v[0]; off[B.hips * 3 + 1] = (P[1] + P[4]) * 0.5 + _v[1]; off[B.hips * 3 + 2] = (P[2] + P[5]) * 0.5 + _v[2];
  }
  const rqW = new Float32Array(20);
  const DEAD_FOOT = [0.45, 0, -0.55, 1.1];
  let pelY = stand;
  const PARENT_CLAV = B.spine2;
  const _h = [0, 0, 0];

  // hand position this frame: springs toward its target (stiffer in clips), kept off the ground
  function h3(hnd, dt, inClip) {
    const s = hnd.s;
    if (!hnd.init) { hnd.init = true; s[0] = hnd.tx; s[2] = hnd.ty; s[4] = hnd.tz; }
    const om = inClip ? 14 : lerp(8.5, 11, hnd.w), ze = inClip ? 0.6 : lerp(0.34, 0.7, hnd.w);
    const sub = dt > 0.034 ? 2 : 1, h = dt / sub;
    for (let n = 0; n < sub; n++) {
      s[5] -= rootAcc * h * (inClip ? 0 : 0.55);
      springTo(s, 0, hnd.tx, om, ze, h); springTo(s, 2, hnd.ty, om, ze, h); springTo(s, 4, hnd.tz, om, ze, h);
    }
    const floor = state === 'dead' ? 0.1 : 0.035;
    if (s[2] < floor) { s[2] = floor; if (s[3] < 0) s[3] = 0; }
    _h[0] = s[0]; _h[1] = s[2]; _h[2] = s[4];
    return _h;
  }

  // ---- body targets while on the feet ------------------------------------------------------------
  function baseTargets(dt, walkW) {
    const fl = foot[0], fr = foot[1];
    const idle = 1 - walkW;
    // random twitches keep a standing zombie from freezing
    if (time > nextTwitch) {
      nextTwitch = time + ch.twitch * r.range(0.4, 1.6) * (1 + walkW);
      const a = r.next();
      if (a < 0.45) { sHead[1] += r.range(-3, 3); sHead[3] += r.range(-5, 5); sHead[5] += r.range(-4, 4); }
      else if (a < 0.75) { const hh = hand[r.next() < 0.5 ? 0 : 1]; hh.s[1] += r.range(-1, 1); hh.s[3] += r.range(0, 1.6); hh.s[5] += r.range(-0.5, 1.5); }
      else { sChest[1] += r.range(-1.5, 2.5); sChest[3] += r.range(-2.5, 2.5); }
    }
    const sway = Math.sin((time / ch.swayT) * TAU), sway2 = Math.sin((time / (ch.swayT * 0.63)) * TAU + 1.3);
    const supL = fl.sup, supR = fr.sup;
    const limpLean = ch.limp * (ch.limpSide === 0 ? supL * (1 - supR) : ch.limpSide === 1 ? -supR * (1 - supL) : 0);
    // pelvis: over the planted foot, between the two in depth
    const supX = (fl.ax * supL + fr.ax * supR) / Math.max(0.2, supL + supR);
    pelT[0] = supX * 0.42 * (supL + supR < 1.6 ? 1 : 0.3) + idle * ch.swayA * sway + limpLean * 0.03;
    pelT[2] = (fl.az + fr.az) * 0.5 * 0.35 - 0.02 - ch.lean * 0.08 + idle * 0.012 * sway2;
    pelT[1] = stand - idle * 0.006 * (1 + sway2) - Math.abs(limpLean) * 0.025;
    pelT[3] = ch.pelvisTilt;
    pelT[4] = clamp(-0.3 * (fl.az - fr.az) / hS, -0.3, 0.3);
    const liftL = fl.planted ? 0 : Math.sin(Math.PI * Math.min(1, fl.s)), liftR = fr.planted ? 0 : Math.sin(Math.PI * Math.min(1, fr.s));
    pelT[5] = -0.075 * waddle * (liftL - liftR) - limpLean * 0.09 + idle * 0.03 * sway;
    pelT[0] *= waddle > 1 ? 1.5 : 1;
    // a run: thrown forward over the feet, bobbing with each stride
    pelT[3] += 0.1 * runW; pelT[1] -= 0.025 * runW * (1 + Math.sin(TAU * 2 * phase));
    // spine: lean and hunch, shoulders against the pelvis, lurch over the stance leg
    const lurch = -ch.lurchLean * (supL - supR) * walkW - limpLean * 0.14;
    spT[0] = ch.lean * 0.4 + 0.02 * idle * sway2 + 0.07 * runW;
    spT[1] = lurch * 0.5 - pelT[5] * 0.4;
    spT[2] = ch.lean * 0.6 + ch.hunch + 0.05 * walkW + 0.05 * runW;
    spT[3] = -1.5 * pelT[4] + ch.twist;
    spT[4] = lurch * 0.6 - pelT[5] * (isBloat ? 1.3 : 0.5) + ch.shoulderDrop + idle * 0.02 * sway + (isBrute ? 0.1 * (supL - supR) * walkW : 0);
    // the surge of each step rocks the trunk; a slow seeded wander keeps it from being carried like a board
    const up = 1 - prone;
    spT[2] += walkW * (0.015 + 0.3 * ch.lurchLean) * Math.cos(TAU * 2 * phase + 1.5) * (1 - runW);
    spT[1] += walkW * 0.03 * stiff2 * sway2; spT[3] += walkW * 0.05 * stiff2 * sway;
    // weight: thrown forward as it picks up speed, rocked back on its heels as it pulls up
    const al = clamp(accS, -3, 2.2) * up;
    spT[0] += al * 0.016; spT[2] += al * 0.024; pelT[2] += al * 0.012; pelT[1] -= Math.abs(al) * 0.006;
    // a turn comes up through the body: the pelvis follows the feet, the chest trails the pelvis, the
    // head comes round last and swings a little past; the whole body banks into it
    const tw = clamp(turnW, -3, 3) * up;
    let bank = 0;
    if (tw !== 0 || turnLive) {
      springTo(sTurn, 0, -tw * 0.075, 7, 0.5, dt); springTo(sTurn, 2, -tw * 0.08, 4.5, 0.42, dt);
      turnLive = tw !== 0 || Math.abs(sTurn[0]) + Math.abs(sTurn[1]) + Math.abs(sTurn[2]) + Math.abs(sTurn[3]) > 2e-3;
      if (!turnLive) sTurn.fill(0);
      bank = clamp(tw * (0.25 + vCur) * 0.03, -0.1, 0.1);
      pelT[4] -= tw * 0.03; spT[3] += sTurn[0]; pelT[5] -= bank * 0.4; spT[4] -= bank * 0.6; spT[1] -= bank * 0.3;
    }
    // head: forward, tilted, and turned toward the prey within limits
    let ly = 0, lp = 0;
    tDist = 99;
    if (target) {
      const hx = wp[B.head * 3], hy = wp[B.head * 3 + 1], hz = wp[B.head * 3 + 2];
      const dx = toModelX(target[0], target[2]) - hx, dz = toModelZ(target[0], target[2]) - hz, dy = target[1] - Ry - hy;
      tDist = Math.hypot(dx, dz);
      ly = clamp(Math.atan2(dx, dz), -1.0, 1.0);
      lp = clamp(-Math.atan2(dy, Math.max(0.3, tDist)), -0.5, 0.6);
    }
    lookYaw += (ly - lookYaw) * Math.min(1, dt * 3.5); lookPitch += (lp - lookPitch) * Math.min(1, dt * 3.5);
    // predatory carriage: the neck is pushed forward and the head tipped back on it, so the face
    // is up and leading; with prey in view it looks at it
    const torsoPitch = pelT[3] + spT[0] + spT[2];
    hdT[0] = ch.neckFwd + ch.headFwd * 0.3;
    hdT[1] = -(torsoPitch + hdT[0]) * 0.92 + ch.headFwd * 0.25 - 0.06 + (target ? lookPitch : 0.04 * sway2);
    hdT[1] -= al * 0.03;
    hdT[2] = ch.headYaw * (target ? 0.4 : 1) + lookYaw - (pelT[4] + spT[3] - sTurn[0]) * 0.8 + sTurn[2] + walkW * 0.09 * stiff2 * sway2;
    hdT[3] = ch.headRoll - spT[4] * 0.5 + walkW * 0.07 * stiff2 * sway + bank * 0.5;
    hdT[4] = ch.jaw + (tDist < 3 ? 0.12 * (1 + Math.sin(time * 7.3)) : 0) + 0.25 * runW;
  }

  function hands(dt, walkW) {
    const cyaw = pel[4] + sp[3];
    const cs = Math.cos(cyaw), sn = Math.sin(cyaw);
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], A = ARM[i];
      if (hnd.locked) continue;
      const sx = wp[A.b1 * 3], sy2 = wp[A.b1 * 3 + 1], sz = wp[A.b1 * 3 + 2];
      // hang: straight down from the shoulder, trailing opposite the same-side foot
      // each arm swings its own amount (one may hardly move), against the leg on its side
      const swing = -0.55 * ch.armSwing[i] * (foot[i].az - foot[1 - i].az) * walkW;
      const ox = A.side * ch.armOut[i], oz = ch.armFwd[i] + swing;
      let tx = sx + ox * cs + oz * sn, ty = sy2 - ARMLEN * ch.armBend[i] + Math.abs(swing) * 0.12, tz = sz - ox * sn + oz * cs;
      // a run: the arms pump, bent, each to its own measure (one flails wide, the other is held in)
      if (runW > 0.01) {
        const amp = (i === ch.domArm ? 0.42 : 0.24), ph = Math.sin(TAU * phase + (i ? Math.PI : 0) + (i === ch.domArm ? 0 : 0.7));
        const px = sx + A.side * (ch.armOut[i] + (i === ch.domArm ? 0.1 : 0.02)), py = sy2 - 0.34 + 0.16 * ph * (i === ch.domArm ? 1 : -0.5), pz = sz + 0.06 + amp * ph;
        tx = lerp(tx, px * cs + (pz - sz) * sn + (1 - cs) * sx, runW); ty = lerp(ty, py, runW); tz = lerp(tz, pz, runW);
      }
      // reach: toward the prey, each arm with its own range, extension and droop
      let w = 0;
      if (target && state !== 'stagger' && !armGone(i)) {
        w = smooth(ch.reachStart[i], ch.reachStart[i] - 1.3, tDist);
        if (w > 0) {
          let dx = toModelX(target[0], target[2]) - sx, dy = target[1] - Ry - 0.15 - sy2, dz = toModelZ(target[0], target[2]) - sz;
          const l = Math.hypot(dx, dy, dz) || 1;
          const ext = ARMLEN * ch.reachExt[i] * (0.9 + 0.1 * Math.sin(time * 2.1 + i * 2));
          const rx = sx + (dx / l) * ext + A.side * 0.05 + 0.02 * Math.sin(time * 3.1 + i), ry = sy2 + (dy / l) * ext + ch.reachDroop[i] + 0.025 * Math.sin(time * 2.6 + i * 1.7), rz = sz + (dz / l) * ext;
          tx = lerp(tx, rx, w); ty = lerp(ty, ry, w); tz = lerp(tz, rz, w);
        }
      }
      hnd.w += (w - hnd.w) * Math.min(1, dt * 4);
      hnd.tx = tx; hnd.ty = ty; hnd.tz = tz;
      const hw = hnd.w;
      hnd.pole[0] = lerp(A.side * 0.25, A.side * 1.0, hw); hnd.pole[1] = lerp(-0.25, -0.55, hw); hnd.pole[2] = lerp(-1, -0.1, hw);
      hnd.wrist = lerp(0.18, 0.5, hw);
      hnd.curl = lerp(ch.curl[i], 0.75 + 0.15 * Math.sin(time * 5 + i), hw);
    }
  }

  // ---- attack and stagger ride on top of the standing body ---------------------------------------
  // wind-up 0.5 s, strike, overreach, recovery
  function attackSpeed() {
    const t = sT / atkScale;
    if (atkTravel < 0) return 0;
    return ((t < 0.44 ? 0.15 : t < 0.5 ? 0.8 : t < 0.66 ? 2.0 : t < 0.9 ? 0.5 * (1 - (t - 0.66) / 0.24) : 0) * (atkTravel / 0.494)) / atkScale;
  }
  function stateLayer(dt) {
    const t = sT;
    if (state === 'stagger') {
      sChest[1] += (stagDir < 0 ? -1 : 1) * 9 * dt * Math.exp(-t * 5);
      for (const hnd of hand) hnd.locked = false;
      if (t > 0.8) { api.done = true; state = 'idle'; }
      return;
    }
    const A = ARM[atkArm], side = A.side;
    // the wind-up the AI waits out differs by type (tuning.zombies.types[*].windup: 0.5 s walker,
    // 0.35 s runner, 0.6 s brute): the same motion, played to that clock
    const ts = atkScale, lunge = atkLunge;
    const tq = t / ts;
    // how far the lunge carries the root: up to 0.5 m (a runner throws itself further), less when the
    // prey is already close, so the face arrives in front of its eyes rather than behind them
    if (atkTravel < 0) atkTravel = target ? clamp(Math.hypot(target[0] - Rx, target[2] - Rz) - 0.92, 0.04, 0.5 * lunge) : 0.5;
    // envelope of each phase: coil (the tell the player backs away from), lunge, the clutch, recovery
    const wind = smooth(0, 0.3, tq) * (1 - smooth(0.45, 0.56, tq));
    const strike = smooth(0.45, 0.6, tq);
    const over = smooth(0.62, 0.86, tq) * (1 - smooth(1.0, 1.45, tq));
    const rec = smooth(1.0, 1.5, tq);
    const hold = strike * (1 - rec);
    // lunge step with the opposite foot, timed to land with the blow
    const lf = 1 - atkArm;
    const dq = dt / ts;
    if (tq >= 0.4 && tq - dq < 0.4 && foot[lf].planted && foot[1 - lf].planted) {
      const mz = (0.3 * hS + 0.2) * (0.4 + 1.2 * atkTravel), mx = foot[lf].side * ch.stanceW;
      startSwing(lf, 0.24 * ts, 1, toWorldX(mx, mz), toWorldZ(mx, mz));
      foot[lf].lift = 0.07;
    }
    // the trailing foot stumbles up under the body after the blow
    if (tq >= 0.68 && tq - dq < 0.68 && foot[lf].planted && foot[1 - lf].planted) {
      const mx = foot[1 - lf].side * ch.stanceW;
      startSwing(1 - lf, 0.28 * ts, 1, toWorldX(mx, 0.16), toWorldZ(mx, 0.16));
    }
    if (!atkHit && tq >= 0.58) { atkHit = true; if (onHit) onHit(); }
    // coil: the weight sinks back onto bent knees, the hands come up clawed beside the head and the jaw
    // drops. Lunge: the body is thrown at the prey UPRIGHT, chest first, so what the prey sees is the
    // face coming at its own between two reaching hands. Then it hangs on: pulls itself in, snapping.
    // (The original bowed the trunk through the blow and the player saw the top of a head.)
    stateAdd.pz = -0.11 * wind + 0.04 * hold;
    stateAdd.py = -0.06 * wind + 0.05 * hold;
    stateAdd.pitch = 0.1 * wind + (0.04 + 0.1 * (lunge - 1)) * hold + 0.05 * over;
    stateAdd.yaw = side * (0.16 * wind - 0.08 * hold);
    stateAdd.neck = -0.1 * wind + 0.12 * hold;
    // the face goes for the prey's face: world pitch of the head that looks from its own eyes into the
    // prey's (the target is the chest; the eyes are about 0.4 m above it)
    atkAim = Math.max(0.55 * wind, hold);
    atkPitch = 0;
    if (target) {
      const hx = toModelX(target[0], target[2]) - wp[B.head * 3], hz = toModelZ(target[0], target[2]) - wp[B.head * 3 + 2];
      atkPitch = -clamp(Math.atan2(target[1] - Ry + 0.4 - (wp[B.head * 3 + 1] + 0.08), Math.max(0.25, Math.hypot(hx, hz))), -0.3, 0.75);
    }
    // the jaw gapes through the lunge, then snaps at it
    stateAdd.jaw = 0.45 * wind + 0.62 * hold * (over > 0.3 ? 0.55 + 0.45 * Math.cos((tq - 0.62) * 26) : 1);
    // both hands come up open beside the head, are thrown out to either side of the prey's head at the
    // height of its eyes (the face stays clear between them), then clutch and drag it in and down
    const tmx = target ? clamp(toModelX(target[0], target[2]), -0.3, 0.3) : 0;
    const tmz = target ? toModelZ(target[0], target[2]) : 1.1;
    const eyeY = target ? target[1] - Ry + 0.3 : wp[B.head * 3 + 1];
    const both = atkStyle === 2;
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], Ar = ARM[i];
      const lead = i === atkArm || both;
      const tt = lead ? tq : tq - 0.05;                                   // the second hand is just behind
      const sx = wp[Ar.b1 * 3], sy2 = wp[Ar.b1 * 3 + 1], sz = wp[Ar.b1 * 3 + 2];
      const bx = sx + Ar.side * ch.armOut[i], by = sy2 - ARMLEN * ch.armBend[i], bz = sz + ch.armFwd[i];   // the hang
      const wx = sx + Ar.side * 0.17, wy = sy2 + (lead ? 0.1 : 0.02), wz = sz + 0.2;                      // clawed, beside its own head
      const kx = tmx + Ar.side * (lead ? 0.2 : 0.25), ky = clamp(eyeY - (lead ? 0.02 : 0.1), sy2 - 0.12, sy2 + 0.34);
      const kz = Math.min(sz + ARMLEN * 0.97, Math.max(sz + 0.3, tmz - 0.1));                          // either side of the prey's head
      const ox = tmx * 0.6 + Ar.side * 0.15, oy = ky - 0.2, oz = Math.max(sz + 0.25, kz - 0.14);       // dragging it in and down
      const w1 = smooth(0, 0.28, tt), w2 = smooth(0.45, 0.58, tt), w3 = smooth(0.72, 0.98, tt);
      let tx = lerp(bx, wx, w1), ty = lerp(by, wy, w1), tz = lerp(bz, wz, w1);
      tx = lerp(tx, kx, w2); ty = lerp(ty, ky, w2); tz = lerp(tz, kz, w2);
      tx = lerp(tx, ox, w3); ty = lerp(ty, oy, w3); tz = lerp(tz, oz, w3);
      // an arm that ends at the elbow only swings forward: reaching would fold the stump up into the face
      const gone = armGone(i);
      const part = (gone ? 0.3 : 1) * (1 - rec);
      hnd.tx = lerp(bx, tx, part); hnd.ty = lerp(by, ty, part * (gone ? 0.5 : 1)); hnd.tz = lerp(bz, tz, part);
      hnd.locked = true;
      hnd.w = Math.max(w1 * 0.8, w2) * (1 - rec);
      // elbows down and out, never above the hands, so the forearms frame the face instead of crossing it
      hnd.pole[0] = Ar.side * lerp(0.7, 0.75, w2); hnd.pole[1] = -1; hnd.pole[2] = lerp(-0.5, -0.15, w2);
      hnd.wrist = lerp(0.1, -0.45, w1 * (1 - w3)) + 0.3 * w3;         // palms shown to the prey, fingers spread, then clenched
      hnd.curl = lerp(lerp(ch.curl[i], 0.12, w1), 0.85, w3);
    }
    if (tq > 1.55) { api.done = true; state = 'idle'; endAttack(); }
  }
  let atkAim = 0, atkPitch = 0, atkScale = 1, atkLunge = 1, runW = 0, sevN = zombie.severed.size;
  const armGone = (i) => sevArm === i || zombie.severed.has(i ? 'armR' : 'armL');

  // ---- the brute's slam: both fists overhead, then the whole trunk brought down on the ground ------
  function slamLayer(dt) {
    const t = sT;
    const rise = smooth(0, 0.45, t) * (1 - smooth(0.5, 0.6, t));
    const down = smooth(0.5, 0.6, t);
    const rec = smooth(0.95, 1.5, t);
    const hold = down * (1 - rec);
    if (!slamHit && t >= 0.6) {
      slamHit = true;
      if (gore) gore.slam(zombie, toWorldX(0, 0.85 * hS), Ry, toWorldZ(0, 0.85 * hS));
      sChest[1] += 4; sHead[1] += 5; sPel[3] -= 0.5;
      if (onHit) onHit();
    }
    stateAdd.pz = -0.08 * rise + 0.12 * hold; stateAdd.py = 0.02 * rise - 0.28 * hold;
    stateAdd.pitch = -0.32 * rise + 1.1 * hold; stateAdd.yaw = 0; stateAdd.neck = -0.15 * rise + 0.1 * hold;
    stateAdd.head = 0; stateAdd.jaw = 0.5 * rise + 0.3 * hold; atkAim = 0;
    const top = wp[B.head * 3 + 1] + 0.3 * hS;
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], Ar = ARM[i];
      const sx = wp[Ar.b1 * 3], sy2 = wp[Ar.b1 * 3 + 1], sz = wp[Ar.b1 * 3 + 2];
      const bx = sx + Ar.side * ch.armOut[i], by = sy2 - ARMLEN * ch.armBend[i], bz = sz + ch.armFwd[i];
      const ux = Ar.side * 0.1, uy = top, uz = sz - 0.05;                    // fists together over the head
      const gx = Ar.side * 0.13, gy = 0.13 * hS, gz = 0.85 * hS;             // on the ground in front
      const w1 = smooth(0, 0.42, t), w2 = down;
      let tx = lerp(bx, ux, w1), ty = lerp(by, uy, w1), tz = lerp(bz, uz, w1);
      tx = lerp(tx, gx, w2); ty = lerp(ty, gy, w2); tz = lerp(tz, gz, w2);
      hnd.tx = lerp(tx, bx, rec); hnd.ty = lerp(ty, by, rec); hnd.tz = lerp(tz, bz, rec);
      hnd.locked = true; hnd.w = Math.max(w1, w2) * (1 - rec);
      hnd.pole[0] = Ar.side * 0.9; hnd.pole[1] = lerp(-0.2, -0.6, w2); hnd.pole[2] = lerp(-0.6, -0.2, w2);
      hnd.wrist = 0.1; hnd.curl = lerp(ch.curl[i], 1, w1);
    }
    if (t > DURATION.slam) { api.done = true; state = 'idle'; endAttack(); }
  }

  // ---- tearing a board off a window: both hands on it, the weight thrown back, it comes away -------
  function tearLayer() {
    const t = sT;
    const reach = smooth(0, 0.22, t), heave = smooth(0.34, 0.58, t), free = smooth(0.62, 0.8, t);
    stateAdd.pz = 0.1 * reach - 0.3 * heave * (1 - free * 0.6); stateAdd.py = -0.07 * heave * (1 - free);
    stateAdd.pitch = 0.22 * reach * (1 - heave) - 0.5 * heave * (1 - free * 0.6); stateAdd.yaw = 0.14 * Math.sin(t * 21) * heave * (1 - free);
    stateAdd.neck = 0; stateAdd.head = 0; stateAdd.jaw = 0.35 * heave; atkAim = 0;
    const tmx = target ? clamp(toModelX(target[0], target[2]), -0.25, 0.25) : 0;
    const tmz = target ? toModelZ(target[0], target[2]) : 0.6;
    const tmy = target ? clamp(target[1] - Ry, 0.75 * hS, 1.5 * hS) : 1.2 * hS;
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], Ar = ARM[i];
      const sx = wp[Ar.b1 * 3], sy2 = wp[Ar.b1 * 3 + 1], sz = wp[Ar.b1 * 3 + 2];
      const bx = sx + Ar.side * ch.armOut[i], by = sy2 - ARMLEN * ch.armBend[i], bz = sz + ch.armFwd[i];
      const gz = Math.min(sz + ARMLEN * 0.96, Math.max(sz + 0.25, tmz - 0.04));
      const gx = tmx + Ar.side * 0.19, gy = tmy + (i ? -0.05 : 0.04);                           // on the board
      const px = gx + Ar.side * 0.05, py = gy - 0.16, pz = Math.max(sz + 0.2, gz - 0.2);        // wrenched back
      const fx2 = sx + Ar.side * 0.4, fy = sy2 + (i ? -0.3 : 0.05), fz = sz + 0.05;                           // flung clear
      let tx = lerp(bx, gx, reach), ty = lerp(by, gy, reach), tz = lerp(bz, gz, reach);
      tx = lerp(tx, px, heave); ty = lerp(ty, py, heave); tz = lerp(tz, pz, heave);
      tx = lerp(tx, fx2, free); ty = lerp(ty, fy, free); tz = lerp(tz, fz, free);
      const part = armGone(i) ? 0.3 : 1;
      hnd.tx = lerp(bx, tx, part); hnd.ty = lerp(by, ty, part); hnd.tz = lerp(bz, tz, part);
      hnd.locked = true; hnd.w = reach * (1 - free * 0.5);
      hnd.pole[0] = Ar.side * 0.7; hnd.pole[1] = -0.8; hnd.pole[2] = -0.3;
      hnd.wrist = -0.2 * reach * (1 - free); hnd.curl = lerp(ch.curl[i], 1, smooth(0.16, 0.26, t) * (1 - free));
    }
    if (t > DURATION.tear) { api.done = true; state = 'idle'; endAttack(); }
  }

  // ---- a bloater's fuse: it stops, arches back, the trunk swells and shudders (the burst is a death)
  function burstLayer() {
    const t = sT, sw = smooth(0, DURATION.burst, t), shake = Math.sin(time * 47) * 0.012 * sw;
    stateAdd.pz = -0.03 * sw; stateAdd.py = 0.02 * sw + shake; stateAdd.pitch = -0.3 * sw; stateAdd.yaw = shake * 4;
    stateAdd.neck = -0.2 * sw; stateAdd.head = 0; stateAdd.jaw = 0.6 * sw; atkAim = 0;
    const sc = pose.scale, bs = zombie.baseScale, g = 1 + 0.42 * sw + shake;
    for (const b of SWELL) { sc[b * 3] = bs[b * 3] * g; sc[b * 3 + 2] = bs[b * 3 + 2] * (g + 0.08 * sw); }
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], Ar = ARM[i];
      const sx = wp[Ar.b1 * 3], sy2 = wp[Ar.b1 * 3 + 1], sz = wp[Ar.b1 * 3 + 2];
      const bx = sx + Ar.side * ch.armOut[i], by = sy2 - ARMLEN * ch.armBend[i], bz = sz + ch.armFwd[i];
      hnd.tx = lerp(bx, sx + Ar.side * 0.42, sw); hnd.ty = lerp(by, sy2 - 0.22 + shake * 3, sw); hnd.tz = lerp(bz, sz - 0.08, sw);
      hnd.locked = true; hnd.w = sw; hnd.pole[0] = Ar.side; hnd.pole[1] = -0.5; hnd.pole[2] = -0.6; hnd.wrist = -0.3 * sw; hnd.curl = lerp(ch.curl[i], 0.1, sw);
    }
    if (t > 3) { api.done = true; state = 'idle'; endAttack(); }      // a fuse the AI never ended
  }

  // ---- the crawler: down on its forearms, hauling itself along, the legs trailing --------------------
  // Each hand in turn is thrown forward, set down and locked to the ground (in world space, as the
  // feet are when walking), and the body is hauled past it; the speed surges with each haul.
  const cHand = [0, 1].map((i) => ({ wx: 0, wz: 0, down: false, s: 1, sx: 0, sz: 0, side: i ? -1 : 1 }));
  let cPhase = 0, cTravel = 0, cInit = false;
  const C_REACH = 0.36;
  function crawlClock(dt, v, walking) {
    const sh = 0.52 * hS;                       // the shoulders lie this far ahead of the root
    if (!cInit) {
      cInit = true;
      for (const c of cHand) { c.wx = toWorldX(c.side * 0.2, sh + 0.1); c.wz = toWorldZ(c.side * 0.2, sh + 0.1); c.down = true; c.s = 1; }
    }
    pending[0] = pending[1] = false;
    if (!walking || v < 0.03) { api.rootSpeed = walking ? v : 0; return; }
    cycleT = (2 * C_REACH * 1.6) / Math.max(v, 0.2);
    const p0 = cPhase;
    cPhase += dt / cycleT;
    if (cPhase >= 1) cPhase -= 1;
    for (let i = 0; i < 2; i++) {
      const c = cHand[i], at = i ? 0.5 : 0;
      // the hand leaves the ground at its point in the cycle, unless the arm is gone
      const crossed = i ? (p0 < 0.5 && cPhase >= 0.5) : cPhase < p0;
      if (crossed && c.down && !armGone(i)) { c.down = false; c.s = 0; c.sx = c.wx; c.sz = c.wz; }
      if (!c.down) {
        c.s = Math.min(1, c.s + dt / (0.36 * cycleT));
        const mz = sh + C_REACH + v * 0.36 * cycleT * (1 - c.s);
        const e = c.s * c.s * (3 - 2 * c.s);
        c.wx = lerp(c.sx, toWorldX(c.side * (0.17 + 0.05 * (i === ch.domArm ? 1 : 0)), mz), e); c.wz = lerp(c.sz, toWorldZ(c.side * 0.2, mz), e);
        if (c.s >= 1) { c.down = true; sChest[1] += 0.6; sHead[1] += 1.2; }
      }
      void at;
    }
    // hauled forward while a hand is pulling, slack between
    api.rootSpeed = v * (1 + 0.6 * Math.cos(TAU * 2 * cPhase + 1.2));
    cTravel += Math.abs(api.rootSpeed) * dt;
    if (cTravel >= 0.6) { cTravel = 0; if (gore) gore.drag(zombie, Rx, Ry, Rz, yaw); }
  }
  function crawlBody(dt, v) {
    const e = prone * prone * (3 - 2 * prone);
    const pull = Math.sin(TAU * cPhase), haul = Math.cos(TAU * 2 * cPhase + 1.2);
    // the trunk along the ground, propped a little on the forearms, twisting toward the hand that hauls
    pelT[0] = lerp(pelT[0], 0.02 * pull, e); pelT[1] = lerp(pelT[1], (0.15 + 0.012 * haul) * hS, e); pelT[2] = lerp(pelT[2], 0, e);
    pelT[3] = lerp(pelT[3], 1.46, e); pelT[4] = lerp(pelT[4], 0.14 * pull, e); pelT[5] = lerp(pelT[5], 0.12 * pull, e);
    spT[0] = lerp(spT[0], -0.08, e); spT[1] = lerp(spT[1], -0.1 * pull, e); spT[2] = lerp(spT[2], -0.2 + 0.05 * haul, e); spT[3] = lerp(spT[3], -0.2 * pull, e); spT[4] = lerp(spT[4], -0.12 * pull, e);
    // the head held up off the ground, on the prey when there is one
    hdT[0] = lerp(hdT[0], -0.35, e); hdT[1] = lerp(hdT[1], -0.85 + (target ? clamp(lookPitch, -0.3, 0.3) : 0), e); hdT[3] = lerp(hdT[3], ch.headRoll * 0.5, e);
    hdT[4] = lerp(hdT[4], ch.jaw + 0.2 + 0.1 * Math.sin(time * 6), e);
    if (prone <= 0.5) return;
    // hands: on the ground where they were set down, or in the air on the way to the next hold
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], c = cHand[i];
      if (state === 'attack' && i === atkArm) continue;         // the grab has this hand
      if (armGone(i)) { hnd.locked = false; continue; }
      hnd.tx = toModelX(c.wx, c.wz); hnd.tz = toModelZ(c.wx, c.wz);
      hnd.ty = 0.05 + (c.down ? 0 : 0.1 * Math.sin(Math.PI * c.s));
      hnd.locked = true; hnd.w = 1;
      hnd.pole[0] = ARM[i].side * 1; hnd.pole[1] = 0.5; hnd.pole[2] = -0.6;      // elbows out and up off the ground
      hnd.wrist = c.down ? 0.6 : 0.1; hnd.curl = c.down ? 0.5 : 0.15;
    }
    // legs: dragged. What is left of each lies behind the hips, toes turned out, rocking with the haul
    for (let i = 0; i < 2; i++) {
      const f = foot[i];
      const gone = zombie.severed.has(i ? 'legR' : 'legL');
      const kick = gone ? 0 : 0.05 * Math.sin(TAU * cPhase + (i ? Math.PI : 0));
      f.ax = f.side * (0.12 + 0.03 * i) * hS; f.az = -(LEGLEN * 0.93) + kick; f.ay = 0.075 * hS;
      f.pitch = 1.25; f.myaw = f.side * 0.5; f.roll = 0; f.poleY = -0.75; f.planted = true; f.y = 0; f.sup = 1;
      f.px = toWorldX(f.ax, f.az); f.pz = toWorldZ(f.ax, f.az); f.yaw = yaw + f.myaw; f.st = 0; f.walkPlant = false;
    }
    void dt; void v;
  }
  // a grab at ankle height: one arm thrown out along the ground at the prey's feet, clawed back
  function crawlAttack() {
    const t = sT, i = atkArm, hnd = hand[i], Ar = ARM[i];
    const out = smooth(0.25, 0.5, t) * (1 - smooth(0.85, 1.3, t)), claw = smooth(0.5, 0.62, t);
    if (!atkHit && t >= 0.5) { atkHit = true; if (onHit) onHit(); }
    const sx = wp[Ar.b1 * 3], sz = wp[Ar.b1 * 3 + 2];
    const tmx = target ? clamp(toModelX(target[0], target[2]), -0.35, 0.35) : 0;
    const tmz = target ? toModelZ(target[0], target[2]) : sz + 0.6;
    const c = cHand[i];
    const hx = toModelX(c.wx, c.wz), hz = toModelZ(c.wx, c.wz);
    hnd.tx = lerp(hx, tmx + Ar.side * 0.04, out); hnd.tz = lerp(hz, Math.min(sz + ARMLEN * 0.97, Math.max(sz + 0.3, tmz - 0.05)), out) - 0.1 * claw * out;
    hnd.ty = lerp(0.05, 0.16, out) + 0.12 * Math.sin(Math.PI * smooth(0.25, 0.5, t)) * (1 - claw);
    hnd.locked = true; hnd.w = 1; hnd.pole[0] = Ar.side; hnd.pole[1] = 0.6; hnd.pole[2] = -0.4;
    hnd.wrist = lerp(0.6, -0.3, out); hnd.curl = lerp(0.15, 0.95, claw);
    sChest[1] += 0.02 * out;
    if (t > 1.4) { api.done = true; state = 'idle'; endAttack(); }
  }
  const stateAdd = { pz: 0, py: 0, pitch: 0, yaw: 0, head: 0, neck: 0, jaw: 0 };
  // attack offsets are added after the standing targets are computed
  function bodyTargets(dt, walkW) {
    baseTargets(dt, walkW);
    if (state !== 'attack' && state !== 'slam' && state !== 'tear' && state !== 'burst') return;
    pelT[2] += stateAdd.pz; pelT[1] += stateAdd.py;
    spT[0] += stateAdd.pitch * 0.4; spT[2] += stateAdd.pitch * 0.6; spT[3] += stateAdd.yaw; pelT[4] += stateAdd.yaw * 0.35;
    hdT[0] += stateAdd.neck;
    // the head is aimed outright: whatever the trunk and the neck are doing, the face is on the prey's
    const aimed = atkPitch - (pelT[3] + spT[0] + spT[2] + hdT[0]);
    hdT[1] = lerp(hdT[1], clamp(aimed - 0.32, -1.3, 0.4), atkAim);   // (less the forward set of the neck its carriage adds)
    hdT[2] *= 1 - 0.6 * atkAim; hdT[3] *= 1 - 0.5 * atkAim;
    hdT[4] = clamp(hdT[4] + stateAdd.jaw, 0, 0.75);
  }

  // ---- clip: the fence climb -------------------------------------------------------------------
  function playClip(dt) {
    const dead = false;
    const t = Math.min(sT, clipEnd);
    clipAt(clip, t, _seg);
    const a = _seg.a, b = _seg.b, u = _seg.u;
    // collapse: momentum carries the body on a little; climb: keys are in the starting frame
    let shift = 0, shiftF = 0;
    if (dead) { shift = clipMom * (1 - Math.exp(-sT * 4)) / 4; shiftF = shift * smooth(0.2, 0.5, sT); api.rootSpeed = 0; } else {
      const travel = (Rx - clipX0) * Math.sin(clipYaw0) + (Rz - clipZ0) * Math.cos(clipYaw0);
      shift = shiftF = -travel;
      api.rootSpeed = sT > clipT0 && sT < clipEnd ? clipSpeed : 0;
    }
    for (let i = 0; i < 6; i++) pelT[i] = lerp(a.pel[i], b.pel[i], u);
    const k0 = a === clip[0] ? 1 - u : 0;   // key 0 is already in the current frame
    pelT[2] += shift * (1 - k0);
    for (let i = 0; i < 5; i++) { spT[i] = lerp(a.sp[i], b.sp[i], u); hdT[i] = lerp(a.hd[i], b.hd[i], u); }
    const cb = B.spine2;
    for (let i = 0; i < 2; i++) {
      const hnd = hand[i], ha = a.hand[i], hb = b.hand[i];
      for (let n = 0; n < 2; n++) {
        const hk = n ? hb : ha;
        const o = n * 3;
        if (hk[3] > 0.5) {
          vRot(_v, wq, cb * 4, hk[0], hk[1], hk[2]);
          _q[o] = wp[cb * 3] + _v[0]; _q[o + 1] = wp[cb * 3 + 1] + _v[1]; _q[o + 2] = wp[cb * 3 + 2] + _v[2];
        } else { _q[o] = hk[0]; _q[o + 1] = hk[1]; _q[o + 2] = hk[2] + (n === 0 && a === clip[0] ? 0 : shift); }
      }
      hnd.tx = lerp(_q[0], _q[3], u); hnd.ty = lerp(_q[1], _q[4], u); hnd.tz = lerp(_q[2], _q[5], u);
      const py = lerp(ha[4], hb[4], u), sd = ARM[i].side;
      hnd.pole[0] = sd * (0.3 + 0.6 * Math.abs(py)); hnd.pole[1] = py * 1.2 - 0.2 * (1 - Math.abs(py)); hnd.pole[2] = -1 + 0.8 * Math.abs(py);
      hnd.wrist = dead ? lerp(hnd.wrist, 0.15, 0.1) : 0.1; hnd.curl = dead ? lerp(hnd.curl, 0.9, 0.08) : 0.9; hnd.w = 1; hnd.locked = false;
      if (dead && hnd.ty < 0.105) hnd.ty = 0.105;   // the wrist rests on the curled fingers
      const f = foot[i], fa = a.foot[i], fb = b.foot[i];
      f.ax = lerp(fa[0], fb[0], u); f.ay = lerp(fa[1], fb[1], u); f.az = lerp(fa[2] + (a === clip[0] ? 0 : shiftF), fb[2] + shiftF, u);
      f.pitch = lerp(fa[3], fb[3], u); f.myaw = lerp(fa[4], fb[4], u); f.roll = lerp(fa[5], fb[5], u); f.poleY = lerp(fa[6], fb[6], u);
      f.planted = false; f.sup = 0;
    }
    if (sT >= clipEnd) {
      if (dead) {
        // the head and hands keep settling on their springs for a moment, then the body is still
        if (sT > clipEnd + 0.9) { settled = true; api.done = true; }
      } else {
        // down on the far side: plant the feet where they are and get up as ordinary locomotion
        for (const f of foot) {
          f.px = toWorldX(f.ax, f.az); f.pz = toWorldZ(f.ax, f.az); f.yaw = yaw + f.myaw; f.planted = true; f.st = 0; f.walkPlant = false; f.pitch = 0; f.y = 0; f.sup = 1;
        }
        sChest[1] += 2.5; sHead[1] += 3; stepCool = 0.25;
        state = 'idle'; sT = 0; api.done = true; vCur = 0.5;
      }
    }
  }

  // keep the lying body out of the floor: lift the pelvis by the deepest torso point
  function groundTorso() {
    let dip = 0;
    const G0 = rag.ground;
    const chk = (b, rad, uy, gi) => {
      let y = wp[b * 3 + 1];
      if (uy) { vRot(_v, wq, b * 4, 0, uy, 0.01); y += _v[1]; }
      dip = Math.max(dip, rad + G0[gi] - y);
    };
    chk(B.hips, pelvisR, 0, RG.hipL); chk(B.spine2, 0.118 * pose.scale[B.spine2 * 3 + 2], 0.1, RG.shL); chk(B.spine1, 0.105 * pose.scale[B.spine1 * 3 + 2], 0.05, RG.waist);
    chk(B.head, 0.1, 0.085, RG.head); chk(B.upperArmL, 0.062, 0, RG.shL); chk(B.upperArmR, 0.062, 0, RG.shR);
    if (dip > 0.001) {
      off[B.hips * 3 + 1] += dip;
      solveFK(bones, pose, ZERO3, ID_Q, 0, false);
    }
  }

  return api;
}
