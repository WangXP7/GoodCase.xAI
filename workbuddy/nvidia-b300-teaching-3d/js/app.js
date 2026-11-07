/* =====================================================================
 * app.js —— 场景、交互、状态与渲染主循环
 * 交互：播放/暂停 · 拆解滑块 · 速度滑块 · 透视外壳 · 四种演示模式
 *       部件点选/说明 · 视角预设 · 重置 · 教学说明浮层
 * ===================================================================== */
(function () {
  'use strict';
  var T = window.THREE, DATA = window.B300_DATA;
  var $ = function (id) { return document.getElementById(id); };

  var canvas = $('gl'), viewport = $('viewport');
  var renderer, scene, camera, controls, model, clock, ground;
  var raycaster = new T.Raycaster(), pointer = new T.Vector2();
  var downPos = null, camTween = null;
  var frames = 0, drawCalls = 0, triangles = 0;

  var DEFAULTS = {
    playing: true, explode: 0, speed: 1, mode: 'overview',
    xray: false, selected: null, view: 'iso'
  };
  var state = {};
  function assign(o) { for (var k in o) state[k] = o[k]; }
  assign(DEFAULTS);
  var explodeCurrent = 0;

  /* ==================================================================
   * 场景初始化
   * ================================================================== */
  function init() {
    try {
      renderer = new T.WebGLRenderer({
        canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: true
      });
    } catch (e) {
      $('vpLoading').textContent = 'WebGL 初始化失败：' + e.message;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x080a0f, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    // 该 Three.js 版本无自动色彩管理：保持线性直出，避免 sRGB 编码 + ACES
    // 把深色金属整体提亮成灰白。材质色即最终观感，课堂投影更接近产品图。
    if ('outputEncoding' in renderer && T.LinearEncoding) renderer.outputEncoding = T.LinearEncoding;
    if (T.NoToneMapping !== undefined) renderer.toneMapping = T.NoToneMapping;

    scene = new T.Scene();
    scene.background = new T.Color(0x080a0f);
    scene.fog = new T.Fog(0x080a0f, 22, 46);

    camera = new T.PerspectiveCamera(36, 1, .1, 200);
    camera.position.set(DATA.VIEWS.iso.pos[0], DATA.VIEWS.iso.pos[1], DATA.VIEWS.iso.pos[2]);

    controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = .07;
    controls.minDistance = 6;
    controls.maxDistance = 34;
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = .8;
    controls.update();

    // 灯光：暖色主光 + 冷色补光 + 后方轮廓光
    scene.add(new T.AmbientLight(0xffffff, .46));
    scene.add(new T.HemisphereLight(0x9fb8d8, 0x1a1208, .30));
    var key = new T.DirectionalLight(0xffe6bd, 1.05);
    key.position.set(8, 12, 9);
    key.castShadow = true;
    key.shadow.mapSize.width = key.shadow.mapSize.height = 1024;
    key.shadow.camera.left = -12; key.shadow.camera.right = 12;
    key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.bias = -.0012;
    scene.add(key);
    var fill = new T.DirectionalLight(0x9ec5ff, .42);
    fill.position.set(-9, 5, 8); scene.add(fill);
    var rim = new T.DirectionalLight(0xffab5e, .40);
    rim.position.set(-5, 7, -11); scene.add(rim);
    var under = new T.PointLight(0xd9a441, .30, 18);
    under.position.set(0, -3.2, 3.5); scene.add(under);

    // 地面（接收接触阴影，底部视角时隐藏）
    ground = new T.Mesh(
      new T.CircleGeometry(28, 64),
      new T.MeshStandardMaterial({ color: 0x080b11, roughness: 1.0, metalness: .0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3.15;
    ground.receiveShadow = true;
    scene.add(ground);

    model = window.B300_MODEL.build(scene);
    clock = new T.Clock();
    resize();
    $('vpLoading').hidden = true;
    $('navCount').textContent = model.partCount + ' 个部件';
    return true;
  }

  function resize() {
    var w = viewport.clientWidth || 800, h = viewport.clientHeight || 600;
    if (renderer) renderer.setSize(w, h, false);
    if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  /* ==================================================================
   * UI 构建
   * ================================================================== */
  function buildUI() {
    // 部件导航
    var list = $('partList'), html = '';
    DATA.PARTS.forEach(function (p) {
      html += '<button class="part-item" type="button" data-id="' + p.id + '">' +
        '<span class="num">' + p.num + '</span>' +
        '<span class="dot" style="background:' + p.color + '"></span>' +
        '<span>' + p.name + '</span></button>';
    });
    list.innerHTML = html;

    // 模式按钮
    var mb = $('modeBtns'), mh = '';
    DATA.MODES.forEach(function (m, i) {
      mh += '<button type="button" data-mode="' + m.id + '" title="' + m.note + '">' +
        (i + 1) + ' ' + m.name + '</button>';
    });
    mb.innerHTML = mh;
  }

  function syncUI() {
    // 播放状态
    var chip = $('runStatus');
    chip.classList.toggle('paused', !state.playing);
    chip.querySelector('span').textContent = state.playing ? '自动播放中' : '已暂停';
    $('playIco').textContent = state.playing ? '‖' : '▶';
    $('playTxt').textContent = state.playing ? '暂停演示' : '继续播放';
    $('btnPlay').classList.toggle('primary-btn', true);

    // 滑块
    $('explodeSlider').value = Math.round(state.explode * 100);
    $('explodeSlider').style.setProperty('--fill', (state.explode * 100) + '%');
    $('explodeVal').textContent = Math.round(state.explode * 100) + '%';
    $('speedSlider').value = Math.round(state.speed * 100);
    $('speedSlider').style.setProperty('--fill', (state.speed * 50) + '%');
    $('speedVal').textContent = state.speed.toFixed(1) + '×';

    // 透视
    $('btnXray').classList.toggle('on', state.xray);
    $('xrayBadge').hidden = !state.xray;

    // 模式 / 视角
    Array.prototype.forEach.call($('modeBtns').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === state.mode);
    });
    Array.prototype.forEach.call($('viewPresets').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
    });
    var modeObj = DATA.MODES.filter(function (m) { return m.id === state.mode; })[0];
    $('modeBadge').textContent = modeObj ? modeObj.name : state.mode;

    // 部件列表
    Array.prototype.forEach.call($('partList').children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-id') === state.selected);
    });

    // 实时读数
    var opacity = model.shellMats.length ? model.shellMats[0].opacity : 1;
    var visible = 0;
    for (var k in model.parts) if (model.parts[k].group.visible) visible++;
    $('readout').innerHTML =
      row('拆解程度', Math.round(state.explode * 100) + '%', true) +
      row('旋转速度', state.speed.toFixed(1) + '×') +
      row('演示模式', modeObj ? modeObj.name : '-', true) +
      row('外壳透明度', Math.round(opacity * 100) + '%') +
      row('当前选中', state.selected ? partName(state.selected) : '未选中') +
      row('气流演示', model.airflow.group.visible ? '开启' : '关闭') +
      row('可见部件', visible + ' / ' + model.partCount) +
      '<div class="sep"></div>' +
      row('播放状态', state.playing ? '播放中' : '已暂停') +
      row('渲染帧数', frames);
  }
  function row(k, v, hl) {
    return '<div><span>' + k + '</span><b class="' + (hl ? 'hl' : '') + '">' + v + '</b></div>';
  }
  function partName(id) {
    var p = DATA.PARTS.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : id;
  }

  /* ==================================================================
   * 行为
   * ================================================================== */
  function setPlaying(v) {
    state.playing = !!v;
    controls.autoRotate = state.playing;
    syncUI();
  }
  function togglePlay() { setPlaying(!state.playing); }

  function setExplode(v) {
    state.explode = Math.max(0, Math.min(1, v));
    syncUI();
  }
  function setSpeed(v) {
    state.speed = Math.max(0, Math.min(2, v));
    syncUI();
  }

  function applyXray() {
    model.setShellOpacity(state.xray ? .16 : 1);
    syncUI();
  }
  function toggleXray() { state.xray = !state.xray; applyXray(); }

  function setMode(id) {
    if (!DATA.MODES.some(function (m) { return m.id === id; })) return;
    state.mode = id;
    model.airflow.group.visible = (id === 'airflow');
    var hidden = (id === 'core')
      ? ['chassis', 'trayTop', 'trayBottom', 'vent', 'psu', 'io'] : [];
    for (var pid in model.parts) model.setPartVisible(pid, hidden.indexOf(pid) < 0);
    state.xray = (id === 'airflow');
    model.setShellOpacity(state.xray ? .16 : 1);
    if (id === 'explode') setExplode(.82);
    else if (id === 'core') setExplode(.38);
    else setExplode(0);
    if (id === 'airflow') model.resetAirflow();
    syncUI();
  }

  function setView(name, instant) {
    var v = DATA.VIEWS[name];
    if (!v) return;
    state.view = name;
    ground.visible = (name !== 'bottom');
    var to = new T.Vector3(v.pos[0], v.pos[1], v.pos[2]);
    var tt = new T.Vector3(v.target[0], v.target[1], v.target[2]);
    if (instant) {
      camTween = null;
      camera.position.copy(to);
      controls.target.copy(tt);
      controls.update();
    } else {
      camTween = {
        from: camera.position.clone(), to: to,
        tFrom: controls.target.clone(), tTo: tt, t: 0
      };
    }
    syncUI();
  }

  function selectPart(id) {
    state.selected = id || null;
    model.highlight(state.selected);
    var empty = $('partEmpty'), info = $('partInfo'), label = $('vpPartLabel');
    if (!state.selected) {
      empty.hidden = false; info.hidden = true; label.hidden = true;
      $('partTag').textContent = '点击模型中的部件';
      syncUI(); return;
    }
    var p = DATA.PARTS.filter(function (x) { return x.id === state.selected; })[0];
    if (!p) { syncUI(); return; }
    empty.hidden = true; info.hidden = false;
    $('partTag').textContent = '部件 ' + p.num;
    $('partIndex').textContent = p.num;
    $('partName').textContent = p.name;
    $('partEn').textContent = p.en;
    $('partDesc').textContent = p.desc;
    $('partSpec').innerHTML = p.spec.map(function (s) {
      return '<div><b>' + s.k + '</b><span>' + s.v + '</span></div>';
    }).join('');
    $('partTip').textContent = p.tip;
    label.textContent = p.num + '  ' + p.name;
    label.hidden = false;
    syncUI();
  }

  function reset() {
    assign(DEFAULTS);
    explodeCurrent = 0;
    model.applyExplode(0);
    model.airflow.group.visible = false;
    model.resetAirflow();
    model.setShellOpacity(1);
    for (var pid in model.parts) model.setPartVisible(pid, true);
    model.clearHighlight();
    selectPart(null);
    setView('iso', true);
    controls.autoRotate = true;
    ground.visible = true;
    syncUI();
  }

  function setHelp(open) {
    $('helpOverlay').hidden = !open;
  }

  /* ==================================================================
   * 事件
   * ================================================================== */
  function bind() {
    $('btnPlay').addEventListener('click', togglePlay);
    $('btnReset').addEventListener('click', reset);
    $('btnResetView').addEventListener('click', function () { setView('iso'); });
    $('btnXray').addEventListener('click', toggleXray);
    $('btnHelp').addEventListener('click', function () { setHelp(true); });
    $('btnHelpClose').addEventListener('click', function () { setHelp(false); });
    $('helpOverlay').addEventListener('click', function (e) {
      if (e.target === $('helpOverlay')) setHelp(false);
    });

    $('explodeSlider').addEventListener('input', function (e) {
      setExplode(parseInt(e.target.value, 10) / 100);
    });
    $('speedSlider').addEventListener('input', function (e) {
      setSpeed(parseInt(e.target.value, 10) / 100);
    });

    $('modeBtns').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (b) setMode(b.getAttribute('data-mode'));
    });
    $('viewPresets').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (b) setView(b.getAttribute('data-view'));
    });
    $('partList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (b) selectPart(b.getAttribute('data-id'));
    });

    canvas.addEventListener('pointerdown', function (e) {
      downPos = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!downPos) return;
      var moved = Math.abs(e.clientX - downPos.x) + Math.abs(e.clientY - downPos.y);
      downPos = null;
      if (moved > 5) return;   // 拖动旋转，不算点选
      var r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(model.pickables, false);
      for (var i = 0; i < hits.length; i++) {
        if (visibleChain(hits[i].object)) {
          selectPart(hits[i].object.userData.partId);
          return;
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === 'Escape') setHelp(false);
      else if (/^[1-4]$/.test(e.key)) setMode(DATA.MODES[parseInt(e.key, 10) - 1].id);
    });

    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
  }

  function visibleChain(o) {
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }

  /* ==================================================================
   * 视窗内的部件标签跟随
   * ================================================================== */
  var tmpBox = new T.Box3(), tmpVec = new T.Vector3();
  function updatePartLabel() {
    var label = $('vpPartLabel');
    if (!state.selected || !model.parts[state.selected]) { label.hidden = true; return; }
    tmpBox.setFromObject(model.parts[state.selected].group);
    if (tmpBox.isEmpty()) { label.hidden = true; return; }
    tmpBox.getCenter(tmpVec).project(camera);
    if (tmpVec.z > 1 || tmpVec.z < -1) { label.hidden = true; return; }
    label.style.left = ((tmpVec.x * .5 + .5) * viewport.clientWidth) + 'px';
    label.style.top = ((-tmpVec.y * .5 + .5) * viewport.clientHeight) + 'px';
    label.hidden = false;
  }

  /* ==================================================================
   * 主循环
   * ================================================================== */
  function animate() {
    requestAnimationFrame(animate);
    if (!renderer) return;
    var dt = Math.min(clock.getDelta(), .1);
    frames++;

    // 拆解过渡
    if (Math.abs(explodeCurrent - state.explode) > .0005) {
      explodeCurrent += (state.explode - explodeCurrent) * Math.min(1, dt * 9);
      model.applyExplode(explodeCurrent);
    }
    // 视角过渡
    if (camTween) {
      camTween.t = Math.min(1, camTween.t + dt * 2.2);
      var s = camTween.t * camTween.t * (3 - 2 * camTween.t);
      camera.position.lerpVectors(camTween.from, camTween.to, s);
      controls.target.lerpVectors(camTween.tFrom, camTween.tTo, s);
      if (camTween.t >= 1) camTween = null;
    }
    controls.autoRotate = state.playing && !camTween;
    controls.autoRotateSpeed = .8 * state.speed;
    controls.update();

    model.updateAirflow(dt, state.playing, state.speed);
    model.updateHelper();
    updatePartLabel();

    renderer.render(scene, camera);
    drawCalls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
  }

  /* ==================================================================
   * 启动 + 供浏览器自动化验收的状态接口
   * ================================================================== */
  function getState() {
    var shellOpacity = model.shellMats.length ? model.shellMats[0].opacity : 1;
    var visibleParts = [];
    for (var k in model.parts) if (model.parts[k].group.visible) visibleParts.push(k);
    return {
      webgl: !!renderer && !!renderer.getContext(),
      frames: frames, drawCalls: drawCalls, triangles: triangles,
      pickableCount: model.pickables.length, partCount: model.partCount,
      playing: state.playing, explode: state.explode, explodeCurrent: explodeCurrent,
      speed: state.speed, mode: state.mode, xray: state.xray,
      shellOpacity: shellOpacity, selectedPart: state.selected, view: state.view,
      airflowVisible: model.airflow.group.visible,
      airflowArrows: model.airflow.arrows.length,
      visibleParts: visibleParts,
      cameraPos: [camera.position.x, camera.position.y, camera.position.z],
      sampleSegment: (function () {
        var s = model.parts.trayTop && model.parts.trayTop.segments[2];
        return s ? [s.g.position.x, s.g.position.y, s.g.position.z] : null;
      })(),
      autoRotate: controls.autoRotate,
      helpOpen: !$('helpOverlay').hidden,
      partCardName: $('partInfo').hidden ? '' : $('partName').textContent,
      partCardDesc: $('partInfo').hidden ? '' : $('partDesc').textContent,
      partCardTip: $('partInfo').hidden ? '' : $('partTip').textContent,
      canvasW: canvas.clientWidth, canvasH: canvas.clientHeight,
      readoutText: $('readout').textContent.replace(/\s+/g, ' ').trim()
    };
  }

  function boot() {
    if (!init()) return;
    buildUI();
    bind();
    syncUI();
    animate();
    window.__b300App = {
      getState: getState,
      setPlaying: setPlaying, togglePlay: togglePlay,
      setExplode: setExplode, setSpeed: setSpeed,
      setMode: setMode, setXray: function (v) { state.xray = !!v; applyXray(); },
      toggleXray: toggleXray, setView: setView,
      selectPart: selectPart, reset: reset, setHelp: setHelp,
      DATA: DATA
    };
    window.__b300Ready = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
