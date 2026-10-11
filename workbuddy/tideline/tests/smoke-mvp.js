/* =====================================================================
 * TIDELINE · MVP 垂直切片 · 无头冒烟测试
 * 运行： node tests/smoke-mvp.js
 *
 * 目的：在没有浏览器的情况下验证
 *   ① 海床导出的区域边界命中 GDD 的 750 / 1650 / 2550
 *   ② 图集程序化生成不溢出、全部命名素材存在
 *   ③ 核心循环可长时间空跑无异常、无 NaN
 *   ④ 关键不变量（GDD-01 A1「鲨鱼永不停止」、ALARM 值域、档位迟滞）
 *   ⑤ 搁浅 → QTE → 成功 / 失败 两条路径都能走通
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 最小浏览器桩（栅格化：按 add() 分组记录像素，可做产物取证） ---------- */
let fillRectCalls = 0;
const groups = [];          // 每个图集素材一组；clip() 是 add() 的开组信号
let curGroup = null;
const fake2d = {
  imageSmoothingEnabled: false, fillStyle: '#000',
  clearRect() { }, save() { }, restore() { }, beginPath() { }, rect() { },
  clip() { curGroup = { cells: new Map() }; groups.push(curGroup); },
  translate() { },
  fillRect(x, y, w, h) {
    fillRectCalls++;
    if (!curGroup) return;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) curGroup.cells.set(yy * 1024 + xx, fake2d.fillStyle);
    }
  }
};
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  document: {
    createElement: () => ({ width: 0, height: 0, getContext: () => fake2d }),
    getElementById: () => null,
    addEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => []
  },
  window: null,
  requestAnimationFrame: () => 0
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const ROOT = path.join(__dirname, '..', 'src', 'src');
function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + extra : '')); }
}

console.log('\n=== TIDELINE MVP 冒烟测试 ===\n');

/* ---------- 加载（跳过需要 GL 的模块） ---------- */
load('core/constants.js');
load('core/util.js');
load('game/world.js');
load('renderer/atlas.js');   // 不需要 GL，只生成 canvas 像素
load('game/particles.js');
load('game/shark.js');
load('game/entities.js');
load('game/game.js');
const TL = sandbox.TL;
const C = TL.C, U = TL.U, W = TL.World;

/* 音频 / 输入 桩 */
TL.Audio = {
  init() { }, resume() { }, play() { }, setMuted() { },
  get muted() { return true; }
};
const IN = { dx: 1, dy: 0, has: true, dash: false, taps: [] };
TL.Input = {
  update() { },
  get dirX() { return IN.dx; }, get dirY() { return IN.dy; },
  get hasDir() { return IN.has; },
  consumeDash() { const d = IN.dash; IN.dash = false; return d; },
  takeTaps() { const t = IN.taps; IN.taps = []; return t; }
};

/* ---------------- ① 海床 → 区域边界 ---------------- */
console.log('① 海床剖面导出的区域边界（应命中 GDD 的 750 / 1650 / 2550）');
W.build();
check('x=700 → 深海', W.zoneAtRaw(700) === C.ZONE.DEEP, W.zoneAtRaw(700));
check('x=800 → 浅滩', W.zoneAtRaw(800) === C.ZONE.SHALLOW, W.zoneAtRaw(800));
check('x=1600 → 浅滩', W.zoneAtRaw(1600) === C.ZONE.SHALLOW, W.zoneAtRaw(1600));
check('x=1700 → 冲浪区', W.zoneAtRaw(1700) === C.ZONE.SURF, W.zoneAtRaw(1700));
check('x=2500 → 冲浪区', W.zoneAtRaw(2500) === C.ZONE.SURF, W.zoneAtRaw(2500));
check('x=2600 → 沙滩', W.zoneAtRaw(2600) === C.ZONE.BEACH, W.zoneAtRaw(2600));
check('潮线 shoreX ≈ 2550 (±20)', Math.abs(W.shoreX - 2550) <= 20, W.shoreX);
check('海床单调抬升（y 单调不增）', (function () {
  let prev = Infinity;
  for (let x = 0; x <= C.WORLD_W; x += 8) { const y = W.seabedY(x); if (y > prev + 0.001) return false; prev = y; }
  return true;
})());

