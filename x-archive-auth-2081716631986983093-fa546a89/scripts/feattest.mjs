import { chromium } from 'playwright';
const URL = process.env.PREVIEW_URL || 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(URL+'/?capture=1',{waitUntil:'load',timeout:60000});
await p.waitForFunction(()=>window.__starfallReady===true,{timeout:45000});
await p.waitForTimeout(6000);

// --- PICK TIGHTNESS: sweep horizontally away from the mothership centre ----
const sweep = await p.evaluate(()=>{
  const g=window.__starfall, w=g.world, cam=g.stage.camera;
  const ms=w.ship(w.motherships[0]); if(!ms) return null;
  g.cam.moveTo(ms.pos.x,ms.pos.y,ms.pos.z,true); g.cam.distance=3000;
  return {ms:[ms.pos.x|0,ms.pos.y|0,ms.pos.z|0], radius: 1060};
});
await p.waitForTimeout(1800);
const hits = await p.evaluate(()=>{
  const g=window.__starfall,w=g.world; const out=[];
  for(let px=800; px<=1580; px+=60){
    const ndcX=(px/1600)*2-1, ndcY=-((450/900)*2-1);
    const r=g.cam.ray(ndcX,ndcY);
    const id=g.picker.raycast(r.ox,r.oy,r.oz,r.dx,r.dy,r.dz,w);
    out.push([px, id]);
  }
  return out;
});
console.log('pick sweep px->id:', JSON.stringify(hits));

// --- MINIMAP CLICK --------------------------------------------------------
const before = await p.evaluate(()=>[window.__starfall.cam.focus.x|0, window.__starfall.cam.focus.z|0]);
const box = await p.evaluate(()=>{const c=document.querySelector('.sf-minimap-canvas'); if(!c) return null; const r=c.getBoundingClientRect(); return [r.x+r.width*0.3, r.y+r.height*0.3];});
console.log('minimap canvas at', JSON.stringify(box));
if (box) { await p.mouse.click(box[0], box[1]); await p.waitForTimeout(1800); }
const after = await p.evaluate(()=>[window.__starfall.cam.focus.x|0, window.__starfall.cam.focus.z|0]);
console.log(`minimap click: focus ${before} -> ${after}  moved ${Math.hypot(after[0]-before[0],after[1]-before[1])|0} m`);

// --- F FOLLOW -------------------------------------------------------------
await p.evaluate(()=>{const g=window.__starfall,w=g.world; const ids=[];
  for(let i=0;i<w.ships.count&&ids.length<3;i++){const s=w.ships.items[i]; if(s.alive&&s.team===0&&s.cls===1)ids.push(s.id);}
  w.selection.length=0; for(const id of ids) w.selection.push(id);});
await p.keyboard.press('f');
await p.waitForTimeout(1200);
const f0 = await p.evaluate(()=>{const g=window.__starfall,w=g.world;const s=w.ship(w.selection[0]);
  return {focus:[g.cam.focus.x|0,g.cam.focus.z|0], ship:[s.pos.x|0,s.pos.z|0]};});
// order the selection far away, let them fly, see if focus tracks
await p.evaluate(()=>{const g=window.__starfall; const w=g.world; const s=w.ship(w.selection[0]);
  window.__t0 = [s.pos.x, s.pos.z];});
await p.waitForTimeout(6000);
const f1 = await p.evaluate(()=>{const g=window.__starfall,w=g.world;const s=w.ship(w.selection[0]);
  return {focus:[g.cam.focus.x|0,g.cam.focus.z|0], ship:[s.pos.x|0,s.pos.z|0]};});
const shipMoved = Math.hypot(f1.ship[0]-f0.ship[0], f1.ship[1]-f0.ship[1])|0;
const focusMoved = Math.hypot(f1.focus[0]-f0.focus[0], f1.focus[1]-f0.focus[1])|0;
console.log(`F follow: ship moved ${shipMoved} m, focus moved ${focusMoved} m (want focus to track ship)`);
if(errs.length){console.log('--- errors ---'); errs.slice(0,5).forEach(e=>console.log(e.slice(0,200)))}
await b.close();
