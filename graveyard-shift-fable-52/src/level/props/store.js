// North side of the lot: the convenience store (closed, lights still on behind dirty glass), its
// pavement and awning, and the diner next door with its boarded entrance. Built in world space.
import { PlaneGeometry } from 'three';
import { M, box, boxUp, cyl, cylUp, lathe, plane, quadUV, rgb, sphere, tube, torus } from '../build.js';

const BLACK = rgb(0x050506);
const DARK = rgb(0x15171a);
const ALU = 'paintAlu';
const WOODS = [rgb(0x6b5236), rgb(0x7a6040), rgb(0x54412c), rgb(0x86704e), rgb(0x4a3a28)];
const ROOM = 1.15; // radiance of a white surface facing the tubes, scene units
const PRODUCT = [0xc8281c, 0xe8b023, 0x1f4fa6, 0x2c8a43, 0xe87f23, 0xf0ece0, 0x5c2a82, 0x1d1d1d, 0x3a8fd0, 0xd95f8a].map((h) => rgb(h));

const PARAPET = 5.35;
export const STORE = { x0: -15, x1: 7, zf: -20, zb: -30, h: 4.4, floor: 0.15, winY0: 0.78, winY1: 3.0 };
export const DINER = { x0: 7, x1: 24, zf: -20, zb: -30, h: 3.9, doorX: 12.2 };
export const WALK = { x0: -15.6, x1: 24, z0: -20, z1: -17.3, h: 0.15 };

function mullionRun(B, x0, x1, n, zf, y0, y1) {
  const w = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) B.add(ALU, box(0.07, y1 - y0, 0.12, 0.012, 1), { m: M(x0 + i * w, (y0 + y1) / 2, zf + 0.02) });
  B.add(ALU, box(x1 - x0 + 0.07, 0.08, 0.13, 0.012, 1), { m: M((x0 + x1) / 2, y0 + 0.02, zf + 0.02) });
  B.add(ALU, box(x1 - x0 + 0.07, 0.08, 0.13, 0.012, 1), { m: M((x0 + x1) / 2, y1 - 0.02, zf + 0.02) });
  B.add('glassStore', box(x1 - x0, y1 - y0, 0.012), { m: M((x0 + x1) / 2, (y0 + y1) / 2, zf + 0.03) });
  return w;
}

function bin(B, x, z, color) {
  B.add('vcGloss', cylUp(0.27, 0.24, 0.82, 14), { m: M(x, 0, z), color, shadow: true });
  B.add('vcGloss', cylUp(0.29, 0.29, 0.06, 14), { m: M(x, 0.82, z), color: DARK });
  B.add('vcGloss', cylUp(0.16, 0.27, 0.16, 14), { m: M(x, 0.88, z), color });
  B.collide([x - 0.27, 0, z - 0.27], [x + 0.27, 1.04, z + 0.27], 'metal');
}

// A plank nailed across an opening. Centre (x, y), length along x, slight skew.
function plank(B, rng, x, y, z, len, rot = 0, ry = 0) {
  const c = WOODS[rng.int(0, WOODS.length - 1)];
  const k = rng.range(0.7, 1.1);
  B.add('vcMatte', box(len, rng.range(0.13, 0.19), 0.028, 0.006, 1), { m: M(x, y, z, 0, ry, rot), color: [c[0] * k, c[1] * k, c[2] * k], shadow: true });
}

// Letters bent from glass tube. Strokes in a 0.6 x 1 cell.
const GLYPHS = {
  D: [[[0, 0], [0, 1], [0.35, 1], [0.6, 0.78], [0.6, 0.22], [0.35, 0], [0, 0]]],
  I: [[[0.3, 0], [0.3, 1]]],
  N: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]],
  E: [[[0.6, 0], [0, 0], [0, 1], [0.6, 1]], [[0, 0.5], [0.45, 0.5]]],
  R: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.62], [0.45, 0.5], [0, 0.5]], [[0.3, 0.5], [0.6, 0]]],
  O: [[[0.12, 0], [0.48, 0], [0.6, 0.18], [0.6, 0.82], [0.48, 1], [0.12, 1], [0, 0.82], [0, 0.18], [0.12, 0]]],
  P: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.6], [0.45, 0.45], [0, 0.45]]],
};
// centred on (cx, cy); h is the letter height, pitch the advance in units of h
function neonText(B, key, str, cx, cy, z, h, color, pitch = 0.86, radius = 0.014) {
  const w = h * 0.72;
  let gx = cx - ((str.length - 1) * h * pitch + w * 0.6) / 2;
  for (const ch of str) {
    for (const stroke of GLYPHS[ch]) {
      const pts = [];
      for (let i = 0; i < stroke.length; i++) {
        const [u, v] = stroke[i];
        pts.push([gx + u * w, cy - h / 2 + v * h, z]);
        if (i < stroke.length - 1) { const [u2, v2] = stroke[i + 1]; pts.push([gx + (u + u2) * 0.5 * w, cy - h / 2 + (v + v2) * 0.5 * h, z]); }
      }
      B.add(key, tube(pts, radius, 6, 2), color ? { color } : {});
    }
    gx += h * pitch;
  }
}

