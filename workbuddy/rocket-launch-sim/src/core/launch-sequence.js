/**
 * 发射序列状态机（S2）—— IDLE → CHARGING → COUNTDOWN → RELEASE → FLIGHT
 *
 * 对 S2 GDD 的两处实现级澄清（记录于 control-manifest / 后续报告）：
 *  ① S2 §2.1 的枚举含独立 `IGNITION` 相位，但 §2.3 的 T_IGNITE=−1.6 / T_SPOOL=1.2
 *     把点火爬推放在 **T-0 之前**。二者自相矛盾。本实现把点火折叠为 COUNTDOWN 的
 *     `IGNITE` 子阶段（T−1.6 → T−0，spool 于 T−0.4 满推），与 §2.3 的数值一致。
 *  ② §4.1-2「Space 按住充能条走完 0.6s 才进入 COUNTDOWN」需要一个显式的充能态，
 *     故新增 `CHARGING`。它不改变任何物理，只让"点按 = 永远发不出去"成立。
 *
 * 跳过倒计时（S2 §3.3）：skippable 时按住 Space 把倒计时从 10s 压缩到 3s，
 * 三个子阶段按比例压缩，不裁剪任何一段（P1 红线：跳过的是等待，不是过程）。
 */

export const SeqPhase = Object.freeze({
  IDLE: 'IDLE', CHARGING: 'CHARGING', COUNTDOWN: 'COUNTDOWN',
  RELEASE: 'RELEASE', FLIGHT: 'FLIGHT', ABORTED: 'ABORTED', FAILED: 'FAILED',
});

export class LaunchSequence {
  constructor(cfg) {
    this.C = cfg;
    this.reset();
  }

  reset(skippable = false) {
    this.phase = SeqPhase.IDLE;
    this.skippable = skippable;
    this.t = -this.C.T_COUNT;      // 局内时钟（负 = 倒计时）
    this.subPhase = null;
    this.chill = 0;
    this.press = 0;
    this.spool = 0;
    this.chargeT = 0;
    this.holdCount = 0;
    this.holdTimer = 0;
    this.skipped = false;
    this.elapsed = 0;
    this.releaseT = 0;
    this.duration = this.C.T_COUNT;
    this._state = 'idle';
  }

  get isFlying() { return this.phase === SeqPhase.FLIGHT; }

  /** 子阶段进度（用于 HUD 与控制台指示器） */
  subProgress() {
    return { chill: this.chill, press: this.press, spool: this.spool };
  }

