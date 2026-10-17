// 分时段截图：一次启动浏览器，依次抓取 晨/午/昏/夜 四个时段
// 用法: node tests/time-of-day-shots.mjs [BASE_URL] [输出目录]
// 依赖 main.js 的 URL 参数 ?t=HHMM（或分钟数）覆盖初始游戏时刻

import pw from 'file:///C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const BASE = process.argv[2] || 'https://under-the-eaves.app.workbuddy.host/';
const OUTDIR = (process.argv[3] || 'D:/68.AIGC/xWorkBuddy/GoodCase/.workbuddy/verify').replace(/\/$/, '');

const SLOTS = [
  ['0630', 'morning'],
  ['1200', 'noon'],
  ['1800', 'dusk'],
  ['0030', 'night'],
];

const browser = await chromium.launch({
  executablePath: 'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(String((e && e.message) ? e.message : e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('[console] ' + m.text()); });

const results = [];
for (const [t, name] of SLOTS) {
  const url = `${BASE}?t=${t}&v=${Date.now()}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  // 等引导 + 交叉淡入（0.8s）+ 程序化贴图生成
  await page.waitForTimeout(9000);
  const out = `${OUTDIR}/eaves-${name}.png`;
  await page.screenshot({ path: out });
  const meta = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return {
      canvasW: c ? c.width : 0,
      canvasH: c ? c.height : 0,
      slotText: (document.querySelector('#hud')?.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
    };
  });
  results.push({ slot: name, t, file: out, ...meta });
  console.log(`shotted ${name} (t=${t}) -> ${out}`);
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
