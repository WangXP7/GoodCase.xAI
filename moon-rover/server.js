/* Zero-dependency static server for REGOLITH.
   node server.js [port]                                     */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.hdr': 'image/vnd.radiance', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'
};

// Dev-only frame capture. Off unless you pass --shots; the release server
// never accepts a write of any kind.
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, '.shots');

const server = http.createServer((req, res) => {
  if (SHOTS && req.method === 'POST' && req.url.startsWith('/__shot')) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 400e6) req.destroy(); });
    req.on('end', () => {
      try {
        const q = new URL(req.url, 'http://x').searchParams;
        const name = (q.get('n') || 'shot').replace(/[^\w.-]/g, '');
        const ext = (q.get('ext') || 'png').replace(/[^\w]/g, '');
        const b64 = body.replace(/^data:[\w/+.-]+;base64,/, '');
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        fs.writeFileSync(path.join(SHOT_DIR, `${name}.${ext}`), Buffer.from(b64, 'base64'));
        res.writeHead(200).end('ok');
      } catch (e) { res.writeHead(500).end(String(e)); }
    });
    return;
  }

  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 — not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      // COOP/COEP left off deliberately: nothing here needs SharedArrayBuffer.
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  REGOLITH — The Silence at Anaxagoras`);
  console.log(`  running at  http://localhost:${PORT}\n`);
});