export function buildStore(B) {
  const rng = B.rng.fork('store');
  const { x0, x1, zf, zb, h, floor, winY0, winY1 } = STORE;
  const A = B.atlas;

  // ---- pavement along the whole north side, kerb to the lot
  B.add('concrete', box(WALK.x1 - WALK.x0, WALK.h, WALK.z1 - WALK.z0 - 0.16), { m: M((WALK.x0 + WALK.x1) / 2, WALK.h / 2, (WALK.z0 + WALK.z1) / 2 - 0.08), shadow: true });
  B.add('concreteKerb', box(WALK.x1 - WALK.x0, WALK.h + 0.01, 0.17, 0.025, 1), { m: M((WALK.x0 + WALK.x1) / 2, WALK.h / 2, WALK.z1 - 0.085), shadow: true });
  B.collide([WALK.x0, 0, WALK.z0], [WALK.x1, WALK.h, WALK.z1], 'concrete');

  // ---- shell
  const WALL = rgb(0xcabfa2, 0.6);
  const wallAt = (xa, xb, ya, yb, z = zf, t = 0.24) => {
    B.add('wallStore', box(xb - xa, yb - ya, t), { m: M((xa + xb) / 2, (ya + yb) / 2, z - t / 2), shadow: true });
    B.refl([xa, ya, z - t], [xb, yb, z], WALL);
  };
  const winA = [-13.2, -2.5], doorX = [-2.5, -0.3], winB = [-0.3, 5.1];
  wallAt(x0, winA[0], floor, h); // west pier
  wallAt(winB[1], x1, floor, h); // east pier (the service door and the wall buy are here)
  wallAt(winA[0], winB[1], winY1, h); // header
  wallAt(winA[0], winA[1], floor, winY0); // stall risers
  wallAt(winB[0], winB[1], floor, winY0);
  B.add('wallStore', box(0.24, h, zf - zb), { m: M(x0 + 0.12, h / 2, (zf + zb) / 2), shadow: true });
  B.add('wallStore', box(0.24, h, zf - zb), { m: M(x1 - 0.12, h / 2, (zf + zb) / 2), shadow: true });
  B.add('wallStore', box(x1 - x0, h, 0.24), { m: M((x0 + x1) / 2, h / 2, zb + 0.12), shadow: true });
  B.add('vcMatte', box(x1 - x0 + 0.3, 0.3, zf - zb + 0.3), { m: M((x0 + x1) / 2, h - 0.5, (zf + zb) / 2), color: DARK, shadow: true });
  // parapet: the front wall carries on up past the roof line, with a coping; the sign hangs on it
  // where it clears the awning from anywhere on the lot
  wallAt(x0 - 0.06, x1 + 0.06, h, PARAPET, zf + 0.04, 0.3);
  B.add(ALU, box(x1 - x0 + 0.5, 0.09, 0.44, 0.02, 1), { m: M((x0 + x1) / 2, PARAPET + 0.04, zf - 0.11) });
  B.add(ALU, box(x1 - x0 + 0.2, 0.07, 0.1, 0.02, 1), { m: M((x0 + x1) / 2, h - 0.02, zf + 0.07) }); // string course at the old roof line
  for (const z of [zb, zf - 0.3]) B.add('vcMatte', box(0.3, PARAPET - h, 0.3), { m: M(x0 + 0.15, (h + PARAPET) / 2, z + (z === zb ? 0.15 : -0.15)), color: DARK });
  // pilasters at the piers and beside the doors, and a darker plinth course, so the front has depth
  for (const x of [x0 + 0.3, winA[0] - 0.22, doorX[0], doorX[1], winB[1] + 0.22, x1 - 0.3]) wallAt(x - 0.22, x + 0.22, floor, h - 0.06, zf + 0.09, 0.09);
  B.add('concrete', box(x1 - x0 + 0.12, 0.22, 0.1, 0.015, 1), { m: M((x0 + x1) / 2, floor + 0.11, zf + 0.06) });
  B.add('concrete', box(winA[1] - winA[0] + 0.3, 0.07, 0.2, 0.015, 1), { m: M((winA[0] + winA[1]) / 2, winY0 - 0.03, zf + 0.08) }); // sills
  B.add('concrete', box(winB[1] - winB[0] + 0.3, 0.07, 0.2, 0.015, 1), { m: M((winB[0] + winB[1]) / 2, winY0 - 0.03, zf + 0.08) });
  // downpipe (at the corner, clear of the wall-buy board) with brackets and a shoe, and a meter cabinet with its conduit, on the west pier
  B.add('paintGalv', cyl(0.055, 0.055, PARAPET - floor - 0.2, 8), { m: M(x1 - 0.16, (PARAPET + floor) / 2 - 0.1, zf + 0.2), shadow: true });
  B.add('paintGalv', cyl(0.055, 0.055, 0.3, 8), { m: M(x1 - 0.16, floor + 0.12, zf + 0.3, 0.9, 0, 0) });
  B.add('paintGalv', box(0.22, 0.2, 0.2, 0.02, 1), { m: M(x1 - 0.16, PARAPET - 0.3, zf + 0.17) });
  for (const y of [1.0, 2.4, 3.9, 4.9]) B.add('paintGalv', box(0.16, 0.035, 0.1), { m: M(x1 - 0.16, y, zf + 0.15) });
  B.add('paintGalv', boxUp(0.5, 0.7, 0.16, 0.015, 1), { m: M(x0 + 0.95, floor + 1.0, zf + 0.17), shadow: true });
  B.add('paintGalv', cyl(0.02, 0.02, 2.6, 6), { m: M(x0 + 0.95, floor + 3.0, zf + 0.15) });
  B.add('vcMatte', box(0.012, 0.6, 0.004), { m: M(x0 + 0.95, floor + 1.35, zf + 0.252), color: BLACK });
  // reflection stand-ins: side walls, back wall, the lit ceiling and floor seen through the glass
  B.refl([x0, 0, zb], [x0 + 0.24, h, zf], WALL);
  B.refl([x1 - 0.24, 0, zb], [x1, h, zf], WALL);
  B.refl([x0, 0, -26.25], [x1, h, -26.2], rgb(0x8f8a78));
  B.refl([x0, 3.25, -26.2], [x1, h, zf - 0.24], rgb(0xb9b8ae));
  // roof plant
  B.add('paintAlu', boxUp(2.2, 1.1, 1.5, 0.05, 2), { m: M(-9, h - 0.3, -24), shadow: true });
  B.add('paintAlu', boxUp(1.4, 0.8, 1.4, 0.05, 2), { m: M(1.5, h - 0.3, -25.5), shadow: true });
  B.add('paintAlu', cylUp(0.1, 0.1, 1.5, 8), { m: M(4.5, h - 0.3, -23) });
  B.collide([x0, 0, zb], [x1, h + 0.1, zf], 'concrete');

  // ---- glazing
  const pw = mullionRun(B, winA[0], winA[1], 5, zf, winY0, winY1);
  mullionRun(B, winB[0], winB[1], 3, zf, winY0, winY1);
  // posters taped inside the glass
  const posters = [['posterSlush', winA[0] + pw * 0.5], ['posterCoffee', winA[0] + pw * 1.55], ['posterLotto', winA[0] + pw * 3.4], ['posterShower', winB[0] + 0.95]];
  // (emissive at a low level: paper with the shop's light coming through it)
  for (const [name, x] of posters) B.add('atlasGlowVc', quadUV(0.68, 0.91, A.uv(name)), { m: M(x, 1.75 + rng.range(-0.1, 0.1), zf + 0.018, 0, 0, rng.range(-0.03, 0.03)), color: [0.34, 0.36, 0.35] });
  // vinyl lettering and stickers on the glass
  B.add('atlasLit', quadUV(0.4, 0.5, A.uv('stickerHours')), { m: M(doorX[1] + 0.42, 1.55, zf + 0.04) });
  B.add('atlasLit', quadUV(0.5, 0.143, A.uv('stickerCards')), { m: M(doorX[1] + 0.45, 1.12, zf + 0.04) });
  B.add('atlasLit', quadUV(0.5, 0.143, A.uv('stickerCards')), { m: M(winA[1] - 0.45, 1.0, zf + 0.04) });
  // OPEN, in neon, in the east window: it still buzzes on and off
  B.add('vcMatte', box(1.34, 0.66, 0.02), { m: M(3.85, 2.3, zf - 0.07), color: BLACK });
  neonText(B, 'vcBuzz', 'OPEN', 3.85, 2.3, zf - 0.045, 0.34, [5.5, 0.5, 0.45]);
  const fr = [[-0.62, -0.28], [0.62, -0.28], [0.62, 0.28], [-0.62, 0.28], [-0.62, -0.28]];
  for (let i = 0; i < 4; i++) B.add('vcBuzz', tube([[3.85 + fr[i][0], 2.3 + fr[i][1], zf - 0.045], [3.85 + (fr[i][0] + fr[i + 1][0]) / 2, 2.3 + (fr[i][1] + fr[i + 1][1]) / 2, zf - 0.045], [3.85 + fr[i + 1][0], 2.3 + fr[i + 1][1], zf - 0.045]], 0.012, 5, 2), { color: [0.5, 1.4, 5.0] });

  // ---- doors: aluminium stiles, glass, push bars, chained shut
  const dx0 = doorX[0], dx1 = doorX[1], dm = (dx0 + dx1) / 2;
  for (const x of [dx0, dx1]) B.add(ALU, box(0.09, winY1 - floor, 0.14, 0.012, 1), { m: M(x, (winY1 + floor) / 2, zf + 0.02) });
  B.add(ALU, box(dx1 - dx0, 0.1, 0.14, 0.012, 1), { m: M(dm, 2.42, zf + 0.02) });
  B.add('glassStore', box(dx1 - dx0 - 0.1, 0.5, 0.012), { m: M(dm, 2.72, zf + 0.03) });
  for (const s of [1, -1]) {
    const lx = dm + s * (dx1 - dx0 - 0.1) / 4;
    const lw = (dx1 - dx0 - 0.14) / 2;
    for (const x of [lx - lw / 2 + 0.04, lx + lw / 2 - 0.04]) B.add(ALU, box(0.08, 2.2, 0.06, 0.01, 1), { m: M(x, floor + 1.12, zf + 0.06) });
    for (const y of [floor + 0.09, floor + 2.18]) B.add(ALU, box(lw, 0.14, 0.06, 0.01, 1), { m: M(lx, y, zf + 0.06) });
    B.add('glassStore', box(lw - 0.14, 2.0, 0.01), { m: M(lx, floor + 1.14, zf + 0.06) });
    B.add('chrome', box(lw - 0.2, 0.05, 0.035, 0.012, 1), { m: M(lx, floor + 1.05, zf + 0.115) });
    B.add('chrome', cyl(0.016, 0.016, 0.5, 8), { m: M(dm + s * 0.1, floor + 1.15, zf + 0.13) });
  }
  // chain looped through the pull handles, padlock hanging
  for (let i = 0; i < 7; i++) B.add('chrome', torus(0.022, 0.006, 5, 8), { m: M(dm - 0.1 + i * 0.033, floor + 1.12 - Math.sin((i / 6) * Math.PI) * 0.05, zf + 0.15, i % 2 ? Math.PI / 2 : 0, 0, 0) });
  B.add('chrome', box(0.05, 0.06, 0.025, 0.006, 1), { m: M(dm, floor + 1.02, zf + 0.15) });
  B.add('atlasLit', quadUV(0.42, 0.42, A.uv('doorDecal')), { m: M(dm + 0.52, floor + 1.55, zf + 0.068) });
  B.add('atlasLit', quadUV(0.42, 0.56, A.uv('posterMissing')), { m: M(dm - 0.5, floor + 1.45, zf + 0.068, 0, 0, 0.04) });
  B.add('atlasGlowVc', quadUV(0.5, 0.375, A.uv('noteClosed')), { m: M(dm + 0.5, floor + 1.05, zf + 0.068, 0, 0, -0.05), color: [0.5, 0.52, 0.5] });
  B.add('rubber', boxUp(1.8, 0.02, 0.9, 0.008, 1), { m: M(dm, floor, zf + 0.6) });

  // ---- service door on the east pier, with the chalk wall buy drawn on it
  B.add('paintDoor', boxUp(1.05, 2.12, 0.06, 0.012, 1), { m: M(6.05, floor, zf + 0.02), shadow: true });
  B.add(ALU, box(1.2, 0.08, 0.1, 0.01, 1), { m: M(6.05, floor + 2.16, zf + 0.02) });
  for (const x of [5.49, 6.61]) B.add(ALU, box(0.07, 2.2, 0.1, 0.01, 1), { m: M(x, floor + 1.1, zf + 0.02) });
  B.add('chrome', box(0.04, 0.16, 0.05, 0.012, 1), { m: M(6.45, floor + 1.05, zf + 0.07) });
  // the chalk reads from across the lot because it does not depend on a light slot: it carries the
  // glow of its own lamp. The lamp itself is a real spot when the player is near.
  // The outline and the price fill the door; the word is on a board nailed across its head, wider
  // than the door, letters 0.4 m tall: the outline reads at 25 m, AMMO and 250 at 10.
  B.add('atlasGlowVc', quadUV(1.02, 1.5, A.sub('chalkMag', 0, 150 / 640, 1, 1)), { m: M(6.05, floor + 0.88, zf + 0.054), color: [0.8, 0.74, 0.6] });
  B.add('vcGlow', plane(1.05, 2.12), { m: M(6.05, floor + 1.06, zf + 0.0515), color: (n, p) => { const e = 0.014 + 0.06 * Math.max(0, 1 - (floor + 2.3 - p.y) / 2.4) ** 2; return [e, e * 0.82, e * 0.55]; } });
  B.add('vcMatte', box(1.72, 0.56, 0.035, 0.008, 1), { m: M(6.05, floor + 1.98, zf + 0.09, 0, 0, -0.015), color: rgb(0x2a2016), shadow: true });
  for (const x of [5.28, 6.82]) for (const y of [1.8, 2.16]) B.add('chrome', cyl(0.012, 0.012, 0.012, 6).rotateX(Math.PI / 2), { m: M(x, floor + y, zf + 0.11) });
  B.add('vcGlow', plane(1.72, 0.56), { m: M(6.05, floor + 1.98, zf + 0.1085, 0, 0, -0.015), color: [0.05, 0.039, 0.024] });
  B.add('atlasGlowVc', quadUV(1.6, 0.47, A.sub('chalkMag', 0, 0, 1, 150 / 640)), { m: M(6.05, floor + 1.98, zf + 0.11, 0, 0, -0.015), color: [0.85, 0.78, 0.62] });
  // gooseneck sign lamp over the door
  B.add('paintGalv', tube([[6.05, floor + 2.5, zf + 0.02], [6.05, floor + 2.82, zf + 0.12], [6.05, floor + 2.9, zf + 0.42], [6.05, floor + 2.72, zf + 0.56]], 0.016, 6, 5));
  B.add('paintDumpster', lathe([[0.03, 0.1], [0.06, 0.07], [0.2, 0], [0.205, -0.012]], 14), { m: M(6.05, floor + 2.62, zf + 0.56, -0.25, 0, 0), shadow: true });
  B.add('vcGlow', sphere(0.05, 8, 6), { m: M(6.05, floor + 2.62, zf + 0.56), color: [46, 36, 20] });
  B.add('vcGlow', cyl(0.19, 0.19, 0.004, 14), { m: M(6.05, floor + 2.615, zf + 0.56, -0.25, 0, 0), color: [1.6, 1.25, 0.7] });
  B.fixtures.push({ kind: 'wallLamp', pos: [6.05, floor + 2.58, zf + 0.56], dir: [0, -0.96, -0.28] });
  // what the outline promises: a shelf bracket with two ammunition tins
  B.add(ALU, box(0.9, 0.03, 0.2, 0.008, 1), { m: M(6.02, floor + 0.62, zf + 0.14) });
  for (const x of [5.82, 6.2]) {
    B.add('vcGloss', boxUp(0.3, 0.19, 0.15, 0.012, 1), { m: M(x, floor + 0.635, zf + 0.14, 0, x > 6 ? 0.2 : -0.1, 0), color: rgb(0x2f3a1e), shadow: true });
    B.add('vcGloss', box(0.16, 0.014, 0.02, 0.006, 1), { m: M(x, floor + 0.845, zf + 0.14), color: DARK });
  }
  B.add('atlasLit', quadUV(0.42, 0.56, A.uv('posterCurfew')), { m: M(5.32, 1.75, zf + 0.004, 0, 0, -0.03) });

  // ---- sign band and awning
  B.add('vcMatte', box(7.5, 1.26, 0.2, 0.02, 1), { m: M(-4.2, 4.6, zf + 0.14), color: DARK, shadow: true });
  B.add('atlasGlowVc', quadUV(7.3, 1.173, A.uv('mart')), { m: M(-4.2, 4.6, zf + 0.243), color: [2.2, 2.2, 2.2] });
  B.refl([-7.9, 3.99, zf], [-0.5, 5.21, zf + 0.22], DARK);
  const ax0 = x0 - 0.3, ax1 = x1 + 0.3, az = WALK.z1 - 0.25;
  B.add('paintCanopy', box(ax1 - ax0, 0.2, az - zf, 0.02, 1), { m: M((ax0 + ax1) / 2, 3.16, (az + zf) / 2), shadow: true });
  B.refl([ax0, 3.06, zf], [ax1, 3.35, az], rgb(0x0c7f79, 0.7));
  B.add('paintTeal', box(ax1 - ax0 + 0.04, 0.3, 0.07, 0.012, 1), { m: M((ax0 + ax1) / 2, 3.2, az), shadow: true });
  B.add('paintAmber', box(ax1 - ax0 + 0.04, 0.05, 0.075, 0.01, 1), { m: M((ax0 + ax1) / 2, 3.07, az) });
  for (const x of [ax0 + 0.04, ax1 - 0.04]) B.add('paintTeal', box(0.07, 0.3, az - zf, 0.012, 1), { m: M(x, 3.2, (az + zf) / 2) });
  for (const [x, state] of [[-10.2, 'on'], [-1.4, 'on'], [5.9, 'on'], [-6, 'dead']]) {
    B.add('paintCanopy', cyl(0.13, 0.13, 0.03, 12), { m: M(x, 3.05, zf + 1.25) });
    B.add(state === 'on' ? 'vcGlow' : 'vcGloss', cyl(0.095, 0.095, 0.02, 12), { m: M(x, 3.035, zf + 1.25), color: state === 'on' ? B.glow.awning : DARK });
    if (state === 'on') B.fixtures.push({ kind: 'awning', pos: [x, 3.0, zf + 1.25] });
  }
  // a flood on the awning's front edge, under the sign: the downlights only reach the pavement, and
  // without this the rain in front of the store has nothing to catch. Outside the awning's shelter
  // box and aimed down and out, so it carries rain of its own (fx/rain.js lamp test).
  B.add('paintTeal', box(0.3, 0.1, 0.16, 0.012, 1), { m: M(-4.2, 3.0, az + 0.1, 0.5, 0, 0), shadow: true });
  B.add('vcGlow', box(0.24, 0.012, 0.11), { m: M(-4.2, 2.955, az + 0.125, 0.5, 0, 0), color: [60, 52, 38] });
  B.fixtures.push({ kind: 'storeFlood', pos: [-4.2, 2.93, az + 0.14], dir: [0, -0.88, 0.47] });
  B.shelter([ax0, 3.05, zf], [ax1, 3.3, az]);
  B.collide([ax0, 3.05, zf], [ax1, 3.3, az], 'metal');

  // ---- interior, seen through the glass. Nothing in here is lit by a real light: every surface
  // is unlit and carries the room's own lighting baked into its vertex colours (cold tubes overhead,
  // so tops are bright, sides half that, and the faces turned to the window are in their own
  // shade). The only real lights are two spots that carry the spill out through the glazing.
  const iz = -26.2, ih = 3.25;
  const COLD = [0.8 * ROOM, 1.0 * ROOM, 0.93 * ROOM];
  const lit = (albedo, k = 1) => (n, p) => {
    const e = k * (0.16 + 0.84 * Math.max(0, n.y) + 0.5 * (1 - Math.abs(n.y)) * (n.z > 0.3 ? 0.4 : 1))
      * (0.55 + 0.45 * Math.min(1, (p.y - floor) / 1.4)); // darker toward the floor between the shelves
    return [albedo[0] * COLD[0] * e, albedo[1] * COLD[1] * e, albedo[2] * COLD[2] * e];
  };
  // floor: brightest under each troffer row, scuffed dark along the aisles
  const troffers = [];
  for (const x of [-12, -8, -4, 0.5, 4.2]) for (const z of [-21.6, -24.3]) troffers.push([x, z]);
  const tState = [1, 1, 0, 1, 2, 1, 1, 0, 1, 1];
  const under = (p) => { let e = 0.12; troffers.forEach(([x, z], i) => { if (tState[i]) e += 0.5 / (1 + ((p.x - x) ** 2 + (p.z - z) ** 2) / 3.2); }); return Math.min(1, e); };
  {
    const fl = new PlaneGeometry(x1 - x0 - 0.5, zf - iz - 0.1, 44, 12).rotateX(-Math.PI / 2);
    B.add('vcGlow', fl, { m: M((x0 + x1) / 2, floor + 0.02, (zf + iz) / 2), color: (n, p) => { const e = under(p); return [0.5 * COLD[0] * e, 0.5 * COLD[1] * e, 0.47 * COLD[2] * e]; } });
  }
  B.add('vcGlow', box(x1 - x0 - 0.5, 0.05, zf - iz), { m: M((x0 + x1) / 2, ih, (zf + iz) / 2), color: [0.3 * COLD[0], 0.3 * COLD[1], 0.3 * COLD[2]] });
  // back wall above the coolers, and the two end walls
  B.add('vcGlow', new PlaneGeometry(x1 - x0 - 0.5, ih, 22, 3), { m: M((x0 + x1) / 2, ih / 2, iz), color: (n, p) => { const e = (0.16 + 0.6 * under(p) * (0.35 + 0.65 * p.y / ih)) * (1 - 0.35 * Math.abs((p.x - (x0 + x1) / 2) / ((x1 - x0) / 2)) ** 2); return [0.5 * COLD[0] * e, 0.5 * COLD[1] * e, 0.46 * COLD[2] * e]; } });
  for (const [x, ry] of [[x0 + 0.26, Math.PI / 2], [x1 - 0.26, -Math.PI / 2]]) B.add('vcGlow', new PlaneGeometry(zf - iz, ih, 6, 3), { m: M(x, ih / 2, (zf + iz) / 2, 0, ry, 0), color: (n, p) => { const e = 0.08 + 0.2 * under(p) * (0.4 + 0.6 * p.y / ih); return [COLD[0] * e, COLD[1] * e, 0.93 * COLD[2] * e]; } });
  // ceiling troffers
  troffers.forEach(([x, z], i) => {
    const g = box(1.25, 0.03, 0.34);
    if (tState[i] === 2) B.add('flickC', g, { m: M(x, ih - 0.04, z) });
    else B.add('vcGlow', g, { m: M(x, ih - 0.04, z), color: tState[i] ? B.glow.tube : [0.2, 0.22, 0.21] });
  });
  // what leaves through the glass: one spot behind the head of each window run, aimed down and
  // out, its cone fitted between the window head and the sill so nothing passes through a wall
  for (const [x, flicker] of [[(winA[0] + winA[1]) / 2, false], [(winB[0] + winB[1]) / 2, true]]) {
    B.fixtures.push({ kind: 'storeSpill', pos: [x, winY1 - 0.05, zf - 0.6], dir: [0, -0.616, 0.788], flicker });
  }
  // cooler wall along the back: lit cabinets, the brightest thing in the room
  for (let i = 0; i < 3; i++) {
    B.add('atlasGlowVc', quadUV(3.3, 2.1, A.uv('cooler')), { m: M(-12 + i * 3.5, floor + 1.15, iz + 0.06), color: [1.5, 1.62, 1.75] });
    B.add('vcGlow', box(3.4, 0.12, 0.3), { m: M(-12 + i * 3.5, floor + 2.28, iz + 0.16), color: [0.05, 0.06, 0.06] });
  }
  // gondola shelving: seen end-on from the lot, so dark end caps against the bright back wall,
  // with the product showing as bands of colour down each side
  const gondola = (x, z, ry, tip = 0) => B.at(M(x, floor, z, 0, ry, tip), () => {
    B.add('vcGlow', boxUp(0.5, 1.45, 3.4), { color: lit(rgb(0x1c1e20), 0.5) });
    B.add('vcGlow', boxUp(0.9, 0.12, 3.5), { color: lit(rgb(0x1c1e20), 0.5) });
    B.add('vcGlow', box(0.86, 1.1, 0.03), { m: M(0, 0.75, 1.72), color: lit(rgb(0x7a1d14), 0.7) }); // end-cap promo board
    for (let lv = 0; lv < 4; lv++) for (const s of [1, -1]) {
      B.add('vcGlow', box(0.36, 0.025, 3.4), { m: M(s * 0.36, 0.22 + lv * 0.36, 0), color: lit(rgb(0x8d9093)) });
      for (let k = 0; k < 6; k++) {
        if (rng.next() < 0.22) continue; // looted gaps
        const c = PRODUCT[rng.int(0, PRODUCT.length - 1)];
        B.add('vcGlow', box(0.26, rng.range(0.16, 0.27), 0.5), { m: M(s * 0.36, 0.36 + lv * 0.36, -1.4 + k * 0.56), color: lit(c) });
      }
    }
  });
  gondola(-11.4, -23.2, 0); gondola(-9.0, -23.3, 0.04); gondola(-6.5, -23.1, -0.03);
  gondola(-4.3, -22.7, 0.5, 1.25); // one went over
  for (let i = 0; i < 16; i++) { // what fell off it
    const c = PRODUCT[rng.int(0, PRODUCT.length - 1)];
    B.add('vcGlow', box(0.24, 0.1, 0.16), { m: M(-3.4 + rng.range(-1.2, 1.6), floor + 0.07, -21.6 + rng.range(-0.8, 0.9), 0, rng.range(0, 3), 0), color: lit(c) });
  }
  // a spinner rack and a dump bin near the glass, for silhouettes right behind the posters
  B.add('vcGlow', cylUp(0.02, 0.02, 1.7, 6), { m: M(-12.3, floor, -20.9), color: lit(rgb(0x202224)) });
  for (let lv = 0; lv < 4; lv++) B.add('vcGlow', cylUp(0.24, 0.24, 0.26, 8), { m: M(-12.3, floor + 0.35 + lv * 0.34, -20.9), color: lit(PRODUCT[(lv * 3 + 1) % PRODUCT.length], 0.8) });
  B.add('vcGlow', boxUp(0.9, 0.7, 0.9), { m: M(-5.6, floor, -20.9, 0, 0.2, 0), color: lit(rgb(0x9a7a1a), 0.8) });
  // counter, till, back-bar; the vending machines glow against the west wall
  B.add('vcGlow', boxUp(4.0, 1.02, 0.75, 0.02, 1), { m: M(3.0, floor, -22.9), color: lit(rgb(0x4d3b2a)) });
  B.add('vcGlow', boxUp(4.1, 0.05, 0.85, 0.01, 1), { m: M(3.0, floor + 1.02, -22.9), color: lit(rgb(0x1c1c1c)) });
  B.add('vcGlow', boxUp(0.42, 0.36, 0.4, 0.03, 1), { m: M(2.2, floor + 1.07, -22.9), color: lit(rgb(0x16181a)) });
  B.add('vcGlow', box(0.3, 0.2, 0.01), { m: M(2.2, floor + 1.48, -22.72, -0.3, 0, 0), color: rgb(0x9fe0b0, 3) });
  B.add('vcGlow', boxUp(0.5, 0.55, 0.3), { m: M(4.3, floor + 1.07, -22.9), color: lit(rgb(0x8a8f92)) }); // lottery case
  for (let r = 0; r < 5; r++) for (let k = 0; k < 12; k++) B.add('vcGlow', box(0.26, 0.2, 0.1), { m: M(1.3 + k * 0.3, floor + 1.5 + r * 0.26, -25.9), color: lit(PRODUCT[rng.int(0, PRODUCT.length - 1)], 1.6) });
  B.add('atlasGlowVc', quadUV(0.95, 1.63, A.uv('vendCola')), { m: M(-13.9, floor + 0.95, -21.2, 0, Math.PI / 2, 0), color: [2.2, 2.2, 2.2] });
  B.add('vcGlow', boxUp(0.8, 1.85, 1.0, 0.03, 1), { m: M(-14.32, floor, -21.2), color: lit(rgb(0x5a0c0a)) });
  B.add('atlasGlowVc', quadUV(0.95, 1.63, A.uv('vendSnack')), { m: M(-13.9, floor + 0.95, -22.4, 0, Math.PI / 2, 0), color: [1.5, 1.5, 1.5] });
  B.add('vcGlow', boxUp(0.8, 1.85, 1.0, 0.03, 1), { m: M(-14.32, floor, -22.4), color: lit(rgb(0x16191c)) });
  // dragged smear from the door toward the counter
  B.add('vcGlow', box(2.6, 0.004, 0.5), { m: M(0.6, floor + 0.026, -21.5, 0, 0.5, 0), color: [0.1 * ROOM, 0.012 * ROOM, 0.008 * ROOM] });

  // ---- pavement clutter
  // ice chest, leaning doors
  B.add('paintWhite', boxUp(1.9, 1.75, 0.85, 0.04, 2), { m: M(-14.0, floor, zf + 0.5), shadow: true });
  B.add('atlasLit', quadUV(1.5, 0.875, A.uv('ice')), { m: M(-14.0, floor + 1.1, zf + 0.93) });
  for (const x of [-14.45, -13.55]) B.add('chrome', box(0.03, 0.4, 0.04, 0.01, 1), { m: M(x + 0.36, floor + 0.5, zf + 0.945) });
  B.add('vcMatte', box(1.7, 0.012, 0.008), { m: M(-14.0, floor + 0.62, zf + 0.928), color: BLACK });
  B.collide([-14.95, floor, zf], [-13.05, floor + 1.75, zf + 0.93], 'metal');
  bin(B, -3.2, zf + 0.5, rgb(0x1f3a2a));
  bin(B, 0.5, zf + 0.5, rgb(0x1f3a2a));
  // newspaper box
  B.at(M(1.5, floor, zf + 0.42, 0, -0.08, 0), () => {
    B.add('paintNews', boxUp(0.5, 0.62, 0.42, 0.03, 2), { m: M(0, 0.5, 0), shadow: true });
    for (const [x, z] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) B.add('vcMatte', boxUp(0.035, 0.5, 0.035), { m: M(x, 0, z), color: DARK });
    B.add('atlasLit', quadUV(0.32, 0.45, A.uv('paper')), { m: M(0, 0.8, 0.214) });
    B.add('glassCar', box(0.38, 0.5, 0.008), { m: M(0, 0.8, 0.222) });
    B.collide([-0.25, 0, -0.21], [0.25, 1.12, 0.21], 'metal');
  });
  // air and water tower at the east end of the store
  B.add('paintNews', boxUp(0.5, 1.5, 0.38, 0.04, 2), { m: M(4.5, floor, zf + 0.35), shadow: true });
  B.add('atlasLit', quadUV(0.4, 0.56, A.uv('airWater')), { m: M(4.5, floor + 1.1, zf + 0.545) });
  B.add('rubber', tube([[4.3, floor + 0.7, zf + 0.56], [4.2, floor + 0.3, zf + 0.75], [4.35, floor + 0.04, zf + 0.9], [4.7, floor + 0.03, zf + 1.05], [4.9, floor + 0.03, zf + 0.8]], 0.014, 5, 5));
  B.collide([4.25, floor, zf], [4.75, floor + 1.5, zf + 0.55], 'metal');
  // pallet of screenwash by the west windows
  B.at(M(-11.3, floor, zf + 0.62, 0, 0.06, 0), () => {
    for (const z of [-0.4, 0, 0.4]) B.add('vcMatte', boxUp(1.2, 0.09, 0.1), { m: M(0, 0, z), color: WOODS[0] });
    for (let i = 0; i < 5; i++) B.add('vcMatte', boxUp(0.12, 0.02, 1.0), { m: M(-0.5 + i * 0.25, 0.09, 0), color: WOODS[1] });
    for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      if (lv === 2 && (i + j) % 3 === 0) continue;
      B.add('vcGloss', boxUp(0.2, 0.26, 0.15, 0.03, 1), { m: M(-0.42 + i * 0.28, 0.11 + lv * 0.31, -0.3 + j * 0.3, 0, ((i * 7 + j * 3 + lv) % 5 - 2) * 0.05, 0), color: rgb(0x12356a), shadow: lv === 2 });
      if (lv === 2 || (i + j) % 3 === 1) B.add('vcGloss', cylUp(0.022, 0.022, 0.035, 6), { m: M(-0.47 + i * 0.28, 0.37 + lv * 0.31, -0.3 + j * 0.3), color: rgb(0xb9b4a4) });
      if (lv < 2 && j === 2) B.add('vcMatte', box(1.15, 0.012, 0.56), { m: M(0, 0.415 + lv * 0.31, 0), color: WOODS[3] }); // card layer pads
    }
    B.collide([-0.6, 0, -0.5], [0.6, 1.0, 0.5], 'cloth');
  });
  // sandwich board blown over
  B.add('vcGloss', box(0.6, 0.03, 0.95, 0.01, 1), { m: M(-6.0, floor + 0.03, zf + 1.6, 0, 0.6, 0), color: rgb(0x8f7f1c), shadow: true });
}

