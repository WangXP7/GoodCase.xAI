// What lies in the world to be taken: a weapon left by a search, and the power-ups a kill
// drops. Both follow the game's own live lists (G.game.loot.pickups, G.game.powerups.drops), so
// nothing here keeps state the game could disagree with.
//   pickup    the weapon itself, a little larger than life, turning slowly over the searched
//             object in a light of its own, a warm pool under it
//   power-up  a floating shape with a glow, one per kind (powerup.js)
// A small pool of meshes in the object material; no allocation after install.
import { CylinderGeometry, Group, Mesh } from 'three';
import { channel, createObj, setQuadUv, sheetUv, WEAPON_IDS } from '../../mats/yard.js';
import { powerupGeometry, POWERUP_KINDS, POWERUP_COLOR } from './powerup.js';
import { sharedGunDisplay, displayScale } from './gunDisplay.js';

const PICKUPS = 4, DROPS = 4;
const DROP_LUMENS = 380; // the light a drop throws on the ground and the bodies round it

// One weapon lying to be taken: the weapon itself (its baked display model, in a material with its
// own lights) turning slowly over a warm pool. `display` is the game's shared display set; without
// it, or for a weapon it cannot build, the weapon's outline on a lit card stands in.
export function buildPickup(mats, display = null) {
  const O = createObj();
  const quads = [];
  for (const s of [1, -1]) quads.push(O.quad([-0.34 * s, 0.0, 0.004 * s], [0.68 * s, 0, 0], [0, 0.2465, 0], { tex: 'gun:pistol', color: [0.3, 0.26, 0.2], glow: [7, 5.2, 2.6] }));
  // the warm pool: a disc of light on what it rests on
  const disc = createObj();
  disc.add(new CylinderGeometry(0.26, 0.3, 0.012, 16), { color: [0.25, 0.18, 0.1], glow: [0.55, 0.38, 0.15] });
  const card = new Mesh(O.geometry(), mats.object), pool = new Mesh(disc.geometry(), mats.object);
  const group = new Group();
  card.position.y = 0.16; pool.position.y = 0.012;
  for (const m of [card, pool]) { m.castShadow = false; m.userData.noReflect = true; m.frustumCulled = false; group.add(m); }
  // the weapon: one mesh whose geometry is swapped for the weapon shown (the display set owns the geometries)
  const look = display ? display.newMaterial(0.04, 0.35, 0.4) : null;
  const gun = look ? new Mesh(card.geometry, look.material) : null;
  if (gun) { gun.castShadow = false; gun.userData.noReflect = true; gun.frustumCulled = false; gun.visible = false; gun.rotation.order = 'YXZ'; group.add(gun); }
  group.visible = false;
  let shown = '', real = false;
  return {
    group, gun, card,
    get real() { return real; },
    setItem(id) {
      if (id === shown) return;
      shown = id;
      const geo = display && WEAPON_IDS.includes(id) ? display.geometryOf(id) : null;
      real = !!(geo && gun);
      card.visible = !real;
      if (gun) gun.visible = real;
      if (real) { gun.geometry = geo; gun.scale.setScalar(displayScale(display.ensure(id).length, 1.15, 0.5, 1.0)); return; }
      const r = sheetUv(`gun:${WEAPON_IDS.includes(id) ? id : 'pump'}`);
      for (const q of quads) setQuadUv(card.geometry, q, r);
    },
    update(dt, t) {
      if (real) { gun.rotation.set(0.12, t * 0.9, 0.3); gun.position.y = 0.36 + 0.035 * Math.sin(t * 2.3); return; }
      card.rotation.y = t * 1.1; card.position.y = 0.2 + 0.03 * Math.sin(t * 2.3);
    },
  };
}

