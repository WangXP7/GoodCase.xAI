// The leaderboard UI: the end screen's optional gamertag form and save status (in
// G.ui.endScreen.slot), the Leaderboard screen (menus.setScreen('board')) reached from the title, pause and
// end screens, and the "use a tag from another device" recovery. Built only when the board is enabled
// (net/board.js boardMode): otherwise nothing here exists and nothing is requested.
//
// Rules: every tag is set with textContent; the secret is never shown, logged or put in the DOM; nothing
// here blocks Retry or throws into the game; no per-frame work (events and clicks only).
import { checkTag, errorText, submitRun, isPracticeRun, TAG_MAX } from '../net/board.js';
import { createShareBar } from './share.js';
import { track } from '../core/analytics.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (cls, text, onClick) => { const b = h('button', `gs-lk-btn${cls ? ` ${cls}` : ''}`, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
// a menu row in the menus' own style (NAME ...... hint)
const menuRow = (label, hint, onClick, small = false) => {
  const b = h('button', `gs-row${small ? ' small' : ''}`);
  b.type = 'button';
  b.append(h('span', 'k', label), h('span', 'lead'), h('span', 'hint', hint || ''));
  b.addEventListener('click', onClick);
  return b;
};
const textInput = (cls, label, { maxLength = 64, caps = 'off' } = {}) => {
  const i = h('input', `gs-lk-input${cls ? ` ${cls}` : ''}`);
  i.type = 'text';
  i.maxLength = maxLength;
  i.autocomplete = 'off';
  i.spellcheck = false;
  i.setAttribute('autocapitalize', caps);
  i.setAttribute('autocorrect', 'off');
  i.setAttribute('aria-label', label);
  i.setAttribute('enterkeyhint', 'done');
  return i;
};
const RANK = (n) => `#${n}`;

// Copy a code from inside the click; fall back to selecting it in its (readonly) field.
function copyField(field, note) {
  const done = () => { note.textContent = 'Copied'; };
  const fallback = () => {
    let ok = false;
    try { field.focus({ preventScroll: true }); field.select(); ok = document.execCommand && document.execCommand('copy'); } catch { ok = false; }
    note.textContent = ok ? 'Copied' : 'Selected — copy it now';
  };
  try {
    const p = navigator.clipboard && navigator.clipboard.writeText(field.value);
    if (p && p.then) p.then(done, fallback); else fallback();
  } catch { fallback(); }
}

