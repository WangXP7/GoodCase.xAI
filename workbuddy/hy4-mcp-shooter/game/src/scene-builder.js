/**
 * scene-builder.js — 清单 → 3D 场景
 *
 * 职责：读取 Scene Manifest（纯 JSON），生成 Three.js 场景图 + 碰撞盒列表。
 * 全程序化几何，零外部资产（无贴图、无模型文件、无 CDN 资源）。
 *
 * 每次 Agent 改清单，就整体 dispose 旧的 levelGroup 再重建。
 * 对于几十个道具的规模，重建耗时 < 5ms，完全够用，而且换来"状态永远和清单一致"的确定性。
 */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ *
 *  程序化几何工厂：每种道具类型的形状生成逻辑
 * ------------------------------------------------------------------ */

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.08,
    emissive: new THREE.Color(opts.emissive ?? '#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: opts.flat ?? false,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

/** 给箱子加一圈内嵌边框，廉价的"细节感" */
function addBevel(group, w, h, d, color) {
  const m = mat(color, { roughness: 0.6, metalness: 0.25 });
  const t = 0.12;
  const parts = [
    [w + t, t, d + t, 0, h / 2, 0],
    [w + t, t, d + t, 0, -h / 2, 0],
  ];
  for (const [bw, bh, bd, px, py, pz] of parts) {
    const b = box(bw, bh, bd, m);
    b.position.set(px, py, pz);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }
}

const PROP_BUILDERS = {
  crate(g, { color }) {
    const body = box(2, 2, 2, mat(color, { roughness: 0.85, metalness: 0.05 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    addBevel(g, 2, 2, 2, '#000000');
    return { size: [2, 2, 2], yOffset: 1 };
  },

  container(g, { color }) {
    const body = box(6, 2.6, 2.6, mat(color, { roughness: 0.7, metalness: 0.35 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // 瓦楞纹：一排薄竖条，成本极低但轮廓立刻有信息量
    const rib = mat('#000000', { roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.35 });
    for (let i = -5; i <= 5; i++) {
      const r = box(0.07, 2.62, 2.62, rib);
      r.position.set(i * 0.5, 0, 0);
      g.add(r);
    }
    return { size: [6, 2.6, 2.6], yOffset: 1.3 };
  },

  wall(g, { color }) {
    const body = box(8, 3.2, 0.6, mat(color, { roughness: 0.9, metalness: 0.05 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const cap = box(8.2, 0.18, 0.9, mat('#000000', { roughness: 0.5, metalness: 0.4 }));
    cap.position.y = 1.6;
    cap.castShadow = true;
    g.add(cap);
    return { size: [8, 3.2, 0.8], yOffset: 1.6 };
  },

  pillar(g, { color }) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 6, 8), mat(color, { roughness: 0.85, flat: true }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const cap = box(1.4, 0.3, 1.4, mat('#000000', { roughness: 0.6, metalness: 0.3 }));
    cap.position.y = 3;
    g.add(cap);
    return { size: [1.4, 6, 1.4], yOffset: 3 };
  },

  ramp(g, { color }) {
    // 楔形：手写顶点，比拼 box 更干净
    const w = 6, h = 2, d = 6;
    const geo = new THREE.BufferGeometry();
    const v = new Float32Array([
      -w / 2, 0, d / 2, w / 2, 0, d / 2, w / 2, h, -d / 2, -w / 2, h, -d / 2,   // 斜面
      -w / 2, 0, d / 2, w / 2, 0, d / 2, w / 2, 0, -d / 2, -w / 2, 0, -d / 2,   // 底
      -w / 2, 0, d / 2, -w / 2, h, -d / 2, -w / 2, 0, -d / 2, -w / 2, 0, d / 2, // 左
      w / 2, 0, d / 2, w / 2, 0, -d / 2, w / 2, h, -d / 2, w / 2, 0, d / 2,     // 右
      w / 2, 0, -d / 2, -w / 2, 0, -d / 2, -w / 2, h, -d / 2, w / 2, h, -d / 2, // 背
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.translate(0, -h / 2, 0); // 与其他道具一致：几何体以原点为中心
    geo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19]);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat(color, { roughness: 0.88, flat: true }));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // 斜坡不进 colliders —— 它必须"可以走上去"，走 slope 通道单独处理
    return { size: [w, h, d], yOffset: h / 2, slope: true };
  },

  platform(g, { color }) {
    const body = box(8, 1, 8, mat(color, { roughness: 0.8, metalness: 0.15 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const trim = box(8.3, 0.12, 8.3, mat('#000000', { roughness: 0.4, metalness: 0.5 }));
    trim.position.y = 0.5;
    g.add(trim);
    return { size: [8, 1, 8], yOffset: 0.5 };
  },

  barrel(g, { color }) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 12), mat(color, { roughness: 0.65, metalness: 0.4 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    for (const y of [-0.4, 0.4]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.05, 6, 16), mat('#000000', { roughness: 0.5, metalness: 0.5 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
    return { size: [1.1, 1.6, 1.1], yOffset: 0.8 };
  },

  tower(g, { color }) {
    const body = box(4, 12, 4, mat(color, { roughness: 0.9, metalness: 0.1 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const deck = box(5, 0.4, 5, mat('#000000', { roughness: 0.6, metalness: 0.3 }));
    deck.position.y = 6.2;
    deck.castShadow = true;
    g.add(deck);
    // 窗格发光带 —— 夜景下非常提气氛。
    // emissiveIntensity 必须克制：超过 1.0 就会被 bloom 拉成一团光斑，
    // 细节全部糊掉（渲染出来是"发光的马赛克"而不是"窗户"）。
    const win = mat('#ffb765', { emissive: '#ff9a3c', emissiveIntensity: 1.4, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const w = box(0.25, 0.9, 0.1, win);
      w.position.set(-2.05, -4 + i * 2, 1);
      g.add(w);
      const w2 = w.clone();
      w2.position.x = 2.05;
      g.add(w2);
    }
    return { size: [4, 12, 4], yOffset: 6 };
  },

  antenna(g, { color }) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 14, 6), mat(color, { roughness: 0.5, metalness: 0.7 }));
    mast.position.y = 7;
    mast.castShadow = true;
    g.add(mast);
    for (let i = 1; i <= 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.25, 0.035, 5, 14), mat(color, { roughness: 0.5, metalness: 0.7 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 3 + i * 2.6;
      g.add(ring);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat('#ff3b30', { emissive: '#ff2200', emissiveIntensity: 1.8 }));
    tip.position.y = 14;
    g.add(tip);
    return { size: [0.4, 14, 0.4], yOffset: 0, colliderHeight: 0.4 };
  },

  rock(g, { color }) {
    const geo = new THREE.IcosahedronGeometry(1.5, 1);
    const pos = geo.attributes.position;
    // 顶点噪声位移：让每块石头都不一样
    for (let i = 0; i < pos.count; i++) {
      const n = 0.72 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.55;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.75, pos.getZ(i) * n);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat(color, { roughness: 0.95, flat: true }));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return { size: [3, 2, 3], yOffset: 0.6 };
  },

  tree(g, { color }) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 6, 6), mat(color, { roughness: 0.95, flat: true }));
    trunk.position.y = 3;
    trunk.castShadow = true;
    g.add(trunk);
    const branchMat = mat(color, { roughness: 0.95, flat: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 2.2, 5), branchMat);
      b.position.set(Math.cos(a) * 0.75, 4.2 + (i % 2) * 0.6, Math.sin(a) * 0.75);
      b.rotation.z = Math.cos(a) * 0.9;
      b.rotation.x = -Math.sin(a) * 0.9;
      b.castShadow = true;
      g.add(b);
    }
    return { size: [1, 6, 1], yOffset: 0, colliderHeight: 6, colliderWidth: 0.7 };
  },

  lamp(g, { color }) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 6), mat('#2b3240', { roughness: 0.6, metalness: 0.5 }));
    pole.position.y = 2.5;
    pole.castShadow = true;
    g.add(pole);
    // 灯泡本体：保持克制，靠 PointLight 去照亮地面，而不是靠自发光"糊成一团"
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mat(color, { emissive: color, emissiveIntensity: 1.6, roughness: 0.3 }));
    head.position.y = 5.1;
    g.add(head);
    // decay 用 1.7（而非物理正确的 2）—— 让地面得到更均匀的一片光池，
    // 否则灯下过亮、两步之外全黑，夜里根本看不清路。
    const light = new THREE.PointLight(new THREE.Color(color), 6, 34, 1.7);
    light.position.y = 5.1;
    g.add(light);
    return { size: [0.4, 5, 0.4], yOffset: 0, colliderHeight: 0.4 };
  },
};

/* ------------------------------------------------------------------ *
 *  天空穹顶：三段渐变 + 太阳盘 + 光晕
 * ------------------------------------------------------------------ */

function buildSky(env, sunDir) {
  const geo = new THREE.SphereGeometry(600, 32, 20);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(env.skyTop) },
      uHorizon: { value: new THREE.Color(env.skyHorizon) },
      uGround: { value: new THREE.Color(env.skyGround) },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(env.sunColor) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uTop, uHorizon, uGround, uSunDir, uSunColor;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
          : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.45));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        // 三项叠加各有分工，指数决定"收紧程度"：
        //   320 次方 = 又小又硬的太阳盘本体
        //   26  次方 = 紧贴盘体的大气光晕（指数给低了会糊成一大片白，把天空洗掉）
        //   2.2 次方 = 覆盖半个天空的散射底色
        col += uSunColor * pow(sd, 320.0) * 3.2;
        col += uSunColor * pow(sd, 26.0) * 0.22;
        col += uSunColor * pow(sd, 2.2) * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  地面：标准材质 + 注入式网格线 & 噪声（保留完整 PBR 与雾效）
 * ------------------------------------------------------------------ */

function buildGround(env) {
  // 地面必须远大于竞技场本身：否则从高空俯瞰时会直接看穿到地面之外，
  // 整个关卡像一块悬浮的板子。配合指数雾，远处自然淡出而不是露出硬边缘。
  const size = Math.max(env.arenaSize * 8, 700);
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(env.groundColor),
    roughness: 0.95,
    metalness: 0.03,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAccent = { value: new THREE.Color(env.groundAccent) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform vec3 uAccent;
        float gridLine(vec2 p, float s, float w) {
          vec2 g = abs(fract(p / s - 0.5) - 0.5) / max(fwidth(p / s), vec2(1e-5));
          return 1.0 - min(min(g.x, g.y) / w, 1.0);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 gp = vWPos.xz;
          float g1 = gridLine(gp, 4.0, 1.0);
          float g2 = gridLine(gp, 20.0, 1.6);
          float n = fract(sin(dot(floor(gp * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, g1 * 0.20 + g2 * 0.34 + n * 0.07);
        }`);
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 把斜坡道具转成"可踩踏斜面"描述。
 * 斜坡几何约定：本地 -Z 端为高、+Z 端为低。绕 Y 旋转后重新算世界方向。
 */
function makeSlope(p, info) {
  const [w, h, d] = info.size;
  const th = p.rotation[1] || 0;
  const sx = Math.abs(p.scale[0]), sy = Math.abs(p.scale[1]), sz = Math.abs(p.scale[2]);

  // 上坡方向（单位向量，本地 -Z 绕 Y 旋转）
  const upX = -Math.sin(th), upZ = -Math.cos(th);
  const run = d * sz;                       // 水平投影长度
  const halfH = (h * sy) / 2;
  const baseY = p.position[1] - halfH;      // 低端高度
  const topY = p.position[1] + halfH;       // 高端高度
  const lowX = p.position[0] - (upX * run) / 2;
  const lowZ = p.position[2] - (upZ * run) / 2;

  // 旋转后的水平足迹 AABB（取四个角）
  const hw = (w * sx) / 2, hd = (d * sz) / 2;
  const cos = Math.cos(th), sin = Math.sin(th);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    const x = p.position[0] + cx * cos + cz * sin;
    const z = p.position[2] - cx * sin + cz * cos;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  return { minX, maxX, minZ, maxZ, baseY, topY, upX, upZ, lowX, lowZ, run };
}

/* ------------------------------------------------------------------ *
 *  主构建入口
 * ------------------------------------------------------------------ */

export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
  group.clear();
}

/** 由 environment 计算太阳方向 */
export function sunDirection(env) {
  const az = THREE.MathUtils.degToRad(env.sunAzimuth);
  const el = THREE.MathUtils.degToRad(env.sunElevation);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

/**
 * @returns {{ group: THREE.Group, colliders: THREE.Box3[] }}
 */
export function buildLevel(level) {
  const env = level.environment;
  const group = new THREE.Group();
  group.name = 'levelRoot';
  const colliders = [];
  const slopes = [];

  group.add(buildSky(env, sunDirection(env)));
  group.add(buildGround(env));

  // --- 光照 ---
  const sunDir = sunDirection(env);
  const sun = new THREE.DirectionalLight(new THREE.Color(env.sunColor), env.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  const half = env.arenaSize * 0.7;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  group.add(sun);
  group.add(sun.target);

  // 主环境光用天光（半球光）：上方吃地平线色，下方吃地面色 —— 一次就把天地反弹色做对了。
  // 再叠一盏弱环境光补最暗处，避免背光面死黑。
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(env.skyHorizon),
    new THREE.Color(env.groundColor),
    env.ambientIntensity,
  );
  group.add(hemi);
  // 环境光的系数给到 0.95：平行光照不到的竖直面（箱体侧面、墙内面）
  // 只靠半球光的话，掠射角会让它们压到接近全黑，掩体在暗处完全读不出来。
  const amb = new THREE.AmbientLight(new THREE.Color(env.ambientColor), env.ambientIntensity * 0.95);
  group.add(amb);

  // --- 道具 ---
  for (const p of level.props) {
    const type = PROP_BUILDERS[p.type] ? p.type : 'crate';
    const sub = new THREE.Group();
    const info = PROP_BUILDERS[type](sub, p);

    sub.position.set(p.position[0], p.position[1], p.position[2]);
    sub.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
    sub.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    sub.userData.propId = p.id;
    group.add(sub);

    // 斜坡走专门的 slope 通道（可踩踏斜面），其余实体道具走 AABB 碰撞
    if (info.slope) {
      slopes.push(makeSlope(p, info));
    } else if (p.type !== 'antenna' && p.type !== 'lamp') {
      const cw = (info.colliderWidth ?? info.size[0]) * Math.abs(p.scale[0]);
      const ch = (info.colliderHeight ?? info.size[1]) * Math.abs(p.scale[1]);
      const cd = info.size[2] * Math.abs(p.scale[2]);
      const cy = p.position[1] + (info.yOffset ?? 0) * Math.abs(p.scale[1]);
      const b = new THREE.Box3(
        new THREE.Vector3(p.position[0] - cw / 2, cy - ch / 2, p.position[2] - cd / 2),
        new THREE.Vector3(p.position[0] + cw / 2, cy + ch / 2, p.position[2] + cd / 2),
      );
      // 旋转的道具用包围盒的外扩近似，够用且比 OBB 便宜太多
      if (Math.abs(p.rotation[1]) > 0.01) b.expandByScalar(Math.max(cw, cd) * 0.25);
      colliders.push(b);
    }
  }

  // --- 竞技场边界（四面隐形墙，防止玩家跑出地图）---
  const bound = env.arenaSize / 2;
  const t = 2;
  colliders.push(
    new THREE.Box3(new THREE.Vector3(-bound - t, 0, -bound - t), new THREE.Vector3(bound + t, 40, -bound)),
    new THREE.Box3(new THREE.Vector3(-bound - t, 0, bound), new THREE.Vector3(bound + t, 40, bound + t)),
    new THREE.Box3(new THREE.Vector3(-bound - t, 0, -bound - t), new THREE.Vector3(-bound, 40, bound + t)),
    new THREE.Box3(new THREE.Vector3(bound, 0, -bound - t), new THREE.Vector3(bound + t, 40, bound + t)),
  );

  return { group, colliders, slopes };
}

export { UP };
