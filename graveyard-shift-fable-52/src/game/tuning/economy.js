// The money economy: points, prices, the weapon box, the bench, the machines and the
// power-ups. Design choices unless marked; door prices are tuning.world.doors, wall
// weapon and wall ammo prices are tuning.weapons.table[id].wall.
export const economy = {
  // Points for hits and kills. hit, kill, headshotKill and start are the original values (tuning.points alias).
  points: { hit: 10, kill: 60, headshotKill: 100, meleeKill: 130, start: 500, bruteKill: 500 },
  // Original alias (tuning.wallAmmo): the store's wall ammo is the pistol's, at the pistol's price.
  wallAmmo: { cost: 250 },
  upgradedAmmo: 4500, // no longer a price: upgraded ammo is crateUpgraded's rule everywhere (kept while the info panel still reads it)
  // The forecourt ammo crate refills the reserve of the weapon in hand (only that one: swap to buy for
  // the other); a wall buy refills its own gun. Both charge the same. The stock price: the weapon's own wall-ammo price (tuning.weapons.table[id].wall.ammo)
  // when it has one, else its class's below. Upgraded: `crateUpgraded.scale` x the stock price, at
  // most `crateUpgraded.max` (pistol 750, pump 1200, SMG and revolver 1500, rifle 2100, heavy rifle
  // 2250, auto shotgun 2400, LMG and specials 3000). Design choices.
  crateAmmo: { pistol: 250, revolver: 500, shotgun: 500, smg: 500, rifle: 750, lmg: 1000, special: 1500 },
  crateUpgraded: { scale: 3, max: 3000 },
  // worldLayout's wall-buy names -> the weapon table's ids
  wallBuys: { hollis12: 'pump', pike45: 'smg', calder556: 'rifle', brandt12: 'autoShotgun' },
  // Weapon box: weighted by tuning.weapons.table[id].box, excluding weapons held. Works without power.
  box: {
    cost: 950,
    roll: 3.5, // s from the roll to the offer
    offer: 10, // s the offer is held, then lost with no refund
    move: 4, // s the box is gone while it moves
    usesMin: 4, usesMax: 8, // it moves after a seeded int(usesMin, usesMax) uses (design 5.2)
  },
  bench: { cost: 4000 }, // one upgrade tier per weapon; needs power
  // Machines: need power, kept until death.
  machines: {
    secondHelping: { name: 'Second Helping', cost: 2500, maxHealth: 175 },
    shortOrder: { name: 'Short Order', cost: 3000, reloadScale: 0.6 },
    longHaul: { name: 'Long Haul', cost: 2000, speed: 1.12 }, // walk and sprint; no stamina system
    // a killing hit leaves you at `health`, immune for `invuln` s, and throws back every zombie within
    // `radius` m; then the machine is spent and costs `step` more each time it is bought again
    // push: metres each zombie is thrown back (G.zombies.stagger takes a distance: about 2.5 m/s for 0.6 s)
    jumpStart: { name: 'Jump Start', cost: 1500, step: 1000, health: 50, invuln: 3, radius: 4, push: 1.5, stagger: 1.2 },
  },
  machineKinds: ['jumpStart', 'secondHelping', 'shortOrder', 'longHaul'],
  // Power-ups dropped by kills.
  powerups: {
    kinds: ['resupply', 'oneTap', 'doubleTime', 'flashover'],
    names: { resupply: 'Resupply', oneTap: 'One-Tap', doubleTime: 'Double Time', flashover: 'Flashover' },
    chance: 0.03, // of a kill
    perRound: 4, // at most this many drops a round (a brute's drop does not count against it)
    gap: 10, // s: never a drop within this long of the last one
    radius: 1.2, // m: picked up by walking this close
    ttl: 25, // s on the ground
    seconds: { oneTap: 30, doubleTime: 30 }, // timed ones (a searched one lasts half)
    multiplier: 2, // Double Time
    flashoverPoints: 400, // flat, once
    bruteShare: 0.5, // Flashover takes this share of a brute's max health instead of killing it
  },
  // Board repairs: tuning.world.boards (repairEvery, repairPoints, repairCapPerRound).
};
