// The Dray 762: an invented belt-fed 7.62 light machine gun by "Dray Ordnance Works". A tall
// stamped receiver under a hinged feed cover, a heavy fluted barrel with a carrying handle and a
// folded bipod, a polymer fore-end and stock, and an olive drab box of belt hung under the left of
// the receiver with a few linked rounds running up into the feed tray. Reloading lifts the cover,
// drops the box and hangs a fresh one.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, MM, side, sect, plan, pinX, discZ, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';
import { gunMats, lowerSoups, lowerSdf, bx, cylZ, caseSoups, TRIG, HOLD_RIGHT, LOW_HW } from './rifle.js';

const HW = 17;
export const BOLT_TRAVEL = 0.05;
const SIGHT_Y = 58; // high over the cover: seen from behind the aperture, the gun's top is a narrow wedge well under the line
const DOT_Y = 70;
// the shared lower with no magazine well
export const LOWER_L = outline([
  [-236, -15.5], [-3, -15.5, 2], [6.5, -40, 30], [20, -80, 60], [27, -111, 3.2], [-14.5, -124.5, 2.6], [-31, -70, 30], [-36.5, -50, 6], [-39, -27, 3],
  [-230, -27, 3], [-236, -21, 2],
]);
const RECV = outline([[-262, 25, 2], [-30, 25, 6], [0, 10, 3], [0, -16, 1.5], [-262, -16, 1.5]]);
const PORT = outline([[-176, -6, 2.2], [-112, -6, 2.2], [-112, 8, 2.2], [-176, 8, 2.2]]);
// its rear is a long ramp, not a step: the aiming eye is just behind it and looks along it
const COVER = outline([[-236, 25.4, 1], [-64, 25.4, 2], [-60, 28, 2], [-122, 37, 8], [-226, 37, 5], [-240, 31, 3]]);
const HINGE = [0, 27, -238];
const STOCK = outline([[4, 16, 4], [226, 16, 6], [232, -86, 6], [208, -90, 4], [150, -40, 22], [60, -22, 8], [4, -15, 3]]);
const STOCK_HW = 14;
const FORE = outline([[-21, -8, 3], [21, -8, 3], [21, -32, 10], [10, -42, 8], [-10, -42, 8], [-21, -32, 10]]);
const FORE_Z = [-420, -264];
const MAG_AT = [-6, -17, -178]; // top centre of the belt box, hung
const BOX = { hx: 27, h: 94, hz: 56 };
const MUZZLE = -668;

function cartridge() { // lying along z, bullet toward -z, centred on its case
  const s = new Soup();
  s.add(lathe([[0, -36], [1.4, -35.6], [3.1, -29], [3.9, -20], [0, -20]], { segs: 12 }));
  return s;
}
function caseOf() {
  return lathe([[0, -20], [4.3, -20], [4.3, -15], [5.8, -11.4], [6, 29], [5.3, 29.4], [5.3, 30.2], [6, 30.6], [6, 32], [0, 32]], { segs: 12 });
}

