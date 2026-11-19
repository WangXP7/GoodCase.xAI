// The tabbed information panel on the title and pause screens: Controls, How it works, Perks, Weapons.
// DOM only. The words and numbers come from infoContent.js, which reads the game's tables.
import { CONTROLS, formatPoints } from './format.js';
import { TABS, infoContent } from './infoContent.js';
import './infoPanel.css';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const kids = (parent, ...els) => { for (const e of els) parent.appendChild(e); return parent; };

// The two control columns, keyboard and touch. CSS puts the active device's column first.
export function controlsColumns() {
  const cols = h('div', 'gs-card-cols');
  for (const [cls, title, field] of [['kb', 'Keyboard', 'key'], ['tc', 'Touch', 'touch']]) {
    const col = h('div', `gs-card-col ${cls}`);
    col.appendChild(h('h3', 'gs-card-h', title));
    for (const c of CONTROLS) kids(col, kids(h('div', 'r'), h('span', 'a', c.name), h('span', 'k', c[field])));
    cols.appendChild(col);
  }
  return cols;
}

function howPanel(items) {
  const ul = h('ul', 'gs-ilist');
  for (const it of items) {
    const li = h('li', 'gs-iitem');
    kids(li, h('h4', 'gs-ih', it.title), h('p', 'gs-ip', it.text));
    if (it.list) {
      const sub = h('ul', 'gs-isub');
      for (const p of it.list) kids(sub, kids(h('li'), h('b', '', p.name), document.createTextNode(` ${p.text}`)));
      li.appendChild(sub);
    }
    ul.appendChild(li);
  }
  return ul;
}

function perksPanel(items) {
  const ul = h('ul', 'gs-ilist');
  for (const it of items) {
    const li = h('li', 'gs-iitem');
    kids(li, kids(h('div', 'gs-itop'), h('h4', 'gs-ih', it.name), h('span', 'gs-icost', `${formatPoints(it.cost)} pts`)), h('p', 'gs-ip', it.text));
    ul.appendChild(li);
  }
  return kids(h('div'), h('p', 'gs-inote', 'Each one needs the power on. You keep it until you die.'), ul);
}

const STAT_KEYS = ['damage', 'rate', 'mag'];
function weaponsPanel(groups) {
  const wrap = h('div');
  for (const g of groups) {
    const sec = h('section', 'gs-wgroup');
    sec.appendChild(h('h3', 'gs-iclass', g.label));
    const ul = h('ul', 'gs-ilist');
    for (const w of g.items) {
      const li = h('li', 'gs-iitem gs-weap');
      li.dataset.weapon = w.id;
      const srcs = h('span', 'gs-srcs');
      srcs.appendChild(h('span', 'gs-sr', 'Found at: '));
      w.sources.forEach((s, i) => { if (i) srcs.appendChild(document.createTextNode(', ')); srcs.appendChild(h('span', `gs-src ${s.kind}`, s.text)); });
      kids(li, kids(h('div', 'gs-itop'), h('h4', 'gs-ih', w.name), srcs), h('p', 'gs-ip', w.text));
      const bars = h('dl', 'gs-bars');
      for (const k of STAT_KEYS) {
        const s = w.stats[k];
        const bar = h('dd', 'gs-bar');
        bar.setAttribute('aria-hidden', 'true');
        const fill = h('i');
        fill.style.width = `${Math.max(3, Math.round(s.fraction * 100))}%`;
        bar.appendChild(fill);
        // the label and number read as one line to a screen reader: "Damage 140"
        kids(bars, kids(h('div'), kids(h('dt'), h('span', 'l', s.label), document.createTextNode(' '), h('span', 'v', s.text)), bar));
      }
      li.appendChild(bars);
      li.appendChild(h('p', 'gs-wup', `Ammo ${formatPoints(w.ammo.stock)}, upgraded ${formatPoints(w.ammo.upgraded)}`));
      if (w.upgraded) li.appendChild(h('p', 'gs-wup', `Upgraded: ${w.upgraded}`));
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    wrap.appendChild(sec);
  }
  return wrap;
}

// The tab chosen last this session, shared by every panel so the title and pause screens agree.
let lastTab = 'controls';
try {
  const q = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search).get('tab') : null;
  if (TABS.some((t) => t.id === q)) lastTab = q; // lets a screenshot ask for a tab
} catch { /* no location: keep the default */ }
const panels = new Set();
let serial = 0;

