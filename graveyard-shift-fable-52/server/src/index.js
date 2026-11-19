// Graveyard Shift leaderboard API: a Cloudflare Worker with one D1 binding (env.DB).
// The game calls this Worker's own URL directly (cross-origin, no credentials).
//
// env:
//   DB               D1 database binding
//   IP_SALT          secret; salt for hashing client IPs (POSTs return 500 until it is set)
//   ALLOWED_ORIGINS  comma list of origins allowed for CORS and for POSTs
//   RESERVED_WORDS, RESERVED_PREFIXES  optional comma lists of extra reserved tag names (validate.js)
//   READ_LIMITER     optional Workers Rate Limiting binding for GET routes; skipped if absent
//   Report delivery (all optional; reports are always stored in D1, see report.js):
//   RESEND_API_KEY, REPORT_TO, REPORT_FROM   secrets; all three set -> each report is emailed
//   GITHUB_TOKEN     secret; with GITHUB_REPO ("owner/name") set -> each report also becomes a GitHub issue
//   SITE_NAME        the game's host name, shown in report emails and issues (default "the game site")
//   REPORT_RETURN_URL  '1' -> the issue URL and number are returned to the client

import { validateTag, lookupKey, validateRun } from './validate.js';
import {
  generateSecret, hashSecret, generateRecovery, normalizeRecovery, hashRecovery,
  hashIp, timingSafeEqual, SECRET_PATTERN,
} from './crypto.js';
import * as store from './db.js';
import { hit, hitAll, peek, pruneRate, ipBucket } from './rate.js';
import { submitReport, reportStatus, reportMaintenance, REPORT_MAX_BODY } from './report.js';

export const MAX_BODY_BYTES = 2048;
export const LEADERBOARD_MAX = 100;
export const LEADERBOARD_MEMO_MS = 15 * 1000;
const CACHE_PUBLIC = 'public, max-age=15';
const PRUNE_CHANCE = 0.02;
const JSON_TYPE = /^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;

class HttpError extends Error {
  constructor(status, error, extra = {}, headers = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
    this.headers = headers;
  }
}

const rateLimited = (retryAfter, extra = {}) =>
  new HttpError(429, 'rate_limited', { retryAfter, ...extra }, { 'Retry-After': String(retryAfter) });

// ---------------------------------------------------------------- responses

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// No Access-Control-Allow-Credentials: the API never uses cookies or auth headers.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // CORS headers depend on Origin, and some responses are cacheable.
      Vary: 'Origin',
      ...headers,
    },
  });
}

// ---------------------------------------------------------------- request helpers

// Reads at most `max` bytes; longer bodies are refused whether or not they declare a length.
async function readJsonBody(request, max = MAX_BODY_BYTES) {
  if (!JSON_TYPE.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'content_type');
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, 'too_large');
  if (!request.body) throw new HttpError(400, 'bad_json');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, 'too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'bad_json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json');
  return body;
}

// Salted hash of the client's IPv4 address or IPv6 /64. Never stores or logs the raw IP.
async function ipKey(request, env) {
  if (!env.IP_SALT) throw new HttpError(500, 'server_misconfigured');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return hashIp(ipBucket(ip), env.IP_SALT);
}

async function enforce(db, checks, now) {
  const r = await hitAll(db, checks, now);
  if (!r.ok) throw rateLimited(r.retryAfterSec);
}

