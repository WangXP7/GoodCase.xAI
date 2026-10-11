/**
 * RT-1 最终求解 · 搜索满足全部验收门槛的参数组
 *
 * 门槛：严格入轨 ∧ 动压 ≤60kPa ∧ 时长 60–90s ∧ TWR 1.2–2.0 ∧ 游标存活率 ≥50%
 * 附：至少 2 条不同飞行程序可行（防主导策略红线）
 */

import { solveOrbit, Regime } from './orbit-solver.ref.mjs';

const DT = 1 / 120;
const R = 300000;               // 行星半径固定（美术已按 300km 定标）

/**
 * 参数化弹道仿真。
 * @param {object} cfg { g0, H, atm:{rho0,scaleH,top}, rk:{...}, prog:{hStart,hTurn,p} }
 */
function fly(cfg) {
  const { g0, H, atm, rk, prog } = cfg;
  const mu = g0 * R * R;
  const rho = (h) => (h >= atm.top || h < 0 ? 0 : atm.rho0 * Math.exp(-h / atm.scaleH));

  let rx = 0, ry = R, vx = 0, vy = 0;
  let theta = Math.PI / 2, stage = 1;
  let m = rk.m0, fuel1 = rk.s1.fuel, fuel2 = rk.s2.fuel;
  let t = 0, step = 0;

  const tau = 0.30;
  const PITCH_RATE = 12 * Math.PI / 180;
  const K_AERO = 1.5e-5;

  const s1Thrust = (rk.s1.fuel / rk.s1.burn) * rk.ispg0;
  const s2Thrust = (rk.s2.fuel / rk.s2.burn) * rk.ispg0;
  const twr0 = s1Thrust / (m * g0);

  let nSample = 0, nLive = 0, firstLiveT = -1;
  let maxQseen = 0, dead = null, staged = false;
  const out = {};
  const MAX_T = 200;

  while (t < MAX_T) {
    const r = Math.sqrt(rx * rx + ry * ry);
    const h = r - R;
    const v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r, uy = ry / r, lx = uy, ly = -ux;

    let thetaCmd;
    if (h < prog.hStart) {
      thetaCmd = Math.PI / 2;
    } else {
      const u = Math.min(1, Math.max(0, (h - prog.hStart) / (prog.hTurn - prog.hStart)));
      thetaCmd = (Math.PI / 2) * Math.pow(1 - u, prog.p);
    }

    const gam = v > 1 ? Math.atan2(vx * ux + vy * uy, vx * lx + vy * ly) : Math.PI / 2;
    const q = 0.5 * rho(h) * v * v;
    if (q > maxQseen) maxQseen = q;

    let dTheta = (thetaCmd - theta) / tau + K_AERO * q * (gam - theta);
    if (dTheta > PITCH_RATE) dTheta = PITCH_RATE;
    if (dTheta < -PITCH_RATE) dTheta = -PITCH_RATE;
    theta += dTheta * DT;

    let thrust = 0, mdot = 0;
    if (stage === 1 && fuel1 > 0) {
      thrust = s1Thrust; mdot = thrust / rk.ispg0;
      fuel1 = Math.max(0, fuel1 - mdot * DT);
    } else if (stage === 2 && fuel2 > 0) {
      thrust = s2Thrust; mdot = thrust / rk.ispg0;
      fuel2 = Math.max(0, fuel2 - mdot * DT);
    }

    const nx = Math.cos(theta) * lx + Math.sin(theta) * ux;
    const ny = Math.cos(theta) * ly + Math.sin(theta) * uy;

    const ag = -mu / (r * r);
    let ax = ag * ux, ay = ag * uy;
    ax += (thrust / m) * nx; ay += (thrust / m) * ny;

    if (v > 0.5) {
      const alpha = theta - gam;
      const Cd = rk.Cd0 + rk.CdAlpha * Math.sin(alpha) ** 2;
      const D = 0.5 * rho(h) * v * v * Cd * rk.A;
      ax -= (D / m) * (vx / v); ay -= (D / m) * (vy / v);
    }

    vx += ax * DT; vy += ay * DT;
    rx += vx * DT; ry += vy * DT;
    m -= mdot * DT; t += DT;

    if (stage === 1 && fuel1 <= 0 && !staged) { m -= rk.s1.dry + fuel1; fuel1 = 0; stage = 2; staged = true; }

    solveOrbit(rx, ry, vx, vy, { mu, R }, out);
    if (step % 12 === 0) {
      nSample++;
      if (out.regime !== Regime.SUBORBITAL) { nLive++; if (firstLiveT < 0) firstLiveT = t; }
    }
    step++;

    if (h <= 0 && t > 1) { dead = 'IMPACT'; break; }
    if (q > 200000) { dead = 'MAXQ'; break; }
    if (stage === 2 && fuel2 <= 0) break;
    if (t > MAX_T - DT) { dead = 'TIMEOUT'; break; }
  }

  const fin = solveOrbit(rx, ry, vx, vy, { mu, R }, {});
  const rEnd = Math.sqrt(rx * rx + ry * ry);
  return {
    t, maxQ: maxQseen, twr0, dead,
    liveFrac: nSample > 0 ? nLive / nSample : 0, firstLiveT,
    peri: fin.ap, apo: fin.aa, regime: fin.regime,
    hEnd: rEnd - R, vEnd: Math.sqrt(vx * vx + vy * vy),
  };
}

