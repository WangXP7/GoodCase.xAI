// Weapon table, melee, throwables and attachments. The only place weapon numbers live.
// The pistol keeps the original keys (`semiAuto`, `mag`, `reserve`, `maxReserve`, `damage`, `rpm`,
// `reload`, `range`), so `tuning.pistol` (aliased to `weapons.pistol`) reads as before.
//
// Def = { id, name, cls, auto, semiAuto, mag, reserve, maxReserve, damage, pellets, rpm, reload,
//         reloadKind:'mag'|'shell'|'cylinder'|'belt'|'cell', shellStart, range,
//         falloff:[start, end, minScale]|null, spread, recoil, pierce, penetration, moveScale, zoom,
//         wall:{cost, ammo}|null, box, special, tracer, finish,
//         upgraded:{name, damage, mag, reserve, maxReserve, tracer, finish} }
// Spread values are cone half-angles in degrees; recoil is radians per shot (positive pitch looks up).

// ---------------------------------------------------------------- penetration by class
// A round passes through zombies standing in line: `bodies` more after the first, each one taking
// `keep` x the damage the one before it took, and never more than `reach` m past the first body.
// Walls and props stop it. A weapon may override any key (`penetration: {...}` in its entry);
// `pierce` on a Def is its `bodies`. Design choices in the genre's manner.
const penetration = {
  pistol: { bodies: 1, keep: 0.5, reach: 3 },
  revolver: { bodies: 2, keep: 0.7, reach: 6 },
  shotgun: { bodies: 1, keep: 0.5, reach: 1.5 }, // per pellet
  smg: { bodies: 1, keep: 0.55, reach: 3 },
  rifle: { bodies: 3, keep: 0.75, reach: 8 },
  lmg: { bodies: 4, keep: 0.8, reach: 10 },
  special: { bodies: 0, keep: 0, reach: 0 }, // the Jumper arcs instead; the Roadflare is lobbed
};
// An upgraded weapon's round goes `bodies` further, keeps `keep` more (at most `keepMax`) and
// reaches `reach` x as far.
const penetrationUpgrade = { bodies: 1, keep: 0.1, keepMax: 0.95, reach: 1.5 };

// ---------------------------------------------------------------- spread and recoil by class
// The pistol's numbers are the original ones (they were SPREAD / RECOIL at the top of firing.js).
const classes = {
  pistol: {
    spread: { ads: 0.15, hip: 1.2, move: 1.0, air: 2.0, bloom: 0.3, bloomMax: 0.9, bloomRecover: 0.25 },
    recoil: { pitchMin: 0.009, pitchMax: 0.014, yaw: 0.004, adsScale: 0.55, shake: 0.07, adsShake: 0.035 },
  },
  revolver: {
    spread: { ads: 0.12, hip: 1.4, move: 1.0, air: 2.0, bloom: 0.6, bloomMax: 1.2, bloomRecover: 0.4 },
    recoil: { pitchMin: 0.03, pitchMax: 0.04, yaw: 0.01, adsScale: 0.6, shake: 0.14, adsShake: 0.07 },
  },
  // `pellet`: the cone each pellet takes around the aimed direction
  shotgun: {
    spread: { ads: 0.8, hip: 1.8, move: 0.8, air: 1.5, bloom: 0, bloomMax: 0, bloomRecover: 0.25, pellet: 3.5 },
    recoil: { pitchMin: 0.035, pitchMax: 0.05, yaw: 0.012, adsScale: 0.7, shake: 0.16, adsShake: 0.1 },
  },
  smg: {
    spread: { ads: 0.35, hip: 1.8, move: 0.8, air: 2.0, bloom: 0.12, bloomMax: 1.2, bloomRecover: 0.3 },
    recoil: { pitchMin: 0.004, pitchMax: 0.007, yaw: 0.003, adsScale: 0.6, shake: 0.04, adsShake: 0.02 },
  },
  rifle: {
    spread: { ads: 0.12, hip: 2.0, move: 1.2, air: 2.5, bloom: 0.15, bloomMax: 1.5, bloomRecover: 0.35 },
    recoil: { pitchMin: 0.005, pitchMax: 0.009, yaw: 0.0035, adsScale: 0.55, shake: 0.05, adsShake: 0.025 },
  },
  lmg: {
    spread: { ads: 0.3, hip: 2.6, move: 1.5, air: 3.0, bloom: 0.1, bloomMax: 1.8, bloomRecover: 0.4 },
    recoil: { pitchMin: 0.005, pitchMax: 0.009, yaw: 0.004, adsScale: 0.6, shake: 0.05, adsShake: 0.03 },
  },
  special: {
    spread: { ads: 0.2, hip: 1.0, move: 0.6, air: 1.5, bloom: 0, bloomMax: 0, bloomRecover: 0.25 },
    recoil: { pitchMin: 0.02, pitchMax: 0.03, yaw: 0.006, adsScale: 0.6, shake: 0.1, adsShake: 0.05 },
  },
};

