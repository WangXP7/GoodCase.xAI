// The Ostrander 308: an invented .308 battle rifle by "Ostrander & Sons, Gunmakers". A blued steel
// receiver bedded in a one-piece walnut stock that runs on under the barrel as the fore-end, a
// ventilated upper handguard, a gas cylinder under a long barrel with a slotted flash hider, a
// straight twenty-round box magazine ahead of the guard, an aperture sight on the receiver's heel
// and a winged blade at the muzzle. The bolt shows in the port on the right with its handle.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, sdPoly, sdExtrude, MM, side, sect, plan, pinX, discZ, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';
import { gunMats, bx, cylZ, caseSoups, magPair } from './rifle.js';

export const HW = 16.6;
export const BOLT_TRAVEL = 0.085;
export const TRIG = { pivot: [-36, -40], face: [-40.6, -53.5], angle: -0.24, lift: 2.4 };
export const RECV = outline([[-216, 16.5, 1.5], [-34, 17.5, 12], [-3, 10, 5], [0, -33, 3], [-6, -39.5, 2], [-212, -39.5, 2.5], [-216, -35, 1.5]]);
const PORT = outline([[-156, -3, 2.2], [-84, -3, 2.2], [-84, 12, 2.2], [-156, 12, 2.2]]);
export const STOCK = outline([
  [-0.5, 15.2, 2], [34, 5, 26], [92, -7, 60], [336, -30, 7], [340, -132, 9], [150, -79, 40], [102, -87, 10], [86, -79, 8],
  [58, -53, 14], [30, -42, 10], [-0.5, -39.2, 2],
]);
export const STOCK_HW = 15.6;
export const GUARD = outline([
  [-70, -39.2], [-72.5, -52, 4], [-66, -66.5, 7], [-22, -66.5, 6], [-12.5, -56, 4], [-11, -39.2],
  [-16.5, -39.2], [-18, -55, 4], [-25, -60.6, 4], [-62, -60.6, 6], [-66.5, -52, 3], [-65, -39.2],
]);
export const GUARD_HW = 6.2;
export const TRIGGER = outline([[-39.6, -40.5], [-41, -47, 8], [-40.6, -55, 8], [-38, -59, 1.1], [-36, -58, 1], [-37, -52, 8], [-36.2, -46, 6], [-33, -42, 2], [-33, -37.5], [-39.6, -37.5]]);
// the fore-end: the stock carried on under the barrel (a section, x and y)
const FORE = outline([[-19, -4, 3], [19, -4, 3], [19, -30, 10], [10, -41, 8], [-10, -41, 8], [-19, -30, 10]]);
const FORE_Z = [-430, -214];
const UPPER = outline([[-15, -4, 1], [15, -4, 1], [15, 8, 6], [8, 16, 6], [-8, 16, 6], [-15, 8, 6]]);
const MAG_AT = [0, -24, -112];
const MAG_LEN = 136;
const SIGHT_Y = 40; // high over the receiver: seen from behind the aperture, the gun's top is a narrow wedge well under the line
const DOT_Y = 50;

