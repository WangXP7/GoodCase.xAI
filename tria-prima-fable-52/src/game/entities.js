// Everything in the world that answers the apprentice: plants to gather, pages to read, the
// furnace and the cauldron, lanterns, the three gates and the three shrines, things that can be
// carried, and what the potions leave behind (floes, crust, pillars, fire).
import * as THREE from 'three';
import { INGREDIENTS, LANTERNS, LORE, PRIME_ITEMS, PRIME_HUNTS, POTIONS } from './data.js';
import { add, hasAllPrimes } from './state.js';
import { heatMaterial, burnMaterial, growMaterial } from './fx.js';
import { hasModel } from '../models/index.js';
import { worldMaterial } from '../gfx/atmos.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';
import { WORLD, SCAR } from '../world/heightmap.js';
import { clamp, damp, lerp, smoothstep, easeInOutCubic } from '../core/math.js';

const RARE = { halite: 1, quicksilver: 1, brimstone: 1 };
const PROP_NAMES = { crate: 'A crate', barrel: 'A barrel', skull: 'A skull' };
const PROP_MASS = { crate: 14, barrel: 20, skull: 1.5 };
const FLOE_LIFE = 80,
  CRUST_LIFE = 50,
  PILLAR_LIFE = 150;

const _v = new THREE.Vector3();
const _out = { t: 0, col: null };

