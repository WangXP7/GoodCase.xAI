// The hand as sculpt primitives: palm, heel pads, a thumb and four fingers of three joints each,
// with knuckle swellings, hanging slightly curled. Built in a hand frame at the wrist of the A-pose
// arm: `al` runs along the arm to the fingertips, `ac` across the palm (thumb side positive, +z in
// rest space), `up` out of the back of the hand.
import { armPoint, ARM_ABDUCT, ARM_U, ARM_F } from '../skeleton.js';

const S = Math.sin(ARM_ABDUCT), C = Math.cos(ARM_ABDUCT);
export const WRIST = armPoint(0, -(ARM_U + ARM_F), 0.012);
export const handPoint = (al, ac, up) => [WRIST[0] + S * al + C * up, WRIST[1] - C * al + S * up, WRIST[2] + ac];
export const HAND_ROT = [0, 0, Math.PI + ARM_ABDUCT];   // primitive x = palm side, y = along, z = across

// [name, across at the knuckle, along at the knuckle, length, radius scale, spread]
const FINGERS = [['index', 0.032, 0.094, 0.074, 1, 0.1], ['middle', 0.0105, 0.098, 0.082, 1.03, 0.02], ['ring', -0.0105, 0.094, 0.076, 0.96, -0.07], ['pinky', -0.03, 0.085, 0.06, 0.84, -0.16]];
const CURL = [0.16, 0.5, 0.8];        // cumulative bend of each joint toward the palm
const SEG = [0.45, 0.3, 0.25];

export function sculptHand(F, q) {
  const hs = 1 - 0.07 * q.fem + 0.14 * q.brute + 0.05 * Math.max(0, q.fat);
  const HN = 'handL', FA = 'fingAL', FB = 'fingBL', TH = 'thumbL';
  const P = (al, ac, up) => handPoint(al * hs, ac * hs, up * hs);
  F.group = 2;
  // wrist and palm: a slab, thicker at the heel, with the two pads
  F.ell(HN, P(0, 0.002, 0), [0.019 * hs, 0.024 * hs, 0.0285 * hs], { k: 0.012, rot: HAND_ROT, fall: 0.03 });
  F.ell(HN, P(0.05, 0.002, 0), [0.0125 * hs, 0.054 * hs, 0.041 * hs], { k: 0.012, rot: HAND_ROT, fall: 0.03 });
  F.cone(HN, P(0.086, -0.027, 0), P(0.092, 0.03, 0), 0.0098 * hs, 0.0108 * hs, { k: 0.008, fall: 0.02 });                       // the row of knuckles
  F.ell(HN, P(0.034, 0.024, -0.008), [0.011 * hs, 0.026 * hs, 0.016 * hs], { k: 0.008, rot: HAND_ROT, fall: 0 });     // thenar
  F.ell(HN, P(0.036, -0.026, -0.006), [0.009 * hs, 0.03 * hs, 0.012 * hs], { k: 0.008, rot: HAND_ROT, fall: 0 });     // hypothenar
  const fingers = [];
  for (const [name, ac, al, len, rs, spread] of FINGERS) {
    const r = [0.0099 * rs * hs, 0.009 * rs * hs, 0.0081 * rs * hs, 0.007 * rs * hs];
    const pts = [P(al - 0.022, ac * 0.92, 0), P(al, ac, 0)];
    let a = al, c = ac, u = 0;
    for (let k = 0; k < 3; k++) {
      const l = len * SEG[k];
      a += Math.cos(CURL[k]) * l; u -= Math.sin(CURL[k]) * l; c += spread * l;
      pts.push(P(a, c, u));
    }
    // metacarpal head on the back of the hand, then three joints
    F.ell(HN, P(al - 0.004, ac, 0.0035), [0.0085 * hs, 0.011 * hs, 0.0092 * rs * hs], { k: 0.004, rot: HAND_ROT, fall: 0 });
    F.cone(FA, pts[1], pts[2], r[0], r[1], { k: 0.0022, fall: 0.012 });
    F.cone(FB, pts[2], pts[3], r[1], r[2], { k: 0.0022, fall: 0.012 });
    F.cone(FB, pts[3], pts[4], r[2], r[3], { k: 0.0022, fall: 0.012 });
    for (let k = 2; k <= 3; k++) {
      const up = [C * 0.0012, S * 0.0012, 0];
      F.ell(k === 2 ? FB : FB, [pts[k][0] + up[0], pts[k][1] + up[1], pts[k][2]], [r[k - 1] + 0.0007, r[k - 1] + 0.0007, r[k - 1] + 0.0009], { k: 0.002, fall: 0 });
    }
    fingers.push({ name, pts, r });
  }
  // thumb: its own mound at the heel of the hand, two joints, pointing forward and across
  const t0 = P(0.02, 0.028, -0.006);
  const dir = (a, c, u) => { const l = Math.hypot(a, c, u); return [a / l, c / l, u / l]; };
  const d1 = dir(0.62, 0.74, -0.25), d2 = dir(0.78, 0.55, -0.3), d3 = dir(0.9, 0.3, -0.32);
  const step = (p, d, l) => { const o = handPoint(d[0] * l * hs, d[1] * l * hs, d[2] * l * hs); return [p[0] + o[0] - WRIST[0], p[1] + o[1] - WRIST[1], p[2] + o[2] - WRIST[2]]; };
  // (a thumb is short: the first bone is in the heel of the hand, then two joints with knuckles
  // wider than the shafts between them and a flattened end)
  const t1 = step(t0, d1, 0.034), t2 = step(t1, d2, 0.027), t3 = step(t2, d3, 0.021);
  F.cone(TH, t0, t1, 0.0125 * hs, 0.0098 * hs, { k: 0.008, fall: 0.014 });
  F.cone(TH, t1, t2, 0.0088 * hs, 0.0082 * hs, { k: 0.002, fall: 0.012 });
  F.cone(TH, t2, t3, 0.0084 * hs, 0.0072 * hs, { k: 0.002, fall: 0.012 });
  F.ell(TH, t1, [0.0116 * hs, 0.0116 * hs, 0.0112 * hs], { k: 0.0015, fall: 0 });
  F.ell(TH, t2, [0.0102 * hs, 0.0102 * hs, 0.0098 * hs], { k: 0.0015, fall: 0 });
  F.ell(TH, [(t2[0] + t3[0] * 2) / 3, (t2[1] + t3[1] * 2) / 3, (t2[2] + t3[2] * 2) / 3], [0.0088 * hs, 0.0098 * hs, 0.0078 * hs], { k: 0.002, rot: HAND_ROT, fall: 0 });
  F.marks.fingers = fingers;
  F.marks.thumb = { name: 'thumb', pts: [step(t0, d1, -0.012), t0, t1, t2, t3], r: [0.0125 * hs, 0.0105 * hs, 0.009 * hs, 0.0074 * hs] };
  F.marks.handScale = hs;
}
