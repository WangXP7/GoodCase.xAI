// The Jumper: a truck battery booster turned on the dead. A yellow jump-pack body with rubber
// bumpers and a carrying bar, a charge gauge on its rear face, a copper coil on a core out of its
// front, and two heavy jump-lead clamps (one red, one black) held open on prongs past the coil, each
// on its own cable from the pack. A grey cell drops out from under the pack and a fresh one goes in.
//
// Model space (metres): the arc leaves along z, toward -z; +y up, +x the shooter's right; z = 0 is
// the rear face of the pack. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, tube, MM, side, sect, plan, pinX, discZ, rodZ, placeText, modelKit, fitments } from '../geo.js';
import { upgradeFinish } from './upgrade.js';
import { gunMats, lowerSoups, lowerSdf, bx, cylZ, TRIG, HOLD_RIGHT } from './rifle.js';
import { LOWER_L } from './lmg.js';

const HW = 30;
const BODY = outline([[-236, 46, 8], [-14, 46, 14], [0, 30, 4], [0, -16, 3], [-236, -16, 3]]);
const MAG_AT = [0, -17, -170];
const CELL = { hx: 21, h: 78, hz: 46 };
const TIP = -452;

function clamp(color) { // one jump-lead clamp in its own frame: jaws open toward -z, pivot at the origin
  const s = { handle: new Soup(), copper: new Soup(), steel: new Soup() };
  for (const sy of [-1, 1]) {
    const jaw = outline([[-64, sy * 15], [-30, sy * 9, 4], [0, sy * 3.5, 3], [44, sy * 15, 6], [46, sy * 9.5, 3], [0, sy * -1.5, 2], [-30, sy * 4.5, 3], [-62, sy * 10]]);
    s.handle.add(side(jaw, -7, 7, { b0: 1.6, b1: 1.6, segs: 2 }));
    for (let i = 0; i < 5; i++) s.copper.add(box(0, sy * (9.4 - i * 0.2), -60 + i * 5.4, 12, 2.6, 2.6, 0.6));
    s.copper.add(box(0, sy * 12, -50, 15, 3, 26, 0.8));
  }
  s.steel.add(pinX(0, 0, 3.4, -9, 9, 0.6));
  s.steel.add(lathe([[5, -8], [6.4, -8], [6.4, 8], [5, 8]], { segs: 14, map: 'yzx', closed: true }).move(0, 0, 14)); // spring
  void color;
  return s;
}

