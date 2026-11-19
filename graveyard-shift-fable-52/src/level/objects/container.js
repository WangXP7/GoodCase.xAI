// Searchable containers that are not vehicles. Barrels, crates, bins, suitcases and
// dressers are built by buildStandIn in props/kitchen.js: each already leaves its lid, drawer or case
// open once searched); this adds the garage's own: the steel locker (its door hangs open on what was
// in it) and the tool chest (two drawers left out). All are drawn in the area's art mesh and move
// through A.movable, so `searched` shows for the rest of the game and resets with the level.
import { M, rgb } from '../build.js';
import { buildStandIn } from '../props/kitchen.js';

const STEEL = rgb(0x8a8e92), TAG = rgb(0xc9a227);

// s: the searchable; st: [x, z, w, d, h, y0]; o.face: unit [x, z] the front looks along
export function buildContainer(A, s, st, o = {}) {
  const B = A.B;
  if (s.kind !== 'locker' && s.kind !== 'toolchest') return buildStandIn(A, s, st, o);
  const [x, z, w, d, h, y0 = 0] = st;
  const f = o.face || [0, 1];
  B.tag(`search:${s.id}`, () => B.collide([x - w / 2, y0, z - d / 2], [x + w / 2, y0 + h, z + d / 2], 'metal'));
  B.at(M(x, y0, z, 0, Math.atan2(f[0], f[1]), 0), () => {
    if (s.kind === 'locker') {
      const col = o.color || rgb(0x3f4c50);
      // carcass: back, sides, top, floor, a shelf; open at the front
      A.box('metal', [-w / 2, 0, -d / 2], [w / 2, h, -d / 2 + 0.02], col, { par: 0.7, shadow: true });
      for (const sx of [-1, 1]) A.box('metal', [sx * w / 2 - (sx > 0 ? 0.02 : 0), 0, -d / 2], [sx * w / 2 + (sx > 0 ? 0 : 0.02), h, d / 2 - 0.02], col, { par: 0.7 });
      A.box('metal', [-w / 2, h - 0.02, -d / 2], [w / 2, h, d / 2 - 0.02], col, { par: 0.7 });
      A.box('metal', [-w / 2, 0, -d / 2], [w / 2, 0.08, d / 2 - 0.02], col, { par: 0.9 });
      A.box('metal', [-w / 2 + 0.02, h - 0.4, -d / 2 + 0.02], [w / 2 - 0.02, h - 0.385, d / 2 - 0.04], col, { par: 0.7 });
      // what hangs in it
      A.box('curtain', [-0.2, 0.55, -d / 2 + 0.06], [0.16, h - 0.45, -d / 2 + 0.16], o.coat || rgb(0x2a3a4a), { bevel: 0.03 });
      A.box('vinyl', [-0.24, 0.08, -d / 2 + 0.06], [0.0, 0.2, d / 2 - 0.12], rgb(0x1a1410), { bevel: 0.03 });
      A.box('paint', [-0.03, h - 0.2, d / 2 - 0.02], [0.03, h - 0.12, d / 2 - 0.008], TAG);
      // the door: hinged on the left edge, vents, a number plate, a hasp
      A.movable(s.prop, M(-w / 2 + 0.01, 0, d / 2 - 0.01, 0, -1.95, 0).multiply(M(w / 2 - 0.01, 0, -d / 2 + 0.01)), () => {
        A.box('metal', [-w / 2 + 0.01, 0.09, d / 2 - 0.02], [w / 2 - 0.01, h - 0.01, d / 2], o.door || col, { par: 0.6 });
        for (let i = 0; i < 4; i++) A.box('paint', [-0.16, h - 0.2 - i * 0.035, d / 2], [0.16, h - 0.185 - i * 0.035, d / 2 + 0.004], rgb(0x0c0d0e));
        A.box('paint', [-0.07, h - 0.46, d / 2], [0.07, h - 0.4, d / 2 + 0.004], rgb(0xcfc8b4));
        A.box('metal', [w / 2 - 0.09, h * 0.5 - 0.05, d / 2], [w / 2 - 0.04, h * 0.5 + 0.05, d / 2 + 0.014], STEEL);
      });
    } else {
      // a roller cabinet: red, five drawers, castors; the top two are left out
      const col = o.color || rgb(0x8a1c14);
      A.box('metal', [-w / 2, 0.1, -d / 2], [w / 2, h, d / 2 - 0.02], col, { par: 0.35, shadow: true, bevel: 0.012 });
      A.box('laminate', [-w / 2 - 0.01, h, -d / 2 - 0.01], [w / 2 + 0.01, h + 0.02, d / 2], rgb(0x1a1a1c));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) A.box('paint', [sx * (w / 2 - 0.08) - 0.03, 0, sz * (d / 2 - 0.08) - 0.03], [sx * (w / 2 - 0.08) + 0.03, 0.1, sz * (d / 2 - 0.08) + 0.03], rgb(0x0c0c0d));
      A.box('paint', [-0.03, 0.5, d / 2 - 0.02], [0.03, 0.58, d / 2 - 0.006], TAG);
      const dh = (h - 0.16) / 5;
      for (let i = 0; i < 5; i++) {
        const ya = 0.13 + i * dh, yb = ya + dh - 0.02;
        const draw = () => {
          A.box('metal', [-w / 2 + 0.03, ya, d / 2 - 0.36], [w / 2 - 0.03, yb, d / 2], col, { par: 0.3 });
          A.box('metal', [-w / 2 + 0.06, yb - 0.035, d / 2], [w / 2 - 0.06, yb - 0.015, d / 2 + 0.02], STEEL);
          if (i >= 3) { A.box('paint', [-w / 2 + 0.05, yb - 0.004, d / 2 - 0.33], [w / 2 - 0.05, yb + 0.002, d / 2 - 0.02], rgb(0x101010)); for (let k = 0; k < 5; k++) A.box('metal', [-w / 2 + 0.1 + k * 0.16, yb, d / 2 - 0.3 + (k % 2) * 0.05], [-w / 2 + 0.13 + k * 0.16, yb + 0.015, d / 2 - 0.08], STEEL, { ry: ((k * 7) % 5 - 2) * 0.08 }); }
        };
        if (i >= 3) A.movable(s.prop, M(0, 0, i === 4 ? 0.3 : 0.2), draw); else draw();
      }
    }
  });
}
