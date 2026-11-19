// Rigid bodies (cannon-es): crates, barrels, skulls, rubble, the shrine lid. The land is a height
// field; the static world is fed in lazily from the collision world, only round bodies that are
// awake. Every body mirrors itself back into the collision world as a simple box so the player can
// stand on it and bump into it.
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { WORLD } from '../world/heightmap.js';

const STEP = 1 / 60;
const _v = new CANNON.Vec3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Physics {
  constructor(T, collision) {
    this.T = T;
    this.collision = collision;
    const w = (this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -14, 0) }));
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 8;
    w.defaultContactMaterial.friction = 0.55;
    w.defaultContactMaterial.restitution = 0.12;
    w.defaultContactMaterial.contactEquationStiffness = 1e7;
    w.defaultContactMaterial.contactEquationRelaxation = 4;

    // the land
    const n = T.n;
    const data = [];
    for (let i = 0; i < n; i++) {
      const col = new Array(n);
      for (let yi = 0; yi < n; yi++) col[yi] = T.h[(n - 1 - yi) * n + i];
      data.push(col);
    }
    const hf = new CANNON.Heightfield(data, { elementSize: T.cell });
    const ground = new CANNON.Body({ mass: 0, shape: hf });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.set(-WORLD.half, 0, WORLD.half);
    w.addBody(ground);
    this.ground = ground;

    this.props = []; // dynamic bodies with their view objects
    this.statics = new Map(); // collider id -> body
    this._acc = 0;
    this._near = [];
    this.onImpact = null; // (prop, speed) => void
  }

  /**
   * A dynamic body. spec: { shape:'box'|'cyl'|'sphere', h:[hx,hy,hz] | r,h | r, mass, x,y,z, ry, object (THREE.Object3D to drive),
   * offset:[x,y,z] (shape centre in the object's frame), friction, tag, data }
   */
  addProp(spec) {
    let shape;
    if (spec.shape === 'box') shape = new CANNON.Box(new CANNON.Vec3(spec.h[0], spec.h[1], spec.h[2]));
    else if (spec.shape === 'cyl') shape = new CANNON.Cylinder(spec.r, spec.r, spec.h, 10);
    else shape = new CANNON.Sphere(spec.r);
    const body = new CANNON.Body({ mass: spec.mass || 10, shape, linearDamping: 0.08, angularDamping: 0.25 });
    const off = spec.offset || [0, 0, 0];
    body.position.set(spec.x + off[0], spec.y + off[1], spec.z + off[2]);
    body.quaternion.setFromEuler(0, spec.ry || 0, 0);
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.7;
    body.allowSleep = true;
    this.world.addBody(body);
    const prop = { body, object: spec.object || null, offset: off, spec, tag: spec.tag || null, data: spec.data || null, colId: 0, lift: 0, held: false, half: null };
    // half extents of the box that stands in for it in the collision world
    prop.half = spec.shape === 'box' ? spec.h.slice() : spec.shape === 'cyl' ? [spec.r, spec.h / 2, spec.r] : [spec.r, spec.r, spec.r];
    body.addEventListener('collide', (ev) => {
      const sp = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (sp > 1.4 && this.onImpact) this.onImpact(prop, sp);
    });
    this.props.push(prop);
    this._mirror(prop);
    this._sync(prop);
    return prop;
  }

  removeProp(prop) {
    const i = this.props.indexOf(prop);
    if (i < 0) return;
    this.props.splice(i, 1);
    this.world.removeBody(prop.body);
    if (prop.colId) this.collision.remove(prop.colId);
    prop.colId = 0;
  }

  /** Keep a static cannon body for every collider near a point (bodies are cached by collider id). */
  _ensureStatics(x, z, r) {
    const hits = this.collision.query(x - r, x + r, z - r, z + r, this._near);
    for (const c of hits) {
      if (c.dyn || c.ghost || this.statics.has(c.id)) continue;
      let shape;
      const body = new CANNON.Body({ mass: 0 });
      if (c.type === 'box') {
        shape = new CANNON.Box(new CANNON.Vec3(c.h[0], c.h[1], c.h[2]));
        body.quaternion.setFromEuler(0, c.ry || 0, 0);
      } else if (c.type === 'cyl') shape = new CANNON.Cylinder(c.r, c.r, c.h, 10);
      else shape = new CANNON.Sphere(c.r);
      body.addShape(shape);
      body.position.set(c.c[0], c.c[1], c.c[2]);
      this.world.addBody(body);
      this.statics.set(c.id, body);
    }
  }
  /** Call when a collider leaves the collision world (a burnt gate, a melted floe). */
  forget(colliderId) {
    const b = this.statics.get(colliderId);
    if (!b) return;
    this.world.removeBody(b);
    this.statics.delete(colliderId);
    // whatever was resting on it must notice
    for (const p of this.props) p.body.wakeUp();
  }

  /** Stand-in box in the collision world, so the player meets the prop. */
  _mirror(prop) {
    if (prop.colId) this.collision.remove(prop.colId);
    prop.colId = 0;
    if (prop.held || prop.noMirror) return;
    const b = prop.body;
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _e.setFromQuaternion(_q, 'YXZ');
    const tilt = Math.max(Math.abs(_e.x), Math.abs(_e.z));
    const h = prop.half;
    // lying on its side: swap to a rough box that covers it
    const hh = tilt > 0.6 ? [Math.max(h[0], h[1]), Math.min(h[0], h[1], h[2]) + 0.02, Math.max(h[2], h[1])] : h;
    prop.colId = this.collision.add({ type: 'box', c: [b.position.x, b.position.y, b.position.z], h: hh, ry: _e.y, dyn: true, tag: 'prop', owner: prop });
  }

  _sync(prop) {
    const o = prop.object;
    if (!o) return;
    const b = prop.body;
    o.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const off = prop.offset;
    if (off[0] || off[1] || off[2]) {
      _v.set(-off[0], -off[1], -off[2]);
      b.quaternion.vmult(_v, _v);
      o.position.set(b.position.x + _v.x, b.position.y + _v.y, b.position.z + _v.z);
    } else o.position.set(b.position.x, b.position.y, b.position.z);
  }

  /** Throw everything near a point outward. */
  explode(x, y, z, radius, force) {
    for (const p of this.props) {
      const b = p.body;
      const dx = b.position.x - x,
        dy = b.position.y - y + 0.6,
        dz = b.position.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const k = (force * (1 - d / radius)) / Math.max(d, 0.4);
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(dx * k * Math.sqrt(b.mass), dy * k * Math.sqrt(b.mass) + force * 0.25 * Math.sqrt(b.mass), dz * k * Math.sqrt(b.mass)));
      b.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
  }
  /** Unburden everything near a point for a while. Returns the props it touched. */
  levitate(x, y, z, radius, seconds) {
    const out = [];
    for (const p of this.props) {
      const b = p.body;
      if (Math.hypot(b.position.x - x, b.position.y - y, b.position.z - z) > radius) continue;
      p.lift = seconds;
      b.wakeUp();
      b.velocity.y += 0.6;
      out.push(p);
    }
    return out;
  }

  step(dt) {
    this._acc += Math.min(dt, 0.1);
    let moved = false;
    while (this._acc >= STEP) {
      this._acc -= STEP;
      let awake = 0;
      for (const p of this.props) {
        const b = p.body;
        if (p.lift > 0) {
          p.lift -= STEP;
          b.wakeUp();
          // gravity undone and a little more; thick air so it drifts instead of launching
          b.force.y += b.mass * (14 + 1.4);
          b.velocity.scale(0.985, b.velocity);
          b.angularVelocity.scale(0.99, b.angularVelocity);
          if (b.velocity.y > 1.3) b.velocity.y = 1.3;
        }
        if (b.sleepState !== CANNON.Body.SLEEPING && !p.held) {
          awake++;
          this._ensureStatics(b.position.x, b.position.z, 3.5);
        }
      }
      if (awake === 0) {
        this._acc = 0;
        break;
      }
      this.world.step(STEP);
      moved = true;
    }
    if (!moved) return;
    for (const p of this.props) {
      const b = p.body;
      if (p.held) continue;
      const asleep = b.sleepState === CANNON.Body.SLEEPING;
      if (asleep && p._wasAsleep) continue;
      this._sync(p);
      this._mirror(p);
      p._wasAsleep = asleep;
      // fell out of the world or into the sea: let it rest on the bed
      if (b.position.y < -40) {
        b.position.y = this.T.heightAt(b.position.x, b.position.z) + 1;
        b.velocity.set(0, 0, 0);
      }
    }
  }
}
