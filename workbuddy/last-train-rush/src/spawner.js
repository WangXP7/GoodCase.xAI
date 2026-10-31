// 障碍与金币生成器：模式化生成 + 对象池回收
import * as THREE from 'three';
import { CFG, COLORS } from './config.js';

// ---------- 原型 ----------
function stripeTexture(c1, c2) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x += 32) {
    g.fillStyle = ((x / 32) % 2 === 0) ? c1 : c2;
    g.fillRect(x, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const stripeTex = stripeTexture('#e8edf5', '#d9552f');

function buildTrainProto() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 2.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.55, metalness: 0.3 })
  );
  body.position.y = 1.75;
  g.add(body);
  const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0xbfe9ff, emissiveIntensity: 0.9, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.92), winMat);
    win.position.set(sx * 1.03, 2.25, 0);
    g.add(win);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xf5b83d, emissive: 0xf5b83d, emissiveIntensity: 0.25 }));
    door.position.set(sx * 1.03, 1.55, 0);
    g.add(door);
  }
  const face = new THREE.Mesh(new THREE.BoxGeometry(2.05, 2.6, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.5, metalness: 0.3 }));
  face.position.set(0, 1.75, 0.5);
  g.add(face);
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.14, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 2.5 }));
  lamp.position.set(0, 1.35, 0.57);
  lamp.rotation.y = Math.PI;
  g.add(lamp);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.98),
    new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.9 }));
  skirt.position.y = 0.5;
  g.add(skirt);
  return g;
}

function buildBarrierProto() {
  // 低栏：跳过
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.62, 0.16),
    new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 })
  );
  board.position.y = 0.55;
  g.add(board);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8f3418, roughness: 0.8 }));
    leg.position.set(sx * 0.82, 0.28, 0);
    g.add(leg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffb46b, emissive: 0xffb46b, emissiveIntensity: 2 }));
  lamp.position.set(0, 0.92, 0);
  g.add(lamp);
  return g;
}

function buildHurdleProto() {
  // 高障：滚过（下方留空）
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.5, 0.22),
    new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 })
  );
  beam.position.y = 1.9;
  g.add(beam);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.0, 10),
    new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.5, metalness: 0.4 }));
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = 1.28;
  g.add(pipe);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x274a80, roughness: 0.7 }));
    post.position.set(sx * 0.98, 1.2, 0);
    g.add(post);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x9fd0ff, emissiveIntensity: 2 }));
  lamp.position.set(0, 2.2, 0);
  g.add(lamp);
  return g;
}

