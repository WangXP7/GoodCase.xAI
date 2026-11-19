// Tiny static dev server.
//   node tools/dev-server.mjs [port]
// Serves the project root with no caching, and accepts canvas captures:
//   POST /__shot?name=foo   (body: image bytes or a data URL)  ->  shots/foo.jpg|png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(root, 'shots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/__shot') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        let buf = Buffer.concat(chunks);
        let ext = 'jpg';
        const head = buf.subarray(0, 32).toString('latin1');
        if (head.startsWith('data:')) {
          const s = buf.toString('latin1');
          const comma = s.indexOf(',');
          if (s.slice(0, comma).includes('image/png')) ext = 'png';
          buf = Buffer.from(s.slice(comma + 1), 'base64');
        } else if (buf[0] === 0x89 && buf[1] === 0x50) {
          ext = 'png';
        }
        const name = (url.searchParams.get('name') || 'shot').replace(/[^a-zA-Z0-9_\-]/g, '_');
        fs.mkdirSync(shotsDir, { recursive: true });
        const file = path.join(shotsDir, `${name}.${ext}`);
        fs.writeFileSync(file, buf);
        send(res, 200, JSON.stringify({ ok: true, file, bytes: buf.length }), MIME['.json']);
      } catch (e) {
        send(res, 500, String(e));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/__save') {
    // Save arbitrary text/binary output from dev pages (audio renders, reports).
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const name = (url.searchParams.get('name') || 'out.bin').replace(/[^a-zA-Z0-9_.\-]/g, '_');
        fs.mkdirSync(shotsDir, { recursive: true });
        const file = path.join(shotsDir, name);
        fs.writeFileSync(file, Buffer.concat(chunks));
        send(res, 200, JSON.stringify({ ok: true, file }), MIME['.json']);
      } catch (e) {
        send(res, 500, String(e));
      }
    });
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found: ' + rel);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

/** Start the server. Port 0 picks a free one. Resolves to { server, port, url }. */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer(Number(process.argv[2] || 8930));
  console.log(`tria-prima dev server: ${url}/`);
}