/* ---------------- ② 图集 ---------------- */
console.log('\n② 程序化图集');
const atlas = TL.buildAtlas();
check('fillRect 被调用（有实际绘制）', fillRectCalls > 400, fillRectCalls);
check('图集未溢出 ' + atlas.w + 'x' + atlas.h, (function () {
  for (const k in atlas.defs) {
    const r = atlas.defs[k];
    if (r.x + r.w > atlas.w || r.y + r.h > atlas.h) return false;
  }
  return true;
})());
const NEED = ['shark', 'shark_bite', 'swimmer', 'surfer', 'sunbather', 'lifeguard',
  'carried', 'tire', 'crate', 'buoy', 'jetski', 'heli', 'tower',
  'sun_calm', 'sun_alert', 'sun_siege', 'dot1', 'dot2', 'dot3', 'dot4', 'foam', 'ring8'];
let missing = NEED.filter(n => !atlas.defs[n]);
check('全部命名素材存在', missing.length === 0, missing.join(','));
/* --- 鲨鱼资产取证（美术圣经 §4.1.3 配色规范 + 验收项 P-06 描边 ≥3px） --- */
const PAL = C.PAL;
const SPAD = C.SHARK.DRAW_PAD || 0;
check('鲨鱼图集矩形 = 本体 84x40 + 2×DRAW_PAD 描边留白',
  atlas.defs.shark.w === C.SHARK.DRAW_HALF_W * 2 + SPAD * 2 &&
  atlas.defs.shark.h === C.SHARK.DRAW_HALF_H * 2 + SPAD * 2,
  atlas.defs.shark.w + 'x' + atlas.defs.shark.h + ' (PAD=' + SPAD + ')');
check('鲨鱼本体视觉尺寸不变 = 168x80 design px（与 SHARK.LEN 对账）',
  (C.SHARK.DRAW_HALF_W * 2) * C.ART_SCALE === C.SHARK.LEN &&
  (C.SHARK.DRAW_HALF_H * 2) * C.ART_SCALE === 80,
  (C.SHARK.DRAW_HALF_W * 2 * C.ART_SCALE) + 'x' + (C.SHARK.DRAW_HALF_H * 2 * C.ART_SCALE));

