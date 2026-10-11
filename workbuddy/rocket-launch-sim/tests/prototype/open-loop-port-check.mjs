/**
 * 闭环验证 · 端口一致性（Open-Loop）
 *
 * 先证明 src/core 的物理端口与 RT-1 的开环标定**逐项一致**，再做闭环。
 * 这是"手动操控能否复现基准"之前必须先排除的变量：如果端口就不一致，
 * 闭环的偏差就无法归因于"玩家操控"。
 *
 * 期望（RT-1 §4）：近地点 15.09 km / 动压峰值 16.5 kPa / 单局 81.0 s /
 *                  关机速度 2087 m/s（水平 2073）。
 *
 * 用法：node tests/prototype/open-loop-port-check.mjs
 */

import { Simulation, SeqPhase } from '../../src/core/simulation.js';
import { Regime } from '../../src/core/orbit-solver.js';

const DT = 1 / 120;
const MAX_T = 200;

function runOpenLoop() {
  const sim = new Simulation({ skippable: false });
  sim.autoProgram = true;
  sim.autoStage = true;
  sim.setInput({ launch: true });

  let domMax = 0, guard = 0, sepMass = 0;
  const omegaTrace = [];
  while (sim.outcome === null && guard < MAX_T / DT) {
    sim.update(DT);
    if (sim.fm.separated && !sepMass) sepMass = sim.fm.m;
    const m = sim.hudModel();
    if (m.qPa > domMax) domMax = m.qPa;
    omegaTrace.push({ t: m.t, om: m.omegaPct });
    guard++;
  }
  return { sim, domMax, omegaTrace, sepMass };
}

const { sim, sepMass } = runOpenLoop();
const fm = sim.fm;
const orbit = sim.orbit.get();
const periKm = orbit.periapsis / 1000;
const apoKm = orbit.apoapsis / 1000;
const isOrb = (orbit.regime === Regime.ELLIPTIC || orbit.regime === Regime.CIRCULAR)
  && orbit.periapsis >= 13500 && Number.isFinite(orbit.apoapsis);

const rows = [
  ['近地点 km', periKm.toFixed(2), '15.09 ±0.5'],
  ['远地点 km', Number.isFinite(apoKm) ? apoKm.toFixed(1) : '∞', '有限 (8746)'],
  ['关机高度 km', (fm.h / 1000).toFixed(2), '19.41'],
  ['关机速度 m/s', fm.v.toFixed(0), '2087'],
  ['水平分量 m/s', fm.vh.toFixed(0), '2073'],
  ['峰值动压 kPa', (sim.atmo.qMax / 1000).toFixed(2), '16.5 ±1'],
  ['峰值动压时刻 s', sim.atmo.tQMax.toFixed(2), '19.16'],
  ['单局时长 s', fm.t.toFixed(2), '81.0 ±1.5'],
  ['起飞推重比', sim.rocket.TWR0.toFixed(3), '2.693'],
  ['总 Δv m/s', sim.rocket.DV_TOTAL.toFixed(1), '2635'],
  ['结局', isOrb ? '✅ 入轨' : '❌ ' + orbit.regime, '入轨'],
];

console.log('\n═══ 端口一致性（开环，对照 RT-1 §4）═══');
for (const [k, got, want] of rows) console.log(`  ${k.padEnd(16)} 实测 ${String(got).padStart(10)}   参照 ${want}`);

const checks = [
  ['时长 ∈ [79.5,82.5]', fm.t >= 79.5 && fm.t <= 82.5, fm.t.toFixed(2)],
  ['近地点 ∈ [13.5,17.0]km', periKm >= 13.5 && periKm <= 17.0, periKm.toFixed(2)],
  ['动压 ∈ [15.5,17.5]kPa', sim.atmo.qMax / 1000 >= 15.5 && sim.atmo.qMax / 1000 <= 17.5, (sim.atmo.qMax / 1000).toFixed(2)],
  ['动压时刻 ∈ [18.5,20.0]s', sim.atmo.tQMax >= 18.5 && sim.atmo.tQMax <= 20.0, sim.atmo.tQMax.toFixed(2)],
  ['TWR0 ∈ [2.65,2.74]', sim.rocket.TWR0 >= 2.65 && sim.rocket.TWR0 <= 2.74, sim.rocket.TWR0.toFixed(3)],
  ['Δv ∈ [2630,2640]', sim.rocket.DV_TOTAL >= 2630 && sim.rocket.DV_TOTAL <= 2640, sim.rocket.DV_TOTAL.toFixed(1)],
  ['严格入轨', isOrb, orbit.regime + ' peri=' + periKm.toFixed(2)],
  ['SECO 质量≈12000', Math.abs(fm.m - 12000) < 20, fm.m.toFixed(1)],
  ['分离后质量恒等式', Math.abs(sepMass - 16500) < 1, sepMass ? sepMass.toFixed(1) : 'n/a'],
];
let pass = 0;
console.log('\n─── 断言 ───');
for (const [name, ok, got] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(26)} ${got}`);
  if (ok) pass++;
}
console.log(`\n  端口一致性：${pass}/${checks.length} 通过`);
process.exitCode = pass === checks.length ? 0 : 1;
