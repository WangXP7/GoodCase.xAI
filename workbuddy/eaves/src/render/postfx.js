/**
 * postfx.js —— 自写 3-pass 后处理管线（tilt-shift + 色彩分级 + 暗角 + 颗粒）
 *
 * 依据：ADR-101 §2.2 / §4.2
 *   明确**不引入** EffectComposer —— 它会额外分配 2 张全分辨率 RT
 *   （中端移动 +9.6 MiB）并强制多 pass 全屏复制。我们只需：
 *     1 张全分辨率 RT + 1 张 1/div ping-pong，省约 12 MiB。
 *
 * 管线：
 *   场景 → RT_color（全分辨率 RGBA8）
 *        → pass1: 降采样 + 水平模糊   （1/div，H 档 div=4，M/L 档 div=8）
 *        → pass2: 垂直模糊            （1/div，ping-pong）
 *        → pass3: 上采样合成 + tilt-shift 权重 + 色彩分级 + 暗角 + 颗粒 → 屏幕
 */

import * as THREE from 'three';

/** 全屏三角形顶点着色器（比 quad 少一次光栅化冗余，且无对角线接缝） */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** pass1 / pass2 —— 可分离高斯模糊（9-tap） */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;   // 1 / 目标分辨率
uniform vec2 uDir;     // (1,0) 水平 或 (0,1) 垂直
varying vec2 vUv;

void main() {
  float w0 = 0.227027;
  float w1 = 0.1945946;
  float w2 = 0.1216216;
  float w3 = 0.0540540;
  float w4 = 0.0162162;

  vec4 sum = texture2D(tDiffuse, vUv) * w0;
  sum += texture2D(tDiffuse, vUv + uDir * uTexel * 1.3) * w1;
  sum += texture2D(tDiffuse, vUv - uDir * uTexel * 1.3) * w1;
  sum += texture2D(tDiffuse, vUv + uDir * uTexel * 2.6) * w2;
  sum += texture2D(tDiffuse, vUv - uDir * uTexel * 2.6) * w2;
  sum += texture2D(tDiffuse, vUv + uDir * uTexel * 3.9) * w3;
  sum += texture2D(tDiffuse, vUv - uDir * uTexel * 3.9) * w3;
  sum += texture2D(tDiffuse, vUv + uDir * uTexel * 5.2) * w4;
  sum += texture2D(tDiffuse, vUv - uDir * uTexel * 5.2) * w4;

  gl_FragColor = sum;
}
`;

/** pass3 —— 合成 */
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform float uFocusY;      // 清晰带中心（0–1，屏幕纵向）
uniform float uFocusRange;  // 清晰带半宽
uniform float uMaxBlur;     // 最大模糊混合强度
uniform vec3  uLift;        // 色彩分级：抬升暗部
uniform vec3  uGain;        // 色彩分级：增益
uniform float uVignette;    // 暗角强度
uniform float uGrain;       // 颗粒强度
uniform float uTime;
varying vec2 vUv;

void main() {
  // tilt-shift：离清晰带越远，模糊权重越高
  float d = abs(vUv.y - uFocusY);
  float coc = smoothstep(uFocusRange, uFocusRange + 0.38, d);

  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec3 blurred = texture2D(tBlur, vUv).rgb;
  vec3 col = mix(sharp, blurred, clamp(coc * uMaxBlur, 0.0, 1.0));

  // 色彩分级（必须在 ACES 之后，ADR-101 §5.3）
  col = col * uGain + uLift;

  // 暗角
  vec2 p = vUv - 0.5;
  float v = 1.0 - dot(p, p) * uVignette;
  col *= clamp(v, 0.0, 1.0);

  // 极轻颗粒：等距大色块容易出现色带（banding），用噪声打散
  float n = fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}
`;

