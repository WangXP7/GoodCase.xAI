# Plan 002: Remove bypass flag from world-claim response body

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9fd0eaf..HEAD -- netlify/functions/world-claim.mjs`
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

`netlify/functions/world-claim.mjs` includes `bypass: testBypassPayment()` in two
JSON success responses (lines 70 and 92). The bypass flag is read from
`WORLDS_TEST_BYPASS_PAYMENT` env var — a test-only control that skips on-chain
payment verification. Emitting this value in production responses:

1. Leaks deployment configuration state to all authenticated users.
2. If `WORLDS_TEST_BYPASS_PAYMENT=1` is accidentally set in production (e.g. copied
   from a dev config), clients observe `bypass: true` in the response and the handler
   silently accepts world claims with no payment, draining the world inventory.

The fix removes the `bypass` field from both responses. The server-side flag remains
in place (it still controls whether bypass is active) — only the response disclosure
is removed.

## Current state

- `netlify/functions/world-claim.mjs` — world purchase handler.

Current code at `world-claim.mjs:63-72` (the `quote` action response):
```js
    if (action === 'quote') {
      if (world.status !== 'unclaimed') return errorResponse('World is not for sale', 409, origin);
      return jsonResponse({
        worldId,
        priceUsdc: String(price),
        recipientWallet: process.env.TINYWORLD_PAYMENT_WALLET || '',
        tokenMint: worldsUsdcMint(),
        bypass: testBypassPayment(),
      }, origin);
    }
```

Current code at `world-claim.mjs:77-93` (the bypass-path confirm response):
```js
    // Test bypass: real ownership flip + full records, no wallet/payment required.
    if (testBypassPayment()) {
      ...
      return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified: false, bypass: true }, origin, 201);
    }
```

The `testBypassPayment()` function (lines 21–28) reads the env var and is used
correctly as a server-side gate — only the returned value in responses needs removal.

Repo conventions: 2-space indent, single quotes, semicolons, trailing commas in objects.

## Commands you will need

| Purpose    | Command                       | Expected on success         |
|------------|-------------------------------|-----------------------------|
| Tests      | `npm run test:unit`           | 65 tests pass, 0 failures   |
| Check      | `npm run check`               | exit 0                      |

## Scope

**In scope** (the only files you should modify):
- `netlify/functions/world-claim.mjs`

**Out of scope** (do NOT touch):
- `netlify/functions/world-claim.mjs` — do NOT remove the `testBypassPayment()` function
  itself or the `if (testBypassPayment())` branch; only remove the field from responses
- Any other files

## Git workflow

- Branch: `advisor/002-bypass-flag-leak`
- Commit message style: `Remove bypass flag from world-claim response body`
- Do NOT push or open a PR.

## Steps

### Step 1: Remove bypass from the `quote` response (line 70)

In `netlify/functions/world-claim.mjs`, remove the `bypass: testBypassPayment(),` line
from the `quote` JSON response. The object should go from:
```js
      return jsonResponse({
        worldId,
        priceUsdc: String(price),
        recipientWallet: process.env.TINYWORLD_PAYMENT_WALLET || '',
        tokenMint: worldsUsdcMint(),
        bypass: testBypassPayment(),
      }, origin);
```
to:
```js
      return jsonResponse({
        worldId,
        priceUsdc: String(price),
        recipientWallet: process.env.TINYWORLD_PAYMENT_WALLET || '',
        tokenMint: worldsUsdcMint(),
      }, origin);
```

**Verify**: `grep -n "bypass" netlify/functions/world-claim.mjs`
→ Should return only: the function definition (`function testBypassPayment`), the `if (testBypassPayment())` branch condition, and the comment lines. Must NOT include a response object property `bypass:`.

### Step 2: Remove bypass from the bypass-path confirm response (line 92)

Change:
```js
      return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified: false, bypass: true }, origin, 201);
```
to:
```js
      return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified: false }, origin, 201);
```

**Verify**: `grep -n "bypass: true\|bypass: false" netlify/functions/world-claim.mjs`
→ Must return no matches.

### Step 3: Run the test suite

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

### Step 4: Run the static check

**Verify**: `npm run check`
→ exit 0

## Test plan

No new tests in this plan. The existing suite confirms no regressions. Any client-side
code that depended on `bypass` in the response will stop receiving it; no server behavior
changes.

## Done criteria

- [ ] `npm run test:unit` exits 0; 65 tests pass
- [ ] `npm run check` exits 0
- [ ] `grep -n "bypass:" netlify/functions/world-claim.mjs` returns NO response object property lines (only the `testBypassPayment()` function definition, the `if (testBypassPayment())` condition line, and comments)
- [ ] Only `netlify/functions/world-claim.mjs` is modified (`git status`)

## STOP conditions

- The code at lines 70 and 92 does not match the "Current state" excerpts.
- After removing the fields, `npm run test:unit` fails.
- You find a test that asserts `bypass` is in a response — report it rather than deleting it.

## Maintenance notes

- The `testBypassPayment()` function and the `if (testBypassPayment())` branch should
  remain in place for development use. Only the response disclosure is removed.
- If the client-side claim flow needs to know whether it's running in test mode, add
  a dedicated test-only console.warn or use a non-production flag pattern that can't
  accidentally reach a prod deploy.
