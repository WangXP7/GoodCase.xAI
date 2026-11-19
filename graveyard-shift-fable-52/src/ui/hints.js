// G.hints: onboarding hints. One line at a time, top-centre under the objective; a priority queue
// with 1.5 s between hints; each id once per browser (one JSON array under graveyard-shift.hints.v1, through
// `store`; if storage throws, once per session); dismissed by its cross, by H, by `until` (the player did the
// thing) or by its own clock. Built last and updated last, so every other module has already moved.
//
//   G.hints = { show(id, {force}), dismiss(id?), seen(id), reset(), enabled (get/set), update(dt),
//               current() -> {id, text, plain, parts}|null, target() -> [x,z]|null, defs, ctx }
// Also here, because this is the one module main.js builds after the UI: the objective line and compass, the
// HUD panels, the end screen and the two Settings rows (see mountExtras). Events: hint:show {id}, hint:dismiss {id}.
import './onboard.css';
import { store as defaultStore } from '../core/store.js';
import { HINTS, parseCopy, plainCopy } from './hintDefs.js';
import { createObjectiveView } from './objective.js';
import { createPanels, BANNER_LIFE } from './panels.js';
import { ICONS } from './touchHud.js';
import { createEndScreen } from './endscreen.js';

const KEY = 'graveyard-shift.hints.v1';
const ON_KEY = 'graveyard-shift.hints.on';
const GAP = 1.5; // seconds between one hint ending and the next appearing
const LIFE = 6; // default life
const STALE = 10; // a queued hint nobody could show for this long is dropped
const TICK = 0.25;
const CHECK = 0.1;

// events that move counters `until` reads ("did they shoot / buy / reload since this appeared")
const COUNTERS = {
  'hit:zombie': 'hits', 'zombie:die': 'kills', buy: 'buys', 'weapon:reload': 'reloads', 'search:start': 'searches',
  throw: 'throws', 'weapon:switch': 'switches', 'powerup:take': 'pups', 'bench:upgrade': 'upgrades', 'door:open': 'opened', 'power:on': 'powered', 'box:roll': 'rolls', 'board:repair': 'repairs', 'weapon:melee': 'swings',
};
const COUNTER_KEYS = Object.values(COUNTERS);

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// ---- the line on screen ---------------------------------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
function iconChip(name) {
  const chip = h('span', 'key ico');
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICONS[name] || '';
  chip.appendChild(svg);
  chip.setAttribute('aria-hidden', 'true');
  return chip;
}
function createHintView(G, { onClose }) {
  const el = h('div', 'gs-hint');
  el.setAttribute('role', 'status');
  const txt = h('span', 't');
  const hide = h('span', 'hide', 'H to hide'); // a locked mouse cannot click the cross
  const x = h('button', 'x', '\u2715');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss hint');
  x.title = 'Dismiss (H)';
  x.addEventListener('click', (e) => { e.preventDefault(); onClose(); });
  el.append(txt, hide, x);
  const remove = G.ui.addPanel('hint', el, { corner: 'tc', order: 1 });
  const live = G.ui.root && G.ui.root.querySelector ? G.ui.root.querySelector('[aria-live]') : null;
  return {
    show(cur) {
      txt.textContent = '';
      for (const p of cur.parts) txt.appendChild(p.icon ? iconChip(p.icon) : p.key ? h('kbd', 'key', p.t) : document.createTextNode(p.t));
      el.dataset.id = cur.id;
      el.classList.add('on');
      if (live) live.textContent = cur.plain;
    },
    hide() { el.classList.remove('on'); },
    dispose() { remove(); },
    el,
  };
}

