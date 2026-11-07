/* =====================================================================
 * model.js —— DGX B300 整机程序化建模（纯几何，零外部资产）
 * 参考产品图：黑色近立方体机箱 / 上下两层可插拔计算托盘 /
 *            顶面米色拉手标签 / 前面板穿孔通风网 / 底部外露主板
 *
 * 对外：window.B300_MODEL.build(scene) -> 控制器对象
 * ===================================================================== */
(function () {
  'use strict';
  var T = window.THREE;
  var W = 6.0, D = 5.0, H = 5.4;   // 宽(X) 深(Z) 高(Y)

  /* ------------------------------------------------------------------
   * 程序化纹理
   * ------------------------------------------------------------------ */
  function perforatedTexture(rx, ry) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    // 高对比：中灰底板 + 近黑孔洞，既作 map 也作 emissiveMap，
    // 保证暗光下网格仍可辨；孔洞不能太密，否则投影时会混叠成一片灰。
    g.fillStyle = '#67727f'; g.fillRect(0, 0, 128, 128);
    for (var y = 8; y < 128; y += 16) {
      for (var x = 8; x < 128; x += 16) {
        g.fillStyle = '#04060a';
        g.beginPath(); g.arc(x, y, 5.4, 0, Math.PI * 2); g.fill();
      }
    }
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }

  function stripeTexture(rx, ry) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#12161d'; g.fillRect(0, 0, 128, 128);
    for (var y = 4; y < 128; y += 9) {
      g.fillStyle = '#04060b'; g.fillRect(0, y, 128, 4);
      g.fillStyle = 'rgba(130,140,155,.08)'; g.fillRect(0, y + 4, 128, 1);
    }
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  }

  /* ------------------------------------------------------------------
   * 材质库
   * ------------------------------------------------------------------ */
  function M(color, metalness, roughness, extra) {
    var o = { color: color, metalness: metalness, roughness: roughness };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new T.MeshStandardMaterial(o);
  }
  var MAT = {
    shell:     M('#12161c', .55, .62),
    shellDark: M('#0b0e13', .50, .68),
    edge:      M('#1d232c', .68, .46),
    beige:     M('#bda987', .26, .55),   // 产品图顶面米色拉手
    beigeDark: M('#8d7c5e', .42, .48),
    stripe:    M('#2b323b', .42, .64, { map: stripeTexture(3, 16) }),
    pcb:       M('#0a1210', .16, .84),
    pcbDark:   M('#07110d', .16, .86),
    gold:      M('#a88732', .80, .34),
    goldDim:   M('#755f28', .75, .42),
    chip:      M('#15191f', .32, .62),
    chipTop:   M('#5c6572', .70, .42),
    silver:    M('#666f7c', .70, .42),
    copper:    M('#8f5c2f', .78, .38),
    gpuBody:   M('#152318', .35, .60),
    gpuGreen:  M('#4a7a1c', .28, .60),
    fan:       M('#1b2028', .40, .64),
    fanBlade:  M('#262d38', .32, .70),
    bluePort:  M('#1f527d', .38, .55),
    black:     M('#07090d', .28, .78)
  };

  /* ------------------------------------------------------------------
   * build
   * ------------------------------------------------------------------ */
  function build(scene) {
    var root = new T.Group();
    scene.add(root);

    var parts = {};          // id -> { id, group, segments[], meshes[], materials[] }
    var pickables = [];      // 可被点选的 mesh
    var shellMats = [];      // 外壳材质（透视模式改透明度）
    var helper = null;

    function part(id) {
      var p = { id: id, group: new T.Group(), segments: [], meshes: [], materials: [], _mc: {} };
      p.group.name = 'part:' + id;
      root.add(p.group);
      parts[id] = p;
      return p;
    }

    /* seg: 部件内一个可独立拆解的子组 */
    function seg(p, x, y, z, ex, ey, ez) {
      var g = new T.Group();
      g.position.set(x, y, z);
      p.group.add(g);
      p.segments.push({ g: g, base: new T.Vector3(x, y, z), vec: new T.Vector3(ex || 0, ey || 0, ez || 0) });
      return g;
    }

    /* add: 往子组里放一个 mesh，材质按「部件 × 基础材质」独享 clone */
    function add(p, g, geo, baseMat, x, y, z, rx, ry, rz, isShell) {
      var key = baseMat.uuid;
      if (!p._mc[key]) {
        var m = baseMat.clone();
        m.userData = { baseEmissive: 0x000000 };
        p._mc[key] = m;
        p.materials.push(m);
        if (isShell) shellMats.push(m);
      }
      var mesh = new T.Mesh(geo, p._mc[key]);
      mesh.position.set(x || 0, y || 0, z || 0);
      if (rx) mesh.rotation.x = rx;
      if (ry) mesh.rotation.y = ry;
      if (rz) mesh.rotation.z = rz;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = p.id;
      g.add(mesh);
      p.meshes.push(mesh);
      pickables.push(mesh);
      return mesh;
    }

    function box(p, g, w, h, d, mat, x, y, z, opt) {
      opt = opt || {};
      return add(p, g, new T.BoxGeometry(w, h, d), mat, x, y, z,
        opt.rx, opt.ry, opt.rz, opt.shell);
    }
    function cyl(p, g, rt, rb, h, mat, x, y, z, opt) {
      opt = opt || {};
      return add(p, g, new T.CylinderGeometry(rt, rb, h, opt.sides || 12), mat,
        x, y, z, opt.rx, opt.ry, opt.rz, opt.shell);
    }
    function torus(p, g, r, tube, mat, x, y, z, opt) {
      opt = opt || {};
      return add(p, g, new T.TorusGeometry(r, tube, 8, 24), mat,
        x, y, z, opt.rx, opt.ry, opt.rz, opt.shell);
    }

    /* ================= 01 机箱框架 ================= */
    var ch = part('chassis');
    var chBase = seg(ch, 0, 0, 0, 0, -2.1, 0);
    box(ch, chBase, W, .18, D, MAT.shellDark, 0, -2.62, 0, { shell: true });
    box(ch, chBase, W - .3, .12, D - .3, MAT.edge, 0, 0, 0, { shell: true });
    // 四角立柱
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        box(ch, chBase, .18, H - .2, .18, MAT.edge, sx * (W / 2 - .1), 0, sz * (D / 2 - .1), { shell: true });
      });
    });
    // 前部抽拉把手（产品图左前方那根横杆）
    box(ch, chBase, W + .35, .09, .09, MAT.silver, 0, -2.35, D / 2 + .22, { shell: true });
    // 顶部框架条：留出米色拉手可见
    var chTop = seg(ch, 0, 0, 0, 0, 3.4, 0);
    [-1, 1].forEach(function (sz) {
      box(ch, chTop, W, .13, .18, MAT.shellDark, 0, 2.62, sz * (D / 2 - .09), { shell: true });
    });
    for (var i = 0; i < 7; i++) {
      box(ch, chTop, .07, .11, D - .3, MAT.shellDark, -3 + i, 2.62, 0, { shell: true });
    }
    // 左右侧板（各自独立飞出）
    [-1, 1].forEach(function (sx) {
      var s = seg(ch, 0, 0, 0, sx * 3.6, .2, 0);
      box(ch, s, .12, H - .35, D - .1, MAT.shell, sx * W / 2, 0, 0, { shell: true });
      box(ch, s, .045, 2.2, D - .8, MAT.shellDark, sx * (W / 2 + .08), .3, 0, { shell: true });
    });
    // 后板
    var chBack = seg(ch, 0, 0, 0, 0, 0, -3.4);
    box(ch, chBack, W - .2, H - .35, .12, MAT.shellDark, 0, 0, -D / 2, { shell: true });

    /* ================= 02 / 03 上下两层计算托盘 ================= */
    function buildTrays(p, cy, eyBase) {
      var xs = [-2.5, -1.5, -.5, .5, 1.5, 2.5];
      // 穿孔网用 emissiveMap 补一点自发光，避免暗光下孔洞与底板糊成一片
      var vtex = perforatedTexture(3, 6);
      var ventMat = M('#2c333c', .40, .68, {
        map: vtex, emissive: 0x9aa7b6, emissiveMap: vtex, emissiveIntensity: .70
      });
      xs.forEach(function (x, i) {
        var s = seg(p, 0, 0, 0, x * .62, eyBase + (i % 2) * .35, .9);
        // 托盘主体
        box(p, s, .86, 2.05, 4.2, MAT.shellDark, x, cy, 0, {});
        // 顶面散热条纹
        box(p, s, .84, .025, 4.05, MAT.stripe, x, cy + 1.04, 0, {});
        // 米色拉手标签（产品图最显眼的特征，加宽加高以在投影中可辨）
        box(p, s, .68, .07, 3.50, MAT.beige, x, cy + 1.095, 0, {});
        box(p, s, .34, .010, .055, MAT.beigeDark, x, cy + 1.134, -.95, {});
        // 前面板小通风区 + 拉手
        box(p, s, .78, 1.55, .045, ventMat, x, cy + .05, 2.13, {});
        box(p, s, .62, .15, .10, MAT.beigeDark, x, cy - .82, 2.17, {});
        // 侧面导轨
        box(p, s, .05, 1.9, 3.9, MAT.edge, x + .45, cy, 0, {});
      });
    }
    buildTrays(part('trayTop'), 1.30, 2.7);
    buildTrays(part('trayBottom'), -1.30, -1.4);

    /* ================= 04 B300 GPU 模组（core 模式主角） ================= */
    var gp = part('gpu');
    var gx = [-2.1, -.7, .7, 2.1], gz = [-1.15, 1.15];
    gz.forEach(function (z, row) {
      gx.forEach(function (x, col) {
        var s = seg(gp, 0, 0, 0, x * .45, .7 + row * .55, z * .5);
        box(gp, s, 1.22, .30, 1.62, MAT.gpuBody, x, -.15, z, {});
        box(gp, s, 1.10, .07, 1.48, MAT.silver, x, .03, z, {});
        box(gp, s, .52, .012, .16, MAT.gpuGreen, x, .075, z - .55, {});
        box(gp, s, .16, .10, 1.62, MAT.gold, x + .55, -.15, z, {});
      });
    });

    /* ================= 05 前面板通风网 / 风扇墙 ================= */
    var ve = part('vent');
    var veFront = seg(ve, 0, 0, 0, 0, 0, 3.6);
    var panelX = [-2.0, 0, 2.0], panelY = [1.25, -1.25];
    var ptex = perforatedTexture(7, 9);
    var pm = M('#303841', .40, .68, {
      map: ptex, emissive: 0xa8b4c2, emissiveMap: ptex, emissiveIntensity: .72
    });
    panelY.forEach(function (y) {
      panelX.forEach(function (x) {
        box(ve, veFront, 1.90, 2.40, .055, MAT.shellDark, x, y, D / 2 + .02, { shell: true });
        box(ve, veFront, 1.82, 2.32, .06, pm, x, y, D / 2 + .06, { shell: true });
      });
    });
    // 风扇墙：每块面板后方一组风扇
    var veFan = seg(ve, 0, 0, 0, 0, 0, 2.0);
    panelY.forEach(function (y) {
      panelX.forEach(function (x) {
        torus(ve, veFan, .66, .075, MAT.fan, x, y, 2.18, {});
        cyl(ve, veFan, .14, .14, .10, MAT.edge, x, y, 2.18, { rx: Math.PI / 2 });
        for (var b = 0; b < 5; b++) {
          var a = b * Math.PI * 2 / 5;
          box(ve, veFan, .16, .52, .035, MAT.fanBlade,
            x + Math.sin(a) * .33, y + Math.cos(a) * .33, 2.18,
            { rz: -a, ry: .28 });
        }
      });
    });

    /* ================= 06 主板基板 ================= */
    var bb = part('baseboard');
    var bbMain = seg(bb, 0, 0, 0, 0, -2.6, 1.0);
    box(bb, bbMain, 5.8, .12, 5.6, MAT.pcb, 0, -2.52, .15, {});
    box(bb, bbMain, 5.8, .02, 5.6, MAT.pcbDark, 0, -2.455, .15, {});
    // 前缘金色高速连接器（产品图底部可见的一排接口）
    for (var q = 0; q < 12; q++) {
      box(bb, bbMain, .34, .09, .34, MAT.gold, -2.6 + q * .47, -2.38, 2.55, {});
    }
    // 内存插槽
    for (var mi = 0; mi < 8; mi++) {
      box(bb, bbMain, .12, .13, 1.55, MAT.pcbDark, -2.2 + mi * .62, -2.36, .55, {});
    }
    // 电容 / 供电元件
    for (var ci = 0; ci < 12; ci++) {
      cyl(bb, bbMain, .075, .075, .17, MAT.silver,
        -2.4 + (ci % 6) * .95, -2.32, ci < 6 ? -1.55 : 1.85, { sides: 8 });
    }
    // 散热片
    [-2.35, 2.35].forEach(function (x) {
      for (var f = 0; f < 5; f++) {
        box(bb, bbMain, .34, .26, .055, MAT.chipTop, x, -2.28, -1.6 + f * .16, {});
      }
    });

    /* ================= 07 Grace CPU 与内存 ================= */
    var cp = part('cpu');
    var cpSeg = seg(cp, 0, 0, 0, 0, -1.5, -1.0);
    [-1.55, 1.55].forEach(function (x) {
      box(cp, cpSeg, 1.15, .16, 1.15, MAT.chip, x, -2.35, -.75, {});
      box(cp, cpSeg, .95, .035, .95, MAT.chipTop, x, -2.255, -.75, {});
      for (var k = 0; k < 4; k++) {
        box(cp, cpSeg, .10, .12, .78, MAT.gpuBody, x - .78 + k * .52, -2.33, .25, {});
      }
    });

    /* ================= 08 NVLink 交换芯片 ================= */
    var nl = part('nvlink');
    var nlSeg = seg(nl, 0, 0, 0, 0, -1.0, 1.9);
    box(nl, nlSeg, 1.55, .24, 1.55, MAT.chip, 0, -2.30, .35, {});
    box(nl, nlSeg, 1.35, .04, 1.35, MAT.silver, 0, -2.16, .35, {});
    box(nl, nlSeg, .72, .012, .72, MAT.gold, 0, -2.135, .35, {});

    /* ================= 09 冗余电源 ================= */
    var ps = part('psu');
    [-2.1, -.7, .7, 2.1].forEach(function (x, i) {
      var s = seg(ps, 0, 0, 0, x * .3, .6, -2.9);
      box(ps, s, 1.25, 1.05, 1.45, MAT.shell, x, 1.15, -1.95, {});
      torus(ps, s, .42, .055, MAT.fan, x, 1.15, -2.69, {});
      box(ps, s, .90, .12, .09, MAT.gold, x, .55, -2.70, {});
    });

    /* ================= 10 网络与 I/O 接口 ================= */
    var io = part('io');
    var ioSeg = seg(io, 0, 0, 0, 0, -.5, -2.5);
    for (var n = 0; n < 4; n++) {
      box(io, ioSeg, .95, .52, .18, MAT.bluePort, -1.65 + n * 1.1, -1.65, -2.58, {});
      box(io, ioSeg, .78, .30, .04, MAT.black, -1.65 + n * 1.1, -1.65, -2.69, {});
    }
    for (var p2 = 0; p2 < 8; p2++) {
      box(io, ioSeg, .16, .20, .06, MAT.gold, -2.3 + p2 * .65, -2.25, -2.60, {});
    }

    /* ================= 11 液冷冷板与管路 ================= */
    var co = part('cooling');
    var coSeg = seg(co, 0, 0, 0, 0, 1.7, 0);
    [-1.85, 1.85].forEach(function (z, j) {
      cyl(co, coSeg, .075, .075, 5.4, j === 0 ? MAT.copper : MAT.silver,
        0, .10, z, { rz: Math.PI / 2, sides: 10 });
    });
    gx.forEach(function (x) {
      cyl(co, coSeg, .045, .045, 3.5, MAT.copper, x, .10, 0,
        { rx: Math.PI / 2, sides: 8 });
      box(co, coSeg, .9, .05, 1.1, MAT.silver, x, -.02, 0, {});
    });

    /* ================= 散热风道气流（教学动画） ================= */
    var airflow = { group: new T.Group(), arrows: [], t: 0 };
    airflow.group.visible = false;
    root.add(airflow.group);
    // 用有实体粗细的细管代替 1px 线，并始终绘制在最上层，
    // 保证气流在半透外壳与内部部件之前依然清晰可见（教学示意优先）。
    var overlay = { transparent: true, depthTest: false, depthWrite: false };
    var blueLine = new T.MeshBasicMaterial(Object.assign({ color: 0x4ea8ff, opacity: .60 }, overlay));
    var orangeLine = new T.MeshBasicMaterial(Object.assign({ color: 0xff8a3c, opacity: .60 }, overlay));
    var blueArrow = new T.MeshBasicMaterial(Object.assign({ color: 0x74c0ff, opacity: .95 }, overlay));
    var orangeArrow = new T.MeshBasicMaterial(Object.assign({ color: 0xffa765, opacity: .95 }, overlay));
    var tubeGeo = new T.CylinderGeometry(.023, .023, 4.2, 6);
    var coneGeo = new T.ConeGeometry(.17, .48, 7);
    var axs = [-2.2, -.75, .75, 2.2], ays = [-1.4, 0, 1.4];
    ays.forEach(function (y, ri) {
      axs.forEach(function (x, ci) {
        [[2.1, blueLine], [-2.1, orangeLine]].forEach(function (l) {
          var tube = new T.Mesh(tubeGeo, l[1]);
          tube.rotation.x = Math.PI / 2;
          tube.position.set(x, y, l[0]);
          tube.renderOrder = 999;
          airflow.group.add(tube);
        });
        for (var k = 0; k < 3; k++) {
          var cone = new T.Mesh(coneGeo, blueArrow);
          cone.rotation.x = -Math.PI / 2;   // 尖端指向 -Z
          cone.renderOrder = 1000;
          cone.userData = { phase: (k / 3 + (ri * 4 + ci) * .07) % 1, x: x, y: y };
          airflow.group.add(cone);
          airflow.arrows.push(cone);
        }
      });
    });

    /* ================= 控制器 ================= */
    function applyExplode(t) {
      for (var id in parts) {
        parts[id].segments.forEach(function (s) {
          s.g.position.set(
            s.base.x + s.vec.x * t,
            s.base.y + s.vec.y * t,
            s.base.z + s.vec.z * t
          );
        });
      }
      if (helper) helper.update();
    }

    function setPartVisible(id, v) {
      if (parts[id]) parts[id].group.visible = v;
    }

    function setShellOpacity(v) {
      var opaque = v >= .98;
      shellMats.forEach(function (m) {
        m.transparent = !opaque;
        m.opacity = v;
        m.depthWrite = opaque;
        m.needsUpdate = true;
      });
    }

    function clearHighlight() {
      for (var id in parts) {
        parts[id].materials.forEach(function (m) {
          if (m.emissive) m.emissive.setHex(0x000000);
        });
      }
      if (helper) { scene.remove(helper); helper.geometry.dispose(); helper = null; }
    }

    function highlight(id) {
      clearHighlight();
      if (!id || !parts[id]) return;
      parts[id].materials.forEach(function (m) {
        if (m.emissive) m.emissive.setHex(0x5a3d0a);
      });
      helper = new T.BoxHelper(parts[id].group, 0xd9a441);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = .9;
      scene.add(helper);
    }

    function updateAirflow(dt, playing, speed) {
      if (!airflow.group.visible) return;
      if (playing) airflow.t += dt * .22 * (0.4 + speed * .6);
      airflow.arrows.forEach(function (a) {
        var f = (airflow.t + a.userData.phase) % 1;
        var z = 4.2 - f * 8.4;
        a.position.set(a.userData.x, a.userData.y, z);
        a.material = z > 0 ? blueArrow : orangeArrow;
      });
    }

    function resetAirflow() { airflow.t = 0; }

    applyExplode(0);

    return {
      root: root, parts: parts, pickables: pickables, airflow: airflow,
      shellMats: shellMats,
      partCount: Object.keys(parts).length,
      applyExplode: applyExplode,
      setPartVisible: setPartVisible,
      setShellOpacity: setShellOpacity,
      highlight: highlight,
      clearHighlight: clearHighlight,
      updateAirflow: updateAirflow,
      resetAirflow: resetAirflow,
      updateHelper: function () { if (helper) helper.update(); }
    };
  }

  window.B300_MODEL = { build: build };
})();
