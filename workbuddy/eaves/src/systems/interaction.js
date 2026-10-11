/**
 * interaction.js —— 互动动词与三态反应系统
 *
 * 依据：RUL-6、GDD §4.3（三态判定与保底）、§4.4（6 级拒绝）、§4.5（冷却与饱和）、
 *       §4.6（8 条边缘情况）、UX §6（四层反馈）。
 *
 * 三态：接受 / 拒绝 / 无反应。
 *
 * 判定公式（GDD §4.3.2）：
 *   P_accept = clamp(A_base(V) × M_state(V,S) × M_aff × M_sec × M_sat × M_ind, 0.05, 0.85)
 *   P_reject = clamp((1 − P_accept) × R_ratio, 0.02, 0.45)
 *   P_none   = 1 − P_accept − P_reject
 *
 * 保底（RUL-6，与 20% 拒绝率不可分割）：
 *   软保底：第 (streak+1) 次互动时 P_none −= min(0.15 × streak, 0.45)
 *   硬保底：streak >= 4 → P_none = 0，第 5 次必定是接受或拒绝
 *
 * "无反应" ≠ 什么都不发生（RUL-6 ③）：
 *   L1 物件层反馈 100% 必给（UX §6.2 —— 玩家必须能区分"它不理我"和"我没点到"）
 *   L3 猫层 Ear-ack 70% 概率（P = 0.85 − IND/300）
 *
 * 本文件零浏览器依赖，可被 Node 直接引入。
 */

import { clamp } from '../core/easing.js';

/* ============================ 动词表 ============================ */

export const VERBS = {
  PET: 'pet',
  BRUSH: 'brush',
  LURE: 'lure',
  OFFER: 'offer',
  TEASE: 'tease',
  SCOOP: 'scoop',
  REFILL: 'refill',
  PLACE: 'place',
  TOGGLE: 'toggle',
  NAME: 'name',
  WAIT: 'wait',
  CAPTURE: 'capture',
  JOURNAL: 'journal',
};

/** 表 4.3.2-A · 动词基础接受率 */
export const A_BASE = {
  tease: 0.62,   // 最高——玩耍是猫的本能需求
  pet: 0.52,     // 基准
  brush: 0.48,   // 略低——梳理是"侵入性"动作
  lure: 0.42,    // 低——叫猫是出了名的没用
  offer: 0.38,   // 最低——"提供"不是"喂"，猫现在不想吃就不吃
  scoop: 0.90,   // 清理猫砂盆不是对猫的互动，猫几乎不干预
  refill: 0.90,
  place: 1.00,   // 摆放家具是对环境的动作，不走三态
  toggle: 1.00,
  name: 0.50,
};

/**
 * 表 4.3.2-B · 状态 × 动词修正 M_state
 * 读法：猫在静卧时最容易被互动（1.25–1.50），在躲避/深睡时最难（0.22–0.35）。
 * 玩家必须学会读猫的状态再动手。
 */
