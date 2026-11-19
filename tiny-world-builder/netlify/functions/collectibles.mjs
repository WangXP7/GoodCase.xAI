import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';

export const config = { path: '/api/collectibles' };

// Per-profile ceiling, matching the client's localStorage cap (200 rows). Each
// island snapshot is small (a grid of cells), so this is generous headroom.
const MAX_COLLECTIBLES_PER_PROFILE = 500;

// Defensive create — newer collaborative features ensure their table on first
// use rather than relying solely on the migration runner (see feature-flags
// store, collabs, community). Keep this in sync with
// netlify/database/migrations/20260630120000_tinyverse_collectibles.sql.
async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS collectibles (
      id             BIGSERIAL PRIMARY KEY,
      profile_id     BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      collectible_id TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'island',
      seed           TEXT,
      name           TEXT,
      data           JSONB NOT NULL,
      acquired_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_collectibles_profile_collectible
      ON collectibles (profile_id, collectible_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_collectibles_profile_acquired
      ON collectibles (profile_id, acquired_at DESC)
  `;
}

// Pull the full client record back out. The snapshot is authoritative; the
// lifted columns are only for indexing, so we return data verbatim and overlay
// the canonical id/timestamps the server tracks.
function collectibleDto(row) {
  const record = (row && row.data && typeof row.data === 'object') ? row.data : {};
  return Object.assign({}, record, {
    id: row.collectible_id,
    acquiredAt: row.acquired_at || record.acquiredAt || row.created_at,
  });
}

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseAcquiredAt(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Validate one incoming record. A collectible must carry a stable id and an
// island world (a cells array) — that is the snapshot worth persisting.
function validateRecord(body) {
  if (!body || typeof body !== 'object') return { error: 'Record must be an object' };
  const collectibleId = cleanText(body.id, 80);
  if (!collectibleId) return { error: 'Record must include an id' };
  const world = body.world;
  if (!world || typeof world !== 'object' || !Array.isArray(world.cells)) {
    return { error: 'Record must include a world with a cells array' };
  }
  if (JSON.stringify(body).length > 5_000_000) {
    return { error: 'Record is too large' };
  }
  return {
    collectibleId,
    kind: cleanText(body.kind, 24) || 'island',
    seed: cleanText(body.seed, 120) || null,
    name: cleanText(body.name, 120) || null,
    acquiredAt: parseAcquiredAt(body.acquiredAt),
    data: body,
  };
}

async function upsertRecord(sql, profileId, input) {
  const rows = await sql`
    INSERT INTO collectibles (profile_id, collectible_id, kind, seed, name, data, acquired_at)
    VALUES (
      ${profileId}, ${input.collectibleId}, ${input.kind}, ${input.seed}, ${input.name},
      ${sql.json(input.data)}, ${input.acquiredAt}
    )
    ON CONFLICT (profile_id, collectible_id)
    DO UPDATE SET
      kind = EXCLUDED.kind,
      seed = EXCLUDED.seed,
      name = EXCLUDED.name,
      data = EXCLUDED.data,
      acquired_at = COALESCE(collectibles.acquired_at, EXCLUDED.acquired_at),
      updated_at = NOW()
    RETURNING collectible_id, kind, seed, name, data, acquired_at, created_at, updated_at
  `;
  return rows[0];
}

export default async function collectiblesFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  try {
    const sql = getSql();
    await ensureTable(sql);
    const profile = await ensureProfile(auth.user);

    if (request.method === 'GET') {
      const rows = await sql`
        SELECT collectible_id, kind, seed, name, data, acquired_at, created_at, updated_at
        FROM collectibles
        WHERE profile_id = ${profile.id}
        ORDER BY acquired_at DESC NULLS LAST, created_at DESC
        LIMIT ${MAX_COLLECTIBLES_PER_PROFILE}
      `;
      return jsonResponse(rows.map(collectibleDto), origin);
    }

    if (request.method === 'POST') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const body = await readJson(request);
      // Accept either a single record or { records: [...] } for batch sync of an
      // existing localStorage collection.
      const incoming = Array.isArray(body && body.records) ? body.records
        : Array.isArray(body) ? body
        : [body];
      if (!incoming.length) return errorResponse('No records supplied', 400, origin);
      if (incoming.length > MAX_COLLECTIBLES_PER_PROFILE) {
        return errorResponse('Too many records in one request', 413, origin);
      }

      const countRows = await sql`
        SELECT count(*) AS n FROM collectibles WHERE profile_id = ${profile.id}
      `;
      const existingCount = Number(countRows[0].n);

      const saved = [];
      const errors = [];
      let added = 0;
      for (const raw of incoming) {
        const input = validateRecord(raw);
        if (input.error) { errors.push(input.error); continue; }
        // Only block brand-new inserts past the cap; upserts of known ids are fine.
        const known = await sql`
          SELECT 1 FROM collectibles
          WHERE profile_id = ${profile.id} AND collectible_id = ${input.collectibleId}
          LIMIT 1
        `;
        if (!known.length && existingCount + added >= MAX_COLLECTIBLES_PER_PROFILE) {
          errors.push('Collection limit reached');
          continue;
        }
        const row = await upsertRecord(sql, profile.id, input);
        if (!known.length) added += 1;
        saved.push(collectibleDto(row));
      }

      if (!saved.length) {
        return errorResponse(errors[0] || 'No valid records', 400, origin);
      }
      return jsonResponse({ saved, errors }, origin, 201);
    }

    if (request.method === 'DELETE') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const collectibleId = cleanText(new URL(request.url).searchParams.get('id'), 80);
      if (!collectibleId) return errorResponse('Missing collectible id', 400, origin);
      const rows = await sql`
        DELETE FROM collectibles
        WHERE profile_id = ${profile.id} AND collectible_id = ${collectibleId}
        RETURNING collectible_id
      `;
      if (!rows.length) return errorResponse('Collectible not found', 404, origin);
      return jsonResponse({ ok: true }, origin);
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    console.error('[collectibles]', err);
    return errorResponse('Collectibles request failed', 500, origin);
  }
}
