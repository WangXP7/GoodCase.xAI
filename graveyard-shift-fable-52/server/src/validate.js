// Pure validation for gamertags and submitted runs. No I/O, no platform APIs.

// ---------------------------------------------------------------- tags

export const TAG_RULES = {
  minLength: 3,
  maxLength: 16,
  // Letters, digits, underscore, hyphen, space. Checked after trimming and collapsing spaces.
  allowed: /^[A-Za-z0-9_\- ]+$/,
  // The uniqueness key must keep at least this many characters.
  minKeyLength: 3,
};

// Reserved names. A tag is refused when any word in it (or the whole tag run together) is one
// of these, after leetspeak folding and with trailing digits removed: "Admin Team", "4dm1n",
// "Admin_2", "N U L L".
const RESERVED = [
  'admin', 'administrator', 'moderator', 'mod', 'mods', 'graveyard',
  'graveyardshift', 'null', 'undefined', 'nan', 'none', 'system', 'root', 'support', 'staff',
  'official', 'owner', 'developer', 'dev', 'anonymous', 'anon', 'server', 'api', 'everyone',
];
// ...and any word that starts with one of these: "AdminTeam", "Moderator2", "GraveyardKing".
const RESERVED_PREFIX = ['admin', 'moderator', 'graveyard', 'official'];

// A deployment can reserve its own names on top of these (comma lists in the Worker's vars):
//   RESERVED_WORDS     extra whole words, matched like the list above
//   RESERVED_PREFIXES  extra prefixes, matched like RESERVED_PREFIX
const listVar = (v) => String(v || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
export function reservedFromEnv(env) {
  return { words: listVar(env && env.RESERVED_WORDS), prefixes: listVar(env && env.RESERVED_PREFIXES) };
}

// Severe words blocked anywhere, even inside a longer word or across spaces ("f u c k",
// "xFUCKx", "n1gg4"). Only words with no common innocent superstring belong here.
const BLOCK_ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'fagot', 'fuck', 'motherf', 'wetback', 'raghead', 'towelhead', 'kkk',
];

// Blocked as a whole word (words are split on spaces, _ and -, and on camelCase), with
// trailing digits, a plural "s" and repeated letters ("shiiit") tolerated. Matching whole words
// keeps Torpedo, Therapist, Swanky, Nigeria, Shiitake, Retardant, Penistone and Scunthorpe legal.
const BLOCK_WORD = [
  'nigger', 'niger', 'nig', 'negro', 'kike', 'chink', 'spic', 'gook', 'coon', 'beaner', 'retard',
  'tranny', 'fag', 'dyke', 'homo', 'jew', 'gay', 'cunt', 'shit', 'shithead', 'bullshit', 'bitch',
  'whore', 'slut', 'nazi', 'hitler', 'heil', 'isis', 'pedo', 'pedophile', 'molest', 'molester',
  'rape', 'rapist', 'ass', 'arse', 'asshole', 'asshat', 'dumbass', 'jackass', 'cock', 'cocksucker',
  'dick', 'dickhead', 'penis', 'vagina', 'pussy', 'porn', 'sex', 'tit', 'tits', 'boob', 'boobs',
  'cum', 'jizz', 'dildo', 'twat', 'wank', 'wanker', 'piss', 'fucker', 'fuk', 'fuq',
];

// Leetspeak folding used by the blocklist. "1" may stand for i or l, so both are tried.
function leetVariants(s) {
  const base = s
    .replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's')
    .replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g').replace(/6/g, 'g')
    .replace(/2/g, 'z');
  return [...new Set([base.replace(/1/g, 'i'), base.replace(/1/g, 'l')])];
}

// Folding used by the uniqueness key: look-alikes collapse to one letter so "B0B" and "BOB",
// "Dead1y" and "Deadly", "Il1" and "lll" are the same tag.
const KEY_FOLD = { 0: 'o', 1: 'l', i: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', 6: 'g', 2: 'z' };

// Lowercase, separators removed, look-alikes folded. Used for uniqueness and lookups.
export function tagKey(tag) {
  return String(tag)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[0-9i]/g, (c) => KEY_FOLD[c] ?? c);
}

const dedupe = (s) => s.replace(/(.)\1+/g, '$1');
const stripTrailingDigits = (s) => s.replace(/\d+$/, '');

