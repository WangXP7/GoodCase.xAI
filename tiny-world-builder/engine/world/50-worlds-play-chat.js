  // Tinyverse — play-mode chat panel.
  // Wires to 47-worlds-room.js events (chat / typing / peers / you / enter / leave).
  // Reuses mp-chat-* class names so the base CSS in tiny-world.css applies;
  // adds tw-play-chat-* overrides for dark glassmorphism in play mode.
  // NO emoji, NO PNG icons. IIFE-wrapped; no globals leak.
  (function wirePlayChat() {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const WS = (window.__tinyworldWorlds = window.__tinyworldWorlds || {});
    function on(ev, cb) { if (typeof WS.on === 'function') WS.on(ev, cb); }
    function ic(name, size) { return typeof WS.icon === 'function' ? WS.icon(name, size) : document.createElement('span'); }

    // ---- CSS ---------------------------------------------------------------
    function injectStyles() {
      if (document.getElementById('tw-play-chat-css')) return;
      const s = document.createElement('style');
      s.id = 'tw-play-chat-css';
      s.textContent = `
        /* Dark glassmorphism overrides — only active in play mode */
        body.tw-worlds-play .mp-chat-toggle {
          background: rgba(8,11,28,.82);
          border: 1px solid rgba(80,110,200,.28);
          box-shadow: inset 0 1px 0 rgba(120,150,230,.14), 0 8px 24px -8px rgba(0,0,20,.55);
          color: #cfe0ff;
        }
        body.tw-worlds-play .mp-chat-toggle:hover {
          background: rgba(14,18,44,.9);
          color: #fff;
        }
        body.tw-worlds-play .mp-chat-toggle.is-open {
          background: rgba(20,30,70,.88);
          border-color: rgba(80,130,240,.45);
          box-shadow: inset 0 1px 0 rgba(160,190,255,.18), 0 0 0 2px rgba(80,130,230,.22), 0 8px 24px -8px rgba(0,0,20,.55);
          color: #a8c8ff;
        }
        body.tw-worlds-play .mp-chat-panel {
          background: rgba(8,11,28,.88);
          border: 1px solid rgba(80,110,200,.22);
          border-radius: 14px;
          box-shadow: inset 0 1px 0 rgba(120,150,230,.12), 0 20px 48px -12px rgba(0,0,20,.65);
          backdrop-filter: blur(22px) saturate(160%);
          -webkit-backdrop-filter: blur(22px) saturate(160%);
          color: #cfe0ff;
        }
        body.tw-worlds-play .mp-chat-head {
          border-bottom: 1px solid rgba(80,110,200,.18);
        }
        body.tw-worlds-play .mp-chat-head::after {
          background: rgba(80,110,200,.18);
        }
        body.tw-worlds-play .mp-chat-close {
          color: #8aa4d0;
          background: transparent;
          border: none;
        }
        body.tw-worlds-play .mp-chat-close:hover {
          background: rgba(255,255,255,.08);
          color: #cfe0ff;
        }
        body.tw-worlds-play .mp-chat-tabs {
          border-bottom: 1px solid rgba(80,110,200,.18);
          background: transparent;
        }
        body.tw-worlds-play .mp-chat-tab {
          color: #8aa4d0;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          border-radius: 0;
          box-shadow: none;
          padding: 8px 12px;
        }
        body.tw-worlds-play .mp-chat-tab.is-active {
          color: #cfe0ff;
          background: transparent;
          border: none;
          border-bottom: 2px solid #5a8ae0;
          box-shadow: none;
        }
        body.tw-worlds-play .mp-chat-log {
          background: transparent;
        }
        body.tw-worlds-play .mp-chat-msg {
          background: rgba(20,30,60,.35);
          border: 1px solid rgba(80,110,200,.12);
          border-radius: 8px;
        }
        body.tw-worlds-play .mp-chat-msg.is-self {
          background: rgba(40,60,120,.45);
          border-color: rgba(80,130,230,.22);
        }
        body.tw-worlds-play .mp-chat-name {
          font-family: 'Space Grotesk', system-ui, sans-serif;
          font-weight: 700;
        }
        body.tw-worlds-play .mp-chat-time {
          color: rgba(180,200,240,.5);
        }
        body.tw-worlds-play .mp-chat-text {
          color: #d8e8ff;
          font-family: 'Space Grotesk', system-ui, sans-serif;
        }
        body.tw-worlds-play .mp-chat-typing {
          color: rgba(180,200,240,.65);
          font-family: 'Space Grotesk', system-ui, sans-serif;
          font-style: italic;
        }
        body.tw-worlds-play .mp-chat-input {
          background: rgba(4,6,20,.65);
          border: 1px solid rgba(80,110,200,.28);
          border-radius: 8px;
          color: #cfe0ff;
          font-family: 'Space Grotesk', system-ui, sans-serif;
        }
        body.tw-worlds-play .mp-chat-input::placeholder { color: rgba(160,190,240,.45); }
        body.tw-worlds-play .mp-chat-input:focus {
          border-color: rgba(80,130,230,.6);
          background: rgba(8,12,30,.8);
          outline: none;
          box-shadow: 0 0 0 2px rgba(80,130,230,.2);
        }
        body.tw-worlds-play .mp-chat-send {
          background: rgba(30,50,120,.55);
          border: 1px solid rgba(80,110,200,.28);
          border-radius: 8px;
          color: #a8c8ff;
        }
        body.tw-worlds-play .mp-chat-send:hover {
          background: rgba(40,70,180,.65);
          color: #cfe0ff;
        }

        /* Play-chat heading (Pixelify Sans) */
        body.tw-worlds-play .mp-chat-head-title {
          font-family: 'Pixelify Sans', monospace;
          font-size: 13px;
          color: #cfe0ff;
          letter-spacing: .03em;
        }

        /* Players tab */
        .tw-play-chat-players { display: none; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1 1 auto; padding: 8px 6px; }
        .tw-play-chat-players.is-active { display: flex; }
        .tw-play-chat-player-row {
          display: flex; align-items: center; gap: 8px; padding: 5px 8px;
          border-radius: 8px;
          background: rgba(20,30,60,.35);
          border: 1px solid rgba(80,110,200,.12);
          font-family: 'Space Grotesk', system-ui, sans-serif;
          font-size: 12px; color: #cfe0ff;
        }
        .tw-play-chat-player-row.is-self { border-color: rgba(80,130,230,.3); }
        .tw-play-chat-av {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; font-family: 'Space Grotesk', system-ui, sans-serif;
          color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4);
        }
        .tw-play-chat-pname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tw-play-chat-you { font-size: 9px; color: rgba(160,190,240,.55); background: rgba(80,110,200,.15);
          border: 1px solid rgba(80,110,200,.2); border-radius: 4px; padding: 1px 4px; flex-shrink: 0; }
        .tw-play-chat-fly-badge { flex-shrink: 0; color: #7ec8e0; display: inline-flex; align-items: center; }
        .tw-play-chat-player-row.is-flying { border-color: rgba(80,190,230,.3); }

        /* @mention chips (inline) + the special @lobby broadcast chip. */
        .tw-chat-at { color: #a8c8ff; font-weight: 700; background: rgba(80,130,230,.16); border-radius: 4px; padding: 0 3px; }
        .tw-chat-at.is-lobby { color: #ffd27f; background: rgba(255,190,90,.16); }
        /* A message that @-mentions the local player: accent border + glow (the "notification"). */
        body.tw-worlds-play .mp-chat-msg.is-mention {
          background: rgba(60,90,180,.4);
          border-color: rgba(120,160,255,.6);
          box-shadow: 0 0 0 1px rgba(120,160,255,.4), 0 0 14px -4px rgba(120,160,255,.55);
        }

        /* Clickable names — zoom-to-player affordance. */
        body.tw-worlds-play .mp-chat-name.tw-chat-clickable,
        .tw-play-chat-pname.tw-chat-clickable { cursor: pointer; text-decoration: underline; text-decoration-color: transparent; transition: text-decoration-color .1s; }
        body.tw-worlds-play .mp-chat-name.tw-chat-clickable:hover,
        .tw-play-chat-pname.tw-chat-clickable:hover { text-decoration-color: currentColor; }

        /* Per-message meta row: name + time on the left, reply button on the right. */
        body.tw-worlds-play .mp-chat-meta { display: flex; align-items: center; gap: 6px; }
        .tw-chat-reply-btn {
          margin-left: auto; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; padding: 0;
          border: none; border-radius: 6px; background: transparent;
          color: #7e9bd0; cursor: pointer; opacity: 0; transition: opacity .1s, background .1s, color .1s;
        }
        .mp-chat-msg:hover .tw-chat-reply-btn { opacity: 1; }
        .tw-chat-reply-btn:hover { background: rgba(255,255,255,.08); color: #cfe0ff; }
        .tw-chat-reply-btn:focus-visible { opacity: 1; outline: 2px solid rgba(80,130,230,.6); }

        /* Quoted-parent block above a reply's text. */
        .tw-chat-quote {
          display: flex; flex-direction: column; gap: 1px; width: 100%;
          margin: 0 0 4px; padding: 4px 8px; text-align: left;
          border: none; border-left: 2px solid rgba(120,160,240,.55);
          border-radius: 4px; background: rgba(80,110,200,.12);
          cursor: pointer; font-family: 'Space Grotesk', system-ui, sans-serif;
        }
        .tw-chat-quote:hover { background: rgba(80,110,200,.2); }
        .tw-chat-quote-name { font-size: 10px; font-weight: 700; color: #9db8ee; }
        .tw-chat-quote-text { font-size: 11px; color: rgba(200,216,245,.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Brief flash when jumping to an original message. */
        @keyframes tw-chat-jump { 0% { background: rgba(90,138,224,.5); } 100% { background: rgba(20,30,60,.35); } }
        body.tw-worlds-play .mp-chat-msg.tw-chat-jumped { animation: tw-chat-jump 1.1s ease-out; }

        /* "Replying to ..." bar above the input. */
        .tw-chat-replybar {
          display: none; align-items: center; gap: 8px; flex: 0 0 auto;
          margin: 0 1px 4px; padding: 5px 8px;
          border: 1px solid rgba(80,110,200,.22); border-left: 2px solid rgba(120,160,240,.6);
          border-radius: 8px; background: rgba(80,110,200,.12);
          font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 11px; color: #cfe0ff;
        }
        .tw-chat-replybar.is-active { display: flex; }
        .tw-chat-replybar-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .tw-chat-replybar-label { font-size: 10px; color: #9db8ee; }
        .tw-chat-replybar-label b { color: #cfe0ff; }
        .tw-chat-replybar-snip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(200,216,245,.7); }
        .tw-chat-replybar-x {
          flex-shrink: 0; width: 20px; height: 20px; padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border: none; border-radius: 6px; background: transparent; color: #8aa4d0; cursor: pointer;
        }
        .tw-chat-replybar-x:hover { background: rgba(255,255,255,.08); color: #cfe0ff; }

        /* Resize grip — bottom-right inner corner. The panel keeps the base
           stylesheet's position:fixed (bottom-right anchored); fixed already
           establishes a containing block for this absolutely-positioned grip,
           so we must NOT override it with position:relative (that drops the
           panel into normal flow and it opens top-left). */
        .tw-chat-resize {
          position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px;
          cursor: nwse-resize; touch-action: none; z-index: 2; opacity: .5;
          background:
            linear-gradient(135deg, transparent 0 50%, rgba(150,180,240,.7) 50% 60%, transparent 60% 70%, rgba(150,180,240,.7) 70% 80%, transparent 80%);
        }
        .tw-chat-resize:hover { opacity: 1; }
        .mp-chat-panel.resizing { transition: none; user-select: none; }
      `;
      document.head.appendChild(s);
    }

    // ---- state -------------------------------------------------------------
    let toggleEl = null, panelEl = null, logEl = null, typingEl = null;
    let inputEl = null, playersEl = null, badgeEl = null;
    let chatTabEl = null, playersTabEl = null;
    let replyBarEl = null, replyBarLabelEl = null, replyBarSnipEl = null;
    let activeTab = 'chat';
    let isOpen = false;
    let unread = 0;
    let typingPeers = new Map(); // id -> { name, timer }
    let myId = null;
    let peers = [];
    let pendingReply = null; // { id, name, snippet } while composing a reply
    const SIZE_LS = 'tinyworld:playchat:size';

    // ---- helpers -----------------------------------------------------------
    function initials(name) {
      const parts = String(name || '?').trim().split(/\s+/);
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
    }

    function fmtTime(ts) {
      const d = new Date(ts || Date.now());
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }

    function isVisible() { return !!panelEl && panelEl.classList.contains('visible'); }

    // ---- @mentions ----------------------------------------------------------
    // Handles the local player answers to: their full display name with spaces/
    // punctuation stripped, and their first word. Lets others type @Name or @FullName.
    function selfHandles() {
      const n = String((typeof WS.playerName === 'function' ? WS.playerName() : '') || '').toLowerCase();
      if (!n) return [];
      const stripped = n.replace(/[^a-z0-9]/g, '');
      const first = n.split(/\s+/)[0] || '';
      return Array.from(new Set([stripped, first].filter(Boolean)));
    }
    // Does `text` @-mention the local player? (`@lobby` is the screen-broadcast keyword, never a person.)
    function textMentionsMe(text) {
      const handles = selfHandles();
      if (!handles.length) return false;
      const re = /@([a-z0-9_]+)/gi;
      let m;
      while ((m = re.exec(String(text || '')))) {
        const tok = m[1].toLowerCase();
        if (tok === 'lobby') continue;
        if (handles.includes(tok)) return true;
      }
      return false;
    }
    // Render chat text into `el`, turning @tokens into styled chips. DOM-built (no
    // innerHTML) so message text can never inject markup.
    function renderChatText(el, text) {
      el.textContent = '';
      const str = String(text == null ? '' : text);
      const re = /@([a-z0-9_]+)/gi;
      let last = 0, m;
      while ((m = re.exec(str))) {
        if (m.index > last) el.appendChild(document.createTextNode(str.slice(last, m.index)));
        const chip = document.createElement('span');
        chip.className = 'tw-chat-at' + (m[1].toLowerCase() === 'lobby' ? ' is-lobby' : '');
        chip.textContent = '@' + m[1];
        el.appendChild(chip);
        last = m.index + m[0].length;
      }
      if (last < str.length) el.appendChild(document.createTextNode(str.slice(last)));
    }

    function loadSize() {
      try {
        const raw = localStorage.getItem(SIZE_LS);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) return v;
      } catch (_) {}
      return null;
    }
    function saveSize(w, h) {
      try { localStorage.setItem(SIZE_LS, JSON.stringify({ w: Math.round(w), h: Math.round(h) })); } catch (_) {}
    }

    function focusPlayer(id) {
      if (id != null && typeof WS.focusPlayer === 'function') WS.focusPlayer(id);
    }

    function clearPendingReply() {
      pendingReply = null;
      if (replyBarEl) replyBarEl.classList.remove('is-active');
    }
    function setPendingReply(d) {
      const id = d && d.mid;
      if (!id) return; // without a stable message id the reply can't round-trip
      pendingReply = { id, name: d.name || 'Player', snippet: String(d.text || '').slice(0, 120) };
      if (replyBarEl) {
        replyBarLabelEl.innerHTML = '';
        replyBarLabelEl.appendChild(document.createTextNode('Replying to '));
        const b = document.createElement('b');
        b.textContent = pendingReply.name;
        replyBarLabelEl.appendChild(b);
        replyBarSnipEl.textContent = pendingReply.snippet;
        replyBarEl.classList.add('is-active');
      }
      if (inputEl) inputEl.focus();
    }
    function jumpToMessage(mid) {
      if (!logEl || !mid) return;
      const orig = logEl.querySelector('[data-mid="' + (window.CSS && CSS.escape ? CSS.escape(mid) : mid) + '"]');
      if (!orig) return;
      orig.scrollIntoView({ block: 'center', behavior: 'smooth' });
      orig.classList.remove('tw-chat-jumped');
      // reflow so the animation restarts even on repeat clicks
      void orig.offsetWidth;
      orig.classList.add('tw-chat-jumped');
    }

    // ---- DOM ---------------------------------------------------------------
    function ensureToggle() {
      if (toggleEl) return toggleEl;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mp-chat-toggle';
      btn.dataset.posType = 'play';
      btn.setAttribute('aria-label', 'Open play chat');
      btn.appendChild(ic('chat', 18));
      const badge = document.createElement('span');
      badge.className = 'mp-chat-badge';
      badge.setAttribute('aria-hidden', 'true');
      btn.appendChild(badge);
      btn.addEventListener('click', toggleChat);
      document.body.appendChild(btn);
      toggleEl = btn;
      badgeEl = badge;
      return btn;
    }

    function ensurePanel() {
      if (panelEl) return panelEl;

      const panel = document.createElement('section');
      panel.className = 'mp-chat-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Play mode chat');

      // Head
      const head = document.createElement('div');
      head.className = 'mp-chat-head';
      head.setAttribute('aria-label', 'Drag to move chat');
      const title = document.createElement('span');
      title.className = 'mp-chat-head-title';
      title.textContent = 'Chat';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'mp-chat-close';
      closeBtn.setAttribute('aria-label', 'Close chat');
      closeBtn.appendChild(ic('close', 13));
      closeBtn.addEventListener('click', closeChat);
      head.appendChild(title);
      head.appendChild(closeBtn);

      // Tabs
      const tabs = document.createElement('div');
      tabs.className = 'mp-chat-tabs';
      tabs.style.gridTemplateColumns = '1fr 1fr';
      chatTabEl = makeTab('Chat', 'chat', true);
      playersTabEl = makeTab('Players', 'person', false);
      chatTabEl.addEventListener('click', () => setTab('chat'));
      playersTabEl.addEventListener('click', () => setTab('players'));
      tabs.appendChild(chatTabEl);
      tabs.appendChild(playersTabEl);

      // Log
      const log = document.createElement('div');
      log.className = 'mp-chat-log';
      log.setAttribute('aria-live', 'polite');

      // Players list
      const players = document.createElement('div');
      players.className = 'tw-play-chat-players';

      // Typing
      const typing = document.createElement('div');
      typing.className = 'mp-chat-typing';

      // Form
      const form = document.createElement('form');
      form.className = 'mp-chat-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'mp-chat-input';
      input.maxLength = 280;
      input.placeholder = 'Message...';
      input.setAttribute('aria-label', 'Chat message');
      input.autocomplete = 'off';
      const sendBtn = document.createElement('button');
      sendBtn.type = 'submit';
      sendBtn.className = 'mp-chat-send';
      sendBtn.setAttribute('aria-label', 'Send');
      sendBtn.appendChild(ic('send', 16));
      form.appendChild(input);
      form.appendChild(sendBtn);

      let typingTimer = null;
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const text = input.value.trim();
        if (text && typeof WS.sendChat === 'function') WS.sendChat(text, pendingReply);
        input.value = '';
        clearPendingReply();
        clearTimeout(typingTimer);
        if (typeof WS.sendTyping === 'function') WS.sendTyping(false);
      });
      // Esc clears a pending reply (before it would bubble to close the panel).
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && pendingReply) { ev.stopPropagation(); clearPendingReply(); }
      });
      input.addEventListener('input', () => {
        if (typeof WS.sendTyping === 'function') {
          WS.sendTyping(input.value.trim().length > 0);
          clearTimeout(typingTimer);
          typingTimer = setTimeout(() => {
            if (typeof WS.sendTyping === 'function') WS.sendTyping(false);
          }, 3000);
        }
      });
      input.addEventListener('blur', () => {
        clearTimeout(typingTimer);
        if (typeof WS.sendTyping === 'function') WS.sendTyping(false);
      });

      // Reply bar (above the input; hidden until you reply to a message)
      const replyBar = document.createElement('div');
      replyBar.className = 'tw-chat-replybar';
      const replyBody = document.createElement('div');
      replyBody.className = 'tw-chat-replybar-body';
      const replyLabel = document.createElement('span');
      replyLabel.className = 'tw-chat-replybar-label';
      const replySnip = document.createElement('span');
      replySnip.className = 'tw-chat-replybar-snip';
      replyBody.appendChild(replyLabel);
      replyBody.appendChild(replySnip);
      const replyX = document.createElement('button');
      replyX.type = 'button';
      replyX.className = 'tw-chat-replybar-x';
      replyX.setAttribute('aria-label', 'Cancel reply');
      replyX.appendChild(ic('close', 12));
      replyX.addEventListener('click', clearPendingReply);
      replyBar.appendChild(replyBody);
      replyBar.appendChild(replyX);

      // Resize grip (bottom-right inner corner)
      const grip = document.createElement('div');
      grip.className = 'tw-chat-resize';
      grip.setAttribute('aria-hidden', 'true');

      panel.appendChild(head);
      panel.appendChild(tabs);
      panel.appendChild(log);
      panel.appendChild(players);
      panel.appendChild(typing);
      panel.appendChild(replyBar);
      panel.appendChild(form);
      panel.appendChild(grip);
      document.body.appendChild(panel);

      panelEl = panel;
      logEl = log;
      typingEl = typing;
      inputEl = input;
      playersEl = players;
      replyBarEl = replyBar;
      replyBarLabelEl = replyLabel;
      replyBarSnipEl = replySnip;

      // Restore a previously chosen size (stays bottom-right anchored, so it
      // grows up/left from the corner — never off-screen).
      const saved = loadSize();
      if (saved) {
        panel.style.width = Math.min(saved.w, window.innerWidth - 16) + 'px';
        panel.style.height = Math.min(saved.h, window.innerHeight - 16) + 'px';
      }

      wireDrag(panel, head);
      wireResize(panel, grip);
      setTab('chat');
      return panel;
    }

    // ---- resize ------------------------------------------------------------
    function wireResize(panel, grip) {
      const MINW = 240, MINH = 280;
      let rz = false, sx = 0, sy = 0, sw = 0, sh = 0, baseL = 0, baseT = 0;
      grip.addEventListener('pointerdown', (e) => {
        rz = true; panel.classList.add('resizing');
        const r = panel.getBoundingClientRect();
        // Normalize to top/left so the panel grows down/right from a fixed corner.
        panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        baseL = r.left; baseT = r.top; sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
        grip.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      grip.addEventListener('pointermove', (e) => {
        if (!rz) return;
        const maxW = window.innerWidth - baseL - 8;
        const maxH = window.innerHeight - baseT - 8;
        panel.style.width = Math.max(MINW, Math.min(maxW, sw + (e.clientX - sx))) + 'px';
        panel.style.height = Math.max(MINH, Math.min(maxH, sh + (e.clientY - sy))) + 'px';
      });
      grip.addEventListener('pointerup', () => {
        if (!rz) return; rz = false; panel.classList.remove('resizing');
        saveSize(panel.offsetWidth, panel.offsetHeight);
      });
    }

    function makeTab(label, iconName, active) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mp-chat-tab' + (active ? ' is-active' : '');
      tab.appendChild(ic(iconName, 13));
      const span = document.createElement('span');
      span.textContent = label;
      tab.appendChild(span);
      return tab;
    }

    function setTab(tab) {
      activeTab = tab;
      if (!logEl || !playersEl) return;
      if (tab === 'chat') {
        logEl.style.display = '';
        playersEl.classList.remove('is-active');
        if (chatTabEl) chatTabEl.className = 'mp-chat-tab is-active';
        if (playersTabEl) playersTabEl.className = 'mp-chat-tab';
      } else {
        logEl.style.display = 'none';
        playersEl.classList.add('is-active');
        if (chatTabEl) chatTabEl.className = 'mp-chat-tab';
        if (playersTabEl) playersTabEl.className = 'mp-chat-tab is-active';
      }
    }

    // ---- drag --------------------------------------------------------------
    function wireDrag(panel, head) {
      let dragging = false, ox = 0, oy = 0;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.mp-chat-close')) return;
        dragging = true; panel.classList.add('dragging');
        const r = panel.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        panel.style.left = Math.min(Math.max(0, e.clientX - ox), vw - pw) + 'px';
        panel.style.top  = Math.min(Math.max(0, e.clientY - oy), vh - ph) + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
      });
      head.addEventListener('pointerup', () => { dragging = false; panel.classList.remove('dragging'); });
    }

    // ---- chat operations ---------------------------------------------------
    function openChat() {
      ensurePanel();
      ensureToggle();
      panelEl.classList.add('visible');
      toggleEl.classList.add('is-open');
      isOpen = true;
      unread = 0; updateBadge();
      if (activeTab === 'chat') scrollLog();
    }

    function closeChat() {
      if (panelEl) panelEl.classList.remove('visible');
      if (toggleEl) toggleEl.classList.remove('is-open');
      isOpen = false;
      // Return keyboard focus to the document so WASD/arrow movement works again.
      if (inputEl && document.activeElement === inputEl) inputEl.blur();
    }

    function toggleChat() { isOpen ? closeChat() : openChat(); }

    function updateBadge() {
      if (!badgeEl) return;
      if (unread > 0 && !isOpen) {
        badgeEl.textContent = unread > 99 ? '99+' : String(unread);
        badgeEl.classList.add('visible');
      } else {
        badgeEl.classList.remove('visible');
      }
    }

    function scrollLog() {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    // ---- message rendering -------------------------------------------------
    function addMessage(d) {
      if (!logEl) return;
      const currentId = (typeof WS.getMyId === 'function' ? WS.getMyId() : null) || myId;
      const self = d.id && d.id === currentId;
      // A message that @-mentions us (and isn't our own) is highlighted as a notification.
      const mentionsMe = !self && textMentionsMe(d.text);
      const row = document.createElement('div');
      row.className = 'mp-chat-msg' + (self ? ' is-self' : '') + (mentionsMe ? ' is-mention' : '');
      if (d.mid) row.dataset.mid = d.mid;

      // Quoted parent (denormalized on the message — renders even if we never
      // saw the original). Clicking scrolls to the original when it's in the log.
      if (d.replyTo && (d.replyTo.name || d.replyTo.snippet)) {
        const q = document.createElement('button');
        q.type = 'button';
        q.className = 'tw-chat-quote';
        const qn = document.createElement('span');
        qn.className = 'tw-chat-quote-name';
        qn.textContent = d.replyTo.name || 'Player';
        const qt = document.createElement('span');
        qt.className = 'tw-chat-quote-text';
        qt.textContent = d.replyTo.snippet || '';
        q.appendChild(qn);
        q.appendChild(qt);
        q.addEventListener('click', () => jumpToMessage(d.replyTo.id));
        row.appendChild(q);
      }

      const meta = document.createElement('div');
      meta.className = 'mp-chat-meta';

      // colored avatar dot
      const av = document.createElement('span');
      av.className = 'tw-play-chat-av';
      av.style.background = d.color || peerColor(d.id);
      av.style.width = '18px'; av.style.height = '18px'; av.style.fontSize = '8px';
      av.textContent = initials(d.name || '?');
      meta.appendChild(av);

      const nameEl = document.createElement('span');
      nameEl.className = 'mp-chat-name tw-chat-clickable';
      nameEl.style.color = d.color || peerColor(d.id);
      nameEl.textContent = d.name || 'Player';
      nameEl.setAttribute('role', 'button');
      nameEl.tabIndex = 0;
      nameEl.title = 'Zoom to ' + (d.name || 'player');
      nameEl.addEventListener('click', () => focusPlayer(d.id));
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusPlayer(d.id); } });
      meta.appendChild(nameEl);

      const timeEl = document.createElement('span');
      timeEl.className = 'mp-chat-time';
      timeEl.textContent = fmtTime(d.ts);
      meta.appendChild(timeEl);

      // Reply affordance (appears on row hover; needs a stable message id). Action
      // lines (chat emotes) are system text — no reply target — so skip it.
      if (!d.action) {
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'tw-chat-reply-btn';
        replyBtn.setAttribute('aria-label', 'Reply');
        replyBtn.title = 'Reply';
        replyBtn.appendChild(ic('reply', 13));
        replyBtn.addEventListener('click', () => setPendingReply(d));
        meta.appendChild(replyBtn);
      }

      const textEl = document.createElement('div');
      textEl.className = 'mp-chat-text';
      renderChatText(textEl, d.text);
      if (d.action) { textEl.style.fontStyle = 'italic'; textEl.style.opacity = '0.85'; }

      row.appendChild(meta);
      row.appendChild(textEl);
      logEl.appendChild(row);

      if (isOpen && activeTab === 'chat') { scrollLog(); }
      else if (!isOpen) { unread++; updateBadge(); }
    }

    function peerColor(id) {
      const p = peers.find(x => x.id === id);
      return (p && p.color) || '#5a78e0';
    }

    // ---- typing indicators -------------------------------------------------
    function updateTyping(d) {
      if (!typingEl) return;
      if (d.typing) {
        clearTimeout(typingPeers.has(d.id) ? typingPeers.get(d.id).timer : null);
        const timer = setTimeout(() => { typingPeers.delete(d.id); renderTyping(); }, 4000);
        typingPeers.set(d.id, { name: d.name || 'Player', timer });
      } else {
        if (typingPeers.has(d.id)) {
          clearTimeout(typingPeers.get(d.id).timer);
          typingPeers.delete(d.id);
        }
      }
      renderTyping();
    }

    function renderTyping() {
      if (!typingEl) return;
      const names = Array.from(typingPeers.values()).map(t => t.name);
      if (names.length === 0) {
        typingEl.textContent = '';
        typingEl.classList.remove('visible');
      } else {
        typingEl.textContent = names.length === 1
          ? names[0] + ' is typing...'
          : names.slice(0, 2).join(', ') + ' are typing...';
        typingEl.classList.add('visible');
      }
    }

    // ---- players list ------------------------------------------------------
    function renderPlayers(you) {
      if (!playersEl) return;
      playersEl.innerHTML = '';

      // Self row first
      const selfName = typeof WS.playerName === 'function' ? WS.playerName() : 'You';
      const selfColor = typeof WS.playerColor === 'function' ? WS.playerColor() : '#5a78e0';
      playersEl.appendChild(makePlayerRow(myId, selfName, selfColor, true));

      for (const p of peers) {
        playersEl.appendChild(makePlayerRow(p.id, p.name || 'Player', p.color || '#5a78e0', false));
      }
    }

    function makePlayerRow(id, name, color, isSelf) {
      const flying = typeof WS.isFlying === 'function' ? WS.isFlying(id) : false;
      const row = document.createElement('div');
      row.className = 'tw-play-chat-player-row' + (isSelf ? ' is-self' : '') + (flying ? ' is-flying' : '');
      const av = document.createElement('span');
      av.className = 'tw-play-chat-av';
      av.style.background = color;
      av.textContent = initials(name);
      const nameEl = document.createElement('span');
      nameEl.className = 'tw-play-chat-pname tw-chat-clickable';
      nameEl.style.color = color;
      nameEl.textContent = name;
      nameEl.setAttribute('role', 'button');
      nameEl.tabIndex = 0;
      nameEl.title = 'Zoom to ' + name;
      nameEl.addEventListener('click', () => focusPlayer(id));
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusPlayer(id); } });
      row.appendChild(av);
      row.appendChild(nameEl);
      if (flying) {
        // Small plane icon indicating this player is currently flying. SVG only — no emoji, no PNG.
        const flBadge = document.createElement('span');
        flBadge.className = 'tw-play-chat-fly-badge';
        flBadge.setAttribute('aria-label', 'flying');
        flBadge.setAttribute('title', name + ' is flying');
        flBadge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" style="vertical-align:middle"><path d="M2 12 L22 4 L14 22 L11 14 Z M11 14 L22 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        row.appendChild(flBadge);
      }
      if (isSelf) {
        const you = document.createElement('span');
        you.className = 'tw-play-chat-you';
        you.textContent = 'you';
        row.appendChild(you);
      }
      return row;
    }

    function resetChatForWorld() {
      if (logEl) logEl.textContent = '';
      typingPeers.forEach((v) => { try { clearTimeout(v.timer); } catch (_) {} });
      typingPeers.clear();
      if (typingEl) typingEl.textContent = '';
      clearPendingReply();
      peers = [];
      unread = 0;
      updateBadge();
      renderPlayers(null);
    }

    // ---- WS event wiring ---------------------------------------------------
    on('enter', () => {
      injectStyles();
      ensureToggle();
      ensurePanel();
      resetChatForWorld();
      toggleEl.style.display = 'inline-flex';
    });

    on('leave', () => {
      if (toggleEl) toggleEl.style.display = 'none';
      closeChat();
      resetChatForWorld();
    });

    on('you', (you) => {
      myId = (typeof WS.getMyId === 'function' ? WS.getMyId() : null) || myId;
      renderPlayers(you);
    });

    on('peers', (ps) => {
      peers = ps || [];
      renderPlayers(null);
    });

    // Flight state changed (self or a peer took off / landed / left mid-flight). 47
    // emits 'flight' on every transition; re-render so the per-row plane badge tracks
    // it instead of only updating by coincidence on the next peers/you event.
    on('flight', () => renderPlayers(null));

    on('chat', (d) => {
      addMessage(d);
    });

    on('typing', (d) => {
      updateTyping(d);
    });

    on('status', (d) => {
      if (d && !d.connected) {
        typingPeers.clear();
        renderTyping();
      }
    });

    // Keep a resized/moved panel inside the viewport when the window shrinks.
    window.addEventListener('resize', () => {
      if (!panelEl) return;
      const maxW = window.innerWidth - 16, maxH = window.innerHeight - 16;
      if (panelEl.offsetWidth > maxW) panelEl.style.width = maxW + 'px';
      if (panelEl.offsetHeight > maxH) panelEl.style.height = maxH + 'px';
      if (panelEl.style.left && panelEl.style.left !== 'auto') {
        const pw = panelEl.offsetWidth, ph = panelEl.offsetHeight;
        panelEl.style.left = Math.min(Math.max(0, parseFloat(panelEl.style.left)), window.innerWidth - pw) + 'px';
        panelEl.style.top = Math.min(Math.max(0, parseFloat(panelEl.style.top)), window.innerHeight - ph) + 'px';
      }
    });

    // Start hidden
    setTimeout(() => {
      ensureToggle();
      if (toggleEl) toggleEl.style.display = 'none';
    }, 0);

  })();
