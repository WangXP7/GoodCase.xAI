/**
 * 大气模型（S4 §3.1 / §6.2）
 *
 * 指数模型 + 12km 硬截断 + 300m 线性过渡带。
 * 过渡带存在的理由（S4 §6.2）：硬截断会在 12km 处引入密度阶跃，末段上下穿越时
 * 会在 2087 m/s 下产生 53.5 kN 的力跳变（≈5.4g）。过渡带把它抹平。
 */

const FADE = 300;

/**
 * @param {number} h 高度 m
 * @param {{RHO0:number,SCALE_H:number,ATM_TOP:number}} world
 */
export function rhoAt(h, world) {
  const top = world.ATM_TOP;
  if (h >= top || h < 0) return 0;
  const base = world.RHO0 * Math.exp(-h / world.SCALE_H);
  const fadeStart = top - (world.RHO_FADE || FADE);
  if (h >= fadeStart) {
    return base * ((top - h) / (world.RHO_FADE || FADE));
  }
  return base;
}

/** 阻力系数（含攻角项，S4 §3.2）。sin² 天然有界 ⇒ Cd ∈ [0.25, 2.25] */
export function cdAt(alpha, world) {
  const s = Math.sin(alpha);
  return world.CD0 + world.CD_ALPHA * s * s;
}

/** 攻角归一化到 [−π, π]（S4 §6.3），保证 HUD 显示真实攻角 */
export function normalizeAlpha(theta, gamma) {
  return Math.atan2(Math.sin(theta - gamma), Math.cos(theta - gamma));
}

/**
 * 有状态大气系统：持有本局峰值动压 / 事件闩锁，供 S7 与 S6 读取。
 */
export class Atmosphere {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    this.rho = 0;
    this.q = 0;
    this.qMax = 0;
    this.tQMax = 0;
    this.hQMax = 0;
    this.cd = this.world.CD0;
    this.dragForce = 0;
    this.inWarning = false;
    this.maxQPassed = false;
    this.atmExited = false;
  }

  /** 每物理步调用，读 S1 已算出的 h/v/alpha（不重算物理） */
  update(h, v, alpha, t) {
    this.rho = rhoAt(h, this.world);
    this.q = 0.5 * this.rho * v * v;
    this.cd = cdAt(alpha, this.world);
    this.dragForce = this.q * this.cd * this.world.A_REF;

    let event = null;
    if (this.q > this.qMax) {
      this.qMax = this.q; this.tQMax = t; this.hQMax = h; this.maxQPassed = false;
    } else if (this.qMax > 12000 && this.q < this.qMax - 1000 && !this.maxQPassed) {
      this.maxQPassed = true;
      event = { type: 'MAXQ_PASSED', qMax: this.qMax, tQMax: this.tQMax, hQMax: this.hQMax };
    }
    if (!this.atmExited && h >= this.world.ATM_TOP) {
      this.atmExited = true;
      const e = { type: 'ATMOSPHERE_EXIT', t, h, v };
      event = event ? [event, e] : e;
    }
    this.inWarning = this.q >= 12000;
    return event;
  }
}
