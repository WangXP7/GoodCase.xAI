import { requireAuthUser } from './lib/auth.mjs';
import { requireTinyverseAccess } from './lib/tinyverse-access.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard, absoluteSiteUrl } from './lib/http.mjs';
import { ensureReferralCode, recordReferral } from './lib/referrals.mjs';

export const config = { path: '/api/me/referral' };

// G1 — a player's referral code + stats (GET), and claiming a code as a referee (POST).
const isMissingSchema = (err) => isMissingRelations(err, ['profiles', 'referrals']);

export default async function referral(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'GET' && request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (request.method === 'POST' && !sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
    const tvGate = requireTinyverseAccess(auth.user, origin);
    if (tvGate) return tvGate;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);

    if (request.method === 'POST') {
      let body; try { body = await readJson(request); } catch (_) { return errorResponse('invalid-json', 400, origin); }
      const code = String((body && body.code) || '').trim();
      const res = await recordReferral(sql, { refereeId: profile.id, code });
      if (!res.ok) {
        const status = res.reason === 'already-referred' ? 409 : 400;
        return jsonResponse({ ok: false, reason: res.reason }, origin, status);
      }
      return jsonResponse({ ok: true, status: 'pending' }, origin);
    }

    // GET — your code + shareable link + stats.
    const code = await ensureReferralCode(sql, profile.id);
    let referred = 0, rewarded = 0;
    try {
      const stat = await sql`
        SELECT
          count(*)::int AS referred,
          count(*) FILTER (WHERE status = 'rewarded')::int AS rewarded
        FROM referrals WHERE referrer_profile_id = ${Number(profile.id)}
      `;
      referred = Number(stat[0].referred) || 0;
      rewarded = Number(stat[0].rewarded) || 0;
    } catch (_) {}
    const link = code ? absoluteSiteUrl('/?ref=' + encodeURIComponent(code)) : null;
    return jsonResponse({ code, link, referred, rewarded }, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) {
      return jsonResponse({ code: null, link: null, referred: 0, rewarded: 0 }, origin);
    }
    return errorResponse('referral-failed', 500, origin);
  }
}
