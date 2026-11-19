// "Report a problem": a menu screen (menus.setScreen('report')) with kind, message, optional contact,
// a line naming what is attached, Send and Cancel. Entry points: a row in the pause menu, a small link beside the
// credit links on the title and end screens. They appear only when the report client says reporting is on
// (production origins + /api/report/status, or ?report=mock); otherwise nothing here is visible or requested.
//
// The game stays where it was (title, paused, dead) while the screen is open. Key events never leave the screen
// (no game binds while typing); the screen takes pointer events so neither the mouse nor the touch look/stick
// sees a press on the form. Text is set with textContent only. The draft survives closing the screen for the
// session and is cleared after a successful send. No per-frame work.
import './report.css';
import {
  checkReport, gatherContext, payloadBytes, reportErrorText, fieldErrorText, messageLength,
  MESSAGE_MAX, MESSAGE_MIN, CONTACT_MAX, BODY_MAX, SENT_TEXT,
} from '../net/report.js';
import { track } from '../core/analytics.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (cls, text, onClick) => { const b = h('button', `gs-lk-btn${cls ? ` ${cls}` : ''}`, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };

export const ATTACHED_TEXT = 'Sent with it: game version, device type, graphics tier, round, area, weapon, frame rate, screen size and browser. Nothing else.';
export const CONTACT_LABEL = 'How can we reach you? (optional — it will be visible in the report)';
const KIND_OPTS = [['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']];

