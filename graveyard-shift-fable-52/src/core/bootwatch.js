// Boot watch: keeps an eye on the start-up and says what is happening on the loading screen.
//   - the progress line under the bar while shaders are prepared ("Preparing graphics 23 / 67"), and
//     after NOTE_MS of that a calm note that a first load can take a while on some PCs;
//   - a heartbeat (a BEAT_MS interval) whose longest gap between main-thread turns, during the boot
//     and in the AFTER_READY_MS after window.__ready, is published as window.__bootStalls;
//   - seconds per boot stage, the graphics device, programs ready, context loss and captured errors,
//     as a short plain-text block (details()) that a "Copy details" button puts on the clipboard.
//     Nothing is sent anywhere;
//   - when the start goes wrong it puts up a panel with that button: not ready after SLOW_MS (a small
//     box; loading carries on), a boot stage that threw (a small box that stays until dismissed), a
//     fatal error or a context lost and not given back (a full-screen message with Reload, styled
//     like the renderer's own; if the renderer's message is already up, the button joins it).
import './bootwatch.css';
import { isSoftwareRenderer, SOFTWARE_TEXT, SOFTWARE_HOWTO } from '../render/software.js';

export const SLOW_MS = 45000;
export const LOG_EVERY_MS = 30000; // after SLOW_MS, the details go to console.info this often until ready
export const NOTE_MS = 10000;
export const AFTER_READY_MS = 5000;
export const BEAT_MS = 25;
export const LOST_WAIT_MS = 3300; // a little after the renderer's own wait (renderer.js RESTORE_WAIT_MS)
export const NOTE_TEXT = 'First load can take a minute or two on some PCs while graphics are prepared. It is much faster next time.';
const ERRORS_SHOWN = 6;
const ERROR_CHARS = 600;
const SHADER_ERROR_CHARS = 1500;

export function warmLabel(s) {
  if (!s || !s.total) return 'Preparing graphics';
  return `Preparing graphics ${Math.min(s.ready, s.total)} / ${s.total}`;
}

// Longest gap between heartbeats, split at window.__ready: a gap belongs to the side it began on.
export function createStallMeter(t0, afterMs = AFTER_READY_MS) {
  const m = { last: t0, lastStage: '', readyAt: 0, boot: { ms: 0, stage: '', at: 0 }, after: { ms: 0, at: 0 }, beats: 0, done: false, worst: {} };
  return {
    // `stage` is the boot stage now; the gap is put down to the one running when it began
    beat(t, ready, stage) {
      const gap = t - m.last;
      const wasBoot = !m.readyAt;
      const began = m.lastStage || stage;
      m.last = t;
      m.lastStage = stage;
      m.beats++;
      if (wasBoot) {
        if (began && gap > (m.worst[began] || 0)) m.worst[began] = gap;
        if (gap > m.boot.ms) m.boot = { ms: gap, stage: began, at: t - t0 };
        if (ready) m.readyAt = t;
        return;
      }
      if (gap > m.after.ms && t - gap - m.readyAt < afterMs) m.after = { ms: gap, at: t - t0 };
      if (t - m.readyAt >= afterMs) m.done = true;
    },
    get done() { return m.done; },
    report() {
      const r = (x) => Math.round(x);
      return {
        bootMs: r(m.boot.ms), bootStage: m.boot.stage, bootAtS: Math.round(m.boot.at / 100) / 10,
        afterReadyMs: r(m.after.ms), readyAtS: m.readyAt ? Math.round((m.readyAt - t0) / 100) / 10 : null, beats: m.beats,
        worstByStage: Object.fromEntries(Object.entries(m.worst).map(([k, v]) => [k, r(v)])),
      };
    },
  };
}

const yesNo = (v) => (v === null || v === undefined ? 'unknown' : v ? 'yes' : 'no');
const secs = (ms) => (ms / 1000).toFixed(1);

