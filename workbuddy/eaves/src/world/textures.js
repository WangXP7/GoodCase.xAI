/**
 * textures.js —— 全程序化 canvas 2D 贴图（零外部资产）
 *
 * 依据：
 *   · 美术圣经 §2.1（28 色主色板 —— 本文件 PALETTE 逐色取样，禁止表外色）
 *   · 美术圣经 §5.3（时间痕迹）/ §3.3（UV 与贴图规格）
 *   · ADR-105（资产管线：本项目全程序化，无 .glb/.gltf/图片）
 *   · RUL-9（种子化：所有随机一律走 core/rng.js 的 PCG32，禁止 Math.random）
 *
 * 设计约束：
 *   1. 模块顶层**不触碰 document** —— canvas 只在函数被调用时创建，
 *      使本模块可在 Node 无头环境下（注入 document 桩）被 import 并调用。
 *   2. 结果按 (kind, color, size, repeat) memoize —— 同一张贴图全场景共享，省显存与 CPU。
 *   3. 颜色贴图 colorSpace = SRGB；normal / roughness 保持线性（NoColorSpace）。
 *   4. 所有高度图 → 法线图用 sobel 差分一次性生成（不做实时计算）。
 */

import * as THREE from 'three';
import { PCG32 } from '../core/rng.js';

/* ============================================================================
 * 色板（美术圣经 §2.1 —— 唯一色源）
 * ========================================================================== */

export const PALETTE = Object.freeze({
  // 环境主色（8）
  E00: '#FAF3E7', // 米白 Linen
  E01: '#F5E6D3', // 暖纸 Warm Paper
  E02: '#E8D4B8', // 沙褐 Sand
  E03: '#D9B380', // 蜜糖 Honey
  E04: '#B8895A', // 焦糖 Caramel
  E05: '#8C6440', // 咖啡棕 Coffee
  E06: '#5C4030', // 胡桃 Walnut
  E07: '#3A2820', // 深咖 Espresso
  // 辅色（10）
  A00: '#F8C8A4', // 桃粉 Peach
  A01: '#E89A7C', // 落日橘 Sunset
  A02: '#D17A4E', // 赤陶 Terracotta
  A03: '#9C7B5C', // 卡其 Khaki
  A04: '#7A8B6E', // 鼠尾草 Sage（沙发主色）
  A05: '#5C7A6A', // 苔绿 Moss
  A06: '#4A6B5C', // 森林绿 Forest
  A07: '#C8D4D0', // 雾白 Mist
  A08: '#7A8C9C', // 烟蓝 Smoke Blue
  A09: '#4C5A6E', // 远山青 Distant
  // 强调色（10 · MVP 仅启用 C00–C03）
  C00: '#E85D3C', // 番茄红 Tomato（仅抱枕/新鲜食物）
  C01: '#D9A13A', // 姜黄 Turmeric（灯光/暖高光/食物）
  C02: '#A64B3A', // 砖红 Brick（花盆/墙挂）
  C03: '#5A8F7A', // 薄荷绿 Mint（玩具新鲜感标记）
  C04: '#3E5C7A', // 牛仔蓝 Denim（书脊/地毯花纹）
  C05: '#8E4A6E', // 暗紫 Plummy
  C06: '#C9A87C', // 旧金 Old Gold（金属把手）
  C07: '#E8B894', // 奶茶 Milktea
  C08: '#F0D8A8', // 浅奶油 Cream
  C09: '#3F5466', // 墨青 Ink（仅描边）
});

/** 贴图分辨率档位（ADR-106 / 美术 §8.4） */
export const TEXTURE_SIZE_BY_TIER = Object.freeze({ H: 1024, M: 512, L: 256 });

/* ============================================================================
 * 基础设施
 * ========================================================================== */

const _cache = new Map();
const _all = []; // 供 disposeTextureCache 统一释放

