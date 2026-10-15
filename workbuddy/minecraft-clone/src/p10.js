/* =====================================================================
   12. 玩家：物理、碰撞、控制器
   ---------------------------------------------------------------------
   参数严格对齐原版：
     步行 4.317 m/s · 疾跑 5.612 m/s · 潜行 1.295 m/s · 飞行 10.89 m/s
     重力 32 m/s² · 起跳初速 8.95 m/s（跳跃高度 1.2522 格）
     碰撞盒 0.6 × 1.8 × 0.6 · 眼高 1.62（潜行 1.27）· 自动上台阶 0.6
   ===================================================================== */

const PLAYER = {
  WIDTH: 0.6, HEIGHT: 1.8,
  EYE: 1.62, EYE_SNEAK: 1.27,
  GRAVITY: 32,
  JUMP_V: 8.95,
  SPEED_WALK: 4.317,
  SPEED_SPRINT: 5.612,
  SPEED_SNEAK: 1.295,
  SPEED_FLY: 10.89,
  SPEED_SWIM: 2.4,
  STEP: 0.6,
  TERMINAL: 78,
  ACC_GROUND: 22,
  ACC_AIR: 3.2,
  WATER_DRAG: 0.82,
};

class Player {
  constructor(world) {
    this.world = world;
    this.pos = [0, 80, 0];      // 脚底中心
    this.vel = [0, 0, 0];
    this.yaw = 0;               // 弧度，0 → 朝 -Z
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.onLadder = false;
    this.sneaking = false;
    this.sprinting = false;
    this.flying = false;
    this.creative = true;
    this.walkDist = 0;
    this.walkDistSide = 0;
    this.bobPhase = 0;
    this.fallStartY = null;
    this.lastGroundY = 0;
    this.stepSmooth = 0;
    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.air = 300;             // 氧气（tick）
    this.maxAir = 300;
    this.xp = 0;
    this.xpLevel = 0;
    this.hurtTime = 0;
    this.dead = false;
    this.swing = 0;
    this.spawn = [0, 80, 0];
    this.fovMul = 1;
  }

  camera() {
    const eye = this.sneaking ? PLAYER.EYE_SNEAK : PLAYER.EYE;
    const bob = this._bob();
    return {
      x: this.pos[0] + bob[0],
      y: this.pos[1] + eye + bob[1] + this.stepSmooth,
      z: this.pos[2] + bob[2],
      yaw: this.yaw,
      pitch: this.pitch,
      roll: bob[3],
      fov: this.fovBase || 70,
    };
  }

  _bob() {
    const s = this.bobScale || 0;
    if (s <= 0) return [0, 0, 0, 0];
    const p = this.bobPhase;
    const amt = clamp(this._speedH() / PLAYER.SPEED_WALK, 0, 1.35) * s;
    return [
      Math.cos(p) * 0.055 * amt,
      Math.abs(Math.sin(p)) * 0.062 * amt,
      Math.sin(p) * 0.055 * amt,
      Math.sin(p) * 0.011 * amt,
    ];
  }

  _speedH() { return Math.hypot(this.vel[0], this.vel[2]); }

  /* ---------- 方块查询 ---------- */
  _solidAt(x, y, z) {
    const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    if (b <= 0) return false;
    return BLOCKS[b].solid;
  }

