// Everything that is not the HUD, the cauldron or the book: loading, title, pause with settings
// and controls, the lore reader, death, the ending and its credits, photo mode, cutscene bars.
import { h, s, setText, setClass, setStyle, clamp, clamp01, actionsOf } from './dom.js';
import { SIGN } from './glyphs.js';
import { lorePage } from './book.js';

const isUp = (c) => c === 'ArrowUp' || c === 'KeyW';
const isDown = (c) => c === 'ArrowDown' || c === 'KeyS';
const isLeft = (c) => c === 'ArrowLeft' || c === 'KeyA';
const isRight = (c) => c === 'ArrowRight' || c === 'KeyD';
const isGo = (c) => c === 'Enter' || c === 'NumpadEnter' || c === 'Space';
const rule = (cls = '') => h('div', { class: 'tp-rule ' + cls }, h('i'), h('b'), h('i'));
const keyLabel = (k, label) => [h('span', { class: 'tp-key', text: k }), h('span', { class: 'tp-label', text: label })];

// ---------------------------------------------------------------------------------------------
// The sigil: the triangle with its three signs. On the loading screen its outline is inked in
// as the isle is raised.
// ---------------------------------------------------------------------------------------------
function sigil(cls = '') {
  const tri = 'M60 14L108 97L12 97Z';
  const sg = (id, x, y) => s('path', { d: SIGN[id], class: 'tp-sigil-sign', 'data-sign': id, transform: `translate(${x} ${y}) scale(0.8)` });
  return s(
    'svg',
    { class: 'tp-sigil ' + cls, viewBox: '-12 -24 144 150', 'aria-hidden': 'true' },
    s('path', { d: tri, class: 'tp-sigil-track' }),
    s('path', { d: tri, class: 'tp-sigil-ink', pathLength: 1 }),
    s('path', { d: 'M60 63.5L64.4 69.4L60 75.3L55.6 69.4Z', class: 'tp-sigil-heart' }),
    sg('sulfur', 50.4, -10.8),
    sg('salt', 104.8, 99),
    sg('mercury', -4, 99)
  );
}

// ---------------------------------------------------------------------------------------------
// A column of words. One of them is chosen.
// ---------------------------------------------------------------------------------------------
function createMenu() {
  const el = h('div', { class: 'tp-menu' });
  let items = [],
    sel = 0;
  function paint() {
    items.forEach((it, i) => setClass(it.el, 'is-sel', i === sel));
  }
  function set(list, start) {
    items = list;
    el.replaceChildren(
      ...list.map((it, i) => {
        it.el = h('button', { class: 'tp-menu-item', type: 'button', text: it.label });
        if (it.disabled) it.el.disabled = true;
        it.el.addEventListener('pointerenter', () => {
          if (!it.disabled) {
            sel = i;
            paint();
          }
        });
        it.el.addEventListener('click', () => {
          if (it.disabled) return;
          sel = i;
          paint();
          it.action();
        });
        return it.el;
      })
    );
    sel = start != null && list[start] && !list[start].disabled ? start : Math.max(0, list.findIndex((it) => !it.disabled));
    paint();
  }
  function move(d) {
    for (let k = 0; k < items.length; k++) {
      sel = (sel + d + items.length) % items.length;
      if (!items[sel].disabled) break;
    }
    paint();
  }
  function key(e) {
    const c = e.code;
    if (isUp(c)) move(-1);
    else if (isDown(c)) move(1);
    else if (isGo(c)) {
      if (!e.repeat && items[sel] && !items[sel].disabled) items[sel].action();
    } else return false;
    return true;
  }
  return { el, set, key };
}

