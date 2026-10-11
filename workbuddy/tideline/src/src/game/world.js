/* =====================================================================
 * TIDELINE · game/world.js
 * 海床剖面（ADR-003 §2.1/§2.2）+ 水面线 + 四层水体区域。
 *
 * ⚠ 关键分离（ADR-003）：区域归属用 **静态海床**（稳定，驱动 ALARM/敌人生成），
 *   接触与搁浅判定用 **动态水面**（可玩，让潮线真正影响手感）。
 *
 * 设计取舍说明：GDD-01 用四个 X 区间（0–750/750–1650/1650–2550/2550–3000），
 * ADR-003 用「由海床水深导出」。二者在本文件合并 —— 海床控制点被推导成让
 * 导出的分界 **恰好落在 750 / 1650 / 2550**，于是单一真源与 GDD 数值同时成立。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;

  var STEP = 4;                       // LUT 采样步长（design px）
  var N = 0;
  var SEABED = null;
  var ZONE = null;
  var shoreX = 0;

  function hermite(p0, p1, m0, m1, h, t) {
    var t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0
      + (t3 - 2 * t2 + t) * h * m0
      + (-2 * t3 + 3 * t2) * p1
      + (t3 - t2) * h * m1;
  }

  function build() {
    var pts = C.SEABED_PTS, n = pts.length;
    N = Math.floor(C.WORLD_W / STEP) + 2;
    SEABED = new Float32Array(N);
    ZONE = new Uint8Array(N);

    // 非均匀 Catmull-Rom 切线
    var m = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      if (i === 0) m[i] = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
      else if (i === n - 1) m[i] = (pts[i][1] - pts[i - 1][1]) / (pts[i][0] - pts[i - 1][0]);
      else m[i] = (pts[i + 1][1] - pts[i - 1][1]) / (pts[i + 1][0] - pts[i - 1][0]);
    }

    var prev = Infinity;
    var seg = 0;
    for (var k = 0; k < N; k++) {
      var x = k * STEP;
      while (seg < n - 2 && x > pts[seg + 1][0]) seg++;
      var x0 = pts[seg][0], x1 = pts[seg + 1][0];
      var h = x1 - x0;
      var t = U.clamp((x - x0) / h, 0, 1);
      var y = hermite(pts[seg][1], pts[seg + 1][1], m[seg], m[seg + 1], h, t);
      // 单调钳制：海床随 x 单调抬升（y 单调减小），杜绝 Catmull-Rom 过冲
      if (y > prev) y = prev;
      prev = y;
      SEABED[k] = y;
    }

    // 区域表（静态水深导出）
    for (var q = 0; q < N; q++) {
      var depth = SEABED[q] - C.WATER_BASE;
      var z;
      if (depth >= C.ZONE_DEPTH_DEEP) z = C.ZONE.DEEP;
      else if (depth >= C.ZONE_DEPTH_SHALLOW) z = C.ZONE.SHALLOW;
      else if (depth > 0) z = C.ZONE.SURF;
      else z = C.ZONE.BEACH;
      ZONE[q] = z;
    }

    // 潮线：海床穿过水面处
    shoreX = C.WORLD_W;
    for (var s = 0; s < N; s++) {
      if (SEABED[s] <= C.WATER_BASE) { shoreX = s * STEP; break; }
    }
  }

  function seabedY(x) {
    if (!SEABED) build();
    var f = x / STEP;
    if (f <= 0) return SEABED[0];
    if (f >= N - 1) return SEABED[N - 1];
    var i = f | 0, t = f - i;
    return SEABED[i] + (SEABED[i + 1] - SEABED[i]) * t;
  }

  function depthAt(x) { return seabedY(x) - C.WATER_BASE; }

  function zoneAtRaw(x) {
    if (!SEABED) build();
    var i = Math.round(x / STEP);
    return ZONE[U.clamp(i, 0, N - 1)];
  }

  /* 带迟滞的区域查询：边界附近取前后 ZONE_HYST 两点，不一致则维持原值 */
  function zoneAt(x, prevZone) {
    var a = zoneAtRaw(x - C.ZONE_HYST);
    var b = zoneAtRaw(x + C.ZONE_HYST);
    if (a === b) return a;
    if (prevZone === undefined || prevZone === null) return zoneAtRaw(x);
    return prevZone;
  }

  /* 动态水面（接触/搁浅判定用） */
  function waterLineY(x, t) {
    var depth = depthAt(x);
    var damp = U.clamp(depth / 60, 0, 1);          // 浅水处波浪衰减（破浪）
    return C.WATER_BASE
      + C.WAVE_AMP * damp * Math.sin(U.TAU * (x + t * C.WAVE_SPEED) / C.WAVE_LEN);
  }

  TL.World = {
    build: build,
    seabedY: seabedY,
    depthAt: depthAt,
    zoneAt: zoneAt,
    zoneAtRaw: zoneAtRaw,
    waterLineY: waterLineY,
    get shoreX() { if (!SEABED) build(); return shoreX; },
    STEP: STEP
  };
})();
