// 配置加载：优先进程环境变量，其次项目根目录 .env 文件（零依赖手写解析）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

const env = process.env;

export const config = {
  root: ROOT,
  port: Number(env.PORT || 3210),
  apiKey: env.DEEPSEEK_API_KEY || '',
  baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
  // 模型：deepseek-flash 现由 DeepSeek-V4.1-Flash-1017 提供服务（官方文档 2026-10）
  model: env.DEEPSEEK_MODEL || 'deepseek-flash',
  search: {
    count: Number(env.SEARCH_COUNT || 10),      // 搜索返回条数（1-50）
    maxFetch: Number(env.MAX_FETCH_SOURCES || 5), // 实际抓取正文的篇数（按 rerank_score 取前 N）
    minScore: Number(env.MIN_RERANK_SCORE || 0),  // 纳入回答的最低相关分（0 表示不筛选）
  },
  fetch: {
    timeoutMs: Number(env.FETCH_TIMEOUT_MS || 20000),
    retries: 3,
  },
  chat: {
    timeoutMs: Number(env.CHAT_TIMEOUT_MS || 120000),
    // 开启思维链，前端实时展示「AI 正在想什么」
    thinking: env.CHAT_THINKING !== 'off',
    reasoningEffort: env.CHAT_REASONING_EFFORT || 'medium',
    maxTokens: Number(env.CHAT_MAX_TOKENS || 4096),
  },
};

if (!config.apiKey) {
  console.error('[config] 缺少 DEEPSEEK_API_KEY：请在项目根目录 .env 中配置（参考 .env.example），或设置同名环境变量。');
  process.exit(1);
}