// Words of a tag: split on separators, then on camelCase ("ShitHead" -> Shit, Head).
export function tagWords(tag) {
  return tag
    .split(/[\s_-]+/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

// Every spelling of one word to test: leet-folded, with and without trailing digits,
// with and without a final "s".
function wordForms(word) {
  const out = new Set();
  for (const w of [word, stripTrailingDigits(word)]) {
    if (!w) continue;
    for (const v of leetVariants(w)) {
      out.add(v);
      if (v.length > 3 && v.endsWith('s')) out.add(v.slice(0, -1));
    }
  }
  return out;
}

// Same word, allowing stretched letters ("shiiit") only for list words without doubles,
// so "boobs" never matches "bobs".
const sameWord = (form, w) => form === w || (dedupe(w) === w && dedupe(form) === w);

// Returns 'blocked', 'reserved' or null. `extra` adds reserved words and prefixes ({ words, prefixes }).
export function screenTag(tag, extra = {}) {
  const reserved = extra.words && extra.words.length ? [...RESERVED, ...extra.words] : RESERVED;
  const prefixes = extra.prefixes && extra.prefixes.length ? [...RESERVED_PREFIX, ...extra.prefixes] : RESERVED_PREFIX;
  const words = tagWords(tag);
  const joined = words.join('');
  const candidates = new Set();
  for (const w of [...words, joined]) for (const f of wordForms(w)) candidates.add(f);

  for (const f of wordForms(joined)) {
    const ff = dedupe(f);
    if (BLOCK_ANYWHERE.some((w) => f.includes(w) || (dedupe(w) === w && ff.includes(w)))) return 'blocked';
  }
  for (const f of candidates) {
    if (BLOCK_WORD.some((w) => sameWord(f, w))) return 'blocked';
  }
  for (const f of candidates) {
    if (reserved.includes(f) || prefixes.some((p) => f.startsWith(p))) return 'reserved';
  }
  return null;
}

function normaliseTag(raw) {
  if (typeof raw !== 'string') return { reason: 'tag_type' };
  if (raw.length > 64) return { reason: 'tag_length' };
  const tag = raw.trim().replace(/\s+/g, ' ');
  if (tag.length < TAG_RULES.minLength || tag.length > TAG_RULES.maxLength) return { reason: 'tag_length' };
  if (!TAG_RULES.allowed.test(tag)) return { reason: 'tag_chars' };
  const key = tagKey(tag);
  if (key.length < TAG_RULES.minKeyLength) return { reason: 'tag_length' };
  return { tag, key };
}

// Returns { ok:true, tag, key } or { ok:false, reason }.
// reason: 'tag_type' | 'tag_length' | 'tag_chars' | 'tag_blocked' | 'tag_reserved'
// `env` (optional) supplies the deployment's extra reserved names (RESERVED_WORDS, RESERVED_PREFIXES).
export function validateTag(raw, env) {
  const n = normaliseTag(raw);
  if (n.reason) return { ok: false, reason: n.reason };
  const bad = screenTag(n.tag, reservedFromEnv(env));
  if (bad) return { ok: false, reason: `tag_${bad}` };
  return { ok: true, tag: n.tag, key: n.key };
}

// Key for endpoints that receive an existing tag (score, recover, player): same
// normalisation, no blocklist (a tag that exists already passed it). null if malformed.
export function lookupKey(raw) {
  const n = normaliseTag(raw);
  return n.reason ? null : n.key;
}

// ---------------------------------------------------------------- runs

// Every bound the server applies to a submitted run. These MIRROR the game's real round director and
// tuning; tests/server.test.js imports the game's own functions and fails when the two drift apart.
// Sources:
//   src/game/rounds.js            roundTotal(n), zombiesThroughRound(n), rounds.brutes/regulars/isBoss
//   src/game/tuning/zombies.js    round.total, bossEvery/bossShare/maxBrutes, walker health curve,
//                                 types[].health, brute healthByRound, armoured armour, mix (type rounds)
//   src/game/tuning/core.js       round.spawnInterval, round.lull, maxAlive
//   src/game/tuning/economy.js    points.{hit,kill,headshotKill,meleeKill,bruteKill,start}, powerups
//   src/game/tuning/world.js      boards.repairCapPerRound
//   src/game/tuning/weapons.js    shotgun pellet damage x falloff floor (the weakest hit)
// When any of those change, change this object (and the formulas below) to match.
export const RUN_LIMITS = {
  roundMin: 1,
  roundCeiling: 999, // hard cap; the effective cap is roundMax below (what fits in maxTimeSec)

  // ---- spawns (tuning.zombies.round)
  maxAlive: 24,
  bossEvery: 5, // every fifth round is a boss round...
  bossShare: 0.6, // ...with 60 % of the usual crowd...
  maxBrutes: 3, // ...plus min(3, n / 5) brutes
  killAllowance: 10, // extra kills over every zombie spawned through the round
  stuckAllowancePerRound: 2, // zombies per completed round that may have left the round unkilled

  // ---- health (tuning.zombies.walker.health and types)
  // walker: 150 + 100(n-1) to round 9, x1.1 a round to 20, then x1.05 a round
  healthBase: 150,
  healthPerRound: 100,
  healthLinearUntil: 9,
  healthGrowth: 1.1,
  healthGrowthFrom: 20,
  healthGrowthLate: 1.05,
  // multiples of the walker's health for the ordinary types; brute: [round, x] points, linear between
  typeHealth: { walker: 1, runner: 0.85, armoured: 1.2, bloater: 2 },
  typeFrom: { walker: 1, runner: 4, armoured: 7, bloater: 9 }, // first round each type can spawn (mix)
  bruteHealthByRound: [[5, 12], [10, 8], [15, 6]],
  armourMin: 0.2, // armoured trooper: plate and pads take 0.2 of a hit

  // ---- points (tuning.economy, tuning.world.boards). Points are shown, ranked only on board=points,
  // so the ceiling is generous: every hit as weak as possible, every kill at the best bonus, Double
  // Time on all of it.
  pointsPerHit: 10,
  maxKillBonus: 130, // melee kill; headshot kill is 100, body kill 60
  bruteKillBonus: 500,
  startPoints: 500,
  pointsMultiplier: 2, // Double Time
  // The weakest single hit: one shotgun pellet at the end of its falloff (24 x 0.35 = 8.4). A shot
  // reports one hit per zombie (pellets summed), so a hit is never weaker than this.
  minHitDamage: 8,
  boardPointsPerRound: 200,
  flashoverPoints: 400,
  dropsPerRound: 4, // power-up drops a round, plus one guaranteed per brute
  // Searches (46 searchables x at most 400 points, x2 under Double Time) and fallback rewards.
  pointsAllowance: 50000,

  // ---- time (tuning.round.spawnInterval, lull): active play seconds, pauses excluded. A round of N
  // zombies cannot end sooner than N - 2 spawn intervals; then the lull. timeSlack is the margin.
  spawnIntervalStart: 2.0,
  spawnIntervalStep: 0.1,
  spawnIntervalMin: 0.6,
  lull: 10,
  timeSlack: 0.9,
  maxTimeSec: 24 * 60 * 60,

  versionMaxLength: 32,
  versionPattern: /^[A-Za-z0-9._+-]+$/,
  devices: ['desktop', 'phone'],
};

const isBoss = (n, L) => n > 0 && n % L.bossEvery === 0;

// tuning.zombies.round.total: the usual crowd of round n (before the boss share).
export function crowd(n) {
  if (n <= 10) return 6 + 4 * n;
  if (n <= 20) return Math.round(46 + 6 * (n - 10) + 0.5 * (n - 10) ** 2);
  return 156 + 10 * (n - 20);
}

export function brutesInRound(n, L = RUN_LIMITS) {
  return isBoss(n, L) ? Math.min(L.maxBrutes, Math.floor(n / L.bossEvery)) : 0;
}

// Everything round n spawns, brutes included (src/game/rounds.js roundTotal).
export function roundTotal(n, L = RUN_LIMITS) {
  if (!(n >= 1)) return 0;
  const k = Math.floor(n);
  const regulars = isBoss(k, L) ? Math.round(L.bossShare * crowd(k)) : crowd(k);
  return regulars + brutesInRound(k, L);
}

// Every zombie spawned in rounds 1..n (src/game/rounds.js zombiesThroughRound). Closed form for the
// crowd would be faster, but n <= roundCeiling and validateRun calls it a few times.
export function zombiesThroughRound(n, L = RUN_LIMITS) {
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += roundTotal(k, L);
  return sum;
}

export function walkerHealth(n, L = RUN_LIMITS) {
  if (n <= L.healthLinearUntil) return L.healthBase + L.healthPerRound * (n - 1);
  const top = L.healthBase + L.healthPerRound * (L.healthLinearUntil - 1);
  if (n <= L.healthGrowthFrom) return top * Math.pow(L.healthGrowth, n - L.healthLinearUntil);
  const at = top * Math.pow(L.healthGrowth, L.healthGrowthFrom - L.healthLinearUntil);
  return at * Math.pow(L.healthGrowthLate, n - L.healthGrowthFrom);
}

// The brute's multiple of the walker's health in round n (tuning.zombies.healthScale('brute', n)).
export function bruteScale(n, L = RUN_LIMITS) {
  const tab = L.bruteHealthByRound;
  if (!(n > tab[0][0])) return tab[0][1];
  for (let k = 1; k < tab.length; k++) {
    if (n <= tab[k][0]) { const [r0, v0] = tab[k - 1], [r1, v1] = tab[k]; return v0 + ((v1 - v0) * (n - r0)) / (r1 - r0); }
  }
  return tab[tab.length - 1][1];
}

export function spawnInterval(n, L = RUN_LIMITS) {
  return Math.max(L.spawnIntervalMin, L.spawnIntervalStart - L.spawnIntervalStep * n);
}

export function maxKills(round, L = RUN_LIMITS) {
  return zombiesThroughRound(round, L) + L.killAllowance;
}

// Reaching `round` means every zombie of rounds 1..round-1 died (a zombie removed without dying is
// spawned again), less a small allowance per completed round.
export function minKills(round, L = RUN_LIMITS) {
  const done = round - 1;
  return Math.max(0, zombiesThroughRound(done, L) - L.stuckAllowancePerRound * done);
}

// Most points one ordinary kill in rounds <= `round` can be worth: the costliest type that can be
// out by then (health over the weakest hit it can take), every hit paid, the best kill bonus, x2.
export function maxPointsPerKill(round, L = RUN_LIMITS) {
  let cost = 0;
  for (const [type, scale] of Object.entries(L.typeHealth)) {
    if (round < (L.typeFrom[type] ?? 1)) continue;
    const minHit = L.minHitDamage * (type === 'armoured' ? L.armourMin : 1);
    cost = Math.max(cost, scale / minHit);
  }
  const hits = Math.ceil(walkerHealth(round, L) * cost);
  return L.pointsMultiplier * (hits * L.pointsPerHit + L.maxKillBonus);
}

// Extra for every brute of rounds 1..round: its hits at the weakest damage and its kill bonus.
export function bruteBonusThrough(round, L = RUN_LIMITS) {
  let sum = 0;
  for (let n = 1; n <= round; n++) {
    const b = brutesInRound(n, L);
    if (!b) continue;
    const hits = Math.ceil((walkerHealth(n, L) * bruteScale(n, L)) / L.minHitDamage);
    sum += b * L.pointsMultiplier * (hits * L.pointsPerHit + L.bruteKillBonus + L.maxKillBonus);
  }
  return sum;
}

export function maxPoints(kills, round, L = RUN_LIMITS) {
  const perRound = L.pointsMultiplier * (L.boardPointsPerRound + L.flashoverPoints * (L.dropsPerRound + L.maxBrutes));
  return L.startPoints + L.pointsAllowance + round * perRound + kills * maxPointsPerKill(round, L) + bruteBonusThrough(round, L);
}

// Fastest possible arrival at `round`: each completed round's spawn pacing plus its lull.
export function minTimeSec(round, L = RUN_LIMITS) {
  let t = 0;
  for (let n = 1; n < round; n++) t += Math.max(0, roundTotal(n, L) - 2) * spawnInterval(n, L) + L.lull;
  return Math.floor(t * L.timeSlack);
}

// Highest round reachable within maxTimeSec (and the hard ceiling).
export function computeRoundMax(L = RUN_LIMITS) {
  let r = L.roundMin;
  while (r < L.roundCeiling && minTimeSec(r + 1, L) <= L.maxTimeSec) r++;
  return r;
}
RUN_LIMITS.roundMax = computeRoundMax(RUN_LIMITS);

const isInt = (v) => Number.isSafeInteger(v);

// Returns { ok:true, run } (a clean copy with only known fields) or { ok:false, reason }.
export function validateRun(run, L = RUN_LIMITS) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return { ok: false, reason: 'run_type' };
  const { round, kills, headshots, points, timeSec, version, device } = run;
  const roundMax = L.roundMax ?? computeRoundMax(L);

  if (!isInt(round) || round < L.roundMin || round > roundMax) return { ok: false, reason: 'round_range' };
  if (!isInt(kills) || kills < 0) return { ok: false, reason: 'kills_range' };
  if (kills > maxKills(round, L)) return { ok: false, reason: 'kills_impossible' };
  if (kills < minKills(round, L)) return { ok: false, reason: 'kills_too_few' };
  if (!isInt(headshots) || headshots < 0) return { ok: false, reason: 'headshots_range' };
  if (headshots > kills) return { ok: false, reason: 'headshots_exceed_kills' };
  if (!isInt(points) || points < 0) return { ok: false, reason: 'points_range' };
  if (points > maxPoints(kills, round, L)) return { ok: false, reason: 'points_impossible' };
  if (!isInt(timeSec) || timeSec < 0 || timeSec > L.maxTimeSec) return { ok: false, reason: 'time_range' };
  if (timeSec < minTimeSec(round, L)) return { ok: false, reason: 'time_too_fast' };
  if (typeof version !== 'string' || version.length < 1 || version.length > L.versionMaxLength
    || !L.versionPattern.test(version)) return { ok: false, reason: 'version_invalid' };
  if (!L.devices.includes(device)) return { ok: false, reason: 'device_invalid' };

  return { ok: true, run: { round, kills, headshots, points, timeSec, version, device } };
}
