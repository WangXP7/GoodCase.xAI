/**
 * 飞行物理与操控（S1）—— 半隐式欧拉 · 固定步长 · 同帧动压
 *
 * 本类拥有火箭的全部运动学状态，是其他所有系统的唯一真值源。
 * 逐字对齐 `tests/c1/final.mjs` 的积分顺序，以保证 RT-1 的开环标定可被闭环复用：
 *
 *   几何 → 玩家配平(theta_cmd) → gamma → q(同帧) → 姿态动力学 → 推进 →
 *   重力/推力/阻力加速度 → 半隐式欧拉(先更新 v 再用新 v 更新 r) → 时间
 *
 * 为什么半隐式欧拉而非 RK4（S1 §3.1）：81s 窗口内能量误差可忽略，RK4 的 4 次
 * 力评估对实时预算纯属浪费。禁忌：Phaser Arcade Physics（为手感设计，非弹道精度）。
 *
 * 分离（S3）：执行质量跳变 m −= (S1_DRY + fuel1AtSep)，恒等于 16500 kg。
 * 修复 S3 §9-C16：参考实现只扣 S1_DRY，玩家提前分离会留下幽灵燃料，
 * 使 Δv 余量虚高至 3117 m/s（> 总 Δv 2635，物理不可能）。本实现扣两者。
 */

import { normalizeAlpha } from './atmosphere.js';

export class FlightModel {
  constructor(world, rocket, control) {
    this.W = world;
    this.R = rocket;
    this.C = control;
    this.reset();
  }

  reset() {
    // 惯性系原点 = 行星质心，+y 为天顶，+x 为 downrange
    this.rx = 0; this.ry = this.W.R;
    this.vx = 0; this.vy = 0;
    this.m = this.R.M0;
    this.fuel1 = this.R.S1_FUEL;
    this.fuel2 = this.R.S2_FUEL;
    this.stage = 1;
    this.theta = Math.PI / 2;
    this.thetaCmd = Math.PI / 2;
    this.throttle = 1.0;
    this.t = 0;                 // 局内时间（松绑起算）
    this.tPowered = 0;

    // 分离归因（S3 §2.2）
    this.fuel1AtSep = null;
    this.dvWasted = 0;
    this.sepValid = true;
    this.separated = false;

    // 插值用上一帧状态
    this.prevRx = this.rx; this.prevRy = this.ry; this.prevTheta = this.theta;

    // 派生缓存
    this.r = this.W.R; this.h = 0; this.v = 0;
    this.vr = 0; this.vh = 0;
    this.gamma = Math.PI / 2; this.alpha = 0;
    this.q = 0; this.rho = 0; this.thrust = 0; this.mdot = 0;
    this.drag = 0;
    this.dvSpent = 0;
    // Task1「配平代价」：累计被阻力吃掉的速度（∫D/m dt）。单调不减，给玩家一个"价签"。
    this.dvDrag = 0;

    // 极值快照（S6 PeakSnapshot）
    this.maxAlpha = 0; this.hMax = 0; this.vMax = 0; this.vhMax = 0;
  }

