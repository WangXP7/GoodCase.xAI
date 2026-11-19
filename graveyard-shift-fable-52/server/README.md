# Graveyard Shift API

The optional backend for Graveyard Shift: a no-sign-in leaderboard and the in-game "Report a problem"
form. It is a Cloudflare Worker with one D1 database. The game is a static page; it calls the Worker's
own URL directly, cross-origin. The examples below use `https://api.example` for the Worker and
`https://game.example` for the game. The game only calls the Worker when it was built with
`GS_API_BASE` and `GS_ALLOWED_ORIGINS` set (see `.env.example` in the repository root); otherwise it
never contacts it.

There is no email, no password and no cookie. A player types a gamertag once and gets back a
random **secret** (kept by the game in `localStorage`) and a **recovery code** (shown once, for
the player to write down). The secret submits scores; the recovery code gets a new secret on
another device or after clearing the browser.

## Files

| Path | What it is |
| --- | --- |
| `src/index.js` | Router, HTTP checks (method, content type, 2 KB body limit, origin, CORS), handlers, cron |
| `src/validate.js` | Pure tag and run validation; `RUN_LIMITS` holds every run bound |
| `src/crypto.js` | Secrets, recovery codes, SHA-256, constant-time compare, IP hashing |
| `src/db.js` | Every SQL statement, behind small functions taking a D1-shaped `db` |
| `src/rate.js` | Fixed-window rate limits on the `rate` table; IPv6 /64 bucketing |
| `src/report.js` | "Report a problem": validation, storage, email (Resend) and GitHub delivery, retries |
| `schema.sql` | Tables and indexes; safe to run on an empty database |
| `migrations/0002_reports.sql` | Adds the `reports` table to a database created before it existed |
| `wrangler.example.toml` | Template for your `wrangler.toml` (not tracked): D1 binding, vars, rate limiter, cron, secrets |
| `test/fakeD1.js` | Test-only D1 stand-in on Node's built-in SQLite, running the real `schema.sql` |

Tests live in the repository root: `npx vitest run tests/server.test.js tests/report.test.js`.

## Calling it from the game

```js
const API = 'https://api.example';
const res = await fetch(`${API}/api/score`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag, secret, run }),
  // Default credentials mode ('same-origin') sends nothing cross-origin. Never use
  // credentials: 'include'; the API does not allow credentials and the request would fail.
});
```

- Only origins in `ALLOWED_ORIGINS` get CORS headers (for example `https://game.example`). A POST
  carrying any other `Origin` is refused with 403 `origin`. Preview deployments are not allowed
  unless added to the list.
- `Content-Type` must be exactly `application/json` (optionally `; charset=utf-8`), which
  makes every POST a CORS preflight; the Worker answers `OPTIONS` on every route.
- Treat the backend as optional: any network error or 5xx should fail soft and never
  block the game.

## Endpoints

All bodies are JSON, at most 2048 bytes. Errors are `{"error": "<code>"}`, sometimes with
`reason`, `retryAfter` (seconds) or `scope`. POST responses are `Cache-Control: no-store`;
leaderboard and player responses are `public, max-age=15`.

### `GET /api/health`

```json
{ "ok": true }
```

### `POST /api/claim`

```json
{ "tag": "Dead Eye" }
```

`201`:

```json
{ "tag": "Dead Eye", "secret": "9f2c…64 hex chars…", "recovery": "K7QM-2XPA-HV9C-R4TN" }
```

The secret and recovery code are returned only this once; the server keeps only their hashes.

Tag rules: trimmed, runs of whitespace collapsed to one space, 3–16 characters of letters,
digits, `_`, `-` and space. Uniqueness uses a key that is lowercase, with spaces, `_` and `-`
removed and look-alikes folded (`0`→o, `1`/`i`→l, `3`→e, `4`→a, `5`→s, `7`→t, `8`→b, `9`/`6`→g,
`2`→z), so `Dead Eye`, `dead_eye`, `D3AD EYE` are one tag and so are `B0B` and `BOB`.

Refused tags:

- **Blocked**: severe slurs anywhere in the tag, even run together or spaced out (`f u c k`,
  `xxFUCKxx`, `n1gg4`); other profanity as a whole word, where words are split on spaces, `_`,
  `-` and camelCase (`ShitHead`, `sh1t head`, `Big Dicks`), with leetspeak, trailing digits,
  plurals and stretched letters (`shiiit`) tolerated. Whole-word matching keeps names like
  Torpedo, Therapist, Swanky, Nigeria, Shiitake, Retardant, Penistone and Scunthorpe legal.