function buildSoups(put) {
  const tail = (p) => (p[0] > -34 ? 2.4 : 1);
  put('recv', 'slide', side(RECV, -HW, 9, { b0: 2.6, segs: 3, f0: tail }));
  put('recv', 'slide', side(RECV, 9, HW, { holes: [PORT], b1: 2.6, segs: 3, hb: 0.2, f1: tail }));
  put('recv', 'black', box(8.8, 1, -144, 0.6, 15, 66, 0.1));
  // stamped ribs along both flanks, rivets, the feed tray's lip on the left
  for (const sx of [-1, 1]) {
    for (const y of [-10, 16]) put('recv', 'slide', box(sx * (HW + 0.3), y, -150, 1.4, 4.4, 196, 1.2));
    for (let i = 0; i < 7; i++) put('recv', 'steel', pinX(-250 + i * 36, 3 - (i % 2) * 6, 1.8, sx > 0 ? HW - 0.2 : -HW - 0.6, sx > 0 ? HW + 0.6 : -HW + 0.2, 0.25));
  }
  put('recv', 'steel', box(-HW - 9, 21.6, -178, 20, 2.4, 74, 0.6));
  put('recv', 'steel', box(-HW - 18.4, 18, -178, 1.6, 9, 74, 0.5));
  put('recv', 'slide', sect(outline([[-11, -13, 3], [11, -13, 3], [11, 8, 4], [-11, 8, 4]]), -0.6, 2.2, { b1: 1 }));
  put('recv', 'mark', placeText(strokeText('DRAY 762', { h: 5.4, sw: 0.52 }).soup, 'left', HW + 1, -128, 1));
  put('recv', 'mark', placeText(strokeText('DRAY ORDNANCE WORKS', { h: 2.3, sw: 0.27 }).soup, 'left', HW + 1, -128, -4.6));
  put('recv', 'mark', placeText(strokeText('7.62  DO 07713', { h: 2.6, sw: 0.3 }).soup, 'right', HW + 1, -104, 14));
  // rear sight: a ladder leaf with an aperture, behind the cover
  // (slim: a thin ring on a narrow leaf between low wings; the eye is a hand's breadth behind it)
  for (const sx of [-1, 1]) put('recv', 'slide', side(outline([[-34, 25], [-14, 25], [-14, 30, 2], [-19, 35, 2.5], [-25, 35, 2.5], [-34, 29, 3]]), sx * 9.6 - 0.8, sx * 9.6 + 0.8, { b0: 0.4, b1: 0.4 }));
  put('recv', 'slide', sect(circle(0, SIGHT_Y, 5, 32), -25.2, -22.8, { holes: [circle(0, SIGHT_Y, 3.7, 32)], b0: 0.3, b1: 0.3, hb: 0.4 }));
  put('recv', 'slide', box(0, (25 + SIGHT_Y - 4.6) / 2, -24, 2.2, SIGHT_Y - 4.6 - 25, 2.4, 0.3));
  put('recv', 'slide', box(0, 31, -24, 5, 12, 2.8, 0.4));
  put('recv', 'steel', pinX(-24, 30, 3, 10.4, 15, 0.6));
  // charging handle on the right, on the bolt's part
  put('bolt', 'steel', box(12.6, 1, -144, 5.8, 13, 62, 0.7));
  put('bolt', 'steel', side(outline([[-130, -13, 2], [-112, -13, 2], [-114, -6, 2], [-128, -6, 2]]), HW - 1, HW + 20, { b1: 3, segs: 2 }));

  // ---- feed cover (its own part, hinged at the front) with its latch ----
  put('cover', 'slide', side(COVER, -HW + 0.6, HW - 0.6, { b0: 3, b1: 3, segs: 3 }));
  for (let i = 0; i < 3; i++) put('cover', 'slide', box(0, 37.4, -212 + i * 32, 22, 1.2, 9, 0.5));
  put('cover', 'steel', pinX(HINGE[2], HINGE[1], 3.2, -HW - 1, HW + 1, 0.5));
  put('cover', 'steel', box(0, 27.6, -61, 14, 3.6, 6, 1.2));

  // ---- lower, fore-end, stock ----
  lowerSoups(put, { lower: LOWER_L });
  const [f0, f1] = FORE_Z;
  put('recv', 'polymer', sect(FORE, f0, f1, { b0: 4, b1: 2, segs: 3 }));
  for (let i = 0; i < 8; i++) put('recv', 'polymer', box(0, -42.4, f0 + 20 + i * 17, 20, 1.4, 8, 0.6));
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) put('recv', 'black', box(sx * 21.2, -18, f0 + 28 + i * 32, 0.8, 9, 20, 0.4));
  put('stock', 'slide', rodZ(0, 2, 13, 1, 30, 0.8, 20));
  put('stock', 'polymer', side(STOCK, -STOCK_HW, STOCK_HW, { b0: 4.6, b1: 4.6, segs: 3 }));
  put('stock', 'black', side(outline([[228, 16, 4], [238, 14, 5], [242, -84, 5], [232, -88, 4]]), -STOCK_HW + 0.6, STOCK_HW - 0.6, { b0: 3, b1: 3, segs: 2 }));
  put('stock', 'steel', side(outline([[120, 17, 2], [200, 17, 2], [200, 21, 2], [120, 21, 2]]), -6, 6, { b0: 1, b1: 1 })); // shoulder rest, folded

  // ---- barrel: trunnion, fluted heavy barrel, carrying handle, gas tube, front sight, flash hider, bipod ----
  put('recv', 'steel', lathe([[0, -290], [16, -290], [17, -289], [17, -263], [0, -263]], { segs: 28 }));
  put('recv', 'slide', lathe([[4, MUZZLE + 48], [9.6, MUZZLE + 48], [9.6, -520], [12.4, -514], [12.4, -290], [0, -290]], { segs: 28 }));
  for (let i = 0; i < 8; i++) put('recv', 'black', new Soup().add(box(0, 12.4, -400, 3, 1, 190, 0.5), new Matrix4().makeRotationZ((i / 8) * Math.PI * 2 + 0.39)));
  put('recv', 'slide', lathe([[4, MUZZLE], [11, MUZZLE], [12.4, MUZZLE + 2], [12.4, MUZZLE + 44], [9.6, MUZZLE + 48], [4, MUZZLE + 48]], { segs: 24, closed: true }));
  for (let i = 0; i < 4; i++) put('recv', 'black', new Soup().add(box(0, 12.3, MUZZLE + 24, 3, 1, 30, 0.4), new Matrix4().makeRotationZ((i / 4) * Math.PI * 2 + 0.78)));
  put('recv', 'black', lathe([[0, MUZZLE + 0.2], [4, MUZZLE + 0.2]], { segs: 16 }));
  put('recv', 'slide', lathe([[0, -560], [7, -560], [7.8, -559], [7.8, -300], [0, -300]], { segs: 18 }).move(0, -19, 0));
  put('recv', 'slide', sect(outline([[-11, -29, 8], [11, -29, 8], [11, 13, 10], [-11, 13, 10]]), -566, -548, { b0: 1.2, b1: 1.2, segs: 2 }));
  // carrying handle: two posts off the barrel and a grip laid over to the right
  for (const z of [-330, -396]) put('recv', 'steel', new Soup().add(box(0, 14, 0, 5, 30, 7, 1.5), new Matrix4().makeTranslation(0, 12, z).multiply(new Matrix4().makeRotationZ(-0.5))));
  put('recv', 'polymer', lathe([[0, -404], [8.5, -404], [9.6, -402], [9.6, -324], [8.5, -322], [0, -322]], { segs: 18 }).move(16.5, 40, 0));
  put('recv', 'slide', side(outline([[-624, 10, 2], [-600, 10, 2], [-603, SIGHT_Y + 4, 2], [-621, SIGHT_Y + 4, 2]]), -5.4, 5.4, { holes: [outline([[-619, 20, 2], [-605, 20, 2], [-607, SIGHT_Y - 6, 1.5], [-617, SIGHT_Y - 6, 1.5]])], b0: 1, b1: 1, hb: 0.4 }));
  put('recv', 'slide', lathe([[9.5, -626], [12.4, -626], [12.4, -598], [9.5, -598]], { segs: 24, closed: true }));
  put('recv', 'slide', box(0, SIGHT_Y - 3, -612, 1.7, 7, 1.7, 0.25));
  put('recv', 'white', discZ(0, SIGHT_Y - 0.4, 0.7, -611.1, -610.98, 12));
  // bipod, folded back under the barrel
  put('recv', 'steel', lathe([[9.6, -590], [14, -590], [14, -574], [9.6, -574]], { segs: 20, closed: true }));
  for (const sx of [-1, 1]) {
    put('recv', 'steel', rodZ(sx * 9, -27, 3.6, -578, -366, 0.6, 12));
    put('recv', 'steel', box(sx * 9, -29, -362, 12, 3, 14, 1));
    put('recv', 'steel', box(sx * 9, -19, -580, 5, 16, 6, 1));
  }

  // ---- the belt box (its own frame: y up, origin at the centre of its top) and the belt out of it ----
  const B = BOX;
  put('mag', 'olive', plan(outline([[-B.hx, -B.hz, 5], [B.hx, -B.hz, 5], [B.hx, B.hz, 5], [-B.hx, B.hz, 5]]), -B.h, -3, { b0: 3, b1: 1.5, segs: 2 }));
  put('mag', 'olive', plan(outline([[-B.hx - 1.5, -B.hz - 1.5, 6], [B.hx + 1.5, -B.hz - 1.5, 6], [B.hx + 1.5, B.hz + 1.5, 6], [-B.hx - 1.5, B.hz + 1.5, 6]]), -12, 0, { holes: [outline([[-B.hx + 6, -30, 4], [-B.hx + 22, -30, 4], [-B.hx + 22, 30, 4], [-B.hx + 6, 30, 4]])], b0: 1, b1: 1.5, segs: 2, hb: 0.3 }));
  for (const sx of [-1, 1]) for (const z of [-30, 30]) put('mag', 'olive', box(sx * (B.hx + 0.2), -B.h / 2 - 6, z, 1.4, B.h - 26, 9, 1.2));
  put('mag', 'steel', box(B.hx + 1.6, -9, 0, 2.4, 10, 34, 0.8)); // latch
  put('mag', 'mark', placeText(strokeText('100 RDS 7.62', { h: 5, sw: 0.5 }).soup, 'left', B.hx, -34, -40));
  put('mag', 'mark', placeText(strokeText('LINKED 4 BALL 1 TR', { h: 3, sw: 0.34 }).soup, 'left', B.hx, -34, -50));
  // the belt: rounds side by side, up out of the box's mouth and over into the tray
  const mouth = [-B.hx + 14, 0];
  for (let i = 0; i < 6; i++) {
    const t = i / 5; const x = mouth[0] + 14 * t * t + 3 * t; const y = 2 + 34 * t - 4 * t * t;
    const m = new Matrix4().makeTranslation(x, y, 4);
    put('mag', 'bullet', new Soup().add(cartridge(), m));
    put('mag', 'brass', new Soup().add(caseOf(), m));
    put('mag', 'black', new Soup().add(box(0, 0, 8, 13, 4, 14, 1.8), new Matrix4().makeTranslation(x, y + 2.4, 4)));
  }

  // ---- attachments ----
  const rs = reflexSight(-150, 37.6, DOT_Y);
  put('att_sight', 'slide', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'slide', lathe([[4, MUZZLE - 150], [17, MUZZLE - 150], [18.6, MUZZLE - 148.4], [18.6, MUZZLE - 4], [17, MUZZLE - 2], [12, MUZZLE - 2], [12, MUZZLE + 6], [4, MUZZLE + 6]], { segs: 28, closed: true }));
  put('att_suppressor', 'black', lathe([[0, MUZZLE - 149.8], [4, MUZZLE - 149.8]], { segs: 16 }));
  put('att_grip', 'polymer', lathe([[0, -116], [11.4, -116], [12.8, -113.5], [12.2, -62], [10.4, -52], [10.4, -40], [0, -40]], { segs: 22, map: 'zxy' }).move(0, 0, -340));
  put('att_mag', 'olive', plan(outline([[-B.hx, -B.hz, 5], [B.hx, -B.hz, 5], [B.hx, B.hz, 5], [-B.hx, B.hz, 5]]), -B.h - 40, -B.h + 2, { b0: 3, segs: 2 }));
  caseSoups(put, 6, 51);
}

