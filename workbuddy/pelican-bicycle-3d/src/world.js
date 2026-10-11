// world.js —— 天空 / 光照 / 地面 / 会滚动位移的路面与路边景物
//
// 车永远停在原点，是"世界在往后退"：路面用纹理 offset 滚动，
// 路边物体线性平移并循环回收，远山用 0.12 倍视差。

import * as THREE from 'three';
import { PAL } from './core.js';
import { treePrims, rockPrims, bushPrims } from './model.js';
import { GROUND_SPEED } from './rig.js';

const WRAP = 110;          // 路边景物的循环跨度
const ROAD_TILE = 4;       // 路面纹理一格 = 4 个世界单位

/* ── 画布纹理 ─────────────────────────────────────── */
function canvasTex(w, h, draw, filter) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (filter === 'nearest') {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
  } else {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return t;
}

function grassTex(filter) {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = PAL.grass; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.6;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = PAL.grassLo;
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.fillRect(Math.round(x), Math.round(y), 6, 3);
    }
  }, filter);
}

function roadTex(filter) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = PAL.road; g.fillRect(0, 0, w, h);
    // 路肩
    g.fillStyle = PAL.roadEdge;
    g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12);
    // 边线（画粗一点，远处 mip 衰减后仍看得见）
    g.fillStyle = PAL.roadLine;
    g.fillRect(0, 20, w, 11); g.fillRect(0, h - 31, w, 11);
    // 中央虚线：一格内画一段，首尾相接才能无缝循环
    g.fillRect(14, h / 2 - 8, 122, 16);
    // 颗粒
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] < 190) continue;
      const n = (Math.random() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, filter);
}

function skyTex() {
  return canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0.00, '#eaf6ff');
    grd.addColorStop(0.18, '#cfe9fb');
    grd.addColorStop(0.45, '#9ad2f2');
    grd.addColorStop(0.78, '#6db6e8');
    grd.addColorStop(1.00, '#4f9fdc');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, 'linear');
}

function sunTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0.00, 'rgba(255,255,240,1)');
    grd.addColorStop(0.16, 'rgba(255,238,170,1)');
    grd.addColorStop(0.34, 'rgba(255,214,120,0.55)');
    grd.addColorStop(1.00, 'rgba(255,206,110,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, 'linear');
}

/* ── 主构建 ───────────────────────────────────────── */
export function buildWorld(scene, builder, material, mode) {
  const pixel = mode === 'voxel';
  const filt = pixel ? 'nearest' : 'linear';

  scene.fog = new THREE.Fog(pixel ? 0xbfe0f2 : 0xcfe6f5, 46, 155);

  /* 天空球 */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false })
  );
  scene.add(sky);

  /* 太阳：方向和主光一致，避免"影子方向和太阳方向对不上" */
  const sunDir = new THREE.Vector3(0.56, 0.70, 0.44).normalize();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  sun.position.copy(sunDir).multiplyScalar(190);
  sun.scale.setScalar(72);
  scene.add(sun);

  /* 光照：主光从右上前方，天空/地面半球光补色 */
  const key = new THREE.DirectionalLight(0xfff0d4, pixel ? 2.0 : 2.7);
  key.position.set(9, 11, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(pixel ? 1024 : 2048, pixel ? 1024 : 2048);
  key.shadow.camera.left = -13; key.shadow.camera.right = 13;
  key.shadow.camera.top = 13; key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 1; key.shadow.camera.far = 45;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  // 天光压低一点，否则 ACES 下整体发灰、对比度不够
  scene.add(new THREE.HemisphereLight(0xa9d8ff, 0x6f9448, pixel ? 1.10 : 0.72));
  const rim = new THREE.DirectionalLight(0xd8ecff, pixel ? 0.30 : 0.55);
  rim.position.copy(sunDir).multiplyScalar(20);
  scene.add(rim);
  // 从反侧补一点点冷光，把暗面拉出层次
  const fill = new THREE.DirectionalLight(0xbcd8f0, pixel ? 0.25 : 0.42);
  fill.position.set(-7, 4, -8);
  scene.add(fill);

  /* 草地 */
  const gt = grassTex(filt);
  gt.repeat.set(140, 140);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ map: gt, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /* 路面（整体左移 2 个单位，让车骑在右车道而非中线上） */
  const rt = roadTex(filt);
  rt.repeat.set(400 / ROAD_TILE, 1);
  rt.anisotropy = 8;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 7.6),
    new THREE.MeshStandardMaterial({ map: rt, roughness: 0.96, metalness: 0 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.014, -2.0);
  road.receiveShadow = true;
  scene.add(road);

  /* 路边景物 */
  const props = [];
  const kinds = [
    { prims: treePrims(), n: 26, z: [7, 46], s: [0.75, 1.5] },
    { prims: bushPrims(), n: 22, z: [6, 30], s: [0.8, 1.5] },
    { prims: rockPrims(), n: 18, z: [6, 34], s: [0.7, 1.6] },
  ];
  for (const k of kinds) {
    const geo = builder(k.prims);
    const im = new THREE.InstancedMesh(geo, material, k.n);
    im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const items = [];
    for (let i = 0; i < k.n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      items.push({
        x: -WRAP / 2 + Math.random() * WRAP,
        z: side * (k.z[0] + Math.random() * (k.z[1] - k.z[0])),
        s: k.s[0] + Math.random() * (k.s[1] - k.s[0]),
        ry: Math.random() * Math.PI * 2,
      });
    }
    props.push({ im, items, m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), sc: new THREE.Vector3() });
    scene.add(im);
  }

  /* 远山：0.12 倍视差 */
  const hillGeo = builder([{ k: 0, p: [0, 0, 0], r: [1, 1, 1], c: PAL.hillFar }]);
  const hills = [];
  for (let i = 0; i < 26; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const rx = 26 + Math.random() * 40;
    const m = new THREE.Mesh(hillGeo, new THREE.MeshStandardMaterial({
      color: Math.random() < 0.5 ? PAL.hillFar : PAL.hillNear, roughness: 1, fog: true,
    }));
    m.position.set(-WRAP * 2 + Math.random() * WRAP * 4,
                   -rx * 0.42 + Math.random() * 3,
                   side * (78 + Math.random() * 62));
    m.scale.set(rx, rx * (0.34 + Math.random() * 0.22), rx);
    m.rotation.y = Math.random() * Math.PI;
    hills.push({ m, sp: 0.12, wrap: WRAP * 4 });
    scene.add(m);
  }

  /* ── 每帧滚动 ─────────────────────────────────── */
  function update(t, dt) {
    const dx = GROUND_SPEED * dt;
    rt.offset.x += dx / ROAD_TILE;

    for (const P of props) {
      for (let i = 0; i < P.items.length; i++) {
        const it = P.items[i];
        it.x -= dx;
        if (it.x < -WRAP / 2) it.x += WRAP;
        P.p.set(it.x, 0, it.z);
        P.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry);
        P.sc.setScalar(it.s);
        P.m.compose(P.p, P.q, P.sc);
        P.im.setMatrixAt(i, P.m);
      }
      P.im.instanceMatrix.needsUpdate = true;
    }

    for (const h of hills) {
      h.m.position.x -= dx * h.sp;
      if (h.m.position.x < -h.wrap / 2) h.m.position.x += h.wrap;
    }
  }

  update(0, 0);
  return { update, key, sky, sun };
}
