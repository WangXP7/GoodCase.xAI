// Diner seating: a booth unit (two benches and a table, end on to a wall) and a counter
// stool. Authored into the area's art mesh (mats/interior.js), colliders into the level builder.
// Local frame of a booth: origin on the wall at the floor, +z out into the room, x along the wall.
import { M, box, cyl, cylUp, lathe, rgb, sphere } from '../build.js';

const CHROME = rgb(0xb9bec2);
const RED = rgb(0x8f1c16);
const BASE = rgb(0x1c1a18);

// o: { vinyl (linear rgb), table: 'clean'|'meal'|'blood', lamp: bool, rng }
export function buildBooth(A, o = {}) {
  const B = A.B, vinyl = o.vinyl || RED, r = o.rng;
  for (const s of [-1, 1]) {
    const x0 = s * 0.5, x1 = s * 1.02; // seat from the table side to the back
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    A.box('paint', [lo + 0.03, 0, 0.04], [hi, 0.36, 1.16], BASE);
    A.box('vinyl', [lo, 0.34, 0.03], [hi - 0.08, 0.47, 1.18], vinyl, { bevel: 0.04, shadow: true });
    // channel-tufted back: three cushions, a chrome cap
    for (let i = 0; i < 3; i++) A.box('vinyl', [s > 0 ? 0.94 : -1.07, 0.47, 0.04 + i * 0.38], [s > 0 ? 1.07 : -0.94, 1.08, 0.4 + i * 0.38], vinyl, { bevel: 0.035 });
    A.box('paint', [s > 0 ? 1.04 : -1.1, 0, 0.03], [s > 0 ? 1.1 : -1.04, 1.1, 1.18], BASE, { shadow: true });
    A.box('metal', [s > 0 ? 0.93 : -1.1, 1.08, 0.02], [s > 0 ? 1.1 : -0.93, 1.115, 1.19], CHROME, { bevel: 0.01 });
    B.collide([lo, 0, 0.03], [hi, 0.47, 1.18], 'cloth');
    B.collide([s > 0 ? 0.94 : -1.1, 0.47, 0.03], [s > 0 ? 1.1 : -0.94, 1.11, 1.18], 'cloth');
  }
  // table: laminate top with a chrome edge, pedestal, a wall cleat
  A.box('laminate', [-0.36, 0.72, 0.02], [0.36, 0.755, 1.08], rgb(0xb9b09a), { bevel: 0.012, shadow: true });
  A.box('metal', [-0.375, 0.715, 0.02], [0.375, 0.735, 1.095], CHROME);
  A.add('metal', cylUp(0.045, 0.045, 0.72, 10), { m: M(0, 0, 0.62), color: CHROME });
  A.add('metal', cylUp(0.24, 0.26, 0.03, 14), { m: M(0, 0, 0.62), color: CHROME });
  B.collide([-0.36, 0, 0.02], [0.36, 0.755, 1.08], 'metal');
  // what was left on it
  A.detail(() => {
    const y = 0.757;
    A.box('metal', [-0.07, y, 0.08], [0.07, y + 0.13, 0.19], CHROME, { bevel: 0.01 }); // napkins
    A.add('paint', cylUp(0.027, 0.03, 0.15, 8), { m: M(0.14, y, 0.14), color: rgb(0x9a1410), par: 1 }); // ketchup
    A.add('paint', cylUp(0.025, 0.028, 0.12, 8), { m: M(-0.15, y, 0.12), color: rgb(0xc9a416), par: 1 });
    if (o.table === 'clean') return;
    for (const [px, pz, k] of [[-0.18, 0.5, 0], [0.17, 0.72, 1]]) {
      A.add('paint', lathe([[0, 0], [0.07, 0], [0.125, 0.018], [0.13, 0.022], [0, 0.012]], 14), { m: M(px, y, pz), color: rgb(0xd8d4c6), par: 1 });
      if (o.table === 'meal') A.add('paint', sphere(0.05, 8, 5), { m: M(px + 0.01, y + 0.02, pz, 0, 0, 0, 1.2, 0.4, 0.9), color: k ? rgb(0x3a2a14) : rgb(0x5a4a1a) });
      A.add('paint', lathe([[0, 0], [0.03, 0], [0.04, 0.07], [0.036, 0.07], [0.028, 0.012], [0, 0.012]], 10), { m: M(px + (k ? -0.2 : 0.2), y, pz + 0.12), color: rgb(0xc9c4b4), par: 1 });
    }
    if (r && r.next() < 0.5) A.box('paint', [-0.3, y, 0.86], [-0.1, y + 0.004, 1.0], rgb(0xcfc8b0), { ry: 0.3 });
    if (o.table === 'blood') A.sign('splat', [-0.3, y + 0.003, 0.9], [0.6, 0, 0], [0, 0, -0.6], { color: [0.16, 0.008, 0.006], par: 1 });
  });
  // pendant over the table
  if (o.lamp) {
    A.add('paint', cyl(0.006, 0.006, 1.2, 5), { m: M(0, 2.9, 0.55), color: BASE });
    A.add('paint', lathe([[0.03, 0.2], [0.05, 0.16], [0.2, 0.02], [0.205, 0], [0.19, 0.005], [0.04, 0.15]], 16), { m: M(0, 2.1, 0.55), color: rgb(0x7a1612), par: 1 });
    A.add('glow', sphere(0.05, 8, 6), { m: M(0, 2.14, 0.55), color: [0.3, 0.28, 0.22], glow: [22, 15, 8], power: true });
  }
}

// a counter stool, origin at its foot
export function buildStool(A, o = {}) {
  const B = A.B, vinyl = o.vinyl || RED;
  A.add('metal', cylUp(0.2, 0.22, 0.025, 14), { color: CHROME });
  A.add('metal', cylUp(0.035, 0.05, 0.6, 10), { m: M(0, 0.02, 0), color: CHROME, shadow: true });
  A.add('metal', lathe([[0.17, 0], [0.185, 0.01], [0.185, 0.03], [0.17, 0.04]], 14), { m: M(0, 0.2, 0), color: CHROME });
  A.add('metal', cylUp(0.195, 0.195, 0.035, 20), { m: M(0, 0.62, 0), color: CHROME });
  A.add('vinyl', lathe([[0, 0], [0.19, 0], [0.18, 0.045], [0.12, 0.068], [0, 0.07]], 20), { m: M(0, 0.655, 0), color: vinyl });
  B.collide([-0.16, 0, -0.16], [0.16, 0.72, 0.16], 'metal');
}

export { box };
