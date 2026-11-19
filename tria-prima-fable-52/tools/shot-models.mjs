// Render kit models to shots/<out>.jpg on the real GPU.
//   node tools/shot-models.mjs --m cinderbloom --seed 1-4 --out model_cinderbloom
//   node tools/shot-models.mjs --m kind:ingredient --bg night --az 40 --el 22 --out model_ingredients_night
// Options: --m --seed --az --el --dist --fov --bg(day|dusk|night) --debug 1 --gap --w --h --out --t
//          --opts lod=1,picked=true   (passed to the model as its opts object)
// Several views in one run: --views "az,el;az,el;..."  -> <out>_0.jpg, <out>_1.jpg ...
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
}
const W = Number(args.w || 1600),
  H = Number(args.h || 900);
const out = args.out || 'model';
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: W, height: H });
try {
  const q = new URLSearchParams();
  for (const k of ['m', 'seed', 'az', 'el', 'dist', 'fov', 'bg', 'debug', 'gap', 't', 'opts']) if (args[k] !== undefined) q.set(k, args[k]);
  q.set('still', '1');
  await page.goto(`${url}/dev/models.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MV && window.MV.info, null, { timeout: 30000 });
  const info = await page.evaluate(() => window.MV.info());
  if (args.views) {
    const views = args.views.split(';').map((v) => v.split(',').map(Number));
    for (let i = 0; i < views.length; i++) {
      await page.evaluate(([az, el]) => window.MV.set({ az: String(az), el: String(el) }), views[i]);
      const r = await page.evaluate((n) => window.MV.shot(n), `${out}_${i}`);
      console.log(r.file);
    }
  } else {
    const r = await page.evaluate((n) => window.MV.shot(n), out);
    console.log(r.file);
  }
  console.log(JSON.stringify(info));
  const bad = (logs || []).map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).filter((l) => /error|failed/i.test(l));
  if (bad.length) {
    console.log('PAGE ERRORS:');
    for (const l of bad) console.log('  ' + l);
  }
} finally {
  await browser.close();
  server.close();
}
