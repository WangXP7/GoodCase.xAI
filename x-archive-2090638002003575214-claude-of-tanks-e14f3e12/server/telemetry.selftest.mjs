import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTelemetryHandler, createTelemetryRateLimiter } from '../api/telemetry.ts';

// The receipt drives the real fallback handler with a fake request/response
// pair, so every refusal (method, origin, size, JSON, schema, personal
// fields, rate limit) and the one sink (a structured log line) are observed.
// Schema cases live in server/telemetryRecord.selftest.mjs.

function fakeRequest({ method = 'POST', origin = 'https://cot.kevinliu.studio', body = '', ip = '203.0.113.7',
  contentLength = null, presetBody = undefined } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = { origin, 'x-forwarded-for': ip };
  if (contentLength !== null) headers['content-length'] = String(contentLength);
  const request = {
    method, headers, socket: { remoteAddress: '10.0.0.1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(text.slice(0, 7)); yield Buffer.from(text.slice(7)); },
  };
  if (presetBody !== undefined) request.body = presetBody;
  return request;
}

async function invoke(handler, options = {}) {
  const headers = new Map();
  let text = '';
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { text = String(value); },
  };
  await handler(fakeRequest(options), response);
  return { status: response.statusCode, headers, body: text ? JSON.parse(text) : null, text };
}

function fixture(overrides = {}) {
  const lines = [];
  let clock = 1_700_000_000_000;
  const handler = createTelemetryHandler({
    env: {}, now: () => clock, log: (line) => lines.push(line), bucketCapacity: 3, bucketRefillPerSecond: 1, ...overrides,
  });
  return { handler, lines, advance: (ms) => { clock += ms; } };
}

const session = { v: 2, sid: 'abcDEF12345', build: 'v1.0.0+gd464a813f', kind: 'session', outcome: 'ready', stage: 'ready',
  ms: 4200.6, mode: 'unknown', t: { renderer: 40, 'gap>sky': 3, vehicle: 812 },
  cap: { webgl2: true, rendererFamily: 'apple', maxTextureUnits: 16, maxTextureSize: 16384, vertexTextureUnits: 16,
    colorBufferFloat: true, software: false, memoryClass: 'high', tier: 'desktop', autoTier: 'high', storage: true,
    worker: true, requiredTextureUnits: 16 }, capOutcome: 'ok', entry: { mode: 'solo', outcome: 'ok', ms: 1200 } };
const error = { v: 2, sid: 'abcDEF12345', build: 'v1.0.0+gd464a813f', kind: 'error', stage: 'sky', code: 'uncaught', ready: false,
  ms: 900, error: { message: 'Injected  failure', frames: ['at bake (/assets/sky-abc123.js:1:2)', 'second', 'third', 'fourth'] } };