function createCanvas(w, h) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('[textures] 需要 DOM canvas；Node 无头环境请注入 document 桩');
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 解析 '#rrggbb' 或 'rgb(r,g,b)' → [r,g,b] */
function hexRgb(hex) {
  const s = String(hex).trim();
  if (s[0] === '#') {
    const n = parseInt(s.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

function rgbCss(r, g, b) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/** amt ∈ [-1,1]：<0 压暗，>0 提亮（向 E00 米白靠） */
function shade(hex, amt) {
  const [r, g, b] = hexRgb(hex);
  if (amt >= 0) {
    const t = Math.min(1, amt);
    return rgbCss(r + (250 - r) * t, g + (243 - g) * t, b + (231 - b) * t);
  }
  const k = 1 + Math.max(-1, amt);
  return rgbCss(r * k, g * k, b * k);
}

/** hex + alpha → CSS rgba 串 */
export function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function pickBy(rng, arr) {
  const i = Math.min(arr.length - 1, Math.floor(rng.nextFloat() * arr.length));
  return arr[i];
}

/** CanvasTexture 统一配置 */
function makeTex(canvas, { srgb = false, repeat = [1, 1], aniso = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _all.push(tex);
  return tex;
}

/** 灰度高度图 → 切线空间法线图（sobel 差分；无头桩下退化为平面法线） */
function normalFromHeight(hCanvas, strength = 1.5) {
  const w = hCanvas.width | 0;
  const h = hCanvas.height | 0;
  const src = hCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = createCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    const v = src[(yy * w + xx) * 4];
    return v == null ? 128 : v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = ((at(x + 1, y) - at(x - 1, y)) / 255) * strength;
      const dy = ((at(x, y + 1) - at(x, y - 1)) / 255) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** 平滑值噪声场 [0,1]，返回 (u,v) → value */
function valueNoise(rng, gw, gh) {
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.nextFloat();
  return (u, v) => {
    const x = u * (gw - 1), y = v * (gh - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x1];
    const c = g[y1 * gw + x0], d = g[y1 * gw + x1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

function cache(key, factory) {
  const hit = _cache.get(key);
  if (hit) return hit;
  const val = factory();
  for (const k of Object.keys(val)) {
    const t = val[k];
    if (t && t.isTexture && _all.indexOf(t) < 0) _all.push(t);
  }
  _cache.set(key, val);
  return val;
}

function sizeOf(opts) {
  return Math.max(64, (opts && opts.size) || 512) | 0;
}

/* ============================================================================
 * ① 木地板 —— 木纹条 + 缝隙 + 轻微色差
 * ========================================================================== */

export function makeFloorTexture(opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`floor:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x10f1000f, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const hc = createCanvas(S, S), hg = hc.getContext('2d');
    const rc = createCanvas(S, S), rg = rc.getContext('2d');

    const base = PALETTE.E03;
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    rg.fillStyle = '#b8b8b8'; rg.fillRect(0, 0, S, S); // ≈0.72 roughness

    const planks = 5;
    const pw = S / planks;
    for (let p = 0; p < planks; p++) {
      const x0 = p * pw;
      // 每块板的整体色差（暖木深浅）
      g.fillStyle = shade(base, rng.nextRange(-0.14, 0.10));
      g.fillRect(x0, 0, pw, S);

      // 木纹：沿板长方向的波动细线
      const lines = Math.round(pw * 0.9);
      for (let i = 0; i < lines; i++) {
        const x = x0 + rng.nextRange(1, pw - 1);
        g.strokeStyle = `rgba(90,64,48,${rng.nextRange(0.03, 0.16)})`;
        g.lineWidth = rng.nextRange(0.5, 1.6);
        g.beginPath();
        g.moveTo(x, 0);
        let y = 0;
        while (y < S) { y += rng.nextRange(8, 18); g.lineTo(x + rng.nextRange(-2.2, 2.2), y); }
        g.stroke();

        hg.strokeStyle = `rgba(0,0,0,${rng.nextRange(0.04, 0.12)})`;
        hg.lineWidth = 1;
        hg.beginPath();
        hg.moveTo(x, 0); y = 0;
        while (y < S) { y += rng.nextRange(8, 18); hg.lineTo(x + rng.nextRange(-2.2, 2.2), y); }
        hg.stroke();

        rg.strokeStyle = `rgba(0,0,0,${rng.nextRange(0.03, 0.10)})`;
        rg.lineWidth = rng.nextRange(0.6, 1.4);
        rg.beginPath(); rg.moveTo(x, 0); rg.lineTo(x, S); rg.stroke();
      }

      // 板缝（深槽）
      g.fillStyle = rgba(PALETTE.E07, 0.55);
      g.fillRect(x0, 0, 1.6, S);
      hg.fillStyle = '#242424';
      hg.fillRect(x0, 0, 2, S);
      rg.fillStyle = rgba('#000000', 0.22);
      rg.fillRect(x0, 0, 2, S);
    }

    // 木节（少量）
    const knots = rng.nextInt(1, 3);
    for (let k = 0; k < knots; k++) {
      const kx = rng.nextRange(0, S), ky = rng.nextRange(0, S);
      const kr = rng.nextRange(2, 5);
      const grad = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
      grad.addColorStop(0, rgba(PALETTE.E05, 0.55));
      grad.addColorStop(1, rgba(PALETTE.E05, 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(kx, ky, kr * 2.2, 0, Math.PI * 2); g.fill();
    }

    return {
      map: makeTex(c, { srgb: true, repeat }),
      normalMap: makeTex(normalFromHeight(hc, 1.1), { repeat }),
      roughnessMap: makeTex(rc, { repeat }),
    };
  });
}

/* ============================================================================
 * ② 墙面 —— 暖白微纹理
 * ========================================================================== */

export function makeWallTexture(opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`wall:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x211a1100, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const hc = createCanvas(S, S), hg = hc.getContext('2d');

    const base = PALETTE.E01;
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);

    // 石灰墙的细微颗粒
    const grains = S * S * 0.06;
    for (let i = 0; i < grains; i++) {
      const x = rng.nextRange(0, S), y = rng.nextRange(0, S), r = rng.nextRange(0.5, 1.6);
      g.fillStyle = rgba(rng.nextBool(0.5) ? PALETTE.E00 : PALETTE.E02, rng.nextRange(0.03, 0.10));
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // 轻微的竖向滚涂痕迹
    for (let i = 0; i < S * 0.5; i++) {
      const x = rng.nextRange(0, S);
      g.strokeStyle = rgba(PALETTE.E02, rng.nextRange(0.02, 0.05));
      g.lineWidth = rng.nextRange(1, 3);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rng.nextRange(-6, 6), S); g.stroke();
    }
    // 高度图：极弱的凹凸
    const n = valueNoise(rng, 24, 24);
    const img = hg.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = 128 + (n(x / S, y / S) - 0.5) * 22;
        const i = (y * S + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    hg.putImageData(img, 0, 0);

    return {
      map: makeTex(c, { srgb: true, repeat }),
      normalMap: makeTex(normalFromHeight(hc, 0.35), { repeat }),
    };
  });
}

/* ============================================================================
 * ③ 布料 —— 沙发 / 猫窝 / 毛毯（织纹 + 织物 normal）
 * ========================================================================== */

export function makeFabricTexture(hex = PALETTE.A04, opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`fabric:${hex}:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x3fab1234, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const hc = createCanvas(S, S), hg = hc.getContext('2d');
    const rc = createCanvas(S, S), rg = rc.getContext('2d');

    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    rg.fillStyle = '#d2d2d2'; rg.fillRect(0, 0, S, S); // ≈0.82 roughness（毛织物）

    const step = Math.max(3, Math.round(S / 128));
    // 经线 / 纬线：交替提亮压暗，形成织物网格
    for (let x = 0; x < S; x += step) {
      g.fillStyle = rgba(shade(hex, 0.06), rng.nextRange(0.10, 0.20));
      g.fillRect(x, 0, step * 0.5, S);
      hg.fillStyle = `rgba(255,255,255,${rng.nextRange(0.06, 0.12)})`;
      hg.fillRect(x, 0, step * 0.5, S);
    }
    for (let y = 0; y < S; y += step) {
      g.fillStyle = rgba(shade(hex, -0.10), rng.nextRange(0.08, 0.18));
      g.fillRect(0, y, S, step * 0.5);
      hg.fillStyle = `rgba(0,0,0,${rng.nextRange(0.05, 0.11)})`;
      hg.fillRect(0, y, S, step * 0.5);
    }
    // 绒毛噪点
    const fuzz = S * S * 0.05;
    for (let i = 0; i < fuzz; i++) {
      const x = rng.nextRange(0, S), y = rng.nextRange(0, S);
      g.fillStyle = rgba(rng.nextBool(0.5) ? shade(hex, 0.12) : shade(hex, -0.12), rng.nextRange(0.04, 0.12));
      g.fillRect(x, y, rng.nextRange(1, 2.4), rng.nextRange(1, 2.4));
    }
    // 使用痕迹：沙发受压处的轻微不均匀
    const n = valueNoise(rng, 8, 8);
    const img = rg.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const wear = n(x / S, y / S) * 20;
        d[i] = Math.max(0, d[i] - wear); d[i + 1] = Math.max(0, d[i + 1] - wear);
        d[i + 2] = Math.max(0, d[i + 2] - wear);
      }
    }
    rg.putImageData(img, 0, 0);

    return {
      map: makeTex(c, { srgb: true, repeat }),
      normalMap: makeTex(normalFromHeight(hc, 1.0), { repeat }),
      roughnessMap: makeTex(rc, { repeat }),
    };
  });
}

/* ============================================================================
 * ④ 木质 —— 书架 / 画架 / 台面 / 窗台
 * ========================================================================== */

export function makeWoodTexture(hex = PALETTE.E04, opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`wood:${hex}:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x4c0de001, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const hc = createCanvas(S, S), hg = hc.getContext('2d');
    const rc = createCanvas(S, S), rg = rc.getContext('2d');

    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    rg.fillStyle = '#a8a8a8'; rg.fillRect(0, 0, S, S); // ≈0.66

    // 顺纹（水平方向）木纹
    for (let i = 0; i < S * 1.6; i++) {
      const y = rng.nextRange(0, S);
      g.strokeStyle = rgba(shade(hex, rng.nextRange(-0.28, 0.10)), rng.nextRange(0.03, 0.14));
      g.lineWidth = rng.nextRange(0.6, 2.0);
      g.beginPath(); g.moveTo(0, y);
      let x = 0;
      while (x < S) { x += rng.nextRange(14, 34); g.lineTo(x, y + rng.nextRange(-1.6, 1.6)); }
      g.stroke();

      hg.strokeStyle = `rgba(0,0,0,${rng.nextRange(0.02, 0.08)})`;
      hg.lineWidth = 1;
      hg.beginPath(); hg.moveTo(0, y); hg.lineTo(S, y); hg.stroke();
    }
    // 大块木色分层
    for (let i = 0; i < 5; i++) {
      const y = rng.nextRange(0, S), hgt = rng.nextRange(S * 0.02, S * 0.08);
      g.fillStyle = rgba(shade(hex, rng.nextRange(-0.16, 0.12)), rng.nextRange(0.06, 0.16));
      g.fillRect(0, y, S, hgt);
    }
    // 木节
    const knots = rng.nextInt(0, 2);
    for (let k = 0; k < knots; k++) {
      const kx = rng.nextRange(0, S), ky = rng.nextRange(0, S), kr = rng.nextRange(3, 7);
      const grad = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 1.8);
      grad.addColorStop(0, rgba(PALETTE.E06, 0.5));
      grad.addColorStop(1, rgba(PALETTE.E06, 0));
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(kx, ky, kr * 1.6, kr, 0, 0, Math.PI * 2); g.fill();
    }

    return {
      map: makeTex(c, { srgb: true, repeat }),
      normalMap: makeTex(normalFromHeight(hc, 0.7), { repeat }),
      roughnessMap: makeTex(rc, { repeat }),
    };
  });
}

/* ============================================================================
 * ⑤ 金属 —— 洗衣机 / 窗把手 / 龙头（拉丝）
 * ========================================================================== */

export function makeMetalTexture(hex = PALETTE.A08, opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`metal:${hex}:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x5ea11100, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const rc = createCanvas(S, S), rg = rc.getContext('2d');

    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    rg.fillStyle = '#8a8a8a'; rg.fillRect(0, 0, S, S);

    // 横向拉丝
    for (let i = 0; i < S * 3; i++) {
      const y = rng.nextRange(0, S);
      const len = rng.nextRange(S * 0.15, S);
      const x = rng.nextRange(0, S);
      g.strokeStyle = rgba(rng.nextBool(0.5) ? shade(hex, 0.18) : shade(hex, -0.16), rng.nextRange(0.04, 0.14));
      g.lineWidth = rng.nextRange(0.5, 1.4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + rng.nextRange(-0.6, 0.6)); g.stroke();

      rg.strokeStyle = `rgba(255,255,255,${rng.nextRange(0.03, 0.10)})`;
      rg.lineWidth = 1;
      rg.beginPath(); rg.moveTo(x, y); rg.lineTo(x + len, y); rg.stroke();
    }

    return {
      map: makeTex(c, { srgb: true, repeat }),
      roughnessMap: makeTex(rc, { repeat }),
    };
  });
}

/* ============================================================================
 * ⑥ 地毯 —— 绒毛方向感 + 花纹（圆形构图，供圆盘 UV）
 * ========================================================================== */

export function makeRugTexture(opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`rug:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x6cafef00, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const hc = createCanvas(S, S), hg = hc.getContext('2d');

    const base = PALETTE.E02;
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);

    // 绒毛：大量同向短笔触（方向感）
    const strokes = S * S * 0.14;
    for (let i = 0; i < strokes; i++) {
      const x = rng.nextRange(0, S), y = rng.nextRange(0, S), l = rng.nextRange(2, 6);
      g.strokeStyle = rgba(rng.nextBool(0.5) ? shade(base, 0.10) : shade(base, -0.12), rng.nextRange(0.05, 0.16));
      g.lineWidth = rng.nextRange(0.6, 1.4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.nextRange(-0.8, 0.8), y + l); g.stroke();

      hg.strokeStyle = `rgba(${rng.nextBool(0.5) ? '255,255,255' : '0,0,0'},${rng.nextRange(0.05, 0.14)})`;
      hg.lineWidth = 1;
      hg.beginPath(); hg.moveTo(x, y); hg.lineTo(x, y + l); hg.stroke();
    }

    // 圆环边框（映射到圆盘上即为地毯包边）
    g.strokeStyle = rgba(PALETTE.C02, 0.85);
    g.lineWidth = S * 0.045;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); g.stroke();
    // 内圈虚线
    g.strokeStyle = rgba(PALETTE.C04, 0.7);
    g.lineWidth = S * 0.014;
    const rr = S * 0.30, seg = 22;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / seg) * 0.55;
      g.beginPath(); g.arc(S / 2, S / 2, rr, a0, a1); g.stroke();
    }
    // 中心徽章
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.16);
    grad.addColorStop(0, rgba(PALETTE.A03, 0.85));
    grad.addColorStop(1, rgba(PALETTE.A03, 0));
    g.fillStyle = grad;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.16, 0, Math.PI * 2); g.fill();

    return {
      map: makeTex(c, { srgb: true, repeat }),
      normalMap: makeTex(normalFromHeight(hc, 1.6), { repeat }),
    };
  });
}