export const M_STATE = {
  pet: {
    SLEEP_DEEP: 0.35, SLEEP_LIGHT: 0.65, REST: 1.50, GROOM: 0.95, EAT: 0.60,
    DRINK: 0.60, EXPLORE: 0.80, PLAY: 0.70, WATCH_WINDOW: 1.20, HIDE: 0.30,
    SEEK_ATTENTION: 1.60, PETTED: 1.40, ALERT: 0.70, TRANSIT: 0.55, WARMUP: 1.10,
  },
  tease: {
    SLEEP_DEEP: 0.25, SLEEP_LIGHT: 0.45, REST: 1.40, GROOM: 0.80, EAT: 0.50,
    DRINK: 0.50, EXPLORE: 1.30, PLAY: 1.65, WATCH_WINDOW: 1.00, HIDE: 0.25,
    SEEK_ATTENTION: 1.70, PETTED: 0.90, ALERT: 0.60, TRANSIT: 0.50, WARMUP: 1.00,
  },
  offer: {
    SLEEP_DEEP: 0.30, SLEEP_LIGHT: 0.50, REST: 1.25, GROOM: 0.75, EAT: 1.35,
    DRINK: 0.90, EXPLORE: 0.90, PLAY: 0.45, WATCH_WINDOW: 0.85, HIDE: 0.30,
    SEEK_ATTENTION: 1.45, PETTED: 1.10, ALERT: 0.60, TRANSIT: 0.55, WARMUP: 1.05,
  },
  lure: {
    SLEEP_DEEP: 0.30, SLEEP_LIGHT: 0.55, REST: 1.35, GROOM: 0.85, EAT: 0.75,
    DRINK: 0.75, EXPLORE: 1.05, PLAY: 1.15, WATCH_WINDOW: 1.15, HIDE: 0.30,
    SEEK_ATTENTION: 1.60, PETTED: 1.20, ALERT: 0.65, TRANSIT: 0.50, WARMUP: 1.15,
  },
  brush: {
    SLEEP_DEEP: 0.22, SLEEP_LIGHT: 0.50, REST: 1.45, GROOM: 1.60, EAT: 0.55,
    DRINK: 0.55, EXPLORE: 0.60, PLAY: 0.45, WATCH_WINDOW: 0.95, HIDE: 0.25,
    SEEK_ATTENTION: 1.55, PETTED: 1.50, ALERT: 0.55, TRANSIT: 0.45, WARMUP: 1.00,
  },
  name: {
    SLEEP_DEEP: 0.45, SLEEP_LIGHT: 0.70, REST: 1.10, GROOM: 0.95, EAT: 0.70,
    DRINK: 0.70, EXPLORE: 0.95, PLAY: 0.85, WATCH_WINDOW: 1.00, HIDE: 0.55,
    SEEK_ATTENTION: 1.30, PETTED: 1.20, ALERT: 0.80, TRANSIT: 0.60, WARMUP: 1.10,
  },
};

/** 动词默认 M_state（未列出的动词不参与三态） */
export const DEFAULT_M_STATE = 1.0;

/** L1 硬冷却（秒）—— GDD §4.5 */
export const COOLDOWN_MS = {
  pet: 1500,
  brush: 3000,
  tease: 2000,
  offer: 5000,
  lure: 2500,
  scoop: 10000,
  refill: 10000,
  place: 1000,
  toggle: 500,
  name: 1000,
};

/** 全局输入预算：每分钟最多计 12 次互动输入（GDD §4.5 / E2-3） */
export const INPUT_BUDGET_PER_MIN = 12;
/** 软饱和窗口（毫秒） */
export const SATURATION_WINDOW_MS = 120000;
/** streak 重置：距上次互动超过 30 秒 */
export const STREAK_RESET_MS = 30000;
/** 硬保底阈值：连续 4 次无反应后第 5 次必定有反应 */
export const HARD_PITY_STREAK = 4;
/** 软保底：P_none -= min(0.15 × streak, 0.45) */
export const SOFT_PITY_STEP = 0.15;
export const SOFT_PITY_CAP = 0.45;

/** 需要长按的动词（毫秒） */
export const HOLD_REQUIRED_MS = { pet: 400, brush: 1200 };

/* ============================ 概率计算 ============================ */

/**
 * 三态概率。
 * @param {object} ctx
 * @param {string} ctx.verb
 * @param {string} ctx.state 猫当前状态
 * @param {object} ctx.p { aff, ind, sec }
 * @param {number} ctx.n 该动词在 120s 内的第 n 次
 * @param {number} ctx.streak 连续无反应次数
 * @param {boolean} ctx.forceReject 强制给拒绝（如 E2-2 深睡中触发硬保底）
 * @returns {{pAccept:number, pReject:number, pNone:number, hardPity:boolean, softPity:number}}
 */
