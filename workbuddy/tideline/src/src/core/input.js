/* =====================================================================
 * TIDELINE · core/input.js
 * 1.5 个输入自由度（GDD-01 §3.1）：方向（连续）+ 冲刺（离散点按）。
 * 键盘 / 触屏同源；触屏按 GDD-01 E6 管理 pointerId —— anchor 只由第一根
 * 手指设定，第二根手指点按 = 冲刺，避免「想冲刺却突然转向」。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});

  var keys = Object.create(null);
  var dirX = 0, dirY = 0;
  var dashFlag = false;
  var pauseFlag = false;
  var muteFlag = false;
  var confirmFlag = false;
  var taps = [];

  var dragId = null, ax = 0, ay = 0, downT = 0, moved = 0;
  var DEADZONE = 12, TAP_MS = 220;

  /* 焦点是否落在表单控件上（菜单 / 设置面板内的按钮与勾选框）。 */
  function typingUI() {
    var a = document.activeElement;
    if (!a || !a.tagName) return false;
    var t = a.tagName.toUpperCase();
    return t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' ||
      t === 'TEXTAREA' || t === 'A';
  }

  function onKeyDown(e) {
    var k = e.key;

    /* 焦点在按钮/控件上时放行原生行为 —— 否则空格无法激活聚焦的按钮
     * （Enter 可以、空格不行），这是可访问性缺陷。
     * 例外：Esc / P / M 是全局功能，任何时候都必须可用。 */
    if (typingUI() && !(k === 'Escape' || k === 'p' || k === 'P' || k === 'm' || k === 'M')) return;

    if (k === ' ' || k === 'Spacebar') {
      if (!e.repeat) { dashFlag = true; taps.push(performance.now()); }
      e.preventDefault();
      return;
    }
    if (k === 'j' || k === 'J') { if (!e.repeat) { dashFlag = true; taps.push(performance.now()); } return; }
    if (k === 'Escape' || k === 'p' || k === 'P') { pauseFlag = true; return; }
    if (k === 'm' || k === 'M') { muteFlag = true; return; }
    if (k === 'Enter') { confirmFlag = true; return; }
    keys[k.toLowerCase()] = true;
    if (k.indexOf('Arrow') === 0) e.preventDefault();
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }
  /* 失焦：除方向外，**必须一并清掉待消费的一次性标志**。
   * 否则「按住空格切出去 → 切回来」会凭空触发一次冲刺；
   * 结算页按过 Enter 再切走，回来还可能直接重开一局。 */
  function onBlur() {
    keys = Object.create(null);
    dirX = dirY = 0; dragId = null;
    dashFlag = false; pauseFlag = false; muteFlag = false; confirmFlag = false;
    taps.length = 0;
  }

  function localPos(e, el) {
    var r = el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * TL.C.DESIGN_W,
      y: (e.clientY - r.top) / r.height * TL.C.DESIGN_H
    };
  }

  /* ⭐ 判定「这次指针按下落在 UI 上」。
   *
   * 为什么必须有这个判断：在 pointerdown 上调 preventDefault() 会按规范
   * **抑制随后的兼容鼠标事件（mousedown / mouseup / click）**。
   * 菜单按钮位于 #stage 内部，事件冒泡到 stage 的处理器就被掐断 ——
   * 结果是「鼠标点不动任何菜单按钮」，而程序化的 el.click() 却能正常触发，
   * 所以纯 DOM 级测试**永远发现不了**这个缺陷（必须真实指针点击才能暴露）。
   */
  function onUI(target, root) {
    for (var n = target; n && n !== root; n = n.parentNode) {
      if (!n.tagName) continue;
      var tag = n.tagName.toUpperCase();
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
        tag === 'LABEL' || tag === 'A' || tag === 'TEXTAREA') return true;
      if (n.id === 'screens') return true;      // 任何覆盖层内部一律交给 UI
    }
    return false;
  }

  function bind(el) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', function (e) {
      if (onUI(e.target, el)) return;            // 放行 UI，绝不 preventDefault
      if (dragId === null) {
        dragId = e.pointerId;
        var p = localPos(e, el);
        ax = p.x; ay = p.y; downT = performance.now(); moved = 0;
        try { el.setPointerCapture(e.pointerId); } catch (err) { }
      } else {
        // 第二根手指 → 冲刺 / QTE 连打
        dashFlag = true; taps.push(performance.now());
      }
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== dragId) return;
      var p = localPos(e, el);
      var dx = p.x - ax, dy = p.y - ay;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > moved) moved = len;
      if (len < DEADZONE) { dirX = 0; dirY = 0; return; }
      dirX = dx / len; dirY = dy / len;
      e.preventDefault();
    });
    function up(e) {
      if (e.pointerId !== dragId) return;
      var dt = performance.now() - downT;
      if (dt < TAP_MS && moved < DEADZONE) {
        dashFlag = true; taps.push(performance.now());
      }
      dragId = null;
      dirX = 0; dirY = 0;   // E6：不自动接管，保持上一帧 θ
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function update() {
    var kx = 0, ky = 0;
    if (keys['arrowleft'] || keys['a']) kx -= 1;
    if (keys['arrowright'] || keys['d']) kx += 1;
    if (keys['arrowup'] || keys['w']) ky -= 1;
    if (keys['arrowdown'] || keys['s']) ky += 1;
    if (kx || ky) {
      var l = Math.sqrt(kx * kx + ky * ky);
      dirX = kx / l; dirY = ky / l;
    } else if (dragId === null) {
      dirX = 0; dirY = 0;
    }
  }

  TL.Input = {
    bind: bind,
    update: update,
    get dirX() { return dirX; },
    get dirY() { return dirY; },
    get hasDir() { return (dirX * dirX + dirY * dirY) > 0.0001; },
    consumeDash: function () { var d = dashFlag; dashFlag = false; return d; },
    takeTaps: function () { var t = taps; taps = []; return t; },
    consumePause: function () { var p = pauseFlag; pauseFlag = false; return p; },
    consumeMute: function () { var m = muteFlag; muteFlag = false; return m; },
    consumeConfirm: function () { var c = confirmFlag; confirmFlag = false; return c; },
    clear: function () { dashFlag = false; taps.length = 0; dirX = dirY = 0; },
    reset: onBlur
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
})();
