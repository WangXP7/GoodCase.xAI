// Menu screens: title, paused, dead, settings, controls. DOM only; game actions arrive via `actions`.
import { createWordmark } from './wordmark.js';
import { controlsColumns, createInfoPanel } from './infoPanel.js';
import { formatPoints, QUALITIES, QUALITY_LABELS, qualityLabel, needsQualityConfirm, GORE, ASSIST_NAMES, SETTING_RANGES } from './format.js';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const kids = (parent, ...els) => { for (const e of els) parent.appendChild(e); return parent; };

// A menu row: NAME on the left, a short hint on the right
function row(label, hint, onClick, opts = {}) {
  const b = h('button', `gs-row${opts.small ? ' small' : ''}`);
  b.type = 'button';
  kids(b, h('span', 'k', label), h('span', 'lead'), h('span', 'hint', hint || ''));
  b.addEventListener('click', onClick);
  if (opts.auto) b.dataset.autofocus = '1';
  return b;
}
// A line with two ends, for stats and settings (the middle span is only a spacer).
const leaderLine = (cls, left, right) => kids(h('div', cls), left, h('span', 'lead'), right);


// The controls card on its own (the Controls screen): two columns, keyboard and touch. CSS puts the active device's column first.
function controlsCard() {
  const card = h('div', 'gs-card');
  card.appendChild(h('p', 'gs-eyebrow', 'House rules'));
  card.appendChild(controlsColumns());
  return card;
}

