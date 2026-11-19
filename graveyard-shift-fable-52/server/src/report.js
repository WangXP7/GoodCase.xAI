// "Report a problem": POST /api/report and GET /api/report/status (routed from index.js).
//
// Every accepted report is stored in D1 (`reports`). Delivery channels switch on when configured:
//   email   RESEND_API_KEY + REPORT_TO + REPORT_FROM all set -> one plain-text email per report (Resend)
//   GitHub  GITHUB_TOKEN + GITHUB_REPO ("owner/name") set -> one issue in that repo labelled website-feedback
// SITE_NAME (optional) names the game's site in the email and issue text.
// A failed delivery never fails the request: the report is saved, the client gets {ok:true}, and the
// scheduled handler retries undelivered emails from the last 48 h.
//
// Abuse rules: honeypot field `hp`, strict validation, 3/hour and 10/day per IP (IPv6 /64), 200/day for
// everyone, the same message from the same IP within 24 h is accepted once. User text never reaches an
// email header except the cleaned subject, and on GitHub it sits only inside code fences (or, in the
// title, with mentions and references broken), so a report cannot ping anyone, link issues or render HTML.
//
// This module returns plain { status, body } results; index.js turns them into responses.
import { sha256Hex } from './crypto.js';
import { hit, peek } from './rate.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const REPORT_MAX_BODY = 6 * 1024;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
export const CONTACT_MAX = 100;
export const UA_MAX = 200;
export const DUPLICATE_MS = DAY;
export const REPORT_RETENTION_MS = 180 * DAY;
export const EMAIL_RETRY_WINDOW_MS = 2 * DAY;
export const EMAIL_RETRY_MAX = 20;
export const DELIVERY_TIMEOUT_MS = 8000;

export const RESEND_URL = 'https://api.resend.com/emails';
export const USER_AGENT = 'graveyard-shift-feedback';
export const DEFAULT_SITE = 'the game site';

// "owner/name", letters, digits, . _ - only; anything else is treated as unset.
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const githubRepo = (env) => {
  const r = String((env && env.GITHUB_REPO) || '').trim();
  return REPO_RE.test(r) ? r : null;
};
export const githubIssuesUrl = (repo) => `https://api.github.com/repos/${repo}/issues`;
// The site named in the email and issue text: a host-name-like string, else a neutral default.
export const siteName = (env) => {
  const s = String((env && env.SITE_NAME) || '').trim();
  return /^[A-Za-z0-9.-]{1,100}$/.test(s) ? s : DEFAULT_SITE;
};

export const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Feedback' };
const KIND_LABEL = { bug: 'bug', idea: 'enhancement' };

// ---------------------------------------------------------------- cleaning and validation

// C0 controls except \n (and \t, turned into spaces), DEL, C1 controls, bidi overrides and isolates,
// zero-width and BOM characters, line/paragraph separators.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

export function cleanText(s, { multiline = false } = {}) {
  let t = String(s).normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  t = t.replace(CONTROL, '');
  if (!multiline) t = t.replace(/\n+/g, ' ');
  else t = t.replace(/[  ]+$/gm, '').replace(/\n{4,}/g, '\n\n\n');
  return t.trim();
}

const letters = (s) => (s.match(/\p{L}/gu) || []).length;

// Context: whitelisted, typed, length-capped. A bad field is dropped, never fatal (a client bug must not
// block a report); unknown fields are ignored.
const CTX_RULES = {
  version: (v) => (typeof v === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(v) ? v : null),
  device: (v) => (['desktop', 'phone', 'tablet'].includes(v) ? v : null),
  tier: (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(v) ? v : null),
  round: (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : null),
  zone: (v) => (typeof v === 'string' && /^[A-Za-z0-9 _-]{1,32}$/.test(v) ? v : null),
  weapon: (v) => (typeof v === 'string' && /^[A-Za-z0-9 ._-]{1,32}$/.test(v) ? v : null),
  fps: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : null),
  viewport: (v) => (typeof v === 'string' && /^\d{1,5}x\d{1,5}(@\d{1,2}(\.\d{1,2})?x)?$/.test(v) ? v : null),
  ua: (v) => {
    if (typeof v !== 'string') return null;
    const t = cleanText(v).slice(0, UA_MAX);
    return t || null;
  },
  where: (v) => (['title', 'pause', 'end'].includes(v) ? v : null),
};
export const CONTEXT_FIELDS = Object.keys(CTX_RULES);

export function cleanContext(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of CONTEXT_FIELDS) {
    if (!Object.hasOwn(raw, k)) continue;
    const v = CTX_RULES[k](raw[k]);
    if (v !== null) out[k] = v;
  }
  return out;
}

