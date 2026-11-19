# Plan 004: Wrap world-claim post-atomic bookkeeping in a database transaction

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

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 002 (also modifies world-claim.mjs; apply 002 first to avoid a merge conflict)
- **Category**: bug
- **Planned at**: commit `9fd0eaf`, 2026-06-12

## Why this matters

After the ownership flip that atomically claims a world (line 133–138 in
`world-claim.mjs`), three bookkeeping writes happen sequentially outside any
transaction (lines 142–156):
1. `UPDATE wallet_payment_intents SET status = 'paid'`
2. `INSERT INTO world_claims`
3. `UPDATE world_economy_state SET claimed_count = claimed_count + 1`
4. `INSERT INTO player_resources ... ON CONFLICT DO NOTHING`

If the Netlify function crashes, a network timeout fires, or a DB error occurs
between any two of these statements, the world is owned (the atomic flip succeeded)
but one or more bookkeeping rows are missing. The economy counter drifts from the
real owned-world count; the `player_resources` row may be absent (breaking the
harvest dashboard); the `world_claims` audit row may be missing.

The comment in the code already says "Best-effort bookkeeping" — this plan upgrades
it to transactional bookkeeping so either all four writes succeed or all four are
rolled back (leaving the world claimed but with a retriable state).

Note: the ownership flip itself stays OUTSIDE the transaction (its atomicity depends
on it being a single-statement conditional UPDATE). The transaction wraps only the
four bookkeeping writes that follow.

## Current state

- `netlify/functions/world-claim.mjs` — world purchase handler.
- DB library: `postgres` npm package (`netlify/functions/lib/db.mjs`). Its transaction
  API is `sql.begin(async sql => { ... })`. The `sql` parameter inside the callback
  is a transaction-scoped client; all tagged-template queries on it participate in
  the transaction.

Current code at `world-claim.mjs:140-158` (the section to wrap):
```js
    // Best-effort bookkeeping after the atomic win.
    await sql`
      UPDATE wallet_payment_intents
      SET status = 'paid', signature = ${signature || intent.signature}, updated_at = NOW()
      WHERE id = ${paymentIntentId} AND profile_id = ${profile.id}
    `;
    await sql`
      INSERT INTO world_claims (world_id, buyer_profile_id, seller_profile_id, payment_intent_id, price_usdc, signature, status)
      VALUES (${worldId}, ${profile.id}, NULL, ${paymentIntentId}, ${price}, ${signature || null}, ${verified ? 'completed' : 'verified'})
    `;
    await sql`
      UPDATE world_economy_state SET claimed_count = claimed_count + 1, updated_at = NOW() WHERE id = 1
    `;
    await sql`
      INSERT INTO player_resources (profile_id) VALUES (${profile.id}) ON CONFLICT (profile_id) DO NOTHING
    `;

    return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified }, origin, 201);
```

The `sql` variable on line 50 is the raw `getSql()` client (not a transaction). Inside
`sql.begin(async sql => { ... })`, the callback's `sql` parameter shadows the outer
one and is transaction-scoped.

Repo conventions: 2-space indent, single quotes, semicolons. The `postgres` library's
tagged-template syntax is the same inside or outside a transaction.

## Commands you will need

| Purpose    | Command                       | Expected on success         |
|------------|-------------------------------|-----------------------------|
| Tests      | `npm run test:unit`           | 65 tests pass, 0 failures   |
| Check      | `npm run check`               | exit 0                      |

## Scope

**In scope** (the only files you should modify):
- `netlify/functions/world-claim.mjs`

**Out of scope** (do NOT touch):
- `netlify/functions/lib/db.mjs` — no changes to the DB module
- Any other files

**Important**: Plan 002 must be applied (or its changes merged) before this plan,
because both modify `world-claim.mjs`. If 002 is already applied, the `bypass: true`
field will already be absent from line 92; do not re-add it.

## Git workflow

- Branch: `advisor/004-claim-transaction` (branch from the result of 002 if sequential,
  or from main and manually reconcile if running independently)
- Commit message style: `Wrap world-claim bookkeeping in a transaction`
- Do NOT push or open a PR.

## Steps

### Step 1: Confirm dependency is applied

**Verify**: `grep -n "bypass: true\|bypass: false" netlify/functions/world-claim.mjs`
→ Must return no matches (plan 002 was applied). If it returns matches, apply plan 002
first (or do it now — remove `bypass: testBypassPayment()` from line ~70 and `bypass: true`
from the bypass-path response at line ~92).

### Step 2: Update the comment for the bookkeeping block

Change the comment at the start of the bookkeeping block from:
```js
    // Best-effort bookkeeping after the atomic win.
```
to:
```js
    // Bookkeeping after the atomic win — wrapped in a transaction so all four
    // writes succeed together or roll back together.
```

### Step 3: Wrap the four bookkeeping queries in sql.begin()

Replace the four sequential `await sql\`` calls and the return statement with a
`sql.begin()` transaction. The `sql` variable inside the callback shadows the outer
one; rename variables if needed to avoid confusion.

