// Everything that happens to the frame after the scene is drawn:
// light shafts marched through the cascaded shadow maps, depth of field, bloom, eye adaptation,
// filmic tone mapping, grade, vignette, grain, FXAA.
import * as THREE from 'three';
import { shared, sharedUniforms } from './shared.js';
import './atmos.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VOLUMETRIC = /* glsl */ `
#include <common>
#include <packing>
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform mat4 uViewMat;
uniform sampler2D uShadow0;
uniform sampler2D uShadow1;
uniform sampler2D uShadow2;
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform mat4 uShadowMat2;
uniform vec2 uCascades[3];
uniform float uShadowRange;
uniform float uFrame;
uniform float uMaxDist;

float shadowAt(sampler2D map, mat4 m, vec3 p) {
  vec4 sc = m * vec4(p, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  return step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(map, sc.xy)));
}
void main() {
  float depth = texture2D(tDepth, vUv).x;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  wp /= wp.w;
  vec3 ray = wp.xyz - uCamPos;
  float len = length(ray);
  vec3 dir = ray / len;
  float dist = min(len, uMaxDist);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * vec2(47.0, 17.0), vec2(0.06711056, 0.00583715))));
  const int N = 26;
  float T = 1.0;
  float scat = 0.0;
  float prev = 0.0;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + jit) / float(N);
    float t = dist * f * f;
    float seg = t - prev;
    prev = t;
    vec3 p = uCamPos + dir * t;
    float dens = uFogA.x * exp(-uFogA.y * (p.y - uFogA.z)) + uFogA.w;
    float lit = 1.0;
    float ld = -(uViewMat * vec4(p, 1.0)).z / uShadowRange;
    if (ld < uCascades[0].y) lit = shadowAt(uShadow0, uShadowMat0, p);
    else if (ld < uCascades[1].y) lit = shadowAt(uShadow1, uShadowMat1, p);
    else if (ld < 1.0) lit = mix(shadowAt(uShadow2, uShadowMat2, p), 1.0, smoothstep(0.85, 1.0, ld));
    lit *= tpCloudShadow(p);
    float a = 1.0 - exp(-dens * seg);
    scat += T * a * lit;
    T *= 1.0 - a;
  }
  float lobe = pow(max(dot(dir, uSunDir), 0.0), uFogB.x);
  gl_FragColor = vec4(uFogSunColor * (0.7 * lobe + 0.085) * scat * uFogB.y, 1.0);
}
`;

// Depth-aware blur of the half-resolution shafts.
const VOL_BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tVol;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform float uNear;
uniform float uFar;
float lin(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  float d0 = lin(texture2D(tDepth, vUv).x);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float d = lin(texture2D(tDepth, uv).x);
    float w = exp(-float(i * i) * 0.18) * (1.0 / (1.0 + abs(d - d0) / (0.06 * d0 + 0.02)));
    acc += texture2D(tVol, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const DOF = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uRange;
uniform float uMaxBlur;
float lin(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
float coc(float z) { return clamp((abs(z - uFocus) - uRange * 0.25) / uRange, 0.0, 1.0) * uMaxBlur; }
void main() {
  float z0 = lin(texture2D(tDepth, vUv).x);
  float c0 = coc(z0);
  vec3 acc = texture2D(tColor, vUv).rgb;
  float wsum = 1.0;
  const float GA = 2.39996323;
  for (int i = 1; i <= 22; i++) {
    float r = sqrt(float(i) / 22.0);
    float a = float(i) * GA;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * c0 * uTexel;
    float z = lin(texture2D(tDepth, uv).x);
    float c = coc(z);
    // a sharp thing in front must not bleed into the blur behind it
    float w = (z < z0 - 0.05 && c < c0 * 0.5) ? 0.08 : 1.0;
    acc += texture2D(tColor, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    // weigh each group by 1 / (1 + luma) so one burning pixel cannot flicker the whole bloom
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = 0.5 / (1.0 + luma(g0)), w1 = 0.125 / (1.0 + luma(g1)), w2 = 0.125 / (1.0 + luma(g2)), w3 = 0.125 / (1.0 + luma(g3)), w4 = 0.125 / (1.0 + luma(g4));
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(40.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 uTexel;
uniform float uSpread;
void main() {
  vec2 t = uTexel * uSpread;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16.0 + texture2D(tAdd, vUv).rgb, 1.0);
}
`;

