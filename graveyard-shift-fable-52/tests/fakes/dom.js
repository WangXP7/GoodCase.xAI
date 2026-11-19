// A very small stand-in for the DOM: enough for code that builds a few elements, finds them by id or
// class and listens for clicks. Not a browser: no layout, no CSS, selectors are '#id', '.class' and
// '#id .class' only.
export function createFakeDoc() {
  const all = new Set();
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parent: null, attrs: {}, listeners: {}, style: {}, hidden: false,
      textContent: '', value: '', id: '', className: '',
      get classList() {
        const self = this;
        return {
          add(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' '); },
          remove(c) { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
          contains(c) { return self.className.split(/\s+/).includes(c); },
        };
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      dispatch(t, ev = {}) { for (const fn of this.listeners[t] || []) fn(ev); },
      click() { this.dispatch('click'); },
      append(...kids) { for (const k of kids) this.appendChild(k); },
      appendChild(k) { if (k.parent) k.remove(); k.parent = this; this.children.push(k); all.add(k); return k; },
      remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } },
      select() {},
      querySelector(sel) { return find(this, sel); },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
    };
    return e;
  };
  const matches = (e, part) => (part.startsWith('#') ? e.id === part.slice(1) : part.startsWith('.') ? e.className.split(/\s+/).includes(part.slice(1)) : e.tagName === part.toUpperCase());
  const walk = (root, fn) => { for (const k of root.children) { if (fn(k)) return k; const r = walk(k, fn); if (r) return r; } return null; };
  const find = (root, sel) => {
    const parts = sel.trim().split(/\s+/);
    if (parts.length === 1) return walk(root, (e) => matches(e, parts[0]));
    const outer = find(root, parts[0]);
    return outer ? find(outer, parts.slice(1).join(' ')) : null;
  };
  const doc = {
    body: null,
    createElement: make,
    getElementById: (id) => walk(doc.body, (e) => e.id === id),
    querySelector: (sel) => find(doc.body, sel),
    execCommand: () => true,
  };
  doc.body = make('body');
  return doc;
}

// window-like timers driven by hand: advance(ms) runs everything due, in time order.
export function createFakeWin(extra = {}) {
  let now = 0; let seq = 0;
  const timers = new Map();
  const win = {
    navigator: { userAgent: 'TestAgent/1.0' },
    location: { reload() { win.reloaded = (win.reloaded || 0) + 1; } },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    now: () => now,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
    ...extra,
  };
  return win;
}
