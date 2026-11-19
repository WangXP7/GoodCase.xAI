// What bleeds, where and how much. The pure planners here decide; createBlood(G) carries
// the decisions out through the fx module's own calls (G.fx.bloodParticles, bloodDecal, gib, blood)
// and the zombie's (addWound, headDamage). Nothing here draws.
//
// Who owns what. The per-hit spray and the small spatter a round leaves behind are the fx module's
// (its hit:zombie handler, particles.js); this module leaves them alone unless createBlood is given
// { hits: true }, in which case it sets G.fx.bloodOwner and lays them from bloodPlan instead. What
// is always this module's: wounds on the body, the headshot burst, bleeding stumps, the corpse's
// pool (it sets G.fx.corpsePools = false), a crawler's smear, and the blood on the player's screen
// (src/ui/bloodScreen.js, installed from here).
//
// Every count is multiplied by the gore level (G.fx.gore: 1 full, 0.3 reduced). Reduced keeps the
// hit feedback (spray, a wound) and drops the burst, the pools, the smears, severing and screen blood.
import { createBloodScreen } from '../ui/bloodScreen.js';
import { SEVER } from '../zombie/sever.js';
import { B } from '../zombie/skeleton.js';

export const BLOOD = {
  pools: 12,            // live corpse pools; the oldest goes when a 13th is asked for
  poolGrow: 6,          // seconds a pool takes to reach its size
  wounds: 8,            // wound slots on a body
  exitReach: 3,         // m: an exit spatter lands on the first surface this close behind the hit
  smearEvery: 0.6,      // m between a dragged body's smears
  maxParticles: 400,    // live blood particles this module may add at 24 zombies under automatic fire
  stumpSeconds: 5,      // a stump runs this long
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// One hit. hit: { part, damage, killed, headshot, source?, pellets? }.
// ctx: { gore (1 | 0.3 | 0), behind (m to the first surface behind the hit along the shot, Infinity
// when there is none), near (m from the shooter), r (a random in [0, 1)) }.
// -> { spray: { count, speed, spread, mist }, decals: [{ kind, size, at: 'behind' | 'ground' }],
//      wound: { radius, kind } | null, burst: boolean }
export function bloodPlan(hit, ctx = {}, out = { spray: { count: 0, speed: 0, spread: 0, mist: 0 }, decals: [], wound: null, burst: false }) {
  const gore = typeof ctx.gore === 'number' ? ctx.gore : 1;
  const part = (hit && hit.part) || 'torso';
  const dmg = Math.max(0, (hit && hit.damage) || 0);
  const r = ctx.r === undefined ? 0.5 : ctx.r;
  const fire = hit && (hit.source === 'fire' || hit.source === 'arc');
  const blast = hit && hit.source === 'explosion';
  const limb = part.startsWith('arm') || part.startsWith('leg');
  const close = (ctx.near === undefined ? 99 : ctx.near) <= 4;
  out.decals.length = 0; out.wound = null; out.burst = false;
  const s = out.spray;
  s.count = 0; s.speed = 0; s.spread = 0; s.mist = 0;
  if (!hit || fire) return out;
  // a graze on a limb is a puff, a chest hit a cone with droplets, a close shotgun a wide burst
  const base = limb ? 5 : part === 'head' ? 12 : 14;
  let count = base + Math.min(30, dmg * 0.3);
  if (hit.pellets > 1 && close) count *= 1.8;
  if (hit.killed) count *= 1.25;
  s.count = Math.floor(count * gore);
  s.speed = limb ? 2.2 : part === 'head' ? 4.5 : 3.4;
  s.spread = hit.pellets > 1 && close ? 0.9 : limb ? 0.25 : 0.45;
  s.mist = limb ? 0 : Math.floor((part === 'head' ? 6 : 3) * gore);
  // through and out: a spatter on the first surface behind, and drops that reach the ground
  if (gore > 0 && !blast) {
    const behind = ctx.behind === undefined ? Infinity : ctx.behind;
    if (behind <= BLOOD.exitReach && !limb) out.decals.push({ kind: 'spatter', size: clamp(0.18 + dmg * 0.003, 0.18, 0.45) * (0.8 + 0.4 * r), at: 'behind' });
    if (gore >= 1 && r < 0.5 && !limb) out.decals.push({ kind: 'drip', size: 0.08 + 0.06 * r, at: 'ground' });
  }
  // the wound stays under reduced gore: it is where the hit landed
  out.wound = blast ? { radius: 0.07, kind: 'blast' } : { radius: clamp(0.028 + dmg * 0.00012, 0.028, 0.05) * (hit.pellets > 1 ? 1.25 : 1), kind: 'bullet' };
  out.burst = !!(hit.killed && (hit.headshot || part === 'head') && gore >= 1);
  return out;
}

// The headshot burst: counts for the mist, the fragments and the fan of spatter behind.
export function burstPlan(gore, r = 0.5, out = { mist: 0, spray: 0, chunks: 0, fan: 0 }) {
  const on = gore >= 1;
  out.mist = on ? 14 : 0; out.spray = on ? 22 : 0; out.chunks = on ? 1 : 0; out.fan = on ? 2 + (r < 0.5 ? 1 : 0) : 0;
  return out;
}

// Which wound slot a new wound takes on a body already carrying `carried` of this module's wounds
// (the wounds it was built with are not counted and are never replaced): the oldest once all are used.
export function woundSlot(carried, built = 0, max = BLOOD.wounds) {
  const free = Math.max(1, max - built);
  return built + (carried % free);
}

// Corpse pools: one per corpse, BLOOD.pools alive, the oldest retired for a new one.
export function createPoolRing(max = BLOOD.pools) {
  const ids = new Array(max).fill(null), slots = new Int32Array(max).fill(-1);
  let at = 0, live = 0;
  const res = { added: false, retired: null, retiredSlot: -1, index: -1 };
  return {
    get live() { return live; },
    has(id) { return ids.includes(id); },
    // -> { added, retired (the id whose pool goes), retiredSlot (its decal slot), index }
    add(id) {
      res.added = false; res.retired = null; res.retiredSlot = -1; res.index = -1;
      if (id === null || id === undefined || ids.includes(id)) return res;
      if (ids[at] !== null) { res.retired = ids[at]; res.retiredSlot = slots[at]; } else live++;
      ids[at] = id; slots[at] = -1; res.index = at; res.added = true;
      at = (at + 1) % max;
      return res;
    },
    setSlot(index, slot) { if (index >= 0 && index < max) slots[index] = slot; },
    clear() { ids.fill(null); slots.fill(-1); at = 0; live = 0; },
  };
}

// The decal share: however many hits ask, no more than `share` blood decals are ever live; past it
// each new one replaces the oldest (the fx ring does the same, so the two agree).
export function createDecalBudget(share) {
  let live = 0, asked = 0;
  return {
    get live() { return live; },
    get asked() { return asked; },
    share,
    take(n = 1) { asked += n; live = Math.min(this.share, live + n); return live; },
    reset() { live = 0; asked = 0; },
  };
}

// The pool under a corpse: metres across, by what killed it and the body's size.
export function poolSize(gore, { headshot = false, burst = false, big = false, r = 0.5 } = {}) {
  if (!(gore >= 1)) return 0;
  return (burst ? 2.4 : headshot ? 1.8 : 1.5) * (big ? 1.35 : 1) * (0.85 + 0.3 * r);
}

// Blood on the player's screen for one hit. angle: where the hit came from relative to the facing
// (radians, 0 ahead, + to the right; null = unknown). o: { gore, touch, reducedMotion, hurt (0..1:
// how much health is gone), r(): a random in [0, 1) }.
// -> { pulse (a plain red edge pulse instead of blood), drops: [{ x, y, r, streak, alpha }] } with
// x, y in screen fractions (0..1 from the left / top) and r, streak in fractions of the height.
// Nothing is ever put over the middle fifth of the screen.
export function screenPlan(angle, o = {}, out = { pulse: false, drops: [] }) {
  const rnd = o.r || (() => 0.5);
  out.drops.length = 0;
  out.pulse = !(o.gore >= 1) || !!o.reducedMotion;
  if (out.pulse) return out;
  const hurt = clamp(o.hurt || 0, 0, 1);
  const n = o.touch ? 3 : 5 + Math.round(4 * hurt) + (rnd() < 0.5 ? 1 : 0);
  const sn = angle === null || angle === undefined ? 0 : Math.sin(angle), cs = angle === null || angle === undefined ? 1 : Math.cos(angle);
  const side = sn < -0.38 ? -1 : sn > 0.38 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    let x, y;
    if (side) {
      x = side < 0 ? 0.015 + 0.24 * rnd() * rnd() : 0.985 - 0.24 * rnd() * rnd();
      y = o.touch ? 0.1 + 0.38 * rnd() : 0.12 + 0.66 * rnd();
    } else if (cs >= 0) {
      // from ahead: both edges
      x = i % 2 ? 0.02 + 0.17 * rnd() * rnd() : 0.98 - 0.17 * rnd() * rnd();
      y = o.touch ? 0.1 + 0.38 * rnd() : 0.15 + 0.6 * rnd();
    } else {
      // from behind: along the bottom (the top on touch, where there are no controls), clear of the middle
      x = rnd() < 0.5 ? 0.05 + 0.3 * rnd() : 0.95 - 0.3 * rnd();
      y = o.touch ? 0.04 + 0.12 * rnd() : 0.8 + 0.14 * rnd();
    }
    const rad = (0.008 + 0.02 * rnd() * rnd()) * (1 + 0.6 * hurt) * (o.touch ? 0.8 : 1);
    out.drops.push({ x, y, r: rad, streak: i === 0 || rnd() < 0.4 ? 0.07 + 0.14 * rnd() : 0, alpha: (o.touch ? 0.5 : 0.85) * (0.75 + 0.25 * rnd()) });
  }
  return out;
}

