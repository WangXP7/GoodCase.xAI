// Launch kit: leaderboard client, share, analytics. Pure logic only (the suite runs in node;
// the DOM parts are checked in the browser by the launch-kit Playwright script).
import { describe, it, expect, vi, afterEach, beforeEach, afterAll } from 'vitest';
import {
  API_BASE, ALLOWED_ORIGINS, configure, boardMode, checkTag, createIdentity, createApi, createMockApi, createBoardClient,
  submitRun, isPracticeRun, errorText,
} from '../src/net/board.js';
import { shareText, shareUrl, intentHref, copyText, SHARE_URL } from '../src/ui/share.js';
import { track, cleanProps } from '../src/core/analytics.js';
import { validateTag } from '../server/src/validate.js';

const loc = (origin, search = '') => ({ origin, search, protocol: origin.startsWith('http') ? origin.split(':')[0] + ':' : 'file:' });

// Example deployment settings (a real build gets them from GS_API_BASE / GS_ALLOWED_ORIGINS).
const GAME = 'https://game.example';
const API = 'https://api.example';
const OTHER = 'https://other-game.example';
beforeEach(() => { configure({ apiBase: API, origins: [GAME, OTHER] }); });
afterAll(() => { configure({}); });

describe('boardMode: the leaderboard only runs on the configured origins', () => {
  it('is live on the allowed origins only', () => {
    expect(ALLOWED_ORIGINS).toEqual([GAME, OTHER]);
    expect(API_BASE).toBe(API);
    expect(boardMode(loc(GAME))).toBe('live');
    expect(boardMode(loc(OTHER))).toBe('live');
  });
  it.each([
    ['file://', loc('null')],
    ['localhost', loc('http://localhost:5173')],
    ['a preview deployment', loc('https://game-git-feat-x.preview.example')],
    ['an embedding frame', loc('https://sandbox.example')],
    ['an opaque sandbox origin', loc('null')],
    ['http on the right host', loc('http://game.example')],
    ['a look-alike host', loc('https://game.example.evil.com')],
    ['missing location', undefined],
  ])('is off on %s', (_n, l) => {
    expect(boardMode(l)).toBe('off');
  });
  it('is off everywhere in an unconfigured build (no API base, or no origins)', async () => {
    configure({});
    expect(API_BASE).toBe('');
    expect(ALLOWED_ORIGINS).toEqual([]);
    expect(boardMode(loc(GAME))).toBe('off');
    configure({ apiBase: '', origins: [GAME] });
    expect(boardMode(loc(GAME))).toBe('off');
    configure({ apiBase: API, origins: [] });
    expect(boardMode(loc(GAME))).toBe('off');
    configure({});
    const f = vi.fn();
    const api = createApi({ mode: 'live', fetch: f });
    expect(api.enabled).toBe(false);
    expect(await api.claim('Dead Eye')).toEqual({ ok: false, error: 'disabled' });
    expect(f).not.toHaveBeenCalled();
  });
  it('configure trims a trailing slash and ignores junk origins', () => {
    configure({ apiBase: `${API}/`, origins: [` ${GAME} `, '', 7, null] });
    expect(API_BASE).toBe(API);
    expect(ALLOWED_ORIGINS).toEqual([GAME]);
  });
  it('board=mock swaps in the mock anywhere; board=mockfail is a mock that is always offline; board=off wins', () => {
    expect(boardMode(loc('null', '?board=mock'))).toBe('mock');
    expect(boardMode(loc('null', '?ui=dead&board=mockfail'))).toBe('mockfail');
    expect(boardMode(loc(GAME, '?board=off'))).toBe('off');
    expect(boardMode(loc('null', '?board=nonsense'))).toBe('off');
  });
  it('a location whose fields throw is off', () => {
    const bad = { get origin() { throw new Error('denied'); } };
    expect(boardMode(bad)).toBe('off');
  });
});

