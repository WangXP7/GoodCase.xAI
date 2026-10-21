/* 快速视觉迭代：只渲染 3 张小图（单体 / 中景 / 俯视） */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PW = process.env.PW_MOD || 'C:/Users/wxppa/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import('file:///' + PW);
const chromium = _pw.chromium || _pw.default.chromium;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = http.createServer((q, s) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html;charset=utf-8' : 'text/javascript' }); s.end(b); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const pg = await b.newPage({ viewport: { width: 900, height: 640 } });
pg.on('pageerror', e => console.log('ERR', String(e).slice(0, 200)));
await pg.goto('http://127.0.0.1:' + srv.address().port + '/index.html', { waitUntil: 'commit' });
await pg.waitForFunction(() => window.__GB && window.__GB.ready, null, { timeout: 120000 });
await pg.waitForTimeout(900);
const ev = (f, ...a) => pg.evaluate(f, ...a);
await ev(() => window.__GB.pause());

await ev(() => { const G = window.__GB; G.freeze(true); G.solo(0); G.cam({ az: 0.62, pol: 1.30, dist: 1.7, tx: 0, ty: 0.85, tz: 0 }); G.frameStep(1, 1 / 60, true); });
await pg.screenshot({ path: path.join(ROOT, '.tmp-look-solo.jpg'), type: 'jpeg', quality: 90 });
// 材质 A/B/C 对照
const base = { color: 0xff3355, transmission: 0, clearcoat: 0, envMapIntensity: 0, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.16, transparent: false, opacity: 1 };
const variants = [
  ['L-plain', { ...base }],
  ['M-glow1', { ...base }],
  ['N-alpha', { ...base, transparent: true, opacity: 0.93 }],
  ['O-clearcoat', { ...base, clearcoat: 1.0, envMapIntensity: 1.3 }],
  ['P-envonly', { ...base, envMapIntensity: 1.3 }],
];
for (const [name, o] of variants) {
  const gk = name.startsWith('M') ? 1.0 : 0.0;
  await ev(({ o, gk }) => { window.__GB.setMat(0, o); window.__GB.setGlow(0, gk); window.__GB.frameStep(1, 1/60, true); }, { o, gk });
  await pg.screenshot({ path: path.join(ROOT, '.tmp-look-' + name + '.jpg'), type: 'jpeg', quality: 90 });
}
await ev(() => { const G = window.__GB; G.showAll(); G.freeze(false); G.reset(); G.cam({ az: 0.66, pol: 1.02, dist: 4.35, tx: 0, ty: 0.22, tz: 0.05 }); G.frameStep(1, 1 / 60, true); });
await pg.screenshot({ path: path.join(ROOT, '.tmp-look-pile.jpg'), type: 'jpeg', quality: 90 });
await ev(() => { const G = window.__GB; G.cam({ az: 0.30, pol: 0.72, dist: 2.6, tx: 0, ty: 0.28, tz: 0.1 }); G.frameStep(1, 1 / 60, true); });
await pg.screenshot({ path: path.join(ROOT, '.tmp-look-top.jpg'), type: 'jpeg', quality: 90 });
console.log('ok');
await b.close(); srv.close();
