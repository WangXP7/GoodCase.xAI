// 全卷出图：六段定机位（1600×900）+ 运镜留档 + 浏览器 canvas 拼接长卷总览
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
fs.mkdirSync(shots, { recursive: true });
const PORT = 8951;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png' };
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
const page = await browser.newPage({ viewport:{ width:1600, height:900 } });
page.on('pageerror', e=>console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>window.__qm && window.__qm.ready, null, { timeout:60000 });
await page.waitForTimeout(1800);

const shot = (n)=>page.screenshot({ path:path.join(shots,n+'.jpg'), type:'jpeg', quality:92 });
const names=['01-ch0-country','02-ch1-canal','03-ch2-hongqiao','04-ch3-street','05-ch4-gate','06-ch5-city'];
const titles=['一 · 郊野晨霧','二 · 汴河漕運','三 · 虹橋市肆','四 · 橋頭街市','五 · 上善門','六 · 城內繁華'];

for(let i=0;i<6;i++){
  await page.evaluate(k=>window.__qm.goChapter(k,true), i);
  await page.waitForTimeout(2800);
  // 虹桥段把船摆在桥前，保留原画的叙事瞬间
  if(i===2) await page.evaluate(()=>{ window.__qm.boat.z=2.5; });
  await shot(names[i]);
  console.log('shot', names[i]);
}

// 全卷运镜中途
await page.evaluate(()=>{ window.__qm.goChapter(2,true); window.__qm.startTour(); });
for(let i=0;i<100;i++){
  const t=await page.evaluate(()=>window.__qm.TOUR.active?window.__qm.TOUR.t:99);
  if(t>=10.4) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);
await shot('07-tour');
await page.evaluate(()=>window.__qm.stopTour());
console.log('shot 07-tour');

// 拼接长卷总览（浏览器 canvas，无额外依赖）
const dataUrl = await page.evaluate(async ({names,titles})=>{
  const imgs=await Promise.all(names.map(n=>new Promise((res,rej)=>{
    const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src='/shots/'+n+'.jpg';
  })));
  const W=520,H=340,top=62,bottom=34,pad=24;
  const cv=document.createElement('canvas');
  cv.width=pad*2+W*imgs.length; cv.height=top+H+bottom;
  const g=cv.getContext('2d');
  g.fillStyle='#e8dfc4'; g.fillRect(0,0,cv.width,cv.height);
  g.fillStyle='#9b2f1f'; g.fillRect(pad,14,26,26);
  g.fillStyle='#f3e9d2'; g.font='17px serif'; g.textAlign='center'; g.fillText('汴',pad+13,32);
  g.fillStyle='#2b2620'; g.textAlign='left';
  g.font='600 22px serif'; g.fillText('清明上河圖 · 全卷',pad+38,34);
  g.fillStyle='#6b6050'; g.font='12px serif';
  g.fillText('北宋 · 汴京 · 郊野 → 汴河 → 虹橋 → 橋頭 → 上善門 → 城內　|　實時 3D 長卷',pad+280,33);
  imgs.forEach((im,i)=>{
    const x=pad+i*W;
    g.drawImage(im,x,top,W,H);
    g.fillStyle='rgba(43,38,32,.10)'; g.fillRect(x,top,W,1);
    g.fillStyle='#2b2620'; g.font='15px serif'; g.textAlign='center';
    g.fillText(titles[i],x+W/2,top+H+23);
    g.strokeStyle='rgba(90,78,58,.35)'; g.lineWidth=1;
    g.strokeRect(x+.5,top+.5,W-1,H-1);
  });
  return cv.toDataURL('image/jpeg',0.92);
}, {names,titles});
fs.writeFileSync(path.join(shots,'00-overview.jpg'), Buffer.from(dataUrl.split(',')[1],'base64'));
console.log('shot 00-overview');

await browser.close();
server.close();