describe('checkTag mirrors the server format rules', () => {
  it('normalises spaces and keeps case', () => {
    expect(checkTag('  Dead   Eye ')).toEqual({ ok: true, tag: 'Dead Eye' });
  });
  it.each([
    ['ab', 'tag_length'], ['a'.repeat(17), 'tag_length'], ['   ', 'tag_length'], ['--_', 'tag_length'],
    ['Dead<Eye>', 'tag_chars'], ['émile', 'tag_chars'], ['ok!!', 'tag_chars'], [42, 'tag_type'],
  ])('rejects %j as %s', (raw, reason) => {
    expect(checkTag(raw)).toEqual({ ok: false, reason });
  });
  it('agrees with the server on every format verdict (blocklist left to the server)', () => {
    const corpus = ['abc', 'ab', 'Dead Eye', 'a_b', 'x'.repeat(16), 'x'.repeat(17), ' a b ', 'a-b-c', '__a', 'Zed!', 'tab\tname',
      'B0B', 'Night Owl 7', 'émile', '---', 'a  b', '1 2 3', 'Ki11er', 'ZZZZZZZZZZZZZZZZ'];
    for (const t of corpus) {
      const s = validateTag(t);
      const c = checkTag(t);
      if (s.ok || s.reason === 'tag_blocked' || s.reason === 'tag_reserved') expect(c, t).toEqual({ ok: true, tag: s.tag ?? c.tag });
      else expect(c, t).toEqual({ ok: false, reason: s.reason });
    }
  });
});

describe('createIdentity: {tag, secret} through the store wrapper', () => {
  const mem = () => { const m = new Map(); return { get: (k, f = null) => (m.has(k) ? m.get(k) : f), set: (k, v) => { m.set(k, String(v)); return true; }, m }; };
  it('round-trips and clears', () => {
    const s = mem();
    const id = createIdentity(s);
    expect(id.get()).toBe(null);
    id.set({ tag: 'Dead Eye', secret: 'a'.repeat(64) });
    expect(id.get()).toEqual({ tag: 'Dead Eye', secret: 'a'.repeat(64) });
    expect(id.tag()).toBe('Dead Eye');
    id.clear();
    expect(id.get()).toBe(null);
  });
  it('survives a store that throws on every call', () => {
    const boom = { get() { throw new Error('SecurityError'); }, set() { throw new Error('SecurityError'); } };
    const id = createIdentity(boom);
    expect(() => id.set({ tag: 'Dead Eye', secret: 'b'.repeat(64) })).not.toThrow();
    // nothing persisted, but the session keeps it in memory
    expect(id.get()).toEqual({ tag: 'Dead Eye', secret: 'b'.repeat(64) });
    expect(() => id.clear()).not.toThrow();
  });
  it('ignores garbage in the store', () => {
    for (const raw of ['not json', '{"tag":1}', '{"tag":"ab","secret":"x"}', 'null', '[]', '{"tag":"Dead Eye"}']) {
      const s = mem(); s.set('graveyard-shift.board', raw);
      expect(createIdentity(s).get(), raw).toBe(null);
    }
  });
  it('never puts the secret in what it reports', () => {
    const id = createIdentity(mem());
    id.set({ tag: 'Dead Eye', secret: 'c'.repeat(64) });
    expect(String(id)).not.toContain('ccc');
    expect(JSON.stringify(id)).not.toContain('ccc');
  });
});

// a fetch double: queue of responses (or errors), records every call
function fakeFetch(...replies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : undefined });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === 'bad') throw new SyntaxError('x'); return r.body; } };
  };
  f.calls = calls;
  return f;
}

