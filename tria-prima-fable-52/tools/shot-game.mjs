// Capture views of the world (or the game) on the real GPU into shots/.
//   node tools/shot-game.mjs --shots "dock:0,_,300,0,-4,1.7@17.5;peak:-170,160,-200,200,-20" --q high
// A shot is  name:x,y,z,heading,pitch[,above][@hour] . y may be "_" when `above` (metres over the
// ground) is given. Heading is degrees clockwise from north (north = -Z).
// Options: --page dev/world.html  --q low|medium|high|ultra  --hour 15  --w 1600 --h 900
//          --eval "TP.weather({fog:0.8})"   (runs once after the page is ready)
//          --settle 40                      (frames stepped before each capture)
//          --timing 1                       (also measure real frame time over 120 frames)
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
}
const W = Number(args.w || 1600),
  H = Number(args.h || 900);
const pagePath = args.page || 'dev/world.html';
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: W, height: H });
const t0 = Date.now();
try {
  const q = new URLSearchParams();
  q.set('still', '1');
  if (args.q) q.set('q', args.q);
  if (args.hour) q.set('hour', args.hour);
  await page.goto(`${url}/${pagePath}?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TP && window.DONE, null, { timeout: 120000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (args.eval) await page.evaluate((code) => new Function('TP', code)(window.TP), args.eval);
  const shots = (args.shots || 'view:0,40,330,0,-8').split(';').filter(Boolean);
  for (const s of shots) {
    const [head, hourStr] = s.split('@');
    const [name, rest] = head.split(':');
    const v = rest.split(',').map((t) => (t.trim() === '_' ? null : Number(t)));
    const r = await page.evaluate(
      async ([name, v, hour, settle]) => {
        const TP = window.TP;
        if (hour != null) TP.hour(hour);
        TP.cam(v[0], v[1] ?? 0, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? null);
        return TP.shot(name, settle);
      },
      [name, v, hourStr != null ? Number(hourStr) : null, Number(args.settle || 40)]
    );
    console.log(r.file);
  }
  if (args.timing) {
    const t = await page.evaluate(async () => {
      const TP = window.TP;
      const gl = TP.engine.renderer.getContext();
      const a = performance.now();
      for (let i = 0; i < 120; i++) TP.step(1, 1 / 60);
      gl.finish();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (performance.now() - a) / 120;
    });
    console.log(`frame ${t.toFixed(2)} ms`);
  }
  console.log(JSON.stringify(await page.evaluate(() => window.TP.stats())));
  const bad = (logs || []).map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).filter((l) => /error|warn|failed/i.test(l));
  if (bad.length) {
    console.log('PAGE LOG:');
    for (const l of bad.slice(0, 40)) console.log('  ' + l.slice(0, 1600));
  }
} catch (e) {
  console.log('FAILED: ' + e.message);
  const bad = (logs || []).map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l)));
  for (const l of bad.slice(0, 40)) console.log('  ' + l.slice(0, 2400));
} finally {
  await browser.close();
  server.close();
}
