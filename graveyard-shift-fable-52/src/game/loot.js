// Searching: every searchable (G.level.searchables, 46) can be searched once per game, by holding
// interact for 1.5 s within 1.6 m, for one seeded reward. Pure: no DOM, no three.js. Sim time.
//
//   searched: Set<id>                  used this game (their interactables are disabled)
//   active: {id, t} | null             the search under way (t: seconds held)
//   progress                           0..1 of the search under way, 0 when none
//   pickups: Array<{id, kind:'pickup', item, pos, ttl, ...interactable}>  weapons left on objects
//   rollReward(id, round) -> {kind, item, amount, points}   the raw seeded roll (pure in seed, run, id)
//   grant(raw, pos?) -> {kind, item, amount}                applies it; what was really given
//   take(pickup) -> {ok, reason}, update(dt), reset(rng, opts), interactables (one per searchable)
// The hold is cancelled, with no progress kept, by releasing, by damage, by moving more than 0.3 m
// outside the radius, or by firing; after a cancel (or a finished search) interact must be released
// before another search can start.
// Events: search:start {id}, search:progress {id, progress} (one reused object, at 0, 25, 50, 75 and
// 100 % only), search:cancel {id, reason:'released'|'damage'|'moved'|'fired'}, search:done {id, reward},
// pickup:take {kind:'weapon', item}, pickup:lapse {id, item}.
import { tuning } from './tuning.js';
import { WEAPONS, statsFor } from '../weapon/defs.js';

const T = tuning.loot;
const TP = tuning.economy.powerups;
const THROW = tuning.weapons.throwables.kinds;
const ATTACH = tuning.weapons.attachments.kinds;

const NOUN = { car: 'car', barrel: 'barrel', crate: 'crate', bin: 'bin', locker: 'locker', icebox: 'ice box', suitcase: 'suitcase', dresser: 'dresser', toolchest: 'tool chest' };

export function bracketOf(round) {
  let col = 0;
  for (let i = 0; i < T.brackets.length; i++) if (round >= T.brackets[i]) col = i;
  return col;
}

export function pointsAt(u, round) {
  const v = (T.points.min + u * (T.points.max - T.points.min)) * (1 + T.points.perRound * round);
  return Math.min(T.points.cap, Math.round(v / 10) * 10);
}

// The raw roll from one rng: always four draws, so the result depends only on the rng and the round.
export function rollFrom(rng, round) {
  const d0 = rng.next(), d1 = rng.next(), d2 = rng.next(), d3 = rng.next();
  const col = 1 + bracketOf(round);
  let x = d0 * 100;
  let kind = T.table[T.table.length - 1][0];
  for (const row of T.table) { x -= row[col]; if (x < 0) { kind = row[0]; break; } }
  const points = pointsAt(d1, round);
  const at = (arr) => arr[Math.min(arr.length - 1, Math.floor(d2 * arr.length))];
  switch (kind) {
    case 'points': return { kind, item: null, amount: points, points };
    case 'ammo': return { kind, item: null, amount: T.ammo.share, points };
    case 'medkit': return { kind, item: null, amount: T.medkit, points };
    case 'throwable': return { kind, item: at(THROW), amount: 1, points };
    case 'plate': return { kind, item: null, amount: 1, points };
    case 'powerup': { const item = at(T.powerups); return { kind, item, amount: TP.seconds[item] * T.powerupScale, points }; }
    case 'attachment': return { kind, item: at(ATTACH), amount: 1, points };
    case 'weapon': return { kind, item: d3 < T.axeChance ? 'axe' : at(T.weapons), amount: 1, points };
    default: return { kind: 'nothing', item: null, amount: 0, points };
  }
}

/**
 * @param {object} o
 * @param {Array<{id, zone, kind, pos, prop}>} o.searchables
 * @param {object} o.economy, o.powerups
 * @param {() => object} o.input, o.player, o.weapon, o.level, o.focus
 * @param {() => Array} o.interactables   the live array pickups are added to
 * @param {() => number} o.round
 */