describe('createApi (live): cross-origin JSON, no credentials, never throws', () => {
  it('posts a claim to the Worker URL', async () => {
    const f = fakeFetch({ status: 201, body: { tag: 'Dead Eye', secret: 's'.repeat(64), recovery: 'K7QM-2XPA-HV9C-R4TN' } });
    const api = createApi({ mode: 'live', fetch: f });
    const r = await api.claim('Dead Eye');
    expect(r).toEqual({ ok: true, data: { tag: 'Dead Eye', secret: 's'.repeat(64), recovery: 'K7QM-2XPA-HV9C-R4TN' } });
    expect(f.calls[0].url).toBe(`${API_BASE}/api/claim`);
    expect(f.calls[0].url).toBe('https://api.example/api/claim');
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(f.calls[0].init.credentials).toBe('omit');
    expect(f.calls[0].body).toEqual({ tag: 'Dead Eye' });
  });
  it('builds GET queries with encoding', async () => {
    const f = fakeFetch({ status: 200, body: { board: 'round', device: 'phone', entries: [] } }, { status: 200, body: { tag: 'A&B' } });
    const api = createApi({ mode: 'live', fetch: f });
    await api.leaderboard({ device: 'phone' });
    await api.player('Dead Eye');
    expect(f.calls[0].url).toBe(`${API_BASE}/api/leaderboard?board=round&device=phone&limit=100`);
    expect(f.calls[0].init.method).toBe('GET');
    expect(f.calls[0].init.headers).toBeUndefined(); // a simple GET: no preflight
    expect(f.calls[1].url).toBe(`${API_BASE}/api/player?tag=Dead%20Eye`);
  });
  it.each([
    [{ status: 409, body: { error: 'taken' } }, { ok: false, error: 'taken' }],
    [{ status: 400, body: { error: 'invalid_tag', reason: 'tag_reserved' } }, { ok: false, error: 'invalid_tag', reason: 'tag_reserved' }],
    [{ status: 429, body: { error: 'rate_limited', retryAfter: 1800 } }, { ok: false, error: 'rate_limited', retryAfter: 1800 }],
    [{ status: 429, body: { error: 'rate_limited', retryAfter: 60, scope: 'global' } }, { ok: false, error: 'rate_limited', retryAfter: 60, scope: 'global' }],
    [{ status: 403, body: { error: 'bad_secret' } }, { ok: false, error: 'bad_secret' }],
    [{ status: 422, body: { error: 'implausible_run', reason: 'kills_too_few' } }, { ok: false, error: 'implausible_run', reason: 'kills_too_few' }],
    [{ status: 500, body: { error: 'internal' } }, { ok: false, error: 'server' }],
    [{ status: 502, body: 'bad' }, { ok: false, error: 'server' }],
    [{ status: 200, body: 'bad' }, { ok: false, error: 'server' }],
    [new TypeError('Failed to fetch'), { ok: false, error: 'offline' }],
  ])('maps %j', async (reply, want) => {
    const api = createApi({ mode: 'live', fetch: fakeFetch(reply) });
    expect(await api.claim('Dead Eye')).toEqual(want);
  });
  it('off mode never touches the network', async () => {
    const f = fakeFetch({ status: 200, body: {} });
    const api = createApi({ mode: 'off', fetch: f });
    for (const r of [await api.claim('abc'), await api.score('abc', 's', {}), await api.leaderboard({}), await api.player('abc'), await api.recover('abc', 'x')]) {
      expect(r).toEqual({ ok: false, error: 'disabled' });
    }
    expect(f.calls.length).toBe(0);
    expect(api.enabled).toBe(false);
  });
  it('a fetch that throws synchronously is offline, not an exception', async () => {
    const api = createApi({ mode: 'live', fetch: () => { throw new Error('boom'); } });
    await expect(api.player('abc')).resolves.toEqual({ ok: false, error: 'offline' });
  });
  it('a request that never answers times out as offline', async () => {
    vi.useFakeTimers();
    try {
      const never = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
      const api = createApi({ mode: 'live', fetch: never, timeoutMs: 5000 });
      const p = api.player('abc');
      await vi.advanceTimersByTimeAsync(5001);
      await expect(p).resolves.toEqual({ ok: false, error: 'offline' });
    } finally { vi.useRealTimers(); }
  });
});

