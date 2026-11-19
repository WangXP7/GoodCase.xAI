// The Hollis 12: an invented pump-action 12 gauge by "Cedar Fork Gun Works". Blued steel receiver
// and barrel, a tube magazine under the barrel, a ribbed walnut forend on twin action bars that
// travels 88 mm, walnut stock with a semi-pistol grip, an alloy trigger guard, a brass bead. The
// ejection port (right) is a real recess with the bolt in it; shells go in through the gate under
// the receiver, one at a time, and a red hull comes out of the port when the forend comes back.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, sdPoly, sdExtrude, MM, side, sect, plan, pinX, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';

const HW = 16.6; // half width of the receiver
const TUBE_Y = -26.5;
const PUMP = 88; // mm of forend travel
const BOLT = 62; // mm of bolt travel
const TRIG = { pivot: [-36, -40], face: [-40.6, -53.5], angle: -0.24, lift: 2.4 };
const RECV = outline([[-216, 16.5, 1.5], [-34, 17.5, 12], [-3, 10, 5], [0, -33, 3], [-6, -39.5, 2], [-212, -39.5, 2.5], [-216, -35, 1.5]]);
const PORT = outline([[-151, -4.5, 2.2], [-87, -4.5, 2.2], [-87, 12, 2.2], [-151, 12, 2.2]]);
const STOCK = outline([
  [-0.5, 15.2, 2], [34, 5, 26], [92, -7, 60], [336, -30, 7], [340, -132, 9], [150, -79, 40], [102, -87, 10], [86, -79, 8],
  [58, -53, 14], [30, -42, 10], [-0.5, -39.2, 2],
]);
const STOCK_HW = 15.6;
const GUARD = outline([
  [-70, -39.2], [-72.5, -52, 4], [-66, -66.5, 7], [-22, -66.5, 6], [-12.5, -56, 4], [-11, -39.2],
  [-16.5, -39.2], [-18, -55, 4], [-25, -60.6, 4], [-62, -60.6, 6], [-66.5, -52, 3], [-65, -39.2],
]);
const GUARD_HW = 6.2;
const TRIGGER = outline([[-39.6, -40.5], [-41, -47, 8], [-40.6, -55, 8], [-38, -59, 1.1], [-36, -58, 1], [-37, -52, 8], [-36.2, -46, 6], [-33, -42, 2], [-33, -37.5], [-39.6, -37.5]]);
const FOREND = outline([[-19.5, -3.5, 3], [-13.6, -3.5, 1.4], [-13.6, -12.4, 2], [13.6, -12.4, 2], [13.6, -3.5, 1.4], [19.5, -3.5, 3], [19.5, -34, 10], [9, -43.5, 8], [-9, -43.5, 8], [-19.5, -34, 10]]);
const FOREND_Z = [-472, -336];

// a shell in its own frame: axis on z, brass head toward +z, centred
function shellSoups(put, part) {
  put(part, 'hull', lathe([[0, -29], [7.8, -29], [10.05, -26.6], [10.05, 13.2], [0, 13.2]], { segs: 20 }));
  for (let i = 0; i < 6; i++) put(part, 'hull', new Soup().add(box(0, 4.4, -29.02, 0.5, 7.4, 0.1, 0.02), new Matrix4().makeRotationZ((i / 6) * Math.PI * 2)));
  put(part, 'brass', lathe([[10.15, 13], [10.15, 27.2], [11.15, 27.4], [11.15, 28.7], [10.5, 29], [3.2, 29], [3.2, 28.6], [0, 28.6]], { segs: 20 }));
}

