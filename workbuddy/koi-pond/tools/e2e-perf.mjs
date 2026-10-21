// 验证性能面板：FPS / CPU / GPU 三项是否都在动，且数值合理
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-quic', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:8918/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.KOI_READY === true, { timeout: 120000 });
await page.waitForTimeout(6000);

const read = () => page.evaluate(() => ({
  fps: document.getElementById('pFps').textContent,
  cpu: document.getElementById('pCpu').textContent,
  gpu: document.getElementById('pGpu').textContent,
  fpsCls: document.getElementById('pFps').className,
  bars: [
    document.getElementById('bFps').style.width,
    document.getElementById('bCpu').style.width,
    document.getElementById('bGpu').style.width
  ],
  gpuExt: !!window.KOI.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2'),
  panelBox: (() => { const r = document.getElementById('perf').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })()
}));

const a = await read();
await page.waitForTimeout(3500);
const b = await read();
console.log('T1', JSON.stringify(a));
console.log('T2', JSON.stringify(b));

const live = a.fps !== '—' && a.cpu !== '—' && parseInt(a.fps) > 0;
const sw = await page.evaluate(() => { const gl=window.KOI.renderer.getContext(); const d=gl.getExtension('WEBGL_debug_renderer_info'); const n=d?String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)):''; return /swiftshader|llvmpipe|software/i.test(n); });
const gpuLive = (a.gpuExt && !sw) ? a.gpu !== '—' : a.gpu === '—';
console.log('software renderer:', sw);
console.log('FPS/CPU live:', live, ' GPU consistent with ext:', gpuLive);

// 注入 GPU 数据，验证百分比分支
await page.evaluate(() => window.KOI.perf._simGpu(7.5));
await page.waitForTimeout(1600);
const sim = await read();
console.log('SIM', JSON.stringify({ gpu: sim.gpu, bar: sim.bars[2] }));
await page.screenshot({ path: 'shots/05-perf-panel.jpg', type: 'jpeg', quality: 92, timeout: 150000 });
console.log('shot -> shots/05-perf-panel.jpg');

// 面板局部放大，检查排版
await page.locator('#perf').screenshot({ path: 'shots/06-perf-crop.jpg', type: 'jpeg', quality: 95, timeout: 120000 });
console.log('crop -> shots/06-perf-crop.jpg');

console.log('ERRORS', errors.length, errors.slice(0, 5));
await browser.close();