// One pixel that follows the scene's average brightness with a little inertia.
const LUM = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform float uRate;
uniform float uFrame;
void main() {
  float acc = 0.0, wsum = 0.0;
  for (int y = 0; y < 6; y++) for (int x = 0; x < 10; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5 + 0.35 * vec2(sin(uFrame * 1.7 + float(x)), cos(uFrame * 2.3 + float(y)))) / vec2(10.0, 6.0);
    vec3 c = texture2D(tSrc, uv).rgb;
    // meter the ground more than the sky: it is the ground one has to walk on
    float w = (1.0 - 0.6 * length(uv - 0.5)) * (1.0 - 0.6 * smoothstep(0.5, 0.95, uv.y));
    acc += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4)) * w;
    wsum += w;
  }
  float cur = exp(acc / wsum);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  gl_FragColor = vec4(vec3(mix(prev, cur, uRate)), 1.0);
}
`;

const COMPOSITE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tVol;
uniform sampler2D tLum;
uniform float uBloom;
uniform float uVolOn;
uniform float uExposure;
uniform float uAdapt;
uniform float uTime;
uniform float uSat;
uniform float uContrast;
uniform vec3 uTint;
uniform vec3 uShadowTint;
uniform float uVignette;
uniform float uGrain;
uniform float uGloom;
uniform float uHurt;
uniform float uFade;
uniform float uFrost;
uniform float uAberr;
uniform vec2 uAspect;

// ACES fit by Stephen Hill
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = IN * c;
  c = RRTAndODTFit(c);
  return clamp(OUT * c, 0.0, 1.0);
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc * uAspect, cc * uAspect);
  vec3 hdr;
  if (uAberr > 0.0) {
    vec2 o = cc * r2 * uAberr;
    hdr = vec3(texture2D(tColor, uv + o).r, texture2D(tColor, uv).g, texture2D(tColor, uv - o).b);
  } else hdr = texture2D(tColor, uv).rgb;
  if (uVolOn > 0.5) hdr += texture2D(tVol, uv).rgb;
  hdr += texture2D(tBloom, uv).rgb * uBloom;

  float lum = texture2D(tLum, vec2(0.5)).r;
  float ev = uExposure * mix(1.0, clamp(0.125 / max(lum * uExposure, 1e-3), 0.5, 1.9), uAdapt);
  vec3 col = aces(hdr * ev * 1.6);

  // grade (display-referred, linear)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = mix(col, col * uShadowTint * 1.0, (1.0 - smoothstep(0.0, 0.35, l)) * 0.6);
  col *= uTint;
  col = (col - 0.18) * uContrast + 0.18;
  col = max(col, 0.0);
  // the Gloom: colour drains, violet creeps in from the edges
  if (uGloom > 0.0) {
    float g = uGloom * (0.55 + 0.9 * smoothstep(0.05, 0.6, r2));
    float lg = dot(col, vec3(0.3, 0.6, 0.1));
    // fire is the one thing the Gloom cannot bleach: whatever burns warm and bright keeps its colour
    float warm = smoothstep(0.03, 0.22, col.r - max(col.g, col.b) * 0.92) * smoothstep(0.05, 0.32, col.r);
    warm = max(warm, smoothstep(0.62, 0.95, lg));
    col = mix(col, vec3(lg) * vec3(0.72, 0.62, 0.95), clamp(g, 0.0, 0.9) * (1.0 - 0.85 * warm));
    col *= 1.0 - 0.3 * uGloom * smoothstep(0.1, 0.75, r2);
  }
  if (uFrost > 0.0) col = mix(col, vec3(l) * vec3(0.75, 0.9, 1.1) + 0.04, uFrost * smoothstep(0.08, 0.6, r2));
  col *= 1.0 - uVignette * smoothstep(0.12, 0.95, r2);
  if (uHurt > 0.0) col = mix(col, vec3(0.32, 0.0, 0.0), uHurt * smoothstep(0.06, 0.62, r2));
  col *= 1.0 - uFade;

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  float n = hash(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5;
  col += n * (uGrain * (0.5 + 0.9 * (1.0 - l)) + 1.0 / 255.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), dot(clamp(col, 0.0, 1.0), vec3(0.299, 0.587, 0.114)));
}
`;

