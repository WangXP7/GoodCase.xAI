// Game events -> sounds. makeHandlers(env) returns one handler per bound event plus
// update(t), the per-frame part (zombie idle voices, brute footfalls, crawlers, swelling bloaters,
// window climbs, the flare in flight, the decoy's chatter, rain on the nearest car, reload cancel).
// env: { gr (graph), rng, G, findRec(id), world (createWorldState()), occl(pos) -> 0|1|2,
// surfaceAt(pos, given) -> floor name }. Every handler tolerates a missing payload field.
import { WEAPON_PLAN } from './weapons.js';
import { TYPE_VOICE } from './voices.js';
import { searchSound } from './foley.js';

const ZERO = [0, 0, 0];
const arr = (p) => (!p ? null : Array.isArray(p) ? p : [p.x ?? 0, p.y ?? 0, p.z ?? 0]);
const px = (p) => (Array.isArray(p) ? p[0] : p.x), py = (p) => (Array.isArray(p) ? p[1] : p.y), pz = (p) => (Array.isArray(p) ? p[2] : p.z);
const byId = (list, id) => { if (!Array.isArray(list)) return null; for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; return null; };
const MAX_PARTS = 16;

// Mutable state the handlers keep between events; reset by a new game (round 1).
export function createWorldState() {
  return {
    reload: { parts: Array.from({ length: MAX_PARTS }, () => ({ h: null, at: 0 })), n: 0, start: 0, weapon: '' },
    rummage: null, rummageId: null,
    flare: null, // { h, t0, x, y, z, vx, vy, vz, g }
    decoy: null,
    zombies: new Map(), // id -> { idleAt, stepAt, dragAt, state, x, z }
    lastPain: new Map(),
    plates: -1,
    car: { h: null, id: null, checkAt: 0 },
    lastHit: 0,
  };
}

