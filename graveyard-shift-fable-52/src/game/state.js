// Game state machine: title -> playing <-> paused -> dead -> (restart) playing.
// Wires the round director, the economy (purchases, box, bench, machines, power-ups, searching) and
// the score to G. No DOM, no three.js.
// Other modules read G.game.state to freeze themselves while paused; this module freezes rounds,
// the box, the power-ups and the searches (they run only while playing, on sim time).
import { store } from '../core/store.js';
import { createRoundDirector, rounds } from './rounds.js';
import { createEconomy, pointsForHit } from './economy.js';
import { createInteract } from './interact.js';
import { createPurchases, wallWeaponOf, ammoCost } from './purchases.js';
import { createBox } from './box.js';
import { createBench } from './bench.js';
import { createMachines } from './machines.js';
import { createPowerups } from './powerups.js';
import { createLoot } from './loot.js';
import { createScore } from './score.js';
import { tuning } from './tuning.js';
import { WEAPONS } from '../weapon/defs.js';

const BEST_KEY = 'graveyard-shift.bestRound';
const TE = tuning.economy;

export function createGame(G) {
  const emit = (name, payload) => G.events.emit(name, payload);
  const startPoints = Number.isFinite(G.params.points) && G.params.points >= 0 ? G.params.points : undefined;
  const economy = createEconomy({ emit, ...(startPoints !== undefined ? { start: startPoints } : {}) });
  const lv = () => (G.level && !G.level.stub ? G.level : null);
  const weapon = () => G.weapon;
  const player = () => (G.player && !G.player.stub ? G.player : null);
  const zombies = () => G.zombies;
  let runIndex = 0;

  const liveIds = new Set(); // ids of the zombies present this frame (reused)
  const director = createRoundDirector({
    rng: G.rng.fork('rounds'),
    // The AI may narrow this to the reachable zones (G.level.activeSpawnPoints)
    spawnPoints: () => (G.level && (typeof G.level.activeSpawnPoints === 'function' ? G.level.activeSpawnPoints() : G.level.spawnPoints)) || [],
    spawn: (point, n, type) => {
      const z = G.zombies;
      if (!z || typeof z.spawn !== 'function') return null; // stub zombies: the round waits
      const e = director.ease, minDist = e && e.minDist, slow = !!(e && e.slowWalkers);
      const o = { round: n, health: rounds.health(n) };
      if (type) o.type = type;
      if (minDist) o.minDist = minDist; // the manager keeps to it when it swaps a point in view
      if (slow) o.slow = true;          // round 1: walkers at the low end of their speed
      return z.spawn(point, o);
    },
    // the early rounds spawn only far from the player (tuning.round.ease)
    playerPos: () => (G.player && !G.player.stub ? G.player.pos : null),
    emit,
  });

  const L0 = lv();
  const box = createBox({ spots: (L0 && L0.boxSpots) || [], economy, weapon, emit });
  const bench = createBench({ economy, weapon, level: lv, emit, spot: L0 && L0.benchSpot });
  const machines = createMachines({ economy, emit, level: lv, player, weapon, zombies });
  const powerups = createPowerups({ emit, economy, weapon, player, zombies });
  const score = createScore();
  const interactables = () => (G.level && G.level.interactables) || [];
  let game; // (the loot's focus reads it)
  const loot = createLoot({
    searchables: (L0 && L0.searchables) || [], emit, economy, powerups,
    input: () => G.input, player, weapon, level: lv, focus: () => game.focus, interactables,
    round: () => Math.max(1, director.n),
  });
  const purchases = createPurchases({ economy, weapon, emit, level: lv, box, bench, machines, loot });
  const interact = createInteract({ interactables, purchases });

  // Interactables for the spots worldLayout placed (wall buys, the box, the bench, the machines) and one
  // per searchable. Labels and prices are live: the HUD prompt reads `label` and `cost` each frame.
  let boxZoneFor = null, boxZone = null;
  if (L0 && Array.isArray(L0.interactables)) {
    const list = L0.interactables;
    const has = (id) => list.some((i) => i.id === id);
    for (const wb of L0.wallBuys || []) {
      const id = wallWeaponOf(wb);
      if (!id || has(wb.id)) continue;
      const owned = () => !!(G.weapon && typeof G.weapon.has === 'function' && G.weapon.has(id));
      const name = WEAPONS[id].name, ammoName = `${name} ammo`; // (read every frame: no new strings)
      list.push({
        id: wb.id, kind: 'wallWeapon', weapon: id, pos: wb.pos, radius: 1.6, zone: wb.zone,
        get label() { return owned() ? ammoName : name; },
        get cost() { return owned() ? ammoCost(G.weapon, id) : WEAPONS[id].wall.cost; },
      });
    }
    if (L0.boxSpots && L0.boxSpots.length && !has('box')) {
      list.push({
        id: 'box', kind: 'box', radius: 1.8,
        get pos() { return box.pos || L0.boxSpots[0].pos; },
        get zone() { // cached per spot: read every frame
          if (boxZoneFor !== box.spot) { boxZoneFor = box.spot; const s = L0.boxSpots.find((q) => q.id === box.spot); boxZone = s ? s.zone : null; }
          return boxZone;
        },
        get label() { return box.state === 'offering' && box.offer ? WEAPONS[box.offer].name : 'Weapon box'; },
        get cost() { return box.state === 'idle' ? TE.box.cost : 0; },
        enabled: () => box.state === 'idle' || box.state === 'offering',
      });
    }
    if (L0.benchSpot && !has('bench')) {
      list.push({
        id: 'bench', kind: 'bench', pos: L0.benchSpot.pos, radius: 1.6, zone: L0.benchSpot.zone, cost: TE.bench.cost,
        label: 'Upgrade', needsPower: true,
      });
    }
    for (const m of L0.machineSpots || []) {
      if (!TE.machines[m.id] || has(`machine-${m.id}`)) continue;
      list.push({
        id: `machine-${m.id}`, kind: 'machine', machine: m.id, pos: m.pos, radius: 1.6, zone: m.zone,
        label: TE.machines[m.id].name, needsPower: true,
        get cost() { return machines.price(m.id); },
        enabled: () => !machines.has(m.id),
      });
    }
    for (const it of loot.interactables) if (!has(it.id)) list.push(it);
  }

  const firstRound = Math.max(1, Math.floor(G.params.round ?? 1));
  let pendingAutostart = !!(G.params.autostart || G.params.shot);

  const setState = (s) => {
    if (game.state === s) return;
    game.state = s;
    emit('game:state', { state: s });
  };

  const holdT = { boards: 0 }; // seconds held at a window toward the next board
  const boardsEvery = (tuning.world.boards && tuning.world.boards.repairEvery) || 0.6;

  // the hold under way, for the HUD's ring: a search (loot.js) or a board repair
  const hold = { active: false, progress: 0, kind: null };

  game = {
    hold,
    state: 'title',
    kills: 0,
    best: Number(store.get(BEST_KEY, 0)) || 0,
    newBest: false, // the run that just ended beat the stored best round
    focus: null, // interactable the player is standing at (for the HUD prompt)
    lastUse: null, // {id, ok, reason, t} of the last interact attempt (for the HUD)
    economy,
    interact,
    purchases,
    box,
    bench,
    machines,
    powerups,
    loot,
    score,
    director,
    rounds,
    get round() { return director.n; },
    get points() { return economy.points; },
    get power() { const L = lv(); return (L && L.power) || { on: false }; },
    get runIndex() { return runIndex; },

    start(opts = {}) {
      pendingAutostart = false;
      runIndex++;
      economy.reset();
      game.kills = 0;
      game.focus = null;
      game.lastUse = null;
      game.newBest = false;
      holdT.boards = 0;
      hold.active = false; hold.progress = 0; hold.kind = null;
      score.reset();
      purchases.reset();
      machines.reset();
      box.reset(G.rng.fork('box').fork(runIndex));
      powerups.reset(G.rng.fork('powerups').fork(runIndex));
      loot.reset(G.rng.fork('search').fork(runIndex), { all: G.params.searched === 'all' });
      setState('playing');
      director.start(Math.max(1, Math.floor(opts.round ?? firstRound)));
    },
    pause() { if (game.state === 'playing') setState('paused'); },
    resume() { if (game.state === 'paused') setState('playing'); },
    restart() {
      director.stop();
      G.zombies?.clear?.();
      G.fx?.clear?.();
      G.level?.reset?.(); // doors shut, power off, boards back, every searched prop shut
      G.player?.reset?.();
      G.weapon?.reset?.(); // full pistol again, whatever state the old game left it in
      game.start({ round: 1 }); // round=<n> only sets the first start
    },

    // The end screen's numbers (and its rows).
    summary() {
      return score.summary({ round: director.n, earned: economy.earned, spent: economy.spent, best: game.best, newBest: game.newBest });
    },
    // The leaderboard's run: {round, kills, headshots, points, timeSec, version, device}.
    runSummary() {
      const d = G.device || {};
      return score.run({ round: director.n, earned: economy.earned, device: d.phone || (d.touch && d.coarse) ? 'phone' : 'desktop' });
    },

    update(dt) {
      if (pendingAutostart) game.start();
      if (game.state !== 'playing') return;
      score.add(dt);
      const zl = G.zombies && G.zombies.list;
      if (Array.isArray(zl)) {
        liveIds.clear(); // one set, refilled: this runs every playing frame
        for (let i = 0; i < zl.length; i++) { const z = zl[i]; liveIds.add(z && typeof z === 'object' ? z.id : z); }
        director.reconcile(liveIds);
      }
      director.update(dt);
      box.update(dt);
      powerups.update(dt);
      game.focus = G.player && G.player.pos ? interact.nearest(G.player.pos) : null;
      const input = G.input;
      const f = game.focus;
      if (f && input && typeof input.pressed === 'function' && input.pressed('interact') && !(f.hold > 0)) {
        const r = interact.use(f);
        game.lastUse = { id: f.id, ...r, t: G.time ? G.time.t : 0 };
      }
      // holds: a search (loot.js) and putting boards back at a window
      loot.update(dt);
      const held = input && typeof input.held === 'function' ? input.held('interact') : 0;
      if (f && f.kind === 'boards' && held > 0 && !loot.active) {
        holdT.boards += dt;
        if (holdT.boards >= boardsEvery) { holdT.boards -= boardsEvery; purchases.repairBoard(f); }
        hold.active = true; hold.kind = 'repair'; hold.progress = Math.min(1, holdT.boards / boardsEvery);
      } else {
        holdT.boards = 0;
        hold.active = !!loot.active; hold.kind = loot.active ? 'search' : null; hold.progress = loot.progress;
      }
    },
  };

  G.events.on('hit:zombie', (h) => {
    if (game.state !== 'playing' || !h) return;
    score.onHit(h);
    const reason = !h.killed ? 'hit' : h.source === 'melee' ? 'melee' : h.part === 'head' || h.headshot ? 'headshot' : 'kill';
    economy.add(pointsForHit(h, powerups) * powerups.multiplier, reason);
  });
  G.events.on('weapon:fire', (e) => {
    if (game.state !== 'playing') return;
    score.onFire(e);
    if (!(e && e.dry)) loot.cancel('fired');
  });
  // a throw or a swing breaks a search like a shot does
  G.events.on('throw', () => { if (game.state === 'playing') loot.cancel('fired'); });
  G.events.on('weapon:melee', () => { if (game.state === 'playing') loot.cancel('fired'); });
  G.events.on('player:damage', () => { if (game.state === 'playing') loot.cancel('damage'); });
  G.events.on('door:open', () => { if (game.state === 'playing') score.onDoor(); });
  G.events.on('round:start', () => { purchases.onRound(); powerups.onRound(); });
  G.events.on('zombie:die', (z) => {
    if (z) director.onDeath(z.id);
    if (game.state !== 'playing') return;
    game.kills++;
    score.onKill(z);
    if (z && z.cause === 'burst') return; // a bloater that burst by itself: no points, no power-up (still a death for the round and the tally)
    // The zombie manager adds `type` to the payload; until then it is read from the list (the zombie is still in it)
    let type = z && z.type;
    const list = G.zombies && G.zombies.list;
    if (!type && z && Array.isArray(list)) { const r = list.find((q) => q && q.id === z.id); type = r && r.type; }
    if (type === 'brute') economy.add(TE.points.bruteKill * powerups.multiplier, 'brute');
    powerups.onKill(z ? { id: z.id, pos: z.pos, type } : null);
  });
  G.events.on('zombie:remove', (z) => { if (z) director.onRemove(z.id); });
  G.events.on('player:dead', () => {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    loot.cancel('damage');
    // beaten, not equalled: read by the death screen. A first-ever run is no record before round 3
    // (a "NEW BEST" on dying in round 1 means nothing); it is still stored as the best.
    const beaten = director.n > game.best;
    game.newBest = beaten && (game.best > 0 || director.n >= 3);
    if (beaten) {
      game.best = director.n;
      store.set(BEST_KEY, game.best);
    }
    setState('dead');
  });

  return game;
}
