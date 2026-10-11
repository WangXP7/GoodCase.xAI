/* =====================================================================
 * TIDELINE · PH6-BALANCE-001 · QTE 验收门 · assist / 非 assist 对比器
 *
 * 用法（先各跑一次 qte-gate.js）：
 *   node tests/qte-gate.js --assist=0      → tests/_bot-out/qte-gate-noassist.json
 *   node tests/qte-gate.js --assist=1      → tests/_bot-out/qte-gate-assist.json
 *   node tests/qte-gate-compare.js         → 并排对比 + 机械判定
 *
 * 机械判定（辅助档必须"只增不减"）：
 *   M1 各档判定：分别输出 non-assist / assist 的 B1/B2/B3 与总判定。
 *   M2 单调可及：∀(速率, 抖动档)，assist 逃脱率 ≥ non-assist 逃脱率（辅助不得比默认更难）。
 *   M3 非平凡：assist 不得把曲线压成"处处 100%"以外的退化——
 *             若 assist 在 1.0/s 处已 100%，记为「辅助档过于宽松（信息）」，
 *             不判 FAIL，只提示（辅助本意即"宽松"）。
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '_bot-out');

function argStr(name, def) {
  const pre = '--' + name + '=';
  const a = process.argv.find(x => x.startsWith(pre));
  return a ? a.slice(pre.length) : def;
}
const F_NO = argStr('no', 'qte-gate-noassist.json');
const F_AS = argStr('assist', 'qte-gate-assist.json');

function load(f) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.error('[compare] 缺文件：' + p + '（先跑 node tests/qte-gate.js --assist=…）'); process.exit(2); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const A = load(F_NO), B = load(F_AS);

const RATES = A.meta.rates;
const JIT = A.meta.jitters.map(j => j.key);
const pct = x => (x * 100).toFixed(0).padStart(4);

console.log('\n=== QTE 验收门 · assist / 非 assist 对比 ===\n');
console.log('  non-assist: ' + F_NO + '   assist: ' + F_AS);

function verdictLine(tag, J) {
  const v = J.verdict;
  console.log('  ' + tag.padEnd(11) + ' B1=' + (v.B1 ? 'PASS' : 'FAIL') +
    '  B2=' + (v.B2 ? 'PASS' : 'FAIL') + '  B3=' + (v.B3 ? 'PASS' : 'FAIL') +
    '  → 总判定 ' + (v.overall ? '✅ PASS' : '❌ FAIL'));
}
console.log('\n  —— M1 各档判定 ——');
verdictLine('non-assist', A);
verdictLine('assist', B);

/* 最坏抖动下的逃脱率（该速率下取所有抖动档的最小值） */
function worst(J, r) { let m = 1; for (const k of JIT) m = Math.min(m, J.successFraction[k][r]); return m; }

console.log('\n  —— 最坏抖动下的逃脱率（%）：non-assist → assist ——');
let head = '  速率/s   ';
for (const r of RATES) head += String(r).padStart(6);
console.log(head);
let l1 = '  non      ', l2 = '  assist   ';
for (const r of RATES) { l1 += pct(worst(A, r)).padStart(6); l2 += pct(worst(B, r)).padStart(6); }
console.log(l1); console.log(l2);

/* M2 单调 */
let viol = 0, firstViol = null;
for (const r of RATES) for (const k of JIT) {
  if (B.successFraction[k][r] + 1e-9 < A.successFraction[k][r]) {
    viol++; if (!firstViol) firstViol = { r, k, no: A.successFraction[k][r], as: B.successFraction[k][r] };
  }
}
console.log('\n  —— M2 单调可及（assist ≥ non-assist 逐格）——');
console.log('  违反格数 = ' + viol + (viol ? '  ✗  例：rate=' + firstViol.r + ' ' + firstViol.k +
  '  no=' + (firstViol.no * 100).toFixed(0) + '% as=' + (firstViol.as * 100).toFixed(0) + '%' : '  ✓'));

/* M3 非平凡提示 */
const assistTrivial = JIT.every(k => B.successFraction[k][RATES[0]] >= 0.999);
console.log('\n  —— M3 非平凡（仅提示）——');
console.log('  assist 在 1.0/s 处已 100%（过于宽松）：' + (assistTrivial ? '是（信息，不判 FAIL）' : '否'));

const pass = (B.verdict.overall) && viol === 0;
console.log('\n  ═══════ 对比总判定（assist 有效且单调）: ' + (pass ? '✅ PASS' : '❌ FAIL') + ' ═══════');
console.log('  注：**验收门 B1/B2/B3 以 non-assist 档为准**；assist 档在此只作"辅助不劣于默认"的护栏。\n');

process.exitCode = pass ? 0 : 1;
