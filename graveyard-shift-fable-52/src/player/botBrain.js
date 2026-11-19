// bot=1: what the autopilot decides. bot.js turns a goal and an aim into movement; this picks them
// so a run plays the game the way a player has to: shoot what it can see, back away from what gets
// close (bloaters from further off), reload, walk to the wall for ammo when the reserve runs low, and
// play the economy between fights:
//   - buys the cheapest wall weapon it can afford while it has a free slot;
//   - opens doors in ring order (d1..d5) once it has 500 over the price;
//   - throws the power switch once the garage is open;
//   - upgrades the held weapon at the bench and buys machines when it has 1000 to spare;
//   - rolls the box once a round when above 3000, waits for the offer and takes it;
//   - searches every unsearched object it passes within 4 m when no zombie is within 8 m;
//   - rebuilds a window's boards when idle.
// The smoke run and the scripted playthrough (scripts/smoke.mjs) drive the whole loop through it.
//
// Without god mode it has to survive, so it also (launch fix):
//   - keeps KEEP m from the nearest zombie unless it is buying ammo (an errand gives way, and it
//     backs off as soon as anything comes nearer);
//   - enters no other zone through a door while more than CROWD zombies are alive, and goes back
//     out to the forecourt's open ground when it has nothing to do elsewhere;
//   - buys wall ammo at once when the reserve is below one magazine and the wall is within reach;
//     the routine top-up waits until nothing is within KEEP m;
//   - backs off along the route with the fewest zombies near it, to open ground on the forecourt.
//
// Everything goes through the same doors a player uses: the fire, reload and interact inputs (a
// press, or a hold for searching and boards), the level's collision (and the zombies in the way),
// the prices.
//
//   bot.passive = true   stop shooting and stand still (the playthrough uses it to die)
//   bot.brain            { mode: 'fight'|'resupply'|'errand', shots, buys, target, errand }
//   brain.errandTo(id, {hold})   scripts: go to interactable `id` and use it (or hold interact there
//                                for `hold` seconds whatever it is); brain.errand is null when done
import { crateCostOf } from '../game/purchases.js';

const FIRE_EVERY = 0.2; // s between trigger pulls (the pistol's own cooldown is 0.15): lets the bloom settle
const SIGHT = 16; // m: do not shoot at anything farther (walking, even aimed fire scatters about a degree)
const TOO_CLOSE = 5; // m: a zombie this near and it moves off
const BLOATER_EXTRA = 3; // m: ... a bloater counts this much nearer (it bursts)
const RETHINK = 1; // s between choices of where to move off to
const HEAD_RANGE = 10; // m: inside this it goes for the head, beyond it for the chest (the cone is too wide)
const AIM_NEAR = [1.6, 1.42, 1.2, 0.9]; // head first, then down the body
const AIM_FAR = [1.25, 1.42, 0.95, 1.6];
const RESUPPLY_AT = 0.375; // share of the held weapon's max reserve at or below which it goes to buy (36 of the pistol's 96)
const CAMP_TOPUP = 0.625; // the same while it holds the wall buy (god mode; 60 of 96)
const ARRIVE = 0.5;
const STEP_AHEAD = 1.2; // m: how far along the flow field the walk goal is put
// economy
const THINK = 0.5; // s between errand choices
const SAFE = 8; // m: no zombie this near for a search or a board
const SEARCH_NEAR = 4; // m: searches what it passes this close to
const BOARD_NEAR = 10; // m
const DOOR_RING = ['d1', 'd2', 'd3', 'd4', 'd5'];
const DOOR_SPARE = 500, BOX_AT = 3000, SPARE = 1000;
const MACHINE_ORDER = ['jumpStart', 'longHaul', 'secondHelping', 'shortOrder'];
const ERRAND_LIMIT = 45; // s: an errand not done by then is dropped (and its target left alone a while)
const SKIP_FOR = 60; // s
const PRESS_EVERY = 0.4; // s between presses at a press errand
const DOOR_SIDES = [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]];
const UPPER = 2.5;
const MELEE_REACH = 1.7; // m // m: interactables this high hang on the upper floor (the bot keeps to the ground)
// survival (no god mode)
const KEEP = 8; // m: the nearest zombie is kept at least this far unless it is buying ammo
const KEEP_CLEAR = 12; // m: a retreat ends once the nearest is this far
const CROWD = 6; // more alive than this: no entering another zone through a door
const AMMO_REACH = 30; // m: a wall this near (in a zone it can walk to) is "within reach" for an urgent buy
const ROUTE_WIDTH = 3.5; // m: zombies this near a retreat's straight route count against it
const ROUTE_WEIGHT = 4; // score lost per zombie right on the route
const OPEN_BONUS = 2; // score for a spot on the forecourt's open ground
const OPEN_STEP = 3; // m: the lattice of candidate spots on the forecourt
const OPEN_INSET = 5; // m: ... kept this far inside its fence
const OPEN_CLEAR = 3.5; // m: ... each with this much walkable ground all round (no car, pump or lorry corner)
const MIN_MOVE = 3; // m: a retreat goes at least this far (the spot it stands on is no way out)
const CENTRE_PULL = 0.15; // score lost per metre from the forecourt's middle (corners are where it gets pinned)
const STALL = 0.8; // s: a retreat that has not moved the bot for this long picks another spot (and sidesteps)
const BANNED_FOR = 4; // s: ... and leaves the stalled one alone this long
const HOME = 'forecourt';

