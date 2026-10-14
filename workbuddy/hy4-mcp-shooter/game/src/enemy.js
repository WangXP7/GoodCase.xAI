/**
 * enemy.js — 敌人 Pawn + 简单 AI
 *
 * 对应 UE 里的 Pawn / Character 子类。四种类型（步兵/突击兵/狙击手/重甲兵）
 * 的差异全部由 Scene Manifest 的 ENEMY_TYPES 表驱动，Agent 改数值即改行为。
 *
 * AI 是有限状态机：patrol → chase → attack，附带简易掩体规避（对遮挡做射线检测）。
 */
import * as THREE from 'three';
import { ENEMY_TYPES } from './level.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

const PROJECTILE_POOL = [];

/** 程序化低模人形：躯干 + 头 + 发光目镜 + 两条腿 */
function buildEnemyMesh(type, color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.72, metalness: 0.18, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#15181f'), roughness: 0.6, metalness: 0.35, flatShading: true });
  const glow = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff5a3c'), emissive: new THREE.Color('#ff3b1e'),
    emissiveIntensity: 3.4, roughness: 0.3,
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.4), skin);
  torso.position.y = 1.18;
  torso.castShadow = true;
  g.add(torso);

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.44), dark);
  shoulders.position.y = 1.56;
  shoulders.castShadow = true;
  g.add(shoulders);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), dark);
  head.position.y = 1.83;
  head.castShadow = true;
  g.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.09, 0.02), glow);
  visor.position.set(0, 1.85, 0.17);
  g.add(visor);

  const legs = [];
  for (const sx of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), dark);
    leg.position.set(sx, 0.36, 0);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }

  // 武器：远程兵才有
  let gun = null;
  if (type !== 'rusher') {
    gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), dark);
    gun.position.set(0.34, 1.24, 0.3);
    g.add(gun);
  }

  return { group: g, legs, visor, gun, materials: [skin, dark, glow] };
}

export class Enemy {
  constructor(spawn, tuning) {
    const def = ENEMY_TYPES[spawn.type] || ENEMY_TYPES.grunt;
    const t = tuning || {};

    this.id = spawn.id;
    this.type = spawn.type;
    this.def = def;
    this.label = def.label;

    this.maxHealth = def.health * (t.globalHealthScale ?? 1);
    this.health = this.maxHealth;
    this.speed = def.speed * (t.globalSpeedScale ?? 1);
    this.damage = def.damage * (t.globalDamageScale ?? 1);
    this.range = def.range * (t.attackRangeFudge ?? 1);
    this.cooldown = def.cooldown;
    this.accuracy = def.accuracy;
    this.visionRange = t.visionRange ?? 70;
    this.aggression = t.aggression ?? 0.75;
    this.ranged = def.ranged;
    this.scoreValue = def.score;

    const built = buildEnemyMesh(spawn.type, def.color);
    this.mesh = built.group;
    this.legs = built.legs;
    this.visor = built.visor;
    this.gun = built.gun;
    this.materials = built.materials;
    this.mesh.scale.setScalar(def.scale);

    this.position = new THREE.Vector3(spawn.position[0], Math.max(0, spawn.position[1]), spawn.position[2]);
    this.mesh.position.copy(this.position);

    this.patrol = spawn.patrol && spawn.patrol.length ? spawn.patrol.map(([x, z]) => new THREE.Vector3(x, 0, z)) : null;
    this.patrolIndex = 0;
    this.state = 'patrol';
    this.fireTimer = Math.random() * this.cooldown;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.walkPhase = Math.random() * 6.28;
    this.alive = true;
    this.hurtFlash = 0;
    this.radius = 0.5 * def.scale;
    this.height = 2.0 * def.scale;
  }

  /** 命中判定：躯干 + 头部分开算，头部有倍伤 */
  raycast(origin, dir) {
    const cx = this.position.x, cz = this.position.z;
    // 用竖直胶囊近似：解 XZ 平面上的"点到射线"距离
    _v.set(cx - origin.x, 0, cz - origin.z);
    const t = Math.max(0, _v.x * dir.x + _v.z * dir.z);
    _v2.set(origin.x + dir.x * t - cx, 0, origin.z + dir.z * t - cz);
    const dxz = _v2.length();
    if (dxz > this.radius + 0.22) return null;

    const y = origin.y + dir.y * t;
    const feet = this.position.y, head = this.position.y + this.height;
    if (y < feet - 0.15 || y > head + 0.2) return null;

    const headY = this.position.y + this.height * 0.86;
    return { distance: t, headshot: y >= headY, point: new THREE.Vector3(cx, y, cz) };
  }

  takeDamage(amount, headshot) {
    if (!this.alive) return 0;
    const dealt = headshot ? amount * (this._hsMul ?? 2.2) : amount;
    this.health -= dealt;
    this.hurtFlash = 0.18;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return dealt;
  }

