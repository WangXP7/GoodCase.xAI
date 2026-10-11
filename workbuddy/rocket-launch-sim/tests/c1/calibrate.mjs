/**
 * RT-1 · 行星与火箭重标定 —— 参数扫描寻优
 *
 * 背景：verify.mjs T4 扫描 240 组参数，入轨成功 0 组。
 *       峰值动压 164.9 kPa（Falcon 9 实测约 30 kPa），近地点游标存活率仅 12%。
 *
 * 主理人诊断（本脚本负责证伪/证实）：
 *   ① 目标轨道定错了：Planet-C R=300km 却照搬地球 LEO 100km ⇒ 轨道半径 1.33R
 *      （地球 LEO 仅 1.016R）⇒ Δv 需求爆炸。
 *   ② 最优动力时长 T* = √(2H/g₀)。当前 H=100km/g₀=12 ⇒ T*=129s，
 *      而 MVP 锁定 T≈50s，落在「垂直速度代价爆炸」一侧。
 *
 * 修法：同时调 g₀ 与 H，使 T* 落入 60–90s，且轨道半径/R 接近 1.05–1.17。
 *       大气顶必须低于目标轨道，否则轨道在大气内会衰减。
 *
 * 零依赖 · Node headless · 可复现
 */

import { solveOrbit, Regime } from './orbit-solver.ref.mjs';

// ── 扫描配置 ────────────────────────────────────────────────────────────────
const DT = 1 / 120;          // 物理步长（T3 已验证 Δt=1/120 精度米级）
const SAMPLE_EVERY = 12;     // 游标存活率抽样（10 Hz）

// 火箭基线构型（沿用 verify.mjs ROCKET，Δv ≈ 2833 m/s）
const BASE_ROCKET = {
  m0: 45000,
  s1: { dry: 7000, fuel: 21000, burn: 37 },
  s2: { dry: 3500, fuel: 5000, burn: 13 },
  payload: 8500,
  ispg0: 2900,
  A: 10.0, Cd0: 0.25, CdAlpha: 2.0,
  maxQ: 200000,
};

/**
 * 飞一次完整弹道（参数化版本）。
 * @param {object} body  { R, g0, mu }
 * @param {object} atm   { rho0, H, top }
 * @param {object} rocket 构型
 * @param {object} prog  { hStart, hTurn, p } 幂律俯仰程序
 * @param {number} fuelScale 燃料倍率
 * @param {number} burnScale 燃时倍率
 */
function fly(body, atm, rocket, prog, fuelScale = 1, burnScale = 1) {
  const { mu, R } = body;
  const R_ = rocket;

  const rho = (h) => (h >= atm.top || h < 0 ? 0 : atm.rho0 * Math.exp(-h / atm.H));

  let rx = 0, ry = R, vx = 0, vy = 0;
  let theta = Math.PI / 2;
  let stage = 1;
  let m = R_.m0 + R_.s1.fuel * (fuelScale - 1) + R_.s2.fuel * (fuelScale - 1);
  let fuel1 = R_.s1.fuel * fuelScale, fuel2 = R_.s2.fuel * fuelScale;
  let t = 0, step = 0;

  const tau = 0.30;
  const PITCH_RATE = 12 * Math.PI / 180;
  const K_AERO = 1.5e-5;

  const s1Thrust = (R_.s1.fuel * fuelScale / (R_.s1.burn * burnScale)) * R_.ispg0;
  const s2Thrust = (R_.s2.fuel * fuelScale / (R_.s2.burn * burnScale)) * R_.ispg0;
  const twr0 = s1Thrust / (m * (mu / (R * R)));   // 起飞推重比

  let nSample = 0, nLive = 0, firstLiveT = -1;
  let maxQseen = 0, dead = null, deadT = 0, staged = false;
  const solverOut = {};
  const MAX_T = 60 * burnScale + 90;

  while (t < MAX_T) {
    const r = Math.sqrt(rx * rx + ry * ry);
    const h = r - R;
    const v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r, uy = ry / r;
    const lx = uy, ly = -ux;

    // 幂律俯仰程序
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
      thrust = s1Thrust; mdot = thrust / R_.ispg0;
      fuel1 = Math.max(0, fuel1 - mdot * DT);
    } else if (stage === 2 && fuel2 > 0) {
      thrust = s2Thrust; mdot = thrust / R_.ispg0;
      fuel2 = Math.max(0, fuel2 - mdot * DT);
    }

    const nx = Math.cos(theta) * lx + Math.sin(theta) * ux;
    const ny = Math.cos(theta) * ly + Math.sin(theta) * uy;

    const ag = -mu / (r * r);
    let ax = ag * ux, ay = ag * uy;
    ax += (thrust / m) * nx;
    ay += (thrust / m) * ny;

    if (v > 0.5) {
      const alpha = theta - gam;
      const Cd = R_.Cd0 + R_.CdAlpha * Math.sin(alpha) ** 2;
      const D = 0.5 * rho(h) * v * v * Cd * R_.A;
      ax -= (D / m) * (vx / v);
      ay -= (D / m) * (vy / v);
    }

    vx += ax * DT; vy += ay * DT;
    rx += vx * DT; ry += vy * DT;
    m -= mdot * DT;
    t += DT;

    if (stage === 1 && fuel1 <= 0 && !staged) {
      m -= R_.s1.dry; stage = 2; staged = true;
    }

    solveOrbit(rx, ry, vx, vy, body, solverOut);
    if (step % SAMPLE_EVERY === 0) {
      nSample++;
      if (solverOut.regime !== Regime.SUBORBITAL) {
        nLive++;
        if (firstLiveT < 0) firstLiveT = t;
      }
    }
    step++;

    if (h <= 0 && t > 1) { dead = 'IMPACT'; deadT = t; break; }
    if (q > R_.maxQ) { dead = 'STRUCTURAL_MAXQ'; deadT = t; break; }
    if (stage === 2 && fuel2 <= 0) break;
    if (t > MAX_T - DT) { dead = 'TIMEOUT'; deadT = t; break; }
  }

  const final = solveOrbit(rx, ry, vx, vy, body, {});
  const rEnd = Math.sqrt(rx * rx + ry * ry);
  const hEnd = rEnd - R;
  const vEnd = Math.sqrt(vx * vx + vy * vy);

  return {
    t, maxQ: maxQseen, twr0,
    liveFrac: nSample > 0 ? nLive / nSample : 0,
    firstLiveT,
    peri: final.ap, apo: final.aa, regime: final.regime,
    hEnd, vEnd, dead, deadT,
  };
}

