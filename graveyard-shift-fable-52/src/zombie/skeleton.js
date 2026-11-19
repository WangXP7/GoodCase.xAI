// Zombie skeleton: bone table, per-seed proportions, and a forward-kinematics pass that writes
// world matrices straight into detached three Bones (no scene-graph traversal, no allocation).
//
// Conventions. Model space is metres, Y up, feet on y = 0, the figure faces +Z and its LEFT side
// is +X. Every bone's rest rotation is identity, so a bone's local axes are the model axes in the
// rest pose (legs hang along -Y; the arms are built in an A-pose, ARM_ABDUCT out from the body, so
// the shoulder and armpit are modelled open and deform well both down and up). Geometry is
// shared between zombies and built on the base figure below; a zombie's own build comes from
// per-bone skin scales (girth, length) and the joint offsets that follow from them.
import { Bone, Skeleton, Matrix4 } from 'three';

export const ARM_ABDUCT = 0.6; // rad: how far the rest-pose arms hang out from vertical (A-pose)
// arm lengths of the base figure: shoulder to elbow, elbow to wrist (fingertips reach mid-thigh)
export const ARM_U = 0.31, ARM_F = 0.26;

export const SHOULDER = [0.186, 1.405, -0.012]; // centre of the head of the humerus
// a point given along a straight-down arm (dx, dy below the shoulder, dz) rotated out by ARM_ABDUCT
export function armPoint(dx, dy, dz) {
  const c = Math.cos(ARM_ABDUCT), s = Math.sin(ARM_ABDUCT);
  return [SHOULDER[0] + dx * c - dy * s, SHOULDER[1] + dx * s + dy * c, SHOULDER[2] + dz];
}

// [name, parent, rest joint position]. Left side only for limbs; the right is mirrored below.
const CORE = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.975, -0.005]],
  ['spine1', 'hips', [0, 1.085, -0.018]],
  ['spine2', 'spine1', [0, 1.255, -0.03]],
  ['neck', 'spine2', [0, 1.492, -0.028]],
  ['head', 'neck', [0, 1.598, -0.006]],
  ['jaw', 'head', [0, 1.622, 0.008]],
  ['cap', 'head', [0, 1.7, 0]],   // headwear rides here so it can sit askew per zombie
];
const LEFT = [
  ['clav', 'spine2', [0.03, 1.44, -0.01]],
  ['upperArm', 'clav', SHOULDER],
  ['foreArm', 'upperArm', armPoint(0, -ARM_U, 0)],
  ['hand', 'foreArm', armPoint(0, -(ARM_U + ARM_F), 0.012)],
  ['fingA', 'hand', armPoint(0.004, -(ARM_U + ARM_F + 0.092), 0.014)],
  ['fingB', 'fingA', armPoint(0.005, -(ARM_U + ARM_F + 0.126), 0.014)],
  ['thumb', 'hand', armPoint(-0.004, -(ARM_U + ARM_F + 0.028), 0.036)],
  ['thigh', 'hips', [0.094, 0.932, 0]],
  ['shin', 'thigh', [0.1, 0.502, 0.004]],
  ['foot', 'shin', [0.104, 0.092, -0.012]],
  ['toe', 'foot', [0.108, 0.03, 0.118]],
];

export const BONES = [];
for (const [name, parent, pos] of CORE) BONES.push({ name, parent, pos });
for (const side of ['L', 'R']) {
  for (const [name, parent, pos] of LEFT) {
    const p = side === 'L' ? pos.slice() : [-pos[0], pos[1], pos[2]];
    const par = CORE.some((c) => c[0] === parent) ? parent : parent + side;
    BONES.push({ name: name + side, parent: par, pos: p });
  }
}
export const NB = BONES.length;
export const B = {};
BONES.forEach((b, i) => { B[b.name] = i; });
export const PARENT = new Int8Array(NB);
BONES.forEach((b, i) => { PARENT[i] = b.parent === null ? -1 : B[b.parent]; });
export const REST = new Float32Array(NB * 3); // base figure joint positions
BONES.forEach((b, i) => { REST.set(b.pos, i * 3); });

export const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

// Limb dimensions of the base figure, used by IK and the gait.
export const DIM = {
  thigh: 0.43, shin: 0.41, ankle: 0.092, upperArm: ARM_U, foreArm: ARM_F, hand: 0.185,
  heelBack: 0.075, ballFwd: 0.13, toeLen: 0.09, hipW: 0.094,
};

