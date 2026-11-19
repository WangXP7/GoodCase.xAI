#!/usr/bin/env node
// Local SSE relay for driving Tiny World Builder from external tools.
//
// Configure in the app:
//   Settings -> Developer -> Inbound SSE relay URL
//   http://localhost:8788/sse
//
// Push commands with:
//   POST http://localhost:8788/command

const http = require('http');

const PORT = Number(process.env.TINYWORLD_RELAY_PORT || process.argv[2] || 8788);
const EXPECTED_TOKEN = process.env.TINYWORLD_RELAY_TOKEN || '';
const clients = new Set();
const history = [];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function authorized(req, url) {
  if (!EXPECTED_TOKEN) return true;
  const fromQuery = url.searchParams.get('token');
  const fromHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return fromQuery === EXPECTED_TOKEN || fromHeader === EXPECTED_TOKEN;
}

function broadcast(command) {
  const event = {
    id: String(Date.now()),
    command,
  };
  history.push({ at: new Date().toISOString(), command });
  while (history.length > 200) history.shift();
  const payload = `id: ${event.id}\ndata: ${JSON.stringify(command)}\n\n`;
  for (const client of clients) client.write(payload);
  return event;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/sse') {
    if (!authorized(req, url)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    console.log(`[tinyworld:sse] client connected (${clients.size})`);
    req.on('close', () => {
      clients.delete(res);
      console.log(`[tinyworld:sse] client disconnected (${clients.size})`);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/command') {
    if (!authorized(req, url)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const raw = await readBody(req);
    let command;
    try { command = JSON.parse(raw); } catch (_) {
      sendJson(res, 400, { error: 'body must be JSON' });
      return;
    }
    if (!command || typeof command !== 'object') {
      sendJson(res, 400, { error: 'command must be an object' });
      return;
    }
    const event = broadcast(command);
    console.log(`[tinyworld:sse] sent ${command.op || command.event || 'command'} to ${clients.size} client(s)`);
    sendJson(res, 200, { ok: true, clients: clients.size, id: event.id });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      port: PORT,
      clients: clients.size,
      protected: !!EXPECTED_TOKEN,
      history: history.length,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/history') {
    sendJson(res, 200, history);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[tinyworld:sse] listening on http://localhost:${PORT}`);
  console.log(`[tinyworld:sse] set Inbound SSE relay URL to http://localhost:${PORT}/sse`);
  console.log(`[tinyworld:sse] post commands to http://localhost:${PORT}/command`);
});
