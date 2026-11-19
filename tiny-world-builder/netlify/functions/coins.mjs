import { requireAuthUser } from './lib/auth.mjs';
import { requireTinyverseAccess } from './lib/tinyverse-access.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse } from './lib/http.mjs';
import { getCoinBalance } from './lib/coins.mjs';

export const config = { path: '/api/me/coins' };

// Read the authenticated player's Earned GOLD (Coins) balance + recent ledger.
// Coins are MOVED only by the server-authoritative primitives in lib/coins.mjs
// (template sales, referral rewards, paid actions) — never written from the client.
const isMissingSchema = (err) => isMissingRelations(err, ['coin_balances', 'coin_ledger']);

export default async function coins(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
    const tvGate = requireTinyverseAccess(auth.user, origin);
    if (tvGate) return tvGate;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);
    const balance = await getCoinBalance(sql, profile.id);
    let recent = [];
    try {
      recent = await sql`
        SELECT delta, type, reason, created_at AS "createdAt"
        FROM coin_ledger
        WHERE profile_id = ${Number(profile.id)}
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `;
    } catch (_) { recent = []; }
    return jsonResponse({ balance, recent }, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) {
      return jsonResponse({ balance: 0, recent: [] }, origin);
    }
    return errorResponse('coins-failed', 500, origin);
  }
}
