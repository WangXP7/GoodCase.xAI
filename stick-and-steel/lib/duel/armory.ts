import type { Entitlement } from '@genex-ai/embed-sdk';
import { WEAPONS, type WeaponKind, type WeaponSkin } from './weapons';
import { ALL_WEAPON_ASSETS } from './weapon-assets';

export const RAVENBLADE_SKU = 'cmtx44en500152qqyz2tcfruq';
export const LOADOUTS = [
  { id: 'sword', kind: 'sword', skin: null, name: 'Arming sword', detail: 'A quick cut. A clean finish.', style: 'Balanced · one hand', asset: ALL_WEAPON_ASSETS.sword },
  { id: 'mace', kind: 'mace', skin: null, name: 'Iron mace', detail: 'Less reach. More impact.', style: 'Heavy impact · one hand', asset: ALL_WEAPON_ASSETS.mace },
  { id: 'greatsword', kind: 'greatsword', skin: null, name: 'Longsword', detail: 'Keep them at the end of your blade.', style: 'Long reach · two hands', asset: ALL_WEAPON_ASSETS.greatsword },
  { id: 'ravenblade', kind: 'greatsword', skin: 'ravenblade', name: 'Ravenblade', detail: 'Blackened iron. A raven’s wings. Yours to wield.', style: 'Longsword design · two hands', asset: ALL_WEAPON_ASSETS.ravenblade },
] as const satisfies readonly { id: string; kind: WeaponKind; skin: WeaponSkin | null; name: string; detail: string; style: string; asset: string }[];
export type LoadoutId = typeof LOADOUTS[number]['id'];
export const getLoadout = (id: string) => LOADOUTS.find(w => w.id === id) ?? LOADOUTS[0];
export const loadoutId = (kind: WeaponKind, skin?: WeaponSkin | null): LoadoutId => kind === 'greatsword' && skin === 'ravenblade' ? skin : kind;
export const ownsRavenblade = (items: Entitlement[]) => items.some(e => e.skuId === RAVENBLADE_SKU && e.skuType === 'durable' && !e.consumed && e.quantity > 0);
export const canEquip = (id: LoadoutId, owned: boolean) => id !== 'ravenblade' || owned;
export const loadoutName = (kind: WeaponKind, skin?: WeaponSkin | null) => skin === 'ravenblade' && kind === 'greatsword' ? 'Ravenblade' : WEAPONS[kind].name;
