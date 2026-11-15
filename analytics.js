/* GoodCase foreground visit telemetry. No read credentials or recipient address belong here. */
(() => {
  'use strict';
  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint;
  const siteOrigin = 'https://wangxp7.github.io';
  const prefix = '/GoodCase.xAI/';
  if (!endpoint || location.origin !== siteOrigin || !location.pathname.startsWith(prefix)) return;
  try { if (window !== window.top && window.top.GoodCaseAnalytics) return; } catch {}
  const OPT = 'goodcase-analytics-optout', VISITOR = 'goodcase-analytics-visitor', SESSION = 'goodcase-analytics-session';
  const read = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const write = (store, key, value) => { try { store.setItem(key, value); } catch {} };
  const privacy = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || read(localStorage, OPT) === 'true';
  let paused = privacy(), page = null, lastTick = performance.now(), lastFlush = performance.now(), sending = false;
  const storedVisitor = read(localStorage, VISITOR);
  const visitor = /^[a-f\d-]{36}$/i.test(storedVisitor || '') ? storedVisitor : crypto.randomUUID();
  const api = new URL(endpoint);
  if (api.protocol !== 'https:' || api.pathname !== '/collect') return;
  if (!paused) write(localStorage, VISITOR, visitor);
  function session() {
    let old; try { old = JSON.parse(read(sessionStorage, SESSION)); } catch {}
    const now = Date.now();
    if (!old || now - old.last > 1800000 || !/^[a-f\d-]{36}$/i.test(old.id || '')) old = { id: crypto.randomUUID() };
    old.last = now; write(sessionStorage, SESSION, JSON.stringify(old)); return old.id;
  }
  function canonical(value = location.href, depth = 0) {
    if (depth > 2) return null;
    const url = new URL(value, siteOrigin);
    if (url.origin !== siteOrigin || !url.pathname.startsWith(prefix)) return null;
    if (url.pathname === prefix + 'case.html' && url.searchParams.has('id')) return canonical(prefix + url.searchParams.get('id'), depth + 1);
    return url.pathname; // Never transmit search terms, arbitrary queries or hashes.
  }
  function payload(target, kind) {
    return { kind, page_id: target.id, visit_id: target.visit, visitor_id: visitor, path: target.path,
      title: target.title, referrer: document.referrer, active_ms: Math.floor(target.active), token: target.token };
  }
  async function open(target) {
    if (paused || page !== target) return;
    try {
      const response = await fetch(api.href, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload(target, 'open')), keepalive: true });
      if (response.ok) { const data = await response.json(); target.token = data.token; }
    } catch { /* Analytics failure must not interrupt the case. */ }
  }
  function accumulate() {
    const now = performance.now(), elapsed = Math.min(2000, Math.max(0, now - lastTick)); lastTick = now;
    if (page && !paused && document.visibilityState === 'visible' && document.hasFocus()) page.active += elapsed;
  }
  function flush(beacon = false) {
    if (!page || paused || !page.token || sending && !beacon) return;
    accumulate();
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      try { const current = JSON.parse(read(sessionStorage, SESSION)); if (current?.id === page.visit) { current.last = Date.now(); write(sessionStorage, SESSION, JSON.stringify(current)); } } catch {}
    }
    const body = JSON.stringify(payload(page, 'pulse'));
    if (beacon && navigator.sendBeacon(api.href, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    sending = true;
    fetch(api.href, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, keepalive: true })
      .catch(() => {}).finally(() => { sending = false; });
  }
  function start(path = canonical(), title = document.title) {
    if (!path || paused) return;
    if (page && page.path === path && Date.now() - page.opened < 43200000) { page.title = title; return; }
    flush(true);
    page = { id: crypto.randomUUID(), visit: session(), path, title: String(title).slice(0, 160), active: 0, opened: Date.now(), token: null };
    lastTick = performance.now(); lastFlush = lastTick; open(page);
  }
  window.GoodCaseAnalytics = {
    exclude() { flush(true); write(localStorage, OPT, 'true'); paused = true; page = null; },
    include() { write(localStorage, OPT, 'false'); location.reload(); },
    get excluded() { return privacy(); }
  };
  addEventListener('storage', event => { if (event.key === OPT && privacy()) { paused = true; page = null; } });
  if ([prefix, prefix + 'index.html'].includes(location.pathname)) {
    const notice = () => {
      const footer = document.querySelector('footer');
      if (!footer || footer.querySelector('#goodcase-privacy')) return;
      const link = document.createElement('a'); link.id = 'goodcase-privacy'; link.href = prefix + 'analytics-privacy.html';
      link.textContent = '访问统计说明 / 退出统计'; link.style.marginLeft = '12px'; footer.append(link);
    };
    notice(); new MutationObserver(notice).observe(document.body, { childList: true, subtree: true });
  }
  if (paused) return;
  if (!document.getElementById('original')) start();
  setInterval(() => {
    if (paused) return;
    accumulate();
    if (page && Date.now() - page.opened >= 43200000) start(page.path, page.title);
    if (performance.now() - lastFlush >= 60000 && document.visibilityState === 'visible' && document.hasFocus()) { lastFlush = performance.now(); if (page?.token) flush(); else if (page) open(page); }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    accumulate();
    if (document.visibilityState === 'hidden') flush(true);
    else if (page) {
      let last = Date.now(); try { last = JSON.parse(read(sessionStorage, SESSION))?.last || last; } catch {}
      if (Date.now() - last > 1800000) { page.opened = 0; start(page.path, page.title); }
      else if (!page.token) open(page);
    }
  });
  addEventListener('pagehide', () => flush(true));
  addEventListener('blur', () => { accumulate(); flush(true); });
  const original = document.getElementById('original');
  if (original) {
    const changed = () => { const path = canonical(original.href); if (path) start(path, document.getElementById('title')?.textContent || document.title); };
    new MutationObserver(changed).observe(original, { attributes: true, attributeFilter: ['href'] });
    if (original.hasAttribute('href')) changed();
  }
})();
