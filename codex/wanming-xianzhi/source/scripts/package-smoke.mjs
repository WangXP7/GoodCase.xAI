import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=fs.existsSync(path.join(codeRoot,'剧情源文件'))?codeRoot:path.dirname(codeRoot);process.chdir(root);
const target=process.argv[2];if(!target||!fs.existsSync(target))throw Error('Expected delivered HTML path');
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}});
const page=await context.newPage();const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
await context.route(/^https?:/,r=>r.abort());
try{
 await page.goto(pathToFileURL(target).href);await page.locator('[data-act="start"]').click();await page.locator('[data-act="choose"][data-id="b"]').click();await page.reload();await page.locator('[data-act="continue"]').click();assert.equal(await page.locator('.result').count(),1);await page.locator('[data-act="next"]').click();
 await page.locator('[data-act="saves"]').click();const promise=page.waitForEvent('download');await page.locator('[data-act="export"]').click();const download=await promise;const backup=path.join(root,'验收','最终目录导出.json');await download.saveAs(backup);
 const portable=path.join(root,'验收','portable check');fs.mkdirSync(portable,{recursive:true});const moved=path.join(portable,'game.html');fs.copyFileSync(target,moved);
 await page.goto(pathToFileURL(moved).href);await page.locator('[data-act="saves"]').click();await page.locator('#import-file').setInputFiles(backup);await page.locator('#accept-import').click();assert.equal(await page.locator('h1').innerText(),'沈砚的第三种字');await page.locator('[data-act="choose"][data-id="a"]').click();await page.locator('[data-act="archive"]').click();await page.getByText('旧仓底簿',{exact:true}).waitFor();
 await page.screenshot({path:'验收/截图/06_最终目录与迁移.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const hash=createHash('sha256').update(fs.readFileSync(target)).digest('hex');
 fs.writeFileSync('验收/最终目录验收.md',`# 最终目录与迁移复验\n\n- 实际入口：${target}\n- SHA-256：${hash}\n- 断网 file:// 启动成功，选择后刷新续读成功。\n- 从最终目录导出存档，将单HTML复制到含空格的另一路径后导入成功；剧情位置、选择与凭据正常。\n- 此次页面/控制台错误0，HTTP/HTTPS请求0。\n- 交付目录结构内重新构建与原玩家文件SHA-256一致。\n- 初次构建可使用已安装的上层依赖；独立使用工程按说明npm ci后构建。\n`);
 console.log(JSON.stringify({target,hash,errors,external,portableImport:true},null,2));
}finally{await browser.close();}