/** 直通 blit（后处理关闭时把 RT 原样输出到屏幕） */
const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`;

function makeRT(w, h, samples = 0) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    colorSpace: THREE.SRGBColorSpace,
  });
  if (samples > 0) rt.samples = samples;
  return rt;
}

/**
 * 3-pass 后处理。
 *
 * 用法：
 *   const fx = new PostFX(renderer, cfg.postfx);
 *   fx.setSize(w, h, dpr);
 *   fx.render(scene, camera, elapsedSeconds);
 */
export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} postCfg 来自 tierConfig().postfx
   */
  constructor(renderer, postCfg = {}) {
    this.renderer = renderer;
    this.cfg = {
      tiltShift: true,
      grading: true,
      vignette: true,
      blurDiv: 8,
      fxaa: false,
      ...postCfg,
    };

    // 全屏三角形（覆盖 NDC，无需相机矩阵）
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        uDir: { value: new THREE.Vector2(1, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: null },
        tBlur: { value: null },
        uFocusY: { value: 0.52 },
        uFocusRange: { value: 0.26 },
        uMaxBlur: { value: 1.0 },
        uLift: { value: new THREE.Vector3(0.006, 0.004, 0.002) },
        uGain: { value: new THREE.Vector3(1.02, 1.0, 0.985) },
        uVignette: { value: 0.32 },
        uGrain: { value: 0.012 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.matCopy = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tDiffuse: { value: null } },
      depthTest: false,
      depthWrite: false,
    });

    this.rtColor = null;
    this.rtBlurA = null;
    this.rtBlurB = null;
    this._size = { w: 1, h: 1, dpr: 1 };
  }

  /** 是否真正启用后处理（tilt-shift 关闭且无分级时直通） */
  get enabled() {
    return !!(this.cfg.tiltShift || this.cfg.grading || this.cfg.vignette);
  }

  /**
   * 尺寸变更。
   * @param {number} w CSS 宽
   * @param {number} h CSS 高
   * @param {number} dpr 像素比
   * @param {number} [samples] RT 的 MSAA 采样数（H 档为 4）
   */
  setSize(w, h, dpr, samples = 0) {
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    const div = this.cfg.blurDiv || 8;
    const bw = Math.max(1, Math.floor(pw / div));
    const bh = Math.max(1, Math.floor(ph / div));

    this._disposeRTs();
    this.rtColor = makeRT(pw, ph, samples);
    this.rtBlurA = makeRT(bw, bh, 0);
    this.rtBlurB = makeRT(bw, bh, 0);

    this.matBlur.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    this._size = { w, h, dpr };
    this._blurSize = { bw, bh };
  }

  /**
   * 执行一帧渲染。
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {number} elapsed 累计真实秒（颗粒动画用）
   */
  render(scene, camera, elapsed = 0) {
    const r = this.renderer;

    if (!this.enabled || !this.rtColor) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    // 场景 → RT_color
    r.setRenderTarget(this.rtColor);
    r.clear();
    r.render(scene, camera);

    // pass1：降采样 + 水平模糊  RT_color → rtBlurA
    this.quad.material = this.matBlur;
    this.matBlur.uniforms.tDiffuse.value = this.rtColor.texture;
    this.matBlur.uniforms.uDir.value.set(1, 0);
    r.setRenderTarget(this.rtBlurA);
    r.clear();
    r.render(this.quadScene, this.quadCam);

    // pass2：垂直模糊  rtBlurA → rtBlurB（ping-pong）
    this.matBlur.uniforms.tDiffuse.value = this.rtBlurA.texture;
    this.matBlur.uniforms.uDir.value.set(0, 1);
    r.setRenderTarget(this.rtBlurB);
    r.clear();
    r.render(this.quadScene, this.quadCam);

    // pass3：合成 → 屏幕
    this.quad.material = this.matComposite;
    const u = this.matComposite.uniforms;
    u.tColor.value = this.rtColor.texture;
    u.tBlur.value = this.rtBlurB.texture;
    u.uMaxBlur.value = this.cfg.tiltShift ? 1.0 : 0.0;
    u.uVignette.value = this.cfg.vignette ? 0.32 : 0.0;
    u.uGrain.value = 0.012;
    if (!this.cfg.grading) {
      u.uLift.value.set(0, 0, 0);
      u.uGain.value.set(1, 1, 1);
    }
    u.uTime.value = elapsed;

    r.setRenderTarget(null);
    r.clear();
    r.render(this.quadScene, this.quadCam);
  }

  /**
   * 调整色调（季节 / 天气 / 时段氛围用）。
   * @param {{lift?:[number,number,number], gain?:[number,number,number], focusY?:number, focusRange?:number}} o
   */
  setGrading(o = {}) {
    const u = this.matComposite.uniforms;
    if (o.lift) u.uLift.value.fromArray(o.lift);
    if (o.gain) u.uGain.value.fromArray(o.gain);
    if (o.focusY != null) u.uFocusY.value = o.focusY;
    if (o.focusRange != null) u.uFocusRange.value = o.focusRange;
  }

  _disposeRTs() {
    if (this.rtColor) this.rtColor.dispose();
    if (this.rtBlurA) this.rtBlurA.dispose();
    if (this.rtBlurB) this.rtBlurB.dispose();
    this.rtColor = this.rtBlurA = this.rtBlurB = null;
  }

  dispose() {
    this._disposeRTs();
    this.matBlur.dispose();
    this.matComposite.dispose();
    this.matCopy.dispose();
    this.quad.geometry.dispose();
  }
}

export default PostFX;
