/* =====================================================================
 * TIDELINE · ui/hud.js
 * DOM HUD（ADR-001 §2.3）+ Title / Pause / Results / Options 屏幕。
 *
 * 可访问性硬红线②：颜色永不作为唯一信息通道。
 *   ALARM 等级 = 条长度（连续）+ 刻度形状（25/50/75 缺口）+ 音效 + 文字
 *   是否携带   = 鲨鱼姿态 + 战利品格子数 + 水花拖尾（canvas 侧）
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;

  var el = {};
  var opts = null;
  var lastTier = -1;

  function $(id) { return document.getElementById(id); }

  function init(options) {
    opts = options;
    ['scoreVal', 'pendingVal', 'tierName', 'alarmNum', 'alarmFill', 'alarmA11y',
      'stamina', 'carry', 'comboBox', 'zoneBox', 'prompt', 'toasts', 'bankBar',
      'screens', 'panel', 'dangerEdge', 'stage'].forEach(function (k) { el[k] = $(k); });

    for (var i = 0; i < C.STAMINA_MAX; i++) {
      var d = document.createElement('div'); d.className = 'pip'; el.stamina.appendChild(d);
    }
    for (var j = 0; j < C.CARRY_MAX; j++) {
      var c = document.createElement('div'); c.className = 'pip'; el.carry.appendChild(c);
    }
    applyOptionClasses();
  }

  function applyOptionClasses() {
    var h = document.documentElement;
    h.classList.toggle('cb', !!opts.colorblind);
    h.classList.toggle('no-crt', !opts.crt);
    h.classList.toggle('no-flash', !opts.flash);
    h.classList.toggle('rm', !!opts.reducedMotion);
  }

  /* ---------------- 每帧更新 ---------------- */
  function update(G) {
    var s = G.shark;

    el.scoreVal.textContent = G.banked;
    el.pendingVal.textContent = '未兑现 ' + G.pendingScore + '（' + G.pendingCount + ' 个）';

    /* ALARM：长度 + 数值 + 刻度 + 档位名 */
    var a = G.alarm;
    el.alarmNum.textContent = Math.round(a);
    el.alarmFill.style.width = a.toFixed(1) + '%';
    el.tierName.textContent = C.TIER_NAME[G.tier] + ' T' + G.tier;
    if (G.tier !== lastTier) {
      lastTier = G.tier;
      document.documentElement.style.setProperty('--accent',
        G.tier >= 3 ? 'var(--blood)' : (G.tier >= 1 ? 'var(--amber)' : 'var(--white)'));
      el.alarmA11y.textContent = '通缉等级 ' + C.TIER_NAME[G.tier];
    }
    el.dangerEdge.classList.toggle('on', G.tier >= 3 && !G.over);

    /* 体力三格（离散，不做平滑条 —— 街机感） */
    var pips = el.stamina.children;
    for (var i = 0; i < pips.length; i++) {
      var filled = s.stamina >= (i + 1) - 0.001;
      var partial = s.stamina > i && s.stamina < i + 1;
      pips[i].classList.toggle('on', filled);
      pips[i].classList.toggle('low', !filled && partial);
      // 最后一格：2Hz 呼吸式脉动（关闭「闪烁」时改常亮，不留无反馈死区）
      if (!filled && partial && opts.flash && !opts.reducedMotion) {
        pips[i].style.opacity = (0.35 + 0.5 * U.breath(G.time, 2)).toFixed(3);
      } else {
        pips[i].style.opacity = '1';
      }
    }

    /* 战利品格子（数得出来的冗余通道） */
    var cp = el.carry.children;
    for (var j = 0; j < cp.length; j++) cp[j].classList.toggle('on', j < s.carryK);

    el.comboBox.innerHTML = 'COMBO ×' + G.comboMult().toFixed(1) +
      '<small>' + G.combo + ' 连击 · 上限 ×' + C.COMBO.M_CAP.toFixed(1) + '</small>';
    el.zoneBox.textContent = '区域：' + C.ZONE_NAME[s.zone] +
      (s.surf ? '（冲浪中 ×1.25）' : '') + '　|　速度 ' + Math.round(s.speed) + ' px/s' +
      (s.carryK > 0 ? '　|　携带 ' + s.carryK + '/4（速率 ×' + C.CARRY_V(s.carryK).toFixed(2) + '）' : '');

    /* 中央提示 */
    var p = '';
    if (G.qte.active) {
      var left = Math.max(0, G.qte.window - G.qte.t);
      p = '连打！ ' + G.qte.count + ' / ' + G.qte.need +
        '<small>剩余 ' + left.toFixed(1) + ' s　·　空格 / 点击画布</small>';
    } else if (s.strandWarn) {
      p = '正在陷进沙里！' + '<small>立刻按「冲刺」脱困（−1 体力）</small>';
    } else if (G.bankT > 0 && s.carryK > 0) {
      p = '结算中…' + '<small>' + (G.bankT / C.BANK.DIGEST * 100).toFixed(0) + '%</small>';
    } else if (s.state === 'stunned') {
      p = '眩晕' + '<small>' + s.stunT.toFixed(1) + ' s</small>';
    } else if (s.state === 'snared') {
      p = '被渔网束缚' + '<small>' + s.snareT.toFixed(1) + ' s</small>';
    }
    el.prompt.innerHTML = p;

    /* Bank 进度条 */
    if (G.bankT > 0 && s.carryK > 0) {
      el.bankBar.style.display = 'block';
      el.bankBar.firstElementChild.style.width =
        Math.min(100, G.bankT / C.BANK.DIGEST * 100).toFixed(0) + '%';
    } else {
      el.bankBar.style.display = 'none';
    }

    /* Toast */
    var html = '';
    for (var k = 0; k < G.toasts.length; k++) {
      var t = G.toasts[k];
      var op = U.clamp(2.6 - t.t, 0, 1);
      html += '<div class="toast" style="opacity:' + op.toFixed(2) + '">' + t.text + '</div>';
    }
    el.toasts.innerHTML = html;
  }

  /* ---------------- 屏幕 ---------------- */
  var OPT_LABELS = [
    ['shake', '屏幕震动'],
    ['flash', '屏幕闪烁（脉动）'],
    ['jitter', '扫描线抖动'],
    ['crt', 'CRT 后期（弯曲/色差）'],
    ['colorblind', '色盲模式（血红→电光蓝）'],
    ['qteAssist', 'QTE 辅助（3 次 / 3.5s）'],
    ['mute', '静音'],
    ['music', '背景音乐'],
    ['integerSnap', '整数倍缩放（大黑边）']
  ];

  function optsHtml() {
    var h = '<div class="opts">';
    for (var i = 0; i < OPT_LABELS.length; i++) {
      var k = OPT_LABELS[i][0], label = OPT_LABELS[i][1];
      h += '<label class="opt"><input type="checkbox" data-opt="' + k + '"' +
        (opts[k] ? ' checked' : '') + '>' + label + '</label>';
    }
    h += '<label class="opt">粒子密度 <select data-opt="particles">' +
      '<option value="1"' + (opts.particles === 1 ? ' selected' : '') + '>100%</option>' +
      '<option value="0.5"' + (opts.particles === 0.5 ? ' selected' : '') + '>50%</option>' +
      '<option value="0"' + (opts.particles === 0 ? ' selected' : '') + '>0%（保留顿帧/动画）</option>' +
      '</select></label>';
    h += '</div>';
    return h;
  }

  function bindOpts() {
    var nodes = el.panel.querySelectorAll('[data-opt]');
    for (var i = 0; i < nodes.length; i++) {
      (function (n) {
        var key = n.getAttribute('data-opt');
        var ev = n.tagName === 'SELECT' ? 'change' : 'change';
        n.addEventListener(ev, function () {
          opts[key] = n.tagName === 'SELECT' ? parseFloat(n.value) : n.checked;
          if (key === 'mute') TL.Audio.setMuted(opts.mute);
          if (key === 'music') TL.Audio.setMusicEnabled(opts.music);
          if (key === 'particles') TL.FX.setDensity(opts.particles);
          applyOptionClasses();
          TL.Audio.play('ui');
        });
      })(nodes[i]);
    }
  }

  function showScreen(html) {
    el.panel.innerHTML = html;
    el.screens.classList.add('show');
    bindOpts();
    var first = el.panel.querySelector('button');
    if (first) first.focus();
  }
  function hideScreen() { el.screens.classList.remove('show'); }
  function visible() { return el.screens.classList.contains('show'); }

  function title() {
    showScreen(
      '<h1>潮线 TIDELINE</h1>' +
      '<div class="tag">MVP 垂直切片 · PHASE 5 · 核心循环验证</div>' +
      '<p>你是一条鲨鱼。你<b>永远不能停下</b>——你只能决定往哪儿游（GDD-01 §3.1）。<br>' +
      '冲上沙滩叼走游客，顶着 ALARM 通缉逃回深海落袋。<b>被抓到、或搁浅 QTE 失败，未结算的一切全部作废。</b></p>' +
      '<div class="keys">' +
      '<b>方向</b><span>方向键 / WASD，或单指拖拽（相对位移）</span>' +
      '<b>冲刺</b><span>空格 / J，或第二指点按。咬合<b>只在冲刺中判定</b></span>' +
      '<b>声东击西</b><span>冲刺中穿出水面自动触发（−1 体力，ALARM +8）</span>' +
      '<b>搁浅 QTE</b><span>连打空格或点击画布，2.5 秒内 6 次</span>' +
      '<b>落袋</b><span>带着战利品游回深海（x &lt; 750）自动结算</span>' +
      '</div>' +
      optsHtml() +
      '<div class="note">硬红线：闪烁频率 ≤ 2 Hz 且全项目禁用硬 on/off；5 个正交开关可独立关闭（右上角暂停菜单内亦可调整）。<br>' +
      '检测到系统「减少动态效果」时会自动降级。</div>' +
      '<div class="btnrow"><button class="primary" data-act="start">开始游戏</button></div>'
    );
  }

  function pause(G) {
    showScreen(
      '<h2>已暂停</h2>' +
      '<div class="rows">' +
      '<div><span>已入账分数</span><b>' + G.banked + '</b></div>' +
      '<div><span>未兑现押注</span><b>' + G.pendingScore + '</b></div>' +
      '<div><span>ALARM</span><b>' + Math.round(G.alarm) + ' · ' + C.TIER_NAME[G.tier] + '</b></div>' +
      '</div>' +
      optsHtml() +
      '<div class="btnrow">' +
      '<button class="primary" data-act="resume">继续</button>' +
      '<button data-act="restart">重新开始</button>' +
      '</div>'
    );
  }

  function results(G) {
    var reason = {
      beached: '搁浅 · QTE 失败',
      tether: '直升机锁定满 3.0 s',
      harpoon: '被鱼叉命中'
    }[G.deathReason] || '未知';

    showScreen(
      '<h2>这一局结束了</h2>' +
      '<div class="tag">死因：' + reason + '</div>' +
      '<div class="rows">' +
      '<div><span>已入账 SCORE（保留）</span><b>' + G.banked + '</b></div>' +
      /* ⭐ 必须读 lostScore：pendingScore 在死亡/搁浅时已被清零，
         直接读它会让这一行永远显示 −0，玩家看不到自己亏了什么 */
      '<div><span class="loss">未兑现押注（作废）</span><b class="loss">−' +
      (G.lostScore || 0) + (G.lostCount ? '（' + G.lostCount + ' 个）' : '') + '</b></div>' +
      '<div><span class="loss">未兑现 COMBO</span><b class="loss">×' + (1 + C.COMBO.STEP * G.comboLost).toFixed(1) + ' → 0</b></div>' +
      '<div><span>本局最高 COMBO</span><b>' + G.comboMax + '</b></div>' +
      '<div><span>捕食 / 落袋次数</span><b>' + G.stats.grabs + ' / ' + G.stats.banks + '</b></div>' +
      '<div><span>冲浪收集</span><b>' + G.stats.collects + ' 个</b></div>' +
      '</div>' +
      '<div class="note">原子性规则：五步（潜行 → 冲刺 → 捕食 → 逃生 → 结算）走完才算数，中途死亡则本次押注全损（GDD-03 §1）。<br>' +
      'COMBO 倍率不是分数，是「待兑现的乘数」——被乘数作废，乘数自然归零（GDD-03 E2）。</div>' +
      optsHtml() +
      '<div class="btnrow"><button class="primary" data-act="restart">再来一局</button></div>'
    );
  }

  TL.HUD = {
    init: init, update: update,
    title: title, pause: pause, results: results,
    hide: hideScreen, visible: visible,
    applyOptionClasses: applyOptionClasses,
    panel: function () { return el.panel; }
  };
})();
