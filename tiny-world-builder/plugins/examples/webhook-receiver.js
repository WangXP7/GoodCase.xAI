#!/usr/bin/env node
// Receives Tiny World Builder outbound webhooks.
//
// Configure in the app:
//   Settings -> Developer -> Outbound webhook URL
//   http://localhost:8787/webhook

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TINYWORLD_WEBHOOK_PORT || process.argv[2] || 8787);
const LOG_FILE = process.env.TINYWORLD_WEBHOOK_LOG ||
  path.join(__dirname, 'tinyworld-webhook-events.jsonl');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch (_) { return { raw: line }; }
    });
}

function appendEvent(event) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { payload = { raw }; }
    const entry = {
      receivedAt: new Date().toISOString(),
      authorization: req.headers.authorization || null,
      payload,
    };
    appendEvent(entry);
    const count = Array.isArray(payload.events) ? payload.events.length : 0;
    console.log(`[tinyworld:webhook] received ${count} event(s)`);
    send(res, 200, { ok: true, count });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    send(res, 200, readLog());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/latest') {
    const events = readLog();
    if (!events.length) {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    send(res, 200, events[events.length - 1]);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/clear') {
    fs.writeFileSync(LOG_FILE, '');
    send(res, 200, { ok: true, cleared: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      port: PORT,
      logFile: LOG_FILE,
      count: readLog().length,
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[tinyworld:webhook] listening on http://localhost:${PORT}`);
  console.log(`[tinyworld:webhook] set Outbound webhook URL to http://localhost:${PORT}/webhook`);
  console.log(`[tinyworld:webhook] log file: ${LOG_FILE}`);
});