function buildSoups(put) {
  const hump = (p) => (p[0] > -30 ? 3.4 : p[1] > 5 ? 2.5 : 1);
  put('recv', 'blued', side(RECV, -HW, 9, { b0: 2.6, segs: 4, f0: hump }));
  put('recv', 'blued', side(RECV, 9, HW, { holes: [PORT], b1: 2.6, segs: 4, hb: 0.25, f1: hump }));
  put('recv', 'black', box(8.6, 4.5, -120, 1, 16, 73, 0.1));
  // stripper-clip guide and the rear sight's base on the receiver's heel
  put('recv', 'blued', box(0, 19, -52, 24, 4, 16, 1));
  // (slim: a thin ring on a narrow stem between low wings; the eye is a hand's breadth behind it)
  for (const sx of [-1, 1]) put('recv', 'blued', side(outline([[-22, 17], [-2, 14], [-2, 20, 2], [-8, 24.5, 2.5], [-14, 24.5, 2.5], [-22, 20, 3]]), sx * 9.6 - 0.8, sx * 9.6 + 0.8, { b0: 0.4, b1: 0.4 }));
  put('recv', 'blued', sect(circle(0, SIGHT_Y, 4.8, 32), -12.2, -9.8, { holes: [circle(0, SIGHT_Y, 3.5, 32)], b0: 0.3, b1: 0.3, hb: 0.4 }));
  put('recv', 'blued', box(0, (16 + SIGHT_Y - 4.4) / 2, -11, 2, SIGHT_Y - 4.4 - 16, 2.4, 0.3));
  put('recv', 'blued', box(0, 20, -11, 4.6, 9, 2.8, 0.4));
  put('recv', 'steel', pinX(-11, 20.5, 2.6, 10.4, 14.5, 0.6)); put('recv', 'steel', pinX(-11, 20.5, 2.6, -14.5, -10.4, 0.6));
  for (const [z, y, r] of [[-58, -22, 2.1], [-128, -30, 2.1], [-200, -8, 1.6]]) put('recv', 'steel', pinX(z, y, r, -HW - 0.25, HW + 0.25));
  put('recv', 'steel', pinX(-13.5, -46.5, 2.7, -GUARD_HW - 1.6, GUARD_HW + 1.6, 0.5));
  put('recv', 'black', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 1.6, b1: 1.6, segs: 2 }));
  put('recv', 'mark', placeText(strokeText('OSTRANDER 308', { h: 4.6, sw: 0.46 }).soup, 'left', HW, -204, -8));
  put('recv', 'mark', placeText(strokeText('OSTRANDER & SONS  GUNMAKERS', { h: 2.2, sw: 0.26 }).soup, 'left', HW, -204, -14));
  put('recv', 'mark', placeText(strokeText('7.62  OS 40317', { h: 2.6, sw: 0.3 }).soup, 'right', HW, -76, -16));
  // magazine well mouth and its paddle catch behind the magazine
  put('recv', 'blued', plan(outline([[-14.6, -148, 3], [14.6, -148, 3], [14.6, -76, 3], [-14.6, -76, 3]]), -45.5, -39, { holes: [outline([[-12.6, -145, 2], [12.6, -145, 2], [12.6, -79, 2], [-12.6, -79, 2]])], b0: 1.2, segs: 2, hb: 0.3 }));
  put('catch', 'steel', side(outline([[-77, -40, 1], [-72.5, -40, 1], [-71, -58, 1.5], [-75.4, -60, 1.5]]), -5, 5, { b0: 1, b1: 1 }));

  // ---- barrel, flash hider, gas cylinder, front sight ----
  put('recv', 'blued', lathe([[3.9, -660], [8.6, -660], [8.6, -470], [10.4, -466], [10.4, -219], [12.6, -218], [12.6, -216], [0, -216]], { segs: 32 }));
  put('recv', 'blued', lathe([[4, -716], [10.6, -716], [11.4, -714.6], [11.4, -668], [9, -662], [4, -662]], { segs: 24, closed: true }));
  for (let i = 0; i < 5; i++) put('recv', 'black', new Soup().add(box(0, 11.3, -692, 2.6, 1, 36, 0.4), new Matrix4().makeRotationZ((i / 5) * Math.PI * 2 + 0.63)));
  put('recv', 'black', lathe([[0, -715.8], [4, -715.8]], { segs: 16 }));
  put('recv', 'blued', lathe([[0, -566], [6.4, -566], [7.2, -565], [7.2, -432], [0, -432]], { segs: 20 }).move(0, -17, 0));
  put('recv', 'steel', lathe([[0, -578], [5, -578], [5.8, -577], [5.8, -566], [0, -566]], { segs: 20 }).move(0, -17, 0));
  for (const z of [-560, -470]) put('recv', 'blued', sect(outline([[-11, -26.5, 8], [11, -26.5, 8], [11, 11, 10], [-11, 11, 10]]), z - 5, z + 5, { b0: 1.2, b1: 1.2, segs: 2 }));
  put('recv', 'blued', box(0, 11, -646, 16, 4, 16, 1));
  for (const sx of [-1, 1]) put('recv', 'blued', side(outline([[-654, 12], [-638, 12], [-640, SIGHT_Y + 3, 2], [-652, SIGHT_Y + 3, 2]]), sx * 7 - 1, sx * 7 + 1, { b0: 0.4, b1: 0.4 }));
  put('recv', 'blued', side(outline([[-650, 12], [-642, 12], [-644.5, SIGHT_Y, 0.4], [-647.5, SIGHT_Y, 0.4]]), -0.9, 0.9, { b0: 0.2, b1: 0.2 }));

  // ---- walnut: the stock, the fore-end it becomes, and the ventilated upper handguard ----
  put('stock', 'wood', side(STOCK, -STOCK_HW, STOCK_HW, { b0: 6.8, b1: 6.8, segs: 4, f0: (p) => (p[0] < 1 ? 0.3 : 1), f1: (p) => (p[0] < 1 ? 0.3 : 1), user: 'grip' }));
  put('stock', 'black', side(outline([[338.5, -29, 3], [352, -31, 5], [354, -130, 5], [341.5, -133.5, 3]]), -STOCK_HW, STOCK_HW, { b0: 4, b1: 4, segs: 2 }));
  put('stock', 'steel', sect(circle(0, -118, 5, 16), 300, 304, { holes: [circle(0, -118, 3.2, 16)], b0: 0.5, b1: 0.5, hb: 0.5 }).move(0, -4, 0));
  const [f0, f1] = FORE_Z;
  put('recv', 'wood', sect(FORE, f0, f1, { b0: 4, segs: 3 }));
  put('recv', 'steel', sect(outline([[-20, -3, 3], [20, -3, 3], [20, -31, 10], [10.5, -42, 8], [-10.5, -42, 8], [-20, -31, 10]]), f0 - 3, f0 + 9, { holes: [outline([[-17.5, -5, 2], [17.5, -5, 2], [17.5, -29.5, 9], [9, -39, 7], [-9, -39, 7], [-17.5, -29.5, 9]])], b0: 0.8, b1: 0.8, hb: 0.2 })); // fore-end cap band
  put('recv', 'steel', sect(circle(0, -47, 5, 16), f0 + 30, f0 + 34, { holes: [circle(0, -47, 3.2, 16)], b0: 0.5, b1: 0.5, hb: 0.5 })); // sling loop
  put('recv', 'fiber', sect(UPPER, f0 + 6, f1 - 2, { b0: 2, b1: 2, segs: 2 }));
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) put('recv', 'black', new Soup().add(box(0, 0, 0, 1, 5, 16, 0.4), new Matrix4().makeTranslation(sx * 12.6, 11.4, f1 - 24 - i * 27).multiply(new Matrix4().makeRotationZ(-sx * 0.7))));

  // ---- bolt with its roller handle, trigger ----
  put('bolt', 'steel', box(12.5, 4.5, -120, 5.8, 14.6, 71, 0.7));
  put('bolt', 'black', box(15.3, 8, -98, 0.5, 2.2, 16, 0.2));
  put('bolt', 'steel', side(outline([[-112, 2, 2], [-92, 2, 2], [-92, 9, 2], [-112, 9, 2]]), HW - 1, HW + 9, { b1: 1.5 }));
  put('bolt', 'steel', lathe([[0, HW + 8], [5.4, HW + 8], [6.4, HW + 9.5], [6.4, HW + 20], [5.2, HW + 21.5], [0, HW + 21.5]], { segs: 18, map: 'yzx' }).move(0, 5.5, -100));
  put('trigger', 'steel', side(TRIGGER, -3.4, 3.4, { b0: 1, b1: 1, segs: 2 }));

  // ---- magazine (its own frame: y up the magazine, origin at the centre of its top) ----
  const MP = outline([[-12.4, -33, 2.6], [12.4, -33, 2.6], [12.4, 33, 2], [-12.4, 33, 2]]);
  put('mag', 'mag', plan(MP, -MAG_LEN, -2, { b1: 0.5 }));
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) put('mag', 'mag', side(outline([[-18 + i * 26, -MAG_LEN + 8, 3], [-8 + i * 26, -MAG_LEN + 8, 3], [-8 + i * 26, -22, 3], [-18 + i * 26, -22, 3]]), sx > 0 ? 12.2 : -13, sx > 0 ? 13 : -12.2, sx > 0 ? { b1: 0.4 } : { b0: 0.4 }));
  put('mag', 'mag', plan(outline([[-14, -35.5, 3], [14, -35.5, 3], [14, 35, 2.5], [-14, 35, 2.5]]), -MAG_LEN - 5, -MAG_LEN + 0.5, { b0: 1.4, b1: 0.8, segs: 2 }));
  put('mag', 'mag', box(0, -6, 34.4, 12, 9, 3, 0.8)); // the lug the catch holds
  put('mag', 'black', plan(outline([[-10.4, -30, 2], [10.4, -30, 2], [10.4, 30, 1.5], [-10.4, 30, 1.5]]), -2.6, 0.4, { b1: 0.6 }));
  const tilt = new Matrix4().makeTranslation(0, 3.4, 1).multiply(new Matrix4().makeRotationX(0.05));
  put('mag', 'bullet', new Soup().add(lathe([[0, -35], [1.4, -34.6], [3.1, -28], [3.9, -19], [0, -19]], { segs: 16 }), tilt));
  put('mag', 'brass', new Soup().add(lathe([[0, -19], [4.3, -19], [4.3, -14], [5.8, -10.4], [6, 30], [5.3, 30.4], [5.3, 31.2], [6, 31.6], [6, 33], [0, 33]], { segs: 16 }), tilt));

  // ---- attachments ----
  const rs = reflexSight(-124, 17.3, DOT_Y);
  put('att_sight', 'black', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'blued', lathe([[4, -880], [16, -880], [17.6, -878.4], [17.6, -724], [16, -722], [11, -722], [11, -714], [4, -714]], { segs: 28, closed: true }));
  put('att_suppressor', 'black', lathe([[0, -879.8], [4, -879.8]], { segs: 16 }));
  put('att_mag', 'mag', plan(MP, -MAG_LEN - 52, -MAG_LEN - 4));
  put('att_mag', 'mag', plan(outline([[-14, -35.5, 3], [14, -35.5, 3], [14, 35, 2.5], [-14, 35, 2.5]]), -MAG_LEN - 58, -MAG_LEN - 51.5, { b0: 1.4, b1: 0.8, segs: 2 }));
  caseSoups(put, 6, 51);
}

