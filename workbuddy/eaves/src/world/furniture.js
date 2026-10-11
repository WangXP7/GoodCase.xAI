/**
 * furniture.js —— 各件家具的程序化几何（零外部资产）
 *
 * 依据：美术圣经 §5.1（房间物件清单）/ §5.2（可交互物三重编码）/ §5.3（时间痕迹）/ §2.1（色板）
 *
 * ┌─ 坐标契约（与猫严格对齐，最重要）────────────────────────────────────────┐
 * │ 每个「带锚点」的 build 函数返回的 Group，其**局部原点 = 该锚点的世界坐标**。 │
 * │ 猫的坐/卧/站面位于局部 y = 0，家具下方结构向局部 −Y 延伸。                 │
 * │ room.js 只需 `g.position.set(ANCHOR_POS[id])`，猫与家具即严丝合缝。        │
 * │ 例：沙发坐垫顶面 local y=0；书架猫所站搁板面 local y=0；洗衣机顶面 local y=0。│
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 性能：每个 builder 内部按 (material, shadowFlags) 分组用 mergeGeometries 合并，
 *       把几十个 primitive 压到少数 mesh 上（ADR-101：中端移动端 draw call ≤ 80）。
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  PALETTE,
  TEXTURE_SIZE_BY_TIER,
  makeFloorTexture,
  makeWallTexture,
  makeFabricTexture,
  makeWoodTexture,
  makeMetalTexture,
  makeRugTexture,
  makePlantTexture,
  makeCeramicTexture,
  makeSunPoolTexture,
  makeLightShaftTexture,
} from './textures.js';

/* ============================================================================
 * 房间基准（由 renderer.createIsoCamera 的等距视锥 + ANCHOR_POS 推导）
 * 相机在 +X/+Z 象限俯瞰 → 可见背墙为 −X 墙与 −Z 墙。
 * ========================================================================== */

export const ROOM = Object.freeze({
  minX: -2.75, maxX: 2.75,
  minZ: -2.0, maxZ: 2.45,
  floorY: 0, wallH: 2.6,
  cx: 0, cz: 0.225,
});

export const WINDOW = Object.freeze({
  zMin: 0.05, zMax: 1.15,        // 洞口 z 范围（世界）
  yBottom: 0.72, yTop: 1.95,     // 洞口 y 范围（世界）; yBottom = windowsill 锚点高度
  wallInnerX: -2.75,
  wallThick: 0.12,
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ============================================================================
 * 几何 / 组装工具
 * ========================================================================== */

/** 由位移/欧拉旋转/缩放构造矩阵 */
function xform(o = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0));
  m.compose(
    new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
    q,
    new THREE.Vector3(o.sx != null ? o.sx : 1, o.sy != null ? o.sy : 1, o.sz != null ? o.sz : 1),
  );
  return m;
}

/** 把一件几何 push 进 parts 列表 */
function add(parts, geometry, material, o = {}) {
  parts.push({ geometry, material, matrix: xform(o), cast: o.cast, receive: o.receive });
}

function safeMerge(geoms) {
  if (geoms.length === 1) return geoms[0];
  try {
    const m = mergeGeometries(geoms, false);
    if (m && m.attributes && m.attributes.position) return m;
  } catch (e) { /* 退化：不合并，分开成多个 mesh */ }
  return null;
}

/**
 * 将 parts 按 (material, shadowFlags) 分组合并成少数 mesh。
 * parts: [{ geometry, material, matrix?, cast?, receive? }]
 */
function assemble(parts) {
  const group = new THREE.Group();
  const byMat = new Map(); // material -> Map(flagsKey -> [geometry])
  for (const p of parts) {
    const fk = (p.cast !== false ? '1' : '0') + (p.receive !== false ? '1' : '0');
    let mm = byMat.get(p.material);
    if (!mm) { mm = new Map(); byMat.set(p.material, mm); }
    let arr = mm.get(fk);
    if (!arr) { arr = []; mm.set(fk, arr); }
    let g = p.geometry.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    g = g.index ? g.toNonIndexed() : g;
    arr.push(g);
  }
  for (const [mat, mm] of byMat) {
    for (const [fk, geoms] of mm) {
      const merged = safeMerge(geoms);
      const list = merged ? [merged] : geoms;
      for (const geo of list) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = fk[0] === '1';
        mesh.receiveShadow = fk[1] === '1';
        group.add(mesh);
      }
    }
  }
  return group;
}

/** 圆角盒：细分立方体 → 焊接 → 顶点向内盒收拢（避免"方块堆"） */
function roundedBox(w, h, d, r = 0.03, seg = 4) {
  const rr = Math.max(0.0008, Math.min(r, Math.min(w, h, d) / 2 - 1e-3));
  let g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  try { const welded = mergeVertices(g, 1e-4); if (welded && welded.attributes.position) g = welded; } catch (e) { /* 焊接失败不致命 */ }
  const ihx = Math.max(0, w / 2 - rr), ihy = Math.max(0, h / 2 - rr), ihz = Math.max(0, d / 2 - rr);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = clamp(v.x, -ihx, ihx), cy = clamp(v.y, -ihy, ihy), cz = clamp(v.z, -ihz, ihz);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) { const s = rr / len; pos.setXYZ(i, cx + dx * s, cy + dy * s, cz + dz * s); }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 叶片：平面沿长度弯曲 + 尖端收窄 */
function leafGeometry(len, width, bend, seg = 6) {
  const g = new THREE.PlaneGeometry(width, len, 1, seg);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + len / 2) / len;                         // 0 基部 → 1 尖端
    const taper = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI * 0.94 + 0.06);
    const z = Math.sin(t * Math.PI * 0.5) * bend;
    pos.setXYZ(i, v.x * taper, v.y, z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** MeshStandardMaterial 工厂（按签名 memoize —— 相同材质全场景共享，便于跨家具合并 draw call） */
const _matCache = new Map();

function stdMat(o = {}) {
  const sig = [
    o.color, o.map ? o.map.uuid : 0, o.normalMap ? o.normalMap.uuid : 0, o.roughnessMap ? o.roughnessMap.uuid : 0,
    o.roughness, o.metalness, o.emissive, o.emissiveIntensity,
    o.transparent ? 1 : 0, o.opacity, o.side, o.depthWrite === false ? 0 : 1,
    o.normalScale, o.blending, o.flatShading ? 1 : 0,
  ].join('|');
  const hit = _matCache.get(sig);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    color: o.color != null ? o.color : 0xffffff,
    map: o.map || null,
    normalMap: o.normalMap || null,
    roughnessMap: o.roughnessMap || null,
    roughness: o.roughness != null ? o.roughness : 0.75,
    metalness: o.metalness != null ? o.metalness : 0.0,
    emissive: o.emissive != null ? o.emissive : 0x000000,
    emissiveIntensity: o.emissiveIntensity != null ? o.emissiveIntensity : 0,
    transparent: !!o.transparent,
    opacity: o.opacity != null ? o.opacity : 1,
    side: o.side != null ? o.side : THREE.FrontSide,
    depthWrite: o.depthWrite !== false,
    blending: o.blending != null ? o.blending : THREE.NormalBlending,
    flatShading: !!o.flatShading,
  });
  if (o.normalMap) { const ns = o.normalScale != null ? o.normalScale : 0.6; m.normalScale.set(ns, ns); }
  _matCache.set(sig, m);
  return m;
}

