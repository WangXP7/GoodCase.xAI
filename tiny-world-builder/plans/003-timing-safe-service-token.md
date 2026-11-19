# Plan 003: Use timing-safe comparison for service token in world-resources

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9fd0eaf..HEAD -- netlify/functions/world-resources.mjs`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `9fd0eaf`, 2026-06-12

## Why this matters

`netlify/functions/world-resources.mjs:62` compares the `x-worlds-token` request header
against `WORLDS_SERVICE_TOKEN` with plain string inequality (`provided !== serviceToken`).
String comparison in JavaScript is not constant-time — it short-circuits on the first
mismatched byte. An attacker who can make many requests and measure response time can
enumerate the token one byte at a time (timing oracle attack).

The fix replaces the comparison with `timingSafeEqual` from Node's `node:crypto` module,
which runs in constant time regardless of where the strings diverge.

The same module already imports from `node:crypto` via `netlify/functions/lib/auth.mjs`'s
pattern; Node's `timingSafeEqual` operates on `Buffer` or `TypedArray` instances.

## Current state

- `netlify/functions/world-resources.mjs` — harvest grant endpoint.

Current code at `world-resources.mjs:1-5` (imports — currently no crypto import):
```js
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson } from './lib/http.mjs';
```

Current code at `world-resources.mjs:58-63`:
```js
    // ---- service-token grant (from the authoritative PartyKit room only) ----
    if (request.method === 'POST') {
      const serviceToken = process.env.WORLDS_SERVICE_TOKEN || '';
      const provided = request.headers.get('x-worlds-token') || '';
      if (!serviceToken || provided !== serviceToken) return errorResponse('Forbidden', 403, origin);
```

The pattern used in `netlify/functions/lib/auth.mjs` for timing-safe comparison
(see `auth.mjs:42-46`):
```js
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
```

We will replicate this pattern directly in `world-resources.mjs` rather than exporting
`constantTimeEqual` from `auth.mjs` (avoid coupling auth and resources modules).

Repo conventions: 2-space indent, single quotes, semicolons. Existing functions in the
file use the same style; add the helper in the same style.

## Commands you will need

| Purpose    | Command                       | Expected on success         |
|------------|-------------------------------|-----------------------------|
| Tests      | `npm run test:unit`           | 65 tests pass, 0 failures   |
| Check      | `npm run check`               | exit 0                      |

## Scope

**In scope** (the only files you should modify):
- `netlify/functions/world-resources.mjs`

**Out of scope** (do NOT touch):
- `netlify/functions/lib/auth.mjs` — do NOT export `constantTimeEqual` from there
- Any other files

## Git workflow

- Branch: `advisor/003-timing-safe-token`
- Commit message style: `Use timingSafeEqual for service token comparison in world-resources`
- Do NOT push or open a PR.

## Steps

### Step 1: Add crypto import

Add `import { timingSafeEqual } from 'node:crypto';` as the first line of
`netlify/functions/world-resources.mjs`, before the existing imports.

**Verify**: `head -3 netlify/functions/world-resources.mjs`
→ First line is `import { timingSafeEqual } from 'node:crypto';`

### Step 2: Add the constantTimeEqual helper

After the imports and before the first exported function or `export const config`,
add this helper function:

```js
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
```

**Verify**: `grep -n "constantTimeEqual\|timingSafeEqual" netlify/functions/world-resources.mjs`
→ Shows both the helper function definition and the import.

### Step 3: Replace the plain comparison

Change `world-resources.mjs:62` from:
```js
      if (!serviceToken || provided !== serviceToken) return errorResponse('Forbidden', 403, origin);
```
to:
```js
      if (!serviceToken || !constantTimeEqual(provided, serviceToken)) return errorResponse('Forbidden', 403, origin);
```

**Verify**: `grep -n "provided !== serviceToken" netlify/functions/world-resources.mjs`
→ Must return no matches (old pattern is gone).

### Step 4: Run the test suite

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

### Step 5: Run the static check

**Verify**: `npm run check`
→ exit 0

## Test plan

No new tests in this plan (timing attacks cannot be unit-tested meaningfully). The
existing suite confirms no regressions. The correctness of `constantTimeEqual` is
verifiable by inspection — it matches the audited pattern in `auth.mjs`.

## Done criteria

- [ ] `npm run test:unit` exits 0; 65 tests pass
- [ ] `npm run check` exits 0
- [ ] `grep -n "provided !== serviceToken" netlify/functions/world-resources.mjs` returns no matches
- [ ] `grep -n "timingSafeEqual" netlify/functions/world-resources.mjs` returns at least 2 matches (import + usage)
- [ ] Only `netlify/functions/world-resources.mjs` is modified (`git status`)

## STOP conditions

- The code at lines 60-63 does not match the "Current state" excerpt.
- `npm run test:unit` fails after the change.
- You discover `world-resources.mjs` already imports `timingSafeEqual` under a different name — report rather than create a duplicate.

## Maintenance notes

- If a second service-token-gated endpoint is added in future, extract `constantTimeEqual`
  to `netlify/functions/lib/http.mjs` (the shared HTTP utilities module) rather than
  duplicating it again.
- `WORLDS_SERVICE_TOKEN` should be a high-entropy random string (≥32 bytes of hex). If
  it's currently a low-entropy value, rotation is recommended alongside this fix.
