// The Brandt 12: an invented gas-operated 12 gauge by "Brandt Repeating Arms". A parkerised
// receiver on a black polymer stock, a fixed ribbed fore-end over the gas piston and the magazine
// tube, a ventilated rib to a white bead. The bolt cycles on every shot (its handle on the right);
// shells go in one at a time through the gate under the receiver, as on the pump.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, strokeText, sdPoly, sdExtrude, MM, side, sect, plan, pinX, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';
import { gunMats, bx, cylZ } from './rifle.js';
import { HW, TRIG, RECV, STOCK, STOCK_HW, GUARD, GUARD_HW, TRIGGER } from './battleRifle.js';

const TUBE_Y = -26.5;
export const BOLT_TRAVEL = 0.07;
const PORT = outline([[-151, -4.5, 2.2], [-87, -4.5, 2.2], [-87, 12, 2.2], [-151, 12, 2.2]]);
const FOREND = outline([[-20.5, -1, 4], [20.5, -1, 4], [20.5, -34, 10], [9, -44, 8], [-9, -44, 8], [-20.5, -34, 10]]);
const FOREND_Z = [-452, -218];
const MUZZLE = -648;

// a shell in its own frame: axis on z, brass head toward +z, centred
function shellSoups(put, part) {
  put(part, 'hull', lathe([[0, -29], [7.8, -29], [10.05, -26.6], [10.05, 13.2], [0, 13.2]], { segs: 20 }));
  for (let i = 0; i < 6; i++) put(part, 'hull', new Soup().add(box(0, 4.4, -29.02, 0.5, 7.4, 0.1, 0.02), new Matrix4().makeRotationZ((i / 6) * Math.PI * 2)));
  put(part, 'brass', lathe([[10.15, 13], [10.15, 27.2], [11.15, 27.4], [11.15, 28.7], [10.5, 29], [3.2, 29], [3.2, 28.6], [0, 28.6]], { segs: 20 }));
}

