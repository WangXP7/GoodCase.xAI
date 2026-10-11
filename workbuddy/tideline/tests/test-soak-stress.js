/* =====================================================================
 * TIDELINE · tests/test-soak-stress.js
 * 长时运行 + 边界输入
 *
 * 运行： node tests/test-soak-stress.js
 *
 * 覆盖：
 *   ① 10 分钟（36000 帧 @1/60）随机输入长跑
 *        · 无 NaN / Infinity（遍历 G 与鲨鱼的全部数值字段）
 *        · 粒子池不超上限（TL.FX.count ≤ 520）
 *        · ALARM 恒在 [0,100]
 *        · 无异常抛出
 *   ② 内存 / 泄漏：逐分钟记录粒子池峰值，断言不单调增长到饱和
 *   ③ 边界输入：斜向归一化 / 全方向同按 / 方向+空格同帧 / 连打空格 / 失焦归零
 *   ④ 失焦后不残留待消费的 冲刺/暂停/静音/确认 标志（含「不模糊时确实置位」的对照）
 * ===================================================================== */
'use strict';
const { boot, reporter } = require('./_harness.js');

const h = boot();
const { G, C, U, TL, IN } = h;
const D = C.FIXED_DT;
const R = reporter('TIDELINE · 长时运行与边界输入');

if (h.shimmed.length) {
  R.note('⚠ 源码缺模块：' + h.missingModules.join(' ; ') + ' —— 已垫片，见报告 Blocker');
}

/* 独立可复现 RNG（不与游戏内部 U.rand 抢种子，保证本测试可重放） */
let rngState = 0x1234abcd;
function rng() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}

const G_FIELDS = ['time', 'alarm', 'banked', 'combo', 'comboMax', 'comboLost',
  'pendingScore', 'pendingCount', 'lostScore', 'lostCount', 'bankT',
  'freeze', 'desat', 'desatTarget', 'flash', 'qte.t', 'qte.count', 'qte.lastTap',
  'cam.x', 'cam.y', 'cam.shake'];
const SHARK_FIELDS = ['x', 'y', 'theta', 'speed', 'stamina', 'dashT', 'dashCd',
  'biteT', 'stunT', 'snareT', 'slowT', 'iframeT', 'shakeCd', 'strandT', 'trailAcc'];
function getDeep(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

function firstNaN() {
  for (const f of G_FIELDS) {
    const v = getDeep(G, f);
    if (typeof v === 'number' && !isFinite(v)) return 'G.' + f + '=' + v;
  }
  const s = G.shark;
  if (s) for (const f of SHARK_FIELDS) {
    const v = s[f];
    if (typeof v === 'number' && !isFinite(v)) return 'shark.' + f + '=' + v;
  }
  if (!isFinite(G.alarm)) return 'alarm';
  return null;
}

/* =====================================================================
 * ① + ② 10 分钟随机输入长跑
 * ===================================================================== */
R.section('① 10 分钟随机输入长跑（36000 帧 @1/60）');
G.reset();
h.releaseAll();
U.srand(20260910);

const DIRS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const MINUTES = 10;
const FRAMES = MINUTES * 60 * 60;
let exceptions = 0, firstExc = '';
let nanHit = null;
let fxOver = 0, maxFx = 0;
let alarmOOR = 0;
let deaths = 0, banks = 0, grabs = 0;
let prevBanks = 0, prevGrabs = 0;
const perMinutePeak = new Array(MINUTES).fill(0);
let minuteIdx = 0;

const t0 = Date.now();
for (let i = 0; i < FRAMES; i++) {
  minuteIdx = Math.min(MINUTES - 1, Math.floor(i / (60 * 60)));

  /* 随机方向：每 11 帧换一次；偶发「全方向同按」 */
  if (i % 11 === 0) {
    DIRS.forEach(k => h.keyUp(k));
    if (rng() < 0.03) { DIRS.forEach(k => h.keyDown(k)); }
    else {
      const n = 1 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) h.keyDown(DIRS[Math.floor(rng() * 4)]);
    }
  }
  /* 随机冲刺 */
  if (rng() < 0.02) h.keyDown(' ');
  /* QTE 期间自动连打，避免一律 QTE 失败（仍然允许失败路径偶尔发生） */
  if (G.qte.active && i % 10 === 0) h.keyDown(' ');

  try {
    h.step(G);
  } catch (e) {
    exceptions++; if (!firstExc) firstExc = (e && e.stack) || String(e);
  }

  if (!nanHit) nanHit = firstNaN();
  const fx = TL.FX.count;
  if (fx > maxFx) maxFx = fx;
  if (fx > perMinutePeak[minuteIdx]) perMinutePeak[minuteIdx] = fx;
  if (fx > 520) fxOver++;
  if (G.alarm < -1e-6 || G.alarm > 100 + 1e-6) alarmOOR++;

  if (G.stats.banks > prevBanks) { banks += G.stats.banks - prevBanks; prevBanks = G.stats.banks; }
  if (G.stats.grabs > prevGrabs) { grabs += G.stats.grabs - prevGrabs; prevGrabs = G.stats.grabs; }
  if (G.over) { deaths++; G.reset(); prevBanks = 0; prevGrabs = 0; h.releaseAll(); }
}
const wall = Date.now() - t0;

