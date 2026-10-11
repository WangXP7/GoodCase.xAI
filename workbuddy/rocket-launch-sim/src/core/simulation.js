/**
 * 仿真编排层（Simulation）—— 把 S1..S7 串成一条可被浏览器与无头脚本**同一份代码**
 * 驱动的确定性循环。这是本原型闭环验证成立的关键：Node 里跑的就是浏览器里跑的。
 *
 * 每物理步的调用顺序（对 S1 §7.3 的一处必要调整，记录于 control-manifest）：
 *   S1.step（内部同帧算 q） → S4.update（缓存 q / 事件） → S3.update（需 q 判安全分离）
 *   → S5.solve（轨道解算） → S7 Ω → S5.judge → S6.detect
 * 调整理由：GDD 名义顺序把 S3 排在 S4 之前，但 S3 的安全判据需要 q，而 S1 的阻力
 * 也需要同帧 q。故把 S4 的 q 计算提前到 S3 之前，物理结果与 RT-1 开环一致。
 *
 * 固定步长（S1 §3.1）：物理 120Hz 定步 + 渲染插值；累加器夹紧防死亡螺旋。
 * 顿帧（S3 §6.2）：期间不向累加器喂时间，防顿帧后一次性补跑导致"瞬移"。
 */

import {
  WORLD, ROCKET, CONTROL, PROGRAM, OMEGA, JUDGE, FAIL, SEQ, STAGE,
} from './constants.js';
import { FlightModel, thetaCmdRef } from './flight-model.js';
import { OrbitSolver } from './orbit-solver.js';
import { Atmosphere } from './atmosphere.js';
import { OmegaIndicator } from './omega.js';
import { LaunchSequence, SeqPhase } from './launch-sequence.js';
import { Staging } from './staging.js';
import { JudgementSystem, Judgement } from './judgement.js';
import { FailureSystem, FailureCode } from './failure.js';

export class Simulation {
  constructor(options = {}) {
    this.world = WORLD;
    this.rocket = ROCKET;
    this.control = CONTROL;
    this.program = PROGRAM;
    this.missionNo = options.missionNo || 1;
    this.skippable = !!options.skippable;
    // 开环模式（仅用于验证端口一致性 / 首局隐形引导，S1 §3.5）
    this.autoProgram = false;
    this.autoStage = false;

    this.fm = new FlightModel(WORLD, ROCKET, CONTROL);
    this.orbit = new OrbitSolver({ mu: WORLD.MU, R: WORLD.R });
    this.atmo = new Atmosphere(WORLD);
    this.omega = new OmegaIndicator(WORLD, OMEGA);
    this.seq = new LaunchSequence(SEQ);
    this.staging = new Staging(STAGE, WORLD);
    this.judge = new JudgementSystem(WORLD, ROCKET, CONTROL, JUDGE);
    this.failure = new FailureSystem(WORLD, FAIL, JUDGE);

    this.reset();
  }

  reset(skippable) {
    if (skippable !== undefined) this.skippable = !!skippable;
    this.fm.reset();
    this.orbit.reset();
    this.atmo.reset();
    this.omega.reset();
    this.seq.reset(this.skippable);
    this.staging.reset();
    this.judge.reset();
    this.failure.reset();

    this.acc = 0;
    this.renderAlpha = 0;
    this.outcome = null;           // null | 'SUCCESS' | 'FAILURE'
    this.judgeFreezeT = 0;
    this.vacuumFor = 0;
    this.input = { pitch: 0, throttle: 0, stage: false, launch: false, abort: false };
    this._abortPulse = false;
    this.events = [];
    this.timeSinceFailure = 0;
  }

  /** 浏览器输入层 / 无头玩家模型都通过这里喂输入（level 语义，边沿由各系统自检） */
  setInput(partial) {
    if (partial.pitch !== undefined) this.input.pitch = partial.pitch;
    if (partial.throttle !== undefined) this.input.throttle = partial.throttle;
    if (partial.stage !== undefined) this.input.stage = partial.stage;
    if (partial.launch !== undefined) this.input.launch = partial.launch;
    if (partial.abort) this._abortPulse = true;
  }

  get phase() { return this.seq.phase; }
  get flying() { return this.seq.phase === SeqPhase.FLIGHT; }