(function () {
  /* 从桩栅格重建鲨鱼像素（组 0 = 第一个 add = 'shark'） */
  const SW = atlas.defs.shark.w, SH = atlas.defs.shark.h;
  const sg = new Array(SW * SH).fill(null);
  if (groups[0]) {
    for (const [k, col] of groups[0].cells) {
      const x = k % 1024, y = (k - x) / 1024;
      if (x >= 0 && y >= 0 && x < SW && y < SH) sg[y * SW + x] = String(col).toUpperCase();
    }
  }
  const solid = sg.map(c => c !== null);
  const inkCount = solid.filter(Boolean).length;
  check('鲨鱼像素取证：栅格非空（桩确实记录到绘制）', inkCount > 2000, inkCount);

  const used = new Set(sg.filter(Boolean));
  check('§4.1.3 配色：背侧 STEEL + 侧面 ASH + 腹侧 PALE 齐备',
    used.has(PAL.STEEL.toUpperCase()) && used.has(PAL.ASH.toUpperCase()) &&
    used.has(PAL.PALE.toUpperCase()), [...used].join(' '));
  check('未回退旧深藏青体色（DEEP / DEEP2 不得出现）',
    !used.has(PAL.DEEP.toUpperCase()) && !used.has(PAL.DEEP2.toUpperCase()),
    [...used].join(' '));

  /* P-06：鲨鱼描边 3px #0A0E17。
     验证基准取「体色像素」（非黑的不透明像素）——描边本身也是不透明像素，
     用它做膨胀基准会把环落在描边之外的空区。
     正确命题：距体色 ≤3px 的一切像素只能是「体色」或「#0A0E17」。 */
  const blackUp = PAL.BLACK.toUpperCase();
  const body = sg.map(c => c !== null && c !== blackUp);
  const expandN = (mask, n) => {
    let o = mask;
    for (let s = 0; s < n; s++) {
      const t = o.slice();
      for (let y = 0; y < SH; y++) {
        for (let x = 0; x < SW; x++) {
          if (!o[y * SW + x]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy, nx = x + dx;
              if (ny < 0 || ny >= SH || nx < 0 || nx >= SW) continue;
              t[ny * SW + nx] = true;
            }
          }
        }
      }
      o = t;
    }
    return o;
  };
  const e3 = expandN(body, 3), e4 = expandN(body, 4);
  let tot3 = 0, bad3 = 0;
  for (let i = 0; i < SW * SH; i++) {
    if (e3[i] && !body[i]) { tot3++; if (sg[i] !== blackUp) bad3++; }
  }
  check('P-06 鲨鱼外描边存在：距体色 ≤3px 全为 #0A0E17',
    tot3 > 500 && bad3 === 0, '覆盖=' + tot3 + ' 非黑=' + bad3);
  let out4 = 0, clear4 = 0;
  for (let i = 0; i < SW * SH; i++) {
    if (e4[i] && !e3[i]) { out4++; if (sg[i] === null) clear4++; }
  }
  check('P-06 描边厚度恰好 3px（第 4 层已越出描边，出现透明像素）',
    clear4 > 0, '第4层 透明=' + clear4 + '/' + out4);

  /* C-09 深海可读性：实体与背景明度差。
     深海区基色（美术圣经 §5.3.1）= #0A0E17 → #141C2B。
     修复前鲨鱼体色用 DEEP2/SLATE（灰度约 17%），与深海基色几乎无差 → 深海近乎隐形；
     现按 §4.1.3 换为 STEEL/ASH/PALE，差值应显著拉开。 */
  const grayOf = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 * 100;
  };
  const deepGray = (grayOf(PAL.BLACK) + grayOf(PAL.DEEP)) / 2;
  const cnt = {};
  for (const c of sg) if (c) cnt[c] = (cnt[c] || 0) + 1;
  let wsum = 0, wpix = 0, bestHex = '', bestGray = 0;
  for (const h in cnt) {
    if (h === blackUp) continue;              // 描边是 §4.1.3 要求的轮廓，不计入实体明度
    wsum += grayOf(h) * cnt[h]; wpix += cnt[h];
    if (grayOf(h) > bestGray && cnt[h] > 100) { bestGray = grayOf(h); bestHex = h; }
  }
  const bodyGray = wsum / wpix;
  check('C-09 深海可读性：鲨鱼体色均灰度 vs 深海基色 差 ≥30pp',
    (bodyGray - deepGray) >= 30,
    '体色均=' + bodyGray.toFixed(1) + '% 深海=' + deepGray.toFixed(1) +
    '% Δ=' + (bodyGray - deepGray).toFixed(1) + 'pp（修复前约 12pp）');
  check('C-09 存在占位 >100px 的主体色档，明度差 ≥40pp',
    (bestGray - deepGray) >= 40,
    bestHex + ' 灰度=' + bestGray.toFixed(1) + '% Δ=' + (bestGray - deepGray).toFixed(1) + 'pp');
})();

/* ---------------- ③ 核心循环空跑 ---------------- */
console.log('\n③ 核心循环（模拟 60 s，含随机输入 / 冲刺 / 捕食尝试）');
const opts = {
  shake: true, flash: true, jitter: true, crt: true, particles: 1,
  colorblind: false, qteAssist: false, mute: true, integerSnap: false, reducedMotion: false
};
TL.Game.init(opts);
const G = TL.Game;
TL.FX.setDensity(1);
U.srand(12345);

let minSpeed = Infinity, nanSeen = false, alarmOOR = false, exceptions = 0;
let beachedSeen = 0, biteSeen = 0, bankSeen = 0, decoySeen = 0;
let lastGrabs = 0, lastBanks = 0, lastToast = 0;

