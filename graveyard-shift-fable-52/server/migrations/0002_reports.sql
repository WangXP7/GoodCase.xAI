-- 0002: player reports from the in-game "Report a problem" form (server/src/report.js).
-- For a database created before this table existed. Safe to run more than once.
-- Apply: npx wrangler d1 execute graveyard-shift-leaderboard --remote --file migrations/0002_reports.sql

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
