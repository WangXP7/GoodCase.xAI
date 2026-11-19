# Plan 001: Remove client-controlled payment recipient from wallet-payments handler

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9fd0eaf..HEAD -- netlify/functions/wallet-payments.mjs`
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

`netlify/functions/wallet-payments.mjs:100` selects the Solana payment recipient
as `body.recipientWallet || TINYWORLD_PAYMENT_WALLET`. Because the request body
comes from the authenticated client, any logged-in user can supply their own wallet
address as `recipientWallet`, causing the server to create a payment intent that
directs funds to the attacker's wallet. The on-chain verification at claim time
(`world-claim.mjs:122`) then verifies that the payment went to `intent.recipient_wallet`
— which is the attacker's wallet — so the check passes and the world is claimed with
zero treasury revenue.

Removing the client-supplied value from the recipient selection ensures the payment
always goes to the server-configured `TINYWORLD_PAYMENT_WALLET`.

## Current state

- `netlify/functions/wallet-payments.mjs` — Solana Pay intent creation handler.
  The vulnerability is on line 100.

Current code at `wallet-payments.mjs:98-103`:
```js
    if (action !== 'create') return errorResponse('Unknown payment action', 400, origin);

    const recipient = String((body && body.recipientWallet) || solanaEnv('TINYWORLD_PAYMENT_WALLET', '')).trim();
    if (!isSolanaPublicKey(recipient)) {
      return errorResponse('TINYWORLD_PAYMENT_WALLET is not configured', 501, origin);
    }
```

`solanaEnv` is already imported at line 6:
```js
import { bytesToBase58, isSolanaPublicKey, solanaEnv, solanaPayUrl } from './lib/solana.mjs';
```

`solanaEnv` reads `TINYWORLD_PAYMENT_WALLET` from `process.env` or `Netlify.env`. The
fix simply removes the `body.recipientWallet` fallback so only the server-configured
value is used.

Repo conventions: 2-space indent, single quotes, semicolons. Match the surrounding code exactly.

## Commands you will need

| Purpose    | Command                       | Expected on success         |
|------------|-------------------------------|-----------------------------|
| Tests      | `npm run test:unit`           | 65 tests pass, 0 failures   |
| Check      | `npm run check`               | exit 0                      |

## Scope

**In scope** (the only files you should modify):
- `netlify/functions/wallet-payments.mjs`

**Out of scope** (do NOT touch, even though they look related):
- `netlify/functions/world-claim.mjs` — that's a separate plan
- `netlify/functions/lib/solana.mjs` — the helper is correct as-is
- Any test files — a separate plan covers tests

## Git workflow

- Branch: `advisor/001-payment-recipient`
- Commit message style (match repo): `Fix client-controlled payment recipient in wallet-payments`
- Do NOT push or open a PR.

## Steps

### Step 1: Apply the one-line fix

In `netlify/functions/wallet-payments.mjs`, change line 100 from:
```js
    const recipient = String((body && body.recipientWallet) || solanaEnv('TINYWORLD_PAYMENT_WALLET', '')).trim();
```
to:
```js
    const recipient = String(solanaEnv('TINYWORLD_PAYMENT_WALLET', '')).trim();
```

The `body && body.recipientWallet` part is removed entirely. The surrounding lines (101–103) stay unchanged.

**Verify**: `grep -n "recipientWallet" netlify/functions/wallet-payments.mjs`
→ Must return ONLY lines inside `paymentDto()` (line 22, `recipientWallet: row.recipient_wallet`) and the `paymentDto(rows[0])` return. The word `body.recipientWallet` must NOT appear.

### Step 2: Run the test suite

**Verify**: `npm run test:unit`
→ `ℹ pass 65`, `ℹ fail 0`

### Step 3: Run the static check

**Verify**: `npm run check`
→ exit 0 with no errors

## Test plan

No new tests in this plan — a dedicated test plan (plans/005) covers the handler tests.
The existing 65-test suite confirms no regressions.

## Done criteria

- [ ] `npm run test:unit` exits 0; 65 tests pass
- [ ] `npm run check` exits 0
- [ ] `grep -n "body.recipientWallet\|body && body.recipientWallet" netlify/functions/wallet-payments.mjs` returns no matches
- [ ] `grep -n "recipientWallet" netlify/functions/wallet-payments.mjs` returns only the DTO line (`recipientWallet: row.recipient_wallet`) and any response serialization — NOT the recipient selection at line 100
- [ ] Only `netlify/functions/wallet-payments.mjs` is modified (`git status`)

## STOP conditions

- The code at line 100 does not match the "Current state" excerpt (file has drifted).
- `npm run test:unit` fails after the change.
- Removing `body.recipientWallet` reveals a test that was testing that behavior — investigate rather than delete the test.

## Maintenance notes

- The `world-claim.mjs` handler's `quote` action (line 68) already correctly exposes `recipientWallet: process.env.TINYWORLD_PAYMENT_WALLET` from server config to the client, so the client UI can show the correct payment destination without influencing it.
- If a multi-merchant scenario is ever added (different worlds → different recipients), the recipient must come from a server-side mapping keyed on world ID, never from the client body.
