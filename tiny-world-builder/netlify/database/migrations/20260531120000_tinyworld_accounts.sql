CREATE TABLE IF NOT EXISTS profiles (
  id BIGSERIAL PRIMARY KEY,
  auth0_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$')
);

CREATE TABLE IF NOT EXISTS builds (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS builds_profile_updated_idx
  ON builds (profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS world_shares (
  id TEXT PRIMARY KEY,
  owner_auth_id TEXT NOT NULL,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  build_id INTEGER REFERENCES builds(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_shares_id_format CHECK (id ~ '^[A-Za-z0-9_-]{8,40}$')
);

CREATE INDEX IF NOT EXISTS world_shares_owner_updated_idx
  ON world_shares (owner_auth_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS world_shares_build_idx
  ON world_shares (build_id);
