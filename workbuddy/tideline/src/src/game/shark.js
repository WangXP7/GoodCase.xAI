/* =====================================================================
 * TIDELINE · game/shark.js
 * 鲨鱼状态机与运动（GDD-01）。
 *
 * 一句话模型：**速率由状态定、方向由玩家定**（GDD-01 §3.1）。
 * 玩家永远不能让鲨鱼停下来，只能改变它往哪儿走。
 * 允许速率为 0 的状态只有四个：Stunned / Snared / Beached / Dead。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U, W = TL.World;

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function create() {
    return {
      x: 380, y: 470, theta: 0, speed: 0,
      state: 'cruise',
      alive: true,

      carry: [],              // 战利品类型 id 数组
      get carryK() { return this.carry.length; },

      stamina: C.STAMINA_MAX,
      dashT: -1, dashCd: 0, dashTheta0: 0, dashBites: 0, dashFromY: 0,
      biteT: 0,
      stunT: 0, snareT: 0, slowT: 0, iframeT: 0,
      shakeCd: 0,
      surf: false,
      grounded: false, airborne: false,
      strandT: 0, strandWarn: false,
      zone: C.ZONE.DEEP,
      pendingScore: 0,
      frozenExternalTimers: false,
      trailAcc: 0,
      netSeed: 0
    };
  }

  function reset(s) {
    s.x = 380; s.y = 470; s.theta = 0; s.speed = 0;
    s.state = 'cruise'; s.alive = true;
    s.carry.length = 0;
    s.stamina = C.STAMINA_MAX;
    s.dashT = -1; s.dashCd = 0; s.dashBites = 0; s.dashFromY = 0;
    s.biteT = 0; s.stunT = 0; s.snareT = 0; s.slowT = 0; s.iframeT = 0;
    s.shakeCd = 0; s.surf = false; s.strandT = 0; s.strandWarn = false;
    s.pendingScore = 0; s.trailAcc = 0;
    s.zone = W.zoneAt(s.x, null);
  }

  /* ---- 派生量 ---- */
  function cruiseSpeed(s) { return C.V_CRUISE * C.CARRY_V(s.carryK); }
  function omegaOf(s) {
    return C.OMEGA_CRUISE * C.CARRY_W(s.carryK)
      * (s.surf ? C.SURF.OMEGA_MULT : 1)
      * (s.slowT > 0 ? C.SLOWED.OMEGA_MULT : 1);
  }
  function dashSpeed(t) {
    var D = C.DASH;
    if (t < D.WINDUP) return U.lerp(D.V_START, D.V_PEAK, t / D.WINDUP);
    if (t < D.CRUISE_END) return D.V_PEAK;
    var k = (t - D.CRUISE_END) / (D.TOTAL - D.CRUISE_END);
    return U.lerp(D.V_PEAK, D.V_END, U.clamp(k, 0, 1));
  }
  function dashCost(s) { return s.carryK > 0 ? C.DASH_COST_CARRY : C.DASH_COST_EMPTY; }

  function isZeroSpeedState(s) {
    return s.state === 'stunned' || s.state === 'snared' || s.state === 'beached' || s.state === 'dead';
  }

  /* =====================================================================
   * 主更新
   * ===================================================================== */
  function update(s, dt, G) {
    if (!W) W = TL.World;
    if (!s.alive) { s.state = 'dead'; s.speed = 0; return; }

    var t;
    if ((t = s.biteT) > 0) { s.biteT = t - dt; if (s.biteT < 0) s.biteT = 0; }
    if ((t = s.dashCd) > 0) { s.dashCd = t - dt; if (s.dashCd < 0) s.dashCd = 0; }
    if ((t = s.stunT) > 0) { s.stunT = t - dt; if (s.stunT < 0) { s.stunT = 0; s.iframeT = C.IFRAME_AFTER_CC; } }
    if ((t = s.snareT) > 0) { s.snareT = t - dt; if (s.snareT < 0) { s.snareT = 0; s.iframeT = C.IFRAME_AFTER_CC; } }
    if ((t = s.slowT) > 0) { s.slowT = t - dt; if (s.slowT < 0) s.slowT = 0; }
    if ((t = s.iframeT) > 0) { s.iframeT = t - dt; if (s.iframeT < 0) s.iframeT = 0; }
    if ((t = s.shakeCd) > 0) { s.shakeCd = t - dt; if (s.shakeCd < 0) s.shakeCd = 0; }

    /* ---- 状态判定（强制打断态优先，GDD-01 §3.3） ---- */
    if (s.stunT > 0) s.state = 'stunned';
    else if (s.snareT > 0) s.state = 'snared';
    else if (s.biteT > 0) s.state = 'bite';
    else if (s.dashT >= 0) s.state = 'dash';
    else if (s.state === 'beached') { /* QTE 期间不覆盖 */ }
    else s.state = 'cruise';

    if (s.state === 'beached') { s.speed = 0; return; }

    /* ---- 冲刺输入 ---- */
    var wantDash = G.dashPressed;
    if (wantDash && s.dashT < 0 && s.state === 'cruise' && s.dashCd <= 0) {
      var cost = dashCost(s);
      if (s.stamina >= cost) {
        s.stamina -= cost;
        s.dashT = 0;
        s.dashTheta0 = s.theta;
        s.dashBites = 0;
        s.dashFromY = s.y;
        s.state = 'dash';
        TL.Audio.play('splash');
        FXBurst(s, 6, C.PAL.PALE, 90);
      } else {
        G.events.staminaReject = true;      // GDD-03 E6：明确的失败反馈
        TL.Audio.play('deny');              // 短促下行两声 =「不行」（音频侧冗余通道）
      }
    }

    /* ---- 冲浪模式（GDD-01 §3.5） ---- */
    var wl = W.waterLineY(s.x, G.time);
    var nearWave = Math.abs(s.y - wl) <= C.SURF.BAND;
    var spdNow = (s.state === 'dash') ? dashSpeed(s.dashT) : C.V_CRUISE;
    var canSurf = s.zone === C.ZONE.SURF && nearWave
      && (spdNow * C.CARRY_V(s.carryK)) >= C.SURF.SPEED_FRAC * C.V_CRUISE * C.CARRY_V(s.carryK);
    if (s.surf !== canSurf) {
      s.surf = canSurf;
      if (canSurf) TL.Audio.play('splash');
    }

    /* ---- 速率（状态定） ---- */
    var base;
    if (s.state === 'dash') base = dashSpeed(s.dashT);
    else if (s.state === 'bite') base = C.V_CRUISE * 0.5;
    else base = C.V_CRUISE;
    var speed = base * C.CARRY_V(s.carryK)
      * (s.surf ? C.SURF.RATE_MULT : 1)
      * (s.slowT > 0 ? C.SLOWED.RATE_MULT : 1);
    if (s.state === 'stunned' || s.state === 'snared') speed = 0;

    /* ---- 方向（玩家定） ---- */
    var omega = omegaOf(s);
    if (s.state === 'dash') omega = C.DASH.OMEGA;
    if (s.state === 'stunned') omega = 0;

    if (s.state !== 'stunned' && G.hasDir) {
      var target = Math.atan2(G.dirY, G.dirX) * R2D;
      var d = U.angDelta(target, s.theta);
      var step = omega * dt;
      s.theta += U.clamp(d, -step, step);
      if (s.state === 'dash') {
        // 冲刺承诺：θ 限制在起手方向 ±25°
        var rel = U.angDelta(s.theta, s.dashTheta0);
        if (rel > C.DASH.CONE_DEG) s.theta = s.dashTheta0 + C.DASH.CONE_DEG;
        else if (rel < -C.DASH.CONE_DEG) s.theta = s.dashTheta0 - C.DASH.CONE_DEG;
      }
    }
    if (s.theta > 180) s.theta -= 360; else if (s.theta < -180) s.theta += 360;

    s.speed = speed;

    /* ---- 位移积分（GDD-01 E8：子步扫掠，防穿透） ---- */
    var vx = Math.cos(s.theta * D2R) * speed;
    var vy = Math.sin(s.theta * D2R) * speed;
    var dist = Math.sqrt(vx * vx + vy * vy) * dt;
    var steps = Math.max(1, Math.ceil(dist / C.MAX_SUBSTEP_PX));
    if (steps > 8) steps = 8;
    var sdt = dt / steps;

    for (var i = 0; i < steps; i++) {
      var prevY = s.y;
      s.x += vx * sdt;
      s.y += vy * sdt;
      clampToWorld(s, G);
      // 跨越水面线（仅上行）= DECOY BREACH（GDD-03 §3.4）
      if (s.state === 'dash' && !G.decoyFired) {
        var wlNow = W.waterLineY(s.x, G.time);
        if (prevY > wlNow && s.y <= wlNow) G.onSurfaceCross(s, s.x, wlNow);
      }
      // 咬合走子步（GDD-03 §3.1）
      if (s.state === 'dash' && s.dashBites < 1) G.tryBite(s);
    }

    /* ---- 冲刺推进 ---- */
    if (s.dashT >= 0) {
      s.dashT += dt;
      // 一次冲刺只可能触发一次 DECOY BREACH（跨子步保持，冲刺结束时复位）
      if (s.dashT >= C.DASH.TOTAL) { s.dashT = -1; s.dashCd = C.DASH.CD; G.decoyFired = false; }
    }

    /* ---- 体力回复（GDD-01 §4.3） ---- */
    var regen;
    if (s.surf) regen = C.REGEN.SURF;
    else if (s.zone === C.ZONE.DEEP) regen = C.REGEN.DEEP;
    else if (s.zone === C.ZONE.SHALLOW) regen = C.REGEN.SHALLOW;
    else regen = C.REGEN.BEACH;
    if (s.carryK > 0) regen *= C.REGEN_CARRY_MULT;
    if (s.slowT > 0) regen *= C.SLOWED.REGEN_MULT;
    s.stamina = Math.min(C.STAMINA_MAX, s.stamina + regen * dt);

    /* ---- 携带水花拖尾 L1（GDD-01 §4.2 表：6/10/14/18 粒子每秒） ---- */
    if (s.carryK > 0) {
      var rate = 2 + s.carryK * 4;
      s.trailAcc += rate * dt;
      while (s.trailAcc >= 1) {
        s.trailAcc -= 1;
        TL.FX.splash(s.x - Math.cos(s.theta * D2R) * 40, s.y - Math.sin(s.theta * D2R) * 40,
          1, U.hex2rgb(C.PAL.PALE), 60);
      }
    }

    /* ---- 搁浅累积（ADR-003 §2.4：速率越低累积越快） ---- */
    updateStranding(s, dt, G);
  }

  function clampToWorld(s, G) {
    var SH = C.SHARK;
    if (s.x < 0) { s.x = 0; }
    if (s.x > C.WORLD_W) { s.x = C.WORLD_W; }          // E7：硬边界，速率不降
    var ground = W.seabedY(s.x) - SH.HALF_H + SH.SINK;
    if (s.y > ground) s.y = ground;
    if (s.y < 30) s.y = 30;
    s.grounded = (s.y + SH.HALF_H) >= W.seabedY(s.x) - 8;
    s.airborne = s.y < W.waterLineY(s.x, G.time);
  }

  function updateStranding(s, dt, G) {
    var B = C.BEACH;
    // 区域每帧更新（迟滞）
    s.zone = W.zoneAt(s.x, s.zone);

    if (s.zone === C.ZONE.BEACH && s.grounded && s.speed < B.V_TH) {
      var rate = 1 - s.speed / B.V_TH;                 // ∈ (0,1]
      s.strandT += dt * rate;
    } else if (s.zone === C.ZONE.BEACH) {
      s.strandT -= dt * B.REC_IN;
    } else {
      s.strandT -= dt * B.REC_OUT;
    }
    s.strandT = U.clamp(s.strandT, 0, B.T_STRAND);

    if (s.strandT >= B.T_STRAND) {
      G.enterBeached(s);
    } else if (s.strandT >= B.T_WARN) {
      if (!s.strandWarn) {
        s.strandWarn = true;
        TL.Audio.play('sting');
        TL.FX.sandPuff(s.x, s.y + 30, 8);
        G.events.strandWarn = true;
      }
    } else {
      s.strandWarn = false;
    }
  }

  function FXBurst(s, n, colHex, power) {
    TL.FX.splash(s.x, s.y, n, U.hex2rgb(colHex), power);
  }

  /* =====================================================================
   * 绘制
   * ===================================================================== */
  function draw(s, B, G) {
    var SH = C.SHARK;
    var sprite = (s.state === 'bite') ? 'shark_bite' : 'shark';
    var flipU = Math.cos(s.theta * D2R) < 0;
    var rot = flipU ? (s.theta * D2R - Math.PI) : (s.theta * D2R);
    if (s.surf) rot += Math.sin(G.time * 7) * 0.10;

    var tint = [1, 1, 1];
    if (s.state === 'dash') { tint = [0.72, 0.95, 1.35]; }      // 电光蓝 tint
    if (s.slowT > 0) { tint = [0.75, 0.85, 1.0]; }
    if (s.state === 'stunned') { tint = [0.85, 0.85, 1.05]; }
    if (s.iframeT > 0) {
      // 呼吸式（≤2Hz），绝不硬 on/off
      var b = U.breath(G.time, 2);
      var k = 0.65 + 0.5 * b;
      tint = [tint[0] * k, tint[1] * k, tint[2] * k];
    }
    if (!s.alive) { tint = [0.55, 0.58, 0.66]; }

    var visY = s.y + (s.carryK > 0 ? 6 : 0);        // 携带时下沉 6px（GDD-03 §5.4）
    var visRot = rot + (s.carryK > 0 ? -8 * D2R * (flipU ? -1 : 1) : 0);  // 头上仰 8°

    // 图集含 8 art px 外扩留白（3px 描边用），故按 (HALF+ PAD) 绘制；
    // 本体视觉尺寸仍为 84x40 art px（(42+8)*2*2=200 中本体占 168）——不变。
    var pad = SH.DRAW_PAD || 0;
    B.draw(sprite, s.x, visY,
      (SH.DRAW_HALF_W + pad) * 2 * C.ART_SCALE,
      (SH.DRAW_HALF_H + pad) * 2 * C.ART_SCALE,
      { rot: visRot, flipU: flipU, flipV: !s.alive, tint: tint });

    /* 携带的战利品（数得出来的冗余通道） */
    for (var i = 0; i < s.carryK; i++) {
      var off = 52 + i * 26;
      var cxp = s.x - Math.cos(s.theta * D2R) * off;
      var cyp = s.y - Math.sin(s.theta * D2R) * off + 22;
      B.draw('carried', cxp, cyp, 24, 24, {
        rot: Math.sin(G.time * 14 + i) * 0.35,
        flipU: flipU
      });
    }

    /* 渔网（Snared 的形态通道，不依赖颜色） */
    if (s.state === 'snared') {
      var nw = SH.LEN * 0.9, nh = 100;
      for (var g = 0; g <= 4; g++) {
        var fy = s.y - nh / 2 + (nh * g / 4);
        B.draw('dot1', s.x, fy, nw, 3, { tint: [0.78, 0.81, 0.85], fade: 0.95 });
        var fx = s.x - nw / 2 + (nw * g / 4);
        B.draw('dot1', fx, s.y, 3, nh, { tint: [0.78, 0.81, 0.85], fade: 0.95 });
      }
    }

    /* 眩晕：头顶旋转星（形态通道） */
    if (s.state === 'stunned') {
      for (var k2 = 0; k2 < 3; k2++) {
        var a = G.time * 4 + k2 * (U.TAU / 3);
        B.draw('dot2', s.x + Math.cos(a) * 34, s.y - 52 + Math.sin(a) * 10,
          8, 8, { tint: U.hex2rgb(C.PAL.AMBER) });
      }
    }

    /* 搁浅预警：尾部拖沙（ADR-003 §2.5） */
    if (s.strandWarn && s.state !== 'beached') {
      if (Math.random() < 0.5) TL.FX.sandPuff(s.x - Math.cos(s.theta * D2R) * 60, s.y + 30, 2);
    }
  }

  TL.Shark = {
    create: create, reset: reset, update: update, draw: draw,
    cruiseSpeed: cruiseSpeed, dashCost: dashCost, isZeroSpeedState: isZeroSpeedState,
    mouthBox: function (s) {
      return {
        x: s.x + Math.cos(s.theta * D2R) * C.SHARK.MOUTH_OFF,
        y: s.y + Math.sin(s.theta * D2R) * C.SHARK.MOUTH_OFF,
        w: C.SHARK.MOUTH_W, h: C.SHARK.MOUTH_H
      };
    }
  };
})();
