// 程序化「程序员」角色：连帽衫 + 电脑包 + 耳机 + 工牌，跑/跳/滚全程序化动画
import * as THREE from 'three';
import { COLORS } from './config.js';

const V = new THREE.Vector3();

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05, ...opts });
}
function capsule(r, len, color, opts) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  return new THREE.Mesh(g, mat(color, opts));
}

export class Character {
  constructor() {
    this.root = new THREE.Group();      // 世界位置
    this.body = new THREE.Group();      // 翻滚/受击整体旋转
    this.root.add(this.body);

    // ---- 躯干 ----
    this.hips = new THREE.Group();
    this.hips.position.y = 0.9;
    this.body.add(this.hips);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);

    const torsoMesh = capsule(0.2, 0.34, COLORS.hoodie);
    torsoMesh.position.y = 0.24;
    this.torso.add(torsoMesh);

    // 帽兜（后脑勺一团）
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 10), mat(COLORS.hoodieDark));
    hood.scale.set(1, 0.92, 0.72);
    hood.position.set(0, 0.47, -0.1);
    this.torso.add(hood);

    // 口袋/抽绳细节
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), mat(COLORS.hoodieDark));
    pocket.position.set(0, 0.1, 0.17);
    this.torso.add(pocket);

    // 工牌：挂绳 + 卡
    const lanyard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mat(COLORS.packStripe));
    lanyard.position.set(0, 0.42, 0.16);
    this.torso.add(lanyard);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.015), mat(COLORS.badge, { roughness: 0.5 }));
    badge.position.set(0, 0.28, 0.18);
    this.torso.add(badge);

    // ---- 头 ----
    this.neck = new THREE.Group();
    this.neck.position.y = 0.55;
    this.torso.add(this.neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 14), mat(COLORS.skin));
    this.neck.add(head);
    // 眼睛（朝 +z 前进方向）
    const eyeG = new THREE.SphereGeometry(0.016, 6, 6);
    const eyeM = mat(0x1a1d26, { roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeG, eyeM);
      eye.position.set(sx * 0.052, 0.022, 0.122);
      this.neck.add(eye);
    }
    // 耳机：头梁 + 耳罩
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.017, 6, 18, Math.PI),
      mat(COLORS.headphone, { roughness: 0.5 })
    );
    band.rotation.z = Math.PI;
    band.position.y = 0.04;
    this.neck.add(band);
    const cupG = new THREE.CylinderGeometry(0.045, 0.05, 0.055, 10);
    const cupM = mat(COLORS.headphone, { roughness: 0.45 });
    const ringM = mat(COLORS.packStripe, { emissive: COLORS.packStripe, emissiveIntensity: 0.35, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const cup = new THREE.Mesh(cupG, cupM);
      cup.rotation.x = Math.PI / 2;
      cup.rotation.z = Math.PI / 2;
      cup.position.set(sx * 0.148, 0.0, 0);
      this.neck.add(cup);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 14), ringM);
      ring.position.set(sx * 0.148, 0, 0.055);
      this.neck.add(ring);
    }

    // ---- 电脑包（背在身后）----
    this.pack = new THREE.Group();
    this.pack.position.set(0, 0.26, -0.24);
    this.torso.add(this.pack);
    const packBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.48, 0.2), mat(COLORS.pack, { roughness: 0.8 }));
    this.pack.add(packBody);
    const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.2), mat(0x2e323c, { roughness: 0.8 }));
    packTop.position.y = 0.26;
    this.pack.add(packTop);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.035, 0.21), mat(COLORS.packStripe, { emissive: COLORS.packStripe, emissiveIntensity: 0.3 }));
    stripe.position.set(0, 0.08, 0);
    this.pack.add(stripe);
    // 露出半截的笔记本（屏幕微微发光）
    const laptop = new THREE.Group();
    laptop.position.set(0.04, 0.3, -0.02);
    laptop.rotation.x = -0.5;
    laptop.rotation.z = 0.12;
    this.pack.add(laptop);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.19, 0.02), mat(0x2b2f3a, { roughness: 0.6 }));
    laptop.add(lid);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.16),
      new THREE.MeshStandardMaterial({ color: COLORS.screen, emissive: COLORS.screen, emissiveIntensity: 1.6, roughness: 0.4 })
    );
    screen.position.z = 0.012;
    laptop.add(screen);

    // ---- 手臂 ----
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.29, 0.44, 0);
      this.torso.add(shoulder);
      const upper = capsule(0.062, 0.2, COLORS.hoodie);
      upper.position.y = -0.14;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      const fore = capsule(0.055, 0.18, COLORS.skin);
      fore.position.y = -0.13;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 8), mat(COLORS.skin));
      hand.position.y = -0.27;
      elbow.add(hand);
      this.arms.push({ shoulder, elbow, side: sx });
    }

    // ---- 腿 ----
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.13, 0, 0);
      this.hips.add(hip);
      const thigh = capsule(0.075, 0.26, COLORS.pants);
      thigh.position.y = -0.19;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      const shin = capsule(0.062, 0.24, COLORS.pants);
      shin.position.y = -0.17;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.24), mat(COLORS.shoe, { roughness: 0.6 }));
      shoe.position.set(0, -0.34, 0.045);
      knee.add(shoe);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.03, 0.25), mat(0xf5f0e6, { roughness: 0.7 }));
      sole.position.set(0, -0.375, 0.045);
      knee.add(sole);
      this.legs.push({ hip, knee, side: sx });
    }

    // 动画状态
    this.phase = 0;          // 跑步步频相位
    this.blend = { run: 1, jump: 0, roll: 0, stumble: 0 };
    this.rollSpin = 0;
    this._stepSide = 1;
    this._lastStepPhase = 0;
  }

  // state: { grounded, vy, rolling, stumble, laneTilt, speedRatio }
  update(dt, s) {
    const b = this.blend;
    // 目标混合权重
    const tJump = s.rolling ? 0 : (s.grounded ? 0 : 1);
    const tRoll = s.rolling ? 1 : 0;
    const tStumble = s.stumble > 0 ? 1 : 0;
    const tRun = 1 - Math.max(tJump, tRoll, tStumble);
    const k = Math.min(1, dt * 12);
    b.run += (tRun - b.run) * k;
    b.jump += (tJump - b.jump) * k;
    b.roll += (tRoll - b.roll) * k;
    b.stumble += (tStumble - b.stumble) * k;

    // 步频随速度提升
    const cadence = 7.2 + s.speedRatio * 5.2;
    this.phase += dt * cadence;

    // ---- 跑步姿态 ----
    const p = this.phase;
    const swing = Math.sin(p);
    const swing2 = Math.sin(p + Math.PI);
    for (const leg of this.legs) {
      const sw = leg.side < 0 ? swing : swing2;
      leg.hip.rotation.x = sw * 0.95 * b.run;
      // 膝弯：后摆时弯，前伸时直
      const bend = Math.max(0, -sw) * 1.55 + 0.12;
      leg.knee.rotation.x = bend * b.run;
    }
    for (const arm of this.arms) {
      const sw = arm.side < 0 ? swing2 : swing;
      arm.shoulder.rotation.x = sw * 0.85 * b.run;
      arm.shoulder.rotation.z = arm.side * (0.12 + 0.1 * b.run);
      const bend = 0.55 + Math.max(0, sw) * 0.85;
      arm.elbow.rotation.x = -bend * b.run;
    }
    // 身体上下起伏 + 前倾
    this.hips.position.y = 0.9 + Math.abs(Math.sin(p)) * 0.045 * b.run;
    this.hips.rotation.x = 0.1 * b.run - 0.16 * b.jump - 0.1 * b.roll + 0.06 * b.stumble;
    this.torso.rotation.y = Math.sin(p) * 0.06 * b.run;
    this.neck.rotation.x = -0.05 * b.run - 0.08 * b.jump + 0.18 * b.stumble;
    this.neck.rotation.z = Math.sin(p) * 0.03 * b.run;

    // ---- 跳跃姿态 ----
    if (b.jump > 0.001) {
      const j = b.jump;
      const rising = s.vy > 0 ? 1 : 0.4;
      this.legs[0].hip.rotation.x = (-0.85 * rising + 0.1) * j;
      this.legs[1].hip.rotation.x = (0.55 - 0.3 * rising) * j;
      this.legs[0].knee.rotation.x = (1.5 * rising + 0.3) * j;
      this.legs[1].knee.rotation.x = (0.9 + 0.5 * rising) * j;
      this.arms[0].shoulder.rotation.x = (-2.1 * rising - 0.4) * j;
      this.arms[1].shoulder.rotation.x = (-1.7 * rising - 0.3) * j;
      this.arms[0].elbow.rotation.x = -0.5 * j;
      this.arms[1].elbow.rotation.x = -0.7 * j;
    }

    // ---- 翻滚：抱膝前滚翻 ----
    if (b.roll > 0.001) {
      const j = b.roll;
      this.rollSpin += dt * (Math.PI * 2 / 0.55) * j;
      this.body.rotation.x = this.rollSpin;
      this.hips.rotation.x = -0.9 * j;
      for (const leg of this.legs) {
        leg.hip.rotation.x = -1.5 * j + leg.hip.rotation.x * (1 - j);
        leg.knee.rotation.x = 2.2 * j + leg.knee.rotation.x * (1 - j);
      }
      for (const arm of this.arms) {
        arm.shoulder.rotation.x = -1.4 * j + arm.shoulder.rotation.x * (1 - j);
        arm.elbow.rotation.x = -1.8 * j + arm.elbow.rotation.x * (1 - j);
      }
    } else {
      this.body.rotation.x = 0;
      this.rollSpin = 0;
    }

    // ---- 受击 ----
    if (b.stumble > 0.001) {
      const j = b.stumble;
      const t = s.stumble;
      const w = Math.sin(t * 34) * 0.16;
      this.body.rotation.z = w * j;
      this.arms[0].shoulder.rotation.x = (-2.6 + w) * j;
      this.arms[1].shoulder.rotation.x = (-2.3 - w) * j;
      this.neck.rotation.x = (0.35 + w) * j;
    } else {
      this.body.rotation.z = 0;
    }

    // ---- 换道侧倾 ----
    this.body.rotation.z += (s.laneTilt - this.body.rotation.z) * Math.min(1, dt * 10);

    // 脚步声
    const sp = this.phase % (Math.PI * 2);
    if (sp < this._lastStepPhase) {
      this._stepSide *= -1;
      if (b.run > 0.6 && s.grounded && s.footstep) s.footstep(this._stepSide > 0);
    }
    this._lastStepPhase = sp;
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }
  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
  }
}