export function createBotBrain(G, player) {
  const out = [0, 0];
  const dir = [0, 0, 0];
  let field = null;
  let fieldFor = null; // the destination the field is solved for
  let fieldVersion = -1;
  let fireT = 0;
  let retreat = null; // [x, z] it is backing off to, or null
  let retreatT = 0;
  let thinkT = 0;
  let swapT = 0;
  let clock = 0;
  let boxRound = -1; // the round it last rolled the box in
  const skip = new Map(); // interactable id -> clock until which it is left alone
  const brain = { mode: 'fight', shots: 0, buys: 0, target: null, errand: null };
  if (G.events) {
    G.events.on('buy', () => { brain.buys++; });
    G.events.on('door:open', () => { fieldFor = null; }); // re-solve on the opened grid
    G.events.on('game:state', ({ state } = {}) => { if (state !== 'playing') { brain.errand = null; } });
  }

  const list = () => (G.level && G.level.interactables) || [];
  const game = () => (G.game && !G.game.stub ? G.game : null);
  const ground = (it) => !!it && !!it.pos && !((it.pos[1] ?? it.pos.y) > UPPER);
  const usable = (it) => !!it && (typeof it.enabled !== 'function' || it.enabled());
  // standing at `it`: by id, since the game may offer a live view of an interactable (the ammo crate)
  const at = (g, it) => !!(g && g.focus && it && g.focus.id === it.id);
  const P = (it) => (Array.isArray(it.pos) ? it.pos : [it.pos.x, it.pos.y, it.pos.z]);

  // zones reachable from the player's through open doors
  const reach = new Set();
  const queue = [];
  function reachable() {
    reach.clear();
    const L = G.level;
    const start = L && L.zone;
    if (!start || !L.zones || !L.zones[start]) { reach.add('forecourt'); return reach; }
    reach.add(start); queue.length = 0; queue.push(start);
    while (queue.length) {
      const z = queue.shift();
      for (const n of L.zones[z].neighbours || []) {
        const d = L.doors && L.doors.find((q) => q.id === n.door);
        if (d && d.open && !reach.has(n.zone)) { reach.add(n.zone); queue.push(n.zone); }
      }
    }
    return reach;
  }
  const inReach = (it) => !it.zone || reach.has(it.zone);
  const hereZone = () => (G.level && G.level.zone) || HOME;
  // going to `it` means walking into another zone through a door (the forecourt never counts: it is
  // where the bot falls back to)
  const entersZone = (it) => !!it.zone && it.zone !== hereZone() && it.zone !== HOME;
  function aliveCount() {
    let n = 0;
    for (const o of zombies()) if (o && o.alive !== false) n++;
    return n;
  }

  // Where ammo for the held weapon is sold: its own wall if it has one on the ground floor, else the
  // ammo crate (which sells for whatever is held).
  function ammoSource() {
    const w = G.weapon;
    const id = w && w.id;
    if (!id) return null;
    let crate = null;
    for (const it of list()) {
      if (it.kind === 'wallWeapon' && it.weapon === id && ground(it)) return it;
      if (!crate && it.kind === 'wallAmmo' && (!it.weapon || it.weapon === id)) crate = it;
    }
    return crate;
  }

  // Where to stand to use an interactable: the walkable ground nearest to it (it hangs on a wall).
  let standFor = null, stand = null, standPos = null;
  function standAt(it) {
    const p = P(it);
    if (standFor === it && standPos && standPos[0] === p[0] && standPos[2] === p[2]) return stand;
    standFor = it; standPos = p; stand = [p[0], p[2]];
    const g = G.nav && !G.nav.stub ? G.nav.grid : null;
    if (!g || typeof g.nearestWalkable !== 'function') return stand;
    let x = p[0], z = p[2];
    // a shut door: stand on the side the bot can reach, not the far one
    const L = G.level;
    if (it.kind === 'door' && L && typeof L.zoneAt === 'function') {
      reachable();
      for (const [dx, dz] of DOOR_SIDES) {
        if (reach.has(L.zoneAt(p[0] + dx, p[2] + dz))) { x = p[0] + dx; z = p[2] + dz; break; }
      }
    }
    const k = g.nearestWalkable(x, z);
    if (k >= 0) stand = [g.centerX(k), g.centerZ(k)];
    return stand;
  }

  // Walk toward (x, z) along a flow field of the bot's own (the zombies' field points at the bot).
  function walkTo(bot, x, z) {
    const p = player.pos;
    if (Math.hypot(x - p[0], z - p[2]) < ARRIVE) { bot.goal = [p[0], p[2]]; return true; }
    const nav = G.nav;
    if (!nav || nav.stub || !nav.grid || typeof nav.createFlowField !== 'function') { bot.goal = [x, z]; return false; }
    if (!field || field.grid !== nav.grid) { field = nav.createFlowField(nav.grid); fieldFor = null; }
    if (!fieldFor || fieldFor[0] !== x || fieldFor[1] !== z || fieldVersion !== nav.grid.version) {
      field.setTarget(x, z); fieldFor = [x, z]; fieldVersion = nav.grid.version;
    }
    field.dirInto(p[0], p[2], out);
    if (out[0] === 0 && out[1] === 0) { bot.goal = [x, z]; return false; } // off the grid or arrived: go straight
    bot.goal = [p[0] + out[0] * STEP_AHEAD, p[2] + out[1] * STEP_AHEAD];
    return false;
  }
  // to the nearest open ground, then straight at the thing
  function approach(bot, it) {
    const at = standAt(it);
    if (walkTo(bot, at[0], at[1])) { const p = P(it); bot.goal = [p[0], p[2]]; }
  }

  // The nearest zombie the bot can actually hit, and where on it: the point is checked with the
  // same two raycasts a shot makes, so nothing is fired into a wall or a car.
  function pickTarget() {
    const zl = G.zombies && G.zombies.list;
    if (!Array.isArray(zl) || !zl.length || typeof G.zombies.raycast !== 'function') return null;
    const eye = player.eye;
    let best = null, bestD = Infinity;
    for (const z of zl) {
      if (!z || !z.pos || z.alive === false) continue;
      const d = Math.hypot(z.pos.x - eye[0], z.pos.z - eye[2]);
      if (d > SIGHT || d >= bestD) continue;
      for (const h of d < HEAD_RANGE ? AIM_NEAR : AIM_FAR) {
        dir[0] = z.pos.x - eye[0]; dir[1] = h - eye[1]; dir[2] = z.pos.z - eye[2];
        const l = Math.hypot(dir[0], dir[1], dir[2]);
        if (l < 1e-3) continue;
        dir[0] /= l; dir[1] /= l; dir[2] /= l;
        const zh = G.zombies.raycast(eye, dir, l + 1.5);
        if (!zh || zh.id !== z.id) continue;
        const wh = G.level && typeof G.level.raycast === 'function' ? G.level.raycast(eye, dir, l + 1.5) : null;
        if (wh && wh.dist < zh.dist) continue;
        best = { id: z.id, pos: [zh.pos.x ?? zh.pos[0], zh.pos.y ?? zh.pos[1], zh.pos.z ?? zh.pos[2]] };
        bestD = d;
        break;
      }
    }
    return best;
  }

  // Open ground to fall back to: the corners and the middle of the playable area, a few metres in.
  let spots = null, spotsFor = null;
  function fallbacks() {
    const pl = G.level && (G.level.playable || G.level.bounds);
    const key = pl ? `${pl.min[0]},${pl.min[2]},${pl.max[0]},${pl.max[2]}` : '';
    if (spots && spotsFor === key) return spots;
    spotsFor = key;
    spots = [];
    if (pl) {
      const x0 = pl.min[0] + 5, x1 = pl.max[0] - 5, z0 = pl.min[2] + 5, z1 = pl.max[2] - 5;
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2]]) {
        const g = G.nav && !G.nav.stub ? G.nav.grid : null;
        const k = g && typeof g.nearestWalkable === 'function' ? g.nearestWalkable(x, z) : -1;
        spots.push(k >= 0 ? [g.centerX(k), g.centerZ(k)] : [x, z]);
      }
    }
    return spots;
  }
  const zombies = () => (G.zombies && Array.isArray(G.zombies.list) ? G.zombies.list : []);
  // distance to the nearest zombie; a bloater counts as nearer than it is
  function nearestZombie(x, z) {
    let best = Infinity;
    for (const o of zombies()) {
      if (!o || !o.pos || o.alive === false) continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z) - (o.type === 'bloater' ? BLOATER_EXTRA : 0);
      if (d < best) best = d;
    }
    return best;
  }
  function closest() {
    let best = null, bd = Infinity;
    for (const o of zombies()) {
      if (!o || !o.pos || o.alive === false) continue;
      const d = Math.hypot(o.pos.x - player.pos[0], o.pos.z - player.pos[2]);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  // Open ground on the forecourt: a lattice over its main rectangle, OPEN_INSET inside the fence,
  // keeping the points with OPEN_CLEAR of walkable ground all round (not against a car, a pump island
  // or the lorry, where a bot backing off gets pinned). Built once, when the nav grid is there.
  let open = null;
  function openGround() {
    if (open) return open;
    const g = G.nav && !G.nav.stub ? G.nav.grid : null;
    const zf = G.level && G.level.zones && G.level.zones[HOME];
    const r = zf && zf.rects && zf.rects[0];
    if (!g || typeof g.walkable !== 'function' || !r) return null;
    open = [];
    const clear = (x, z) => {
      if (!g.walkable(x, z)) return false;
      for (let a = 0; a < 8; a++) if (!g.walkable(x + OPEN_CLEAR * Math.cos((a * Math.PI) / 4), z + OPEN_CLEAR * Math.sin((a * Math.PI) / 4))) return false;
      return true;
    };
    for (let x = r.x0 + OPEN_INSET; x <= r.x1 - OPEN_INSET + 1e-6; x += OPEN_STEP) {
      for (let z = r.z0 + OPEN_INSET; z <= r.z1 - OPEN_INSET + 1e-6; z += OPEN_STEP) if (clear(x, z)) open.push([x, z]);
    }
    return open;
  }
  const banned = new Map(); // retreat spot -> clock until which it is not picked (it pinned the bot)
  // how many zombies stand near the straight route from the bot to (x, z): each counts by how close
  // it is to the route (1 on it, 0 at ROUTE_WIDTH)
  function routeDensity(x, z) {
    const p = player.pos, dx = x - p[0], dz = z - p[2], L2 = dx * dx + dz * dz;
    let sum = 0;
    for (const o of zombies()) {
      if (!o || !o.pos || o.alive === false) continue;
      const ox = o.pos.x - p[0], oz = o.pos.z - p[2];
      const t = L2 > 1e-6 ? Math.max(0, Math.min(1, (ox * dx + oz * dz) / L2)) : 0;
      const d = Math.hypot(ox - t * dx, oz - t * dz);
      if (d < ROUTE_WIDTH) sum += 1 - d / ROUTE_WIDTH;
    }
    return sum;
  }
  function scoreSpot(s, survive) {
    const p = player.pos;
    let score = Math.min(nearestZombie(s[0], s[1]), 20) - 0.25 * Math.hypot(s[0] - p[0], s[1] - p[2]);
    if (survive) {
      score -= ROUTE_WEIGHT * routeDensity(s[0], s[1]);
      if (G.level && typeof G.level.zoneAt === 'function' && G.level.zoneAt(s[0], s[1]) === HOME) score += OPEN_BONUS;
      const r = G.level && G.level.zones && G.level.zones[HOME] && G.level.zones[HOME].rects && G.level.zones[HOME].rects[0];
      if (r) score -= CENTRE_PULL * Math.hypot(s[0] - (r.x0 + r.x1) / 2, s[1] - (r.z0 + r.z1) / 2);
    }
    return score;
  }
  // The fallback spot with the most room around it, discounted by how far it is to walk; without god
  // mode also by the zombies along the way, and the forecourt's open ground is preferred.
  // `homeOnly`: only the forecourt's open ground (on the way back out of another zone)
  function pickRetreat(survive, homeOnly = false) {
    let best = null, bestScore = -Infinity;
    const og = survive ? openGround() : null;
    // without god mode, on the forecourt only its open ground (the corners of the zone's box are where
    // it gets pinned); elsewhere the zone's own spots too, unless it is on its way out
    const zoneSpots = !homeOnly && (!og || !og.length || hereZone() !== HOME);
    if (zoneSpots) for (const s of fallbacks()) { const sc = scoreSpot(s, survive); if (sc > bestScore) { bestScore = sc; best = s; } }
    if (og) {
      const p = player.pos;
      for (const s of og) {
        if (banned.get(s) > clock || Math.hypot(s[0] - p[0], s[1] - p[2]) < MIN_MOVE) continue;
        const sc = scoreSpot(s, survive);
        if (sc > bestScore) { bestScore = sc; best = s; }
      }
    }
    return best;
  }
  // a retreat that is not getting anywhere (a car, the lorry, a crowd): another spot, and a sidestep
  let stallT = 0, stallX = 0, stallZ = 0;
  function checkStall(bot, dt) {
    const p = player.pos;
    if (Math.hypot(p[0] - stallX, p[2] - stallZ) > 0.4) { stallX = p[0]; stallZ = p[2]; stallT = 0; return; }
    stallT += dt;
    if (stallT < STALL) return;
    stallT = 0;
    if (retreat) banned.set(retreat, clock + BANNED_FOR);
    retreat = pickRetreat(true);
    retreatT = RETHINK;
    bot.sidestep = 0.6;
  }

  // ---- economy: what to go and do next, or null
  const near = (it, r) => { const p = P(it); return Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]) <= r; };
  const free = (it) => !(skip.get(it.id) > clock);
  function chooseErrand(safe, crowded) {
    const g = game(), w = G.weapon, L = G.level;
    if (!g || !w || !L) return null;
    const pts = g.points;
    reachable();
    const ok = (it) => usable(it) && ground(it) && inReach(it) && free(it) && !(crowded && entersZone(it));
    const its = list();
    // a wall weapon, the cheapest it can afford, while a slot is free, or in place of a weapon that
    // is running dry with nowhere to buy its ammo (the box's and the searches' weapons)
    const starved = !ammoSource() && w.ammo.reserve <= w.ammo.mag;
    if (w.slots && (!w.slots[1] || starved)) {
      let best = null;
      for (const it of its) if (it.kind === 'wallWeapon' && ok(it) && !w.has(it.weapon) && it.cost <= pts && (!best || it.cost < best.cost)) best = it;
      if (best) return { it: best, act: 'press', done: () => w.has(best.weapon) };
    }
    // the next door in ring order with 500 to spare
    for (const id of DOOR_RING) {
      const d = L.doors && L.doors.find((q) => q.id === id);
      if (!d || d.open || !(reach.has(d.a) || reach.has(d.b))) continue;
      const it = its.find((q) => q.kind === 'door' && q.door === id);
      if (it && free(it) && pts >= d.cost + DOOR_SPARE) return { it, act: 'press', done: () => d.open };
      break; // in order: not past a door it cannot buy yet
    }
    const power = L.power;
    if (power && !power.on) {
      const it = its.find((q) => q.kind === 'power');
      if (it && ok(it)) return { it, act: 'press', done: () => power.on };
    }
    if (power && power.on) {
      const s = w.slots && w.slots[w.slot];
      const bench = its.find((q) => q.kind === 'bench');
      if (s && !s.upgraded && bench && ok(bench) && pts >= bench.cost + SPARE) {
        const id = s.id;
        return { it: bench, act: 'press', done: () => { const q = w.slots.find((x) => x && x.id === id); return !q || q.upgraded; } };
      }
      for (const k of MACHINE_ORDER) {
        const it = its.find((q) => q.kind === 'machine' && q.machine === k);
        if (it && ok(it) && pts >= it.cost + SPARE) return { it, act: 'press', done: () => g.machines.has(k) };
      }
    }
    const box = g.box;
    const boxIt = its.find((q) => q.kind === 'box');
    if (box && boxIt && box.state === 'idle' && boxRound !== g.round && pts > BOX_AT && ok(boxIt)) {
      return { it: boxIt, act: 'box', rolled: false, done: () => false };
    }
    if (!safe) return null;
    // the nearest unsearched object within 4 m, then a window short of boards
    let best = null, bestD = Infinity;
    for (const it of its) {
      if (it.kind !== 'search' || !ok(it) || !near(it, SEARCH_NEAR)) continue;
      const p = P(it); const d = Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]);
      if (d < bestD) { best = it; bestD = d; }
    }
    if (best) { const id = best.search; return { it: best, act: 'hold', safe: true, done: () => g.loot.searched.has(id) }; }
    for (const it of its) {
      if (it.kind === 'boards' && ok(it) && near(it, BOARD_NEAR)) return { it, act: 'hold', safe: true, done: () => !it.enabled() };
    }
    return null;
  }

  // a scripted errand: go to `id` and use it, or hold interact there for `hold` seconds
  brain.errandTo = (id, opts = {}) => {
    const it = list().find((q) => q.id === id);
    if (!it) return false;
    const g = game();
    const holdFor = opts.hold > 0 ? opts.hold : 0;
    let held = 0;
    const act = holdFor ? 'hold' : it.kind === 'search' || it.kind === 'boards' ? 'hold' : it.kind === 'box' ? 'box' : 'press';
    // the ammo crate never stops being usable: done once a press there has been answered (bought or refused)
    const since = g ? g.lastUse : null;
    const done = holdFor ? () => held >= holdFor
      : it.kind === 'search' ? () => !!(g && g.loot.searched.has(it.search))
        : it.kind === 'wallAmmo' ? () => !!(g && g.lastUse && g.lastUse !== since && g.lastUse.id === it.id)
          : () => !usable(it);
    brain.errand = { it, act, rolled: false, scripted: true, t: 0, tick: (dt) => { held += dt; }, holdFor, done };
    skip.delete(id);
    return true;
  };

  let pressT = 0;
  function runErrand(bot, dt, input) {
    const e = brain.errand;
    const g = game();
    e.t = (e.t || 0) + dt;
    // stuck on the way (a crowd, a corner): a sidestep, as bot.js does for its own goals
    const ep = P(e.it);
    const d = Math.hypot(ep[0] - player.pos[0], ep[2] - player.pos[2]);
    if (!(d < e.best - 0.3)) e.stall = (e.stall || 0) + dt; else { e.best = d; e.stall = 0; }
    if (e.best === undefined) e.best = d;
    if (e.stall > 2 && g && !at(g, e.it)) { bot.sidestep = 0.8; e.stall = 0; e.best = d; }
    if (e.act === 'box' && g) {
      const box = g.box;
      if (box.state === 'rolling') e.rolled = true;
      if (e.rolled && box.state !== 'rolling' && box.state !== 'offering') { brain.errand = null; return; }
      if (e.rolled && box.state === 'offering' && !at(g, e.it)) { approach(bot, e.it); return; }
    } else if (e.done()) { brain.errand = null; return; }
    if (e.t > ERRAND_LIMIT) { skip.set(e.it.id, clock + SKIP_FOR); brain.errand = null; return; }
    if (e.scripted && e.holdFor && g && !at(g, e.it) && near(e.it, 1.0)) {
      // a forced hold on something that offers nothing any more: stand at it and hold
      bot.goal = [player.pos[0], player.pos[2]];
      if (!g.focus || g.focus.hold > 0) input.synthNext('interact'); // never a press on something else
      e.tick(dt);
      return;
    }
    if (!at(g, e.it)) { approach(bot, e.it); return; }
    bot.goal = [player.pos[0], player.pos[2]];
    if (e.act === 'hold') {
      input.synthNext('interact'); // held every frame: game.update reads it before the bot runs
      if (e.tick) e.tick(dt);
      return;
    }
    pressT -= dt;
    if (pressT > 0) return;
    pressT = PRESS_EVERY;
    if (e.act === 'box') {
      const box = g.box;
      if (box.state === 'idle' && !e.rolled) { input.synthNext('interact'); boxRound = g.round; }
      else if (box.state === 'offering') input.synthNext('interact');
      return;
    }
    input.synthNext('interact');
  }

  Object.defineProperty(brain, 'retreat', { get: () => retreat, enumerable: false }); // (probes read where it is backing off to)

  brain.update = (dt) => {
    const bot = player.bot;
    const input = G.input;
    const w = G.weapon;
    if (!bot || !input || !w || !w.ammo) return;
    clock += dt;
    bot.watch.t = 0; // the brain steers: bot.js's own stuck guard (jump, sidestep) stays out of it
    if (bot.passive) { bot.goal = [player.pos[0], player.pos[2]]; brain.target = null; brain.errand = null; return; }

    // ---- where to be
    const buy = ammoSource();
    const g = game();
    const points = g ? g.points : 0;
    const near0 = nearestZombie(player.pos[0], player.pos[2]);
    // A bot that cannot die (god=1, the soak run) holds the wall buy between errands: late rounds put
    // two dozen zombies of 1000 health between it and the ammo, and a bot that cannot be killed
    // cannot be freed by dying either. It stands in reach of the wall and tops up as it spends.
    const camp = !!(G.params && G.params.god) && !!buy;
    const maxRes = (w.def && w.def.maxReserve) || 96;
    const low = w.ammo.reserve <= maxRes * (camp ? CAMP_TOPUP : RESUPPLY_AT);
    const atBuy = !!(buy && g && g.focus && g.focus.id === buy.id);
    // a bot that cannot die (god) does not leave an errand for ammo until it is nearly out
    const god = !!(G.params && G.params.god);
    const urgent = !brain.errand || !god || w.ammo.reserve <= w.ammo.mag;
    // the crate's price is the held gun's (its own `cost` is the pistol's)
    const buyCost = !buy ? 0 : buy.kind === 'wallAmmo' ? crateCostOf(buy, w) : buy.cost ?? 0;
    let canBuyAmmo = !!buy && low && urgent && points >= buyCost && usable(buy);
    const survive = !god;
    const crowded = survive && aliveCount() > CROWD;
    if (survive && buy && points >= buyCost && usable(buy)) {
      // below one magazine with a wall within reach: buy now, zombies or not; above it, top up only
      // when nothing is within KEEP m and the wall is not through a door into a crowd
      reachable();
      const magSize = (w.def && w.def.mag) || w.ammo.mag || 1;
      const bp = P(buy);
      const inRange = inReach(buy) && Math.hypot(bp[0] - player.pos[0], bp[2] - player.pos[2]) <= AMMO_REACH;
      const urgentAmmo = w.ammo.reserve < magSize && inRange;
      canBuyAmmo = urgentAmmo || (canBuyAmmo && near0 >= KEEP && !(crowded && entersZone(buy)));
    } else if (survive) canBuyAmmo = false;
    // out of everything in this weapon: the other one
    // (only to one that has ammo left, or with no wall to buy this one's: never back and forth)
    const other = w.slots && w.slots[1 - w.slot];
    if (w.ammo.mag === 0 && w.ammo.reserve === 0 && other && (other.mag + other.reserve > 0 || !buy) && !w.reloading && typeof input.synth === 'function') {
      swapT -= dt;
      if (swapT <= 0) { input.synth('swap'); swapT = 1.5; }
    }

    thinkT -= dt;
    if (brain.errand && !brain.errand.scripted) {
      const e = brain.errand;
      // a search or a board waits for a quiet moment; anything else gives way to a zombie at arm's length
      // (a bot that cannot die keeps to anything but a search or a board)
      if ((e.safe && near0 < SAFE) || (survive && near0 < KEEP) || (crowded && entersZone(e.it)) || canBuyAmmo) brain.errand = null;
    }
    if (!brain.errand && !canBuyAmmo && thinkT <= 0 && (god || near0 >= KEEP)) {
      thinkT = THINK;
      brain.errand = chooseErrand(near0 >= SAFE, crowded);
    }

    if (canBuyAmmo) {
      brain.mode = 'resupply';
      retreat = null;
      if (atBuy) {
        bot.goal = [player.pos[0], player.pos[2]];
        if (typeof input.synthNext === 'function') input.synthNext('interact'); // game reads it next frame
      } else approach(bot, buy);
    } else if (brain.errand) {
      brain.mode = 'errand';
      retreat = null;
      runErrand(bot, dt, input);
    } else if (camp) {
      brain.mode = 'resupply';
      retreat = null;
      if (atBuy) bot.goal = [player.pos[0], player.pos[2]];
      else approach(bot, buy);
    } else {
      brain.mode = 'fight';
      retreatT -= dt;
      const keep = survive ? KEEP : TOO_CLOSE, clear = survive ? KEEP_CLEAR : TOO_CLOSE * 1.6;
      if (near0 < keep && (retreatT <= 0 || !retreat)) { retreat = pickRetreat(survive); retreatT = RETHINK; }
      // nothing near and nothing to do in another zone: back out to the forecourt's open ground
      if (!retreat && survive && hereZone() !== HOME && near0 >= keep) {
        const og = openGround();
        if (og && og.length) { retreat = pickRetreat(true, true); retreatT = RETHINK; }
      }
      if (retreat && ((near0 >= clear && hereZone() === HOME) || walkTo(bot, retreat[0], retreat[1]))) retreat = null;
      if (retreat && survive) checkStall(bot, dt); else stallT = 0;
      if (!retreat) bot.goal = [player.pos[0], player.pos[2]];
    }

    // ---- what to shoot (never in the middle of a search: a shot cancels it)
    fireT -= dt;
    // nothing left in either weapon: the knife (or the axe) at arm's length
    if (w.ammo.mag === 0 && w.ammo.reserve === 0 && near0 < MELEE_REACH && typeof input.synth === 'function') {
      const z = closest();
      if (z) { bot.fireAt([z.pos.x, 1.3, z.pos.z]); input.synth('melee'); }
    }
    if (w.ammo.mag === 0 && w.ammo.reserve > 0 && !w.reloading && typeof input.synth === 'function') input.synth('reload');
    if (g && g.loot && g.loot.active) return;
    if (fireT > 0 || w.reloading || w.ammo.mag === 0) return;
    const t = pickTarget();
    brain.target = t ? t.id : null;
    if (!t) return;
    if (typeof input.synth === 'function') input.synth('ads'); // aimed fire: the hip cone misses past a few metres
    bot.fireAt(t.pos);
    brain.shots++;
    fireT = FIRE_EVERY;
  };
  return brain;
}
