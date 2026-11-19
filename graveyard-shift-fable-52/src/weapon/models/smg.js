// The Pike 45: an invented .45 submachine gun by "Northgate Tool & Die". A slab-sided steel upper
// on a polymer lower, a slotted polymer handguard over a short barrel with a two-port brake, a
// straight stick magazine ahead of the trigger guard, a rail with an aperture sight and a hooded
// post, a tube-strut stock that folds to the right on a hinge behind the receiver. The bolt runs
// 62 mm on every shot: its handle rides a slot in the left flank (toward the eye at the hip) and
// its body shows in the ejection port on the right.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, sdPoly, sdExtrude, MM, side, sect, plan, pinX, discZ, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';

const HW = 17; // half width of the upper
const LOW_HW = 14.4;
export const BOLT_TRAVEL = 0.062;
const TRIG = { pivot: [-60, -27], face: [-64.6, -44], angle: -0.22, lift: 2.6 };
const MAG_AT = [0, -19, -138]; // centre of the magazine's top, seated
const MAG_LEN = 205;
const HINGE = [17, 0, 7];
const DOT_Y = 51; // mm: the reflex sight's dot, clear of the iron sights' ears
const SIGHT_UP = 7; // mm the iron sights stand above the rail's lugs

const RECV = outline([[-258, 19, 2], [-24, 19, 8], [0, 5, 3], [0, -16, 1.5], [-258, -16, 1.5]]);
const SLOT = outline([[-222, 5.0, 2.4], [-118, 5.0, 2.4], [-118, 10.2, 2.4], [-222, 10.2, 2.4]]);
const PORT = outline([[-178, -2.5, 2.2], [-126, -2.5, 2.2], [-126, 13, 2.2], [-178, 13, 2.2]]);
const LOWER = outline([
  [-196, -15.5], [-3, -15.5, 2], [6.5, -40, 30], [20, -80, 60], [27, -111, 3.2], [-14.5, -124.5, 2.6], [-31, -70, 30], [-36.5, -50, 6], [-39, -27, 3],
  [-116, -27, 2], [-118, -53, 2.5], [-158, -53, 2.5], [-160, -27, 2], [-190, -27, 3], [-196, -21, 2],
]);
const PANEL = outline([[-33, -45, 3], [-1, -45, 3], [12, -82, 14], [19.6, -106.5, 3], [-14, -117.5, 3], [-29.5, -68, 8]]);
const GUARD = outline([
  [-112, -26.6], [-113.5, -45, 3], [-108, -62.5, 6.5], [-48, -62.5, 5], [-40.5, -56, 3], [-38.6, -45], [-38.6, -26.6],
  [-44, -26.6], [-44.6, -51, 4], [-50, -56.8, 3], [-101, -56.8, 6], [-106.4, -45, 3], [-106, -26.6],
]);
const GUARD_HW = 7;
const TRIGGER = outline([
  [-63.6, -28.5], [-65.4, -36, 12], [-66, -42, 12], [-65, -48, 10], [-62.4, -52.2, 1.2], [-60.2, -51.2, 1], [-61.6, -45.5, 10],
  [-62, -40, 12], [-61, -34, 10], [-57.5, -30.5, 3], [-57.5, -24.5], [-63.6, -24.5],
]);
const HG = outline([[-388, 17, 3], [-258.5, 17], [-258.5, -24.5], [-381, -24.5, 6], [-388, -17, 3]]);
const HG_HW = 18.4;
const hgSlots = [0, 1, 2].map((i) => outline([[-376 + i * 39, -6.5, 6.4], [-349 + i * 39, -6.5, 6.4], [-349 + i * 39, 6.5, 6.4], [-376 + i * 39, 6.5, 6.4]]));

