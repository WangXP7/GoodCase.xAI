/**
 * RT-1 重标定 · v2 —— 修正入轨判定，搜索 Δv 与目标匹配点
 *
 * v1 的教训：
 *   判定过宽，把 ESCAPE（远地点 Infinity）误判为入轨。
 *   真入轨 = ELLIPTIC|CIRCULAR ∧ 近地点 ≥ 0.9H ∧ 远地点有限。
 *
 * v1 揭示的真问题：
 *   火箭 Δv=2833 对 v_c≈1078–1320 的小行星是**过冲**（2.2 倍），直接逃逸。
 *   修法不是加大火箭，而是把 Δv 降到与需求匹配（≈1.3–1.5 × v_c + 损失）。
 *
 * 本脚本搜索：g₀ × H × fuelScale(Δv) × burnScale(TWR/时长)
 */

import { fly, makeBody, makeRocket, BASE_ROCKET } from './sim.mjs';
import { Regime } from './orbit-solver.ref.mjs';

const line = (s = '') => console.log(s);
const hdr = (s) => { line(); line('═'.repeat(96)); line('  ' + s); line('═'.repeat(96)); };

/** 严格入轨判定 */
function isOrbit(r, H) {
  return (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR)
    && r.peri >= H * 0.9
    && Number.isFinite(r.apo);
}

/** 火箭 Δv（考虑 fuelScale） */
function rocketDV(rk, fs) {
  const m0 = rk.m0 + rk.s1.fuel * (fs - 1) + rk.s2.fuel * (fs - 1);
  const m1 = m0 - rk.s1.fuel * fs;
  const m2 = m1 - rk.s1.dry;
  const m3 = m2 - rk.s2.fuel * fs;
  return rk.ispg0 * Math.log(m0 / m1) + rk.ispg0 * Math.log(m2 / m3);
}

const R = 300000;   // 行星半径固定 300 km（美术侧已按此定标）

hdr('扫描 · g₀ × H × Δv倍率 × 燃时倍率 —— 筛选严格入轨解');
line('  行星 R = 300 km 固定；大气顶 = 0.8H，标高 2.5 km');
line('  硬性门槛：严格入轨 ∧ 动压 ≤60kPa ∧ TWR 1.2–2.0 ∧ 时长 60–90s ∧ 游标存活率 ≥50%');
line('');

const all = [];
for (const g0 of [4, 6, 8, 12]) {
  for (const Hkm of [10, 15, 20, 30, 40]) {
    const H = Hkm * 1000;
    const body = makeBody(R, g0);
    const atm = { rho0: 1.2, H: 2500, top: H * 0.8 };
    const vc = Math.sqrt(body.mu / (R + H));
    for (const fs of [0.30, 0.40, 0.50, 0.60, 0.75, 0.90]) {
      for (const bs of [1.0, 1.5, 2.0, 2.5, 3.0]) {
        const rk = makeRocket({});
        const dv = rocketDV(rk, fs);
        // 飞行程序：随目标高度缩放，p=0.5 经典重力转弯
        const prog = { hStart: H * 0.005, hTurn: H * 0.25, p: 0.5 };
        const r = fly(body, atm, rk, prog, fs, bs);
        const ok = isOrbit(r, H);
        all.push({ g0, Hkm, fs, bs, dv, vc, r, ok });
      }
    }
  }
}

// ── 先报告：有哪些组合能严格入轨 ────────────────────────────────────────────
const orbited = all.filter((x) => x.ok);
line(`  总扫描 ${all.length} 组，严格入轨 ${orbited.length} 组`);
line('');

