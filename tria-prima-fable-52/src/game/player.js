// The apprentice: a kinematic first-person body that walks the height field and the static
// colliders, wades, swims badly, climbs briar and gets thrown by thunder.
import { clamp, damp, lerp } from '../core/math.js';
import { shared } from '../gfx/shared.js';
import { SCAR, WORLD } from '../world/heightmap.js';

const R = 0.34,
  HEIGHT = 1.78,
  EYE = 1.64,
  STEP_UP = 0.42,
  WALK = 4.3,
  RUN = 6.7,
  JUMP = 5.3,
  GRAV = 14,
  WADE = 1.2;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.heading = 0; // radians, clockwise from north (north = -Z)
    this.pitch = 0;
    this.onGround = false;
    this.radius = R;
    this.height = HEIGHT;
    this.eye = EYE;
    this.depth = 0; // water over the ground where the player stands
    this.swimming = false;
    this.inLava = false;
    this.climbing = null;
    this.ladders = [];
    this.cold = 0;
    this.surface = 'grass';
    this.speed = 0;
    this.frozen = false; // cutscenes
    this._bob = 0;
    this._bobAmp = 0;
    this._dip = 0;
    this._step = 0;
    this._coyote = 0;
    this._jumpBuf = 0;
    this._air = 0;
    this._peak = 0;
    this.shake = 0;
    this._kick = { x: 0, y: 0, z: 0 };
    this._n = [0, 1, 0];
    this._fo = { col: null };
    this._po = { nx: 0, nz: 0, col: null };
  }

  teleport(x, y, z, heading = this.heading, pitch = 0) {
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = y != null ? y : this.groundAt(x, z, 1e4);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.heading = heading;
    this.pitch = pitch;
    this.onGround = false;
    this.climbing = null;
    this._air = 0;
    this._peak = this.pos.y;
  }

  /** Water surface over a point, or -Infinity where there is none. */
  waterAt(x, z, h) {
    let lvl = h < 0 ? 0 : -Infinity;
    const T = this.game.world.T;
    if (h > -0.5) {
      const rl = T.riverLevel(x, z);
      if (rl != null && h < rl) lvl = Math.max(lvl, rl);
    }
    return lvl;
  }

  /** What holds the feet up at (x, z) for a body whose feet are at y. */
  groundAt(x, z, y) {
    const w = this.game.world;
    const h = w.T.heightAt(x, z);
    let g = h;
    this.depth = 0;
    this.swimming = false;
    this.inLava = false;
    this._support = null;
    const c = w.collision.floorAt(x, z, R, -1e9, y + STEP_UP, this._fo);
    if (c > g) {
      g = c;
      this._support = this._fo.col;
    }
    const lvl = this.waterAt(x, z, h);
    if (lvl > g) {
      this.depth = lvl - g;
      if (this.depth > WADE) {
        // too deep to stand: float with the eyes just over the surface
        const f = lvl - (EYE - 0.42);
        if (f > g) {
          g = f;
          this.swimming = true;
          this._support = null;
        }
      }
    }
    // lava bears a body, for the moment that the body lasts
    if (h < WORLD.lava && Math.hypot(x - SCAR.x, z - SCAR.z) < SCAR.lava + 3.5) {
      const f = WORLD.lava - 0.28;
      if (f > g) {
        g = f;
        this._support = null;
      }
      if (g < WORLD.lava - 0.05) this.inLava = true;
    }
    return g;
  }

  /** Shove (explosions). */
  kick(vx, vy, vz) {
    this.vel.x += vx;
    this.vel.y = Math.max(this.vel.y, 0) + vy;
    this.vel.z += vz;
    this.onGround = false;
    this.climbing = null;
    this._peak = this.pos.y;
  }

  update(dt, input, opts) {
    const game = this.game,
      w = game.world,
      T = w.T,
      col = w.collision;
    const s = game.settings;
    const pos = this.pos,
      vel = this.vel;
    const levity = game.state.player.levity > 0;
    const can = !this.frozen && opts.control;

    // --- look
    if (can) {
      const k = 0.0021 * s.sensitivity;
      this.heading += input.dx * k;
      this.pitch = clamp(this.pitch - input.dy * k * (s.invertY ? -1 : 1), -1.5, 1.5);
    }
    const sh = Math.sin(this.heading),
      ch = Math.cos(this.heading);
    // forward = (sh, -ch), right = (ch, sh)
    let mf = 0,
      mr = 0;
    if (can) {
      if (input.held('KeyW') || input.held('ArrowUp')) mf += 1;
      if (input.held('KeyS') || input.held('ArrowDown')) mf -= 1;
      if (input.held('KeyD') || input.held('ArrowRight')) mr += 1;
      if (input.held('KeyA') || input.held('ArrowLeft')) mr -= 1;
    }
    const ml = Math.hypot(mf, mr);
    if (ml > 1) {
      mf /= ml;
      mr /= ml;
    }
    const running = can && (input.held('ShiftLeft') || input.held('ShiftRight')) && mf > 0;
    if (can && input.hit('Space')) this._jumpBuf = 0.14;
    this._jumpBuf -= dt;

    // --- climbing the briar
    if (this.climbing) {
      const L = this.climbing;
      vel.x = vel.y = vel.z = 0;
      pos.x = damp(pos.x, L.x + L.nx * 0.5, 10, dt);
      pos.z = damp(pos.z, L.z + L.nz * 0.5, 10, dt);
      pos.y += (mf > 0 ? 2.5 : mf < 0 ? -2.5 : 0) * dt;
      this._step += Math.abs(mf) * 2.5 * dt;
      if (this._step > 0.9) {
        this._step = 0;
        game.audio.footstep('wood', 0.5);
      }
      if (pos.y >= L.y1 - 0.05) {
        pos.x = L.tx;
        pos.z = L.tz;
        pos.y = L.y1;
        this.climbing = null;
        this.onGround = true;
      } else if (pos.y <= L.y0 + 0.02 && mf < 0) {
        this.climbing = null;
        this.onGround = true;
      } else if (this._jumpBuf > 0) {
        this._jumpBuf = 0;
        this.climbing = null;
        vel.x = L.nx * 3;
        vel.z = L.nz * 3;
        vel.y = 2.5;
      }
      this.speed = 0;
      this._peak = pos.y;
      this._finish(dt, 0);
      return;
    }

    // --- how fast, and how readily
    let top = running ? RUN : WALK;
    if (this.depth > 0.15) top *= lerp(1, 0.5, clamp(this.depth / WADE, 0, 1));
    if (this.swimming) top = 2.3;
    if (opts.carrying) top = Math.min(top, 4.6);
    if (opts.slow) top *= opts.slow;
    const wx = (sh * mf + ch * mr) * top,
      wz = (-ch * mf + sh * mr) * top;
    const acc = this.onGround ? (ml > 0 ? 11 : 13) : levity ? 2.4 : 2.8;
    vel.x = damp(vel.x, wx, acc, dt);
    vel.z = damp(vel.z, wz, acc, dt);

    // --- jump
    this._coyote = this.onGround ? 0.11 : this._coyote - dt;
    if (this._jumpBuf > 0 && this._coyote > 0 && !this.inLava) {
      vel.y = (levity ? 8.4 : JUMP) * (this.swimming ? 0.45 : 1);
      this.onGround = false;
      this._coyote = 0;
      this._jumpBuf = 0;
      this._peak = pos.y;
      game.audio.sfx('jump', { gain: 0.5 });
    }

    // --- across
    const dist = Math.hypot(vel.x, vel.z) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.18));
    const stepUp = this.onGround ? STEP_UP : 0.14;
    for (let i = 0; i < n; i++) {
      let mx = (vel.x * dt) / n,
        mz = (vel.z * dt) / n;
      let nx = pos.x + mx,
        nz = pos.z + mz;
      const h1 = T.heightAt(nx, nz);
      if (h1 > pos.y + 0.03) {
        T.normalAt(nx, nz, this._n);
        const steep = this._n[1] < 0.7;
        if (h1 > pos.y + stepUp || (steep && this.onGround)) {
          // a wall or a slope too steep to walk: keep only the part of the move along it
          const gl = Math.hypot(this._n[0], this._n[2]) || 1;
          const ux = -this._n[0] / gl,
            uz = -this._n[2] / gl;
          const d = mx * ux + mz * uz;
          if (d > 0) {
            mx -= ux * d;
            mz -= uz * d;
            nx = pos.x + mx;
            nz = pos.z + mz;
            if (T.heightAt(nx, nz) > pos.y + stepUp) {
              nx = pos.x;
              nz = pos.z;
            }
          }
        }
      }
      pos.x = nx;
      pos.z = nz;
      col.pushOut(pos, pos.y, R, HEIGHT, stepUp, this._po);
    }
    // the edge of the world
    const lim = WORLD.half - 14;
    pos.x = clamp(pos.x, -lim, lim);
    pos.z = clamp(pos.z, -lim, lim);

    // --- up and down
    const ground = this.groundAt(pos.x, pos.z, pos.y);
    let landed = 0;
    if (this.onGround) {
      if (ground < pos.y - 0.5) {
        this.onGround = false;
        this._peak = pos.y;
      } else pos.y = ground;
    }
    if (!this.onGround) {
      this._air += dt;
      vel.y -= (levity ? 4.6 : GRAV) * dt;
      if (levity && vel.y < -3.4) vel.y = -3.4;
      if (vel.y < -45) vel.y = -45;
      pos.y += vel.y * dt;
      if (pos.y > this._peak) this._peak = pos.y;
      if (vel.y > 0) {
        const c = col.ceilingAt(pos.x, pos.z, R * 0.8, pos.y + HEIGHT - 0.5, pos.y + HEIGHT + 0.3);
        if (pos.y + HEIGHT > c) {
          pos.y = c - HEIGHT;
          vel.y = 0;
        }
      }
      const g2 = this.groundAt(pos.x, pos.z, pos.y);
      if (pos.y <= g2 && vel.y <= 0) {
        landed = -vel.y;
        pos.y = g2;
        vel.y = 0;
        this.onGround = true;
        const fell = this._peak - pos.y;
        if (this._air > 0.25) {
          this._dip = Math.min(0.2, landed * 0.014);
          if (this.swimming || this.depth > 0.5) {
            game.audio.sfx('splash', { gain: clamp(landed / 8, 0.3, 1) });
            game.particles.splash(pos.x, pos.y + (this.swimming ? EYE - 0.42 : this.depth), pos.z, clamp(landed / 6, 0.6, 2));
          } else {
            game.audio.sfx('land', { gain: clamp(landed / 10, 0.25, 1) });
            if (fell > 4.6 && !levity) game.hurt((fell - 4.6) * 9, 'fall');
          }
        }
        this._air = 0;
      }
    } else this._air = 0;

    // --- standing on something too steep: slide off it
    if (this.onGround && !this._support && !this.swimming) {
      T.normalAt(pos.x, pos.z, this._n);
      if (this._n[1] < 0.62 && T.heightAt(pos.x, pos.z) >= pos.y - 0.05) {
        vel.x += this._n[0] * 16 * dt;
        vel.z += this._n[2] * 16 * dt;
      }
    }

    // --- grab the briar
    if (can && mf > 0 && !this.climbing)
      for (const L of this.ladders) {
        if (!L.active) continue;
        if (pos.y < L.y0 - 0.3 || pos.y > L.y1 - 0.4) continue;
        if (Math.hypot(pos.x - L.x, pos.z - L.z) < L.r) {
          this.climbing = L;
          this.onGround = false;
          break;
        }
      }

    // --- the cold and the fire
    if (this.swimming) {
      this.cold += dt;
      if (this.cold > 1.6) game.hurt(7 * dt, 'cold');
    } else this.cold = Math.max(0, this.cold - dt * 0.5);
    if (this.inLava && pos.y < WORLD.lava + 0.05) {
      game.hurt(75 * dt, 'lava');
      if (Math.random() < dt * 14) game.particles.spawn(1, pos.x + (Math.random() - 0.5) * 0.5, WORLD.lava + 0.1, pos.z + (Math.random() - 0.5) * 0.5, 0, 1.6, 0, { life: 0.6, size: 0.35, size1: 0.1, color: [1, 0.45, 0.1], gain: 4 });
    }

    this.speed = Math.hypot(vel.x, vel.z);
    this._finish(dt, landed);
  }

  _finish(dt, landed) {
    const game = this.game,
      pos = this.pos;
    // footfalls
    const T = game.world.T;
    if (this.onGround && this.speed > 0.6 && !this.climbing) {
      this._step += this.speed * dt;
      const stride = this.speed > 5.5 ? 2.5 : 2.0;
      if (this._step > stride) {
        this._step = 0;
        let surf = this._support ? (this._support.tag === 'dock' || (this._support.owner && this._support.tag === 'prop') ? 'wood' : 'stone') : T.surfaceAt(pos.x, pos.z);
        if (this.depth > 0.12 || this.swimming) surf = 'water';
        this.surface = surf;
        game.audio.footstep(surf, clamp(this.speed / RUN, 0.2, 1));
        if (surf === 'water') game.particles.splash(pos.x, pos.y + Math.min(this.depth, EYE - 0.42), pos.z, 0.5);
        else if (surf === 'ash' || surf === 'sand' || surf === 'dirt') game.particles.dust(pos.x, pos.y, pos.z, 0.3, surf === 'ash' ? [0.25, 0.24, 0.24] : [0.4, 0.36, 0.3], 2);
      }
    }
    // the view
    const moving = this.onGround && !this.swimming ? clamp(this.speed / RUN, 0, 1) : 0;
    this._bobAmp = damp(this._bobAmp, moving, 8, dt);
    this._bob += dt * (6.5 + this.speed * 1.25);
    this._dip = damp(this._dip, 0, 9, dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const cam = game.engine.camera;
    const bob = Math.sin(this._bob) * 0.028 * this._bobAmp + (this.swimming ? Math.sin(game.engine.time * 1.7) * 0.05 : 0);
    const sway = Math.cos(this._bob * 0.5) * 0.018 * this._bobAmp;
    let jx = 0,
      jy = 0,
      jr = 0;
    if (this.shake > 0 && game.settings.shake) {
      const a = this.shake * this.shake;
      const t = game.engine.time * 37;
      jx = Math.sin(t * 1.3) * 0.05 * a;
      jy = Math.sin(t * 1.7 + 1) * 0.05 * a;
      jr = Math.sin(t * 2.1 + 2) * 0.018 * a;
    }
    const ch = Math.cos(this.heading),
      sh = Math.sin(this.heading);
    cam.position.set(pos.x + ch * (sway + jx), pos.y + EYE + bob - this._dip + jy, pos.z + sh * (sway + jx));
    cam.rotation.set(this.pitch, -this.heading, jr + sway * 0.25, 'YXZ');
    shared.uPlayer.value.set(pos.x, pos.y, pos.z, 0.95);
  }

  /** Unit view direction into out [x, y, z]. */
  aim(out) {
    const cp = Math.cos(this.pitch);
    out[0] = Math.sin(this.heading) * cp;
    out[1] = Math.sin(this.pitch);
    out[2] = -Math.cos(this.heading) * cp;
    return out;
  }
}
