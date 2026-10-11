/* =====================================================================
 * TIDELINE · tests/test-safety-fx.js
 * 硬红线① · 光敏性癫痫安全 —— 等效闪烁频率
 *
 * 运行： node tests/test-safety-fx.js
 *
 * 本文件回答一个问题：**在玩家能制造的最坏情况下，任意 1 秒窗口内，
 * 屏幕级反馈事件会不会超过 2 次？**（项目自我要求 ≤2Hz，严于 WCAG 2.3.1 的 <3Hz）
 *
 * 覆盖：
 *   ① 每帧尝试咬合 30s（隔离档位闪 vs 未隔离，两条都实测）→ 滑窗峰值 ≤ 2
 *   ② ALARM 在 25/50/75/100 阈值附近高频来回 60s → 迟滞必须阻止升/降档抖动
 *   ③ 静态断言：C.MAX_FLASH_HZ ≤ 2
 *   ④ 静态扫描 src：所有 U.breath() 的第二实参 ≤ 2
 *   ⑤ 静态扫描 shader：所有 u_time * K 的时间量化其等效频率 K/2π ≤ 2Hz
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot, reporter, makeFXProbe, slidingPeakHz, SRC } = require('./_harness.js');

const h = boot();
const { G, C, U, TL } = h;
const D = C.FIXED_DT;
const R = reporter('TIDELINE · 光敏安全等效频率（硬红线①）');

/* 若源码此刻缺模块，先如实告知（不计通过/失败，只提示） */
if (h.shimmed.length) {
  R.note('⚠ 源码缺模块：' + h.missingModules.join(' ; ') + ' —— 已垫片，见报告 Blocker');
}

/* =====================================================================
 * ① 每帧尝试咬合 30 秒
 * ===================================================================== */
R.section('① 高频咬合 30s（每帧强制一次成功咬合）');

/* ①a 隔离「咬合闪」通道：把 ALARM 每帧钉回 0，排除档位闪 / 通缉令满闪的干扰。
 *     这样测到的就是「重复捕食反馈」本身的等效频率——正是 0.5s 内部冷却要管的东西。
 * ①b 同样跑一遍但不隔离，用来看「含档位闪」时的合并峰值（仅观测）。 */
function biteStormExact(seconds, isolateAlarm) {
  G.reset();
  const s = G.shark;
  const probe = makeFXProbe(G, C);
  const flashAt = [];
  let bites = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i / 60;
    if (s.alive) {
      /* 钉在浅滩：既避免冲上沙滩（BEACH）致死，也避免落进深海触发 Bank 结算闪
       * ——那样会把「结算闪(CYAN)」混进「咬合闪(MAGENTA)」的窗口里，污染被测通道。 */
      s.x = 1200; s.y = 350; s.state = 'cruise'; s.strandT = 0; s.strandWarn = false;
      const mb = TL.Shark.mouthBox(s);
      const p = TL.Prey.list[0];
      if (p) { p.alive = true; p.x = mb.x; p.y = mb.y; p.type = 'swimmer'; }
      s.carry.length = 0;
      s.dashCd = 0;
      const before = G.stats.grabs;
      G.tryBite(s);
      if (G.stats.grabs > before) bites++;
      /* 顿帧（hitstop）是另一条独立反馈通道，有独立规范；这里清空它，只为让模拟
       * 连续推进（否则每帧 triggerFreeze 叠满 → G.freeze 永不归零 → 逻辑停摆）。
       * 本场景要测的是「色闪/震屏」通道，不是顿帧。 */
      G.freeze = 0;
    }
    if (isolateAlarm) { G.alarm = 0; G.tier = 0; }
    G.update(D);
    const prev = probe.flashEvents;
    probe.frame(G, D);
    if (probe.flashEvents > prev) flashAt.push(t);
    if (G.over) G.reset();
  }
  return { flashAt, bites };
}

let iso = biteStormExact(30, true);
let isoWin = slidingPeakHz(iso.flashAt, 30);
R.note(`隔离咬合通道：30s 内 ${iso.bites} 次成功咬合，触发 ${iso.flashAt.length} 次屏闪`);
R.note(`隔离咬合通道：任意 1s 窗内峰值 = ${isoWin.peak} 次事件（等效 ${isoWin.peak} Hz）`);
R.check('①a 隔离咬合闪 · 任意 1s 窗峰值 ≤ 2', isoWin.peak <= 2, 'peak=' + isoWin.peak);
R.check('①a 咬合确实高频发生（>40 次/30s）', iso.bites > 40, 'bites=' + iso.bites);

