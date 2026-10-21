// 锦鲤池 E2E：渲染冒烟 + 交互断言 + 截图
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8917/index.html';
const shot = process.argv[2] || 'shots/01-overview.jpg';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-quic', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const errors = [];
const logs = [];
page.on('console', m => {
  const t = m.type();
  const txt = m.text();
  logs.push(`[${t}] ${txt}`);
  if (t === 'error') errors.push(txt + ' | @ ' + (m.location() ? m.location().url : ''));
});
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '')));
page.on('requestfailed', r => {
  const u = r.url();
  if (!/favicon/.test(u)) errors.push('REQFAIL ' + u + ' :: ' + (r.failure() ? r.failure().errorText : ''));
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.KOI_READY === true, { timeout: 60000 });
await page.waitForTimeout(2200);

const info = await page.evaluate(() => {
  const K = window.KOI;
  return {
    frame: K.frame,
    kois: K.kois.length,
    fish0: K.kois[0].pos.toArray().map(n => +n.toFixed(3)),
    fishY: K.kois.map(k => +k.pos.y.toFixed(3)),
    sceneChildren: K.scene.children.length,
    grass: window.__grassCount,
    rocks: window.__rockCount,
    tris: K.renderer.info.render.triangles,
    calls: K.renderer.info.render.calls,
    hasEnv: !!K.scene.environment,
    camPos: K.camera.position.toArray().map(n => +n.toFixed(2))
  };
});
console.log('INFO', JSON.stringify(info, null, 1));

if (process.env.DEBUG_REFL) {
  await page.evaluate(() => { window.KOI.waterMat.uniforms.uDebug.value = 1; });
  await page.waitForTimeout(700);
}
await page.screenshot({ path: shot, type: 'jpeg', quality: 88, timeout: 120000 });
console.log('shot ->', shot);
console.log('ERRORS', errors.length);
for (const e of errors.slice(0, 12)) console.log('  !', e);

await browser.close();
process.exit(errors.length ? 1 : 0);
