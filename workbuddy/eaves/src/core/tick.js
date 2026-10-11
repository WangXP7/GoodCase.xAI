/**
 * tick.js —— 固定步长主循环 + 分层 tick 调度器
 *
 * 依据：ADR-104 §2.1（固定步长 1/30 s）、§2.2（分层 tick 叠加于固定步长之上，TECH-1 的实质）、RUL-9。
 *
 * 两条铁律：
 *  1. 逻辑步进的 dt 恒为 STEP_SECONDS，与渲染帧率无关。60fps / 30fps / 20fps 下逻辑终态必须一致。
 *  2. 分层 tick 的 nextDueAt 用「累加」而非「重设」（`nextDueAt += period`）。
 *     若写成 `nextDueAt = simTime + period`，每次执行都会丢失余量，长期运行后 4 Hz 层会漂成 3.9 Hz，
 *     确定性模拟随之失效。
 *
 * 本文件零浏览器依赖，可被 Node 直接引入。
 */

/** 固定步长 = 1/30 s。最快的 tick 层是 4 Hz（0.25 s = 7.5 步），1/30 精度有余量。 */
export const STEP_SECONDS = 1 / 30;
export const STEP_MS = 1000 / 30;

/** 追帧上限 5 步 = 166 ms。超出直接丢弃时间，宁可慢放也不要雪崩（spiral of death）。 */
export const MAX_CATCHUP = 5;

/** 单帧 dt 的钳制区间，覆盖"切后台 3 小时回来"这类 dt 爆炸 */
export const FRAME_MS_MIN = 0;
export const FRAME_MS_MAX = 250;

/**
 * 权威 tick 表（ADR-104 §2.2 / GDD §3.5）。
 *
 * ⚠️ 命名陷阱：GDD 原文写「性格 1/60 Hz」——这个写法极易被实现者误读成 60 Hz（每帧跑一次）。
 *    代码常量必须是 PERSONALITY_PERIOD_S = 60。
 */
export const TICK = {
  MICRO: 0.25,        // 微表情 4 Hz：耳/尾/瞳/胡须目标值
  NEEDS: 1.0,         // 生理需求 1 Hz
  BEHAVIOR: 2.0,      // 行为决策 0.5 Hz
  PERSONALITY: 60.0,  // 性格结算 1/60 Hz —— 是 60 秒周期，不是 60 Hz
  AUTOSAVE: 30.0,     // 自动存档 1/30 Hz
};

export const TICK_NAMES = Object.keys(TICK);

/**
 * 分层 tick 调度器。
 * 它跑在固定步长时间轴上：advance(dt) 的 dt 恒为 STEP_SECONDS。
 */
export class TickScheduler {
  /**
   * @param {Record<string, number>} periods 层名 → 周期（秒）
   */
  constructor(periods = TICK) {
    this.simTime = 0;
    this.layers = [];
    this.byName = new Map();
    for (const name of Object.keys(periods)) {
      const period = periods[name];
      if (!(period > 0)) continue;
      const layer = { name, period, nextDueAt: period, run: null, count: 0 };
      this.layers.push(layer);
      this.byName.set(name, layer);
    }
    // 周期短的先跑，保证同一帧内的因果顺序（微表情 → 需求 → 行为 → 性格）
    this.layers.sort((a, b) => a.period - b.period);
  }

  /** 注册层回调 */
  on(name, fn) {
    const layer = this.byName.get(name);
    if (!layer) throw new Error(`TickScheduler: 未知层 "${name}"`);
    layer.run = fn;
    return this;
  }

  /**
   * 推进 dt 秒并执行到期的层。
   * @param {number} dt 必须等于 STEP_SECONDS（固定步长）
   */
  advance(dt) {
    this.simTime += dt;
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      // 用 while 而非 if：即便某次 advance 的 dt 超过一个周期也不会漏跑
      let guard = 0;
      while (layer.nextDueAt <= this.simTime && guard++ < 64) {
        layer.nextDueAt += layer.period;   // ★ 累加，不重设
        layer.count++;
        if (layer.run) layer.run(dt, this.simTime);
      }
    }
  }

  /** 已模拟的总时长（秒） */
  get elapsed() { return this.simTime; }

  /** 某层已执行次数（用于频率精度测试） */
  countOf(name) {
    const l = this.byName.get(name);
    return l ? l.count : 0;
  }

  reset() {
    this.simTime = 0;
    for (const l of this.layers) { l.nextDueAt = l.period; l.count = 0; }
  }
}

/**
 * 固定步长主循环驱动器。
 *
 * 时间源由外部注入（浏览器传 performance.now()，测试传手造序列），
 * 因此本类可在 Node 里做帧率无关性回归测试。
 */
export class FixedStepLoop {
  /**
   * @param {object} opts
   * @param {(dt:number)=>void} opts.onStep   一次固定步长逻辑推进（dt 恒为 STEP_SECONDS）
   * @param {(alpha:number, frameMs:number)=>void} opts.onRender 渲染；alpha 为插值系数
   * @param {number} [opts.maxCatchup]
   * @param {number} [opts.timeScale] 时间倍率（RUL-4 的 ×12 在此接入）
   */
  constructor({ onStep, onRender, maxCatchup = MAX_CATCHUP, timeScale = 1 } = {}) {
    this.onStep = onStep || (() => {});
    this.onRender = onRender || (() => {});
    this.maxCatchup = maxCatchup;
    this.timeScale = timeScale;
    this.accumulator = 0;
    this.lastNow = null;
    this.simSeconds = 0;
    this.frameCount = 0;
    this.lastFrameMs = 0;
    this.droppedMs = 0;
    this.started = false;
  }

  /**
   * 喂入一个绝对时间戳（毫秒，单调）。
   * @param {number} nowMs
   */
  frame(nowMs) {
    if (this.lastNow === null) {
      this.lastNow = nowMs;
      this.started = true;
      this.onRender(0, 0);
      return 0;
    }
    let frameMs = nowMs - this.lastNow;
    this.lastNow = nowMs;
    if (!(frameMs > 0)) frameMs = 0;
    if (frameMs > FRAME_MS_MAX) {
      this.droppedMs += frameMs - FRAME_MS_MAX;
      frameMs = FRAME_MS_MAX;
    }
    this.lastFrameMs = frameMs;

    // ★ 时间倍率作用在累加器上，而不是作用在 dt 上：
    //   dt 必须恒为 STEP_SECONDS，否则逻辑结果会依赖倍率与帧率。
    this.accumulator += (frameMs / 1000) * this.timeScale;

    let steps = 0;
    while (this.accumulator >= STEP_SECONDS && steps < this.maxCatchup) {
      this.onStep(STEP_SECONDS);
      this.simSeconds += STEP_SECONDS;
      this.accumulator -= STEP_SECONDS;
      steps++;
    }
    if (steps === this.maxCatchup && this.accumulator >= STEP_SECONDS) {
      // 追不上就丢弃时间，防止 spiral of death
      this.droppedMs += this.accumulator * 1000;
      this.accumulator = 0;
    }

    this.frameCount++;
    this.onRender(this.accumulator / STEP_SECONDS, frameMs);
    return steps;
  }

  reset(nowMs = 0) {
    this.lastNow = nowMs;
    this.accumulator = 0;
    this.simSeconds = 0;
    this.frameCount = 0;
    this.droppedMs = 0;
  }
}

export default { STEP_SECONDS, STEP_MS, MAX_CATCHUP, TICK, TickScheduler, FixedStepLoop };
