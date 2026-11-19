-- Per-row asset store, addressed by a client-generated asset_id (unique per
-- profile), alongside the existing whole-library blob in asset_libraries.
-- Lets a client fetch/update/delete a single stamp/template/etc. without
-- round-tripping the entire library JSON.
CREATE TABLE IF NOT EXISTS user_assets (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT 'other',
  name TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'private',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_user_assets_profile_class
  ON user_assets (profile_id, class);
