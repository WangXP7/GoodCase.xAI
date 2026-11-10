// 汴河虹桥 E2E：Playwright 真浏览器端到端验证（三层验证的第三层）
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
const PORT = 8941;
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
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const results = [];
const errors = [];
function check(name, cond, extra){
  results.push({ name, pass: !!cond, extra: extra||'' });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
}

const browser = await chromium.launch({ args:['--disable-quic','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if(m.type()==='error') errors.push('console: ' + m.text()); });
page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));


await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load' });
await page.waitForFunction(()=>window.__qm && window.__qm.ready, null, { timeout:60000 });
await page.waitForTimeout(2200);

/* ---------- 1 启动与几何完整性 ---------- */
const info = await page.evaluate(()=>window.__qm.info());
check('场景就绪 / WebGL 渲染中', info.calls > 30 && info.tris > 60000, `calls=${info.calls} tris=${info.tris}`);

const nanCount = await page.evaluate(()=>{
  let bad=0;
  window.__qm.scene.traverse(o=>{
    if(!o.geometry || !o.geometry.attributes.position) return;
    const a=o.geometry.attributes.position.array;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])){ bad++; break; }
  });
  return bad;
});
check('无 NaN 顶点几何体', nanCount === 0, `bad=${nanCount}`);

const noOverflow = await page.evaluate(()=> document.documentElement.scrollWidth <= window.innerWidth+1);
check('无横向溢出（无滚动条）', noOverflow);

/* ---------- 2 船：持续行驶 + 桅杆放倒 ---------- */
const z1 = await page.evaluate(()=>window.__qm.boatZ());
await page.waitForTimeout(3200);
const z2 = await page.evaluate(()=>window.__qm.boatZ());
check('货船持续行驶', z2 < z1 - 1.2, `z ${z1.toFixed(1)} → ${z2.toFixed(1)}`);

const mastFar = await page.evaluate(()=>{ const q=window.__qm; const old=q.boat.z; q.boat.z=48; q.__t=1; return null; });
const mastAngle = await page.evaluate(async ()=>{
  const q=window.__qm;
  q.boat.z=48; await new Promise(r=>setTimeout(r,120));
  const aFar=q.boat.mast.rotation.x;
  q.boat.z=6;  await new Promise(r=>setTimeout(r,120));
  const aNear=q.boat.mast.rotation.x;
  return [aFar, aNear];
});
check('过桥前桅杆放倒', mastAngle[1] > mastAngle[0] + 0.5, `远 ${mastAngle[0].toFixed(2)} → 近 ${mastAngle[1].toFixed(2)}`);

/* ---------- 3 行人 ---------- */
const walk = await page.evaluate(async ()=>{
  const g=[];
  window.__qm.scene.traverse(o=>{ if(o.type==='Group') g.push(o); });
  const p0=g.map(o=>o.position.clone());
  await new Promise(r=>setTimeout(r,1200));
  let moved=0;
  g.forEach((o,i)=>{ if(o.position.distanceTo(p0[i])>0.03) moved++; });
  return [moved, g.length];
});
check('全卷六段行人移动', walk[0] >= 6, `${walk[0]}/${walk[1]} 个角色在移动`);
const mob = await page.evaluate(()=>window.__qm.mobiles());
check('动态物体总量 ≥ 140（飞鸟 / 云 / 车马 / 船 / 旗幡）', mob.total >= 140, JSON.stringify(mob.byKind));
check('五类动态物体齐备', ['bird','cloud','cart','boat','flag'].every(k=>mob.byKind[k]>0),
  `bird=${mob.byKind.bird} cloud=${mob.byKind.cloud} cart=${mob.byKind.cart} boat=${mob.byKind.boat} flag=${mob.byKind.flag}`);
const nw = await page.evaluate(()=>window.__qm.walkers());
check('角色数量 ≥ 300', nw >= 300, `walkers=${nw}`);
const dyn = await page.evaluate(async()=>{
  const a=window.__qm.mobilePositions();
  await new Promise(r=>setTimeout(r,1200));
  const b=window.__qm.mobilePositions();
  let moved=0;
  for(let i=0;i<a.length;i++)
    if(Math.hypot(a[i][0]-b[i][0],a[i][1]-b[i][1],a[i][2]-b[i][2])>0.02) moved++;
  return [moved,a.length];
});
check('动态物体持续运动', dyn[0] >= dyn[1]*0.5, `${dyn[0]}/${dyn[1]} 个物体在移动`);

