// The Calder 556: an invented 5.56 carbine by "Calder Arms". A forged-looking upper with a flat
// railed top on a polymer lower, a round ribbed handguard behind a tower front sight, a fixed
// polymer stock on a buffer tube, a curved thirty-round magazine. The bolt carrier shows in the
// port on the right; its handle rides a slot in the left flank.
//
// This file also holds what the other long guns share (the pistol-grip lower,
// the material set, sdf helpers): battleRifle.js, lmg.js, jumper.js and flareGun.js import them.
//
// Model space (metres): bore axis is z, muzzle toward -z, +y up, +x the shooter's right; z = 0 is
// the rear face of the receiver. Authored in millimetres.
import { Vector3, Matrix4 } from 'three';
import { Soup, lathe, box, outline, circle, strokeText, sdPoly, sdExtrude, MM, side, sect, plan, pinX, discZ, rodZ, placeText, modelKit, fitments, reflexSight } from '../geo.js';
import { upgradeFinish } from './upgrade.js';

// ---- shared: a polymer lower with a pistol grip, trigger guard and a magazine well ----------------
export const LOW_HW = 14.4;
export const TRIG = { pivot: [-60, -27], face: [-64.6, -44], angle: -0.22, lift: 2.6 };
export const LOWER = outline([
  [-196, -15.5], [-3, -15.5, 2], [6.5, -40, 30], [20, -80, 60], [27, -111, 3.2], [-14.5, -124.5, 2.6], [-31, -70, 30], [-36.5, -50, 6], [-39, -27, 3],
  [-116, -27, 2], [-118, -53, 2.5], [-158, -53, 2.5], [-160, -27, 2], [-190, -27, 3], [-196, -21, 2],
]);
export const PANEL = outline([[-33, -45, 3], [-1, -45, 3], [12, -82, 14], [19.6, -106.5, 3], [-14, -117.5, 3], [-29.5, -68, 8]]);
export const GUARD = outline([
  [-112, -26.6], [-113.5, -45, 3], [-108, -62.5, 6.5], [-48, -62.5, 5], [-40.5, -56, 3], [-38.6, -45], [-38.6, -26.6],
  [-44, -26.6], [-44.6, -51, 4], [-50, -56.8, 3], [-101, -56.8, 6], [-106.4, -45, 3], [-106, -26.6],
]);
export const GUARD_HW = 7;
export const TRIGGER = outline([
  [-63.6, -28.5], [-65.4, -36, 12], [-66, -42, 12], [-65, -48, 10], [-62.4, -52.2, 1.2], [-60.2, -51.2, 1], [-61.6, -45.5, 10],
  [-62, -40, 12], [-61, -34, 10], [-57.5, -30.5, 3], [-57.5, -24.5], [-63.6, -24.5],
]);
// the firing hand on that grip (millimetres; see pistolModel.js for the fields)
export const HOLD_RIGHT = { at: [28, -74.5, -27], back: [-0.24, 0.3, 0.92], thumb: [0, 0.95, -0.31], elbow: [150, -210, 330], thumbKnuckle: [-23, -28, 0], thumbPad: [-21, -21, -40], cup: -0.15 };

