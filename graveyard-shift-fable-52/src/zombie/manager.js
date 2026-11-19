// G.zombies: owns the pool of zombie bodies and their animators, and drives the pure crowd AI in
// ai.js. Bodies are built once at load (live cap + corpse cap, specials included: types.js poolPlan)
// and reused; the body and animator are a black box behind the API documented in task-10-report.md
// (the original) and buildZombie.
//
//   list       live zombie records { id, pos:{x,y,z}, state, health, maxHealth, type, alive, speed,
//              layer, crawling, limbs:{head,armL,armR,legL,legR}, lured }
//   alive      live count
//   spawn(point, opts) -> id | null      point: {pos, kind, top?, to?, window?} or [x,y,z];
//                                        opts: {round, health, type} (health: the round's walker
//                                        health, scaled by the type; opts.exact: use the point as given;
//                                        opts.minDist: a point swapped in is at least this far from the
//                                        player; opts.slow: a walker at the low end of its speed)
//   raycast(origin, dir, maxDist) -> { id, part, pos, dist } | null
//   damage(id, amount, part, dir) -> { killed, damage, headshot, severed? }
//   setLure(pos | null, seconds, radius?)  zombies within radius go to pos for seconds, then back
//   stagger(id, push {x,z} m, seconds) -> bool   thrown back and held (not the brute)
//   clear(), update(dt), stats, clouds (bloater clouds alive), bodyOf(id)
//
// The last zombies of a round (G.game.director has spawned everything and at most
// tuning.zombies.straggler.count are left for .after s): round:straggler {id, pos:{x,y,z}} for each,
// again every .every s while it holds; walking ones move .speed x faster; a crawler left that long for
// .crawlerAfter s is moved to a spawn point out of view and nearer the player (round:straggler again).
//
// Event order: zombie:spawn {id, pos, type}; zombie:attack {id, pos, type, kind:'swing'|'slam'} at
// the start of a wind-up; zombie:sever {id, part, pos} when a part comes off; zombie:burst {id, pos}
// when a bloater bursts (killed or by itself), before its zombie:die; zombie:die {id, pos, headshot,
// type, cause?} is emitted while the zombie is still in `list` (cause 'burst' when a bloater burst by
// itself, not killed), then it is removed. zombie:remove {id} only when a zombie leaves play without
// being killed. A stuck respawn or a relocation keeps its id and emits nothing.
import { buildZombie } from './body.js';
import { createAnimator } from './anim.js';
import { installZombieTest } from './zombietest.js';
import { tuning } from '../game/tuning.js';
import { createFlowField } from '../nav/flowfield.js';
import {
  createCrowd, addAgent, placeAgent, removeAgent, enterOverFence, setAgentType, crowdThink, crowdMove, createObstacles,
  pickSpawn, pickHidden, inView, pointX, pointZ, createGhostAnimator, STATE_NAMES, CHASE, ENTER, CLIMB, WINDUP, RECOVER, TEAR, FUSE, AI,
} from './ai.js';
import { typeDef, isType, partScale, attackDamage, animState, poolPlan, bodyKind, explosionLimbs } from './types.js';

const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
const LIMB = { armL: 0, armR: 1, legL: 2, legR: 3 };
const CORPSES = 12;
const SINK_TIME = 1.5, SINK_DEPTH = 0.6;
const LOD_FAR = 12; // m: beyond this a zombie is drawn with its far mesh, unless the tier says (G.quality.zombieLodFar)
const RECENT = 8;   // killed zombies remembered for the hit:zombie that follows their death
const MAX_CLOUDS = 6;
const STEP_UP = 0.32;
const WALL_HALF = 0.15; // a window's centre to its wall's outer face (walls are 0.3 m)
const LINK_EVERY = 0.25; // s between checks for a window or breach on a chasing zombie's path // the level's heightAt finds floors up to this above the height it is given
// staged spawn layouts relative to the camera: [right, forward] in metres
const NEAR = [[-0.85, 3.0], [0.35, 4.1], [1.25, 2.6]];
const FAR = [[-3, 10.2], [1.5, 12.2], [-0.5, 15.2], [4, 16.2], [-5, 18.2], [2, 20.2], [-2, 23.2], [6, 25.2]];
const STAGED_GAP = 4; // m: the far layout's nearest zombie to the shot camera

