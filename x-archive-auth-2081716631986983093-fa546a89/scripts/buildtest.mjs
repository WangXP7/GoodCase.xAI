import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:4173/?capture=1',{waitUntil:'load',timeout:60000});
await p.waitForFunction(()=>window.__starfallReady===true,{timeout:45000});
await p.waitForTimeout(6000);
const q = () => p.evaluate(()=>{const g=window.__starfall,w=g.world;const ms=w.motherships[0];const pr=w.producers.get(ms);
 return {res:Math.round(w.factions[0].resources), queue:pr?pr.queue.map(j=>j.cls):[], ships:w.ships.liveCount(), research:w.factions[0].researching?.id||null};});
console.log('before        ', JSON.stringify(await q()));
// find and click the INT build tile
const tile = await p.$('[data-cls="1"], [data-build="1"]');
if (tile) { await tile.click(); console.log('clicked [data-cls=1]'); }
else {
  const cands = await p.$$eval('*', els => els.filter(e=>/^INT$/.test((e.textContent||'').trim())).map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2, r.y+r.height/2, e.className]}));
  console.log('INT candidates', JSON.stringify(cands.slice(0,4)));
  if (cands.length) await p.mouse.click(cands[0][0], cands[0][1]);
}
await p.waitForTimeout(1500);
console.log('after tile    ', JSON.stringify(await q()));
await p.waitForTimeout(14000);
console.log('after 14s     ', JSON.stringify(await q()));
if(errs.length){console.log('--- errors ---');errs.slice(0,8).forEach(e=>console.log(e.slice(0,200)))}
await b.close();
