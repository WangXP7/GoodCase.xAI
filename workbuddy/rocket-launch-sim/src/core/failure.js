/**
 * 失败演出与归因（S6）—— 支柱 P4 的唯一载体 / P2 的第二验收点
 *
 * 职责：检测失败条件 → 选主因模板 → 填实测数值 → 从证据池选 2–4 条 → 归因记录。
 * 文案硬性要求（S6 §3.3）：主因必须同时含 ① 时刻 ② 量名 ③ 实测值 ④ 差多少 中的≥3类。
 * 改进建议禁止给最优解（概念 §5.1 自主保障 3）。
 *
 * 光敏合规（美术 §9.3）：仅 1 帧全屏炽白闪（非红、非序列）、震屏 10px/0.5s ≤ 2Hz。
 * 「减少动效」模式：震屏 ×0、炽白闪改静态高亮、粒子 ×0.3。
 */

export const FailureCode = Object.freeze({
  DESTRUCT_AERO: 'DESTRUCT_AERO',
  DESTRUCT_ALPHA: 'DESTRUCT_ALPHA',
  TUMBLE: 'TUMBLE',
  SEP_HIGHQ: 'SEP_HIGHQ',
  IMPACT: 'IMPACT',
  INSUFFICIENT_DV: 'INSUFFICIENT_DV',
  ESCAPE_TRAJ: 'ESCAPE_TRAJ',
  SEQUENCE_FAULT: 'SEQUENCE_FAULT',
  ABORT: 'ABORT',
});

export const FAILURE_TITLES = Object.freeze({
  DESTRUCT_AERO: 'STRUCTURAL FAILURE · 气动解体',
  DESTRUCT_ALPHA: 'STRUCTURAL FAILURE · 箭体折断',
  TUMBLE: 'ATTITUDE LOSS · 姿态失控',
  SEP_HIGHQ: 'STAGING FAILURE · 级间碰撞',
  IMPACT: 'TRAJECTORY FAILURE · 撞地 / 坠海',
  INSUFFICIENT_DV: 'TRAJECTORY FAILURE · 入轨失败',
  ESCAPE_TRAJ: 'TRAJECTORY FAILURE · 逃逸弹道',
  SEQUENCE_FAULT: 'SEQUENCE FAULT · 序列故障',
  ABORT: 'MISSION ABORT · 主动中止',
});

const R2D = 180 / Math.PI;

export class FailureSystem {
  constructor(world, cfg, judgeCfg) {
    this.W = world; this.F = cfg; this.J = judgeCfg;
    this.reset();
  }

  reset() {
    this.record = null;
    this.tumbleHold = 0;
    this.arrested = false;
  }

  get failed() { return this.record !== null; }

  /**
   * 每物理步调用，按 S6 §3.1 的优先级从上到下取第一个满足的码。
   * @returns {object|null} 失败记录
   */
  detect(fm, orbit, atmo, staging, seqEvents) {
    if (this.record) return null;
    const F = this.F;

    // 序列故障 / 中止（由 S2 抛出的事件驱动）
    for (const e of seqEvents || []) {
      if (e.type === 'SEQUENCE_FAULT') return this._build(FailureCode.SEQUENCE_FAULT, fm, orbit, atmo, { blockedItem: e.blockedItem });
      if (e.type === 'ABORT_FLIGHT') return this._build(FailureCode.ABORT, fm, orbit, atmo, {});
    }

    // 1. DESTRUCT_AERO
    if (atmo.q > F.Q_STRUCT) {
      return this._build(FailureCode.DESTRUCT_AERO, fm, orbit, atmo, {});
    }
    // 2. DESTRUCT_ALPHA
    if (Math.abs(fm.alpha) > F.ALPHA_STRUCT && atmo.q > F.Q_STRUCT) {
      return this._build(FailureCode.DESTRUCT_ALPHA, fm, orbit, atmo, {});
    }
    // 3. TUMBLE（|alpha|>60° 持续 1.0s）
    if (Math.abs(fm.alpha) > F.TUMBLE_ALPHA) {
      this.tumbleHold += 1 / 120;
      if (this.tumbleHold >= F.TUMBLE_HOLD) {
        return this._build(FailureCode.TUMBLE, fm, orbit, atmo, {});
      }
    } else { this.tumbleHold = 0; }

    // 5. IMPACT
    if (fm.h <= 0 && fm.t > F.IMPACT_GRACE) {
      return this._build(FailureCode.IMPACT, fm, orbit, atmo, {});
    }
    return null;
  }

  /** 由 S5 的判定结果驱动：SECO / 主动关机但未入轨 */
  detectFromJudge(orbit, fm, atmo, snapshot) {
    if (this.record) return null;
    if (orbit.regime === 'ESCAPE' || (orbit.valid && !Number.isFinite(orbit.apoapsis))) {
      return this._build(FailureCode.ESCAPE_TRAJ, fm, orbit, atmo, {});
    }
    return this._build(FailureCode.INSUFFICIENT_DV, fm, orbit, atmo, {});
  }

