// Weapons: fire control, reload, spread, recoil, hit scan, the arsenal around them, and the
// weapon:* / hit:* events. Two layers:
//  - pure (createWeaponState, step, spreadDeg, spreadDir, nearestHit, falloffScale, penetrationScale,
//    arcChain): no
//    three.js, no DOM, so vitest runs it. `step` runs on any object with the slot's state fields;
//    its Def `T` says how the weapon fires (semi/auto, rpm, magazine or shell reload);
//  - createWeapon(G): the factory that owns G.weapon. It holds the loadout (arsenal.js), reads
//    G.input / G.player / G.game, drives the viewmodel (G.weapon.view), raycasts the zombies and the
//    level, applies damage, and emits events. Throwables, the Roadflare's flight and pools are
//    throwables.js; melee reach is
//    melee.js. Numbers are in src/game/tuning/weapons.js.
// Vectors are [x,y,z] arrays inside; event positions and directions are {x,y,z} objects.
import { tuning } from '../game/tuning.js';
import { createWeaponView } from './viewmodel.js';
import { statsFor } from './defs.js';
import * as arsenal from './arsenal.js';
import { meleeTargets } from './melee.js';
import { createThrowables } from './throwables.js';

const TW = tuning.weapons;
// The pistol's spread (the original SPREAD), kept as the default for callers that pass no Def.
export const SPREAD = TW.classes.pistol.spread;
export const FIRE_BUFFER = TW.fireBuffer;
const MOVING_SPEED = TW.movingSpeed;
const GRANT_FRACTION = TW.grantFraction;

// ---------------------------------------------------------------- pure state machine

export function createWeaponState(T = tuning.pistol) {
  return { mag: T.mag, reserve: T.reserve, cooldown: 0, reloading: false, reloadT: 0, granted: false, bloom: 0, buffered: false, shellT: 0 };
}

export function resetWeaponState(s, T = tuning.pistol) {
  Object.assign(s, createWeaponState(T));
  return s;
}

function startReload(s, T, scale, ev) {
  s.reloading = true; s.reloadT = 0; s.granted = false;
  if (T.reloadKind === 'shell') s.shellT = ((T.shellStart || 0) + T.reload) * scale;
  ev.push({ type: 'reload' });
}

function grant(s, T, ev) {
  const n = Math.min(T.mag - s.mag, s.reserve);
  s.mag += n; s.reserve -= n; s.granted = true;
  ev.push({ type: 'ammo', moved: n });
}

function cancel(s, ev) {
  s.reloading = false; s.reloadT = 0;
  ev.push({ type: 'reloadCancel', granted: s.granted });
}

