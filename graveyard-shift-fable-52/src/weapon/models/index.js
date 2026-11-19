// Weapon id -> first-person model builder.
//
// A builder is `build<Id>(G, patch) -> model`. `patch(material, opts)` is the viewmodel's material
// hook (projection, flash light, contact darkening; opts in viewmodel.js): every material on the
// model goes through it. Geometry comes from ../geo.js (modelKit) in millimetres. The model:
//
//   id, cls            weapon id and its class in rig.js POSES ('pistol', 'revolver', 'shotgun', 'smg', ...)
//   action             'slide' | 'bolt' | 'pump' | 'revolver' | 'single' (rig.js ACTIONS)
//   root, parts, meshes, materials, triangles
//   state, set()       moving parts. The rig writes state then calls set(). Names it writes for every
//                      model: slide (metres the slide or bolt is back), trigger 0..1, hammer 0..1
//                      (1 cocked), stop 0..1, magRelease 0..1, magD (metres the magazine is out of
//                      its seat). By action: pump 0..1 (forend back), cyl (chambers the cylinder has
//                      turned). A reload clip's `tracks` write any other name (crane, rod, cover).
//   travel, lock       metres the slide or bolt runs on a shot, and where it stays when held open
//   anchors            { muzzle, eject, grip (recoil pivots here), support, sight (rear sight: put on
//                      the view axis when aiming), mag } in model space, metres
//   hold               grip landmarks for the hands' solver (millimetres, see pistolModel.js):
//                      { right, left, trigger: { pivot: [z, y], face: [z, y], angle, lift }, twoHand }
//   sdf(x, y, z, o)    signed distance to the gun in mm (o.noTrigger, o.trigger 0..1)
//   mag, spare         Object3Ds under root with userData.setRounds(n): what leaves on a reload and
//                      what the support hand brings (a magazine, six rounds on a loader, one shell)
//   magRest, magAxis   Matrix4 of the seated magazine while reloading, and the unit vector out of its seat
//   magInHand          Matrix4: magazine space -> left-hand space;  spareHand: the hand pose that
//                      carries it ('mag' | 'cup' | 'pinch')
//   casing, casingSpin an Object3D (a spent case or hull, axis on z) the rig throws from `eject` and
//                      its tumble in rad/s; null when nothing leaves on a shot
//   supportShift()     optional: Vector3 (metres, model space) added to the support grip (a forend)
//   adsHide            optional: Object3Ds hidden while aiming (what would run through the eye)
//   pose, clip         optional overrides of rig.js POSES[cls] and of the reload clip's fields
//   finish(upgraded), attach(kind, on) -> bool
import { buildPistol } from '../pistolModel.js';
import { buildRevolver } from './revolver.js';
import { buildPumpShotgun } from './pumpShotgun.js';
import { buildSmg } from './smg.js';
import { buildSemiShotgun } from './semiShotgun.js';
import { buildRifle } from './rifle.js';
import { buildBattleRifle } from './battleRifle.js';
import { buildLmg } from './lmg.js';
import { buildJumper } from './jumper.js';
import { buildFlareGun } from './flareGun.js';
import { buildKnife } from './knife.js';
import { buildAxe } from './axe.js';
import { buildThrowProps, throwMats } from './throwProps.js';

// A null builder is a placeholder that has not been replaced yet: the pistol stands in.
export const MODELS = {
  pistol: buildPistol,
  revolver: buildRevolver,
  pump: buildPumpShotgun,
  smg: buildSmg,
  autoShotgun: buildSemiShotgun,
  rifle: buildRifle,
  battleRifle: buildBattleRifle,
  lmg: buildLmg,
  jumper: buildJumper,
  flare: buildFlareGun,
  knife: buildKnife,
  axe: buildAxe,
};
export const STAND_IN = 'pistol';
export const hasModel = (id) => typeof MODELS[id] === 'function';

// What the off hand holds for a swing or a throw, in LEFT-HAND space (mm: +x out past the thumb,
// -y out of the palm, -z along the fingers; a handle lies across the palm at HELD): the knife and
// the axe (knife.js, axe.js) and the three throwables (throwProps.js).
// Returns { knife, axe, frag, molotov, decoy }: Object3Ds (hidden, placed by the view), `grips`: for
// each, what the fist closes round as a box for arms.solveCarry, and `grip` (the knife's).
export function buildHandProps(G, patch = (m) => m) {
  const out = { meshes: [], grips: {} };
  const M = throwMats(G, patch);
  for (const [n, b] of [['knife', buildKnife], ['axe', buildAxe]]) { const p = b(G, patch, M); out[n] = p.object; out.grips[n] = p.grip; out.meshes.push(...p.meshes); }
  const T = buildThrowProps(G, patch, M);
  for (const n of ['frag', 'molotov', 'decoy']) { out[n] = T[n].object; out.grips[n] = T[n].grip; }
  out.meshes.push(...T.meshes);
  out.grip = out.grips.knife;
  return out;
}
