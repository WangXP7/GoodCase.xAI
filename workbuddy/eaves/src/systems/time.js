/**
 * time.js —— 三段式游戏时钟 + 四时段过渡窗
 *
 * 依据：RUL-4、ADR-104 §2.5、GDD §5.3–§5.4、美术圣经 §2.3.1 / §5.4.2。
 *
 * 三段式（RUL-4）：
 *   ① 进入时锚定真实本地时刻 —— 保住"我晚上打开，屋里就是晚上"
 *   ② 会话内加速 ×12
 *   ③ 离线 1:1 推进
 *   附加：单次会话最多推进 6 游戏小时；设置项「真实 / 加速」，默认加速
 *
 * 两个时钟的边界（ADR-104 §2.5）—— 混淆这两者是本项目最容易出的 bug：
 *   真实时钟（performance.now）：帧驱动、动画缓动、0.8 s crossfade、冷却、自动存档、UI 动效
 *   游戏时钟（realMs × timeScale）：时段判定、需求衰减、昼夜节律、离线结算、状态最小驻留
 *
 * ⚠️ 0.8 s crossfade 是真实秒，不是游戏时间。×12 下它等于 9.6 游戏分钟，
 *    而过渡窗是 45 游戏分钟 = 225 真实秒 → crossfade 占过渡窗的 0.36%。
 *
 * 本文件零浏览器依赖，可被 Node 直接引入。
 */

import { clamp } from '../core/easing.js';

/** 会话内时间倍率（RUL-4 ②），可调区间 [8, 20] */
export const TIME_SCALE = 12;
/** 离线推进倍率（RUL-4 ③） */
export const OFFLINE_SCALE = 1;
/** 单次会话最多推进的游戏小时数（RUL-4 ④） */
export const MAX_SESSION_GAME_HOURS = 6;
/** 离线结算封顶天数（ADR-104 §2.6 ④，对应 GDD T6 封顶） */
export const MAX_OFFLINE_DAYS = 30;

export const SLOT_ORDER = ['morning', 'noon', 'dusk', 'night'];

/**
 * 四时段起点（游戏内分钟）。
 * 晨 05:00 / 午 11:00 / 昏 16:00 / 夜 20:00（GDD §5.4.4）
 */
export const SLOT_START_MIN = {
  morning: 300,
  noon: 660,
  dusk: 960,
  night: 1200,
};

/** lightmap 锚点时刻（美术圣经 §2.3.1） */
export const SLOT_ANCHOR_MIN = {
  morning: 480,   // 08:00
  noon: 780,      // 13:00
  dusk: 1080,     // 18:00
  night: 1380,    // 23:00
};

/** 过渡窗 = 45 游戏分钟（GDD PH2b §3.4.2） */
export const TRANSITION_WINDOW_MIN = 45;
const HALF_WINDOW = TRANSITION_WINDOW_MIN / 2;

export function wrapMinutes(m) {
  const v = m % 1440;
  return v < 0 ? v + 1440 : v;
}

/** 游戏内分钟 → 时段 */
export function slotAt(gameMin) {
  const m = wrapMinutes(gameMin);
  if (m >= 300 && m < 660) return 'morning';
  if (m >= 660 && m < 960) return 'noon';
  if (m >= 960 && m < 1200) return 'dusk';
  return 'night';
}

