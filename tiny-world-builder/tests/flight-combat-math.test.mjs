// tests/flight-combat-math.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quatFromAxisAngle } from './helpers/mini-vec.mjs';
import { combatForwardFromQuats } from '../engine/world/flight-combat-math.mjs';

// Plane level, yaw 0: scene-forward must be -Z (the travel direction), NOT +Z.
// combatForwardFromQuats composes yawQuat * planeQuat and applies to (0,0,-1).
test('forward is -Z when level and unrotated', () => {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const fwd = combatForwardFromQuats(identity, identity);
  assert.ok(Math.abs(fwd.x) < 1e-9);
  assert.ok(Math.abs(fwd.y) < 1e-9);
  assert.ok(Math.abs(fwd.z + 1) < 1e-9, `expected z=-1, got ${fwd.z}`);
});

// Yaw 90 deg about +Y rotates -Z toward -X (right-handed). Confirms we compose
// yaw correctly and do NOT accidentally include the 180 model-fix.
test('yaw 90 about Y turns forward toward -X', () => {
  const yaw = quatFromAxisAngle(0, 1, 0, Math.PI / 2);
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const fwd = combatForwardFromQuats(yaw, identity);
  assert.ok(Math.abs(fwd.x + 1) < 1e-6, `expected x=-1, got ${fwd.x}`);
  assert.ok(Math.abs(fwd.z) < 1e-6, `expected z=0, got ${fwd.z}`);
});
