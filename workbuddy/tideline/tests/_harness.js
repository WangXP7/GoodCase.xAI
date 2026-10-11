/* =====================================================================
 * TIDELINE · PH6 测试脚手架（QA 共用）
 *
 * 目的：在 Node 里无头加载真实的游戏源码（不是复制品），
 *   ① 用 vm sandbox 伪造最小浏览器环境
 *   ② 加载 **真实的 input.js**（而不是自己写一个 Input 桩）
 *      → 边界输入测试可以真的派发 keydown / keyup / blur 事件
 *   ③ 提供统一的断言 / 统计 / 事件探测工具
 *   ④ 自动探测「源码引用了但未定义的 TL.模块」（源码正在被并行编辑时非常有用），
 *      并对已知的缺失模块注入**带醒目告警的空实现垫片**，让其余系统仍可被测试。
 *      ⚠ 垫片只影响测试能否跑，绝不改变「源码有缺陷」这一事实——测试报告会如实记录。
 *
 * 被 test-safety-fx.js / test-exploit-guard.js / test-soak-stress.js 共用。
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'src');

/* 未在无头环境加载、但源码里合法引用的模块（浏览器里由别的文件提供） */
const EXTERNAL_MODULES = ['Audio', 'HUD', 'Batcher', 'Post', 'glx', 'buildAtlas'];

/* ------------------------------------------------------------------ */
function boot(optsOverride) {
  const listeners = Object.create(null);
  let fillRectCalls = 0;
  const fake2d = {
    imageSmoothingEnabled: false, fillStyle: '#000',
    clearRect() { }, save() { }, restore() { }, beginPath() { }, rect() { }, clip() { },
    translate() { }, fillRect() { fillRectCalls++; }
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
    requestAnimationFrame: () => 0,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const LOAD = [
    'core/constants.js',
    'core/util.js',
    'game/world.js',
    'game/particles.js',
    'game/shark.js',
    'game/entities.js',
    'game/pickups.js',       // 若存在（game.js 依赖 TL.Pickups）——不存在则跳过
    'core/input.js',         // 真实输入模块（用于边界输入测试）
    'game/game.js'
  ];

  const loaded = [];
  function load(rel) {
    const abs = path.join(SRC, rel);
    if (!fs.existsSync(abs)) return false;
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: rel });
    loaded.push(rel);
    return true;
  }
  LOAD.forEach(load);

  const TL = sandbox.TL;

  /* ---- 源码完整性探测：找出「被引用但未定义」的 TL.模块 ---- */
  const missingModules = [];
  const referenced = Object.create(null);
  for (const rel of loaded) {
    const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const re = /TL\.([A-Z][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      if (EXTERNAL_MODULES.indexOf(name) >= 0) continue;
      referenced[name] = rel;
    }
  }
  for (const name in referenced) {
    if (TL[name] === undefined) missingModules.push('TL.' + name + ' (ref in ' + referenced[name] + ')');
  }

  /* ---- 兼容垫片：仅在缺失时注入空实现，且打印醒目告警 ---- */
  const shimmed = [];
  if (TL.Pickups === undefined) {
    TL.Pickups = { reset() { }, update() { }, draw() { }, list: [] };
    shimmed.push('TL.Pickups');
    console.log('\n' +
      '  ⚠⚠⚠ [HARNESS] 源码完整性缺陷：game.js 调用了 TL.Pickups，但没有 pickups.js / 任何定义。' +
      '\n      已注入**空实现垫片**让其余系统可被测试。' +
      '\n      这是 src 的真实缺陷（Blocker），不计入"通过"，详见 PH6-test-report.md。\n');
  }

  /* 可录音的音频桩：用于校验「ALARM 三重编码」里的音效通道 */
  const audioLog = [];
  TL.Audio = {
    init() { }, resume() { }, setMuted() { }, muted: true,
    play(name) { audioLog.push(name); }
  };

  const opts = Object.assign({
    shake: true, flash: true, jitter: true, crt: true, particles: 1,
    colorblind: false, qteAssist: false, mute: true, integerSnap: false, reducedMotion: false
  }, optsOverride || {});

  TL.Game.init(opts);
  TL.FX.setDensity(opts.particles);

  /* ---- 事件派发（打到真实 input.js 上） ---- */
  function fire(type, ev) {
    const ls = listeners[type] || [];
    for (let i = 0; i < ls.length; i++) ls[i](ev);
  }
  function keyDown(key, repeat) {
    fire('keydown', { key: key, repeat: !!repeat, preventDefault() { } });
  }
  function keyUp(key) { fire('keyup', { key: key }); }
  function blur() { fire('blur', {}); }

  /* ---- 一步模拟：与 main.js 的主循环同序 ---- */
  function step(G, dt) {
    TL.Input.update();
    G.update(dt === undefined ? TL.C.FIXED_DT : dt);
  }

  return {
    TL, sandbox, listeners, SRC,
    C: TL.C, U: TL.U, W: TL.World, G: TL.Game, IN: TL.Input, FX: TL.FX,
    opts, audioLog, loaded, missingModules, shimmed,
    keyDown, keyUp, blur, fire, step, load,
    stats: { get fillRectCalls() { return fillRectCalls; } },
    /* 覆盖 performance.now —— 用于需要「≥100ms 间隔的连打时间戳」的 QTE 测试 */
    setNow(fn) { sandbox.performance.now = fn; },
    /* 清掉按下状态的键（避免测试之间互相污染） */
    releaseAll() {
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', ' ', 'Shift'].forEach(keyUp);
      TL.Input.clear();
    }
  };
}

