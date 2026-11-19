// Searching: findable loot. Every searchable is searched once per
// game for one seeded reward. Design choices, open to tuning.
export const loot = {
  hold: 1.5, // s of interact held
  radius: 1.6, // m: stand this close to start
  slack: 0.3, // m: moving this far outside the radius cancels
  // Reward weights by round bracket; each column sums to 100. `brackets[i]` is the first round of
  // column i.
  brackets: [1, 5, 10],
  table: [
    // kind,        1-4, 5-9, 10+
    ['ammo', 30, 28, 26],
    ['points', 22, 21, 20],
    ['nothing', 12, 10, 8],
    ['medkit', 10, 10, 10],
    ['throwable', 10, 10, 10],
    ['plate', 6, 7, 8],
    ['powerup', 5, 6, 7],
    ['attachment', 3, 4, 5],
    ['weapon', 2, 4, 6],
  ],
  ammo: { share: 0.3, specialShare: 0.25 }, // of the held weapon's max reserve; specials: jumper, flare
  points: { min: 50, max: 150, perRound: 0.1, cap: 400 }, // round10(rng(min,max) * (1 + perRound * round)), <= cap
  medkit: 60, // health at once; at full health a plate instead
  powerups: ['doubleTime', 'oneTap'], // half their dropped length
  powerupScale: 0.5,
  weapons: ['revolver', 'battleRifle', 'lmg'], // Marlow .44, Ostrander 308, Dray 762
  weaponCap: 2, // a game; then the fallback points
  axeChance: 0.25, // of a weapon roll, once a game: the fire axe instead
  pickupTtl: 30, // s a weapon pickup stays on the object
  // points paid, flat, whenever the reward is not needed (full reserve, full health and three
  // plates, a full throwable kind, all four attachments, the rare-weapon cap reached): review fix
  // round 1, in place of the plan's points roll / 150 / 250
  fallbackPoints: 25,
};