  /** @param {number} dt @param {{pitch:number, throttle:number}} inp */
  step(dt, inp) {
    const W = this.W, R = this.R, C = this.C;

    // ── 几何 ──
    const r = Math.sqrt(this.rx * this.rx + this.ry * this.ry);
    const h = r - W.R;
    const v = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const ux = this.rx / r, uy = this.ry / r;   // 径向 û
    const lx = uy, ly = -ux;                     // 切向 l̂（downrange 前方）

    // ── 玩家配平 → theta_cmd（S1 §3.3-1 / §4.1）──
    this.thetaCmd += inp.pitch * C.PITCH_CMD_RATE * dt;
    if (this.thetaCmd > C.THETA_MAX) this.thetaCmd = C.THETA_MAX;
    if (this.thetaCmd < C.THETA_MIN) this.thetaCmd = C.THETA_MIN;

    // ── 节流（S1 §3.6）──
    this.throttle += inp.throttle * C.THROTTLE_RATE * dt;
    if (this.throttle > C.THROTTLE_MAX) this.throttle = C.THROTTLE_MAX;
    if (this.throttle < C.THROTTLE_MIN) this.throttle = C.THROTTLE_MIN;

    // ── 航迹角与攻角（S1 §3.4 / §6.1）──
    const gamma = v > C.V_GAMMA_EPS
      ? Math.atan2(this.vx * ux + this.vy * uy, this.vx * lx + this.vy * ly)
      : Math.PI / 2;
    const alpha = normalizeAlpha(this.theta, gamma);

    // ── 动压（同帧，S4 §7.3 建议实现方式）──
    const rho = rhoOf(h, W);
    const q = 0.5 * rho * v * v;

    // ── 姿态动力学（S1 §3.3-2/3）──
    let dTheta = (this.thetaCmd - this.theta) / C.TAU_PITCH + C.K_AERO * q * (gamma - this.theta);
    if (dTheta > C.PITCH_RATE_MAX) dTheta = C.PITCH_RATE_MAX;
    if (dTheta < -C.PITCH_RATE_MAX) dTheta = -C.PITCH_RATE_MAX;
    this.theta += dTheta * dt;

    // ── 推进（S1 §3.2-⑤）──
    let thrust = 0, mdot = 0;
    if (this.stage === 1 && this.fuel1 > 0) {
      thrust = this.throttle * R.T1;
      mdot = thrust / R.ISP_G0;
      this.fuel1 = Math.max(0, this.fuel1 - mdot * dt);
      this.tPowered += dt;
    } else if (this.stage === 2 && this.fuel2 > 0) {
      thrust = this.throttle * R.T2;
      mdot = thrust / R.ISP_G0;
      this.fuel2 = Math.max(0, this.fuel2 - mdot * dt);
      this.tPowered += dt;
    }

    // ── 加速度：重力 + 推力 ──
    // 推力沿箭体轴向 n̂ = cos(θ)·l̂ + sin(θ)·û
    const nx = Math.cos(this.theta) * lx + Math.sin(this.theta) * ux;
    const ny = Math.cos(this.theta) * ly + Math.sin(this.theta) * uy;
    const ag = -W.MU / (r * r);
    let ax = ag * ux, ay = ag * uy;
    ax += (thrust / this.m) * nx;
    ay += (thrust / this.m) * ny;

    // ── 大气阻力（S1 §3.2-③，v > 0.5 才计算）──
    let drag = 0;
    if (v > C.V_DRAG_EPS) {
      const Cd = W.CD0 + W.CD_ALPHA * Math.sin(alpha) * Math.sin(alpha);
      drag = 0.5 * rho * v * v * Cd * W.A_REF;
      ax -= (drag / this.m) * (this.vx / v);
      ay -= (drag / this.m) * (this.vy / v);
    }
    // 配平代价记账：本步被阻力消耗的 Δv（与推力无关，纯耗散）
    this.dvDrag += (drag / this.m) * dt;

    // ── 半隐式欧拉（先更新 v，再用新 v 更新 r）──
    this.prevRx = this.rx; this.prevRy = this.ry; this.prevTheta = this.theta - dTheta * dt;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.rx += this.vx * dt;
    this.ry += this.vy * dt;
    this.m -= mdot * dt;
    this.t += dt;

    // ── 派生缓存 ──
    this.r = Math.sqrt(this.rx * this.rx + this.ry * this.ry);
    this.h = this.r - W.R;
    this.v = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const ux2 = this.rx / this.r, uy2 = this.ry / this.r;
    const lx2 = uy2, ly2 = -ux2;
    this.vr = this.vx * ux2 + this.vy * uy2;
    this.vh = this.vx * lx2 + this.vy * ly2;
    this.gamma = this.v > C.V_GAMMA_EPS ? Math.atan2(this.vr, this.vh) : Math.PI / 2;
    this.alpha = normalizeAlpha(this.theta, this.gamma);
    this.rho = rho; this.q = q; this.thrust = thrust; this.mdot = mdot; this.drag = drag;

    const a = Math.abs(this.alpha);
    if (a > this.maxAlpha) this.maxAlpha = a;
    if (this.h > this.hMax) this.hMax = this.h;
    if (this.v > this.vMax) this.vMax = this.v;
    if (this.vh > this.vhMax) this.vhMax = this.vh;
  }

