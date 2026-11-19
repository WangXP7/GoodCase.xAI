// Ambient occlusion ('ao' slot). Half-res obscurance from depth alone (normals rebuilt from depth,
// a 12-tap spiral per pixel on a 4x4 rotation pattern), a depth-aware blur, then a joint
// bilateral upsample to full resolution.
// Occlusion belongs to ambient light, but the chain multiplies the whole lit image by it. So the
// upsample fades it out by the pixel's own luminance: lamp-lit ground, emissive faces and the sky
// are left alone, and only what is lit by sky and bounce alone gets darker.
//
// pass.uniforms (all { value }): radius (m), intensity, lumLo / lumHi (scene-linear luminance where
// the fade starts / is complete), fadeNear / fadeFar (metres over which it fades with distance).
import { WebGLRenderTarget, RedFormat, UnsignedByteType, NearestFilter, LinearFilter } from 'three';
import { halfRes, HALF_GLSL, UPSAMPLE_GLSL } from './halfres.js';

const AO_FRAG = HALF_GLSL + /* glsl */ `
uniform float uProjScale; // half-res pixels covered by 1 m at 1 m
uniform float uRadius;
uniform float uIntensity;
uniform float cameraFar;
const int TAPS = 12;
const float TURNS = 7.0;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float z = halfZ(c);
  float rPx = uRadius * uProjScale / z;
  if (z >= cameraFar * 0.98 || rPx < 1.0) { outColor = vec4(1.0); return; }
  vec3 P = halfViewPos(c, z);
  // normal from the nearer neighbour on each axis, so it does not bend across depth edges
  float zl = halfZ(c - ivec2(1, 0)); float zr = halfZ(c + ivec2(1, 0));
  float zd = halfZ(c - ivec2(0, 1)); float zu = halfZ(c + ivec2(0, 1));
  vec3 dx = abs(zl - z) < abs(zr - z) ? P - halfViewPos(c - ivec2(1, 0), zl) : halfViewPos(c + ivec2(1, 0), zr) - P;
  vec3 dy = abs(zd - z) < abs(zu - z) ? P - halfViewPos(c - ivec2(0, 1), zd) : halfViewPos(c + ivec2(0, 1), zu) - P;
  vec3 N = normalize(cross(dx, dy));

  rPx = min(rPx, 44.0);
  float r = rPx * z / uProjScale; // world radius actually covered
  float r2 = r * r;
  // 4x4 ordered rotation: the blur's footprint covers one whole tile, so the pattern averages out
  const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  float rot = BAYER[(c.x & 3) + 4 * (c.y & 3)] * (6.2831853 / 16.0);
  float bias = 0.012 + 0.004 * z;
  float sum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float a = (float(i) + 0.5) / float(TAPS);
    float ang = a * TURNS * 6.2831853 + rot;
    ivec2 q = c + ivec2(round(vec2(cos(ang), sin(ang)) * max(a * rPx, 1.0)));
    vec3 v = halfViewPos(q, halfZ(q)) - P;
    float vv = dot(v, v);
    float f = max(r2 - vv, 0.0);
    sum += f * f * f * max((dot(v, N) - bias) / (vv + 1e-4), 0.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (r2 * r2 * r2 * float(TAPS)));
  outColor = vec4(ao, 0.0, 0.0, 1.0);
}`;

const UP_FRAG = (post) => post.glsl.common + post.glsl.depth + HALF_GLSL + UPSAMPLE_GLSL + /* glsl */ `
uniform sampler2D tAo;
uniform sampler2D tScene;
uniform float uLumLo;
uniform float uLumHi;
uniform float uFadeNear;
uniform float uFadeFar;
void main() {
  float z = linearDepth(vUv);
  if (z >= cameraFar * 0.98) { outColor = vec4(1.0); return; }
  float ao = upsampleHalf(tAo, z).r;
  float lit = smoothstep(uLumLo, uLumHi, luma(texture(tScene, vUv).rgb));
  float keep = (1.0 - lit) * (1.0 - smoothstep(uFadeNear, uFadeFar, z));
  outColor = vec4(mix(1.0, ao, keep), 0.0, 0.0, 1.0);
}`;

export function createAo() {
  const uniforms = {
    radius: { value: 1.2 }, intensity: { value: 2.2 },
    lumLo: { value: 0.01 }, lumHi: { value: 0.15 },
    fadeNear: { value: 45 }, fadeFar: { value: 70 },
  };
  let half; let aoMat; let upMat;
  const opts = { format: RedFormat, type: UnsignedByteType, depthBuffer: false };
  const raw = new WebGLRenderTarget(2, 2, { ...opts, minFilter: NearestFilter, magFilter: NearestFilter });
  const tmp = new WebGLRenderTarget(2, 2, { ...opts, minFilter: NearestFilter, magFilter: NearestFilter });
  const out = new WebGLRenderTarget(2, 2, { ...opts, minFilter: LinearFilter, magFilter: LinearFilter });

  return {
    name: 'ao', uniforms,
    init(post) {
      half = halfRes(post);
      aoMat = post.fsMaterial({
        fragmentShader: AO_FRAG,
        uniforms: { ...half.uniforms, uProjScale: { value: 1 }, uRadius: uniforms.radius, uIntensity: uniforms.intensity, cameraFar: post.shared.cameraFar },
      });
      upMat = post.fsMaterial({
        fragmentShader: UP_FRAG(post),
        uniforms: {
          ...post.shared, ...half.uniforms, tAo: { value: raw.texture },
          uLumLo: uniforms.lumLo, uLumHi: uniforms.lumHi, uFadeNear: uniforms.fadeNear, uFadeFar: uniforms.fadeFar,
        },
      });
    },
    resize(w, h) {
      half.resize(w, h);
      raw.setSize(half.width, half.height); tmp.setSize(half.width, half.height);
      out.setSize(w, h);
    },
    render(post) {
      half.update();
      aoMat.uniforms.uProjScale.value = 0.5 * half.height * post.camera.projectionMatrix.elements[5];
      post.blit(aoMat, raw);
      half.blur(raw, tmp);
      half.blur(raw, tmp);
      post.blit(upMat, out);
      return out.texture;
    },
    dispose() { raw.dispose(); tmp.dispose(); out.dispose(); aoMat.dispose(); upMat.dispose(); },
  };
}
