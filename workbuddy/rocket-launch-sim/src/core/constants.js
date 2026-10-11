/**
 * RT-1 标定常量 —— 唯一真值源（Single Source of Truth）
 *
 * 全部数值逐字来自 `docs/architecture/RT-1-recalibration.md` 与 `design/gdd/S1..S7`。
 * 任何一处改动都会击穿 RT-1 的验收数据（近地点 15.09km / 动压 16.5kPa / 单局 81.0s）。
 * 因此本文件是只读契约：`Object.freeze` 冻结全部表，禁止运行时改写。
 *
 * 单位：SI（m, kg, s, N, rad）。角度内部一律 rad，仅在 HUD 层转度。
 */

// ── 行星 Planet-C ──────────────────────────────────────────────────────────
export const WORLD = Object.freeze({
  R: 300000,                 // m  行星半径
  G0: 8.0,                   // m/s² 地表重力
  MU: 7.2e11,                // m³/s² = g0·R²
  H: 15000,                  // m  目标轨道高度
  R_TGT: 315000,             // m  = R + H
  VC: Math.sqrt(7.2e11 / 315000), // m/s 圆轨道速度 ≈ 1511.86
  V_ESC: 2138.0,             // m/s 逃逸速度 ≈ sqrt(2)·VC
  // 大气（RT-1 硬截断 + S4 §6.2 过渡带）
  RHO0: 1.2,                 // kg/m³ 海平面密度
  SCALE_H: 2500,             // m 标高
  ATM_TOP: 12000,            // m 大气顶（>= 此高度 rho 恒为 0）
  RHO_FADE: 300,             // m 过渡带，抹平 12km 处的密度阶跃
  // 气动（S1 / S4）
  A_REF: 10.0,               // m²
  CD0: 0.25,
  CD_ALPHA: 2.0,
});

// ── 火箭（两级 · 单构型，MVP 不可改）───────────────────────────────────────
export const ROCKET = Object.freeze({
  M_PAYLOAD: 8500,
  S1_DRY: 7000,
  S1_FUEL: 18900,
  S1_BURN: 60,
  S2_DRY: 3500,
  S2_FUEL: 4500,
  S2_BURN: 21,
  ISP_G0: 2900,              // m/s 有效排气速度（两级相同）
  // 派生常量（S1 §3.2-⑥ Δv 记账）
  get T1() { return (this.S1_FUEL / this.S1_BURN) * this.ISP_G0; },        // 913500 N
  get T2() { return (this.S2_FUEL / this.S2_BURN) * this.ISP_G0; },        // 621428.6 N
  get MDOT1() { return this.T1 / this.ISP_G0; },                            // 315.0 kg/s
  get MDOT2() { return this.T2 / this.ISP_G0; },                            // 214.286 kg/s
  get M0() { return this.S1_DRY + this.S1_FUEL + this.S2_DRY + this.S2_FUEL + this.M_PAYLOAD; }, // 42400
  // 分离后质量恒等式（S3 §3.3）—— 与分离时刻无关
  get M_AFTER_S1() { return this.S1_DRY + this.S2_DRY + this.S2_FUEL + this.M_PAYLOAD; },  // 23500
  get M_S2_START() { return this.S2_DRY + this.S2_FUEL + this.M_PAYLOAD; },                // 16500
  get M_DRY_FINAL() { return this.S2_DRY + this.M_PAYLOAD; },                              // 12000
  get TWR0() { return this.T1 / (this.M0 * WORLD.G0); },                                   // 2.693
  get DV_TOTAL() {
    return this.ISP_G0 * Math.log(this.M0 / this.M_AFTER_S1)
         + this.ISP_G0 * Math.log(this.M_S2_START / this.M_DRY_FINAL);
  },                                                                                        // 2635.1 m/s
});

// ── 操控与积分器（S1 §3.1 / §3.3 / §3.6 / §4）─────────────────────────────
export const CONTROL = Object.freeze({
  DT: 1 / 120,               // s 固定物理步长（与 RT-1 验证脚本同值）
  MAX_STEPS: 5,              // 单帧最多追帧数（防死亡螺旋）
  PITCH_CMD_RATE: 0.262,     // rad/s = 15°/s 玩家按 A/D 时目标角移动速率
  TAU_PITCH: 0.30,           // s 一阶滞后时间常数
  K_AERO: 1.5e-5,            // rad/(Pa·s) 气动恢复力矩（RT-1 R5 占位值，具名常量）
  PITCH_RATE_MAX: 0.209,     // rad/s = 12°/s 角速度硬限幅
  THETA_MAX: Math.PI / 2,    // rad 90°（垂直向上）
  THETA_MIN: -0.349,         // rad -20°（末段救场）
  THROTTLE_MIN: 0.30,        // 防熄火下限
  THROTTLE_MAX: 1.00,
  THROTTLE_RATE: 1.0,        // /s
  V_DRAG_EPS: 0.5,           // m/s 阻力计算速度下限
  V_GAMMA_EPS: 1.0,          // m/s 航迹角定义下限
  BLUR_LOCK: 0.2,            // s 焦点丢失后输入锁定
});

// ── 参考重力转弯程序（仅用于辅助线 / 无头验证的"玩家模型"）──────────────────
export const PROGRAM = Object.freeze({
  H_START: 150,              // m = 1% H
  H_TURN: 7500,              // m = 50% H
  P_EXP: 0.8,
});

