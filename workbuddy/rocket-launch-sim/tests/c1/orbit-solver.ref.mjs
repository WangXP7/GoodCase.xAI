/**
 * C1 · 轨道根数解算器 —— 参考实现（Reference Implementation）
 *
 * 定位：
 *   1. 作为 C1 可行性验证的被测对象（tests/c1/verify.mjs 依赖本文件）
 *   2. 作为 src/core/orbit/OrbitSolver.ts 的验收级规格说明（spec-by-example）
 *
 * 约束：
 *   - 零依赖、零 Phaser 引用、纯函数、可在 Node 中 headless 运行
 *   - 天体常数 (mu, R) 一律注入，不硬编码地球值 → 结论对任何行星标定都成立
 *
 * 算法：比能 + 角动量 + 离心率标量式，直接推近/远地点半径。
 *       不使用 e_vec（矢量法），不使用开普勒方程（不做 M→E 迭代）。
 *
 * @see docs/architecture/C1-orbit-solver-feasibility.md
 */

// ── 天体常数（注入式，非硬编码）──────────────────────────────────────────────
export const EARTH = { mu: 3.986004418e14, R: 6.371e6, name: 'Earth' };

/** 架构文档 §RT-1 推荐标定「C · 折中」（待文策渊裁决） */
export const PLANET_C = { mu: 1.08e12, R: 3.0e5, name: 'Planet-C (R=300km, g0=12)' };

// ── 解算结果状态枚举 ─────────────────────────────────────────────────────────
export const Regime = Object.freeze({
  /** 椭圆轨道（含圆轨道）：近/远地点均有效 */
  ELLIPTIC: 'ELLIPTIC',
  /** 圆轨道：|ra - rp| 小于阈值，双游标重合 */
  CIRCULAR: 'CIRCULAR',
  /** 抛物线 / 双曲线：无远地点，仅近地点有效 */
  ESCAPE: 'ESCAPE',
  /** 亚轨道：近地点在地表以下（轨迹将与地表相交） */
  SUBORBITAL: 'SUBORBITAL',
  /** 数值退化：解算非有限，调用方必须使用上一次有效值 */
  DEGENERATE: 'DEGENERATE',
});

/** 近地点判定为"圆轨道"的阈值（相对半长轴） */
const CIRCULAR_EPS = 1e-4;
/** 能量判定为"逃逸"的阈值：eps >= -EPS_ENERGY 视为非闭合 */
const EPS_ENERGY_REL = 1e-9;

/**
 * 轨道根数解算 —— 主入口。
 *
 * 输入：以**天体中心**为原点的惯性系位置/速度（SI：m, m/s）。
 * 输出：{ regime, ap, aa, e, a, p }  其中 ap/aa 为**高度**（m），a/p 为长度（m）。
 *
 * 关键实现约束（改实现前先读 C1 报告 §3）：
 *   - 必须用 (a, e) 形式，禁止用 (p, e) 形式推远地点。
 *     垂直上升时 h→0 ⇒ p→0 且 e→1，p/(1-e) = 0/0 = NaN（已实测复现，见 verify.mjs T2）。
 *     (a, e) 形式在 h→0 时连续收敛到 ra = 2a，无奇点。
 *   - e 必须用标量式 e = sqrt(1 + 2·eps·h²/mu²)，不用 e_vec。
 *     标量式在 h=0 时给出 e≡1（精确），且与 (eps, h) 自洽，不会与 a 打架。
 *   - 禁止 Math.hypot（V8 中显著慢于手写 sqrt，实测见 verify.mjs T1c）。
 *
 * @param {number} rx  位置 x（m，原点=天体中心）
 * @param {number} ry  位置 y（m）
 * @param {number} vx  速度 x（m/s）
 * @param {number} vy  速度 y（m/s）
 * @param {{mu:number, R:number}} body 天体常数
 * @param {{ap?:number, aa?:number, e?:number, a?:number, p?:number, regime?:string}} [out] 复用的输出对象（避免热路径分配）
 * @returns {object}
 */
