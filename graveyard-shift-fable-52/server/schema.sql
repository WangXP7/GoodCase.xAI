-- Graveyard Shift leaderboard schema (Cloudflare D1 / SQLite).
-- Safe to run once on an empty database; IF NOT EXISTS makes a repeat run a no-op.
-- Times are integer milliseconds since the Unix epoch.

CREATE TABLE IF NOT EXISTS players (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tag            TEXT    NOT NULL,                -- display form, e.g. "Dead Eye"
  tag_key        TEXT    NOT NULL UNIQUE,         -- lowercase, no separators, look-alikes folded (B0B = bob)
  secret_hash    TEXT    NOT NULL,                -- SHA-256 hex of the current secret
  recovery_hash  TEXT    NOT NULL,                -- SHA-256 hex of the recovery code
  created_at     INTEGER NOT NULL,
  -- Personal best = the single best run by (round desc, kills desc, earliest).
  best_round     INTEGER NOT NULL DEFAULT 0,
  best_kills     INTEGER NOT NULL DEFAULT 0,
  best_points    INTEGER NOT NULL DEFAULT 0,
  best_headshots INTEGER NOT NULL DEFAULT 0,
  best_time      INTEGER NOT NULL DEFAULT 0,      -- seconds survived in that run
  best_at        INTEGER,                         -- when that run was submitted
  device         TEXT,                            -- device of that run
  games          INTEGER NOT NULL DEFAULT 0,
  last_at        INTEGER
);

-- Rank count for /api/player, and the 30-day sweep of tags that never scored.
CREATE INDEX IF NOT EXISTS players_board_round
  ON players (best_round DESC, best_kills DESC, best_at ASC)
  WHERE games > 0;
CREATE INDEX IF NOT EXISTS players_unscored ON players (created_at) WHERE games = 0;

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  kills      INTEGER NOT NULL,
  headshots  INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  time_sec   INTEGER NOT NULL,
  version    TEXT    NOT NULL,
  device     TEXT    NOT NULL CHECK (device IN ('desktop', 'phone')),
  at         INTEGER NOT NULL
);

-- Run history, only for pruning and future use; leaderboards never read it.
CREATE INDEX IF NOT EXISTS runs_player ON runs (player_id, round DESC, kills DESC, at ASC);

-- One row per (player, device, board): that player's best run on that board, where device is
-- 'all', 'desktop' or 'phone' and board is 'round', 'kills' or 'points' (at most 9 rows per
-- player). Every leaderboard is a straight index walk over this table.
CREATE TABLE IF NOT EXISTS bests (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  device     TEXT    NOT NULL CHECK (device IN ('all', 'desktop', 'phone')),
  board      TEXT    NOT NULL CHECK (board IN ('round', 'kills', 'points')),
  round      INTEGER NOT NULL,
  kills      INTEGER NOT NULL,
  headshots  INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  time_sec   INTEGER NOT NULL,
  run_device TEXT    NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (player_id, device, board)
);

CREATE INDEX IF NOT EXISTS bests_round
  ON bests (board, device, round DESC, kills DESC, at ASC);
CREATE INDEX IF NOT EXISTS bests_kills
  ON bests (board, device, kills DESC, round DESC, at ASC);
CREATE INDEX IF NOT EXISTS bests_points
  ON bests (board, device, points DESC, round DESC, at ASC);

-- Fixed-window rate-limit counters. key is a salted SHA-256 of an IP, or a tag key.
CREATE TABLE IF NOT EXISTS rate (
  bucket        TEXT    NOT NULL,                 -- e.g. 'claim:ip', 'recover:tag'
  key           TEXT    NOT NULL,
  window_start  INTEGER NOT NULL,                 -- ms, aligned to the window length
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_window ON rate (window_start);

-- Player reports from the in-game "Report a problem" form. Also in migrations/0002_reports.sql
-- for a database created before this table existed.
CREATE TABLE IF NOT EXISTS reports (
  id               INTEGER PRIMARY KEY,
  created_at       INTEGER NOT NULL,                 -- ms since the Unix epoch
  kind             TEXT    NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  message          TEXT    NOT NULL,                 -- cleaned: control characters removed, 10-2000 chars
  contact          TEXT,                             -- optional, as typed (<= 100 chars), shown in the report
  context_json     TEXT    NOT NULL,                 -- whitelisted, typed context fields only
  ip_hash          TEXT    NOT NULL,                 -- salted SHA-256 of the IP or IPv6 /64, never the IP
  delivered_email  INTEGER NOT NULL DEFAULT 0,
  delivered_issue  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reports_created ON reports (created_at);
