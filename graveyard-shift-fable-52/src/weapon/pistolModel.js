// The sidearm: a Halden Armsworks H-11 "Nightjar", an invented full-size 9 mm service pistol.
// Hammer-fired, steel slide on a polymer frame. The slide has a raised sight rib between stepped
// shoulders, a nose relieved 0.9 mm a side ahead of the port with three lightening pockets milled
// into each flank and a window through the top, raised ribs as rear serrations, a spring tunnel
// under the muzzle; the frame has a squared, undercut trigger guard and a four-lug accessory rail.
//
// Model space (metres): bore axis is the z axis, muzzle toward -z, +y up, +x the shooter's right.
// z = 0 is the rear face of the slide. Everything below is authored in millimetres.
import { Group, Mesh, Vector3, Matrix4 } from 'three';
import { Soup, prism, lathe, box, outline, circle, strokeText, strokeLines, sdPoly, sdExtrude, fitments, reflexSight } from './geo.js';
import { upgradeFinish } from './models/upgrade.js';

const MM = 0.001;
export const SLIDE_TRAVEL = 0.045; // metres
export const HAMMER_COCK = 0.78; // radians
export const TRIGGER_PULL = -0.2; // radians about +x at full pull
const MAG_RAKE = -Math.atan(0.323); // magazine axis leans back 17.9 degrees
const MAG_TOP = [0, -12, -30.3]; // mm: centre of the magazine's top, seated
const MAG_AXIS = new Vector3(0, -Math.cos(MAG_RAKE), -Math.sin(MAG_RAKE)); // unit, points out of the magwell

// ---- profiles shared with the grasp solver (mm) ---------------------------------------------------
const FRAME_PROFILE = outline([ // (z, y)
  [-187.5, -14.8, 0.6, 1], [2.0, -14.8], [10.0, -15.4, 6], [17.6, -17.0, 1.0], [17.2, -19.6, 1.0],
  [9.5, -23.2, 5], [5.8, -31.0, 9], [8.2, -46.0, 30], [19.6, -80.0, 60], [27.0, -109.5, 3.2],
  [-16.1, -123.8, 2.6], [-36.0, -62.0, 2], [-36.6, -57.0], [-41.0, -28.5, 1.2], [-177.5, -28.5, 1.0], [-186.8, -21.5, 2.0],
]);
// squared combat guard: thick bow, a flat front face hooked for the support index, undercut at the grip
const GUARD_PROFILE = outline([
  [-98.0, -26.0], [-99.2, -45.0, 3], [-96.4, -65.4, 6.5], [-44.0, -65.4, 4], [-37.2, -61.0, 2], [-35.5, -52.0], [-35.5, -26.0],
  [-41.6, -26.0], [-41.6, -53.5, 4.5], [-46.5, -57.4, 3], [-85.0, -57.4, 6.5], [-89.8, -45.0, 3], [-89.4, -26.0],
]);
const GUARD_HW = 8.4; // half width of the trigger guard
const PANEL_PROFILE = outline([[-30.5, -46, 3], [2.4, -46, 3], [14.4, -82, 14], [21.4, -106.2, 3], [-15.8, -118.2, 3], [-30.5, -66, 8]]);
const TRIGGER_PIVOT = [-56, -25.5]; // (z, y)
const TRIGGER_PROFILE = outline([
  [-59.5, -27.5], [-61.5, -36, 12], [-62.3, -43, 12], [-61.2, -49.5, 10], [-58.6, -54.2, 1.2],
  [-56.2, -53.2, 1.0], [-57.6, -47, 10], [-58.0, -41, 12], [-57.0, -34, 10], [-53.5, -29.5, 3], [-53.5, -23.5], [-59.5, -23.5],
]);
const HAMMER_PIVOT = [3.5, -23];
const STOP_PIVOT = [-78.5, -18.5];

const SLOT = 2.75; // half-width of the window milled through the top of the slide's nose
const BORE_HOLE = 7.15;
// Slide cross-section (x, y), counter-clockwise. Vertex tags: 1 = bounds the ejection port,
// 2 = bounds the top window, 3 = flank (used to bevel only the exposed part of a section's end face).
// lump: the spring tunnel under the nose. slot: 'marks' adds the window's corner vertices to the
// top edge; 'cut' opens the window down into the barrel bore. w: half width of the flanks (the nose
// is relieved). pocket: a lightening cut this deep in each flank.
const RIB = 4.8, RIB_Y = 10.5, SHOULDER_Y = 9.3; // the sight rib stands 1.2 mm above the shoulders
function slideContour({ lump = false, slot = null, w = 12.4, pocket = 0 } = {}) {
  const bottom = lump
    ? [[-13, -14.5, 0.5, 1], [-8.5, -14.5], [-8.5, -17.6, 1.0], [-5.6, -21.5, 2.2], [5.6, -21.5, 2.2], [8.5, -17.6, 1.0], [8.5, -14.5], [13, -14.5, 0.5, 1]]
    : [[-13, -14.5, 0.5, 1], [13, -14.5, 0.5, 1]];
  let top = [];
  if (slot === 'marks') top = [[SLOT + 0.5, RIB_Y], [SLOT, RIB_Y, 0, 0, 2], [-SLOT, RIB_Y, 0, 0, 2], [-SLOT - 0.5, RIB_Y]];
  if (slot === 'cut') {
    const a0 = Math.atan2(Math.sqrt(BORE_HOLE * BORE_HOLE - SLOT * SLOT), SLOT);
    top = [[SLOT + 0.45, RIB_Y], [SLOT, RIB_Y - 0.45]];
    const n = 30;
    for (let i = 0; i <= n; i++) { const a = a0 - (i / n) * (2 * Math.PI - (Math.PI - 2 * a0)); top.push([Math.cos(a) * BORE_HOLE, Math.sin(a) * BORE_HOLE]); }
    top.push([-SLOT, RIB_Y - 0.45], [-SLOT - 0.45, RIB_Y]);
  }
  // one flank from the rail up to the sight rib; only the right one bounds the ejection port
  const flank = (sx) => {
    const port = sx > 0 ? 1 : 0;
    const pts = pocket
      ? [[w, -10.4, 0, 0, 3], [w, -8.6, 0, 0, 3], [w - pocket, -7.6, 0, 0, 3], [w - pocket, -0.6, 0, 0, 3], [w, 0.4, 0, 0, port || 3]]
      : [[w, -10.4, 0, 0, 3], [w, 0.0, 0, 0, 3], [w, 0.5, 0, 0, port || 3]];
    pts.push([w, 2.5, 0.7, 2, port], [9.4, SHOULDER_Y, 0.5, 2, port], [RIB + 0.9, SHOULDER_Y, 0, 0, port], [RIB, RIB_Y, 0.3, 1, port]);
    const out = pts.map((q) => [q[0] * sx, q[1], q[2], q[3], q[4]]);
    return sx > 0 ? out : out.reverse();
  };
  return outline([
    ...bottom,
    [13, -11.0], ...flank(1),
    ...top,
    [-4.0, RIB_Y, 0, 0, 1], ...flank(-1), [-13, -11.0],
  ]);
}