// ---------------------------------------------------------------------------------------------
// Settings: every key of game.settings, one row each.
// ---------------------------------------------------------------------------------------------
const pct = (v) => Math.round(v * 100) + ' %';
const SETTINGS = [
  { group: 'Picture' },
  { key: 'quality', label: 'Quality', type: 'choice', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] },
  { key: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct },
  { key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°' },
  { key: 'grain', label: 'Film grain', type: 'toggle' },
  { key: 'shake', label: 'Camera shake', type: 'toggle' },
  { group: 'Hand' },
  { key: 'sensitivity', label: 'Look speed', type: 'range', min: 0.2, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) },
  { key: 'invertY', label: 'Invert look', type: 'toggle' },
  { key: 'hints', label: 'Hints', type: 'toggle' },
  { group: 'Sound' },
  { key: 'master', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'music', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'sfx', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
];

function createSettingsPane(game) {
  const el = h('div', { class: 'tp-pane tp-settings' }, h('div', { class: 'tp-h2 tp-pane-title', text: 'Settings' }));
  const body = h('div', { class: 'tp-set-body' });
  el.append(body);
  const rows = [];
  let sel = 0;

  const get = (def) => {
    const v = game.settings ? game.settings[def.key] : undefined;
    if (def.type === 'range') return typeof v === 'number' ? v : def.min;
    if (def.type === 'toggle') return !!v;
    return v;
  };
  const A = actionsOf(game);
  function put(def, v) {
    if (def.type === 'range') v = clamp(Math.round(v / def.step) * def.step, def.min, def.max);
    A.setSetting(def.key, v);
    paintRow(rows.find((r) => r.def === def), v);
  }
  function paintRow(row, v) {
    if (!row) return;
    const def = row.def;
    if (v === undefined) v = get(def);
    if (def.type === 'range') {
      const t = clamp01((v - def.min) / (def.max - def.min));
      setStyle(row.fill, 'transform', `scaleX(${t.toFixed(3)})`);
      setStyle(row.knob, 'left', (t * 100).toFixed(1) + '%');
      setText(row.val, def.fmt(v));
    } else if (def.type === 'toggle') {
      setClass(row.opts[0], 'is-on', !v);
      setClass(row.opts[1], 'is-on', !!v);
    } else {
      def.options.forEach((o, i) => setClass(row.opts[i], 'is-on', o[0] === v));
    }
  }
  function paintSel() {
    rows.forEach((r, i) => setClass(r.el, 'is-sel', i === sel));
  }

  for (const def of SETTINGS) {
    if (def.group) {
      body.append(h('div', { class: 'tp-label tp-set-group', text: def.group }));
      continue;
    }
    const row = { def };
    let ctl;
    if (def.type === 'range') {
      row.fill = h('i');
      row.knob = h('b');
      row.val = h('span', { class: 'tp-set-val tp-num' });
      const track = h('div', { class: 'tp-range-track' }, row.fill, row.knob);
      const at = (e) => {
        const r = track.getBoundingClientRect();
        put(def, def.min + clamp01((e.clientX - r.left) / r.width) * (def.max - def.min));
      };
      const hit = h('div', { class: 'tp-range' }, track);
      hit.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          hit.setPointerCapture(e.pointerId);
        } catch (err) {
          /* fine */
        }
        hit.__drag = true;
        at(e);
      });
      hit.addEventListener('pointermove', (e) => hit.__drag && at(e));
      const end = () => (hit.__drag = false);
      hit.addEventListener('pointerup', end);
      hit.addEventListener('pointercancel', end);
      ctl = h('div', { class: 'tp-set-ctl' }, hit, row.val);
    } else {
      const options = def.type === 'toggle' ? [[false, 'Off'], [true, 'On']] : def.options;
      row.opts = options.map((o) => h('button', { class: 'tp-opt', type: 'button', text: o[1], on: { click: () => put(def, o[0]) } }));
      ctl = h('div', { class: 'tp-set-ctl tp-choice' }, row.opts);
    }
    row.el = h('div', { class: 'tp-set-row' }, h('div', { class: 'tp-set-label', text: def.label }), ctl);
    const i = rows.length;
    row.el.addEventListener('pointerenter', () => {
      sel = i;
      paintSel();
    });
    rows.push(row);
    body.append(row.el);
  }
  el.append(h('div', { class: 'tp-pane-foot' }, keyLabel('Esc', 'Back')));

  function nudge(row, d) {
    const def = row.def;
    const v = get(def);
    if (def.type === 'range') put(def, v + d * def.step);
    else if (def.type === 'toggle') put(def, d > 0);
    else {
      const i = clamp(def.options.findIndex((o) => o[0] === v) + d, 0, def.options.length - 1);
      put(def, def.options[i][0]);
    }
  }
  function key(e) {
    const c = e.code;
    if (isUp(c)) sel = (sel + rows.length - 1) % rows.length;
    else if (isDown(c)) sel = (sel + 1) % rows.length;
    else if (isLeft(c)) nudge(rows[sel], -1);
    else if (isRight(c)) nudge(rows[sel], 1);
    else if (isGo(c)) {
      const def = rows[sel].def;
      if (def.type === 'toggle') put(def, !get(def));
      else if (def.type === 'choice') {
        const i = def.options.findIndex((o) => o[0] === get(def));
        put(def, def.options[(i + 1) % def.options.length][0]);
      }
    } else return false;
    paintSel();
    rows[sel].el.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function refresh() {
    for (const r of rows) paintRow(r);
    paintSel();
  }
  refresh();
  return { el, key, refresh };
}

