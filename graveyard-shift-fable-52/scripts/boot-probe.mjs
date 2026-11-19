// Loads the game in a real browser and reports how the boot went: how long each stage took, which
// graphics backend ran it, and every error. Used to check platforms the game is not developed on.
//   node scripts/boot-probe.mjs <url> [--browser chromium|firefox] [--args "--use-angle=d3d11 ..."] [--wait 300]
import { chromium, firefox } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const url = argv.find((a) => !a.startsWith('--') && /^(https?|file):/.test(a));
const which = opt('browser', 'chromium');
const args = (opt('args', '') || '').split(' ').filter(Boolean);
const waitS = Number(opt('wait', 300));
const name = opt('name', which);
if (!url) { console.error('usage: boot-probe.mjs <url> [--browser ..] [--args ".."] [--wait s] [--name label]'); process.exit(2); }

const browser = which === 'firefox'
  ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } })
  : await chromium.launch({ channel: 'chromium', headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
// the page writes its boot details to console.info at ready and every 30 s once it is slow
// (core/bootwatch.js): kept here so they arrive even when page.evaluate hangs
let lastDetails = null;
page.on('console', (m) => {
  if (m.type() === 'info' && m.text().startsWith('[boot details]')) { lastDetails = { at: Number(((Date.now() - t0) / 1000).toFixed(1)), text: m.text() }; return; }
  if (m.type() !== 'log' && m.type() !== 'info') logs.push(`${m.type()}: ${m.text().slice(0, 1500)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 600)}`));
page.on('crash', () => logs.push('PAGE CRASHED'));

const t0 = Date.now(); // console messages arrive only after goto below, so the handler above may use it
const stages = [];
let last = '';
let ready = false;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => logs.push(`goto: ${e.message.split('\n')[0]}`));
while ((Date.now() - t0) / 1000 < waitS) {
  const s = await Promise.race([
    page.evaluate(() => ({ ready: window.__ready === true, label: document.getElementById('boot-label')?.textContent || '', lost: !!(window.__G && window.__G.renderer && window.__G.renderer.getContext && window.__G.renderer.getContext().isContextLost()) })),
    new Promise((r) => setTimeout(() => r({ hung: true }), 5000)),
  ]).catch((e) => ({ err: String(e.message).split('\n')[0] }));
  const tag = s.hung ? '(page not answering)' : s.err ? `(eval failed: ${s.err})` : `${s.label}${s.lost ? ' [context lost]' : ''}`;
  if (tag !== last) { stages.push([Number(((Date.now() - t0) / 1000).toFixed(1)), tag]); last = tag; }
  if (s.ready) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 500));
}
const readyAt = (Date.now() - t0) / 1000;

const info = await Promise.race([
  page.evaluate(async () => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const G = window.__G;
    const frames = [];
    if (window.__ready) {
      let t = performance.now();
      for (let i = 0; i < 90; i++) { await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); frames.push(Math.round(n - t)); t = n; }
    }
    return {
      ua: navigator.userAgent,
      renderer: gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl2',
      parallelCompile: gl ? !!gl.getExtension('KHR_parallel_shader_compile') : null,
      colorBufferFloat: gl ? !!gl.getExtension('EXT_color_buffer_float') : null,
      limits: gl ? { tex: gl.getParameter(gl.MAX_TEXTURE_SIZE), fragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), vertUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), varyings: gl.getParameter(gl.MAX_VARYING_VECTORS), units: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) } : null,
      overlay: (document.getElementById('gfx-unsupported') || document.getElementById('gfx-failed'))?.textContent?.slice(0, 300) || null,
      programs: G && G.renderer && G.renderer.info && G.renderer.info.programs ? G.renderer.info.programs.length : null,
      contextLost: !!(G && G.renderer && G.renderer.getContext && G.renderer.getContext().isContextLost()),
      stats: window.__stats ? window.__stats() : null,
      frameMs: frames.length ? { first10: frames.slice(0, 10), median: frames.slice().sort((a, b) => a - b)[frames.length >> 1], worst: Math.max(...frames) } : null,
      errors: (window.__errors || []).map((s) => String(s).slice(0, 2500)),
      // seconds per boot stage and the longest stalls (core/bootwatch.js), the effects atlas timings (fx/atlas.js)
      bootStalls: window.__bootStalls || null,
      bootDetails: typeof window.__bootDetails === 'function' ? window.__bootDetails() : null,
      fxBake: window.__fxBake || null,
      warm: window.__warmRuns || null,
    };
  }),
  new Promise((r) => setTimeout(() => r({ evalHung: true }), 120000)),
]).catch((e) => ({ evalError: String(e.message) }));

mkdirSync('probe-out', { recursive: true });
await Promise.race([page.screenshot({ path: `probe-out/${name}.png` }), new Promise((r) => setTimeout(r, 20000))]).catch(() => {});
const out = { name, url, args, ready, readyAt: Number(readyAt.toFixed(1)), stages, info, lastDetails, logs: logs.slice(0, 80) };
writeFileSync(`probe-out/${name}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
process.exit(0);
