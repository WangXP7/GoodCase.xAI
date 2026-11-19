// "Report a problem" (server/src/report.js through the Worker's handle()): storage, validation, honeypot,
// rate limits, duplicates, the optional email (Resend) and GitHub channels with a fake fetch, the scheduled
// retry, and the migration on top of the original schema. No real network: every fetch is a fake.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { handle } from '../server/src/index.js';
import {
  validateReport, cleanText, fenceFor, issueTitle, issueBody, issueLabels, emailSubject, emailText, replyTo,
  issueNotice, emailNotice, githubIssuesUrl, githubRepo, siteName, RESEND_URL, REPORT_MAX_BODY, MESSAGE_MAX, safeTitleText,
} from '../server/src/report.js';
import { FakeD1 } from '../server/test/fakeD1.js';

const ORIGIN = 'https://game.example';
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TOKEN = 'ghp_test_token_never_real';
const KEY = 're_test_key_never_real';
const TO = 'owner@example.com';
const FROM = 'Graveyard Shift <reports@example.com>';
const SITE = 'game.example';
const GITHUB_ISSUES_URL = 'https://api.github.com/repos/acme/game/issues';
const ISSUE_NOTICE = issueNotice(SITE);
const EMAIL_NOTICE = emailNotice(SITE);

const CONTEXT = {
  version: '0.2.0', device: 'desktop', tier: 'high', round: 7, zone: 'diner', weapon: 'pistol', fps: 58.43,
  viewport: '1920x1080@2x', ua: 'Mozilla/5.0 (Macintosh) Chrome/140', where: 'pause',
};
const REPORT = { kind: 'bug', message: 'The diner door would not open after I bought it.', contact: '', context: CONTEXT, hp: '' };

// A fake fetch that records calls and answers with `respond(url, init)` (default 201 / {}).
function fakeFetch(respond = () => new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/9', number: 9, id: 'e1' }), { status: 201 })) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null }); return respond(url, init); };
  fn.calls = calls;
  fn.to = (u) => calls.filter((c) => c.url === u);
  return fn;
}

function makeEnv(extra = {}) {
  return { DB: new FakeD1(), IP_SALT: 'test-salt', ALLOWED_ORIGINS: `${ORIGIN},https://other-game.example`, SITE_NAME: SITE, ...extra };
}
const EMAIL_ENV = { RESEND_API_KEY: KEY, REPORT_TO: TO, REPORT_FROM: FROM };
const GH = { GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'acme/game' };

function req(method, path, { body, raw, ip = '198.51.100.1', origin = ORIGIN, headers = {} } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined || raw !== undefined) h['Content-Type'] ??= 'application/json';
  return new Request(`https://api.example${path}`, {
    method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(env, method, path, opts = {}, now = T0, fetch = fakeFetch(), timeoutMs) {
  const res = await handle(req(method, path, opts), env, { waitUntil() {} }, now, { fetch, timeoutMs });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, fetch };
}
const send = (env, body = REPORT, o = {}) => call(env, 'POST', '/api/report', { body, ip: o.ip }, o.now ?? T0, o.fetch ?? fakeFetch(), o.timeoutMs);
const rows = (env) => env.DB.rows('SELECT * FROM reports ORDER BY id');

let errSpy;
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); });

// ------------------------------------------------------------------ storage and status