function buildSoups(put) {
  // ---- receiver: left part solid, right slab with the port cut through it ----
  // (the top edges are rounded over far more than the flanks: a humped receiver, not a slab)
  const hump = (p) => (p[0] > -30 ? 3.4 : p[1] > 5 ? 2.5 : 1); // and the rear is boat-tailed into the stock's wrist
  put('recv', 'blued', side(RECV, -HW, 9, { b0: 2.6, segs: 4, f0: hump }));
  put('recv', 'blued', side(RECV, 9, HW, { holes: [PORT], b1: 2.6, segs: 4, hb: 0.25, f1: hump }));
  put('recv', 'black', box(8.6, 3.75, -119, 1, 17.5, 65, 0.1));
  // matte sighting groove along the top, loading gate and shell lifter underneath
  for (let i = 0; i < 5; i++) put('recv', 'blued', box(-3.2 + i * 1.6, 17.45, -120, 0.7, 0.5, 150, 0.18));
  put('recv', 'black', box(0, -39.3, -111, 20.5, 0.7, 80, 0.1));
  // tang safety on the hump's rear slope: a ribbed steel slider in a milled slot, a red dot ahead of it
  put('recv', 'black', new Soup().add(box(0, 0, 0, 7.6, 0.5, 15, 0.15), new Matrix4().makeTranslation(0, 14.35, -17.5).multiply(new Matrix4().makeRotationX(0.236))));
  for (let i = 0; i < 4; i++) put('recv', 'steel', new Soup().add(box(0, 0.7, -1.2 + i * 1.5, 5.6, 1.5, 0.9, 0.3), new Matrix4().makeTranslation(0, 14.1, -15).multiply(new Matrix4().makeRotationX(0.236))));
  put('recv', 'hull', new Soup().add(lathe([[0, 0.2], [1.3, 0.2], [1.3, 0.55], [0, 0.55]], { segs: 12, map: 'zxy' }), new Matrix4().makeTranslation(0, 15.55, -23.2).multiply(new Matrix4().makeRotationX(0.236))));
  put('recv', 'steel', plan(outline([[-9.4, -148, 2], [9.4, -148, 2], [9.4, -76, 4], [-9.4, -76, 4]]), -40.1, -39.3, { b0: 0.5 }));
  for (const [z, y, r] of [[-58, -22, 2.1], [-118, -30, 2.1], [-196, -8, 1.6]]) put('recv', 'steel', pinX(z, y, r, -HW - 0.25, HW + 0.25));
  put('recv', 'steel', pinX(-13.5, -46.5, 2.7, -GUARD_HW - 1.6, GUARD_HW + 1.6, 0.5)); // cross-bolt safety
  put('recv', 'black', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 1.6, b1: 1.6, segs: 2 }));
  put('recv', 'black', side(outline([[-74, -39.3], [-8, -39.3], [-8, -43.5, 2], [-74, -43.5, 2]]), -9.5, 9.5, { b0: 1, b1: 1 }));
  put('recv', 'mark', placeText(strokeText('HOLLIS 12', { h: 5.2, sw: 0.5 }).soup, 'left', HW, -204, -8));
  put('recv', 'mark', placeText(strokeText('CEDAR FORK GUN WORKS', { h: 2.4, sw: 0.28 }).soup, 'left', HW, -204, -14));
  put('recv', 'mark', placeText(strokeText('12 GA 3 IN', { h: 3, sw: 0.32 }).soup, 'right', HW, -64, -14));
  put('recv', 'mark', placeText(strokeText('CF 618204', { h: 2.2, sw: 0.26 }).soup, 'right', HW, -64, -19.5));

  // ---- barrel, magazine tube, clamp, bead ----
  put('recv', 'blued', lathe([[9.3, -640], [9.3, -689], [10, -690.2], [10.9, -690.2], [11.6, -689.4], [11.6, -219], [12.6, -218], [12.6, -216], [0, -216]], { segs: 36 }));
  put('recv', 'black', lathe([[0, -640], [9.3, -640]], { segs: 24 }));
  put('recv', 'blued', lathe([[0, -600], [11.8, -600], [11.8, -216], [0, -216]], { segs: 32 }).move(0, TUBE_Y, 0));
  put('recv', 'steel', lathe([[0, -619], [10.6, -619], [12.7, -616.5], [12.7, -601], [11.9, -600], [0, -600]], { segs: 32 }).move(0, TUBE_Y, 0));
  for (let i = 0; i < 16; i++) put('recv', 'steel', new Soup().add(box(0, 12.75, -608.5, 1.3, 0.5, 13, 0.15), new Matrix4().makeRotationZ((i / 16) * Math.PI * 2)).move(0, TUBE_Y, 0));
  put('recv', 'blued', sect(outline([[-13.6, -40.4, 12.5], [13.6, -40.4, 12.5], [13.6, 13.6, 12.5], [-13.6, 13.6, 12.5]]), -566, -557, { b0: 1.2, b1: 1.2, segs: 2 }));
  put('recv', 'steel', pinX(-561.5, -13.3, 2.4, -14.4, 14.4, 0.4));
  // sighting rib: a matte strip on posts the length of the barrel, a brass bead at its end
  put('recv', 'blued', sect(outline([[-3.9, 13.4, 0.5], [3.9, 13.4, 0.5], [3.9, 15.2, 0.4], [-3.9, 15.2, 0.4]]), -688, -214, { b0: 1, b1: 0.6 }));
  for (let z = -676; z < -220; z += 57) put('recv', 'blued', box(0, 12.4, z, 3.4, 2.6, 12, 0.5));
  for (let i = 0; i < 3; i++) put('recv', 'black', box(-1.9 + i * 1.9, 15.25, -451, 0.8, 0.3, 466, 0.1));
  put('recv', 'brass', lathe([[0, 14.8], [1.5, 14.8], [1.5, 17.2], [2.6, 17.9], [3.1, 19.2], [2.6, 20.6], [1.5, 21.2], [0, 21.2]], { segs: 16, map: 'zxy' }).move(0, 0, -680));

  // ---- stock ----
  put('stock', 'wood', side(STOCK, -STOCK_HW, STOCK_HW, { b0: 6.8, b1: 6.8, segs: 4, f0: (p) => (p[0] < 1 ? 0.3 : 1), f1: (p) => (p[0] < 1 ? 0.3 : 1), user: 'grip' }));
  put('stock', 'black', side(outline([[338.5, -29, 3], [352, -31, 5], [354, -130, 5], [341.5, -133.5, 3]]), -STOCK_HW, STOCK_HW, { b0: 4, b1: 4, segs: 2 }));
  put('stock', 'steel', side(outline([[84, -80.2, 2], [102, -88.4, 2], [103, -90.4, 1], [84, -82.2, 1]]), -9, 9, { b0: 1, b1: 1 })); // grip cap

  // ---- bolt (shows in the port), trigger ----
  put('bolt', 'steel', box(12.5, 3.75, -119, 5.8, 15.6, 63, 0.7));
  put('bolt', 'black', box(15.3, 7.5, -100, 0.5, 2.2, 16, 0.2)); // extractor
  put('trigger', 'steel', side(TRIGGER, -3.4, 3.4, { b0: 1, b1: 1, segs: 2 }));

  // ---- forend on its action bars ----
  const [f0, f1] = FOREND_Z;
  const core = FOREND.map((p) => [p[0] * 0.93, TUBE_Y + 3 + (p[1] - TUBE_Y - 3) * 0.93]);
  put('forend', 'wood', sect(core, f0 + 1, f1 - 1));
  const n = 10, pitch = (f1 - f0) / n;
  for (let i = 0; i < n; i++) put('forend', 'wood', sect(FOREND, f0 + i * pitch, f0 + (i + 1) * pitch - 3.2, { b0: 1.5, b1: 1.5, segs: 2 }));
  put('forend', 'steel', lathe([[12.4, f0 - 3], [14.4, f0 - 3], [15.2, f0 - 2], [15.2, f0 + 1.2], [12.4, f0 + 1.2]], { segs: 28, closed: true }).move(0, TUBE_Y, 0));
  for (const sx of [-1, 1]) put('forend', 'steel', box(sx * 12.9, TUBE_Y + 1, (f1 - 214) / 2, 1.5, 8.5, -214 - f1, 0.3));

  // ---- attachments: a reflex sight on the receiver, a ported brake, a two-shell tube extension ----
  const rs = reflexSight(-128, 17.3, 41);
  put('att_sight', 'black', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'black', lathe([[9.6, -742], [13, -742], [14.2, -740.6], [14.2, -686], [12.6, -684], [11.7, -684], [11.7, -690], [9.6, -690]], { segs: 28, closed: true }));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) put('att_suppressor', 'blued', box(sx * 14, 2, -702 - i * 12, 1, 9, 6.4, 0.6));
  put('att_mag', 'blued', lathe([[0, -688], [11.8, -688], [11.8, -612], [0, -612]], { segs: 32 }).move(0, TUBE_Y, 0));
  put('att_mag', 'steel', lathe([[0, -700], [10.6, -700], [12.7, -697.5], [12.7, -688.5], [11.9, -687.5], [0, -687.5]], { segs: 32 }).move(0, TUBE_Y, 0));
  put('att_mag', 'blued', sect(outline([[-13.6, -40.4, 12.5], [13.6, -40.4, 12.5], [13.6, 13.6, 12.5], [-13.6, 13.6, 12.5]]), -668, -660, { b0: 1.2, b1: 1.2, segs: 2 }));
  shellSoups(put, 'shell');
}

