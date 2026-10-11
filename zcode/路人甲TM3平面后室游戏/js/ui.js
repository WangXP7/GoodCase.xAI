/* ============================================================
 * ui.js —— 界面层（DOM）
 * · HUD：录像带进度、目标、体力、理智、Seed、用时、音效状态
 * · 菜单：开始游戏 / 操作说明 / 音效开关（三个入口）+ 种子输入
 * · 暂停 / 失败 / 成功结算 / 密码终端 / 调试面板（仅 ?debug=1）
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;

  function $(id) { return document.getElementById(id); }

  var ui = {
    els: {},
    returnTo: 'menu',

    init: function (game) {
      this.game = game;
      var e = this.els;
      e.canvas = $('game');
      e.hud = $('hud');
      e.barStamina = $('bar-stamina');
      e.barSanity = $('bar-sanity');
      e.objective = $('objective');
      e.clues = $('clues');
      e.tapeCount = $('tape-count');
      e.time = $('hud-time');
      e.seed = $('hud-seed');
      e.sound = $('hud-sound');
      e.pauseBtn = $('hud-pause');
      e.prompt = $('hud-prompt');
      e.toasts = $('hud-toasts');
      e.tapeFlash = $('tape-flash');

      e.menu = $('screen-menu');
      e.menuSeed = $('menu-seed');
      e.seedInput = $('seed-input');
      e.help = $('screen-help');
      e.screenSound = $('screen-sound');
      e.volumeSlider = $('volume-slider');
      e.volumeVal = $('volume-val');
      e.soundToggle = $('sound-toggle');
      e.pause = $('screen-pause');
      e.death = $('screen-death');
      e.deathReason = $('death-reason');
      e.deathStats = $('death-stats');
      e.win = $('screen-win');
      e.winStats = $('win-stats');
      e.terminal = $('terminal-panel');
      e.termSlots = $('term-slots');
      e.termClue = $('term-clue');
      e.termMsg = $('term-msg');
      e.debug = $('debug-panel');

      /* ---- 主菜单三入口 ---- */
      $('btn-start').addEventListener('click', function () {
        B4.audio.init(); B4.audio.ui();
        e.menu.classList.add('hidden');
        e.menuSeed.classList.remove('hidden');
        e.seedInput.focus();
      });
      $('btn-help').addEventListener('click', function () { B4.audio.init(); B4.audio.ui(); ui.show('help'); });
      $('btn-sound').addEventListener('click', function () { B4.audio.init(); B4.audio.ui(); ui.returnTo = 'menu'; ui.show('screenSound'); });

      $('btn-seed-go').addEventListener('click', function () {
        var v = e.seedInput.value.trim();
        game.startRun(v || null);
      });
      $('btn-seed-back').addEventListener('click', function () {
        B4.audio.ui();
        e.menuSeed.classList.add('hidden');
        e.menu.classList.remove('hidden');
      });
      e.seedInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); $('btn-seed-go').click(); }
      });

      /* ---- 帮助 / 音效 / 暂停 ---- */
      $('btn-help-back').addEventListener('click', function () { B4.audio.ui(); ui.show('menu'); });
      $('btn-sound-back').addEventListener('click', function () {
        B4.audio.ui();
        if (ui.returnTo === 'pause') ui.show('pause'); else ui.show('menu');
      });
      e.soundToggle.addEventListener('click', function () {
        var m = B4.audio.toggleMute();
        ui.syncSoundUI(game);
      });
      e.volumeSlider.addEventListener('input', function () {
        B4.audio.setVolume(e.volumeSlider.value / 100);
        ui.syncSoundUI(game);
      });

      $('btn-pause-resume').addEventListener('click', function () { B4.audio.ui(); game.resume(); });
      $('btn-pause-restart').addEventListener('click', function () { B4.audio.ui(); game.restartSameSeed(); });
      $('btn-pause-menu').addEventListener('click', function () { B4.audio.ui(); game.toMenu(); });
      $('btn-pause-sound').addEventListener('click', function () { B4.audio.ui(); ui.returnTo = 'pause'; ui.show('screenSound'); });

      /* ---- 失败 / 成功 ---- */
      $('btn-death-retry').addEventListener('click', function () { B4.audio.ui(); game.restartSameSeed(); });
      $('btn-death-new').addEventListener('click', function () { B4.audio.ui(); game.restartNewSeed(); });
      $('btn-death-menu').addEventListener('click', function () { B4.audio.ui(); game.toMenu(); });
      $('btn-win-retry').addEventListener('click', function () { B4.audio.ui(); game.restartSameSeed(); });
      $('btn-win-new').addEventListener('click', function () { B4.audio.ui(); game.restartNewSeed(); });
      $('btn-win-menu').addEventListener('click', function () { B4.audio.ui(); game.toMenu(); });

      /* ---- 密码终端键盘 ---- */
      var keypad = $('term-keypad');
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].forEach(function (k) {
        var b = document.createElement('button');
        b.className = 'key';
        b.textContent = k === 'clear' ? '清空' : (k === 'back' ? '⌫' : k);
        b.dataset.key = k;
        b.addEventListener('click', function () { game.terminalKey(k === 'clear' ? 'clear' : (k === 'back' ? 'back' : k)); });
        keypad.appendChild(b);
      });
      $('btn-term-submit').addEventListener('click', function () { game.terminalKey('enter'); });
      $('btn-term-close').addEventListener('click', function () { game.closeTerminal(); });

      /* ---- HUD 暂停按钮 ---- */
      e.pauseBtn.addEventListener('click', function () { game.togglePause(); });
      e.sound.addEventListener('click', function () {
        B4.audio.toggleMute(); ui.syncSoundUI(game);
      });

      this.syncSoundUI(game);
      this.show('menu');
    },

    /* ---------- 屏幕切换 ---------- */
    show: function (name) {
      var e = this.els, game = this.game;
      ['menu', 'menuSeed', 'help', 'screenSound', 'pause', 'death', 'win'].forEach(function (k) {
        if (e[k]) e[k].classList.add('hidden');
      });
      if (name === 'menu') {
        e.menu.classList.remove('hidden');
        e.menuSeed.classList.add('hidden');
      } else if (name && e[name]) {
        e[name].classList.remove('hidden');
      }
      if (name === 'menu' && game) game.state = 'menu';
    },

    hudVisible: function (v) {
      this.els.hud.classList.toggle('hidden', !v);
    },

    /* ---------- HUD ---------- */
    updateHUD: function (game) {
      var e = this.els;
      var p = game.player;
      e.barStamina.style.width = (p.stamina / CFG.STAMINA_MAX * 100) + '%';
      e.barStamina.classList.toggle('low', p.exhausted);
      e.barSanity.style.width = (game.sanity / CFG.SANITY_MAX * 100) + '%';
      e.barSanity.classList.toggle('low', game.sanity < CFG.LOW_SANITY_FX);

      e.objective.textContent = game.objective;
      var clueHtml = '';
      for (var i = 0; i < 3; i++) {
        var c = game.clues[i];
        clueHtml += '<span class="clue-chip' + (c === null ? ' empty' : '') + '">' + (c === null ? '?' : c) + '</span>';
      }
      e.clues.innerHTML = clueHtml;
      e.tapeCount.textContent = '录像带 ' + game.tapesCollected + '/3';
      e.time.textContent = fmtTime(game.timer);
      e.seed.textContent = 'Seed ' + game.seed;
      var volPct = Math.round(B4.audio.volume * 100);
      e.sound.textContent = B4.audio.muted ? '🔇 静音' : '🔊 ' + volPct + '%';
      e.sound.title = '点击切换静音（M）';

      if (game.promptText) {
        e.prompt.textContent = game.promptText;
        e.prompt.classList.remove('hidden');
      } else {
        e.prompt.classList.add('hidden');
      }
    },

    /* ---------- 提示 ---------- */
    toast: function (msg) {
      var e = this.els;
      var d = document.createElement('div');
      d.className = 'toast';
      d.textContent = msg;
      e.toasts.appendChild(d);
      while (e.toasts.children.length > 3) e.toasts.removeChild(e.toasts.firstChild);
      setTimeout(function () {
        d.classList.add('fade');
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 700);
      }, 3200);
    },

    tapeFlash: function (text) {
      var e = this.els.tapeFlash;
      e.textContent = text;
      e.classList.remove('hidden');
      clearTimeout(this._tfTimer);
      this._tfTimer = setTimeout(function () { e.classList.add('hidden'); }, 2800);
    },

    /* ---------- 密码终端 ---------- */
    openTerminal: function (game) {
      this.els.terminal.classList.remove('hidden');
      this.renderTerminal(game);
    },
    closeTerminal: function (game) {
      this.els.terminal.classList.add('hidden');
      if (game) game.terminalMsg = '';
    },
    renderTerminal: function (game) {
      var e = this.els;
      var slots = '';
      for (var i = 0; i < 3; i++) {
        var d = game.terminalInput[i];
        slots += '<span class="slot' + (d === null ? ' empty' : '') + '">' + (d === null ? '·' : d) + '</span>';
      }
      e.termSlots.innerHTML = slots;
      var clue = '已获线索：';
      for (i = 0; i < 3; i++) clue += ' 第' + (i + 1) + '位 ' + (game.clues[i] === null ? '？' : game.clues[i]);
      e.termClue.textContent = clue + '（' + game.tapesCollected + '/3 盘录像带）';
      e.termMsg.textContent = game.terminalMsg || (game.tapesCollected >= 3 ? '请输入三位密码并确认。' : '密码锁需要三盘录像带中的数字线索。');
      e.termMsg.className = game.terminalMsgType === 'err' ? 'err' : (game.terminalMsgType === 'ok' ? 'ok' : '');
      e.termMsg.id = 'term-msg';
    },

    /* ---------- 失败 / 成功 ---------- */
    showDeath: function (game, reason) {
      this.els.deathReason.textContent = reason;
      this.els.deathStats.innerHTML =
        row('本局存活时间', fmtTime(game.timer)) +
        row('已收集录像带', game.tapesCollected + ' / 3') +
        row('本局 Seed', game.seed);
      this.show('death');
    },
    showWin: function (game) {
      var s = game.stats;
      this.els.winStats.innerHTML =
        row('逃离用时', fmtTime(game.timer)) +
        row('移动距离', Math.round(game.player.distMoved * 1.5) + ' 米') +
        row('冲刺次数', s.sprints + ' 次') +
        row('被实体发现', s.spotted + ' 次') +
        row('本局 Seed', game.seed);
      this.show('win');
    },

    /* ---------- 音效设置同步 ---------- */
    syncSoundUI: function (game) {
      var e = this.els;
      e.volumeSlider.value = Math.round(B4.audio.volume * 100);
      e.volumeVal.textContent = Math.round(B4.audio.volume * 100) + '%';
      e.soundToggle.textContent = B4.audio.muted ? '🔇 音效已关闭' : '🔊 音效已开启';
      e.soundToggle.classList.toggle('off', B4.audio.muted);
      if (game) {
        var volPct = Math.round(B4.audio.volume * 100);
        e.sound.textContent = B4.audio.muted ? '🔇 静音' : '🔊 ' + volPct + '%';
      }
    },

    /* ---------- 调试面板（仅 ?debug=1） ---------- */
    updateDebug: function (game) {
      if (!game.debugOn) return;
      var e = this.els.debug;
      if (!game.map) {
        e.innerHTML = '调试面板待命 —— 开始一局游戏后显示：<br>地图连通性 / 玩家坐标 / 实体状态 / 寻路路线 / 物品坐标 / Seed<br>' + errLine();
        return;
      }
      var p = game.player, en = game.enemy, m = game.map;
      var expPct = 0;
      if (game.lightmap) {
        var c = 0, arr = game.lightmap.explored;
        for (var i = 0; i < arr.length; i++) c += arr[i];
        expPct = Math.round(c / arr.length * 100);
      }
      var fps = game.fps.toFixed(0), ft = game.frameMs.toFixed(1);
      var tapes = m.tapes.map(function (t) { return '#' + t.order + '(' + t.x + ',' + t.y + ')' + (t.taken ? '✔' : ''); }).join(' ');
      var pathLen = en.path ? (en.path.length - en.pathI) : 0;
      e.innerHTML =
        'FPS ' + fps + ' | 帧 ' + ft + 'ms | 时间 ' + fmtTime(game.timer) + '<br>' +
        'Seed ' + game.seed + ' | 指纹 ' + m.mapHash + ' | 生成尝试 ' + m.attempts + '<br>' +
        '连通性 ' + m.connectivity + ' | 已探索 ' + expPct + '%<br>' +
        '玩家 (' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')格 ' + (p.sprinting ? '冲刺' : (p.moving ? '行走' : '静止')) +
        ' | 体力 ' + Math.round(p.stamina) + ' | 理智 ' + Math.round(game.sanity) + '<br>' +
        '实体 (' + en.x.toFixed(1) + ',' + en.y.toFixed(1) + ')格 状态 ' + en.state +
        ' | 路径 ' + pathLen + ' 节点 | 实体数 2<br>' +
        '物品 ' + tapes + ' | 终端(' + m.terminal.tx + ',' + m.terminal.ty + ') 出口(' + m.exit.tx + ',' + m.exit.ty + ')' + (m.exit.unlocked ? '✔' : '🔒') + '<br>' +
        '覆盖层: F1网格 F2视线 F3实体路径 F4物品点 | 调试API: __B4.debug.*' +
        '<br>' + errLine();
    }
  };

  function row(k, v) { return '<div class="stat-row"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function errLine() {
    if (window.__pageErrors && window.__pageErrors.length) {
      return '<span style="color:#e08a6a">页面报错 ' + window.__pageErrors.length + ' 条: ' +
        String(window.__pageErrors[window.__pageErrors.length - 1]).replace(/</g, '&lt;') + '</span>';
    }
    return '<span style="color:#7ea87e">页面报错 0 条</span>';
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  B4.ui = ui;
})();