- **Reserved**: any word that is `admin`, `moderator`, `mod`, `graveyard`, `null`, `undefined`,
  `system`, `support`, `staff`, `official` and a few more, or a word starting with `admin`,
  `moderator`, `graveyard`, `official` (`Admin Team`, `AdminTeam`, `4dm1n`, `GraveyardKing`).
  `Modern` is fine. A deployment reserves its own names with the vars `RESERVED_WORDS` (whole
  words, matched the same way: with `RESERVED_WORDS = "acme"`, `Acme Hunt` and `4cm3_2` are
  refused but `Acmeol` is fine) and `RESERVED_PREFIXES` (any word starting with one of them).

| Status | Body |
| --- | --- |
| 400 | `{"error":"invalid_tag","reason":"tag_length" \| "tag_chars" \| "tag_type" \| "tag_blocked" \| "tag_reserved"}` (not counted against any limit) |
| 409 | `{"error":"taken"}` |
| 429 | `{"error":"rate_limited","retryAfter":1800}`: 5 successful claims per IP per hour, or 30 well-formed attempts (including `taken`) per IP per hour |
| 429 | `{"error":"rate_limited","retryAfter":…,"scope":"global"}`: 300 claims per hour across everyone |

IPv6 clients are limited per /64 prefix, since one subscriber usually holds a whole /64.
Tags that are claimed but never used to submit a score are removed after 30 days, freeing them.

### `POST /api/score`

```json
{
  "tag": "Dead Eye",
  "secret": "9f2c…",
  "run": { "round": 12, "kills": 310, "headshots": 95, "points": 41250, "timeSec": 1380,
           "version": "0.2.0", "device": "desktop" }
}
```

`200`:

```json
{ "ok": true, "personalBest": true, "rank": 4, "games": 17 }
```

`rank` is the player's place on the overall board (best round, then more kills, then earlier).

| Status | Body |
| --- | --- |
| 403 | `{"error":"bad_secret"}` (wrong secret, unknown tag, or malformed secret) |
| 422 | `{"error":"implausible_run","reason":"…"}` (see below) |
| 429 | `{"error":"rate_limited","retryAfter":…}` (60 per IP per hour; 30 per tag per hour, counted only after the secret checks out) |

`timeSec` is **active play time** in whole seconds: time paused or in menus is not counted.
Every number must be a non-negative integer (send `Math.floor` of seconds and points).

Run checks (`validateRun` in `src/validate.js`). The bounds mirror the game's real round director
(`src/game/rounds.js` `roundTotal` / `zombiesThroughRound`) and its tuning (`src/game/tuning/zombies.js`,
`core.js`, `economy.js`, `world.js`, `weapons.js`); every number lives in `RUN_LIMITS`, with a comment
naming its source. `tests/server.test.js` imports the game's own functions and fails if the server's copy
drifts for any of rounds 1–60, so a tuning change that is not mirrored here breaks the build.

Spawn totals: the usual crowd is 6 + 4n to round 10, 46 + 6(n − 10) + 0.5(n − 10)² to round 20, then
156 + 10(n − 20); every fifth round is a boss round with 60 % of the crowd plus min(3, n / 5) brutes.
`zombiesThroughRound(n)` is the sum of those totals over rounds 1..n.

| Field | Rule | `reason` |
| --- | --- | --- |
| `round` | integer 1 … `roundMax` (the highest round reachable in 24 h at the fastest pacing; currently 189) | `round_range` |
| `kills` | integer ≥ 0 | `kills_range` |
| `kills` | ≤ zombiesThroughRound(round) + 10 | `kills_impossible` |
| `kills` | ≥ zombiesThroughRound(round − 1) − 2 per completed round | `kills_too_few` |
| `headshots` | integer ≥ 0 | `headshots_range` |
| `headshots` | ≤ kills | `headshots_exceed_kills` |
| `points` | integer ≥ 0 | `points_range` |
| `points` | ≤ the ceiling below | `points_impossible` |
| `timeSec` | integer 0–86400 (24 h of active play) | `time_range` |
| `timeSec` | ≥ 0.9 × Σ over completed rounds of ((zombies − 2) × spawn interval + 10 s lull) | `time_too_fast` |
| `version` | 1–32 chars of `A-Z a-z 0-9 . _ + -` | `version_invalid` |
| `device` | `"desktop"` or `"phone"` | `device_invalid` |
| `run` | an object | `run_type` |