// ---------- 生成器 ----------
export class Spawner {
  constructor(scene) {
    this.scene = scene;
    this.protos = {
      train: buildTrainProto(),
      barrier: buildBarrierProto(),
      hurdle: buildHurdleProto(),
    };
    this.pools = { train: [], barrier: [], hurdle: [] };
    this.active = [];       // {type, obj, lane, x, z0, z1, yMin, yMax, halfW, passed, scored}
    this.coinPool = [];
    this.coinsActive = [];
    this.coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 18);
    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0xf5b83d, emissive: 0xf5b83d, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.85,
    });
    this.cursor = 260;      // 从 260m 开始出障碍（热身段）
    this.prevFreeLane = -1; // 上一块占了两道时剩下的空道
    this.prevBlockEnd = -1;
  }

  reset() {
    for (const o of this.active) this._recycle(o);
    this.active.length = 0;
    for (const c of this.coinsActive) this._recycleCoin(c);
    this.coinsActive.length = 0;
    this.cursor = 260;
    this.prevFreeLane = -1;
    this.prevBlockEnd = -1;
  }

  _take(type) {
    const pool = this.pools[type];
    const obj = pool.pop() || this.protos[type].clone(true);
    obj.visible = true;
    this.scene.add(obj);
    return obj;
  }
  _recycle(o) {
    this.scene.remove(o.obj);
    this.pools[o.type].push(o.obj);
  }

  _spawnObstacle(type, lane, z, len = 1) {
    const obj = this._take(type);
    const x = CFG.lanes[lane];
    if (type === 'train') {
      obj.scale.set(1, 1, len);
      obj.position.set(x, 0, z + len / 2);
    } else {
      obj.position.set(x, 0, z);
    }
    const halfW = type === 'train' ? 1.02 : 1.0;
    const z0 = z, z1 = z + (type === 'train' ? len : 0.8);
    const yMin = type === 'hurdle' ? 1.06 : 0;
    const yMax = type === 'hurdle' ? 2.45 : (type === 'train' ? 3.05 : 0.86);
    const inst = { type, obj, lane, x, z0, z1, yMin, yMax, halfW, passed: false, nearMiss: false };
    this.active.push(inst);
    return inst;
  }

  _spawnCoin(lane, z, y = 1.0) {
    let c = this.coinPool.pop();
    if (!c) {
      c = new THREE.Mesh(this.coinGeo, this.coinMat);
      c.rotation.x = Math.PI / 2;
    }
    c.visible = true;
    c.position.set(CFG.lanes[lane], y, z);
    this.scene.add(c);
    this.coinsActive.push({ obj: c, lane, z, y, taken: false });
  }

  _spawnCoinLine(lane, z0, n, y = 1.0) {
    for (let i = 0; i < n; i++) this._spawnCoin(lane, z0 + i * 1.6, y);
  }
  _spawnCoinArc(lane, z0) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const y = 1.0 + Math.sin(t * Math.PI) * 1.5;
      this._spawnCoin(lane, z0 + t * 8.4, y);
    }
  }

  // 难度 0..1
  _pattern(diff, z) {
    const r = Math.random();
    const others = [0, 1, 2].filter(l => l !== this.prevFreeLane);
    // 若上一块刚堵了两道，前 25m 必须保留空道
    const mustKeepFree = this.prevFreeLane >= 0 && z < this.prevBlockEnd + 25;

    if (mustKeepFree) {
      // 只在另两道放东西，或纯金币
      if (r < 0.4) {
        this._spawnCoinLine(this.prevFreeLane, z + 6, 6);
      } else if (r < 0.75 && diff > 0.15) {
        this._spawnObstacle('barrier', others[0], z + 4);
        this._spawnCoinArc(this.prevFreeLane, z + 2);
      } else if (diff > 0.3) {
        this._spawnObstacle('hurdle', others[1], z + 4);
      } else {
        this._spawnCoinLine(this.prevFreeLane, z + 6, 6);
      }
      return;
    }

    if (diff < 0.12) {
      // 新手区：单障碍 + 大量金币
      if (r < 0.45) this._spawnCoinLine((Math.random() * 3) | 0, z + 8, 7);
      else if (r < 0.8) this._spawnObstacle('barrier', (Math.random() * 3) | 0, z + 6);
      else this._spawnCoinArc((Math.random() * 3) | 0, z + 4);
      return;
    }

    if (r < 0.16) {
      this._spawnCoinLine((Math.random() * 3) | 0, z + 6, 6 + ((Math.random() * 4) | 0));
    } else if (r < 0.34) {
      // 双矮栏：跳
      const a = (Math.random() * 3) | 0;
      this._spawnObstacle('barrier', a, z + 5);
      if (diff > 0.3 && Math.random() < 0.5) {
        const b = [0, 1, 2].find(l => l !== a);
        this._spawnObstacle('barrier', b, z + 5);
      } else {
        this._spawnCoinArc([0, 1, 2].find(l => l !== a), z + 2);
      }
    } else if (r < 0.48) {
      // 高障：滚
      this._spawnObstacle('hurdle', (Math.random() * 3) | 0, z + 5);
      if (diff > 0.35 && Math.random() < 0.4) {
        const a = (Math.random() * 3) | 0;
        this._spawnCoinLine(a, z + 10, 5, 0.65);
      }
    } else if (r < 0.68) {
      // 单列车
      const lane = (Math.random() * 3) | 0;
      this._spawnObstacle('train', lane, z + 4, 16 + Math.random() * 10);
      this._spawnCoinLine([0, 1, 2].find(l => l !== lane), z + 8, 6);
    } else if (r < 0.86) {
      // 双列车：只留一道
      const free = (Math.random() * 3) | 0;
      const len = 18 + Math.random() * 12;
      for (const l of [0, 1, 2]) {
        if (l !== free) this._spawnObstacle('train', l, z + 4, len);
      }
      this.prevFreeLane = free;
      this.prevBlockEnd = z + 4 + len;
      this._spawnCoinLine(free, z + 6, 5);
    } else if (diff > 0.25) {
      // 列车 + 矮栏组合：走位
      const trainLane = (Math.random() * 3) | 0;
      this._spawnObstacle('train', trainLane, z + 4, 14 + Math.random() * 8);
      const barrierLane = [0, 1, 2].find(l => l !== trainLane);
      this._spawnObstacle('barrier', barrierLane, z + 14);
      this._spawnCoinLine(barrierLane, z + 6, 4);
    } else {
      this._spawnCoinLine((Math.random() * 3) | 0, z + 6, 6);
    }
  }

  update(dt, playerZ, diff, playerX) {
    // 生成（终点前 150m 清场，留出冲刺上车空间）
    while (this.cursor < playerZ + CFG.spawnAhead && this.cursor < CFG.goalDistance - 150) {
      this._pattern(diff, this.cursor);
      this.cursor += 44 + Math.random() * 26;
    }
    // 回收 + 金币旋转
    const behind = playerZ - CFG.despawnBehind;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (o.z1 < behind) {
        this._recycle(o);
        this.active.splice(i, 1);
      }
    }
    const t = performance.now() * 0.001;
    for (let i = this.coinsActive.length - 1; i >= 0; i--) {
      const c = this.coinsActive[i];
      if (c.z < behind) {
        this.scene.remove(c.obj);
        this.coinPool.push(c.obj);
        this.coinsActive.splice(i, 1);
      } else if (!c.taken) {
        c.obj.rotation.y = t * 3 + c.z;
      }
    }
  }

  // 碰撞检测：返回 {hit, coins, nearMiss}
  checkCollisions(playerBox) {
    let hit = null;
    let coins = 0;
    let nearMiss = false;
    const px = playerBox.x, pz = playerBox.z;
    const pw = CFG.playerHalfW, pd = CFG.playerHalfD;
    const pyMin = playerBox.y, pyMax = playerBox.y + playerBox.h;

    for (const o of this.active) {
      // 障碍 AABB
      const overlapZ = pz + pd > o.z0 && pz - pd < o.z1;
      const overlapX = px + pw > o.x - o.halfW && px - pw < o.x + o.halfW;
      const overlapY = pyMax > o.yMin && pyMin < o.yMax;
      if (overlapZ && overlapX && overlapY) {
        if (!hit) hit = o;
        continue;
      }
      // 擦身而过：越过障碍整体且横向很近
      if (!o.nearMiss && pz - pd > o.z1) {
        o.nearMiss = true;
        if (Math.abs(px - o.x) < o.halfW + pw + 0.55) nearMiss = true;
      }
    }
    for (const c of this.coinsActive) {
      if (c.taken) continue;
      const dx = px - c.obj.position.x;
      const dz = pz - c.z;
      const dy = (pyMin + pyMax) / 2 - c.y;
      if (dx * dx + dz * dz < 0.85 && Math.abs(dy) < 1.15) {
        c.taken = true;
        c.obj.visible = false;
        coins++;
      }
    }
    return { hit, coins, nearMiss };
  }

  _recycleCoin(c) {
    this.scene.remove(c.obj);
    this.coinPool.push(c.obj);
  }
}
