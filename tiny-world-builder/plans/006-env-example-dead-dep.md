# Plan 006: Add .env.example and remove dead @open-pets/client dependency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9fd0eaf..HEAD -- package.json`
> If package.json changed since this plan was written, verify the
> `@open-pets/client` entry still exists before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `9fd0eaf`, 2026-06-12

## Why this matters

Two independent housekeeping tasks with no dependencies on each other:

1. **No `.env.example`**: A new contributor cloning the repo must grep 6 source
   files to discover that `NETLIFY_DATABASE_URL`, `WORLDS_SERVICE_TOKEN`,
   `TINYWORLD_WALLET_SESSION_SECRET`, `OPENAI_API_KEY`, and others are required.
   `docs/worlds.md` has a partial list but it's buried. An `.env.example` at the
   repo root is the standard convention and reduces onboarding friction.

2. **Dead `@open-pets/client` dependency**: `package.json` lists
   `"@open-pets/client": "^2.1.1"` as a runtime dependency but the package is
   only referenced in comments (confirmed by grep across all `.js`, `.mjs`, `.html`
   files). It adds to `npm audit` noise, increases install size, and suggests the
   integration is complete when it isn't.

## Current state

- `package.json` lists `"@open-pets/client": "^2.1.1"` in `"dependencies"`.
- No `.env.example` file exists in the repo root.
- `docs/worlds.md` has a partial env var table (lines 48–55); that table is the
  canonical reference for worlds-related vars.

Known env vars (sourced by grepping `netlify/functions/` and `party/index.js`):
- `NETLIFY_DATABASE_URL` / `DATABASE_URL` / `POSTGRES_URL` / `NETLIFY_DB_URL` — DB connection
- `TINYWORLD_WALLET_SESSION_SECRET` — wallet JWT signing secret (required for wallet login)
- `TINYWORLD_AUTH_SECRET` — fallback for wallet secret
- `WORLDS_SERVICE_TOKEN` — service-to-service auth for harvest grants
- `WORLDS_JOIN_SECRET` — HMAC secret for room join tokens (falls back to WORLDS_SERVICE_TOKEN)
- `TINYWORLD_PAYMENT_WALLET` — Solana public key for world purchase payments
- `TINYWORLD_TOKEN_MINT` — SPL token mint address
- `OPENAI_API_KEY` — AI world generation (optional; feature disabled when absent)
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_WS_URL` — LiveKit voice (optional)
- `URL` / `DEPLOY_PRIME_URL` / `DEPLOY_URL` — set automatically by Netlify
- `WORLDS_TEST_BYPASS_PAYMENT` — dev/test only; skip on-chain payment (NEVER set in prod)

Repo conventions: single quotes for strings; no bundler or build step for this file.

## Commands you will need

| Purpose    | Command                       | Expected on success         |
|------------|-------------------------------|-----------------------------|
| Tests      | `npm run test:unit`           | 65 tests pass, 0 failures   |
| Check      | `npm run check`               | exit 0                      |
| Verify dep | `node -e "require('@open-pets/client')"` | Error (package gone) |

## Scope

**In scope** (the only files you should create or modify):
- `.env.example` (create at repo root)
- `package.json` (remove one dependency entry)

**Out of scope** (do NOT touch):
- `package-lock.json` — do NOT delete or modify; `npm install` is not required and
  would regenerate it from scratch. The lock file will drift until the user runs
  `npm install` after merging — that is acceptable.
- `node_modules/` — do NOT delete
- Any source files

## Git workflow

- Branch: `advisor/006-env-example-dead-dep`
- Commit message style: `Add .env.example and remove unused @open-pets/client dep`
- Do NOT push or open a PR.

## Steps

### Step 1: Remove @open-pets/client from package.json

Edit `package.json` to remove the `"@open-pets/client": "^2.1.1"` line from
`"dependencies"`. The remaining dependencies are:
- `"@netlify/database": "^1.0.0"`
- `"@netlify/identity": "^1.2.0"`
- `"postgres": "^3.4.9"`

**Verify**: `grep "open-pets" package.json`
→ Must return no matches.

### Step 2: Confirm nothing imports the removed package

**Verify**: `grep -rn "open-pets/client\|require.*open-pets\|from.*open-pets" --include="*.js" --include="*.mjs" --include="*.html" . | grep -v node_modules | grep -v ".git"`
→ Must return no matches that are actual `import` or `require` calls. (Comments
referencing the package in `engine/world/49-worlds-avatar-picker.js` are fine — they
document planned future integration.)

### Step 3: Run the test suite

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

### Step 4: Run the static check

**Verify**: `npm run check`
→ exit 0

### Step 5: Create .env.example

Create `.env.example` at the repo root with this content (copy exactly):

```
# Tiny World Builder — local development environment variables
# Copy to .env and fill in the values for your local setup.
# Lines starting with # are comments and are ignored.

