/**
 * state.js —— 猫的五维性格 + 15 状态层次状态机 + 生理需求（系统 1 的全部技术落地）
 *
 * 依据：GDD PH2 §3（行 147–668，本文件的唯一权威规格）
 *       §3.3.1 五维定义 / §3.3.2 相互作用矩阵 / §3.3.3 行为仲裁公式
 *       §3.4 状态机（15 状态 / 6 域 / 无终止态）/ §3.5 数值规格 / §3.6 八条边缘情况
 *       附录 C（行 1513–1548）状态机 → MVP 12 姿态映射
 *       裁决：RUL-2（≤20k 面，与本文件无关）、RUL-5（暖机模型）、RUL-9（种子化 + 固定步长）
 *
 * ┌─ 本文件的设计契约 ────────────────────────────────────────────────────────┐
 * │ 1. 零浏览器依赖：只 import core/ 与 systems/ 中的纯模块，可被 Node 直接引入。 │
 * │ 2. 所有随机走 core/rng.js 的种子化流（PCG32），禁止 Math.random（RUL-9）。   │
 * │ 3. 分层 tick 复用 core/tick.js 的 TICK 常量与 TickScheduler，禁止自写循环。 │
 * │ 4. state 字段对 interaction.js 永远是合法的 M_STATE 键（见 BEHAVIOR_STATES）。│
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 命名裁决（与任务书措辞的差异，务必知悉）：
 *   任务书写 `personality: { aff, ind, cur, sec, ene }`。但 GDD §3.3.1 第 5 维在
 *   §1.1 裁决 D-1 中已由「精力」改名为「活力 VITALITY」，缩写 `VIT`；而 `ENE`
 *   是**生理需求**（能量），与性格分离。三个既有消费者也都用 `vit`：
 *     - interaction.js  文档注释：`ctx.personality { aff, ind, sec, cur, vit }`
 *     - warmth.js       applyInteraction(p) 读写 `p.vit`
 *     - snapshot.js     simulateEnergy 读 `p.vit`、日记权重读 `p.vit`
 *   因此本文件以 **`vit` 为规范字段**，并额外挂一个**不可枚举**的 `ene` 别名
 *   （get/set 转发到 vit），以兼容任务书字面写法且不污染 JSON / spread。
 */

import { clamp } from '../core/easing.js';
import { TICK, TickScheduler } from '../core/tick.js';
import { PCG32 } from '../core/rng.js';
import { circadianBand } from '../systems/time.js';
import {
  applyInteraction as warmthApplyInteraction,
  applyWaiting as warmthApplyWaiting,
  accrueCoPresence,
  affectionFloor,
  affectionStage,
} from '../systems/warmth.js';

/* ============================================================================
 * 一、常量表（GDD §3.3.3 / §3.4 / §3.5）
 * ========================================================================== */

/** 行为状态集合 —— 与 interaction.js 的 M_STATE 键**逐字一致**（15 个）。 */
export const BEHAVIOR_STATES = Object.freeze([
  'SLEEP_DEEP', 'SLEEP_LIGHT', 'REST', 'GROOM', 'EAT', 'DRINK',
  'EXPLORE', 'PLAY', 'WATCH_WINDOW', 'HIDE', 'SEEK_ATTENTION',
  'PETTED', 'ALERT', 'TRANSIT', 'WARMUP',
]);

/** 瞬时/瞬时叠加态（不属于加权仲裁候选，由定时器驱动）。 */
export const TRANSIENT_STATES = Object.freeze(['WARMUP', 'ALERT', 'REJECT']);

/** 状态机可达全集（= 行为状态 + REJECT；BOOT 在构造期一次性解析，不驻留）。 */
export const ALL_STATES = Object.freeze([...BEHAVIOR_STATES, 'REJECT']);

/** 6 个域（GDD §3.4）—— 供调试与美术分层使用。 */
export const STATE_DOMAIN = Object.freeze({
  REST: 'AWAKE', EAT: 'AWAKE', DRINK: 'AWAKE', EXPLORE: 'AWAKE',
  PLAY: 'AWAKE', WATCH_WINDOW: 'AWAKE', GROOM: 'AWAKE',
  SLEEP_DEEP: 'SLEEP', SLEEP_LIGHT: 'SLEEP',
  HIDE: 'WITHDRAW',
  SEEK_ATTENTION: 'SOCIAL', PETTED: 'SOCIAL',
  WARMUP: 'TRANSIENT', ALERT: 'TRANSIENT', REJECT: 'TRANSIENT', TRANSIT: 'TRANSIENT',
});

/** 表 3.3.3-A · 11 个加权行为：Base / 性格敏感系数 k / 平均驻留(min) / 精力(点/游戏分) */
export const BEHAVIOR_TABLE = Object.freeze({
  SLEEP_DEEP:     { base: 0.90, k: { aff: -0.10, ind: 0.10, cur: -0.35, sec: 0.85, vit: -0.65 }, dwell: 45.0, energy: 0.10 },
  SLEEP_LIGHT:    { base: 0.80, k: { aff: -0.05, ind: 0.15, cur: -0.15, sec: 0.55, vit: -0.35 }, dwell: 22.0, energy: 0.06 },
  REST:           { base: 1.10, k: { aff:  0.10, ind: 0.05, cur: -0.25, sec: 0.30, vit: -0.25 }, dwell:  8.0, energy: 0.012 },
  GROOM:          { base: 0.70, k: { aff: -0.05, ind: 0.25, cur: -0.10, sec: 0.40, vit: -0.10 }, dwell:  4.0, energy: 0.005 },
  EAT:            { base: 0.50, k: { aff:  0.05, ind: 0.00, cur:  0.00, sec: 0.20, vit:  0.00 }, dwell:  2.5, energy: 0.01 },
  DRINK:          { base: 0.40, k: { aff:  0.00, ind: 0.00, cur:  0.00, sec: 0.15, vit:  0.00 }, dwell:  1.5, energy: 0.01 },
  EXPLORE:        { base: 0.90, k: { aff: -0.20, ind: 0.45, cur:  1.10, sec: 0.35, vit:  0.70 }, dwell:  3.5, energy: -0.35 },
  PLAY:           { base: 0.70, k: { aff:  0.80, ind: -0.30, cur: 0.75, sec: 0.40, vit:  1.00 }, dwell:  2.5, energy: -0.45 },
  WATCH_WINDOW:   { base: 0.80, k: { aff: -0.30, ind: 0.65, cur:  0.35, sec: 0.10, vit: -0.20 }, dwell:  9.0, energy: 0.008 },
  HIDE:           { base: 0.30, k: { aff: -0.55, ind: 0.30, cur: -0.40, sec: -1.30, vit: -0.20 }, dwell: 18.0, energy: 0.015 },
  SEEK_ATTENTION: { base: 0.42, k: { aff:  1.10, ind: -0.95, cur: 0.10, sec: 0.40, vit:  0.35 }, dwell:  0.5, energy: -0.05 },
});

export const WEIGHTED_BEHAVIORS = Object.freeze(Object.keys(BEHAVIOR_TABLE));

/** 表 3.3.3-C · 昼夜节律修正 C(b)（行 = circadianBand 的 5 档固定钟点，不是 timeSlot） */
export const CIRCADIAN = Object.freeze({
  lateNight: { SLEEP_DEEP: 1.7, SLEEP_LIGHT: 1.5, REST: 1.0, GROOM: 0.8, EAT: 0.6, DRINK: 0.6, EXPLORE: 0.4, PLAY: 0.3, WATCH_WINDOW: 0.3, HIDE: 1.2, SEEK_ATTENTION: 0.5 },
  morning:   { SLEEP_DEEP: 0.5, SLEEP_LIGHT: 0.7, REST: 1.0, GROOM: 1.1, EAT: 1.4, DRINK: 1.2, EXPLORE: 1.3, PLAY: 1.2, WATCH_WINDOW: 0.9, HIDE: 0.7, SEEK_ATTENTION: 1.1 },
  noon:      { SLEEP_DEEP: 1.4, SLEEP_LIGHT: 1.5, REST: 1.2, GROOM: 1.0, EAT: 0.9, DRINK: 1.0, EXPLORE: 0.8, PLAY: 0.7, WATCH_WINDOW: 0.8, HIDE: 1.0, SEEK_ATTENTION: 0.8 },
  dusk:      { SLEEP_DEEP: 0.6, SLEEP_LIGHT: 0.8, REST: 1.0, GROOM: 1.0, EAT: 1.2, DRINK: 1.0, EXPLORE: 1.2, PLAY: 1.4, WATCH_WINDOW: 1.5, HIDE: 0.8, SEEK_ATTENTION: 1.2 },
  night:     { SLEEP_DEEP: 0.9, SLEEP_LIGHT: 1.1, REST: 1.2, GROOM: 1.1, EAT: 1.1, DRINK: 1.0, EXPLORE: 0.9, PLAY: 1.1, WATCH_WINDOW: 0.6, HIDE: 1.0, SEEK_ATTENTION: 1.3 },
});