export function createMenus(G, root, { settings, actions, sample }) {
  const screens = {};
  const fullscreenOk = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  let current = null;
  let backTo = null;

  function screen(name, cls) {
    const el = h('section', `gs-screen ${cls || ''}`);
    el.dataset.screen = name;
    el.setAttribute('aria-hidden', 'true');
    const col = h('div', 'gs-col');
    el.appendChild(col);
    root.appendChild(el);
    screens[name] = { el, col };
    return col;
  }
  const heading = (small, big) => kids(h('header', 'gs-head'), h('p', 'gs-eyebrow', small), h('h2', 'gs-h', big));

  // ---- title ----
  {
    const col = screen('title', 'gs-title');
    const exit = kids(h('p', 'gs-exit'), h('span', 'tab', 'Exit 114'), h('span', 'sub', 'Nightjar truck stop · Open all night'));
    const mark = createWordmark({ tag: 'h1' });
    const premise = h('p', 'gs-premise', 'One truck stop, ten guns, and a night that does not end.');
    const list = h('nav', 'gs-list');
    list.setAttribute('aria-label', 'Main menu');
    kids(list,
      row('Play', 'Clock in', () => actions.play(), { auto: true }),
      row('Settings', 'Picture · Controls · Sound', () => show('settings')));
    if (fullscreenOk) {
      list.appendChild(row('Full screen', 'Hides the browser bars', () => {
        try { const p = document.documentElement.requestFullscreen?.(); if (p && p.catch) p.catch(() => {}); } catch { /* refused: nothing to do */ }
      }));
    }
    kids(col, exit, mark, premise, list);
    screens.title.list = list;
    screens.title.el.appendChild(kids(h('aside', 'gs-cardwrap'), createInfoPanel().el));
  }

  // ---- paused ----
  {
    const col = screen('paused', 'gs-pause');
    const list = h('nav', 'gs-list');
    list.setAttribute('aria-label', 'Pause menu');
    kids(list,
      row('Resume', 'Back on shift', () => actions.resume(), { auto: true }),
      row('Settings', 'Picture · Controls · Sound', () => show('settings')));
    kids(col, heading('Shift paused', 'On break'), list);
    screens.paused.list = list;
    screens.paused.el.appendChild(kids(h('aside', 'gs-cardwrap'), createInfoPanel().el));
  }

  // ---- dead ----
  const dead = {};
  {
    const col = screen('dead', 'gs-dead');
    dead.num = h('div', 'gs-bignum', '0');
    const numWrap = kids(h('div', 'gs-bigwrap'), h('p', 'gs-eyebrow', 'Round reached'), dead.num);
    dead.kills = h('span', 'v');
    dead.points = h('span', 'v');
    dead.best = h('span', 'v');
    dead.tag = h('span', 'gs-newbest', 'New best');
    const stats = h('div', 'gs-stats-list');
    kids(stats,
      leaderLine('gs-stat', h('span', 'l', 'Kills'), dead.kills),
      leaderLine('gs-stat', h('span', 'l', 'Points earned'), dead.points),
      leaderLine('gs-stat', kids(h('span', 'l'), document.createTextNode('Best round')), kids(h('span', 'vw'), dead.tag, dead.best)));
    kids(col, heading('Clocked out', 'Shift over'), numWrap, stats, kids(h('nav', 'gs-list'), row('Retry', 'Round 1 · 500 points', () => actions.retry(), { auto: true })));
  }

  // ---- settings ----
  let addSettingsRow = () => null;
  {
    const col = screen('settings', 'gs-settings');
    const rows = h('div', 'gs-setrows');
    const syncers = [];

    // A radio group of text options. Values compare as strings (resolution mixes 'auto' and numbers).
    const resetters = []; // run when the screen opens: an armed confirm does not survive leaving it
    const segRow = (key, label, options, rowCls = '', guard = null, acc = null) => {
      const cur = () => (acc ? acc.get() : settings[key]);
      const put = (v) => (acc ? acc.set(v) : settings.set(key, v));
      let armed = null;
      resetters.push(() => { armed = null; });
      const seg = h('div', 'gs-seg');
      seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', label);
      const warn = h('span', 'note warn gs-only-touch');
      const btns = options.map((o) => {
        const b = h('button', `opt${o.cls ? ` ${o.cls}` : ''}`, o.label);
        b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = String(o.v);
        b.addEventListener('click', () => {
          // a phone leaving Auto/Phone for a desktop tier: the second tap on the same row confirms
          if (guard && guard(cur(), o.v)) {
            if (armed !== o.v) { armed = o.v; warn.textContent = `May run slowly on a phone. Tap ${o.label} again to use it.`; return; }
          }
          armed = null; put(o.v); syncSettings();
        });
        seg.appendChild(b);
        return b;
      });
      seg.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        const vis = btns.filter((b) => b.offsetParent !== null || b.getClientRects().length);
        const list = vis.length ? vis : btns;
        const i = list.findIndex((b) => b.getAttribute('aria-checked') === 'true') + (e.key === 'ArrowRight' ? 1 : -1);
        const nb = list[(i + list.length) % list.length];
        const o = options[btns.indexOf(nb)];
        put(o.v); syncSettings(); nb.focus();
      });
      const left = h('span', 'l', label);
      const note = h('span', 'note');
      const lab = kids(h('span', 'lw'), left, note, warn);
      rows.appendChild(leaderLine(`gs-set ${rowCls}`.trim(), lab, seg));
      syncers.push(() => {
        const now = String(cur());
        for (const b of btns) { const on = b.dataset.v === now; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }
        if (!btns.some((b) => b.tabIndex === 0)) btns[0].tabIndex = 0;
      });
      return { note, warn, btns };
    };
    // Another module's row, with the same keyboard behaviour as the built-in ones (the hint settings):
    // addSettingsRow({ id, label, options:[{v,label}], get(), set(v), note?() -> string, rowCls? }) -> { note }
    addSettingsRow = ({ id, label, options, get, set, note: noteText, rowCls = '' }) => {
      const r = segRow(id, label, options, rowCls, null, { get, set });
      if (noteText) syncers.push(() => { r.note.textContent = String(noteText() || ''); });
      return r;
    };
    const sliders = {};
    const slider = (key, label, fmt, rowCls = '') => {
      const r = SETTING_RANGES[key];
      const input = h('input', 'gs-range');
      input.type = 'range'; input.min = r.min; input.max = r.max; input.step = r.step;
      input.setAttribute('aria-label', label);
      const out = h('output', 'gs-val');
      const paint = () => {
        input.style.setProperty('--p', `${((input.value - r.min) / (r.max - r.min)) * 100}%`);
        out.textContent = fmt(Number(input.value));
      };
      input.addEventListener('input', () => { settings.set(key, Number(input.value)); paint(); });
      sliders[key] = { input, paint };
      rows.appendChild(leaderLine(`gs-set ${rowCls}`.trim(), h('span', 'l', label), kids(h('span', 'ctl'), input, out)));
    };

    const { note: qNote, warn: qWarn } = segRow('quality', 'Quality', QUALITIES.map((q) => ({ v: q, label: QUALITY_LABELS[q], cls: q === 'mobile' ? 'gs-only-touch' : '' })), '',
      (cur, next) => needsQualityConfirm(cur, next, G.input ? G.input.mode === 'touch' : !!(G.device && G.device.touch)));
    segRow('resolution', 'Resolution', [{ v: 'auto', label: 'Auto' }, { v: 0.6, label: '60%' }, { v: 0.8, label: '80%' }, { v: 1, label: '100%' }]);
    segRow('gore', 'Gore', GORE.map((g) => ({ v: g, label: g === 'full' ? 'Full' : 'Reduced' })));
    slider('sens', 'Sensitivity', (v) => `${v.toFixed(2)}×`, 'gs-only-pointer');
    slider('touchSens', 'Drag sensitivity', (v) => `${v.toFixed(2)}×`, 'gs-only-touch');
    const af = segRow('autoFire', 'Auto-fire assist', [{ v: false, label: 'Off' }, { v: true, label: 'On' }], 'gs-only-touch');
    syncers.push(() => { af.note.textContent = settings.autoFire ? 'Shoots when the crosshair is on one' : ''; });
    segRow('assist', 'Aim assist', ASSIST_NAMES.map((n, i) => ({ v: i, label: n })), 'gs-only-touch');
    segRow('lefty', 'Left-handed', [{ v: true, label: 'On' }, { v: false, label: 'Off' }], 'gs-only-touch');
    slider('fov', 'Field of view', (v) => `${Math.round(v)}°`);
    slider('volume', 'Volume', (v) => `${Math.round(v * 100)}%`);

    function syncSettings() {
      for (const f of syncers) f();
      for (const [k, s] of Object.entries(sliders)) { s.input.value = settings[k]; s.paint(); }
      const q = G.quality;
      qWarn.textContent = 'Low, Medium and High may run slowly on phones.';
      qNote.textContent = q && q.tier ? `Now: ${qualityLabel(q.tier, q.auto)}${settings.autoPending ? ' · Auto runs after this round' : ''}` : '';
    }
    screens.settings.sync = () => { for (const r of resetters) r(); syncSettings(); };
    kids(col, heading('Back office', 'Settings'), rows,
      kids(h('nav', 'gs-list gs-back'), row('Back', '', () => show(backTo || 'title'), { small: true, auto: true })));
  }

  // ---- controls (the card on its own; also what ui=controls stages) ----
  {
    const col = screen('controls', 'gs-controls');
    kids(col, heading('House rules', 'Controls'), controlsCard(),
      kids(h('nav', 'gs-list gs-back'), row('Back', '', () => show(backTo || 'title'), { small: true, auto: true })));
  }

  // A screen another module owns (the end screen replaces 'dead'): build(host, G) -> { update?(dt), show?() }.
  function setScreen(name, build) {
    const old = screens[name];
    const wasOn = current === name;
    if (old) old.el.remove();
    const col = screen(name, `gs-${name}`);
    const inst = (typeof build === 'function' ? build(col, G) : null) || {};
    screens[name].inst = inst;
    if (wasOn) { screens[name].el.classList.add('on'); screens[name].el.setAttribute('aria-hidden', 'false'); inst.show?.(); }
    return screens[name];
  }
  // Another module's menu row on a screen with a row list (title, paused): addMenuRow(name, { label, hint,
  // onClick, at? }) -> the button, inserted at index `at` (default: last), with the built-in keyboard behaviour.
  function addMenuRow(name, { label, hint = '', onClick, at }) {
    const s = screens[name];
    if (!s || !s.list) return null;
    const b = row(label, hint, onClick);
    const ref = Number.isInteger(at) ? s.list.children[at] : null;
    s.list.insertBefore(b, ref || null);
    return b;
  }
  // Another module's element at the foot of a screen's column (a credit line): -> remove()
  function addToScreen(name, el) {
    const s = screens[name];
    if (!s) return () => {};
    s.col.appendChild(el);
    return () => el.remove();
  }
  const update = (dt) => { const sc = current && screens[current]; if (sc && sc.inst && sc.inst.update) sc.inst.update(dt); };

  // ---- show / focus ----
  function refreshDead() {
    const g = G.game || {};
    const sm = sample || {};
    const round = sm.round ?? g.round ?? 0;
    const best = sm.best ?? g.best ?? 0;
    dead.num.textContent = String(round);
    dead.kills.textContent = String(sm.kills ?? g.kills ?? 0);
    dead.points.textContent = formatPoints(sm.earned ?? g.economy?.earned ?? g.points ?? 0);
    dead.best.textContent = String(Math.max(best, round));
    dead.tag.hidden = !(sm.newBest ?? g.newBest ?? false);
  }

  function show(name) {
    const target = name && screens[name] ? name : null;
    if (target === current) return;
    if ((target === 'settings' || target === 'controls') && (current === 'title' || current === 'paused')) backTo = current;
    if (target === 'dead' && dead.num && dead.num.isConnected) refreshDead();
    else if (target && screens[target].inst && screens[target].inst.show) screens[target].inst.show();
    if (target === 'settings') screens.settings.sync();
    for (const [n, s] of Object.entries(screens)) {
      const on = n === target;
      s.el.classList.toggle('on', on);
      s.el.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    const prev = current;
    current = target;
    if (!target) {
      if (root.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    // Move keyboard focus into the screen so Enter/Tab work immediately.
    const el = screens[target].el;
    const first = el.querySelector('[data-autofocus]') || el.querySelector('button, input');
    if (first) {
      first.focus({ preventScroll: true });
      // The screen is still hidden (visibility) in this tick on first show; retry once it is visible.
      if (document.activeElement !== first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
    }
    void prev;
  }

  // Menu keyboard: arrows move between rows, Space activates (the input module would swallow it).
  root.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.closest('.gs-screen')) return;
    const scr = t.closest('.gs-screen');
    if (t.tagName === 'BUTTON' && t.classList.contains('gs-row')) {
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); t.click(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const items = [...scr.querySelectorAll('button, input')].filter((n) => n.tabIndex >= 0);
        const i = items.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1);
        items[(i + items.length) % items.length].focus();
      }
    }
  });

  return { show, update, setScreen, addMenuRow, addToScreen, addSettingsRow: (spec) => addSettingsRow(spec), get current() { return current; }, screens };
}
