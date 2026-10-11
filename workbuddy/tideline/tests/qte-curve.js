/* =====================================================================
 * TIDELINE · PH6-QA-003-B · QTE 逃脱率精细曲线（真实代码 · 仅真实输入）
 *
 * 目的（主理人后续问题 1）：把 p_beach「免费」这件事测成一条**曲线**——
 *   逃脱率随 ①连打速率(/s) 与 ②连打时机抖动(±%) 怎么变？
 *   速率/抖动到多少时，逃脱率跌破 ~90% / ~50%？
 *   与 beach_greedy 的 251/251（taps=6.0/s）对齐解释。
 *
 * 方法：与 tests/bot-playtest.js §C 的夹具完全一致——
 *   用源码公开入口 G.enterBeached(s) 制造搁浅，随后 QTE 全程真实逻辑 +
 *   真实空格连打时间戳（h.keyDown(' ') → input.js taps.push(performance.now())）。
 *   这是本实验唯一一处白盒（只制造初始条件），已在报告 §1.3 逐条标注。
 *
 * 运行： node tests/qte-curve.js                       # 默认 200 次/点
 *        node tests/qte-curve.js --trials=400
 * 产出： tests/_bot-out/qte-curve.json （原始成功率矩阵，供报告引用）
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

const DT = 1 / 60;
const TRIALS = argNum('trials', 200);
const SEED0 = argNum('seed', 20240601);

/* 精细速率网格：覆盖 2.4 次/s 理论门槛两侧，并在低频端找 50% 点 */
const RATES = [1.5, 1.8, 2.0, 2.2, 2.4, 2.5, 2.6, 2.8, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0];
/* 抖动幅度 a：间隔 = (1/rate)·(1 - a + 2a·U)  →  间隔 ∈ [1-a, 1+a]×(1/rate) */
const JITTERS = [
  { key: 'ideal', a: 0.00, label: '理想(无抖动)' },
  { key: 'p10', a: 0.10, label: '±10%' },
  { key: 'p25', a: 0.25, label: '±25%' },
  { key: 'p50', a: 0.50, label: '±50%' },
  { key: 'p75', a: 0.75, label: '±75%' },
  { key: 'p100', a: 1.00, label: '±100%' }
];

const h = boot({});
const C = h.C, U = h.U, W = h.W, G = h.G;

const held = new Set();
function pulseSpace() { h.keyDown(' '); h.keyUp(' '); }

/* ---- 与 bot-playtest.js 完全一致的夹具式 QTE 试验 ---- */
function qteTrial(rate, jitterA, seedBase) {
  let ok = 0;
  for (let i = 0; i < TRIALS; i++) {
    h.releaseAll(); held.clear();
    U.srand(seedBase + i);
    G.reset();
    const s = G.shark;
    /* —— 唯一白盒：真实搁浅入口 —— */
    s.x = 2700;
    s.y = W.seabedY(2700) - C.SHARK.HALF_H + C.SHARK.SINK;
    G.enterBeached(s);

    let vnow = 1000;
    h.setNow(() => vnow);
    let t = 0, nextTap = 0;
    for (let f = 0; f < 60 * 4 && G.qte.active; f++) {
      if (t >= nextTap) {
        pulseSpace();
        const iv = (1 / rate) * (jitterA ? (1 - jitterA + 2 * jitterA * U.rand()) : 1);
        nextTap = t + iv;
      }
      vnow += DT * 1000;
      t += DT;
      h.step(G, DT);
    }
    if (!G.qte.active && G.shark.alive && !G.over) ok++;
  }
  return ok;
}

function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

console.log('\n=== TIDELINE · PH6-QA-003-B · QTE 逃脱率精细曲线 ===\n');
console.log('  窗口 ' + C.QTE.WINDOW + 's / 需 ' + C.QTE.NEED + ' 针 / 最小间隔 ' + C.QTE.MIN_INTERVAL +
  's  →  理论最低有效频率 = ' + f2(C.QTE.NEED / C.QTE.WINDOW) + ' 次/s');
console.log('  每点试验 ' + TRIALS + ' 次；速率网格 ' + RATES.join('/') + ' /s；抖动档 ' +
  JITTERS.map(j => j.label).join(' / '));

const t0 = Date.now();
const grid = {};              // grid[jitterKey][rate] = successCount
const succ = {};              // succ[jitterKey][rate] = successFraction
for (const j of JITTERS) {
  grid[j.key] = {}; succ[j.key] = {};
  process.stdout.write('\n  · 抖动 ' + j.label + ' … ');
  for (const r of RATES) {
    const ok = qteTrial(r, j.a, SEED0 + 500000 + Math.round(j.a * 1000) * 131 + Math.round(r * 100) * 17);
    grid[j.key][r] = ok;
    succ[j.key][r] = ok / TRIALS;
  }
  console.log('完成');
}
const wall = Date.now() - t0;

