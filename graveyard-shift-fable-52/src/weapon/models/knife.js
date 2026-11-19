// The knife in the off hand: a full-tang utility knife. Canvas-laminate scales pinned to the tang
// with three brass tubes, a lanyard hole, a steel guard, a drop-point blade with a ground edge, a
// fuller and jimping on the spine.
//
// A hand prop, not a weapon model: LEFT-HAND space in millimetres (+x out past the thumb, -y out
// of the palm, -z along the fingers), the handle lying across the palm at HELD, as the stand-in in
// models/index.js (buildHandProps) is. `buildKnife(G, patch) -> { object, meshes, grip }`: `object`
// is hidden and has matrixAutoUpdate off (the view places it); `grip` is the handle as a box for
// arms.solveCarry.
import { box, outline, plan, lathe, modelKit } from '../geo.js';

export const HELD = [0, -28, -70];
// materials shared by the hand props built here (knife.js, axe.js)
export function propMats(G, patch) {
  const mats = G.mats, rest = { space: 'rest', shelter: 0.5 };
  return {
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.3, oil: 0.25, seed: 131, ...rest }), { occ: true, albedo: 0.55 }), // a satin grey flat, not a white one: only the ground edge is bright
    edge: patch(mats.gunmetal({ finish: 'bare', wear: 0.02, oil: 0.5, seed: 132, ...rest }), { rough: [0.5, 0.1] }),
    dark: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.5, oil: 0.2, seed: 133, ...rest }), { occ: true, albedo: 0.4 }),
    scale: patch(mats.gunmetal({ finish: 'polymer', color: 0x2c3024, wear: 0.5, oil: 0.1, studPitch: 0.0016, seed: 134, ...rest }), { occ: true, rough: [1.25, 0.7] }),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.3, age: 0.3, dust: 0, ...rest })),
    wood: patch(mats.gunmetal({ finish: 'wood', color: 0x6a4424, wear: 0.5, oil: 0.2, brushDir: [1, 0, 0], seed: 135, ...rest }), { occ: true, rough: [1.15, 0.5] }),
    red: patch(mats.gunmetal({ finish: 'polymer', color: 0x8e1c14, wear: 0.7, oil: 0.1, seed: 137, ...rest }), { occ: true, rough: [0.9, 0.4] }),
  };
}
const at = (soup) => soup.move(HELD[0], HELD[1], HELD[2]);
// a pin through the handle, along y (out of the palm)
const pinY = (x, z, r, y0, y1) => lathe([[0, y0], [r, y0], [r, y1], [0, y1]], { segs: 12, map: 'zxy' }).move(x, 0, z);

export function buildKnife(G, patch = (m) => m, M = propMats(G, patch)) {
  const kit = modelKit(G, M, 'knifeProp');
  const put = (mat, soup) => kit.put('knife', mat, at(soup));
  // tang and blade in one piece of steel (profile in x, z; thickness along y)
  const BLADE = outline([[44, 13.5], [150, 13.5, 40], [188, 5, 10], [203, -6, 0.6], [180, -15.5, 24], [60, -17, 3], [52, -12, 3], [44, -12]]);
  put('steel', plan(BLADE, -2.1, 2.1, { b0: 1.9, b1: 1.9, segs: 2 }));
  // the ground edge: a brighter strip along the belly, and the fuller along the flat
  put('edge', plan(outline([[62, -17.3], [178, -15.8, 24], [202, -6.4, 0.6], [196, -4.5, 6], [174, -11.8, 24], [62, -12.6]]), -1.2, 1.2, { b0: 1.15, b1: 1.15 }));
  for (const sy of [-1, 1]) put('dark', box(104, sy * 2.05, 6, 84, 0.5, 4.2, 0.2));
  for (let i = 0; i < 7; i++) put('dark', box(52 + i * 3.4, 0, 13.7, 1.6, 4.4, 0.9, 0.2)); // jimping
  // guard, tang, pommel with a lanyard hole
  put('steel', plan(outline([[38, 19, 2], [45.5, 19, 2], [46.5, -22, 3], [39, -24, 3]]), -5.4, 5.4, { b0: 1.6, b1: 1.6, segs: 2 }));
  put('steel', plan(outline([[-66, 11, 4], [40, 12, 2], [40, -12, 2], [-58, -13, 6], [-68, -4, 5]]), -2, 2, { holes: [outline([[-61, 2, 2.4], [-56, 2, 2.4], [-56, -3, 2.4], [-61, -3, 2.4]])], b0: 0.5, b1: 0.5, hb: 0.5 }));
  // scales with finger swells, pinned with three brass tubes
  const SCALE = outline([[-54, 12.5, 8], [36, 13, 3], [38, -13, 3], [18, -15.5, 14], [0, -12.5, 14], [-18, -15.5, 14], [-36, -12.5, 14], [-54, -14.5, 8], [-62, -2, 8]]);
  put('scale', plan(SCALE, 1.9, 9.6, { b1: 4.6, segs: 3, user: 'grip' }));
  put('scale', plan(SCALE, -9.6, -1.9, { b0: 4.6, segs: 3, user: 'grip' }));
  for (const x of [-40, -10, 22]) put('brass', pinY(x, 0, 2.6, -9.9, 9.9));
  const object = kit.part('knife');
  object.visible = false; object.matrixAutoUpdate = false;
  return { object, meshes: kit.meshes, grip: { c: [HELD[0] - 12, HELD[1], HELD[2]], h: [50, 9.6, 13.5] } };
}