export function createHints(G, opts = {}) {
  const store = opts.store || defaultStore;
  const defs = opts.defs || HINTS;
  const params = G.params || {};
  const suppressed = !!(params.shot || params.nohud);
  const seenSet = new Set();
  const queue = [];
  const ctx = {};
  for (const k of COUNTER_KEYS) ctx[k] = 0;
  const act = { def: null, t: 0, x: 0, z: 0, yaw: 0, turn: 0, at: {}, forced: false, cur: null, tgt: null, chk: 0 };
  for (const k of COUNTER_KEYS) act.at[k] = 0;
  let clock = 0, lastEnd = -Infinity, tickAcc = TICK, seq = 0;
  const BANNER_QUIET = opts.bannerQuiet === undefined ? BANNER_LIFE + 0.3 : opts.bannerQuiet; // no new hint while the round banner is up
  let quiet = 0;
  let enabled = params.hints === false ? false : (() => { try { return store.get(ON_KEY, '1') !== '0'; } catch { return true; } })();
  let view = null;

  const persist = () => { try { store.set(KEY, JSON.stringify([...seenSet])); } catch { /* once per session then */ } };
  const forget = () => { seenSet.clear(); try { store.set(KEY, '[]'); } catch { /* nothing to clear */ } };
  if (params.hints === 'reset') forget();
  else {
    try {
      const raw = JSON.parse(store.get(KEY, '[]'));
      if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string') seenSet.add(id);
    } catch { /* a corrupt memory is an empty one */ }
  }

  const isLive = () => enabled && !suppressed;
  const touch = () => !!(G.ui && G.ui.touch);
  const emit = (n, p) => { if (G.events && G.events.emit) G.events.emit(n, p); };
  const queued = (id) => { for (let i = 0; i < queue.length; i++) if (queue[i].def.id === id) return true; return false; };

  function copyOf(def) {
    const t = touch() && def.text.touch ? def.text.touch : def.text.key;
    return typeof t === 'function' ? t(G) : t;
  }

  function begin(def, forced) {
    const text = copyOf(def);
    const p = G.player;
    act.def = def; act.t = 0; act.forced = forced; act.chk = 0; act.turn = 0;
    act.x = p && p.pos ? p.pos[0] : 0; act.z = p && p.pos ? p.pos[2] : 0; act.yaw = p ? p.yaw || 0 : 0;
    for (const k of COUNTER_KEYS) act.at[k] = ctx[k];
    act.tgt = def.target ? safe(() => def.target(G)) : null;
    act.cur = { id: def.id, text, plain: plainCopy(text), parts: parseCopy(text) };
    if (!forced) { seenSet.add(def.id); persist(); }
    if (view) view.show(act.cur);
    emit('hint:show', { id: def.id });
  }
  function end() {
    const def = act.def;
    if (!def) return;
    act.def = null; act.cur = null; act.tgt = null;
    lastEnd = clock;
    if (view) view.hide();
    emit('hint:dismiss', { id: def.id });
  }
  const safe = (fn) => { try { return fn(); } catch { return null; } };

  function consider(def, ev) {
    if (!isLive() || seenSet.has(def.id) || queued(def.id) || act.def === def) return;
    if (!safe(() => def.when(G, ev, ctx))) return;
    queue.push({ def, t: clock, n: seq++ });
  }

  // wire the events (one listener per name)
  const byEvent = new Map();
  for (const def of defs) {
    if (def.on === 'tick') continue;
    for (const name of def.on) { if (!byEvent.has(name)) byEvent.set(name, []); byEvent.get(name).push(def); }
  }
  for (const name of Object.keys(COUNTERS)) if (!byEvent.has(name)) byEvent.set(name, []);
  for (const name of ['round:start', 'round:end', 'round:straggler', 'game:state']) if (!byEvent.has(name)) byEvent.set(name, []);
  if (G.events && G.events.on) {
    for (const [name, list] of byEvent) {
      const counter = COUNTERS[name];
      G.events.on(name, (ev) => {
        if (counter) ctx[counter]++;
        if (name === 'round:start' || name === 'round:end') quiet = BANNER_QUIET;
        else if (name === 'round:straggler' && ev && ev.pos) hints.straggler = { id: ev.id, pos: ev.pos };
        else if (name === 'game:state' && ev && ev.state !== 'playing' && ev.state !== 'paused') { queue.length = 0; if (act.def && !act.forced) end(); hints.straggler = null; quiet = 0; }
        for (let i = 0; i < list.length; i++) consider(list[i], ev);
      });
    }
  }
  const tickDefs = defs.filter((d) => d.on === 'tick');

  function next() {
    let bi = -1;
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (clock - q.t > STALE || seenSet.has(q.def.id)) { queue.splice(i, 1); continue; }
      if (q.def.on === 'tick' && !safe(() => q.def.when(G, null, ctx))) { queue.splice(i, 1); continue; }
    }
    for (let i = 0; i < queue.length; i++) {
      if (bi < 0 || queue[i].def.priority > queue[bi].def.priority || (queue[i].def.priority === queue[bi].def.priority && queue[i].n < queue[bi].n)) bi = i;
    }
    if (bi < 0) return;
    const q = queue.splice(bi, 1)[0];
    begin(q.def, false);
  }

  const hints = {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = !!v;
      try { store.set(ON_KEY, enabled ? '1' : '0'); } catch { /* session only */ }
      if (!enabled) { queue.length = 0; if (act.def) end(); }
    },
    defs,
    ctx,
    straggler: null,
    seen: (id) => seenSet.has(id),
    current: () => act.cur,
    target: () => act.tgt,
    // show(id): queue it now (once, like any other). show(id, {force:true}) puts it up and keeps it up, recording nothing (staging).
    show(id, o = {}) {
      const def = defs.find((d) => d.id === id);
      if (!def) return false;
      if (o.force) { if (act.def) end(); begin(def, true); return true; }
      if (!isLive() || seenSet.has(id) || queued(id) || act.def === def) return false;
      queue.push({ def, t: clock, n: seq++ });
      return true;
    },
    dismiss(id) {
      if (id === undefined || (act.def && act.def.id === id)) { if (act.def) end(); return; }
      if (!seenSet.has(id)) { seenSet.add(id); persist(); }
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].def.id === id) queue.splice(i, 1);
    },
    reset() { forget(); queue.length = 0; if (act.def) end(); lastEnd = -Infinity; },
    update(dt) {
      const inp = G.input;
      if (act.def && inp && typeof inp.pressed === 'function' && inp.pressed('hint')) end();
      const st = G.game && G.game.state;
      if (st && st !== 'playing') return; // paused, dead, title: the clock stands still
      clock += dt;
      if (quiet > 0) quiet -= dt;
      if (!isLive()) return;
      if (act.def && !act.forced) {
        act.t += dt; act.chk += dt;
        if (act.chk >= CHECK) {
          act.chk = 0;
          const d = act.def;
          if (d.target) act.tgt = safe(() => d.target(G));
          if (d.until && safe(() => d.until(G, act, ctx))) end();
        }
        if (act.def && act.t >= (act.def.seconds || LIFE)) end();
      }
      tickAcc += dt;
      if (tickAcc >= TICK) { tickAcc = 0; for (let i = 0; i < tickDefs.length; i++) consider(tickDefs[i], null); }
      if (!act.def && queue.length && quiet <= 0 && clock - lastEnd >= GAP) next();
    },
  };

  const wantView = opts.view === undefined ? typeof document !== 'undefined' && !!(G.ui && G.ui.addPanel) && opts.ui !== false : !!opts.view;
  if (wantView) {
    try { view = opts.view && typeof opts.view === 'object' ? opts.view : createHintView(G, { onClose: () => hints.dismiss() }); } catch (e) { view = null; }
  }
  if (opts.ui !== false && typeof document !== 'undefined' && G.ui && G.ui.addPanel) {
    mountExtras(G, hints);
  }
  return hints;
}

