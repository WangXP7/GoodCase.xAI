// Day / night look. The single writer of the look tunables in CONFIG (lights + post read them every frame):
// biome grade first (render/biomegrade.js, blended by biomeWeights around the traveller), night on top.
// Also drives the window / lantern glow.
import { CONFIG } from '../core/config.js';
import { state } from '../core/state.js';
import { createBiomeGrade } from './biomegrade.js';

export function createDayNight({ scene, night = false }) {
  const grade = createBiomeGrade();
  let target = night ? 1 : 0;
  let cur = target;
  let glow = null;
  let glowApplied = -1;

  function applyGlow() {
    if (!glow) {
      glow = new Set();
      scene.traverse((o) => {
        for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
          if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) glow.add(m);
        }
      });
    }
    const g = CONFIG.assets.glowIntensity;
    if (g === glowApplied) return;
    glowApplied = g;
    for (const m of glow) m.emissiveIntensity = g;
  }

  return {
    get night() { return target === 1; },
    /** The biome grade (weights, force(id)) for debugging: __atlas.daynight.grade.force('snow'). */
    grade,
    toggle() { target = target ? 0 : 1; return target === 1; },
    set(n, snap = false) { target = n ? 1 : 0; if (snap) cur = target; },
    update(dt) {
      if (cur !== target) cur = target > cur ? Math.min(target, cur + dt / 1.6) : Math.max(target, cur - dt / 1.6);
      const e = cur * cur * (3 - 2 * cur);
      const t = state.traveller;
      const ts = CONFIG.TILE_SIZE || 2;
      if (grade.update(dt, state.seed, t.x / ts, t.z / ts, e) || !glow) applyGlow();
    },
  };
}
