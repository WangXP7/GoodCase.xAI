-- gold_ledger_events: append-only ledger for GOLD (non-withdrawable gameplay currency)
-- Follows mmo-core package: ALLOWANCE_RECALCULATED, GOLD_SPENT, GOLD_REFUNDED
CREATE TABLE IF NOT EXISTS gold_ledger_events (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ALLOWANCE_RECALCULATED', 'GOLD_SPENT', 'GOLD_REFUNDED')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  reason TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_ledger_wallet_cycle ON gold_ledger_events (wallet, cycle_id);
CREATE INDEX IF NOT EXISTS idx_gold_ledger_created ON gold_ledger_events (created_at DESC);
