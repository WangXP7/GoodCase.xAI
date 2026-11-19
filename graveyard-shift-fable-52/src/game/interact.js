// Interactables: find the one the player is at, and use it. Pure: no DOM, no three.js.
// `use` returns {ok, reason} so the UI can say why it was refused (purchases.js lists the reasons).
// The ammo crate is offered with a live label and price: those of the weapon in hand.
// What each kind does is purchases.js's; this file only finds and dispatches.
import { createPurchases } from './purchases.js';

const LOW = -0.6; // m: an interactable this far below the feet is on the floor below
const HIGH = 2.6; // m: ... and this far above them, on the floor above

/**
 * @param {object} o
 * @param {() => Array<{id, kind, pos, radius, cost, label, enabled?}>} o.interactables
 * @param {object} [o.purchases]   createPurchases(...) result; built from economy/weapon/emit when omitted
 */
export function createInteract({ interactables, purchases, economy, weapon, emit = () => {} }) {
  const list = () => interactables() || [];
  const buy = purchases || createPurchases({ economy, weapon, emit });

  // An interactable whose label and price depend on the moment (the ammo crate: the weapon in hand)
  // is offered as a view of it that reads both live from the purchases; made once per interactable.
  const views = new WeakMap();
  function offer(it) {
    if (!it || typeof buy.live !== 'function' || !buy.live(it)) return it;
    let v = views.get(it);
    if (!v) {
      v = Object.create(it, {
        label: { get: () => buy.labelOf(it), enumerable: true },
        cost: { get: () => buy.costOf(it), enumerable: true },
        source: { value: it },
      });
      views.set(it, v);
    }
    return v;
  }

  return {
    // Closest enabled interactable whose radius contains the player: horizontal distance, on the
    // player's floor (positions may be [x,y,z] arrays or {x,y,z} objects). No allocation.
    nearest(playerPos) {
      if (!playerPos) return null;
      const arr = Array.isArray(playerPos) || ArrayBuffer.isView(playerPos);
      const px = arr ? playerPos[0] : playerPos.x, py = (arr ? playerPos[1] : playerPos.y) || 0, pz = arr ? playerPos[2] : playerPos.z;
      const l = list();
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < l.length; i++) {
        const it = l[i];
        if (!it || (typeof it.enabled === 'function' && !it.enabled())) continue;
        const p = it.pos;
        if (!p) continue;
        const pa = Array.isArray(p) || ArrayBuffer.isView(p);
        const x = pa ? p[0] : p.x, y = pa ? p[1] : p.y, z = pa ? p[2] : p.z;
        if (Number.isFinite(y)) { const dy = y - py; if (dy < LOW || dy > HIGH) continue; }
        const d = Math.hypot(x - px, z - pz);
        if (d <= (it.radius ?? 0) && d < bestD) { best = it; bestD = d; }
      }
      return offer(best);
    },

    // By id or by the interactable itself (or the view of it that nearest() gave).
    use(idOrIt) {
      const it = idOrIt && typeof idOrIt === 'object' ? idOrIt : list().find((i) => i.id === idOrIt);
      return buy.use(it || null);
    },
    // The view nearest() gives of an interactable (itself when nothing about it is live).
    offer,
  };
}
