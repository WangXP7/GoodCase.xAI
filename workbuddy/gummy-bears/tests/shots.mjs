/* 验收截图（同时是渲染冒烟测试）：真实无头浏览器 + 真实鼠标事件 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW_MOD || 'C:/Users/wxppa/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import('file:///' + PW);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const srv = http.createServer((q, s) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, b) => {
    if (e) { s.writeHead(404); s.end('404'); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    s.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const browser = await chromium.launch({
  executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--disable-quic']
});
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
pg.on('response', r => { if (r.status() === 404) errs.push('404: ' + r.url()); });
fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
async function shot(name) {
  const p = path.join(ROOT, 'shots', name + '.jpg');
  await pg.screenshot({ path: p, type: 'jpeg', quality: 88 });
  console.log('  shot ->', name + '.jpg', (fs.statSync(p).size / 1024).toFixed(0) + ' KB');
}
const ev = (fn, ...a) => pg.evaluate(fn, ...a);

await pg.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'commit' });
await pg.waitForFunction(() => window.__GB && window.__GB.ready, null, { timeout: 120000 });
await pg.waitForTimeout(900);   // 等启动遮罩淡出
await ev(() => window.__GB.pause());
console.log('info:', JSON.stringify(await ev(() => window.__GB.info())));
console.log('state:', JSON.stringify(await ev(() => window.__GB.state())));

/* 01 首屏：一堆软糖熊 */
await ev(() => window.__GB.frameStep(1, 1 / 60, true));
await shot('01-pile');

/* 02 抓起一只举到半空 */
const g0 = await ev(() => window.__GB.projectBear(3));
await pg.mouse.move(g0.x, g0.y);
await pg.mouse.down();
for (let i = 1; i <= 10; i++) { await pg.mouse.move(g0.x, g0.y - i * 16); }
await ev(() => window.__GB.frameStep(30, 1 / 60, true));
await shot('02-grab');
await pg.mouse.up();
await ev(() => window.__GB.frameStep(40, 1 / 60, true));

/* 03 堆叠：把 3 号熊摞到 5 号熊身上 */
await ev(() => {
  const G = window.__GB, c = G.centroid(5);
  G.place(3, c[0], c[1] + 0.62, c[2], 0.4, 0, 0);
});
await ev(() => window.__GB.frameStep(150, 1 / 60, true));
console.log('stack y:', JSON.stringify(await ev(() => [window.__GB.bear(3), window.__GB.bear(5)])));
await shot('03-stack');

/* 04 甩出去（先举到空中，再横向抛出） */
const g4 = await ev(() => window.__GB.projectBear(7));
await pg.mouse.move(g4.x, g4.y);
await pg.mouse.down();
for (let i = 1; i <= 9; i++) await pg.mouse.move(g4.x, g4.y - i * 16);
await ev(() => window.__GB.frameStep(30, 1 / 60, true));
for (let i = 1; i <= 6; i++) await pg.mouse.move(g4.x + i * 40, g4.y - 144 - i * 6);
await pg.mouse.up();
await ev(() => window.__GB.frameStep(22, 1 / 60, true));
console.log('throw speed:', await ev(() => window.__GB.speed(7)));
await shot('04-throw');
await ev(() => window.__GB.frameStep(120, 1 / 60, true));

/* 05 撞到桌沿掉下去 + 陶瓷碟 */
await ev(() => { window.__GB.place(9, 1.62, 0.42, 0.55, 0.4, 0, 0); window.__GB.velocity(9, 8.5, 0, -1.2); });
await ev(() => window.__GB.frameStep(260, 1 / 60, true));
console.log('fell:', JSON.stringify(await ev(() => window.__GB.bear(9))));
await ev(() => window.__GB.cam({ az: 0.30, pol: 1.30, dist: 5.6, tx: -0.6, ty: -0.5, tz: 0.3 }));
await ev(() => window.__GB.frameStep(1, 1 / 60, true));
await shot('05-offdesk');

/* 06 近景：半透明 + 高光 */
await ev(() => { window.__GB.reset(); window.__GB.cam({ az: 0.72, pol: 1.10, dist: 2.35, tx: 0, ty: 0.34, tz: 0.05 }); });
await ev(() => window.__GB.frameStep(60, 1 / 60, true));
await shot('06-closeup');

/* 07 低角度全景（桌面厚度 + 桌沿） */
await ev(() => window.__GB.cam({ az: 1.15, pol: 1.36, dist: 5.2, tx: 0, ty: 0.05, tz: 0 }));
await ev(() => window.__GB.frameStep(1, 1 / 60, true));
await shot('07-lowangle');

/* 08 透射关掉后的对照组（验证透射确实在起作用） */
await ev(() => { window.__GB.cam({ az: 0.72, pol: 1.10, dist: 2.35, ty: 0.34 }); window.__GB.setTrans(false); });
await ev(() => window.__GB.frameStep(1, 1 / 60, true));
await shot('08-no-transmission');

console.log('\nerrors:', errs.length ? errs : 'none');
console.log('pixelStats(transmission on ):', JSON.stringify(await (async () => { await ev(() => window.__GB.setTrans(true)); return ev(() => window.__GB.pixelStats()); })()));
await browser.close();
srv.close();
process.exit(errs.length ? 1 : 0);
