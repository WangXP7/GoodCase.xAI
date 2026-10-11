// 《檐下 · UNDER THE EAVES》浏览器冒烟验证
// 用法: node tests/browser-smoke.mjs [URL] [截图输出路径]
// 验证: 引导是否走通、canvas 是否被正确 resize、有无未捕获错误、资源有无 4xx
// 注意: ESM 不认 NODE_PATH，playwright-core 是 CJS，需用绝对 file:/// 引入并取 default

import pw from 'playwright-core';
const { chromium } = pw;

const URL_ = process.argv[2] || 'https://under-the-eaves.app.workbuddy.host/';
const OUT = process.argv[3] || 'verify/eaves-smoke.png';

const browser = await chromium.launch({
  executablePath: '<本机 Chromium, 建议用环境变量 CHROME_PATH 传入>',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
const failed = [];

page.on('pageerror', e => errors.push(String((e && e.message) ? e.message : e)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('requestfailed', r => failed.push(r.url() + ' :: ' + ((r.failure() && r.failure().errorText) || '')));
page.on('response', r => {
  const u = r.url();
  if (r.status() >= 400 && !/favicon/.test(u)) failed.push(u + ' :: HTTP ' + r.status());
});

const t0 = Date.now();
await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });

// 等待引导完成：canvas 被 main.js 按视口 resize（而非 HTML 默认的 300x150）
let resized = false;
try {
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 400 && c.height > 300;
  }, { timeout: 40000 });
  resized = true;
} catch { /* 交给下面的报告 */ }

// 给渲染循环与程序化资产生成留时间（软件渲染较慢）
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c ? (c.getContext('webgl2') || null) : null;
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return !(s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0);
  };
  return {
    title: document.title,
    canvasCount: document.querySelectorAll('canvas').length,
    canvasW: c ? c.width : 0,
    canvasH: c ? c.height : 0,
    cssW: c ? Math.round(c.getBoundingClientRect().width) : 0,
    cssH: c ? Math.round(c.getBoundingClientRect().height) : 0,
    webgl2: !!gl,
    loadingVisible: vis('#loading'),
    errorBannerVisible: vis('#error-banner'),
    errorBannerText: (document.querySelector('#error-banner')?.innerText || '').slice(0, 300),
  };
});

await page.screenshot({ path: OUT, fullPage: false });
await browser.close();

// 判定：无未捕获错误 + canvas 已按视口 resize + 有 WebGL2 上下文 + 错误横幅未显示
const ok = errors.length === 0 && resized && info.canvasW > 400 && info.webgl2 && !info.errorBannerVisible;

console.log(JSON.stringify({
  ok,
  loadMs: Date.now() - t0,
  resized,
  ...info,
  errors,
  failed,
}, null, 2));

process.exit(ok ? 0 : 1);
