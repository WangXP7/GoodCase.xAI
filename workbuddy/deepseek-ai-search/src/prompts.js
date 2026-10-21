// 提示词工程：系统提示 + 带编号来源的用户消息
// 引用约定：模型用 [1] [2] … 标注，编号与前端 sources 列表一一对应，点击角标跳转原文

const SYSTEM_PROMPT = `你是一个严谨的 AI 搜索引擎助手（类似 Perplexity）。用户会提供一个问题和若干篇编号为 [1] [2] … 的网页资料，你的任务是基于这些资料给出准确、有洞察的回答。

规则：
1. **引用标注**：凡使用了某篇资料的信息，就在对应句子末尾标注该篇的编号，如 [1]。多个来源用 [1][2] 连标。引用编号必须真实存在于给定的资料列表中，禁止编造编号。
2. **忠于资料**：只使用给定资料中的信息作答。资料不足以回答的部分，明确说明「根据现有资料无法确认」，然后用你自己的知识补充，并清楚标注这是模型知识而非来源信息。
3. **语言**：使用与用户问题相同的语言作答（用户用中文就用中文，用英文就用英文）。
4. **格式**：使用 Markdown。开头用 1-2 句话直接给出核心结论，然后分点展开；涉及对比、参数、时间线时优先使用表格；篇幅适中，重点信息加粗，避免空话。
5. **时效**：注意资料中的发布日期，优先采纳更新的信息；若资料之间矛盾，指出矛盾并说明取舍理由。
6. 不要输出资料来源列表本身（前端会单独渲染），不要在回答末尾写「参考资料」章节。`;

export function buildSystemPrompt() {
  return SYSTEM_PROMPT;
}

/**
 * 把检索到的来源组装成用户消息：资料块 + 原始问题
 * @param {string} question 用户当前问题
 * @param {Array<{n:number,title:string,url:string,content:string,date:string|null,site_name:string|null}>} sources
 * @returns {string}
 */
export function buildUserMessage(question, sources) {
  if (!sources.length) {
    return `<question>\n${question}\n</question>\n\n（本次未检索到可用网页资料，请基于自身知识回答，并明确告知用户回答未引用实时来源。）`;
  }
  const blocks = sources.map((s) => {
    const meta = [
      s.site_name || null,
      s.date ? `发布于 ${s.date.slice(0, 10)}` : null,
    ].filter(Boolean).join(' · ');
    const body = (s.content || '').slice(0, 12000); // 单篇正文截断，防止上下文爆炸
    return `[${s.n}] ${s.title}\nURL: ${s.url}${meta ? `\n${meta}` : ''}\n\n${body}`;
  }).join('\n\n---\n\n');
  return `<sources>\n${blocks}\n</sources>\n\n<question>\n${question}\n</question>`;
}
