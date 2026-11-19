-- Per-user preferences (settings that follow the account): render/graphics,
-- audio, crowd, world-gen, camera, weather/season, UI theme, panel positions.
-- One row per profile; the client controls which localStorage keys it sends
-- (secrets like API keys are NEVER included). Mirrors asset_libraries.
CREATE TABLE IF NOT EXISTS user_preferences (
  id BIGSERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
