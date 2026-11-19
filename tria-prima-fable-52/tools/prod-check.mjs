// Checks the release page the way a visitor meets it: served from a sub-path (as on GitHub
// Pages), no test hooks, real clock, real mouse and keys.
//   node tools/prod-check.mjs [--url https://host/path/]   (default: serves this folder itself)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[i + 1];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain' };
const BASE = '/tria-prima/';
// only what the release ships is served: the page, dist/, assets/, media/
const SHIPPED = /^(index\.html|dist\/|assets\/|media\/)/;

let server = null;
let url = args.url;
if (!url) {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith(BASE)) {
      res.writeHead(404).end('outside the site');
      return;
    }
    let rel = decodeURIComponent(u.pathname.slice(BASE.length)) || 'index.html';
    const file = path.join(root, rel);
    if (!SHIPPED.test(rel) || !file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}${BASE}`;
}

const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''));
};

const { browser, context, page, logs } = await launch({ width: 1600, height: 900 });
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() ? r.failure().errorText : '')));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(r.status() + ' ' + r.url());
});
try {
  console.log('page: ' + url);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DONE === true, null, { timeout: 180000 });
  console.log(`  raised in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(3500);
  check('no test hooks on a normal visit', await page.evaluate(() => typeof window.TP === 'undefined'));
  check('every request answered', failed.length === 0, failed.slice(0, 5).join(' | '));
  check('display face loaded', await page.evaluate(() => document.fonts.check("500 20px 'Cormorant Garamond'")));
  check('title on screen', (await page.getByText('Begin', { exact: true }).count()) > 0);
  await page.screenshot({ path: path.join(shots, 'p_title.jpg'), type: 'jpeg', quality: 90 });

  const begin = page.getByText('Begin', { exact: true }).first();
  const at = await begin.boundingBox();
  const mx = at.x + at.width / 2,
    my = at.y + at.height / 2;
  await page.mouse.click(mx, my);
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space'); // skip the arrival
  await page.waitForTimeout(3000);
  check('pointer locked to the canvas', await page.evaluate(() => document.pointerLockElement === document.getElementById('c')));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  // a small look to the side: under the pointer lock the mouse sends travel, not a position
  await page.mouse.move(mx + 70, my - 6, { steps: 8 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, 'p_play.jpg'), type: 'jpeg', quality: 90 });
  // the picture is not black: the canvas has light in it
  // (read inside a frame, after the game has drawn: the drawing buffer is not kept between frames)
  const lum = await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => {
          const c = document.getElementById('c');
          const t = document.createElement('canvas');
          t.width = 64;
          t.height = 36;
          const g = t.getContext('2d');
          g.drawImage(c, 0, 0, 64, 36);
          const d = g.getImageData(0, 0, 64, 36).data;
          let s = 0;
          for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
          done(s / (d.length / 4) / 3);
        })
      )
  );
  check('the world is drawn', lum > 8, 'mean level ' + lum.toFixed(1));
  check('objective on the HUD', (await page.getByText('Follow the road up to the chapel.', { exact: false }).count()) > 0);
  const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  check('no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 400));

  // a phone gets a note instead of four million triangles
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pp = await phone.newPage();
  await pp.goto(url, { waitUntil: 'load' });
  await pp.waitForTimeout(1500);
  const note = await pp.evaluate(() => (document.querySelector('.tp-fatal') ? document.querySelector('.tp-fatal').textContent : null));
  check('a phone is told to use a computer', !!note && /keyboard and a mouse/.test(note), note ? '' : 'no note');
  await pp.screenshot({ path: path.join(shots, 'p_phone.jpg'), type: 'jpeg', quality: 90 });
  await phone.close();
} catch (e) {
  bad++;
  console.log('FAILED: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  if (server) server.close();
}
console.log(bad ? `${bad} check(s) failed` : 'release page is sound');
process.exit(bad ? 1 : 0);