export function buildLmg(G, patch = (m) => m) {
  const mats = G.mats;
  const M = gunMats(G, patch, 211, {
    olive: patch(mats.gunmetal({ finish: 'polymer', color: 0x3a4028, wear: 0.5, oil: 0.1, seed: 213, space: 'rest', shelter: 0.5 }), { occ: true, rough: [1.1, 0.6] }),
  });
  const kit = modelKit(G, M, 'lmg');
  buildSoups((part, mat, soup) => kit.put(part, mat === 'ctrl' ? 'slide' : mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('bolt');
  kit.part('cover', HINGE);
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  kit.part('stock');
  const magRest = new Matrix4().makeTranslation(MAG_AT[0] * MM, MAG_AT[1] * MM, MAG_AT[2] * MM);
  const magAxis = new Vector3(0, -1, 0);
  const _s = new Vector3(1, 1, 1);
  const belt = (g) => { const b = g.children.filter((m) => m.userData.mat === 'brass' || m.userData.mat === 'bullet' || m.userData.mat === 'black'); g.userData.setRounds = (n) => { for (const r of b) r.visible = n > 0; }; return g; };
  const mag = belt(kit.part('mag')), spare = belt(kit.copy('mag', 'spare'));
  spare.visible = false;
  const casing = kit.part('casing');
  casing.visible = false;
  kit.part('att_sight', HINGE, parts.cover); kit.part('att_suppressor'); kit.part('att_grip');
  const magExt = [kit.part('att_mag', [0, 0, 0], mag), kit.copy('att_mag', 'att_mag2', spare)];

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0, cover: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.bolt.position.z = state.slide;
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.cover.rotation.x = -1.15 * state.cover; // lifts at the rear, on its hinge at the front
    magRest.decompose(mag.position, mag.quaternion, _s);
    mag.position.addScaledVector(magAxis, state.magD);
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = lowerSdf(x, y, z, o, LOWER_L);
    d = Math.min(d, bx(x, y, z, 0, 10, -131, HW + 1, 27, 131, 3));
    d = Math.min(d, bx(x, y, z, 0, -25, (FORE_Z[0] + FORE_Z[1]) / 2, 21, 17, (FORE_Z[1] - FORE_Z[0]) / 2, 8), cylZ(x, y, z, 0, 12.4, MUZZLE, -262));
    d = Math.min(d, bx(x, y + state.magD / MM, z, MAG_AT[0], MAG_AT[1] - BOX.h / 2, MAG_AT[2], BOX.hx + 1.5, BOX.h / 2, BOX.hz + 1.5, 4));
    return d;
  }

  const model = {
    id: 'lmg', cls: 'lmg', action: 'bolt', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: BOLT_TRAVEL, lock: 0,
    mag, spare, casing, magRest, magAxis,
    // the box stands on the palm, its mouth up, the fingers up its far side
    magInHand: new Matrix4().set(0, 0, -1, 0.002, 0, -1, 0, -0.124, -1, 0, 0, -0.062, 0, 0, 0, 1),
    spareHand: 'cup',
    magBox: { c: [2, -76, -62], h: [BOX.hz, BOX.h / 2, BOX.hx] },
    clip: { wellStart: 0.22, drop: 9 },
    casingSpin: 26,
    adsHide: [parts.stock],
    pose: { ads: 0.07 }, // the eye a hand's breadth behind the aperture: ring, post, the cover's ramp and the barrel below
    anchors: {
      muzzle: new Vector3(0, 0, MUZZLE * MM),
      eject: new Vector3(0.018, 0.001, -0.14),
      grip: new Vector3(0, -0.06, -0.01),
      support: new Vector3(0, -0.035, -0.34),
      sight: new Vector3(0, SIGHT_Y * MM, -0.024),
      mag: new Vector3(MAG_AT[0], MAG_AT[1] - BOX.h, MAG_AT[2]).multiplyScalar(MM),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: HOLD_RIGHT,
      left: { at: [17, -45, -344], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -140], thumbPad: [-22.5, -18, -368], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  void LOW_HW;
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, DOT_Y * MM, -0.024) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, (MUZZLE - 150) * MM) } },
    grip: { parts: [parts.att_grip] },
    mag: { parts: magExt },
  });
  return model;
}
