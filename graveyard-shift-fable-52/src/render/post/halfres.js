// Reduced-resolution support shared by ambient occlusion and volumetrics: a linear-depth target at
// 1/2 or 1/4 size, a depth-aware separable blur, and the GLSL for the joint bilateral upsample.
// Low-res texel (i, j) holds the depth of full-res texel (s*i, s*j), s = the factor; every low-res
// shader reconstructs its view ray through that texel's centre, so low-res results and depths
// always belong together. (The GLSL names say "half" for both factors.)
import { WebGLRenderTarget, RedFormat, FloatType, NearestFilter, Vector2 } from 'three';

const DEPTH_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform int uLowScale;
void main() {
  ivec2 c = min(ivec2(gl_FragCoord.xy) * uLowScale, textureSize(tDepth, 0) - 1);
  float d = texelFetch(tDepth, c, 0).r;
  outColor = vec4((cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d), 0.0, 0.0, 1.0);
}`;

// Declares tHalfDepth and the helpers half-res shaders use.
export const HALF_GLSL = /* glsl */ `
uniform sampler2D tHalfDepth; // .r = metres along the view axis
uniform vec2 uFullTexel;      // 1 / full resolution
uniform vec2 uInvProj;        // 1 / projection[0][0], 1 / projection[1][1]
uniform int uLowScale;        // full-res texels per low-res texel (2 or 4)
float halfZ(ivec2 c) { return texelFetch(tHalfDepth, clamp(c, ivec2(0), textureSize(tHalfDepth, 0) - 1), 0).r; }
// full-res uv of the texel a half-res texel stands for
vec2 halfUv(ivec2 c) { return (vec2(c * uLowScale) + 0.5) * uFullTexel; }
vec3 halfViewPos(ivec2 c, float z) { return vec3((halfUv(c) * 2.0 - 1.0) * uInvProj * z, -z); }
// interleaved gradient noise: neighbouring pixels get well-spread values, so a small blur removes it
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// Seven-tap gaussian along uDir that stops at depth edges. The centre's depth slope along the blur
// axis is followed, so a floor seen at a grazing angle still blurs.
const BLUR_FRAG = HALF_GLSL + /* glsl */ `
uniform sampler2D tSrc;
uniform ivec2 uDir;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float zc = halfZ(c);
  float zm = halfZ(c - uDir); float zp = halfZ(c + uDir);
  float slope = abs(zc - zm) < abs(zp - zc) ? zc - zm : zp - zc;
  float tol = 1.0 / (0.05 + 0.012 * zc);
  vec4 sum = texelFetch(tSrc, c, 0) * 0.2;
  float wsum = 0.2;
  ivec2 hi = textureSize(tSrc, 0) - 1;
  for (int k = 1; k <= 3; k++) {
    float g = k == 1 ? 0.176 : (k == 2 ? 0.121 : 0.065);
    for (int s = -1; s <= 1; s += 2) {
      ivec2 q = clamp(c + uDir * (k * s), ivec2(0), hi);
      float e = (halfZ(q) - (zc + slope * float(k * s))) * tol;
      float w = g * exp(-e * e);
      sum += texelFetch(tSrc, q, 0) * w;
      wsum += w;
    }
  }
  outColor = sum / wsum;
}`;

// vec4 upsampleHalf(sampler2D tex, float zFull): joint bilateral upsample of a low-res texture at
// the current full-res fragment. Needs HALF_GLSL.
export const UPSAMPLE_GLSL = /* glsl */ `
vec4 upsampleHalf(sampler2D tex, float zFull) {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 b = p / uLowScale;
  vec2 f = vec2(p - b * uLowScale) / float(uLowScale);
  ivec2 hi = textureSize(tex, 0) - 1;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 q = min(b + ivec2(i, j), hi);
      float w = (i == 1 ? f.x : 1.0 - f.x) * (j == 1 ? f.y : 1.0 - f.y);
      w *= 1.0 / (0.01 * zFull + abs(texelFetch(tHalfDepth, q, 0).r - zFull));
      w += 1e-5;
      sum += texelFetch(tex, q, 0) * w;
      wsum += w;
    }
  }
  return sum / wsum;
}
`;

const registry = new WeakMap(); // post -> { factor: buffer }

// One per post chain and factor. Whichever pass asks first in a frame draws the depth; later
// passes on the same factor reuse it (the stamp is the frame number, so a pass that was off last
// frame can never be handed an old depth).
export function lowRes(post, factor) {
  let byFactor = registry.get(post);
  if (!byFactor) { byFactor = {}; registry.set(post, byFactor); }
  if (byFactor[factor]) return byFactor[factor];
  const target = new WebGLRenderTarget(2, 2, { format: RedFormat, type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  const scale = { value: factor };
  const depthMat = post.fsMaterial({
    fragmentShader: DEPTH_FRAG,
    uniforms: { tDepth: post.shared.tDepth, cameraNear: post.shared.cameraNear, cameraFar: post.shared.cameraFar, uLowScale: scale },
  });
  const uniforms = { // spread into low-res materials next to HALF_GLSL
    tHalfDepth: { value: target.texture },
    uFullTexel: post.shared.texel,
    uInvProj: { value: new Vector2(1, 1) },
    uLowScale: scale,
  };
  const blurMat = post.fsMaterial({ fragmentShader: BLUR_FRAG, uniforms: { ...uniforms, tSrc: { value: null }, uDir: { value: new Vector2(1, 0) } } });
  const h = {
    target, uniforms, factor, width: 2, height: 2, stamp: -1,
    resize(w, hgt) {
      const nw = Math.max(1, Math.ceil(w / factor)); const nh = Math.max(1, Math.ceil(hgt / factor));
      if (nw === h.width && nh === h.height) return;
      h.width = nw; h.height = nh; h.stamp = -1;
      target.setSize(nw, nh);
    },
    update() {
      const e = post.camera.projectionMatrix.elements;
      uniforms.uInvProj.value.set(1 / e[0], 1 / e[5]);
      const frame = post.shared.frame.value;
      if (h.stamp !== frame) { post.blit(depthMat, target); h.stamp = frame; }
    },
    // src -> tmp (horizontal) -> src (vertical); both targets at this buffer's size
    blur(src, tmp) {
      const u = blurMat.uniforms;
      u.tSrc.value = src.texture; u.uDir.value.set(1, 0);
      post.blit(blurMat, tmp);
      u.tSrc.value = tmp.texture; u.uDir.value.set(0, 1);
      post.blit(blurMat, src);
    },
    dispose() { target.dispose(); depthMat.dispose(); blurMat.dispose(); delete byFactor[factor]; },
  };
  h.resize(post.width, post.height);
  byFactor[factor] = h;
  return h;
}
export const halfRes = (post) => lowRes(post, 2);
