// Shades: the hunger of the Gloom, wearing what it found. They drift where the Gloom lies, come
// for the living, cannot bear a lit lantern, stand still in the cold and come apart in fire.
import * as THREE from 'three';
import { ghostMaterial } from './fx.js';
import { hasModel } from '../models/index.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';
import { WORLD, SCAR } from '../world/heightmap.js';
import { clamp, damp, angleDelta } from '../core/math.js';

const SEE = 21,
  LOSE = 44,
  SPEED = 3.25,
  TOUCH = 1.75,
  DRAIN = 13,
  LANTERN_R = 13.5,
  RESPAWN = 110;

export class Shades {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.closeness = 0; // 0 none near .. 1 touching
    this.loop = null;
    this._hitT = 0;
  }

  build() {
    const g = this.game,
      w = g.world;
    if (!hasModel('shade')) return;
    for (const s of w.spots.shades) {
      const y = w.T.heightAt(s.x, s.z);
      const placed = w.place('shade', s.x, y, s.z, 0, { collide: false, far: 150 });
      if (!placed) continue;
      const mat = ghostMaterial();
      const model = placed.model;
      const arms = [];
      placed.object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.layers.set(LAYER_MAIN_ONLY);
        }
      });
      if (placed.body) placed.body.material = mat;
      for (const side of ['L', 'R']) {
        const mesh = placed.parts['arm' + side];
        const a = model.anchors['shoulder' + side];
        if (!mesh) continue;
        mesh.material = mat;
        if (a) {
          const pivot = new THREE.Group();
          pivot.position.set(a[0], a[1], a[2]);
          placed.object.add(pivot);
          pivot.add(mesh);
          mesh.position.set(-a[0], -a[1], -a[2]);
          arms.push(pivot);
        }
      }
      placed.hidden = true;
      placed.object.visible = false;
      this.list.push({ spot: s, region: s.region, placed, mat, arms, eyes: placed.parts.eyes || null, state: 'gone', x: s.x, y, z: s.z, yaw: Math.random() * 6.283, fade: 1, frozen: 0, wait: 0, t: Math.random() * 10, wx: s.x, wz: s.z, reach: 0, height: model.size[1] || 2.2 });
    }
  }

  reset() {
    for (const s of this.list) {
      s.state = 'gone';
      s.fade = 1;
      s.frozen = 0;
      s.wait = 0;
      s.x = s.spot.x;
      s.z = s.spot.z;
      s.placed.hidden = true;
      s.placed.object.visible = false;
    }
    this.closeness = 0;
  }

  /** Fire unmakes them. */
  burn(x, y, z, r) {
    for (const s of this.list) {
      if (s.state === 'gone' || s.state === 'dying') continue;
      if (Math.hypot(s.x - x, s.y + 1.1 - y, s.z - z) < r) this.kill(s, RESPAWN);
    }
  }
  /** Cold holds them still. */
  freeze(x, y, z, r, seconds) {
    for (const s of this.list) {
      if (s.state === 'gone' || s.state === 'dying') continue;
      if (Math.hypot(s.x - x, s.y + 1.1 - y, s.z - z) < r) {
        s.frozen = seconds;
        this.game.audio.sfx('ice_form', { pos: [s.x, s.y + 1, s.z], gain: 0.6, pitch: 1.3 });
      }
    }
  }
  kill(s, wait) {
    const g = this.game;
    s.state = 'dying';
    s.wait = wait;
    s.frozen = 0;
    g.audio.sfx('shade_die', { pos: [s.x, s.y + 1.2, s.z] });
    g.particles.wisp(s.x, s.y + 1.2, s.z, [0.5, 0.3, 0.9], 60);
  }
  /** Does a thrown phial's path pass through one of them? */
  hitSegment(x0, y0, z0, x1, y1, z1) {
    for (const s of this.list) {
      if (s.state === 'gone' || s.state === 'dying' || s.fade > 0.5) continue;
      const cx = s.x,
        cy = s.y + 1.25,
        cz = s.z;
      const dx = x1 - x0,
        dy = y1 - y0,
        dz = z1 - z0;
      const l2 = dx * dx + dy * dy + dz * dz || 1e-6;
      const t = clamp(((cx - x0) * dx + (cy - y0) * dy + (cz - z0) * dz) / l2, 0, 1);
      if (Math.hypot(x0 + dx * t - cx, (y0 + dy * t - cy) * 0.7, z0 + dz * t - cz) < 0.8) return s;
    }
    return null;
  }

  /** Height a shade drifts at over a point: the land, or whatever lies on it. */
  _floor(x, z) {
    const h = this.game.world.T.heightAt(x, z);
    let f = Math.max(h, 0);
    if (h < WORLD.lava && Math.hypot(x - SCAR.x, z - SCAR.z) < SCAR.lava + 3.5) f = WORLD.lava;
    return f;
  }

  update(dt) {
    const g = this.game,
      st = g.state,
      pl = g.player.pos;
    const lanterns = g.ents.lanterns;
    const alive = st.player.hp > 0 && st.mode !== 'dead';
    let near = 1e9,
      nearS = null;
    let touching = false;
    for (const s of this.list) {
      const gloom = st.world.gloom[s.region] > 0.5;
      const dxp = pl.x - s.x,
        dzp = pl.z - s.z;
      const dp = Math.hypot(dxp, dzp);
      s.t += dt;

      if (s.state === 'gone') {
        s.wait -= dt;
        if (gloom && s.wait <= 0 && dp < 75 && dp > 16) {
          s.state = 'idle';
          s.x = s.spot.x;
          s.z = s.spot.z;
          s.wx = s.x;
          s.wz = s.z;
          s.fade = 1;
          s.placed.hidden = false;
        }
        continue;
      }
      if (!gloom && s.state !== 'dying') this.kill(s, 1e9);

      if (s.state === 'dying') {
        s.fade = Math.min(1, s.fade + dt / 0.9);
        if (s.fade >= 1) {
          s.state = 'gone';
          s.placed.hidden = true;
          s.placed.object.visible = false;
          continue;
        }
      } else {
        s.fade = Math.max(0, s.fade - dt / 1.6);
        if (dp > 95) {
          // nobody is here to be haunted
          s.state = 'gone';
          s.wait = 0;
          s.placed.hidden = true;
          s.placed.object.visible = false;
          continue;
        }
        if (s.frozen > 0) s.frozen -= dt;
        else {
          let tx = s.wx,
            tz = s.wz,
            sp = 0.7;
          if (s.state === 'idle') {
            if (alive && dp < SEE && Math.abs(pl.y - s.y) < 9) s.state = 'chase';
            else if (Math.hypot(s.wx - s.x, s.wz - s.z) < 0.6 || Math.random() < dt * 0.08) {
              const a = Math.random() * 6.283,
                r = 2 + Math.random() * 7;
              s.wx = s.spot.x + Math.cos(a) * r;
              s.wz = s.spot.z + Math.sin(a) * r;
            }
          }
          if (s.state === 'chase') {
            const home = Math.hypot(s.x - s.spot.x, s.z - s.spot.z);
            if (!alive || dp > LOSE || home > 85) {
              s.state = 'idle';
              s.wx = s.spot.x;
              s.wz = s.spot.z;
            } else {
              tx = pl.x;
              tz = pl.z;
              sp = dp < 1.1 ? 0 : SPEED;
            }
          }
          const dx = tx - s.x,
            dz = tz - s.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.05 && sp > 0) {
            const step = Math.min(d, sp * dt);
            s.x += (dx / d) * step;
            s.z += (dz / d) * step;
            s.yaw += angleDelta(s.yaw, Math.atan2(dx, dz)) * (1 - Math.exp(-5 * dt));
          }
          // a lit lantern is a wall to them
          for (const l of lanterns) {
            if (!l.lit) continue;
            const lx = s.x - l.base.x,
              lz = s.z - l.base.z;
            const ld = Math.hypot(lx, lz);
            if (ld < LANTERN_R && ld > 1e-3) {
              s.x = l.base.x + (lx / ld) * LANTERN_R;
              s.z = l.base.z + (lz / ld) * LANTERN_R;
            }
          }
        }
      }
      const floor = this._floor(s.x, s.z);
      const hover = floor + 0.22 + (s.frozen > 0 ? 0 : Math.sin(s.t * 1.3) * 0.12);
      s.y = s.y < floor - 3 || s.y > floor + 6 ? hover : damp(s.y, hover, 5, dt);

      // touch
      const d3 = Math.hypot(pl.x - s.x, pl.y + 0.9 - (s.y + 1.1), pl.z - s.z);
      if (s.state !== 'dying' && s.fade < 0.4) {
        if (d3 < near) {
          near = d3;
          nearS = s;
        }
        if (s.frozen <= 0 && alive && d3 < TOUCH) {
          touching = true;
          g.hurt(DRAIN * dt, 'shade');
        }
      }
      s.reach = damp(s.reach, s.state === 'chase' && s.frozen <= 0 ? clamp(1.4 - d3 / 9, 0.15, 1) : 0, 3, dt);

      // show
      const o = s.placed.object;
      o.position.set(s.x, s.y, s.z);
      o.rotation.y = s.yaw;
      o.rotation.z = s.frozen > 0 ? 0 : Math.sin(s.t * 0.9) * 0.05;
      s.placed.x = s.x;
      s.placed.y = s.y;
      s.placed.z = s.z;
      const u = s.mat.userData.u;
      u.uFade.value = s.fade;
      u.uFrost.value = damp(u.uFrost.value, s.frozen > 0 ? 1 : 0, 6, dt);
      u.uBase.value.set(s.y, s.height);
      for (let i = 0; i < s.arms.length; i++) {
        const sw = s.frozen > 0 ? 0 : Math.sin(s.t * 1.7 + i * 2.1) * 0.08;
        s.arms[i].rotation.x = -1.35 * s.reach + sw;
        s.arms[i].rotation.z = (i === 0 ? 1 : -1) * 0.12 * s.reach;
      }
      if (s.eyes) s.eyes.visible = s.fade < 0.6;
      if (s.frozen > 0 && Math.random() < dt * 5) g.particles.spawn(0, s.x + (Math.random() - 0.5) * 0.8, s.y + Math.random() * 2, s.z + (Math.random() - 0.5) * 0.8, 0, -0.1, 0, { life: 1.2, size: 0.02, color: [0.7, 0.9, 1], gain: 4 });
    }

    // what the apprentice feels of them
    const c = nearS ? clamp(1 - (near - TOUCH) / 22, 0, 1) : 0;
    this.closeness = damp(this.closeness, c, 3, dt);
    this.touching = touching;
    if (nearS && near < 40) {
      if (!this.loop) this.loop = g.audio.loop('shade', { pos: [nearS.x, nearS.y + 1.2, nearS.z], gain: 0.9 });
      this.loop.set({ pos: [nearS.x, nearS.y + 1.2, nearS.z], param: this.closeness });
    } else if (this.loop) {
      this.loop.stop(1.2);
      this.loop = null;
    }
    this._hitT -= dt;
    if (touching && this._hitT <= 0) {
      this._hitT = 0.85;
      g.audio.sfx('shade_hit', { gain: 0.8 });
    }
  }

  /** Stop the sound when the world is put away. */
  silence() {
    if (this.loop) {
      this.loop.stop(0.3);
      this.loop = null;
    }
  }
}
