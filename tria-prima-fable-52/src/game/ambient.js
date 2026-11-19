// The small life of the air: flakes of salt in the dead wood, ash and sparks over the Scar, motes
// where the Gloom lies, mist on the Mere. And the crows, which leave when the living come near.
import * as THREE from 'three';
import { P } from '../gfx/particles.js';
import { shared } from '../gfx/shared.js';
import { hasModel } from '../models/index.js';
import { LAYER_MAIN_ONLY } from '../gfx/engine.js';
import { clamp, damp } from '../core/math.js';
import { WORLD } from '../world/heightmap.js';

const rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();

export class Ambient {
  constructor(game) {
    this.game = game;
    this.crows = [];
    this.w = { saltwood: 0, scar: 0, mere: 0, gloom: 0 };
    this.acc = { salt: 0, ember: 0, ash: 0, gloom: 0, mist: 0, levity: 0 };
  }

  build() {
    const g = this.game,
      w = g.world;
    if (!hasModel('crow')) return;
    for (const c of w.spots.crows || []) {
      // perch on whatever stands under the spot, or on the ground
      const ground = w.T.heightAt(c[0], c[2]);
      const top = w.collision.floorAt(c[0], c[2], 0.1, -1e9, c[1] + 2.5, null);
      const y = top > ground && top > c[1] - 4 ? top : ground;
      const ry = rnd() * 6.283;
      const p = w.place('crow', c[0], y, c[2], ry, { collide: false, far: 130, seed: 1 + ((rnd() * 9) | 0) });
      if (!p) continue;
      const wings = [];
      p.object.traverse((o) => {
        if (o.isMesh) o.layers.set(LAYER_MAIN_ONLY);
      });
      for (const side of ['L', 'R']) {
        const mesh = p.parts['wing' + side];
        const a = p.model.anchors['wing' + side];
        if (!mesh) continue;
        const pivot = new THREE.Group();
        pivot.rotation.order = 'YZX';
        if (a) {
          pivot.position.set(a[0], a[1], a[2]);
          mesh.position.set(-a[0], -a[1], -a[2]);
        }
        p.object.add(pivot);
        pivot.add(mesh);
        wings.push({ pivot, sign: side === 'L' ? 1 : -1 });
      }
      this.crows.push({ placed: p, wings, home: { x: c[0], y, z: c[2], ry }, state: 'perch', t: rnd() * 10, x: c[0], y, z: c[2], vx: 0, vy: 0, vz: 0, wait: 0 });
    }
    this._poseAll();
  }
  _fold(c, k) {
    // wings folded down along the body (k = 1) or spread (k = 0)
    // (swept back, rolled onto the flank and drawn in: a rigid wing merely dropped hangs like a cloak)
    for (const w of c.wings) {
      w.pivot.rotation.set(0.45 * k, -w.sign * 1.62 * k, w.sign * 0.33 * k);
      w.pivot.scale.set(1 - 0.32 * k, 1, 1 - 0.5 * k);
    }
  }
  _poseAll() {
    for (const c of this.crows) this._fold(c, 1);
  }

  _crows(dt) {
    const g = this.game,
      pl = g.player.pos,
      mode = g.state.mode;
    for (const c of this.crows) {
      c.t += dt;
      const o = c.placed.object;
      if (c.state === 'perch') {
        // a look round now and then
        o.rotation.y = c.home.ry + Math.sin(c.t * 0.7) * 0.25 + (Math.sin(c.t * 0.23) > 0.9 ? 0.6 : 0);
        o.rotation.x = Math.max(0, Math.sin(c.t * 1.9 + c.home.ry)) * 0.18;
        const d = Math.hypot(pl.x - c.x, pl.y + 1 - c.y, pl.z - c.z);
        if (mode === 'play' && d < 10.5) {
          c.state = 'fly';
          c.t = 0;
          const ax = c.x - pl.x,
            az = c.z - pl.z,
            l = Math.hypot(ax, az) || 1;
          const turn = rr(-0.7, 0.7);
          const dx = (ax / l) * Math.cos(turn) - (az / l) * Math.sin(turn),
            dz = (ax / l) * Math.sin(turn) + (az / l) * Math.cos(turn);
          c.vx = dx * rr(6.5, 8.5);
          c.vz = dz * rr(6.5, 8.5);
          c.vy = rr(3.2, 4.4);
          g.audio.sfx('crow', { pos: [c.x, c.y, c.z], pitch: rr(0.92, 1.1) });
          g.particles.spawn(P.SHARD, c.x, c.y + 0.1, c.z, rr(-0.4, 0.4), 0.4, rr(-0.4, 0.4), { life: 2.6, size: 0.035, color: [0.03, 0.03, 0.035], grav: 0.25, drag: 1.2, vrot: 5 });
        }
      } else if (c.state === 'fly') {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.vy = damp(c.vy, 1.4, 0.6, dt);
        const flap = Math.sin(c.t * 17);
        for (const w of c.wings) {
          w.pivot.rotation.set(0, 0, w.sign * (0.1 - flap * 0.75));
          w.pivot.scale.set(1, 1, 1);
        }
        o.position.set(c.x, c.y + flap * 0.03, c.z);
        o.rotation.y = Math.atan2(c.vx, c.vz);
        o.rotation.x = -0.25;
        c.placed.x = c.x;
        c.placed.y = c.y;
        c.placed.z = c.z;
        if (c.t > 9) {
          c.state = 'gone';
          c.wait = rr(70, 130);
          c.placed.hidden = true;
          o.visible = false;
        }
      } else {
        c.wait -= dt;
        if (c.wait <= 0 && Math.hypot(pl.x - c.home.x, pl.z - c.home.z) > 70) {
          c.state = 'perch';
          c.x = c.home.x;
          c.y = c.home.y;
          c.z = c.home.z;
          c.placed.x = c.x;
          c.placed.y = c.y;
          c.placed.z = c.z;
          c.placed.hidden = false;
          o.position.set(c.x, c.y, c.z);
          this._fold(c, 1);
        }
      }
    }
  }

