// 独立 HTML 验收：file:// 直开 / 零外部请求 / 单画布 / 可玩
import pw from 'file:///C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const FILE = 'file:///D:/68.AIGC/xWorkBuddy/GoodCase/last-train-rush/last-train-rush-standalone.html';
const OUT = 'D:/68.AIGC/xWorkBuddy/GoodCase/.workbuddy/verify/ltr-standalone.png';

const browser = await chromium.launch({
  executablePath: 'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

const errors = [];
const requests = [];
page.on('pageerror', e => errors.push(String(e?.message || e)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('request', r => requests.push(r.url()));

await page.goto(FILE, { waitUntil: 'load', timeout: 60000 });
let menuOk = false;
try {
  await page.waitForFunction(() => {
    const m = document.querySelector('#menu');
    return m && !m.classList.contains('hidden');
  }, { timeout: 25000 });
  menuOk = true;
} catch { }
await page.waitForTimeout(1500);
await page.click('#start', { timeout: 5000 }).catch(() => { });
await page.waitForFunction(() => (window.__game?.snapshot()?.distance ?? 0) > 10, null, { timeout: 20000 }).catch(() => { });
await page.waitForTimeout(1500);
const snap = await page.evaluate(() => ({
  ...window.__game?.snapshot(),
  canvasCount: document.querySelectorAll('canvas').length,
}));
await page.screenshot({ path: OUT });

console.log(JSON.stringify({
  menuOk,
  snap,
  externalRequests: requests.filter(u => !u.startsWith('file://')),
  allRequests: requests.length,
  errors: errors.slice(0, 10),
}, null, 2));
await browser.close();
console.log('STANDALONE_OK', JSON.stringify(menuOk && errors.length === 0 && requests.every(u => u.startsWith('file://')) && snap.canvasCount === 1 && snap.distance > 10));
