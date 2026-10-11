/* =====================================================================
 * TIDELINE · PH6-BALANCE-001 · R1 验收门（C1 / C3）—— 真实代码层
 *
 * team-lead 要求：R1 的 C1/C3 必须「可原样复跑对比」。
 * 本脚本给出**可机械判定**的口径，并一键跑出「改动前 / 改动后」的数字。
 *
 * ── 口径定义（单一事实来源）────────────────────────────────────────────
 * 指标     scoreRate（分/s） = Σbanked / Σ存活秒   （与 R1 §1.2 / bot §1.5 同构）
 * 画像     200 局 / 单局上限 60s / seed0=20240601 / 确定性（U.srand(seed0+局号)）
 * C1_code  = scoreRate(surf_k1) / scoreRate(conservative)
 *            · 两者**逐参数相同、仅返程路线不同**（deep vs surf），k=1、alarmCap=65、
 *              filter=noBeach、tetherReflex=on  → 干净地隔离「返程路线」这一个变量。
 *            · 判定目标：比值 ≥ 1.50（R1 §2.4 C1）。
 * C3_code  = 在 k∈{1,2,3,4} 上采样 scoreRate，取 argmax；
 *            画像集：conservative(k1)/balanced(k2)/smart_k2(k2)/smart_k3(k3)/aggressive(k4)。
 *            · 「最优」= scoreRate 最高者的 targetK。
 *            · 「显著」= 最优者的 scoreRate ≥ 1.15 × 最佳 k=1 的 scoreRate（押注 ≥+15% 才算有牙齿）。
 *            · 判定目标：最优 k ≥ 2 且显著（R1 C3）。
 *
 * ── 运行 ─────────────────────────────────────────────────────────────
 *   node tests/r1-gate.js                      # 自动复跑 bot（200×全部画像）后判定
 *   node tests/r1-gate.js --games=200 --cap=60
 *   node tests/r1-gate.js --no-run --file=tests/_bot-out/r1-gate.json   # 复用已有 JSON
 *
 * 注：C1 还有一层**解析模型**判据（模型层 C1=0.80，命令见 PH6-BALANCE-001-acceptance-gates.md §A），
 *     本脚本只负责**真实代码层**；两层都应满足目标。
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

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
const hasFlag = n => process.argv.includes('--' + n);

const GAMES = argNum('games', 200);
const CAP = argNum('cap', 60);
const OUT = argStr('out', 'r1-gate.json');
const FILE = argStr('file', '');
const NO_RUN = hasFlag('no-run');

const TARGET_C1 = 1.50;
const TARGET_C3_K = 2;
const SIGNIF = 1.15;

const OUT_PATH = FILE || path.join(__dirname, '_bot-out', OUT);

/* ---------- 1) 复跑（可选） ---------- */
if (!NO_RUN && !FILE) {
  console.log('\n[r1-gate] 复跑 bot：node tests/bot-playtest.js --games=' + GAMES + ' --cap=' + CAP +
    ' --out=' + OUT + '  （含 surf_k1 画像）…');
  const r = cp.spawnSync('node', [path.join(__dirname, 'bot-playtest.js'),
    '--games=' + GAMES, '--cap=' + CAP, '--out=' + OUT], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0 && r.status !== null) {
    console.error('[r1-gate] bot 复跑失败，status=' + r.status);
  }
}

/* ---------- 2) 读取 ---------- */
if (!fs.existsSync(OUT_PATH)) {
  console.error('[r1-gate] 找不到 ' + OUT_PATH + '；先运行 node tests/bot-playtest.js --out=' + OUT);
  process.exit(2);
}
const J = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
const P = J.profiles || {};
const meta = J.meta || {};
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);
const f3 = x => (Math.round(x * 1000) / 1000).toFixed(3);

console.log('\n=== TIDELINE · R1 验收门（真实代码层）===\n');
console.log('  数据: ' + OUT_PATH + '  （games=' + meta.games + ' cap=' + meta.capS +
  's seed0=' + meta.seed0 + ' out=' + (meta.outName || OUT) + '）');