export function buildBattleRifle(G, patch = (m) => m) {
  const mats = G.mats, rest = { space: 'rest', shelter: 0.3 };
  const M = gunMats(G, patch, 171, {
    blued: patch(mats.gunmetal({ finish: 'blued', wear: 0.4, oil: 0.35, seed: 173, ...rest }), { occ: true, rough: [1, 0.16] }),
    wood: patch(mats.gunmetal({ finish: 'wood', color: 0x3e2212, wear: 0.26, oil: 0.5, brushDir: [0, 0.05, 1], seed: 177, space: 'rest', shelter: 0.8 }), { occ: true, rough: [0.9, 0.34] }), // oiled walnut: darker and with more sheen than the pump's (it read as tan plywood)
    fiber: patch(mats.gunmetal({ finish: 'polymer', color: 0x3c2a1c, wear: 0.4, oil: 0.1, seed: 179, space: 'rest', shelter: 0.7 }), { occ: true, rough: [1.2, 0.7] }),
  });
  const kit = modelKit(G, M, 'battleRifle');
  buildSoups((part, mat, soup) => kit.put(part, part === 'mag' && mat === 'black' ? 'mag' : mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('catch', [0, -40, -75]);
  kit.part('stock');
  kit.part('bolt');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  const magRest = new Matrix4().makeTranslation(MAG_AT[0] * MM, MAG_AT[1] * MM, MAG_AT[2] * MM);
  const magAxis = new Vector3(0, -1, 0);
  const _s = new Vector3(1, 1, 1);
  const { mag, spare } = magPair(kit);
  const casing = kit.part('casing');
  casing.visible = false;
  kit.part('att_sight'); kit.part('att_suppressor');
  const magExt = [kit.part('att_mag', [0, 0, 0], mag), kit.copy('att_mag', 'att_mag2', spare)];

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.bolt.position.z = state.slide;
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.catch.rotation.x = -0.18 * state.magRelease;
    magRest.decompose(mag.position, mag.quaternion, _s);
    mag.position.addScaledVector(magAxis, state.magD);
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = sdExtrude(sdPoly(STOCK, z, y) + 6.5, x, STOCK_HW - 6.5) - 6.5;
    d = Math.min(d, sdExtrude(sdPoly(RECV, z, y) + 2.4, x, HW - 2.4) - 2.4);
    d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 1.5, x, GUARD_HW - 1.5) - 1.5);
    d = Math.min(d, cylZ(x, y, z, 0, 10.4, -660, -216), bx(x, y, z, 0, -18, (FORE_Z[0] + FORE_Z[1]) / 2, 19, 22, (FORE_Z[1] - FORE_Z[0]) / 2, 8), bx(x, y, z, 0, 6, (FORE_Z[0] + FORE_Z[1]) / 2, 15, 10, (FORE_Z[1] - FORE_Z[0]) / 2, 5));
    d = Math.min(d, bx(x, y, z, 0, MAG_AT[1] - MAG_LEN / 2, MAG_AT[2], 14, MAG_LEN / 2 + 4, 35, 2));
    if (!o.noTrigger) {
      const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.4));
    }
    return d;
  }

  const model = {
    id: 'battleRifle', cls: 'rifle', action: 'bolt', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: BOLT_TRAVEL, lock: 0.078,
    mag, spare, casing, magRest, magAxis,
    magInHand: new Matrix4().set(0, 1, 0, 0.1, -1, 0, 0, -0.027, 0, 0, 1, -0.066, 0, 0, 0, 1),
    spareHand: 'fist',
    clip: { wellStart: 0.08, spare: [[0.84, 0.08], [0.94, 0.045, 'io'], [0.98, 0.038], [1.05, 0, 'in3']] },
    magBox: { c: [28, -27, -70], h: [72, 12.4, 33] },
    casingSpin: 28,
    adsHide: [parts.stock], adsHideHand: true, // the eye is over the comb: the wrist would fill the view
    pose: { ads: 0.07, kick: [1.3, 3.6, 0.22, 0.9, 1.1] }, // the eye a hand's breadth behind the aperture: the heel is under the frame, the picture is ring, blade and the handguard running away
    anchors: {
      muzzle: new Vector3(0, 0, -0.716),
      eject: new Vector3(0.0175, 0.005, -0.115),
      grip: new Vector3(0, -0.06, 0.05),
      support: new Vector3(0, -0.04, -0.33),
      sight: new Vector3(0, SIGHT_Y * MM, -0.011),
      mag: new Vector3(MAG_AT[0], MAG_AT[1] - MAG_LEN, MAG_AT[2]).multiplyScalar(MM),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: { at: [22.5, -62, 42], back: [-0.22, 0.4, 0.89], thumb: [0, 0.95, -0.3], elbow: [150, -230, 380], thumbKnuckle: [-13, 4, 46], thumbPad: [-17.5, -9, 22], cup: -0.1 },
      left: { at: [16, -44, -330], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -160], thumbPad: [-20, -14, -354], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, DOT_Y * MM, -0.011) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.88) } },
    mag: { parts: magExt },
  });
  return model;
}