  /**
   * 主循环（渲染帧驱动）。
   * @param {number} frameDt 帧间隔 s
   * @returns {Array} 本帧事件
   */
  update(frameDt) {
    const ev = [];

    // ── 失败演出期间：锁输入、不推进物理 ──
    if (this.outcome === 'FAILURE') {
      this.timeSinceFailure += frameDt;
      this.staging.visualStep(frameDt);
      this.events = ev;
      return ev;
    }

    // ── 序列推进（仅在未松绑时；FLIGHT 后 S2 退居监听）──
    if (this.seq.phase !== SeqPhase.FLIGHT &&
        this.seq.phase !== SeqPhase.FAILED &&
        this.seq.phase !== SeqPhase.ABORTED &&
        !this.failure.failed) {
      const seqEv = this.seq.update(frameDt, {
        launchHeld: this.input.launch,
        abortPressed: this._abortPulse,
      });
      this._abortPulse = false;
      for (const e of seqEv) {
        ev.push(e);
        if (e.type === 'ABORT_FLIGHT') {
          this.failure.detect(this.fm, this.orbit.get(), this.atmo, this.staging, [e]);
        }
        if (e.type === 'SEQUENCE_FAULT') {
          this.failure.detect(this.fm, this.orbit.get(), this.atmo, this.staging, [e]);
        }
      }
      if (this.failure.failed) this._onFailure(ev);
    }

    // ── 物理推进 ──
    if (this.seq.phase === SeqPhase.FLIGHT && !this.failure.failed && this.outcome === null) {
      if (this.staging.hitStopActive) {
        this.acc = 0;                       // 顿帧：冻结累加器（S3 §6.2）
        this.staging.update(frameDt, false, this.fm, this.atmo.q);
      } else {
        this.acc += Math.min(frameDt, CONTROL.MAX_STEPS * CONTROL.DT);
        let steps = 0;
        while (this.acc >= CONTROL.DT && steps < CONTROL.MAX_STEPS) {
          this._physicsStep(CONTROL.DT, ev);
          this.acc -= CONTROL.DT;
          steps++;
          if (this.staging.hitStopActive || this.outcome !== null) { this.acc = 0; break; }
        }
        this.renderAlpha = CONTROL.DT > 0 ? this.acc / CONTROL.DT : 0;
      }
    }

    // 轨道判定后静默 1.4s 弹面板（S5 §3.3）
    if (this.outcome === 'SUCCESS') this.judgeFreezeT += frameDt;

    this.events = ev;
    return ev;
  }

  /** 单个固定物理步 */
  _physicsStep(dt, ev) {
    const fm = this.fm;

    // 首帧防抖（S1 §4.1-4）：松绑后 0.5s 内禁止配平
    let pitch = fm.t < 0.5 ? 0 : this.input.pitch;

    // 开环程序（验证 / 首局引导）：直接钉 theta_cmd，不占用玩家输入通道
    if (this.autoProgram) {
      let tc = thetaCmdRef(fm.h, this.program);
      if (tc > CONTROL.THETA_MAX) tc = CONTROL.THETA_MAX;
      if (tc < CONTROL.THETA_MIN) tc = CONTROL.THETA_MIN;
      fm.thetaCmd = tc;
      pitch = 0;
    }

    // ① S1
    fm.step(dt, { pitch, throttle: this.input.throttle });

    // ② S4（缓存 q / 事件）
    const atmEv = this.atmo.update(fm.h, fm.v, fm.alpha, fm.t);
    if (atmEv) pushEvent(ev, atmEv);

    // ③ S3（安全分离判据需要本步 q）
    const stageInput = this.autoStage ? (fm.stage === 1 && fm.fuel1 <= 0) : this.input.stage;
    const stEv = this.staging.update(dt, stageInput, fm, this.atmo.q);
    for (const e of stEv) {
      ev.push(e);
      if (e.type === 'SEP_HIGHQ') {
        this.failure.detectSepHighQ(e, fm, this.orbit.get(), this.atmo);
      }
    }
    this.staging.onStepComplete(fm);

    // ④ S5 轨道解算
    const orbit = this.orbit.solve(fm.rx, fm.ry, fm.vx, fm.vy);

    // ⑤ S7 Ω
    const omEv = this.omega.update(fm.h, fm.vh, fm.t, orbit);
    for (const e of omEv) ev.push(e);

    // 真空段计时（动压读数退场，S4 §6.5）
    if (this.atmo.q <= 0) this.vacuumFor += dt; else this.vacuumFor = 0;

    // ⑥ S5 判定
    const jEv = this.judge.update(dt, fm, orbit);
    for (const e of jEv) {
      ev.push(e);
      if (e.type === 'JUDGE') {
        if (e.judgement === Judgement.INCOMPLETE) {
          this.failure.detectFromJudge(orbit, fm, this.atmo, e.snapshot);
        } else {
          this.outcome = 'SUCCESS';       // 入轨成功，冻结物理
        }
      }
    }

    // ⑦ S6 失败检测（每步）
    if (!this.failure.failed) {
      this.failure.detect(fm, orbit, this.atmo, this.staging, null);
    }
    if (this.failure.failed) this._onFailure(ev);
  }