  /** 执行分离（S3 §3.2 / §3.3）。返回归因数据。 */
  separate() {
    if (this.stage !== 1) return null;
    const R = this.R;
    const mBefore = this.m;
    const fuel1AtSep = Math.max(0, this.fuel1);
    const mAfter = mBefore - R.S1_DRY - fuel1AtSep;      // 恒等式 ⇒ 16500 kg
    const wasteArg = mBefore - fuel1AtSep;
    let dvWasted = 0;
    if (fuel1AtSep > 1e-6 && wasteArg > 0) {
      dvWasted = R.ISP_G0 * Math.log(mBefore / wasteArg);
      if (!Number.isFinite(dvWasted) || dvWasted < 0) dvWasted = 0;
    }
    this.m = mAfter;
    this.fuel1AtSep = fuel1AtSep;   // 冻结供 S6 归因（S3 §6.4）
    this.fuel1 = fuel1AtSep;        // 随残骸抛弃，不再被消耗（stage=2）
    this.dvWasted = dvWasted;
    this.stage = 2;
    this.separated = true;
    return { mBefore, mAfter, fuel1AtSep, dvWasted };
  }

  /** Δv 余量（S1 §3.2-⑥ 分段公式，含退化防护 §6.2） */
  dvRemain() {
    const R = this.R, ISP = R.ISP_G0;
    if (this.stage === 1) {
      const mEff = Math.max(this.m, R.M_AFTER_S1 + 1e-6);
      const term1 = mEff <= R.M_AFTER_S1 ? 0 : ISP * Math.log(mEff / R.M_AFTER_S1);
      const term2 = ISP * Math.log(R.M_S2_START / R.M_DRY_FINAL);
      const x = term1 + term2;
      return Number.isFinite(x) ? Math.max(0, x) : 0;
    }
    const mEff = Math.max(this.m, R.M_DRY_FINAL + 1e-6);
    const x = mEff <= R.M_DRY_FINAL ? 0 : ISP * Math.log(mEff / R.M_DRY_FINAL);
    return Number.isFinite(x) ? Math.max(0, x) : 0;
  }

  /** 当前级可用燃料（S5：fuel1+fuel2 在分离后会把已抛弃的油算进去，故按级取） */
  fuelRemainKg() {
    return this.stage === 1 ? this.fuel1 + this.fuel2 : this.fuel2;
  }

  getDerived() {
    return {
      r: this.r, h: this.h, v: this.v, vr: this.vr, vh: this.vh,
      gamma: this.gamma, alpha: this.alpha, q: this.q, rho: this.rho,
      thrust: this.thrust, drag: this.drag,
    };
  }

  /** 渲染插值（不回写状态，S1 §3.1） */
  interpolated(alphaLerp) {
    return {
      rx: this.prevRx + (this.rx - this.prevRx) * alphaLerp,
      ry: this.prevRy + (this.ry - this.prevRy) * alphaLerp,
      theta: this.prevTheta + (this.theta - this.prevTheta) * alphaLerp,
    };
  }
}

/** 内联 rho（避免热路径跨模块调用开销；与 atmosphere.rhoAt 语义一致） */
function rhoOf(h, W) {
  const top = W.ATM_TOP;
  if (h >= top || h < 0) return 0;
  const base = W.RHO0 * Math.exp(-h / W.SCALE_H);
  if (h >= top - W.RHO_FADE) return base * ((top - h) / W.RHO_FADE);
  return base;
}

/** 参考重力转弯程序（辅助线 / 玩家模型 / 首局隐形引导，S1 §3.5） */
export function thetaCmdRef(h, prog) {
  if (h < prog.H_START) return Math.PI / 2;
  let u = (h - prog.H_START) / (prog.H_TURN - prog.H_START);
  if (u < 0) u = 0; if (u > 1) u = 1;
  return (Math.PI / 2) * Math.pow(1 - u, prog.P_EXP);
}
