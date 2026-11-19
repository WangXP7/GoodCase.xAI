// The end screen: replaces menus' 'dead' screen. Renders G.game.summary().rows as given, so a later
// new stat adds a row in the game module and nothing here changes. Leaves a marked slot for the optional
// "save your stats" form that the leaderboard UI fills in (no network code here):
//
//   G.ui.endScreen = {
//     slot,                     // the empty <div class="gs-endslot" data-slot="gamertag"> between the stats and Retry
//     mount(el) -> unmount,     // put a form (or anything) in the slot; it is cleared on every new game
//     onShow(fn) -> off,        // fn({ summary, run, slot }) each time the screen appears: run is G.game.runSummary()
//     summary(), run(),         // the numbers on screen now
//     addAction(el) -> remove,  // another button after Retry (Leaderboard)
//     addAside(el) -> remove,   // an element under the round numeral (share and credit)
//   }
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// The rows under the big round numeral: the game's own order, without the row that repeats the numeral.
export function summaryRows(summary) {
  const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
  const out = [];
  for (const r of rows) {
    if (!r || r.label === undefined || r.value === undefined || r.value === null) continue;
    if (/^round reached$/i.test(String(r.label))) continue;
    out.push({ label: String(r.label), value: String(r.value) });
  }
  return out;
}

const SAMPLE = {
  round: 7, newBest: true,
  rows: [
    { label: 'Round reached', value: '7' }, { label: 'Kills', value: '61' }, { label: 'Headshots', value: '14' }, { label: 'Accuracy', value: '38%' },
    { label: 'Points earned', value: '5620' }, { label: 'Points spent', value: '5400' }, { label: 'Doors opened', value: '3' },
    { label: 'Time', value: '11:42' }, { label: 'Best round', value: '7 (new)' },
  ],
};

export function createEndScreen(G, { menus, staged = false }) {
  const shows = [];
  let host = null;
  const els = {};
  let current = { summary: null, run: null };

  const read = () => {
    if (staged) return { summary: SAMPLE, run: { round: 7, kills: 61, headshots: 14, points: 5620, timeSec: 702 } };
    const g = G.game || {};
    const summary = typeof g.summary === 'function' ? g.summary() : { round: g.round || 0, rows: [] };
    const run = typeof g.runSummary === 'function' ? g.runSummary() : null;
    return { summary, run };
  };

  function build(col) {
    host = col;
    col.classList.add('gs-endcol');
    els.num = h('div', 'gs-bignum', '0');
    els.tag = h('span', 'gs-newbest', 'New best');
    els.tag.hidden = true;
    els.rows = h('div', 'gs-endrows');
    els.slot = h('div', 'gs-endslot');
    els.slot.dataset.slot = 'gamertag';
    const head = h('header', 'gs-head');
    head.append(h('p', 'gs-eyebrow', 'Clocked out'), h('h2', 'gs-h', 'Shift over'));
    const big = h('div', 'gs-bigwrap');
    const eb = h('p', 'gs-eyebrow', 'Round reached');
    const numRow = h('div', 'gs-endnum');
    numRow.append(els.num, els.tag);
    big.append(eb, numRow);
    els.big = big;
    const retry = h('button', 'gs-row');
    retry.type = 'button';
    retry.dataset.autofocus = '1';
    retry.append(h('span', 'k', 'Retry'), h('span', 'lead'), h('span', 'hint', 'Round 1'));
    retry.addEventListener('click', () => { G.game?.restart?.(); G.input?.requestLock?.(); });
    const nav = h('nav', 'gs-list');
    nav.setAttribute('aria-label', 'End of shift');
    nav.appendChild(retry);
    els.nav = nav;
    const right = h('div', 'gs-endright');
    right.append(els.rows, els.slot, nav);
    col.append(head, big, right);
    return { show: refresh, update() {} };
  }

  function refresh() {
    current = read();
    const s = current.summary || {};
    els.num.textContent = String(s.round ?? 0);
    els.tag.hidden = !s.newBest;
    els.rows.textContent = '';
    for (const r of summaryRows(s)) {
      const line = h('div', 'gs-stat');
      line.append(h('span', 'l', r.label), h('span', 'lead'), h('span', 'v', r.value));
      els.rows.appendChild(line);
    }
    for (const fn of shows.slice()) { try { fn({ summary: current.summary, run: current.run, slot: els.slot }); } catch { /* a form must not break the screen */ } }
  }

  menus.setScreen('dead', build);
  // a new game empties the slot, so last run's form is never shown on this run's screen
  if (G.events && G.events.on) G.events.on('game:state', ({ state }) => { if (state === 'playing' && els.slot) els.slot.textContent = ''; });

  return {
    get slot() { return els.slot; },
    mount(el) { els.slot.appendChild(el); return () => el.remove(); },
    onShow(fn) { shows.push(fn); return () => { const i = shows.indexOf(fn); if (i >= 0) shows.splice(i, 1); }; },
    addAction(el) { els.nav.appendChild(el); return () => el.remove(); },
    addAside(el) { el.classList.add('gs-endaside'); els.big.appendChild(el); return () => el.remove(); },
    summary: () => current.summary,
    run: () => current.run,
    get host() { return host; },
  };
}
