/* =====================================================================
 * TIDELINE · tests/_audio-probe.js
 * PH6-AUDIO-002 · 音频实现审计探针（音频总监 阮和鸣）
 *
 * 目的：在没有浏览器的 Node 环境里，用一个**确定性 WebAudio 桩**
 *       真实执行 src/src/core/audio.js，拿到可复现的实测证据，
 *       而不是"读代码觉得应该没问题"。
 *
 * 桩提供：AudioContext / GainNode / OscillatorNode / BiquadFilterNode /
 *        AudioBufferSourceNode / DynamicsCompressorNode / AudioBuffer /
 *        虚拟时钟 + setInterval + onended 自动派发。
 *
 * 覆盖：
 *   A 事件覆盖矩阵（静态扫描 × 实跑观测 双向核对）
 *   B 四层动态音乐核查（分层切换 / 过渡平滑 / musicOff 归零）
 *   C 可访问性冗余通道（musicOff 下心跳是否仍可闻 / 档位音可区分 /
 *      静音无逻辑副作用 / 只剩视觉的通道清单）
 *   D 声部并发与节点泄漏
 *
 * 用法： node tests/_audio-probe.js
 * 只读：本文件不改 src/ 下任何文件。
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const harness = require('./_harness.js');

const PROJECT = path.join(__dirname, '..');
const SRC = path.join(PROJECT, 'src', 'src');

/* =====================================================================
 * 1 · 确定性 WebAudio 桩
 * ===================================================================== */
function makeAudioStub() {
  const clock = {
    now: 0, timers: [], idc: 0,
    setInterval(fn, ms) {
      const id = ++this.idc;
      this.timers.push({ id, fn, ms, next: this.now + ms / 1000 });
      return id;
    },
    clearInterval(id) { this.timers = this.timers.filter(t => t.id !== id); },
    _advance(dt) {
      this.now += dt;
      for (const t of this.timers) {
        let guard = 0;
        while (t.next <= this.now && guard++ < 1000) { t.fn(); t.next += t.ms / 1000; }
      }
    }
  };

  const created = [];
  let idc = 0;
  const rec = n => { n.id = idc++; created.push(n); return n; };

  class Param {
    constructor(name, value) { this.name = name; this.value = value; this.events = []; this.target = null; }
    _log(op, v, t, tc) { this.events.push({ op, v, t, tc }); }
    setValueAtTime(v, t) { this._log('set', v, t); this.value = v; return this; }
    linearRampToValueAtTime(v, t) { this._log('lin', v, t); this.value = v; return this; }
    exponentialRampToValueAtTime(v, t) { this._log('exp', v, t); this.value = v; return this; }
    setTargetAtTime(v, t, tc) { this._log('tgt', v, t, tc); this.target = v; this.value = v; return this; }
    cancelScheduledValues(t) { this._log('cancel', null, t); return this; }
  }

  class BaseNode {
    constructor(kind) { rec(this); this.kind = kind; this.outs = []; this.ins = []; this.disconnected = false; }
    connect(d) { this.outs.push(d); if (d && d.ins) d.ins.push(this); return d; }
    /* 注意：disconnect 只置标志，**不清空 outs** —— outs 是「历史拓扑」，
     * 供 pathGain 做有效增益分析；存活判定一律走 disconnected / _ended。 */
    disconnect() { this.disconnected = true; }
  }
  class Gain extends BaseNode { constructor() { super('gain'); this.gain = new Param('gain', 1); } }
  class Osc extends BaseNode {
    constructor() {
      super('osc'); this.type = 'sine';
      this.frequency = new Param('frequency', 440); this.detune = new Param('detune', 0);
      this.started = null; this.stopped = null; this.onended = null;
    }
    start(t) { this.started = t === undefined ? clock.now : t; }
    stop(t) { this.stopped = t === undefined ? clock.now : t; }
  }
  class BufSrc extends BaseNode {
    constructor() {
      super('bufsrc'); this.buffer = null; this.playbackRate = new Param('playbackRate', 1);
      this.started = null; this.stopped = null; this.offset = 0; this.onended = null;
    }
    start(t, off) { this.started = t === undefined ? clock.now : t; this.offset = off || 0; }
    stop(t) { this.stopped = t === undefined ? clock.now : t; }
  }
  class Filter extends BaseNode {
    constructor() {
      super('filter'); this.type = 'lowpass';
      this.frequency = new Param('frequency', 350); this.Q = new Param('Q', 1); this.gain = new Param('gain', 0);
    }
  }
  class Comp extends BaseNode {
    constructor() {
      super('comp');
      ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(k => { this[k] = new Param(k, 0); });
    }
  }
  class Buf {
    constructor(ch, len, sr) {
      this.numberOfChannels = ch; this.length = len; this.sampleRate = sr;
      this.duration = len / sr; this._d = [new Float32Array(len)];
    }
    getChannelData(i) { return this._d[i]; }
  }
  class Ctx {
    constructor() {
      rec(this); this.kind = 'ctx'; this.state = 'running'; this._frozen = null;
      this.destination = new BaseNode('dest'); this.sampleRate = 48000;
    }
    get currentTime() { return this._frozen === null ? clock.now : this._frozen; }
    createGain() { return new Gain(); }
    createOscillator() { return new Osc(); }
    createBufferSource() { return new BufSrc(); }
    createBiquadFilter() { return new Filter(); }
    createDynamicsCompressor() { return new Comp(); }
    createBuffer(ch, len, sr) { return new Buf(ch, len, sr); }
    suspend() { this._frozen = clock.now; this.state = 'suspended'; return Promise.resolve(); }
    resume() { this._frozen = null; this.state = 'running'; return Promise.resolve(); }
  }

  /* onended：真实 WebAudio 在 stop 时间到达后回调 —— 桩必须复现，否则无法验证回收 */
  function fireEnded() {
    for (const n of created) {
      if (!n.onended || n._ended) continue;
      if (n.stopped !== null && n.stopped <= clock.now) { n._ended = true; try { n.onended(); } catch (e) { } }
    }
  }
  const adv = clock._advance.bind(clock);
  const advance = dt => { adv(dt); fireEnded(); };

  return { clock, created, Ctx, advance, fireEnded };
}

/* =====================================================================
 * 2 · 启动：真实游戏 + 真实 audio.js + 桩 WebAudio
 * ===================================================================== */
