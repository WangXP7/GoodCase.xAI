import { solveOrbit } from './tests/c1/orbit-solver.ref.mjs';

const R = 300000, G0 = 8.0, H = 15000, MU = G0 * R * R;
const ATM = { rho0: 1.2, scaleH: 2500, top: 12000 };
const s1f = 18900, s2f = 4500;
const RKc = { m0: 7000 + s1f + 3500 + s2f + 8500, s1: { dry: 7000, fuel: s1f, burn: 60 },
              s2: { dry: 3500, fuel: s2f, burn: 21 }, ispg0: 2900, A: 10, Cd0: 0.25, CdAlpha: 2.0 };
const rho = h => (h >= ATM.top || h < 0 ? 0 : ATM.rho0 * Math.exp(-h / ATM.scaleH));
const prog = { hStart: 150, hTurn: 7500, p: 0.8 };
const s1T = (RKc.s1.fuel / RKc.s1.burn) * RKc.ispg0;
const s2T = (RKc.s2.fuel / RKc.s2.burn) * RKc.ispg0;

function accel(rx, ry, vx, vy, theta, m, thrust, out, o) {
  const r = Math.sqrt(rx * rx + ry * ry), ux = rx / r, uy = ry / r, lx = uy, ly = -ux;
  const v = Math.sqrt(vx * vx + vy * vy);
  const ag = -MU / (r * r);
  let ax = ag * ux, ay = ag * uy;
  const ct = Math.cos(theta), st = Math.sin(theta);
  ax += (thrust / m) * (ct * lx + st * ux); ay += (thrust / m) * (ct * ly + st * uy);
  if (v > 0.5) {
    const gam = Math.atan2(vx * ux + vy * uy, vx * lx + vy * ly);
    const al = theta - gam, sa = Math.sin(al);
    const Cd = RKc.Cd0 + RKc.CdAlpha * sa * sa;
    const D = 0.5 * rho(r - R) * v * v * Cd * RKc.A;
    ax -= (D / m) * (vx / v); ay -= (D / m) * (vy / v);
  }
  out[o] = ax; out[o + 1] = ay;
}

function fly(DT, integ) {
  let rx = 0, ry = R, vx = 0, vy = 0, theta = Math.PI / 2, stage = 1;
  let m = RKc.m0, fuel1 = RKc.s1.fuel, fuel2 = RKc.s2.fuel, t = 0, steps = 0;
  const tau = 0.30, PR = 12 * Math.PI / 180, KA = 1.5e-5;
  let maxQ = 0, staged = false;
  const b = new Float64Array(8);
  while (t < 200) {
    const r0 = Math.sqrt(rx * rx + ry * ry), h0 = r0 - R, v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r0, uy = ry / r0, lx = uy, ly = -ux;
    const tc = h0 < prog.hStart ? Math.PI / 2
      : (Math.PI / 2) * Math.pow(1 - Math.min(1, Math.max(0, (h0 - prog.hStart) / (prog.hTurn - prog.hStart))), prog.p);
    const gam = v > 1 ? Math.atan2(vx * ux + vy * uy, vx * lx + vy * ly) : Math.PI / 2;
    const q = 0.5 * rho(h0) * v * v; if (q > maxQ) maxQ = q;
    let dT = (tc - theta) / tau + KA * q * (gam - theta);
    dT = dT > PR ? PR : (dT < -PR ? -PR : dT); theta += dT * DT;
    let th = 0, md = 0;
    if (stage === 1 && fuel1 > 0) { th = s1T; md = th / RKc.ispg0; fuel1 = Math.max(0, fuel1 - md * DT); }
    else if (stage === 2 && fuel2 > 0) { th = s2T; md = th / RKc.ispg0; fuel2 = Math.max(0, fuel2 - md * DT); }
    if (integ === 'semi') {
      accel(rx, ry, vx, vy, theta, m, th, b, 0);
      vx += b[0] * DT; vy += b[1] * DT; rx += vx * DT; ry += vy * DT;
    } else if (integ === 'expl') {
      accel(rx, ry, vx, vy, theta, m, th, b, 0);
      const ax0 = b[0], ay0 = b[1];
      rx += vx * DT; ry += vy * DT; vx += ax0 * DT; vy += ay0 * DT;
    } else {
      accel(rx, ry, vx, vy, theta, m, th, b, 0);
      const k1rx = vx, k1ry = vy, k1vx = b[0], k1vy = b[1];
      accel(rx + k1rx * DT / 2, ry + k1ry * DT / 2, vx + k1vx * DT / 2, vy + k1vy * DT / 2, theta, m, th, b, 2);
      const k2rx = vx + k1vx * DT / 2, k2ry = vy + k1vy * DT / 2, k2vx = b[2], k2vy = b[3];
      accel(rx + k2rx * DT / 2, ry + k2ry * DT / 2, vx + k2vx * DT / 2, vy + k2vy * DT / 2, theta, m, th, b, 4);
      const k3rx = vx + k2vx * DT / 2, k3ry = vy + k2vy * DT / 2, k3vx = b[4], k3vy = b[5];
      accel(rx + k3rx * DT, ry + k3ry * DT, vx + k3vx * DT, vy + k3vy * DT, theta, m, th, b, 6);
      const k4rx = vx + k3vx * DT, k4ry = vy + k3vy * DT, k4vx = b[6], k4vy = b[7];
      rx += DT / 6 * (k1rx + 2 * k2rx + 2 * k3rx + k4rx); ry += DT / 6 * (k1ry + 2 * k2ry + 2 * k3ry + k4ry);
      vx += DT / 6 * (k1vx + 2 * k2vx + 2 * k3vx + k4vx); vy += DT / 6 * (k1vy + 2 * k2vy + 2 * k3vy + k4vy);
    }
    m -= md * DT; t += DT; steps++;
    if (stage === 1 && fuel1 <= 0 && !staged) { m -= RKc.s1.dry + fuel1; fuel1 = 0; stage = 2; staged = true; }
    if (h0 <= 0 && t > 1) break;
    if (stage === 2 && fuel2 <= 0) break;
  }
  const fin = solveOrbit(rx, ry, vx, vy, { mu: MU, R }, {});
  const rE = Math.sqrt(rx * rx + ry * ry);
  return { t, maxQ, peri: fin.ap, apo: fin.aa, hEnd: rE - R, vEnd: Math.sqrt(vx * vx + vy * vy), steps,
           sx: rx, sy: ry, svx: vx, svy: vy };
}

