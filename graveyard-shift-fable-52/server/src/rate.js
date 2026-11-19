// Fixed-window rate limiting on the `rate` table, plus IP bucketing.

const HOUR = 60 * 60 * 1000;

// limit = allowed events per window. Bucket names are fixed strings, never user input.
export const RATE_LIMITS = {
  'claim:ip': { limit: 5, windowMs: HOUR }, // successful claims per IP (or IPv6 /64)
  'claim:try': { limit: 30, windowMs: HOUR }, // well-formed claim attempts per IP, incl. "taken"
  'claim:all': { limit: 300, windowMs: HOUR }, // successful claims across everyone
  'score:tag': { limit: 30, windowMs: HOUR },
  'score:ip': { limit: 60, windowMs: HOUR },
  'recover:tag': { limit: 5, windowMs: HOUR },
  'recover:ip': { limit: 10, windowMs: HOUR },
  'report:ip:h': { limit: 3, windowMs: HOUR }, // accepted reports per IP (or IPv6 /64) per hour
  'report:ip:d': { limit: 10, windowMs: 24 * HOUR }, // ... per UTC day
  'report:all': { limit: 200, windowMs: 24 * HOUR }, // accepted reports across everyone per UTC day
};

// Rows older than this are deleted by pruneRate.
export const RATE_RETENTION_MS = 2 * 24 * HOUR;

export function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

function rule(bucket, limits) {
  const r = limits[bucket];
  if (!r) throw new Error(`unknown rate bucket ${bucket}`);
  return r;
}

const retryAfter = (start, r, now) => Math.max(1, Math.ceil((start + r.windowMs - now) / 1000));

// Counts one event and reports whether it is within the limit.
// Returns { ok, count, limit, retryAfterSec, bucket }.
export async function hit(db, bucket, key, now, limits = RATE_LIMITS) {
  const r = rule(bucket, limits);
  const start = windowStart(now, r.windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate (bucket, key, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (bucket, key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, key, start)
    .first();
  const count = row ? Number(row.count) : 1;
  return { ok: count <= r.limit, count, limit: r.limit, retryAfterSec: retryAfter(start, r, now), bucket };
}

// Reports whether one more event would fit, without counting it.
export async function peek(db, bucket, key, now, limits = RATE_LIMITS) {
  const r = rule(bucket, limits);
  const start = windowStart(now, r.windowMs);
  const row = await db
    .prepare('SELECT count FROM rate WHERE bucket = ?1 AND key = ?2 AND window_start = ?3')
    .bind(bucket, key, start)
    .first();
  const count = row ? Number(row.count) : 0;
  return { ok: count < r.limit, count, limit: r.limit, retryAfterSec: retryAfter(start, r, now), bucket };
}

// Counts several buckets in order and stops at the first one over its limit.
export async function hitAll(db, checks, now, limits = RATE_LIMITS) {
  for (const [bucket, key] of checks) {
    const r = await hit(db, bucket, key, now, limits);
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function pruneRate(db, now, retentionMs = RATE_RETENTION_MS) {
  const res = await db.prepare('DELETE FROM rate WHERE window_start < ?1').bind(now - retentionMs).run();
  return res?.meta?.changes ?? 0;
}

// ---------------------------------------------------------------- IP bucketing

// Expands an IPv6 address to 8 groups of 4 hex digits, or returns null if it is not one.
export function expandIPv6(ip) {
  let s = String(ip).trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return null;
  // Embedded IPv4 tail (::ffff:1.2.3.4).
  const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    s = s.slice(0, -v4[0].length)
      + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

// The unit an IP is limited as: an IPv4 address as-is, an IPv6 address by its /64 prefix
// (one subscriber usually holds a whole /64, so per-address limits are trivial to rotate past).
// IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address.
export function ipBucket(ip) {
  const g = expandIPv6(ip);
  if (!g) return `v4|${String(ip).trim()}`;
  if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {
    const n = [g[6], g[7]].map((x) => parseInt(x, 16));
    return `v4|${n[0] >> 8}.${n[0] & 255}.${n[1] >> 8}.${n[1] & 255}`;
  }
  return `v6|${g.slice(0, 4).join(':')}::/64`;
}
