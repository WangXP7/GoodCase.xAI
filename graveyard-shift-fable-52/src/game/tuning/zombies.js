// Zombie types, round scaling and limb loss. The core numbers (walker, health curve, 24 alive, a boss every fifth round,
// types and the rounds they enter) first, then the tuning choices. Read by src/game/rounds.js (the director) and src/zombie/{types,manager}.js.
import { core } from './core.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Walker health (a balance choice): the original +100 a round to round 9, then
// x1.1 a round to round 20 (2710 at 20), then only x1.05 a round so late rounds do not become a grind
// (4415 at 30, 7192 at 40). tuning.walker.health is this function (the frag and molotov scale with it).
const health = (n) => {
  if (n <= 9) return core.walker.health(n);
  const h20 = (150 + 100 * 8) * Math.pow(1.1, 20 - 9);
  return n <= 20 ? (150 + 100 * 8) * Math.pow(1.1, n - 9) : h20 * Math.pow(1.05, n - 20);
};
const walker = { ...core.walker, health };

// The round's numbers. `total`, `maxAlive`, `spawnInterval` and `lull` keep the original shape
// (tuning.round is an alias of this object).
const round = {
  // 6 + 4n to round 10 (46), then faster: 46 + 6(n-10) + 0.5(n-10)^2 (53 at 11, 89 at 15, 156 at 20);
  // after round 20 only +10 a round (166 at 21, 256 at 30, 356 at 40: a balance choice, no grind)
  total: (n) => (n <= 10 ? 6 + 4 * n : n <= 20 ? Math.round(46 + 6 * (n - 10) + 0.5 * (n - 10) ** 2) : 156 + 10 * (n - 20)),
  maxAlive: 24,
  spawnInterval: core.round.spawnInterval,
  lull: core.round.lull,
  // every fifth round is a boss round: 60 % of the usual crowd, plus min(3, n/5) brutes
  bossEvery: 5,
  bossShare: 0.6,
  maxBrutes: 3,
  // The first rounds ease a new player in (launch fix: an idle player died 20 s into round 1, still
  // reading the hints). Per round: no spawn for `grace` s after the round starts; at most one spawn
  // every `interval` s; only from spawn points at least `minDist` m from the player (the farthest
  // one when none is that far); walkers at the low end of their speed range (`slowWalkers`).
  // Rounds not listed are unchanged.
  ease: {
    1: { grace: 8, interval: 3.5, minDist: 25, slowWalkers: true },
    2: { grace: 5 },
  },
};

// Shares of a round's ordinary spawns (the rest are walkers). Tuned on the type schedule,
// with these balance choices: runners +0.07 a round from round 4 (0.35 at 8, 0.7 from
// 13); walkers never under `walkerFloor` of the ordinary spawns (where runners + armoured + bloaters
// would pass 0.85, rounds.mix scales the three down together, keeping their proportions: from round 12).
const mix = {
  runner: (n) => clamp(0.07 * (n - 3), 0, 0.7),                       // 0.07 at round 4, 0.35 at 8, 0.7 from 13
  armoured: (n) => (n < 7 ? 0 : clamp(0.1 + (0.1 * (n - 7)) / 5, 0.1, 0.2)), // 0.1 at 7 rising to 0.2 at 12
  bloater: (n) => (n < 9 ? 0 : 1 / 12),                               // one in 12 spawns from round 9...
  maxBloaters: 2,                                                     // ...and never more than 2 alive
  walkerFloor: 0.15,
};

// The last zombies of a round (a balance choice): once everything has spawned and at most `count`
// are left for `after` s, each is announced (round:straggler, again every `every` s) and the walking
// ones move `speed` x faster; a crawler left that long for `crawlerAfter` s is moved to a breach out of
// view nearer the player.
const straggler = { count: 3, after: 30, every: 10, speed: 1.5, crawlerAfter: 60, retry: 1 };