export function createZombies(G, deps = {}) {
  if (G.params && G.params.shot === 'zombietest' && !deps.build) return installZombieTest(G);
  const build = deps.build || buildZombie;
  const animate = deps.animate || createAnimator;
  const W = tuning.walker;
  const T = tuning.zombies;
  const CAP = tuning.round.maxAlive;
  const rng = G.rng.fork('zombies');
  const limbRng = G.rng.fork('zombies:limbs');
  const crowd = createCrowd(CAP);
  const emit = (name, payload) => G.events && G.events.emit(name, payload);
  // the simulation clock (stops while the game is paused), or the frame clock where there is none
  const now = () => (G.time ? G.time.sim ?? G.time.t : 0);

  // ---- body pool -------------------------------------------------------------------------------
  // body: { z (built zombie), kind, anim, slot (crowd index or -1), corpse (bool), sinkT (-1 or seconds) }
  const bodies = [];
  try {
    for (const p of poolPlan(CAP + CORPSES, (a) => rng.pick(a))) {
      const seed = rng.int(1, 999999);
      let z, kind = p.kind;
      // a special build that fails stands in as an ordinary body (the type still plays the same)
      try { z = build(seed, G, p.opts); } catch (e) {
        if (kind === 'civilian') throw e;
        console.warn(`[zombies] ${kind} body failed, using an ordinary one:`, e && e.message);
        z = build(seed, G, {}); kind = 'civilian';
      }
      z.mesh.visible = false;
      if (G.scene) G.scene.add(z.mesh);
      bodies.push({ z, kind, anim: null, slot: -1, corpse: false, sinkT: -1, bones: z.skeleton && z.skeleton.bones ? z.skeleton.bones : [] });
    }
  } catch (e) {
    // no materials (stub mats) or a broken body: run the AI with the bodies built so far (or none)
    console.warn('[zombies] bodies unavailable, running without them:', e && e.message);
  }
  const corpses = [];        // bodies lying dead, oldest first
  const sinking = [];        // bodies sinking out of sight before they are reused

  // per crowd slot
  const recs = new Array(CAP).fill(null);
  const slotBody = new Array(CAP).fill(null);
  const slotAnim = new Array(CAP).fill(null);
  const slotWin = new Array(CAP).fill(null); // the window a slot is coming in through, until it is in
  const fenceTop = new Float64Array(CAP);
  const limbDmg = new Float64Array(CAP * 4); // damage taken on armL, armR, legL, legR
  const stunT = new Float64Array(CAP);       // s left of a stagger that holds it in place (staggerById)
  const cutT = new Float64Array(CAP);        // s cut off from the player while others have a path
  const respawnAt = new Float64Array(CAP);   // a stuck respawn waiting for a spawn point out of view: retry at (0 = none)
  const strayT = new Float64Array(CAP);      // s a crawler has been one of the round's last few
  const visY = new Float64Array(CAP);        // the body's drawn height: the feet height, eased over each stair riser
  const tgtT = new Float64Array(CAP);    // next time the animator's look target may be refreshed
  // the look target last given to each animator (x, z; NaN = none). setTarget copies its argument
  // into a new array, so it is only called when the target has moved 0.25 m or appeared/vanished.
  const tgtX = new Float64Array(CAP).fill(NaN), tgtZ = new Float64Array(CAP).fill(NaN);
  const TGT = [0, 0, 0];                 // scratch argument for setTarget / set(..., {target})
  const OPTS = { target: TGT };
  const NOOPTS = {};
  const byId = new Map();                // id -> slot
  const winOcc = new Map();              // window id -> the slot tearing or climbing there
  const list = [];
  let nextId = 1;
  const stuckLog = [];
  const stats = { spawned: 0, killed: 0, stuck: 0, removed: 0, relocated: 0, severed: 0, bursts: 0, aiMs: 0, stuckLog };
  // recently killed: id -> body, for the explosion that killed them (ring)
  const deadId = new Int32Array(RECENT).fill(-1);
  const deadBody = new Array(RECENT).fill(null);
  let deadAt = 0;

  function isFree(b) { return b.slot < 0 && !b.corpse && b.sinkT < 0; }
  function takeOldest(arr, kind) {
    for (let k = 0; k < arr.length; k++) {
      const b = arr[k];
      if (kind && b.kind !== kind) continue;
      arr.splice(k, 1);
      b.corpse = false; b.sinkT = -1;
      return b;
    }
    return null;
  }
  // a free body of the kind, else the oldest sinking or dead one of it, else a civilian, else anything
  function acquireBody(kind) {
    for (const b of bodies) if (b.kind === kind && isFree(b)) return b;
    let b = takeOldest(sinking, kind) || takeOldest(corpses, kind);
    if (b) return b;
    if (kind !== 'civilian') {
      for (const x of bodies) if (x.kind === 'civilian' && isFree(x)) return x;
      b = takeOldest(sinking, 'civilian') || takeOldest(corpses, 'civilian');
      if (b) return b;
    }
    for (const x of bodies) if (isFree(x)) return x;
    return takeOldest(sinking, null) || takeOldest(corpses, null);
  }
  function releaseBody(b) {
    b.slot = -1; b.corpse = false; b.sinkT = -1; b.anim = null;
    b.z.mesh.visible = false;
  }

  // ---- level helpers ---------------------------------------------------------------------------
  let obstacles = null, obstacleSrc = null, obstacleLen = -1;
  function getObstacles() {
    const cols = G.level && G.level.colliders;
    if (!cols || !cols.length) return null;
    if (cols !== obstacleSrc || cols.length !== obstacleLen) { obstacles = createObstacles(cols); obstacleSrc = cols; obstacleLen = cols.length; }
    return obstacles;
  }
  // spawn points in zones the player can reach through open doors (original levels: all of them)
  const spawnPoints = () => {
    const L = G.level;
    if (!L) return [];
    const a = typeof L.activeSpawnPoints === 'function' ? L.activeSpawnPoints() : L.spawnPoints;
    return Array.isArray(a) ? a : [];
  };
  const playerPos = () => {
    const p = G.player && G.player.pos;
    if (!p) { const s = G.level && G.level.playerStart && G.level.playerStart.pos; return s ? [s[0], s[1], s[2]] : [0, 0, 0]; }
    return Array.isArray(p) || ArrayBuffer.isView(p) ? p : [p.x, p.y, p.z];
  };
  // horizontal view cone of the camera, for spawning out of sight
  function view() {
    const c = G.camera;
    if (!c || !c.matrixWorld) return null;
    const e = c.matrixWorld.elements;
    let fx = -e[8], fz = -e[10];
    const l = Math.hypot(fx, fz);
    if (l < 1e-4) return null;
    fx /= l; fz /= l;
    const half = Math.atan(Math.tan(((c.fov || 70) * Math.PI) / 360) * (c.aspect || 16 / 9));
    return { x: e[12], z: e[14], fx, fz, cosHalf: Math.cos(Math.min(Math.PI * 0.95, half + 0.15)) };
  }
  // the fence between a fence spawn and where it lands: inward normal and plane offset (a window's
  // is its wall's outer face, whatever stands in front of it)
  function fencePlane(point) {
    const w = windowById(point.window);
    if (w && w.normal) {
      const nx = -w.normal[0], nz = -w.normal[2];
      return { nx, nz, fd: nx * w.pos[0] + nz * w.pos[2] - WALL_HALF };
    }
    const x0 = pointX(point), z0 = pointZ(point);
    const to = point.to;
    if (!to) return null;
    let nx = to[0] - x0, nz = to[2] - z0;
    const L = Math.hypot(nx, nz);
    if (L < 0.1) return null;
    nx /= L; nz /= L;
    let d = L * 0.5;
    const hit = G.level && G.level.raycast ? G.level.raycast([x0, 0.6, z0], [nx, 0, nz], L) : null;
    if (hit && Number.isFinite(hit.dist)) d = hit.dist;
    return { nx, nz, fd: nx * x0 + nz * z0 + d };
  }
  function windowById(id) {
    const ws = G.level && G.level.windows;
    if (!id || !Array.isArray(ws)) return null;
    for (const w of ws) if (w.id === id) return w;
    return null;
  }
  // the nav grid when it has floors above the ground (else every zombie is on layer 0)
  function layeredGrid() {
    const g = G.nav && G.nav.grid;
    return g && g.layers > 1 && typeof g.layerAt === 'function' ? g : null;
  }

  function bodyFor(i) {
    const b = slotBody[i];
    return b ? b.z : null;
  }
  function newAnimator(i) {
    const z = bodyFor(i);
    const a = z ? animate(z) : createGhostAnimator();
    slotAnim[i] = a;
    if (slotBody[i]) slotBody[i].anim = a;
    tgtT[i] = 0; tgtX[i] = NaN; tgtZ[i] = NaN;
    return a;
  }
  function syncMesh(i) {
    const z = bodyFor(i);
    if (!z) return;
    z.mesh.position.set(crowd.x[i], visY[i], crowd.z[i]);
    z.mesh.rotation.y = crowd.yaw[i];
  }
  function gaitOf(i) {
    const r = recs[i];
    return r && r.crawling ? 'crawl' : typeDef(r ? r.type : 'walker').gait;
  }

  function releaseWindow(i) {
    const w = slotWin[i];
    if (w && winOcc.get(w.id) === i) winOcc.delete(w.id);
    slotWin[i] = null;
  }

  // put slot i at a spawn point (fresh spawn, stuck respawn or relocation)
  function placeAt(i, point, t) {
    const x = pointX(point), z = pointZ(point);
    const pp = playerPos();
    releaseWindow(i);
    respawnAt[i] = 0;
    placeAgent(crowd, i, x, z, Math.atan2(pp[0] - x, pp[2] - z), t);
    const py = point.pos ? (Array.isArray(point.pos) ? point.pos[1] : point.pos.y) : Array.isArray(point) ? point[1] : point.y;
    crowd.y[i] = Number.isFinite(py) ? py : 0;
    visY[i] = crowd.y[i];
    crowd.layer[i] = 0;
    const fp = point.kind === 'fence' ? fencePlane(point) : null;
    if (fp) {
      const w = windowById(point.window);
      slotWin[i] = w;
      enterOverFence(crowd, i, fp.nx, fp.nz, fp.fd, !!w);
      crowd.yaw[i] = Math.atan2(fp.nx, fp.nz);
      fenceTop[i] = Number.isFinite(point.top) ? point.top : 1.2;
    }
    if (recs[i]) { recs[i].pos.x = x; recs[i].pos.y = crowd.y[i]; recs[i].pos.z = z; }
    syncMesh(i);
    newAnimator(i);
  }

  // A chasing zombie whose path goes through a window or a breach (the field's one-way links) and
  // that stands on the outer side of it climbs through it there, as a spawn at that point would.
  let pointsById = null;
  function pointById(id) {
    if (!pointsById) {
      pointsById = new Map();
      const L = G.level;
      const all = L && (Array.isArray(L.allSpawnPoints) ? L.allSpawnPoints : spawnPoints());
      if (all) for (const p of all) if (p && p.id) pointsById.set(p.id, p);
    }
    return pointsById.get(id) || null;
  }
  const linkT = new Float64Array(CAP);
  function takeLinks(t) {
    const f = env.field;
    if (!f || typeof f.next !== 'function') return;
    for (let i = 0; i < CAP; i++) {
      if (!recs[i] || crowd.state[i] !== CHASE || crowd.lure[i] || crowd.custom[i] || t < linkT[i]) continue;
      linkT[i] = t + LINK_EVERY;
      if (!(crowd.pathD[i] < Infinity)) continue;
      const nx = f.next(crowd.x[i], crowd.z[i], crowd.layer[i]);
      const p = nx && nx.link && nx.link.id ? pointById(nx.link.id) : null;
      if (!p) continue;
      const fp = fencePlane(p);
      if (!fp || fp.fd - (fp.nx * crowd.x[i] + fp.nz * crowd.z[i]) <= 0) continue; // already in
      const w = windowById(p.window);
      releaseWindow(i);
      slotWin[i] = w;
      enterOverFence(crowd, i, fp.nx, fp.nz, fp.fd, !!w);
      fenceTop[i] = Number.isFinite(p.top) ? p.top : 1.2;
    }
  }

  function chooseSpawn(candidate, minDist) {
    const pp = playerPos();
    if (!(minDist > 0)) return pickSpawn(spawnPoints(), candidate, pp[0], pp[2], view(), rng);
    // an early round's minimum distance (tuning.round.ease) outranks staying out of view: a point
    // that far, out of view if there is one, else in view (it climbs in at the edge of the lot), else
    // the usual pick
    const p = pickSpawn(spawnPoints(), candidate, pp[0], pp[2], view(), rng, minDist);
    const far = (q) => q && Math.hypot(pointX(q) - pp[0], pointZ(q) - pp[2]) >= minDist;
    if (far(p)) return p;
    if (far(candidate)) return candidate;
    const pts = spawnPoints() || [];
    for (let k = 0; k < pts.length; k++) if (far(pts[k])) return pts[k];
    return p;
  }
  // for moving a zombie already in play (stuck respawn, relocation): a point out of view, or null
  // (the caller waits and tries again) rather than one the player is looking at
  function chooseHidden(nearer = Infinity) {
    const pp = playerPos();
    return pickHidden(spawnPoints(), pp[0], pp[2], view(), rng, 8, nearer);
  }

  function spawn(point, opts = {}) {
    if (crowd.count >= CAP) return null;
    const t = now();
    const cand = point && (point.pos || Array.isArray(point) || point.x !== undefined) ? point : null;
    const p = opts.exact && cand ? cand : chooseSpawn(cand, opts.minDist);
    if (!p) return null;
    const x = pointX(p), z = pointZ(p);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    // the type: asked for, else the one the round director is spawning (a spawn callback that does
    // not pass it on), else a walker
    const asked = opts.type ?? (G.game && G.game.director && G.game.director.pendingType);
    const type = isType(asked) ? asked : 'walker';
    const def = typeDef(type);
    let speed = rng.range(def.speed[0], def.speed[1]);
    // opts.slow (round 1's easing): a walker keeps to the bottom fifth of its speed range
    if (opts.slow && type === 'walker') speed = def.speed[0] + (speed - def.speed[0]) * 0.2;
    const i = addAgent(crowd, x, z, 0, speed, t);
    if (i < 0) return null;
    setAgentType(crowd, i, def);
    const id = nextId++;
    const b = bodies.length ? acquireBody(bodyKind(type)) : null;
    slotBody[i] = b;
    if (b) {
      b.slot = i;
      for (const part of PARTS) b.z.setBlood && b.z.setBlood(part, 0);
      b.z.mesh.visible = true;
      b.z.mesh.castShadow = true; // a reused corpse had it switched off
    }
    const round = opts.round ?? (G.game && G.game.round) ?? 1;
    const base = Number.isFinite(opts.health) ? opts.health : Math.round(W.health(Math.max(1, round)));
    const health = Math.max(1, Math.round(base * T.healthScale(type, Math.max(1, round))));
    const lost = b && b.z.look && b.z.look.severed; // a body built missing an arm ('L' | 'R')
    const rec = {
      id, pos: { x, y: 0, z }, state: 'walk', health, maxHealth: health, type, alive: true, speed: crowd.speed[i],
      layer: 0, crawling: false, limbs: { head: true, armL: lost !== 'L', armR: lost !== 'R', legL: true, legR: true }, lured: false,
      // One-Tap does not kill it: a weapon that reads this passes its real damage instead of health + 1
      oneTapImmune: !!def.oneTapImmune,
    };
    recs[i] = rec;
    byId.set(id, i);
    for (let k = 0; k < 4; k++) limbDmg[i * 4 + k] = 0;
    stunT[i] = 0; cutT[i] = 0; linkT[i] = 0; strayT[i] = 0;
    placeAt(i, p, t);
    list.push(rec);
    stats.spawned++;
    emit('zombie:spawn', { id, pos: [x, crowd.y[i], z], type });
    return id;
  }

  function dropFromList(rec) {
    const k = list.indexOf(rec);
    if (k >= 0) list.splice(k, 1);
    byId.delete(rec.id);
  }

  // a zombie leaves play without dying
  function removeSlot(i, announce) {
    const rec = recs[i];
    if (!rec) return;
    rec.alive = false;
    dropFromList(rec);
    releaseWindow(i);
    removeAgent(crowd, i);
    if (slotBody[i]) releaseBody(slotBody[i]);
    recs[i] = null; slotBody[i] = null; slotAnim[i] = null;
    if (announce) { stats.removed++; emit('zombie:remove', { id: rec.id }); }
  }

  // ---- bloater clouds ------------------------------------------------------------------------------
  const cloudPool = [];
  for (let k = 0; k < MAX_CLOUDS; k++) cloudPool.push({ x: 0, y: 0, z: 0, t: 0, exposure: 0, id: 0 });
  const clouds = [];
  function addCloud(id, x, y, z) {
    const B = T.types.bloater.burst;
    let c = null;
    for (const q of cloudPool) if (q.t <= 0) { c = q; break; }
    if (!c) c = clouds.shift(); // all in use: the oldest goes
    c.x = x; c.y = y; c.z = z; c.t = B.seconds; c.exposure = 0; c.id = id;
    clouds.push(c);
    stats.bursts++;
    emit('zombie:burst', { id, pos: { x, y, z } });
  }
  function updateClouds(dt, pp, pAlive) {
    const B = T.types.bloater.burst;
    for (let k = clouds.length - 1; k >= 0; k--) {
      const c = clouds[k];
      c.t -= dt;
      const dx = pp[0] - c.x, dz = pp[2] - c.z;
      const d = Math.hypot(dx, dz);
      if (pAlive && d <= B.radius && Math.abs(pp[1] - c.y) <= AI.maxDy) {
        c.exposure += dt;
        while (c.exposure >= B.tick - 1e-9) {
          c.exposure -= B.tick;
          if (G.player && typeof G.player.damage === 'function') G.player.damage(B.dps * B.tick, d > 1e-3 ? [-dx / d, 0, -dz / d] : null);
        }
      }
      if (c.t <= 0) { c.t = 0; clouds.splice(k, 1); }
    }
  }

  // ---- damage, limbs, death ------------------------------------------------------------------------
  function severPart(i, part) {
    const rec = recs[i];
    if (!rec || !rec.limbs[part]) return false;
    rec.limbs[part] = false;
    const z = bodyFor(i);
    if (z && typeof z.sever === 'function') z.sever(part);
    stats.severed++;
    emit('zombie:sever', { id: rec.id, part, pos: { x: crowd.x[i], y: crowd.y[i], z: crowd.z[i] } });
    if ((part === 'legL' || part === 'legR') && !rec.crawling) {
      // no legs: it crawls, slow and low, and bites at short range (no slam from the floor)
      rec.crawling = true;
      rec.speed = crowd.speed[i] = T.crawler.speed;
      crowd.reach[i] = T.crawler.reach;
      crowd.slamEvery[i] = 0;
    }
    return true;
  }

  function kill(i, dir, headshot, amount, cause) {
    const rec = recs[i];
    rec.health = 0; rec.alive = false; rec.state = 'dead';
    const x = crowd.x[i], y = crowd.y[i], z = crowd.z[i];
    const a = slotAnim[i];
    if (rec.type === 'bloater') {
      addCloud(rec.id, x, y, z);
      if (a && cause === 'burst' && animState(a, 'burst') === 'burst') a.set('burst'); // the burst clip; else it falls
    }
    const impulse = Math.min(1.5, Math.max(0.6, (amount || 40) / 40));
    if (a && a.state !== 'dead' && a.state !== 'burst') a.collapse(dir, impulse);
    stats.killed++;
    emit('zombie:die', cause ? { id: rec.id, pos: [x, y, z], headshot: !!headshot, type: rec.type, cause } : { id: rec.id, pos: [x, y, z], headshot: !!headshot, type: rec.type });
    dropFromList(rec);
    releaseWindow(i);
    removeAgent(crowd, i);
    const b = slotBody[i];
    deadId[deadAt] = rec.id; deadBody[deadAt] = b; deadAt = (deadAt + 1) % RECENT;
    if (b) {
      b.slot = -1; b.corpse = true; b.sinkT = -1;
      corpses.push(b);
      while (corpses.length > CORPSES) { const old = corpses.shift(); old.corpse = false; old.sinkT = 0; sinking.push(old); }
    }
    recs[i] = null; slotBody[i] = null; slotAnim[i] = null;
  }

  function damage(id, amount, part = 'torso', dir) {
    const i = byId.get(id);
    if (i === undefined || !recs[i] || !(amount > 0)) return { killed: false, damage: 0, headshot: false };
    const rec = recs[i];
    const def = typeDef(rec.type);
    // One-Tap passes health + 1 (or a huge number) and the real damage is lost: the brute takes the held
    // weapon's base damage instead. A weapon that honours rec.oneTapImmune passes its real damage
    // (pellets, upgrade, a frag's blast), which is taken as it comes.
    if (def.oneTapImmune && G.weapon && G.weapon.mods && G.weapon.mods.instantKill && (amount === rec.health + 1 || amount >= 1e9)) {
      const d = G.weapon.def && G.weapon.def.damage;
      amount = Math.min(amount, Number.isFinite(d) && d > 0 ? d : W.attack);
    }
    const headshot = part === 'head';
    const dmg = amount * partScale(rec.type, part, dir, crowd.yaw[i]);
    rec.health -= dmg;
    const z = bodyFor(i), a = slotAnim[i];
    if (z && z.setBlood && PARTS.includes(part)) z.setBlood(part, Math.min(1, (z.getBlood ? z.getBlood(part) : 0) + 0.3 + dmg / 300));
    let severed;
    const li = LIMB[part];
    if (li !== undefined && rec.limbs[part]) {
      limbDmg[i * 4 + li] += dmg;
      if (limbDmg[i * 4 + li] >= (li < 2 ? T.limbs.arm : T.limbs.leg) * rec.maxHealth - 1e-9 && severPart(i, part)) severed = part;
    }
    if (rec.health <= 0) {
      if (headshot && dmg >= T.limbs.head * rec.maxHealth - 1e-9 && severPart(i, 'head')) severed = severed || 'head';
      kill(i, dir, headshot, dmg);
      return severed ? { killed: true, damage: dmg, headshot, severed } : { killed: true, damage: dmg, headshot };
    }
    // a brute shrugs off bullets: it is staggered only by explosions and close shotgun blasts (hit:zombie)
    if (a && !def.shotgunStagger) a.hitReact(part, dir);
    return severed ? { killed: false, damage: dmg, headshot, severed } : { killed: false, damage: dmg, headshot };
  }

  function stagger(i, dir) {
    const a = slotAnim[i];
    if (!a) return;
    if (crowd.state[i] === WINDUP) { crowd.state[i] = RECOVER; crowd.timer[i] = 0; crowd.cool[i] = crowd.coolT[i] || W.cooldown; }
    a.set('stagger', { dir, part: 'torso' });
  }

  // Thrown back and staggered (Jump Start): moved by push ({x,z} m, kept out of walls),
  // stopped for `seconds`, any wind-up lost. The brute is staggered only by blasts and close shotgun
  // fire, so it ignores this. Returns whether it took it.
  function staggerById(id, push, seconds = 0.8) {
    const i = byId.get(id);
    if (i === undefined || !recs[i] || typeDef(recs[i].type).shotgunStagger) return false;
    const st = crowd.state[i];
    if (st !== CHASE && st !== WINDUP && st !== RECOVER && st !== FUSE) return false;
    if (push) {
      const px = push.x ?? push[0], pz = push.z ?? push[2];
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        let x = crowd.x[i], z = crowd.z[i];
        const n = Math.max(1, Math.ceil(Math.hypot(px, pz) / 0.2)), obs = getObstacles();
        for (let k = 0; k < n; k++) {
          x += px / n; z += pz / n;
          if (obs && obs.push(x, z, AI.radius, crowd.y[i])) { x = obs.out[0]; z = obs.out[1]; }
        }
        crowd.x[i] = x; crowd.z[i] = z;
        recs[i].pos.x = x; recs[i].pos.z = z;
        syncMesh(i);
      }
    }
    stagger(i, push ? [push.x ?? push[0], 0, push.z ?? push[2]] : null);
    stunT[i] = Math.max(stunT[i], seconds);
    return true;
  }

  // What only the hit report says (source, weapon): the brute's staggers, and the limbs a killing
  // blast takes. Emitted by the weapon right after damage() for the same id.
  function onHit(e) {
    if (!e) return;
    const i = byId.get(e.id);
    if (i !== undefined && recs[i] && !e.killed) {
      const def = typeDef(recs[i].type);
      if (def.shotgunStagger) {
        const W8 = tuning.weapons && tuning.weapons.table && tuning.weapons.table[e.weapon];
        const pp = playerPos();
        const close = Math.hypot(pp[0] - crowd.x[i], pp[2] - crowd.z[i]) <= def.shotgunStagger;
        if (e.source === 'explosion' || (W8 && W8.cls === 'shotgun' && close)) stagger(i, e.dir);
      }
      return;
    }
    if (e.killed && e.source === 'explosion') {
      let b = null;
      for (let k = 0; k < RECENT; k++) if (deadId[k] === e.id) { b = deadBody[k]; deadId[k] = -1; break; }
      if (!b) return;
      const limbs = LIMBS_TMP; limbs.armL = limbs.armR = limbs.legL = limbs.legR = true;
      if (b.z.severed) for (const p of ['armL', 'armR', 'legL', 'legR']) if (b.z.severed.has(p)) limbs[p] = false;
      for (const p of explosionLimbs(limbRng, limbs, PICK)) {
        if (typeof b.z.sever === 'function') b.z.sever(p);
        stats.severed++;
        const pos = b.z.mesh && b.z.mesh.position;
        emit('zombie:sever', { id: e.id, part: p, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : e.pos });
      }
    }
  }
  const LIMBS_TMP = { armL: true, armR: true, legL: true, legR: true };
  const PICK = [];
  if (G.events && typeof G.events.on === 'function') G.events.on('hit:zombie', onHit);

  // The ray (from the origin, unit dir) against a vertical cylinder of radius r from y0 to y0 + h at
  // (cx, cz), all relative to the origin; an origin inside it, looking inward, hits at 0. The part is
  // 'head' only when the ray passes through the body's head (its head hitbox's sphere), else 'torso'.
  const CLOSE = 1.0;
  function closeHit(body, cx, y0, cz, r, h, dx, dy, dz, ox, oy, oz, maxDist) {
    const a = dx * dx + dz * dz;
    const b = -(cx * dx + cz * dz), c = cx * cx + cz * cz - r * r;
    let t;
    if (c <= 0) { if (b >= 0) return null; t = 0; }
    else {
      if (a < 1e-9) return null;
      const disc = b * b - a * c;
      if (disc < 0) return null;
      t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) return null;
    }
    let y = dy * t;
    if (y > y0 + h && dy < 0) {
      // above the side where it enters: through the top, if the ray comes down inside it
      t = (y0 + h) / dy;
      const qx = dx * t - cx, qz = dz * t - cz;
      if (qx * qx + qz * qz > r * r) return null;
      y = y0 + h;
    }
    if (t > maxDist || y < y0 || y > y0 + h) return null;
    return { part: rayHitsHead(body, ox, oy, oz, dx, dy, dz) ? 'head' : 'torso', dist: t, pos: [ox + dx * t, oy + y, oz + dz * t] };
  }
  // Does the ray pass within the body's head hitbox (a sphere of its radius plus half its length
  // round its centre, placed by its bone)? A severed head is not there.
  function rayHitsHead(body, ox, oy, oz, dx, dy, dz) {
    const hb = body && body.hitboxes;
    if (!hb) return false;
    for (let k = 0; k < hb.length; k++) {
      const hx = hb[k];
      if (hx.part !== 'head' || !hx.bone || !hx.bone.matrixWorld) continue;
      if (body.pose && body.pose.hide && body.pose.hide[hx.index]) continue;
      const e = hx.bone.matrixWorld.elements;
      const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
      const lx = hx.center[0], ly = hx.center[1], lz = hx.center[2];
      const wx = (e[0] / sx) * lx + (e[4] / sy) * ly + (e[8] / sz) * lz + e[12] - ox;
      const wy = (e[1] / sx) * lx + (e[5] / sy) * ly + (e[9] / sz) * lz + e[13] - oy;
      const wz = (e[2] / sx) * lx + (e[6] / sy) * ly + (e[10] / sz) * lz + e[14] - oz;
      const along = Math.max(0, wx * dx + wy * dy + wz * dz);
      const qx = wx - dx * along, qy = wy - dy * along, qz = wz - dz * along;
      const rr = hx.radius + (hx.halfHeight || 0);
      if (qx * qx + qy * qy + qz * qz <= rr * rr) return true;
    }
    return false;
  }

  // nearest hit on any live zombie's capsules
  function raycast(origin, dir, maxDist = Infinity) {
    const ox = origin.x ?? origin[0], oy = origin.y ?? origin[1], oz = origin.z ?? origin[2];
    const dx = dir.x ?? dir[0], dy = dir.y ?? dir[1], dz = dir.z ?? dir[2];
    let best = null;
    for (let i = 0; i < CAP; i++) {
      if (!recs[i]) continue;
      const z = bodyFor(i);
      if (!z || !z.raycast) continue;
      // broad phase: a 1.3 m sphere around the chest (1.8 m for the brute)
      const R = recs[i].type === 'brute' ? 1.8 : 1.3;
      const cx = crowd.x[i] - ox, cy = crowd.y[i] + 0.95 - oy, cz = crowd.z[i] - oz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < -R || along > maxDist + R) continue;
      const px = cx - dx * along, py = cy - dy * along, pz = cz - dz * along;
      if (px * px + py * py + pz * pz > R * R) continue;
      let h = z.raycast(origin, dir, best ? best.dist : maxDist);
      // at arm's length the lunging body can wrap round the camera, and a ray that starts inside a
      // body's capsules hits none of them: there the zombie's column is hit instead (standing: 0.3 m
      // round its feet, 1.8 m tall; a crawler: 0.4 m round, 0.6 m tall)
      if (!h && cx * cx + cz * cz < CLOSE * CLOSE) {
        const low = recs[i].crawling;
        h = closeHit(z, cx, crowd.y[i] - oy, cz, low ? 0.4 : 0.3, low ? 0.6 : 1.8, dx, dy, dz, ox, oy, oz, best ? best.dist : maxDist);
      }
      if (h && (!best || h.dist < best.dist)) best = { id: recs[i].id, part: h.part, pos: h.pos, dist: h.dist };
    }
    return best;
  }

  // ---- decoy lure ------------------------------------------------------------------------------------
  const lure = { on: false, x: 0, y: 0, z: 0, t: 0, radius: T.lure.radius };
  let lureField = null, lureGrid = null;
  function setLure(pos, seconds, radius) {
    const x = pos ? pos.x ?? pos[0] : NaN, y = pos ? pos.y ?? pos[1] : 0, z = pos ? pos.z ?? pos[2] : NaN;
    if (!pos || !(seconds > 0) || !Number.isFinite(x) || !Number.isFinite(z)) {
      lure.on = false; lure.t = 0;
      for (let i = 0; i < CAP; i++) if (recs[i]) { crowd.lure[i] = 0; recs[i].lured = false; crowd.next[i] = 0; }
      return;
    }
    lure.on = true; lure.x = x; lure.y = Number.isFinite(y) ? y : 0; lure.z = z; lure.t = seconds;
    lure.radius = Number.isFinite(radius) && radius > 0 ? radius : T.lure.radius;
    const g = G.nav && G.nav.grid;
    if (g && typeof g.index3 === 'function') {
      if (!lureField || lureGrid !== g) { lureField = createFlowField(g); lureGrid = g; }
      lureField.setTarget(x, z, lure.y);
    } else lureField = null;
    for (let i = 0; i < CAP; i++) {
      if (!recs[i]) continue;
      const on = Math.hypot(crowd.x[i] - x, crowd.z[i] - z) <= lure.radius;
      crowd.lure[i] = on ? 1 : 0; recs[i].lured = on;
      crowd.next[i] = 0; // ask the field again now
    }
  }
  function refreshLureField() { if (lure.on && lureField) lureField.invalidate(); }
  if (G.events && typeof G.events.on === 'function') {
    G.events.on('door:open', refreshLureField);
    G.events.on('board:break', (e) => { if (e && e.left === 0) refreshLureField(); });
    G.events.on('board:repair', (e) => { if (e && e.left === 1) refreshLureField(); });
  }

  function clear() {
    for (let i = 0; i < CAP; i++) if (recs[i]) removeSlot(i, false);
    for (const b of corpses) releaseBody(b);
    for (const b of sinking) releaseBody(b);
    corpses.length = 0; sinking.length = 0;
    list.length = 0; byId.clear(); winOcc.clear();
    clouds.length = 0;
    for (const c of cloudPool) c.t = 0;
    lure.on = false; lure.t = 0;
    deadId.fill(-1); deadBody.fill(null);
    respawnAt.fill(0); strayT.fill(0); strag.t = 0; strag.next = 0;
  }

  // ---- staged zombies for shots (?spawn=<n>, ?ztype=<type>) -------------------------------------------
  let staged = !(G.params && G.params.spawn > 0);
  function placeStaged() {
    staged = true;
    const n = Math.min(CAP, Math.floor(G.params.spawn));
    const shots = (G.level && G.level.shots) || {};
    const named = G.params.shot && shots[G.params.shot];
    let cam = (G.shotCam && G.shotCam.cam) || (named && named.cam);
    const atCamera = !!cam;
    if (!cam) {
      const s = n <= 3 ? shots['zombies-near'] : shots['zombies-far'];
      cam = s && s.cam;
    }
    let ex, ez, yaw;
    if (cam) { ex = cam[0]; ez = cam[2]; yaw = cam[3]; } else {
      const ps = (G.level && G.level.playerStart) || { pos: [0, 0, 0], yaw: 0 };
      ex = ps.pos[0]; ez = ps.pos[2]; yaw = ps.yaw || 0;
    }
    // yaw 0 looks down -Z, +yaw turns left
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const layout = n <= 3 ? NEAR : FAR;
    const obs = getObstacles();
    const t = now();
    // shrink the layout to stay inside the lot (G.level.playable, when the level has it) and this
    // side of the first wall, car or fence straight ahead
    const pl = G.level && G.level.playable;
    const inside = (x, z) => !pl || (x > pl.min[0] + 1 && x < pl.max[0] - 1 && z > pl.min[2] + 1 && z < pl.max[2] - 1);
    const deepest = Math.max(...layout.map((q) => q[1]));
    let clear = 1;
    while (clear < deepest + 1 && inside(ex + fx * clear, ez + fz * clear) && !(obs && obs.push(ex + fx * clear, ez + fz * clear, AI.radius))) clear += 0.25;
    const fit = Math.max(0.35, Math.min(1, (clear - 1) / deepest));
    const type = G.params.ztype && isType(G.params.ztype) ? G.params.ztype : undefined;
    for (let k = 0; k < n; k++) {
      const [r, f] = k < layout.length ? layout[k] : [((k % 6) - 2.5) * 1.6, 8 + Math.floor(k / 6) * 4];
      let x = ex + (rx * r + fx * f) * fit, z = ez + (rz * r + fz * f) * fit;
      if (pl) { x = Math.min(Math.max(x, pl.min[0] + 1), pl.max[0] - 1); z = Math.min(Math.max(z, pl.min[2] + 1), pl.max[2] - 1); }
      if (obs && obs.push(x, z, AI.radius)) { x = obs.out[0]; z = obs.out[1]; }
      // a horde (the far layout) keeps STAGED_GAP from the camera: never in its face, never in it
      const ox = x - ex, oz = z - ez, od = Math.hypot(ox, oz);
      if (layout === FAR && od < STAGED_GAP) {
        const k = od > 1e-3 ? STAGED_GAP / od : 0;
        x = od > 1e-3 ? ex + ox * k : ex + fx * STAGED_GAP; z = od > 1e-3 ? ez + oz * k : ez + fz * STAGED_GAP;
      }
      const id = spawn([x, 0, z], { exact: true, type });
      if (id === null) break;
      const i = byId.get(id);
      placeAgent(crowd, i, x, z, Math.atan2(ex - x, ez - z), t);
      if (atCamera && layout === FAR) {
        // the horde holds the mid-ground, facing the camera: its target is a hair in front of where it
        // stands (inside the stop distance), so it turns to the camera and stays put instead of
        // walking into the lens and being shoved into it by the ones behind
        const d = Math.hypot(ex - x, ez - z) || 1;
        crowd.custom[i] = 1; crowd.tx[i] = x + ((ex - x) / d) * 0.05; crowd.tz[i] = z + ((ez - z) / d) * 0.05;
      } else if (atCamera) { crowd.custom[i] = 1; crowd.tx[i] = ex; crowd.tz[i] = ez; }
      syncMesh(i);
      newAnimator(i).set(animState(slotAnim[i], gaitOf(i)), { target: [ex, 1.5, ez] });
    }
  }
  // ---- hooks from the AI -------------------------------------------------------------------------
  let pNow = [0, 0, 0];
  const hooks = {
    attackStart(i, kind) {
      const a = slotAnim[i];
      if (a) {
        // a swing is aimed where a moving player will be when the blow lands
        const ahead = kind === 1 ? 0 : env.swing * (crowd.windup[i] || W.windup);
        TGT[0] = pNow[0] + env.pvx * ahead; TGT[1] = pNow[1] + 1.3; TGT[2] = pNow[2] + env.pvz * ahead;
        a.set(animState(a, kind === 1 ? 'slam' : 'attack'), OPTS); tgtX[i] = TGT[0]; tgtZ[i] = TGT[2];
      }
      if (recs[i]) recs[i].state = 'attack';
      emit('zombie:attack', { id: recs[i].id, pos: [crowd.x[i], crowd.y[i] + 1.4, crowd.z[i]], type: recs[i].type, kind: kind === 1 ? 'slam' : 'swing' });
    },
    attackEnd(i, landed, dx, dz, kind) {
      if (!landed || !G.player || typeof G.player.damage !== 'function') return;
      const rec = recs[i];
      let amount;
      if (kind === 1) amount = typeDef(rec.type).slam.damage;
      else amount = attackDamage(rec.type, rec.crawling, (rec.limbs.armL ? 0 : 1) + (rec.limbs.armR ? 0 : 1));
      if (amount > 0) G.player.damage(amount, [dx, 0, dz]);
    },
    climb(i) {
      const a = slotAnim[i];
      const w = slotWin[i];
      if (w) winOcc.set(w.id, i);
      const gap = Math.max(0.1, crowd.fd[i] - (crowd.fnx[i] * crowd.x[i] + crowd.fnz[i] * crowd.z[i]));
      if (a) a.set(animState(a, w ? 'window' : 'climb'), { height: fenceTop[i], distance: gap, sill: fenceTop[i], depth: gap });
    },
    stuck(i) {
      if (respawnAt[i] > 0) return; // already waiting for a point out of view
      const p = chooseHidden();
      stats.stuck++;
      // where it gave up, for debugging (the last 16; allocates only when the guard fires)
      if (stuckLog.length >= 16) stuckLog.shift();
      stuckLog.push({ id: recs[i].id, type: recs[i].type, x: +crowd.x[i].toFixed(2), y: +crowd.y[i].toFixed(2), z: +crowd.z[i].toFixed(2), layer: crowd.layer[i], pathD: +crowd.pathD[i].toFixed(1), t: +env.t.toFixed(1) });
      // every point in view (or none): wait where it is and try again each second
      if (!p) { respawnAt[i] = now() + T.respawnRetry; return; }
      placeAt(i, p, now());
    },
    // a climb left on the timeout: the animator is put back in its gait
    climbEnd(i) {
      const a = slotAnim[i];
      if (a) a.set(animState(a, gaitOf(i)));
    },
    // windows: claim it (one at a time), how many boards are left, tear one
    claim(i) {
      const w = slotWin[i];
      if (!w) return true;
      const o = winOcc.get(w.id);
      if (o !== undefined && o !== i && recs[o]) return false;
      winOcc.set(w.id, i);
      return true;
    },
    boards(i) { const w = slotWin[i]; return w ? w.boards : 0; },
    // does the line from agent i to the player cross the plane of its window inside the opening?
    through(i, px, pz) {
      const w = slotWin[i];
      if (!w || !w.pos || !w.normal) return false;
      const nx = w.normal[0], nz = w.normal[2];
      const x = crowd.x[i], z = crowd.z[i];
      const da = (x - w.pos[0]) * nx + (z - w.pos[2]) * nz, db = (px - w.pos[0]) * nx + (pz - w.pos[2]) * nz;
      if (da === db) return Math.abs((x - w.pos[0]) * nz - (z - w.pos[2]) * nx) <= (w.w || 1) / 2;
      const k = Math.min(1, Math.max(0, da / (da - db)));
      const cx = x + (px - x) * k - w.pos[0], cz = z + (pz - z) * k - w.pos[2];
      return Math.abs(cx * nz - cz * nx) <= (w.w || 1) / 2;
    },
    tearStart(i) {
      const a = slotAnim[i];
      const w = slotWin[i];
      if (a && w) { TGT[0] = w.pos[0]; TGT[1] = w.pos[1]; TGT[2] = w.pos[2]; a.set(animState(a, 'tear'), OPTS); }
      if (recs[i]) recs[i].state = 'tear';
    },
    tear(i) {
      const w = slotWin[i];
      if (!w) return 0;
      const left = G.level && typeof G.level.tearBoard === 'function' ? G.level.tearBoard(w.id) : 0;
      const a = slotAnim[i];
      if (a && left > 0 && a.done) { TGT[0] = w.pos[0]; TGT[1] = w.pos[1]; TGT[2] = w.pos[2]; a.set(animState(a, 'tear'), OPTS); }
      return left > 0 ? left : 0;
    },
    fuse(i) {
      const a = slotAnim[i];
      if (a) a.set(animState(a, 'burst'), NOOPTS);
    },
    burst(i) { kill(i, null, false, 0, 'burst'); },
  };

  // ---- frame -------------------------------------------------------------------------------------
  const env = {
    t: 0, px: 0, py: 0, pz: 0, pAlive: true, field: null, tune: W, hooks, obstacles: null,
    lureField: null, lx: 0, ly: 0, lz: 0, tearEvery: (tuning.world && tuning.world.boards && tuning.world.boards.tearEvery) || 0.9,
    climbMax: T.climbMax, breachBoards: T.breachBoards, pvx: 0, pvz: 0, swing: 1,
  };
  // the player's velocity (m/s) from its movement, smoothed over about 0.1 s; a jump of more than
  // PV_MAX m/s (a respawn, a teleport) reads as standing still
  const PV_MAX = 12;
  let lastPx = NaN, lastPz = NaN;
  function trackPlayer(pp, dt) {
    let vx = (pp[0] - lastPx) / dt, vz = (pp[2] - lastPz) / dt;
    if (!(dt > 0) || !(vx * vx + vz * vz <= PV_MAX * PV_MAX)) { vx = 0; vz = 0; }
    const k = Math.min(1, dt / 0.1);
    env.pvx += (vx - env.pvx) * k; env.pvz += (vz - env.pvz) * k;
    lastPx = pp[0]; lastPz = pp[2];
    // the swing's strength this round, less in the first rounds (tuning.zombies.swing)
    const sw = T.swing, byRound = sw && sw.byRound && G.game ? sw.byRound[G.game.round] : undefined;
    env.swing = Number.isFinite(byRound) ? byRound : sw && Number.isFinite(sw.strength) ? sw.strength : 1;
  }
  let relocateT = 0;

  // A zombie cut off from the player (no path at all) is moved to a spawn point the player can reach
  // (spawnPoints() lists only those): at once when it stands in a zone the player cannot reach
  // through open doors, or after AI.stuckTime when others do have a path (it is trapped in a pocket).
  // When nobody has a path (the player stands somewhere unreachable) they gather and stay.
  function zoneActive(zone) {
    const pts = spawnPoints();
    for (let k = 0; k < pts.length; k++) if (pts[k].zone === zone) return true;
    return false;
  }
  function relocateCutOff(every) {
    const zoneAt = G.level && G.level.zoneAt;
    let anyPath = false;
    for (let i = 0; i < CAP; i++) if (recs[i] && crowd.state[i] === CHASE && !crowd.lure[i] && crowd.pathD[i] < Infinity) { anyPath = true; break; }
    for (let i = 0; i < CAP; i++) {
      if (!recs[i] || crowd.state[i] !== CHASE || crowd.lure[i] || crowd.custom[i] || crowd.pathD[i] < Infinity || !env.field) { cutT[i] = 0; continue; }
      const zone = typeof zoneAt === 'function' ? zoneAt(crowd.x[i], crowd.z[i]) : null;
      const away = zone && !zoneActive(zone);
      cutT[i] = anyPath ? cutT[i] + every : 0;
      if (!away && cutT[i] < AI.stuckTime) continue;
      const p = chooseHidden();
      if (!p) continue; // every point in view: next check
      stats.relocated++;
      cutT[i] = 0;
      placeAt(i, p, env.t);
    }
  }

  // the far-mesh distance: the quality tier's (read every frame, so a tier change applies at once)
  let lodFar = LOD_FAR;
  function readLodFar() {
    const q = G.quality && G.quality.zombieLodFar;
    lodFar = Number.isFinite(q) && q > 0 ? q : LOD_FAR;
  }
  // ---- the round's last zombies ---------------------------------------------------------------------
  const S = T.straggler;
  const strag = { t: 0, next: 0 };
  function stragglers() {
    const d = G.game && G.game.director;
    return !!d && d.phase === 'active' && d.total > 0 && d.spawned >= d.total && list.length > 0 && list.length <= S.count;
  }
  function announce(i) {
    emit('round:straggler', { id: recs[i].id, pos: { x: crowd.x[i], y: crowd.y[i], z: crowd.z[i] } });
  }
  function updateStragglers(dt) {
    const on = stragglers();
    if (on) strag.t += dt; else if (strag.t > 0) { strag.t = 0; strayT.fill(0); }
    const late = on && strag.t >= S.after;
    if (late && strag.t >= strag.next) {
      if (strag.next < S.after) strag.next = S.after;
      strag.next += S.every;
      for (let i = 0; i < CAP; i++) if (recs[i]) announce(i);
    } else if (!on) strag.next = 0;
    for (let i = 0; i < CAP; i++) {
      const r = recs[i];
      if (!r) continue;
      // walking stragglers hurry; a crawler keeps its pace
      const want = late && !r.crawling ? r.speed * S.speed : r.speed;
      if (crowd.speed[i] !== want) crowd.speed[i] = want;
      if (!on || !r.crawling) continue;
      strayT[i] += dt;
      if (strayT[i] < S.crawlerAfter || crowd.state[i] !== CHASE || crowd.custom[i]) continue;
      // a crawler left this long: to a breach out of view, nearer the player (never in sight, and not
      // while the player is looking at it); else try again in a second
      const pp = playerPos(), v = view();
      const p = inView(v, crowd.x[i], crowd.z[i]) ? null
        : pickHidden(spawnPoints(), pp[0], pp[2], v, rng, 8, Math.hypot(crowd.x[i] - pp[0], crowd.z[i] - pp[2]));
      if (!p) { strayT[i] = S.crawlerAfter - S.retry; continue; }
      strayT[i] = 0;
      stats.relocated++;
      placeAt(i, p, env.t);
      announce(i);
    }
  }

  function animate1(i, dt, speed) {
    const a = slotAnim[i], z = bodyFor(i);
    let cd = 0;
    if (z && G.camera) cd = Math.hypot(crowd.x[i] - G.camera.position.x, crowd.z[i] - G.camera.position.z);
    if (z && z.setLod) z.setLod(cd > lodFar ? 1 : 0);
    if (z) foldPrepass(z, cd > lodFar && !(G.quality && G.quality.depthPrepass === false));
    a.update(dt, speed, cd);
  }
  // The depth pre-pass twin (body.js, zmats.js) lays a body's depth before its costly program runs with
  // depth writes off. A far body's mesh is one layer deep and a few hundred pixels: there the twin is
  // left out and the body writes its own depth (one skinned draw instead of two, the same pixels).
  // A near body keeps it on every tier: its garments lie a hair over the skin, and without the twin
  // the layers fight for the pixel (seen as speckle on the mobile shots). Not on a tier without
  // pre-passes (mobile): the post chain lists the twins whose body writes depth and hides them, from a
  // list it rebuilds every few seconds, so a body turning near again would lose its twin until then.
  // Draw flags only, switched when the state changes.
  function foldPrepass(z, fold) {
    if (z.prepassFolded === fold) return;
    const mat = z.materials && z.materials.char;
    const ch = z.mesh && z.mesh.children;
    let pre = null;
    if (ch) for (let k = 0; k < ch.length; k++) if (ch[k].name === 'zombie:depth') pre = ch[k];
    if (!pre || !mat) { z.prepassFolded = fold; return; }
    pre.visible = !fold;
    mat.depthWrite = fold;
    z.prepassFolded = fold;
  }

  function updateCorpses(dt) {
    for (const b of corpses) {
      if (!b.anim) continue;
      if (b.anim.settled) {
        // A body lying still is out of every shadow map: flat on the ground its shadow is a rim the
        // ambient occlusion already draws, and it was two or three draws a frame per corpse.
        if (b.z.mesh.castShadow) b.z.mesh.castShadow = false;
        continue;
      }
      const cd = G.camera ? Math.hypot(b.z.mesh.position.x - G.camera.position.x, b.z.mesh.position.z - G.camera.position.z) : 0;
      b.anim.update(dt, 0, cd);
    }
    for (let k = sinking.length - 1; k >= 0; k--) {
      const b = sinking[k];
      b.sinkT += dt;
      // the skin follows the bones, so sink the bones themselves
      const dy = (SINK_DEPTH / SINK_TIME) * dt;
      for (const bone of b.bones) bone.matrixWorld.elements[13] -= dy;
      if (b.sinkT >= SINK_TIME) { sinking.splice(k, 1); releaseBody(b); }
    }
  }

  function busyIn(a) {
    const as = a.state;
    if (as === 'climb' || as === 'window') return 1;
    return (as === 'attack' || as === 'stagger' || as === 'slam' || as === 'tear' || as === 'burst') && !a.done ? 1 : 0;
  }

  function update(dt) {
    if (!staged) placeStaged();
    readLodFar();
    const gs = G.game && G.game.state;
    if (gs === 'paused') return;
    if (gs !== 'playing') {
      // not in play (title, dead): bodies stand idle in place
      for (let i = 0; i < CAP; i++) {
        if (!recs[i]) continue;
        const a = slotAnim[i];
        if (a.state === 'walk' || a.state === 'run' || a.state === 'crawl') a.set('idle');
        syncMesh(i); animate1(i, dt, 0);
      }
      updateCorpses(dt);
      return;
    }
    const t0 = performance.now();
    const pp = playerPos();
    pNow = pp;
    env.t = G.time ? now() : env.t + dt;
    env.px = pp[0]; env.py = Number.isFinite(pp[1]) ? pp[1] : 0; env.pz = pp[2];
    trackPlayer(pp, dt);
    env.pAlive = !(G.player && G.player.alive === false);
    env.field = G.nav && G.nav.field && typeof G.nav.field.dir === 'function' ? G.nav.field : null;
    env.obstacles = getObstacles();
    if (lure.on) {
      lure.t -= dt;
      if (lure.t <= 0) setLure(null, 0);
    }
    env.lureField = lure.on ? lureField : null;
    env.lx = lure.x; env.ly = lure.y; env.lz = lure.z;

    for (let i = 0; i < CAP; i++) {
      if (!recs[i]) continue;
      // a zombie knocked out of the world comes back at a spawn point (or leaves play)
      if (!Number.isFinite(crowd.x[i]) || !Number.isFinite(crowd.z[i])) {
        const p = chooseSpawn(null);
        if (p) { stats.stuck++; placeAt(i, p, env.t); } else { removeSlot(i, true); continue; }
      }
      // a stuck respawn that found every spawn point in view tries again
      if (respawnAt[i] > 0 && env.t >= respawnAt[i]) {
        const p = chooseHidden();
        if (p) placeAt(i, p, env.t); else respawnAt[i] = env.t + T.respawnRetry;
      }
      crowd.busy[i] = busyIn(slotAnim[i]);
      if (stunT[i] > 0) { stunT[i] -= dt; crowd.busy[i] = 1; }
      // waiting behind another at its window
      const w = slotWin[i];
      if (w && crowd.state[i] === ENTER) { const o = winOcc.get(w.id); crowd.wait[i] = o !== undefined && o !== i && recs[o] ? 1 : 0; } else crowd.wait[i] = 0;
    }
    crowdThink(crowd, dt, env);
    let aiMs = performance.now() - t0;

    for (let i = 0; i < CAP; i++) {
      if (!recs[i]) continue;
      const a = slotAnim[i];
      const st = crowd.state[i];
      if (st === CHASE && slotWin[i]) releaseWindow(i);
      if (st === CHASE || st === ENTER) {
        const g = animState(a, gaitOf(i));
        if (a.state === 'idle' || (a.state !== g && a.done)) a.set(g);
      }
      if (st === CHASE && env.t >= tgtT[i] && !crowd.custom[i]) {
        tgtT[i] = env.t + 0.25;
        const d = Math.hypot(pp[0] - crowd.x[i], pp[2] - crowd.z[i]);
        if (d < 6) {
          if (!(Math.hypot(pp[0] - tgtX[i], pp[2] - tgtZ[i]) < 0.25)) {
            TGT[0] = pp[0]; TGT[1] = pp[1] + 1.3; TGT[2] = pp[2];
            a.setTarget(TGT); tgtX[i] = pp[0]; tgtZ[i] = pp[2];
          }
        } else if (!Number.isNaN(tgtX[i])) { a.setTarget(null); tgtX[i] = NaN; tgtZ[i] = NaN; }
      }
      syncMesh(i);
      animate1(i, dt, crowd.want[i]);
      // tearing boards and swelling to burst happen in place, whatever the stand-in clip does
      crowd.root[i] = st === TEAR || st === FUSE || (stunT[i] > 0 && a.state !== 'stagger') || !Number.isFinite(a.rootSpeed) ? 0 : a.rootSpeed;
    }

    const t1 = performance.now();
    crowdMove(crowd, dt, env);
    // feet on the floor under them (the stairs, the walkway), and the nav layer that floor is on
    const hAt = G.level && typeof G.level.heightAt === 'function' ? G.level.heightAt : null;
    const grid = hAt ? layeredGrid() : null;
    for (let i = 0; i < CAP; i++) {
      const rec = recs[i];
      if (!rec) continue;
      if (hAt) {
        // up to AI.stairStep: a body may stand a little inside a stair step's box (see createObstacles)
        const h = hAt(crowd.x[i], crowd.z[i], crowd.y[i] + AI.stairStep - STEP_UP);
        crowd.y[i] = Number.isFinite(h) ? h : 0;
        crowd.layer[i] = grid ? grid.layerAt(crowd.x[i], crowd.y[i], crowd.z[i]) : 0;
      }
      const dy = crowd.y[i] - visY[i];
      visY[i] = Math.abs(dy) > 0.6 ? crowd.y[i] : visY[i] + dy * Math.min(1, dt * 15);
      syncMesh(i);
      rec.pos.x = crowd.x[i]; rec.pos.y = crowd.y[i]; rec.pos.z = crowd.z[i];
      rec.layer = crowd.layer[i];
      rec.state = STATE_NAMES[crowd.state[i]];
    }
    takeLinks(env.t);
    relocateT -= dt;
    if (relocateT <= 0) { relocateT = T.relocateEvery; relocateCutOff(T.relocateEvery); }
    updateStragglers(dt);
    aiMs += performance.now() - t1;
    stats.aiMs += (aiMs - stats.aiMs) * 0.05;
    updateClouds(dt, pp, env.pAlive);
    updateCorpses(dt);
  }

  function bodyOf(id) {
    const i = byId.get(id);
    if (i !== undefined) return bodyFor(i);
    for (let k = 0; k < RECENT; k++) if (deadId[k] === id) return deadBody[k] ? deadBody[k].z : null;
    return null;
  }

  const api = {
    list,
    get alive() { return list.length; },
    spawn,
    raycast,
    damage,
    setLure,
    stagger: staggerById,
    lure,
    clouds,
    bodyOf,
    clear,
    update,
    stats,
    get corpses() { return corpses.length; },
    get bodies() { return bodies.length; },
    // for tests and debugging: internal crowd arrays
    crowd,
  };
  return api;
}
