// Attachments: one of each per weapon, kept with its slot and lost with it. Pure.
import { tuning } from '../game/tuning.js';

const A = tuning.weapons.attachments;
export const ATTACHMENTS = A.kinds;

export const isAttachment = (kind) => ATTACHMENTS.includes(kind);

// A copy of `d` with the attachments in `set` applied (spread and recoil are copied before they are
// scaled, so the table is never touched).
export function applyAttachments(d, set) {
  const o = { ...d, spread: { ...d.spread }, recoil: { ...d.recoil }, suppressed: false };
  if (!set || !set.size) return o;
  if (set.has('sight')) { o.spread.ads *= A.sight.adsSpread; o.zoom = A.sight.zoom; }
  if (set.has('mag')) o.mag = Math.ceil(o.mag * A.mag.mag);
  if (set.has('grip')) { scaleRecoil(o.recoil, A.grip.recoil); o.spread.hip *= A.grip.hipSpread; }
  if (set.has('suppressor')) {
    o.range *= A.suppressor.range;
    scaleRecoil(o.recoil, A.suppressor.recoil);
    o.suppressed = true; // quiet shot, muted flash: for the view, fx and audio
  }
  return o;
}

function scaleRecoil(r, k) {
  r.pitchMin *= k; r.pitchMax *= k; r.yaw *= k; r.shake *= k; r.adsShake *= k;
}