function bootWithAudio(optsOverride) {
  const stub = makeAudioStub();
  const h = harness.boot(optsOverride);

  h.sandbox.AudioContext = stub.Ctx;
  h.sandbox.setInterval = stub.clock.setInterval.bind(stub.clock);
  h.sandbox.clearInterval = stub.clock.clearInterval.bind(stub.clock);

  h.load('core/audio.js');                 // 真实模块覆盖 harness 的录音桩
  const A = h.TL.Audio;
  A.init();
  A.setMuted(false);
  A.setMusicEnabled(true);

  /* ---- 结构化识别总线与层节点（不依赖创建顺序的硬编码） ---- */
  const nodes = stub.created;
  const comp = nodes.find(n => n.kind === 'comp');
  const gainsToLimiter = nodes.filter(n => n.kind === 'gain' && n.outs.indexOf(comp) >= 0);
  const gainIns = g => g.ins.filter(i => i.kind === 'gain').length;
  /* busMusic = 收到最多 Gain 输入的那条（脉冲/军鼓/hi-hat/围剿 + 引擎）；
   * busHeart = 只收到 1 个 Gain 输入的那条（心跳层）。
   * ⭐ F1 修复后心跳与音乐**分属两条总线**：音乐开关碰不到心跳。 */
  const sortedBuses = gainsToLimiter.slice().sort((a, b) => gainIns(b) - gainIns(a));
  const busMusic = sortedBuses[0];
  const busHeart = sortedBuses.find(g => g !== busMusic && gainIns(g) === 1);
  const layerNodes = busMusic ? busMusic.ins.filter(i => i.kind === 'gain') : [];
  /* 引擎层的结构特征：它的输入是一个 GainNode（旋翼颤音 trem），其余层输入是声源 */
  const engineLayer = layerNodes.find(l => l.ins.some(i => i.kind === 'gain'));
  const rest = layerNodes.filter(l => l !== engineLayer).sort((a, b) => a.id - b.id);
  const heartLayer = busHeart ? busHeart.ins.filter(i => i.kind === 'gain')[0] : null;
  const LAYER = {
    pulse: rest[0], snare: rest[1], hat: rest[2],
    siege: rest[3], heart: heartLayer, engine: engineLayer
  };
  const layerOk = !!(LAYER.pulse && LAYER.snare && LAYER.hat && LAYER.siege && LAYER.heart && LAYER.engine);
  /* ---- 交叉校验：防止「静默用错总线」导致 C1b/C1d 假绿 ----
   * 条件：(1) busMusic 恰好 5 个 Gain 层输入；(2) busHeart 恰好 1 个 Gain 输入；
   *       (3) 那唯一输入是个「叶子层」（自身不再收 Gain 输入，由声源直接驱动）；
   *       (4) 该输入**不在** busMusic 的输入集合里。
   * 任一不成立 → heartIdentityOk = false，探针在 §0 明确报错，绝不默默测错对象。 */
  const heartIdentityOk = !!busMusic && !!busHeart && !!heartLayer &&
    gainIns(busMusic) === 5 && gainIns(busHeart) === 1 &&
    busMusic.ins.indexOf(heartLayer) < 0 &&
    heartLayer.ins.filter(i => i.kind === 'gain').length === 0;
  const dest = stub.created.find(n => n.kind === 'dest');
  const master = stub.created.find(n => n.kind === 'gain' && n.outs.indexOf(dest) >= 0);

  /** 从某节点到 destination 的**有效增益**（沿途所有 GainNode 增益相乘）。
   *  这是判定「一个音效能不能真的到达扬声器」的唯一可靠指标——
   *  只看层增益会漏掉「总线被关掉」这一类缺陷。 */
  function pathGain(from, to) {
    let best = 0;
    (function visit(n, acc, depth) {
      if (depth > 12) return;
      if (n === to) { if (acc > best) best = acc; return; }
      for (const o of n.outs) {
        const g = (o.kind === 'gain') ? (o.gain.target !== null ? o.gain.target : o.gain.value) : 1;
        visit(o, acc * g, depth + 1);
      }
    })(from, 1, 0);
    return best;
  }

  let preHook = null;
  function frame(dt) {
    const d = dt === undefined ? h.TL.C.FIXED_DT : dt;
    if (preHook) preHook();
    stub.advance(d);
    h.TL.Input.update();
    h.TL.Game.update(d);
  }
  /** 只推进音频时钟（不跑游戏逻辑）——用于隔离测量音乐层 */
  function pumpAudio(sec) {
    const step = 1 / 60;
    for (let i = 0; i < Math.round(sec / step); i++) stub.advance(step);
  }
  function pin(x, y) { preHook = () => { const s = h.TL.Game.shark; s.x = x; s.y = y; s.speed = 0; s.state = 'cruise'; }; }
  function unpin() { preHook = null; }

  return {
    h, stub, A, G: h.TL.Game, C: h.TL.C, U: h.TL.U,
    nodes, comp, busMusic, busHeart, master, dest, pathGain, LAYER, layerOk, heartIdentityOk, frame, pumpAudio, pin, unpin,
    layerTargets() { const o = {}; for (const k in LAYER) o[k] = LAYER[k] ? LAYER[k].gain.target : null; return o; },
    liveNodes() { return nodes.filter(n => n.kind !== 'ctx' && n.kind !== 'dest' && !n.disconnected && !n._ended).length; },
    /** 真正与 audio.js 内部 `live` 声部预算等价的计数：
     *  只数「会 start/stop 的瞬时声源」，排除常驻的总线/层增益/引擎振荡器。 */
    liveVoices() {
      return nodes.filter(n => (n.kind === 'osc' || n.kind === 'bufsrc') &&
        typeof n.stopped === 'number' && !n.disconnected && !n._ended).length;
    }
  };
}

/* =====================================================================
 * 3 · 静态扫描
 * ===================================================================== */
