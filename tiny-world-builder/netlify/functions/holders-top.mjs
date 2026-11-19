import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse } from './lib/http.mjs';

export const config = { path: '/api/holders/top' };

// Public top-$TINYWORLD-holders ranking for the home page. READ-ONLY, no auth.
// Hard privacy rules (this reads the sensitive wallet_accounts table):
//   - NEVER return a token AMOUNT (balance is used only for server-side ordering).
//   - NEVER return a full wallet public key — it is redacted IN SQL (first4…last4) so the
//     full key never leaves the server.
//   - NEVER return email / auth0_id / profile id. Only a display name (username, or the
//     redacted wallet if no username) + the player's published-world count (already public
//     via /api/leaderboard) so the client can show world-count badges.
// Balances are read from the cached column (populated by the batched wallet refresh) —
// this endpoint does NOT do request-time on-chain reads (those rate-limit / DoS-amplify).
const isMissingSchema = (err) => isMissingRelations(err, ['wallet_accounts', 'profiles']);

// This ranking changes slowly (balances are refreshed in a batch job, not per request).
// Cache at the CDN so the aggregate query runs at most ~once per window regardless of
// public request volume — the primary DoS guard for this anonymous endpoint. (Scale
// follow-up: precompute the top-N into a ranking table during the wallet refresh and read
// that here, so even a cache miss is O(5) instead of an aggregate over all holders.)
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=30, s-maxage=120' };

export default async function holdersTop(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, origin);

  try {
    const sql = getSql();
    // Aggregate per profile (a profile may link multiple wallets); rank by summed cached
    // balance. token_balance_atomic is TEXT — guard it's an integer and cast to numeric so
    // ordering is numeric, not lexical. Only actual holders (> 0).
    const rows = await sql`
      SELECT
        p.username AS username,
        (array_agg(
          left(w.public_key, 4) || '…' || right(w.public_key, 4)
          ORDER BY w.token_balance_atomic::numeric DESC
        ))[1] AS redacted_wallet,
        (
          SELECT count(*) FROM worlds wo
          WHERE wo.owner_profile_id = p.id AND wo.status = 'published'
        )::int AS worlds_published
      FROM wallet_accounts w
      JOIN profiles p ON p.id = w.profile_id
      WHERE w.token_balance_atomic ~ '^[0-9]+$'
        AND w.token_balance_atomic::numeric > 0
        AND p.archived_at IS NULL
      GROUP BY p.id, p.username
      ORDER BY SUM(w.token_balance_atomic::numeric) DESC, p.id ASC
      LIMIT 5
    `;
    const holders = (rows || []).map((r, i) => ({
      rank: i + 1,
      name: String(r.username || r.redacted_wallet || 'Holder'),
      worldsPublished: Number(r.worlds_published) || 0,
    }));
    return jsonResponse({ holders }, origin, 200, CACHE_HEADERS);
  } catch (err) {
    // Cold DB / missing schema / no holders yet -> empty (the overlay hides itself).
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) return jsonResponse({ holders: [] }, origin, 200, CACHE_HEADERS);
    return errorResponse('holders-top-failed', 500, origin);
  }
}
