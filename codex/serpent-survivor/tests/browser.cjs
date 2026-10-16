const {chromium}=require('playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const executablePath=process.env.SERPENT_BROWSER_PATH;
 const browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:true});
 const context=await browser.newContext({viewport:{width:1600,height:1060},deviceScaleFactor:1,offline:true});
 // Instrument only this test page; production exposes a read-only snapshot.
 await context.addInitScript(()=>{let exported;Object.defineProperty(window,'Serpent',{configurable:true,get:()=>exported,set:value=>{const Original=value.Game;value.Game=class extends Original{constructor(...args){super(...args);window.__qaGame=this;}};exported=value;}});});
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));await page.locator('#begin').click();await page.waitForTimeout(1200);
 const a=await page.evaluate(()=>serpentDemo.snapshot());assert.equal(a.state,'playing');
 assert.deepEqual(a.map,{width:3200,height:2000});assert(a.camera.width<=3200&&a.camera.height<=2000);const box=await page.locator('#game').boundingBox();const oldScale=Math.max(box.width/1600,box.height/1000);const previousArea=(box.width/oldScale)*(box.height/oldScale);assert(Math.abs(a.camera.width*a.camera.height/previousArea-4)<.01,'visible world area is four times the original on the same display');
 await page.keyboard.down('d');await page.waitForTimeout(700);await page.keyboard.up('d');const b=await page.evaluate(()=>serpentDemo.snapshot());assert(b.x>a.x+40,'movement changes real player position');
 assert.equal(b.camera.width,a.camera.width,'zoom stays stable while moving');
 await page.keyboard.press('Escape');const paused=await page.evaluate(()=>serpentDemo.snapshot());assert.equal(paused.state,'paused');await page.waitForTimeout(350);assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).time,paused.time);await page.locator('#resume').click();
 await page.locator('[data-skill="poison"] .auto-btn').click();assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).skills[1].auto,false);await page.locator('[data-skill="poison"] .auto-btn').click();
 await page.locator('#help').click();assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).state,'paused');await page.locator('#begin').click();
 await page.waitForTimeout(6500);await page.screenshot({path:path.resolve(__dirname,'../战斗预览.png'),fullPage:true});
 const snap=await page.evaluate(()=>serpentDemo.snapshot());assert(snap.stats.tail>0);assert(snap.stats.poisonCasts>0);assert(snap.stats.curse>0);assert(snap.enemies>0);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');await page.screenshot({path:path.resolve(__dirname,'../移动端预览.png'),fullPage:true});
 await page.keyboard.press('Escape');await page.locator('#again').click();assert((await page.evaluate(()=>serpentDemo.snapshot())).time<1,'restart resets time');
 await page.setViewportSize({width:1600,height:1060});
 // Use real simulation methods to construct reproducible UI acceptance scenarios.
 await page.evaluate(()=>{const g=window.__qaGame;g.p.xp=g.p.nextXp;g.levelUp();});await page.locator('[data-choice="0"]').waitFor();const upgraded=await page.evaluate(()=>serpentDemo.snapshot());assert.equal(upgraded.state,'upgrade');assert.equal(await page.locator('.upgrade-choice').count(),3);await page.keyboard.press('1');assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).state,'playing');assert.equal(Object.values((await page.evaluate(()=>serpentDemo.snapshot())).build).reduce((a,b)=>a+b,0),1);
 await page.evaluate(()=>{const g=window.__qaGame;g.p.energy=100;g.skills[3].cd=0;});await page.keyboard.press('Space');assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).stats.legion,1);
 await page.evaluate(()=>{const g=window.__qaGame;g.p.invuln=0;g.hit(99999);});await page.locator('#restart').waitFor();assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).state,'dead');await page.locator('#restart').click();assert((await page.evaluate(()=>serpentDemo.snapshot())).time<1);
 await page.evaluate(()=>{const g=window.__qaGame;g.time=599.98;g.update(.05);});await page.locator('#restart').waitFor();assert.equal((await page.evaluate(()=>serpentDemo.snapshot())).state,'won');assert((await page.locator('#modal h2').textContent()).includes('余烬不灭'));await page.locator('#restart').click();
 // Dense encounter fixture exercises the renderer with 850 live enemies and skill effects.
 await page.evaluate(()=>{const g=window.__qaGame;g.time=550;g.nextElite=600;g.enemies=[];for(let i=0;i<850;i++)g.spawn(i%30===0?'elite':i%5===0?'ranged':'melee');g.p.energy=100;g.cast('curse');g.cast('poison');g.cast('tail');});await page.waitForTimeout(800);await page.screenshot({path:path.resolve(__dirname,'../黑潮压力预览.png'),fullPage:true});
 const timings=await page.evaluate(()=>new Promise(resolve=>{const samples=[];let prev=performance.now();function sample(t){samples.push(t-prev);prev=t;if(samples.length<60)requestAnimationFrame(sample);else resolve({meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,maxMs:Math.max(...samples)});}requestAnimationFrame(sample);}));
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(requests.length,0,'fully offline, no network requests');
 const report={offline:true,errors,networkRequests:requests,viewAreaMultiplier:4,characterLinearScale:.5,mapSizeUnchanged:true,movement:true,pause:true,autoToggle:true,restart:true,mobileNoOverflow:true,upgradeChoice:true,manualLegion:true,deathUI:true,winUI:true,stressFixture:{enemies:850,timings},snapshot:snap};fs.writeFileSync(path.resolve(__dirname,'../browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
