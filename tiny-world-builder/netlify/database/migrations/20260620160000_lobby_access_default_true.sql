-- Make Tinyverse / lobby / multiplayer access enabled by default
-- (per user request for testing; explicit toggle still available in admin for revocation)

ALTER TABLE profiles 
  ALTER COLUMN lobby_access SET DEFAULT TRUE;

-- Flip any existing FALSE rows to TRUE so current testers (including those with prior grants) get in immediately
UPDATE profiles 
SET lobby_access = TRUE 
WHERE lobby_access = FALSE OR lobby_access IS NULL;

-- Note: the column was previously NOT NULL DEFAULT FALSE
