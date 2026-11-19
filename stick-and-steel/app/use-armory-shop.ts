'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buy, getEntitlements, getShop, on, waitForPlayer, type ShopItem } from '@genex-ai/embed-sdk';
import { bootIdentity } from '@/lib/duel/embed';
import { ownsRavenblade, RAVENBLADE_SKU } from '@/lib/duel/armory';

export function useArmoryShop() {
  const [guest, setGuest] = useState(true);
  const [item, setItem] = useState<ShopItem | null>(null), [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true), [buying, setBuying] = useState(false), [message, setMessage] = useState('');
  const mounted = useRef(false), pending = useRef(false), reading = useRef<Promise<boolean> | null>(null);
  const refresh = useCallback((): Promise<boolean> => {
    if (reading.current) return reading.current;
    const request = async () => {
      try {
        bootIdentity(); const player = await waitForPlayer();
        // The catalog is public to guests; the coin inventory endpoint is account-only.
        const [catalog, entitlements] = await Promise.all([getShop(), player.guest ? Promise.resolve([]) : getEntitlements({ excludeConsumed: true })]);
        const unlocked = ownsRavenblade(entitlements), sku = catalog.find(s => s.id === RAVENBLADE_SKU) ?? null;
        if (mounted.current) { setGuest(player.guest); setItem(sku); setOwned(unlocked); setMessage(sku || unlocked ? '' : 'The coin shop is available in the published game.'); }
        return unlocked;
      } catch { if (mounted.current) setMessage('The armorer is away. Try again in a moment.'); return false; }
      finally { reading.current = null; if (mounted.current) setLoading(false); }
    };
    return reading.current = request();
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Restore durable ownership on every boot, including a purchase completed before a tab closed.
    void refresh();
    const stop = on('authenticated', () => { if (reading.current) void reading.current.finally(() => { void refresh(); }); else void refresh(); });
    const focus = () => { if (!pending.current) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; stop(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const purchase = useCallback(() => {
    if (!item || guest || owned || pending.current) return;
    pending.current = true; setBuying(true); setMessage('Confirm your purchase in the coin window.');
    // Call the SDK directly in the click handler; it owns price confirmation and payment.
    const outcome = buy({ skuId: item.id, quantity: 1 });
    void outcome.then(async result => {
      if (!mounted.current) return;
      if (result.status === 'succeeded') {
        const unlocked = await refresh();
        if (mounted.current) setMessage(unlocked ? 'Ravenblade is yours.' : 'Purchase complete. Refresh to restore your weapon.');
      } else if (result.status === 'canceled') setMessage('');
      else if (result.status === 'insufficient_balance') setMessage('Not enough coins. Your weapon has not been changed.');
      else if (result.status === 'expired') setMessage('Confirmation expired. You can try again.');
      else setMessage(result.message?.includes('blocked') ? 'Allow the confirmation window, then try again.' : 'Purchase unavailable. Please try again.');
    }).catch(() => { if (mounted.current) setMessage('Purchase unavailable. Please try again.'); })
      .finally(() => { pending.current = false; if (mounted.current) setBuying(false); });
  }, [item, guest, owned, refresh]);
  return { item, guest, owned, loading, buying, message, refresh, purchase };
}
export type ArmoryShop = ReturnType<typeof useArmoryShop>;
