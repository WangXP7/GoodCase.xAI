/**
 * rng.js —— PCG32 种子化随机数 + 四路独立流
 *
 * 依据：ADR-104 §2.4、RUL-9（回放架构预留）。
 *
 * 为什么不用 Math.random()：
 *   - 不可种子化 → 无法做确定性模拟 → 违反 RUL-9
 *   - 无法持久化 → 读档后同一段离线结算会走出不同的猫
 *   本项目 CI 规则：业务代码禁止出现 Math.random（本文件与 debug/ 除外）。
 *
 * 为什么分四路：
 *   若共用单路，"玩家翻了 3 篇日记"会消耗 3 个随机数，从而使"行为决策的抽取结果"
 *   整体漂移 → 玩家翻不翻日记会改变猫的行为。不可接受。
 *
 * 本文件零浏览器依赖，可被 Node 直接引入（tests/smoke.mjs 依赖此点）。
 */

/* ---------- 32×32 → 64 位乘法的分解（JS 没有 64 位整数） ---------- */

/** 取 (a*b) 的低 32 位，a、b 为 uint32 */
function mulLo32(a, b) {
  const al = a & 0xffff, ah = a >>> 16;
  const bl = b & 0xffff, bh = b >>> 16;
  const p00 = al * bl;
  const p01 = al * bh;
  const p10 = ah * bl;
  const mid = p01 + p10 + (p00 >>> 16); // ≤ ~2^33，在 double 安全整数域内
  return (((p00 & 0xffff) | ((mid & 0xffff) << 16)) >>> 0);
}

/** 取 (a*b) 的高 32 位，a、b 为 uint32 */
function mulHi32(a, b) {
  const al = a & 0xffff, ah = a >>> 16;
  const bl = b & 0xffff, bh = b >>> 16;
  const p00 = al * bl;
  const p01 = al * bh;
  const p10 = ah * bl;
  const p11 = ah * bh;
  const mid = p01 + p10 + (p00 >>> 16);
  return (p11 + Math.floor(mid / 0x10000)) >>> 0;
}

/* PCG32 的乘数常量 6364136223846793005 = 0x5851F42D4C957F2D */
const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;

/**
 * PCG32（PCG-XSH-RR 变体），周期 2^64，状态 2×uint32。
 * 参考 Melissa E. O'Neill《PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms》
 */
export class PCG32 {
  /**
   * @param {number} seedLo 种子低 32 位
   * @param {number} seedHi 种子高 32 位
   * @param {number} [incLo] 流增量低 32 位（必须为奇数才有完整周期）
   * @param {number} [incHi] 流增量高 32 位
   */
  constructor(seedLo = 0, seedHi = 0, incLo = 0x9e3779b9, incHi = 0x243f6a88) {
    this.lo = 0 >>> 0;
    this.hi = 0 >>> 0;
    this.incLo = incLo >>> 0;
    this.incHi = incHi >>> 0;
    // 标准初始化序列：先空转一次，混入种子，再空转一次
    this._advance();
    this.lo = (this.lo + (seedLo >>> 0)) >>> 0;
    this.hi = (this.hi + (seedHi >>> 0)) >>> 0;
    this._advance();
  }

  /** state = state * MUL + inc  (mod 2^64) */
  _advance() {
    const s0 = this.lo, s1 = this.hi;
    const newLo = mulLo32(s0, MUL_LO);
    const carry = mulHi32(s0, MUL_LO);
    const newHi = (mulLo32(s0, MUL_HI) + mulLo32(s1, MUL_LO) + carry) >>> 0;
    const sum = newLo + this.incLo;
    this.lo = sum >>> 0;
    this.hi = (newHi + this.incHi + (sum > 0xffffffff ? 1 : 0)) >>> 0;
  }

