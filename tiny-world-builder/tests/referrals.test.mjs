// tests/referrals.test.mjs
// G1: pure referral-code validation + generation. The reward/cap/idempotency behaviour
// is integration-tested (needs profiles+referrals+coin schema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidReferralCode, randomReferralCode,
  REFERRER_REWARD, REFEREE_REWARD, MAX_REWARDS_PER_CYCLE,
} from '../netlify/functions/lib/referrals.mjs';

test('valid referral codes are 6-16 alphanumerics', () => {
  assert.equal(isValidReferralCode('ABCDEF'), true);
  assert.equal(isValidReferralCode('tw2k9xq'), true);
  assert.equal(isValidReferralCode('short'), false); // 5
  assert.equal(isValidReferralCode(''), false);
  assert.equal(isValidReferralCode(null), false);
  assert.equal(isValidReferralCode('has space'), false);
  assert.equal(isValidReferralCode('toolongtoolongtoolong'), false); // >16
});

test('generated codes are the right length, valid, and avoid ambiguous chars', () => {
  for (let i = 0; i < 50; i++) {
    const c = randomReferralCode();
    assert.equal(c.length, 8);
    assert.equal(isValidReferralCode(c), true, `generated code ${c} should validate`);
    assert.ok(!/[0O1I]/.test(c), `code ${c} must avoid ambiguous chars`);
  }
});

test('reward economics match the decided defaults', () => {
  assert.equal(REFERRER_REWARD, 50);
  assert.equal(REFEREE_REWARD, 25);
  assert.equal(MAX_REWARDS_PER_CYCLE, 10);
});
