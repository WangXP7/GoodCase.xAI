import { createHash } from 'node:crypto';
import { requireTinyverseAccess } from './lib/tinyverse-access.mjs';
import { requireAuthUser } from './lib/auth.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { coinsTransaction, isValidCoinRef } from './lib/coins.mjs';

export const config = { path: '/api/worlds/remix' };

// T2c — pay Earned GOLD to remix a template world_share into your own editable build copy.
// ATOMIC (one transaction via coinsTransaction): debit buyer -> credit author (price
// minus treasury fee) -> duplicate the share's data into a new build owned by the
// buyer -> bump remix_count. Either it all happens or none of it does. Idempotent on
// a client key so a retry never double-charges or double-duplicates.

const TREASURY_FEE_BPS = 500; // 5% — matches DEFAULT_ECONOMY_POLICY.officialMarketplaceFeeBps
const MAX_BUILDS_PER_PROFILE = 500;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const isMissingSchema = (err) => isMissingRelations(err, ['world_shares', 'builds', 'coin_balances', 'coin_ledger', 'share_remixes']);

export function templateFeeSplit(price) {
  const p = Math.max(0, Math.floor(Number(price) || 0));
  const fee = Math.floor((p * TREASURY_FEE_BPS) / 10000);
  return { fee, authorAmount: p - fee };
}

export default async function worldRemix(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
    const tvGate = requireTinyverseAccess(auth.user, origin);
    if (tvGate) return tvGate;

  let body;
  try { body = await readJson(request); } catch (_) { return errorResponse('invalid-json', 400, origin); }
  body = body || {};
  const shareId = String(body.shareId || '').trim();
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!SHARE_ID_RE.test(shareId)) return errorResponse('invalid-share', 400, origin);
  if (!isValidCoinRef(idempotencyKey)) return errorResponse('invalid-idempotency-key', 400, origin);

  try {
    const sql = getSql();
    const buyer = await ensureProfile(auth.user);
    const buyerId = Number(buyer.id);
    // Coin refs are bound to the buyer AND the share: without the buyer, two buyers
    // reusing the same key on the same share would collide on the author-credit ref
    // (unique in coin_ledger) and 500 the second legit remix; without the share, a key
    // reused across shares could false-replay a coin debit. The share_remixes table is
    // the operation-level idempotency surface. Fixed-length hashed coin ref so a long
    // TEXT shareId + key can never overflow the 128-char coin-ref limit (which would
    // fail the author-credit and roll back the remix).
    const coinRef = 'rmx:' + createHash('sha256').update(buyerId + ':' + shareId + ':' + idempotencyKey).digest('hex').slice(0, 48);

    const result = await coinsTransaction(sql, async ({ debit, credit, tx }) => {
      // Serialize ALL of this buyer's remix work (and coin ops — same lock key) so the
      // idempotency pre-check + build-cap + writes can't interleave with a concurrent op.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'coin:' + buyerId})::bigint)`;

      // Operation-level idempotency (covers free AND paid). A reused key bound to a
      // DIFFERENT share is rejected; bound to the same share, replays the original build.
      const prior = await tx`
        SELECT share_id, build_id FROM share_remixes
        WHERE buyer_profile_id = ${buyerId} AND idempotency_key = ${idempotencyKey} LIMIT 1
      `;
      if (prior.length) {
        if (prior[0].share_id !== shareId) return { ok: false, reason: 'idempotency-key-reused' };
        return { ok: true, replayed: true, buildId: prior[0].build_id == null ? null : Number(prior[0].build_id) };
      }

      // Lock the template row and re-read price/data/author UNDER the lock so the author
      // can't unlist / raise price between our read and the charge (TOCTOU).
      // profile_id IS NOT NULL guard: if the owner deleted their profile, the column goes
      // NULL (ON DELETE SET NULL) but is_template stays set. We must reject rather than
      // credit profile 0 or a nonexistent profile.
      const rows = await tx`
        SELECT id, profile_id, name, template_price, data FROM world_shares
        WHERE id = ${shareId} AND is_template = TRUE AND template_price IS NOT NULL AND profile_id IS NOT NULL
        FOR UPDATE
      `;
      if (!rows.length) return { ok: false, reason: 'not-a-template' };
      const share = rows[0];
      const author = Number(share.profile_id);
      if (author === buyerId) return { ok: false, reason: 'cannot-remix-own' };
      const price = Math.max(0, Math.floor(Number(share.template_price) || 0));
      const { fee, authorAmount } = templateFeeSplit(price);

      const cnt = await tx`SELECT count(*)::int AS n FROM builds WHERE profile_id = ${buyerId}`;
      if (Number(cnt[0].n) >= MAX_BUILDS_PER_PROFILE) return { ok: false, reason: 'build-limit' };

      let debitBalance = null;
      if (price > 0) {
        const d = await debit({ profileId: buyerId, amount: price, type: 'DEBIT', reason: `remix:${shareId}`, referenceId: coinRef, counterpartyProfileId: author });
        if (!d.ok) return d; // insufficient-coins (no writes)
        debitBalance = d.balance;
        if (authorAmount > 0) {
          const c = await credit({ profileId: author, amount: authorAmount, type: 'CREDIT', reason: `remix-sale:${shareId}`, referenceId: coinRef + ':a', counterpartyProfileId: buyerId });
          if (!c.ok) throw new Error('author-credit-failed:' + c.reason); // rolls back the debit
        }
      }

      const name = ('Remix of ' + (share.name || 'world')).slice(0, 80);
      const build = await tx`INSERT INTO builds (profile_id, name, data) VALUES (${buyerId}, ${name}, ${share.data}) RETURNING id`;
      const buildId = Number(build[0].id);
      await tx`UPDATE world_shares SET remix_count = remix_count + 1 WHERE id = ${shareId}`;
      // Record the operation — the unique (buyer, key) index is the durable idempotency backstop.
      await tx`
        INSERT INTO share_remixes (buyer_profile_id, share_id, build_id, author_profile_id, price, idempotency_key)
        VALUES (${buyerId}, ${shareId}, ${buildId}, ${author}, ${price}, ${idempotencyKey})
      `;
      return { ok: true, replayed: false, buildId, spent: price, fee, authorReceived: authorAmount, balance: debitBalance };
    });

    if (!result.ok) {
      const status = result.reason === 'insufficient-coins' ? 402
        : result.reason === 'idempotency-key-reused' ? 409
        : result.reason === 'build-limit' ? 409 : 400;
      return jsonResponse(result, origin, status);
    }
    return jsonResponse(result, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) {
      return errorResponse('world-remix-unavailable: schema not ready', 503, origin);
    }
    return errorResponse('world-remix-failed: ' + (err.message || err), 500, origin);
  }
}
