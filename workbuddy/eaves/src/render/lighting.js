/**
 * lighting.js —— 24 小时光照循环 · 4 时段交叉淡入
 *
 * 依据：RUL-1（production/PH2-rulings-EAVES.md）
 *   ① 4 套光照（晨 / 午 / 昏 / 夜），时段间 0.8s 交叉淡入淡出，**禁止硬切**
 *   ③ 季节与天气一律不走 lightmap，只允许改实时主光色温 / 强度 + 全屏 LUT
 *
 * ⚠️ 程序化场景下的等价替换（主理人已裁决，归档为 ADR-103 补充）：
 *    本项目全程序化生成、无预烘焙资产，因此"4 套 lightmap"落地为
 *    "4 组实时光照参数 + 0.8s 插值"。这不改变 RUL-1 的实质
 *    （光会移动、阴影随时段迁移），只是把"贴图烘焙"换成"参数插值"。
 *
 * 参数中的颜色取自美术圣经 §2 色板，数值为工程初值，需 playtest 调校。
 */

import * as THREE from 'three';
import { slotAt, SLOT_ORDER, SLOT_ANCHOR_MIN } from '../systems/time.js';
import { smootherstep, clamp01, lerp } from '../core/easing.js';

/** RUL-1 ②：交叉淡入时长（真实秒） */
export const CROSSFADE_SECONDS = 0.8;

/**
 * 四时段光照参数。
 * sunElevation / sunAzimuth 为弧度：elevation 是仰角，azimuth 是方位角（0 = +X 方向）。
 * exposure 直接驱动 renderer.toneMappingExposure。
 */
export const SLOT_LIGHTING = {
  // ⚠️ 平衡原则（实测踩过的坑）：
  //   四个时段必须形成**可感知的亮度阶梯**，否则"光会移动"这个支柱在观感上等于没做。
  //   初版把 night 的 fillIntensity 抬到 4.2 后，夜间总照度反超了晨光，四个时段看起来一模一样。
  //   现在的目标有效照度比约为 晨 4.8 : 午 5.6 : 昏 4.1 : 夜 1.9（夜间约为晨光的 40%）。
  morning: {
    label: '晨',
    sunElevation: 0.30,
    sunAzimuth: 1.10,
    sunColor: 0xffc38a,
    sunIntensity: 3.6,
    skyColor: 0xa8bfdd, // 天空散射（冷）
    groundColor: 0x6b5b4c, // 地面反弹（暖）
    ambientIntensity: 0.80,
    fillColor: 0xffe9c9, // 室内补光
    fillIntensity: 0.40,
    exposure: 1.06,
    fogColor: 0xe8dcc8,
  },
  noon: {
    label: '午',
    sunElevation: 1.05,
    sunAzimuth: 1.75,
    sunColor: 0xfff3dc,
    sunIntensity: 4.4,
    skyColor: 0xc6d8ec,
    groundColor: 0x8a7a66,
    ambientIntensity: 1.00,
    fillColor: 0xfff6e6,
    fillIntensity: 0.20,
    exposure: 1.02,
    fogColor: 0xf0e8d8,
  },
  dusk: {
    label: '昏',
    sunElevation: 0.22,
    sunAzimuth: 2.55,
    sunColor: 0xff9a5c,
    sunIntensity: 2.8,
    skyColor: 0x9682b0, // 暮色偏紫
    groundColor: 0x5a4a44,
    ambientIntensity: 0.70,
    fillColor: 0xffd2a0,
    fillIntensity: 0.60,
    exposure: 1.08,
    fogColor: 0xd8c0b0,
  },
  night: {
    label: '夜',
    sunElevation: 0.62, // 月光角度（低强度）
    sunAzimuth: 4.20,
    sunColor: 0x8fa2d6, // 冷蓝月光（略提亮，避免纯蓝发闷）
    sunIntensity: 0.40,
    skyColor: 0x3a4463,
    groundColor: 0x2a2520,
    ambientIntensity: 0.30,
    fillColor: 0xffb96b, // 室内暖灯成为主光源
    // ⚠️ Three.js r155+ 使用物理光照单位：PointLight 强度按 1/d^decay 衰减。
    // 灯高 1.75m、decay 1.4 时，地面处有效照度仅约为 intensity 的 45%。
    // 初版写 1.25 → 夜间整屋发黑、画面不可读；
    // 但也不宜过高（4.2 会让夜间反超晨光），2.6 是实测可读且保住时段差异的值。
    fillIntensity: 2.6,
    exposure: 1.14,
    fogColor: 0x2f2a33,
  },
};

/** 需要在两个时段之间插值的数值字段 */
const NUMERIC_KEYS = ['sunElevation', 'sunAzimuth', 'sunIntensity', 'ambientIntensity', 'fillIntensity', 'exposure'];
/** 需要插值的颜色字段 */
const COLOR_KEYS = ['sunColor', 'skyColor', 'groundColor', 'fillColor', 'fogColor'];

function lerpHex(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}

/** 在两个时段参数之间插值，返回新的参数对象 */
export function blendSlotParams(a, b, t) {
  const out = { label: t < 0.5 ? a.label : b.label };
  for (const k of NUMERIC_KEYS) out[k] = lerp(a[k], b[k], t);
  for (const k of COLOR_KEYS) out[k] = lerpHex(a[k], b[k], t).getHex();
  return out;
}

/**
 * 光照装置：持有主光 / 环境光 / 补光，并按游戏时间做 4 时段交叉淡入。
 *
 * 用法：
 *   const rig = new LightingRig(scene, { cfg, roomRadius });
 *   rig.update(gameMinutes, dtSeconds);   // 每帧调用
 */