/* ------------------------------------------------------------------ */
/* 断言 / 报告                                                          */
function reporter(title) {
  let pass = 0, fail = 0;
  const failures = [];
  console.log('\n=== ' + title + ' ===\n');
  return {
    section(name) { console.log('\n' + name); },
    note(text) { console.log('  · ' + text); },
    check(name, cond, extra) {
      if (cond) { pass++; console.log('  ✓ ' + name); }
      else {
        fail++; failures.push(name + (extra !== undefined ? ' → ' + extra : ''));
        console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + extra : ''));
      }
    },
    get pass() { return pass; },
    get fail() { return fail; },
    done() {
      console.log('\n———————————————————————');
      console.log(`  通过 ${pass} / 失败 ${fail}`);
      if (fail) { console.log('  失败项：'); failures.forEach(f => console.log('    - ' + f)); }
      console.log('———————————————————————\n');
      process.exitCode = fail === 0 ? 0 : 1;
      return fail;
    }
  };
}

/* ------------------------------------------------------------------ */
/* 反馈事件探测器
 *
 * game.js 的 triggerFlash / triggerShake 是闭包内私有函数，无法直接 hook。
 * 但二者对可观测状态的写入是**确定性的**：
 *   flash : updateFeedback 每帧 flash -= dt*2.2 （下界 0）
 *   shake : updateCamera  每帧 shake *= 0.02^dt（>0.2 时），否则归 0
 * 因此「本帧值 > 按衰减公式推算的期望值」⟺ 该帧发生过一次 trigger。
 * 这个判据是精确的（不是采样近似），唯一漏检情形是连续两次触发且
 * amount 递减 —— 在本作所有 amount 组合下不会发生，已在注释中记录。
 */
function makeFXProbe(G, C) {
  let prevFlash = 0, prevShake = 0;
  return {
    flashEvents: 0, shakeEvents: 0,
    frame(G2, dt) {
      const f = G2.flash;
      const expectFlash = Math.max(0, prevFlash - dt * 2.2);
      if (f > expectFlash + 1e-9) this.flashEvents++;
      prevFlash = f;

      const sh = G2.cam.shake;
      const decay = Math.pow(0.02, dt);
      const expectShake = prevShake > 0.2 ? prevShake * decay : 0;
      if (sh > expectShake + 1e-6) this.shakeEvents++;
      prevShake = sh;
    }
  };
}

/* 滑窗峰值：返回任意 1s 窗内事件数的最大值（等效频率，Hz） */
function slidingPeakHz(eventFrames, totalSec) {
  let peak = 0;
  const n = eventFrames.length;
  for (let i = 0; i < n; i++) {
    let j = i;
    while (j < n && eventFrames[j] - eventFrames[i] < 1.0) j++;
    if (j - i > peak) peak = j - i;
  }
  return { peak: peak, seconds: totalSec };
}

module.exports = { boot, reporter, makeFXProbe, slidingPeakHz, SRC };
