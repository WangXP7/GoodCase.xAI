/**
 * gallery.js — 视觉验证 & 出图工具
 *
 * 用 Playwright 打开真实浏览器，通过 MCP 工具调用改造场景，
 * 在多个机位截图，产出 shots/*.png。
 *
 * 用法：
 *   node tools/gallery.js                 # 默认机位组
 *   node tools/gallery.js --only dusk,night
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
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const argOnly = process.argv.find((a) => a.startsWith('--only='));
const ONLY = argOnly ? argOnly.split('=')[1].split(',') : null;

/* ---------------- 机位表 ----------------
 * pos  [x, y, z]  玩家位置
 * yaw  朝向（弧度，0=+Z，PI/2=+X）
 * pitch 俯仰（正=抬头）
 */
/**
 * 由「机位 + 注视目标」算出 yaw/pitch。
 * 手写弧度极易搞反（我第一版就写反了，镜头全对着场外），交给公式算最稳。
 * Three.js 相机默认朝 -Z，绕 Y 转 yaw 后的前向 = (-sin yaw, 0, -cos yaw)。
 */
function lookAt(pos, target) {
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  return { yaw: Math.atan2(-nx, -nz), pitch: Math.asin(Math.max(-1, Math.min(1, ny))) };
}

const ORIGIN = [0, 1.2, 0];

/** 机位表：pos 站位，look 注视点。preset=true 时用美术预设色 */
const RAW_SHOTS = [
  // 俯瞰审布局用正午（雾最薄），否则浓雾会把整个关卡糊掉，看不出设计
  { id: 'aerial',  preset: 'noon',    pos: [0, 30, 58],   look: [0, 0, -4],     fov: 70, label: '俯瞰 · 关卡布局' },
  // 主视角站在场地内西南侧、略高于围墙，朝东北看。
  // 站到 [-40,10,-40] 会正好卡在围墙夹角里，近处两堵墙直接糊住半个画面；
  // 而黄昏的太阳在方位角 135°，北墙与东墙的内侧面才是受光面，得朝那个方向看。
  { id: 'dusk',    preset: 'dusk',    pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '黄昏 · 主视角' },
  { id: 'noon',    preset: 'noon',    pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '正午 · 主视角' },
  { id: 'night',   preset: 'night',   pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '夜间 · 霓虹' },
  { id: 'toxic',   preset: 'toxic',   pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '毒雾 · 主视角' },
  { id: 'snow',    preset: 'snow',    pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '雪原 · 主视角' },
  { id: 'inferno', preset: 'inferno', pos: [-30, 9, 33],  look: ORIGIN,        fov: 75, label: '火狱 · 主视角' },
  // 逆光机位：镜头对着太阳，用来检验剪影与大气光晕
  { id: 'sun',     preset: 'dusk',    pos: [38, 6, -34],  look: [-30, 22, 30],  fov: 72, label: '逆光 · 日落' },
  { id: 'ground',  preset: 'dusk',    pos: [0, 1.75, 34],  look: [0, 2.5, 0],   fov: 78, spectate: false, label: '第一人称 · 地面' },
  { id: 'close',   preset: 'dusk',    pos: [-22, 3.4, -6], look: [-14, 1.5, -18], fov: 62, label: '近景 · 掩体细节' },
];

const SHOTS = RAW_SHOTS.map((s) => ({ ...s, ...lookAt(s.pos, s.look) }));

/* ---------------- 起环境 ---------------- */
const web = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js')], { stdio: 'ignore' });
await wait(700);

const mcp = new Client({ name: 'gallery', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'server', 'mcp-server.js')],
  stderr: 'ignore',
}));
await wait(900);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('\x1b[38;5;204m[page error]\x1b[0m', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.error(`\x1b[2m[console.${m.type()}]\x1b[0m ${m.text()}`);
});
await page.goto('http://127.0.0.1:8080/?autostart=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME__, null, { timeout: 20000 });
await wait(1200); // 等桥接握手

const call = async (name, args) => {
  const r = await mcp.callTool({ name, arguments: args ?? {} });
  const txt = r.content?.find((c) => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(`${name}: ${txt}`);
  return txt;
};

const shoot = async (shot) => {
  // 全程走 MCP 协议 —— 不碰页面内部状态，和真实 Agent 的操作路径完全一致
  await call('start_simulation');                       // 先确保模拟在跑
  await call('set_environment', { preset: shot.preset });
  await call('set_viewpoint', {
    position: shot.pos, yaw: shot.yaw, pitch: shot.pitch,
    fov: shot.fov ?? 75, spectate: shot.spectate !== false,
  });
  await wait(2800); // 等场景重建 + 阴影贴图 + 帧稳定

  // 用 MCP 的 capture 拿游戏内渲染画面（而不是 Playwright 的页面截图）
  const r = await mcp.callTool({ name: 'capture_viewport', arguments: {} });
  const img = r.content?.find((c) => c.type === 'image');
  if (!img) throw new Error(`capture 未返回图像：${JSON.stringify(r.content)}`);

  const file = path.join(OUT, `${shot.id}.png`);
  const buf = Buffer.from(img.data, 'base64');
  fs.writeFileSync(file, buf);
  console.log(`  ✓ ${shot.id.padEnd(9)} ${shot.label.padEnd(20)} → shots/${shot.id}.png  ${(buf.length / 1024).toFixed(0)}KB`);
  return file;
};

const list = ONLY ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;
console.log(`\n取景 ${list.length} 张\n`);
for (const s of list) await shoot(s);

await browser.close();
mcp.close();
web.kill();
console.log('\n完成。\n');
process.exit(0);
