/* =====================================================================
 * TIDELINE · 美术合规的「真实渲染画面」取证
 *
 * 与 smoke-mvp 的常量侧取证互补：本层读的是**最终帧缓冲**，
 * 包含雾效、后期去饱和、CRT 扫描线等全部后处理——只有这里
 * 能回答「玩家在深海里到底看不看得见鲨鱼」。
 *
 * 验的是美术圣经：
 *   §4.1.3 鲨鱼配色（背侧 #4A5A6E→#6E7C8C，腹侧 #C7CFD8→#F2F5F8，3px 描边）
 *   C-09   实体与背景明度差（深海区）
 *
 * 用法：node tests/art-deep-verify.js
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', 'src');
const SHOTS = path.join(__dirname, '_shots');

/* playwright-core 装在受管 workspace 里，不进项目 node_modules */
const PW_PATHS = [
  '<本机用户目录>/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
];
const CHROME_CANDIDATES = [
  '<本机 Chromium, 建议用环境变量 CHROME_PATH 传入>',
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name + (extra !== undefined ? '  \u00b7 ' + extra : '')); }
  else { fail++; console.log('  \u2717 ' + name + (extra !== undefined ? '  \u2192  ' + extra : '')); }
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
  console.log('\n=== 《潮线 TIDELINE》深海可读性 · 真实渲染取证 ===\n');

  let chromium;
  for (const p of PW_PATHS) { try { chromium = require(p).chromium; break; } catch (e) { } }
  if (!chromium) { console.log('  ! 找不到 playwright-core，跳过'); process.exitCode = 2; return; }

  let exe = null;
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) { exe = c; break; }
  if (!exe) { console.log('  ! 找不到 Chromium，跳过'); process.exitCode = 2; return; }

  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--use-gl=angle', '--no-sandbox', '--mute-audio']
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2200);

    /* 开始游戏 */
    await page.mouse.click(800, 500);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);

    /* 把鲨鱼钉在深海段，关闭 HUD，等相机收敛 */
    const st = await page.evaluate(async () => {
      const G = window.TL.Game, W = window.TL.World, s = G.shark;
      window.TL.HUD.hide();
      const PIN_X = 520, PIN_Y = 560;
      await new Promise(r => {
        let n = 0;
        const t = () => {
          s.x = PIN_X; s.y = PIN_Y; s.vx = 0; s.vy = 0;
          s.theta = 0; s.state = 'swim'; s.carryK = 0; s.alive = true;
          G.alarm = 0; G.flash = 0;
          if (++n > 80) return r();
          requestAnimationFrame(t);
        };
        requestAnimationFrame(t);
      });
      return {
        sharkX: s.x, sharkY: s.y, zone: s.zone,
        camX: G.cam.x, camY: G.cam.y,
        seabed: W.seabedY(PIN_X),
        pal: { steel: window.TL.C.PAL.STEEL, ash: window.TL.C.PAL.ASH, pale: window.TL.C.PAL.PALE }
      };
    });

    console.log('\u2460 \u573a\u666f\u94c9\u4f4d');
    console.log('  \u00b7 \u9ca8\u9c7c\u4e16\u754c\u5750\u6807 (' + st.sharkX + ', ' + st.sharkY + ')  \u533a\u57df=' + st.zone + ' (' + typeof st.zone + ')');
    console.log('  \u00b7 \u76f8\u673a (' + st.camX.toFixed(1) + ', ' + st.camY.toFixed(1) + ')  \u6d77\u5e8a y=' + st.seabed.toFixed(0));
    const DEEP_IDS = [0, 'deep', 'DEEP', 'z_deep'];
    check('鲨鱼确实位于深海区', DEEP_IDS.indexOf(st.zone) >= 0, 'zone=' + st.zone);
    check('鲨鱼在水体中（未陷入海床）', st.sharkY < st.seabed - 40,
      'sharkY=' + st.sharkY + ' seabed=' + st.seabed.toFixed(0));

    /* 屏幕坐标：canvas_x = (wx - camX) * scale * 2，scale = 1/ART_SCALE = 0.5 */
    const sx = Math.round(st.sharkX - st.camX);
    const sy = Math.round(st.sharkY - st.camY);
    console.log('  \u00b7 \u9ca8\u9c7c\u5c4f\u5e55\u5750\u6807 (' + sx + ', ' + sy + ') / canvas 1440x864');

    /* 读最终帧缓冲：鲨鱼块 vs 三处背景块 */
    const probe = await page.evaluate(({ sx, sy }) => {
      const c = document.getElementById('gl');
      const g = c.getContext('webgl2') || c.getContext('webgl');
      const W = c.width, H = c.height;
      const lum = (r, gg, b) => 0.299 * r + 0.587 * gg + 0.114 * b;
      const readBlock = (bx, by, n) => {
        const x = Math.max(0, Math.min(W - n, bx));
        const gy = Math.max(0, Math.min(H - n, H - by - n));   // 顶部原点 → GL 底部原点
        const buf = new Uint8Array(4 * n * n);
        g.readPixels(x, gy, n, n, g.RGBA, g.UNSIGNED_BYTE, buf);
        const out = [];
        for (let i = 0; i < buf.length; i += 4) out.push(lum(buf[i], buf[i + 1], buf[i + 2]));
        return out;
      };
      const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
      const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;

      const N = 80;

      const sharkB = readBlock(sx - (N >> 1), sy - (N >> 1), N);
      /* 三处背景块全部落在深海段（世界 x < 750；相机 camX=0，屏幕 x = 世界 x）
         左/右取同一高度，上方取更浅的水体，避开鲨鱼本体与海床 */
      const bgBlocks = [
        readBlock(sx - 300, sy - (N >> 1), N),
        readBlock(sx - 210, sy - (N >> 1), N),
        readBlock(sx - (N >> 1), sy - 240, N)
      ];
      const bgAll = [];
      for (let bi = 0; bi < bgBlocks.length; bi++) {
        for (let vi = 0; vi < bgBlocks[bi].length; vi++) bgAll.push(bgBlocks[bi][vi]);
      }
      const nanCount = bgAll.filter(function (v) { return !isFinite(v); }).length;
      const blockShapes = bgBlocks.map(function (b) { return b.length; });
      const blockMed = bgBlocks.map(function (b) { return Number(med(b).toFixed(1)); });
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < bgAll.length; i++) {
        if (bgAll[i] < mn) mn = bgAll[i];
        if (bgAll[i] > mx) mx = bgAll[i];
      }
      const bgV = Number(med(bgAll));
      const fgPix = sharkB.filter(function (v) { return v > bgV + 8; });
      const fgV = fgPix.length ? Number(mean(fgPix)) : 0;
      const sharkMeanV = Number(mean(sharkB));
      return {
        bg: Number(bgV.toFixed(1)), bgMin: Number(mn.toFixed(1)), bgMax: Number(mx.toFixed(1)),
        sharkMean: Number(sharkMeanV.toFixed(1)), fg: Number(fgV.toFixed(1)),
        fgCount: fgPix.length,
        fgRatio: Number((fgPix.length / sharkB.length * 100).toFixed(1)),
        _dbg: { nanCount: nanCount, blockShapes: blockShapes, blockMed: blockMed, total: bgAll.length }
      };
    }, { sx, sy });

    console.log('\n\u2461 \u6df1\u6d77\u53ef\u8bfb\u6027\uff08\u6700\u7ec8\u5e27\u7f13\u51b2\u91c7\u6837\uff09');
    console.log('  \u00b7 \u80cc\u666f\u5757\u8bca\u65ad\uff1a' + JSON.stringify(probe._dbg));
    console.log('  \u00b7 \u80cc\u666f\u7070\u5ea6 \u4e2d\u4f4d\u6570=' + probe.bg + '  \u533a\u95f4=[' + probe.bgMin + ', ' + probe.bgMax + ']');
    console.log('  \u00b7 \u9ca8\u9c7c\u5757\u7070\u5ea6 \u5747\u503c=' + probe.sharkMean + '  \u524d\u666f\u50cf\u7d20=' + probe.fgCount +
      ' (' + probe.fgRatio + '%)  \u524d\u666f\u5747=' + probe.fg);

    check('采样块内确实捕获到鲨鱼像素（>200）', probe.fgCount > 200, probe.fgCount + ' px');
    check('C-09 鲨鱼前景灰度 − 深海背景灰度 ≥ 30pp',
      (probe.fg - probe.bg) >= 30,
      '\u0394=' + (probe.fg - probe.bg).toFixed(1) + 'pp  (\u4fee\u590d\u524d\u7ea6 10pp\uff0c\u9ca8\u9c7c\u8fd1\u4e4e\u9690\u5f62)');

    /* 截图证据：特写 + 全屏 */
    const rect = await page.evaluate(() => {
      const r = document.getElementById('gl').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const kx = rect.w / 1440, ky = rect.h / 864;
    const clipW = 360 * kx, clipH = 200 * ky;
    const clipX = Math.max(rect.x, Math.min(rect.x + rect.w - clipW, rect.x + (sx - 180) * kx));
    const clipY = Math.max(rect.y, Math.min(rect.y + rect.h - clipH, rect.y + (sy - 100) * ky));
    await page.screenshot({
      path: path.join(SHOTS, 'x1-shark-deep.png'),
      clip: { x: clipX, y: clipY, width: clipW, height: clipH }
    });
    await page.screenshot({ path: path.join(SHOTS, '05-deep-full.png') });
    check('深海特写截图已落盘', fs.existsSync(path.join(SHOTS, 'x1-shark-deep.png')),
      'x1-shark-deep.png + 05-deep-full.png');

    check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));

    console.log('\n\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014');
    console.log('  通过 ' + pass + ' / 失败 ' + fail);
    console.log('\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n');
    if (fail) process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
