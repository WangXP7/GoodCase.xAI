// Leaderboard Worker (server/): pure validation, crypto helpers, and the HTTP handlers end to
// end against an in-memory D1 fake backed by node:sqlite running the real schema.sql.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateTag, reservedFromEnv, tagKey, lookupKey, validateRun, RUN_LIMITS, maxKills, minKills, maxPoints,
  minTimeSec, zombiesThroughRound, roundTotal, walkerHealth, bruteScale, brutesInRound, spawnInterval,
  computeRoundMax, maxPointsPerKill,
} from '../server/src/validate.js';
import * as game from '../src/game/rounds.js';
import { tuning } from '../src/game/tuning.js';
import {
  sha256Hex, generateSecret, hashSecret, timingSafeEqual, generateRecovery, normalizeRecovery,
  hashRecovery, hashIp, RECOVERY_ALPHABET,
} from '../server/src/crypto.js';
import * as store from '../server/src/db.js';
import { hit, peek, pruneRate, RATE_RETENTION_MS, ipBucket, expandIPv6, windowStart } from '../server/src/rate.js';
import worker, { handle, housekeeping, MAX_BODY_BYTES } from '../server/src/index.js';
import { FakeD1 } from '../server/test/fakeD1.js';

// ------------------------------------------------------------------ tags

describe('validateTag', () => {
  const accepted = [
    ['Dead Eye', 'Dead Eye'],
    ['  dead    eye  ', 'dead eye'],
    ['x_X-9', 'x_X-9'],
    ['abc', 'abc'],
    ['A234567890123456', 'A234567890123456'], // 16 chars
    ['Bob-1', 'Bob-1'],
    ['Classic', 'Classic'],
    ['Raccoon', 'Raccoon'],
    ['Assassin', 'Assassin'],
    ['Hancock', 'Hancock'],
    ['GoKart', 'GoKart'],
    ['Cocktail', 'Cocktail'],
    ['Acmeol', 'Acmeol'], // reserved only with RESERVED_WORDS set (below)
    ['Modern', 'Modern'],
    // Whole-word matching keeps these legal.
    ['Torpedo', 'Torpedo'],
    ['Therapist', 'Therapist'],
    ['Swanky', 'Swanky'],
    ['Nigeria', 'Nigeria'],
    ['Shiitake', 'Shiitake'],
    ['Retardant', 'Retardant'],
    ['Penistone', 'Penistone'],
    ['Scunthorpe', 'Scunthorpe'],
  ];
  it.each(accepted)('accepts %j', (raw, tag) => {
    const v = validateTag(raw);
    expect(v).toEqual({ ok: true, tag, key: tagKey(tag) });
  });

  const rejected = [
    ['ab', 'tag_length'],
    ['A2345678901234567', 'tag_length'], // 17
    ['   ab   ', 'tag_length'],
    ['a b', 'tag_length'], // key "ab" too short
    ['_-_', 'tag_length'],
    ['héllo', 'tag_chars'],
    ['bad!tag', 'tag_chars'],
    ['<script>', 'tag_chars'],
    ['tab\u0000tag', 'tag_chars'],
    [123, 'tag_type'],
    [null, 'tag_type'],
    ['x'.repeat(100), 'tag_length'],
    // Reserved, as a word, prefix or leet.
    ['admin', 'tag_reserved'],
    ['Admin_1', 'tag_reserved'],
    ['Admin Team', 'tag_reserved'],
    ['AdminTeam', 'tag_reserved'],
    ['4dm1n', 'tag_reserved'],
    ['ADMIN-ISTRATOR', 'tag_reserved'],
    ['Moderator', 'tag_reserved'],
    ['Mod Squad', 'tag_reserved'],
    ['Graveyard', 'tag_reserved'],
    ['Graveyard Shift', 'tag_reserved'],
    ['GraveyardKing', 'tag_reserved'],
    ['null', 'tag_reserved'],
    ['N U L L', 'tag_reserved'],
    ['undefined', 'tag_reserved'],
    // Blocklist, including leet, spacing, stretching and camelCase.
    ['fuck', 'tag_blocked'],
    ['FuCk_you', 'tag_blocked'],
    ['FuckYou', 'tag_blocked'],
    ['xxFUCKxx', 'tag_blocked'],
    ['f u c k', 'tag_blocked'],
    ['fuuuuck', 'tag_blocked'],
    ['sh1t', 'tag_blocked'],
    ['5h1t', 'tag_blocked'],
    ['shiiit', 'tag_blocked'],
    ['sh1t head', 'tag_blocked'],
    ['ShitHead', 'tag_blocked'],
    ['s h i t', 'tag_blocked'],
    ['b1tch', 'tag_blocked'],
    ['n1gg3r', 'tag_blocked'],
    ['N-1-G-G-A', 'tag_blocked'],
    ['f4gg0t', 'tag_blocked'],
    ['p0rn', 'tag_blocked'],
    ['d1ck', 'tag_blocked'],
    ['ass', 'tag_blocked'],
    ['a55', 'tag_blocked'],
    ['dick', 'tag_blocked'],
    ['dick99', 'tag_blocked'],
    ['Big Dicks', 'tag_blocked'],
    ['The Rapist', 'tag_blocked'],
  ];
  it.each(rejected)('rejects %j (%s)', (raw, reason) => {
    expect(validateTag(raw)).toEqual({ ok: false, reason });
  });

  // A deployment's own names, from the Worker vars: whole words like the built-in list (leet, trailing
  // digits, any word of the tag), prefixes only when listed as prefixes.
  const OWN = { RESERVED_WORDS: ' Acme, acmeplus ,', RESERVED_PREFIXES: 'zorg' };
  it.each([
    ['ACME', 'tag_reserved'], ['4cm3', 'tag_reserved'], ['Acme Hunt', 'tag_reserved'], ['Acme_2', 'tag_reserved'],
    ['acmeplus', 'tag_reserved'], ['Zorg', 'tag_reserved'], ['ZorgKing', 'tag_reserved'], ['z0rg99', 'tag_reserved'],
    ['admin', 'tag_reserved'], ['sh1t', 'tag_blocked'],
  ])('with RESERVED_WORDS / RESERVED_PREFIXES rejects %j (%s)', (raw, reason) => {
    expect(validateTag(raw, OWN)).toEqual({ ok: false, reason });
  });
  it.each(['Acmeol', 'acmeplusai', 'acmeplusai-demo', 'Dead Eye', 'Zor'])('with RESERVED_WORDS still accepts %j', (raw) => {
    expect(validateTag(raw, OWN)).toMatchObject({ ok: true });
  });
  it('without the vars those names are free; empty or missing vars change nothing', () => {
    for (const t of ['ACME', 'Acme Hunt', 'acmeplus', 'ZorgKing']) {
      expect(validateTag(t)).toMatchObject({ ok: true });
      expect(validateTag(t, {})).toMatchObject({ ok: true });
      expect(validateTag(t, { RESERVED_WORDS: '', RESERVED_PREFIXES: ' , ' })).toMatchObject({ ok: true });
    }
    expect(reservedFromEnv({ RESERVED_WORDS: ' A ,b,, ', RESERVED_PREFIXES: 'X' })).toEqual({ words: ['a', 'b'], prefixes: ['x'] });
  });

  it('normalises the key so case, separators and look-alikes collide', () => {
    const k = tagKey('Dead Eye');
    expect(tagKey('dead_eye')).toBe(k);
    expect(tagKey('DEAD-EYE')).toBe(k);
    expect(tagKey('d3adey3')).toBe(k);
    expect(lookupKey('  DEAD   eye ')).toBe(k);
    expect(tagKey('B0B')).toBe(tagKey('BOB'));
    expect(tagKey('Ki11er')).toBe(tagKey('Killer'));
    expect(tagKey('KILLER')).toBe(tagKey('kiiler'));
    expect(tagKey('Sn1per5')).toBe(tagKey('snipers'));
    expect(tagKey('Bob1')).not.toBe(tagKey('Bob2'));
    expect(lookupKey('no!')).toBeNull();
  });
});