export function createLoot({ searchables = [], emit = () => {}, economy, powerups = null, input = () => null, player = () => null, weapon = () => null, level = () => null, focus = () => null, interactables = () => null, round = () => 1 }) {
  let runRng = null;
  let needRelease = false;
  let weaponsGiven = 0;
  let axeGiven = false;
  let nextPickup = 1;
  const progressEv = { id: null, progress: 0 };

  const loot = {
    searched: new Set(),
    active: null,
    progress: 0,
    pickups: [],
    interactables: searchables.map((s) => ({
      id: s.id, kind: 'search', search: s.id, pos: s.pos, radius: T.radius, cost: 0, zone: s.zone,
      label: `Search ${NOUN[s.kind] || s.kind}`, hold: T.hold, prop: s.prop,
      enabled: () => !loot.searched.has(s.id),
    })),

    rollReward(id, r) { return rollFrom(runRng.fork(id), r); },

    grant(raw, pos) {
      const w = weapon();
      const p = player();
      const s = w && w.slots ? w.slots[w.slot] : null;
      switch (raw.kind) {
        case 'points': return pay(raw.amount);
        case 'ammo': {
          if (!s || typeof w.addReserve !== 'function') return pay(T.fallbackPoints);
          const d = statsFor(s);
          const n = Math.round(d.maxReserve * (d.cls === 'special' ? T.ammo.specialShare : raw.amount));
          const added = w.addReserve(n);
          return added > 0 ? { kind: 'ammo', item: s.id, amount: added } : pay(T.fallbackPoints);
        }
        case 'medkit':
          if (p && p.health < p.maxHealth) {
            if (typeof p.heal === 'function') p.heal(raw.amount); else p.health = Math.min(p.maxHealth, p.health + raw.amount);
            return { kind: 'medkit', item: null, amount: raw.amount };
          }
          return plate();
        case 'plate': return plate();
        case 'throwable':
          return w && typeof w.addThrowable === 'function' && w.addThrowable(raw.item, 1) > 0
            ? { kind: 'throwable', item: raw.item, amount: 1 } : pay(T.fallbackPoints);
        case 'powerup':
          if (powerups) powerups.activate(raw.item, raw.amount);
          return { kind: 'powerup', item: raw.item, amount: raw.amount };
        case 'attachment': {
          if (!s || typeof w.attach !== 'function') return pay(T.fallbackPoints);
          const k0 = Math.max(0, ATTACH.indexOf(raw.item));
          for (let j = 0; j < ATTACH.length; j++) {
            const k = ATTACH[(k0 + j) % ATTACH.length];
            if (!s.attachments.has(k) && w.attach(k)) return { kind: 'attachment', item: k, amount: 1 };
          }
          return pay(T.fallbackPoints);
        }
        case 'weapon': {
          if (raw.item === 'axe' && !axeGiven && !(w && w.melee === 'axe')) {
            axeGiven = true;
            leave('axe', pos);
            return { kind: 'weapon', item: 'axe', amount: 1 };
          }
          if (weaponsGiven >= T.weaponCap) return pay(T.fallbackPoints);
          const i0 = Math.max(0, T.weapons.indexOf(raw.item));
          for (let j = 0; j < T.weapons.length; j++) {
            const id = T.weapons[(i0 + j) % T.weapons.length];
            if (w && typeof w.has === 'function' && w.has(id)) continue;
            weaponsGiven++;
            leave(id, pos);
            return { kind: 'weapon', item: id, amount: 1 };
          }
          return pay(T.fallbackPoints);
        }
        default: return { kind: 'nothing', item: null, amount: 0 };
      }
    },

    // a press on a weapon left on an object
    take(it) {
      const i = loot.pickups.indexOf(it);
      if (i < 0) return { ok: false, reason: 'none' };
      const w = weapon();
      if (!w) return { ok: false, reason: 'unavailable' };
      if (it.item === 'axe') {
        if (typeof w.setMelee === 'function') w.setMelee('axe');
      } else {
        const had = typeof w.has === 'function' && w.has(it.item);
        const r = typeof w.give === 'function' ? w.give(it.item) : null;
        const s = r && w.slots ? w.slots[r.slot] : null;
        // a new weapon comes with one magazine loaded and one in reserve; one already carried is
        // only refilled (give tops it up), never cut back
        if (s && !had) s.reserve = statsFor(s).mag;
      }
      removePickup(i);
      emit('pickup:take', { kind: 'weapon', item: it.item });
      return { ok: true, reason: null };
    },

    cancel(reason) {
      const a = loot.active;
      if (!a) return;
      loot.active = null;
      loot.progress = 0;
      needRelease = true;
      emit('search:cancel', { id: a.id, reason });
    },

    update(dt) {
      if (!(dt > 0)) return;
      for (let i = loot.pickups.length - 1; i >= 0; i--) {
        const pk = loot.pickups[i];
        pk.ttl -= dt;
        if (pk.ttl <= 0) { removePickup(i); emit('pickup:lapse', { id: pk.id, item: pk.item }); }
      }
      const I = input();
      const held = !!(I && typeof I.held === 'function' && I.held('interact') > 0);
      if (!held) needRelease = false;
      const a = loot.active;
      if (a) {
        if (!held) { loot.cancel('released'); return; }
        const p = player();
        if (p && p.pos && dist(p.pos, a.it.pos) > a.it.radius + T.slack) { loot.cancel('moved'); return; }
        a.t += dt;
        loot.progress = Math.min(1, a.t / T.hold);
        // at 25, 50, 75 and 100 % only (read loot.progress for a smooth ring)
        const q = Math.floor(loot.progress * 4);
        if (q > a.q) { a.q = q; progressEv.id = a.id; progressEv.progress = q / 4; emit('search:progress', progressEv); }
        if (a.t >= T.hold) complete(a);
        return;
      }
      if (!held || needRelease) return;
      const f = focus();
      if (!f || f.kind !== 'search' || loot.searched.has(f.search)) return;
      loot.active = { id: f.search, t: 0, it: f, q: 0 };
      loot.progress = 0;
      emit('search:start', { id: f.search });
      progressEv.id = f.search; progressEv.progress = 0;
      emit('search:progress', progressEv);
    },

    // A new game: `r` is this run's search rng (G.rng.fork('search').fork(runIndex)).
    reset(r, { all = false } = {}) {
      runRng = r;
      loot.active = null;
      loot.progress = 0;
      loot.searched.clear();
      needRelease = false;
      weaponsGiven = 0;
      axeGiven = false;
      while (loot.pickups.length) removePickup(loot.pickups.length - 1);
      if (all) {
        const L = level();
        for (const s of searchables) {
          loot.searched.add(s.id);
          const pr = L && L.props ? L.props[s.prop] : null;
          if (pr && typeof pr.setState === 'function') pr.setState('open');
          if (pr && typeof pr.setSearched === 'function') pr.setSearched(true);
        }
      }
    },
  };

  function complete(a) {
    loot.active = null;
    loot.progress = 0;
    needRelease = true;
    loot.searched.add(a.id);
    const reward = loot.grant(loot.rollReward(a.id, round()), a.it.pos);
    emit('search:done', { id: a.id, reward });
  }

  function pay(n) {
    if (economy) economy.add(n, 'search');
    return { kind: 'points', item: null, amount: n };
  }

  function plate() {
    const p = player();
    const added = p && typeof p.addPlates === 'function' ? p.addPlates(1) : 0;
    return added > 0 ? { kind: 'plate', item: null, amount: 1 } : pay(T.fallbackPoints);
  }

  function leave(item, pos) {
    const at = pos ? (Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z]) : [0, 0, 0];
    const label = item === 'axe' ? tuning.weapons.melee.axe.name : WEAPONS[item].name;
    const pk = {
      id: `pickup-${nextPickup++}`, kind: 'pickup', item, pos: [at[0], at[1], at[2]], radius: T.radius,
      cost: 0, label: `Take ${label}`, ttl: T.pickupTtl, enabled: () => true,
    };
    loot.pickups.push(pk);
    const list = interactables();
    if (Array.isArray(list)) list.push(pk);
  }

  function removePickup(i) {
    const pk = loot.pickups[i];
    loot.pickups.splice(i, 1);
    const list = interactables();
    const j = Array.isArray(list) ? list.indexOf(pk) : -1;
    if (j >= 0) list.splice(j, 1);
  }

  return loot;
}

function dist(a, b) {
  const ax = Array.isArray(a) ? a[0] : a.x, az = Array.isArray(a) ? a[2] : a.z;
  const bx = Array.isArray(b) ? b[0] : b.x, bz = Array.isArray(b) ? b[2] : b.z;
  return Math.hypot(ax - bx, az - bz);
}