function makeRocket({ fs = 1, burn1 = 37, burn2 = 13 } = {}) {
  const s1f = 21000 * fs, s2f = 5000 * fs;
  return {
    m0: 7000 + s1f + 3500 + s2f + 8500,
    s1: { dry: 7000, fuel: s1f, burn: burn1 },
    s2: { dry: 3500, fuel: s2f, burn: burn2 },
    ispg0: 2900, A: 10.0, Cd0: 0.25, CdAlpha: 2.0,
  };
}

function dvOf(rk) {
  const m0 = rk.m0, m1 = m0 - rk.s1.fuel, m2 = m1 - rk.s1.dry, m3 = m2 - rk.s2.fuel;
  return rk.ispg0 * Math.log(m0 / m1) + rk.ispg0 * Math.log(m2 / m3);
}

const isOrbit = (r, H) =>
  (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR)
  && r.peri >= H * 0.9 && Number.isFinite(r.apo);

// ── 搜索 ────────────────────────────────────────────────────────────────────
const line = (s = '') => console.log(s);
line('════════════════════════════════════════════════════════════════════════════');
line('  RT-1 最终求解 · 搜索满足全部门槛的参数组');
line('════════════════════════════════════════════════════════════════════════════');
line('');
line('  搜索维度：g₀ × H × 燃料倍率 × 一级燃时 × 倾倒完成高度 × 幂律 p');
line('  门槛：严格入轨 ∧ 动压≤60kPa ∧ 时长60–90s ∧ TWR1.2–2.0 ∧ 存活率≥50%');
line('');

const cands = [];
for (const g0 of [6, 8, 10, 12]) {
  for (const Hkm of [10, 15, 20, 30]) {
    const H = Hkm * 1000;
    const atm = { rho0: 1.2, scaleH: 2500, top: H * 0.8 };
    for (const fs of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      for (const burn1 of [30, 40, 50, 60]) {
        const rk = makeRocket({ fs, burn1, burn2: Math.round(burn1 * 0.35) });
        const dv = dvOf(rk);
        for (const ht of [0.4, 0.5, 0.6, 0.7, 0.85]) {
          for (const p of [0.4, 0.6, 0.8, 1.0]) {
            const prog = { hStart: H * 0.01, hTurn: H * ht, p };
            const r = fly({ g0, H, atm, rk, prog });
            if (!isOrbit(r, H)) continue;
            cands.push({ g0, Hkm, fs, burn1, ht, p, dv, r });
          }
        }
      }
    }
  }
}

line(`  总候选（严格入轨）：${cands.length} 组`);
line('');