/** GDD §3.5 行为仲裁参数 */
export const ARBITER = Object.freeze({
  sharpenExponent: 1.60,   // 锐化指数 ⚙
  surpriseQuota: 0.08,     // 惊喜配额 ⚙
  hysteresis: 1.25,        // 当前状态滞后加成 ⚙
  refractoryTicks: 3,      // 不应期：刚做完的行为权重 ×0.20 ⚙
  refractoryMul: 0.20,
  minDwellRatio: 0.4,      // 状态最小驻留 = 驻留表 × 0.4 ⚙
  uFloor: 0.05,            // E1-6：所有 U < 0.05 → fallback REST
});

/** 需求衰减（GDD §3.3.1 需求表，点 / 游戏小时） */
export const NEED_DECAY_PER_GAME_HOUR = Object.freeze({ hng: 3.5, hyd: 4.0, toi: 2.8 });

/** 进食 / 饮水恢复速率（点 / 游戏分钟）—— EAT 直到 HNG≥75 或碗空 */
export const EAT_RATE = 34;
export const DRINK_RATE = 44;
export const EAT_SATIETY = 75;
export const DRINK_SATIETY = 70;
export const TOI_FLOOR_RESET = 6;   // TOI ≤ 此值 → 猫使用猫砂盆，TOI 回满（不惩罚、不生病）

/** 五维初始与边界（GDD §3.3.1） */
export const DIMS = Object.freeze({
  aff: { init: 15, min: 0, max: 100 },
  ind: { min: 0, max: 100, driftPerMonth: 0.5, driftClamp: 8 },  // 基因锁定
  cur: { init: [35, 65], min: 25, max: 100 },
  sec: { init: [30, 50], min: 10, max: 100 },
  vit: { init: [35, 65], min: 20, max: 85 },
});

/** 需求边界 */
export const NEEDS = Object.freeze({
  hng: { min: 0, max: 100, init: [45, 80] },
  hyd: { min: 0, max: 100, init: [50, 85] },
  toi: { min: 0, max: 100, init: [55, 90] },
  ene: { min: 0, max: null, init: [55, 80] },   // max = 60 + VIT×0.4
});

/** 来路 → 独立度 IND 分布（GDD §3.3.1 ②） */
export const ORIGINS = Object.freeze({
  stray:      { label: '它在外头待过一阵', lo: 62, span: 26 },
  born_here:  { label: '它从小就在这儿',   lo: 25, span: 23 },
  entrusted:  { label: '别人家的猫托付给我', lo: 45, span: 25 },
});
export const ORIGIN_KEYS = Object.freeze(Object.keys(ORIGINS));

/** SEC 天花板（基因锁定）：clamp(35 + (100−IND)×0.45 + rand(0,15), max(45, SEC₀+6), 95) */
export function secCapFor(ind, secInit, roll01) {
  const raw = 35 + (100 - ind) * 0.45 + roll01 * 15;
  return clamp(raw, Math.max(45, secInit + 6), 95);
}

/** ENE_max / ENE_rec（GDD §3.3.1） */
export function eneMax(vit) { return 60 + vit * 0.4; }
export function eneRecovery(vit) { return (2.0 + vit * 0.04) * (0.6 + vit / 125); }

/**
 * 清醒期能量消耗系数。
 *
 * ⚠️ 这里有一处必须解释的工程约束：GDD 只给了睡眠恢复率 ENE_rec（≈3.7–4.2 点/游戏分），
 *   没有给清醒消耗率。若清醒仅按「行为表 精力列」的 ±0.01~0.45 计算，ENE 几乎不降，
 *   猫会**几乎不睡**（实测 22 游戏小时睡眠占比仅 6%）——既不像猫，也与 systems/snapshot.js
 *   离线模型自带的 `awakeBias = 0.62`（62% 时间在睡）互相矛盾。
 *
 *   为使**在线状态机与离线快照的能量模型一致**，清醒消耗取
 *     drain = ENE_rec(VIT) × awakeBias/(1−awakeBias) × factor(b)
 *   其中 awakeBias = 0.62（与 snapshot.simulateEnergy 同一常量）。这样"睡/醒比"
 *   在两个模型里自洽（实测睡眠占比约 40–55%），同时保留行为差异（探索/玩耍更耗电）。
 */
export const AWAKE_BIAS = 0.62;
export const AWAKE_DRAIN_FACTOR = Object.freeze({
  REST: 0.40, GROOM: 0.50, WATCH_WINDOW: 0.40, EAT: 0.45, DRINK: 0.45,
  EXPLORE: 1.00, PLAY: 1.15, SEEK_ATTENTION: 0.70, HIDE: 0.30,
  PETTED: 0.30, ALERT: 0.60, TRANSIT: 0.90, WARMUP: 0.80, REJECT: 0.70,
});
export const AWAKE_DRAIN_DEFAULT = 0.70;

/* ---- 地点锚（必须与场景模块对齐，仅这 10 个取值） ---- */
export const ANCHORS = Object.freeze([
  'sofa', 'rug', 'windowsill', 'shelf', 'easel', 'washer',
  'plant', 'kitchen_counter', 'bowl', 'catbed',
]);

/** 锚点近似世界坐标（米）—— 用于 TRANSIT 步程估算（房间约 5m × 4m）。 */
export const ANCHOR_POS = Object.freeze({
  sofa:            { x:  1.6, y: 0.15, z: -1.2 },
  rug:             { x:  0.0, y: 0.00, z:  0.2 },
  windowsill:      { x: -2.4, y: 0.72, z:  0.6 },
  shelf:           { x:  2.2, y: 1.10, z: -1.6 },
  easel:           { x: -2.0, y: 0.00, z: -1.5 },
  washer:          { x:  2.4, y: 0.92, z:  1.4 },
  plant:           { x: -2.2, y: 0.00, z:  1.8 },
  kitchen_counter: { x:  1.2, y: 0.90, z:  2.0 },
  bowl:            { x: -0.8, y: 0.00, z:  1.9 },
  catbed:          { x:  2.0, y: 0.00, z:  0.9 },
});

/** 行为 → 候选锚点（首位为默认）。 */
export const BEHAVIOR_ANCHORS = Object.freeze({
  SLEEP_DEEP:     ['catbed', 'sofa', 'rug', 'shelf'],
  SLEEP_LIGHT:    ['catbed', 'sofa', 'rug'],
  REST:           ['rug', 'sofa', 'windowsill', 'catbed'],
  GROOM:          ['rug', 'sofa', 'catbed'],
  EAT:            ['bowl'],
  DRINK:          ['bowl'],
  EXPLORE:        ['shelf', 'easel', 'washer', 'plant', 'kitchen_counter', 'windowsill'],
  PLAY:           ['rug', 'sofa'],
  WATCH_WINDOW:   ['windowsill'],
  HIDE:           ['shelf', 'plant', 'catbed'],
  SEEK_ATTENTION: ['rug', 'sofa'],
  PETTED:         ['rug', 'sofa', 'catbed'],
  WARMUP:         ['rug', 'sofa'],
  TRANSIT:        ['rug'],
  ALERT:          ['rug'],
  REJECT:         ['rug'],
});

/** 步速（米/秒）基线；AFF 调制见 §4.7（高 AFF 走近玩家 −30%，低 AFF +50%） */
export const WALK_SPEED = 0.45;

/** 低机动性行为：优先留在当前锚点，避免无意义的来回 TRANSIT */
export const STATIONARY_BEHAVIORS = Object.freeze(new Set([
  'REST', 'SLEEP_DEEP', 'SLEEP_LIGHT', 'GROOM', 'WATCH_WINDOW',
  'EAT', 'DRINK', 'PETTED', 'SEEK_ATTENTION', 'HIDE', 'ALERT', 'REJECT', 'WARMUP',
]));

/** REJECT / HIDE 退出时不允许回到瞬时态，统一兜底到 REST */
export function returnStateOf(s) {
  return (s === 'TRANSIT' || s === 'REJECT' || s === 'ALERT' || s === 'WARMUP' || !s) ? 'REST' : s;
}

/** 相邻锚点步行速度调制 */
export function walkSpeedFor(aff) {
  // AFF 0 → ×1.5；AFF 100 → ×0.7
  return WALK_SPEED * (1.5 - 0.8 * clamp(aff, 0, 100) / 100);
}

/* ============================================================================
 * 二、小工具
 * ========================================================================== */

const TWO_PI = Math.PI * 2;

function wrapMinutes(m) { const v = m % 1440; return v < 0 ? v + 1440 : v; }

/** 上一次互动发生的游戏分钟（驱动 VIT 的"规律互动"判定）。 */
const NO_INTERACTION = -1e9;

/* ============================================================================
 * 三、CatState
 * ========================================================================== */

