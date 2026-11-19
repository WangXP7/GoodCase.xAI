import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile, normalizeProfileHandle, normalizeProfileImageUrl, normalizeUsername, profileDto } from './lib/profiles.mjs';

export const config = { path: '/api/profile' };

function validateProfile(body) {
  const username = normalizeUsername(body && body.username);
  const displayName = String((body && body.displayName) || '').trim().slice(0, 80);
  const email = String((body && body.email) || '').trim().toLowerCase().slice(0, 320);
  const about = String((body && body.about) || '').trim().slice(0, 1000);
  const image = normalizeProfileImageUrl(body && body.image);
  const twitter = normalizeProfileHandle(body && body.twitter);
  const github = normalizeProfileHandle(body && body.github);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return { error: 'Username must be 3-24 lowercase letters, numbers, underscores' };
  if (!displayName) return { error: 'Display name required' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email is not valid' };
  // Reject non-http(s) image URLs so a stored `javascript:`/`data:text/html` value
  // can't become stored XSS if a client ever renders it as an <img src>/anchor.
  if (image && !/^https:\/\/[^\s]+$/i.test(image) && !/^http:\/\/localhost(:\d+)?\//i.test(image)) {
    return { error: 'Image must be an https URL' };
  }
  return { username, displayName, email, about, image, twitter, github };
}

export default async function profileFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
  const user = auth.user;

  try {
    if (request.method === 'GET') {
      const profile = await ensureProfile(user);
      return jsonResponse(profileDto(profile), origin);
    }

    if (request.method === 'PUT') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const body = await readJson(request);
      const input = validateProfile(body);
      if (input.error) return errorResponse(input.error, 400, origin);

      await ensureProfile(user);
      const sql = getSql();
      const authEmail = String(user.email || '').trim().toLowerCase();
      const email = authEmail || input.email;
      const rows = await sql`
        UPDATE profiles
        SET username = ${input.username},
            email = ${email},
            display_name = ${input.displayName},
            about = ${input.about},
            image = ${input.image},
            twitter = ${input.twitter},
            github = ${input.github},
            updated_at = NOW()
        WHERE auth0_id = ${user.id}
        RETURNING id, auth0_id, email, username, display_name, about, image, twitter, github, lobby_access, password_reset_requested_at, created_at, updated_at
      `;
      if (!rows.length) return errorResponse('Profile not found', 404, origin);
      return jsonResponse(profileDto(rows[0]), origin);
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (err && err.code === '23505') return errorResponse('Username is already taken', 409, origin);
    console.error('[profile]', err);
    return errorResponse('Profile request failed', 500, origin);
  }
}