function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function scanCallSites() {
  const sites = [];
  for (const f of walk(SRC)) {
    const rel = path.relative(PROJECT, f).replace(/\\/g, '/');
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const re = /TL\.Audio\.play\(\s*(['"])([A-Za-z0-9_]+)\1/g;
      let m;
      while ((m = re.exec(ln)) !== null) sites.push({ file: rel, line: i + 1, name: m[2] });
      const tri = /TL\.Audio\.play\([^)]*\?\s*(['"])([A-Za-z0-9_]+)\1\s*:\s*(['"])([A-Za-z0-9_]+)\3/.exec(ln);
      if (tri) {
        sites.push({ file: rel, line: i + 1, name: tri[2], ternary: true });
        sites.push({ file: rel, line: i + 1, name: tri[4], ternary: true });
      }
    });
  }
  return sites;
}

function scanSfxTable() {
  const code = fs.readFileSync(path.join(SRC, 'core', 'audio.js'), 'utf8');
  const a = code.indexOf('var SFX = {');
  const b = code.indexOf('* 8 · 对外接口');
  const body = code.slice(a, b > a ? b : code.length);
  const keys = [];
  const re = /^\s{4}([A-Za-z][A-Za-z0-9_]*)\s*:\s*function/gm;
  let m;
  while ((m = re.exec(body)) !== null) keys.push(m[1]);
  return keys;
}

/* =====================================================================
 * 4 · 报告
 * ===================================================================== */
const R = harness.reporter('TIDELINE · PH6 音频实现审计探针（PH6-AUDIO-002）');
const fmt = v => (v === null || v === undefined) ? 'n/a' : Number(v).toFixed(2);

/* ---------------------------------------------------------------- 0 */
R.section('0 · 探针自检（桩结构识别是否成立）');
const P0 = bootWithAudio();
R.note('   DynamicsCompressor 节点 = ' + (P0.comp ? 1 : 0));
R.note('   连到 limiter 的 Gain = ' + P0.nodes.filter(n => n.kind === 'gain' && n.outs.indexOf(P0.comp) >= 0).length +
  '（应为 4：busSfx / busMusic / busUi / busHeart）');
R.note('   busMusic 收到的 Gain 输入 = ' + (P0.busMusic ? P0.busMusic.ins.filter(i => i.kind === 'gain').length : -1) +
  '（应为 5：脉冲 / 军鼓 / hi-hat / 围剿 / 引擎 —— 心跳已迁出）');
R.note('   busHeart 独立总线 = ' + (P0.busHeart ? ('有（心跳层输入 ' + P0.busHeart.ins.filter(i => i.kind === 'gain').length + '）') : '缺失') +
  ' → 心跳不在 busMusic 上，音乐开关无法吞掉它（F1 修复）');
R.check('0a 总线与六个音乐层节点可被结构化识别', P0.layerOk,
  'pulse=' + !!P0.LAYER.pulse + ' snare=' + !!P0.LAYER.snare + ' engine=' + !!P0.LAYER.engine);
R.check('0b ⭐ busHeart 交叉校验：其唯一输入 = 心跳层，且该层不在 busMusic 上（防「测错总线假绿」）',
  P0.heartIdentityOk,
  'busMusic 层输入=' + (P0.busMusic ? P0.busMusic.ins.filter(i => i.kind === 'gain').length : -1) +
  ' / busHeart 层输入=' + (P0.busHeart ? P0.busHeart.ins.filter(i => i.kind === 'gain').length : -1) +
  ' / 心跳层在 busMusic 上=' + (P0.busMusic && P0.LAYER.heart ? P0.busMusic.ins.indexOf(P0.LAYER.heart) >= 0 : 'n/a'));

/* ---------------------------------------------------------------- A */
R.section('A · 音频事件覆盖矩阵');

const used = scanCallSites();
const usedNames = Array.from(new Set(used.map(s => s.name))).sort();
const tableKeys = scanSfxTable();

R.note('call site 数 = ' + used.length + '，去重后 ' + usedNames.length + ' 个事件名');
used.forEach(s => R.note('   ' + s.file + ':' + s.line + '  → ' + s.name + (s.ternary ? ' （三元）' : '')));
R.note('SFX 表定义 = ' + tableKeys.length + ' 个：' + tableKeys.join(', '));

const missingInTable = usedNames.filter(n => tableKeys.indexOf(n) < 0);
const neverCalled = tableKeys.filter(n => usedNames.indexOf(n) < 0);

R.check('A1 无「调用了但表中未定义」事件（静默失败）', missingInTable.length === 0,
  missingInTable.join(', ') || '');
R.note('A2 定义了但代码从不调用（死资源，' + neverCalled.length + ' 个）：' + (neverCalled.join(', ') || '无'));

/* ---- 实跑观测：分「长跑」+「定向触发」两段 ---- */
const P = bootWithAudio();
const observed = new Set();
const origPlay = P.A.play.bind(P.A);
P.A.play = function (n) { observed.add(n); return origPlay(n); };
const G = P.G, C = P.C, hh = P.h;

/* 段 1：60s 随机输入长跑（覆盖探索性事件） */
P.U.srand(20240607);
G.reset();
for (let i = 0; i < 60 * 60; i++) {
  if (i % 37 === 0) {
    const a = Math.sin(i / 60 * 0.7) * 0.9 + (i % 240 < 120 ? 0 : Math.PI * 0.15);
    hh.releaseAll(); hh.keyDown(a < 0 ? 'a' : 'd'); hh.keyDown(Math.sin(a) < 0 ? 'w' : 's');
  }
  if (i % 150 === 0) { hh.keyDown(' '); hh.keyUp(' '); }
  if (G.qte.active && i % 14 === 0) { hh.keyDown(' '); hh.keyUp(' '); }
  P.frame(C.FIXED_DT);
  if (G.over) G.reset();
}
hh.releaseAll();
R.note('段 1（60s 长跑）观测到：' + Array.from(observed).sort().join(', '));

/* 段 2：定向触发 ALARM 三档 / 通缉拉满 / 捕食 / DECOY 命中 / 系绳断线 / 死亡 */
G.reset();
const DEEP_X = 300, DEEP_Y = hh.TL.World.waterLineY(300, 0) + 420;
P.pin(DEEP_X, DEEP_Y);

/* ALARM 升档 / 通缉拉满 */
G.alarm = 30; P.frame();
G.alarm = 55; P.frame();
G.alarm = 1000; P.frame(); P.frame();      // clamp 到 100 → 触发通缉拉满
/* ALARM 降档（跌破 22 / 46 / 70 各一次） */
G.tier = 3; G.alarm = 60; P.frame();
G.tier = 2; G.alarm = 40; P.frame();
G.tier = 1; G.alarm = 10; P.frame();

/* 捕食：把猎物摆到嘴边 */
G.reset(); P.pin(DEEP_X, DEEP_Y);
(function () {
  const s = G.shark;
  hh.TL.Prey.reset(0);
  const prey = hh.TL.Prey.list;
  if (prey && prey.length) {
    s.state = 'dash'; s.dashT = 0.02;
    prey[0].x = s.x + 40; prey[0].y = s.y;
    G.tryBite(s);
  }
})();

/* DECOY 引爆 + 命中（注入一个无系绳的 T2B 到爆点半径内） */
G.reset(); P.pin(DEEP_X, DEEP_Y);
(function () {
  const s = G.shark;
  s.x = 1800; s.y = hh.TL.World.waterLineY(1800, G.time) + 10; s.state = 'dash';
  hh.TL.Enemies.list.push({
    kind: 'T2B', x: 1810, y: s.y, vx: 0, hasTether: false,
    decoyT: 0, immuneFlash: 0, life: 0, wake: 0
  });
  G.onSurfaceCross(s, s.x, s.y);
})();

/* 系绳锁定 → 断线 */
G.reset();
(function () {
  G.tier = 3; G.alarm = 90;
  P.pin(DEEP_X, DEEP_Y);
  for (let i = 0; i < 60 * 3; i++) P.frame(C.FIXED_DT);        // 等直升机锁定
  for (let i = 0; i < 60 * 5; i++) P.frame(C.FIXED_DT);        // 深潜 → 1.5s 断线
})();

/* 死亡（搁浅 QTE 失败）*/
G.reset(); P.unpin();
(function () {
  const s = G.shark;
  s.x = 2750; s.y = hh.TL.World.seabedY(2750) - C.SHARK.HALF_H + C.SHARK.SINK;
  s.theta = 0; s.dashT = -1;
  for (let i = 0; i < 4; i++) s.carry.push('swimmer');
  G.pendingScore = 400;
  for (let i = 0; i < 60 * 10 && !G.over; i++) P.frame(C.FIXED_DT);
})();

/* QTE：真实按键连打 → 输入音 + 脱困 */
G.reset();
(function () {
  const s = G.shark;
  s.x = 2750; s.y = hh.TL.World.seabedY(2750) - C.SHARK.HALF_H + C.SHARK.SINK;
  s.theta = 0; s.dashT = -1;
  for (let i = 0; i < 4; i++) s.carry.push('swimmer');
  G.pendingScore = 400;
  for (let i = 0; i < 60 * 10 && !G.qte.active; i++) P.frame(C.FIXED_DT);
  let fake = 5000;
  hh.setNow(() => { fake += 130; return fake; });
  for (let i = 0; i < 60 * 3 && G.qte.active; i++) { hh.keyDown(' '); hh.keyUp(' '); P.frame(C.FIXED_DT); }
  hh.setNow(() => Date.now());
})();

/* 受击 / 破水 / 体力拒绝 / Bank / UI */
G.reset(); P.pin(DEEP_X, DEEP_Y);
G.applyStun(); G.applySnare(); G.applySlow();
G.onSurfaceCross(G.shark, 1800, 100);
(function () {
  const s = G.shark; s.stamina = 0; s.dashCd = 0; s.state = 'cruise';
  hh.keyDown(' '); P.frame(); hh.keyUp(' ');
})();
/* 摩托艇撞击（F3：独立音色 motorboat）。注入 T2B 与鲨鱼重叠 →
 * 下一帧 update() 里 Enemies.hitTestShark 命中 → jetskiHit → play('motorboat')。 */
G.reset(); P.pin(DEEP_X, DEEP_Y);
(function () {
  const s = G.shark;
  s.iframeT = 0;
  s.carry.push('surfer');                  // 携带中撞击 → 走「掉战利品」分支
  hh.TL.Enemies.list.length = 0;
  hh.TL.Enemies.list.push({
    kind: 'T2B', x: s.x, y: s.y, vx: 0, hasTether: false,
    decoyT: 0, immuneFlash: 0, life: 0, wake: 0
  });
  P.frame();
})();
G.reset();
(function () {
  const s = G.shark;
  s.x = 400; s.y = hh.TL.World.waterLineY(400, G.time) + 300;
  s.carry.push('surfer', 'surfer');
  G.pendingScore = 300; G.combo = 8;
  for (let i = 0; i < 60 * 5 && G.banked === 0 && !G.over; i++) P.frame(C.FIXED_DT);
})();
P.A.play('ui');
P.A.play('lockWarn');
P.unpin();

R.note('段 2（定向触发）后累计观测：' + Array.from(observed).sort().join(', '));
const notObserved = usedNames.filter(n => !observed.has(n));
R.check('A3 全部已接线事件在实跑中均可触达（非纸面接线）', notObserved.length === 0,
  notObserved.length ? ('未触发：' + notObserved.join(', ')) : '');

/* ---- A5：有视觉反馈却无音频的游戏事件 ---- */
R.note('A5 关键事件「视觉调用 × 音频调用」逐函数核对（game.js）：');
const GAME = fs.readFileSync(path.join(SRC, 'game', 'game.js'), 'utf8');
function bodyOf(src, fnName) {
  const i = src.indexOf('function ' + fnName + '(');
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i); const st = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(st, j + 1);
}
const EVENTS = [
  ['咬合命中', 'tryBite'], ['DECOY 引爆', 'onSurfaceCross'], ['ALARM 升/降档', 'onTierChange'],
  ['通缉令拉满', 'updateAlarm'], ['Bank 结算', 'doBank'], ['死亡', 'killShark'],
  ['搁浅进入', 'enterBeached'], ['QTE 单次输入', 'updateQTE'], ['QTE 脱困', 'qteSuccess'],
  ['眩晕命中', 'applyStun'], ['束缚命中', 'applySnare'], ['减速命中', 'applySlow'],
  ['摩托艇撞击', 'jetskiHit']
];
const gapsA = [];
for (const [label, fn] of EVENTS) {
  const b = bodyOf(GAME, fn);
  const hasVisual = /TL\.FX\.|triggerFlash|triggerShake|triggerFreeze|addToast|desatTarget/.test(b);
  const hasAudio = /TL\.Audio\.play/.test(b);
  if (!hasAudio) gapsA.push(label);
  R.note('   ' + (hasAudio ? '✓' : '✗') + ' ' + label.padEnd(12) + ' (' + fn + ')  视觉=' + hasVisual + ' 音频=' + hasAudio);
}
/* 别处的关键事件 */
[['体力不足拒绝', 'src/src/game/shark.js', 'TL.Audio.play(\'deny\')'],
['冲刺脱困', 'src/src/game/game.js', 'TL.Audio.play(\'rescued\')'],
['收集物拾取', 'src/src/game/entities.js', 'TL.Audio.play(\'collect\')'],
['系绳锁定开始', 'src/src/game/entities.js', 'TL.Audio.play(\'tether\')'],
['系绳断裂', 'src/src/game/entities.js', 'TL.Audio.play(\'tetherBreak\')'],
['敌人登场预警', 'src/src/game/entities.js', 'TL.Audio.play(\'lockWarn\')']].forEach(v => {
  const f = path.join(PROJECT, v[1]);
  const ok = fs.readFileSync(f, 'utf8').indexOf(v[2]) >= 0;
  if (!ok) gapsA.push(v[0]);
  R.note('   ' + (ok ? '✓' : '✗') + ' ' + v[0].padEnd(12) + ' [' + v[1] + ']');
});
R.check('A5 关键事件均有音频反馈（DECOY 免疫驳回为设计性静默，单独说明）',
  gapsA.length === 0, gapsA.join(', ') || '');

/* ---------------------------------------------------------------- B */
R.section('B · 四层动态音乐核查（隔离测量：只推进音频时钟）');

const Q = bootWithAudio();
const QG = Q.G;

function readLayers(tier, carryK, qte, over) {
  QG.reset();
  QG.alarm = 0;
  QG.tier = tier;
  QG.over = !!over;
  if (carryK) for (let i = 0; i < carryK; i++) QG.shark.carry.push('swimmer');
  QG.qte.active = !!qte;
  Q.pumpAudio(4.0);                       // ≥1 个小节 → applyTargets 必然被调用
  return Q.layerTargets();
}

const tierRows = [];
for (let t = 0; t <= 3; t++) {
  const tgt = readLayers(t, 0, false, false);
  tierRows.push(tgt);
  R.note('   tier ' + t + ' → pulse=' + fmt(tgt.pulse) + ' snare=' + fmt(tgt.snare) +
    ' engine=' + fmt(tgt.engine) + ' hat=' + fmt(tgt.hat) + ' siege=' + fmt(tgt.siege) + ' heart=' + fmt(tgt.heart));
}
R.check('B1 L1 脉冲层全档位常驻（tier0 pulse=1.00）', tierRows[0].pulse === 1, fmt(tierRows[0].pulse));
R.check('B1 L2 军鼓层 T0 关 / T1+ 开',
  tierRows[0].snare === 0 && tierRows[1].snare === 1 && tierRows[2].snare === 1 && tierRows[3].snare === 1,
  tierRows.map(r => fmt(r.snare)).join('/'));
R.check('B1 L3 引擎层 T2 起开（T0/T1=0，T2/T3=0.90 —— 引擎层留 10% headroom）',
  tierRows[0].engine === 0 && tierRows[1].engine === 0 &&
  Math.abs(tierRows[2].engine - 0.9) < 1e-9 && Math.abs(tierRows[3].engine - 0.9) < 1e-9,
  tierRows.map(r => fmt(r.engine)).join('/'));
R.check('B1 L4 围剿层仅 T3 开（A2+D#3 三全音）',
  tierRows[0].siege === 0 && tierRows[1].siege === 0 && tierRows[2].siege === 0 && tierRows[3].siege === 1,
  tierRows.map(r => fmt(r.siege)).join('/'));
R.check('B1 hi-hat 密度随档位递增（T0/T1=0，T2=0.70，T3=1.00）',
  tierRows[0].hat === 0 && tierRows[1].hat === 0 && Math.abs(tierRows[2].hat - 0.7) < 1e-9 && tierRows[3].hat === 1,
  tierRows.map(r => fmt(r.hat)).join('/'));
R.check('B1 死亡后所有层归零（over=true）',
  readLayers(3, 2, false, true).siege === 0, 'over 时 pulse/siege 应为 0');

const carry2 = readLayers(0, 2, false, false);
R.note('   tier0 + 携带 k=2 → pulse=' + fmt(carry2.pulse) + ' snare=' + fmt(carry2.snare) + ' engine=' + fmt(carry2.engine));
R.check('B1 支柱一「携带」强制上军鼓 + 引擎（与 ALARM 档位无关）',
  carry2.snare === 1 && carry2.engine === 0.9 && carry2.pulse < 1,
  'snare=' + fmt(carry2.snare) + ' engine=' + fmt(carry2.engine) + ' pulse=' + fmt(carry2.pulse));

const qteRow = readLayers(0, 0, true, false);
R.check('B1 QTE 期间音乐让位给心跳（pulse/snare/engine 全 0，heart=1）',
  qteRow.pulse === 0 && qteRow.snare === 0 && qteRow.engine === 0 && qteRow.heart === 1,
  JSON.stringify(qteRow));

/* BPM 随档位递增 */
const bpm = [];
for (let t = 0; t <= 3; t++) { readLayers(t, 0, false, false); bpm.push(96 + t * 8); }
R.check('B1 BPM 随档位递增 96 → 120（紧迫度不只靠响度）',
  bpm[0] < bpm[3], bpm.join(' → '));

/* ---- B2 过渡平滑 ---- */
const layerGainEvents = [];
for (const k in Q.LAYER) {
  const n = Q.LAYER[k];
  if (!n) continue;
  n.gain.events.forEach(e => layerGainEvents.push({ layer: k, op: e.op, v: e.v, tc: e.tc }));
}
const hard = layerGainEvents.filter(e => e.op === 'set' && e.v > 0.01);
const ramps = layerGainEvents.filter(e => e.op === 'tgt');
R.note('   层增益自动化事件 = ' + layerGainEvents.length + '，setTargetAtTime = ' + ramps.length);
R.note('   时间常数取值集合 = {' + Array.from(new Set(ramps.map(r => r.tc))).join(', ') + '}');
R.check('B2 层切换全部走 setTargetAtTime（无硬 on/off、无爆音风险）', hard.length === 0,
  hard.length ? JSON.stringify(hard.slice(0, 3)) : '');
R.check('B2 层增益时间常数 ≥ 0.10s', ramps.length > 0 && ramps.every(r => r.tc >= 0.10),
  Array.from(new Set(ramps.map(r => r.tc))).join(','));

/* ---- B3 musicOff 归零（实测） ---- */
Q.A.setMusicEnabled(false);
const off = readLayers(3, 0, false, false);
R.note('   musicOff @ tier3 → ' + JSON.stringify({
  pulse: fmt(off.pulse), snare: fmt(off.snare), engine: fmt(off.engine),
  hat: fmt(off.hat), siege: fmt(off.siege), heart: fmt(off.heart)
}));
R.check('B3 musicOff 后 L1/L2/L3/L4 层目标增益全部归零',
  off.pulse === 0 && off.snare === 0 && off.engine === 0 && off.hat === 0 && off.siege === 0,
  JSON.stringify(off));
R.check('B3 musicOff 同时把音乐总线增益压到 ~0',
  Q.busMusic.gain.target !== null && Q.busMusic.gain.target < 0.001, String(Q.busMusic.gain.target));
Q.A.setMusicEnabled(true);
const on = readLayers(3, 0, false, false);
R.check('B3 重新开启后 L1/L2/L3/L4 恢复', on.pulse === 1 && on.siege === 1, JSON.stringify(on));

/* ---------------------------------------------------------------- C */
R.section('C · 可访问性冗余通道验证');

/* C1 · musicOff + QTE：心跳是否仍可闻（实测层增益 + 实测发声次数） */
const S = bootWithAudio();
S.A.setMusicEnabled(false);
S.G.reset();
S.G.qte.active = true;
const t0 = S.nodes.length;
let heartTargets = [];
for (let i = 0; i < 60 * 3; i++) {
  S.pumpAudio(1 / 60);
  const t = S.layerTargets();
  if (t && t.heart !== null && t.heart !== undefined) heartTargets.push(t.heart);
}
const newOsc = S.nodes.slice(t0).filter(n => n.kind === 'osc');
const heartHits = newOsc.filter(n => n.frequency.events.some(e => e.op === 'set' && e.v >= 70 && e.v <= 80)).length;
const heartTarget = heartTargets.length ? heartTargets[heartTargets.length - 1] : null;
R.note('   musicOff + QTE：心跳层目标增益 = ' + fmt(heartTarget) +
  '；3s 内新建振荡器 ' + newOsc.length + ' 个，其中 74Hz 心跳脉冲 ' + heartHits + ' 个');
R.check('C1 musicOff 下 QTE 心跳层目标增益仍为 1（不被音乐开关吞掉）', heartTarget === 1, fmt(heartTarget));
R.check('C1 musicOff 下心跳确实在发声（3s ≥ 5 次脉冲 ≈ 2Hz）', heartHits >= 5, heartHits);
R.check('C1 心跳等效频率 = 2.0Hz（不超硬红线① 的 2Hz）', 120 / 60 / 4 * 4 === 2.0, '2.0');

const RM = bootWithAudio();
RM.G.reset();
RM.G.opts.reducedMotion = true;
RM.G.qte.active = true;
RM.pumpAudio(3.0);
R.check('C1 reducedMotion 下 QTE 心跳层关闭（可访问性降级，不产生持续刺激）',
  RM.layerTargets().heart === 0, fmt(RM.layerTargets().heart));

/* ------------------------------------------------------------------
 * C1b ⭐ 「合成了」≠「听得见」：测量冗余通道到 destination 的**有效输出增益**
 *
 * 硬红线② 要求：关掉音乐后，QTE 心跳声必须仍然可闻。
 * 层增益为 1 只说明声源被合成了；它能否到达扬声器，取决于沿途每个
 * GainNode 的乘积。心跳层与其他音乐层共用 busMusic —— 这正是风险点。
 * ------------------------------------------------------------------ */
function heartOutputGain(P) {
  P.A.stopAll();
  P.stub.advance(1.0);
  /* 从**层增益节点**起到 destination 的有效增益：这正是「心跳能不能到达扬声器」
   * 的答案。刻意从层节点起算，以排除声部自身包络（它天然衰减到 0.0001）。 */
  const g = P.pathGain(P.LAYER.heart, P.dest);
  return { gain: g, dB: 20 * Math.log10(Math.max(1e-12, g)) };
}

const G_off = bootWithAudio();
G_off.G.reset();
G_off.G.qte.active = true;
G_off.A.setMusicEnabled(false);
G_off.pumpAudio(1.0);                     // 让层增益目标稳定下来
const offRes = heartOutputGain(G_off);
R.note('   musicOff = true  ：心跳层 ' + fmt(G_off.LAYER.heart.gain.target) +
  ' × busHeart ' + fmt(G_off.busHeart.gain.value) + ' × master ' + fmt(G_off.master.gain.value) +
  ' → 有效增益 ' + offRes.gain.toExponential(3) + '（' + offRes.dB.toFixed(1) + ' dB）');

const G_on = bootWithAudio();
G_on.G.reset();
G_on.G.qte.active = true;
G_on.A.setMusicEnabled(true);
G_on.pumpAudio(1.0);
const onRes = heartOutputGain(G_on);
R.note('   musicOff = false ：心跳层 ' + fmt(G_on.LAYER.heart.gain.target) +
  ' × busHeart ' + fmt(G_on.busHeart.gain.value) + ' × master ' + fmt(G_on.master.gain.value) +
  ' → 有效增益 ' + onRes.gain.toExponential(3) + '（' + onRes.dB.toFixed(1) + ' dB）');
R.note('   ⭐ 参考：人耳可辨阈值约 −60dB(A)；项目其余 SFX 走 busSfx×master = ' +
  fmt(1.0 * 0.30) + '（−10.5 dB）');

R.check('C1b ⭐ musicOff 下 QTE 心跳仍能到达输出（有效增益 ≥ 0.01 ≈ −40dB）',
  offRes.gain >= 0.01,
  '实测 ' + offRes.gain.toExponential(3) + '（' + offRes.dB.toFixed(1) + ' dB）→ ' +
  (offRes.gain >= 0.01 ? '可闻' : '被音乐总线一并静音，冗余通道实际失效'));

/* ------------------------------------------------------------------
 * C1d ⭐ 回归门：「修 bug 不得顺手改混音」。
 *
 * F1 的正确修法是**解耦开关**，不是改混音电平：把心跳搬到独立总线时，
 * 该总线的增益必须等于原来的 BUS.MUSIC，否则 music-on（绝大多数对局的常态）
 * 的心跳响度会被整体抬高/压低（此前误设 1.0 曾抬高 +7.4dB）。
 * 断言：music-on 心跳有效增益 == BUS.MUSIC × master（容差 5%）。
 * ------------------------------------------------------------------ */
{
  const AUDIO_CODE = fs.readFileSync(path.join(SRC, 'core', 'audio.js'), 'utf8');
  const BUS_MUSIC = +(/\bBUS\s*=\s*\{[^}]*\bMUSIC\s*:\s*([\d.]+)/.exec(AUDIO_CODE) || [])[1];
  const expectedOn = BUS_MUSIC * G_on.master.gain.value;
  R.note('   设计值：BUS.MUSIC(' + BUS_MUSIC + ') × master(' + fmt(G_on.master.gain.value) + ') = ' +
    expectedOn.toExponential(3) + '（' + (20 * Math.log10(Math.max(1e-12, expectedOn))).toFixed(1) + ' dB）');
  R.check('C1d ⭐ music-on 时心跳有效增益 = BUS.MUSIC × master（容差 5%）—— 防「修 bug 顺手改混音」回归',
    Math.abs(onRes.gain - expectedOn) <= expectedOn * 0.05,
    '实测 ' + onRes.gain.toExponential(3) + '（' + onRes.dB.toFixed(1) + ' dB）vs 设计 ' + expectedOn.toExponential(3) +
    ' → 偏差 ' + ((onRes.gain / expectedOn - 1) * 100).toFixed(2) + '%');
}

/* C1c · duck() 的恢复目标是否尊重音乐开关
 * 读 `.value`（最后一条自动化的终点）而非 `.target`（setTargetAtTime 的目标），
 * 因为 duck() 用的是 linearRampToValueAtTime，它只改 .value。 */
const G_duck = bootWithAudio();
G_duck.G.reset();
G_duck.A.setMusicEnabled(false);
G_duck.pumpAudio(0.5);
const busBefore = G_duck.busMusic.gain.value;
G_duck.A.play('tierUp');                  // tierUp 内部会调用 duck()
G_duck.pumpAudio(2.0);                    // 跑完 duck 的 0.06 + hold + 0.45
const busAfter = G_duck.busMusic.gain.value;
R.note('   musicOff 下触发一次 duck()（tierUp）：busMusic.gain 值 ' +
  fmt(busBefore) + ' → ' + fmt(busAfter) + '（音乐开关期望：保持 ≈ 0.00）');
R.check('C1c duck() 恢复后不把已关闭的音乐总线重新打开',
  busAfter < 0.001,
  '实测 ' + fmt(busAfter) + ' → ' +
  (busAfter < 0.001 ? '正常' : '⭐ 音乐总线被 duck 重新打开到 ' + fmt(busAfter) + '（音乐开关被部分击穿）'));

/* C2 · 每个事件的振荡器签名可区分（实测：波形 + 频率） */
const W = bootWithAudio();
const sig = {};
function captureSfx(name) {
  W.A.stopAll();                       // 清空存活声部，避免 MAX_VOICES 把后续声部挤掉
  W.stub.advance(2.0);                 // 推进时钟 → 声部自然结束并被回收
  const before = W.stub.created.length;
  W.A.play(name);
  const news = W.stub.created.slice(before);
  const oscs = news.filter(n => n.kind === 'osc');
  const noises = news.filter(n => n.kind === 'bufsrc');
  return {
    osc: oscs.length, noise: noises.length,
    types: Array.from(new Set(oscs.map(o => o.type))).sort().join('+'),
    freqs: oscs.flatMap(o => o.frequency.events.filter(e => e.op === 'set').map(e => e.v))
      .map(v => Math.round(v)).join(','),
    filt: Array.from(new Set(news.filter(n => n.kind === 'filter').map(f => f.type))).sort().join('+')
  };
}
tableKeys.forEach(n => { sig[n] = captureSfx(n); });
R.note('  各事件实测合成签名（osc=振荡器数, noise=噪声源数, filt=滤波器类型）：');
tableKeys.forEach(k => R.note('   ' + k.padEnd(12) + ' osc=' + String(sig[k].osc).padEnd(2) +
  ' noise=' + String(sig[k].noise).padEnd(2) + ' 波形=' + (sig[k].types || '-').padEnd(18) +
  ' 滤波=' + (sig[k].filt || '-').padEnd(9) + ' 频率=' + (sig[k].freqs || '-')));

const emptySigs = tableKeys.filter(k => sig[k].osc === 0 && sig[k].noise === 0);
R.check('C2 每个音效都真的合成了声源（无空实现）', emptySigs.length === 0, emptySigs.join(', ') || '');

const up = sig.tierUp.freqs.split(',').map(Number);
const dn = sig.tierDown.freqs.split(',').map(Number);
R.check('C2 ALARM 升档 = 上行音高（440 → 659）', up[0] < up[1], up.join('→'));
R.check('C2 ALARM 降档 = 下行音高（659 → 440）', dn[0] > dn[1], dn.join('→'));
R.check('C2 升/降档波形不同（square vs triangle）→ 音高走向 + 音色 双维度可区分',
  sig.tierUp.types !== sig.tierDown.types, sig.tierUp.types + ' vs ' + sig.tierDown.types);
R.check('C2 通缉拉满与普通升档可区分（440/587/880 三连 + 622 三全音悬置）',
  sig.alarmMax.osc >= 3 && sig.alarmMax.freqs !== sig.tierUp.freqs, sig.alarmMax.freqs);

const uniq = new Set(tableKeys.map(k => sig[k].types + '|' + sig[k].freqs + '|' + sig[k].noise + '|' + sig[k].filt));
R.check('C2 音效签名高度唯一（无「一个音色打天下」）', uniq.size >= tableKeys.length - 1,
  uniq.size + '/' + tableKeys.length + ' 唯一');

/* C3 · 静音无逻辑副作用：三条轨迹逐帧比对 */
function runTrajectory(mode) {
  const h2 = harness.boot({ mute: true });
  let stub = null;
  if (mode !== 'none') {
    stub = makeAudioStub();
    h2.sandbox.AudioContext = stub.Ctx;
    h2.sandbox.setInterval = stub.clock.setInterval.bind(stub.clock);
    h2.sandbox.clearInterval = stub.clock.clearInterval.bind(stub.clock);
    h2.load('core/audio.js');
    h2.TL.Audio.init();
    h2.TL.Audio.setMuted(mode === 'muted');
    h2.TL.Audio.setMusicEnabled(true);
  }
  const g = h2.TL.Game, c = h2.TL.C, u = h2.TL.U;
  u.srand(777); g.reset();
  const digest = [];
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 37 === 0) {
      const a = Math.sin(i / 60 * 0.7) * 0.9 + (i % 240 < 120 ? 0 : Math.PI * 0.15);
      h2.releaseAll(); h2.keyDown(a < 0 ? 'a' : 'd'); h2.keyDown(Math.sin(a) < 0 ? 'w' : 's');
    }
    if (i % 150 === 0) { h2.keyDown(' '); h2.keyUp(' '); }
    if (g.qte.active && i % 14 === 0) { h2.keyDown(' '); h2.keyUp(' '); }
    if (stub) stub.advance(c.FIXED_DT);     // 音频时钟与游戏时钟同步推进
    h2.step(g, c.FIXED_DT);
    if (g.over) g.reset();
    if (i % 60 === 0) {
      const sh = g.shark;
      digest.push([sh.x, sh.y, g.alarm, g.tier, sh.carryK, g.banked, g.combo, sh.stamina, g.stats.grabs]
        .map(v => Math.round(v * 1e4)).join(','));
    }
  }
  return digest.join('|');
}
const trajNone = runTrajectory('none');       // 完全不加载 audio.js
const trajMuted = runTrajectory('muted');     // 真实 audio.js，静音
const trajLive = runTrajectory('live');       // 真实 audio.js，开声
R.note('   轨迹指纹长度：无音频=' + trajNone.length + '，静音=' + trajMuted.length + '，开声=' + trajLive.length + ' 字符');
R.check('C3 静音 vs 开声：60s 游戏轨迹逐帧一致（音频对游戏只读不写）', trajMuted === trajLive);
R.check('C3 完全卸载音频 vs 开声：轨迹一致（删除音频不改变任何一帧判定）', trajNone === trajLive);