export class CatState {
  /**
   * @param {object} [opts]
   * @param {number} [opts.seed]        种子（不传则从 opts.rng 取，或退化为固定 1）
   * @param {PCG32}  [opts.rng]         外部注入的种子化流（推荐：主入口的 core 流）
   * @param {string} [opts.origin]      来路：'stray' | 'born_here' | 'entrusted'
   * @param {string} [opts.name]        猫名（存档情感资产，透传保留）
   * @param {object} [opts.personality] 部分覆盖（读档 / 测试用）
   * @param {object} [opts.needs]       部分覆盖
   * @param {string} [opts.state]       初始大状态
   * @param {string} [opts.anchorId]    初始锚点
   * @param {number} [opts.gameMinutes] 初始游戏内分钟（驱动昼夜节律）
   */
  constructor(opts = {}) {
    this.rng = opts.rng || new PCG32((opts.seed != null ? opts.seed : 1) >>> 0, 0x5bf03635);

    /* ---- ① 性格生成（每只猫不同，IND 基因锁定） ---- */
    const origin = opts.origin && ORIGINS[opts.origin] ? opts.origin : this.rng.pick(ORIGIN_KEYS);
    const o = ORIGINS[origin];

    const ind = clamp(Math.round(o.lo + this.rng.nextFloat() * o.span), 0, 100);
    const cur0 = clamp(Math.round(this.rng.nextRange(DIMS.cur.init[0], DIMS.cur.init[1])), DIMS.cur.min, DIMS.cur.max);
    const sec0 = clamp(Math.round(this.rng.nextRange(DIMS.sec.init[0], DIMS.sec.init[1])), DIMS.sec.min, DIMS.sec.max);
    const vit0 = clamp(Math.round(this.rng.nextRange(DIMS.vit.init[0], DIMS.vit.init[1])), DIMS.vit.min, DIMS.vit.max);
    const secCap = secCapFor(ind, sec0, this.rng.nextFloat());
    // IND 漂移目标（极慢随机游走；clamp 在初始值 ±8）
    const indTarget = clamp(ind + this.rng.nextGaussian(0, 2.5), ind - DIMS.ind.driftClamp, ind + DIMS.ind.driftClamp);

    const P = {
      aff: DIMS.aff.init,
      ind,
      cur: cur0,
      sec: Math.min(sec0, secCap),
      vit: vit0,
      /* RUL-5 暖机模型 */
      affPeak: DIMS.aff.init,
      warmth: 100,
      catchUpRemaining: 0,
      /* 基因 / 锁定量 */
      secCap,
      indBase: ind,
      indTarget,
      origin,
    };
    if (opts.personality) {
      for (const k of Object.keys(opts.personality)) {
        if (opts.personality[k] != null && k !== 'ene') P[k] = opts.personality[k];
      }
    }

    // `ene` 兼容别名（不可枚举 → 不污染 JSON / spread）。规范字段是 vit。
    let _p = P;
    Object.defineProperty(_p, 'ene', {
      enumerable: false, configurable: true,
      get() { return this.vit; },
      set(v) { this.vit = clamp(v, DIMS.vit.min, DIMS.vit.max); },
    });
    this.personality = _p;

    /* ---- ② 生理需求（与性格分离） ---- */
    const ne = {
      hng: Math.round(this.rng.nextRange(NEEDS.hng.init[0], NEEDS.hng.init[1])),
      hyd: Math.round(this.rng.nextRange(NEEDS.hyd.init[0], NEEDS.hyd.init[1])),
      toi: Math.round(this.rng.nextRange(NEEDS.toi.init[0], NEEDS.toi.init[1])),
      ene: Math.round(this.rng.nextRange(NEEDS.ene.init[0], NEEDS.ene.init[1])),
    };
    if (opts.needs) Object.assign(ne, opts.needs);
    this.needs = ne;

    /* ---- ③ 状态机运行时 ---- */
    this._seed = opts.seed != null ? opts.seed : 1;
    this.name = opts.name || '';
    this.genes = { origin };
    this.gameMinutes = opts.gameMinutes != null ? wrapMinutes(opts.gameMinutes) : wrapMinutes(7 * 60);
    this.state = 'BOOT';                 // 构造后由 _boot() 解析
    this.prevState = null;
    this.sourceState = 'REST';           // HIDE / REJECT 的返回态
    this.stateEnteredAtGameMin = this.gameMinutes;
    this.anchorId = ANCHORS.includes(opts.anchorId) ? opts.anchorId : 'rug';
    this.lastInteractionGameMin = NO_INTERACTION;

    this.transient = null;               // { name, remaining, returnTo, data }
    this.reject = { active: false, level: 0, endsAt: 0 };
    this.pendingBehavior = null;
    this.transitRemaining = 0;
    this.refractory = Object.create(null);   // behavior → 剩余不应期 tick 数
    this.restAccumMin = 0;                   // 静卧累计（驱动 GROOM 冲动）
    this.exploreProgress = 0;
    this.discoveredAnchors = ['rug', 'sofa', 'bowl', 'catbed'];
    this.knownAnchors = ANCHORS.slice();

    /* ---- ④ 环境 / 存在感（由 update(ctx) 注入） ---- */
    // busy = 玩家正在与之互动（共处收益暂停，避免"边摸边涨 SEC"双重计数）
    this.presence = { online: true, idleSeconds: 0, busy: false };
    this.env = { bowlFood: true, bowlWater: true, windowNoise: false, toyVisible: false, visible: true, light: 0.6 };
    this.timeScale = 12;
    this._bootWarmup = !!opts.bootWarmup;

    /* ---- ⑤ 微表情目标（CatExpressionTarget，4 Hz 更新，渲染帧缓动） ---- */
    this.expression = {
      earBack: 0, earForward: 0, eyeSquint: 0, eyeWide: 0,
      mouthOpen: 0, mouthFlehmen: 0, browKnit: 0, faceSquash: 0,
      pupilDilate: 0.5, tailPose: 'Tail_Horizontal_Neutral',
      earYawL: 0, earYawR: 0, whiskerSpread: 0.9,
      breathAmp: 1.0, breathRate: 0.55,
      tailWaveAmp: 0.5, tailWaveFreq: 0.4,
    };

    /* ---- ⑥ 调试 / 事件 ---- */
    this.behaviorCandidates = [];
    this.lastArbitration = null;
    this._listeners = Object.create(null);
    this._earAck = 0;      // Ear-ack 剩余秒
    this._pendingEvents = [];

    /* ---- ⑦ 分层 tick（复用 core/tick.js） ---- */
    this.scheduler = new TickScheduler(TICK);
    this.scheduler
      .on('MICRO', () => this._tickMicro())
      .on('NEEDS', () => this._tickNeeds())
      .on('BEHAVIOR', () => this._tickBehavior())
      .on('PERSONALITY', () => this._tickPersonality());

    this._boot();
  }

  /* ========================================================================
   * 启动定位（GDD §3.4 BOOT）
   * ====================================================================== */
  _boot() {
    const wantWarmup = !!this._bootWarmup;
    if (wantWarmup) {
      this._enterTransient('WARMUP', 3.0, 'REST');
    } else {
      this._enter('REST', { force: true });
    }
    this._computeExpression();
  }

  /* ========================================================================
   * 对外只读便捷量
   * ====================================================================== */
  get affPeak() { return this.personality.affPeak; }
  set affPeak(v) { this.personality.affPeak = clamp(v, 0, 100); }
  get warmth() { return this.personality.warmth; }
  set warmth(v) { this.personality.warmth = clamp(v, 0, 100); }
  get catchUpRemaining() { return this.personality.catchUpRemaining; }
  set catchUpRemaining(v) { this.personality.catchUpRemaining = Math.max(0, v | 0); }

  /** AFF_eff = AFF × (0.5 + 0.5·SEC/100) × (1.15 − IND/250)（GDD §3.3.1 ②③） */
  get affEff() {
    const p = this.personality;
    return p.aff * (0.5 + 0.5 * p.sec / 100) * (1.15 - p.ind / 250);
  }
  /** CUR_eff = CUR × (0.4 + 0.6·SEC/100)（GDD §3.3.1 ③） */
  get curEff() { return this.personality.cur * (0.4 + 0.6 * this.personality.sec / 100); }
  /** 亲密度阶段（陌生/习惯/信任/亲近/羁绊） */
  get affectionStage() { return affectionStage(this.personality.aff); }
  /** 当前昼夜 5 档（固定钟点，与 4 档 timeSlot 隔离 —— GDD R-3） */
  get circadian() { return circadianBand(this.gameMinutes); }
  /** TRANSIT 是否可被打断（不可，除非 HIDE） */
  get isTransitioning() { return this.state === 'TRANSIT'; }
  get isSleeping() { return this.state === 'SLEEP_DEEP' || this.state === 'SLEEP_LIGHT'; }
  get eneMax() { return eneMax(this.personality.vit); }

