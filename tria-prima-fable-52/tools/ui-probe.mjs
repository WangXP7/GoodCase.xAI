// Opens one workbench scene and evaluates an expression in the page: a quick look at the DOM
// and computed styles without opening a browser.
//
//   node tools/ui-probe.mjs book-ingredients "getComputedStyle(document.querySelector('.tp-cell .tp-icon')).width"
//   node tools/ui-probe.mjs hud "document.querySelector('.tp-belt').outerHTML" 1280x720
//   node tools/ui-probe.mjs brew-ready @path/to/snippet.js 900x600 shot-name     (also saves shots/ui_probe_<shot-name>.jpg)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [scene = 'title', exprArg = 'document.title', size = '1920x1080', shot = ''] = process.argv.slice(2);
const expr = exprArg.startsWith('@') ? fs.readFileSync(exprArg.slice(1), 'utf8') : exprArg;
const [width, height] = size.split('x').map(Number);
const [sceneName, query = ''] = scene.split('?');

const { server, url } = await startServer(0);
const { browser, page } = await launch({ width, height });
try {
  // frozen by default; pass "scene?still=0" to let the mock game run and take the keys it owns
  const still = /(^|&)still=/.test(query) ? '' : '&still=1';
  await page.goto(`${url}/dev/ui.html?scene=${encodeURIComponent(sceneName)}${still}${query ? '&' + query : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.UIDEV && window.UIDEV.done === true, null, { timeout: 20000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const seek = await page.evaluate((name) => (window.UIDEV.list.find((s) => s.name === name) || { seek: 1500 }).seek, sceneName);
  await page.evaluate((ms) => window.UIDEV.seek(ms), seek);
  const value = await page.evaluate(`(async () => (${expr}))()`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  if (shot) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = path.join(root, 'shots', `ui_probe_${shot.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log('saved', path.relative(root, file));
  }
} finally {
  await browser.close();
  server.close();
}