export function makeHandlers(env) {
  const { gr, rng, G, findRec, world: W } = env;
  const occl = env.occl || (() => 0);
  const play = (name, opts, when) => gr.play(name, opts, when);
  // a positional play with occlusion worked out from the listener
  const at = (name, pos, when, opts = {}) => { const p = arr(pos); opts.pos = p || undefined; if (p && opts.occl === undefined) opts.occl = occl(p); return play(name, opts, when); };
  const ring = () => {
    const a = rng.next() * Math.PI * 2, r = rng.range(10, 22), l = gr.listener.pos;
    return [l[0] + Math.cos(a) * r, 0, l[2] + Math.sin(a) * r];
  };
  const zpos = (p) => arr(p && p.pos) || arr(findRec(p && p.id)?.pos) || ring();
  const typeOf = (p) => (p && p.type) || findRec(p && p.id)?.type || 'walker';
  const plan = (id) => WEAPON_PLAN[id] || WEAPON_PLAN.pistol;
  const level = () => (G && G.level) || null;
  const gore = () => (G && G.fx && Number.isFinite(G.fx.gore) ? G.fx.gore : 1);

  // ---- weapon

  function cancelReload(when, all) {
    const R = W.reload;
    for (let i = 0; i < R.n; i++) {
      const part = R.parts[i];
      if (part.h && (all || part.at > when)) gr.stop(part.h, when, 0.012);
      part.h = null;
    }
    R.n = 0;
  }
  function reloadTime(id) {
    const wpn = G && G.weapon, def = wpn && wpn.def;
    const base = def && def.id === id && Number.isFinite(def.reload) ? def.reload : plan(id).reload;
    const k = wpn && wpn.mods && Number.isFinite(wpn.mods.reloadScale) ? wpn.mods.reloadScale : 1;
    return base * k;
  }
  function schedule(name, when, pitch) {
    const R = W.reload;
    if (R.n >= MAX_PARTS) return;
    const part = R.parts[R.n++];
    part.at = when; part.h = play(name, { pitch: pitch || 1 }, when);
  }

  const H = {
    'weapon:fire': (p = {}, when) => {
      const id = WEAPON_PLAN[p.weapon] ? p.weapon : 'pistol';
      if (p.dry || p.empty) { play(`${id}:dry`, {}, when); return; }
      cancelReload(when, true); // firing cancels a reload (a shotgun's shell-by-shell)
      const P = plan(id);
      play(p.suppressed ? `${id}:shot:suppressed` : p.upgraded ? `${id}:shot:upgraded` : `${id}:shot`, {}, when);
      const A = gr.area, fam = A === 'canopy' || A === 'walkway' ? 'canopy' : A === 'open' || A === 'scrapyard' ? 'open' : 'room';
      const quiet = p.suppressed ? 0.3 : 1;
      if (fam === 'canopy') play('pistol_tail_canopy', { gain: (P.size === 'heavy' ? 1.3 : P.size === 'medium' ? 1.1 : 0.9) * quiet }, when + 0.003);
      else play(fam === 'open' ? `${id}:tail-open` : `${id}:tail-room`, { gain: quiet }, when + 0.003);
      // brass (and a shotgun's hull, later, as the action cycles) lands about a metre to the right
      if (id === 'revolver' || id === 'jumper' || id === 'flare') return;
      const o = arr(p.pos) || gr.listener.pos, d = arr(p.dir) || [0, 0, -1];
      const right = [-d[2], 0, d[0]], len = Math.hypot(right[0], right[2]) || 1;
      const cp = [o[0] + (right[0] / len) * 0.9, (o[1] || 1.6) - 1.55, o[2] + (right[2] / len) * 0.9];
      const shell = id === 'pump' || id === 'autoShotgun';
      play('casing', { pos: cp, pitch: shell ? 0.55 : id === 'lmg' || id === 'battleRifle' ? 0.85 : 1, gain: shell ? 1.3 : 1 }, when + (id === 'pump' ? 0.62 : 0) + rng.range(0.38, 0.55));
    },
    'weapon:dry': (p = {}, when) => play(`${WEAPON_PLAN[p.weapon] ? p.weapon : 'pistol'}:dry`, {}, when),
    'weapon:reload': (p = {}, when) => {
      const id = WEAPON_PLAN[p.weapon] ? p.weapon : (G && G.weapon && G.weapon.id) || 'pistol';
      const P = plan(id), T = reloadTime(id);
      cancelReload(when, true);
      W.reload.start = when; W.reload.weapon = id;
      if (P.parts) { for (const [name, f, pitch] of P.parts) schedule(name, when + f * T, pitch); return; }
      // shell by shell: one per missing round the reserve can fill
      const wpn = G && G.weapon, def = wpn && wpn.def;
      let shells = 4;
      if (wpn && wpn.ammo && def && Number.isFinite(def.mag)) shells = Math.max(1, Math.min(def.mag - wpn.ammo.mag, wpn.ammo.reserve ?? 99));
      const first = (def && Number.isFinite(def.shellStart) ? def.shellStart : P.shellStart) * (T / P.reload);
      for (let k = 0; k < shells && k < MAX_PARTS - 1; k++) schedule(P.shell.each, when + first + k * T, 1 + rng.range(-0.03, 0.03));
      schedule(P.shell.end, when + first + shells * T - T * 0.3);
    },
    'weapon:switch': (p, when) => { cancelReload(when, true); play('weapon_draw', {}, when); },
    'weapon:melee': (p = {}, when) => play(p.kind === 'axe' ? 'swing_axe' : 'swing_knife', {}, when),
    throw: (p = {}, when) => {
      play('throw_whoosh', {}, when);
      if (p.kind === 'frag') play('pin_pull', {}, when - 0.02 > 0 ? when - 0.02 : when);
      else if (p.kind === 'molotov') play('bottle_slosh', {}, when);
      else if (p.kind === 'decoy') play('decoy_arm', {}, when + 0.05);
    },
    explosion: (p = {}, when) => {
      const pos = arr(p.pos);
      if (!pos) return;
      if (p.kind === 'burst') return; // a bloater: zombie:burst plays it
      if (p.kind === 'decoy') { at('explosion_small', pos, when); return; }
      at('explosion', pos, when, { prio: 2 });
      const l = gr.listener.pos, d = Math.hypot(pos[0] - l[0], pos[2] - l[2]);
      if (d > 12) at('explosion_far', pos, when + d / 343, { gain: Math.min(1, (d - 12) / 20) });
    },
    'fire:pool': (p = {}, when) => {
      const pos = arr(p.pos);
      if (!pos) return;
      const secs = Number.isFinite(p.seconds) ? p.seconds : 6;
      if (p.kind !== 'flare') { at('glass_smash', pos, when); at('fire_ignite', pos, when + 0.03); }
      at('fire_loop', pos, when + 0.15, { loop: true, seconds: secs, fadeIn: 0.4, offset: rng.next() * 4 });
    },
    'flare:launch': (p = {}, when) => {
      const pos = arr(p.pos), vel = arr(p.vel);
      if (!pos || !vel) return;
      if (W.flare) gr.stop(W.flare.h, when, 0.05);
      const h = play('flare_whoosh', { pos, loop: true, seconds: 4.5, fadeIn: 0.05 }, when);
      W.flare = { h, t0: when, id: p.id, x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2], g: Number.isFinite(p.gravity) ? p.gravity : 3 };
    },
    'flare:burst': (p = {}, when) => {
      if (W.flare && (p.id === undefined || p.id === W.flare.id)) { gr.stop(W.flare.h, when, 0.03); W.flare = null; }
      const pos = arr(p.pos);
      if (pos) at('flare_burst', pos, when);
    },
    'weapon:arc': (p = {}, when) => {
      const pts = Array.isArray(p.points) ? p.points : [];
      for (let i = 1; i < pts.length && i < 8; i++) at('arc_zap', pts[i], when + 0.012 * i);
    },

    // ---- hits and blood

    'hit:world': (p = {}, when) => {
      const pos = arr(p.pos);
      if (!pos) return; // ledger: a hit without a position is dropped
      const name = { metal: 'impact_metal', glass: 'impact_glass', flesh: 'impact_flesh', cloth: 'impact_flesh' }[p.surface] || 'impact_hard';
      at(name, pos, when, { gain: name === 'impact_flesh' ? 0.5 : 1 });
    },
    'hit:zombie': (p = {}, when) => {
      const pos = zpos(p);
      const src = p.source || 'bullet';
      if (src === 'fire') return; // a burning tick every frame: the fire loop carries it
      if (src === 'melee') at(p.weapon === 'axe' ? 'melee_chop' : 'melee_stab', pos, when);
      else if (src === 'arc') { /* weapon:arc plays the zaps */ } else at(p.part === 'head' ? 'impact_head' : 'impact_flesh', pos, when, { gain: src === 'explosion' ? 0.5 : 1 });
      if (p.killed && (p.headshot || p.part === 'head') && src !== 'fire') at('head_burst', pos, when + 0.005, { gain: 0.3 + 0.7 * gore() });
      const type = typeOf(p);
      if (!p.killed && when - (W.lastPain.get(p.id) ?? -9) > 0.7 && rng.next() < 0.65) {
        W.lastPain.set(p.id, when);
        if (type === 'brute') at('brute_growl', pos, when + 0.05, { gain: 0.7, pitch: 1.2 });
        else if (type === 'bloater') at('bloater_gurgle', pos, when + 0.05, { gain: 0.6, pitch: 1.3 });
        else at('zombie_pain', pos, when + rng.range(0.03, 0.08), { pitch: type === 'runner' ? 1.2 : 1, lowpass: type === 'armoured' ? 900 : undefined });
      }
    },
    'zombie:sever': (p = {}, when) => at('sever', zpos(p), when, { gain: 0.4 + 0.6 * gore() }),
    'zombie:burst': (p = {}, when) => {
      const pos = zpos(p);
      at('bloater_burst', pos, when);
      at('gas_hiss', pos, when + 0.3, { loop: true, seconds: 6, fadeIn: 0.5 });
    },

    // ---- zombies

    'zombie:spawn': (p = {}, when) => {
      const type = typeOf(p), V = TYPE_VOICE[type] || TYPE_VOICE.walker;
      const pos = zpos(p), t = when + rng.range(0, 0.4);
      at(V.spawn, pos, t);
      if (type === 'brute') gr.duckFor(1.6, t);
      if (V.layer) at(V.layer, pos, t + 0.1);
    },
    'zombie:attack': (p = {}, when) => {
      const type = typeOf(p), V = TYPE_VOICE[type] || TYPE_VOICE.walker, pos = zpos(p);
      if (p.kind === 'slam') { at('brute_slam', pos, when + 0.35); gr.duckFor(1.0, when + 0.35, 0.55); }
      at(V.attack, pos, when, { prio: 2 });
      if (type === 'brute' && p.kind !== 'slam') gr.duckFor(1.4, when);
      if (V.layer) at(V.layer, pos, when);
    },
    'zombie:die': (p = {}, when) => {
      W.lastPain.delete(p.id); W.zombies.delete(p.id);
      const type = typeOf(p), pos = zpos(p);
      if (p.cause === 'burst' || type === 'bloater') return; // the burst is the death
      at('zombie_death', pos, when + 0.04, { pitch: type === 'brute' ? 0.62 : type === 'runner' ? 1.12 : p.headshot ? 1.06 : 1, lowpass: type === 'armoured' ? 1000 : undefined, gain: type === 'brute' ? 1.6 : 1 });
      if (type === 'brute') at('brute_step', pos, when + 0.9, { pitch: 0.8, gain: 1.4 });
      if (type === 'armoured') at('gear_rattle', pos, when + 0.6, { gain: 1.5 });
      // the pool forming under the body
      if (gore() >= 1) for (let k = 0; k < 3; k++) at('drip', pos, when + rng.range(1.5, 6));
    },
    'zombie:remove': (p = {}) => { W.zombies.delete(p.id); W.lastPain.delete(p.id); },
    'board:break': (p = {}, when) => { const w = byId(level()?.windows, p.id); at('board_break', w ? w.pos : ZERO, when); },
    'board:repair': (p = {}, when) => { const w = byId(level()?.windows, p.id); at('board_hammer', w ? w.pos : ZERO, when); },

    // ---- the player

    'player:damage': (p = {}, when) => play('player_hurt', { gain: Math.min(1.2, 0.5 + (p.amount ?? 34) / 60) }, when),
    step: (p = {}, when) => {
      const pos = arr(p.pos);
      play(`step_${env.surfaceAt ? env.surfaceAt(pos, p.surface) : 'asphalt'}`, { pos: pos || undefined }, when);
    },
    'armor:change': (p = {}, when) => {
      const n = Number(p.plates);
      if (Number.isFinite(n) && W.plates >= 0 && n > W.plates) play('armor_plate', {}, when);
      if (Number.isFinite(n)) W.plates = n;
    },
    revive: (p, when) => play('revive', {}, when),

    // ---- rounds, economy, world

    'round:start': (p = {}, when) => {
      if (p.n === 1) H.reset(when);
      play(p.boss ? 'sting_boss' : 'sting_round_start', {}, when);
    },
    'round:end': (p, when) => play('sting_round_end', {}, when),
    buy: (p = {}, when) => {
      if (p.ok === false || p.denied) { play('denied2', {}, when); return; }
      if (p.item === 'box') return; // the roll is the sound
      play('purchase2', {}, when);
    },
    'buy:denied': (p, when) => play('denied2', {}, when),
    'door:open': (p = {}, when) => {
      const d = byId(level()?.doors, p.id);
      const look = d && d.look;
      at(look === 'roller' ? 'door_roller' : look === 'sheet' ? 'door_sheet' : 'door_boarded', d ? d.pos : undefined, when + 0.1, { occl: 0 });
    },
    'power:on': (p, when) => {
      const pw = level()?.power;
      at('knife_switch', pw && pw.pos, when, { occl: 0 });
      play('power_hum', {}, when + 0.3);
      gr.ambience.setPower(true, when + 0.3);
    },
    'search:start': (p = {}, when) => {
      if (W.rummage) gr.stop(W.rummage, when, 0.01);
      const s = byId(level()?.searchables, p.id);
      W.rummage = at(`rummage_${searchSound(s && s.kind)}`, s ? s.pos : undefined, when, { loop: true, seconds: 3, fadeIn: 0.05, occl: 0 });
      W.rummageId = p.id;
    },
    'search:cancel': (p = {}, when) => { if (W.rummage) gr.stop(W.rummage, when, 0.008); W.rummage = null; }, // stops dead
    'search:done': (p = {}, when) => {
      if (W.rummage) gr.stop(W.rummage, when, 0.02);
      W.rummage = null;
      const s = byId(level()?.searchables, p.id), pos = s ? s.pos : undefined;
      at(`open_${searchSound(s && s.kind)}`, pos, when, { occl: 0 });
      const kind = p.reward && p.reward.kind;
      const r = { ammo: 'ammo', points: 'points', medkit: 'medkit', throwable: 'throwable', plate: 'plate', powerup: 'powerup', attachment: 'attachment', weapon: 'weapon' }[kind] || 'nothing';
      play(`reward_${r}`, {}, when + 0.3);
    },
    'pickup:take': (p, when) => play('pickup', {}, when),
    'box:roll': (p = {}, when) => at('box_roll', boxPos(p.spot), when, { occl: 0 }),
    'box:result': (p, when) => at('box_reveal', boxPos(), when, { occl: 0 }),
    'box:take': (p = {}, when) => at('box_take', boxPos(p.spot), when, { occl: 0 }),
    'box:expire': (p = {}, when) => at('box_expire', boxPos(p.spot), when),
    'box:move': (p = {}, when) => { if (p.from) at('box_move', boxPos(p.from), when); },
    'bench:upgrade': (p, when) => { const b = level()?.benchSpot; at('bench_grind', b && (b.pos || b), when, { occl: 0 }); },
    'machine:buy': (p = {}, when) => { const m = byId(level()?.machineSpots, p.kind); at('machine_buy', m && m.pos, when, { occl: 0 }); },
    'powerup:drop': (p = {}, when) => at('powerup_drop', p.pos, when),
    'powerup:take': (p = {}, when) => { const k = p.kind; if (k === 'resupply' || k === 'oneTap' || k === 'doubleTime' || k === 'flashover') play(`sting_${k}`, {}, when); },
    'powerup:end': (p, when) => play('powerup_end', {}, when),
    'powerup:lapse': (p = {}, when) => play('powerup_lapse', { gain: 0.6 }, when),
    'hint:show': (p, when) => play('hint_blip', {}, when),
    'game:state': (p = {}, when) => {
      gr.setState(p.state, when);
      if (p.state !== 'playing') cancelReload(when, false);
      if (p.state === 'title') H.reset(when);
    },

    // a new game: every loop and timer from the last one goes
    reset(when) {
      cancelReload(when, true);
      if (W.rummage) gr.stop(W.rummage, when, 0.02);
      if (W.flare) gr.stop(W.flare.h, when, 0.02);
      if (W.decoy) gr.stop(W.decoy, when, 0.05);
      if (W.car.h) gr.stop(W.car.h, when, 0.2);
      W.rummage = null; W.flare = null; W.decoy = null; W.car.h = null; W.car.id = null;
      W.zombies.clear(); W.lastPain.clear(); W.plates = -1;
    },

    // ---- per frame (no allocation unless a sound starts)
    update(t) {
      // reload cancelled by something with no event of its own (sprint, the game leaving 'playing')
      const wpn = G && G.weapon;
      if (W.reload.n && wpn && wpn.reloading === false && t - W.reload.start > 0.2) cancelReload(t, false);
      // the flare in flight, analytically (pos + vel t + 1/2 g t^2)
      const F = W.flare;
      if (F) {
        const s = t - F.t0;
        if (s > 4.5) W.flare = null;
        else gr.setPos(F.h, F.x + F.vx * s, F.y + F.vy * s - 0.5 * F.g * s * s, F.z + F.vz * s, t);
      }
      // the decoy calling where the lure is
      const lure = G && G.zombies && G.zombies.lure;
      if (lure && lure.on) {
        if (!W.decoy) W.decoy = play('decoy_chatter', { pos: [lure.x, lure.y + 0.2, lure.z], loop: true, fadeIn: 0.2 }, t);
        else gr.setPos(W.decoy, lure.x, lure.y + 0.2, lure.z, t);
      } else if (W.decoy) { gr.stop(W.decoy, t, 0.15); W.decoy = null; }
      rainOnCar(t);
      zombiesTick(t);
    },
  };

  function boxPos(spot) {
    const b = G && G.game && G.game.box;
    if (b && b.pos) return b.pos;
    const s = byId(level()?.boxSpots, spot);
    return s ? s.pos : undefined;
  }

  // Rain drumming on the nearest car within 7 m, in the open (checked twice a second).
  function rainOnCar(t) {
    const C = W.car;
    if (t < C.checkAt) return;
    C.checkAt = t + 0.5;
    const list = level()?.searchables, l = gr.listener.pos;
    let best = null, bd = 49;
    const outside = gr.area === 'open' || gr.area === 'scrapyard';
    if (outside && Array.isArray(list)) for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || s.kind !== 'car' || !s.pos) continue;
      const dx = px(s.pos) - l[0], dz = pz(s.pos) - l[2], d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = s; }
    }
    if (best && best.id !== C.id) {
      if (C.h) gr.stop(C.h, t, 0.6);
      C.h = play('rain_car', { pos: best.pos, loop: true, fadeIn: 1, prio: 0, gain: 1 }, t);
      C.id = best.id;
    } else if (!best && C.h) { gr.stop(C.h, t, 0.6); C.h = null; C.id = null; }
  }

  // Idle voices by type, brute footfalls, crawlers dragging, the bloater's swell, window climbs.
  function zombiesTick(t) {
    const z = G && G.zombies;
    const list = z && Array.isArray(z.list) ? z.list : null;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.id === undefined || r.alive === false || r.dead || !r.pos) continue;
      let s = W.zombies.get(r.id);
      if (!s) { s = { idleAt: t + rng.range(1, 6), stepAt: t, dragAt: t + rng.range(0.3, 1), state: r.state, x: px(r.pos), z: pz(r.pos), v: 0 }; W.zombies.set(r.id, s); continue; }
      const x = px(r.pos), zz = pz(r.pos), y = py(r.pos) || 0;
      const moved = Math.hypot(x - s.x, zz - s.z);
      s.v = s.v * 0.8 + moved * 0.2; s.x = x; s.z = zz;
      const type = r.type || 'walker', V = TYPE_VOICE[type] || TYPE_VOICE.walker;
      // state changes
      if (r.state !== s.state) {
        if ((r.state === 'climb' || r.state === 'window') && s.state !== 'climb' && s.state !== 'window') playAt('window_climb', x, y, zz, t);
        if (r.state === 'burst') playAt('bloater_swell', x, y + 1, zz, t);
        s.state = r.state;
      }
      // idle voice (a runner pants more often)
      if (t >= s.idleAt) {
        if (r.state !== 'burst') playAt(V.idle, x, y + 1.5, zz, t, 0.8);
        if (V.layer && rng.next() < 0.5) playAt(V.layer, x, y + 1, zz, t + 0.2);
        s.idleAt = t + (type === 'runner' ? rng.range(2, 4) : rng.range(4, 9));
      }
      // a brute's footfalls, a crawler dragging itself
      if (type === 'brute' && s.v > 0.01 && t >= s.stepAt) { playAt('brute_step', x, y, zz, t); s.stepAt = t + 0.55; }
      if (r.crawling && s.v > 0.004 && t >= s.dragAt) { playAt('crawler_drag', x, y, zz, t); s.dragAt = t + rng.range(1.1, 1.7); }
    }
  }
  const tmp = [0, 0, 0];
  function playAt(name, x, y, z, t, gain) {
    tmp[0] = x; tmp[1] = y; tmp[2] = z;
    const o = occl(tmp);
    return play(name, { pos: [x, y, z], occl: o, gain }, t);
  }

  return H;
}