// -> { el, select(id), selected }
export function createInfoPanel(content = infoContent()) {
  const n = ++serial;
  const el = h('div', 'gs-card gs-info');
  const tablist = h('div', 'gs-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Game information');
  const bodies = {
    controls: kids(h('div', 'gs-ctl'), controlsColumns()),
    how: howPanel(content.how),
    perks: perksPanel(content.perks),
    weapons: weaponsPanel(content.weapons),
  };
  const tabs = {};
  const sheets = {};
  for (const t of TABS) {
    const tab = h('button', 'gs-tab', t.label);
    tab.type = 'button';
    tab.id = `gs-tab-${n}-${t.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `gs-sheet-${n}-${t.id}`);
    tab.dataset.tab = t.id;
    tabs[t.id] = tab;
    tablist.appendChild(tab);
    const sheet = h('div', 'gs-sheet');
    sheet.id = `gs-sheet-${n}-${t.id}`;
    sheet.setAttribute('role', 'tabpanel');
    sheet.setAttribute('aria-labelledby', tab.id);
    sheet.tabIndex = 0; // a keyboard can reach it, and scroll it, when it is long
    sheet.appendChild(bodies[t.id]);
    sheets[t.id] = sheet;
  }
  kids(el, tablist, ...TABS.map((t) => sheets[t.id]));

  const api = {
    el,
    get selected() { return lastTab; },
    select(id, { shared = true } = {}) {
      if (!tabs[id]) return;
      if (shared) { lastTab = id; for (const p of panels) if (p !== api) p.select(id, { shared: false }); }
      for (const t of TABS) {
        const on = t.id === id;
        tabs[t.id].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[t.id].tabIndex = on ? 0 : -1;
        sheets[t.id].hidden = !on;
        if (on && sheets[t.id].scrollTop) sheets[t.id].scrollTop = 0;
      }
    },
  };

  tablist.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('.gs-tab') : null;
    if (b) api.select(b.dataset.tab);
  });
  // Arrows, Home and End move between tabs and open the one reached. The game's own key handler would
  // swallow the arrows and Space, so these stop at the panel.
  tablist.addEventListener('keydown', (e) => {
    const b = e.target instanceof Element ? e.target.closest('.gs-tab') : null;
    if (!b) return;
    const ids = TABS.map((t) => t.id);
    const i = ids.indexOf(b.dataset.tab);
    let to = null;
    if (e.key === 'ArrowRight') to = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') to = ids[(i + ids.length - 1) % ids.length];
    else if (e.key === 'Home') to = ids[0];
    else if (e.key === 'End') to = ids[ids.length - 1];
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); sheets[b.dataset.tab].focus({ preventScroll: true }); return; }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); api.select(b.dataset.tab); return; }
    if (to === null) return;
    e.preventDefault(); e.stopPropagation();
    api.select(to);
    tabs[to].focus();
  });
  // A focused panel scrolls with the arrows, Page keys, Home and End; Up at the top goes back to the tabs.
  const LINE = 48;
  el.addEventListener('keydown', (e) => {
    const s = e.target instanceof Element ? e.target.closest('.gs-sheet') : null;
    if (!s || e.target !== s) return;
    const page = s.clientHeight * 0.85;
    let by = null;
    if (e.key === 'ArrowDown') by = LINE;
    else if (e.key === 'ArrowUp') {
      if (s.scrollTop <= 0) { e.preventDefault(); e.stopPropagation(); tabs[lastTab].focus(); return; }
      by = -LINE;
    } else if (e.key === 'PageDown' || e.key === ' ') by = page;
    else if (e.key === 'PageUp') by = -page;
    else if (e.key === 'Home') by = -s.scrollTop;
    else if (e.key === 'End') by = s.scrollHeight;
    if (by === null) return;
    e.preventDefault(); e.stopPropagation();
    s.scrollBy({ top: by });
  });

  api.select(lastTab, { shared: false });
  panels.add(api);
  return api;
}
