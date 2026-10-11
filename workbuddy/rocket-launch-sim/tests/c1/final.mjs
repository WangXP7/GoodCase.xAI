/**
 * RT-1 最终标定验证 —— 对选定参数组做完整验收 + 多路径验证 + 游标生命周期剖析
 */

import { solveOrbit, Regime } from './orbit-solver.ref.mjs';

const DT = 1 / 120;
const R = 300000;
const G0 = 8.0;
const H = 15000;                 // 目标轨道 15 km（轨道半径 1.05 R，接近地球 LEO 比例）
const MU = G0 * R * R;
const ATM = { rho0: 1.2, scaleH: 2500, top: 12000 };
const VC = Math.sqrt(MU / (R + H));

function makeRocket(fs = 0.9, burn1 = 60, burn2 = 21) {
  const s1f = 21000 * fs, s2f = 5000 * fs;
  return {
    m0: 7000 + s1f + 3500 + s2f + 8500,
    s1: { dry: 7000, fuel: s1f, burn: burn1 },
    s2: { dry: 3500, fuel: s2f, burn: burn2 },
    ispg0: 2900, A: 10.0, Cd0: 0.25, CdAlpha: 2.0,
  };
}
const dvOf = (rk) => {
  const m0 = rk.m0, m1 = m0 - rk.s1.fuel, m2 = m1 - rk.s1.dry, m3 = m2 - rk.s2.fuel;
  return rk.ispg0 * Math.log(m0 / m1) + rk.ispg0 * Math.log(m2 / m3);
};

function fly(rk, prog, trace = false) {
  const rho = (h) => (h >= ATM.top || h < 0 ? 0 : ATM.rho0 * Math.exp(-h / ATM.scaleH));
  let rx = 0, ry = R, vx = 0, vy = 0, theta = Math.PI / 2, stage = 1;
  let m = rk.m0, fuel1 = rk.s1.fuel, fuel2 = rk.s2.fuel, t = 0, step = 0;
  const tau = 0.30, PITCH_RATE = 12 * Math.PI / 180, K_AERO = 1.5e-5;
  const s1T = (rk.s1.fuel / rk.s1.burn) * rk.ispg0;
  const s2T = (rk.s2.fuel / rk.s2.burn) * rk.ispg0;
  const twr0 = s1T / (m * G0);
  let nS = 0, nL = 0, firstLive = -1, maxQ = 0, dead = null, staged = false;
  const out = {}; const tr = trace ? [] : null;

  while (t < 200) {
    const r = Math.sqrt(rx * rx + ry * ry), h = r - R, v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r, uy = ry / r, lx = uy, ly = -ux;
    let tc = h < prog.hStart ? Math.PI / 2 : (Math.PI / 2) * Math.pow(1 - Math.min(1, Math.max(0, (h - prog.hStart) / (prog.hTurn - prog.hStart))), prog.p);
    const gam = v > 1 ? Math.atan2(vx * ux + vy * uy, vx * lx + vy * ly) : Math.PI / 2;
    const q = 0.5 * rho(h) * v * v; if (q > maxQ) maxQ = q;
    let dT = (tc - theta) / tau + K_AERO * q * (gam - theta);
    dT = Math.max(-PITCH_RATE, Math.min(PITCH_RATE, dT)); theta += dT * DT;
    let th = 0, md = 0;
    if (stage === 1 && fuel1 > 0) { th = s1T; md = th / rk.ispg0; fuel1 = Math.max(0, fuel1 - md * DT); }
    else if (stage === 2 && fuel2 > 0) { th = s2T; md = th / rk.ispg0; fuel2 = Math.max(0, fuel2 - md * DT); }
    const nx = Math.cos(theta) * lx + Math.sin(theta) * ux, ny = Math.cos(theta) * ly + Math.sin(theta) * uy;
    const ag = -MU / (r * r); let ax = ag * ux, ay = ag * uy;
    ax += (th / m) * nx; ay += (th / m) * ny;
    if (v > 0.5) {
      const al = theta - gam, Cd = rk.Cd0 + rk.CdAlpha * Math.sin(al) ** 2;
      const D = 0.5 * rho(h) * v * v * Cd * rk.A; ax -= (D / m) * (vx / v); ay -= (D / m) * (vy / v);
    }
    vx += ax * DT; vy += ay * DT; rx += vx * DT; ry += vy * DT; m -= md * DT; t += DT;
    // 分离：扣除一级干重 **与剩余燃料**。
    // 原实现只扣 s1.dry（S3-C16 bug）：自动分离时 fuel1 已为 0 故无碍，
    // 但玩家提前分离会留下未燃尽燃料作为"幽灵质量"，导致 Δv 余量虚高至 3111 m/s
    // （超过物理上限 2635 m/s）。修复后提前分离亦正确。
    if (stage === 1 && fuel1 <= 0 && !staged) {
      m -= rk.s1.dry + fuel1; fuel1 = 0; stage = 2; staged = true;
    }
    solveOrbit(rx, ry, vx, vy, { mu: MU, R }, out);
    if (step % 12 === 0) { nS++; if (out.regime !== Regime.SUBORBITAL) { nL++; if (firstLive < 0) firstLive = t; } }
    if (trace && step % 60 === 0) {
      const vh = Math.sqrt(vx * vx + vy * vy);
      const vr = (vx * ux + vy * uy), vt = (vx * lx + vy * ly);
      tr.push({ t, h: h / 1000, v: vh, vt, vr, q: q / 1000, peri: out.ap / 1000, apo: out.aa / 1000, reg: out.regime });
    }
    step++;
    if (h <= 0 && t > 1) { dead = 'IMPACT'; break; }
    if (q > 200000) { dead = 'MAXQ'; break; }
    if (stage === 2 && fuel2 <= 0) break;
    if (t > 200 - DT) { dead = 'TIMEOUT'; break; }
  }
  const fin = solveOrbit(rx, ry, vx, vy, { mu: MU, R }, {});
  const rEnd = Math.sqrt(rx * rx + ry * ry);
  const ux = rx / rEnd, uy = ry / rEnd, lx = uy, ly = -ux;
  const vEnd = Math.sqrt(vx * vx + vy * vy);
  return {
    t, maxQ, twr0, dead, tr,
    liveFrac: nS > 0 ? nL / nS : 0, firstLive,
    peri: fin.ap, apo: fin.aa, regime: fin.regime,
    hEnd: rEnd - R, vEnd,
    vtEnd: vx * lx + vy * ly,   // 关机时水平速度
  };
}