function buildSoups(put) {
  // ---- the pack ----
  put('recv', 'yellow', side(BODY, -HW, HW, { b0: 6, b1: 6, segs: 3 }));
  for (const sx of [-1, 1]) {
    for (const z of [-222, -14]) put('recv', 'black', side(outline([[z - 16, -18, 5], [z + 16, -18, 5], [z + 16, 49, 9], [z - 16, 49, 9]]), sx > 0 ? HW - 3 : -HW - 3, sx > 0 ? HW + 3 : -HW + 3, { b0: 2.4, b1: 2.4, segs: 2 }));
    for (let i = 0; i < 6; i++) put('recv', 'black', box(sx * (HW + 0.2), 22, -84 - i * 13, 1, 26, 5, 0.4)); // cooling louvres
  }
  // the carrying bar over the top
  for (const z of [-196, -60]) put('bar', 'black', box(0, 54, z, 14, 18, 16, 3, 2));
  put('bar', 'black', rodZ(0, 62, 9.5, -204, -52, 2, 18));
  // rear face: the gauge, a master switch and its lamp
  put('recv', 'black', discZ(-10, 22, 15, 0.2, 3, 28));
  put('recv', 'white', discZ(-10, 22, 12.6, 3, 3.3, 28));
  put('recv', 'red', sect(outline([[-10.8, 22], [-9.2, 22], [-2.6, 31.4], [-3.6, 32]]), 3.3, 3.8));
  for (let i = 0; i < 7; i++) put('recv', 'black', new Soup().add(box(0, 10.6, 3.45, 0.9, 3, 0.3, 0.1), new Matrix4().makeRotationZ(-1.1 + i * 0.37)).move(-10, 22, 0));
  put('recv', 'red', box(14, 26, 2.4, 9, 13, 5, 1.5));
  put('recv', 'lamp', discZ(14, 9, 3, 0.3, 2.2, 14));
  put('recv', 'mark', placeText(strokeText('THE JUMPER', { h: 9, sw: 0.9 }).soup, 'left', HW, -180, 16));
  put('recv', 'mark', placeText(strokeText('HALE HEAVY DUTY  12 / 24 V  1800 A', { h: 3.2, sw: 0.36 }).soup, 'left', HW, -180, 8));
  put('recv', 'mark', placeText(strokeText('DANGER', { h: 6, sw: 0.7 }).soup, 'right', HW, -76, 16));
  put('recv', 'mark', placeText(strokeText('DO NOT CROSS LEADS', { h: 3.2, sw: 0.36 }).soup, 'right', HW, -76, 8));
  lowerSoups(put, { lower: LOWER_L });
  // cell well under the pack
  put('recv', 'black', plan(outline([[-CELL.hx - 3, MAG_AT[2] - CELL.hz - 3, 3], [CELL.hx + 3, MAG_AT[2] - CELL.hz - 3, 3], [CELL.hx + 3, MAG_AT[2] + CELL.hz + 3, 3], [-CELL.hx - 3, MAG_AT[2] + CELL.hz + 3, 3]]), -36, -16,
    { holes: [outline([[-CELL.hx - 0.6, MAG_AT[2] - CELL.hz - 0.6, 2], [CELL.hx + 0.6, MAG_AT[2] - CELL.hz - 0.6, 2], [CELL.hx + 0.6, MAG_AT[2] + CELL.hz + 0.6, 2], [-CELL.hx - 0.6, MAG_AT[2] + CELL.hz + 0.6, 2]])], b0: 1.2, segs: 2, hb: 0.3 }));

  // ---- the coil: a core with windings between two flanges, a cradle under it for the hand ----
  put('recv', 'black', lathe([[0, -352], [10, -352], [10, -236], [0, -236]], { segs: 20 }).move(0, 12, 0));
  for (const z of [-244, -340]) put('recv', 'black', lathe([[0, z - 4], [27, z - 4], [28, z - 3], [28, z + 3], [27, z + 4], [0, z + 4]], { segs: 28 }).move(0, 12, 0));
  for (let i = 0; i < 17; i++) put('recv', 'copper', lathe([[21, -334 + i * 5.2 - 2.4], [23.4, -334 + i * 5.2 - 1.6], [24.2, -334 + i * 5.2], [23.4, -334 + i * 5.2 + 1.6], [21, -334 + i * 5.2 + 2.4]], { segs: 28, closed: false }).move(0, 12, 0));
  put('recv', 'copper', lathe([[0, -336], [21.4, -336], [21.4, -248], [0, -248]], { segs: 28 }).move(0, 12, 0));
  put('recv', 'polymer', sect(outline([[-22, -8, 3], [22, -8, 3], [22, -24, 9], [10, -34, 8], [-10, -34, 8], [-22, -24, 9]]), -348, -238, { b0: 3, b1: 2, segs: 2 }));
  for (let i = 0; i < 6; i++) put('recv', 'polymer', box(0, -34.4, -334 + i * 17, 20, 1.4, 8, 0.6));
  // ---- prongs and the clamps on them ----
  for (const sx of [-1, 1]) {
    put('recv', 'steel', rodZ(sx * 17, 12, 4.2, -396, -350, 0.6, 14));
    put('recv', 'black', lathe([[4.3, -366], [7, -366], [7, -352], [4.3, -352]], { segs: 14, closed: true }).move(sx * 17, 12, 0));
    const c = clamp();
    const m = new Matrix4().makeTranslation(sx * 17, 12, -392).multiply(new Matrix4().makeRotationZ(sx * 0.5));
    put('recv', sx < 0 ? 'red' : 'black', new Soup().add(c.handle, m));
    put('recv', 'copper', new Soup().add(c.copper, m));
    put('recv', 'steel', new Soup().add(c.steel, m));
    // its cable: out of the pack's shoulder, sagging to the clamp's tail
    put('recv', sx < 0 ? 'red' : 'black', tube([[sx * 22, 40, -232], [sx * 34, 46, -262], [sx * 40, 36, -310], [sx * 34, 22, -340], [sx * 22, 14, -352]], 3.4, { radial: 8 }));
  }

  // ---- the cell (its own frame: y up, origin at the centre of its top) ----
  const C = CELL;
  put('mag', 'cell', plan(outline([[-C.hx, -C.hz, 4], [C.hx, -C.hz, 4], [C.hx, C.hz, 4], [-C.hx, C.hz, 4]]), -C.h, -2, { b0: 2.5, b1: 1.2, segs: 2 }));
  put('mag', 'blue', plan(outline([[-C.hx - 0.4, -C.hz + 8, 4], [C.hx + 0.4, -C.hz + 8, 4], [C.hx + 0.4, C.hz - 8, 4], [-C.hx - 0.4, C.hz - 8, 4]]), -C.h + 14, -C.h + 46));
  put('mag', 'mark', placeText(strokeText('HALE 24V CELL', { h: 4.4, sw: 0.46 }).soup, 'left', C.hx + 0.4, -30, -C.h + 32));
  for (const z of [-24, 24]) put('mag', 'copper', lathe([[0, -1], [5.4, -1], [5.4, 5], [4.4, 6], [0, 6]], { segs: 16, map: 'zxy' }).move(0, 0, z));
  put('mag', 'black', plan(outline([[-C.hx - 1.2, -C.hz - 1.2, 5], [C.hx + 1.2, -C.hz - 1.2, 5], [C.hx + 1.2, C.hz + 1.2, 5], [-C.hx - 1.2, C.hz + 1.2, 5]]), -C.h - 5, -C.h + 2, { b0: 2, b1: 1, segs: 2 }));
}

