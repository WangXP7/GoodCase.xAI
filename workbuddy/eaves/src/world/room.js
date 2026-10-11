/**
 * room.js —— 房间组装 + 10 个地点锚 + 可交互物
 *
 * 依据：GDD PH2 §3（锚点承载的行为）/ PH4 UX §4（可发现性 P1–P5）§6（四层反馈 L1）
 *       美术圣经 §5.1（房间清单）§5.2（可交互三重编码）§5.3（时间痕迹）
 *
 * ┌─ 输出契约（键名固定，集成层直接用）──────────────────────────────────────┐
 * │ buildRoom(opts) → { group, anchors, interactables, lights, dispose }        │
 * │   group         整间房的根（位于世界原点，add 到 scene 即可）                │
 * │   anchors       { [anchorId]: { position:Vector3, rotationY:number, name } } │
 * │   interactables [{ id, verb, anchorId, mesh, hitbox }]                      │
 * │   lights        { windowDirection, ambientHint, accentPoints: [] }          │
 * │   dispose()     释放几何 / 材质 / 贴图                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 锚点坐标的**唯一来源**是 src/cat/state.js 的 ANCHOR_POS —— 本文件从该模块 import，
 *    绝不复制第二份坐标。猫在这 10 个锚点之间行走，坐标错位即"猫飘在家具外"。
 */

import * as THREE from 'three';
import { ANCHORS, ANCHOR_POS } from '../cat/state.js';
import { PCG32 } from '../core/rng.js';
import * as F from './furniture.js';
import { disposeTextureCache, PALETTE } from './textures.js';

/* ---- 锚点中文标签（UI / 调试用） ---- */
const ANCHOR_LABELS = {
  sofa: '沙发',
  rug: '地毯',
  windowsill: '窗台',
  shelf: '书架',
  easel: '画架',
  washer: '洗衣机',
  plant: '盆栽',
  kitchen_counter: '厨房台面',
  bowl: '食盆',
  catbed: '猫窝',
};

/**
 * 每个锚点的朝向（弧度）。
 * 约定：各家具的「正面」为局部 −Z；此值让正面朝向房间中心。
 * 例外：windowsill = 0（窗体几何已按 −X 墙洞预置，旋转会偏离墙洞）。
 */
const ANCHOR_ROT = {
  sofa: 2.298,
  rug: 0,
  windowsill: 0,
  shelf: 2.264,
  easel: -2.283,
  washer: 1.116,
  plant: -0.950,
  kitchen_counter: 0.594,
  bowl: -0.446,
  catbed: 1.245,
};

/** 锚点 → 家具 builder（顺序不影响结果） */
const PLACEMENTS = [
  ['sofa', F.buildSofa],
  ['rug', F.buildRug],
  ['windowsill', F.buildWindowWall],
  ['shelf', F.buildBookshelf],
  ['easel', F.buildEasel],
  ['washer', F.buildWasher],
  ['plant', F.buildPlant],
  ['kitchen_counter', F.buildKitchenCounter],
  ['bowl', F.buildBowls],
  ['catbed', F.buildCatbed],
];

/** 热盒放大倍数（PH4 UX-T1：热盒 1.8×；移动端 ≥44px 命中区） */
const HITBOX_SCALE = 1.8;
const HITBOX_MIN = 0.14;

function qualityForTier(tier) {
  return tier === 'H' ? 'high' : tier === 'L' ? 'low' : 'medium';
}

/**
 * 组装整间房。
 * @param {object} [opts]
 * @param {string} [opts.tier='M']        'L' | 'M' | 'H'（决定贴图分辨率与细节密度）
 * @param {PCG32} [opts.rng]              种子化随机流（缺省内部新建，保证确定性）
 * @param {string|number} [opts.quality]  'low'|'medium'|'high' 或 0..1
 * @returns {{group:THREE.Group, anchors:object, interactables:Array, lights:object, dispose:Function}}
 */