// Per type. health: multiple of the round's walker health; speed: [min, max] m/s; attack: damage of
// a landed swing; reach (m), windup and cooldown (s) of the swing.
const W = core.walker;
const types = {
  walker: { health: 1, speed: [W.speedMin, W.speedMax], attack: W.attack, reach: W.reach, windup: W.windup, cooldown: W.cooldown, gait: 'walk' },
  runner: { health: 0.85, speed: [3.4, 4.2], attack: 28, reach: W.reach, windup: 0.35, cooldown: W.cooldown, gait: 'run' },
  // trooper gear: the chest plate takes 0.2 of a hit from the front, the back of the torso 1.5,
  // arms and legs (pads) 0.2; the head is bare (x3 as usual)
  armoured: { health: 1.2, speed: [W.speedMin, W.speedMax], attack: W.attack, reach: W.reach, windup: W.windup, cooldown: W.cooldown, gait: 'walk',
    armour: { front: 0.2, back: 1.5, limbs: 0.2 } },
  // no swing: it bursts on death, or `fuse` s after coming within `trigger` m of the player, into a
  // cloud of `radius` m for `seconds` s that hurts the player `dps` a second (in `tick` s steps)
  bloater: { health: 2, speed: [0.9, 1.1], attack: 0, reach: W.reach, windup: W.windup, cooldown: W.cooldown, gait: 'walk',
    burst: { trigger: 1.5, fuse: 0.8, radius: 3.5, seconds: 6, dps: 12, tick: 0.5 } },
  // boss: a heavy swing (windup and cooldown are tuning choices), a ground slam every `every` s
  // hitting everything within `radius` m; staggered only by explosions and shotgun blasts within
  // `shotgunStagger` m; One-Tap does not kill it
  // health: x walker health at round 5; `healthByRound` [round, x] points, linear between them and flat
  // outside (a balance choice: 12x at 5, 8x at 10, 6x from 15)
  brute: { health: 12, healthByRound: [[5, 12], [10, 8], [15, 6]], speed: [2.2, 2.2], attack: 60, reach: 1.6, windup: 0.6, cooldown: 1.4, gait: 'run',
    slam: { every: 6, radius: 2.5, damage: 40, windup: 0.6 }, shotgunStagger: 4, oneTapImmune: true, stagger: 0.8 },
};

// Limb loss. A leg comes off at `leg` x max health taken on it, an arm at `arm`; a killing headshot of
// at least `head` x max health takes the head; a killing explosion takes 1..3 limbs.
const limbs = { leg: 0.4, arm: 0.35, head: 0.5, explosion: [1, 3], armScale: 0.5 };
// Without a leg it crawls (every type): slow, short reach, weaker; each missing arm halves the damage.
const crawler = { speed: 0.7, attack: 20, reach: 0.9 };

// The body pool built at load (24 live + 12 corpses): dedicated bodies for the special types, the
// rest civilians (any variant but the trooper, whose armour would mislead).
const pool = { brute: 3, bloater: 3, armoured: 4, civilians: ['trucker', 'waitress', 'mechanic', 'guest', 'drifter'] };

// A type's multiple of the round's walker health: `healthByRound` [[round, x], ...] linear between
// the points and flat outside them, else the type's fixed `health`.
function healthScale(type, n) {
  const t = types[type] || types.walker;
  const tab = t.healthByRound;
  if (!tab) return t.health;
  if (!(n > tab[0][0])) return tab[0][1];
  for (let k = 1; k < tab.length; k++) {
    if (n <= tab[k][0]) { const [r0, v0] = tab[k - 1], [r1, v1] = tab[k]; return v0 + ((v1 - v0) * (n - r0)) / (r1 - r0); }
  }
  return tab[tab.length - 1][1];
}

export const zombies = {
  healthScale,
  walker, // the original walker with the health curve above (tuning.walker is an alias)
  round,
  mix,
  straggler,
  types,
  ids: Object.keys(types),
  limbs,
  crawler,
  lure: { radius: 25, stop: 1.2 }, // decoys: zombies within radius m go to it and gather this close
  relocateEvery: 1, // s between checks for zombies left in a zone the player can no longer reach
  respawnRetry: 1,  // s between tries of a stuck respawn that found every spawn point in view
  // The swing's strength (0..1, src/zombie/ai.js AI and AI.eased): at 1 a zombie swings at where a
  // moving player will be when the blow lands, the blow stays live a moment, reaches a little further
  // and lands on a player level with its shoulders, and it turns fast through the wind-up, so running
  // past one within arm's length is hit; at 0 it swings at where the player stands and the blow lands
  // in front of it only. `byRound` eases the first rounds in (round 1 at 0, round 2 half way, round 3 three quarters); the
  // rest are at `strength`.
  swing: { strength: 1, byRound: { 1: 0, 2: 0.5, 3: 0.75 } },
  climbMax: 5,      // s: a climb (fence or window) ends after this whatever the animator does
  breachBoards: 3,  // a zombie tearing a window's boards swings through it at a player in reach once at most this many are left
  pool,
};
