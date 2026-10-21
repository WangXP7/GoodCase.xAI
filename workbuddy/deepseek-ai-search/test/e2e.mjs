// 端到端测试：真实服务器 + 真实 DeepSeek API
// 运行：node test/e2e.mjs   （需要 .env 中的 DEEPSEEK_API_KEY）
import assert from 'node:assert/strict';

const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

// 导入即启动服务
const { server } = await import('../server.js');
await new Promise((r) => server.once('listening', r));

let passed = 0;
const failures = [];
async function test(name, fn, timeoutMs = 60000) {
  const timer = setTimeout(() => {
    failures.push({ name, err: new Error(`超时 ${timeoutMs}ms`) });
    console.log(`  ✗ ${name}（超时）`);
  }, timeoutMs);
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n    ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/chat，收集全部 SSE 事件 */
async function postChat(body, { signal, timeoutMs = 240000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('client timeout')), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
  const events = [];
  let httpStatus = 0;
  let rawText = '';
  try {
    const resp = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    httpStatus = resp.status;
    if (resp.status !== 200) {
      rawText = await resp.text();
      return { httpStatus, events, rawText };
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { events.push(JSON.parse(line.slice(5))); } catch { /* skip */ }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { httpStatus, events, rawText };
}

const get = async (path) => {
  const resp = await fetch(`${BASE}${path}`);
  return { status: resp.status, contentType: resp.headers.get('content-type'), text: await resp.text() };
};

// ============ 静态资源 ============
console.log('\n[1] 静态资源与服务基线');

await test('GET / 返回页面（含标题与脚本引用）', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.ok(r.contentType.includes('text/html'));
  assert.ok(r.text.includes('<title>灵犀搜索 · AI 搜索引擎</title>'), '页面标题');
  assert.ok(r.text.includes('/app.js') && r.text.includes('/md.js') && r.text.includes('/style.css'));
});

await test('静态资源 content-type 正确', async () => {
  const css = await get('/style.css');
  assert.ok(css.contentType.includes('text/css'));
  const js = await get('/app.js');
  assert.ok(js.contentType.includes('javascript'));
  assert.ok(js.text.includes('handleEvent'), 'app.js 内容完整');
  const md = await get('/md.js');
  assert.ok(md.contentType.includes('javascript'));
});

await test('GET /api/health', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200);
  const json = JSON.parse(r.text);
  assert.equal(json.ok, true);
  assert.equal(json.hasKey, true, 'API Key 必须已配置');
  assert.ok(json.model);
});

// ============ 错误处理 ============
console.log('\n[2] 错误处理');

await test('空问题 → 400', async () => {
  const r = await postChat({ question: '' });
  assert.equal(r.httpStatus, 400);
  assert.ok(r.rawText.includes('error'));
});

await test('未知路径 → 404', async () => {
  const r = await get('/no-such-file.js');
  assert.equal(r.status, 404);
});

await test('目录穿越被拦截且不泄露密钥', async () => {
  for (const p of ['/../.env', '/..%2f.env', '/%2e%2e/.env']) {
    const r = await get(p);
    assert.notEqual(r.status, 200, `${p} 不应返回 200`);
    assert.ok(!r.text.includes('DEEPSEEK_API_KEY=sk'), `${p} 不应泄露密钥`);
  }
});

// ============ 完整流水线（真实 API） ============
console.log('\n[3] 完整问答流水线（真实 Search + Fetch + 流式生成）');

const Q1 = 'DeepSeek V4.1 Flash 模型有哪些新特性？';
let firstAnswer = '';

await test('首轮提问：事件顺序 / 来源 / 引用 / 流式增量', async () => {
  const { httpStatus, events } = await postChat({ question: Q1, history: [] });
  assert.equal(httpStatus, 200);

  const types = events.map((e) => e.type);
  const statusSteps = events.filter((e) => e.type === 'status').map((e) => e.step);
  assert.ok(statusSteps[0] === 'search', `首个状态应为 search，实际 ${statusSteps[0]}`);
  assert.ok(statusSteps.includes('read'), '应有 read 状态');
  assert.ok(statusSteps.includes('generate'), '应有 generate 状态');
  assert.ok(types.includes('sources'), '应推送来源列表');

  const srcEv = events.find((e) => e.type === 'sources');
  assert.ok(Array.isArray(srcEv.sources) && srcEv.sources.length >= 1, '至少应有 1 个来源');
  for (const s of srcEv.sources) {
    assert.ok(s.n >= 1 && s.title && /^https?:\/\//.test(s.url), `来源字段不完整：${JSON.stringify(s).slice(0, 120)}`);
  }

  const answers = events.filter((e) => e.type === 'answer');
  assert.ok(answers.length >= 3, `流式增量应分多帧返回，实际 ${answers.length} 帧`);
  firstAnswer = answers.map((e) => e.delta).join('');
  assert.ok(firstAnswer.length > 100, `回答过短（${firstAnswer.length} 字）`);
  assert.ok(/\[\d+\]/.test(firstAnswer), '回答应包含 [n] 引用角标');
  const cited = [...firstAnswer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const maxN = Math.max(...srcEv.sources.map((s) => s.n));
  assert.ok(cited.every((n) => n >= 1 && n <= maxN), '引用编号必须都在来源范围内');

  const done = events.find((e) => e.type === 'done');
  assert.ok(done, '应收到的 done 事件');
  assert.equal(done.answer, firstAnswer, 'done.answer 应与增量拼接一致');
  assert.ok(done.elapsedMs > 0);

  const thinkings = events.filter((e) => e.type === 'thinking');
  console.log(`    · 来源 ${srcEv.sources.length} 个 · 回答 ${firstAnswer.length} 字 · 思维链 ${thinkings.length} 帧 · 耗时 ${(done.elapsedMs / 1000).toFixed(1)}s`);
  assert.ok(thinkings.length >= 1, '开启思维链后应收到 thinking 事件');
}, 240000);

await test('多轮追问：携带历史可获得上下文相关的回答', async () => {
  const { httpStatus, events } = await postChat({
    question: '它的 API 价格相比上一代有变化吗？',
    history: [
      { role: 'user', content: Q1 },
      { role: 'assistant', content: firstAnswer },
    ],
  });
  assert.equal(httpStatus, 200);
  const answers = events.filter((e) => e.type === 'answer').map((e) => e.delta).join('');
  assert.ok(answers.length > 50, `追问回答过短（${answers.length} 字）`);
  assert.ok(!events.some((e) => e.type === 'error'), '多轮不应报错');
}, 240000);

// ============ 断连恢复 ============
console.log('\n[4] 客户端断连');

await test('中途断开连接后服务保持存活', async () => {
  const ac = new AbortController();
  const chatP = postChat({ question: '测试断连：今天天气怎么样' }, { signal: ac.signal, timeoutMs: 60000 });
  // 收到任意事件后立即断开
  setTimeout(() => ac.abort(), 300);
  await chatP.catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const h = await get('/api/health');
  assert.equal(h.status, 200, '断连后服务必须仍可响应');
}, 90000);

// ============ 汇总 ============
console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
server.close();
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.name}: ${f.err.stack?.split('\n').slice(0, 3).join('\n')}`);
  process.exit(1);
}
// 等待底层连接释放后退出
setTimeout(() => process.exit(0), 500);