R.check('① 无异常抛出', exceptions === 0, exceptions ? firstExc : '');
R.check('① 无 NaN / Infinity（G + 鲨鱼全数值字段）', nanHit === null, nanHit || '');
R.check('① 粒子池从未超过上限 520', fxOver === 0, 'over=' + fxOver);
R.check('① ALARM 恒在 [0,100]', alarmOOR === 0, 'oob=' + alarmOOR);
R.note(`长跑统计：${FRAMES} 帧 / 墙钟 ${wall}ms；死亡 ${deaths} 次，落袋 ${banks} 次，捕食 ${grabs} 次`);

R.section('② 泄漏检查：逐分钟粒子池峰值');
R.note('每分钟峰值 = ' + perMinutePeak.join(', '));
const everSaturated = perMinutePeak.some(v => v >= 520);
R.check('② 任意分钟的粒子池峰值 < 520（从未打满）', !everSaturated, 'max=' + maxFx);
R.check('② 第 10 分钟峰值未比第 1 分钟翻倍以上（非单调增长到饱和）',
  perMinutePeak[MINUTES - 1] <= Math.max(20, perMinutePeak[0]) * 2,
  'm1=' + perMinutePeak[0] + ' m10=' + perMinutePeak[MINUTES - 1]);

/* =====================================================================
 * ③ 边界输入
 * ===================================================================== */
R.section('③ 边界输入');

/* 3a 斜向归一化 */
h.releaseAll();
h.keyDown('ArrowRight'); h.keyDown('ArrowDown');
IN.update();
let mag = Math.hypot(IN.dirX, IN.dirY);
R.note(`斜向（右+下）：dirX=${IN.dirX.toFixed(4)} dirY=${IN.dirY.toFixed(4)} |v|=${mag.toFixed(4)}`);
R.check('③a 斜向输入被归一化，模长 ≈ 1', Math.abs(mag - 1) < 1e-6, 'mag=' + mag);
R.check('③a 分量为 1/√2',
  Math.abs(IN.dirX - Math.SQRT1_2) < 1e-6 && Math.abs(IN.dirY - Math.SQRT1_2) < 1e-6);

/* 3b 全方向同按（左右相消、上下相消） */
h.releaseAll();
DIRS.forEach(k => h.keyDown(k));
IN.update();
mag = Math.hypot(IN.dirX, IN.dirY);
R.note(`全方向同按（↑↓←→）：|v|=${mag.toFixed(4)}（左右/上下两两相消 → 0）`);
R.check('③b 全方向同按：不产生 NaN，模长 ≤ 1', isFinite(mag) && mag <= 1 + 1e-9, 'mag=' + mag);
h.releaseAll();
h.keyDown('ArrowLeft'); h.keyDown('ArrowRight');
IN.update();
R.check('③b 仅左右同按：方向归零（相消）',
  IN.dirX === 0 && IN.dirY === 0, IN.dirX + ',' + IN.dirY);

