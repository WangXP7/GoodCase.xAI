// Round formulas and the round director. Pure: no DOM, no three.js.
// The director does not own zombies: it asks for spawns through `spawn(point, n, type)` and is told
// about deaths through `onDeath(id)`. It only counts zombies it spawned itself.
import { tuning } from './tuning.js';

const R = tuning.round;
const Z = tuning.zombies;

export const rounds = {
  total: (n) => R.total(n),
  spawnInterval: (n) => R.spawnInterval(n),
  // the round's walker health; a type's health is a multiple of it (tuning.zombies.types[t].health)
  health: (n) => Math.round(tuning.walker.health(n)),
  // the brute's multiple of the walker health this round (12x at 5, 8x at 10, 6x from 15)
  bruteScale: (n) => Z.healthScale('brute', n),
  bruteHealth: (n) => Math.max(1, Math.round(rounds.health(n) * rounds.bruteScale(n))),
  maxAlive: R.maxAlive,
  lull: R.lull,
  isBoss: (n) => n > 0 && n % R.bossEvery === 0,
  brutes: (n) => (rounds.isBoss(n) ? Math.min(R.maxBrutes, Math.floor(n / R.bossEvery)) : 0),
  // ordinary (non-brute) spawns this round: a boss round brings 60 % of the usual crowd
  regulars: (n) => (rounds.isBoss(n) ? Math.round(R.bossShare * R.total(n)) : R.total(n)),
  // everything the round spawns, brutes included
  roundTotal: (n) => rounds.regulars(n) + rounds.brutes(n),
  // shares of the ordinary spawns; they sum to 1 and walkers keep at least Z.mix.walkerFloor (the
  // other three scaled down together where they would take more)
  mix(n) {
    let runner = Z.mix.runner(n), armoured = Z.mix.armoured(n), bloater = Z.mix.bloater(n);
    const special = runner + armoured + bloater, room = 1 - Z.mix.walkerFloor;
    if (special > room) { const k = room / special; runner *= k; armoured *= k; bloater *= k; }
    return { walker: 1 - runner - armoured - bloater, runner, armoured, bloater };
  },
};

// Everything round n spawns (brutes included): what the director's `total` is for that round.
// Pure; the leaderboard's server-side sanity bounds mirror it.
export function roundTotal(n) {
  return n >= 1 ? rounds.roundTotal(Math.floor(n)) : 0;
}

// Every zombie spawned in rounds 1..n (0 for n < 1).
export function zombiesThroughRound(n) {
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += roundTotal(k);
  return sum;
}

/**
 * @param {object} o
 * @param {{next():number, pick(arr):any}} o.rng   seeded RNG (G.rng.fork('rounds'))
 * @param {() => Array} o.spawnPoints        current spawn points; empty -> the round waits
 * @param {(point, n, type) => any} o.spawn  returns a zombie id, or null/undefined if refused
 * @param {(name, payload) => void} o.emit
 * @param {() => (number[]|{x:number,z:number}|null)} [o.playerPos]  where the player is (the early
 *   rounds' minimum spawn distance); without it the distance is not applied
 * @param {Record<number, object>} [o.ease]  per-round easing (default tuning.round.ease)
 */