  /** 玩家 AABB 是否与任何实心方块相交 */
  collides(px, py, pz) {
    const w = PLAYER.WIDTH * 0.5;
    const x0 = Math.floor(px - w + 1e-5), x1 = Math.floor(px + w - 1e-5);
    const y0 = Math.floor(py + 1e-5), y1 = Math.floor(py + PLAYER.HEIGHT - 1e-5);
    const z0 = Math.floor(pz - w + 1e-5), z1 = Math.floor(pz + w - 1e-5);
    const W = this.world;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= CH_Y) continue;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = W.getBlock(x, y, z);
          if (b > 0 && BLOCKS[b].solid) return true;
        }
      }
    }
    return false;
  }

  /** 脚下是否有支撑（潜行防掉落用） */
  hasSupport(px, py, pz) {
    const w = PLAYER.WIDTH * 0.5 - 0.001;
    const y = Math.floor(py - 0.08);
    for (let z = Math.floor(pz - w); z <= Math.floor(pz + w); z++) {
      for (let x = Math.floor(px - w); x <= Math.floor(px + w); x++) {
        const b = this.world.getBlock(x, y, z);
        if (b > 0 && BLOCKS[b].solid) return true;
      }
    }
    return false;
  }

  /** 当前所处的方块（脚部 / 头部） */
  _blockAt(dy) {
    const b = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + dy), Math.floor(this.pos[2]));
    return b > 0 ? BLOCKS[b] : null;
  }

  /* ---------- 每帧更新 ---------- */
  update(dt, input, world) {
    dt = Math.min(dt, 0.1);
    this.world = world;
    const W = world;

    // --- 环境检测 ---
    const feetB = this._blockAt(0.1);
    const headB = this._blockAt(PLAYER.EYE - 0.1);
    this.inWater = !!(feetB && feetB.fluid && feetB.name === 'water');
    this.inLava = !!(feetB && feetB.fluid && feetB.name === 'lava');
    this.headInWater = !!(headB && headB.name === 'water');
    const climbB = this._blockAt(0.5);
    this.onLadder = !!(climbB && climbB.climbable) || !!(this._blockAt(PLAYER.EYE - 0.2) && this._blockAt(PLAYER.EYE - 0.2).climbable);

    // 受伤（仙人掌 / 岩浆接触）
    for (const d of [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.32], [0, -0.32]]) {
      const bb = W.getBlock(Math.floor(this.pos[0] + d[0]), Math.floor(this.pos[1] + 1), Math.floor(this.pos[2] + d[1]));
      if (bb > 0 && BLOCKS[bb].damage > 0) this.hurt(BLOCKS[bb].damage * 0.5);
    }
    if (this.inLava) this.hurt(4 * dt * 2);

    // --- 移动输入 ---
    const fwd = input.forward - input.back;
    const strafe = input.right - input.left;
    const len = Math.hypot(fwd, strafe);
    let mx = 0, mz = 0;
    if (len > 0) {
      const nd = fwd / len, sd = strafe / len;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // forward 方向 = (-sin(yaw), -cos(yaw))，right = (cos(yaw), -sin(yaw))
      mx = (-sy * nd + cy * sd);
      mz = (-cy * nd - sy * sd);
      const l2 = Math.hypot(mx, mz) || 1;
      mx /= l2; mz /= l2;
    }

    this.sneaking = input.sneak && !this.flying;

    let speed;
    if (this.flying) speed = PLAYER.SPEED_FLY;
    else if (this.inWater || this.inLava) speed = PLAYER.SPEED_SWIM;
    else if (this.sneaking) speed = PLAYER.SPEED_SNEAK;
    else if (this.sprinting && len > 0) speed = PLAYER.SPEED_SPRINT;
    else speed = PLAYER.SPEED_WALK;
    if (this.flying && input.sprint) speed *= 2;

    // 疾跑时 FOV 轻微拉大（原版 0.1 倍）
    const targetFovMul = (this.sprinting && len > 0) ? 1.10 : 1.0;
    this.fovMul += (targetFovMul - this.fovMul) * Math.min(1, dt * 8);
    this.fovBase = this.baseFov * this.fovMul;

    // --- 加速度 ---
    const acc = this.onGround ? PLAYER.ACC_GROUND : (this.flying ? 12 : PLAYER.ACC_AIR);
    const k = 1 - Math.exp(-acc * dt);
    this.vel[0] += (mx * speed - this.vel[0]) * k;
    this.vel[2] += (mz * speed - this.vel[2]) * k;

    // --- 垂直运动 ---
    if (this.flying) {
      let vy = 0;
      if (input.jump) vy += speed * 0.72;
      if (input.sneak) vy -= speed * 0.72;
      this.vel[1] += (vy - this.vel[1]) * Math.min(1, dt * 12);
    } else if (this.onLadder || (this.inWater && input.jump) || (this.inLava && input.jump)) {
      let vy = 0;
      if (input.jump) vy = this.onLadder ? 2.2 : 2.6;
      else if (input.sneak && this.onLadder) vy = -2.2;
      else if (this.inWater || this.inLava) vy = this.vel[1] * 0.86 - 1.1 * dt * 4;
      this.vel[1] = vy;
      if (this.onLadder && (input.forward || input.back)) this.vel[1] = input.forward ? 2.2 : -2.2;
    } else {
      this.vel[1] -= PLAYER.GRAVITY * dt;
      if (this.vel[1] < -PLAYER.TERMINAL) this.vel[1] = -PLAYER.TERMINAL;
      if (input.jump && this.onGround) {
        this.vel[1] = PLAYER.JUMP_V;
        this.onGround = false;
        if (this.sprinting) { this.vel[0] += mx * 0.6; this.vel[2] += mz * 0.6; }
      }
    }

    // 流体阻力
    if ((this.inWater || this.inLava) && !this.flying) {
      this.vel[0] *= Math.pow(PLAYER.WATER_DRAG, dt * 20);
      this.vel[2] *= Math.pow(PLAYER.WATER_DRAG, dt * 20);
    }

    // --- 实际位移 ---
    const oldPos = [this.pos[0], this.pos[1], this.pos[2]];
    let dx = this.vel[0] * dt, dy = this.vel[1] * dt, dz = this.vel[2] * dt;

    // 潜行防掉落
    if (this.sneaking && this.onGround && !this.flying) {
      const nx = this.pos[0] + dx, nz = this.pos[2] + dz;
      if (!this.hasSupport(nx, this.pos[1], this.pos[2])) dx = 0;
      if (!this.hasSupport(this.pos[0], this.pos[1], nz)) dz = 0;
    }

    const wasGround = this.onGround;
    this.moveAxis(1, dy);
    this.moveHorizontal(dx, dz);

    // 地面检测
    this.onGround = this.collides(this.pos[0], this.pos[1] - 0.02, this.pos[2]) && this.vel[1] <= 0.0001;

    // 摔落伤害
    if (!this.flying) {
      if (!this.onGround && this.vel[1] < -0.1) {
        if (this.fallStartY === null) this.fallStartY = this.pos[1];
        else this.fallStartY = Math.max(this.fallStartY, this.pos[1]);
      }
      if (this.onGround && this.fallStartY !== null) {
        const fall = this.fallStartY - this.pos[1];
        if (fall > 3.0 && !this.inWater) {
          this.hurt(Math.floor(fall - 3));
        }
        this.fallStartY = null;
      }
    }

    // 台阶平滑（视觉）
    this.stepSmooth += (0 - this.stepSmooth) * Math.min(1, dt * 14);

    // 卡在方块中 → 向上推
    if (this.collides(this.pos[0], this.pos[1], this.pos[2])) {
      for (let up = 0.1; up <= 3; up += 0.1) {
        if (!this.collides(this.pos[0], this.pos[1] + up, this.pos[2])) { this.pos[1] += up; this.vel[1] = 0; break; }
      }
    }
    if (this.pos[1] < -30) this.hurt(100);

    // --- 相机摇晃 ---
    const moved = Math.hypot(this.pos[0] - oldPos[0], this.pos[2] - oldPos[2]);
    this.walkDist += moved;
    if (this.onGround) this.bobPhase += moved * 3.1;
    else this.bobPhase += moved * 1.4;

    // 挖掘手臂摆动衰减
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4.2);

    // --- 氧气 ---
    if (this.creative) { this.air = this.maxAir; this.food = 20; }
    else {
      if (this.headInWater) {
        this.air -= dt * 20 * 3;
        if (this.air <= 0) { this.air = 0; this._airTick = (this._airTick || 0) + dt; if (this._airTick > 1) { this._airTick = 0; this.hurt(2); } }
      } else {
        this.air = Math.min(this.maxAir, this.air + dt * 20 * 8);
      }
      this.food -= dt * 0.012 * (this.sprinting ? 2.4 : 1);
      if (this.food < 0) this.food = 0;
      if (this.food > 16 && this.health < this.maxHealth) {
        this._regenT = (this._regenT || 0) + dt;
        if (this._regenT > 3.5) { this._regenT = 0; this.health = Math.min(this.maxHealth, this.health + 1); }
      }
    }
    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.health <= 0) this.dead = true;
  }

  moveAxis(axis, amount) {
    if (amount === 0) return;
    const p = this.pos.slice();
    p[axis] += amount;
    if (!this.collides(p[0], p[1], p[2])) {
      this.pos[axis] = p[axis];
      return;
    }
    // 逐像素逼近
    const sign = Math.sign(amount);
    const stepN = Math.max(1, Math.ceil(Math.abs(amount) / 0.05));
    const stepA = amount / stepN;
    for (let i = 0; i < stepN; i++) {
      const q = this.pos.slice();
      q[axis] += stepA;
      if (this.collides(q[0], q[1], q[2])) break;
      this.pos[axis] = q[axis];
    }
    this.vel[axis] = 0;
  }

  moveHorizontal(dx, dz) {
    const startY = this.pos[1];
    const px = this.pos[0], pz = this.pos[2];
    this.moveAxis(0, dx);
    const movedX = this.pos[0] !== px;
    this.moveAxis(2, dz);
    const movedZ = this.pos[2] !== pz;
    // 若被挡住，尝试自动上台阶
    if ((!movedX && Math.abs(dx) > 1e-5) || (!movedZ && Math.abs(dz) > 1e-5)) {
      this.tryStep(dx, dz, startY);
    }
  }

  tryStep(dx, dz, startY) {
    for (let lift = 0.0625; lift <= PLAYER.STEP + 0.001; lift += 0.0625) {
      const testY = startY + lift;
      if (this.collides(this.pos[0], testY, this.pos[2])) break;
      const sx = this.pos[0], sz = this.pos[2];
      this.pos[1] = testY;
      this.moveAxis(0, dx);
      this.moveAxis(2, dz);
      const ok = this.pos[0] !== sx || this.pos[2] !== sz;
      if (ok && this.hasSupport(this.pos[0], this.pos[1], this.pos[2])) {
        this.stepSmooth = -lift;    // 视觉上略微下沉后再回弹
        this.vel[1] = 0;
        return true;
      }
      this.pos[1] = startY;
      this.pos[0] = sx; this.pos[2] = sz;
    }
    this.pos[1] = startY;
    return false;
  }

  hurt(dmg) {
    if (this.creative || this.dead || this.hurtTime > 0.2) return;
    if (dmg < 0.5) return;
    this.health = Math.max(0, this.health - Math.max(1, Math.round(dmg)));
    this.hurtTime = 0.55;
    this.onHurt && this.onHurt(dmg);
  }

  startSwing() { if (this.swing <= 0.2) this.swing = 1; }

  respawn() {
    this.pos = this.spawn.slice();
    this.vel = [0, 0, 0];
    this.health = this.maxHealth;
    this.food = 20;
    this.air = this.maxAir;
    this.dead = false;
    this.fallStartY = null;
  }

  eyePos() {
    const eye = this.sneaking ? PLAYER.EYE_SNEAK : PLAYER.EYE;
    return [this.pos[0], this.pos[1] + eye, this.pos[2]];
  }
}

