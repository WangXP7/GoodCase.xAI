// 逐帧烘焙：把 index.html 的确定性时间轴渲染成 PNG 序列
// 用法： node tools/render.mjs [from] [to]   （默认 0 1200）
// 依赖： playwright（npm i -g playwright / 本地安装均可）
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

// 允许通过 PLAYWRIGHT_HOME 指向已安装 playwright 的目录（package.json 所在处）
const requireFrom = process.env.PLAYWRIGHT_HOME
  ? createRequire(path.join(process.env.PLAYWRIGHT_HOME, 'package.json'))
  : createRequire(import.meta.url);
const { chromium } = requireFrom('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FPS = Number(process.env.FPS || 30);
const DURATION = 40;
const TOTAL = Math.round(FPS * DURATION);
const from = Number(process.argv[2] || 0);
const to = Number(process.argv[3] || TOTAL);
const outDir = path.join(ROOT, 'frames');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none',
         '--disable-quic', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?t=0&export=1',
  { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

const grab = t => page.evaluate(tt => {
  window.__seek(tt);
  return document.getElementById('cv').toDataURL('image/png');
}, t);

const t0 = Date.now();
for (let i = from; i < to; i++) {
  const b64 = await grab(i / FPS);
  fs.writeFileSync(path.join(outDir, `f${String(i).padStart(5, '0')}.png`),
    Buffer.from(b64.slice(b64.indexOf(',') + 1), 'base64'));
  if (i % 60 === 0 || i === to - 1) {
    const el = (Date.now() - t0) / 1000;
    const done = i - from + 1;
    console.log(`frame ${i}/${to - 1}  t=${(i / FPS).toFixed(2)}s  ` +
      `${(done / el).toFixed(1)} fps  eta ${(el / done * (to - from - done)).toFixed(0)}s`);
  }
}
await browser.close();
console.log(`DONE ${to - from} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
