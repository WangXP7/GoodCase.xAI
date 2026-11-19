// "Report a problem" client. Talks to the Worker's POST /api/report and GET /api/report/status
// (contract: server/README.md), cross-origin, JSON, no credentials. Never throws; every call resolves to
// { ok:true, data } or { ok:false, error, reason?, retryAfter?, scope? }.
//
//   reportMode(location)   'live' on a configured origin (the settings in net/board.js); ?report=mock (in-memory,
//                          for screenshots and offline checks) or ?report=off; everything else (artifact frame,
//                          file://, localhost, previews, unconfigured builds) is 'off': no entry points, no requests
//   createReportApi({mode})  status() send(payload)
//   createReportClient(api)  enabled(): the status, asked once and cached for the session (failures: false)
//   checkReport(fields)      the server's rules, for inline errors
//   gatherContext(G, where)  what is attached automatically; defensive, never throws
import { API_BASE, onlineOrigin } from './board.js';
import { GAME_VERSION } from '../game/score.js';

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
export const CONTACT_MAX = 100;
export const BODY_MAX = 6 * 1024; // the server's cap for this route, in bytes
export const KINDS = ['bug', 'idea', 'other'];

export function reportMode(loc) {
  try {
    if (!loc) return 'off';
    const q = new URLSearchParams(loc.search || '').get('report');
    if (q === 'off') return 'off';
    if (q === 'mock') return 'mock';
    return onlineOrigin(loc) ? 'live' : 'off';
  } catch { return 'off'; }
}

// ---------------------------------------------------------------- validation (mirrors server/src/report.js)

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;
const clean = (s) => String(s).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(CONTROL, '').trim();
export const messageLength = (s) => clean(s || '').length;

// -> { ok:true, payload-ready fields } | { ok:false, field, reason }
export function checkReport({ kind, message, contact }) {
  if (!KINDS.includes(kind)) return { ok: false, field: 'kind', reason: 'kind' };
  const m = clean(message || '');
  if (m.length < MESSAGE_MIN) return { ok: false, field: 'message', reason: 'message_short' };
  if (m.length > MESSAGE_MAX) return { ok: false, field: 'message', reason: 'message_long' };
  if ((m.match(/\p{L}/gu) || []).length < 3) return { ok: false, field: 'message', reason: 'message_letters' };
  const c = clean(contact || '').replace(/\n+/g, ' ');
  if (c.length > CONTACT_MAX) return { ok: false, field: 'contact', reason: 'contact_long' };
  return { ok: true, kind, message: m, contact: c };
}

// ---------------------------------------------------------------- context

const str = (v, re, max = 32) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : undefined);
export function deviceOf(G) {
  try {
    const d = (G && G.device) || {};
    if (d.phone) return 'phone';
    if (d.touch) return 'tablet';
    return 'desktop';
  } catch { return 'desktop'; }
}

// Only these fields, nothing else: game version, device type, graphics tier, round, area, weapon, frame rate,
// screen size, browser. Every read is guarded: a missing module never throws here.
export function gatherContext(G, where, win = typeof window !== 'undefined' ? window : null) {
  const out = { version: GAME_VERSION, device: 'desktop', where };
  const tryIt = (fn) => { try { fn(); } catch { /* a field we cannot read is left out */ } };
  let s = null;
  tryIt(() => { s = win && typeof win.__stats === 'function' ? win.__stats() : null; });
  tryIt(() => { out.device = deviceOf(G); });
  tryIt(() => { const t = (G.quality && G.quality.tier) || (s && s.tier); const v = str(t, /^[A-Za-z0-9_-]+$/, 16); if (v) out.tier = v; });
  tryIt(() => { const r = (G.game && G.game.round) ?? (s && s.round); if (Number.isInteger(r) && r >= 0) out.round = r; });
  tryIt(() => { const z = (G.level && G.level.zone) || (s && s.zone); const v = str(z, /^[A-Za-z0-9 _-]+$/); if (v) out.zone = v; });
  tryIt(() => { const w = (G.weapon && (G.weapon.id || G.weapon.name)) || (s && s.weapon); const v = str(w, /^[A-Za-z0-9 ._-]+$/); if (v) out.weapon = v; });
  tryIt(() => { const f = s && s.fps; if (typeof f === 'number' && Number.isFinite(f) && f >= 0 && f <= 1000) out.fps = Math.round(f * 10) / 10; });
  tryIt(() => {
    const w = Math.round(win.innerWidth), h = Math.round(win.innerHeight), dpr = Math.round((win.devicePixelRatio || 1) * 100) / 100;
    if (w > 0 && h > 0) out.viewport = `${w}x${h}${dpr !== 1 ? `@${dpr}x` : ''}`;
  });
  tryIt(() => { const ua = win.navigator && win.navigator.userAgent; if (typeof ua === 'string' && ua) out.ua = ua.replace(CONTROL, '').slice(0, 200); });
  return out;
}

