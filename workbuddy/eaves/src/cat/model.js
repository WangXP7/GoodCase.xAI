/**
 * model.js —— 程序化猫模型（零外部资产，纯几何构建）
 *
 * 依据：裁决 RUL-2（≤20,000 三角面，视觉精度为准）、美术圣经 §4.1（体型比例）、
 *       §4.3（情绪形态）、§4.4（毛发 = 纯法线贴图烘焙）、§4.5（虹膜 #5A8F7A 薄荷绿）、
 *       §4.8（爪垫/胡须/尾巴细节）、附录 B/§7（morph 配额 —— 本 MVP 以骨骼 + shader 通道实现）
 *
 * ┌─ 硬约束 ─────────────────────────────────────────────────────────────────┐
 * │ · Three.js r172；`import ... from 'three'`（importmap 由主入口配置）        │
 * │ · 三角面 ≤ 20,000（buildCat 打印真实面数；超出即失败）                       │
 * │ · 100% 程序化；禁止加载任何 .glb/.gltf/图片                                │
 * │ · 只用平滑图元（Sphere/Circle/Cylinder/Torus/Lathe），禁止 BoxGeometry     │
 * │ · 单位 = 1 米；成年短毛家猫：鼻→尾根 ≈ 0.46 m，躯干顶 ≈ 0.28 m              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 坐标 / 层级（冻结契约 —— animator.js 与 poses.js 依赖）──────────────────┐
 * │ 原点 (0,0,0) 在**地面**、躯干正下方；+Y 上；+Z 前（鼻尖方向）；−X 左、+X 右。│
 * │ 模型建于**站立中立姿**：除尾巴外，所有关节旋转 = 0；姿态数据是相对它的绝对目标。  │
 * │ 尾巴预置一条向后平放的松弛曲线（仅为裸模型观感），animator 每帧整体覆盖。        │
 * │                                                                          │
 * │ group → root → body ─┬─ chest    （躯干网格；animator 缩放 chest 做呼吸）   │
 * │                      ├─ neck → head ─┬─ earL / earR                      │
 * │                      │               ├─ eyeL/eyeR → pupilL/pupilR        │
 * │                      │               ├─ jaw                              │
 * │                      │               └─ whiskerL / whiskerR              │
 * │                      ├─ legFL → kneeFL （腿分两节，可折膝）                 │
 * │                      ├─ legFR → kneeFR                                   │
 * │                      ├─ legBL → kneeBL                                   │
 * │                      ├─ legBR → kneeBR                                   │
 * │                      └─ tailSegments[0] → [1] → … → [7]                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 关于尾巴：链沿**局部 +Y** 构建、初始旋转为 0，因此**裸模型尾巴竖直向上**是
 *    预期行为 —— 尾巴形状全部由 animator 的 tailCurve 驱动（尾巴 = 情绪核心通道）。
 */

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

/* ============================================================================
 * 一、色板（严格取自美术圣经 §2.1 与 §4.4/§4.5/§4.8，不引入表外颜色）
 * ========================================================================== */

export const PALETTE = Object.freeze({
  fur: 0xE8B894,        // 奶茶 C07（猫身主色 —— 美术 §4.4 "单色 PBR"）
  furLight: 0xF0D8A8,   // 浅奶油 C08（胸/吻/下巴）
  innerEar: 0xF8C8A4,   // 桃粉 A00（耳内）
  pawPad: 0xF8C8A4,     // 桃粉 A00（肉垫）
  nose: 0xE89A7C,       // 落日橘 A01
  mouth: 0x8A6A5A,      // 口腔阴影
  iris: 0x5A8F7A,       // ★ 薄荷绿 C03（MVP 锁定虹膜色，美术 §4.5）
  pupil: 0x141210,
  eyeWhite: 0xF2EDE4,
  highlight: 0xFFFFFF,
  whisker: 0xF5EFE3,
});

