// Melee: who a swing reaches. Pure; firing.js's createWeapon applies the damage and emits the events.
import { tuning } from '../game/tuning.js';

const EYE = tuning.player.eye;
const FLOOR = 1.2; // m: a zombie whose feet are further than this above or below the player's is out of reach
const BODY = 0.3; // m: reach is measured to the zombie's surface, this far from its centre line

const px = (p) => (Array.isArray(p) ? p[0] : p.x);
const py = (p) => (Array.isArray(p) ? p[1] : p.y);
const pz = (p) => (Array.isArray(p) ? p[2] : p.z);

// Fills `out` with up to M.hits zombie records from `list`, nearest first, whose centre is within
// M.reach + BODY of `eye` horizontally, on the player's floor, and inside the cone M.cone (cosine) of `fwd` on the ground.
// Returns out. Allocates nothing.
export function meleeTargets(eye, fwd, list, M, out) {
  out.length = 0;
  const ex = px(eye), ez = pz(eye), feet = py(eye) - EYE;
  let fx = px(fwd), fz = pz(fwd);
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) return out;
  fx /= fl; fz /= fl;
  const max = M.reach + BODY;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || r.alive === false || !r.pos) continue;
    const ry = py(r.pos);
    if (Number.isFinite(ry) && Math.abs(ry - feet) > FLOOR) continue;
    const dx = px(r.pos) - ex, dz = pz(r.pos) - ez;
    const d = Math.hypot(dx, dz);
    if (d > max) continue;
    // right on top of the player counts as in front
    if (d > BODY && (dx * fx + dz * fz) / d < M.cone) continue;
    // insertion by distance, keeping at most M.hits
    let k = out.length;
    while (k > 0 && dist(out[k - 1], ex, ez) > d) k--;
    if (k >= M.hits) continue;
    out.splice(k, 0, r);
    if (out.length > M.hits) out.length = M.hits;
  }
  return out;
}

const dist = (r, ex, ez) => Math.hypot(px(r.pos) - ex, pz(r.pos) - ez);
