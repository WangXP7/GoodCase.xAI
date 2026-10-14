/**
 * run-demo.js — 完整演示：对话式从零建一个可玩射击关卡
 *
 * 这个脚本复现的就是腾讯 Demo 里 Hy4 preview 干的那件事：
 *   Agent ──MCP──▶ 引擎 ──▶ 环境美术 / 关卡布局 / 玩家玩法 / 自动试玩
 *
 * 与 demo-agent.js 的区别：这里同时起真实浏览器，每走一步就截图存证，
 * 于是"AI 到底改了什么"变成一组肉眼可见的对比图，而不是一句自述。
 *
 * 运行：node tools/run-demo.js
 * 产出：demo/01…NN.png + demo/final-level.json
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  amber: '\x1b[38;5;215m', orange: '\x1b[38;5;209m', gray: '\x1b[38;5;244m',
  green: '\x1b[38;5;114m', red: '\x1b[38;5;204m', cyan: '\x1b[38;5;110m',
};
const say = (who, text, color = C.amber) => console.log(`${color}${who}${C.reset} ${C.dim}│${C.reset} ${text}`);
const brief = (v, max = 200) => {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/* ---------------- 起环境 ---------------- */
const web = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js')], { stdio: 'ignore' });
await wait(700);

const mcp = new Client({ name: 'demo', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(new StdioClientTransport({
  command: process.execPath, args: [path.join(ROOT, 'server', 'mcp-server.js')], stderr: 'ignore',
}));
await wait(900);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error(`${C.red}[page error]${C.reset}`, e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error(`${C.red}[console.error]${C.reset}`, m.text()); });
await page.goto('http://127.0.0.1:8080/?autostart=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME__, null, { timeout: 20000 });
await wait(1500);

let shotSeq = 0;
const shots = [];

/** 截当前画面存盘，返回文件名 */
async function capture(tag) {
  const r = await mcp.callTool({ name: 'capture_viewport', arguments: {} });
  const img = (r.content || []).find((c) => c.type === 'image');
  if (!img) {
    console.error(`${C.red}截图失败：${C.reset}${(r.content || []).map((c) => c.text).join(' ')}`);
    return null;
  }
  shotSeq += 1;
  const name = `${String(shotSeq).padStart(2, '0')}-${tag}.png`;
  fs.writeFileSync(path.join(OUT, name), Buffer.from(img.data, 'base64'));
  shots.push(name);
  console.log(`${C.gray}        ↳ 截图 demo/${name}${C.reset}`);
  return name;
}

/** 走一步：先说意图，再调工具，可选截图 */
async function step(intent, toolName, args, opts = {}) {
  say('意图', intent, C.cyan);
  say('调用', `${toolName} ${C.dim}${brief(args, 150)}${C.reset}`, C.amber);
  const t0 = Date.now();
  let r;
  try {
    r = await mcp.callTool({ name: toolName, arguments: args ?? {} });
  } catch (e) {
    say('结果', `${C.red}✗ 抛出异常 ${e.message}${C.reset}`, C.gray);
    return null;
  }
  const ms = Date.now() - t0;
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const tag = r.isError ? `${C.red}✗` : `${C.green}✓`;
  const clean = text.replace(/\s*\n\s*/g, ' ').replace(/[{}"]/g, '');
  say('结果', `${tag}${C.reset} ${brief(clean, 260)} ${C.dim}(${ms}ms)${C.reset}`, C.gray);
  if (opts.shot) await capture(opts.shot);
  console.log('');
  return r;
}

/* ================================================================== *
 *  对话脚本
 * ================================================================== */

console.log(`\n${C.bold}${C.orange}◤ NEXUS BREACH · 对话式建关全流程 ◢${C.reset}\n`);

await step('先摸清引擎暴露了哪些能力，避免瞎调参数。', 'list_capabilities', {});

await step('记录修改前的基线画面。', 'set_viewpoint',
  { position: [-40, 10, -40], yaw: -2.356, pitch: -0.11, fov: 75, spectate: true }, { shot: 'baseline' });

await step('看一眼当前关卡的机体数据。', 'get_level', {});

await step('清空场地，我要从零搭，不在旧关卡上打补丁。', 'clear_actors', { props: true, enemies: true });

await step(
  '一句话生成完整关卡：夜间 + 工业港区风格 + 掩体密度 1.3 + 难度 1.4。',
  'build_arena',
  { preset: 'night', style: 'industrial', density: 1.3, difficulty: 1.4 },
  { shot: 'arena-generated' },
);

await step(
  '场地中央太空，玩家没有推进路线。在中心外围摆一圈集装箱当掩体，全部朝向场地中心。',
  'place_props',
  { type: 'container', pattern: 'ring', count: 10, radius: 22, faceCenter: true, colors: ['#6b4a2f', '#2f5a6b', '#5a2f3f'], jitter: 1.5 },
  { shot: 'ring-cover' },
);

await step(
  '再补两处高台和上坡道，给玩家和狙击手制造垂直空间。',
  'place_props',
  {
    props: [
      { type: 'platform', position: [-18, 0.5, -18], scale: [1.5, 1.4, 1.5], color: '#414a58' },
      { type: 'platform', position: [18, 0.5, 18], scale: [1.5, 1.4, 1.5], color: '#414a58' },
      { type: 'ramp', position: [-11, 0.9, -18], rotation: [0, -Math.PI / 2, 0], color: '#4a5462' },
      { type: 'ramp', position: [11, 0.9, 18], rotation: [0, Math.PI / 2, 0], color: '#4a5462' },
    ],
  },
);

await step(
  '在两块高台上放狙击手，逼玩家必须优先处理高处威胁。',
  'spawn_enemies',
  { enemies: [{ type: 'sniper', position: [-18, 0, -18] }, { type: 'sniper', position: [18, 0, 18] }] },
);

await step(
  '外圈补一波散兵：突击兵冲脸、步兵在外围压制。',
  'spawn_enemies',
  { pattern: 'ring', count: 9, radius: 36, types: ['rusher', 'grunt', 'grunt'], jitter: 4, seed: 77 },
  { shot: 'enemies-placed' },
);

await step(
  '调手感：默认射速偏慢、弹匣偏小。改成更爽快的高节奏，同时提高敌人开火频率制造压迫感。',
  'set_gameplay',
  {
    player: { fireRate: 0.085, magazine: 36, damage: 30, reloadTime: 1.35, moveSpeed: 7.8, headshotMultiplier: 2.4 },
    enemies: { aggression: 0.85, visionRange: 78 },
    waves: { count: 5, perWaveBase: 6, perWaveGrowth: 2, delay: 3.5 },
  },
);

await step('关键一步：启动模拟。之前场景是静止的，只有跑起来才能验证玩法。', 'start_simulation', {});

await step(
  '雾太浓看不清远处高台。降雾、压低太阳制造地平线光、抬环境光避免全黑。',
  'set_environment',
  { preset: 'night', fogDensity: 0.013, sunElevation: 9, sunIntensity: 0.95, ambientIntensity: 1.25, bloom: 0.8, exposure: 1.35 },
  { shot: 'env-tuned' },
);

await step(
  '换个机位检查垂直空间是否真的可用 —— 从高台高度回看场地。',
  'set_viewpoint',
  { position: [-18, 7, -30], yaw: 2.9, pitch: -0.18, fov: 75, spectate: true },
  { shot: 'vertical-check' },
);

await step('切回第一人称，贴近地面看掩体尺度对不对。', 'set_viewpoint',
  { position: [0, 1.75, 30], yaw: 0, pitch: 0, fov: 78, spectate: false },
  { shot: 'first-person' });

await step(
  '跑 10 秒自动试玩，用数据判断难度到底合不合理 —— 光看画面判断不了手感。',
  'run_playtest',
  { seconds: 10 },
);

await step('读实时遥测，确认帧率和战场状态。', 'get_telemetry', {});

await step('存盘，把这套关卡固化成可复现的资产。', 'save_level', { name: 'night-industrial-harbor' });

// 导出最终关卡 JSON 到演示目录
const lvl = await mcp.callTool({ name: 'get_level', arguments: { includeProps: true } });
const lvlText = (lvl.content || []).find((c) => c.type === 'text')?.text || '{}';
try {
  fs.writeFileSync(path.join(OUT, 'final-level.json'), JSON.stringify(JSON.parse(lvlText), null, 2));
} catch { /* 忽略 */ }

console.log(`${C.bold}${C.green}✓ 演示完成${C.reset}`);
console.log(`${C.dim}产出：demo/ 下 ${shots.length} 张过程截图 + final-level.json${C.reset}\n`);

await browser.close();
mcp.close();
web.kill();
process.exit(0);