// The text "Copy details" copies. `s`: { when, ua, gpu, parallel, colorFloat, stage, running, elapsedMs,
// stages: [[name, ms]], programs: {ready, total, mode} | null, lost, restored, stall: {ms, stage} | null,
// errors: [string], failed: [stage] }.
export function buildDetails(s) {
  const lines = ['Graveyard Shift: loading details'];
  lines.push(`When: ${s.when || '?'}, ${secs(s.elapsedMs || 0)} s after the page opened`);
  lines.push(`Browser: ${s.ua || 'unknown'}`);
  lines.push(`Graphics: ${s.gpu || 'unknown'}`);
  lines.push(`Software renderer: ${s.gpu ? (isSoftwareRenderer(s.gpu) ? 'yes' : 'no') : 'unknown'}`);
  lines.push(`KHR_parallel_shader_compile: ${yesNo(s.parallel)}   EXT_color_buffer_float: ${yesNo(s.colorFloat)}`);
  lines.push(`Stage: ${s.stage || 'none'}${s.running ? ' (still running)' : ''}`);
  if (s.stages && s.stages.length) lines.push(`Seconds per stage: ${s.stages.map(([n, ms]) => `${n} ${secs(ms)}`).join(', ')}`);
  if (s.failed && s.failed.length) lines.push(`Stages that failed: ${s.failed.join(', ')}`);
  if (s.programs && s.programs.total) {
    const unit = s.programs.mode === 'sliced' ? 'draws' : 'programs';
    lines.push(`Shaders ready: ${Math.min(s.programs.ready, s.programs.total)} / ${s.programs.total} ${unit} (${s.programs.mode || '?'})${s.programs.timedOut ? ', gave up waiting' : ''}`);
  } else lines.push('Shaders ready: not started');
  lines.push(`Context lost: ${s.lost ? 'yes' : 'no'}${s.restored ? ` (given back ${s.restored} time${s.restored === 1 ? '' : 's'})` : ''}`);
  if (s.stall && s.stall.ms) lines.push(`Longest pause: ${secs(s.stall.ms)} s${s.stall.stage ? ` (${s.stall.stage})` : ''}`);
  const errs = s.errors || [];
  if (!errs.length) lines.push('Errors: none');
  else {
    lines.push(`Errors (${errs.length}${errs.length > ERRORS_SHOWN ? `, first ${ERRORS_SHOWN}` : ''}):`);
    for (const e of errs.slice(0, ERRORS_SHOWN)) {
      const one = String(e).replace(/\s*\n\s*/g, ' | ');
      lines.push(`- ${one.slice(0, one.startsWith('[shader]') || one.includes('[shader]') ? SHADER_ERROR_CHARS : ERROR_CHARS)}`);
    }
  }
  return lines.join('\n');
}

