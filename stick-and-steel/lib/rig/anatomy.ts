import { Matrix4, Quaternion, Vector3 } from 'three';
import { solveTwoBone, vec } from './ik';

export type AngularLimits = readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
const rad = (v: number) => v * Math.PI / 180;
const pair = (v: [number, number]): [number, number] => [rad(v[0]), rad(v[1])];
const limits = (x: [number, number], y: [number, number], z: [number, number]): AngularLimits => [pair(x), pair(y), pair(z)];

// Stylized humanoid ranges, expressed in the same local frames as Rapier.
export const ANATOMY = {
  shoulder: limits([-155, 75], [-70, 70], [-105, 105]),
  hip: limits([-100, 50], [-40, 40], [-55, 55]),
  wrist: limits([-50, 50], [-65, 65], [-30, 30]),
  ankle: limits([-55, 55], [-25, 25], [-25, 25]),
  spine: limits([-25, 25], [-25, 25], [-20, 20]),
  neck: limits([-40, 40], [-65, 65], [-30, 30]),
  elbow: [-rad(145), -rad(6)] as const,
  knee: [rad(6), rad(145)] as const,
};
export const LIMB_VISUAL_ROTATION = new Quaternion().setFromAxisAngle(vec([1, 0, 0]), Math.PI);

// Rapier 0.19's uncoupled angular limits use quaternion imaginary components
// (sin of half-angle), not Euler angles. Canonicalize q and -q identically.
export function jointCoordinates(rotation: Quaternion) {
  const q = rotation.clone().normalize();
  const sign = q.w < 0 ? -1 : 1;
  return [q.x, q.y, q.z].map(v => 2 * Math.asin(Math.max(-1, Math.min(1, v * sign))));
}

export function clampRotation(rotation: Quaternion, bounds: AngularLimits) {
  const q = rotation.clone().normalize();
  const sign = q.w < 0 ? -1 : 1;
  const xyz = [q.x, q.y, q.z].map((v, i) => Math.max(Math.sin(bounds[i][0] / 2), Math.min(Math.sin(bounds[i][1] / 2), v * sign)));
  return new Quaternion(xyz[0], xyz[1], xyz[2], Math.sqrt(Math.max(0, 1 - xyz.reduce((s, v) => s + v * v, 0)))).normalize();
}

export function boundedWorldRotation(parent: Quaternion, desired: Quaternion, bounds: AngularLimits) {
  return parent.clone().multiply(clampRotation(parent.clone().invert().multiply(desired), bounds));
}

/** Shared bend-plane frame: both bones have the same local X hinge axis. */
export function solveLimb(start: Vector3, target: Vector3, pole: Vector3, a: number, b: number, parent: Quaternion, arm: boolean) {
  const ik = solveTwoBone(start, target, pole, a, b, [rad(6), rad(145)]);
  const upperDirection = ik.middle.clone().sub(start).normalize();
  const lowerDirection = ik.end.clone().sub(ik.middle).normalize();
  const x = (arm ? lowerDirection.clone().cross(upperDirection) : upperDirection.clone().cross(lowerDirection)).normalize();
  const y = upperDirection.clone().negate();
  const z = x.clone().cross(y).normalize();
  const upper = boundedWorldRotation(parent, new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)), arm ? ANATOMY.shoulder : ANATOMY.hip);
  const bend = Math.acos(Math.max(-1, Math.min(1, upperDirection.dot(lowerDirection)))) * (arm ? -1 : 1);
  const lower = upper.clone().multiply(new Quaternion().setFromAxisAngle(vec([1, 0, 0]), bend));
  // Forward reconstruction keeps shoulder/hip bounds and hinge limits compatible.
  const middle = start.clone().add(vec([0, -a, 0]).applyQuaternion(upper));
  const end = middle.clone().add(vec([0, -b, 0]).applyQuaternion(lower));
  return { middle, end, upper, lower, bend };
}

export function wristRotation(forearm: Quaternion, side: 'left' | 'right') {
  const normal = vec([0, 0, 1]).applyQuaternion(forearm.clone().invert());
  // Do not choose a new twist at the pole, where palm-facing is ambiguous.
  const neutral = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
  const angle = Math.atan2(normal.x, normal.z) - neutral;
  const twist = normal.x * normal.x + normal.z * normal.z < .025 ? 0 : Math.atan2(Math.sin(angle), Math.cos(angle));
  const desired = new Quaternion().setFromAxisAngle(vec([0, 1, 0]), Math.max(-rad(60), Math.min(rad(60), twist)));
  return forearm.clone().multiply(clampRotation(desired, ANATOMY.wrist));
}
