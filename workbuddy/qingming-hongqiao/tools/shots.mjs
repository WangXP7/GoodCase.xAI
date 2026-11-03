// 出图：1600×900 定机位留档（README 用）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  const { createRequire } = await import('node:module');
  ({ chromium } = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json')('playwright'));
}
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const shots = path.join(root, 'shots');
const PORT = 8951;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  fs.readFile(file, (err,data)=>{
    if(err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const browser = await chromium.launch({ args:['--disable-quic','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{ width:1600, height:900 } });
page.on('pageerror', e=>console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>window.__qm && window.__qm.ready, null, { timeout:60000 });
await page.waitForTimeout(2500);

const shot = (n)=>page.screenshot({ path:path.join(shots,n), type:'jpeg', quality:92 });
const view = async (pos, tgt, fov, wait=1800)=>{
  await page.evaluate(([p,t,f])=>{
    window.__qm.ctrl.goalPos.set(p[0],p[1],p[2]);
    window.__qm.ctrl.goalTgt.set(t[0],t[1],t[2]);
    window.__qm.ctrl.goalFov=f;
    window.__qm.ctrl.pos.copy(window.__qm.ctrl.goalPos);
    window.__qm.ctrl.tgt.copy(window.__qm.ctrl.goalTgt);
  }, [pos,tgt,fov]);
  await page.waitForTimeout(wait);
};

// 1 画卷视角（默认机位，船正对桥）
await page.evaluate(()=>{ window.__qm.boat.z = 2.5; });
await page.waitForTimeout(1400);
await shot('01-scroll.jpg');

// 2 船过桥下
await view([9.5,4.2,15], [-4.5,1.7,1.5], 42);
await shot('04-boat.jpg');

// 3 桥面
await view([0,13.2,14], [0,7.0,-1], 46);
await shot('05-bridge.jpg');

// 4 俯瞰
await view([30,26,48], [-2,3,4], 46);
await shot('06-wide.jpg');

// 5 3D 漫游（岸边视角）
await page.evaluate(()=>{ window.__qm.setMode('roam'); });
await view([15,4.6,26], [-6,3.5,-4], 44);
await shot('02-roam.jpg');

// 6 运镜中途
await page.evaluate(()=>{ window.__qm.setMode('scroll'); window.__qm.boat.z=6; window.__qm.startTour(); });
for(let i=0;i<80;i++){
  const t = await page.evaluate(()=>window.__qm.TOUR.active ? window.__qm.TOUR.t : 99);
  if(t >= 10.4) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(350);
await shot('03-tour.jpg');
await page.evaluate(()=>window.__qm.stopTour());
await page.waitForTimeout(800);

console.log('shots done');
await browser.close();
server.close();
