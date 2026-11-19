// Open a dev page on the real GPU, wait for window.DONE, print window.RESULT and any page errors.
//   node tools/page-run.mjs dev/map.html [--w 1280 --h 720 --timeout 60000]
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const args = {};
const pos = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
  else pos.push(a);
}
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: Number(args.w || 1280), height: Number(args.h || 720) });
try {
  await page.goto(`${url}/${pos[0]}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DONE === true, null, { timeout: Number(args.timeout || 60000) });
  console.log(JSON.stringify(await page.evaluate(() => window.RESULT ?? null)));
} catch (e) {
  console.log('FAILED: ' + e.message);
} finally {
  const bad = logs.map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).filter((l) => /error|warn|failed/i.test(l));
  if (bad.length) console.log('PAGE LOG:\n' + bad.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
