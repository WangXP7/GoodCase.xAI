/* =====================================================================
 * 浏览器自动化验收：真实点击 / 拖动 / 截图，逐项检查全部交互
 * 运行： node tools/verify.cjs
 * 环境变量：
 *   B300_URL     页面地址（默认 file:// 本地文件）
 *   CHROME_PATH  Chromium 可执行文件绝对路径
 * ===================================================================== */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'render');
fs.mkdirSync(OUT, { recursive: true });

const PW = 'C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = process.env.B300_URL || ('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.02 : tol); }

(async () => {
  const { chromium } = require(PW);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-web-security',
      '--allow-file-access-from-files'
    ]
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  console.log('\n页面地址: ' + URL + '\n');
  await page.goto(URL, { waitUntil: 'load', timeout: 40000 });
  try {
    await page.waitForFunction(() => !!window.__b300Ready, null, { timeout: 40000 });
  } catch (e) {
    console.error('页面初始化失败，浏览器输出：');
    consoleErrors.forEach(m => console.error('  console.error: ' + m));
    pageErrors.forEach(m => console.error('  pageerror: ' + m));
    const info = await page.evaluate(() => ({
      THREE: typeof window.THREE,
      OrbitControls: typeof (window.THREE && window.THREE.OrbitControls),
      DATA: typeof window.B300_DATA,
      MODEL: typeof window.B300_MODEL,
      ready: !!window.__b300Ready,
      loadingText: (document.getElementById('vpLoading') || {}).textContent,
      scripts: Array.prototype.map.call(document.scripts, x => x.src || 'inline')
    }));
    console.error(JSON.stringify(info, null, 2));
    throw e;
  }
  await page.waitForTimeout(1600);

  const snap = () => page.evaluate(() => window.__b300App.getState());
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); };
  const setRange = async (id, v) => page.evaluate(([sel, val]) => {
    const el = document.getElementById(sel);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);

  let s = await snap();

  /* ---------- 1. 渲染与模型显示 ---------- */
  console.log('\n--- 1. 渲染与模型显示 ---');
  check('WebGL 上下文可用', s.webgl, 'context=' + s.webgl);
  const f0 = s.frames;
  await page.waitForTimeout(900);
  const f1 = (await snap()).frames;
  check('主循环持续渲染', f1 > f0, 'frames ' + f0 + ' -> ' + f1 + ' (SwiftShader 软件渲染)');
  check('3D 场景有实际绘制', s.drawCalls > 20 && s.triangles > 1000,
    'drawCalls=' + s.drawCalls + ', triangles=' + s.triangles);
  check('可点击部件已注册', s.pickableCount >= 100, 'pickables=' + s.pickableCount + ', 部件类=' + s.partCount);
  const pix = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const t = document.createElement('canvas');
    t.width = 200; t.height = 150;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 200, 150);
    const d = g.getImageData(0, 0, 200, 150).data;
    let lit = 0, sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += l; sum2 += l * l; n++;
      if (l > 48) lit++;
    }
    const mean = sum / n;
    return {
      litRatio: lit / n,
      avg: mean,
      std: Math.sqrt(Math.max(0, sum2 / n - mean * mean))
    };
  });
  // 纯色背景 std≈0；有立体模型时明暗层次会让标准差明显上升
  check('模型在画面中可见（非纯背景）', pix.std > 10 && pix.litRatio > 0.015,
    '亮像素占比=' + (pix.litRatio * 100).toFixed(1) + '%, 平均亮度=' + pix.avg.toFixed(1) +
    ', 明暗标准差=' + pix.std.toFixed(1));
  check('初始状态为默认', s.mode === 'overview' && near(s.explode, 0) && s.playing && !s.xray && s.selectedPart === null,
    'mode=' + s.mode + ', explode=' + s.explode + ', playing=' + s.playing);
  check('画布尺寸有效', s.canvasW > 400 && s.canvasH > 300, s.canvasW + 'x' + s.canvasH);
  await shot('01-initial.png');

  /* ---------- 2. 播放 / 暂停 ---------- */
  console.log('\n--- 2. 播放与暂停 ---');
  await page.click('#btnPlay');
  await page.waitForTimeout(350);
  s = await snap();
  check('点击暂停 -> 播放停止', !s.playing && !s.autoRotate, 'playing=' + s.playing + ', autoRotate=' + s.autoRotate);
  await shot('02-paused.png');
  await page.click('#btnPlay');
  await page.waitForTimeout(350);
  s = await snap();
  check('再次点击 -> 继续播放', s.playing && s.autoRotate, 'playing=' + s.playing + ', autoRotate=' + s.autoRotate);

  /* ---------- 3. 手动调节 ---------- */
  console.log('\n--- 3. 手动调节 ---');
  await setRange('explodeSlider', 70);
  await page.waitForTimeout(1000);
  s = await snap();
  check('拆解滑块生效', near(s.explode, 0.70, 0.01) && s.explodeCurrent > 0.60,
    'explode=' + s.explode + ', current=' + s.explodeCurrent.toFixed(3));
  check('几何确实被拉开', s.sampleSegment && Math.abs(s.sampleSegment[1]) > 0.8,
    '托盘位移=' + (s.sampleSegment ? s.sampleSegment.map(v => v.toFixed(2)).join(',') : 'null'));
  await shot('03-explode-slider.png');

  await setRange('speedSlider', 160);
  await page.waitForTimeout(250);
  s = await snap();
  check('旋转速度滑块生效', near(s.speed, 1.6, 0.01), 'speed=' + s.speed);

  await page.click('#btnXray');
  await page.waitForTimeout(300);
  s = await snap();
  check('透视外壳生效', s.xray && s.shellOpacity < 0.3, 'xray=' + s.xray + ', shellOpacity=' + s.shellOpacity);
  await shot('08-xray.png');
  await page.click('#btnXray');
  await page.waitForTimeout(200);
  s = await snap();
  check('关闭透视可还原', !s.xray && near(s.shellOpacity, 1, .01), 'shellOpacity=' + s.shellOpacity);

  const camBefore = (await snap()).cameraPos;
  await page.click('[data-view="top"]');
  await page.waitForTimeout(1400);
  s = await snap();
  check('视角预设生效', s.view === 'top' && s.cameraPos[1] > 10,
    'view=' + s.view + ', cameraY=' + s.cameraPos[1].toFixed(2) + ' (原 ' + camBefore[1].toFixed(2) + ')');
  await shot('04-view-top.png');
  await page.click('[data-view="iso"]');
  await page.waitForTimeout(1200);

  /* ---------- 4. 演示模式切换（替代「冲程切换」） ---------- */
  console.log('\n--- 4. 演示模式切换 ---');
  await page.click('[data-mode="explode"]');
  await page.waitForTimeout(1100);
  s = await snap();
  check('模式 模块分解', s.mode === 'explode' && s.explode > 0.8 && Math.abs(s.sampleSegment[1]) > 1.8,
    'explode=' + s.explode + ', 托盘Y=' + s.sampleSegment[1].toFixed(2));
  await shot('05-mode-explode.png');

  await page.click('[data-mode="airflow"]');
  await page.waitForTimeout(900);
  s = await snap();
  check('模式 散热风道（气流 + 半透外壳）',
    s.mode === 'airflow' && s.airflowVisible && s.airflowArrows > 0 && s.shellOpacity < 0.3,
    'airflow=' + s.airflowVisible + ', arrows=' + s.airflowArrows + ', shellOpacity=' + s.shellOpacity);
  const arrowA = await page.evaluate(() => {
    const a = window.__b300App.getState();
    return a.readoutText;
  });
  await page.waitForTimeout(600);
  check('气流模式读数刷新', typeof arrowA === 'string' && arrowA.indexOf('气流演示') >= 0, 'readout 含气流演示');
  await shot('06-mode-airflow.png');

  await page.click('[data-mode="core"]');
  await page.waitForTimeout(900);
  s = await snap();
  const hiddenOk = ['chassis', 'trayTop', 'trayBottom', 'vent', 'psu', 'io']
    .every(id => s.visibleParts.indexOf(id) < 0);
  const coreOk = ['gpu', 'baseboard', 'cpu', 'nvlink', 'cooling']
    .every(id => s.visibleParts.indexOf(id) >= 0);
  check('模式 核心部件（外壳隐藏 / 核心保留）', s.mode === 'core' && hiddenOk && coreOk,
    '可见部件=' + s.visibleParts.join(','));
  await shot('07-mode-core.png');

  await page.click('[data-mode="overview"]');
  await page.waitForTimeout(800);
  s = await snap();
  check('回到整机总览', s.mode === 'overview' && near(s.explode, 0) && !s.airflowVisible && near(s.shellOpacity, 1, .01),
    'mode=' + s.mode + ', explode=' + s.explode + ', airflow=' + s.airflowVisible);

  /* ---------- 5. 部件说明 ---------- */
  console.log('\n--- 5. 部件说明 ---');
  const box = await page.locator('#gl').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  s = await snap();
  check('点击 3D 模型可选中部件', !!s.selectedPart, 'selectedPart=' + s.selectedPart);
  check('部件说明卡内容完整',
    s.partCardName.length > 0 && s.partCardDesc.length > 20 && s.partCardTip.length > 5,
    'name=' + s.partCardName + ', desc=' + s.partCardDesc.length + '字, tip=' + s.partCardTip.length + '字');
  await shot('09-part-info.png');

  await page.click('.part-item[data-id="gpu"]');
  await page.waitForTimeout(300);
  s = await snap();
  check('左侧列表点选部件', s.selectedPart === 'gpu' && s.partCardName.indexOf('B300') >= 0,
    'selectedPart=' + s.selectedPart + ', card=' + s.partCardName);

  /* ---------- 6. 教学说明 ---------- */
  console.log('\n--- 6. 教学说明 ---');
  await page.click('#btnHelp');
  await page.waitForTimeout(300);
  s = await snap();
  check('教学说明浮层可打开', s.helpOpen, 'helpOpen=' + s.helpOpen);
  await shot('10-teaching.png');
  await page.click('#btnHelpClose');
  await page.waitForTimeout(250);
  s = await snap();
  check('教学说明浮层可关闭', !s.helpOpen, 'helpOpen=' + s.helpOpen);

  /* ---------- 7. 重置 ---------- */
  console.log('\n--- 7. 重置 ---');
  await page.click('[data-mode="airflow"]');
  await setRange('explodeSlider', 55);
  await setRange('speedSlider', 180);
  await page.click('.part-item[data-id="cpu"]');
  await page.click('[data-view="back"]');
  await page.waitForTimeout(700);
  const dirty = await snap();
  await page.click('#btnReset');
  await page.waitForTimeout(700);
  s = await snap();
  const resetOk = s.mode === 'overview' && near(s.explode, 0) && near(s.explodeCurrent, 0, .01) &&
    near(s.speed, 1) && !s.xray && near(s.shellOpacity, 1, .01) &&
    s.selectedPart === null && s.view === 'iso' && s.playing &&
    !s.airflowVisible && s.visibleParts.length === s.partCount &&
    s.sampleSegment && Math.abs(s.sampleSegment[1]) < .02;
  check('重置全部恢复默认', resetOk,
    '改前: mode=' + dirty.mode + ' explode=' + dirty.explode + ' speed=' + dirty.speed +
    ' | 改后: mode=' + s.mode + ' explode=' + s.explode + ' speed=' + s.speed +
    ' xray=' + s.xray + ' view=' + s.view + ' selected=' + s.selectedPart);
  await shot('11-reset.png');

  /* ---------- 8. 布局 / 错误 ---------- */
  console.log('\n--- 8. 布局与错误 ---');
  const layout = await page.evaluate(() => {
    const de = document.documentElement;
    const panels = Array.prototype.map.call(document.querySelectorAll('.panel'), el => ({
      sw: el.scrollWidth, cw: el.clientWidth
    }));
    const tb = document.querySelector('.toolbar');
    return {
      sw: de.scrollWidth, iw: window.innerWidth,
      sh: de.scrollHeight, ih: window.innerHeight,
      panels: panels, toolbarOverflow: tb.scrollWidth - tb.clientWidth
    };
  });
  check('页面无横向溢出', layout.sw <= layout.iw + 1, 'scrollWidth=' + layout.sw + ', innerWidth=' + layout.iw);
  check('页面无纵向溢出', layout.sh <= layout.ih + 1, 'scrollHeight=' + layout.sh + ', innerHeight=' + layout.ih);
  check('侧栏无横向滚动', layout.panels.every(p => p.sw <= p.cw + 1),
    JSON.stringify(layout.panels));
  check('控制条无溢出', layout.toolbarOverflow <= 1, '溢出=' + layout.toolbarOverflow + 'px');
  check('无 JS 运行时错误', pageErrors.length === 0, pageErrors.join(' | ') || '0 个');
  check('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '0 个');

  /* ---------- 汇总 ---------- */
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  const report = {
    url: URL, time: new Date().toISOString(),
    viewport: { width: 1600, height: 900 },
    total: results.length, pass: pass, fail: fail,
    finalState: await snap(),
    consoleErrors: consoleErrors, pageErrors: pageErrors,
    results: results
  };
  fs.writeFileSync(path.join(OUT, 'verify-result.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n============================================');
  console.log('  验收结果: ' + pass + ' 通过 / ' + fail + ' 失败  (共 ' + results.length + ' 项)');
  console.log('  截图目录: ' + OUT);
  console.log('============================================\n');

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n验收脚本异常: ' + e.stack);
  process.exit(2);
});
