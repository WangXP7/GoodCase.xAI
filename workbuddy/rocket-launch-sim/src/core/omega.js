/**
 * Ω 复合入轨指示器（S7 §2 —— 全份 GDD 的核心交付物）
 *
 * 主理人已裁决采用 **F4 形式**：
 *   A  = h / H                       高度项（不夹紧，可 >1）
 *   B  = (v_h / V_C)²                水平动能项
 *   Ω₀ = 0.45·A + 0.55·B，单调闩锁
 *   h_eq = −R·(1 − min(Ω₀/Ω_CRIT, 1))      等效近地点 ∈ [−R, 0]
 *   h_disp = max(h_eq, h_p) 再闩锁        融合（核心机制）
 *   折线压缩标尺 G(h)：h<0 → 0.60·(1+h/R)；h≥0 → min(1, 0.60+0.40·h/H)
 *   s = G^0.55，Ω% = 100·s
 *
 * 三条结构性保证（不依赖标定精度）：
 *   1. 单调：两个单调量的 max + 闩锁 ⇒ 数学上不可能回退
 *   2. 连续：切换发生在 h_p 追上 h_eq 的交点，交点处二者相等 ⇒ 跳变恒为 0
 *   3. 自标定：Ω_CRIT 只影响交点位置，不影响连续性
 *
 * 双模态（S7 §2.4）：
 *   模态 A（Ω 估算 / EST）：h_p ≤ h_eq
 *   模态 B（近地点实测 / MEA）：h_p > h_eq 首次成立 —— 一次性闩锁，本局不回 A
 *
 * 边缘防护（S7 §6）：V_C 断言、A 非负、G 负底数、h_p 沿用上帧、reset 清零。
 */

export class OmegaIndicator {
  /**
   * @param {{R:number,H:number,VC:number}} world
   * @param {{W_A:number,W_B:number,OMEGA_CRIT:number,GAMMA:number,H_GATE:number}} cfg
   */
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    // S7 §6.7：无条件清零闩锁，否则第二局开局即满条
    this.o0 = 0;
    this.hEq = -this.world.R;
    this.hP = -this.world.R;
    this.hDisp = -this.world.R;
    this.s = 0;
    this.omega = 0;
    this.source = 'A';
    this.switched = false;      // 一次性闩锁：进入 B 后不再回 A
    this.switchT = null;
    this.switchJump = 0;        // 切换瞬间的 Δs（用于 A7-2 断言）
    this._lastS = 0;
    this.min8sIncrement = Infinity;
    this._window = [];
    this.milestonesHit = new Set();
  }

  /**
   * 每物理步调用。
   * @param {number} h   当前高度 m
   * @param {number} vh  当地水平速度 m/s
   * @param {number} t   局内时刻 s
   * @param {{valid:boolean, periapsis:number}} orbit
   * @returns {Array} 里程碑事件
   */
  update(h, vh, t, orbit) {
    const { R, H, VC } = this.world;
    const { W_A, W_B, OMEGA_CRIT, GAMMA, H_GATE } = this.cfg;
    const events = [];

    // ① 分量（S7 §6.1 / §6.2：V_C 断言 + A 非负）
    const A = Math.max(0, h) / H;
    const B = VC > 1 ? (vh / VC) * (vh / VC) : 0;

    // ② 复合 + 闩锁
    this.o0 = Math.max(W_A * A + W_B * B, this.o0);

    // ③ 等效近地点
    this.hEq = -R * (1 - Math.min(this.o0 / OMEGA_CRIT, 1));

    // ④ 融合 + 闩锁（轨道解算退化时 h_p 沿用上帧）
    this.hP = orbit.valid ? orbit.periapsis : this.hP;
    const raw = Math.max(this.hEq, this.hP);
    this.hDisp = Math.max(raw, this.hDisp);

    // ⑤ 折线压缩标尺
    const G = this.hDisp < 0
      ? H_GATE * (1 + this.hDisp / R)
      : Math.min(1, H_GATE + (1 - H_GATE) * (this.hDisp / H));

    // ⑥⑦ 伽马 → 百分比（S7 §6.3：负底数求幂防护，本系统最重要的一行）
    const prevS = this.s;
    this.s = Math.pow(Math.max(0, G), GAMMA);
    this.omega = 100 * this.s;

    // 模态判定 + 一次性闩锁
    const wouldBeB = this.hP > this.hEq;
    if (!this.switched && wouldBeB) {
      this.switched = true;
      this.switchT = t;
      this.switchJump = Math.abs(this.s - prevS);
    }
    this.source = this.switched ? 'B' : 'A';

    // A7-3 无死区：任意 8s 窗口的最小增量
    this._window.push({ t, s: this.s });
    while (this._window.length && t - this._window[0].t > 8) this._window.shift();
    if (this._window.length >= 2) {
      const inc = (this.s - this._window[0].s) * 100;
      if (inc < this.min8sIncrement) this.min8sIncrement = inc;
    }

    // 里程碑（非庆祝性提示音）
    for (const m of [25, 50, 75]) {
      if (this.omega >= m && !this.milestonesHit.has(m)) {
        this.milestonesHit.add(m);
        events.push({ type: 'OMEGA_MILESTONE', pct: m });
      }
    }
    this._lastS = this.s;
    return events;
  }

  get() {
    return {
      omega: this.omega,
      omega0: this.o0,
      hEq: this.hEq,
      hDisp: this.hDisp,
      source: this.source,
      switched: this.switched,
      switchT: this.switchT,
      switchJump: this.switchJump,
    };
  }
}