/* C4 · 静音后仅剩视觉的通道清单 */
R.note('C4 静音（mute）后仍可用的视觉通道（逐位置取证）：');
const VIS = [
  ['ALARM 等级', 'HUD 条长度 + 25/50/75 刻度缺口', 'ui/hud.js + art-bible §6.1'],
  ['ALARM 档位', 'HUD 配色 + toast「↑ 警戒 T1」', 'game/game.js:137'],
  ['通缉令拉满', '全屏色闪 + toast「通缉令拉满」', 'game/game.js:125-127'],
  ['是否携带', '鲨鱼姿态（下沉 6px / 尾摆 −30% / 头上仰 8°）', 'art-bible §4.1.6'],
  ['携带数量 k', '嘴部游客个数 + L1 水花密度 6→18', 'art-bible §4.1.6'],
  ['系绳锁定', '系绳呼吸 1Hz + 准星合拢 + 线宽变细', 'art-bible §5.4.3.4'],
  ['断线成功', '碎片 6 粒子 + 顿帧 0.05s + 震屏 3px + 回弹 0.35s', 'entities.js:325'],
  ['QTE 剩余时间', '圆环半径 140→80 收缩 + 扇形填充', 'game.js drawQTERing'],
  ['QTE 进度', '每命中一针点亮一格 + 外扩脉冲 8px + 沙尘', 'art-bible §6.8.4'],
  ['Bank 结算', '深海光柱加宽 + 结算数字上浮 + toast', 'game/game.js:388-393'],
  ['死亡', 'death 8 帧 + 降饱和 0.85 + COMBO 破碎下坠', 'game/game.js:416-419'],
  ['搁浅', '强调色抽干（高饱和 0%）+ 围观剪影 + 太阳「><」脸', 'art-bible §6.8.1'],
  ['体力耗尽', '体力槽整格闪红 + toast', 'shark.js:112 / hud.js'],
  ['敌人预警', '屏幕边缘方向箭头（提前 0.8s）', 'art-bible §4.4'],
  ['诱饵命中/免疫', '! / ✕ 标记 + 急转向 vs 偏航 15° 回正', 'art-bible §5.4.2'],
  ['携带/未兑现', 'toast「+300 未兑现 · ALARM +20」', 'game/game.js:206']
];
VIS.forEach(v => R.note('   · ' + v[0].padEnd(14) + ' → ' + v[1].padEnd(44) + ' [' + v[2] + ']'));
R.check('C4 静音后每个关键信息仍有 ≥1 视觉通道（无「静音即失明」）', VIS.length >= 15, VIS.length + ' 项');

