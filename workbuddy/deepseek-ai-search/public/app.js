/* 灵犀搜索 — 前端主逻辑
 * 负责：提问 → SSE 流式接收（status/sources/thinking/answer/done/error）
 *       → 步骤动线 / 来源条 / 思考过程 / 流式 Markdown / 引用角标 / 多轮对话
 */
(function () {
  'use strict';

  // ---------- 图标 ----------
  const ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };

  const STEPS = [
    { key: 'search', label: '搜索全网', icon: ICONS.search },
    { key: 'read', label: '阅读网页', icon: ICONS.doc },
    { key: 'think', label: '深度思考', icon: ICONS.spark },
    { key: 'generate', label: '生成回答', icon: ICONS.pen },
  ];

  const SUGGESTIONS = [
    'DeepSeek V4.1 Flash 模型有哪些新特性？',
    '2026 年诺贝尔物理学奖颁给了谁？',
    'React 19 相比 React 18 有哪些重要变化？',
    '手冲咖啡的正确冲泡参数是什么？',
  ];

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const homeEl = $('#home');
  const threadEl = $('#thread');
  const askbar = $('#askbar');
  const inputEl = $('#ask-input');
  const formEl = $('#ask-form');
  const sendBtn = $('#btn-send');
  const newBtn = $('#btn-new');
  const chipsEl = $('#chips');

  // ---------- 状态 ----------
  const state = {
    turns: [],
    history: [],   // [{role, content}] 多轮上下文
    busy: false,
    abort: null,
    seq: 0,
  };

  // ---------- 工具 ----------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const nearBottom = () =>
    window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;

  const scrollToBottom = (force) => {
    if (force || nearBottom()) window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  };

  // ---------- 顶部栏 / 主区域切换 ----------
  function refreshChrome() {
    const hasTurns = state.turns.length > 0;
    homeEl.hidden = hasTurns;
    threadEl.hidden = !hasTurns;
    newBtn.style.visibility = hasTurns ? 'visible' : 'hidden';
  }

  function setBusy(busy) {
    state.busy = busy;
    sendBtn.innerHTML = busy ? ICONS.stop : ICONS.arrow;
    sendBtn.classList.toggle('is-stop', busy);
    sendBtn.title = busy ? '停止生成' : '发送';
    inputEl.disabled = false;
    if (!busy) inputEl.focus();
  }

  // ---------- 提问卡片 ----------
  function createTurn(question) {
    const turn = {
      id: ++state.seq,
      question,
      raw: '',
      reasoning: '',
      sources: [],
      steps: {},
      done: false,
      stopped: false,
      error: null,
      elapsedMs: 0,
      _raf: null,
    };

    const card = el('article', 'turn');
    card.dataset.id = turn.id;

    // 问题行
    const qRow = el('div', 'turn-q');
    const qAvatar = el('div', 'q-avatar', '问');
    const qText = el('div', 'turn-q-text', question);
    qRow.append(qAvatar, qText);

    // 步骤动线
    const stepsEl = el('div', 'steps');
    for (const s of STEPS) {
      const item = el('div', 'step');
      item.dataset.step = s.key;
      item.dataset.state = 'idle';
      const icon = el('span', 'step-icon');
      icon.innerHTML = s.icon;
      const label = el('span', 'step-label', s.label);
      const detail = el('span', 'step-detail');
      item.append(icon, label, detail);
      stepsEl.append(item);
      turn.steps[s.key] = { item, detail };
    }

    // 来源条
    const srcWrap = el('div', 'sources');
    srcWrap.hidden = true;
    const srcStrip = el('div', 'sources-strip');

    // 思考过程
    const think = el('details', 'think');
    think.hidden = true;
    const thinkSum = el('summary', 'think-summary');
    thinkSum.innerHTML = `${ICONS.spark}<span>思考过程</span><span class="think-count"></span>`;
    const thinkBody = el('div', 'think-body');
    think.append(thinkSum, thinkBody);

    // 回答
    const answer = el('div', 'answer md-body');

    // 错误
    const errBox = el('div', 'err');
    errBox.hidden = true;
    const errText = el('div', 'err-text');
    const retryBtn = el('button', 'retry-btn', '重试');
    errBox.append(errText, retryBtn);

    // 底部操作
    const actions = el('div', 'turn-actions');
    actions.hidden = true;
    const copyBtn = el('button', 'act-btn');
    copyBtn.innerHTML = `${ICONS.copy}<span>复制回答</span>`;
    const meta = el('span', 'act-meta');
    actions.append(copyBtn, meta);

    card.append(qRow, stepsEl, srcWrap, think, answer, errBox, actions);
    srcWrap.append(srcStrip);
    threadEl.append(card);

    turn.el = card;
    turn.srcWrap = srcWrap;
    turn.srcStrip = srcStrip;
    turn.think = think;
    turn.thinkBody = thinkBody;
    turn.thinkCount = think.querySelector('.think-count');
    turn.answerEl = answer;
    turn.errBox = errBox;
    turn.errText = errText;
    turn.actions = actions;
    turn.meta = meta;
    turn.copyBtn = copyBtn;

    retryBtn.addEventListener('click', () => retryTurn(turn));
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(turn.raw).then(() => {
        copyBtn.querySelector('span').textContent = '已复制';
        setTimeout(() => { copyBtn.querySelector('span').textContent = '复制回答'; }, 1500);
      });
    });

    state.turns.push(turn);
    refreshChrome();
    return turn;
  }

  function setStep(turn, key, st, detailText) {
    const s = turn.steps[key];
    if (!s) return;
    s.item.dataset.state = st;
    if (detailText !== undefined) s.detail.textContent = detailText;
    // 步骤条整体收启：完成后打勾，进行中脉冲
    const icon = s.item.querySelector('.step-icon');
    if (st === 'done') icon.innerHTML = ICONS.check;
    else if (st === 'active') icon.innerHTML = STEPS.find((x) => x.key === key).icon;
    else icon.innerHTML = STEPS.find((x) => x.key === key).icon;
  }

  function renderSources(turn, sources) {
    if (!sources.length) return;
    turn.sources = sources;
    turn.srcWrap.hidden = false;
    turn.srcStrip.innerHTML = '';
    const head = el('div', 'sources-head', `来源 · ${sources.length}`);
    turn.srcStrip.append(head);
    for (const s of sources) {
      const a = el('a', 'src-card');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const badge = el('span', 'src-n', String(s.n));
      const icon = el('span', 'src-ico');
      if (s.site_icon) {
        const img = document.createElement('img');
        img.src = s.site_icon;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { img.remove(); icon.append(el('span', 'src-ico-fallback', (s.site_name || 'W')[0].toUpperCase())); };
        icon.append(img);
      } else {
        icon.append(el('span', 'src-ico-fallback', (s.site_name || 'W')[0].toUpperCase()));
      }
      const body = el('div', 'src-body');
      body.append(el('div', 'src-title', s.title));
      const metaTxt = [s.site_name, fmtDate(s.date)].filter(Boolean).join(' · ');
      body.append(el('div', 'src-meta', metaTxt || new URL(s.url).hostname));
      a.append(badge, icon, body);
      turn.srcStrip.append(a);
    }
  }

  function appendReasoning(turn, delta) {
    turn.reasoning += delta;
    turn.think.hidden = false;
    if (!turn.done) turn.think.open = true;
    turn.thinkBody.textContent = turn.reasoning;
    turn.thinkCount.textContent = `${turn.reasoning.length} 字`;
  }

  function scheduleAnswerRender(turn) {
    if (turn._raf) return;
    turn._raf = requestAnimationFrame(() => {
      turn._raf = null;
      turn.answerEl.classList.add('streaming');
      turn.answerEl.innerHTML = MD.render(turn.raw);
      scrollToBottom(false);
    });
  }

  function showError(turn, message) {
    turn.error = message;
    turn.done = true;
    turn.errText.textContent = `出错了：${message}`;
    turn.errBox.hidden = false;
    for (const k of Object.keys(turn.steps)) setStep(turn, k, turn.steps[k].item.dataset.state === 'active' ? 'idle' : turn.steps[k].item.dataset.state);
    finishTurn(turn);
  }

  function finishTurn(turn) {
    turn.done = true;
    setBusy(false);
    if (!turn.error) {
      setStep(turn, 'generate', 'done');
      turn.answerEl.classList.remove('streaming');
      turn.answerEl.innerHTML = MD.render(turn.raw);
      turn.meta.textContent = [
        turn.sources.length ? `${turn.sources.length} 个来源` : null,
        turn.elapsedMs ? `${(turn.elapsedMs / 1000).toFixed(1)}s` : null,
      ].filter(Boolean).join(' · ');
      turn.actions.hidden = false;
      // 写入多轮历史
      if (turn.raw.trim()) {
        state.history.push({ role: 'user', content: turn.question });
        state.history.push({ role: 'assistant', content: turn.raw });
      }
    }
    scrollToBottom(true);
  }

  // ---------- SSE 流 ----------
  async function ask(question, turn) {
    const ac = new AbortController();
    state.abort = ac;
    setBusy(true);
    const t0 = performance.now();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: state.history }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`服务返回 HTTP ${resp.status}${txt ? `：${txt.slice(0, 200)}` : ''}`);
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
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            handleEvent(turn, ev, t0);
          }
        }
      }
      // 流正常结束但未收到 done（异常中断）
      if (!turn.done && !turn.error) {
        if (turn.raw.trim()) finishTurn(turn);
        else showError(turn, '连接中断，未收到回答');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        turn.stopped = true;
        turn.done = true;
        setBusy(false);
        turn.meta.textContent = '已停止生成';
        turn.actions.hidden = false;
        if (turn.raw.trim()) {
          state.history.push({ role: 'user', content: turn.question });
          state.history.push({ role: 'assistant', content: turn.raw + '\n（回答已被用户中断）' });
        }
        return;
      }
      console.error(err);
      showError(turn, err.message || '网络错误');
    } finally {
      state.abort = null;
    }
  }

  function handleEvent(turn, ev, t0) {
    switch (ev.type) {
      case 'status':
        if (ev.step === 'search') setStep(turn, 'search', 'active', '全网检索中');
        else if (ev.step === 'read') { setStep(turn, 'search', 'done'); setStep(turn, 'read', 'active', ev.text); }
        else if (ev.step === 'read_done') setStep(turn, 'read', 'done', ev.text);
        else if (ev.step === 'generate') { setStep(turn, 'think', 'done'); setStep(turn, 'generate', 'active'); }
        else if (ev.step === 'done') turn.elapsedMs = ev.elapsedMs || (performance.now() - t0);
        break;
      case 'sources':
        renderSources(turn, ev.sources || []);
        break;
      case 'thinking':
        setStep(turn, 'think', 'active');
        appendReasoning(turn, ev.delta || '');
        scrollToBottom(false);
        break;
      case 'answer':
        if (!turn.raw) setStep(turn, 'think', 'done');
        setStep(turn, 'generate', 'active');
        turn.raw += ev.delta || '';
        scheduleAnswerRender(turn);
        break;
      case 'done':
        turn.elapsedMs = ev.elapsedMs || (performance.now() - t0);
        if (ev.sources?.length && !turn.sources.length) renderSources(turn, ev.sources);
        finishTurn(turn);
        break;
      case 'error':
        showError(turn, ev.message || '未知错误');
        break;
    }
  }

  function submitQuestion(question) {
    const q = question.trim();
    if (!q || state.busy) return;
    inputEl.value = '';
    autoGrow();
    const turn = createTurn(q);
    scrollToBottom(true);
    ask(q, turn);
  }

  function retryTurn(turn) {
    if (state.busy) return;
    // 重置该卡片
    turn.raw = '';
    turn.reasoning = '';
    turn.error = null;
    turn.stopped = false;
    turn.errBox.hidden = true;
    turn.answerEl.innerHTML = '';
    turn.thinkBody.textContent = '';
    turn.think.hidden = true;
    turn.actions.hidden = true;
    for (const k of Object.keys(turn.steps)) setStep(turn, k, 'idle');
    ask(turn.question, turn);
  }

  // ---------- 输入框 ----------
  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuestion(inputEl.value);
  });

  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitQuestion(inputEl.value);
    }
  });

  newBtn.addEventListener('click', () => {
    if (state.busy) state.abort?.abort();
    state.turns = [];
    state.history = [];
    threadEl.innerHTML = '';
    refreshChrome();
    inputEl.focus();
  });

  // 示例问题
  for (const s of SUGGESTIONS) {
    const chip = el('button', 'chip', s);
    chip.type = 'button';
    chip.addEventListener('click', () => submitQuestion(s));
    chipsEl.append(chip);
  }

  // 引用角标点击 → 打开原文（事件委托）
  threadEl.addEventListener('click', (e) => {
    const cite = e.target.closest('.cite');
    if (!cite) return;
    const card = cite.closest('.turn');
    const turn = state.turns.find((t) => t.el === card);
    const n = Number(cite.dataset.n);
    const src = turn?.sources.find((s) => s.n === n);
    if (src) window.open(src.url, '_blank', 'noopener');
  });

  refreshChrome();
  inputEl.focus();
})();
