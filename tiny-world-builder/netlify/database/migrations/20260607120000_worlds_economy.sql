-- Worlds economy: the on-chain MMO layer (playworlds-style).
--
-- Adds the ownable-land model on top of the existing profiles / wallet / payment
-- schema. A "world" is a tile plot that moves through unclaimed -> draft ->
-- published. Owners earn a permanent tax cut when visitors harvest resources in
-- their published worlds. Real USDC purchases reuse wallet_payment_intents.
--
-- Durable here (the bank / source of truth for money + ownership):
--   worlds, player_resources, tax_ledger, world_claims, world_market_listings,
--   world_economy_state.
-- Ephemeral / real-time (node charges, animals, hearts, locks, regrowth timers,
-- and the fractional split accumulators) live in the authoritative PartyKit room
-- storage, which flushes WHOLE-unit deltas here.

-- The ownable land. Tile JSON in `data` uses world.schema.json v4, the same
-- shape buildWorldStateObject() / the builds table produce.
CREATE TABLE IF NOT EXISTS worlds (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,                  -- stable room-id suffix: room = 'world-' || slug
  kind TEXT NOT NULL DEFAULT 'purchasable',   -- 'starter' (official, pre-published) | 'purchasable'
  status TEXT NOT NULL DEFAULT 'unclaimed',   -- unclaimed | draft | published
  owner_profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',              -- 0..48 chars; required (non-empty) to publish
  tax_percent INTEGER NOT NULL DEFAULT 10,    -- 1..100; locked once published
  price_usdc NUMERIC(20,6) NOT NULL DEFAULT 0,
  grid_size INTEGER NOT NULL DEFAULT 8,       -- buildable footprint edge (8/12/16/20)
  tile_count INTEGER NOT NULL DEFAULT 0,      -- footprint area; drives price
  stone_tile_count INTEGER NOT NULL DEFAULT 0,-- drives ore respawn scaling
  grass_tile_count INTEGER NOT NULL DEFAULT 0,-- drives plant ripen + animal cap
  water_tile_count INTEGER NOT NULL DEFAULT 0,-- drives fishing capacity
  data JSONB NOT NULL DEFAULT '{"v":4,"cells":[]}'::jsonb,
  active_players INTEGER NOT NULL DEFAULT 0,   -- best-effort cache for world cards
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worlds_status CHECK (status IN ('unclaimed', 'draft', 'published')),
  CONSTRAINT worlds_kind CHECK (kind IN ('starter', 'purchasable')),
  CONSTRAINT worlds_tax CHECK (tax_percent BETWEEN 1 AND 100),
  CONSTRAINT worlds_name_len CHECK (char_length(name) <= 48),
  CONSTRAINT worlds_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$')
);
CREATE INDEX IF NOT EXISTS worlds_status_idx ON worlds (status, kind);
CREATE INDEX IF NOT EXISTS worlds_owner_idx ON worlds (owner_profile_id);

-- Per-player resource bank (durable). gold is tracked now but most gold uses are
-- not live yet, matching the playworlds docs.
CREATE TABLE IF NOT EXISTS player_resources (
  profile_id BIGINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  fish BIGINT NOT NULL DEFAULT 0,
  meat BIGINT NOT NULL DEFAULT 0,
  plants BIGINT NOT NULL DEFAULT 0,
  ore BIGINT NOT NULL DEFAULT 0,
  gold BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_resources_nonneg CHECK (fish >= 0 AND meat >= 0 AND plants >= 0 AND ore >= 0 AND gold >= 0)
);

-- Owner tax history per (world, owner, resource). The live fractional split is
-- accumulated in the PartyKit room; WHOLE units paid out are added to the owner's
-- player_resources AND recorded here as paid_whole for dashboards / tax history.
-- fraction_milli is an optional mirror (thousandths) kept for reconciliation.
CREATE TABLE IF NOT EXISTS tax_ledger (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  owner_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,                      -- fish|meat|plants|ore
  fraction_milli BIGINT NOT NULL DEFAULT 0,
  paid_whole BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_ledger_resource CHECK (resource IN ('fish', 'meat', 'plants', 'ore')),
  CONSTRAINT tax_ledger_unique UNIQUE (world_id, owner_profile_id, resource)
);
CREATE INDEX IF NOT EXISTS tax_ledger_owner_idx ON tax_ledger (owner_profile_id);

-- Claim / purchase records linking a payment intent to an ownership flip. Covers
-- primary sale (seller null) and secondary resale. Also the race audit log.
CREATE TABLE IF NOT EXISTS world_claims (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  buyer_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  payment_intent_id BIGINT REFERENCES wallet_payment_intents(id) ON DELETE SET NULL,
  price_usdc NUMERIC(20,6) NOT NULL,
  signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | verified | completed | failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_claims_status CHECK (status IN ('pending', 'verified', 'completed', 'failed'))
);
CREATE INDEX IF NOT EXISTS world_claims_world_idx ON world_claims (world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS world_claims_buyer_idx ON world_claims (buyer_profile_id, created_at DESC);

-- Secondary marketplace listings (resale of land + its permanent tax stream).
CREATE TABLE IF NOT EXISTS world_market_listings (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  seller_profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_usdc NUMERIC(20,6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- active | sold | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_market_status CHECK (status IN ('active', 'sold', 'cancelled')),
  CONSTRAINT world_market_price CHECK (price_usdc >= 0)
);
CREATE INDEX IF NOT EXISTS world_market_active_idx ON world_market_listings (status, world_id);

-- Universe economy state (single row). Each claim raises the live value of
-- remaining land by per_tile_increment per tile, capped at per_tile_ceiling.
CREATE TABLE IF NOT EXISTS world_economy_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  per_tile_base NUMERIC(20,6) NOT NULL DEFAULT 0.010000,
  per_tile_increment NUMERIC(20,9) NOT NULL DEFAULT 0.000050000,
  per_tile_ceiling NUMERIC(20,6) NOT NULL DEFAULT 0.100000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_economy_singleton CHECK (id = 1)
);
INSERT INTO world_economy_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
