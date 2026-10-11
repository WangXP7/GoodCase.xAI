/* =====================================================================
 * TIDELINE · game/entities.js
 * 猎物（泳客/冲浪者/日光浴者/救生员）与敌人（T1/T2a/T2b/T3b）。
 *
 * 免疫判据（🔴 执行级约束，GDD-02 §3.6 / GDD-03 §3.5）：
 *   免疫 = **有系绳**（!has_tether 才受影响），
 *   不是「在空中」也不是「T3/T4」。直升机与 T4 恒带系绳 → 恒免疫。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;

  /* =================================================================
   * 猎物
   * ================================================================= */
  var PREY_TARGET = 16;
  var prey = [];

  function preySurfaceY(p, t) {
    var W = TL.World;
    if (p.type === 'sunbather') return W.seabedY(p.x) - 12;
    if (p.type === 'lifeguard') return W.seabedY(p.x) - 30;
    return W.waterLineY(p.x, t) + (p.type === 'surfer' ? 0 : 14);
  }

  function spawnPrey(type, t) {
    var W = TL.World;
    var x, p;
    if (type === 'sunbather') x = U.rr(2590, 2970);
    else if (type === 'lifeguard') x = U.rr(2600, 2940);
    else if (type === 'surfer') x = U.rr(1720, 2440);
    else x = U.rr(880, 1620);
    p = {
      type: type, x: x, y: 0, alive: true, t: U.rand() * 6,
      dir: U.rand() < 0.5 ? -1 : 1, respawn: 0, panic: 0
    };
    p.y = preySurfaceY(p, t);
    prey.push(p);
    return p;
  }

  function preyReset(t) {
    prey.length = 0;
    var plan = ['swimmer', 'swimmer', 'swimmer', 'surfer', 'surfer', 'swimmer', 'surfer', 'sunbather'];
    for (var i = 0; i < PREY_TARGET; i++) {
      var type = plan[i % plan.length];
      if (i === 5 || i === 11) type = 'lifeguard';
      spawnPrey(type, t || 0);
    }
  }

  function preyUpdate(dt, G) {
    var W = TL.World;
    for (var i = 0; i < prey.length; i++) {
      var p = prey[i];
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          var type = U.pick(['swimmer', 'swimmer', 'surfer', 'surfer', 'sunbather', 'sunbather', 'lifeguard']);
          spawnPrey(type, G.time);
          prey.splice(i, 1); i--;
        }
        continue;
      }
      p.t += dt;
      if (p.panic > 0) p.panic -= dt;

      if (p.type === 'swimmer') {
        p.x += Math.sin(p.t * 0.5) * 8 * dt;
      } else if (p.type === 'surfer') {
        p.x += 22 * dt * (p.x < 2480 ? 1 : -1);
      } else if (p.type === 'lifeguard') {
        p.x += p.dir * 26 * dt;
        if (p.x > 2950) p.dir = -1; else if (p.x < 2590) p.dir = 1;
      }
      p.x = U.clamp(p.x, 860, 2980);
      p.y = preySurfaceY(p, G.time);

      /* 鲨鱼靠近 → 惊慌（黑色喜剧：滑稽不惨烈） */
      var dx = p.x - G.shark.x, dy = p.y - G.shark.y;
      if (dx * dx + dy * dy < 190 * 190) {
        p.panic = 0.6;
        if (p.type === 'swimmer') p.x += (dx > 0 ? 34 : -34) * dt;
      }
    }
  }

  function preyBox(p) {
    if (p.type === 'sunbather') return { x: p.x, y: p.y, w: 56, h: 32 };
    return { x: p.x, y: p.y, w: 32, h: 56 };
  }

  /* 嘴部命中检测，返回被咬中的猎物 */
  function preyHit(mb) {
    for (var i = 0; i < prey.length; i++) {
      var p = prey[i];
      if (!p.alive) continue;
      var b = preyBox(p);
      if (U.aabb(mb.x, mb.y, mb.w, mb.h, b.x, b.y, b.w, b.h)) return p;
    }
    return null;
  }

  function preyConsume(p) { p.alive = false; p.respawn = U.rr(4.5, 9); }

  function preyDraw(B, G) {
    for (var i = 0; i < prey.length; i++) {
      var p = prey[i];
      if (!p.alive) continue;
      var bob = (p.type === 'sunbather' || p.type === 'lifeguard')
        ? Math.round(Math.sin(p.t * 2) * 1)
        : Math.round(Math.sin(p.t * 2.4) * 3);
      var sprite = p.type;
      var w = 24, h = 36;
      if (p.type === 'surfer') { w = 40; h = 32; }
      if (p.type === 'sunbather') { w = 40; h = 20; }
      if (p.type === 'lifeguard') { w = 24; h = 34; }
      B.draw(sprite, p.x, p.y + bob, w, h, {
        flipU: (p.type === 'lifeguard' || p.type === 'swimmer') ? p.dir < 0 : false,
        rot: p.panic > 0 ? Math.sin(p.t * 26) * 0.14 : 0
      });
      /* 惊慌：头顶「!」—— 形态通道，不依赖颜色 */
      if (p.panic > 0) {
        B.draw('dot2', p.x, p.y - 44, 4, 12, { tint: U.hex2rgb(C.PAL.AMBER) });
        B.draw('dot2', p.x, p.y - 30, 4, 4, { tint: U.hex2rgb(C.PAL.AMBER) });
      }
    }
  }

  /* =================================================================
   * 敌人
   * ================================================================= */
  var enemies = [];
  var warns = [];
  var projectiles = [];
  var spawnTimers = { T2B: 0, T3B: 0 };
  var towersPlaced = false;

  function resetEnemies() {
    enemies.length = 0; warns.length = 0; projectiles.length = 0;
    spawnTimers.T2B = 0; spawnTimers.T3B = 0; towersPlaced = false;
  }

  function countKind(k) {
    var n = 0;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].kind === k) n++;
    return n;
  }
  function tetherCount() {
    var n = 0;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].hasTether) n++;
    return n;
  }

  function addWarn(kind, x, y) {
    warns.push({ kind: kind, x: x, y: y, t: C.ENEMY.WARN_LEAD });
    TL.Audio.play('lockWarn');
  }

  function placeTowers() {
    if (towersPlaced) return;
    towersPlaced = true;
    var xs = [2660, 2890];
    for (var i = 0; i < xs.length; i++) {
      enemies.push({
        kind: 'T2A', x: xs[i], y: TL.World.seabedY(xs[i]) - 52,
        cd: U.rr(0.6, 2.2), telegraph: 0, hasTether: false,
        decoyT: 0, immuneFlash: 0, life: 0, static: true
      });
    }
  }

  function spawnByTier(tier, G) {
    var E = C.ENEMY;
    if (tier >= 1) placeTowers();

    if (tier >= 2) {
      spawnTimers.T2B -= G.dtRaw;
      if (spawnTimers.T2B <= 0 && countKind('T2B') < E.CAPS.T2B && enemies.length < E.HARD_CAP) {
        spawnTimers.T2B = 5.0;
        addWarn('T2B', C.WORLD_W - 20, G.shark.y);
        enemies.push({
          kind: 'T2B', x: C.WORLD_W + 60, y: U.clamp(G.shark.y, 140, 780),
          vx: -E.T2B.SPEED, hasTether: false, decoyT: 0, immuneFlash: 0,
          life: 0, wake: 0
        });
      }
    }
    if (tier >= 3) {
      spawnTimers.T3B -= G.dtRaw;
      if (spawnTimers.T3B <= 0 && countKind('T3B') < E.CAPS.T3B) {
        spawnTimers.T3B = 8.0;
        addWarn('T3B', C.WORLD_W - 40, C.ENEMY.T3B.ALT);
        enemies.push({
          kind: 'T3B', x: C.WORLD_W + 80, y: C.ENEMY.T3B.ALT,
          vx: -C.ENEMY.T3B.SPEED, hasTether: true, tLock: 0, breakProg: 0,
          state: 'lock', searchT: 0, lastKnown: G.shark.x,
          decoyT: 0, immuneFlash: 0, life: 0
        });
        TL.Audio.play('tether');
      }
    }
    // T1 漂浮垃圾：全域常驻少量（非「单位」，不参与诱饵）
    if (countKind('T1') < E.CAPS.T1 && U.rand() < 0.6 * G.dtRaw) {
      var x = U.rr(900, 2500);
      enemies.push({
        kind: 'T1', x: x, y: TL.World.waterLineY(x, G.time) + U.rr(10, 40),
        vx: U.rr(-30, 30), spin: U.rr(-1, 1), hasTether: false,
        variant: U.rand() < 0.5 ? 'tire' : 'crate', life: 0, decoyT: 0
      });
    }
  }

  function updateEnemies(dt, G) {
    var E = C.ENEMY, W = TL.World, s = G.shark;

    for (var i = warns.length - 1; i >= 0; i--) {
      warns[i].t -= dt;
      if (warns[i].t <= 0) warns.splice(i, 1);
    }

    for (var k = enemies.length - 1; k >= 0; k--) {
      var e = enemies[k];
      e.life += dt;
      if (e.decoyT > 0) e.decoyT -= dt;
      if (e.immuneFlash > 0) e.immuneFlash -= dt;

      if (e.kind === 'T1') {
        e.x += e.vx * dt;
        var wly = W.waterLineY(e.x, G.time);
        e.y = wly + 24 + Math.sin(G.time * 1.4 + e.x * 0.01) * 4;
        if (e.x < 820 || e.x > 2600) e.vx *= -1;
        if (e.decoyT > 0) { /* 非单位，诱饵不影响 */ }

      } else if (e.kind === 'T2A') {
        if (e.decoyT > 0) { e.telegraph = 0; continue; }
        e.cd -= dt;
        if (e.telegraph > 0) {
          e.telegraph -= dt;
          if (e.telegraph <= 0) fireBuoy(e, G);
        } else if (e.cd <= 0) {
          var dx = s.x - e.x, dy = s.y - e.y;
          if (dx * dx + dy * dy < E.T2A.RANGE * E.T2A.RANGE) {
            e.telegraph = E.T2A.TELEGRAPH;
          } else {
            e.cd = 0.4;
          }
        }

      } else if (e.kind === 'T2B') {
        if (e.decoyT > 0) {
          var tx = e.decoyX - e.x;
          e.x += U.clamp(tx, -E.T2B.SPEED * dt, E.T2B.SPEED * dt);
          e.y = U.damp(e.y, e.decoyY, 3, dt);
        } else {
          e.x += e.vx * dt;
          e.y = U.damp(e.y, U.clamp(s.y, 130, 800), 1.2, dt);
        }
        e.wake -= dt;
        if (e.wake <= 0) { e.wake = 0.05; TL.FX.splash(e.x + 20, e.y + 16, 1, U.hex2rgb(C.PAL.WHITE), 40); }
        if (e.x < 780 || e.life > 22) { enemies.splice(k, 1); continue; }

      } else if (e.kind === 'T3B') {
        updateHeli(e, dt, G, k);
      }
    }

    /* 投射物（救生员浮标） */
    for (var j = projectiles.length - 1; j >= 0; j--) {
      var pr = projectiles[j];
      pr.t += dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      pr.rot += dt * 6;
      if (pr.t > pr.dur || pr.x < 700 || pr.x > C.WORLD_W) {
        projectiles.splice(j, 1); continue;
      }
      var mb = { x: pr.x, y: pr.y, w: 20, h: 20 };
      var sb = { x: s.x, y: s.y, w: C.SHARK.HALF_W * 2, h: C.SHARK.HALF_H * 2 };
      if (s.alive && s.iframeT <= 0 && U.aabb(mb.x, mb.y, mb.w, mb.h, sb.x, sb.y, sb.w, sb.h)) {
        projectiles.splice(j, 1);
        G.applyStun();
      }
    }
  }

  function fireBuoy(e, G) {
    var s = G.shark;
    var dx = s.x - e.x, dy = s.y - e.y;
    var d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    var sp = d / C.ENEMY.T2A.FLIGHT;
    projectiles.push({
      x: e.x, y: e.y - 18, vx: dx / d * sp, vy: dy / d * sp,
      t: 0, dur: C.ENEMY.T2A.FLIGHT + 0.6, rot: 0
    });
    e.cd = C.ENEMY.T2A.INTERVAL;
  }

  function updateHeli(e, dt, G, idx) {
    var T = C.TETHER, W = TL.World, s = G.shark;
    var depth = s.y - W.waterLineY(s.x, G.time);
    var observable = !(s.x < T.DEEP_X && depth > T.DEEP_DEPTH);

    if (e.decoyT > 0) {
      e.x = U.damp(e.x, e.decoyX, 2.2, dt);
      e.y = U.damp(e.y, C.ENEMY.T3B.ALT, 2, dt);
    } else if (e.state === 'lock') {
      e.x = U.damp(e.x, U.clamp(s.x + 40, 800, C.WORLD_W), 1.1, dt);
      e.y = U.damp(e.y, C.ENEMY.T3B.ALT, 2, dt);
    } else {
      e.x = U.damp(e.x, e.lastKnown + Math.sin(G.time * 0.9) * 180, 1.0, dt);
      e.y = U.damp(e.y, C.ENEMY.T3B.ALT, 2, dt);
    }

    if (e.state === 'lock') {
      if (observable) {
        e.tLock += dt; e.breakProg = 0;
        e.lastKnown = s.x;
        if (e.tLock >= T.LOCK) G.killShark('tether');
      } else {
        e.breakProg += dt / T.BREAK;
        if (e.breakProg >= 1) {
          e.state = 'search'; e.searchT = 0; e.tLock = 0; e.breakProg = 0;
          e.hasTether = false;                 // 断线后 → 受诱饵影响
          TL.Audio.play('tetherBreak');
          TL.FX.splash(e.x, e.y + 40, 10, U.hex2rgb(C.PAL.WHITE), 120);
          G.addToast('系绳断裂');
        }
      }
    } else {
      e.searchT += dt;
      if (observable) {
        e.state = 'lock'; e.hasTether = true; e.tLock = 0;
        TL.Audio.play('tether');
        G.addToast('重新锁定');
      } else if (e.searchT >= T.SEARCH) {
        enemies.splice(idx, 1);
      }
    }
  }

  /* DECOY BREACH 目标筛选（GDD-02 §3.6） */
  function decoyAt(bx, by) {
    var list = [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.kind === 'T1') continue;
      if (e.hasTether) { e.immuneFlash = 0.7; continue; }        // ⭐ 免疫判据
      var d = Math.sqrt(U.dist2(e.x, e.y, bx, by));
      if (d <= C.DECOY.RADIUS) list.push({ e: e, d: d });
    }
    list.sort(function (a, b) { return a.d - b.d; });
    var n = Math.min(C.DECOY.MAX_TARGETS, list.length);
    for (var k = 0; k < n; k++) {
      var t = list[k].e;
      t.decoyT = C.DECOY.STALL;
      t.decoyX = bx; t.decoyY = by;
    }
    return n;
  }

  /* 与鲨鱼的接触判定（碰撞在 game.js 调用，效果在此施加） */
  function hitTestShark(s) {
    var sb = { x: s.x, y: s.y, w: C.SHARK.HALF_W * 2, h: C.SHARK.HALF_H * 2 };
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var eb = enemyBox(e);
      if (!U.aabb(sb.x, sb.y, sb.w, sb.h, eb.x, eb.y, eb.w, eb.h)) continue;
      if (e.kind === 'T1') return { kind: 'T1', e: e };
      if (e.kind === 'T2B' && e.decoyT <= 0) return { kind: 'T2B', e: e };
    }
    return null;
  }

  function enemyBox(e) {
    if (e.kind === 'T1') return { x: e.x, y: e.y, w: 34, h: 26 };
    if (e.kind === 'T2A') return { x: e.x, y: e.y, w: 52, h: 60 };
    if (e.kind === 'T2B') return { x: e.x, y: e.y, w: 72, h: 32 };
    return { x: e.x, y: e.y, w: 92, h: 36 };
  }

  function enemyDraw(B, G) {
    var W = TL.World;
    /* 预警箭头（T2+ 提前 0.8s，形态 + 位置双通道） */
    for (var w = 0; w < warns.length; w++) {
      var wn = warns[w];
      var a = U.breath(G.time, 2);
      var ax2 = U.clamp(wn.x, 40, C.WORLD_W - 40);
      for (var r = 0; r < 5; r++) {
        B.draw('dot2', ax2 - r * 10, wn.y - 20 + r * 10, 8, 8,
          { tint: U.hex2rgb(C.PAL.AMBER), fade: a, bucket: 'add' });
        B.draw('dot2', ax2 - r * 10, wn.y + 20 - r * 10, 8, 8,
          { tint: U.hex2rgb(C.PAL.AMBER), fade: a, bucket: 'add' });
      }
    }

    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.kind === 'T1') {
        B.draw(e.variant, e.x, e.y, e.variant === 'tire' ? 34 : 30,
          e.variant === 'tire' ? 26 : 24, { rot: G.time * e.spin * 0.6 });
      } else if (e.kind === 'T2A') {
        B.draw('tower', e.x, e.y, 52, 60);
        if (e.telegraph > 0) {
          var a2 = U.breath(G.time, 2);
          B.draw('buoy', e.x, e.y - 34 - (1 - e.telegraph / C.ENEMY.T2A.TELEGRAPH) * 10, 20, 20,
            { tint: U.hex2rgb(C.PAL.AMBER), fade: a2 });
        }
      } else if (e.kind === 'T2B') {
        B.draw('jetski', e.x, e.y, 72, 32, { flipU: true });
      } else if (e.kind === 'T3B') {
        drawHeli(B, G, e);
      }
      /* 诱饵状态标记：! 命中 / ✕ 免疫 —— 形状通道，灰度可辨 */
      if (e.decoyT > 0) {
        B.draw('dot2', e.x, e.y - 56, 5, 16, { tint: U.hex2rgb(C.PAL.BLOOD) });
        B.draw('dot2', e.x, e.y - 38, 5, 5, { tint: U.hex2rgb(C.PAL.BLOOD) });
      } else if (e.immuneFlash > 0) {
        var f = U.clamp(e.immuneFlash / 0.7, 0, 1);
        for (var q = 0; q < 5; q++) {
          B.draw('dot2', e.x - 8 + q * 4, e.y - 58 + q * 4, 5, 5, { tint: U.hex2rgb(C.PAL.WHITE), fade: f });
          B.draw('dot2', e.x + 8 - q * 4, e.y - 58 + q * 4, 5, 5, { tint: U.hex2rgb(C.PAL.WHITE), fade: f });
        }
      }
    }

    for (var j = 0; j < projectiles.length; j++) {
      var pr = projectiles[j];
      B.draw('buoy', pr.x, pr.y, 20, 20, { rot: pr.rot });
    }
  }

  function drawHeli(B, G, e) {
    var s = G.shark;
    B.draw('heli', e.x, e.y, 92, 36, { flipU: e.vx < 0 });
    // 旋翼（运动模糊：两条横线交替）
    var ph = Math.sin(G.time * 40) > 0;
    B.draw('dot1', e.x, e.y - 8 + (ph ? 0 : 2), 86, 3, { tint: [0.7, 0.75, 0.85], fade: 0.8 });

    // 探照灯锥（形态通道，非颜色唯一）
    if (e.state === 'lock') {
      var a = U.breath(G.time, 1.5);
      for (var r = 0; r < 9; r++) {
        var t = r / 8;
        var cy = e.y + 18 + t * (s.y - e.y - 18);
        var halfW = 8 + t * 46;
        B.draw('dot2', e.x - halfW, cy, 4, 4, { tint: U.hex2rgb(C.PAL.AMBER), fade: 0.10 + a * 0.10, bucket: 'add' });
        B.draw('dot2', e.x + halfW, cy, 4, 4, { tint: U.hex2rgb(C.PAL.AMBER), fade: 0.10 + a * 0.10, bucket: 'add' });
      }
      // 系绳（唯一连接两实体的线 = 形态通道）
      var lockT = e.tLock / C.TETHER.LOCK;
      var br = U.breath(G.time, 1 + lockT);       // 1 → 2Hz（≤2，硬红线）
      var dx = s.x - e.x, dy = s.y - (e.y + 18);
      var len = Math.sqrt(dx * dx + dy * dy);
      var segs = Math.max(6, Math.round(len / 22));
      var jitterAmp = lockT > 0.5 ? 3 : 1.5;
      for (var i = 0; i <= segs; i++) {
        var tt = i / segs;
        var jx = (i > 0 && i < segs) ? (U.rand() - 0.5) * jitterAmp : 0;
        B.draw('dot2', e.x + dx * tt + jx, e.y + 18 + dy * tt,
          4, 4, { tint: U.hex2rgb(C.PAL.BLOOD), fade: 0.35 + br * 0.45, bucket: 'add' });
      }
      // 端点准星
      var cs = 14 + (1 - lockT) * 10;
      B.draw('dot1', s.x, s.y - cs, cs, 2, { tint: U.hex2rgb(C.PAL.BLOOD), fade: br });
      B.draw('dot1', s.x, s.y + cs, cs, 2, { tint: U.hex2rgb(C.PAL.BLOOD), fade: br });
      B.draw('dot1', s.x - cs, s.y, 2, cs, { tint: U.hex2rgb(C.PAL.BLOOD), fade: br });
      B.draw('dot1', s.x + cs, s.y, 2, cs, { tint: U.hex2rgb(C.PAL.BLOOD), fade: br });
    } else {
      // `?` 搜索态（已断线 → 受诱饵影响）
      B.draw('dot2', e.x, e.y - 40, 4, 12, { tint: U.hex2rgb(C.PAL.PALE) });
      B.draw('dot2', e.x + 6, e.y - 34, 4, 4, { tint: U.hex2rgb(C.PAL.PALE) });
      B.draw('dot2', e.x + 2, e.y - 24, 4, 4, { tint: U.hex2rgb(C.PAL.PALE) });
      for (var q = 0; q < 7; q++) {
        var ang = Math.sin(G.time * 1.7) * 0.8 + (q - 3) * 0.16;
        B.draw('dot2', e.x + Math.sin(ang) * (30 + q * 22), e.y + 20 + Math.cos(ang) * (30 + q * 22),
          4, 4, { tint: U.hex2rgb(C.PAL.PALE), fade: 0.12, bucket: 'add' });
      }
    }
  }

  /* =================================================================
   * 副循环 · 冲浪收集（GDD-01 §3.5；详细规则待 GDD-04）
   *
   * 空间焊接：收集物**只**生成在冲浪带（贴近水线），与逃生路径重合 ——
   *   想收集就得贴着水面游，而水面正是摩托艇与直升机的活动层。
   *   于是「收集」与「安全」互斥（概念文档 §4.2 支柱三）。
   *
   * 判定门槛：**必须处于 surf 状态**才可拾取（贴水线 ±40px + 冲浪区 + 速度达标）。
   *   这防止了「深海安全区顺手刷分」，也保证副循环需要真的技巧投入。
   *
   * 原子性：得分计入 pendingScore，与战利品**同池**，死亡全损（GDD-03 E2 裁决）。
   * COMBO 亦按 PER_COLLECT 累加 —— 沙盘 `m_surf = 2.6` 即由「一次冲浪吃满 8 个」
   * 推出（8 × STEP 0.2 → ×2.6），因此池内**恒定保持 COUNT 个**，不可削减。
   * ================================================================= */
  var PU_SPRITE = ['bottle', 'star', 'pickup_ring'];
  var pickups = [];

  function spawnPickup(G) {
    /* 出生点避开鲨鱼周边 260px，免得「凭空出现在嘴边」破坏手感 */
    var x = U.rr(1720, 2480);
    for (var tryN = 0; tryN < 8; tryN++) {
      var cand = U.rr(1720, 2480);
      if (Math.abs(cand - G.shark.x) >= 260) { x = cand; break; }
    }
    pickups.push({ type: U.ri(0, 2), x: x, y: 0, t: U.rand() * 6 });
  }

  function pickupReset(G) {
    pickups.length = 0;
    for (var i = 0; i < C.COLLECT.COUNT; i++) spawnPickup(G);
  }

  function collectPickup(k, G) {
    var sc = C.COLLECT.SCORE[k.type];
    G.pendingScore += sc;
    G.pendingCount++;
    G.combo += C.COMBO.PER_COLLECT;
    if (G.combo > G.comboMax) G.comboMax = G.combo;
    G.stats.collects++;
    TL.FX.splash(k.x, k.y, 5, U.hex2rgb(C.PAL.CYAN), 120);
    TL.Audio.play('collect');
    G.addToast('+' + sc + ' 未兑现（收集）');
  }

  function pickupUpdate(dt, G) {
    var W = TL.World, s = G.shark;
    for (var i = pickups.length - 1; i >= 0; i--) {
      var k = pickups[i];
      k.t += dt;
      k.y = W.waterLineY(k.x, G.time) + 14 + Math.sin(k.t * 1.6) * 3;

      if (!s.alive || !s.surf) continue;          // ⭐ 只有冲浪中才判定拾取
      var sb = { x: s.x, y: s.y, w: C.SHARK.HALF_W * 2, h: C.SHARK.HALF_H * 2 };
      if (U.aabb(sb.x, sb.y, sb.w, sb.h, k.x, k.y, 26, 26)) {
        collectPickup(k, G);
        pickups.splice(i, 1);
        spawnPickup(G);                           // 池恒定 COUNT 个（沙盘约束）
      }
    }
  }

  function pickupDraw(B, G) {
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      /* 三种收集物用**不同轮廓 + 不同旋转节奏**区分，不依赖颜色 */
      var rot = 0, w = 26, h = 26;
      if (k.type === 2) {
        // 圆环平放在水面：靠纵向压扁表达透视，自身不转
        rot = 0; h = 22;
      } else if (k.type === 1) {
        rot = Math.sin(k.t * 2.2) * 0.30;         // 星星左右摆
      } else {
        rot = Math.sin(k.t * 1.4) * 0.55;         // 瓶子浮沉摇晃
      }
      B.draw(PU_SPRITE[k.type], k.x, k.y, w, h, { rot: rot });
      // 高价值（圆环 30 分）加一圈水光点，形态提示「这个更值钱」
      if (k.type === 2) {
        for (var q = 0; q < 6; q++) {
          var a = k.t * 1.2 + q * (U.TAU / 6);
          B.draw('dot2', k.x + Math.cos(a) * 20, k.y + Math.sin(a) * 6, 3, 3,
            { tint: U.hex2rgb(C.PAL.WHITE), fade: 0.55 });
        }
      }
    }
  }

  TL.Pickups = {
    reset: pickupReset, update: pickupUpdate, draw: pickupDraw,
    list: pickups,
    count: function () { return pickups.length; }
  };

  TL.Prey = {
    reset: preyReset, update: preyUpdate, draw: preyDraw, hit: preyHit,
    consume: preyConsume, list: prey
  };
  TL.Enemies = {
    reset: resetEnemies, update: updateEnemies, draw: enemyDraw,
    spawnByTier: spawnByTier, decoyAt: decoyAt, hitTestShark: hitTestShark,
    countKind: countKind, tetherCount: tetherCount, list: enemies
  };
})();