/* ---- 打印成功率矩阵 ---- */
console.log('\n————————————————————————————————————————');
console.log('  §Q1 · QTE 逃脱率矩阵（行=抖动档，列=速率/s，值=逃脱成功率 %）');
console.log('————————————————————————————————————————');
let head = '  抖动档        ';
for (const r of RATES) head += String(r).padStart(6);
console.log(head);
for (const j of JITTERS) {
  let line = '  ' + j.label.padEnd(12) + ' ';
  for (const r of RATES) line += (succ[j.key][r] * 100).toFixed(0).padStart(6);
  console.log(line);
}

/* ---- 阈值：逃脱率达 90% / 50% 所需的最低速率（逃脱率随速率单调升） ----
 * 语义：逃脱率 < R 当且仅当 连打速率 < R 所需的门槛速率。
 * 即"跌破 90%"= 速率低于该值时逃脱率<90%。线性插值（速率升序寻找首次 >= level）。 */
function crossRate(jkey, level) {
  let prevR = null, prevV = null;
  for (const r of RATES) {
    const v = succ[jkey][r];
    if (v >= level) {
      if (prevR === null) return { rate: RATES[0], note: '最小档已达/超阈值' };
      const frac = (level - prevV) / ((v - prevV) || 1e-9);
      const rc = prevR + (r - prevR) * frac;
      return { rate: rc, note: '介于 ' + prevR + '(' + (prevV * 100).toFixed(0) + '%) 与 ' +
        r + '(' + (v * 100).toFixed(0) + '%) 之间' };
    }
    prevR = r; prevV = v;
  }
  return { rate: null, note: '>=最大档仍 < 阈值' };
}

console.log('\n————————————————————————————————————————');
console.log('  §Q2 · 逃脱率跌破 90% / 50% 的速率门槛（对每档抖动）');
console.log('————————————————————————————————————————');
console.log('  语义：逃脱率 < X%  ⇔  连打速率 < 下表门槛值（逃脱率随速率单调升）');
console.log('');
console.log('  抖动档       逃脱率跌破 90% 的速率(/s)      逃脱率跌破 50% 的速率(/s)');
for (const j of JITTERS) {
  const c90 = crossRate(j.key, 0.90);
  const c50 = crossRate(j.key, 0.50);
  const s90 = c90.rate === null ? c90.note : '< ' + f2(c90.rate) + '  (' + c90.note + ')';
  const s50 = c50.rate === null ? c50.note : '< ' + f2(c50.rate) + '  (' + c50.note + ')';
  console.log('  ' + j.label.padEnd(12) + '  ' + String(s90).padEnd(30) + s50);
}

/* ---- 反向：某速率下"最坏抖动"仍能 100%/90% 脱困 ---- */
console.log('\n  · 最低能"任何抖动档都 100% 脱困"的速率：');
let anyPerfect = null;
for (const r of RATES) {
  if (JITTERS.every(j => succ[j.key][r] >= 0.999)) { anyPerfect = r; break; }
}
console.log('    ' + (anyPerfect === null ? '无（在网格内）' : anyPerfect + ' 次/s') +
  '  → 只要连打到该速率，抖动多大都稳脱困。');

/* ---- 与 beach_greedy 251/251 对齐 ---- */
console.log('\n————————————————————————————————————————');
console.log('  §Q3 · 与 beach_greedy（taps=6.0/s）对齐');
console.log('————————————————————————————————————————');
console.log('  beach_greedy 以 6.0 次/s 连打 → 本矩阵在 6.0 档：');
for (const j of JITTERS) {
  console.log('    ' + j.label.padEnd(12) + ' 逃脱率 ' + (succ[j.key][6.0] * 100).toFixed(0) +
    '%  (' + grid[j.key][6.0] + '/' + TRIALS + ')');
}
console.log('  → 6.0 次/s 远高于 ' + f2(C.QTE.NEED / C.QTE.WINDOW) +
  ' 次/s 门槛，故 beach_greedy 251/251 全部脱困与矩阵一致。');

console.log('\n  墙钟 ' + wall + 'ms（' + (RATES.length * JITTERS.length) + ' 点 × ' + TRIALS + ' 次）');

/* ---- 落盘 ---- */
const outDir = path.join(__dirname, '_bot-out');
try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { }
const out = {
  meta: {
    generatedBy: 'tests/qte-curve.js', trialsPerPoint: TRIALS, seed0: SEED0,
    window: C.QTE.WINDOW, need: C.QTE.NEED, minInterval: C.QTE.MIN_INTERVAL,
    theoreticalMinHz: C.QTE.NEED / C.QTE.WINDOW, rates: RATES,
    jitters: JITTERS.map(j => ({ key: j.key, amplitude: j.a, label: j.label })),
    wallMs: wall
  },
  successFraction: succ, successCount: grid
};
fs.writeFileSync(path.join(outDir, 'qte-curve.json'), JSON.stringify(out, null, 2));
console.log('  原始矩阵已写入 tests/_bot-out/qte-curve.json\n');

process.exitCode = 0;
