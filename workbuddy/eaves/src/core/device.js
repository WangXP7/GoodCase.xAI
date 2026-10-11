/**
 * device.js —— 设备分档与运行时质量策略
 *
 * 依据：ADR-106、美术圣经 §8.4（3 档）、ADR-101 §5.3（DPR 由程序控制）。
 *
 * 分档结果直接决定：DPR、动态光数量、后处理开关、阴影贴图尺寸、抗锯齿路径。
 *
 * 检测策略（ADR-101 风险 A101-R3 的缓解）：
 *   WEBGL_debug_renderer_info 已被现代浏览器限制，GPU 字符串只能作弱提示。
 *   因此以「1 秒实测跑分」为准 —— 前 60 帧的平均帧时间若持续超标则降档。
 */

/** 三档配置（美术圣经 §8.4） */
export const TIERS = {
  H: {
    name: 'H',
    label: '高端',
    dpr: { desktop: 2.0, mobile: 1.5 },
    dynamicLights: 3,          // 1 directional + 1 hemisphere + 1 point（AR-7 推荐值）
    postfx: { tiltShift: true, grading: true, vignette: true, blurDiv: 4, fxaa: false },
    msaaSamples: 4,            // WebGL2 RenderTarget 的 MSAA
    shadowMapSize: 2048,
    shadowType: 'pcfsoft',
    furCards: true,
    decoAtlas: true,
    maxPixelBudget: 3.6e6,     // 渲染缓冲像素上限（超出则再压 DPR）
  },
  M: {
    name: 'M',
    label: '中端',
    dpr: { desktop: 1.5, mobile: 1.25 },
    dynamicLights: 3,
    postfx: { tiltShift: true, grading: true, vignette: true, blurDiv: 8, fxaa: true },
    msaaSamples: 0,
    shadowMapSize: 1024,
    shadowType: 'basic',
    furCards: true,
    decoAtlas: true,
    maxPixelBudget: 2.3e6,
  },
  L: {
    name: 'L',
    label: '低端',
    dpr: { desktop: 1.25, mobile: 1.0 },
    dynamicLights: 2,          // 砍掉 hemisphere（美术 §8.4）
    postfx: { tiltShift: true, grading: true, vignette: false, blurDiv: 8, fxaa: true },
    // 🔴 美术反对③：L 档保留 tilt-shift。它是"等距微缩"视觉语言的唯一载体，
    //    关掉它本作退化为"普通的低模 3D 房间"。vignette 只是装饰，可以关。
    msaaSamples: 0,
    shadowMapSize: 512,
    shadowType: 'basic',
    furCards: false,           // 禁用毛发卡片，省下的 fill rate 回补给 tilt-shift
    decoAtlas: false,          // L 档完全不加载 Deco Atlas
    maxPixelBudget: 1.2e6,
  },
};

export const TIER_ORDER = ['L', 'M', 'H'];

export function tierConfig(tier) {
  return TIERS[tier] || TIERS.M;
}

/* ============================ 探测 ============================ */

function readGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // 探测完立刻释放，避免占用上下文配额（V-9：全局只允许 1 个 WebGL context）
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* noop */ }
    return String(s || '');
  } catch (e) {
    return null;
  }
}