// One drop: the four kinds' meshes (one shown), on a glow channel of its own. update() turns and
// bobs it, grows it in when it appears, and blinks it faster and faster through its last seconds.
const BLINK = 6; // seconds left when the blinking starts
export function buildPowerup(mats) {
  const group = new Group();
  const meshes = {};
  const ch = channel();
  for (const k of POWERUP_KINDS) { const m = new Mesh(powerupGeometry(k, ch), mats.object); m.castShadow = false; m.userData.noReflect = true; m.frustumCulled = false; m.visible = false; group.add(m); meshes[k] = m; }
  group.visible = false;
  const gain = mats.gain;
  let kind = '', age = 0, phase = 0;
  return {
    group, channel: ch,
    get kind() { return kind; },
    setKind(k) { if (k === kind) return; kind = k; for (const q of POWERUP_KINDS) meshes[q].visible = q === k; },
    // a new drop in this slot: it grows in from nothing
    appear() { age = 0; phase = 0; },
    // returns the light it gives off, 0..1 (for the lamp that goes with it)
    update(dt, t, ttl) {
      age += dt;
      const m = meshes[kind];
      if (!m) return 0;
      // out of the body in a third of a second, a little past full size and back
      const a = Math.min(1, age / 0.34), grow = a < 1 ? 1.12 * (1 - (1 - a) * (1 - a)) - 0.12 * a * a * a : 1;
      let lit = 1;
      if (ttl < BLINK) {
        // 2 blinks a second at first, 8 at the end; dark a little longer each time
        const u = 1 - Math.max(0, ttl) / BLINK;
        phase += dt * (2 + 6 * u * u);
        lit = phase % 1 < 0.6 - 0.2 * u ? 1 : 0.06;
      }
      const flame = kind === 'flashover' ? 0.86 + 0.14 * Math.sin(t * 31) * Math.sin(t * 17.3) : 1;
      gain[ch] = lit * flame * (0.9 + 0.1 * Math.sin(t * 3.1)) * Math.min(1, a * 1.5);
      group.rotation.y = t * 1.15;
      m.position.y = 1.05 + 0.07 * Math.sin(t * 2.2);
      m.rotation.z = 0.1 * Math.sin(t * 1.3);
      m.scale.setScalar(Math.max(0.001, grow) * (lit < 0.5 ? 0.96 : 1));
      if (kind === 'flashover') m.scale.y *= 1 + 0.05 * Math.sin(t * 23) * Math.sin(t * 9.1);
      return lit * Math.min(1, a * 1.5);
    },
  };
}

const px = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[0] : p.x), py = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[1] : p.y), pz = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[2] : p.z);

// What a taken drop leaves: a flash of its colour and a ring of bright motes thrown outward and up.
const BURST = 16;
function createBurst(G) {
  const d = { kind: 'glint', pos: [0, 0, 0], vel: [0, 0, 0], life: 0, size: [0, 0], color: [0, 0, 0, 1], drag: 0, gravity: 0, emissive: 0 };
  return (x, y, z, c) => {
    const fx = G.fx;
    if (!fx || typeof fx.emit !== 'function') return;
    d.pos[0] = x; d.pos[1] = y; d.pos[2] = z;
    d.color[0] = c[0]; d.color[1] = c[1]; d.color[2] = c[2];
    d.vel[0] = 0; d.vel[1] = 0; d.vel[2] = 0; d.life = 0.16; d.size[0] = 0.5; d.size[1] = 2.4; d.drag = 0; d.gravity = 0; d.emissive = 22;
    fx.emit(d);
    d.vel[1] = 0.6; d.life = 0.42; d.size[0] = 0.9; d.size[1] = 0.2; d.emissive = 7;
    fx.emit(d);
    for (let i = 0; i < BURST; i++) {
      // evenly round the compass, alternate ones thrown higher
      const a = i * 2.39996, up = i % 2 ? 2.6 : 1.1, sp = 2.4 + (i % 3) * 0.7;
      d.vel[0] = Math.cos(a) * sp; d.vel[1] = up; d.vel[2] = Math.sin(a) * sp;
      d.life = 0.5 + (i % 4) * 0.09; d.size[0] = 0.11; d.size[1] = 0.015; d.drag = 2.6; d.gravity = 0.5; d.emissive = 16;
      fx.emit(d);
    }
  };
}