// The two rows this module adds to Settings, as specs for menus.addSettingsRow (same keyboard behaviour as the built-in rows).
export function settingsRowSpecs(hints) {
  const seenCount = () => { let n = 0; for (const d of hints.defs) if (hints.seen(d.id)) n++; return n; };
  return [
    { id: 'hints', label: 'Hints', options: [{ v: true, label: 'On' }, { v: false, label: 'Off' }], get: () => hints.enabled, set: (v) => { hints.enabled = v === true || v === 'true'; } },
    { id: 'hintsAgain', label: 'Show hints again', options: [{ v: 'reset', label: 'Reset' }], get: () => '', set: () => { hints.reset(); }, note: () => { const n = seenCount(); return n ? `${n} seen` : 'None seen yet'; } },
  ];
}
function mountSettingsRows(G, hints) {
  const m = G.ui.menus;
  if (!m || typeof m.addSettingsRow !== 'function') return null;
  for (const spec of settingsRowSpecs(hints)) m.addSettingsRow(spec);
  return null;
}

// The rest of the hint UI. It lives behind createHints because main.js builds this module last and the hints do not
// own main.js or hud.js; each piece is guarded so a failure in one never takes the others (or the game) down.
function mountExtras(G, hints) {
  const parts = [];
  const guard = (name, fn) => {
    try { const p = fn(); if (p) parts.push(p); } catch (e) {
      console.warn(`[hints] ${name} failed`, e);
      if (typeof window !== 'undefined' && Array.isArray(window.__errors)) window.__errors.push(`[hints] ${name}: ${e && e.message}`);
    }
  };
  const query = new URLSearchParams(window.location.search);
  const uiParam = query.get('ui');
  const staged = uiParam === 'hud';
  const ui = G.ui;
  const hud = (ui.root && ui.root.querySelector && ui.root.querySelector('.gs-hud')) || ui.root || document.body;
  const overlay = h('div', 'gs-ob');
  hud.appendChild(overlay);
  const addPanel = (...a) => ui.addPanel(...a);

  let obj = null;
  guard('panels', () => createPanels(G, { addPanel, overlay, staged, query }));
  guard('objective', () => {
    const sample = staged ? { text: 'Open the Diner door \u2014 750', target: [30, -34] } : null;
    obj = createObjectiveView(G, { sample, overlay, addPanel });
    return { update: (dt) => obj.update(dt, hints.target()) };
  });
  if (menusReady(ui)) {
    guard('endscreen', () => { ui.endScreen = createEndScreen(G, { menus: ui.menus, staged: uiParam === 'dead' }); });
    guard('settings', () => mountSettingsRows(G, hints));
  }
  const upd = hints.update;
  hints.update = (dt) => { upd(dt); for (let i = 0; i < parts.length; i++) { try { parts[i].update(dt); } catch { /* one panel must not stop the rest */ } } };
  const hintParam = query.get('hint');
  if (hintParam && uiParam) hints.show(hintParam, { force: true });
}
const menusReady = (ui) => !!(ui.menus && ui.menus.setScreen && ui.menus.screens);