// ------------------------------------------------------------------ runs

describe('validateRun', () => {
  const base = { round: 5, kills: 70, headshots: 10, points: 5000, timeSec: 200, version: '0.2.0', device: 'desktop' };
  const r = (patch) => ({ ...base, ...patch });
  const RMAX = RUN_LIMITS.roundMax;

  // The server's copy of the round formulas must be the game's (src/game/rounds.js and its tuning).
  it('mirrors the real director: spawn totals, brutes, health, pacing for rounds 1-60', () => {
    for (let n = 1; n <= 60; n++) {
      expect(roundTotal(n), `roundTotal(${n})`).toBe(game.roundTotal(n));
      expect(zombiesThroughRound(n), `zombiesThroughRound(${n})`).toBe(game.zombiesThroughRound(n));
      expect(brutesInRound(n), `brutes(${n})`).toBe(game.rounds.brutes(n));
      expect(Math.round(walkerHealth(n)), `health(${n})`).toBe(game.rounds.health(n));
      expect(bruteScale(n), `bruteScale(${n})`).toBeCloseTo(game.rounds.bruteScale(n), 10);
      expect(spawnInterval(n), `spawnInterval(${n})`).toBeCloseTo(game.rounds.spawnInterval(n), 10);
    }
    expect(roundTotal(0)).toBe(0);
    expect(zombiesThroughRound(0)).toBe(0);
    expect(RUN_LIMITS.lull).toBe(game.rounds.lull);
    expect(RUN_LIMITS.maxAlive).toBe(game.rounds.maxAlive);
  });

  it('mirrors the scoring and type tuning the points ceiling uses', () => {
    const P = tuning.economy.points;
    expect(RUN_LIMITS.pointsPerHit).toBe(P.hit);
    expect(RUN_LIMITS.maxKillBonus).toBe(Math.max(P.kill, P.headshotKill, P.meleeKill));
    expect(RUN_LIMITS.bruteKillBonus).toBe(P.bruteKill);
    expect(RUN_LIMITS.startPoints).toBe(P.start);
    expect(RUN_LIMITS.pointsMultiplier).toBe(tuning.economy.powerups.multiplier);
    expect(RUN_LIMITS.flashoverPoints).toBe(tuning.economy.powerups.flashoverPoints);
    expect(RUN_LIMITS.dropsPerRound).toBe(tuning.economy.powerups.perRound);
    expect(RUN_LIMITS.boardPointsPerRound).toBe(tuning.world.boards.repairCapPerRound);
    const T = tuning.zombies.types;
    expect(RUN_LIMITS.typeHealth).toEqual({ walker: T.walker.health, runner: T.runner.health, armoured: T.armoured.health, bloater: T.bloater.health });
    expect(RUN_LIMITS.armourMin).toBe(Math.min(...Object.values(T.armoured.armour)));
    // the weakest shot: one shotgun pellet at the far end of its falloff
    const W = tuning.weapons.table || tuning.weapons;
    const pelletMins = Object.values(W).filter((d) => d && d.pellets > 1 && d.falloff).map((d) => d.damage * d.falloff[2]);
    expect(pelletMins.length).toBeGreaterThan(0);
    expect(RUN_LIMITS.minHitDamage).toBeLessThanOrEqual(Math.min(...pelletMins));
  });

  it('derives the bounds from the formulas', () => {
    expect(roundTotal(1)).toBe(10);
    expect(roundTotal(5)).toBe(17); // boss round: 60 % of 26, plus one brute
    expect(zombiesThroughRound(5)).toBe(10 + 14 + 18 + 22 + 17);
    expect(maxKills(5)).toBe(81 + RUN_LIMITS.killAllowance);
    expect(minKills(1)).toBe(0);
    expect(minKills(5)).toBe(64 - 4 * RUN_LIMITS.stuckAllowancePerRound);
    expect(walkerHealth(1)).toBe(150);
    expect(walkerHealth(9)).toBe(950);
    expect(walkerHealth(10)).toBeCloseTo(1045);
    expect(minTimeSec(1)).toBe(0);
    // rounds 1-4: (N - 2) spawn intervals each, plus a 10 s lull, with a 10 % margin
    const rounds14 = 8 * 1.9 + 12 * 1.8 + 16 * 1.7 + 20 * 1.6 + 4 * 10;
    expect(minTimeSec(5)).toBe(Math.floor(rounds14 * RUN_LIMITS.timeSlack));
    expect(minTimeSec(RMAX)).toBeLessThanOrEqual(RUN_LIMITS.maxTimeSec);
    expect(minTimeSec(RMAX + 1)).toBeGreaterThan(RUN_LIMITS.maxTimeSec);
    expect(RMAX).toBe(computeRoundMax());
    expect(RMAX).toBeGreaterThan(60);
    expect(RMAX).toBeLessThan(200);
    // armoured zombies (round 7+) make a kill worth far more hits than a walker's
    expect(maxPointsPerKill(7)).toBeGreaterThan(maxPointsPerKill(6) * 3);
  });

  // Plays a run with the real game formulas: every zombie of rounds 1..round-1 killed and `frac`
  // of the last round's, `hitsPer(n, type)` hits a kill, headshot share `hs`, `secPer` s a zombie.
  function playedRun(round, { hitsPer, hs = 0, secPer = 2, frac = 0.5, device = 'desktop' }) {
    let points = 0, kills = 0, headshots = 0, timeSec = 0;
    for (let n = 1; n <= round; n++) {
      const z = n < round ? game.roundTotal(n) : Math.floor(game.roundTotal(n) * frac);
      const brutes = n < round ? game.rounds.brutes(n) : 0;
      const regular = z - brutes;
      const h = Math.round(regular * hs);
      points += regular * hitsPer(n) * 10 + h * 100 + (regular - h) * 60;
      points += brutes * (Math.ceil(game.rounds.bruteHealth(n) / 40) * 10 + 60 + 500);
      points += 200; // boards
      kills += z; headshots += h;
      timeSec += z * secPer + (n < round ? 10 : 0);
    }
    return { round, kills, headshots, points, timeSec: Math.floor(timeSec), version: '0.2.0', device };
  }
  const pistolBody = (n) => Math.ceil(game.rounds.health(n) / 40);
  // a pistol into armour plates and bloaters: the slow way to kill, the most hits a kill
  const pistolWorst = (n) => Math.ceil((game.rounds.health(n) * 2) / (40 * 0.2));
  const headshotsMix = (n) => Math.ceil(game.rounds.health(n) / 120);

  it.each([2, 5, 9, 10, 12, 17, 25, 40, 60])('accepts a realistic pistol-only run to round %i', (round) => {
    const run = playedRun(round, { hitsPer: pistolBody, device: 'phone' });
    if (run.timeSec > RUN_LIMITS.maxTimeSec) return;
    expect(validateRun(run)).toMatchObject({ ok: true });
  });
  it('accepts round 12 pistol-only into armour and bloaters', () => {
    expect(validateRun(playedRun(12, { hitsPer: pistolWorst }))).toMatchObject({ ok: true });
  });
  it('accepts round 25 with 60 % headshots', () => {
    expect(validateRun(playedRun(25, { hitsPer: headshotsMix, hs: 0.6, secPer: 1.2 }))).toMatchObject({ ok: true });
  });
  it('accepts a fast run: every zombie killed as it spawns', () => {
    const run = playedRun(20, { hitsPer: headshotsMix, hs: 0.8, secPer: 0.7, frac: 0 });
    expect(validateRun(run)).toMatchObject({ ok: true });
  });
  it('rejects the absurd versions of those runs', () => {
    const real = playedRun(25, { hitsPer: headshotsMix, hs: 0.6, secPer: 1.2 });
    expect(validateRun({ ...real, kills: 300, headshots: 100 })).toMatchObject({ ok: false, reason: 'kills_too_few' });
    expect(validateRun({ ...real, kills: zombiesThroughRound(25) + 50 })).toMatchObject({ ok: false, reason: 'kills_impossible' });
    expect(validateRun({ ...real, timeSec: 600 })).toMatchObject({ ok: false, reason: 'time_too_fast' });
    expect(validateRun({ ...real, points: 1e9 })).toMatchObject({ ok: false, reason: 'points_impossible' });
    expect(validateRun({ ...real, round: RMAX + 1, timeSec: 86400 })).toMatchObject({ ok: false, reason: 'round_range' });
  });

  const ok = [
    ['base', base],
    ['round min', r({ round: 1, kills: 0, headshots: 0, points: 0, timeSec: 0 })],
    ['round max', r({ round: RMAX, kills: minKills(RMAX), timeSec: RUN_LIMITS.maxTimeSec })],
    ['kills at max', r({ kills: maxKills(5) })],
    ['kills at min', r({ kills: minKills(5), headshots: 0 })],
    ['headshots = kills', r({ headshots: 70 })],
    ['points at max', r({ points: maxPoints(70, 5) })],
    ['time at min', r({ timeSec: minTimeSec(5) })],
    ['time at max', r({ timeSec: 86400 })],
    ['phone', r({ device: 'phone' })],
    ['version max length', r({ version: 'v'.repeat(32) })],
    ['extra fields ignored', r({ cheat: true })],
  ];
  it.each(ok)('accepts %s', (_name, run) => {
    const v = validateRun(run);
    expect(v.ok).toBe(true);
    expect(Object.keys(v.run).sort()).toEqual(['device', 'headshots', 'kills', 'points', 'round', 'timeSec', 'version']);
  });

  const bad = [
    ['round 0', r({ round: 0 }), 'round_range'],
    ['round beyond what fits in 24 h', r({ round: RMAX + 1 }), 'round_range'],
    ['round 999 with no kills', r({ round: 999, kills: 0 }), 'round_range'],
    ['round 1000', r({ round: 1000 }), 'round_range'],
    ['round fractional', r({ round: 5.5 }), 'round_range'],
    ['round string', r({ round: '5' }), 'round_range'],
    ['kills negative', r({ kills: -1 }), 'kills_range'],
    ['kills over max', r({ kills: maxKills(5) + 1 }), 'kills_impossible'],
    ['kills under min', r({ kills: minKills(5) - 1, headshots: 0 }), 'kills_too_few'],
    ['round 60 with no kills', r({ round: 60, kills: 0, headshots: 0, timeSec: 80000 }), 'kills_too_few'],
    ['kills NaN', r({ kills: NaN }), 'kills_range'],
    ['kills unsafe integer', r({ kills: 2 ** 60 }), 'kills_range'],
    ['headshots negative', r({ headshots: -1 }), 'headshots_range'],
    ['headshots > kills', r({ headshots: 71 }), 'headshots_exceed_kills'],
    ['points negative', r({ points: -1 }), 'points_range'],
    ['points over max', r({ points: maxPoints(70, 5) + 1 }), 'points_impossible'],
    ['points float', r({ points: 1.5 }), 'points_range'],
    ['time negative', r({ timeSec: -1 }), 'time_range'],
    ['time over 24h', r({ timeSec: 86401 }), 'time_range'],
    ['time too fast', r({ timeSec: minTimeSec(5) - 1 }), 'time_too_fast'],
    ['version empty', r({ version: '' }), 'version_invalid'],
    ['version too long', r({ version: 'v'.repeat(33) }), 'version_invalid'],
    ['version bad chars', r({ version: '1.0 <b>' }), 'version_invalid'],
    ['device tablet', r({ device: 'tablet' }), 'device_invalid'],
    ['device missing', r({ device: undefined }), 'device_invalid'],
    ['null run', null, 'run_type'],
    ['array run', [], 'run_type'],
    ['Infinity kills', r({ kills: Infinity }), 'kills_range'],
  ];
  it.each(bad)('rejects %s', (_name, run, reason) => {
    expect(validateRun(run)).toEqual({ ok: false, reason });
  });
});

