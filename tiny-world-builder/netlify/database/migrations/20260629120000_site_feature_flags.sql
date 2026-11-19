CREATE TABLE IF NOT EXISTS site_feature_flags (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  flags      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);