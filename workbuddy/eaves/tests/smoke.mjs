/**
 * smoke.mjs —— 《檐下》集成冒烟测试（node 纯模块，零 DOM 依赖）
 *
 * 运行：node tests/smoke.mjs
 * 覆盖任务书要求的 8 项：
 *   1. RNG 确定性（同种子同序列）
 *   2. CRC32 已知向量 + 单 bit 翻转可检出
 *   3. 存档双槽（写坏 A 槽能回退 B 槽）
 *   4. 时间 ×12 加速正确 + 单次会话 6 游戏小时上限
 *   5. 三态硬保底（连续 4 次无反应后第 5 次必有反应）
 *   6. 暖机（warmth 低于阈值才缓降 AFF 且不破地板）
 *   7. CatState 推进若干小时无 NaN、状态合法、锚点在 10 个合法值内
 *   8. room.anchors 的 10 个键与 ANCHOR_POS 键一致（DOM 模块跳过，考契约）
 */

import { PCG32, createStreams } from '../src/core/rng.js';
import { crc32, SaveVault, createMemoryStorage } from '../src/core/save.js';
import { GameClock, TIME_SCALE } from '../src/systems/time.js';
import { InteractionSystem, triStateProbabilities, HARD_PITY_STREAK } from '../src/systems/interaction.js';
import { settleOfflineWarmth, affectionFloor, WARMTH } from '../src/systems/warmth.js';
import { CatState, ANCHORS, ANCHOR_POS, ALL_STATES } from '../src/cat/state.js';
import { FixedStepLoop, STEP_SECONDS } from '../src/core/tick.js';

/* ---------------- 轻量测试框架 ---------------- */

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    fail++;
    fails.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

/* ---------------- 1. RNG 确定性 ---------------- */

(function testRng() {
  const a = createStreams(0xC0FFEE);
  const b = createStreams(0xC0FFEE);
  let same = true;
  for (let i = 0; i < 16; i++) {
    if (a.core.nextUint32() !== b.core.nextUint32()) same = false;
    if (a.journal.nextUint32() !== b.journal.nextUint32()) same = false;
  }
  check('RNG 同种子产生相同序列（createStreams）', same);

  const p1 = new PCG32(123456, 0x5bf03635);
  const p2 = new PCG32(123456, 0x5bf03635);
  let same2 = true;
  for (let i = 0; i < 8; i++) if (p1.nextUint32() !== p2.nextUint32()) same2 = false;
  check('RNG PCG32 同 seed/inc 产生相同序列', same2);

  const q1 = new PCG32(1, 2);
  const q2 = new PCG32(3, 4);
  check('RNG 不同种子序列不同', q1.nextUint32() !== q2.nextUint32());
})();

/* ---------------- 2. CRC32 ---------------- */

(function testCrc() {
  const enc = new TextEncoder();
  const known = crc32(enc.encode('123456789'));
  check('CRC32 已知向量 满足 0xCBF43926', known === 0xCBF43926, `实际 0x${known.toString(16)}`);

  // 单 bit 翻转必须被检出
  const buf = enc.encode('the quick brown fox jumps over the lazy dog');
  const base = crc32(buf);
  const flipped = new Uint8Array(buf);
  flipped[10] ^= 0x01; // 翻转第 10 字节最低位
  const flippedCrc = crc32(flipped);
  check('CRC32 单 bit 翻转可检出', base !== flippedCrc);

  // 全零缓冲不抛错且稳定
  const zeros = crc32(new Uint8Array(32));
  check('CRC32 全零缓冲稳定', zeros === crc32(new Uint8Array(32)));
})();

/* ---------------- 3. 存档双槽 ---------------- */