export function triStateProbabilities({ verb, state, p, n = 1, streak = 0, forceReject = false }) {
  const aBase = A_BASE[verb] != null ? A_BASE[verb] : 0.5;
  const table = M_STATE[verb];
  const mState = table ? (table[state] != null ? table[state] : DEFAULT_M_STATE) : DEFAULT_M_STATE;

  const mAff = 0.6 + (p.aff || 0) / 125;                 // AFF 0→0.60, 100→1.40
  const mSec = 0.7 + (p.sec || 0) / 333;                 // SEC 0→0.70, 100→1.00
  const mSat = 1 / (1 + 0.35 * Math.max(0, n - 1));      // 软饱和 L2
  const mInd = 1.15 - (p.ind || 0) / 500;                // IND 0→1.15, 100→0.95

  let pAccept = clamp(aBase * mState * mAff * mSec * mSat * mInd, 0.05, 0.85);

  const rRatio = clamp(0.10 + (p.sec || 0) / 400 + (p.ind || 0) / 700, 0.08, 0.45);
  let pReject = clamp((1 - pAccept) * rRatio, 0.02, 0.45);
  let pNone = Math.max(0, 1 - pAccept - pReject);

  // —— 软保底
  const softPity = Math.min(SOFT_PITY_STEP * streak, SOFT_PITY_CAP);
  let removed = Math.min(softPity, pNone);
  pNone -= removed;
  if (removed > 0) {
    if (forceReject) pReject += removed;
    else pAccept += removed;
  }

  // —— 硬保底（RUL-6）：连续 4 次无反应后第 5 次必定有反应
  const hardPity = streak >= HARD_PITY_STREAK;
  if (hardPity && pNone > 0) {
    if (forceReject) pReject += pNone;
    else pAccept += pNone;
    pNone = 0;
  }

  // 归一化防御
  const sum = pAccept + pReject + pNone;
  if (sum > 0) { pAccept /= sum; pReject /= sum; pNone /= sum; }

  return { pAccept, pReject, pNone, hardPity, softPity: removed, forceReject, rRatio };
}

/**
 * 拒绝级别（1–6，只升不降 —— GDD §4.4 说明 2）。
 * 低 SEC 的猫从 R4 起步（一惊一乍），高 SEC 的猫从 R1 起步（先懒得理你）。
 */
export function rejectLevelFor({ sec, sessionRejects, verbRepeats, forced = null }) {
  if (forced != null) return clamp(forced, 1, 6);
  let base;
  if (sec < 30) base = 4;
  else if (sec < 50) base = 3;
  else if (sec < 70) base = 2;
  else base = 1;
  return clamp(base + (sessionRejects || 0), 1, 6);
}

export const REJECT_LEVEL_NAME = {
  1: 'R1 无视',
  2: 'R2 闪避',
  3: 'R3 走开',
  4: 'R4 甩尾',
  5: 'R5 拍击',
  6: 'R6 躲避',
};

/* ============================ 互动系统 ============================ */

/**
 * 互动系统的运行时状态机外围：冷却、饱和窗口、输入预算、streak、拒绝升级。
 * 全部为纯数据 + 同步方法，可在 Node 中做确定性测试。
 */
export class InteractionSystem {
  constructor({ now = 0 } = {}) {
    this.now = now;
    this.cooldownUntil = Object.create(null);   // verb → 解禁时间戳(ms)
    this.verbTimes = Object.create(null);       // verb → [时间戳]（120s 滑动窗口）
    this.inputTimes = [];                       // 全局输入预算（60s 窗口）
    this.streak = 0;                            // 连续无反应次数
    this.lastVerb = null;
    this.lastTime = -1e9;
    this.lastState = null;
    this.sessionRejects = 0;                    // 本次会话拒绝次数（驱动级别升级）
    this.rejectLevel = 1;
    this.petSatisfaction = 0;                   // L3 满足度累计（秒）
    this.petSatisfactionCap = 30;
    this.petting = false;
    this.totalInputs = 0;
    this.lastResult = null;
    this.log = [];
  }

  setNow(ms) { this.now = ms; }

  /** 通知系统猫的大状态发生了变化（会重置 streak 与拒绝升级） */
  onStateChanged(state) {
    if (state !== this.lastState) {
      this.lastState = state;
      this.streak = 0;          // 猫切换大状态 → streak 重置
      this.sessionRejects = 0;  // 拒绝升级也随之归零（新的一轮忍耐）
      this.rejectLevel = 1;
    }
  }

