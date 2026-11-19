// The apprentice's book (Tab): journal, the chart and its recipes, ingredients, the Magistra's
// pages, and the map with travel between lit lanterns. The game is paused while it is open and
// the UI owns the keyboard.
import { h, s, setClass, rgba, numberWord, clamp, actionsOf } from './dom.js';
import { createChart } from './chart.js';
import { signGlyph, glyph, SIGN, MARK } from './glyphs.js';
import { heatWord } from './brew.js';

const BONE = '#ddd5c4';
const EMBER = '#e2702c';
const TAU = Math.PI * 2;
const TABS = [
  ['journal', 'Journal'],
  ['chart', 'Chart'],
  ['ingredients', 'Ingredients'],
  ['lore', 'Pages'],
  ['map', 'Map'],
];
const cap = (str) => (str ? str[0].toUpperCase() + str.slice(1) : str);
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

function hourWord(hr) {
  if (hr == null || isNaN(hr)) return '';
  if (hr < 4.5) return 'Deep night';
  if (hr < 7) return 'First light';
  if (hr < 11) return 'Morning';
  if (hr < 14) return 'Midday';
  if (hr < 17.5) return 'Afternoon';
  if (hr < 20) return 'Dusk';
  if (hr < 22.5) return 'Evening';
  return 'Night';
}

/** One page of the Magistra's hand. Shared with the lore reader. */
export function lorePage(D, id, { reveal = false } = {}) {
  const L = D.LORE[id];
  if (!L) return h('div', { class: 'tp-lore' });
  const body = L.body.map((p, i) => h('p', { class: i === 0 && p.length < 28 ? 'tp-lore-salute' : null, text: p }));
  const page = h('div', { class: 'tp-lore' }, h('div', { class: 'tp-lore-title', text: L.title }), h('div', { class: 'tp-rule tp-lore-rule' }, h('i'), h('b'), h('i')), h('div', { class: 'tp-lore-body' }, body), L.sign ? h('div', { class: 'tp-lore-sign', text: L.sign }) : null);
  if (reveal && L.reveals && D.POTIONS[L.reveals]) {
    page.append(h('div', { class: 'tp-lore-reveal' }, h('i', { class: 'tp-loz is-full' }), h('span', { class: 'tp-label', text: 'Marked on the chart: ' + D.POTIONS[L.reveals].name })));
  }
  return page;
}

/** A small triangle with one mark on it: where an ingredient sits on the chart. */
function miniChart(D, bary) {
  const S = [50, 9],
    M = [6, 85.2],
    K = [94, 85.2];
  const p = D.baryTo2D(bary);
  const x = 6 + p[0] * 88,
    y = 85.2 - p[1] * 88;
  const sg = (id, tx, ty) => s('path', { d: SIGN[id], class: 'tp-mini-sign', transform: `translate(${tx} ${ty}) scale(0.52)` });
  return s(
    'svg',
    { class: 'tp-mini', viewBox: '-8 -12 116 118', 'aria-hidden': 'true' },
    s('path', { d: `M${S}L${K}L${M}Z`, class: 'tp-mini-tri' }),
    sg('sulfur', 43.8, -11),
    sg('mercury', -8, 88),
    sg('salt', 95.5, 88),
    s('path', { d: `M${x} ${y - 4.4}L${x + 3.3} ${y}L${x} ${y + 4.4}L${x - 3.3} ${y}Z`, class: 'tp-mini-mark' })
  );
}