// -> { ok:true, report:{ kind, message, contact, context } } | { ok:false, reason }
export function validateReport(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body' };
  if (!Object.hasOwn(KINDS, body.kind)) return { ok: false, reason: 'kind' };
  if (typeof body.message !== 'string') return { ok: false, reason: 'message_type' };
  const message = cleanText(body.message, { multiline: true });
  if (message.length < MESSAGE_MIN) return { ok: false, reason: 'message_short' };
  if (message.length > MESSAGE_MAX) return { ok: false, reason: 'message_long' };
  if (letters(message) < 3) return { ok: false, reason: 'message_letters' };
  let contact = null;
  if (body.contact !== undefined && body.contact !== null && body.contact !== '') {
    if (typeof body.contact !== 'string') return { ok: false, reason: 'contact_type' };
    const c = cleanText(body.contact);
    if (c.length > CONTACT_MAX) return { ok: false, reason: 'contact_long' };
    contact = c || null;
  }
  return { ok: true, report: { kind: body.kind, message, contact, context: cleanContext(body.context) } };
}

// Lowercase, whitespace collapsed: what "the same message" means for duplicate suppression.
export const normaliseMessage = (m) => String(m).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- formatting shared by both channels

const CONTEXT_LABELS = [
  ['version', 'Game version'], ['device', 'Device'], ['tier', 'Graphics tier'], ['round', 'Round'],
  ['zone', 'Area'], ['weapon', 'Weapon'], ['fps', 'Frame rate'], ['viewport', 'Screen size'], ['where', 'Sent from'],
];
const WHERE = { title: 'Title screen', pause: 'Pause menu', end: 'End screen' };
const ctxValue = (k, v) => (k === 'fps' ? `${v} fps` : k === 'where' ? WHERE[v] : String(v));

export const utcStamp = (now) => `${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// The first `n` characters (code points) of the message on one line, for a title or subject.
function headline(message, n = 60) {
  const one = cleanText(message);
  const cps = [...one];
  return cps.length > n ? `${cps.slice(0, n).join('').trimEnd()}…` : one;
}

// ---------------------------------------------------------------- GitHub issue

// A backtick fence longer than any backtick run in the text, so the text can never close it.
export function fenceFor(text) {
  let longest = 0;
  for (const m of String(text).matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}
const fenced = (text, lang = 'text') => { const f = fenceFor(text); return `${f}${lang}\n${text}\n${f}`; };

// Title text is rendered by GitHub with inline Markdown: break mentions (@x), references (#1, GH-1) and
// code/HTML marks with a word joiner or by removing them.
export function safeTitleText(s) {
  return String(s)
    .replace(/[`<>]/g, '')
    .replace(/@/g, '@\u2060')
    .replace(/#(?=\d)/g, '#\u2060')
    .replace(/\b(GH)-(?=\d)/gi, '$1\u2060-');
}

export const issueTitle = (r) => `[Website] ${KINDS[r.kind]}: ${safeTitleText(headline(r.message))}`;
export const issueLabels = (kind) => (KIND_LABEL[kind] ? ['website-feedback', KIND_LABEL[kind]] : ['website-feedback']);

export const issueNotice = (site = DEFAULT_SITE) => `> Sent from the in-game "Report a problem" form on ${site} — not filed by a GitHub user.`;

export function issueBody(r, { id, now, site = DEFAULT_SITE }) {
  const rows = [];
  for (const [k, label] of CONTEXT_LABELS) {
    // Every value here matched a strict pattern without backticks or pipes; code spans keep _ and * literal.
    rows.push(`| ${label} | ${r.context[k] !== undefined ? `\`${ctxValue(k, r.context[k])}\`` : '—'} |`);
  }
  rows.push(`| Report id | \`${id}\` |`, `| Sent at | \`${utcStamp(now)}\` |`);
  const parts = [
    issueNotice(site),
    '',
    `**${KINDS[r.kind]}**`,
    '',
    fenced(r.message),
    '',
    '| Context | Value |',
    '| --- | --- |',
    ...rows,
    '',
    '**Browser**',
    '',
    fenced(r.context.ua || '—'),
    '',
    '**Contact (as typed by the reporter, may be blank)**',
    '',
    fenced(r.contact || '—'),
  ];
  return parts.join('\n');
}

// ---------------------------------------------------------------- email

export const emailSubject = (r) => cleanText(`[Graveyard Shift] ${KINDS[r.kind]}: ${headline(r.message)}`).replace(/[\r\n]/g, ' ');

export const emailNotice = (site = DEFAULT_SITE) => `Sent from the in-game Report a problem form on ${site}`;

