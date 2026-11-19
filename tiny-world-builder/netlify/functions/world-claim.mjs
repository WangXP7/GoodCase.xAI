import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import {
  computeWorldPurchasePrice, deriveResourceStats, worldDto, worldsUsdcMint, onchainVerificationRequired, verifyUsdcTransfer,
} from './lib/worlds.mjs';

export const config = { path: '/api/worlds/claim' };

const CLAIM_RELATIONS = ['worlds', 'world_economy_state', 'world_claims', 'wallet_payment_intents', 'wallet_accounts'];
const isMissingClaimSchema = (err) => isMissingRelations(err, CLAIM_RELATIONS);

async function loadEconomy(sql) {
  const rows = await sql`SELECT * FROM world_economy_state WHERE id = 1 LIMIT 1`;
  return rows[0] || {};
}

// Safety guard shared by every payment-weakening env flag: a deployment whose
// URL does not look local/preview is treated as production. Fails closed (an
// unreadable env counts as production) so an env misconfiguration can never
// weaken payment checks in prod.
function isProductionLikeHost() {
  try {
    const siteUrl = (globalThis.Netlify && Netlify.env && Netlify.env.get('URL')) || process.env.URL || process.env.SITE_URL || '';
    const host = String(siteUrl).replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    return !!host && !/localhost|127\.0\.0\.1|\.local|dev\.|\.netlify\.app/i.test(host);
  } catch (_) { return true; }
}

// Test mode: claim works for real (ownership flip, claim record, economy bump)
// but skips the wallet/payment/on-chain steps. Enable with WORLDS_TEST_BYPASS_PAYMENT=1.
function testBypassPayment() {
  try {
    let v = null;
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') {
      v = Netlify.env.get('WORLDS_TEST_BYPASS_PAYMENT');
    }
    if (v == null || v === '') v = process.env.WORLDS_TEST_BYPASS_PAYMENT;
    if (v !== '1' && v !== 'true') return false;
    // Refuse to bypass payment on production-looking deployments. This prevents
    // an accidental env copy from enabling free world claims in prod.
    if (isProductionLikeHost()) {
      console.error('[world-claim] WORLDS_TEST_BYPASS_PAYMENT is set but URL looks like production — refusing');
      return false;
    }
    return true;
  } catch (_) {}
  return false;
}

// WORLDS_VERIFY_ONCHAIN=0 only skips verification on local/preview hosts; on a
// production-looking deployment the flag is ignored and verification always
// runs, mirroring the WORLDS_TEST_BYPASS_PAYMENT guard above.
export function verificationRequired() {
  if (onchainVerificationRequired()) return true;
  if (isProductionLikeHost()) {
    console.error('[world-claim] WORLDS_VERIFY_ONCHAIN=0 is set but URL looks like production — verifying anyway');
    return true;
  }
  return false;
}

// Confirm-path rejection carrying the HTTP status; thrown inside the claim
// transaction so the intent consumption rolls back with it.
export class ClaimRejection extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// The whole confirm flow runs in ONE transaction whose first statement consumes
// the payment intent (pending -> paid). Every later failure — amount below
// price, wallet mismatch, failed on-chain verification, losing the world-flip
// race — throws and rolls the consumption back, so the intent is either fully
// spent on exactly one world or still pending. A replayed confirm finds the
// intent no longer pending and gets a 409 before any verification runs.
// Exported (with injectable verification deps) so tests can drive it against a
// mock sql without a database or Solana RPC.
export async function confirmClaim(sql, { profile, worldId, price, paymentIntentId, signature }, deps = {}) {
  const verifyTransfer = deps.verifyTransfer || verifyUsdcTransfer;
  const requireVerification = deps.requireVerification || verificationRequired;
  return sql.begin(async (sql) => {
    const consumed = await sql`
      UPDATE wallet_payment_intents
      SET status = 'paid', signature = COALESCE(${signature || null}, signature), updated_at = NOW()
      WHERE id = ${paymentIntentId} AND profile_id = ${profile.id} AND status = 'pending'
      RETURNING *
    `;
    if (!consumed.length) {
      const existing = await sql`
        SELECT id FROM wallet_payment_intents
        WHERE id = ${paymentIntentId} AND profile_id = ${profile.id}
        LIMIT 1
      `;
      if (!existing.length) throw new ClaimRejection('Payment intent not found', 404);
      throw new ClaimRejection('Payment intent already used', 409);
    }
    const intent = consumed[0];

    // The amount paid must cover the live price.
    if (Number(intent.amount) + 1e-9 < price) throw new ClaimRejection('Payment amount is below the world price', 402);

    // The paying wallet must match the signed-in player's linked wallet.
    const myWallet = await linkedWallet(sql, profile.id);
    if (!myWallet) throw new ClaimRejection('Link a wallet before buying a world', 400);
    if (intent.payer_wallet && intent.payer_wallet !== myWallet) {
      throw new ClaimRejection('The paying wallet must be your linked wallet', 403);
    }

    // On-chain verification (real USDC). Fails closed unless explicitly
    // disabled, and the disable flag is ignored on production hosts.
    let verified = false;
    if (requireVerification()) {
      const check = await verifyTransfer({
        signature,
        recipient: intent.recipient_wallet,
        mint: worldsUsdcMint() || intent.token_mint || '',
        minAmount: price,
        reference: intent.reference_key,
      });
      if (!check.ok) throw new ClaimRejection('Payment not verified on chain: ' + check.reason, 402);
      verified = true;
    }

    // Race-safe ownership flip: only one concurrent confirm wins the single
    // conditional UPDATE; the loser sees zero rows, gets a 409, and keeps its
    // payment intent (the rollback restores it to pending).
    const claimed = await sql`
      UPDATE worlds
      SET status = 'draft', owner_profile_id = ${profile.id}, price_usdc = ${price}, updated_at = NOW()
      WHERE id = ${worldId} AND status = 'unclaimed'
      RETURNING *
    `;
    if (!claimed.length) throw new ClaimRejection('World was just claimed by someone else', 409);

    await sql`
      INSERT INTO world_claims (world_id, buyer_profile_id, seller_profile_id, payment_intent_id, price_usdc, signature, status)
      VALUES (${worldId}, ${profile.id}, NULL, ${paymentIntentId}, ${price}, ${signature || null}, ${verified ? 'completed' : 'verified'})
    `;
    await sql`
      UPDATE world_economy_state SET claimed_count = claimed_count + 1, updated_at = NOW() WHERE id = 1
    `;
    await sql`
      INSERT INTO player_resources (profile_id) VALUES (${profile.id}) ON CONFLICT (profile_id) DO NOTHING
    `;
    return { world: claimed[0], verified };
  });
}

