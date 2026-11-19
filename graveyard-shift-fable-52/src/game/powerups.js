// Power-ups: dropped by kills, picked up by walking over them. Pure: no DOM, no three.js. Sim time.
//
//   active: Map<kind, secondsLeft>      the timed ones running (oneTap, doubleTime)
//   drops: Array<{id, kind, pos:{x,y,z}, ttl}>   on the ground
//   multiplier                          2 under Double Time, else 1
//   oneTap                              true under One-Tap
//   onKill({id, pos, type})             maybe drops one (3 %, at most 4 a round, never within 10 s of
//                                       the last); a brute always drops one
//   drop(kind, pos), activate(kind, seconds?), update(dt), onRound(), reset(rng)
// Events: powerup:drop {id, kind, pos}, powerup:take {kind, seconds}, powerup:end {kind},
//         powerup:lapse {id, kind} (a drop left on the ground too long).
import { tuning } from './tuning.js';

const TP = tuning.economy.powerups;

export function createPowerups({ emit = () => {}, economy, weapon = () => null, player = () => null, zombies = () => null }) {
  let rng = null;
  let now = 0; // sim seconds this game
  let lastDrop = -Infinity;
  let thisRound = 0;
  let nextId = 1;
  const ids = []; // zombie ids Flashover goes through (reused)

  const pu = {
    active: new Map(),
    drops: [],
    get multiplier() { return pu.active.has('doubleTime') ? TP.multiplier : 1; },
    get oneTap() { return pu.active.has('oneTap'); },

    onKill(z) {
      if (!rng) return null;
      const brute = !!z && z.type === 'brute';
      if (!brute) {
        if (thisRound >= TP.perRound || now - lastDrop < TP.gap) return null;
        if (!(rng.next() < TP.chance)) return null;
        thisRound++;
      }
      lastDrop = now;
      const kind = TP.kinds[rng.int(0, TP.kinds.length - 1)];
      return pu.drop(kind, z && z.pos);
    },

    drop(kind, pos) {
      const p = toVec(pos);
      const d = { id: nextId++, kind, pos: p, ttl: TP.ttl };
      pu.drops.push(d);
      emit('powerup:drop', { id: d.id, kind, pos: p });
      return d;
    },

    activate(kind, seconds) {
      const w = weapon();
      if (kind === 'resupply') {
        if (w && typeof w.fillAll === 'function') w.fillAll();
        if (w && typeof w.addThrowable === 'function') for (const k of tuning.weapons.throwables.kinds) w.addThrowable(k, 99);
        emit('powerup:take', { kind, seconds: 0 });
      } else if (kind === 'flashover') {
        flashover();
        emit('powerup:take', { kind, seconds: 0 });
      } else if (TP.seconds[kind]) {
        const s = seconds > 0 ? seconds : TP.seconds[kind];
        pu.active.set(kind, Math.max(pu.active.get(kind) || 0, s));
        if (kind === 'oneTap' && w && w.mods) w.mods.instantKill = true;
        emit('powerup:take', { kind, seconds: s });
      }
    },

    update(dt) {
      if (!(dt > 0)) return;
      now += dt;
      tickDt = dt;
      if (pu.active.size) pu.active.forEach(tick); // no iterator objects: this runs every frame
      const p = player();
      const pos = p && p.alive !== false ? p.pos : null;
      for (let i = pu.drops.length - 1; i >= 0; i--) {
        const d = pu.drops[i];
        d.ttl -= dt;
        if (pos && Math.hypot(d.pos.x - pos[0], d.pos.z - pos[2]) <= TP.radius) {
          pu.drops.splice(i, 1);
          pu.activate(d.kind);
        } else if (d.ttl <= 0) {
          pu.drops.splice(i, 1);
          emit('powerup:lapse', { id: d.id, kind: d.kind });
        }
      }
    },

    onRound() { thisRound = 0; },

    reset(r) {
      rng = r;
      now = 0; lastDrop = -Infinity; thisRound = 0;
      pu.drops.length = 0;
      for (const kind of pu.active.keys()) emit('powerup:end', { kind });
      pu.active.clear();
      const w = weapon();
      if (w && w.mods) w.mods.instantKill = false;
    },
  };

  let tickDt = 0;
  function tick(left, kind) {
    const l = left - tickDt;
    if (l > 0) { pu.active.set(kind, l); return; }
    pu.active.delete(kind);
    if (kind === 'oneTap') { const w = weapon(); if (w && w.mods) w.mods.instantKill = false; }
    emit('powerup:end', { kind });
  }

  // every zombie alive dies; a brute takes a share of its max health instead; 400 points, once
  function flashover() {
    const Z = zombies();
    if (Z && Array.isArray(Z.list) && typeof Z.damage === 'function') {
      ids.length = 0;
      for (const z of Z.list) if (z && z.alive !== false) ids.push(z.id);
      for (const id of ids) {
        const z = Z.list.find((q) => q && q.id === id);
        if (!z) continue;
        const amount = z.type === 'brute' ? TP.bruteShare * (z.maxHealth || z.health) : z.health + 1;
        Z.damage(id, amount, 'torso');
      }
    }
    if (economy) economy.add(TP.flashoverPoints, 'flashover');
  }

  return pu;
}

function toVec(p) {
  if (!p) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(p)) return { x: p[0], y: p[1] || 0, z: p[2] };
  return { x: p.x, y: p.y || 0, z: p.z };
}
