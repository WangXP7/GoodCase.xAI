// 快速视觉检查：起本地服务 → 截图
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  const { createRequire } = await import('node:module');
  const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
  ({ chromium } = require('playwright'));
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const PORT = 8931;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if(!file.startsWith(root)){ res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err,data)=>{
    if(err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const browser = await chromium.launch({ args:['--disable-quic','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{ width:1600, height:900 }, deviceScaleFactor:1 });
const errors=[];
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
page.on('requestfailed', r=>errors.push('reqfail: '+r.url()+' '+(r.failure()&&r.failure().errorText)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>window.__qm && window.__qm.ready, null, { timeout:60000 }).catch(e=>errors.push('ready timeout'));
await page.waitForTimeout(2500);

const info = await page.evaluate(()=>window.__qm.info());
const mode = await page.evaluate(()=>window.__qm.mode());
console.log('info', info, 'mode', mode);

await page.screenshot({ path: path.join(shots,'look-01-scroll.jpg'), type:'jpeg', quality:90 });

// 近景：船
await page.evaluate(()=>{ window.__qm.ctrl.goalPos.set(9, 4.2, 12); window.__qm.ctrl.goalTgt.set(0.6, 1.8, 6); window.__qm.ctrl.goalFov=38; window.__qm.TOUR.active=false; });
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(shots,'look-02-boat.jpg'), type:'jpeg', quality:90 });

// 桥上
await page.evaluate(()=>{ window.__qm.ctrl.goalPos.set(2, 11.5, 12); window.__qm.ctrl.goalTgt.set(0, 6.8, 0); window.__qm.ctrl.goalFov=45; });
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(shots,'look-03-bridge.jpg'), type:'jpeg', quality:90 });

// 俯视全景
await page.evaluate(()=>{ window.__qm.ctrl.goalPos.set(28, 26, 46); window.__qm.ctrl.goalTgt.set(0, 3, 2); window.__qm.ctrl.goalFov=44; });
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(shots,'look-04-wide.jpg'), type:'jpeg', quality:90 });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