export function createBook(game, icons) {
  const D = game.data;
  const A = actionsOf(game);
  const el = h('div', { class: 'tp-layer tp-book' });
  const chart = createChart(game, { book: true });

  const tabBtns = {};
  const tabs = h('div', { class: 'tp-tabs' });
  TABS.forEach(([id, label], i) => {
    tabBtns[id] = h('button', { class: 'tp-tab', type: 'button', text: label, on: { click: () => open(id) } });
    if (i) tabs.append(h('i', { class: 'tp-loz tp-tab-sep' }));
    tabs.append(tabBtns[id]);
  });
  const left = h('div', { class: 'tp-page tp-page-l' });
  const right = h('div', { class: 'tp-page tp-page-r' });
  const spread = h('div', { class: 'tp-spread' }, left, right);
  const foot = h('div', { class: 'tp-book-foot' });
  const footKey = (keys, label) => h('span', { class: 'tp-foot-item' }, keys.map((k) => h('span', { class: 'tp-key', text: k })), h('span', { class: 'tp-label', text: label }));
  foot.append(footKey(['A', 'D'], 'Turn the page'), footKey(['W', 'S'], 'Choose'), footKey(['Tab'], 'Close'));
  el.append(tabs, spread, foot);

  let tab = 'journal',
    on = false;
  const sel = { chart: null, ingredients: null, lore: null, map: null };
  let moveSel = null, // (dir) => void, set by the current page
    activate = null,
    mapView = null;

  const st = () => game.state;
  const inked = (id) => !!(st().known.charted[id] || st().known.potions[id]);
  const label = (t) => h('div', { class: 'tp-label tp-page-label', text: t });

  // ---- journal --------------------------------------------------------------------------------
  function pageJournal() {
    const state = st();
    const stage = state.quest.stage;
    const q = D.QUEST[stage] || { title: '', text: '' };
    left.append(label('The work at hand'), h('div', { class: 'tp-h2', text: q.title }), h('p', { class: 'tp-lead tp-it', text: q.text }));
    if (D.QUEST_ORDER.indexOf(stage) >= D.QUEST_ORDER.indexOf('primes')) {
      const list = h('div', { class: 'tp-hunts' });
      for (const id of ['salt', 'mercury', 'sulfur']) {
        const hunt = D.PRIME_HUNTS[id],
          item = D.PRIME_ITEMS[id];
        const got = !!state.inv.primes[id] || stage === 'stone' || stage === 'done' || state.inv.stone;
        const lifted = (state.world.gloom[hunt.region] || 0) < 0.5;
        const region = D.REGIONS[hunt.region] ? D.REGIONS[hunt.region].name : '';
        list.append(
          h(
            'div',
            { class: 'tp-hunt' + (got ? ' is-got' : '') },
            signGlyph(id),
            h('div', null, h('div', { class: 'tp-h3', text: item.name }), h('div', { class: 'tp-small', text: got ? 'Recovered.' + (lifted ? ' The Gloom has lifted from ' + region.replace(/^The /, 'the ') + '.' : '') : hunt.text }))
          )
        );
      }
      left.append(list);
    }
    if (state.inv.stone) left.append(h('div', { class: 'tp-hunts' }, h('div', { class: 'tp-hunt is-got' }, h('span', { class: 'tp-sign' }, icons.make('stone', 'stone')), h('div', null, h('div', { class: 'tp-h3', text: 'The Stone' }), h('div', { class: 'tp-small', text: 'Red at last. It is warm in the hand.' })))));

    // what lies behind: every step already taken, in the words the quest used for it
    const past = D.QUEST_ORDER.slice(0, Math.max(0, D.QUEST_ORDER.indexOf(stage)));
    if (past.length) {
      left.append(label('What is done'), h('div', { class: 'tp-done' }, past.map((id) => h('div', { class: 'tp-done-row' }, h('i', { class: 'tp-loz is-full' }), h('span', { text: D.QUEST[id].text })))));
    }

    const count = (bag) => Object.keys(bag || {}).filter((k) => bag[k]).length;
    const written = D.POTION_ORDER.filter(inked).length;
    const row = (name, n, of) => h('div', { class: 'tp-known-row' }, h('span', { text: name }), h('i'), h('span', { class: 'tp-num', text: `${n} / ${of}` }));
    const hr = game.hud && game.hud.time != null ? game.hud.time : state.time.hour;
    const day = state.time.day || 1;
    const fire = ['The Athanor is cold.', 'A pilot flame burns in the Athanor.', 'The Athanor burns.'][Math.max(0, Math.min(2, state.world.athanor | 0))];
    const lifted = ['saltwood', 'mere', 'scar'].filter((id) => (state.world.gloom[id] || 0) < 0.5).length;
    right.append(
      label('What is known'),
      h('div', { class: 'tp-known' }, row('Potions written', written, D.POTION_ORDER.length), row('Ingredients found', count(state.known.ingredients), D.INGREDIENT_ORDER.length), row('Pages read', count(state.known.lore), D.LORE_ORDER.length), row('Lanterns lit', count(state.known.lanterns), Object.keys(D.LANTERNS).length)),
      label('The isle'),
      h('p', { class: 'tp-lead tp-it', text: fire }),
      h('p', { class: 'tp-lead tp-it tp-dim', text: lifted === 3 ? 'The Gloom has gone back into the ground.' : lifted === 0 ? 'The Gloom lies on three places.' : `The Gloom lies on ${numberWord(3 - lifted)} ${3 - lifted === 1 ? 'place' : 'places'} still.` }),
      label('The hour'),
      h('p', { class: 'tp-lead tp-it', text: `The ${ORDINAL[day] || day + 'th'} day. ${hourWord(hr)}.` })
    );
    moveSel = activate = null;
  }

  // ---- chart and recipes ----------------------------------------------------------------------
  function pageChart() {
    const state = st();
    left.classList.add('tp-page-chart');
    left.append(chart.el);
    const known = D.POTION_ORDER.filter(inked);
    if (!sel.chart || known.indexOf(sel.chart) < 0) sel.chart = known[0] || null;
    const list = h('div', { class: 'tp-list' });
    const detail = h('div', { class: 'tp-detail' });
    const rows = {};

    function paint() {
      for (const id in rows) setClass(rows[id], 'is-sel', id === sel.chart);
      chart.setFocus(sel.chart, null);
      detail.replaceChildren();
      const p = D.POTIONS[sel.chart];
      if (!p) {
        detail.append(h('p', { class: 'tp-lead tp-it', text: 'Nothing is written here yet. The Magistra left her pages about the isle.' }));
        return;
      }
      const n = state.inv.potions[p.id] || 0;
      const use = p.throw && p.drink ? 'Thrown or drunk' : p.drink ? 'Drunk' : 'Thrown';
      detail.append(
        h('div', { class: 'tp-h2', text: p.full }),
        h('p', { class: 'tp-lead tp-it', text: p.motto }),
        h('p', { class: 'tp-body', text: p.effect }),
        h('div', { class: 'tp-facts' }, h('div', null, label('The fire'), h('div', { class: 'tp-fact', text: cap(heatWord(p.heat)) })), h('div', null, label('Its use'), h('div', { class: 'tp-fact', text: use })), h('div', null, label('Carried'), h('div', { class: 'tp-fact tp-num', text: n ? String(n) : 'None' }))),
        label('The recipe'),
        h('p', { class: 'tp-lead tp-it', text: p.hint })
      );
    }
    for (const id of D.POTION_ORDER) {
      const p = D.POTIONS[id];
      if (inked(id)) {
        rows[id] = h('button', { class: 'tp-row', type: 'button', on: { click: () => ((sel.chart = id), paint()), pointerenter: () => ((sel.chart = id), paint()) } }, h('span', { class: 'tp-row-key tp-num', text: String(p.key) }), h('span', { class: 'tp-row-name', text: p.name }), h('span', { class: 'tp-row-n tp-num', text: state.inv.potions[id] ? '×' + state.inv.potions[id] : '' }));
        list.append(rows[id]);
      } else {
        list.append(h('div', { class: 'tp-row is-unknown' }, h('span', { class: 'tp-row-key tp-num', text: String(p.key) }), h('span', { class: 'tp-row-name', text: 'Unwritten' })));
      }
    }
    right.append(label('Potions'), list, detail);
    paint();
    moveSel = (d) => {
      if (!known.length) return;
      const i = clamp(known.indexOf(sel.chart) + d, 0, known.length - 1);
      sel.chart = known[i];
      paint();
    };
    activate = null;
  }

  // ---- ingredients ----------------------------------------------------------------------------
  function pageIngredients() {
    const state = st();
    const known = D.INGREDIENT_ORDER.filter((id) => state.known.ingredients[id]);
    if (!sel.ingredients || known.indexOf(sel.ingredients) < 0) sel.ingredients = known[0] || null;
    const grid = h('div', { class: 'tp-grid' });
    const cells = {};
    const detail = h('div', { class: 'tp-detail' });

    function paint() {
      for (const id in cells) setClass(cells[id], 'is-sel', id === sel.ingredients);
      detail.replaceChildren();
      const ing = D.INGREDIENTS[sel.ingredients];
      if (!ing) {
        detail.append(h('p', { class: 'tp-lead tp-it', text: 'You have gathered nothing yet. Begin with flame.' }));
        return;
      }
      const n = state.inv.ingredients[ing.id] || 0;
      detail.append(
        h('div', { class: 'tp-detail-top' }, icons.make('ingredient', ing.id, 'tp-detail-icon', 256), h('div', null, h('div', { class: 'tp-h2', text: ing.name }), h('div', { class: 'tp-lead tp-it tp-dim', text: ing.latin }))),
        h('p', { class: 'tp-body', text: ing.desc }),
        h('div', { class: 'tp-facts tp-facts-ing' }, h('div', null, label('Where it grows'), h('div', { class: 'tp-fact', text: ing.where }), label('Carried'), h('div', { class: 'tp-fact tp-num', text: n ? String(n) : 'None' })), h('div', { class: 'tp-mini-wrap' }, label('On the chart'), miniChart(D, ing.bary)))
      );
    }
    for (const id of D.INGREDIENT_ORDER) {
      const ing = D.INGREDIENTS[id];
      if (state.known.ingredients[id]) {
        cells[id] = h('button', { class: 'tp-cell', type: 'button', on: { click: () => ((sel.ingredients = id), paint()), pointerenter: () => ((sel.ingredients = id), paint()) } }, icons.make('ingredient', id), h('span', { class: 'tp-cell-name', text: ing.name }), h('span', { class: 'tp-cell-n tp-num', text: state.inv.ingredients[id] ? String(state.inv.ingredients[id]) : '' }));
        grid.append(cells[id]);
      } else {
        grid.append(h('div', { class: 'tp-cell is-unknown' }, h('span', { class: 'tp-icon' }, h('i', { class: 'tp-loz' })), h('span', { class: 'tp-cell-name', text: 'Unknown' })));
      }
    }
    left.append(label('Gathered on Morne'), grid);
    right.append(detail);
    paint();
    moveSel = (d) => {
      if (!known.length) return;
      sel.ingredients = known[clamp(known.indexOf(sel.ingredients) + d, 0, known.length - 1)];
      paint();
    };
    activate = null;
  }

  // ---- the Magistra's pages -------------------------------------------------------------------
  function pageLore() {
    const state = st();
    const found = D.LORE_ORDER.filter((id) => state.known.lore[id]);
    if (!sel.lore || found.indexOf(sel.lore) < 0) sel.lore = found[found.length - 1] || null;
    const list = h('div', { class: 'tp-list tp-list-lore' });
    const rows = {};
    function paint() {
      for (const id in rows) setClass(rows[id], 'is-sel', id === sel.lore);
      right.replaceChildren(sel.lore ? lorePage(D, sel.lore) : h('p', { class: 'tp-lead tp-it', text: 'No pages yet. She left them where she worked.' }));
      right.scrollTop = 0;
    }
    for (const id of found) {
      rows[id] = h('button', { class: 'tp-row', type: 'button', on: { click: () => ((sel.lore = id), paint()), pointerenter: () => ((sel.lore = id), paint()) } }, h('span', { class: 'tp-row-name', text: D.LORE[id].title }));
      list.append(rows[id]);
    }
    left.append(label(`The notes of Magistra Odile Varn · ${found.length} of ${D.LORE_ORDER.length}`), list);
    paint();
    moveSel = (d) => {
      if (!found.length) return;
      sel.lore = found[clamp(found.indexOf(sel.lore) + d, 0, found.length - 1)];
      paint();
    };
    activate = null;
  }

  // ---- map ------------------------------------------------------------------------------------
  const REGION_AT = { shore: [0, 258], vale: [18, 6], saltwood: [-228, 128], mere: [215, 102], scar: [70, -222], heights: [-168, -238] };

  function createMapView(onPick, onHover) {
    const cvs = h('canvas', { class: 'tp-map-canvas' });
    const wrap = h('div', { class: 'tp-map' }, cvs);
    const ctx = cvs.getContext('2d');
    const paths = { lantern: new Path2D(MARK.lantern), home: new Path2D(MARK.home), arrow: new Path2D(MARK.arrow), flame: new Path2D(MARK.flame) };
    let W = 0,
      dpr = 1,
      dirty = true,
      hot = [];
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => (dirty = true)).observe(wrap);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => (dirty = true));

    const m = () => game.map || {};
    const uv = (x, z) => {
      const map = m();
      if (typeof map.toUV === 'function') return map.toUV(x, z);
      const size = map.size || 768;
      return [(x + size / 2) / size, (z + size / 2) / size];
    };

    function plain() {
      // no survey of the isle yet: a coastline drawn from memory
      const c = W / 2;
      const coast = (k) => {
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
          const a = (i / 180) * TAU;
          const r = W * 0.405 * k * (1 + 0.07 * Math.sin(3 * a + 1.2) + 0.05 * Math.sin(5 * a + 0.4) + 0.028 * Math.sin(9 * a + 2.1));
          const x = c + Math.cos(a) * r,
            y = c + Math.sin(a) * r;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
      };
      ctx.lineWidth = 1 * dpr;
      for (const [k, a] of [
        [1.075, 0.07],
        [1.04, 0.13],
      ]) {
        coast(k);
        ctx.strokeStyle = rgba(BONE, a);
        ctx.stroke();
      }
      coast(1);
      ctx.fillStyle = rgba(BONE, 0.04);
      ctx.fill();
      ctx.strokeStyle = rgba(BONE, 0.6);
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }

    function glyphAt(path, x, y, size, stroke, fill) {
      const k = size / 24;
      ctx.save();
      ctx.translate(x - size / 2, y - size / 2);
      ctx.scale(k, k);
      ctx.lineWidth = (1.2 * dpr) / k;
      ctx.lineJoin = 'round';
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill(path);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke(path);
      }
      ctx.restore();
    }

    function draw() {
      const d = Math.min(2, window.devicePixelRatio || 1);
      const side = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
      if (side < 16) return;
      dirty = false;
      cvs.style.width = cvs.style.height = side + 'px';
      const px = Math.round(side * d);
      if (px !== W || d !== dpr) {
        W = cvs.width = cvs.height = px;
        dpr = d;
      }
      const cs = getComputedStyle(wrap);
      const disp = cs.getPropertyValue('--tp-display').trim() || 'Georgia, serif';
      const state = st();
      const map = m();
      ctx.clearRect(0, 0, W, W);
      ctx.fillStyle = 'rgba(221,213,196,0.025)';
      ctx.fillRect(0, 0, W, W);
      let drawn = false;
      if (map.canvas && map.canvas.width) {
        try {
          // the survey is laid in a little dark, so the marks and lettering stand over it
          ctx.globalAlpha = 0.8;
          ctx.drawImage(map.canvas, 0, 0, W, W);
          drawn = true;
        } catch (e) {
          drawn = false;
        }
        ctx.globalAlpha = 1;
      }
      if (!drawn) plain();
      ctx.strokeStyle = rgba(BONE, 0.22);
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(0.5 * dpr, 0.5 * dpr, W - dpr, W - dpr);

      // north
      ctx.strokeStyle = rgba(BONE, 0.6);
      ctx.fillStyle = rgba(BONE, 0.8);
      const nx = W - 26 * dpr,
        ny = 38 * dpr;
      ctx.beginPath();
      ctx.moveTo(nx, ny + 12 * dpr);
      ctx.lineTo(nx, ny - 8 * dpr);
      ctx.moveTo(nx - 4 * dpr, ny - 3 * dpr);
      ctx.lineTo(nx, ny - 9 * dpr);
      ctx.lineTo(nx + 4 * dpr, ny - 3 * dpr);
      ctx.stroke();
      const sans = cs.getPropertyValue('--tp-sans').trim() || 'sans-serif';
      ctx.font = `600 ${10 * dpr}px ${sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('N', nx, ny - 13 * dpr);

      const size = clamp(W * 0.046, 22 * dpr, 40 * dpr);
      const marks = (map.marks || []).map((mk) => {
        const p = uv(mk.x, mk.z);
        return { mk, x: p[0] * W, y: p[1] * W, r: size * (mk.kind === 'lantern' ? 0.8 : 0.45) };
      });

      // lettering for the places the apprentice has walked
      const fs = clamp(W * 0.025, 10.5 * dpr, 19 * dpr);
      ctx.font = `500 ${fs}px ${disp}`;
      const track = 'letterSpacing' in ctx ? fs * 0.24 : 0;
      if (track) ctx.letterSpacing = track.toFixed(1) + 'px';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const id in REGION_AT) {
        if (!state.known.regions[id] || !D.REGIONS[id]) continue;
        const p = uv(REGION_AT[id][0], REGION_AT[id][1]);
        const name = D.REGIONS[id].name.toUpperCase();
        const half = ctx.measureText(name).width / 2;
        const cx = p[0] * W;
        let ty = p[1] * W;
        // lettering steps off any mark it would otherwise sit on
        for (const k of [0, 1, -1, 2, -2, 3, -3]) {
          const y = p[1] * W + k * fs * 0.9;
          if (!marks.some((q) => Math.abs(q.x - cx) < half + q.r && Math.abs(q.y - y) < fs * 0.6 + q.r)) {
            ty = y;
            break;
          }
        }
        const tx = cx + track / 2;
        // a soft dark ground under the letters: pale salt and black water both stay readable
        ctx.save();
        ctx.shadowColor = 'rgba(4,4,6,0.95)';
        ctx.shadowBlur = 7 * dpr;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(4,4,6,0.5)';
        ctx.strokeText(name, tx, ty);
        ctx.restore();
        ctx.fillStyle = rgba(BONE, 0.88);
        ctx.fillText(name, tx, ty);
      }
      if (track) ctx.letterSpacing = '0px';

      // marks
      hot = [];
      for (const { mk, x, y } of marks) {
        if (mk.kind === 'lantern') {
          const lit = !!mk.lit;
          if (sel.map === mk.id) {
            // the chosen lantern wears a ring
            ctx.lineWidth = 1.2 * dpr;
            ctx.strokeStyle = lit ? EMBER : rgba(BONE, 0.5);
            ctx.beginPath();
            ctx.arc(x, y, size * 0.74, 0, TAU);
            ctx.stroke();
          }
          glyphAt(paths.lantern, x, y, size, rgba(BONE, lit ? 1 : 0.5), 'rgba(5,5,7,0.72)');
          if (lit) {
            ctx.save();
            ctx.shadowColor = EMBER;
            ctx.shadowBlur = 8 * dpr;
            glyphAt(paths.flame, x, y, size, null, '#ffb373');
            ctx.restore();
          }
          hot.push({ id: mk.id, x, y, r: size * 0.7, lit });
        } else if (mk.kind === 'home') {
          glyphAt(paths.home, x, y, size * 0.92, rgba(BONE, 0.95), 'rgba(5,5,7,0.72)');
        } else if (mk.kind === 'quest') {
          const r = size * 0.26;
          ctx.fillStyle = EMBER;
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r * 0.74, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r * 0.74, y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = rgba(BONE, 0.8);
          ctx.beginPath();
          ctx.arc(x, y, 2 * dpr, 0, TAU);
          ctx.fill();
        }
      }
      // the apprentice
      if (map.player) {
        const p = uv(map.player.x, map.player.z);
        const heading = game.hud && game.hud.compass && game.hud.compass.heading != null ? game.hud.compass.heading : -(map.player.yaw || 0);
        ctx.save();
        ctx.translate(p[0] * W, p[1] * W);
        ctx.rotate(heading);
        const k = (size * 0.8) / 24;
        ctx.scale(k, k);
        ctx.translate(-12, -12);
        ctx.fillStyle = BONE;
        ctx.strokeStyle = 'rgba(5,5,7,0.9)';
        ctx.lineWidth = (2.4 * dpr) / k;
        ctx.lineJoin = 'round';
        ctx.stroke(paths.arrow);
        ctx.fill(paths.arrow);
        ctx.restore();
      }
    }

    function pick(e) {
      const r = cvs.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W,
        y = ((e.clientY - r.top) / r.height) * W;
      let best = null,
        bd = Infinity;
      for (const hs of hot) {
        const dd = Math.hypot(hs.x - x, hs.y - y);
        if (dd < hs.r * 1.3 && dd < bd) {
          bd = dd;
          best = hs;
        }
      }
      return best;
    }
    cvs.addEventListener('pointermove', (e) => {
      const hs = pick(e);
      cvs.style.cursor = hs && hs.lit ? 'pointer' : '';
      if (hs) onHover(hs.id);
    });
    cvs.addEventListener('click', (e) => {
      const hs = pick(e);
      if (hs) onPick(hs.id);
    });
    return {
      el: wrap,
      draw,
      update() {
        if (dirty) draw();
      },
      touch() {
        dirty = true;
      },
    };
  }

  function pageMap() {
    const state = st();
    const ids = Object.keys(D.LANTERNS);
    const lit = (id) => !!state.known.lanterns[id];
    if (!sel.map || ids.indexOf(sel.map) < 0) sel.map = ids.find(lit) || ids[0];
    const rows = {};
    const act = h('div', { class: 'tp-map-act' });

    function travel(id) {
      if (lit(id)) A.travel(id);
    }
    function paint() {
      for (const id in rows) setClass(rows[id], 'is-sel', id === sel.map);
      act.replaceChildren();
      const L = D.LANTERNS[sel.map];
      if (L) {
        if (lit(sel.map)) act.append(h('button', { class: 'tp-act', type: 'button', on: { click: () => travel(sel.map) } }, h('span', { class: 'tp-key', text: 'Enter' }), h('span', { class: 'tp-act-text', text: 'Travel to ' + L.name.replace(/^The /, 'the ') })));
        else act.append(h('p', { class: 'tp-small tp-dim', text: 'This lantern is dark. An Ember will light it.' }));
      }
      if (mapView) mapView.touch();
    }
    mapView = createMapView(
      (id) => {
        sel.map = id;
        paint();
        travel(id);
      },
      (id) => {
        if (sel.map !== id) {
          sel.map = id;
          paint();
        }
      }
    );
    left.classList.add('tp-page-map');
    left.append(mapView.el);
    const list = h('div', { class: 'tp-list' });
    for (const id of ids) {
      const L = D.LANTERNS[id];
      rows[id] = h(
        'button',
        { class: 'tp-row tp-row-lantern' + (lit(id) ? ' is-lit' : ''), type: 'button', on: { click: () => ((sel.map = id), paint(), travel(id)), pointerenter: () => ((sel.map = id), paint()) } },
        glyph(MARK.lantern + (lit(id) ? MARK.flame : ''), 'tp-row-glyph'),
        h('span', { class: 'tp-row-name', text: L.name }),
        h('span', { class: 'tp-row-n tp-label', text: lit(id) ? 'Lit' : 'Dark' })
      );
      list.append(rows[id]);
    }
    right.append(label('Lanterns of the dead'), list, act, h('p', { class: 'tp-small tp-dim tp-map-note', text: 'A lit lantern keeps your place. If the Gloom takes you, you rise at the last one you lit.' }));
    paint();
    moveSel = (d) => {
      sel.map = ids[clamp(ids.indexOf(sel.map) + d, 0, ids.length - 1)];
      paint();
    };
    activate = () => travel(sel.map);
  }

  // ---- switching ------------------------------------------------------------------------------
  const PAGES = { journal: pageJournal, chart: pageChart, ingredients: pageIngredients, lore: pageLore, map: pageMap };

  function open(id) {
    if (!PAGES[id]) id = 'journal';
    tab = id;
    for (const t in tabBtns) setClass(tabBtns[t], 'is-sel', t === id);
    left.className = 'tp-page tp-page-l';
    right.className = 'tp-page tp-page-r';
    left.replaceChildren();
    right.replaceChildren();
    left.scrollTop = right.scrollTop = 0;
    mapView = null;
    spread.dataset.tab = id;
    PAGES[id]();
    if (id === 'chart') chart.invalidate();
    // replay the turn of the page
    spread.classList.remove('is-turn');
    void spread.offsetWidth;
    spread.classList.add('is-turn');
  }

  function key(e) {
    const c = e.code;
    if (c === 'KeyM' && tab !== 'map') {
      // M means the map wherever it is pressed: from another page it turns to the map
      if (!e.repeat) open('map');
      return true;
    }
    if (c === 'Tab' || c === 'Escape' || c === 'KeyM') {
      // a held key must not close the book and let the game open it again
      if (!e.repeat) A.closeBook();
      return true;
    }
    const i = TABS.findIndex((t) => t[0] === tab);
    if (c === 'ArrowLeft' || c === 'KeyA' || c === 'KeyQ') {
      open(TABS[(i + TABS.length - 1) % TABS.length][0]);
      return true;
    }
    if (c === 'ArrowRight' || c === 'KeyD' || c === 'KeyE') {
      open(TABS[(i + 1) % TABS.length][0]);
      return true;
    }
    if (c === 'ArrowUp' || c === 'KeyW') {
      if (moveSel) moveSel(-1);
      return true;
    }
    if (c === 'ArrowDown' || c === 'KeyS') {
      if (moveSel) moveSel(1);
      return true;
    }
    if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
      if (activate) activate();
      return true;
    }
    if (/^Digit[1-5]$/.test(c)) {
      open(TABS[Number(c.slice(5)) - 1][0]);
      return true;
    }
    return false;
  }

  return {
    el,
    key,
    get tab() {
      return tab;
    },
    setOn(v, wantTab) {
      if (v && (!on || (wantTab && wantTab !== tab))) open(wantTab || tab);
      on = v;
    },
    update(dt) {
      if (!on) return;
      if (tab === 'chart') chart.draw(dt);
      else if (tab === 'map' && mapView) mapView.update();
    },
  };
}
