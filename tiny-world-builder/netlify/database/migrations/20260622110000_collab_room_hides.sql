ALTER TABLE collab_rooms ADD COLUMN IF NOT EXISTS owner_auth_id TEXT NOT NULL DEFAULT '';
ALTER TABLE collab_rooms ADD COLUMN IF NOT EXISTS owner_profile_id BIGINT;

CREATE INDEX IF NOT EXISTS collab_rooms_owner_profile_idx
  ON collab_rooms (owner_profile_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS collab_rooms_owner_auth_idx
  ON collab_rooms (owner_auth_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS collab_room_hides (
  room_id TEXT PRIMARY KEY,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hidden_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS collab_room_hides_hidden_at_idx
  ON collab_room_hides (hidden_at DESC);