let raw = biteStormExact(30, false);
let rawWin = slidingPeakHz(raw.flashAt, 30);
/* 找出超限窗口发生在第几秒，便于定位根因 */
let firstOver = -1;
for (let i = 0; i < raw.flashAt.length; i++) {
  let j = i;
  while (j < raw.flashAt.length && raw.flashAt[j] - raw.flashAt[i] < 1.0) j++;
  if (j - i > 2) { firstOver = raw.flashAt[i]; break; }
}
R.note(`未隔离（含 ALARM 档位闪/通缉令满闪）：30s 内触发 ${raw.flashAt.length} 次屏闪`);
R.note(`未隔离：任意 1s 窗内峰值 = ${rawWin.peak} 次事件，` +
  (firstOver >= 0 ? `首次超限出现在 t≈${firstOver.toFixed(2)}s` : '全程未超限'));
R.note('未隔离峰值来自「每帧 +20 ALARM」这种**不可达**输入（真实咬合受 DASH.CD=1.2s 节流）');
R.check('①b 合并峰值 ≥ 隔离峰值（叠加档位闪只会更多，不变量）',
  rawWin.peak >= isoWin.peak, 'iso=' + isoWin.peak + ' raw=' + rawWin.peak);

/* ---------------------------------------------------------------
 * ①c 【可达的最坏情况】一次「救生员」捕食跨两档 → 档位闪无冷却
 *
 * 救生员 danger=2.0 → ALARM +40，一次捕食可同时跨过两个 UP 阈值（25→50→75）。
 * updateAlarm 每帧只升一档，于是两帧内连出 2 次档位闪，再叠加同帧的咬合闪 = 3 次/1s。
 * 这不是「不可达输入」——救生员在 MVP 里被当作猎物生成（entities.js preyReset i=5/11），
 * 且 ALARM≥40 时在沙滩区就能遇到。
 * --------------------------------------------------------------- */
function reachableGrab(alarmStart, tierStart, preyType) {
  G.reset();
  h.releaseAll();
  const s = G.shark;
  s.x = 1200; s.y = 350;
  G.alarm = alarmStart; G.tier = tierStart;
  const mb = TL.Shark.mouthBox(s);
  const p = TL.Prey.list[0];
  p.alive = true; p.x = mb.x; p.y = mb.y; p.type = preyType;
  G.tryBite(s);                                  // 等价于冲刺子步里的一次命中
  const probe = makeFXProbe(G, C);
  const at = [];
  for (let i = 0; i < 120; i++) {                // 2s
    s.x = 1200; s.y = 350;
    G.update(D);
    const pv = probe.flashEvents;
    probe.frame(G, D);
    if (probe.flashEvents > pv) at.push(+(i / 60).toFixed(3));
  }
  return { flashAt: at, peak: slidingPeakHz(at, 2).peak, tier: G.tier, alarm: G.alarm };
}
const lg = reachableGrab(40, 1, 'lifeguard');
R.note(`救生员捕食（ALARM 40→${lg.alarm.toFixed(0)}，tier 1→${lg.tier}）：屏闪发生在 t=` +
  JSON.stringify(lg.flashAt) + ` → 1s 窗峰值 = ${lg.peak}`);
R.check('①c 可达场景「单次救生员捕食跨两档」1s 窗峰值 ≤ 2（硬红线①）',
  lg.peak <= 2, 'peak=' + lg.peak + '（咬合闪 + 两帧档位闪，档位闪无冷却）');

/* =====================================================================
 * ② ALARM 阈值抖动 60 秒（迟滞）
 * ===================================================================== */
R.section('② ALARM 阈值附近高频来回 60s（迟滞必须生效）');
G.reset();
h.audioLog.length = 0;
const probe2 = makeFXProbe(G, C);
let tierUp = 0, tierDown = 0, maxFlashSeen = 0;
const tierTrace = [];
let pinnedDeath = false;
for (let i = 0; i < 60 * 60; i++) {
  const t = i / 60;
  let target;
  if (t < 15) target = 25 + 1.2 * Math.sin(t * 2 * Math.PI * 1.5);   // 跨 UP[0]=25，DOWN[0]=22 之上
  else if (t < 30) target = 50 + 1.5 * Math.sin(t * 2 * Math.PI * 1.5); // 跨 UP[1]=50，DOWN[1]=46 之上
  else if (t < 45) target = 75 + 1.5 * Math.sin(t * 2 * Math.PI * 1.5); // 跨 UP[2]=75，DOWN[2]=70 之上
  else target = 100 + 2.0 * Math.sin(t * 2 * Math.PI * 1.5);        // 跨 100（通缉令满），跌回 ≥90
  /* 把鲨鱼钉在深海（敌人禁区）：本场景测的是 ALARM 阈值迟滞，必须排除「冲上沙滩
   * 搁浅致死」这类无关死因污染（否则 14s 就会 QTE 失败退出，阈值测试跑不完）。 */
  const s = G.shark;
  s.x = 400; s.y = 500; s.state = 'cruise'; s.strandT = 0; s.strandWarn = false;
  s.dashT = -1; s.stunT = 0; s.snareT = 0; s.alive = true;
  G.alarm = target;
  const b = G.tier;
  G.update(D);
  if (G.over) { pinnedDeath = true; break; }
  if (G.tier !== b) { tierTrace.push({ t: +t.toFixed(2), from: b, to: G.tier }); }
  probe2.frame(G, D);
}
h.audioLog.forEach(n => { if (n === 'tierUp') tierUp++; if (n === 'tierDown') tierDown++; });
maxFlashSeen = probe2.flashEvents;
R.check('② 60s 全程未因无关死因中断（钉深海隔离）', !pinnedDeath);
R.note(`60s 内共 ${3600} 帧；档位变更 ${tierTrace.length} 次：` +
  JSON.stringify(tierTrace));
