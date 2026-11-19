/* ============================================================
   CAMERA RIG — chase / orbit / mast / photo
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, sstep } from '../core/rng.js';
import { DRIVE } from './rover.js';

export const CAM = { CHASE: 0, ORBIT: 1, MAST: 2, PHOTO: 3 };
const NAMES = ['CHASE', 'ORBIT', 'MAST CAM', 'PHOTO'];

export class CameraRig {
  constructor(camera, terrain) {
    this.cam = camera;
    this.terrain = terrain;
    this.mode = CAM.CHASE;
    this.yaw = 0; this.pitch = 0.22;
    this.dist = 8.2;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.shake = 0;
    this.fov = 58; this.fovTarget = 58; this.fovScale = 1;
    this.invertY = false;
    this.sens = 1.0;
    this.first = true;
    this.photoPos = new THREE.Vector3();
    this.photoYaw = 0; this.photoPitch = 0;
    this.autoCentre = 1;      // 0 off, 1 slow, 2 fast
    this.lookIdle = 99;       // seconds since the operator last moved the view
  }

  get modeName() { return NAMES[this.mode]; }

  cycle(rover) { this.setMode((this.mode + 1) % 4, rover); }
  setMode(m, rover) {
    // Chase parks the orbit angle BEHIND the rover; carrying that into the mast
    // view would start the head looking backwards. Re-datum on entry.
    if (m === CAM.MAST && rover) {
      this.yaw = Math.atan2(rover.forward.x, rover.forward.z);
      this.pitch = 0;
    }
    this.mode = m; this.first = true;
  }

  addShake(v) { this.shake = Math.min(1.6, this.shake + v); }

  update(dt, rover, input, ctl) {
    const inv = this.invertY ? -1 : 1;
    const s = 0.0022 * this.sens;
    this.yaw -= input.lookX * s;
    this.pitch = clamp(this.pitch + input.lookY * s * inv, -1.15, 1.25);
    if (input.zoom) this.dist = clamp(this.dist + input.zoom * 0.9, 2.6, 26);
    // Any real look input resets the idle clock that gates auto-centring.
    // Driven by an explicit flag from the input layer rather than a magnitude
    // threshold: lookX/lookY are in mouse pixels, and a thumbstick at a third
    // of its travel never cleared the old 0.6 bar, so auto-centre fought the
    // stick instead of standing down.
    this.lookIdle = input.looking ? 0 : this.lookIdle + dt;

    const rp = rover.pos;
    const speed = rover.vel.length();

    if (this.mode === CAM.CHASE) {
      /* The rig trails the heading, but the operator owns the view. Auto-centre
         only starts after a real pause — the old version resumed the instant
         the mouse stopped for a single frame, so any attempt to look around got
         dragged back before you could see anything. */
      const heading = Math.atan2(rover.forward.x, rover.forward.z);
      const target = heading + Math.PI;
      let d = ((target - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (this.autoCentre > 0) {
        const delay = this.autoCentre === 1 ? 3.2 : 1.1;
        const ramp = clamp((this.lookIdle - delay) / 1.6, 0, 1);
        // Fractions of the drive envelope, not absolute m/s: at the LRV's
        // 3.6 m/s top speed a literal 3.5 m/s bar meant auto-centre only
        // reached full rate at 97 % of flat out, i.e. never.
        const rate = (this.autoCentre === 1 ? 0.6 : 1.7) * ramp *
          sstep(DRIVE.maxSpeed * 0.06, DRIVE.maxSpeed * 0.42, speed);
        if (rate > 0) {
          this.yaw += d * Math.min(1, dt * rate);
          this.pitch += (0.24 - this.pitch) * Math.min(1, dt * rate * 0.7);
        }
      }

      const dist = this.dist * (1 + sstep(DRIVE.maxSpeed * 0.24, DRIVE.maxSpeed, speed) * 0.18);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      _o.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(dist);
      this.pos.copy(rp).add(_o); this.pos.y += 1.5;
      this.look.copy(rp).addScaledVector(rover.forward, 2.6 + speed * 0.30);
      this.look.y += 1.0;
      this.fovTarget = 58 + sstep(DRIVE.maxSpeed * 0.36, DRIVE.maxSpeed, speed) * 9;
    }
    else if (this.mode === CAM.ORBIT) {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      _o.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
      this.pos.copy(rp).add(_o); this.pos.y += 1.0;
      this.look.copy(rp); this.look.y += 0.9;
      this.fovTarget = 52;
    }
    else if (this.mode === CAM.MAST) {
      // The mast head IS the camera, so the head's own lens barrels sit right
      // on the near plane and blank half the frame — the eye has to be pushed
      // out past the front of the housing.
      // Neither angle is negated: yawRel already decreases when the mouse goes
      // right, and rotation.x is positive-down, so both track the input.
      rover.mastYaw = clamp(this.yawRel(rover), -2.3, 2.3);
      rover.mastPitch = clamp(this.pitch * 0.85, -0.55, 0.75);
      rover.head.updateWorldMatrix(true, false);
      rover.head.getWorldPosition(this.pos);
      const hq = rover.head.getWorldQuaternion(_q);
      const fw = _f.set(0, 0, 1).applyQuaternion(hq);
      this.pos.addScaledVector(fw, 0.30).addScaledVector(rover.up, 0.05);
      this.look.copy(this.pos).addScaledVector(fw, 30);
      this.fovTarget = 52;
    }
    else {
      // photo mode: free fly, WASD relative to the view
      this.photoYaw = this.yaw; this.photoPitch = this.pitch;
      const cp = Math.cos(this.photoPitch), sp = Math.sin(this.photoPitch);
      _f.set(-Math.sin(this.photoYaw) * cp, -sp, -Math.cos(this.photoYaw) * cp).normalize();
      _r.crossVectors(_f, _up).normalize();
      const sp2 = (input.boost ? 26 : 8) * dt;
      this.photoPos.addScaledVector(_f, (ctl.throttle || 0) * sp2);
      this.photoPos.addScaledVector(_r, (ctl.steer || 0) * sp2);
      if (input.up) this.photoPos.y += sp2; if (input.down) this.photoPos.y -= sp2;
      this.pos.copy(this.photoPos);
      this.look.copy(this.pos).add(_f);
      this.fovTarget = 40;
    }

    /* ---- don't let the rig sink into the regolith ---- */
    if (this.mode !== CAM.MAST) {
      const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y < gh + 0.7) this.pos.y = gh + 0.7;
    }

    /* ---- critically-damped follow ---- */
    if (this.first) { this.smoothPos.copy(this.pos); this.smoothLook.copy(this.look); this.first = false; }
    const kp = this.mode === CAM.MAST ? 1 : 1 - Math.exp(-dt * (this.mode === CAM.PHOTO ? 22 : 9.5));
    const kl = this.mode === CAM.MAST ? 1 : 1 - Math.exp(-dt * 12);
    this.smoothPos.lerp(this.pos, kp);
    this.smoothLook.lerp(this.look, kl);

    /* ---- shake: suspension shock through the mast, not a movie earthquake ---- */
    this.shake = Math.max(0, this.shake - dt * 2.6);
    let sx = 0, sy = 0;
    if (this.shake > 0.001) {
      const t = performance.now() * 0.001;
      const a = this.shake * this.shake * 0.10;
      sx = Math.sin(t * 47.3) * a; sy = Math.cos(t * 39.1) * a;
    }

    this.cam.position.copy(this.smoothPos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.smoothLook);
    if (sx || sy) { this.cam.rotateX(sy); this.cam.rotateY(sx); }

    this.fov += (this.fovTarget - this.fov) * Math.min(1, dt * 4);
    const want = this.fov * this.fovScale;
    if (Math.abs(this.cam.fov - want) > 0.01) { this.cam.fov = want; this.cam.updateProjectionMatrix(); }
    void lerp;
  }

  yawRel(rover) {
    const heading = Math.atan2(rover.forward.x, rover.forward.z);
    return ((this.yaw - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  }

  enterPhoto(rover) {
    this.photoPos.copy(this.cam.position);
    this.photoYaw = this.yaw; this.photoPitch = this.pitch;
    void rover;
  }
}

const _o = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
