/**
 * P2-DES-001 · Ω 复合指标标定（v2 · 参数寻优）
 *
 * 背景：RT-1 §6 建议 Ω = f(水平速度占比, 高度/H)。实测发现该线性加权在 T+58s 即饱和
 *       （A=1.0 于 T+61s、B=0.99 于 T+40s），末段 23% 飞行进度条钉死，P2 不成立。
 *
 * 本脚本：
 *   1. 复核 7 条弹道（RT-1 §5）
 *   2. 检验「真实近地点是否真的全程钉死在 −300 km」（RT-1 §6 前提）
 *   3. 在 5 个候选函数族上寻优，目标 = 最大化「任意 8 秒窗口内的最小进度增量」
 *   4. 输出最终系数、切换时刻、连续性断言
 *
 * 架构（本脚本验证的核心设计）：
 *   h_eq   = −R·(1 − Ω₀/Ω_crit)        合成代理量，−R → 0
 *   h_disp = max(h_eq, h_p)            取「更靠前」的那个 —— 天然连续、天然单调
 *   G(h)   = 0.60·(1+h/R)      h<0     折线压缩标尺
 *          = 0.60+0.40·(h/H)   h≥0
 *   s      = G(h_disp)^γ               γ = 感知伽马
 */

import { solveOrbit, Regime } from './orbit-solver.ref.mjs';

// ── RT-1 标定常量（只读）──────────────────────────────────────────────
const DT = 1 / 120;
const R = 300000;
const G0 = 8.0;
const H = 15000;
const MU = G0 * R * R;
const VC = Math.sqrt(MU / (R + H));
const ATM = { rho0: 1.2, scaleH: 2500, top: 12000 };

function makeRocket(fs = 0.9, burn1 = 60, burn2 = 21) {
  const s1f = 21000 * fs, s2f = 5000 * fs;
  return {
    m0: 7000 + s1f + 3500 + s2f + 8500,
    s1: { dry: 7000, fuel: s1f, burn: burn1 },
    s2: { dry: 3500, fuel: s2f, burn: burn2 },
    ispg0: 2900, A: 10.0, Cd0: 0.25, CdAlpha: 2.0,
  };
}

function fly(rk, prog, every = 6) {
  const rho = (h) => (h >= ATM.top || h < 0 ? 0 : ATM.rho0 * Math.exp(-h / ATM.scaleH));
  let rx = 0, ry = R, vx = 0, vy = 0, theta = Math.PI / 2, stage = 1;
  let m = rk.m0, fuel1 = rk.s1.fuel, fuel2 = rk.s2.fuel, t = 0, step = 0;
  const tau = 0.30, PITCH_RATE = 12 * Math.PI / 180, K_AERO = 1.5e-5;
  const s1T = (rk.s1.fuel / rk.s1.burn) * rk.ispg0;
  const s2T = (rk.s2.fuel / rk.s2.burn) * rk.ispg0;
  const twr0 = s1T / (m * G0);
  let maxQ = 0, dead = null, staged = false;
  const out = {}; const tr = [];
  while (t < 200) {
    const r = Math.sqrt(rx * rx + ry * ry), h = r - R, v = Math.sqrt(vx * vx + vy * vy);
    const ux = rx / r, uy = ry / r, lx = uy, ly = -ux;
    const tc = h < prog.hStart ? Math.PI / 2 : (Math.PI / 2) * Math.pow(1 - Math.min(1, Math.max(0, (h - prog.hStart) / (prog.hTurn - prog.hStart))), prog.p);
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
    if (stage === 1 && fuel1 <= 0 && !staged) { m -= rk.s1.dry; stage = 2; staged = true; }
    solveOrbit(rx, ry, vx, vy, { mu: MU, R }, out);
    if (step % every === 0) tr.push({ t, h, v, vt: vx * lx + vy * ly, q, peri: out.ap, apo: out.aa, reg: out.regime });
    step++;
    if (h <= 0 && t > 1) { dead = 'IMPACT'; break; }
    if (q > 200000) { dead = 'MAXQ'; break; }
    if (stage === 2 && fuel2 <= 0) break;
    if (t > 200 - DT) { dead = 'TIMEOUT'; break; }
  }
  const rEnd = Math.sqrt(rx * rx + ry * ry);
  const ux = rx / rEnd, uy = ry / rEnd, lx = uy, ly = -ux;
  const fin = solveOrbit(rx, ry, vx, vy, { mu: MU, R }, {});
  return { t, maxQ, twr0, dead, tr, peri: fin.ap, apo: fin.aa, regime: fin.regime, hEnd: rEnd - R, vEnd: Math.sqrt(vx * vx + vy * vy), vtEnd: vx * lx + vy * ly };
}

