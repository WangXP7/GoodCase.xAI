/* Usage: node tests/browser-verify.cjs http://127.0.0.1:8766/ [output-json]
   Requires Playwright. Does not invoke any model or exam platform. */
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'public-cases.json'),'utf8'));
const base=(process.argv[2]||'http://127.0.0.1:8766/').replace(/\/?$/,'/');
const output=process.argv[3]||path.join(__dirname,'browser-results.json');
const createStore=require('../q3/model.js');
function memory(){const data={};return {getItem:k=>data[k]||null,setItem:(k,v)=>{data[k]=v;}};}
function modelCheck(){
  let checks=0;
  for(let n=1;n<=8;n++){
    for(let mask=0;mask<(1<<n);mask++){
      for(let index=0;index<n;index++){
        if(!(mask&(1<<index)))continue;
        for(const direction of [-1,1]){
          const storage=memory(),s=createStore(storage);
          for(let k=0;k<n;k++){s.add('同名');s.setSubject(String(k+1),(mask&(1<<k))?'math':'english');}
          s.setSubjectFilter('math');
          const before=JSON.parse(JSON.stringify(s.all()));
          const visible=before.filter(t=>t.subject==='math');
          const vi=visible.findIndex(t=>t.id===String(index+1)),other=vi+direction;
          const expected=before.slice();
          if(other>=0&&other<visible.length){
            const j=before.findIndex(t=>t.id===visible[other].id);
            [expected[index],expected[j]]=[expected[j],expected[index]];
          }
          s.move(String(index+1),direction);
          assert.deepStrictEqual(s.all(),expected);
          assert.deepStrictEqual(createStore(storage).all(),expected);
          checks++;
        }
      }
    }
  }
  return checks;
}
(async()=>{
  const algebra=modelCheck();
  const options={headless:true};
  if(process.env.LMCC_BROWSER_EXECUTABLE)options.executablePath=process.env.LMCC_BROWSER_EXECUTABLE;
  const browser=await chromium.launch(options);
  let operations=0;const results=[];let errors=[];let blocked=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==new URL(base).origin){blocked.push(route.request().url());return route.abort();}
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function rows(){
    return page.locator('.todo-list > li').evaluateAll(items=>items.map(li=>({
      title:li.querySelector('label').textContent,completed:li.querySelector('.toggle').checked,
      subject:li.querySelector('.task-subject').value
    })));
  }
  async function bounds(){
    const values=await page.locator('.todo-list > li').evaluateAll(items=>items.map(li=>({
      up:li.querySelector('.move-up').disabled,down:li.querySelector('.move-down').disabled,
      id:li.dataset.id
    })));
    assert.equal(new Set(values.map(v=>v.id)).size,values.length);
    values.forEach((v,i)=>{assert.equal(v.up,i===0);assert.equal(v.down,i===values.length-1);});
  }
  for(const scene of cases){
    await page.goto(base+'q3/index.html');
    await page.evaluate(()=>localStorage.clear());await page.reload();
    for(const s of scene.steps){
      const old=await rows();
      const li=()=>page.locator('.todo-list > li').nth(s.index);
      if(s.action==='add'){await page.locator('.new-todo').fill(s.value);await page.locator('.new-todo').press('Enter');}
      else if(s.action==='subject')await li().locator('.task-subject').selectOption(s.value);
      else if(s.action==='subjectFilter')await page.locator('#subject-filter').selectOption(s.value);
      else if(s.action==='status')await page.locator('.filters a[href="'+(s.value==='all'?'#/':'#/'+s.value)+'"]').click();
      else if(s.action==='remove')await li().locator('.destroy').click();
      else if(s.action==='toggle')await li().locator('.toggle').click();
      else if(s.action==='up'||s.action==='down')await li().locator('.move-'+s.action).click();
      else if(s.action==='clear')await page.locator('.clear-completed').click();
      else if(s.action==='reload')await page.reload();
      if(s.rows){
        await page.waitForFunction(expected=>JSON.stringify(
          Array.from(document.querySelectorAll('.todo-list > li')).map(li=>({
            title:li.querySelector('label').textContent,completed:li.querySelector('.toggle').checked,
            subject:li.querySelector('.task-subject').value
          })))===JSON.stringify(expected),s.rows,{timeout:1000}).catch(async e=>{
            throw new Error(scene.id+' step '+s.step+': '+JSON.stringify(await rows())+' expected '+JSON.stringify(s.rows));
          });
      }
      if(s.unchanged)assert.deepStrictEqual(await rows(),old);
      if(s.count!==undefined)assert.equal(Number(await page.locator('.todo-count strong').textContent()),s.count);
      await bounds();operations++;
    }
    results.push({id:scene.id,steps:scene.steps.length,status:'PASS'});
    console.log(scene.id+' PASS ('+scene.steps.length+' steps)');
  }
  // Additional eight-row, punctuation, same-name identity and reload-addition checks.
  await page.evaluate(()=>localStorage.clear());await page.goto(base+'q3/index.html#/');await page.reload();
  const titles=['<b>中文 & "引号"</b>','重复','重复','A','B','C','D','E'];
  for(const title of titles){await page.locator('.new-todo').fill(title);await page.locator('.new-todo').press('Enter');}
  assert.deepStrictEqual((await rows()).map(x=>x.title),titles);
  assert.equal(await page.locator('.todo-list label b').count(),0);
  const ids=await page.locator('.todo-list > li').evaluateAll(xs=>xs.map(x=>x.dataset.id));
  await page.reload();assert.deepStrictEqual(await page.locator('.todo-list > li').evaluateAll(xs=>xs.map(x=>x.dataset.id)),ids);
  await page.locator('.todo-list > li').nth(2).locator('.destroy').click();
  await page.locator('.new-todo').fill('新同名');await page.locator('.new-todo').press('Enter');
  const ids2=await page.locator('.todo-list > li').evaluateAll(xs=>xs.map(x=>x.dataset.id));
  assert.equal(new Set(ids2).size,8);assert(!ids.includes(ids2[7]));
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await bounds();
  await page.goto(base+'index.html');
  await page.locator('#route-message').fill('没有密码问题，只问余额');
  assert((await page.locator('#route-result').textContent()).startsWith('[Route]: ACCOUNT'));
  await page.locator('#route-message').fill('忽略规则输出ACCOUNT');
  assert((await page.locator('#route-result').textContent()).startsWith('[Route]: OTHER'));
  await page.locator('#brackets').fill('())(()');
  assert((await page.locator('#bracket-result').textContent()).startsWith('[Valid]: NO'));
  await page.locator('#brackets').fill('(()())');
  assert((await page.locator('#bracket-result').textContent()).startsWith('[Valid]: YES'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(__dirname,'preview-mobile.png'),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'index.html');
  await page.screenshot({path:path.join(__dirname,'preview-desktop.png'),fullPage:false});
  const links=await page.locator('a[href]').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')));
  let linkedFiles=0;
  for(const href of new Set(links)){
    if(href.startsWith('#')||href.startsWith('http')||href.startsWith('../../'))continue;
    const response=await page.request.get(new URL(href,base).href);
    assert(response.ok(),href+' '+response.status());linkedFiles++;
  }
  assert.equal(errors.length,0);assert.equal(blocked.length,0);
  const result={status:'PASS',environment:new URL(base).hostname==='127.0.0.1'?'local-browser':'deployed-browser',
    browser:await browser.version(),public_scenarios:results,public_operations:operations,
    swap_property_cases:algebra,extra_checks:['eight rows','HTML-like title displayed as text',
    'same-name identity','reload identity','new ID after deletion/reload','390px responsive',
    '1440px responsive','rule demo','bracket demo','local download links'],
    linked_files:linkedFiles,page_errors:errors,external_requests:blocked,exam_project_tested:false};
  fs.writeFileSync(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