// the lower's soups: housing, guard, studded panels, selector, pins, trigger. `lower` names the
// profile (a gun with no magazine well passes its own).
export function lowerSoups(put, o = {}) {
  const prof = o.lower || LOWER;
  put('recv', 'polymer', side(prof, -LOW_HW, LOW_HW, { b0: 2.3, b1: 2.3, segs: 3 }));
  put('recv', 'polymer', side(GUARD, -GUARD_HW, GUARD_HW, { b0: 2.1, b1: 2.1, segs: 3 }));
  put('recv', 'panel', side(PANEL, LOW_HW - 0.2, LOW_HW + 1.7, { b1: 1.0, segs: 2, user: 'grip' }));
  put('recv', 'panel', side(PANEL, -LOW_HW - 1.7, -LOW_HW + 0.2, { b0: 1.0, segs: 2, user: 'grip' }));
  put('recv', 'ctrl', pinX(-30, -21.5, 4.2, -LOW_HW - 2.6, -LOW_HW + 0.2, 0.5));
  put('recv', 'ctrl', side(outline([[-33, -19.5, 1], [-33, -23.5, 1], [-48, -22.8, 1.2], [-48.6, -20.4, 1.2]]), -LOW_HW - 3.6, -LOW_HW - 1.2, { b0: 0.5 }));
  for (const [z, y, r] of [[-60, -27, 1.6], [-12, -22, 1.6], [-108, -21, 1.6], [-170, -21, 1.6]]) put('recv', 'steel', pinX(z, y, r, -LOW_HW - 0.3, LOW_HW + 0.3));
  put('recv', 'mark', placeText(strokeText('S', { h: 2.2, sw: 0.26 }).soup, 'left', LOW_HW, -52.5, -19.6));
  put('recv', 'mark', placeText(strokeText('F', { h: 2.2, sw: 0.26 }).soup, 'left', LOW_HW, -46, -25.4));
  put('trigger', 'ctrl', side(TRIGGER, -3.5, 3.5, { b0: 1.1, b1: 1.1, segs: 2 }));
}
export const bx = (x, y, z, cx, cy, cz, hx, hy, hz, r = 0) => { const ax = Math.abs(x - cx) - hx + r, ay = Math.abs(y - cy) - hy + r, az = Math.abs(z - cz) - hz + r; return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) - r; };
export const cylZ = (x, y, z, cy, r, z0, z1) => { const a = Math.hypot(x, y - cy) - r, b = Math.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2; return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)); };
// signed distance (mm) to the lower and its trigger; o as in a model's sdf
export function lowerSdf(x, y, z, o = {}, prof = LOWER) {
  let d = sdExtrude(sdPoly(prof, z, y) + 2.2, x, LOW_HW - 2.2) - 2.2;
  if (y < -40 && z > -40) d = Math.min(d, sdExtrude(sdPoly(PANEL, z, y) + 1, x, LOW_HW + 1.7 - 1) - 1);
  d = Math.min(d, sdExtrude(sdPoly(GUARD, z, y) + 2, x, GUARD_HW - 2) - 2);
  if (!o.noTrigger) {
    const a = -TRIG.angle * (o.trigger || 0), dy = y - TRIG.pivot[1], dz = z - TRIG.pivot[0];
    const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
    d = Math.min(d, sdExtrude(sdPoly(TRIGGER, rz + TRIG.pivot[0], ry + TRIG.pivot[1]), x, 3.5));
  }
  return d;
}
// The materials every long gun here is made of. seed: where its wear patterns start; over: extra or
// replacement materials (already patched).
export function gunMats(G, patch, seed, over = {}) {
  const mats = G.mats;
  const rest = { space: 'rest', shelter: 0.3 }, dry = { space: 'rest', shelter: 0.7 };
  const steelFx = { occ: true, albedo: 0.5, rough: [0.62, 0.2] }, polyFx = { occ: true, rough: [1.25, 0.74] };
  return {
    slide: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.55, oil: 0.3, seed, ...rest }), steelFx),
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.28, oil: 0.3, seed: seed + 2, ...rest }), { occ: true }),
    mark: patch(mats.gunmetal({ finish: 'bare', wear: 0, oil: 0, seed: 9, ...rest })),
    black: patch(mats.gunmetal({ finish: 'phosphate', wear: 0, oil: 0, seed: 11, ...rest }), { albedo: 0.3 }),
    polymer: patch(mats.gunmetal({ finish: 'polymer', color: 0x26282a, wear: 0.34, oil: 0.12, seed: seed + 4, ...dry }), polyFx),
    panel: patch(mats.gunmetal({ finish: 'polymer', color: 0x232524, wear: 0.3, oil: 0.1, studPitch: 0.0023, seed: seed + 6, ...dry }), polyFx),
    mag: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.7, oil: 0.5, seed: seed + 8, ...rest }), { albedo: 0.6, rough: [0.7, 0.2] }),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.2, age: 0.12, dust: 0, ...rest })),
    bullet: patch(mats.chrome({ color: 0xb4744c, roughness: 0.28, age: 0.1, dust: 0, ...rest })),
    white: patch(mats.rubber({ color: 0xcfd2c8, roughness: 0.6, age: 0, dust: 0, ...rest })),
    dot: patch(mats.emissive({ color: 0xff2a14, nits: 3 })),
    ...over,
  };
}
// A rail: a strip along the top cut into lugs, from z0 back to z1 at height y (the strip's base).
export function railSoups(put, part, mat, y, z0, z1) {
  put(part, mat, box(0, y + 1.2, (z0 + z1) / 2, 15.6, 2.8, Math.abs(z1 - z0) + 4, 0.5));
  const n = Math.floor(Math.abs(z1 - z0) / 10.2);
  for (let i = 0; i < n; i++) put(part, mat, sect(outline([[-10.4, y + 2, 0.6], [10.4, y + 2, 0.6], [10.4, y + 4, 0.9, 1], [8.6, y + 6, 0.5, 1], [-8.6, y + 6, 0.5, 1], [-10.4, y + 4, 0.9, 1]]), z0 + i * 10.2, z0 + i * 10.2 + 6.2, { b0: 0.45, b1: 0.45 }));
}
// An aperture rear sight on a rail at z: a ghost ring between two ears, its centre at height yc.
export function apertureSoups(put, part, mat, z, yBase, yc) {
  // slim, because the eye is a hand's breadth behind it when aiming: a thin ring on a narrow stem, low wings
  put(part, mat, sect(circle(0, yc, 5, 32), z - 1.2, z + 1.2, { holes: [circle(0, yc, 3.7, 32)], b0: 0.3, b1: 0.3, hb: 0.4 }));
  put(part, mat, box(0, (yBase + yc - 4.6) / 2, z, 2, yc - 4.6 - yBase, 2.4, 0.3));
  for (const sx of [-1, 1]) put(part, mat, side(outline([[z - 8, yBase], [z + 8, yBase], [z + 8, yBase + 5, 2], [z + 3, yBase + 9.5, 2.5], [z - 2, yBase + 9.5, 2.5], [z - 8, yBase + 4, 3]]), sx * 9 - 0.8, sx * 9 + 0.8, { b0: 0.4, b1: 0.4 }));
  put(part, mat, box(0, yBase + 1.4, z, 19.6, 3.2, 16, 0.8));
  put(part, 'steel', pinX(z + 5, yBase + 5, 2.4, 9.6, 12.4, 0.5));
}
// a spent bottleneck case, axis on z, mouth toward -z, centred: r body radius, len overall
export function caseSoups(put, r, len) {
  const h = len / 2;
  put('casing', 'brass', lathe([[r * 0.72, -h], [r * 0.82, -h], [r * 0.82, -h + len * 0.16], [r, -h + len * 0.26], [r, h - 2.4], [r * 0.88, h - 2], [r * 0.88, h - 1.2], [r, h - 0.9], [r, h], [0, h]], { segs: 16 }));
  put('casing', 'black', discZ(0, 0, r * 0.7, -h + 2, -h + 2.1, 14));
}
// the magazine and its twin the support hand brings: Object3Ds whose top rounds show while n > 0
export function magPair(kit) {
  const make = (name) => {
    const g = name === 'mag' ? kit.part('mag') : kit.copy('mag', name);
    const top = g.children.filter((m) => m.userData.mat === 'brass' || m.userData.mat === 'bullet');
    g.userData.setRounds = (n) => { for (const r of top) r.visible = n > 0; };
    return g;
  };
  const mag = make('mag'), spare = make('spare');
  spare.visible = false;
  return { mag, spare };
}

