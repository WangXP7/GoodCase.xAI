// Shared, read-mostly runtime state. main.js writes it once per tick BEFORE world.update().
// Use state.time (simulation seconds) for any time-driven effect - never performance.now()/Date.now().
import { CONFIG } from './config.js';
// Allocation-free two-dimensional length.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

export const state = {
  time: 0, // simulation seconds
  frame: 0,
  seed: 1,
  quality: 'high',
  traveller: { x: 0, y: 0, z: 0, dirX: 0, dirZ: -1, speed: 0 },
  // Audio listener = traveller position on the page + the camera's screen-right direction on XZ.
  listener: { x: 0, z: 0, rightX: 1, rightZ: 0 },
};

/** Stereo pan (-1 left .. +1 right) for a world position, relative to the listener. */
export function panFor(x, z) {
  const l = state.listener;
  const d = (x - l.x) * l.rightX + (z - l.z) * l.rightZ;
  const range = CONFIG.REVEAL_RADIUS * CONFIG.TILE_SIZE;
  return Math.max(-1, Math.min(1, d / range));
}

/** Distance (world units) from the listener, for volume falloff. */
export function distanceFor(x, z) {
  const l = state.listener;
  return hypot2(x - l.x, z - l.z);
}
