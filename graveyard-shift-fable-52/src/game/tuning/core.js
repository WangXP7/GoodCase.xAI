// The original values, frozen. The aggregator (../tuning.js) re-exports them under their old keys.
export const core = {
  player: { eye: 1.7, radius: 0.35, walk: 4.2, sprint: 6.5, jump: 4.8, health: 100, regenDelay: 4, regenRate: 25 },
  walker: {
    speedMin: 1.1, speedMax: 1.6,
    // 150 + 100*(n-1) for n<=9, then *1.1 per round beyond 9
    health: (n) => (n <= 9 ? 150 + 100 * (n - 1) : (150 + 100 * 8) * Math.pow(1.1, n - 9)),
    attack: 34, reach: 1.1, windup: 0.5, cooldown: 1.2, headMultiplier: 3,
  },
  round: {
    total: (n) => 6 + 4 * n,
    maxAlive: 24,
    spawnInterval: (n) => Math.max(0.6, 2.0 - 0.1 * n),
    lull: 10,
  },
  points: { hit: 10, kill: 60, headshotKill: 100, start: 500 },
  pistol: { mag: 12, reserve: 48, maxReserve: 96, damage: 40, rpm: 400, semiAuto: true, reload: 1.6, range: 60 },
  wallAmmo: { cost: 250 }, // fills reserve to pistol.maxReserve
};

// Frozen: other modules add values in their own section, they do not edit these.
const freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
  return Object.freeze(o);
};
freeze(core);
