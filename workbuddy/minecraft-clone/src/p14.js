/* =====================================================================
   16. 启动与界面事件
   ===================================================================== */

(function main() {
  const loadBar = document.getElementById('loadBar');
  const loadMsg = document.getElementById('loadMsg');
  const startBtn = document.getElementById('startBtn');
  const loading = document.getElementById('loading');

  function setProgress(p, msg) {
    loadBar.style.width = (p * 100).toFixed(1) + '%';
    if (msg) loadMsg.textContent = msg;
  }

  const game = new Game();
  window.__mc = game;         // 便于调试

  UI.init();
  game.bindInput();
  UI.selectSlot(0);

  /* ---------- 暂停菜单 ---------- */
  const menuScreen = document.getElementById('menuScreen');
  const optScreen = document.getElementById('optScreen');
  const newScreen = document.getElementById('newScreen');

  document.getElementById('btnResume').addEventListener('click', () => game.closeMenu());
  document.getElementById('btnOptions').addEventListener('click', () => {
    menuScreen.classList.add('hide'); optScreen.classList.remove('hide');
  });
  document.getElementById('btnOptBack').addEventListener('click', () => {
    optScreen.classList.add('hide'); menuScreen.classList.remove('hide');
  });
  document.getElementById('btnNewWorld').addEventListener('click', () => {
    menuScreen.classList.add('hide'); newScreen.classList.remove('hide');
  });
  document.getElementById('btnNewBack').addEventListener('click', () => {
    newScreen.classList.add('hide'); menuScreen.classList.remove('hide');
  });
  document.getElementById('btnExport').addEventListener('click', () => {
    try {
      const url = game.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'minecraft-' + Date.now() + '.png';
      a.click();
      UI.toast('截图已导出');
    } catch (e) { UI.toast('导出失败：' + e.message); }
  });

  const btnMode = document.getElementById('btnMode');
  btnMode.addEventListener('click', () => {
    const P = game.player;
    P.creative = !P.creative;
    if (!P.creative) P.flying = false;
    P.health = P.maxHealth; P.food = 20;
    btnMode.textContent = '游戏模式：' + (P.creative ? '创造' : '生存');
    UI.toast('已切换为' + (P.creative ? '创造' : '生存') + '模式');
  });
  const btnTime = document.getElementById('btnTime');
  const TIMES = [['白天', 0.20], ['正午', 0.25], ['黄昏', 0.47], ['夜晚', 0.72], ['黎明', 0.985]];
  let timeIdx = 0;
  btnTime.addEventListener('click', () => {
    timeIdx = (timeIdx + 1) % TIMES.length;
    game.world.time = TIMES[timeIdx][1];
    btnTime.textContent = '时间：' + TIMES[timeIdx][0];
  });

  /* ---------- 选项 ---------- */
  function bindSlider(id, labelId, fmt, apply) {
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    if (!el) return;
    lab.textContent = fmt(parseFloat(el.value));
    el.addEventListener('input', () => {
      lab.textContent = fmt(parseFloat(el.value));
      apply(parseFloat(el.value));
    });
  }
  function bindToggle(id, key, after) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      SETTINGS[key] = on;
      after && after(on);
      game.applySettings();
    });
    el.classList.toggle('on', !!SETTINGS[key]);
  }

  bindSlider('optRD', 'optRDv', v => v + ' 区块', v => { SETTINGS.renderDistance = v; game.applySettings(); game.lastCX = 1e9; });
  bindSlider('optFov', 'optFovv', v => v + '°', v => { SETTINGS.fov = v; game.applySettings(); });
  bindSlider('optBri', 'optBriv', v => v + '%', v => { SETTINGS.brightness = v; game.applySettings(); });

  bindToggle('optSmooth', 'smoothLighting', () => {
    // 立即重建视野内网格
    for (const [, c] of game.world.chunks) c.dirtyMesh = true;
  });
  bindToggle('optBob', 'viewBob');
  bindToggle('optDayCycle', 'dayCycle');
  bindToggle('optDeco', 'deco');
  bindToggle('optCaves', 'caves');
  bindToggle('optClouds', 'clouds');
  bindToggle('optSound', 'sound');
  bindToggle('optDebug', 'debugToggle', on => { game.debugOn = on; });

  /* ---------- 新建世界 ---------- */
  document.getElementById('btnNewGo').addEventListener('click', () => {
    const raw = document.getElementById('seedInput').value.trim();
    let seed;
    if (!raw) seed = (Math.random() * 0x7fffffff) | 0;
    else if (/^-?\d+$/.test(raw)) seed = parseInt(raw, 10) | 0;
    else { seed = 0; for (let i = 0; i < raw.length; i++) seed = (Math.imul(seed, 31) + raw.charCodeAt(i)) | 0; }
    const flat = document.getElementById('nwFlat').classList.contains('on');
    loadMsg.textContent = '正在生成新世界…';
    loading.classList.remove('hide');
    loading.style.opacity = '1';
    setProgress(0.2, '生成世界…');
    setTimeout(() => {
      game.newWorld(seed, flat);
      setProgress(0.7, '构建地形…');
      setTimeout(() => {
        game.preloadSpawn();
        setProgress(1, '准备完成');
        newScreen.classList.add('hide');
        loading.classList.add('hide');
        menuScreen.classList.remove('hide');
        UI.toast('新世界已创建，种子：' + seed);
      }, 30);
    }, 30);
  });

  /* ---------- 物品栏搜索 ---------- */
  const invSearch = document.getElementById('invSearch');
  if (invSearch) invSearch.addEventListener('input', () => game.buildInventory(invSearch.value));

  /* ---------- 窗口尺寸 ---------- */
  window.addEventListener('resize', () => { if (game.renderer) game.renderer.resize(); });

  /* ---------- 启动 ---------- */
  loading.style.opacity = '1';
  game.boot(setProgress).then(() => {
    setProgress(1, '准备完成');
    loadMsg.textContent = '世界已就绪 · 种子 ' + game.world.seed;
    startBtn.style.display = 'block';
    startBtn.addEventListener('click', () => {
      loading.classList.add('hide');
      game.start();
      game.requestLock();
      game.selectSlot(0);
    });
  }).catch(err => {
    console.error(err);
    loadMsg.textContent = '初始化失败：' + err.message;
    loadMsg.style.color = '#ff8a8a';
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#f99;font-size:11px;line-height:1.5;max-width:92vw;white-space:pre-wrap;'
      + 'margin-top:18px;text-align:left;max-height:38vh;overflow:auto;background:rgba(0,0,0,.4);padding:10px';
    pre.textContent = (err.stack || String(err)).slice(0, 4000);
    loading.appendChild(pre);
  });
})();