describe('report storage (no secrets configured)', () => {
  it('stores an accepted report and answers {ok:true} without calling anything', async () => {
    const env = makeEnv();
    const r = await send(env);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.fetch.calls).toHaveLength(0);
    const [row] = rows(env);
    expect(row).toMatchObject({ kind: 'bug', message: REPORT.message, contact: null, delivered_email: 0, delivered_issue: 0, created_at: T0 });
    expect(JSON.parse(row.context_json)).toEqual({ ...CONTEXT, fps: 58.4 });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('198.51.100.1');
  });

  it('status is enabled whenever the database answers', async () => {
    expect((await call(makeEnv(), 'GET', '/api/report/status')).body).toEqual({ enabled: true });
    expect((await call(makeEnv({ IP_SALT: '' }), 'GET', '/api/report/status')).body).toEqual({ enabled: false });
    const broken = makeEnv();
    broken.DB = { prepare() { throw new Error('D1 down'); } };
    expect((await call(broken, 'GET', '/api/report/status')).body).toEqual({ enabled: false });
    const r = await call(makeEnv(), 'GET', '/api/report/status');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('answers the CORS preflight and refuses foreign origins, wrong types and big bodies', async () => {
    const pre = await handle(req('OPTIONS', '/api/report'), makeEnv(), {}, T0);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect((await call(makeEnv(), 'POST', '/api/report', { body: REPORT, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(makeEnv(), 'POST', '/api/report', { raw: JSON.stringify(REPORT), headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await call(makeEnv(), 'GET', '/api/report')).status).toBe(405);
    const big = await call(makeEnv(), 'POST', '/api/report', { raw: JSON.stringify({ ...REPORT, pad: 'x'.repeat(REPORT_MAX_BODY) }) });
    expect(big).toMatchObject({ status: 413, body: { error: 'too_large' } });
    // the 6 KB cap is this route's only: a 3 KB report is fine, a 3 KB claim is not
    const mid = await call(makeEnv(), 'POST', '/api/report', { body: { ...REPORT, message: 'Words '.repeat(330) } });
    expect(mid.status).toBe(200);
    expect((await call(makeEnv(), 'POST', '/api/claim', { raw: JSON.stringify({ tag: 'Abc', pad: 'x'.repeat(3000) }) })).status).toBe(413);
  });

  it('needs IP_SALT like the other POSTs', async () => {
    expect(await send(makeEnv({ IP_SALT: '' }))).toMatchObject({ status: 500, body: { error: 'server_misconfigured' } });
  });
});

// ------------------------------------------------------------------ validation

describe('report validation', () => {
  it('honeypot filled: 200 {ok:true}, nothing stored, nothing sent, nothing counted', async () => {
    const env = makeEnv({ ...EMAIL_ENV, ...GH });
    const f = fakeFetch();
    for (const hp of ['x', 'http://spam.example', 1]) {
      expect((await send(env, { ...REPORT, hp }, { fetch: f })).body).toEqual({ ok: true });
    }
    expect(f.calls).toHaveLength(0);
    expect(rows(env)).toHaveLength(0);
    expect(env.DB.rows('SELECT COUNT(*) AS n FROM rate')[0].n).toBe(0);
  });

  it.each([
    [{ kind: 'rant' }, 'kind'],
    [{ kind: undefined }, 'kind'],
    [{ message: 42 }, 'message_type'],
    [{ message: '  short    ' }, 'message_short'],
    [{ message: '123456789' }, 'message_short'],
    [{ message: '1234567890 !!' }, 'message_letters'],
    [{ message: 'ab 12345678' }, 'message_letters'],
    [{ message: 'x'.repeat(MESSAGE_MAX + 1) }, 'message_long'],
    [{ contact: 'c'.repeat(101) }, 'contact_long'],
    [{ contact: { a: 1 } }, 'contact_type'],
  ])('rejects %j (%s), stores nothing', async (patch, reason) => {
    const env = makeEnv();
    expect(await send(env, { ...REPORT, ...patch })).toMatchObject({ status: 400, body: { error: 'invalid_report', reason } });
    expect(rows(env)).toHaveLength(0);
  });

  it('boundaries: exactly 10 and exactly 2000 characters after trimming, 3 letters, 100-char contact', () => {
    expect(validateReport({ ...REPORT, message: '   abc4567890   ' }).ok).toBe(true);
    expect(validateReport({ ...REPORT, message: 'abc' + '.'.repeat(MESSAGE_MAX - 3) }).ok).toBe(true);
    expect(validateReport({ ...REPORT, contact: 'c'.repeat(100) }).ok).toBe(true);
    expect(validateReport({ ...REPORT, contact: null }).report.contact).toBeNull();
    // control characters do not count towards the length
    expect(validateReport({ ...REPORT, message: 'abc\u0000\u0001\u0002\u0003\u0004\u0005\u0006' }).reason).toBe('message_short');
    expect(validateReport({ ...REPORT, message: 'Ünïcödé letters count' }).ok).toBe(true);
  });

  it('strips control, bidi and zero-width characters; keeps newlines in the message only', () => {
    const v = validateReport({ ...REPORT, message: 'Line one\r\nLine\u0007 two\u202E evil\u200B\n\n\n\n\nend', contact: 'me\nnow\u0000' });
    expect(v.report.message).toBe('Line one\nLine two evil\n\n\nend');
    expect(v.report.contact).toBe('me now');
    expect(cleanText('a\u2028b\u2066c')).toBe('abc');
  });

  it('context is whitelisted, typed and capped; bad fields are dropped, not fatal', () => {
    const v = validateReport({
      ...REPORT,
      context: {
        version: '0.2.0<script>', device: 'toaster', tier: 'high', round: 3.5, zone: 'diner|x', weapon: 'pump',
        fps: Infinity, viewport: '1x1;drop', ua: `UA\n${'u'.repeat(400)}`, where: 'end', secret: 'nope', ip: '1.2.3.4',
      },
    });
    expect(v.ok).toBe(true);
    expect(v.report.context).toEqual({ tier: 'high', weapon: 'pump', ua: `UA ${'u'.repeat(197)}`, where: 'end' });
    expect(validateReport({ ...REPORT, context: 'nope' }).report.context).toEqual({});
    expect(validateReport({ ...REPORT, context: undefined }).report.context).toEqual({});
  });
});

// ------------------------------------------------------------------ limits and duplicates

describe('report rate limits and duplicates', () => {
  const msg = (i) => ({ ...REPORT, message: `Report number ${i} about the pump shotgun.` });

  it('3 per IP per hour, then 429 with Retry-After; another IP is unaffected', async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) expect((await send(env, msg(i), { now: T0 + i })).status).toBe(200);
    const r = await send(env, msg(3), { now: T0 + 10 });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(r.body.scope).toBeUndefined();
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await send(env, msg(4), { ip: '203.0.113.9' })).status).toBe(200);
    expect(rows(env)).toHaveLength(4);
  });

  it('IPv6 counts by /64', async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) expect((await send(env, msg(i), { ip: `2001:db8:1:2::${i + 1}` })).status).toBe(200);
    expect((await send(env, msg(9), { ip: '2001:db8:1:2:ffff::1' })).status).toBe(429);
    expect((await send(env, msg(9), { ip: '2001:db8:1:3::1' })).status).toBe(200);
  });

  it('10 per IP per day', async () => {
    const env = makeEnv();
    const day0 = Date.UTC(2026, 10, 11, 0, 5);
    for (let i = 0; i < 10; i++) expect((await send(env, msg(i), { now: day0 + i * 2 * HOUR })).status).toBe(200);
    const r = await send(env, msg(10), { now: day0 + 21 * HOUR });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect((await send(env, msg(11), { now: day0 + DAY + HOUR })).status).toBe(200);
  });

  it('200 per day across everyone: 429 with scope global and a plain reason', async () => {
    const env = makeEnv();
    for (let i = 0; i < 200; i++) {
      const r = await send(env, msg(i), { ip: `10.0.${i >> 8}.${i & 255}` });
      expect(r.status, `report ${i}`).toBe(200);
    }
    const r = await send(env, msg(999), { ip: '192.0.2.200' });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited', scope: 'global' } });
    expect(r.body.reason).toMatch(/try again tomorrow/i);
    expect(rows(env)).toHaveLength(200);
  });

  it('the same message from the same IP within 24 h is accepted once', async () => {
    const env = makeEnv({ ...EMAIL_ENV });
    const f = fakeFetch();
    expect((await send(env, REPORT, { fetch: f })).body).toEqual({ ok: true });
    const again = { ...REPORT, message: `  ${REPORT.message.toUpperCase().replace(/ /g, '   ')} ` };
    expect((await send(env, again, { fetch: f, now: T0 + 23 * HOUR })).body).toEqual({ ok: true, duplicate: true });
    expect(rows(env)).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    // a duplicate does not use up the hourly allowance
    expect((await send(env, msg(1), { now: T0 + 23 * HOUR })).status).toBe(200);
    // another IP, or after 24 h, is a new report
    expect((await send(env, REPORT, { ip: '203.0.113.5' })).body).toEqual({ ok: true });
    expect((await send(env, REPORT, { now: T0 + DAY + 1 })).body).toEqual({ ok: true });
    expect(rows(env)).toHaveLength(4);
  });
});

