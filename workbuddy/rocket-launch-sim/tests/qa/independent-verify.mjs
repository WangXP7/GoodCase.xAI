/**
 * 独立验证套件 · QA（严守真）
 *
 * 设计原则：**不复用 `verify-prototype.mjs` 的断言、不复用被测模块自报的指标。**
 *   - Ω 单调/连续 → 用「独立采样 + 独立重算公式」判定，不读 `omega.switchJump`。
 *   - 3 秒重开   → 用真实渲染帧（1/60s）驱动，验证「锁定-解锁」全过程。
 *   - 鲁棒性     → 构造异常输入（NaN / Infinity / 巨帧 / 负帧 / 乱按）。
 *   - 覆盖缺口   → 对全部 FailureCode 做可达性普查。
 *   - 约束遵从   → 自动化审计 control-manifest（依赖隔离 / 确定性 / 热路径分配）。
 *
 * 用法（需 --expose-gc 测分配）：
 *   node --expose-gc tests/qa/independent-verify.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Simulation, SeqPhase, Judgement } from '../../src/core/simulation.js';
import { FailureCode } from '../../src/core/failure.js';
import { WORLD, ROCKET, CONTROL, OMEGA, JUDGE, FAIL, STAGE } from '../../src/core/constants.js';
import { PlayerModel } from '../../src/core/player-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DT = 1 / 120;

let nPass = 0, nFail = 0, nWarn = 0;
const lines = [];
function rec(level, id, name, detail = '') {
  if (level === 'PASS') nPass++; else if (level === 'FAIL') nFail++; else nWarn++;
  const tag = level === 'PASS' ? '✅' : level === 'FAIL' ? '❌' : '⚠️ ';
  lines.push(`${tag} [${id}] ${name}${detail ? '  · ' + detail : ''}`);
  console.log(`${tag} [${id}] ${name}${detail ? '  · ' + detail : ''}`);
}
const chk = (id, name, cond, detail = '') => rec(cond ? 'PASS' : 'FAIL', id, name, detail);
function section(t) { lines.push(`\n── ${t} ──`); console.log(`\n── ${t} ──`); }

// ══════════════════════════════════════════════════════════════════════════
// 通用工具
// ══════════════════════════════════════════════════════════════════════════
function freshFlying() {
  const sim = new Simulation({ skippable: false });
  sim.setInput({ launch: true });
  let g = 0;
  while (sim.phase !== SeqPhase.FLIGHT && g < 5000) { sim.update(DT); g++; }
  return sim;
}
const FIN_KEYS = ['rx', 'ry', 'vx', 'vy', 'm', 'fuel1', 'fuel2', 'h', 'v', 'vh', 'theta', 'alpha', 'q', 'thrust', 'drag', 't'];
function finiteFM(fm) {
  for (const k of FIN_KEYS) if (!Number.isFinite(fm[k])) return k;
  return null;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 独立实现 S7 §2 的 Ω 公式（与 omega.js 无共享代码）
function omegaSpec(h, vh, hP, prev) {
  const A = Math.max(0, h) / WORLD.H;
  const B = WORLD.VC > 1 ? (vh / WORLD.VC) ** 2 : 0;
  const o0 = Math.max(0.45 * A + 0.55 * B, prev.o0);
  const hEq = -WORLD.R * (1 - Math.min(o0 / 1.60, 1));
  const hDisp = Math.max(Math.max(hEq, hP), prev.hDisp);
  const G = hDisp < 0 ? 0.60 * (1 + hDisp / WORLD.R) : Math.min(1, 0.60 + 0.40 * (hDisp / WORLD.H));
  const s = Math.pow(Math.max(0, G), 0.55);
  return { o0, hEq, hDisp, s, omega: 100 * s };
}

// ══════════════════════════════════════════════════════════════════════════
// V1 · Ω 单调 / 连续 —— 独立重算 + 独立采样（不读 switchJump）
// ══════════════════════════════════════════════════════════════════════════
section('V1 · Ω 单调/连续（独立重算，不读模块自报 switchJump）');
let openLoop = null;
{
  const sim = new Simulation({ skippable: false });
  sim.autoProgram = true; sim.autoStage = true; sim.setInput({ launch: true });
  const samples = [];
  let g = 0;
  while (sim.outcome === null && g < 24000) {
    sim.update(DT);
    if (sim.flying) {
      const o = sim.orbit.get();
      samples.push({ t: sim.fm.t, h: sim.fm.h, vh: sim.fm.vh, hP: o.periapsis, moduleOm: sim.hudModel().omegaPct, switched: sim.omega.get().switched });
    }
    g++;
  }
  openLoop = { sim, samples };

  // (a) 独立重算公式，与模块输出逐位比对
  let prev = { o0: 0, hDisp: -WORLD.R };
  let maxDiff = 0, worstT = 0;
  for (const s of samples) {
    const mine = omegaSpec(s.h, s.vh, s.hP, prev);
    prev = { o0: mine.o0, hDisp: mine.hDisp };
    const d = Math.abs(mine.omega - s.moduleOm);
    if (d > maxDiff) { maxDiff = d; worstT = s.t; }
  }
  chk('V1-a', 'Ω 逐帧 = 独立实现的 S7 公式（Δ<1e-9）', maxDiff < 1e-9, `maxΔ=${maxDiff.toExponential(2)} @T+${worstT.toFixed(1)}s`);

  // (b) 独立单调性：我自己重算的序列不得回退
  prev = { o0: 0, hDisp: -WORLD.R };
  let regress = 0, last = 0, regressT = null;
  for (const s of samples) {
    const mine = omegaSpec(s.h, s.vh, s.hP, prev);
    prev = { o0: mine.o0, hDisp: mine.hDisp };
    if (mine.omega < last - 1e-9) { regress = Math.max(regress, last - mine.omega); if (regressT === null) regressT = s.t; }
    last = mine.omega;
  }
  chk('V1-b', '独立重算 Ω 全程回退 = 0', regress === 0, `回退=${regress}${regressT ? ' @T+' + regressT.toFixed(1) : ''}`);

  // (c) 独立连续性：全程逐帧 |ΔΩ| 的最大值 & 切换帧是否异常
  const deltas = [];
  for (let i = 1; i < samples.length; i++) deltas.push(Math.abs(samples[i].moduleOm - samples[i - 1].moduleOm));
  const maxDelta = Math.max(...deltas);
  const sorted = [...deltas].sort((a, b) => a - b);
  const p999 = sorted[Math.floor(sorted.length * 0.999)];
  const swIdx = samples.findIndex((s) => s.switched);
  const deltaAtSwitch = swIdx > 0 ? Math.abs(samples[swIdx].moduleOm - samples[swIdx - 1].moduleOm) : 0;
  chk('V1-c', '全程逐帧 |ΔΩ| 无跳变（< 1% 条宽）', maxDelta < 1.0, `max逐帧Δ=${maxDelta.toFixed(3)}% · p99.9=${p999.toFixed(3)}%`);
  // 切换帧的跳变不应显著大于邻帧——若相当，说明"切换跳变"指标本身是空泛的
  const ratio = deltaAtSwitch / (p999 || 1e-9);
  rec(ratio < 2 ? 'PASS' : 'WARN', 'V1-d',
    '切换帧跳变 vs 常规帧跳变（该指标是否真的在测"切换"）',
    `切换帧Δ=${deltaAtSwitch.toFixed(4)}% · p99.9=${p999.toFixed(4)}% · 比值=${ratio.toFixed(2)}× → ` +
    (ratio < 2 ? '切换处与普通帧无差异，模块的 switchJump 度量的是常规单步增量，不构成对"不连续"的检验' : '切换处确有异常'));

  // (d) 独立无死区：任意 8s 窗口最小增量
  let min8 = Infinity;
  for (const s of samples) {
    const target = s.t - 8;
    let idx = -1;
    for (let i = 0; i < samples.length; i++) { if (samples[i].t >= target) { idx = i; break; } }
    if (idx >= 0 && samples[idx].t <= s.t - 8 + 1e-6) {
      const inc = s.moduleOm - samples[idx].moduleOm;
      if (inc < min8) min8 = inc;
    }
  }
  chk('V1-e', '无死区：任意 8s 窗口 Ω 增量 ≥ 4.0%（S7 A7-3）', min8 >= 4.0, `最差增量=${min8.toFixed(2)}%`);
  // 切换时刻 & 模态 B 时长（S7 A7-4/A7-5）
  const swT = swIdx > 0 ? samples[swIdx].t : null;
  const bDur = swT !== null ? samples[samples.length - 1].t - swT : 0;
  chk('V1-f', '切换时刻 ∈ [58,68]s（S7 A7-4）', swT !== null && swT >= 58 && swT <= 68, `T+${swT === null ? '-' : swT.toFixed(2)}s`);
  chk('V1-g', '模态 B 可读时长 ≥ 12s（S7 A7-5）', bDur >= 12, `${bDur.toFixed(2)}s`);
}

// ══════════════════════════════════════════════════════════════════════════
// V2 · 3 秒重开硬指标（真实渲染帧驱动，验证锁定-解锁全过程）
// ══════════════════════════════════════════════════════════════════════════
section('V2 · 3 秒重开硬指标（真实 1/60s 帧驱动）');
{
  const sim = new Simulation({ skippable: false });
  sim.autoStage = true;
  sim.setInput({ launch: true });
  let g = 0;
  while (sim.outcome === null && g < 24000) { sim.setInput({ pitch: 0, throttle: 0 }); sim.update(DT); g++; }
  chk('V2-a', '已进入失败态', sim.outcome === 'FAILURE', `${sim.outcome} · ${sim.failure.record && sim.failure.record.code}`);

  // 用 1/60s 的真实渲染帧推进，逐步记录 canRestart
  const FRAME = 1 / 60;
  let firstTrueFrame = null, trueSeconds = null, heldLockedAlwaysBefore = true;
  for (let i = 0; i < 400; i++) {
    sim.update(FRAME);
    const m = sim.hudModel();
    if (m.canRestart) {
      if (firstTrueFrame === null) { firstTrueFrame = i + 1; trueSeconds = m.timeSinceFailure; }
    } else if (firstTrueFrame !== null) { /* 不该解锁后又锁 */ }
    if (firstTrueFrame === null && m.canRestart) heldLockedAlwaysBefore = false;
  }
  chk('V2-b', '失败后 ≤3.0s 可重开', trueSeconds !== null && trueSeconds <= 3.0, `${trueSeconds === null ? 'n/a' : trueSeconds.toFixed(2)}s（${firstTrueFrame} 帧 @60fps）`);
  chk('V2-c', '解锁前 canRestart 恒为 false（演出锁定）', heldLockedAlwaysBefore === true && firstTrueFrame > 1, `首次解锁于第 ${firstTrueFrame} 帧 ≈ ${(firstTrueFrame / 60).toFixed(2)}s`);
  rec('PASS', 'V2-d', '重开锁定实测时长（替代原套件的硬编码 true 断言）', `canRestart 门限 = ${trueSeconds.toFixed(2)}s`);

  // 重开后：状态清零 + 第二局逐位可复现
  const before = { rx: sim.fm.rx, ry: sim.fm.ry, vx: sim.fm.vx, vy: sim.fm.vy, m: sim.fm.m, t: sim.fm.t };
  sim.reset();
  const afterReset = { phase: sim.phase, t: sim.fm.t, omega: sim.hudModel().omegaPct, outcome: sim.outcome };
  chk('V2-e', '重开后回到 IDLE 且 Ω=0 / t=0', afterReset.phase === SeqPhase.IDLE && afterReset.omega === 0 && afterReset.t === 0 && afterReset.outcome === null,
    `phase=${afterReset.phase} Ω=${afterReset.omega} t=${afterReset.t} outcome=${afterReset.outcome}`);

  // 第二局与第一局末状态逐位一致
  const run2 = new Simulation({ skippable: false });
  run2.autoStage = true; run2.setInput({ launch: true });
  g = 0;
  while (run2.outcome === null && g < 24000) { run2.setInput({ pitch: 0, throttle: 0 }); run2.update(DT); g++; }
  const bitSame = before.rx === run2.fm.rx && before.ry === run2.fm.ry && before.vx === run2.fm.vx
    && before.vy === run2.fm.vy && before.m === run2.fm.m && before.t === run2.fm.t;
  chk('V2-f', '重开后第二局与第一局末状态逐位一致', bitSame, bitSame ? 'rx/ry/vx/vy/m/t 全等' : `${before.rx} vs ${run2.fm.rx}`);
}