// Advance the weapon by dt. inp: { fire (semi: pressed this frame; auto: trigger held), press (went
// down this frame; omitted = fire), reload (pressed), sprint, active (game playing, player alive),
// busy (switching or swinging: no shot and no new reload), viewTimed (the view reports magIn /
// shellIn), magIn, shellIn (the view's event fired this frame), reloadScale (1 when omitted) }.
// Returns events: fire {last, bloom} | dry | reload | ammo {moved} | reloadDone | reloadCancel {granted}.
// Pass `out` to reuse an array: it is cleared and filled (no allocation while nothing happens).
// Semi-automatic: one press inside the last FIRE_BUFFER of the cooldown is held and fires when it
// ends. Automatic: the cooldown carries its remainder from shot to shot while the trigger is held,
// so the rate holds at any frame rate (at most one shot a frame); a dry fire needs a press, and a
// magazine run dry with the trigger held starts its reload.
// A shell reload loads one round per T.reload (after T.shellStart) and a press with rounds in the
// tube interrupts it, keeping what was loaded.
export function step(s, inp, dt, T = tuning.pistol, out = []) {
  const ev = out;
  ev.length = 0;
  const sp = T.spread || SPREAD;
  const scale = inp.reloadScale > 0 ? inp.reloadScale : 1;
  const press = inp.press === undefined ? !!inp.fire : !!inp.press;
  const auto = !!T.auto;
  s.cooldown -= dt;
  if (s.cooldown < 0 && !(auto && inp.fire)) s.cooldown = 0;
  s.bloom = sp.bloom > 0 ? Math.max(0, s.bloom - (dt * sp.bloom) / sp.bloomRecover) : 0;

  if (s.reloading) {
    if (!inp.active || inp.sprint) cancel(s, ev);
    else if (T.reloadKind === 'shell') {
      if (press && s.mag > 0) cancel(s, ev); // and fires below
      else {
        s.reloadT += dt; s.shellT -= dt;
        const per = T.reload * scale;
        const due = inp.viewTimed ? !!inp.shellIn || s.shellT <= -per : s.shellT <= 0;
        if (due && s.mag < T.mag && s.reserve > 0) {
          s.mag += 1; s.reserve -= 1; s.granted = true;
          s.shellT = inp.viewTimed ? per : s.shellT + per;
          ev.push({ type: 'ammo', moved: 1 });
        }
        if (s.mag >= T.mag || s.reserve <= 0) { s.reloading = false; ev.push({ type: 'reloadDone' }); }
      }
    } else {
      const R = T.reload * scale;
      s.reloadT += dt;
      const due = inp.viewTimed ? !!inp.magIn : s.reloadT >= R * GRANT_FRACTION;
      if (!s.granted && (due || s.reloadT >= R)) grant(s, T, ev);
      if (s.reloadT >= R) { s.reloading = false; ev.push({ type: 'reloadDone' }); }
    }
  }

  const ready = inp.active && !inp.sprint && !s.reloading && !inp.busy;
  if (inp.reload && ready && s.mag < T.mag && s.reserve > 0) startReload(s, T, scale, ev);

  if (!ready || s.reloading || auto) s.buffered = false;
  else if (press && s.cooldown > 0 && s.cooldown <= FIRE_BUFFER) s.buffered = true;

  const trigger = auto ? !!inp.fire : press || s.buffered;
  if (trigger && ready && !s.reloading && s.cooldown <= 0) {
    const interval = 60 / T.rpm;
    if (s.mag > 0) {
      s.buffered = false;
      s.cooldown = auto ? Math.max(s.cooldown, -dt) + interval : interval;
      s.mag -= 1;
      const bloom = s.bloom; // this shot's spread uses the bloom from before it
      s.bloom = Math.min(sp.bloomMax, s.bloom + sp.bloom);
      ev.push({ type: 'fire', last: s.mag === 0, bloom });
    } else if (press || s.buffered) {
      s.buffered = false;
      s.cooldown = interval;
      ev.push({ type: 'dry' });
      if (s.reserve > 0) startReload(s, T, scale, ev);
    } else if (auto && s.reserve > 0) startReload(s, T, scale, ev); // ran dry with the trigger held
  }
  return ev;
}

// Cone half-angle in degrees. ctx: { ads 0..1, moving, airborne }; sp: the weapon's spread.
export function spreadDeg(s, ctx = {}, sp = SPREAD) {
  const a = Math.min(1, Math.max(0, ctx.ads || 0));
  return sp.hip + (sp.ads - sp.hip) * a
    + (ctx.moving ? sp.move : 0) + (ctx.airborne ? sp.air : 0) + (s.bloom || 0);
}