const pass = cands.filter((c) =>
  c.r.maxQ <= 60000
  && c.r.twr0 >= 1.2 && c.r.twr0 <= 2.0
  && c.r.t >= 60 && c.r.t <= 90
  && c.r.liveFrac >= 0.5);

if (pass.length > 0) {
  pass.sort((a, b) => b.r.liveFrac - a.r.liveFrac);
  line(`  ✅ 全门槛通过：${pass.length} 组`);
  line('');
  line(`  ${'g₀'.padStart(4)} ${'H'.padStart(4)} ${'燃x'.padStart(4)} ${'燃时'.padStart(4)} ${'hTurn'.padStart(6)} ${'p'.padStart(4)} ${'Δv'.padStart(6)} ${'近地点'.padStart(8)} ${'远地点'.padStart(9)} ${'动压'.padStart(7)} ${'存活率'.padStart(7)} ${'时长'.padStart(6)} ${'TWR'.padStart(5)}`);
  line('  ' + '─'.repeat(96));
  for (const c of pass.slice(0, 25)) {
    line(`  ${String(c.g0).padStart(4)} ${String(c.Hkm).padStart(4)} ${String(c.fs).padStart(4)} ${String(c.burn1).padStart(4)} ${String(c.ht).padStart(6)} ${String(c.p).padStart(4)} ${c.dv.toFixed(0).padStart(6)} ${(c.r.peri / 1000).toFixed(1).padStart(8)} ${(c.r.apo / 1000).toFixed(1).padStart(9)} ${(c.r.maxQ / 1000).toFixed(1).padStart(7)} ${(c.r.liveFrac * 100).toFixed(0).padStart(6)}% ${c.r.t.toFixed(1).padStart(6)} ${c.r.twr0.toFixed(2).padStart(5)}`);
  }
} else {
  line('  ⚠️ 无解同时满足全门槛。逐项统计：');
  const stat = {
    '严格入轨': cands.length,
    '动压≤60kPa': cands.filter((c) => c.r.maxQ <= 60000).length,
    'TWR 1.2–2.0': cands.filter((c) => c.r.twr0 >= 1.2 && c.r.twr0 <= 2.0).length,
    '时长 60–90s': cands.filter((c) => c.r.t >= 60 && c.r.t <= 90).length,
    '存活率≥50%': cands.filter((c) => c.r.liveFrac >= 0.5).length,
  };
  for (const [k, v] of Object.entries(stat)) line(`     ${k.padEnd(14)} ${String(v).padStart(4)}`);
  line('');
  // 放宽：先看 时长+动压 两项（最硬的物理约束）
  const soft = cands.filter((c) => c.r.maxQ <= 60000 && c.r.t >= 60 && c.r.t <= 90);
  line(`  → 放宽 TWR 与存活率，保留 动压+时长：${soft.length} 组`);
  if (soft.length > 0) {
    soft.sort((a, b) => b.r.liveFrac - a.r.liveFrac);
    line('');
    line(`  ${'g₀'.padStart(4)} ${'H'.padStart(4)} ${'燃x'.padStart(4)} ${'燃时'.padStart(4)} ${'hTurn'.padStart(6)} ${'p'.padStart(4)} ${'Δv'.padStart(6)} ${'近地点'.padStart(8)} ${'动压'.padStart(7)} ${'存活率'.padStart(7)} ${'时长'.padStart(6)} ${'TWR'.padStart(5)}`);
    line('  ' + '─'.repeat(90));
    for (const c of soft.slice(0, 20)) {
      line(`  ${String(c.g0).padStart(4)} ${String(c.Hkm).padStart(4)} ${String(c.fs).padStart(4)} ${String(c.burn1).padStart(4)} ${String(c.ht).padStart(6)} ${String(c.p).padStart(4)} ${c.dv.toFixed(0).padStart(6)} ${(c.r.peri / 1000).toFixed(1).padStart(8)} ${(c.r.maxQ / 1000).toFixed(1).padStart(7)} ${(c.r.liveFrac * 100).toFixed(0).padStart(6)}% ${c.r.t.toFixed(1).padStart(6)} ${c.r.twr0.toFixed(2).padStart(5)}`);
    }
  }
}