const line = (s = '') => console.log(s);
const hdr = (s) => { line(); line('═'.repeat(104)); line('  ' + s); line('═'.repeat(104)); };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const rk = makeRocket();
const ROUTES = [
  ['低抛A', 0.35, 0.5], ['低抛B', 0.40, 0.6], ['低抛C', 0.45, 0.7],
  ['基准', 0.50, 0.8],
  ['高抛A', 0.60, 0.9], ['高抛B', 0.70, 1.0], ['高抛C', 0.85, 1.2],
];
const runs = ROUTES.map(([name, ht, p]) => ({ name, ht, p, r: fly(rk, { hStart: H * 0.01, hTurn: H * ht, p }) }));

// ══ 1. 弹道复核 ═══════════════════════════════════════════════════════
hdr('1. 弹道复核（对照 RT-1 §5）');
line(`  ${'路线'.padEnd(7)} ${'hTurn%'.padStart(6)} ${'p'.padStart(5)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(10)} ${'动压kPa'.padStart(8)} ${'时长s'.padStart(7)} ${'Δv损失'.padStart(8)} ${'判定'.padStart(7)}`);
line('  ' + '─'.repeat(72));
for (const x of runs) {
  const r = x.r;
  const ok = (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR) && r.peri >= H * 0.9 && Number.isFinite(r.apo);
  const dvCap = 2900 * Math.log(rk.m0 / (rk.m0 - rk.s1.fuel)) + 2900 * Math.log((rk.m0 - rk.s1.fuel - rk.s1.dry) / (rk.m0 - rk.s1.fuel - rk.s1.dry - rk.s2.fuel));
  line(`  ${x.name.padEnd(7)} ${String(x.ht * 100).padStart(6)} ${String(x.p).padStart(5)} ${(r.peri / 1000).toFixed(2).padStart(9)} ${(r.apo / 1000).toFixed(1).padStart(10)} ${(r.maxQ / 1000).toFixed(1).padStart(8)} ${r.t.toFixed(1).padStart(7)} ${(dvCap - r.vEnd).toFixed(0).padStart(8)} ${(ok ? '✅入轨' : '❌').padStart(7)}`);
}

// ══ 2. 检验 RT-1 §6 前提：真实近地点是否全程钉死 −300 km？══════════════
hdr('2. 证伪 RT-1 §6 前提：真实近地点数值的生命周期（基准弹道）');
line(`  ${'T+s'.padStart(6)} ${'高度km'.padStart(8)} ${'A=h/H'.padStart(7)} ${'B=vh/v'.padStart(8)} ${'vh/vc'.padStart(7)} ${'近地点km'.padStart(10)} ${'G(h_p)'.padStart(8)} ${'regime'.padStart(11)}`);
line('  ' + '─'.repeat(74));
const b = runs.find((x) => x.name === '基准').r;
const Gneg = (h) => 0.60 * (1 + h / R);
for (const s of b.tr) {
  if (Math.abs(s.t % 5) > 0.026 && Math.abs(s.t % 5 - 5) > 0.026) continue;
  line(`  ${s.t.toFixed(1).padStart(6)} ${(s.h / 1000).toFixed(3).padStart(8)} ${clamp01(s.h / H).toFixed(3).padStart(7)} ${(s.v < 1 ? 0 : clamp01(s.vt / s.v)).toFixed(3).padStart(8)} ${(s.vt / VC).toFixed(3).padStart(7)} ${(s.peri / 1000).toFixed(2).padStart(10)} ${Gneg(s.peri).toFixed(3).padStart(8)} ${String(s.reg).padStart(11)}`);
}
line('');
line('  ⇒ 近地点**数值**自 T+30 起已持续上升（−300 → −296 → −282 → −248 → −166 → −89 → −30 → 0 → +15）');
line('  ⇒ 「钉死 −300 km」是 orbit-solver 的 toDisplay() 把负值夹紧到 0 + regime=SUBORBITAL 双重夹紧的结果，不是物理');
line('  ⇒ 结论：改用「折线压缩标尺 G」后，真实近地点自 T+50 起即可读，不必全程依赖合成指标');

