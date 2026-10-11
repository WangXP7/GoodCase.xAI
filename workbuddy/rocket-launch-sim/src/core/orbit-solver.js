/**
 * 轨道根数解算器 —— src/core/orbit 的生产实现。
 *
 * 逐字移植自 `tests/c1/orbit-solver.ref.mjs`（C1 可行性验证通过的参考实现对
 * 本项目而言就是规格），并修复 S1 §9-C8：参考实现的 PLANET_C 常量仍为
 * `{mu:1.08e12, R:3e5}`（g0=12），与 RT-1 的 g0=8 / mu=7.2e11 不一致。
 * 本实现的天体常数一律由调用方注入（`world`），不内置任何行星常量。
 *
 * 算法：比能 + 角动量 + 离心率标量式，直接推近/远地点半径。
 *   - 必须用 (a, e) 形式，禁止 (p, e)（垂直上升时 p/(1-e)=0/0=NaN）
 *   - e 用标量式 e = sqrt(1 + 2·eps·h²/mu²)，不用 e_vec
 *   - 禁止 Math.hypot
 *
 * 性能（RT-1 实测 58 ns/次）：120 Hz 下年占帧预算 0.0007%，可忽略。
 * 热路径零分配：solve() 复用内部 out 对象。
 */

export const Regime = Object.freeze({
  ELLIPTIC: 'ELLIPTIC',
  CIRCULAR: 'CIRCULAR',
  ESCAPE: 'ESCAPE',
  SUBORBITAL: 'SUBORBITAL',
  DEGENERATE: 'DEGENERATE',
});

const CIRCULAR_EPS = 1e-4;
const EPS_ENERGY_REL = 1e-9;

/**
 * 纯函数解算。输入为以行星质心为原点的惯性系位置/速度。
 * @param {number} rx @param {number} ry @param {number} vx @param {number} vy
 * @param {{mu:number,R:number}} world
 * @param {object} [out] 复用的输出对象（热路径避免分配）
 */
export function solveOrbit(rx, ry, vx, vy, world, out) {
  const o = out || {};
  const mu = world.mu, R = world.R;

  const r2 = rx * rx + ry * ry;
  const v2 = vx * vx + vy * vy;
  const r = Math.sqrt(r2);
  if (!(r > 0) || !Number.isFinite(r)) {
    o.regime = Regime.DEGENERATE;
    o.periapsis = NaN; o.apoapsis = NaN; o.e = NaN; o.a = NaN; o.p = NaN;
    return o;
  }
  const invR = 1 / r;
  const eps = 0.5 * v2 - mu * invR;      // 比机械能
  const h = rx * vy - ry * vx;           // 比角动量（2D 标量）
  const invMu = 1 / mu;

  let e2 = 1 + 2 * eps * h * h * invMu * invMu;
  if (!(e2 > 0)) e2 = 0;
  const e = Math.sqrt(e2);
  const p = h * h * invMu;
  const epsThreshold = -EPS_ENERGY_REL * (mu * invR);

  o.e = e; o.p = p;

  if (eps >= epsThreshold) {
    // 抛物线 / 双曲线 / 数值临界：无远地点
    o.regime = Regime.ESCAPE;
    o.a = Infinity;
    o.periapsis = p / (1 + e) - R;
    o.apoapsis = Infinity;
    return o;
  }

  const a = -0.5 * mu / eps;
  const ae = a * e;
  const rp = a - ae;
  const ra = a + ae;
  o.a = a;
  o.periapsis = rp - R;
  o.apoapsis = ra - R;

  if (rp < R) o.regime = Regime.SUBORBITAL;
  else if (e < CIRCULAR_EPS) o.regime = Regime.CIRCULAR;
  else o.regime = Regime.ELLIPTIC;
  return o;
}

/**
 * 有状态门面：缓存最近一次**有效**解算，供 HUD 在 DEGENERATE 帧沿用（S5 §6.1）。
 * 这是 S5 唯一对外暴露的轨道数据源。
 */
export class OrbitSolver {
  constructor(world) {
    this.world = world;
    this.out = {};
    this.cache = { regime: Regime.DEGENERATE, periapsis: -world.R, apoapsis: NaN, e: NaN, a: NaN, valid: false };
    this.judged = false;
  }

  /** 每个物理步调用一次；返回内部缓存（只读） */
  solve(rx, ry, vx, vy) {
    solveOrbit(rx, ry, vx, vy, this.world, this.out);
    const o = this.out;
    // ESCAPE 的 apoapsis = Infinity 是**合法信息**（S5 §6.2：远地点显示 ∞、评级 INCOMPLETE、
    // 失败码 ESCAPE_TRAJ），因此有效性的唯一判据是「近地点有限」。
    // 把 ESCAPE 误判为 invalid 会让 (a) HUD 无法显示 ∞、(b) S6 归因错落成 INSUFFICIENT_DV。
    const periFinite = Number.isFinite(o.periapsis);
    if (o.regime === Regime.DEGENERATE || !periFinite) {
      // 沿用上一帧有效值；从未有效则 periapsis = -R，强制模态 A（S7 §6.4）
      this.cache.valid = false;
      return this.cache;
    }
    this.cache.regime = o.regime;
    this.cache.periapsis = o.periapsis;
    this.cache.apoapsis = o.apoapsis;
    this.cache.e = o.e;
    this.cache.a = o.a;
    this.cache.valid = true;
    return this.cache;
  }

  get() { return this.cache; }

  reset() {
    this.cache.regime = Regime.DEGENERATE;
    this.cache.periapsis = -this.world.R;
    this.cache.apoapsis = NaN;
    this.cache.e = NaN;
    this.cache.a = NaN;
    this.cache.valid = false;
    this.judged = false;
  }
}
