import { Vector3 } from 'three';

export type ArenaKind = 'yard' | 'bridge';
export const ARENAS = {
  yard: { kind: 'yard', name: 'The Practice Yard', halfX: 3.7, halfZ: 3.7, top: 0 },
  bridge: { kind: 'bridge', name: 'The Splinter Pit', halfX: 4.4, halfZ: .52, top: 0 },
} as const;
export function onPlatform(kind: ArenaKind, point: { x: number; z: number }, margin = 0) {
  const arena = ARENAS[kind];
  return Math.abs(point.x) <= arena.halfX - margin && Math.abs(point.z) <= arena.halfZ - margin;
}
export function nearestLedge(point: { x: number; z: number }) {
  const { halfX, halfZ } = ARENAS.bridge;
  const x = Math.max(-halfX, Math.min(halfX, point.x)), z = Math.max(-halfZ, Math.min(halfZ, point.z));
  if (Math.abs(halfX - Math.abs(point.x)) < Math.abs(halfZ - Math.abs(point.z))) {
    const sign = point.x >= 0 ? 1 : -1;
    return { point: new Vector3(sign * halfX, .025, z), inward: new Vector3(-sign, 0, 0) };
  }
  const sign = point.z >= 0 ? 1 : -1;
  return { point: new Vector3(x, .025, sign * halfZ), inward: new Vector3(0, 0, -sign) };
}
