// Tria Prima UI: every screen of the game as DOM over the WebGL canvas.
//
//   const ui = createUI(game);   // builds under #ui, injects its own CSS
//   ui.update(dt);               // once per frame
//
// The UI reads game.state / game.brew / game.hud / game.map / game.settings, calls game.actions and
// listens to game.bus. It never touches three.js. See docs/DESIGN.md section 5.
import { h, setClass } from './dom.js';
import { CSS } from './style.js';
import { createIcons } from './icons.js';
import { createHud } from './hud.js';
import { createBrew } from './brew.js';
import { createBook } from './book.js';
import { createCards, createToasts } from './notices.js';
import { createLoading, createTitle, createPause, createReader, createDead, createEnding, createPhoto, createBars } from './menus.js';

const BOOK_TABS = ['journal', 'chart', 'ingredients', 'lore', 'map'];

/**
 * @param game  see docs/DESIGN.md section 5
 * @param opts  { loading: true } starts under the loading veil, for a game that builds the UI
 *              before its first `loading` event; the veil then lifts on `loading { progress: 1 }`.
 */
export function createUI(game, opts = {}) {
  const D = game.data;
  const bus = game.bus;

  // ---- root and style -------------------------------------------------------------------------
  let root = document.getElementById('ui');
  if (!root) {
    root = h('div', { id: 'ui' });
    document.body.append(root);
  }
  let style = document.getElementById('tp-ui-style');
  if (!style) {
    style = h('style', { id: 'tp-ui-style' });
    document.head.append(style);
  }
  style.textContent = CSS;
  root.classList.add('tp');
  root.replaceChildren();

  // ---- parts ----------------------------------------------------------------------------------
  const icons = createIcons(game);
  // a place is announced once, whether the game sends a region event, sets game.hud.region, or both
  function showRegion(id) {
    const r = D.REGIONS[id];
    if (r) cards.show({ tone: 'region', name: r.name, sub: r.sub, life: 5.4 });
  }
  const hud = createHud(game, icons, showRegion);
  const brew = createBrew(game, icons);
  const book = createBook(game, icons);
  const cards = createCards(icons);
  const toasts = createToasts(icons);
  const loading = createLoading(game);
  const title = createTitle(game);
  const pause = createPause(game);
  const reader = createReader(game, () => sync());
  const dead = createDead(game);
  const ending = createEnding(game);
  const photo = createPhoto(game);
  const bars = createBars();

  // bottom to top
  root.append(...hud.vignettes, hud.el, brew.el, cards.el, toasts.el, bars.el, photo.el, book.el, reader.el, pause.el, dead.el, ending.el, title.el, loading.el);

  const layers = { hud: hud.el, brew: brew.el, book: book.el, pause: pause.el, dead: dead.el, title: title.el, photo: photo.el, reader: reader.el, ending: ending.el, loading: loading.el };
  const shown = {};
  function layer(name, on) {
    on = !!on;
    if (shown[name] === on) return false;
    shown[name] = on;
    setClass(layers[name], 'is-on', on);
    return true;
  }

  // ---- which screens are up -------------------------------------------------------------------
  let mode = null,
    isLoading = !!(opts && opts.loading),
    wantTab = null;

  function sync() {
    const m = game.state.mode;
    const end = ending.phase;
    const endUp = end === 'text' || end === 'credits';
    layer('loading', isLoading);
    if (layer('title', m === 'title' && !isLoading) && m === 'title') title.setOn(true);
    layer('hud', m === 'play' && !reader.open && !endUp);
    if (layer('brew', m === 'brew' && !reader.open)) brew.setOn(m === 'brew' && !reader.open);
    const bookUp = m === 'book' && !reader.open;
    if (layer('book', bookUp) || (bookUp && wantTab)) book.setOn(bookUp, wantTab);
    if (bookUp) wantTab = null;
    if (layer('pause', m === 'pause') && m === 'pause') pause.setOn(true);
    if (layer('dead', m === 'dead') && m === 'dead') dead.setOn(true);
    layer('photo', m === 'photo');
    layer('reader', reader.open);
    layer('ending', endUp);
    bars.setOn((m === 'cutscene' && !endUp) || end === 'cut' || end === 'text');
    const quiet = m === 'title' || m === 'pause' || m === 'book' || m === 'dead' || m === 'photo' || isLoading || endUp || reader.open;
    setClass(toasts.el, 'is-off', quiet);
    setClass(cards.el, 'is-off', quiet);
    // name cards belong to the walking view: over the pot or a cutscene they wait their turn
    cards.hold(m !== 'play' || quiet);
    // the vignettes belong to the walking view; photo mode gets a clean picture
    setClass(root, 'is-world', m === 'play' || m === 'cutscene');
    root.dataset.mode = m;
    if (m !== mode) {
      if (m === 'title') {
        toasts.clear();
        cards.clear();
        hud.reset(true);
        ending.set(null);
      } else if (m !== 'play' && m !== 'cutscene') hud.reset();
      mode = m;
    }
  }

  // ---- events ---------------------------------------------------------------------------------
  const offs = [];
  const on = (name, fn) => offs.push(bus.on(name, fn));

  let liftTimer = 0;
  on('loading', (p) => {
    const prog = p && typeof p.progress === 'number' ? p.progress : 0;
    loading.set(prog, p && p.label);
    clearTimeout(liftTimer);
    if (prog >= 1) {
      // let the last stroke of ink land before the veil lifts
      liftTimer = setTimeout(() => {
        isLoading = false;
        sync();
      }, 450);
    } else isLoading = true;
    sync();
  });
  on('mode', (p) => {
    if (p && p.to === 'book' && p.tab && BOOK_TABS.indexOf(p.tab) >= 0) wantTab = p.tab;
    sync();
  });
  on('toast', (p) => toasts.push(p));
  on('pickup', (p) => {
    if (p && p.kind === 'potion') hud.beltPulse(p.id);
  });
  on('region', (p) => {
    if (!p || !D.REGIONS[p.id]) return;
    hud.sawRegion(p.id);
    showRegion(p.id);
  });
  on('discover', (p) => {
    if (!p) return;
    if (p.kind === 'potion' && D.POTIONS[p.id]) cards.show({ tone: 'discover', icon: { kind: 'potion', id: p.id }, over: 'A potion is written', name: D.POTIONS[p.id].name, sub: D.POTIONS[p.id].motto, life: 6 });
    else if (p.kind === 'ingredient' && D.INGREDIENTS[p.id]) cards.show({ tone: 'discover', icon: { kind: 'ingredient', id: p.id }, over: 'A new ingredient', name: D.INGREDIENTS[p.id].name, sub: D.INGREDIENTS[p.id].latin, life: 4.6 });
    else if (p.kind === 'chart' && D.POTIONS[p.id]) cards.show({ tone: 'discover', over: 'Marked on the chart', name: D.POTIONS[p.id].name, sub: D.POTIONS[p.id].hint, life: 6 });
  });
  on('prime', (p) => {
    const it = p && D.PRIME_ITEMS[p.id];
    if (it) cards.show({ tone: 'prime', sign: p.id, over: 'A Prime is recovered', name: it.name, sub: it.desc, life: 7.5 });
  });
  on('gloom:lift', (p) => {
    const r = p && D.REGIONS[p.region];
    if (r) cards.show({ tone: 'gloom', over: 'The Gloom lifts', name: r.name, life: 6 });
  });
  on('lantern', (p) => {
    const l = p && D.LANTERNS[p.id];
    if (l) cards.show({ tone: 'lantern', over: 'A lantern is lit', name: l.name, sub: 'The dead will keep your place.', life: 5.4 });
  });
  on('quest', () => hud.questChanged());
  on('hurt', (p) => hud.hurt(p && p.amount));
  on('heal', () => hud.heal());
  on('death', () => {
    toasts.clear();
    cards.clear();
    sync();
  });
  on('respawn', () => {
    hud.reset();
    sync();
  });
  on('lore', (p) => {
    if (p && reader.show(p.id)) sync();
  });
  on('save', () => hud.saved());
  on('brew:add', () => brew.chart.pulse());
  on('brew:ready', () => brew.chart.pulse());
  on('opus:stage', (p) => {
    const sg = p && D.OPUS.stages[p.stage];
    if (sg) cards.show({ tone: 'opus', over: 'The Great Work', name: sg.name, sub: sg.sub, life: 4.6 });
  });
  on('opus:done', () => cards.show({ tone: 'opus', icon: { kind: 'stone', id: 'stone' }, over: 'The Great Work', name: 'The Stone', sub: 'Red at last.', life: 7 }));
  on('ending', (p) => {
    ending.set(p ? p.phase : null);
    sync();
  });
  on('settings', () => {
    title.refresh();
    pause.refresh();
  });

  // The tab that openBook(tab) asked for has to reach the UI. The game can say it in the mode
  // event ({ to: 'book', tab }); calls that go through game.actions are also seen here. Looked at
  // again every frame (two property reads), because the game may build its actions after the UI.
  let patch = null; // { host, orig, wrapped }
  let canPatch = true;
  function watchOpenBook() {
    const host = game.actions;
    const orig = host && host.openBook;
    if (!canPatch || typeof orig !== 'function' || (patch && orig === patch.wrapped)) return;
    const wrapped = function (tab) {
      if (tab && BOOK_TABS.indexOf(tab) >= 0) wantTab = tab;
      return orig.apply(this, arguments);
    };
    try {
      host.openBook = wrapped;
      patch = { host, orig, wrapped };
    } catch (e) {
      canPatch = false; // a frozen actions object: the mode event or ui.setBookTab() carries the tab
    }
  }
  watchOpenBook();

  // ---- keyboard: only on the screens the UI owns ----------------------------------------------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let used = false;
    if (isLoading) used = false;
    else if (reader.open) used = reader.key(e);
    else if (ending.active) used = ending.key(e);
    else {
      const m = game.state.mode;
      if (m === 'title') used = title.key(e);
      else if (m === 'pause') used = pause.key(e);
      else if (m === 'book') used = book.key(e);
      else if (m === 'dead') used = dead.key(e);
    }
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  window.addEventListener('keydown', onKey, true);

  // The keyboard belongs to the game or to onKey above, never to a focused control: a button that
  // kept the focus after a click would be pressed again by the next Space or Enter (the bellows
  // key would empty the pot). So a click never moves the focus, and nothing in the UI keeps it.
  function noFocus(e) {
    if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
  }
  function dropFocus(e) {
    if (e.target && typeof e.target.blur === 'function') e.target.blur();
  }
  root.addEventListener('mousedown', noFocus);
  root.addEventListener('focusin', dropFocus);

  // ---- per frame ------------------------------------------------------------------------------
  function update(dt) {
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    watchOpenBook();
    if (game.state.mode !== mode) sync();
    icons.update(dt);
    const m = mode;
    // the HUD view-model also feeds the vignettes during cutscenes
    if (m === 'play' || m === 'cutscene') hud.update(dt);
    else if (m === 'brew') brew.update(dt);
    else if (m === 'book') book.update(dt);
    else if (m === 'photo') photo.update();
  }

  sync();

  return {
    update,
    /** Detach everything (hot reload, tests). */
    destroy() {
      window.removeEventListener('keydown', onKey, true);
      root.removeEventListener('mousedown', noFocus);
      root.removeEventListener('focusin', dropFocus);
      // hand openBook back as it was, so that a later UI can watch it in its turn
      if (patch && patch.host.openBook === patch.wrapped) patch.host.openBook = patch.orig;
      canPatch = false;
      clearTimeout(liftTimer);
      for (const off of offs) off();
      root.replaceChildren();
    },
    /** Open the book on a given tab the next time the mode turns to 'book'. */
    setBookTab(tab) {
      if (BOOK_TABS.indexOf(tab) >= 0) wantTab = tab;
    },
  };
}