// ══ 3. 候选函数族 ═════════════════════════════════════════════════════
const V_EPS = 1.0;
const FORMS = {
  'F1 加权和(A夹紧)': (s, w) => w.a * clamp01(s.h / H) + w.b * (s.v < V_EPS ? 0 : clamp01(s.vt / s.v)),
  'F2 加权和(A不夹)': (s, w) => w.a * (s.h / H) + w.b * (s.v < V_EPS ? 0 : clamp01(s.vt / s.v)),
  'F3 乘积 A^p·B^q ': (s, w) => Math.pow(Math.max(1e-6, s.h / H), w.a) * Math.pow(Math.max(1e-6, s.v < V_EPS ? 1e-6 : clamp01(s.vt / s.v)), w.b),
  'F4 加权和(vh/vc)²': (s, w) => w.a * (s.h / H) + w.b * Math.pow(s.vt / VC, 2),
  'F5 加权和(vh/vc) ': (s, w) => w.a * (s.h / H) + w.b * (s.vt / VC),
};

const G = (h) => (h < 0 ? 0.60 * (1 + h / R) : Math.min(1, 0.60 + 0.40 * (h / H)));

function evaluate(formKey, w, omegaCrit, gamma) {
  const f = FORMS[formKey];
  let worstMin8 = Infinity, worstSw = -Infinity, bestSw = Infinity, worstDs = 0, worstDrop = 0;
  const detail = [];
  for (const x of runs) {
    const tr = x.r.tr, N = tr.length;
    const om = new Array(N); let prevO = -Infinity;
    for (let i = 0; i < N; i++) { let o = f(tr[i], w); if (o < prevO) worstDrop = Math.max(worstDrop, prevO - o); prevO = Math.max(prevO, o); om[i] = o; }
    const s = new Array(N); let tSw = -1;
    for (let i = 0; i < N; i++) {
      const hEq = -R * (1 - Math.min(om[i] / omegaCrit, 1));
      const hDisp = Math.max(hEq, tr[i].peri);
      if (tSw < 0 && tr[i].peri > hEq) tSw = tr[i].t;
      s[i] = Math.pow(G(hDisp), gamma);
    }
    // 8 秒窗口最小增量
    const dt = tr[1].t - tr[0].t, K = Math.round(8 / dt);
    let min8 = Infinity;
    for (let i = 0; i + K < N; i++) min8 = Math.min(min8, s[i + K] - s[i]);
    // 切换点连续性
    let ds = 0;
    if (tSw > 0) { let i = 0; while (i < N && tr[i].t < tSw) i++; ds = Math.abs(s[i] - s[i - 1]); }
    worstMin8 = Math.min(worstMin8, min8);
    const sw = tSw < 0 ? x.r.t : tSw;
    worstSw = Math.max(worstSw, sw); bestSw = Math.min(bestSw, sw);
    worstDs = Math.max(worstDs, ds);
    if (x.name === '基准') detail.push({ tr, s, tSw: sw });
  }
  return { worstMin8, worstSw, bestSw, worstDs, worstDrop, detail };
}

