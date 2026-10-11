/* =====================================================================
 * TIDELINE · 真实浏览器验收（PH6 · 主理人独立验证）
 *
 * 为什么必须做：tests/*.js 全部跑在 Node vm 沙箱里 —— 它们跳过 gl.js /
 * batcher.js / post.js，用桩替换 Input 与 Audio。也就是说
 *   · WebGL2 着色器是否真的编译通过        → 从未验证
 *   · 图集纹理是否真的上传成功            → 从未验证
 *   · DOM HUD / 屏幕 / 按钮是否真的可点    → 从未验证
 *   · WebAudio 是否真的能出声              → 从未验证
 * 本脚本在**真 Chromium** 里跑真实入口 index.html，补齐这一层。
 *
 * 运行：
 *   node tests/browser-verify.js
 * 输出：
 *   tests/_shots/*.png  截图证据
 *   控制台摘要（含 PASS/FAIL 计数）
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = process.env.TL_ROOT
  ? path.resolve(__dirname, '..', process.env.TL_ROOT)
  : path.join(__dirname, '..', 'src');
const ENTRY = process.env.TL_ENTRY || 'index.html';
const SHOTS = process.env.TL_SHOTS
  ? path.resolve(__dirname, '..', process.env.TL_SHOTS)
  : path.join(__dirname, '_shots');

/* playwright-core 装在受管 workspace 里，不进项目 node_modules */
const PW_PATHS = [
  '<本机用户目录>/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
];
const CHROME_CANDIDATES = [
  '<本机 Chromium, 建议用环境变量 CHROME_PATH 传入>',
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json'
};

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else {
    fail++; failures.push(name + (extra !== undefined ? ' \u2192 ' + extra : ''));
    console.log('  \u2717 ' + name + (extra !== undefined ? '  \u2192  ' + extra : ''));
  }
}

