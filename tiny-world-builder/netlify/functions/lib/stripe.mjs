import { createHmac, timingSafeEqual } from 'node:crypto';

// P1 — Stripe: buy Earned GOLD (Coins) with real money. Raw Stripe REST (no SDK dep).
// Inert until STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are set (test-mode-first):
// the endpoints return 503 'not configured' until then.

// GOLD packs (server-authoritative — the client only names a packId; price + coins
// come from here, never from the request).
export const GOLD_PACKS = Object.freeze({
  starter: { id: 'starter', coins: 500, amountCents: 299, name: '500 GOLD' },
  plus: { id: 'plus', coins: 1200, amountCents: 599, name: '1,200 GOLD' },
  pro: { id: 'pro', coins: 3000, amountCents: 1299, name: '3,000 GOLD' },
});

export function isGoldPack(packId) {
  return Object.prototype.hasOwnProperty.call(GOLD_PACKS, String(packId || ''));
}

export function stripeConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY || '').trim();
}

export function webhookConfigured() {
  return !!(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

// Build an x-www-form-urlencoded body from nested params, the way Stripe expects
// (e.g. line_items[0][price_data][currency]=usd).
function encodeForm(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) encodeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

// Create a Stripe Checkout Session for a GOLD pack. Returns { ok, url, id } or
// { ok:false, error }. NOTE: payment_method_types is intentionally omitted so Stripe
// shows dynamic payment methods configured in the dashboard (best practice).
export async function createCheckoutSession({ pack, profileId, idempotencyKey, successUrl, cancelUrl }) {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return { ok: false, error: 'stripe-not-configured' };
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(profileId),
    'metadata[profileId]': String(profileId),
    'metadata[packId]': pack.id,
    'metadata[coins]': String(pack.coins),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pack.amountCents),
    'line_items[0][price_data][product_data][name]': `TinyWorld ${pack.name}`,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe idempotency: a retried create returns the same session, no double charge.
        ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {}),
      },
      body: encodeForm(params),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: 'stripe-http-' + res.status, detail: data && data.error && data.error.message };
    return { ok: true, url: data.url, id: data.id };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'stripe-timeout' : 'stripe-error' };
  } finally {
    clearTimeout(timer);
  }
}

// Verify a Stripe webhook signature (the `Stripe-Signature` header: t=<ts>,v1=<sig>).
// Returns the parsed event object if valid, else null. Replays older than `toleranceSec`
// are rejected. rawBody MUST be the exact bytes Stripe sent (no JSON round-trip).
export function constructWebhookEvent(rawBody, sigHeader, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!rawBody || !sigHeader || !secret) return null;
  let t = NaN;
  const v1s = []; // Stripe may send multiple v1 signatures (key rotation) — accept any match.
  for (const kv of String(sigHeader).split(',')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) v1s.push(v);
  }
  if (!Number.isFinite(t) || !v1s.length) return null;
  if (Math.abs(nowSec - t) > toleranceSec) return null; // replay / clock skew
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const matched = v1s.some((sig) => {
    const b = Buffer.from(String(sig), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matched) return null;
  try { return JSON.parse(rawBody); } catch (_) { return null; }
}
