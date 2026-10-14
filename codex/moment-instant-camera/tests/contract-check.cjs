/* Runtime contract checks. Supply a Playwright package path without installing it in this app.
   node tests/contract-check.cjs D:/path/to/node_modules/playwright
   The WebMCP registration host is emulated; this does not certify a native WebMCP browser. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{channel:'msedge'}),args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('console',msg=>{if(msg.type()==='warning'||msg.type()==='error')console.log('Browser:',msg.text());});
  await page.addInitScript(()=>{window.__cameraTools=new Map();Object.defineProperty(document,'modelContext',{value:{registerTool(tool,options){window.__cameraTools.set(tool.name,tool);options?.signal?.addEventListener('abort',()=>window.__cameraTools.delete(tool.name));}}});});
  const execute=(name,input={})=>page.evaluate(async({name,input})=>{const tool=window.__cameraTools.get(name);if(!tool)throw new Error(`Missing tool: ${name}`);return await tool.execute(input);},{name,input});
  const report={date:new Date().toISOString(),host:'Playwright Chromium; emulated document.modelContext registry; no screenshot or UI click audit',checks:[]};
  try{
    console.log('Opening local file-mode app');await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>window.MomentLab?.readState().render.frames>2,{},{timeout:30000});
    let s=await execute('read_camera_state');console.log('Initial state:',JSON.stringify(s.render));assert.equal(s.render.renderer,'WebGL2');assert.equal(s.render.glError,0);assert.equal(s.remaining,8);assert.equal(s.photoCount,3);assert.equal(s.busy,false);report.initial=s;report.checks.push('file:// app initialization, successful shader compilation, live rendered frames, WebGL NO_ERROR');
    const registry=await page.evaluate(()=>[...window.__cameraTools].map(([name,t])=>({name,schema:t.inputSchema,annotations:t.annotations})));
    assert.equal(registry.length,4);assert.equal(registry.find(t=>t.name==='read_camera_state').annotations.readOnlyHint,true);assert.equal(registry.find(t=>t.name==='capture_instant_photo').annotations.readOnlyHint,false);report.registry=registry;report.checks.push('four WebMCP definitions register with expected schemas and annotations in emulated host');
    s=await execute('configure_camera',{scene:'aurora',film:'mono',exposure:.7,flash:false});assert.equal(s.scene,'aurora');assert.equal(s.film,'mono');assert.equal(s.exposure,.7);assert.equal(s.flash,false);
    const before=JSON.stringify([s.scene,s.film,s.exposure,s.flash]);for(const bad of [{scene:'missing'}, {film:'bad'}, {exposure:2}, {flash:1}, {scene:'coast',exposure:'2'}, {unknown:1}, {film:'toString'},null]){let rejected=false;try{await execute('configure_camera',bad);}catch{rejected=true;}assert.ok(rejected,'invalid configuration must reject');const after=await execute('read_camera_state');assert.equal(JSON.stringify([after.scene,after.film,after.exposure,after.flash]),before);}
    report.checks.push('valid camera changes and eight invalid inputs; invalid batches leave state unchanged');console.log('Configuration contracts passed');
    const result=await page.evaluate(async()=>{const first=window.__cameraTools.get('capture_instant_photo').execute({});let concurrentRejected=false,reloadRejected=false;try{await window.__cameraTools.get('capture_instant_photo').execute({});}catch{concurrentRejected=true;}try{window.__cameraTools.get('reload_camera_film').execute({});}catch{reloadRejected=true;}return{photo:await first,concurrentRejected,reloadRejected};});assert.ok(result.concurrentRejected&&result.reloadRejected);assert.equal(result.photo.remaining,7);assert.equal(result.photo.photoCount,4);
    s=await execute('read_camera_state');assert.equal(s.busy,false);assert.equal(s.development,null);assert.equal(s.photos[0].sample,false);report.checks.push('capture resolves after development and insertion; concurrent capture and reload are locked');
    await execute('configure_camera',{scene:'coast',film:'vintage',exposure:-.5});
    console.log('Capture 1/8 passed');for(let i=0;i<7;i++){await execute('capture_instant_photo');console.log(`Capture ${i+2}/8 passed`);}s=await execute('read_camera_state');assert.equal(s.remaining,0);assert.equal(s.photoCount,11);let emptyRejected=false;try{await execute('capture_instant_photo');}catch{emptyRejected=true;}assert.ok(emptyRejected);assert.equal((await execute('read_camera_state')).photoCount,11);report.checks.push('eight completed captures exhaust exactly one roll; empty-roll capture rejects without creating a photo');
    await execute('reload_camera_film');s=await execute('read_camera_state');assert.equal(s.remaining,8);assert.equal(s.photoCount,11);report.checks.push('reload restores eight exposures and preserves collection');
    const exported=await page.evaluate(async()=>{const p={image:document.querySelector('.photo-card img').src,title:'检查相片',date:'2026.09.08'};const c=await MomentLab.exportCanvas(p);const blob=await new Promise(r=>c.toBlob(r,'image/png'));return{width:c.width,height:c.height,type:blob.type,size:blob.size};});assert.equal(exported.width,1200);assert.equal(exported.height,1440);assert.equal(exported.type,'image/png');assert.ok(exported.size>100000);report.export=exported;report.checks.push('actual photo export decodes and generates nonempty 1200 × 1440 PNG');
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith('file:')||url.startsWith('data:')||url.startsWith('blob:')));s=await execute('read_camera_state');assert.equal(s.render.glError,0);report.checks.push('no uncaught JavaScript errors and no network requests throughout the sequence');report.final=s;
    report.status='PASS';console.log(JSON.stringify({status:report.status,checks:report.checks,render:report.final.render,export:report.export},null,2));
  }catch(error){report.status='FAIL';report.error=error.stack;report.errors=errors;console.error(JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
