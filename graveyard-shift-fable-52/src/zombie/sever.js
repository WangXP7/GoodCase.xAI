// Damage on one zombie: wounds where it was shot, a damaged head, severed parts. Nothing here
// touches geometry (it is shared): a wound is a rest-space sphere in the material's uniforms, a
// severed part is its bones collapsed onto the joint (pose.hide) with the cap that is left drawn
// as a stump by the shader. No allocation after construction.
import { Matrix4, Vector3 } from 'three';
import { B } from './skeleton.js';
import { evaluate, project, gradient, march } from './sculpt/sdf.js';
import { HEAD_C } from './sculpt/head.js';

export const SEVER = {
  head: { bones: ['head', 'jaw', 'cap'], slot: 0 },
  armL: { bones: ['foreArmL', 'handL', 'fingAL', 'fingBL', 'thumbL'], slot: 1 },
  armR: { bones: ['foreArmR', 'handR', 'fingAR', 'fingBR', 'thumbR'], slot: 2 },
  legL: { bones: ['shinL', 'footL', 'toeL'], slot: 3 },
  legR: { bones: ['shinR', 'footR', 'toeR'], slot: 4 },
};
const KIND = { bullet: 0, blast: 1, bite: 2 };
const MAX = 8;
const _m = new Matrix4(), _v = new Vector3(), _p = [0, 0, 0], _g = [0, 0, 1];

