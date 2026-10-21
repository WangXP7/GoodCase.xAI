// 检索增强流水线：搜索 → 抓取正文 → 组装提示词 → 流式生成
// 所有外部依赖（search/fetchPage/chatStream）可注入，便于离线单测。
import { config } from './config.js';
import { searchWeb, fetchPage, chatStream } from './deepseek.js';
import { buildSystemPrompt, buildUserMessage } from './prompts.js';

const MAX_QUESTION = 2000;
const MAX_HISTORY_MSGS = 20;

export function validateRequest(body) {
  if (!body || typeof body !== 'object') return '请求体必须是 JSON 对象';
  const q = typeof body.question === 'string' ? body.question.trim() : '';
  if (!q) return '问题不能为空';
  if (q.length > MAX_QUESTION) return `问题过长（上限 ${MAX_QUESTION} 字符）`;
  if (body.history !== undefined && !Array.isArray(body.history)) return 'history 必须是数组';
  return null;
}

/** 规整历史：只保留 role/content 合法的最近 N 条 */
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_MSGS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

/** 并发受限的 map */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 执行一次完整的「搜索 → 阅读 → 回答」流程。
 *
 * @param {object} params
 * @param {string} params.question 用户当前问题
 * @param {Array}  [params.history] 多轮对话历史 [{role, content}]
 * @param {object} [hooks] 进度回调：onStatus(step, text, extra?) / onSources(sources)
 *                          onThinking(delta) / onAnswer(delta)
 * @param {object} [deps]  依赖注入（测试用）：{ search, fetchPage, chatStream }
 * @returns {Promise<{answer:string, reasoning:string, sources:Array, fetchedCount:number, searched:boolean}>}
 */
export async function runSearchPipeline({ question, history = [] }, hooks = {}, deps = {}) {
  const _search = deps.search || searchWeb;
  const _fetch = deps.fetchPage || fetchPage;
  const _chat = deps.chatStream || chatStream;
  const onStatus = hooks.onStatus || (() => {});
  const onSources = hooks.onSources || (() => {});
  const onThinking = hooks.onThinking || (() => {});
  const onAnswer = hooks.onAnswer || (() => {});
  const signal = hooks.signal;

  // 1) 搜索
  onStatus('search', '正在联网搜索…');
  const rawResults = await _search(question, { oriQuestion: question, signal });

  // 2) 排序 + 过滤 + 取前 N 篇抓正文
  const ranked = rawResults
    .filter((r) => r && typeof r.url === 'string' && r.url)
    .sort((a, b) => (b.rerank_score || 0) - (a.rerank_score || 0))
    .filter((r) => (r.rerank_score || 0) >= config.search.minScore)
    .slice(0, config.search.maxFetch);

  let sources = [];
  if (ranked.length) {
    onStatus('read', `正在阅读 ${ranked.length} 个网页…`, { total: ranked.length });
    const pages = await mapLimit(ranked, Math.min(5, config.search.maxFetch), async (r) => {
      try {
        const page = await _fetch(r.url, { signal });
        return { ok: true, page };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    });
    sources = ranked
      .map((r, i) => ({ result: r, page: pages[i] }))
      .filter((x) => x.page.ok && (x.page.page.content || '').length > 80)
      .map((x, i) => ({
        n: i + 1,
        title: x.page.page.title || x.result.title || x.result.url,
        url: x.result.url,
        site_name: x.result.site_name || null,
        site_icon: x.result.site_icon || null,
        date: x.result.date || null,
        authority: typeof x.result.authority === 'number' ? x.result.authority : null,
        rerank_score: typeof x.result.rerank_score === 'number' ? x.result.rerank_score : null,
        snippet: x.result.snippet || '',
        content: x.page.page.content || '',
      }));
    onSources(sources);
    onStatus('read_done', sources.length
      ? `已阅读 ${sources.length} 个网页`
      : '网页正文抓取失败，将基于搜索摘要回答', { total: ranked.length, fetched: sources.length });
  } else {
    onSources([]);
    onStatus('read_done', '未检索到相关网页，将基于模型知识回答');
  }

  // 3) 组装消息（多轮历史 + 当前问题）
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...normalizeHistory(history),
    { role: 'user', content: buildUserMessage(question, sources) },
  ];

  // 4) 流式生成
  onStatus('generate', '正在生成回答…');
  const { content, reasoning } = await _chat(messages, {
    onReasoning: (d) => onThinking(d),
    onContent: (d) => onAnswer(d),
    signal,
  });

  onStatus('done', '完成');
  return { answer: content, reasoning, sources, fetchedCount: sources.length, searched: ranked.length > 0 };
}