export function formatGameTime(gameMin) {
  const m = wrapMinutes(gameMin);
  const h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 昼夜节律修正用的 5 档（GDD §3.3.3 表 C 的行）。
 * 注意：这是 circadianBand（固定钟点、5 档），与 timeSlot（4 档、随季节漂移）是两个枚举，不可复用（GDD R-3）。
 */
export function circadianBand(gameMin) {
  const m = wrapMinutes(gameMin);
  if (m < 300) return 'lateNight';   // 00–05
  if (m < 660) return 'morning';     // 05–11
  if (m < 960) return 'noon';        // 11–16
  if (m < 1200) return 'dusk';       // 16–20
  return 'night';                    // 20–24
}

/**
 * 当前是否处于时段过渡窗，以及过渡进度。
 *
 * progress: 0 = 窗口开始（仍完全是 from 的光）
 *           0.5 = 边界（★ lightmap 0.8 s crossfade 在此触发）
 *           1 = 窗口结束（完全是 to 的光）
 *
 * @returns {{from:string, to:string, progress:number, inWindow:boolean}}
 */
export function getTransition(gameMin) {
  const m = wrapMinutes(gameMin);
  const cur = slotAt(m);
  const curIdx = SLOT_ORDER.indexOf(cur);
  const nextIdx = (curIdx + 1) % SLOT_ORDER.length;
  const nextStart = SLOT_START_MIN[SLOT_ORDER[nextIdx]];

  // 到下一个边界的有符号距离，wrap 到 (-720, 720]
  let d = nextStart - m;
  if (d > 720) d -= 1440;
  if (d <= -720) d += 1440;

  if (d <= HALF_WINDOW && d >= -HALF_WINDOW) {
    // d ≥ 0 → 还在 cur，即将进入 next；d < 0 → 刚过边界，正在离开 prev 进入 cur
    const to = d >= 0 ? SLOT_ORDER[nextIdx] : cur;
    const from = d >= 0 ? cur : SLOT_ORDER[(curIdx + SLOT_ORDER.length - 1) % SLOT_ORDER.length];
    return { from, to, progress: (HALF_WINDOW - d) / (HALF_WINDOW * 2), inWindow: true };
  }
  return { from: cur, to: cur, progress: -1, inWindow: false };
}

/* ============================ 游戏时钟 ============================ */

/**
 * 游戏时钟。
 *
 * 与渲染完全解耦：advance() 只接受真实毫秒，内部按倍率折算为游戏分钟。
 */
export class GameClock {
  /**
   * @param {object} opts
   * @param {number} [opts.gameMinutes] 初始游戏内分钟（不传则用本地真实时刻锚定）
   * @param {number} [opts.timeScale]   TIME_SCALE 或 1（设置项「加速 / 真实」）
   * @param {number} [opts.maxSessionGameHours]
   */
  constructor({ gameMinutes = null, timeScale = TIME_SCALE, maxSessionGameHours = MAX_SESSION_GAME_HOURS, nowDate = null } = {}) {
    const anchor = gameMinutes != null ? gameMinutes : anchorToLocalTime(nowDate);
    this.gameMinutes = wrapMinutes(anchor);
    this.totalGameMinutes = 0;      // 累计推进（不 wrap），用于统计
    this.timeScale = timeScale;
    this.maxSessionGameHours = maxSessionGameHours;
    this.sessionAdvanced = 0;       // 本次会话已推进的游戏分钟
    this.capped = false;            // 是否已触发 6 小时上限
    this.lastAdvanced = 0;
  }

  /** 设置项：'accelerated' → ×12；'real' → ×1 */
  setTimeScale(scale) {
    this.timeScale = scale;
  }

  get slot() { return slotAt(this.gameMinutes); }
  get transition() { return getTransition(this.gameMinutes); }
  get formatted() { return formatGameTime(this.gameMinutes); }

  /** 剩余可加速的游戏分钟（达到 0 后回落 ×1） */
  get remainingBoostMinutes() {
    return Math.max(0, this.maxSessionGameHours * 60 - this.sessionAdvanced);
  }

  /**
   * 用真实毫秒推进游戏时钟。
   * @param {number} realMs
   * @returns {number} 本次推进的游戏分钟数
   */
  advance(realMs) {
    if (!(realMs > 0)) { this.lastAdvanced = 0; return 0; }
    let scale = this.timeScale;
    let gameMin = (realMs / 60000) * scale;

    // RUL-4 ④：单次会话最多推进 6 游戏小时。超出部分不是"卡住"，而是回落 ×1。
    const remaining = this.remainingBoostMinutes;
    if (gameMin > remaining && remaining > 0 && scale > 1) {
      const over = gameMin - remaining;
      gameMin = remaining + over / scale;   // 超出部分按 ×1 走
    }
    if (remaining <= 0) {
      this.capped = true;
      if (scale > 1) gameMin = realMs / 60000;   // 已封顶，全程 ×1
    }

    this.gameMinutes = wrapMinutes(this.gameMinutes + gameMin);
    this.totalGameMinutes += gameMin;
    this.sessionAdvanced += gameMin;
    this.lastAdvanced = gameMin;
    return gameMin;
  }

  /**
   * 离线推进（RUL-4 ③：1:1）。
   * @param {number} realMs 离线真实毫秒
   * @returns {{gameMinutes:number, days:number, clamped:boolean}}
   */
  static offlineAdvance(realMs) {
    let ms = Math.max(0, realMs || 0);
    const cap = MAX_OFFLINE_DAYS * 86400000;
    const clamped = ms > cap;
    if (clamped) ms = cap;
    const gameMinutes = (ms / 60000) * OFFLINE_SCALE;
    return { gameMinutes, days: gameMinutes / 1440, clamped };
  }

  applyOffline(gameMinutes) {
    this.gameMinutes = wrapMinutes(this.gameMinutes + gameMinutes);
    this.totalGameMinutes += gameMinutes;
  }

  /**
   * 防作弊：双时间戳 + 回拨检测（ADR-104 §2.6）。
   * @returns {{offlineMs:number, rollback:boolean, clamped:boolean, tzChanged:boolean}}
   */
  static reconcile({ savedAtEpoch, monotonicMs, nowEpoch, nowMonotonic, tzOffsetMin, savedTzOffsetMin }) {
    const byEpoch = nowEpoch - (savedAtEpoch != null ? savedAtEpoch : nowEpoch);
    const byMono = nowMonotonic - (monotonicMs != null ? monotonicMs : nowMonotonic);
    // 取较大者：单调时钟防"改系统时间往前调"，epoch 防"清了 performance 基准"
    let offlineMs = Math.max(byEpoch, byMono);
    const rollback = offlineMs < 0;
    if (rollback) {
      // 回拨：冻结本次离线结算，不回滚、不产生日记、不推进需求，仅记录（GDD E3-2，不弹提示）
      offlineMs = 0;
    }
    const cap = MAX_OFFLINE_DAYS * 86400000;
    const clamped = offlineMs > cap;
    if (clamped) offlineMs = cap;
    const tzChanged = savedTzOffsetMin != null && tzOffsetMin != null && savedTzOffsetMin !== tzOffsetMin;
    return { offlineMs, rollback, clamped, tzChanged };
  }

  serialize() {
    return {
      timeOfDayGameMin: this.gameMinutes,
      timeScale: this.timeScale,
      sessionAdvanced: this.sessionAdvanced,
    };
  }

  restore(data) {
    if (!data) return this;
    if (typeof data.timeOfDayGameMin === 'number' && Number.isFinite(data.timeOfDayGameMin)) {
      this.gameMinutes = wrapMinutes(data.timeOfDayGameMin);
    }
    if (typeof data.timeScale === 'number') this.timeScale = data.timeScale;
    if (typeof data.sessionAdvanced === 'number') this.sessionAdvanced = data.sessionAdvanced;
    return this;
  }
}

/** 用本地真实时刻锚定（RUL-4 ①）—— 必须是本地时区，不能用 UTC */
export function anchorToLocalTime(date = null) {
  const d = date || new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function currentTzOffsetMin() {
  return -new Date().getTimezoneOffset();
}

export default {
  TIME_SCALE, OFFLINE_SCALE, MAX_SESSION_GAME_HOURS, MAX_OFFLINE_DAYS,
  SLOT_ORDER, SLOT_START_MIN, SLOT_ANCHOR_MIN, TRANSITION_WINDOW_MIN,
  slotAt, wrapMinutes, formatGameTime, circadianBand, getTransition,
  GameClock, anchorToLocalTime, currentTzOffsetMin, clamp,
};
