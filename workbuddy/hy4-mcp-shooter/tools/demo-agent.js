/**
 * demo-agent.js — 演示用 Agent（MCP 客户端）
 *
 * 这个文件模拟的就是 Hy4 preview 在 demo 里干的事：
 * 通过 MCP 协议连上引擎，用自然语言意图 → 一串工具调用 → 从零搭出一个可玩关卡。
 *
 * 这里"意图"是硬编码的脚本，但换成真的大模型，脚本部分就是模型的输出。
 * 关键区别：模型不需要写一行游戏代码，它只是在调工具。
 *
 * 运行：node tools/demo-agent.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  amber: '\x1b[38;5;215m', orange: '\x1b[38;5;209m', gray: '\x1b[38;5;244m',
  green: '\x1b[38;5;114m', red: '\x1b[38;5;204m', cyan: '\x1b[38;5;110m',
};

const say = (who, text, color = C.amber) =>
  console.log(`${color}${who}${C.reset} ${C.dim}│${C.reset} ${text}`);

function brief(v, max = 220) {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* ------------------------------------------------------------------ */

const client = new Client({ name: 'demo-agent', version: '1.0.0' }, { capabilities: {} });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'server', 'mcp-server.js')],
  stderr: 'inherit',
});

await client.connect(transport);

const tools = await client.listTools();
console.log(`\n${C.bold}${C.orange}◤ NEXUS BREACH · MCP 引擎桥 ◢${C.reset}`);
console.log(`${C.gray}已连接，引擎暴露 ${tools.tools.length} 个工具${C.reset}`);
const names = tools.tools.map((t) => t.name);
console.log(`${C.dim}${names.join('  ')}${C.reset}\n`);

/** 执行一步：先说人话（意图），再调工具 */
async function step(intent, toolName, args) {
  say('意图', intent, C.cyan);
  say('调用', `${toolName} ${C.dim}${brief(args, 160)}${C.reset}`, C.amber);

  const t0 = Date.now();
  const r = await client.callTool({ name: toolName, arguments: args });
  const ms = Date.now() - t0;

  const isError = r.isError;
  const text = (r.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const hasImage = (r.content || []).some((c) => c.type === 'image');

  const tag = isError ? `${C.red}✗` : `${C.green}✓`;
  say('结果', `${tag} ${C.reset}${brief(text.replace(/\n\s*/g, ' '), 300)}${hasImage ? ` ${C.orange}[含截图]` : ''} ${C.dim}(${ms}ms)${C.reset}`, C.gray);
  console.log('');
  return r;
}

/* ================================================================== *
 *  脚本：从零搭一个"夜间工业港区"射击关卡
 * ================================================================== */

await step(
  '先摸清这台引擎能干什么，别瞎调参数。',
  'list_capabilities',
  {},
);

await step(
  '看一下当前关卡长什么样，作为修改前的基线。',
  'get_level',
  {},
);

await step(
  '清空场地。我要从零搭，不希望在旧关卡上打补丁。',
  'clear_actors',
  { props: true, enemies: true },
);

await step(
  '核心一步：一句话生成完整关卡。夜间 + 工业港区 + 掩体密度 1.3 + 难度 1.4。',
  'build_arena',
  { preset: 'night', style: 'industrial', density: 1.3, difficulty: 1.4 },
);

await step(
  '场地中央太空了，玩家没有推进路线。在中心外围摆一圈集装箱作掩体，都朝向中心。',
  'place_props',
  { type: 'container', pattern: 'ring', count: 10, radius: 22, faceCenter: true, colors: ['#6b4a2f', '#2f5a6b', '#5a2f3f'], jitter: 1.5 },
);

await step(
  '再补两处高台和一条上坡，给狙击手和玩家提供垂直空间。',
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
  '在两块高台上放狙击手，制造"必须优先处理高价值目标"的压力。',
  'spawn_enemies',
  {
    enemies: [
      { type: 'sniper', position: [-18, 0, -18] },
      { type: 'sniper', position: [18, 0, 18] },
    ],
  },
);

await step(
  '外围补一波散兵：近战突击兵冲脸，步兵在外圈压制。',
  'spawn_enemies',
  { pattern: 'ring', count: 9, radius: 36, types: ['rusher', 'grunt', 'grunt'], jitter: 4, seed: 77 },
);

await step(
  '现在调手感。默认射速偏慢、弹匣偏小，改成更爽快的高节奏；敌人开火频率调高一点增加压迫感。',
  'set_gameplay',
  {
    player: { fireRate: 0.085, magazine: 36, damage: 30, reloadTime: 1.35, moveSpeed: 7.8, headshotMultiplier: 2.4 },
    enemies: { aggression: 0.85, visionRange: 78 },
    waves: { count: 5, perWaveBase: 6, perWaveGrowth: 2, delay: 3.5 },
  },
);

await step(
  '看一下画面效果对不对 —— 相当于给自己装个眼睛。',
  'capture_viewport',
  {},
);

await step(
  '雾太浓了，看不清远处的高台。降低雾浓度、把太阳压低制造更强的地平线光，同时提高环境光避免全黑。',
  'set_environment',
  { preset: 'night', fogDensity: 0.014, sunElevation: 7, sunIntensity: 0.85, ambientIntensity: 0.85, bloom: 1.25, exposure: 1.4 },
);

await step(
  '再截一次确认改动生效。',
  'capture_viewport',
  {},
);

await step(
  '跑一次自动化试玩，用数据判断难度合不合理 —— 光看画面判断不了手感。',
  'run_playtest',
  { seconds: 10 },
);

await step(
  '读一下实时遥测，确认帧率没问题。',
  'get_telemetry',
  {},
);

await step(
  '满意了，存盘。',
  'save_level',
  { name: 'night-industrial-harbor' },
);

console.log(`${C.bold}${C.green}✓ 关卡构建完成${C.reset}`);
console.log(`${C.dim}提示：capture_viewport / run_playtest 需要浏览器打开 http://127.0.0.1:8080 才会返回真实数据。${C.reset}\n`);

await client.close();
process.exit(0);
