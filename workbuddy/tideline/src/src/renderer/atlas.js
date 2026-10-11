/* =====================================================================
 * TIDELINE · renderer/atlas.js
 * MVP 占位图集：程序化生成（不等真实美术资产）。
 * 图集以 **艺术像素** 为单位绘制（1 canvas px = 1 art px = 2 design px），
 * 因此上传后以 NEAREST 采样、按 art px 尺寸绘制，天然硬边。
 * 资产替换只需保证图块坐标对齐偶数（ADR-002 §4）。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C, U = TL.U;
  var PAL = C.PAL, XP = C.XPAL;

  var ATLAS_W = 512, ATLAS_H = 320;

  /* ---------- ASCII 图章绘制（小素材用，可读性好） ---------- */
  function stamp(p, rows, cmap, ox, oy) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row.charAt(c);
        if (ch === '.' || ch === ' ') continue;
        var col = cmap[ch];
        if (!col) continue;
        p(ox + c, oy + r, 1, 1, col);
      }
    }
  }

  /* ================= 鲨鱼（逐列程序化，84x40 art px，朝右） ================= */
  function sharkProfile(u) {
    // u: 0 = 吻端(右)，1 = 尾端(左)
    var c = 0.34, h;
    if (u < c) {
      var s = (c - u) / c;
      h = Math.pow(Math.max(0, 1 - s * s), 0.55) * (1 - 0.30 * s * s);
    } else {
      var s2 = (u - c) / (1 - c);
      h = Math.pow(Math.max(0, 1 - s2 * s2), 0.62);
    }
    var hh = 15.0 * h;
    if (u > 0.03 && u < 0.94) hh = Math.max(hh, 2.2);
    return hh;
  }
  function sharkSpine(u) {
    return 20 + 3.0 * Math.sin(Math.min(1, u * 1.1) * Math.PI)
      - (u > 0.72 ? 2.2 * (u - 0.72) / 0.28 : 0);
  }

  /* 鲨鱼画布：84x40 本体 + 每边 8 art px 外扩（容纳 3px 描边与鳍尖溢出） */
  var SH_CW = 100, SH_CH = 56, SH_PADX = 8, SH_PADY = 8;

  function drawShark(p, open) {
    var W = 84, H = 40;
    var OX = SH_PADX, OY = SH_PADY;
    /* §4.1.3 配色：背侧 #4A5A6E 雾灰 → #6E7C8C 中灰（上深下浅）；
       腹侧 #C7CFD8 银灰 → #F2F5F8 纸白；描边 #0A0E17 深渊黑 3px */
    var top = PAL.STEEL, mid = PAL.ASH, belly = PAL.PALE, hi = PAL.WHITE;
    var fin = PAL.SLATE, dk = PAL.BLACK, mouth = PAL.DEEP2;
    var x, u, hh, sp, yT, yB, band;

    /* 先收集图元，最后统一补 3px 外描边（验收项 P-06） */
    var cells = [];
    function q(ax, ay, aw, ah, col) { cells.push(ax | 0, ay | 0, aw | 0, ah | 0, col); }

    // 躯干
    for (x = 0; x < W; x++) {
      u = 1 - x / (W - 1);
      hh = sharkProfile(u);
      if (hh <= 0.15) continue;
      sp = sharkSpine(u);
      yT = Math.round(sp - hh); yB = Math.round(sp + hh);
      if (yB < yT) yB = yT;
      q(x, yT, 1, yB - yT + 1, mid);
      band = Math.max(1, Math.round(hh * 0.42));
      if (band * 2 < (yB - yT + 1)) {
        q(x, yT, 1, band, top);
        q(x, yB - band + 1, 1, band, belly);
        if (band >= 3) q(x, yB, 1, 1, hi);      // 腹侧最下高光（§4.1.3 腹侧 → 纸白）
      }
    }

    // 尾鳍（新月形，尾端最高）
    for (x = 0; x <= 13; x++) {
      var k = x / 13;
      var up = 16 * (1 - 0.55 * k), dn = 9 * (1 - 0.55 * k);
      sp = sharkSpine(1 - x / (W - 1));
      q(x, Math.round(sp - up), 1, Math.round(up + dn), x < 4 ? fin : mid);
    }
    q(0, 3, 2, 3, fin);   // 上叶尖加暗

    // 背鳍
    for (x = 31; x <= 52; x++) {
      var t = (52 - x) / 21;
      var fh = 12 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 1.1);
      if (fh < 0.6) continue;
      u = 1 - x / (W - 1); hh = sharkProfile(u); sp = sharkSpine(u);
      q(x, Math.round(sp - hh - fh), 1, Math.ceil(fh) + 1, fin);
    }
    // 胸鳍（腹面，后掠）
    for (x = 46; x <= 64; x++) {
      var t2 = (64 - x) / 18;
      var fh2 = 9 * Math.pow(Math.sin(Math.PI * Math.pow(t2, 0.7)), 1.0);
      if (fh2 < 0.6) continue;
      u = 1 - x / (W - 1); hh = sharkProfile(u); sp = sharkSpine(u);
      q(x, Math.round(sp + hh), 1, Math.ceil(fh2), fin);
    }
    // 第二背鳍 / 臀鳍
    for (x = 14; x <= 23; x++) {
      u = 1 - x / (W - 1); hh = sharkProfile(u); sp = sharkSpine(u);
      q(x, Math.round(sp - hh - 4), 1, 4, fin);
    }
    for (x = 17; x <= 25; x++) {
      u = 1 - x / (W - 1); hh = sharkProfile(u); sp = sharkSpine(u);
      q(x, Math.round(sp + hh), 1, 3, fin);
    }

    // 鳃裂
    for (var gi = 0; gi < 3; gi++) {
      var gx = 66 - gi * 3;
      u = 1 - gx / (W - 1); sp = sharkSpine(u);
      q(gx, Math.round(sp - 4), 1, 5, fin);
    }

    // 眼（眼白 + 瞳）—— 黑色喜剧：死鱼眼，不做凶相
    var ex = 76;
    u = 1 - ex / (W - 1); sp = sharkSpine(u);
    q(ex, Math.round(sp - 4), 2, 2, hi);
    q(ex + 1, Math.round(sp - 4) + 1, 1, 1, dk);

    // 嘴
    if (open) {
      for (x = 69; x <= 83; x++) {
        u = 1 - x / (W - 1); hh = sharkProfile(u);
        if (hh < 0.8) continue;
        sp = sharkSpine(u);
        var tt = (x - 69) / 14;
        var mh = hh * (0.35 + 0.75 * tt);
        var y0 = Math.round(sp + hh * 0.05);
        q(x, y0, 1, Math.max(1, Math.round(mh)), mouth);
        if ((x % 4) === 1) q(x, y0, 1, 2, hi);   // 齿（喜剧，非獠牙）
      }
    } else {
      for (x = 70; x <= 82; x++) {
        u = 1 - x / (W - 1); hh = sharkProfile(u);
        if (hh < 1) continue;
        sp = sharkSpine(u);
        q(x, Math.round(sp + hh * 0.62), 1, 1, dk);
      }
    }

    /* ---- 3px 深渊黑外描边（P-06：鲨鱼描边 3px #0A0E17）---- */
    var m = new Uint8Array(SH_CW * SH_CH), i, cx, cy, dx, dy, nx, ny;
    for (i = 0; i < cells.length; i += 5) {
      var ax = cells[i] + OX, ay = cells[i + 1] + OY;
      var aw = cells[i + 2], ah = cells[i + 3];
      for (cy = ay; cy < ay + ah; cy++) {
        if (cy < 0 || cy >= SH_CH) continue;
        for (cx = ax; cx < ax + aw; cx++) {
          if (cx < 0 || cx >= SH_CW) continue;
          m[cy * SH_CW + cx] = 1;
        }
      }
    }
    var ring = new Uint8Array(SH_CW * SH_CH);
    for (cy = 0; cy < SH_CH; cy++) {
      for (cx = 0; cx < SH_CW; cx++) {
        if (!m[cy * SH_CW + cx]) continue;
        for (dy = -3; dy <= 3; dy++) {
          ny = cy + dy; if (ny < 0 || ny >= SH_CH) continue;
          for (dx = -3; dx <= 3; dx++) {
            nx = cx + dx; if (nx < 0 || nx >= SH_CW) continue;
            ring[ny * SH_CW + nx] = 1;
          }
        }
      }
    }
    // 按行合并连续段，减少 fillRect 调用
    for (cy = 0; cy < SH_CH; cy++) {
      cx = 0;
      while (cx < SH_CW) {
        if (ring[cy * SH_CW + cx] && !m[cy * SH_CW + cx]) {
          var run = cx;
          while (cx < SH_CW && ring[cy * SH_CW + cx] && !m[cy * SH_CW + cx]) cx++;
          p(run, cy, cx - run, 1, dk);
        } else cx++;
      }
    }

    /* ---- 实体像素（覆盖描边内侧）---- */
    for (i = 0; i < cells.length; i += 5) {
      p(cells[i] + OX, cells[i + 1] + OY, cells[i + 2], cells[i + 3], cells[i + 4]);
    }
  }

  /* ================= 素材定义 ================= */
  function build() {
    var cv = document.createElement('canvas');
    cv.width = ATLAS_W; cv.height = ATLAS_H;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);

    var defs = {};
    var px = 2, py = 2, rowH = 0;

    function alloc(w, h) {
      if (px + w + 2 > ATLAS_W) { px = 2; py += rowH + 2; rowH = 0; }
      var r = { x: px, y: py, w: w, h: h };
      px += w + 2; if (h > rowH) rowH = h;
      return r;
    }
    function add(name, w, h, fn) {
      var rect = alloc(w, h);
      ctx.save();
      ctx.beginPath(); ctx.rect(rect.x, rect.y, w, h); ctx.clip();
      ctx.translate(rect.x, rect.y);
      var p = function (x, y, ww, hh2, col) { ctx.fillStyle = col; ctx.fillRect(x | 0, y | 0, ww | 0, hh2 | 0); };
      fn(p, w, h);
      ctx.restore();
      defs[name] = rect;
      return rect;
    }

    /* ---- 鲨鱼 ---- */
    add('shark', SH_CW, SH_CH, function (p) { drawShark(p, false); });
    add('shark_bite', SH_CW, SH_CH, function (p) { drawShark(p, true); });

    /* ---- 猎物 ---- */
    var CM = {
      '.': null, S: XP.SKIN, s: XP.SKIN, H: XP.HAIR, E: PAL.BLACK,
      T: PAL.CYAN, W: PAL.WHITE, A: PAL.AMBER, G: XP.GOLD, L: PAL.BLOOD
    };

    add('swimmer', 12, 18, function (p) {
      stamp(p, [
        '....HHHH....',
        '...HHHHHH...',
        '...HSSSSH...',
        '...SSSSSS...',
        '...SESSES...',
        '...SSSSSS...',
        '..SSSSSSSS..',
        '.SSSSSSSSSS.',
        'SS.SSSSSS.SS',
        'SS.SSSSSS.SS',
        '...TTTTTT...',
        '...TTTTTT...',
        '...SS..SS...',
        '...SS..SS...',
        '..SS....SS..',
        '.WWWWWWWWWW.',
        'WW.WWWWWW.WW',
        '..WW....WW..'
      ], CM, 0, 0);
    });

    add('surfer', 20, 16, function (p) {
      stamp(p, [
        '.......HHH..........',
        '......HHHHH.........',
        '......HSSSH.........',
        '......SSSSS.........',
        '......SESSE.........',
        '.....SSSSSSS........',
        '..S..SSSSSSS..S.....',
        '.SSS.SSSSSSS.SSS....',
        '..S..TTTTTTT..S.....',
        '.....TTTTTTT........',
        '.....SS...SS........',
        '....SS.....SS.......',
        '...SS.......SS......',
        '.AAAAAAAAAAAAAAAAAA.',
        'AAAAAAAAAAAAAAAAAAAA',
        '.WWWWWWWWWWWWWWWWWW.'
      ], CM, 0, 0);
    });

    add('sunbather', 20, 10, function (p) {
      stamp(p, [
        '..HHH...............',
        '..SSS...............',
        '..SES....TTTTTT.....',
        '..SSS..TTTTTTTTTT...',
        '...SSSSSSSSSSSSSSS..',
        '...SSSSSSSSSSSSSSS..',
        '..SSSSSSSSSSSSSSSS..',
        '..SS..SS.......SS...',
        '.WWWWWWWWWWWWWWWWWW.'
      ], CM, 0, 0);
    });

    add('lifeguard', 12, 17, function (p) {
      stamp(p, [
        '....HHHH....',
        '...HHHHHH...',
        '...HSSSSH...',
        '...SSSSSS...',
        '...SESSES...',
        '...SSSSSS...',
        '..AAAAAAAA..',
        '..AAWWWWAA..',
        '..AAAAAAAA..',
        '..AAAAAAAA..',
        '..AAAAAAAA..',
        '...WWWWWW...',
        '...SS..SS...',
        '...SS..SS...',
        '..SS....SS..',
        '.WWWWWWWWWW.'
      ], CM, 0, 0);
    });

    add('carried', 12, 12, function (p) {
      stamp(p, [
        '..SS....SS..',
        '...SSSSSS...',
        '..SSSSSSSS..',
        '...SESSES...',
        '...SSSSSS...',
        '..TTTTTTTT..',
        '..TTTTTTTT..',
        '...SSSSSS...',
        '...SS..SS...',
        '..SS....SS..',
        '.SS......SS.'
      ], CM, 0, 0);
    });

    /* ---- 敌人 / 障碍 ---- */
    add('tire', 16, 12, function (p) {
      p(0, 3, 16, 6, PAL.SLATE);
      p(2, 1, 12, 10, PAL.SLATE);
      p(3, 0, 10, 12, PAL.SLATE);
      p(5, 3, 6, 6, PAL.DEEP);
      p(6, 4, 4, 4, PAL.DEEP);
      p(4, 2, 1, 1, PAL.PALE); p(11, 8, 1, 1, PAL.PALE);
    });

    add('crate', 14, 11, function (p) {
      p(0, 0, 14, 11, XP.SAND_DK);
      p(1, 1, 12, 9, XP.WOOD);
      p(1, 4, 12, 1, XP.SAND_DK);
      p(1, 8, 12, 1, XP.SAND_DK);
      p(4, 1, 1, 9, XP.SAND_DK);
      p(9, 1, 1, 9, XP.SAND_DK);
    });

    add('buoy', 10, 10, function (p) {
      p(2, 0, 6, 1, PAL.AMBER);
      p(1, 1, 8, 2, PAL.AMBER);
      p(0, 3, 10, 4, PAL.AMBER);
      p(1, 7, 8, 2, PAL.AMBER);
      p(2, 9, 6, 1, PAL.AMBER);
      p(3, 2, 4, 2, PAL.WHITE);
      p(2, 4, 6, 2, PAL.WHITE);
      p(3, 7, 4, 1, PAL.WHITE);
    });

    add('jetski', 36, 16, function (p) {
      // 船体
      p(4, 8, 28, 5, PAL.PALE);
      p(2, 10, 32, 3, PAL.WHITE);
      p(6, 13, 24, 2, PAL.SLATE);
      p(0, 9, 5, 3, PAL.PALE);
      p(32, 7, 4, 4, PAL.AMBER);
      // 骑手
      p(14, 2, 4, 4, XP.HAIR);
      p(14, 5, 4, 4, XP.SKIN);
      p(13, 6, 1, 3, XP.SKIN); p(18, 6, 1, 3, XP.SKIN);
      p(14, 9, 4, 2, '#D94F4F');
      // 尾流
      p(0, 14, 8, 2, PAL.WHITE);
      p(2, 12, 4, 1, PAL.PALE);
    });

    add('heli', 46, 18, function (p) {
      // 旋翼
      p(2, 0, 42, 1, PAL.SLATE);
      p(22, 1, 2, 2, PAL.SLATE);
      // 机身
      p(14, 3, 16, 8, PAL.DEEP2);
      p(12, 5, 20, 5, PAL.DEEP2);
      p(10, 6, 4, 3, PAL.DEEP2);
      // 舱窗
      p(15, 5, 8, 4, PAL.CYAN);
      p(15, 5, 8, 1, PAL.WHITE);
      // 尾撑 + 尾桨
      p(30, 6, 12, 2, PAL.DEEP2);
      p(41, 2, 2, 8, PAL.SLATE);
      p(38, 4, 8, 1, PAL.SLATE);
      // 起落橇
      p(14, 11, 2, 3, PAL.SLATE);
      p(26, 11, 2, 3, PAL.SLATE);
      p(10, 13, 22, 1, PAL.SLATE);
      // 探照灯
      p(12, 13, 3, 2, PAL.AMBER);
    });

    add('tower', 26, 30, function (p) {
      // 支腿
      p(2, 14, 2, 14, XP.WOOD);
      p(22, 14, 2, 14, XP.WOOD);
      p(8, 14, 2, 14, XP.WOOD);
      p(16, 14, 2, 14, XP.WOOD);
      p(2, 20, 22, 1, XP.SAND_DK);
      // 平台
      p(0, 10, 26, 4, XP.SAND_DK);
      p(0, 10, 26, 1, XP.SAND);
      // 顶棚
      p(1, 2, 24, 2, PAL.WHITE);
      p(3, 4, 20, 2, '#D94F4F');
      p(12, 0, 2, 2, PAL.WHITE);
      // 救生员
      p(10, 6, 5, 4, XP.HAIR);
      p(10, 9, 5, 4, PAL.AMBER);
      p(10, 9, 5, 1, PAL.WHITE);
    });

    /* ---- 太阳（ALARM 档位的冗余形态通道，GDD-02 §3.2） ---- */
    function drawSun(p, mood) {
      p(3, 0, 10, 1, PAL.AMBER); p(1, 1, 14, 1, PAL.AMBER);
      p(0, 2, 16, 1, PAL.AMBER); p(0, 3, 16, 3, PAL.AMBER);
      p(0, 6, 16, 4, PAL.AMBER); p(1, 10, 14, 2, PAL.AMBER);
      p(3, 12, 10, 1, PAL.AMBER);
      // 光芒
      p(7, 0, 2, 1, PAL.AMBER); p(0, 7, 1, 2, PAL.AMBER); p(15, 7, 1, 2, PAL.AMBER);
      if (mood === 0) {        // 微笑
        p(4, 6, 2, 2, PAL.BLACK); p(10, 6, 2, 2, PAL.BLACK);
        p(4, 9, 8, 1, PAL.BLACK); p(3, 8, 1, 1, PAL.BLACK); p(12, 8, 1, 1, PAL.BLACK);
      } else if (mood === 1) { // 平静
        p(4, 6, 2, 2, PAL.BLACK); p(10, 6, 2, 2, PAL.BLACK);
        p(5, 9, 6, 1, PAL.BLACK);
      } else {                 // 皱眉
        p(4, 6, 2, 2, PAL.BLACK); p(10, 6, 2, 2, PAL.BLACK);
        p(3, 5, 3, 1, PAL.BLACK); p(10, 5, 3, 1, PAL.BLACK);
        p(4, 10, 8, 1, PAL.BLACK); p(5, 9, 1, 1, PAL.BLACK); p(10, 9, 1, 1, PAL.BLACK);
      }
    }
    add('sun_calm', 16, 13, function (p) { drawSun(p, 0); });
    add('sun_alert', 16, 13, function (p) { drawSun(p, 1); });
    add('sun_siege', 16, 13, function (p) { drawSun(p, 2); });

    /* ---- 粒子 / 通用 ---- */
    function solid(color) {
      return function (p, w, h) { p(0, 0, w, h, color); };
    }
    add('dot1', 1, 1, solid(PAL.WHITE));
    add('dot2', 2, 2, solid(PAL.WHITE));
    add('dot3', 3, 3, solid(PAL.WHITE));
    add('dot4', 4, 4, solid(PAL.WHITE));
    add('foam', 8, 3, function (p) {
      p(1, 0, 6, 1, PAL.PALE);
      p(0, 1, 8, 1, PAL.WHITE);
      p(1, 2, 6, 1, PAL.PALE);
    });
    add('ring8', 8, 8, function (p) {
      for (var i = 0; i < 8; i++) {
        p(i, 0, 1, 1, PAL.WHITE); p(i, 7, 1, 1, PAL.WHITE);
        p(0, i, 1, 1, PAL.WHITE); p(7, i, 1, 1, PAL.WHITE);
      }
    });

    /* ---------------- 副循环收集物（GDD-01 §3.5 冲浪收集） ----------------
     * 分值 瓶子 10 / 星星 20 / 圆环 30（C.COLLECT.SCORE 的索引顺序）。
     * 三者必须靠**轮廓**区分而非仅靠颜色 —— 灰度下也要能一眼认出来。 */
    add('bottle', 10, 14, function (p) {
      p(4, 0, 2, 3, XP.GOLD);                 // 瓶盖
      p(3, 3, 4, 8, XP.TEAL);                 // 瓶颈 + 瓶身
      p(3, 4, 1, 7, PAL.PALE);                // 高光边
      p(3, 11, 4, 3, XP.TEAL);                // 瓶底加宽
    });
    add('star', 13, 13, function (p) {
      var rows = [
        '......#......',
        '.....###.....',
        '.....###.....',
        '#############',
        '.###########.',
        '..#########..',
        '...#######...',
        '...#######...',
        '..#########..',
        '..###...###..',
        '.###.....###.',
        '.##.......##.',
        '.#.........#.'
      ];
      stamp(p, rows, { '#': XP.GOLD }, 0, 0);
    });
    add('pickup_ring', 14, 12, function (p) {
      // 水面上的圈：椭圆环，顶边亮（明度梯度，灰度可辨）
      var i;
      for (i = 0; i < 14; i++) {
        p(i, 0, 1, 1, PAL.WHITE);
        p(i, 6, 1, 1, XP.GOLD);
      }
      for (i = 0; i < 7; i++) {
        p(0, i, 1, 1, PAL.WHITE); p(13, i, 1, 1, XP.GOLD);
      }
      p(3, 3, 2, 1, PAL.PALE); p(9, 2, 2, 1, PAL.PALE);
    });

    return { canvas: cv, defs: defs, w: ATLAS_W, h: ATLAS_H };
  }

  TL.buildAtlas = build;
})();