function isMobileUA() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS 13+ 伪装成 macOS，用触摸点数量二次判定
  if (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * 静态探测：给出初始档位猜测。
 * @param {object} env 可注入（测试用）
 */
export function probeDevice(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  const win = env.window || (typeof window !== 'undefined' ? window : {});
  // ⚠️ 不可把该局部量命名为 screen：const 声明会提升到块顶形成 TDZ，
  // 连 typeof screen 都会抛 ReferenceError，遮蔽全局 window.screen。
  const scr = env.screen || (win.screen || { width: 1280, height: 720 });

  const mobile = env.isMobile != null ? env.isMobile : isMobileUA();
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || nav.deviceMemory === 0 ? nav.deviceMemory : 4; // GB
  const dpr = win.devicePixelRatio || 1;
  const px = (scr.width || 1280) * (scr.height || 720) * dpr;
  const gpu = env.gpu || readGPU() || '';
  const g = gpu.toLowerCase();

  let score = 0;
  score += Math.min(cores, 12) * 4;                 // 最多 48
  score += Math.min(mem, 12) * 3;                   // 最多 36
  score += mobile ? 0 : 14;                         // 桌面默认加分
  if (/apple m[1-9]|apple a1[4-9]/i.test(g)) score += 26;
  if (/snapdragon 8|snapdragon 7\+|dimensity 9|dimensity 8/.test(g)) score += 20;
  if (/rtx|radeon rx|geforce|apple m[1-9]/.test(g)) score += 22;
  if (/adreno 6[3-9]0|adreno 7|mali-g7|mali-g6/.test(g)) score += 8;
  if (/swiftshader|llvmpipe|software/.test(g)) score -= 40;
  if (/intel.*hd graphics [2-5]/.test(g)) score -= 12;
  if (px > 4.5e6) score -= 8;                       // 超大屏 + 高 DPR，fill rate 吃紧

  let tier = 'M';
  if (score >= 78) tier = 'H';
  else if (score < 42) tier = 'L';

  return { tier, score: Math.round(score), mobile, cores, mem, dpr, px, gpu, isGuess: true };
}

/**
 * 运行时跑分器：连续采样帧时间，超标则降档。
 * ADR-101 A101-R3：以 1 秒实测为准，GPU 字符串只作弱提示。
 */
export class FrameBenchmark {
  constructor({ onDowngrade, windowFrames = 60, budgetMs = 22, cooldownFrames = 240 } = {}) {
    this.onDowngrade = onDowngrade || (() => {});
    this.windowFrames = windowFrames;
    this.budgetMs = budgetMs;
    this.cooldownFrames = cooldownFrames;
    this.samples = [];
    this.cooldown = 0;
    this.enabled = true;
    this.avgMs = 16.7;
    this.worstMs = 0;
  }

  reset() { this.samples.length = 0; this.cooldown = this.cooldownFrames; }

  /** @param {number} frameMs 本帧耗时（渲染 + 逻辑，不含浏览器合成） */
  sample(frameMs) {
    if (!this.enabled) return;
    this.worstMs = Math.max(this.worstMs, frameMs);
    if (this.cooldown > 0) { this.cooldown--; return; }
    this.samples.push(frameMs);
    if (this.samples.length < this.windowFrames) return;

    let sum = 0;
    for (const s of this.samples) sum += s;
    this.avgMs = sum / this.samples.length;
    this.samples.length = 0;

    if (this.avgMs > this.budgetMs) {
      this.cooldown = this.cooldownFrames;
      this.onDowngrade(this.avgMs);
    }
  }
}

/**
 * 计算实际 DPR：档位上限 × 设备 DPR，再用像素预算封顶。
 * 美术圣经 §5.5 / AR-9：DPR 由程序控制，不接受 Retina 全分辨率。
 */
export function resolveDPR(tierName, deviceDPR, viewportW, viewportH, override = null) {
  const cfg = tierConfig(tierName);
  const isMobile = typeof navigator !== 'undefined' && isMobileUA();
  const base = isMobile ? cfg.dpr.mobile : cfg.dpr.desktop;
  let dpr = Math.min(deviceDPR || 1, base);
  const px = viewportW * viewportH * dpr * dpr;
  if (px > cfg.maxPixelBudget) {
    dpr *= Math.sqrt(cfg.maxPixelBudget / px);
  }
  if (override != null && override > 0) dpr = Math.min(dpr, override);
  return Math.max(0.6, Math.min(dpr, 3));
}

export default { TIERS, TIER_ORDER, tierConfig, probeDevice, FrameBenchmark, resolveDPR, isMobileUA };
