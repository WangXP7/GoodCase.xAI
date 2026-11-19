// Neon and lit signs that come alive with the power: the garage's roof sign and fascia
// line, and the powered lights that make the switch change the whole map. Sign faces are quads in
// the object material: dead tube-grey lettering until the power channel's gain rises.
import { M, rgb } from '../build.js';
import { BoxGeometry } from 'three';
import { sheetAspect, sheetUv } from '../../mats/yard.js';

const DEAD = [0.12, 0.12, 0.13];

// lettering from the sheet on a wall or a frame. o: lower-left corner as seen, u: unit [x, y, z] to
// the viewer's right, w: width in metres; parts: [[u0, u1, glow]] slices of the entry, each its own colour
export function neonLetters(O, entry, o, u, w, parts, ch) {
  const h = w / sheetAspect(entry);
  for (const [u0, u1, glow] of parts) {
    const a = [o[0] + u[0] * w * u0, o[1], o[2] + u[2] * w * u0];
    O.quad(a, [u[0] * w * (u1 - u0), 0, u[2] * w * (u1 - u0)], [0, h, 0], { color: DEAD, glow, ch, ...sub(entry, u0, u1) });
  }
  return h;
}
function sub(entry, u0, u1) { return { uv: sheetUv(entry, u0, 0, u1, 1) }; }

// The garage: "Rudy's GARAGE" on a frame along the roof's west edge, the trade line on the fascia.
// A: the garage art (for the frame); O: the garage's object mesh
export function placeGarageSign(A, O, power) {
  const x = 45.86, z0 = 7.0, w = 10.0;
  const h = neonLetters(O, 'garage', [x, 6.75, z0], [0, 0, 1], w, [[0, 0.315, [0.5, 5.2, 4.4]], [0.315, 1, [8.5, 1.1, 0.55]]], power);
  // the frame: two rails, posts and raking stays back onto the roof
  const steel = rgb(0x1c1a18);
  for (const y of [6.72, 6.75 + h + 0.03]) A.box('paint', [x + 0.03, y - 0.03, z0 - 0.15], [x + 0.09, y + 0.03, z0 + w + 0.15], steel);
  for (let z = z0; z <= z0 + w + 0.01; z += w / 5) {
    A.box('paint', [x + 0.03, 6.5, z - 0.035], [x + 0.1, 6.8 + h, z + 0.035], steel);
    A.box('paint', [x + 0.1, 6.5, z - 0.025], [x + 1.5, 6.55, z + 0.025], steel, {});
    A.add('paint', new BoxGeometry(0.05, Math.hypot(1.4, h + 0.2), 0.05), { m: M(x + 0.8, 6.55 + (h + 0.2) / 2, z, 0, 0, Math.atan2(1.4, h + 0.2)), color: steel });
  }
  // the trade line on the fascia board
  A.box('paint', [x + 0.02, 4.72, 7.6], [x + 0.13, 5.6, 16.4], rgb(0x14181a), { par: 1 });
  neonLetters(O, 'garageSub', [x + 0.012, 4.8, 8.0], [0, 0, 1], 8.0, [[0, 1, [5.5, 2.9, 0.5]]], power);
  return { pos: [44.6, 7.4, 12], h };
}

// Power across the rest of the map. The forecourt was built lit, so the switch has to add
// to it: a run of hot neon under the canopy's fascia all the way round, a TRUCK STOP topper and a
// neon border on the price sign, OPEN over the store's door side of the canopy, and coloured light
// from each on the wet ground. The diner's and the motel's own signs are their zones' (they already
// follow the power); each gets a light here so its colour lands on the lot.
// L: layout.js (the forecourt); returns the lights to register: [{ pos, color, lumens, range }]
export function placePowerNeon(ctx, L, W, power) {
  const O = ctx.stat('forecourt');
  const lights = [];
  const c = L.CANOPY, y = c.under - 0.02, e = 0.07;
  const PINK = [10, 0.7, 2.6], AMBER = [7, 3.4, 0.5];
  const tube = (x0, z0, x1, z1) => O.box([Math.min(x0, x1) - 0.022, y - 0.022, Math.min(z0, z1) - 0.022], [Math.max(x0, x1) + 0.022, y + 0.022, Math.max(z0, z1) + 0.022], [0.1, 0.09, 0.1], { glow: PINK, ch: power });
  tube(c.x0 - e, c.z0 - e, c.x1 + e, c.z0 - e); tube(c.x0 - e, c.z1 + e, c.x1 + e, c.z1 + e);
  tube(c.x0 - e, c.z0 - e, c.x0 - e, c.z1 + e); tube(c.x1 + e, c.z0 - e, c.x1 + e, c.z1 + e);
  // a second, thinner line of amber above it on the long faces
  for (const z of [c.z0 - e, c.z1 + e]) O.box([c.x0, y + 0.1, z - 0.012], [c.x1, y + 0.124, z + 0.012], [0.1, 0.09, 0.08], { glow: AMBER, ch: power });
  for (const [x, z] of [[(c.x0 + c.x1) / 2 - 5, c.z1 + 0.7], [(c.x0 + c.x1) / 2 + 5, c.z1 + 0.7], [c.x0 - 0.7, (c.z0 + c.z1) / 2], [c.x1 + 0.7, (c.z0 + c.z1) / 2]]) lights.push({ pos: [x, y - 0.2, z], color: [1.0, 0.12, 0.3], lumens: 2600, range: 9, priority: 0.6 });
  // the price sign: its cabinet is 2.7 wide from y 2.6 to 7.9, at (-16.6, 17.6) turned 0.55
  O.at(M(-16.6, 0, 17.6, 0, 0.55, 0), () => {
    for (const f of [1, -1]) {
      const z = f * 0.245, u = f;
      for (const yy of [2.62, 7.9]) O.box([-1.36, yy - 0.02, z - 0.02], [1.36, yy + 0.02, z + 0.02], [0.1, 0.09, 0.1], { glow: PINK, ch: power });
      for (const x of [-1.36, 1.36]) O.box([x - 0.02, 2.62, z - 0.02], [x + 0.02, 7.9, z + 0.02], [0.1, 0.09, 0.1], { glow: PINK, ch: power });
      O.quad([-1.45 * u, 8.2, f * 0.13], [2.9 * u, 0, 0], [0, 0.665, 0], { tex: 'topper', color: [0.16, 0.16, 0.16], glow: [6.5, 3.6, 0.6], ch: power });
    }
    O.box([-1.5, 8.12, -0.12], [1.5, 8.94, 0.12], [0.02, 0.02, 0.02]);
    for (const x of [-1.2, 1.2]) O.box([x - 0.04, 8.0, -0.04], [x + 0.04, 8.14, 0.04], [0.05, 0.05, 0.05]);
  });
  lights.push({ pos: [-16.0, 6.4, 18.6], color: [1.0, 0.3, 0.25], lumens: 3000, range: 11, priority: 0.6 });
  // the diner's and the motel's signs, as light on the ground in front of them
  const d1 = W.doors.find((d) => d.id === 'd1');
  if (d1) lights.push({ pos: [d1.pos[0], 4.0, d1.pos[2] + 1.6], color: [1.0, 0.16, 0.2], lumens: 3200, range: 10, priority: 0.7 });
  lights.push({ pos: [36, 5.6, -35.4], color: [1.0, 0.7, 0.3], lumens: 2600, range: 11, priority: 0.5, zone: 'motel' });
  return lights;
}