/** Small things throw no shadow and stay out of the water's mirror. */
function quiet(placed) {
  placed.object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.layers.set(LAYER_MAIN_ONLY);
    }
  });
}
/** Hang a part of a placed model on a pivot at a model-space point, so it can turn about it. */
function pivotAt(placed, mesh, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  placed.object.add(pivot);
  pivot.add(mesh);
  mesh.position.set(-x, -y, -z);
  return pivot;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax,
    dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

export class Entities {
  constructor(game) {
    this.game = game;
    this.list = []; // interactables
    this.plants = [];
    this.pages = [];
    this.lanterns = [];
    this.braziers = [];
    this.candles = [];
    this.props = [];
    this.primes = {};
    this.floes = []; // ice on water and crust on lava
    this.pillars = [];
    this.fires = [];
    this.rubble = [];
    this.gate = null;
    this.vine = null;
    this.rockfall = null;
    this.lid = null;
    this.cage = null;
    this.athanor = null;
    this.bell = null;
    this.held = null;
    this.focused = null;
    this._tick = 0;
  }

  // =============================================================================== building
  build() {
    const g = this.game,
      w = g.world,
      L = w.layout,
      N = w.named,
      S = w.spots,
      fx = g.fx;
    const H = (x, z) => w.T.heightAt(x, z);

    // ---- plants
    for (const s of S.ingredients) {
      const full = w.place(s.kind, s.x, s.y, s.z, s.ry, { seed: s.seed, scale: s.scale, collide: false });
      if (!full) continue;
      quiet(full);
      const p = { key: s.id, id: s.kind, spot: s, full, stub: null, picked: false, sources: fx.attach(full, { far: 34 }), top: full.anchor('top') || new THREE.Vector3(s.x, s.y + 0.3, s.z) };
      this.plants.push(p);
      this.list.push({ pos: p.top, reach: 2.5, verb: 'Gather', name: INGREDIENTS[s.kind].name, test: () => !p.picked, use: () => this.pick(p), owner: full });
    }

    // ---- pages
    const page = (id, placed, pos) => {
      const src = fx.source({ x: pos.x, y: pos.y + 0.12, z: pos.z, kind: 'glow', size: 0.2, color: [1.0, 0.82, 0.55], light: { color: '#ffd9a0', intensity: 1.4, range: 3.2 }, far: 36, flicker: 0.1 });
      this.pages.push({ id, placed, pos, src });
      this.list.push({ pos, reach: 2.8, verb: 'Read', name: LORE[id].title, use: () => this.read(id), owner: placed, wide: true });
    };
    S.lore.forEach((s, i) => {
      const y = H(s.x, s.z);
      const placed = w.place('lore_page', s.x, y, s.z, s.ry, { seed: 1 + (i % 3) });
      if (placed) quiet(placed);
      page(s.id, placed, (placed && placed.anchor('page')) || new THREE.Vector3(s.x, y + 0.4, s.z));
    });
    if (N.workbench) page('letter', N.workbench, N.workbench.anchor([0.15, 0.98, 0.1]));
    if (N.lectern) page('flame', N.lectern, N.lectern.anchor('page') || N.lectern.anchor([0, 1.2, 0]));

    // ---- the cauldron
    if (N.cauldron) this.list.push({ pos: N.cauldron.anchor('surface'), reach: 2.9, verb: 'Brew', name: 'The cauldron', test: () => !this.held, use: () => g.brewing.enter(), owner: N.cauldron, wide: true });

    // ---- the Athanor
    if (N.athanor) {
      const a = N.athanor;
      const mat = heatMaterial();
      if (a.parts.coals) a.parts.coals.material = mat;
      const mouth = a.anchor('mouth'),
        bed = a.anchor([0, 1.02, 0.75]),
        chimney = a.anchor('chimney'),
        socket = a.anchor('socket');
      this.athanor = {
        placed: a,
        mat,
        mouth,
        socket,
        chimney,
        heat: 0,
        level: 0,
        fire: fx.source({ x: bed.x, y: bed.y, z: bed.z, kind: 'fire', size: 0.42, smoke: 0, light: { color: '#ff8a3c', intensity: 20, range: 16 }, on: false, far: 70 }),
        smoke: fx.source({ x: chimney.x, y: chimney.y + 0.2, z: chimney.z, kind: 'smoke', size: 1.1, rate: 1.6, on: false, far: 220 }),
        embers: fx.source({ x: chimney.x, y: chimney.y + 0.2, z: chimney.z, kind: 'embers', size: 0.25, on: false, far: 110 }),
        stone: null,
        loop: null,
      };
      this.list.push({ pos: socket, reach: 3.2, verb: 'Set the Stone', name: 'The Athanor', test: () => g.state.inv.stone && g.state.world.athanor < 2, use: () => g.endgame.begin(), owner: a, wide: true, prio: 0.2 });
    }
    for (let i = 1; i <= 4; i++) if (N['candles' + i]) this.candles.push(...fx.attach(N['candles' + i], { on: false, far: 46 }));

    // ---- lanterns of the dead
    const beaconGeo = new THREE.IcosahedronGeometry(0.2, 1);
    for (const ln of L.lanterns) {
      const p = ln.placed;
      if (!p) continue;
      const f = p.anchor('flame'),
        base = p.anchor('base');
      const beacon = new THREE.Mesh(beaconGeo, worldMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 2.6, 0.6) }), { csm: false }));
      beacon.position.copy(f);
      beacon.visible = false;
      w.scene.add(beacon);
      const o = { id: ln.id, placed: p, flame: f, base, lit: false, beacon, src: fx.source({ x: f.x, y: f.y - 0.12, z: f.z, kind: 'fire', size: 0.5, smoke: 0.3, light: { color: '#ffa050', intensity: 30, range: 24, dy: -0.4 }, on: false, far: 120 }) };
      this.lanterns.push(o);
      this.list.push({ pos: new THREE.Vector3(base.x, base.y + 1.25, base.z), reach: 3.3, verb: 'Rest', name: LANTERNS[ln.id].name, test: () => o.lit && !this.held, use: () => this.rest(o), wide: true });
    }

    // ---- the briar gate
    if (N.gate) {
      const p = N.gate;
      const mat = burnMaterial();
      if (p.body) p.body.material = mat;
      this.gate = { placed: p, mat, burn: 0, burning: false, gone: false, fires: [], x: L.gate.x, y: L.gate.y, z: L.gate.z, ax: Math.cos(p.ry), az: -Math.sin(p.ry), half: 3.5 * p.scale };
    }

    // ---- the Elder Hollow: seed, vine, Prime Salt
    if (L.vine && N.shrineSalt) {
      const v = L.vine,
        sh = N.shrineSalt;
      let nx = v.x - sh.x,
        nz = v.z - sh.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      this.vine = { spot: v, placed: null, mat: null, k: 0, growing: false, grown: false, nx, nz, ladder: { x: v.x, z: v.z, y0: v.y, y1: v.top.y, r: 1.2, nx, nz, tx: v.top.x - nx * 0.8, tz: v.top.z - nz * 0.8, active: false } };
      g.player.ladders.push(this.vine.ladder);
    }

    // ---- the Mere shrine: the lid
    if (N.shrineMercury) {
      const s = N.shrineMercury;
      const lm = (s.model.meta && s.model.meta.lid) || null;
      const ly = lm && lm.y != null ? lm.y : 1.0;
      this.lid = { shrine: s, mesh: s.parts.lid ? pivotAt(s, s.parts.lid, 0, ly, 0) : null, ly, k: 0, open: false, opening: false, x: s.x, y: s.y, z: s.z };
    }

    // ---- the Scar: the rockfall, the braziers, the cage
    if (N.rockfall) this.rockfall = { placed: N.rockfall, broken: false, spot: L.rockfall };
    for (const b of L.braziers || []) {
      const p = b.placed;
      if (!p) continue;
      const mat = heatMaterial([0.45, 0.7, 1.9]);
      if (p.parts.coals) p.parts.coals.material = mat;
      const f = p.anchor('flame') || new THREE.Vector3(b.x, b.y + 1.2, b.z);
      this.braziers.push({ id: b.id, placed: p, mat, flame: f, lit: false, heat: 0, src: fx.source({ x: f.x, y: f.y, z: f.z, kind: 'fire', size: 0.4, color: [0.28, 0.48, 1.0], smoke: 0.4, light: { color: '#6f8cff', intensity: 18, range: 14 }, on: false, far: 90 }) });
    }
    if (N.shrineSulfur) this.cage = { shrine: N.shrineSulfur, mesh: N.shrineSulfur.parts.cage || null, k: 0, open: false };

    // ---- the three Primes
    const at = { salt: L.primeSalt, mercury: L.primeMercury, sulfur: L.primeSulfur };
    for (const id of ['salt', 'mercury', 'sulfur']) {
      const a = at[id];
      if (!a) continue;
      const placed = w.place('prime_' + id, a.x, a.y + 0.12, a.z, 0, { collide: false, far: 240 });
      if (placed) quiet(placed);
      const pr = { id, placed, at: a.clone(), sources: placed ? fx.attach(placed, { far: 90 }) : [], taken: false, t: Math.random() * 6 };
      this.primes[id] = pr;
      this.list.push({ pos: new THREE.Vector3(a.x, a.y + 0.3, a.z), reach: 2.9, verb: 'Take', name: PRIME_ITEMS[id].name, test: () => !pr.taken && this.primeOpen(id) && !this.held, use: () => this.takePrime(id), wide: true, prio: 0.2 });
    }

    // ---- things that can be carried and thrown
    for (const s of S.props) {
      if (!hasModel(s.model)) continue;
      const y = s.y != null ? s.y : H(s.x, s.z);
      const placed = w.place(s.model, s.x, y, s.z, (s.seed * 1.7 + s.x) % 6.283, { seed: s.seed, collide: false });
      if (!placed) continue;
      const c = (placed.model.colliders || [])[0];
      if (!c) continue;
      const spec = { mass: PROP_MASS[s.model] || 12, x: s.x, y: y + 0.02, z: s.z, ry: placed.ry, object: placed.object, offset: c.c.slice(), tag: 'prop', data: { kind: s.model, placed } };
      if (c.type === 'box') {
        spec.shape = 'box';
        spec.h = c.h.slice();
      } else if (c.type === 'cyl') {
        spec.shape = 'cyl';
        spec.r = c.r;
        spec.h = c.h;
      } else {
        spec.shape = 'sphere';
        spec.r = c.r;
      }
      const prop = g.physics.addProp(spec);
      prop.home = { x: prop.body.position.x, y: prop.body.position.y, z: prop.body.position.z, ry: placed.ry };
      prop.body.sleep();
      this.props.push(prop);
      this.list.push({ pos: prop.body.position, reach: 2.5, verb: 'Carry', name: PROP_NAMES[s.model] || 'It', test: () => !this.held && !prop.gone, use: () => this.carry(prop) });
    }

    // ---- the drowned bell
    if (N.bell) {
      const la = N.bell.model.anchors.bell || [0, 12, 0];
      this.bell = { placed: N.bell, mesh: N.bell.parts.bell ? pivotAt(N.bell, N.bell.parts.bell, la[0], la[1] + 0.85, la[2]) : null, pos: N.bell.anchor('bell') || new THREE.Vector3(N.bell.x, 9, N.bell.z), swing: 0, t: 0 };
    }

    g.physics.onImpact = (prop, speed) => {
      const b = prop.body.position;
      g.audio.sfx(speed > 5 ? 'impact_hard' : 'impact_soft', { pos: [b.x, b.y, b.z], gain: clamp(speed / 8, 0.15, 1) });
    };
  }

  // =============================================================================== state
  /** Put the world the way the save says it is. No animation. */
  reset() {
    const g = this.game,
      st = g.state,
      f = st.world.flags;
    this.drop(false);
    for (const p of this.plants) this.setPicked(p, (st.world.picked[p.key] || 0) > st.world.clock);
    for (const pg of this.pages) g.fx.set(pg.src, { on: !st.known.lore[pg.id] });
    this.setAthanor(st.world.athanor, true);
    for (const l of this.lanterns) this.setLantern(l, !!st.known.lanterns[l.id]);
    for (const b of this.braziers) this.setBrazier(b, !!f['brazier' + b.id], true);
    if (this.cage) {
      this.cage.open = !!f.cage;
      this.cage.k = this.cage.open ? 1 : 0;
    }
    if (this.gate) {
      const gt = this.gate;
      for (const s of gt.fires) g.fx.remove(s);
      gt.fires.length = 0;
      gt.burning = false;
      gt.gone = !!f.gate;
      gt.burn = 0;
      gt.mat.userData.u.uBurn.value = 0;
      gt.placed.hidden = gt.gone;
      gt.placed.object.visible = !gt.gone;
      this.solid(gt.placed, !gt.gone, { tag: 'briar' });
    }
    if (this.vine) {
      const v = this.vine;
      v.growing = false;
      v.grown = !!f.vine;
      v.k = v.grown ? 1 : 0;
      v.ladder.active = v.grown;
      if (v.grown) this.makeVine();
      if (v.placed) {
        v.placed.hidden = !v.grown;
        v.placed.object.visible = v.grown;
        v.mat.userData.u.uGrowY.value = 1e6;
      }
    }
    if (this.rockfall) {
      const r = this.rockfall;
      r.broken = !!f.rockfall;
      r.placed.hidden = r.broken;
      r.placed.object.visible = !r.broken;
      this.solid(r.placed, !r.broken, { tag: 'rockfall' });
    }
    if (this.lid) {
      this.lid.open = !!f.lid;
      this.lid.opening = false;
      this.lid.k = this.lid.open ? 1 : 0;
    }
    for (const id in this.primes) {
      const pr = this.primes[id];
      pr.taken = !!st.inv.primes[id];
      this.showPrime(pr);
    }
    for (const fl of this.floes.splice(0)) this.removePlaced(fl.placed);
    for (const p of this.pillars.splice(0)) this.removePillar(p, false);
    for (const fr of this.fires.splice(0)) g.fx.remove(fr.src);
    for (const r of this.rubble.splice(0)) {
      g.physics.removeProp(r.prop);
      w_remove(g.world, r.placed);
    }
    for (const p of this.props) {
      const b = p.body;
      b.position.set(p.home.x, p.home.y, p.home.z);
      b.quaternion.setFromEuler(0, p.home.ry, 0);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      p.lift = 0;
      p.held = false;
      b.collisionResponse = true;
      b.wakeUp();
      g.physics._sync(p);
      g.physics._mirror(p);
      p._wasAsleep = false;
    }
    this._pose();
  }

  /** Colliders of a placed thing on or off (and forgotten by the rigid bodies). */
  solid(placed, on, extra = null) {
    const g = this.game;
    if (on) {
      if (!placed.colliderIds.length) placed.addColliders(g.world.collision, null, { ...(extra || {}), owner: placed });
    } else {
      for (const id of placed.colliderIds) g.physics.forget(id);
      placed.removeColliders(g.world.collision);
    }
  }
  removePlaced(placed) {
    if (!placed) return;
    for (const id of placed.colliderIds) this.game.physics.forget(id);
    w_remove(this.game.world, placed);
  }

  // =============================================================================== plants
  setPicked(p, picked) {
    const g = this.game;
    p.picked = picked;
    p.full.hidden = picked;
    p.full.object.visible = !picked;
    if (picked && !p.stub) {
      const s = p.spot;
      p.stub = g.world.place(s.kind, s.x, s.y, s.z, s.ry, { seed: s.seed, scale: s.scale, opts: { picked: true }, collide: false });
      if (p.stub) quiet(p.stub);
    }
    if (p.stub) {
      p.stub.hidden = !picked;
      p.stub.object.visible = picked;
    }
    for (const s of p.sources) g.fx.set(s, { on: !picked });
  }
  pick(p) {
    const g = this.game,
      st = g.state,
      ing = INGREDIENTS[p.id];
    this.setPicked(p, true);
    st.world.picked[p.key] = st.world.clock + ing.regrow;
    const n = add(st.inv.ingredients, p.id, 1, 99);
    st.stats.picked++;
    const first = !st.known.ingredients[p.id];
    st.known.ingredients[p.id] = true;
    g.audio.sfx(RARE[p.id] ? 'pickup_rare' : 'pickup', { gain: 0.8 });
    g.particles.pluck(p.top.x, p.top.y, p.top.z, hexRGB(ing.color));
    g.bus.emit('pickup', { kind: 'ingredient', id: p.id, count: n });
    if (first) g.bus.emit('discover', { kind: 'ingredient', id: p.id });
    g.toast('pickup', ing.name, '×1', { kind: 'ingredient', id: p.id });
    g.quests.onPick(p.id);
  }

  // =============================================================================== pages
  read(id) {
    const g = this.game,
      st = g.state;
    const first = !st.known.lore[id];
    st.known.lore[id] = true;
    for (const pg of this.pages) if (pg.id === id) g.fx.set(pg.src, { on: false });
    g.audio.sfx('page');
    g.reading = id;
    g.bus.emit('lore', { id });
    if (first) {
      const rv = LORE[id].reveals;
      if (rv && !st.known.charted[rv]) {
        st.known.charted[rv] = true;
        g.after.push({ t: 0.2, wait: 'reading', fn: () => g.bus.emit('discover', { kind: 'chart', id: rv }) });
      }
    }
    g.quests.onRead(id);
  }

  // =============================================================================== the Athanor
  setAthanor(level, instant = false) {
    const a = this.athanor,
      g = this.game;
    if (!a) return;
    a.level = level;
    g.fx.set(a.fire, { on: level > 0, power: level >= 2 ? 1.5 : 0.75 });
    a.fire.light.intensity = level >= 2 ? 48 : 16;
    a.fire.light.range = level >= 2 ? 30 : 15;
    if (a.fire.em) a.fire.em.size = level >= 2 ? 0.75 : 0.4;
    g.fx.set(a.smoke, { on: level >= 2 });
    g.fx.set(a.embers, { on: level >= 2 });
    for (const c of this.candles) g.fx.set(c, { on: level > 0 });
    if (instant) a.heat = level >= 2 ? 1 : level === 1 ? 0.5 : 0;
    if (level >= 2 && !a.stone && hasModel('stone')) {
      a.stone = g.world.place('stone', a.socket.x, a.socket.y, a.socket.z, 0, { collide: false, scale: 1.6 });
      if (a.stone) {
        quiet(a.stone);
        a.stoneFx = g.fx.attach(a.stone, { far: 60 });
      }
    }
    if (a.stone) {
      a.stone.hidden = level < 2;
      a.stone.object.visible = level >= 2;
      for (const s of a.stoneFx || []) g.fx.set(s, { on: level >= 2 });
    }
  }
  kindle() {
    const g = this.game,
      a = this.athanor;
    g.state.world.athanor = 1;
    this.setAthanor(1);
    g.audio.sfx('ignite', { pos: [a.mouth.x, a.mouth.y, a.mouth.z] });
    g.particles.fireball(a.mouth.x, a.mouth.y - 0.2, a.mouth.z, 1.2);
    g.toast('info', 'The Athanor takes the flame', 'A pilot light. It will not hold the Gloom back for long.');
    g.quests.onKindle();
    g.save();
  }

  // =============================================================================== lanterns
  setLantern(l, lit) {
    l.lit = lit;
    l.beacon.visible = lit;
    this.game.fx.set(l.src, { on: lit });
  }
  lightLantern(l) {
    const g = this.game;
    if (l.lit) return;
    this.setLantern(l, true);
    g.state.known.lanterns[l.id] = true;
    g.state.world.respawn = l.id;
    g.audio.sfx('lantern_lit', { pos: [l.flame.x, l.flame.y, l.flame.z] });
    g.particles.fireball(l.flame.x, l.flame.y, l.flame.z, 1.1);
    g.fx.flash(l.flame.x, l.flame.y, l.flame.z, '#ffb060', 120, 40, 1.2);
    g.bus.emit('lantern', { id: l.id });
    g.save();
  }
  rest(l) {
    const g = this.game,
      st = g.state;
    st.world.respawn = l.id;
    const was = st.player.hp;
    st.player.hp = st.player.hpMax;
    if (st.player.hp > was + 0.5) g.bus.emit('heal', { amount: st.player.hp - was, hp: st.player.hp });
    g.audio.sfx('heal', { gain: 0.7 });
    g.toast('info', 'You rest by the flame', 'The dead will keep your place.');
    g.save();
  }

  // =============================================================================== braziers and the cage
  setBrazier(b, lit, instant = false) {
    b.lit = lit;
    this.game.fx.set(b.src, { on: lit });
    if (instant) {
      b.heat = lit ? 1 : 0;
      b.mat.userData.u.uHeat.value = b.heat;
    }
  }
  _checkCage() {
    const g = this.game,
      f = g.state.world.flags;
    if (!this.cage || this.cage.open || !this.braziers.length) return;
    if (this.braziers.every((b) => b.lit)) {
      this.cage.open = true;
      f.cage = true;
      const s = this.cage.shrine;
      g.audio.sfx('shrine_open', { pos: [s.x, s.y + 1, s.z] });
      g.toast('info', 'The cage sinks into the stone', 'Three fires, and the iron remembers whose it is.');
      g.save();
    }
  }

  // =============================================================================== the Primes
  primeOpen(id) {
    if (id === 'mercury') return !this.lid || this.lid.k > 0.9;
    if (id === 'sulfur') return !this.cage || this.cage.k > 0.9;
    return true;
  }
  showPrime(pr) {
    if (!pr.placed) return;
    const shut = pr.id === 'mercury' && this.lid && this.lid.k < 0.15;
    const vis = !pr.taken && !shut;
    pr.placed.hidden = !vis;
    pr.placed.object.visible = vis;
    for (const s of pr.sources) this.game.fx.set(s, { on: vis });
  }
  takePrime(id) {
    const g = this.game,
      st = g.state,
      pr = this.primes[id];
    pr.taken = true;
    st.inv.primes[id] = true;
    this.showPrime(pr);
    g.audio.sfx('prime_get');
    g.particles.wisp(pr.at.x, pr.at.y + 0.3, pr.at.z, hexRGB(PRIME_ITEMS[id].color), 60);
    g.fx.flash(pr.at.x, pr.at.y + 0.4, pr.at.z, PRIME_ITEMS[id].color, 90, 30, 1.6);
    g.bus.emit('prime', { id });
    g.liftGloom(PRIME_HUNTS[id].region);
    if (hasAllPrimes(st)) g.quests.onAllPrimes();
    else g.bus.emit('quest', { stage: st.quest.stage });
    g.save();
  }

  // =============================================================================== carrying
  carry(prop) {
    const g = this.game;
    this.held = prop;
    prop.held = true;
    prop.lift = 0;
    prop.body.collisionResponse = false;
    prop.body.wakeUp();
    g.physics._mirror(prop);
    g.audio.sfx('grab', { gain: 0.7 });
  }
  /** Let go; `throwIt` hurls it where the apprentice looks. */
  drop(throwIt = false) {
    const prop = this.held;
    if (!prop) return;
    const g = this.game,
      b = prop.body,
      pl = g.player;
    this.held = null;
    prop.held = false;
    b.collisionResponse = true;
    b.wakeUp();
    const a = pl.aim([0, 0, 0]);
    if (throwIt) {
      const sp = clamp(11 - b.mass * 0.18, 5, 11);
      b.velocity.set(a[0] * sp + pl.vel.x, a[1] * sp + 2.2, a[2] * sp + pl.vel.z);
      b.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      g.audio.sfx('throw', { gain: 0.8, pitch: 0.7 });
    } else b.velocity.set(pl.vel.x, 0, pl.vel.z);
    prop._wasAsleep = false;
  }
  _hold(dt) {
    const prop = this.held;
    if (!prop) return;
    const g = this.game,
      pl = g.player,
      b = prop.body;
    const cam = g.engine.camera.position;
    const a = pl.aim([0, 0, 0]);
    const reach = 1.25 + Math.max(prop.half[0], prop.half[2]);
    let tx = cam.x + a[0] * reach,
      ty = cam.y + a[1] * reach - 0.35,
      tz = cam.z + a[2] * reach;
    const floor = g.world.T.heightAt(tx, tz) + prop.half[1] + 0.05;
    if (ty < floor) ty = floor;
    const k = 1 - Math.exp(-18 * dt);
    b.position.x += (tx - b.position.x) * k;
    b.position.y += (ty - b.position.y) * k;
    b.position.z += (tz - b.position.z) * k;
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.quaternion.setFromEuler(0, -pl.heading, 0);
    b.wakeUp();
    g.physics._sync(prop);
    // dropped if it gets left behind (a wall in the way)
    if (Math.hypot(b.position.x - cam.x, b.position.y - cam.y, b.position.z - cam.z) > reach + 2.2) this.drop(false);
  }

  // =============================================================================== what potions do
  ember(x, y, z) {
    const g = this.game,
      f = g.state.world.flags;
    const a = this.athanor;
    if (a && a.level === 0 && Math.hypot(x - a.mouth.x, y - a.mouth.y, z - a.mouth.z) < 2.6) this.kindle();
    for (const l of this.lanterns) {
      if (l.lit) continue;
      if (Math.hypot(x - l.flame.x, z - l.flame.z) < 3.4 && y > l.base.y - 1.5 && y < l.flame.y + 3) this.lightLantern(l);
    }
    for (const b of this.braziers) {
      if (b.lit || Math.hypot(x - b.flame.x, y - b.flame.y, z - b.flame.z) > 2.9) continue;
      this.setBrazier(b, true);
      f['brazier' + b.id] = true;
      g.audio.sfx('ignite', { pos: [b.flame.x, b.flame.y, b.flame.z] });
      this._checkCage();
    }
    const gt = this.gate;
    if (gt && !gt.gone && !gt.burning && Math.abs(y - gt.y - 1.5) < 5 && segDist(x, z, gt.x - gt.ax * gt.half, gt.z - gt.az * gt.half, gt.x + gt.ax * gt.half, gt.z + gt.az * gt.half) < 4.4) this.burnGate();
    for (const fl of this.floes) if (Math.hypot(x - fl.x, z - fl.z) < 4.2) fl.life = Math.min(fl.life, 1.4);
    // the ground keeps burning for a little while
    if (g.world.T.heightAt(x, z) > -0.05 && Math.abs(y - g.world.T.heightAt(x, z)) < 0.8) this.fires.push({ x, y, z, life: 6.5, src: g.fx.source({ x, y: y + 0.05, z, kind: 'fire', size: 0.55, light: { color: '#ff8a3c', intensity: 14, range: 11 }, far: 70 }) });
    if (this.fires.length > 5) g.fx.remove(this.fires.shift().src);
  }
  burnGate() {
    const g = this.game,
      gt = this.gate;
    gt.burning = true;
    g.audio.sfx('briar_burn', { pos: [gt.x, gt.y + 1.5, gt.z] });
    for (let i = -2; i <= 2; i++) {
      const fx = gt.x + gt.ax * i * gt.half * 0.42,
        fz = gt.z + gt.az * i * gt.half * 0.42;
      gt.fires.push(g.fx.source({ x: fx, y: g.world.T.heightAt(fx, fz) + 0.4 + Math.abs(i) * 0.25, z: fz, kind: 'fire', size: 1.25, light: i === 0 ? { color: '#ff8a3c', intensity: 60, range: 30, dy: 1.5 } : null, far: 120 }));
    }
  }

  verdance(x, y, z) {
    const v = this.vine;
    if (v && !v.grown && !v.growing && Math.hypot(x - v.spot.x, z - v.spot.z) < 3.6 && Math.abs(y - v.spot.y) < 3) this.growVine();
  }
  makeVine() {
    const v = this.vine,
      g = this.game;
    if (v.placed || !hasModel('briar_vine')) return;
    const h = v.spot.top.y - v.spot.y + 0.35;
    v.placed = g.world.place('briar_vine', v.spot.x + v.nx * 0.25, v.spot.y - 0.1, v.spot.z + v.nz * 0.25, Math.atan2(v.nx, v.nz), { opts: { height: h }, collide: false, far: 400 });
    v.mat = growMaterial();
    if (v.placed) v.placed.object.traverse((o) => o.isMesh && (o.material = v.mat));
  }
  growVine() {
    const v = this.vine,
      g = this.game;
    this.makeVine();
    v.growing = true;
    v.k = 0;
    if (v.placed) {
      v.placed.hidden = false;
      v.placed.object.visible = true;
    }
    g.audio.sfx('vine_grow', { pos: [v.spot.x, v.spot.y + 2, v.spot.z] });
  }

  rime(x, y, z, surface) {
    const g = this.game;
    if (surface === 'water') this.makeFloe(x, y, z, false);
    else if (surface === 'lava') this.makeFloe(x, y, z, true);
    if (!(this.cage && this.cage.open))
      for (const b of this.braziers) {
        if (!b.lit || Math.hypot(x - b.flame.x, y - b.flame.y, z - b.flame.z) > 4) continue;
        this.setBrazier(b, false);
        g.state.world.flags['brazier' + b.id] = false;
        g.audio.sfx('extinguish', { pos: [b.flame.x, b.flame.y, b.flame.z] });
      }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fr = this.fires[i];
      if (Math.hypot(x - fr.x, z - fr.z) < 4.5) {
        g.fx.remove(fr.src);
        this.fires.splice(i, 1);
        g.audio.sfx('extinguish', { pos: [fr.x, fr.y, fr.z], gain: 0.6 });
      }
    }
  }
  /** Ice on water, or cooled crust on lava: a raft of plates round the point. */
  makeFloe(x, y, z, lava) {
    const g = this.game,
      w = g.world;
    const name = lava ? 'lava_crust' : 'ice_floe';
    if (!hasModel(name)) return;
    const level = lava ? WORLD.lava : y;
    const bed = (px, pz) => w.T.heightAt(px, pz) < level - 0.25;
    const plates = lava
      ? [
          [0, 0, 1.3],
          [2.5, 0.4, 1.15],
          [-2.3, 0.9, 1.15],
          [0.6, 2.5, 1.1],
          [-0.5, -2.5, 1.1],
          [2.2, -2.1, 1.0],
          [-2.4, -1.7, 1.0],
        ]
      : [[0, 0, 1.55]];
    const rot = Math.random() * 6.283;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    for (const [ox, oz, sc] of plates) {
      const px = x + ox * c - oz * s,
        pz = z + ox * s + oz * c;
      if (!bed(px, pz)) continue;
      const placed = w.place(name, px, level, pz, Math.random() * 6.283, { seed: 1 + ((Math.random() * 3) | 0), scale: sc, tag: lava ? 'crust' : 'floe', far: 300 });
      if (!placed) continue;
      placed.object.scale.setScalar(0.01);
      this.floes.push({ placed, x: px, z: pz, y: level, lava, life: (lava ? CRUST_LIFE : FLOE_LIFE) * (0.92 + Math.random() * 0.16), age: 0, scale: sc, warned: false, ph: Math.random() * 6 });
    }
    const cap = 26;
    while (this.floes.length > cap) this.removePlaced(this.floes.shift().placed);
    g.audio.sfx(lava ? 'steam' : 'ice_form', { pos: [x, level, z] });
  }

  levity(x, y, z) {
    const g = this.game,
      l = this.lid;
    if (l && !l.open && !l.opening && Math.hypot(x - l.x, z - l.z) < 5 && Math.abs(y - l.y) < 5) {
      l.opening = true;
      g.audio.sfx('lid_slide', { pos: [l.x, l.y + 1, l.z] });
    }
  }

  fulminate(x, y, z) {
    const r = this.rockfall;
    if (r && !r.broken) {
      const s = r.spot;
      // the plug lies across the canyon: its long axis is the canyon's normal
      const ax = -s.tz,
        az = s.tx;
      if (Math.abs(y - s.y - 2) < 7 && segDist(x, z, s.x - ax * 4.5, s.z - az * 4.5, s.x + ax * 4.5, s.z + az * 4.5) < 6.5) this.breakRock(x, y, z);
    }
    for (const fl of this.floes) if (Math.hypot(x - fl.x, z - fl.z) < 5) fl.life = Math.min(fl.life, 0.5);
    for (const p of this.pillars) if (Math.hypot(x - p.x, z - p.z) < 5) p.life = Math.min(p.life, 0.1);
  }
  breakRock(bx, by, bz) {
    const g = this.game,
      r = this.rockfall,
      s = r.spot;
    r.broken = true;
    g.state.world.flags.rockfall = true;
    r.placed.hidden = true;
    r.placed.object.visible = false;
    this.solid(r.placed, false);
    g.audio.sfx('rock_break', { pos: [s.x, s.y + 2, s.z] });
    g.particles.blast(s.x, s.y + 2, s.z, 6);
    for (let i = 0; i < 5; i++) g.particles.dust(s.x + (Math.random() - 0.5) * 7, s.y + Math.random() * 3, s.z + (Math.random() - 0.5) * 5, 2.2, [0.36, 0.33, 0.3], 10);
    if (hasModel('rubble')) {
      const ax = -s.tz,
        az = s.tx;
      for (let i = 0; i < 14; i++) {
        const u = (Math.random() - 0.5) * 7.5,
          v = (Math.random() - 0.5) * 2.5;
        const x = s.x + ax * u + s.tx * v,
          z = s.z + az * u + s.tz * v,
          y = s.y + 0.8 + Math.random() * 3.8;
        const scale = 1 + Math.random() * 1.3;
        const placed = g.world.place('rubble', x, y, z, Math.random() * 6.283, { seed: 1 + (i % 8), scale, collide: false });
        if (!placed) continue;
        const rad = Math.max(0.2, placed.model.radius * scale * 0.72);
        const prop = g.physics.addProp({ shape: 'sphere', r: rad, mass: 40 * rad * rad * rad + 6, x, y, z, object: placed.object, tag: 'rubble' });
        prop.noMirror = true;
        g.physics._mirror(prop);
        const dx = x - bx,
          dy = y - by + 1.5,
          dz = z - bz;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 4 + Math.random() * 7;
        prop.body.velocity.set((dx / d) * sp, (dy / d) * sp + 3, (dz / d) * sp);
        prop.body.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
        this.rubble.push({ prop, placed, life: 26 + Math.random() * 10, scale });
      }
    }
    g.shake(1);
    g.toast('info', 'The plug is broken', 'The Brimstone Scar lies open.');
    g.save();
  }

  saltspire(x, y, z, surface) {
    const g = this.game,
      w = g.world;
    if (!hasModel('salt_pillar')) return;
    const bed = w.T.heightAt(x, z);
    let base = y,
      height = 2.8;
    if (surface === 'water' || surface === 'lava') {
      base = bed - 0.1;
      height = y - base + 0.55;
    } else if (surface === 'object') {
      // on a floe or a pier: stand on whatever is there
      base = y;
    } else base = bed - 0.05;
    const placed = w.place('salt_pillar', x, base, z, Math.random() * 6.283, { seed: 1, collide: false, far: 400 });
    if (!placed) return;
    const sy = height / 2.8;
    placed.object.scale.set(1, 0.001, 1);
    const p = { placed, x, z, base, height, sy, k: 0, life: PILLAR_LIFE, col: 0, r: 0.8 };
    this.pillars.push(p);
    while (this.pillars.length > 6) this.removePillar(this.pillars.shift(), true);
    g.audio.sfx('spire_rise', { pos: [x, base + 1, z] });
  }
  _pillarCollider(p) {
    const g = this.game,
      col = g.world.collision;
    if (p.col) {
      g.physics.forget(p.col);
      col.remove(p.col);
      p.col = 0;
    }
    const h = p.height * p.k;
    if (h < 0.05) return;
    p.col = col.add({ type: 'cyl', c: [p.x, p.base + h / 2, p.z], r: p.r, h, tag: 'pillar', owner: p.placed });
  }
  removePillar(p, loud) {
    const g = this.game;
    if (p.col) {
      g.physics.forget(p.col);
      g.world.collision.remove(p.col);
      p.col = 0;
    }
    if (loud) {
      g.audio.sfx('spire_crumble', { pos: [p.x, p.base + 1, p.z] });
      g.particles.salt(p.x, p.base + p.height * 0.5, p.z, 1.4);
      g.particles.dust(p.x, p.base + p.height, p.z, 1.2, [0.8, 0.76, 0.74], 12);
    }
    w_remove(g.world, p.placed);
  }

  /** Any burst at all: the drowned bell answers a blow. */
  struck(x, y, z) {
    const b = this.bell;
    if (b && Math.hypot(x - b.pos.x, y - b.pos.y, z - b.pos.z) < 5.5) {
      b.swing = 1;
      b.t = 0;
      this.game.audio.sfx('bell', { pos: [b.pos.x, b.pos.y, b.pos.z] });
    }
  }

  // =============================================================================== focus
  /** The interactable the apprentice is looking at, or null. eye: Vector3, dir: [x, y, z]. */
  focus(eye, dir) {
    const col = this.game.world.collision;
    let best = null,
      bs = -1e9,
      second = null,
      ss = -1e9;
    for (const it of this.list) {
      const p = it.pos;
      const dx = p.x - eye.x,
        dy = p.y - eye.y,
        dz = p.z - eye.z;
      const reach = it.reach || 2.7;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach * reach) continue;
      if (it.test && !it.test()) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / d;
      if (dot < (d < 0.9 ? 0.3 : it.wide ? 0.74 : 0.85)) continue;
      const s = dot - d * 0.07 + (it.prio || 0);
      if (s > bs) {
        second = best;
        ss = bs;
        best = it;
        bs = s;
      } else if (s > ss) {
        second = it;
        ss = s;
      }
    }
    for (const it of [best, second]) {
      if (!it) continue;
      const p = it.pos;
      const dx = p.x - eye.x,
        dy = p.y - eye.y,
        dz = p.z - eye.z;
      const d = Math.hypot(dx, dy, dz) || 1e-3;
      if (d < 0.6) return it;
      const t = col.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d - 0.2, _out, (c) => !c.dyn && c.owner !== it.owner);
      if (t === Infinity) return it;
    }
    return null;
  }

  // =============================================================================== per frame
  /** Parts that sit in a pose: the lid, the cage, the bell. */
  _pose() {
    const l = this.lid;
    if (l && l.mesh) {
      const k = easeInOutCubic(l.k);
      const t = this.game.engine.time;
      l.mesh.position.set(k * 1.9, l.ly + k * 2.3 + (l.k > 0.99 ? Math.sin(t * 0.7) * 0.07 : 0), k * 0.6);
      l.mesh.rotation.set(k * 0.32 + (l.k > 0.99 ? Math.sin(t * 0.45) * 0.03 : 0), k * 0.9, k * -0.2);
    }
    const c = this.cage;
    if (c && c.mesh) c.mesh.position.y = -1.9 * easeInOutCubic(c.k);
    for (const b of this.braziers) b.mat.userData.u.uHeat.value = b.heat;
    if (this.athanor) this.athanor.mat.userData.u.uHeat.value = this.athanor.heat;
  }

  update(dt) {
    const g = this.game,
      st = g.state,
      w = g.world,
      t = g.engine.time;
    const pl = g.player.pos;

    // plants come back
    this._tick -= dt;
    if (this._tick <= 0) {
      this._tick = 1.3;
      for (const p of this.plants) {
        if (!p.picked) continue;
        const at = st.world.picked[p.key];
        if (at != null && st.world.clock >= at && Math.hypot(p.spot.x - pl.x, p.spot.z - pl.z) > 14) {
          delete st.world.picked[p.key];
          this.setPicked(p, false);
        }
      }
    }

    // primes hang and turn
    for (const id in this.primes) {
      const pr = this.primes[id];
      if (!pr.placed || pr.taken) continue;
      pr.t += dt;
      pr.placed.object.rotation.y = pr.t * 0.5;
      pr.placed.object.position.y = pr.at.y + 0.12 + Math.sin(pr.t * 1.1) * 0.045 + (id === 'mercury' && this.lid ? this.lid.k * 0.45 : 0);
    }

    // the Athanor
    const a = this.athanor;
    if (a) {
      a.heat = damp(a.heat, a.level >= 2 ? 1 : a.level === 1 ? 0.5 : 0, 0.8, dt);
      if (a.level > 0 && !a.loop) a.loop = g.audio.loop('athanor', { pos: [a.mouth.x, a.mouth.y, a.mouth.z], gain: 0.9 });
      if (a.loop) {
        if (a.level === 0) {
          a.loop.stop(0.5);
          a.loop = null;
        } else a.loop.set({ param: a.heat });
      }
      if (a.stone && a.level >= 2) a.stone.object.rotation.y = t * 0.6;
    }

    // braziers warm and cool
    for (const b of this.braziers) b.heat = damp(b.heat, b.lit ? 1 : 0, 1.6, dt);
    if (this.cage) {
      const c = this.cage;
      const was = c.k;
      c.k = clamp(c.k + (c.open ? dt / 2.6 : -dt / 2.6), 0, 1);
      if (was < 0.9 && c.k >= 0.9 && this.primes.sulfur) this.showPrime(this.primes.sulfur);
    }

    // the lid drifts off
    const l = this.lid;
    if (l && l.opening) {
      const was = l.k;
      l.k = Math.min(1, l.k + dt / 3.6);
      if (Math.random() < dt * 20) g.particles.levity(l.x + (Math.random() - 0.5) * 2, l.y + 1 + l.k * 2, l.z + (Math.random() - 0.5) * 2, 0.8);
      if (was < 0.15 && l.k >= 0.15 && this.primes.mercury) this.showPrime(this.primes.mercury);
      if (l.k >= 1) {
        l.opening = false;
        l.open = true;
        st.world.flags.lid = true;
        g.toast('info', 'The stone forgets its weight', 'What it kept is yours to take.');
        g.save();
      }
    }

    // the gate burns
    const gt = this.gate;
    if (gt && gt.burning) {
      gt.burn += dt / 3.6;
      gt.mat.userData.u.uBurn.value = Math.min(1, gt.burn);
      if (Math.random() < dt * 30) {
        const u = (Math.random() - 0.5) * 2 * gt.half;
        g.particles.spawn(4, gt.x + gt.ax * u, gt.y + Math.random() * 3.6, gt.z + gt.az * u, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 1.5, { life: 0.8 + Math.random(), size: 0.014, color: [1, 0.5, 0.15], gain: 9, grav: -0.2, drag: 0.5 });
      }
      for (const s of gt.fires) g.fx.set(s, { power: clamp(1.5 - gt.burn, 0, 1) * 1.2 });
      if (gt.burn >= 0.55 && gt.placed.colliderIds.length) this.solid(gt.placed, false);
      if (gt.burn >= 1.25) {
        gt.burning = false;
        gt.gone = true;
        gt.placed.hidden = true;
        gt.placed.object.visible = false;
        for (const s of gt.fires) g.fx.remove(s);
        gt.fires.length = 0;
        st.world.flags.gate = true;
        w.fx.stamp(gt.x, gt.z, 6, 0, 1);
        g.toast('info', 'The briar is ash', 'The Saltwood lies open.');
        g.save();
      }
    }

    // the vine climbs
    const v = this.vine;
    if (v && v.growing) {
      v.k += dt / 4.6;
      const top = v.spot.top.y + 1.2;
      if (v.mat) v.mat.userData.u.uGrowY.value = lerp(v.spot.y - 0.3, top, easeInOutCubic(Math.min(1, v.k)));
      if (Math.random() < dt * 14) g.particles.verdance(v.spot.x, lerp(v.spot.y, top, Math.min(1, v.k)), v.spot.z, 0.8);
      if (v.k >= 1) {
        v.growing = false;
        v.grown = true;
        v.ladder.active = true;
        if (v.mat) v.mat.userData.u.uGrowY.value = 1e6;
        st.world.flags.vine = true;
        g.toast('info', 'The briar wakes', 'It climbs the Hollow. So can you.');
        g.save();
      }
    }

    // floes and crust
    for (let i = this.floes.length - 1; i >= 0; i--) {
      const fl = this.floes[i];
      fl.age += dt;
      fl.life -= dt;
      const grow = clamp(fl.age / 0.6, 0, 1);
      const out = clamp(fl.life / 1.2, 0, 1);
      const o = fl.placed.object;
      o.scale.setScalar(fl.scale * (1 - Math.pow(1 - grow, 3)) * (0.35 + 0.65 * out));
      o.position.y = fl.y + Math.sin(t * 0.9 + fl.ph) * 0.02 - (1 - out) * 0.5;
      if (fl.life < 6 && !fl.warned) {
        fl.warned = true;
        g.audio.sfx(fl.lava ? 'steam' : 'ice_crack', { pos: [fl.x, fl.y, fl.z] });
      }
      if (fl.lava && fl.life < 6 && Math.random() < dt * 6) g.particles.spawn(0, fl.x + (Math.random() - 0.5) * 2.4, fl.y + 0.15, fl.z + (Math.random() - 0.5) * 2.4, 0, 0.8 + Math.random(), 0, { life: 1.2, size: 0.03, color: [1, 0.4, 0.08], gain: 8 });
      if (fl.life < 1.0 && fl.placed.colliderIds.length) this.solid(fl.placed, false);
      if (fl.life <= 0) {
        if (!fl.lava) g.particles.splash(fl.x, fl.y, fl.z, 1.4);
        this.removePlaced(fl.placed);
        this.floes.splice(i, 1);
      }
    }

    // pillars
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      if (p.k < 1) {
        p.k = Math.min(1, p.k + dt / 0.85);
        const e = 1 - Math.pow(1 - p.k, 2);
        p.placed.object.scale.set(1, Math.max(0.001, p.sy * e), 1);
        const kk = p.k;
        p.k = e;
        this._pillarCollider(p);
        p.k = kk;
        if (Math.random() < dt * 40) g.particles.salt(p.x, p.base + p.height * e, p.z, 0.7);
      }
      p.life -= dt;
      if (p.life <= 0) {
        this.removePillar(p, true);
        this.pillars.splice(i, 1);
      }
    }

    // ground fire
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fr = this.fires[i];
      fr.life -= dt;
      g.fx.set(fr.src, { power: clamp(fr.life / 2, 0, 1) });
      if (Math.hypot(pl.x - fr.x, pl.z - fr.z) < 1.0 && Math.abs(pl.y - fr.y) < 1.5 && fr.life > 0.5) g.hurt(9 * dt, 'fire');
      if (fr.life <= 0) {
        g.fx.remove(fr.src);
        this.fires.splice(i, 1);
      }
    }

    // rubble goes to dust
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i];
      r.life -= dt;
      if (r.life < 1) r.placed.object.scale.setScalar(Math.max(0.01, r.scale * r.life));
      if (r.life <= 0) {
        g.physics.removeProp(r.prop);
        w_remove(w, r.placed);
        this.rubble.splice(i, 1);
      }
    }

    // carried things, and where the loose ones have got to (for culling)
    this._hold(dt);
    for (const p of this.props) {
      const pd = p.data.placed,
        b = p.body.position;
      pd.x = b.x;
      pd.y = b.y;
      pd.z = b.z;
    }

    // the bell
    const b = this.bell;
    if (b && b.swing > 0.002) {
      b.t += dt;
      b.swing *= Math.exp(-dt * 0.5);
      if (b.mesh) {
        // swing about the headstock, which sits above the bell's mouth
        const ang = Math.sin(b.t * 2.6) * 0.22 * b.swing;
        b.mesh.rotation.z = ang;
      }
    }

    this._pose();
  }
}

function w_remove(world, placed) {
  if (placed) world.remove(placed);
}
const _col = new THREE.Color();
export function hexRGB(hex) {
  _col.set(hex);
  return [_col.r, _col.g, _col.b];
}
export { POTIONS };