// One tier: damage x2, magazine x1.5 rounded up, reserve and max x1.5.
const upgrade = { damage: 2, mag: 1.5, reserve: 1.5, tracer: 'violet', finish: 'upgraded' };

function def(id, name, cls, o, upName) {
  const c = classes[o.spreadClass || cls];
  const d = {
    id, name, cls, auto: false, pellets: 1, reloadKind: 'mag', shellStart: 0, falloff: null,
    pierce: 0, moveScale: 1, zoom: 0.8, wall: null, box: 0, special: null, tracer: 'warm', finish: 'stock',
    spread: c.spread, recoil: c.recoil,
    ...o,
  };
  delete d.spreadClass;
  d.penetration = { ...(penetration[o.spreadClass || cls] || penetration.special), ...(o.penetration || null) };
  d.pierce = d.penetration.bodies;
  d.semiAuto = !d.auto;
  d.upgraded = {
    name: `${name} "${upName}"`,
    damage: d.damage * upgrade.damage,
    mag: Math.ceil(d.mag * upgrade.mag),
    reserve: Math.round(d.reserve * upgrade.reserve),
    maxReserve: Math.round(d.maxReserve * upgrade.reserve),
    tracer: upgrade.tracer,
    finish: upgrade.finish,
    penetration: d.penetration.bodies > 0 ? {
      bodies: d.penetration.bodies + penetrationUpgrade.bodies,
      keep: Math.min(penetrationUpgrade.keepMax, d.penetration.keep + penetrationUpgrade.keep),
      reach: d.penetration.reach * penetrationUpgrade.reach,
    } : d.penetration,
  };
  return d;
}

const table = {
  pistol: def('pistol', 'Wren 9', 'pistol', {
    mag: 12, reserve: 48, maxReserve: 96, damage: 40, rpm: 400, reload: 1.6, range: 60,
    wall: { cost: null, ammo: 250 }, box: 0,
  }, 'Night Owl'),
  revolver: def('revolver', 'Marlow .44', 'revolver', {
    mag: 6, reserve: 36, maxReserve: 72, damage: 140, rpm: 150, reload: 2.4, reloadKind: 'cylinder', range: 70,
    box: 3,
  }, 'Last Call'),
  pump: def('pump', 'Hollis 12', 'shotgun', {
    // 85 rpm (a balance choice): at 70 it only matched the pistol's damage per second
    mag: 6, reserve: 30, maxReserve: 54, damage: 28, pellets: 8, rpm: 85, reload: 0.55, reloadKind: 'shell',
    range: 22, falloff: [8, 22, 0.35], wall: { cost: 1000, ammo: 400 }, box: 2,
  }, 'Deadfall'),
  autoShotgun: def('autoShotgun', 'Brandt 12', 'shotgun', {
    mag: 8, reserve: 32, maxReserve: 64, damage: 24, pellets: 8, rpm: 220, reload: 0.45, shellStart: 0.5,
    reloadKind: 'shell', range: 20, falloff: [7, 20, 0.35], wall: { cost: 2000, ammo: 800 }, box: 3,
  }, 'Squall'),
  smg: def('smg', 'Pike 45', 'smg', {
    auto: true, mag: 30, reserve: 120, maxReserve: 240, damage: 32, rpm: 780, reload: 1.9, range: 40,
    moveScale: 1.0, wall: { cost: 1250, ammo: 500 }, box: 3,
  }, 'Whiplash'),
  rifle: def('rifle', 'Calder 556', 'rifle', {
    auto: true, mag: 30, reserve: 120, maxReserve: 240, damage: 48, rpm: 650, reload: 2.2, range: 80,
    wall: { cost: 1750, ammo: 700 }, box: 3,
  }, 'Long Night'),
  battleRifle: def('battleRifle', 'Ostrander 308', 'rifle', {
    mag: 20, reserve: 80, maxReserve: 160, damage: 110, rpm: 320, reload: 2.5, range: 100, box: 3,
    penetration: { bodies: 5, keep: 0.85, reach: 12 }, // the heavy rifle: the deepest of all
    recoil: { pitchMin: 0.016, pitchMax: 0.024, yaw: 0.006, adsScale: 0.55, shake: 0.09, adsShake: 0.045 },
  }, 'Iron Vigil'),
  lmg: def('lmg', 'Dray 762', 'lmg', {
    auto: true, mag: 75, reserve: 150, maxReserve: 300, damage: 62, rpm: 560, reload: 4.6, reloadKind: 'belt',
    range: 80, moveScale: 0.9, box: 2,
  }, 'Undertow'),
  // A truck battery booster with clamps: the first hit arcs on to `extra` more zombies, each within
  // `radius` of the one before, each taking `scale` x the weapon's damage. Box only.
  jumper: def('jumper', 'The Jumper', 'special', {
    mag: 8, reserve: 24, maxReserve: 40, damage: 600, rpm: 60, reload: 2.8, reloadKind: 'cell', range: 25,
    box: 1, special: { kind: 'arc', extra: 4, radius: 5, scale: 0.6 },
  }, 'Jump Lead'),
  // A lobbed flare: flies at `speed` m/s, `angle` degrees above the aim, under `gravity` (light, so
  // the arc carries about `range` m before it has dropped a couple of metres), for at most `life` s.
  // It bursts on the first zombie or surface it meets: `damage` to a zombie it strikes, then a pool
  // of `radius` m burning `dps` for `seconds` where it burst. Box only.
  flare: def('flare', 'Roadflare', 'special', {
    mag: 1, reserve: 12, maxReserve: 20, damage: 200, rpm: 40, reload: 1.7, range: 45,
    box: 1,
    special: { kind: 'flare', speed: 45, angle: 2, gravity: 3, life: 4, radius: 3, seconds: 6, dps: 150, playerDps: 0 },
  }, 'Signal Fire'),
};