Spawn interval is max(0.6, 2.0 − 0.1n) s. Walker health is 150 + 100(n − 1) to round 9, × 1.1 a round to
round 20, then × 1.05 a round. Points ceiling (points are shown, ranked only on `board=points`):
500 start + 50 000 (searches and fallbacks) + round × 2 × (200 boards + 400 × 7 Flashovers)
+ kills × 2 × (⌈health(round) × worst type cost⌉ × 10 + 130) + every brute's hits and 500 bonus, × 2.
"Worst type cost" is the most hits a zombie out by that round can take: health multiple over the weakest
hit, an 8-damage shotgun pellet at full falloff (× 0.2 on an armoured trooper's plate from round 7;
bloaters 2× from round 9). The × 2 is Double Time on everything.

### `POST /api/recover`

```json
{ "tag": "Dead Eye", "recovery": "k7qm 2xpa hv9c r4tn" }
```

The code is accepted in any case, with or without dashes or spaces. `200`:

```json
{ "tag": "Dead Eye", "secret": "<new 64 hex chars>" }
```

The old secret stops working at once. The recovery code itself stays the same.

| Status | Body |
| --- | --- |
| 400 | `{"error":"invalid_tag"}` |
| 403 | `{"error":"bad_recovery"}` (wrong code or unknown tag; the two are not distinguished) |
| 429 | 5 attempts per tag per hour, 10 per IP per hour |

### `GET /api/leaderboard?limit=100&board=round&device=all`

`board`: `round` (default; best round, then more kills, then earlier), `kills` (most kills,
then higher round, then earlier) or `points` (most points, then higher round, then earlier).
`device`: `all` (default), `desktop` or `phone`. `limit`: 1–100 (default 100; larger values are
capped). Each player appears once, with their single best run for that board and device.

```json
{
  "board": "round",
  "device": "all",
  "entries": [
    { "rank": 1, "tag": "Dead Eye", "round": 12, "kills": 310, "headshots": 95, "points": 41250,
      "timeSec": 1380, "device": "desktop", "at": "2026-11-11T20:14:03.120Z" }
  ]
}
```

400 with `bad_board`, `bad_device` or `bad_limit` for other values. Responses are memoised in
each Worker isolate for 15 s and carry `Cache-Control: public, max-age=15`, so a new score can
take up to about 15 s to appear.

### `GET /api/player?tag=Dead%20Eye`

```json
{
  "tag": "Dead Eye",
  "games": 17,
  "rank": 4,
  "createdAt": "2026-11-11T19:02:44.000Z",
  "lastAt": "2026-11-11T20:14:03.120Z",
  "best": { "round": 12, "kills": 310, "headshots": 95, "points": 41250, "timeSec": 1380,
            "device": "desktop", "at": "2026-11-11T20:14:03.120Z" }
}
```

Before the first score, `best` and `rank` are `null`. 404 `not_found` for an unknown tag.

`GET /api/leaderboard` and `GET /api/player` are limited to 60 requests per minute per IP (or
IPv6 /64) by the `READ_LIMITER` binding: 429 `rate_limited` with `Retry-After: 60`.

### `POST /api/report` ("Report a problem")

```json
{
  "kind": "bug",
  "message": "The diner door would not open after I bought it.",
  "contact": "optional, up to 100 characters, shown in the report as typed",
  "context": { "version": "0.2.0", "device": "desktop", "tier": "high", "round": 7, "zone": "diner",
               "weapon": "pistol", "fps": 58.4, "viewport": "1920x1080@2x", "ua": "Mozilla/5.0 …", "where": "pause" },
  "hp": ""
}
```

`200 {"ok": true}` once the report is **stored in D1** (always), whether or not a delivery channel
succeeded. `200 {"ok": true, "duplicate": true}` for the same message (case and spacing ignored) from the
same IP within 24 h: nothing new is stored or sent. A filled honeypot `hp` gets `200 {"ok": true}` and
nothing happens.

- `kind`: `bug` | `idea` | `other`. `message`: 10–2000 characters after removing control, bidi and
  zero-width characters and trimming, with at least 3 letters. `contact`: optional, ≤ 100 characters,
  one line. `context`: only the fields above, each typed and pattern-checked (`ua` cut to 200);
  anything else is dropped. Body ≤ 6144 bytes.