// A unit direction uniformly distributed over the disc of the cone around fwd. Pass `out` (an
// [x,y,z] array, not fwd itself) to fill it instead of making a new one.
export function spreadDir(fwd, deg, rng, out) {
  let [fx, fy, fz] = fwd;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // basis perpendicular to fwd
  const ref = Math.abs(fy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = fy * ref[2] - fz * ref[1], uy = fz * ref[0] - fx * ref[2], uz = fx * ref[1] - fy * ref[0];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = fy * uz - fz * uy, vy = fz * ux - fx * uz, vz = fx * uy - fy * ux;
  const ang = ((deg * Math.PI) / 180) * Math.sqrt(rng.next());
  const th = rng.next() * Math.PI * 2;
  const c = Math.cos(ang), sn = Math.sin(ang), ct = Math.cos(th), st = Math.sin(th);
  const o = out || [0, 0, 0];
  o[0] = fx * c + sn * (ux * ct + vx * st);
  o[1] = fy * c + sn * (uy * ct + vy * st);
  o[2] = fz * c + sn * (uz * ct + vz * st);
  return o;
}

// Damage scale on the n-th zombie a round meets (0 = the first): pen.keep^n, or 0 once the round has
// gone through pen.bodies zombies or travelled more than pen.reach m past the first one (`past`).
export function penetrationScale(n, past, pen) {
  if (n <= 0) return 1;
  if (!pen || n > pen.bodies || past > pen.reach) return 0;
  return pen.keep ** n;
}

// The nearer of a zombie hit and a world hit; malformed hits are ignored.
export function nearestHit(z, w) {
  const ok = (h) => h && Number.isFinite(h.dist);
  const zo = ok(z) ? z : null, wo = ok(w) ? w : null;
  if (zo && (!wo || zo.dist <= wo.dist)) return { kind: 'zombie', hit: zo };
  if (wo) return { kind: 'world', hit: wo };
  return null;
}

// Damage scale at a distance: 1 up to falloff[0], falling linearly to falloff[2] at falloff[1].
export function falloffScale(dist, falloff) {
  if (!falloff) return 1;
  const [a, b, m] = falloff;
  if (dist <= a) return 1;
  if (dist >= b) return m;
  return 1 + ((m - 1) * (dist - a)) / (b - a);
}

const px = (p) => (Array.isArray(p) ? p[0] : p.x);
const py = (p) => (Array.isArray(p) ? p[1] : p.y);
const pz = (p) => (Array.isArray(p) ? p[2] : p.z);

// The Jumper's chain: `first`, then up to `extra` more records from `list`, each the nearest one not
// yet hit within `radius` of the one before. Fills and returns `out`.
export function arcChain(first, list, extra, radius, out = []) {
  out.length = 0;
  out.push(first);
  let at = first;
  for (let k = 0; k < extra; k++) {
    let best = null, bd = radius;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.alive === false || !r.pos || out.includes(r) || out.some((o) => o.id === r.id)) continue;
      const d = Math.hypot(px(r.pos) - px(at.pos), (py(r.pos) || 0) - (py(at.pos) || 0), pz(r.pos) - pz(at.pos));
      if (d <= bd) { bd = d; best = r; }
    }
    if (!best) break;
    out.push(best);
    at = best;
  }
  return out;
}

// ---------------------------------------------------------------- G-facing layer

const xyz = (p) => (!p ? null : Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z });