// Events bound above (game:state and the rest are subscribed to by the engine).
export const EVENTS = [
  'weapon:fire', 'weapon:dry', 'weapon:reload', 'weapon:switch', 'weapon:melee', 'throw', 'explosion', 'fire:pool',
  'flare:launch', 'flare:burst', 'weapon:arc', 'hit:world', 'hit:zombie', 'zombie:sever', 'zombie:burst',
  'zombie:spawn', 'zombie:attack', 'zombie:die', 'zombie:remove', 'board:break', 'board:repair', 'player:damage',
  'step', 'armor:change', 'revive', 'round:start', 'round:end', 'buy', 'buy:denied', 'door:open', 'power:on',
  'search:start', 'search:cancel', 'search:done', 'pickup:take', 'box:roll', 'box:result', 'box:take', 'box:expire',
  'box:move', 'bench:upgrade', 'machine:buy', 'powerup:drop', 'powerup:take', 'powerup:end', 'powerup:lapse',
  'hint:show', 'game:state',
];

// ------------------------------------------------------------------ scripted test (20 s)
// Positions are relative to the listener (facing -Z, right is +X). Used by ?audiotest=1 (through
// the event bus) and by the offline mix check in scripts/audio-render.mjs.
export const TEST_SCRIPT = [
  { t: 2.5, ev: 'round:start', p: { n: 1, total: 10 } },
  { t: 4.0, ev: 'zombie:spawn', p: { id: 1, pos: [-6, 0, -14] } },
  { t: 5.0, sound: 'zombie_groan', opts: { pos: [7, 0, -10] } },
  { t: 5.5, ev: 'step', p: { pos: [0, 0, 0], surface: 'asphalt' } },
  { t: 6.0, ev: 'step', p: { pos: [0, 0, 0], surface: 'asphalt' } },
  { t: 6.5, ev: 'zombie:spawn', p: { id: 2, pos: [3, 0, -20] } },
  { t: 6.5, ev: 'step', p: { pos: [0, 0, 0], surface: 'asphalt' } },
  { t: 7.0, ev: 'step', p: { pos: [0, 0, 0], surface: 'concrete' } },
  { t: 7.5, ev: 'step', p: { pos: [0, 0, 0], surface: 'concrete' } },
  { t: 8.5, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 8.53, ev: 'hit:world', p: { pos: [1, 0, -15], normal: [0, 1, 0], surface: 'asphalt' } },
  { t: 9.1, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 9.12, ev: 'hit:zombie', p: { id: 1, pos: [-4, 1.2, -9], part: 'torso', damage: 40, killed: false } },
  { t: 9.7, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 9.72, ev: 'hit:world', p: { pos: [-3, 1, -12], normal: [1, 0, 0], surface: 'metal' } },
  { t: 10.3, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 10.32, ev: 'hit:zombie', p: { id: 1, pos: [-4, 1.6, -8], part: 'head', damage: 120, killed: true, headshot: true } },
  { t: 10.34, ev: 'zombie:die', p: { id: 1, pos: [-4, 0, -8], headshot: true } },
  { t: 11.2, ev: 'zombie:attack', p: { id: 2, pos: [0.5, 1.4, -1.5] } },
  { t: 11.7, ev: 'player:damage', p: { amount: 34, dir: [0, 0, -1] } },
  { t: 12.2, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 12.22, ev: 'hit:zombie', p: { id: 2, pos: [0.4, 1.3, -1.4], part: 'torso', damage: 40, killed: false } },
  { t: 12.6, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 12.62, ev: 'hit:zombie', p: { id: 2, pos: [0.4, 1.3, -1.4], part: 'torso', damage: 40, killed: true } },
  { t: 12.64, ev: 'zombie:die', p: { id: 2, pos: [0.4, 0, -1.6], headshot: false } },
  { t: 13.2, ev: 'weapon:reload', p: { weapon: 'pistol' } },
  { t: 13.6, sound: 'thunder', opts: {} },
  { t: 14.9, area: 'canopy' },
  { t: 15.2, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'pistol' } },
  { t: 15.22, ev: 'hit:world', p: { pos: [2, 1.2, -6], normal: [0, 0, 1], surface: 'glass' } },
  { t: 15.8, ev: 'weapon:fire', p: { dry: true, weapon: 'pistol' } },
  { t: 16.2, ev: 'round:end', p: { n: 1 } },
  { t: 17.5, ev: 'buy', p: { item: 'wallAmmo', cost: 250 } },
  { t: 18.3, ev: 'buy:denied', p: { item: 'wallAmmo', reason: 'points' } },
  { t: 19.0, area: 'open' },
];