/** 释放全部缓存材质（room.dispose 调用；假定同时只存在一个房间实例） */
export function clearMaterialCache() {
  for (const m of _matCache.values()) { try { m.dispose(); } catch (e) { /* noop */ } }
  _matCache.clear();
}

function sizeFor(tier) { return TEXTURE_SIZE_BY_TIER[tier] || 512; }

function mkGroup(name, anchorId, label) {
  const g = new THREE.Group();
  g.name = name;
  g.userData = { anchorId, label, interactives: [] };
  return g;
}

/* ============================================================================
 * 房间壳：地板 / 墙 / 踢脚线
 * ========================================================================== */

export function buildFloor(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const w = ROOM.maxX - ROOM.minX, d = ROOM.maxZ - ROOM.minZ;
  const tex = makeFloorTexture({ size: S, rng, repeat: [w / 1.25, d / 1.25] });
  const mat = stdMat({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1.0, metalness: 0.0, normalScale: 0.45 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(ROOM.cx, ROOM.floorY, ROOM.cz);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'floor';
  const g = mkGroup('Floor', null, '地板');
  g.add(mesh);
  return g;
}

export function buildWalls(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const wt = WINDOW.wallThick;
  const H = ROOM.wallH;
  const spanX = ROOM.maxX - ROOM.minX;
  const spanZ = ROOM.maxZ - ROOM.minZ;

  const wallTex = makeWallTexture({ size: S, rng, repeat: [3, 2] });
  const wallMat = stdMat({ color: PALETTE.E01, map: wallTex.map, normalMap: wallTex.normalMap, roughness: 0.94, metalness: 0, normalScale: 0.35 });
  const boardTex = makeWoodTexture(PALETTE.E06, { size: S, rng, repeat: [4, 1] });
  const boardMat = stdMat({ color: PALETTE.E06, map: boardTex.map, normalMap: boardTex.normalMap, roughnessMap: boardTex.roughnessMap, roughness: 0.8, metalness: 0 });

  const parts = [];
  const bx = (x, y, z, sx, sy, sz, cast) => add(parts, new THREE.BoxGeometry(sx, sy, sz), wallMat, { x, y, z, cast: cast !== false, receive: true });

  // —— 北墙（z = minZ），整片
  bx(ROOM.cx, H / 2, ROOM.minZ - wt / 2, spanX + wt, H, wt);

  // —— 西墙（x = minX），开窗洞（4 段）
  const wx = ROOM.minX - wt / 2;
  bx(wx, WINDOW.yBottom / 2, ROOM.cz, wt, WINDOW.yBottom, spanZ);                                    // 洞下
  bx(wx, (WINDOW.yTop + H) / 2, ROOM.cz, wt, H - WINDOW.yTop, spanZ);                               // 洞上
  const leftZ = (ROOM.minZ + WINDOW.zMin) / 2; const leftLen = WINDOW.zMin - ROOM.minZ;
  bx(wx, (WINDOW.yBottom + WINDOW.yTop) / 2, leftZ, wt, WINDOW.yTop - WINDOW.yBottom, Math.max(0.02, leftLen));
  const rightZ = (WINDOW.zMax + ROOM.maxZ) / 2; const rightLen = ROOM.maxZ - WINDOW.zMax;
  bx(wx, (WINDOW.yBottom + WINDOW.yTop) / 2, rightZ, wt, WINDOW.yTop - WINDOW.yBottom, Math.max(0.02, rightLen));

  // —— 踢脚线（墙裙，E06 胡桃）
  const bbH = 0.09, bbT = 0.03;
  add(parts, new THREE.BoxGeometry(bbT, bbH, spanZ), boardMat, { x: ROOM.minX + bbT / 2, y: bbH / 2, z: ROOM.cz, cast: false, receive: true });
  add(parts, new THREE.BoxGeometry(spanX, bbH, bbT), boardMat, { x: ROOM.cx, y: bbH / 2, z: ROOM.minZ + bbT / 2, cast: false, receive: true });

  const g = mkGroup('Walls', null, '墙面');
  g.add(assemble(parts));
  return g;
}

/* ============================================================================
 * 窗 + 窗台（锚点 windowsill）
 * 局部原点 = (−2.4, 0.72, 0.6)；local y=0 为窗台面（猫坐处）
 * ========================================================================== */

export function buildWindowWall(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  // 窗台木面：从墙内面伸入屋内（local x −0.35 → +0.05），顶面 local y=0
  const woodTex = makeWoodTexture(PALETTE.E03, { size: S, rng, repeat: [1, 1] });
  const sillMat = stdMat({ color: PALETTE.E03, map: woodTex.map, normalMap: woodTex.normalMap, roughnessMap: woodTex.roughnessMap, roughness: 0.62, metalness: 0 });
  add(parts, roundedBox(0.40, 0.055, 1.28, 0.012), sillMat, { x: -0.15, y: -0.0275, z: 0 });
  add(parts, roundedBox(0.42, 0.02, 1.30, 0.008), sillMat, { x: -0.14, y: -0.062, z: 0 }); // 台沿小凸唇

  // 窗框（深木）
  const frameTex = makeWoodTexture(PALETTE.E05, { size: S, rng, repeat: [2, 2] });
  const frameMat = stdMat({ color: PALETTE.E05, map: frameTex.map, normalMap: frameTex.normalMap, roughness: 0.6, metalness: 0 });
  const fx = -0.30;
  add(parts, roundedBox(0.10, 0.06, 1.22, 0.012), frameMat, { x: fx, y: 0.035, z: 0 });        // 下框
  add(parts, roundedBox(0.10, 0.07, 1.22, 0.012), frameMat, { x: fx, y: 1.195, z: 0 });       // 上框
  add(parts, roundedBox(0.10, 1.23, 0.07, 0.012), frameMat, { x: fx, y: 0.615, z: -0.515 });  // 左框
  add(parts, roundedBox(0.10, 1.23, 0.07, 0.012), frameMat, { x: fx, y: 0.615, z: 0.515 });   // 右框
  // 十字窗棂
  add(parts, roundedBox(0.06, 1.10, 0.045, 0.008), frameMat, { x: fx - 0.01, y: 0.615, z: 0 }); // 竖棂
  add(parts, roundedBox(0.06, 0.045, 1.05, 0.008), frameMat, { x: fx - 0.01, y: 0.615, z: 0 }); // 横棂

  const g = mkGroup('WindowWall', 'windowsill', '窗台');
  g.add(assemble(parts));

  // 玻璃（半透明，透出窗外的雾白）
  const glassMat = stdMat({
    color: PALETTE.A07, roughness: 0.08, metalness: 0,
    transparent: true, opacity: 0.24, emissive: PALETTE.C08, emissiveIntensity: 0.20, side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.14), glassMat);
  glass.rotation.y = Math.PI / 2;
  glass.position.set(-0.335, 0.615, 0);
  glass.castShadow = false; glass.receiveShadow = false;
  glass.name = 'window_glass';
  g.add(glass);

  // 窗外：远景背板 + 两株树影（季节"无季节"基线：雾白 → 嫩绿）
  const outerMat = stdMat({ color: PALETTE.A07, roughness: 1, metalness: 0, emissive: PALETTE.A07, emissiveIntensity: 0.22, side: THREE.DoubleSide });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.4), outerMat);
  outer.rotation.y = Math.PI / 2;
  outer.position.set(-0.60, 1.0, 0);
  outer.castShadow = false; outer.receiveShadow = false;
  g.add(outer);

  const treeMat = stdMat({ color: PALETTE.A06, roughness: 1, metalness: 0 });
  const treeMat2 = stdMat({ color: PALETTE.A05, roughness: 1, metalness: 0 });
  const t1 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), treeMat);
  t1.position.set(-0.66, 1.15, -0.25); t1.castShadow = false; t1.receiveShadow = false;
  const t2 = new THREE.Mesh(new THREE.SphereGeometry(0.30, 12, 10), treeMat2);
  t2.position.set(-0.68, 0.85, 0.55); t2.castShadow = false; t2.receiveShadow = false;
  g.add(t1, t2);

  // 窗帘（暖纸 E00，聚拢的褶）
  if (quality !== 'low') {
    const curtainTex = makeFabricTexture(PALETTE.E00, { size: S, rng, repeat: [2, 3] });
    const curtainMat = stdMat({ color: PALETTE.E00, map: curtainTex.map, normalMap: curtainTex.normalMap, roughness: 0.95, side: THREE.DoubleSide });
    const cparts = [];
    for (let i = 0; i < 3; i++) {
      const tube = new THREE.CylinderGeometry(0.055, 0.062, 1.42, 12, 1, true, 0, Math.PI * 1.05);
      add(cparts, tube, curtainMat, { x: -0.22, y: 0.63, z: 0.34 - i * 0.085, cast: false, receive: true });
    }
    // 窗帘杆
    const rodMat = stdMat({ color: PALETTE.C06, roughness: 0.5, metalness: 0.55 });
    add(cparts, new THREE.CylinderGeometry(0.012, 0.012, 1.5, 10), rodMat, { x: -0.20, y: 1.36, z: 0, rx: Math.PI / 2 });
    g.add(assemble(cparts));
  }

  // 窗台上的小盆香草（生活痕迹）
  if (quality !== 'low') {
    const potTex = makeCeramicTexture(PALETTE.A02, { size: Math.max(256, S / 2), rng });
    const potMat = stdMat({ color: PALETTE.A02, map: potTex.map, roughnessMap: potTex.roughnessMap, roughness: 0.7 });
    const leafMat = stdMat({ color: PALETTE.A05, map: makePlantTexture(PALETTE.A05, { size: Math.max(128, S / 4), rng }).map, roughness: 0.85, side: THREE.DoubleSide });
    const hparts = [];
    add(hparts, new THREE.CylinderGeometry(0.045, 0.035, 0.075, 14), potMat, { x: -0.20, y: 0.0375, z: -0.42 });
    for (let i = 0; i < 5; i++) {
      add(hparts, leafGeometry(0.11, 0.03, 0.03), leafMat, { x: -0.20, y: 0.09, z: -0.42, rz: (i - 2) * 0.28, ry: i * 1.1 });
    }
    g.add(assemble(hparts));
  }

  // 可交互：窗把手 → verb 'toggle'
  const metalTex = makeMetalTexture(PALETTE.C06, { size: Math.max(128, S / 4), rng });
  const handleMat = stdMat({ color: PALETTE.C06, map: metalTex.map, roughnessMap: metalTex.roughnessMap, roughness: 0.4, metalness: 0.7 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.10, 10), handleMat);
  handle.position.set(-0.225, 0.66, 0.47);
  handle.rotation.z = Math.PI / 2;
  handle.castShadow = true; handle.receiveShadow = true;
  handle.name = 'window_handle';
  g.add(handle);
  g.userData.interactives.push({ id: 'window', verb: 'toggle', mesh: handle });

  return g;
}

