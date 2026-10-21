// DeepSeek API 客户端：Search / Fetch / Chat(stream)
// 文档依据（2026-10 官方）：
//   Search: POST {base}/v1/tools/search  — query/count/ori_question/localization/need_content，QPS 100
//   Fetch:  POST {base}/v1/tools/fetch   — url，QPS 25（另有单域限速），404 表示抓不到可用内容
//   Chat:   POST {base}/chat/completions — model=deepseek-flash，stream 时 delta.content / delta.reasoning_content
// 重试策略（遵官方错误码说明）：408/429/5xx 等待后重试，其余 4xx 不重试。
import { config } from './config.js';

export class DeepseekApiError extends Error {
  constructor(message, { status = 0, code = '', retryable = false } = {}) {
    super(message);
    this.name = 'DeepseekApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callApi(path, body, { timeoutMs = 30000, retries = 0, signal } = {}) {
  const url = `${config.baseUrl}${path}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DeepseekApiError('aborted', { code: 'aborted' });
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      const text = await resp.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      if (!resp.ok) {
        const msg = json?.error?.message || `HTTP ${resp.status}`;
        const retryable = resp.status === 408 || resp.status === 429 || resp.status >= 500;
        lastErr = new DeepseekApiError(msg, {
          status: resp.status,
          code: json?.error?.code || String(resp.status),
          retryable,
        });
        if (!retryable || attempt === retries) throw lastErr;
        await sleep(Math.min(800 * 2 ** attempt, 4000));
        continue;
      }
      return json;
    } catch (err) {
      if (err instanceof DeepseekApiError) {
        if (!err.retryable || attempt === retries) throw err;
        lastErr = err;
        await sleep(Math.min(800 * 2 ** attempt, 4000));
        continue;
      }
      // 网络层错误（超时、断连）——同样可重试
      lastErr = new DeepseekApiError(`网络错误：${err.message}`, { retryable: true });
      if (attempt === retries) throw lastErr;
      await sleep(Math.min(800 * 2 ** attempt, 4000));
    }
  }
  throw lastErr;
}

/** 网页搜索，返回结构化结果数组（按相关度排序） */
export async function searchWeb(query, opts = {}) {
  const { oriQuestion = null, count = config.search.count, signal } = opts;
  const json = await callApi(
    '/v1/tools/search',
    {
      query: String(query).slice(0, 128),
      count,
      ...(oriQuestion ? { ori_question: String(oriQuestion).slice(0, 128) } : {}),
      need_content: false, // 正文统一走 Fetch，避免 search 响应过大
    },
    { timeoutMs: 30000, retries: 2, signal },
  );
  return Array.isArray(json?.results) ? json.results : [];
}

/**
 * 抓取单个网页正文（Markdown）。抓不到时抛出 DeepseekApiError（404/403 等）。
 */
export async function fetchPage(url, opts = {}) {
  const json = await callApi(
    '/v1/tools/fetch',
    { url },
    { timeoutMs: config.fetch.timeoutMs, retries: config.fetch.retries, signal: opts.signal },
  );
  return { title: json?.title || '', content: json?.content || '' };
}

/**
 * 流式对话。onReasoning/onContent 收到增量文本。
 * 返回 { content, reasoning, finishReason }。
 */
export async function chatStream(messages, { onReasoning, onContent, signal, model } = {}) {
  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: model || config.model,
      messages,
      stream: true,
      ...(config.chat.thinking ? { thinking: { type: 'enabled' } } : {}),
      ...(config.chat.reasoningEffort ? { reasoning_effort: config.chat.reasoningEffort } : {}),
      ...(config.chat.maxTokens ? { max_tokens: config.chat.maxTokens } : {}),
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    let msg = `HTTP ${resp.status}`;
    try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* ignore */ }
    throw new DeepseekApiError(msg, { status: resp.status, retryable: resp.status >= 500 || resp.status === 429 });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE：以空行分隔事件
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta || {};
            if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
            if (delta.reasoning_content) {
              reasoning += delta.reasoning_content;
              onReasoning?.(delta.reasoning_content);
            }
            if (delta.content) {
              content += delta.content;
              onContent?.(delta.content);
            }
          } catch { /* 跳过无法解析的行 */ }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { content, reasoning, finishReason };
}
