// 世界环境：夜空、轨道、枕木、灯柱、围墙、楼群、隧道 —— 全部程序化，循环复用
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG, COLORS } from './config.js';

const TMP = new THREE.Matrix4();
const TMP_Q = new THREE.Quaternion();
const TMP_P = new THREE.Vector3();
const TMP_S = new THREE.Vector3(1, 1, 1);

function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- 贴图 ----------
function ballastTexture() {
  return canvasTexture([128, 128], (g, w, h) => {
    g.fillStyle = '#181b24'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 20 + Math.random() * 36;
      g.fillStyle = `rgb(${v},${v - 2},${v + 6})`;
      const s = 1 + Math.random() * 2.4;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
  }, { repeat: [10, 80] });
}

function graffitiTexture(seed) {
  return canvasTexture([256, 128], (g, w, h) => {
    g.fillStyle = '#20242e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 30},${24 + Math.random() * 30},${34 + Math.random() * 40},0.5)`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 26, 0, Math.PI * 2);
      g.fill();
    }
    const tags = ['git push -f', '// TODO', '404', '赶车!', 'while(true)', 'BUG 现场', 'no promise', 'sudo rm', '末班 2min'];
    const colors = ['#f5b83d', '#ff8a3d', '#37b8a6', '#e8f0ff', '#ff5d6c'];
    let x = 14;
    let i = seed * 3;
    while (x < w - 40) {
      const txt = tags[i % tags.length]; i++;
      g.save();
      g.translate(x, 20 + Math.random() * (h - 60));
      g.rotate((Math.random() - 0.5) * 0.24);
      g.font = `bold ${16 + Math.random() * 12}px monospace`;
      g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      g.globalAlpha = 0.85;
      g.fillText(txt, 0, 0);
      g.restore();
      x += 60 + Math.random() * 60;
    }
  });
}

function windowTexture() {
  return canvasTexture([128, 256], (g, w, h) => {
    g.fillStyle = '#0d111c'; g.fillRect(0, 0, w, h);
    const cols = 8, rows = 20, pw = w / cols, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rnd = Math.random();
        let color;
        if (rnd < 0.42) color = '#ffca7a';
        else if (rnd < 0.58) color = '#9fd0ff';
        else color = '#131826';
        g.fillStyle = color;
        g.globalAlpha = rnd < 0.58 ? (0.5 + Math.random() * 0.5) : 1;
        g.fillRect(c * pw + pw * 0.22, r * ph + ph * 0.24, pw * 0.56, ph * 0.44);
      }
    }
    g.globalAlpha = 1;
  });
}