export const payloadBytes = (p) => new TextEncoder().encode(JSON.stringify(p)).length;

// ---------------------------------------------------------------- api

const later = (ms, v) => (ms > 0 ? new Promise((r) => setTimeout(() => r(v), ms)) : Promise.resolve(v));

export function createReportApi({ mode = 'off', fetch: fetchFn, base = API_BASE, timeoutMs = 20000, mockDelay = 450 } = {}) {
  if (mode === 'mock') return createMockReportApi({ delay: mockDelay });
  if (mode !== 'live' || !base) {
    const no = async () => ({ ok: false, error: 'disabled' });
    return { mode: 'off', status: no, send: no };
  }
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  // The server may spend up to 8 s per delivery channel before answering: the timeout leaves room for that.
  async function request(method, path, body) {
    let timer = null, res;
    try {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctrl) timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const init = { method, credentials: 'omit', cache: 'no-store' };
      if (ctrl) init.signal = ctrl.signal;
      if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
      res = await doFetch(`${base}${path}`, init);
    } catch { return { ok: false, error: 'offline' }; } finally { if (timer) clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok) return data && typeof data === 'object' ? { ok: true, data } : { ok: false, error: 'server' };
    if (res.status >= 500 || !data || typeof data.error !== 'string') return { ok: false, error: 'server' };
    const out = { ok: false, error: data.error };
    if (typeof data.reason === 'string') out.reason = data.reason;
    if (Number.isFinite(data.retryAfter)) out.retryAfter = data.retryAfter;
    if (typeof data.scope === 'string') out.scope = data.scope;
    return out;
  }
  return {
    mode,
    status: () => request('GET', '/api/report/status'),
    send: (payload) => request('POST', '/api/report', payload),
  };
}

// The mock answers like the server. Triggers in the message, for screenshots of each state:
// "#ratelimit" -> rate_limited, "#busy" -> the global cap, "#offline" -> a network failure.
export function createMockReportApi({ delay = 450 } = {}) {
  const sent = [];
  return {
    mode: 'mock',
    sent,
    status: () => later(0, { ok: true, data: { enabled: true } }),
    send(payload) {
      const m = String(payload && payload.message || '');
      if (/#offline/i.test(m)) return later(delay, { ok: false, error: 'offline' });
      if (/#ratelimit/i.test(m)) return later(delay, { ok: false, error: 'rate_limited', retryAfter: 1800 });
      if (/#busy/i.test(m)) return later(delay, { ok: false, error: 'rate_limited', scope: 'global', retryAfter: 3600 });
      const c = checkReport(payload || {});
      if (!c.ok) return later(delay, { ok: false, error: 'invalid_report', reason: c.reason });
      sent.push(payload);
      return later(delay, { ok: true, data: { ok: true } });
    },
  };
}

export function createReportClient(api) {
  let status = null;
  return {
    api,
    // Asked once per session; anything but {enabled:true} (offline, 5xx, off mode) hides the entry points.
    enabled() {
      if (!status) {
        status = Promise.resolve()
          .then(() => api.status())
          .then((r) => !!(r && r.ok && r.data && r.data.enabled === true), () => false);
      }
      return status;
    },
    send: (payload) => Promise.resolve().then(() => api.send(payload)).catch(() => ({ ok: false, error: 'offline' })),
  };
}

// ---------------------------------------------------------------- copy

export const SENT_TEXT = 'Thanks — report sent.';
export function reportErrorText(r) {
  const e = r && r.error;
  if (e === 'rate_limited') return 'You’ve sent a few already. Try again later.';
  if (e === 'invalid_report' || e === 'too_large') return fieldErrorText(r.reason || 'message_short');
  return 'Couldn’t send it. Check your connection and try again.';
}
export function fieldErrorText(reason) {
  if (reason === 'message_short') return `Write at least ${MESSAGE_MIN} characters.`;
  if (reason === 'message_long') return `Keep it under ${MESSAGE_MAX} characters.`;
  if (reason === 'message_letters') return 'Describe it in a few words.';
  if (reason === 'message_bytes' || reason === undefined) return 'That’s too long to send. Shorten it a little.';
  if (reason === 'contact_long' || reason === 'contact_type') return `Keep this under ${CONTACT_MAX} characters.`;
  if (reason === 'kind') return 'Pick Bug, Idea or Other.';
  return 'Check the form and try again.';
}
