// 末班车：目标列车 + 穿越浓雾可见的头灯辉光 + 站台 + 距离提示牌
import * as THREE from 'three';
import { CFG, COLORS } from './config.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowSprite(scale, color, opacity) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

export class LastTrain {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rearZ = CFG.goalDistance;          // 车尾（靠近玩家一侧）
    this._build();
    this._buildPlatform();
    this._buildSign();
  }

  _build() {
    const g = this.group;
    const LEN = 36;
    const frontZ = this.rearZ + LEN;

    // 车体
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.trainBody, roughness: 0.42, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.7, LEN), bodyMat);
    body.position.set(0, 2.5, this.rearZ + LEN / 2);
    g.add(body);
    // 车顶（略窄）
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.5, LEN - 1), bodyMat);
    roof.position.set(0, 3.95, this.rearZ + LEN / 2);
    g.add(roof);
    // 琥珀色腰线
    const stripeMat = new THREE.MeshStandardMaterial({
      color: COLORS.trainStripe, roughness: 0.4,
      emissive: COLORS.trainStripe, emissiveIntensity: 0.35,
    });
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, LEN - 2), stripeMat);
      stripe.position.set(sx * 1.56, 2.9, this.rearZ + LEN / 2);
      g.add(stripe);
    }
    // 车窗灯带
    const winMat = new THREE.MeshStandardMaterial({
      color: COLORS.trainWindow, emissive: COLORS.trainWindow, emissiveIntensity: 1.5, roughness: 0.3,
    });
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, LEN - 3.4), winMat);
      win.position.set(sx * 1.57, 3.25, this.rearZ + LEN / 2);
      g.add(win);
      // 车门
      for (let i = 0; i < 5; i++) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 1.3), stripeMat);
        door.position.set(sx * 1.57, 2.45, this.rearZ + 4 + i * 7);
        g.add(door);
      }
    }
    // 车头（朝 +z）
    const headZ = frontZ;
    const face = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.7, 0.1), bodyMat);
    face.position.set(0, 2.5, headZ + 0.05);
    g.add(face);
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.15, metalness: 0.6 })
    );
    windshield.position.set(0, 3.1, headZ + 0.06);
    g.add(windshield);
    // 目的地牌：「末班 FINAL」
    const signTex = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#141824'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f5b83d';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('末  班', w / 2, h / 2 - 6);
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#ff8a3d';
      ctx.fillText('F I N A L', w / 2, h / 2 + 20);
    });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.42),
      new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9, roughness: 0.6 })
    );
    sign.position.set(0, 2.35, headZ + 0.13);
    g.add(sign);
    // 头灯
    const lampMat = new THREE.MeshStandardMaterial({ color: COLORS.headlight, emissive: COLORS.headlight, emissiveIntensity: 3 });
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14), lampMat);
      lamp.position.set(sx * 1.05, 1.7, headZ + 0.12);
      lamp.rotation.y = Math.PI;
      g.add(lamp);
      // 灯锥
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 26, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff2cf, transparent: true, opacity: 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        })
      );
      beam.rotation.x = Math.PI / 2;
      beam.position.set(sx * 1.05, 1.7, headZ + 13);
      g.add(beam);
    }
    // 车尾（面向玩家）：尾灯 + 后门
    const tailZ = this.rearZ;
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12),
        new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2.4 }));
      tail.position.set(sx * 1.2, 1.6, tailZ - 0.06);
      tail.rotation.y = Math.PI;
      g.add(tail);
    }
    const rearDoor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.08), stripeMat);
    rearDoor.position.set(0, 2.45, tailZ - 0.05);
    g.add(rearDoor);
    // 底盘与轮
    const under = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, LEN - 2),
      new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.9 }));
    under.position.set(0, 0.75, this.rearZ + LEN / 2);
    g.add(under);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.95 });
    for (let i = 0; i < 8; i++) {
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 12), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * 1.45, 0.42, this.rearZ + 3 + i * 4.4);
        g.add(w);
      }
    }

    // ---- 穿越雾气的辉光（永远可见的目标指示） ----
    this.glow = new THREE.Group();
    const bigGlow = glowSprite(46, 0xbfe9ff, 0.55);
    bigGlow.position.set(0, 3.2, frontZ + 4);
    this.glow.add(bigGlow);
    for (const sx of [-1, 1]) {
      const lampGlow = glowSprite(6, 0xfff6d8, 1);
      lampGlow.position.set(sx * 1.05, 1.7, frontZ + 0.3);
      this.glow.add(lampGlow);
    }
    const tailGlow = glowSprite(5, 0xff5040, 0.9);
    tailGlow.position.set(0, 1.6, tailZ - 0.4);
    this.glow.add(tailGlow);
    // 车身氛围光（让整列车在雾中有体积感）
    const bodyGlow = glowSprite(26, 0x9fd0ff, 0.3);
    bodyGlow.position.set(0, 3, this.rearZ + LEN / 2);
    this.glow.add(bodyGlow);
    g.add(this.glow);
  }

  _buildPlatform() {
    // 站台（轨道右侧），玩家跑到车尾时就在站台边
    const p = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 1.05, 46),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 0.85 })
    );
    deck.position.set(5.6, 0.52, this.rearZ + 12);
    p.add(deck);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 46),
      new THREE.MeshStandardMaterial({ color: COLORS.safetyStrip, emissive: COLORS.safetyStrip, emissiveIntensity: 0.4 })
    );
    line.position.set(3.85, 1.06, this.rearZ + 12);
    p.add(line);
    // 站台顶棚
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.14, 46),
      new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.8 })
    );
    roof.position.set(5.6, 4.4, this.rearZ + 12);
    p.add(roof);
    for (let i = 0; i < 4; i++) {
      const pole = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 3.4, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.8 })
      );
      pole.position.set(5.6, 2.7, this.rearZ + 2 + i * 12);
      p.add(pole);
    }
    this.group.add(p);
  }

  _buildSign() {
    // 距离提示牌：循环在玩家前方，显示「末班车 XXXm」
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 3.2, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.8 })
    );
    pole.position.y = 1.6;
    g.add(pole);
    this.signTex = canvasTexture(512, 128, () => { });
    this.signMat = new THREE.MeshStandardMaterial({
      map: this.signTex, emissive: 0xffffff, emissiveMap: this.signTex, emissiveIntensity: 0.85, roughness: 0.7,
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), this.signMat);
    board.position.y = 3.3;
    g.add(board);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.8, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1b1f2c, roughness: 0.8 })
    );
    frame.position.set(0, 3.3, -0.06);
    g.add(frame);
    g.position.set(-5.2, 0, 60);
    this.scene.add(g);
    this.sign = g;
    this._signTimer = 0;
    this._drawSign(0);
  }

  _drawSign(remaining) {
    const canvas = this.signTex.image;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(245,184,61,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9aa6c0';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('末班车', canvas.width / 2, 34);
    ctx.fillStyle = '#f5b83d';
    ctx.font = 'bold 62px monospace';
    const m = Math.max(0, Math.round(remaining));
    ctx.fillText(m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`, canvas.width / 2, 88);
    this.signTex.needsUpdate = true;
  }
  update(dt, playerZ, remaining) {
    // 提示牌循环在玩家前方 60m
    if (this.sign.position.z < playerZ - 10) this.sign.position.z += 120;
    this._signTimer -= dt;
    if (this._signTimer <= 0) {
      this._signTimer = 0.25;
      this._drawSign(remaining);
    }
    // 辉光随距离呼吸
    const t = performance.now() * 0.001;
    this.glow.children[0].material.opacity = 0.4 + Math.sin(t * 2.2) * 0.12;
  }

  reset() {
    this.sign.position.z = 60;
  }
}