// ══════════════════════════════════════════════════════════════════════════
// V3 · 异常输入鲁棒性
// ══════════════════════════════════════════════════════════════════════════
section('V3 · 异常输入鲁棒性（NaN / Infinity / 巨帧 / 负帧 / 乱按 / 倒计时操作）');
{
  // (a) NaN 经 setInput 注入
  {
    const sim = freshFlying();
    sim.setInput({ pitch: NaN }); sim.setInput({ throttle: NaN });
    let threw = false;
    try { for (let i = 0; i < 10; i++) sim.update(DT); } catch (e) { threw = true; }
    const bad = finiteFM(sim.fm);
    chk('V3-a', 'NaN 输入被拒或净化（不留 NaN）', !threw && bad === null,
      threw ? '抛异常' : (bad ? `NaN 泄漏到 fm.${bad}（θ=${sim.fm.theta}, h=${sim.fm.h}, m=${sim.fm.m}）` : 'ok'));
  }
  // (b) Infinity 输入
  {
    const sim = freshFlying();
    sim.setInput({ pitch: Infinity }); sim.setInput({ throttle: Infinity });
    let threw = false;
    try { for (let i = 0; i < 240; i++) sim.update(DT); } catch (e) { threw = true; }
    const bad = finiteFM(sim.fm);
    chk('V3-b', 'Infinity 输入被夹紧（不留 Inf/NaN）', !threw && bad === null,
      threw ? '抛异常' : (bad ? `非有限值泄漏到 fm.${bad}` : 'ok'));
  }
  // (c) 巨型 / 无限 / 负帧 / NaN 帧
  {
    const results = [];
    for (const [label, fdt] of [['巨帧 1e6', 1e6], ['Infinity 帧', Infinity], ['负帧 -1', -1], ['NaN 帧', NaN], ['零帧 0', 0]]) {
      const sim = freshFlying();
      let threw = false;
      try { sim.update(fdt); for (let i = 0; i < 120; i++) sim.update(DT); } catch (e) { threw = true; }
      const bad = finiteFM(sim.fm);
      const advanced = sim.fm.t;
      results.push({ label, threw, bad, advanced });
    }
    for (const r of results) {
      chk('V3-c-' + r.label, `frameDt=${r.label} 不崩溃且状态有限`, !r.threw && r.bad === null,
        r.threw ? '抛异常' : (r.bad ? `fm.${r.bad} 非有限` : `推进至 T+${r.advanced.toFixed(3)}s`));
    }
    const nanFrame = results.find((r) => r.label === 'NaN 帧');
    const zeroFrame = results.find((r) => r.label === '零帧 0');
    if (nanFrame && zeroFrame && nanFrame.advanced < zeroFrame.advanced - 1e-9 && !nanFrame.bad) {
      rec('WARN', 'V3-c-NaNFreeze', 'NaN 帧把积分器永久冻结（acc=NaN，物理不再推进）',
        `NaN 帧后 T+${nanFrame.advanced.toFixed(3)}s（对照正常帧 T+${zeroFrame.advanced.toFixed(3)}s）—— 无异常抛出、无 NaN 泄漏，但状态机静默卡死`);
    }
  }
  // (d) 乱按 fuzz（确定性种子，可复现）
  {
    let crashes = 0, nanCases = 0, worst = null;
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed);
      const sim = new Simulation({ skippable: seed % 2 === 0 });
      let threw = false;
      try {
        for (let i = 0; i < 4000; i++) {
          if (rnd() < 0.3) sim.setInput({ launch: rnd() < 0.5 });
          if (rnd() < 0.3) sim.setInput({ pitch: (rnd() * 3 - 1.5) });
          if (rnd() < 0.3) sim.setInput({ throttle: (rnd() * 3 - 1.5) });
          if (rnd() < 0.1) sim.setInput({ stage: rnd() < 0.5 });
          if (rnd() < 0.02) sim.setInput({ abort: true });
          sim.update(rnd() < 0.02 ? rnd() * 0.5 : DT);
        }
      } catch (e) { threw = true; }
      const bad = finiteFM(sim.fm);
      if (threw) crashes++;
      if (bad) { nanCases++; if (!worst) worst = { seed, bad }; }
    }
    chk('V3-d', '随机乱按 40 局（含倒计时中操作）无崩溃', crashes === 0, `崩溃 ${crashes}/40`);
    chk('V3-e', '随机乱按 40 局无 NaN/Inf 泄漏到物理态', nanCases === 0, nanCases ? `${nanCases}/40 局泄漏（例 seed=${worst.seed} → fm.${worst.bad}）` : '全部有限');
  }
  // (e) 长按 / 倒计时期间操作
  {
    const sim = new Simulation({ skippable: false });
    sim.setInput({ launch: true });
    for (let i = 0; i < 600; i++) { sim.setInput({ pitch: 1 }); sim.setInput({ throttle: 1 }); sim.setInput({ stage: true }); sim.update(DT); }
    chk('V3-f', '倒计时期间猛按配平/节流/分离：序列不被破坏', sim.phase === SeqPhase.COUNTDOWN || sim.phase === SeqPhase.RELEASE || sim.phase === SeqPhase.FLIGHT,
      `phase=${sim.phase} · 分离未误触发(stage=${sim.fm.stage})`);
    // 倒计时中中止 → 回 IDLE，且不计失败
    const s2 = new Simulation({ skippable: false });
    s2.setInput({ launch: true });
    for (let i = 0; i < 200; i++) s2.update(DT);
    s2.setInput({ abort: true }); s2.update(DT);
    chk('V3-g', '倒计时中按 ESC → 回 IDLE，不计失败', s2.phase === SeqPhase.IDLE && s2.outcome === null && !s2.failure.failed, `phase=${s2.phase} outcome=${s2.outcome}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// V4 · 失败码可达性普查（现有套件只覆盖 ESCAPE_TRAJ）
// ══════════════════════════════════════════════════════════════════════════
section('V4 · 全部 FailureCode 可达性普查');
{
  const reachable = new Set();
  const detail = {};

  // ① 从不倾倒（垂直硬顶）
  {
    const sim = new Simulation({ skippable: false });
    sim.autoStage = true; sim.setInput({ launch: true });
    let g = 0;
    while (sim.outcome === null && g < 24000) { sim.setInput({ pitch: 0, throttle: 0 }); sim.update(DT); g++; }
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] = `T+${sim.fm.t.toFixed(1)}s`; }
  }
  // ② 一级结束后不收油门（耗尽燃料不关机）→ 触发多种
  {
    const sim = new Simulation({ skippable: false });
    sim.autoStage = true; sim.setInput({ launch: true });
    let g = 0;
    // 一直满油低抛
    while (sim.outcome === null && g < 24000) { sim.setInput({ pitch: sim.fm.t > 5 && sim.fm.t < 20 ? -1 : 0, throttle: 0 }); sim.update(DT); g++; }
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] ??= `T+${sim.fm.t.toFixed(1)}s`; }
  }
  // ③ 过早分离（Max-Q 区按 SHIFT）→ SEP_HIGHQ
  {
    const sim = new Simulation({ skippable: false });
    sim.setInput({ launch: true });
    let g = 0, pressed = false;
    while (sim.outcome === null && g < 24000) {
      if (!pressed && sim.fm.t >= 14) { sim.setInput({ stage: true }); pressed = true; }
      sim.setInput({ pitch: 0, throttle: 0 });
      sim.update(DT); g++;
    }
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] ??= `T+${sim.fm.t.toFixed(1)}s`; }
  }
  // ④ 激进早抛（搜索 DESTRUCT_AERO / IMPACT / TUMBLE / INSUFFICIENT_DV）
  for (const [hTurn, p] of [[0, 0.2], [100, 0.3], [3000, 0.3], [2000, 1.5], [40000, 3.0], [1e9, 1.0]]) {
    const sim = new Simulation({ skippable: false });
    const model = new PlayerModel({ hTurn, p, deadbandDeg: 0.5, updateHz: 60, stageAtBurnout: true });
    let g = 0;
    while (sim.outcome === null && g < 24000) { model.update(sim, DT); sim.update(DT); g++; }
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] ??= `T+${sim.fm.t.toFixed(1)}s (hTurn=${hTurn})`; }
  }
  // ⑤ 主动中止
  {
    const sim = freshFlying();
    sim.setInput({ abort: true }); sim.update(DT);
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] = `T+${sim.fm.t.toFixed(1)}s`; }
  }
  // ⑥ 二级段主动关机但近地点不足 → INSUFFICIENT_DV
  {
    const sim = new Simulation({ skippable: false });
    sim.autoStage = true; sim.setInput({ launch: true });
    let g = 0;
    while (sim.outcome === null && g < 24000) {
      if (sim.fm.stage === 2 && sim.fm.t >= 70) sim.setInput({ throttle: -1 });
      sim.update(DT); g++;
    }
    if (sim.failure.record) { reachable.add(sim.failure.record.code); detail[sim.failure.record.code] ??= `T+${sim.fm.t.toFixed(1)}s`; }
  }

  const ALL = Object.values(FailureCode);
  const miss = ALL.filter((c) => !reachable.has(c));
  rec('PASS', 'V4-a', '失败码可达性普查完成', `可达 ${reachable.size}/${ALL.length}：${[...reachable].join(', ')}`);
  if (miss.includes(FailureCode.DESTRUCT_ALPHA)) {
    rec('FAIL', 'V4-b', 'FailureCode.DESTRUCT_ALPHA 不可达（死代码，P2 归因降级）',
      'failure.js detect() 条件① q>Q_STRUCT 先于条件② 返回，② 同时要求 q>Q_STRUCT ⇒ 永久被遮蔽；高攻角解体永远被报成「气动解体」而非「箭体折断」');
  } else {
    rec('PASS', 'V4-b', 'DESTRUCT_ALPHA 可达', detail[FailureCode.DESTRUCT_ALPHA] || '');
  }
  const uncovered = miss.filter((c) => c !== FailureCode.DESTRUCT_ALPHA);
  rec(uncovered.length === 0 ? 'PASS' : 'WARN', 'V4-c',
    '其余不可达失败码（现有测试覆盖缺口）', uncovered.length ? uncovered.join(', ') : '全部可达');
  console.log('    可达明细：' + JSON.stringify(detail));
  lines.push('    可达明细：' + JSON.stringify(detail));
}

// ══════════════════════════════════════════════════════════════════════════
// V5 · control-manifest 自动化审计
// ══════════════════════════════════════════════════════════════════════════
section('V5 · control-manifest 约束审计（依赖隔离 / 确定性 / 热路径分配）');
{
  const coreDir = join(ROOT, 'src', 'core');
  const files = readdirSync(coreDir).filter((f) => f.endsWith('.js'));
  const src = files.map((f) => ({ f, s: readFileSync(join(coreDir, f), 'utf8') }));

  // B1 / D4：core 不得 import phaser/render/DOM，不得用随机/时钟
  const badImport = src.filter(({ s }) => /from\s+['"](phaser|[^'"]*\/render\/|\.\.\/render)/.test(s)).map((x) => x.f);
  chk('V5-a', 'core 无 phaser / render / DOM 依赖（B1）', badImport.length === 0, badImport.join(',') || 'clean');
  const badSrc = src.filter(({ s }) => /Math\.random|Date\.now|performance\.now|[^_\w]window\.|document\./.test(s)).map((x) => x.f);
  chk('V5-b', 'core 无 Math.random / Date.now / window（D4）', badSrc.length === 0, badSrc.join(',') || 'clean');

  // 热路径分配：结构性证据（每物理步的对象/数组分配）
  const hotAlloc = [];
  for (const { f, s } of src) {
    const body = s;
    if (/update\([^)]*\)\s*\{[^}]*const\s+ev\s*=\s*\[\]/.test(body)) hotAlloc.push(`${f}: update() 每步 const ev=[]`);
    if (/this\._window\.push\(\{/.test(body)) hotAlloc.push(`${f}: _window.push({...}) 每步分配对象`);
  }
  // get()/hudModel() 返回新对象（每帧/每步）
  const newObjReturn = src.filter(({ s }) => /get\(\)\s*\{\s*return\s*\{/.test(s)).map((x) => x.f);
  rec(hotAlloc.length === 0 ? 'PASS' : 'FAIL', 'V5-c',
    '热路径零分配（Z3）：每物理步是否分配数组/对象', hotAlloc.length ? hotAlloc.join(' | ') : 'clean');
  rec(newObjReturn.length === 0 ? 'PASS' : 'WARN', 'V5-d',
    'Z2：hudModel()/get() 是否复用缓冲对象', newObjReturn.length ? `返回新对象：${newObjReturn.join(',')}` : 'clean');

  // 实测堆增长（12000 步 ≈ 100s 仿真）
  if (global.gc) {
    const sim = new Simulation({ skippable: false });
    sim.autoProgram = true; sim.autoStage = true; sim.setInput({ launch: true });
    for (let i = 0; i < 1000; i++) sim.update(DT);   // 预热
    global.gc(); const before = process.memoryUsage().heapUsed;
    let n = 0;
    while (sim.outcome === null && n < 12000) { sim.update(DT); n++; }
    global.gc(); const after = process.memoryUsage().heapUsed;
    const perStep = (after - before) / n;
    rec(perStep < 20 ? 'PASS' : 'WARN', 'V5-e',
      '实测堆增长/步（含 omega._window 每步 push 对象）',
      `${n} 步 · 净增 ${(after - before)} B · ${perStep.toFixed(1)} B/步 ${perStep >= 20 ? '（>20B/步，与"零分配"声明不符）' : ''}`);
  } else {
    rec('WARN', 'V5-e', '未启用 --expose-gc，跳过实测分配', '请用 node --expose-gc 重跑');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// V6 · S7 成功/失败分离度（A7-6）—— 现有套件完全未覆盖
// ══════════════════════════════════════════════════════════════════════════
section('V6 · Ω 成功/失败分离度（S7 A7-6，现有套件未覆盖）');
{
  const grid = [];
  for (const hTurn of [0, 500, 1500, 3000, 6000, 7500, 10500, 20000, 60000, 1e9]) {
    for (const p of [0.2, 0.5, 0.8, 1.2, 2.0]) {
      const sim = new Simulation({ skippable: false });
      const model = new PlayerModel({ hTurn, p, deadbandDeg: 0.6, updateHz: 40, stageAtBurnout: true });
      let g = 0;
      while (sim.outcome === null && g < 24000) { model.update(sim, DT); sim.update(DT); g++; }
      const om = sim.hudModel().omegaPct;
      const orb = sim.outcome === 'SUCCESS' && sim.judge.result !== Judgement.INCOMPLETE;
      grid.push({ hTurn, p, om, orb, code: sim.failure.record ? sim.failure.record.code : 'SUCCESS' });
    }
  }
  const orbMin = Math.min(...grid.filter((g) => g.orb).map((g) => g.om));
  const failMax = Math.max(...grid.filter((g) => !g.orb).map((g) => g.om));
  const overlap = orbMin <= failMax;
  chk('V6-a', '入轨组与未入轨组 Ω 终值不重叠（S7 A7-6）', !overlap,
    `入轨 ${grid.filter((g) => g.orb).length} 组 min=${orbMin.toFixed(1)}% · 失败 ${grid.filter((g) => !g.orb).length} 组 max=${failMax.toFixed(1)}% · 重叠=${overlap}`);
  const worstFail = grid.filter((g) => !g.orb).sort((a, b) => b.om - a.om)[0];
  rec('PASS', 'V6-b', '未入轨组的最高 Ω（潜在"看着满条却没入轨"）',
    worstFail ? `Ω=${worstFail.om.toFixed(1)}% · 码=${worstFail.code} · hTurn=${worstFail.hTurn} p=${worstFail.p}` : 'n/a');
  // 可行入轨窗口宽度（多路径红线：至少 2 条）
  const byTurn = {};
  for (const g of grid) { byTurn[g.hTurn] ??= { orb: 0, n: 0 }; byTurn[g.hTurn].n++; if (g.orb) byTurn[g.hTurn].orb++; }
  const turnSummary = Object.entries(byTurn).map(([k, v]) => `hTurn=${k}: ${v.orb}/${v.n}`).join(' · ');
  rec('PASS', 'V6-c', '可行入轨窗口（玩家通道，防主导策略红线）',
    `入轨 ${grid.filter((g) => g.orb).length}/${grid.length} 组 · 按 hTurn 分布：${turnSummary}`);
  lines.push('    V6 网格：' + grid.map((g) => `${g.hTurn}/${g.p}=${g.orb ? 'OK' : g.code}(${g.om.toFixed(0)}%)`).join(' '));
  console.log('    V6 网格：' + grid.map((g) => `${g.hTurn}/${g.p}=${g.orb ? 'OK' : g.code}(${g.om.toFixed(0)}%)`).join(' '));
}

// ══════════════════════════════════════════════════════════════════════════
// V7 · 关键回归硬指标（不可退化）
// ══════════════════════════════════════════════════════════════════════════
section('V7 · 不可退化硬指标（回归防线）');
{
  const sim = openLoop.sim;
  const o = sim.orbit.get();
  chk('V7-a', '单局时长 ∈ [60,90]s（P3）', sim.fm.t >= 60 && sim.fm.t <= 90, `${sim.fm.t.toFixed(2)}s`);
  chk('V7-b', '近地点 ≥ 13.5km 严格入轨', o.periapsis >= JUDGE.H_PASS && Number.isFinite(o.apoapsis), `${(o.periapsis / 1000).toFixed(2)}km`);
  chk('V7-c', '峰值动压 < 30kPa（结构极限余量）', sim.atmo.qMax < FAIL.Q_STRUCT, `${(sim.atmo.qMax / 1000).toFixed(2)}kPa`);
  chk('V7-d', 'Ω 回退 = 0（生命线）', true, '见 V1-b 独立验证');
  chk('V7-e', 'TWR0 标定值 2.693', Math.abs(ROCKET.TWR0 - 2.693) < 1e-3, ROCKET.TWR0.toFixed(3));
  chk('V7-f', '总 Δv 标定值 2634.9', Math.abs(ROCKET.DV_TOTAL - 2634.9) < 0.5, ROCKET.DV_TOTAL.toFixed(1));

  // 常量一致性：无第三方 magic number 重复定义 300000/15000 等
  const coreDir = join(ROOT, 'src', 'core');
  const dup = [];
  for (const f of readdirSync(coreDir).filter((x) => x.endsWith('.js') && x !== 'constants.js')) {
    const s = readFileSync(join(coreDir, f), 'utf8');
    if (/\b300000\b|\b15000\b/.test(s)) dup.push(f);
  }
  chk('V7-g', 'core 无硬编码 300000/15000（S1 唯一真值源）', dup.length === 0, dup.join(',') || 'clean');

  // 重开门限魔法数重复（simulation.js vs hud.js）
  const simSrc = readFileSync(join(coreDir, 'simulation.js'), 'utf8');
  const hudSrc = readFileSync(join(ROOT, 'src', 'render', 'hud.js'), 'utf8');
  const dup170 = /1\.70/.test(simSrc) && /1\.70/.test(hudSrc);
  rec(dup170 ? 'WARN' : 'PASS', 'V7-h', '重开门限 1.70s 是否被复制到常量表',
    dup170 ? '同一魔法数 1.70 同时硬编码在 core/simulation.js 与 render/hud.js —— 任一处改动会使面板与门控失同步（P3 红线无单一真值源）' : 'ok');
}

// ══════════════════════════════════════════════════════════════════════════
// V8 · V5 中止动词分阶段生效性（核心 MVP 动词，现有套件零覆盖）
// ══════════════════════════════════════════════════════════════════════════
section('V8 · V5 中止（Abort）分阶段生效性');
{
  // (a) 飞行段 —— 中止的最主要使用窗口
  {
    const sim = freshFlying();
    sim.setInput({ abort: true });
    for (let i = 0; i < 60; i++) sim.update(DT);
    const ok = sim.phase === SeqPhase.ABORTED;
    chk('V8-a', '飞行段（FLIGHT）按 ESC 中止生效', ok,
      ok ? `phase=${sim.phase}` : `phase=${sim.phase} outcome=${sim.outcome} · _abortPulse 残留未消费=${sim._abortPulse}`);
  }
  // (b) 松绑段
  {
    const sim = new Simulation({ skippable: false });
    sim.setInput({ launch: true });
    let g = 0;
    while (sim.phase !== SeqPhase.RELEASE && g < 5000) { sim.update(DT); g++; }
    sim.setInput({ abort: true }); sim.update(DT);
    chk('V8-b', '松绑段（RELEASE）按 ESC 中止生效', sim.phase === SeqPhase.ABORTED, `phase=${sim.phase}`);
  }
  // (c) 倒计时段
  {
    const sim = new Simulation({ skippable: false });
    sim.setInput({ launch: true });
    for (let i = 0; i < 200; i++) sim.update(DT);
    sim.setInput({ abort: true }); sim.update(DT);
    chk('V8-c', '倒计时段按 ESC 回 IDLE（不计失败）', sim.phase === SeqPhase.IDLE && !sim.failure.failed, `phase=${sim.phase}`);
  }
  // (d) FailureCode.ABORT 是否可达
  {
    const sim = freshFlying();
    sim.setInput({ abort: true });
    let g = 0;
    while (sim.outcome === null && g < 600) { sim.update(DT); g++; }
    const code = sim.failure.record ? sim.failure.record.code : null;
    chk('V8-d', 'FailureCode.ABORT 可达（P4 中止演出）', code === FailureCode.ABORT, code || '从未失败');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════════════════════════════════════
const summary = { pass: nPass, fail: nFail, warn: nWarn, total: nPass + nFail + nWarn };
lines.push(`\n══════════ 独立验证：${nPass} 通过 / ${nFail} 失败 / ${nWarn} 存疑 ══════════`);
console.log(`\n══════════ 独立验证：${nPass} 通过 / ${nFail} 失败 / ${nWarn} 存疑 ══════════`);
writeFileSync(join(HERE, 'independent-verify.txt'), lines.join('\n') + '\n');
writeFileSync(join(HERE, 'independent-verify.json'), JSON.stringify(summary, null, 2));
process.exitCode = nFail === 0 ? 0 : 1;
