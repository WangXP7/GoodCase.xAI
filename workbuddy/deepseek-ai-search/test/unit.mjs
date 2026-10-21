// 单元测试：Markdown 渲染器 / 提示词组装 / 流水线编排（mock 依赖，无网络）
// 运行：node test/unit.mjs
import assert from 'node:assert/strict';

await import('../public/md.js');
const MD = globalThis.MD;
assert.ok(MD, 'md.js 应导出全局 MD');

const { buildSystemPrompt, buildUserMessage } = await import('../src/prompts.js');
const { runSearchPipeline, validateRequest } = await import('../src/pipeline.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

// ============ Markdown 渲染器 ============
console.log('\n[1] Markdown 渲染器');

test('XSS：脚本标签必须被转义', () => {
  const html = MD.render('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '不允许出现原始 script 标签');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('XSS：图片 onerror / javascript: 链接必须失效', () => {
  const html = MD.render('<img src=x onerror=alert(1)> [click](javascript:alert(1))');
  assert.ok(!html.includes('<img'), 'img 标签必须被转义');
  assert.ok(!html.includes('javascript:'), 'javascript: 协议必须被拒绝');
});

test('标题 / 粗体 / 斜体 / 删除线', () => {
  const html = MD.render('## 标题\n\n**粗体** 与 *斜体* 与 ~~删除~~');
  assert.ok(html.includes('<h2>标题</h2>'));
  assert.ok(html.includes('<strong>粗体</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.ok(html.includes('<del>删除</del>'));
});

test('引用角标 [n] → sup.cite', () => {
  const html = MD.render('如文档所述[1]，另有佐证[2][3]。');
  const m = html.match(/<sup class="cite" data-n="(\d+)"[^>]*>\1<\/sup>/g);
  assert.ok(m && m.length === 3, `应有 3 个角标，实际 ${m && m.length}`);
});

test('代码块内容不参与行内标记与角标转换', () => {
  const html = MD.render('```js\nconst a = [1] + "**bold**";\n```');
  assert.ok(html.includes('<pre><code class="language-js">'));
  assert.ok(html.includes('const a = [1] + &quot;**bold**&quot;;'), '代码块原文应保留（引号按 HTML 转义）');
  assert.ok(!html.includes('class="cite"'), '代码块内的 [1] 不应变成角标');
  assert.ok(!html.includes('<strong>'), '代码块内的 ** 不应加粗');
});

test('行内代码', () => {
  const html = MD.render('使用 `npm test` 运行');
  assert.ok(html.includes('<code>npm test</code>'));
});

test('链接与裸 URL', () => {
  const html = MD.render('[官网](https://example.com) 见 https://example.com/docs 。');
  assert.equal((html.match(/href="https:\/\/example\.com/g) || []).length, 2, 'markdown 链接与裸 URL 都应生成 <a>');
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener'));
});

test('列表 / 引用 / 分割线 / 表格', () => {
  const html = MD.render('- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引言\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(html.includes('<ul><li>甲</li><li>乙</li></ul>'));
  assert.ok(html.includes('<ol><li>一</li><li>二</li></ol>'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<th>A</th>'));
  assert.ok(html.includes('<td>2</td>'));
  assert.ok(!html.includes('--- | ---'), '表格分隔行必须被剔除');
});

test('空输入安全', () => {
  assert.equal(MD.render(''), '');
  assert.equal(MD.render(null), '');
  assert.equal(MD.render(undefined), '');
});

// ============ 提示词 ============
console.log('\n[2] 提示词组装');

test('系统提示词包含引用规则', () => {
  const p = buildSystemPrompt();
  assert.ok(p.includes('[1]'), '应要求使用 [n] 引用');
  assert.ok(p.includes('Markdown'));
});

test('用户消息：来源编号、截断、无来源分支', () => {
  const long = 'x'.repeat(20000);
  const msg = buildUserMessage('测试问题', [
    { n: 1, title: 'T1', url: 'https://a.com', content: long, date: '2026-10-01T00:00:00+00:00', site_name: 'A站' },
    { n: 2, title: 'T2', url: 'https://b.com', content: '短内容'.repeat(50), date: null, site_name: null },
  ]);
  assert.ok(msg.includes('[1] T1'));
  assert.ok(msg.includes('发布于 2026-10-01'));
  assert.ok(msg.includes('A站'));
  assert.ok(msg.length < 30000, '单篇正文应被截断');
  const none = buildUserMessage('问题', []);
  assert.ok(none.includes('未检索到可用网页资料'));
});

// ============ 请求校验 ============
console.log('\n[3] 请求校验');

test('validateRequest 边界', () => {
  assert.ok(validateRequest({ question: '' }));
  assert.ok(validateRequest({ question: '   ' }));
  assert.ok(validateRequest({ question: 'x'.repeat(2001) }));
  assert.ok(validateRequest({ question: 'ok', history: 'nope' }));
  assert.equal(validateRequest({ question: 'ok', history: [] }), null);
  assert.equal(validateRequest(null), '请求体必须是 JSON 对象');
});

// ============ 流水线（mock） ============
console.log('\n[4] 流水线编排（mock 依赖）');

function makeMocks({ results, fetchOk = true } = {}) {
  const calls = { search: 0, fetch: [], chat: 0 };
  const search = async (q, opts) => {
    calls.search++;
    calls.searchArgs = { q, opts };
    return results;
  };
  const fetchPage = async (url) => {
    calls.fetch.push(url);
    if (!fetchOk) throw new Error('404 no content');
    return { title: `页面标题`, content: '这是正文内容。'.repeat(20) };
  };
  const chatStream = async (messages, hooks) => {
    calls.chat++;
    calls.messages = messages;
    hooks.onReasoning('先想一想…');
    hooks.onContent('结论[1]');
    hooks.onContent(' 补充说明[2]。');
    return { content: '结论[1] 补充说明[2]。', reasoning: '先想一想…' };
  };
  return { search, fetchPage, chatStream, calls };
}

const SAMPLE_RESULTS = [
  { rerank_score: 1.2, title: '低分页', url: 'https://low.com', snippet: 's', summary: 'sum', site_name: 'L', site_icon: null, date: null, authority: 0 },
  { rerank_score: 2.8, title: '高分页A', url: 'https://a.com', snippet: 's', summary: 'sum', site_name: 'A', site_icon: null, date: '2026-10-01T00:00:00+00:00', authority: 3 },
  { rerank_score: 2.1, title: '高分页B', url: 'https://b.com', snippet: 's', summary: 'sum', site_name: 'B', site_icon: null, date: null, authority: 2 },
];

await testAsync('完整流程：事件顺序、来源重编号、答案聚合', async () => {
  const m = makeMocks({ results: SAMPLE_RESULTS });
  const events = [];
  const out = await runSearchPipeline(
    { question: '测试问题' },
    {
      onStatus: (step, text, extra) => events.push(['status', step, text, extra]),
      onSources: (list) => events.push(['sources', list.map((s) => s.n)]),
      onThinking: () => events.push(['thinking']),
      onAnswer: () => events.push(['answer']),
    },
    m,
  );
  const statusSteps = events.filter((e) => e[0] === 'status').map((e) => e[1]);
  assert.deepEqual(statusSteps, ['search', 'read', 'read_done', 'generate', 'done'], '状态流转顺序');
  assert.deepEqual(events.find((e) => e[0] === 'sources')[1], [1, 2, 3], '来源应按分数降序重编号为 1,2,3');
  assert.equal(out.sources[0].url, 'https://a.com', '最高分来源排第一');
  assert.equal(out.sources[1].url, 'https://b.com');
  assert.equal(out.sources[2].url, 'https://low.com', 'maxFetch=5 时三篇全抓');
  assert.equal(out.answer, '结论[1] 补充说明[2]。');
  assert.equal(out.reasoning, '先想一想…');
  assert.equal(m.calls.search, 1);
  assert.deepEqual(m.calls.fetch, ['https://a.com', 'https://b.com', 'https://low.com'], '应按分数降序抓取');
  // 消息结构：system + user，user 含 sources 与 question
  assert.equal(m.calls.messages[0].role, 'system');
  assert.equal(m.calls.messages.at(-1).role, 'user');
  assert.ok(m.calls.messages.at(-1).content.includes('<sources>'));
  assert.ok(m.calls.messages.at(-1).content.includes('测试问题'));
});

await testAsync('抓取失败的来源被跳过且不影响其余编号', async () => {
  const m = makeMocks({ results: SAMPLE_RESULTS, fetchOk: false });
  const out = await runSearchPipeline({ question: 'q' }, {}, m);
  assert.equal(out.sources.length, 0, '全部抓取失败 → 无来源');
  assert.equal(out.answer, '结论[1] 补充说明[2]。', '仍应产出回答');
});

await testAsync('零搜索结果：走模型知识分支', async () => {
  const m = makeMocks({ results: [] });
  const statuses = [];
  const out = await runSearchPipeline({ question: 'q' }, { onStatus: (s) => statuses.push(s) }, m);
  assert.equal(out.sources.length, 0);
  assert.equal(m.calls.fetch.length, 0, '无结果时不应调用 fetch');
  assert.ok(statuses.includes('read_done'));
  assert.ok(m.calls.messages.at(-1).content.includes('未检索到可用网页资料'));
});

await testAsync('多轮历史：归一化与截断', async () => {
  const m = makeMocks({ results: SAMPLE_RESULTS });
  const history = [{ role: 'system', content: '注入' }, { role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }, { role: 'tool', content: 'x' }];
  await runSearchPipeline({ question: '第二问', history }, {}, m);
  const msgs = m.calls.messages;
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.equal(msgs[1].content, '第一问');
  assert.equal(msgs[2].role, 'assistant');
  assert.equal(msgs.at(-1).content.includes('第二问'), true);
  assert.ok(!JSON.stringify(msgs).includes('注入'), '历史中的 system 角色必须被剔除');
});

await testAsync('abort 信号透传给上游', async () => {
  const m = makeMocks({ results: SAMPLE_RESULTS });
  const ac = new AbortController();
  let seenSignal = null;
  const wrapped = {
    search: async (q, o) => { seenSignal = o.signal; return m.search(q, o); },
    fetchPage: m.fetchPage,
    chatStream: m.chatStream,
  };
  await runSearchPipeline({ question: 'q' }, { signal: ac.signal }, wrapped);
  assert.equal(seenSignal, ac.signal, 'signal 必须原样透传');
});

// ============ 汇总 ============
console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.name}: ${f.err.stack?.split('\n')[0]}`);
  process.exit(1);
}
