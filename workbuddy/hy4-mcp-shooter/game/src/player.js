/**
 * player.js — 第一人称控制器
 *
 * 负责：指针锁定视角、WASD 位移、跳跃/冲刺、AABB 碰撞与地面检测、开火与换弹。
 * 所有数值都从 Scene Manifest 的 gameplay.player 读取 —— Agent 改数值即刻生效。
 */
import * as THREE from 'three';

const _box = new THREE.Box3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
const PLAYER_RADIUS = 0.42;
const PLAYER_HEIGHT = 1.75;
const EYE_OFFSET = 1.62;

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 1.7, 30);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.onGround = true;

    this.keys = new Set();
    this.locked = false;
    this.sensitivity = 0.0022;

    // 自由视角 / 观景模式：跳过重力与碰撞，相机纯跟随给定机位。
    // Agent 用它来「取景审美术」—— 对应 UE5 MCP 里的 viewport camera 控制。
    this.spectate = false;

    // 战斗状态
    this.health = 100;
    this.ammo = 30;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.alive = true;

    // 统计（供 playtest 上报）
    this.stats = { shotsFired: 0, shotsHit: 0, headshots: 0, kills: 0, damageTaken: 0, damageDealt: 0 };

    this._bindInput();
  }

  _bindInput() {
    const dom = this.dom;
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    if (!this.locked) this.dom.requestPointerLock?.();
  }

  /** 应用清单里的玩法数值 */
  applyGameplay(gp) {
    const p = gp.player;
    this.gp = p;
    this.maxHealth = p.maxHealth;
    if (this.health > this.maxHealth) this.health = this.maxHealth;
    this.magazine = p.magazine;
    if (this.ammo > this.magazine) this.ammo = this.magazine;
    if (this.ammo === 0 && !this.reloading) this.startReload();
  }

  respawn(pos, yaw) {
    this.position.set(pos[0], pos[1], pos[2]);
    this.velocity.set(0, 0, 0);
    if (typeof yaw === 'number') {
      this.yaw = yaw;
      this.pitch = 0;
    }
    this.spectate = false;
    this.health = this.gp ? this.gp.maxHealth : 100;
    this.ammo = this.gp ? this.gp.magazine : 30;
    this.reloading = false;
    this.alive = true;
    this.stats = { shotsFired: 0, shotsHit: 0, headshots: 0, kills: 0, damageTaken: 0, damageDealt: 0 };
  }

  startReload() {
    if (this.reloading || this.ammo >= (this.magazine ?? 30)) return;
    this.reloading = true;
    this.reloadTimer = this.gp ? this.gp.reloadTime : 1.5;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.stats.damageTaken += amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    if (this.onDamaged) this.onDamaged(amount);
  }

  /** AABB 扫掠碰撞：分轴推进， cheapest 且不会穿墙 */
  _collide(dt, colliders, slopes) {
    const pos = this.position;
    const r = PLAYER_RADIUS;
    this.onGround = false;

    // --- Y 轴 ---
    pos.y += this.velocity.y * dt;
    for (const b of colliders) {
      _min.set(pos.x - r, pos.y, pos.z - r);
      _max.set(pos.x + r, pos.y + PLAYER_HEIGHT, pos.z + r);
      if (_box.set(_min, _max).intersectsBox(b)) {
        if (this.velocity.y <= 0) {
          pos.y = b.max.y;
          this.velocity.y = 0;
          this.onGround = true;
        } else {
          pos.y = b.min.y - PLAYER_HEIGHT;
          this.velocity.y = 0;
        }
      }
    }
    if (pos.y <= 0) {
      pos.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // --- X / Z 轴 ---
    for (const axis of ['x', 'z']) {
      pos[axis] += this.velocity[axis] * dt;
      for (const b of colliders) {
        _min.set(pos.x - r, pos.y + 0.08, pos.z - r);
        _max.set(pos.x + r, pos.y + PLAYER_HEIGHT - 0.05, pos.z + r);
        if (!_box.set(_min, _max).intersectsBox(b)) continue;
        // 只在高度真正重叠时才阻挡（这样能走上 platform / ramp）
        if (b.max.y <= pos.y + 0.35 || b.min.y >= pos.y + PLAYER_HEIGHT - 0.1) continue;
        const center = (b.min[axis] + b.max[axis]) / 2;
        const half = (b.max[axis] - b.min[axis]) / 2 + r;
        pos[axis] = pos[axis] > center ? center + half : center - half;
        this.velocity[axis] = 0;
      }
    }

    // 斜坡：在 XZ 解算之后贴合斜面，坡道才是真的"能走上去"
    if (slopes && slopes.length) this._resolveSlopes(slopes);
  }

  _resolveSlopes(slopes) {
    const px = this.position.x, pz = this.position.z;
    for (const s of slopes) {
      if (px < s.minX || px > s.maxX || pz < s.minZ || pz > s.maxZ) continue;
      const proj = (px - s.lowX) * s.upX + (pz - s.lowZ) * s.upZ;
      if (proj < 0 || proj > s.run) continue;
      const surf = s.baseY + (proj / s.run) * (s.topY - s.baseY);
      // 只在"已经贴近或低于斜面"时吸附，避免从下方顶穿
      if (this.position.y <= surf + 0.5 && this.position.y >= s.baseY - 1.5) {
        this.position.y = surf;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.onGround = true;
      }
    }
  }

  /**
   * 设定机位。spectate=true 时进入自由视角（无重力/无碰撞），
   * 用于 Agent 从任意角度审视关卡美术，或产出宣传图。
   */
  setViewpoint({ position, yaw, pitch, fov, spectate } = {}) {
    if (Array.isArray(position) && position.length === 3) {
      this.position.set(position[0], position[1], position[2]);
      this.velocity.set(0, 0, 0);
    }
    if (typeof yaw === 'number') this.yaw = yaw;
    if (typeof pitch === 'number') {
      const lim = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-lim, Math.min(lim, pitch));
    }
    if (typeof fov === 'number') {
      this.camera.fov = Math.min(120, Math.max(20, fov));
      this.camera.updateProjectionMatrix();
    }
    if (typeof spectate === 'boolean') this.spectate = spectate;
    return this.getViewpoint();
  }

  getViewpoint() {
    return {
      position: [this.position.x, this.position.y, this.position.z],
      yaw: this.yaw,
      pitch: this.pitch,
      fov: this.camera.fov,
      spectate: this.spectate,
    };
  }

  update(dt, colliders, slopes) {
    // 自由视角：不做任何物理模拟，相机直接贴到机位
    if (this.spectate) {
      this.camera.position.set(this.position.x, this.position.y, this.position.z);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw);
      this.camera.rotateX(this.pitch);
      if (this.fireCooldown > 0) this.fireCooldown -= dt;
      return;
    }

    const gp = this.gp || { moveSpeed: 7, sprintMultiplier: 1.5, jumpVelocity: 6.4, gravity: 22 };
    const k = this.keys;

    // 输入 → 本地意图方向
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    const sprinting = (k.has('ShiftLeft') || k.has('ShiftRight')) && fz < 0;
    const speed = gp.moveSpeed * (sprinting ? gp.sprintMultiplier : 1);

    // 世界空间速度（yaw 旋转）
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const targetX = (fx * cos - fz * sin) * speed;
    const targetZ = (fx * sin + fz * cos) * speed;

    // 地面上有摩擦感，空中保留惯性
    const accel = this.onGround ? 14 : 3.2;
    this.velocity.x += (targetX - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetZ - this.velocity.z) * Math.min(1, accel * dt);

    if (k.has('Space') && this.onGround) {
      this.velocity.y = gp.jumpVelocity;
      this.onGround = false;
    }
    this.velocity.y -= gp.gravity * dt;
    if (this.velocity.y < -55) this.velocity.y = -55;

    this._collide(dt, colliders, slopes);

    // 头部摆动（仅轻微，避免晕）
    const bob = this.onGround ? Math.sin(performance.now() * 0.011) * Math.hypot(this.velocity.x, this.velocity.z) * 0.006 : 0;

    this.camera.position.set(this.position.x, this.position.y + EYE_OFFSET + bob, this.position.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    // 计时器
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.ammo = this.magazine ?? 30;
      }
    }
  }

  canFire() {
    return this.alive && !this.reloading && this.fireCooldown <= 0 && this.ammo > 0;
  }

  consumeShot() {
    this.ammo -= 1;
    this.fireCooldown = this.gp ? this.gp.fireRate : 0.11;
    this.stats.shotsFired += 1;
    if (this.ammo <= 0) this.startReload();
  }

  /** 相机朝向（含扩散抖动） */
  aimDirection(target = new THREE.Vector3()) {
    this.camera.getWorldDirection(target);
    const s = this.gp ? this.gp.spread : 0.015;
    if (s > 0) {
      target.x += (Math.random() - 0.5) * s;
      target.y += (Math.random() - 0.5) * s;
      target.z += (Math.random() - 0.5) * s;
    }
    return target.normalize();
  }
}

export { PLAYER_HEIGHT, PLAYER_RADIUS, EYE_OFFSET };
