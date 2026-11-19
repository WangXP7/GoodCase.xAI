import test from 'node:test';
import assert from 'node:assert/strict';
import { withArenaRivals, type StandingRow } from '../lib/duel/arena-rivals';

await test('an empty board gets ten stable, distinct starter rivals', () => {
  const rows = withArenaRivals([]);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.userId)).size, 10);
  assert.equal(new Set(rows.map(row => row.name)).size, 10);
  assert.ok(rows.every(row => row.arenaRival && /^Player \d{2}$/.test(row.name)));
  assert.deepEqual(withArenaRivals([]), rows);
});

await test('starter rivals fill the display without mutating real records or duplicating their names', () => {
  const real = [{ rank: 1, userId: 'real-person', name: 'Player 24', wins: 30, losses: 2 }];
  const snapshot = structuredClone(real);
  const rows = withArenaRivals(real);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], real[0]);
  assert.equal(rows.filter(row => row.name === 'Player 24').length, 1);
  assert.deepEqual(real, snapshot);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].wins >= rows[i].wins);
});

await test('a populated board shows real players only and preserves every score', () => {
  const real: StandingRow[] = Array.from({ length: 15 }, (_, i) => ({ rank: i + 1, userId: `real-${i}`, name: `Duelist ${i}`, wins: 20 - i, losses: 5 }));
  assert.deepEqual(withArenaRivals(real), real);
});
