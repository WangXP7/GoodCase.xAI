/* =====================================================================
 * TIDELINE · core/audio.js
 * Phase 6 · 音频总监 阮和鸣（Ruan Hemo）
 *
 * 设计文档：design/audio/PH6-audio-design.md
 *
 * ── 本文件不是"装饰音"，它是「冗余信息通道」的第三重 ────────────────
 * 硬红线②：颜色永不作为唯一信息通道。美术侧给了形态通道（血红=静态填充 /
 * 洋红=径向运动粒子），本文件给的是**听觉通道**：玩家不看 HUD、不看颜色，
 * 也必须知道 ALARM 升降、QTE 还差几次、系绳是否已断、是否刚 Bank 成功。
 *
 * ── 三条硬约束 ──────────────────────────────────────────────────────
 * ① 零外部资产：全部由振荡器 / 噪声缓冲 / 包络 / 滤波器现场合成。
 * ② 静音必须可用：setMuted(true) 后本模块只读不写，绝不参与任何游戏逻辑。
 * ③ 光敏安全：音频自身不闪烁，但**不得与视觉脉动同步形成 >2Hz 复合刺激**。
 *    → QTE 心跳锁死 2.0Hz（与圆环 2Hz 呼吸同频）；
 *    → 系绳张力音是**连续滑音**，不是脉冲（系绳视觉呼吸 1Hz，二者不同频）；
 *    → reducedMotion 下关闭心跳层。
 *
 * ── 总线结构 ────────────────────────────────────────────────────────
 *   SFX   ──┐
 *   MUSIC ──┼→ limiter(DynamicsCompressor) → master(静音开关) → destination
 *   UI    ──┤
 *   HEART ──┘  ⭐ 心跳走**独立总线**，不受音乐开关管辖（硬红线②）
 *  ⚠️ 心跳层曾挂在 busMusic 上，导致「关掉音乐」把 QTE 心跳一并压掉（审计 F1）；
 *     现将其与音乐层彻底解耦 —— 「层增益为 1」必须真的等于「听得见」。
 * 音乐层是**四层可加性分层**（L1 脉冲 / L2 军鼓 / L3 引擎 / L4 围剿），
 * 由 ALARM 档位 tier(0–3) 与「是否携带」共同驱动（概念文档 §2 支柱一）。
 *
 * ── 状态来源 ────────────────────────────────────────────────────────
 * 为**零改动调用方**，本模块不新增任何对外方法调用点：音乐层通过轮询
 * window.TL.Game 的只读字段（tier / shark.carryK / qte.active / over）
 * 取得状态；SFX 侧的短时状态（QTE 计数、系绳）由事件流自行镜像。
 * 因此本模块对游戏是**纯读取**，删除它不会改变任何一帧的判定。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});

  /* ==================================================================
   * 0 · 混音常量（唯一真源，改这里不要改各处硬编码）
   * ================================================================== */
  var MASTER_GAIN = 0.30;                       // 总输出（留 headroom 给 limiter）
  var BUS = { SFX: 1.00, MUSIC: 0.42, UI: 0.70 };
  var MAX_VOICES = 20;                          // SFX 并发上限
  var MUSIC_EXTRA = 10;                         // 音乐层额外声部预算（不被 SFX 挤掉）

  var LOOKAHEAD = 0.14;                         // 调度提前量（秒）
  var TICK_MS = 25;                             // 调度器心跳（毫秒）

  /* 音乐：A 自然小调，根音 A1 = 55Hz
   * 半音级：A=0 B=2 C=3 D=5 E=7 F=8 G=10
   * ⚠️ 刻意避开《大白鲨》式的两音交替 ostinato（版权与其直白的喜剧感），
   *    改用 6 音切分的 lope——像"有什么东西在水下绕圈"。            */
  var ROOT = 55.0;
  var PULSE_DEG = [0, null, null, 7, null, null, 0, null,
    3, null, null, 0, null, null, 5, null];

  /* 事件冷却（秒）：防止同名音效在 1 帧内堆叠成噪音墙 */
  var COOLDOWN = {
    splash: 0.05, thrash: 0.03, hit: 0.06, lockWarn: 0.25, ui: 0.03,
    decoy: 0.10, deny: 0.15, tierUp: 0.12, tierDown: 0.12, rescued: 0.10,
    sting: 0.20, collect: 0.04, motorboat: 0.06, yelp: 0.10
  };

  /* ==================================================================
   * 1 · 上下文与总线
   * ================================================================== */
  var ctx = null, master = null, limiter = null;
  var busSfx = null, busMusic = null, busUi = null, busHeart = null;
  var noiseBuf = null;
  var muted = false;

  /** 存活声部表：{ n:[节点...], end:ctxTime }。这是节点泄漏的唯一防线。 */
  var live = [];

  function ready() { return !!ctx && !muted; }

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;                            // 无 WebAudio → 全部静默降级
    try { ctx = new AC(); } catch (e) { ctx = null; return; }

    /* 主输出链：buses → limiter → master → destination
     * limiter 放在 master 之前，这样静音斜坡不会引起压缩器抽吸。        */
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;              // 堆叠到 -10dB 开始压
    limiter.knee.value = 8;
    limiter.ratio.value = 12;                   // 硬限幅，杜绝削波爆音
    limiter.attack.value = 0.003;
    limiter.release.value = 0.16;
    limiter.connect(master);

    busSfx = ctx.createGain(); busSfx.gain.value = BUS.SFX; busSfx.connect(limiter);
    busMusic = ctx.createGain();
    busMusic.gain.value = MUS.musicOff ? 0.0001 : BUS.MUSIC;   // 尊重已设定的音乐开关
    busMusic.connect(limiter);
    busUi = ctx.createGain(); busUi.gain.value = BUS.UI; busUi.connect(limiter);

    /* ⭐ 心跳专用总线（**增益 = BUS.MUSIC**，直连 limiter）。
     * 硬红线②：QTE 心跳是「时间正在流逝」的冗余信息通道，**不得随音乐开关一起消失**。
     * 此前心跳层挂在 busMusic 上，关掉音乐时被同一条斜坡压到 −90dB = 不可闻（审计 F1）。
     * ⚠️ 增益刻意取 BUS.MUSIC（**不是 1.0**）：本次只解耦「开关」这一件事，
     *    绝不顺带改动混音电平 —— music-on 时心跳响度与修复前逐比特一致（零回归）。
     * 现在 setMusicEnabled / duck() 都碰不到这条总线。 */
    busHeart = ctx.createGain(); busHeart.gain.value = BUS.MUSIC; busHeart.connect(limiter);

    /* 2.0s 白噪声缓冲：所有水花 / 军鼓 / 沙尘 / 抽气声共用同一份数据，
     * 靠随机读取偏移 + playbackRate 制造变体（省内存，零额外资产）。   */
    var len = Math.floor(ctx.sampleRate * 2.0);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    buildMusic();
    if (!MUS.timer) MUS.timer = setInterval(tick, TICK_MS);
  }

  function resume() {
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
  }

  /* ==================================================================
   * 2 · 声部核心（两个原语：tone / noise）
   * ================================================================== */
  function claim(music) {
    return live.length < (music ? MAX_VOICES + MUSIC_EXTRA : MAX_VOICES);
  }
  function mkEntry(chain, endAt) {
    var e = { n: chain, end: endAt };
    live.push(e);
    return e;
  }
  function drop(e) {
    var i = live.indexOf(e);
    if (i >= 0) live.splice(i, 1);
    for (var j = 0; j < e.n.length; j++) { try { e.n[j].disconnect(); } catch (x) { } }
  }
  /** 兜底回收：onended 没触发（如上下文被系统挂起）时，按时间强制回收。 */
  function prune() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var i = live.length - 1; i >= 0; i--) if (live[i].end < t) drop(live[i]);
  }

  function chainFilters(chain, tail, opt) {
    var f;
    if (opt.hp) {
      f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opt.hp;
      chain.push(f); tail.connect(f); tail = f;
    }
    if (opt.lp) {
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lp;
      if (opt.lpSweep) {
        f.frequency.setValueAtTime(opt.lpSweep[0], ctx.currentTime + (opt.delay || 0));
        f.frequency.exponentialRampToValueAtTime(
          Math.max(40, opt.lpSweep[1]), ctx.currentTime + (opt.delay || 0) + opt.dur);
      }
      chain.push(f); tail.connect(f); tail = f;
    }
    if (opt.bp) {
      f = ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = opt.bp; f.Q.value = opt.q || 1.0;
      if (opt.bpSweep) {
        f.frequency.setValueAtTime(opt.bpSweep[0], ctx.currentTime + (opt.delay || 0));
        f.frequency.exponentialRampToValueAtTime(
          Math.max(40, opt.bpSweep[1]), ctx.currentTime + (opt.delay || 0) + opt.dur);
      }
      chain.push(f); tail.connect(f); tail = f;
    }
    return tail;
  }

  /**
   * 振荡器声部。指数包络（听感上更接近"打击"），结束即自动断链。
   * @param type  sine|square|sawtooth|triangle
   * @param f0/f1 起止频率（指数滑音；相等则定频）
   */
  function tone(type, f0, f1, dur, peak, opt) {
    if (!ready()) return null;
    opt = opt || {};
    if (!claim(opt.music)) return null;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    var chain = [o, g];
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);

    var atk = opt.attack !== undefined ? opt.attack : Math.min(0.008, dur * 0.22);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    if (opt.hold !== undefined) g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + Math.min(dur * 0.92, opt.hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    var tail = chainFilters(chain, g, { hp: opt.hp, lp: opt.lp, lpSweep: opt.lpSweep, dur: dur, delay: opt.delay || 0 });
    tail.connect(opt.bus || busSfx);

    var e = mkEntry(chain, t0 + dur + 0.06);
    o.onended = function () { drop(e); };
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return o;
  }

  /** 噪声声部（水花 / 军鼓 / 沙尘 / 抽气）。共享 noiseBuf，随机读取偏移。 */
  function noise(dur, peak, opt) {
    if (!ready() || !noiseBuf) return null;
    opt = opt || {};
    if (!claim(opt.music)) return null;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var s = ctx.createBufferSource(), g = ctx.createGain();
    var chain = [s, g];
    s.buffer = noiseBuf;
    if (opt.rate) s.playbackRate.value = opt.rate;

    var atk = opt.attack !== undefined ? opt.attack : Math.min(0.006, dur * 0.2);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    if (opt.hold !== undefined) g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + Math.min(dur * 0.92, opt.hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    s.connect(g);
    var tail = chainFilters(chain, g, {
      hp: opt.hp, lp: opt.lp, lpSweep: opt.lpSweep,
      bp: opt.bp, q: opt.q, bpSweep: opt.bpSweep, dur: dur, delay: opt.delay || 0
    });
    tail.connect(opt.bus || busSfx);

    var maxOff = Math.max(0, noiseBuf.duration - dur - 0.05);
    var e = mkEntry(chain, t0 + dur + 0.06);
    s.onended = function () { drop(e); };
    s.start(t0, Math.random() * maxOff);
    s.stop(t0 + dur);
    return s;
  }

  /* ==================================================================
   * 3 · 侧链闪避（duck）：关键音触发时把音乐压下去
   *    比"单纯调大音效"干净得多——关键音在**安静的床**上才听得清。
   * ================================================================== */
  function duck(to, hold) {
    if (!ready() || !busMusic) return;
    /* 音乐已被玩家关闭 → 无音乐可闪避，直接返回。
     * ⚠️ 此前本函数无条件把 busMusic 拉回满值 BUS.MUSIC，
     *    会在 musicOff 时把音乐**偷偷重新打开**（审计 F2）。 */
    if (MUS.musicOff) return;
    var t = ctx.currentTime, g = busMusic.gain;
    var base = BUS.MUSIC;                      // 恢复基准 = 当前应有的音乐电平
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(base * to, t + 0.06);
      g.setValueAtTime(base * to, t + 0.06 + hold);
      g.linearRampToValueAtTime(base, t + 0.06 + hold + 0.45);
    } catch (e) { /* 参数自动化失败不影响游戏 */ }
  }

  /* ==================================================================
   * 4 · 事件流镜像（QTE 计数 / 携带 / 系绳）
   * ================================================================== */
  var mirror = { qteStep: 0, carry: 0, over: false, collect: 0 };

  function qteReset() { mirror.qteStep = 0; }

  /* ==================================================================
   * 5 · 系绳张力音（GDD-02 §5.2「绷紧音升调」）
   *    连续上行滑音：220→660Hz（+ 纯五度泛音），3.0s 走完 = 锁定致死时长。
   *    ⚠️ 刻意做成**连续滑音而非脉冲**：系绳的视觉呼吸是 1Hz，
   *       若音频也做脉冲会与之同步，构成复合周期刺激。滑音无周期性。
   * ================================================================== */
  var riser = null;
  function lockSeconds() {
    return (TL.C && TL.C.TETHER && TL.C.TETHER.LOCK) || 3.0;
  }
  function startRiser() {
    if (!ready()) return;
    stopRiser(0.04);
    var t = ctx.currentTime, L = lockSeconds();
    var a = ctx.createOscillator(), b = ctx.createOscillator();
    var g = ctx.createGain(), f = ctx.createBiquadFilter();
    a.type = 'sine'; b.type = 'sine';
    a.frequency.setValueAtTime(220, t); a.frequency.linearRampToValueAtTime(660, t + L);
    b.frequency.setValueAtTime(330, t); b.frequency.linearRampToValueAtTime(990, t + L);
    f.type = 'lowpass'; f.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.7);
    a.connect(f); b.connect(f); f.connect(g); g.connect(busSfx);
    a.start(t); b.start(t);
    riser = { a: a, b: b, g: g, f: f };
  }
  function stopRiser(fade) {
    if (!riser || !ctx) return;
    var r = riser; riser = null;
    var t = ctx.currentTime, d = (fade === undefined ? 0.12 : fade);
    try {
      r.g.gain.cancelScheduledValues(t);
      r.g.gain.setValueAtTime(Math.max(0.0002, r.g.gain.value), t);
      r.g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      r.a.stop(t + d + 0.02); r.b.stop(t + d + 0.02);
      r.a.onended = function () {
        try { r.a.disconnect(); r.b.disconnect(); r.f.disconnect(); r.g.disconnect(); } catch (x) { }
      };
    } catch (e) { }
  }

  /* ==================================================================
   * 6 · 动态音乐层（L1 脉冲 / L2 军鼓 / L3 引擎 / L4 围剿）
   * ================================================================== */
  var MUS = {
    timer: 0, step: 0, next: 0, bpm: 96,
    gPulse: null, gSnare: null, gEngine: null, gHat: null, gSiege: null, gHeart: null,
    engF: null, tg: { pulse: 1, snare: 0, engine: 0, hat: 0, siege: 0, heart: 0 }
  };

  function buildMusic() {
    function layer(bus) {
      var g = ctx.createGain(); g.gain.value = 0; g.connect(bus || busMusic); return g;
    }
    MUS.gPulse = layer(); MUS.gSnare = layer(); MUS.gHat = layer();
    MUS.gSiege = layer();
    /* ⭐ 心跳层走 busHeart，**永不**接 busMusic —— 音乐开关不得吞掉冗余通道（F1）。 */
    MUS.gHeart = layer(busHeart);
    MUS.gEngine = layer();

    /* 引擎层：两个失谐锯齿（48 / 48.7Hz）→ 低通 → 旋翼颤音 → 层增益
     * 6.5Hz 的 AM 是"直升机旋翼"的听觉签名（GDD-02：T3b 恒定带系绳）。
     * 它是**连续**的，不与任何 1–2Hz 视觉脉动同步。                    */
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 150; f.Q.value = 0.8;
    MUS.engF = f;
    var trem = ctx.createGain(); trem.gain.value = 0.65;
    var lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 6.5; lfoG.gain.value = 0.35;
    lfo.connect(lfoG); lfoG.connect(trem.gain);
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 48 + i * 0.7;
      o.connect(f); o.start(ctx.currentTime);
    }
    f.connect(trem); trem.connect(MUS.gEngine);
    lfo.start(ctx.currentTime);
  }

  /** 只读轮询游戏状态（不新增任何调用点，不改任何判定）。 */
  function gameState() {
    var G = (window.TL && TL.Game) ? TL.Game : null;
    if (!G) return { tier: 0, carry: 0, qte: false, over: false, reduced: false };
    var s = G.shark;
    return {
      tier: G.tier | 0,
      carry: (s && s.carryK) ? 1 : 0,
      qte: !!G.qte.active,
      over: !!G.over,
      reduced: !!(G.opts && (G.opts.reducedMotion || G.opts.qteAssist))
    };
  }

  /** 各层目标增益（0–1）。支柱一：携带 → 军鼓 + 引擎无条件上场。 */
  function musicTargets(st) {
    if (st.over) return { pulse: 0, snare: 0, engine: 0, hat: 0, siege: 0, heart: 0 };
    if (st.qte && !st.reduced) return { pulse: 0, snare: 0, engine: 0, hat: 0, siege: 0, heart: 1 };
    var carrying = st.carry > 0;
    return {
      pulse: carrying ? 0.55 : 1.00,                 // 携带时低音让位给军鼓/引擎
      snare: (st.tier >= 1 || carrying) ? 1 : 0,
      engine: (st.tier >= 2 || carrying) ? 1 : 0,
      hat: st.tier >= 3 ? 1 : (st.tier >= 2 ? 0.7 : 0),
      siege: st.tier >= 3 ? 1 : 0,
      heart: 0
    };
  }

  function setG(node, v) {
    if (!node) return;
    try { node.gain.setTargetAtTime(v, ctx.currentTime, 0.18); } catch (e) { }
  }
  function applyTargets() {
    var P = MUS.tg;
    setG(MUS.gPulse, P.pulse);
    setG(MUS.gSnare, P.snare);
    setG(MUS.gEngine, P.engine * 0.9);
    setG(MUS.gHat, P.hat);
    setG(MUS.gSiege, P.siege);
    setG(MUS.gHeart, P.heart);
    if (MUS.engF) {
      try {
        MUS.engF.frequency.setTargetAtTime(140 + P.engine * 150 + P.siege * 140, ctx.currentTime, 0.4);
      } catch (e) { }
    }
  }

  function scheduleStep(s, t) {
    var d = Math.max(0, t - ctx.currentTime);
    var P = MUS.tg;
    var i;

    /* 音乐开关关闭时，除**心跳**外的所有层目标增益一律视作 0。
     * 心跳是 QTE「还差几次」的听觉量表，属冗余信息通道，
     * 不得随音乐开关一起消失（硬红线②：颜色/音乐都不是唯一通道）。 */
    if (MUS.musicOff) P = { pulse: 0, snare: 0, engine: 0, hat: 0, siege: 0, heart: P.heart };

    /* --- L1 · 脉冲 Bass（全档位常驻的床） --- */
    var deg = PULSE_DEG[s];
    if (deg !== null && deg !== undefined && P.pulse > 0.01) {
      var f = ROOT * Math.pow(2, deg / 12);
      tone('triangle', f, f, 0.16, 0.17 * P.pulse, { bus: MUS.gPulse, delay: d, music: 1, attack: 0.006 });
      tone('sine', f * 0.5, f * 0.5, 0.20, 0.10 * P.pulse, { bus: MUS.gPulse, delay: d, music: 1, attack: 0.008 });
    }

    /* --- L2 · 军鼓（T1+ 或 携带中）：正拍 4 / 12，T3 加 7 / 15 幽灵音 --- */
    if (P.snare > 0.01 && (s === 4 || s === 12)) {
      noise(0.11, 0.15 * P.snare, { lp: 3200, hp: 900, bus: MUS.gSnare, delay: d, music: 1 });
      tone('triangle', 190, 130, 0.08, 0.06 * P.snare, { bus: MUS.gSnare, delay: d, music: 1 });
    }
    if (P.snare > 0.5 && (s === 7 || s === 15)) {
      noise(0.06, 0.07, { lp: 4200, hp: 1200, bus: MUS.gSnare, delay: d, music: 1 });
    }

    /* --- L3b · hi-hat：T2 走 8 分，T3 走 16 分（密度即紧迫度） --- */
    if (P.hat > 0.01 && (P.hat > 0.9 || s % 2 === 0)) {
      noise(0.035, (s % 4 === 0 ? 0.045 : 0.026) * P.hat,
        { lp: 7000, hp: 4200, bus: MUS.gHat, delay: d, music: 1 });
    }

    /* --- L4 · 围剿刺：每小节头的三全音（A2 110 / D#3 155.56）
     *     减五度 = 不解决。概念文档 §2 支柱二：「贪婪冲滩时是不解决的减和弦」 */
    if (P.siege > 0.01 && s === 0) {
      tone('sawtooth', 110, 110, 0.42, 0.10 * P.siege, { bus: MUS.gSiege, delay: d, lp: 700, music: 1 });
      tone('sawtooth', 155.56, 155.56, 0.42, 0.08 * P.siege, { bus: MUS.gSiege, delay: d, lp: 700, music: 1 });
    }

    /* --- QTE 心跳：bpm 恒 120 → 步 0/4/8/12 = 严格 2.0Hz
     *     与 QTE 圆环 2Hz 呼吸**同频**，复合刺激仍为 2Hz（硬红线①） --- */
    if (P.heart > 0.01 && (s === 0 || s === 4 || s === 8 || s === 12)) {
      tone('sine', 74, 46, 0.15, 0.26 * P.heart, { bus: MUS.gHeart, delay: d, music: 1 });
    }
  }

  function tick() {
    if (!ctx) return;
    prune();
    if (muted || ctx.state !== 'running') return;
    var st = gameState();
    var t = ctx.currentTime;

    /* 落后太多（切后台 / 长时间挂起）→ 重新对齐，绝不追赶补发一堆积压音符 */
    if (MUS.next < t) MUS.next = t + 0.03;

    MUS.tg = musicTargets(st);
    if (MUS.musicOff) {
      MUS.tg = { pulse: 0, snare: 0, engine: 0, hat: 0, siege: 0, heart: MUS.tg.heart };
    }
    var guard = 0;
    while (MUS.next < t + LOOKAHEAD && guard++ < 64) {
      if (MUS.step === 0) {
        MUS.bpm = st.qte && !st.reduced ? 120 : (96 + st.tier * 8);
        applyTargets();
      }
      scheduleStep(MUS.step, MUS.next);
      MUS.next += (60 / MUS.bpm) / 4;         // 16 分音符步长
      MUS.step = (MUS.step + 1) & 15;
    }
  }

  /* ==================================================================
   * 7 · 音效表
   *   命名约定：<对象><动作>，骆驼命名。时长全部 <200ms（概念文档 §2
   *   支柱三「留白多，反馈音效短促」），仅 death / bank 例外（它们是
   *   段落级的情绪收束，不是反馈音）。
   * ================================================================== */
  var SFX = {

    /* ---------- P0 · 冗余信息通道（禁止削减、禁止加冷却） ---------- */

    /** ALARM 升档：两音上行 A4→E5（纯五度），square = 硬、刺 */
    tierUp: function () {
      tone('square', 440, 440, 0.09, 0.26, { lp: 5200 });
      tone('square', 659.25, 659.25, 0.10, 0.24, { delay: 0.085, lp: 5200 });
      duck(0.30, 0.30);
    },

    /** ALARM 降档：同两音**下行** + triangle（软）
     *  ⭐ 与升档的区分是**双通道**的：音高走向（上行/下行）+ 波形（方/三角）。
     *     任一维度单独失效（听力损失 / 音色掩蔽）仍可辨。                  */
    tierDown: function () {
      tone('triangle', 659.25, 659.25, 0.09, 0.22, {});
      tone('triangle', 440, 440, 0.11, 0.20, { delay: 0.085 });
    },

    /** 「通缉令拉满」（ALARM=100，GDD-02 E6 有重复触发锁）：三连上行 + 三全音悬置 */
    alarmMax: function () {
      tone('square', 440, 440, 0.07, 0.24, { lp: 5200 });
      tone('square', 587.33, 587.33, 0.07, 0.24, { delay: 0.07, lp: 5200 });
      tone('square', 880, 880, 0.22, 0.26, { delay: 0.14, lp: 5200 });
      tone('sawtooth', 622.25, 622.25, 0.5, 0.08, { delay: 0.14, lp: 1400 });
      duck(0.24, 0.55);
    },

    /** QTE 每次有效输入：音高随进度**逐级上行**（每次 +1.5 半音）
     *  ⭐ 这是"还差几次"的听觉量表：玩家不看圆环也知道进度。 */
    thrash: function () {
      var f = 150 * Math.pow(2, mirror.qteStep * 1.5 / 12);
      mirror.qteStep++;
      noise(0.07, 0.18, { lp: 1600, hp: 300, hold: 0.012 });
      tone('square', f, f * 0.55, 0.09, 0.20, { lp: 3000 });
    },

    /** 搁浅预警（strandT ≥ 0.72s）：上行滑音 + 轻微失谐 → "不对劲" */
    sting: function () {
      tone('sawtooth', 220, 440, 0.40, 0.16, { lp: 1400 });
      tone('sine', 223, 446, 0.40, 0.09, { lp: 1400 });
    },

    /** 搁浅确认（enterBeached）：抽气声。带通从 1800 扫到 300 = 强调色被抽干 */
    beached: function () {
      noise(0.55, 0.24, { bp: 1800, q: 1.2, bpSweep: [1800, 300], hold: 0.10 });
      tone('sine', 90, 58, 0.45, 0.26, {});
      duck(0.12, 0.90);
    },

    /** ⭐ 系绳锁定开始：死亡倒计时的起点，必须是全场最刺的音之一 */
    tether: function () {
      tone('square', 1400, 1400, 0.05, 0.16, { lp: 6000 });
      tone('square', 1400, 1400, 0.05, 0.14, { delay: 0.085, lp: 6000 });
      tone('sawtooth', 1200, 380, 0.26, 0.20, { delay: 0.16, lp: 2600 });
      duck(0.28, 0.45);
      startRiser();
    },

    /** ⭐ 断线成功：与 tether **方向相反**（下行 vs 上行）+ 一声"叮" = 安全 */
    tetherBreak: function () {
      stopRiser(0.10);
      tone('sine', 600, 1400, 0.18, 0.22, {});
      tone('triangle', 1760, 1760, 0.14, 0.14, { delay: 0.10 });
    },

    /** ⭐ 捕食成功：核心动词的听觉具象化。低频"咔" + 水肉噪声 + 三角点缀 */
    bite: function () {
      tone('square', 160, 55, 0.16, 0.34, {});
      noise(0.22, 0.26, { lp: 900 });
      tone('triangle', 220, 180, 0.12, 0.14, { delay: 0.02 });
      duck(0.34, 0.20);
      mirror.carry = 1;
    },

    /** ⭐ Bank 结算：「落袋为安」。C-E-G 大三和弦琶音 + 解决的八度长音 */
    bank: function () {
      var seq = [523.25, 659.25, 783.99];
      for (var i = 0; i < seq.length; i++) {
        tone('triangle', seq[i], seq[i], 0.10, 0.24, { delay: i * 0.09 });
      }
      tone('triangle', 1046.5, 1046.5, 0.28, 0.22, { delay: 0.27 });
      tone('sine', 1567.98, 1567.98, 0.34, 0.06, { delay: 0.30 });   // 余韵
      duck(0.30, 0.50);
      mirror.carry = 0; mirror.collect = 0; qteReset(); stopRiser(0.08);
    },

    /** 脱困 / 冲刺自救：上行四度 G4→C5，**不解决**到长音（与 bank 区分） */
    rescued: function () {
      tone('triangle', 392, 392, 0.10, 0.24, {});
      tone('triangle', 523.25, 523.25, 0.20, 0.22, { delay: 0.10 });
      noise(0.20, 0.14, { lp: 2400, hp: 400, delay: 0.02 });
      qteReset();
    },

    /** 死亡：下扫 + 悬置的减五度（A3/D#4）→ 支柱二「押注全损 = 和弦不解决」 */
    death: function () {
      tone('sawtooth', 220, 45, 0.70, 0.30, { lp: 900 });
      noise(0.60, 0.16, { lp: 500 });
      tone('sine', 220, 220, 0.90, 0.06, { delay: 0.30 });
      tone('sine', 311.13, 311.13, 0.90, 0.05, { delay: 0.30 });
      duck(0.10, 1.20);
      stopRiser(0.05);
      qteReset();
      mirror.carry = 0; mirror.collect = 0;
    },

    /** 体力不足拒绝（GDD-03 E6 明确要求，此前遗漏）：短促下行两声 = "不行" */
    deny: function () {
      tone('square', 300, 300, 0.05, 0.13, { lp: 2000 });
      tone('square', 200, 200, 0.06, 0.12, { delay: 0.07, lp: 2000 });
    },

    /* ---------- P1 · 应该有 ---------- */

    /** ⭐ 收集物拾取（副循环）：音高随「本局已收集数」逐级上行（每个 +1.5 半音）。
     *  玩家不看 HUD 也能靠听知道这一趟攒了多少 —— 与 QTE 连打音同一套听觉量表逻辑。 */
    collect: function () {
      var f = 740 * Math.pow(2, Math.min(mirror.collect, 11) * 1.5 / 12);
      mirror.collect++;
      tone('triangle', f, f * 1.45, 0.10, 0.15, {});
      tone('sine', f * 2.0, f * 2.0, 0.07, 0.06, { delay: 0.05 });
    },

    /** 破水 / 冲刺起手：短水花 */
    splash: function () {
      noise(0.16, 0.15, { lp: 2600, hp: 500 });
      tone('sine', 300, 700, 0.10, 0.09, {});
    },

    /** 大破水（保留给 Standard 的 breach 演出） */
    breach: function () {
      noise(0.34, 0.24, { lp: 3200, hp: 300 });
      tone('sine', 220, 620, 0.18, 0.13, {});
    },

    /** DECOY BREACH 炸水：比 splash 大，但**层级低于捕食**（无低频冲击、无顿帧） */
    decoy: function () {
      noise(0.40, 0.26, { lp: 2400, hp: 200, hold: 0.06 });
      tone('sawtooth', 520, 180, 0.22, 0.16, { lp: 1800 });
      duck(0.38, 0.20);
    },

    /** 受击（浮标 / 渔网 / 漂浮垃圾）：锯齿下扫 + 闷噪声。
     *  ⚠️ 摩托艇撞击**不**走这里 —— 它掉战利品（最多 −300 分），
     *     必须与「撞到一块垃圾」听感不同，见下方 motorboat（审计 F3）。 */
    hit: function () {
      tone('sawtooth', 140, 70, 0.20, 0.24, { lp: 1200 });
      noise(0.16, 0.18, { lp: 700 });
    },

    /** ⭐ 摩托艇撞击（T2B）：**掉 1 个战利品**（最多 −300 分）+ 击退。
     *  与 hit 的音区 / 音色双拉开：金属方波下扫 + 带通「破碎」噪声扫描。
     *  玩家在冲浪高认知负荷下视线被遮，听觉是判断「我刚丢了什么」的主通道——
     *  支柱二「一局一押」的赌注兑现（GDD-03 §5.2 / 审计 F3）。 */
    motorboat: function () {
      tone('square', 620, 180, 0.16, 0.22, { lp: 3000 });
      tone('sawtooth', 300, 90, 0.18, 0.16, { delay: 0.03, lp: 1600 });
      noise(0.24, 0.20, { bp: 1200, q: 0.9, bpSweep: [1600, 400], hold: 0.05 });
      duck(0.26, 0.18);
    },

    /** T2+ 敌人登场预警（提前 0.8s）：两声方波警报 + 低频底 */
    lockWarn: function () {
      tone('square', 660, 660, 0.06, 0.16, { lp: 3000 });
      tone('square', 660, 660, 0.06, 0.14, { delay: 0.10, lp: 3000 });
      tone('sine', 110, 110, 0.20, 0.12, {});
    },

    /** UI 确认 */
    ui: function () {
      tone('square', 700, 700, 0.05, 0.16, { bus: busUi, lp: 4000 });
    },

    /* ---------- P2 · 可选（已在表中，尚未接线） ---------- */

    /** 诱饵命中：惊动音（GDD-02 §5.2）。需 game.js 在 decoyAt 返回 n>0 时调用 */
    decoyHit: function () {
      tone('square', 880, 1320, 0.10, 0.16, { lp: 5000 });
      noise(0.14, 0.12, { lp: 3000, hp: 800 });
    },

    /** 游客被叼：短促惊叫（喜剧，非惨叫）。GDD-03 §5.2。
     *  已在 game.js tryBite() 咬合命中后接线（审计 F4 修复）。 */
    yelp: function () {
      tone('square', 500, 900, 0.05, 0.10, { lp: 3000 });
      tone('square', 900, 400, 0.08, 0.09, { delay: 0.05, lp: 3000 });
    },

    /** 未兑现 COMBO 破碎（GDD-03 E2 告知义务）。当前由 death 覆盖 */
    comboBreak: function () {
      tone('triangle', 780, 300, 0.28, 0.14, {});
      noise(0.24, 0.10, { lp: 1800, hp: 400 });
    }

    /* ⛔ 诱饵**被免疫**时刻意**没有音效** —— GDD-02 §5.2 明令：
     *    「（刻意无音效）」「免疫反馈刻意做得平淡」。
     *    这是设计好的静默，不是遗漏。请勿补。                            */
  };

  /* ==================================================================
   * 8 · 对外接口（与旧版完全兼容）
   * ================================================================== */
  var lastAt = {};

  TL.Audio = {
    init: init,
    resume: resume,

    play: function (name) {
      if (!ready()) return;
      var f = SFX[name];
      if (!f) return;
      var gap = COOLDOWN[name];
      if (gap) {
        var t = ctx.currentTime;
        if (lastAt[name] !== undefined && t - lastAt[name] < gap) return;
        lastAt[name] = t;
      }
      try { f(); } catch (e) { /* 单个音效失败绝不影响游戏 */ }
    },

    /** 静音开关：20ms 斜坡（硬切会有 click）。静音后本模块只读不写。 */
    setMuted: function (m) {
      muted = !!m;
      if (!ctx || !master) return;
      var t = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, t + 0.02);
      } catch (e) { master.gain.value = muted ? 0 : MASTER_GAIN; }
      if (muted) stopRiser(0.05);
    },

    /** 全部立停（结算页 / 重开时用） */
    stopAll: function () {
      stopRiser(0.03);
      for (var i = live.length - 1; i >= 0; i--) drop(live[i]);
      qteReset();
    },

    /** 音乐层独立开关：真正切断调度（此前只调总线增益，调度器照旧发声）。 */
    setMusicEnabled: function (on) {
      MUS.musicOff = !on;
      if (busMusic && ctx) {
        try {
          busMusic.gain.setTargetAtTime(MUS.musicOff ? 0.0001 : BUS.MUSIC, ctx.currentTime, 0.1);
        } catch (e) { }
      }
    },

    /** 暂停/恢复：整条链挂起，而不是逐个淡出。
     *  tick() 在 ctx.state !== 'running' 时自行停摆，故恢复后不会有积压音符一起冲出。 */
    setSuspended: function (on) {
      if (!ctx) return;
      if (on) {
        stopRiser(0.05);
        if (ctx.state === 'running' && ctx.suspend) ctx.suspend();
      } else if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume();
      }
    },

    get muted() { return muted; }
  };
})();