/* =====================================================================
   体素射线拾取（Amanatides & Woo DDA）
   ===================================================================== */
function raycastVoxel(world, ox, oy, oz, dx, dy, dz, maxDist, includeFluid) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
  const xBound = dx > 0 ? x + 1 : x;
  const yBound = dy > 0 ? y + 1 : y;
  const zBound = dz > 0 ? z + 1 : z;
  let tMaxX = dx === 0 ? Infinity : (xBound - ox) / dx;
  let tMaxY = dy === 0 ? Infinity : (yBound - oy) / dy;
  let tMaxZ = dz === 0 ? Infinity : (zBound - oz) / dz;
  if (tMaxX < 0) tMaxX = 0; if (tMaxY < 0) tMaxY = 0; if (tMaxZ < 0) tMaxZ = 0;

  let face = -1;
  let t = 0;
  const first = world.getBlock(x, y, z);
  if (first > 0) {
    const B = BLOCKS[first];
    if (B.solid || (includeFluid && B.fluid)) {
      return { x, y, z, face: 2, id: first, dist: 0 };
    }
  }
  for (let i = 0; i < 512; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX > maxDist) break;
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 1 : 0;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY > maxDist) break;
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 3 : 2;
    } else {
      if (tMaxZ > maxDist) break;
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4;
    }
    if (y < 0 || y >= CH_Y) continue;
    const id = world.getBlock(x, y, z);
    if (id === 0) continue;
    const B = BLOCKS[id];
    if (B.render === 'none') continue;
    if (!B.solid && !(includeFluid && B.fluid)) continue;
    return { x, y, z, face, id, dist: t };
  }
  return null;
}

/** 由命中面推算出放置位置 */
function placementPos(hit) {
  const n = DIRS[hit.face];
  return { x: hit.x + n[0], y: hit.y + n[1], z: hit.z + n[2] };
}

/** 判断放置是否与玩家 AABB 冲突 */
function placementBlocked(player, bx, by, bz, block) {
  if (!block.solid) return false;
  const w = PLAYER.WIDTH * 0.5;
  const px0 = player.pos[0] - w, px1 = player.pos[0] + w;
  const py0 = player.pos[1], py1 = player.pos[1] + PLAYER.HEIGHT;
  const pz0 = player.pos[2] - w, pz1 = player.pos[2] + w;
  return !(bx + 1 <= px0 || bx >= px1 || by + 1 <= py0 || by >= py1 || bz + 1 <= pz0 || bz >= pz1);
}