  /**
   * @param {number} dt
   * @param {{launchHeld:boolean, abortPressed:boolean}} inp
   * @returns {Array<{type:string}>} 事件
   */
  update(dt, inp) {
    const C = this.C;
    const ev = [];

    switch (this.phase) {
      case SeqPhase.IDLE:
        if (inp.launchHeld) {
          this.phase = SeqPhase.CHARGING;
          this.chargeT = 0;
          ev.push({ type: 'CHARGING_START' });
        }
        break;

      case SeqPhase.CHARGING: {
        if (!inp.launchHeld) {           // 松手即回落（美术 §5.3）
          this.phase = SeqPhase.IDLE;
          this.chargeT = 0;
          ev.push({ type: 'CHARGING_ABORT' });
          break;
        }
        this.chargeT += dt;
        if (this.chargeT >= C.CHARGING_DELAY) {
          this.phase = SeqPhase.COUNTDOWN;
          this.elapsed = 0;
          this.duration = this.skippable ? C.T_SKIP_MIN : C.T_COUNT;
          this.skipped = this.skippable;
          this.chill = 0; this.press = 0; this.spool = 0;
          ev.push({ type: 'COUNTDOWN_START', skipped: this.skipped });
        }
        break;
      }

      case SeqPhase.COUNTDOWN: {
        const scale = this.duration / C.T_COUNT;
        const wChill = C.T_CHILL_DUR * scale;
        const wPress = C.T_PRESS_DUR * scale;
        const wSpool = C.T_SPOOL * scale;
        this.elapsed += dt;
        this.t = -this.duration + this.elapsed;
        // 子阶段推进（S2 §3.2：增压必须待预冷完成后才累计）
        this.chill = clamp01(this.elapsed / wChill);
        this.press = this.chill >= C.T_COMPLETE ? clamp01((this.elapsed - wChill) / wPress) : 0;
        this.spool = (this.chill >= C.T_COMPLETE && this.press >= C.T_COMPLETE)
          ? clamp01((this.elapsed - wChill - wPress) / wSpool) : 0;
        this.subPhase = this.elapsed < wChill ? 'CHILL'
          : this.elapsed < wChill + wPress ? 'PRESS' : 'IGNITE';
        // 点火前松手 ⇒ 中止（不计失败，S2 §3.5）
        if (!inp.launchHeld && this.subPhase !== 'IGNITE') {
          this.phase = SeqPhase.IDLE;
          ev.push({ type: 'COUNTDOWN_ABORT' });
          break;
        }
        // T-0 判定（HOLD 为纯防御分支，基准流程永不触发，S2 §6.3）
        if (this.elapsed >= this.duration) {
          if (this.chill >= C.T_COMPLETE && this.press >= C.T_COMPLETE && this.spool >= C.SPOOL_READY) {
            this.phase = SeqPhase.RELEASE;
            this.releaseT = 0;
            ev.push({ type: 'T_ZERO' });
          } else {
            this.holdTimer += dt;
            this.t = 0;
            if (this.holdTimer > C.HOLD_TIMEOUT) {
              this.phase = SeqPhase.FAILED;
              ev.push({ type: 'SEQUENCE_FAULT', blockedItem: this._blockedItem() });
            }
          }
        }
        break;
      }

      case SeqPhase.RELEASE:
        this.releaseT += dt;
        this.t = this.releaseT;
        if (this.releaseT >= C.T_RELEASE_DELAY) {
          this.phase = SeqPhase.FLIGHT;
          this.t = 0;
          ev.push({ type: 'RELEASE' });
        }
        break;

      default: break;   // FLIGHT / ABORTED / FAILED 由 simulation 接管
    }

    if (inp.abortPressed) {
      if (this.phase === SeqPhase.IDLE || this.phase === SeqPhase.CHARGING ||
          this.phase === SeqPhase.COUNTDOWN || this.phase === SeqPhase.RELEASE ||
          this.phase === SeqPhase.FLIGHT) {
        if (this.phase === SeqPhase.RELEASE || this.phase === SeqPhase.FLIGHT) {
          this.phase = SeqPhase.ABORTED;
          ev.push({ type: 'ABORT_FLIGHT' });
        } else {
          this.phase = SeqPhase.IDLE;
          this.chargeT = 0;
          ev.push({ type: 'ABORT_SEQ' });   // 不计失败
        }
      }
    }
    return ev;
  }

  _blockedItem() {
    if (this.chill < this.C.T_COMPLETE) return '预冷 CHILL';
    if (this.press < this.C.T_COMPLETE) return '增压 PRESS';
    return '引擎爬推 SPOOL';
  }

  fail() { this.phase = SeqPhase.FAILED; }

  hudPhaseName() {
    switch (this.phase) {
      case SeqPhase.IDLE: return '待机 STANDBY';
      case SeqPhase.CHARGING: return '充能 CHARGING';
      case SeqPhase.COUNTDOWN:
        return this.subPhase === 'CHILL' ? '预冷 CHILL'
          : this.subPhase === 'PRESS' ? '增压 PRESS' : '点火 IGNITION';
      case SeqPhase.RELEASE: return '松绑 RELEASE';
      case SeqPhase.FLIGHT: return '飞行 FLIGHT';
      case SeqPhase.ABORTED: return '中止 ABORTED';
      case SeqPhase.FAILED: return '故障 FAILED';
      default: return '';
    }
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
