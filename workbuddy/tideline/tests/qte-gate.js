/* =====================================================================
 * TIDELINE · PH6-BALANCE-001 · QTE「削平悬崖」验收门（真实代码 · 仅真实输入）
 *
 * 目的（team-lead 验收门 B/C）：
 *   以 tests/_bot-out/qte-curve.json 的矩阵为**改动前基线**，给出**可机械判定**
 *   的合格定义，并一键产出「改动前 / 改动后」对比。
 *
 * 规则（B，阈值可在 GATE 里改；本文件即判据的单一事实来源）：
 *   B1 无悬崖   ：在 1.0→4.0 次/s（步长 0.2）上，**每一档抖动**的相邻逃脱率
 *                 绝对差 ≤ 40 个百分点（不允许再出现 2.0→2.2 的 0%→100% 单档跳变）。
 *   B2 低技巧兜底：1.2 次/s 处 ideal ≥ 60%（低连打人群不得必死，硬红线②）；
 *                 附加稳健条款：1.2 次/s 处 ±50% ≥ 40%。
 *   B3 高技巧上限：4.0 次/s 处 ideal ≥ 95% 且 ±50% ≥ 95%（改动不得压低上限）。
 *   总判定 = B1 ∧ B2 ∧ B3。
 *
 * 铁律：与 bot-playtest.js 同——夹具仅用 G.enterBeached 制造初始条件，
 *   之后 QTE 全程真实逻辑 + 真实空格连打时间戳；**不改 src/**（本脚本在
 *   当前源码上跑出「改动前基线」，团队改完源码后用同一条命令再跑即得「改动后」）。
 *
 * 运行：
 *   node tests/qte-gate.js                    # 非 assist（默认）→ 基线
 *   node tests/qte-gate.js --assist=1         # QTE_ASSIST 档
 *   node tests/qte-gate.js --trials=400 --out=qte-gate-candidate.json
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./_harness.js');

function argNum(name, def) {
  const pre = '--' + name + '=';
  const a = process.argv.find(x => x.startsWith(pre));
  return a ? Number(a.slice(pre.length)) : def;
}
function argStr(name, def) {
  const pre = '--' + name + '=';
  const a = process.argv.find(x => x.startsWith(pre));
  return a ? a.slice(pre.length) : def;
}
const hasFlag = name => process.argv.includes('--' + name);

const DT = 1 / 60;
const TRIALS = argNum('trials', 200);
const SEED0 = argNum('seed', 20240601);
const ASSIST = argNum('assist', 0) ? true : false;

/* ---------- 验收门阈值（单一事实来源；team-lead 可改） ---------- */
const GATE = {
  smoothLow: 1.0, smoothHigh: 4.0, smoothStep: 0.2, maxAdjDeltaPP: 40,
  lowRate: 1.2, lowIdealMinPP: 60, lowMidJitter: 0.50, lowMidMinPP: 40,
  highRate: 4.0, highMinPP: 95
};
const CTX_RATES = [5.0, 6.0];   // 上下文档（不参与 B1 判定的相邻差）——对齐 §3 的 6 次/s

/* ---------- 抖动档（幅度 a：间隔 = (1/rate)·(1−a+2a·U)） ---------- */
const JITTERS = [
  { key: 'ideal', a: 0.00, label: '理想(无抖动)' },
  { key: 'p10', a: 0.10, label: '±10%' },
  { key: 'p25', a: 0.25, label: '±25%' },
  { key: 'p50', a: 0.50, label: '±50%' },
  { key: 'p75', a: 0.75, label: '±75%' },
  { key: 'p100', a: 1.00, label: '±100%' }
];

/* ---------- 网格 ---------- */
function buildGrid() {
  const g = [];
  for (let r = GATE.smoothLow; r <= GATE.smoothHigh + 1e-9; r += GATE.smoothStep) {
    g.push(Math.round(r * 100) / 100);
  }
  CTX_RATES.forEach(r => { if (g.indexOf(r) < 0) g.push(r); });
  return g;
}
const RATES = buildGrid();
const SMOOTH = RATES.filter(r => r >= GATE.smoothLow - 1e-9 && r <= GATE.smoothHigh + 1e-9);

/* ---------- 夹具式 QTE 试验（同 bot-playtest.js §C） ---------- */
const h = boot(ASSIST ? { qteAssist: true } : { qteAssist: false });
const C = h.C, U = h.U, W = h.W, G = h.G;