describe('submitRun: fire and forget with one retry', () => {
  const ident = { tag: 'Dead Eye', secret: 'd'.repeat(64) };
  const run = { round: 3, kills: 25, headshots: 4, points: 900, timeSec: 80, version: '0.2.0', device: 'desktop' };
  const now = (fn) => fn(); // retry at once
  it('posts the run, once when it works', async () => {
    const f = fakeFetch({ status: 200, body: { ok: true, personalBest: true, rank: 12, games: 3 } });
    const r = await submitRun(createApi({ mode: 'live', fetch: f }), ident, run, { wait: now });
    expect(r).toEqual({ ok: true, data: { ok: true, personalBest: true, rank: 12, games: 3 } });
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].body).toEqual({ tag: 'Dead Eye', secret: 'd'.repeat(64), run });
  });
  it('retries once after offline or a 5xx, then gives up', async () => {
    const f1 = fakeFetch(new TypeError('x'), { status: 200, body: { ok: true, rank: 4 } });
    expect(await submitRun(createApi({ mode: 'live', fetch: f1 }), ident, run, { wait: now })).toMatchObject({ ok: true });
    expect(f1.calls.length).toBe(2);
    const f2 = fakeFetch({ status: 503, body: {} });
    expect(await submitRun(createApi({ mode: 'live', fetch: f2 }), ident, run, { wait: now })).toEqual({ ok: false, error: 'server' });
    expect(f2.calls.length).toBe(2);
  });
  it('does not retry what a retry cannot fix', async () => {
    for (const reply of [{ status: 422, body: { error: 'implausible_run', reason: 'x' } }, { status: 403, body: { error: 'bad_secret' } }, { status: 429, body: { error: 'rate_limited' } }]) {
      const f = fakeFetch(reply);
      await submitRun(createApi({ mode: 'live', fetch: f }), ident, run, { wait: now });
      expect(f.calls.length).toBe(1);
    }
  });
  it('sends whole non-negative numbers', async () => {
    const f = fakeFetch({ status: 200, body: { ok: true } });
    await submitRun(createApi({ mode: 'live', fetch: f }), ident, { ...run, timeSec: 80.7, points: -3, kills: 25.2 }, { wait: now });
    expect(f.calls[0].body.run).toMatchObject({ timeSec: 80, points: 0, kills: 25 });
  });
  it('never throws, even with no identity or a broken api', async () => {
    await expect(submitRun(null, ident, run)).resolves.toMatchObject({ ok: false });
    await expect(submitRun(createApi({ mode: 'live', fetch: fakeFetch({ status: 200, body: {} }) }), null, run)).resolves.toMatchObject({ ok: false });
    await expect(submitRun({ score() { throw new Error('x'); } }, ident, run, { wait: now })).resolves.toMatchObject({ ok: false });
  });
});

describe('isPracticeRun: harness params that change play never reach the board', () => {
  it.each([[{}, false], [{ seed: 3 }, false], [{ hints: false }, false], [{ round: 10 }, true], [{ god: true }, true], [{ bot: true }, true],
    [{ warp: 4 }, true], [{ give: ['smg'] }, true], [{ points: 9999 }, true], [{ open: 'all' }, true], [{ autostart: true }, true]])('%j -> %s', (p, want) => {
    expect(isPracticeRun(p)).toBe(want);
  });
});

describe('createBoardClient: 15 s cache over the api', () => {
  it('serves the same device from cache for 15 s, then asks again', async () => {
    let t = 0;
    const f = fakeFetch({ status: 200, body: { board: 'round', device: 'all', entries: [{ rank: 1, tag: 'A', round: 3, kills: 20 }] } });
    const c = createBoardClient(createApi({ mode: 'live', fetch: f }), { now: () => t });
    await c.top('all');
    t = 14_000; await c.top('all');
    expect(f.calls.length).toBe(1);
    await c.top('phone');
    expect(f.calls.length).toBe(2);
    t = 15_001; await c.top('all');
    expect(f.calls.length).toBe(3);
  });
  it('does not cache failures', async () => {
    const f = fakeFetch(new TypeError('x'), { status: 200, body: { entries: [] } });
    const c = createBoardClient(createApi({ mode: 'live', fetch: f }), { now: () => 0 });
    expect(await c.top('all')).toMatchObject({ ok: false, error: 'offline' });
    expect(await c.top('all')).toMatchObject({ ok: true });
  });
  it('invalidate() forgets everything (after a new score)', async () => {
    const f = fakeFetch({ status: 200, body: { entries: [] } });
    const c = createBoardClient(createApi({ mode: 'live', fetch: f }), { now: () => 0 });
    await c.top('all'); c.invalidate(); await c.top('all');
    expect(f.calls.length).toBe(2);
  });
});