/* ---------- 4 视角切换 ---------- */
await page.click('#btnRoam');
await page.waitForTimeout(1300);
const roam = await page.evaluate(()=>({ mode:window.__qm.mode(), fov:window.__qm.camera.fov, cls:document.body.className }));
check('切到 3D 漫游', roam.mode==='roam' && roam.fov>38, `fov=${roam.fov.toFixed(1)}`);
check('漫游态隐藏卷轴边框', /roam/.test(roam.cls));

// 拖拽旋转
const posA = await page.evaluate(()=>window.__qm.pos());
await page.mouse.move(800, 450);
await page.mouse.down();
await page.mouse.move(1080, 470, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(700);
const posB = await page.evaluate(()=>window.__qm.pos());
check('鼠标拖拽环视', Math.hypot(posA[0]-posB[0], posA[2]-posB[2]) > 1.5,
  `${posA.slice(0,1)} → ${posB.slice(0,1)}`);

// 滚轮缩放
const d1 = await page.evaluate(()=>{ const q=window.__qm; return q.ctrl.goalPos.distanceTo(q.ctrl.goalTgt); });
await page.mouse.wheel(0, -420);
await page.waitForTimeout(600);
const d2 = await page.evaluate(()=>{ const q=window.__qm; return q.ctrl.goalPos.distanceTo(q.ctrl.goalTgt); });
check('滚轮缩放', Math.abs(d2-d1) > 1.2, `${d1.toFixed(1)} → ${d2.toFixed(1)}`);

// 右键平移
const t1 = await page.evaluate(()=>window.__qm.ctrl.goalTgt.toArray());
await page.mouse.move(800, 450);
await page.mouse.down({ button:'right' });
await page.mouse.move(660, 400, { steps: 10 });
await page.mouse.up({ button:'right' });
await page.waitForTimeout(600);
const t2 = await page.evaluate(()=>window.__qm.ctrl.goalTgt.toArray());
check('右键平移', Math.hypot(t1[0]-t2[0], t1[2]-t2[2]) > 0.8,
  `tgt ${t1.map(v=>v.toFixed(1))} → ${t2.map(v=>v.toFixed(1))}`);


await page.click('#btnScroll');
await page.waitForTimeout(4200);
const back = await page.evaluate(()=>({ mode:window.__qm.mode(), fov:window.__qm.camera.fov, pos:window.__qm.pos() }));
check('切回画卷视角并归位', back.mode==='scroll' && Math.abs(back.fov-31.5)<1.2 && Math.abs(back.pos[2]-57)<2,
  `fov=${back.fov.toFixed(1)} pos=${back.pos}`);

/* ---------- 4.5 全卷六段 ---------- */
const nCh = await page.evaluate(()=>window.__qm.chapters());
check('全卷共 6 段', nCh===6, `chapters=${nCh}`);
const nb = await page.evaluate(()=>window.__qm.buildings());
check('全卷屋舍 ≥ 250 栋', nb>=250, `buildings=${nb}`);
const stn = await page.evaluate(()=>window.__qm.styles());
check('六种屋舍样式齐备', stn.length===6, stn.join(' / '));
await page.evaluate(()=>window.__qm.goChapter(4,true));
await page.waitForTimeout(2600);
const ch4 = await page.evaluate(()=>({ c:window.__qm.chapter(), pos:window.__qm.pos(), vis:window.__qm.visibleChapters() }));
check('展卷切到上善门', ch4.c===4 && Math.abs(ch4.pos[2]+285)<3, `ch=${ch4.c} pos=${ch4.pos} vis=${ch4.vis}`);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1000);
check('→ 展卷到城内段', (await page.evaluate(()=>window.__qm.chapter()))===5);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(1000);
check('← 退回城门段', (await page.evaluate(()=>window.__qm.chapter()))===4);
await page.evaluate(()=>window.__qm.goChapter(2,true));
await page.waitForTimeout(2600);
check('回卷到虹桥默认机位', (await page.evaluate(()=>window.__qm.chapter()))===2 && Math.abs((await page.evaluate(()=>window.__qm.pos()))[2]-57)<2);