/* ============================================================================
 * 沙发（锚点 sofa）—— 猫的常驻点，最用心
 * 局部原点 = (1.6, 0.15, −1.2)；local y=0 = 坐垫顶面；局部地板在 y = −0.15
 * 局部坐标：X = 左右（宽），Z = 进深（前 = −Z，背 = +Z）
 * ========================================================================== */

export function buildSofa(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const fabTex = makeFabricTexture(PALETTE.A04, { size: S, rng, repeat: [2, 2] });
  const fabric = stdMat({ color: PALETTE.A04, map: fabTex.map, normalMap: fabTex.normalMap, roughnessMap: fabTex.roughnessMap, roughness: 0.92, metalness: 0, normalScale: 0.8 });
  const fabricDark = stdMat({ color: PALETTE.A04, map: fabTex.map, normalMap: fabTex.normalMap, roughness: 0.95, metalness: 0, normalScale: 0.8 });
  const woodTex = makeWoodTexture(PALETTE.E04, { size: S, rng, repeat: [2, 1] });
  const wood = stdMat({ color: PALETTE.E04, map: woodTex.map, normalMap: woodTex.normalMap, roughnessMap: woodTex.roughnessMap, roughness: 0.55, metalness: 0 });
  const legWood = stdMat({ color: PALETTE.E05, map: woodTex.map, normalMap: woodTex.normalMap, roughness: 0.5, metalness: 0 });

  // 四条短木腿（低矮现代款：座高 0.15）
  for (const sx of [-0.74, 0.74]) for (const sz of [-0.32, 0.32]) {
    add(parts, roundedBox(0.055, 0.05, 0.055, 0.012), legWood, { x: sx, y: -0.125, z: sz });
  }
  // 底框
  add(parts, roundedBox(1.72, 0.06, 0.86, 0.02), wood, { x: 0, y: -0.07, z: 0 });

  // 两块坐垫（顶面 local y=0）
  for (const cx of [-0.42, 0.42]) {
    add(parts, roundedBox(0.82, 0.11, 0.80, 0.045), fabric, { x: cx, y: -0.055, z: -0.01 });
  }
  // 坐垫缝（压暗的细带）+ 前缘滚边
  add(parts, roundedBox(0.02, 0.095, 0.78, 0.006), fabricDark, { x: 0, y: -0.052, z: -0.01 });
  for (const cx of [-0.42, 0.42]) {
    add(parts, roundedBox(0.82, 0.013, 0.014, 0.005), fabricDark, { x: cx, y: -0.106, z: -0.405 });
  }

  // 靠背（略微后仰）
  add(parts, roundedBox(1.72, 0.56, 0.15, 0.05), fabric, { x: 0, y: 0.27, z: 0.355, rx: -0.07 });
  // 靠背顶卷（圆棍）
  add(parts, new THREE.CylinderGeometry(0.075, 0.075, 1.60, 16), fabric, { x: 0, y: 0.545, z: 0.325, rz: Math.PI / 2 });
  // 两块背垫
  for (const cx of [-0.42, 0.42]) {
    add(parts, roundedBox(0.80, 0.42, 0.13, 0.05), fabric, { x: cx, y: 0.30, z: 0.255, rx: -0.16 });
  }

  // 扶手（木芯 + 布面软垫）
  for (const ax of [-0.79, 0.79]) {
    add(parts, roundedBox(0.15, 0.26, 0.84, 0.03), wood, { x: ax, y: -0.015, z: 0 });
    add(parts, roundedBox(0.185, 0.075, 0.80, 0.035), fabric, { x: ax, y: 0.135, z: 0 });
  }

  // 长期受压的浅色压痕（"沙发压痕"——静态，永不清理）
  add(parts, roundedBox(0.66, 0.006, 0.5, 0.004), fabricDark, { x: -0.15, y: 0.003, z: -0.06 });

  const g = mkGroup('Sofa', 'sofa', '沙发');
  g.add(assemble(parts));

  // 可交互：抱枕（番茄红 C00 —— 美术圣经语义限定「仅抱枕/落日/新鲜食物」）
  const pillowTex = makeFabricTexture(PALETTE.C00, { size: Math.max(256, S / 2), rng, repeat: [2, 2] });
  const pillowMat = stdMat({ color: PALETTE.C00, map: pillowTex.map, normalMap: pillowTex.normalMap, roughness: 0.95, normalScale: 0.9 });
  const pillow = new THREE.Mesh(roundedBox(0.30, 0.30, 0.12, 0.055, 5), pillowMat);
  pillow.position.set(-0.50, 0.165, 0.16);
  pillow.rotation.set(-0.35, 0.28, 0.12);
  pillow.castShadow = true; pillow.receiveShadow = true;
  pillow.name = 'sofa_cushion';
  g.add(pillow);
  g.userData.interactives.push({ id: 'sofa_cushion', verb: 'place', mesh: pillow });

  return g;
}

