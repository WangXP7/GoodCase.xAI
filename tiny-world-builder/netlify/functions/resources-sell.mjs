import { createHash } from 'node:crypto';
import { requireAuthUser } from './lib/auth.mjs';
import { isTinyverseAccessEmail } from './lib/tinyverse-access.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { coinsTransaction, MAX_COIN_AMOUNT } from './lib/coins.mjs';
import { SELLABLE_RESOURCES, computeResourceSale } from './lib/resources.mjs';

export const config = { path: '/api/me/resources/sell' };

// E5 — convert harvested resources (fish/meat/plants/ore) into Earned GOLD. This is the
// bridge from the farming/mining/harvesting loop to the spendable economy. Rates are
// server-authoritative; the client only names amounts. Atomic + idempotent: the player
// is advisory-locked, resources are debited FOR UPDATE, GOLD credited, and a durable
// resource_sales row gates replays.
const isMissingSchema = (err) => isMissingRelations(err, ['player_resources', 'resource_sales', 'coin_balances', 'coin_ledger']);

export default async function resourcesSell(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
  // P+O early-access: the sell path is PUBLIC (any signed-in player can sell resources
  // harvested in the open preview worlds). Allowlisted accounts get a 2x payout multiplier
  // (applied below). No tinyverse gate here.

  let body;
  try { body = await readJson(request); } catch (_) { return errorResponse('invalid-json', 400, origin); }

  const idempotencyKey = String((body && body.idempotencyKey) || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return errorResponse('invalid-idempotency-key', 400, origin);

  const { amounts, totalUnits, gold } = computeResourceSale(body && body.amounts);
  if (totalUnits <= 0 || gold <= 0) return errorResponse('nothing-to-sell', 400, origin);
  // O — owner/allowlist 2x early-access multiplier on the sell payout; public earns base.
  // Derived server-side from the verified email (never client-supplied).
  const ownerTier = isTinyverseAccessEmail(auth.user && auth.user.email);
  const creditedGold = ownerTier ? gold * 2 : gold;
  // Bound the CREDITED (post-multiplier) amount to the coin cap so an oversized sale fails
  // cleanly (400) rather than rolling back the transaction with an invalid-amount 500.
  if (creditedGold > MAX_COIN_AMOUNT) return errorResponse('sale-too-large', 400, origin);

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);
    const buyerId = Number(profile.id);
    // Fixed-length coin ref so a long key can never overflow the ref limit. Namespaced
    // by profile id (auth.user.sub is undefined for email/Identity users, which would
    // collapse every such user into one 'undefined:' namespace).
    const coinRef = 'sell:' + createHash('sha256').update(`${buyerId}:${idempotencyKey}`).digest('hex').slice(0, 48);

    const result = await coinsTransaction(sql, async ({ credit, tx }) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'coin:' + buyerId})::bigint)`;

      // Idempotency: a replayed sale (same key + SAME body) returns the original outcome,
      // no re-credit. The same key with a DIFFERENT sale is a client error -> 409.
      const prior = await tx`SELECT fish, meat, plants, ore, gold_credited FROM resource_sales WHERE profile_id = ${buyerId} AND idempotency_key = ${idempotencyKey}`;
      if (prior.length) {
        const p = prior[0];
        const sameBody = Number(p.fish) === amounts.fish && Number(p.meat) === amounts.meat
          && Number(p.plants) === amounts.plants && Number(p.ore) === amounts.ore && Number(p.gold_credited) === creditedGold;
        if (!sameBody) return { ok: false, reason: 'idempotency-key-reused' };
        return { ok: true, replayed: true, gold: Number(p.gold_credited) };
      }

      // Lock the player's resource row and confirm they actually have what they're selling.
      const rows = await tx`SELECT fish, meat, plants, ore FROM player_resources WHERE profile_id = ${buyerId} FOR UPDATE`;
      const have = rows.length ? rows[0] : { fish: 0, meat: 0, plants: 0, ore: 0 };
      for (const type of SELLABLE_RESOURCES) {
        if (amounts[type] > Number(have[type] || 0)) return { ok: false, reason: 'insufficient-resources', resource: type };
      }

      // Debit resources (the nonneg CHECK is a second guard against underflow).
      await tx`
        UPDATE player_resources
        SET fish = fish - ${amounts.fish}, meat = meat - ${amounts.meat},
            plants = plants - ${amounts.plants}, ore = ore - ${amounts.ore}, updated_at = NOW()
        WHERE profile_id = ${buyerId}
      `;
      const c = await credit({ profileId: buyerId, amount: creditedGold, type: 'CREDIT', reason: ownerTier ? 'resource-sale:2x' : 'resource-sale', referenceId: coinRef });
      if (!c.ok) throw new Error('credit-failed:' + c.reason);
      await tx`
        INSERT INTO resource_sales (profile_id, fish, meat, plants, ore, gold_credited, idempotency_key)
        VALUES (${buyerId}, ${amounts.fish}, ${amounts.meat}, ${amounts.plants}, ${amounts.ore}, ${creditedGold}, ${idempotencyKey})
      `;
      return { ok: true, gold: creditedGold, multiplier: ownerTier ? 2 : 1, balance: c.balance, sold: amounts };
    });

    if (!result.ok) {
      if (result.reason === 'insufficient-resources') return jsonResponse({ ok: false, reason: result.reason, resource: result.resource }, origin, 409);
      if (result.reason === 'idempotency-key-reused') return jsonResponse({ ok: false, reason: result.reason }, origin, 409);
      return jsonResponse({ ok: false, reason: result.reason || 'sale-failed' }, origin, 400);
    }
    return jsonResponse(result, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) return jsonResponse({ ok: false, reason: 'unavailable' }, origin, 503);
    return errorResponse('resource-sell-failed', 500, origin);
  }
}
