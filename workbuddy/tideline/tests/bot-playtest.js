/* =====================================================================
 * TIDELINE · PH6-QA-003 · 策略 bot 量化 playtest（真实代码 · 仅真实输入驱动）
 *
 * 目的：用**真实游戏代码**（无头加载 src/src/*，复用 tests/_harness.js 的
 *   真实 core/input.js）跑策略 bot，把 R1 沙盘里"待 playtest 校准"的
 *   `p_beach` 技巧曲线**实测**出来 —— 因为本项目拿不到真人样本。
 *
 * 铁律：
 *   ① bot 的一切**决策**只通过真实输入接口注入：
 *        方向 = h.keyDown/keyUp('ArrowLeft'...)   （input.js 内部归一化）
 *        冲刺 = h.keyDown(' ')                     （真实 dashFlag + tap）
 *        QTE  = 以真实 performance.now() 时间戳连打空格（≥MIN_INTERVAL）
 *      **任何一帧都不改写 G / shark 的内部状态**（否则测不到真实路径）。
 *   ② 唯一的"白盒"发生在 QTE 频率实验的**夹具**上：为隔离 QTE 机制，
 *      用源码公开的真实入口 `G.enterBeached(s)` 进入搁浅（等价于走到沙滩
 *      触发 `updateStranding`），随后 QTE 全程依然是真实逻辑 + 真实连打。
 *      该夹具在报告里被逐条标注，绝不混入 play 局的统计。
 *
 * 运行：
 *   node tests/bot-playtest.js                 # 200 局 × 3 画像 + QTE 曲线
 *   node tests/bot-playtest.js --games=50 --cap=45
 *   node tests/bot-playtest.js --profile=balanced
 *   node tests/bot-playtest.js --qtetrials=100
 *
 * 产出： tests/_bot-out/summary.json （原始聚合数字，供报告引用）
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./_harness.js');

/* ------------------------------------------------------------------ */
function argNum(name, def) {
  const pre = '--' + name + '=';
  const a = process.argv.find(x => x.startsWith(pre));
  return a ? Number(a.slice(pre.length)) : def;
}
function argStr(name, def) {
  const pre = '--' + name + '=';
  const a = process.argv.find(x => x.startsWith(pre));
  return a ? a.slice(pre.length) : def;
}

const DT = 1 / 60;
const GAMES = argNum('games', 200);
const SEED0 = argNum('seed', 20240601);
const CAP_S = argNum('cap', 60);
const CAP_F = Math.round(CAP_S * 60);
const QTE_TRIALS = argNum('qtetrials', 60);
const ONLY = argStr('profile', '');
const TRACE = argStr('trace', '');          // 打印该画像前 2 局的 0.5s 时间线（调试用）
const MAINONLY = argNum('mainonly', 0);     // 仅跑 3 个主画像（用于量 200×3 的墙钟）
const OUT_NAME = argStr('out', 'summary.json');  // 落盘文件名（便于验收门单独取基线，不动 §2 的 summary.json）
const QTE_RATES = [2, 4, 6, 8];

/* ------------------------------------------------------------------ */
const h = boot({});
const C = h.C, U = h.U, W = h.W, G = h.G, IN = h.IN;

if (h.shimmed.length) {
  console.log('\n⚠ 检测到源码缺口，已注入垫片：' + h.shimmed.join(', ') +
    '\n  本次结果仅在"垫片存在"的前提下有效，报告必须如实标注。\n');
}
if (h.missingModules.length) {
  console.log('⚠ 被引用但未定义的模块：' + h.missingModules.join('; '));
}