/* ============================================================================
 * 地毯（锚点 rug）—— 顶面 local y=0
 * ========================================================================== */

export function buildRug(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const tex = makeRugTexture({ size: S, rng, repeat: [1, 1] });
  const mat = stdMat({ color: PALETTE.E02, map: tex.map, normalMap: tex.normalMap, roughness: 0.98, metalness: 0, normalScale: 1.0 });

  const parts = [];
  const geo = new THREE.CylinderGeometry(1.18, 1.18, 0.022, 64);
  add(parts, geo, mat, { y: -0.011, sz: 0.72 });
  const g = mkGroup('Rug', 'rug', '地毯');
  const shell = assemble(parts);
  g.add(shell);

  const rug = shell.children[0];
  rug.name = 'rug_surface';
  g.userData.interactives.push({ id: 'rug', verb: 'place', mesh: rug });
  return g;
}

/* ============================================================================
 * 书架（锚点 shelf）—— local y=0 = 猫所站的搁板顶面；局部地板 y = −1.10
 * ========================================================================== */

export function buildBookshelf(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const woodTex = makeWoodTexture(PALETTE.E04, { size: S, rng, repeat: [2, 2] });
  const wood = stdMat({ color: PALETTE.E04, map: woodTex.map, normalMap: woodTex.normalMap, roughnessMap: woodTex.roughnessMap, roughness: 0.6, metalness: 0 });
  const backMat = stdMat({ color: PALETTE.E05, map: woodTex.map, normalMap: woodTex.normalMap, roughness: 0.72, metalness: 0 });

  const W = 1.00, D = 0.34, TH = 0.03;
  const yBase = -1.10, yTop = 1.30;
  // 侧板
  for (const sx of [-W / 2, W / 2]) add(parts, roundedBox(TH, yTop - yBase, D, 0.008), wood, { x: sx, y: (yTop + yBase) / 2, z: 0 });
  // 背板
  add(parts, roundedBox(W, yTop - yBase, 0.02, 0.006), backMat, { x: 0, y: (yTop + yBase) / 2, z: D / 2 - 0.01 });
  // 搁板（y=0 为猫的栖位）
  const shelfYs = [yBase + TH / 2, -0.55, 0.0, 0.55, 1.10, yTop - TH / 2];
  for (const sy of shelfYs) add(parts, roundedBox(W - TH * 0.6, TH, D - 0.02, 0.006), wood, { x: 0, y: sy, z: -0.01 });

  // 程序化书本：有限色板 → 合并后仅少数 mesh
  const bookColors = [PALETTE.E05, PALETTE.C04, PALETTE.A02, PALETTE.C02, PALETTE.C06, PALETTE.A05];
  const bookMats = bookColors.map((c) => stdMat({ color: c, roughness: 0.82, metalness: 0 }));
  const shelfBookRows = [yBase + TH, -0.55, 0.55, 1.10];
  for (const sy of shelfBookRows) {
    let x = -W / 2 + TH;
    const gap = rng.nextRange(0.05, 0.12);
    x += gap;
    while (x < W / 2 - TH - 0.05) {
      const bw = rng.nextRange(0.028, 0.058);
      const bh = rng.nextRange(0.20, 0.30);
      const bd = D - rng.nextRange(0.08, 0.14);
      const mat = bookMats[rng.nextInt(0, bookMats.length - 1)];
      const lean = rng.nextFloat() < 0.12 ? rng.nextRange(-0.22, 0.22) : 0;
      add(parts, roundedBox(bw, bh, bd, 0.004), mat, { x: x + bw / 2, y: sy + bh / 2, z: 0, rz: lean });
      x += bw + rng.nextRange(0.002, 0.01);
      if (rng.nextFloat() < 0.14) x += rng.nextRange(0.03, 0.07);
    }
  }
  // y=0 栖位只在一端放两三本，给猫留出空间
  let bx = -W / 2 + TH + 0.02;
  for (let i = 0; i < 3; i++) {
    const bw = rng.nextRange(0.03, 0.05), bh = rng.nextRange(0.22, 0.28);
    add(parts, roundedBox(bw, bh, D - 0.12, 0.004), bookMats[rng.nextInt(0, bookMats.length - 1)], { x: bx + bw / 2, y: TH / 2 + bh / 2, z: 0 });
    bx += bw + 0.006;
  }

  const g = mkGroup('Bookshelf', 'shelf', '书架');
  g.add(assemble(parts));

  // 可交互：一本摊开的相册（书架的"翻"入口）→ verb 'journal'
  const albumMat = stdMat({ color: PALETTE.E00, roughness: 0.9 });
  const album = new THREE.Mesh(roundedBox(0.20, 0.035, 0.16, 0.006), albumMat);
  album.position.set(0.18, 0.55 + TH / 2 + 0.02, -0.04);
  album.rotation.y = 0.22;
  album.castShadow = true; album.receiveShadow = true;
  album.name = 'bookshelf_album';
  g.add(album);
  g.userData.interactives.push({ id: 'bookshelf', verb: 'journal', mesh: album });

  // 顶部小摆件（不做交互，纯叙事）
  const deco = [];
  const potMat = stdMat({ color: PALETTE.A02, roughness: 0.7 });
  add(deco, new THREE.CylinderGeometry(0.05, 0.04, 0.09, 12), potMat, { x: -0.25, y: 1.30 + 0.045, z: 0 });
  const leafMat = stdMat({ color: PALETTE.A05, map: makePlantTexture(PALETTE.A05, { size: Math.max(128, S / 4), rng }).map, roughness: 0.85, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) add(deco, leafGeometry(0.10, 0.028, 0.03), leafMat, { x: -0.25, y: 1.39, z: 0, rz: (i - 1.5) * 0.34, ry: i * 1.3 });
  g.add(assemble(deco));

  return g;
}

/* ============================================================================
 * 画架（锚点 easel）—— 局部地板 y=0
 * ========================================================================== */

export function buildEasel(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const woodTex = makeWoodTexture(PALETTE.E04, { size: S, rng, repeat: [1, 2] });
  const wood = stdMat({ color: PALETTE.E04, map: woodTex.map, normalMap: woodTex.normalMap, roughnessMap: woodTex.roughnessMap, roughness: 0.6, metalness: 0 });

  const leg = (x, z, rx, rz, len = 1.5) => add(parts, new THREE.CylinderGeometry(0.018, 0.022, len, 10), wood, { x, y: len / 2 - 0.02, z, rx, rz });
  leg(-0.26, -0.14, 0.10, 0.10);
  leg(0.26, -0.14, 0.10, -0.10);
  leg(0.0, 0.26, -0.22, 0.0, 1.52);
  // 横撑
  add(parts, new THREE.CylinderGeometry(0.014, 0.014, 0.52, 8), wood, { x: 0, y: 0.42, z: -0.10, rz: Math.PI / 2 });
  // 画布托板
  add(parts, roundedBox(0.58, 0.025, 0.10, 0.006), wood, { x: 0, y: 0.60, z: -0.08 });

  const g = mkGroup('Easel', 'easel', '画架');
  g.add(assemble(parts));

  // 画布（可交互 → verb 'place'）
  const canvasMat = stdMat({ color: PALETTE.E00, roughness: 0.95 });
  const canvas = new THREE.Mesh(roundedBox(0.56, 0.72, 0.025, 0.008), canvasMat);
  canvas.position.set(0, 0.98, -0.06);
  canvas.rotation.x = -0.08;
  canvas.castShadow = true; canvas.receiveShadow = true;
  canvas.name = 'easel_canvas';
  g.add(canvas);
  g.userData.interactives.push({ id: 'easel', verb: 'place', mesh: canvas });

  // 画布上的几笔草稿（暖色，非交互）
  const stroke = [];
  const s1 = stdMat({ color: PALETTE.A05, roughness: 0.9 });
  const s2 = stdMat({ color: PALETTE.A01, roughness: 0.9 });
  const s3 = stdMat({ color: PALETTE.C02, roughness: 0.9 });
  add(stroke, roundedBox(0.30, 0.05, 0.004, 0.002), s1, { x: -0.02, y: 0.95, z: -0.076, rz: 0.10 });
  add(stroke, roundedBox(0.22, 0.035, 0.004, 0.002), s2, { x: 0.06, y: 1.02, z: -0.076, rz: -0.06 });
  add(stroke, roundedBox(0.14, 0.03, 0.004, 0.002), s3, { x: -0.10, y: 1.10, z: -0.076, rz: 0.04 });
  g.add(assemble(stroke));

  // 调色盘 + 画笔
  const tools = [];
  const palette = stdMat({ color: PALETTE.E03, roughness: 0.5 });
  add(tools, new THREE.CylinderGeometry(0.11, 0.11, 0.012, 18), palette, { x: -0.22, y: 0.615, z: -0.06 });
  const brushMat = stdMat({ color: PALETTE.E05, roughness: 0.6 });
  add(tools, new THREE.CylinderGeometry(0.006, 0.006, 0.20, 6), brushMat, { x: -0.26, y: 0.62, z: -0.05, rx: 1.1, rz: 0.4 });
  add(tools, new THREE.CylinderGeometry(0.006, 0.006, 0.20, 6), brushMat, { x: -0.18, y: 0.62, z: -0.06, rx: 1.2, rz: -0.5 });
  g.add(assemble(tools));

  return g;
}

/* ============================================================================
 * 洗衣机（锚点 washer）—— local y=0 = 顶面；局部地板 y = −0.92
 * 局部前脸 = −Z
 * ========================================================================== */

export function buildWasher(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const bodyTex = makeMetalTexture(PALETTE.E00, { size: S, rng, repeat: [1, 1] });
  const body = stdMat({ color: PALETTE.E00, map: bodyTex.map, roughnessMap: bodyTex.roughnessMap, roughness: 0.42, metalness: 0.25 });
  const dark = stdMat({ color: PALETTE.A08, roughness: 0.35, metalness: 0.6 });

  // 机身（顶面 local y=0）
  add(parts, roundedBox(0.62, 0.86, 0.60, 0.045, 5), body, { x: 0, y: -0.43, z: 0 });
  // 顶面轻微内凹的盖沿
  add(parts, roundedBox(0.50, 0.02, 0.48, 0.012), body, { x: 0, y: -0.005, z: 0.02 });
  // 支脚
  for (const sx of [-0.24, 0.24]) for (const sz of [-0.22, 0.22]) {
    add(parts, new THREE.CylinderGeometry(0.028, 0.03, 0.06, 10), dark, { x: sx, y: -0.89, z: sz });
  }
  // 控制面板
  add(parts, roundedBox(0.55, 0.15, 0.035, 0.02), body, { x: 0, y: -0.14, z: -0.295 });
  // 旋钮 + 按钮
  add(parts, new THREE.CylinderGeometry(0.038, 0.038, 0.035, 16), dark, { x: -0.17, y: -0.14, z: -0.325, rx: Math.PI / 2 });
  for (let i = 0; i < 3; i++) add(parts, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), dark, { x: -0.02 + i * 0.06, y: -0.16, z: -0.32, rx: Math.PI / 2 });
  // 舱门环
  add(parts, new THREE.TorusGeometry(0.215, 0.032, 10, 30), body, { x: 0, y: -0.50, z: -0.30 });
  // 舱门外圈装饰环
  add(parts, new THREE.TorusGeometry(0.175, 0.012, 8, 26), dark, { x: 0, y: -0.50, z: -0.305 });

  const g = mkGroup('Washer', 'washer', '洗衣机');
  g.add(assemble(parts));

  // 舱门玻璃（可交互 → verb 'toggle'）
  const glassMat = stdMat({
    color: PALETTE.A09, roughness: 0.12, metalness: 0.55,
    transparent: true, opacity: 0.75, emissive: PALETTE.A08, emissiveIntensity: 0.08,
  });
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.02, 28), glassMat);
  door.rotation.x = Math.PI / 2;
  door.position.set(0, -0.50, -0.315);
  door.castShadow = true; door.receiveShadow = true;
  door.name = 'washer_door';
  g.add(door);
  g.userData.interactives.push({ id: 'washer', verb: 'toggle', mesh: door });

  // 内侧滚筒（深色，透过玻璃隐约可见）
  const drum = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), stdMat({ color: PALETTE.E07, roughness: 0.6, metalness: 0.3 }));
  drum.position.set(0, -0.50, -0.335);
  drum.castShadow = false; drum.receiveShadow = false;
  g.add(drum);

  return g;
}