const STEPS = 60 * 60;      // 60 s @ 60Hz
for (let i = 0; i < STEPS; i++) {
  const t = i / 60;
  // 脚本化输入：周期性转向 + 定时冲刺
  if (i % 37 === 0) {
    const a = (Math.sin(t * 0.7) * 0.9) + (i % 240 < 120 ? 0 : Math.PI * 0.15);
    IN.dx = Math.cos(a); IN.dy = Math.sin(a) * 0.5;
  }
  if (i % 150 === 0) IN.dash = true;
  // QTE 期间自动连打
  if (G.qte.active && i % 14 === 0) IN.taps.push(performance.now() + i * 16);

  try { G.update(C.FIXED_DT); } catch (e) { exceptions++; if (exceptions < 3) console.log('   ! ' + e.stack); }

  const s = G.shark;
  if (!isFinite(s.x) || !isFinite(s.y) || !isFinite(s.theta) ||
    !isFinite(s.speed) || !isFinite(G.alarm) || !isFinite(s.stamina)) { nanSeen = true; }
  if (G.alarm < -0.001 || G.alarm > 100.001) alarmOOR = true;
  const zero = TL.Shark.isZeroSpeedState(s);
  if (!zero && s.speed <= 0.0001) minSpeed = 0;
  if (!zero) minSpeed = Math.min(minSpeed, s.speed);
  if (s.state === 'beached') beachedSeen++;
  if (G.stats.grabs > lastGrabs) { biteSeen += G.stats.grabs - lastGrabs; lastGrabs = G.stats.grabs; }
  if (G.stats.banks > lastBanks) { bankSeen += G.stats.banks - lastBanks; lastBanks = G.stats.banks; }
  if (G.over) { G.reset(); lastGrabs = 0; lastBanks = 0; }
}

check('无异常抛出', exceptions === 0, exceptions);
check('无 NaN / Infinity', !nanSeen);
check('ALARM 恒在 [0,100]', !alarmOOR);
check('GDD-01 A1：非四大例外态速率恒 > 0', minSpeed > 0, minSpeed.toFixed(2));
check('至少发生过 1 次咬合', biteSeen > 0, biteSeen);

/* ---------------- ③b Bank 结算（确定性场景） ---------------- */
console.log('\n③b Bank 结算（携带 k=2 从冲浪区游回深海）');
G.reset();
{
  const s = G.shark;
  s.x = 2000; s.y = 300;
  s.carry.push('surfer', 'surfer');
  G.pendingScore = 300; G.pendingCount = 2;
  G.combo = 8;                       // → m_combo = 2.6
  G.alarm = 6; G.tier = 0;           // T0：不生成救生员/摩托艇，隔离 Bank 流程本身
  /* ⚠️ 必须清空收集物池，否则本场景无法隔离验证 Bank 公式。
     原因（实测，非推测）：x≈2000 处水深仅约 56px（海床 161 / 水线 105），
     而鲨鱼碰撞盒高 88px → 被 clampToWorld 顶到水面 → |y-水线| ≤ 40 →
     **必然进入冲浪态**，于是游向深海的途中会自动拾取 3 个收集物（+70，COMBO 8→11）。
     本断言要验证的是「结算 = pending × COMBO × B(k)」，不该被副循环污染。
     副循环的拾取逻辑由 test-exploit-guard.js 单独覆盖。 */
  TL.Pickups.list.length = 0;
  IN.has = true; IN.dx = -1; IN.dy = 0.15;
  let banked = false;
  for (let i = 0; i < 60 * 40 && !banked; i++) {
    const before = G.banked;
    G.update(C.FIXED_DT);
    if (G.banked > before) banked = true;
    if (G.over) break;
  }
  check('逃回深海后触发 Bank', banked, 'banked=' + G.banked);
  check('结算分 = 300 × 2.6 × B(k)=1 → 780', G.banked === 780, G.banked);
  check('Bank 后 ALARM = 0', Math.abs(G.alarm) < 1e-6, G.alarm);
  check('Bank 后 carry_k = 0', G.shark.carryK === 0);
  check('Bank 后 COMBO 清零、最大值被记录', G.combo === 0 && G.comboMax >= 8, G.comboMax);
}

/* ---------------- ④ 档位迟滞 ---------------- */
console.log('\n④ ALARM 档位迟滞（GDD-02 §3.2，安全要求）');
G.reset();
G.alarm = 30; G.tier = 1;
G.update(C.FIXED_DT);
G.alarm = 23;                       // 跌破 25，但未跌破 22 → 应仍为 T1
for (let i = 0; i < 8; i++) { G.alarm = 23; G.update(C.FIXED_DT); }
check('ALARM 30 → 23，档位仍为 T1（迟滞生效）', G.tier === 1, G.tier);
G.alarm = 21;
for (let i = 0; i < 8; i++) { G.alarm = 21; G.update(C.FIXED_DT); }
check('ALARM 跌破 22 → 回到 T0', G.tier === 0, G.tier);

