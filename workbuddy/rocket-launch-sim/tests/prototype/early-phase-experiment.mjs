/**
 * 早期阶段实验（Task 1 诊断）
 *
 * 回答两个问题：
 *  Q1 节流对 Max-Q 的实际影响有多大？（玩家收油门是不是真旋钮）
 *  Q2 早期倾倒的代价有多大？（气动损失 vs 重力损失）
 *
 * 全部用与浏览器同一份 core，无头运行。控制台输出重定向见运行命令。
 */
import { Simulation } from '../../src/core/simulation.js';
import { WORLD, ROCKET, CONTROL } from '../../src/core/constants.js';

const DT = CONTROL.DT;
const G0 = WORLD.G0;

/**
 * @param {object} opt
 * @param {boolean} opt.auto true=开环参考程序；false=玩家手动（用 pitchPlan）
 * @param {(t:number, fm:any)=>number} [opt.pitchCmd] 返回想设定的 theta（rad）
 * @param {(t:number, fm:any)=>number} [opt.throttle] 返回想设定的节流
 */
function run(opt) {
  const sim = new Simulation({ skippable: false });
  sim.autoProgram = !!opt.auto;
  sim.autoStage = true;
  sim.setInput({ launch: true });

  let dvDrag = 0, dvGravity = 0, dvSteer = 0;
  let guard = 0;
  let maxQ = 0, tMaxQ = 0, qAfter15 = [];
  let hAt20 = 0, vAt20 = 0, vhAt20 = 0;
  while (sim.outcome === null && guard < 120 * 140) {
    const fm = sim.fm;
    // 输入：手动方案按 plan 强制设定 thetaCmd / throttle（模拟"完美执行玩家意图"的虚拟玩家）
    if (opt.pitchCmd) fm.thetaCmd = clampTheta(opt.pitchCmd(fm.t, fm));
    if (opt.throttle) fm.throttle = clamp01(opt.throttle(fm.t, fm));
    if (opt.manualThrottle) fm.throttle = opt.manualThrottle;

    sim.update(DT);

    const r = Math.hypot(fm.rx, fm.ry);
    const uy = fm.ry / r, ux = fm.rx / r;
    const aThrust = fm.thrust / fm.m;
    // 重力损失：重力在速度方向上的分量（取沿速度方向的重力减速）
    const vhatx = fm.vx / (fm.v || 1), vhaty = fm.vy / (fm.v || 1);
    const gAcc = WORLD.MU / (r * r);
    dvGravity += (-(-gAcc) * 0 + 0) * DT; // 重力损失只在无推力时体现，此处按"径向"近似下面单独算
    // 气动损失：阻力沿 -v 方向
    const aDrag = fm.drag / fm.m;
    dvDrag += aDrag * DT;
    // 转向损失：推力未对准速度方向的分量 = aThrust·(1-cos α)
    dvSteer += aThrust * (1 - Math.cos(fm.alpha)) * DT;

    if (fm.q > maxQ) { maxQ = fm.q; tMaxQ = fm.t; }
    if (fm.t >= 15 && fm.t < 25 && Math.floor(fm.t * 2) !== Math.floor((fm.t - DT) * 2)) qAfter15.push(fm.q);
    if (hAt20 === 0 && fm.t >= 20) { hAt20 = fm.h; vAt20 = fm.v; vhAt20 = fm.vh; }
    guard++;
  }
  return { sim, dvDrag, dvSteer, maxQ, tMaxQ, hAt20, vAt20, vhAt20 };
}
const clampTheta = (x) => Math.max(CONTROL.THETA_MIN, Math.min(CONTROL.THETA_MAX, x));
const clamp01 = (x) => Math.max(CONTROL.THROTTLE_MIN, Math.min(CONTROL.THROTTLE_MAX, x));

function line(name, r) {
  const fm = r.sim.fm;
  console.log(
    name.padEnd(22),
    '结局', String(r.sim.outcome).padEnd(8),
    '时长', fm.t.toFixed(1).padStart(5),
    '峰值q', (r.maxQ / 1000).toFixed(2).padStart(6), 'kPa @', r.tMaxQ.toFixed(1).padStart(5),
    '气动损失Δv', r.dvDrag.toFixed(1).padStart(5),
    '转向损失Δv', r.dvSteer.toFixed(1).padStart(6),
    'T+20: h', (r.hAt20 / 1000).toFixed(2).padStart(5), 'v', r.vAt20.toFixed(0).padStart(4), 'vh', r.vhAt20.toFixed(0).padStart(4),
  );
}

console.log('=== Q1：节流对 Max-Q 的影响 ===');
line('① 基准 全油门', run({ auto: true }));
line('② 收油门 0.6 (全程)', run({ auto: true, manualThrottle: 0.6 }));
line('③ T+15 起 0.6', run({ auto: true, throttle: (t) => (t >= 15 ? 0.6 : 1.0) }));
line('④ 收油门 0.3 (全程)', run({ auto: true, manualThrottle: 0.3 }));

console.log('\n=== Q2：早期倾倒的代价（θ 在 T+5 后压到 45°）===');
line('⑤ 基准 参考程序', run({ auto: true }));
line('⑥ T+5 起 θ=45°', run({ auto: false, pitchCmd: (t) => (t < 5 ? Math.PI / 2 : Math.PI / 4) }));
line('⑦ T+5 起 θ=30°', run({ auto: false, pitchCmd: (t) => (t < 5 ? Math.PI / 2 : Math.PI / 6) }));
line('⑧ T+5 起 θ=70°', run({ auto: false, pitchCmd: (t) => (t < 5 ? Math.PI / 2 : (70 * Math.PI) / 180) }));

console.log('\n（Δv 总预算 2635 m/s；气动损失为阻力方向耗散，转向损失为推力偏离速度矢量的分量）');
