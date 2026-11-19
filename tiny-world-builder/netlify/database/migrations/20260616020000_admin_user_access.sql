-- Admin-managed account access. `lobby_access` gates Tinyverse/lobby/multiplayer
-- entry; built-in god-admin emails are still granted in code as a safe fallback.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lobby_access BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles (LOWER(email));
CREATE INDEX IF NOT EXISTS profiles_lobby_access_idx ON profiles (lobby_access);