/* ============================================================================
 * 盆栽（锚点 plant）—— 局部地板 y=0
 * ========================================================================== */

export function buildPlant(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const g = mkGroup('Plant', 'plant', '盆栽');
  const parts = [];

  // 花盆（车削）
  const potTex = makeCeramicTexture(PALETTE.A02, { size: S, rng });
  const potMat = stdMat({ color: PALETTE.A02, map: potTex.map, roughnessMap: potTex.roughnessMap, roughness: 0.68, metalness: 0 });
  const profile = [
    new THREE.Vector2(0.001, 0), new THREE.Vector2(0.17, 0),
    new THREE.Vector2(0.19, 0.03), new THREE.Vector2(0.165, 0.26),
    new THREE.Vector2(0.195, 0.29), new THREE.Vector2(0.185, 0.30),
  ];
  add(parts, new THREE.LatheGeometry(profile, 28), potMat, { x: 0, y: 0, z: 0 });
  // 土壤
  add(parts, new THREE.CylinderGeometry(0.16, 0.16, 0.03, 22), stdMat({ color: PALETTE.E07, roughness: 1 }), { x: 0, y: 0.27, z: 0 });
  g.add(assemble(parts));

  // 叶片（多片，角度变化）
  const leafTex = makePlantTexture(PALETTE.A05, { size: Math.max(128, S / 2), rng });
  const leafMat = stdMat({ color: PALETTE.A05, map: leafTex.map, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  const lparts = [];
  const count = quality === 'low' ? 8 : quality === 'high' ? 16 : 12;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.nextRange(-0.15, 0.15);
    const len = rng.nextRange(0.30, 0.52);
    const pitch = rng.nextRange(0.55, 1.05);          // 与竖直方向的夹角
    const ry = a, rz = -Math.PI / 2 + pitch;
    // 先把它竖起再绕 Y 旋转：用 rx 让叶片从竖直向外倒
    add(lparts, leafGeometry(len, rng.nextRange(0.05, 0.09), rng.nextRange(0.05, 0.14)), leafMat,
      { x: 0, y: 0.28, z: 0, ry: a, rx: rz });
  }
  // 几根立起的嫩叶
  for (let i = 0; i < 4; i++) {
    add(lparts, leafGeometry(rng.nextRange(0.22, 0.34), 0.05, 0.06), leafMat, { x: 0, y: 0.28, z: 0, ry: i * 1.6 + 0.4, rx: rng.nextRange(0.15, 0.45) });
  }
  g.add(assemble(lparts));

  return g;
}

/* ============================================================================
 * 厨房台面（锚点 kitchen_counter）—— local y=0 = 台面；局部地板 y = −0.90
 * 局部前脸 = −Z
 * ========================================================================== */

export function buildKitchenCounter(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const paintMat = stdMat({ color: PALETTE.E01, roughness: 0.7, metalness: 0 });
  const woodTex = makeWoodTexture(PALETTE.E03, { size: S, rng, repeat: [2, 1] });
  const topMat = stdMat({ color: PALETTE.E03, map: woodTex.map, normalMap: woodTex.normalMap, roughnessMap: woodTex.roughnessMap, roughness: 0.45, metalness: 0 });
  const metalTex = makeMetalTexture(PALETTE.A08, { size: Math.max(128, S / 2), rng });
  const metal = stdMat({ color: PALETTE.A08, map: metalTex.map, roughnessMap: metalTex.roughnessMap, roughness: 0.3, metalness: 0.8 });
  const gold = stdMat({ color: PALETTE.C06, roughness: 0.4, metalness: 0.65 });

  // 柜体
  add(parts, roundedBox(1.60, 0.80, 0.58, 0.02), paintMat, { x: 0, y: -0.44, z: 0 });
  // 台面
  add(parts, roundedBox(1.70, 0.05, 0.63, 0.012), topMat, { x: 0, y: -0.025, z: 0 });
  // 踢脚
  add(parts, roundedBox(1.50, 0.10, 0.50, 0.01), stdMat({ color: PALETTE.E06, roughness: 0.8 }), { x: 0, y: -0.85, z: 0.02 });
  // 两扇柜门 + 把手
  for (const dx of [-0.36, 0.36]) {
    add(parts, roundedBox(0.70, 0.62, 0.03, 0.012), paintMat, { x: dx, y: -0.46, z: -0.30 });
    add(parts, new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), gold, { x: dx + (dx < 0 ? 0.28 : -0.28), y: -0.30, z: -0.325 });
  }

  // 水槽（沉入台面）：边框 + 内盆
  add(parts, roundedBox(0.52, 0.02, 0.42, 0.01), metal, { x: 0.42, y: -0.004, z: 0.02 });
  add(parts, roundedBox(0.44, 0.16, 0.34, 0.01), stdMat({ color: PALETTE.A07, roughness: 0.28, metalness: 0.7 }), { x: 0.42, y: -0.10, z: 0.02 });
  // 龙头（竖管 + 鹅颈弯）
  add(parts, new THREE.CylinderGeometry(0.016, 0.018, 0.24, 12), metal, { x: 0.42, y: 0.12, z: 0.18 });
  add(parts, new THREE.TorusGeometry(0.07, 0.015, 8, 20, Math.PI), metal, { x: 0.42, y: 0.24, z: 0.18 });
  add(parts, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), metal, { x: 0.42, y: 0.215, z: 0.11 });

  const g = mkGroup('KitchenCounter', 'kitchen_counter', '厨房台面');
  g.add(assemble(parts));

  // 台面小物：杯子、盘子、砧板（生活感）
  const props = [];
  const cupMat = stdMat({ color: PALETTE.E00, roughness: 0.3, metalness: 0 });
  add(props, new THREE.CylinderGeometry(0.035, 0.03, 0.075, 14), cupMat, { x: -0.42, y: 0.04, z: 0.06 });
  add(props, new THREE.TorusGeometry(0.028, 0.007, 8, 14, Math.PI), cupMat, { x: -0.386, y: 0.04, z: 0.06, rx: Math.PI / 2, rz: Math.PI / 2 });
  const plateMat = stdMat({ color: PALETTE.A07, roughness: 0.35 });
  for (let i = 0; i < 2; i++) add(props, new THREE.CylinderGeometry(0.075, 0.075, 0.012, 20), plateMat, { x: -0.10, y: 0.008 + i * 0.014, z: 0.10 });
  const boardMat = stdMat({ color: PALETTE.E04, roughness: 0.6 });
  add(props, roundedBox(0.22, 0.02, 0.30, 0.008), boardMat, { x: 0.42, y: 0.012, z: -0.14 });
  g.add(assemble(props));

  return g;
}

