/**
 * P2-DES-001 · Ω 鲁棒性检验（含失败弹道 / 极端倾倒）
 * 系数沿用 omega-calib.mjs 的冠军解：wA=0.45 wB=0.55 Ω_crit=1.60 γ=0.55
 */
import { solveOrbit, Regime } from './orbit-solver.ref.mjs';

const DT = 1 / 120, R = 300000, G0 = 8.0, H = 15000, MU = G0 * R * R;
const VC = Math.sqrt(MU / (R + H));
const ATM = { rho0: 1.2, scaleH: 2500, top: 12000 };

function mk() {
  const s1f = 18900, s2f = 4500;
  return { m0: 7000 + s1f + 3500 + s2f + 8500, s1: { dry: 7000, fuel: s1f, burn: 60 }, s2: { dry: 3500, fuel: s2f, burn: 21 }, ispg0: 2900, A: 10.0, Cd0: 0.25, CdAlpha: 2.0 };
}

function fly(rk, prog, every = 6) {
  const rho = (h) => (h >= ATM.top || h < 0 ? 0 : ATM.rho0 * Math.exp(-h / ATM.scaleH));
  let rx = 0, ry = R, vx = 0, vy = 0, theta = Math.PI / 2, stage = 1;
  let m = rk.m0, f1 = rk.s1.fuel, f2 = rk.s2.fuel, t = 0, step = 0;
  const tau = 0.30, PR = 12 * Math.PI / 180, KA = 1.5e-5;
  const s1T = (rk.s1.fuel / rk.s1.burn) * rk.ispg0, s2T = (rk.s2.fuel / rk.s2.burn) * rk.ispg0;
  let maxQ = 0, dead = null, staged = false;
  const out = {}; const tr = [];
  while (t < 200) {
    const r = Math.sqrt(rx * rx + ry * ry), h = r - R, v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r, uy = ry / r, lx = uy, ly = -ux;
    const tc = h < prog.hStart ? Math.PI / 2 : (Math.PI / 2) * Math.pow(1 - Math.min(1, Math.max(0, (h - prog.hStart) / (prog.hTurn - prog.hStart))), prog.p);
    const gam = v > 1 ? Math.atan2(vx * ux + vy * uy, vx * lx + vy * ly) : Math.PI / 2;
    const q = 0.5 * rho(h) * v * v; if (q > maxQ) maxQ = q;
    let dT = (tc - theta) / tau + KA * q * (gam - theta);
    dT = Math.max(-PR, Math.min(PR, dT)); theta += dT * DT;
    let th = 0, md = 0;
    if (stage === 1 && f1 > 0) { th = s1T; md = th / rk.ispg0; f1 = Math.max(0, f1 - md * DT); }
    else if (stage === 2 && f2 > 0) { th = s2T; md = th / rk.ispg0; f2 = Math.max(0, f2 - md * DT); }
    const nx = Math.cos(theta) * lx + Math.sin(theta) * ux, ny = Math.cos(theta) * ly + Math.sin(theta) * uy;
    const ag = -MU / (r * r); let ax = ag * ux, ay = ag * uy;
    ax += (th / m) * nx; ay += (th / m) * ny;
    if (v > 0.5) {
      const al = theta - gam, Cd = rk.Cd0 + rk.CdAlpha * Math.sin(al) ** 2;
      const D = 0.5 * rho(h) * v * v * Cd * rk.A; ax -= (D / m) * (vx / v); ay -= (D / m) * (vy / v);
    }
    vx += ax * DT; vy += ay * DT; rx += vx * DT; ry += vy * DT; m -= md * DT; t += DT;
    if (stage === 1 && f1 <= 0 && !staged) { m -= rk.s1.dry; stage = 2; staged = true; }
    solveOrbit(rx, ry, vx, vy, { mu: MU, R }, out);
    if (step % every === 0) tr.push({ t, h, v, vt: vx * lx + vy * ly, q, peri: out.ap, apo: out.aa, reg: out.regime });
    step++;
    if (h <= 0 && t > 1) { dead = 'IMPACT'; break; }
    if (q > 200000) { dead = 'MAXQ'; break; }
    if (stage === 2 && f2 <= 0) break;
    if (t > 200 - DT) { dead = 'TIMEOUT'; break; }
  }
  return { t, maxQ, dead, tr, peri: out.ap, apo: out.aa, regime: out.regime };
}

const G = (h) => (h < 0 ? 0.60 * (1 + h / R) : Math.min(1, 0.60 + 0.40 * (h / H)));
const OMG = (s) => 0.45 * (s.h / H) + 0.55 * Math.pow(s.vt / VC, 2);
const OC = 1.60, GA = 0.55;
const line = (s = '') => console.log(s);
const pad = (x, n) => String(x).padStart(n);

line('\n  Ω 鲁棒性检验（含失败 / 极端弹道）·  wA=0.45  wB=0.55  Ω_crit=1.60  γ=0.55');
line('  ' + '弹道'.padEnd(18) + pad('结局', 12) + pad('时长s', 7) + pad('末Ω%', 8) + pad('峰值Ω%', 8) + pad('回退max', 10) + pad('切换T+', 9) + pad('最小8s增量', 11));
line('  ' + '─'.repeat(84));

const rk = mk();
const cases = [
  ['基准 50%/0.8', { hStart: 150, hTurn: 7500, p: 0.8 }],
  ['低抛 35%/0.5', { hStart: 150, hTurn: 5250, p: 0.5 }],
  ['高抛 85%/1.2', { hStart: 150, hTurn: 12750, p: 1.2 }],
  ['极早倾倒 10%/0.3', { hStart: 150, hTurn: 1500, p: 0.3 }],
  ['急抛 20%/0.2', { hStart: 150, hTurn: 3000, p: 0.2 }],
  ['极晚倾倒 130%/2.0', { hStart: 150, hTurn: 19500, p: 2.0 }],
  ['不倾倒 200%/3.0', { hStart: 150, hTurn: 30000, p: 3.0 }],
  ['超高抛 150%/2.5', { hStart: 150, hTurn: 22500, p: 2.5 }],
];
for (const [name, pr] of cases) {
  const r = fly(rk, pr); const tr = r.tr; const N = tr.length;
  const om = new Array(N); let po = -Infinity, drop = 0;
  for (let i = 0; i < N; i++) { const o = OMG(tr[i]); if (o < po) drop = Math.max(drop, po - o); po = Math.max(po, o); om[i] = o; }
  const s = new Array(N); let tSw = -1;
  for (let i = 0; i < N; i++) {
    const hEq = -R * (1 - Math.min(om[i] / OC, 1));
    if (tSw < 0 && tr[i].peri > hEq) tSw = tr[i].t;
    s[i] = Math.pow(G(Math.max(hEq, tr[i].peri)), GA);
  }
  const dt = tr[1].t - tr[0].t, K = Math.round(8 / dt);
  let min8 = Infinity;
  for (let i = 0; i + K < N; i++) min8 = Math.min(min8, s[i + K] - s[i]);
  const ok = (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR) && r.peri >= H * 0.9;
  line('  ' + name.padEnd(18) + String(r.dead ?? (ok ? '入轨' : '未入轨')).padEnd(12) + pad(r.t.toFixed(1), 7) + pad((s[N - 1] * 100).toFixed(1), 8) + pad((Math.max(...s) * 100).toFixed(1), 8) + pad(drop.toExponential(1), 10) + pad(tSw < 0 ? '—' : tSw.toFixed(1), 9) + pad(N > K ? (min8 * 100).toFixed(2) + '%' : 'n/a', 11));
}
line('');