// moulded texture on the front strap and backstrap of the grip (mm, model space)
function strapMask(y, z) {
  if (y > -40) return 0;
  const front = -36 + (-62 - y) * 0.323;
  const back = y > -80 ? 8.2 + ((-46 - y) / 34) * 11.4 : 19.6 + ((-80 - y) / 29.5) * 7.4;
  const f = y < -66 && z < front + 5 ? 1 : 0;
  const b = y < -50 && y > -104 && z > back - 5 ? 1 : 0;
  return Math.max(f, b);
}

const side = (profile, x0, x1, opts = {}) => prism(profile, x0, x1, { map: 'zyx', ...opts });
const sect = (profile, z0, z1, opts = {}) => prism(profile, z0, z1, { map: 'xyz', ...opts });
const plan = (profile, y0, y1, opts = {}) => prism(profile, y0, y1, { map: 'xzy', ...opts });
// a pin or screw through the gun along x: [z, y, radius, x0, x1, chamfer]
const pinX = (z, y, r, x0, x1, c = 0.2) => lathe([[0, x0], [r - c, x0], [r, x0 + c], [r, x1 - c], [r - c, x1], [0, x1]], { segs: 16, map: 'yzx' }).move(0, y, z);
const discZ = (x, y, r, z0, z1, n = 16) => sect(circle(x, y, r, n), z0, z1);

// text on the gun's flanks and top. Returns a soup placed in model space (mm).
function mark(soup, where, a, b, lift = 0.04) {
  const m = new Matrix4();
  if (where === 'left') m.set(0, 0, -1, -12.4 - lift, 0, 1, 0, b, 1, 0, 0, a, 0, 0, 0, 1); // u -> +z, v -> +y, faces -x
  else if (where === 'right') m.set(0, 0, 1, 12.4 + lift, 0, 1, 0, b, -1, 0, 0, a, 0, 0, 0, 1); // u -> -z, v -> +y, faces +x
  else m.set(1, 0, 0, a, 0, 0, 1, where + lift, 0, -1, 0, b, 0, 0, 0, 1); // top at y = where: u -> +x, v -> -z
  return new Soup().add(soup, m);
}