// Hit capsules in bone space: `center` is the capsule middle, `axis` its direction (unit; the
// bone's local Y for everything but the arms, which lie along the A-pose arm).
const AX = [Math.sin(ARM_ABDUCT), -Math.cos(ARM_ABDUCT), 0];
const HITBOX_BASE = [
  ['head', 'head', 0.105, 0.03, [0, 0.085, 0.01]],
  ['head', 'neck', 0.06, 0.04, [0, 0.05, 0.005]],
  ['torso', 'spine2', 0.165, 0.09, [0, 0.11, 0.015]],
  ['torso', 'spine1', 0.155, 0.06, [0, 0.07, 0.02]],
  ['torso', 'hips', 0.16, 0.04, [0, -0.01, 0.005]],
  ['armL', 'upperArmL', 0.06, 0.13, [AX[0] * 0.15, AX[1] * 0.15, 0], AX],
  ['armL', 'foreArmL', 0.05, 0.19, [AX[0] * 0.19, AX[1] * 0.19, 0.01], AX],
  ['armR', 'upperArmR', 0.06, 0.13, [-AX[0] * 0.15, AX[1] * 0.15, 0], [-AX[0], AX[1], 0]],
  ['armR', 'foreArmR', 0.05, 0.19, [-AX[0] * 0.19, AX[1] * 0.19, 0.01], [-AX[0], AX[1], 0]],
  ['legL', 'thighL', 0.09, 0.19, [0.003, -0.215, 0]],
  ['legL', 'shinL', 0.065, 0.24, [0.002, -0.225, 0.01]],
  ['legR', 'thighR', 0.09, 0.19, [-0.003, -0.215, 0]],
  ['legR', 'shinR', 0.065, 0.24, [-0.002, -0.225, 0.01]],
];

// Build variation from a seeded rng: per-bone skin scale (x, y, z in model axes at rest). The build
// itself (gaunt .. brute) is sculpted (sculpt/figure.js); what is left here is this zombie's own
// height, limb length and a little girth, and the brute's size: 1.35 times a person in every bone,
// which is a build, not a scaled mesh. `fit` re-fits the hit capsules to the sculpt of that build.
const FIT = { gaunt: [0.92, 0.88, 0.9], average: [1, 1, 1], heavy: [1.2, 1.15, 1.15], bloated: [1.38, 1.2, 1.2], brute: [1.22, 1.35, 1.25] };
export function makeProportions(rng, variant, sex = 'm', build = 'average') {
  const sc = new Float32Array(NB * 3).fill(1);
  const set = (name, x, y, z) => { const i = B[name] * 3; sc[i] *= x; sc[i + 1] *= y; sc[i + 2] *= z; };
  const both = (name, x, y, z) => { set(name + 'L', x, y, z); set(name + 'R', x, y, z); };
  const fem = sex === 'f';
  const heavy = build === 'heavy' || build === 'bloated' ? 1 : build === 'gaunt' ? 0 : 0.4;
  const height = (fem ? rng.range(0.9, 0.965) : rng.range(0.965, 1.045)) * (build === 'brute' ? 1.35 : 1);
  const legLen = rng.range(0.975, 1.03);
  const limb = 1 + rng.range(-0.035, 0.035);
  const trunk = 1 + rng.range(-0.03, 0.04);
  set('hips', trunk, 1, trunk);
  set('spine1', trunk, rng.range(0.97, 1.03), trunk);
  set('spine2', trunk * rng.range(0.98, 1.03), rng.range(0.98, 1.03), trunk);
  set('neck', 1, rng.range(0.95, 1.05), 1);
  const hs = rng.range(0.985, 1.03) / (build === 'brute' ? 1.12 : 1);
  set('head', hs * rng.range(0.98, 1.04), hs, hs);
  if (fem) set('clavL', 0.92, 1, 1), set('clavR', 0.92, 1, 1);
  both('upperArm', limb, rng.range(0.98, 1.03), limb);
  both('foreArm', limb * 0.98, 1, limb * 0.98);
  both('thigh', limb, legLen, limb);
  both('shin', limb, legLen, limb);
  // The face is shared by a sex and build; the skull is not. Each zombie has its own head: long
  // or broad, deep or flat, and its own jaw: heavy, narrow, undershot or weak (the lower face
  // rides the jaw bone). Headwear takes the head's scale so it still fits.
  const face = rng.fork('face');
  const kind = face.int(0, 3);        // 0 long and narrow, 1 broad and short, 2 heavy-jawed, 3 small-jawed
  const hx = [0.945, 1.075, 1.01, 0.985][kind] + face.range(-0.02, 0.02), hy = [1.055, 0.955, 1.0, 1.015][kind] + face.range(-0.015, 0.015), hz = [1.0, 1.03, 0.975, 1.02][kind] + face.range(-0.015, 0.015);
  set('head', hx, hy, hz); set('cap', sc[B.head * 3], sc[B.head * 3 + 1], sc[B.head * 3 + 2]);
  // (the jaw's scale stays within a few per cent of the skull's: the lower face is weighted to the
  // jaw and the rest to the head, and a bigger difference showed as a step where they meet. The
  // shape of the face itself is a choice of sculpt: variants.js `face`.)
  const jx = [0.97, 1.04, 1.06, 0.95][kind] + face.range(-0.012, 0.012), jy = [1.04, 0.97, 1.05, 0.96][kind] + face.range(-0.012, 0.012), jz = [1.0, 1.0, 1.02, 0.985][kind] + face.range(-0.006, 0.006);
  set('jaw', hx * jx, hy * jy, hz * jz);
  for (let i = 0; i < NB * 3; i++) sc[i] *= height;
  return { scale: sc, heavy, height, sex, build, fit: FIT[build] || FIT.average };
}