// ── Ω 复合指标（S7 §2，主理人裁决采用 F4 形式）────────────────────────────
export const OMEGA = Object.freeze({
  W_A: 0.45,
  W_B: 0.55,
  OMEGA_CRIT: 1.60,
  GAMMA: 0.55,               // 感知伽马
  H_GATE: 0.60,              // 折线压缩标尺的亚轨道/轨道分界
});

// ── 入轨判定与评级（S5）────────────────────────────────────────────────────
export const JUDGE = Object.freeze({
  H_PASS: 13500,             // m 入轨门槛 = 0.9H
  H_PREC: 750,               // m 精确入轨容差 = 0.05H
  H_PASS_HYST: 1,            // m 迟滞带（S5 §6.3）
  T_SHUTDOWN_HOLD: 1.0,      // s 主动关机确认保持
});

// ── 失败阈值（S1 §6.5 / S4 §2.2 / S6 §3.1）────────────────────────────────
export const FAIL = Object.freeze({
  Q_WARN: 12000,             // Pa 动压警戒
  Q_STRUCT: 30000,           // Pa 动压结构极限
  Q_SEP_SAFE: 5000,          // Pa 安全分离上限（S3 拥有；C6 提议 8000，默认 5000）
  ALPHA_STRUCT: 0.35,        // rad 20°
  TUMBLE_ALPHA: 1.05,        // rad 60°
  TUMBLE_HOLD: 1.0,          // s
  IMPACT_GRACE: 1.0,         // s 松绑后 1s 内 h<=0 忽略
  Q_PEAK_MARGIN: 1000,       // Pa 越过峰值判定余量
});

// ── 发射序列 S2 ────────────────────────────────────────────────────────────
export const SEQ = Object.freeze({
  T_COUNT: 10.0,
  T_CHILL_START: -10.0, T_CHILL_DUR: 4.0,
  T_PRESS_START: -6.0,  T_PRESS_DUR: 4.4,
  T_IGNITE: -1.6,       T_SPOOL: 1.2,
  T_ZERO: 0.0,
  T_RELEASE_DELAY: 0.40,
  T_SKIP_MIN: 3.0,
  CHARGING_DELAY: 0.6,       // s 按住 Space 充能完成才进入 COUNTDOWN
  T_COMPLETE: 0.98,          // 完成判据（宽松阈值吸收浮点误差）
  SPOOL_READY: 0.995,
  HOLD_TIMEOUT: 3.0,
});

// ── 分级分离 S3 ────────────────────────────────────────────────────────────
export const STAGE = Object.freeze({
  HITSTOP: 0.35,             // s 顿帧（时序层，物理暂停）
  DEBRIS_SPIN: 0.785,        // rad/s 45°/s
  DEBRIS_COAST: 0.30,        // s 无动力上升
  DESPAWN_T: 6.0,            // s 残骸回收
  SEP_DEBOUNCE: 0.200,       // s 边沿触发重复抑制
  T_SEP_BASELINE: 60.00,
});

// ── HUD 常量（S7 §4.2 / 美术 §5）───────────────────────────────────────────
export const HUD = Object.freeze({
  W: 1920, H: 1080,
  BAR_WIDTH: 320,
  BAR_HEIGHT_OCCUPY: 324,
  T_TRANSITION: 0.60,        // s 模态切换过渡
  OVERSHOOT: 0.08,           // 过冲幅度
  T_Q_FOLD: 1.20,            // s 真空段动压读数折叠延迟
  READINGS: 5,
  OMEGA_MILESTONES: [25, 50, 75],
});

// ── 阶段名（任务带显示用，S1 §3.7 实测时刻）────────────────────────────────
export const PHASES = Object.freeze({
  IDLE: 'IDLE', COUNTDOWN: 'COUNTDOWN', IGNITION: 'IGNITION',
  RELEASE: 'RELEASE', FLIGHT: 'FLIGHT', ABORTED: 'ABORTED', FAILED: 'FAILED',
});

// ── 天空色带（S4 §3.7 重映射 · 9 带压进 0–19.4km）──────────────────────────
export const SKY_BANDS = Object.freeze([
  { id: 'L0', name: '地面 GROUND',      lo: 0,     hi: 150,   top: 0x8fb8d9, bot: 0xe8d9be },
  { id: 'L1', name: '稠密大气 DENSE',    lo: 150,   hi: 3000,  top: 0x7fa8d4, bot: 0x4e7bb0 },
  { id: 'L2', name: '稀薄大气 THIN',     lo: 3000,  hi: 7500,  top: 0x3d5f9e, bot: 0x2a3f7a },
  { id: 'L3', name: '近似真空 NEAR-VAC', lo: 7500,  hi: 11000, top: 0x22315f, bot: 0x1a2347 },
  { id: 'L4', name: '大气边缘 LIMB',     lo: 11000, hi: 12000, top: 0x141a36, bot: 0x0e1229 },
  { id: 'L6', name: '近地空间 LEO-EDGE', lo: 12000, hi: 15000, top: 0x0e1229, bot: 0x0b1026 },
  { id: 'L7', name: '转移段 TRANSFER',   lo: 15000, hi: 19409, top: 0x0b1026, bot: 0x0b1026 },
  { id: 'L8', name: '入轨 ORBIT',        lo: 19409, hi: 1e9,   top: 0x0b1026, bot: 0x0b1026 },
]);