- 400 `{"error":"invalid_report","reason":"kind" | "message_type" | "message_short" | "message_long" |
  "message_letters" | "contact_type" | "contact_long"}` (not counted).
- 429 `rate_limited` + `retryAfter`: 3 accepted reports per IP (IPv6 /64) per hour, 10 per UTC day;
  with `"scope":"global"` and a plain `reason` once 200 reports have arrived today from everyone.
- The IP is never stored; `reports.ip_hash` is the same salted hash the rate limits use.

Delivery channels, each switched on by its settings and off without them:

| Channel | Settings | What happens |
| --- | --- | --- |
| Email (Resend) | secrets `RESEND_API_KEY`, `REPORT_TO`, `REPORT_FROM` (all three) | One plain-text email per report. Subject `[Graveyard Shift] Bug: <first 60 chars>` (Idea / Feedback). `reply_to` is the contact only when it is a single plain email address. Failures leave `delivered_email = 0`; the daily cron retries the last 48 h, 20 a run, with an `Idempotency-Key` so a retry never sends twice. |
| GitHub issue | secret `GITHUB_TOKEN` and var `GITHUB_REPO` (`owner/name`) | One issue in `GITHUB_REPO`, title `[Website] Bug: …`, labels `website-feedback` + `bug` / `enhancement`. All user text sits inside code fences (fence longer than any backtick run), so nothing can mention, link, close or render. Not retried (a timed-out create may have succeeded). Set the var `REPORT_RETURN_URL = "1"` to return the issue link to the game. |

Both name the game's site from the var `SITE_NAME` ("Sent from the in-game Report a problem form on
game.example"), or "the game site" when it is unset. Neither channel's errors reach the client or the
log beyond an HTTP status. Reports older than 180 days are removed by the daily cron.

### `GET /api/report/status`

`{"enabled": true}` when the database answers and `IP_SALT` is set (reports are always stored), else
`{"enabled": false}`. The game hides "Report a problem" unless this says true. `Cache-Control: public, max-age=60`.

### Common errors

| Status | When |
| --- | --- |
| 403 `origin` | A POST with an `Origin` header that is neither this host nor in `ALLOWED_ORIGINS` |
| 404 `not_found` | Unknown path |
| 405 `method_not_allowed` | Known path, wrong method (`Allow` header lists the right ones) |
| 413 `too_large` | Body over 2048 bytes (6144 for `/api/report`), declared or actual |
| 415 `content_type` | POST without `Content-Type: application/json` |
| 400 `bad_json` | Body is not a JSON object |
| 500 `server_misconfigured` | `IP_SALT` is not set (POST endpoints only) |
| 500 `internal` | Anything else; logged without the request body |

## Trust model, in plain words

- **What the secret protects:** your tag. Nobody else can post scores under your name or
  change your stats without your secret or your recovery code. Both are stored only as
  SHA-256 hashes, so a leaked database does not let anyone take over a tag.
- **What the recovery code is for:** getting your tag onto a new device or back after clearing
  the browser. Anyone who has it can take the tag over (and lock you out by rotating the
  secret), so treat it like a password. It is 16 characters from a 31-letter alphabet
  (about 79 bits), and guessing is limited to 5 tries per tag per hour.
- **What a cheater can still do:** submit made-up runs for their own tag. The game runs in the
  browser, so the server cannot know what really happened. It only refuses runs that are
  impossible under the game's rules: more kills than zombies spawned, fewer kills than needed to
  reach the round, points beyond what those kills could earn, or rounds reached faster than
  zombies can spawn. A careful cheater can still post a run that is plausible but untrue,
  within those bounds. The fixes, if it matters, are moderation (remove a player row by hand)
  or tighter bounds in `RUN_LIMITS`.
- **What else:** anyone can claim tags (5 per IP or IPv6 /64 per hour, 300 per hour overall)
  and read the boards. An attacker who knows your tag can burn its 5 recovery attempts per
  hour, which only delays your own recovery; they cannot block your score submissions, because
  the per-tag score limit counts only requests with the right secret. Someone with many IPs can
  use up the global claim cap for an hour; that blocks new tags, not play or scoring.
- **Privacy:** no email, no cookies, no credentials. IPs (IPv6 reduced to the /64) are used
  only for rate limits and are stored as a SHA-256 of `IP_SALT` + address, never in the clear.
  Rate rows older than two days and tags never scored after 30 days are removed by a daily cron
  and opportunistically on POSTs. Each player keeps at most their best 20 runs; leaderboards
  read a separate `bests` table, so pruning runs never changes a board. Reports keep only what
  the player typed and the whitelisted context fields.