  detectSepHighQ(payload, fm, orbit, atmo) {
    if (this.record) return null;
    return this._build(FailureCode.SEP_HIGHQ, fm, orbit, atmo, payload);
  }

  _peak(fm, orbit, atmo) {
    return {
      maxQ: atmo.qMax, tMaxQ: atmo.tQMax, maxAlpha: fm.maxAlpha,
      hMax: fm.hMax, vMax: fm.vMax, vhMax: fm.vhMax,
      periBest: orbit.valid ? orbit.periapsis : -this.W.R,
      dvLoss: this.R_TOTAL ? 0 : 0,
    };
  }

  _build(code, fm, orbit, atmo, extra) {
    const t = fm.t;
    const h = fm.h;
    const q = atmo.q; const qMax = atmo.qMax;
    const alphaDeg = Math.abs(fm.alpha) * R2D;
    const peri = orbit.valid ? orbit.periapsis : -this.W.R;
    const periKm = peri / 1000;
    const DV = 2635; // 用于文案对照的基准 Δv 损失

    let primary = '', fixHint = '';
    switch (code) {
      case FailureCode.DESTRUCT_AERO:
        primary = `你在 T+${f(t, 1)}s / 高度 ${f(h / 1000, 2)} km 承受了 ${f(q / 1000, 1)} kPa 动压，超过结构极限 30 kPa 达 ${f((q - 30000) / 1000, 1)} kPa。`;
        fixHint = '动压 = ½·空气密度·速度²。爬升更快（更高处空气更稀薄）或提前收油门都能压低峰值。';
        break;
      case FailureCode.DESTRUCT_ALPHA:
        primary = `你在 T+${f(t, 1)}s 以 ${f(alphaDeg, 1)}° 攻角、在 ${f(q / 1000, 1)} kPa 动压下飞行——箭体被侧向气流折断了。`;
        fixHint = '攻角 = 箭体指向与飞行方向的夹角。让箭体顺着速度矢量走。';
        break;
      case FailureCode.TUMBLE:
        primary = `你在 T+${f(t, 1)}s 失去姿态控制，箭体以 ${f(alphaDeg, 0)}° 攻角翻滚了 1.0 s。`;
        fixHint = '低空空气会自行把箭体摆正，高空不会。别在高空做大角度配平。';
        break;
      case FailureCode.SEP_HIGHQ: {
        const qs = (extra && extra.qSep) || 0;
        primary = `你在 T+${f(t, 1)}s / 动压 ${f(qs / 1000, 1)} kPa 时分离——上级撞上了自己的一级。安全分离需低于 5 kPa。`;
        fixHint = '动压在 T+40 s 后降到 5 kPa 以下。别急着按 SHIFT。';
        break;
      }
      case FailureCode.IMPACT:
        primary = `火箭在 T+${f(t, 1)}s 撞回地面。最高只到 ${f(fm.hMax / 1000, 2)} km，最大水平速度 ${f(fm.vhMax, 0)} m/s（圆轨道需要 1512 m/s）。`;
        fixHint = '水平速度不够，重力就会把你拉回来。更早、更彻底地把速度矢量压向水平。';
        break;
      case FailureCode.INSUFFICIENT_DV: {
        const gapM = this.J.H_PASS - peri;
        const gapTxt = gapM > 100 ? `还差 ${f(gapM / 1000, 2)} km`
          : gapM > 0 ? `还差 ${f(gapM, 0)} m —— 就差一点点` : '已达标';
        primary = `燃料耗尽于 T+${f(t, 1)}s，近地点只有 ${f(periKm, 1)} km，距入轨门槛 13.5 km ${gapTxt}。Δv 总损失 ${f(DV, 0)} m/s（基准弹道 548 m/s）。`;
        fixHint = `Δv 损失来自重力、转向和空气阻力三项。检查你的峰值攻角（${f(fm.maxAlpha * R2D, 1)}°）与峰值动压（${f(qMax / 1000, 1)} kPa）。`;
        break;
      }
      case FailureCode.ESCAPE_TRAJ:
        // S6 §3.3 原模板缺"时刻"，违反自身 A6-2（须含时刻）。此处补上 T+{t}s。
        primary = `你在 T+${f(t, 1)}s / 高度 ${f(h / 1000, 2)} km 以关机速度 ${f(fm.v, 0)} m/s 超过了逃逸速度 2138 m/s —— 你把自己甩出了引力场。`;
        fixHint = `目标圆轨道速度是 1512 m/s。你给多了 ${f(fm.v - 1512, 0)} m/s。`;
        break;
      case FailureCode.SEQUENCE_FAULT:
        primary = `发射序列在 T-0 挂起超过 3 秒：${(extra && extra.blockedItem) || '预冷'} 未完成。`;
        fixHint = '这是系统故障，不是你的操作问题。重开即可。';
        break;
      case FailureCode.ABORT:
        primary = `你在 T+${f(t, 1)}s / 高度 ${f(h / 1000, 2)} km 手动中止了任务。乘员舱已安全弹离。`;
        fixHint = '—';
        break;
    }

    const evidence = this._evidence(code, fm, orbit, atmo, extra);
    this.record = {
      code,
      title: FAILURE_TITLES[code],
      t,
      primary,
      evidence,
      fixHint,
      peak: {
        maxQ: atmo.qMax, tMaxQ: atmo.tQMax, maxAlpha: fm.maxAlpha,
        hMax: fm.hMax, vMax: fm.vMax, vhMax: fm.vhMax, periBest: peri,
      },
      h, q,
    };
    return this.record;
  }

