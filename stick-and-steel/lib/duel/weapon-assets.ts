import type { WeaponKind } from './weapons';

export const WEAPON_ASSETS: Record<WeaponKind, string> = {
  sword: '/assets/sword-dark-cmtvomjcx00072etq8bbl9bx3.glb',
  greatsword: '/assets/greatsword.glb',
  mace: '/assets/mace.glb',
};
// Retained on disk alongside the untouched provider original for easy restoration.
export const PREVIOUS_SWORD_ASSET = '/assets/sword.glb';
export const BRASS_SWORD_ASSET = '/assets/sword-forged-cmtvnboe9001y2poagte9orpv.glb';
export const RAVENBLADE_ASSET = '/assets/ravenblade-cmtvp6o7m00002bmxz9mp6bpm.glb';
export const ALL_WEAPON_ASSETS = { ...WEAPON_ASSETS, ravenblade: RAVENBLADE_ASSET };