/* ============================================================================
 * ⑦ 植物叶片 —— 叶脉
 * ========================================================================== */

export function makePlantTexture(hex = PALETTE.A05, opts = {}) {
  const size = sizeOf(opts);
  return cache(`plant:${hex}:${size}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x71a47000, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');

    // 竖向渐变（叶基深、叶尖亮）
    const grad = g.createLinearGradient(0, S, 0, 0);
    grad.addColorStop(0, shade(hex, -0.18));
    grad.addColorStop(1, shade(hex, 0.14));
    g.fillStyle = grad; g.fillRect(0, 0, S, S);

    // 叶脉：中脉 + 侧脉
    g.strokeStyle = rgba(shade(hex, -0.30), 0.55);
    g.lineWidth = Math.max(1.5, S * 0.014);
    g.beginPath(); g.moveTo(S / 2, S); g.lineTo(S / 2 + rng.nextRange(-3, 3), 0); g.stroke();

    const veins = 7;
    for (let i = 0; i < veins; i++) {
      const t = (i + 0.5) / veins;
      const y = S * (1 - t);
      g.lineWidth = Math.max(1, S * 0.006);
      g.strokeStyle = rgba(shade(hex, -0.24), 0.4);
      g.beginPath();
      g.moveTo(S / 2, y);
      g.quadraticCurveTo(S * 0.72, y - S * 0.05, S * 0.94, y - S * 0.12);
      g.stroke();
      g.beginPath();
      g.moveTo(S / 2, y);
      g.quadraticCurveTo(S * 0.28, y - S * 0.05, S * 0.06, y - S * 0.12);
      g.stroke();
    }
    // 叶面斑点
    for (let i = 0; i < S * 0.6; i++) {
      const x = rng.nextRange(0, S), y = rng.nextRange(0, S);
      g.fillStyle = rgba(rng.nextBool(0.5) ? shade(hex, 0.10) : shade(hex, -0.10), rng.nextRange(0.03, 0.09));
      g.beginPath(); g.arc(x, y, rng.nextRange(0.6, 2.2), 0, Math.PI * 2); g.fill();
    }

    return { map: makeTex(c, { srgb: true, repeat: [1, 1] }) };
  });
}

/* ============================================================================
 * ⑧ 陶瓷 —— 食盆 / 水盆 / 杯子（釉面）
 * ========================================================================== */

export function makeCeramicTexture(hex = PALETTE.E00, opts = {}) {
  const size = sizeOf(opts);
  const repeat = opts.repeat || [1, 1];
  return cache(`ceramic:${hex}:${size}:${repeat[0]}x${repeat[1]}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x8ce4a111, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    const rc = createCanvas(S, S), rg = rc.getContext('2d');

    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    rg.fillStyle = '#4d4d4d'; rg.fillRect(0, 0, S, S); // ≈0.30 roughness（釉面光）

    for (let i = 0; i < S * 0.5; i++) {
      const x = rng.nextRange(0, S), y = rng.nextRange(0, S);
      g.fillStyle = rgba(rng.nextBool(0.5) ? shade(hex, 0.08) : shade(hex, -0.06), rng.nextRange(0.03, 0.09));
      g.beginPath(); g.arc(x, y, rng.nextRange(0.8, 2.6), 0, Math.PI * 2); g.fill();
    }
    return {
      map: makeTex(c, { srgb: true, repeat }),
      roughnessMap: makeTex(rc, { repeat }),
    };
  });
}