function buildSoups() {
  const P = {};
  // One phosphate per part: the controls share the slide's finish and the dark marks the black's
  // (each variant was its own draw call for a difference nobody could see).
  const ALIAS = { ctrl: 'slide', markDark: 'black' };
  const put = (part, mat, soup) => { ((P[part] ||= {})[ALIAS[mat] || mat] ||= new Soup()).add(soup); };

  // ================= slide =================
  const NOSE_W = 11.5, POCKET = 1.5;
  const full = slideContour();
  const portTag = (pt) => (pt[2] === 1 ? 1 : 0);
  const slotTag = (pt) => (pt[2] === 2 ? 1 : 0);
  const flankTag = (pt) => (pt[2] === 3 ? 1 : 0);
  const bore = circle(0, 0, BORE_HOLE, 28), rodHole = circle(0, -14.2, 4.3, 20);
  // nose: relieved, bored for the barrel and the recoil spring guide; the muzzle end's top edge is raked
  put('slide', 'slide', sect(slideContour({ lump: true, slot: 'marks', w: NOSE_W }), -196, -171, { holes: [bore, rodHole], b0: 0.9, f0: (pt) => (pt[1] > 9 ? 3.4 : pt[1] > 2 ? 1.6 : 1), b1: 0.45, f1: slotTag, hb: 0.7 }));
  // the window through the top that shows the barrel, with three lightening pockets in each flank
  const cut = (z0, z1, pocket) => put('slide', 'slide', sect(slideContour({ lump: true, slot: 'cut', w: NOSE_W, pocket }), z0, z1, pocket ? { holes: [rodHole] } : { holes: [rodHole], b0: 0.4, b1: 0.4, f0: flankTag, f1: flankTag, hb: 0 }));
  const POCKETS = [[-169, -163.2], [-160.4, -154.6], [-151.8, -146]];
  let zc = -171;
  for (const [p0, p1] of POCKETS) { cut(zc, p0, 0); cut(p0, p1, POCKET); zc = p1; }
  // the step up to the full-width slide
  put('slide', 'slide', sect(slideContour({ lump: true, slot: 'cut' }), -146, -141, { holes: [rodHole], b0: 0.7, f0: flankTag, hb: 0 }));
  put('slide', 'slide', sect(slideContour({ lump: true, slot: 'marks' }), -141, -122, { holes: [bore, rodHole], b0: 0.45, f0: slotTag, b1: 0.5, f1: portTag, hb: 0.7 }));
  // port section: left wall and roof, and the low right wall under the port
  put('slide', 'slide', sect(outline([
    [-13, -14.5, 0.5, 1], [-10, -14.5], [-10, 2.0], [-7.0, 8.1], [-4.0, 8.1], [-4.0, RIB_Y],
    [-RIB, RIB_Y, 0.3, 1], [-RIB - 0.9, SHOULDER_Y], [-9.4, SHOULDER_Y, 0.5, 2], [-12.4, 2.5, 0.7, 2], [-12.4, -10.4], [-13, -11.0],
  ]), -122, -84));
  put('slide', 'slide', sect(outline([
    [13, -14.5, 0.5, 1], [13, -11.0], [12.4, -10.4], [12.4, 0.0], [11.9, 0.5], [10.2, 0.5], [10.2, -14.5],
  ]), -122, -84));
  // breech and rear
  put('slide', 'slide', sect(full, -84, 0, { b0: 0.5, f0: portTag, b1: 0.9 }));

  // serration ribs left standing by the relief cut on each flank
  const rib = (z0) => outline([[z0, -9.9, 0.3, 1], [z0 + 1.5, -9.9, 0.3, 1], [z0 + 4.6, 1.9, 0.3, 1], [z0 + 3.1, 1.9, 0.3, 1]]);
  for (let i = 0; i < 12; i++) {
    const r = side(rib(-47 + i * 3), 12.2, 13.0, { b1: 0.28 });
    put('slide', 'slide', r); put('slide', 'slide', r.mirrorX());
  }
  // anti-glare lines along the sight rib behind the port
  for (let i = 0; i < 5; i++) put('slide', 'slide', box(-3.6 + i * 1.8, RIB_Y + 0.12, -52, 0.8, 0.5, 56, 0.2));

  // rear sight: two ears and a low bridge, ramped front, square notch
  const ramp = (y) => -20.5 + (y - 11.4) / 0.418;
  const ear = outline([[-21.5, 9.1], [-6.3, 9.1], [-6.3, 16.0, 0.35, 1], [-9.5, 16.0, 0.6, 1], [ramp(13.0), 13.0], [-20.5, 11.4, 1.0, 2]]);
  const notchFlag = (pt) => (pt[1] > 13.05 ? 1 : 0);
  put('slide', 'ctrl', side(ear, 2.2, 9.0, { b0: 0.4, f0: notchFlag, b1: 0.6 }));
  put('slide', 'ctrl', side(ear, -9.0, -2.2, { b1: 0.4, f1: notchFlag, b0: 0.6 }));
  put('slide', 'ctrl', side(outline([[-21.5, 10.3], [-6.3, 10.3], [-6.3, 13.0, 0.3, 1], [ramp(13.0), 13.0], [-20.5, 11.4, 1.0, 2]]), -2.2, 2.2));
  // front sight: ramped post
  put('slide', 'ctrl', side(outline([[-190.5, 10.3], [-181, 10.3], [-181, 16.0, 0.3, 1], [-183.6, 16.0, 0.5, 1], [-190.0, 11.2, 0.6, 2]]), -1.8, 1.8, { b0: 0.35, b1: 0.35 }));
  // luminous dots (white ring, glowing core)
  for (const [x, y, z] of [[-5.5, 13.9, -6.3], [5.5, 13.9, -6.3], [0, 14.3, -181]]) {
    put('slide', 'white', discZ(x, y, 1.3, z - 0.05, z + 0.04, 20));
    put('slide', 'glow', discZ(x, y, 0.85, z - 0.05, z + 0.07, 16));
  }

  // rear face: firing pin retainer plate with the pin's witness hole
  put('slide', 'steel', sect(outline([[-3.4, -9.6, 1.4], [3.4, -9.6, 1.4], [3.4, 4.2, 3.2], [-3.4, 4.2, 3.2]]), -0.3, 0.75, { b1: 0.45 }));
  put('slide', 'black', discZ(0, 0.6, 1.2, 0.5, 0.82, 14));
  put('slide', 'ctrl', discZ(0, -6.2, 1.9, 0.5, 1.0, 14));
  put('slide', 'black', box(0, -6.2, 1.0, 3.2, 0.55, 0.12, 0.02));
  // witness lines either side of the plate
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) put('slide', 'mark', box(sx * (6.2 + i * 1.5), -4, 0.03, 0.5, 9 - i * 1.6, 0.1, 0.02));
  // external extractor on the right flank behind the port, with its pivot pin
  put('slide', 'ctrl', side(outline([[-83.6, -1.6, 0.5, 1], [-63.5, -1.6, 0.8, 2], [-62.4, 0.2, 0.8, 2], [-63.5, 2.0, 0.8, 2], [-83.6, 2.0, 0.5, 1]]), 12.0, 12.95, { b1: 0.3 }));
  put('slide', 'steel', lathe([[0, 13.05], [0.75, 13.05], [0.9, 12.9], [0.9, 12.0]], { segs: 12, map: 'yzx' }).move(0, 0.2, -67));

  // roll marks (bare metal showing through the finish)
  const logoClosed = strokeLines([[0, 3.2, 2.6, 6.4, 5.2, 3.2, 2.6, 0]], 0.34, true);
  logoClosed.add(strokeLines([[1.1, 4.3, 2.6, 2.5, 4.1, 4.3]], 0.34));
  put('slide', 'mark', mark(logoClosed, 'left', -139.5, -6.8));
  put('slide', 'mark', mark(strokeText('HALDEN ARMSWORKS', { h: 3.0, sw: 0.34 }).soup, 'left', -132, -3.0));
  put('slide', 'mark', mark(strokeText('H-11 NIGHTJAR', { h: 2.2, sw: 0.27 }).soup, 'left', -132, -7.4));
  put('slide', 'mark', mark(strokeText('9x19', { h: 2.6, sw: 0.3 }).soup, 'right', -87, -3.6));
  put('slide', 'mark', mark(strokeText('HN 204771', { h: 2.2, sw: 0.27 }).soup, 'right', -87, -7.6));

  // ================= barrel =================
  put('barrel', 'steel', lathe([
    [4.5, -150], [4.5, -197.6], [5.5, -199.0], [6.25, -199.0], [6.9, -198.3], [6.9, -121.8], [0, -121.8],
  ], { segs: 32 }));
  put('barrel', 'black', lathe([[0, -150], [4.5, -150]], { segs: 32 }));
  put('barrel', 'steel', sect(outline([
    [-3.6, 10.25, 0.4, 1], [-3.6, -6], [9.8, -6], [9.8, 1.0], [10.9, 1.0, 0.3, 1], [10.9, 2.3, 0.6, 2], [8.5, 9.05, 0.5, 2], [5.5, 9.05], [4.6, 10.25, 0.3, 1],
  ]), -121.6, -84.4, { b0: 0.45, b1: 0.45 }));
  put('barrel', 'markDark', mark(strokeText('9x19', { h: 2.0, sw: 0.26 }).soup, 10.25, -1.8, -90));

  // recoil spring guide, seen under the muzzle and when the slide is back
  put('rod', 'ctrl', lathe([[0, -195.3], [1.3, -195.3], [1.7, -196.3], [3.4, -196.3], [3.95, -195.7], [3.95, -118], [0, -118]], { segs: 20 }).move(0, -14.2, 0));

  // ================= frame =================
  const grip = (pt) => (pt[0] < 2 && pt[1] > -30 ? 0.3 : 1);
  put('frame', 'polymer', side(FRAME_PROFILE, -13, 13, { b0: 2.4, b1: 2.4, segs: 3, f0: grip, f1: grip, user: 'frame' }));
  put('frame', 'polymer', side(GUARD_PROFILE, -GUARD_HW, GUARD_HW, { b0: 2.3, b1: 2.3, segs: 3 }));
  // accessory rail: five lugs under the dust cover
  const lug = outline([[-8.2, -27.5], [-8.2, -29.4], [-10.7, -30.6, 0.35, 1], [-10.7, -32.6, 0.35, 1], [-9.0, -34.0, 0.35, 1], [9.0, -34.0, 0.35, 1], [10.7, -32.6, 0.35, 1], [10.7, -30.6, 0.35, 1], [8.2, -29.4], [8.2, -27.5]]);
  for (let i = 0; i < 4; i++) put('frame', 'polymer', sect(lug, -174.5 + i * 11.4, -167.3 + i * 11.4, { b0: 0.5, b1: 0.5 }));
  // index pads on the dust cover: where the support thumb and the trigger finger rest
  const pad = outline([[-131, -17.6, 1.6], [-103, -17.6, 1.6], [-100.5, -25.4, 1.6], [-128.5, -25.4, 1.6]]);
  put('frame', 'panel', side(pad, 12.7, 13.6, { b1: 0.5, user: 'grip' }));
  put('frame', 'panel', side(pad, -13.6, -12.7, { b0: 0.5, user: 'grip' }));
  // moulded grip panels, each held by one socket screw
  const panel = PANEL_PROFILE;
  put('frame', 'panel', side(panel, 12.6, 14.6, { b1: 1.0, segs: 2, user: 'grip' }));
  put('frame', 'panel', side(panel, -14.6, -12.6, { b0: 1.0, segs: 2, user: 'grip' }));
  const screw = lathe([[0, 14.2], [1.25, 14.2], [1.35, 15.0], [2.2, 15.0], [2.6, 14.7], [2.6, 14.0]], { segs: 6, map: 'yzx' }).move(0, -80, -3);
  put('frame', 'steel', screw); put('frame', 'steel', screw.mirrorX());
  // what shows through the port with the slide back: feed ramp and ejector block
  put('frame', 'black', side(outline([[-84, -15.5], [-40, -15.5], [-40, -9.5, 1], [-52, -8.0, 2], [-80, -3.8, 1], [-84, -4.6]]), -7, 7, { b0: 0.5, b1: 0.5 }));
  // pins through the frame
  for (const [z, y, r] of [[-56, -25.5, 1.5], [3.5, -23, 1.7], [-10, -31.5, 1.3], [-84, -22, 1.3]]) put('frame', 'steel', pinX(z, y, r, -13.3, 13.3));
  // takedown lever (left) and its pin end (right)
  put('frame', 'ctrl', pinX(-98, -21, 2.7, -14.5, -12.5, 0.4));
  put('frame', 'ctrl', side(outline([[-97, -19.4, 0.5], [-97, -22.6, 0.5], [-106.6, -24.6, 0.9], [-107.4, -22.4, 0.9]]), -14.7, -13.2, { b0: 0.4 }));
  put('frame', 'ctrl', pinX(-98, -21, 1.6, 12.5, 13.5, 0.25));
  // ambidextrous safety: pivot boss and thumb shelf on each side
  const paddle = outline([[-3.6, -22.0, 1.2], [-3.6, -26.6, 1.2], [-22, -25.8, 0.8], [-27.6, -24.2, 1.0], [-27.0, -21.8, 0.8]]);
  put('safety', 'ctrl', side(paddle, 12.8, 15.7, { b1: 0.5 })); put('safety', 'ctrl', side(paddle, -15.7, -12.8, { b0: 0.5 }));
  put('safety', 'ctrl', pinX(-5.5, -24.5, 3.3, 12.8, 14.5, 0.4)); put('safety', 'ctrl', pinX(-5.5, -24.5, 3.3, -14.5, -12.8, 0.4));
  // dark plug where the magazine well opens (seen during a reload). Magazine-local coordinates.
  P.frameMagLocal = { black: plan(outline([[-11, -17.8, 3], [11, -17.8, 3], [11, 17.8, 2], [-11, 17.8, 2]]), -111.4, -110.2) };

  // ================= controls =================
  put('trigger', 'ctrl', side(TRIGGER_PROFILE, -3.5, 3.5, { b0: 1.1, b1: 1.1, segs: 2 }));
  put('hammer', 'steel', side(outline([
    [0.5, -25], [0.5, 0.4, 0.8], [2.2, 2.6, 0.9], [7.2, 2.6, 1.4], [9.7, 0.2, 1.6], [9.8, -4.6, 2.2], [7.6, -8.6, 3], [6.6, -13, 3], [7.6, -25],
  ]), -3.3, 3.3, { holes: [circle(5.25, -2.7, 2.3, 16)], b0: 0.6, b1: 0.6, hb: 0.8 }));
  put('stop', 'ctrl', side(outline([
    [-81, -18.5, 1.7], [-77.5, -16.3, 1.2], [-44, -16.3, 0.5], [-37.5, -15.7, 0.6], [-36.6, -18.6, 0.8], [-44, -20.3, 1], [-76, -20.7, 1.5],
  ]), -14.5, -12.8, { b0: 0.45 }));
  put('stop', 'ctrl', side(outline([[-46, -15.9, 0.5], [-37.3, -15.3, 0.6], [-36.6, -17.8, 0.6], [-46, -18.6, 0.5]]), -16.4, -14.3, { b0: 0.45 }));
  put('stop', 'steel', pinX(STOP_PIVOT[0], STOP_PIVOT[1], 1.4, -15.0, -14.4, 0.2));
  put('frame', 'steel', pinX(STOP_PIVOT[0], STOP_PIVOT[1], 1.4, 12.6, 13.35, 0.2));
  put('magRelease', 'ctrl', lathe([[0, -15.3], [2.7, -15.3], [3.4, -14.7], [3.4, -11.5], [0, -11.5]], { segs: 20, map: 'yzx' }).move(0, -38, -33));
  put('magRelease', 'ctrl', lathe([[0, 11.5], [2.2, 11.5], [2.2, 13.4], [1.9, 13.7], [0, 13.7]], { segs: 16, map: 'yzx' }).move(0, -38, -33));

  // ================= magazine (its own local frame: y' up the magazine axis, z' back) =================
  const M = {};
  const mput = (mat, soup) => { (M[mat] ||= new Soup()).add(soup); };
  mput('mag', plan(outline([[-10.4, -17, 3.2], [10.4, -17, 3.2], [10.4, 17, 2], [-10.4, 17, 2]]), -111, -2, { b1: 0.5 }));
  const lip = outline([[10.4, -2.2], [10.4, 1.5, 0.6], [8.5, 3.3, 0.5], [5.9, 3.5], [5.9, 2.7], [8.2, 2.5, 0.5], [9.6, 1.2, 0.5], [9.6, -2.2]]);
  const lipS = sect(lip, -3.5, 17, { b0: 0.3 });
  mput('mag', lipS); mput('mag', lipS.mirrorX());
  mput('mag', box(0, 0, 16.2, 19.4, 4.4, 1.6, 0.3));
  const ribM = side(outline([[-2.2, -100, 2.2], [2.2, -100, 2.2], [2.2, -18, 2.2], [-2.2, -18, 2.2]]), 10.2, 10.8, { b1: 0.35 });
  mput('mag', ribM); mput('mag', ribM.mirrorX());
  for (const y of [-30, -55, -80]) mput('mag', discZ(0, y, 1.3, 16.9, 17.06, 12));
  mput('magBase', plan(outline([[-12.4, -20.5, 4], [12.4, -20.5, 4], [12.4, 18.6, 2.5], [-12.4, 18.6, 2.5]]), -119.5, -111.4, { b0: 1.5, b1: 1.0, segs: 2 }));
  mput('magBase', plan(outline([[-8.6, -15.5, 2], [8.6, -15.5, 2], [8.6, 15, 1.5], [-8.6, 15, 1.5]]), -2.4, 0.6, { b1: 0.6 }));
  // the top cartridge, nose slightly up
  const tilt = new Matrix4().makeTranslation(0, 2.3, 0).multiply(new Matrix4().makeRotationX(0.06));
  M.bullet = new Soup().add(lathe([[0, -15.2], [1.5, -15.0], [3.1, -13.4], [4.2, -10.4], [4.5, -7.0], [0, -7.0]], { segs: 20 }), tilt);
  M.brass = new Soup().add(lathe([[0, -7.0], [4.85, -7.0], [4.97, -6.4], [4.97, 11.4], [4.4, 11.8], [4.4, 12.6], [4.97, 12.9], [4.97, 13.8], [4.6, 14.2], [0, 14.2]], { segs: 20 }), tilt);
  P.magLocal = M;
  // a spent case: axis on z, mouth toward -z, centred
  P.caseLocal = {
    brass: lathe([[4.3, -9.5], [4.97, -9.5], [4.97, 7.2], [4.4, 7.6], [4.4, 8.4], [4.97, 8.7], [4.97, 9.5], [0, 9.5]], { segs: 16 }),
    black: discZ(0, 0, 4.3, -7.4, -7.3, 14),
  };
  return P;
}