export function solveOrbit(rx, ry, vx, vy, body, out) {
  const o = out || {};

  const mu = body.mu;
  const R = body.R;

  // ── 1. 位置与速度模长 ──
  // 手写 sqrt，禁止 Math.hypot
  const r2 = rx * rx + ry * ry;
  const v2 = vx * vx + vy * vy;
  const r = Math.sqrt(r2);
  if (!(r > 0) || !Number.isFinite(r)) {
    o.regime = Regime.DEGENERATE;
    o.ap = NaN; o.aa = NaN; o.e = NaN; o.a = NaN; o.p = NaN;
    return o;
  }
  const invR = 1 / r;

  // ── 2. 比机械能 eps = v²/2 − mu/r ──
  const eps = 0.5 * v2 - mu * invR;

  // ── 3. 比角动量（2D 标量，即 r × v 的 z 分量）──
  const h = rx * vy - ry * vx;

  // ── 4. 离心率（标量式，与 eps/h 自洽）──
  //     e² = 1 + 2·eps·h²/mu²
  //     h=0（纯径向）⇒ e=1 精确；圆轨道 ⇒ e=0 精确。
  const invMu = 1 / mu;
  let e2 = 1 + 2 * eps * h * h * invMu * invMu;
  if (!(e2 > 0)) e2 = 0;             // 吸收浮点负零；圆轨道时 e2 可能因舍入略小于 0
  const e = Math.sqrt(e2);

  // ── 5. 半通径 p = h²/mu（逃逸分支下推近地点仍需它）──
  const p = h * h * invMu;

  // ── 6. 分支：逃逸 / 椭圆 ──
  //     判据用相对阈值，避免不同行星标定量级不同导致阈值失效
  const epsThreshold = -EPS_ENERGY_REL * (mu * invR);

  if (eps >= epsThreshold) {
    // 抛物线 / 双曲线 / 数值临界：a 无意义（a<0 或 ±∞），无远地点
    o.regime = Regime.ESCAPE;
    o.a = Infinity;
    o.p = p;
    o.e = e;
    // 双曲线近地点 rp = p/(1+e)，此处 p>0 且 e>=1 ⇒ 分母 >= 2，安全
    o.ap = p / (1 + e) - R;
    o.aa = Infinity;
    return o;
  }

  // ── 7. 椭圆分支：a = −mu/(2·eps)，ra/ rp 由 (a, e) 推 ──
  const a = -0.5 * mu / eps;
  const ae = a * e;
  const rp = a - ae;
  const ra = a + ae;

  o.a = a;
  o.p = p;
  o.e = e;
  o.ap = rp - R;   // 近地点高度（可为负 → 亚轨道）
  o.aa = ra - R;   // 远地点高度

  // ── 8. 状态分类 ──
  if (rp < R) {
    o.regime = Regime.SUBORBITAL;   // 近地点在地表下：轨迹将与地表相交
  } else if (e < CIRCULAR_EPS) {
    o.regime = Regime.CIRCULAR;     // 双游标重合，HUD 需切换为单一游标
  } else {
    o.regime = Regime.ELLIPTIC;
  }
  return o;
}

/**
 * HUD 显示层兜底：把解算结果规整为「永不 NaN / 永不 undefined」的可显示值。
 *
 * 设计约束（美术 §5.2「遥测数字永不闪白」）：
 *   - 任何字段都不得为空串，退化时用等宽占位符 `--.-`（与真实值同字宽）
 *   - 亚轨道的近地点按 0 夹紧，由上层叠加 "SUBORBITAL" 状态标签，不显示负数
 */
export function toDisplay(o, prev) {
  const finite = Number.isFinite(o.ap) && Number.isFinite(o.aa);
  if (o.regime === Regime.DEGENERATE || !finite) {
    return prev && prev.valid ? prev : { valid: false, ap: 0, aa: 0, regime: Regime.DEGENERATE };
  }
  return {
    valid: true,
    regime: o.regime,
    ap: o.ap < 0 ? 0 : o.ap,          // 夹紧到 0，负数不出现在 HUD
    aa: o.aa,
  };
}

// ── 反例：被否决的 (p, e) 形式 ───────────────────────────────────────────────
/**
 * ⚠️ 本函数**故意保留**以作反例，生产代码禁止调用。
 * 垂直上升时 h→0 ⇒ p→0、e→1 ⇒ ra = p/(1−e) = 0/0 = NaN。
 * 这是设计侧未识别到的头号数值陷阱，已由 verify.mjs T2 实测复现。
 */
export function solveOrbit_NAIVE_pForm(rx, ry, vx, vy, body) {
  const mu = body.mu, R = body.R;
  const r = Math.sqrt(rx * rx + ry * ry);
  const v2 = vx * vx + vy * vy;
  const h = rx * vy - ry * vx;
  const p = (h * h) / mu;
  const ex = ((v2 - mu / r) * rx - (rx * vx + ry * vy) * vx) / mu;
  const ey = ((v2 - mu / r) * ry - (rx * vx + ry * vy) * vy) / mu;
  const e = Math.sqrt(ex * ex + ey * ey);
  return { rp: p / (1 + e), ra: p / (1 - e), e };
}
