/* =====================================================================
 * 交互控制 / 实时状态 / 教学示意动画
 * ===================================================================== */
(function () {
  'use strict';

  var E = window.EngineDemo;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 状态 ---------- */
  var state = {
    angle: 0,          // 曲轴角 0..720
    playing: false,
    speed: 1,          // 倍速
    degPerSec: 90      // 1× 时每秒转 90° => 720° 循环 8 秒
  };

  // 「定位冲程」：让气缸 1 停在最能说明问题的位置
  // α₁ = (θ + 360) mod 720 → θ = (目标 α₁ − 360) mod 720
  var GOTO = [450, 630, 0, 270];  // 进气(α=90) 压缩(270) 做功(360·点火) 排气(630)

  var engine;
  try {
    engine = E.init($('gl'));
  } catch (err) {
    document.getElementById('viewport').innerHTML =
      '<div style="padding:40px;color:#ff9a70;font-size:14px">' +
      '3D 初始化失败：' + (err && err.message ? err.message : err) +
      '<br>请确认浏览器已开启 WebGL，并使用较新版本的 Chrome / Edge。</div>';
    return;
  }

  /* ---------- DOM ---------- */
  var els = {
    runStatus: $('runStatus'), revText: $('revText'), angleBig: $('angleBig'),
    cycleName: $('cycleName'), cycleFill: $('cycleFill'),
    cylTableBody: $('cylTableBody'), angleSlider: $('angleSlider'), angleOut: $('angleOut'),
    speedSlider: $('speedSlider'), speedOut: $('speedOut'),
    btnPlay: $('btnPlay'), playIco: $('playIco'), playTxt: $('playTxt'),
    btnReset: $('btnReset'), btnStepBack: $('btnStepBack'), btnStepFwd: $('btnStepFwd'),
    btnNextStroke: $('btnNextStroke'), btnResetView: $('btnResetView'),
    chkShell: $('chkShell'), chkCut: $('chkCut'), chkLabels: $('chkLabels'),
    cutBadge: $('cutBadge'), cylLabels: $('cylLabels'),
    partEmpty: $('partEmpty'), partInfo: $('partInfo'), partName: $('partName'),
    partDesc: $('partDesc'), partTag: $('partTag'),
    schemGas: $('schemGas'), schemPiston: $('schemPiston'), schemRod: $('schemRod'),
    schemPin: $('schemPin'), schemIntake: $('schemIntake'), schemExhaust: $('schemExhaust'),
    schemSpark: $('schemSpark'), schemInFlow: $('schemInFlow'), schemOutFlow: $('schemOutFlow'),
    schemCap: $('schemCap'), schemStroke: $('schemStroke'),
    helpModal: $('helpModal'), btnHelp: $('btnHelp'), btnCloseHelp: $('btnCloseHelp')
  };

  /* ---------- 四缸状态表（只建一次） ---------- */
  var rows = [];
  (function buildTable() {
    var html = '';
    for (var i = 0; i < 4; i++) {
      html += '<tr>' +
        '<td class="cno">' + (i + 1) + ' 缸</td>' +
        '<td><span class="pill s0" data-k="stroke">进气</span></td>' +
        '<td data-k="dir">↓ 下行</td>' +
        '<td data-k="in">关</td>' +
        '<td data-k="ex">关</td>' +
        '<td data-k="spark">—</td>' +
        '</tr>';
    }
    els.cylTableBody.innerHTML = html;
    var trs = els.cylTableBody.querySelectorAll('tr');
    for (var j = 0; j < trs.length; j++) {
      rows.push({
        stroke: trs[j].querySelector('[data-k="stroke"]'),
        dir: trs[j].querySelector('[data-k="dir"]'),
        in: trs[j].querySelector('[data-k="in"]'),
        ex: trs[j].querySelector('[data-k="ex"]'),
        spark: trs[j].querySelector('[data-k="spark"]')
      });
    }
  })();

  /* ---------- 缸号浮动标签 ---------- */
  var tags = [];
  (function buildTags() {
    for (var i = 0; i < 4; i++) {
      var d = document.createElement('div');
      d.className = 'cyl-tag s0';
      d.innerHTML = '<b>' + (i + 1) + ' 缸</b><span class="st">进气</span>';
      els.cylLabels.appendChild(d);
      tags.push(d);
    }
  })();

  /* ---------- 部件说明 ---------- */
  function showPart(info) {
    if (!info) {
      els.partEmpty.hidden = false;
      els.partInfo.hidden = true;
      els.partTag.textContent = '点击模型中的部件';
      return;
    }
    els.partEmpty.hidden = true;
    els.partInfo.hidden = false;
    els.partName.textContent = info.name;
    els.partDesc.textContent = info.desc;
    els.partTag.textContent = info.name;
  }

  /* ---------- 播放控制 ---------- */
  function setPlaying(v) {
    state.playing = !!v;
    if (state.playing) updateSeg(-1);
    els.btnPlay.classList.toggle('running', state.playing);
    els.playIco.textContent = state.playing ? '❚❚' : '▶';
    els.playTxt.textContent = state.playing ? '暂停' : '自动播放';
    els.runStatus.classList.toggle('running', state.playing);
    els.runStatus.querySelector('span').textContent = state.playing ? '运行中' : '已暂停';
  }
  function setAngle(a, pauseToo) {
    state.angle = E.mod(a, 720);
    if (pauseToo !== false && state.playing) setPlaying(false);
    els.angleSlider.value = state.angle.toFixed(0);
    els.angleOut.textContent = state.angle.toFixed(0) + '°';
  }
  function reset() {
    setPlaying(false);
    state.speed = 1;
    els.speedSlider.value = '1';
    els.speedOut.textContent = '1.00×';
    setAngle(0);
    showPart(null);
    engine.clearPick();
    updateSeg(-1);
  }
  var segBtns = [].slice.call(document.querySelectorAll('.seg-btn'));
  function updateSeg(active) {
    for (var i = 0; i < segBtns.length; i++) {
      segBtns[i].classList.toggle('active', Number(segBtns[i].dataset.goto) === active);
    }
  }

  /* ---------- 事件绑定 ---------- */
  els.btnPlay.addEventListener('click', function () { setPlaying(!state.playing); });
  els.btnReset.addEventListener('click', reset);
  els.btnStepBack.addEventListener('click', function () { setAngle(state.angle - 15); updateSeg(-1); });
  els.btnStepFwd.addEventListener('click', function () { setAngle(state.angle + 15); updateSeg(-1); });
  els.btnNextStroke.addEventListener('click', function () {
    setAngle((Math.floor(state.angle / 180) + 1) * 180);
    updateSeg(-1);
  });
  els.btnResetView.addEventListener('click', function () { engine.resetView(); });

  els.angleSlider.addEventListener('input', function () {
    setAngle(Number(this.value)); updateSeg(-1);
  });
  els.speedSlider.addEventListener('input', function () {
    state.speed = Number(this.value);
    els.speedOut.textContent = state.speed.toFixed(2) + '×';
  });

  for (var si = 0; si < segBtns.length; si++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var k = Number(btn.dataset.goto);
        setAngle(GOTO[k]);
        updateSeg(k);
      });
    })(segBtns[si]);
  }

  els.chkShell.addEventListener('change', function () { engine.setShell(this.checked); });
  els.chkCut.addEventListener('change', function () {
    engine.setCutaway(this.checked);
    els.cutBadge.textContent = this.checked ? '剖视模式 · 前半外壳已移除' : '透视外壳 · 整体半透明';
    engine.clearPick();
  });
  els.chkLabels.addEventListener('change', function () {
    els.cylLabels.style.display = this.checked ? '' : 'none';
  });

  /* 教学说明弹层 */
  function openHelp(v) { els.helpModal.hidden = !v; }
  els.btnHelp.addEventListener('click', function () { openHelp(true); });
  els.btnCloseHelp.addEventListener('click', function () { openHelp(false); });
  els.helpModal.addEventListener('click', function (e) {
    if (e.target.dataset.close) openHelp(false);
  });

  /* 键盘快捷键 */
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { openHelp(false); return; }
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setAngle(state.angle - 15); updateSeg(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setAngle(state.angle + 15); updateSeg(-1); }
    else if (e.key === 'r' || e.key === 'R') { reset(); }
  });

  /* 3D 点击拾取（拖动旋转时不误触发） */
  var down = null;
  var canvas = $('gl');
  canvas.addEventListener('pointerdown', function (e) {
    down = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointerup', function (e) {
    canvas.style.cursor = 'grab';
    if (!down) return;
    var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    down = null;
    if (moved > 6) return;             // 属于拖拽视角
    if (e.button !== 0) return;
    showPart(engine.pick(e.clientX, e.clientY));
  });

  window.addEventListener('resize', function () { engine.resize(); });

  /* ---------- HUD 更新 ---------- */
  function updateHUD(states) {
    var a = state.angle;
    els.angleBig.textContent = a.toFixed(0);
    els.revText.textContent = a < 360 ? '第 1 圈' : '第 2 圈';
    els.cycleFill.style.width = (a / 720 * 100).toFixed(2) + '%';
    els.cycleName.textContent = '气缸 1 处于' + states[0].strokeName + '冲程';
    if (!state.playing && els.angleSlider.value !== a.toFixed(0)) {
      els.angleSlider.value = a.toFixed(0);
      els.angleOut.textContent = a.toFixed(0) + '°';
    }

    for (var i = 0; i < 4; i++) {
      var s = states[i], r = rows[i];
      r.stroke.className = 'pill s' + s.stroke;
      r.stroke.textContent = s.strokeName;
      r.dir.textContent = s.pistonDir;
      r.in.innerHTML = s.intakeOpen ? '<span class="v-open">● 开</span>' : '<span class="v-close">○ 关</span>';
      r.ex.innerHTML = s.exhaustOpen ? '<span class="v-open">● 开</span>' : '<span class="v-close">○ 关</span>';
      r.spark.innerHTML = s.spark > 0.05
        ? '<span class="spark-on">✦ 点火</span>' : '<span class="spark-off">—</span>';

      var t = tags[i];
      t.className = 'cyl-tag s' + s.stroke + (s.spark > 0.05 ? ' fire' : '');
      t.querySelector('.st').textContent = s.strokeName;
      var p = engine.projectCylinder(i);
      t.style.left = p.x.toFixed(1) + 'px';
      t.style.top = p.y.toFixed(1) + 'px';
      t.style.opacity = p.visible ? '1' : '0';
    }
  }

  /* ---------- SVG 四冲程示意图（跟随气缸 1） ---------- */
  var GAS_FILL = ['#4ea8ff', '#ffc25a', 'url(#gasGrad)', '#9aa6b4'];
  function updateSchematic(s) {
    // 活塞：TDC(pistonY=L+r) → svg y=38；BDC(L−r) → svg y=110
    var spec = engine.spec;
    var tdc = spec.L + spec.r, bdc = spec.L - spec.r;
    var norm = (s.pistonY - bdc) / (tdc - bdc);   // 0=BDC 1=TDC
    var topY = 110 - 72 * norm;

    els.schemPiston.setAttribute('transform', 'translate(0,' + (topY - 90).toFixed(1) + ')');
    els.schemGas.setAttribute('height', Math.max(8, topY - 30).toFixed(1));
    els.schemGas.setAttribute('fill', GAS_FILL[s.stroke]);
    els.schemGas.setAttribute('opacity',
      (s.stroke === 2 ? (0.45 + 0.5 * s.spark) : (0.30 + 0.35 * s.progress)).toFixed(2));

    var br = s.beta * Math.PI / 180;
    var px = 160 + 11 * Math.sin(br);
    var py = 168 - 11 * Math.cos(br);
    els.schemRod.setAttribute('x1', '160');
    els.schemRod.setAttribute('y1', (topY + 28).toFixed(1));
    els.schemRod.setAttribute('x2', px.toFixed(1));
    els.schemRod.setAttribute('y2', py.toFixed(1));
    els.schemPin.setAttribute('cx', px.toFixed(1));
    els.schemPin.setAttribute('cy', py.toFixed(1));

    els.schemIntake.setAttribute('transform',
      'translate(0,' + (s.liftIn * 9).toFixed(1) + ')');
    els.schemExhaust.setAttribute('transform',
      'translate(0,' + (s.liftEx * 9).toFixed(1) + ')');

    els.schemSpark.setAttribute('opacity', Math.max(0, s.spark).toFixed(2));
    els.schemSpark.setAttribute('transform',
      'translate(160,34) scale(' + (0.7 + 0.6 * s.spark).toFixed(2) + ') translate(-160,-34)');

    els.schemInFlow.style.display = (s.stroke === 0) ? '' : 'none';
    els.schemOutFlow.style.display = (s.stroke === 3) ? '' : 'none';
    els.schemStroke.textContent = s.strokeName;
    els.schemCap.textContent = E.STROKES[s.stroke].cap;
  }

  /* ---------- 主循环 ---------- */
  var last = performance.now();
  var frames = 0;
  function loop(now) {
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (state.playing) {
      setAngle(state.angle + dt * state.degPerSec * state.speed, false);
    }
    var states = engine.setAngle(state.angle);
    engine.render(now / 1000);
    updateHUD(states);
    updateSchematic(states[0]);
    frames++;
    requestAnimationFrame(loop);
  }

  /* ---------- 初始状态 ---------- */
  engine.setShell(true);
  engine.setCutaway(true);
  setPlaying(false);
  setAngle(0, false);
  showPart(null);
  requestAnimationFrame(loop);

  /* 供浏览器自动化检查使用的只读状态 / 控制钩子 */
  window.__engineApp = {
    getState: function () {
      return {
        angle: state.angle, playing: state.playing, speed: state.speed,
        frames: frames,
        // 实时按角度重算，避免读到上一渲染帧的滞后状态
        strokes: [0, 1, 2, 3].map(function (i) {
          var st = E.cylinderState(state.angle, i);
          return { no: st.no, name: st.strokeName, intake: st.intakeOpen,
                   exhaust: st.exhaustOpen, spark: +st.spark.toFixed(2) };
        }),
        webgl: !!engine.renderer.getContext(),
        drawCalls: engine.renderer.info.render.calls,
        triangles: engine.renderer.info.render.triangles,
        pickableCount: engine.pickableCount
      };
    },
    setAngle: setAngle, play: function (v) { setPlaying(v); },
    reset: reset, engine: engine, E: E
  };
})();