/* ============================================================================
 * 食盆 / 水盆（锚点 bowl）—— 局部地板 y=0
 * ========================================================================== */

export function buildBowls(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const g = mkGroup('Bowls', 'bowl', '食盆');

  // 餐垫
  const mat = stdMat({ color: PALETTE.E06, roughness: 0.95, metalness: 0 });
  const matMesh = new THREE.Mesh(roundedBox(0.52, 0.008, 0.30, 0.05, 4), mat);
  matMesh.position.set(0, 0.004, 0.02);
  matMesh.castShadow = false; matMesh.receiveShadow = true;
  g.add(matMesh);

  // —— 猫粮盆（可交互 → 'offer'）
  const foodTex = makeCeramicTexture(PALETTE.E00, { size: Math.max(128, S / 2), rng });
  const bowlMat = stdMat({ color: PALETTE.E00, map: foodTex.map, roughnessMap: foodTex.roughnessMap, roughness: 0.35, metalness: 0 });
  const foodProfile = [
    new THREE.Vector2(0.001, 0), new THREE.Vector2(0.075, 0),
    new THREE.Vector2(0.10, 0.03), new THREE.Vector2(0.095, 0.062), new THREE.Vector2(0.088, 0.062),
    new THREE.Vector2(0.088, 0.03), new THREE.Vector2(0.07, 0.012),
  ];
  const foodMesh = new THREE.Mesh(new THREE.LatheGeometry(foodProfile, 26), bowlMat);
  foodMesh.position.set(-0.13, 0.008, 0.02);
  foodMesh.castShadow = true; foodMesh.receiveShadow = true;
  foodMesh.name = 'food_bowl';
  g.add(foodMesh);
  g.userData.interactives.push({ id: 'food_bowl', verb: 'offer', mesh: foodMesh });

  // 猫粮颗粒
  const kMat = stdMat({ color: PALETTE.C01, roughness: 0.6 });
  const kparts = [];
  for (let i = 0; i < 7; i++) {
    add(kparts, new THREE.TetrahedronGeometry(rng.nextRange(0.010, 0.016)), kMat, {
      x: -0.13 + rng.nextRange(-0.045, 0.045), y: 0.032 + rng.nextRange(0, 0.012), z: 0.02 + rng.nextRange(-0.04, 0.04),
      rx: rng.nextRange(0, 3), ry: rng.nextRange(0, 3),
    });
  }
  g.add(assemble(kparts));

  // —— 水盆（可交互 → 'refill'）
  const waterTex = makeCeramicTexture(PALETTE.C08, { size: Math.max(128, S / 2), rng });
  const waterBowlMat = stdMat({ color: PALETTE.C08, map: waterTex.map, roughnessMap: waterTex.roughnessMap, roughness: 0.32, metalness: 0 });
  const waterMesh = new THREE.Mesh(new THREE.LatheGeometry(foodProfile, 26), waterBowlMat);
  waterMesh.position.set(0.13, 0.008, 0.02);
  waterMesh.castShadow = true; waterMesh.receiveShadow = true;
  waterMesh.name = 'water_bowl';
  g.add(waterMesh);
  g.userData.interactives.push({ id: 'water_bowl', verb: 'refill', mesh: waterMesh });

  // 水面（半透明）
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.082, 0.082, 0.012, 22),
    stdMat({ color: PALETTE.A08, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.6, emissive: PALETTE.A07, emissiveIntensity: 0.06 }),
  );
  water.position.set(0.13, 0.044, 0.02);
  water.castShadow = false; water.receiveShadow = false;
  g.add(water);

  return g;
}

