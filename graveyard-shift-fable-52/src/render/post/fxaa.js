// Final pass to the canvas: FXAA (edge search along the dominant edge direction plus a sub-pixel
// blend), radial chromatic aberration, luminance-weighted film grain, then triangular dither to
// hide 8-bit banding. Grain and dither come after the anti-aliasing so FXAA never mistakes them
// for edges. The aberration is done here, on the tone-mapped image, and not in HDR: next to a lamp
// hundreds of times over white, a hundredth of a pixel of channel shift in HDR is a saturated
// red or blue outline.
// Input is post.targets.ldr: sRGB-encoded, half-float, so nothing is quantised before the dither.
const FXAA_FRAG = /* glsl */ `
uniform sampler2D tLdr;
uniform vec2 texel;
uniform float frame;
uniform float uFxaa;
uniform float uGrain;
uniform float uDither;
uniform float uCA;
uniform float uDamage;
uniform vec2 resolution;

// Edge thresholds are low on purpose: at night most edges are dark against darker.
const float EDGE_MIN = 0.012;
const float EDGE_REL = 0.125;
const float SUBPIX = 0.6;
const int STEPS = 12;
const float STEP_SCALE[12] = float[12](1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0);
const vec3 W = vec3(0.299, 0.587, 0.114);

float lum(vec2 uv) { return dot(texture(tLdr, uv).rgb, W); }

// returns where to sample: the pixel centre, nudged across the edge it sits on
vec2 fxaa(vec2 uv) {
  vec3 centre = texture(tLdr, uv).rgb;
  float lC = dot(centre, W);
  float lD = lum(uv + vec2(0.0, -texel.y));
  float lU = lum(uv + vec2(0.0, texel.y));
  float lL = lum(uv + vec2(-texel.x, 0.0));
  float lR = lum(uv + vec2(texel.x, 0.0));
  float lMin = min(lC, min(min(lD, lU), min(lL, lR)));
  float lMax = max(lC, max(max(lD, lU), max(lL, lR)));
  float range = lMax - lMin;
  if (range < max(EDGE_MIN, lMax * EDGE_REL)) return uv;

  float lDL = lum(uv + vec2(-texel.x, -texel.y));
  float lUR = lum(uv + vec2(texel.x, texel.y));
  float lUL = lum(uv + vec2(-texel.x, texel.y));
  float lDR = lum(uv + vec2(texel.x, -texel.y));
  float lDU = lD + lU;
  float lLR = lL + lR;
  float edgeH = abs(-2.0 * lL + lDL + lUL) + abs(-2.0 * lC + lDU) * 2.0 + abs(-2.0 * lR + lDR + lUR);
  float edgeV = abs(-2.0 * lU + lUR + lUL) + abs(-2.0 * lC + lLR) * 2.0 + abs(-2.0 * lD + lDL + lDR);
  bool horizontal = edgeH >= edgeV;

  // which side of the pixel the edge is on
  float l1 = horizontal ? lD : lL;
  float l2 = horizontal ? lU : lR;
  float g1 = l1 - lC;
  float g2 = l2 - lC;
  bool steepest1 = abs(g1) >= abs(g2);
  float gScaled = 0.25 * max(abs(g1), abs(g2));
  float stepLen = horizontal ? texel.y : texel.x;
  float lAvg;
  if (steepest1) { stepLen = -stepLen; lAvg = 0.5 * (l1 + lC); } else { lAvg = 0.5 * (l2 + lC); }

  // walk both ways along the edge until the luminance stops matching it
  vec2 cur = uv;
  if (horizontal) cur.y += stepLen * 0.5; else cur.x += stepLen * 0.5;
  vec2 along = horizontal ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
  vec2 uv1 = cur - along;
  vec2 uv2 = cur + along;
  float e1 = lum(uv1) - lAvg;
  float e2 = lum(uv2) - lAvg;
  bool done1 = abs(e1) >= gScaled;
  bool done2 = abs(e2) >= gScaled;
  if (!done1) uv1 -= along;
  if (!done2) uv2 += along;
  for (int i = 2; i < STEPS; i++) {
    if (done1 && done2) break;
    if (!done1) e1 = lum(uv1) - lAvg;
    if (!done2) e2 = lum(uv2) - lAvg;
    done1 = abs(e1) >= gScaled;
    done2 = abs(e2) >= gScaled;
    if (!done1) uv1 -= along * STEP_SCALE[i];
    if (!done2) uv2 += along * STEP_SCALE[i];
  }
  float d1 = horizontal ? uv.x - uv1.x : uv.y - uv1.y;
  float d2 = horizontal ? uv2.x - uv.x : uv2.y - uv.y;
  bool nearer1 = d1 < d2;
  float pixelOffset = 0.5 - min(d1, d2) / (d1 + d2);
  bool centreSmaller = lC < lAvg;
  bool correct = ((nearer1 ? e1 : e2) < 0.0) != centreSmaller;
  float offset = correct ? pixelOffset : 0.0;

  // sub-pixel: single-pixel detail gets a little of its neighbourhood
  float lAll = (2.0 * (lDU + lLR) + lDL + lUL + lDR + lUR) / 12.0;
  float sp = clamp(abs(lAll - lC) / range, 0.0, 1.0);
  sp = (-2.0 * sp + 3.0) * sp * sp;
  offset = max(offset, sp * sp * SUBPIX);

  vec2 fin = uv;
  if (horizontal) fin.y += offset * stepLen; else fin.x += offset * stepLen;
  return fin;
}

uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float rnd(uvec3 p) { return float(hashU(p) >> 8u) * (1.0 / 16777216.0); }

void main() {
  vec2 uv = uFxaa > 0.5 ? fxaa(vUv) : vUv;
  vec3 c = texture(tLdr, uv).rgb;

  // radial chromatic aberration, growing with the square of the radius; green stays put
  float ca = uCA + uDamage * 0.006;
  if (ca > 0.0) {
    vec2 d = vUv - 0.5;
    float aspect = resolution.x / resolution.y;
    vec2 da = d * vec2(aspect, 1.0);
    vec2 off = d * (dot(da, da) / (0.25 * (aspect * aspect + 1.0))) * ca;
    c.r = texture(tLdr, uv - off).r;
    c.b = texture(tLdr, uv + off).b;
  }
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint f = uint(frame);

  // Grain: mostly monochrome with a little colour, strongest in the low mids, fading toward
  // white and easing off in deep black so the darkest areas stay clean.
  float l = dot(c, W);
  float weight = mix(0.3, 1.0, smoothstep(0.0, 0.1, l)) * (1.0 - 0.8 * smoothstep(0.3, 1.0, l));
  float mono = rnd(uvec3(px, f)) + rnd(uvec3(px, f + 7919u)) - 1.0; // triangular, -1..1
  vec3 chroma = vec3(rnd(uvec3(px, f + 101u)), rnd(uvec3(px, f + 211u)), rnd(uvec3(px, f + 307u))) - 0.5;
  c += (mono * 0.5 + chroma * 0.2) * uGrain * weight;

  // Dither: triangular noise of +-1 LSB, different per channel, breaks up 8-bit steps.
  vec3 t = vec3(rnd(uvec3(px, f + 13u)), rnd(uvec3(px, f + 29u)), rnd(uvec3(px, f + 43u)))
         + vec3(rnd(uvec3(px, f + 59u)), rnd(uvec3(px, f + 71u)), rnd(uvec3(px, f + 89u))) - 1.0;
  c += t * (uDither / 255.0);

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function createFxaa() {
  let material;
  return {
    name: 'fxaa',
    init(post) {
      const u = post.uniforms;
      material = post.fsMaterial({
        fragmentShader: FXAA_FRAG,
        uniforms: { tLdr: { value: post.targets.ldr.texture }, texel: post.shared.texel, frame: post.shared.frame, uFxaa: u.fxaa, uGrain: u.grainAmount, uDither: u.dither, uCA: u.chromaticAberration, uDamage: u.damage, resolution: post.shared.resolution },
      });
    },
    render(post) {
      material.uniforms.tLdr.value = post.tex.composite || post.targets.ldr.texture;
      post.blit(material, null);
      return null;
    },
  };
}