  _onFailure(ev) {
    if (this.outcome === 'FAILURE') return;
    this.outcome = 'FAILURE';
    this.judge.lock();
    ev.push({ type: 'FAILURE', record: this.failure.record });
  }

  // ── HUD 数据模型（S7 §4.1；每渲染帧读缓存，不重算物理）──────────────────
  hudModel() {
    const fm = this.fm;
    const om = this.omega.get();
    const orbit = this.orbit.get();
    const q = this.atmo.q;
    const qState = q >= FAIL.Q_STRUCT ? 'DANGER' : q >= FAIL.Q_WARN ? 'WARN' : 'NORMAL';

    return {
      altitudeM: fm.h,
      altitudeRateMs: fm.vr,
      speedMs: fm.v,
      speedHorizMs: fm.vh,
      qPa: q,
      qState,
      qVisible: !(this.vacuumFor > 1.2),
      fuel1Kg: fm.fuel1,
      fuel2Kg: fm.fuel2,
      fuel1Pct: fm.fuel1 / ROCKET.S1_FUEL,
      fuel2Pct: fm.fuel2 / ROCKET.S2_FUEL,
      stage: fm.stage,
      thetaDeg: fm.theta * 180 / Math.PI,
      thetaCmdDeg: fm.thetaCmd * 180 / Math.PI,
      alphaDeg: fm.alpha * 180 / Math.PI,
      // Task1「配平代价」：让"乱动杆要付钱"可见（P2）
      cdRatio: 1 + (WORLD.CD_ALPHA / WORLD.CD0) * Math.sin(fm.alpha) * Math.sin(fm.alpha),
      dragFracThrust: fm.thrust > 1 ? fm.drag / fm.thrust : 0,
      dragN: fm.drag,
      dvDrag: fm.dvDrag,
      refThetaDeg: this.referencePitchDeg(),
      qWarnPa: FAIL.Q_WARN,
      qStructPa: FAIL.Q_STRUCT,
      pitchInputAllowed: fm.t >= 0.5,
      // 第 5 读数：Ω 双模态
      omegaPct: om.omega,
      omegaSource: om.source,
      omegaSwitched: om.switched,
      omegaSwitchT: om.switchT,
      hDispM: om.hDisp,
      periapsisM: orbit.valid ? orbit.periapsis : -WORLD.R,
      apoapsisM: orbit.valid ? orbit.apoapsis : NaN,
      orbitValid: orbit.valid,
      regime: orbit.regime,
      dvRemain: fm.dvRemain(),
      fuelRemainKg: fm.fuelRemainKg(),
      // 非读数状态
      throttle: fm.throttle,
      phase: this.seq.phase,
      phaseName: this.seq.hudPhaseName(),
      subPhase: this.seq.subPhase,
      t: this.seq.phase === SeqPhase.FLIGHT ? fm.t : this.seq.t,
      flightTime: fm.t,
      missionNo: this.missionNo,
      stageState: this.staging.state,
      sepValid: this.staging.sepValid,
      dvWasted: this.staging.dvWasted,
      warningText: this._warning(),
      outcome: this.outcome,
      judgement: this.judge.result,
      summary: this.judge.snapshot,
      failure: this.failure.record,
      massKg: fm.m,
      thrustN: fm.thrust,
      dragN: fm.drag,
      qMaxPa: this.atmo.qMax,
      tQMax: this.atmo.tQMax,
      maxAlphaDeg: fm.maxAlpha * 180 / Math.PI,
      altMaxM: fm.hMax,
      vacFor: this.vacuumFor,
      timeSinceFailure: this.timeSinceFailure,
      canRestart: this.outcome === 'FAILURE' && this.timeSinceFailure >= 1.70,
    };
  }

  _warning() {
    if (this.failure.failed) return this.failure.record.title;
    if (this.staging.state === 'ARMED_1' && this.atmo.q > FAIL.Q_SEP_SAFE) return '分离禁用 · 动压超限';
    if (this.atmo.q >= FAIL.Q_STRUCT) return '结构超限';
    if (this.atmo.q >= FAIL.Q_WARN) return '动压警戒';
    return null;
  }

  /** 参考重力转弯建议角（辅助线用，S1 §3.5） */
  referencePitchDeg() {
    const h = this.fm.h;
    const p = this.program;
    let tc;
    if (h < p.H_START) tc = Math.PI / 2;
    else {
      let u = (h - p.H_START) / (p.H_TURN - p.H_START);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      tc = (Math.PI / 2) * Math.pow(1 - u, p.P_EXP);
    }
    return tc * 180 / Math.PI;
  }
}

function pushEvent(ev, e) {
  if (Array.isArray(e)) for (const x of e) ev.push(x);
  else ev.push(e);
}

export { SeqPhase, Judgement, FailureCode };