const held = new Set();
function pulseSpace() { h.keyDown(' '); h.keyUp(' '); }

function qteTrial(rate, jitterA, seedBase) {
  let ok = 0;
  for (let i = 0; i < TRIALS; i++) {
    h.releaseAll(); held.clear();
    U.srand(seedBase + i);
    G.reset();
    const s = G.shark;
    s.x = 2700;
    s.y = W.seabedY(2700) - C.SHARK.HALF_H + C.SHARK.SINK;
    G.enterBeached(s);                     // 唯一白盒：真实搁浅入口
    let vnow = 1000;
    h.setNow(() => vnow);
    let t = 0, nextTap = 0;
    for (let f = 0; f < 60 * 6 && G.qte.active; f++) {   // assist 窗口 3.5s，留足余量
      if (t >= nextTap) {
        pulseSpace();
        const iv = (1 / rate) * (jitterA ? (1 - jitterA + 2 * jitterA * U.rand()) : 1);
        nextTap = t + iv;
      }
      vnow += DT * 1000; t += DT; h.step(G, DT);
    }
    if (!G.qte.active && G.shark.alive && !G.over) ok++;
  }
  return ok;
}

function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
function esc(jk, r) { return succ[jk][r]; }   // fraction

const winNeed = ASSIST ? 'QTE_ASSIST' : 'QTE';
const W_ = ASSIST ? C.QTE_ASSIST : C.QTE;

console.log('\n=== TIDELINE · QTE 削平悬崖 · 验收门 ===\n');
console.log('  档位      : ' + (ASSIST ? 'QTE_ASSIST（辅助）' : 'QTE（默认）') +
  '  window=' + W_.WINDOW + 's need=' + W_.NEED + (C.QTE.MIN_INTERVAL ? ' minInterval=' + C.QTE.MIN_INTERVAL + 's' : ''));
console.log('  网格      : ' + SMOOTH[0] + '→' + SMOOTH[SMOOTH.length - 1] + ' 步 ' + GATE.smoothStep +
  '（' + SMOOTH.length + ' 点）+ 上下文 ' + CTX_RATES.join('/') + '；抖动档 ' + JITTERS.map(j => j.label).join(' / '));
console.log('  每点试验  : ' + TRIALS + ' 次；seed0=' + SEED0);
console.log('  判据      : B1 相邻Δ≤' + GATE.maxAdjDeltaPP + 'pp（逐抖动档） | B2 1.2/s ideal≥' +
  GATE.lowIdealMinPP + '% & ±50%≥' + GATE.lowMidMinPP + '% | B3 4.0/s ideal&±50%≥' + GATE.highMinPP + '%');

const t0 = Date.now();
const succ = {}; const grid = {};
for (const j of JITTERS) {
  succ[j.key] = {}; grid[j.key] = {};
  process.stdout.write('\n  · 抖动 ' + j.label + ' … ');
  for (const r of RATES) {
    const ok = qteTrial(r, j.a, SEED0 + 500000 + Math.round(j.a * 1000) * 131 + Math.round(r * 100) * 17);
    grid[j.key][r] = ok; succ[j.key][r] = ok / TRIALS;
  }
  console.log('完成');
}
const wall = Date.now() - t0;

/* ---------- 打印矩阵 ---------- */
console.log('\n————————————————————————————————————————');
console.log('  逃脱率矩阵（%）：行=抖动档，列=速率/s');
console.log('————————————————————————————————————————');
let head = '  抖动档        ';
for (const r of RATES) head += String(r).padStart(6);
console.log(head);
for (const j of JITTERS) {
  let line = '  ' + j.label.padEnd(12) + ' ';
  for (const r of RATES) line += (succ[j.key][r] * 100).toFixed(0).padStart(6);
  console.log(line);
}

/* ---------- 判定 ---------- */
console.log('\n————————————————————————————————————————');
console.log('  机械判定');
console.log('————————————————————————————————————————');

