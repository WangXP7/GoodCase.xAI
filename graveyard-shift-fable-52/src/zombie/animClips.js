// Keyed body poses for the fence climb and the window (the collapse is a ragdoll: ragdoll.js).
// A key gives the pelvis, the spine and head angles, and where the four limb ends are; the animator
// solves the limbs by IK, so hands and feet end up exactly where a key puts them (on the ground,
// on the fence rail) and nothing has to be authored joint by joint.
//
// key = { t, e, pel:[x,y,z,pitch,yaw,roll], sp:[s1 pitch, s1 roll, s2 pitch, s2 yaw, s2 roll],
//         hd:[neck pitch, head pitch, head yaw, head roll, jaw],
//         hand:[[x,y,z,space,poleY] x2], foot:[[x,y,z,pitch,yaw,roll,poleY] x2] }
// foot poleY: +1 knee up, 0 knee forward, -1 knee out sideways along the ground.
// Positions are model space (root at the origin, +z forward, +x the figure's left, y from the
// ground). hand space 1 = relative to the chest instead. e: 0 linear, 1 ease-in (falling),
// 2 ease-out (settling), 3 both. Index 0 is the left limb. A missing entry keeps the previous key.

const K = (t, e, pel, sp, hd, hand, foot) => ({ t, e, pel, sp, hd, hand, foot });

// Climb over a rail of height h whose plane is d0 ahead of the root at the start. Positions are in
// climb space (the root's frame at the start); the animator subtracts the distance the root has
// travelled since. The clip ends crouched on the far side; standing up is ordinary locomotion.
export function climbKeys(h, d0, stand, ankle) {
  const up = Math.max(0.2, h - 0.72);
  return [
    K(0.45, 3, [0, stand * 0.97, 0.08, 0.2, 0, 0], [0.05, 0, 0.1, 0, 0], [-0.1, -0.25, 0, 0, 0.3], [[0.2, h + 0.02, d0, 0, -1], [-0.18, h + 0.02, d0, 0, -1]], null),
    K(1.25, 3, [0.02, h - 0.13, d0 - 0.15, 0.3, 0.06, 0.05], [0.1, 0, 0.15, 0, 0], [-0.15, -0.2, 0, 0.1, 0.4], [[0.2, h + 0.02, d0, 0, -1], [-0.18, h + 0.02, d0, 0, -1]], [[0.11, up, d0 - 0.1, 0.5, 0, 0, 1], [-0.1, Math.max(ankle, up - 0.3), d0 - 0.16, 0.6, 0, 0, 1]]),
    K(1.95, 3, [0, h + 0.07, d0 + 0.03, 1.38, 0.08, 0.1], [0.2, 0, 0.25, 0, 0], [0.2, 0.1, 0, 0, 0.3], [[0.24, h - 0.4, d0 + 0.36, 0, 0], [-0.2, h - 0.3, d0 + 0.3, 0, 0]], [[0.14, h + 0.12, d0 - 0.5, 1.0, 0.2, 0, 0], [-0.12, h + 0.02, d0 - 0.42, 1.0, -0.2, 0, 0]]),
    K(2.42, 1, [0.03, 0.74, d0 + 0.42, 0.95, 0.05, 0.22], [0.3, 0, 0.3, 0, 0], [0.1, -0.2, 0, 0.1, 0.4], [[0.24, 0.3, d0 + 0.85, 0, 0], [-0.22, 0.4, d0 + 0.8, 0, 0]], [[0.12, h * 0.55, d0 + 0.1, 0.4, 0.2, 0, 1], [-0.1, h * 0.75, d0 - 0.05, 0.6, -0.2, 0, 1]]),
    K(2.78, 1, [0.02, 0.56, d0 + 0.56, 0.8, 0, 0.05], [0.25, 0, 0.25, 0, 0], [-0.1, -0.3, 0, 0.05, 0.3], [[0.26, 0.045, d0 + 0.98, 0, 1], [-0.24, 0.045, d0 + 0.94, 0, 1]], [[0.13, ankle, d0 + 0.44, 0, 0.25, 0, 1], [-0.11, ankle, d0 + 0.62, 0, -0.2, 0, 1]]),
  ];
}

