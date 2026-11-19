import { Quaternion, Vector3 } from 'three';

export type Strike = { velocity: Vector3; rotation: Quaternion; impulse: number; blade: boolean; blunt?: boolean; part: string };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Gameplay injury model: real contact + relative speed + a leading blade edge. */
export function evaluateStrike({ velocity, rotation, impulse, blade, blunt = false, part }: Strike) {
  const speed = velocity.length();
  const edge = speed > 0 ? Math.abs(velocity.dot(new Vector3(1, 0, 0).applyQuaternion(rotation))) / speed : 0;
  if (speed < 1.6 || impulse < .035) return { damage: 0, cut: 0, canSever: false, edge };
  const region = part === 'head' ? 1.35 : ['chest', 'spine'].includes(part) ? 1.05 : part.includes('hand') ? .7 : part.includes('arm') ? .9 : 1;
  // Motor-driven tip speed can spike briefly. A bounded, near-linear curve
  // keeps ordinary sweeps readable while clean, fast head strikes still matter.
  const damage = clamp((speed - 1.2) * 3.6 + Math.min(impulse, 2) * 1.5, 1, 32) * region * (blade ? .3 + .7 * edge : blunt ? .95 : .2);
  // Cutting depends on edge speed, independently of the deliberately gentler
  // HP curve. A clean committed cut can separate a joint while glancing blows
  // still need repeated contact. Cap solver spikes just as we do for HP.
  const cut = blade && edge > .45 ? Math.min(55, (speed - 1.6) ** 2 * 1.85) * edge ** 2 : 0;
  return { damage, cut, canSever: blade && speed >= 3.2 && edge >= .7 && cut >= 9, edge };
}

/** The line rig separates at existing joints, keeping its downstream segments articulated. */
export function severThreshold(part: string): number {
  if (part.includes('hand') || part.includes('foot')) return 22;
  if (part.includes('forearm') || part.includes('shin')) return 29;
  if (part.includes('upper arm')) return 36;
  if (part.includes('thigh')) return 46;
  return Infinity;
}

/** Limbs flinch; a committed central blow can topple the whole fighter. */
export function knocksDown(part: string, damage: number, blunt: boolean) {
  const central = ['head', 'chest', 'spine'].includes(part);
  return central && damage >= (blunt ? 28 : part === 'head' ? 34 : 31);
}
