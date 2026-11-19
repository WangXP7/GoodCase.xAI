import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { getAuthUser } from './lib/auth.mjs';
import { isWorldAdminEmail } from './lib/worlds.mjs';
import { featureFlagsDto } from './lib/feature-flags.mjs';
import {
  loadPersistedFeatureFlags,
  readBundledFeatureFlags,
  savePersistedFeatureFlags,
} from './lib/feature-flags-store.mjs';
import { requestHasAdminSecret } from './lib/admin-secret.mjs';

export const config = { path: '/api/feature-flags' };

async function isAdmin(request) {
  try {
    const user = await getAuthUser(request);
    if (user && isWorldAdminEmail(user.email)) return true;
  } catch (_) {}
  return isLocalSecretAdmin(request);
}

function isLocalSecretAdmin(request) {
  try {
    const host = (request.headers.get('host') || '').toLowerCase();
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  } catch (_) { return false; }
  return requestHasAdminSecret(request);
}

export default async function featureFlagsFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const admin = await isAdmin(request);

  if (request.method === 'GET') {
    try {
      const { doc, source } = await loadPersistedFeatureFlags();
      return jsonResponse({ ok: true, source, admin, ...featureFlagsDto(doc, admin) }, origin);
    } catch (err) {
      console.error('[feature-flags] GET error:', err);
      const fallback = readBundledFeatureFlags();
      return jsonResponse({ ok: true, source: 'bundled', admin, ...featureFlagsDto(fallback, admin) }, origin);
    }
  }

  if (request.method === 'POST') {
    if (!(await isAdmin(request))) return errorResponse('Forbidden', 403, origin);
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body', 400, origin);
    try {
      const { doc, source } = await savePersistedFeatureFlags(body);
      return jsonResponse({ ok: true, source, admin: true, ...featureFlagsDto(doc, true) }, origin);
    } catch (err) {
      console.error('[feature-flags] POST error:', err);
      const detail = String(err && err.message ? err.message : err).slice(0, 240);
      return errorResponse(detail || 'Failed to save feature flags', 500, origin);
    }
  }

  return errorResponse('Method Not Allowed', 405, origin);
}