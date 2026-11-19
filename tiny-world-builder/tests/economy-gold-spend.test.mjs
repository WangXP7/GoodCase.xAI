// tests/economy-gold-spend.test.mjs
// E3: the ledger-authoritative spend decision the /api/me/gold/spend endpoint composes
// (reduceGoldLedger -> spendGold). The DB transaction / advisory-lock / idempotency
// wrapper is integration-tested separately (it needs a real Postgres); this proves the
// pure money math the endpoint trusts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduceGoldLedger,
  spendGold,
  createGoldLedgerEvent,
  currentCycleId,
} from '../packages/tinyworld-mmo-core/src/index.js';

const NOW = new Date('2026-06-24T00:00:00Z');
const WALLET = 'profile:1';
const CYCLE = currentCycleId(NOW);

function allowanceEvent(amount) {
  return createGoldLedgerEvent('ALLOWANCE_RECALCULATED', { wallet: WALLET, cycleId: CYCLE, amount }, NOW);
}
function decide(events, amount, key = 'idem-key-00000001') {
  const summary = reduceGoldLedger(events, { wallet: WALLET, cycleId: CYCLE });
  return { summary, spend: spendGold(summary, amount, { wallet: WALLET, action: 'template-remix', referenceId: key }) };
}

test('a spend within the cycle allowance succeeds and debits available', () => {
  const { spend } = decide([allowanceEvent(500)], 120);
  assert.equal(spend.ok, true);
  assert.equal(spend.available, 380);
  assert.equal(spend.event.type, 'GOLD_SPENT');
  assert.equal(spend.event.amount, 120);
  assert.equal(spend.event.wallet, WALLET);
  assert.equal(spend.event.cycleId, CYCLE);
  assert.equal(spend.event.referenceId, 'idem-key-00000001');
});

test('a spend over available is rejected (insufficient-gold), no event', () => {
  const { spend } = decide([allowanceEvent(500), goldSpent(450)], 100);
  assert.equal(spend.ok, false);
  assert.equal(spend.reason, 'insufficient-gold');
  assert.equal(spend.available, 50);
  assert.equal(spend.event, undefined);
});

test('with NO allowance event for the cycle, available is 0 and spends are refused', () => {
  const { summary, spend } = decide([], 1);
  assert.equal(summary.available, 0);
  assert.equal(spend.ok, false);
  assert.equal(spend.reason, 'insufficient-gold');
});

test('invalid (zero / negative) amounts are rejected before any debit', () => {
  assert.equal(decide([allowanceEvent(500)], 0).spend.reason, 'invalid-amount');
  assert.equal(decide([allowanceEvent(500)], -10).spend.reason, 'invalid-amount');
});

test('the available reflects allowance minus prior spends plus refunds', () => {
  const events = [allowanceEvent(1000), goldSpent(300), goldRefunded(100)];
  const summary = reduceGoldLedger(events, { wallet: WALLET, cycleId: CYCLE });
  assert.equal(summary.allowance, 1000);
  assert.equal(summary.spent, 300);
  assert.equal(summary.refunded, 100);
  assert.equal(summary.available, 800); // 1000 - 300 + 100
  // a spend of exactly the remaining available succeeds and zeroes it
  const spend = spendGold(summary, 800, { wallet: WALLET, action: 'upgrade', referenceId: 'k-2' });
  assert.equal(spend.ok, true);
  assert.equal(spend.available, 0);
});

test('a later ALLOWANCE_RECALCULATED replaces (not adds to) the cycle allowance', () => {
  // reduceGoldLedger SETS allowance to the latest ALLOWANCE_RECALCULATED amount.
  const events = [allowanceEvent(500), allowanceEvent(1500)];
  const summary = reduceGoldLedger(events, { wallet: WALLET, cycleId: CYCLE });
  assert.equal(summary.allowance, 1500);
  assert.equal(summary.available, 1500);
});

test('allowance is order-sensitive — the LAST event wins (so DB reads MUST be chronologically ordered)', () => {
  // If an allowance is lowered 1000 -> 100, feeding the rows in the wrong physical
  // order would keep the stale 1000 and let the player overspend. This is why the
  // endpoint reads events ORDER BY created_at ASC, id ASC. (Codex E3 finding #1.)
  const chronological = [allowanceEvent(1000), allowanceEvent(100)];
  const reversed = [allowanceEvent(100), allowanceEvent(1000)];
  assert.equal(reduceGoldLedger(chronological, { wallet: WALLET, cycleId: CYCLE }).allowance, 100);
  assert.equal(reduceGoldLedger(reversed, { wallet: WALLET, cycleId: CYCLE }).allowance, 1000);
});

function goldSpent(amount) {
  return createGoldLedgerEvent('GOLD_SPENT', { wallet: WALLET, cycleId: CYCLE, amount, referenceId: 'seed-' + amount }, NOW);
}
function goldRefunded(amount) {
  return createGoldLedgerEvent('GOLD_REFUNDED', { wallet: WALLET, cycleId: CYCLE, amount, referenceId: 'ref-' + amount }, NOW);
}
