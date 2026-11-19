-- Tinyverse collectibles — durable, per-profile storage for islands a player
-- generates by opening packs. Until now these immutable island snapshots lived
-- only in the browser's localStorage (scripts/tinyverse-collectibles.js), so a
-- cleared cache or a new device lost the whole collection. This table is the
-- server-of-record; the client mirrors into it on every save and hydrates from
-- it on load.
--
-- The full client record is stored verbatim in `data` (so the snapshot stays
-- immutable and forward-compatible); a few columns are lifted out for indexing
-- and dedup. `collectible_id` is the client-generated id and is unique per
-- profile, so a re-sync of the same island upserts instead of duplicating.
CREATE TABLE IF NOT EXISTS collectibles (
  id             BIGSERIAL PRIMARY KEY,
  profile_id     BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  collectible_id TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'island',
  seed           TEXT,
  name           TEXT,
  data           JSONB NOT NULL,
  acquired_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collectibles_profile_collectible
  ON collectibles (profile_id, collectible_id);

CREATE INDEX IF NOT EXISTS idx_collectibles_profile_acquired
  ON collectibles (profile_id, acquired_at DESC);
