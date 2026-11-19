import { randomBytes } from 'node:crypto';
import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';

export const config = { path: '/api/share' };

// Per-profile ceiling on stored public share records to bound authenticated
// storage growth; each row is already size-capped (~20 MB, to allow portable
// dropped-model records for shared builds).
const MAX_SHARES_PER_PROFILE = 500;

function makeShareId() {
  return randomBytes(9).toString('base64url');
}

function validShareId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,40}$/.test(id);
}

function validateWorldData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.cells)) return 'World JSON must include a cells array';
  if (JSON.stringify(data).length > 20_000_000) return 'World JSON is too large';
  return '';
}

function shareUrlForRequest(request, id) {
  return '/tiny-world-builder?share=' + encodeURIComponent(id);
}

async function createShare(sql, input) {
  for (let i = 0; i < 4; i++) {
    const id = makeShareId();
    try {
      const rows = await sql`
        INSERT INTO world_shares (id, owner_auth_id, profile_id, build_id, name, data)
        VALUES (${id}, ${input.ownerAuthId}, ${input.profileId}, ${input.buildId}, ${input.name}, ${sql.json(input.data)})
        RETURNING id, name, created_at, updated_at
      `;
      return rows[0];
    } catch (err) {
      if (!err || err.code !== '23505') throw err;
    }
  }
  throw new Error('Could not allocate share id');
}

export default async function shareFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  try {
    if (request.method === 'GET') {
      const sql = getSql();
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!validShareId(id)) return errorResponse('Invalid share id', 400, origin);
      const rows = await sql`
        SELECT data
        FROM world_shares
        WHERE id = ${id}
        LIMIT 1
      `;
      if (!rows.length) return errorResponse('Shared world not found', 404, origin);
      return jsonResponse(rows[0].data, origin, 200, { 'Cache-Control': 'public, max-age=60' });
    }

    if (request.method === 'POST') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const auth = await requireAuthUser(request, origin);
      if (auth.response) return auth.response;
      const sql = getSql();
      const profile = await ensureProfile(auth.user);
      const body = await readJson(request);
      if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body', 400, origin);

      let name = String(body.name || '').trim().slice(0, 120);
      let data = body.data;
      let buildId = null;

      if (body.buildId) {
        const n = Number(body.buildId);
        if (!Number.isInteger(n) || n < 1) return errorResponse('Invalid build id', 400, origin);
        const builds = await sql`
          SELECT id, name, data
          FROM builds
          WHERE id = ${n} AND profile_id = ${profile.id}
          LIMIT 1
        `;
        if (!builds.length) return errorResponse('Build not found', 404, origin);
        buildId = builds[0].id;
        if (!name) name = builds[0].name;
        if (!data) data = builds[0].data;
      }

      name = name || 'Tiny World';
      const dataError = validateWorldData(data);
      if (dataError) return errorResponse(dataError, 400, origin);

      const countRows = await sql`
        SELECT count(*) AS n FROM world_shares WHERE profile_id = ${profile.id}
      `;
      if (Number(countRows[0].n) >= MAX_SHARES_PER_PROFILE) {
        return errorResponse('Share limit reached', 429, origin);
      }

      const share = await createShare(sql, {
        ownerAuthId: auth.user.id,
        profileId: profile.id,
        buildId,
        name,
        data,
      });
      return jsonResponse({
        id: share.id,
        name: share.name,
        url: shareUrlForRequest(request, share.id),
        worldUrl: '/api/share?id=' + encodeURIComponent(share.id),
        createdAt: share.created_at,
        updatedAt: share.updated_at,
      }, origin, 201);
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    console.error('[share]', err);
    return errorResponse('Share request failed', 500, origin);
  }
}