export function buildRoom(opts = {}) {
  const tier = opts.tier || 'M';
  const rng = opts.rng || new PCG32(0x5ea1f00d, 0);
  const quality = opts.quality != null ? opts.quality : qualityForTier(tier);

  const group = new THREE.Group();
  group.name = 'Room';

  /* ---- ① 房间壳：地板 / 墙 / 踢脚线（原点 = 房间中心，无锚点） ---- */
  group.add(F.buildFloor({ tier, quality, rng }));
  group.add(F.buildWalls({ tier, quality, rng }));

  /* ---- ①·b 微缩基座 ----
   * 45° 等距下，5.5m 见方的地板投影成 7.78×3.89 的菱形，而相机视野是约 6.7×4.2 的矩形；
   * 菱形在数学上填不满矩形 → 画面四角必然露出背景（实测晨光下是一大片扎眼的米白）。
   * 解法：垫一块远大于房间的深色台面，形成「微缩模型摆在桌上」的观感。
   * 材质刻意比地板深一档，形成层次而非撞色。基座随 group 一起被 dispose() 释放。
   */
  const baseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.E05),   // 咖啡棕
    roughness: 0.92,
    metalness: 0.0,
  });
  const base = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.015;                // 略低于地板，避免 z-fighting
  base.receiveShadow = true;
  base.name = 'Base';
  group.add(base);

  /* ---- ② 10 件带锚点的家具，按 ANCHOR_POS 精确摆放 ---- */
  const rawInteractives = []; // { id, verb, anchorId, mesh }
  for (const [id, build] of PLACEMENTS) {
    const p = ANCHOR_POS[id];
    const g = build({ tier, quality, rng });
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = ANCHOR_ROT[id] || 0;
    group.add(g);
    for (const it of (g.userData.interactives || [])) {
      rawInteractives.push({ id: it.id, verb: it.verb, anchorId: id, mesh: it.mesh });
    }
  }

  /* ---- ③ 环境叙事（时间痕迹，原点 = 房间中心） ---- */
  group.add(F.buildAmbience({ tier, quality, rng }));

  /* ---- ④ anchors 输出：严格来自 ANCHOR_POS（10 个键齐全） ---- */
  const anchors = {};
  for (const id of ANCHORS) {
    const p = ANCHOR_POS[id] || { x: 0, y: 0, z: 0 };
    anchors[id] = {
      position: new THREE.Vector3(p.x, p.y, p.z),
      rotationY: ANCHOR_ROT[id] || 0,
      name: ANCHOR_LABELS[id] || id,
    };
  }

  /* ---- ⑤ 可交互物 + 放大热盒（需要世界矩阵，先刷新） ---- */
  group.updateMatrixWorld(true);
  const hitboxGeo = new THREE.BoxGeometry(1, 1, 1);
  const hitboxMat = new THREE.MeshBasicMaterial({ visible: false }); // 不渲染、不计 draw call，但可 raycast
  const interactables = [];
  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _center = new THREE.Vector3();

  for (const it of rawInteractives) {
    const mesh = it.mesh;
    if (!mesh || !mesh.isObject3D) continue;
    _box.setFromObject(mesh);
    _box.getSize(_size);
    _box.getCenter(_center);
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.name = `hitbox_${it.id}`;
    hitbox.position.copy(_center);
    hitbox.scale.set(
      Math.max(HITBOX_MIN, _size.x) * HITBOX_SCALE,
      Math.max(HITBOX_MIN, _size.y) * HITBOX_SCALE,
      Math.max(HITBOX_MIN, _size.z) * HITBOX_SCALE,
    );
    hitbox.castShadow = false;
    hitbox.receiveShadow = false;
    hitbox.userData.interactableId = it.id;
    hitbox.userData.anchorId = it.anchorId;
    hitbox.userData.verb = it.verb;
    group.add(hitbox);
    interactables.push({ id: it.id, verb: it.verb, anchorId: it.anchorId, mesh, hitbox });
  }

  /* ---- ⑥ 光照元数据（供 LightingRig / 后处理参考；不新增真实动态光源） ---- */
  const lights = {
    // 窗户位于 −X 墙，外法线朝 −X
    windowDirection: new THREE.Vector3(-1, 0, 0),
    // 环境项强度提示（0..1），与 SLOT_LIGHTING 的 ambientIntensity 同量纲
    ambientHint: 0.55,
    // 建议补光位（**仅元数据**：实时动态光预算 = 3，全部由 LightingRig 持有）
    accentPoints: [
      { position: new THREE.Vector3(-2.35, 0.95, 0.62), color: 0xf8e4c4, intensity: 0.30, role: 'window_morning' },
      { position: new THREE.Vector3(1.20, 1.30, 2.00), color: 0xd9a13a, intensity: 0.22, role: 'kitchen_warm' },
      { position: new THREE.Vector3(0.00, 2.20, 0.23), color: 0xf0d8a8, intensity: 0.18, role: 'room_fill' },
    ],
  };

  /* ---- ⑦ 释放 ---- */
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) { try { o.geometry.dispose(); } catch (e) { /* noop */ } }
        const m = o.material;
        if (Array.isArray(m)) { for (const mm of m) if (mm && mm.dispose) mm.dispose(); }
        else if (m && m.dispose) m.dispose();
      }
    });
    hitboxGeo.dispose();
    hitboxMat.dispose();
    disposeTextureCache();
    if (group.parent) group.parent.remove(group);
  }

  return { group, anchors, interactables, lights, dispose };
}

/** 便捷：房间内部尺寸（供主入口设置相机视锥 / 阴影范围） */
export const ROOM_BOUNDS = Object.freeze({
  minX: F.ROOM.minX, maxX: F.ROOM.maxX,
  minZ: F.ROOM.minZ, maxZ: F.ROOM.maxZ,
  height: F.ROOM.wallH,
  center: new THREE.Vector3(F.ROOM.cx, 0.45, F.ROOM.cz),
  radius: 3.4,
});

export { PALETTE };

export default { buildRoom, ROOM_BOUNDS };
