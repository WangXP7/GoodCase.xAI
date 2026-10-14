/* 实机画面截图（同时作为交付前的渲染冒烟测试） */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PW = process.env.PW_MOD || 'C:/Users/wxppa/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import('file:///' + PW);
const chromium = _pw.chromium || _pw.default.chromium;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const srv = http.createServer((q, s) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html;charset=utf-8' : 'text/javascript' }); s.end(b); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
/* 验收截图统一输出 jpg（与站点其余案例一致），并打印体积便于核对 */
async function shot(name) {
  const p = path.join(ROOT, 'shots', name + '.jpg');
  await pg.screenshot({ path: p, type: 'jpeg', quality: 86 });
  console.log('  shot ->', path.basename(p), (fs.statSync(p).size / 1024).toFixed(0) + ' KB');
}
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await pg.goto('http://127.0.0.1:' + srv.address().port + '/index.html', { waitUntil: 'commit' });
await pg.waitForFunction(() => window.__LR && window.__LR.ready, null, { timeout: 60000 });
await pg.evaluate(() => window.__LR.frameStep(40, 1 / 60, true));
await shot('01-title');          // 首帧：任务简报 + 装卸区
await pg.click('#btnStart');
await pg.evaluate(() => window.__LR.frameStep(30, 1 / 60, true));

// 第三人称行驶中
await pg.evaluate(() => { for (let i = 0; i < 300; i++) { window.__LR.setInput({ throttle: 1, brake: 0, steer: 0 }); window.__LR.frameStep(1, 1 / 60, false); } window.__LR.setInput(null); });
await pg.evaluate(() => window.__LR.frameStep(20, 1 / 60, true));
await shot('02-drive');

// 第一人称驾驶舱
await pg.evaluate(() => window.__LR.setCam(0));
await pg.evaluate(() => { for (let i = 0; i < 120; i++) { window.__LR.setInput({ throttle: 1, brake: 0, steer: 0.15 }); window.__LR.frameStep(1, 1 / 60, false); } window.__LR.setInput(null); });
await pg.evaluate(() => window.__LR.frameStep(20, 1 / 60, true));
await shot('03-first-person');

// 远景观察：鲁布纳环形山 + 基地 + 岩石
await pg.evaluate(() => window.__LR.setCam(2));
await pg.evaluate(() => window.__LR.teleport(-40, 120, 0.9));
await pg.evaluate(() => window.__LR.frameStep(120, 1 / 60, true));
await shot('04-far-view');

// 高速撞击甩货
await pg.evaluate(() => window.__LR.setCam(1));
const rock = await pg.evaluate(() => {
  const O = window.__LR.obstacles;
  let best = null;
  for (const o of O) { if (o.type !== 'cyl' || o.r < 3.2 || o.r > 6.5) continue;
    const sz = o.z - 110, sx = o.x;
    if (Math.abs(sx) > 300 || sz < -380) continue;
    let ok = true;
    for (let k = 0; k < 110 && ok; k += 3) { const pz = sz + k;
      for (const p of O) { if (p === o) continue; if (p.type === 'cyl' && Math.hypot(sx - p.x, pz - p.z) < p.r + 3.4) { ok = false; break; } } }
    if (ok && (!best || o.r > best.r)) best = { x: o.x, z: o.z, r: o.r }; }
  return best;
});
await pg.evaluate(r => {
  window.__LR.teleport(r.x, r.z - 110, 0);
  for (let f = 0; f < 1100; f++) { window.__LR.setInput({ throttle: 1, brake: 0, steer: 0 }); window.__LR.frameStep(1, 1 / 60, false); }
  window.__LR.setInput(null);
  window.__LR.frameStep(6, 1 / 60, false);
}, rock);
await pg.evaluate(() => window.__LR.frameStep(25, 1 / 60, true));
const st = await pg.evaluate(() => window.__LR.state);
console.log(`撞击后 掉落 ${st.drops} 次，货物 ${st.cargo.map(c => c.state).join('/')}`);
await shot('05-cargo-drop');

/* 冒烟判定：favicon 的 404 与本地静态服务无关，不计入失败 */
const real = errs.filter(t => !/favicon|404/i.test(t));
console.log('页面错误', real.length ? real.slice(0, 3) : '无');
await b.close(); srv.close();
process.exit(real.length ? 1 : 0);
