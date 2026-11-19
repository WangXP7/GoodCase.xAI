// The belt: choosing a phial, the bottle in the hand, the throw and its arc, drinking, and what
// each potion does where it breaks.
import * as THREE from 'three';
import { POTIONS, POTION_ORDER } from './data.js';
import { add, beltOf } from './state.js';
import { Placed } from '../world/props.js';
import { buildModel, hasModel } from '../models/index.js';
import { worldMaterial } from '../gfx/atmos.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';
import { WORLD, SCAR } from '../world/heightmap.js';
import { clamp, damp, lerp } from '../core/math.js';
import { hexRGB } from './entities.js';

const G = 12; // gravity on a thrown phial
const SPEED = 15.5;
const ARC_N = 56;
const _hit = { t: 0, col: null, nx: 0, ny: 1, nz: 0 };
const _a = [0, 0, 0];
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();

export class Potions {
  constructor(game) {
    this.game = game;
    this.shots = [];
    this.aiming = false;
    this.aimK = 0;
    this.raise = 0;
    this.flick = 0;
    this.drinkT = 0;
    this.viewId = null;
    this.view = null;
    this.hand = new THREE.Group();
    this.hand.visible = false;
    game.engine.camera.add(this.hand);

    // the arc: a string of faint points and a ring where it will land
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_N * 3), 3));
    geo.setDrawRange(0, 0);
    // (round motes of a steady size on the screen: points left to perspective swell into squares by the hand)
    const arcMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1.7, 1.42, 1.05) }, uScale: { value: 1 } },
      vertexShader: 'uniform float uScale; varying float vFade; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z; gl_PointSize = clamp(30.0 / d, 2.6, 6.0) * uScale; vFade = smoothstep(0.45, 1.5, d); }',
      fragmentShader: 'uniform vec3 uColor; varying float vFade; void main() { float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.26, r) * 0.78 * vFade; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }',
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.arc = new THREE.Points(geo, arcMat);
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 24;
    this.arc.layers.set(LAYER_MAIN_ONLY);
    this.arc.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.5), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.ring.renderOrder = 24;
    this.ring.layers.set(LAYER_MAIN_ONLY);
    this.ring.visible = false;
    game.engine.scene.add(this.arc, this.ring);
    this._sim = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  }

  // ------------------------------------------------------------------------------ the belt
  select(id) {
    const st = this.game.state;
    if (!id || !(st.inv.potions[id] > 0) || st.inv.selected === id) return;
    st.inv.selected = id;
    this.game.audio.sfx('ui_click', { gain: 0.5 });
  }
  next() {
    const st = this.game.state;
    const belt = beltOf(st);
    if (!belt.length) return;
    const i = belt.indexOf(st.inv.selected);
    this.select(belt[(i + 1) % belt.length]);
  }

  /** A bottle to hold or to throw. */
  makeBottle(id) {
    const name = 'bottle_' + id;
    let obj;
    if (hasModel(name)) obj = new Placed(name, buildModel(name, 1), this.game.world.mats, 0, 0, 0, 0, 1).object;
    else {
      obj = new THREE.Group();
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), worldMaterial(new THREE.MeshStandardMaterial({ color: POTIONS[id].color, emissive: POTIONS[id].color, emissiveIntensity: 1.2, roughness: 0.25 })));
      m.position.y = 0.09;
      obj.add(m);
    }
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.layers.set(LAYER_MAIN_ONLY);
      }
    });
    return obj;
  }

  // ------------------------------------------------------------------------------ flight
  /** Where a throw leaves the hand, and how fast. */
  launch(out) {
    const pl = this.game.player,
      cam = this.game.engine.camera.position;
    pl.aim(_a);
    const ch = Math.cos(pl.heading),
      sh = Math.sin(pl.heading);
    out.x = cam.x + _a[0] * 0.35 + ch * 0.2;
    out.y = cam.y + _a[1] * 0.35 - 0.14;
    out.z = cam.z + _a[2] * 0.35 + sh * 0.2;
    out.vx = _a[0] * SPEED + pl.vel.x * 0.6;
    out.vy = _a[1] * SPEED + 1.7;
    out.vz = _a[2] * SPEED + pl.vel.z * 0.6;
    return out;
  }
  /** Level of whatever liquid lies over the land at a point (or -Infinity) and whether it is lava. */
  liquid(x, z, h) {
    let level = this.game.player.waterAt(x, z, h);
    let lava = false;
    if (h < WORLD.lava && Math.hypot(x - SCAR.x, z - SCAR.z) < SCAR.lava + 3.5) {
      level = WORLD.lava;
      lava = true;
    }
    this._lava = lava;
    return level;
  }
  /** Advance a body one step; returns what it hit, or null. */
  step(s, dt) {
    const w = this.game.world,
      T = w.T;
    const nx = s.x + s.vx * dt,
      ny = s.y + s.vy * dt - 0.5 * G * dt * dt,
      nz = s.z + s.vz * dt;
    const dx = nx - s.x,
      dy = ny - s.y,
      dz = nz - s.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    let hit = null;
    let frac = 1;
    const t = w.collision.raycast(s.x, s.y, s.z, dx / len, dy / len, dz / len, len, _hit);
    if (t <= len) {
      frac = t / len;
      hit = { x: s.x + dx * frac, y: s.y + dy * frac, z: s.z + dz * frac, surface: 'object', col: _hit.col, nx: _hit.nx, ny: _hit.ny, nz: _hit.nz };
    }
    // land and liquid: is the end of the step under either?
    const ex = s.x + dx * frac,
      ey = s.y + dy * frac,
      ez = s.z + dz * frac;
    const h = T.heightAt(ex, ez);
    const lv = this.liquid(ex, ez, h);
    if (ey <= Math.max(h, lv)) {
      // find the crossing
      let a = 0,
        b = frac;
      for (let i = 0; i < 6; i++) {
        const m = (a + b) / 2;
        const mx = s.x + dx * m,
          mz = s.z + dz * m;
        const mh = T.heightAt(mx, mz);
        if (s.y + dy * m <= Math.max(mh, this.liquid(mx, mz, mh))) b = m;
        else a = m;
      }
      const px = s.x + dx * b,
        pz = s.z + dz * b;
      const ph = T.heightAt(px, pz);
      const pl = this.liquid(px, pz, ph);
      const wet = pl > ph;
      hit = { x: px, y: wet ? pl : ph, z: pz, surface: wet ? (this._lava ? 'lava' : 'water') : 'ground', col: null, nx: 0, ny: 1, nz: 0 };
      if (!wet) {
        T.normalAt(px, pz, _a);
        hit.nx = _a[0];
        hit.ny = _a[1];
        hit.nz = _a[2];
      }
    }
    s.x = nx;
    s.y = ny;
    s.z = nz;
    s.vy -= G * dt;
    return hit;
  }

  throw(id) {
    const g = this.game,
      st = g.state;
    if (!(st.inv.potions[id] > 0)) return;
    add(st.inv.potions, id, -1);
    st.stats.thrown++;
    const s = this.launch({ id, life: 8, spin: [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14], obj: this.makeBottle(id), color: hexRGB(POTIONS[id].color) });
    s.obj.position.set(s.x, s.y, s.z);
    g.engine.scene.add(s.obj);
    this.shots.push(s);
    g.audio.sfx('throw', { gain: 0.8 });
    this.flick = 1;
    this.raise = 0;
  }

  drink() {
    const g = this.game,
      st = g.state;
    const sel = st.inv.selected,
      def = sel && POTIONS[sel];
    if (!def || !(st.inv.potions[sel] > 0)) return;
    if (!def.drink) {
      g.say(def.name + ' is not for drinking.');
      return;
    }
    if (sel === 'vitae' && st.player.hp >= st.player.hpMax - 0.5 && st.player.regen <= 0) {
      g.say('You are whole. Keep it for a wound.');
      return;
    }
    add(st.inv.potions, sel, -1);
    this.drinkT = 0.8;
    g.audio.sfx('drink');
    if (sel === 'levity') {
      st.player.levity = 20;
      g.audio.sfx('levity_burst', { gain: 0.35 });
      g.toast('info', 'Levity', 'The ground lets go of you for a while.', { kind: 'potion', id: 'levity' });
    } else if (sel === 'vitae') {
      g.heal(45);
      st.player.regen = 12;
      g.audio.sfx('heal', { gain: 0.8 });
    }
  }

  // ------------------------------------------------------------------------------ bursts
  burst(id, x, y, z, surface) {
    const g = this.game,
      P = g.particles,
      E = g.ents,
      w = g.world,
      pl = g.player,
      st = g.state;
    const pos = [x, y, z];
    const land = surface === 'ground' || surface === 'object';
    g.audio.sfx('shatter', { pos, gain: 0.7 });
    P.shatter(x, y + 0.05, z, hexRGB(POTIONS[id].color));
    if (surface === 'water') {
      P.splash(x, y, z, 1.3);
      g.audio.sfx('splash', { pos, gain: 0.5 });
    }
    const dPl = Math.hypot(pl.pos.x - x, pl.pos.y + 0.9 - y, pl.pos.z - z);
    switch (id) {
      case 'ember':
        g.audio.sfx('ember_burst', { pos });
        P.fireball(x, y + 0.3, z, 2.6);
        g.fx.flash(x, y + 1, z, '#ff9040', 150, 34, 0.9);
        if (land) w.fx.stamp(x, z, 3.2, 0, 0.9);
        if (surface === 'water' || surface === 'lava') g.audio.sfx('steam', { pos, gain: 0.6 });
        E.ember(x, y, z);
        g.shades.burn(x, y, z, 5);
        if (dPl < 2.6) g.hurt(6 + 16 * (1 - dPl / 2.6), 'fire');
        break;
      case 'verdance':
        g.audio.sfx('verdance_burst', { pos });
        P.verdance(x, y + 0.2, z, 2.8);
        g.fx.flash(x, y + 0.8, z, '#8fe070', 40, 20, 1.2);
        if (land) w.fx.stamp(x, z, 4.4, 2, 1);
        E.verdance(x, y, z);
        break;
      case 'rime':
        g.audio.sfx('rime_burst', { pos });
        P.frost(x, y + 0.2, z, 3.4);
        g.fx.flash(x, y + 0.8, z, '#a8d8ff', 70, 26, 1.0);
        if (land) w.fx.stamp(x, z, 4.8, 1, 1);
        E.rime(x, y, z, surface);
        g.shades.freeze(x, y, z, 5.5, 9);
        if (dPl < 2.8) g.frost = 1;
        break;
      case 'levity':
        g.audio.sfx('levity_burst', { pos });
        P.levity(x, y + 0.3, z, 3.4);
        g.fx.flash(x, y + 1, z, '#b8a8ff', 60, 24, 1.4);
        g.physics.levitate(x, y, z, 4.6, 9);
        E.levity(x, y, z);
        if (dPl < 3.2) st.player.levity = Math.max(st.player.levity, 7);
        break;
      case 'fulminate': {
        g.audio.sfx('fulminate_burst', { pos });
        P.blast(x, y + 0.4, z, 5.5);
        g.fx.flash(x, y + 1.2, z, '#fff0c0', 420, 60, 0.55);
        if (land) w.fx.stamp(x, z, 4.6, 0, 0.75);
        g.physics.explode(x, y, z, 8.5, 9);
        E.fulminate(x, y, z);
        g.shades.burn(x, y, z, 6.5);
        g.shake(clamp(1.5 - dPl / 13, 0, 1));
        if (dPl < 5.5) {
          const k = 1 - dPl / 5.5;
          g.hurt(45 * k, 'blast');
          const dx = pl.pos.x - x,
            dz = pl.pos.z - z;
          const d = Math.hypot(dx, dz) || 1;
          pl.kick((dx / d) * 9 * k, 2 + 4.5 * k, (dz / d) * 9 * k);
        }
        break;
      }
      case 'saltspire':
        P.salt(x, y + 0.3, z, 1.6);
        g.fx.flash(x, y + 1, z, '#ffe8ea', 40, 18, 0.8);
        E.saltspire(x, y, z, surface);
        break;
      default:
        break;
    }
    E.struck(x, y, z);
  }

  // ------------------------------------------------------------------------------ per frame
  /** active: the apprentice is free to act (play mode, not reading). */
  update(dt, input, active) {
    const g = this.game,
      st = g.state,
      inv = st.inv;
    if (inv.selected && !(inv.potions[inv.selected] > 0)) {
      const belt = beltOf(st);
      inv.selected = belt[0] || null;
    }
    const sel = inv.selected,
      def = sel && POTIONS[sel];
    const carrying = !!g.ents.held;
    let aiming = false;
    if (active) {
      for (let k = 1; k <= 7; k++) if (input.hit('Digit' + k)) this.select(POTION_ORDER[k - 1]);
      if (input.hit('KeyQ')) this.next();
      if (carrying) {
        if (input.hit('Mouse0') || input.hit('Click')) g.ents.drop(true);
        this.aiming = false;
      } else if (def && def.throw) {
        if (input.locked) {
          if (input.hit('Mouse0')) this.aiming = true;
          if (this.aiming && !input.left) {
            this.aiming = false;
            this.throw(sel);
          }
          aiming = this.aiming;
        } else {
          // no pointer lock: dragging looks around (and shows the arc), a still click throws
          aiming = input.left;
          this.aiming = false;
          if (input.hit('Click')) this.throw(sel);
        }
      } else {
        this.aiming = false;
        if (def && (input.hit('Mouse0') || input.hit('Click'))) g.say(def.name + ' is for drinking. Press F.');
      }
      if (input.hit('KeyF')) this.drink();
    } else this.aiming = false;

    // phials in the air
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      let hit = null;
      const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy, s.vz) * dt) / 0.5));
      for (let k = 0; k < n && !hit; k++) {
        const x0 = s.x,
          y0 = s.y,
          z0 = s.z;
        hit = this.step(s, dt / n);
        if (!hit && g.shades.hitSegment(x0, y0, z0, s.x, s.y, s.z)) hit = { x: s.x, y: s.y, z: s.z, surface: 'object' };
      }
      s.obj.position.set(s.x, s.y, s.z);
      s.obj.rotation.x += s.spin[0] * dt;
      s.obj.rotation.y += s.spin[1] * dt;
      s.obj.rotation.z += s.spin[2] * dt;
      if (Math.random() < dt * 60) g.particles.spawn(0, s.x, s.y + 0.08, s.z, 0, 0, 0, { life: 0.35, size: 0.035, size1: 0.005, color: s.color, gain: 3, fade: 0.05 });
      if (hit || s.life <= 0) {
        g.engine.scene.remove(s.obj);
        this.shots.splice(i, 1);
        if (hit) this.burst(s.id, hit.x, hit.y, hit.z, hit.surface);
      }
    }

    // the bottle in the hand
    const show = active && !carrying && !!sel;
    if (this.viewId !== sel) {
      if (this.view) {
        this.hand.remove(this.view);
        this.view.traverse((o) => o.isMesh && o.userData.ownGeo && o.geometry.dispose());
      }
      this.view = sel ? this.makeBottle(sel) : null;
      if (this.view) {
        this.view.scale.setScalar(0.44);
        // it sits right before the eye: there it should glow, not glare
        this.view.traverse((o) => {
          if (!o.isMesh || !o.geometry.attributes.aFx) return;
          o.geometry = o.geometry.clone();
          o.userData.ownGeo = true;
          const a = o.geometry.attributes.aFx;
          for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) * 0.3);
        });
        this.hand.add(this.view);
      }
      this.viewId = sel;
      this.raise = 0;
    }
    this.hand.visible = show && this.raise > 0.01;
    this.raise = damp(this.raise, show ? 1 : 0, show ? 7 : 14, dt);
    this.aimK = damp(this.aimK, aiming ? 1 : 0, 11, dt);
    this.flick = Math.max(0, this.flick - dt * 4.5);
    this.drinkT = Math.max(0, this.drinkT - dt);
    const dk = Math.sin(clamp(this.drinkT / 0.8, 0, 1) * Math.PI);
    const bob = Math.sin(g.player._bob) * g.player._bobAmp;
    const sway = Math.cos(g.player._bob * 0.5) * g.player._bobAmp;
    const fov = Math.tan((g.engine.camera.fov * Math.PI) / 360) / Math.tan((72 * Math.PI) / 360);
    this.hand.position.set((lerp(0.205, 0.14, this.aimK) + sway * 0.006 - dk * 0.13) * fov, (-0.2 - (1 - this.raise) * 0.22 + this.aimK * 0.035 + bob * 0.007 + dk * 0.1) * fov, -0.4 + this.aimK * 0.06 - this.flick * 0.12);
    this.hand.rotation.set(lerp(0.12, -0.55, this.aimK) + this.flick * 1.1 - dk * 1.3, 0.4, lerp(-0.12, -0.3, this.aimK) + dk * 0.5);

    // the arc
    const arcOn = aiming && show;
    this.arc.visible = arcOn;
    this.arc.material.uniforms.uScale.value = Math.max(0.6, g.engine.h / 900);
    this.ring.visible = false;
    if (arcOn) {
      const s = this.launch(this._sim);
      const pos = this.arc.geometry.attributes.position;
      let n = 0,
        hit = null;
      const h = 0.045;
      for (let i = 0; i < ARC_N * 3 && !hit; i++) {
        if (i % 3 === 1 && n < ARC_N) pos.setXYZ(n++, s.x, s.y, s.z);
        hit = this.step(s, h / 3 + i * 0.0002);
      }
      // the first point sits in the hand; leave it out
      this.arc.geometry.setDrawRange(1, Math.max(0, n - 1));
      pos.needsUpdate = true;
      if (hit) {
        this.ring.visible = true;
        _n.set(hit.nx || 0, hit.ny == null ? 1 : hit.ny, hit.nz || 0).normalize();
        this.ring.quaternion.copy(_q.setFromUnitVectors(_up, _n));
        this.ring.position.set(hit.x + _n.x * 0.06, hit.y + _n.y * 0.06, hit.z + _n.z * 0.06);
        const pulse = 1 + Math.sin(g.engine.time * 5) * 0.06;
        this.ring.scale.setScalar(pulse);
      }
    }
    this.isAiming = aiming && show;
  }

  /** Remove everything in flight (new game, load). */
  reset() {
    for (const s of this.shots) this.game.engine.scene.remove(s.obj);
    this.shots.length = 0;
    this.aiming = false;
  }
}