  update(dt) {
    const g = this.game,
      st = g.state,
      Pt = g.particles,
      T = g.world.T,
      cam = g.engine.camera.position;
    this._crows(dt);
    if (st.mode === 'title') return;
    const r = g.region;
    const w = this.w;
    w.saltwood = damp(w.saltwood, r === 'saltwood' ? 1 : 0, 0.8, dt);
    w.scar = damp(w.scar, r === 'scar' ? 1 : 0, 0.8, dt);
    w.mere = damp(w.mere, r === 'mere' ? 1 : 0, 0.8, dt);
    w.gloom = damp(w.gloom, r && st.world.gloom[r] > 0 ? st.world.gloom[r] : 0, 0.8, dt);
    const wind = shared.uWind.value;
    const wx = wind.x * wind.z * 1.6,
      wz = wind.y * wind.z * 1.6;
    const a = this.acc;

    // salt, falling where nothing rots
    if (w.saltwood > 0.05) {
      a.salt += dt * 16 * w.saltwood;
      while (a.salt > 1) {
        a.salt -= 1;
        Pt.spawn(P.SHARD, cam.x + rr(-15, 15), cam.y + rr(-1.5, 8), cam.z + rr(-15, 15), wx + rr(-0.2, 0.2), rr(-0.5, -0.2), wz + rr(-0.2, 0.2), { life: rr(5, 8), size: rr(0.008, 0.018), color: [0.85, 0.86, 0.9], alpha: 0.75, drag: 0.1, vrot: rr(-3, 3), fade: 0.2 });
      }
    }
    // the Scar: sparks going up, ash coming down
    if (w.scar > 0.05) {
      a.ember += dt * 12 * w.scar;
      while (a.ember > 1) {
        a.ember -= 1;
        const x = cam.x + rr(-16, 16),
          z = cam.z + rr(-16, 16);
        const y = Math.max(T.heightAt(x, z), WORLD.lava - 1) + rr(0, 2.5);
        Pt.spawn(P.GLOW, x, y, z, wx * 0.5 + rr(-0.3, 0.3), rr(0.5, 1.7), wz * 0.5 + rr(-0.3, 0.3), { life: rr(2.5, 5), size: rr(0.012, 0.028), color: [1, 0.42, 0.1], gain: rr(3, 7), drag: 0.15, fade: 0.25 });
      }
      a.ash += dt * 10 * w.scar;
      while (a.ash > 1) {
        a.ash -= 1;
        Pt.spawn(P.SHARD, cam.x + rr(-14, 14), cam.y + rr(-1, 8), cam.z + rr(-14, 14), wx + rr(-0.3, 0.3), rr(-0.7, -0.3), wz + rr(-0.3, 0.3), { life: rr(5, 8), size: rr(0.01, 0.022), color: [0.1, 0.095, 0.09], alpha: 0.8, drag: 0.1, vrot: rr(-2, 2), fade: 0.2 });
      }
    }
    // where the Gloom lies the air itself is unwell
    if (w.gloom > 0.08) {
      a.gloom += dt * 9 * w.gloom;
      while (a.gloom > 1) {
        a.gloom -= 1;
        const x = cam.x + rr(-13, 13),
          z = cam.z + rr(-13, 13);
        const y = Math.max(T.heightAt(x, z), 0) + rr(0.2, 3.2);
        Pt.spawn(P.GLOW, x, y, z, rr(-0.15, 0.15), rr(0.02, 0.2), rr(-0.15, 0.15), { life: rr(4, 7), size: rr(0.02, 0.05), color: [0.42, 0.26, 0.75], gain: rr(0.7, 1.6), fade: 0.35 });
      }
    }
    // breath of the Mere
    if (w.mere > 0.05) {
      a.mist += dt * 1.1 * w.mere * (0.5 + 0.5 * w.gloom + 0.5 * (g.engine.sky.night || 0));
      while (a.mist > 1) {
        a.mist -= 1;
        const x = cam.x + rr(-34, 34),
          z = cam.z + rr(-34, 34);
        if (T.heightAt(x, z) > 0.4) continue;
        Pt.spawn(P.SMOKE, x, rr(0.3, 1.1), z, wx * 0.3 + rr(-0.1, 0.1), 0.02, wz * 0.3 + rr(-0.1, 0.1), { life: rr(9, 14), size: rr(3, 5), size1: rr(6, 9), color: [0.75, 0.8, 0.85], alpha: 0.07, fade: 0.4, vrot: rr(-0.05, 0.05) });
      }
    }
    // the lightness of Levity, shown at the feet
    if (st.player.levity > 0 && st.mode === 'play') {
      a.levity += dt * 14;
      const p = g.player.pos;
      while (a.levity > 1) {
        a.levity -= 1;
        const an = rnd() * 6.283,
          rad = rr(0.2, 0.6);
        Pt.spawn(P.GLOW, p.x + Math.cos(an) * rad, p.y + rr(0, 0.4), p.z + Math.sin(an) * rad, 0, rr(0.5, 1.1), 0, { life: rr(0.8, 1.4), size: rr(0.012, 0.025), color: [0.75, 0.6, 1.0], gain: 3, fade: 0.3 });
      }
    }
  }
}

export { clamp };
