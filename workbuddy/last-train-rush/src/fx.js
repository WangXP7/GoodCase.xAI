// 特效：粒子爆发（金币/尘土/受击/彩带）+ 速度线 + 相机震动
import * as THREE from 'three';

const COLORS_FX = {
  gold: 0xf5b83d,
  dust: 0x6b7280,
  hit: 0xff5d6c,
  teal: 0x37b8a6,
  white: 0xffffff,
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.CAP = 90;
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const types = Object.keys(COLORS_FX);
    this.systems = {};
    for (const t of types) {
      const mat = new THREE.MeshBasicMaterial({ color: COLORS_FX[t], transparent: true, opacity: 0.95 });
      const inst = new THREE.InstancedMesh(this.boxGeo, mat, this.CAP);
      inst.frustumCulled = false;
      inst.count = 0;
      scene.add(inst);
      this.systems[t] = { inst, parts: [] };
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3(0.4, 0.8, 0.2).normalize();
    this._buildSpeedLines();
    this.trauma = 0;
  }

  _buildSpeedLines() {
    const N = 64;
    const pos = new Float32Array(N * 6);
    this.slGeo = new THREE.BufferGeometry();
    this.slGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.slMat = new THREE.LineBasicMaterial({
      color: 0xbfd4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.sl = new THREE.LineSegments(this.slGeo, this.slMat);
    this.sl.frustumCulled = false;
    this.scene.add(this.sl);
    this.slData = [];
    for (let i = 0; i < N; i++) {
      this.slData.push({ x: 0, y: 0, z: 0, len: 2 + Math.random() * 3 });
    }
    this.slCount = 0;
  }

  reset() {
    for (const t in this.systems) {
      this.systems[t].parts.length = 0;
      this.systems[t].inst.count = 0;
    }
    this.trauma = 0;
    this.slMat.opacity = 0;
  }

  burst(type, x, y, z, count, spread = 3, up = 3) {
    const sys = this.systems[type];
    if (!sys) return;
    for (let i = 0; i < count; i++) {
      if (sys.parts.length >= this.CAP) sys.parts.shift();
      sys.parts.push({
        x, y, z,
        vx: (Math.random() - 0.5) * spread,
        vy: Math.random() * up + 0.5,
        vz: (Math.random() - 0.5) * spread,
        life: 0, max: 0.4 + Math.random() * 0.5,
        size: 0.05 + Math.random() * 0.09,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
      });
    }
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt, cam, playerZ, speedRatio) {
    // ---- 粒子 ----
    for (const t in this.systems) {
      const sys = this.systems[t];
      let n = 0;
      for (let i = sys.parts.length - 1; i >= 0; i--) {
        const p = sys.parts[i];
        p.life += dt;
        if (p.life >= p.max) { sys.parts.splice(i, 1); continue; }
        p.vy -= 9.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rot += p.vr * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
        n++;
      }
      // 写入矩阵（按 life 降序写入前 n 个）
      const count = Math.min(n, this.CAP);
      for (let i = 0; i < count; i++) {
        const p = sys.parts[i];
        const k = 1 - p.life / p.max;
        const s = p.size * (0.5 + k * 0.8);
        this._p.set(p.x, p.y, p.z);
        this._q.setFromAxisAngle(this._axis, p.rot);
        this._s.set(s, s, s);
        this._m.compose(this._p, this._q, this._s);
        sys.inst.setMatrixAt(i, this._m);
      }
      sys.inst.count = count;
      sys.inst.instanceMatrix.needsUpdate = true;
    }

    // ---- 速度线 ----
    const wantLines = speedRatio > 0.32 ? Math.floor(64 * Math.min(1, (speedRatio - 0.32) / 0.4)) : 0;
    this.slMat.opacity += ((wantLines > 0 ? 0.5 : 0) - this.slMat.opacity) * Math.min(1, dt * 4);
    const posAttr = this.slGeo.attributes.position;
    const arr = posAttr.array;
    const camPos = cam.position;
    for (let i = 0; i < 64; i++) {
      const d = this.slData[i];
      const active = i < wantLines;
      if (active) {
        if (d.z === 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 1.6 + Math.random() * 5.5;
          d.x = Math.cos(a) * r;
          d.y = Math.sin(a) * r * 0.62 + 1.6;
          d.z = camPos.z + 14 + Math.random() * 40;
        }
        // 向后飞（相对相机）
        d.z -= (14 + speedRatio * 26) * dt * 2.2;
        if (d.z < camPos.z - 6) d.z = 0; // 重生
        const x0 = camPos.x + d.x, y0 = camPos.y + d.y - 1.6, z0 = d.z;
        arr[i * 6] = x0; arr[i * 6 + 1] = y0; arr[i * 6 + 2] = z0;
        arr[i * 6 + 3] = x0; arr[i * 6 + 4] = y0; arr[i * 6 + 5] = z0 + d.len;
      } else {
        d.z = 0;
        for (let k = 0; k < 6; k++) arr[i * 6 + k] = 0;
      }
    }
    posAttr.needsUpdate = true;

    // ---- 相机震动 ----
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      const amp = this.trauma * this.trauma * 0.5;
      cam.position.x += (Math.random() - 0.5) * amp;
      cam.position.y += (Math.random() - 0.5) * amp;
    }
  }
}
