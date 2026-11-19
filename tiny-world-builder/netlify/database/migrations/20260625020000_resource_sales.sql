-- E5 — sell harvested resources for Earned GOLD. This connects the farming/mining/
-- harvesting loop (which fills player_resources) to the spendable economy: a player
-- converts fish/meat/plants/ore into Earned GOLD (Coins). This table is the durable,
-- idempotent operation log (one sale per (profile, idempotency_key)).
CREATE TABLE IF NOT EXISTS resource_sales (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fish BIGINT NOT NULL DEFAULT 0,
  meat BIGINT NOT NULL DEFAULT 0,
  plants BIGINT NOT NULL DEFAULT 0,
  ore BIGINT NOT NULL DEFAULT 0,
  gold_credited BIGINT NOT NULL CHECK (gold_credited > 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_sales_profile_key ON resource_sales (profile_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_resource_sales_profile ON resource_sales (profile_id, created_at DESC);