  _evidence(code, fm, orbit, atmo, extra) {
    const F = this.F;
    const peri = orbit.valid ? orbit.periapsis : -this.W.R;
    const cand = [];
    const add = (t, label, value, unit, threshold, bad) =>
      cand.push({ t, label, value, unit, threshold, bad: !!bad });

    switch (code) {
      case FailureCode.DESTRUCT_AERO:
        add(atmo.tQMax, '峰值动压', atmo.qMax, 'Pa', F.Q_STRUCT, atmo.qMax > F.Q_STRUCT);
        add(fm.t, '当前动压', atmo.q, 'Pa', F.Q_STRUCT, atmo.q > F.Q_STRUCT);
        add(fm.t, '攻角峰值', fm.maxAlpha, 'rad', F.ALPHA_STRUCT, fm.maxAlpha > F.ALPHA_STRUCT);
        add(fm.t, '当前高度', fm.h, 'm', 12000, fm.h < 12000);
        break;
      case FailureCode.TUMBLE:
        add(fm.t, '当前攻角', Math.abs(fm.alpha), 'rad', F.TUMBLE_ALPHA, true);
        add(fm.t, '当前高度', fm.h, 'm', 12000, fm.h >= 12000);
        add(fm.t, '当前节流', fm.throttle, '', 1, false);
        break;
      case FailureCode.SEP_HIGHQ:
        add(extra.tSep || fm.t, '分离动压', (extra.qSep || 0), 'Pa', F.Q_SEP_SAFE, (extra.qSep || 0) > F.Q_SEP_SAFE);
        add(extra.tSep || fm.t, '分离时刻', (extra.tSep || fm.t), 's', 40, (extra.tSep || fm.t) < 40);
        add(extra.tSep || fm.t, '浪费 Δv', (extra.dvWasted || 0), 'm/s', 0, (extra.dvWasted || 0) > 0);
        break;
      case FailureCode.IMPACT:
        add(fm.t, '最高高度', fm.hMax, 'm', 15000, fm.hMax < 15000);
        add(fm.t, '最大水平速度', fm.vhMax, 'm/s', 1512, fm.vhMax < 1512);
        add(atmo.tQMax, '峰值动压', atmo.qMax, 'Pa', F.Q_STRUCT, false);
        break;
      case FailureCode.INSUFFICIENT_DV:
        add(fm.t, '近地点', peri, 'm', this.J.H_PASS, peri < this.J.H_PASS);
        add(fm.t, '攻角峰值', fm.maxAlpha, 'rad', 0.087, fm.maxAlpha > 0.087);
        add(atmo.tQMax, '峰值动压', atmo.qMax, 'Pa', 16500, atmo.qMax > 16500);
        add(fm.t, '关机高度', fm.h, 'm', 0, false);
        break;
      case FailureCode.ESCAPE_TRAJ:
        add(fm.t, '关机速度', fm.v, 'm/s', 2138, fm.v > 2138);
        add(fm.t, '远地点', orbit.apoapsis, 'm', 0, false);
        break;
      case FailureCode.ABORT:
        add(fm.t, '中止时刻', fm.t, 's', 0, false);
        add(fm.t, '中止高度', fm.h, 'm', 0, false);
        add(fm.t, '中止时近地点', peri, 'm', this.J.H_PASS, peri < this.J.H_PASS);
        break;
      default:
        add(fm.t, '时刻', fm.t, 's', 0, false);
        break;
    }

    // 排序：BAD 优先 → 相对偏离降序 → 时间升序（S6 §3.2）
    const rel = (e) => {
      if (e.threshold === 0) return e.value === 0 ? 0 : Infinity;
      const r = Math.abs(e.value - e.threshold) / Math.abs(e.threshold);
      return Number.isFinite(r) ? r : 0;
    };
    cand.sort((a, b) => {
      if (a.bad !== b.bad) return a.bad ? -1 : 1;
      const dr = rel(b) - rel(a);
      if (Math.abs(dr) > 1e-12) return dr;
      return a.t - b.t;
    });
    return cand.slice(0, 4).map((e) => ({
      t: e.t, label: e.label, value: e.value, unit: e.unit,
      verdict: e.bad ? 'BAD' : (e === cand[0] ? 'WARN' : 'OK'),
    }));
  }
}

/** 数字格式化：|x|<1e-3 ⇒ '0'，绝不输出 NaN/undefined（美术 §5.2） */
function f(x, digits) {
  if (!Number.isFinite(x)) return '--.-';
  if (Math.abs(x) < 1e-3) return '0';
  return x.toFixed(digits);
}
