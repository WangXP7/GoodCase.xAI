/**
 * 入轨判定与三档评级（S5）
 *
 * 三个入轨条件同时满足（S5 §3.2）：
 *   regime ∈ {ELLIPTIC, CIRCULAR} ∧ periapsis ≥ 13.5km(+1m 迟滞) ∧ apoapsis 有限
 * 第三条独立存在是 RT-1 诊断③的教训：v1 扫描把 ESCAPE（远地点 ∞）误判为入轨。
 *
 * 触发时机（S5 §3.3）：① SECO（stage2 且 fuel2≤0）；② 主动关机（stage2 且
 * throttle ≤ 0.30 持续 1.0s —— 60s 打法的实现前提）；③ 失败由 S6 接管。
 */

export const Judgement = Object.freeze({
  INCOMPLETE: 'INCOMPLETE',
  ORBITAL: 'ORBITAL',
  PRECISE: 'PRECISE',
});

export class JudgementSystem {
  constructor(world, rocket, control, judgeCfg) {
    this.W = world; this.R = rocket; this.C = control; this.J = judgeCfg;
    this.reset();
  }

  reset() {
    this.judged = false;
    this.tJudge = null;
    this.result = Judgement.INCOMPLETE;
    this.shutdownHold = 0;
    this.snapshot = null;
    this.periCrossed = false;
    this._lastPeri = -Infinity;
  }

  isOrbital(orbit) {
    if (!orbit.valid) return false;
    const r = orbit.regime;
    if (r !== 'ELLIPTIC' && r !== 'CIRCULAR') return false;
    if (!(orbit.periapsis >= this.J.H_PASS + this.J.H_PASS_HYST)) return false;
    if (!Number.isFinite(orbit.apoapsis)) return false;
    return true;
  }

  rate(orbit) {
    if (!this.isOrbital(orbit)) return Judgement.INCOMPLETE;
    return Math.abs(orbit.periapsis - this.W.H) <= this.J.H_PREC
      ? Judgement.PRECISE : Judgement.ORBITAL;
  }

  /**
   * 每物理步调用。
   * @returns {Array} 事件（JUDGE / PERIAPSIS_CROSS）
   */
  update(dt, fm, orbit) {
    const ev = [];

    // 近地点首次越线（≥13.5km）—— 单次确认音（S5 §5.4）
    if (orbit.valid) {
      const p = orbit.periapsis;
      if (!this.periCrossed && this._lastPeri < this.J.H_PASS && p >= this.J.H_PASS) {
        this.periCrossed = true;
        ev.push({ type: 'PERIAPSIS_CROSS', t: fm.t, periapsis: p });
      }
      if (p > this._lastPeri) this._lastPeri = p;
    }

    if (this.judged) return ev;

    // ② 主动关机计时（仅二级段；中途回升即清零）
    const canShutdown = fm.stage === 2 && fm.fuel2 > 0;
    if (canShutdown && fm.throttle <= this.C.THROTTLE_MIN + 1e-9) {
      this.shutdownHold += dt;
    } else {
      this.shutdownHold = 0;
    }

    // ① SECO
    const seco = fm.stage === 2 && fm.fuel2 <= 0;
    // ② 主动关机达成
    const manualShutdown = canShutdown && this.shutdownHold >= this.J.T_SHUTDOWN_HOLD;

    if (seco || manualShutdown) {
      this._judge(fm, orbit, seco ? 'SECO' : 'MANUAL');
      ev.push({ type: 'JUDGE', judgement: this.result, snapshot: this.snapshot, reason: seco ? 'SECO' : 'MANUAL' });
    }
    return ev;
  }

  _judge(fm, orbit, reason) {
    this.judged = true;
    this.tJudge = fm.t;
    this.result = this.rate(orbit);
    this.snapshot = {
      judgement: this.result,
      reason,
      periapsis: orbit.valid ? orbit.periapsis : NaN,
      apoapsis: orbit.valid ? orbit.apoapsis : NaN,
      regime: orbit.regime,
      accuracyM: orbit.valid ? orbit.periapsis - this.W.H : NaN,
      dvRemain: fm.dvRemain(),
      dvSpent: this.R.DV_TOTAL - fm.dvRemain(),
      fuelRemainKg: fm.fuelRemainKg(),
      flightTime: fm.t,
      h: fm.h, v: fm.v, vh: fm.vh,
    };
  }

  /** 失败关闭：不判定，直接走失败流程（S5 §3.3-③） */
  lock() { this.judged = true; }

  get() { return { result: this.result, snapshot: this.snapshot, judged: this.judged }; }
}
