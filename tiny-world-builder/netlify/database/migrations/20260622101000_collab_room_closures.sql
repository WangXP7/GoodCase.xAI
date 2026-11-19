CREATE TABLE IF NOT EXISTS collab_room_closures (
  room_id TEXT PRIMARY KEY,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collab_room_closures_closed_at_idx
  ON collab_room_closures (closed_at DESC);