/** 关键体型（米）—— 与美术 §4.1 的 3:5:2 / 1:1.2 / 1:2.5 / 22% 对齐 */
export const DIM = Object.freeze({
  torsoTop: 0.28,          // 躯干顶高
  noseToTailBase: 0.46,    // 鼻 → 尾根
  headW: 0.144,
  earHeight: 0.072,        // ear : head ≈ 1 : 2.5
  eyeDia: 0.038,           // eye : headW ≈ 26%（略放大以便读情绪）
  tailLen: 0.28,
  tailRadius: 0.024,       // 尾径 : 身径 ≈ 0.4
});

/** 关节枢轴的世界坐标（米）—— 一切网格偏移以此为准，保证层级自洽 */
const PIVOT = Object.freeze({
  root: { x: 0, y: 0, z: 0 },
  body: { x: 0, y: 0.185, z: -0.005 },
  chest: { x: 0, y: 0.185, z: -0.005 },     // 与 body 同位（呼吸专用枢轴）
  neck: { x: 0, y: 0.215, z: 0.105 },
  head: { x: 0, y: 0.240, z: 0.160 },
  earL: { x: -0.046, y: 0.300, z: 0.170 },
  earR: { x: 0.046, y: 0.300, z: 0.170 },
  eyeL: { x: -0.031, y: 0.262, z: 0.222 },
  eyeR: { x: 0.031, y: 0.262, z: 0.222 },
  pupilL: { x: -0.031, y: 0.262, z: 0.222 },
  pupilR: { x: 0.031, y: 0.262, z: 0.222 },
  jaw: { x: 0, y: 0.230, z: 0.228 },
  whiskerL: { x: -0.030, y: 0.226, z: 0.250 },
  whiskerR: { x: 0.030, y: 0.226, z: 0.250 },
  legFL: { x: -0.050, y: 0.165, z: 0.110 },
  legFR: { x: 0.050, y: 0.165, z: 0.110 },
  legBL: { x: -0.056, y: 0.175, z: -0.110 },
  legBR: { x: 0.056, y: 0.175, z: -0.110 },
  kneeFL: { x: -0.052, y: 0.090, z: 0.114 },
  kneeFR: { x: 0.052, y: 0.090, z: 0.114 },
  kneeBL: { x: -0.058, y: 0.095, z: -0.106 },
  kneeBR: { x: 0.058, y: 0.095, z: -0.106 },
  tail0: { x: 0, y: 0.205, z: -0.165 },
});

const TAIL_SEG_LEN = 0.035;   // 8 段 × 0.035 = 0.28 m

/* ============================================================================
 * 二、几何工具（全部返回 BufferGeometry；三角面数 = 由参数可精确推导）
 * ========================================================================== */

const V2 = (x, y) => new THREE.Vector2(x, y);

/** 椭球：由单位球缩放而来（法线由 applyMatrix4 正确处理） */
function ellipsoid(rx, ry, rz, wSeg = 20, hSeg = 14) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.scale(rx, ry, rz);
  return g;
}

/** 圆盘（虹膜/瞳孔/高光） */
function disc(r, seg = 16) {
  return new THREE.CircleGeometry(r, seg);
}

/** 圆柱（胡须；openEnded 省掉端盖三角面） */
function cyl(rt, rb, h, seg = 6, openEnded = true) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, openEnded);
}

/** 圆环弧（嘴线） */
function torusArc(r, tube, radSeg = 6, tubSeg = 10, arc = Math.PI) {
  return new THREE.TorusGeometry(r, tube, radSeg, tubSeg, arc);
}

/** 旋转体（耳朵 —— 用外轮廓线绕 Y 轴旋转成锥壳，再压扁成片状耳） */
function lathe(pts, seg = 20) {
  return new THREE.LatheGeometry(pts.map((p) => V2(p[0], p[1])), seg);
}

/** 把几何体从 pivot 的局部空间放置到"以 world 为中心" */
function place(geo, world, pivot) {
  geo.translate(world.x - pivot.x, world.y - pivot.y, world.z - pivot.z);
  return geo;
}

/** 合并一组几何体为单个 BufferGeometry（属性不一致时安全降级为第一个） */
function merge(list) {
  const ok = list.filter((g) => g && g.attributes && g.attributes.position);
  if (ok.length === 0) return null;
  if (ok.length === 1) return ok[0];
  const m = mergeGeometries(ok, false);
  if (!m) {
    if (typeof console !== 'undefined') console.warn('[cat/model] mergeGeometries 失败，降级为单几何体');
    return ok[0];
  }
  return m;
}

