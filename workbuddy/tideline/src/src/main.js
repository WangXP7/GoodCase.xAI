/* =====================================================================
 * TIDELINE · main.js
 * 引导：GL 上下文 → 图集 → 批处理器 → RT → 后期 → 固定步长主循环。
 * 无构建步骤，双击 index.html 即可运行（也可用任意静态服务器）。
 * ===================================================================== */
(function () {
  var TL = window.TL, C = TL.C, U = TL.U;

  /* ---------------- 选项（5 个正交开关 + 可访问性） ---------------- */
  var opts = {
    shake: true, flash: true, jitter: true, crt: true, particles: 1,
    colorblind: false, qteAssist: false, mute: false, integerSnap: false,
    reducedMotion: false, music: true
  };
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq && mq.matches) {
    opts.reducedMotion = true;
    opts.shake = false; opts.flash = false; opts.jitter = false; opts.particles = 0.5;
  }

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('gl');
  var gl = null, B = null, post = null, rt = null, atlasTex = null, bayerTex = null;
  var glLost = false;

  function initGL() {
    var info = TL.glx.createContext(canvas);
    if (!info) return false;
    gl = info.gl;
    var atlas = TL.buildAtlas();
    atlasTex = TL.glx.createTexture(gl, atlas.w, atlas.h, atlas.canvas);
    bayerTex = TL.glx.createBayerTexture(gl, U.BAYER8, 8);
    B = new TL.Batcher(gl, atlasTex, bayerTex);
    B.setAtlas(atlas.defs, atlas.w, atlas.h);
    rt = TL.glx.createFBO(gl, C.RT_W, C.RT_H);
    post = new TL.Post(gl, C.RT_W, C.RT_H);
    return true;
  }

  if (!initGL()) {
    stage.innerHTML = '<div style="padding:80px;font-size:22px;line-height:2">' +
      '本作需要 WebGL（WebGL2 或 WebGL1）。<br>当前浏览器/设备未提供可用的 WebGL 上下文。<br>' +
      '<span style="opacity:.6;font-size:16px">ADR-001：低于 WebGL1 的设备不做支持，无降级渲染路径。</span></div>';
    return;
  }

  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault(); glLost = true;
  });
  canvas.addEventListener('webglcontextrestored', function () {
    if (initGL()) glLost = false;
  });

  /* ---------------- 启动 ---------------- */
  TL.HUD.init(opts);
  TL.Game.init(opts);
  TL.FX.setDensity(opts.particles);
  TL.Input.bind(stage);
  TL.HUD.title();

  /* ---------------- 视口适配（5:3 → letterbox） ---------------- */
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / C.DESIGN_W, vh / C.DESIGN_H);
    if (opts.integerSnap) s = Math.max(1, Math.floor(s));
    stage.style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------------- 屏幕动作 ---------------- */
  var G = TL.Game;
  var mode = 'title';          // title | playing | paused | results
  var resultsDelay = 0;

  function startRun() {
    TL.Audio.init(); TL.Audio.resume();
    TL.Audio.setMuted(opts.mute);
    TL.Audio.setMusicEnabled(opts.music);
    TL.Audio.setSuspended(false);
    G.reset();
    TL.Input.clear();
    TL.HUD.hide();
    mode = 'playing';
    resultsDelay = 0;
  }

  document.getElementById('panel').addEventListener('click', function (e) {
    var n = e.target;
    while (n && n !== this && !(n.getAttribute && n.getAttribute('data-act'))) n = n.parentNode;
    if (!n || n === this) return;
    var act = n.getAttribute('data-act');
    TL.Audio.init(); TL.Audio.resume(); TL.Audio.play('ui');
    if (act === 'start' || act === 'restart') startRun();
    else if (act === 'resume') {
      mode = 'playing'; TL.HUD.hide(); TL.Input.clear(); TL.Audio.setSuspended(false);
    }
  });

  /* ---------------- 主循环 ---------------- */
  var acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;

  function frame(now) {
    var dtRaw = (now - last) / 1000;
    last = now;
    if (dtRaw > 0.25) dtRaw = 0.25;
    fpsAcc += dtRaw; fpsN++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    /* 全局按键 */
    if (TL.Input.consumePause()) {
      if (mode === 'playing') { mode = 'paused'; TL.HUD.pause(G); TL.Audio.setSuspended(true); }
      else if (mode === 'paused') { mode = 'playing'; TL.HUD.hide(); TL.Input.clear(); TL.Audio.setSuspended(false); }
    }
    if (TL.Input.consumeMute()) {
      opts.mute = !opts.mute; TL.Audio.setMuted(opts.mute);
      TL.HUD.applyOptionClasses();
      var cb = document.querySelector('[data-opt="mute"]');
      if (cb) cb.checked = opts.mute;
    }
    if (TL.Input.consumeConfirm()) {
      if (mode === 'title' || mode === 'results') startRun();
      else if (mode === 'paused') { mode = 'playing'; TL.HUD.hide(); TL.Input.clear(); }
    }

    if (!glLost) {
      if (mode === 'playing') {
        TL.Input.update();
        acc += dtRaw;
        var steps = 0;
        while (acc >= C.FIXED_DT && steps < C.MAX_STEPS) {
          G.update(C.FIXED_DT);
          acc -= C.FIXED_DT;
          steps++;
        }
        if (steps >= C.MAX_STEPS) acc = 0;      // 追不上就丢帧，不做死亡螺旋

        if (G.over) {
          resultsDelay += dtRaw;
          if (resultsDelay > 1.1) { mode = 'results'; TL.HUD.results(G); }
        }
      } else {
        TL.Input.update();
        TL.Input.takeTaps();
        TL.Input.consumeDash();
      }

      G.render(B, post, rt);
      TL.HUD.update(G);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
