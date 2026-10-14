/** diag.js — 诊断 set_viewpoint / 环境预设是否真的生效 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const web = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js')], { stdio: 'ignore' });
await wait(700);
const mcp = new Client({ name: 'diag', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(new StdioClientTransport({
  command: process.execPath, args: [path.join(ROOT, 'server', 'mcp-server.js')], stderr: 'ignore',
}));
await wait(900);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('[page error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
await page.goto('http://127.0.0.1:8080/?autostart=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME__, null, { timeout: 20000 });
await wait(2000);

const call = async (n, a) => {
  const r = await mcp.callTool({ name: n, arguments: a ?? {} });
  const t = r.content?.find((c) => c.type === 'text')?.text ?? '';
  console.log(`\n$ ${n} ${JSON.stringify(a ?? {})}\n${t.slice(0, 320)}`);
  return r;
};

const probe = async (tag) => {
  const s = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player;
    return {
      pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      spectate: p.spectate, fov: p.camera.fov,
      camPos: [+p.camera.position.x.toFixed(2), +p.camera.position.y.toFixed(2), +p.camera.position.z.toFixed(2)],
      camRot: [+p.camera.rotation.x.toFixed(3), +p.camera.rotation.y.toFixed(3)],
      envPreset: g.level.environment.preset,
      groundColor: g.level.environment.groundColor,
      sunInt: g.level.environment.sunIntensity,
      exposure: g.level.environment.exposure,
      props: g.level.props.length,
      rev: g.level.meta.revision,
    };
  });
  console.log(`\n--- ${tag} ---\n`, JSON.stringify(s));
  return s;
};

await probe('初始');
await call('set_viewpoint', { position: [0, 62, 78], yaw: Math.PI, pitch: -0.72, fov: 60, spectate: true });
await wait(2500);
await probe('set_viewpoint 之后');

await call('set_environment', { preset: 'night' });
await wait(2500);
await probe('set_environment(night) 之后');

await browser.close(); mcp.close(); web.kill();
process.exit(0);