  /* ========================================================================
   * 事件
   * ====================================================================== */
  on(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
    return this;
  }
  _emit(type, payload) {
    const arr = this._listeners[type];
    if (arr) for (let i = 0; i < arr.length; i++) arr[i](payload);
    this._pendingEvents.push({ type, payload });
    if (this._pendingEvents.length > 128) this._pendingEvents.shift();
  }
  /** 取出并清空排队事件（供主循环转发到 event-bus） */
  drainEvents() { const e = this._pendingEvents; this._pendingEvents = []; return e; }

  /* ========================================================================
   * 主入口：update(dt, ctx)
   * ====================================================================== */

  /**
   * 推进固定步长。dt 恒为 core/tick.js 的 STEP_SECONDS（真实秒）。
   *
   * @param {number} dt  真实秒
   * @param {object} [ctx]
   * @param {number} [ctx.timeScale]             会话内游戏时间倍率（默认沿用上次）
   * @param {number} [ctx.gameMinutes]           外部权威游戏钟（给了则覆盖内部推算）
   * @param {object} [ctx.presence]              { online, idleSeconds }
   * @param {object} [ctx.env]                   { bowlFood, bowlWater, windowNoise, toyVisible, visible, light }
   * @returns {CatState} this
   */
  update(dt, ctx = {}) {
    if (ctx.timeScale != null) this.timeScale = ctx.timeScale;
    if (ctx.presence) Object.assign(this.presence, ctx.presence);
    if (ctx.env) Object.assign(this.env, ctx.env);
    if (ctx.gameMinutes != null) this.gameMinutes = wrapMinutes(ctx.gameMinutes);

    // 内部游戏钟推算（若外部未提供权威值）
    if (ctx.gameMinutes == null) {
      this.gameMinutes = wrapMinutes(this.gameMinutes + (dt / 60) * this.timeScale);
    }
    this.gameMinutesPerSecond = this.timeScale / 60;

    // 瞬时态与 Ear-ack 的实时计时
    if (this._earAck > 0) this._earAck = Math.max(0, this._earAck - dt);
    if (this.transient) {
      this.transient.remaining -= dt;
      if (this.transient.remaining <= 0) this._endTransient();
    }
    if (this.state === 'TRANSIT') {
      this.transitRemaining -= dt;
      if (this.transitRemaining <= 0) this._finishTransit();
    }
    if (this.reject.active) {
      this.reject.endsAt -= dt;
      if (this.reject.endsAt <= 0) {
        this.reject.active = false;
        if (this.state === 'REJECT') this._enter(returnStateOf(this.sourceState));
      }
    }

    // 不应期倒计时
    for (const b of Object.keys(this.refractory)) {
      const v = this.refractory[b] - dt;
      if (v <= 0) delete this.refractory[b]; else this.refractory[b] = v;
    }

    // 分层 tick
    this.scheduler.advance(dt);
    return this;
  }

  /* ========================================================================
   * 分层 tick 回调
   * ====================================================================== */

  /** 微表情 4 Hz：耳/尾/瞳/胡须目标值（只写数值，渲染帧再缓动） */
  _tickMicro() {
    const p = this.personality, n = this.needs, st = this.state;
    const e = this.expression;
    const secN = p.sec / 100, curN = p.cur / 100, vitN = p.vit / 100;
    const jitter = this.rng.nextGaussian(0, 0.03);

    let earBack = 0, earForward = 0, eyeSquint = 0, eyeWide = 0;
    let mouthOpen = 0, mouthFlehmen = 0, browKnit = 0, faceSquash = 0;
    let whiskerSpread = 0.9, breathAmp = 1.0, breathRate = 0.55;
    let tailWaveAmp = 0.5, tailWaveFreq = 0.4, pupilBase = 0.55;
    let tailPose = 'Tail_Horizontal_Neutral';

    switch (st) {
      case 'SLEEP_DEEP':
        earBack = 0.22; eyeSquint = 1.0; breathAmp = 1.5; breathRate = 0.32;
        tailWaveAmp = 0.10; tailWaveFreq = 0.12; whiskerSpread = 0.7;
        pupilBase = 0.20; tailPose = 'Tail_Wrap_Self';
        break;
      case 'SLEEP_LIGHT':
        earBack = 0.10; eyeSquint = 0.8; breathAmp = 1.25; breathRate = 0.42;
        tailWaveAmp = 0.18; tailWaveFreq = 0.18; whiskerSpread = 0.8;
        pupilBase = 0.30; tailPose = 'Tail_Wrap_Self';
        break;
      case 'REST':
        earForward = 0.12 + 0.3 * curN; eyeSquint = 0.18 - 0.12 * vitN;
        breathAmp = 1.0; breathRate = 0.5; tailWaveAmp = 0.35 + 0.25 * vitN;
        whiskerSpread = 0.9; pupilBase = 0.5; tailPose = 'Tail_Horizontal_Neutral';
        break;
      case 'GROOM':
        earForward = 0.05; eyeSquint = 0.55; mouthOpen = 0.15; faceSquash = 0.2;
        breathAmp = 0.9; breathRate = 0.7; tailWaveAmp = 0.2; whiskerSpread = 0.85;
        pupilBase = 0.42; tailPose = 'Tail_Wrap_Self';
        break;
      case 'EAT':
        eyeSquint = 0.5; mouthOpen = 0.25; faceSquash = 0.15; whiskerSpread = 1.0;
        breathAmp = 0.85; breathRate = 0.8; tailWaveAmp = 0.25;
        pupilBase = 0.6; tailPose = 'Tail_Horizontal_Neutral';
        break;
      case 'DRINK':
        eyeSquint = 0.45; mouthOpen = 0.1; whiskerSpread = 0.95;
        breathAmp = 0.85; breathRate = 0.85; tailWaveAmp = 0.2;
        pupilBase = 0.55; tailPose = 'Tail_Horizontal_Neutral';
        break;
      case 'EXPLORE':
        earForward = 0.35 + 0.3 * curN; eyeWide = 0.25; eyeSquint = 0.1;
        pupilBase = 0.8; whiskerSpread = 1.0; breathAmp = 1.1; breathRate = 0.75;
        tailWaveAmp = 0.65; tailWaveFreq = 0.8; browKnit = 0.1;
        tailPose = 'Tail_Swishing_Slow';
        break;
      case 'PLAY':
        earForward = 0.3; eyeWide = 0.45; eyeSquint = 0.05; mouthOpen = 0.2;
        pupilBase = 0.95; whiskerSpread = 1.1; breathAmp = 1.2; breathRate = 1.0;
        tailWaveAmp = 0.9; tailWaveFreq = 1.3; tailPose = 'Tail_Up_Hook';
        break;
      case 'WATCH_WINDOW':
        earForward = 0.25; eyeSquint = 0.35; pupilBase = 0.75; whiskerSpread = 0.95;
        breathAmp = 0.9; breathRate = 0.5; tailWaveAmp = 0.3; tailWaveFreq = 0.25;
        tailPose = 'Tail_Swishing_Slow';
        break;
      case 'HIDE':
        earBack = 0.85; eyeSquint = 0.25; eyeWide = 0.5; whiskerSpread = 0.5;
        faceSquash = 0.2; breathAmp = 0.7; breathRate = 0.9;
        tailWaveAmp = 0.12; tailPose = 'Tail_Low_Tuck';
        break;
      case 'SEEK_ATTENTION':
        earForward = 0.35; eyeSquint = 0.15; eyeWide = 0.1; mouthOpen = 0.15;
        pupilBase = 0.9; whiskerSpread = 1.0; breathAmp = 1.05; breathRate = 0.7;
        tailWaveAmp = 0.75; tailWaveFreq = 0.9; tailPose = 'Tail_Up_Hook';
        break;
      case 'PETTED':
        earForward = 0.2; eyeSquint = 0.85 - 0.4 * secN; browKnit = 0;
        mouthOpen = p.aff > 60 ? 0.1 : 0; whiskerSpread = 0.95;
        breathAmp = 1.05; breathRate = 0.45; tailWaveAmp = 0.5; tailWaveFreq = 0.35;
        pupilBase = 0.75; tailPose = 'Tail_Up_Hook';
        break;
      case 'ALERT':
        earBack = 0.1; earForward = 0.55; eyeWide = 0.75; eyeSquint = 0;
        browKnit = 0.3; whiskerSpread = 1.15; breathAmp = 1.15; breathRate = 1.1;
        tailWaveAmp = 0.9; tailWaveFreq = 1.6; pupilBase = 0.95;
        tailPose = 'Tail_Puffed_Bottlebrush';
        break;
      case 'REJECT':
        earBack = 0.55 + 0.35 * (this.reject.level >= 4 ? 1 : 0);
        eyeSquint = 0.3; eyeWide = 0.3; browKnit = 0.4; faceSquash = 0.25;
        whiskerSpread = 0.7; breathAmp = 1.0; breathRate = 1.0;
        tailWaveAmp = 1.0; tailWaveFreq = 1.8;
        tailPose = this.reject.level >= 4 ? 'Tail_Flicking_Fast' : 'Tail_Low_Tuck';
        break;
      case 'TRANSIT':
        earForward = 0.2; eyeSquint = 0.1; whiskerSpread = 0.95;
        breathAmp = 1.0; breathRate = 0.85; tailWaveAmp = 0.55; tailWaveFreq = 0.6;
        tailPose = p.aff > 60 ? 'Tail_Up_Hook' : 'Tail_Horizontal_Neutral';
        break;
      case 'WARMUP':
        earForward = 0.25; eyeSquint = 0.25; whiskerSpread = 0.95;
        breathAmp = 1.05; breathRate = 0.6; tailWaveAmp = 0.4;
        tailPose = 'Tail_Up_Hook';
        break;
      default:
        tailPose = 'Tail_Horizontal_Neutral';
    }

    // 低精力的猫：整体降低微表情幅度与呼吸频率（美术 §4.7）
    const vitScale = 0.6 + 0.4 * vitN;
    e.earBack = clamp(earBack * vitScale + jitter, 0, 1);
    e.earForward = clamp(earForward * vitScale + jitter, 0, 1);
    e.eyeSquint = clamp(eyeSquint + jitter, 0, 1);
    e.eyeWide = clamp(eyeWide, 0, 1);
    e.mouthOpen = clamp(mouthOpen, 0, 1);
    e.mouthFlehmen = clamp(mouthFlehmen, 0, 1);
    e.browKnit = clamp(browKnit, 0, 1);
    e.faceSquash = clamp(faceSquash, 0, 1);
    e.whiskerSpread = clamp(whiskerSpread, 0, 1.4);
    e.breathAmp = breathAmp;
    e.breathRate = breathRate * (0.75 + 0.5 * vitN);
    e.tailWaveAmp = tailWaveAmp * vitScale;
    e.tailWaveFreq = tailWaveFreq;
    e.tailPose = tailPose;

    // Ear-ack（GDD §4.4.1）：耳偏转 15–25°，0.4 s 后归零，纯骨骼
    if (this._earAck > 0) {
      const k = this._earAck / 0.4;
      e.earYawL = 0.35 * k;
      e.earYawR = 0.35 * k;
    } else {
      e.earYawL = 0;
      e.earYawR = 0;
    }

    // 瞳孔 = 光线响应 × 情绪响应（GDD §4.5 的 shader 语义，在数值层先合成）
    const lightComp = 1 - clamp(this.env.light, 0, 1) * 0.6;
    e.pupilDilate = clamp(pupilBase * lightComp + 0.15 * (1 - p.sec / 100), 0.15, 1.4);
  }

