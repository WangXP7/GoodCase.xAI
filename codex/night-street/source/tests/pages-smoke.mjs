import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const prefix = '/GoodCase.xAI/codex/night-street';
const root = resolve('out');
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.ico':'image/x-icon', '.svg':'image/svg+xml', '.txt':'text/plain' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix + '/')) throw new Error('wrong base path');
    const relative = pathname.slice(prefix.length + 1) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw new Error('invalid path');
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream'}).end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(4178, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true, args:['--disable-gpu-watchdog'], ...(process.env.QA_BROWSER ? {executablePath:process.env.QA_BROWSER} : {})});
const report = { errors:[], failed:[], external:[], checks:[] };
try {
  const page = await browser.newPage({viewport:{width:960,height:540}});
  page.setDefaultTimeout(90000);
  const chunkDir = resolve('out/_next/static/chunks');
  let sceneChunk;
  for (const name of await readdir(chunkDir)) {
    if (name.endsWith('.js') && (await readFile(resolve(chunkDir, name), 'utf8')).includes('requestPointerLock')) sceneChunk = name;
  }
  assert(sceneChunk, 'Scene chunk must exist');
  let releaseScene;
  const gate = new Promise(resolve => { releaseScene = resolve; });
  await page.route('**/' + sceneChunk, async route => { await gate; await route.continue(); });
  page.on('pageerror', e => { report.errors.push(e.message); console.log('Page error:',e.message); });
  page.on('console', msg => { if(msg.type()==='error') { report.errors.push(msg.text()); console.log('Console error:', msg.text().slice(0,500)); } });
  page.on('response', r => { if(r.status() >= 400) report.failed.push({url:r.url(),status:r.status()}); });
  page.on('requestfailed', r => report.failed.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('request', r => { if(!r.url().startsWith('http://127.0.0.1:4178/')) report.external.push(r.url()); });
  await page.addInitScript(() => {
    window.__qaLoadCompletion = false;
    new MutationObserver(() => {
      const veil = document.querySelector('[data-testid="load-veil"]');
      if (veil?.getAttribute('data-complete') === 'true' && veil.querySelector('.ns-load-percent')?.textContent === '100%') window.__qaLoadCompletion = true;
    }).observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['data-complete']});
    window.__qaDraw = 0;
    const draw = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function(...args) { window.__qaDraw++; return draw.apply(this,args); };
    window.__qaAudio = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__qaAudio.push(this); }
    };
  });
  await page.goto('http://127.0.0.1:4178' + prefix + '/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('progressbar').waitFor();
  const samples = [];
  for (const time of [15000, 30000, 120000]) {
    const sample = await page.evaluate(time => {
      const fill = document.querySelector('.ns-load-fill');
      const digits = document.querySelector('.ns-load-digits');
      fill.getAnimations()[0].currentTime = time;
      digits.getAnimations()[0].currentTime = time;
      return {time, bar:new DOMMatrix(getComputedStyle(fill).transform).a * 100, number:-new DOMMatrix(getComputedStyle(digits).transform).f / 24};
    }, time);
    assert(Math.abs(sample.bar - sample.number) <= 1.1, 'Percentage and bar must agree');
    samples.push(sample);
  }
  assert.equal(samples.at(-1).number, 95);
  assert.equal(await page.locator('[data-complete="true"]').count(), 0);
  await mkdir('verification', {recursive:true});
  await page.screenshot({path:'verification/loading-estimate.png'});
  report.progressSamples = samples;
  report.checks.push('Estimated bar and percentage agree; capped at 95% before actual frames');
  releaseScene();
  await page.getByTestId('load-veil').waitFor({state:'detached',timeout:240000});
  await page.waitForFunction(() => window.__qaDraw > 100, null, {timeout:240000});
  assert.equal(await page.evaluate(() => window.__qaLoadCompletion), true);
  report.checks.push('Real scene frames trigger 100% and automatic entry');
  console.log('Street rendered');
  report.checks.push('Static Pages base path and first rendered frame');
  await mkdir('verification', {recursive:true});
  await page.screenshot({path:'verification/pages-desktop.png'});
  await page.locator('canvas').click({force:true});
  await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout:10000});
  console.log('Pointer locked');
  report.checks.push('Canvas click captures mouse');
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.keyboard.down('Shift');
  await page.waitForTimeout(1200);
  await page.keyboard.up('Shift');
  await page.keyboard.up('w');
  await page.screenshot({path:'verification/pages-walk.png'});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.pointerLockElement, null, {timeout:10000});
  assert.equal(await page.evaluate(() => !!document.pointerLockElement), false);
  report.checks.push('W / Shift interaction and Escape release');
  report.audio = await page.evaluate(() => window.__qaAudio.map(c => ({state:c.state,sampleRate:c.sampleRate})));
  assert(report.audio.some(c => c.state === 'running'), 'Runtime AudioContext must be running');
  report.checks.push('Runtime procedural audio unlocked');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.external, []);
  const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.goto('http://127.0.0.1:4178' + prefix + '/', {waitUntil:'networkidle'});
  await mobile.getByRole('heading', {name:'This one needs a keyboard and a mouse.'}).waitFor();
  assert.equal(await mobile.locator('canvas').count(), 0);
  await mobile.screenshot({path:'verification/pages-mobile.png'});
  report.checks.push('Mobile capability notice, no GPU scene loaded');
  report.passed = true;
  await writeFile('verification/pages-smoke.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