hdr('3. 参数寻优（目标：最大化「任意 8s 窗口内的最小进度增量」，7 条弹道取最差）');
const cands = [];
for (const key of Object.keys(FORMS)) {
  const waList = key.startsWith('F3') ? [0.5, 0.8, 1.0, 1.3, 1.6] : [0.15, 0.25, 0.35, 0.45, 0.55, 0.7];
  for (const a of waList) {
    const b = key.startsWith('F3') ? 0.6 : 1 - a;
    for (const oc of [0.6, 0.9, 1.2, 1.6, 2.2, 3.0, 4.0, 5.5, 8.0]) {
      for (const ga of [0.55, 0.65, 0.75, 0.85, 1.0]) {
        const e = evaluate(key, { a, b }, oc, ga);
        // 约束：切换点须落在 T+58 ~ T+74（保证模态 B 至少 7s 可读）
        if (e.bestSw < 58 || e.worstSw > 74) continue;
        cands.push({ key, a, b, oc, ga, ...e });
      }
    }
  }
}
cands.sort((p, q) => q.worstMin8 - p.worstMin8);
line(`  ${'函数族'.padEnd(18)} ${'wA'.padStart(5)} ${'wB'.padStart(5)} ${'Ω_crit'.padStart(7)} ${'γ'.padStart(5)} ${'最小8s增量'.padStart(10)} ${'切换T+'.padStart(13)} ${'Δs切'.padStart(7)} ${'回退max'.padStart(9)}`);
line('  ' + '─'.repeat(88));
for (const c of cands.slice(0, 14)) {
  line(`  ${c.key.padEnd(18)} ${c.a.toFixed(2).padStart(5)} ${(c.key.startsWith('F3') ? c.b.toFixed(2) : (1 - c.a).toFixed(2)).padStart(5)} ${c.oc.toFixed(2).padStart(7)} ${c.ga.toFixed(2).padStart(5)} ${(c.worstMin8 * 100).toFixed(2).padStart(9)}% ${(c.bestSw.toFixed(1) + '–' + c.worstSw.toFixed(1)).padStart(13)} ${(c.worstDs * 100).toFixed(3).padStart(6)}% ${c.worstDrop.toExponential(1).padStart(9)}`);
}

// ══ 4. 冠军方案细节 ═══════════════════════════════════════════════════
const win = cands[0];
hdr(`4. 冠军：${win.key}   wA=${win.a}  wB=${(1 - win.a).toFixed(2)}  Ω_crit=${win.oc}  γ=${win.ga}`);
line(`  ${'路线'.padEnd(7)} ${'切换T+'.padStart(8)} ${'切换时h_eq km'.padStart(13)} ${'切换时h_p km'.padStart(12)} ${'Δs'.padStart(8)} ${'模态B时长s'.padStart(10)} ${'最小8s增量'.padStart(10)}`);
line('  ' + '─'.repeat(74));
{
  const f = FORMS[win.key]; const w = { a: win.a, b: win.b };
  for (const x of runs) {
    const tr = x.r.tr, N = tr.length;
    const om = new Array(N); let prevO = -Infinity;
    for (let i = 0; i < N; i++) { const o = f(tr[i], w); prevO = Math.max(prevO, o); om[i] = o; }
    const s = new Array(N); let tSw = -1, iSw = -1;
    for (let i = 0; i < N; i++) {
      const hEq = -R * (1 - Math.min(om[i] / win.oc, 1));
      if (tSw < 0 && tr[i].peri > hEq) { tSw = tr[i].t; iSw = i; }
      s[i] = Math.pow(G(Math.max(hEq, tr[i].peri)), win.ga);
    }
    const hEqSw = -R * (1 - Math.min(om[iSw] / win.oc, 1));
    const dt = tr[1].t - tr[0].t, K = Math.round(8 / dt);
    let min8 = Infinity; for (let i = 0; i + K < N; i++) min8 = Math.min(min8, s[i + K] - s[i]);
    line(`  ${x.name.padEnd(7)} ${tSw.toFixed(2).padStart(8)} ${(hEqSw / 1000).toFixed(2).padStart(13)} ${(tr[iSw].peri / 1000).toFixed(2).padStart(12)} ${(Math.abs(s[iSw] - s[iSw - 1]) * 100).toFixed(3).padStart(7)}% ${(x.r.t - tSw).toFixed(2).padStart(10)} ${(min8 * 100).toFixed(2).padStart(9)}%`);
  }
}
line('');
line(`  ⇒ 跨 7 条弹道：切换时刻 ${win.bestSw.toFixed(1)}–${win.worstSw.toFixed(1)}s，切换跳变 max ${(win.worstDs * 100).toFixed(3)}% 条宽，单调回退 max ${win.worstDrop.toExponential(1)}`);

