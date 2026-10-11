/**
 * 共享弹道仿真核心（从 calibrate.mjs 提取，供各标定脚本复用）
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


/** 构造天体：由半径与地表重力反推 μ = g₀·R² */
function makeBody(R, g0) {
  return { R, g0, mu: g0 * R * R, name: `R=${R / 1000}km g0=${g0}` };
}

/** 构造火箭构型（可缩放干重 / Isp / 燃料） */
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

/** 火箭总 Δv（考虑燃料倍率 fs） */
function rocketDV(rk, fs = 1) {
  const m0 = rk.m0 + rk.s1.fuel * (fs - 1) + rk.s2.fuel * (fs - 1);
  const m1 = m0 - rk.s1.fuel * fs;
  const m2 = m1 - rk.s1.dry;
  const m3 = m2 - rk.s2.fuel * fs;
  return rk.ispg0 * Math.log(m0 / m1) + rk.ispg0 * Math.log(m2 / m3);
}

export { fly, makeBody, makeRocket, rocketDV, BASE_ROCKET, DT };