function buildSoups(put) {
  const hump = (p) => (p[0] > -30 ? 3.4 : p[1] > 5 ? 2.5 : 1);
  put('recv', 'slide', side(RECV, -HW, 9, { b0: 2.6, segs: 4, f0: hump }));
  put('recv', 'slide', side(RECV, 9, HW, { holes: [PORT], b1: 2.6, segs: 4, hb: 0.25, f1: hump }));
  put('recv', 'black', box(8.6, 3.75, -119, 1, 17.5, 65, 0.1));
  put('recv', 'black', box(0, -39.3, -111, 20.5, 0.7, 80, 0.1));
  put('recv', 'steel', plan(outline([[-9.4, -148, 2], [9.4, -148, 2], [9.4, -76, 4], [-9.4, -76, 4]]), -40.1, -39.3, { b0: 0.5 }));
  for (const [z, y, r] of [[-58, -22, 2.1], [-118, -30, 2.1], [-196, -8, 1.6]]) put('recv', 'steel', pinX(z, y, r, -HW - 0.25, HW + 0.25));
  put('recv', 'steel', pinX(-13.5, -46.5, 2.7, -GUARD_HW - 1.6, GUARD_HW + 1.6, 0.5));
  put('recv', 'polymer', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 1.6, b1: 1.6, segs: 2 }));
  // bolt release button and the slot the handle runs in
  put('recv', 'steel', pinX(-172, -24, 4.4, HW - 0.4, HW + 2.4, 0.8));
  put('recv', 'black', box(HW - 0.2, 4, -112, 0.6, 5, 86, 0.2));
  put('recv', 'mark', placeText(strokeText('BRANDT 12', { h: 5.2, sw: 0.5 }).soup, 'left', HW, -204, -8));
  put('recv', 'mark', placeText(strokeText('BRANDT REPEATING ARMS', { h: 2.4, sw: 0.28 }).soup, 'left', HW, -204, -14));
  put('recv', 'mark', placeText(strokeText('12 GA 3 IN  GAS', { h: 2.6, sw: 0.3 }).soup, 'right', HW, -60, -16));

  // ---- barrel, magazine tube with its cap, gas block, ventilated rib, bead ----
  put('recv', 'blued', lathe([[9.3, MUZZLE + 44], [9.3, MUZZLE], [10, MUZZLE - 1.2], [11, MUZZLE - 1.2], [11.6, MUZZLE - 0.4], [11.6, -219], [12.6, -218], [12.6, -216], [0, -216]], { segs: 36 }));
  put('recv', 'black', lathe([[0, MUZZLE + 44], [9.3, MUZZLE + 44]], { segs: 24 }));
  put('recv', 'slide', lathe([[0, -520], [11.8, -520], [11.8, -216], [0, -216]], { segs: 32 }).move(0, TUBE_Y, 0));
  put('recv', 'steel', lathe([[0, -546], [9, -546], [12.9, -541], [12.9, -521], [11.9, -520], [0, -520]], { segs: 32 }).move(0, TUBE_Y, 0));
  for (let i = 0; i < 16; i++) put('recv', 'steel', new Soup().add(box(0, 12.95, -531, 1.3, 0.5, 17, 0.15), new Matrix4().makeRotationZ((i / 16) * Math.PI * 2)).move(0, TUBE_Y, 0));
  put('recv', 'slide', sect(outline([[-13.6, -40.4, 12.5], [13.6, -40.4, 12.5], [13.6, 13.6, 12.5], [-13.6, 13.6, 12.5]]), -474, -456, { b0: 1.2, b1: 1.2, segs: 2 }));
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) put('recv', 'black', box(sx * 13.7, -13, -469 + i * 8, 0.5, 3, 3, 0.8)); // gas ports
  put('recv', 'blued', sect(outline([[-4.2, 16.2, 0.5], [4.2, 16.2, 0.5], [4.2, 18.2, 0.4], [-4.2, 18.2, 0.4]]), MUZZLE + 4, -214, { b0: 1, b1: 0.6 }));
  for (let z = MUZZLE + 14; z < -220; z += 38) put('recv', 'blued', box(0, 13.6, z, 3.2, 5.4, 9, 0.5));
  for (let i = 0; i < 3; i++) put('recv', 'black', box(-2 + i * 2, 18.25, (MUZZLE - 214) / 2, 0.8, 0.3, 430, 0.1));
  put('recv', 'white', lathe([[0, 18], [1.6, 18], [1.6, 19.4], [2.6, 20], [3, 21.2], [2.5, 22.5], [1.4, 23], [0, 23]], { segs: 16, map: 'zxy' }).move(0, 0, MUZZLE + 10));

  // ---- polymer stock with a rubber pad, fixed ribbed fore-end ----
  put('stock', 'polymer', side(STOCK, -STOCK_HW, STOCK_HW, { b0: 6.8, b1: 6.8, segs: 4, f0: (p) => (p[0] < 1 ? 0.3 : 1), f1: (p) => (p[0] < 1 ? 0.3 : 1), user: 'grip' }));
  put('stock', 'black', side(outline([[338.5, -29, 3], [356, -31, 6], [358, -130, 6], [341.5, -133.5, 3]]), -STOCK_HW, STOCK_HW, { b0: 5, b1: 5, segs: 3 }));
  for (let i = 0; i < 5; i++) put('stock', 'black', box(0, -60, 345 + i * 2.6, 2 * STOCK_HW + 0.6, 92, 1, 0.3));
  const [f0, f1] = FOREND_Z;
  const core = FOREND.map((p) => [p[0] * 0.94, -2 + (p[1] + 2) * 0.94]);
  put('recv', 'polymer', sect(core, f0 + 1, f1 - 1, { b0: 3, segs: 2 }));
  const n = 13, pitch = (f1 - f0) / n;
  for (let i = 0; i < n; i++) put('recv', 'polymer', sect(FOREND, f0 + i * pitch, f0 + (i + 1) * pitch - 5, { b0: 1.5, b1: 1.5, segs: 2 }));

  // ---- bolt with its handle, trigger ----
  put('bolt', 'steel', box(12.5, 3.75, -119, 5.8, 15.6, 63, 0.7));
  put('bolt', 'black', box(15.3, 7.5, -100, 0.5, 2.2, 16, 0.2));
  put('bolt', 'steel', side(outline([[-108, 1, 2], [-94, 1, 2], [-96, 7, 2], [-106, 7, 2]]), HW - 1, HW + 16, { b1: 2.5, segs: 2 }));
  put('trigger', 'steel', side(TRIGGER, -3.4, 3.4, { b0: 1, b1: 1, segs: 2 }));

  // ---- attachments: reflex sight, ported brake, a two-shell tube extension ----
  const rs = reflexSight(-128, 17.3, 41);
  put('att_sight', 'black', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'black', lathe([[9.6, MUZZLE - 52], [13, MUZZLE - 52], [14.2, MUZZLE - 50.6], [14.2, MUZZLE + 4], [12.6, MUZZLE + 6], [11.7, MUZZLE + 6], [11.7, MUZZLE], [9.6, MUZZLE]], { segs: 28, closed: true }));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) put('att_suppressor', 'slide', box(sx * 14, 2, MUZZLE - 12 - i * 12, 1, 9, 6.4, 0.6));
  put('att_mag', 'slide', lathe([[0, -612], [11.8, -612], [11.8, -540], [0, -540]], { segs: 32 }).move(0, TUBE_Y, 0));
  put('att_mag', 'steel', lathe([[0, -624], [10.6, -624], [12.7, -621.5], [12.7, -612.5], [11.9, -611.5], [0, -611.5]], { segs: 32 }).move(0, TUBE_Y, 0));
  shellSoups(put, 'shell');
}