export function createLeaderboard(G, { menus, endScreen, board, identity }) {
  const touch = () => !!(G.ui && G.ui.touch);
  // On touch, a form being typed in rides at the top of the screen (the keyboard covers the rest). Its
  // buttons keep the field focused when pressed (mousedown default prevented), so the form does not drop
  // back under the finger before the tap lands; it drops back when focus leaves the form.
  function liftWhileTyping(box, inputs, buttons) {
    for (const i of inputs) {
      i.addEventListener('focus', () => { if (touch()) box.classList.add('lifted'); });
      i.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) box.classList.remove('lifted'); }, 0));
    }
    for (const b of buttons) b.addEventListener('mousedown', (e) => { if (box.classList.contains('lifted')) e.preventDefault(); });
  }

  // ---------------------------------------------------------------- end of a run
  // phase: off | form | claiming | code | saving | saved | failed | stale | rejected | practice | skipped
  const S = { death: 0, run: null, phase: 'off', error: '', rank: null, best: false, recovery: '', sub: '', staged: false };
  let skipped = false; // Skip: no form again this session

  function decide() {
    if (!S.run) return 'off';
    if (S.practice) return 'practice';
    if (identity.get()) return 'saving';
    return skipped ? 'skipped' : 'form';
  }

  function onDeath(run, staged = false) {
    S.death++;
    S.run = run;
    S.staged = staged;
    // a staged screen (ui=dead) shows a sample run, and harness params change play: neither is submitted
    S.practice = staged || isPracticeRun(G.params || {});
    S.error = ''; S.rank = null; S.best = false; S.recovery = ''; S.sub = '';
    S.phase = decide();
    if (S.phase === 'saving') save('saving');
  }

  // Submit the run for the stored identity. `into`: the phase whose status line shows the result
  // ('saving' -> saved/failed/...; 'code' keeps the recovery code on screen and sets S.sub).
  function save(into) {
    const id = identity.get();
    const death = S.death;
    if (!id || !S.run) return;
    if (into === 'code') S.sub = 'saving'; else S.phase = 'saving';
    submitRun(board.api, id, S.run).then((r) => {
      if (death !== S.death) return;
      let next;
      if (r.ok) { next = 'saved'; S.rank = r.data && Number.isFinite(r.data.rank) ? r.data.rank : null; S.best = !!(r.data && r.data.personalBest); board.invalidate(); }
      else if (r.error === 'bad_secret') next = 'stale';
      else if (r.error === 'implausible_run') next = 'rejected';
      else next = 'failed';
      if (into === 'code') S.sub = next; else S.phase = next;
      renderSlot();
    });
    renderSlot();
  }

  // The slot: three lines (eyebrow, main row, note) whatever the phase, so nothing jumps.
  const slot = { root: h('div', 'gs-lk-slot'), eyebrow: h('p', 'gs-lk-eyebrow'), main: h('div', 'gs-lk-main'), note: h('p', 'gs-lk-note') };
  slot.note.setAttribute('aria-live', 'polite');
  slot.root.append(slot.eyebrow, slot.main, slot.note);
  let form = null;

  function buildForm() {
    const f = h('form', 'gs-lk-form');
    f.noValidate = true;
    f.setAttribute('aria-label', 'Save this run');
    const input = textInput('tag', 'Gamertag', { maxLength: TAG_MAX + 8, caps: 'words' });
    input.placeholder = 'Gamertag';
    const saveBtn = btn('primary', 'Save');
    saveBtn.type = 'submit';
    const skip = btn('', 'Skip', () => {
      skipped = true;
      S.phase = 'skipped';
      renderSlot();
      const retry = endScreen.host && endScreen.host.querySelector('[data-autofocus]');
      if (retry) retry.focus({ preventScroll: true });
    });
    f.append(input, saveBtn, skip);
    input.addEventListener('input', () => { if (S.error) { S.error = ''; slot.note.classList.remove('err'); slot.note.textContent = HINT; } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); input.blur(); } });
    // On a phone the keyboard covers the lower half: lift the form to the top while typing.
    liftWhileTyping(slot.root, [input], [saveBtn, skip]);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (S.phase !== 'form') return;
      const c = checkTag(input.value);
      if (!c.ok) { S.error = errorText({ error: 'invalid_tag', reason: c.reason }); renderSlot(); input.focus({ preventScroll: true }); return; }
      const death = S.death;
      S.phase = 'claiming'; S.error = '';
      renderSlot();
      board.api.claim(c.tag).then((r) => {
        if (death !== S.death) return;
        if (r.ok && r.data && r.data.tag && r.data.secret) {
          identity.set({ tag: r.data.tag, secret: r.data.secret });
          track('tag_claimed');
          S.recovery = String(r.data.recovery || '');
          input.blur();
          S.phase = 'code';
          save('code');
          return;
        }
        S.phase = 'form';
        S.error = errorText(r);
        renderSlot();
        input.focus({ preventScroll: true });
      });
    });
    return { f, input, save: saveBtn, skip };
  }
  const HINT = '3–16 letters, numbers, spaces, - or _. Optional.';

  function statusLine(phase) {
    const tag = identity.tag() || '';
    if (phase === 'saving') return ['Saving as ', tag, '…'];
    if (phase === 'saved') return ['Saved as ', tag, S.rank ? ` · rank ${RANK(S.rank)}` : ''];
    if (phase === 'stale') return [tag, ' is in use on another device', ''];
    if (phase === 'rejected') return ['This run was not saved', '', ''];
    if (phase === 'failed') return ['Couldn’t reach the leaderboard', '', ''];
    return ['', '', ''];
  }
  // tag in its own span (textContent), so a tag is never parsed as markup
  const line = (parts, cls) => {
    const el = h('span', cls);
    el.append(document.createTextNode(parts[0]));
    if (parts[1]) el.append(h('b', 'tag', parts[1]));
    if (parts[2]) el.append(document.createTextNode(parts[2]));
    return el;
  };

  function renderSlot() {
    const p = S.phase;
    const r = slot.root;
    r.dataset.phase = p;
    if (p === 'off' || p === 'skipped') { r.hidden = true; return; }
    r.hidden = false;
    slot.note.classList.remove('err');
    slot.main.textContent = '';
    if (p === 'form' || p === 'claiming') {
      if (!form) form = buildForm();
      slot.eyebrow.textContent = 'Save this run — pick a gamertag';
      slot.main.appendChild(form.f);
      form.input.disabled = p === 'claiming';
      form.save.disabled = p === 'claiming';
      form.save.textContent = p === 'claiming' ? 'Saving' : 'Save';
      if (S.error) { slot.note.textContent = S.error; slot.note.classList.add('err'); } else slot.note.textContent = p === 'claiming' ? 'Claiming your tag…' : HINT;
      return;
    }
    if (p === 'code') {
      const sub = S.sub || 'saving';
      slot.eyebrow.textContent = '';
      slot.eyebrow.appendChild(line(statusLine(sub), 'st'));
      const code = h('input', 'gs-lk-code');
      code.readOnly = true;
      code.value = S.recovery;
      code.setAttribute('aria-label', 'Recovery code');
      const note = h('span', 'gs-lk-copied');
      note.setAttribute('aria-live', 'polite');
      const copy = btn('', 'Copy', () => copyField(code, note));
      slot.main.append(code, copy, note);
      slot.note.textContent = 'Save this code to use your tag on another device';
      return;
    }
    slot.eyebrow.textContent = 'Leaderboard';
    if (p === 'practice') {
      slot.main.appendChild(line(['Practice run · not saved', '', ''], 'quiet'));
      slot.note.textContent = '';
      return;
    }
    slot.main.appendChild(line(statusLine(p), p === 'failed' || p === 'rejected' ? 'quiet' : 'st'));
    if (p === 'stale') {
      slot.main.appendChild(btn('', 'Recover', () => openBoard({ recover: true })));
      slot.note.textContent = 'Use your recovery code to bring it here.';
    } else slot.note.textContent = p === 'saved' && S.best ? 'New personal best' : '';
  }

  function mountSlot(target) {
    if (slot.root.parentNode !== target) {
      if (endScreen.mount) endScreen.mount(slot.root); else target.appendChild(slot.root);
    }
    renderSlot();
  }

  if (G.events && G.events.on) {
    G.events.on('game:state', ({ state }) => {
      if (state === 'dead') {
        let run = null;
        try { run = G.game && typeof G.game.runSummary === 'function' ? G.game.runSummary() : null; } catch { run = null; }
        onDeath(run);
      } else if (state === 'playing') {
        S.recovery = ''; // shown once: gone with the screen
        if (form) form.input.value = '';
      }
    });
  }
  if (endScreen && endScreen.onShow) {
    endScreen.onShow(({ run, slot: target }) => {
      // the staged end screen (ui=dead) has no death event: its sample run stands in for one
      if (!S.run && run) onDeath(run, true);
      if (target) mountSlot(target);
      boardRowEnd.hidden = false;
    });
  }

  // ---------------------------------------------------------------- the Leaderboard screen
  const B = { device: 'all', backTo: 'title', loadId: 0, recover: false, me: null };
  const el = {};

  function build(col) {
    col.classList.add('gs-lk-boardcol');
    const head = h('header', 'gs-head');
    head.append(h('p', 'gs-eyebrow', 'Leaderboard'), h('h2', 'gs-h', 'Top 100'));

    // device filter: a radio group like the settings rows
    const seg = h('div', 'gs-seg gs-lk-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Device');
    el.opts = [['all', 'All'], ['desktop', 'Desktop'], ['phone', 'Phone']].map(([v, label]) => {
      const o = h('button', 'opt', label);
      o.type = 'button';
      o.setAttribute('role', 'radio');
      o.dataset.v = v;
      o.addEventListener('click', () => setDevice(v));
      seg.appendChild(o);
      return o;
    });
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const i = el.opts.findIndex((o) => o.dataset.v === B.device) + (e.key === 'ArrowRight' ? 1 : -1);
      const o = el.opts[(i + el.opts.length) % el.opts.length];
      setDevice(o.dataset.v);
      o.focus();
    });

    el.me = h('p', 'gs-lk-me');
    el.recoverBtn = btn('link', 'Use a tag from another device', () => showRecover(true));
    el.share = createShareBar(G, { where: 'board' });
    const back = menuRow('Back', '', () => menus.show(B.backTo || 'title'), true);
    const nav = h('nav', 'gs-list gs-back');
    nav.appendChild(back);
    const side = h('div', 'gs-lk-side');
    side.append(head, seg, el.me, el.recoverBtn, el.share.el, nav);

    // the table: header, scrolling list, the player's own row pinned under it, state line
    const table = h('div', 'gs-lk-table');
    el.table = table;
    const thead = h('div', 'gs-lk-row gs-lk-thead');
    thead.setAttribute('aria-hidden', 'true');
    thead.append(h('span', 'rk', '#'), h('span', 'tg', 'Tag'), h('span', 'rd', 'Round'), h('span', 'kl', 'Kills'));
    el.list = h('ol', 'gs-lk-list');
    el.list.tabIndex = 0;
    el.list.dataset.autofocus = '1';
    el.list.setAttribute('aria-label', 'Top 100 by best round');
    el.pinned = h('div', 'gs-lk-pinned');
    el.state = h('div', 'gs-lk-state');
    el.state.setAttribute('aria-live', 'polite');
    el.stateText = h('span', 'tx');
    el.retry = btn('', 'Try again', () => load(true));
    el.state.append(el.stateText, el.retry);
    table.append(thead, el.list, el.pinned, el.state);

    // the recovery form, in place of the table while open
    el.rec = h('form', 'gs-lk-recover');
    el.rec.noValidate = true;
    el.rec.hidden = true;
    el.rec.setAttribute('aria-label', 'Use a tag from another device');
    el.recTag = textInput('', 'Gamertag', { maxLength: TAG_MAX + 8, caps: 'words' });
    el.recTag.placeholder = 'Gamertag';
    el.recCode = textInput('code', 'Recovery code', { maxLength: 40, caps: 'characters' });
    el.recCode.placeholder = 'XXXX-XXXX-XXXX-XXXX';
    el.recNote = h('p', 'gs-lk-note');
    el.recNote.setAttribute('aria-live', 'polite');
    el.recUse = btn('primary', 'Use tag');
    el.recUse.type = 'submit';
    const recCancel = btn('', 'Cancel', () => showRecover(false));
    const recBtns = h('div', 'gs-lk-btns');
    recBtns.append(el.recUse, recCancel);
    el.rec.append(h('p', 'gs-lk-eyebrow', 'Use a tag from another device'), el.recTag, el.recCode, recBtns, el.recNote);
    el.rec.addEventListener('submit', (e) => { e.preventDefault(); recover(); });
    liftWhileTyping(el.rec, [el.recTag, el.recCode], [el.recUse, recCancel]);

    const main = h('div', 'gs-lk-mainpane');
    main.append(table, el.rec);
    col.append(side, main);

    col.parentNode.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (B.recover) showRecover(false); else menus.show(B.backTo || 'title');
    });
    return { show: () => { syncSide(); load(false); } };
  }

  function setDevice(v) {
    if (B.device === v) return;
    B.device = v;
    load(false);
  }

  function syncSide() {
    for (const o of el.opts) { const on = o.dataset.v === B.device; o.setAttribute('aria-checked', on ? 'true' : 'false'); o.tabIndex = on ? 0 : -1; }
    const tag = identity.tag();
    el.me.textContent = '';
    if (tag) { el.me.append(document.createTextNode('Playing as '), h('b', 'tag', tag)); el.recoverBtn.textContent = 'Use a different tag'; }
    else { el.me.textContent = 'No tag yet. Pick one at the end of a run.'; el.recoverBtn.textContent = 'Use a tag from another device'; }
    const best = B.me && B.me.best;
    el.share.update(S.run || (best ? { round: best.round, kills: best.kills } : null));
  }

  const rowEl = (e, me) => {
    const li = h('li', `gs-lk-row${me ? ' me' : ''}`);
    li.append(h('span', 'rk', RANK(e.rank)), h('span', 'tg', String(e.tag)), h('span', 'rd', String(e.round)), h('span', 'kl', String(e.kills)));
    if (e.device === 'phone') li.querySelector('.tg').appendChild(h('i', 'dev', 'phone'));
    return li;
  };

  function setState(kind, text) {
    el.state.dataset.kind = kind;
    el.stateText.textContent = text;
    el.retry.hidden = kind !== 'error';
  }

  async function load(force) {
    syncSide();
    const id = ++B.loadId;
    if (force) board.invalidate();
    setState('loading', 'Loading…');
    el.list.setAttribute('aria-busy', 'true');
    const tag = identity.tag();
    const [top, me] = await Promise.all([board.top(B.device), tag ? board.me(tag) : Promise.resolve(null)]);
    if (id !== B.loadId) return;
    el.list.removeAttribute('aria-busy');
    B.me = me && me.ok ? me.data : null;
    syncSide();
    el.list.textContent = '';
    el.pinned.textContent = '';
    el.pinned.hidden = true;
    if (!top || !top.ok) { setState('error', 'Couldn’t load the leaderboard.'); return; }
    const entries = Array.isArray(top.data && top.data.entries) ? top.data.entries : [];
    const key = tag ? tag.toLowerCase() : null;
    let mine = null;
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      const isMe = !!key && String(e.tag).toLowerCase() === key;
      const li = rowEl(e, isMe);
      if (isMe) mine = li;
      frag.appendChild(li);
    }
    el.list.appendChild(frag);
    if (!entries.length) setState('empty', B.device === 'all' ? 'No runs yet. Be the first.' : `No ${B.device} runs yet.`);
    else setState('ok', '');
    // the player's own row: highlighted in the list, or pinned under it when outside the top 100
    if (!mine && B.me && B.me.best && B.me.rank && B.device === 'all') {
      el.pinned.hidden = false;
      el.pinned.appendChild(rowEl({ rank: B.me.rank, tag: B.me.tag, ...B.me.best }, true));
    }
    if (mine) mine.scrollIntoView({ block: 'nearest' });
  }

  function showRecover(on) {
    B.recover = on;
    el.rec.hidden = !on;
    el.table.hidden = on;
    el.recNote.textContent = '';
    el.recNote.classList.remove('err');
    el.recUse.disabled = false;
    if (on) { el.recTag.value = identity.tag() && S.phase === 'stale' ? identity.tag() : ''; el.recCode.value = ''; el.recTag.focus({ preventScroll: true }); }
    else el.recoverBtn.focus({ preventScroll: true });
  }

  function recover() {
    const t = checkTag(el.recTag.value);
    const err = (msg) => { el.recNote.textContent = msg; el.recNote.classList.add('err'); };
    if (!t.ok) { err(errorText({ error: 'invalid_tag', reason: t.reason })); return; }
    const code = el.recCode.value.trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) { err('Enter the recovery code you saved.'); return; }
    el.recUse.disabled = true;
    el.recNote.classList.remove('err');
    el.recNote.textContent = 'Checking…';
    board.api.recover(t.tag, code).then((r) => {
      el.recUse.disabled = false;
      if (!r.ok || !r.data || !r.data.secret) { err(errorText(r)); return; }
      identity.set({ tag: r.data.tag || t.tag, secret: r.data.secret });
      el.recCode.value = '';
      const wasStale = S.phase === 'stale';
      showRecover(false);
      load(true);
      if (wasStale) save('saving'); // the run that bounced is saved under the new secret
    });
  }

  function openBoard({ recover: rec = false } = {}) {
    const from = menus.current;
    if (from && from !== 'board') B.backTo = from;
    track('board_open');
    menus.show('board');
    if (rec) showRecover(true);
  }

  menus.setScreen('board', build);
  menus.addMenuRow('title', { label: 'Leaderboard', hint: 'Top 100', onClick: () => openBoard(), at: 1 });
  menus.addMenuRow('paused', { label: 'Leaderboard', hint: 'Top 100', onClick: () => openBoard() });
  const boardRowEnd = menuRow('Leaderboard', 'Top 100', () => openBoard());
  boardRowEnd.hidden = true;
  if (endScreen && endScreen.addAction) endScreen.addAction(boardRowEnd);

  return { open: openBoard, state: S, get phase() { return S.phase; } };
}
