import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';

export const config = { path: '/api/assets' };

// -------- per-row asset store (?list=1 / ?id=<assetId>) --------
// Lives alongside the whole-library blob below (asset_libraries) but as
// individually addressable rows, so a client can fetch/update/delete one
// asset without round-tripping the entire library JSON.
const ASSET_CLASSES = ['stamp', 'template', 'model-stamp', 'world-asset', 'other'];
const ASSET_VISIBILITIES = ['private', 'public'];
const ASSET_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MAX_ASSET_DATA_BYTES = 1_000_000;
const MAX_ASSETS_PER_PROFILE = 500;

let _ensureUserAssetsTablePromise = null;

// Cached so a warm invocation doesn't re-issue the DDL on every request; reset
// on failure so a transient error doesn't wedge the cache with a rejection.
// Keep this in sync with
// netlify/database/migrations/20260704120000_user_assets.sql.
function ensureUserAssetsTable(sql) {
  if (!_ensureUserAssetsTablePromise) {
    _ensureUserAssetsTablePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_assets (
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          asset_id TEXT NOT NULL,
          class TEXT NOT NULL DEFAULT 'other',
          name TEXT NOT NULL DEFAULT '',
          format TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          visibility TEXT NOT NULL DEFAULT 'private',
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (profile_id, asset_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_user_assets_profile_class
          ON user_assets (profile_id, class)
      `;
    })().catch((err) => {
      _ensureUserAssetsTablePromise = null;
      throw err;
    });
  }
  return _ensureUserAssetsTablePromise;
}

function cleanText(value, limit) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function normalizeAssetId(raw) {
  const id = cleanText(raw, 80).toLowerCase();
  return ASSET_ID_RE.test(id) ? id : '';
}

function assetRowDto(row) {
  return {
    id: row.asset_id,
    class: row.class,
    name: row.name,
    format: row.format,
    version: row.version,
    visibility: row.visibility,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assetMetaDto(row) {
  return {
    id: row.asset_id,
    class: row.class,
    name: row.name,
    format: row.format,
    version: row.version,
    visibility: row.visibility,
    updatedAt: row.updated_at,
    bytes: Number(row.bytes) || 0,
  };
}

function validateAssetInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object' };
  const data = body.data;
  if (data === null || typeof data !== 'object') return { error: 'Asset data must be an object or array' };
  if (JSON.stringify(data).length > MAX_ASSET_DATA_BYTES) return { error: 'Asset data is too large' };

  const cls = cleanText(body.class, 40).toLowerCase();
  const version = Number.isInteger(body.version) && body.version > 0 ? body.version : 1;
  const visibility = cleanText(body.visibility, 20).toLowerCase();

  return {
    data,
    class: ASSET_CLASSES.includes(cls) ? cls : 'other',
    name: cleanText(body.name, 120),
    format: cleanText(body.format, 40),
    visibility: ASSET_VISIBILITIES.includes(visibility) ? visibility : 'private',
    version,
  };
}

// One-time lazy migration: a profile that has never written a per-row asset
// still has its stamps/templates/model-stamps sitting in the legacy
// asset_libraries blob. The first ?list=1 request for such a profile mines
// the blob into user_assets rows so the per-row API has something to serve.
// Only runs when the profile has zero rows (checked by the caller), so a
// profile that already has rows — even a partial set — is never touched
// here; this is backfill-into-empty, not a merge.
async function backfillAssetRowsFromBlob(sql, profileId) {
  const blobRows = await sql`
    SELECT data FROM asset_libraries WHERE profile_id = ${profileId} LIMIT 1
  `;
  if (!blobRows.length) return;
  const blob = blobRows[0].data || {};

  const candidates = [];
  const collect = (list, idPrefix, cls, format) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rawId = cleanText(item.id, 80).toLowerCase();
      if (!rawId) continue;
      const assetId = normalizeAssetId(idPrefix + rawId);
      if (!assetId) continue; // prefixed id must still pass the id regex
      let json;
      try { json = JSON.stringify(item); } catch (_) { continue; }
      if (json.length > MAX_ASSET_DATA_BYTES) continue;
      candidates.push({
        assetId,
        class: cls,
        format,
        name: cleanText(item.name || item.label || '', 120),
        data: item,
      });
    }
  };
  collect(blob.voxelBuilds, 'stamp-', 'stamp', 'voxel-build-stamp/1');
  collect(blob.assetTemplates, 'template-', 'template', 'asset-template/1');
  collect(blob.droppedModelStamps, 'model-', 'model-stamp', 'model-stamp/1');
  if (!candidates.length) return;

  const capped = candidates.slice(0, MAX_ASSETS_PER_PROFILE);
  if (capped.length < candidates.length) {
    console.warn(
      '[assets] backfill truncated for profile', profileId, '-',
      candidates.length - capped.length, 'asset(s) skipped (limit', MAX_ASSETS_PER_PROFILE, ')'
    );
  }

  for (const c of capped) {
    // ON CONFLICT DO NOTHING: safety net if two first-requests race each
    // other into the backfill concurrently — never overwrites a row.
    await sql`
      INSERT INTO user_assets (profile_id, asset_id, class, name, format, version, visibility, data)
      VALUES (${profileId}, ${c.assetId}, ${c.class}, ${c.name}, ${c.format}, 1, 'private', ${sql.json(c.data)})
      ON CONFLICT (profile_id, asset_id) DO NOTHING
    `;
  }
}

async function handleAssetRowRequest(request, sql, profile, origin, { listParam, idParam }) {
  const url = new URL(request.url);

  if (request.method === 'GET' && listParam !== null) {
    const totalRows = await sql`SELECT count(*) AS n FROM user_assets WHERE profile_id = ${profile.id}`;
    if (Number(totalRows[0].n) === 0) {
      await backfillAssetRowsFromBlob(sql, profile.id);
    }

    const clsFilter = cleanText(url.searchParams.get('class'), 40).toLowerCase();
    // An unrecognized class filter is ignored rather than rejected — this is a
    // read, so we fail open to "no filter" instead of erroring.
    const rows = ASSET_CLASSES.includes(clsFilter)
      ? await sql`
          SELECT asset_id, class, name, format, version, visibility, updated_at, pg_column_size(data) AS bytes
          FROM user_assets
          WHERE profile_id = ${profile.id} AND class = ${clsFilter}
          ORDER BY updated_at DESC
          LIMIT 500
        `
      : await sql`
          SELECT asset_id, class, name, format, version, visibility, updated_at, pg_column_size(data) AS bytes
          FROM user_assets
          WHERE profile_id = ${profile.id}
          ORDER BY updated_at DESC
          LIMIT 500
        `;
    return jsonResponse({ version: 1, items: rows.map(assetMetaDto) }, origin);
  }

  if (request.method === 'GET' && idParam !== null) {
    const assetId = normalizeAssetId(idParam);
    if (!assetId) return errorResponse('Invalid asset id', 400, origin);
    const rows = await sql`
      SELECT asset_id, class, name, format, version, visibility, data, created_at, updated_at
      FROM user_assets
      WHERE profile_id = ${profile.id} AND asset_id = ${assetId}
      LIMIT 1
    `;
    if (!rows.length) return errorResponse('Asset not found', 404, origin);
    return jsonResponse(assetRowDto(rows[0]), origin);
  }

  if (request.method === 'PUT' && idParam !== null) {
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
    const assetId = normalizeAssetId(idParam);
    if (!assetId) return errorResponse('Invalid asset id', 400, origin);
    const input = validateAssetInput(await readJson(request));
    if (input.error) return errorResponse(input.error, 400, origin);

    const existing = await sql`
      SELECT 1 FROM user_assets WHERE profile_id = ${profile.id} AND asset_id = ${assetId} LIMIT 1
    `;
    if (!existing.length) {
      const countRows = await sql`SELECT count(*) AS n FROM user_assets WHERE profile_id = ${profile.id}`;
      if (Number(countRows[0].n) >= MAX_ASSETS_PER_PROFILE) {
        return errorResponse('Asset limit reached', 400, origin);
      }
    }

    const rows = await sql`
      INSERT INTO user_assets (profile_id, asset_id, class, name, format, version, visibility, data)
      VALUES (
        ${profile.id}, ${assetId}, ${input.class}, ${input.name}, ${input.format},
        ${input.version}, ${input.visibility}, ${sql.json(input.data)}
      )
      ON CONFLICT (profile_id, asset_id) DO UPDATE
        SET class = EXCLUDED.class,
            name = EXCLUDED.name,
            format = EXCLUDED.format,
            version = EXCLUDED.version,
            visibility = EXCLUDED.visibility,
            data = EXCLUDED.data,
            updated_at = NOW()
      RETURNING asset_id, class, name, format, version, visibility, updated_at
    `;
    const row = rows[0];
    return jsonResponse({
      id: row.asset_id,
      class: row.class,
      name: row.name,
      format: row.format,
      version: row.version,
      visibility: row.visibility,
      updatedAt: row.updated_at,
    }, origin);
  }

  if (request.method === 'DELETE' && idParam !== null) {
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
    const assetId = normalizeAssetId(idParam);
    if (!assetId) return errorResponse('Invalid asset id', 400, origin);
    // Idempotent: deleting an already-absent asset is still success.
    await sql`DELETE FROM user_assets WHERE profile_id = ${profile.id} AND asset_id = ${assetId}`;
    return jsonResponse({ ok: true }, origin);
  }

  return errorResponse('Method not allowed', 405, origin);
}

function normalizeAssetLibrary(body) {
  const data = body && body.data ? body.data : body;
  const voxelBuilds = Array.isArray(data && data.voxelBuilds) ? data.voxelBuilds.slice(0, 200) : [];
  const assetTemplates = Array.isArray(data && data.assetTemplates) ? data.assetTemplates.slice(0, 200) : [];
  const droppedModelStamps = Array.isArray(data && data.droppedModelStamps) ? data.droppedModelStamps.slice(0, 80) : [];
  const hiddenAssetKeys = Array.isArray(data && data.hiddenAssetKeys)
    ? data.hiddenAssetKeys.map(key => String(key || '').slice(0, 180)).filter(Boolean).slice(0, 1000)
    : [];
  // Per-model-stamp config (scale/offset/appearance tweaks), keyed by stamp id.
  // Small JSON; the 2MB cap below still guards the whole library.
  const rawDefaults = data && data.modelStampDefaults;
  const modelStampDefaults = (rawDefaults && typeof rawDefaults === 'object' && !Array.isArray(rawDefaults)) ? rawDefaults : {};
  const out = {
    version: 1,
    voxelBuilds,
    assetTemplates,
    droppedModelStamps,
    hiddenAssetKeys,
    modelStampDefaults,
    updatedAt: new Date().toISOString(),
  };
  if (JSON.stringify(out).length > 20_000_000) {
    return { error: 'Asset library JSON is too large' };
  }
  return { data: out };
}

export default async function assetsFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const listParam = url.searchParams.get('list');
  const idParam = url.searchParams.get('id');
  const isAssetRowRequest = listParam !== null || idParam !== null;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);

    if (isAssetRowRequest) {
      await ensureUserAssetsTable(sql);
      return await handleAssetRowRequest(request, sql, profile, origin, { listParam, idParam });
    }

    if (request.method === 'GET') {
      const rows = await sql`
        SELECT data, created_at, updated_at
        FROM asset_libraries
        WHERE profile_id = ${profile.id}
        LIMIT 1
      `;
      if (!rows.length) {
        return jsonResponse({
          version: 1,
          voxelBuilds: [],
          assetTemplates: [],
          droppedModelStamps: [],
          hiddenAssetKeys: [],
          modelStampDefaults: {},
          createdAt: null,
          updatedAt: null,
        }, origin);
      }
      return jsonResponse(Object.assign({}, rows[0].data, {
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      }), origin);
    }

    if (request.method === 'PUT') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const input = normalizeAssetLibrary(await readJson(request));
      if (input.error) return errorResponse(input.error, 400, origin);
      const rows = await sql`
        INSERT INTO asset_libraries (profile_id, data)
        VALUES (${profile.id}, ${sql.json(input.data)})
        ON CONFLICT (profile_id) DO UPDATE
          SET data = EXCLUDED.data,
              updated_at = NOW()
        RETURNING data, created_at, updated_at
      `;
      return jsonResponse(Object.assign({}, rows[0].data, {
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      }), origin);
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    console.error('[assets]', err);
    return errorResponse('Asset library request failed', 500, origin);
  }
}