function startServer() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  console.log('\n=== 《潮线 TIDELINE》真实浏览器验收 ===\n');

  let chromium;
  for (const p of PW_PATHS) { try { chromium = require(p).chromium; break; } catch (e) { } }
  if (!chromium) { console.log('  ! 找不到 playwright-core，跳过浏览器验收'); process.exitCode = 2; return; }

  let exe = null;
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) { exe = c; break; }
  if (!exe) { console.log('  ! 找不到 Chromium 可执行文件，跳过'); process.exitCode = 2; return; }

  fs.mkdirSync(SHOTS, { recursive: true });
  /* TL_URL 直连外部地址（例如已发布的公网链接）：跳过本地服务器，
     用**同一套断言**验证线上环境，而不是"能打开就算过"。 */
  const EXTERNAL_URL = process.env.TL_URL || '';
  const srv = EXTERNAL_URL ? null : await startServer();
  const url = EXTERNAL_URL || ('http://127.0.0.1:' + srv.address().port + '/' + ENTRY);
  console.log('  ' + (EXTERNAL_URL ? '外部目标' : '本地服务') + '：' + url + '\n  Chromium：' + exe + '\n');

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--use-gl=angle', '--no-sandbox', '--mute-audio']
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

    /* ---- 收集所有错误：这是本层最核心的价值 ---- */
    const errors = [], warnings = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push('console.error: ' + m.text());
      else if (m.type() === 'warning') warnings.push(m.text());
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);

    /* ---------- ① 启动无错 / WebGL 上下文 ---------- */
    console.log('\u2460 \u542f\u52a8\u4e0e WebGL');
    check('\u9875\u9762\u65e0 JS \u9519\u8bef', errors.length === 0, errors.slice(0, 3).join(' | '));

    const gl = await page.evaluate(() => {
      const c = document.getElementById('gl');
      if (!c) return { ok: false, why: 'no canvas' };
      const g2 = c.getContext('webgl2');
      const g1 = c.getContext('webgl');
      return {
        ok: true, hasGL2: !!g2, hasGL1: !!g1,
        w: c.width, h: c.height,
        renderer: g2 ? g2.getParameter(g2.RENDERER) : null
      };
    });
    check('canvas #gl \u5b58\u5728\u4e14\u5c3a\u5bf8 1440x864', gl.ok && gl.w === 1440 && gl.h === 864, JSON.stringify(gl));
    check('\u53d6\u5f97 WebGL \u4e0a\u4e0b\u6587', gl.hasGL2 || gl.hasGL1, 'GL2=' + gl.hasGL2 + ' GL1=' + gl.hasGL1);
    console.log('  \u00b7 \u6e32\u67d3\u5668\uff1a' + gl.renderer);

    /* 标题页是否真的渲染出内容（不是纯黑 / 不是空白） */
    const titleShot = path.join(SHOTS, '01-title.png');
    await page.screenshot({ path: titleShot });
    const px = await page.evaluate(() => {
      const c = document.getElementById('gl');
      const g = c.getContext('webgl2') || c.getContext('webgl');
      const buf = new Uint8Array(4 * 64 * 64);
      g.readPixels(700, 400, 64, 64, g.RGBA, g.UNSIGNED_BYTE, buf);
      let sum = 0, distinct = new Set();
      for (let i = 0; i < buf.length; i += 4) {
        sum += buf[i] + buf[i + 1] + buf[i + 2];
        distinct.add(buf[i] + ',' + buf[i + 1] + ',' + buf[i + 2]);
      }
      return { mean: sum / (buf.length / 4) / 3, kinds: distinct.size };
    });
    check('\u753b\u9762\u975e\u7eaf\u9ed1\uff08\u6709\u5b9e\u9645\u7ed8\u5236\u5185\u5bb9\uff09', px.mean > 6, 'mean=' + px.mean.toFixed(1));
    check('\u753b\u9762\u6709\u8272\u5f69\u5c42\u6b21\uff08\u975e\u5355\u8272\u5757\uff09', px.kinds > 3, px.kinds + ' \u79cd\u989c\u8272');

    /* ---------- ② 标题页 UI ---------- */
    console.log('\n\u2461 \u6807\u9898\u9875\u4e0e\u8bbe\u7f6e');
    const ui = await page.evaluate(() => {
      const p = document.getElementById('panel');
      return {
        screensShown: document.getElementById('screens').classList.contains('show'),
        hasTitle: /潮线 TIDELINE/.test(p.textContent),
        buttons: [...p.querySelectorAll('button')].map(b => b.textContent.trim()),
        opts: [...p.querySelectorAll('[data-opt]')].map(n => n.getAttribute('data-opt'))
      };
    });
    check('\u6807\u9898\u5c4f\u5e55\u53ef\u89c1', ui.screensShown && ui.hasTitle);
    check('\u6709\u300c\u5f00\u59cb\u6e38\u620f\u300d\u6309\u94ae', ui.buttons.some(b => /开\s*始/.test(b)), ui.buttons.join('/'));
    const needOpts = ['shake', 'flash', 'jitter', 'crt', 'particles', 'colorblind', 'qteAssist', 'mute', 'music'];
    const missOpts = needOpts.filter(o => !ui.opts.includes(o));
    check('5 \u4e2a\u6b63\u4ea4\u5f00\u5173 + \u53ef\u8bbf\u95ee\u6027\u9009\u9879\u9f50\u5168', missOpts.length === 0, '\u7f3a ' + missOpts.join(','));

    /* ---------- ③ 开始游戏：主循环真的在跑 ---------- */
    console.log('\n\u2462 \u4e3b\u5faa\u73af');
    /* ⭐ 必须用**真实指针点击**，不能用 el.click() 或 locator.click() 的程序化路径：
       input.js 曾在 pointerdown 上无条件 preventDefault()，按规范会抑制后续
       click 事件 → 玩家用鼠标点不动任何菜单按钮。程序化点击不产生 pointerdown，
       因此察觉不到。这里刻意走 page.mouse.click()，把它固化为回归项。 */
    const startBtn = await page.evaluate(() => {
      const b = document.querySelector('[data-act="start"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2,
               topEl: (function(){ var e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return e?e.tagName:'null'; })() };
    });
    check('「开始游戏」按钮未被遮挡（命中测试）', startBtn && startBtn.topEl === 'BUTTON', startBtn ? startBtn.topEl : 'n/a');
    await page.mouse.click(startBtn.x, startBtn.y);
    await page.waitForTimeout(1200);

    const running = await page.evaluate(() => {
      const G = window.TL && window.TL.Game;
      if (!G) return { ok: false };
      return {
        ok: true, time: G.time, running: G.running, over: G.over,
        pickups: window.TL.Pickups.count(), prey: window.TL.Prey.list.length,
        sharkX: G.shark.x, sharkY: G.shark.y, speed: G.shark.speed,
        alarm: G.alarm, zone: G.shark.zone,
        screensHidden: !document.getElementById('screens').classList.contains('show')
      };
    });
    check('Game \u5bf9\u8c61\u5b58\u5728\u4e14\u5df2\u8fdb\u5165\u8fd0\u884c', running.ok && running.running && running.time > 0.5,
      'time=' + (running.ok ? running.time.toFixed(2) : 'n/a'));
    check('\u5f00\u59cb\u540e\u5c4f\u5e55\u9762\u677f\u6536\u8d77', running.screensHidden === true);
    check('\u9ca8\u9c7c\u5728\u52a8\uff08\u901f\u7387 > 0\uff09', running.speed > 0, 'speed=' + running.speed);
    check('\u526f\u5faa\u73af\u6536\u96c6\u7269\u6c60 = 8', running.pickups === 8, running.pickups);
    check('\u730e\u7269\u5df2\u751f\u6210', running.prey > 0, running.prey);

    /* 连按方向键，确认玩家输入真的能改姿态 */
    const before = await page.evaluate(() => ({ x: window.TL.Game.shark.x, th: window.TL.Game.shark.theta }));
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowLeft');
    const after = await page.evaluate(() => ({ x: window.TL.Game.shark.x, th: window.TL.Game.shark.theta }));
    check('\u65b9\u5411\u952e\u80fd\u6539\u53d8\u9ca8\u9c7c\u4f4d\u7f6e', Math.abs(after.x - before.x) > 5,
      'x ' + before.x.toFixed(0) + ' \u2192 ' + after.x.toFixed(0));

    /* 冲刺 */
    const dash = await page.evaluate(async () => {
      const s = window.TL.Game.shark;
      const st0 = s.stamina;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      await new Promise(r => setTimeout(r, 60));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
      await new Promise(r => setTimeout(r, 260));
      return { st0: st0, st1: s.stamina, dashT: s.dashT, state: s.state };
    });
    check('\u7a7a\u683c\u89e6\u53d1\u51b2\u523a\uff08\u4f53\u529b\u6263\u9664\uff09', dash.st1 < dash.st0 || dash.state === 'dash' || dash.dashT >= 0,
      '\u4f53\u529b ' + dash.st0.toFixed(2) + '\u2192' + dash.st1.toFixed(2) + ' state=' + dash.state);

    /* ---------- ④ 长时间运行稳定性 + 帧率 ---------- */
    console.log('\n\u2463 \u957f\u65f6\u8fd0\u884c\u4e0e\u5e27\u7387');
    const soak = await page.evaluate(async () => {
      const G = window.TL.Game, C = window.TL.C;
      let frames = 0, nan = false, alarmOOR = false;
      const t0 = performance.now();
      let last = t0;
      const tick = () => {
        const now = performance.now();
        if (now - last > 400) last = now;   // 粗略：仅在外部读值时统计
      };
      // 直接推进逻辑 30 秒等价（以真实 update 调用，跳过渲染）
      for (let i = 0; i < 60 * 30; i++) {
        G.update(C.FIXED_DT);
        frames++;
        const s = G.shark;
        if (!isFinite(s.x) || !isFinite(s.y) || !isFinite(s.theta) ||
          !isFinite(s.speed) || !isFinite(G.alarm) || !isFinite(s.stamina)) nan = true;
        if (G.alarm < -0.001 || G.alarm > 100.001) alarmOOR = true;
        if (G.over) G.reset();
      }
      return {
        frames: frames, nan: nan, alarmOOR: alarmOOR,
        fx: window.TL.FX.count, comboCnt: G.stats.collects,
        ms: performance.now() - t0
      };
    });
    check('30 s \u53e0\u4ee3\u65e0 NaN / Infinity', !soak.nan);
    check('30 s \u53e0\u4ee3 ALARM \u6052\u5728 [0,100]', !soak.alarmOOR);
    check('\u7c92\u5b50\u6c60\u672a\u6ea2\u51fa\uff08\u2264 520\uff09', soak.fx <= 520, soak.fx);
    console.log('  \u00b7 30 s \u7eaf\u903b\u8f91\u8017\u65f6 ' + soak.ms.toFixed(0) + ' ms\uff08\u542b ' + soak.frames + ' \u5e27\uff09');

    /* 真实帧率（带渲染） */
    const fps = await page.evaluate(() => new Promise(res => {
      let n = 0; const t0 = performance.now();
      const loop = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(loop);
    }));
    check('\u771f\u5b9e\u5e27\u7387 \u2265 20 fps\uff08\u8f6f\u4ef6\u5149\u6805\u4e0b\u7684\u4fdd\u5b88\u95e8\u69db\uff09', fps >= 20, fps.toFixed(1) + ' fps');
    console.log('  \u00b7 \u5b9e\u6d4b ' + fps.toFixed(1) + ' fps\uff08SwiftShader \u8f6f\u4ef6\u6e32\u67d3\uff0c\u975e\u72ec\u663e\u6027\u80fd\uff09');

    /* ---------- ⑤ 光敏安全：开关真的能独立关掉效果 ---------- */
    console.log('\n\u2464 \u786c\u7ea2\u7ebf\u2460\uff1a\u5149\u654f\u5b89\u5168\u5f00\u5173');
    const safety = await page.evaluate(async () => {
      const out = {};
      const setOpt = (key, val) => {
        const n = document.querySelector('[data-opt="' + key + '"]');
        if (!n) return false;
        if (n.tagName === 'SELECT') { n.value = String(val); n.dispatchEvent(new Event('change')); }
        else { n.checked = !!val; n.dispatchEvent(new Event('change')); }
        return true;
      };
      window.TL.HUD.pause(window.TL.Game);
      await new Promise(r => setTimeout(r, 60));
      out.hasCrt = setOpt('crt', false);
      out.hasFlash = setOpt('flash', false);
      await new Promise(r => setTimeout(r, 60));
      out.noCrtClass = document.documentElement.classList.contains('no-crt');
      out.noFlashClass = document.documentElement.classList.contains('no-flash');
      out.breathConstant = (() => {
        // 关闭闪烁后，所有 U.breath 调用必须返回常亮 1.0
        const a = window.TL.U.breath(0.0, 2), b = window.TL.U.breath(0.3, 2), c = window.TL.U.breath(0.77, 2);
        return a === 1.0 && b === 1.0 && c === 1.0;
      })();
      out.maxHz = window.TL.C.MAX_FLASH_HZ;
      return out;
    });
    check('\u53ef\u5207\u6362 CRT \u5f00\u5173', safety.hasCrt);
    check('\u53ef\u5207\u6362 \u95ea\u70c1 \u5f00\u5173', safety.hasFlash);
    check('\u5173 CRT \u540e\u751f\u6548\uff08html.no-crt\uff09', safety.noCrtClass);
    check('\u5173\u95ea\u70c1\u540e\u751f\u6548\uff08html.no-flash\uff09', safety.noFlashClass);
    check('\u5173\u95ea\u70c1\u540e\u6240\u6709\u8109\u52a8\u8fd4\u56de\u5e38\u4eae\uff08\u65e0\u786c on/off\uff09', safety.breathConstant);
    check('MAX_FLASH_HZ \u2264 2', safety.maxHz <= 2, safety.maxHz);

    /* ---------- ⑥ 音频真的能初始化并出声（WebAudio 图真的建起来） ---------- */
    console.log('\n\u2465 \u97f3\u9891');
    const audio = await page.evaluate(async () => {
      const A = window.TL.Audio;
      A.init(); A.resume();
      await new Promise(r => setTimeout(r, 120));
      const out = { mutedApi: typeof A.setMuted === 'function', musicApi: typeof A.setMusicEnabled === 'function' };
      A.setMuted(false);
      try { A.play('tierUp'); A.play('bite'); A.play('collect'); A.play('bank'); out.played = true; } catch (e) { out.played = false; out.err = String(e); }
      await new Promise(r => setTimeout(r, 80));
      A.setMusicEnabled(false);
      out.musicOffOk = true;
      A.setMusicEnabled(true);
      A.setMuted(true);
      out.muteOk = A.muted === true;
      return out;
    });
    check('\u63d0\u4f9b\u9759\u97f3\u5f00\u5173 API', audio.mutedApi);
    check('\u63d0\u4f9b\u97f3\u4e50\u5f00\u5173 API', audio.musicApi);
    check('\u97f3\u6548\u8c03\u7528\u4e0d\u629b\u5f02\u5e38\uff08\u9759\u97f3\u4e0b\u5b89\u5168\u964d\u7ea7\uff09', audio.played === true, audio.err || '');
    check('\u9759\u97f3\u72b6\u6001\u53ef\u8bfb\u4e14\u751f\u6548', audio.muteOk);

    /* ---------- ⑦ 暂停 / 重开 / 状态一致性 ---------- */
    console.log('\n\u2466 \u6682\u505c\u4e0e\u91cd\u5f00');
    const lifecycle = await page.evaluate(async () => {
      const G = window.TL.Game, C = window.TL.C;
      // 造一个"已带入账分 + 有收集"的局面
      G.stats.grabs = 7; G.stats.banks = 3; G.stats.collects = 9;
      G.banked = 1234; G.pendingScore = 500; G.pendingCount = 2; G.combo = 5; G.comboLost = 5;
      const lostBefore = G.lostScore;
      G.killShark('tether');
      const afterDeath = { lost: G.lostScore, pending: G.pendingScore, lostCount: G.lostCount };
      const html = (() => { window.TL.HUD.results(G); return document.getElementById('panel').textContent; })();
      const restartBtn = document.querySelector('[data-act="restart"]');
      if (restartBtn) restartBtn.click();
      await new Promise(r => setTimeout(r, 120));
      const afterReset = {
        grabs: G.stats.grabs, banks: G.stats.banks, collects: G.stats.collects,
        banked: G.banked, lost: G.lostScore, over: G.over
      };
      return { afterDeath: afterDeath, afterReset: afterReset, resultsHtml: html };
    });
    check('\u6b7b\u4ea1\u540e\u635f\u5931\u88ab\u8bb0\u8d26\uff08lost \u2260 0\uff09', lifecycle.afterDeath.lost > 0, lifecycle.afterDeath.lost);
    check('\u6b7b\u4ea1\u540e pending \u5f52\u96f6\uff08\u539f\u5b50\u5168\u635f\uff09', lifecycle.afterDeath.pending === 0);
    check('\u7ed3\u7b97\u9875\u5c55\u793a\u771f\u5b9e\u635f\u5931\uff08\u4e0d\u518d\u662f \u22120\uff09',
      /\u2212\s*[1-9]/.test(lifecycle.resultsHtml) || /\u2212\d{2,}/.test(lifecycle.resultsHtml),
      '\u6458\u8981\uff1a' + lifecycle.resultsHtml.replace(/\s+/g, ' ').slice(0, 120));
    check('\u91cd\u5f00\u540e stats \u5f52\u96f6\uff08\u4e0d\u53e0\u52a0\u4e0a\u4e00\u5c40\uff09',
      lifecycle.afterReset.grabs === 0 && lifecycle.afterReset.banks === 0 && lifecycle.afterReset.collects === 0,
      JSON.stringify(lifecycle.afterReset));
    check('\u91cd\u5f00\u540e banked / lost / over \u5747\u5f52\u96f6',
      lifecycle.afterReset.banked === 0 && lifecycle.afterReset.lost === 0 && lifecycle.afterReset.over === false,
      JSON.stringify(lifecycle.afterReset));

    /* ---------- ⑧ 失焦不残留输入 ---------- */
    const blurTest = await page.evaluate(async () => {
      const IN = window.TL.Input, G = window.TL.Game;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));   // 待消费的冲刺
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));// 待消费的确认
      window.dispatchEvent(new Event('blur'));
      const dash = IN.consumeDash();
      const confirm = IN.consumeConfirm();
      return { dash: dash, confirm: confirm };
    });
    check('\u5931\u7126\u540e\u4e0d\u6b8b\u7559\u51b2\u523a\u6807\u5fd7', blurTest.dash === false);
    check('\u5931\u7126\u540e\u4e0d\u6b8b\u7559\u786e\u8ba4\u6807\u5fd7\uff08\u9632\u8bef\u91cd\u5f00\uff09', blurTest.confirm === false);

    /* ---------- ⑨ 截图证据 ---------- */
    console.log('\n\u2467 \u622a\u56fe\u8bc1\u636e');
    await page.evaluate(() => { window.TL.Game.reset(); window.TL.HUD.hide(); });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, '02-playing.png') });
    // 强制触发搁浅 QTE 构图，验证去饱和 + 圆环确实是"唯一保留的颜色"
    await page.evaluate(() => {
      const G = window.TL.Game, W = window.TL.World, C = window.TL.C;
      const s = G.shark;
      s.x = 2700; s.y = W.seabedY(2700) - C.SHARK.HALF_H + C.SHARK.SINK;
      s.carry.push('swimmer', 'swimmer', 'swimmer', 'swimmer');
      G.pendingScore = 400;
      for (let i = 0; i < 60 * 8 && !G.qte.active; i++) G.update(C.FIXED_DT);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '03-qte.png') });
    const qteState = await page.evaluate(() => ({ active: window.TL.Game.qte.active, desat: window.TL.Game.desatTarget, lost: window.TL.Game.lostScore }));
    check('\u80fd\u8fdb\u5165\u6401\u6d45 QTE \u6784\u56fe', qteState.active === true);
    check('\u6401\u6d45\u65f6\u753b\u9762\u53bb\u9971\u548c\u76ee\u6807 = 1', qteState.desat === 1);

    await page.evaluate(() => { window.TL.Game.reset(); window.TL.HUD.title(); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '04-title-final.png') });

    const shots = fs.readdirSync(SHOTS).filter(f => f.endsWith('.png'));
    check('\u622a\u56fe\u5df2\u843d\u76d8\uff08\u2265 3 \u5f20\uff09', shots.length >= 3, shots.join(', '));
    console.log('  \u00b7 ' + SHOTS.replace(/\\/g, '/'));

    /* 最终错误复查 */
    check('\u5168\u7a0b\u65e0 JS \u9519\u8bef\uff08\u542b\u4e0a\u8ff0\u5168\u90e8\u4ea4\u4e92\uff09', errors.length === 0, errors.slice(0, 3).join(' | '));
    if (warnings.length) console.log('  \u00b7 \u8b66\u544a ' + warnings.length + ' \u6761\uff1a' + warnings.slice(0, 2).join(' | '));

  } catch (e) {
    console.log('  ! \u9a8c\u6536\u8fc7\u7a0b\u629b\u5f02\u5e38\uff1a' + (e && e.stack ? e.stack : e));
    fail++;
  } finally {
    await browser.close();
    if (srv) srv.close();
  }

  console.log('\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014');
  console.log('  \u6d4f\u89c8\u5668\u9a8c\u6536\uff1a\u901a\u8fc7 ' + pass + ' / \u5931\u8d25 ' + fail);
  if (fail) { console.log('  \u5931\u8d25\u9879\uff1a'); failures.forEach(f => console.log('    - ' + f)); }
  console.log('\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n');
  process.exitCode = fail === 0 ? 0 : 1;
})();
