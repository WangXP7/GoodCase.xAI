// What using each kind of interactable does, and what it costs. Pure: no DOM, no three.js.
//
// use(it) -> {ok, reason}. Refusal reasons:
//   none (no such interactable) | unavailable (no weapon yet, or nothing to sell) | full (ammo at
//   max: for the crate, the weapon in hand's) | points (too few) | locked (a door that never opens) | owned (already bought, open, on or
//   upgraded) | power (needs the power on) | busy (the box is rolling or moving) | hold (a hold
//   interactable: searching and boards are driven by the hold, not the press) | unknown (kind)
// Every refusal except `hold` emits `buy:denied {item: kind, reason}`. Purchases emit
// `buy {item, cost, id}` through the economy (item: wallWeapon | wallAmmo | door | box | bench |
// machine:<kind>).
import { tuning } from './tuning.js';
import { WEAPONS, isWeapon, statsFor } from '../weapon/defs.js';

const TE = tuning.economy;
const TB = tuning.world.boards || { repairPoints: 10, repairCapPerRound: 200 };
const ok = { ok: true, reason: null };
const refuse = (reason) => ({ ok: false, reason });

export const wallWeaponOf = (it) => (it && (TE.wallBuys[it.weapon] || (isWeapon(it.weapon) ? it.weapon : null))) || null;

// The slot holding weapon `id`, or null.
function slotOf(w, id) {
  const s = w && w.slots;
  if (!s) return null;
  return s[0] && s[0].id === id ? s[0] : s[1] && s[1].id === id ? s[1] : null;
}

// Stock price of ammo for weapon `id`: its own wall-ammo price, else its class's crate price
// (tuning.economy.crateAmmo).
function stockAmmo(id, fallback) {
  const def = WEAPONS[id];
  if (def && def.wall && def.wall.ammo) return def.wall.ammo;
  const byClass = def && TE.crateAmmo && TE.crateAmmo[def.cls];
  return byClass || fallback || TE.wallAmmo.cost;
}

// The price of ammo for weapon `id`, the same at the crate and at its wall: the stock price, or
// upgraded crateUpgraded.scale x that, at most crateUpgraded.max. (What the info panel quotes.)
export function crateAmmoPrice(id, upgraded, fallback) {
  const stock = stockAmmo(id, fallback);
  if (!upgraded) return stock;
  const U = TE.crateUpgraded;
  return Math.min(U.max, U.scale * stock);
}

// Price of ammo for weapon `id` as the player holds it (upgraded or not), at a wall or the crate.
export function ammoCost(w, id, fallback) {
  const s = slotOf(w, id);
  return crateAmmoPrice(id, !!(s && s.upgraded), fallback);
}

// The weapon the ammo crate `it` refills: the one it names (a level may give one), else the one in
// hand, else the pistol (an original stand-in weapon with no slots).
export function crateWeaponOf(it, w) {
  const named = wallWeaponOf(it);
  if (named) return named;
  return (w && typeof w.id === 'string' && isWeapon(w.id) && w.id) || 'pistol';
}

// What the crate shows for the weapon in hand: "<weapon name> ammo" (the upgraded name once
// upgraded) and its price. Strings are made once per weapon and kept: the HUD reads this every frame.
const crateLabels = new Map();
function crateLabel(w, id) {
  const s = slotOf(w, id);
  const key = s && s.upgraded ? `${id}+` : id;
  let l = crateLabels.get(key);
  if (!l) { l = `${s ? statsFor(s).name : WEAPONS[id].name} ammo`; crateLabels.set(key, l); }
  return l;
}
export function crateLabelOf(it, w) {
  if (!w || !w.slots) return (it && it.label) || 'Ammo';
  return crateLabel(w, crateWeaponOf(it, w));
}
export function crateCostOf(it, w) {
  if (!w || !w.slots) return (it && it.cost) ?? TE.wallAmmo.cost;
  const id = crateWeaponOf(it, w);
  const s = slotOf(w, id);
  return crateAmmoPrice(id, !!(s && s.upgraded));
}

/**
 * @param {object} o
 * @param {object} o.economy                 createEconomy()
 * @param {() => object} o.weapon            G.weapon (arsenal API)
 * @param {(name, payload) => void} [o.emit]
 * @param {() => object} [o.level]           G.level (doors, openDoor, power, setPower, repairBoard)
 * @param {object} [o.box] [o.bench] [o.machines] [o.loot]
 */