export function createRoundDirector({ rng, spawnPoints, spawn, emit = () => {}, playerPos = null, ease = R.ease || {} }) {
  const ids = new Map(); // id -> type
  const near = [];       // the spawn points far enough from the player (reused)
  let bloaters = 0;      // bloaters alive (of ours)
  let regular = 0, brutes = 0, regSpawned = 0, bruteSpawned = 0;
  // shares of this round, read once at start
  let pRunner = 0, pArmoured = 0, pBloater = 0;

  function forget(id) {
    const t = ids.get(id);
    if (t === undefined) return false;
    ids.delete(id);
    if (t === 'bloater') bloaters--;
    return t;
  }

  const d = {
    phase: 'idle', // idle | active | lull
    n: 0,
    total: 0,
    boss: false,
    spawned: 0,
    timer: 0, // active: seconds to next spawn; lull: seconds to next round
    // the type of the spawn being asked for, only while `spawn` runs (null otherwise): a spawn
    // callback that does not pass its third argument on can read it here
    pendingType: null,
    // this round's easing (tuning.round.ease[n]: grace, interval, minDist, slowWalkers) or null; the
    // spawn callback reads `slowWalkers` from it
    ease: null,
    get alive() { return ids.size; },

    start(n) {
      ids.clear(); bloaters = 0;
      d.n = n;
      d.boss = rounds.isBoss(n);
      regular = rounds.regulars(n); brutes = rounds.brutes(n);
      regSpawned = 0; bruteSpawned = 0;
      d.total = regular + brutes;
      const m = rounds.mix(n);
      pRunner = m.runner; pArmoured = m.armoured; pBloater = m.bloater;
      d.spawned = 0;
      d.ease = (ease && ease[n]) || null;
      d.timer = (d.ease && d.ease.grace) || 0; // first spawn is immediate, but for an early round's grace
      d.phase = 'active';
      emit('round:start', { n, total: d.total, boss: d.boss });
    },

    stop() { ids.clear(); bloaters = 0; d.phase = 'idle'; },

    onDeath(id) { return forget(id) !== false; },

    // Removed without dying (stuck guard, despawn, out of bounds): not a kill, so it is spawned
    // again to keep the round total.
    onRemove(id) {
      const t = forget(id);
      if (t === false) return false;
      d.spawned--;
      if (t === 'brute') bruteSpawned--; else regSpawned--;
      return true;
    },

    // Drop tracked ids the zombie manager no longer has (a removal we were never told about).
    reconcile(present) {
      for (const id of ids.keys()) if (!present.has(id)) d.onRemove(id); // (deleting from a Map while walking it is safe; no copy)
    },

    update(dt) {
      if (d.phase === 'active') {
        if (d.spawned < d.total) {
          d.timer -= dt;
          while (d.timer <= 0 && d.spawned < d.total && ids.size < rounds.maxAlive) {
            if (!trySpawn()) break; // no point or refused: retry next frame
            d.timer += interval();
          }
          // Waiting on the cap or on spawn points must not bank a burst of spawns.
          if (d.timer < 0) d.timer = 0;
        }
        if (d.spawned >= d.total && ids.size === 0) {
          d.phase = 'lull';
          d.timer = rounds.lull;
          emit('round:end', { n: d.n });
        }
      } else if (d.phase === 'lull') {
        d.timer -= dt;
        if (d.timer <= 0) d.start(d.n + 1);
      }
    },
  };

  // What comes next: a brute when the ordinary spawns reach its share of the round (spread evenly:
  // one brute half way, two at a third and two thirds...), else a type drawn from the round's mix.
  function nextType() {
    if (bruteSpawned < brutes && (regSpawned >= Math.floor((regular * (bruteSpawned + 1)) / (brutes + 1)) || regSpawned >= regular)) return 'brute';
    const r = rng.next();
    if (r < pBloater) return bloaters < Z.mix.maxBloaters ? 'bloater' : 'walker';
    if (r < pBloater + pArmoured) return 'armoured';
    if (r < pBloater + pArmoured + pRunner) return 'runner';
    return 'walker';
  }

  function interval() {
    const e = d.ease;
    return e && e.interval > 0 ? Math.max(e.interval, rounds.spawnInterval(d.n)) : rounds.spawnInterval(d.n);
  }

  const coord = (p, k) => (Array.isArray(p) ? p[k] : p.pos ? p.pos[k] : k === 0 ? p.x : p.z);
  // An early round's spawn points: those at least ease.minDist from the player, else the farthest
  // one (the round must not stall when the player stands where nothing is that far).
  function farEnough(pts) {
    const e = d.ease, pp = playerPos && e && e.minDist > 0 ? playerPos() : null;
    if (!pp) return pts;
    const px = Array.isArray(pp) ? pp[0] : pp.x, pz = Array.isArray(pp) ? pp[2] : pp.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return pts;
    near.length = 0;
    let far = null, farD = -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], dist = Math.hypot(coord(p, 0) - px, coord(p, 2) - pz);
      if (dist >= e.minDist) near.push(p);
      if (dist > farD) { farD = dist; far = p; }
    }
    if (!near.length && far) near.push(far);
    return near;
  }

  function trySpawn() {
    const pts = farEnough(spawnPoints() || []);
    if (!pts.length) return false;
    const type = nextType();
    d.pendingType = type;
    let id;
    try { id = spawn(rng.pick(pts), d.n, type); } finally { d.pendingType = null; }
    if (id === null || id === undefined || id === false) return false;
    ids.set(id, type);
    if (type === 'bloater') bloaters++;
    if (type === 'brute') bruteSpawned++; else regSpawned++;
    d.spawned++;
    return true;
  }

  return d;
}
