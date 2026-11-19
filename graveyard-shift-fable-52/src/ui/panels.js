// The HUD panels (laid out with G.ui.addPanel): weapon slots, armour plates, throwables, power-up
// timers, pickup toasts, the round banner and the search ring at the crosshair. The view-models are pure
// (tested); createPanels does the DOM, writing only values that changed.
import { WEAPONS } from '../weapon/defs.js';
import { tuning } from '../game/tuning.js';
import { shortWeaponName, narrowScreen } from './format.js';

export const RING_R = 22;
const TOAST_LIFE = 2.5;
const MAX_TOASTS = 3;
export const BANNER_LIFE = 2;
const THROW_NAMES = { frag: 'Frag', molotov: 'Molotov', decoy: 'Decoy' };
const THROW_ORDER = ['frag', 'molotov', 'decoy'];
const ATTACH_NAMES = { sight: 'Sight', mag: 'Extended mag', grip: 'Grip', suppressor: 'Suppressor' };
const PU_NAMES = (tuning.economy && tuning.economy.powerups && tuning.economy.powerups.names) || { resupply: 'Resupply', oneTap: 'One-Tap', doubleTime: 'Double Time', flashover: 'Flashover' };
const nameOf = (id) => (id === 'axe' ? 'Fire axe' : id === 'knife' ? 'Knife' : (WEAPONS[id] && WEAPONS[id].name) || String(id));
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ---- view-models --------------------------------------------------------------------------------
// out (optional): a caller-owned array refilled in place, so a panel that repaints five times a second allocates nothing
export function slotsView(weapon, out) {
  if (!weapon || !Array.isArray(weapon.slots)) return out ? (out.length = 0, out) : [];
  const res = out || [];
  const pool = out ? (out._pool || (out._pool = [null, null])) : null;
  res.length = 2;
  for (let i = 0; i < 2; i++) {
    const sl = weapon.slots[i];
    if (!sl || !sl.id) { if (pool && res[i]) pool[i] = res[i]; res[i] = null; continue; }
    const o = out ? (res[i] || (pool[i] && pool[i]) || { pips: { up: false, attach: 0 } }) : { pips: { up: false, attach: 0 } };
    if (!o.pips) o.pips = { up: false, attach: 0 };
    o.id = sl.id; o.name = sl.upgraded && WEAPONS[sl.id] && WEAPONS[sl.id].upgraded ? WEAPONS[sl.id].upgraded.name : nameOf(sl.id); o.held = weapon.slot === i; o.upgraded = !!sl.upgraded;
    o.mag = Number.isFinite(sl.mag) ? sl.mag : null; o.reserve = Number.isFinite(sl.reserve) ? sl.reserve : null;
    o.pips.up = !!sl.upgraded; o.pips.attach = sl.attachments && typeof sl.attachments.size === 'number' ? sl.attachments.size : 0;
    res[i] = o;
  }
  return res;
}
export function platesView(n) {
  const f = Math.max(0, Math.min(3, Math.floor(finite(n))));
  return { show: f > 0, filled: f, total: 3 };
}
export function throwablesView(weapon) {
  const t = weapon && weapon.throwables;
  if (!t) return [];
  const out = [];
  for (const kind of THROW_ORDER) { const c = t[kind] | 0; if (c > 0) out.push({ kind, name: THROW_NAMES[kind], count: c, selected: weapon.throwable === kind }); }
  return out;
}
export const timerPct = (left, total) => (total > 0 ? Math.round((Math.max(0, Math.min(total, finite(left)))) / total * 100) : 0);
export const timerView = (left, total) => ({ pct: timerPct(left, total) });
export function ringView(progress) {
  const p = Math.max(0, Math.min(1, finite(progress)));
  const circ = 2 * Math.PI * RING_R;
  return { show: p > 0, turn: p, dash: p * circ, circ };
}
// A reward (search:done) or a pickup (mode 'take') as one toast line: { icon, text }.
export function toastFor(reward, mode) {
  if (!reward || typeof reward !== 'object') return null;
  const item = reward.item;
  if (mode === 'take') return { icon: 'weapon', text: `${nameOf(item)} taken` };
  switch (reward.kind) {
    case 'nothing': return { icon: 'nothing', text: 'Nothing here' };
    case 'ammo': return { icon: 'ammo', text: `+${Math.round(finite(reward.amount))} rounds` };
    case 'points': return { icon: 'points', text: `+${Math.round(finite(reward.amount))}` };
    case 'medkit': return { icon: 'medkit', text: 'Medkit' };
    case 'plate': return { icon: 'plate', text: 'Armour plate' };
    case 'throwable': return { icon: 'throw', text: THROW_NAMES[item] || 'Throwable' };
    case 'attachment': return { icon: 'attach', text: ATTACH_NAMES[item] || 'Attachment' };
    case 'powerup': return { icon: 'powerup', text: `${PU_NAMES[item] || 'Power-up'}${reward.amount > 0 ? ` · ${Math.round(reward.amount)}s` : ''}` };
    case 'weapon': return { icon: 'weapon', text: nameOf(item) };
    default: return { icon: 'nothing', text: 'Found something' };
  }
}
// The stack: newest last, at most `max`; returns a new list. Items keep their identity so the DOM can follow.
export function pushToast(list, toast, now = 0, max = MAX_TOASTS) {
  const next = list.concat([{ ...toast, at: now }]);
  return next.length > max ? next.slice(next.length - max) : next;
}
export function bannerFor(kind, e) {
  const n = String((e && e.n) || 1);
  if (kind === 'end') return { big: n, small: 'Round cleared' };
  return { big: n, small: e && e.boss ? 'Boss round' : 'Round' };
}

