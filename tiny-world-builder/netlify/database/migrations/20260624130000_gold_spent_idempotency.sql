-- E3 GOLD-spend idempotency.
-- The spend endpoint stores a client idempotency key in reference_id so a retried
-- request never double-debits. This partial unique index enforces one spend per
-- (wallet, reference_id); combined with the per-wallet advisory lock in the endpoint
-- it makes spends both idempotent and race-safe. Allowance/refund rows are unaffected
-- (the predicate covers only keyed GOLD_SPENT rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_spent_wallet_ref
  ON gold_ledger_events (wallet, reference_id)
  WHERE type = 'GOLD_SPENT' AND reference_id IS NOT NULL;
