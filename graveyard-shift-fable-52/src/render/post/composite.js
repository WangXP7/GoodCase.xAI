// Composite: HDR in, graded sRGB-encoded image out (post.targets.ldr).
//   meter  smallest bloom mip -> fixed 16x9 grid -> centre-weighted luminance (square of mean
//          sqrt) -> 1x1 exposure target, eased over time
//   main   + bloom + flare -> exposure -> vignette -> tone curve (ACES pulled toward AgX, eased
//          toe) -> split-tone night grade -> contrast -> saturation -> damage
// Chromatic aberration, grain and dither are applied in the final pass, in fxaa.js.
import { BLOOM_UPSAMPLE } from './bloom.js';
import { WebGLRenderTarget, HalfFloatType, RGBAFormat, NearestFilter, Vector2, Vector3, DataUtils } from 'three';

// Metering runs on a fixed 16x9 grid on every preset. The smallest bloom mip changes size with the
// preset (15x8 on high, 40x22 on low), so it is first box-filtered down to this grid with every
// source texel covered; sampling it sparsely would let a lamp slip between taps and pump exposure.
const METER_W = 16;
const METER_H = 9;

const METER_DOWN_FRAG = /* glsl */ `
uniform sampler2D tLuma; // .a = sqrt(luminance)
uniform vec2 uCell; // one output cell in uv
void main() {
  float sum = 0.0;
  for (int y = 0; y < 6; y++) {
    for (int x = 0; x < 6; x++) {
      vec2 o = (vec2(float(x), float(y)) + 0.5) / 6.0 - 0.5;
      sum += texture(tLuma, vUv + o * uCell).a;
    }
  }
  outColor = vec4(sum / 36.0);
}`;

