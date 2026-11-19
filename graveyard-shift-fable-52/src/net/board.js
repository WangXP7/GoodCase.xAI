// Leaderboard client. Talks to the Worker in server/ (contract: server/README.md), cross-origin,
// JSON, no credentials. Every call resolves to { ok:true, data } or { ok:false, error, reason?, retryAfter?,
// scope? } and never throws: the leaderboard is optional and must never get in the way of the game.
//
//   boardMode(location)  'live' on a configured origin when an API base is set, 'mock' / 'mockfail' with
//                        ?board=mock|mockfail, else 'off' (artifact frame, file://, localhost, previews,
//                        unconfigured builds): nothing is requested.
//   configure({apiBase, origins})  replaces the build-time settings (tests)
//   createApi({mode})    claim(tag) score(tag, secret, run) recover(tag, code) leaderboard({device}) player(tag)
//   createBoardClient    15 s cache over leaderboard() and player()
//   createIdentity(store) the stored { tag, secret } (never logged, never shown)
//   submitRun(api, ident, run)  one retry after a network or server failure
import { roundTotal, zombiesThroughRound } from '../game/rounds.js';

// Deployment settings, injected at build time by scripts/build.mjs from GS_API_BASE and GS_ALLOWED_ORIGINS
// (see .env.example). Without them (an unconfigured build, or tests) online features stay off.
/* global __GS_API_BASE__, __GS_ORIGINS__ */
const BUILD_API_BASE = typeof __GS_API_BASE__ !== 'undefined' ? __GS_API_BASE__ : '';
const BUILD_ORIGINS = typeof __GS_ORIGINS__ !== 'undefined' ? __GS_ORIGINS__ : [];

const cleanBase = (v) => (typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '');
const cleanOrigins = (v) => (Array.isArray(v) ? v.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim()) : []);

// Live bindings: importers (net/report.js) always see the current values.
export let API_BASE = cleanBase(BUILD_API_BASE);
export let ALLOWED_ORIGINS = cleanOrigins(BUILD_ORIGINS);

export function configure({ apiBase = '', origins = [] } = {}) {
  API_BASE = cleanBase(apiBase);
  ALLOWED_ORIGINS = cleanOrigins(origins);
}

// True on a page this deployment serves, with an API to talk to.
export function onlineOrigin(loc) {
  return !!API_BASE && !!loc && ALLOWED_ORIGINS.includes(loc.origin);
}

const STORE_KEY = 'graveyard-shift.board';
const CACHE_MS = 15000;

export function boardMode(loc) {
  try {
    if (!loc) return 'off';
    const q = new URLSearchParams(loc.search || '').get('board');
    if (q === 'off') return 'off';
    if (q === 'mock' || q === 'mockfail') return q;
    return onlineOrigin(loc) ? 'live' : 'off';
  } catch { return 'off'; }
}

// ---------------------------------------------------------------- tags

// The server's format rules (server/src/validate.js normaliseTag): trimmed, whitespace runs collapsed,
// 3-16 characters of letters, digits, _ - and space, at least 3 once separators are removed. The
// blocklist and reserved names stay on the server; its answer is shown inline.
export const TAG_MIN = 3;
export const TAG_MAX = 16;
const TAG_CHARS = /^[A-Za-z0-9_\- ]+$/;
export function checkTag(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'tag_type' };
  if (raw.length > 64) return { ok: false, reason: 'tag_length' };
  const tag = raw.trim().replace(/\s+/g, ' ');
  if (tag.length < TAG_MIN || tag.length > TAG_MAX) return { ok: false, reason: 'tag_length' };
  if (!TAG_CHARS.test(tag)) return { ok: false, reason: 'tag_chars' };
  if (tag.replace(/[\s_-]+/g, '').length < TAG_MIN) return { ok: false, reason: 'tag_length' };
  return { ok: true, tag };
}

