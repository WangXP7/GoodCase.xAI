/**
 * animator.js —— 姿态过渡与动画驱动（presentation 层的"唯一 sim → 渲染 接口"）
 *
 * 依据：architecture §5.4（8 morph + 骨骼 + shader 三通道）、§5.4.4（CatExpressionTarget）
 *       GDD §3.7（cat.expression.target { ear, tail, eye, pupil, whisker, mouth }，0.25s 更新）
 *       附录 C（状态 → MVP 12 姿态映射 + 参数化）
 *       美术圣经 §4.4（呼吸/摆动为渲染帧程序化）、§4.3.2（尾巴 = 情绪核心通道）
 *
 * 分层（与 core/tick.js 的分层 tick 对齐）：
 *   4 Hz（CatState.expression）：只更新**目标值**，纯数值，0 分配倾向
 *   渲染帧（本文件 update）：把当前值向目标值缓动 → 写入 Object3D 变换
 *
 * 缓动一律取自 core/easing.js（项目约束：不引入补间库，ADR-101 §2.3）。
 */

import { clamp, clamp01, lerp, lerpAngle, easeInOutCubic, damp } from '../core/easing.js';
import { POSES, composePose, resolvePose, tailCurve, TAIL_SEGMENTS } from './poses.js';

/* ============================================================================
 * 关节表（与 model.js 的 joints 键一一对应；缺失的关节会被安静跳过）
 * ========================================================================== */

export const JOINT_KEYS = Object.freeze([
  'root', 'body', 'chest', 'neck', 'head', 'jaw',
  'earL', 'earR', 'whiskerL', 'whiskerR',
  'eyeL', 'eyeR', 'pupilL', 'pupilR',
  'legFL', 'kneeFL', 'legFR', 'kneeFR',
  'legBL', 'kneeBL', 'legBR', 'kneeBR',
]);

