/**
 * serve.js — 静态文件服务器（托管 game/ 目录）
 *
 * 加 --with-mcp 会同时把 MCP Server 拉起来，一条命令跑通整条链路。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'game');
const PORT = Number(process.env.PORT || 8080);
const WITH_MCP = process.argv.includes('--with-mcp');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = url === '/' ? '/index.html' : url;
  let file = path.normalize(path.join(GAME_DIR, rel));

  // 防目录穿越
  if (!file.startsWith(GAME_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🎮 游戏已就绪   →  http://127.0.0.1:${PORT}`);
  if (WITH_MCP) console.log(`  🔌 MCP Server    →  stdio · WS 桥 ws://127.0.0.1:8787`);
  else console.log(`  ⚠️  未启动 MCP Server（加 --with-mcp 启用 AI 实时编辑）`);
  console.log('');
});

if (WITH_MCP) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'mcp-server.js')], {
    stdio: ['ignore', 'ignore', 'inherit'], // stderr 打到控制台，stdout 留给 MCP 协议
  });
  const shutdown = () => { child.kill(); server.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code) => { if (code !== 0 && code !== null) console.error(`[mcp] 退出 code=${code}`); });
}