// The graphics device as WebGL reports it. `gl` may be null: then a throwaway context is asked.
export function readGl(gl, doc) {
  const out = { gpu: null, parallel: null, colorFloat: null };
  let g = gl;
  try {
    if (!g && doc) { const c = doc.createElement('canvas'); g = c.getContext('webgl2') || c.getContext('webgl'); }
    if (!g || (g.isContextLost && g.isContextLost())) return out;
    const dbg = g.getExtension('WEBGL_debug_renderer_info');
    out.gpu = String((dbg && g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || g.getParameter(g.RENDERER) || '') || null;
    out.parallel = !!g.getExtension('KHR_parallel_shader_compile');
    out.colorFloat = !!g.getExtension('EXT_color_buffer_float');
  } catch { /* leave what is unknown as unknown */ }
  return out;
}

export function createBootWatch({ win = window, doc = document, now = () => performance.now(), wallClock = () => new Date() } = {}) {
  const t0 = now();
  const S = {
    stage: '', stageAt: t0, stages: [], failed: [], ready: false, lost: false, restored: 0,
    gl: null, programs: null, warmAt: 0, fatal: null,
  };
  const timers = [];
  const later = (fn, ms) => { const id = win.setTimeout(fn, ms); timers.push(id); return id; };
  const meter = createStallMeter(t0);
  const publish = () => {
    const rep = meter.report();
    rep.stages = S.stages.map(([n, ms]) => [n, Math.round(ms)]);
    win.__bootStalls = rep;
  };
  publish();
  const beat = win.setInterval(() => {
    meter.beat(now(), S.ready, S.stage);
    publish();
    if (meter.done) win.clearInterval(beat);
  }, BEAT_MS);

  function closeStage(t) {
    if (S.stage) S.stages.push([S.stage, t - S.stageAt]);
  }

  // ---- what details() reads ----
  function snapshot() {
    const t = now();
    const stages = S.stages.slice();
    if (S.stage && !S.ready) stages.push([S.stage, t - S.stageAt]);
    const gl = S.gl || readGl(null, doc);
    const report = meter.report();
    let when = '';
    try { when = wallClock().toISOString(); } catch { when = ''; }
    return {
      when, ua: (win.navigator && win.navigator.userAgent) || '', gpu: gl.gpu, parallel: gl.parallel, colorFloat: gl.colorFloat,
      stage: S.ready ? 'ready' : S.stage, running: !S.ready && !S.fatal, elapsedMs: t - t0, stages,
      programs: S.programs, lost: S.lost, restored: S.restored, failed: S.failed,
      stall: { ms: report.bootMs, stage: report.bootStage },
      errors: (win.__errors || []).slice(),
    };
  }
  const details = () => buildDetails(snapshot());

  // ---- DOM ----
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  function copyText(text, button) {
    const done = (ok) => {
      if (!button) return;
      button.textContent = ok ? 'Copied' : 'Select the text below and copy it';
      win.setTimeout(() => { button.textContent = 'Copy details'; }, 2500);
    };
    const fallback = () => {
      try {
        const ta = el('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand && doc.execCommand('copy');
        ta.remove();
        done(!!ok);
        return !!ok;
      } catch { done(false); return false; }
    };
    try {
      const c = win.navigator && win.navigator.clipboard;
      if (c && typeof c.writeText === 'function') { c.writeText(text).then(() => done(true), fallback); return; }
    } catch { /* fall through */ }
    fallback();
  }
  // Copy details + a box holding the same text (to copy by hand where the clipboard is not allowed).
  function detailsBlock(withReload) {
    const row = el('div', 'gs-bw-actions');
    const pre = el('pre', 'gs-bw-details');
    pre.hidden = true;
    if (withReload) {
      const r = el('button', 'gs-bw-btn gs-bw-primary', 'Reload');
      r.type = 'button';
      r.addEventListener('click', () => win.location.reload());
      row.append(r);
    }
    const copy = el('button', 'gs-bw-btn', 'Copy details');
    copy.type = 'button';
    copy.addEventListener('click', () => { const text = details(); pre.textContent = text; pre.hidden = false; copyText(text, copy); });
    const show = el('button', 'gs-bw-btn gs-bw-quiet', 'Show details');
    show.type = 'button';
    show.addEventListener('click', () => { pre.textContent = details(); pre.hidden = !pre.hidden; show.textContent = pre.hidden ? 'Show details' : 'Hide details'; });
    row.append(copy, show);
    return [row, pre];
  }
  // adds the buttons to a message another part of the game put up (renderer.js, main.js)
  function decorate(node) {
    if (!node || node.querySelector('.gs-bw-actions')) return;
    const [row, pre] = detailsBlock(false);
    node.append(row, pre);
  }

  // the line under the boot bar, and the note under it
  let statusEl = null; let noteEl = null; let footEl = null;
  function footEls() {
    if (statusEl) return true;
    const foot = doc.querySelector('#boot .ld-foot');
    if (!foot) return false;
    footEl = foot;
    statusEl = el('div', 'gs-bw-status');
    statusEl.id = 'boot-status';
    statusEl.setAttribute('aria-hidden', 'true'); // #boot-label carries the same text for screen readers
    noteEl = el('p', 'gs-bw-note', NOTE_TEXT);
    noteEl.id = 'boot-note';
    noteEl.hidden = true;
    foot.append(statusEl, noteEl);
    return true;
  }

  // A software renderer: said plainly on the loading screen, under the bar. Loading carries on.
  function showSoftware() {
    if (!footEls() || doc.getElementById('boot-soft')) return;
    const box = el('div', 'gs-bw-soft');
    box.id = 'boot-soft';
    box.setAttribute('role', 'note');
    box.append(el('p', 'gs-bw-soft-main', SOFTWARE_TEXT));
    for (const line of SOFTWARE_HOWTO) box.append(el('p', 'gs-bw-soft-how', line));
    footEl.append(box);
  }
  // the details on the console too, for a harness whose page calls hang
  const logDetails = (why) => { try { console.info(`[boot details] ${why}\n${details()}`); } catch { /* no console */ } };

  // small box at the top right: { title, text, live?, dismiss? }
  let box = null; let boxLive = null; let boxKind = '';
  function showBox(kind, title, text, { dismiss = false, live = null } = {}) {
    if (box && boxKind === 'stage' && kind === 'slow') return; // a failure already says more
    if (box) box.remove();
    boxKind = kind;
    box = el('div', 'gs-bw-box');
    box.id = 'boot-watch';
    box.setAttribute('role', kind === 'stage' ? 'alert' : 'status');
    const h = el('div', 'gs-bw-title', title);
    const p = el('div', 'gs-bw-text', text);
    boxLive = live ? p : null;
    const [row, pre] = detailsBlock(false);
    if (dismiss) {
      const x = el('button', 'gs-bw-btn gs-bw-quiet', 'Dismiss');
      x.type = 'button';
      x.addEventListener('click', () => { if (box) box.remove(); box = null; });
      row.append(x);
    }
    box.append(h, p, row, pre);
    doc.body.appendChild(box);
    if (live) p.textContent = live();
  }
  const slowText = () => {
    const sec = Math.round((now() - t0) / 1000);
    const what = S.stage === 'shaders' || S.stage === 'shaders (tier)' ? warmLabel(S.programs) : `Loading: ${S.stage || 'starting'}`;
    return `${what}. ${sec} s so far. The game keeps loading; if it stays stuck, copy the details below for a bug report.`;
  };
  const liveTick = win.setInterval(() => { if (boxLive && box && boxKind === 'slow') boxLive.textContent = slowText(); if (S.ready) win.clearInterval(liveTick); }, 1000);

  // full-screen message (the gfx-failed look), with Reload and Copy details
  function showFailure(title, text) {
    for (const id of ['gfx-lost', 'gfx-failed', 'gfx-unsupported']) {
      const other = doc.getElementById(id);
      if (other) { decorate(other); return; }
    }
    if (doc.getElementById('boot-failed')) return;
    const o = el('div', 'gs-bw-fail');
    o.id = 'boot-failed';
    o.setAttribute('role', 'alert');
    const h = el('div', 'gs-bw-fail-title', title);
    const p = el('div', 'gs-bw-fail-text', text);
    const [row, pre] = detailsBlock(true);
    o.append(h, p, row, pre);
    doc.body.appendChild(o);
  }

  later(() => {
    if (S.ready || S.fatal) return;
    showBox('slow', 'Still loading', slowText(), { live: slowText });
    logDetails('still loading');
    const again = () => { if (S.ready || S.fatal) return; logDetails('still loading'); later(again, LOG_EVERY_MS); };
    later(again, LOG_EVERY_MS);
  }, SLOW_MS);

  let restoreWaiters = [];
  let ctx = null; // the renderer's context, once attached
  const api = {
    get state() { return S; },
    stage(name, t = now()) {
      meter.beat(t, S.ready, name); // the pause so far belongs to the stage that is ending
      closeStage(t);
      S.stage = name; S.stageAt = t;
    },
    // a boot stage threw; the boot carries on with its stand-in
    fail(name, err) {
      S.failed.push(name);
      const msg = err && err.message ? err.message : String(err);
      showBox('stage', 'Part of the game failed to start', `${name}: ${msg}. The game may not work properly. Reloading usually fixes it.`, { dismiss: true });
    },
    // the renderer is up: read the device once and watch its canvas for a lost context
    attach(renderer) {
      let gl = null;
      try { gl = renderer.getContext(); } catch { gl = null; }
      ctx = gl;
      S.gl = readGl(gl, doc);
      if (isSoftwareRenderer(S.gl.gpu)) showSoftware();
      const canvas = renderer.domElement;
      if (!canvas || !canvas.addEventListener) return;
      canvas.addEventListener('webglcontextlost', () => {
        S.lost = true;
        if (S.ready) return;
        later(() => {
          if (!S.lost || S.ready) return;
          showFailure('Graphics context lost', 'The browser took the graphics device away while the game was loading. Reload to try again.');
        }, LOST_WAIT_MS);
      });
      canvas.addEventListener('webglcontextrestored', () => {
        S.lost = false; S.restored++;
        const w = restoreWaiters; restoreWaiters = [];
        for (const fn of w) fn(true);
      });
    },
    // resolves when a lost context comes back (never, if it does not: the message is up by then)
    // (the context can report itself lost before its event has been dispatched: both are checked)
    waitForRestore() {
      let gone = S.lost;
      try { gone = gone || !!(ctx && ctx.isContextLost && ctx.isContextLost()); } catch { /* keep S.lost */ }
      return gone ? new Promise((r) => restoreWaiters.push(r)) : Promise.resolve(true);
    },
    // warm-up progress: { ready, total, mode, timedOut }
    progress(w) {
      S.programs = { ready: w.ready, total: w.total, mode: w.mode, timedOut: !!w.timedOut };
      if (!S.warmAt) {
        S.warmAt = now();
        later(() => { if (!S.ready && footEls() && noteEl) noteEl.hidden = false; }, NOTE_MS);
      }
      if (footEls()) statusEl.textContent = warmLabel(S.programs);
    },
    warmDone() {
      if (statusEl) statusEl.textContent = '';
    },
    // any other line under the bar ('' clears it)
    status(text) {
      if (footEls()) statusEl.textContent = text || '';
    },
    decorate,
    ready() {
      closeStage(now());
      S.ready = true;
      S.stage = 'ready';
      for (const id of timers) win.clearTimeout(id);
      if (box && boxKind === 'slow') { box.remove(); box = null; }
      if (noteEl) noteEl.hidden = true;
      logDetails('ready');
    },
    fatal(err) {
      S.fatal = err || true;
      showFailure('The game could not finish loading', 'Something went wrong while the game was starting. Reloading usually fixes it; if not, copy the details for a bug report.');
    },
    details,
  };
  return api;
}