export function buildSemiShotgun(G, patch = (m) => m) {
  const mats = G.mats;
  const M = gunMats(G, patch, 191, {
    blued: patch(mats.gunmetal({ finish: 'blued', wear: 0.3, oil: 0.35, seed: 195, space: 'rest', shelter: 0.3 }), { occ: true, rough: [1, 0.16] }),
    hull: patch(mats.gunmetal({ finish: 'polymer', color: 0x1f5a34, wear: 0.12, oil: 0.1, seed: 193, space: 'rest', shelter: 0.5 }), { rough: [0.8, 0.3] }),
  });
  const kit = modelKit(G, M, 'autoShotgun');
  buildSoups(kit.put);
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('stock');
  kit.part('bolt');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  kit.part('att_sight'); kit.part('att_suppressor'); kit.part('att_mag');
  // one shell geometry, three uses: the one the hand feeds, the one thrown out, and `mag` (nothing to show on a tube)
  const spare = kit.part('shell');
  spare.name = 'spare';
  parts.spare = spare;
  spare.userData.setRounds = () => {};
  spare.visible = false;
  const casing = kit.copy('shell', 'casing');
  casing.visible = false;
  const mag = kit.copy('shell', 'mag');
  mag.visible = false;
  mag.userData.setRounds = () => {};

  const state = { trigger: 0, hammer: 1, slide: 0, stop: 0, magRelease: 0, magD: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.bolt.position.z = state.slide;
    mag.visible = false;
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = sdExtrude(sdPoly(STOCK, z, y) + 6.5, x, STOCK_HW - 6.5) - 6.5;
    d = Math.min(d, sdExtrude(sdPoly(RECV, z, y) + 2.4, x, HW - 2.4) - 2.4);
    d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 1.5, x, GUARD_HW - 1.5) - 1.5);
    d = Math.min(d, cylZ(x, y, z, 0, 11.6, MUZZLE, -216), cylZ(x, y, z, TUBE_Y, 11.8, -546, -216));
    d = Math.min(d, bx(x, y, z, 0, -22.5, (FOREND_Z[0] + FOREND_Z[1]) / 2, 20.5, 21.5, (FOREND_Z[1] - FOREND_Z[0]) / 2, 8));
    if (!o.noTrigger) {
      const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.4));
    }
    return d;
  }

  const model = {
    id: 'autoShotgun', cls: 'shotgun', action: 'bolt', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: BOLT_TRAVEL, lock: 0.064,
    mag, spare, casing,
    magRest: new Matrix4().makeTranslation(0, -0.03, -0.118),
    magAxis: new Vector3(0, -0.5, 0.866),
    magInHand: new Matrix4().set(-1, 0, 0, 0.012, 0, -1, 0, -0.04, 0, 0, 1, -0.122, 0, 0, 0, 1),
    spareHand: 'pinch',
    casingSpin: 16,
    adsHide: [parts.stock], adsHideHand: true,
    // Aiming: the eye is over the front of the receiver and a thumb's width above it, as the pump's is;
    // the muzzle is tipped up (adsRot) so the bead's top sits on the axis. No receiver is in the frame;
    // the picture is the barrel and rib running to the bead, the fore-end and the hand on it below.
    pose: { kick: [1.9, 4.6, 0.3, 1.0, 1.3], ads: 0.08, adsRot: [0.0449, 0, 0] }, // (kick: the gas system takes the edge off)
    anchors: {
      muzzle: new Vector3(0, 0, (MUZZLE - 1.2) * MM),
      eject: new Vector3(0.0175, 0.004, -0.112),
      grip: new Vector3(0, -0.06, 0.05),
      support: new Vector3(0, -0.04, -0.37),
      sight: new Vector3(0, 0.04041, -0.25), // on the line from the eye (y 44, z -170) to the bead's top; the eye is `ads` behind it
      mag: new Vector3(0, -0.04, -0.112),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: { at: [22.5, -62, 42], back: [-0.22, 0.4, 0.89], thumb: [0, 0.95, -0.3], elbow: [150, -230, 380], thumbKnuckle: [-13, 4, 46], thumbPad: [-17.5, -9, 22], cup: -0.1 },
      left: { at: [17, -47, -360], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -160], thumbPad: [-21.5, -14, -384], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, 0.0432, -0.02) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, (MUZZLE - 52) * MM) } },
    mag: { parts: [parts.att_mag] },
  });
  return model;
}
