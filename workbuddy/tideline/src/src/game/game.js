/* =====================================================================
 * TIDELINE · game/game.js
 * 核心循环编排：ALARM → 系绳 → Bank → 咬合 / 死亡（GDD-02 E3 帧序仲裁）。
 *
 * 帧序（同帧多事件时）：
 *   ① 输入 → ② 鲨鱼移动（子步）→ ③ 敌人 / 系绳 → ④ ALARM
 *   → ⑤ Bank 前置条件 → ⑥ 咬合 / 死亡判定
 * 时序仲裁一律偏向玩家（GDD-02 E3）。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;

  var DEATH_PRIO = { beached: 3, tether: 2, harpoon: 1, other: 0 };

  /* 水深配色：明度阶梯 深海 8% → 沙滩 82%（美术圣经 §5.3.0） */
  var WATER_STOPS = [
    [0, [0.055, 0.098, 0.176]],
    [750, [0.075, 0.145, 0.247]],
    [1650, [0.114, 0.310, 0.435]],
    [2350, [0.153, 0.478, 0.545]],
    [2560, [0.196, 0.588, 0.604]]
  ];
  var SAND_DRY = [0.910, 0.773, 0.416];
  var SAND_WET = [0.520, 0.396, 0.180];

  function waterColorAt(x) {
    for (var i = 1; i < WATER_STOPS.length; i++) {
      if (x <= WATER_STOPS[i][0] || i === WATER_STOPS.length - 1) {
        var a = WATER_STOPS[i - 1], b = WATER_STOPS[i];
        var t = U.clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
        return [
          a[1][0] + (b[1][0] - a[1][0]) * t,
          a[1][1] + (b[1][1] - a[1][1]) * t,
          a[1][2] + (b[1][2] - a[1][2]) * t
        ];
      }
    }
    return WATER_STOPS[0][1];
  }

  var G = {
    time: 0, dtRaw: 0, running: false, over: false, paused: false,
    shark: null,
    alarm: 0, tier: 0, maxEventArmed: true,
    banked: 0, combo: 0, comboMax: 0, comboLost: 0,
    pendingScore: 0, pendingCount: 0,
    lostScore: 0, lostCount: 0,          // 本局累计损失（结算页如实告知，死亡后 pendingScore 会被清零，故必须单独记）
    bankT: 0,
    deathReason: '', deathPrio: -1,
    freeze: 0, desat: 0, desatTarget: 0, flash: 0, flashCol: [0, 0, 0],
    qte: { active: false, t: 0, need: 6, window: 2.5, count: 0, lastTap: -1 },
    cam: { x: 0, y: 0, tx: 0, ty: 0, shake: 0, sx: 0, sy: 0 },
    events: {}, toasts: [],
    dashPressed: false, hasDir: false, dirX: 1, dirY: 0,
    decoyFired: false,
    stats: { grabs: 0, banks: 0, deaths: 0, collects: 0 },
    opts: null
  };

  /* =================================================================
   * 生命周期
   * ================================================================= */
  function init(opts) {
    G.opts = opts;
    TL.World.build();
    G.shark = TL.Shark.create();
    reset();
  }

  function reset() {
    G.time = 0; G.over = false; G.running = true; G.paused = false;
    G.alarm = 0; G.tier = 0; G.maxEventArmed = true;
    G.banked = 0; G.combo = 0; G.comboMax = 0; G.comboLost = 0;
    G.pendingScore = 0; G.pendingCount = 0;
    G.lostScore = 0; G.lostCount = 0;
    G.bankT = 0;
    G.deathReason = ''; G.deathPrio = -1;
    G.freeze = 0; G.desat = 0; G.desatTarget = 0; G.flash = 0;
    lastFlashAt = -1e9;               // 屏闪限频闸门必须随局重置，否则新一局开局被压住
    G.qte.active = false; G.qte.count = 0; G.qte.t = 0;
    G.cam.x = 0; G.cam.y = 0; G.cam.shake = 0;
    G.toasts.length = 0;
    G.decoyFired = false;
    /* 本局统计必须逐局归零 —— 否则重开后「捕食/落袋次数」会叠加上一局 */
    G.stats.grabs = 0; G.stats.banks = 0; G.stats.deaths = 0; G.stats.collects = 0;
    G.events = {};
    TL.Shark.reset(G.shark);
    TL.Prey.reset(0);
    TL.Enemies.reset();
    TL.Pickups.reset(G);
    TL.FX.reset();
    G.cam.x = U.clamp(G.shark.x - C.DESIGN_W * 0.42, 0, C.WORLD_W - C.DESIGN_W);
  }

  /* =================================================================
   * ALARM（GDD-02 §3.1 / §3.2）
   * ================================================================= */
  function addAlarm(v) {
    G.alarm = U.clamp(G.alarm + v, 0, C.ALARM.MAX);
  }

  function updateAlarm(dt) {
    var s = G.shark, A = C.ALARM;
    var slope;
    if (s.state === 'beached') slope = A.SLOPE.BEACHED;
    else if (s.zone === C.ZONE.BEACH) slope = A.SLOPE.BEACH;
    else if (s.airborne) slope = A.SLOPE.AIRBORNE;
    else if (s.zone === C.ZONE.DEEP) {
      slope = (s.speed < A.STILL_SPEED) ? A.SLOPE.DEEP_STILL : A.SLOPE.DEEP_MOVING;
    } else if (s.zone === C.ZONE.SHALLOW) slope = A.SLOPE.SHALLOW;
    else slope = A.SLOPE.SURF;

    G.alarm = U.clamp(G.alarm + slope * dt, 0, A.MAX);

    /* 档位迟滞（🔒 安全要求：迟滞未实现 = 等效闪烁超标） */
    var t = G.tier;
    if (t < 3 && G.alarm >= A.UP[t]) { G.tier = t + 1; onTierChange(1); }
    else if (t > 0 && G.alarm < A.DOWN[t - 1]) { G.tier = t - 1; onTierChange(-1); }

    /* 「通缉令拉满」事件：重复触发锁（跌破 90 才重触发，GDD-02 E6） */
    if (G.alarm >= 100) {
      if (G.maxEventArmed) {
        G.maxEventArmed = false;
        triggerFlash(C.PAL.WHITE, 0.35);
        TL.Audio.play('alarmMax');       // 三连上行 + 三全音悬置，与普通升档区分
        G.addToast('通缉令拉满');
      }
    } else if (G.alarm < A.MAX_EVENT_REARM) {
      G.maxEventArmed = true;
    }
  }

  function onTierChange(dir) {
    TL.Audio.play(dir > 0 ? 'tierUp' : 'tierDown');
    triggerFlash(dir > 0 ? C.PAL.AMBER : C.PAL.PALE, 0.18);
    G.addToast((dir > 0 ? '↑ ' : '↓ ') + C.TIER_NAME[G.tier] + ' T' + G.tier);
  }

  /* =================================================================
   * 反馈（全部走「呼吸式」，禁用硬 on/off）
   * ================================================================= */
  /* 🔒 硬红线①统一闸门：全项目屏闪必须在**唯一出口**限频。
   *
   * 为什么必须放在这里，而不是各个调用点各自加冷却：
   *   实测超标场景（QA PH6-QA-002 ①c）—— 冲刺命中**救生员**时
   *   LIFEGUARD.danger = 2.0 → ALARM 一次 +40；updateAlarm 每帧只升一档，
   *   于是从 40 连续两帧各跨一次阈值（50 与 75），onTierChange 被调用两次、
   *   各闪一次，再叠加同帧的咬合闪 → 1 秒窗口内 **3 次屏闪**，超过项目自定的 ≤2。
   *   逐个调用点打补丁必然漏（本文件有 3 处调用点，未来还会加），
   *   所以在 triggerFlash 里统一用 C.FLASH_GAP 钳制间隔 —— 任何来源都绕不过去。
   *   FLASH_GAP = 0.51s ⟹ 任意 1 秒窗口至多 2 次闪，严格 ≤2Hz。
   *   注意：这里只压制**视觉**，音效与 toast 照常触发，不产生「无反馈死区」。 */
  var lastFlashAt = -1e9;
  function triggerFlash(hex, amount) {
    if (!G.opts || !G.opts.flash) return;      // 关闭「闪烁」→ 无全屏色闪
    if (G.time - lastFlashAt < C.FLASH_GAP) return;
    lastFlashAt = G.time;
    G.flashCol = U.hex2rgb(hex);
    G.flash = amount;
  }
  function triggerShake(px) {
    if (!G.opts || !G.opts.shake) return;
    if (px > G.cam.shake) G.cam.shake = px;
  }
  function triggerFreeze(sec) { if (sec > G.freeze) G.freeze = sec; }

  function addToast(text) {
    G.toasts.push({ text: text, t: 0 });
    if (G.toasts.length > 4) G.toasts.shift();
  }

  /* =================================================================
   * 咬合 / 捕食（GDD-03 §3.1）
   * ================================================================= */
  function tryBite(s) {
    if (s.carryK >= C.CARRY_MAX) return;
    if (!s.alive) return;
    var mb = TL.Shark.mouthBox(s);
    var p = TL.Prey.hit(mb);
    if (!p) return;

    var def = C.PREY[p.type.toUpperCase()] || C.PREY.SWIMMER;
    s.dashBites++;
    s.dashT = -1;
    s.dashCd = C.DASH.CD;             // 一次冲刺 = 一次押注，账本清晰
    s.biteT = C.BITE.DUR;
    s.carry.push(p.type);
    G.pendingScore += def.score;
    G.pendingCount++;
    G.combo += C.COMBO.PER_GRAB;
    if (G.combo > G.comboMax) G.comboMax = G.combo;
    G.stats.grabs++;
    addAlarm(C.ALARM.GRAB * def.danger);
    TL.Prey.consume(p);
    /* 游客被叼的短促惊叫（喜剧，非惨叫）—— GDD-03 §5.2。
     * 与 bite 的低频「咔」分层：bite 是**鲨鱼**的核心动词，yelp 是**猎物**的反应。
     * 此前 audio.js 定义了 yelp 却零调用点（死代码，审计 F4）。 */
    TL.Audio.play('yelp');

    /* 反馈四件套中，震屏与色闪有 0.5s 内部冷却（GDD-03 §5.3 安全裁决） */
    triggerFreeze(C.BITE.FREEZE);
    TL.FX.predation(p.x, p.y);
    TL.Audio.play('bite');
    if (s.shakeCd <= 0) {
      s.shakeCd = C.BITE.SHAKE_CD;
      triggerShake(C.BITE.SHAKE);
      triggerFlash(C.PAL.MAGENTA, 0.22);
    }
    addToast('+' + def.score + ' 未兑现 · ALARM +' + Math.round(C.ALARM.GRAB * def.danger));
  }

  /* =================================================================
   * DECOY BREACH（GDD-03 §3.4）
   * ================================================================= */
  function onSurfaceCross(s, x, y) {
    if (x < C.DECOY.MIN_X) return;             // 深海不触发（裁决 1）
    G.decoyFired = true;
    s.stamina = Math.max(0, s.stamina - C.DECOY.COST);   // 代价无条件（E5）
    addAlarm(C.ALARM.DECOY);
    TL.FX.splash(x, y, 26, U.hex2rgb(C.PAL.WHITE), 280);
    TL.FX.shockRing(x, y, 180);
    TL.Audio.play('decoy');
    var n = TL.Enemies.decoyAt(x, y);
    if (n > 0) TL.Audio.play('decoyHit');   // 惊动音：只有真的引到了才有
    addToast(n > 0 ? ('声东击西 · 重定向 ' + n + ' 个') : '声东击西 · 无目标（代价照付）');
    /* 反馈层级低于捕食：不给震屏、不给顿帧、不给洋红（裁决 3） */
  }

  /* =================================================================
   * 强制打断态（GDD-02 §3.4）
   * ================================================================= */
  function applyStun() {
    var s = G.shark;
    if (!s.alive || s.iframeT > 0) return;
    s.stunT = C.STUN_DUR;
    addAlarm(C.ALARM.CC_HIT);
    TL.Audio.play('hit');
    TL.FX.splash(s.x, s.y, 8, U.hex2rgb(C.PAL.PALE), 90);
    addToast('被浮标命中 · 眩晕 1.5s');
  }
  function applySnare() {
    var s = G.shark;
    if (!s.alive || s.iframeT > 0) return;
    s.snareT = C.SNARE_DUR;
    addAlarm(C.ALARM.CC_HIT);
    TL.Audio.play('hit');
    addToast('被渔网束缚 1.5s');
  }
  function applySlow() {
    var s = G.shark;
    if (s.slowT > 0) return;
    s.slowT = C.SLOWED.DUR;
    TL.Audio.play('hit');
    TL.FX.splash(s.x, s.y + 30, 6, U.hex2rgb(C.PAL.PALE), 70);
  }
  function jetskiHit(e) {
    var s = G.shark;
    if (s.iframeT > 0) return;
    if (s.carryK > 0) {
      var lost = s.carry.pop();
      var def = C.PREY[lost.toUpperCase()] || C.PREY.SWIMMER;
      G.pendingScore = Math.max(0, G.pendingScore - def.score);
      G.pendingCount = Math.max(0, G.pendingCount - 1);
      addToast('被摩托艇撞掉 1 个战利品');
    } else {
      addToast('被摩托艇撞击');
    }
    addAlarm(C.ALARM.JETSKI);
    s.iframeT = C.ENEMY.T2B.IFRAME;
    /* 摩托艇撞击掉 1 个战利品（最多 −300 分）→ 独立音色，
     * 与「撞到漂浮垃圾」的 hit 区分（GDD-03 §5.2 / 审计 F3）。 */
    TL.Audio.play('motorboat');
    triggerShake(4);
    // 击退 0.3s（用 Slow 复用实现，方向由玩家接管）
    s.slowT = Math.max(s.slowT, C.ENEMY.T2B.KNOCK);
  }

  /* =================================================================
   * 搁浅 / QTE（ADR-003 §2.4–§2.6）
   * ================================================================= */
  function enterBeached(s) {
    if (s.state === 'beached') return;
    s.state = 'beached';
    s.stunT = 0; s.snareT = 0;
    s.dashT = -1;
    G.decoyFired = false;

    /* E1：携带中搁浅 → 战利品掉落并立即判定为丢失，不可再拾取 */
    if (s.carryK > 0) {
      for (var i = 0; i < s.carryK; i++) {
        TL.FX.sandPuff(s.x - i * 24, s.y + 26, 6);
      }
      G.lostScore += G.pendingScore;
      G.lostCount += G.pendingCount;
      G.pendingScore = 0; G.pendingCount = 0;
      s.carry.length = 0;
      addToast('战利品全部散落沙上 · 不可再拾取');
    }

    var assist = G.opts && (G.opts.qteAssist || G.opts.reducedMotion);
    G.qte.active = true;
    G.qte.t = 0;
    G.qte.count = 0;
    G.qte.need = assist ? C.QTE_ASSIST.NEED : C.QTE.NEED;
    G.qte.window = assist ? C.QTE_ASSIST.WINDOW : C.QTE.WINDOW;
    G.qte.lastTap = -1;
    G.desatTarget = 1;                 // 「画面只剩灰与白」
    /* 搁浅确认音（抽气声，带通 1800→300Hz 扫描 = 「颜色被抽干」的听觉对应）。
     * 注意：预警音 'sting' 由 shark.js 在 strandWarn 时播放，二者语义不同，不可混用。 */
    TL.Audio.play('beached');
    TL.FX.sandPuff(s.x, s.y + 30, 14);
    triggerShake(3);
  }

  function updateQTE(dt, taps) {
    var q = G.qte;
    if (!q.active) return;
    q.t += dt;
    for (var i = 0; i < taps.length; i++) {
      var tt = taps[i] / 1000;
      if (q.lastTap < 0 || tt - q.lastTap >= C.QTE.MIN_INTERVAL) {
        q.lastTap = tt;
        q.count++;
        TL.Audio.play('thrash');
        TL.FX.sandPuff(G.shark.x + U.rr(-40, 40), G.shark.y + 30, 4);
        if (q.count >= q.need) { qteSuccess(); return; }
      }
    }
    if (q.t >= q.window) qteFail();
  }

  function qteSuccess() {
    var s = G.shark;
    G.qte.active = false;
    s.state = 'cruise';
    s.strandT = 0; s.strandWarn = false;
    G.desatTarget = 0;
    // 弹回水中（并立刻刷新区域与速率，避免脱困帧仍带着 beached 的 speed=0 被误判再次搁浅）
    s.x = Math.min(s.x - 300, TL.World.shoreX - 200);
    s.y = TL.World.waterLineY(s.x, G.time) + 90;
    s.theta = 180;
    s.zone = TL.World.zoneAt(s.x, s.zone);
    s.speed = C.V_CRUISE * C.CARRY_V(s.carryK);
    s.strandWarn = false;
    triggerFreeze(C.QTE.FREEZE);
    triggerShake(C.QTE.SHAKE);
    TL.FX.splash(s.x, s.y, 22, U.hex2rgb(C.PAL.WHITE), 220);
    TL.Audio.play('rescued');
    addToast('挣脱！空手弹回水中');
  }

  function qteFail() {
    G.qte.active = false;
    killShark('beached');
  }

  /* =================================================================
   * Bank（GDD-03 §3.6）
   * ================================================================= */
  function comboMult() {
    return Math.min(1 + C.COMBO.STEP * G.combo, C.COMBO.M_CAP);
  }

  function updateBank(dt) {
    var s = G.shark;
    if (!s.alive) { G.bankT = 0; return; }
    if (s.carryK <= 0) { G.bankT = 0; return; }

    var ok = s.zone === C.ZONE.DEEP
      && TL.Enemies.tetherCount() === 0
      && s.state !== 'beached' && s.state !== 'stunned' && s.state !== 'snared';
    if (ok) {
      G.bankT += dt;
      if (G.bankT >= C.BANK.DIGEST) doBank();
    }
    // E7：离开条件 → 中断但进度保留（不回零）
  }

  function doBank() {
    var s = G.shark;
    var m = comboMult();
    var k = s.carryK;
    var score = Math.round(G.pendingScore * m * C.BANK_B(k));
    G.banked += score;
    if (G.combo > G.comboMax) G.comboMax = G.combo;
    G.stats.banks++;
    s.carry.length = 0;
    G.pendingScore = 0; G.pendingCount = 0;
    G.combo = 0;
    G.alarm = 0; G.tier = 0; G.maxEventArmed = true;
    G.bankT = 0;
    TL.Audio.play('bank');
    triggerFlash(C.PAL.CYAN, 0.20);
    TL.FX.splash(s.x, s.y, 16, U.hex2rgb(C.PAL.CYAN), 160);
    for (var i = 0; i < 10; i++) {
      TL.FX.bubble(s.x + U.rr(-40, 40), s.y + U.rr(-30, 30));
    }
    addToast('落袋 +' + score + '（×' + m.toFixed(1) + '）');
  }

  /* =================================================================
   * 死亡（GDD-02 E5 优先级：QTE 失败 > 锁定 > 鱼叉）
   * ================================================================= */
  function killShark(reason) {
    var prio = DEATH_PRIO[reason] === undefined ? 0 : DEATH_PRIO[reason];
    if (G.over) return;
    var s = G.shark;
    if (!s.alive) return;
    s.alive = false;
    s.state = 'dead';
    G.over = true;
    G.deathReason = reason;
    G.deathPrio = prio;
    G.qte.active = false;
    G.comboLost = G.combo;               // 未兑现 COMBO（E2：必须明确告知）
    /* ⭐ 先记账再清零：pending 一旦归零，结算页就再也算不出玩家损失了多少 */
    G.lostScore += G.pendingScore;
    G.lostCount += G.pendingCount;
    G.pendingScore = 0; G.pendingCount = 0;
    G.combo = 0;
    G.desatTarget = 0.85;
    G.stats.deaths++;
    TL.Audio.play('death');
    triggerShake(8);
  }

  /* =================================================================
   * 主更新
   * ================================================================= */
  function update(dtRaw) {
    G.dtRaw = dtRaw;
    if (!G.running || G.paused) return;

    var dt = Math.min(dtRaw, C.DT_CLAMP);
    G.time += dt;

    /* 顿帧：只冻结逻辑推进，输入照常采集（ADR-003 §2.6） */
    if (G.freeze > 0) {
      G.freeze -= dtRaw;
    }

    /* 输入 */
    var IN = TL.Input;
    G.hasDir = IN.hasDir;
    G.dirX = IN.dirX; G.dirY = IN.dirY;
    var dash = IN.consumeDash();
    G.dashPressed = dash;
    var taps = IN.takeTaps();

    /* QTE 期间只跑 QTE */
    if (G.qte.active) {
      updateQTE(dt, taps);
      updateAlarm(dt);                   // 搁浅期间 ALARM 仍 +8/s（GDD-02 §3.1）
      TL.FX.update(dt);
      updateCamera(dt);
      updateFeedback(dt);
      return;
    }

    if (G.freeze <= 0 && !G.over) {
      var s = G.shark;

      /* ADR-003 §2.5：预警窗口内冲刺可自救（关键的技巧轴） */
      if (s.strandWarn && s.state !== 'beached' && dash && s.stamina >= 1) {
        s.stamina -= 1;
        s.strandT = 0; s.strandWarn = false;
        s.x -= 140;
        s.y = TL.World.waterLineY(s.x, G.time) + 90;
        s.theta = 180;
        TL.FX.splash(s.x, s.y, 16, U.hex2rgb(C.PAL.WHITE), 200);
        TL.Audio.play('rescued');
        addToast('冲刺脱困 −1 体力');
        G.dashPressed = false;
      }

      TL.Shark.update(s, dt, G);
      TL.Prey.update(dt, G);
      TL.Pickups.update(dt, G);        // 副循环：冲浪收集（原子计入 pending）
      TL.Enemies.spawnByTier(G.tier, G);
      TL.Enemies.update(dt, G);
      updateAlarm(dt);

      /* 接触判定（GDD-02 §3.4） */
      if (s.alive) {
        var hit = TL.Enemies.hitTestShark(s);
        if (hit && s.iframeT <= 0) {
          if (hit.kind === 'T1') applySlow();
          else if (hit.kind === 'T2B') jetskiHit(hit.e);
        }
      }

      updateBank(dt);
    } else {
      TL.Prey.update(dt * 0.2, G);
      TL.Pickups.update(dt * 0.2, G);   // 顿帧 / 死亡慢镜：随场景一起减速
    }

    TL.FX.update(dt);
    updateCamera(dt);
    updateFeedback(dt);

    for (var i = G.toasts.length - 1; i >= 0; i--) {
      G.toasts[i].t += dtRaw;
      if (G.toasts[i].t > 2.6) G.toasts.splice(i, 1);
    }
  }

  function updateCamera(dt) {
    var s = G.shark, cam = G.cam;
    if (G.qte.active || s.state === 'beached') {
      // ADR-003 §6.3 方案 A：相机缓推，鲨鱼落在水平 62% / 垂直 46%
      cam.tx = U.clamp(s.x - C.DESIGN_W * C.CAM.FOCUS_X, 0, C.WORLD_W - C.DESIGN_W);
      cam.ty = U.clamp(s.y - C.DESIGN_H * C.CAM.FOCUS_Y, C.CAM.Y_MIN, 0);
    } else {
      cam.tx = U.clamp(s.x - C.DESIGN_W * 0.42, 0, C.WORLD_W - C.DESIGN_W);
      cam.ty = 0;
    }
    var rate = (G.qte.active ? C.CAM.BEACH_PAN * 8 : C.CAM.LERP);
    cam.x = U.damp(cam.x, cam.tx, rate, dt);
    cam.y = U.damp(cam.y, cam.ty, rate, dt);

    if (cam.shake > 0.2) {
      cam.shake *= Math.pow(0.02, dt);
      cam.sx = (U.rand() * 2 - 1) * cam.shake;
      cam.sy = (U.rand() * 2 - 1) * cam.shake;
    } else { cam.shake = 0; cam.sx = 0; cam.sy = 0; }
  }

  function updateFeedback(dt) {
    G.desat = U.damp(G.desat, G.desatTarget, 6, dt);
    if (G.flash > 0) {
      G.flash -= dt * 2.2;
      if (G.flash < 0) G.flash = 0;
    }
  }

  /* =================================================================
   * 渲染
   * ================================================================= */
  function drawBackground(B) {
    var W = TL.World;
    var x0 = G.cam.x - 40, x1 = G.cam.x + C.DESIGN_W + 40;
    var yTop = G.cam.y - 420;
    var STEPX = 24;
    var i, x, col;

    /* 天空（黄昏带，明度自下而上递减） */
    var skyBands = 7;
    for (i = 0; i < skyBands; i++) {
      var t = i / (skyBands - 1);
      col = [
        0.055 + (0.180 - 0.055) * (1 - t),
        0.078 + (0.290 - 0.078) * (1 - t),
        0.145 + (0.420 - 0.145) * (1 - t)
      ];
      B.draw('dot1', (x0 + x1) / 2, yTop + (C.WATER_BASE - yTop) * (i / skyBands) + (C.WATER_BASE - yTop) / skyBands / 2,
        x1 - x0, (C.WATER_BASE - yTop) / skyBands + 2, { tint: col });
    }

    /* 太阳（ALARM 档位的冗余形态通道） */
    var sunSprite = G.tier >= 3 ? 'sun_siege' : (G.tier >= 1 ? 'sun_alert' : 'sun_calm');
    var sunX = 520 + G.cam.x * 0.06;                    // 视差 0.06
    B.draw(sunSprite, sunX, yTop + 90, 64, 52);

    /* 水体 + 海床 + 沙层（逐列） */
    for (x = Math.floor(x0 / STEPX) * STEPX; x <= x1; x += STEPX) {
      var wl = W.waterLineY(x, G.time);
      var sbY = W.seabedY(x);
      var wc = waterColorAt(x);

      if (sbY > wl) {
        B.draw('dot1', x + STEPX / 2, (wl + sbY) / 2, STEPX + 1, sbY - wl, { tint: wc });
      }
      // 沙层截面：水线以上为干沙（亮），以下为湿沙（暗）
      if (sbY < C.WORLD_BOTTOM) {
        var dryH = Math.max(0, wl - sbY);
        if (dryH > 0) B.draw('dot1', x + STEPX / 2, (sbY + wl) / 2, STEPX + 1, dryH, { tint: SAND_DRY });
        var wetH = C.WORLD_BOTTOM - Math.max(sbY, wl);
        if (wetH > 0) {
          B.draw('dot1', x + STEPX / 2, Math.max(sbY, wl) + wetH / 2, STEPX + 1, wetH, { tint: SAND_WET });
        }
      }
    }

    /* 深海光柱（Bank 区标记，形态通道） */
    var deepEdge = Math.min(750, x1);
    if (x0 < 750) {
      var bx0 = Math.max(x0, 0), bx1 = deepEdge;
      if (bx1 > bx0) {
        B.draw('dot1', (bx0 + bx1) / 2, 440, bx1 - bx0, 900,
          { tint: [0.10, 0.35, 0.55], fade: 0.16, bucket: 'add' });
        // 下坠箭头列：明确的「这里结算」
        for (i = 0; i < 6; i++) {
          B.draw('dot1', 360, 180 + i * 90 + Math.sin(G.time * 2 + i) * 12, 60, 4,
            { tint: [0.55, 0.85, 1.0], fade: 0.30, bucket: 'add' });
        }
      }
      // 深海边界虚线
      for (i = 0; i < 20; i++) {
        B.draw('dot1', 750, 120 + i * 38, 3, 20, { tint: [0.6, 0.75, 0.9], fade: 0.30 });
      }
    }

    /* 水面泡沫线 */
    for (x = Math.floor(x0 / 32) * 32; x <= x1; x += 32) {
      var w2 = W.waterLineY(x, G.time);
      var dep = W.depthAt(x);
      if (dep < 24) continue;
      B.draw('foam', x, w2, 32, 6, { fade: U.clamp(dep / 120, 0.15, 0.9) });
    }

    /* 深海光斑（低频视差装饰） */
    for (i = 0; i < 10; i++) {
      var rx = 140 + ((i * 337) % 700);
      var ry = 260 + ((i * 191) % 420);
      B.draw('dot1', rx + G.cam.x * 0.25, ry, 90 + (i % 3) * 40, 4,
        { tint: [0.35, 0.62, 0.85], fade: 0.10, bucket: 'add' });
    }
  }

  function drawQTERing(B) {
    var q = G.qte;
    var cx = C.DESIGN_W / 2, cy = C.DESIGN_H / 2;
    var t = U.clamp(q.t / q.window, 0, 1);
    var rad = U.lerp(C.QTE.RING_OUTER, C.QTE.RING_INNER, t);
    var prog = q.count / q.need;
    var mag = U.hex2rgb(C.PAL.MAGENTA);
    var wht = U.hex2rgb(C.PAL.WHITE);
    var N = 46;
    for (var i = 0; i < N; i++) {
      var a = (i / N) * U.TAU - Math.PI / 2;
      var px = cx + Math.cos(a) * rad;
      var py = cy + Math.sin(a) * rad;
      var seg = i / N;
      var col = seg <= prog ? mag : wht;
      var fade = seg <= prog ? 1 : 0.55;
      var sz = seg <= prog ? 8 : 5;
      B.draw('dot2', px, py, sz, sz, { tint: col, fade: fade, bucket: 'add' });
    }
    // 内环：剩余时间扇形（形态通道，灰度可读）
    var inner = C.QTE.RING_INNER - 26;
    var M = 30;
    for (var j = 0; j < M; j++) {
      if ((j / M) > (1 - t)) continue;
      var a2 = (j / M) * U.TAU - Math.PI / 2;
      B.draw('dot2', cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner, 6, 6,
        { tint: wht, fade: 0.7, bucket: 'add' });
    }
    // 目标刻度：每命中一针点亮一格
    for (var k = 0; k < q.need; k++) {
      var a3 = -Math.PI / 2 + (k / q.need) * U.TAU;
      var r3 = C.QTE.RING_OUTER + 22;
      B.draw('dot2', cx + Math.cos(a3) * r3, cy + Math.sin(a3) * r3, 10, 10,
        { tint: k < q.count ? mag : wht, fade: k < q.count ? 1 : 0.35, bucket: 'add' });
    }
  }

  function render(B, post, rt) {
    var gl = B.gl;
    var s = G.shark;

    /* --- 世界 pass → RT_WORLD(720x432) --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, rt.w, rt.h);
    gl.clearColor(0.039, 0.055, 0.090, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    B.begin('world', G.cam.x + G.cam.sx, G.cam.y + G.cam.sy);
    drawBackground(B);
    TL.Pickups.draw(B, G);
    TL.Prey.draw(B, G);
    TL.Enemies.draw(B, G);
    TL.Shark.draw(s, B, G);
    TL.FX.draw(B);
    B.flush();

    /* --- 后期 pass → 显示 (1440x864) --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    post.crt = G.opts.crt ? 1 : 0;
    post.scan = G.opts.crt ? 1.0 : 0.0;
    post.jitter = G.opts.jitter && !G.opts.reducedMotion ? 0.6 : 0.0;
    post.vig = 1.0;
    post.ca = G.opts.crt ? 1.5 : 0;
    post.desat = G.desat;
    post.flash = G.flash;
    post.flashCol = G.flashCol;
    post.danger = (G.tier >= 3 && !G.over) ? 1 : 0;
    post.time = G.time;
    post.draw(rt.tex, C.DESIGN_W, C.DESIGN_H);

    /* --- 叠加 pass：QTE 圆环是去饱和后画面上「唯一保留的颜色」 --- */
    if (G.qte.active) {
      B.begin('screen', 0, 0);
      drawQTERing(B);
      B.flush();
    }
  }

  /* 对外接口 */
  G.init = init;
  G.reset = reset;
  G.update = update;
  G.render = render;
  G.addToast = addToast;
  G.applyStun = applyStun;
  G.applySnare = applySnare;
  G.applySlow = applySlow;
  G.killShark = killShark;
  G.enterBeached = enterBeached;
  G.tryBite = tryBite;
  G.onSurfaceCross = onSurfaceCross;
  G.comboMult = comboMult;
  G.hardRestart = function () { reset(); };

  TL.Game = G;
})();
