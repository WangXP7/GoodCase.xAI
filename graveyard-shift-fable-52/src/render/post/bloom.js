// Bloom: 13-tap downsample chain (Karis average on the first step so single hot pixels cannot
// flicker), 3x3 tent upsample blended back up the chain. Soft-knee threshold in exposed units, so
// what glows does not change as the eye adapts.
// Also carries sqrt(luminance) in alpha down the chain: the smallest mip is the metering source for
// eye adaptation (post.tex.luma).
import { WebGLRenderTarget, HalfFloatType, RGBAFormat, LinearFilter, Vector2, CustomBlending, AddEquation, SrcAlphaFactor, OneMinusSrcAlphaFactor, ZeroFactor, OneFactor } from 'three';

// a..m: the 13 taps. Each is a bilinear fetch covering 2x2 source texels.
const TAPS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel; // one source texel
#define TAP(x, y) texture(tSrc, vUv + vec2(x, y) * uTexel)
#define FETCH13 \
  vec4 a = TAP(-2.0, 2.0); vec4 b = TAP(0.0, 2.0); vec4 c = TAP(2.0, 2.0); \
  vec4 d = TAP(-2.0, 0.0); vec4 e = TAP(0.0, 0.0); vec4 f = TAP(2.0, 0.0); \
  vec4 g = TAP(-2.0, -2.0); vec4 h = TAP(0.0, -2.0); vec4 i = TAP(2.0, -2.0); \
  vec4 j = TAP(-1.0, 1.0); vec4 k = TAP(1.0, 1.0); vec4 l = TAP(-1.0, -1.0); vec4 m = TAP(1.0, -1.0);
`;

const PREFILTER_FRAG = TAPS + /* glsl */ `
uniform sampler2D tExposure;
uniform float uExposure;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  FETCH13
  float ev = uExposure * texture(tExposure, vec2(0.5)).r;
  // five overlapping 2x2 boxes, each weighted down by its own brightness (Karis)
  vec3 g0 = (a.rgb + b.rgb + d.rgb + e.rgb) * 0.25;
  vec3 g1 = (b.rgb + c.rgb + e.rgb + f.rgb) * 0.25;
  vec3 g2 = (d.rgb + e.rgb + g.rgb + h.rgb) * 0.25;
  vec3 g3 = (e.rgb + f.rgb + h.rgb + i.rgb) * 0.25;
  vec3 g4 = (j.rgb + k.rgb + l.rgb + m.rgb) * 0.25;
  float w0 = 0.125 / (1.0 + dot(g0, LUMA) * ev);
  float w1 = 0.125 / (1.0 + dot(g1, LUMA) * ev);
  float w2 = 0.125 / (1.0 + dot(g2, LUMA) * ev);
  float w3 = 0.125 / (1.0 + dot(g3, LUMA) * ev);
  float w4 = 0.5 / (1.0 + dot(g4, LUMA) * ev);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);

  // metering: sqrt of luminance (the chain averages it, the meter squares the mean). A plain mean
  // is ruled by the lamps and a log mean by the black sky; this sits between, and the cap keeps a
  // lamp walking into frame from slamming the exposure shut.
  vec3 avg = e.rgb * 0.125 + (a.rgb + c.rgb + g.rgb + i.rgb) * 0.03125 + (b.rgb + d.rgb + f.rgb + h.rgb) * 0.0625 + (j.rgb + k.rgb + l.rgb + m.rgb) * 0.125;
  float meterLum = sqrt(clamp(dot(avg, LUMA), 0.0, 8.0));

  // soft-knee threshold, in exposed units
  float t = uThreshold / ev;
  float kn = uKnee / ev;
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - t + kn, 0.0, 2.0 * kn);
  soft = soft * soft / (4.0 * kn + 1e-5);
  col *= max(soft, br - t) / max(br, 1e-5);
  // ceiling on what one pixel may feed the chain (in multiples of display white): a stray
  // specular spark thousands of times over white would otherwise bloom across the whole frame
  col *= min(1.0, (uClamp / ev) / max(max(col.r, max(col.g, col.b)), 1e-5));
  outColor = vec4(max(col, vec3(0.0)), meterLum);
}`;

const DOWN_FRAG = TAPS + /* glsl */ `
void main() {
  FETCH13
  outColor = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}`;

// 3x3 tent. Shared with composite.js for the last step up to full resolution.
export const BLOOM_UPSAMPLE = /* glsl */ `
vec3 bloomUpsample(sampler2D tex, vec2 uv, vec2 t) {
  vec3 s = texture(tex, uv).rgb * 4.0;
  s += (texture(tex, uv + vec2(t.x, 0.0)).rgb + texture(tex, uv - vec2(t.x, 0.0)).rgb
      + texture(tex, uv + vec2(0.0, t.y)).rgb + texture(tex, uv - vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(tex, uv + t).rgb + texture(tex, uv - t).rgb
     + texture(tex, uv + vec2(t.x, -t.y)).rgb + texture(tex, uv + vec2(-t.x, t.y)).rgb;
  return s * 0.0625;
}`;

// Drawn into the next larger mip with blending: dst.rgb = mix(dst.rgb, upsample(src), uRadius); dst.a kept.
const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
${BLOOM_UPSAMPLE}
void main() {
  outColor = vec4(bloomUpsample(tSrc, vUv, uTexel), uRadius);
}`;

export function createBloom() {
  let mips = [];
  let prefilter; let down; let up;

  return {
    name: 'bloom',
    init(post) {
      const u = post.uniforms;
      prefilter = post.fsMaterial({
        fragmentShader: PREFILTER_FRAG,
        uniforms: {
          tSrc: { value: null }, uTexel: { value: new Vector2() }, tExposure: { value: null },
          uExposure: u.exposure, uThreshold: u.bloomThreshold, uKnee: u.bloomKnee, uClamp: u.bloomClamp,
        },
      });
      down = post.fsMaterial({ fragmentShader: DOWN_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() } } });
      up = post.fsMaterial({
        fragmentShader: UP_FRAG,
        uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uRadius: u.bloomRadius },
        blending: CustomBlending, blendEquation: AddEquation,
        blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
      });
      this.count = post.quality.bloomMips || 6;
    },
    resize(w, h) {
      for (const m of mips) m.dispose();
      mips = [];
      let mw = Math.max(1, w >> 1);
      let mh = Math.max(1, h >> 1);
      for (let i = 0; i < this.count; i++) {
        mips.push(new WebGLRenderTarget(mw, mh, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }));
        if (Math.min(mw, mh) <= 4) break;
        mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      }
    },
    render(post) {
      if ((post.quality.bloomMips || 6) !== this.count) { this.count = post.quality.bloomMips || 6; this.resize(post.width, post.height); }
      const n = mips.length;
      prefilter.uniforms.tSrc.value = post.shared.tHdr.value;
      prefilter.uniforms.tExposure.value = post.tex.exposure;
      prefilter.uniforms.uTexel.value.set(1 / post.width, 1 / post.height);
      post.blit(prefilter, mips[0]);
      for (let i = 1; i < n; i++) {
        down.uniforms.tSrc.value = mips[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        post.blit(down, mips[i]);
      }
      post.tex.luma = mips[n - 1].texture;
      for (let i = n - 2; i >= 0; i--) {
        up.uniforms.tSrc.value = mips[i + 1].texture;
        up.uniforms.uTexel.value.set(1 / mips[i + 1].width, 1 / mips[i + 1].height);
        post.blit(up, mips[i]);
      }
      return mips[0].texture;
    },
    dispose() { for (const m of mips) m.dispose(); mips = []; },
  };
}