// Where each part goes in the exploded product view (mm).
const EXPLODE = {
  slide: [0, 46, 0], barrel: [0, 24, -34], rod: [0, 6, -52], frame: [0, 0, 0], trigger: [0, -6, -22], hammer: [0, 10, 24],
  stop: [-26, 4, 0], safety: [0, 0, 22], magRelease: [-26, -4, 0], mag: [0, -62, 0],
};

// G.mats supplies every material; `patch(material)` is the viewmodel's projection hook.
export function buildPistol(G, patch = (m) => m) {
  const mats = G.mats;
  // Steel and polymer are kept apart in value and in roughness under any light: the slide is a dark
  // blued finish that keeps a sheen and wears bright on its edges; the frame is a paler, dead-matte
  // moulding that stays matte when wet. occ: darkened where the hands close round it (viewmodel patch).
  const rest = { space: 'rest', shelter: 0.3 };
  const dry = { space: 'rest', shelter: 0.7 };
  const steelFx = { occ: true, albedo: 0.5, rough: [0.62, 0.2] };
  const polyFx = { occ: true, rough: [1.25, 0.74] };
  const M = {
    slide: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.56, oil: 0.3, seed: 3, ...rest }), steelFx),
    ctrl: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.64, oil: 0.25, seed: 7, ...rest }), { ...steelFx, albedo: 0.42 }),
    steel: patch(mats.gunmetal({ finish: 'bare', wear: 0.25, oil: 0.3, seed: 5, ...rest }), { occ: true }),
    mark: patch(mats.gunmetal({ finish: 'bare', wear: 0, oil: 0, seed: 9, ...rest })),
    markDark: patch(mats.gunmetal({ finish: 'phosphate', wear: 0, oil: 0, seed: 9, ...rest })),
    black: patch(mats.gunmetal({ finish: 'phosphate', wear: 0, oil: 0, seed: 11, ...rest }), { albedo: 0.3 }),
    polymer: patch(mats.gunmetal({ finish: 'polymer', color: 0x34383a, wear: 0.3, oil: 0.12, seed: 13, ...dry }), polyFx),
    panel: patch(mats.gunmetal({ finish: 'polymer', color: 0x222425, wear: 0.3, oil: 0.1, studPitch: 0.0023, seed: 17, ...dry }), polyFx),
    // the magazine's parts are baked in the magazine's own frame, so they take no hand occlusion
    mag: patch(mats.gunmetal({ finish: 'phosphate', wear: 0.7, oil: 0.5, seed: 19, ...rest }), { albedo: 0.6, rough: [0.7, 0.2] }),
    magBase: patch(mats.gunmetal({ finish: 'polymer', color: 0x34383a, wear: 0.3, oil: 0.12, seed: 29, ...dry }), { rough: [1.25, 0.74] }),
    follower: patch(mats.gunmetal({ finish: 'polymer', color: 0x7a3a1c, wear: 0.2, oil: 0, seed: 23, ...rest })),
    brass: patch(mats.chrome({ color: 0xb08a48, roughness: 0.2, age: 0.12, dust: 0, ...rest })),
    bullet: patch(mats.chrome({ color: 0xb4744c, roughness: 0.28, age: 0.1, dust: 0, ...rest })),
    white: patch(mats.rubber({ color: 0xcfd2c8, roughness: 0.6, age: 0, dust: 0, ...rest })),
    glow: patch(mats.emissive({ color: 0x8dff6a, nits: 0.55 })),
  };

  const soups = buildSoups();
  const root = new Group();
  root.name = 'pistol';
  const parts = {};
  const meshes = [];
  let triangles = 0;

  const meshOf = (soup, matName) => {
    const geo = soup.toGeometry();
    const u = soup.u;
    mats.bakeRest(geo, { masks: { grip: (x, y, z, i) => (u[i] === 'grip' ? 1 : matName === 'polymer' && u[i] === 'frame' ? strapMask(y / MM, z / MM) : 0) } });
    triangles += soup.triCount;
    const mesh = new Mesh(geo, M[matName]);
    mesh.userData.mat = matName;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };
  // part group with its origin at `pivot` (mm, model space): geometry is recentred after baking
  const part = (name, bucket, pivot = [0, 0, 0]) => {
    const g = new Group();
    g.name = name;
    g.position.set(pivot[0] * MM, pivot[1] * MM, pivot[2] * MM);
    g.userData.rest = g.position.clone();
    g.userData.explode = new Vector3(...(EXPLODE[name] || [0, 0, 0])).multiplyScalar(MM);
    for (const [matName, soup] of Object.entries(bucket)) {
      const mesh = meshOf(soup, matName);
      mesh.geometry.translate(-pivot[0] * MM, -pivot[1] * MM, -pivot[2] * MM);
      g.add(mesh);
    }
    root.add(g);
    parts[name] = g;
    return g;
  };

  part('frame', soups.frame);
  part('slide', soups.slide);
  part('barrel', soups.barrel, [0, 0, -186]);
  part('rod', soups.rod);
  part('safety', soups.safety);
  part('trigger', soups.trigger, [0, TRIGGER_PIVOT[1], TRIGGER_PIVOT[0]]);
  part('hammer', soups.hammer, [0, HAMMER_PIVOT[1], HAMMER_PIVOT[0]]);
  part('stop', soups.stop, [0, STOP_PIVOT[1], STOP_PIVOT[0]]);
  part('magRelease', soups.magRelease);
  // attachments: a reflex sight that rides the slide, a suppressor, a magazine extension
  const rs = reflexSight(-44, 14.2, 27, 10);
  part('att_sight', { slide: rs.body, glow: rs.dot });
  parts.slide.add(parts.att_sight);
  const can = new Soup().add(lathe([[4.7, -336], [13.2, -336], [14.6, -334.5], [14.6, -203], [13.2, -201.5], [7.4, -201.5], [7.4, -196], [0, -196]], { segs: 28 }));
  for (let i = 0; i < 18; i++) can.add(box(14.7, 0, -222, 0.5, 2.6, 30, 0.2), new Matrix4().makeRotationZ((i / 18) * Math.PI * 2));
  part('att_suppressor', { slide: can, black: lathe([[0, -335.9], [4.7, -335.9]], { segs: 20 }) });
  const extGeo = meshOf(plan(outline([[-12.4, -20.5, 4], [12.4, -20.5, 4], [12.4, 18.6, 2.5], [-12.4, 18.6, 2.5]]), -143, -118.5, { b0: 1.5, b1: 0.6, segs: 2 }), 'magBase').geometry;
  meshes.pop(); // (re-added per magazine below)

  // magazines: two instances of the same geometry (the one in the gun and the spare)
  const magGeo = Object.entries(soups.magLocal).map(([matName, soup]) => [matName, meshOf(soup, matName).geometry]);
  const magRest = new Matrix4().makeTranslation(MAG_TOP[0] * MM, MAG_TOP[1] * MM, MAG_TOP[2] * MM).multiply(new Matrix4().makeRotationX(MAG_RAKE));
  const makeMag = (name) => {
    const g = new Group();
    g.name = name;
    const rounds = [];
    for (const [matName, geo] of magGeo) {
      const mesh = new Mesh(geo, M[matName]);
      mesh.frustumCulled = false; mesh.receiveShadow = true;
      if (matName === 'brass' || matName === 'bullet') rounds.push(mesh);
      meshes.push(mesh);
      g.add(mesh);
    }
    g.userData.explode = new Vector3(...EXPLODE.mag).multiplyScalar(MM);
    // seat: 0 = home, d metres = drawn d out of the well along the magazine axis
    g.userData.seat = (d = 0) => {
      magRest.decompose(g.position, g.quaternion, g.scale);
      g.position.addScaledVector(MAG_AXIS, d);
    };
    g.userData.setRounds = (n) => { for (const r of rounds) r.visible = n > 0; };
    g.userData.seat(0);
    root.add(g);
    return g;
  };
  // the magwell plug rides in the magazine's frame but belongs to the gun
  const plug = new Group();
  magRest.decompose(plug.position, plug.quaternion, plug.scale);
  for (const [matName, soup] of Object.entries(soups.frameMagLocal)) plug.add(meshOf(soup, matName));
  parts.frame.add(plug);
  parts.mag = makeMag('mag');
  parts.spare = makeMag('spare');
  parts.spare.visible = false;
  const casing = new Group();
  casing.name = 'casing';
  for (const [matName, soup] of Object.entries(soups.caseLocal)) casing.add(meshOf(soup, matName));
  casing.visible = false;
  root.add(casing);

  const state = { slide: 0, trigger: 0, hammer: 1, stop: 0, magRelease: 0, safety: 0, explode: 0, magD: 0 };
  // slide: metres of travel (0..SLIDE_TRAVEL); trigger 0..1; hammer 0 down .. 1 cocked; stop 0..1
  // (slide stop raised); magRelease 0..1 (button pressed); safety 0 (fire) .. 1 (on).
  function set(s) {
    if (s) Object.assign(state, s);
    const k = Math.min(1, state.slide / 0.012); // the barrel unlocks over the first 12 mm of travel
    const e = state.explode;
    parts.slide.position.set(0, 0, state.slide).addScaledVector(parts.slide.userData.explode, e);
    parts.barrel.position.copy(parts.barrel.userData.rest).addScaledVector(parts.barrel.userData.explode, e);
    parts.barrel.position.z += 0.0028 * k;
    parts.barrel.rotation.x = -0.02 * k; // breech end drops as it unlocks
    parts.rod.position.set(0, 0, 0).addScaledVector(parts.rod.userData.explode, e);
    parts.trigger.rotation.x = TRIGGER_PULL * state.trigger;
    parts.trigger.position.copy(parts.trigger.userData.rest).addScaledVector(parts.trigger.userData.explode, e);
    parts.hammer.rotation.x = HAMMER_COCK * state.hammer;
    parts.hammer.position.copy(parts.hammer.userData.rest).addScaledVector(parts.hammer.userData.explode, e);
    parts.stop.rotation.x = -0.14 * state.stop;
    parts.stop.position.copy(parts.stop.userData.rest).addScaledVector(parts.stop.userData.explode, e);
    parts.magRelease.position.set(0.0016 * state.magRelease, 0, 0).addScaledVector(parts.magRelease.userData.explode, e);
    parts.safety.position.copy(parts.safety.userData.rest).addScaledVector(parts.safety.userData.explode, e);
    parts.safety.rotation.x = 0;
    parts.mag.userData.seat(e > 0 ? 0 : state.magD);
    if (e > 0) parts.mag.position.addScaledVector(parts.mag.userData.explode, e);
  }
  set({});

  // Signed distance (mm) from a model-space point (mm) to the gun, for the grasp solver and the
  // penetration measurement. o.trigger: pull 0..1; o.noTrigger: leave the trigger out.
  // Exact near the gun; further than about 15 mm away it returns a lower bound.
  const boxD = (x, y, z, x0, x1, y0, y1, z0, z1) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1), Math.max(z0 - z, 0, z - z1));
  const bx = (x, y, z, cx, cy, cz, hx, hy, hz) => { const ax = Math.abs(x - cx) - hx, ay = Math.abs(y - cy) - hy, az = Math.abs(z - cz) - hz; return Math.min(Math.max(ax, ay, az), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)); };
  function sdf(x, y, z, o = {}) {
    const far = boxD(x, y, z, -17, 17, -126, 17, -200, 29);
    if (far > 15) return far;
    let d = 1e9, b;
    // frame (2.4 mm rounded edges, as modelled) with its grip panels
    b = boxD(x, y, z, -14.6, 14.6, -124.5, -14.8, -188, 28);
    if (b < 15) {
      d = sdExtrude(sdPoly(FRAME_PROFILE, z, y) + 2.2, x, 13 - 2.2) - 2.2;
      if (y < -40) d = Math.min(d, sdExtrude(sdPoly(PANEL_PROFILE, z, y) + 1, x, 14.6 - 1) - 1);
    }
    b = boxD(x, y, z, -GUARD_HW, GUARD_HW, -66, -26, -100, -35);
    if (b < d) d = Math.min(d, sdExtrude(sdPoly(GUARD_PROFILE, z, y) + 2.2, x, GUARD_HW - 2.2) - 2.2);
    // slide (a box with its shoulders cut), hammer, sights
    const sz = (state.slide / MM);
    d = Math.min(d, Math.max(bx(x, y, z - sz, 0, -2, -98, 13, 12.5, 98), (Math.abs(x) * 8 + (y - 2.5) * 3.4) / 8.69 - 11.42));
    d = Math.min(d, bx(x, y, z, 0, -12, 6.5, 3.3, 14, 4.5), bx(x, y, z - sz, 0, 13, -14, 9, 3, 7.6));
    if (!o.noTrigger) {
      const a = -TRIGGER_PULL * (o.trigger || 0); // rotate the query point back into the trigger's rest frame
      const dy = y - TRIGGER_PIVOT[1], dz = z - TRIGGER_PIVOT[0];
      const ry = dy * Math.cos(a) - dz * Math.sin(a), rz = dy * Math.sin(a) + dz * Math.cos(a);
      if (Math.hypot(dy + 14, dz + 3) < d + 22) d = Math.min(d, sdExtrude(sdPoly(TRIGGER_PROFILE, rz + TRIGGER_PIVOT[0], ry + TRIGGER_PIVOT[1]), x, 3.5));
    }
    // controls the thumbs ride on: slide stop pad, safety shelves, magazine release (boxes)
    d = Math.min(d, bx(x, y, z, -14.6, -17.5, -52, 1.8, 2.2, 16), bx(x, y, z, -14.3, -24, -15, 1.5, 2.4, 12), bx(x, y, z, 14.3, -24, -15, 1.5, 2.4, 12), bx(x, y, z, -13.4, -38, -33, 1.9, 3.4, 3.4));
    return d;
  }

  const model = {
    id: 'pistol', cls: 'pistol', action: 'slide', travel: SLIDE_TRAVEL, lock: 0.041,
    root, parts, set, state, sdf, meshes, materials: M, triangles,
    mag: parts.mag, spare: parts.spare, casing, casingSpin: 34,
    // the spare magazine in the support hand: magazine space -> left-hand space (metres). It stands
    // on the palm just behind the knuckles, fingers up one flat, thumb on its edge
    magInHand: new Matrix4().set(0, 0, -1, 0.002, 0, -1, 0, -0.1365, -1, 0, 0, -0.062, 0, 0, 0, 1), // standing on the middle of the palm, the fingers up round its front
    spareHand: 'mag',
    // Grip landmarks (mm, model space; see arms.js). `at`: where the middle finger's knuckle sits,
    // `back`: from the knuckles to the wrist, `thumb`: toward the thumb side of the hand, `thumbPad`:
    // where the thumb's pad rests, `cup`: how far the little-finger side of the palm folds round.
    hold: {
      twoHand: true,
      trigger: { pivot: [-56, -25.5], face: [-64.2, -44.5], angle: TRIGGER_PULL, lift: 3.4 },
      right: { at: [28, -74.5, -30], back: [-0.24, 0.3, 0.92], thumb: [0, 0.95, -0.31], elbow: [150, -210, 330], thumbKnuckle: [-24, -27, 8], thumbPad: [-27, -17, -38], cup: -0.15 },
      left: { at: [-45, -88, -63], back: [-0.1, 0.45, 0.88], thumb: [0, 0.88, -0.47], elbow: [-190, -330, 190], thumbPad: [-15, -29, -88], cup: 0.1 },
    },
    finish(up) { upgradeFinish(model, !!up, G, patch); },
    magAxis: MAG_AXIS.clone(), // unit vector out of the magwell, model space
    magRest, // Matrix4: seated magazine in model space
    magLength: 0.1215,
    anchors: { // model space, metres
      muzzle: new Vector3(0, 0, -0.199),
      eject: new Vector3(0.0125, 0.007, -0.103),
      sightRear: new Vector3(0, 0.016, -0.0063),
      sightFront: new Vector3(0, 0.016, -0.181),
      sight: new Vector3(0, 0.016, -0.0063), // the rear sight: what the eye lines up when aiming
      support: new Vector3(-0.02, -0.08, -0.06),
      grip: new Vector3(0, -0.058, 0.006), // where the hands hold it: recoil pivots about here
      magwell: new Vector3(...MAG_TOP).multiplyScalar(MM).addScaledVector(MAG_AXIS, 0.111),
      mag: new Vector3(...MAG_TOP).multiplyScalar(MM).addScaledVector(MAG_AXIS, 0.111),
    },
  };
  const magExt = [parts.mag, parts.spare].map((g) => { const m = new Mesh(extGeo, M.magBase); m.frustumCulled = false; m.receiveShadow = true; m.userData.mat = 'magBase'; meshes.push(m); g.add(m); return m; });
  model.attach = fitments(model, {
    sight: { parts: [parts.att_sight], anchors: { sight: new Vector3(0, 0.027, -0.044) } },
    suppressor: { parts: [parts.att_suppressor], anchors: { muzzle: new Vector3(0, 0, -0.336) } },
    mag: { parts: magExt },
  });
  return model;
}