// zombie: the object buildZombie is assembling (needs hitboxes, skeleton, pose, materials); fig: its sculpt
export function installDamage(zombie, fig) {
  const u = zombie.materials.char.surf;
  const W = u.uChWound.value, K = u.uChWoundK.value, S = u.uChSever.value, WN = u.uChWoundN.value;
  const bones = zombie.skeleton.bones, inv = zombie.skeleton.boneInverses;
  let next = 0, base = 0, head = 0;      // base: wounds the zombie arrived with (kept on reuse)
  zombie.severed = new Set();

  // world -> rest space through the bone nearest the point, then onto the sculpt's surface
  function toRest(wx, wy, wz, snap = true) {
    let best = null, bd = Infinity;
    for (const h of zombie.hitboxes) {
      const e = h.bone.matrixWorld.elements;
      const d = Math.hypot(wx - e[12], wy - e[13], wz - e[14]);
      // distance to the capsule's middle is a good enough pick between neighbours
      _v.set(h.center[0], h.center[1], h.center[2]).applyMatrix4(h.bone.matrixWorld);
      const dc = Math.hypot(wx - _v.x, wy - _v.y, wz - _v.z) - h.radius - h.halfHeight * 0.5;
      if (Math.min(d, dc) < bd) { bd = Math.min(d, dc); best = h; }
    }
    if (!best) return false;
    const i = bones.indexOf(best.bone);
    _m.copy(best.bone.matrixWorld).multiply(inv[i]).invert();
    _v.set(wx, wy, wz).applyMatrix4(_m);
    _p[0] = _v.x; _p[1] = _v.y; _p[2] = _v.z;
    if (!Number.isFinite(_p[0] + _p[1] + _p[2])) return false;
    // onto the skin if it is near (a capsule hit can be a few centimetres off it)
    if (snap && Math.abs(evaluate(fig, _p[0], _p[1], _p[2])) < 0.09) project(fig, _p, -1, 5);
    return true;
  }
  function put(x, y, z, r, kind) {
    const i = next < MAX ? next : base + ((next - base) % Math.max(1, MAX - base));     // the oldest new wound is replaced
    W[i].set(x, y, z, r); K[i] = kind;
    // the way out of the body here: cloth over the wound is measured along it (charBody.js)
    gradient(fig, x, y, z, _g);
    WN[i].set(_g[0], _g[1], _g[2]);
    next++;
    return i;
  }

  // A wound where the zombie was hit. worldPos: {x,y,z} or [x,y,z]. kind: 'bullet' | 'blast' | 'bite'.
  // dir (optional, world, unit): the way the shot travels; with it a bullet also leaves an exit
  // wound on the far side, larger than the entry.
  zombie.addWound = (worldPos, radius = 0.035, kind = 'bullet', dir = null) => {
    const wx = worldPos.x ?? worldPos[0], wy = worldPos.y ?? worldPos[1], wz = worldPos.z ?? worldPos[2];
    if (!toRest(wx, wy, wz, false)) return false;
    // A hit is reported on a capsule, which can stand well off a thin body: carry it on along the
    // shot until it meets the sculpt (or, with no direction, straight down the field), then onto the skin.
    if (evaluate(fig, _p[0], _p[1], _p[2]) > 0.004 && dir) {
      const dx = dir.x ?? dir[0], dy = dir.y ?? dir[1], dz = dir.z ?? dir[2];
      for (let t = 0.01; t < 0.3; t += 0.01) { if (!toRest(wx + dx * t, wy + dy * t, wz + dz * t, false)) break; if (evaluate(fig, _p[0], _p[1], _p[2]) < 0.002) break; }
    }
    if (Math.abs(evaluate(fig, _p[0], _p[1], _p[2])) < 0.25) project(fig, _p, -1, 12);
    const k = KIND[kind] ?? 0;
    put(_p[0], _p[1], _p[2], radius, k);
    if (dir && k === 0) {
      const dx = dir.x ?? dir[0], dy = dir.y ?? dir[1], dz = dir.z ?? dir[2];
      // through the body: step along the shot until it has gone in and come out of the sculpt
      let inside = false;
      for (let t = 0.02; t < 0.6; t += 0.02) {
        if (!toRest(wx + dx * t, wy + dy * t, wz + dz * t, false)) break;
        const d = evaluate(fig, _p[0], _p[1], _p[2]);
        if (d < -0.004) inside = true;
        else if (inside && d > 0) { project(fig, _p, -1, 5); put(_p[0], _p[1], _p[2], radius * 1.7, k); break; }
      }
    }
    return true;
  };
  // 0 = whole, 1 = the jaw is gone, 2 = and part of the skull
  zombie.headDamage = (level) => {
    const l = Math.max(0, Math.min(2, level | 0));
    if (l === head || zombie.severed.has('head')) return head;
    if (l >= 1 && head < 1) { zombie.pose.hide[B.jaw] = 1; S[0] = Math.max(S[0], 0.5); put(0.03, 1.612, 0.05, 0.05, 2); }
    if (l >= 2 && head < 2) {
      // a blast through the side of the brow: centred ON the skull (a centre inside it leaves the
      // surface outside the hole, which is why round 1's state 2 looked like state 1)
      // (low on the side of the brow, so it takes the temple, the socket and the top of the cheek
      // and shows under any hat: high on the crown it hid under a cap and read as state 1)
      const az = zombie.seed % 2 ? 0.8 : -0.8, lat = 0.3, cl = Math.cos(lat);
      const d = [cl * Math.sin(az), Math.sin(lat), cl * Math.cos(az)];
      const h = Math.max(0.06, march(fig, HEAD_C[0], HEAD_C[1], HEAD_C[2], d[0], d[1], d[2], 0.16));
      put(HEAD_C[0] + d[0] * h, HEAD_C[1] + d[1] * h, HEAD_C[2] + d[2] * h, 0.085, 1);
    }
    head = l;
    return head;
  };
  zombie.sever = (part) => {
    const s = SEVER[part];
    if (!s || zombie.severed.has(part)) return false;
    for (const n of s.bones) zombie.pose.hide[B[n]] = 1;
    S[s.slot] = 1;
    zombie.severed.add(part);
    return true;
  };
  // back to how it was built (a pooled body being reused)
  zombie.resetDamage = () => {
    for (let i = base; i < MAX; i++) { W[i].set(0, 0, 0, 0); K[i] = 0; }
    next = base; head = 0;
    zombie.pose.hide.fill(0); S.fill(0);
    zombie.severed.clear();
    if (zombie.look.severed) zombie.sever(`arm${zombie.look.severed}`);
  };
  // the wounds of its look
  for (const w of zombie.look.wounds) put(w[0], w[1], w[2], w[3], w[4] ?? 2);
  base = next;
  if (zombie.look.severed) zombie.sever(`arm${zombie.look.severed}`);
  Object.defineProperty(zombie, 'damaged', { get: () => next > base || head > 0 || zombie.severed.size > (zombie.look.severed ? 1 : 0) });
}