const FXAA = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec4 M = texture2D(tSrc, vUv);
  float lM = M.a;
  float lN = texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).a;
  float lS = texture2D(tSrc, vUv - vec2(0.0, uTexel.y)).a;
  float lE = texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).a;
  float lW = texture2D(tSrc, vUv - vec2(uTexel.x, 0.0)).a;
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) {
    gl_FragColor = vec4(M.rgb, 1.0);
    return;
  }
  float lNW = texture2D(tSrc, vUv + vec2(-uTexel.x, uTexel.y)).a;
  float lNE = texture2D(tSrc, vUv + uTexel).a;
  float lSW = texture2D(tSrc, vUv - uTexel).a;
  float lSE = texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).a;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
  vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
  vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5) + texture2D(tSrc, vUv + dir * 0.5));
  gl_FragColor = vec4((B.a < lMin || B.a > lMax) ? A.rgb : B.rgb, 1.0);
}
`;

const COPY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }
`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.frame = 0;

    // public knobs
    this.volumetric = true;
    this.fxaa = true;
    this.dof = 0; // 0 off .. 1 full
    this.focus = 2;
    this.focusRange = 2.5;
    this.grade = { sat: 0.86, contrast: 1.1, tint: new THREE.Color(1, 1, 1), shadowTint: new THREE.Color(0.86, 0.96, 1.1), vignette: 0.5, grain: 0.035, gloom: 0, hurt: 0, fade: 0, frost: 0, aberr: 0.004, bloom: 0.9, adapt: 1 };
    this.exposure = 1;

    const mk = (w, h, type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.mk = mk;
    this.vol = [mk(2, 2), mk(2, 2)];
    this.dofRT = mk(2, 2);
    this.ldr = mk(2, 2, THREE.UnsignedByteType);
    this.lum = [mk(1, 1), mk(1, 1)];
    this.down = [];
    this.up = [];
    this.levels = 6;
    for (let i = 0; i < this.levels; i++) {
      this.down.push(mk(2, 2));
      this.up.push(mk(2, 2));
    }

    this.mVol = pass(
      VOLUMETRIC,
      sharedUniforms({
        tDepth: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() },
        uViewMat: { value: new THREE.Matrix4() },
        uShadow0: { value: null },
        uShadow1: { value: null },
        uShadow2: { value: null },
        uShadowMat0: { value: new THREE.Matrix4() },
        uShadowMat1: { value: new THREE.Matrix4() },
        uShadowMat2: { value: new THREE.Matrix4() },
        uCascades: { value: shared.CSM_cascades.value },
        uShadowRange: { value: 190 },
        uFrame: { value: 0 },
        uMaxDist: { value: 520 },
      })
    );
    this.mVolBlur = pass(VOL_BLUR, { tVol: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.mDof = pass(DOF, { tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 2 }, uRange: { value: 2 }, uMaxBlur: { value: 9 } });
    this.mDown = pass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 0.85 } });
    this.mUp = pass(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1 } });
    this.mLum = pass(LUM, { tSrc: { value: null }, tPrev: { value: null }, uRate: { value: 0.05 }, uFrame: { value: 0 } });
    this.mComp = pass(COMPOSITE, {
      tColor: { value: null },
      tBloom: { value: null },
      tVol: { value: null },
      tLum: { value: null },
      uBloom: { value: 1 },
      uVolOn: { value: 1 },
      uExposure: { value: 1 },
      uAdapt: { value: 1 },
      uTime: { value: 0 },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uShadowTint: { value: new THREE.Color(1, 1, 1) },
      uVignette: { value: 0.4 },
      uGrain: { value: 0.03 },
      uGloom: { value: 0 },
      uHurt: { value: 0 },
      uFade: { value: 0 },
      uFrost: { value: 0 },
      uAberr: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
    });
    this.mFxaa = pass(FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mCopy = pass(COPY, { tSrc: { value: null } });
    this._m = new THREE.Matrix4();
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    const hw = Math.max(2, w >> 1),
      hh = Math.max(2, h >> 1);
    this.vol[0].setSize(hw, hh);
    this.vol[1].setSize(hw, hh);
    this.dofRT.setSize(w, h);
    this.ldr.setSize(w, h);
    let dw = hw,
      dh = hh;
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(dw, dh);
      this.up[i].setSize(dw, dh);
      dw = Math.max(2, dw >> 1);
      dh = Math.max(2, dh >> 1);
    }
  }

  draw(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.quad, this.cam);
  }

  /** main: the HDR scene target with a depth texture. Draws the finished frame to the canvas. */
  render(main, camera, lighting, dt) {
    const r = this.r;
    this.frame++;
    const depth = main.depthTexture;
    let color = main.texture;

    // light shafts
    const volOn = this.volumetric && shared.uFogSunColor.value.r + shared.uFogSunColor.value.g + shared.uFogSunColor.value.b > 0.002;
    if (volOn) {
      const u = this.mVol.uniforms;
      u.tDepth.value = depth;
      this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      u.uInvViewProj.value.copy(this._m).invert();
      u.uViewMat.value.copy(camera.matrixWorldInverse);
      const L = lighting.csm.lights;
      for (let i = 0; i < 3; i++) {
        u['uShadow' + i].value = L[i].shadow.map ? L[i].shadow.map.texture : null;
        u['uShadowMat' + i].value.copy(L[i].shadow.matrix);
      }
      u.uShadowRange.value = shared.shadowFar.value - shared.cameraNear.value;
      u.uFrame.value = this.frame % 8;
      this.draw(this.mVol, this.vol[0]);
      const b = this.mVolBlur.uniforms;
      b.tDepth.value = depth;
      b.uNear.value = camera.near;
      b.uFar.value = camera.far;
      b.tVol.value = this.vol[0].texture;
      b.uDir.value.set(1.5 / this.vol[0].width, 0);
      this.draw(this.mVolBlur, this.vol[1]);
      b.tVol.value = this.vol[1].texture;
      b.uDir.value.set(0, 1.5 / this.vol[0].height);
      this.draw(this.mVolBlur, this.vol[0]);
    }

    // depth of field
    if (this.dof > 0.01) {
      const u = this.mDof.uniforms;
      u.tColor.value = color;
      u.tDepth.value = depth;
      u.uTexel.value.set(1 / this.w, 1 / this.h);
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uFocus.value = this.focus;
      u.uRange.value = this.focusRange;
      u.uMaxBlur.value = 10 * this.dof * (this.h / 1080);
      this.draw(this.mDof, this.dofRT);
      color = this.dofRT.texture;
    }

    // bloom
    const d = this.mDown.uniforms;
    let src = color,
      sw = this.w,
      sh = this.h;
    for (let i = 0; i < this.levels; i++) {
      d.tSrc.value = src;
      d.uTexel.value.set(1 / sw, 1 / sh);
      d.uFirst.value = i === 0 ? 1 : 0;
      this.draw(this.mDown, this.down[i]);
      src = this.down[i].texture;
      sw = this.down[i].width;
      sh = this.down[i].height;
    }
    const up = this.mUp.uniforms;
    let acc = this.down[this.levels - 1].texture,
      aw = this.down[this.levels - 1].width,
      ah = this.down[this.levels - 1].height;
    for (let i = this.levels - 2; i >= 0; i--) {
      up.tSrc.value = acc;
      up.tAdd.value = this.down[i].texture;
      up.uTexel.value.set(1 / aw, 1 / ah);
      this.draw(this.mUp, this.up[i]);
      acc = this.up[i].texture;
      aw = this.up[i].width;
      ah = this.up[i].height;
    }

    // eye adaptation (reads the unthresholded scene)
    const lu = this.mLum.uniforms;
    lu.tSrc.value = color;
    lu.tPrev.value = this.lum[0].texture;
    lu.uRate.value = this.frame < 3 ? 1 : 1 - Math.exp(-dt * 1.4);
    lu.uFrame.value = this.frame;
    this.draw(this.mLum, this.lum[1]);
    this.lum.reverse();

    // composite
    const c = this.mComp.uniforms,
      g = this.grade;
    c.tColor.value = color;
    c.tBloom.value = acc;
    c.tVol.value = this.vol[0].texture;
    c.tLum.value = this.lum[0].texture;
    c.uVolOn.value = volOn ? 1 : 0;
    c.uBloom.value = g.bloom / (this.levels - 1);
    c.uExposure.value = this.exposure;
    c.uAdapt.value = g.adapt;
    c.uTime.value = shared.uTime.value;
    c.uSat.value = g.sat;
    c.uContrast.value = g.contrast;
    c.uTint.value.copy(g.tint);
    c.uShadowTint.value.copy(g.shadowTint);
    c.uVignette.value = g.vignette;
    c.uGrain.value = g.grain;
    c.uGloom.value = g.gloom;
    c.uHurt.value = g.hurt;
    c.uFade.value = g.fade;
    c.uFrost.value = g.frost;
    c.uAberr.value = g.aberr;
    c.uAspect.value.set(this.w / this.h, 1);
    if (this.fxaa) {
      this.draw(this.mComp, this.ldr);
      this.mFxaa.uniforms.tSrc.value = this.ldr.texture;
      this.mFxaa.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.draw(this.mFxaa, null);
    } else {
      this.draw(this.mComp, this.ldr);
      this.mCopy.uniforms.tSrc.value = this.ldr.texture;
      this.draw(this.mCopy, null);
    }
  }
}