// Through a window: head and shoulders first over a sill of height h whose wall plane is d0 ahead
// of the root. Hands on the sill, the chest laid on it, the weight tipped over onto the hands on
// the floor inside, the legs dragged in after. Ends crouched inside, as the fence climb does.
export function windowKeys(h, d0, stand, ankle) {
  const s = Math.max(0.55, h);
  return [
    K(0.4, 3, [0, stand * 0.95, d0 - 0.46, 0.45, 0, 0], [0.1, 0, 0.15, 0, 0], [-0.2, -0.3, 0, 0, 0.35], [[0.2, s + 0.03, d0 + 0.02, 0, -1], [-0.18, s + 0.03, d0 + 0.02, 0, -1]], null),
    K(1.0, 3, [0, s - 0.03, d0 - 0.34, 1.15, 0, 0.08], [0.1, 0, 0.12, 0, 0], [-0.35, -0.45, 0, 0.1, 0.55], [[0.22, s - 0.22, d0 + 0.44, 0, 0], [-0.2, s - 0.12, d0 + 0.38, 0, 0]], [[0.11, ankle, d0 - 0.82, 0.55, 0, 0, 0], [-0.1, ankle, d0 - 0.7, 0.4, 0, 0, 0]]),
    K(1.7, 3, [0.02, s + 0.07, d0 + 0.04, 1.8, 0.05, 0.12], [0.15, 0, 0.2, 0, 0], [-0.3, -0.5, 0, 0.1, 0.4], [[0.24, 0.05, d0 + 0.6, 0, 1], [-0.22, 0.05, d0 + 0.56, 0, 1]], [[0.13, s + 0.14, d0 - 0.58, 1.1, 0.2, 0, 0], [-0.11, s + 0.02, d0 - 0.5, 1.0, -0.2, 0, 0]]),
    K(2.3, 1, [0.03, 0.55, d0 + 0.5, 1.2, 0, 0.2], [0.25, 0, 0.25, 0, 0], [-0.2, -0.4, 0, 0.1, 0.4], [[0.25, 0.045, d0 + 0.94, 0, 1], [-0.23, 0.045, d0 + 0.9, 0, 1]], [[0.12, s + 0.04, d0 - 0.12, 1.1, 0.2, 0, 0], [-0.1, s * 0.6, d0 + 0.02, 0.8, -0.2, 0, 1]]),
    K(2.8, 1, [0.02, 0.56, d0 + 0.62, 0.8, 0, 0.05], [0.25, 0, 0.25, 0, 0], [-0.1, -0.3, 0, 0.05, 0.3], [[0.26, 0.045, d0 + 1.04, 0, 1], [-0.24, 0.045, d0 + 1.0, 0, 1]], [[0.13, ankle, d0 + 0.5, 0, 0.25, 0, 1], [-0.11, ankle, d0 + 0.68, 0, -0.2, 0, 1]]),
  ];
}

// A playable copy: scaled, optionally mirrored, with the live pose as key 0.
export function buildClip(keys, first, scale, mirror) {
  const out = [first];
  let prev = first;
  for (const k of keys) {
    const c = { t: k.t, e: k.e, pel: k.pel.slice(), sp: k.sp.slice(), hd: k.hd.slice(), hand: null, foot: null };
    c.pel[0] *= scale; c.pel[1] *= scale; c.pel[2] *= scale;
    const limb = (src, prevL) => (src ? src.map((a) => { const b = a.slice(); b[0] *= scale; b[1] *= scale; b[2] *= scale; return b; }) : prevL.map((a) => a.slice()));
    c.hand = limb(k.hand, prev.hand);
    c.foot = limb(k.foot, prev.foot);
    if (mirror) {
      c.pel[0] = -c.pel[0]; c.pel[4] = -c.pel[4]; c.pel[5] = -c.pel[5];
      c.sp[1] = -c.sp[1]; c.sp[3] = -c.sp[3]; c.sp[4] = -c.sp[4];
      c.hd[2] = -c.hd[2]; c.hd[3] = -c.hd[3];
      if (k.hand) { c.hand.reverse(); for (const a of c.hand) a[0] = -a[0]; }
      if (k.foot) { c.foot.reverse(); for (const a of c.foot) { a[0] = -a[0]; a[4] = -a[4]; a[5] = -a[5]; } }
    }
    out.push(c);
    prev = c;
  }
  return out;
}

// Which two keys bracket time t, and how far between them (eased). Returns the segment index.
export function clipAt(clip, t, res) {
  let i = 0;
  while (i < clip.length - 2 && t > clip[i + 1].t) i++;
  const a = clip[i], b = clip[i + 1];
  let u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  if (b.e === 1) u *= u;
  else if (b.e === 2) u = 1 - (1 - u) * (1 - u);
  else if (b.e === 3) u = u * u * (3 - 2 * u);
  res.a = a; res.b = b; res.u = u;
  return i;
}