export function installLoot(G, mats, level) {
  if (!level.root) return null;
  const root = new Group();
  root.name = 'loot';
  level.root.add(root);
  const pickups = [], drops = [];
  const display = G.mats ? sharedGunDisplay(G) : null;
  for (let i = 0; i < PICKUPS; i++) { const p = buildPickup(mats, display); root.add(p.group); pickups.push(p); }
  // each drop slot: its meshes, the lamp that goes with it, and which of the game's drops it is showing
  const canLight = G.lights && typeof G.lights.add === 'function';
  for (let i = 0; i < DROPS; i++) {
    const p = buildPowerup(mats);
    root.add(p.group);
    p.id = 0; p.seen = false; p.flash = 0; p.at = [0, 0, 0]; p.lit = -1;
    p.arg = { pos: [0, 0, 0], lumens: 0, enabled: true }; p.dim = { lumens: 0 }; p.off = { enabled: false };
    p.light = canLight ? G.lights.add({ type: 'point', pos: [0, -50, 0], color: [1, 1, 1], lumens: DROP_LUMENS, range: 5.5, priority: 0.45 }) : null;
    if (p.light) p.light.set(p.off);
    drops.push(p);
  }
  const burst = createBurst(G);
  // a drop that was walked over bursts; one that ran out of time, or was cleared with the game, goes quietly
  let takes = 0, takeAt = -10, now = 0;
  if (G.events) G.events.on('powerup:take', () => { takes++; takeAt = now; });
  // harness: ?loot=1 puts one of each in the yard's lane, for a look; ?loot=blink the same in their last seconds
  const q = typeof window !== 'undefined' && window.location ? window.location.search : '';
  const demo = /[?&]loot=(1|blink)/.test(q), blink = /[?&]loot=blink/.test(q);
  const DEMO_P = [{ item: 'rifle', pos: [36.2, 0.62, 22.4] }, { item: 'lmg', pos: [60.4, 0.97, 14.25] }];
  // (&lootat=x,z stands the four in a row running south from there instead)
  const at = /[?&]lootat=(-?[\d.]+),(-?[\d.]+)/.exec(q);
  const DEMO_D = POWERUP_KINDS.map((kind, i) => ({ id: 900 + i, kind, pos: at ? [Number(at[1]), 0, Number(at[2]) + i * 1.3] : [38.5 + i * 1.3, 0, 10.2 + (i % 2) * 0.9], ttl: blink ? 2.5 : 20 }));
  const slotOf = (id) => { for (let i = 0; i < DROPS; i++) if (drops[i].id === id) return drops[i]; return null; };
  const freeSlot = () => { for (let i = 0; i < DROPS; i++) if (!drops[i].id && drops[i].flash <= 0) return drops[i]; for (let i = 0; i < DROPS; i++) if (!drops[i].id) return drops[i]; return null; };
  return {
    pickups, drops,
    update(dt, t) {
      now = t;
      // the display set is built here and only here: a model a frame while nobody is playing
      if (display) display.tick(dt, !!(G.game && G.game.state === 'playing'));
      const game = G.game;
      const pl = demo ? DEMO_P : game && game.loot && game.loot.pickups;
      const dl = demo ? DEMO_D : game && game.powerups && game.powerups.drops;
      for (let i = 0; i < PICKUPS; i++) {
        const p = pickups[i], rec = pl && i < pl.length ? pl[i] : null;
        p.group.visible = !!rec;
        if (!rec) continue;
        p.setItem(rec.item); p.group.position.set(px(rec.pos), py(rec.pos), pz(rec.pos)); p.update(dt, t);
      }
      // each of the game's drops keeps the slot it was given, whatever happens to the others
      for (let i = 0; i < DROPS; i++) drops[i].seen = false;
      const n = dl ? Math.min(dl.length, DROPS) : 0;
      for (let i = 0; i < n; i++) {
        const rec = dl[i], id = rec.id || i + 1;
        let p = slotOf(id);
        if (!p) {
          p = freeSlot();
          if (!p) continue;
          p.id = id; p.flash = 0; p.lit = -1; p.setKind(rec.kind); p.appear();
          if (p.light) { p.light.groundY = py(rec.pos); p.light.set({ color: POWERUP_COLOR[rec.kind] }); }
        }
        p.seen = true;
        p.at[0] = px(rec.pos); p.at[1] = py(rec.pos); p.at[2] = pz(rec.pos);
        p.group.visible = true;
        p.group.position.set(p.at[0], p.at[1], p.at[2]);
        const lit = p.update(dt, t, rec.ttl ?? 99);
        if (p.light && Math.abs(lit - p.lit) > 0.02) {
          p.lit = lit;
          p.arg.pos[0] = p.at[0]; p.arg.pos[1] = p.at[1] + 1.0; p.arg.pos[2] = p.at[2]; p.arg.lumens = DROP_LUMENS * lit;
          p.light.set(p.arg);
        }
      }
      for (let i = 0; i < DROPS; i++) {
        const p = drops[i];
        if (p.seen) continue;
        if (p.id) {
          // gone since the last frame: taken (a burst and a flash of its light) or lapsed (nothing)
          if (takes > 0 && t - takeAt < 0.25) { takes--; burst(p.at[0], p.at[1] + 1.0, p.at[2], POWERUP_COLOR[p.kind] || POWERUP_COLOR.flashover); p.flash = 1; }
          p.id = 0; p.group.visible = false; mats.gain[p.channel] = 0;
        }
        if (p.light && p.light.enabled) {
          p.flash -= dt / 0.3;
          if (p.flash > 0) { p.dim.lumens = DROP_LUMENS * 7 * p.flash * p.flash; p.light.set(p.dim); } else { p.flash = 0; p.light.set(p.off); }
        } else p.flash = 0;
      }
      if (t - takeAt >= 0.25) takes = 0;
    },
    // back to nothing shown (a new game)
    reset() { for (const p of drops) { p.id = 0; p.flash = 0; p.group.visible = false; mats.gain[p.channel] = 0; if (p.light) p.light.set(p.off); } },
  };
}