// ── 扫描：g₀ × H_target ────────────────────────────────────────────────────
const line = (s = '') => console.log(s);
const hdr = (s) => { line(); line('═'.repeat(84)); line('  ' + s); line('═'.repeat(84)); };

function makeBody(R, g0) {
  return { R, g0, mu: g0 * R * R, name: `R=${R / 1000}km g0=${g0}` };
}

hdr('扫描 A · 固定火箭构型（Δv≈2833），扫描 g₀ × 目标高度 H');
line('  火箭 Δv = 2833 m/s（一级 1823 + 二级 1010）；大气顶 = H × 0.8');
line('');
line(`  ${'g₀'.padStart(5)} ${'H(km)'.padStart(7)} ${'T*(s)'.padStart(8)} ${'r/R'.padStart(7)} ${'v_c'.padStart(7)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(9)} ${'动压kPa'.padStart(8)} ${'存活率'.padStart(7)} ${'时长s'.padStart(7)} ${'TWR'.padStart(6)} ${'结果'.padStart(6)}`);
line('  ' + '─'.repeat(100));

const results = [];
for (const g0 of [4, 6, 8, 12]) {
  for (const Hkm of [10, 15, 20, 30, 40, 50, 100]) {
    const R = 300000;
    const H = Hkm * 1000;
    const body = makeBody(R, g0);
    const atm = { rho0: 1.2, H: 2500, top: H * 0.8 };
    // 重力转弯程序随目标高度缩放
    const prog = { hStart: H * 0.005, hTurn: H * 0.25, p: 0.5 };
    const r = fly(body, atm, BASE_ROCKET, prog);
    const Tstar = Math.sqrt((2 * H) / g0);
    const vc = Math.sqrt(body.mu / (R + H));
    const ok = r.peri >= H * 0.9 && r.regime !== Regime.SUBORBITAL;
    results.push({ g0, Hkm, Tstar, r, ok });
    line(`  ${String(g0).padStart(5)} ${String(Hkm).padStart(7)} ${Tstar.toFixed(1).padStart(8)} ${((R + H) / R).toFixed(3).padStart(7)} ${vc.toFixed(0).padStart(7)} ${(r.peri / 1000).toFixed(1).padStart(9)} ${(Number.isFinite(r.apo) ? r.apo / 1000 : Infinity).toFixed(1).padStart(9)} ${(r.maxQ / 1000).toFixed(1).padStart(8)} ${(r.liveFrac * 100).toFixed(0).padStart(6)}% ${r.t.toFixed(1).padStart(7)} ${r.twr0.toFixed(2).padStart(6)} ${(ok ? '✅入轨' : '❌').padStart(6)}`);
  }
}

// ── 细扫：在最优 g₀/H 组合上，扫飞行程序与燃料倍率 ──────────────────────────
const viable = results.filter((x) => x.ok);
hdr('扫描 B · 在可行组合上细扫飞行程序（p = 幂律指数，hTurn = 倾倒完成高度占比）');

