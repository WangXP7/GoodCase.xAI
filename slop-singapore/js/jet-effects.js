import * as THREE from 'three/webgpu';
import { vec3, float, attribute, uniform, sin, time, positionLocal, uv, smoothstep } from 'three/tsl';

// js/jet-effects.js
// What the F-15SG leaves in the air: vapour trails off its wingtips when it pulls hard (Singapore's air is humid; above
// about 4 g the low pressure in the tip vortices condenses), and the fireball and smoke when it doesn't pull hard
// enough. Both cheap: two ribbons of 64 points rewritten in place, and two spheres scaled over a few seconds. And the
// vapour cone (ShockCollar) round a jet near and past Mach 1: the shock over its wings condensing the humid air into a
// white collar, densest at its front, frayed at its back. And display smoke (SmokeTrails): the red and white trails a
// flypast leaves, each a ribbon turned to face the camera, puffing out and drifting with the wind as it ages.

const TRAIL = 64; // points per wingtip
const TRAIL_LIFE = 2.2; // s

class WingtipTrails {
  constructor(scene) {
    this.points = [0, 1].map(() => ({ pos: new Float32Array(TRAIL * 3), up: new Float32Array(TRAIL * 3), age: new Float32Array(TRAIL).fill(1e9), strength: new Float32Array(TRAIL), gap: new Uint8Array(TRAIL), head: 0, count: 0, on: false }));
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(2 * TRAIL * 2 * 3), 3);
    this.alpha = new THREE.BufferAttribute(new Float32Array(2 * TRAIL * 2), 1);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('alpha', this.alpha);
    const idx = [];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < TRAIL - 1; i++) {
        const a = (t * TRAIL + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setIndex(idx);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.colorNode = vec3(0.95, 0.96, 0.98);
    m.opacityNode = attribute('alpha', 'float').mul(0.55);
    this.mesh = new THREE.Mesh(this.geometry, m);
    this.mesh.name = 'F15SG_vapour';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._v = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  clear() {
    for (const p of this.points) { p.count = 0; p.age.fill(1e9); }
    this.mesh.visible = false;
  }

  /** `tips`: the two wingtips' world positions; `up`: the jet's up; `strength` 0..1 of the vapour now */
  update(dt, tips, up, strength) {
    let any = false;
    this.points.forEach((p, t) => {
      for (let i = 0; i < TRAIL; i++) p.age[i] += dt;
      // a new point each frame (while there is vapour, or while the old ones fade)
      if (strength > 0.01) {
        p.head = (p.head + 1) % TRAIL;
        const i = p.head;
        p.pos[i * 3] = tips[t].x; p.pos[i * 3 + 1] = tips[t].y; p.pos[i * 3 + 2] = tips[t].z;
        p.up[i * 3] = up.x; p.up[i * 3 + 1] = up.y; p.up[i * 3 + 2] = up.z;
        p.age[i] = 0;
        p.strength[i] = strength;
        p.gap[i] = p.on ? 0 : 1; // the first point after a gap: not joined to the one before it
        p.count = Math.min(TRAIL, p.count + 1);
      }
      p.on = strength > 0.01;
      // write the ribbon newest first: two vertices a point, spread along the jet's up, widening as it ages
      for (let k = 0; k < TRAIL; k++) {
        const i = (p.head - k + TRAIL) % TRAIL;
        const life = k < p.count ? Math.max(0, 1 - p.age[i] / TRAIL_LIFE) : 0;
        // (transparent either side of where the vapour started again: not a ribbon joining unrelated points)
        const newer = (i + 1) % TRAIL;
        const a = p.gap[i] || (k > 0 && p.gap[newer]) ? 0 : life * p.strength[i];
        if (a > 0) any = true;
        const width = 0.12 + (1 - life) * 0.9;
        const v = (t * TRAIL + k) * 2;
        for (const side of [0, 1]) {
          const s = side ? width : -width;
          this.position.array[(v + side) * 3] = p.pos[i * 3] + p.up[i * 3] * s;
          this.position.array[(v + side) * 3 + 1] = p.pos[i * 3 + 1] + p.up[i * 3 + 1] * s;
          this.position.array[(v + side) * 3 + 2] = p.pos[i * 3 + 2] + p.up[i * 3 + 2] * s;
          this.alpha.array[v + side] = k === 0 || k >= p.count - 1 ? 0 : a;
        }
      }
    });
    this.mesh.visible = any;
    if (any) {
      this.position.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }
}

class ShockCollar {
  /** On `root` (the jet's model, its frame: forward +z): an open collar from the canopy back over the wings */
  constructor(root) {
    const g = new THREE.CylinderGeometry(1.4, 5.6, 5, 32, 4, true);
    g.rotateX(Math.PI / 2); // (its top, +y, forward to +z)
    g.translate(0, 0.35, 0.2);
    this.hidden = false; // (not drawn round the jet a camera rides in)
    this.level = uniform(0);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.colorNode = vec3(0.96, 0.97, 0.99);
    const along = uv().y; // 0 at its back, 1 at its front
    const fray = sin(positionLocal.x.mul(3.1).add(positionLocal.y.mul(2.3)).add(time.mul(23))).mul(0.5).add(0.5);
    m.opacityNode = this.level.mul(smoothstep(0.0, 0.75, along)).mul(float(1).sub(smoothstep(0.93, 1.0, along)))
      .mul(fray.mul(0.35).add(0.65));
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'F15SG_vapour_cone';
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    root.add(this.mesh);
  }

  /** Its density at `mach`: from Mach 0.94, thickest at 1, thinning past it */
  set(mach) {
    const o = mach < 0.94 ? 0 : mach < 1 ? (mach - 0.94) / 0.06 : Math.max(0.4, 1 - (mach - 1) / 0.3);
    this.level.value = o * 0.32;
    this.mesh.visible = o > 0.01 && !this.hidden;
  }
}

// Display smoke: one trail per jet, each a ribbon of SMOKE points (one every SMOKE_STEP s, so ~16 s of it) turned to face
// the camera every frame, from 1.2 m across at the jet's tail out to ~22 m as it ages, drifting with the wind and
// sinking a little, its edges soft and its length lumpy (puffs), fading over SMOKE_LIFE. All of a flypast's trails are
// one mesh and one draw.
const SMOKE = 160;
const SMOKE_STEP = 0.1; // s between points
const SMOKE_LIFE = SMOKE * SMOKE_STEP; // s
const SMOKE_COLOURS = { red: [0.86, 0.1, 0.12], white: [0.96, 0.96, 0.95] };
const WIND = [1.6, -0.25, 0.9]; // m/s: a light sea breeze, the smoke settling a little

class SmokeTrails {
  constructor(scene, count) {
    this.trails = Array.from({ length: count }, () => ({
      pos: new Float32Array(SMOKE * 3), age: new Float32Array(SMOKE).fill(1e9), gap: new Uint8Array(SMOKE),
      head: 0, count: 0, on: false, since: 0, colour: SMOKE_COLOURS.white, seed: Math.random() * 100
    }));
    const n = count * SMOKE * 2;
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.colour = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.alpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.uvs = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    for (const a of [this.position, this.colour, this.alpha, this.uvs]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('smokeColour', this.colour);
    this.geometry.setAttribute('alpha', this.alpha);
    this.geometry.setAttribute('uv', this.uvs);
    const idx = [];
    for (let t = 0; t < count; t++) {
      for (let i = 0; i < SMOKE - 1; i++) {
        const a = (t * SMOKE + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setIndex(idx);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const p = uv();
    // soft across (u from -1 to 1), lumpy along (v in metres from the jet)
    const across = smoothstep(1.0, 0.25, p.x.abs());
    const puffs = sin(p.y.mul(0.11)).mul(sin(p.y.mul(0.047).add(1.3))).mul(0.18).add(0.86);
    m.colorNode = attribute('smokeColour', 'vec3').mul(puffs.mul(0.15).add(0.88));
    m.opacityNode = attribute('alpha', 'float').mul(across).mul(puffs).mul(0.82);
    this.mesh = new THREE.Mesh(this.geometry, m);
    this.mesh.name = 'FlypastSmoke';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.clock = 0;
  }

  /** The colour of trail k: 'red' or 'white' */
  setColour(k, name) {
    this.trails[k].colour = SMOKE_COLOURS[name] || SMOKE_COLOURS.white;
  }

  clear() {
    for (const t of this.trails) { t.count = 0; t.age.fill(1e9); t.on = false; }
    this.mesh.visible = false;
  }

  /**
   * `sources[k]`: where trail k's jet's smoke leaves it now ({ x, y, z }), and whether it's on (`smoking[k]`);
   * `eye`: the camera's position, for the ribbons to face it
   */
  update(dt, sources, smoking, eye) {
    if (!(dt > 0)) return;
    this.clock += dt;
    const emit = this.clock >= SMOKE_STEP;
    if (emit) this.clock -= SMOKE_STEP;
    let any = false;
    this.trails.forEach((t, k) => {
      for (let i = 0; i < SMOKE; i++) {
        t.age[i] += dt;
        if (t.age[i] < SMOKE_LIFE) {
          // drifting with the wind, puffing out
          t.pos[i * 3] += WIND[0] * dt;
          t.pos[i * 3 + 1] += WIND[1] * dt;
          t.pos[i * 3 + 2] += WIND[2] * dt;
        }
      }
      const on = !!smoking[k];
      if (on && (emit || !t.on)) {
        t.head = (t.head + 1) % SMOKE;
        const i = t.head, s = sources[k];
        t.pos[i * 3] = s.x; t.pos[i * 3 + 1] = s.y; t.pos[i * 3 + 2] = s.z;
        t.age[i] = 0;
        t.gap[i] = t.on ? 0 : 1;
        t.count = Math.min(SMOKE, t.count + 1);
      }
      t.on = on;
      // the newest point follows the jet between emissions, so the trail leaves its tail
      if (on && t.count) {
        const i = t.head, s = sources[k];
        t.pos[i * 3] = s.x; t.pos[i * 3 + 1] = s.y; t.pos[i * 3 + 2] = s.z;
      }
      // the ribbon, newest first: across = (along x to the eye), widening and fading with age
      let dist = 0;
      for (let n = 0; n < SMOKE; n++) {
        const i = (t.head - n + SMOKE) % SMOKE;
        const live = n < t.count && t.age[i] < SMOKE_LIFE;
        const prev = (i + 1) % SMOKE, next = (i - 1 + SMOKE) % SMOKE;
        const a = n > 0 ? prev : i, b = n < t.count - 1 ? next : i;
        let ax = t.pos[b * 3] - t.pos[a * 3], ay = t.pos[b * 3 + 1] - t.pos[a * 3 + 1], az = t.pos[b * 3 + 2] - t.pos[a * 3 + 2];
        const vx = eye.x - t.pos[i * 3], vy = eye.y - t.pos[i * 3 + 1], vz = eye.z - t.pos[i * 3 + 2];
        let sx = ay * vz - az * vy, sy = az * vx - ax * vz, sz = ax * vy - ay * vx;
        const L = Math.hypot(sx, sy, sz) || 1;
        const life = live ? t.age[i] / SMOKE_LIFE : 1;
        const width = 0.6 + Math.sqrt(life) * 11;
        sx *= width / L; sy *= width / L; sz *= width / L;
        if (n > 0) dist += Math.hypot(ax, ay, az) * 0.5;
        const fade = live ? Math.min(1, n / 2) * (1 - life) ** 1.4 : 0;
        // (transparent across a gap where the smoke was turned off and on again)
        const newer = (i + 1) % SMOKE;
        const alpha = t.gap[i] || (n > 0 && t.gap[newer]) ? 0 : fade;
        if (alpha > 0) any = true;
        const v = (k * SMOKE + n) * 2;
        for (const side of [0, 1]) {
          const sign = side ? 1 : -1;
          const o = (v + side) * 3;
          this.position.array[o] = t.pos[i * 3] + sx * sign;
          this.position.array[o + 1] = t.pos[i * 3 + 1] + sy * sign;
          this.position.array[o + 2] = t.pos[i * 3 + 2] + sz * sign;
          this.colour.array[o] = t.colour[0]; this.colour.array[o + 1] = t.colour[1]; this.colour.array[o + 2] = t.colour[2];
          this.alpha.array[v + side] = alpha;
          this.uvs.array[(v + side) * 2] = sign;
          this.uvs.array[(v + side) * 2 + 1] = dist + t.seed;
        }
      }
    });
    this.mesh.visible = any;
    if (any) for (const a of [this.position, this.colour, this.alpha, this.uvs]) a.needsUpdate = true;
  }
}

class Explosion {
  constructor(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.heat = uniform(0);
    this.smokeOpacity = uniform(0);
    const fire = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // a boiling ball: brighter at its heart, rippling
    const ripple = sin(positionLocal.x.mul(5.0).add(time.mul(9.0))).mul(sin(positionLocal.y.mul(6.0).sub(time.mul(7.0)))).mul(0.25).add(0.85);
    fire.colorNode = vec3(1.0, 0.55, 0.16).mul(this.heat).mul(ripple).mul(2.0);
    this.fireball = new THREE.Mesh(geo, fire);
    const smoke = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    smoke.colorNode = vec3(0.09, 0.085, 0.08);
    smoke.opacityNode = float(this.smokeOpacity);
    this.smoke = new THREE.Mesh(geo, smoke);
    for (const m of [this.fireball, this.smoke]) {
      m.visible = false;
      m.castShadow = m.receiveShadow = false;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.t = Infinity;
  }

  trigger(x, y, z) {
    this.t = 0;
    this.fireball.position.set(x, y, z);
    this.smoke.position.set(x, y + 4, z);
    this.fireball.visible = this.smoke.visible = true;
  }

  update(dt) {
    if (this.t === Infinity) return;
    this.t += dt;
    const t = this.t;
    const grow = 1 - Math.exp(-t * 5);
    this.fireball.scale.setScalar(4 + grow * 30);
    this.heat.value = Math.max(0, 1 - t / 1.4) ** 1.5;
    this.fireball.visible = this.heat.value > 0.01;
    this.smoke.scale.setScalar(6 + t * 9);
    this.smoke.position.y += dt * 6;
    this.smokeOpacity.value = Math.min(1, t * 2) * Math.max(0, 1 - t / 4.5) * 0.75;
    if (t > 4.5) {
      this.t = Infinity;
      this.fireball.visible = this.smoke.visible = false;
    }
  }
}

export { WingtipTrails, ShockCollar, SmokeTrails, Explosion, SMOKE_LIFE };