/* 3c 方向 + 空格 同帧 */
h.releaseAll();
G.reset();
h.keyDown('ArrowUp'); h.keyDown(' ');
IN.update();
const dY = IN.dirY;
try { G.update(D); } catch (e) { R.check('③c 方向+空格同帧不崩溃', false, String(e)); }
R.check('③c 方向+空格同帧：方向生效', Math.abs(dY + 1) < 1e-9, 'dirY=' + dY);
R.check('③c 方向+空格同帧：冲刺被消费（dashPressed=true）', G.dashPressed === true);

/* 3d 连打空格 50 次 */
h.releaseAll();
G.reset();
const s = G.shark;
let dashStarts = 0, wasDash = false;
for (let i = 0; i < 50; i++) h.keyDown(' ');
const stamBefore = s.stamina;
for (let i = 0; i < 40; i++) {
  h.step(G);
  const isDash = s.state === 'dash';
  if (isDash && !wasDash) dashStarts++;
  wasDash = isDash;
}
R.note(`连打空格 50 次后跑 40 帧：冲刺启动 ${dashStarts} 次，体力 ${stamBefore} → ${s.stamina.toFixed(3)}`);
R.check('③d 连打 50 次不崩溃（40 帧无异常）', true);
R.check('③d 一次连打只启动 1 次冲刺（dashCd 生效，不连发）', dashStarts === 1, 'dashStarts=' + dashStarts);
R.check('③d 体力只被扣 1 格（3 → ~2，未被连打抽干）',
  s.stamina > 1.9 && s.stamina < 2.6, 'stamina=' + s.stamina.toFixed(3));

/* 3e 失焦 → 方向归零 */
h.releaseAll();
h.keyDown('ArrowUp'); h.keyDown('ArrowLeft');
IN.update();
const preMag = Math.hypot(IN.dirX, IN.dirY);
h.blur();
IN.update();
R.note(`失焦前 |v|=${preMag.toFixed(4)} → 失焦后 |v|=${Math.hypot(IN.dirX, IN.dirY).toFixed(4)}`);
R.check('③e 失焦前方向非零（前提成立）', preMag > 0.9);
R.check('③e 失焦后方向归零', IN.dirX === 0 && IN.dirY === 0, IN.dirX + ',' + IN.dirY);

/* =====================================================================
 * ④ 失焦不残留一次性标志
 * ===================================================================== */
R.section('④ 失焦后不残留待消费标志（回归护栏）');

/* 先做「不模糊」的对照：证明断言能识别残留（不是空跑） */
h.releaseAll();
h.keyDown(' ');
const ctrlDash = IN.consumeDash();
R.check('④ 对照组：不模糊时空格确实置位 dash（断言非空跑）', ctrlDash === true);

function residueProbe(key, consume) {
  h.releaseAll();
  IN.consumeDash(); IN.consumePause(); IN.consumeMute(); IN.consumeConfirm(); IN.takeTaps();
  h.keyDown(key);
  h.blur();
  return consume();
}
R.check('④ 失焦后 dash 标志被清除',
  residueProbe(' ', () => IN.consumeDash()) === false);
R.check('④ 失焦后 pause 标志被清除',
  residueProbe('Escape', () => IN.consumePause()) === false);
R.check('④ 失焦后 mute 标志被清除',
  residueProbe('m', () => IN.consumeMute()) === false);
R.check('④ 失焦后 confirm 标志被清除',
  residueProbe('Enter', () => IN.consumeConfirm()) === false);
h.releaseAll();
h.keyDown(' ');
h.blur();
R.check('④ 失焦后 taps 队列被清空（QTE 不会凭空计数）',
  IN.takeTaps().length === 0);

h.releaseAll();
process.exit(R.done() === 0 ? 0 : 1);