/* ============================================================================
 * ⑨ 光照贴花 —— 地上日光池 / 窗光柱（RGBA，供 additive 四边形）
 * ========================================================================== */

export function makeSunPoolTexture(opts = {}) {
  const size = sizeOf(opts);
  return cache(`sunpool:${size}`, () => {
    const S = size;
    const rng = opts.rng || new PCG32(0x904d1000, 0);
    const c = createCanvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0.0, rgba(PALETTE.C08, 0.90));
    grad.addColorStop(0.35, rgba(PALETTE.C08, 0.45));
    grad.addColorStop(0.72, rgba(PALETTE.A01, 0.16));
    grad.addColorStop(1.0, rgba(PALETTE.A01, 0));
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.5, S * 0.5, 0, 0, Math.PI * 2); g.fill();
    return { map: makeTex(c, { srgb: true, repeat: [1, 1] }) };
  });
}

export function makeLightShaftTexture(opts = {}) {
  const size = sizeOf(opts);
  return cache(`shaft:${size}`, () => {
    const S = size;
    const c = createCanvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    // 竖向：上浓下淡
    const vg = g.createLinearGradient(0, 0, 0, S);
    vg.addColorStop(0, rgba(PALETTE.C08, 0.42));
    vg.addColorStop(0.55, rgba(PALETTE.C08, 0.16));
    vg.addColorStop(1, rgba(PALETTE.C08, 0));
    g.fillStyle = vg; g.fillRect(0, 0, S, S);
    // 横向柔边（destination-in 掩膜）
    const hg = g.createLinearGradient(0, 0, S, 0);
    hg.addColorStop(0, 'rgba(255,255,255,0)');
    hg.addColorStop(0.5, 'rgba(255,255,255,1)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    if ('globalCompositeOperation' in g) {
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = hg; g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    return { map: makeTex(c, { srgb: true, repeat: [1, 1] }) };
  });
}

/* ============================================================================
 * 释放
 * ========================================================================== */

export function disposeTextureCache() {
  for (let i = 0; i < _all.length; i++) {
    const t = _all[i];
    if (t && typeof t.dispose === 'function') t.dispose();
  }
  _all.length = 0;
  _cache.clear();
}

export default {
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
  disposeTextureCache,
};
