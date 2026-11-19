import { createHmac, randomBytes } from 'node:crypto';
import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';

export const config = { path: '/api/livekit/token' };

function envValue(name) {
  try {
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') return Netlify.env.get(name) || '';
  } catch (_) {}
  return process.env[name] || '';
}

function cleanRoom(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(head + '.' + body).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return head + '.' + body + '.' + sig;
}

export default async function livekitTokenFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  const apiKey = envValue('LIVEKIT_API_KEY');
  const apiSecret = envValue('LIVEKIT_API_SECRET');
  const livekitUrl = envValue('LIVEKIT_URL');
  if (!apiKey || !apiSecret || !livekitUrl) {
    return errorResponse('LiveKit is not configured', 501, origin);
  }

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);
    const body = await readJson(request);
    const room = cleanRoom((body && body.room) || (body && body.partyId) || ('party-' + profile.id));
    if (!room) return errorResponse('Missing LiveKit room', 400, origin);
    const now = Math.floor(Date.now() / 1000);
    const identity = 'profile-' + profile.id;
    const name = profile.display_name || profile.username || identity;
    const payload = {
      iss: apiKey,
      sub: identity,
      name,
      nbf: now - 5,
      exp: now + 60 * 60,
      jti: randomBytes(12).toString('base64url'),
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    };
    return jsonResponse({
      configured: true,
      url: livekitUrl,
      room,
      identity,
      token: signJwt(payload, apiSecret),
      expiresAt: new Date((now + 60 * 60) * 1000).toISOString(),
    }, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    console.error('[livekit-token]', err);
    return errorResponse('LiveKit token request failed', 500, origin);
  }
}