// ------------------------------------------------------------------ crypto

describe('crypto helpers', () => {
  it('sha256Hex matches the standard test vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('generates 32-byte hex secrets that differ', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('hashes secrets deterministically without containing them', async () => {
    const s = generateSecret();
    const h = await hashSecret(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(s);
    expect(await hashSecret(s)).toBe(h);
  });

  it('timingSafeEqual compares correctly', () => {
    expect(timingSafeEqual('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqual('abcd', 'abce')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('a', null)).toBe(false);
  });

  it('recovery codes are 4x4 groups from the unambiguous alphabet', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const c = generateRecovery();
      expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      for (const ch of c.replace(/-/g, '')) expect(RECOVERY_ALPHABET).toContain(ch);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
    expect(RECOVERY_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('normalizeRecovery accepts loose typing and rejects junk', () => {
    expect(normalizeRecovery('abcd efgh-jkmn pqrs')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeRecovery('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeRecovery('ABCD-EFGH-JKMN-PQR')).toBeNull();
    expect(normalizeRecovery('ABCD-EFGH-JKMN-PQRO')).toBeNull(); // O not in alphabet
    expect(normalizeRecovery(42)).toBeNull();
  });

  it('recovery hash is bound to the tag key', async () => {
    const c = 'ABCD-EFGH-JKMN-PQRS';
    expect(await hashRecovery('a', c)).not.toBe(await hashRecovery('b', c));
  });

  it('hashIp is salted and never contains the IP', async () => {
    const a = await hashIp('203.0.113.7', 'salt1');
    expect(a).not.toContain('203.0.113.7');
    expect(a).not.toBe(await hashIp('203.0.113.7', 'salt2'));
    expect(a).toBe(await hashIp('203.0.113.7', 'salt1'));
  });
});

// ------------------------------------------------------------------ IP bucketing

describe('ipBucket', () => {
  it('expands IPv6', () => {
    expect(expandIPv6('2001:db8::1')).toEqual(['2001', '0db8', '0000', '0000', '0000', '0000', '0000', '0001']);
    expect(expandIPv6('::')).toEqual(Array(8).fill('0000'));
    expect(expandIPv6('fe80::1%eth0')).toEqual(['fe80', '0000', '0000', '0000', '0000', '0000', '0000', '0001']);
    expect(expandIPv6('1.2.3.4')).toBeNull();
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(expandIPv6('1:2:3')).toBeNull();
  });

  it('groups IPv6 by /64 and keeps IPv4 whole', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe(ipBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
    expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'));
    expect(ipBucket('203.0.113.7')).toBe('v4|203.0.113.7');
    expect(ipBucket('::ffff:203.0.113.7')).toBe('v4|203.0.113.7');
    expect(ipBucket('203.0.113.7')).not.toBe(ipBucket('203.0.113.8'));
  });
});

// ------------------------------------------------------------------ D1 fake

describe('FakeD1', () => {
  it('enforces UNIQUE on tag_key like D1', async () => {
    const db = new FakeD1();
    const p = { tag: 'Dead Eye', key: 'deadeye', secretHash: 'x', recoveryHash: 'y', now: 1 };
    await store.insertPlayer(db, p);
    let err;
    try { await store.insertPlayer(db, { ...p, tag: 'dead_eye' }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/^D1_ERROR: UNIQUE constraint failed/);
    expect(store.isUniqueViolation(err)).toBe(true);
  });

  it('rolls back a failing batch', async () => {
    const db = new FakeD1();
    await expect(db.batch([
      db.prepare("INSERT INTO rate (bucket, key, window_start, count) VALUES ('a','b',1,1)"),
      db.prepare("INSERT INTO rate (bucket, key, window_start, count) VALUES ('a','b',1,1)"),
    ])).rejects.toThrow(/UNIQUE/);
    expect(db.rows('SELECT * FROM rate')).toEqual([]);
  });

  it('rejects undefined binds like D1', () => {
    const db = new FakeD1();
    expect(() => db.prepare('SELECT ?1').bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });
});

// ------------------------------------------------------------------ handlers end to end

const ORIGIN = 'https://game.example';
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function makeEnv(extra = {}) {
  return {
    DB: new FakeD1(),
    IP_SALT: 'test-salt',
    ALLOWED_ORIGINS: `${ORIGIN},https://other-game.example`,
    ...extra,
  };
}

function req(method, path, { body, headers = {}, ip = '198.51.100.1', origin = ORIGIN, raw } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined || raw !== undefined) h['Content-Type'] ??= 'application/json';
  return new Request(`https://api.example${path}`, {
    method,
    headers: h,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function call(env, method, path, opts = {}, now = T0) {
  const res = await handle(req(method, path, opts), env, { waitUntil() {} }, now);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const count = (env, table) => env.DB.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;

const RUN = { round: 5, kills: 70, headshots: 10, points: 5000, timeSec: 200, version: '0.2.0', device: 'desktop' };

describe('API end to end', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('health', async () => {
    const r = await call(env, 'GET', '/api/health');
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('claim -> score -> leaderboard -> player -> recover rotates the secret', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: '  Dead   Eye ' } });
    expect(c.status).toBe(201);
    expect(c.body.tag).toBe('Dead Eye');
    expect(c.body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(c.body.recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(c.headers.get('Cache-Control')).toBe('no-store');
    expect(c.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(c.headers.get('Access-Control-Allow-Credentials')).toBeNull();

    // Nothing stored in plain text.
    const [row] = env.DB.rows('SELECT * FROM players');
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(c.body.secret);
    expect(stored).not.toContain(c.body.recovery);
    expect(row.tag_key).toBe(tagKey('Dead Eye'));

    const s = await call(env, 'POST', '/api/score', { body: { tag: 'dead_eye', secret: c.body.secret, run: RUN } }, T0 + 1000);
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ ok: true, personalBest: true, rank: 1, games: 1 });

    const worseRun = { ...RUN, round: 3, timeSec: 60, kills: 20, headshots: 2, points: 900 };
    const worse = await call(env, 'POST', '/api/score', { body: { tag: 'Dead Eye', secret: c.body.secret, run: worseRun } }, T0 + 2000);
    expect(worse.body).toEqual({ ok: true, personalBest: false, rank: 1, games: 2 });

    const lb = await call(env, 'GET', '/api/leaderboard');
    expect(lb.status).toBe(200);
    expect(lb.headers.get('Cache-Control')).toBe('public, max-age=15');
    expect(lb.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(lb.body).toEqual({
      board: 'round',
      device: 'all',
      entries: [{
        rank: 1, tag: 'Dead Eye', round: 5, kills: 70, headshots: 10, points: 5000, timeSec: 200,
        device: 'desktop', at: new Date(T0 + 1000).toISOString(),
      }],
    });

    const p = await call(env, 'GET', '/api/player?tag=DEAD-EYE');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ tag: 'Dead Eye', games: 2, rank: 1, best: { round: 5, kills: 70, device: 'desktop' } });

    // Wrong recovery code.
    const wrong = await call(env, 'POST', '/api/recover', { body: { tag: 'Dead Eye', recovery: 'AAAA-AAAA-AAAA-AAAA' } });
    expect(wrong).toMatchObject({ status: 403, body: { error: 'bad_recovery' } });

    // Right code, typed loosely.
    const loose = c.body.recovery.toLowerCase().replace(/-/g, ' ');
    const rec = await call(env, 'POST', '/api/recover', { body: { tag: 'deadeye', recovery: loose } });
    expect(rec.status).toBe(200);
    expect(rec.body.tag).toBe('Dead Eye');
    expect(rec.body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.body.secret).not.toBe(c.body.secret);

    const old = await call(env, 'POST', '/api/score', { body: { tag: 'Dead Eye', secret: c.body.secret, run: RUN } });
    expect(old).toMatchObject({ status: 403, body: { error: 'bad_secret' } });
    const fresh = await call(env, 'POST', '/api/score', { body: { tag: 'Dead Eye', secret: rec.body.secret, run: RUN } });
    expect(fresh.status).toBe(200);
    expect(fresh.body.games).toBe(3);
  });

  it('duplicate tags are 409 regardless of case, separators and look-alikes', async () => {
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Dead Eye' } })).status).toBe(201);
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'BOB' } })).status).toBe(201);
    for (const t of ['dead eye', 'DEAD_EYE', 'dead-eye', 'deadeye', 'D3AD EYE', 'B0B', 'bob']) {
      const r = await call(env, 'POST', '/api/claim', { body: { tag: t } });
      expect(r, t).toMatchObject({ status: 409, body: { error: 'taken' } });
    }
    expect(count(env, 'players')).toBe(2);
  });

  it('claim rejects invalid, blocked and reserved tags with a reason', async () => {
    expect(await call(env, 'POST', '/api/claim', { body: { tag: 'ad' } })).toMatchObject({ status: 400, body: { error: 'invalid_tag', reason: 'tag_length' } });
    expect(await call(env, 'POST', '/api/claim', { body: { tag: 'Adm1n Team' } })).toMatchObject({ status: 400, body: { reason: 'tag_reserved' } });
    expect(await call(env, 'POST', '/api/claim', { body: { tag: 'sh1t' } })).toMatchObject({ status: 400, body: { reason: 'tag_blocked' } });
  });

  it('claim applies the deployment\'s RESERVED_WORDS', async () => {
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Acme Hunt' } })).status).toBe(201);
    const own = makeEnv({ RESERVED_WORDS: 'acme' });
    expect(await call(own, 'POST', '/api/claim', { body: { tag: 'Acme Hunter' } })).toMatchObject({ status: 400, body: { reason: 'tag_reserved' } });
  });

  it('wrong secret, unknown tag and malformed secret are 403', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Ghoul' } });
    const wrong = 'f'.repeat(64);
    expect(await call(env, 'POST', '/api/score', { body: { tag: 'Ghoul', secret: wrong, run: RUN } })).toMatchObject({ status: 403, body: { error: 'bad_secret' } });
    expect(await call(env, 'POST', '/api/score', { body: { tag: 'Nobody', secret: c.body.secret, run: RUN } })).toMatchObject({ status: 403 });
    expect(await call(env, 'POST', '/api/score', { body: { tag: 'Ghoul', secret: 'short', run: RUN } })).toMatchObject({ status: 403 });
    expect(count(env, 'runs')).toBe(0);
  });

  it('implausible runs are 422 with a reason and are not stored', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Ghoul' } });
    const r = await call(env, 'POST', '/api/score', { body: { tag: 'Ghoul', secret: c.body.secret, run: { ...RUN, kills: 9999 } } });
    expect(r).toMatchObject({ status: 422, body: { error: 'implausible_run', reason: 'kills_impossible' } });
    const absurd = await call(env, 'POST', '/api/score', { body: { tag: 'Ghoul', secret: c.body.secret, run: { ...RUN, round: 999, kills: 0, headshots: 0 } } });
    expect(absurd).toMatchObject({ status: 422, body: { reason: 'round_range' } });
    expect(count(env, 'runs')).toBe(0);
    expect(count(env, 'bests')).toBe(0);
  });

  it('errors never echo the secret', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Ghoul' } });
    const r = await call(env, 'POST', '/api/score', { body: { tag: 'Ghoul', secret: c.body.secret, run: { ...RUN, round: 0 } } });
    expect(JSON.stringify(r.body)).not.toContain(c.body.secret);
  });

  it('leaderboards: order, tie-breaks, devices and boards, all from the bests table', async () => {
    const players = {};
    for (const [i, t] of ['Alpha', 'Bravo', 'Charlie', 'Delta'].entries()) {
      players[t] = (await call(env, 'POST', '/api/claim', { body: { tag: t }, ip: `10.0.1.${i}` })).body.secret;
    }
    const sub = async (tag, run, at) => {
      const r = await call(env, 'POST', '/api/score', { body: { tag, secret: players[tag], run: { ...RUN, ...run } }, ip: `10.0.2.${tag.length}` }, at);
      expect(r.status, `${tag} ${JSON.stringify(r.body)}`).toBe(200);
    };
    await sub('Alpha', { round: 5, kills: 70 }, T0 + 1);
    await sub('Bravo', { round: 5, kills: 80, headshots: 10, points: 100 }, T0 + 2);
    await sub('Charlie', { round: 5, kills: 70 }, T0 + 3); // ties Alpha, later
    await sub('Delta', { round: 4, kills: 74, timeSec: 100, points: maxPoints(74, 4), device: 'phone' }, T0 + 4);
    await sub('Alpha', { round: 2, kills: 20, timeSec: 30, points: maxPoints(20, 2), device: 'phone' }, T0 + 5);

    const later = T0 + 60_000; // past the 15 s memo
    const get = (q) => call(env, 'GET', `/api/leaderboard${q}`, {}, later);
    const tags = (r) => r.body.entries.map((e) => e.tag);
    expect(tags(await get('?board=round&device=all'))).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
    expect((await get('')).body.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(tags(await get('?board=kills'))).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
    const points = await get('?board=points');
    expect(tags(points)).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);
    // Each entry is one coherent run: Alpha's points entry is the phone run.
    expect(points.body.entries[1]).toMatchObject({ round: 2, kills: 20, device: 'phone' });

    const phone = await get('?device=phone');
    expect(tags(phone)).toEqual(['Delta', 'Alpha']);
    expect(phone.body.entries[1]).toMatchObject({ round: 2, device: 'phone' });
    expect(tags(await get('?device=desktop'))).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(tags(await get('?device=desktop&board=kills'))).toEqual(['Bravo', 'Alpha', 'Charlie']);

    expect(tags(await get('?limit=2'))).toEqual(['Bravo', 'Alpha']);
    expect((await get('?limit=5000')).status).toBe(200);
    expect(await get('?board=deaths')).toMatchObject({ status: 400, body: { error: 'bad_board' } });
    expect(await get('?device=tablet')).toMatchObject({ status: 400 });
    expect(await get('?limit=0')).toMatchObject({ status: 400 });
    expect(await get('?limit=abc')).toMatchObject({ status: 400 });

    // Leaderboard SQL never touches the runs table.
    env.DB.queries.length = 0;
    await call(env, 'GET', '/api/leaderboard?board=points&device=phone', {}, later + 60_000);
    expect(env.DB.queries.some((q) => /\bruns\b/.test(q))).toBe(false);
    expect(env.DB.queries.some((q) => /\bbests\b/.test(q))).toBe(true);

    const charlie = await call(env, 'GET', '/api/player?tag=charlie');
    expect(charlie.body).toMatchObject({ tag: 'Charlie', rank: 3, games: 1 });
  });

  it('leaderboard queries use the bests indexes', () => {
    for (const [board, idx] of [['round', 'bests_round'], ['kills', 'bests_kills'], ['points', 'bests_points']]) {
      const order = store.BOARDS[board].replace(/(\w+) /g, 'b.$1 ');
      const plan = env.DB.rows(`EXPLAIN QUERY PLAN SELECT p.tag FROM bests b JOIN players p ON p.id = b.player_id
        WHERE b.board = ?1 AND b.device = ?2 ORDER BY ${order} LIMIT 100`, board, 'all');
      const text = plan.map((r) => r.detail).join(' | ');
      expect(text, board).toContain(idx);
      expect(text, board).not.toMatch(/TEMP B-TREE/);
    }
  });

  it('memoises leaderboard responses per isolate for 15 s', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Memo' } });
    expect((await call(env, 'GET', '/api/leaderboard', {}, T0)).body.entries).toEqual([]);
    await call(env, 'POST', '/api/score', { body: { tag: 'Memo', secret: c.body.secret, run: RUN } }, T0 + 1000);
    env.DB.queries.length = 0;
    expect((await call(env, 'GET', '/api/leaderboard', {}, T0 + 14_000)).body.entries).toEqual([]);
    expect(env.DB.queries).toEqual([]);
    expect((await call(env, 'GET', '/api/leaderboard?limit=5', {}, T0 + 14_000)).body.entries).toHaveLength(1);
    expect((await call(env, 'GET', '/api/leaderboard', {}, T0 + 15_000)).body.entries).toHaveLength(1);
  });

  it('player endpoint: 404 for unknown, null best before any game', async () => {
    expect(await call(env, 'GET', '/api/player?tag=Nobody')).toMatchObject({ status: 404 });
    expect(await call(env, 'GET', '/api/player?tag=!')).toMatchObject({ status: 400 });
    await call(env, 'POST', '/api/claim', { body: { tag: 'Fresh' } });
    expect((await call(env, 'GET', '/api/player?tag=Fresh')).body).toMatchObject({ tag: 'Fresh', games: 0, rank: null, best: null });
    expect((await call(env, 'GET', '/api/leaderboard')).body.entries).toEqual([]);
  });

  it('claim: 5 successful per IP per hour with Retry-After, resets next hour', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: `Tag ${i}x` } })).status).toBe(201);
    }
    const r = await call(env, 'POST', '/api/claim', { body: { tag: 'Tag 9x' } });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Tag 9x' }, ip: '198.51.100.2' })).status).toBe(201);
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Tag 8x' } }, T0 + HOUR)).status).toBe(201);
  });

  it('claim: "taken" and malformed attempts do not use up successful claims; well-formed attempts cap at 30', async () => {
    await call(env, 'POST', '/api/claim', { body: { tag: 'Popular' }, ip: '10.1.1.1' });
    for (let i = 0; i < 20; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: 'ad' } })).status).toBe(400); // not counted
    }
    for (let i = 0; i < 25; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: 'popular' } })).status).toBe(409);
    }
    for (let i = 0; i < 5; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: `Fine ${i}x` } })).status).toBe(201);
    }
    // 30 well-formed attempts used: the next one is refused even though it is free.
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Popular' } })).status).toBe(429);
  });

  it('claim: global cap of claims per hour', async () => {
    const start = windowStart(T0, HOUR);
    env.DB.sqlite.prepare("INSERT INTO rate (bucket, key, window_start, count) VALUES ('claim:all', 'all', ?, 300)").run(start);
    const r = await call(env, 'POST', '/api/claim', { body: { tag: 'Latecomer' }, ip: '10.3.3.3' });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited', scope: 'global' } });
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Latecomer' }, ip: '10.3.3.3' }, T0 + HOUR)).status).toBe(201);
  });

  it('claim: IPv6 addresses in one /64 share a limit', async () => {
    for (let i = 1; i <= 5; i++) {
      expect((await call(env, 'POST', '/api/claim', { body: { tag: `Six ${i}x` }, ip: `2001:db8:aa:bb::${i}` })).status).toBe(201);
    }
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Six 9x' }, ip: '2001:db8:aa:bb:1234:5678:9abc:def0' })).status).toBe(429);
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Six 9x' }, ip: '2001:db8:aa:bc::1' })).status).toBe(201);
  });

  it('rate limits recover per tag (5/hour) across IPs and per IP (10/hour)', async () => {
    await call(env, 'POST', '/api/claim', { body: { tag: 'Target' } });
    const bad = { tag: 'Target', recovery: 'AAAA-AAAA-AAAA-AAAA' };
    for (let i = 0; i < 5; i++) {
      expect((await call(env, 'POST', '/api/recover', { body: bad, ip: `10.9.0.${i}` })).status).toBe(403);
    }
    expect((await call(env, 'POST', '/api/recover', { body: bad, ip: '10.9.0.99' })).status).toBe(429);

    for (let i = 0; i < 10; i++) {
      expect((await call(env, 'POST', '/api/recover', { body: { tag: `Other ${i}x`, recovery: 'x' }, ip: '10.8.0.1' })).status).toBe(403);
    }
    expect((await call(env, 'POST', '/api/recover', { body: { tag: 'Other Zx', recovery: 'x' }, ip: '10.8.0.1' })).status).toBe(429);
  });

  it('rate limits score per tag (30/hour) only after the secret checks out', async () => {
    const c = await call(env, 'POST', '/api/claim', { body: { tag: 'Grinder' } });
    // Wrong-secret spam from many IPs does not use up the player's quota.
    for (let i = 0; i < 40; i++) {
      await call(env, 'POST', '/api/score', { body: { tag: 'Grinder', secret: 'e'.repeat(64), run: RUN }, ip: `10.7.${i}.1` });
    }
    for (let i = 0; i < 30; i++) {
      const r = await call(env, 'POST', '/api/score', { body: { tag: 'Grinder', secret: c.body.secret, run: RUN }, ip: `10.6.${i}.1` });
      expect(r.status).toBe(200);
    }
    const over = await call(env, 'POST', '/api/score', { body: { tag: 'Grinder', secret: c.body.secret, run: RUN }, ip: '10.6.200.1' });
    expect(over).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('rate limits score per IP (60/hour)', async () => {
    for (let i = 0; i < 60; i++) {
      await call(env, 'POST', '/api/score', { body: { tag: 'Nobody', secret: 'e'.repeat(64), run: RUN }, ip: '10.5.0.1' });
    }
    expect((await call(env, 'POST', '/api/score', { body: { tag: 'Nobody', secret: 'e'.repeat(64), run: RUN }, ip: '10.5.0.1' })).status).toBe(429);
  });

  it('read limiter binding limits GETs by salted IP hash, and is optional', async () => {
    const keys = [];
    let n = 0;
    env.READ_LIMITER = { async limit({ key }) { keys.push(key); return { success: ++n <= 2 }; } };
    expect((await call(env, 'GET', '/api/leaderboard', { ip: '203.0.113.9' })).status).toBe(200);
    expect((await call(env, 'GET', '/api/player?tag=Nobody', { ip: '203.0.113.9' })).status).toBe(404);
    const r = await call(env, 'GET', '/api/leaderboard', { ip: '203.0.113.9' });
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(r.headers.get('Retry-After')).toBe('60');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await call(env, 'GET', '/api/health', { ip: '203.0.113.9' })).status).toBe(200); // not limited
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(`read:${await hashIp('v4|203.0.113.9', 'test-salt')}`);
    expect(keys.join()).not.toContain('203.0.113.9');
  });

  it('stores only salted IP hashes in the rate table', async () => {
    await call(env, 'POST', '/api/claim', { body: { tag: 'Privacy' }, ip: '203.0.113.77' });
    const dump = JSON.stringify(env.DB.rows('SELECT * FROM rate')) + JSON.stringify(env.DB.rows('SELECT * FROM players'));
    expect(dump).not.toContain('203.0.113.77');
    const ipHash = await hashIp('v4|203.0.113.77', 'test-salt');
    expect(env.DB.rows("SELECT key FROM rate WHERE bucket = 'claim:ip'")[0].key).toBe(ipHash);
  });

  it('ignores forwarded-IP headers', async () => {
    for (let i = 0; i < 5; i++) {
      await call(env, 'POST', '/api/claim', { body: { tag: `Fwd ${i}x` }, headers: { 'x-real-ip': `192.0.2.${i}`, 'x-forwarded-for': `192.0.2.${i}` } });
    }
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'Fwd 9x' }, headers: { 'x-real-ip': '192.0.2.99' } })).status).toBe(429);
  });

  it('oversized body is 413', async () => {
    const r = await call(env, 'POST', '/api/claim', { raw: JSON.stringify({ tag: 'Big', pad: 'x'.repeat(MAX_BODY_BYTES) }) });
    expect(r).toMatchObject({ status: 413, body: { error: 'too_large' } });
    const declared = await handle(new Request('https://api.example.test/api/claim', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '99999', 'CF-Connecting-IP': '1.1.1.1' },
    }), env, {}, T0);
    expect(declared.status).toBe(413); // refused on the declared length before reading
    expect(count(env, 'players')).toBe(0);
  });

  it('wrong method is 405 with Allow; unknown path 404', async () => {
    const r = await call(env, 'GET', '/api/claim');
    expect(r).toMatchObject({ status: 405, body: { error: 'method_not_allowed' } });
    expect(r.headers.get('Allow')).toBe('POST, OPTIONS');
    expect((await call(env, 'POST', '/api/leaderboard', { body: {} })).status).toBe(405);
    expect((await call(env, 'DELETE', '/api/player')).status).toBe(405);
    expect((await call(env, 'GET', '/api/nope')).status).toBe(404);
    expect((await call(env, 'GET', '/')).status).toBe(404);
  });

  it('content type must be exactly application/json (optional utf-8 charset)', async () => {
    const ct = (type, tag) => call(env, 'POST', '/api/claim', { raw: JSON.stringify({ tag }), headers: { 'Content-Type': type } });
    expect((await ct('text/plain', 'Ctype A')).status).toBe(415);
    expect((await ct('application/jsonx', 'Ctype B')).status).toBe(415);
    expect((await ct('application/json-patch+json', 'Ctype C')).status).toBe(415);
    expect((await ct('application/json; charset=latin1', 'Ctype D')).status).toBe(415);
    expect((await ct('application/json', 'Ctype E')).status).toBe(201);
    expect((await ct('application/json; charset=UTF-8', 'Ctype F')).status).toBe(201);
    expect((await ct('Application/JSON;charset=utf-8', 'Ctype G')).status).toBe(201);
  });

  it('bad JSON and non-object bodies are rejected', async () => {
    expect(await call(env, 'POST', '/api/claim', { raw: '{not json' })).toMatchObject({ status: 400, body: { error: 'bad_json' } });
    expect(await call(env, 'POST', '/api/claim', { raw: '[1,2]' })).toMatchObject({ status: 400, body: { error: 'bad_json' } });
    expect(await call(env, 'POST', '/api/claim', { raw: 'null' })).toMatchObject({ status: 400 });
  });

  it('CORS: allowed origins get headers on OPTIONS and responses; others do not and cannot POST', async () => {
    const pre = await handle(req('OPTIONS', '/api/score', { origin: 'https://other-game.example' }), env, {}, T0);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('https://other-game.example');
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull();

    const evilPre = await handle(req('OPTIONS', '/api/score', { origin: 'https://evil.example' }), env, {}, T0);
    expect(evilPre.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const evilGet = await call(env, 'GET', '/api/leaderboard', { origin: 'https://evil.example' });
    expect(evilGet.status).toBe(200);
    expect(evilGet.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(evilGet.headers.get('Vary')).toContain('Origin');

    expect(await call(env, 'POST', '/api/claim', { body: { tag: 'Evil' }, origin: 'https://evil.example' })).toMatchObject({ status: 403, body: { error: 'origin' } });
    expect((await call(env, 'POST', '/api/claim', { body: { tag: 'NoOrigin' }, origin: null })).status).toBe(201);
  });

  it('missing IP_SALT fails closed for POSTs', async () => {
    env = makeEnv({ IP_SALT: undefined });
    expect(await call(env, 'POST', '/api/claim', { body: { tag: 'Salty' } })).toMatchObject({ status: 500, body: { error: 'server_misconfigured' } });
    expect((await call(env, 'GET', '/api/leaderboard')).status).toBe(200);
  });

  it('unexpected errors are a bare 500', async () => {
    const broken = makeEnv({ DB: { prepare() { throw new Error('boom'); } } });
    const orig = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(' '));
    try {
      const r = await call(broken, 'GET', '/api/leaderboard?board=kills');
      expect(r).toMatchObject({ status: 500, body: { error: 'internal' } });
    } finally {
      console.error = orig;
    }
    expect(logged.length).toBe(1);
  });
});