export function buildJumper(G, patch = (m) => m) {
  const mats = G.mats, dry = { space: 'rest', shelter: 0.6 }, rest = { space: 'rest', shelter: 0.3 };
  const M = gunMats(G, patch, 231, {
    yellow: patch(mats.gunmetal({ finish: 'polymer', color: 0xb8921a, wear: 0.5, oil: 0.1, seed: 233, ...dry }), { occ: true, rough: [1.0, 0.5] }),
    red: patch(mats.gunmetal({ finish: 'polymer', color: 0x8e1c14, wear: 0.4, oil: 0.1, seed: 235, ...dry }), { occ: true, rough: [1.0, 0.5] }),
    blue: patch(mats.gunmetal({ finish: 'polymer', color: 0x1c3c6e, wear: 0.3, oil: 0.1, seed: 237, ...dry })),
    cell: patch(mats.gunmetal({ finish: 'polymer', color: 0x56585a, wear: 0.4, oil: 0.1, seed: 239, ...dry }), { rough: [1.0, 0.5] }),
    copper: patch(mats.chrome({ color: 0xb86a3a, roughness: 0.3, age: 0.3, dust: 0, ...rest })),
    lamp: patch(mats.emissive({ color: 0x38ff60, nits: 4 })),
  });
  const kit = modelKit(G, M, 'jumper');
  buildSoups((part, mat, soup) => kit.put(part, mat === 'ctrl' ? 'slide' : mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('bar');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  const magRest = new Matrix4().makeTranslation(MAG_AT[0] * MM, MAG_AT[1] * MM, MAG_AT[2] * MM);
  const magAxis = new Vector3(0, -1, 0);
  const _s = new Vector3(1, 1, 1);
  const mag = kit.part('mag'), spare = kit.copy('mag', 'spare');
  mag.userData.setRounds = () => {}; spare.userData.setRounds = () => {};
  spare.visible = false;

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    magRest.decompose(mag.position, mag.quaternion, _s);
    mag.position.addScaledVector(magAxis, state.magD);
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = lowerSdf(x, y, z, o, LOWER_L);
    d = Math.min(d, bx(x, y, z, 0, 15, -118, HW + 2, 32, 118, 6), cylZ(x, y, z, 12, 28, -344, -236), bx(x, y, z, 0, -21, -293, 22, 13, 55, 8));
    d = Math.min(d, bx(x, y + state.magD / MM, z, 0, MAG_AT[1] - CELL.h / 2, MAG_AT[2], CELL.hx + 1.2, CELL.h / 2 + 3, CELL.hz + 1.2, 3));
    return d;
  }

  const model = {
    id: 'jumper', cls: 'special', action: 'single', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: 0, lock: 0,
    flash: { size: 0, light: 0.9, fall: 12 }, // an arc, not powder: no flame at the clamps, a cold flicker on the pack
    mag, spare, casing: null, magRest, magAxis,
    // the cell stands on the palm, terminals up
    magInHand: new Matrix4().set(0, 0, -1, 0.002, 0, -1, 0, -0.11, -1, 0, 0, -0.062, 0, 0, 0, 1),
    spareHand: 'cup',
    magBox: { c: [2, -69, -62], h: [CELL.hz, CELL.h / 2, CELL.hx] },
    clip: { wellStart: 0.16, drop: 9 },
    casingSpin: 0,
    // Aiming: the eye is over the front of the pack, above where the carrying bar is (hidden then), and
    // the nose is tipped up so the gap between the clamps is on the axis: the picture is the coil running
    // away to the two clamps, the leads either side, a strip of the pack along the bottom edge.
    adsHide: [parts.bar],
    pose: { ads: 0.08, adsRot: [0.1765, 0, 0], hip: { pos: [0.18, -0.185, -0.23], rot: [0.04, 0.09, 0.08] }, kick: [1.6, 2.4, 0.2, 0.8, 1.2] },
    anchors: {
      muzzle: new Vector3(0, 0.012, TIP * MM),
      eject: new Vector3(0.03, 0.01, -0.12),
      grip: new Vector3(0, -0.06, -0.01),
      support: new Vector3(0, -0.03, -0.29),
      sight: new Vector3(0, 0.0639, -0.26), // on the line from the eye (y 78, z -180) to the gap between the clamps (y 30, z -452); the eye is `ads` behind it
      mag: new Vector3(MAG_AT[0], MAG_AT[1] - CELL.h, MAG_AT[2]).multiplyScalar(MM),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: HOLD_RIGHT,
      left: { at: [17, -37, -292], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -120], thumbPad: [-23.5, -12, -316], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {});
  return model;
}
