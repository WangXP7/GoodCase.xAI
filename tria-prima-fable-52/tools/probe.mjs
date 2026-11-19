// Print a table of every registered model (or full detail for the named ones).
//   node tools/probe.mjs                 all models, one line each
//   node tools/probe.mjs chapel lantern  full JSON for these
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const names = process.argv.slice(2);
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: 640, height: 360 });
try {
  await page.goto(`${url}/dev/probe.html${names.length ? '?m=' + names.join(',') : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DONE === true, null, { timeout: 120000 });
  const o = await page.evaluate(() => window.RESULT);
  if (names.length) console.log(JSON.stringify(o, null, 1));
  else
    for (const [k, v] of Object.entries(o)) {
      if (v.error) {
        console.log(k, 'ERROR', v.error);
        continue;
      }
      console.log(
        k.padEnd(16),
        String(v.kind).padEnd(10),
        'v' + v.v,
        'l' + v.lods,
        String(v.tris).padStart(6),
        JSON.stringify(v.size),
        'minY',
        v.min[1],
        'col',
        v.col,
        v.parts.length ? 'parts:' + v.parts.join(',') : '',
        v.anchors.length ? 'anch:' + v.anchors.join(',') : '',
        v.em.length ? 'em:' + [...new Set(v.em)].join(',') : '',
        v.lights ? 'L' + v.lights : ''
      );
    }
} catch (e) {
  console.log('FAILED: ' + e.message);
} finally {
  const bad = logs.map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).filter((l) => /error|warn|failed/i.test(l));
  if (bad.length) console.log('PAGE LOG:\n' + bad.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
