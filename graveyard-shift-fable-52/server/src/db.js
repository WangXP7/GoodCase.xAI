// Every SQL statement lives here. Each function takes `db`, anything with the D1
// prepared-statement shape: db.prepare(sql).bind(...).first() / .all() / .run(), db.batch([...]).
// All values are bound parameters; the only interpolated SQL fragments come from the
// fixed BOARDS table below, never from request input.

export const RUNS_KEPT_PER_PLAYER = 20;

// Leaderboard orderings. Ties always fall to the earlier run.
export const BOARDS = {
  round: 'round DESC, kills DESC, at ASC',
  kills: 'kills DESC, round DESC, at ASC',
  points: 'points DESC, round DESC, at ASC',
};

export function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message));
}

export async function findPlayerByKey(db, key) {
  return db
    .prepare(
      `SELECT id, tag, tag_key, secret_hash, recovery_hash, created_at, best_round, best_kills,
              best_points, best_headshots, best_time, best_at, device, games, last_at
         FROM players WHERE tag_key = ?1`,
    )
    .bind(key)
    .first();
}

export async function tagKeyExists(db, key) {
  const row = await db.prepare('SELECT 1 AS x FROM players WHERE tag_key = ?1').bind(key).first();
  return !!row;
}

// Throws a UNIQUE constraint error if the key is taken (see isUniqueViolation).
export async function insertPlayer(db, { tag, key, secretHash, recoveryHash, now }) {
  return db
    .prepare(
      `INSERT INTO players (tag, tag_key, secret_hash, recovery_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(tag, key, secretHash, recoveryHash, now)
    .run();
}

export async function setSecretHash(db, playerId, secretHash) {
  return db.prepare('UPDATE players SET secret_hash = ?1 WHERE id = ?2').bind(secretHash, playerId).run();
}

// Strictly-better test for each board, comparing the new run (excluded.*) with the stored best.
// Ties keep the stored (earlier) run.
const BETTER = {
  round: 'excluded.round > bests.round OR (excluded.round = bests.round AND excluded.kills > bests.kills)',
  kills: 'excluded.kills > bests.kills OR (excluded.kills = bests.kills AND excluded.round > bests.round)',
  points: 'excluded.points > bests.points OR (excluded.points = bests.points AND excluded.round > bests.round)',
};

function upsertBest(db, playerId, device, board, run, now) {
  return db
    .prepare(
      `INSERT INTO bests (player_id, device, board, round, kills, headshots, points, time_sec, run_device, at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (player_id, device, board) DO UPDATE SET
         round = excluded.round, kills = excluded.kills, headshots = excluded.headshots,
         points = excluded.points, time_sec = excluded.time_sec, run_device = excluded.run_device,
         at = excluded.at
       WHERE ${BETTER[board]}`,
    )
    .bind(playerId, device, board, run.round, run.kills, run.headshots, run.points, run.timeSec, run.device, now);
}

// Stores a run and updates the player's counters, personal best and per-board/device bests,
// all in one transaction. Returns { improved } (true when this is a new personal best).
export async function recordRun(db, playerId, run, now) {
  const { round, kills, headshots, points, timeSec, version, device } = run;
  const statements = [
    db
      .prepare(
        `INSERT INTO runs (player_id, round, kills, headshots, points, time_sec, version, device, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(playerId, round, kills, headshots, points, timeSec, version, device, now),
    db
      .prepare(
        `UPDATE players
            SET best_round = ?2, best_kills = ?3, best_headshots = ?4, best_points = ?5,
                best_time = ?6, best_at = ?7, device = ?8
          WHERE id = ?1
            AND (games = 0 OR ?2 > best_round OR (?2 = best_round AND ?3 > best_kills))`,
      )
      .bind(playerId, round, kills, headshots, points, timeSec, now, device),
    db.prepare('UPDATE players SET games = games + 1, last_at = ?2 WHERE id = ?1').bind(playerId, now),
  ];
  for (const d of ['all', device]) {
    for (const board of Object.keys(BOARDS)) statements.push(upsertBest(db, playerId, d, board, run, now));
  }
  const results = await db.batch(statements);
  return { improved: Number(results[1]?.meta?.changes ?? 0) > 0 };
}

// Keeps each player's best RUNS_KEPT_PER_PLAYER runs (by round, kills, earliest).
// Leaderboards read `bests`, so this never changes a board.
export async function pruneRuns(db, playerId, keep = RUNS_KEPT_PER_PLAYER) {
  const res = await db
    .prepare(
      `DELETE FROM runs WHERE player_id = ?1 AND id NOT IN (
         SELECT id FROM runs WHERE player_id = ?1 ORDER BY ${BOARDS.round} LIMIT ?2
       )`,
    )
    .bind(playerId, keep)
    .run();
  return res?.meta?.changes ?? 0;
}

export const UNSCORED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Frees tags that were claimed but never scored within UNSCORED_TTL_MS.
export async function pruneUnscoredPlayers(db, now, ttlMs = UNSCORED_TTL_MS) {
  const res = await db
    .prepare('DELETE FROM players WHERE games = 0 AND created_at < ?1')
    .bind(now - ttlMs)
    .run();
  return res?.meta?.changes ?? 0;
}

function rowToEntry(r, i) {
  return {
    rank: i + 1,
    tag: r.tag,
    round: r.round,
    kills: r.kills,
    headshots: r.headshots,
    points: r.points,
    timeSec: r.time_sec,
    device: r.run_device,
    at: new Date(Number(r.at)).toISOString(),
  };
}

// board: 'round' | 'kills' | 'points'; device: 'all' | 'desktop' | 'phone'.
// Each player appears once, with their best run for that board and device. Index walk on
// bests (board, device, <order>), then a primary-key lookup per row for the tag.
export async function leaderboard(db, { board, device, limit }) {
  const order = BOARDS[board];
  if (!order) throw new Error('bad board');
  const { results } = await db
    .prepare(
      `SELECT p.tag, b.round, b.kills, b.headshots, b.points, b.time_sec, b.run_device, b.at
         FROM bests b JOIN players p ON p.id = b.player_id
        WHERE b.board = ?1 AND b.device = ?2
        ORDER BY ${order.replace(/(\w+) /g, 'b.$1 ')}
        LIMIT ?3`,
    )
    .bind(board, device, limit)
    .all();
  return (results || []).map(rowToEntry);
}

// 1-based rank on the overall board (board=round, device=all), or null with no games.
export async function playerRank(db, p) {
  if (!p || !p.games) return null;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM players
        WHERE games > 0
          AND (best_round > ?1
               OR (best_round = ?1 AND best_kills > ?2)
               OR (best_round = ?1 AND best_kills = ?2 AND best_at < ?3))`,
    )
    .bind(p.best_round, p.best_kills, p.best_at)
    .first();
  return Number(row?.n ?? 0) + 1;
}

export function publicPlayer(p, rank) {
  return {
    tag: p.tag,
    games: p.games,
    rank,
    createdAt: new Date(Number(p.created_at)).toISOString(),
    lastAt: p.last_at == null ? null : new Date(Number(p.last_at)).toISOString(),
    best: p.games
      ? {
          round: p.best_round,
          kills: p.best_kills,
          headshots: p.best_headshots,
          points: p.best_points,
          timeSec: p.best_time,
          device: p.device,
          at: new Date(Number(p.best_at)).toISOString(),
        }
      : null,
  };
}