/* ---------- 8 向方向盘（屏幕坐标，y 向下；与 input.js 归一化后的 8 向量一致） ---------- */
const SQ = Math.SQRT1_2;
const DIRS = [
  { v: [1, 0], keys: ['ArrowRight'] },
  { v: [SQ, SQ], keys: ['ArrowRight', 'ArrowDown'] },
  { v: [0, 1], keys: ['ArrowDown'] },
  { v: [-SQ, SQ], keys: ['ArrowLeft', 'ArrowDown'] },
  { v: [-1, 0], keys: ['ArrowLeft'] },
  { v: [-SQ, -SQ], keys: ['ArrowLeft', 'ArrowUp'] },
  { v: [0, -1], keys: ['ArrowUp'] },
  { v: [SQ, -SQ], keys: ['ArrowRight', 'ArrowUp'] }
];
const NO_KEYS = [];

function bestDirIdx(dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  let best = 0, bd = -2;
  for (let i = 0; i < 8; i++) {
    const d = DIRS[i].v[0] * ux + DIRS[i].v[1] * uy;
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

const held = new Set();
function keySync(keysArr) {
  held.forEach(k => { if (keysArr.indexOf(k) < 0) h.keyUp(k); });
  for (let i = 0; i < keysArr.length; i++) { const k = keysArr[i]; if (!held.has(k)) h.keyDown(k); }
  held.clear();
  for (let i = 0; i < keysArr.length; i++) held.add(keysArr[i]);
}
function pulseSpace() { h.keyDown(' '); h.keyUp(' '); }

function angTo(sx, sy, tx, ty) { return Math.atan2(ty - sy, tx - sx) * 180 / Math.PI; }
function angDiff(a, b) { let d = (a - b) % 360; if (d > 180) d -= 360; else if (d < -180) d += 360; return d; }

/* ---------- 画像定义 ---------- *
 * 主画像（任务要求 3 种）：
 *   conservative / balanced / aggressive
 * 辅助画像（不入"三画像"，仅用于 C1 冲浪对比 / 搁浅可达性探针）：
 *   surf_balanced（冲浪返程，贴水线收集） / beach_greedy（沙滩贪食，测搁浅是否可达）
 */
const PROFILES = {
  conservative: {
    label: '保守（抓到 1 个即回深海落袋）',
    targetK: 1, alarmCap: 65, filter: 'noBeach', route: 'deep', tetherReflex: true, taps: 6.0
  },
  balanced: {
    label: '平衡（抓到 2 个即回）',
    targetK: 2, alarmCap: 85, filter: 'all', route: 'deep', tetherReflex: true, taps: 6.0
  },
  aggressive: {
    label: '激进（贪到 k=4 或 ALARM≥97 才回）',
    targetK: 4, alarmCap: 97, filter: 'all', route: 'deep', tetherReflex: true, taps: 6.0
  },
  surf_balanced: {
    label: '[辅助] 平衡 + 冲浪返程（贴水线收集，对应 R1「冲浪路线」）',
    targetK: 2, alarmCap: 85, filter: 'all', route: 'surf', tetherReflex: true, taps: 6.0, aux: true
  },
  surf_k1: {
    /* 与 conservative **逐参数相同、仅返程路线不同**（route: deep→surf）：
     * 这是 C1 判据（k=1 · 冲浪/深海 得分速率比值）的干净对照对——
     * C1_code = scoreRate(surf_k1) / scoreRate(conservative)。 */
    label: '[辅助] 保守 k=1 + 冲浪返程（C1 对照对；与 conservative 仅路线不同）',
    targetK: 1, alarmCap: 65, filter: 'noBeach', route: 'surf', tetherReflex: true, taps: 6.0, aux: true
  },
  beach_greedy: {
    label: '[辅助] 沙滩贪食（专攻沙滩猎物·测搁浅是否可达）',
    targetK: 4, alarmCap: 100, filter: 'beachOnly', route: 'deep', tetherReflex: false, taps: 6.0, aux: true
  },
  smart_k2: {
    label: '[辅助] 稳健 k=2（ALARM≤58 就回，避开 tier3 直升机悬崖）',
    targetK: 2, alarmCap: 58, filter: 'noBeach', route: 'deep', tetherReflex: true, taps: 6.0, aux: true
  },
  smart_k3: {
    label: '[辅助] 稳健 k=3（ALARM≤58 就回，试探 R1 C3「最优 k」）',
    targetK: 3, alarmCap: 58, filter: 'noBeach', route: 'deep', tetherReflex: true, taps: 6.0, aux: true
  }
};
const MAIN = ['conservative', 'balanced', 'aggressive'];

function profileHash(name) {
  let s = 0;
  for (let i = 0; i < name.length; i++) s = (s * 31 + name.charCodeAt(i)) >>> 0;
  return s % 1000;
}
function makeFilter(kind) {
  if (kind === 'noBeach') return p => p.x <= 2550;
  if (kind === 'beachOnly') return p => p.x > 2550;
  return null;
}
function nearestPrey(x, y, pred) {
  const list = h.TL.Prey.list;
  let best = null, bd = 1e18;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.alive) continue;
    if (pred && !pred(p)) continue;
    const dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 单画像跑 GAMES 局                                                            */
/* ------------------------------------------------------------------ */
function runProfile(name) {
  const P = PROFILES[name];
  const base = SEED0 + profileHash(name) * 100003;
  const pred = makeFilter(P.filter);

  const A = {
    name, label: P.label, games: 0, died: 0, capped: 0,
    survival: [], banked: [], yieldBL: [], captured: [],
    deaths: { beached: 0, tether: 0, harpoon: 0, other: 0 },
    grabs: 0, banks: 0, pushes: 0, collects: 0,
    lifeguardBites: 0, pendingHist: {},
    strands: 0, surfReturns: 0, surfEnters: 0,
    qteAttempts: 0, qteSuccess: 0, qteFail: 0,
    maxAlarm: [], alarmOver75Frac: [],
    carryFrameSum: 0, frameSum: 0,
    kAtBank: [],
    _kAtDeathReal: [],
    totalBanked: 0, totalSurvival: 0
  };

  for (let gi = 0; gi < GAMES; gi++) {
    h.releaseAll(); held.clear();
    U.srand(base + gi);
    G.reset();

    let vnow = 1000;
    h.setNow(() => vnow);

    let frames = 0, tapAcc = 0;
    let prevBanked = 0, prevQte = false, prevZone = G.shark.zone, inSurfRun = false;
    let prevMode = '';
    let maxAlarm = 0, alarm75 = 0;
    let died = false, cause = 'other', kAtDeath = -1;

    for (frames = 0; frames < CAP_F; frames++) {
      const s = G.shark, q = G.qte;
      const prevK = s.carryK;
      const alarmNow = G.alarm;

      const tetherActive = h.TL.Enemies.tetherCount() > 0;

      /* -------- 决策：模式 -------- */
      let mode;
      if (P.tetherReflex && tetherActive) mode = 'return';   // 「光束连着我」→ 立刻往深海钻（真实对策）
      else if (prevK >= 4) mode = 'return';
      else if (prevK > 0 && prevK >= P.targetK) mode = 'return';
      else if (prevK > 0 && alarmNow >= P.alarmCap) mode = 'return';
      else mode = 'hunt';

      /* -------- 决策：目标点 + 是否冲刺 -------- */
      let keysArr = NO_KEYS;
      let wantDash = false;

      if (q.active) {
        /* QTE：只连打，不转向 */
        keySync(NO_KEYS);
        tapAcc += P.taps * DT;
        while (tapAcc >= 1) { pulseSpace(); tapAcc -= 1; }
      } else {
        let tx, ty;
        let p = null;
        if (mode === 'return') {
          if (P.route === 'surf' && s.x > 1650) {
            tx = 400; ty = W.waterLineY(s.x, G.time) + 6;   // 贴水线（surf 态 → 可收集；对应 R1 冲浪路线）
          } else { tx = 520; ty = 470; }                     // 深海（破系绳 + ALARM 衰减）
        } else {
          p = nearestPrey(s.x, s.y, pred);
          if (p && (s.x <= 2850 || (((p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y)) < 220 * 220))) {
            tx = p.x; ty = p.y;
          } else {
            tx = 1600; ty = 200;                            // 巡逻：穿过泳客带（防卡在 x=3000 沙滩）
          }
        }
        const ddx = tx - s.x, ddy = ty - s.y;
        const ad = Math.abs(angDiff(angTo(s.x, s.y, tx, ty), s.theta));
        if (ddx * ddx + ddy * ddy < 24 * 24 || ad < 6) keysArr = NO_KEYS;   // 死区：基本同向 → 直行（抑制抖舵）
        else keysArr = DIRS[bestDirIdx(ddx, ddy)].keys;
        keySync(keysArr);

        const cost = s.carryK > 0 ? C.DASH_COST_CARRY : C.DASH_COST_EMPTY;
        if (mode === 'hunt' && p) {
          const d = Math.sqrt((p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y));
          const adp = Math.abs(angDiff(angTo(s.x, s.y, p.x, p.y), s.theta));
          if (d < 300 && adp < 38 && s.state === 'cruise' && s.dashT < 0 && s.dashCd <= 0 && s.stamina >= cost) {
            wantDash = true;
          }
        } else if (mode === 'return' && tetherActive) {
          if (s.state === 'cruise' && s.dashT < 0 && s.dashCd <= 0 && s.stamina >= cost) wantDash = true;  // 挣脱系绳
        }
        if (wantDash) pulseSpace();
      }

      /* -------- 时钟推进 + 步进（真实主循环同序：Input.update → Game.update） -------- */
      const psBefore = G.pendingScore;
      vnow += DT * 1000;
      h.step(G, DT);

      /* -------- 观测（只读，不改写） -------- */
      const s2 = G.shark, q2 = G.qte;

      /* 战利品类型取证：一次捕食把猎物基础分原子计入 pending；
       * 只有救生员是 300（日光浴者/泳客同为 100，无法从分值区分）。*/
      const dp = G.pendingScore - psBefore;
      if (dp > 0) {
        if (dp >= 300) A.lifeguardBites++;
        A.pendingHist[dp] = (A.pendingHist[dp] || 0) + 1;
      }

      if (!prevQte && q2.active) { A.strands++; A.qteAttempts++; }
      if (prevQte && !q2.active) {
        if (G.over || !s2.alive) A.qteFail++; else A.qteSuccess++;
      }
      prevQte = q2.active;

      if (G.banked > prevBanked) {
        A.banks++; A.kAtBank.push(prevK === undefined ? 0 : prevK);
        prevBanked = G.banked;
      }

      if (s2.zone !== prevZone) {
        if (s2.zone === C.ZONE.SURF && prevZone !== C.ZONE.SURF) { A.surfEnters++; inSurfRun = true; }
        if (s2.zone === C.ZONE.DEEP && inSurfRun) { A.surfReturns++; inSurfRun = false; }
        prevZone = s2.zone;
      }

      if (mode === 'hunt' && prevMode === 'return') A.pushes++;
      prevMode = mode;

      A.carryFrameSum += s2.carryK; A.frameSum++;
      if (G.alarm > maxAlarm) maxAlarm = G.alarm;
      if (G.alarm >= 75) alarm75++;

      if (TRACE && name === TRACE && gi < 2 && frames % 30 === 0) {
        const t3 = h.TL.Enemies.list.filter(e => e.kind === 'T3B');
        const nb = h.TL.Enemies.list.filter(e => e.kind === 'T2B').length;
        console.log('      t=' + f1(frames * DT) + ' x=' + f1(s2.x) + ' y=' + f1(s2.y) +
          ' k=' + s2.carryK + ' alarm=' + f1(G.alarm) + ' tier=' + G.tier + ' st=' + s2.state +
          ' theta=' + f1(s2.theta) + ' mode=' + mode + ' banked=' + G.banked +
          ' stam=' + f2(s2.stamina) +
          ' | T3B[' + t3.map(e => e.state + ':lock' + f1(e.tLock)).join(',') + '] T2B[' + nb + ']');
      }

      if (G.over) { died = true; cause = G.deathReason || 'other'; kAtDeath = prevK; break; }
    }

    const survivalS = frames * DT;
    const banked = G.banked;
    const lost = G.lostScore;
    const pend = G.pendingScore;
    const yieldBL = banked + lost;
    const captured = banked + lost + pend;

    A.games++;
    if (died) { A.died++; A.deaths[cause] = (A.deaths[cause] || 0) + 1; }
    else A.capped++;
    A.survival.push(survivalS);
    A.banked.push(banked);
    A.yieldBL.push(yieldBL);
    A.captured.push(captured);
    A.grabs += G.stats.grabs;
    A.collects += G.stats.collects;
    A.maxAlarm.push(maxAlarm);
    A.alarmOver75Frac.push(A.frameSum ? alarm75 / frames : 0);
    if (died) A._kAtDeathReal.push(kAtDeath);
    A.totalBanked += banked;
    A.totalSurvival += survivalS;
  }
  return A;
}

/* ------------------------------------------------------------------ */
/* QTE 频率实验（夹具：真实 G.enterBeached 进入搁浅；随后真实连打）             */
/* ------------------------------------------------------------------ */
function qteTrial(rate, jitter, seedBase) {
  let ok = 0;
  for (let i = 0; i < QTE_TRIALS; i++) {
    h.releaseAll(); held.clear();
    U.srand(seedBase + i);
    G.reset();
    const s = G.shark;
    /* —— 夹具：把鲨鱼放到沙滩并走真实搁浅入口（等价于走到沙滩触发 updateStranding）。
      这是本实验唯一一处"白盒"；之后 QTE 全程为真实逻辑 + 真实空格连打时间戳。 */
    s.x = 2700;
    s.y = W.seabedY(2700) - C.SHARK.HALF_H + C.SHARK.SINK;
    G.enterBeached(s);

    let vnow = 1000;
    h.setNow(() => vnow);
    let t = 0, nextTap = 0;
    for (let f = 0; f < 60 * 4 && G.qte.active; f++) {
      if (t >= nextTap) {
        pulseSpace();
        const iv = (1 / rate) * (jitter ? (0.75 + 0.5 * U.rand()) : 1);
        nextTap = t + iv;
      }
      vnow += DT * 1000;
      t += DT;
      h.step(G, DT);
    }
    if (!G.qte.active && G.shark.alive && !G.over) ok++;
  }
  return ok;
}

/* ------------------------------------------------------------------ */
function mean(a) { if (!a.length) return 0; let s = 0; for (const v of a) s += v; return s / a.length; }
function median(a) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function dist(a) { /* 小整数分布 */ const d = {}; for (const v of a) d[v] = (d[v] || 0) + 1; return d; }
function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
function f3(x) { return (Math.round(x * 1000) / 1000).toFixed(3); }

/* ------------------------------------------------------------------ */
console.log('\n=== TIDELINE · PH6-QA-003 策略 bot 量化 playtest ===\n');
console.log('  源码：tests/_harness.js 无头加载真实 src/src/*（真实 core/input.js）');
console.log('  主画像：' + MAIN.join(' / '));
console.log('  辅助画像：' + Object.keys(PROFILES).filter(n => PROFILES[n].aux).join(' / ') +
  '（不入三画像，仅供 C1 冲浪对比 / 搁浅可达性探针）');
console.log('  局数/画像：' + GAMES + '    单局上限：' + CAP_S + 's (' + CAP_F + ' 帧)    seed0=' + SEED0);
console.log('  bot 驱动：仅 keyDown/keyUp(方向) + 空格(冲刺/QTE连打)，零内部状态改写');

const t0 = Date.now();
const results = {};
let names = Object.keys(PROFILES).filter(n => !ONLY || n === ONLY);
if (MAINONLY) names = names.filter(n => MAIN.indexOf(n) >= 0);
const tByName = {};
for (const nm of names) {
  process.stdout.write('\n  · 跑画像 ' + nm + ' … ');
  const ts = Date.now();
  results[nm] = runProfile(nm);
  tByName[nm] = Date.now() - ts;
  console.log('完成（' + results[nm].games + ' 局, ' + tByName[nm] + 'ms）');
}
const tProfile = Date.now() - t0;
console.log('\n  单画像墙钟(ms)：' + names.map(n => n + '=' + tByName[n]).join('  '));

console.log('\n  · 跑 QTE 频率曲线（rates=' + QTE_RATES.join('/') + '/s，每档 ' +
  QTE_TRIALS + ' 次，理想 & 抖动）…');
const qte = { ideal: {}, jitter: {} };
for (const r of QTE_RATES) {
  qte.ideal[r] = qteTrial(r, false, SEED0 + 700000 + r * 131);
  qte.jitter[r] = qteTrial(r, true, SEED0 + 900000 + r * 137);
}
const tTotal = Date.now() - t0;

/* ------------------------------------------------------------------ */
/* 打印                                                              */
/* ------------------------------------------------------------------ */
console.log('\n————————————————————————————————————————');
console.log('  §A · 三画像实测（每局 ' + GAMES + ' 次抽样，单局上限 ' + CAP_S + 's）');
console.log('————————————————————————————————————————');

for (const nm of names) {
  const A = results[nm];
  const sRate = A.totalSurvival > 0 ? A.totalBanked / A.totalSurvival : 0;
  const strandPerRet = A.surfReturns > 0 ? A.strands / A.surfReturns : 0;
  const qteFailRate = A.qteAttempts > 0 ? A.qteFail / A.qteAttempts : 0;
  const avgK = A.frameSum > 0 ? A.carryFrameSum / A.frameSum : 0;

  console.log('\n■ ' + nm + ' —— ' + A.label);
  console.log('  存活时长(s)   均值 ' + f1(mean(A.survival)) + ' / 中位 ' + f1(median(A.survival)) +
    '   （死亡 ' + A.died + ' / 触顶 ' + A.capped + '）');
  console.log('  落袋 banked   均值 ' + f1(mean(A.banked)) + ' / 中位 ' + f1(median(A.banked)));
  console.log('  总产出(banked+lost) 均值 ' + f1(mean(A.yieldBL)) +
    ' ；总捕获(+pending) 均值 ' + f1(mean(A.captured)));
  console.log('  得分速率 = Σbanked/Σ存活 = ' + f2(sRate) + ' 分/s');
  console.log('  死因         ' + JSON.stringify(A.deaths));
  console.log('  捕食 grabs ' + A.grabs + '（均值 ' + f1(A.grabs / A.games) + '/局）' +
    '   落袋 bank ' + A.banks + '（' + f1(A.banks / A.games) + '/局）' +
    '   Push(落袋后再出击) ' + A.pushes + '（' + f1(A.pushes / A.games) + '/局）');
  console.log('  救生员捕食（pending +300）' + A.lifeguardBites + ' 次' +
    '；pending 单帧增量直方图 ' + JSON.stringify(A.pendingHist));
  console.log('  每次落袋均值 ' + f1(A.banks ? A.totalBanked / A.banks : 0) + ' 分' +
    ' ；平均循环时长 ' + f1(A.banks ? A.totalSurvival / A.banks : 0) + ' s/次');
  console.log('  冲浪收集 collects ' + A.collects + '（均值 ' + f1(A.collects / A.games) + '/局）');
  console.log('  搁浅 ' + A.strands + ' 次 / 冲浪返程 ' + A.surfReturns + ' 次 → p_strand ≈ ' +
    f3(strandPerRet) + '（' + f2(strandPerRet * 100) + '%）');
  console.log('  搁浅 QTE：尝试 ' + A.qteAttempts + ' / 成功 ' + A.qteSuccess + ' / 失败 ' + A.qteFail +
    ' → 失败率 ' + f3(qteFailRate));
  console.log('  ALARM 峰值 均值 ' + f1(mean(A.maxAlarm)) +
    ' ；ALARM≥75 时长占比 ' + f2(mean(A.alarmOver75Frac) * 100) + '%');
  console.log('  平均携带 carry_k（帧加权）' + f2(avgK) +
    ' ；落袋时 k 分布 ' + JSON.stringify(dist(A.kAtBank)) +
    ' ；死亡时 k 分布 ' + JSON.stringify(dist(A._kAtDeathReal)));
  console.log('  → 该画像得分速率 ' + f2(sRate) + ' 分/s');
}

/* 画像横向对比（对应 R1 的"最优 k"） */
console.log('\n————————————————————————————————————————');
console.log('  §B · 画像横向对比（哪个押注量得分速率最高 → 对应 R1 的"最优 k"）');
console.log('————————————————————————————————————————');
const rateTable = MAIN.filter(n => names.includes(n)).map(nm => ({
  nm,
  targetK: PROFILES[nm].targetK,
  meanKAtBank: mean(results[nm].kAtBank),
  scoreRate: results[nm].totalSurvival > 0 ? results[nm].totalBanked / results[nm].totalSurvival : 0,
  perRun: mean(results[nm].banked)
}));
for (const r of rateTable) {
  console.log('  ' + r.nm.padEnd(13) + ' 目标k=' + r.targetK +
    ' 实际落袋k均值=' + f2(r.meanKAtBank) +
    ' 得分速率=' + f2(r.scoreRate) + ' 分/s' +
    ' 场均落袋=' + f1(r.perRun));
}
let bestNm = rateTable[0];
for (const r of rateTable) if (r.scoreRate > bestNm.scoreRate) bestNm = r;
console.log('  → 实测最优画像：' + bestNm.nm + '（目标k=' + bestNm.targetK +
  '），得分速率 ' + f2(bestNm.scoreRate) + ' 分/s');

if (names.includes('balanced') && names.includes('surf_balanced')) {
  const b = results['balanced'], sfr = results['surf_balanced'];
  const deepR = b.totalSurvival > 0 ? b.totalBanked / b.totalSurvival : 0;
  const surfR = sfr.totalSurvival > 0 ? sfr.totalBanked / sfr.totalSurvival : 0;
  console.log('\n  C1 探针（同为 k=2，仅返程路线不同）：');
  console.log('    深海返程 balanced      得分速率 ' + f2(deepR) + ' 分/s ；收集 ' + f1(b.collects / b.games) + '/局');
  console.log('    冲浪返程 surf_balanced 得分速率 ' + f2(surfR) + ' 分/s ；收集 ' + f1(sfr.collects / sfr.games) + '/局');
  console.log('    比值(冲浪/深海) = ' + (deepR > 0 ? f2(surfR / deepR) : 'n/a') +
    '   （R1 §2.4 C1 要求 k=1 时 ≥ 1.5）');
}

/* 最优 k 探针：k=1 / k=2 / k=3（均避开 tier3 直升机悬崖） */
const probe = ['conservative', 'smart_k2', 'smart_k3'].filter(n => names.includes(n));
if (probe.length >= 2) {
  console.log('\n————————————————————————————————————————');
  console.log('  §B2 · 「最优押注 k」探针（对应 R1 C3：全局最优 k≥2 是否成立？）');
  console.log('————————————————————————————————————————');
  for (const nm of probe) {
    const A = results[nm];
    const r = A.totalSurvival > 0 ? A.totalBanked / A.totalSurvival : 0;
    console.log('  ' + nm.padEnd(13) + ' targetK=' + PROFILES[nm].targetK +
      ' alarmCap=' + PROFILES[nm].alarmCap +
      '  实际落袋k均值=' + f2(mean(A.kAtBank)) +
      '  死亡=' + A.died + '/' + A.games +
      '  得分速率=' + f2(r) + ' 分/s');
  }
}

/* QTE 曲线 */
console.log('\n————————————————————————————————————————');
console.log('  §C · p_beach 实测曲线 —— 搁浅 QTE 成功率 vs 连打频率');
console.log('————————————————————————————————————————');
console.log('  频率(/s)   理想连打成功    抖动连打成功(±25%)   等效 p_beach(失败率·抖动)');
for (const r of QTE_RATES) {
  const oi = qte.ideal[r] / QTE_TRIALS;
  const oj = qte.jitter[r] / QTE_TRIALS;
  console.log('  ' + String(r).padStart(3) + '        ' +
    (oi * 100).toFixed(0).padStart(3) + '% (' + qte.ideal[r] + '/' + QTE_TRIALS + ')     ' +
    (oj * 100).toFixed(0).padStart(3) + '% (' + qte.jitter[r] + '/' + QTE_TRIALS + ')        ' +
    f3(1 - oj));
}
console.log('  （窗口 ' + C.QTE.WINDOW + 's / 需 ' + C.QTE.NEED + ' 针 / 最小间隔 ' + C.QTE.MIN_INTERVAL +
  's → 理论最低有效频率 = ' + f2(C.QTE.NEED / C.QTE.WINDOW) + ' 次/s）');

/* ------------------------------------------------------------------ */
console.log('\n————————————————————————————————————————');
console.log('  墙钟：画像 ' + tProfile + 'ms + QTE 曲线 → 合计 ' + tTotal + 'ms');
console.log('  （约束：200×3 局 ≤ 2 min）');
console.log('————————————————————————————————————————\n');

/* ---- 落盘原始聚合 ---- */
const out = {
  meta: {
    generatedBy: 'tests/bot-playtest.js',
    games: GAMES, capS: CAP_S, seed0: SEED0, qteTrials: QTE_TRIALS,
    profiles: names, sourceShimmed: h.shimmed, missingModules: h.missingModules,
    profileWallMs: tByName, mainOnly: !!MAINONLY, wallMs: tTotal
  },
  profiles: {}, qte: { rates: QTE_RATES, ideal: {}, jitter: {} }
};
for (const nm of names) {
  const A = results[nm];
  out.profiles[nm] = {
    label: A.label, games: A.games, died: A.died, capped: A.capped,
    survivalMean: mean(A.survival), survivalMedian: median(A.survival),
    bankedMean: mean(A.banked), bankedMedian: median(A.banked),
    bankValueMean: A.banks ? A.totalBanked / A.banks : 0,
    cycleMean: A.banks ? A.totalSurvival / A.banks : 0,
    yieldBLMean: mean(A.yieldBL), capturedMean: mean(A.captured),
    scoreRate: A.totalSurvival > 0 ? A.totalBanked / A.totalSurvival : 0,
    deaths: A.deaths, grabs: A.grabs, banks: A.banks, pushes: A.pushes, collects: A.collects,
    lifeguardBites: A.lifeguardBites, pendingHist: A.pendingHist,
    strands: A.strands, surfReturns: A.surfReturns, surfEnters: A.surfEnters,
    strandPerReturn: A.surfReturns > 0 ? A.strands / A.surfReturns : 0,
    qteAttempts: A.qteAttempts, qteSuccess: A.qteSuccess, qteFail: A.qteFail,
    maxAlarmMean: mean(A.maxAlarm), alarmOver75FracMean: mean(A.alarmOver75Frac),
    carryKMean: A.frameSum > 0 ? A.carryFrameSum / A.frameSum : 0,
    kAtBankDist: dist(A.kAtBank), kAtDeathDist: dist(A._kAtDeathReal)
  };
}
for (const r of QTE_RATES) { out.qte.ideal[r] = qte.ideal[r]; out.qte.jitter[r] = qte.jitter[r]; }
const outDir = path.join(__dirname, '_bot-out');
try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { }
out.meta.outName = OUT_NAME;
fs.writeFileSync(path.join(outDir, OUT_NAME), JSON.stringify(out, null, 2));
console.log('  原始聚合已写入 tests/_bot-out/' + OUT_NAME + '\n');

process.exitCode = 0;
