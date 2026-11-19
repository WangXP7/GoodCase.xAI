import { Quaternion, Vector3 } from 'three';

export const vec = (v: number[] | { x: number; y: number; z: number }) =>
  Array.isArray(v) ? new Vector3(v[0], v[1], v[2]) : new Vector3(v.x, v.y, v.z);

/** Analytic two-bone IK. Unreachable goals clamp without stretching the bones. */
export function solveTwoBone(start: Vector3, target: Vector3, pole: Vector3, a: number, b: number, bendLimits?: readonly [number, number]) {
  const direction = target.clone().sub(start);
  if (direction.lengthSq() < 1e-10) direction.set(0, -1, 0);
  const reachAt = (angle: number) => Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(angle));
  const minReach = bendLimits ? reachAt(bendLimits[1]) : Math.abs(a - b) + 1e-5;
  const maxReach = bendLimits ? reachAt(bendLimits[0]) : a + b - 1e-5;
  const distance = Math.max(minReach, Math.min(maxReach, direction.length()));
  direction.normalize();
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.copy(Math.abs(direction.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
    bend.addScaledVector(direction, -bend.dot(direction));
  }
  bend.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  return {
    middle: start.clone().addScaledVector(direction, along).addScaledVector(bend, height),
    end: start.clone().addScaledVector(direction, distance),
  };
}

export function segmentTransform(a: Vector3, b: Vector3) {
  return {
    position: a.clone().add(b).multiplyScalar(0.5),
    rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()),
    length: a.distanceTo(b),
  };
}