// One zombie's skeleton: three Bones (detached from the scene graph, matrices written by solveFK),
// local offsets for its build, and the pose buffers the animator fills.
export function createSkeleton(prop) {
  const bones = [];
  const inverses = [];
  for (let i = 0; i < NB; i++) {
    const b = new Bone();
    b.name = BONES[i].name;
    b.matrixAutoUpdate = false;
    b.matrixWorldAutoUpdate = false;
    bones.push(b);
    inverses.push(new Matrix4().makeTranslation(-REST[i * 3], -REST[i * 3 + 1], -REST[i * 3 + 2]));
  }
  const skeleton = new Skeleton(bones, inverses);
  const sc = prop.scale;
  const off = new Float32Array(NB * 3);
  for (let i = 0; i < NB; i++) {
    const p = PARENT[i];
    for (let k = 0; k < 3; k++) {
      off[i * 3 + k] = p < 0 ? REST[i * 3 + k] : (REST[i * 3 + k] - REST[p * 3 + k]) * sc[p * 3 + k];
    }
  }
  const lq = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) lq[i * 4 + 3] = 1;
  const pose = {
    off,                               // local joint offsets for this build
    restOff: off.slice(),
    scale: sc,
    lq,                                // local rotations (quaternions), written by the animator
    wq: new Float32Array(NB * 4),      // world rotations, written by solveFK
    wp: new Float32Array(NB * 3),      // world joint positions, written by solveFK
    hide: new Uint8Array(NB),          // 1 = collapse this bone's skin to a point (severed parts)
    // this zombie's own carriage: a rotation applied after the animator's on a few bones (spine,
    // neck, head, collar bones), so a hunch or a tilted head rides through every clip
    bias: new Float32Array(NB * 4), biasOn: new Uint8Array(NB),
  };
  const hitboxes = HITBOX_BASE.map(([part, bone, radius, halfHeight, c, axis]) => {
    const i = B[bone] * 3;
    const fit = prop.fit || [1, 1, 1];
    const g = (sc[i] + sc[i + 2]) * 0.5 * (part === 'torso' ? fit[0] : part === 'head' ? 1 : part[0] === 'a' ? fit[1] : fit[2]);
    return { part, bone: bones[B[bone]], radius: radius * g, halfHeight: halfHeight * sc[i + 1], center: [c[0] * sc[i], c[1] * sc[i + 1], c[2] * sc[i + 2]], axis: axis || [0, 1, 0] };
  });
  return { skeleton, bones, pose, hitboxes };
}