  /** 生理需求 1 Hz（ENE 走 GDD §3.3.1 的 ENE_max / ENE_rec，其余按游戏小时线性衰减） */
  _tickNeeds() {
    const n = this.needs, p = this.personality;
    const gmin = this.timeScale / 60;      // 每个真实秒推进的游戏分钟
    const dHours = (gmin / 60);            // 每个真实秒推进的游戏小时

    // HNG / HYD / TOI 线性衰减
    n.hng = clamp(n.hng - NEED_DECAY_PER_GAME_HOUR.hng * dHours, 0, 100);
    n.hyd = clamp(n.hyd - NEED_DECAY_PER_GAME_HOUR.hyd * dHours, 0, 100);
    n.toi = clamp(n.toi - NEED_DECAY_PER_GAME_HOUR.toi * dHours, 0, 100);

    // 进食 / 饮水恢复
    if (this.state === 'EAT') {
      n.hng = clamp(n.hng + EAT_RATE * gmin, 0, 100);
      if (n.hng >= EAT_SATIETY || !this.env.bowlFood) this._requestTransition('REST');
    } else if (this.state === 'DRINK') {
      n.hyd = clamp(n.hyd + DRINK_RATE * gmin, 0, 100);
      if (n.hyd >= DRINK_SATIETY || !this.env.bowlWater) this._requestTransition('REST');
    }

    // ENE
    const emax = eneMax(p.vit);
    if (this.state === 'SLEEP_DEEP' || this.state === 'SLEEP_LIGHT') {
      const rec = eneRecovery(p.vit) * (this.state === 'SLEEP_DEEP' ? 1.0 : 0.55);
      n.ene = clamp(n.ene + rec * gmin, 0, emax);
    } else {
      // 清醒净消耗：与离线快照的 awakeBias=0.62 自洽（见 AWAKE_BIAS 注释）
      const rec = eneRecovery(p.vit);
      const factor = AWAKE_DRAIN_FACTOR[this.state] != null ? AWAKE_DRAIN_FACTOR[this.state] : AWAKE_DRAIN_DEFAULT;
      const drain = rec * (AWAKE_BIAS / (1 - AWAKE_BIAS)) * factor;
      n.ene = clamp(n.ene - drain * gmin, 0, emax);
    }

    // 猫砂盆：不惩罚、不生病，仅记录一次"使用"（GDD §3.3.1 需求表：不导致死亡/生病）
    if (n.toi <= TOI_FLOOR_RESET) {
      n.toi = 100;
      this._emit('litter', { gameMin: this.gameMinutes });
    }
    this._emit('needs', { ...n, gameMin: this.gameMinutes });
  }

  /** 行为决策 0.5 Hz —— 仲裁（§3.3.3）+ 转移（§3.4） */
  _tickBehavior() {
    if (this.transient) return;              // 瞬时态期间不重新仲裁
    if (this.state === 'TRANSIT') return;

    // —— E1-2 固定仲裁顺序：① HIDE 硬门控 ② 生理驱动 ③ 性格加权
    if (this.personality.sec < 30) {
      if (this.state !== 'HIDE') this._requestTransition('HIDE');
      return;
    }
    if (this.needs.ene < 30 && this.personality.sec >= 20) {
      if (this.state !== 'SLEEP_DEEP') this._requestTransition('SLEEP_DEEP');
      return;
    }
    // E1-7：互斥需求优先级 ENE > HNG > HYD > TOI
    if (this.needs.hng < 20 && this.env.bowlFood) {
      if (this.state !== 'EAT') this._requestTransition('EAT');
      return;
    }
    if (this.needs.hyd < 20 && this.env.bowlWater) {
      if (this.state !== 'DRINK') this._requestTransition('DRINK');
      return;
    }
    if (this.needs.hng < 35 && this.env.bowlFood && this.state !== 'EAT'
        && this.rng.nextFloat() < 0.5) {
      this._requestTransition('EAT');
      return;
    }

    // —— 性格加权仲裁
    const cand = this._computeCandidates();
    this.behaviorCandidates = cand;
    if (!cand.length) {
      if (this.state !== 'REST') this._requestTransition('REST');
      return;
    }

    // 最小驻留保护（用游戏分钟，×12 下仍正确 —— architecture §5.2）
    const dwellMin = (BEHAVIOR_TABLE[this.state] ? BEHAVIOR_TABLE[this.state].dwell : 2) * ARBITER.minDwellRatio;
    const since = this.gameMinutes - this.stateEnteredAtGameMin;
    // 睡眠段做**硬**驻留：GDD「睡眠周期推进（45 min 后 roll）」——避免猫每 90 真实秒就醒一次
    const sleepLock = (this.state === 'SLEEP_DEEP' || this.state === 'SLEEP_LIGHT');
    if (since < dwellMin) {
      if (sleepLock) return;                       // 硬锁：睡够一个周期再评估
      if (this.state !== 'WARMUP' && this.state !== 'PETTED' && this._keepCurrent(cand)) return;
    }

    // 选择
    const choice = this._select(cand);
    if (!choice) return;
    if (choice.name === this.state) {
      this.lastArbitration = { ...choice, kept: true };
      return;                                  // 继续当前行为
    }
    this.lastArbitration = choice;
    this._requestTransition(choice.name, choice.anchor);
  }

  /** 计算候选行为的 U 值（零外部依赖，纯计算） */
  _computeCandidates() {
    const p = this.personality, n = this.needs, env = this.env;
    const affEff = this.affEff, curEff = this.curEff;
    const band = this.circadian;
    const out = [];

    for (const b of WEIGHTED_BEHAVIORS) {
      const spec = BEHAVIOR_TABLE[b];
      const k = spec.k;
      // P(b) —— 性格项
      const pTerm = 1
        + (k.aff || 0) * (affEff - 50) / 50
        + (k.ind || 0) * (p.ind - 50) / 50
        + (k.cur || 0) * (curEff - 50) / 50
        + (k.sec || 0) * (p.sec - 50) / 50
        + (k.vit || 0) * (p.vit - 50) / 50;
      const P = clamp(pTerm, 0.10, 4.00);

      // D(b) —— 生理驱动门控
      let D = 1.0;
      if (b === 'SLEEP_DEEP') D = clamp((70 - n.ene) / 50, 0, 1.6);
      else if (b === 'SLEEP_LIGHT') D = clamp((90 - n.ene) / 60, 0, 1.5);
      else if (b === 'EXPLORE' || b === 'PLAY') D = clamp((n.ene - 25) / 50, 0, 1.6);
      else if (b === 'EAT') D = clamp((80 - n.hng) / 45, 0, 2.2);
      else if (b === 'DRINK') D = clamp((80 - n.hyd) / 45, 0, 2.2);
      else if (b === 'SEEK_ATTENTION') D = this.presence.online ? 1.0 : 0.0;

      // C(b) —— 昼夜节律（5 档固定钟点）
      const C = (CIRCADIAN[band] && CIRCADIAN[band][b] != null) ? CIRCADIAN[band][b] : 1.0;

      // 前置条件（GDD §3.4）
      if (!this._precondition(b, curEff)) continue;

      // H —— 滞后
      const H = (b === this.state) ? ARBITER.hysteresis : 1.0;
      // N —— 不应期
      const N = this.refractory[b] ? ARBITER.refractoryMul : 1.0;

      const U = spec.base * P * D * C * H * N;
      out.push({ name: b, base: spec.base, P, D, C, H, N, U, anchor: this._pickAnchor(b) });
    }
    return out;
  }