export class LightingRig {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   * @param {object} [opts.cfg] 档位配置（来自 core/device.js 的 tierConfig）
   * @param {number} [opts.roomRadius] 房间半径，用于设置阴影相机范围
   * @param {THREE.Vector3} [opts.center] 房间中心
   * @param {number} [opts.gameMinutes] 初始游戏时刻
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.cfg = opts.cfg || null;
    this.center = opts.center ? opts.center.clone() : new THREE.Vector3(0, 0, 0);
    const radius = opts.roomRadius ?? 4.5;

    const maxLights = this.cfg?.dynamicLights ?? 3;

    // ① 主光（太阳 / 月光）—— 唯一投射阴影的光源
    this.sun = new THREE.DirectionalLight(0xffc38a, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.cfg?.shadowMapSize ?? 1024, this.cfg?.shadowMapSize ?? 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.near = 0.5;
    sc.far = radius * 4;
    sc.updateProjectionMatrix();
    // 阴影偏移：等距视角下自阴影条纹（shadow acne）非常显眼
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.sun.target.position.copy(this.center);

    // ② 半球光（天空 / 地面反弹）—— L 档省略
    this.hemi = null;
    if (maxLights >= 3) {
      this.hemi = new THREE.HemisphereLight(0x9fb6d6, 0x6b5b4c, 0.62);
      scene.add(this.hemi);
    } else {
      // L 档只有 2 个动态光：用环境光替代半球光（无方向，但成本为零）
      this.ambientFallback = new THREE.AmbientLight(0x9fb6d6, 0.62);
      scene.add(this.ambientFallback);
    }

    // ③ 室内补光 —— 夜晚的主光源
    this.fill = new THREE.PointLight(0xffe9c9, 0.35, radius * 3, 1.4);
    this.fill.position.set(this.center.x, 1.75, this.center.z);
    scene.add(this.fill);

    // 当前状态
    this.currentSlot = slotAt(opts.gameMinutes ?? 8 * 60);
    this.fromSlot = this.currentSlot;
    this.targetSlot = this.currentSlot;
    /** 0→1 的淡入进度；1 表示已稳定在当前时段 */
    this.blendT = 1;
    this.params = { ...SLOT_LIGHTING[this.currentSlot] };
    this._tmpColor = new THREE.Color();

    this.apply(this.params);
  }

  /**
   * 每帧更新。
   * @param {number} gameMinutes 当前游戏内分钟（0–1439）
   * @param {number} dtSeconds   真实秒
   */
  update(gameMinutes, dtSeconds) {
    const target = slotAt(gameMinutes);

    // 目标时段变化 → 启动 0.8s 交叉淡入（RUL-1 ②：禁止硬切）
    if (target !== this.targetSlot) {
      this.fromSlot = this.targetSlot;
      this.targetSlot = target;
      this.blendT = 0;
    }

    if (this.blendT < 1) {
      this.blendT = clamp01(this.blendT + dtSeconds / CROSSFADE_SECONDS);
    }

    const t = smootherstep(0, 1, this.blendT);
    const from = SLOT_LIGHTING[this.fromSlot];
    const to = SLOT_LIGHTING[this.targetSlot];
    this.params = this.blendT >= 1 ? { ...to } : blendSlotParams(from, to, t);

    this.currentSlot = this.targetSlot;
    this.apply(this.params);
  }

  /** 把参数写入灯光对象 */
  apply(p) {
    // 太阳位置：由仰角 + 方位角推算（距离固定，正交投影下不影响构图）
    const r = 10;
    const ce = Math.cos(p.sunElevation);
    this.sun.position.set(
      this.center.x + ce * Math.cos(p.sunAzimuth) * r,
      this.center.y + Math.sin(p.sunElevation) * r,
      this.center.z + ce * Math.sin(p.sunAzimuth) * r
    );
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;

    if (this.hemi) {
      this.hemi.color.setHex(p.skyColor);
      this.hemi.groundColor.setHex(p.groundColor);
      this.hemi.intensity = p.ambientIntensity;
    }
    if (this.ambientFallback) {
      // 天空色与地面色的均值，近似半球光
      const sky = this._tmpColor.setHex(p.skyColor);
      const ground = new THREE.Color(p.groundColor);
      this.ambientFallback.color.copy(sky.lerp(ground, 0.45));
      this.ambientFallback.intensity = p.ambientIntensity;
    }

    this.fill.color.setHex(p.fillColor);
    this.fill.intensity = p.fillIntensity;

    if (this.scene.fog) this.scene.fog.color.setHex(p.fogColor);
    // 背景色必须随时段同步。否则远处"雾色"与固定的 scene.background 不一致，
    // 在等距视角的四角（地板之外）会露出与雾不匹配的色块。
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.setHex(p.fogColor);
    }
    this.exposure = p.exposure;
  }

  /** 当前时段的显示名（UI 用） */
  get slotLabel() {
    return SLOT_LIGHTING[this.currentSlot]?.label ?? '';
  }

  /** 是否正在交叉淡入中（调试/测试用） */
  get isBlending() {
    return this.blendT < 1;
  }

  dispose() {
    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    if (this.hemi) this.scene.remove(this.hemi);
    if (this.ambientFallback) this.scene.remove(this.ambientFallback);
    this.scene.remove(this.fill);
    this.sun.dispose();
    this.fill.dispose();
  }
}

export default { LightingRig, SLOT_LIGHTING, CROSSFADE_SECONDS, blendSlotParams };