R.note(`音频通道：tierUp=${tierUp}，tierDown=${tierDown}；屏闪事件=${maxFlashSeen}`);
R.check('② 升档次数 ≤ 3（三段阈值各 1 次，无抖动）', tierUp <= 3, 'tierUp=' + tierUp);
R.check('② 降档次数 = 0（迟滞带内不回落）', tierDown === 0, 'tierDown=' + tierDown);
R.check('② 通缉令满闪只触发 1 次（重新武装锁生效）',
  maxFlashSeen <= 4, 'flashEvents=' + maxFlashSeen);

/* =====================================================================
 * ③ 常量侧
 * ===================================================================== */
R.section('③ 常量与源码静态扫描');
R.check('③ C.MAX_FLASH_HZ ≤ 2', C.MAX_FLASH_HZ <= 2, 'MAX_FLASH_HZ=' + C.MAX_FLASH_HZ);

/* ---- ④ 扫描所有 U.breath(t, f) 的第二实参 ---- */
function listSrcFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listSrcFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const srcFiles = listSrcFiles(SRC, []);
const breathBad = [];
const breathSeen = [];
for (const f of srcFiles) {
  if (f.endsWith(path.join('core', 'util.js'))) continue;   // 定义处，跳过
  const code = fs.readFileSync(f, 'utf8');
  const re = /U\.breath\(\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const argsRaw = m[1];
    const comma = argsRaw.indexOf(',');
    if (comma < 0) continue;
    const arg2 = argsRaw.slice(comma + 1).trim();
    const rel = path.relative(path.join(__dirname, '..'), f);
    breathSeen.push(rel + '  f=' + arg2);
    if (/^\d+(\.\d+)?$/.test(arg2)) {
      if (parseFloat(arg2) > 2 + 1e-9) breathBad.push(rel + ' f=' + arg2);
    } else if (/lockT/.test(arg2)) {
      /* 唯一表达式形态： 1 + lockT，lockT = tLock/TETHER.LOCK ∈ [0,1] → 上界 2 */
      const ok = C.TETHER.LOCK > 0;
      if (!ok) breathBad.push(rel + ' f=' + arg2 + ' (无法界定)');
    } else {
      breathBad.push(rel + ' f=' + arg2 + ' (无法静态判定)');
    }
  }
}
R.note('扫描到的呼吸脉动调用点（f 上界必须 ≤2）：');
breathSeen.forEach(x => R.note('  · ' + x));
R.check('④ 呼吸脉动调用点数 ≥ 5（扫描非空跑）', breathSeen.length >= 5, 'count=' + breathSeen.length);
R.check('④ 全部 U.breath 第二实参 ≤ 2（含 1+lockT 的上界）',
  breathBad.length === 0, breathBad.join(' ; '));

/* ---- ⑤ 扫描 shader 的 u_time 时间量化 ---- */
const TAU = Math.PI * 2;
const shaderBad = [];
const shaderSeen = [];
for (const f of srcFiles) {
  const code = fs.readFileSync(f, 'utf8');
  const re = /u_time\s*\*\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const K = parseFloat(m[1]);
    const hz = K / TAU;
    const rel = path.relative(path.join(__dirname, '..'), f);
    shaderSeen.push(rel + '  u_time*' + K + ' → ' + hz.toFixed(3) + ' Hz');
    if (hz > 2 + 1e-9) shaderBad.push(rel + ' → ' + hz.toFixed(3) + 'Hz');
  }
}
R.note('扫描到的 shader 时间量化：');
shaderSeen.forEach(x => R.note('  · ' + x));
R.check('⑤ shader u_time 量化等效频率 ≤ 2Hz', shaderBad.length === 0, shaderBad.join(' ; '));

process.exit(R.done() === 0 ? 0 : 1);