// ---- DOM --------------------------------------------------------------------------------------
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const NS = 'http://www.w3.org/2000/svg';
const GLYPH = { ammo: '▮', points: '+', medkit: '✚', plate: '◈', throw: '●', attach: '⚙', powerup: '⚡', weapon: '▬', nothing: '–' };

export function createPanels(G, { addPanel, overlay, staged = false, query = new URLSearchParams() }) {
  const off = [];
  const on = (n, fn) => { if (G.events && G.events.on) G.events.on(n, fn); };
  const sample = staged ? {
    weapon: { slots: [{ id: 'pistol', mag: 9, reserve: 48, upgraded: false, attachments: new Set() }, { id: 'pump', mag: 6, reserve: 24, upgraded: true, attachments: new Set(['sight']) }], slot: 0, throwables: { frag: 2, molotov: 0, decoy: 1 }, throwable: 'frag' },
    plates: 2, timers: [['oneTap', 12.4, 30]],
  } : null;

  // -- weapon slots (bottom-right on a desktop, folded up on touch)
  const slotsEl = h('div', 'gs-slots');
  const slotCache = [{}, {}];
  const slotEls = [0, 1].map(() => {
    const el = h('div', 'gs-slot');
    const name = h('span', 'n'), ammo = h('span', 'a'), pips = h('span', 'p');
    el.append(name, ammo, pips);
    slotsEl.appendChild(el);
    return { el, name, ammo, pips };
  });
  off.push(addPanel('slots', slotsEl, { corner: 'br', order: 0 }));

  // -- plates, throwables, timers (bottom-left)
  const platesEl = h('div', 'gs-plates');
  const plateIcons = [0, 1, 2].map(() => platesEl.appendChild(h('i')));
  off.push(addPanel('plates', platesEl, { corner: 'bl', order: 0 }));
  const throwEl = h('div', 'gs-throws');
  off.push(addPanel('throwables', throwEl, { corner: 'bl', order: 1 }));
  const timersEl = h('div', 'gs-timers');
  off.push(addPanel('powerups', timersEl, { corner: 'bl', order: 2 }));

  // -- toasts, banner, ring: on the HUD layer, off the corners
  const toastsEl = h('div', 'gs-toasts');
  const bannerEl = h('div', 'gs-banner');
  const bBig = h('div', 'big'), bSmall = h('div', 'small');
  bannerEl.append(bSmall, bBig);
  const ringEl = document.createElementNS(NS, 'svg');
  ringEl.setAttribute('class', 'gs-ring'); ringEl.setAttribute('viewBox', '-32 -32 64 64');
  const rTrack = document.createElementNS(NS, 'circle'), rFill = document.createElementNS(NS, 'circle');
  for (const c of [rTrack, rFill]) c.setAttribute('r', String(RING_R));
  rTrack.setAttribute('class', 'track'); rFill.setAttribute('class', 'fill');
  rFill.setAttribute('transform', 'rotate(-90)');
  ringEl.append(rTrack, rFill);
  overlay.append(toastsEl, bannerEl, ringEl);

  // ---- slots
  const slotBuf = [];
  function paintSlots(w) {
    const v = slotsView(w, slotBuf);
    for (let i = 0; i < 2; i++) {
      const it = v[i] || null, c = slotCache[i], d = slotEls[i];
      if (!it) { if (c.id !== null) { c.id = null; d.el.hidden = true; } continue; }
      const short = narrowScreen(G.ui && G.ui.touch);
      if (c.id !== it.id || c.up !== it.upgraded || c.short !== short) { c.id = it.id; c.up = it.upgraded; c.short = short; d.name.textContent = short ? shortWeaponName(it.name) : it.name; d.el.hidden = false; }
      if (c.held !== it.held) { c.held = it.held; d.el.classList.toggle('held', it.held); }
      if (c.mag !== it.mag || c.res !== it.reserve) { c.mag = it.mag; c.res = it.reserve; d.ammo.textContent = it.mag === null ? '' : `${it.mag} / ${it.reserve === null ? '—' : it.reserve}`; }
      const sig = (it.pips.up ? 8 : 0) + it.pips.attach;
      if (c.sig !== sig) {
        c.sig = sig; d.pips.textContent = '';
        if (it.pips.up) d.pips.appendChild(h('i', 'up'));
        for (let k = 0; k < it.pips.attach; k++) d.pips.appendChild(h('i', 'at'));
      }
    }
  }
  // ---- plates / throwables
  let platesN = -1;
  function paintPlates(n) {
    const f = Math.max(0, Math.min(3, Math.floor(finite(n))));
    if (f === platesN) return;
    const v = platesView(n);
    platesN = v.filled;
    platesEl.classList.toggle('on', v.show);
    for (let i = 0; i < 3; i++) plateIcons[i].classList.toggle('f', i < v.filled);
  }
  let throwSig = -1;
  function paintThrows(w) {
    const t = w && w.throwables;
    // a number, not a string: frag, molotov, decoy counts and the selected kind
    const sel = w ? THROW_ORDER.indexOf(w.throwable) + 1 : 0;
    const sig = t ? ((t.frag | 0) * 1000 + (t.molotov | 0) * 100 + (t.decoy | 0) * 10 + sel) : 0;
    if (sig === throwSig) return;
    throwSig = sig;
    const v = throwablesView(w);
    throwEl.textContent = '';
    for (const t of v) { const el = h('span', `gs-th${t.selected ? ' sel' : ''}`); el.append(h('b', null, String(t.count)), h('span', null, t.name)); throwEl.appendChild(el); }
  }
  // ---- timers
  const totals = {};
  const timerRows = new Map();
  const live = [];
  const pKind = [], pLeft = [], pTot = [];
  let pN = 0;
  function paintTimers() {
    live.length = 0;
    for (let i = 0; i < pN; i++) {
      const kind = pKind[i], left = pLeft[i], total = pTot[i];
      live.push(kind);
      let row = timerRows.get(kind);
      if (!row) {
        const el = h('div', 'gs-timer'), bar = h('i'), fill = h('b');
        bar.appendChild(fill);
        el.append(h('span', 'n', PU_NAMES[kind] || kind), bar);
        timersEl.appendChild(el);
        row = { el, fill, pct: -1 };
        timerRows.set(kind, row);
      }
      const pct = timerPct(left, total);
      if (pct !== row.pct) { row.pct = pct; row.fill.style.transform = `scaleX(${(pct / 100).toFixed(2)})`; }
    }
    if (timerRows.size > live.length) for (const [k, row] of timerRows) if (!live.includes(k)) { row.el.remove(); timerRows.delete(k); }
  }
  function collect(left, kind) { if (!(totals[kind] >= left)) totals[kind] = left; pKind[pN] = kind; pLeft[pN] = left; pTot[pN] = totals[kind]; pN++; }
  function readTimers() {
    pN = 0;
    if (sample) { for (const t of sample.timers) { pKind[pN] = t[0]; pLeft[pN] = t[1]; pTot[pN] = t[2]; pN++; } return; }
    const act = G.game && G.game.powerups && G.game.powerups.active;
    if (act && typeof act.forEach === 'function') act.forEach(collect);
  }

  // ---- toasts
  let toasts = [];
  const toastEls = new Map();
  let clock = 0;
  function pushIt(t) {
    if (!t) return;
    const before = toasts;
    toasts = pushToast(toasts, t, clock);
    for (const o of before) if (!toasts.includes(o)) { const el = toastEls.get(o); if (el) el.remove(); toastEls.delete(o); }
    const el = h('div', 'gs-toast');
    el.append(h('i', 'ic', GLYPH[t.icon] || '+'), h('span', null, t.text));
    toastsEl.appendChild(el);
    toastEls.set(toasts[toasts.length - 1], el);
  }
  on('powerup:take', (e) => {
    if (!e || !e.kind) return;
    if (e.seconds > 0) totals[e.kind] = e.seconds;
    else pushIt({ icon: 'powerup', text: PU_NAMES[e.kind] || 'Power-up' });
  });
  on('search:done', (e) => { if (e && e.reward) pushIt(toastFor(e.reward)); });
  on('pickup:take', (e) => pushIt(toastFor(e, 'take')));
  on('box:expire', () => pushIt({ icon: 'nothing', text: 'The offer ran out' }));
  on('pickup:lapse', () => pushIt({ icon: 'nothing', text: 'Left behind' }));
  on('powerup:lapse', () => pushIt({ icon: 'nothing', text: 'Power-up lost' }));
  function ageToasts(dt) {
    clock += dt;
    if (!toasts.length) return;
    let n = 0;
    for (const t of toasts) if (clock - t.at >= TOAST_LIFE) n++;
    if (!n) return;
    const keep = [];
    for (const t of toasts) {
      if (clock - t.at >= TOAST_LIFE) { const el = toastEls.get(t); if (el) el.remove(); toastEls.delete(t); } else keep.push(t);
    }
    toasts = keep;
  }

  // ---- banner
  let bannerT = 0;
  function banner(kind, e) {
    const b = bannerFor(kind, e);
    bBig.textContent = b.big; bSmall.textContent = b.small;
    bannerEl.classList.remove('on'); void bannerEl.offsetWidth; bannerEl.classList.add('on');
    bannerT = BANNER_LIFE;
  }
  on('round:start', (e) => { if (!staged) banner('start', e); });
  on('round:end', (e) => { if (!staged) banner('end', e); });

  // ---- ring
  let ringP = -1;
  function paintRing(p) {
    const q = Math.round(finite(p) * 100) / 100;
    if (q === ringP) return;
    ringP = q;
    const v = ringView(q);
    ringEl.classList.toggle('on', v.show);
    rFill.style.strokeDasharray = `${v.dash.toFixed(2)} ${v.circ.toFixed(2)}`;
  }

  // ---- staging (ui=hud): frozen samples, so a shot shows them
  const ringStage = Number(query.get('ring'));
  if (sample) {
    pushIt({ icon: 'ammo', text: '+36 rounds' }); pushIt({ icon: 'medkit', text: 'Medkit' });
    const b = Number(query.get('banner'));
    if (b > 0) { bBig.textContent = String(b); bSmall.textContent = query.get('boss') ? 'Boss round' : 'Round'; bannerEl.classList.add('on', 'still'); }
  }

  let acc = 1;
  return {
    update(dt) {
      if (!sample) {
        ageToasts(dt);
        if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) bannerEl.classList.remove('on'); }
      }
      acc += dt;
      if (acc >= 0.2) {
        acc = 0;
        const w = sample ? sample.weapon : G.weapon;
        paintSlots(w);
        paintThrows(w);
        paintPlates(sample ? sample.plates : G.player && G.player.plates);
        readTimers();
        paintTimers();
      }
      const touch = !!(G.ui && G.ui.touch);
      const hd = G.game && G.game.hold;
      // searching and rebuilding boards both report through G.game.hold (loot.progress alone for an older game module)
      const p = touch ? 0 : sample ? ringStage : hd ? (hd.active ? hd.progress : 0) : G.game && G.game.loot && G.game.loot.progress;
      paintRing(p);
    },
    dispose() { for (const f of off) if (typeof f === 'function') f(); },
  };
}
