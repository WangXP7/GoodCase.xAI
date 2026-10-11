/**
 * renderer.js —— WebGL2 渲染器、色彩管线、等距正交相机
 *
 * 依据：ADR-101 · 渲染方案
 *   - 强制 WebGL2，不做 WebGL1 回退（§4.3）
 *   - outputColorSpace = SRGB；toneMapping = ACESFilmic；exposure = 1.0（§2.1）
 *   - antialias: false，抗锯齿统一走后处理（§4.4）
 *   - 全局只创建 1 个 WebGL context（§5.3，验收 V-9 / V-101-4）
 */

import * as THREE from 'three';
import { probeDevice, tierConfig, resolveDPR } from '../core/device.js';

/** 全局 WebGL context 计数。验收要求恒为 1。 */
let _contextCount = 0;

/** @returns {number} 当前存活的 WebGL context 数 */
export function getWebGLContextCount() {
  return _contextCount;
}

/**
 * WebGL2 能力探测。
 * 注意：探测用的临时 context 必须立刻释放，否则会占用浏览器上下文配额
 * （iOS Safari 全系统上限仅 8–16 个）。
 * @returns {boolean}
 */
export function isWebGL2Available() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 创建渲染器。
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {string} [opts.tier] 强制档位 'L'|'M'|'H'，不传则自动探测
 * @param {number} [opts.dprOverride] DPR 上限覆盖（调试用）
 * @returns {{renderer:THREE.WebGLRenderer, tierName:string, cfg:object,
 *            mobile:boolean, probe:object, resize:Function, dispose:Function, dpr:number}}
 */
export function createRenderer(canvas, opts = {}) {
  const probe = probeDevice();
  const tierName = opts.tier || probe.tier;
  const cfg = tierConfig(tierName);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // ADR-101 §4.4：iOS MSAA 实际不生效或极贵，统一走后处理
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  _contextCount++;

  // 色彩管线（ADR-101 §2.1）
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // 阴影
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type =
    cfg.shadowType === 'pcfsoft' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;

  renderer.setClearColor(0x1a1512, 1);
  renderer.info.autoReset = false;

  let currentDPR = 1;
  let viewW = 1;
  let viewH = 1;

  /**
   * 尺寸变更。DPR 由档位上限 × 设备 DPR，再用像素预算封顶（AR-9）。
   * @param {number} width  CSS 像素宽
   * @param {number} height CSS 像素高
   */
  function resize(width, height) {
    viewW = Math.max(1, width);
    viewH = Math.max(1, height);
    const deviceDPR =
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const dpr = resolveDPR(tierName, deviceDPR, viewW, viewH, opts.dprOverride ?? null);
    currentDPR = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(viewW, viewH, false);
    return { dpr, width: viewW, height: viewH };
  }

  function dispose() {
    renderer.dispose();
    _contextCount = Math.max(0, _contextCount - 1);
  }

  return {
    renderer,
    tierName,
    cfg,
    mobile: probe.mobile,
    probe,
    resize,
    dispose,
    get dpr() {
      return currentDPR;
    },
    get width() {
      return viewW;
    },
    get height() {
      return viewH;
    },
  };
}

/**
 * 等距正交相机（美术圣经 §5.5：正交投影 + tilt-shift = 微缩手办感）。
 *
 * 默认取 45° 方位 / 30° 俯仰。真等距是 35.264°，但 30° 更接近"手办展示柜"的观感，
 * 且顶面占比略大，更适合展示房间布局。
 *
 * @param {object} [opts]
 * @param {number} [opts.frustum] 视野高度（世界单位）
 * @param {number} [opts.aspect]  宽高比
 * @param {number} [opts.azimuth] 方位角（弧度）
 * @param {number} [opts.elevation] 俯仰角（弧度）
 * @param {number} [opts.distance] 相机距离（正交下仅影响 near/far 裁剪）
 * @param {THREE.Vector3} [opts.target] 注视点
 * @returns {THREE.OrthographicCamera}
 */
export function createIsoCamera(opts = {}) {
  const frustum = opts.frustum ?? 4.2;
  const aspect = opts.aspect ?? 16 / 9;
  const azimuth = opts.azimuth ?? Math.PI * 0.25;
  const elevation = opts.elevation ?? Math.PI / 6; // 30°
  const distance = opts.distance ?? 14;
  const target = opts.target ?? new THREE.Vector3(0, 0.45, 0);

  const halfH = frustum / 2;
  const halfW = (frustum * aspect) / 2;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);

  const ce = Math.cos(elevation);
  cam.position.set(
    target.x + ce * Math.cos(azimuth) * distance,
    target.y + Math.sin(elevation) * distance,
    target.z + ce * Math.sin(azimuth) * distance
  );
  cam.lookAt(target);
  cam.updateProjectionMatrix();

  // 供外部做屏幕射线拾取时复用
  cam.userData.iso = { frustum, aspect, azimuth, elevation, distance, target: target.clone() };
  return cam;
}

/**
 * 更新等距相机的视野（窗口 resize 时调用）。
 * @param {THREE.OrthographicCamera} cam
 * @param {number} aspect
 * @param {number} [frustum]
 */
export function updateIsoCameraAspect(cam, aspect, frustum) {
  const iso = cam.userData.iso || {};
  const f = frustum ?? iso.frustum ?? 4.2;
  const halfH = f / 2;
  const halfW = (f * aspect) / 2;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.userData.iso = { ...iso, frustum: f, aspect };
  cam.updateProjectionMatrix();
}

export default { createRenderer, createIsoCamera, updateIsoCameraAspect, isWebGL2Available, getWebGLContextCount };