(function testSaveDoubleSlot() {
  const mem = createMemoryStorage();
  const vault = new SaveVault({ storage: mem });
  vault.write({ v: 1, cat: { personality: { aff: 10 } } });
  vault.write({ v: 2, cat: { personality: { aff: 20 } } }); // seq2 → B 槽 + 紧急槽
  vault.corruptSlot('a'); // 写坏 A 槽
  const r = vault.read();
  check('写坏 A 槽后能回退到 B 槽', !!r && r.body && r.body.v === 2, r ? `读到 v=${r.body && r.body.v}` : 'read 返回 null');

  // 紧急槽独立兜底：再写坏 B，仍能从紧急槽读出最新
  vault.corruptSlot('b');
  const r2 = vault.read();
  check('A/B 均坏时回退紧急槽', !!r2 && r2.body && r2.body.v === 2, r2 ? `读到 v=${r2.body && r2.body.v}` : 'read 返回 null');

  // 损坏槽不应静默覆盖好档
  const mem2 = createMemoryStorage();
  const v2 = new SaveVault({ storage: mem2 });
  v2.write({ mark: 'good' });
  v2.corruptSlot('a');
  const r3 = v2.read();
  check('损坏槽不污染好档读取', !!r3 && r3.body && r3.body.mark === 'good');
})();

/* ---------------- 4. 时间 ×12 + 6h 上限 ---------------- */

(function testTime() {
  const c = new GameClock({ gameMinutes: 0, timeScale: TIME_SCALE });
  const before = c.gameMinutes;
  c.advance(60000); // 1 真实秒
  const adv = (c.gameMinutes - before + 1440) % 1440;
  check('时间加速 ×12（1 真实秒 = 12 游戏分钟）', approx(adv, TIME_SCALE, 1e-6), `实际 ${adv} 分钟`);

  // 耗尽加速预算（每次 12 分钟，需 30 次到达 360 上限）
  const c2 = new GameClock({ gameMinutes: 0, timeScale: TIME_SCALE });
  for (let i = 0; i < 40; i++) c2.advance(60000);
  const g0 = c2.gameMinutes;
  c2.advance(60000);
  const adv2 = (c2.gameMinutes - g0 + 1440) % 1440;
  check('单次会话 6 游戏小时上限后回落 ×1（1 真实秒 = 1 游戏分钟）', approx(adv2, 1, 1e-6), `实际 ${adv2} 分钟`);

  // 上限封顶标志
  check('超过 6 游戏小时后 capped=true', c2.capped === true);
})();

/* ---------------- 5. 三态硬保底 ---------------- */

(function testPity() {
  const base = { aff: 50, ind: 50, sec: 50, cur: 50, vit: 50 };
  const at4 = triStateProbabilities({ verb: 'pet', state: 'REST', p: base, streak: HARD_PITY_STREAK });
  check('连续 4 次无反应后第 5 次必有反应（pNone=0）', at4.pNone === 0, `pNone=${at4.pNone}`);
  check('硬保底后仍只有 accept/reject', approx(at4.pAccept + at4.pReject, 1, 1e-9));

  // 低接受度语境（offer / HIDE）下，pNone 较大，可观察 streak=3 仍允许 none
  const lowAcc = { aff: 50, ind: 50, sec: 50, cur: 50, vit: 50 };
  const at3 = triStateProbabilities({ verb: 'offer', state: 'HIDE', p: lowAcc, streak: 3 });
  check('streak=3 时仍可能无反应（pNone>0）', at3.pNone > 0, `pNone=${at3.pNone}`);

  // 互动系统：低接受度语境下，连续 none 4 次后第 5 次必然有反应（fixedRng 恒取 0.99）
  const sys = new InteractionSystem({ now: 0 });
  const fixedRng = { nextFloat: () => 0.99 };
  let lastOutcome = 'none';
  for (let i = 0; i < 5; i++) {
    const res = sys.resolve({ verb: 'offer', state: 'HIDE', personality: lowAcc, rng: fixedRng, nowMs: i * 1000 });
    lastOutcome = res.outcome;
  }
  check('互动系统 4 连 none 后第 5 次非 none', lastOutcome !== 'none', `第5次 outcome=${lastOutcome}`);
})();

/* ---------------- 6. 暖机模型 ---------------- */