const METER_FRAG = /* glsl */ `
uniform sampler2D tMeter; // 16x9, .a = sqrt(luminance)
uniform sampler2D tPrev; // .r = last frame's exposure
uniform float uDt;
uniform float uSnap;
uniform float uOn;
uniform float uKey;
uniform float uStrength;
uniform float uMin;
uniform float uMax;
uniform float uSpeedUp;
uniform float uSpeedDown;
void main() {
  float sum = 0.0;
  float wsum = 0.0;
  for (int y = 0; y < ${METER_H}; y++) {
    for (int x = 0; x < ${METER_W}; x++) {
      vec2 d = (vec2(float(x), float(y)) + 0.5) / vec2(${METER_W}.0, ${METER_H}.0) - 0.5;
      float w = exp(-4.0 * dot(d, d)); // centre 1.0, corners 0.14
      sum += texelFetch(tMeter, ivec2(x, y), 0).a * w;
      wsum += w;
    }
  }
  float avg = sum / wsum;
  avg = max(avg * avg, 1e-4);
  // Partial adaptation: a dark frame is lifted, but stays dark. Night should read as night.
  float target = clamp(pow(uKey / avg, uStrength), uMin, uMax);
  target = mix(1.0, target, uOn);
  float prev = texture(tPrev, vec2(0.5)).r;
  float rate = target < prev ? uSpeedDown : uSpeedUp; // closing down for brightness is the fast one
  float k = uSnap > 0.5 ? 1.0 : 1.0 - exp(-uDt * rate);
  outColor = vec4(mix(prev, target, k), avg, target, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform sampler2D tFlare;
uniform sampler2D tExposure;
uniform vec2 uBloomTexel;
uniform float uAspect;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uToneMix;
uniform float uShadowDetail;
uniform float uGrade;
uniform float uContrast;
uniform float uSaturation;
uniform float uDamage;
uniform float uBypass;
uniform vec3 uShadowTint;
uniform vec3 uShadowLift;
uniform vec3 uHighlightTint;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// ---- ACES (Stephen Hill's RRT+ODT fit) ----
vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 tonemapACES(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * (c / 0.6);
  c = rrtOdtFit(c);
  return clamp(outM * c, 0.0, 1.0);
}

// ---- AgX (minimal fit, rec2020 working primaries) ----
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tonemapAgX(vec3 c) {
  const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  c = inset * (toRec2020 * c);
  c = clamp((log2(max(c, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  c = outset * agxContrast(c);
  c = pow(max(c, vec3(0.0)), vec3(2.2));
  return clamp(fromRec2020 * c, 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

${BLOOM_UPSAMPLE}

// gentle S around a low pivot: night frames live below 0.4, a mid-grey pivot would crush them
vec3 sCurve(vec3 x, float k) {
  const float p = 0.36;
  vec3 lo = p * pow(max(x, vec3(0.0)) / p, vec3(1.0 + k));
  vec3 hi = 1.0 - (1.0 - p) * pow(max(1.0 - x, vec3(0.0)) / (1.0 - p), vec3(1.0 + k));
  return mix(lo, hi, step(vec3(p), x));
}

void main() {
  vec2 da = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(da, da) / (0.25 * (uAspect * uAspect + 1.0)); // 0 centre, 1 corner
  float ev = uExposure * texture(tExposure, vec2(0.5)).r;
  vec3 c = texture(tHdr, vUv).rgb;
  if (uBypass > 0.5) { outColor = vec4(toSRGB(clamp(c * ev, 0.0, 1.0)), 1.0); return; }

  c += bloomUpsample(tBloom, vUv, uBloomTexel) * uBloomStrength; // the chain ends at half resolution
  c += texture(tFlare, vUv).rgb;
  c *= ev;
  c *= 1.0 - uVignette * pow(r2, 1.5); // before the curve, so bright edges still roll off

  // Both curves have a film toe that sends scene values under ~0.005 to pure black. At night
  // that is most of the frame, so the bottom of the curve is eased back toward a straight line.
  vec3 mapped = mix(tonemapACES(c), tonemapAgX(c), uToneMix);
  vec3 toeW = (1.0 - smoothstep(0.0, 0.06, c)) * uShadowDetail;
  c = toSRGB(mix(mapped, max(mapped, c * 0.75), toeW));

  // split tone: cold blue-green in the shadows, warm sodium in the highlights
  float l = dot(c, LUMA);
  float ws = (1.0 - smoothstep(0.0, 0.42, l)) * uGrade;
  float wh = smoothstep(0.38, 0.8, l) * (1.0 - 0.6 * smoothstep(0.86, 1.0, l)) * uGrade; // eases off so white stays white
  c = c * mix(vec3(1.0), uShadowTint, ws) + uShadowLift * ws;
  c *= mix(vec3(1.0), uHighlightTint, wh);
  c = mix(c, sCurve(c, uContrast), step(1e-4, uContrast));
  l = dot(c, LUMA);
  c = mix(vec3(l), c, uSaturation);

  // hurt: blood-red creep from the edges, colour drained
  float edge = smoothstep(0.1, 1.0, r2);
  float dm = uDamage * (0.2 + 0.8 * edge);
  c = mix(c, vec3(l) * vec3(0.95, 0.16, 0.12) + vec3(0.22, 0.0, 0.0) * edge, dm);

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function createComposite({ bypass = false } = {}) {
  let meter; let meterDown; let meterGrid; let main;
  let adapt = [];
  let cur = 0;
  const readBuf = new Uint16Array(4);

  return {
    name: 'composite',
    init(post) {
      const u = post.uniforms;
      const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false };
      adapt = [new WebGLRenderTarget(1, 1, opts), new WebGLRenderTarget(1, 1, opts)];
      meterGrid = new WebGLRenderTarget(METER_W, METER_H, opts);
      meterDown = post.fsMaterial({
        fragmentShader: METER_DOWN_FRAG,
        uniforms: { tLuma: { value: null }, uCell: { value: new Vector2(1 / METER_W, 1 / METER_H) } },
      });
      meter = post.fsMaterial({
        fragmentShader: METER_FRAG,
        uniforms: {
          tMeter: { value: meterGrid.texture }, tPrev: { value: null }, uDt: { value: 0 }, uSnap: { value: 1 }, uOn: u.adaptOn,
          uKey: u.adaptKey, uStrength: u.adaptStrength, uMin: u.adaptMin, uMax: u.adaptMax,
          uSpeedUp: u.adaptSpeedUp, uSpeedDown: u.adaptSpeedDown,
        },
      });
      main = post.fsMaterial({
        fragmentShader: COMPOSITE_FRAG,
        uniforms: {
          tHdr: post.shared.tHdr, tBloom: { value: null }, tFlare: { value: null }, tExposure: { value: null },
          uBloomTexel: { value: new Vector2() }, uAspect: { value: 1 },
          uExposure: u.exposure, uBloomStrength: u.bloomStrength, uVignette: u.vignette,
          uToneMix: u.toneMix, uShadowDetail: u.shadowDetail, uGrade: u.gradeAmount, uContrast: u.contrast, uSaturation: u.saturation, uDamage: u.damage,
          uBypass: { value: bypass ? 1 : 0 },
          // multipliers / offsets in display-encoded space
          uShadowTint: { value: new Vector3(0.84, 1.0, 1.05) },
          uShadowLift: { value: new Vector3(0.0015, 0.005, 0.0065) },
          uHighlightTint: { value: new Vector3(1.045, 1.0, 0.9) },
        },
      });
      this.material = main;
      // Debug: current { exposure, avgLum, target } read back from the GPU (slow; not for per-frame use).
      post.readExposure = () => {
        post.renderer.readRenderTargetPixels(adapt[cur], 0, 0, 1, 1, readBuf);
        const f = (i) => DataUtils.fromHalfFloat(readBuf[i]);
        return { exposure: f(0), avgLum: f(1), target: f(2) };
      };
    },
    render(post) {
      const next = 1 - cur;
      meterDown.uniforms.tLuma.value = post.tex.luma;
      post.blit(meterDown, meterGrid);
      meter.uniforms.tPrev.value = adapt[cur].texture;
      meter.uniforms.uDt.value = post.adaptHold && !post.snap ? 0 : post.time.dt; // held during a muzzle flash (chain.js)
      meter.uniforms.uSnap.value = post.snap ? 1 : 0;
      post.blit(meter, adapt[next]);
      cur = next;
      post.tex.exposure = adapt[cur].texture;

      const bloom = post.tex.bloom;
      main.uniforms.tBloom.value = bloom;
      main.uniforms.uBloomTexel.value.set(1 / (bloom.image.width || 1), 1 / (bloom.image.height || 1));
      main.uniforms.tFlare.value = post.tex.flare;
      main.uniforms.tExposure.value = post.tex.exposure;
      main.uniforms.uAspect.value = post.width / post.height;
      post.blit(main, post.targets.ldr);
      return post.targets.ldr.texture;
    },
    dispose() { for (const t of adapt) t.dispose(); if (meterGrid) meterGrid.dispose(); },
  };
}
