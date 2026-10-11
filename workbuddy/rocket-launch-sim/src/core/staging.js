/**
 * 分级分离（S3）
 *
 * 只做四件事：① 边沿触发 + 重复抑制；② 0.35s 顿帧时序；③ 安全判据（q ≤ Q_SEP_SAFE）；
 * ④ 下级残骸的纯视觉运动学（不参与任何判定，S3 §3.5）。
 * 质量跳变本身由 FlightModel.separate() 执行（唯一真值源在 S1）。
 */

export class Staging {
  constructor(cfg, world) {
    this.C = cfg;
    this.W = world;
    this.reset();
  }

  reset() {
    this.state = 'ARMED_1';       // ARMED_1 | SEPARATING | ARMED_2 | BURNT_2
    this.hitStopRemain = 0;
    this.reloadDebounce = 0;
    this.tSep = null; this.hSep = 0; this.vSep = 0; this.qSep = 0;
    this.fuel1AtSep = null; this.dvWasted = 0; this.sepValid = true;
    this.debris = null;
    this._prevStageInput = false;
  }

  get hitStopActive() { return this.hitStopRemain > 0; }

  /**
   * @param {number} dt
   * @param {boolean} stageInput 边沿触发（按下沿）
   * @param {FlightModel} fm
   * @param {number} q            当前动压 Pa（来自 S4）
   * @returns {Array} 事件
   */
  update(dt, stageInput, fm, q) {
    const ev = [];
    if (this.reloadDebounce > 0) this.reloadDebounce -= dt;

    // 顿帧计时
    if (this.hitStopRemain > 0) {
      this.hitStopRemain -= dt;
      if (this.hitStopRemain <= 0) {
        this.hitStopRemain = 0;
        ev.push({ type: 'HITSTOP_END' });
      }
      // 残骸在顿帧期间仍按运动学推进（视觉层，与物理正交）
      this._advanceDebris(dt);
      return ev;
    }

    // 边沿检测（去抖 200ms，S3 §4.1-1）
    const rising = stageInput && !this._prevStageInput;
    this._prevStageInput = stageInput;

    if (this.state === 'ARMED_1' && rising && this.reloadDebounce <= 0) {
      this.reloadDebounce = this.C.SEP_DEBOUNCE;
      const info = fm.separate();
      if (info) {
        this.tSep = fm.t; this.hSep = fm.h; this.vSep = fm.v; this.qSep = q;
        this.fuel1AtSep = info.fuel1AtSep; this.dvWasted = info.dvWasted;
        this.sepValid = q <= 5000;
        this.state = 'SEPARATING';
        this.hitStopRemain = this.C.HITSTOP;
        // S3 §7.3：残骸挂在上层世界层（此处只存运动学状态）
        this.debris = {
          active: true, rx: fm.rx, ry: fm.ry, vx: fm.vx, vy: fm.vy,
          angle: 0, angVel: 0, aliveFor: 0, coastFor: 0,
        };
        ev.push({
          type: 'SEPARATE', ...info,
          hSep: this.hSep, vSep: this.vSep, qSep: this.qSep,
          dvWasted: this.dvWasted, sepValid: this.sepValid, fuel1AtSep: this.fuel1AtSep,
        });
        if (!this.sepValid) ev.push({ type: 'SEP_HIGHQ', qSep: this.qSep });
      }
    }
    return ev;
  }

  /** 顿帧结束后，二级点火（S3 §3.2 t=0.35s），状态转 ARMED_2 */
  onStepComplete(fm) {
    if (this.state === 'SEPARATING' && this.hitStopRemain <= 0) {
      this.state = 'ARMED_2';
    }
    if (fm.stage === 2 && fm.fuel2 <= 0 && this.state !== 'BURNT_2') {
      this.state = 'BURNT_2';
    }
  }

  _advanceDebris(dt) {
    const d = this.debris;
    if (!d || !d.active) return;
    d.aliveFor += dt;
    d.coastFor += dt;
    const W = this.W;
    const r = Math.sqrt(d.rx * d.rx + d.ry * d.ry);
    const ux = d.rx / r, uy = d.ry / r;
    const ag = -W.MU / (r * r);
    if (d.coastFor < this.C.DEBRIS_COAST) {
      d.vx += ag * ux * dt; d.vy += ag * uy * dt;
    } else {
      d.angVel = this.C.DEBRIS_SPIN;
      d.vx += ag * ux * dt; d.vy += ag * uy * dt;
      d.angle += d.angVel * dt;
    }
    d.rx += d.vx * dt; d.ry += d.vy * dt;
    const h = Math.sqrt(d.rx * d.rx + d.ry * d.ry) - W.R;
    if (d.aliveFor > this.C.DESPAWN_T || h <= 0) d.active = false;
  }

  /** 供渲染层读取；分离后由 simulation 每帧推进（visualStep） */
  visualStep(dt) {
    if (this.hitStopRemain <= 0) this._advanceDebris(dt);
  }
}