// ------------------------------------------------------------------ pruning

describe('pruning', () => {
  it('keeps each player\'s best 20 runs without touching their leaderboard entries', async () => {
    const db = new FakeD1();
    await store.insertPlayer(db, { tag: 'Grind', key: 'grind', secretHash: 'a', recoveryHash: 'b', now: 0 });
    const [{ id }] = db.rows('SELECT id FROM players');
    for (let i = 1; i <= 40; i++) {
      await store.recordRun(db, id, { round: i, kills: i, headshots: 0, points: i, timeSec: i * 20, version: '1', device: 'desktop' }, i);
    }
    await store.recordRun(db, id, { round: 2, kills: 99, headshots: 0, points: 50000, timeSec: 20, version: '1', device: 'phone' }, 100);
    const before = await store.leaderboard(db, { board: 'kills', device: 'phone', limit: 10 });
    expect(await store.pruneRuns(db, id)).toBe(21);
    const runs = db.rows('SELECT round FROM runs ORDER BY round DESC');
    expect(runs).toHaveLength(20);
    expect(runs[0].round).toBe(40);
    expect(await store.leaderboard(db, { board: 'kills', device: 'phone', limit: 10 })).toEqual(before);
    expect(db.rows('SELECT games, best_round FROM players')[0]).toEqual({ games: 41, best_round: 40 });
    expect(db.rows('SELECT COUNT(*) AS n FROM bests')[0].n).toBe(9);
  });

  it('pruneRate drops windows older than the retention period', async () => {
    const db = new FakeD1();
    await hit(db, 'claim:ip', 'k', T0 - RATE_RETENTION_MS - HOUR);
    await hit(db, 'claim:ip', 'k', T0);
    expect(await pruneRate(db, T0)).toBe(1);
    expect(db.rows('SELECT COUNT(*) AS n FROM rate')[0].n).toBe(1);
    expect((await peek(db, 'claim:ip', 'k', T0)).count).toBe(1);
  });

  it('housekeeping frees never-scored tags after 30 days and keeps the rest', async () => {
    const db = new FakeD1();
    await store.insertPlayer(db, { tag: 'Old Idle', key: 'oldidle', secretHash: 'a', recoveryHash: 'b', now: T0 - 31 * DAY });
    await store.insertPlayer(db, { tag: 'New Idle', key: 'newidle', secretHash: 'a', recoveryHash: 'b', now: T0 - 29 * DAY });
    await store.insertPlayer(db, { tag: 'Old Player', key: 'oldplayer', secretHash: 'a', recoveryHash: 'b', now: T0 - 90 * DAY });
    const [{ id }] = db.rows("SELECT id FROM players WHERE tag_key = 'oldplayer'");
    await store.recordRun(db, id, RUN, T0 - 80 * DAY);
    await hit(db, 'claim:ip', 'k', T0 - 3 * DAY);
    expect(await housekeeping(db, T0)).toEqual({ rate: 1, players: 1 });
    expect(db.rows('SELECT tag FROM players ORDER BY tag').map((r) => r.tag)).toEqual(['New Idle', 'Old Player']);
  });

  it('the scheduled handler runs housekeeping', async () => {
    const env = makeEnv();
    await store.insertPlayer(env.DB, { tag: 'Ghost', key: 'ghost', secretHash: 'a', recoveryHash: 'b', now: T0 - 40 * DAY });
    const pending = [];
    await worker.scheduled({ scheduledTime: T0, cron: '17 4 * * *' }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    expect(count(env, 'players')).toBe(0);
  });
});