// The uniqueness key (lowercase, separators gone, look-alikes folded), as the server builds it.
const FOLD = { 0: 'o', 1: 'l', i: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', 6: 'g', 2: 'z' };
export const tagKey = (tag) => String(tag).toLowerCase().replace(/[\s_-]+/g, '').replace(/[0-9i]/g, (c) => FOLD[c] ?? c);

// ---------------------------------------------------------------- identity

const SECRET_RE = /^[0-9a-f]{16,256}$/i;
export function createIdentity(store) {
  let mem; // undefined: not read yet; null: none. Kept so a store that cannot write still works this session.
  const read = () => {
    try {
      const raw = store && store.get(STORE_KEY, null);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const t = checkTag(v.tag);
      if (!t.ok || typeof v.secret !== 'string' || !SECRET_RE.test(v.secret)) return null;
      return { tag: t.tag, secret: v.secret };
    } catch { return null; }
  };
  return {
    get() { if (mem === undefined) mem = read(); return mem ? { ...mem } : null; },
    tag() { const v = this.get(); return v ? v.tag : null; },
    set({ tag, secret }) {
      mem = { tag, secret };
      try { store && store.set(STORE_KEY, JSON.stringify(mem)); } catch { /* memory only */ }
    },
    clear() { mem = null; try { store && store.set(STORE_KEY, ''); } catch { /* memory only */ } },
    toString() { return '[identity]'; },
    toJSON() { return '[identity]'; },
  };
}

// ---------------------------------------------------------------- live api

export function createApi({ mode = 'off', fetch: fetchFn, base = API_BASE, timeoutMs = 8000, mockDelay } = {}) {
  if (mode === 'mock') return createMockApi({ delay: mockDelay });
  if (mode === 'mockfail') return failingApi(mockDelay);
  if (mode !== 'live' || !base) return disabledApi();
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));

  async function request(method, path, body) {
    let ctrl = null, timer = null, res;
    try {
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
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
  const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return {
    mode, enabled: true,
    claim: (tag) => request('POST', '/api/claim', { tag }),
    score: (tag, secret, run) => request('POST', '/api/score', { tag, secret, run }),
    recover: (tag, recovery) => request('POST', '/api/recover', { tag, recovery }),
    leaderboard: ({ device = 'all' } = {}) => request('GET', `/api/leaderboard?${q({ board: 'round', device, limit: 100 })}`),
    player: (tag) => request('GET', `/api/player?${q({ tag })}`),
  };
}

function disabledApi() {
  const no = async () => ({ ok: false, error: 'disabled' });
  return { mode: 'off', enabled: false, claim: no, score: no, recover: no, leaderboard: no, player: no };
}

function failingApi(delay = 250) {
  const no = () => later(delay, { ok: false, error: 'offline' });
  return { mode: 'mockfail', enabled: true, claim: no, score: no, recover: no, leaderboard: no, player: no };
}

const later = (ms, v) => (ms > 0 ? new Promise((r) => setTimeout(() => r(v), ms)) : Promise.resolve(v));

// ---------------------------------------------------------------- run submission

const RETRYABLE = new Set(['offline', 'server']);
const whole = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
export function cleanRun(run = {}) {
  return {
    round: Math.max(1, whole(run.round)), kills: whole(run.kills), headshots: whole(run.headshots), points: whole(run.points),
    timeSec: Math.min(86400, whole(run.timeSec)), version: String(run.version || '0'), device: run.device === 'phone' ? 'phone' : 'desktop',
  };
}

export async function submitRun(api, ident, run, { wait = (fn) => setTimeout(fn, 2500) } = {}) {
  if (!api || !ident || !ident.tag || !ident.secret) return { ok: false, error: 'disabled' };
  const body = cleanRun(run);
  const once = async () => { try { return await api.score(ident.tag, ident.secret, body); } catch { return { ok: false, error: 'offline' }; } };
  let r = await once();
  if (!r.ok && RETRYABLE.has(r.error)) {
    await new Promise((res) => { try { wait(res); } catch { res(); } });
    r = await once();
  }
  return r;
}

// Harness params that change how the game plays: such a run is practice and is never submitted.
const PRACTICE = ['round', 'god', 'bot', 'warp', 'give', 'points', 'open', 'power', 'plates', 'autostart', 'searched', 'spawn', 'ztype', 'zone', 'step', 'dt', 'adv', 'shot', 'cam', 'crash'];
export function isPracticeRun(params = {}) {
  return PRACTICE.some((k) => params[k] !== undefined && params[k] !== false);
}

// ---------------------------------------------------------------- cache

export function createBoardClient(api, { now = () => Date.now() } = {}) {
  const cache = new Map();
  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at <= CACHE_MS - 1) return hit.value;
    const value = await fn();
    if (value && value.ok) cache.set(key, { at: now(), value });
    return value;
  };
  return {
    api,
    get enabled() { return !!(api && api.enabled); },
    top: (device = 'all') => cached(`top:${device}`, () => api.leaderboard({ device })),
    me: (tag) => cached(`me:${tagKey(tag)}`, () => api.player(tag)),
    invalidate() { cache.clear(); },
  };
}

// ---------------------------------------------------------------- copy