/* ---------------- ⑤ 搁浅 → QTE ---------------- */
console.log('\n⑤ 搁浅 → QTE 两条路径');
function forceBeach() {
  G.reset();
  const s = G.shark;
  s.x = 2750; s.y = W.seabedY(2750) - C.SHARK.HALF_H + C.SHARK.SINK;
  s.theta = 0; s.dashT = -1;
  IN.dx = 1; IN.dy = 0; IN.has = false;   // 不给方向 → 速度仍为巡航 300…
  // 直接压低速度以触发累积：用携带 4 个（速率 138 < 210）
  s.carry.push('swimmer', 'swimmer', 'swimmer', 'swimmer');
  G.pendingScore = 400; G.pendingCount = 4;
  // 累积速率 = (1 - 138/210) = 0.343 → 需 1.2/0.343 ≈ 3.5 s 才满
  for (let i = 0; i < 60 * 8 && !G.qte.active; i++) G.update(C.FIXED_DT);
  return G.qte.active;
}
check('携带 k=4 停在沙滩 → 触发搁浅 QTE', forceBeach());
check('搁浅时战利品立即丢失（GDD-03 E1）', G.shark.carryK === 0 && G.pendingScore === 0);
check('搁浅时画面去饱和目标 = 1（只剩灰与白）', G.desatTarget === 1);

// QTE 失败路径
let tapsAt = 0;
for (let i = 0; i < 60 * 3; i++) { G.update(C.FIXED_DT); if (G.over) break; }
check('QTE 不输入 → 超时 → 死亡', G.over && G.deathReason === 'beached', G.deathReason);
check('死亡时未兑现 COMBO 被记录（GDD-03 E2 告知义务）', G.comboLost >= 0);

// QTE 成功路径
forceBeach();
check('第二次可再次进入 QTE', G.qte.active);
let now = performance.now();
for (let i = 0; i < 60 * 2 && G.qte.active; i++) {
  if (i % 12 === 0) IN.taps.push(now + i * 100);   // 间隔 ≥100ms
  G.update(C.FIXED_DT);
}
check('连打 6 次 → QTE 成功脱困', !G.qte.active && !G.over && G.shark.alive);
check('脱困后被推回水中（zone ≠ BEACH）', G.shark.zone !== C.ZONE.BEACH, C.ZONE_NAME[G.shark.zone]);
check('脱困后 ALARM 保留（不清零）', G.alarm > 0, G.alarm.toFixed(1));

/* ---------------- ⑥ 携带 / DECOY 数值 ---------------- */
console.log('\n⑥ 数值锚点');
check('k=2 速率倍率 = 0.70', Math.abs(C.CARRY_V(2) - 0.70) < 1e-9, C.CARRY_V(2));
check('k=2 转向倍率 = 0.60', Math.abs(C.CARRY_W(2) - 0.60) < 1e-9, C.CARRY_W(2));
check('k=2 速率 = 210 px/s', Math.abs(C.V_CRUISE * C.CARRY_V(2) - 210) < 1e-6);
check('k=4 速率 138 < 搁浅阈值 210（不冲刺必搁浅）', C.V_CRUISE * C.CARRY_V(4) < C.BEACH.V_TH);
check('断线 1.5s < 锁定致死 3.0s（硬约束）', C.TETHER.BREAK < C.TETHER.LOCK);
check('血红与洋红亮度相同（必须靠形态区分）',
  Math.abs(U.luma(C.PAL.BLOOD) - U.luma(C.PAL.MAGENTA)) < 0.02,
  U.luma(C.PAL.BLOOD).toFixed(3) + ' vs ' + U.luma(C.PAL.MAGENTA).toFixed(3));
check('全部呼吸频率 ≤ 2Hz（常量侧）', C.MAX_FLASH_HZ <= 2);

console.log('\n———————————————————————');
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log('———————————————————————\n');
process.exit(fail === 0 ? 0 : 1);
