/* =====================================================================
 * TIDELINE · util.js
 * 数学 / 随机 / 安全脉动。热路径函数保持零分配。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* 最短角差，归一化到 (-180, 180] —— GDD-01 E5 */
  function angDelta(target, cur) {
    var d = (target - cur) % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  }

  /* 帧率无关的指数趋近 */
  function damp(cur, dst, rate, dt) {
    return lerp(cur, dst, 1 - Math.exp(-rate * dt));
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < (aw + bw) && Math.abs(ay - by) * 2 < (ah + bh);
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  /* ---- 随机（可播种，便于确定性回放） ---- */
  var seed = 0x2f6e2b1;
  function srand(s) { seed = (s >>> 0) || 1; }
  function rand() {
    // xorshift32
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  }
  function rr(a, b) { return a + rand() * (b - a); }
  function ri(a, b) { return Math.floor(rr(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  /* ---- 光敏性癫痫安全（硬红线①） ----
   * 全项目唯一的脉动函数。f 恒 <= 2Hz，且为呼吸式（无硬 on/off）。
   * 关闭「闪烁」开关时调用方应传 f=0（返回常亮 1.0）。
   */
  function breath(t, f) {
    var opts = TL.Game && TL.Game.opts;
    if (!f || (opts && (!opts.flash || opts.reducedMotion))) return 1.0;
    f = Math.min(Math.abs(f), TL.C.MAX_FLASH_HZ);
    return 0.8 + 0.2 * Math.sin(t * f * TAU);
  }

  /* 有序抖动（Bayer 8x8）在 shader 里做；这里只提供 CPU 侧的量化阈值表 */
  var BAYER8 = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];

  /* #RRGGBB → [r,g,b] 0..1 */
  function hex2rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* 亮度（Rec.709），用于校验「血红与洋红亮度相同」这类约束 */
  function luma(hex) {
    var c = hex2rgb(hex);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  TL.U = {
    TAU: TAU, clamp: clamp, lerp: lerp, smoothstep: smoothstep,
    angDelta: angDelta, damp: damp, aabb: aabb, dist2: dist2,
    srand: srand, rand: rand, rr: rr, ri: ri, pick: pick,
    breath: breath, BAYER8: BAYER8, hex2rgb: hex2rgb, luma: luma,
    snapArt: function (v) { return Math.round(v / TL.C.ART_SCALE) * TL.C.ART_SCALE; }
  };
})();