function coast(sx, sy, svx, svy, DT, integ, T) {
  let rx = sx, ry = sy, vx = svx, vy = svy, t = 0;
  const eps0 = 0.5 * (vx * vx + vy * vy) - MU / Math.sqrt(rx * rx + ry * ry);
  let maxRel = 0; const b = new Float64Array(8); const M = 1e9;
  while (t < T) {
    if (integ === 'semi') { accel(rx, ry, vx, vy, 0, M, 0, b, 0); vx += b[0] * DT; vy += b[1] * DT; rx += vx * DT; ry += vy * DT; }
    else {
      accel(rx, ry, vx, vy, 0, M, 0, b, 0);
      const a1x = vx, a1y = vy, b1x = b[0], b1y = b[1];
      accel(rx + a1x * DT / 2, ry + a1y * DT / 2, vx + b1x * DT / 2, vy + b1y * DT / 2, 0, M, 0, b, 2);
      const a2x = vx + b1x * DT / 2, a2y = vy + b1y * DT / 2, b2x = b[2], b2y = b[3];
      accel(rx + a2x * DT / 2, ry + a2y * DT / 2, vx + b2x * DT / 2, vy + b2y * DT / 2, 0, M, 0, b, 4);
      const a3x = vx + b2x * DT / 2, a3y = vy + b2y * DT / 2, b3x = b[4], b3y = b[5];
      accel(rx + a3x * DT, ry + a3y * DT, vx + b3x * DT, vy + b3y * DT, 0, M, 0, b, 6);
      const a4x = vx + b3x * DT, a4y = vy + b3y * DT, b4x = b[6], b4y = b[7];
      rx += DT / 6 * (a1x + 2 * a2x + 2 * a3x + a4x); ry += DT / 6 * (a1y + 2 * a2y + 2 * a3y + a4y);
      vx += DT / 6 * (b1x + 2 * b2x + 2 * b3x + b4x); vy += DT / 6 * (b1y + 2 * b2y + 2 * b3y + b4y);
    }
    t += DT;
    const eps = 0.5 * (vx * vx + vy * vy) - MU / Math.sqrt(rx * rx + ry * ry);
    const rel = Math.abs((eps - eps0) / eps0); if (rel > maxRel) maxRel = rel;
  }
  return maxRel;
}