if (orbited.length > 0) {
  // 按存活率降序，展示 Top 20
  orbited.sort((a, b) => b.r.liveFrac - a.r.liveFrac);
  line(`  ${'g₀'.padStart(4)} ${'H(km)'.padStart(6)} ${'Δv'.padStart(6)} ${'v_c'.padStart(6)} ${'Δv/vc'.padStart(6)} ${'燃x'.padStart(5)} ${'近地点'.padStart(8)} ${'远地点'.padStart(9)} ${'动压kPa'.padStart(7)} ${'存活率'.padStart(7)} ${'时长s'.padStart(6)} ${'TWR'.padStart(5)}`);
  line('  ' + '─'.repeat(92));
  for (const x of orbited.slice(0, 20)) {
    line(`  ${String(x.g0).padStart(4)} ${String(x.Hkm).padStart(6)} ${x.dv.toFixed(0).padStart(6)} ${x.vc.toFixed(0).padStart(6)} ${(x.dv / x.vc).toFixed(2).padStart(6)} ${String(x.bs).padStart(5)} ${(x.r.peri / 1000).toFixed(1).padStart(8)} ${(x.r.apo / 1000).toFixed(1).padStart(9)} ${(x.r.maxQ / 1000).toFixed(1).padStart(7)} ${(x.r.liveFrac * 100).toFixed(0).padStart(6)}% ${x.r.t.toFixed(1).padStart(6)} ${x.r.twr0.toFixed(2).padStart(5)}`);
  }

  // ── 全门槛筛选 ───────────────────────────────────────────────────────────
  hdr('全门槛筛选（严格入轨 ∧ 动压≤60kPa ∧ TWR1.2–2.0 ∧ 时长60–90s ∧ 存活率≥50%）');
  const pass = orbited.filter((x) =>
    x.r.maxQ <= 60000
    && x.r.twr0 >= 1.2 && x.r.twr0 <= 2.0
    && x.r.t >= 60 && x.r.t <= 90
    && x.r.liveFrac >= 0.5);

  line('');
  if (pass.length === 0) {
    line('  ⚠️ 无组合同时满足全部门槛。逐项统计失守原因：');
    const c = {
      '动压≤60kPa': orbited.filter((x) => x.r.maxQ <= 60000).length,
      'TWR 1.2–2.0': orbited.filter((x) => x.r.twr0 >= 1.2 && x.r.twr0 <= 2.0).length,
      '时长60–90s': orbited.filter((x) => x.r.t >= 60 && x.r.t <= 90).length,
      '存活率≥50%': orbited.filter((x) => x.r.liveFrac >= 0.5).length,
    };
    for (const [k, v] of Object.entries(c)) {
      line(`     ${k.padEnd(14)} 通过 ${String(v).padStart(3)} / ${orbited.length}`);
    }
    line('');
    line('  → 放宽存活率至 ≥35% 再筛一次（该指标关乎 HUD 设计，可工程补偿）：');
    const pass2 = orbited.filter((x) =>
      x.r.maxQ <= 60000 && x.r.twr0 >= 1.2 && x.r.twr0 <= 2.0
      && x.r.t >= 60 && x.r.t <= 90 && x.r.liveFrac >= 0.35);
    if (pass2.length > 0) {
      pass2.sort((a, b) => b.r.liveFrac - a.r.liveFrac);
      line(`  ${'g₀'.padStart(4)} ${'H(km)'.padStart(6)} ${'Δv'.padStart(6)} ${'Δv/vc'.padStart(6)} ${'燃x'.padStart(5)} ${'近地点'.padStart(8)} ${'动压kPa'.padStart(7)} ${'存活率'.padStart(7)} ${'时长s'.padStart(6)} ${'TWR'.padStart(5)}`);
      for (const x of pass2.slice(0, 12)) {
        line(`  ${String(x.g0).padStart(4)} ${String(x.Hkm).padStart(6)} ${x.dv.toFixed(0).padStart(6)} ${(x.dv / x.vc).toFixed(2).padStart(6)} ${String(x.bs).padStart(5)} ${(x.r.peri / 1000).toFixed(1).padStart(8)} ${(x.r.maxQ / 1000).toFixed(1).padStart(7)} ${(x.r.liveFrac * 100).toFixed(0).padStart(6)}% ${x.r.t.toFixed(1).padStart(6)} ${x.r.twr0.toFixed(2).padStart(5)}`);
      }
      line('');
      line(`  ✅ 放宽后可行解 ${pass2.length} 组`);
    } else {
      line('  ❌ 放宽后仍无解 —— 需重新审视行星尺度或接受工程妥协');
    }
  } else {
    pass.sort((a, b) => b.r.liveFrac - a.r.liveFrac);
    line(`  ${'g₀'.padStart(4)} ${'H(km)'.padStart(6)} ${'Δv'.padStart(6)} ${'Δv/vc'.padStart(6)} ${'燃x'.padStart(5)} ${'近地点'.padStart(8)} ${'动压kPa'.padStart(7)} ${'存活率'.padStart(7)} ${'时长s'.padStart(6)} ${'TWR'.padStart(5)}`);
    line('  ' + '─'.repeat(84));
    for (const x of pass.slice(0, 15)) {
      line(`  ${String(x.g0).padStart(4)} ${String(x.Hkm).padStart(6)} ${x.dv.toFixed(0).padStart(6)} ${(x.dv / x.vc).toFixed(2).padStart(6)} ${String(x.bs).padStart(5)} ${(x.r.peri / 1000).toFixed(1).padStart(8)} ${(x.r.maxQ / 1000).toFixed(1).padStart(7)} ${(x.r.liveFrac * 100).toFixed(0).padStart(6)}% ${x.r.t.toFixed(1).padStart(6)} ${x.r.twr0.toFixed(2).padStart(5)}`);
    }
    line('');
    line(`  ✅ 全门槛通过 ${pass.length} 组`);
  }
} else {
  line('  ❌ 无任何严格入轨解');
}