// World transforms from local rotations. rootP / rootQ are the mesh's world position and rotation.
// Set a bone's carriage bias from Euler angles (radians: pitch about x, yaw about y, roll about z).
export function setBias(pose, bone, pitch, yaw, roll) {
  const cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2), cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cz = Math.cos(roll / 2), sz = Math.sin(roll / 2);
  const i = bone * 4, b = pose.bias;
  b[i] = sx * cy * cz + cx * sy * sz; b[i + 1] = cx * sy * cz - sx * cy * sz; b[i + 2] = cx * cy * sz + sx * sy * cz; b[i + 3] = cx * cy * cz - sx * sy * sz;
  pose.biasOn[bone] = Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll) > 1e-5 ? 1 : 0;
}

export function solveFK(bones, pose, rootP, rootQ, from = 0, matrices = true) {
  const { off, lq, wq, wp, scale, hide } = pose;
  for (let i = from; i < NB; i++) {
    const p = PARENT[i];
    const i3 = i * 3, i4 = i * 4;
    let px, py, pz, qx, qy, qz, qw;
    if (p < 0) { px = rootP[0]; py = rootP[1]; pz = rootP[2]; qx = rootQ[0]; qy = rootQ[1]; qz = rootQ[2]; qw = rootQ[3]; } else {
      px = wp[p * 3]; py = wp[p * 3 + 1]; pz = wp[p * 3 + 2];
      qx = wq[p * 4]; qy = wq[p * 4 + 1]; qz = wq[p * 4 + 2]; qw = wq[p * 4 + 3];
    }
    // world position = parent position + parent rotation * local offset
    const ox = off[i3], oy = off[i3 + 1], oz = off[i3 + 2];
    const tx = 2 * (qy * oz - qz * oy), ty = 2 * (qz * ox - qx * oz), tz = 2 * (qx * oy - qy * ox);
    const x = px + ox + qw * tx + (qy * tz - qz * ty);
    const y = py + oy + qw * ty + (qz * tx - qx * tz);
    const z = pz + oz + qw * tz + (qx * ty - qy * tx);
    wp[i3] = x; wp[i3 + 1] = y; wp[i3 + 2] = z;
    // world rotation = parent rotation * local rotation
    let ax = lq[i4], ay = lq[i4 + 1], az = lq[i4 + 2], aw = lq[i4 + 3];
    if (pose.biasOn[i]) {
      const b = pose.bias, bx = b[i4], by = b[i4 + 1], bz = b[i4 + 2], bw = b[i4 + 3];
      const cx = aw * bx + ax * bw + ay * bz - az * by, cy = aw * by - ax * bz + ay * bw + az * bx, cz = aw * bz + ax * by - ay * bx + az * bw;
      aw = aw * bw - ax * bx - ay * by - az * bz; ax = cx; ay = cy; az = cz;
    }
    const rx = qw * ax + qx * aw + qy * az - qz * ay;
    const ry = qw * ay - qx * az + qy * aw + qz * ax;
    const rz = qw * az + qx * ay - qy * ax + qz * aw;
    const rw = qw * aw - qx * ax - qy * ay - qz * az;
    wq[i4] = rx; wq[i4 + 1] = ry; wq[i4 + 2] = rz; wq[i4 + 3] = rw;
    if (!matrices) continue;
    const e = bones[i].matrixWorld.elements;
    const h = hide[i] ? 1e-4 : 1;
    const sx = scale[i3] * h, sy = scale[i3 + 1] * h, sz = scale[i3 + 2] * h;
    const x2 = rx + rx, y2 = ry + ry, z2 = rz + rz;
    const xx = rx * x2, xy = rx * y2, xz = rx * z2, yy = ry * y2, yz = ry * z2, zz = rz * z2;
    const wx = rw * x2, wy = rw * y2, wz = rw * z2;
    e[0] = (1 - (yy + zz)) * sx; e[1] = (xy + wz) * sx; e[2] = (xz - wy) * sx; e[3] = 0;
    e[4] = (xy - wz) * sy; e[5] = (1 - (xx + zz)) * sy; e[6] = (yz + wx) * sy; e[7] = 0;
    e[8] = (xz + wy) * sz; e[9] = (yz - wx) * sz; e[10] = (1 - (xx + yy)) * sz; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    // a hidden bone under a hidden parent collapses onto the cut, not onto its own joint (else the
    // severed forearm is left hanging as a sliver between elbow, wrist and knuckles)
    if (h < 1 && p >= 0 && hide[p]) { const pe = bones[p].matrixWorld.elements; e[12] = pe[12]; e[13] = pe[13]; e[14] = pe[14]; }
  }
}
