/**
 * smoke-test.js — 端到端冒烟测试
 *
 * 验证三件事：
 *   1. 游戏能在浏览器里跑起来，无 JS 报错
 *   2. 渲染循环真的在推进（FPS > 0）
 *   3. MCP 工具调用能真的改变浏览器里的场景（rev 变化 + 道具数变化）
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '\x1b[38;5;114m✓' : '\x1b[38;5;204m✗'}\x1b[0m ${name}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  if (!cond) failures++;
};

/* ---- 起静态托管 ---- */
const web = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js')], { stdio: 'ignore' });
await wait(800);

/* ---- 连接 MCP Server（由 StdioClientTransport 拉起，它独占 WS :8787）---- */
const client = new Client({ name: 'smoke', version: '1.0.0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'server', 'mcp-server.js')],
  stderr: 'inherit',
}));
await wait(1200);

/* ---- 开浏览器 ---- */
const browser = await chromium.launch({
  // 允许用已有的 chromium（CHROME_PATH 环境变量），避免重复下载
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:8080/', { waitUntil: 'load' });
await wait(3500); // 等 three.js 从 CDN 拉完 + 首帧

/* ---- 1. 无报错 ---- */
// WS 首次连接失败是预期的（bridge 有自动重连），不算错误
const fatal = errors.filter((e) => !/favicon|Failed to load resource|WebSocket connection to .* failed/i.test(e));
check('页面加载无 JS 报错', fatal.length === 0, fatal.slice(0, 3).join(' | '));

/* ---- 2. 游戏对象存在 ---- */
const boot = await page.evaluate(() => {
  const g = window.__GAME__;
  if (!g) return null;
  return {
    props: g.level.props.length,
    enemies: g.enemies.length,
    revision: g.level.meta.revision,
    hp: g.player.health,
    preset: g.level.environment.preset,
  };
});
check('游戏已引导（window.__GAME__ 可用）', !!boot, boot ? `道具${boot.props} 敌人${boot.enemies} rev${boot.revision}` : '');

/* ---- 3. 开始游戏 + 渲染推进 ---- */
await page.click('#startBtn');
await wait(600);
await page.mouse.move(640, 380);
await wait(2500);

const fps = await page.evaluate(() => {
  const t = document.getElementById('fps').textContent;
  return parseInt(t, 10);
});
check('渲染循环在推进（FPS > 0）', Number.isFinite(fps) && fps > 0, `${fps} FPS (软件渲染)`);

/* ---- 4. 玩家能开枪 ---- */
await page.mouse.down();
await wait(700);
await page.mouse.up();
const shots = await page.evaluate(() => window.__GAME__.player.stats.shotsFired);
check('射击系统工作', shots > 0, `已发射 ${shots} 发`);

/* ---- 5. MCP 真正驱动了浏览器场景 ---- */
const before = await page.evaluate(() => ({
  rev: window.__GAME__.level.meta.revision,
  props: window.__GAME__.level.props.length,
  preset: window.__GAME__.level.environment.preset,
}));

await client.callTool({
  name: 'build_arena',
  arguments: { preset: 'inferno', style: 'ruins', density: 1.5, difficulty: 2 },
});
await wait(1500);

const after = await page.evaluate(() => ({
  rev: window.__GAME__.level.meta.revision,
  props: window.__GAME__.level.props.length,
  preset: window.__GAME__.level.environment.preset,
  enemies: window.__GAME__.enemies.length,
}));

check('MCP build_arena 改变了浏览器场景', after.rev !== before.rev || after.preset !== before.preset,
  `rev ${before.rev}→${after.rev} · 预设 ${before.preset}→${after.preset} · 道具 ${before.props}→${after.props} · 敌人 ${after.enemies}`);

/* ---- 6. 截图回传（给 AI 的"眼睛"）---- */
const shot = await client.callTool({ name: 'capture_viewport', arguments: {} });
const img = (shot.content || []).find((c) => c.type === 'image');
check('capture_viewport 返回真实画面', !!img, img ? `JPEG ${Math.round(img.data.length * 0.75 / 1024)}KB` : String(shot.content?.[0]?.text || '').slice(0, 80));

/* ---- 7. 自动试玩 ---- */
const pt = await client.callTool({ name: 'run_playtest', arguments: { seconds: 6 } });
const ptText = (pt.content || []).map((c) => c.text).join('');
check('run_playtest 返回指标', !pt.isError, ptText.replace(/\s+/g, ' ').slice(0, 150));

/* ---- 8. 撤销 ---- */
const undo = await client.callTool({ name: 'undo', arguments: {} });
await wait(600);
const afterUndo = await page.evaluate(() => window.__GAME__.level.meta.revision);
check('undo 生效', !undo.isError, `rev → ${afterUndo}`);

/* ---- 收尾 ---- */
await page.screenshot({ path: path.join(ROOT, 'tools', 'smoke-screenshot.png') });
await client.close();
await browser.close();
web.kill();

console.log(`\n${failures === 0 ? '\x1b[38;5;114m全部通过\x1b[0m' : `\x1b[38;5;204m${failures} 项失败\x1b[0m`}`);
process.exit(failures === 0 ? 0 : 1);
