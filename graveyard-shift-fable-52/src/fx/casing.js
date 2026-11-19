// Where a spent case leaves the gun and how fast. Pure: plain numbers in, six numbers out.
//
// The weapon:fire payload carries `eject`, the ejection port in world space (weapon/viewmodel.js
// ejectWorld). That is where the brass starts. Only when a payload has no `eject` (no viewmodel:
// tests, a stubbed weapon) is the port estimated from the muzzle `pos`.
//
// The port in the payload is now the port itself (it used to be a point held clear of the
// gun's outline): for its first moments the case is drawn by the viewmodel as a real piece of
// brass, lit by the muzzle flash and sorted against the gun, flying this same launch (`lastLaunch`),
// and the world particle carries on from there. Weapons that throw nothing on the shot (a revolver
// keeps its cases, a pump throws its hull when the forend comes back) launch nothing here.
export const KEEPS_CASE = { revolver: true, pump: true, flare: true, jumper: true };
// The last launch: position xyz, velocity xyz (world), and a serial that goes up by one each time.
export const lastLaunch = new Float64Array(7);

const num = (v, k, i) => (v ? (v[k] !== undefined ? v[k] : v[i]) : undefined);

// e: { pos, dir, eject? } with {x,y,z} or [x,y,z] vectors. rng: { range(a, b) }.
// vel: the shooter's velocity [x,y,z] (the case inherits it) or null.
// out: array of 6: position xyz, velocity xyz. Returns out, or null when the payload has no direction.
export function casingLaunch(e, rng, vel, out = new Array(6)) {
  if (!e || !e.dir || KEEPS_CASE[e.weapon]) return null;
  let dx = num(e.dir, 'x', 0), dy = num(e.dir, 'y', 1), dz = num(e.dir, 'z', 2);
  const dl = Math.hypot(dx, dy, dz);
  if (!(dl > 1e-9)) return null;
  dx /= dl; dy /= dl; dz /= dl;
  // shooter's right: dir x up
  let rx = -dz, rz = dx;
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-6) { rx /= rl; rz /= rl; } else { rx = 1; rz = 0; }

  const port = e.eject || null;
  if (port) {
    out[0] = num(port, 'x', 0); out[1] = num(port, 'y', 1); out[2] = num(port, 'z', 2);
  } else {
    if (!e.pos) return null;
    out[0] = num(e.pos, 'x', 0) - dx * 0.13 + rx * 0.03;
    out[1] = num(e.pos, 'y', 1) - dy * 0.13 + 0.02;
    out[2] = num(e.pos, 'z', 2) - dz * 0.13 + rz * 0.03;
  }
  if (!Number.isFinite(out[0] + out[1] + out[2])) return null;

  // out to the right, a little back, and up
  const r = rng.range(1.1, 1.8), b = rng.range(0.2, 0.6), u = rng.range(1.4, 2.1);
  out[3] = rx * r - dx * b + (vel ? vel[0] || 0 : 0);
  out[4] = -dy * b + u + (vel ? vel[1] || 0 : 0);
  out[5] = rz * r - dz * b + (vel ? vel[2] || 0 : 0);
  for (let i = 0; i < 6; i++) lastLaunch[i] = out[i];
  lastLaunch[6] += 1;
  return out;
}
