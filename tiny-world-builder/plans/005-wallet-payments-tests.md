# Plan 005: Add handler-level tests for wallet-payments security invariants

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9fd0eaf..HEAD -- netlify/functions/wallet-payments.mjs netlify/functions/lib/auth.mjs`
> If either file changed since this plan was written, verify the "Current state"
> excerpts still match before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 001 (plan 001 must be applied before writing tests for it)
- **Category**: tests
- **Planned at**: commit `9fd0eaf`, 2026-06-12

## Why this matters

The security fix in plan 001 (client-controlled payment recipient) is a one-line
change that is easy to accidentally revert or re-introduce. The existing test suite
has no handler-level tests for any Netlify function — only library unit tests. This
plan adds tests that would have caught plan 001's bug and will catch any regression.

Node 26 (which this project runs on — confirmed via `node --version`) supports
`mock.module()` in `node:test`, allowing ESM module mocking with dynamic imports.

## Current state

- `tests/` contains: `wallet-auth.test.mjs`, `db-schema-errors.test.mjs`, `party.test.mjs`,
  `flight-combat-math.test.mjs`, `model-stamp-materials.test.mjs`, `appearance-surface.test.mjs`,
  `wallet-auth.test.mjs` (and the new `wallet-auth.test.mjs` from plan's tests). No handler
  tests exist yet.
- `netlify/functions/wallet-payments.mjs` exports `default` as `async function(request)`.
- `netlify/functions/lib/auth.mjs` exports `createWalletSessionToken`, `getAuthUser`, etc.
- The DB library `netlify/functions/lib/db.mjs` exports `getSql`.
- `netlify/functions/lib/profiles.mjs` exports `ensureProfile` and also calls `getSql()`.
- Test command: `node --test tests/*.test.mjs` (run via `npm run test:unit`).

Pattern to follow: `tests/wallet-auth.test.mjs` — direct imports from lib, `process.env`
mutation per test, `assert.equal` / `assert.ok` assertions.

## Commands you will need

| Purpose    | Command                          | Expected on success         |
|------------|----------------------------------|-----------------------------|
| Tests      | `npm run test:unit`              | all tests pass, 0 failures  |
| Check      | `npm run check`                  | exit 0                      |
| Node ver   | `node --version`                 | v26.x.x                     |

## Scope

**In scope** (the only files you should create or modify):
- `tests/wallet-payments.test.mjs` (create)

**Out of scope** (do NOT touch):
- `netlify/functions/wallet-payments.mjs` — plan 001 already fixed it; don't change it here
- Any existing test files
- Any source files

## Git workflow

- Branch: `advisor/005-wallet-payments-tests`
- Commit message style: `Add wallet-payments handler tests for auth and recipient invariants`
- Do NOT push or open a PR.

## Steps

### Step 1: Confirm plan 001 is applied

**Verify**: `grep -n "body.recipientWallet\|body && body.recipientWallet" netlify/functions/wallet-payments.mjs`
→ Must return no matches. If it does return matches, apply plan 001 first.

### Step 2: Create the test file

Create `tests/wallet-payments.test.mjs` with the following content.

Key technique: `mock.module()` must be called BEFORE the module under test is imported.
Since ESM static imports are hoisted, the handler import must be done with a dynamic
`await import()` after calling `mock.module()`. Do NOT add a static import for
`wallet-payments.mjs`.

```js
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createWalletSessionToken } from '../netlify/functions/lib/auth.mjs';

const TEST_WALLET = '11111111111111111111111111111111';
process.env.TINYWORLD_WALLET_SESSION_SECRET = 'tinyworld-wallet-test-secret';

// Build a minimal mock sql object whose tagged-template function returns an
// empty array (simulating "profile not found, will insert") for SELECT, and a
// single-row array for INSERT (simulating profile creation).
let mockSqlCallCount = 0;
function makeMockSql() {
  const sql = async (strings) => {
    mockSqlCallCount++;
    const query = Array.isArray(strings) ? strings[0] : '';
    if (/INSERT INTO profiles/i.test(query)) return [{ id: 1, auth0_id: 'wallet:' + TEST_WALLET, username: 'test_wallet', display_name: 'Wallet' }];
    if (/SELECT.*profiles/i.test(query)) return [{ id: 1, auth0_id: 'wallet:' + TEST_WALLET, username: 'test_wallet', display_name: 'Wallet' }];
    return [];
  };
  sql.begin = async (fn) => fn(sql);
  return sql;
}

// Mock db and profiles BEFORE importing the handler.
// Node 26 mock.module() intercepts ESM imports by resolved path.
mock.module('../netlify/functions/lib/db.mjs', {
  namedExports: {
    getSql: makeMockSql,
    isDatabaseUnavailable: () => false,
    isMissingRelations: () => false,
  },
});

// Dynamic import AFTER mocks are in place.
const { default: paymentsHandler } = await import('../netlify/functions/wallet-payments.mjs');

// Helper: build a POST /api/wallet/payments request with a wallet session token.
function makeRequest(body, extraHeaders = {}) {
  const token = createWalletSessionToken(TEST_WALLET);
  return new Request('https://tinyworld.example.com/api/wallet/payments', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Origin': 'https://tinyworld.example.com',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

test('wallet-payments: unauthenticated request returns 401', async () => {
  const request = new Request('https://tinyworld.example.com/api/wallet/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', amount: '1' }),
  });
  const response = await paymentsHandler(request);
  assert.equal(response.status, 401);
});

test('wallet-payments: OPTIONS preflight returns 204', async () => {
  const request = new Request('https://tinyworld.example.com/api/wallet/payments', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://tinyworld.example.com' },
  });
  const response = await paymentsHandler(request);
  assert.equal(response.status, 204);
});

test('wallet-payments: missing TINYWORLD_PAYMENT_WALLET returns 501', async () => {
  const saved = process.env.TINYWORLD_PAYMENT_WALLET;
  delete process.env.TINYWORLD_PAYMENT_WALLET;
  try {
    const response = await paymentsHandler(makeRequest({ action: 'create', amount: '1' }));
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.match(body.error, /TINYWORLD_PAYMENT_WALLET/i);
  } finally {
    if (saved !== undefined) process.env.TINYWORLD_PAYMENT_WALLET = saved;
  }
});

test('wallet-payments: body.recipientWallet is ignored; only env wallet is used', async () => {
  // This test verifies plan 001's security fix: even if the client sends a
  // recipientWallet in the body, the server must reject it (return 501) when
  // TINYWORLD_PAYMENT_WALLET is not set — not succeed using the client-supplied value.
  const saved = process.env.TINYWORLD_PAYMENT_WALLET;
  delete process.env.TINYWORLD_PAYMENT_WALLET;
  try {
    const response = await paymentsHandler(makeRequest({
      action: 'create',
      amount: '1',
      recipientWallet: TEST_WALLET,  // attacker-supplied recipient
    }));
    // Without a configured TINYWORLD_PAYMENT_WALLET, must return 501 regardless
    // of what recipientWallet the client sent.
    assert.equal(response.status, 501);
  } finally {
    if (saved !== undefined) process.env.TINYWORLD_PAYMENT_WALLET = saved;
  }
});
```

**Verify**: `ls tests/wallet-payments.test.mjs`
→ File exists.

### Step 3: Run the test suite

**Verify**: `npm run test:unit`
→ All previously passing tests still pass; the 4 new wallet-payments tests pass.
→ Output includes `wallet-payments: unauthenticated request returns 401 ✔` and the 3 other new tests.

### Step 4: Run the static check

**Verify**: `npm run check`
→ exit 0

## Test plan

The test file itself IS the test plan. Four tests:
1. Unauthenticated → 401 (auth boundary)
2. OPTIONS → 204 (CORS preflight)
3. Missing env → 501 (config guard)
4. Client `recipientWallet` ignored when env unset → 501 (regression for plan 001)

## Done criteria

- [ ] `tests/wallet-payments.test.mjs` exists
- [ ] `npm run test:unit` exits 0; all 4 new tests pass
- [ ] `npm run check` exits 0
- [ ] Only `tests/wallet-payments.test.mjs` is created (`git status`)

## STOP conditions

- `mock.module()` is not available in the installed Node version (`node --version` must
  be v22.3.0 or later; this project is on v26, so this should not occur — but report if
  `mock.module is not a function`).
- The dynamic `await import('../netlify/functions/wallet-payments.mjs')` fails because
  `@netlify/identity`'s `getUser` throws at import time rather than at call time. If this
  happens, add `mock.module('../netlify/functions/lib/auth.mjs', ...)` before the handler
  import, mocking `requireAuthUser` directly.
- A test that should return 501 instead returns a different status code — this means
  either the mock isn't in place (verify `mock.module` was called before the dynamic import)
  or plan 001 was not applied (check line 100 of wallet-payments.mjs).
- `npm run check` fails because the test file doesn't match the check's pattern — report
  what the check expects.

## Maintenance notes

- The `makeMockSql` approach is intentionally minimal. If more handler tests are added
  in future, extract the mock builder to `tests/helpers/mock-sql.mjs`.
- The test for `recipientWallet` being ignored (test 4) is the regression guard for
  plan 001. If someone re-introduces `body.recipientWallet` in the recipient selection,
  this test will start passing 201 instead of 501 — making it fail.