{
  const f = fixture();
  const accepted = await invoke(f.handler, { body: session });
  assert.equal(accepted.status, 204, 'a valid session record is accepted without a body');
  assert.equal(accepted.text, '');
  assert.equal(accepted.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(f.lines.length, 1, 'every record becomes one structured log line');
  const row = JSON.parse(f.lines[0]);
  assert.equal(row.tag, 'cot-telemetry');
  assert.equal(row.at, '2023-11-14T22:13:20.000Z', 'the server stamps the time; clients send none');
  assert.equal(row.kind, 'session');
  assert.equal(row.ms, 4201, 'milliseconds are rounded');
  assert.deepEqual(row.cap, session.cap, 'the whitelisted capability summary survives intact');
  assert.deepEqual(row.t, session.t);
  assert.deepEqual(row.entry, session.entry);
  assert.doesNotMatch(f.lines.join('\n'), /203\.0\.113\.7|10\.0\.0\.1/, 'no request address reaches the log');

  assert.equal((await invoke(f.handler, { body: error })).status, 204, 'an error record is accepted on the same route');
  const logged = JSON.parse(f.lines[1]);
  assert.equal(logged.error.message, 'Injected failure', 'control characters are stripped from messages');
  assert.deepEqual(logged.error.frames, error.error.frames.slice(0, 3), 'only three frames are kept');
  assert.equal(logged.ready, false);
  const watchdog = await invoke(f.handler, { body: { v: 2, sid: 'inline-boot-1', build: 'v1.0.0', kind: 'error',
    stage: 'download', code: 'chunk', outcome: 'halted', ready: false, ms: 61000,
    error: { message: 'A game file failed to download (sky-1.js)', frames: ['sky-1.js'], code: 'stall:download' } } });
  assert.equal(watchdog.status, 204, 'the inline watchdog verdict is accepted');
  assert.equal(JSON.parse(f.lines[2]).error.code, 'stall:download');
}

{
  const f = fixture();
  assert.equal((await invoke(f.handler, { method: 'GET' })).status, 405);
  const options = await invoke(f.handler, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'POST');
  const forbidden = await invoke(f.handler, { body: session, origin: 'https://attacker.example' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'origin_forbidden');
  assert.equal(f.lines.length, 0, 'refused requests log nothing');
  const extra = createTelemetryHandler({ env: { COT_ALLOWED_ORIGINS: 'https://staging.example' }, log: () => {} });
  assert.equal((await invoke(extra, { body: session, origin: 'https://staging.example' })).status, 204,
    'COT_ALLOWED_ORIGINS extends the allowlist like the ICE endpoint');
  assert.equal((await invoke(extra, { body: session, origin: '' })).status, 204,
    'an origin-less request (no browser) is not refused by the allowlist alone');
}

{
  const f = fixture();
  const large = { ...error, error: { message: 'x'.repeat(3000), frames: [] } };
  const tooLarge = await invoke(f.handler, { body: large });
  assert.equal(tooLarge.status, 413, 'bodies above 2 KB are refused before parsing');
  assert.equal(tooLarge.body.error, 'too_large');
  const declared = await invoke(f.handler, { body: session, contentLength: 5000 });
  assert.equal(declared.status, 413, 'a declared oversize length is refused without reading');
  const invalid = await invoke(f.handler, { body: '{not json' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_json');
  assert.equal(f.lines.length, 0);
}

{
  const f = fixture({ bucketCapacity: 50 });
  for (const [body, refusal] of [
    [{ ...session, v: 1 }, 'invalid_record:v'],
    [{ ...session, kind: 'boot_stage' }, 'invalid_record:kind'],
    [{ v: 1, sid: 'abcDEF12345', build: 'dev', events: [{ kind: 'boot_ready' }] }, 'invalid_record:v'],
    [{ ...session, ip: '1.2.3.4' }, 'pii_field:ip'],
    [{ ...session, cap: { ...session.cap, userAgent: 'Mozilla' } }, 'pii_field:userAgent'],
    [[1, 2], 'invalid_body'],
  ]) {
    const refused = await invoke(f.handler, { body });
    assert.equal(refused.status, 400, `${refusal} is refused`);
    assert.equal(refused.body.error, refusal);
  }
  assert.equal(f.lines.length, 0, 'no refused body reaches the log');
  const dropped = await invoke(f.handler, { body: { ...session, unknownField: 1, t: { renderer: 12.4, 'bad key': 9 } } });
  assert.equal(dropped.status, 204, 'unknown fields are dropped, not refused');
  const row = JSON.parse(f.lines.at(-1));
  assert.equal(row.unknownField, undefined);
  assert.deepEqual(row.t, { renderer: 12 });
}

{
  const f = fixture();
  for (let i = 0; i < 3; i++) assert.equal((await invoke(f.handler, { body: session })).status, 204);
  const limited = await invoke(f.handler, { body: session });
  assert.equal(limited.status, 429, 'the fourth record inside the burst window is rate limited');
  assert.equal(limited.headers.get('retry-after'), '30');
  assert.equal((await invoke(f.handler, { body: session, ip: '198.51.100.9' })).status, 204,
    'another client keeps its own bucket');
  f.advance(1000);
  assert.equal((await invoke(f.handler, { body: session })).status, 204, 'the bucket refills with time');
  assert.equal(f.lines.length, 5);
  const preset = fixture();
  assert.equal((await invoke(preset.handler, { body: '', presetBody: session })).status, 204,
    'a platform-parsed body object is accepted as well as a raw stream');
}

{
  let clock = 0;
  const limiter = createTelemetryRateLimiter({ capacity: 2, refillPerSecond: 1, limit: 2, now: () => clock });
  assert.deepEqual([limiter.take('a'), limiter.take('a'), limiter.take('a')], [true, true, false]);
  limiter.take('b'); limiter.take('c');
  assert.equal(limiter.size, 2, 'the bucket map is bounded; the coldest client is evicted');
  clock = 2000;
  assert.equal(limiter.take('a'), true, 'an evicted client starts a fresh bucket');
  const source = await readFile(new URL('../api/telemetry.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@upstash|lpush|createRedis|KV_REST_API|REDIS_REST|import\('/i,
    'the fallback has no store: one log line per record, nothing else');
  assert.match(source, /validateTelemetryRecord/, 'the fallback validates through the shared v2 schema');
}

console.log('telemetry.selftest: origin, size, schema, personal-field and rate-limit refusals; the log-line sink; no store pass');
