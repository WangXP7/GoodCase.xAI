-- Base community chat tables. These are also created lazily by
-- netlify/functions/community.mjs for older local databases, but Netlify deploys
-- run SQL migrations before any function request can create them.
CREATE TABLE IF NOT EXISTS community_rooms (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT '',
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  INT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_memberships (
  id          SERIAL PRIMARY KEY,
  room_id     INT NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
  profile_id  INT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','mod','member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_messages (
  id                 SERIAL PRIMARY KEY,
  room_id            INT REFERENCES community_rooms(id) ON DELETE CASCADE,
  dm_key             TEXT,
  author_profile_id  INT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (room_id IS NOT NULL OR dm_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS community_messages_room_idx ON community_messages (room_id, id);
CREATE INDEX IF NOT EXISTS community_messages_dm_idx ON community_messages (dm_key, id);
CREATE INDEX IF NOT EXISTS community_messages_author_time_idx ON community_messages (author_profile_id, created_at);

-- Soft moderation for community messages. Hidden messages remain available to
-- moderators/admins for audit and restore, while regular readers do not see them.
ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS hidden_by INT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS hidden_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS community_messages_hidden_idx ON community_messages (hidden_at);