const L = [];
L.push('=== A. 步长敏感度（半隐式欧拉 · 基准弹道 hStart=150m hTurn=7.5km p=0.8）===');
L.push('DT        steps     t(s)   maxQ(kPa)   peri(km)    apo(km)   hEnd(km)   vEnd(m/s)');
for (const inv of [30, 60, 120, 240, 480]) {
  const r = fly(1 / inv, 'semi');
  L.push(('1/' + inv).padEnd(10) + String(r.steps).padStart(6) + r.t.toFixed(3).padStart(9)
    + (r.maxQ / 1000).toFixed(3).padStart(11) + (r.peri / 1000).toFixed(4).padStart(11)
    + (r.apo / 1000).toFixed(1).padStart(11) + (r.hEnd / 1000).toFixed(3).padStart(10)
    + r.vEnd.toFixed(1).padStart(11));
}
L.push('');
const ref = fly(1 / 480, 'semi');
L.push('以 1/480 为参考的偏差：');
for (const inv of [30, 60, 120, 240]) {
  const r = fly(1 / inv, 'semi');
  L.push(('  1/' + inv).padEnd(9) + ' dPeri=' + (r.peri - ref.peri).toFixed(1).padStart(9) + ' m'
    + '  dMaxQ=' + ((r.maxQ - ref.maxQ) / 1000).toFixed(4).padStart(9) + ' kPa'
    + '  dT=' + (r.t - ref.t).toFixed(4).padStart(8) + ' s');
}
L.push('');
L.push('=== B. 积分器对照（DT=1/120）===');
const base = fly(1 / 120, 'semi');
for (const it of ['semi', 'expl', 'rk4']) {
  const r = fly(1 / 120, it);
  L.push(it.padEnd(6) + ' t=' + r.t.toFixed(3) + 's  maxQ=' + (r.maxQ / 1000).toFixed(3) + 'kPa  peri='
    + (r.peri / 1000).toFixed(4) + 'km  dPeri_vs_semi=' + (r.peri - base.peri).toFixed(1) + 'm  dT=' + (r.t - base.t).toFixed(4) + 's');
}
L.push('');
L.push('=== C. 无推力无阻力滑行 81s 的比机械能最大漂移 |dEps/eps0| ===');
for (const it of ['semi', 'rk4']) {
  L.push(it.padEnd(6) + '  1/120 -> ' + (coast(base.sx, base.sy, base.svx, base.svy, 1 / 120, it, 81) * 100).toExponential(3) + ' %'
    + '   |  1/60 -> ' + (coast(base.sx, base.sy, base.svx, base.svy, 1 / 60, it, 81) * 100).toExponential(3) + ' %');
}
L.push('');
L.push('=== D. 单步成本（半隐式欧拉 · DT=1/120 · 取 15 次最佳）===');
let best = 1e18;
for (let i = 0; i < 15; i++) {
  const s = process.hrtime.bigint(); fly(1 / 120, 'semi'); const e = process.hrtime.bigint();
  const ns = Number(e - s) / base.steps; if (ns < best) best = ns;
}
L.push('  ' + best.toFixed(1) + ' ns/步（含姿态 + 质量流 + 阻力全部计算）');
L.push('  120 步/秒 = ' + (best * 120 / 1000).toFixed(3) + ' us/s');
L.push('  60fps 单帧 2 步 = ' + (best * 2 / 1000).toFixed(4) + ' us/帧 = 帧预算(16.67ms)的 ' + (best * 2 / 16670 * 100).toFixed(5) + '%');
L.push('');
L.push('=== E. 轨道解算成本（RT-1 称 58 ns/次）===');
let bo = 1e18;
for (let i = 0; i < 10; i++) {
  const N = 200000; const o = {};
  const s = process.hrtime.bigint();
  for (let k = 0; k < N; k++) solveOrbit(base.sx + k * 0.01, base.sy, base.svx, base.svy, { mu: MU, R }, o);
  const e = process.hrtime.bigint();
  const ns = Number(e - s) / N; if (ns < bo) bo = ns;
}
L.push('  ' + bo.toFixed(1) + ' ns/次');
L.push('  120Hz 解算 = ' + (bo * 120 / 1000).toFixed(4) + ' us/s = 60fps 单帧(2次) ' + (bo * 2 / 1000).toFixed(5) + ' us');
L.push('  物理步总成本（积分 + 解算）= ' + (best + bo).toFixed(1) + ' ns/步');
L.push('');
L.push('=== F. RT-1 基准复现核对 ===');
L.push('  peri=' + (base.peri / 1000).toFixed(2) + ' km   t=' + base.t.toFixed(1) + ' s   maxQ='
  + (base.maxQ / 1000).toFixed(1) + ' kPa   TWR0=' + (s1T / (RKc.m0 * G0)).toFixed(3)
  + '   dV=' + (RKc.ispg0 * Math.log(RKc.m0 / 23500) + RKc.ispg0 * Math.log(16500 / 12000)).toFixed(0) + ' m/s');
console.log(L.join('\n'));