// Constant-time check of a presented secret against a player row.
async function secretMatches(player, secret) {
  if (!player || typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return false;
  return timingSafeEqual(await hashSecret(secret), player.secret_hash);
}

// Housekeeping shared by the cron and (occasionally) by POSTs.
export async function housekeeping(db, now) {
  const rate = await pruneRate(db, now);
  const players = await store.pruneUnscoredPlayers(db, now);
  return { rate, players };
}

function maybeHousekeeping(ctx, db, now) {
  if (Math.random() >= PRUNE_CHANCE) return;
  const p = housekeeping(db, now).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

// Per-IP limit for GET routes via the Workers Rate Limiting binding (approximate, per
// Cloudflare location). Absent binding or salt: no limit.
async function limitRead(request, env) {
  if (!env.READ_LIMITER || !env.IP_SALT) return;
  const key = await ipKey(request, env);
  const { success } = await env.READ_LIMITER.limit({ key: `read:${key}` });
  if (!success) throw rateLimited(60);
}

// ---------------------------------------------------------------- handlers

async function health() {
  return json(200, { ok: true });
}

async function claim({ request, env, now }) {
  const body = await readJsonBody(request);
  const db = env.DB;
  const ip = await ipKey(request, env);

  // Malformed tags cost nothing and are not counted.
  const v = validateTag(body.tag, env);
  if (!v.ok) throw new HttpError(400, 'invalid_tag', { reason: v.reason });

  // Well-formed attempts (including ones that hit "taken") have a looser per-IP allowance;
  // successful claims have a tight per-IP one and a global one.
  await enforce(db, [['claim:try', ip]], now);
  const mine = await peek(db, 'claim:ip', ip, now);
  if (!mine.ok) throw rateLimited(mine.retryAfterSec);
  const all = await peek(db, 'claim:all', 'all', now);
  if (!all.ok) throw rateLimited(all.retryAfterSec, { scope: 'global' });

  if (await store.tagKeyExists(db, v.key)) throw new HttpError(409, 'taken');

  const secret = generateSecret();
  const recovery = generateRecovery();
  try {
    await store.insertPlayer(db, {
      tag: v.tag,
      key: v.key,
      secretHash: await hashSecret(secret),
      recoveryHash: await hashRecovery(v.key, recovery),
      now,
    });
  } catch (err) {
    if (store.isUniqueViolation(err)) throw new HttpError(409, 'taken');
    throw err;
  }
  await hit(db, 'claim:ip', ip, now);
  await hit(db, 'claim:all', 'all', now);
  return json(201, { tag: v.tag, secret, recovery });
}

async function recover({ request, env, now }) {
  const body = await readJsonBody(request);
  const db = env.DB;
  const key = lookupKey(body.tag);
  if (!key) throw new HttpError(400, 'invalid_tag');
  await enforce(db, [['recover:ip', await ipKey(request, env)], ['recover:tag', key]], now);

  const code = normalizeRecovery(body.recovery);
  const player = await store.findPlayerByKey(db, key);
  // Hash even when the tag or code is unusable so timing does not reveal which.
  const presented = await hashRecovery(key, code || 'invalid');
  const ok = !!player && !!code && timingSafeEqual(presented, player.recovery_hash);
  if (!ok) throw new HttpError(403, 'bad_recovery');

  const secret = generateSecret();
  await store.setSecretHash(db, player.id, await hashSecret(secret));
  return json(200, { tag: player.tag, secret });
}

async function score({ request, env, now }) {
  const body = await readJsonBody(request);
  const db = env.DB;
  await enforce(db, [['score:ip', await ipKey(request, env)]], now);

  const key = lookupKey(body.tag);
  const player = key ? await store.findPlayerByKey(db, key) : null;
  if (!(await secretMatches(player, body.secret))) throw new HttpError(403, 'bad_secret');
  // Counted only after the secret checks out, so nobody can lock a player out by
  // spamming wrong secrets against their tag.
  await enforce(db, [['score:tag', key]], now);

  const v = validateRun(body.run);
  if (!v.ok) throw new HttpError(422, 'implausible_run', { reason: v.reason });

  const { improved } = await store.recordRun(db, player.id, v.run, now);
  await store.pruneRuns(db, player.id);
  const fresh = await store.findPlayerByKey(db, key);
  const rank = await store.playerRank(db, fresh);
  return json(200, { ok: true, personalBest: improved, rank, games: fresh.games });
}

function parseLimit(raw) {
  if (raw == null || raw === '') return LEADERBOARD_MAX;
  if (!/^\d{1,4}$/.test(raw)) throw new HttpError(400, 'bad_limit');
  const n = Number(raw);
  if (n < 1) throw new HttpError(400, 'bad_limit');
  return Math.min(n, LEADERBOARD_MAX);
}

// Per-isolate memo of leaderboard bodies, keyed by database binding then (board, device, limit).
const memo = new WeakMap();

async function getLeaderboard({ url, env, request, now }) {
  await limitRead(request, env);
  const q = url.searchParams;
  const board = q.get('board') || 'round';
  const device = q.get('device') || 'all';
  if (!Object.hasOwn(store.BOARDS, board)) throw new HttpError(400, 'bad_board');
  if (!['all', 'desktop', 'phone'].includes(device)) throw new HttpError(400, 'bad_device');
  const limit = parseLimit(q.get('limit'));

  let cache = memo.get(env.DB);
  if (!cache) memo.set(env.DB, (cache = new Map()));
  const k = `${board}|${device}|${limit}`;
  let hitEntry = cache.get(k);
  if (!hitEntry || now - hitEntry.at >= LEADERBOARD_MEMO_MS || now < hitEntry.at) {
    const entries = await store.leaderboard(env.DB, { board, device, limit });
    hitEntry = { at: now, body: JSON.stringify({ board, device, entries }) };
    cache.set(k, hitEntry);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  return new Response(hitEntry.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CACHE_PUBLIC,
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    },
  });
}

async function getPlayer({ url, env, request }) {
  await limitRead(request, env);
  const key = lookupKey(url.searchParams.get('tag'));
  if (!key) throw new HttpError(400, 'invalid_tag');
  const p = await store.findPlayerByKey(env.DB, key);
  if (!p) throw new HttpError(404, 'not_found');
  const rank = await store.playerRank(env.DB, p);
  return json(200, store.publicPlayer(p, rank), { 'Cache-Control': CACHE_PUBLIC });
}

async function report({ request, env, now, deps }) {
  const body = await readJsonBody(request, REPORT_MAX_BODY);
  const r = await submitReport({ body, env, now, ipHash: () => ipKey(request, env), fetch: deps.fetch, timeoutMs: deps.timeoutMs });
  return json(r.status, r.body, r.headers);
}

async function getReportStatus({ request, env }) {
  await limitRead(request, env);
  return json(200, await reportStatus(env), { 'Cache-Control': 'public, max-age=60' });
}

const ROUTES = {
  '/api/health': { GET: health },
  '/api/claim': { POST: claim },
  '/api/recover': { POST: recover },
  '/api/score': { POST: score },
  '/api/leaderboard': { GET: getLeaderboard },
  '/api/player': { GET: getPlayer },
  '/api/report': { POST: report },
  '/api/report/status': { GET: getReportStatus },
};

// ---------------------------------------------------------------- entry

// deps: { fetch, timeoutMs } for outgoing calls (tests inject a fake fetch).
export async function handle(request, env, ctx, now = Date.now(), deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const cors = corsHeaders(request, env);
  const route = ROUTES[path];

  try {
    if (!route) throw new HttpError(404, 'not_found');
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, Vary: 'Origin', Allow: `${Object.keys(route).join(', ')}, OPTIONS` },
      });
    }
    const fn = route[request.method];
    if (!fn) {
      throw new HttpError(405, 'method_not_allowed', {}, { Allow: `${Object.keys(route).join(', ')}, OPTIONS` });
    }
    if (request.method === 'POST') {
      // Browsers always send Origin on cross-origin POSTs. A foreign origin is refused outright;
      // requests without Origin (curl, server-to-server) are allowed and still rate limited.
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin && !allowedOrigins(env).includes(origin)) {
        throw new HttpError(403, 'origin');
      }
      maybeHousekeeping(ctx, env.DB, now);
    }
    const res = await fn({ request, env, ctx, url, now, deps: { fetch: deps.fetch || ((...a) => globalThis.fetch(...a)), timeoutMs: deps.timeoutMs } });
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.status, err.body, { ...cors, ...err.headers });
    }
    // Never log request bodies: they carry secrets and recovery codes.
    console.error('unhandled', err && err.name, String(err && err.message).slice(0, 200));
    return json(500, { error: 'internal' }, cors);
  }
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  // Cron trigger (wrangler.toml [triggers]): prune old rate rows and never-scored tags; prune old
  // reports and retry undelivered report emails.
  async scheduled(controller, env, ctx, deps = {}) {
    const now = controller && Number.isFinite(controller.scheduledTime) ? controller.scheduledTime : Date.now();
    ctx.waitUntil(housekeeping(env.DB, now).catch((err) => {
      console.error('housekeeping failed', err && err.name);
    }));
    ctx.waitUntil(reportMaintenance(env, now, deps).catch((err) => {
      console.error('report maintenance failed', err && err.name);
    }));
  },
};