## Setup (run from `server/`)

Needs a Cloudflare account and Wrangler 4.36.0 or later (for the `[[ratelimits]]` binding).

```sh
cd server

# 1. Your own config from the template (wrangler.toml is not tracked)
cp wrangler.example.toml wrangler.toml

# 2. Create the database; paste the database_id it prints into wrangler.toml
npx wrangler d1 create graveyard-shift-leaderboard

# 3. In wrangler.toml, set ALLOWED_ORIGINS to the origin(s) your game is served from, and any optional
#    vars (RESERVED_WORDS, SITE_NAME, GITHUB_REPO). namespace_id under [[ratelimits]] must not already
#    be used by another rate limiter in the account; change it if so.

# 4. Apply the schema to the remote database (once, on the empty database)
npx wrangler d1 execute graveyard-shift-leaderboard --remote --file=./schema.sql

# 5. Deploy (creates the Worker, the rate-limit binding and the daily cron)
npx wrangler deploy

# 6. Set the IP salt. Until this is done every POST returns 500 server_misconfigured;
#    GET routes work. Setting a secret takes effect without another deploy.
openssl rand -hex 32 | npx wrangler secret put IP_SALT

# 7. Check
curl https://api.example/api/health
curl https://api.example/api/report/status        # {"enabled":true}
curl -i -X OPTIONS -H 'Origin: https://game.example' https://api.example/api/claim
```

Then build the game with `GS_API_BASE` set to the Worker's URL and `GS_ALLOWED_ORIGINS` set to the same
origins as `ALLOWED_ORIGINS` (see `.env.example` in the repository root).

A database created before the `reports` table existed needs the migration once:
`npx wrangler d1 execute graveyard-shift-leaderboard --remote --file migrations/0002_reports.sql`.

### Configuration reference

| Name | Kind | Purpose |
| --- | --- | --- |
| `DB` | D1 binding | The database |
| `READ_LIMITER` | rate-limit binding | Per-IP limit on the GET routes (skipped if absent) |
| `ALLOWED_ORIGINS` | var | Comma list of origins allowed for CORS and POSTs |
| `RESERVED_WORDS`, `RESERVED_PREFIXES` | vars, optional | Extra reserved gamertags (comma lists) |
| `SITE_NAME` | var, optional | The game's host name in report emails and issues |
| `GITHUB_REPO` | var, optional | `owner/name` of the repository that receives reports as issues |
| `REPORT_RETURN_URL` | var, optional | `"1"` returns the issue link to the game |
| `IP_SALT` | secret, required | Salt for hashing client IPs |
| `RESEND_API_KEY`, `REPORT_TO`, `REPORT_FROM` | secrets, optional | Email delivery |
| `GITHUB_TOKEN` | secret, optional | GitHub issue delivery |

### Email delivery (optional, Resend)

1. In Resend, verify a domain you own (Domains → Add domain, add the DNS records it lists).
2. Create an API key with **Sending access** (optionally restricted to that domain).
3. Set the three secrets (each prompts for the value; nothing goes in the repository):

```sh
npx wrangler secret put RESEND_API_KEY   # the re_… key
npx wrangler secret put REPORT_TO        # where reports go; a comma list of up to 5 is allowed
npx wrangler secret put REPORT_FROM      # e.g. "Graveyard Shift <reports@your-verified-domain>"
```

`REPORT_FROM` must be an address on the domain verified in Resend. Secrets take effect without a deploy.
Undelivered reports from the last 48 h are emailed by the next daily cron run.

### GitHub issue delivery (optional)

Set `GITHUB_REPO = "your-account/your-repo"` in `wrangler.toml` and deploy. Create a fine-grained
personal access token: Repository access → Only select repositories → that repository; Repository
permissions → **Issues: Read and write** (Metadata: Read-only is added automatically). Then run
`npx wrangler secret put GITHUB_TOKEN`. Create a `website-feedback` label in the repository; `bug` and
`enhancement` are GitHub's defaults.

## Reading stored reports

Every accepted report is in the `reports` table, delivered or not:

```sh
npx wrangler d1 execute graveyard-shift-leaderboard --remote --command "SELECT id, datetime(created_at/1000,'unixepoch') AS at, kind, message, contact, delivered_email, delivered_issue FROM reports ORDER BY id DESC LIMIT 50"
```
