import assert from 'node:assert/strict';
import test from 'node:test';
import { poleCollider, treeColliders } from '../js/street-colliders.js';

test('a pole: a thin box around it, from the ground up', () => {
  assert.deepEqual(poleCollider(10, -4, 0.15, 4.2), { minX: 9.85, maxX: 10.15, minZ: -4.15, maxZ: -3.85, maxY: 4.2, kind: 'pole' });
});

test('tree trunks: thicker for taller trees, solid up to under the crown', () => {
  const [small, big] = treeColliders([{ x: 0, y: 0.22, z: 0, height: 7.5 }, { x: 5, y: 0, z: 5, height: 30 }]);
  assert.ok(small.maxX - small.minX < big.maxX - big.minX, 'the big tree is thicker');
  assert.ok(big.maxX - big.minX <= 0.84 + 1e-9, 'within reason');
  assert.ok(small.maxY > 4 && small.maxY < 7.5, `stops below the top (${small.maxY})`);
  assert.equal((big.minX + big.maxX) / 2, 5);
});