/* ============================================================================
 * 猫窝（锚点 catbed）—— local y=0 = 软垫顶面
 * ========================================================================== */

export function buildCatbed(opts = {}) {
  const { tier = 'M', rng } = opts;
  const S = sizeFor(tier);
  const parts = [];

  const fabTex = makeFabricTexture(PALETTE.C07, { size: S, rng, repeat: [2, 2] });
  const outer = stdMat({ color: PALETTE.C07, map: fabTex.map, normalMap: fabTex.normalMap, roughnessMap: fabTex.roughnessMap, roughness: 0.96, metalness: 0, normalScale: 0.8 });
  const innerTex = makeFabricTexture(PALETTE.E00, { size: S, rng, repeat: [2, 2] });
  const inner = stdMat({ color: PALETTE.E00, map: innerTex.map, normalMap: innerTex.normalMap, roughness: 0.98, metalness: 0 });

  // 底座 + 外圈软边（圆环）
  add(parts, roundedBox(0.70, 0.07, 0.70, 0.10, 5), outer, { x: 0, y: -0.075, z: 0 });
  add(parts, new THREE.TorusGeometry(0.27, 0.105, 14, 28), outer, { x: 0, y: -0.015, z: 0, rx: Math.PI / 2 });

  const g = mkGroup('Catbed', 'catbed', '猫窝');
  g.add(assemble(parts));

  // 内垫（顶面 local y=0）—— 独立 Mesh，兼作可交互拾取体
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.09, 26), inner);
  cushion.position.set(0, -0.045, 0);
  cushion.castShadow = true; cushion.receiveShadow = true;
  cushion.name = 'catbed_cushion';
  g.add(cushion);
  g.userData.interactives.push({ id: 'catbed', verb: 'place', mesh: cushion });

  // 凹陷的睡痕 + 几根猫毛感（静态写入，不做动画）
  const dent = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 22), stdMat({ color: PALETTE.E02, roughness: 1 }));
  dent.position.set(0.02, -0.002, -0.01);
  dent.castShadow = false; dent.receiveShadow = true;
  dent.name = 'catbed_dent';
  g.add(dent);

  // 搭在窝边的小毯子
  const blanket = new THREE.Mesh(roundedBox(0.34, 0.03, 0.22, 0.012, 4), stdMat({ color: PALETTE.A03, roughness: 1 }));
  blanket.position.set(-0.30, -0.02, 0.16);
  blanket.rotation.y = 0.5;
  blanket.castShadow = true; blanket.receiveShadow = true;
  g.add(blanket);

  return g;
}

/* ============================================================================
 * 环境叙事 · "时间痕迹"（原点 = 房间中心，无锚点）
 * 让屋子看起来有人住：翻开的书、搭着的毛毯、地上一小片阳光、墙角小物件…
 * ========================================================================== */