function buildSoups(put) {
  // ---- upper: left slab with the handle's slot, solid core, right slab with the port ----
  // (the flanks' bevel grows toward the rear, so the upper ends in a boat-tail, not a square block)
  const tail = (p) => (p[0] > -30 ? 2.6 : 1);
  put('recv', 'slide', side(RECV, -HW, -9, { holes: [SLOT], b0: 3.6, segs: 3, hb: 0.2, f0: tail }));
  put('recv', 'slide', side(RECV, -9, 9));
  put('recv', 'slide', side(RECV, 9, HW, { holes: [PORT], b1: 3.6, segs: 3, hb: 0.2, f1: tail }));
  put('recv', 'black', box(-8.8, 7.6, -170, 0.6, 6, 106, 0.1)); put('recv', 'black', box(8.8, 5.25, -152, 0.6, 16, 53, 0.1));
  // rail: a strip along the top cut into lugs
  put('recv', 'ctrl', box(0, 20.2, -136, 15.6, 2.8, 232, 0.5));
  for (let i = 0; i < 20; i++) put('recv', 'ctrl', sect(outline([[-10.4, 21, 0.6], [10.4, 21, 0.6], [10.4, 23, 0.9, 1], [8.6, 25, 0.5, 1], [-8.6, 25, 0.5, 1], [-10.4, 23, 0.9, 1]]), -240 + i * 10.2, -233.8 + i * 10.2, { b0: 0.45, b1: 0.45 }));
  // rear cap, weld beads along the lower seam, rivets
  put('recv', 'ctrl', sect(outline([[-10, -13, 3], [10, -13, 3], [10, 2, 4], [-10, 2, 4]]), -0.6, 2.2, { b1: 1 }));
  // recoil-spring cap: a knurled plug with a coin slot, standing out of the rear face; a sling loop under it
  put('recv', 'steel', lathe([[0, 1.5], [6.2, 1.5], [6.2, 6.4], [5.4, 7.2], [0, 7.2]], { segs: 24 }).move(0, -4, 0));
  for (let i = 0; i < 18; i++) put('recv', 'steel', new Soup().add(box(6.3, 0, 4.2, 0.5, 1.1, 4.4, 0.15), new Matrix4().makeRotationZ((i / 18) * Math.PI * 2)).move(0, -4, 0));
  put('recv', 'black', box(0, -4, 7.25, 8.6, 1.3, 0.3, 0.1));
  put('recv', 'steel', sect(outline([[-7, -15.5, 1.6], [7, -15.5, 1.6], [7, -11, 1.6], [-7, -11, 1.6]]), 1.6, 3.6, { holes: [outline([[-5, -14.2, 0.8], [5, -14.2, 0.8], [5, -12.4, 0.8], [-5, -12.4, 0.8]])], b0: 0.4, b1: 0.4 }));
  for (const sx of [-1, 1]) for (const z of [-246, -196, -22]) put('recv', 'steel', pinX(z, -9.5, 2.1, sx > 0 ? HW - 0.2 : -HW - 0.5, sx > 0 ? HW + 0.5 : -HW + 0.2, 0.25));
  // aperture rear sight and hooded front post, both on the rail
  // (both stand SIGHT_UP above the rail on risers, so the eye looks well over the receiver: a thin
  // ghost ring between two protecting ears at the rear, a post in a hood at the front)
  const U = SIGHT_UP;
  put('recv', 'ctrl', sect(circle(0, 31 + U, 5.5, 28), -27.4, -24.6, { holes: [circle(0, 31 + U, 4.1, 28)], b0: 0.4, b1: 0.4, hb: 0.6 }));
  put('recv', 'ctrl', box(0, 25.4 + U, -26, 3, 2.4, 2.8, 0.3)); // the ring's stem
  for (const sx of [-1, 1]) put('recv', 'ctrl', side(outline([[-34, 24.6], [-18, 24.6], [-18, 30 + U, 2], [-22, 37 + U, 2.5], [-28, 37 + U, 2.5], [-34, 29 + U, 3]]), sx * 8.4 - 1.1, sx * 8.4 + 1.1, { b0: 0.5, b1: 0.5 }));
  put('recv', 'ctrl', box(0, 24 + U / 2, -26, 19, 3.2 + U, 16, 0.8));
  put('recv', 'steel', pinX(-26, 25 + U, 1.6, -10.2, 10.2, 0.3));
  put('recv', 'steel', pinX(-21, 27 + U, 2.6, 9.4, 12.6, 0.5)); // windage knob
  put('recv', 'ctrl', sect(circle(0, 31 + U, 8.6, 32), -249, -241, { holes: [circle(0, 31 + U, 7.2, 32)], b0: 0.5, b1: 0.5, hb: 0.5 }));
  put('recv', 'ctrl', box(0, 23.5 + U / 2, -245, 8, 4 + U, 12, 0.6));
  put('recv', 'ctrl', box(0, 28.2 + U, -245, 1.6, 6.4, 1.6, 0.25));
  put('recv', 'white', discZ(0, 30.6 + U, 0.7, -244.2, -244.08, 12));

  // ---- lower: trigger housing, grip, magazine well ----
  put('recv', 'polymer', side(LOWER, -LOW_HW, LOW_HW, { b0: 2.3, b1: 2.3, segs: 3 }));
  put('recv', 'polymer', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 2.1, b1: 2.1, segs: 3 }));
  put('recv', 'panel', side(PANEL, LOW_HW - 0.2, LOW_HW + 1.7, { b1: 1.0, segs: 2, user: 'grip' }));
  put('recv', 'panel', side(PANEL, -LOW_HW - 1.7, -LOW_HW + 0.2, { b0: 1.0, segs: 2, user: 'grip' }));
  // flared mouth of the well, selector with its stops, pins, magazine catch paddle
  put('recv', 'polymer', plan(outline([[-13.6, -161.5, 3], [13.6, -161.5, 3], [13.6, -114.5, 3], [-13.6, -114.5, 3]]), -57.5, -50.5, { holes: [outline([[-11, -158.5, 2], [11, -158.5, 2], [11, -117.5, 2], [-11, -117.5, 2]])], b0: 1.4, segs: 2, hb: 0.3 }));
  put('recv', 'ctrl', pinX(-30, -21.5, 4.2, -LOW_HW - 2.6, -LOW_HW + 0.2, 0.5));
  put('recv', 'ctrl', side(outline([[-33, -19.5, 1], [-33, -23.5, 1], [-48, -22.8, 1.2], [-48.6, -20.4, 1.2]]), -LOW_HW - 3.6, -LOW_HW - 1.2, { b0: 0.5 }));
  for (const [z, y, r] of [[-60, -27, 1.6], [-12, -22, 1.6], [-108, -21, 1.6], [-170, -21, 1.6]]) put('recv', 'steel', pinX(z, y, r, -LOW_HW - 0.3, LOW_HW + 0.3));
  put('recv', 'mark', placeText(strokeText('PIKE 45', { h: 5.4, sw: 0.52 }).soup, 'left', HW, -112, -6.5));
  put('recv', 'mark', placeText(strokeText('NORTHGATE TOOL & DIE', { h: 2.2, sw: 0.26 }).soup, 'left', HW, -112, -11.6));
  put('recv', 'mark', placeText(strokeText('S', { h: 2.2, sw: 0.26 }).soup, 'left', LOW_HW, -52.5, -19.6));
  put('recv', 'mark', placeText(strokeText('F', { h: 2.2, sw: 0.26 }).soup, 'left', LOW_HW, -46, -25.4));
  put('recv', 'mark', placeText(strokeText('.45  NG 30771', { h: 2.6, sw: 0.3 }).soup, 'right', HW, -112, -11));
  put('catch', 'ctrl', side(outline([[-115.5, -30, 1], [-111, -30, 1], [-109.4, -50, 1.5], [-113.6, -52, 1.5]]), -6, 6, { b0: 1, b1: 1 }));

  // ---- handguard: two slotted cheeks over a core, hand stop under the front ----
  put('recv', 'polymer', side(HG, -HG_HW, -11, { holes: hgSlots, b0: 3.2, segs: 2, hb: 0.25 }));
  put('recv', 'polymer', side(HG, -11, 11));
  put('recv', 'polymer', side(HG, 11, HG_HW, { holes: hgSlots, b1: 3.2, segs: 2, hb: 0.25 }));
  for (const sx of [-1, 1]) put('recv', 'black', box(sx * 10.8, 0, -324, 0.6, 14, 118, 0.1));
  put('recv', 'polymer', side(outline([[-378, -23.5], [-352, -23.5], [-356, -33, 3], [-372, -36, 3]]), -9, 9, { b0: 2, b1: 2, segs: 2 }));
  for (let i = 0; i < 9; i++) put('recv', 'polymer', box(0, -24.9, -340 + i * 9, 26, 1.2, 4.2, 0.5)); // ribs under the hand
  put('recv', 'steel', pinX(-266, 4, 2.2, -HG_HW - 0.4, HG_HW + 0.4, 0.3));
  // barrel and brake
  put('recv', 'steel', lathe([[5.75, -400], [5.75, -441], [6.6, -442], [9.6, -442], [10.4, -441], [10.4, -420], [8.3, -418], [8.3, -386], [0, -386]], { segs: 28 }));
  put('recv', 'black', lathe([[0, -400], [5.75, -400]], { segs: 20 }));
  for (const z of [-436, -427]) for (const sx of [-1, 1]) put('recv', 'black', box(sx * 10.2, 0, z, 0.9, 7, 4.6, 0.4));

  // ---- bolt: body in the port, handle through the slot ----
  put('bolt', 'steel', box(12.4, 5.25, -152, 6, 14.6, 51, 0.7));
  put('bolt', 'black', box(15.45, 9, -134, 0.4, 2.2, 14, 0.2));
  put('bolt', 'steel', pinX(-214, 7.6, 2.2, -19.5, -9.5, 0.3));
  put('bolt', 'ctrl', lathe([[0, -29.5], [3.2, -29.5], [4.3, -28.4], [4.3, -20.4], [3.4, -19.4], [0, -19.4]], { segs: 18, map: 'yzx' }).move(0, 7.6, -214));
  put('trigger', 'ctrl', side(TRIGGER, -3.5, 3.5, { b0: 1.1, b1: 1.1, segs: 2 }));

  // ---- folding stock: hinge block, two tube struts, rubber butt (its frame: the hinge pin) ----
  put('hinge', 'ctrl', box(0, 0, 8, 26, 25, 12, 1.4, 2));
  put('hinge', 'steel', lathe([[0, -14], [3.6, -14], [3.6, 14], [0, 14]], { segs: 14, map: 'zxy' }).move(HINGE[0] - 1.5, 0, HINGE[2]));
  put('stock', 'ctrl', box(-HINGE[0], 0, 15 - HINGE[2] + 4, 22, 23, 8, 1.2, 2));
  put('stock', 'ctrl', rodZ(-HINGE[0], 9, 4.2, 20 - HINGE[2], 221 - HINGE[2], 0.6, 14));
  put('stock', 'ctrl', new Soup().add(rodZ(0, 0, 4.2, 0, 205, 0.6, 14), new Matrix4().makeTranslation(-HINGE[0], -9, 20 - HINGE[2]).multiply(new Matrix4().makeRotationX(0.19))));
  put('stock', 'black', side(outline([[216, 17, 4], [229, 15, 5], [231, -66, 5], [217, -69, 4]]), -12, 12, { b0: 3, b1: 3, segs: 2 }).move(-HINGE[0], 0, -HINGE[2]));

  // ---- magazine (its own frame: y up the magazine, origin at the centre of its top) ----
  put('mag', 'mag', plan(outline([[-10.4, -15.4, 2.6], [10.4, -15.4, 2.6], [10.4, 15.4, 2], [-10.4, 15.4, 2]]), -MAG_LEN, -2, { b1: 0.5 }));
  const lip = outline([[10.4, -2.2], [10.4, 1.6, 0.6], [8.2, 3.6, 0.5], [6.4, 3.8], [6.4, 3.0], [7.9, 2.8, 0.5], [9.6, 1.3, 0.5], [9.6, -2.2]]);
  const lipS = sect(lip, -10, 15.4, { b0: 0.3 });
  put('mag', 'mag', lipS); put('mag', 'mag', lipS.mirrorX());
  put('mag', 'mag', box(0, 0, 14.7, 19.6, 4.6, 1.5, 0.3));
  const ribM = side(outline([[-3, -190, 3], [3, -190, 3], [3, -24, 3], [-3, -24, 3]]), 10.2, 10.9, { b1: 0.4 });
  put('mag', 'mag', ribM); put('mag', 'mag', ribM.mirrorX());
  for (const y of [-40, -80, -120, -160]) put('mag', 'black', discZ(0, y, 1.4, 15.3, 15.47, 12));
  put('mag', 'magBase', plan(outline([[-12.6, -19, 4], [12.6, -19, 4], [12.6, 17.4, 2.5], [-12.6, 17.4, 2.5]]), -MAG_LEN - 8.5, -MAG_LEN - 0.4, { b0: 1.6, b1: 1, segs: 2 }));
  put('mag', 'follower', plan(outline([[-8.6, -13.6, 2], [8.6, -13.6, 2], [8.6, 13.4, 1.5], [-8.6, 13.4, 1.5]]), -2.6, 0.4, { b1: 0.6 }));
  const tilt = new Matrix4().makeTranslation(0, 2.9, -1).multiply(new Matrix4().makeRotationX(0.05));
  put('mag', 'bullet', new Soup().add(lathe([[0, -16.6], [2.4, -16.2], [4.6, -14], [5.6, -10.6], [5.74, -7], [0, -7]], { segs: 20 }), tilt));
  put('mag', 'brass', new Soup().add(lathe([[0, -7], [5.95, -7], [6.05, -6.4], [6.05, 13.2], [5.4, 13.6], [5.4, 14.4], [6.05, 14.7], [6.05, 15.6], [5.6, 16], [0, 16]], { segs: 20 }), tilt));
  // ---- attachments ----
  const rs = reflexSight(-128, 25, DOT_Y);
  put('att_sight', 'ctrl', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'ctrl', lathe([[5.9, -592], [14, -592], [15.4, -590.5], [15.4, -447], [14, -445.5], [9, -445.5], [9, -440], [0, -440]], { segs: 28 }));
  put('att_suppressor', 'black', lathe([[0, -591.9], [5.9, -591.9]], { segs: 20 }));
  for (let i = 0; i < 20; i++) put('att_suppressor', 'ctrl', new Soup().add(box(15.5, 0, -468, 0.5, 2.6, 36, 0.2), new Matrix4().makeRotationZ((i / 20) * Math.PI * 2)));
  put('att_grip', 'polymer', lathe([[0, -98], [11.4, -98], [12.8, -95.5], [12.2, -44], [10.4, -34], [10.4, -24.5], [0, -24.5]], { segs: 22, map: 'zxy' }).move(0, 0, -316));
  for (let i = 0; i < 5; i++) put('att_grip', 'polymer', lathe([[12.3, -90 + i * 10], [13.3, -89 + i * 10], [13.3, -86.5 + i * 10], [12.3, -85.5 + i * 10]], { segs: 22, map: 'zxy', closed: true }).move(0, 0, -316));
  // a 60 mm extension under the magazine's base (the magazine's frame)
  put('att_mag', 'mag', plan(outline([[-10.4, -15.4, 2.6], [10.4, -15.4, 2.6], [10.4, 15.4, 2], [-10.4, 15.4, 2]]), -MAG_LEN - 62, -MAG_LEN - 7));
  put('att_mag', 'magBase', plan(outline([[-12.6, -19, 4], [12.6, -19, 4], [12.6, 17.4, 2.5], [-12.6, 17.4, 2.5]]), -MAG_LEN - 70, -MAG_LEN - 61.5, { b0: 1.6, b1: 1, segs: 2 }));
  // a spent case: axis on z, mouth toward -z, centred
  put('casing', 'brass', lathe([[5.2, -11.4], [6.05, -11.4], [6.05, 9], [5.4, 9.4], [5.4, 10.2], [6.05, 10.5], [6.05, 11.4], [0, 11.4]], { segs: 16 }));
  put('casing', 'black', discZ(0, 0, 5.2, -9, -8.9, 14));
}

