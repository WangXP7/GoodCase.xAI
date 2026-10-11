/**
 * 玩家模型（Player-Model）—— 用于**无头闭环验证**（RT-1 遗留风险 R4 的解答）
 *
 * 它不是一个"自动驾驶"，而是一个**被刻意做钝的人类代理**：只在离散的操作频率上
 * 读仪表、带死区地打杆，用有限速率（15°/s）把 theta_cmd 追向目标重力转弯程序。
 * 目的：证明"玩家手动操控"能复现基准弹道，而不是证明"存在一条自动化最优解"。
 *
 * 关键：它只通过 sim.setInput() 的**玩家通道**（pitch ∈ {−1,0,+1}）操作，
 * 绝不碰 fm.thetaCmd（那是辅助线/开环程序的通道）。这条界线是 P1 的红线。
 */

import { thetaCmdRef } from '../core/flight-model.js';
import { CONTROL, PROGRAM } from '../core/constants.js';

export class PlayerModel {
  /**
   * @param {object} o
   *  hTurn, p        目标重力转弯程序（玩家"心里的程序"）
   *  deadbandDeg     打杆死区（°）——越大越像"手笨"
   *  updateHz        操作频率（Hz）——人类 8–30Hz
   *  throttlePlan    (ctx)=>number 或 null；ctx={h,t,q,throttle}
   *  stageAtBurnout  true=一级燃尽即分离（玩家知道要分级）
   */
  constructor(o = {}) {
    this.hTurn = o.hTurn ?? PROGRAM.H_TURN;
    this.p = o.p ?? PROGRAM.P_EXP;
    this.deadband = (o.deadbandDeg ?? 1.0) * Math.PI / 180;
    this.updateHz = o.updateHz ?? 30;
    this.throttlePlan = o.throttlePlan ?? null;
    this.stageAtBurnout = o.stageAtBurnout ?? true;
    this.throwDebug = [];
    this._acc = 0;
    this._pitch = 0;
  }

  /** 目标角：玩家心中那条曲线（可以不是基准程序 —— 这正是"多路径"的来源） */
  target(h) {
    return thetaCmdRef(h, { H_START: PROGRAM.H_START, H_TURN: this.hTurn, P_EXP: this.p });
  }

  /**
   * @param {Simulation} sim
   * @param {number} frameDt
   */
  update(sim, frameDt) {
    const fm = sim.fm;
    // 始终按住发射键（无头验证关心的是飞行段，不是充能交互）
    sim.setInput({ launch: true });

    this._acc += frameDt;
    const period = 1 / this.updateHz;
    if (this._acc >= period || fm.t === 0) {
      this._acc = 0;
      // 配平：把 theta_cmd 追向目标角（带死区）
      const tgt = this.target(fm.h);
      const err = tgt - fm.thetaCmd;
      if (err > this.deadband) this._pitch = +1;        // A 抬头
      else if (err < -this.deadband) this._pitch = -1;  // D 低头
      else this._pitch = 0;
      this.throwDebug.push({ t: fm.t, h: fm.h, tgt: tgt * 180 / Math.PI, cmd: fm.thetaCmd * 180 / Math.PI, pitch: this._pitch });
    }

    sim.setInput({ pitch: this._pitch });

    // 节流：默认满油门；有计划的玩家在 Max-Q 段收油门
    let thr = 0;
    if (this.throttlePlan) {
      const desired = this.throttlePlan({ h: fm.h, t: fm.t, q: sim.atmo.q, throttle: fm.throttle });
      thr = desired > fm.throttle ? +1 : desired < fm.throttle ? -1 : 0;
    }
    sim.setInput({ throttle: thr });

    // 分离：一级燃尽即按 Shift
    if (this.stageAtBurnout) {
      sim.setInput({ stage: fm.stage === 1 && fm.fuel1 <= 0 });
    }
  }
}
