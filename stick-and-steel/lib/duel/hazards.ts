/** Metres; shared by collision shapes and scenery so every visible spike is solid. */
export const PIT_SPIKES = Array.from({ length: 15 * 9 }, (_, i) => ({
  x: -4.9 + (i % 15) * .7,
  y: -6.55,
  z: -2.8 + Math.floor(i / 15) * .7,
}));
export const SPIKE_RADIUS = .16, SPIKE_HEIGHT = .9;