const line = (s = '') => console.log(s);
const hdr = (s) => { line(); line('═'.repeat(92)); line('  ' + s); line('═'.repeat(92)); };

const rk = makeRocket();
hdr('最终标定 · 验收实测');
line(`  行星：R = ${R / 1000} km   g₀ = ${G0} m/s²   μ = ${MU.toExponential(3)}`);
line(`  目标轨道：H = ${H / 1000} km（轨道半径 ${((R + H) / R).toFixed(3)} R，地球 LEO 为 1.016 R）`);
line(`  圆轨道速度 v_c = ${VC.toFixed(0)} m/s   逃逸速度 = ${(Math.SQRT2 * VC).toFixed(0)} m/s`);
line(`  大气：ρ₀=1.2  标高 2.5 km  大气顶 12 km（低于目标轨道，轨道在大气外）`);
line(`  火箭：Δv = ${dvOf(rk).toFixed(0)} m/s（Δv/v_c = ${(dvOf(rk) / VC).toFixed(2)}）`);
line('');

const main = { hStart: H * 0.01, hTurn: H * 0.5, p: 0.8 };
const r = fly(rk, main, true);
const isOrb = (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR) && r.peri >= H * 0.9 && Number.isFinite(r.apo);

line(`  【基准弹道】hTurn=${main.hTurn / 1000}km (50%H)  p=${main.p}`);
line(`    结局        : ${r.dead ?? r.regime}   ${isOrb ? '✅ 严格入轨' : '❌'}`);
line(`    近地点      : ${(r.peri / 1000).toFixed(2)} km  (目标 ${H / 1000} km)`);
line(`    远地点      : ${Number.isFinite(r.apo) ? (r.apo / 1000).toFixed(1) + ' km' : '∞'}`);
line(`    关机高度    : ${(r.hEnd / 1000).toFixed(2)} km   关机速度 ${r.vEnd.toFixed(0)} m/s   水平分量 ${r.vtEnd.toFixed(0)} m/s`);
line(`    峰值动压    : ${(r.maxQ / 1000).toFixed(1)} kPa   (Falcon 9 实测约 30 kPa)`);
line(`    起飞推重比  : ${r.twr0.toFixed(2)}`);
line(`    单局时长    : ${r.t.toFixed(1)} s   (门槛 60–90s)`);
line(`    游标存活率  : ${(r.liveFrac * 100).toFixed(1)}%   首次有效 T+${r.firstLive.toFixed(1)}s`);
line('');