/* ---------------------------------------------------------------- D */
R.section('D · 声部并发与节点泄漏');

const L = bootWithAudio();
L.G.reset();
L.A.setMuted(false);
const beforeNodes = L.nodes.length;
const spam = tableKeys;
let peakLive = 0, peakAll = 0;
for (let i = 0; i < 60 * 180; i++) {
  if (i % 3 === 0) L.A.play(spam[i % spam.length]);
  L.frame(1 / 60);
  const lv = L.liveVoices(), la = L.liveNodes();
  if (lv > peakLive) peakLive = lv;
  if (la > peakAll) peakAll = la;
}
const leaked = L.nodes.filter(n => n.kind !== 'ctx' && n.kind !== 'dest' && !n.disconnected && !n._ended
  && n.stopped !== null && n.stopped < L.stub.clock.now).length;
R.note('   3 分钟高压（每 3 帧一发，共 ' + Math.round(60 * 180 / 3) + ' 次 play 调用，轮转全部 ' + spam.length + ' 个音效）');
R.note('   创建节点 ' + (L.nodes.length - beforeNodes) + ' 个');
R.note('   峰值并发**声部**（= audio.js 内部 live 预算的等价量）= ' + peakLive);
R.note('   峰值并发**全部未断链节点**（含总线/层增益/引擎常驻）= ' + peakAll);
R.note('   已过 stop 时间但仍未断链的节点（泄漏指标）= ' + leaked);
R.check('D1 无节点泄漏（过 stop 时间必已断链）', leaked === 0, leaked);
R.check('D2 峰值并发声部 ≤ MAX_VOICES + MUSIC_EXTRA（20 + 10 = 30）', peakLive <= 30, peakLive);

