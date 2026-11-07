/* =====================================================================
 * 浏览器自动化验收：真实点击 / 拖动 / 截图，检查全部交互
 * 运行： node tools/verify.cjs
 * 可选环境变量：
 *   ENGINE_URL      页面地址（默认 file:// 本地文件）
 *   CHROME_PATH     Chromium 可执行文件绝对路径
 * ===================================================================== */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'render');
fs.mkdirSync(OUT, { recursive: true });

const PW = 'C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = process.env.ENGINE_URL || ('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  → ' + detail : ''));
}

(async () => {
  const { chromium } = require(PW);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-web-security'
    ]
  });
  const page = await browser.newPage({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  console.log('\n页面地址: ' + URL + '\n');
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !!window.__engineApp, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const snap = () => page.evaluate(() => window.__engineApp.getState());
  let s = await snap();

  /* ---------- 1. 渲染 ---------- */
  check('WebGL 上下文可用', s.webgl, 'context=' + s.webgl);
  // 无头浏览器走 SwiftShader 软件渲染，帧率远低于真实 GPU，
  // 因此用「帧数继续增长」判定主循环存活，而不是硬性帧率阈值。
  const f0 = s.frames;
  await page.waitForTimeout(700);
  const f1 = (await snap()).frames;
  check('主循环持续渲染', f1 > f0, 'frames ' + f0 + ' → ' + f1 + ' (软件渲染)');
  check('3D 场景有实际绘制', s.drawCalls > 20, 'drawCalls=' + s.drawCalls + ', triangles=' + s.triangles);
  check('可点击部件已注册', s.pickableCount > 100, 'pickables=' + s.pickableCount);
  const layout = await page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const schem = document.getElementById('schematic').closest('.card');
    const vp = document.getElementById('gl');
    const r1 = sb.getBoundingClientRect(), r2 = schem.getBoundingClientRect();
    return { sidebarScroll: sb.scrollHeight, sidebarClient: sb.clientHeight,
             schematicBottom: r2.bottom, sidebarBottom: r1.bottom,
             canvasW: vp.clientWidth, canvasH: vp.clientHeight,
             bodyScrollX: document.body.scrollWidth > window.innerWidth };
  });
  check('四冲程示意卡在 900px 首屏完整可见',
    layout.schematicBottom <= layout.sidebarBottom + 1,
    '示意卡底=' + layout.schematicBottom.toFixed(0) + ' / 侧栏底=' + layout.sidebarBottom.toFixed(0));
  check('页面无横向溢出', !layout.bodyScrollX, 'canvas=' + layout.canvasW + 'x' + layout.canvasH);
  await page.screenshot({ path: path.join(OUT, '01-initial.png') });

  // 课堂投影常见的 1080p：确认侧栏全部内容无需滚动
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(250);
  const fit1080 = await page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    return { scroll: sb.scrollHeight, client: sb.clientHeight };
  });
  check('1080p 分辨率下右侧信息栏无需滚动',
    fit1080.scroll <= fit1080.client + 8,
    'content=' + fit1080.scroll + 'px / view=' + fit1080.client + 'px');
  await page.screenshot({ path: path.join(OUT, '01b-1080p.png') });
  await page.setViewportSize({ width: 1560, height: 900 });
  await page.waitForTimeout(250);

  /* ---------- 2. 初始四缸时序 ---------- */
  const initNames = s.strokes.map(x => x.name).join('/');
  check('θ=0° 四缸相位正确 (做功/排气/压缩/进气)',
    initNames === '做功/排气/压缩/进气', initNames);
  check('θ=0° 仅 1 缸点火',
    s.strokes[0].spark > 0.9 && s.strokes.slice(1).every(x => x.spark === 0),
    s.strokes.map(x => x.spark).join('/'));
  check('θ=0° 气门状态正确',
    !s.strokes[0].intake && !s.strokes[0].exhaust &&
    s.strokes[3].intake && s.strokes[1].exhaust,
    JSON.stringify(s.strokes.map(x => [x.intake, x.exhaust])));

  /* ---------- 3. 自动播放 / 暂停 ---------- */
  await page.click('#btnPlay');
  await page.waitForTimeout(1100);
  const sPlay = await snap();
  check('自动播放：角度持续增加', sPlay.angle > s.angle + 30,
    s.angle.toFixed(1) + '° → ' + sPlay.angle.toFixed(1) + '°');
  check('自动播放：状态为运行中', sPlay.playing === true, 'playing=' + sPlay.playing);
  check('自动播放：底部按钮文字变为「暂停」',
    (await page.textContent('#playTxt')) === '暂停');
  await page.screenshot({ path: path.join(OUT, '02-playing.png') });

  await page.click('#btnPlay');
  await page.waitForTimeout(400);
  const sPause = await snap();
  const sPause2 = await snap();
  check('暂停：角度不再变化', Math.abs(sPause.angle - sPause2.angle) < 0.001,
    sPause.angle.toFixed(2) + '°');
  check('暂停：状态为已暂停', sPause.playing === false);

  /* ---------- 4. 速度调节 ---------- */
  await page.evaluate(() => {
    const el = document.getElementById('speedSlider');
    el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const spd = await snap();
  check('速度调节生效', Math.abs(spd.speed - 2.5) < 0.001 &&
    (await page.textContent('#speedOut')) === '2.50×', 'speed=' + spd.speed);
  await page.evaluate(() => {
    const el = document.getElementById('speedSlider');
    el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ---------- 5. 手动拖动曲轴角度滑块（真实鼠标拖动） ---------- */
  const box = await page.locator('#angleSlider').boundingBox();
  const target = 450 / 720;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * target, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const sDrag = await snap();
  check('拖动滑块可停在任意角度', Math.abs(sDrag.angle - 450) < 12,
    'angle=' + sDrag.angle.toFixed(1) + '° (目标 450°)');
  check('拖动时自动暂停，状态即时刷新', sDrag.playing === false &&
    sDrag.strokes[0].name === '进气', '缸1=' + sDrag.strokes[0].name);

  /* ---------- 6. 单步按钮 / 下一冲程 ---------- */
  const beforeStep = (await snap()).angle;
  await page.click('#btnStepFwd');
  await page.click('#btnStepFwd');
  const afterFwd = (await snap()).angle;
  check('+15° 单步推进 ×2 = +30°', Math.abs(afterFwd - beforeStep - 30) < 0.01,
    beforeStep.toFixed(1) + '° → ' + afterFwd.toFixed(1) + '°');
  await page.click('#btnStepBack');
  const afterBack = (await snap()).angle;
  check('−15° 单步后退', Math.abs(afterBack - afterFwd + 15) < 0.01,
    afterFwd.toFixed(1) + '° → ' + afterBack.toFixed(1) + '°');
  await page.click('#btnNextStroke');
  const sNext = await snap();
  check('「下一冲程」跳到 180° 边界', Math.abs(sNext.angle % 180) < 0.01,
    'angle=' + sNext.angle.toFixed(1) + '°');

  /* ---------- 7. 四冲程定位按钮 + 冲程切换 ---------- */
  const seg = page.locator('.seg-btn');
  const labels = ['进气', '压缩', '做功', '排气'];
  for (let k = 0; k < 4; k++) {
    await seg.nth(k).click();
    await page.waitForTimeout(260);
    const st = await snap();
    check('定位冲程「' + labels[k] + '」→ 缸1 为' + labels[k] + '冲程',
      st.strokes[0].name === labels[k],
      'θ=' + st.angle.toFixed(0) + '° 缸1=' + st.strokes[0].name);
    await page.screenshot({ path: path.join(OUT, '0' + (3 + k) + '-stroke-' + k + '.png') });
  }
  // 点火闪光：做功定位应点亮 1 缸
  await seg.nth(2).click();
  await page.waitForTimeout(260);
  check('做功冲程起点火花塞点亮',
    (await snap()).strokes[0].spark > 0.9);

  /* ---------- 8. 720° 完整循环点火顺序 1-3-4-2 ---------- */
  const fireSeq = await page.evaluate(() => {
    const out = [];
    for (let a = 0; a < 720; a += 15) {
      const st = window.__engineApp.E.cylinderState(a, 0);
      // 找出此刻处于点火瞬间的缸（用各缸自己的 spark）
      for (let i = 0; i < 4; i++) {
        const x = window.__engineApp.E.cylinderState(a, i);
        if (x.spark > 0.99 && x.stroke === 2) out.push(a + ':' + (i + 1));
      }
      void st;
    }
    // 去重并按角度取 4 个主点火点
    const uniq = [];
    for (const e of out) { if (!uniq.some(u => u[1] === e.split(':')[1])) uniq.push(e.split(':')); }
    return uniq.slice(0, 4).map(u => u[0] + '°→' + u[1] + '缸');
  });
  check('点火顺序 0°→1缸 / 180°→3缸 / 360°→4缸 / 540°→2缸',
    fireSeq.join(' ') === '0°→1缸 180°→3缸 360°→4缸 540°→2缸', fireSeq.join(' '));

  /* ---------- 9. 点击 3D 部件显示说明 ---------- */
  const hit = await page.evaluate(() => {
    const cv = document.getElementById('gl');
    const r = cv.getBoundingClientRect();
    const eng = window.__engineApp.engine;
    for (let y = 0.22; y < 0.85; y += 0.035) {
      for (let x = 0.18; x < 0.86; x += 0.025) {
        const info = eng.pick(r.left + r.width * x, r.top + r.height * y);
        if (info) return { px: r.left + r.width * x, py: r.top + r.height * y, name: info.name };
      }
    }
    return null;
  });
  check('3D 场景可拾取到部件', !!hit, hit ? hit.name : 'no hit');
  if (hit) {
    await page.mouse.click(hit.px, hit.py);
    await page.waitForTimeout(120);
    const shown = await page.textContent('#partName');
    const desc = await page.textContent('#partDesc');
    check('点击部件显示名称与说明', !!shown && desc.length > 20, shown + ' / ' + desc.slice(0, 26) + '…');
    check('部件说明卡可见', await page.locator('#partInfo').isVisible());
    await page.screenshot({ path: path.join(OUT, '07-part-info.png') });
  }

  /* ---------- 10. 外壳 / 剖视 ---------- */
  await page.uncheck('#chkCut');
  await page.waitForTimeout(200);
  check('关闭剖视 → 提示切换为透视外壳',
    (await page.textContent('#cutBadge')).indexOf('透视外壳') >= 0);
  await page.screenshot({ path: path.join(OUT, '08-ghost-shell.png') });
  await page.check('#chkCut');
  await page.uncheck('#chkShell');
  await page.waitForTimeout(200);
  check('隐藏外壳后仍正常渲染', (await snap()).drawCalls > 20);
  await page.screenshot({ path: path.join(OUT, '09-no-shell.png') });
  await page.check('#chkShell');

  /* ---------- 11. 复位视角 / 教学说明 ---------- */
  const camBefore = await page.evaluate(() => window.__engineApp.engine.camera.position.toArray());
  await page.evaluate(() => window.__engineApp.engine.camera.position.set(30, 20, 30));
  await page.click('#btnResetView');
  const camAfter = await page.evaluate(() => window.__engineApp.engine.camera.position.toArray());
  check('复位视角回到默认机位',
    Math.abs(camAfter[0] - 11.5) < 0.01 && Math.abs(camAfter[2] - 16.4) < 0.01,
    camAfter.map(v => v.toFixed(1)).join(','));

  await page.click('#btnHelp');
  await page.waitForTimeout(150);
  check('教学说明弹层可打开', await page.locator('#helpModal').isVisible());
  const helpTxt = await page.textContent('.modal-body');
  check('说明包含能量转换 / 曲轴两圈 / 点火顺序',
    helpTxt.includes('化学能') && helpTxt.includes('720°') && helpTxt.includes('1 → 3 → 4 → 2'));
  await page.screenshot({ path: path.join(OUT, '10-teaching.png') });
  await page.click('#btnCloseHelp');
  check('教学说明弹层可关闭', !(await page.locator('#helpModal').isVisible()));

  /* ---------- 12. 重置 ---------- */
  await page.click('#btnPlay');
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const el = document.getElementById('speedSlider');
    el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#btnReset');
  await page.waitForTimeout(150);
  const sReset = await snap();
  check('重置：角度归零 / 暂停 / 速度回 1×',
    sReset.angle === 0 && !sReset.playing && Math.abs(sReset.speed - 1) < 0.001,
    JSON.stringify({ angle: sReset.angle, playing: sReset.playing, speed: sReset.speed }));
  check('重置：部件说明清空', !(await page.locator('#partInfo').isVisible()));
  await page.screenshot({ path: path.join(OUT, '11-reset.png') });

  /* ---------- 13. 键盘快捷键 ---------- */
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.press('ArrowRight');
  check('键盘 → 单步 15°', Math.abs((await snap()).angle - 15) < 0.01);
  await page.keyboard.press('Space');
  check('键盘空格播放', (await snap()).playing === true);
  await page.keyboard.press('Space');
  check('键盘空格暂停', (await snap()).playing === false);
  await page.keyboard.press('r');
  check('键盘 R 重置', (await snap()).angle === 0);

  /* ---------- 14. 控制台错误 ---------- */
  const realErrors = consoleErrors.filter(t => !/favicon|Failed to load resource.*404/i.test(t));
  check('无 JS 运行时异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log('\n==================================================');
  console.log('  验收结果： ' + pass + ' / ' + results.length + ' 项通过');
  results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + r.detail));
  console.log('  截图目录： ' + OUT);
  console.log('==================================================\n');

  fs.writeFileSync(path.join(OUT, 'verify-result.json'),
    JSON.stringify({ url: URL, time: new Date().toISOString(),
      pass: pass, total: results.length, results: results,
      consoleErrors: realErrors, pageErrors }, null, 2));

  process.exit(pass === results.length ? 0 : 1);
})().catch(e => {
  console.error('\n[VERIFY CRASH] ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