function createControlsPane() {
  const walk = [
    [['W', 'A', 'S', 'D'], 'Walk'],
    [['Shift'], 'Run'],
    [['Space'], 'Jump'],
    [['E'], 'Use, gather, carry'],
    [['Mouse'], 'Throw. Hold to aim'],
    [['F'], 'Drink'],
    [['Q'], 'Next potion'],
    [['1', '7'], 'Choose a potion', '–'],
    [['Tab'], 'The book'],
    [['M'], 'The map'],
    [['P'], 'Photo mode'],
    [['Esc'], 'Pause'],
  ];
  const pot = [
    [['Mouse'], 'Stir. Circle over the pot'],
    [['Space'], 'Bellows. Hold'],
    [['C'], 'Damper. Hold'],
    [['B'], 'Bottle'],
    [['X'], 'Empty the pot'],
    [['Esc'], 'Leave'],
  ];
  const col = (title, list) =>
    h(
      'div',
      { class: 'tp-ctl-col' },
      h('div', { class: 'tp-label tp-set-group', text: title }),
      list.map(([keys, what, join]) =>
        h(
          'div',
          { class: 'tp-ctl-row' },
          h(
            'span',
            { class: 'tp-ctl-keys' },
            keys.map((k, i) => [i && join ? h('span', { class: 'tp-ctl-join', text: join }) : null, h('span', { class: 'tp-key', text: k })])
          ),
          h('span', { class: 'tp-ctl-what', text: what })
        )
      )
    );
  const el = h('div', { class: 'tp-pane tp-controls' }, h('div', { class: 'tp-h2 tp-pane-title', text: 'Controls' }), h('div', { class: 'tp-ctl-cols' }, col('On the isle', walk), col('At the cauldron', pot)), h('div', { class: 'tp-pane-foot' }, keyLabel('Esc', 'Back')));
  return { el, key: () => false, refresh() {} };
}

