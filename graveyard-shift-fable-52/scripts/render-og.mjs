// Renders the link-preview image (Open Graph / X card): assets/keyart/og.jpg, 1200x630, the key art with the
// wordmark composited in. Run it again whenever the wordmark or the art changes:  node scripts/render-og.mjs
// The wordmark is taken from src/index.html (the .ld-top block of the loading screen) and styled by
// src/ui/loading.css, so the preview always matches the loading screen. Fonts: wordmark.js's FONT_URL (needs network).
// Writes a throwaway page under $TMPDIR, screenshots it in the repo's Playwright Chromium (no server), closes it.
// Options: --quality <jpeg q, default 82>  --out <path, default assets/keyart/og.jpg>
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = resolve(root, arg('out', 'assets/keyart/og.jpg'));
const quality = Number(arg('quality', 82));
const MAX_BYTES = 300 * 1024;

const html = readFileSync(join(root, 'src/index.html'), 'utf8');
const top = html.match(/<div class="ld-top">[\s\S]*?<\/p>\s*<\/div>/);
if (!top) throw new Error('render-og: no <div class="ld-top"> (wordmark + tagline) block in src/index.html');
const font = readFileSync(join(root, 'src/ui/wordmark.js'), 'utf8').match(/FONT_URL\s*=\s*'([^']+)'/);
const fontLink = font ? `<link rel="stylesheet" href="${font[1]}">` : '';
const file = (p) => pathToFileURL(join(root, p)).href;

const page = `<!doctype html><html><head><meta charset="utf-8">${fontLink}
<link rel="stylesheet" href="${file('src/ui/wordmark.css')}">
<link rel="stylesheet" href="${file('src/ui/loading.css')}">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #05070a; overflow: hidden; }
  #boot { --u: calc(630px / 1080); --m: 46px; --wm-size: 54px; }
  #boot .ld-art { inset: 0; }
  #boot .ld-art img { opacity: 1; animation: none; object-position: 50% 46%; }
  #boot .ld-tag { font-size: 15px; margin-top: 16px; max-width: 24em; }
  #boot .ld-shade { background:
    radial-gradient(110% 95% at 0% 0%, rgba(5, 7, 10, .86) 0%, rgba(5, 7, 10, .5) 40%, rgba(5, 7, 10, 0) 66%),
    linear-gradient(to top, rgba(5, 7, 10, .7) 0%, rgba(5, 7, 10, 0) 26%); }
  .url { position: absolute; left: 46px; bottom: 34px; font: 600 15px/1 'Overpass', 'Helvetica Neue', Arial, sans-serif; letter-spacing: .12em;
         text-transform: uppercase; color: #ece6d6; opacity: .85; text-shadow: 0 1px 2px #000; }
  .url b { color: #ff4a3d; font-weight: 500; }
</style></head><body>
<div id="boot">
  <div class="ld-art"><img src="${file('assets/keyart/keyart-01.png')}" alt=""></div>
  <div class="ld-shade"></div>
  ${top[0]}
  <div class="url"><b>Play free</b> &nbsp;zombies.ethanplus.ai</div>
</div></body></html>`;

const dir = join(process.env.TMPDIR || tmpdir(), 'graveyard-shift', 'render-og');
mkdirSync(dir, { recursive: true });
const pagePath = join(dir, 'og.html');
writeFileSync(pagePath, page);

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto(pathToFileURL(pagePath).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await p.screenshot({ path: out, type: 'jpeg', quality });
} finally {
  await browser.close();
}
const bytes = statSync(out).size;
console.log(`[render-og] ${out} ${(bytes / 1024).toFixed(0)} KB (q${quality})`);
if (bytes > MAX_BYTES) { console.error(`[render-og] over ${MAX_BYTES} bytes: lower --quality`); process.exit(1); }
