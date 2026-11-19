// Captures every UI screen from the workbench (dev/ui.html) into shots/ui_*.jpg and reports
// console errors.
//
//   node tools/ui-shots.mjs                every scene at 1920x1080 and 1280x720, the key ones at 900x600
//   node tools/ui-shots.mjs brew           only scenes whose name contains "brew"
//   node tools/ui-shots.mjs book,lore 720  several filters, and only the 1280x720 pass (1080 | 720 | 600)
//   node tools/ui-shots.mjs hud 1080 icons=1&bg=day    extra query for the workbench
//
// Files: shots/ui_<scene>_<1080|720|600>.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });

const SIZES = [
  { tag: '1080', width: 1920, height: 1080, all: true },
  { tag: '720', width: 1280, height: 720, all: true },
  { tag: '600', width: 900, height: 600, all: false },
];

const args = process.argv.slice(2);
const filters = (args[0] && args[0] !== 'all' ? args[0].split(',') : []).filter(Boolean);
const onlySize = args[1] && args[1] !== 'all' ? args[1] : null;
const extra = args[2] ? '&' + args[2].replace(/^[?&]/, '') : '';
const suffix = args[2] ? '_' + args[2].replace(/[^a-zA-Z0-9]+/g, '-') : '';

const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: 1920, height: 1080 });
const problems = [];
let count = 0;

async function open(scene, query = '') {
  const from = logs.length;
  await page.goto(`${url}/dev/ui.html?scene=${encodeURIComponent(scene)}&still=1${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.UIDEV && window.UIDEV.done === true, null, { timeout: 20000 });
  return from;
}

try {
  await open('title');
  const list = await page.evaluate(() => window.UIDEV.list);
  const wanted = list.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
  if (!wanted.length) console.log('no scene matches', filters.join(','), '\nscenes:', list.map((s) => s.name).join(' '));

  for (const size of SIZES) {
    if (onlySize && size.tag !== onlySize) continue;
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const s of wanted) {
      if (!size.all && !s.small && !onlySize) continue;
      const shoot = async () => {
        const at = await open(s.name, extra);
        // let the canvases draw, then put every CSS animation at a settled moment
        await page.evaluate(() => new Promise((r) => setTimeout(r, 260)));
        await page.evaluate((ms) => window.UIDEV.seek(ms), s.seek);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const file = path.join(out, `ui_${s.name}${suffix}_${size.tag}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
        return at;
      };
      // a busy machine can stall a capture: give it two more tries, a little apart, before giving up
      let from;
      for (let attempt = 1; ; attempt++) {
        try {
          from = await shoot();
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          console.log(`retrying ${s.name} @${size.tag}: ${String(e && e.message).split('\n')[0]}`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      count++;
      const bad = logs.slice(from).filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[warning]'));
      if (bad.length) problems.push({ scene: s.name, size: size.tag, bad });
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${count} captures -> ${path.relative(root, out)}/ui_*.jpg`);
if (problems.length) {
  console.log(`console problems in ${problems.length} capture(s):`);
  for (const p of problems) console.log(`  ${p.scene} @${p.size}\n    ` + p.bad.join('\n    '));
  process.exitCode = 1;
} else console.log('no console errors or warnings');
