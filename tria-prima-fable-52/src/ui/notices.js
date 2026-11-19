// Things the game tells the player in passing: name cards (a region entered, a Prime taken, a
// potion learned) and the quiet toasts at the lower left. Both are queues that run on their own.
import { h, setText } from './dom.js';
import { signGlyph } from './glyphs.js';

// ---------------------------------------------------------------------------------------------
// Cards: one large line of lettering at the upper third of the screen, one at a time.
// ---------------------------------------------------------------------------------------------
export function createCards(icons) {
  const el = h('div', { class: 'tp-cards' });
  const queue = [];
  let busy = false,
    held = false,
    current = null,
    last = '',
    lastAt = 0,
    timer = 0;

  function next() {
    current = null;
    const spec = held ? null : queue.shift();
    if (!spec) {
      busy = false;
      return;
    }
    busy = true;
    current = spec;
    const life = spec.life || 5.4;
    const card = h('div', { class: 'tp-card', data: { tone: spec.tone || 'region' }, style: { '--life': life + 's' } });
    if (spec.icon) card.append(h('div', { class: 'tp-card-icon' }, icons.make(spec.icon.kind, spec.icon.id, '', 256)));
    else if (spec.sign) card.append(h('div', { class: 'tp-card-icon tp-card-sign' }, signGlyph(spec.sign)));
    if (spec.over) card.append(h('div', { class: 'tp-label tp-card-over', text: spec.over }));
    card.append(h('div', { class: 'tp-card-name', text: spec.name }));
    card.append(h('div', { class: 'tp-rule tp-card-rule' }, h('i'), h('b'), h('i')));
    if (spec.sub) card.append(h('div', { class: 'tp-card-sub', text: spec.sub }));
    el.replaceChildren(card);
    clearTimeout(timer);
    timer = setTimeout(() => {
      card.remove();
      next();
    }, life * 1000 + 60);
  }

  function show(spec) {
    const key = (spec.tone || '') + '|' + spec.name;
    const now = performance.now();
    if (key === last && now - lastAt < 8000) return; // the same card twice in a row is noise
    last = key;
    lastAt = now;
    // a waiting card about a place gives way to anything newer: to something more important, or to
    // the next place (a walk along a border must not queue a row of names)
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].tone === 'region') queue.splice(i, 1);
    queue.push(spec);
    if (!busy) next();
  }
  /** While held nothing is shown: a card that was up goes back to the head of the queue and waits. */
  function hold(on) {
    on = !!on;
    if (on === held) return;
    held = on;
    if (on) {
      if (current && current.tone !== 'region') queue.unshift(current);
      current = null;
      clearTimeout(timer);
      el.replaceChildren();
      busy = false;
    } else if (!busy) next();
  }
  function clear() {
    queue.length = 0;
    current = null;
    clearTimeout(timer);
    el.replaceChildren();
    busy = false;
  }
  return { el, show, hold, clear };
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------
const COUNT_RE = /^\s*[x×]\s*(\d+)\s*$/i;

export function createToasts(icons) {
  const el = h('div', { class: 'tp-toasts' });
  const live = []; // newest last

  function drop(t) {
    const i = live.indexOf(t);
    if (i < 0) return;
    live.splice(i, 1);
    t.el.classList.add('is-out');
    setTimeout(() => t.el.remove(), 520);
  }

  function arm(t, seconds) {
    clearTimeout(t.timer);
    t.timer = setTimeout(() => drop(t), seconds * 1000);
  }

  function push(p) {
    if (!p || (!p.title && !p.text)) return;
    const kind = p.kind || 'info';
    const iconKey = p.icon ? p.icon.kind + ':' + p.icon.id : '';
    const key = kind + '|' + iconKey + '|' + (p.title || '');
    const life = kind === 'quest' || kind === 'lore' ? 6.5 : kind === 'warn' ? 5 : 4.2;

    // the same thing picked up again: count up instead of stacking
    const same = live.find((t) => t.key === key);
    if (same) {
      const a = COUNT_RE.exec(same.text || ''),
        b = COUNT_RE.exec(p.text || '');
      if (a && b) same.text = '×' + (Number(a[1]) + Number(b[1]));
      else same.text = p.text || '';
      setText(same.textEl, same.text);
      same.el.classList.remove('is-bump');
      void same.el.offsetWidth;
      same.el.classList.add('is-bump');
      arm(same, life);
      return;
    }

    const textEl = h('div', { class: 'tp-toast-text' });
    const t = { key, text: p.text || '', textEl, el: null, timer: 0 };
    setText(textEl, t.text);
    t.el = h(
      'div',
      { class: 'tp-toast', data: { kind } },
      p.icon ? icons.make(p.icon.kind, p.icon.id, 'tp-toast-icon') : null,
      h('div', { class: 'tp-toast-body' }, h('div', { class: 'tp-toast-title', text: p.title || '' }), textEl)
    );
    el.append(t.el);
    live.push(t);
    while (live.length > 4) drop(live[0]);
    arm(t, life);
  }

  function clear() {
    for (const t of live.slice()) drop(t);
  }
  return { el, push, clear };
}