// The diner frontage: ribbed steel with a red band, windows and door boarded, neon dead.
export function buildDiner(B) {
  const rng = B.rng.fork('diner');
  const { x0, x1, zf, zb, h, doorX } = DINER;
  const A = B.atlas;
  const fl = WALK.h;
  B.add('paintDiner', box(x1 - x0, h, 0.3), { m: M((x0 + x1) / 2, h / 2, zf - 0.15), shadow: true });
  B.refl([x0, 0, zf - 0.3], [x1, h, zf], rgb(0xa7abae, 0.5));
  B.add('vcMatte', box(x1 - x0 - 0.1, 0.3, zf - zb - 0.4), { m: M((x0 + x1) / 2, h - 0.2, (zf + zb) / 2 - 0.1), color: DARK, shadow: true });
  B.add('paintDiner', box(0.3, h, zf - zb), { m: M(x1 - 0.15, h / 2, (zf + zb) / 2) });
  // horizontal ribs, the red band, rounded cornice
  for (let i = 0; i < 9; i++) B.add('chrome', box(x1 - x0, 0.03, 0.03, 0.01, 1), { m: M((x0 + x1) / 2, 0.35 + i * 0.07, zf + 0.012) });
  B.add('paintRed', box(x1 - x0, 0.36, 0.05, 0.012, 1), { m: M((x0 + x1) / 2, 2.86, zf + 0.02) });
  B.add('chrome', cyl(0.2, 0.2, x1 - x0, 10, false).rotateZ(Math.PI / 2), { m: M((x0 + x1) / 2, h - 0.05, zf + 0.02), shadow: true });
  B.collide([x0, 0, zb], [x1 + 0.3, h + 0.2, zf], 'metal');

  // boarded windows
  for (const wx of [9.3, 15.6, 19.2]) {
    B.add('vcMatte', box(2.5, 1.36, 0.02), { m: M(wx, 1.78, zf + 0.012), color: BLACK });
    B.add('chrome', box(2.62, 0.07, 0.07, 0.015, 1), { m: M(wx, 2.48, zf + 0.03) });
    B.add('chrome', box(2.62, 0.07, 0.09, 0.015, 1), { m: M(wx, 1.08, zf + 0.04) });
    const n = 5;
    for (let i = 0; i < n; i++) plank(B, rng, wx + rng.range(-0.08, 0.08), 1.22 + i * 0.28 + rng.range(-0.03, 0.03), zf + 0.06, 2.66 + rng.range(-0.1, 0.16), rng.range(-0.05, 0.05));
    plank(B, rng, wx, 1.78, zf + 0.09, 2.9, 0.42);
  }
  // the entrance: recessed double door behind plywood, cross planks and a chain
  B.add('vcMatte', box(2.3, 2.45, 0.02), { m: M(doorX, fl + 1.225, zf + 0.012), color: BLACK });
  for (const x of [doorX - 1.2, doorX + 1.2]) B.add('chrome', box(0.1, 2.5, 0.12, 0.02, 1), { m: M(x, fl + 1.25, zf + 0.05) });
  B.add('chrome', box(2.5, 0.1, 0.12, 0.02, 1), { m: M(doorX, fl + 2.5, zf + 0.05) });
  B.add('vcMatte', box(2.1, 1.7, 0.02, 0.004, 1), { m: M(doorX - 0.05, fl + 1.2, zf + 0.085, 0, 0, 0.015), color: rgb(0x8a7550), shadow: true });
  B.add('atlasLit', quadUV(1.7, 1.09, A.uv('sprayClosed')), { m: M(doorX - 0.05, fl + 1.25, zf + 0.097, 0, 0, 0.015) });
  for (const [y, rot] of [[fl + 0.42, 0.03], [fl + 2.02, -0.04], [fl + 2.3, 0.02]]) plank(B, rng, doorX, y, zf + 0.11, 2.62, rot);
  plank(B, rng, doorX, fl + 1.2, zf + 0.13, 3.0, 0.62);
  plank(B, rng, doorX, fl + 1.2, zf + 0.15, 3.0, -0.6);
  for (let i = 0; i < 14; i++) B.add('chrome', torus(0.026, 0.007, 5, 8), { m: M(doorX - 0.9 + i * 0.14, fl + 1.52 - Math.sin((i / 13) * Math.PI) * 0.22, zf + 0.175, i % 2 ? Math.PI / 2 : 0, 0, 0) });
  B.add('chrome', box(0.07, 0.09, 0.03, 0.008, 1), { m: M(doorX, fl + 1.26, zf + 0.18) });
  // caged bulkhead lamp over the door, on its last legs: the only light at this end
  B.add('vcMatte', box(0.3, 0.2, 0.12, 0.03, 1), { m: M(doorX + 0.2, fl + 2.82, zf + 0.08), color: DARK });
  B.add('flickD', box(0.22, 0.13, 0.09, 0.04, 2), { m: M(doorX + 0.2, fl + 2.82, zf + 0.15) });
  for (let i = 0; i < 4; i++) B.add('vcMatte', box(0.012, 0.17, 0.012), { m: M(doorX + 0.11 + i * 0.06, fl + 2.82, zf + 0.205), color: BLACK });
  B.fixtures.push({ kind: 'bulkhead', pos: [doorX + 0.2, fl + 2.78, zf + 0.42] });
  // sandbags someone stacked, then gave up on
  for (let i = 0; i < 9; i++) {
    const row = i < 5 ? 0 : 1;
    B.add('vcMatte', box(0.62, 0.19, 0.34, 0.07, 2), { m: M(doorX - 1.1 + (i - row * 5) * 0.56 + row * 0.3, fl + 0.1 + row * 0.17, zf + 0.5 + rng.range(-0.04, 0.04), 0, rng.range(-0.15, 0.15), 0), color: rgb(0x6b6250), shadow: true });
  }
  B.collide([doorX - 1.4, fl, zf], [doorX + 1.5, fl + 0.4, zf + 0.72], 'cloth');

  // dead lightbox and the neon lettering above it
  B.add('vcMatte', box(4.3, 1.3, 0.14, 0.02, 1), { m: M(doorX, 3.55 + 0.9, zf + 0.1), color: DARK, shadow: true });
  B.add('atlasLit', quadUV(3.3, 1.03, A.uv('dinerBoard')), { m: M(doorX + 4.4, 3.3, zf + 0.04) });
  neonText(B, 'neonOff', 'DINER', doorX - 0.08, 4.43, zf + 0.21, 0.86, null, 0.86, 0.022);
}
