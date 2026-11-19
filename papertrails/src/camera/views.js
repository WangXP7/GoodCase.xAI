// Camera views cycled with V. Each view is a set of overrides for the follow camera (follow.setPose); the change
// is eased over ~0.9 s so the lens glides instead of cutting.
import { CONFIG } from '../core/config.js';
import { state } from '../core/state.js';

export const VIEWS = [
  { name: 'journey', cam: {} }, // the default gameplay framing
  { name: 'close', cam: { distance: 6.4, pitchDeg: 30, fov: 30, screenUp: 0.35, yawDeg: 0 } }, // beside the traveller
  { name: 'wide', cam: { distance: 14.5, pitchDeg: 47, fov: 27, screenUp: 1.0, yawDeg: 0, reach: 0.9 } }, // the whole spread
  { name: 'low', cam: { distance: 7.6, pitchDeg: 25, fov: 32, screenUp: 0.5, yawDeg: -24, reach: 0.4 } }, // low side-on diorama shot
  { name: 'postcard', cam: { distance: 9.6, pitchDeg: 30, fov: 30, screenUp: 0.55, yawDeg: 26, reach: 0.5 } }, // three-quarter from the other side
];
// reach = extra reveal radius in tiles (world.js reads state.viewReach): a far view sees past the ring of risen tiles
const KEYS = ['distance', 'pitchDeg', 'yawDeg', 'fov', 'screenUp', 'reach'];

export function createViews({ follow }) {
  const C = CONFIG.camera;
  const base = {};
  for (const k of KEYS) base[k] = C[k] ?? 0;
  const cur = { ...base };
  const from = { ...base };
  const to = { ...base };
  let index = 0;
  let t = 1;
  const DUR = 0.9;

  function go(i) {
    index = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
    for (const k of KEYS) { from[k] = cur[k]; to[k] = VIEWS[index].cam[k] ?? base[k]; }
    t = 0;
  }
  return {
    get index() { return index; },
    get name() { return VIEWS[index].name; },
    next() { go(index + 1); return VIEWS[index].name; },
    set(i, snap = false) { go(i); if (snap) { t = 0.9999; } },
    update(dt) {
      if (t >= 1) return;
      t = Math.min(1, t + dt / DUR);
      const e = t * t * (3 - 2 * t);
      for (const k of KEYS) cur[k] = from[k] + (to[k] - from[k]) * e;
      state.viewReach = cur.reach || 0;
      follow.setPose(t >= 1 && index === 0 ? null : cur);
    },
  };
}
