// EC1 — Earned GOLD (Coins) primitive: atomic, idempotent, race-safe credit / debit /
// transfer. The keystone every coin-moving feature (template sales, referral rewards,
// paid-AI) builds on. Discipline (hardened per adversarial review):
//   - a per-profile advisory lock SERIALIZES all coin ops for a profile inside the
//     transaction, so balance read + check + write can't interleave (no overspend);
//   - EVERY money move requires a non-empty server-generated idempotency key
//     (reference_id), and replays are bound to a FINGERPRINT (amount + type +
//     counterparty) — a key reused for a different op is rejected, not silently replayed;
//   - coin_balances.CHECK(balance >= 0) and the ledger sign/type CHECK are DB backstops;
//   - the raw in-tx helpers are NOT exported — features compose via coinsTransaction()
//     / the wrappers, which always run inside sql.begin (the advisory xact lock is
//     worthless outside a transaction, so we never let a caller pass the root sql).

export const MAX_COIN_AMOUNT = 100_000_000;

export function validateCoinAmount(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_COIN_AMOUNT) return null;
  return n;
}

export function isValidCoinRef(referenceId) {
  return typeof referenceId === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(referenceId);
}

async function lockProfile(tx, profileId) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'coin:' + Number(profileId)})::bigint)`;
}

async function balanceOf(tx, profileId) {
  const rows = await tx`SELECT balance FROM coin_balances WHERE profile_id = ${Number(profileId)}`;
  return rows.length ? Number(rows[0].balance) : 0;
}

async function priorByRef(tx, profileId, referenceId) {
  const rows = await tx`
    SELECT delta, type, counterparty_profile_id AS cpid FROM coin_ledger
    WHERE profile_id = ${Number(profileId)} AND reference_id = ${referenceId}
    LIMIT 1
  `;
  return rows.length ? rows[0] : null;
}

function fingerprintMatches(prior, { delta, type, counterpartyProfileId }) {
  const priorCp = prior.cpid == null ? null : Number(prior.cpid);
  const wantCp = counterpartyProfileId == null ? null : Number(counterpartyProfileId);
  return Number(prior.delta) === delta && String(prior.type) === type && priorCp === wantCp;
}

// --- raw in-transaction helpers (module-private; require a real tx + a valid ref) ---

async function _credit(tx, { profileId, amount, type = 'CREDIT', reason = null, referenceId, counterpartyProfileId = null }) {
  const amt = validateCoinAmount(amount);
  if (amt === null) return { ok: false, reason: 'invalid-amount' };
  if (!isValidCoinRef(referenceId)) return { ok: false, reason: 'invalid-reference' };
  await lockProfile(tx, profileId);
  const prior = await priorByRef(tx, profileId, referenceId);
  if (prior) {
    if (!fingerprintMatches(prior, { delta: amt, type, counterpartyProfileId })) {
      return { ok: false, reason: 'idempotency-key-reused' };
    }
    return { ok: true, replayed: true, balance: await balanceOf(tx, profileId) };
  }
  const rows = await tx`
    INSERT INTO coin_balances (profile_id, balance) VALUES (${Number(profileId)}, ${amt})
    ON CONFLICT (profile_id) DO UPDATE SET balance = coin_balances.balance + ${amt}, updated_at = NOW()
    RETURNING balance
  `;
  await tx`
    INSERT INTO coin_ledger (profile_id, delta, type, reason, reference_id, counterparty_profile_id)
    VALUES (${Number(profileId)}, ${amt}, ${type}, ${reason}, ${referenceId}, ${counterpartyProfileId == null ? null : Number(counterpartyProfileId)})
  `;
  return { ok: true, replayed: false, balance: Number(rows[0].balance) };
}

async function _debit(tx, { profileId, amount, type = 'DEBIT', reason = null, referenceId, counterpartyProfileId = null }) {
  const amt = validateCoinAmount(amount);
  if (amt === null) return { ok: false, reason: 'invalid-amount' };
  if (!isValidCoinRef(referenceId)) return { ok: false, reason: 'invalid-reference' };
  await lockProfile(tx, profileId);
  const prior = await priorByRef(tx, profileId, referenceId);
  if (prior) {
    if (!fingerprintMatches(prior, { delta: -amt, type, counterpartyProfileId })) {
      return { ok: false, reason: 'idempotency-key-reused' };
    }
    return { ok: true, replayed: true, balance: await balanceOf(tx, profileId) };
  }
  const bal = await balanceOf(tx, profileId);
  if (bal < amt) return { ok: false, reason: 'insufficient-coins', balance: bal };
  const rows = await tx`
    UPDATE coin_balances SET balance = balance - ${amt}, updated_at = NOW()
    WHERE profile_id = ${Number(profileId)} AND balance >= ${amt}
    RETURNING balance
  `;
  if (!rows.length) return { ok: false, reason: 'insufficient-coins', balance: bal };
  await tx`
    INSERT INTO coin_ledger (profile_id, delta, type, reason, reference_id, counterparty_profile_id)
    VALUES (${Number(profileId)}, ${-amt}, ${type}, ${reason}, ${referenceId}, ${counterpartyProfileId == null ? null : Number(counterpartyProfileId)})
  `;
  return { ok: true, replayed: false, balance: Number(rows[0].balance) };
}

// Sentinel so a soft-fail mid-transfer (e.g. recipient ref collision) rolls the whole
// transfer back instead of committing a half-applied debit.
class CoinAbort extends Error {
  constructor(result) { super('coin-abort'); this.result = result; }
}

// --- public API: always runs inside sql.begin ---

// Atomic player-to-player transfer. Locks BOTH profiles in id order (deadlock-safe),
// debits `from`, credits `to`. If either leg soft-fails, the whole transfer rolls back.
export async function transferCoins(sql, { fromProfileId, toProfileId, amount, reason = null, referenceId }) {
  const from = Number(fromProfileId), to = Number(toProfileId);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) return { ok: false, reason: 'invalid-profile' };
  if (from === to) return { ok: false, reason: 'self-transfer' };
  if (validateCoinAmount(amount) === null) return { ok: false, reason: 'invalid-amount' };
  if (!isValidCoinRef(referenceId)) return { ok: false, reason: 'invalid-reference' };
  try {
    return await sql.begin(async (tx) => {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      await lockProfile(tx, lo);
      await lockProfile(tx, hi);
      const debit = await _debit(tx, { profileId: from, amount, type: 'TRANSFER_OUT', reason, referenceId, counterpartyProfileId: to });
      if (!debit.ok) throw new CoinAbort(debit);
      const credit = await _credit(tx, { profileId: to, amount, type: 'TRANSFER_IN', reason, referenceId, counterpartyProfileId: from });
      if (!credit.ok) throw new CoinAbort(credit); // rolls back the debit
      return { ok: true, replayed: debit.replayed || credit.replayed, fromBalance: debit.balance, toBalance: credit.balance };
    });
  } catch (e) {
    if (e instanceof CoinAbort) return e.result;
    throw e;
  }
}

// Single credit / debit, each in its own transaction.
export function creditCoins(sql, opts) { return sql.begin((tx) => _credit(tx, opts)); }
export function debitCoins(sql, opts) { return sql.begin((tx) => _debit(tx, opts)); }

// Atomic multi-op composer for features that move coins alongside other writes
// (e.g. template remix = debit buyer + credit author + duplicate world, all-or-nothing).
// The callback receives in-transaction credit/debit bound to a real tx — callers can
// never accidentally run a coin op outside a transaction.
export function coinsTransaction(sql, fn) {
  return sql.begin((tx) => fn({
    credit: (opts) => _credit(tx, opts),
    debit: (opts) => _debit(tx, opts),
    tx,
  }));
}

export function getCoinBalance(sql, profileId) {
  return sql`SELECT balance FROM coin_balances WHERE profile_id = ${Number(profileId)}`
    .then((rows) => (rows.length ? Number(rows[0].balance) : 0));
}
