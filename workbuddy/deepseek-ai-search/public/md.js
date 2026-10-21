/* 安全 Markdown 渲染器（DOM-free，返回 HTML 字符串，可在 Node 中单测）
 * 支持：标题 / 粗体 / 斜体 / 删除线 / 行内代码 / 代码块 / 列表 / 引用 / 表格 /
 *       分割线 / 链接 / 裸 URL / 引用角标 [n] → <sup class="cite" data-n="n">
 * 安全策略：先整体 HTML 转义，再做标记转换；链接仅允许 http/https/mailto。
 */
(function (g) {
  'use strict';

  const CB = '\u0000CB', IC = '\u0000IC', LK = '\u0000LK', CT = '\u0000CT';
  const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    // 行内代码（最先提取，内容不再处理）
    const codes = [];
    text = text.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(c);
      return `${IC}${codes.length - 1}\u0000`;
    });
    // 裸 URL（在 markdown 链接之前处理，用占位符避免重复包裹）
    const links = [];
    // markdown 链接 [text](url)（仅白名单协议；必须先于裸 URL 处理）
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    // 其余 [text](url) 一律降级为纯文本（拒绝 javascript: 等危险协议）
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // 裸 URL（此时普通链接已变成 <a>，href 前的引号不会误匹配）
    text = text.replace(/(^|[\s(（【])(https?:\/\/[^\s<>"'）】]+)/g, (m, pre, url) => {
      const clean = url.replace(/[.,;:!?，。；：！？]+$/, '');
      links.push(clean);
      return `${pre}${LK}${links.length - 1}\u0000`;
    });
    // 粗体 / 斜体 / 删除线
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // 引用角标 [n]
    text = text.replace(/\[(\d{1,2})\]/g, (m, n) => `${CT}${n}\u0000`);
    // 还原
    text = text.replace(new RegExp(`${re(IC)}(\\d+)\u0000`, 'g'), (m, i) => `<code>${codes[+i]}</code>`);
    text = text.replace(new RegExp(`${re(LK)}(\\d+)\u0000`, 'g'),
      (m, i) => `<a href="${links[+i]}" target="_blank" rel="noopener noreferrer">${links[+i]}</a>`);
    return text;
  }

  function renderBlocks(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;

    const flushPara = (buf) => {
      if (buf.length) {
        out.push(`<p>${inline(buf.join('<br>'))}</p>`);
        buf.length = 0;
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      // 代码块占位符行
      const cbMatch = line.match(new RegExp(`^${re(CB)}(\\d+)\u0000$`));
      if (cbMatch) { out.push(`\u0001CB${cbMatch[1]}\u0001`); i++; continue; }

      // 标题
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`); i++; continue; }

      // 分割线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

      // 引用块（注意：文本已整体转义，标记 > 变成 &gt;）
      if (/^&gt;\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^&gt;\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${renderBlocks(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // 表格
      if (/^\|.*\|$/.test(line.trim())) {
        const rows = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
        const cellsOf = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
        const isSep = (r) => /^\|[\s:|-]+\|$/.test(r);
        const head = cellsOf(rows[0]);
        const bodyRows = rows.slice(1).filter((r) => !isSep(r)).map(cellsOf);
        const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
        const tbody = bodyRows.length
          ? `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
          : '';
        out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
        continue;
      }

      // 无序列表
      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
          i++;
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // 有序列表
      if (/^\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^\d+[.)]\s+/, ''))}</li>`);
          i++;
        }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // 普通段落（连续行合并）
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim()
             && !/^(#{1,4}\s|&gt;\s?|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i])
             && !new RegExp(`^${re(CB)}\\d+\u0000$`).test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      flushPara(buf);
    }
    return out.join('\n');
  }

  function render(md) {
    if (!md) return '';
    const src = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const codeBlocks = [];
    // 1) 提取围栏代码块（原文保留，渲染时转义）
    let text = src.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
      const idx = codeBlocks.length;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      codeBlocks.push(`<pre><code${cls}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return `\n${CB}${idx}\u0000\n`;
    });
    // 2) 转义 + 块级渲染
    text = escapeHtml(text);
    let html = renderBlocks(text);
    // 3) 还原代码块与引用角标
    html = html.replace(/\u0001CB(\d+)\u0001/g, (m, i) => codeBlocks[+i]);
    html = html.replace(new RegExp(`${re(CT)}(\\d+)\u0000`, 'g'),
      (m, n) => `<sup class="cite" data-n="${n}" role="button" tabindex="0" title="查看来源 ${n}">${n}</sup>`);
    return html;
  }

  const MD = { render, escapeHtml, _internals: { inline, renderBlocks } };
  g.MD = MD;
  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