  /** @returns {number} uint32 */
  nextUint32() {
    const s0 = this.lo, s1 = this.hi;
    this._advance();

    // xorshifted = uint32(((state >>> 18) ^ state) >>> 27)
    const shiftedLo = (((s0 >>> 18) | (s1 << 14)) >>> 0); // (state>>>18) 的低 32 位
    const shiftedHi = s1 >>> 18;                          // (state>>>18) 的高 32 位
    const xLo = shiftedLo ^ s0;
    const xHi = shiftedHi ^ s1;
    const xorshifted = (((xLo >>> 27) | (xHi << 5)) >>> 0);

    const rot = s1 >>> 27; // 即 state >>> 59
    return (((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0);
  }

  /** [0, 1) */
  nextFloat() {
    return this.nextUint32() / 4294967296;
  }

  /** [lo, hi) */
  nextRange(lo, hi) {
    return lo + this.nextFloat() * (hi - lo);
  }

  /** [lo, hi] 整数 */
  nextInt(lo, hi) {
    return lo + Math.floor(this.nextFloat() * (hi - lo + 1));
  }

  nextBool(p = 0.5) {
    return this.nextFloat() < p;
  }

  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.nextFloat() * arr.length)];
  }

  /**
   * 按权重抽取。权重为 0 的项永不被抽中（除非全为 0，则退化为均匀）。
   * @param {Array} items
   * @param {(item:any)=>number} weightFn
   */
  weighted(items, weightFn) {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i], i);
      total += w > 0 ? w : 0;
    }
    if (total <= 0) return this.pick(items);
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i], i);
      if (w > 0) {
        r -= w;
        if (r <= 0) return items[i];
      }
    }
    return items[items.length - 1];
  }

  /** 近似正态分布（Irwin–Hall n=4 近似，够用于数值抖动） */
  nextGaussian(mean = 0, sigma = 1) {
    let s = 0;
    for (let i = 0; i < 4; i++) s += this.nextFloat();
    return mean + (s - 2) * 1.1547 * sigma;
  }

  getState() { return { lo: this.lo >>> 0, hi: this.hi >>> 0 }; }

  setState(st) {
    this.lo = (st.lo >>> 0);
    this.hi = (st.hi >>> 0);
  }

  /** 存档用紧凑表示：[lo, hi] */
  serialize() { return [this.lo >>> 0, this.hi >>> 0]; }
  deserialize(a) {
    if (Array.isArray(a) && a.length === 2) {
      this.lo = a[0] >>> 0;
      this.hi = a[1] >>> 0;
    }
  }

  /** 派生一条新的独立流（不扰动当前流的状态） */
  derive(salt) {
    return new PCG32((this.nextUint32() ^ (salt * 2654435761)) >>> 0, this.nextUint32() >>> 0);
  }
}

/**
 * 四路独立流。
 * core / journal / genesis 必须持久化；cosmetic 不持久化（ADR-104 §4.3）。
 *
 * ⚠️ 警告：如果将来某个 cosmetic 用途变成"影响可存档状态"的（例如猫毛位置影响锚点偏好），
 *    必须立即迁移到 core 流，否则回放将不可复现。
 */
export function createStreams(seed) {
  const s = seed >>> 0;
  return {
    core: new PCG32((s ^ 0x11111111) >>> 0, 0x5bf03635),
    journal: new PCG32((s ^ 0x22222222) >>> 0, 0x5bf03635),
    genesis: new PCG32((s ^ 0x33333333) >>> 0, 0x5bf03635),
    cosmetic: new PCG32((s ^ 0x44444444) >>> 0, 0x5bf03635),
  };
}

/** 从种子数字生成 [lo, hi] 两个 uint32 */
export function splitSeed(seed) {
  const v = Math.abs(Math.floor(Number(seed) || 0));
  return [v % 4294967296, Math.floor(v / 4294967296) % 4294967296];
}

/** 生成一个随机种子（基于时间 + 一个非确定源；仅用于首次创档） */
export function makeSeed() {
  const t = Date.now();
  return ((t % 2147483647) * 48271 + 1) % 2147483647;
}

export default PCG32;
