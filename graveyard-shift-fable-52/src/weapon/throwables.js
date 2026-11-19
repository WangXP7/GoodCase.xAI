// Thrown and lobbed things in flight, the blasts they end in, and burning pools (molotov, Roadflare).
//   createThrowables(G, { emit, amount? }) -> { launch, update, explode, addPool, reset, projectiles, pools }
// Damage is applied here (G.zombies.damage, G.player.damage); effects only listen to the events:
//   throw {kind, pos, vel}                      a frag, molotov or decoy leaves the hand
//   flare:launch {id, pos, vel, gravity, upgraded}  a Roadflare round leaves the muzzle; it flies
//                                               ballistically (no drag) under `gravity` until
//   flare:burst {id, pos, hit}                  it strikes a zombie (hit) or a surface
//   explosion {pos, radius, damage, kind:'frag'|'decoy'}
//   fire:pool {pos (on the surface it burns on), radius, seconds, kind:'molotov'|'flare'}
//   hit:zombie {id, pos, part, damage, killed, headshot, dir, weapon, source:'explosion'|'fire'|'bullet'}
//     (a pool tick emits hit:zombie only when it kills, so burning is not a points tap)
// Frag and molotov damage grow with the round (blastDamage, poolTotal) so they stay useful late.
// Fixed pools of projectiles and pools: nothing is allocated per frame while they fly or burn.
import { tuning } from '../game/tuning.js';

const T = tuning.weapons.throwables;
const MAX_PROJECTILES = 8;
const MAX_POOLS = 8;
const BODY_H = 1.8; // m: a body is the vertical segment from its feet up this far
const DECOY_LURE_AFTER = 3; // s: a decoy that never comes to rest starts calling anyway
const POOL_DY = 1.5; // m: how far above a pool's surface a body still burns
const FLOOR_PROBE = 30; // m: how far down a pool looks for the surface under its burst

// Linear from `centre` at the middle to 0 at `radius`.
export function falloffDamage(dist, centre, radius) {
  return dist >= radius ? 0 : centre * (1 - dist / radius);
}

const walkerHealth = (round) => tuning.walker.health(Math.max(1, Math.floor(Number(round) || 1)));
// A frag's centre damage in round n: max(table damage, healthScale x walker health).
export function blastDamage(round) {
  return Math.max(T.frag.damage, T.frag.healthScale * walkerHealth(round));
}
// A molotov pool's total damage over its burn in round n: max(dps x seconds, healthScale x walker health).
export function poolTotal(round) {
  return Math.max(T.molotov.dps * T.molotov.seconds, T.molotov.healthScale * walkerHealth(round));
}

const xyzOf = (x, y, z) => ({ x, y, z });
const coord = (p, i) => (Array.isArray(p) ? p[i] : i === 0 ? p.x : i === 1 ? p.y : p.z);

// Distance from point (x,y,z) to the body standing at (bx,by,bz): its vertical segment.
function bodyDist(x, y, z, bx, by, bz) {
  const cy = Math.max(by, Math.min(by + BODY_H, y));
  return Math.hypot(x - bx, y - cy, z - bz);
}

