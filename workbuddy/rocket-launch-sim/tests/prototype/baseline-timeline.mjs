/**
 * 基准弹道时间线（Task 1 诊断用）
 *
 * 逐秒打印开环基准弹道的可读状态，用于回答：
 *  - 前 20 s 玩家到底"看到"什么？
 *  - 早期倾倒的物理代价有多大（气动 vs 重力）？
 *  - 节流对 Max-Q 的实际影响？
 *
 * 用法：node tests/prototype/baseline-timeline.mjs
 */
import { Simulation } from '../../src/core/simulation.js';
import { ROCKET, WORLD, CONTROL, FAIL } from '../../src/core/constants.js';

const DT = CONTROL.DT;

function run(throttlePlan) {
  const sim = new Simulation({ skippable: false });
  sim.autoProgram = true;   // 开环参考程序
  sim.autoStage = true;
  sim.setInput({ launch: true });

  let dragDv = 0, gravDv = 0;
  const rows = [];
  let lastSec = -1, guard = 0;
  while (sim.outcome === null && guard < 120 * 140) {
    sim.update(DT);
    const fm = sim.fm;
    const m = sim.hudModel();
    // 损失记账（数值积分）
    const aDrag = fm.q * (WORLD.CD0 + WORLD.CD_ALPHA * Math.sin(fm.alpha) ** 2) * WORLD.A_REF / fm.m;
    dragDv += aDrag * DT;
    const aGrav = WORLD.G0 * (1 - (fm.ry / Math.sqrt(fm.rx * fm.rx + fm.ry * fm.ry)) ** 2); // 未用，占位
    const sec = Math.floor(fm.t);
    if (sec !== lastSec) {
      lastSec = sec;
      rows.push({
        t: fm.t, h: fm.h, v: fm.v, vh: fm.vh,
        gammaDeg: fm.gamma * 180 / Math.PI,
        thetaDeg: fm.theta * 180 / Math.PI,
        alphaDeg: fm.alpha * 180 / Math.PI,
        q: fm.q, dragN: fm.drag, aDragMs2: aDrag,
        dragDv, cdRatio: 1 + (WORLD.CD_ALPHA / WORLD.CD0) * Math.sin(fm.alpha) ** 2,
        throttle: fm.throttle, thustKN: fm.thrust / 1000, m: fm.m,
      });
    }
    guard++;
  }
  return { sim, rows, dragDv };
}

console.log('=== 基准开环 · 逐秒（节流=1.0） ===');
const { sim, rows, dragDv } = run(null);
console.log('t     h(km)  v     vh    γ°     θ°    α°     q(kPa)  D(kN)  aD(m/s²) 累积气动Δv  Cd×   τ     m(t)');
for (const r of rows) {
  if (r.t > 40 && r.t % 5 !== 0) continue;
  console.log(
    r.t.toFixed(0).padStart(3),
    (r.h / 1000).toFixed(2).padStart(7),
    r.v.toFixed(0).padStart(5),
    r.vh.toFixed(0).padStart(5),
    r.gammaDeg.toFixed(1).padStart(6),
    r.thetaDeg.toFixed(1).padStart(6),
    r.alphaDeg.toFixed(2).padStart(6),
    (r.q / 1000).toFixed(2).padStart(7),
    (r.dragN / 1000).toFixed(1).padStart(6),
    r.aDragMs2.toFixed(2).padStart(8),
    r.dragDv.toFixed(1).padStart(10),
    r.cdRatio.toFixed(2).padStart(5),
    r.throttle.toFixed(2).padStart(4),
    (r.m / 1000).toFixed(1).padStart(5),
  );
}
const fm = sim.fm;
console.log('\n结局:', sim.outcome, sim.judge.result, '时长', fm.t.toFixed(2), 's');
console.log('峰值动压', (sim.atmo.qMax / 1000).toFixed(2), 'kPa @', sim.atmo.tQMax.toFixed(2), 's, h=', (sim.atmo.hQMax / 1000).toFixed(2), 'km');
console.log('累积气动损失 Δv ≈', dragDv.toFixed(1), 'm/s  (占总 Δv 2635 的', (dragDv / 2635 * 100).toFixed(1), '%)');
console.log('最大攻角 |α|max =', (fm.maxAlpha * 180 / Math.PI).toFixed(2), '°');
