/**
 * warmth.js —— 亲密度「暖机」模型
 *
 * 依据：RUL-5（裁决 D-4 的落地）、GDD §3.3.1 ①、沙盘 §6.5。
 *
 * 🚨 核心承诺：**亲密度 AFF 本体永不主动衰减。**
 *    旧方案「长期不在线 −2/周」在数值上无论怎么包装，本质都是惩罚——
 *    玩家离开 → 猫对你的感情减少。这与 U4「正向奖励、不做惩罚」在精神上冲突。
 *
 * 新语义：玩家离开 → 猫对你的「记忆温度」凉了 → 回来待几分钟就热起来了。
 *    AFF      亲密度本体，只涨（除非 warmth 低于阈值才缓降，且有地板）
 *    AFF_peak 历史最高亲密度，单调递增，只涨不跌
 *    warmth   记忆温度，离线降、共处升
 *
 * 参数（GDD §3.3.1）：
 *    衰减（唯一路径）：if warmth < 15 → AFF -= 0.25 × 离线天数
 *                      AFF = max(AFF, max(10, AFF_peak × 0.6))
 *    warmth 离线：  −6.0 / 天
 *    warmth 在线：  +2.5 / 分钟（共处）+ 互动加成（+7 ~ +12 / 次接受）
 *    追赶机制：    回归后前 3 次正向互动，warmth 恢复 ×2、AFF 增益 ×1.6–2.5
 *
 * 沙盘验证：停玩 90 天 AFF 90 → 69.2，回归 30 天恢复到 80（恢复度 89%）。
 *
 * 本文件零浏览器依赖，可被 Node 直接引入。
 */

import { clamp } from '../core/easing.js';

export const WARMTH = {
  /** 离线衰减（点/天） */
  offlinePerDay: 6.0,
  /** 共处增长（点/游戏分钟） */
  onlinePerMin: 2.5,
  /** 温度阈值：低于此值 AFF 才开始缓降 */
  threshold: 15,
  /** AFF 缓降速率（点/离线天） */
  affDecayPerOfflineDay: 0.25,
  /** AFF 地板 = 历史峰值的 60% */
  affFloorRatio: 0.6,
  /** AFF 绝对地板 */
  affAbsoluteFloor: 10,
  /** 追赶窗口：回归后前 N 次正向互动享受重逢加成 */
  catchUpInteractions: 3,
  /** 追赶期 warmth 恢复倍率 */
  catchUpWarmthMul: 2.0,
  /** 追赶期 AFF 增益倍率区间 */
  catchUpAffMulRange: [1.6, 2.5],
  /** 上限 */
  warmthMax: 100,
  affMax: 100,
};

/** 计算 AFF 地板：max(10, AFF_peak × 0.6) */
export function affectionFloor(affPeak) {
  return Math.max(WARMTH.affAbsoluteFloor, affPeak * WARMTH.affFloorRatio);
}

/**
 * 离线结算：warmth 下降 + （仅在 warmth 低于阈值时）AFF 缓降。
 *
 * @param {object} p { aff, affPeak, warmth }
 * @param {number} offlineDays
 * @param {object} [rng] 可选，用于给衰减加一点个体差异（不传则纯确定性）
 * @returns {{aff:number, affPeak:number, warmth:number, decayed:boolean, floorHit:boolean, affDelta:number, warmthDelta:number}}
 */
export function settleOfflineWarmth(p, offlineDays, rng = null) {
  const days = Math.max(0, offlineDays || 0);
  const warmthBefore = clamp(p.warmth, 0, WARMTH.warmthMax);
  const warmthAfter = clamp(warmthBefore - WARMTH.offlinePerDay * days, 0, WARMTH.warmthMax);

  let aff = clamp(p.aff, 0, WARMTH.affMax);
  const affPeak = clamp(p.affPeak != null ? p.affPeak : p.aff, 0, WARMTH.affMax);
  const floor = affectionFloor(affPeak);

  let decayed = false;
  let floorHit = false;
  if (warmthAfter < WARMTH.threshold && days > 0) {
    // 唯一的 AFF 衰减路径
    const delta = WARMTH.affDecayPerOfflineDay * days;
    const target = aff - delta;
    if (target < floor) {
      aff = floor;              // ★ 地板：绝不再往下
      floorHit = true;
    } else {
      aff = target;
    }
    decayed = true;
  }
  // AFF 永不低于地板（即便历史存档被外部改坏）
  if (aff < floor) { aff = floor; floorHit = true; }
  // AFF 永远不会因为本次结算而超过历史峰值以上（离线不产生正向）
  if (aff > affPeak) aff = affPeak;

  return {
    aff,
    affPeak,
    warmth: warmthAfter,
    decayed,
    floorHit,
    affDelta: aff - p.aff,
    warmthDelta: warmthAfter - warmthBefore,
  };
}

