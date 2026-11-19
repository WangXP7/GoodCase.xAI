import { requireAuthUser } from './lib/auth.mjs';
import { requireTinyverseAccess } from './lib/tinyverse-access.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { getSql } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard, absoluteSiteUrl } from './lib/http.mjs';
import { GOLD_PACKS, isGoldPack, stripeConfigured, createCheckoutSession } from './lib/stripe.mjs';

export const config = { path: '/api/stripe/checkout' };

// P1 — start a Stripe Checkout to buy a GOLD pack. The price + coins are server-side
// (GOLD_PACKS), never from the request. Returns a redirect URL. The actual crediting
// happens in the webhook after Stripe confirms payment.
export default async function stripeCheckout(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method === 'GET') {
    // Public catalog for the buy-GOLD UI.
    return jsonResponse({
      configured: stripeConfigured(),
      packs: Object.values(GOLD_PACKS).map(p => ({ id: p.id, coins: p.coins, amountCents: p.amountCents, name: p.name })),
    }, origin);
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
  if (!stripeConfigured()) return jsonResponse({ ok: false, reason: 'stripe-not-configured' }, origin, 503);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
    const tvGate = requireTinyverseAccess(auth.user, origin);
    if (tvGate) return tvGate;

  let body;
  try { body = await readJson(request); } catch (_) { return errorResponse('invalid-json', 400, origin); }
  const packId = String((body && body.packId) || '').trim();
  if (!isGoldPack(packId)) return errorResponse('invalid-pack', 400, origin);

  try {
    const profile = await ensureProfile(auth.user);
    const pack = GOLD_PACKS[packId];
    const session = await createCheckoutSession({
      pack,
      profileId: profile.id,
      idempotencyKey: (body && body.idempotencyKey) ? String(body.idempotencyKey).slice(0, 200) : undefined,
      successUrl: absoluteSiteUrl('/rewards?purchase=success'),
      cancelUrl: absoluteSiteUrl('/rewards?purchase=cancelled'),
    });
    if (!session.ok) return jsonResponse({ ok: false, reason: session.error }, origin, 502);
    // Record a PENDING order keyed by the Stripe session id. This is the provenance
    // anchor: the webhook only credits GOLD for a session that matches an order WE
    // created, using THIS row's profile_id + coins — never event-supplied metadata.
    try {
      const sql = getSql();
      await sql`
        INSERT INTO stripe_payments (session_id, profile_id, pack_id, coins, amount_cents, currency, status)
        VALUES (${String(session.id)}, ${Number(profile.id)}, ${pack.id}, ${pack.coins}, ${pack.amountCents}, 'usd', 'pending')
        ON CONFLICT (session_id) DO NOTHING
      `;
    } catch (e) {
      // If we can't record the order, don't send the user to pay for something the
      // webhook won't be able to fulfill.
      return jsonResponse({ ok: false, reason: 'order-record-failed' }, origin, 503);
    }
    return jsonResponse({ ok: true, url: session.url, sessionId: session.id }, origin);
  } catch (err) {
    return errorResponse('stripe-checkout-failed', 500, origin);
  }
}
