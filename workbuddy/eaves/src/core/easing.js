/**
 * easing.js —— 缓动函数集
 *
 * 项目约束：不引入补间库（ADR-101 §2.3）。所有缓动必须来自本文件。
 * 全部函数为纯函数，输入输出都是 [0,1] → [0,1]（除注明者外），可被 Node 直接引入做单元测试。
 */

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 反向 lerp：v 在 [a,b] 中的归一化位置 */
export function invLerp(a, b, v) {
  if (a === b) return 0;
  return clamp01((v - a) / (b - a));
}

export function smoothstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/** 更平滑的五次插值（C2 连续），用于光照交叉淡入 */
export function smootherstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInCubic(t) { return t * t * t; }
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function easeOutElastic(t) {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/**
 * 帧率无关的指数趋近。
 *
 * 直接写 `v += (target - v) * 0.1` 会让收敛速度依赖帧率（60fps 与 30fps 行为不同），
 * 在"逻辑固定步长 + 渲染可变帧率"的架构下是错的。这里用 1 - exp(-k*dt) 做补偿。
 *
 * @param {number} current 当前值
 * @param {number} target  目标值
 * @param {number} k       收敛速率（越大越快，单位 1/秒）
 * @param {number} dt      真实秒
 */
export function damp(current, target, k, dt) {
  if (k <= 0) return target;
  const t = 1 - Math.exp(-k * dt);
  return current + (target - current) * t;
}

/** 角度插值（处理 ±π 环绕） */
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** 阻尼弹簧（用于物件被点之后的回弹，带一点过冲） */
export class Spring {
  constructor(stiffness = 120, damping = 14, value = 0) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  kick(impulse) { this.vel += impulse; }
  set target_(v) { this.target = v; }
  step(dt) {
    // 子步积分，避免大 dt 时弹簧发散
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.stiffness - this.vel * this.damping;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

export default {
  clamp, clamp01, lerp, invLerp, smoothstep, smootherstep,
  easeOutCubic, easeInCubic, easeInOutCubic, easeOutQuad, easeInOutQuad,
  easeOutBack, easeOutElastic, damp, lerpAngle, Spring,
};