export function buildAmbience(opts = {}) {
  const { tier = 'M', quality = 'medium', rng } = opts;
  const S = sizeFor(tier);
  const g = mkGroup('Ambience', null, '生活痕迹');
  const r = rng || { nextRange: (a, b) => (a + b) / 2, nextFloat: () => 0.5, nextInt: (a) => a, nextBool: () => true };

  const lowQ = quality === 'low';

  /* —— ① 地上一小片斜射阳光（晨光招牌）—— */
  {
    const pool = makeSunPoolTexture({ size: Math.max(256, S / 2), rng: r });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.7, 1, 1),
      new THREE.MeshBasicMaterial({ map: pool.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -0.42;
    mesh.position.set(-1.55, 0.012, 0.80);
    mesh.renderOrder = 2;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.name = 'sun_pool';
    g.add(mesh);

    if (!lowQ) {
      const shaft = makeLightShaftTexture({ size: Math.max(256, S / 2) });
      const sMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, 1.5, 1, 1),
        new THREE.MeshBasicMaterial({ map: shaft.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22, side: THREE.DoubleSide }),
      );
      sMesh.position.set(-2.35, 0.85, 0.62);
      sMesh.rotation.y = Math.PI / 2;
      sMesh.rotation.x = 0.24;
      sMesh.renderOrder = 3;
      sMesh.castShadow = false; sMesh.receiveShadow = false;
      sMesh.name = 'light_shaft';
      g.add(sMesh);
    }
  }

  /* —— ② 沙发上翻开的书 + 搭着的毛毯 —— */
  {
    const book = [];
    const pageMat = stdMat({ color: PALETTE.E01, roughness: 0.9 });
    const coverMat = stdMat({ color: PALETTE.E05, roughness: 0.75 });
    add(book, roundedBox(0.17, 0.02, 0.24, 0.004), coverMat, { x: 1.42, y: 0.163, z: -0.95, ry: 0.35 });
    add(book, roundedBox(0.16, 0.008, 0.22, 0.003), pageMat, { x: 1.34, y: 0.172, z: -0.95, rz: 0.10, ry: 0.35 });
    add(book, roundedBox(0.16, 0.008, 0.22, 0.003), pageMat, { x: 1.50, y: 0.172, z: -0.95, rz: -0.10, ry: 0.35 });
    // 书签（番茄红细带）
    add(book, roundedBox(0.012, 0.004, 0.16, 0.001), stdMat({ color: PALETTE.C00, roughness: 0.8 }), { x: 1.50, y: 0.178, z: -0.95, ry: 0.35 });
    g.add(assemble(book));
  }
  {
    const fabTex = makeFabricTexture(PALETTE.A03, { size: Math.max(256, S / 2), rng: r, repeat: [2, 2] });
    const blanketMat = stdMat({ color: PALETTE.A03, map: fabTex.map, normalMap: fabTex.normalMap, roughness: 0.98, side: THREE.DoubleSide, normalScale: 0.9 });
    const b = [];
    // 搭在扶手上的毛毯（主体 + 垂下的一角）
    add(b, roundedBox(0.34, 0.05, 0.62, 0.02, 4), blanketMat, { x: 0.80, y: 0.165, z: -1.20, rz: 0.06 });
    add(b, roundedBox(0.30, 0.42, 0.05, 0.02, 4), blanketMat, { x: 0.80, y: -0.02, z: -0.92, rx: 0.06 });
    g.add(assemble(b));
  }

  /* —— ③ 墙角小物件：线团、橡皮小鸭、藤篮、拖鞋 —— */
  {
    const props = [];
    // 线团（薄荷绿 C03 = 玩具"新鲜感"语义）
    add(props, new THREE.SphereGeometry(0.075, 16, 14), stdMat({ color: PALETTE.C03, roughness: 0.95 }), { x: 1.72, y: 0.075, z: 1.16 });
    for (let i = 0; i < 3; i++) add(props, new THREE.TorusGeometry(0.075, 0.012, 8, 20), stdMat({ color: PALETTE.C03, roughness: 0.95 }), { x: 1.72, y: 0.075, z: 1.16, rx: 1.0 + i * 0.6, ry: i * 0.5 });
    // 拖出的一根线
    add(props, new THREE.TorusGeometry(0.16, 0.007, 6, 26, Math.PI * 1.2), stdMat({ color: PALETTE.C03, roughness: 0.95 }), { x: 1.55, y: 0.012, z: 1.30, rx: Math.PI / 2, rz: 0.6 });
    // 橡皮小鸭（姜黄 C01）
    add(props, new THREE.SphereGeometry(0.06, 16, 12), stdMat({ color: PALETTE.C01, roughness: 0.55 }), { x: -1.36, y: 0.05, z: 1.56, sz: 1.25 });
    add(props, new THREE.SphereGeometry(0.036, 14, 12), stdMat({ color: PALETTE.C01, roughness: 0.55 }), { x: -1.36, y: 0.11, z: 1.60 });
    add(props, new THREE.ConeGeometry(0.016, 0.035, 10), stdMat({ color: PALETTE.C00, roughness: 0.6 }), { x: -1.36, y: 0.105, z: 1.645, rx: Math.PI / 2 });
    // 藤编篮（墙角）
    const basket = [];
    add(basket, new THREE.CylinderGeometry(0.19, 0.15, 0.24, 18, 1, true), stdMat({ color: PALETTE.A03, roughness: 0.98, side: THREE.DoubleSide }), { x: -2.44, y: 0.12, z: 2.16 });
    add(basket, new THREE.TorusGeometry(0.19, 0.014, 8, 22), stdMat({ color: PALETTE.E02, roughness: 0.9 }), { x: -2.44, y: 0.24, z: 2.16, rx: Math.PI / 2 });
    add(basket, new THREE.CylinderGeometry(0.15, 0.15, 0.01, 18), stdMat({ color: PALETTE.E05, roughness: 1 }), { x: -2.44, y: 0.005, z: 2.16 });
    g.add(assemble(basket));
    // 拖鞋（卡其 A03）
    for (let i = 0; i < 2; i++) add(props, roundedBox(0.10, 0.035, 0.24, 0.03, 4), stdMat({ color: PALETTE.A03, roughness: 0.95 }), { x: 2.30 + i * 0.13, y: 0.018, z: 0.52, ry: 0.2 * i });
    g.add(assemble(props));
  }

  /* —— ④ 墙上：挂钟 + 日历（北墙 z=minZ，面朝 +Z）—— */
  if (!lowQ) {
    const wall = [];
    const casing = stdMat({ color: PALETTE.E05, roughness: 0.6, metalness: 0 });
    const face = stdMat({ color: PALETTE.E00, roughness: 0.85 });
    const hand = stdMat({ color: PALETTE.E07, roughness: 0.7 });
    add(wall, new THREE.CylinderGeometry(0.155, 0.155, 0.035, 26), casing, { x: 0.95, y: 1.92, z: ROOM.minZ + 0.03, rx: Math.PI / 2 });
    add(wall, new THREE.CylinderGeometry(0.135, 0.135, 0.012, 26), face, { x: 0.95, y: 1.92, z: ROOM.minZ + 0.05, rx: Math.PI / 2 });
    add(wall, roundedBox(0.008, 0.10, 0.006, 0.002), hand, { x: 0.95, y: 1.965, z: ROOM.minZ + 0.058 });
    add(wall, roundedBox(0.075, 0.008, 0.006, 0.002), hand, { x: 0.985, y: 1.92, z: ROOM.minZ + 0.058 });
    // 日历（纸页 + 挂钩）
    add(wall, roundedBox(0.20, 0.26, 0.012, 0.004), stdMat({ color: PALETTE.E00, roughness: 0.95 }), { x: -0.55, y: 1.72, z: ROOM.minZ + 0.03 });
    add(wall, roundedBox(0.20, 0.05, 0.014, 0.004), stdMat({ color: PALETTE.C00, roughness: 0.9 }), { x: -0.55, y: 1.82, z: ROOM.minZ + 0.032 });
    g.add(assemble(wall));
  }

  /* —— ⑤ 猫毛（地毯周边 0.45m 内的细线，白色 + 浅灰）—— */
  {
    const fur = [];
    const n = lowQ ? 4 : quality === 'high' ? 18 : 10;
    const c1 = stdMat({ color: PALETTE.E00, roughness: 0.9 });
    const c2 = stdMat({ color: PALETTE.A07, roughness: 0.9 });
    for (let i = 0; i < n; i++) {
      const a = r.nextFloat() * Math.PI * 2;
      const rad = r.nextRange(0.05, 0.45);
      const x = Math.cos(a) * rad;
      const z = 0.2 + Math.sin(a) * rad * 0.72;
      add(fur, new THREE.BoxGeometry(0.075, 0.0018, 0.0018), r.nextBool(0.5) ? c1 : c2, { x, y: 0.008, z, ry: r.nextFloat() * Math.PI, cast: false, receive: false });
    }
    g.add(assemble(fur));
  }

  return g;
}

export default {
  ROOM, WINDOW, clearMaterialCache,
  buildFloor, buildWalls, buildWindowWall, buildSofa, buildRug, buildBookshelf,
  buildEasel, buildWasher, buildPlant, buildKitchenCounter, buildBowls, buildCatbed,
  buildAmbience,
};