export function buildPumpShotgun(G, patch = (m) => m) {
  const mats = G.mats;
  const rest = { space: 'rest', shelter: 0.3 };
  const M = {
    blued: patch(mats.gunmetal({ finish: 'blued', wear: 0.36, oil: 0.35, seed: 71, ...rest }), { occ: true, rough: [1, 0.16] }),
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.3, oil: 0.3, seed: 73, ...rest }), { occ: true }),
    wood: patch(mats.gunmetal({ finish: 'wood', color: 0x4a2a18, wear: 0.34, oil: 0.3, brushDir: [0, 0.05, 1], seed: 77, space: 'rest', shelter: 0.8 }), { occ: true, rough: [1.15, 0.5] }),
    black: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.3, oil: 0.1, seed: 79, ...rest }), { occ: true, albedo: 0.4 }),
    mark: patch(mats.gunmetal({ finish: 'bare', wear: 0, oil: 0, seed: 9, ...rest })),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.22, age: 0.15, dust: 0, ...rest })),
    dot: patch(mats.emissive({ color: 0xff2a14, nits: 3 })),
    hull: patch(mats.gunmetal({ finish: 'polymer', color: 0xa5201a, wear: 0.12, oil: 0.1, seed: 83, space: 'rest', shelter: 0.5 }), { rough: [0.8, 0.3] }),
  };
  const kit = modelKit(G, M, 'pump');
  buildSoups(kit.put);
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('stock');
  kit.part('bolt');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  kit.part('forend');
  kit.part('att_sight'); kit.part('att_suppressor'); kit.part('att_mag');
  // one shell geometry, three uses: the one the hand feeds, the one being ejected, and `mag` (the
  // rig's slot for "what is in the gun": nothing to show on a tube magazine)
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

  const state = { trigger: 0, hammer: 1, pump: 0, slide: 0, stop: 0, magRelease: 0, magD: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.forend.position.z = PUMP * MM * state.pump;
    parts.bolt.position.z = BOLT * MM * Math.min(1, state.pump * 1.25);
    mag.visible = false;
  }
  set();

  const bx = (x, y, z, cx, cy, cz, hx, hy, hz, r = 0) => { const ax = Math.abs(x - cx) - hx + r, ay = Math.abs(y - cy) - hy + r, az = Math.abs(z - cz) - hz + r; return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) - r; };
  const cyl = (x, y, z, cy, r, z0, z1) => { const a = Math.hypot(x, y - cy) - r, b = Math.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2; return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)); };
  function sdf(x, y, z, o = {}) {
    let d = sdExtrude(sdPoly(STOCK, z, y) + 6.5, x, STOCK_HW - 6.5) - 6.5;
    d = Math.min(d, sdExtrude(sdPoly(RECV, z, y) + 2.4, x, HW - 2.4) - 2.4);
    d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 1.5, x, GUARD_HW - 1.5) - 1.5);
    d = Math.min(d, cyl(x, y, z, 0, 11.6, -690, -216), cyl(x, y, z, TUBE_Y, 11.8, -619, -216));
    const pz = PUMP * (o.pump ?? state.pump);
    d = Math.min(d, bx(x, y, z - pz, 0, -23.5, (FOREND_Z[0] + FOREND_Z[1]) / 2, 19.5, 20, (FOREND_Z[1] - FOREND_Z[0]) / 2, 8));
    if (!o.noTrigger) {
      const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.4));
    }
    return d;
  }

  const shift = new Vector3();
  const model = {
    id: 'pump', cls: 'shotgun', action: 'pump', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: 0, lock: 0,
    mag, spare, casing,
    // a shell on its way through the gate: seated it lies in the tube's mouth, nose forward
    magRest: new Matrix4().makeTranslation(0, -0.03, -0.118),
    magAxis: new Vector3(0, -0.5, 0.866),
    // lying across the first two fingertips under the thumb, brass toward the wrist, the hand palm-up under the gate
    magInHand: new Matrix4().set(-1, 0, 0, 0.012, 0, -1, 0, -0.04, 0, 0, 1, -0.122, 0, 0, 0, 1),
    spareHand: 'pinch',
    casingSpin: 14, // rad/s
    supportShift: () => shift.set(0, 0, PUMP * MM * state.pump), // the support hand rides the forend
    // Aiming, the eye is over the front of the receiver, a finger's width above the rib: the picture
    // is the rib running out to the bead, with the fore-end and the hand on it below. The stock and
    // the firing hand are behind that eye.
    adsHide: [parts.stock], adsHideHand: true,
    anchors: {
      muzzle: new Vector3(0, 0, -0.6902),
      eject: new Vector3(0.0175, 0.004, -0.112),
      grip: new Vector3(0, -0.06, 0.05),
      support: new Vector3(0, -0.04, -0.404),
      sight: new Vector3(0, 0.0291, -0.28), // a point on the line from the eye to the bead's top (rig.js tips the muzzle up 0.02 to put the bead on the axis); the eye is `ads` behind it
      mag: new Vector3(0, -0.04, -0.112),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: { at: [22.5, -62, 42], back: [-0.22, 0.4, 0.89], thumb: [0, 0.95, -0.3], elbow: [150, -230, 380], thumbKnuckle: [-13, 4, 46], thumbPad: [-17.5, -9, 22], cup: -0.1 },
      // the forend lies in the palm: knuckles under its far edge, the wrist out to the near side and level with it, the thumb up the near face
      left: { at: [16, -46, -396], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -160], thumbPad: [-20, -16, -420], cup: 0.2 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, 0.0432, -0.02) } }, // on the line through the dot (41 mm up at z -128), back where the eye is to sit
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.742) } }, // a 12 gauge takes a brake, not a can
    mag: { parts: [parts.att_mag] },
  });
  return model;
}
