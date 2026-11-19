// npm run shot -- --name <n> --params "<query>" [--frames 30] [--size 1920x1080] [--device phone|tablet] [--dpr 3] [--allow-errors]
// --device uses the preset's viewport (phone 844x390 at DPR 3, tablet 1180x820 at DPR 2; --size and --dpr override it)
// with touch and a mobile user agent. The PNG is in device pixels (a phone shot is 2532x1170).
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pageUrl, watchPage, scratch, contextOptions } from './lib.mjs';

const { values: a } = parseArgs({
  options: {
    name: { type: 'string' }, params: { type: 'string', default: '' }, frames: { type: 'string', default: '30' },
    size: { type: 'string' }, device: { type: 'string' }, dpr: { type: 'string' }, 'allow-errors': { type: 'boolean', default: false },
  },
});
if (!a.name) { console.error('usage: shot --name <n> [--params "<query>"] [--frames 30] [--size 1920x1080] [--device phone|tablet] [--dpr 3] [--allow-errors]'); process.exit(2); }
const frames = Number(a.frames);
const outDir = join(scratch, 'shots');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${a.name}.png`);

let browser; let code = 0;
try {
  browser = await launch({ device: a.device });
  const page = await browser.newPage(contextOptions({ device: a.device, size: a.size, dpr: a.dpr, version: browser.version() }));
  const extra = watchPage(page);
  await page.goto(pageUrl(a.params));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

  const stepped = await page.evaluate(() => !!window.__G.params.step);
  if (stepped) {
    await page.evaluate((n) => { window.__step = n; }, frames);
    await page.waitForFunction(() => window.__step === 0, null, { timeout: 60000 });
  } else {
    const start = await page.evaluate(() => window.__G.time.frame);
    await page.waitForFunction((s, n) => window.__G.time.frame >= s + n, start, frames, { timeout: 60000 }).catch(() => {});
  }
  // let the compositor present the last frame
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: out });

  const errors = await page.evaluate(() => window.__errors || []);
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const e = c && c.getExtension('WEBGL_debug_renderer_info');
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const stats = await page.evaluate(() => window.__stats());
  console.log(`[shot] ${out}`);
  console.log(`[shot] gl=${gl} stats=${JSON.stringify(stats)}`);
  const all = [...errors, ...extra.filter((e) => !errors.some((x) => x.includes(e.slice(15, 60))))];
  if (all.length) {
    console.log(`[shot] ${all.length} error(s):\n  ${all.join('\n  ')}`);
    if (!a['allow-errors']) code = 1;
  }
} catch (e) {
  console.error(`[shot] failed: ${e.message}`);
  code = 1;
} finally {
  if (browser) await browser.close();
}
process.exit(code);