// ---------------------------------------------------------------------------------------------
// A menu screen: a column of words on the left, one pane (settings, controls, a question) beside it.
// ---------------------------------------------------------------------------------------------
function createMenuScreen(game, cls, head) {
  const el = h('div', { class: 'tp-layer tp-menuscreen ' + cls });
  const menu = createMenu();
  const col = h('div', { class: 'tp-menu-col' }, head, menu.el);
  const paneHost = h('div', { class: 'tp-pane-host' });
  el.append(col, paneHost);
  const settings = createSettingsPane(game);
  const controls = createControlsPane();
  let view = 'menu',
    pane = null,
    confirm = null;

  function show(v, node) {
    view = v;
    pane = node || null;
    paneHost.replaceChildren(...(node ? [node.el] : []));
    setClass(el, 'has-pane', !!node);
    if (node && node.refresh) node.refresh();
  }
  // back to the column of words, with the word that opened the pane still chosen
  function back() {
    show('menu', null);
  }
  // `grave`: the yes cannot be undone, so the question opens with the no chosen
  function ask(text, yes, no, onYes, grave) {
    confirm = createMenu();
    confirm.set(
      [
        { label: yes, action: onYes },
        { label: no, action: back },
      ],
      grave ? 1 : 0
    );
    show('confirm', { el: h('div', { class: 'tp-pane tp-confirm' }, h('p', { class: 'tp-confirm-text', text: text }), confirm.el), key: (e) => confirm.key(e) });
  }
  return {
    el,
    menu,
    setRoot(items) {
      menu.set(items);
    },
    openSettings: () => show('settings', settings),
    openControls: () => show('controls', controls),
    ask,
    back,
    refresh() {
      settings.refresh();
    },
    reset() {
      show('menu', null);
    },
    get view() {
      return view;
    },
    /** Returns 'back' when Esc was pressed on the root menu. */
    key(e) {
      if (e.code === 'Escape') {
        if (view !== 'menu') {
          back();
          return true;
        }
        return 'root-esc';
      }
      if (view === 'menu') return menu.key(e);
      return pane && pane.key ? pane.key(e) : false;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------
export function createLoading(game) {
  const D = game.data;
  const mark = sigil('tp-sigil-load');
  const label = h('div', { class: 'tp-label tp-loading-label', text: 'Raising the isle' });
  const el = h('div', { class: 'tp-layer tp-loading' }, h('div', { class: 'tp-loading-inner' }, mark, h('div', { class: 'tp-wordmark tp-wordmark-s', text: D.GAME_TITLE }), label));
  const ink = mark.querySelector('.tp-sigil-ink');
  const signs = { sulfur: mark.querySelector('[data-sign="sulfur"]'), salt: mark.querySelector('[data-sign="salt"]'), mercury: mark.querySelector('[data-sign="mercury"]') };
  const heart = mark.querySelector('.tp-sigil-heart');
  function set(p, text) {
    p = clamp01(p);
    ink.style.strokeDashoffset = (1 - p).toFixed(4);
    // each sign is lit as the ink reaches its corner
    setClass(signs.sulfur, 'is-on', p > 0.02);
    setClass(signs.salt, 'is-on', p >= 0.333);
    setClass(signs.mercury, 'is-on', p >= 0.666);
    setClass(heart, 'is-on', p >= 0.999);
    if (text) setText(label, text);
  }
  set(0);
  return { el, set };
}

// ---------------------------------------------------------------------------------------------
// Title: lettering over the live scene.
// ---------------------------------------------------------------------------------------------
export function createTitle(game) {
  const D = game.data,
    A = actionsOf(game);
  const head = h('div', { class: 'tp-title-head' }, sigil('tp-sigil-title is-full'), h('div', { class: 'tp-label tp-title-over', text: 'Isle of ' + D.ISLE }), h('h1', { class: 'tp-wordmark', text: D.GAME_TITLE }), rule('tp-title-rule'));
  const scr = createMenuScreen(game, 'tp-title', head);
  scr.el.append(h('div', { class: 'tp-label tp-title-ver', text: D.GAME_VERSION }));

  function items() {
    let has = false;
    try {
      // asked for only when the game can answer: a title without saves is not a fault
      has = !!(game.actions && typeof game.actions.hasSave === 'function' && game.actions.hasSave());
    } catch (e) {
      has = false;
    }
    const begin = () => {
      if (has) scr.ask('Begin again? The journey you kept will be lost.', 'Begin again', 'Keep it', () => A.newGame(), true);
      else A.newGame();
    };
    const list = [];
    if (has) list.push({ label: 'Continue', action: () => A.continueGame() });
    list.push({ label: has ? 'Begin again' : 'Begin', action: begin });
    list.push({ label: 'Settings', action: scr.openSettings });
    list.push({ label: 'Controls', action: scr.openControls });
    return list;
  }
  return {
    el: scr.el,
    setOn(v) {
      if (v) {
        scr.reset();
        scr.setRoot(items());
      }
    },
    refresh: () => scr.refresh(),
    key(e) {
      const r = scr.key(e);
      return r === 'root-esc' ? true : r;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------------------------
export function createPause(game) {
  const A = actionsOf(game);
  const head = h('div', { class: 'tp-pause-head' }, h('div', { class: 'tp-label', text: game.data.GAME_TITLE }), h('div', { class: 'tp-h1', text: 'Paused' }), rule('tp-title-rule'));
  const scr = createMenuScreen(game, 'tp-pause', head);
  const root = [
    { label: 'Return', action: () => A.resume() },
    { label: 'Settings', action: scr.openSettings },
    { label: 'Controls', action: scr.openControls },
    { label: 'Leave the isle', action: () => scr.ask('Leave Morne? Your journey is kept as it stands.', 'Leave', 'Stay', () => A.quitToTitle()) },
  ];
  return {
    el: scr.el,
    setOn(v) {
      if (v) {
        scr.reset();
        scr.setRoot(root);
      }
    },
    refresh: () => scr.refresh(),
    key(e) {
      const r = scr.key(e);
      if (r === 'root-esc') {
        if (!e.repeat) A.resume();
        return true;
      }
      return r;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The lore reader: one page, then back to the world.
// ---------------------------------------------------------------------------------------------
export function createReader(game, onClose) {
  const D = game.data;
  const A = actionsOf(game);
  const sheet = h('div', { class: 'tp-reader-sheet' });
  const done = h('button', { class: 'tp-reader-done', type: 'button' }, keyLabel('Enter', 'Put the page away'));
  const el = h('div', { class: 'tp-layer tp-reader' }, sheet, done);
  let open = false,
    openedAt = 0;
  function close() {
    if (!open) return;
    open = false;
    if (onClose) onClose();
    A.readLoreDone();
  }
  done.addEventListener('click', close);
  return {
    el,
    get open() {
      return open;
    },
    show(id) {
      if (!D.LORE[id]) return false;
      sheet.replaceChildren(lorePage(D, id, { reveal: true }));
      sheet.scrollTop = 0;
      open = true;
      openedAt = performance.now();
      return true;
    },
    hide() {
      open = false;
    },
    key(e) {
      const c = e.code;
      if (isGo(c) || c === 'Escape' || c === 'KeyE') {
        // a held key from the world must not shut the page the moment it opens
        if (!e.repeat && performance.now() - openedAt > 350) close();
        return true;
      }
      if (isUp(c)) sheet.scrollTop -= 60;
      else if (isDown(c)) sheet.scrollTop += 60;
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------------------------
export function createDead(game) {
  const A = actionsOf(game);
  const rise = h('button', { class: 'tp-dead-rise', type: 'button' }, keyLabel('Enter', 'Rise at the last lantern'));
  const el = h('div', { class: 'tp-layer tp-dead' }, h('div', { class: 'tp-dead-inner' }, h('div', { class: 'tp-dead-line', text: 'The Gloom takes you.' }), rule('tp-dead-rule'), rise));
  let shownAt = 0;
  const go = () => {
    if (performance.now() - shownAt > 1400) A.respawn();
  };
  rise.addEventListener('click', go);
  return {
    el,
    setOn(v) {
      if (v) shownAt = performance.now();
    },
    key(e) {
      if ((isGo(e.code) || e.code === 'KeyE') && !e.repeat) go();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The ending. data.js closes the quest with two lines; the two between them are the UI's.
// ---------------------------------------------------------------------------------------------
export function createEnding(game) {
  const D = game.data;
  const A = actionsOf(game);
  const text = h('div', { class: 'tp-ending-text' });
  const credits = h('div', { class: 'tp-credits' });
  const el = h('div', { class: 'tp-layer tp-ending' }, text, credits);
  let phase = null;

  function lines() {
    const done = D.QUEST.done || { title: '', text: '' };
    const list = [done.title + '.', 'The Gloom goes back into the ground, the way a tide goes out.', 'Salt holds. Mercury flows. Sulfur burns. The isle remembers its order.', done.text];
    text.replaceChildren(...list.map((t, i) => h('p', { style: { 'animation-delay': (0.6 + i * 3.4).toFixed(1) + 's' }, text: t })));
  }
  function roll() {
    const st = game.state.stats || {};
    const mins = Math.max(1, Math.round((st.seconds || 0) / 60));
    const time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    const stat = (name, v) => h('div', { class: 'tp-known-row' }, h('span', { text: name }), h('i'), h('span', { class: 'tp-num', text: String(v) }));
    credits.replaceChildren(
      sigil('tp-sigil-title is-full'),
      h('div', { class: 'tp-wordmark', text: D.GAME_TITLE }),
      rule('tp-title-rule'),
      h('p', { class: 'tp-lead tp-it', text: 'Every stone, flame and sound of Morne was made in code.' }),
      h('div', { class: 'tp-label tp-credits-label', text: 'Your work' }),
      h('div', { class: 'tp-known tp-credits-stats' }, stat('Time on the isle', time), stat('Potions brewed', st.brewed || 0), stat('Phials thrown', st.thrown || 0), stat('Things gathered', st.picked || 0), stat('Taken by the Gloom', st.deaths || 0)),
      h('div', { class: 'tp-label tp-credits-label', text: 'Made with' }),
      h('p', { class: 'tp-small tp-dim', text: 'three.js and cannon-es. Set in Cormorant Garamond and Inter.' }),
      h('button', { class: 'tp-credits-go', type: 'button', on: { click: () => A.resume() } }, keyLabel('Enter', 'Walk the isle'))
    );
  }
  return {
    el,
    get phase() {
      return phase;
    },
    /** True while the UI holds the keyboard: the closing lines and the credits. The cut is the game's. */
    get active() {
      return phase === 'text' || phase === 'credits';
    },
    set(p) {
      if (p === phase) return;
      phase = p;
      el.dataset.phase = p || '';
      if (p === 'text') lines();
      else text.replaceChildren();
      if (p === 'credits') roll();
      else credits.replaceChildren();
    },
    key(e) {
      if (phase === 'credits' && (isGo(e.code) || e.code === 'Escape') && !e.repeat) A.resume();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Photo mode: one quiet line. The game may list its own keys in game.hud.photo = [[key, label]].
// ---------------------------------------------------------------------------------------------
export function createPhoto(game) {
  const bar = h('div', { class: 'tp-photo-bar' });
  const el = h('div', { class: 'tp-layer tp-photo' }, bar);
  const OWN = [['P', 'Return']];
  let shown = null; // the words now on the bar, flat: key, label, key, label
  return {
    el,
    update() {
      const list = (game.hud && Array.isArray(game.hud.photo) && game.hud.photo) || OWN;
      let same = !!shown && shown.length === list.length * 2;
      for (let i = 0; same && i < list.length; i++) {
        const it = list[i] || OWN[0];
        same = it[0] === shown[i * 2] && it[1] === shown[i * 2 + 1];
      }
      if (same) return;
      shown = [];
      const items = [];
      for (const it of list) {
        const [key, label] = it || OWN[0];
        shown.push(key, label);
        items.push(h('span', { class: 'tp-foot-item' }, keyLabel(String(key), String(label))));
      }
      bar.replaceChildren(h('span', { class: 'tp-label tp-photo-name', text: 'Photo mode' }), ...items);
    },
  };
}

/** The two black bars of a cutscene. */
export function createBars() {
  const el = h('div', { class: 'tp-bars' }, h('i'), h('i'));
  return { el, setOn: (v) => setClass(el, 'is-on', v) };
}