/* ---------- 3) C1 ---------- */
console.log('\n————————————————————————————————————————');
console.log('  C1 · 冲浪/深海 得分速率比值（k=1，仅返程路线不同）');
console.log('————————————————————————————————————————');
let c1ok = null, c1 = null;
if (!P.surf_k1) {
  console.log('  ⚠ 数据里没有 surf_k1 画像（本门需要更新后的 bot-playtest.js）。');
  console.log('    请先：node tests/bot-playtest.js --games=200 --cap=60 --out=' + OUT);
} else {
  const deep = P.conservative.scoreRate;
  const surf = P.surf_k1.scoreRate;
  c1 = deep > 0 ? surf / deep : Infinity;
  c1ok = c1 >= TARGET_C1;
  console.log('  深海 conservative : scoreRate = ' + f2(deep) + ' 分/s   （死 ' + P.conservative.died + '/' + meta.games + '）');
  console.log('  冲浪 surf_k1      : scoreRate = ' + f2(surf) + ' 分/s   （死 ' + P.surf_k1.died + '/' + meta.games + '）');
  console.log('  C1 = surf_k1 / conservative = ' + f3(c1));
  console.log('  目标 ≥ ' + TARGET_C1.toFixed(2) + '  →  ' + (c1ok ? '✅ PASS' : '❌ FAIL'));
  console.log('  （参考：团队锁定的**模型层** C1 = 0.80，见 acceptance-gates §A）');
}

/* ---------- 4) C3 ---------- */
console.log('\n————————————————————————————————————————');
console.log('  C3 · 得分速率随押注 k 的走向（argmax）');
console.log('————————————————————————————————————————');
const SAMPLE = ['conservative', 'balanced', 'smart_k2', 'smart_k3', 'aggressive'];
const nameK = { conservative: 1, balanced: 2, smart_k2: 2, smart_k3: 3, aggressive: 4 };
const rows = [];
for (const nm of SAMPLE) {
  if (!P[nm]) continue;
  rows.push({ nm, scoreRate: P[nm].scoreRate, died: P[nm].died });
}
console.log('  ' + 'profile'.padEnd(14) + 'k'.padEnd(4) + 'scoreRate'.padEnd(12) + '死亡');
for (const r of rows) {
  console.log('  ' + r.nm.padEnd(14) + String(nameK[r.nm]).padEnd(4) + f2(r.scoreRate).padEnd(12) + (r.died + '/' + meta.games));
}
let best = rows[0], bestK1 = null;
for (const r of rows) {
  if (!best || r.scoreRate > best.scoreRate) best = r;
  if (nameK[r.nm] === 1 && (!bestK1 || r.scoreRate > bestK1.scoreRate)) bestK1 = r;
}
const bestK = nameK[best.nm];
const margin = bestK1 ? best.scoreRate / bestK1.scoreRate : 0;
const c3ok = bestK >= TARGET_C3_K && margin >= SIGNIF;
console.log('  → 最优 = ' + best.nm + '（k=' + bestK + '，' + f2(best.scoreRate) + ' 分/s）');
console.log('  → vs 最佳 k=1（' + (bestK1 ? bestK1.nm + ' ' + f2(bestK1.scoreRate) : 'n/a') + '）：倍数 = ' + f3(margin) +
  '（显著阈值 ≥ ' + SIGNIF.toFixed(2) + '）');
console.log('  目标：最优 k ≥ ' + TARGET_C3_K + ' 且倍数 ≥ ' + SIGNIF.toFixed(2) + '  →  ' + (c3ok ? '✅ PASS' : '❌ FAIL'));

/* ---------- 5) 总判定 ---------- */
console.log('\n————————————————————————————————————————');
console.log('  ═══════ R1 验收门（代码层）总判定: ' +
  ((c1ok && c3ok) ? '✅ PASS' : '❌ FAIL') + ' ═══════');
console.log('  （改动前基线预期 FAIL；团队改完数值后，用同一条命令复跑，应转 PASS。）');
console.log('————————————————————————————————————————\n');

/* ---------- 6) 落盘判定 ---------- */
J.gateR1 = {
  targetC1: TARGET_C1, targetC3K: TARGET_C3_K, signif: SIGNIF,
  c1: c1, c1Pass: c1ok,
  c3Best: best ? best.nm : null, c3BestK: bestK, c3Margin: margin, c3Pass: c3ok,
  overall: !!(c1ok && c3ok)
};
try {
  fs.writeFileSync(OUT_PATH.replace(/\.json$/, '') + '.gate.json', JSON.stringify(J.gateR1, null, 2));
  console.log('  判定已写入 ' + OUT_PATH.replace(/\.json$/, '') + '.gate.json');
} catch (e) { }

process.exitCode = (c1ok && c3ok) ? 0 : 1;