  /** 行为前置条件（返回 false 则该行为不进候选） */
  _precondition(b, curEff) {
    const n = this.needs, env = this.env;
    switch (b) {
      case 'EAT': return env.bowlFood && n.hng < 70;
      case 'DRINK': return env.bowlWater && n.hyd < 65;
      case 'EXPLORE': return n.ene >= 55 && curEff >= 35 && this._hasUnexploredAnchor();
      case 'PLAY': return n.ene >= 55 && (env.toyVisible || this.personality.cur >= 45);
      case 'WATCH_WINDOW':
        return env.windowNoise || (this.circadian === 'dusk' && this.personality.ind >= 55);
      case 'SEEK_ATTENTION':
        return this.presence.online && this.presence.idleSeconds >= 45
          && this.affEff >= 35 && this.personality.ind <= 75;
      case 'GROOM': return this.restAccumMin >= 8 || this.rng.nextFloat() < 0.12;
      case 'HIDE': return this.personality.sec < 45;   // 低 SEC 才会主动躲
      case 'SLEEP_DEEP': return n.ene < 75;
      case 'SLEEP_LIGHT': return n.ene < 90;
      case 'REST': return true;                        // E1-6：REST 永远可选中
      default: return true;
    }
  }

  _hasUnexploredAnchor() {
    for (const a of this.knownAnchors) {
      if (!this.discoveredAnchors.includes(a)) return true;
    }
    return false;
  }

  /** 若当前状态仍可维持（驻留窗口内且权重未被大幅超越），返回 true */
  _keepCurrent(cand) {
    const cur = cand.find((c) => c.name === this.state);
    if (!cur) return false;
    let max = 0;
    for (const c of cand) if (c.U > max) max = c.U;
    // 当前状态的 U 不低于最大值的 70% → 继续（滞后已在 P 里体现）
    return cur.U >= max * 0.70;
  }

  /** 选择算法：raw → sharp^1.6 → 0.92/0.08 混合 → 加权抽取 */
  _select(cand) {
    let sum = 0;
    for (const c of cand) sum += c.U;
    if (!(sum > 0)) {
      // E1-6 fallback
      if (typeof console !== 'undefined') console.warn('[CatState] 所有行为 U 值异常，fallback REST');
      return { name: 'REST', anchor: this._pickAnchor('REST') };
    }
    let sharpSum = 0;
    for (const c of cand) { c.raw = c.U / sum; c.sharp = Math.pow(c.raw, ARBITER.sharpenExponent); sharpSum += c.sharp; }
    if (!(sharpSum > 0)) sharpSum = 1;
    const N = cand.length;
    for (const c of cand) {
      c.prob = 0.92 * (c.sharp / sharpSum) + ARBITER.surpriseQuota / N;
    }
    // 归一（0.92 + 0.08 = 1，但浮点误差兜底）
    let psum = 0; for (const c of cand) psum += c.prob;
    if (psum > 0) for (const c of cand) c.prob /= psum;

    // 加权抽取（禁止 Math.random —— RUL-9）
    let r = this.rng.nextFloat();
    for (const c of cand) {
      r -= c.prob;
      if (r <= 0) return { name: c.name, anchor: c.anchor, prob: c.prob, U: c.U };
    }
    const last = cand[cand.length - 1];
    return { name: last.name, anchor: last.anchor, prob: last.prob, U: last.U };
  }

  /** 行为 → 锚点（性格调制：高 SEC 偏好居中/低位，低 SEC 偏好角落/高位，高 IND 偏好远端高位） */
  _pickAnchor(behavior) {
    const list = BEHAVIOR_ANCHORS[behavior] || ['rug'];
    const p = this.personality;
    const secN = p.sec / 100, indN = p.ind / 100;
    // 低机动性行为强烈偏好留在原地，避免"为静卧横穿半个房间"的无意义 TRANSIT
    const stationary = STATIONARY_BEHAVIORS.has(behavior);
    const stayBias = (stationary && list.includes(this.anchorId)) ? 6.0 : 1.0;
    const chosen = this.rng.weighted(list, (a) => {
      const pos = ANCHOR_POS[a] || { x: 0, y: 0, z: 0 };
      const far = Math.min(1, Math.hypot(pos.x, pos.z) / 3.0);   // 离房间中心的距离
      const high = Math.min(1, pos.y / 1.1);                     // 高度
      let w = 1.0;
      // 低 SEC → 躲角落、选高位封闭处
      w += (1 - secN) * (far * 1.4 + high * 0.6);
      // 高 SEC → 选居中低位
      w += secN * ((1 - far) * 0.8 + (1 - high) * 0.4);
      // 高 IND → 选远端高位（自信的独处，GDD §3.3.2 组合 6）
      w += indN * (far * 0.6 + high * 0.8);
      // 高 VIT → 略偏探索向
      w += (p.vit / 100) * far * 0.3;
      // 未探索锚点略加权（发现驱动）
      if (!this.discoveredAnchors.includes(a)) w += 0.35 * (p.cur / 100);
      // 原地偏好
      if (a === this.anchorId) w *= stayBias;
      return Math.max(0.05, w);
    });
    return ANCHORS.includes(chosen) ? chosen : list[0];
  }

  /* ========================================================================
   * 状态转移
   * ====================================================================== */

  /**
   * 请求转移到目标状态。若目标需要更换锚点 → 先走 TRANSIT（唯一跨域枢纽）。
   * TRANSIT 不可被打断（除非 HIDE —— GDD §3.4）。
   */
  _requestTransition(target, anchorOverride) {
    const anchor = anchorOverride || this._pickAnchor(target);
    const needMove = ANCHOR_POS[anchor] && anchor !== this.anchorId;
    const spec = BEHAVIOR_TABLE[this.state];

    if (needMove && target !== 'TRANSIT') {
      // 记不应期：刚做完的行为权重 ×0.20（离开时记，进入时清零）
      if (spec) this.refractory[this.state] = ARBITER.refractoryTicks;
      this.pendingBehavior = target;
      this.pendingAnchor = anchor;
      const speed = walkSpeedFor(this.personality.aff);
      const d = Math.hypot(
        (ANCHOR_POS[anchor].x || 0) - (ANCHOR_POS[this.anchorId] ? ANCHOR_POS[this.anchorId].x : 0),
        (ANCHOR_POS[anchor].z || 0) - (ANCHOR_POS[this.anchorId] ? ANCHOR_POS[this.anchorId].z : 0),
      );
      this.transitRemaining = clamp(d / speed, 0.6, 8.0);
      this.sourceState = this.state;
      this._enter('TRANSIT');
      this._emit('transit', { to: anchor, behavior: target, seconds: this.transitRemaining });
      return;
    }
    this._enter(target);
  }

  _finishTransit() {
    this.anchorId = this.pendingAnchor && ANCHORS.includes(this.pendingAnchor) ? this.pendingAnchor : this.anchorId;
    if (!this.discoveredAnchors.includes(this.anchorId)) {
      this.discoveredAnchors.push(this.anchorId);
      // 发现隐藏锚点：CUR +10（GDD §3.3.1 ③）
      this.personality.cur = clamp(this.personality.cur + 10, DIMS.cur.min, 100);
      this._emit('discover', { anchorId: this.anchorId, curDelta: 10 });
    }
    const b = this.pendingBehavior || 'REST';
    this.pendingBehavior = null;
    this.pendingAnchor = null;
    this._enter(b);
  }

  _enter(state, { force = false } = {}) {
    if (!ALL_STATES.includes(state)) {
      if (typeof console !== 'undefined') console.warn('[CatState] 非法状态', state);
      return;
    }
    if (this.state === state && !force) return;
    const prev = this.state;

    // GROOM 累积重置 / 不应期清理
    if (state !== 'REST' && state !== 'SLEEP_LIGHT' && state !== 'SLEEP_DEEP') this.restAccumMin = 0;

    this.prevState = prev;
    this.state = state;
    this.stateEnteredAtGameMin = this.gameMinutes;
    // 仅 HIDE 自动记录来源（用于退出时返回）；REJECT 的来源由调用方显式设置
    if (state === 'HIDE') this.sourceState = prev || 'REST';

    // 与 interaction.js 的 streak/拒绝升级联动：大状态变化 → 通知外部
    this._emit('state', {
      state, prevState: prev, anchorId: this.anchorId,
      gameMin: this.gameMinutes, domain: STATE_DOMAIN[state] || null,
    });
  }