  /** L3 满足度上限：20 + AFF×0.5 + (80−IND)×0.4 秒 */
  static satisfactionCap(p) {
    return 20 + (p.aff || 0) * 0.5 + Math.max(0, 80 - (p.ind || 0)) * 0.4;
  }

  _prune(nowMs) {
    const cut120 = nowMs - SATURATION_WINDOW_MS;
    for (const v of Object.keys(this.verbTimes)) {
      const arr = this.verbTimes[v];
      let i = 0;
      while (i < arr.length && arr[i] < cut120) i++;
      if (i > 0) arr.splice(0, i);
    }
    const cut60 = nowMs - 60000;
    let j = 0;
    while (j < this.inputTimes.length && this.inputTimes[j] < cut60) j++;
    if (j > 0) this.inputTimes.splice(0, j);
  }

  /** 该动词在 120s 窗口内的第 n 次（供软饱和使用） */
  countInWindow(verb, nowMs) {
    const arr = this.verbTimes[verb];
    return arr ? arr.length + 1 : 1;
  }

  /**
   * 检查输入是否被吞，并给出原因。
   * @returns {null | {reason:string, feedbackStrength:number}}
   *   被吞时 L1 反馈强度降至 40%（UX §6.3），但仍然给。
   */
  checkBlocked(verb, nowMs) {
    const cd = COOLDOWN_MS[verb];
    if (cd != null && nowMs < (this.cooldownUntil[verb] || 0)) {
      return { reason: 'cooldown', feedbackStrength: 0.4 };
    }
    if (this.inputTimes.length >= INPUT_BUDGET_PER_MIN) {
      return { reason: 'budget', feedbackStrength: 0.4 };
    }
    return null;
  }

  /**
   * 执行一次互动判定。
   *
   * @param {object} ctx
   * @param {string} ctx.verb
   * @param {string} ctx.state      猫当前状态
   * @param {object} ctx.personality { aff, ind, sec, cur, vit }
   * @param {object} ctx.rng        种子化 RNG（必须有 nextFloat()）
   * @param {number} [ctx.nowMs]
   * @param {object} [ctx.env]      { bowlFilled, hasFood, ... } 前置条件
   * @returns {object} 结果
   */
  resolve(ctx) {
    const nowMs = ctx.nowMs != null ? ctx.nowMs : this.now;
    const verb = ctx.verb;
    const p = ctx.personality || {};
    const state = ctx.state || 'REST';
    const rng = ctx.rng;
    this.now = nowMs;
    this._prune(nowMs);

    // —— 前置条件（可失败，不可阻塞：UX 原则 3）
    if (ctx.env && ctx.env.precondition === false) {
      return this._finish({
        verb, state, outcome: 'blocked', reason: 'precondition',
        objectFeedback: true, feedbackStrength: 0.4, earAck: false, level: 0, nowMs,
      });
    }

    const blocked = this.checkBlocked(verb, nowMs);
    if (blocked) {
      return this._finish({
        verb, state, outcome: 'blocked', reason: blocked.reason,
        objectFeedback: true, feedbackStrength: blocked.feedbackStrength, earAck: false, level: 0, nowMs,
      });
    }

    // —— streak 重置条件（GDD §4.3.2）
    if (verb !== this.lastVerb) this.streak = 0;
    if (nowMs - this.lastTime > STREAK_RESET_MS) this.streak = 0;

    // —— 不走三态的动词（对环境的操作）
    if (verb === VERBS.PLACE || verb === VERBS.TOGGLE || verb === VERBS.SCOOP || verb === VERBS.REFILL
      || verb === VERBS.CAPTURE || verb === VERBS.JOURNAL || verb === VERBS.WAIT) {
      this._markInput(verb, nowMs);
      return this._finish({
        verb, state, outcome: 'applied', reason: 'environment',
        objectFeedback: true, feedbackStrength: 1.0, earAck: false, level: 0, nowMs,
      });
    }

    const n = this.countInWindow(verb, nowMs);
    // E2-2：深睡中触发硬保底 → 给"拒绝"而非"接受"（保底承诺的是"有反馈"，不是"有好事"）
    const forceReject = (state === 'SLEEP_DEEP' && this.streak >= HARD_PITY_STREAK);
    const probs = triStateProbabilities({ verb, state, p, n, streak: this.streak, forceReject });

    let outcome = 'none';
    const r = rng ? rng.nextFloat() : 0.5;
    if (r < probs.pAccept) outcome = 'accept';
    else if (r < probs.pAccept + probs.pReject) outcome = 'reject';
    else outcome = 'none';

    // E2-4：HIDE 且视野不可见 → 强制无反应，且不给 Ear-ack（它确实没听到）
    const hidden = (state === 'HIDE' && ctx.env && ctx.env.visible === false);
    if (hidden) outcome = 'none';

    let level = 0;
    if (outcome === 'reject') {
      this.rejectLevel = Math.max(this.rejectLevel,
        rejectLevelFor({ sec: p.sec, sessionRejects: this.sessionRejects, verbRepeats: n - 1 }));
      level = this.rejectLevel;
      this.sessionRejects++;
    }

    // —— streak 更新
    if (outcome === 'none') this.streak++;
    else this.streak = 0;

    // —— L3 反馈：Ear-ack 70%（P = 0.85 − IND/300）；硬保底那一次必定发生
    let earAck = false;
    if (outcome === 'none' && !hidden) {
      const pEar = 0.85 - (p.ind || 0) / 300;
      earAck = probs.hardPity ? true : (rng ? rng.nextFloat() < pEar : true);
    }

    this._markInput(verb, nowMs);
    this.lastVerb = verb;
    this.lastTime = nowMs;

    return this._finish({
      verb, state, outcome, level, probs, n, streak: this.streak,
      objectFeedback: true, feedbackStrength: 1.0, earAck, nowMs,
      hidden: !!hidden,
    });
  }