export function errorText(r) {
  const e = r && r.error;
  if (e === 'taken') return 'That tag is taken. Try another.';
  if (e === 'invalid_tag') {
    if (r.reason === 'tag_length') return 'Use 3 to 16 characters.';
    if (r.reason === 'tag_chars' || r.reason === 'tag_type') return 'Use letters, numbers, spaces, - or _.';
    return 'That tag is not allowed. Try another.';
  }
  if (e === 'rate_limited') return r.scope === 'global' ? 'A lot of new players right now. Try again in a few minutes.' : 'Too many tries. Wait a few minutes and try again.';
  if (e === 'bad_recovery') return 'That tag and code do not match.';
  if (e === 'bad_secret') return 'This tag moved to another device. Use your recovery code on the Leaderboard.';
  if (e === 'not_found') return 'No player with that tag.';
  if (e === 'offline' || e === 'server' || e === 'disabled') return 'Couldn’t reach the leaderboard. Try again.';
  return 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------- mock (board=mock)

// An in-memory stand-in with the server's contract, for testing and screenshots offline. Deterministic:
// seeded names and stats from index arithmetic, secrets and codes from a string hash.
const ADJ = ['Night', 'Grave', 'Dead', 'Rust', 'Neon', 'Last', 'Cold', 'Diesel', 'Lucky', 'Gravel', 'Quiet', 'Iron', 'Ash', 'Late', 'Static', 'Hollow'];
const NOUN = ['Owl', 'Digger', 'Eye', 'Trucker', 'Cook', 'Shift', 'Coffee', 'Moth', 'Pump', 'Ranger', 'Drifter', 'Lantern', 'Wrench', 'Hound', 'Comet', 'Teller'];
const RESERVED = ['admin', 'moderator', 'mod', 'graveyard', 'null', 'undefined', 'system', 'support', 'staff', 'official'];
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hash32(s, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const hex64 = (s) => { let out = ''; for (let i = 0; out.length < 64; i++) out += hash32(`${s}:${i}`).toString(16).padStart(8, '0'); return out.slice(0, 64); };
const code16 = (s) => { let c = ''; for (let i = 0; i < 16; i++) c += RECOVERY_ALPHABET[hash32(`${s}#${i}`) % RECOVERY_ALPHABET.length]; return c.match(/.{4}/g).join('-'); };

export function createMockApi({ delay = 250 } = {}) {
  const players = new Map(); // key -> { tag, secret, recovery, best, games, createdAt }
  const at = (i) => new Date(Date.UTC(2026, 10, 11, 18, 0, 0) + i * 61000).toISOString();
  for (let i = 0; i < 140; i++) {
    const tag = `${ADJ[i % ADJ.length]} ${NOUN[(i * 5 + Math.floor(i / ADJ.length)) % NOUN.length]}${i >= 128 ? ` ${i}` : ''}`;
    const round = Math.max(2, 31 - Math.floor(i / 5));
    const kills = zombiesThroughRound(round - 1) + ((i * 37) % Math.max(1, roundTotal(round)));
    const device = i % 3 === 1 ? 'phone' : 'desktop';
    const best = { round, kills, headshots: Math.floor(kills * (0.2 + ((i * 13) % 40) / 100)), points: kills * 140, timeSec: round * 150, device, at: at(i) };
    players.set(tagKey(tag), { tag, secret: hex64(tag), recovery: code16(tag), best, games: 1 + (i % 9), createdAt: at(i) });
  }
  let claims = 0;
  const order = (a, b) => b.round - a.round || b.kills - a.kills || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const ranked = (device = 'all') => [...players.values()].filter((p) => p.best && (device === 'all' || p.best.device === device))
    .sort((a, b) => order(a.best, b.best));
  const rankOf = (key) => { const i = ranked('all').findIndex((p) => tagKey(p.tag) === key); return i >= 0 ? i + 1 : null; };
  const reply = (v) => later(delay, v);

  return {
    mode: 'mock', enabled: true,
    claim(raw) {
      const c = checkTag(raw);
      if (!c.ok) return reply({ ok: false, error: 'invalid_tag', reason: c.reason });
      const key = tagKey(c.tag);
      if (c.tag.toLowerCase().split(/[\s_-]+/).some((w) => RESERVED.includes(w))) return reply({ ok: false, error: 'invalid_tag', reason: 'tag_reserved' });
      if (key === 'slowdown') return reply({ ok: false, error: 'rate_limited', retryAfter: 1800 });
      if (players.has(key)) return reply({ ok: false, error: 'taken' });
      claims++;
      const p = { tag: c.tag, secret: hex64(`${c.tag}|${claims}`), recovery: code16(`${c.tag}|${claims}`), best: null, games: 0, createdAt: at(200 + claims) };
      players.set(key, p);
      return reply({ ok: true, data: { tag: p.tag, secret: p.secret, recovery: p.recovery } });
    },
    score(tag, secret, run) {
      const p = players.get(tagKey(tag));
      if (!p || p.secret !== secret) return reply({ ok: false, error: 'bad_secret' });
      const r = cleanRun(run);
      p.games++;
      const entry = { ...r, at: at(300 + p.games) };
      delete entry.version;
      const better = !p.best || order(entry, p.best) < 0;
      if (better) p.best = entry;
      return reply({ ok: true, data: { ok: true, personalBest: better, rank: rankOf(tagKey(tag)), games: p.games } });
    },
    recover(tag, code) {
      const p = players.get(tagKey(tag));
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!p || norm(code) !== norm(p.recovery)) return reply({ ok: false, error: 'bad_recovery' });
      p.secret = hex64(`${p.secret}|rotated`);
      return reply({ ok: true, data: { tag: p.tag, secret: p.secret } });
    },
    leaderboard({ device = 'all' } = {}) {
      const entries = ranked(device).slice(0, 100).map((p, i) => ({ rank: i + 1, tag: p.tag, ...p.best }));
      return reply({ ok: true, data: { board: 'round', device, entries } });
    },
    player(tag) {
      const p = players.get(tagKey(tag));
      if (!p) return reply({ ok: false, error: 'not_found' });
      return reply({ ok: true, data: { tag: p.tag, games: p.games, rank: p.best ? rankOf(tagKey(tag)) : null, createdAt: p.createdAt, lastAt: p.best ? p.best.at : null, best: p.best ? { ...p.best } : null } });
    },
  };
}
