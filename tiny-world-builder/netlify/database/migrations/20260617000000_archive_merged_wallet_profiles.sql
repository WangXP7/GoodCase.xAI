ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into_profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_reason TEXT;

CREATE INDEX IF NOT EXISTS profiles_merged_into_idx
  ON profiles (merged_into_profile_id)
  WHERE merged_into_profile_id IS NOT NULL;
