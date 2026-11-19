import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse } from './lib/http.mjs';
import { coinsTransaction } from './lib/coins.mjs';
import { webhookConfigured, constructWebhookEvent } from './lib/stripe.mjs';

export const config = { path: '/api/stripe/webhook' };

// P1 — Stripe webhook. NO auth: Stripe calls this; the SIGNATURE is the trust anchor.
// On a verified checkout.session.completed, credit Earned GOLD exactly once (the
// stripe_payments.session_id UNIQUE + the coin idempotency key both gate against
// double-credit on Stripe's at-least-once redelivery). Coins are re-derived from the
// server pack catalog, never trusted from event metadata.
const isMissingSchema = (err) => isMissingRelations(err, ['stripe_payments', 'coin_balances', 'coin_ledger']);

export default async function stripeWebhook(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
  if (!webhookConfigured()) return jsonResponse({ ok: false, reason: 'stripe-not-configured' }, origin, 503);

  // The signature is computed over the EXACT raw bytes — never re-serialize.
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  const event = constructWebhookEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return errorResponse('invalid-signature', 400, origin);

  // Credit on instant completion OR delayed (async) success of a Checkout payment.
  // Anything else: 200 so Stripe doesn't retry events we don't handle.
  const PAY_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
  if (!PAY_EVENTS.has(event.type)) return jsonResponse({ received: true }, origin);

  const session = (event.data && event.data.object) || {};
  const sessionId = String(session.id || '');
  if (!sessionId) return jsonResponse({ received: true, ignored: 'no-session-id' }, origin);
  // For the synchronous event, only credit once the payment is actually paid (async
  // methods arrive separately as async_payment_succeeded).
  if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
    return jsonResponse({ received: true, pending: true }, origin);
  }

  try {
    const sql = getSql();
    const result = await coinsTransaction(sql, async ({ credit, tx }) => {
      // PROVENANCE + idempotency: complete OUR pending order. Only a session we created
      // (and not yet completed) transitions; we credit using THIS row's profile_id +
      // coins, never the event's metadata. A redelivery finds no 'pending' row -> no-op.
      const ord = await tx`
        UPDATE stripe_payments SET status = 'completed', completed_at = NOW()
        WHERE session_id = ${sessionId} AND status = 'pending'
        RETURNING profile_id, coins, pack_id
      `;
      if (!ord.length) return { ok: true, alreadyProcessed: true };
      const profileId = Number(ord[0].profile_id);
      const coins = Number(ord[0].coins);
      const c = await credit({ profileId, amount: coins, type: 'CREDIT', reason: `stripe:${ord[0].pack_id}`, referenceId: 'stripe-' + sessionId });
      if (!c.ok) throw new Error('credit-failed:' + c.reason); // rolls back the completion
      return { ok: true, credited: coins, balance: c.balance };
    });
    return jsonResponse({ received: true, ...result }, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err) || isMissingSchema(err)) {
      // Tell Stripe to retry later (5xx) so the credit isn't lost if our DB is down.
      return errorResponse('stripe-webhook-unavailable', 503, origin);
    }
    console.warn('[stripe-webhook] failed:', err && err.message);
    return errorResponse('stripe-webhook-failed', 500, origin);
  }
}
