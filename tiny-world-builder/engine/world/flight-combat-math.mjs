// engine/world/flight-combat-math.mjs
// Pure geometry shared by the browser module and node tests. No THREE, no DOM.
// IMPORTANT: this composes yawQuat * planeQuat and applies (0,0,-1) — it does
// NOT include FLIGHT_MODEL_FWD_FIX. The model's 180 visual spin must stay out
// of the firing direction or bullets fly out the tail.
function mulQuat(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function applyQuat(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
export function combatForwardFromQuats(yawQuat, planeQuat) {
  const q = mulQuat(yawQuat, planeQuat);
  const v = applyQuat(q, { x: 0, y: 0, z: -1 });
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
