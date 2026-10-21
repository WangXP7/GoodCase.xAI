// HTTP 服务：静态文件 + POST /api/chat（SSE 流式）+ GET /api/health
// 零依赖，Node >= 18.17（原生 fetch / ReadableStream）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { config } from './src/config.js';
import { runSearchPipeline, validateRequest } from './src/pipeline.js';

const PUBLIC_DIR = resolve(config.root, 'public');
const MAX_BODY = 1024 * 1024; // 1MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveP, rejectP) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        rejectP(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectP);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  // 防目录穿越
  const filePath = resolve(join(PUBLIC_DIR, normalize(rel)));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, 400, { error: `无法解析请求体：${err.message}` });
    return;
  }

  const invalid = validateRequest(payload);
  if (invalid) {
    sendJson(res, 400, { error: invalid });
    return;
  }

  // SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // 客户端断连时 socket 已销毁，吸收后续写错误避免进程崩溃
  res.on('error', () => {});
  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const ac = new AbortController();
  // 客户端断开 → 中止上游请求，避免继续计费
  req.on('close', () => { if (!res.writableEnded) ac.abort(); });

  const t0 = Date.now();
  try {
    const { answer, reasoning, sources, fetchedCount } = await runSearchPipeline(
      { question: payload.question, history: payload.history },
      {
        signal: ac.signal,
        onStatus: (step, text, extra) => send({ type: 'status', step, text, ...(extra || {}) }),
        onSources: (list) => send({ type: 'sources', sources: list }),
        onThinking: (delta) => send({ type: 'thinking', delta }),
        onAnswer: (delta) => send({ type: 'answer', delta }),
      },
    );
    send({
      type: 'done',
      answer,
      reasoning,
      sources,
      fetchedCount,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    if (ac.signal.aborted) {
      // 用户主动停止：静默结束
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    console.error('[chat] 流水线错误：', err);
    send({
      type: 'error',
      message: err?.message || '服务内部错误',
      status: err?.status || 0,
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, model: config.model, hasKey: !!config.apiKey, uptime: process.uptime() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      await handleChat(req, res);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname);
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error('[server] 未处理异常：', err);
    if (!res.headersSent) sendJson(res, 500, { error: '服务内部错误' });
    else try { res.end(); } catch { /* ignore */ }
  }
});

server.listen(config.port, () => {
  console.log(`[server] 灵犀搜索已启动 → http://localhost:${config.port}`);
  console.log(`[server] 模型 ${config.model} · Search/Fetch/思维链已就绪`);
});

export { server };
