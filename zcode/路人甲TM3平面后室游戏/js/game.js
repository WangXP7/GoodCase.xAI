/* ============================================================
 * game.js —— 游戏主体：状态机 / 主循环 / 渲染 / 输入 / 理智系统
 * 状态：menu → playing ⇄ paused | terminal(运行中) → dead / won
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG, PAL = CFG.PAL;

  function randSeed() { return String(Math.floor(Math.random() * 900000) + 100000); }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.debugOn = /(?:\?|&)debug=1/.test(location.search);
    this.debugOverlays = { grid: false, los: false, path: false, items: false };
    this.state = 'menu';
    this.input = { up: false, down: false, left: false, right: false, sprint: false };
    this.map = null;
    this.timer = 0;
    this.fps = 60; this.frameMs = 0; this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
    this.grain = [];
    this._makeGrain();
    this._bindEvents();
    this._resize();
  }

  Game.prototype = {
    /* ================= 初始化 ================= */
    boot: function () {
      var params = new URLSearchParams(location.search);
      this.seedParam = params.get('seed');
      var autostart = params.get('autostart') === '1';
      B4.ui.init(this);
      if (this.debugOn) {
        B4.ui.els.debug.classList.remove('hidden');
        /* 调试模式：捕获页面运行时报错，显示在调试面板供验收检查 */
        window.__pageErrors = window.__pageErrors || [];
        window.addEventListener('error', function (ev) {
          window.__pageErrors.push((ev.message || 'error') + ' @' + (ev.filename || '') + ':' + (ev.lineno || 0));
        });
        window.addEventListener('unhandledrejection', function (ev) {
          window.__pageErrors.push('unhandledrejection: ' + (ev.reason && ev.reason.message || ev.reason));
        });
        var self = this;
        window.__B4 = {
          game: this, CFG: CFG, B4: B4,
          debug: {
            teleport: function (tx, ty) { self.player.x = tx + 0.5; self.player.y = ty + 0.5; return 'teleported'; },
            giveAllTapes: function () {
              self.map.tapes.forEach(function (t) {
                if (!t.taken) {
                  t.taken = true; self.tapesCollected++;
                  self.clues[t.order - 1] = t.digit;
                }
              });
              self.updateObjective();
              return self.tapesCollected + '/3';
            },
            setSanity: function (v) { self.sanity = Math.max(0, Math.min(100, v)); return self.sanity; },
            setStamina: function (v) { self.player.stamina = Math.max(0, Math.min(100, v)); return self.player.stamina; },
            setEnemyPos: function (tx, ty) { self.enemy.x = tx + 0.5; self.enemy.y = ty + 0.5; return 'moved'; },
            forceChase: function () { self.enemy.state = 'chase'; self.enemy.lastSeen = { x: self.player.x, y: self.player.y }; self.enemy.repathT = 0; self.onSpotted(); return self.enemy.state; },
            forceCalm: function () { self.enemy.state = 'wander'; self.enemy.target = null; self.enemy.path = null; return 'calm'; },
            setEnemyState: function (s) { self.enemy.state = s; return self.enemy.state; },
            openTerminal: function () { self.openTerminal(); return 'open'; },
            forceWin: function () { self.map.exit.unlocked = true; self.win(); return 'win'; },
            kill: function () { self.playerCaught(); return 'dead'; },
            info: function () {
              return {
                seed: self.seed, mapHash: self.map ? self.map.mapHash : null,
                state: self.state, connectivity: self.map ? self.map.connectivity : null,
                tapes: self.tapesCollected, clues: self.clues,
                exitUnlocked: self.map ? self.map.exit.unlocked : null,
                player: self.player ? { x: self.player.x, y: self.player.y } : null,
                enemy: self.enemy ? { x: self.enemy.x, y: self.enemy.y, state: self.enemy.state } : null,
                timer: self.timer, stats: self.stats, objective: self.objective,
                sanity: self.sanity, debugOverlays: self.debugOverlays
              };
            }
          }
        };
      }
      if (autostart && this.seedParam) {
        this.startRun(this.seedParam);
      } else {
        this.state = 'menu';
        B4.ui.show('menu');
      }
      var self = this;
      function loop(ts) {
        requestAnimationFrame(loop); // 先排程下一帧，单帧异常不会杀死主循环
        try {
          self._loop(ts);
        } catch (err) {
          if (window.__pageErrors) {
            window.__pageErrors.push('loop: ' + (err && err.message || err));
          }
        }
      }
      requestAnimationFrame(loop);
    },

    /* ================= 开局 / 重置 ================= */
    startRun: function (seedStr) {
      B4.audio.init(); B4.audio.ensure();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      this.seed = seedStr || randSeed();
      this.map = B4.generateMap(this.seed);
      this.player = B4.createPlayer(this.map.spawn);
      this.enemy = B4.createEnemy(this.map);
      this.sanity = CFG.SANITY_MAX;
      this.tapesCollected = 0;
      this.clues = [null, null, null];
      this.stats = { sprints: 0, spotted: 0, tapes: 0, distance: 0 };
      this.noises = [];
      this.timer = 0;
      this.terminalOpen = false;
      this.terminalInput = [null, null, null];
      this.terminalMsg = '';
      this.terminalMsgType = '';
      this.terminalCloseT = 0;
      this.promptText = '';
      this.currentInteract = null;
      this.redPulse = 0;
      this.shakeT = 0; this.shakeAmp = 0;
      this.phantom = null;
      this.fakeStepT = 4 + Math.random() * 4;
      this.lightmap = new B4.Lightmap(this.map);
      this.scale = Math.max(1.0, Math.min(2.5, window.innerWidth / (CFG.VIEW_TILES_X * CFG.TILE)));
      this._buildStaticLayer();
      this.camX = this.player.x * CFG.TILE; this.camY = this.player.y * CFG.TILE;
      this.updateObjective();
      this.state = 'playing';
      B4.ui.els.terminal.classList.add('hidden');
      B4.ui.hudVisible(true);
      B4.ui.show(null);
      B4.ui.toast('收集三盘录像带，找出密码，从闸门逃离');
    },

    restartSameSeed: function () { this.startRun(this.seed); },
    restartNewSeed: function () { this.startRun(null); },
    toMenu: function () {
      this.state = 'menu';
      B4.ui.hudVisible(false);
      B4.ui.closeTerminal(this);
      B4.ui.show('menu');
    },
    togglePause: function () {
      if (this.state === 'playing') {
        this.state = 'paused';
        B4.ui.show('pause');
      } else if (this.state === 'paused') {
        this.resume();
      }
    },
    resume: function () {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      B4.ui.show(null);
      B4.ui.hudVisible(true);
    },

    updateObjective: function () {
      if (this.map && this.map.exit.unlocked) {
        this.objective = '逃离：前往东侧闸门';
      } else if (this.tapesCollected >= 3) {
        this.objective = '前往密码终端（档案主机房）';
      } else if (this.tapesCollected === 0) {
        this.objective = '寻找第一盘录像带';
      } else {
        this.objective = '继续寻找录像带（' + this.tapesCollected + '/3）';
      }
    },

    /* ================= 运行时工具 ================= */
    addNoise: function (x, y, r) {
      if (this.state !== 'playing') return;
      this.noises.push({ x: x, y: y, r: r, consumed: false, t: 0 });
      if (this.noises.length > 16) this.noises.shift();
    },
    onSpotted: function () {
      this.stats.spotted++;
      this.redPulse = 1;
      B4.audio.spotted();
      this.shake(3, 0.3);
      B4.ui.toast('你被「巡影」发现了 —— 快跑！');
    },
    shake: function (amp, dur) {
      this.shakeAmp = Math.max(this.shakeAmp, amp);
      this.shakeT = Math.max(this.shakeT, dur);
    },
    playerCaught: function () {
      if (this.state !== 'playing') return;
      this.state = 'dead';
      B4.audio.death();
      this.shake(7, 0.5);
      B4.ui.hudVisible(false);
      B4.ui.closeTerminal(this);
      B4.ui.showDeath(this, '你被「巡影」追上，消失在了黑暗里');
    },
    failSanity: function () {
      if (this.state !== 'playing') return;
      this.state = 'dead';
      B4.audio.death();
      B4.ui.hudVisible(false);
      B4.ui.closeTerminal(this);
      B4.ui.showDeath(this, '理智归零 —— 你蜷缩在黑暗中，再也没有站起来');
    },
    win: function () {
      if (this.state !== 'playing') return;
      this.state = 'won';
      B4.audio.win();
      B4.ui.hudVisible(false);
      B4.ui.closeTerminal(this);
      B4.ui.showWin(this);
    },
    openTerminal: function () {
      if (this.state !== 'playing') return;
      this.terminalOpen = true;
      this.terminalInput = [null, null, null];
      this.terminalMsg = '';
      this.terminalMsgType = '';
      B4.audio.ui();
      B4.ui.openTerminal(this);
      this.addNoise(this.player.x, this.player.y, CFG.NOISE_INTERACT);
    },
    closeTerminal: function () {
      if (!this.terminalOpen) return;
      this.terminalOpen = false;
      B4.ui.closeTerminal(this);
    },
    terminalKey: function (k) {
      if (!this.terminalOpen) return;
      if (/^[0-9]$/.test(k)) {
        for (var i = 0; i < 3; i++) {
          if (this.terminalInput[i] === null) { this.terminalInput[i] = +k; B4.audio.ui(); break; }
        }
      } else if (k === 'back') {
        for (i = 2; i >= 0; i--) {
          if (this.terminalInput[i] !== null) { this.terminalInput[i] = null; B4.audio.ui(); break; }
        }
      } else if (k === 'clear') {
        this.terminalInput = [null, null, null];
        B4.audio.ui();
      } else if (k === 'enter') {
        if (this.terminalInput.indexOf(null) !== -1) {
          this.terminalMsg = '请先输满三位密码'; this.terminalMsgType = 'err';
        } else if (this.tapesCollected < 3) {
          this.terminalMsg = '录像带不足，无法验证密码'; this.terminalMsgType = 'err';
          B4.audio.gateLocked();
        } else {
          var res = B4.checkCode(this, this.terminalInput);
          if (res.ok) {
            this.terminalMsg = '✓ 密码正确，闸门已解锁'; this.terminalMsgType = 'ok';
            this.terminalCloseT = 1.4;
            this.addNoise(this.map.terminal.tx + 0.5, this.map.terminal.ty + 0.5, CFG.NOISE_INTERACT);
          } else {
            this.terminalMsg = '✗ 密码错误，请核对录像带线索'; this.terminalMsgType = 'err';
            this.terminalInput = [null, null, null]; // 只清空输入，不清空已收集录像带
            this.addNoise(this.map.terminal.tx + 0.5, this.map.terminal.ty + 0.5, CFG.NOISE_INTERACT);
          }
        }
      }
      B4.ui.renderTerminal(this);
    },

    /* ================= 主循环 ================= */
    _loop: function (ts) {
      var t0 = performance.now();
      var dt = Math.min(CFG.MAX_DT, (ts - (this._lastTs || ts)) / 1000);
      this._lastTs = ts;
      this._fpsAcc += dt; this._fpsN++;
      if (ts - this._fpsT > 500) {
        this.fps = this._fpsN / Math.max(0.001, this._fpsAcc);
        this._fpsT = ts; this._fpsAcc = 0; this._fpsN = 0;
      }
      if (this.state === 'playing') this._update(dt);
      this._render(dt);
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'dead' || this.state === 'won') {
        B4.ui.updateHUD(this);
      }
      if (this.debugOn && (this._dbgT = (this._dbgT || 0) + dt) > 0.25) {
        this._dbgT = 0;
        B4.ui.updateDebug(this);
      }
      this.frameMs = performance.now() - t0;
    },

    _update: function (dt) {
      var p = this.player, e = this.enemy, map = this.map;
      this.timer += dt;

      /* 光照先行（理智计算依赖亮度） */
      this._computeLight();

      /* 密码终端打开时玩家原地输入，不移动（世界仍在运行） */
      var savedInput = this.input;
      if (this.terminalOpen) {
        this.input = { up: false, down: false, left: false, right: false, sprint: false };
      }
      B4.updatePlayer(this, dt);
      B4.updateEnemy(this, dt);
      this.input = savedInput;

      /* 声音事件老化 */
      for (var i = this.noises.length - 1; i >= 0; i--) {
        var n = this.noises[i];
        n.t += dt;
        if (n.consumed || n.t > 1.2) this.noises.splice(i, 1);
      }

      /* 长椅冷却 */
      if (map.bench && map.bench.cooldown > 0) map.bench.cooldown -= dt;

      /* 交互提示 */
      this.currentInteract = B4.findInteractable(this);
      this.promptText = this.currentInteract ? this.currentInteract.label : '';

      /* ---- 理智系统（以环境光判定“黑暗区域”，随身微光不计） ---- */
      var pTile = { tx: Math.floor(p.x), ty: Math.floor(p.y) };
      var light = this.lightmap.envLightAt(pTile.tx, pTile.ty);
      var distE = Math.hypot(e.x - p.x, e.y - p.y);
      var chased = e.state === 'chase';
      var enemyNear = distE < 6;
      var delta = 0;
      if (light < 0.16) delta -= CFG.DARK_DRAIN;
      if (enemyNear) delta -= CFG.ENEMY_NEAR_DRAIN;
      if (chased) delta -= CFG.CHASE_DRAIN;
      if (delta === 0 && light > 0.3) delta += CFG.SANITY_REGEN;
      this.sanity = Math.max(0, Math.min(CFG.SANITY_MAX, this.sanity + delta * dt));
      if (this.sanity <= 0) { this.failSanity(); return; }

      /* ---- 低理智反馈：幻听脚步 / 短暂幻影 / 视野收缩 ---- */
      if (this.sanity < 50) {
        this.fakeStepT -= dt;
        if (this.fakeStepT <= 0) {
          this.fakeStepT = 3.5 + Math.random() * 4;
          B4.audio.fakeStep();
        }
      }
      if (this.sanity < CFG.LOW_SANITY_FX) {
        if (!this.phantom && Math.random() < dt * 0.14) {
          var ang = Math.random() * Math.PI * 2;
          var px = p.x + Math.cos(ang) * 2.6, py = p.y + Math.sin(ang) * 2.6;
          if (!B4.MapUtils.isSolid(map, Math.floor(px), Math.floor(py))) {
            this.phantom = { x: px, y: py, t: 0.45 };
          }
        }
      }
      if (this.phantom) {
        this.phantom.t -= dt;
        if (this.phantom.t <= 0) this.phantom = null;
      }

      this.redPulse = Math.max(0, this.redPulse - dt * 1.4);
      if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeAmp = 0; }

      /* 终端正确后的自动关闭 */
      if (this.terminalCloseT > 0) {
        this.terminalCloseT -= dt;
        if (this.terminalCloseT <= 0) this.closeTerminal();
      }

      /* ---- 镜头平滑跟随 ---- */
      var lookX = 0, lookY = 0;
      if (p.moving) { lookX = p.fx * 40; lookY = p.fy * 40; }
      var targetX = p.x * CFG.TILE + lookX, targetY = p.y * CFG.TILE + lookY;
      var k = 1 - Math.pow(0.0018, dt); // 平滑系数，无抖动
      this.camX += (targetX - this.camX) * k;
      this.camY += (targetY - this.camY) * k;
      this._clampCam();

      /* ---- 声部驱动 ---- */
      var chaseLvl = chased ? (distE < 3.2 ? 2 : 1) : 0;
      var prox = Math.max(0, Math.min(1, 1 - distE / 6)) * (chased ? 1 : 0.6);
      B4.audio.frame(dt, chaseLvl, prox);
    },

    _computeLight: function () {
      var lm = this.lightmap, map = this.map;
      lm.reset();
      var t = this.timer;
      lm.addLight(Math.floor(this.player.x), Math.floor(this.player.y), CFG.PLAYER_LIGHT_R, PAL.lightCool, 0.95);
      for (var i = 0; i < map.lamps.length; i++) {
        var lamp = map.lamps[i];
        if (lamp.broken) continue;
        var flick = B4.lampFlicker(lamp, t);
        var col = lamp.warm === 2 ? PAL.lightSafe : PAL.lightWarm;
        lm.addLight(lamp.tx, lamp.ty, lamp.radius, col, flick, true);
      }
      lm.finalize(t);
    },

    _clampCam: function () {
      var vw = this.canvas.width / this.dpr / this.scale;
      var vh = this.canvas.height / this.dpr / this.scale;
      var worldW = this.map.w * CFG.TILE, worldH = this.map.h * CFG.TILE;
      // camX/camY 为视口中心
      this.camX = worldW <= vw ? worldW / 2 : Math.max(vw / 2, Math.min(worldW - vw / 2, this.camX));
      this.camY = worldH <= vh ? worldH / 2 : Math.max(vh / 2, Math.min(worldH - vh / 2, this.camY));
    },

    /* ================= 渲染 ================= */
    _render: function (dt) {
      var ctx = this.ctx;
      var cv = this.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAL.pageBg;
      ctx.fillRect(0, 0, cv.width, cv.height);

      if (!this.map) { this._renderMenuBg(dt); return; }

      var cssW = cv.width / this.dpr, cssH = cv.height / this.dpr;
      this.scale = Math.max(1.0, Math.min(2.5, cssW / (CFG.VIEW_TILES_X * CFG.TILE)));
      var s = this.scale * this.dpr;
      var shx = 0, shy = 0;
      if (this.shakeT > 0) {
        shx = (Math.random() * 2 - 1) * this.shakeAmp;
        shy = (Math.random() * 2 - 1) * this.shakeAmp;
      }
      ctx.setTransform(s, 0, 0, s, 0, 0);
      /* camX/camY 为视口中心（与 _clampCam 一致） */
      ctx.translate(-(this.camX - vw / 2) + shx / s, -(this.camY - vh / 2) + shy / s);

      /* 静态地图层（只绘制可视区域） */
      var vw = cv.width / this.dpr / this.scale, vh = cv.height / this.dpr / this.scale;
      var sx = Math.max(0, Math.floor((this.camX - vw / 2) / CFG.TILE) * CFG.TILE - CFG.TILE);
      var sy = Math.max(0, Math.floor((this.camY - vh / 2) / CFG.TILE) * CFG.TILE - CFG.TILE);
      var sw = Math.min(this.map.w * CFG.TILE - sx, vw + CFG.TILE * 3);
      var sh = Math.min(this.map.h * CFG.TILE - sy, vh + CFG.TILE * 3);
      ctx.drawImage(this.staticCanvas, sx, sy, sw, sh, sx, sy, sw, sh);

      this._drawItems(ctx);
      this._drawEnemy(ctx);
      this._drawPlayer(ctx);

      /* 光照叠加（multiply） */
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.lightmap.canvas, 0, 0, this.map.w, this.map.h, 0, 0, this.map.w * CFG.TILE, this.map.h * CFG.TILE);
      ctx.globalCompositeOperation = 'source-over';

      this._drawDebugOverlays(ctx);

      /* 黑暗中的眼睛（保证可读性） */
      this._drawEyes(ctx);
      /* 追逐且近身时保证轮廓可辨认（公平性） */
      var dEp = Math.hypot(this.enemy.x - this.player.x, this.enemy.y - this.player.y);
      if (this.enemy.state === 'chase' && dEp < 5.5) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.5, (1 - dEp / 5.5) * 0.6);
        this._paintShade(ctx, CFG.TILE, this.enemy.wobble, '#040406');
        ctx.restore();
      }
      if (this.phantom) this._drawSilhouette(ctx, this.phantom.x, this.phantom.y, 0.14);

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._renderPostFX(ctx, cssW, cssH);
    },

    _drawItems: function (ctx) {
      var map = this.map, T = CFG.TILE, t = this.timer;
      var i;
      /* 录像带 */
      for (i = 0; i < map.tapes.length; i++) {
        var tp = map.tapes[i];
        if (tp.taken) continue;
        var x = (tp.x + 0.5) * T, y = (tp.y + 0.5) * T + Math.sin(t * 2.4 + i) * 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#282420';
        ctx.fillRect(-11, -7, 22, 14);
        ctx.fillStyle = '#191613';
        ctx.fillRect(-8, -4, 16, 8);
        ctx.fillStyle = '#6d655a';
        ctx.beginPath(); ctx.arc(-4, 0, 2.2, 0, 6.29); ctx.fill();
        ctx.beginPath(); ctx.arc(4, 0, 2.2, 0, 6.29); ctx.fill();
        ctx.fillStyle = '#c8b98f';
        ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(tp.order), 0, -9);
        var g = 0.25 + 0.2 * Math.sin(t * 3 + i * 2);
        ctx.fillStyle = 'rgba(216,179,106,' + g.toFixed(2) + ')';
        ctx.fillRect(-11, -7, 22, 2);
        ctx.restore();
      }
      /* 密码终端 */
      var tm = map.terminal;
      ctx.save();
      ctx.translate((tm.tx + 0.5) * T, (tm.ty + 0.5) * T);
      ctx.fillStyle = '#2e3433';
      ctx.fillRect(-16, -12, 32, 26);
      ctx.fillStyle = '#1c2120';
      ctx.fillRect(-13, -9, 26, 14);
      var scr = 0.5 + 0.3 * Math.sin(t * 6.3);
      ctx.fillStyle = 'rgba(110,190,140,' + (0.35 + scr * 0.3).toFixed(2) + ')';
      ctx.fillRect(-11, -7, 22, 10);
      ctx.fillStyle = '#9fb3a8';
      ctx.font = '7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('PASS', 0, 0);
      ctx.restore();
      /* 出口闸门 */
      var ex = map.exit;
      ctx.save();
      ctx.translate((ex.tx + 0.5) * T, (ex.ty + 0.5) * T);
      ctx.fillStyle = '#3a4038';
      ctx.fillRect(-T * 0.45, -T * 0.45, T * 0.9, T * 0.9);
      ctx.strokeStyle = '#22261f';
      ctx.lineWidth = 2;
      for (i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-T * 0.45, i * T * 0.16);
        ctx.lineTo(T * 0.45, i * T * 0.16);
        ctx.stroke();
      }
      var glowA = ex.unlocked ? 0.45 + 0.25 * Math.sin(t * 4) : 0.12;
      ctx.fillStyle = 'rgba(120,235,150,' + glowA.toFixed(2) + ')';
      ctx.fillRect(-T * 0.3, -T * 0.62, T * 0.6, T * 0.2);
      ctx.fillStyle = ex.unlocked ? '#dfffe6' : '#7d8a80';
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('出口', 0, -T * 0.47);
      ctx.restore();
      /* 安全屋长椅 */
      if (map.bench) {
        var b = map.bench;
        ctx.save();
        ctx.translate((b.tx + 0.5) * T, (b.ty + 0.5) * T);
        ctx.fillStyle = '#5a4a36';
        ctx.fillRect(-16, -6, 32, 12);
        ctx.fillStyle = '#453a2b';
        ctx.fillRect(-16, -6, 32, 4);
        ctx.restore();
      }
    },

    _drawPlayer: function (ctx) {
      var p = this.player, T = CFG.TILE;
      var x = p.x * T, y = p.y * T;
      var bob = Math.sin(p.walkAnim * 7) * 0.8;
      ctx.save();
      ctx.translate(x, y + bob);
      // 身体
      ctx.fillStyle = '#8f8672';
      ctx.beginPath(); ctx.arc(0, 0, T * 0.27, 0, 6.29); ctx.fill();
      // 双肩
      ctx.fillStyle = '#776f5d';
      ctx.beginPath(); ctx.arc(-T * 0.2, 0, T * 0.13, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(T * 0.2, 0, T * 0.13, 0, 6.29); ctx.fill();
      // 头
      ctx.fillStyle = '#37322a';
      ctx.beginPath(); ctx.arc(p.fx * 2, p.fy * 2 - 1, T * 0.16, 0, 6.29); ctx.fill();
      // 朝向指示
      ctx.fillStyle = '#b3a98e';
      ctx.beginPath(); ctx.arc(p.fx * T * 0.22, p.fy * T * 0.22, 2.2, 0, 6.29); ctx.fill();
      ctx.restore();
    },

    _drawSilhouette: function (ctx, wx, wy, alpha) {
      var T = CFG.TILE;
      ctx.save();
      ctx.translate(wx * T, wy * T);
      ctx.globalAlpha = alpha;
      this._paintShade(ctx, T, this.timer, '#050507');
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    _drawEnemy: function (ctx) {
      var e = this.enemy, T = CFG.TILE;
      ctx.save();
      ctx.translate(e.x * T, e.y * T);
      this._paintShade(ctx, T, e.wobble, '#08080b');
      ctx.restore();
    },

    /* 「巡影」黑色剪影（原创形象：细长人形，双臂过膝） */
    _paintShade: function (ctx, T, wob, color) {
      var sway = Math.sin(wob) * 2.2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, T * 0.24, T * 0.34, 0, 0, 6.29);
      ctx.fill();
      // 细长手臂
      ctx.strokeStyle = color;
      ctx.lineWidth = T * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-T * 0.18, -T * 0.1);
      ctx.quadraticCurveTo(-T * 0.34 + sway, T * 0.18, -T * 0.28 + sway * 1.4, T * 0.44);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(T * 0.18, -T * 0.1);
      ctx.quadraticCurveTo(T * 0.34 - sway, T * 0.18, T * 0.28 - sway * 1.4, T * 0.44);
      ctx.stroke();
      // 头
      ctx.beginPath();
      ctx.arc(0, -T * 0.36, T * 0.15, 0, 6.29);
      ctx.fill();
    },

    _drawEyes: function (ctx) {
      var e = this.enemy, T = CFG.TILE, p = this.player;
      var d = Math.hypot(e.x - p.x, e.y - p.y);
      var a = Math.max(0, Math.min(0.95, 1.15 - d / 7));
      if (a <= 0.01) return;
      var chase = e.state === 'chase';
      var col = chase ? '255,186,140' : '216,210,192';
      var ex = e.x * T, ey = e.y * T - T * 0.38;
      var ox = (e.x - p.x) !== 0 ? Math.sign(p.x - e.x) * 1.5 : 0;
      ctx.save();
      if (chase) {
        ctx.shadowColor = 'rgba(255,140,90,0.9)';
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = 'rgba(' + col + ',' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(ex - 4.5 + ox, ey, 2.6, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 4.5 + ox, ey, 2.6, 0, 6.29); ctx.fill();
      ctx.restore();
    },

    _drawDebugOverlays: function (ctx) {
      if (!this.debugOn) return;
      var o = this.debugOverlays, map = this.map, T = CFG.TILE;
      if (o.grid) {
        ctx.strokeStyle = 'rgba(120,200,255,0.13)';
        ctx.lineWidth = 1 / this.scale;
        var x0 = Math.max(0, Math.floor((this.camX - 400) / T)), x1 = Math.min(map.w, x0 + 20);
        var y0 = Math.max(0, Math.floor((this.camY - 300) / T)), y1 = Math.min(map.h, y0 + 16);
        for (var gx = x0; gx <= x1; gx++) { ctx.beginPath(); ctx.moveTo(gx * T, y0 * T); ctx.lineTo(gx * T, y1 * T); ctx.stroke(); }
        for (var gy = y0; gy <= y1; gy++) { ctx.beginPath(); ctx.moveTo(x0 * T, gy * T); ctx.lineTo(x1 * T, gy * T); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,80,80,0.25)';
        for (var ty = y0; ty < y1; ty++) for (var tx = x0; tx < x1; tx++) {
          if (B4.MapUtils.isSolid(map, tx, ty)) ctx.fillRect(tx * T, ty * T, T, T);
        }
      }
      if (o.los) {
        var e = this.enemy, p = this.player;
        var los = B4.MapUtils.hasLOS(map, e.x, e.y, p.x, p.y);
        ctx.strokeStyle = los ? 'rgba(120,255,120,0.7)' : 'rgba(255,90,90,0.7)';
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath(); ctx.moveTo(e.x * T, e.y * T); ctx.lineTo(p.x * T, p.y * T); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,180,80,0.35)';
        ctx.beginPath(); ctx.arc(e.x * T, e.y * T, CFG.ENEMY_VISION * T, 0, 6.29); ctx.stroke();
      }
      if (o.path && this.enemy.path) {
        ctx.strokeStyle = 'rgba(255,220,120,0.85)';
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath();
        var en = this.enemy;
        ctx.moveTo(en.x * T, en.y * T);
        for (var i = en.pathI; i < en.path.length; i++) {
          ctx.lineTo((en.path[i].x + 0.5) * T, (en.path[i].y + 0.5) * T);
        }
        ctx.stroke();
      }
      if (o.items) {
        ctx.font = '10px monospace';
        var mark = function (tx, ty, label, col) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5 / this.scale;
          ctx.strokeRect(tx * T + 4, ty * T + 4, T - 8, T - 8);
          ctx.fillStyle = col;
          ctx.fillText(label, tx * T + 2, ty * T - 3);
        }.bind(this);
        map.tapes.forEach(function (t) { if (!t.taken) mark(t.x, t.y, '带#' + t.order, '#d8b36a'); });
        mark(map.terminal.tx, map.terminal.ty, '终端', '#7ecf95');
        mark(map.exit.tx, map.exit.ty, '出口', '#78eb96');
        if (map.bench) mark(map.bench.tx, map.bench.ty, '长椅', '#c9a86a');
        mark(map.spawn.tx, map.spawn.ty, '出生', '#88aacc');
      }
    },

    /* ---- 屏幕空间后处理：暗角 / 噪点 / 红光 / 低理智收缩 ---- */
    _renderPostFX: function (ctx, w, h) {
      var sanityK = 1 - this.sanity / CFG.SANITY_MAX;
      /* 暗角（低理智时视野收缩） */
      var inner = Math.max(0.42, 0.72 - sanityK * 0.30);
      var grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner * 0.5, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,' + (0.52 + sanityK * 0.2).toFixed(2) + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      /* 被发现的边缘红光 */
      if (this.redPulse > 0) {
        var r = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
        r.addColorStop(0, 'rgba(150,20,10,0)');
        r.addColorStop(1, 'rgba(150,20,10,' + (0.4 * this.redPulse).toFixed(2) + ')');
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, w, h);
      }

      /* 胶片噪点 */
      var ga = CFG.GRAIN_ALPHA + sanityK * (CFG.GRAIN_ALPHA_LOW - CFG.GRAIN_ALPHA);
      if (ga > 0.005) {
        ctx.globalAlpha = ga;
        var g = this.grain[Math.floor(Math.random() * this.grain.length)];
        var ox = -Math.random() * 160, oy = -Math.random() * 160;
        for (var y = oy; y < h; y += 160) {
          for (var x = ox; x < w; x += 160) ctx.drawImage(g, x, y);
        }
        ctx.globalAlpha = 1;
      }
    },

    _renderMenuBg: function (dt) {
      var ctx = this.ctx, cv = this.canvas;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      var w = cv.width / this.dpr, h = cv.height / this.dpr;
      var g = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, Math.max(w, h) * 0.8);
      g.addColorStop(0, '#14110c');
      g.addColorStop(1, '#070605');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.08;
      var gr = this.grain[Math.floor(Math.random() * this.grain.length)];
      for (var y = 0; y < h; y += 160) for (var x = 0; x < w; x += 160) ctx.drawImage(gr, x, y);
      ctx.globalAlpha = 1;
    },

    /* ================= 静态地图层预渲染 ================= */
    _buildStaticLayer: function () {
      var map = this.map, T = CFG.TILE;
      var cv = this.staticCanvas = document.createElement('canvas');
      cv.width = map.w * T; cv.height = map.h * T;
      var ctx = cv.getContext('2d');
      var x, y, i, tx, ty;
      var PALF = PAL.floorA, PALB = PAL.floorB;

      for (y = 0; y < map.h; y++) {
        for (x = 0; x < map.w; x++) {
          i = y * map.w + x;
          var seed = map.tileSeed[i];
          if (map.tiles[i] === 1) {
            /* 墙体 */
            ctx.fillStyle = 'rgb(' + PAL.wall.join(',') + ')';
            ctx.fillRect(x * T, y * T, T, T);
            if (y + 1 < map.h && map.tiles[i + map.w] !== 1) {
              /* 朝下的墙面（伪立面） */
              ctx.fillStyle = 'rgb(' + PAL.wallTop.join(',') + ')';
              ctx.fillRect(x * T, y * T + T - 12, T, 12);
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.fillRect(x * T, y * T + T - 3, T, 3);
            }
            if (seed > 236) { // 裂缝
              ctx.strokeStyle = 'rgb(' + PAL.wallCrack.join(',') + ')';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.moveTo(x * T + 8 + (seed % 10), y * T + 6);
              ctx.lineTo(x * T + 18 + (seed % 14), y * T + T - 14);
              ctx.stroke();
            }
            continue;
          }
          /* 地板：房间与走廊区分 */
          var base = map.roomIdx[i] === -1 ? PAL.corridor : (seed % 2 === 0 ? PALF : PALB);
          var v = (seed % 7) - 3;
          var rr = Math.max(0, Math.min(255, base[0] + v * 2));
          var gg = Math.max(0, Math.min(255, base[1] + v * 2));
          var bb = Math.max(0, Math.min(255, base[2] + v));
          ctx.fillStyle = 'rgb(' + rr + ',' + gg + ',' + bb + ')';
          ctx.fillRect(x * T, y * T, T, T);
          /* 地砖缝 */
          ctx.strokeStyle = 'rgba(0,0,0,0.16)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1);
          if (seed > 244) { // 磨损斑点
            ctx.fillStyle = 'rgba(30,26,20,0.25)';
            ctx.beginPath();
            ctx.arc(x * T + (seed % 30) + 8, y * T + (seed % 22) + 10, 4 + seed % 5, 0, 6.29);
            ctx.fill();
          }
        }
      }
      /* 潮湿地毯 */
      map.carpet.forEach(function (c) {
        ctx.fillStyle = 'rgba(' + PAL.damp.join(',') + ',0.55)';
        ctx.fillRect(c.x * T + 2, c.y * T + 2, c.w * T - 4, c.h * T - 4);
        ctx.strokeStyle = 'rgba(40,40,28,0.5)';
        ctx.strokeRect(c.x * T + 2, c.y * T + 2, c.w * T - 4, c.h * T - 4);
      });
      /* 污渍 */
      map.stains.forEach(function (st) {
        ctx.fillStyle = 'rgba(' + PAL.stain.join(',') + ',0.4)';
        ctx.beginPath();
        ctx.ellipse((st.x + 0.5) * T, (st.y + 0.5) * T, 10 * st.s, 7 * st.s, 0.4, 0, 6.29);
        ctx.fill();
      });
      /* 家具 */
      map.furniture.forEach(function (f) {
        var fx = f.x * T, fy = f.y * T;
        if (f.kind === 'shelf') {
          ctx.fillStyle = 'rgb(' + PAL.furnitureWood.join(',') + ')';
          ctx.fillRect(fx + 3, fy + 3, T - 6, T - 6);
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          for (var s2 = 1; s2 < 4; s2++) {
            ctx.beginPath();
            ctx.moveTo(fx + 3, fy + s2 * T / 4);
            ctx.lineTo(fx + T - 3, fy + s2 * T / 4);
            ctx.stroke();
          }
        } else if (f.kind === 'desk') {
          ctx.fillStyle = 'rgb(' + PAL.furnitureMetal.join(',') + ')';
          ctx.fillRect(fx + 4, fy + 6, T - 8, T - 12);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(fx + 4, fy + 6, T - 8, 6);
        } else {
          ctx.fillStyle = '#4a4234';
          ctx.fillRect(fx + 6, fy + 6, T - 12, T - 12);
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.beginPath();
          ctx.moveTo(fx + 6, fy + 6); ctx.lineTo(fx + T - 6, fy + T - 6);
          ctx.moveTo(fx + T - 6, fy + 6); ctx.lineTo(fx + 6, fy + T - 6);
          ctx.stroke();
        }
      });
      /* 荧光灯底座 */
      map.lamps.forEach(function (l) {
        var lx = (l.tx + 0.5) * T, ly = (l.ty + 0.5) * T;
        ctx.fillStyle = l.broken ? '#2a2a28' : '#c9c2ae';
        ctx.fillRect(lx - 12, ly - 4, 24, 8);
        ctx.fillStyle = l.broken ? '#1c1c1a' : '#efe8d2';
        ctx.fillRect(lx - 9, ly - 2, 18, 4);
      });
      /* 安全屋长椅底座 */
      if (map.bench) {
        ctx.fillStyle = 'rgba(216,179,106,0.10)';
        ctx.fillRect((map.bench.tx - 0.6) * T, (map.bench.ty - 0.6) * T, T * 2.2, T * 2.2);
      }
      /* 房间名称（地面油漆字，作导航标识） */
      map.rooms.forEach(function (r) {
        if (r.w < 4 || r.h < 4) return;
        ctx.save();
        ctx.translate((r.x + r.w / 2) * T, (r.y + r.h / 2) * T);
        ctx.rotate(-0.03);
        ctx.fillStyle = 'rgba(232,218,182,0.16)';
        ctx.font = 'bold ' + Math.round(T * 0.42) + 'px "Noto Sans SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(r.name, 0, 0);
        ctx.restore();
      });
    },

    /* ================= 输入 ================= */
    _bindEvents: function () {
      var self = this;
      window.addEventListener('keydown', function (ev) {
        var tag = ev.target && ev.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 正在输入框中打字（如种子输入）
        self._onKey(ev, true);
      });
      window.addEventListener('keyup', function (ev) {
        var tag = ev.target && ev.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        self._onKey(ev, false);
      });
      window.addEventListener('blur', function () {
        self.input.up = self.input.down = self.input.left = self.input.right = self.input.sprint = false;
        if (self.state === 'playing') self.togglePause();
      });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && self.state === 'playing') self.togglePause();
      });
      window.addEventListener('resize', function () { self._resize(); });
    },

    _onKey: function (ev, down) {
      var k = ev.key;
      var code = ev.code;
      /* 首次用户手势初始化音频（浏览器自动播放策略） */
      if (down) B4.audio.init();

      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' ||
          k === ' ' || (down && code && code.indexOf('F') === 0 && code.length > 1)) ev.preventDefault();

      if (k === 'w' || k === 'W' || k === 'ArrowUp') this.input.up = down;
      else if (k === 's' || k === 'S' || k === 'ArrowDown') this.input.down = down;
      else if (k === 'a' || k === 'A' || k === 'ArrowLeft') this.input.left = down;
      else if (k === 'd' || k === 'D' || k === 'ArrowRight') this.input.right = down;
      else if (k === 'Shift') this.input.sprint = down;
      else if (down && this.debugOn && code === 'F1') { this.debugOverlays.grid = !this.debugOverlays.grid; }
      else if (down && this.debugOn && code === 'F2') { this.debugOverlays.los = !this.debugOverlays.los; }
      else if (down && this.debugOn && code === 'F3') { this.debugOverlays.path = !this.debugOverlays.path; }
      else if (down && this.debugOn && code === 'F4') { this.debugOverlays.items = !this.debugOverlays.items; }
      else if (down && (k === 'e' || k === 'E')) {
        if (this.terminalOpen) this.closeTerminal();
        else if (this.state === 'playing') {
          if (this.currentInteract) B4.doInteract(this, this.currentInteract);
        }
      }
      else if (down && k === 'Escape') {
        if (this.terminalOpen) this.closeTerminal();
        else if (this.state === 'playing' || this.state === 'paused') this.togglePause();
      }
      else if (down && (k === 'm' || k === 'M')) {
        B4.audio.toggleMute();
        B4.ui.syncSoundUI(this);
        B4.ui.toast(B4.audio.muted ? '音效已静音' : '音效已开启');
      }
      else if (down && this.terminalOpen && /^[0-9]$/.test(k)) this.terminalKey(k);
      else if (down && this.terminalOpen && k === 'Backspace') { ev.preventDefault(); this.terminalKey('back'); }
      else if (down && this.terminalOpen && k === 'Enter') this.terminalKey('enter');
    },

    _resize: function () {
      this.dpr = Math.max(1, window.devicePixelRatio || 1);
      this.canvas.width = Math.floor(window.innerWidth * this.dpr);
      this.canvas.height = Math.floor(window.innerHeight * this.dpr);
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
    },

    /* 噪点纹理（运行时生成，非外部素材） */
    _makeGrain: function () {
      for (var n = 0; n < 3; n++) {
        var c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        var g = c.getContext('2d');
        var img = g.createImageData(160, 160);
        for (var i = 0; i < img.data.length; i += 4) {
          var v = Math.floor(Math.random() * 255);
          img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        this.grain.push(c);
      }
    }
  };

  B4.Game = Game;
})();