export function createPurchases({ economy, weapon, emit = () => {}, level = () => null, box = null, bench = null, machines = null, loot = null }) {
  let boardPoints = 0; // paid for boards this round

  function ammo(it, id) {
    const w = weapon();
    if (!w || !w.ammo || typeof w.addReserve !== 'function') return refuse('unavailable');
    const s = typeof w.has === 'function' ? slotOf(w, id) : null;
    if (typeof w.has === 'function' && !s) return refuse('unavailable');
    // an original stand-in weapon (no slots): the held weapon at the pistol's max
    const max = s ? statsFor(s).maxReserve : tuning.pistol.maxReserve;
    const have = s ? s.reserve : w.ammo.reserve;
    if (have >= max) return refuse('full');
    // the crate's price is crateCostOf's, a wall's is ammoCost's; a stand-in's is the store's own
    const cost = !s ? (it.cost != null ? it.cost : ammoCost(w, id)) : it.kind === 'wallAmmo' ? crateCostOf(it, w) : ammoCost(w, id);
    if (!economy.spend(cost, 'wallAmmo', it.id)) return refuse('points');
    if (s) w.addReserve(undefined, id); else w.addReserve(max - have);
    return ok;
  }

  const handlers = {
    // the crate's ammo: for the weapon in hand (only that one), at that weapon's price; it.weapon
    // names one weapon instead, if a level gives one
    wallAmmo: (it) => ammo(it, crateWeaponOf(it, weapon())),
    wallWeapon(it) {
      const id = wallWeaponOf(it);
      const w = weapon();
      if (!id || !w || typeof w.give !== 'function') return refuse('unavailable');
      if (w.has(id)) return ammo(it, id);
      const cost = WEAPONS[id].wall && WEAPONS[id].wall.cost;
      if (!(cost > 0)) return refuse('unavailable');
      if (!economy.spend(cost, 'wallWeapon', it.id)) return refuse('points');
      w.give(id);
      return ok;
    },
    door(it) {
      const L = level();
      const d = L && L.doors ? L.doors.find((q) => q.id === it.door) : null;
      if (!d || typeof L.openDoor !== 'function') return refuse('locked');
      if (d.open) return refuse('owned');
      const cost = (tuning.world.doors && tuning.world.doors[d.id]) ?? d.cost ?? it.cost;
      if (!economy.spend(cost, 'door', it.id)) return refuse('points');
      L.openDoor(d.id);
      return ok;
    },
    power() {
      const L = level();
      if (!L || !L.power || typeof L.setPower !== 'function') return refuse('unavailable');
      if (L.power.on) return refuse('owned');
      L.setPower(true);
      return ok;
    },
    box() {
      if (!box) return refuse('unavailable');
      return box.state === 'offering' ? box.take() : box.roll();
    },
    bench() { return bench ? bench.use() : refuse('unavailable'); },
    machine(it) { return machines ? machines.buy(it.machine) : refuse('unavailable'); },
    pickup(it) { return loot ? loot.take(it) : refuse('unavailable'); },
    search: () => refuse('hold'),
    boards: () => refuse('hold'),
    lockedDoor: () => refuse('locked'), // a door that never opens (an early greybox's)
  };

  const p = {
    // What using `it` would buy right now, for the prompt. Only the ammo crate's label and price
    // depend on the weapon in hand (live: interact.js shows them); anything else is its own.
    live: (it) => !!it && it.kind === 'wallAmmo' && !!(weapon() && weapon().slots),
    labelOf: (it) => (it && it.kind === 'wallAmmo' ? crateLabelOf(it, weapon()) : it ? it.label : null),
    costOf: (it) => (it && it.kind === 'wallAmmo' ? crateCostOf(it, weapon()) : it ? it.cost : null),
    use(it) {
      const h = it && handlers[it.kind];
      const r = !it ? refuse('none') : h ? h(it) : refuse('unknown');
      if (!r.ok && r.reason !== 'hold') emit('buy:denied', { item: it ? it.kind : null, reason: r.reason });
      return r;
    },

    // One board back on window `it.window`: 10 points each, up to 200 a round.
    repairBoard(it) {
      const L = level();
      const win = L && L.windows ? L.windows.find((q) => q.id === it.window) : null;
      if (!win || win.boards >= win.max || typeof L.repairBoard !== 'function') return false;
      L.repairBoard(win.id);
      const pay = Math.min(TB.repairPoints, TB.repairCapPerRound - boardPoints);
      if (pay > 0) { boardPoints += pay; economy.add(pay, 'board'); }
      return true;
    },
    get boardPoints() { return boardPoints; },
    onRound() { boardPoints = 0; },
    reset() { boardPoints = 0; },
  };
  return p;
}
