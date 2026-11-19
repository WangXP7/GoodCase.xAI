// The only place gameplay numbers live: an aggregator over src/game/tuning/*.
//   tuning = { ...core, touch, weapons, world, economy, loot, zombies }
// The original keys stay alive by alias, each falling back to core while its own file is still
// a placeholder (an empty object): pistol, walker, round, points, wallAmmo.
import { core } from './tuning/core.js';
import { touch } from './tuning/touch.js';
import { weapons } from './tuning/weapons.js';
import { world } from './tuning/world.js';
import { economy } from './tuning/economy.js';
import { loot } from './tuning/loot.js';
import { zombies } from './tuning/zombies.js';

export const tuning = {
  ...core,
  touch, weapons, world, economy, loot, zombies,
  pistol: weapons.pistol ?? core.pistol,
  walker: zombies.walker ?? core.walker,
  round: zombies.round ?? core.round,
  points: economy.points ?? core.points,
  wallAmmo: economy.wallAmmo ?? core.wallAmmo,
};