// ------------------------------------------------------------------ email

describe('email delivery (Resend)', () => {
  it('sends one plain-text email with the documented shape when all three secrets are set', async () => {
    const env = makeEnv(EMAIL_ENV);
    const f = fakeFetch(() => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    const r = await send(env, { ...REPORT, contact: 'player@example.com' }, { fetch: f });
    expect(r.body).toEqual({ ok: true });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.url).toBe(RESEND_URL);
    expect(c.init.method).toBe('POST');
    expect(c.init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'graveyard-shift-feedback',
    });
    expect(c.init.headers['Idempotency-Key']).toMatch(/^graveyard-shift-report-\d+$/);
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(c.body).sort()).toEqual(['from', 'reply_to', 'subject', 'text', 'to']);
    expect(c.body).toMatchObject({ from: FROM, to: [TO], reply_to: 'player@example.com', subject: '[Graveyard Shift] Bug: The diner door would not open after I bought it.' });
    expect(c.body.html).toBeUndefined();
    const text = c.body.text;
    expect(text.split('\n')[0]).toBe(EMAIL_NOTICE);
    expect(text).toContain(REPORT.message);
    expect(text).toContain('Contact (as typed): player@example.com');
    expect(text).toContain('Game version: 0.2.0');
    expect(text).toContain('Frame rate: 58.4 fps');
    expect(text).toContain('Sent from: Pause menu');
    expect(text).toContain('Browser: Mozilla/5.0 (Macintosh) Chrome/140');
    expect(text).toContain('Sent at: 2026-11-11 12:00 UTC');
    expect(text).toMatch(/Report: #\d+/);
    expect(text).not.toMatch(/198\.51|ip_hash/);
    expect(rows(env)[0].delivered_email).toBe(1);
    // never logs the key or the recipient
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/re_test|example\.com/);
  });

  it('subject: kind word, first 60 characters on one line, no CR/LF; Idea and Feedback', () => {
    const base = { contact: null, context: {} };
    const long = `Line one\r\nBcc: victim@example.com ${'z'.repeat(80)}`;
    const v = validateReport({ ...REPORT, ...base, kind: 'idea', message: long }).report;
    const s = emailSubject(v);
    expect(s).not.toMatch(/[\r\n]/);
    expect(s.startsWith('[Graveyard Shift] Idea: Line one Bcc: victim@example.com zzz')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect([...s.slice('[Graveyard Shift] Idea: '.length)].length).toBe(61);
    expect(emailSubject({ ...v, kind: 'other', message: 'Short note here' })).toBe('[Graveyard Shift] Feedback: Short note here');
  });

  it.each([
    ['player@example.com', 'player@example.com'],
    ['first.last+tag@sub.example.com', 'first.last+tag@sub.example.com'],
    ['Discord: Ghoul#1234', null],
    ['a@example.com, b@example.com', null],
    ['Name <a@example.com>', null],
    ['a@example.com\r\nBcc: b@example.com', null],
    ['no-at-sign.example.com', null],
    ['a@b', null],
    ['a..b@example.com', null],
    ['', null],
    [null, null],
  ])('reply_to for %j is %j', (contact, want) => {
    expect(replyTo(contact)).toBe(want);
  });

  it('a contact that is not an email goes in the text only, never in reply_to', async () => {
    const env = makeEnv(EMAIL_ENV);
    const f = fakeFetch();
    await send(env, { ...REPORT, contact: 'Discord: Ghoul#1234' }, { fetch: f });
    expect(f.calls[0].body.reply_to).toBeUndefined();
    expect(f.calls[0].body.text).toContain('Contact (as typed): Discord: Ghoul#1234');
  });

  it.each([
    ['only the key', { RESEND_API_KEY: KEY }],
    ['key and recipient', { RESEND_API_KEY: KEY, REPORT_TO: TO }],
    ['recipient and sender', { REPORT_TO: TO, REPORT_FROM: FROM }],
  ])('secrets partly set (%s): email skipped, report stored', async (_n, extra) => {
    const env = makeEnv(extra);
    const r = await send(env);
    expect(r.body).toEqual({ ok: true });
    expect(r.fetch.calls).toHaveLength(0);
    expect(rows(env)[0].delivered_email).toBe(0);
  });

  it.each([[500], [401], [422], ['throw'], ['timeout']])('failure (%s): stored with delivered_email = 0, client still told ok', async (kind) => {
    const env = makeEnv(EMAIL_ENV);
    const f = fakeFetch((url, init) => {
      if (kind === 'throw') throw new TypeError('network');
      if (kind === 'timeout') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      return new Response(JSON.stringify({ message: `secret detail ${KEY}` }), { status: kind });
    });
    const r = await send(env, REPORT, { fetch: f, timeoutMs: 20 });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(rows(env)[0].delivered_email).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain('secret detail');
    expect(errSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/re_test|example\.com|secret detail/);
  });

  it('the scheduled handler retries undelivered emails from the last 48 h (at most 20) and prunes after 180 days', async () => {
    const env = makeEnv(EMAIL_ENV);
    const down = fakeFetch(() => new Response('{}', { status: 503 }));
    // 22 recent failures, one 3 days old, one 200 days old
    for (let i = 0; i < 22; i++) await send(env, { ...REPORT, message: `Recent failure number ${i} here.` }, { fetch: down, ip: `10.1.0.${i}`, now: T0 - HOUR });
    await send(env, { ...REPORT, message: 'An older failure from days ago.' }, { fetch: down, now: T0 - 3 * DAY });
    env.DB.sqlite.prepare("INSERT INTO reports (created_at, kind, message, context_json, ip_hash) VALUES (?, 'bug', 'ancient report text', '{}', 'h')").run(T0 - 200 * DAY);
    expect(rows(env).filter((r) => r.delivered_email === 0)).toHaveLength(24);

    const up = fakeFetch(() => new Response('{"id":"x"}', { status: 200 }));
    const pending = [];
    await worker.scheduled({ scheduledTime: T0 }, env, { waitUntil: (p) => pending.push(p) }, { fetch: up });
    await Promise.all(pending);
    expect(up.calls).toHaveLength(20);
    expect(up.calls.every((c) => c.url === RESEND_URL && c.init.headers['Idempotency-Key'].startsWith('graveyard-shift-report-'))).toBe(true);
    const after = rows(env);
    expect(after.some((r) => r.message === 'ancient report text')).toBe(false);
    expect(after.filter((r) => r.delivered_email === 1)).toHaveLength(20);
    expect(after.find((r) => r.message.startsWith('An older')).delivered_email).toBe(0);

    // the next run picks up the remaining two recent ones only
    const up2 = fakeFetch(() => new Response('{}', { status: 200 }));
    const p2 = [];
    await worker.scheduled({ scheduledTime: T0 + HOUR }, env, { waitUntil: (p) => p2.push(p) }, { fetch: up2 });
    await Promise.all(p2);
    expect(up2.calls).toHaveLength(2);
  });

  it('the scheduled handler sends nothing when email is not configured', async () => {
    const env = makeEnv();
    await send(env);
    const f = fakeFetch();
    const pending = [];
    await worker.scheduled({ scheduledTime: T0 + HOUR }, env, { waitUntil: (p) => pending.push(p) }, { fetch: f });
    await Promise.all(pending);
    expect(f.calls).toHaveLength(0);
    expect(rows(env)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ GitHub

describe('GitHub delivery', () => {
  it('creates one labelled issue with the notice, the fenced message and the context table', async () => {
    const env = makeEnv({ ...GH });
    const f = fakeFetch();
    const r = await send(env, { ...REPORT, contact: 'Ghoul on Discord' }, { fetch: f });
    expect(r.body).toEqual({ ok: true }); // no URL unless REPORT_RETURN_URL=1
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.url).toBe(GITHUB_ISSUES_URL);
    expect(githubIssuesUrl('acme/game')).toBe(GITHUB_ISSUES_URL);
    expect(c.init.method).toBe('POST');
    expect(c.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'graveyard-shift-feedback',
    });
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.body.labels).toEqual(['website-feedback', 'bug']);
    expect(c.body.title).toBe('[Website] Bug: The diner door would not open after I bought it.');
    const body = c.body.body;
    expect(body.split('\n')[0]).toBe(ISSUE_NOTICE);
    expect(ISSUE_NOTICE).toBe('> Sent from the in-game "Report a problem" form on game.example — not filed by a GitHub user.');
    expect(body).toContain(`\`\`\`text\n${REPORT.message}\n\`\`\``);
    expect(body).toContain('| Game version | `0.2.0` |');
    expect(body).toContain('| Frame rate | `58.4 fps` |');
    expect(body).toContain('| Sent at | `2026-11-11 12:00 UTC` |');
    expect(body).toContain('```text\nGhoul on Discord\n```');
    expect(body).not.toMatch(/198\.51|[0-9a-f]{64}/);
    expect(rows(env)[0].delivered_issue).toBe(1);
  });

  it('needs both GITHUB_TOKEN and a well-formed GITHUB_REPO; otherwise no issue is attempted', async () => {
    for (const extra of [{ GITHUB_TOKEN: TOKEN }, { GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'not a repo' }, { GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'a/b/c' }, { GITHUB_REPO: 'acme/game' }]) {
      const env = makeEnv(extra);
      const f = fakeFetch();
      expect((await send(env, REPORT, { fetch: f })).body).toEqual({ ok: true });
      expect(f.calls).toHaveLength(0);
      expect(rows(env)[0].delivered_issue).toBe(0);
    }
    expect(githubRepo({ GITHUB_REPO: ' acme/game ' })).toBe('acme/game');
    expect(githubRepo({})).toBeNull();
  });

  it('SITE_NAME names the site in the issue and email text; unset or odd values fall back to a neutral phrase', () => {
    expect(siteName({ SITE_NAME: 'game.example' })).toBe('game.example');
    for (const v of [undefined, '', 'evil <b>', 'a b', 'x'.repeat(101)]) expect(siteName({ SITE_NAME: v })).toBe('the game site');
    const r = validateReport(REPORT).report;
    expect(issueBody(r, { id: 1, now: T0 }).split('\n')[0]).toBe('> Sent from the in-game "Report a problem" form on the game site — not filed by a GitHub user.');
    expect(emailText(r, { id: 1, now: T0 }).split('\n')[0]).toBe('Sent from the in-game Report a problem form on the game site');
    expect(emailText(r, { id: 1, now: T0, site: SITE }).split('\n')[0]).toBe(EMAIL_NOTICE);
  });

  it('labels: idea -> enhancement, other -> website-feedback only; titles say Idea / Feedback', () => {
    expect(issueLabels('idea')).toEqual(['website-feedback', 'enhancement']);
    expect(issueLabels('other')).toEqual(['website-feedback']);
    const v = (kind) => validateReport({ ...REPORT, kind }).report;
    expect(issueTitle(v('idea')).startsWith('[Website] Idea: ')).toBe(true);
    expect(issueTitle(v('other')).startsWith('[Website] Feedback: ')).toBe(true);
  });

  it('REPORT_RETURN_URL=1 returns the issue link', async () => {
    const env = makeEnv({ ...GH, REPORT_RETURN_URL: '1' });
    expect((await send(env)).body).toEqual({ ok: true, url: 'https://github.com/x/y/issues/9', number: 9 });
  });

  it('neutralises injection: fences, mentions, references, closing keywords, HTML, images, links', () => {
    const evil = [
      'Fixes #2 and closes #3, ping @someone and @org/team, see GH-5 and owner/repo#7',
      '```',
      '</details><img src=x onerror=alert(1)> ![x](https://evil.example/p.png) [click](https://evil.example)',
      '<script>alert(1)</script> ````` five ticks',
      '```',
    ].join('\n');
    const v = validateReport({ ...REPORT, message: evil, contact: '@admin `x` </details>', context: { ...CONTEXT, ua: 'UA ``` @bot #4' } }).report;
    const body = issueBody(v, { id: 12, now: T0 });
    // the message sits in one fence longer than any backtick run in it, and nothing escapes it
    const fence = fenceFor(evil);
    expect(fence).toBe('``````');
    expect(body).toContain(`${fence}text\n${evil}\n${fence}`);
    // outside the fences and the fixed notice line, only code spans of whitelisted values remain
    const outside = body.replace(/(`{3,})text\n[\s\S]*?\n\1(?=\n|$)/g, '').replace(issueNotice(), '').replace(/`[^`\n]*`/g, '');
    expect(outside).not.toMatch(/@\w|#\d|<|>|!\[|\]\(|Fixes|javascript/i);
    expect(outside.split('\n').filter((l) => l.startsWith('```'))).toHaveLength(0);
    // every user field is inside a fence
    expect(body).toContain('```text\n@admin `x` </details>\n```');
    expect(body).toContain('````text\nUA ``` @bot #4\n````');
    // the title cannot mention, reference or mark up
    const t = issueTitle(v);
    expect(t).not.toMatch(/@[A-Za-z]|#\d|GH-\d|[<>`]/);
    expect(t.length).toBeLessThan(100);
    expect(safeTitleText('@a #1 gh-2 <b>`c`')).toBe('@\u2060a #\u20601 gh\u2060-2 bc');
  });

  it('a body over many backtick runs still closes: fence longer than the longest run', () => {
    expect(fenceFor('no ticks')).toBe('```');
    expect(fenceFor('a ` b `` c')).toBe('```');
    expect(fenceFor('````')).toBe('`````');
  });

  it.each([[401], [403], [500], ['timeout']])('GitHub %s: report stored, client told ok, nothing leaked', async (kind) => {
    const env = makeEnv({ ...GH, REPORT_RETURN_URL: '1' });
    const f = fakeFetch((url, init) => {
      if (kind === 'timeout') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      return new Response(JSON.stringify({ message: 'Bad credentials', token: TOKEN }), { status: kind });
    });
    const r = await send(env, REPORT, { fetch: f, timeoutMs: 20 });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.body.url).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/Bad credentials|ghp_/);
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/Bad credentials|ghp_/);
    expect(rows(env)[0].delivered_issue).toBe(0);
  });

  it('both channels together: one email and one issue per report', async () => {
    const env = makeEnv({ ...EMAIL_ENV, ...GH });
    const f = fakeFetch();
    await send(env, REPORT, { fetch: f });
    expect(f.to(RESEND_URL)).toHaveLength(1);
    expect(f.to(GITHUB_ISSUES_URL)).toHaveLength(1);
    expect(rows(env)[0]).toMatchObject({ delivered_email: 1, delivered_issue: 1 });
  });
});

// ------------------------------------------------------------------ migration

describe('migrations/0002_reports.sql', () => {
  const sql = (p) => readFileSync(new URL(`../server/${p}`, import.meta.url), 'utf8');
  it('applies cleanly (twice) on top of the schema as deployed before reports, and matches schema.sql', () => {
    const before = sql('schema.sql').split('-- Player reports from the in-game')[0];
    const db = new DatabaseSync(':memory:');
    db.exec(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'reports'").all()).toHaveLength(0);
    db.exec(sql('migrations/0002_reports.sql'));
    db.exec(sql('migrations/0002_reports.sql'));
    const cols = db.prepare('PRAGMA table_info(reports)').all().map((c) => c.name);
    expect(cols).toEqual(['id', 'created_at', 'kind', 'message', 'contact', 'context_json', 'ip_hash', 'delivered_email', 'delivered_issue']);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'reports_created'").all()).toHaveLength(1);
    const fresh = new DatabaseSync(':memory:');
    fresh.exec(sql('schema.sql'));
    expect(fresh.prepare('PRAGMA table_info(reports)').all()).toEqual(db.prepare('PRAGMA table_info(reports)').all());
  });
});

// ------------------------------------------------------------------ formatting helpers

describe('email text', () => {
  it('is plain text with every context field and the report id', () => {
    const v = validateReport({ ...REPORT, contact: null }).report;
    const t = emailText(v, { id: 41, now: T0 });
    expect(t).not.toMatch(/<[a-z]/i);
    expect(t).toContain('Report: #41');
    expect(t).toContain('Contact (as typed): (none)');
    for (const label of ['Game version', 'Device', 'Graphics tier', 'Round', 'Area', 'Weapon', 'Frame rate', 'Screen size', 'Sent from', 'Browser']) {
      expect(t).toContain(`  ${label}: `);
    }
  });
});

// ------------------------------------------------------------------ client (src/net/report.js)

import {
  reportMode, checkReport, gatherContext, createReportApi, createReportClient, createMockReportApi, reportErrorText,
  fieldErrorText, payloadBytes, SENT_TEXT, BODY_MAX,
} from '../src/net/report.js';
import { cleanContext } from '../server/src/report.js';
import { API_BASE, configure } from '../src/net/board.js';

const loc = (origin, search = '') => ({ origin, search });

// Example deployment settings (a real build gets them from GS_API_BASE / GS_ALLOWED_ORIGINS).
beforeEach(() => { configure({ apiBase: 'https://api.example', origins: ['https://game.example', 'https://other-game.example'] }); });
afterAll(() => { configure({}); });

describe('client: reportMode gates on the configured origins', () => {
  it.each([
    ['https://game.example', '', 'live'],
    ['https://other-game.example', '', 'live'],
    ['null', '', 'off'], // file:// and sandboxed frames
    ['https://sandbox.example', '', 'off'],
    ['http://localhost:5173', '', 'off'],
    ['http://game.example', '', 'off'],
    ['https://game.example.evil.com', '', 'off'],
    ['null', '?report=mock', 'mock'],
    ['https://game.example', '?report=off', 'off'],
    ['null', '?report=yes', 'off'],
  ])('%s%s -> %s', (o, q, want) => { expect(reportMode(loc(o, q))).toBe(want); });
  it('an unconfigured build is off everywhere and never fetches', async () => {
    configure({});
    expect(reportMode(loc('https://game.example'))).toBe('off');
    const f = vi.fn();
    const api = createReportApi({ mode: 'live', fetch: f });
    expect(await createReportClient(api).enabled()).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('missing or throwing location is off', () => {
    expect(reportMode(undefined)).toBe('off');
    expect(reportMode({ get origin() { throw new Error('x'); }, search: '' })).toBe('off');
  });
});

describe('client: checkReport mirrors the server', () => {
  const corpus = [
    'short', 'just right!', '1234567890 !!', '  abc4567890  ', 'x'.repeat(2000), 'x'.repeat(2001), 'Ünïcödé text here',
    'abc\u0000\u0001\u0002\u0003\u0004\u0005\u0006', 'Line one\r\nline two', '‮‮‮abcdefghij',
  ];
  it.each(corpus.map((m) => [m.slice(0, 30), m]))('%j agrees with validateReport', (_n, message) => {
    const c = checkReport({ kind: 'bug', message, contact: '' });
    const s = validateReport({ kind: 'bug', message, contact: '' });
    expect(c.ok).toBe(s.ok);
    if (!c.ok) expect(c.reason).toBe(s.reason);
    else expect(c.message).toBe(s.report.message);
  });
  it('contact and kind', () => {
    expect(checkReport({ kind: 'idea', message: 'A fine idea for you', contact: 'c'.repeat(101) })).toMatchObject({ ok: false, field: 'contact' });
    expect(checkReport({ kind: 'nope', message: 'A fine idea for you' })).toMatchObject({ ok: false, field: 'kind' });
  });
});

describe('client: gatherContext', () => {
  const win = { innerWidth: 844, innerHeight: 390, devicePixelRatio: 3, navigator: { userAgent: 'Test UA/1.0' }, __stats: () => ({ fps: 59.96, zone: 'forecourt', weapon: 'm1911', tier: 'mobile', round: 4 }) };
  it('reads what is there, the server keeps all of it', () => {
    const G = { device: { phone: true, touch: true }, quality: { tier: 'mobile' }, game: { round: 4 }, level: { zone: 'forecourt' } };
    const c = gatherContext(G, 'pause', win);
    expect(c).toEqual({ version: '0.2.0', device: 'phone', where: 'pause', tier: 'mobile', round: 4, zone: 'forecourt', weapon: 'm1911', fps: 60, viewport: '844x390@3x', ua: 'Test UA/1.0' });
    expect(cleanContext(c)).toEqual(c);
    expect(Object.keys(c).sort()).toEqual(['device', 'fps', 'round', 'tier', 'ua', 'version', 'viewport', 'weapon', 'where', 'zone']);
  });
  it('never throws on an empty or hostile G or window', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
    expect(() => gatherContext({}, 'title', {})).not.toThrow();
    expect(() => gatherContext(hostile, 'end', hostile)).not.toThrow();
    expect(gatherContext(null, 'end', null)).toMatchObject({ version: '0.2.0', where: 'end' });
    expect(gatherContext({ level: { zone: '<img>' } }, 'title', {}).zone).toBeUndefined();
  });
});

describe('client: api and status cache', () => {
  it('off mode never calls fetch', async () => {
    const f = vi.fn();
    const api = createReportApi({ mode: 'off', fetch: f });
    expect(await createReportClient(api).enabled()).toBe(false);
    expect(await api.send({})).toEqual({ ok: false, error: 'disabled' });
    expect(f).not.toHaveBeenCalled();
  });
  it('live: request shapes (no credentials, JSON only on the POST)', async () => {
    const f = fakeFetch((url) => new Response(JSON.stringify(url.endsWith('status') ? { enabled: true } : { ok: true }), { status: 200 }));
    const api = createReportApi({ mode: 'live', fetch: f });
    expect(await api.status()).toEqual({ ok: true, data: { enabled: true } });
    expect(await api.send({ kind: 'bug' })).toEqual({ ok: true, data: { ok: true } });
    expect(f.calls[0].url).toBe(`${API_BASE}/api/report/status`);
    expect(API_BASE).toBe('https://api.example');
    expect(f.calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit' });
    expect(f.calls[0].init.headers).toBeUndefined();
    expect(f.calls[1].url).toBe(`${API_BASE}/api/report`);
    expect(f.calls[1].init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } });
    expect(f.calls[1].body).toEqual({ kind: 'bug' });
  });
  it('maps errors; 5xx, network and timeouts are offline/server', async () => {
    const answer = (status, body) => createReportApi({ mode: 'live', fetch: async () => new Response(JSON.stringify(body), { status }) }).send({});
    expect(await answer(429, { error: 'rate_limited', retryAfter: 60, scope: 'global', reason: 'x' })).toEqual({ ok: false, error: 'rate_limited', retryAfter: 60, scope: 'global', reason: 'x' });
    expect(await answer(400, { error: 'invalid_report', reason: 'message_short' })).toEqual({ ok: false, error: 'invalid_report', reason: 'message_short' });
    expect(await answer(503, { error: 'x' })).toEqual({ ok: false, error: 'server' });
    expect(await createReportApi({ mode: 'live', fetch: async () => { throw new TypeError('net'); } }).send({})).toEqual({ ok: false, error: 'offline' });
    const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    expect(await createReportApi({ mode: 'live', fetch: hang, timeoutMs: 10 }).send({})).toEqual({ ok: false, error: 'offline' });
  });
  it('status is asked once per session; any failure means hidden', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    const client = createReportClient(createReportApi({ mode: 'live', fetch: f }));
    expect(await client.enabled()).toBe(true);
    expect(await client.enabled()).toBe(true);
    expect(f.calls).toHaveLength(1);
    for (const respond of [() => new Response('{}', { status: 500 }), () => new Response('{"enabled":false}'), () => { throw new Error('x'); }, () => new Response('not json')]) {
      expect(await createReportClient(createReportApi({ mode: 'live', fetch: fakeFetch(respond) })).enabled()).toBe(false);
    }
  });
  it('mock: enabled, sends, and the state triggers', async () => {
    const api = createMockReportApi({ delay: 0 });
    expect(await createReportClient(api).enabled()).toBe(true);
    const p = { kind: 'bug', message: 'Something broke in the diner.', contact: '', context: {} };
    expect(await api.send(p)).toEqual({ ok: true, data: { ok: true } });
    expect(api.sent).toHaveLength(1);
    expect(await api.send({ ...p, message: 'please #ratelimit me now' })).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(await api.send({ ...p, message: 'please #offline me now' })).toEqual({ ok: false, error: 'offline' });
  });
});

describe('client: copy', () => {
  it('matches the expected layout', () => {
    expect(SENT_TEXT).toBe('Thanks — report sent.');
    expect(reportErrorText({ error: 'rate_limited' })).toBe('You’ve sent a few already. Try again later.');
    expect(reportErrorText({ error: 'rate_limited', scope: 'global' })).toBe('You’ve sent a few already. Try again later.');
    for (const e of ['offline', 'server', 'disabled', 'whatever']) expect(reportErrorText({ error: e })).toBe('Couldn’t send it. Check your connection and try again.');
    expect(fieldErrorText('message_short')).toBe('Write at least 10 characters.');
  });
  it('a 2000-character CJK message with full context is over the 6 KB body cap and is caught before sending', () => {
    const big = { kind: 'bug', message: '\u6F22'.repeat(2000), contact: '', context: { ua: 'u'.repeat(200), viewport: '1920x1080' } };
    expect(payloadBytes(big)).toBeGreaterThan(BODY_MAX);
    expect(payloadBytes({ kind: 'bug', message: 'x'.repeat(2000), contact: 'c'.repeat(100), context: { ua: 'u'.repeat(200) } })).toBeLessThan(BODY_MAX);
  });
});