export function emailText(r, { id, now, site = DEFAULT_SITE }) {
  const lines = [
    emailNotice(site),
    '',
    `Kind: ${KINDS[r.kind]}`,
    `Report: #${id}`,
    `Sent at: ${utcStamp(now)}`,
    '',
    'Message:',
    r.message,
    '',
    `Contact (as typed): ${r.contact || '(none)'}`,
    '',
    'Context:',
  ];
  for (const [k, label] of CONTEXT_LABELS) lines.push(`  ${label}: ${r.context[k] !== undefined ? ctxValue(k, r.context[k]) : '-'}`);
  lines.push(`  Browser: ${r.context.ua || '-'}`);
  return lines.join('\n');
}

// A single plain address (no name, no list, no spaces): the only user text allowed into a header.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const replyTo = (contact) => (typeof contact === 'string' && contact.length <= CONTACT_MAX && EMAIL_RE.test(contact) && !contact.includes('..') ? contact : null);

// ---------------------------------------------------------------- channels

export const emailConfigured = (env) => !!(env && env.RESEND_API_KEY && env.REPORT_TO && env.REPORT_FROM);
export const githubConfigured = (env) => !!(env && env.GITHUB_TOKEN && githubRepo(env));

// fetch with an AbortController timeout; resolves to the Response or throws.
async function timedFetch(fetchFn, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const headerSafe = (s) => String(s).replace(/[\r\n]/g, '').trim();

// -> true when Resend accepted the email. Logs only the status or the error name.
export async function sendEmail(env, r, { id, now }, { fetch: fetchFn, timeoutMs = DELIVERY_TIMEOUT_MS }) {
  const to = String(env.REPORT_TO).split(',').map(headerSafe).filter(Boolean).slice(0, 5);
  const payload = { from: headerSafe(env.REPORT_FROM), to, subject: emailSubject(r), text: emailText(r, { id, now, site: siteName(env) }) };
  const rt = replyTo(r.contact);
  if (rt) payload.reply_to = rt;
  try {
    const res = await timedFetch(fetchFn, RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        // Resend drops a second send with the same key within 24 h: a retry never doubles an email.
        'Idempotency-Key': `graveyard-shift-report-${id}`,
      },
      body: JSON.stringify(payload),
    }, timeoutMs);
    if (res.ok) return true;
    console.error('report email failed: status', res.status);
    return false;
  } catch (err) {
    console.error('report email failed:', err && err.name);
    return false;
  }
}

// -> { ok:true, url, number } | { ok:false }. Never logs the token or GitHub's response body.
export async function createIssue(env, r, { id, now }, { fetch: fetchFn, timeoutMs = DELIVERY_TIMEOUT_MS }) {
  try {
    const repo = githubRepo(env);
    if (!repo) return { ok: false };
    const res = await timedFetch(fetchFn, githubIssuesUrl(repo), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ title: issueTitle(r), body: issueBody(r, { id, now, site: siteName(env) }), labels: issueLabels(r.kind) }),
    }, timeoutMs);
    if (!res.ok) {
      console.error('report issue failed: status', res.status);
      return { ok: false };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: true, url: data && typeof data.html_url === 'string' ? data.html_url : null, number: data && Number.isInteger(data.number) ? data.number : null };
  } catch (err) {
    console.error('report issue failed:', err && err.name);
    return { ok: false };
  }
}

// ---------------------------------------------------------------- storage