(function testWarmth() {
  // warmth 高于阈值（离线后仍未跌破 15）：AFF 本体不衰减
  // 注：warmth 离线 -6/天，days=5 → 100-30=70 > 15，不触发缓降
  const warm = settleOfflineWarmth({ aff: 80, affPeak: 90, warmth: 100 }, 5);
  check('warmth 高时 AFF 不缓降', warm.aff === 80 && warm.decayed === false && warm.warmth >= WARMTH.threshold, `aff=${warm.aff}, warmth=${warm.warmth}`);

  // warmth 低于阈值：AFF 缓降但不破地板
  const floor = affectionFloor(90); // 54
  const cold = settleOfflineWarmth({ aff: 80, affPeak: 90, warmth: 0 }, 30);
  check('warmth 低时 AFF 缓降', cold.decayed === true && cold.aff < 80, `aff=${cold.aff}`);
  check('AFF 不低于历史峰值地板', cold.aff >= floor, `aff=${cold.aff}, floor=${floor}`);
  check('AFF 不低于绝对地板', cold.aff >= WARMTH.affAbsoluteFloor);

  // 极端：极低 AFF 但高 affPeak，应被地板托住
  const extreme = settleOfflineWarmth({ aff: 10, affPeak: 95, warmth: 0 }, 3650);
  const floor2 = affectionFloor(95); // 57
  check('极端长离线 AFF 被地板托住', extreme.aff >= floor2 && extreme.floorHit === true, `aff=${extreme.aff}, floor=${floor2}`);
})();

/* ---------------- 7. CatState 推进无 NaN ---------------- */

(function testCatState() {
  const cat = new CatState({ rng: new PCG32(0xABCDEF, 0x5bf03635), gameMinutes: 8 * 60 });
  const clock = new GameClock({ gameMinutes: 8 * 60, timeScale: TIME_SCALE });
  let bad = false;
  for (let i = 0; i < 1000; i++) {
    clock.advance(STEP_SECONDS * 1000);
    cat.update(STEP_SECONDS, { gameMinutes: clock.gameMinutes, timeScale: TIME_SCALE });
    const p = cat.personality;
    if (![p.aff, p.ind, p.sec, p.cur, p.vit, p.warmth, cat.gameMinutes].every(Number.isFinite)) { bad = true; break; }
  }
  check('CatState 推进 ~6.7 游戏小时无 NaN', !bad);
  check('CatState 状态合法（在 ALL_STATES 内）', ALL_STATES.includes(cat.state), `state=${cat.state}`);
  check('CatState anchorId 在 10 个合法锚点内', ANCHORS.includes(cat.anchorId), `anchorId=${cat.anchorId}`);
  check('CatState gameMinutes 有限且 [0,1440)', Number.isFinite(cat.gameMinutes) && cat.gameMinutes >= 0 && cat.gameMinutes < 1440);
  check('CatState AFF 在 [0,100]', cat.personality.aff >= 0 && cat.personality.aff <= 100);
})();

/* ---------------- 8. 锚点契约 ---------------- */

(function testAnchors() {
  check('ANCHORS 恰为 10 个键', ANCHORS.length === 10, `长度 ${ANCHORS.length}`);
  check('ANCHOR_POS 恰为 10 个键', Object.keys(ANCHOR_POS).length === 10, `长度 ${Object.keys(ANCHOR_POS).length}`);
  const consistent = ANCHORS.every((k) => ANCHOR_POS[k] && typeof ANCHOR_POS[k].x === 'number');
  check('ANCHORS 与 ANCHOR_POS 键一一对应（room.anchors 由此构建）', consistent);
  // 注：room.js 的 buildRoom 直接 import 这两个表构造 anchors，
  //      因 furniture/textures 依赖 DOM/canvas，此处仅验证契约而非执行 buildRoom。
})();

/* ---------------- 汇总 ---------------- */

console.log('');
console.log(`\x1b[1m结果：\x1b[0m ${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('\x1b[31m失败项：\x1b[0m');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('\x1b[32m全部通过\x1b[0m');
  process.exit(0);
}