// ---- the Calder 556 ---------------------------------------------------------------------------------
const HW = 15;
export const BOLT_TRAVEL = 0.07;
const MAG_AT = [0, -19, -147];
const MAG_LEN = 176;
// the shared lower with a longer well for the deeper magazine
const LOWER_R = outline([
  [-206, -15.5], [-3, -15.5, 2], [6.5, -40, 30], [20, -80, 60], [27, -111, 3.2], [-14.5, -124.5, 2.6], [-31, -70, 30], [-36.5, -50, 6], [-39, -27, 3],
  [-112, -27, 2], [-114, -53, 2.5], [-180, -53, 2.5], [-182, -27, 2], [-200, -27, 3], [-206, -21, 2],
]);
const SIGHT_Y = 40;
const DOT_Y = 47;
const RECV = outline([[-206, 20, 2], [-26, 20, 7], [0, 6, 3], [0, -16, 1.5], [-206, -16, 1.5]]);
const SLOT = outline([[-196, 5.0, 2.4], [-104, 5.0, 2.4], [-104, 10.2, 2.4], [-196, 10.2, 2.4]]);
const PORT = outline([[-152, -3, 2.2], [-98, -3, 2.2], [-98, 11, 2.2], [-152, 11, 2.2]]);
const STOCK = outline([[58, 15, 4], [228, 14, 5], [232, -84, 6], [212, -88, 4], [150, -46, 22], [70, -24, 8], [58, -20, 3]]);
const STOCK_HW = 13;
const HG_R = [22, 19.5]; // handguard radius at its rear and its front
const HG_Z = [-212, -404];

