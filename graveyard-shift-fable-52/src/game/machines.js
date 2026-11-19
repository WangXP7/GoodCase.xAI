// The four machines. Pure: no DOM, no three.js. Each needs power; each is kept until death (a new
// game clears them), except Jump Start, which is spent by the revive and must be bought again.
//   has(kind), price(kind), buy(kind) -> {ok, reason} (power | owned | points | unknown), reset()
// Effects:
//   secondHelping  G.player.maxHealth = 175
//   shortOrder     G.weapon.mods.reloadScale = 0.6
//   longHaul       G.player.setSpeedScale('longHaul', 1.12)
//   jumpStart      G.player.setLethalHook: a killing hit leaves 50 health and 3 s immune, every
//                  zombie within 4 m is thrown back 1.5 m (G.zombies.stagger(id, push {x,y,z} in metres,
//                  seconds), when the zombie module has it), `revive {}` is emitted, and the machine is spent
// Event: machine:buy {kind}.
import { tuning } from './tuning.js';

const TM = tuning.economy.machines;

export function createMachines({ economy, emit = () => {}, level = () => null, player = () => null, weapon = () => null, zombies = () => null }) {
  const owned = new Set();
  let jumpBuys = 0; // Jump Starts bought this game (each costs `step` more)
  const near = []; // ids thrown back by a revive (reused)

  function revive() {
    owned.delete('jumpStart');
    const J = TM.jumpStart;
    const p = player();
    const Z = zombies();
    if (p && p.pos && Z && Array.isArray(Z.list)) {
      const px = p.pos[0], pz = p.pos[2];
      near.length = 0;
      for (const z of Z.list) {
        if (!z || !z.pos || z.alive === false) continue;
        const dx = z.pos.x - px, dz = z.pos.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > J.radius) continue;
        near.push(z.id);
        if (typeof Z.stagger === 'function') {
          const k = d > 1e-3 ? 1 / d : 0;
          Z.stagger(z.id, { x: dx * k * J.push, y: 0, z: dz * k * J.push }, J.stagger);
        }
      }
    }
    emit('revive', {});
    return { health: J.health, invuln: J.invuln };
  }

  const m = {
    owned,
    has: (kind) => owned.has(kind),
    price(kind) {
      const d = TM[kind];
      if (!d) return 0;
      return kind === 'jumpStart' ? d.cost + d.step * jumpBuys : d.cost;
    },
    buy(kind) {
      if (!TM[kind]) return { ok: false, reason: 'unknown' };
      const L = level();
      if (!(L && L.power && L.power.on)) return { ok: false, reason: 'power' };
      if (owned.has(kind)) return { ok: false, reason: 'owned' };
      if (!economy.spend(m.price(kind), `machine:${kind}`, `machine-${kind}`)) return { ok: false, reason: 'points' };
      owned.add(kind);
      apply(kind);
      emit('machine:buy', { kind });
      return { ok: true, reason: null };
    },
    reset() { owned.clear(); jumpBuys = 0; },
  };

  function apply(kind) {
    const p = player();
    const w = weapon();
    if (kind === 'secondHelping' && p) p.maxHealth = TM.secondHelping.maxHealth;
    else if (kind === 'shortOrder' && w && w.mods) w.mods.reloadScale = TM.shortOrder.reloadScale;
    else if (kind === 'longHaul' && p && typeof p.setSpeedScale === 'function') p.setSpeedScale('longHaul', TM.longHaul.speed);
    else if (kind === 'jumpStart') {
      jumpBuys++;
      if (p && typeof p.setLethalHook === 'function') p.setLethalHook(revive);
    }
  }

  return m;
}
