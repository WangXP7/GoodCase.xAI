// Drive the real game on the real GPU through a scripted scenario and capture the whole page
// (canvas + UI) into shots/.
//   node tools/play.mjs tools/scenarios/first.mjs [--q high] [--w 1600] [--h 900] [--page dev/game.html]
// A scenario exports `default async function (ctx)` with
//   ctx.ev(fn, arg)      run a function in the page (window.TP is the game's tool hook)
//   ctx.step(n, dt)      step n frames
//   ctx.shot(name)       screenshot of the page -> shots/<name>.jpg
//   ctx.page             the Playwright page (keyboard, mouse)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
  else args._.push(a);
}
const W = Number(args.w || 1600),
  H = Number(args.h || 900);
const scenario = args._[0];
if (!scenario) {
  console.log('usage: node tools/play.mjs <scenario.mjs> [--q high]');
  process.exit(1);
}
const mod = await import(pathToFileURL(path.resolve(scenario)).href);
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: W, height: H });
const shotsDir = path.join(root, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });
const t0 = Date.now();
let failed = false;
try {
  const q = new URLSearchParams();
  if (args.live !== '1') q.set('still', '1');
  else q.set('dev', '1');
  if (args.q) q.set('q', args.q);
  await page.goto(`${url}/${args.page || 'dev/game.html'}?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TP && window.DONE, null, { timeout: 180000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const ctx = {
    page,
    args,
    ev: (fn, arg) => page.evaluate(fn, arg),
    step: (n = 1, dt = 1 / 30) => page.evaluate(([n, dt]) => window.TP.step(n, dt), [n, dt]),
    async shot(name) {
      const file = path.join(shotsDir, name + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
      console.log(file);
      return file;
    },
    log: (...a) => console.log(...a),
  };
  await mod.default(ctx);
  console.log(JSON.stringify(await page.evaluate(() => window.TP.stats())));
} catch (e) {
  failed = true;
  console.log('FAILED: ' + (e && e.stack ? e.stack : e));
} finally {
  const bad = (logs || []).filter((l) => /error|warn|failed/i.test(l));
  if (bad.length) {
    console.log('PAGE LOG:');
    for (const l of bad.slice(0, 40)) console.log('  ' + l.slice(0, 1800));
  }
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