function buildSoups(put) {
  // ---- upper: left slab with the handle's slot, core, right slab with the port; the flanks' bevel grows toward the rear ----
  const tail = (p) => (p[0] > -30 ? 2.4 : 1);
  put('recv', 'slide', side(RECV, -HW, -8, { holes: [SLOT], b0: 3.2, segs: 3, hb: 0.2, f0: tail }));
  put('recv', 'slide', side(RECV, -8, 8));
  put('recv', 'slide', side(RECV, 8, HW, { holes: [PORT], b1: 3.2, segs: 3, hb: 0.2, f1: tail }));
  put('recv', 'black', box(-7.8, 7.6, -150, 0.6, 6, 94, 0.1)); put('recv', 'black', box(7.8, 4, -125, 0.6, 15, 55, 0.1));
  railSoups(put, 'recv', 'slide', 19, -200, -34); // stops under the rear sight's base: no lug stands behind it, facing the aiming eye
  // the case deflector behind the port, the forward assist under it, the dust cover hanging open below
  put('recv', 'slide', side(outline([[-96, 12, 1], [-82, 12, 3], [-86, -4, 3], [-96, -4, 1]]), HW - 0.5, HW + 6, { b1: 2.4, segs: 2 }));
  put('recv', 'slide', lathe([[0, HW - 1], [5.6, HW - 1], [5.6, HW + 9], [4.4, HW + 10.4], [0, HW + 10.4]], { segs: 18, map: 'yzx' }).move(0, -5, -62));
  put('recv', 'slide', new Soup().add(box(0, -8, 0, 1.2, 15, 56, 0.4), new Matrix4().makeTranslation(HW + 1.2, -4.6, -125).multiply(new Matrix4().makeRotationZ(0.5))));
  put('recv', 'steel', pinX(-125, -3.6, 1.5, HW - 0.4, HW + 1.6, 0.3));
  // rear cap and the pivot pins
  put('recv', 'slide', sect(outline([[-10, -13, 3], [10, -13, 3], [10, 3, 4], [-10, 3, 4]]), -0.6, 2.2, { b1: 1 }));
  for (const z of [-196, -22]) put('recv', 'steel', pinX(z, -10, 2.4, -HW - 0.5, HW + 0.5, 0.3));
  put('recv', 'mark', placeText(strokeText('CALDER 556', { h: 5, sw: 0.5 }).soup, 'left', HW, -100, -6));
  put('recv', 'mark', placeText(strokeText('CALDER ARMS  CAL 5.56', { h: 2.2, sw: 0.26 }).soup, 'left', HW, -100, -11.4));
  put('recv', 'mark', placeText(strokeText('CA 114026', { h: 2.6, sw: 0.3 }).soup, 'right', HW, -164, -11));
  apertureSoups(put, 'recv', 'slide', -22, 23.6, SIGHT_Y);

  // ---- lower, magazine catch ----
  lowerSoups(put, { lower: LOWER_R });
  put('recv', 'polymer', plan(outline([[-13.6, -182, 3], [13.6, -182, 3], [13.6, -112.5, 3], [-13.6, -112.5, 3]]), -57.5, -50.5, { holes: [outline([[-11.4, -178.5, 2], [11.4, -178.5, 2], [11.4, -115.5, 2], [-11.4, -115.5, 2]])], b0: 1.4, segs: 2, hb: 0.3 }));
  put('catch', 'slide', side(outline([[-108.5, -30, 1], [-103, -30, 1], [-101.4, -48, 1.5], [-106.6, -50, 1.5]]), LOW_HW - 0.5, LOW_HW + 2.2, { b1: 0.8 }));

  // ---- handguard: a round, ribbed shell between the delta ring and its cap ----
  const [h0, h1] = HG_Z; const n = 14;
  put('recv', 'steel', lathe([[0, -206], [24.5, -206], [25.5, -207], [25.5, -211], [22.5, -214], [0, -214]], { segs: 32 }));
  put('recv', 'polymer', lathe([[0, h0], [HG_R[0] - 1.2, h0], [HG_R[1] - 1.2, h1], [0, h1]], { segs: 32 }));
  for (let i = 0; i < n; i++) {
    const za = h0 + ((h1 - h0) * i) / n, zb = h0 + ((h1 - h0) * (i + 0.72)) / n;
    const ra = HG_R[0] + ((HG_R[1] - HG_R[0]) * i) / n, rb = HG_R[0] + ((HG_R[1] - HG_R[0]) * (i + 0.72)) / n;
    put('recv', 'polymer', lathe([[ra - 1.3, za], [ra, za - 1], [rb, zb + 1], [rb - 1.3, zb]], { segs: 32, closed: true }));
  }
  for (const sy of [-1, 1]) for (let i = 0; i < 6; i++) put('recv', 'black', box(0, sy * 21.6, h0 - 22 - i * 29, 5, 1.2, 12, 0.5)); // vents top and bottom
  put('recv', 'steel', lathe([[0, h1 + 1], [20.5, h1 + 1], [20.5, h1 - 3], [17, h1 - 6], [0, h1 - 6]], { segs: 32 }));
  // ---- barrel, gas tube, front sight tower, flash hider ----
  put('recv', 'steel', lathe([[2.8, -548], [8.2, -548], [8.2, -486], [9.4, -484], [9.4, h1 - 6], [0, h1 - 6]], { segs: 28 }));
  put('recv', 'steel', rodZ(0, 13.5, 2.4, -466, h1 - 5, 0.3, 12));
  put('recv', 'slide', side(outline([[-486, -11, 3], [-456, -11, 3], [-458, 16, 2], [-463, SIGHT_Y + 3, 1.5], [-477, SIGHT_Y + 3, 1.5], [-482, 16, 2]]), -5.2, 5.2, {
    holes: [outline([[-478, 19, 2], [-462, 19, 2], [-465, SIGHT_Y - 9, 1.5], [-475, SIGHT_Y - 9, 1.5]])], b0: 1.2, b1: 1.2, hb: 0.4,
  }));
  put('recv', 'slide', lathe([[9.3, -486], [12.2, -486], [12.2, -456], [9.3, -456]], { segs: 24, closed: true }));
  put('recv', 'slide', box(0, SIGHT_Y - 5.5, -470, 1.7, 9, 1.7, 0.25));
  for (const sx of [-1, 1]) put('recv', 'slide', side(outline([[-479, SIGHT_Y - 6], [-461, SIGHT_Y - 6], [-463, SIGHT_Y + 5, 1.5], [-477, SIGHT_Y + 5, 1.5]]), sx * 5.6 - 1, sx * 5.6 + 1, { b0: 0.4, b1: 0.4 }));
  put('recv', 'white', discZ(0, SIGHT_Y - 1.6, 0.7, -469.1, -468.98, 12));
  put('recv', 'steel', sect(circle(0, -16, 5, 16), -474, -470, { holes: [circle(0, -16, 3.2, 16)], b0: 0.5, b1: 0.5, hb: 0.5 })); // sling loop
  put('recv', 'slide', lathe([[2.9, -590], [10.6, -590], [11.4, -588.6], [11.4, -552], [9.4, -548], [2.9, -548]], { segs: 24, closed: true }));
  for (let i = 0; i < 6; i++) put('recv', 'black', new Soup().add(box(0, 11.3, -571, 2.6, 1, 26, 0.4), new Matrix4().makeRotationZ((i / 6) * Math.PI * 2 + 0.52)));
  put('recv', 'black', lathe([[0, -589.8], [2.9, -589.8]], { segs: 16 }));

  // ---- bolt carrier in the port, its handle through the slot ----
  put('bolt', 'steel', box(10.6, 4, -125, 6, 13.4, 53, 0.7));
  for (let i = 0; i < 5; i++) put('bolt', 'black', box(13.7, 4, -144 + i * 4.4, 0.3, 11, 2, 0.1));
  put('bolt', 'steel', pinX(-186, 7.6, 2.2, -17.5, -7.5, 0.3));
  put('bolt', 'slide', lathe([[0, -27.5], [3.2, -27.5], [4.4, -26.4], [4.4, -18.4], [3.4, -17.4], [0, -17.4]], { segs: 18, map: 'yzx' }).move(0, 7.6, -186));

  // ---- buffer tube and fixed stock ----
  put('stock', 'slide', rodZ(0, 2, 14.4, 1, 70, 0.8, 24));
  put('stock', 'steel', lathe([[14.5, 2], [17.4, 2], [17.4, 8], [14.5, 8]], { segs: 24, closed: true }).move(0, 2, 0));
  for (let i = 0; i < 12; i++) put('stock', 'steel', new Soup().add(box(17.5, 0, 5, 0.6, 3.4, 5.6, 0.2), new Matrix4().makeRotationZ((i / 12) * Math.PI * 2)).move(0, 2, 0));
  put('stock', 'polymer', side(STOCK, -STOCK_HW, STOCK_HW, { b0: 4.6, b1: 4.6, segs: 3 }));
  put('stock', 'black', side(outline([[230, 14, 4], [240, 12, 5], [243, -82, 5], [233, -86, 4]]), -STOCK_HW + 0.6, STOCK_HW - 0.6, { b0: 3, b1: 3, segs: 2 }));
  put('stock', 'steel', pinX(206, -70, 3, -STOCK_HW - 0.3, STOCK_HW + 0.3, 0.4));

  // ---- magazine (its own frame: y up the magazine, origin at the centre of its top): straight in the well, swept forward below it ----
  const MP = outline([[-11, -30, 2.6], [11, -30, 2.6], [11, 30, 2], [-11, 30, 2]]);
  put('mag', 'mag', plan(MP, -62, -2, { b1: 0.5 }));
  const sweep = new Matrix4().makeTranslation(0, -60, 0).multiply(new Matrix4().makeRotationX(-0.2));
  put('mag', 'mag', new Soup().add(plan(MP, -MAG_LEN + 60, 2), sweep));
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) put('mag', 'mag', new Soup().add(side(outline([[-22 + i * 13, -MAG_LEN + 68, 2], [-16 + i * 13, -MAG_LEN + 68, 2], [-16 + i * 13, -6, 2], [-22 + i * 13, -6, 2]]), sx > 0 ? 10.8 : -11.6, sx > 0 ? 11.6 : -10.8, sx > 0 ? { b1: 0.4 } : { b0: 0.4 }), sweep));
  put('mag', 'polymer', new Soup().add(plan(outline([[-12.6, -33, 3], [12.6, -33, 3], [12.6, 32.5, 2.5], [-12.6, 32.5, 2.5]]), -MAG_LEN + 52, -MAG_LEN + 60.5, { b0: 1.6, b1: 1, segs: 2 }), sweep));
  const lip = outline([[11, -2.2], [11, 1.6, 0.6], [8.6, 3.6, 0.5], [6.6, 3.8], [6.6, 3.0], [8.2, 2.8, 0.5], [10.2, 1.3, 0.5], [10.2, -2.2]]);
  const lipS = sect(lip, -24, 30, { b0: 0.3 });
  put('mag', 'mag', lipS); put('mag', 'mag', lipS.mirrorX());
  put('mag', 'polymer', plan(outline([[-9, -27, 2], [9, -27, 2], [9, 27, 1.5], [-9, 27, 1.5]]), -2.6, 0.4, { b1: 0.6 }));
  const tilt = new Matrix4().makeTranslation(0, 2.6, 2).multiply(new Matrix4().makeRotationX(0.05));
  put('mag', 'bullet', new Soup().add(lathe([[0, -29], [1.2, -28.6], [2.4, -24], [2.85, -17], [0, -17]], { segs: 16 }), tilt));
  put('mag', 'brass', new Soup().add(lathe([[0, -17], [3.1, -17], [3.1, -13], [4.7, -9.6], [4.8, 24.6], [4.2, 25], [4.2, 25.8], [4.8, 26.2], [4.8, 27.6], [0, 27.6]], { segs: 16 }), tilt));

  // ---- attachments ----
  const rs = reflexSight(-112, 25, DOT_Y);
  put('att_sight', 'slide', rs.body); put('att_sight', 'dot', rs.dot);
  put('att_suppressor', 'slide', lathe([[3, -748], [15, -748], [16.6, -746.4], [16.6, -596], [15, -594], [10, -594], [10, -588], [3, -588]], { segs: 28, closed: true }));
  put('att_suppressor', 'black', lathe([[0, -747.8], [3, -747.8]], { segs: 16 }));
  for (let i = 0; i < 20; i++) put('att_suppressor', 'slide', new Soup().add(box(16.7, 0, -620, 0.5, 2.8, 40, 0.2), new Matrix4().makeRotationZ((i / 20) * Math.PI * 2)));
  put('att_grip', 'polymer', lathe([[0, -100], [11.4, -100], [12.8, -97.5], [12.2, -46], [10.4, -36], [10.4, -19], [0, -19]], { segs: 22, map: 'zxy' }).move(0, 0, -330));
  for (let i = 0; i < 5; i++) put('att_grip', 'polymer', lathe([[12.3, -92 + i * 10], [13.3, -91 + i * 10], [13.3, -88.5 + i * 10], [12.3, -87.5 + i * 10]], { segs: 22, map: 'zxy', closed: true }).move(0, 0, -330));
  put('att_mag', 'mag', new Soup().add(plan(MP, -MAG_LEN + 6, -MAG_LEN + 56), sweep));
  put('att_mag', 'polymer', new Soup().add(plan(outline([[-12.6, -33, 3], [12.6, -33, 3], [12.6, 32.5, 2.5], [-12.6, 32.5, 2.5]]), -MAG_LEN - 2, -MAG_LEN + 6.5, { b0: 1.6, b1: 1, segs: 2 }), sweep));
  caseSoups(put, 4.8, 44);
}

