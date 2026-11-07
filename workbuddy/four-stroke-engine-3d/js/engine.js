/* =====================================================================
 * 直列四缸四冲程发动机 · 程序化 3D 模型与运动学
 * 依赖：three.min.js (r128 UMD) + OrbitControls.js（全局 THREE）
 * 暴露：window.EngineDemo
 * ===================================================================== */
(function () {
  'use strict';

  var T = THREE;

  /* ---------- 尺寸规格（唯一真源，单位：任意教学单位） ---------- */
  var S = {
    r: 1.10,            // 曲柄半径 = 行程 / 2
    L: 3.60,            // 连杆长度（大小头中心距）
    spacing: 3.05,      // 缸心距（沿 X 轴）
    boreR: 1.00,        // 缸径半径
    linerR: 1.10,       // 缸套外半径
    headY: 5.65,        // 燃烧室顶面（缸盖底面）
    linerBottom: 2.00,  // 缸套下沿
    pistonR: 0.94,
    pistonH: 0.92,
    valveDx: 0.56,      // 气门相对缸心的 X 偏移
    valveTilt: 0.28,    // 气门倾角（弧度）
    valveLift: 0.44,    // 最大气门升程
    blockHalfX: 6.72,
    blockHalfZ: 1.66,
    shellBottom: -1.86,
    shellTop: 7.08
  };

  /* ---------- 冲程定义 ---------- */
  var STROKES = [
    { name: '进气', color: '#4ea8ff', hex: 0x4ea8ff,
      cap: '进气门打开，活塞下行，把空气与燃油混合气吸入气缸。' },
    { name: '压缩', color: '#ffc25a', hex: 0xffc25a,
      cap: '两气门关闭，活塞上行压缩混合气，温度与压强升高。' },
    { name: '做功', color: '#ff6a35', hex: 0xff6a35,
      cap: '火花塞点火，燃烧产生高温高压气体，推动活塞下行对外做功。' },
    { name: '排气', color: '#9aa6b4', hex: 0x9aa6b4,
      cap: '排气门打开，活塞上行把燃烧后的废气推出气缸。' }
  ];

  /* 点火顺序 1 → 3 → 4 → 2；power 冲程起点在本地相位 α = 360°
   * 全局曲轴角 θ 下，第 i 缸本地相位 α_i = (θ + DELTA[i]) mod 720
   * 点火(θ) = 0°:缸1 / 180°:缸3 / 360°:缸4 / 540°:缸2
   */
  var DELTA = [360, 540, 180, 0];   // 索引 0..3 对应 1..4 缸
  var FIRE_ORDER = [1, 3, 4, 2];

  var INFO = {
    block: { name: '缸体 / 外壳', desc: '容纳四个气缸的铸造壳体，内有冷却水道与润滑油道，并为曲轴、缸套提供支撑。隐藏外壳或开启剖视，就能看到内部的活塞、连杆与曲轴联动。' },
    liner: { name: '气缸套（缸壁）', desc: '气缸的圆柱形内壁，为活塞提供导向与密封面。活塞环贴着它滑动，保证压缩和做功冲程不漏气。' },
    piston: { name: '活塞', desc: '在气缸内上下往复运动，顶面是燃烧室的一部分，直接承受燃气压力。四个冲程里活塞往复 4 次，对应曲轴转 2 圈。' },
    ring: { name: '活塞环', desc: '嵌在活塞头部的弹性环，负责密封燃烧室、传热到缸壁，并刮去多余机油。' },
    pin: { name: '活塞销', desc: '连接活塞与连杆小头的销轴，允许连杆相对活塞摆动。' },
    rod: { name: '连杆', desc: '把活塞的直线推力传给曲柄销。因为曲柄销偏离主轴线，这个力产生力矩，从而把往复运动转换成旋转运动。' },
    bigend: { name: '连杆大头 / 曲柄销', desc: '连杆大头套在曲柄销上。曲柄销到主轴线的距离就是曲柄半径 r = 行程 / 2 = 1.1（本模型），它决定了活塞行程。' },
    crank: { name: '曲轴', desc: '发动机的动力输出主轴。直列四缸的 1、4 缸曲拐同相，2、3 缸同相（相差 180°），往复惯性力互相抵消，运转更平稳。' },
    web: { name: '曲柄臂 / 配重', desc: '连接主轴颈与曲柄销的臂，配重用来平衡旋转与往复惯性力。' },
    mainbearing: { name: '主轴承座', desc: '支撑曲轴主轴颈，承受燃烧压力并保持曲轴轴线位置不变。' },
    flywheel: { name: '飞轮', desc: '储存做功冲程的多余动能，靠惯性带动进气、压缩、排气三个不输出动力的冲程，并让转速更均匀。' },
    intake: { name: '进气门', desc: '只在进气冲程开启，让新鲜混合气进入气缸；压缩与做功冲程必须严密关闭，否则压力会泄掉。' },
    exhaust: { name: '排气门', desc: '只在排气冲程开启，把燃烧后的废气排出；排气结束即关闭，准备下一个循环的进气。' },
    intakeport: { name: '进气道', desc: '把空气与燃油混合气引向进气门。蓝色示意小球表示新鲜充量的流入方向。' },
    exhaustport: { name: '排气道', desc: '把废气从排气门引出。灰色示意小球表示废气流出的方向。' },
    sparkplug: { name: '火花塞', desc: '在压缩终了、活塞接近上止点时跳火点燃混合气，是做功冲程的起点。本模型四缸按 1 → 3 → 4 → 2 依次点火，曲轴每转 180° 点火一次。' },
    gas: { name: '缸内气体（示意）', desc: '用颜色与半透明体积示意缸内气体：蓝色=新鲜混合气，黄色=被压缩，橙红=燃烧膨胀，灰色=废气。' },
    platform: { name: '展示台', desc: '仅用于空间定位的展示底座，不属于发动机本体。' }
  };

  var RAD = Math.PI / 180;
  function mod(a, n) { return ((a % n) + n) % n; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 单缸状态（纯函数，UI 与 3D 共用同一真源） ---------- */
  function cylinderState(theta, i) {
    var alpha = mod(theta + DELTA[i], 720);
    var stroke = Math.floor(alpha / 180);           // 0进气 1压缩 2做功 3排气
    var beta = alpha % 360;                          // 曲柄角（0°=上止点）
    var br = beta * RAD;
    var sinb = Math.sin(br);
    var pistonY = S.r * Math.cos(br) + Math.sqrt(S.L * S.L - S.r * S.r * sinb * sinb);

    var intakeOpen = (stroke === 0);
    var exhaustOpen = (stroke === 3);
    // 升程用正弦包络，开闭更自然；边界处保留一点开度便于观察
    var liftIn = intakeOpen ? (0.16 + 0.84 * Math.sin(Math.PI * alpha / 180)) : 0;
    var liftEx = exhaustOpen ? (0.16 + 0.84 * Math.sin(Math.PI * (alpha - 540) / 180)) : 0;
    // 点火闪光只与角度有关 => 暂停在任意角度都能观察到确定状态
    var spark = Math.max(0, 1 - Math.abs(alpha - 360) / 17);

    return {
      index: i, no: i + 1, alpha: alpha, beta: beta, stroke: stroke,
      strokeName: STROKES[stroke].name,
      intakeOpen: intakeOpen, exhaustOpen: exhaustOpen,
      liftIn: liftIn, liftEx: liftEx, spark: spark,
      pistonY: pistonY,
      pistonDir: (beta < 180) ? '↓ 下行' : '↑ 上行',
      progress: (alpha % 180) / 180
    };
  }

  /* ---------- 材质 ---------- */
  function std(hex, metal, rough, extra) {
    var o = { color: hex, metalness: metal, roughness: rough };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new T.MeshStandardMaterial(o);
  }
  var M = {};
  function buildMaterials() {
    // 壳体偏暗、低金属度：剖视时作为「背景板」衬托浅色运动件，避免抢画面
    M.shell    = std(0x18222e, 0.30, 0.84, { side: T.DoubleSide });
    M.shellAlt = std(0x111924, 0.28, 0.86, { side: T.DoubleSide });
    M.rib      = std(0x2b3a4e, 0.42, 0.74);
    M.bolt     = std(0x7e8ca0, 0.80, 0.42);
    M.liner    = std(0x8ba6c2, 0.30, 0.45,
                     { transparent: true, opacity: 0.17, side: T.DoubleSide, depthWrite: false });
    M.piston   = std(0xd6dde6, 0.82, 0.28);
    M.ring     = std(0x5f6d80, 0.85, 0.35);
    M.pin      = std(0xa8b4c4, 0.90, 0.30);
    M.rod      = std(0xd9ac62, 0.85, 0.32);
    M.crank    = std(0x8796aa, 0.90, 0.30);
    M.web      = std(0x64748c, 0.88, 0.38);
    M.crankpin = std(0xffb347, 0.80, 0.30, { emissive: 0x3a2100 });
    M.bearing  = std(0x4a5a70, 0.75, 0.48);
    M.intake   = std(0x4ea8ff, 0.55, 0.34, { emissive: 0x0a2540 });
    M.exhaust  = std(0xff8a5c, 0.55, 0.38, { emissive: 0x2a0f06 });
    M.ceramic  = std(0xe9e3d1, 0.25, 0.55);
    M.plugMetal= std(0x9aa7b8, 0.85, 0.32);
    M.portIn   = std(0x3f7fc4, 0.35, 0.45, { transparent: true, opacity: 0.34, side: T.DoubleSide, depthWrite: false });
    M.portOut  = std(0x7f8c9c, 0.35, 0.45, { transparent: true, opacity: 0.34, side: T.DoubleSide, depthWrite: false });
    M.platform = std(0x070c13, 0.25, 0.92);
    M.grid     = new T.LineBasicMaterial({ color: 0x26364d, transparent: true, opacity: 0.55 });
  }

  /* ---------- 几何小工具 ---------- */
  function cylinder(rt, rb, h, seg, mat, open) {
    return new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 24, 1, !!open), mat);
  }
  function box(w, h, d, mat) { return new T.Mesh(new T.BoxGeometry(w, h, d), mat); }
  function axisX(mesh) { mesh.rotation.z = Math.PI / 2; return mesh; }

  var _a = new T.Vector3(), _b = new T.Vector3(), _d = new T.Vector3();
  var UP = new T.Vector3(0, 1, 0);
  // 把「高度为 1 的圆柱」拉伸并摆放到 a→b 之间
  function placeSegment(mesh, ax, ay, az, bx, by, bz) {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    _d.subVectors(_b, _a);
    var len = Math.max(_d.length(), 1e-5);
    _d.multiplyScalar(1 / len);
    mesh.position.copy(_a).addScaledVector(_d, len / 2);
    mesh.quaternion.setFromUnitVectors(UP, _d);
    mesh.scale.y = len;
  }

  /* =====================================================================
   * 场景初始化
   * ===================================================================== */
  function init(canvas) {
    buildMaterials();

    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;     // 剖视用局部裁剪面
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x0b111b, 1);

    var scene = new T.Scene();
    scene.background = new T.Color(0x0b111b);
    scene.fog = new T.Fog(0x0b111b, 34, 78);

    var camera = new T.PerspectiveCamera(42, 1, 0.1, 220);
    var HOME = new T.Vector3(11.5, 8.4, 16.4);
    var TARGET = new T.Vector3(0, 2.9, 0);
    camera.position.copy(HOME);

    var controls = new T.OrbitControls(camera, canvas);
    controls.target.copy(TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 8;
    controls.maxDistance = 62;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.update();

    /* --- 灯光 --- */
    scene.add(new T.AmbientLight(0xffffff, 0.40));
    scene.add(new T.HemisphereLight(0xbcd6ff, 0x1b2432, 0.62));
    var key = new T.DirectionalLight(0xfff0d8, 1.30); key.position.set(12, 18, 14); scene.add(key);
    var fill = new T.DirectionalLight(0x8ab6ff, 0.52); fill.position.set(-15, 9, 11); scene.add(fill);
    var rim = new T.DirectionalLight(0xffab63, 0.58); rim.position.set(-7, 7, -17); scene.add(rim);
    var sparkLight = new T.PointLight(0xffa03c, 0, 7, 2);
    scene.add(sparkLight);

    /* --- 展示台 --- */
    var platform = cylinder(8.6, 8.6, 0.24, 72, M.platform);
    platform.position.y = -2.48;
    platform.userData.info = INFO.platform;
    scene.add(platform);
    var grid = new T.GridHelper(48, 48, 0x35506e, 0x1d2a3c);
    grid.position.y = -2.35;
    grid.material.transparent = true; grid.material.opacity = 0.35;
    scene.add(grid);

    /* --- 分组 --- */
    var shellGroup = new T.Group();   // 可隐藏的外壳
    var linerGroup = new T.Group();   // 缸套（始终可见，剖视时裁剪）
    var innerGroup = new T.Group();   // 运动件，不参与裁剪
    scene.add(shellGroup, linerGroup, innerGroup);

    var pickables = [];
    function mark(mesh, info, isShell) {
      mesh.userData.info = info;
      if (isShell) mesh.userData.isShell = true;
      pickables.push(mesh);
      return mesh;
    }

    /* --- 剖视裁剪面：移除 z>0 的前半部分 --- */
    var clipPlane = new T.Plane(new T.Vector3(0, 0, -1), 0);
    var shellMats = [M.shell, M.shellAlt, M.bolt, M.rib];
    function setCutaway(on) {
      // 剖视=不透明壳体裁掉前半；关闭剖视=整体半透明「透视外壳」
      for (var i = 0; i < shellMats.length; i++) {
        var m = shellMats[i];
        m.clippingPlanes = on ? [clipPlane] : null;
        m.transparent = !on;
        m.opacity = on ? 1 : 0.20;
        m.depthWrite = !!on;
        m.needsUpdate = true;
      }
      // 缸套始终半透明，剖视时再裁掉前半圈
      M.liner.clippingPlanes = on ? [clipPlane] : null;
      M.liner.opacity = on ? 0.20 : 0.13;
      M.liner.needsUpdate = true;
    }

    /* ================= 外壳 / 缸体 ================= */
    var sh = S.shellTop - S.shellBottom;      // 高度
    var shy = (S.shellTop + S.shellBottom) / 2;
    var w = S.blockHalfX * 2, d = S.blockHalfZ * 2;
    var front = mark(box(w, sh, 0.15, M.shell), INFO.block, true); front.position.set(0, shy, S.blockHalfZ);
    var back = mark(box(w, sh, 0.15, M.shellAlt), INFO.block, true); back.position.set(0, shy, -S.blockHalfZ);
    var endL = mark(box(0.15, sh, d, M.shellAlt), INFO.block, true); endL.position.set(-S.blockHalfX, shy, 0);
    var endR = mark(box(0.15, sh, d, M.shellAlt), INFO.block, true); endR.position.set(S.blockHalfX, shy, 0);
    var deck = mark(box(w, 0.22, d, M.shell), INFO.block, true); deck.position.set(0, S.shellTop - 0.11, 0);
    var pan = mark(box(w, 0.22, d, M.shellAlt), INFO.block, true); pan.position.set(0, S.shellBottom + 0.11, 0);
    shellGroup.add(front, back, endL, endR, deck, pan);

    // 背板加强筋：让剖开的缸体读起来像铸件剖面，而不是一块空白平板
    var ribZ = -S.blockHalfZ + 0.13;
    [0.9, 3.3].forEach(function (ry) {
      var hr = box(w - 0.3, 0.10, 0.10, M.rib);
      hr.position.set(0, ry, ribZ);
      hr.userData.info = INFO.block; hr.userData.isShell = true;
      pickables.push(hr); shellGroup.add(hr);
    });
    [-S.spacing, 0, S.spacing].forEach(function (rx) {
      var vr = box(0.10, sh - 0.5, 0.10, M.rib);
      vr.position.set(rx, shy, ribZ);
      vr.userData.info = INFO.block; vr.userData.isShell = true;
      pickables.push(vr); shellGroup.add(vr);
    });

    // 缸盖螺栓（装饰，强化「缸体」的读感）
    for (var bx = -5.6; bx <= 5.6; bx += 1.6) {
      for (var bz = -1.15; bz <= 1.15; bz += 2.3) {
        var bolt = cylinder(0.12, 0.12, 0.16, 6, M.bolt);
        bolt.position.set(bx, S.shellTop + 0.06, bz);
        bolt.userData.isShell = true;
        shellGroup.add(bolt);
      }
    }

    /* ================= 每缸部件 ================= */
    var C = [];   // 每缸的引用集合
    var gasColors = [new T.Color(0x4ea8ff), new T.Color(0xffc25a),
                     new T.Color(0xff5f2e), new T.Color(0x9aa6b4)];
    var tmpColor = new T.Color();

    for (var i = 0; i < 4; i++) {
      var x = (i - 1.5) * S.spacing;
      var c = { x: x, parts: {} };

      /* --- 缸套 --- */
      var linerH = S.headY - S.linerBottom;
      var liner = cylinder(S.linerR, S.linerR, linerH, 44, M.liner, true);
      liner.position.set(x, S.linerBottom + linerH / 2, 0);
      mark(liner, INFO.liner, false);
      linerGroup.add(liner);

      // 缸口凸缘（属于外壳，可隐藏）
      var collar = new T.Mesh(new T.TorusGeometry(S.linerR + 0.02, 0.075, 8, 40), M.shell);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(x, S.headY - 0.02, 0);
      collar.userData.info = INFO.block; collar.userData.isShell = true;
      pickables.push(collar);
      shellGroup.add(collar);

      /* --- 活塞组 --- */
      var pistonGroup = new T.Group();
      pistonGroup.position.set(x, 4.7, 0);
      var body = cylinder(S.pistonR, S.pistonR, S.pistonH, 40, M.piston);
      mark(body, INFO.piston, false);
      pistonGroup.add(body);
      for (var ri = 0; ri < 2; ri++) {
        var ring = cylinder(S.pistonR + 0.012, S.pistonR + 0.012, 0.055, 40, M.ring, true);
        ring.position.y = 0.16 + ri * 0.15;
        mark(ring, INFO.ring, false);
        pistonGroup.add(ring);
      }
      var wrist = axisX(cylinder(0.13, 0.13, 1.55, 16, M.pin));
      mark(wrist, INFO.pin, false);
      pistonGroup.add(wrist);
      innerGroup.add(pistonGroup);
      c.pistonGroup = pistonGroup;

      /* --- 连杆（高度为 1 的圆柱，逐帧拉伸摆放） --- */
      var rod = new T.Mesh(new T.CylinderGeometry(0.15, 0.24, 1, 14), M.rod);
      mark(rod, INFO.rod, false);
      innerGroup.add(rod);
      c.rod = rod;

      var bigEnd = axisX(cylinder(0.37, 0.37, 0.30, 24, M.rod));
      mark(bigEnd, INFO.bigend, false);
      innerGroup.add(bigEnd);
      c.bigEnd = bigEnd;

      var smallEnd = axisX(cylinder(0.22, 0.22, 0.30, 20, M.rod));
      mark(smallEnd, INFO.rod, false);
      innerGroup.add(smallEnd);
      c.smallEnd = smallEnd;

      /* --- 曲拐组（绕 X 轴旋转 = 曲柄角 β） --- */
      var throwGroup = new T.Group();
      throwGroup.position.set(x, 0, 0);
      var crankPin = axisX(cylinder(0.245, 0.245, 0.92, 24, M.crankpin));
      crankPin.position.y = S.r;
      mark(crankPin, INFO.bigend, false);
      throwGroup.add(crankPin);
      [-0.47, 0.47].forEach(function (wx) {
        var web = axisX(cylinder(0.64, 0.64, 0.16, 28, M.web));
        web.position.set(wx, S.r / 2, 0);
        mark(web, INFO.web, false);
        throwGroup.add(web);
        var cw = axisX(cylinder(0.76, 0.76, 0.16, 28, M.web));
        cw.position.set(wx, -0.70, 0);
        mark(cw, INFO.web, false);
        throwGroup.add(cw);
      });
      innerGroup.add(throwGroup);
      c.throwGroup = throwGroup;

      /* --- 气门 --- */
      function makeValve(sign, mat, info) {
        var g = new T.Group();
        g.position.set(x + sign * S.valveDx, S.headY, 0);
        g.rotation.z = -sign * S.valveTilt;   // 顶部向外侧倾斜
        var stem = cylinder(0.085, 0.085, 1.30, 14, mat);
        stem.position.y = 0.65;
        mark(stem, info, false);
        g.add(stem);
        var head = cylinder(0.34, 0.27, 0.13, 24, mat);
        mark(head, info, false);
        g.add(head);
        for (var k = 0; k < 3; k++) {
          var coil = new T.Mesh(new T.TorusGeometry(0.17, 0.028, 6, 16), mat);
          coil.rotation.x = Math.PI / 2;
          coil.position.y = 0.50 + k * 0.17;
          mark(coil, info, false);
          g.add(coil);
        }
        var cap = cylinder(0.20, 0.20, 0.09, 16, M.crank);
        cap.position.y = 1.31;
        mark(cap, info, false);
        g.add(cap);
        innerGroup.add(g);
        return g;
      }
      c.intakeValve = makeValve(-1, M.intake, INFO.intake);
      c.exhaustValve = makeValve(+1, M.exhaust, INFO.exhaust);

      /* --- 火花塞 --- */
      var plug = new T.Group();
      plug.position.set(x, S.headY + 0.02, 0);
      var cer = cylinder(0.13, 0.15, 0.52, 14, M.ceramic); cer.position.y = 0.34;
      mark(cer, INFO.sparkplug, false); plug.add(cer);
      var hex = cylinder(0.18, 0.18, 0.16, 6, M.plugMetal); hex.position.y = 0.03;
      mark(hex, INFO.sparkplug, false); plug.add(hex);
      var tip = cylinder(0.055, 0.055, 0.30, 12, M.plugMetal); tip.position.y = -0.19;
      mark(tip, INFO.sparkplug, false); plug.add(tip);
      var flashMat = new T.MeshBasicMaterial({ color: 0xffd06a, transparent: true,
        opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
      var flash = new T.Mesh(new T.SphereGeometry(1, 20, 14), flashMat);
      flash.position.y = -0.34;
      flash.userData.info = INFO.sparkplug;
      pickables.push(flash);
      plug.add(flash);
      innerGroup.add(plug);
      c.flash = flash; c.flashMat = flashMat;

      /* --- 缸内气体（示意体积） --- */
      var gasMat = new T.MeshBasicMaterial({ color: 0x4ea8ff, transparent: true,
        opacity: 0.16, depthWrite: false, side: T.DoubleSide });
      var gas = cylinder(0.90, 0.90, 1, 32, gasMat, false);
      gas.userData.info = INFO.gas;
      pickables.push(gas);
      innerGroup.add(gas);
      c.gas = gas; c.gasMat = gasMat;

      /* --- 进 / 排气道 + 流动示意小球 --- */
      function makePort(sign, mat, info) {
        var pts = [
          new T.Vector3(x + sign * 2.00, S.headY + 1.02, 0),
          new T.Vector3(x + sign * 1.30, S.headY + 0.92, 0),
          new T.Vector3(x + sign * 0.70, S.headY + 0.55, 0),
          new T.Vector3(x + sign * 0.48, S.headY + 0.10, 0),
          new T.Vector3(x + sign * 0.34, S.headY - 0.55, 0)
        ];
        var curve = new T.CatmullRomCurve3(pts);
        var tube = new T.Mesh(new T.TubeGeometry(curve, 28, 0.21, 12, false), mat);
        mark(tube, info, false);
        innerGroup.add(tube);

        var grp = new T.Group();
        var dotMat = new T.MeshBasicMaterial({ color: sign < 0 ? 0x66c0ff : 0xb9c4d2,
          transparent: true, opacity: 0.9, depthWrite: false });
        var dots = [];
        for (var q = 0; q < 6; q++) {
          var dot = new T.Mesh(new T.SphereGeometry(0.105, 10, 8), dotMat);
          grp.add(dot); dots.push(dot);
        }
        innerGroup.add(grp);
        return { curve: curve, group: grp, dots: dots, mat: dotMat };
      }
      c.inPort = makePort(-1, M.portIn, INFO.intakeport);
      c.outPort = makePort(+1, M.portOut, INFO.exhaustport);

      C.push(c);
    }

    /* ================= 曲轴主轴 / 主轴承 / 飞轮 ================= */
    var mainShaft = axisX(cylinder(0.22, 0.22, S.blockHalfX * 2 + 1.3, 24, M.crank));
    mark(mainShaft, INFO.crank, false);
    innerGroup.add(mainShaft);

    [-6.05, -3.05, 0, 3.05, 6.05].forEach(function (mx) {
      var bearing = axisX(cylinder(0.38, 0.38, 0.48, 24, M.bearing));
      bearing.position.set(mx, 0, 0);
      mark(bearing, INFO.mainbearing, false);
      innerGroup.add(bearing);
      var pedestal = box(0.46, 1.55, 1.7, M.bearing);
      pedestal.position.set(mx, -1.15, 0);
      mark(pedestal, INFO.mainbearing, false);
      innerGroup.add(pedestal);
    });

    var flywheel = new T.Group();
    flywheel.position.set(S.blockHalfX + 0.85, 0, 0);
    var disc = axisX(cylinder(1.62, 1.62, 0.34, 56, M.crank));
    mark(disc, INFO.flywheel, false);
    flywheel.add(disc);
    var tooth = axisX(cylinder(0.26, 0.26, 0.40, 16, M.crankpin));
    tooth.position.set(0, 1.18, 0);     // 转动标记，便于观察两圈/圈
    mark(tooth, INFO.flywheel, false);
    flywheel.add(tooth);
    var rim2 = new T.Mesh(new T.TorusGeometry(1.44, 0.09, 10, 56), M.web);
    rim2.rotation.y = Math.PI / 2;
    mark(rim2, INFO.flywheel, false);
    flywheel.add(rim2);
    innerGroup.add(flywheel);

    /* ================= 选中高亮 ================= */
    var boxHelper = new T.BoxHelper(
      new T.Mesh(new T.BoxGeometry(1, 1, 1), M.crank), 0xffb347);
    boxHelper.material.depthTest = false;
    boxHelper.material.transparent = true;
    boxHelper.material.opacity = 0.85;
    boxHelper.renderOrder = 999;
    boxHelper.visible = false;
    scene.add(boxHelper);
    var selected = null;

    /* ================= 逐帧更新 ================= */
    var lastStates = null;
    function setAngle(theta) {
      theta = mod(theta, 720);
      var states = [];
      var maxSpark = 0, sparkX = 0;

      for (var i = 0; i < 4; i++) {
        var st = cylinderState(theta, i);
        states.push(st);
        var c = C[i], x = c.x;
        var br = st.beta * RAD;
        var cy = S.r * Math.cos(br);
        var cz = S.r * Math.sin(br);

        // 活塞 + 连杆 + 曲拐
        c.pistonGroup.position.y = st.pistonY;
        placeSegment(c.rod, x, cy, cz, x, st.pistonY, 0);
        c.bigEnd.position.set(x, cy, cz);
        c.smallEnd.position.set(x, st.pistonY, 0);
        c.throwGroup.rotation.x = br;

        // 气门升程（沿 Y 下移 = 打开）
        c.intakeValve.position.y = S.headY - S.valveLift * st.liftIn;
        c.exhaustValve.position.y = S.headY - S.valveLift * st.liftEx;

        // 火花塞闪光
        c.flashMat.opacity = clamp(st.spark * 0.95, 0, 1);
        var fs = 0.22 + 0.52 * st.spark;
        c.flash.scale.setScalar(fs);
        c.flash.visible = st.spark > 0.01;
        if (st.spark > maxSpark) { maxSpark = st.spark; sparkX = x; }

        // 缸内气体体积：活塞顶面 → 缸盖底面
        var pistonTop = st.pistonY + S.pistonH / 2;
        var gh = Math.max(0.06, S.headY - pistonTop);
        c.gas.scale.y = gh;
        c.gas.position.set(x, pistonTop + gh / 2, 0);
        var gcol = gasColors[st.stroke];
        c.gasMat.color.copy(gcol);
        if (st.stroke === 1) {  // 压缩：蓝 → 金黄
          c.gasMat.color.copy(gasColors[0]).lerp(gasColors[1], st.progress);
        }
        var op;
        if (st.stroke === 0) op = 0.10 + 0.13 * st.progress;
        else if (st.stroke === 1) op = 0.16 + 0.22 * st.progress;
        else if (st.stroke === 2) op = 0.20 + 0.34 * st.spark + 0.16 * (1 - st.progress);
        else op = 0.20 * (1 - st.progress) + 0.07;
        c.gasMat.opacity = clamp(op, 0, 0.75);

        // 流动示意小球
        c.inPort.group.visible = st.intakeOpen;
        c.outPort.group.visible = st.exhaustOpen;
        c.inPort.mat.opacity = st.intakeOpen ? 0.35 + 0.6 * st.liftIn : 0;
        c.outPort.mat.opacity = st.exhaustOpen ? 0.35 + 0.6 * st.liftEx : 0;
      }

      sparkLight.intensity = maxSpark * 3.2;
      sparkLight.position.set(sparkX, S.headY - 0.32, 0);
      flywheel.rotation.x = states[0].beta * RAD;

      lastStates = states;
      return states;
    }

    // 示意小球的位置只跟「流动时间」有关，暂停时也保持流动，方便观察方向
    function updateFlow(flowTime) {
      for (var i = 0; i < 4; i++) {
        var c = C[i];
        // 曲线参数 t：0 = 气道外侧，1 = 缸内。
        // 进气 t 递增（外向内），排气 t 递减（内向外）。
        [[c.inPort, 1], [c.outPort, -1]].forEach(function (pair) {
          var port = pair[0], dir = pair[1];
          if (!port.group.visible) return;
          for (var q = 0; q < port.dots.length; q++) {
            var t = mod(flowTime * 0.55 * dir + q / port.dots.length, 1);
            port.curve.getPointAt(t, port.dots[q].position);
          }
        });
      }
    }

    /* ================= 拾取 ================= */
    var raycaster = new T.Raycaster();
    var pointer = new T.Vector2();
    function pick(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(pickables, false);
      var cutOn = !!M.shell.clippingPlanes;
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        // 剖视时被裁掉的前半外壳不应挡住拾取
        if (cutOn && h.object.userData.isShell && h.point.z > 0.02) continue;
        if (!shellGroup.visible && h.object.userData.isShell) continue;
        if (!h.object.parent || !h.object.visible) continue;
        if (h.object.userData.info === INFO.gas && h.object.material.opacity < 0.02) continue;
        selected = h.object;
        boxHelper.setFromObject(h.object);
        boxHelper.visible = true;
        return h.object.userData.info;
      }
      selected = null;
      boxHelper.visible = false;
      return null;
    }
    function clearPick() { selected = null; boxHelper.visible = false; }

    /* ================= 投影标签 ================= */
    var projV = new T.Vector3();
    function projectCylinder(i) {
      projV.set(C[i].x, S.headY + 2.30, 0).project(camera);
      return {
        x: (projV.x * 0.5 + 0.5) * canvas.clientWidth,
        y: (-projV.y * 0.5 + 0.5) * canvas.clientHeight,
        visible: projV.z < 1 && Math.abs(projV.x) < 1.4 && Math.abs(projV.y) < 1.4
      };
    }

    /* ================= 渲染 / 尺寸 ================= */
    function resize() {
      var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    function render(flowTime) {
      controls.update();
      updateFlow(flowTime);
      if (selected && boxHelper.visible) boxHelper.update();
      renderer.render(scene, camera);
    }
    function resetView() {
      camera.position.copy(HOME);
      controls.target.copy(TARGET);
      controls.update();
    }
    function setShell(v) { shellGroup.visible = !!v; }

    setCutaway(true);
    setAngle(0);
    resize();

    return {
      setAngle: setAngle, render: render, resize: resize,
      resetView: resetView, setShell: setShell, setCutaway: setCutaway,
      pick: pick, clearPick: clearPick, projectCylinder: projectCylinder,
      getStates: function () { return lastStates; },
      canvas: canvas, camera: camera, controls: controls,
      renderer: renderer, pickableCount: pickables.length,
      spec: S
    };
  }

  window.EngineDemo = {
    init: init,
    cylinderState: cylinderState,
    STROKES: STROKES,
    DELTA: DELTA,
    FIRE_ORDER: FIRE_ORDER,
    INFO: INFO,
    mod: mod
  };
})();
