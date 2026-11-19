-- P1 — Stripe: buy GOLD packs with real money. This table is the idempotency + audit
-- surface for the webhook: each Stripe checkout session credits Earned GOLD exactly once
-- (unique session_id), even if Stripe re-delivers the event.
-- A row is created PENDING when the Checkout Session is created (provenance: only
-- sessions WE created can credit GOLD), then transitioned to completed by the webhook.
CREATE TABLE IF NOT EXISTS stripe_payments (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  coins BIGINT NOT NULL CHECK (coins > 0),
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_profile ON stripe_payments (profile_id, created_at DESC);