// Melee: one swing every `time` s, hits up to `hits` zombies within `reach` (m, from the eye,
// horizontally, to the zombie's surface) and inside `cone` (cosine of the half-angle) of the view.
const melee = {
  knife: { name: 'Knife', damage: 150, reach: 1.6, time: 0.7, hits: 1, cone: 0.6 },
  axe: { name: 'Fire axe', damage: 600, reach: 1.9, time: 0.9, hits: 2, cone: 0.6 },
};

// Throwables: thrown at `speed` m/s, `angle` degrees above the view; bounce and roll on the level.
const throwables = {
  speed: 14, angle: 12, gravity: 9.81, cooldown: 0.8, radius: 0.06, bounce: 0.35, friction: 0.6,
  roll: 6, // m/s² of rolling friction on the ground
  rest: 0.4, // m/s: below this on the ground it stops
  poolTick: 0.25, // s between fire-pool damage ticks
  kinds: ['frag', 'molotov', 'decoy'],
  // Centre damage max(damage, healthScale x walker health this round) (a balance choice:
  // throwables stay useful late), falling linearly to 0 at 5 m; the player takes `selfScale` of it.
  frag: { name: 'Frag', carry: 3, fuse: 2.5, damage: 900, healthScale: 1.2, radius: 5, selfScale: 0.25 },
  // Breaks on the first contact (level, ground or zombie) into a pool. Its total damage over the burn
  // is max(dps x seconds, healthScale x walker health this round) (a balance choice).
  molotov: { name: 'Molotov', carry: 2, radius: 2.8, seconds: 8, dps: 120, healthScale: 1.0, playerDps: 15 },
  // once it lands, draws every zombie within `lureRadius` for `seconds`, then bursts (flat damage)
  decoy: { name: 'Decoy', carry: 2, lureRadius: 25, seconds: 8, burst: 300, burstRadius: 3 },
};

// One of each per weapon, kept with the slot and lost with it.
const attachments = {
  kinds: ['sight', 'mag', 'grip', 'suppressor'],
  sight: { adsSpread: 0.5, zoom: 0.65 },
  mag: { mag: 1.5 },
  grip: { recoil: 0.7, hipSpread: 0.8 },
  suppressor: { range: 1.15, recoil: 0.9 },
};

export const weapons = {
  table,
  ids: Object.keys(table),
  pistol: table.pistol, // original alias (tuning.pistol)
  classes,
  penetration,
  penetrationUpgrade,
  upgrade,
  melee,
  throwables,
  attachments,
  swapTime: 0.5, // s from a switch to the first shot when the view gives no timing
  grantFraction: 0.65, // a magazine reload moves its ammo at this fraction of the reload without view timing
  fireBuffer: 0.08, // s: a semi-automatic press this close to the end of the cooldown fires when it ends
  movingSpeed: 0.5, // m/s of ground speed that counts as moving (spread)
};
