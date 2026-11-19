-- T2c — re-point the template marketplace to user-built world_shares.
-- Owner can list a share as a remixable template with an Earned GOLD price;
-- others pay GOLD to remix it (duplicate into their own editable build copy).
-- Builds on EC1 (coin_ledger) for payment + author payout.
ALTER TABLE world_shares ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE world_shares ADD COLUMN IF NOT EXISTS template_price BIGINT;          -- in Earned GOLD; NULL unless listed
ALTER TABLE world_shares ADD COLUMN IF NOT EXISTS template_author_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE world_shares ADD COLUMN IF NOT EXISTS remix_count INTEGER NOT NULL DEFAULT 0;

-- Price bounds: a listed template must have a non-negative, sane price.
DO $$ BEGIN
  ALTER TABLE world_shares ADD CONSTRAINT world_shares_template_price_ck
    CHECK (template_price IS NULL OR (template_price >= 0 AND template_price <= 1000000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_world_shares_is_template ON world_shares (is_template) WHERE is_template = TRUE;

-- Durable remix operation log: the idempotency surface for BOTH free and paid remixes
-- of shares (a retry with the same (buyer, key) returns the original build instead of
-- making a second one), and it binds a key to a specific share (reuse across shares is
-- rejected). Mirror of world_remixes but for world_shares sources.
CREATE TABLE IF NOT EXISTS share_remixes (
  id BIGSERIAL PRIMARY KEY,
  buyer_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL REFERENCES world_shares(id) ON DELETE CASCADE,
  build_id BIGINT REFERENCES builds(id) ON DELETE SET NULL,
  author_profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  price BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_share_remixes_buyer_key
  ON share_remixes (buyer_profile_id, idempotency_key);