/* B1 相邻差（逐抖动档） */
let b1pass = true; const b1viol = [];
for (const j of JITTERS) {
  let worst = 0, worstA = null;
  for (let i = 0; i + 1 < SMOOTH.length; i++) {
    const d = Math.abs(succ[j.key][SMOOTH[i + 1]] - succ[j.key][SMOOTH[i]]) * 100;
    if (d > worst) { worst = d; worstA = SMOOTH[i]; }
    if (d > GATE.maxAdjDeltaPP + 1e-9) {
      b1pass = false;
      b1viol.push({ jitter: j.label, from: SMOOTH[i], to: SMOOTH[i + 1], deltaPP: d });
    }
  }
  console.log('  B1 · ' + j.label.padEnd(12) + ' 最大相邻Δ = ' + worst.toFixed(0) + 'pp @' +
    (worstA === null ? 'n/a' : worstA + '→' + (Math.round((worstA + GATE.smoothStep) * 100) / 100)) +
    (worst > GATE.maxAdjDeltaPP + 1e-9 ? '  ✗' : '  ✓'));
}
console.log('  → B1（相邻Δ≤' + GATE.maxAdjDeltaPP + 'pp 全部档）: ' + (b1pass ? 'PASS' : 'FAIL'));
if (!b1pass) {
  console.log('     反例（前 6 条违反）：');
  b1viol.slice(0, 6).forEach(v => console.log('       · ' + v.jitter + '  ' + v.from + '→' + v.to +
    '  Δ=' + v.deltaPP.toFixed(0) + 'pp'));
}

/* B2 */
const b2aIdeal = esc('ideal', GATE.lowRate), b2aMid = esc('p50', GATE.lowRate);
const b2pass = b2aIdeal >= GATE.lowIdealMinPP / 100 - 1e-9 && b2aMid >= GATE.lowMidMinPP / 100 - 1e-9;
console.log('  B2 · ' + GATE.lowRate + '/s : ideal = ' + (b2aIdeal * 100).toFixed(0) + '% (需≥' + GATE.lowIdealMinPP +
  '%) ' + (b2aIdeal >= GATE.lowIdealMinPP / 100 - 1e-9 ? '✓' : '✗') + ' ; ±50% = ' +
  (b2aMid * 100).toFixed(0) + '% (需≥' + GATE.lowMidMinPP + '%) ' + (b2aMid >= GATE.lowMidMinPP / 100 - 1e-9 ? '✓' : '✗'));
console.log('  → B2（低技巧兜底）: ' + (b2pass ? 'PASS' : 'FAIL'));

/* B3 */
const b3 = { ideal: esc('ideal', GATE.highRate), p50: esc('p50', GATE.highRate) };
const b3pass = b3.ideal >= GATE.highMinPP / 100 - 1e-9 && b3.p50 >= GATE.highMinPP / 100 - 1e-9;
console.log('  B3 · ' + GATE.highRate + '/s : ideal = ' + (b3.ideal * 100).toFixed(0) + '% ; ±50% = ' +
  (b3.p50 * 100).toFixed(0) + '%  (均需≥' + GATE.highMinPP + '%)');
console.log('  → B3（高技巧上限）: ' + (b3pass ? 'PASS' : 'FAIL'));

const overall = b1pass && b2pass && b3pass;
console.log('\n  ═══════ QTE 验收门总判定: ' + (overall ? '✅ PASS' : '❌ FAIL') + ' ═══════');
console.log('  （改动前基线预期 FAIL；团队改完 QTE 机制后，用同一条命令复跑，应转 PASS。）');

console.log('\n  墙钟 ' + wall + 'ms');

/* ---------- 落盘 ---------- */
const outDir = path.join(__dirname, '_bot-out');
try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { }
const outName = argStr('out', ASSIST ? 'qte-gate-assist.json' : 'qte-gate-noassist.json');
const out = {
  meta: {
    generatedBy: 'tests/qte-gate.js', assist: ASSIST, tier: winNeed,
    window: W_.WINDOW, need: W_.NEED, minInterval: ASSIST ? null : C.QTE.MIN_INTERVAL,
    trialsPerPoint: TRIALS, seed0: SEED0, rates: RATES, smoothGrid: SMOOTH,
    jitters: JITTERS.map(j => ({ key: j.key, amplitude: j.a, label: j.label })),
    gate: GATE, wallMs: wall
  },
  successFraction: succ, successCount: grid,
  verdict: {
    B1: b1pass, B2: b2pass, B3: b3pass, overall,
    B1violations: b1viol,
    B2detail: { rate: GATE.lowRate, ideal: b2aIdeal, p50: b2aMid },
    B3detail: { rate: GATE.highRate, ideal: b3.ideal, p50: b3.p50 }
  }
};
fs.writeFileSync(path.join(outDir, outName), JSON.stringify(out, null, 2));
console.log('  原始矩阵 + 判定已写入 tests/_bot-out/' + outName + '\n');

process.exitCode = overall ? 0 : 1;
