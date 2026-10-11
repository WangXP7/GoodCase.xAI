/**
 * 截图工具：抓取原型画面。
 *   用法：node tests/prototype/shot.mjs [pad|maxq]
 *     pad  —— 待机画面（常驻 HUD 基准外观）
 *     maxq —— 快进到 T+18s（Max-Q 附近）的画面，用于查看「配平代价」模块
 *
 * 飞行态通过"按住 Space + 同步快进 sim.update"获得，不依赖真实等待 18 秒。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 8766, CDP = 9334;
const MODE = process.argv[2] || 'pad';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) { console.error('未找到浏览器'); process.exit(1); }

const profile = join(tmpdir(), 'rocket-shot-profile');
try { rmSync(profile, { recursive: true, force: true }); } catch {}
mkdirSync(profile, { recursive: true });
const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch {} } try { rmSync(profile, { recursive: true, force: true }); } catch {} });

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'src')], { stdio: 'ignore' });
procs.push(server);
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--window-size=1920,1080',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
procs.push(browser);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(250); }
  throw new Error('CDP 超时 ' + url);
}

const tabs = await waitJson(`http://127.0.0.1:${CDP}/json/list`);
const tab = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(4600);   // 等 boot-hint 淡出

if (MODE === 'maxq') {
  // 按住 Space → 松绑；再同步快进到 T+18s（Max-Q 附近）
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await sleep(900);
  await ev(`(() => {
    const sim = window.__RLS__.Game.sim;
    sim.skippable = true; sim.autoProgram = true; sim.autoStage = true;
    sim.setInput({ launch: true });
    let n = 0;
    while (sim.outcome === null && sim.fm.t < 18 && n < 120*40) { sim.update(1/120); n++; }
    return sim.fm.t;
  })()`);
  await sleep(200);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(HERE, `shot-${MODE}.png`), Buffer.from(shot.result.data, 'base64'));
console.log('saved shot-' + MODE + '.png');
ws.close();
process.exit(0);