/**
 * 在线共处累积：warmth 上升。
 * @param {object} p { warmth, catchUpRemaining }
 * @param {number} gameMinutes 本次累积的共处游戏分钟
 */
export function accrueCoPresence(p, gameMinutes, catchUpRemaining = 0) {
  const mul = catchUpRemaining > 0 ? WARMTH.catchUpWarmthMul : 1;
  const before = clamp(p.warmth, 0, WARMTH.warmthMax);
  const after = clamp(before + WARMTH.onlinePerMin * gameMinutes * mul, 0, WARMTH.warmthMax);
  return { warmth: after, warmthDelta: after - before };
}

/**
 * 互动的 warmth 增量（GDD §4.3.4）。
 * @param {string} outcome 'accept' | 'reject' | 'none'
 * @param {string} verb
 * @param {number} catchUpRemaining
 */
export function interactionWarmthDelta(outcome, verb, catchUpRemaining = 0) {
  const base = INTERACTION_WARMTH[verb] || { accept: 6, reject: -1, none: 1 };
  let d = base[outcome] != null ? base[outcome] : 0;
  if (d > 0 && catchUpRemaining > 0) d *= WARMTH.catchUpWarmthMul;
  return d;
}

/** GDD §4.3.4 的 warmth 列 */
const INTERACTION_WARMTH = {
  pet: { accept: 8, reject: -2, none: 1 },
  brush: { accept: 7, reject: -2, none: 1 },
  tease: { accept: 10, reject: -1, none: 1 },
  offer: { accept: 12, reject: 2, none: 2 },
  lure: { accept: 4, reject: -1, none: 0.5 },
  scoop: { accept: 2, reject: 0, none: 0 },
  refill: { accept: 2, reject: 0, none: 0 },
};

/**
 * 追赶倍率：回归后前 3 次正向互动，AFF 增益 ×1.6–2.5。
 * @param {number} catchUpRemaining 剩余追赶次数
 * @param {number} t 0–1 的插值系数（由调用方用种子化 RNG 给出，保证确定性）
 */
export function catchUpAffMultiplier(catchUpRemaining, t = 0.5) {
  if (catchUpRemaining <= 0) return 1;
  const [lo, hi] = WARMTH.catchUpAffMulRange;
  // 剩余次数越少，加成越弱（平滑收尾）
  const fade = catchUpRemaining / WARMTH.catchUpInteractions;
  return 1 + (lo + (hi - lo) * t - 1) * fade;
}

/**
 * 应用一次互动的全部人格数值变化。
 *
 * @param {object} p { aff, affPeak, warmth, sec, cur, vit, catchUpRemaining }
 * @param {object} ev { verb, outcome, level, t }  t 用于追赶倍率的确定性插值
 * @returns {object} 新的 { aff, affPeak, warmth, ... } 与 delta 明细
 */
export function applyInteraction(p, ev) {
  const verb = ev.verb;
  const outcome = ev.outcome;
  const t = ev.t != null ? ev.t : 0.5;
  const catchUp = p.catchUpRemaining || 0;

  const affBefore = p.aff;
  const affPeakBefore = p.affPeak != null ? p.affPeak : p.aff;
  const warmthBefore = p.warmth;
  const secBefore = p.sec;

  // —— AFF（GDD §4.3.4）
  let affDelta = 0;
  const affTable = INTERACTION_AFF[verb];
  if (affTable) {
    let d = affTable[outcome] != null ? affTable[outcome] : 0;
    if (d > 0) d *= catchUpAffMultiplier(catchUp, t);
    affDelta = d;
  }
  // —— SEC
  let secDelta = 0;
  const secTable = INTERACTION_SEC[verb];
  if (secTable && secTable[outcome] != null) secDelta = secTable[outcome];

  // R5 拍击额外惩罚（GDD §4.4）
  if (outcome === 'reject' && ev.level === 5) secDelta -= 3;
  if (outcome === 'reject' && ev.level === 6) secDelta -= 2;

  // —— warmth
  const warmthDelta = interactionWarmthDelta(outcome, verb, catchUp);

  // —— VIT / CUR（仅 tease 接受时）
  let vitDelta = 0, curDelta = 0;
  if (verb === 'tease' && outcome === 'accept') { vitDelta += 0.3; curDelta += 1.5; }
  if (verb === 'offer' && outcome === 'accept') { /* 喂食永不产生负向数值（G10） */ }

  let aff = clamp(affBefore + affDelta, 0, WARMTH.affMax);
  let affPeak = Math.max(affPeakBefore, aff);
  // 地板保护：AFF 永不低于历史峰值的 60%（且不低于 10）
  const floor = affectionFloor(affPeak);
  if (aff < floor) aff = floor;

  const warmth = clamp(warmthBefore + warmthDelta, 0, WARMTH.warmthMax);
  const sec = clamp(secBefore + secDelta, 0, 100);
  const cur = clamp((p.cur || 0) + curDelta, 0, 100);
  const vit = clamp((p.vit || 0) + vitDelta, 20, 85);

  const nextCatchUp = outcome === 'accept'
    ? Math.max(0, catchUp - 1)
    : catchUp;

  return {
    aff, affPeak, warmth, sec, cur, vit,
    catchUpRemaining: nextCatchUp,
    deltas: { aff: aff - affBefore, affPeak: affPeak - affPeakBefore, warmth: warmth - warmthBefore, sec: sec - secBefore, cur: curDelta, vit: vitDelta },
  };
}

