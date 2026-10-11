/* =====================================================================
 * TIDELINE · game/particles.js
 * 硬边方块粒子池。淡出一律走 **有序抖动**（shader 里 discard），
 * 绝不使用 alpha 渐变（ADR-004 硬约束）。
 * 尺寸只允许 1 / 2 / 3 art px（= 2 / 4 / 6 design px），保持像素纯度。
 * 对象池预分配 → 热路径零分配（ADR-001 §3.3）。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;

  var MAX = 520;
  var P = {
    x: new Float32Array(MAX), y: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    life: new Float32Array(MAX), max: new Float32Array(MAX),
    g: new Float32Array(MAX), drag: new Float32Array(MAX),
    size: new Uint8Array(MAX),           // art px
    r: new Float32Array(MAX), g_: new Float32Array(MAX), b: new Float32Array(MAX),
    add: new Uint8Array(MAX),
    n: 0
  };
  var rings = [];   // 冲击波环（DECOY BREACH）
  var density = 1;  // 粒子密度开关 0 / 0.5 / 1

  function reset() { P.n = 0; rings.length = 0; }

  function spawn(x, y, vx, vy, life, size, col, isAdd, g, drag) {
    if (density <= 0 || P.n >= MAX) return -1;
    var i = P.n++;
    P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy;
    P.life[i] = life; P.max[i] = life;
    P.g[i] = g === undefined ? 0 : g;
    P.drag[i] = drag === undefined ? 1.2 : drag;
    P.size[i] = size;
    P.r[i] = col[0]; P.g_[i] = col[1]; P.b[i] = col[2];
    P.add[i] = isAdd ? 1 : 0;
    return i;
  }

  function update(dt) {
    for (var i = P.n - 1; i >= 0; i--) {
      P.life[i] -= dt;
      if (P.life[i] <= 0) {
        var last = --P.n;
        if (i !== last) {
          P.x[i] = P.x[last]; P.y[i] = P.y[last];
          P.vx[i] = P.vx[last]; P.vy[i] = P.vy[last];
          P.life[i] = P.life[last]; P.max[i] = P.max[last];
          P.g[i] = P.g[last]; P.drag[i] = P.drag[last];
          P.size[i] = P.size[last];
          P.r[i] = P.r[last]; P.g_[i] = P.g_[last]; P.b[i] = P.b[last];
          P.add[i] = P.add[last];
        }
        continue;
      }
      P.vy[i] += P.g[i] * dt;
      var d = 1 - P.drag[i] * dt;
      if (d < 0) d = 0;
      P.vx[i] *= d; P.vy[i] *= d;
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
    }
    for (var k = rings.length - 1; k >= 0; k--) {
      var r = rings[k];
      r.t += dt;
      if (r.t >= r.dur) rings.splice(k, 1);
    }
  }

  function draw(B) {
    var sprite = ['dot1', 'dot2', 'dot3'];
    for (var i = 0; i < P.n; i++) {
      var fade = P.life[i] / P.max[i];
      var s = sprite[P.size[i] - 1] || 'dot2';
      var sz = P.size[i] * C.ART_SCALE;   // art px → design px
      B.draw(s, P.x[i], P.y[i], sz, sz, {
        tint: [P.r[i], P.g_[i], P.b[i]],
        fade: fade,
        bucket: P.add[i] ? 'add' : 'over'
      });
    }
    for (var k = 0; k < rings.length; k++) {
      var r = rings[k];
      var t = r.t / r.dur;
      var rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 2));
      var fade = 1 - t;
      var count = Math.max(8, Math.round(rad / 9));
      for (var j = 0; j < count; j++) {
        var a = (j / count) * U.TAU;
        var px = r.x + Math.cos(a) * rad;
        var py = r.y + Math.sin(a) * rad * 0.55;   // 水面处压扁
        B.draw('dot2', px, py, 4, 4, { tint: r.col, fade: fade, bucket: 'add' });
      }
    }
  }

  /* ---------------- 发射器 ---------------- */
  function scaleCount(n) {
    var c = Math.round(n * density);
    return c < 1 ? 0 : c;
  }

  function splash(x, y, count, col, power) {
    count = scaleCount(count);
    for (var i = 0; i < count; i++) {
      var a = -Math.PI * 0.15 - U.rand() * Math.PI * 0.7;
      var sp = power * (0.45 + U.rand() * 0.75);
      spawn(x + U.rr(-8, 8), y + U.rr(-4, 4),
        Math.cos(a) * sp * (U.rand() < 0.5 ? -1 : 1), Math.sin(a) * sp * 1.15,
        0.35 + U.rand() * 0.45, U.ri(1, 2), col, false, 520, 1.6);
    }
  }

  /* 捕食：洋红径向溅射（GDD-03 §5.2，0.6s，不留残留） */
  function predation(x, y) {
    var col = U.hex2rgb(C.PAL.MAGENTA);
    var n = scaleCount(22);
    for (var i = 0; i < n; i++) {
      var a = U.rand() * U.TAU;
      var sp = 90 + U.rand() * 230;
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.32 + U.rand() * 0.28, U.ri(1, 3), col, false, 120, 2.6);
    }
  }

  function sandPuff(x, y, count) {
    count = scaleCount(count);
    var col = U.hex2rgb(C.PAL.PALE);
    for (var i = 0; i < count; i++) {
      var a = -Math.PI * 0.5 + U.rr(-1.1, 1.1);
      var sp = 30 + U.rand() * 90;
      spawn(x + U.rr(-14, 14), y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.3 + U.rand() * 0.4, U.ri(1, 2), col, false, 260, 1.8);
    }
  }

  function bubble(x, y) {
    var col = U.hex2rgb(C.PAL.PALE);
    spawn(x, y, U.rr(-14, 14), U.rr(-40, -12), 0.5 + U.rand() * 0.5, 1, col, false, -20, 0.8);
  }

  /* DECOY BREACH：环形冲击波（0→180px，0.4s，在水面线处截断） */
  function shockRing(x, y, r1) {
    if (density <= 0.01) return;
    rings.push({ x: x, y: y, r0: 6, r1: r1 || 180, t: 0, dur: 0.4, col: U.hex2rgb(C.PAL.WHITE) });
  }

  function setDensity(d) { density = U.clamp(Number(d) || 0, 0, 1); if (!density) reset(); }

  TL.FX = {
    reset: reset, update: update, draw: draw,
    splash: splash, predation: predation, sandPuff: sandPuff,
    bubble: bubble, shockRing: shockRing, setDensity: setDensity,
    get count() { return P.n; }
  };
})();