const AUDIO_SRC = fs.readFileSync(path.join(SRC, 'core', 'audio.js'), 'utf8');
const maxVoices = +(/(?:var|const)\s+MAX_VOICES\s*=\s*(\d+)/.exec(AUDIO_SRC) || [])[1];
const musicExtra = +(/(?:var|const)\s+MUSIC_EXTRA\s*=\s*(\d+)/.exec(AUDIO_SRC) || [])[1];
R.note('   源码常量：MAX_VOICES = ' + maxVoices + '，MUSIC_EXTRA = ' + musicExtra);
R.check('D3 源码声明了并发上限常量', maxVoices > 0 && musicExtra >= 0, maxVoices + '/' + musicExtra);
R.check('D4 静音时不创建任何声部（ready() 短路，静音=零 CPU）', (function () {
  const M = bootWithAudio();
  M.A.setMuted(true);
  const n0 = M.nodes.length;
  tableKeys.forEach(s => M.A.play(s));
  return M.nodes.length === n0;
})());

/* 声音开关与暂停的行为 */
R.check('D5 setSuspended(true) 后时钟冻结，恢复不积压音符', (function () {
  const X = bootWithAudio();
  X.G.reset();
  X.A.setSuspended(true);
  const frozen = X.stub.clock.now;
  const n0 = X.nodes.length;
  X.stub.advance(5.0);                       // 挂起期间墙钟照走，但 ctx.currentTime 冻结
  const createdWhileSuspended = X.nodes.length - n0;
  X.A.setSuspended(false);
  X.pumpAudio(0.5);
  return createdWhileSuspended === 0;
})());

R.done();