function glowTexture() {
  return canvasTexture([128, 128], (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, 'rgba(255,246,216,1)');
    rg.addColorStop(0.25, 'rgba(255,214,140,0.55)');
    rg.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
}

function moonTexture() {
  return canvasTexture([256, 256], (g, w, h) => {
    // 柔边月盘
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, 'rgba(255,246,220,1)');
    rg.addColorStop(0.82, 'rgba(255,244,212,1)');
    rg.addColorStop(0.97, 'rgba(255,240,200,0.5)');
    rg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    g.fill();
    // 环形山
    g.fillStyle = 'rgba(214,196,160,0.55)';
    const craters = [[0.36, 0.3, 26], [0.6, 0.55, 18], [0.45, 0.68, 13], [0.68, 0.28, 10], [0.3, 0.55, 8], [0.55, 0.4, 7]];
    for (const [cx, cy, r] of craters) {
      g.beginPath();
      g.arc(cx * w, cy * h, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ---------- 轨道床（合并几何） ----------
function buildTrackBed(segLen) {
  const parts = [];
  const bed = new THREE.BoxGeometry(7.6, 0.1, segLen);
  bed.translate(0, -0.06, 0);
  parts.push(bed);
  for (const lx of CFG.lanes) {
    for (let z = -segLen / 2 + 0.75; z < segLen / 2; z += 1.5) {
      const sl = new THREE.BoxGeometry(2.0, 0.07, 0.3);
      sl.translate(lx, 0.0, z);
      parts.push(sl);
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

function buildRails(segLen) {
  const parts = [];
  for (const lx of CFG.lanes) for (const off of [-0.78, 0.78]) {
    const r = new THREE.BoxGeometry(0.1, 0.16, segLen);
    r.translate(lx + off, 0.03, 0);
    parts.push(r);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

function buildStrips(segLen) {
  const parts = [];
  for (const ex of [-3.45, -1.15, 1.15, 3.45]) {
    const s = new THREE.BoxGeometry(0.09, 0.04, segLen);
    s.translate(ex, 0.013, 0);
    parts.push(s);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

// ---------- 灯柱 + 围墙（合并几何，两侧共用） ----------
function buildSideProps(segLen) {
  const parts = [];
  const wall = new THREE.BoxGeometry(0.24, 1.2, segLen);
  wall.translate(0, 0.6, 0);
  parts.push(wall);
  const col = new THREE.BoxGeometry(0.42, 5.6, 0.42);
  col.translate(0, 2.8, 0);
  parts.push(col);
  const arm = new THREE.BoxGeometry(0.9, 0.16, 0.16);
  arm.translate(-0.45, 5.5, 0);
  parts.push(arm);
  const lampBox = new THREE.BoxGeometry(0.5, 0.12, 0.34);
  lampBox.translate(-0.85, 5.42, 0);
  parts.push(lampBox);
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.playerZ = 0;

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildTracks();
    this._buildSides();
    this._buildBuildings();
    this._buildCityGlow();
    this._buildTunnels();
  }

  // ---------- 夜空 ----------
  _buildSky() {
    const geo = new THREE.SphereGeometry(800, 20, 14);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(COLORS.skyTop) },
        bottom: { value: new THREE.Color(COLORS.skyBottom) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom;
        varying float vH;
        void main() {
          float t = smoothstep(-0.08, 0.5, vH);
          gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    // 星星
    const N = 650;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.12 + Math.random() * 0.85;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 700;
      pos[i * 3 + 1] = y * 700;
      pos[i * 3 + 2] = Math.sin(a) * r * 700;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfe0ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false,
    }));
    this.group.add(this.stars);

    // 月亮 + 光晕
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(30, 32),
      new THREE.MeshBasicMaterial({ map: moonTexture(), color: COLORS.moon, fog: false, transparent: true })
    );
    this.moon.position.set(-260, 240, 560);
    this.moon.lookAt(0, 4, 0);
    this.group.add(this.moon);
    const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff3d0, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    moonGlow.scale.set(280, 280, 1);
    moonGlow.position.copy(this.moon.position);
    this.group.add(moonGlow);
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x35507e, 0x0e1220, 1.15));
    const moonLight = new THREE.DirectionalLight(0x8fb2ff, 1.0);
    moonLight.position.set(-40, 70, 30);
    this.scene.add(moonLight);
    // 相机侧补光（把角色从暗背景里拉出来）
    const fill = new THREE.DirectionalLight(0x9db8e8, 0.45);
    fill.position.set(30, 25, -20);
    this.scene.add(fill);
    // 跟随玩家的暖色路灯
    this.playerLamp = new THREE.PointLight(0xffb46b, 30, 48, 1.8);
    this.scene.add(this.playerLamp);
    // 末班车方向的冷光
    this.goalLight = new THREE.PointLight(0xbfe9ff, 90, 240, 1.6);
    this.scene.add(this.goalLight);
  }

  // ---------- 地面 ----------
  _buildGround() {
    const geo = new THREE.PlaneGeometry(220, 1400);
    this.groundTex = ballastTexture();
    const mat = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.07, 500);
    this.ground = ground;
    this.group.add(ground);
  }

  // ---------- 轨道段 ----------
  _buildTracks() {
    const SEG = CFG.segLength;
    const bedGeo = buildTrackBed(SEG);
    const railGeo = buildRails(SEG);
    const stripGeo = buildStrips(SEG);
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x55493c, roughness: 0.85, metalness: 0.4 });
    const railMat = new THREE.MeshStandardMaterial({ color: COLORS.rail, roughness: 0.28, metalness: 0.9 });
    const stripMat = new THREE.MeshStandardMaterial({
      color: COLORS.safetyStrip, roughness: 0.55, metalness: 0.1,
      emissive: COLORS.safetyStrip, emissiveIntensity: 0.55,
    });
    this.segments = [];
    this.railSegments = [];
    this.stripSegments = [];
    for (let i = 0; i < CFG.segCount; i++) {
      const bed = new THREE.Mesh(bedGeo, bedMat);
      const rails = new THREE.Mesh(railGeo, railMat);
      const strips = new THREE.Mesh(stripGeo, stripMat);
      bed.position.z = rails.position.z = strips.position.z = i * SEG;
      this.group.add(bed, rails, strips);
      this.segments.push(bed);
      this.railSegments.push(rails);
      this.stripSegments.push(strips);
    }
  }

  // ---------- 围墙 + 灯柱 ----------
  _buildSides() {
    const SEG = CFG.segLength;
    const sideGeo = buildSideProps(SEG);
    const graffitis = [graffitiTexture(0), graffitiTexture(1), graffitiTexture(2)];
    const lampFaceGeo = new THREE.BoxGeometry(0.44, 0.06, 0.3);
    const lampFaceMat = new THREE.MeshStandardMaterial({ color: COLORS.lamp, emissive: COLORS.lamp, emissiveIntensity: 2.8 });
    const lampGlowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const lampGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xffc98a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    // 墙脚引导灯带
    const stripGeo = new THREE.BoxGeometry(0.05, 0.06, SEG);
    const stripMat2 = new THREE.MeshStandardMaterial({
      color: COLORS.safetyStrip, emissive: COLORS.safetyStrip, emissiveIntensity: 0.8,
    });
    this.sideMeshes = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < CFG.segCount; i++) {
        const holder = new THREE.Group();
        const wallMat = new THREE.MeshStandardMaterial({
          map: graffitis[(i + (sx > 0 ? 1 : 0)) % 3], roughness: 0.9,
        });
        const wall = new THREE.Mesh(sideGeo, wallMat);
        wall.position.x = sx * 6.1;
        const lampFace = new THREE.Mesh(lampFaceGeo, lampFaceMat);
        lampFace.position.set(sx * 5.25, 5.36, 0);
        const lampGlow = new THREE.Mesh(lampGlowGeo, lampGlowMat);
        lampGlow.position.set(sx * 5.25, 5.3, 0);
        const baseStrip = new THREE.Mesh(stripGeo, stripMat2);
        baseStrip.position.set(sx * 5.95, 0.14, 0);
        holder.add(wall, lampFace, lampGlow, baseStrip);
        holder.position.z = i * SEG;
        this.group.add(holder);
        this.sideMeshes.push(holder);
      }
    }
  }

  // ---------- 两侧楼群 ----------
  _buildBuildings() {
    const COUNT = 26;
    const SPAN = 260;
    const bldGeo = new THREE.BoxGeometry(1, 1, 1);
    bldGeo.translate(0, 0.5, 0);
    const winTex = windowTexture();
    this.bldRows = [];
    for (const sx of [-1, 1]) {
      const mat = new THREE.MeshStandardMaterial({
        map: winTex, roughness: 0.9, metalness: 0.05,
        emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.7,
      });
      const inst = new THREE.InstancedMesh(bldGeo, mat, COUNT);
      inst.frustumCulled = false;
      const data = [];
      for (let i = 0; i < COUNT; i++) {
        data.push({
          x: sx * (16 + Math.random() * 30),
          z: -SPAN / 2 + (i / COUNT) * SPAN + Math.random() * 8,
          w: 9 + Math.random() * 14,
          h: 12 + Math.random() * 46,
          d: 9 + Math.random() * 14,
        });
      }
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(inst);
      this.bldRows.push({ inst, data, COUNT, SPAN });
      this._layoutBuildings();
    }
  }

  // ---------- 天际线光污染 ----------
  _buildCityGlow() {
    const geo = new THREE.PlaneGeometry(340, 90);
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xff9a52, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.cityGlows = [];
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(sx * 90, 26, 240);
      this.group.add(m);
      this.cityGlows.push(m);
    }
  }

  _layoutBuildings() {
    for (const row of this.bldRows) {
      for (let i = 0; i < row.COUNT; i++) {
        const b = row.data[i];
        TMP_P.set(b.x, 0, b.z);
        TMP_S.set(b.w, b.h, b.d);
        TMP.compose(TMP_P, TMP_Q, TMP_S);
        row.inst.setMatrixAt(i, TMP);
      }
      row.inst.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- 隧道 ----------
  _buildTunnels() {
    this.tunnels = [];
    const tunnelLen = 44;
    const SPACING = 260;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1e2a, roughness: 0.95 });
    const stripMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffd9a0, emissiveIntensity: 2.4 });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.6, tunnelLen), wallMat);
        wall.position.set(sx * 7.0, 1.8, 0);
        g.add(wall);
      }
      // 半圆拱顶（thetaStart=π/2 使弧顶朝上）
      const arch = new THREE.Mesh(
        new THREE.CylinderGeometry(7.2, 7.2, tunnelLen, 20, 1, true, Math.PI / 2, Math.PI),
        wallMat
      );
      arch.rotation.x = Math.PI / 2;
      arch.scale.y = 0.82;
      arch.position.y = 3.6;
      g.add(arch);
      for (let k = -1; k <= 1; k++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 3), stripMat);
        strip.position.set(0, 6.6, k * 14);
        g.add(strip);
      }
      g.position.z = 400 + i * SPACING;
      this.group.add(g);
      this.tunnels.push(g);
    }
  }

  // ---------- 主循环 ----------
  update(dt, playerZ) {
    const advance = playerZ - this.playerZ;
    this.playerZ = playerZ;

    // 道砟贴图滚动
    this.groundTex.offset.y -= advance * 0.04;
    // 地面跟随玩家（贴图滚动提供速度感）
    this.ground.position.z = playerZ + 400;

    // 轨道/围墙回收
    const SEG = CFG.segLength;
    const total = SEG * CFG.segCount;
    for (const m of this.segments) if (m.position.z < playerZ - SEG) m.position.z += total;
    for (const m of this.railSegments) if (m.position.z < playerZ - SEG) m.position.z += total;
    for (const m of this.stripSegments) if (m.position.z < playerZ - SEG) m.position.z += total;
    for (const m of this.sideMeshes) if (m.position.z < playerZ - SEG) m.position.z += total;
    // 楼群回收
    for (const row of this.bldRows) {
      let changed = false;
      for (let i = 0; i < row.COUNT; i++) {
        const b = row.data[i];
        if (b.z < playerZ - 60) {
          b.z += row.SPAN;
          b.h = 12 + Math.random() * 46;
          b.w = 9 + Math.random() * 14;
          b.d = 9 + Math.random() * 14;
          changed = true;
        }
      }
      if (changed) this._layoutBuildings();
    }
    // 隧道回收
    for (const t of this.tunnels) if (t.position.z < playerZ - 120) t.position.z += 260 * 3;
    // 灯光跟随
    this.playerLamp.position.set(0, 5.2, playerZ + 6);
    this.goalLight.position.set(0, 7, CFG.goalDistance);
    // 天空跟随玩家
    this.sky.position.z = playerZ;
    this.stars.position.z = playerZ;
    this.moon.position.z = playerZ + 560;
    // 光污染跟随
    for (const g of this.cityGlows) g.position.z = playerZ + 240;
  }

  reset() {
    this.playerZ = 0;
    this.segments.forEach((m, i) => m.position.z = i * CFG.segLength);
    this.railSegments.forEach((m, i) => m.position.z = i * CFG.segLength);
    this.stripSegments.forEach((m, i) => m.position.z = i * CFG.segLength);
    this.sideMeshes.forEach((m, i) => m.position.z = i * CFG.segLength);
    for (const row of this.bldRows) {
      row.data.forEach((b, i) => {
        b.z = -130 + (i / row.COUNT) * row.SPAN + Math.random() * 8;
      });
    }
    this._layoutBuildings();
    this.tunnels.forEach((t, i) => t.position.z = 400 + i * 260);
  }
}
