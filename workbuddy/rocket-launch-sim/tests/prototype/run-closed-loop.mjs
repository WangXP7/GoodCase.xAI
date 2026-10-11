/**
 * 闭环验证 · 玩家手动操控能否复现基准弹道（RT-1 遗留风险 R4 的解答）
 *
 * 每条 profile = 一个"玩家画像"：他心里有一条重力转弯程序、有固定的打杆死区与
 * 操作频率。全部只走玩家通道（pitch ∈ {−1,0,+1}），不碰 autoProgram。
 *
 * 这是本任务的关键证据：如果 profile#0（一个正常玩家）能跑出接近 81.0s / 15km 的
 * 弹道，则"重力转弯"作为核心技能在闭环下成立；若不能，则 IV-1 的整条设计链断裂。
 *
 * 用法：node tests/prototype/run-closed-loop.mjs
 * 产出：tests/prototype/closed-loop-results.json
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Simulation } from '../../src/core/simulation.js';
import { PlayerModel } from '../../src/core/player-model.js';

const DT = 1 / 120;
const MAX_STEPS = 24000;   // 200 s 上限

const PROFILES = [
  {
    id: 'A-baseline',
    name: '基准程序追踪（正常玩家）',
    hTurn: 7500, p: 0.8, deadbandDeg: 0.4, updateHz: 60,
    expect: 'PRECISE',
  },
  {
    id: 'B-low',
    name: '低抛（早倾倒 40%）',
    hTurn: 6000, p: 0.6, deadbandDeg: 0.8, updateHz: 40,
    expect: 'ORBITAL',
  },
  {
    id: 'C-high',
    name: '高抛（晚倾倒 70%）',
    hTurn: 10500, p: 1.0, deadbandDeg: 0.8, updateHz: 40,
    expect: 'PRECISE',
  },
  {
    id: 'D-sloppy',
    name: '手笨的玩家（死区 2.5° / 12Hz）',
    hTurn: 7500, p: 0.8, deadbandDeg: 2.5, updateHz: 12,
    expect: '入轨（容错验证）',
  },
  {
    id: 'E-throttle',
    name: '主动收油门管 Max-Q（玩家能动性）',
    hTurn: 7500, p: 0.8, deadbandDeg: 0.6, updateHz: 40,
    throttlePlan: (c) => (c.h < 6000 && c.q > 11000 ? 0.6 : 1.0),
    expect: '入轨 + 动压下降',
  },
  {
    id: 'F-novice',
    name: '新手：从不倾倒（垂直硬顶）',
    hTurn: 1e9, p: 1.0, deadbandDeg: 1.0, updateHz: 30,
    expect: '失败（IMPACT/INSUFFICIENT_DV）',
  },
];

function runProfile(profile) {
  const sim = new Simulation({ skippable: false });
  const model = new PlayerModel(profile);

  let sepMass = 0;
  const trace = [];
  let guard = 0;
  let omegaRegress = 0;
  let lastOmega = 0;
  let nanSeen = false;

  while (sim.outcome === null && guard < MAX_STEPS) {
    model.update(sim, DT);
    sim.update(DT);
    if (sim.fm.separated && !sepMass) sepMass = sim.fm.m;

    const m = sim.hudModel();
    if (!Number.isFinite(m.omegaPct) || !Number.isFinite(m.periapsisM)) nanSeen = true;
    if (m.omegaPct < lastOmega - 1e-9) omegaRegress = Math.max(omegaRegress, lastOmega - m.omegaPct);
    lastOmega = m.omegaPct;
    if (sim.flying) trace.push({ t: m.flightTime, h: m.altitudeM, v: m.speedMs, q: m.qPa, om: m.omegaPct, peri: m.periapsisM });
    guard++;
  }

  const m = sim.hudModel();
  const om = sim.omega.get();
  const orbit = sim.orbit.get();

  return {
    id: profile.id, name: profile.name, expect: profile.expect,
    outcome: sim.outcome,
    judgement: sim.judge.result,
    failureCode: sim.failure.record ? sim.failure.record.code : null,
    flightTime: sim.fm.t,
    periapsisKm: orbit.valid ? orbit.periapsis / 1000 : NaN,
    apoapsisKm: orbit.valid && Number.isFinite(orbit.apoapsis) ? orbit.apoapsis / 1000 : Infinity,
    regime: orbit.regime,
    maxQkPa: sim.atmo.qMax / 1000,
    tQMax: sim.atmo.tQMax,
    tSep: sim.staging.tSep,
    sepMass, massIdentityOk: Math.abs(sepMass - 16500) < 1,
    dvWasted: sim.staging.dvWasted,
    maxAlphaDeg: sim.fm.maxAlpha * 180 / Math.PI,
    dvRemain: sim.fm.dvRemain(),
    omegaFinal: m.omegaPct,
    omegaSource: om.source,
    switchT: om.switchT,
    switchJumpPct: om.switchJump * 100,
    omegaRegression: omegaRegress,
    min8sIncrementPct: sim.omega.min8sIncrement === Infinity ? null : sim.omega.min8sIncrement,
    nanSeen,
    trace,
  };
}

const results = PROFILES.map((p) => runProfile(p));

// ── 输出 ──
console.log('\n════════════ 闭环验证：玩家手动操控 vs 基准弹道 ════════════\n');
const head = ['画像', '结局', '评级', '时长s', '近地点km', '远地点km', '动压kPa', '姿态°', 'Ω终值', 'Ω回退', '切换s', '跳变%'];
console.log('  ' + head.map((h) => h.padEnd(10)).join(''));
console.log('  ' + '─'.repeat(120));
for (const r of results) {
  const cells = [
    r.name.slice(0, 9), r.outcome || '-', r.judgement, r.flightTime.toFixed(1),
    Number.isFinite(r.periapsisKm) ? r.periapsisKm.toFixed(2) : '∞',
    Number.isFinite(r.apoapsisKm) ? r.apoapsisKm.toFixed(0) : '∞',
    r.maxQkPa.toFixed(1), r.maxAlphaDeg.toFixed(1),
    r.omegaFinal.toFixed(1), r.omegaRegression.toExponential(1),
    r.switchT ? r.switchT.toFixed(1) : '-',
    r.switchJumpPct ? r.switchJumpPct.toFixed(3) : '-',
  ];
  console.log('  ' + cells.map((c) => String(c).padEnd(10)).join(''));
}

console.log('\n  ── 质量恒等式 & 失败归因 ──');
for (const r of results) {
  console.log(`  ${r.name.padEnd(28)} 分离质量=${r.sepMass ? r.sepMass.toFixed(1) : 'n/a'.padEnd(7)} (${r.massIdentityOk ? '✅16500' : '❌'})  浪费Δv=${r.dvWasted.toFixed(0)}m/s  失败码=${r.failureCode || '—'}`);
}

console.log('\n  ── 关键断言（RT-1 R4 的解除判据）──');
const A = results.find((r) => r.id === 'A-baseline');
const asserts = [
  ['A 正常玩家能入轨', A.outcome === 'SUCCESS' && A.judgement !== 'INCOMPLETE', A.judgement],
  ['A 时长接近基准 81s（±4s）', Math.abs(A.flightTime - 81.0) <= 4, A.flightTime.toFixed(2) + ' s'],
  ['A 近地点接近 15km（±2km）', Math.abs(A.periapsisKm - 15) <= 2, A.periapsisKm.toFixed(2) + ' km'],
  ['全部弹道 Ω 回退 = 0', results.every((r) => r.omegaRegression === 0), results.map((r) => r.omegaRegression).join('/')],
  ['全部弹道无 NaN 泄漏', results.every((r) => !r.nanSeen), ''],
  ['切换跳变 ≤ 0.5%', results.filter((r) => r.switchT).every((r) => r.switchJumpPct <= 0.5), results.filter((r) => r.switchT).map((r) => r.switchJumpPct.toFixed(3)).join('/')],
  ['安全窗口内分离质量恒为 16500', results.filter((r) => r.sepMass).every((r) => r.massIdentityOk), ''],
  ['多路径成立（低抛&高抛均入轨）', results.find((r) => r.id === 'B-low').outcome === 'SUCCESS' && results.find((r) => r.id === 'C-high').outcome === 'SUCCESS', ''],
  ['新手失败路径可触发', results.find((r) => r.id === 'F-novice').outcome === 'FAILURE', results.find((r) => r.id === 'F-novice').failureCode],
];
let pass = 0;
for (const [n, ok, v] of asserts) { console.log(`  ${ok ? '✅' : '❌'} ${n.padEnd(30)} ${v}`); if (ok) pass++; }
console.log(`\n  闭环判据：${pass}/${asserts.length} 通过`);

// 写 JSON（去掉 trace 以控体积）
const out = results.map(({ trace, ...rest }) => ({ ...rest, traceLen: trace.length }));
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'closed-loop-results.json'), JSON.stringify(out, null, 2));
console.log(`\n  结果已写入 tests/prototype/closed-loop-results.json`);
process.exitCode = pass === asserts.length ? 0 : 1;