  _canSee(playerPos, colliders) {
    const dist = this.position.distanceTo(playerPos);
    if (dist > this.visionRange) return false;
    // 视线遮挡：沿射线采样若干点，落在任何碰撞盒里就算被挡
    const steps = Math.min(14, Math.ceil(dist / 2.5));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      _v.lerpVectors(this.position, playerPos, f);
      _v.y += 1.1;
      let blocked = false;
      for (const b of colliders) {
        if (_v.x >= b.min.x && _v.x <= b.max.x && _v.y >= b.min.y && _v.y <= b.max.y && _v.z >= b.min.z && _v.z <= b.max.z) {
          blocked = true;
          break;
        }
      }
      if (blocked) return false;
    }
    return true;
  }

  _move(dt, dx, dz, colliders) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    dx /= len; dz /= len;
    const step = this.speed * dt;

    let nx = this.position.x + dx * step;
    let nz = this.position.z + dz * step;

    // 简单的分轴碰撞回退
    const r = this.radius;
    for (const b of colliders) {
      if (b.max.y <= this.position.y + 0.3 || b.min.y >= this.position.y + this.height - 0.2) continue;
      _min.set(nx - r, this.position.y + 0.1, this.position.z - r);
      _max.set(nx + r, this.position.y + this.height, this.position.z + r);
      if (_box.set(_min, _max).intersectsBox(b)) { nx = this.position.x; break; }
    }
    for (const b of colliders) {
      if (b.max.y <= this.position.y + 0.3 || b.min.y >= this.position.y + this.height - 0.2) continue;
      _min.set(this.position.x - r, this.position.y + 0.1, nz - r);
      _max.set(this.position.x + r, this.position.y + this.height, this.position.z + r);
      if (_box.set(_min, _max).intersectsBox(b)) { nz = this.position.z; break; }
    }

    this.position.x = nx;
    this.position.z = nz;
  }

  update(dt, player, colliders, ctx) {
    if (!this.alive) return;
    const pp = player.position;
    const dist = this.position.distanceTo(pp);

    const sees = this._canSee(pp, colliders);
    this.state = sees ? (dist <= this.range * 0.95 ? 'attack' : 'chase') : (this.patrol ? 'patrol' : 'idle');

    if (this.state === 'chase' || this.state === 'attack') {
      const toX = pp.x - this.position.x;
      const toZ = pp.z - this.position.z;

      if (this.state === 'attack' && this.ranged) {
        // 保持在射程带内：太近后退、太远逼近、中距离横向绕走
        const ideal = this.range * 0.7;
        let dx = 0, dz = 0;
        if (dist > ideal + 2) { dx = toX; dz = toZ; }
        else if (dist < ideal - 3) { dx = -toX; dz = -toZ; }
        else { dx = -toZ * this.strafeDir; dz = toX * this.strafeDir; }
        this._move(dt, dx, dz, colliders);

        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1.4 + Math.random() * 2.2; }

        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = this.cooldown / Math.max(0.35, this.aggression);
          if (Math.random() < this.accuracy) ctx.spawnProjectile(this, pp);
          else ctx.spawnProjectile(this, _v.set(pp.x + (Math.random() - 0.5) * 6, pp.y, pp.z + (Math.random() - 0.5) * 6));
        }
      } else if (this.state === 'attack' && !this.ranged) {
        // 近战：贴脸然后周期性挥击
        this._move(dt, toX, toZ, colliders);
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && dist <= this.range + 0.6) {
          this.fireTimer = this.cooldown;
          player.takeDamage(this.damage);
          ctx.onMeleeHit?.(this);
        }
      } else {
        this._move(dt, toX, toZ, colliders);
      }

      // 朝向玩家
      this.mesh.rotation.y = Math.atan2(toX, toZ);
    } else if (this.state === 'patrol' && this.patrol) {
      const target = this.patrol[this.patrolIndex];
      const dx = target.x - this.position.x;
      const dz = target.z - this.position.z;
      if (Math.hypot(dx, dz) < 1.5) this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
      else {
        this._move(dt, dx, dz, colliders);
        this.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    // --- 表现层 ---
    this.mesh.position.copy(this.position);
    const moving = this.state !== 'idle';
    this.walkPhase += dt * (moving ? this.speed * 2.4 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.mesh.position.y = this.position.y + (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0);

    // 受击闪白 + 目镜变色
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      const k = Math.max(0, this.hurtFlash / 0.18);
      this.materials[0].emissive.setRGB(k * 0.9, k * 0.15, k * 0.1);
      this.materials[0].emissiveIntensity = 1 + k * 3;
    } else {
      this.materials[0].emissive.setRGB(0, 0, 0);
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** 敌方投射物：发光小球，飞向玩家 */
export class ProjectileSystem {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = new THREE.SphereGeometry(0.16, 8, 6);
    this.mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffb04a'), emissive: new THREE.Color('#ff7a1e'),
      emissiveIntensity: 3.6, roughness: 0.3,
    });
  }

  spawn(from, to) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(from.position.x, from.position.y + 1.3, from.position.z);
    this.scene.add(mesh);
    const dir = _v.set(to.x - mesh.position.x, to.y + 0.9 - mesh.position.y, to.z - mesh.position.z).normalize();
    this.items.push({
      mesh,
      dir: dir.clone(),
      speed: from.type === 'sniper' ? 62 : 34,
      life: 3.2,
      damage: from.damage,
    });
  }

  update(dt, player, colliders, onHit) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      const step = p.speed * dt;
      p.mesh.position.addScaledVector(p.dir, step);

      // 撞玩家
      const dx = p.mesh.position.x - player.position.x;
      const dy = p.mesh.position.y - (player.position.y + 0.9);
      const dz = p.mesh.position.z - player.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.9) {
        player.takeDamage(p.damage);
        onHit?.(p);
        this._kill(i);
        continue;
      }
      // 撞场景
      let hit = false;
      for (const b of colliders) {
        if (b.containsPoint(p.mesh.position)) { hit = true; break; }
      }
      if (hit || p.mesh.position.y < 0 || p.life <= 0) this._kill(i);
    }
  }

  _kill(i) {
    this.scene.remove(this.items[i].mesh);
    this.items.splice(i, 1);
  }

  clear() {
    for (const p of this.items) this.scene.remove(p.mesh);
    this.items.length = 0;
  }
}
