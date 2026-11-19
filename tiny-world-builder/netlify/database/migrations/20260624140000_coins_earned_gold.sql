-- EC1 — "Earned GOLD" (Coins): the transferable in-game currency (owner decision D2).
-- Distinct from holdings-based Allowance GOLD (gold_ledger_events), which stays
-- non-transferable. Coins are earned (template sales, referral rewards, paid actions)
-- and spent/transferred player-to-player.
--
-- coin_balances is the source of truth for spend checks (CHECK keeps it >= 0, the
-- ultimate backstop against overspend). coin_ledger is the append-only audit trail
-- and the idempotency surface.

CREATE TABLE IF NOT EXISTS coin_balances (
  profile_id BIGINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coin_ledger (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL CHECK (delta <> 0),
  type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT')),
  reason TEXT,
  reference_id TEXT,
  counterparty_profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Audit integrity: a credit must be positive, a debit negative — so a poisoned
  -- caller cannot record a positive DEBIT or negative CREDIT.
  CONSTRAINT coin_ledger_sign_type CHECK (
    (delta > 0 AND type IN ('CREDIT', 'TRANSFER_IN')) OR
    (delta < 0 AND type IN ('DEBIT', 'TRANSFER_OUT'))
  )
);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_profile ON coin_ledger (profile_id, created_at DESC);

-- Idempotency: at most one ledger entry per (profile_id, reference_id) when a key is
-- supplied, so a retried credit/debit/transfer never double-applies.
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_ledger_profile_ref
  ON coin_ledger (profile_id, reference_id)
  WHERE reference_id IS NOT NULL;