/** GDD §4.3.4 的 AFF 列（未递减前的基数） */
const INTERACTION_AFF = {
  pet: { accept: 1.6, reject: -0.2, none: 0 },
  brush: { accept: 1.5, reject: -0.3, none: 0 },
  tease: { accept: 2.0, reject: -0.1, none: 0 },
  offer: { accept: 2.4, reject: 0, none: 0 },   // 🚨 G10：喂食永不产生负向数值
  lure: { accept: 0.8, reject: -0.1, none: 0 },
  scoop: { accept: 0, reject: 0, none: 0 },
  refill: { accept: 0, reject: 0, none: 0 },
  place: { accept: 0, reject: 0, none: 0 },
};

/** GDD §4.3.4 的 SEC 列 */
const INTERACTION_SEC = {
  pet: { accept: 1.2, reject: -0.2, none: 0 },
  brush: { accept: 1.3, reject: -0.3, none: 0 },
  tease: { accept: 0.9, reject: 0, none: 0 },
  offer: { accept: 1.5, reject: 0, none: 0 },
  lure: { accept: 0, reject: 0, none: 0 },
  scoop: { accept: 1.0, reject: 0, none: 0 },
  refill: { accept: 0, reject: 0, none: 0 },
  place: { accept: -3, reject: -3, none: -3 },  // 环境大改 −3.0/次，每日上限 −9
};

/** 「等 Wait」的每分钟累积（GDD §4.3.1 / §4.3.4） */
export const WAIT_PER_MIN = { aff: 0.15, sec: 0.25, warmth: 2.5 };

/**
 * 应用「等」的累积。
 * @param {object} p { aff, affPeak, warmth, sec }
 * @param {number} gameMinutes
 */
export function applyWaiting(p, gameMinutes) {
  const affBefore = p.aff;
  const secBefore = p.sec;
  const warmthBefore = p.warmth;

  let aff = clamp(affBefore + WAIT_PER_MIN.aff * gameMinutes, 0, 100);
  const affPeak = Math.max(p.affPeak != null ? p.affPeak : affBefore, aff);
  const floor = affectionFloor(affPeak);
  if (aff < floor) aff = floor;

  const warmth = clamp(warmthBefore + WAIT_PER_MIN.warmth * gameMinutes, 0, 100);
  const sec = clamp(secBefore + WAIT_PER_MIN.sec * gameMinutes, 0, 100);
  return {
    aff, affPeak, warmth, sec,
    deltas: { aff: aff - affBefore, warmth: warmth - warmthBefore, sec: sec - secBefore },
  };
}

/** 亲密度阶段（GDD §3.3.1） */
export function affectionStage(aff) {
  if (aff < 20) return 'stranger';
  if (aff < 40) return 'habitual';
  if (aff < 60) return 'trust';
  if (aff < 80) return 'close';
  return 'bond';
}

export const AFFECTION_STAGE_LABEL = {
  stranger: '陌生',
  habitual: '习惯',
  trust: '信任',
  close: '亲近',
  bond: '羁绊',
};

export default {
  WARMTH, affectionFloor, settleOfflineWarmth, accrueCoPresence,
  interactionWarmthDelta, catchUpAffMultiplier, applyInteraction, applyWaiting,
  affectionStage, AFFECTION_STAGE_LABEL, WAIT_PER_MIN,
};