line('');
if (viable.length === 0) {
  line('  ⚠️ 扫描 A 无可行解 —— 需要调整火箭构型（提高 Δv）。进入扫描 C。');
} else {
  const best = viable[0];
  line(`  基准组合：g₀=${best.g0}  H=${best.Hkm}km`);
  line('');
  line(`  ${'p'.padStart(5)} ${'hTurn%'.padStart(7)} ${'燃料x'.padStart(7)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(9)} ${'动压kPa'.padStart(8)} ${'存活率'.padStart(7)} ${'时长s'.padStart(7)} ${'结果'.padStart(6)}`);
  line('  ' + '─'.repeat(80));
  const R = 300000, H = best.Hkm * 1000;
  const body = makeBody(R, best.g0);
  const atm = { rho0: 1.2, H: 2500, top: H * 0.8 };
  for (const p of [0.3, 0.5, 0.7, 1.0, 1.5]) {
    for (const ht of [0.15, 0.25, 0.4]) {
      for (const fs of [1.0, 1.3]) {
        const prog = { hStart: H * 0.005, hTurn: H * ht, p };
        const r = fly(body, atm, BASE_ROCKET, prog, fs);
        const ok = r.peri >= H * 0.9 && r.regime !== Regime.SUBORBITAL;
        line(`  ${String(p).padStart(5)} ${String(ht * 100).padStart(7)} ${String(fs).padStart(7)} ${(r.peri / 1000).toFixed(1).padStart(9)} ${(Number.isFinite(r.apo) ? r.apo / 1000 : Infinity).toFixed(1).padStart(9)} ${(r.maxQ / 1000).toFixed(1).padStart(8)} ${(r.liveFrac * 100).toFixed(0).padStart(6)}% ${r.t.toFixed(1).padStart(7)} ${(ok ? '✅' : '❌').padStart(6)}`);
      }
    }
  }
}

// ── 扫描 C：提高火箭 Δv（增 Isp / 减干重），重跑最优 g₀/H ────────────────────
hdr('扫描 C · 提高火箭 Δv（减干重 / 提 Isp）后重扫');

function makeRocket({ dryScale = 1, ispg0 = 2900, fuelScaleCfg = 1 } = {}) {
  return {
    m0: 45000,
    s1: { dry: 7000 * dryScale, fuel: 21000 * fuelScaleCfg, burn: 37 },
    s2: { dry: 3500 * dryScale, fuel: 5000 * fuelScaleCfg, burn: 13 },
    payload: 8500 * dryScale,
    ispg0,
    A: 10.0, Cd0: 0.25, CdAlpha: 2.0,
    maxQ: 200000,
  };
}

function deltaV(rk) {
  const m0 = rk.m0;
  const m1 = m0 - rk.s1.fuel;
  const m2 = m1 - rk.s1.dry;
  const m3 = m2 - rk.s2.fuel;
  return rk.ispg0 * Math.log(m0 / m1) + rk.ispg0 * Math.log(m2 / m3);
}

line('');
line(`  ${'干重x'.padStart(6)} ${'Isp·g0'.padStart(8)} ${'Δv(m/s)'.padStart(9)} ${'g₀'.padStart(4)} ${'H(km)'.padStart(6)} ${'近地点km'.padStart(9)} ${'动压kPa'.padStart(8)} ${'存活率'.padStart(7)} ${'时长s'.padStart(7)} ${'TWR'.padStart(6)} ${'结果'.padStart(6)}`);
line('  ' + '─'.repeat(88));

const winners = [];
for (const dryScale of [0.5, 0.7, 1.0]) {
  for (const ispg0 of [2900, 3400, 3900]) {
    const rk = makeRocket({ dryScale, ispg0 });
    const dv = deltaV(rk);
    for (const g0 of [6, 8, 12]) {
      for (const Hkm of [15, 20, 30, 40]) {
        const R = 300000, H = Hkm * 1000;
        const body = makeBody(R, g0);
        const atm = { rho0: 1.2, H: 2500, top: H * 0.8 };
        const prog = { hStart: H * 0.005, hTurn: H * 0.25, p: 0.5 };
        const r = fly(body, atm, rk, prog);
        const ok = r.peri >= H * 0.9 && r.regime !== Regime.SUBORBITAL;
        if (ok) winners.push({ dryScale, ispg0, dv, g0, Hkm, r });
        line(`  ${String(dryScale).padStart(6)} ${String(ispg0).padStart(8)} ${dv.toFixed(0).padStart(9)} ${String(g0).padStart(4)} ${String(Hkm).padStart(6)} ${(r.peri / 1000).toFixed(1).padStart(9)} ${(r.maxQ / 1000).toFixed(1).padStart(8)} ${(r.liveFrac * 100).toFixed(0).padStart(6)}% ${r.t.toFixed(1).padStart(7)} ${r.twr0.toFixed(2).padStart(6)} ${(ok ? '✅' : '❌').padStart(6)}`);
      }
    }
  }
}

line('');
line(`  可行解总数：${winners.length}`);
