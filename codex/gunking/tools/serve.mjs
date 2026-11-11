import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8765);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
const server = http.createServer((req, res) => {
  try {
    let part = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (part.endsWith('/')) part += 'index.html';
    const file = path.resolve(root, '.' + part);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400).end('Bad request'); }
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Set PORT to another value.` : e.message); process.exitCode=1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`GunKing: ${url}\nPress Ctrl+C to stop.`);
  if (process.argv.includes('--open')) spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {windowsHide:true, stdio:'ignore'}).unref();
});
