// The Roadflare: a break-open launcher for highway flares, the kind a recovery truck carries. A
// polymer frame with a pistol grip, a short fat steel barrel painted safety orange that hinges at
// the front of the frame and tips its breech up to load, a standing breech with a spur hammer, a
// bead and a notch. One flare cartridge at a time: red card tube, brass base.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the standing breech. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, strokeText, MM, side, sect, pinX, placeText, modelKit, fitments } from '../geo.js';
import { upgradeFinish } from './upgrade.js';
import { gunMats, lowerSoups, lowerSdf, bx, cylZ, TRIG, HOLD_RIGHT } from './rifle.js';
import { LOWER_L } from './lmg.js';

const R = 21, BORE = 17.4;
const BREECH_Z = -42, MUZZLE = -306;
const PIVOT = [0, -13, -206];
const OPEN = 0.3; // radians the barrel tips
const SIGHT_Y = 37; // a tall bead and notch: the breech and the hands sit well under the line

function buildSoups(put) {
  lowerSoups(put, { lower: LOWER_L });
  // standing breech with its recoil shield, firing-pin bush and latch lever
  put('recv', 'slide', side(outline([[BREECH_Z, 26, 6], [-16, 26, 10], [0, 4, 6], [0, -16, 2], [BREECH_Z, -16, 1]]), -17, 17, { b0: 6, b1: 6, segs: 4 })); // its rear falls away in a slope: it faces the aiming eye
  put('recv', 'steel', lathe([[0, BREECH_Z - 0.6], [5, BREECH_Z - 0.6], [5, BREECH_Z + 1], [0, BREECH_Z + 1]], { segs: 16 }));
  put('recv', 'slide', side(outline([[-34, 25, 1], [-18, 25, 1], [-13, 29, 2], [-16, 31.5, 2], [-34, 28.5, 2]]), 11, 15.5, { b0: 1, b1: 1 }));
  for (const sx of [-1, 1]) put('recv', 'slide', side(outline([[-30, 25], [-18, 25], [-18, SIGHT_Y + 1.6, 1.2], [-21, SIGHT_Y + 1.6, 1.2], [-30, 29, 2]]), sx * 6.4 - 2, sx * 6.4 + 2, { b0: 0.5, b1: 0.5 })); // the notch: two ears
  put('recv', 'slide', box(0, 27.5, -22, 16.8, 5, 8, 0.8)); // and the leaf they stand on
  put('recv', 'mark', placeText(strokeText('ROADFLARE', { h: 5, sw: 0.5 }).soup, 'left', LOWER_L ? 14.4 : 14, -150, -21));
  put('recv', 'mark', placeText(strokeText('HALE SAFETY SUPPLY  37 MM', { h: 2.2, sw: 0.26 }).soup, 'left', 14.4, -150, -25.4));
  // hinge lugs at the front of the frame
  for (const sx of [-1, 1]) put('recv', 'slide', side(outline([[-222, -24, 4], [-190, -24, 4], [-190, -8, 6], [-222, -8, 6]]), sx * 13 - 3, sx * 13 + 3, { b0: 1, b1: 1 }));
  put('recv', 'steel', pinX(PIVOT[2], PIVOT[1], 3.6, -17, 17, 0.6));
  // spur hammer (its own part)
  put('hammer', 'slide', side(outline([[-10, 8, 2], [-2, 8, 2], [5, 17, 2], [11, 18, 2], [10, 22, 1.5], [0, 22, 3], [-10, 16, 3]]), -3.6, 3.6, { b0: 1.2, b1: 1.2, segs: 2 })); // low and dark: cocked, its spur stays under the notch

  // ---- barrel (its own part, about the hinge pin): orange tube, steel breech ring and muzzle band, bead, under-lug ----
  put('barrel', 'orange', lathe([[BORE, MUZZLE], [R - 0.6, MUZZLE], [R, MUZZLE + 0.8], [R, BREECH_Z - 12], [BORE, BREECH_Z - 12]], { segs: 36, closed: true }));
  put('barrel', 'steel', lathe([[BORE, BREECH_Z - 12], [R + 1.6, BREECH_Z - 12], [R + 1.6, BREECH_Z - 1.2], [R + 0.8, BREECH_Z], [BORE + 1.6, BREECH_Z], [BORE, BREECH_Z - 1.4]], { segs: 36, closed: true }));
  put('barrel', 'steel', lathe([[R + 0.1, MUZZLE + 6], [R + 1.6, MUZZLE + 6], [R + 1.6, MUZZLE + 20], [R + 0.1, MUZZLE + 20]], { segs: 36, closed: true }));
  put('barrel', 'black', lathe([[0, BREECH_Z - 150], [BORE, BREECH_Z - 150]], { segs: 24 }));
  for (let i = 0; i < 3; i++) put('barrel', 'black', lathe([[R + 0.05, -120 - i * 9], [R + 0.5, -120 - i * 9], [R + 0.5, -116 - i * 9], [R + 0.05, -116 - i * 9]], { segs: 36, closed: true }));
  put('barrel', 'white', lathe([[0, R], [1.6, R], [1.6, R + 9.6], [2.6, R + 10.8], [3.1, R + 12.6], [2.6, R + 14.6], [1.4, R + 15.6], [0, R + 16]], { segs: 16, map: 'zxy' }).move(0, 0, MUZZLE + 13));
  put('barrel', 'slide', side(outline([[-232, -R + 2], [-170, -R + 2], [-180, -22, 4], [-196, -26, 6], [-216, -26, 6], [-228, -22, 4]]), -9.6, 9.6, { b0: 1.5, b1: 1.5, segs: 2 }));
  put('barrel', 'slide', side(outline([[-78, -R + 2], [BREECH_Z - 2, -R + 2], [BREECH_Z - 4, -R - 5, 2], [-74, -R - 5, 2]]), -6, 6, { b0: 1, b1: 1 })); // locking lug
  put('barrel', 'polymer', sect(outline([[-17, -R + 6, 2], [17, -R + 6, 2], [18, -30, 8], [9, -40, 7], [-9, -40, 7], [-18, -30, 8]]), -300, -236, { b0: 3, b1: 3, segs: 2 }));
  put('barrel', 'mark', placeText(strokeText('POINT AWAY FROM FACE', { h: 3, sw: 0.34 }).soup, 'top', R, -44, -70));

  // ---- the flare cartridge (its own frame: axis on z, base at the origin, nose toward -z) ----
  put('mag', 'hull', lathe([[0, -118], [13, -118], [16.6, -113], [16.6, -14], [0, -14]], { segs: 24 }));
  put('mag', 'brass', lathe([[16.7, -14.5], [16.7, -1.6], [18.4, -1.4], [18.4, 0], [5, 0], [5, -0.5], [0, -0.5]], { segs: 24 }));
  put('mag', 'white', lathe([[16.7, -70], [16.8, -70], [16.8, -44], [16.7, -44]], { segs: 24, closed: true }));
  put('mag', 'black', lathe([[0, -118.2], [9, -118.2]], { segs: 16 }));
}