export function createReport(G, { menus, client, links = [] }) {
  const S = { kind: 'bug', phase: 'form', where: 'title', backTo: 'title', sending: 0 };
  const el = {};
  const touch = () => !!(G.ui && G.ui.touch) || !!(G.input && G.input.mode === 'touch');

  function build(col) {
    col.classList.add('gs-rp-col');
    const head = h('header', 'gs-head');
    head.append(h('p', 'gs-eyebrow', 'Front desk'), h('h2', 'gs-h', 'Report a problem'));

    const form = h('form', 'gs-rp-form');
    form.noValidate = true;
    form.setAttribute('aria-label', 'Report a problem');
    el.form = form;

    // kind: a radio group like the settings rows
    const kindRow = h('div', 'gs-rp-field gs-rp-kind');
    const kindLabel = h('span', 'gs-rp-label', 'What is it?');
    kindLabel.id = 'gs-rp-kind-l';
    const seg = h('div', 'gs-seg gs-rp-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', 'gs-rp-kind-l');
    el.kinds = KIND_OPTS.map(([v, label]) => {
      const o = h('button', 'opt', label);
      o.type = 'button';
      o.setAttribute('role', 'radio');
      o.dataset.v = v;
      o.addEventListener('click', () => { S.kind = v; syncKind(); });
      seg.appendChild(o);
      return o;
    });
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = KIND_OPTS.findIndex(([v]) => v === S.kind) + (e.key === 'ArrowRight' ? 1 : -1);
      S.kind = KIND_OPTS[(i + KIND_OPTS.length) % KIND_OPTS.length][0];
      syncKind();
      el.kinds.find((o) => o.dataset.v === S.kind).focus();
    });
    kindRow.append(kindLabel, seg);

    // message
    const msgRow = h('div', 'gs-rp-field gs-rp-msgrow');
    const msgLabel = h('label', 'gs-rp-label', 'What happened?');
    msgLabel.htmlFor = 'gs-rp-msg';
    el.msg = h('textarea', 'gs-rp-text');
    el.msg.id = 'gs-rp-msg';
    el.msg.rows = 5;
    el.msg.maxLength = MESSAGE_MAX + 200; // the count, not the browser, explains the limit
    el.msg.placeholder = 'What you were doing, what you expected, what you saw.';
    el.msg.setAttribute('autocomplete', 'off');
    el.msg.setAttribute('enterkeyhint', 'enter');
    el.count = h('span', 'gs-rp-count');
    el.count.setAttribute('aria-live', 'off');
    el.msgErr = h('p', 'gs-rp-err');
    el.msgErr.id = 'gs-rp-msg-err';
    el.msgErr.setAttribute('aria-live', 'polite');
    el.msg.setAttribute('aria-describedby', 'gs-rp-msg-err');
    const msgFoot = h('div', 'gs-rp-foot');
    msgFoot.append(el.msgErr, el.count);
    msgRow.append(msgLabel, el.msg, msgFoot);

    // contact
    const cRow = h('div', 'gs-rp-field gs-rp-crow');
    const cLabel = h('label', 'gs-rp-label', CONTACT_LABEL);
    cLabel.htmlFor = 'gs-rp-contact';
    el.contact = h('input', 'gs-lk-input gs-rp-contact');
    el.contact.id = 'gs-rp-contact';
    el.contact.type = 'text';
    el.contact.maxLength = CONTACT_MAX + 20;
    el.contact.autocomplete = 'off';
    el.contact.spellcheck = false;
    el.contact.setAttribute('autocapitalize', 'off');
    el.contact.setAttribute('autocorrect', 'off');
    el.contact.setAttribute('enterkeyhint', 'send');
    el.contact.placeholder = 'Email, Discord, X…';
    el.cErr = h('p', 'gs-rp-err');
    el.cErr.setAttribute('aria-live', 'polite');
    cRow.append(cLabel, el.contact, el.cErr);

    // honeypot: invisible to people (off-screen, not focusable, hidden from assistive tech); bots fill it
    el.hp = h('input', 'gs-rp-hp');
    el.hp.type = 'text';
    el.hp.name = 'website';
    el.hp.tabIndex = -1;
    el.hp.autocomplete = 'off';
    el.hp.setAttribute('aria-hidden', 'true');

    const attached = h('p', 'gs-rp-note', ATTACHED_TEXT);
    el.send = btn('primary', 'Send');
    el.send.type = 'submit';
    const cancel = btn('', 'Cancel', () => close());
    const btns = h('div', 'gs-rp-btns');
    el.status = h('p', 'gs-rp-status');
    el.status.setAttribute('role', 'status');
    btns.append(el.send, cancel, el.status);
    form.append(kindRow, msgRow, cRow, el.hp, attached, btns);

    // sent: a short confirmation in place of the form
    el.done = h('div', 'gs-rp-done');
    el.done.hidden = true;
    el.doneText = h('p', 'gs-rp-sent', SENT_TEXT);
    el.doneText.setAttribute('role', 'status');
    el.doneBtn = btn('primary', 'Done', () => close());
    el.done.append(el.doneText, el.doneBtn);

    col.append(head, form, el.done);

    el.msg.addEventListener('input', () => { el.msgErr.textContent = ''; syncCount(); clearStatus(); });
    el.contact.addEventListener('input', () => { el.cErr.textContent = ''; clearStatus(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

    // No key event leaves the screen: game binds never fire while the form is open, and Escape closes it.
    const screenEl = col.parentNode;
    const keep = (e) => { e.stopPropagation(); };
    screenEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    screenEl.addEventListener('keyup', keep);
    screenEl.addEventListener('keypress', keep);
    // On a phone the keyboard covers the lower half: keep the field being typed in on screen.
    for (const f of [el.msg, el.contact]) {
      f.addEventListener('focus', () => {
        if (!touch()) return;
        setTimeout(() => { try { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browser */ } }, 300);
      });
    }
    return { show: () => sync() };
  }

  function syncKind() {
    for (const o of el.kinds) {
      const on = o.dataset.v === S.kind;
      o.setAttribute('aria-checked', on ? 'true' : 'false');
      o.tabIndex = on ? 0 : -1;
    }
  }
  function syncCount() {
    const n = messageLength(el.msg.value);
    el.count.textContent = `${n} / ${MESSAGE_MAX}`;
    el.count.classList.toggle('over', n > MESSAGE_MAX);
    el.count.classList.toggle('short', n > 0 && n < MESSAGE_MIN);
  }
  function clearStatus() { if (S.phase === 'error') { S.phase = 'form'; el.status.textContent = ''; el.status.classList.remove('err'); } }
  function setStatus(text, err = false) { el.status.textContent = text; el.status.classList.toggle('err', err); }

  function sync() {
    syncKind();
    syncCount();
    const sent = S.phase === 'sent';
    el.form.hidden = sent;
    el.done.hidden = !sent;
    const sending = S.phase === 'sending';
    el.send.disabled = sending;
    el.send.textContent = sending ? 'Sending' : 'Send';
    el.msg.readOnly = sending;
    el.contact.readOnly = sending;
    if (sent) el.doneBtn.dataset.autofocus = '1';
    else delete el.doneBtn.dataset.autofocus;
    // a phone keyboard must not pop up on open: autofocus the message on desktop only
    if (!sent && !touch()) el.msg.dataset.autofocus = '1';
    else delete el.msg.dataset.autofocus;
  }

  function submit() {
    if (S.phase === 'sending') return;
    el.msgErr.textContent = ''; el.cErr.textContent = '';
    const c = checkReport({ kind: S.kind, message: el.msg.value, contact: el.contact.value });
    if (!c.ok) {
      const target = c.field === 'contact' ? el.cErr : el.msgErr;
      target.textContent = fieldErrorText(c.reason);
      (c.field === 'contact' ? el.contact : el.msg).focus({ preventScroll: false });
      return;
    }
    const payload = { kind: c.kind, message: c.message, contact: c.contact, context: gatherContext(G, S.where), hp: el.hp.value };
    if (payloadBytes(payload) > BODY_MAX) { el.msgErr.textContent = fieldErrorText('message_bytes'); el.msg.focus(); return; }
    const id = ++S.sending;
    S.phase = 'sending';
    setStatus('Sending…');
    sync();
    client.send(payload).then((r) => {
      if (id !== S.sending) return;
      if (r && r.ok) {
        track('report_sent', { kind: c.kind, where: S.where });
        el.msg.value = ''; el.contact.value = ''; el.hp.value = '';
        S.kind = 'bug';
        S.phase = 'sent';
        setStatus('');
        sync();
        el.doneBtn.focus({ preventScroll: true });
        return;
      }
      S.phase = 'error';
      if (r && r.error === 'invalid_report') {
        S.phase = 'form';
        setStatus('');
        const contactErr = /^contact/.test(r.reason || '');
        (contactErr ? el.cErr : el.msgErr).textContent = fieldErrorText(r.reason);
      } else setStatus(reportErrorText(r), true);
      sync();
      try { el.status.scrollIntoView({ block: 'nearest' }); } catch { /* old browser */ }
    });
  }

  function open(where) {
    const from = menus.current;
    if (from && from !== 'report') S.backTo = from;
    S.where = where || ({ paused: 'pause', dead: 'end' }[from] || 'title');
    if (S.phase === 'sent' || S.phase === 'error') { S.phase = 'form'; setStatus(''); }
    menus.show('report');
  }

  function close() {
    if (S.phase === 'sending') S.sending++; // a late answer is dropped; the draft stays
    if (S.phase !== 'sent') S.phase = 'form';
    setStatus('');
    menus.show(S.backTo || 'title');
  }

  menus.setScreen('report', build);

  // ---- entry points, hidden until reporting is confirmed on
  const entries = [];
  const pauseRow = menus.addMenuRow && menus.addMenuRow('paused', { label: 'Report a problem', hint: 'Bug or idea', onClick: () => open('pause') });
  if (pauseRow) { pauseRow.classList.add('gs-rp-entry'); pauseRow.hidden = true; entries.push(pauseRow); }
  for (const { host, where } of links) {
    if (!host) continue;
    const dot = h('span', 'dot gs-rp-entry', '·');
    dot.setAttribute('aria-hidden', 'true');
    const a = h('button', 'gs-lk-link gs-rp-link gs-rp-entry', 'Report a problem');
    a.type = 'button';
    a.addEventListener('click', () => open(where));
    dot.hidden = true; a.hidden = true;
    host.append(dot, a);
    entries.push(dot, a);
  }
  const ready = client.enabled().then((on) => {
    for (const e of entries) e.hidden = !on;
    return on;
  });

  return { open, close, ready, state: S, get el() { return el; } };
}
