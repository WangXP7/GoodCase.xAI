export const DUEL_REACTION_SECONDS = 3;

export function acompanharDuelo(g) {
  const d = { shots: 0, hits: 0, hs: 0, deaths: 0, firstHit: null, lastHit: -Infinity,
    ttk: 0, ttkN: 0, burstSum: 0, burstN: 0, woundedBursts: 0, deathsWithoutHit: 0, incompleteLives: 0, healthyFastBursts: 0 };
  let burstStart = null, burstHp = 100, sampledDamage = false;
  const flash = g._flash.bind(g), damage = g._damage.bind(g), kill = g._kill.bind(g);
  g._flash = (...args) => { d.shots++; return flash(...args); };
  g._kill = (ent, ...args) => {
    if (ent.isPlayer && ent.alive) {
      d.deaths++;
      if (!sampledDamage) { d.deathsWithoutHit++; if (d.firstHit !== null) d.incompleteLives++; d.firstHit = null; burstStart = null; }
    }
    return kill(ent, ...args);
  };
  g._damage = (ent, amount, attacker, weapon, head, ...args) => {
    const hp = ent.hp, alive = ent.alive;
    const eligible = ent.isPlayer && alive && g.bots.includes(attacker) && weapon !== 'FRAG';
    sampledDamage = eligible;
    let result;
    try { result = damage(ent, amount, attacker, weapon, head, ...args); }
    finally { sampledDamage = false; }
    if (!eligible || !(ent.hp < hp)) return result;
    d.hits++; if (head) d.hs++;
    if (d.firstHit !== null && hp >= 100) d.incompleteLives++;
    if (d.firstHit === null || hp >= 100) d.firstHit = g.time;
    if (burstStart === null || hp >= 100 || g.time - d.lastHit > DUEL_REACTION_SECONDS) {
      burstStart = g.time; burstHp = hp;
    }
    d.lastHit = g.time;
    if (!ent.alive) {
      d.ttk += g.time - d.firstHit; d.ttkN++;
      d.burstSum += g.time - burstStart; d.burstN++;
      if (burstHp < 100) d.woundedBursts++;
      else if (g.time - burstStart < DUEL_REACTION_SECONDS) d.healthyFastBursts++;
      d.firstHit = null; burstStart = null;
    }
    return result;
  };
  return d;
}