const newJointValue = () => ({ pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
function cloneJoint(v) { return { pos: v.pos.slice(), rot: v.rot.slice(), scale: v.scale.slice() }; }

/** 从姿态数据取出某关节的目标值 */
function jointFromPose(pose, key) {
  const j = (pose.joints && pose.joints[key]) || null;
  const s = (pose.scale && pose.scale[key]) || null;
  const out = newJointValue();
  if (j) {
    if (j.pos) out.pos = j.pos.slice();
    if (j.rot) out.rot = j.rot.slice();
    if (j.scale) out.scale = j.scale.slice();
  }
  if (s) out.scale = s.slice();
  return out;
}

/** 从姿态数据构造 8 段尾骨目标 */
function tailFromPose(pose) {
  const t = pose.tail || {};
  const curve = tailCurve(
    t.base != null ? t.base : -1.45,
    t.bend != null ? t.bend : 0,
    t.roll != null ? t.roll : 0,
    t.scaleXZ != null ? t.scaleXZ : 1,
  );
  return curve;
}

/* ============================================================================
 * CatAnimator
 * ========================================================================== */

export class CatAnimator {
  /**
   * @param {object} opts
   * @param {object} opts.cat              buildCat() 的返回对象
   * @param {number} [opts.blend]          默认姿态混合时长（真实秒）
   * @param {object} [opts.rng]            种子化 RNG（眨眼/耳抖的确定性随机，RUL-9）
   * @param {boolean} [opts.autoResolve]   是否随 catState.state 自动切换姿态（默认 true）
   */
  constructor({ cat, blend = 0.35, rng = null, autoResolve = true } = {}) {
    if (!cat || !cat.joints) throw new Error('CatAnimator: 需要 buildCat() 的返回对象');
    this.cat = cat;
    this.joints = cat.joints;
    this.blend = blend;
    this.autoResolve = autoResolve;
    this.rng = rng || makeLCG(0x1a2b3c4d);

    /* ---- 当前"应用值"（实际写到 Object3D 上的值） ---- */
    this._joints = Object.create(null);
    for (const k of JOINT_KEYS) this._joints[k] = newJointValue();
    this._tail = tailFromPose(POSES.Idle_Sit);
    this._eyes = { lid: 1, pupilX: 0.6, pupilY: 1 };
    this._mouth = { open: 0, flehmen: 0 };
    this._chestBase = 1;

    /* ---- 过渡 ---- */
    this._fromJoints = Object.create(null);
    this._toJoints = Object.create(null);
    this._fromTail = null; this._toTail = null;
    this._fromEyes = null; this._toEyes = null;
    this._fromMouth = null; this._toMouth = null;
    this._t = 1; this._dur = blend;
    this._locked = false;

    /* ---- 程序化次级动画的相位 ---- */
    this.time = 0;                 // 本 animator 的子动画时间轴
    this._breathPhase = 0;
    this._tailPhase = 0;
    this._walkPhase = 0;
    this._jawPhase = 0;
    this._blinkTimer = randRange(this.rng, 2.0, 5.0);
    this._blinkPhase = -1;         // <0 = 未在眨眼
    this._blinkDur = 0.12;
    this._earTwitchTimer = randRange(this.rng, 2.5, 7.0);
    this._earTwitchPhase = -1;
    this._walkSpeed = 1.0;

    this._poseName = 'Idle_Sit';
    this._pose = composePose('Idle_Sit', null);
    this._lastState = null;

    /* ---- 次级动画的派生量（首帧写入前必须先有初值） ---- */
    this._lid = 1;
    this._pupilScale = [0.6, 1];
    this._whisker = 0.9;
    this._earOverride = null;
    this._walkCycle = null;
    this._jawIdle = 0;

    this._applyToRig(0);           // 首帧直接落位
    this._t = 1;
  }

  /* ------------------------------------------------------------------ */
  /** 当前姿态名 */
  get currentPose() { return this._poseName; }
  /** 是否处于过渡中 */
  get isBlending() { return this._t < this._dur; }

  /**
   * 切换到目标姿态（带平滑过渡）。
   * @param {string} name   POSES 的键
   * @param {object} [opts] { state, blend, lock }
   */
  setPose(name, opts = {}) {
    const state = opts.state != null ? opts.state : this._lastState;
    const pose = composePose(POSES[name] ? name : 'Idle_Sit', state);
    this._poseName = pose.name;
    this._pose = pose;
    this._locked = !!opts.lock;

    // from = 当前应用值
    this._fromJoints = Object.create(null);
    for (const k of JOINT_KEYS) this._fromJoints[k] = cloneJoint(this._joints[k]);
    this._fromTail = cloneTail(this._tail);
    this._fromEyes = { ...this._eyes };
    this._fromMouth = { ...this._mouth };

    // to = 姿态目标
    this._toJoints = Object.create(null);
    for (const k of JOINT_KEYS) this._toJoints[k] = jointFromPose(pose, k);
    this._toTail = tailFromPose(pose);
    this._toEyes = {
      lid: pose.eyes && pose.eyes.lid != null ? pose.eyes.lid : 1,
      pupilX: pose.eyes && pose.eyes.pupilX != null ? pose.eyes.pupilX : 0.6,
      pupilY: pose.eyes && pose.eyes.pupilY != null ? pose.eyes.pupilY : 1,
    };
    this._toMouth = {
      open: pose.mouth && pose.mouth.open != null ? pose.mouth.open : 0,
      flehmen: pose.mouth && pose.mouth.flehmen != null ? pose.mouth.flehmen : 0,
    };

    this._dur = Math.max(1e-3, opts.blend != null ? opts.blend : this.blend);
    this._t = 0;
    return this;
  }

  /** 解除锁定（一次性姿态播放完后回到自动解析） */
  release() { this._locked = false; return this; }

  /**
   * 每渲染帧调用。
   * @param {number} dt 真实秒（渲染帧）
   * @param {import('./state.js').CatState} [catState] 读取 state 与 expression
   */
  update(dt, catState = null) {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);            // 单帧钳制，防切后台回来抽搐
    this.time += dt;

    const expr = catState ? catState.expression : null;

    // —— 1. 自动姿态解析（状态变化 → 换姿态）
    if (this.autoResolve && catState && catState.state) {
      const st = catState.state;
      if (!this._locked && st !== this._lastState) {
        const next = resolvePose(st, catState.personality, {
          pettedFromSleep: this._lastState === 'SLEEP_DEEP' || this._lastState === 'SLEEP_LIGHT',
        });
        const composed = composePose(POSES[next] ? next : 'Idle_Sit', st);
        if (!composed.passthrough) this.setPose(next, { state: st, blend: blendFor(st, this._lastState) });
      }
      this._lastState = st;
    }

    // —— 2. 姿态过渡推进
    if (this._t < this._dur) this._t = Math.min(this._dur, this._t + dt);
    const u = this._dur > 0 ? clamp01(this._t / this._dur) : 1;
    const w = easeInOutCubic(u);
    this._blendJoints(w);
    this._tail = lerpTail(this._fromTail, this._toTail, w);
    this._eyes = {
      lid: lerp(this._fromEyes.lid, this._toEyes.lid, w),
      pupilX: lerp(this._fromEyes.pupilX, this._toEyes.pupilX, w),
      pupilY: lerp(this._fromEyes.pupilY, this._toEyes.pupilY, w),
    };
    this._mouth = {
      open: lerp(this._fromMouth.open, this._toMouth.open, w),
      flehmen: lerp(this._fromMouth.flehmen, this._toMouth.flehmen, w),
    };

    // —— 3. 次级动画叠加（呼吸 / 眨眼 / 耳抖 / 尾摆 / 步态 / 咀嚼）
    this._secondary(dt, expr);

    // —— 4. 写入 rig
    this._applyToRig(dt);
    return this;
  }

  /* ------------------------------------------------------------------ */
  _blendJoints(w) {
    for (const k of JOINT_KEYS) {
      const a = this._fromJoints[k], b = this._toJoints[k], o = this._joints[k];
      for (let i = 0; i < 3; i++) {
        o.pos[i] = lerp(a.pos[i], b.pos[i], w);
        o.rot[i] = lerpAngle(a.rot[i], b.rot[i], w);
        o.scale[i] = lerp(a.scale[i], b.scale[i], w);
      }
    }
  }

  _secondary(dt, expr) {
    const sec = this._pose.secondary || {};
    const breathAmp = (sec.breathAmp != null ? sec.breathAmp : 1) * (expr && expr.breathAmp != null ? expr.breathAmp : 1);
    const breathRate = (sec.breathRate != null ? sec.breathRate : 0.5) * (expr && expr.breathRate != null ? expr.breathRate : 1);
    const tailAmp = (sec.tailWaveAmp != null ? sec.tailWaveAmp : 0.4) * (expr && expr.tailWaveAmp != null ? expr.tailWaveAmp : 1);
    const tailFreq = (sec.tailWaveFreq != null ? sec.tailWaveFreq : 0.4) * (expr && expr.tailWaveFreq != null ? expr.tailWaveFreq : 1);
    const earTwitchChance = sec.earTwitch != null ? sec.earTwitch : 0.05;

    // 3.1 呼吸：胸口缩放（不波及头/腿/尾 —— 见 state.js 的 joints.chest 设计）
    this._breathPhase += dt * breathRate * Math.PI * 2;
    const breath = Math.sin(this._breathPhase);
    const e = 0.018 * breathAmp * breath;
    for (let i = 0; i < 3; i++) {
      const axis = i === 1 ? 1.6 : 1.0;               // Y 轴起伏更大
      this._joints.chest.scale[i] = damp(this._joints.chest.scale[i], 1 + e * axis, 8, dt);
    }

    // 3.2 眨眼（周期性；睡姿不眨）＋ 与 expression 的眯眼/瞪眼合成
    let blink = 1;
    if (this._eyes.lid > 0.25) {
      this._blinkTimer -= dt;
      if (this._blinkPhase < 0 && this._blinkTimer <= 0) {
        this._blinkPhase = 0;
        // 慢眨（信任信号）只在被摸/蹭手时出现，必须能被玩家注意到（美术 §4.5）
        const slow = this._poseName === 'Headbonk' || this._poseName === 'Look_Up_At_Player';
        this._blinkDur = slow ? 2.0 : 0.12;
      }
      if (this._blinkPhase >= 0) {
        this._blinkPhase += dt;
        const bp = clamp01(this._blinkPhase / this._blinkDur);
        blink = bp < 0.5 ? lerp(1, 0.02, bp * 2) : lerp(0.02, 1, (bp - 0.5) * 2);
        if (bp >= 1) { this._blinkPhase = -1; this._blinkTimer = randRange(this.rng, 2.0, 5.5); }
      }
    }

    let lid = this._eyes.lid;
    if (expr) {
      lid *= (1 - 0.65 * clamp01(expr.eyeSquint || 0));
      lid = Math.max(lid, 0.30 + 0.70 * clamp01(expr.eyeWide || 0) - 0.35 * clamp01(expr.eyeSquint || 0));
    }
    lid = clamp(lid * blink, 0.015, 1.0);

    // 3.3 尾巴：姿态曲线 + 行波（每段相位递延 → 波浪感）
    //     this._tail.segs 此刻仍是纯姿态值（每帧由 lerpTail 重算），在其上叠加行波即可
    this._tailPhase += dt * tailFreq * Math.PI * 2;
    const segs = this._tail.segs;
    for (let i = 0; i < segs.length; i++) {
      const lag = i * 0.45;
      const waveY = Math.sin(this._tailPhase - lag) * tailAmp * 0.16;
      const waveX = Math.cos(this._tailPhase * 0.7 - lag) * tailAmp * 0.05;
      segs[i][1] = segs[i][1] + waveY;
      segs[i][0] = segs[i][0] + waveX;
    }

    // 3.4 耳抖 + expression 的耳姿合成（耳背/耳前/耳转 + Ear-ack）
    this._earTwitchTimer -= dt;
    if (this._earTwitchPhase < 0 && this._earTwitchTimer <= 0 && this.rng() < earTwitchChance + 0.15) {
      this._earTwitchPhase = 0;
    }
    let earTwitch = 0;
    if (this._earTwitchPhase >= 0) {
      this._earTwitchPhase += dt;
      const tp = clamp01(this._earTwitchPhase / 0.10);
      earTwitch = Math.sin(tp * Math.PI) * 0.35;
      if (tp >= 1) { this._earTwitchPhase = -1; this._earTwitchTimer = randRange(this.rng, 2.5, 7.0); }
    }
    const earBack = expr ? clamp01(expr.earBack || 0) : 0;
    const earForward = expr ? clamp01(expr.earForward || 0) : 0;
    const earYawL = expr ? (expr.earYawL || 0) : 0;
    const earYawR = expr ? (expr.earYawR || 0) : 0;
    // ART-1-M1：morph 与骨骼的耦合衰减（此处以纯骨骼近似：耳背权重高时抑制额外偏转）
    const earPoseL = this._joints.earL.rot.slice();
    const earPoseR = this._joints.earR.rot.slice();
    this._earOverride = {
      L: [earPoseL[0] + earBack * 0.75 - earForward * 0.30 + earTwitch,
          earPoseL[1] + earYawL,
          earPoseL[2]],
      R: [earPoseR[0] + earBack * 0.75 - earForward * 0.30 - earTwitch,
          earPoseR[1] + earYawR,
          earPoseR[2]],
    };

    // 3.5 步态：Walk_Standard 的四肢循环（1.0s 周期 → rate 可由 speed 调制）
    this._walkCycle = null;
    if (sec.walkCycle) {
      this._walkPhase += dt * Math.PI * 2 * (this._walkSpeed || 1.0);
      this._walkCycle = this._walkPhase;
    }

    // 3.6 咀嚼 / 舔（EAT / DRINK / GROOM）：jaw 小幅开合
    this._jawIdle = 0;
    const jawIdleRate = sec.jawIdle || 0;
    if (jawIdleRate > 0) {
      this._jawPhase += dt * jawIdleRate;
      this._jawIdle = (Math.sin(this._jawPhase) * 0.5 + 0.5) * 0.16;
    }

    // 3.7 瞳孔：姿态基准 × expression 的 pupilDilate（归一化到 0.55 = 中性）
    const d = expr && expr.pupilDilate != null ? clamp(expr.pupilDilate / 0.55, 0.3, 2.4) : 1;
    this._pupilScale = [clamp(this._eyes.pupilX * d, 0.2, 1.6), clamp(this._eyes.pupilY * d, 0.2, 1.8)];
    this._lid = lid;

    // 3.8 胡须张开度（Whiskers_Forward / Back / Fanned）
    const spread = expr ? clamp(expr.whiskerSpread != null ? expr.whiskerSpread : 0.9, 0, 1.4) : 0.9;
    this._whisker = spread;
  }

  /** 把当前应用值写入 Object3D（唯一改动 rig 的地方） */
  _applyToRig(dt) {
    const J = this.joints;
    for (const k of JOINT_KEYS) {
      const t = J[k];
      if (!t) continue;
      const v = this._joints[k];
      if (t.position) t.position.set(v.pos[0], v.pos[1], v.pos[2]);
      if (t.rotation) t.rotation.set(v.rot[0], v.rot[1], v.rot[2]);
      if (t.scale) t.scale.set(v.scale[0], v.scale[1], v.scale[2]);
    }

    // 耳（叠加 Ear-ack / 耳抖）
    if (this._earOverride) {
      if (J.earL && J.earL.rotation) J.earL.rotation.set(this._earOverride.L[0], this._earOverride.L[1], this._earOverride.L[2]);
      if (J.earR && J.earR.rotation) J.earR.rotation.set(this._earOverride.R[0], this._earOverride.R[1], this._earOverride.R[2]);
    }

    // 尾（8 段链）
    if (J.tailSegments && J.tailSegments.length) {
      const segs = this._tail.segs;
      for (let i = 0; i < J.tailSegments.length && i < segs.length; i++) {
        const seg = J.tailSegments[i];
        if (seg.rotation) seg.rotation.set(segs[i][0], segs[i][1], segs[i][2]);
        if (seg.scale) {
          const s = this._tail.scaleXZ;
          seg.scale.set(s, 1, s);
        }
      }
    }

    // 眼睑 / 瞳孔
    if (J.eyeL && J.eyeL.scale) J.eyeL.scale.set(1, this._lid, 1);
    if (J.eyeR && J.eyeR.scale) J.eyeR.scale.set(1, this._lid, 1);
    if (J.pupilL && J.pupilL.scale) J.pupilL.scale.set(this._pupilScale[0], this._pupilScale[1], 1);
    if (J.pupilR && J.pupilR.scale) J.pupilR.scale.set(this._pupilScale[0], this._pupilScale[1], 1);

    // 下颌
    if (J.jaw && J.jaw.rotation) {
      J.jaw.rotation.x = clamp((this._mouth.open || 0) * 0.42 + (this._jawIdle || 0), 0, 0.6);
    }

    // 胡须
    const ws = this._whisker != null ? this._whisker : 0.9;
    if (J.whiskerL && J.whiskerL.rotation) J.whiskerL.rotation.set(0, 0, (ws - 0.9) * 0.5);
    if (J.whiskerR && J.whiskerR.rotation) J.whiskerR.rotation.set(0, 0, -(ws - 0.9) * 0.5);

    // 步态：在已混合的腿部值之上叠加四足对角步态振荡
    if (this._walkCycle != null) {
      const ph = this._walkCycle;
      const A = 0.34;
      const swing = [
        { hip: 'legFL', knee: 'kneeFL', phase: 0.0 },
        { hip: 'legFR', knee: 'kneeFR', phase: Math.PI },
        { hip: 'legBL', knee: 'kneeBL', phase: Math.PI },
        { hip: 'legBR', knee: 'kneeBR', phase: 0.0 },
      ];
      for (const s of swing) {
        const j = J[s.hip]; if (!j || !j.rotation) continue;
        const k = J[s.knee];
        const sIn = Math.sin(ph + s.phase);
        j.rotation.x += sIn * A;
        if (k && k.rotation) k.rotation.x += Math.max(0, Math.cos(ph + s.phase)) * 0.35;
      }
    }
  }

  /** 步速调制（美术 §4.7：高 AFF 走近玩家 −30%，低 AFF +50%）—— 供主循环按 AFF 调用 */
  setWalkSpeed(aff) {
    // AFF 0 → 1.5，AFF 100 → 0.7
    this._walkSpeed = 1.5 - 0.8 * clamp(aff, 0, 100) / 100;
    return this;
  }
}

/* ============================================================================
 * 内部工具
 * ========================================================================== */

function cloneTail(t) {
  return { segs: t.segs.map((s) => s.slice()), scaleXZ: t.scaleXZ };
}
function lerpTail(a, b, w) {
  const n = Math.min(a.segs.length, b.segs.length);
  const segs = new Array(n);
  for (let i = 0; i < n; i++) {
    segs[i] = [
      lerpAngle(a.segs[i][0], b.segs[i][0], w),
      lerpAngle(a.segs[i][1], b.segs[i][1], w),
      lerpAngle(a.segs[i][2], b.segs[i][2], w),
    ];
  }
  return { segs, scaleXZ: lerp(a.scaleXZ, b.scaleXZ, w) };
}
function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }

/** 姿态混合时长：按状态语义选择（入睡慢、警觉快、被摸柔） */
function blendFor(state, prev) {
  switch (state) {
    case 'SLEEP_DEEP': case 'SLEEP_LIGHT': return 1.2;   // 入睡要慢
    case 'ALERT': return 0.15;                            // 警觉要快
    case 'REJECT': return 0.18;
    case 'PETTED': return 0.45;
    case 'TRANSIT': case 'WARMUP': return 0.30;
    default: return 0.35;
  }
}

/** 无外部 rng 时的兜底 LCG（保证确定性；正式接入请传 core/rng.js 的流） */
function makeLCG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default CatAnimator;
