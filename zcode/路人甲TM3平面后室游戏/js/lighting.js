/* ============================================================
 * lighting.js —— 光照与黑暗系统
 * · 每格 RGB 光照，光沿地板 BFS 扩散、被墙体阻挡
 * · 玩家随身微光 + 荧光灯（闪烁/损坏）+ 安全屋暖光 + 出口绿光
 * · 走过并照亮的区域留下极微弱“记忆光”，代替完整小地图
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};
  var CFG = B4.CFG;
  var PAL = CFG.PAL;

  function frac(x) { return x - Math.floor(x); }
  function hash2(a, b) { return frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453); }

  /** 荧光灯闪烁曲线（确定性，可用时间回放） */
  B4.lampFlicker = function (lamp, t) {
    var s = lamp.flickerSeed;
    var v = 0.84 + 0.16 * Math.sin(t * 9.1 + s * 0.13) * Math.sin(t * 23.7 + s * 0.031);
    if (hash2(s, Math.floor(t * 3.2)) < 0.055) v *= 0.22; // 偶发骤暗
    return Math.max(0.05, Math.min(1, v));
  };

    B4.Lightmap = function (map) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    this.rgb = new Float32Array(this.w * this.h * 3);
    this.env = new Float32Array(this.w * this.h); // 环境光（不含玩家随身微光），供理智系统使用
    this.explored = new Uint8Array(this.w * this.h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx2d = this.canvas.getContext('2d');
    this.img = this.ctx2d.createImageData(this.w, this.h);
  };

  B4.Lightmap.prototype = {
    reset: function () {
      var n = this.w * this.h * 3;
      for (var i = 0; i < n; i += 3) {
        this.rgb[i] = PAL.dark[0]; this.rgb[i + 1] = PAL.dark[1]; this.rgb[i + 2] = PAL.dark[2];
      }
      this.env.fill(0);
    },

    /** 从 (tx,ty) 沿地板 BFS 扩散光，墙体阻挡；取 max 混合 */
    addLight: function (tx, ty, radius, color, intensity, isEnv) {
      if (intensity <= 0.01) return;
      var map = this.map, W = this.w, H = this.h;
      var rgb = this.rgb, env = this.env;
      var maxSteps = Math.ceil(radius);
      var stepDecay = intensity / (maxSteps + 1);
      var qx = [tx], qy = [ty], qd = [0];
      var head = 0;
      var seen = {};
      seen[ty * W + tx] = 1;
      while (head < qx.length) {
        var cx = qx[head], cy = qy[head], cd = qd[head];
        head++;
        var v = intensity - cd * stepDecay;
        if (v <= 0.01) continue;
        var ci = (cy * W + cx) * 3;
        if (v > rgb[ci]) rgb[ci] = v * color[0];
        if (v > rgb[ci + 1]) rgb[ci + 1] = v * color[1];
        if (v > rgb[ci + 2]) rgb[ci + 2] = v * color[2];
        if (isEnv && v > env[cy * W + cx]) env[cy * W + cx] = v;
        if (cd >= maxSteps) continue;
        var nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (var i = 0; i < 4; i++) {
          var nx = nb[i][0], ny = nb[i][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var ni = ny * W + nx;
          if (seen[ni]) continue;
          if (map.tiles[ni] !== 0) continue; // 墙/家具挡光
          seen[ni] = 1;
          qx.push(nx); qy.push(ny); qd.push(cd + 1);
        }
      }
    },

    /** 记录已探索（被照亮的格子），并写入记忆微光与安全屋基础亮度 */
    finalize: function (t) {
      var W = this.w, H = this.h, n = W * H;
      var rgb = this.rgb, exp = this.explored, map = this.map;
      for (var i = 0; i < n; i++) {
        var lum = rgb[i * 3] * 0.5 + rgb[i * 3 + 1] * 0.6 + rgb[i * 3 + 2] * 0.4;
        if (lum > 0.3) exp[i] = 1;
        if (exp[i]) {
          if (rgb[i * 3] < CFG.EXPLORED_MIN) rgb[i * 3] = CFG.EXPLORED_MIN;
          if (rgb[i * 3 + 1] < CFG.EXPLORED_MIN * 0.97) rgb[i * 3 + 1] = CFG.EXPLORED_MIN * 0.97;
          if (rgb[i * 3 + 2] < CFG.EXPLORED_MIN * 0.94) rgb[i * 3 + 2] = CFG.EXPLORED_MIN * 0.94;
        }
        if (map.safeSet[i]) {
          if (rgb[i * 3] < CFG.SAFE_MIN * PAL.lightSafe[0]) rgb[i * 3] = CFG.SAFE_MIN * PAL.lightSafe[0];
          if (rgb[i * 3 + 1] < CFG.SAFE_MIN * PAL.lightSafe[1]) rgb[i * 3 + 1] = CFG.SAFE_MIN * PAL.lightSafe[1];
          if (rgb[i * 3 + 2] < CFG.SAFE_MIN * PAL.lightSafe[2]) rgb[i * 3 + 2] = CFG.SAFE_MIN * PAL.lightSafe[2];
        }
      }
      // 出口解锁：绿光标示（轻微穿透，作为方向指引）
      if (map.exit.unlocked) {
        this.addLight(map.exit.tx, map.exit.ty, 3.2, PAL.lightExit, 0.85);
        this.addLight(map.exit.floorTx, map.exit.floorTy, 2.4, PAL.lightExit, 0.7);
      }
      var d = this.img.data;
      for (i = 0; i < n; i++) {
        d[i * 4] = Math.min(255, rgb[i * 3] * 255) | 0;
        d[i * 4 + 1] = Math.min(255, rgb[i * 3 + 1] * 255) | 0;
        d[i * 4 + 2] = Math.min(255, rgb[i * 3 + 2] * 255) | 0;
        d[i * 4 + 3] = 255;
      }
      this.ctx2d.putImageData(this.img, 0, 0);
    },

    /** 某格当前亮度（0..1） */
    lightAt: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0;
      var i = (ty * this.w + tx) * 3;
      return Math.max(this.rgb[i], this.rgb[i + 1], this.rgb[i + 2]);
    },
    /** 某格环境光亮度（不含玩家随身微光），供理智系统判定“黑暗区域” */
    envLightAt: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0;
      return this.env[ty * this.w + tx];
    }
  };
})();