// ══ 5. 基准弹道的 Ω 曲线 ══════════════════════════════════════════════
hdr('5. 基准弹道 Ω 曲线（Ω = 100 · s，模态 A 标 *，模态 B 标 ·）');
{
  const f = FORMS[win.key]; const w = { a: win.a, b: win.b };
  const tr = b.tr, N = tr.length;
  const om = new Array(N); let prevO = -Infinity;
  for (let i = 0; i < N; i++) { const o = f(tr[i], w); prevO = Math.max(prevO, o); om[i] = o; }
  let tSw = -1;
  const rows = [];
  for (let i = 0; i < N; i++) {
    const hEq = -R * (1 - Math.min(om[i] / win.oc, 1));
    const src = tr[i].peri > hEq ? 'B' : 'A';
    if (tSw < 0 && src === 'B') tSw = tr[i].t;
    rows.push({ t: tr[i].t, hDisp: Math.max(hEq, tr[i].peri), s: Math.pow(G(Math.max(hEq, tr[i].peri)), win.ga), src, om: om[i] });
  }
  line(`  ${'T+s'.padStart(6)} ${'Ω₀'.padStart(7)} ${'h_eq km'.padStart(9)} ${'h_p km'.padStart(9)} ${'h_disp'.padStart(9)} ${'模态'.padStart(5)} ${'Ω %'.padStart(7)}  条形`);
  line('  ' + '─'.repeat(92));
  for (const r of rows) {
    if (Math.abs(r.t % 3) > 0.026 && Math.abs(r.t % 3 - 3) > 0.026) continue;
    const n = Math.round(r.s * 30);
    line(`  ${r.t.toFixed(1).padStart(6)} ${r.om.toFixed(3).padStart(7)} ${(r.src === 'A' ? (-R * (1 - Math.min(r.om / win.oc, 1)) / 1000).toFixed(1) : '  —').padStart(9)} ${(b.tr[rows.indexOf(r)].peri / 1000).toFixed(1).padStart(9)} ${(r.hDisp / 1000).toFixed(1).padStart(9)} ${r.src.padStart(5)} ${(r.s * 100).toFixed(1).padStart(7)}  ${'█'.repeat(n)}${'·'.repeat(30 - n)}`);
  }
  line('');
  line(`  ⇒ 切换于 T+${tSw.toFixed(2)}s（全程 ${b.t.toFixed(0)}s 的第 ${(tSw / b.t * 100).toFixed(0)}%），模态 B 有 ${(b.t - tSw).toFixed(1)}s 可读`);
}

// ══ 6. 关键时刻 ═══════════════════════════════════════════════════════
hdr('6. 基准弹道关键时刻（供 S2 / S4 / S5 取数）');
const tr = b.tr;
const at = (p) => { for (const s of tr) if (p(s)) return s; return null; };
const s150 = at((s) => s.h >= 150), sQ = tr.reduce((x, y) => (y.q > x.q ? y : x));
const s75 = at((s) => s.h >= 7500), s12 = at((s) => s.h >= 12000), s15 = at((s) => s.h >= 15000);
line(`  hStart 150 m          T+${s150.t.toFixed(2)}s  v=${s150.v.toFixed(0)} m/s`);
line(`  Max-Q 峰值            T+${sQ.t.toFixed(2)}s  q=${(sQ.q / 1000).toFixed(2)} kPa  h=${(sQ.h / 1000).toFixed(3)} km  v=${sQ.v.toFixed(0)} m/s`);
line(`  hTurn 7.5 km          T+${s75.t.toFixed(2)}s  v=${s75.v.toFixed(0)} m/s  q=${(s75.q / 1000).toFixed(2)} kPa`);
line(`  大气顶 12 km          T+${s12.t.toFixed(2)}s  q=${(s12.q / 1000).toFixed(3)} kPa  ← 阻力归零`);
line(`  目标高度 15 km        T+${s15.t.toFixed(2)}s`);
line(`  一级关机/分离         T+60.00s  h≈${(tr.find((x) => x.t >= 60).h / 1000).toFixed(2)} km  v≈${tr.find((x) => x.t >= 60).v.toFixed(0)} m/s`);
line(`  二级关机 SECO         T+${b.t.toFixed(2)}s  h=${(b.hEnd / 1000).toFixed(2)} km  v=${b.vEnd.toFixed(0)} m/s  v_h=${b.vtEnd.toFixed(0)} m/s`);
line(`  参考：v_c = ${VC.toFixed(0)} m/s   起飞 TWR = ${b.twr0.toFixed(2)}   总 Δv = 2635 m/s`);
line('');