  /** 瞬时态（ALERT / WARMUP）：超时后回到 returnTo */
  _enterTransient(name, seconds, returnTo) {
    this.transient = { name, remaining: seconds, returnTo: returnTo || this.state || 'REST' };
    this._enter(name, { force: true });
  }

  _endTransient() {
    const ret = this.transient ? this.transient.returnTo : 'REST';
    this.transient = null;
    this._enter(ALL_STATES.includes(ret) ? ret : 'REST');
  }

  /* ========================================================================
   * 外部事件接口（供 interaction / snapshot / time 调用）
   * ====================================================================== */

  /** 噪声事件 → ALERT（高优先级，可打断一切非 HIDE 状态） */
  onNoise() {
    if (this.state === 'HIDE' || this.state === 'SLEEP_DEEP') return this;
    if (this.state === 'TRANSIT') return this;      // TRANSIT 不可被打断（除非 HIDE）
    this._enterTransient('ALERT', 1.2, this.sourceState || 'REST');
    return this;
  }

  /** 惊吓事件 → HIDE（最高优先级，可打断一切，含 PETTED —— GDD §3.4） */
  onStartle() {
    this.personality.sec = clamp(this.personality.sec - 4, DIMS.sec.min, this.personality.secCap);
    this._enter('HIDE');
    this._emit('startle', { gameMin: this.gameMinutes });
    return this;
  }

  /**
   * 消费一次互动判定结果（interaction.js 的输出）。
   * @param {object} r interaction.resolve() 的返回值
   * @returns {CatState} this
   */
  applyInteractionResult(r) {
    if (!r) return this;
    const verb = r.verb;
    const outcome = r.outcome;

    // 环境类动作不触发猫的三态（place/toggle/scoop/refill/capture/journal/wait）
    const environmental = ['place', 'toggle', 'scoop', 'refill', 'capture', 'journal', 'wait'];
    if (environmental.includes(verb) || outcome === 'applied' || outcome === 'blocked') {
      if (verb === 'place') {
        // 环境大改：CUR +5（每日上限 +15）、SEC −3、触发 ALERT
        this.personality.cur = clamp(this.personality.cur + 5, DIMS.cur.min, 100);
        this.personality.sec = clamp(this.personality.sec - 3, DIMS.sec.min, this.personality.secCap);
        this.onNoise();
      }
      if (verb === 'refill') { this.env.bowlFood = true; this.env.bowlWater = true; }
      return this;
    }

    // 数值落账（AFF / SEC / CUR / VIT / warmth / catchUp —— 全部走 warmth.js 的权威公式）
    const p = this.personality;
    const t = this.rng.nextFloat();     // 追赶倍率的确定性插值（RUL-9）
    const next = warmthApplyInteraction({
      aff: p.aff, affPeak: p.affPeak, warmth: p.warmth, sec: p.sec,
      cur: p.cur, vit: p.vit, catchUpRemaining: p.catchUpRemaining,
    }, { verb, outcome, level: r.level, t });

    p.aff = next.aff; p.affPeak = next.affPeak; p.warmth = next.warmth;
    p.sec = clamp(next.sec, DIMS.sec.min, p.secCap);
    p.cur = clamp(next.cur, DIMS.cur.min, 100);
    p.vit = clamp(next.vit, DIMS.vit.min, DIMS.vit.max);
    p.catchUpRemaining = next.catchUpRemaining;
    // 安全地板：AFF 永不低于历史峰值的 60%
    const floor = affectionFloor(p.affPeak);
    if (p.aff < floor) p.aff = floor;

    // Ear-ack（无反应时）—— 由 interaction.js 决定是否发生
    if (r.earAck) this._earAck = 0.4;
    this.lastInteractionGameMin = this.gameMinutes;

    // 三态 → 状态机
    if (outcome === 'accept') {
      if (verb === 'pet' || verb === 'brush') {
        this._enter('PETTED');           // 持续态，玩家松手后回 REST（由 endPetting() 收尾）
      } else if (verb === 'tease') {
        this._requestTransition('PLAY');
      } else if (verb === 'offer') {
        this.needs.hng = clamp(this.needs.hng + 18, 0, 100);
        this._requestTransition('EAT');
      } else if (verb === 'lure') {
        this._enterTransient('ALERT', 0.8, this.sourceState || 'REST');
      }
      this.env.toyVisible = true;
    } else if (outcome === 'reject') {
      const lvl = r.level || 1;
      // REJECT 的来源态：被摸时满足度耗尽 → 回 REST；否则回被打断前的状态
      const src = (this.state === 'PETTED' || TRANSIENT_STATES.includes(this.state) || this.state === 'TRANSIT')
        ? 'REST' : this.state;
      this.sourceState = src;
      this.reject.active = true;
      this.reject.level = lvl;
      this.reject.endsAt = 0.6;         // GDD：REJECT 0.6 s
      this._enter('REJECT', { force: true });
      // R6 → 直接躲；R5 且低 SEC 也躲。其余级别在 0.6 s 后由 update() 自动回来源态。
      if (lvl >= 6 || (lvl >= 5 && this.personality.sec < 40)) this._enter('HIDE');
      this.personality.sec = clamp(this.personality.sec - (lvl >= 5 ? 3 : 0.5), DIMS.sec.min, this.personality.secCap);
    }
    // outcome === 'none' 时状态不变（猫继续做原来的事 —— 附录 C 的 NoResponse_Continue）

    this._emit('interaction', { verb, outcome, level: r.level || 0, deltas: next.deltas });
    return this;
  }

  /** 抚摸持续态收尾：玩家松手 / 满足度耗尽 → 回 REST（或按 level 转 REJECT） */
  endPetting(forcedRejectLevel = 0) {
    if (forcedRejectLevel > 0) {
      this.sourceState = 'REST';
      this.reject.active = true;
      this.reject.level = forcedRejectLevel;   // 满足度耗尽 → 强制 R4（GDD §3.4）
      this.reject.endsAt = 0.6;
      this._enter('REJECT', { force: true });
    } else if (this.state === 'PETTED') {
      this._enter('REST');
    }
    return this;
  }

  /** 「等 Wait」的累积（GDD §4.3.4） */
  applyWaiting(gameMinutes) {
    const p = this.personality;
    const n = warmthApplyWaiting({ aff: p.aff, affPeak: p.affPeak, warmth: p.warmth, sec: p.sec }, gameMinutes);
    p.aff = n.aff; p.affPeak = n.affPeak; p.warmth = n.warmth;
    p.sec = clamp(n.sec, DIMS.sec.min, p.secCap);
    return this;
  }

  /** 共处累积：warmth 上升（在线 +2.5/游戏分钟，追赶期 ×2） */
  applyCoPresence(gameMinutes) {
    const r = accrueCoPresence({ warmth: this.personality.warmth }, gameMinutes, this.personality.catchUpRemaining);
    this.personality.warmth = r.warmth;
    return this;
  }

  /**
   * 吸收离线结算结果（snapshot.js settleOffline 的返回）。
   * @param {object} settled { needs, personality, catchUpRemaining, tier }
   * @param {number} [offlineDays] 离线天数；≥2 天则进入场景先走 WARMUP（GDD §3.4 BOOT）
   */
  applyOfflineSettlement(settled, offlineDays = 0) {
    if (!settled) return this;
    if (settled.needs) {
      for (const k of Object.keys(this.needs)) {
        if (settled.needs[k] != null) this.needs[k] = settled.needs[k];
      }
      this.needs.ene = clamp(this.needs.ene, 0, this.eneMax);
    }
    if (settled.personality) {
      const q = settled.personality;
      const p = this.personality;
      if (q.aff != null) p.aff = q.aff;
      if (q.affPeak != null) p.affPeak = q.affPeak;
      if (q.warmth != null) p.warmth = q.warmth;
      if (q.sec != null) p.sec = clamp(q.sec, DIMS.sec.min, p.secCap);
      if (q.cur != null) p.cur = clamp(q.cur, DIMS.cur.min, 100);
      if (q.vit != null) p.vit = clamp(q.vit, DIMS.vit.min, DIMS.vit.max);
    }
    this.catchUpRemaining = settled.catchUpRemaining != null ? settled.catchUpRemaining : this.catchUpRemaining;
    const floor = affectionFloor(this.personality.affPeak);
    if (this.personality.aff < floor) this.personality.aff = floor;

    // 离线 ≥2 天 → 重逢反应（走 WARMUP 瞬时态，3.0 s）
    if (offlineDays >= 2) this._enterTransient('WARMUP', 3.0, 'REST');
    return this;
  }