describe('the mock API: offline stand-in with the server contract', () => {
  it('claims, scores, ranks and shows the run on the board', async () => {
    const api = createMockApi({ delay: 0 });
    const c = await api.claim('  New  Blood ');
    expect(c.ok).toBe(true);
    expect(c.data.tag).toBe('New Blood');
    expect(c.data.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(c.data.recovery).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const s = await api.score('New Blood', c.data.secret, { round: 30, kills: 2500, headshots: 900, points: 300000, timeSec: 4000, version: '0.2.0', device: 'phone' });
    expect(s).toMatchObject({ ok: true, data: { ok: true, personalBest: true } });
    expect(s.data.rank).toBeGreaterThan(0);
    const b = await api.leaderboard({ device: 'all' });
    expect(b.data.entries.length).toBe(100);
    expect(b.data.entries.find((e) => e.tag === 'New Blood').rank).toBe(s.data.rank);
    const phone = await api.leaderboard({ device: 'phone' });
    expect(phone.data.entries.every((e) => e.device === 'phone')).toBe(true);
    // ordered: round desc, then kills desc
    const e = b.data.entries;
    for (let i = 1; i < e.length; i++) expect(e[i - 1].round > e[i].round || (e[i - 1].round === e[i].round && e[i - 1].kills >= e[i].kills)).toBe(true);
  });
  it('a low run ranks outside the top 100 and /player reports it', async () => {
    const api = createMockApi({ delay: 0 });
    const c = await api.claim('Low Roller');
    await api.score('Low Roller', c.data.secret, { round: 1, kills: 3, headshots: 0, points: 50, timeSec: 30, version: '0.2.0', device: 'desktop' });
    const p = await api.player('low roller');
    expect(p.ok).toBe(true);
    expect(p.data.rank).toBeGreaterThan(100);
    expect(p.data.best).toMatchObject({ round: 1, kills: 3 });
  });
  it('refuses what the server refuses', async () => {
    const api = createMockApi({ delay: 0 });
    expect(await api.claim('Night Owl')).toEqual({ ok: false, error: 'taken' }); // a seeded player
    expect(await api.claim('Admin')).toEqual({ ok: false, error: 'invalid_tag', reason: 'tag_reserved' });
    expect(await api.claim('a!')).toEqual({ ok: false, error: 'invalid_tag', reason: 'tag_length' });
    expect(await api.claim('Slow Down')).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(await api.score('Night Owl', 'f'.repeat(64), {})).toEqual({ ok: false, error: 'bad_secret' });
    expect(await api.recover('Night Owl', 'WRONG-CODE')).toEqual({ ok: false, error: 'bad_recovery' });
    expect(await api.player('Nobody Here')).toEqual({ ok: false, error: 'not_found' });
  });
  it('recovers a tag with its code (any case, dashes optional) and rotates the secret', async () => {
    const api = createMockApi({ delay: 0 });
    const c = await api.claim('Grave Digger');
    const r = await api.recover('grave digger', c.data.recovery.toLowerCase().replace(/-/g, ' '));
    expect(r).toMatchObject({ ok: true, data: { tag: 'Grave Digger' } });
    expect(r.data.secret).not.toBe(c.data.secret);
    expect(await api.score('Grave Digger', c.data.secret, { round: 1, kills: 0, headshots: 0, points: 0, timeSec: 1, version: '0.2.0', device: 'desktop' })).toEqual({ ok: false, error: 'bad_secret' });
  });
  it('mockfail is offline for everything', async () => {
    const api = createApi({ mode: 'mockfail' });
    expect(await api.leaderboard({})).toEqual({ ok: false, error: 'offline' });
    expect(await api.claim('Dead Eye')).toEqual({ ok: false, error: 'offline' });
    expect(api.enabled).toBe(true);
  });
  it('the mock is deterministic (no Math.random)', async () => {
    const spy = vi.spyOn(Math, 'random');
    const a = await createMockApi({ delay: 0 }).leaderboard({});
    const b = await createMockApi({ delay: 0 }).leaderboard({});
    expect(a).toEqual(b);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('errorText: inline copy for every failure', () => {
  it.each([
    [{ error: 'taken' }, /taken/i], [{ error: 'invalid_tag', reason: 'tag_blocked' }, /not allowed/i], [{ error: 'invalid_tag', reason: 'tag_reserved' }, /not allowed/i],
    [{ error: 'invalid_tag', reason: 'tag_length' }, /3.+16/], [{ error: 'invalid_tag', reason: 'tag_chars' }, /letters/i],
    [{ error: 'rate_limited' }, /too many/i], [{ error: 'rate_limited', scope: 'global' }, /lot of new players/i], [{ error: 'offline' }, /couldn.t reach/i],
    [{ error: 'server' }, /couldn.t reach/i], [{ error: 'bad_recovery' }, /match/i], [{ error: 'whatever' }, /.+/],
  ])('%j', (r, re) => { expect(errorText(r)).toMatch(re); });
});

describe('share text and links', () => {
  it('writes the post with round and kills', () => {
    expect(shareText({ round: 12, kills: 310 })).toBe('I survived to round 12 of Graveyard Shift — 310 kills. Can you beat it? zombies.ethanplus.ai @ethanplusai');
    expect(shareText({ round: 1, kills: 1 })).toBe('I survived to round 1 of Graveyard Shift — 1 kill. Can you beat it? zombies.ethanplus.ai @ethanplusai');
    expect(shareText({ round: 'x', kills: -2 })).toBe('I survived to round 1 of Graveyard Shift — 0 kills. Can you beat it? zombies.ethanplus.ai @ethanplusai');
  });
  it('always shares the production URL', () => {
    expect(SHARE_URL).toBe('https://zombies.ethanplus.ai');
    expect(shareUrl()).toBe('https://zombies.ethanplus.ai');
  });
  it('encodes the X intent', () => {
    const href = intentHref({ round: 12, kills: 310 });
    expect(href.startsWith('https://x.com/intent/post?text=')).toBe(true);
    const u = new URL(href);
    expect(u.searchParams.get('text')).toBe(shareText({ round: 12, kills: 310 }));
    expect(u.searchParams.get('url')).toBe('https://zombies.ethanplus.ai');
    expect(href).toContain('%E2%80%94'); // the em dash
    expect(href).toContain('%40ethanplusai');
    expect(href).not.toContain(' ');
    expect(href.split('&').length).toBe(2); // the text's own characters are all encoded
  });
  it('copies the text and the link', () => {
    expect(copyText({ round: 3, kills: 20 })).toBe(`${shareText({ round: 3, kills: 20 })} https://zombies.ethanplus.ai`);
  });
});

describe('analytics', () => {
  afterEach(() => { delete globalThis.window; });
  it('is a no-op without window.va (and without window)', () => {
    expect(() => track('game_start', { device: 'phone' })).not.toThrow();
    globalThis.window = {};
    expect(() => track('game_start', { device: 'phone' })).not.toThrow();
  });
  it('sends a Vercel custom event', () => {
    const va = vi.fn();
    globalThis.window = { va };
    track('death', { round: 7, kills: 61, device: 'desktop' });
    expect(va).toHaveBeenCalledWith('event', { name: 'death', data: { round: 7, kills: 61, device: 'desktop' } });
    track('round_10');
    expect(va).toHaveBeenLastCalledWith('event', { name: 'round_10' });
  });
  it('never throws when va throws', () => {
    globalThis.window = { va() { throw new Error('blocked'); } };
    expect(() => track('board_open')).not.toThrow();
  });
  it('keeps flat primitives only', () => {
    expect(cleanProps({ a: 1, b: 'x', c: true, d: null, e: { x: 1 }, f: [1], g: () => 1, h: NaN, i: 'y'.repeat(300) })).toEqual({ a: 1, b: 'x', c: true, i: 'y'.repeat(255) });
    expect(cleanProps(null)).toBe(undefined);
    expect(cleanProps({ e: {} })).toBe(undefined);
  });
});