/* ============================================================================
 * 三、程序化毛发贴图（canvas → CanvasTexture；Node 环境下自动禁用）
 * ========================================================================== */

/** 小型确定性 PRNG（仅用于贴图噪声；业务随机一律走 core/rng.js） */
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** 可平铺的 value noise（格点索引取模 → 无缝） */
function tileNoise(size, grid, rand) {
  const lattice = new Float32Array(grid * grid);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const at = (ix, iy) => lattice[((iy % grid) + grid) % grid * grid + (((ix % grid) + grid) % grid)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * grid, y = v * grid;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

/**
 * 程序化毛发法线贴图：细碎不规则起伏 + 沿体轴的毛流拉丝（美术 §4.4 方案 ④）。
 * @returns {THREE.CanvasTexture|null}
 */
export function makeFurNormalTexture(size = 256, seed = 1234) {
  if (typeof document === 'undefined') return null;
  const rand = lcg(seed);
  const n1 = tileNoise(size, 24, rand);      // 粗起伏（毛簇）
  const n2 = tileNoise(size, 64, rand);      // 细起伏（毛丝）
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = (u, v) => n1(u, v) * 0.65 + n2(u, v) * 0.35;
  const step = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // 中心差分求梯度 → 法线；沿 Y 拉丝（毛流向）降低 u 方向权重
      const hx = (h((u + step) % 1, v) - h((u - step + 1) % 1, v)) * 0.75;
      const hy = (h(u, (v + step) % 1) - h(u, (v - step + 1) % 1)) * 0.40;
      const nx = -hx * 3.2, ny = -hy * 3.2, nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  return tex;
}

/**
 * 程序化毛色 AO 卡斑贴图（"有几块深斑"，美术 §4.4）。
 * @returns {THREE.CanvasTexture|null}
 */
export function makeFurAlbedoTexture(size = 256, seed = 99) {
  if (typeof document === 'undefined') return null;
  const rand = lcg(seed);
  const n = tileNoise(size, 10, rand);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const base = { r: 0xE8, g: 0xB8, b: 0x94 };
  const dark = { r: 0xB8, g: 0x94, b: 0x76 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.pow(n(x / size, y / size), 1.4);   // 低对比度斑块
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(base.r * (1 - t) + dark.r * t);
      img.data[i + 1] = Math.round(base.g * (1 - t) + dark.g * t);
      img.data[i + 2] = Math.round(base.b * (1 - t) + dark.b * t);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

/* ============================================================================
 * 四、材质
 * ========================================================================== */

function buildMaterials(opts) {
  const furNormal = opts.textures ? makeFurNormalTexture(256, opts.seed) : null;
  const furAlbedo = opts.textures ? makeFurAlbedoTexture(256, opts.seed + 7) : null;

  const std = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0, ...extra,
  });

  const fur = std(opts.furColor != null ? opts.furColor : PALETTE.fur, 0.85, {
    map: furAlbedo || null,
    normalMap: furNormal || null,
  });
  if (fur.normalMap) fur.normalScale.set(0.6, 0.6);

  const materials = {
    fur,
    furLight: std(PALETTE.furLight, 0.85),
    innerEar: std(PALETTE.innerEar, 0.75),
    pawPad: std(PALETTE.pawPad, 0.70),
    nose: std(PALETTE.nose, 0.50),
    mouth: std(PALETTE.mouth, 0.60),
    iris: std(opts.irisColor != null ? opts.irisColor : PALETTE.iris, 0.35, {
      emissive: new THREE.Color(opts.irisColor != null ? opts.irisColor : PALETTE.iris).multiplyScalar(0.18),
    }),
    pupil: std(PALETTE.pupil, 0.15),
    eyeWhite: std(PALETTE.eyeWhite, 0.30),
    highlight: std(PALETTE.highlight, 0.10, { emissive: new THREE.Color(PALETTE.highlight), emissiveIntensity: 0.7 }),
    whisker: std(PALETTE.whisker, 0.90),
  };
  return materials;
}

/* ============================================================================
 * 五、构建
 * ========================================================================== */

/**
 * 程序化生成一只猫。
 * @param {object} [opts]
 * @param {number} [opts.seed]        贴图噪声种子
 * @param {number} [opts.furColor]    主体毛色（默认 #E8B894）
 * @param {number} [opts.irisColor]   虹膜色（默认 #5A8F7A，MVP 锁定）
 * @param {boolean}[opts.textures]    是否生成程序化贴图（Node 下自动禁用）
 * @param {boolean}[opts.verbose]     是否 console.info 面数
 * @returns {{group,root,parts,joints,materials,triangleCount,dispose}}
 */
export function buildCat(opts = {}) {
  const o = {
    seed: 1234,
    textures: typeof document !== 'undefined',
    verbose: true,
    ...opts,
  };

  const materials = buildMaterials(o);

  /* ---- 层级（Object3D 枢轴） ---- */
  const group = new THREE.Group();
  group.name = 'Cat';

  const joints = {};
  const mk = (name, parent, world, pivotOf) => {
    const obj = new THREE.Object3D();
    obj.name = name;
    const base = pivotOf || PIVOT[name];
    obj.position.set(world.x - base.x, world.y - base.y, world.z - base.z);
    parent.add(obj);
    joints[name] = obj;
    return obj;
  };

  joints.root = new THREE.Object3D(); joints.root.name = 'root';
  group.add(joints.root);

  const body = mk('body', joints.root, PIVOT.body, PIVOT.root);
  const chest = mk('chest', body, PIVOT.body, PIVOT.body);          // 与 body 同位（breathing 专用）
  const neck = mk('neck', body, PIVOT.neck, PIVOT.body);
  const head = mk('head', neck, PIVOT.head, PIVOT.neck);
  const jaw = mk('jaw', head, PIVOT.jaw, PIVOT.head);
  const earL = mk('earL', head, PIVOT.earL, PIVOT.head);
  const earR = mk('earR', head, PIVOT.earR, PIVOT.head);
  const eyeL = mk('eyeL', head, PIVOT.eyeL, PIVOT.head);
  const eyeR = mk('eyeR', head, PIVOT.eyeR, PIVOT.head);
  const pupilL = mk('pupilL', eyeL, PIVOT.eyeL, PIVOT.eyeL);
  const pupilR = mk('pupilR', eyeR, PIVOT.eyeR, PIVOT.eyeR);
  const whiskerL = mk('whiskerL', head, PIVOT.whiskerL, PIVOT.head);
  const whiskerR = mk('whiskerR', head, PIVOT.whiskerR, PIVOT.head);

  const legs = {};
  for (const s of ['FL', 'FR', 'BL', 'BR']) {
    const hip = mk(`leg${s}`, body, PIVOT[`leg${s}`], PIVOT.body);
    const knee = mk(`knee${s}`, hip, PIVOT[`knee${s}`], PIVOT[`leg${s}`]);
    legs[s] = { hip, knee };
  }

  // 尾巴：8 段链（沿局部 +Y）
  const tailSegments = [];
  let tailParent = body;
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Object3D();
    seg.name = `tail${i}`;
    if (i === 0) {
      seg.position.set(PIVOT.tail0.x - PIVOT.body.x, PIVOT.tail0.y - PIVOT.body.y, PIVOT.tail0.z - PIVOT.body.z);
    } else {
      seg.position.set(0, TAIL_SEG_LEN, 0);
    }
    tailParent.add(seg);
    tailSegments.push(seg);
    tailParent = seg;
  }
  joints.tailSegments = tailSegments;

  /* ---- 网格 ---- */
  const parts = {};
  const allMeshes = [];

  /** 在 pivot 下挂一个合并网格 */
  const attach = (pivot, pivotWorld, geoList, material, key) => {
    const geo = merge(geoList);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.name = key || 'part';
    mesh.position.set(0, 0, 0);
    mesh.frustumCulled = false;
    pivot.add(mesh);
    allMeshes.push(mesh);
    if (key) parts[key] = mesh;
    return mesh;
  };

  const P = PIVOT;
  const W = (x, y, z) => ({ x, y, z });

  /* ===== 躯干（chest pivot）===== */
  {
    const list = [];
    list.push(place(ellipsoid(0.085, 0.095, 0.155, 32, 24), W(0, 0.190, -0.010), P.chest)); // 躯干主体
    list.push(place(ellipsoid(0.078, 0.088, 0.080, 24, 18), W(0, 0.205, 0.120), P.chest)); // 前胸
    list.push(place(ellipsoid(0.088, 0.092, 0.092, 24, 18), W(0, 0.200, -0.135), P.chest)); // 后臀
    attach(chest, P.chest, list, materials.fur, 'body');
    // 前胸浅色块（破开单色轮廓）
    attach(chest, P.chest, [place(ellipsoid(0.058, 0.062, 0.070, 20, 14), W(0, 0.178, 0.146), P.chest)], materials.furLight, 'brisket');
  }

  /* ===== 颈（neck pivot）===== */
  attach(neck, P.neck, [place(ellipsoid(0.050, 0.055, 0.055, 20, 14), W(0, 0.222, 0.124), P.neck)], materials.fur, 'neck');

  /* ===== 头（head pivot）===== */
  {
    const list = [];
    list.push(place(ellipsoid(0.072, 0.068, 0.070, 36, 26), W(0, 0.255, 0.185), P.head)); // 颅
    list.push(place(ellipsoid(0.032, 0.026, 0.028, 16, 12), W(-0.030, 0.228, 0.243), P.head)); // 左颊
    list.push(place(ellipsoid(0.032, 0.026, 0.028, 16, 12), W(0.030, 0.228, 0.243), P.head));  // 右颊
    list.push(place(ellipsoid(0.024, 0.019, 0.020, 12, 10), W(-0.032, 0.283, 0.212), P.head)); // 左眉弓
    list.push(place(ellipsoid(0.024, 0.019, 0.020, 12, 10), W(0.032, 0.283, 0.212), P.head));  // 右眉弓
    attach(head, P.head, list, materials.fur, 'head');
    // 吻部（浅色）
    attach(head, P.head, [place(ellipsoid(0.050, 0.036, 0.044, 22, 16), W(0, 0.233, 0.245), P.head)], materials.furLight, 'muzzle');
    // 鼻
    attach(head, P.head, [place(ellipsoid(0.014, 0.010, 0.011, 12, 8), W(0, 0.247, 0.286), P.head)], materials.nose, 'nose');
    // 嘴上两条弧线（猫的 "w" 形）
    {
      const a = place(torusArc(0.026, 0.0032, 6, 12, Math.PI * 0.85), W(-0.016, 0.228, 0.268), P.head);
      a.rotateZ(Math.PI * 0.12);
      const b = place(torusArc(0.026, 0.0032, 6, 12, Math.PI * 0.85), W(0.016, 0.228, 0.268), P.head);
      b.rotateZ(Math.PI - Math.PI * 0.12);
      attach(head, P.head, [a, b], materials.mouth, 'mouth');
    }
  }

  /* ===== 下巴（jaw pivot —— 张嘴时随下颌旋转）===== */
  attach(jaw, P.jaw, [place(ellipsoid(0.030, 0.020, 0.024, 14, 10), W(0, 0.208, 0.256), P.jaw)], materials.furLight, 'chin');

  /* ===== 耳（earL / earR pivot）===== */
  for (const [key, pivot, sgn] of [['earL', earL, -1], ['earR', earR, 1]]) {
    const base = P[key];
    const outer = lathe([[0.040, 0], [0.034, 0.030], [0.020, 0.055], [0.002, 0.072]], 24);
    outer.scale(1, 1, 0.42);
    place(outer, base, base);
    outer.rotateZ(sgn * 0.34);   // 外展
    outer.rotateX(0.12);         // 略后倾
    const inner = lathe([[0.030, 0.004], [0.024, 0.028], [0.012, 0.048], [0.002, 0.060]], 18);
    inner.scale(1, 1, 0.30);
    place(inner, { x: base.x, y: base.y + 0.002, z: base.z + 0.007 }, base);
    inner.rotateZ(sgn * 0.34);
    inner.rotateX(0.12);
    attach(pivot, base, [outer], materials.fur, key);
    attach(pivot, base, [inner], materials.innerEar, key === 'earL' ? 'earLInner' : 'earRInner');
  }

  /* ===== 眼（eyeL/eyeR → pupilL/pupilR）===== */
  for (const [eyeKey, pupilKey, pivot, sgn] of [
    ['eyeL', 'pupilL', eyeL, -1], ['eyeR', 'pupilR', eyeR, 1],
  ]) {
    const base = P[eyeKey];
    // 眼球（眼白）
    attach(pivot, base, [place(ellipsoid(0.019, 0.019, 0.017, 20, 14), base, base)], materials.eyeWhite, eyeKey);
    // 虹膜：贴在眼球外前侧、朝外偏转
    const iris = disc(0.0158, 20);
    place(iris, { x: base.x + sgn * 0.0045, y: base.y, z: base.z + 0.0152 }, base);
    iris.rotateY(sgn * 0.30);
    attach(pivot, base, [iris], materials.iris, eyeKey === 'eyeL' ? 'irisL' : 'irisR');
    // 高光
    const hi = disc(0.0032, 8);
    place(hi, { x: base.x + sgn * 0.0062, y: base.y + 0.0060, z: base.z + 0.0180 }, base);
    hi.rotateY(sgn * 0.30);
    attach(pivot, base, [hi], materials.highlight, eyeKey === 'eyeL' ? 'highlightL' : 'highlightR');
    // 瞳孔（竖瞳圆盘；由 animator 缩放 pupilL/R.scale 做扩张/收缩）
    const pup = disc(0.0085, 16);
    pup.scale(0.55, 1.0, 1.0);          // 基准竖瞳
    place(pup, { x: base.x + sgn * 0.0058, y: base.y, z: base.z + 0.0168 }, P[pupilKey]);
    pup.rotateY(sgn * 0.30);
    attach(joints[pupilKey], P[pupilKey], [pup], materials.pupil, pupilKey);
  }

  /* ===== 胡须（每侧 6 根 + 2 根眉须）===== */
  for (const [key, pivot, sgn] of [['whiskerL', whiskerL, -1], ['whiskerR', whiskerR, 1]]) {
    const base = P[key];
    const list = [];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) - 0.5;                    // -0.5 … 0.5
      const g = cyl(0.0003, 0.0012, 0.058, 5, true);    // 细锥形
      g.rotateZ(Math.PI / 2);                            // 沿 +X 伸展
      g.rotateZ(sgn * (t * 0.55));                       // 扇形张开
      g.rotateY(sgn * (0.55 + t * 0.15));                // 向侧前方
      g.rotateZ(-0.55 - Math.abs(t) * 0.25);             // 微微下垂
      place(g, base, base);
      list.push(g);
    }
    for (let i = 0; i < 2; i++) {                        // 眉须
      const g = cyl(0.0003, 0.0010, 0.040, 5, true);
      g.rotateZ(Math.PI / 2);
      g.rotateZ(sgn * (i * 0.35 - 0.18));
      g.rotateY(sgn * 0.30);
      g.rotateZ(0.65);                                   // 向上
      place(g, { x: base.x, y: base.y + 0.055, z: base.z - 0.020 }, base);
      list.push(g);
    }
    const mesh = attach(pivot, base, list, materials.whisker, key);
    if (mesh) { mesh.castShadow = false; mesh.receiveShadow = false; }
  }

  /* ===== 四肢（hip → knee，两节可折）===== */
  for (const s of ['FL', 'FR', 'BL', 'BR']) {
    const hip = legs[s].hip; const knee = legs[s].knee;
    const hipW = P[`leg${s}`]; const kneeW = P[`knee${s}`];
    const midThigh = { x: (hipW.x + kneeW.x) / 2, y: (hipW.y + kneeW.y) / 2 + 0.004, z: (hipW.z + kneeW.z) / 2 };
    const isFront = s[0] === 'F';
    // 大腿 / 上臂
    attach(hip, hipW, [place(ellipsoid(0.030, 0.045, 0.032, 16, 12), midThigh, hipW)], materials.fur, `leg${s}`);
    // 小腿 + 爪 + 趾 + 肉垫
    const list = [];
    const footY = 0.026;
    const lowerMid = { x: (kneeW.x + kneeW.x) / 2, y: (kneeW.y + footY) / 2, z: kneeW.z + (isFront ? 0.004 : -0.004) };
    list.push(place(ellipsoid(0.020, 0.038, 0.021, 14, 10), lowerMid, kneeW));                 // 小腿
    const pawW = { x: kneeW.x, y: footY, z: kneeW.z + (isFront ? 0.014 : -0.010) };
    list.push(place(ellipsoid(0.026, 0.018, 0.033, 16, 12), pawW, kneeW));                    // 爪
    for (let t = -1; t <= 1; t++) {                                                            // 三趾
      list.push(place(ellipsoid(0.009, 0.008, 0.011, 8, 6), { x: pawW.x + t * 0.014, y: footY - 0.004, z: pawW.z + 0.026 }, kneeW));
    }
    attach(knee, kneeW, list, materials.fur, `knee${s}`);
    // 肉垫（四脚朝天时可见）
    attach(knee, kneeW, [place(ellipsoid(0.013, 0.006, 0.016, 10, 8), { x: pawW.x, y: footY - 0.014, z: pawW.z + 0.004 }, kneeW)], materials.pawPad, `pad${s}`);
  }

  /* ===== 尾巴（8 段，每段一段胶囊状椭球）===== */
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const rr = Math.max(0.010, DIM.tailRadius * (1 - t * 0.6));
    const seg = tailSegments[i];
    const geo = ellipsoid(rr * 0.9, TAIL_SEG_LEN * 0.62, rr * 0.9, 10, 8);
    geo.translate(0, TAIL_SEG_LEN * 0.5, 0);
    const mesh = new THREE.Mesh(geo, materials.fur);
    mesh.castShadow = true; mesh.frustumCulled = false;
    mesh.name = `tailSeg${i}`;
    seg.add(mesh);
    allMeshes.push(mesh);
    parts.tailSegments = parts.tailSegments || [];
    parts.tailSegments.push(mesh);
  }
  // 静止中立姿：尾巴向后平放的松弛曲线。
  // ⚠️ 这是唯一"非零初值"的关节组 —— animator 每帧用 poses.tailCurve 的整体角度**覆盖**它，
  //    因此不影响姿态语义；预置只为让"未经 animator 的裸模型"也像一只猫。
  for (let i = 0; i < 8; i++) {
    tailSegments[i].rotation.set(i === 0 ? -1.45 : 0.06, 0, 0);
  }

  /* ---- 面数统计 ---- */
  let triangleCount = 0;
  for (const m of allMeshes) {
    const g = m.geometry;
    if (!g) continue;
    triangleCount += g.index ? Math.floor(g.index.count / 3) : Math.floor((g.attributes.position ? g.attributes.position.count : 0) / 3);
  }
  if (o.verbose && typeof console !== 'undefined') {
    console.info(`[cat/model] 程序化猫：${triangleCount} 三角面（预算 ≤ 20000，RUL-2）`);
  }

  /* ---- 释放 ---- */
  const dispose = () => {
    const seenGeo = new Set(); const seenMat = new Set(); const seenTex = new Set();
    group.traverse((obj) => {
      if (obj.geometry && !seenGeo.has(obj.geometry)) { seenGeo.add(obj.geometry); obj.geometry.dispose(); }
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const mat of mats) {
        if (seenMat.has(mat)) continue;
        seenMat.add(mat);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (mat[k] && !seenTex.has(mat[k])) { seenTex.add(mat[k]); mat[k].dispose(); }
        }
        mat.dispose();
      }
    });
    group.clear();
  };

  return {
    group,
    root: joints.root,
    parts,
    joints,
    materials,
    triangleCount,
    dispose,
    /** 供调试：把"站立中立姿"下的枢轴世界坐标还原出来 */
    pivots: PIVOT,
  };
}

export default buildCat;
