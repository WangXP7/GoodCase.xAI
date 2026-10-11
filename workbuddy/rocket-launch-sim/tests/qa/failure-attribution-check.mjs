/**
 * 失败归因（S6 / P2）契约独立核验
 * 对每个**可达**失败码，用独立构造的场景触发，逐项检查文案契约：
 *   A6-2 主因含「时刻 + 量名 + 实测值」
 *   A6-3 证据条数 ∈ [2,4]
 *   A6-13 文案不出现 NaN / undefined / 空串（美术 §5.2）
 *   A6-6 gap 文案退化（INSUFFICIENT_DV）
 * 同时输出 9 码可达性（A6-1）。
 * 用法：node tests/qa/failure-attribution-check.mjs
 */
import { Simulation } from '../../src/core/simulation.js';
import { FailureCode } from '../../src/core/failure.js';
import { PlayerModel } from '../../src/core/player-model.js';

const DT = 1 / 120;
const R2D = 180 / Math.PI;

function run(model, inputs, until = 24000) {
  const sim = new Simulation({ skippable: false });
  let g = 0;
  while (sim.outcome === null && g < until) {
    if (model) model.update(sim, DT);
    if (inputs) inputs(sim);
    sim.update(DT); g++;
  }
  return sim;
}

const scenarios = [
  ['DESTRUCT_AERO', () => run(new PlayerModel({ hTurn: 500, p: 0.5, deadbandDeg: 0.6, updateHz: 40 }))],
  ['TUMBLE', () => run(new PlayerModel({ hTurn: 6000, p: 0.2, deadbandDeg: 0.6, updateHz: 40 }))],
  ['INSUFFICIENT_DV', () => run(new PlayerModel({ hTurn: 40000, p: 1.0, deadbandDeg: 0.6, updateHz: 40 }))],
  ['ESCAPE_TRAJ', () => run(new PlayerModel({ hTurn: 1e9, p: 1.0, deadbandDeg: 1.0, updateHz: 30, stageAtBurnout: true }))],
  ['SEP_HIGHQ', () => run(null, (s) => { s.setInput({ launch: true, pitch: 0, throttle: 0 }); if (s.fm.t >= 14) s.setInput({ stage: true }); })],
];

console.log('══ 失败归因契约核验（S6 / P2）══\n');
console.log('  码'.padEnd(20) + '时刻'.padEnd(6) + '量名/单位'.padEnd(12) + '证据数'.padEnd(8) + '无NaN'.padEnd(7) + '建议非空');
let allOk = true;
for (const [name, fn] of scenarios) {
  const sim = fn();
  const r = sim.failure.record;
  if (!r) { console.log(`  ${name.padEnd(18)} — 未触发失败`); allOk = false; continue; }
  const hasTime = /T\+[\d.]+s/.test(r.primary);
  const hasUnit = /(km|m\/s|kPa|°|m\b)/.test(r.primary);
  const evOk = r.evidence.length >= 2 && r.evidence.length <= 4;
  const noNaN = !/NaN|undefined/.test(r.primary + r.fixHint + r.evidence.map((e) => e.label).join(''));
  const hintOk = typeof r.fixHint === 'string' && r.fixHint.length > 0;
  // 语义自洽：ESCAPE_TRAJ 文案声称"速度超过逃逸速度"，必须真的成立
  let coherent = true, coherenceNote = '';
  if (r.code === 'ESCAPE_TRAJ') {
    const m = /关机速度 ([\d.]+) m\/s 超过了逃逸速度 ([\d.]+)/.exec(r.primary);
    if (m && Number(m[1]) <= Number(m[2])) { coherent = false; coherenceNote = `文案称 ${m[1]} > ${m[2]}，但数值不成立`; }
  }
  if (r.code === 'INSUFFICIENT_DV' && /近地点只有 -[\d.]+ km/.test(r.primary)) {
    coherent = false; coherenceNote = '主因报出负近地点（亚轨道语义），对玩家不可解读';
  }
  const ok = hasTime && hasUnit && evOk && noNaN && hintOk && coherent;
  if (!ok) allOk = false;
  console.log(`  ${name.padEnd(18)} ${(hasTime ? '✅' : '❌').padEnd(6)} ${(hasUnit ? '✅' : '❌').padEnd(11)} ${(evOk ? '✅' : '❌') + String(r.evidence.length).padEnd(6)} ${(noNaN ? '✅' : '❌').padEnd(6)} ${hintOk ? '✅' : '❌'}  ${coherent ? '' : '⚠️ ' + coherenceNote}`);
  console.log(`      code=${r.code}  T+${r.t.toFixed(1)}s`);
  console.log(`      「${r.primary.slice(0, 96)}${r.primary.length > 96 ? '…' : ''}」`);
}

// A6-1：9 码可达性
const ALL = Object.values(FailureCode);
const hit = new Set(scenarios.map(([n, fn]) => fn().failure.record?.code).filter(Boolean));
console.log(`\n  A6-1「全部 9 码可触发」：可达 ${hit.size}/9 · ${[...hit].join(', ')}`);

// A6-6：gap 文案退化（INSUFFICIENT_DV 的米 / 千米切换）
console.log('\n  ── A6-6 gap 文案退化抽样 ──');
for (const hTurn of [20000, 40000, 70000]) {
  const sim = run(new PlayerModel({ hTurn, p: 1.0, deadbandDeg: 0.6, updateHz: 40 }));
  const r = sim.failure.record;
  if (r && r.code === FailureCode.INSUFFICIENT_DV) {
    const m = /还差 ([\d.]+) (km|m)/.exec(r.primary);
    console.log(`    hTurn=${hTurn}: 近地点 ${(sim.orbit.get().periapsis / 1000).toFixed(2)}km → 文案「${m ? m[0] : 'n/a'}」`);
  }
}

console.log(`\n  ${allOk ? '✅ 全部可达码文案契约成立' : '⚠️ 存在未达标项（见上）'}`);
process.exitCode = allOk ? 0 : 1;