async function linkedWallet(sql, profileId) {
  const rows = await sql`
    SELECT public_key FROM wallet_accounts
    WHERE profile_id = ${profileId} AND provider = 'phantom'
    ORDER BY verified_at DESC LIMIT 1
  `;
  return rows[0] ? rows[0].public_key : '';
}

export default async function worldClaimFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
  if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);
    const body = await readJson(request);
    const action = String((body && body.action) || 'quote').trim();
    const worldId = Number(body && body.worldId);
    if (!Number.isInteger(worldId) || worldId < 1) return errorResponse('Invalid world id', 400, origin);

    const economy = await loadEconomy(sql);
    const worldRows = await sql`SELECT * FROM worlds WHERE id = ${worldId} LIMIT 1`;
    if (!worldRows.length) return errorResponse('World not found', 404, origin);
    const world = worldRows[0];
    const resourceStats = deriveResourceStats(world.data, world.grid_size);
    const price = computeWorldPurchasePrice(world.tile_count, economy, resourceStats);

    if (action === 'quote') {
      if (world.status !== 'unclaimed') return errorResponse('World is not for sale', 409, origin);
      return jsonResponse({
        worldId,
        priceUsdc: String(price),
        recipientWallet: process.env.TINYWORLD_PAYMENT_WALLET || '',
        tokenMint: worldsUsdcMint(),
      }, origin);
    }

    if (action !== 'confirm') return errorResponse('Unknown claim action', 400, origin);
    if (world.status !== 'unclaimed') return errorResponse('World is no longer for sale', 409, origin);

    // Test bypass: real ownership flip + full records, no wallet/payment required.
    if (testBypassPayment()) {
      const claimed = await sql`
        UPDATE worlds
        SET status = 'draft', owner_profile_id = ${profile.id}, price_usdc = ${price}, updated_at = NOW()
        WHERE id = ${worldId} AND status = 'unclaimed'
        RETURNING *
      `;
      if (!claimed.length) return errorResponse('World was just claimed by someone else', 409, origin);
      await sql`
        INSERT INTO world_claims (world_id, buyer_profile_id, seller_profile_id, payment_intent_id, price_usdc, signature, status)
        VALUES (${worldId}, ${profile.id}, NULL, NULL, ${price}, 'test-bypass', 'completed')
      `;
      await sql`UPDATE world_economy_state SET claimed_count = claimed_count + 1, updated_at = NOW() WHERE id = 1`;
      await sql`INSERT INTO player_resources (profile_id) VALUES (${profile.id}) ON CONFLICT (profile_id) DO NOTHING`;
      return jsonResponse({ world: worldDto(claimed[0], { includeData: true }), verified: false }, origin, 201);
    }

    const paymentIntentId = Number(body && body.paymentIntentId);
    const signature = String((body && body.signature) || '').trim().slice(0, 120);
    if (!Number.isInteger(paymentIntentId) || paymentIntentId < 1) return errorResponse('Missing payment intent', 400, origin);

    let result;
    try {
      result = await confirmClaim(sql, { profile, worldId, price, paymentIntentId, signature });
    } catch (err) {
      if (err instanceof ClaimRejection) return errorResponse(err.message, err.status, origin);
      throw err;
    }

    return jsonResponse({ world: worldDto(result.world, { includeData: true }), verified: result.verified }, origin, 201);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (isMissingClaimSchema(err)) {
      return errorResponse('World/payment tables are missing. Run the Netlify migrations.', 503, origin);
    }
    console.error('[world-claim]', err);
    return errorResponse('Claim failed', 500, origin);
  }
}
