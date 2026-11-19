import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

export type WeaponKind = 'sword' | 'mace' | 'greatsword';
export type WeaponSkin = 'ravenblade';
export const safeSkin = (kind: WeaponKind, skin: unknown): WeaponSkin | undefined => kind === 'greatsword' && skin === 'ravenblade' ? skin : undefined;
export const weaponName = (weapon: { spec: WeaponSpec; skin?: WeaponSkin }) => weapon.skin === 'ravenblade' ? 'Ravenblade' : weapon.spec.name;
export type Hand = 'left' | 'right';
export type WeaponShape = { half: [number, number, number]; offset: [number, number, number]; mass: number; surface: 'edge' | 'blunt' | 'handle' };
export type WeaponSpec = { kind: WeaponKind; name: string; description: string; center: number; tip: number; reach: number; tempo: number; torque: number; disarm: number; twoHanded: boolean; shapes: WeaponShape[] };
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  sword: { kind: 'sword', name: 'Arming sword', description: 'Balanced reach, quick cuts', center: .34, tip: .49, reach: .95, tempo: 1, torque: 4.2, disarm: 1, twoHanded: false, shapes: [
    { half: [.032, .37, .018], offset: [0, .12, 0], mass: .5, surface: 'edge' },
    { half: [.025, .10, .025], offset: [0, -.34, 0], mass: .18, surface: 'handle' },
    { half: [.125, .021, .028], offset: [0, -.22, 0], mass: .12, surface: 'handle' },
  ] },
  mace: { kind: 'mace', name: 'Iron mace', description: 'Short reach, heavy stagger', center: .28, tip: .42, reach: .76, tempo: 1.16, torque: 7, disarm: 1.6, twoHanded: false, shapes: [
    { half: [.11, .12, .09], offset: [0, .30, 0], mass: .92, surface: 'blunt' },
    { half: [.023, .34, .023], offset: [0, 0, 0], mass: .28, surface: 'handle' },
  ] },
  greatsword: { kind: 'greatsword', name: 'Longsword', description: 'Long reach, two-hand control', center: .46, tip: .83, reach: 1.34, tempo: 1.23, torque: 9, disarm: 1.35, twoHanded: true, shapes: [
    { half: [.036, .48, .018], offset: [0, .35, 0], mass: .86, surface: 'edge' },
    { half: [.025, .18, .025], offset: [0, -.49, 0], mass: .25, surface: 'handle' },
    { half: [.16, .022, .03], offset: [0, -.26, 0], mass: .16, surface: 'handle' },
  ] },
};
export type Weapon = {
  id: number; spec: WeaponSpec; skin?: WeaponSkin; body: RAPIER.RigidBody; holder: number | null; pickupAfter: number;
  position: Vector3; linear: Vector3; angular: Vector3;
};
export const gripAnchor = (hand: Hand) => new Vector3(hand === 'right' ? .025 : -.025, -.10, 0);
export const handlePoint = (weapon: Weapon) => new Vector3(0, -weapon.spec.center, 0);