# ---- Database ----
# Netlify Postgres connection string (set automatically by Netlify CLI / netlify dev).
# For local dev, run: npm run db:local (see docs/worlds.md for setup).
NETLIFY_DATABASE_URL=postgres://user:password@localhost:5432/tinyworld

# ---- Auth ----
# Secret for signing wallet session JWTs. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TINYWORLD_WALLET_SESSION_SECRET=

# Fallback wallet secret (used if TINYWORLD_WALLET_SESSION_SECRET is not set).
# TINYWORLD_AUTH_SECRET=

# ---- World economy ----
# Shared secret between this server and the PartyKit room (harvest grants).
# Must match the WORLDS_SERVICE_TOKEN in partykit.json / your PartyKit deploy.
WORLDS_SERVICE_TOKEN=

# HMAC secret for signed room join tokens (falls back to WORLDS_SERVICE_TOKEN).
# WORLDS_JOIN_SECRET=

# ---- Solana payments ----
# Solana public key that receives world purchase payments.
# Leave blank to disable world purchasing (worlds will be unclaimed-only).
TINYWORLD_PAYMENT_WALLET=

# SPL token mint address (e.g. USDC on mainnet/devnet).
# TINYWORLD_TOKEN_MINT=

# ---- Optional integrations ----
# OpenAI API key for AI world generation (feature disabled when blank).
# OPENAI_API_KEY=

# LiveKit credentials for voice chat (feature disabled when blank).
# LIVEKIT_API_KEY=
# LIVEKIT_API_SECRET=
# LIVEKIT_WS_URL=

# ---- Netlify auto-set (do not set manually in prod) ----
# URL=https://your-site.netlify.app
# DEPLOY_PRIME_URL=
# DEPLOY_URL=

# ---- Dev/test only — NEVER set in production ----
# Skips on-chain payment verification so you can claim worlds locally.
# WORLDS_TEST_BYPASS_PAYMENT=1
```

**Verify**: `ls .env.example`
→ File exists.

**Verify**: `grep "TINYWORLD_WALLET_SESSION_SECRET\|WORLDS_SERVICE_TOKEN\|TINYWORLD_PAYMENT_WALLET" .env.example | wc -l`
→ Returns 3 (all three critical vars are documented).

### Step 6: Run tests again to confirm nothing changed

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

## Test plan

No new tests. The suite confirms no regressions.

## Done criteria

- [ ] `npm run test:unit` exits 0; 65 tests pass
- [ ] `npm run check` exits 0
- [ ] `grep "open-pets" package.json` returns no matches
- [ ] `.env.example` exists at repo root and contains `TINYWORLD_WALLET_SESSION_SECRET`, `WORLDS_SERVICE_TOKEN`, and `TINYWORLD_PAYMENT_WALLET`
- [ ] Only `package.json` and `.env.example` are modified/created (`git status`)

## STOP conditions

- `npm run test:unit` fails after removing the dependency (means something does import
  it at runtime — report the error).
- `npm run check` fails after creating `.env.example` (means the check validates
  the file's content — report what pattern fails).
- `grep -rn "from.*open-pets" ...` finds an actual import, not just a comment.

## Maintenance notes

- `package-lock.json` will be out of sync after the dependency removal until the user
  runs `npm install`. This is expected — note it to the user when reporting completion.
- If `@open-pets/client` integration is implemented in future (avatar picker in
  `engine/world/49-worlds-avatar-picker.js`), add it back to `package.json` and
  update `.env.example` with any required env vars.
- `.env.example` should be kept in sync with `docs/worlds.md`'s env var table.
  When new env vars are added to a Netlify function, update both files.
