/**
 * 定向探针：V5 中止（Abort）在各阶段是否真的生效？
 * 用法：node tests/qa/probe-abort.mjs
 */
import { Simulation, SeqPhase } from '../../src/core/simulation.js';

const DT = 1 / 120;

function toFlying() {
  const sim = new Simulation({ skippable: false });
  sim.setInput({ launch: true });
  let g = 0;
  while (sim.phase !== SeqPhase.FLIGHT && g < 5000) { sim.update(DT); g++; }
  return sim;
}

console.log('══ V5 中止（Abort）分阶段探针 ══\n');

// ① 飞行段按 ESC（最主要的使用窗口）
{
  const sim = toFlying();
  console.log(`起飞前：phase=${sim.phase}`);
  sim.setInput({ abort: true });
  for (let i = 0; i < 60; i++) sim.update(DT);      // 0.5s 后
  console.log(`飞行段按 ESC 后 0.5s：phase=${sim.phase}  outcome=${sim.outcome}  failed=${sim.failure.failed}`);
  console.log(`  → 中止是否生效：${sim.phase === SeqPhase.ABORTED ? '✅ 生效' : '❌ 未生效（ESC 被吞）'}`);
  // 直接看 abort 脉冲是否被消费
  console.log(`  _abortPulse 残留=${sim._abortPulse}（1 = 从未被消费）\n`);
}

// ② 松绑段（RELEASE）按 ESC
{
  const sim = new Simulation({ skippable: false });
  sim.setInput({ launch: true });
  // 推进到 RELEASE 相位
  let g = 0;
  while (sim.phase !== SeqPhase.RELEASE && g < 5000) { sim.update(DT); g++; }
  console.log(`推进到：phase=${sim.phase}`);
  sim.setInput({ abort: true });
  sim.update(DT);
  console.log(`松绑段按 ESC：phase=${sim.phase}  → ${sim.phase === SeqPhase.ABORTED ? '✅ 生效' : '❌ 未生效'}\n`);
}

// ③ 倒计时段按 ESC（已验证可回 IDLE）
{
  const sim = new Simulation({ skippable: false });
  sim.setInput({ launch: true });
  for (let i = 0; i < 200; i++) sim.update(DT);
  sim.setInput({ abort: true }); sim.update(DT);
  console.log(`倒计时段按 ESC：phase=${sim.phase}  → ${sim.phase === SeqPhase.IDLE ? '✅ 回 IDLE（不计失败）' : '❌'}\n`);
}

// ④ 用 fire-and-forget 的 abort 语义再试一次飞行段（是否只是"当帧未推进"）
{
  const sim = toFlying();
  sim.setInput({ abort: true });
  let abortedAt = null;
  for (let i = 0; i < 600; i++) { sim.update(DT); if (sim.phase === SeqPhase.ABORTED) { abortedAt = i; break; } }
  console.log(`飞行段持续推进 5s 寻找 ABORTED：${abortedAt === null ? '❌ 从未进入 ABORTED' : '✅ 第 ' + abortedAt + ' 帧'}`);
}
