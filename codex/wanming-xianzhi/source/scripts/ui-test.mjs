import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {newWorld,choose,advance,serialize} from '../generated/core.mjs';
import {events,endingTitles} from '../generated/catalog.mjs';
const codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=fs.existsSync(path.join(codeRoot,'剧情源文件'))?codeRoot:path.dirname(codeRoot);process.chdir(root);
fs.mkdirSync('验收/截图',{recursive:true});
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath:executable,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,offline:true});
const page=await context.newPage();const errors=[],requests=[],failed=[];const stages=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith('file:')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))requests.push(r.url());});page.on('requestfailed',r=>failed.push(r.url()));
await context.route(/^https?:/,r=>r.abort());
const url=pathToFileURL(path.join(root,'index.html')).href;
const click=async(act,id)=>page.locator(`[data-act="${act}"]${id?`[data-id="${id}"]`:''}`).first().click();
const waitTitle=title=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,title);
const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
try{
 await page.goto(url);await page.locator('.cover h1').waitFor();assert.match(await page.locator('.cover h1').innerText(),/此地有人/);await noOverflow();await page.screenshot({path:'验收/截图/01_桌面封面.png',fullPage:true});stages.push('直接 file://、断网、封面');
 await click('start');await waitTitle(events[0].title);assert.equal(await page.locator('.choice:enabled').count(),3);await page.screenshot({path:'验收/截图/02_接印阅读.png',fullPage:true});
 await click('settings');await page.locator('#font-size').fill('23');await page.locator('#line-size').fill('2.2');await page.locator('#slow-text').check();await click('settings-done');await click('skip');assert.ok((await page.locator('.narrative').first().innerText()).length>40);assert.equal(await page.locator('.narrative').first().evaluate(e=>getComputedStyle(e).fontSize),'23px');
 await click('settings');await page.locator('#slow-text').uncheck();await page.locator('#font-size').fill('19');await click('settings-done');stages.push('字号、行距、逐字与显示全文');
 await click('governance');await click('policy','repair');assert.equal(await page.locator('[data-act="policy"]:enabled').count(),0);await click('reading');stages.push('县务一次性安排、资源结算');
 await click('saves');await click('save-slot','1');await click('save-slot','2');await click('save-slot','3');await click('save-slot','1');await page.getByRole('heading',{name:'覆盖手动槽 1？'}).waitFor();await click('confirm-save','1');await click('close');
 await click('choose','a');assert.equal(await page.locator('.result').count(),1);await page.reload();await click('continue');assert.equal(await page.locator('.result').count(),1);await click('next');await waitTitle(events[1].title);stages.push('三个手动槽、覆盖确认、选择后自动保存及刷新续读');
 await click('saves');await click('load-slot','2');await click('confirm-load','2');await waitTitle(events[0].title);assert.equal(await page.locator('.result').count(),0);stages.push('读档回到选择前，无重复奖励');
 await click('saves');await page.locator('#import-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await page.waitForFunction(()=>document.querySelector('#file-message')?.textContent?.includes('不是完整'));await click('close');await waitTitle(events[0].title);stages.push('损坏导入拒绝且进度保留');
 const downloadPromise=page.waitForEvent('download');await click('saves');await click('export');const download=await downloadPromise;await download.saveAs(path.join(root,'验收/UI导出存档.json'));await click('close');
 for(const ending of ['E01','E06']){
  const witness=JSON.parse(fs.readFileSync(`验收/见证_${ending}.json`,'utf8'));
  // Clear only this test context's game state, never the user's browser profile.
  await page.evaluate(()=>{localStorage.removeItem('wanming-v01-auto');});await page.reload();await click('start');
  for(const [id,choice]of witness.decisions){await waitTitle(events.find(e=>e.id===id).title);await click('choose',choice);await click('next');}
  await waitTitle(endingTitles[ending]);await page.screenshot({path:`验收/截图/结局_${ending}.png`,fullPage:true});assert.equal(await page.locator('.fates>div').count(),8);stages.push(`完整UI路径 ${ending}，38次真实选择`);
 }
 for(const ending of ['E02','E03','E04','E05']){
  const witness=JSON.parse(fs.readFileSync(`验收/见证_${ending}.json`,'utf8'));let world=newWorld(witness.seed);for(const [id,choice]of witness.decisions){if(id==='M12')break;world=advance(choose(world,choice));}
  const payload=serialize(world);await click('saves');await page.locator('#import-file').setInputFiles({name:`legal-${ending}.json`,mimeType:'application/json',buffer:Buffer.from(payload)});await page.locator('#accept-import').click();await waitTitle('去留簿');const last=witness.decisions.at(-1)[1];await click('choose',last);await click('next');await waitTitle(endingTitles[ending]);stages.push(`合法见证存档导入与终章 ${ending}`);
 }
 await click('people');assert.equal(await page.locator('.person').count(),8);await page.locator('.person details').first().locator('summary').click();await click('archive');assert.equal(await page.locator('.history details').count(),38);await page.locator('.history summary').first().click();await noOverflow();stages.push('八人物记录、38件历史回看、凭据');
 await page.setViewportSize({width:390,height:844});await click('reading');await noOverflow();await page.screenshot({path:'验收/截图/03_窄屏终章.png',fullPage:true});
 await click('new');await click('confirm-new');await noOverflow();await page.screenshot({path:'验收/截图/04_窄屏阅读.png',fullPage:true});
 await click('settings');await page.locator('#font-size').fill('26');await click('settings-done');await noOverflow();await click('people');await noOverflow();await click('saves');await noOverflow();await page.screenshot({path:'验收/截图/05_窄屏存档.png',fullPage:true});await click('close');stages.push('390px窄屏、最大字号、人物与存档布局无横向溢出');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.deepEqual(failed,[]);
 fs.writeFileSync('验收/浏览器验收.md',`# Playwright 实际浏览器验收\n\n- 浏览器：${await browser.version()}，Edge Chromium，无头独立临时上下文。\n- 入口：最终单HTML的 file:// URL。\n- 网络：context offline=true，HTTP/HTTPS路由阻断。\n- 外部网络请求：${requests.length}；失败资源：${failed.length}；页面及控制台错误：${errors.length}。\n- 桌面1440×960；窄屏390×844；最大阅读字号26px。\n\n${stages.map(s=>'- 通过：'+s).join('\n')}\n\n两条结局经过全流程真实UI点击；另四条导入由正常核心选择重放生成的合法结局前存档，再通过UI选择并读终章。未用改数值或直接注入结局替代到达路径。\n`);
 console.log(JSON.stringify({stages:stages.length,errors,requests,failed},null,2));
}catch(error){await page.screenshot({path:'验收/截图/诊断_最近失败.png',fullPage:true});console.error(JSON.stringify({errors,requests,failed,text:(await page.locator('body').innerText()).slice(0,2500)},null,2));throw error;}finally{await browser.close();}