  _markInput(verb, nowMs) {
    const cd = COOLDOWN_MS[verb];
    if (cd != null) this.cooldownUntil[verb] = nowMs + cd;
    if (!this.verbTimes[verb]) this.verbTimes[verb] = [];
    this.verbTimes[verb].push(nowMs);
    this.inputTimes.push(nowMs);
    this.totalInputs++;
  }

  _finish(result) {
    this.lastResult = result;
    this.log.push(result);
    if (this.log.length > 64) this.log.shift();
    return result;
  }

  /** 抚摸持续态（L3 满足度）维护：每帧调用，返回是否应当强制拒绝 */
  updatePetting(active, p, dtSeconds) {
    if (active && !this.petting) {
      this.petting = true;
      this.petSatisfaction = 0;
      this.petSatisfactionCap = InteractionSystem.satisfactionCap(p);
    } else if (!active && this.petting) {
      this.petting = false;
    }
    if (!this.petting) return false;
    this.petSatisfaction += dtSeconds;
    // 满足度耗尽 → 强制转 REJECT（R4）
    return this.petSatisfaction >= this.petSatisfactionCap;
  }

  serialize() {
    return {
      streak: this.streak,
      sessionRejects: this.sessionRejects,
      rejectLevel: this.rejectLevel,
      lastState: this.lastState,
      totalInputs: this.totalInputs,
    };
  }

  restore(d) {
    if (!d) return this;
    this.streak = d.streak || 0;
    this.sessionRejects = d.sessionRejects || 0;
    this.rejectLevel = d.rejectLevel || 1;
    this.lastState = d.lastState || null;
    this.totalInputs = d.totalInputs || 0;
    return this;
  }
}

export default {
  VERBS, A_BASE, M_STATE, COOLDOWN_MS, INPUT_BUDGET_PER_MIN,
  HARD_PITY_STREAK, triStateProbabilities, rejectLevelFor, InteractionSystem,
  REJECT_LEVEL_NAME, HOLD_REQUIRED_MS,
};
