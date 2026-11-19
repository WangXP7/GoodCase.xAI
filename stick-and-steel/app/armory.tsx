'use client';
import { useState } from 'react';
import { Check, LockKeyhole, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LOADOUTS, getLoadout, canEquip, type LoadoutId } from '@/lib/duel/armory';
import { WeaponPreview } from './weapon-preview';
import type { ArmoryShop } from './use-armory-shop';

export function Armory({ equipped, initialSelection, locked, shop, equip }: { equipped: LoadoutId; initialSelection?: LoadoutId; locked: boolean; shop: ArmoryShop; equip: (id: LoadoutId) => void }) {
  const [selected, setSelected] = useState<LoadoutId>(initialSelection ?? equipped);
  const weapon = getLoadout(selected), premium = selected === 'ravenblade', owned = !premium || shop.owned;
  const price = shop.item && new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shop.item.priceDisplayUsdCents / 100);
  return <div className="armory">
    <div className="armory-rack" aria-label="Choose a weapon">{LOADOUTS.map((w, index) => <button key={w.id} aria-pressed={selected === w.id} onClick={() => setSelected(w.id)}><span className="rack-number">0{index + 1}</span><span>{w.name}</span>{equipped === w.id ? <Check size={16} aria-label="Equipped"/> : w.id === 'ravenblade' && !shop.owned ? <LockKeyhole size={15}/> : null}</button>)}</div>
    <div className={'armory-piece' + (premium ? ' is-premium' : '')}>
      <WeaponPreview asset={weapon.asset} name={weapon.name}/>
      <div className="armory-caption"><h2>{weapon.name}</h2><p>{weapon.detail}</p></div>
    </div>
    <div className="armory-bottom">
      {locked && <p>Choose your next weapon after this match.</p>}
      {owned ? <Button className="ink-primary" disabled={locked || equipped === selected} onClick={() => { if (canEquip(selected, shop.owned)) equip(selected); }}>{equipped === selected ? <><Check size={17}/>Equipped</> : 'Equip ' + weapon.name}</Button> : <div className="armory-purchase"><Button className="ink-primary" disabled={shop.loading || shop.buying || !shop.item || shop.guest} onClick={shop.purchase}><Coins size={18}/>{shop.buying ? 'Awaiting confirmation…' : shop.loading ? 'Checking the armory…' : shop.item ? 'Unlock · ' + shop.item.priceCoins + ' coins' : 'Shop unavailable'}</Button>{price && <small>{price} equivalent · one-time purchase</small>}{shop.item && shop.guest && <small>Sign in to unlock.</small>}</div>}
      {premium && shop.message && <output className="armory-message">{shop.message}</output>}
      {premium && shop.message && !shop.loading && !shop.buying && <button className="armory-refresh" onClick={() => { void shop.refresh(); }}>Check ownership</button>}
    </div>
  </div>;
}