export function createThrowables(G, opts = {}) {
  const emit = opts.emit || ((n, p) => G.events && G.events.emit(n, p));
  // the weapon's mods (One-Tap) may raise an amount: amount(id, base) -> number
  const amountFor = opts.amount || ((id, a) => a);
  const warned = new Set();
  const warnOnce = (k, e) => { if (!warned.has(k)) { warned.add(k); console.warn(`[throwables] ${k}`, e); } };
  const round = () => (G.game && Number.isFinite(G.game.round) ? G.game.round : 1);

  const proj = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    proj.push({
      active: false, kind: '', id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, rest: false, lureT: -1,
      g: 0, life: 0, flare: null, damage: 0, weapon: '',
    });
  }
  const pools = [];
  for (let i = 0; i < MAX_POOLS; i++) pools.push({ active: false, kind: '', x: 0, y: 0, z: 0, radius: 0, perTick: 0, playerDps: 0, acc: 0, ticks: 0 });
  let nProj = 0, nPools = 0, nextId = 1;
  const o = [0, 0, 0], d = [0, 0, 0]; // raycast scratch
  const victims = [], amounts = []; // victims of one blast or tick

  function heightAt(x, z) {
    const L = G.level;
    if (L && typeof L.heightAt === 'function') {
      try { const h = L.heightAt(x, z); if (Number.isFinite(h)) return h; } catch (e) { warnOnce('heightAt threw', e); }
    }
    return 0;
  }

  function cast(obj, x, y, z, dx, dy, dz, max) {
    if (!obj || typeof obj.raycast !== 'function' || !(max > 0)) return null;
    o[0] = x; o[1] = y; o[2] = z; d[0] = dx; d[1] = dy; d[2] = dz;
    try { return obj.raycast(o, d, max) || null; } catch (e) { warnOnce('raycast threw', e); return null; }
  }

  // The surface under a point: the level straight below it (a walkway, a roof), else the ground.
  function floorUnder(x, y, z) {
    if (Number.isFinite(y)) {
      const h = cast(G.level, x, y + 0.1, z, 0, -1, 0, FLOOR_PROBE);
      if (h && Number.isFinite(h.dist)) return y + 0.1 - h.dist;
    }
    return heightAt(x, z);
  }

  // Is the straight line from the blast to (x,y,z) clear of the level?
  function clear(px, py, pz, x, y, z) {
    const dx = x - px, dy = y - py, dz = z - pz;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.3) return true;
    const h = cast(G.level, px, py, pz, dx / L, dy / L, dz / L, L);
    return !(h && Number.isFinite(h.dist) && h.dist < L - 0.2);
  }

  // ---------------------------------------------------------------- launching

  // Launch `kind` from the eye along fwd. Throwables go `T.angle` degrees above it at `T.speed`
  // under `T.gravity`, plus the thrower's velocity. A flare (kind 'flare') passes its flight in
  // `flare` = { speed, angle, gravity, life, radius, seconds, dps, playerDps } and `hit` =
  // { damage, weapon, upgraded }. Returns false when every projectile slot is busy.
  function launch(kind, eye, fwd, inherit, flare, hit) {
    let p = null;
    for (let i = 0; i < MAX_PROJECTILES; i++) if (!proj[i].active) { p = proj[i]; break; }
    if (!p) return false;
    const isFlare = kind === 'flare' && !!flare;
    const speed = isFlare ? flare.speed : T.speed, angle = isFlare ? flare.angle : T.angle;
    const fx = coord(fwd, 0), fy = coord(fwd, 1), fz = coord(fwd, 2);
    const h = Math.hypot(fx, fz) || 1;
    const pitch = Math.atan2(fy, h) + (angle * Math.PI) / 180;
    const c = Math.cos(pitch), s = Math.sin(pitch);
    p.active = true; p.kind = kind; p.id = nextId++; p.t = 0; p.rest = false; p.lureT = -1;
    p.g = isFlare ? flare.gravity : T.gravity;
    p.life = isFlare ? flare.life : Infinity;
    p.flare = isFlare ? flare : null;
    p.damage = isFlare && hit ? hit.damage : 0;
    p.weapon = isFlare && hit ? hit.weapon : kind;
    p.x = coord(eye, 0) + (fx / h) * 0.35; p.y = coord(eye, 1) - 0.1; p.z = coord(eye, 2) + (fz / h) * 0.35;
    p.vx = (fx / h) * c * speed; p.vy = s * speed; p.vz = (fz / h) * c * speed;
    if (inherit && !isFlare) { p.vx += coord(inherit, 0) || 0; p.vy += coord(inherit, 1) || 0; p.vz += coord(inherit, 2) || 0; }
    nProj++;
    if (isFlare) emit('flare:launch', { id: p.id, pos: xyzOf(p.x, p.y, p.z), vel: xyzOf(p.vx, p.vy, p.vz), gravity: p.g, upgraded: !!(hit && hit.upgraded) });
    else emit('throw', { kind, pos: xyzOf(p.x, p.y, p.z), vel: xyzOf(p.vx, p.vy, p.vz) });
    return true;
  }

  function free(p) { p.active = false; p.flare = null; nProj--; }

  function callLure(p) {
    const z = G.zombies;
    try {
      if (z && typeof z.setLure === 'function') {
        if (p) z.setLure(xyzOf(p.x, p.y, p.z), Math.max(0, T.decoy.seconds - p.lureT), T.decoy.lureRadius);
        else z.setLure(null, 0);
      }
    } catch (e) { warnOnce('setLure threw', e); }
  }

  // Move one step. Returns null, 'burst' (a molotov or flare struck something; `zHit` holds a
  // struck zombie) or nothing else; frags and decoys bounce and roll.
  let zHit = null;
  function move(p, dt) {
    const r = T.radius;
    zHit = null;
    p.vy -= p.g * dt;
    const mx = p.vx * dt, my = p.vy * dt, mz = p.vz * dt;
    const len = Math.hypot(mx, my, mz);
    const breaks = p.kind === 'molotov' || p.kind === 'flare';
    if (len > 1e-6) {
      const ux = mx / len, uy = my / len, uz = mz / len;
      const hit = cast(G.level, p.x, p.y, p.z, ux, uy, uz, len + r);
      const hd = hit && Number.isFinite(hit.dist) && hit.dist <= len + r ? hit.dist : Infinity;
      if (breaks) {
        const zh = cast(G.zombies, p.x, p.y, p.z, ux, uy, uz, Math.min(len + r, hd));
        if (zh && Number.isFinite(zh.dist) && zh.dist <= Math.min(len + r, hd)) {
          p.x += ux * zh.dist; p.y += uy * zh.dist; p.z += uz * zh.dist;
          zHit = zh;
          return 'burst';
        }
      }
      if (hd < Infinity) {
        const t = Math.max(0, hd - r) / len;
        p.x += mx * t; p.y += my * t; p.z += mz * t;
        if (breaks) return 'burst';
        const n = hit.normal;
        const nx = n ? coord(n, 0) : -ux, ny = n ? coord(n, 1) : -uy, nz = n ? coord(n, 2) : -uz;
        const vn = p.vx * nx + p.vy * ny + p.vz * nz;
        if (vn < 0) {
          p.vx = (p.vx - 2 * vn * nx) * T.bounce; p.vy = (p.vy - 2 * vn * ny) * T.bounce; p.vz = (p.vz - 2 * vn * nz) * T.bounce;
        }
      } else { p.x += mx; p.y += my; p.z += mz; }
    }
    const g = heightAt(p.x, p.z);
    if (p.y <= g + r) {
      p.y = g + r;
      if (breaks) return 'burst';
      if (p.vy < -1) { // an impact: bounce, and the ground takes some of the run
        p.vy = -p.vy * T.bounce; p.vx *= T.friction; p.vz *= T.friction;
      } else { // rolling
        p.vy = 0;
        const sp = Math.hypot(p.vx, p.vz);
        const ns = Math.max(0, sp - T.roll * dt);
        if (ns < T.rest) { p.vx = 0; p.vz = 0; p.rest = true; } else { p.vx *= ns / sp; p.vz *= ns / sp; }
      }
    }
    return null;
  }

  // A molotov or flare has struck something at p (zHit: the zombie, if one).
  function burst(p) {
    if (p.kind === 'flare') {
      const hitZ = !!zHit;
      if (hitZ && G.zombies && typeof G.zombies.damage === 'function') {
        const l = Math.hypot(p.vx, p.vy, p.vz) || 1;
        hitZombie(zHit.id, amountFor(zHit.id, p.damage), xyzOf(p.vx / l, p.vy / l, p.vz / l), zHit.pos ? coord(zHit.pos, 0) : p.x,
          zHit.pos ? coord(zHit.pos, 1) : p.y, zHit.pos ? coord(zHit.pos, 2) : p.z, zHit.part || 'torso', p.weapon, 'bullet', true);
      }
      emit('flare:burst', { id: p.id, pos: xyzOf(p.x, p.y, p.z), hit: hitZ });
      addPool(xyzOf(p.x, p.y, p.z), 'flare', p.flare);
    } else addPool(xyzOf(p.x, p.y, p.z), 'molotov');
    zHit = null;
  }

  // ---------------------------------------------------------------- blasts and pools

  // frag: falloff from blastDamage(round) to 0 at its radius, the player at selfScale; decoy: a flat burst.
  function explode(pos, kind) {
    const frag = kind === 'frag';
    const radius = frag ? T.frag.radius : T.decoy.burstRadius;
    const damage = frag ? blastDamage(round()) : T.decoy.burst;
    const x = coord(pos, 0), y = coord(pos, 1), z = coord(pos, 2);
    emit('explosion', { pos: xyzOf(x, y, z), radius, damage, kind });
    const Z = G.zombies;
    if (Z && Array.isArray(Z.list) && typeof Z.damage === 'function') {
      // collect first: a kill removes the record from the list
      victims.length = 0; amounts.length = 0;
      for (let i = 0; i < Z.list.length; i++) {
        const r = Z.list[i];
        if (!r || r.alive === false || !r.pos) continue;
        const bx = coord(r.pos, 0), by = coord(r.pos, 1) || 0, bz = coord(r.pos, 2);
        const dd = bodyDist(x, y, z, bx, by, bz);
        if (dd >= radius || !clear(x, y + 0.3, z, bx, by + 1.0, bz)) continue;
        victims.push(r); amounts.push(frag ? falloffDamage(dd, damage, radius) : damage);
      }
      for (let i = 0; i < victims.length; i++) {
        const r = victims[i];
        const bx = coord(r.pos, 0), by = coord(r.pos, 1) || 0, bz = coord(r.pos, 2);
        const dl = Math.hypot(bx - x, bz - z) || 1;
        hitZombie(r.id, amountFor(r.id, amounts[i]), xyzOf((bx - x) / dl, 0, (bz - z) / dl), bx, by + 1.0, bz, 'torso', kind, 'explosion', true);
      }
      victims.length = 0; amounts.length = 0;
    }
    const P = G.player;
    if (frag && P && !P.stub && typeof P.damage === 'function' && P.pos) {
      const dd = bodyDist(x, y, z, P.pos[0], P.pos[1], P.pos[2]);
      if (dd < radius && clear(x, y + 0.3, z, P.pos[0], P.pos[1] + 1.0, P.pos[2])) {
        const dl = Math.hypot(P.pos[0] - x, P.pos[2] - z) || 1;
        try { P.damage(falloffDamage(dd, damage, radius) * T.frag.selfScale, [(P.pos[0] - x) / dl, 0, (P.pos[2] - z) / dl]); } catch (e) { warnOnce('player.damage threw', e); }
      }
    }
  }

  // Damage a zombie; report it always, or (pool ticks) only when it kills. The event's position is
  // built only when it is emitted.
  function hitZombie(id, amount, dir, hx, hy, hz, part, weapon, source, always) {
    let res = null;
    try { res = G.zombies.damage(id, amount, part, dir); } catch (e) { warnOnce('zombies.damage threw', e); }
    const killed = !!(res && res.killed);
    if (!always && !killed) return;
    const damage = res && Number.isFinite(res.damage) ? res.damage : amount;
    emit('hit:zombie', { id, pos: xyzOf(hx, hy, hz), part, damage, killed, headshot: part === 'head', dir, weapon, source });
  }

  // A burning pool on the surface under `pos` (the burst point's own surface: a walkway burns on the
  // walkway). 'molotov' takes its numbers from the table, its total scaled by the round; any other
  // kind passes cfg = { radius, seconds, dps, playerDps }.
  function addPool(pos, kind, cfg) {
    const molotov = kind === 'molotov';
    const c = molotov ? T.molotov : cfg;
    if (!c) return false;
    let p = null;
    for (let i = 0; i < MAX_POOLS; i++) if (!pools[i].active) { p = pools[i]; break; }
    if (!p) { // the one nearest its end goes out
      p = pools[0];
      for (let i = 1; i < MAX_POOLS; i++) if (pools[i].ticks < p.ticks) p = pools[i];
      nPools--;
    }
    const x = coord(pos, 0), z = coord(pos, 2);
    p.active = true; p.kind = kind; p.x = x; p.z = z; p.y = floorUnder(x, coord(pos, 1), z);
    p.radius = c.radius; p.playerDps = c.playerDps || 0; p.acc = 0;
    p.ticks = Math.max(1, Math.round(c.seconds / T.poolTick));
    p.perTick = (molotov ? poolTotal(round()) : c.dps * c.seconds) / p.ticks;
    nPools++;
    emit('fire:pool', { pos: xyzOf(p.x, p.y, p.z), radius: c.radius, seconds: c.seconds, kind });
    return true;
  }

  function burn(p) {
    const Z = G.zombies;
    if (Z && Array.isArray(Z.list) && typeof Z.damage === 'function') {
      victims.length = 0;
      for (let i = 0; i < Z.list.length; i++) {
        const r = Z.list[i];
        if (!r || r.alive === false || !r.pos) continue;
        const by = coord(r.pos, 1) || 0;
        if (Math.abs(by - p.y) > POOL_DY) continue;
        if (Math.hypot(coord(r.pos, 0) - p.x, coord(r.pos, 2) - p.z) < p.radius) victims.push(r);
      }
      for (let i = 0; i < victims.length; i++) {
        const r = victims[i];
        hitZombie(r.id, amountFor(r.id, p.perTick), null, coord(r.pos, 0), (coord(r.pos, 1) || 0) + 0.3, coord(r.pos, 2), 'torso', p.kind, 'fire', false);
      }
      victims.length = 0;
    }
    const P = G.player;
    if (p.playerDps > 0 && P && !P.stub && typeof P.damage === 'function' && P.pos && P.alive !== false) {
      if (Math.abs(P.pos[1] - p.y) < 1 && Math.hypot(P.pos[0] - p.x, P.pos[2] - p.z) < p.radius) {
        try { P.damage(p.playerDps * T.poolTick, null); } catch (e) { warnOnce('player.damage threw', e); }
      }
    }
  }

  // The decoy with the most calling left, other than `except`, or null.
  function otherDecoy(except) {
    let best = null;
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = proj[i];
      if (p !== except && p.active && p.kind === 'decoy' && p.lureT >= 0 && (!best || p.lureT < best.lureT)) best = p;
    }
    return best;
  }

  // ---------------------------------------------------------------- frame

  function update(dt) {
    if (!(dt > 0) || (nProj === 0 && nPools === 0)) return;
    for (let i = 0; i < MAX_PROJECTILES && nProj > 0; i++) {
      const p = proj[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.kind === 'frag' && p.t >= T.frag.fuse) { explode(xyzOf(p.x, p.y, p.z), 'frag'); free(p); continue; }
      if (p.kind === 'decoy' && p.lureT >= 0) {
        p.lureT += dt;
        if (p.lureT >= T.decoy.seconds) {
          explode(xyzOf(p.x, p.y, p.z), 'decoy');
          free(p);
          callLure(otherDecoy(p)); // zombies go to the next decoy still calling, or stop
          continue;
        }
      }
      if (!p.rest && move(p, dt) === 'burst') { burst(p); free(p); continue; }
      if (p.kind === 'flare' && p.t >= p.life) { burst(p); free(p); continue; }
      if (p.kind === 'decoy' && p.lureT < 0 && (p.rest || p.t >= DECOY_LURE_AFTER)) { p.lureT = 0; callLure(p); }
    }
    for (let i = 0; i < MAX_POOLS && nPools > 0; i++) {
      const p = pools[i];
      if (!p.active) continue;
      p.acc += dt;
      while (p.ticks > 0 && p.acc >= T.poolTick - 1e-9) { p.acc -= T.poolTick; p.ticks--; burn(p); }
      if (p.ticks <= 0) { p.active = false; nPools--; }
    }
  }

  function reset() {
    let lured = false;
    for (const p of proj) { if (p.active && p.kind === 'decoy' && p.lureT >= 0) lured = true; p.active = false; p.flare = null; }
    for (const p of pools) p.active = false;
    nProj = 0; nPools = 0;
    if (lured) callLure(null);
  }

  return {
    launch, update, explode, addPool, reset,
    get projectiles() { return nProj; },
    get pools() { return nPools; },
  };
}