/* ---------- 5 20 秒自动运镜（全卷巡览） ---------- */
const t0 = Date.now();
await page.click('#btnTour');
// 页面内全程采样相机 z（定时器不受渲染帧率影响）
await page.evaluate(()=>{
  window.__zs=[];
  window.__zTimer=setInterval(()=>{ if(window.__qm.TOUR.active) window.__zs.push(window.__qm.pos()[2]); },120);
});
await page.waitForTimeout(400);
const tourOn = await page.evaluate(()=>({
  active: window.__qm.TOUR.active,
  on: document.getElementById('tourUI').classList.contains('on'),
  bar: getComputedStyle(document.querySelector('#tourUI .bar.top')).height,
}));
check('运镜启动 + 遮幅落下', tourOn.active && tourOn.on, `bar=${tourOn.bar}`);

await page.waitForTimeout(5200);
const progMid = await page.evaluate(()=>document.querySelector('#prog i').style.width);
check('运镜进度推进', parseFloat(progMid) > 15 && parseFloat(progMid) < 70, `progress=${progMid}`);

await page.waitForTimeout(4200);

let tourEnded=false;
for(let i=0;i<120;i++){
  const st = await page.evaluate(()=>({ a:window.__qm.TOUR.active, m:window.__qm.mode() }));
  if(!st.a){ tourEnded=true; break; }
  await page.waitForTimeout(500);
}
const zs=await page.evaluate(()=>{ clearInterval(window.__zTimer); return window.__zs; });
const zmin=Math.min(...zs), zmax=Math.max(...zs);
check('运镜掠过全卷首尾（郊野 → 城内）', zmax>300 && zmin<-300, `z ∈ [${zmin.toFixed(0)}, ${zmax.toFixed(0)}]`);
const tourT = await page.evaluate(()=>window.__qm.TOUR.t);
const tourDur = await page.evaluate(()=>window.__qm.TOUR.dur);
const elapsed = (Date.now()-t0)/1000;
const after = await page.evaluate(()=>({ mode:window.__qm.mode(), fov:window.__qm.camera.fov, pos:window.__qm.pos() }));
check('运镜 20 秒后自动收束', tourEnded && after.mode==='scroll', `elapsed=${elapsed.toFixed(1)}s`);
check('运镜脚本时长 = 20s 且跑满', tourDur===20 && tourT>=19.9 && tourT<22.5, `内部 t=${tourT.toFixed(2)}s / 脚本 ${tourDur}s / 墙钟 ${elapsed.toFixed(1)}s（软件渲染偏慢）`);
check('收束后回到画卷机位', Math.abs(after.pos[2]-57)<2.5 && Math.abs(after.fov-31.5)<0.6, `pos=${after.pos} fov=${after.fov.toFixed(1)}`);

/* ---------- 6 键盘 ---------- */
await page.keyboard.press('2');
await page.waitForTimeout(700);
check('键 2 进入漫游', (await page.evaluate(()=>window.__qm.mode()))==='roam');
await page.keyboard.press('1');
await page.waitForTimeout(700);
check('键 1 回到画卷', (await page.evaluate(()=>window.__qm.mode()))==='scroll');

/* ---------- 7 视觉留档 ---------- */
await page.evaluate(()=>{ window.__qm.boat.z = 3; });
await page.waitForTimeout(1200);

await page.evaluate(()=>{ const q=window.__qm; q.ctrl.goalPos.set(9.5,4.6,17); q.ctrl.goalTgt.set(-5,1.6,2); q.ctrl.goalFov=42; });
await page.waitForTimeout(1500);

await page.evaluate(()=>{ const q=window.__qm; q.ctrl.goalPos.set(0,13.5,15); q.ctrl.goalTgt.set(0,7.0,0); q.ctrl.goalFov=46; });
await page.waitForTimeout(1500);

await page.evaluate(()=>{ const q=window.__qm; q.ctrl.goalPos.set(34,30,52); q.ctrl.goalTgt.set(-2,3,4); q.ctrl.goalFov=46; });
await page.waitForTimeout(1500);

/* ---------- 汇总 ---------- */
check('零 JS 报错 / 零资源失败', errors.length===0, errors.slice(0,3).join(' | '));

const pass = results.filter(r=>r.pass).length;
console.log(`\n=== ${pass}/${results.length} PASS ===`);
if(errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
server.close();
process.exit(pass===results.length ? 0 : 1);