hdr('多路径验证（防主导策略红线：须存在 ≥2 条不同路线的可行入轨路径）');
line('  ── 低抛（早倾倒）vs 高抛（晚倾倒）──');
line('');
line(`  ${'路线'.padEnd(10)} ${'hTurn%'.padStart(7)} ${'p'.padStart(5)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(10)} ${'动压kPa'.padStart(8)} ${'时长s'.padStart(7)} ${'Δv余量'.padStart(8)} ${'判定'.padStart(6)}`);
line('  ' + '─'.repeat(80));
const routes = [];
for (const [name, ht, p] of [
  ['低抛 A', 0.35, 0.5], ['低抛 B', 0.4, 0.6], ['低抛 C', 0.45, 0.7],
  ['基准', 0.5, 0.8],
  ['高抛 A', 0.6, 0.9], ['高抛 B', 0.7, 1.0], ['高抛 C', 0.85, 1.2],
]) {
  const pr = { hStart: H * 0.01, hTurn: H * ht, p };
  const rr = fly(rk, pr);
  const ok = (rr.regime === Regime.ELLIPTIC || rr.regime === Regime.CIRCULAR) && rr.peri >= H * 0.9 && Number.isFinite(rr.apo);
  if (ok) routes.push({ name, ht, p, rr });
  line(`  ${name.padEnd(10)} ${String(ht * 100).padStart(7)} ${String(p).padStart(5)} ${(rr.peri / 1000).toFixed(1).padStart(9)} ${(Number.isFinite(rr.apo) ? rr.apo / 1000 : Infinity).toFixed(1).padStart(10)} ${(rr.maxQ / 1000).toFixed(1).padStart(8)} ${rr.t.toFixed(1).padStart(7)} ${(dvOf(rk) - rr.vEnd).toFixed(0).padStart(8)} ${(ok ? '✅入轨' : '❌').padStart(6)}`);
}
line('');
const lowOk = routes.filter((x) => x.ht <= 0.45).length;
const highOk = routes.filter((x) => x.ht >= 0.6).length;
line(`  低抛可行 ${lowOk} 条 · 高抛可行 ${highOk} 条  →  ${lowOk > 0 && highOk > 0 ? '✅ 无主导策略，自主性成立' : '⚠️ 仅单侧可行，存在主导策略风险'}`);

hdr('游标生命周期剖析（RT-1 核心：为 HUD 工程解法提供切换点依据）');
line('');
line(`  ${'T+s'.padStart(6)} ${'高度km'.padStart(7)} ${'速度'.padStart(7)} ${'水平速度'.padStart(8)} ${'水平占比'.padStart(8)} ${'动压kPa'.padStart(8)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(10)} ${'regime'.padStart(12)}`);
line('  ' + '─'.repeat(88));
for (const s of r.tr) {
  const ratio = s.v > 1 ? s.vt / s.v : 0;
  line(`  ${s.t.toFixed(1).padStart(6)} ${s.h.toFixed(2).padStart(7)} ${s.v.toFixed(0).padStart(7)} ${s.vt.toFixed(0).padStart(8)} ${(ratio * 100).toFixed(0).padStart(7)}% ${s.q.toFixed(1).padStart(8)} ${(Number.isFinite(s.peri) ? s.peri : NaN).toFixed(1).padStart(9)} ${(Number.isFinite(s.apo) ? s.apo.toFixed(1) : '∞').padStart(10)} ${s.reg.padStart(12)}`);
}
line('');
line(`  ⇒ 近地点首次有效于 T+${r.firstLive.toFixed(1)}s（全程 ${r.t.toFixed(0)}s 的第 ${(r.firstLive / r.t * 100).toFixed(0)}%）`);
line(`  ⇒ 前 ${(r.firstLive / r.t * 100).toFixed(0)}% 飞行中，「水平速度占比」与「高度」是全程连续可用的替代指标（见上表）`);
