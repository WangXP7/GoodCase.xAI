/**
 * 浏览器冒烟测试（零 npm 依赖）
 *
 * 用系统 Edge/Chrome 的 DevTools Protocol（Node 22 内置 WebSocket）验证：
 *   ① 无控制台报错 / 未捕获异常 / 资源加载失败
 *   ② Phaser 两个场景都创建成功、每帧在跑
 *   ③ 真实键鼠输入能驱动 5 个动词（Space 充能 → 倒计时）
 *   ④ 同一份 core 在浏览器里跑完开环弹道并入轨（与 Node 结果一致）
 *   ⑤ 截图留证
 *
 * 用法：node tests/prototype/browser-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 8765;
const CDP = 9333;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browserPath) { console.error('未找到 Edge/Chrome，跳过浏览器冒烟测试'); process.exit(0); }

// 临时 profile 落在系统 temp，绝不污染仓库（避免 tests/ 下出现一堆浏览器缓存）
const profile = join(tmpdir(), 'rocket-smoke-profile');
try { rmSync(profile, { recursive: true, force: true }); } catch {}
mkdirSync(profile, { recursive: true });

const procs = [];
function cleanup() {
  for (const p of procs) { try { p.kill(); } catch {} }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);

// ── 静态服务器 ──
const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'src')],
  { stdio: 'ignore' });
procs.push(server);

// ── 浏览器 ──
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--window-size=1920,1080',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
procs.push(browser);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForUrl(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪: ' + url);
}

// ── 极简 CDP 客户端 ──
class CDPClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDPClient(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) { for (const h of c.handlers) h(msg); }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(fn) { this.handlers.push(fn); }
}

const errors = [];
const logs = [];
let server_url = '';

(async () => {
  await waitForUrl(`http://127.0.0.1:${CDP}/json/version`);
  const targets = await waitForUrl(`http://127.0.0.1:${CDP}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDPClient.connect(page.webSocketDebuggerUrl);

  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception ? d.exception.description : d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const txt = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`[${msg.params.type}] ${txt}`);
      if (msg.params.type === 'error') errors.push('CONSOLE.ERROR: ' + txt);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
      if (e.level === 'error') errors.push('LOG.ERROR: ' + e.text + ' ' + (e.url || ''));
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  server_url = `http://127.0.0.1:${PORT}/index.html`;
  await cdp.send('Page.navigate', { url: server_url });
  await sleep(3500);

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  const checks = [];
  const ok = (n, c, d = '') => { checks.push([n, !!c, d]); };

  // ① 场景
  const scenes = await evalJs(`JSON.stringify((window.__ROCKET_GAME__||{scene:{scenes:[]}}).scene.scenes.map(s=>({k:s.scene.key,a:s.scene.isActive()})))`);
  const sc = JSON.parse(scenes);
  ok('WorldScene 已激活', sc.some((s) => s.k === 'WorldScene' && s.a), scenes);
  ok('HudScene 已激活', sc.some((s) => s.k === 'HudScene' && s.a), scenes);
  ok('Phaser 渲染器就绪', await evalJs(`!!(window.__ROCKET_GAME__ && window.__ROCKET_GAME__.renderer)`), '');

  // ② 真实键盘输入：按住 Space → 进入 CHARGING → COUNTDOWN
  async function key(type, key, code, keyCode) {
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
  await key('keyDown', ' ', 'Space', 32);
  await sleep(2600);
  const phase1 = await evalJs(`window.__RLS__.Game.sim.seq.phase`);
  ok('按住 Space 进入倒计时/充能', phase1 === 'COUNTDOWN' || phase1 === 'CHARGING', phase1);

  // 5 动词键位不报错
  await key('keyDown', 'w', 'KeyW', 87); await sleep(120); await key('keyUp', 'w', 'KeyW', 87);
  await key('keyDown', 'a', 'KeyA', 65); await sleep(120); await key('keyUp', 'a', 'KeyA', 65);
  await key('keyDown', 'Shift', 'ShiftLeft', 16); await sleep(120); await key('keyUp', 'Shift', 'ShiftLeft', 16);
  ok('5 动词键位事件无异常', errors.length === 0, `${errors.length} errors`);

  // ③ 浏览器内跑完开环弹道（与 Node 同源内核）
  const flight = await evalJs(`(() => {
    const sim = window.__RLS__.Game.sim;
    sim.autoProgram = true; sim.autoStage = true;
    sim.setInput({ launch: true });
    let n = 0;
    while (sim.outcome === null && n < 24000) { sim.update(1/120); n++; }
    const o = sim.orbit.get();
    return JSON.stringify({
      outcome: sim.outcome, judgement: sim.judge.result,
      t: sim.fm.t, periKm: o.periapsis/1000, apoKm: Number.isFinite(o.apoapsis)? o.apoapsis/1000 : 'inf',
      omega: sim.hudModel().omegaPct, maxQkPa: sim.atmo.qMax/1000, source: sim.hudModel().omegaSource
    });
  })()`);
  const F = JSON.parse(flight);
  ok('浏览器内核跑完并入轨', F.outcome === 'SUCCESS', JSON.stringify(F));
  ok('浏览器结果与 Node 一致（时长 ±2s / 近地点 ±0.5km）',
    Math.abs(F.t - 81.0) <= 2 && Math.abs(F.periKm - 15.09) <= 0.5, `t=${F.t && F.t.toFixed(2)} peri=${F.periKm && F.periKm.toFixed(2)}`);

  // ④ Ω 双模态在 HUD 上真实切换过
  ok('Ω 模态 B 曾激活', F.source === 'B', F.source);

  await sleep(1200);   // 让场景渲染结算面板
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(HERE, 'browser-screenshot.png');
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  // 报告
  console.log('\n═══ 浏览器冒烟测试 ═══');
  let pass = 0;
  for (const [n, c, d] of checks) { console.log(`  ${c ? '✅' : '❌'} ${n}${d ? '  · ' + d : ''}`); if (c) pass++; }
  console.log(`\n  控制台错误：${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('    ' + e);
  console.log(`  截图：tests/prototype/browser-screenshot.png`);
  console.log(`\n  ${pass}/${checks.length} 通过${errors.length === 0 ? ' · 无控制台报错 ✅' : ' · 存在控制台报错 ❌'}`);

  cleanup();
  process.exit(pass === checks.length && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('冒烟测试失败：', e.message);
  if (logs.length) { console.error('--- 最近日志 ---'); for (const l of logs.slice(-20)) console.error('  ' + l); }
  cleanup();
  process.exit(1);
});
