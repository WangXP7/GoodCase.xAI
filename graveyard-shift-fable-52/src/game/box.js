// The weapon box. Pure: no DOM, no three.js. Works without power.
//
//   state: 'idle' | 'rolling' | 'offering' | 'moving'
//   spot: the boxSpots id it stands at; pos: that spot's position
//   offer: the weapon id on offer (offering only), else null
//   usesLeft: rolls left before it moves (seeded int(4, 8) at each spot)
//   roll() -> {ok, reason}   950 points; refused with busy (not idle) or points
//   take() -> {ok, reason}   gives the offer (replacing the held weapon when both slots are full)
//   update(dt)               sim time
//   reset(rng)               a new game: idle at a seeded spot
// Events: box:roll {spot}, box:result {weapon}, box:take {weapon, spot}, box:expire {weapon, spot}
// (the offer lapsed, no refund), box:move {from, to} (from is null when a game starts: where the box stands).
import { tuning } from './tuning.js';
import { WEAPONS, WEAPON_IDS } from '../weapon/defs.js';

const TB = tuning.economy.box;

/**
 * @param {object} o
 * @param {Array<{id, pos}>} o.spots
 * @param {object} o.economy
 * @param {() => object} o.weapon      G.weapon (has, give)
 * @param {(name, payload) => void} [o.emit]
 */
export function createBox({ spots, economy, weapon, emit = () => {} }) {
  let rng = null;
  let t = 0;
  const box = {
    state: 'idle',
    spot: null,
    pos: null,
    offer: null,
    usesLeft: 0,
    get t() { return t; },

    roll() {
      if (box.state !== 'idle' || !box.spot) return { ok: false, reason: 'busy' };
      if (!economy.spend(TB.cost, 'box', 'box')) return { ok: false, reason: 'points' };
      box.usesLeft = Math.max(0, box.usesLeft - 1);
      box.state = 'rolling';
      t = 0;
      emit('box:roll', { spot: box.spot });
      return { ok: true, reason: null };
    },

    take() {
      if (box.state !== 'offering' || !box.offer) return { ok: false, reason: 'none' };
      const id = box.offer;
      const w = weapon();
      if (!w || typeof w.give !== 'function') return { ok: false, reason: 'unavailable' };
      w.give(id);
      box.offer = null;
      emit('box:take', { weapon: id, spot: box.spot });
      afterUse();
      return { ok: true, reason: null };
    },

    update(dt) {
      if (!(dt > 0) || box.state === 'idle') return;
      t += dt;
      if (box.state === 'rolling' && t >= TB.roll) {
        box.offer = pick();
        box.state = 'offering';
        t = 0;
        emit('box:result', { weapon: box.offer });
      } else if (box.state === 'offering' && t >= TB.offer) {
        const id = box.offer;
        box.offer = null;
        emit('box:expire', { weapon: id, spot: box.spot });
        afterUse();
      } else if (box.state === 'moving' && t >= TB.move) {
        box.state = 'idle';
        t = 0;
      }
    },

    reset(r) {
      rng = r;
      box.state = 'idle';
      box.offer = null;
      t = 0;
      const s = spots && spots.length ? spots[rng.int(0, spots.length - 1)] : null;
      place(s);
      box.usesLeft = rng.int(TB.usesMin, TB.usesMax);
      if (s) emit('box:move', { from: null, to: s.id });
    },
  };

  function place(s) { box.spot = s ? s.id : null; box.pos = s ? s.pos : null; }

  // the offer resolved (taken or lapsed): idle again, or off to another spot
  function afterUse() {
    t = 0;
    if (box.usesLeft > 0 || !spots || spots.length < 2) { box.state = 'idle'; return; }
    const from = box.spot;
    const others = spots.filter((s) => s.id !== from);
    const to = others[rng.int(0, others.length - 1)];
    place(to);
    box.usesLeft = rng.int(TB.usesMin, TB.usesMax);
    box.state = 'moving';
    emit('box:move', { from, to: to.id });
  }

  // weighted by the table's box weights, excluding what the player holds
  function pick() {
    const w = weapon();
    const held = (id) => !!(w && typeof w.has === 'function' && w.has(id));
    let total = 0;
    for (const id of WEAPON_IDS) if (WEAPONS[id].box > 0 && !held(id)) total += WEAPONS[id].box;
    let x = rng.next() * total;
    let last = null;
    for (const id of WEAPON_IDS) {
      if (!(WEAPONS[id].box > 0) || held(id)) continue;
      last = id;
      x -= WEAPONS[id].box;
      if (x < 0) return id;
    }
    return last;
  }

  return box;
}