export function buildFlareGun(G, patch = (m) => m) {
  const mats = G.mats, dry = { space: 'rest', shelter: 0.6 };
  const M = gunMats(G, patch, 251, {
    orange: patch(mats.gunmetal({ finish: 'polymer', color: 0xc8480e, wear: 0.55, oil: 0.1, seed: 253, ...dry }), { occ: true, rough: [0.9, 0.4] }),
    hull: patch(mats.gunmetal({ finish: 'polymer', color: 0xa5201a, wear: 0.12, oil: 0.1, seed: 255, ...dry }), { rough: [0.8, 0.3] }),
  });
  const kit = modelKit(G, M, 'flare');
  buildSoups((part, mat, soup) => kit.put(part, mat === 'ctrl' ? 'slide' : mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('barrel', PIVOT);
  kit.part('hammer', [0, 8, -6]);
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  // the cartridge in the opened barrel's breech: where it rests while loading, and the way out of it
  const magRest = new Matrix4().makeTranslation(PIVOT[0] * MM, PIVOT[1] * MM, PIVOT[2] * MM)
    .multiply(new Matrix4().makeRotationX(-OPEN))
    .multiply(new Matrix4().makeTranslation(0, -PIVOT[1] * MM, (BREECH_Z - PIVOT[2]) * MM));
  const magAxis = new Vector3(0, Math.sin(OPEN), Math.cos(OPEN));
  const _s = new Vector3(1, 1, 1);
  const mag = kit.part('mag'), spare = kit.copy('mag', 'spare');
  mag.userData.setRounds = () => {}; spare.userData.setRounds = () => {};
  spare.visible = false;

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0, hinge: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.hammer.rotation.x = 0.7 * state.hammer;
    parts.barrel.rotation.x = -OPEN * state.hinge;
    if (state.hinge < 0.5) { mag.position.set(0, 0, BREECH_Z * MM); mag.quaternion.identity(); } // shut: in the chamber, out of sight
    else { magRest.decompose(mag.position, mag.quaternion, _s); mag.position.addScaledVector(magAxis, state.magD); }
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = lowerSdf(x, y, z, o, LOWER_L);
    d = Math.min(d, bx(x, y, z, 0, 5, -21, 19, 21, 21, 4), cylZ(x, y, z, 0, R + 1, MUZZLE, BREECH_Z), bx(x, y, z, 0, -27, -268, 18, 13, 32, 7));
    return d;
  }

  const model = {
    id: 'flare', cls: 'special', action: 'single', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: 0, lock: 0,
    mag, spare, casing: null, magRest, magAxis,
    // held like a shell, between the thumb and the first two fingers, brass toward the wrist
    magInHand: new Matrix4().set(-1, 0, 0, 0.012, 0, -1, 0, -0.046, 0, 0, 1, -0.07, 0, 0, 0, 1),
    spareHand: 'pinch',
    // the barrel breaks open for the whole of the load; the spent cartridge slides out the back of it
    clip: {
      tracks: { hinge: [[0.06, 0], [0.2, 1, 'out'], [1.22, 1], [1.34, 0, 'in']] }, wellStart: 0.15, drop: 5,
      spare: [[0.84, 0.15], [0.94, 0.08, 'io'], [0.98, 0.06], [1.05, 0, 'in3']],
    },
    casingSpin: 0,
    pose: { ads: 0.27, kick: [1.8, 5.5, 0.3, 1.0, 1.4] },
    anchors: {
      muzzle: new Vector3(0, 0, MUZZLE * MM),
      eject: new Vector3(0.02, 0.01, -0.04),
      grip: new Vector3(0, -0.06, -0.01),
      support: new Vector3(0, -0.035, -0.268),
      sight: new Vector3(0, SIGHT_Y * MM, -0.02),
      mag: new Vector3(0, 0.03, -0.02),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: HOLD_RIGHT,
      left: { at: [14, -43, -264], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -120], thumbPad: [-19.5, -18, -284], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {});
  return model;
}