// opts.createView: test seam for the viewmodel factory (default createWeaponView).
export function createWeapon(G, opts = {}) {
  const makeView = opts.createView || createWeaponView;
  const rng = G.rng && G.rng.fork ? G.rng.fork('weapon') : { next: () => 0.5, range: (a, b) => (a + b) / 2 };
  const emit = (n, p) => G.events && G.events.emit(n, p);
  const warned = new Set();
  const warnOnce = (key, e) => { if (!warned.has(key)) { warned.add(key); console.warn(`[weapon] ${key}`, e); } };

  // The viewmodel belongs to another module: tolerate it missing or throwing.
  let view = null;
  let magIn = false, shellIn = false;
  try {
    view = makeView(G);
    if (view && view.events && view.events.on) {
      view.events.on('magIn', () => { magIn = true; });
      view.events.on('shellIn', () => { shellIn = true; });
    }
  } catch (e) { warnOnce('view failed; running without a viewmodel', e); view = null; }
  const viewCall = (fn) => {
    if (!view) return undefined;
    try { return fn(view); } catch (e) { warnOnce('view call threw', e); return undefined; }
  };
  const dropView = (e) => {
    warnOnce('view update threw; viewmodel disabled', e);
    try { view.setVisible(false); } catch (_) { /* ignore */ }
    view = null; weapon.view = null;
  };
  // The original view times the pistol's reload only; a view with setWeapon times every one.
  const viewTimed = () => !!(view && view.events) && (cur().id === 'pistol' || typeof view.setWeapon === 'function');

  // ---- loadout
  const giveParam = () => (G.params && G.params.give) || null;
  let L = arsenal.createLoadout(giveParam());
  const defs = [null, null]; // statsFor each slot, refreshed whenever the slot changes
  const refresh = (i) => { defs[i] = L.slots[i] ? statsFor(L.slots[i]) : null; };
  refresh(0); refresh(1);
  const cur = () => L.slots[L.slot];
  const curDef = () => defs[L.slot];
  let swapT = 0, meleeT = 0, throwT = 0;

  function active() {
    const g = G.game;
    const alive = !G.player || G.player.stub || G.player.alive !== false;
    if (g && !g.stub) return g.state === 'playing' && alive;
    return !(G.input && G.input.paused) && alive;
  }

  // One-Tap: any hit kills (the record's health, or plenty when the record is not found); oneTapImmune records (brutes) take the plain amount.
  function amountFor(id, amount) {
    if (!L.mods.instantKill) return amount;
    const list = G.zombies && G.zombies.list;
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r && r.id === id && Number.isFinite(r.health)) return r.oneTapImmune ? amount : Math.max(amount, r.health + 1);
      }
    }
    return Math.max(amount, 1e9);
  }

  const throwables = createThrowables(G, { emit, amount: amountFor });

  // Shot origin and aim: the player's un-bobbed eye and recoil-including forward; the camera if the
  // player is missing. Fills and returns one reused {eye, fwd}: read it before the next call.
  const aimed = { eye: [0, 0, 0], fwd: [0, 0, -1] };
  const set3 = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; };
  function aim() {
    const p = G.player;
    if (p && !p.stub && p.eye && p.forward) {
      set3(aimed.eye, p.eye[0], p.eye[1], p.eye[2]); set3(aimed.fwd, p.forward[0], p.forward[1], p.forward[2]);
      return aimed;
    }
    const cam = G.camera;
    if (cam && cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      set3(aimed.eye, e[12], e[13], e[14]); set3(aimed.fwd, -e[8], -e[9], -e[10]);
      return aimed;
    }
    set3(aimed.eye, 0, tuning.player.eye, 0); set3(aimed.fwd, 0, 0, -1);
    return aimed;
  }

  function moveCtx() {
    const p = G.player && !G.player.stub ? G.player : null;
    const v = (p && p.vel) || [0, 0, 0];
    const adsAmt = view ? (viewCall((w) => w.ads) ?? 0) : (G.input && G.input.ads ? 1 : 0);
    return {
      ads: adsAmt,
      moving: !!(p && p.onGround !== false && Math.hypot(v[0], v[2]) > MOVING_SPEED),
      airborne: !!(p && p.onGround === false),
    };
  }

  function safeCast(obj, origin, dir, max) {
    if (!obj || typeof obj.raycast !== 'function') return null;
    try { return obj.raycast(origin, dir, max) || null; } catch (e) { warnOnce('raycast threw', e); return null; }
  }

  // The first zombie along the ray between `start` and `max` m from the eye, skipping ids already
  // hit by this round (a cast from inside a body can find that body again). Returns the hit (and sets
  // castDist to its distance from the eye) or null. Reuses one origin array: no allocation here.
  const castO = [0, 0, 0];
  let castDist = 0;
  function castZombie(eye, dir, start, max, exclude) {
    let at = start;
    for (let k = 0; k < 8 && at < max; k++) {
      let o = eye;
      if (at > 0) { castO[0] = eye[0] + dir[0] * at; castO[1] = eye[1] + dir[1] * at; castO[2] = eye[2] + dir[2] * at; o = castO; }
      const h = safeCast(G.zombies, o, dir, max - at);
      if (!h || !Number.isFinite(h.dist)) return null;
      const dist = at + h.dist;
      if (dist > max) return null;
      if (!exclude.includes(h.id)) { castDist = dist; return h; }
      at = dist + 0.3;
    }
    return null;
  }

  // Damage one zombie and report it: straight away for a single-ray shot, gathered per zombie for a
  // shotgun's pellets (one hit:zombie per zombie per shot, damage summed). `agg` is a reused array of
  // this shot's reports, emitted and cleared when the shot is done. `pierced`: the round reached this
  // zombie through another one (the report says so: such a hit pays no hit points, only a kill's).
  function damageZombie(id, part, pos, amount, dir, D, source, agg, pierced = false) {
    let res = null;
    const amt = amountFor(id, amount);
    try { res = G.zombies.damage(id, amt, part, dir); } catch (e) { warnOnce('zombies.damage threw', e); }
    const head = part === 'head';
    const damage = res && Number.isFinite(res.damage) ? res.damage : amt * (head ? tuning.walker.headMultiplier : 1);
    const killed = !!(res && res.killed);
    if (agg) {
      for (let i = 0; i < agg.length; i++) {
        const e = agg[i];
        if (e.id !== id) continue;
        e.damage += damage; e.killed = e.killed || killed; e.pierced = e.pierced && pierced;
        if (head) { e.part = 'head'; e.headshot = true; }
        return;
      }
      agg.push({ id, pos, part, damage, killed, headshot: head, dir, weapon: D.id, source, pierced });
      return;
    }
    emit('hit:zombie', { id, pos, part, damage, killed, headshot: head, dir, weapon: D.id, source, pierced });
  }

  // One ray (a bullet or a pellet): the zombies in line it passes through (D.penetration: how many,
  // how far, how much damage each keeps), stopped by the world. A round that is not used up on
  // zombies marks the world where it stops. dirX is the shot's direction as {x,y,z} (the reports').
  const hitIds = [];
  function trace(eye, dir, dirX, D, agg) {
    const wHit = safeCast(G.level, eye, dir, D.range);
    const wd = wHit && Number.isFinite(wHit.dist) && wHit.dist <= D.range ? wHit.dist : Infinity;
    const pen = D.penetration || null;
    const most = (pen ? pen.bodies : D.pierce || 0) + 1;
    const max = Math.min(D.range, wd);
    hitIds.length = 0;
    let n = 0, at = 0, firstAt = 0, first = null, spent = false;
    while (n < most) {
      const h = castZombie(eye, dir, at, max, hitIds);
      if (!h) break;
      const dist = castDist;
      if (!first) { first = h; firstAt = dist; }
      const k = pen ? penetrationScale(n, dist - firstAt, pen) : 1;
      if (!(k > 0)) { spent = true; break; }
      damageZombie(h.id, h.part, xyz(h.pos), D.damage * falloffScale(dist, D.falloff) * k, dirX, D, 'bullet', agg, n > 0);
      hitIds.push(h.id);
      at = dist;
      n++;
    }
    // used up on zombies, or the wall is further past the first body than the round can reach
    if (n >= most || (first && pen && wd - firstAt > pen.reach)) spent = true;
    if (first && D.special && D.special.kind === 'arc') arc(first, D, dirX);
    hitIds.length = 0;
    if (!spent && wd < Infinity) {
      emit('hit:world', { pos: xyz(wHit.pos), normal: xyz(wHit.normal) || { x: 0, y: 1, z: 0 }, surface: wHit.surface || 'concrete' });
    }
  }

  // The Jumper: from the first hit to up to `extra` more zombies, each within `radius` of the last.
  const chain = [];
  function arc(first, D, dirX) {
    const S = D.special;
    const list = (G.zombies && Array.isArray(G.zombies.list) && G.zombies.list) || [];
    let rec = null;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === first.id) { rec = list[i]; break; }
    arcChain(rec || { id: first.id, pos: first.pos }, list, S.extra, S.radius, chain);
    const points = [xyz(first.pos)];
    for (let i = 1; i < chain.length; i++) {
      const r = chain[i];
      const pos = { x: px(r.pos), y: (py(r.pos) || 0) + 1.2, z: pz(r.pos) };
      points.push(pos);
      damageZombie(r.id, 'torso', pos, D.damage * S.scale, dirX, D, 'arc', null);
    }
    chain.length = 0;
    emit('weapon:arc', { weapon: D.id, points });
  }

  function shoot(last, bloom) {
    const D = curDef();
    const s = cur();
    const { eye, fwd } = aim();
    const ctx = moveCtx();
    const dir = spreadDir(fwd, spreadDeg({ bloom }, ctx, D.spread), rng, shotDir);

    const muzzle = viewCall((w) => w.muzzleWorld()) || { x: eye[0] + fwd[0] * 0.5, y: eye[1] + fwd[1] * 0.5 - 0.1, z: eye[2] + fwd[2] * 0.5 };
    const eject = viewCall((w) => w.ejectWorld());
    const fire = { pos: xyz(muzzle), dir: xyz(dir), weapon: D.id, pellets: D.pellets, upgraded: D.upgraded, suppressed: !!D.suppressed };
    if (eject) fire.eject = xyz(eject);
    emit('weapon:fire', fire);
    if (!G.fx || G.fx.stub) { // fx drives the muzzle light itself; only do it when fx is missing
      try { G.lights && G.lights.setMuzzleFlash && G.lights.setMuzzleFlash(fire.pos, D.suppressed ? 0.3 : 1); } catch (e) { warnOnce('muzzle flash threw', e); }
    }
    viewCall((w) => w.play('fire', { last }));
    viewCall((w) => w.setRounds(s.mag));

    const p = G.player;
    if (p && !p.stub) {
      const R = D.recoil;
      const k = 1 - (1 - R.adsScale) * ctx.ads;
      try {
        if (p.addRecoil) p.addRecoil(rng.range(R.pitchMin, R.pitchMax) * k, rng.range(-R.yaw, R.yaw) * k);
        if (p.addShake) p.addShake(R.shake + (R.adsShake - R.shake) * ctx.ads);
      } catch (e) { warnOnce('recoil threw', e); }
    }

    if (D.special && D.special.kind === 'flare') {
      // the Roadflare is a lobbed round, not a hit scan: throwables.js flies it, bursts it and burns
      throwables.launch('flare', eye, dir, null, D.special, { damage: D.damage, weapon: D.id, upgraded: D.upgraded });
    } else if (D.pellets > 1) {
      aggList.length = 0;
      for (let i = 0; i < D.pellets; i++) trace(eye, spreadDir(dir, D.spread.pellet || 0, rng, pelletDir), fire.dir, D, aggList);
      for (let i = 0; i < aggList.length; i++) emit('hit:zombie', aggList[i]);
      aggList.length = 0;
    } else trace(eye, dir, fire.dir, D, null);
  }
  const shotDir = [0, 0, -1], pelletDir = [0, 0, -1], aggList = [];

  function checkAmmo(i) {
    const s = L.slots[i], D = defs[i];
    if (!s || !D) return;
    if (s.reserve > D.mag) s.lowSent = false;
    else if (!s.lowSent) { s.lowSent = true; emit('weapon:low', { weapon: s.id, reserve: s.reserve }); }
    if (s.mag > 0 || s.reserve > 0) s.emptySent = false;
    else if (!s.emptySent) { s.emptySent = true; emit('weapon:empty', { weapon: s.id }); }
  }

  function handle(events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'fire') { shoot(e.last, e.bloom); checkAmmo(L.slot); }
      else if (e.type === 'dry') emit('weapon:fire', { dry: true, weapon: cur().id });
      else if (e.type === 'reload') { magIn = false; shellIn = false; emit('weapon:reload', { weapon: cur().id }); viewCall((w) => w.play('reload')); }
      else if (e.type === 'ammo') { viewCall((w) => w.setRounds(cur().mag)); checkAmmo(L.slot); }
      else if (e.type === 'reloadCancel') {
        // The original view has no cancel: a draw replaces its reload timeline (so its magIn never fires).
        viewCall((w) => w.play('draw'));
        viewCall((w) => w.setRounds(cur().mag));
      }
    }
  }

  // Per-frame state is reused: no allocation in tick while nothing happens.
  const pressed = (n) => { const i = G.input; return !!(i && typeof i.pressed === 'function' && i.pressed(n)); };
  const inp = { fire: false, press: false, reload: false, sprint: false, active: false, busy: false, viewTimed: false, magIn: false, shellIn: false, reloadScale: 1 };
  const evBuf = [];
  let ticking = false;

  function tick(dt, fire, reload) {
    let press = fire;
    if (dt > 0) {
      press = press || pressed('fire');
      reload = reload || pressed('reload');
      fire = press || (!!curDef().auto && !!(G.input && G.input.fire));
    } else if (!fire && !reload) return; // no time passed (paused): nothing may change, least of all a reload being cancelled
    const s = cur();
    if (!fire && !reload && !s.reloading && !s.buffered && s.cooldown <= 0 && s.bloom === 0) {
      s.cooldown = 0; magIn = false; shellIn = false;
      return; // idle: nothing to advance
    }
    const p = G.player && !G.player.stub ? G.player : null;
    inp.fire = fire; inp.press = press; inp.reload = reload;
    inp.sprint = !!(p && p.sprinting);
    inp.active = active();
    inp.busy = swapT > 0 || meleeT > 0 || throwT > 0;
    inp.viewTimed = viewTimed();
    inp.magIn = magIn; inp.shellIn = shellIn;
    inp.reloadScale = L.mods.reloadScale;
    magIn = false; shellIn = false;
    // An event handler may call fire()/reload() again: the nested call gets its own buffer.
    const buf = ticking ? [] : evBuf;
    const outer = !ticking;
    ticking = true;
    try { handle(step(s, inp, dt, curDef(), buf)); } finally { if (outer) ticking = false; }
  }

  // ---- switching, speed

  function applySpeed() {
    const p = G.player;
    if (!p || p.stub) return;
    const k = curDef().moveScale ?? 1;
    try { if (typeof p.setSpeedScale === 'function') p.setSpeedScale('weapon', k); } catch (e) { warnOnce('setSpeedScale threw', e); }
  }

  function stopReload(s) {
    if (!s || !s.reloading) return false;
    s.reloading = false; s.reloadT = 0;
    return true;
  }

  // Bring the held slot up: the view swaps (or plays its draw), and the gun cannot fire until it is up.
  function raise(fromId) {
    const s = cur();
    magIn = false; shellIn = false;
    const t = viewCall((w) => (typeof w.setWeapon === 'function'
      ? w.setWeapon(s.id, { upgraded: s.upgraded, attachments: s.attachments })
      : w.play('draw')));
    swapT = Number.isFinite(t) && t > 0 ? t : TW.swapTime;
    viewCall((w) => w.setRounds(s.mag));
    applySpeed();
    emit('weapon:switch', { from: fromId, to: s.id, slot: L.slot });
  }

  function switchTo(i) {
    if ((i !== 0 && i !== 1) || i === L.slot || !L.slots[i]) return false;
    const from = cur();
    stopReload(from); // a switch never grants the reload's ammo
    from.buffered = false;
    L.slot = i;
    raise(from.id);
    return true;
  }

  function give(id, o = {}) {
    const held = L.slot;
    const r = arsenal.give(L, id, o);
    if (!r) return null;
    refresh(r.slot);
    if (r.slot !== held) switchTo(r.slot);
    else if (r.replaced !== null) raise(r.replaced); // a new weapon in the hands
    else { viewCall((w) => w.setRounds(cur().mag)); }
    return r;
  }

  // ---- melee and throwing

  const targets = [];
  function swing() {
    if (!active() || meleeT > 0 || swapT > 0) return false;
    const M = arsenal.meleeDef(L);
    const s = cur();
    if (stopReload(s)) { viewCall((w) => w.play('draw')); viewCall((w) => w.setRounds(s.mag)); }
    s.buffered = false;
    meleeT = M.time;
    const { eye, fwd } = aim();
    const list = (G.zombies && Array.isArray(G.zombies.list) && G.zombies.list) || [];
    meleeTargets(eye, fwd, list, M, targets);
    const n = targets.length;
    const melee = { hit: n > 0, kind: L.melee };
    if (n > 0) melee.id = targets[0].id;
    emit('weapon:melee', melee);
    viewCall((w) => w.play('swing'));
    if (n > 0 && typeof G.zombies.damage === 'function') {
      const fl = Math.hypot(fwd[0], fwd[2]) || 1;
      const dir = { x: fwd[0] / fl, y: 0, z: fwd[2] / fl };
      const D = { id: L.melee };
      for (let i = 0; i < n; i++) {
        const r = targets[i];
        damageZombie(r.id, 'torso', { x: px(r.pos), y: (py(r.pos) || 0) + 1.2, z: pz(r.pos) }, M.damage, dir, D, 'melee', null);
      }
    }
    targets.length = 0;
    return true;
  }

  function throwOne() {
    if (!active() || throwT > 0 || swapT > 0) return false;
    let k = L.throwable;
    if (!(L.throwables[k] > 0)) {
      k = arsenal.nextThrowable(L, k);
      if (!(L.throwables[k] > 0)) return false;
      L.throwable = k;
    }
    const { eye, fwd } = aim();
    const p = G.player && !G.player.stub ? G.player : null;
    if (!throwables.launch(k, eye, fwd, p && p.vel)) return false;
    L.throwables[k] -= 1;
    throwT = TW.throwables.cooldown;
    const s = cur();
    if (stopReload(s)) viewCall((w) => w.setRounds(s.mag));
    viewCall((w) => w.play('throw'));
    return true;
  }

  // ---- game state

  let lastState = G.game && G.game.state;
  if (G.events && G.events.on) {
    G.events.on('game:state', (e) => {
      const st = e && e.state;
      if (st === 'playing' && lastState !== 'playing' && lastState !== 'paused') weapon.reset();
      // nobody is holding a weapon on the title screen
      // (lastState is undefined until the first event when the weapon is built before the game,
      // which is the boot order: that first state was the title too)
      if (st === 'title' || lastState === 'title' || lastState === undefined) weapon.setVisible(st !== 'title');
      lastState = st;
    });
  }

  const ammo = {
    get mag() { return cur().mag; },
    get reserve() { return cur().reserve; },
  };

  applySpeed();

  const weapon = {
    get id() { return cur().id; },
    get name() { return curDef().name; },
    get def() { return curDef(); },
    ammo,
    view,
    get reloading() { return cur().reloading; },
    get state() { return cur(); }, // the held slot (raw fire-control state, for debug and tests)
    get slots() { return L.slots; },
    get slot() { return L.slot; },
    get melee() { return L.melee; },
    get throwables() { return L.throwables; },
    get throwable() { return L.throwable; },
    set throwable(k) { if (arsenal.THROWABLES.includes(k)) L.throwable = k; },
    get mods() { return L.mods; },
    statsFor,
    give,
    has: (id) => arsenal.indexOf(L, id) >= 0,
    switchTo,
    fire() { tick(0, true, false); },
    reload() { tick(0, false, true); },
    swing,
    throw: throwOne,
    // Adds up to n rounds (n omitted: to the max) to weapon `id` (omitted: the held one). Returns the number added.
    addReserve(n, id) { return arsenal.addReserve(L, n, id); },
    fillAll() { return arsenal.fillAll(L); },
    upgrade(id) {
      const i = id === undefined || id === null ? L.slot : arsenal.indexOf(L, id);
      if (!arsenal.upgrade(L, id)) return false;
      refresh(i);
      viewCall((w) => w.refresh && w.refresh(L.slots[i].id, { upgraded: L.slots[i].upgraded, attachments: L.slots[i].attachments }));
      if (i === L.slot) viewCall((w) => w.setRounds(cur().mag));
      return true;
    },
    attach(kind) {
      if (!arsenal.attach(L, kind)) return false;
      refresh(L.slot);
      viewCall((w) => w.refresh && w.refresh(cur().id, { upgraded: cur().upgraded, attachments: cur().attachments }));
      return true;
    },
    addThrowable(kind, n = 1) { return arsenal.addThrowable(L, kind, n); },
    setMelee(kind) { if (arsenal.MELEE.includes(kind)) L.melee = kind; },
    // Show or hide the viewmodel (the title screen hides it; ?noweapon=1 keeps it hidden).
    setVisible(on) { viewCall((w) => w.setVisible(!!on && !(G.params && G.params.noweapon))); },
    // A new game: [pistol, null] (or the `give=` loadout), the knife, no throwables, no mods.
    reset() {
      const old = cur();
      const was = old.reloading;
      const mods = L.mods;
      L = arsenal.createLoadout(giveParam());
      Object.assign(mods, L.mods);
      L.mods = mods;
      refresh(0); refresh(1);
      swapT = 0; meleeT = 0; throwT = 0;
      magIn = false; shellIn = false;
      throwables.reset();
      if (old.id !== cur().id && view && typeof view.setWeapon === 'function') viewCall((w) => w.setWeapon(cur().id, { upgraded: false, attachments: cur().attachments }));
      else {
        viewCall((w) => w.refresh && w.refresh(cur().id, { upgraded: false, attachments: cur().attachments }));
        if (was) viewCall((w) => w.play('draw'));
      }
      viewCall((w) => w.setRounds(cur().mag));
      applySpeed();
    },
    update(dt) {
      if (dt > 0) {
        swapT = Math.max(0, swapT - dt); meleeT = Math.max(0, meleeT - dt); throwT = Math.max(0, throwT - dt);
        const s1 = pressed('slot1'), s2 = pressed('slot2'), sw = pressed('swap');
        const me = pressed('melee'), th = pressed('throw'), cy = pressed('cycle');
        if ((s1 || s2 || sw || me || th || cy) && active()) {
          if (s1) switchTo(0); else if (s2) switchTo(1); else if (sw) switchTo(1 - L.slot);
          if (cy) L.throwable = arsenal.nextThrowable(L);
          if (me) swing();
          if (th) throwOne();
        }
      }
      tick(dt, false, false);
      throwables.update(dt);
      const p = G.player && !G.player.stub ? G.player : null;
      const ads = !!(G.input && G.input.ads) && active() && !cur().reloading && !(p && p.sprinting);
      if (view) {
        try { view.setAds(ads ? 1 : 0); view.update(dt); } catch (e) { dropView(e); }
      }
      // nothing else writes the zoom when there is no view
      if (!view && p) p.fovScale = ads ? curDef().zoom : 1;
    },
  };
  return weapon;
}