// ---- carrying it out -----------------------------------------------------------------------------
const STUMP_BONE = { head: 'head', armL: 'foreArmL', armR: 'foreArmR', legL: 'shinL', legR: 'shinR' };
const UP = [0, 1, 0], DOWN = [0, -1, 0];

// gore: the zombie-side module (src/zombie/gore.js). opts.hits: also own the per-hit spray and spatter.
export function createBlood(G, gore, opts = {}) {
  const fx = () => G.fx;
  const level = () => gore.level();
  const rng = G.rng && typeof G.rng.fork === 'function' ? G.rng.fork('blood') : { next: () => 0.5 };
  const pools = createPoolRing(BLOOD.pools);
  const plan = bloodPlan(null, {});
  const burst = burstPlan(0);
  const P = [0, 0, 0], D = [0, 0, 0], Q = [0, 0, 0], N = [0, 0, 0];
  const now = () => (G.time ? G.time.sim ?? G.time.t ?? 0 : 0);
  const ownHits = !!opts.hits;
  if (G.fx) { G.fx.corpsePools = false; if (ownHits) G.fx.bloodOwner = true; }
  const emit = (name, payload) => G.events && G.events.emit(name, payload);
  const set3 = (o, v) => { o[0] = v.x ?? v[0] ?? 0; o[1] = v.y ?? v[1] ?? 0; o[2] = v.z ?? v[2] ?? 0; return o; };
  const bonePos = (z, name, o) => { const b = z.bones && z.bones[name]; if (!b) return null; const e = b.matrixWorld.elements; o[0] = e[12]; o[1] = e[13]; o[2] = e[14]; return o; };
  const floorAt = (x, y, z) => (G.level && typeof G.level.heightAt === 'function' ? G.level.heightAt(x, z, y + 0.3) : 0);
  const decal = (pos, normal, o) => (fx() && typeof fx().bloodDecal === 'function' ? fx().bloodDecal(pos, normal, o) : -1);
  const parts = (kind, pos, dir, n, speed) => { if (n > 0 && fx() && typeof fx().bloodParticles === 'function') fx().bloodParticles(kind, pos, dir, n, speed); };
  const DEC = { kind: 'spatter', size: 0.3, grow: 0, dir: null };

  // a spatter on whatever is behind the hit along the shot, within reach
  function behindOf(pos, dir, reach) {
    if (!G.level || typeof G.level.raycast !== 'function') return null;
    Q[0] = pos[0] + dir[0] * 0.25; Q[1] = pos[1] + dir[1] * 0.25; Q[2] = pos[2] + dir[2] * 0.25;
    const h = G.level.raycast(Q, dir, reach);
    return h && h.pos ? h : null;
  }

  // ---- hits: the wound, and for a killing headshot the burst
  gore.hooks.hit.push((e, z) => {
    if (!e || !e.pos) return;
    const g = level();
    set3(P, e.pos);
    const hasDir = !!e.dir;
    if (hasDir) set3(D, e.dir); else { D[0] = 0; D[1] = 0; D[2] = -1; }
    const back = ownHits || (e.killed && e.part === 'head') ? behindOf(P, D, BLOOD.exitReach) : null;
    bloodPlan(e, { gore: g, behind: back ? back.dist + 0.25 : Infinity, near: gore.playerDist(P), r: rng.next() }, plan);
    if (z && plan.wound && typeof z.addWound === 'function') {
      if (z.addWound(P, plan.wound.radius, plan.wound.kind, hasDir ? D : null)) emit('zombie:wound', { id: e.id, part: e.part, pos: { x: P[0], y: P[1], z: P[2] } });
    }
    if (ownHits) {
      if (fx() && typeof fx().blood === 'function') fx().blood(P, D, plan.spray.count / 20, e.part);
      for (const d of plan.decals) {
        if (d.at === 'behind' && back) { DEC.kind = d.kind; DEC.size = d.size; DEC.dir = D; DEC.grow = 0; decal(back.pos, back.normal, DEC); }
        else if (d.at === 'ground') { Q[0] = P[0] + D[0] * 0.5; Q[2] = P[2] + D[2] * 0.5; Q[1] = floorAt(Q[0], P[1], Q[2]) + 0.01; DEC.kind = d.kind; DEC.size = d.size; DEC.dir = D; DEC.grow = 0; decal(Q, UP, DEC); }
      }
    }
    if (!plan.burst) return;
    // the head goes: mist, a gout along the shot and one straight up, fragments, a fan on what is behind
    burstPlan(g, rng.next(), burst);
    if (z && typeof z.headDamage === 'function' && !(z.severed && z.severed.has('head'))) z.headDamage(2);
    parts('mist', P, D, burst.mist, 2.2);
    parts('spray', P, D, burst.spray, 5.5);
    N[0] = D[0] * 0.3; N[1] = 1; N[2] = D[2] * 0.3;
    parts('spray', P, N, Math.round(burst.spray * 0.5), 3.2);
    if (burst.chunks && fx() && typeof fx().gib === 'function') fx().gib(P, D, 'head');
    for (let k = 0; k < burst.fan; k++) {
      // spread the fan a little to each side of the shot and downward
      N[0] = D[0] + (rng.next() - 0.5) * 0.5; N[1] = D[1] - 0.12 - rng.next() * 0.3; N[2] = D[2] + (rng.next() - 0.5) * 0.5;
      const l = Math.hypot(N[0], N[1], N[2]) || 1;
      N[0] /= l; N[1] /= l; N[2] /= l;
      const h = behindOf(P, N, BLOOD.exitReach + 1);
      if (h) { DEC.kind = 'spatter'; DEC.size = 0.35 + 0.35 * rng.next(); DEC.dir = N; DEC.grow = 0; decal(h.pos, h.normal, DEC); }
    }
  });

  // ---- severing: under reduced gore the limb simply stays; else the stump runs for a while
  const stumps = [];
  for (let k = 0; k < 8; k++) stumps.push({ z: null, bone: '', until: 0, next: 0, lx: 0, lz: 0 });
  let stumpAt = 0;
  function onSever(z, part, dir) {
    if (!z || !SEVER[part]) return;
    if (level() < 1) {
      // put it back as it was: the bones shown again, no cap, and the animator none the wiser
      for (const n of SEVER[part].bones) z.pose.hide[B[n]] = 0;
      const u = z.materials && z.materials.char && z.materials.char.surf && z.materials.char.surf.uChSever;
      if (u) u.value[SEVER[part].slot] = 0;
      if (z.severed) z.severed.delete(part);
      return;
    }
    const s = stumps[stumpAt]; stumpAt = (stumpAt + 1) % stumps.length;
    s.z = z; s.bone = STUMP_BONE[part]; s.until = now() + BLOOD.stumpSeconds; s.next = 0; s.lx = NaN; s.lz = NaN;
    if (bonePos(z, s.bone, P)) parts('spray', P, dir || UP, 10, 3);
  }
  gore.onSever = onSever;
  gore.hooks.sever.push((e, z) => onSever(z, e.part, e.dir));

  // ---- each frame a body is animated: its stumps drip, and leave a trail on the ground
  gore.hooks.frame.push((z) => {
    const t = now();
    for (const s of stumps) {
      if (s.z !== z) continue;
      if (t > s.until) { s.z = null; continue; }
      if (t < s.next || !bonePos(z, s.bone, P)) continue;
      const left = (s.until - t) / BLOOD.stumpSeconds;
      s.next = t + 0.1 + 0.25 * (1 - left);
      parts('drop', P, DOWN, left > 0.6 ? 3 : 1, 1.2);
      if (!(Math.hypot(P[0] - s.lx, P[2] - s.lz) < 0.45)) {
        s.lx = P[0]; s.lz = P[2];
        Q[0] = P[0]; Q[2] = P[2]; Q[1] = floorAt(P[0], P[1], P[2]) + 0.01;
        DEC.kind = 'drip'; DEC.size = 0.07 + 0.08 * left; DEC.dir = null; DEC.grow = 0;
        decal(Q, UP, DEC);
      }
    }
  });

  // ---- a crawler drags itself through its own blood
  gore.hooks.drag.push((z, x, y, zz, yaw) => {
    if (level() < 1) return;
    Q[0] = x; Q[1] = y + 0.01; Q[2] = zz;
    N[0] = Math.sin(yaw); N[1] = 0; N[2] = Math.cos(yaw);
    DEC.kind = 'smear'; DEC.size = 0.5 + 0.2 * rng.next(); DEC.dir = N; DEC.grow = 0;
    decal(Q, UP, DEC);
  });

  // ---- corpses: one pool each, laid when the body has come to rest, under the part of it that bleeds
  const dying = new Map();     // zombie -> { headshot, burst }
  gore.hooks.die.push((e, z) => { if (z) dying.set(z, { headshot: !!e.headshot, burst: e.cause === 'burst' || e.type === 'bloater', id: e.id }); });
  gore.hooks.settle.push((z) => {
    const d = dying.get(z);
    dying.delete(z);
    const size = poolSize(level(), { headshot: d && d.headshot, burst: d && d.burst, big: z.build === 'brute', r: rng.next() });
    if (!(size > 0)) return;
    const res = pools.add(d ? d.id : z);
    if (!res.added) return;
    // the oldest pool makes way (the fx ring has no handle to remove one decal; when it grows one,
    // G.fx.fadeBloodDecal(slot) is called here; until then the ring's own oldest-first recycling does it)
    if (res.retiredSlot >= 0 && fx() && typeof fx().fadeBloodDecal === 'function') fx().fadeBloodDecal(res.retiredSlot);
    if (!bonePos(z, d && d.headshot ? 'neck' : 'spine1', P)) return;
    // it runs out from under the body to one side, the way the ground falls
    const ang = rng.next() * 6.2832, off = 0.18 + 0.2 * rng.next();
    Q[0] = P[0] + Math.cos(ang) * off; Q[2] = P[2] + Math.sin(ang) * off; Q[1] = floorAt(Q[0], P[1], Q[2]) + 0.01;
    DEC.kind = 'pool'; DEC.size = size; DEC.grow = BLOOD.poolGrow; DEC.dir = null;
    pools.setSlot(res.index, decal(Q, UP, DEC));
  });
  gore.hooks.burst.push((e, z) => {
    if (!z || level() < 1 || typeof z.addWound !== 'function') return;
    // blown open from the middle
    if (bonePos(z, 'spine1', P)) { P[1] += 0.05; z.addWound(P, 0.12, 'blast'); }
    if (bonePos(z, 'spine2', P)) { P[1] -= 0.02; z.addWound(P, 0.1, 'blast'); }
  });

  // the screen layer needs the HUD's root, which may not exist yet when the first animator is made
  const api = { pools, screen: null, onSever, ownHits };
  const ensureScreen = () => { if (!api.screen && typeof document !== 'undefined') { api.screen = createBloodScreen(G, gore); gore.screen = api.screen; } return api.screen; };
  ensureScreen();
  if (G.events && typeof G.events.on === 'function') {
    G.events.on('game:state', (e) => {
      ensureScreen();
      if (e && e.state === 'title') { pools.clear(); dying.clear(); for (const s of stumps) s.z = null; }
    });
  }
  api.ensureScreen = ensureScreen;
  return api;
}
