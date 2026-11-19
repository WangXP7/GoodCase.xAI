import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeResourceSale, RESOURCE_GOLD_RATES, isSellableResource } from '../netlify/functions/lib/resources.mjs';

test('server-authoritative rates compute the right gold', () => {
  const r = computeResourceSale({ fish: 10, meat: 5, plants: 4, ore: 2 });
  // 10*1 + 5*2 + 4*1 + 2*3 = 10+10+4+6 = 30
  assert.equal(r.gold, 30);
  assert.equal(r.totalUnits, 21);
  assert.deepEqual(r.amounts, { fish: 10, meat: 5, plants: 4, ore: 2 });
});

test('unknown keys, negatives, fractions, and overflow are ignored/floored', () => {
  const r = computeResourceSale({ fish: -5, meat: 2.9, gold: 999, diamonds: 100, ore: 3 });
  assert.equal(r.amounts.fish, 0); // negative ignored
  assert.equal(r.amounts.meat, 2); // floored
  assert.equal(r.amounts.ore, 3);
  assert.equal(r.gold, 2 * RESOURCE_GOLD_RATES.meat + 3 * RESOURCE_GOLD_RATES.ore); // 4 + 9 = 13
});

test('empty / junk input yields nothing to sell', () => {
  for (const bad of [null, {}, { gold: 100 }, { fish: 0 }, 'x']) {
    const r = computeResourceSale(bad);
    assert.equal(r.totalUnits, 0);
    assert.equal(r.gold, 0);
  }
});

test('a single oversized amount is rejected (bounded)', () => {
  const r = computeResourceSale({ ore: 2_000_000_000 });
  assert.equal(r.amounts.ore, 0);
  assert.equal(r.gold, 0);
});

test('isSellableResource guards the type list', () => {
  assert.equal(isSellableResource('ore'), true);
  assert.equal(isSellableResource('gold'), false);
  assert.equal(isSellableResource('__proto__'), false);
});