export function buildSmg(G, patch = (m) => m) {
  const mats = G.mats;
  const rest = { space: 'rest', shelter: 0.3 }, dry = { space: 'rest', shelter: 0.7 };
  const steelFx = { occ: true, albedo: 0.5, rough: [0.62, 0.2] }, polyFx = { occ: true, rough: [1.25, 0.74] };
  const M = {
    slide: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.6, oil: 0.3, seed: 91, ...rest }), steelFx),
    ctrl: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.66, oil: 0.25, seed: 93, ...rest }), { ...steelFx, albedo: 0.42 }),
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.28, oil: 0.3, seed: 95, ...rest }), { occ: true }),
    mark: patch(mats.gunmetal({ finish: 'bare', wear: 0, oil: 0, seed: 9, ...rest })),
    black: patch(mats.gunmetal({ finish: 'phosphate', wear: 0, oil: 0, seed: 11, ...rest }), { albedo: 0.3 }),
    polymer: patch(mats.gunmetal({ finish: 'polymer', color: 0x26282a, wear: 0.34, oil: 0.12, seed: 97, ...dry }), polyFx),
    panel: patch(mats.gunmetal({ finish: 'polymer', color: 0x232524, wear: 0.3, oil: 0.1, studPitch: 0.0023, seed: 99, ...dry }), polyFx),
    mag: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.72, oil: 0.5, seed: 101, ...rest }), { albedo: 0.6, rough: [0.7, 0.2] }),
    magBase: patch(mats.gunmetal({ finish: 'polymer', color: 0x26282a, wear: 0.3, oil: 0.12, seed: 103, ...dry }), { rough: [1.25, 0.74] }),
    follower: patch(mats.gunmetal({ finish: 'polymer', color: 0x7a3a1c, wear: 0.2, oil: 0, seed: 23, ...rest })),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.2, age: 0.12, dust: 0, ...rest })),
    bullet: patch(mats.chrome({ color: 0xb4744c, roughness: 0.28, age: 0.1, dust: 0, ...rest })),
    white: patch(mats.rubber({ color: 0xcfd2c8, roughness: 0.6, age: 0, dust: 0, ...rest })),
    dot: patch(mats.emissive({ color: 0xff2a14, nits: 3 })),
  };
  const kit = modelKit(G, M, 'smg');
  // one phosphate per part (the controls share the upper's finish; the magazine's witness holes and
  // follower its body's and its base's): each variant was a draw call
  const ALIAS = { ctrl: 'slide' }, MAG_ALIAS = { black: 'mag', follower: 'magBase' };
  buildSoups((part, mat, soup) => kit.put(part, (part === 'mag' ? MAG_ALIAS[mat] : ALIAS[mat]) || mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('catch', [0, -30, -113]);
  kit.part('bolt');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  kit.part('hinge');
  kit.part('stock', [0, 0, 0]);
  parts.stock.position.set(HINGE[0] * MM, HINGE[1] * MM, HINGE[2] * MM);
  const magRest = new Matrix4().makeTranslation(MAG_AT[0] * MM, MAG_AT[1] * MM, MAG_AT[2] * MM);
  const magAxis = new Vector3(0, -1, 0);
  const _s = new Vector3(1, 1, 1);
  const makeMag = (name) => {
    const g = name === 'mag' ? kit.part('mag') : kit.copy('mag', name);
    const top = g.children.filter((m) => m.userData.mat === 'brass' || m.userData.mat === 'bullet');
    g.userData.setRounds = (n) => { for (const r of top) r.visible = n > 0; };
    return g;
  };
  const mag = makeMag('mag'), spare = makeMag('spare');
  spare.visible = false;
  const casing = kit.part('casing');
  casing.visible = false;
  kit.part('att_sight'); kit.part('att_suppressor'); kit.part('att_grip');
  const magExt = [kit.part('att_mag', [0, 0, 0], mag), kit.copy('att_mag', 'att_mag2', spare)];

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0, stock: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.bolt.position.z = state.slide;
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.catch.rotation.x = 0.16 * state.magRelease;
    parts.stock.rotation.y = Math.PI * state.stock;
    magRest.decompose(mag.position, mag.quaternion, _s);
    mag.position.addScaledVector(magAxis, state.magD);
  }
  set();

  const bx = (x, y, z, cx, cy, cz, hx, hy, hz, r = 0) => { const ax = Math.abs(x - cx) - hx + r, ay = Math.abs(y - cy) - hy + r, az = Math.abs(z - cz) - hz + r; return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) - r; };
  function sdf(x, y, z, o = {}) {
    let d = sdExtrude(sdPoly(LOWER, z, y) + 2.2, x, LOW_HW - 2.2) - 2.2;
    if (y < -40 && z > -40) d = Math.min(d, sdExtrude(sdPoly(PANEL, z, y) + 1, x, LOW_HW + 1.7 - 1) - 1);
    d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 2, x, GUARD_HW - 2) - 2);
    d = Math.min(d, bx(x, y, z, 0, 1.5, -129, HW, 17.5, 129, 3), bx(x, y, z, 0, -3.5, -323, HG_HW, 21, 65, 3.2), bx(x, y, z, 0, 28, -136, 9, 8, 116));
    d = Math.min(d, bx(x, y, z, 0, MAG_AT[1] - MAG_LEN / 2 - 4, MAG_AT[2], 12.6, MAG_LEN / 2 + 4, 19, 2));
    d = Math.min(d, bx(x, y, z - state.slide / MM, -24.5, 7.6, -214, 5, 4.3, 4.3));
    if (!o.noTrigger) {
      const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.5));
    }
    return d;
  }

  const model = {
    id: 'smg', cls: 'smg', action: 'bolt', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: BOLT_TRAVEL, lock: 0.056,
    mag, spare, casing, magRest, magAxis,
    // gripped in the fist, across the palm: its top out past the thumb, its base under the little
    // finger, the palm on its left face and the fingers round its front
    magInHand: new Matrix4().set(0, 1, 0, 0.17, -1, 0, 0, -0.027, 0, 0, 1, -0.07, 0, 0, 0, 1),
    spareHand: 'fist',
    // a shallow well: the magazine lines up just under it (times on the reload clock: align, .., magIn)
    clip: { wellStart: 0.06, spare: [[0.84, 0.06], [0.94, 0.036, 'io'], [0.98, 0.03], [1.05, 0, 'in3']] },
    magBox: { c: [63.5, -27, -70], h: [106.5, 10.4, 15.4] }, // the same magazine in left-hand space, mm
    // the charging handle (left flank), for the pull on an empty reload: where the support hand's grip point goes
    charge: new Vector3(-0.0245, 0.0076, -0.214),
    casingSpin: 30,
    adsHide: [parts.stock, parts.hinge], // the eye sits where the cheek would: the struts would run through it
    anchors: {
      muzzle: new Vector3(0, 0, -0.442),
      eject: new Vector3(0.0175, 0.007, -0.15),
      grip: new Vector3(0, -0.06, -0.01),
      support: new Vector3(0, -0.03, -0.32),
      sight: new Vector3(0, (31 + SIGHT_UP) * MM, -0.026),
      mag: new Vector3(MAG_AT[0], MAG_AT[1] - MAG_LEN, MAG_AT[2]).multiplyScalar(MM),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: { at: [28, -74.5, -27], back: [-0.24, 0.3, 0.92], thumb: [0, 0.95, -0.31], elbow: [150, -210, 330], thumbKnuckle: [-23, -28, 0], thumbPad: [-21, -21, -40], cup: -0.15 },
      left: { at: [15, -37.5, -316], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -120], thumbPad: [-19.5, -8, -340], cup: 0.2 }, // the handguard lies in the palm, the thumb up its near face
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, DOT_Y * MM, -0.128) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.592) } },
    grip: { parts: [parts.att_grip] },
    mag: { parts: magExt },
  });
  return model;
}