export function buildRifle(G, patch = (m) => m) {
  const M = gunMats(G, patch, 151);
  const kit = modelKit(G, M, 'rifle');
  const MAG_ALIAS = { black: 'mag' }, ALIAS = { ctrl: 'slide' };
  buildSoups((part, mat, soup) => kit.put(part, (part === 'mag' ? MAG_ALIAS[mat] : ALIAS[mat]) || mat, soup));
  const { parts, root } = kit;
  kit.part('recv');
  kit.part('catch');
  kit.part('bolt');
  kit.part('trigger', [0, TRIG.pivot[1], TRIG.pivot[0]]);
  kit.part('stock');
  const magRest = new Matrix4().makeTranslation(MAG_AT[0] * MM, MAG_AT[1] * MM, MAG_AT[2] * MM);
  const magAxis = new Vector3(0, -1, 0);
  const _s = new Vector3(1, 1, 1);
  const { mag, spare } = magPair(kit);
  const casing = kit.part('casing');
  casing.visible = false;
  kit.part('att_sight'); kit.part('att_suppressor'); kit.part('att_grip');
  const magExt = [kit.part('att_mag', [0, 0, 0], mag), kit.copy('att_mag', 'att_mag2', spare)];

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, magD: 0 };
  function set(s) {
    if (s) Object.assign(state, s);
    parts.bolt.position.z = state.slide;
    parts.trigger.rotation.x = TRIG.angle * state.trigger;
    parts.catch.position.x = 0.0016 * state.magRelease;
    magRest.decompose(mag.position, mag.quaternion, _s);
    mag.position.addScaledVector(magAxis, state.magD);
  }
  set();

  function sdf(x, y, z, o = {}) {
    let d = lowerSdf(x, y, z, o, LOWER_R);
    d = Math.min(d, bx(x, y, z, 0, 2, -103, HW, 18, 103, 3), bx(x, y, z, 0, 28, -107, 9, 8, 96));
    d = Math.min(d, cylZ(x, y, z, 0, 21.5, HG_Z[1], HG_Z[0]), cylZ(x, y, z, 0, 9.4, -548, HG_Z[1]));
    d = Math.min(d, bx(x, y, z, 0, MAG_AT[1] - MAG_LEN / 2, MAG_AT[2] - 8, 12.6, MAG_LEN / 2 + 4, 36, 2));
    d = Math.min(d, bx(x, y, z - state.slide / MM, -22.5, 7.6, -186, 5, 4.4, 4.4));
    return d;
  }

  const model = {
    id: 'rifle', cls: 'rifle', action: 'bolt', root, parts, meshes: kit.meshes, materials: M, state, set, sdf,
    get triangles() { return kit.triangles; },
    travel: BOLT_TRAVEL, lock: 0.064,
    mag, spare, casing, magRest, magAxis,
    // gripped in the fist, across the palm: its top out past the thumb, its base under the little finger
    magInHand: new Matrix4().set(0, 1, 0, 0.145, -1, 0, 0, -0.027, 0, 0, 1, -0.066, 0, 0, 0, 1),
    spareHand: 'fist',
    clip: { wellStart: 0.07, spare: [[0.84, 0.07], [0.94, 0.04, 'io'], [0.98, 0.034], [1.05, 0, 'in3']] },
    magBox: { c: [53, -27, -70], h: [92, 11, 30] },
    charge: new Vector3(-0.0225, 0.0076, -0.186),
    casingSpin: 34,
    adsHide: [parts.stock], // the eye sits where the cheek would
    // The eye is a hand's breadth behind the aperture, where a cheek on the stock puts it: the receiver's
    // heel is under the frame, and the picture is the ghost ring, the post inside it and the rail running away.
    pose: { ads: 0.065 },
    anchors: {
      muzzle: new Vector3(0, 0, -0.59),
      eject: new Vector3(0.0155, 0.005, -0.122),
      grip: new Vector3(0, -0.06, -0.01),
      support: new Vector3(0, -0.03, -0.31),
      sight: new Vector3(0, SIGHT_Y * MM, -0.022),
      mag: new Vector3(MAG_AT[0], MAG_AT[1] - MAG_LEN, MAG_AT[2]).multiplyScalar(MM),
    },
    hold: {
      twoHand: false, trigger: TRIG,
      right: HOLD_RIGHT,
      left: { at: [15, -33, -312], back: [-0.8, -0.15, 0.55], thumb: [-0.4, 0.1, -0.9], elbow: [-260, -330, -120], thumbPad: [-21, -4, -336], cup: 0.2 }, // the handguard lies in the palm
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
  };
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, DOT_Y * MM, -0.022) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.748) } },
    grip: { parts: [parts.att_grip] },
    mag: { parts: magExt },
  });
  return model;
}