async function insertReport(db, r, ipHash, now) {
  const row = await db
    .prepare(`INSERT INTO reports (created_at, kind, message, contact, context_json, ip_hash)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
    .bind(now, r.kind, r.message, r.contact, JSON.stringify(r.context), ipHash)
    .first();
  return Number(row.id);
}

const markDelivered = (db, id, column) => db.prepare(`UPDATE reports SET ${column} = 1 WHERE id = ?1`).bind(id).run();

const dupKey = (ipHash, message) => sha256Hex(`report-dup|${ipHash}|${normaliseMessage(message)}`);

async function isDuplicate(db, key, now) {
  const row = await db
    .prepare("SELECT 1 AS x FROM rate WHERE bucket = 'report:dup' AND key = ?1 AND window_start > ?2 LIMIT 1")
    .bind(key, now - DUPLICATE_MS)
    .first();
  return !!row;
}

// The duplicate marker lives in the rate table (pruned after 2 days with the other rate rows).
const recordDuplicate = (db, key, now) => db
  .prepare("INSERT INTO rate (bucket, key, window_start, count) VALUES ('report:dup', ?1, ?2, 1) ON CONFLICT DO NOTHING")
  .bind(key, now)
  .run();

// ---------------------------------------------------------------- handlers

const err = (status, error, extra = {}) => ({ status, body: { error, ...extra }, headers: {} });
const limited = (retryAfter, extra = {}) => ({
  status: 429, body: { error: 'rate_limited', retryAfter, ...extra }, headers: { 'Retry-After': String(retryAfter) },
});
const GLOBAL_REASON = 'The game has received a lot of reports today. Please try again tomorrow.';

// POST /api/report. `ipHash()` returns the salted IP hash (throws when IP_SALT is unset).
export async function submitReport({ body, env, now, ipHash, fetch: fetchFn = globalThis.fetch, timeoutMs }) {
  // A filled honeypot is a bot: say yes, do nothing.
  if (body.hp !== undefined && body.hp !== null && body.hp !== '') return { status: 200, body: { ok: true }, headers: {} };

  const v = validateReport(body);
  if (!v.ok) return err(400, 'invalid_report', { reason: v.reason });
  const r = v.report;
  const db = env.DB;
  const ip = await ipHash();

  for (const bucket of ['report:ip:h', 'report:ip:d']) {
    const p = await peek(db, bucket, ip, now);
    if (!p.ok) return limited(p.retryAfterSec);
  }
  const all = await peek(db, 'report:all', 'all', now);
  if (!all.ok) return limited(all.retryAfterSec, { scope: 'global', reason: GLOBAL_REASON });

  const dk = await dupKey(ip, r.message);
  if (await isDuplicate(db, dk, now)) return { status: 200, body: { ok: true, duplicate: true }, headers: {} };

  // Counted now (before delivery), so concurrent floods cannot slip past the caps.
  for (const [bucket, key] of [['report:ip:h', ip], ['report:ip:d', ip]]) {
    const h = await hit(db, bucket, key, now);
    if (!h.ok) return limited(h.retryAfterSec);
  }
  const g = await hit(db, 'report:all', 'all', now);
  if (!g.ok) return limited(g.retryAfterSec, { scope: 'global', reason: GLOBAL_REASON });

  const id = await insertReport(db, r, ip, now);
  await recordDuplicate(db, dk, now);

  const meta = { id, now };
  const opts = { fetch: fetchFn, timeoutMs };
  const [mailed, issue] = await Promise.all([
    emailConfigured(env) ? sendEmail(env, r, meta, opts) : Promise.resolve(false),
    githubConfigured(env) ? createIssue(env, r, meta, opts) : Promise.resolve({ ok: false }),
  ]);
  if (mailed) await markDelivered(db, id, 'delivered_email');
  if (issue.ok) await markDelivered(db, id, 'delivered_issue');

  const out = { ok: true };
  // The issue link is returned only when explicitly turned on (it is useless to players if the repo is private).
  if (issue.ok && env.REPORT_RETURN_URL === '1') { out.url = issue.url; out.number = issue.number; }
  return { status: 200, body: out, headers: {} };
}

// GET /api/report/status: enabled whenever the database answers (reports are always stored).
export async function reportStatus(env) {
  try {
    if (!env.DB || !env.IP_SALT) return { enabled: false };
    await env.DB.prepare('SELECT 1 AS x').first();
    return { enabled: true };
  } catch {
    return { enabled: false };
  }
}

// Scheduled: delete reports older than 180 days; retry emails not delivered in the last 48 h (at most
// 20 a run). GitHub issues are not retried: a timed-out create may have succeeded, and a retry would
// file the same report twice.
export async function reportMaintenance(env, now, { fetch: fetchFn = globalThis.fetch, timeoutMs } = {}) {
  const db = env.DB;
  const del = await db.prepare('DELETE FROM reports WHERE created_at < ?1').bind(now - REPORT_RETENTION_MS).run();
  const pruned = del?.meta?.changes ?? 0;
  let retried = 0, delivered = 0;
  if (emailConfigured(env)) {
    const { results = [] } = await db
      .prepare(`SELECT id, created_at, kind, message, contact, context_json FROM reports
                WHERE delivered_email = 0 AND created_at >= ?1 ORDER BY created_at ASC LIMIT ?2`)
      .bind(now - EMAIL_RETRY_WINDOW_MS, EMAIL_RETRY_MAX)
      .all();
    for (const row of results) {
      retried++;
      let context = {};
      try { context = cleanContext(JSON.parse(row.context_json)); } catch { context = {}; }
      const r = { kind: row.kind, message: row.message, contact: row.contact, context };
      if (await sendEmail(env, r, { id: row.id, now: row.created_at }, { fetch: fetchFn, timeoutMs })) {
        await markDelivered(db, row.id, 'delivered_email');
        delivered++;
      }
    }
  }
  return { pruned, retried, delivered };
}
