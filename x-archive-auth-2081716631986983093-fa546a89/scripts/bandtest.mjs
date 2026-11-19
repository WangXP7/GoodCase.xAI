import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:4173/?capture=1',{waitUntil:'load',timeout:60000});
await p.waitForFunction(()=>window.__starfallReady===true,{timeout:45000});
await p.waitForTimeout(6000);
const st = () => p.evaluate(()=>{const g=window.__starfall;return {yaw:+(g.cam.yaw??0).toFixed(3),pitch:+(g.cam.pitch??0).toFixed(3),sel:g.world.selection.length,
  boxShown: (()=>{const d=document.querySelector('.sf-band-layer>div'); return d? getComputedStyle(d).display : 'missing';})()};});
// LEFT drag -> band box must be visible mid-drag
await p.mouse.move(400,250); await p.mouse.down({button:'left'});
await p.mouse.move(900,600,{steps:12});
console.log('mid left-drag ', JSON.stringify(await st()));
await p.screenshot({path:'verify/band-mid-drag.png'});
await p.mouse.up({button:'left'});
await p.waitForTimeout(800);
console.log('after left-drag', JSON.stringify(await st()));
// RIGHT drag horizontal -> should ORBIT and issue no order
const before = await st();
await p.mouse.move(800,450); await p.mouse.down({button:'right'});
await p.mouse.move(1150,470,{steps:12}); await p.mouse.up({button:'right'});
await p.waitForTimeout(1200);
const after = await st();
console.log(`right-drag orbit: yaw ${before.yaw} -> ${after.yaw}`);
const orders = await p.evaluate(()=>{const w=window.__starfall.world;let n=0;
  for(const id of w.selection){const s=w.ship(id); if(s&&s.order.manual&&s.order.kind==='move')n++;} return n;});
console.log('manual move orders after right-drag:', orders, '(want 0)');
await b.close();
