// tests/stripe.test.mjs
// P1: the security-critical pure parts — webhook signature verification + the
// server-authoritative pack catalog. The Stripe API calls + the DB credit are
// integration-level (need keys / live DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { GOLD_PACKS, isGoldPack, constructWebhookEvent } from '../netlify/functions/lib/stripe.mjs';

const SECRET = 'whsec_test_secret_value';

function signedHeader(payload, t, secret = SECRET) {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

test('pack catalog is server-authoritative and well-formed', () => {
  assert.equal(isGoldPack('starter'), true);
  assert.equal(isGoldPack('pro'), true);
  assert.equal(isGoldPack('free-gold-lol'), false);
  assert.equal(isGoldPack('__proto__'), false);
  for (const p of Object.values(GOLD_PACKS)) {
    assert.ok(p.coins > 0 && p.amountCents > 0, 'pack must have positive coins + price');
  }
});

test('a correctly-signed, fresh webhook is accepted and parsed', () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({ type: 'checkout.session.completed', id: 'evt_1' });
  const ev = constructWebhookEvent(payload, signedHeader(payload, now), SECRET, 300, now);
  assert.ok(ev);
  assert.equal(ev.type, 'checkout.session.completed');
  assert.equal(ev.id, 'evt_1');
});

test('a tampered payload is rejected (signature mismatch)', () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({ amount: 100 });
  const header = signedHeader(payload, now);
  const tampered = JSON.stringify({ amount: 999999 });
  assert.equal(constructWebhookEvent(tampered, header, SECRET, 300, now), null);
});

test('the wrong secret is rejected', () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({ ok: true });
  const header = signedHeader(payload, now, 'whsec_attacker');
  assert.equal(constructWebhookEvent(payload, header, SECRET, 300, now), null);
});

test('an expired timestamp is rejected (replay protection)', () => {
  const t = 1_700_000_000;
  const now = t + 1000; // > 300s tolerance
  const payload = JSON.stringify({ ok: true });
  assert.equal(constructWebhookEvent(payload, signedHeader(payload, t), SECRET, 300, now), null);
});

test('malformed / missing signature headers are rejected', () => {
  const now = 1_700_000_000;
  const payload = '{}';
  assert.equal(constructWebhookEvent(payload, '', SECRET, 300, now), null);
  assert.equal(constructWebhookEvent(payload, 'garbage', SECRET, 300, now), null);
  assert.equal(constructWebhookEvent(payload, 't=abc,v1=', SECRET, 300, now), null);
  assert.equal(constructWebhookEvent('', signedHeader('', now), SECRET, 300, now), null);
});
