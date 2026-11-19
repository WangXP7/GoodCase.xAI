import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';

export const config = { path: '/api/preferences' };

// A flat map of localStorage key -> string value. The client decides which keys
// to send (its allowlist excludes secrets/content/ephemeral); the server just
// stores string values, bounds the count + sizes, and caps the whole blob.
function normalizePreferences(body) {
  const data = body && body.data ? body.data : body;
  const rawPrefs = data && data.prefs;
  const prefs = {};
  if (rawPrefs && typeof rawPrefs === 'object' && !Array.isArray(rawPrefs)) {
    let n = 0;
    for (const [k, v] of Object.entries(rawPrefs)) {
      if (n >= 500) break;
      if (typeof k !== 'string' || k.length > 160) continue;
      if (typeof v !== 'string' || v.length > 100_000) continue;
      prefs[k] = v;
      n++;
    }
  }
  const out = { version: 1, prefs, updatedAt: new Date().toISOString() };
  if (JSON.stringify(out).length > 1_000_000) {
    return { error: 'Preferences JSON is too large' };
  }
  return { data: out };
}

export default async function preferencesFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);

    if (request.method === 'GET') {
      const rows = await sql`
        SELECT data, created_at, updated_at
        FROM user_preferences
        WHERE profile_id = ${profile.id}
        LIMIT 1
      `;
      if (!rows.length) {
        return jsonResponse({ version: 1, prefs: {}, createdAt: null, updatedAt: null }, origin);
      }
      return jsonResponse(Object.assign({}, rows[0].data, {
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      }), origin);
    }

    if (request.method === 'PUT') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const input = normalizePreferences(await readJson(request));
      if (input.error) return errorResponse(input.error, 400, origin);
      const rows = await sql`
        INSERT INTO user_preferences (profile_id, data)
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
    console.error('[preferences]', err);
    return errorResponse('Preferences request failed', 500, origin);
  }
}