Replace this block (lines 141-158 in the original file, after step 1):
```js
    // Bookkeeping after the atomic win — wrapped in a transaction so all four
    // writes succeed together or roll back together.
    await sql`
      UPDATE wallet_payment_intents
      SET status = 'paid', signature = ${signature || intent.signature}, updated_at = NOW()
      WHERE id = ${paymentIntentId} AND profile_id = ${profile.id}
    `;
    await sql`
      INSERT INTO world_claims (world_id, buyer_profile_id, seller_profile_id, payment_intent_id, price_usdc, signature, status)
      VALUES (${worldId}, ${profile.id}, NULL, ${paymentIntentId}, ${price}, ${signature || null}, ${verified ? 'completed' : 'verified'})
    `;
    await sql`
      UPDATE world_economy_state SET claimed_count = claimed_count + 1, updated_at = NOW() WHERE id = 1
    `;
    await sql`
      INSERT INTO player_resources (profile_id) VALUES (${profile.id}) ON CONFLICT (profile_id) DO NOTHING
    `;

    return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified }, origin, 201);
```

with:
```js
    // Bookkeeping after the atomic win — wrapped in a transaction so all four
    // writes succeed together or roll back together.
    await sql.begin(async sql => {
      await sql`
        UPDATE wallet_payment_intents
        SET status = 'paid', signature = ${signature || intent.signature}, updated_at = NOW()
        WHERE id = ${paymentIntentId} AND profile_id = ${profile.id}
      `;
      await sql`
        INSERT INTO world_claims (world_id, buyer_profile_id, seller_profile_id, payment_intent_id, price_usdc, signature, status)
        VALUES (${worldId}, ${profile.id}, NULL, ${paymentIntentId}, ${price}, ${signature || null}, ${verified ? 'completed' : 'verified'})
      `;
      await sql`
        UPDATE world_economy_state SET claimed_count = claimed_count + 1, updated_at = NOW() WHERE id = 1
      `;
      await sql`
        INSERT INTO player_resources (profile_id) VALUES (${profile.id}) ON CONFLICT (profile_id) DO NOTHING
      `;
    });

    return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified }, origin, 201);
```

Key points:
- `sql.begin(async sql => { ... })` is the `postgres` package's transaction API.
- The callback parameter `sql` shadows the outer `sql` — this is intentional and the
  correct pattern for this library.
- All four `await sql\`` calls move inside the callback, adding one level of indentation.
- The `return jsonResponse(...)` stays OUTSIDE the `sql.begin()` callback.
- Indentation inside the callback is 6 spaces (existing 4-space indent + 2 for the
  callback body), matching the surrounding 2-space style.

**Verify**: `grep -n "sql.begin\|Best-effort" netlify/functions/world-claim.mjs`
→ Must show `sql.begin(async sql =>` at the appropriate line, and NO "Best-effort" text.

### Step 4: Run the test suite

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

### Step 5: Run the static check

**Verify**: `npm run check`
→ exit 0

## Test plan

No new tests in this plan. The `postgres` package's `sql.begin()` is well-tested
upstream. The existing 65-test suite confirms no regressions. A full integration test
(requiring a real DB) is out of scope; plans/005 covers handler-level testing.

## Done criteria

- [ ] `npm run test:unit` exits 0; 65 tests pass
- [ ] `npm run check` exits 0
- [ ] `grep -n "sql.begin" netlify/functions/world-claim.mjs` returns at least one match in the payment-confirm path
- [ ] `grep -n "Best-effort" netlify/functions/world-claim.mjs` returns no matches
- [ ] Only `netlify/functions/world-claim.mjs` is modified (`git status`)

## STOP conditions

- The code at lines 141-158 does not match the "Current state" excerpt (and plan 002
  has already been applied — some differences are expected there; focus on the
  bookkeeping block specifically).
- `npm run test:unit` fails after the change.
- You discover `postgres`'s `sql.begin` is not available on the `getSql()` return value
  — verify with `grep -n "postgres\|max:" netlify/functions/lib/db.mjs` and confirm it's
  the `postgres` package (it is, as of this plan's writing).
- The transaction wrapping causes the outer `try/catch` to no longer handle
  `isDatabaseUnavailable` or `isMissingClaimSchema` errors correctly — check that errors
  thrown inside `sql.begin()` propagate out to the existing `catch (err)` handler (they do,
  since it's `await`-ed, but stop and report if not).

## Maintenance notes

- The `sql.begin()` callback uses a shadowing `sql` parameter — this is the `postgres`
  library's designed pattern. Do not rename the callback parameter to avoid shadowing;
  doing so would require changing all four `await sql\`` calls inside it.
- If the bypass path (`if (testBypassPayment()) { ... }`) at the top of the confirm
  handler also needs transactional bookkeeping, it already has separate `await sql\``
  calls (lines 86-91); apply the same pattern to that branch in a follow-up.
- If a third-party error (on-chain verification failure) occurs after the atomic ownership
  flip but before `sql.begin()` returns, the world is in a `draft` state with a failed
  intent. A future cleanup job or admin endpoint should handle these orphaned claims.