  /* ========================================================================
   * 性格结算 1/60 Hz（每 60 真实秒）
   * ====================================================================== */

  /**
   * ⚠️ 时间基准说明（有意为之的解读，见交付报告）：
   *   GDD §3.3.1 写「共处 +0.25/分钟（SEC）」。若按**游戏分钟**计，×12 压缩下
   *   单次会话（上限 6 游戏小时）可累积 +90 点 SEC，一个「中（周）」量级的维度
   *   会被一次会话打满，直接破坏 G2（D30 信任 / D90 亲近）曲线。
   *   故此处 SEC 共处按**真实分钟**计（+0.25/真实分钟），CUR 新鲜度按**游戏日**计。
   *   这是对 GDD 字面的一处保守解读，已在交付报告中显式登记。
   */
  _tickPersonality() {
    const p = this.personality;
    const realMin = TICK.PERSONALITY / 60;          // = 1 分钟
    const gameDays = (TICK.PERSONALITY * this.timeScale) / 60 / 1440;

    // SEC：共处（无互动）增长，clamp 在个体天花板内
    if (this.presence.online && !this.presence.busy) {
      p.sec = clamp(p.sec + 0.25 * realMin, DIMS.sec.min, p.secCap);
    }
    // E1-8：SEC 触底 → 「静默陪伴」通道 +1.5/分钟（正常速率的 6 倍），唯一修复路径
    if (p.sec <= DIMS.sec.min + 0.01 && this.presence.online) {
      p.sec = clamp(p.sec + 1.5 * realMin, DIMS.sec.min, p.secCap);
    }

    // CUR：环境新鲜度衰减 −1.5/游戏日，下限 25
    p.cur = clamp(p.cur - 1.5 * gameDays, DIMS.cur.min, 100);

    // IND：基因锁定，±0.5/月、clamp 在初始值 ±8 内
    const driftBudget = DIMS.ind.driftPerMonth * (gameDays / 30);
    if (driftBudget > 0) {
      const d = clamp(p.indTarget - p.ind, -driftBudget, driftBudget);
      p.ind = clamp(p.ind + d, p.indBase - DIMS.ind.driftClamp, p.indBase + DIMS.ind.driftClamp);
    }

    // VIT：规律互动 +1.0/周、长期无互动 −0.5/周（GDD §3.3.1 ⑤）
    const weekFrac = gameDays / 7;
    if (weekFrac > 0) {
      const sinceInteract = this.gameMinutes - this.lastInteractionGameMin;
      const recentlyActive = sinceInteract < 1440;        // 游戏 1 天内有互动
      const vitWeek = recentlyActive ? 1.0 : -0.5;
      p.vit = clamp(p.vit + vitWeek * weekFrac, DIMS.vit.min, DIMS.vit.max);
    }

    this._emit('personality', {
      aff: p.aff, ind: p.ind, cur: p.cur, sec: p.sec, vit: p.vit,
      warmth: p.warmth, affPeak: p.affPeak,
      gameMin: this.gameMinutes,
    });
  }

  /** 供主循环直接调用：重置静卧累计（每次离开静卧态时由 _enter 处理，此处为外部钩子） */
  noteRestAccumulated(gameMinutes) {
    if (this.state === 'REST' || this.state === 'SLEEP_LIGHT' || this.state === 'SLEEP_DEEP') {
      this.restAccumMin += gameMinutes;
    }
    return this;
  }

  /** 计算一次情绪目标（构造后 / 读档后手动刷新） */
  refreshExpression() { this._tickMicro(); return this; }

  /** 内部别名：微表情目标刷新（与 4 Hz 层同一套逻辑） */
  _computeExpression() { this._tickMicro(); }

  /* ========================================================================
   * 存档
   * ====================================================================== */

  /**
   * 序列化（纯 JSON 安全对象）。
   * 形状与 core/save.js 的 MIGRATIONS v1→v2 及 systems/snapshot.js 的读取一致：
   *   affPeak / warmth 必须位于 personality 内。
   */
  snapshot() {
    const p = this.personality;
    return {
      schema: 2,
      name: this.name,
      genes: { ...this.genes },
      personality: {
        aff: p.aff, ind: p.ind, cur: p.cur, sec: p.sec, vit: p.vit,
        affPeak: p.affPeak, warmth: p.warmth,
        catchUpRemaining: p.catchUpRemaining,
        secCap: p.secCap, indBase: p.indBase, indTarget: p.indTarget, origin: p.origin,
      },
      needs: { hng: this.needs.hng, hyd: this.needs.hyd, toi: this.needs.toi, ene: this.needs.ene },
      state: this.state === 'REJECT' ? (this.sourceState || 'REST') : this.state,
      prevState: this.prevState === 'REJECT' ? null : this.prevState,
      sourceState: this.sourceState,
      anchorId: this.anchorId,
      discoveredAnchors: this.discoveredAnchors.slice(),
      gameMinutes: this.gameMinutes,
      stateEnteredAtGameMin: this.stateEnteredAtGameMin,
      restAccumMin: this.restAccumMin,
    };
  }

  /**
   * 反序列化（load 时校验 + clamp —— GDD §3.4 硬性要求「load 时必须 validate schema」）。
   * 任何字段坏掉都不得导致状态卡死或数值溢出。
   */
  restore(obj) {
    if (!obj || typeof obj !== 'object') return this;
    const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const p = this.personality;

    if (obj.name != null) this.name = String(obj.name).slice(0, 24);
    if (obj.genes && typeof obj.genes === 'object') this.genes = { ...this.genes, ...obj.genes };

    const q = obj.personality || {};
    p.aff = clamp(num(q.aff, p.aff), 0, 100);
    p.affPeak = clamp(num(q.affPeak, Math.max(p.affPeak, p.aff)), 0, 100);
    p.warmth = clamp(num(q.warmth, p.warmth), 0, 100);
    p.secCap = clamp(num(q.secCap, p.secCap), 10, 100);
    p.indBase = clamp(num(q.indBase, p.indBase), 0, 100);
    p.ind = clamp(num(q.ind, p.ind), p.indBase - DIMS.ind.driftClamp, p.indBase + DIMS.ind.driftClamp);
    p.indTarget = clamp(num(q.indTarget, p.indTarget), 0, 100);
    p.cur = clamp(num(q.cur, p.cur), DIMS.cur.min, 100);
    p.sec = clamp(num(q.sec, p.sec), DIMS.sec.min, p.secCap);
    p.vit = clamp(num(q.vit, p.vit), DIMS.vit.min, DIMS.vit.max);
    p.catchUpRemaining = Math.max(0, num(q.catchUpRemaining, 0) | 0);
    if (q.origin && ORIGINS[q.origin]) p.origin = q.origin;
    // 地板保护（RUL-5）
    const floor = affectionFloor(p.affPeak);
    if (p.aff < floor) p.aff = floor;
    if (p.aff > p.affPeak) p.affPeak = p.aff;

    const n = obj.needs || {};
    this.needs.hng = clamp(num(n.hng, this.needs.hng), 0, 100);
    this.needs.hyd = clamp(num(n.hyd, this.needs.hyd), 0, 100);
    this.needs.toi = clamp(num(n.toi, this.needs.toi), 0, 100);
    this.needs.ene = clamp(num(n.ene, this.needs.ene), 0, this.eneMax);

    this.anchorId = ANCHORS.includes(obj.anchorId) ? obj.anchorId : 'rug';
    if (Array.isArray(obj.discoveredAnchors)) {
      this.discoveredAnchors = obj.discoveredAnchors.filter((a) => ANCHORS.includes(a));
    }
    if (!this.discoveredAnchors.includes(this.anchorId)) this.discoveredAnchors.push(this.anchorId);

    // 状态：非法 → REST（保证无终止态、无卡死）
    const st = obj.state;
    this.state = ALL_STATES.includes(st) ? st : 'REST';
    if (this.state === 'TRANSIT' || this.state === 'REJECT') this.state = 'REST';
    this.prevState = ALL_STATES.includes(obj.prevState) ? obj.prevState : null;
    this.sourceState = ALL_STATES.includes(obj.sourceState) ? obj.sourceState : 'REST';
    this.gameMinutes = wrapMinutes(num(obj.gameMinutes, this.gameMinutes));
    this.stateEnteredAtGameMin = num(obj.stateEnteredAtGameMin, this.gameMinutes);
    this.restAccumMin = clamp(num(obj.restAccumMin, 0), 0, 600);

    this.transient = null;
    this.reject = { active: false, level: 0, endsAt: 0 };
    this.pendingBehavior = null;
    this.refractory = Object.create(null);
    this._computeExpression();
    return this;
  }

  /** 兼容别名：save.js 侧若按 serialize/deserialize 调用亦可 */
  serialize() { return this.snapshot(); }
  deserialize(o) { return this.restore(o); }
}

export default CatState;
