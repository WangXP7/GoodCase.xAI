// Flipbook atlases for particles and decals, drawn once at load by fragment shaders.
// Both store smooth fields and normals rather than finished colour: the particle and decal shaders
// light them, threshold them and tint them, so one cell serves many looks and edges stay crisp.
import {
  WebGLRenderTarget, UnsignedByteType, RGBAFormat, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping,
  BufferGeometry, BufferAttribute, Mesh, OrthographicCamera,
} from 'three';

import { gpuIdle } from '../render/warm.js';
import { rollLoops, ROLL_UNIFORMS } from '../render/rollLoops.js';

const CAM = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---- particle atlas: 8 x 8 cells -----------------------------------------------------------
export const P_GRID = 8;
export const P_CELL = {
  smoke: 0, smokeFrames: 16, //  RG normal, B breakup noise, A density
  star: 16, starCount: 4, //     R heat, A alpha  (muzzle flash seen end-on)
  tongue: 20, tongueCount: 4, // R heat, A alpha  (flame jet, base at -x)
  chip: 24, chipCount: 8, //     RG normal, B albedo variation, A coverage
  shard: 32, shardCount: 4, //   R edge bevel, G surface streak, A coverage
  drop: 36, dropCount: 4, //     RG normal, A coverage
  splash: 40, splashFrames: 8, // RG normal, B thickness, A coverage (liquid burst breaking up)
  glow: 48, streak: 49, ring: 50, burst: 51, // R/A intensity
  flame: 52, flameFrames: 8, //  R heat, A alpha  (a flame standing on its base at -y, licking upward through the frames)
};

// ---- decal atlas: 4 x 4 cells. RG normal, B cavity/extra, A growth field (1 centre -> 0 rim) ---
export const D_GRID = 4;
export const D_CELL = {
  crater: 0, craterCount: 2,
  metal: 2, metalCount: 2,
  glass: 4, glassCount: 2, //   R cracks, G frosting, B hole, A coverage
  smear: 6, //                  a dragged streak along y: dry-brush bands that thin toward +y
  drip: 7, //                   a few heads near the top with long runs toward -y
  pool: 8, poolCount: 4,
  spatter: 12, spatterCount: 2, // droplets with drips running toward -y
  scorch: 14, scorchCount: 2,
};

const NOISE = /* glsl */ `
const float TAU = 6.2831853;
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  i += 4096.0;
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; }
  return s / 0.96875;
}
float h1(float a, float b) { return hash13(vec3(a * 7.0 + 31.0, b * 13.0 + 57.0, 91.0)); }
vec2 enc(vec2 n) { return clamp(n, -1.0, 1.0) * 0.5 + 0.5; }
`;

const PARTICLE_FRAG = /* glsl */ `
float smokeD(vec2 q, float f) {
  vec3 p = vec3(q * 1.6, f * 0.22);
  vec2 w = vec2(fbm(p + vec3(5.2, 1.3, 0.0)), fbm(p + vec3(1.7, 9.2, 0.0))) - 0.5;
  float r = length(q + w * 0.55);
  float n = fbm(vec3((q + w * 0.8) * 2.6, f * 0.3 + 4.0));
  float d = smoothstep(0.95, 0.15, r + (n - 0.5) * 0.9);
  d *= smoothstep(1.0, 0.72, length(q));
  float e = f / 16.0 * 0.3;
  return smoothstep(e, e + 0.9, d);
}
float chipLim(vec2 q, float v) {
  float a = atan(q.y, q.x);
  return clamp(0.55 + 0.7 * (fbm(vec3(cos(a) * 1.6, sin(a) * 1.6, v * 4.7)) - 0.5), 0.3, 0.9);
}
float chipH(vec2 q, float v) {
  float k = clamp(1.0 - length(q) / chipLim(q, v), 0.0, 1.0);
  return pow(k, 0.6) + (fbm(vec3(q * 4.0, v * 3.0)) - 0.5) * 0.4 * step(0.001, k);
}
float splashH(vec2 q, float f) {
  float r = length(q); float a = atan(q.y, q.x);
  float R = 0.3 + 0.62 * (f / 7.0);
  float strings = fbm(vec3(cos(a) * 2.2, sin(a) * 2.2, r * 1.3 - f * 0.12) + 3.0);
  float blobs = fbm(vec3(q * 3.2, f * 0.15 + 9.0));
  float h = mix(strings, blobs, 0.7);
  float th = mix(0.34, 0.54, f / 7.0);
  float fall = smoothstep(R, R * 0.3, r);
  return h * fall + fall * 0.3 * (1.0 - f / 7.0) - th;
}
void main() {
  vec2 g = vUv * 8.0;
  vec2 ci = floor(g);
  float cell = ci.x + ci.y * 8.0;
  vec2 q = fract(g) * 2.0 - 1.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 o = vec4(0.5, 0.5, 0.0, 0.0);
  const vec2 e = vec2(0.03, 0.0);

  if (cell < 16.0) { // smoke flipbook
    float d = smokeD(q, cell);
    vec2 grad = vec2(smokeD(q + e.xy, cell) - smokeD(q - e.xy, cell), smokeD(q + e.yx, cell) - smokeD(q - e.yx, cell)) / (2.0 * e.x);
    vec2 n = q * 0.7 - grad * 0.22;
    // B: breakup noise, independent of the puff outline; the particle shader thresholds it
    float brk = smoothstep(0.25, 0.75, fbm(vec3(q * 4.5, cell * 0.35 + 11.0)));
    o = vec4(enc(n), brk, d);
  } else if (cell < 20.0) { // flash star
    float v = cell - 16.0;
    float sp = fbm(vec3(cos(ang) * 2.5, sin(ang) * 2.5, v * 7.3));
    sp = pow(smoothstep(0.3, 0.75, sp), 1.5);
    float lim = 0.2 + 0.72 * sp;
    float n = fbm(vec3(q * 5.0, v * 3.1 + 2.0));
    float heat = smoothstep(lim, lim * 0.15, r + (n - 0.5) * 0.25);
    heat = max(heat, exp(-r * r * 16.0));
    heat *= smoothstep(1.0, 0.8, r);
    o = vec4(heat, 0.0, 0.0, smoothstep(0.02, 0.45, heat));
  } else if (cell < 24.0) { // flame tongue
    float v = cell - 20.0;
    float t = (q.x + 1.0) * 0.5;
    float n = fbm(vec3(q.x * 2.5, q.y * 5.0, v * 5.7));
    float n2 = fbm(vec3(t * 4.0, v * 9.1, 1.0));
    float hw = pow(t, 0.45) * pow(1.0 - t, 0.6) * (0.6 + 0.8 * n2);
    float heat = smoothstep(hw, hw * 0.2, abs(q.y + (n - 0.5) * 0.3)) * smoothstep(1.0, 0.75, t) * smoothstep(0.0, 0.04, t);
    heat *= mix(1.0, 0.5, t);
    o = vec4(heat, 0.0, 0.0, smoothstep(0.02, 0.4, heat));
  } else if (cell < 32.0) { // chips
    float v = cell - 24.0;
    float cov = smoothstep(0.0, 0.08, 1.0 - r / chipLim(q, v));
    vec2 grad = vec2(chipH(q + e.xy, v) - chipH(q - e.xy, v), chipH(q + e.yx, v) - chipH(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.55), fbm(vec3(q * 6.0, v + 20.0)), cov);
  } else if (cell < 36.0) { // glass shards
    float v = cell - 32.0;
    float n = 3.0 + mod(v, 2.0);
    float d = 1.0;
    for (float i = 0.0; i < 4.0; i++) {
      if (i >= n) break;
      float a = (i + h1(v, i) * 0.7) * TAU / n + v;
      d = min(d, 0.3 + 0.35 * h1(v + 5.0, i) - dot(q, vec2(cos(a), sin(a))));
    }
    o = vec4(1.0 - smoothstep(0.0, 0.14, d), fbm(vec3(q * 3.0, v)), 0.0, smoothstep(0.0, 0.04, d));
  } else if (cell < 40.0) { // droplets
    float v = cell - 36.0;
    float lim = 0.78 + 0.12 * (vnoise(vec3(cos(ang) * 1.5, sin(ang) * 1.5, v * 3.0)) - 0.5);
    vec2 n = q / lim;
    o = vec4(enc(n * 0.95), 0.0, smoothstep(1.0, 0.86, r / lim));
  } else if (cell < 48.0) { // liquid splash flipbook
    float f = cell - 40.0;
    float h = splashH(q, f);
    vec2 grad = vec2(splashH(q + e.xy, f) - splashH(q - e.xy, f), splashH(q + e.yx, f) - splashH(q - e.yx, f)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.25), clamp(h * 4.0, 0.0, 1.0), smoothstep(0.0, 0.05, h));
  } else if (cell == 48.0) { // soft glow
    float a = exp(-r * r * 5.0) * smoothstep(1.0, 0.55, r);
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell == 49.0) { // spark streak, head at +x
    float t = (q.x + 1.0) * 0.5;
    float w = mix(0.3, 0.95, t);
    vec2 hq = vec2(max(q.x - 0.55, 0.0) / 0.45, q.y / w);
    float a = pow(t, 1.4) * smoothstep(1.0, 0.0, length(hq));
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell == 50.0) { // ring
    float k = (r - 0.7) / 0.13;
    float a = exp(-k * k) * (0.55 + 0.45 * fbm(vec3(cos(ang) * 3.0, sin(ang) * 3.0, 2.0)));
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell >= 52.0 && cell < 60.0) { // standing flame: warped noise tongues that thin with height
    float f = cell - 52.0;
    float up = q.y * 0.5 + 0.5;
    vec2 w2 = vec2(fbm(vec3(q.x * 1.5, q.y * 1.2 - f * 0.55, f * 0.2 + 3.0)), fbm(vec3(q.x * 1.5 + 7.0, q.y * 1.2 - f * 0.55, f * 0.2 + 5.0))) - 0.5;
    vec2 p = q + w2 * vec2(0.9, 0.5) * (0.3 + up);
    float n = fbm(vec3(p.x * 3.0, p.y * 2.0 - f * 0.9, f * 0.37 + 9.0));
    float env = 1.0 - smoothstep(0.2, 0.95, abs(p.x) / mix(0.8, 0.5, up));
    float h = env * (n * 1.5 + 0.28 - up * 1.1) * smoothstep(-1.0, -0.78, q.y);
    float a = smoothstep(0.02, 0.24, h) * smoothstep(1.0, 0.84, max(abs(q.x), abs(q.y)));
    // heat falls with height: a yellow-white foot, orange through the body, red at the tips
    o = vec4(clamp(h * 1.25, 0.0, 1.0) * mix(1.0, 0.4, smoothstep(0.05, 0.85, up)), 0.0, 0.0, a);
  } else if (cell == 51.0) { // radial burst of streaks
    float s = fbm(vec3(cos(ang) * 4.0, sin(ang) * 4.0, r * 0.8));
    float a = smoothstep(0.38, 0.72, s) * smoothstep(1.0, 0.35, r) * smoothstep(0.0, 0.2, r) + exp(-r * r * 12.0) * 0.6;
    a = clamp(a, 0.0, 1.0);
    o = vec4(a, 0.0, 0.0, a);
  }
  outColor = o;
}`;

const DECAL_FRAG = /* glsl */ `
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float lobes(vec2 q, float v, float k) {
  float a = atan(q.y, q.x);
  return fbm(vec3(cos(a) * k, sin(a) * k, v * 6.1 + 2.0));
}
float craterF(vec2 q, float v) {
  float edge = 0.5 + 0.55 * (lobes(q, v, 1.8) - 0.5);
  float f = 1.0 - length(q) / max(edge, 0.2);
  f += (fbm(vec3(q * 6.0, v * 2.0)) - 0.5) * 0.25;
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.85, length(q));
}
float craterH(vec2 q, float v) {
  float f = craterF(q, v);
  return -f * 0.6 - smoothstep(0.5, 0.9, f) * 0.9 + fbm(vec3(q * 9.0, v + 7.0)) * 0.35 * smoothstep(0.0, 0.1, f);
}
float metalF(vec2 q, float v) {
  float edge = 0.82 + 0.1 * (lobes(q, v, 2.5) - 0.5);
  return clamp(1.0 - length(q) / edge, 0.0, 1.0);
}
float metalH(vec2 q, float v) {
  float f = metalF(q, v);
  float k = (f - 0.56) / 0.045;
  return -smoothstep(0.0, 0.56, f) * 0.8 + exp(-k * k) * 0.5;
}
float poolF(vec2 q, float v) {
  float r = length(q);
  float edge = 0.42 + 0.42 * lobes(q, v, 1.4);
  float f = 1.0 - r / edge;
  for (float i = 0.0; i < 9.0; i++) {
    float a = h1(v, i) * TAU; float d = 0.5 + 0.38 * h1(v + 3.0, i);
    float rad = 0.025 + 0.07 * h1(v + 7.0, i) * h1(v + 9.0, i);
    f = max(f, (1.0 - length(q - vec2(cos(a), sin(a)) * d) / rad) * 0.95);
  }
  f += (fbm(vec3(q * 5.0, v)) - 0.5) * 0.12 * smoothstep(-0.2, 0.2, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.88, r);
}
float spatterF(vec2 q, float v) {
  float f = 0.0;
  for (float i = 0.0; i < 16.0; i++) {
    float a = h1(v + 11.0, i) * TAU; float d = 0.62 * pow(h1(v + 13.0, i), 0.7);
    vec2 c = vec2(cos(a), sin(a) * 0.8 + 0.25) * d;
    float rad = mix(0.03, 0.14, pow(h1(v + 17.0, i), 2.5)) * (i < 2.0 ? 1.8 : 1.0);
    float len = rad * (1.0 + 7.0 * h1(v + 19.0, i) * step(0.45, h1(v + 23.0, i)));
    vec2 b = c - vec2((h1(v + 29.0, i) - 0.5) * 0.04, len);
    vec2 pa = q - c, ba = b - c;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = rad * mix(1.0, 0.38, smoothstep(0.0, 0.35, t));
    f = max(f, (1.0 - length(pa - ba * t) / w) * mix(1.0, 0.3, t));
  }
  f += (fbm(vec3(q * 7.0, v)) - 0.5) * 0.1 * step(0.01, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.9, max(abs(q.x), abs(q.y)));
}
// a hand or a body dragged from -y to +y: a wet start, then parallel bands that break up and thin
float smearF(vec2 q, float v) {
  float along = q.y * 0.5 + 0.5;
  float wob = (fbm(vec3(q.y * 1.6, v, 3.0)) - 0.5) * 0.3;
  float x = q.x - wob;
  float width = mix(0.46, 0.2, along) * (0.8 + 0.4 * fbm(vec3(q.y * 3.0, 7.0, v)));
  float body = 1.0 - abs(x) / width;
  float bands = fbm(vec3(x * 22.0, q.y * 1.3, v + 2.0));
  float dry = smoothstep(0.1, 0.85, along);
  float f = body * mix(1.0, smoothstep(0.32, 0.62, bands) * 0.9 + 0.1, dry);
  f = max(f, (1.0 - length((q - vec2(wob * 0.5, -0.68)) / vec2(0.36, 0.24))) * 0.95);
  f *= smoothstep(-0.96, -0.8, q.y) * smoothstep(0.96, 0.45, q.y);
  return clamp(f, 0.0, 1.0);
}
// blood that struck a wall and ran: heads along the top, runs of different lengths ending in a bead
float dripF(vec2 q, float v) {
  float f = 0.0;
  for (float i = 0.0; i < 7.0; i++) {
    float cx = (h1(v + 31.0, i) - 0.5) * 1.3;
    float cy = 0.5 + 0.3 * h1(v + 37.0, i);
    float rad = mix(0.035, 0.1, h1(v + 41.0, i) * h1(v + 41.0, i));
    float len = mix(0.15, 1.25, pow(h1(v + 43.0, i), 1.5));
    vec2 c = vec2(cx, cy);
    vec2 b = c - vec2((h1(v + 47.0, i) - 0.5) * 0.05, len);
    vec2 pa = q - c, ba = b - c;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = rad * mix(1.0, 0.24, smoothstep(0.0, 0.2, t)) * (1.0 + 0.5 * smoothstep(0.9, 1.0, t));
    f = max(f, (1.0 - length(pa - ba * t) / w) * mix(1.0, 0.45, smoothstep(0.0, 0.9, t)));
    f = max(f, (1.0 - length(q - b) / (rad * 0.42)) * 0.7);
  }
  f += (fbm(vec3(q * 8.0, v)) - 0.5) * 0.08 * step(0.01, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.92, max(abs(q.x), abs(q.y)));
}
void main() {
  vec2 g = vUv * 4.0;
  vec2 ci = floor(g);
  float cell = ci.x + ci.y * 4.0;
  vec2 q = fract(g) * 2.0 - 1.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  const vec2 e = vec2(0.02, 0.0);
  vec4 o = vec4(0.5, 0.5, 0.0, 0.0);

  if (cell < 2.0) {
    float f = craterF(q, cell);
    vec2 grad = vec2(craterH(q + e.xy, cell) - craterH(q - e.xy, cell), craterH(q + e.yx, cell) - craterH(q - e.yx, cell)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.3), smoothstep(0.45, 0.8, f), f);
  } else if (cell < 4.0) {
    float v = cell - 2.0;
    float f = metalF(q, v);
    vec2 grad = vec2(metalH(q + e.xy, v) - metalH(q - e.xy, v), metalH(q + e.yx, v) - metalH(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.25), smoothstep(0.6, 0.66, f), f);
  } else if (cell < 6.0) {
    float v = cell - 4.0;
    float k = 13.0 + v * 4.0;
    float sa = ang / TAU * k + (vnoise(vec3(r * 3.0, v * 3.0, 1.0)) - 0.5) * 0.22;
    float sec = floor(sa);
    float dl = abs(fract(sa) - 0.5);
    dl = (0.5 - dl) * r * TAU / k; // distance to the nearest sector boundary = radial crack
    float len = 0.45 + 0.5 * h1(v, sec);
    float rad = smoothstep(0.007, 0.0015, dl) * smoothstep(len, len - 0.15, r);
    float conc = 0.0;
    for (float j = 0.0; j < 3.0; j++) {
      float sid = floor(fract(sa) + 0.5) + sec; // rings break at crack lines
      float rr = 0.2 + 0.22 * j + 0.12 * h1(v + j * 3.0, sid);
      conc = max(conc, smoothstep(0.006, 0.0015, abs(r - rr)) * step(0.45, h1(v + 40.0 + j, sid)));
    }
    float hole = smoothstep(0.1, 0.07, r + (lobes(q, v, 3.0) - 0.5) * 0.06);
    float frost = smoothstep(0.38, 0.08, r) * (0.4 + 0.6 * fbm(vec3(q * 14.0, v)));
    float cr = max(rad, conc);
    o = vec4(cr, frost, hole, max(max(cr, hole), frost));
  } else if (cell == 6.0) {
    float f = smearF(q, 1.0);
    vec2 grad = vec2(smearF(q + e.xy, 1.0) - smearF(q - e.xy, 1.0), smearF(q + e.yx, 1.0) - smearF(q - e.yx, 1.0)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.05), fbm(vec3(q * 4.0, 6.0)), f);
  } else if (cell == 7.0) {
    float f = dripF(q, 2.0);
    vec2 grad = vec2(dripF(q + e.xy, 2.0) - dripF(q - e.xy, 2.0), dripF(q + e.yx, 2.0) - dripF(q - e.yx, 2.0)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.06), fbm(vec3(q * 4.0, 9.0)), f);
  } else if (cell >= 8.0 && cell < 12.0) {
    float v = cell - 8.0;
    float f = poolF(q, v);
    vec2 grad = vec2(poolF(q + e.xy, v) - poolF(q - e.xy, v), poolF(q + e.yx, v) - poolF(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.12), fbm(vec3(q * 4.0, v + 5.0)), f);
  } else if (cell < 14.0 && cell >= 12.0) {
    float v = cell - 12.0;
    float f = spatterF(q, v);
    vec2 grad = vec2(spatterF(q + e.xy, v) - spatterF(q - e.xy, v), spatterF(q + e.yx, v) - spatterF(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.06), fbm(vec3(q * 4.0, v + 5.0)), f);
  } else if (cell >= 14.0) {
    float v = cell - 14.0;
    float edge = 0.6 + 0.5 * (lobes(q, v, 2.2) - 0.5);
    float f = clamp(1.0 - r / edge, 0.0, 1.0) * smoothstep(1.0, 0.8, r);
    o = vec4(0.5, 0.5, fbm(vec3(q * 5.0, v + 3.0)), f);
  }
  outColor = o;
}`;

const ATLAS_OPTS = {
  type: UnsignedByteType, format: RGBAFormat, depthBuffer: false,
  minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
  wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
};

// ---- one small program per kind of cell, loops left rolled ---------------------------------------
// Each atlas shader picks what to draw with an if/else over the cell index. Compiled whole, with
// every loop unrolled, Direct3D's compiler took 99 s (particles) and 196 s (decals) on a slow PC.
// So each atlas is drawn by one program per kind of cell: branch i of main() is guarded by `K == i`
// and the program is compiled with #define K i, so the other branches are compiled out; and its
// loops keep a bound the compiler cannot see (render/rollLoops.js). Each program is drawn only into
// its own cells (a scissor), where it runs exactly the code the whole shader ran there; cells no
// branch claims get the shader's default (K = -1: no branch). The kinds, in branch order:
export const ATLAS_KINDS = {
  particles: { grid: 8, kinds: [[0, 15], [16, 19], [20, 23], [24, 31], [32, 35], [36, 39], [40, 47], [48, 48], [49, 49], [50, 50], [52, 59], [51, 51]] },
  decals: { grid: 4, kinds: [[0, 1], [2, 3], [4, 5], [6, 6], [7, 7], [8, 11], [12, 13], [14, 15]] },
};
const BRANCH = /(\n\s*(?:\} else )?if \()(cell\b)/g;
// The atlas source with branch i guarded by K == i; returns { src, branches }.
export function guardBranches(frag) {
  let n = 0;
  const src = frag.replace(BRANCH, (m, a, b) => `${a}K == ${n++} && ${b}`);
  return { src, branches: n };
}
export const PARTICLE_SRC = PARTICLE_FRAG;
export const DECAL_SRC = DECAL_FRAG;

// The programs of one atlas: [{ k, cells: [cell...] }], k = -1 for the cells no branch claims.
export function atlasPlan(which) {
  const { grid, kinds } = ATLAS_KINDS[which];
  const plan = kinds.map(([lo, hi], k) => ({ k, cells: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) }));
  const claimed = new Set(plan.flatMap((p) => p.cells));
  const rest = Array.from({ length: grid * grid }, (_, i) => i).filter((c) => !claimed.has(c));
  if (rest.length) plan.push({ k: -1, cells: rest });
  return plan;
}

function programsFor(post, which, frag) {
  const body = rollLoops(guardBranches(NOISE + frag).src).src;
  return atlasPlan(which).map(({ k, cells }) => ({
    k, cells,
    mat: post.fsMaterial({ fragmentShader: post.glsl.common + body, uniforms: ROLL_UNIFORMS(), defines: { K: k } }),
  }));
}

// Draws `cells` of one program into the atlas, each through a scissor. `mips`: build the mip chain
// after this draw (only after the last one; and after the first, which also sets the target up).
function drawCells(post, rt, grid, mat, cells, mipsAfter) {
  const r = post.renderer;
  const cs = rt.width / grid;
  const prev = r.getRenderTarget();
  try {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      rt.scissor.set((c % grid) * cs, Math.floor(c / grid) * cs, cs, cs);
      rt.scissorTest = true;
      rt.texture.generateMipmaps = mipsAfter(i === cells.length - 1);
      post.blit(mat, rt);
    }
  } finally {
    r.setRenderTarget(prev);
    rt.scissorTest = false;
    rt.texture.generateMipmaps = true;
  }
}

// All at once (staged shots and stepped runs, and a restored context: the atlases are needed now).
function bakeNow(post, rt, which, frag) {
  const progs = programsFor(post, which, frag);
  const { grid } = ATLAS_KINDS[which];
  progs.forEach((p, i) => drawCells(post, rt, grid, p.mat, p.cells, (lastCell) => (i === 0) || (lastCell && i === progs.length - 1)));
  for (const p of progs) p.mat.dispose();
}

// ---- drawing at load without holding the page -----------------------------------------------
// With KHR_parallel_shader_compile every program is compiled at once on the driver's threads (the
// boot starts this when the fx module is built). Without it (Firefox) nothing starts until the boot
// reaches its effects step (start()), and then one program at a time: its compile is issued, waited
// for with a GPU fence (render/warm.js gpuIdle: the page is not blocked, and nothing else is running
// that could hit the pending compile), and its cells drawn. Cells are drawn a few per step, the next
// step waiting for a fence on the last; the number per step grows while the GPU keeps up and shrinks
// when a step takes it longer than STEP_MS. The mip chain is built once, after the last cell.
// Nothing samples an atlas before `ready` resolves: the boot waits for it before the first frame.
export const STEP_MS = 80;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// one turn of the page (a paint where there are frames; a plain timeout in a hidden tab)
const turn = () => new Promise((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  setTimeout(go, 100);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
});

// Cells for the next step from the last: n * target / measured, between 1 and n * 4.
export function nextCells(n, gpuMs, target = STEP_MS) {
  return Math.max(1, Math.min(n * 4, Math.round(n * target / Math.max(gpuMs, 1))));
}
// kept for the strip-sizing test of an earlier version: rows * target / measured within [8, size]
export function nextRows(rows, gpuMs, size, target = STEP_MS) {
  const want = Math.round(rows * target / Math.max(gpuMs, 1));
  return Math.max(8, Math.min(size, want, rows * 4));
}

function parallelCompile(renderer) {
  try { return !!(renderer.extensions && renderer.extensions.has('KHR_parallel_shader_compile')); } catch { return false; }
}

// Issues the compile of one atlas program against its target; resolves when it can be used without
// waiting (compileAsync with the extension; a GPU fence without it).
function compileProgram(post, rt, mat, parallel) {
  const r = post.renderer;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const tri = new Mesh(geo, mat); tri.frustumCulled = false;
  const prev = r.getRenderTarget();
  let waitFor = null;
  try {
    r.setRenderTarget(rt);
    if (parallel && typeof r.compileAsync === 'function') waitFor = r.compileAsync(tri, CAM);
    else r.compile(tri, CAM);
  } catch { waitFor = null; } finally { r.setRenderTarget(prev); }
  const done = waitFor ? waitFor.catch(() => {}) : gpuIdle(r.getContext(), turn);
  return done.then(() => geo.dispose());
}

async function bakeStepped(post, jobs, parallel, S) {
  const r = post.renderer;
  const gl = r.getContext();
  const t0 = performance.now();
  const lost = () => !!(gl && gl.isContextLost && gl.isContextLost());
  // with the extension: every compile now, side by side
  S.parallel = parallel;
  if (parallel) S.phase = 'compiling';
  const compiled = parallel ? jobs.flatMap((j) => j.progs.map((p) => {
    const a = performance.now();
    return compileProgram(post, j.rt, p.mat, true).then(() => { p.compileMs = Math.round(performance.now() - a); S.compiled++; });
  })) : null;
  // a compile that never reports (a context lost for good) must not hold the boot: after a minute the cells are drawn anyway
  if (compiled) await Promise.race([Promise.all(compiled), new Promise((r) => setTimeout(r, 60000))]);
  let n = 2; // cells per step
  for (const j of jobs) {
    const a0 = performance.now();
    for (let pi = 0; pi < j.progs.length; pi++) {
      const p = j.progs[pi];
      if (lost()) return; // the restore handler bakes them again
      if (!parallel) {
        S.phase = 'compiling';
        await turn(); // the label is painted before the compile is issued
        const a = performance.now();
        await compileProgram(post, j.rt, p.mat, false);
        p.compileMs = Math.round(performance.now() - a);
        S.compiled++;
      }
      S.phase = 'drawing';
      for (let c = 0; c < p.cells.length;) {
        if (lost()) return;
        const take = p.cells.slice(c, c + n);
        const first = pi === 0 && c === 0;
        const lastAll = pi === j.progs.length - 1 && c + take.length >= p.cells.length;
        const a = performance.now();
        drawCells(post, j.rt, j.grid, p.mat, take, (lastCell) => (first) || (lastCell && lastAll));
        const cpu = performance.now() - a;
        j.stat.slowestStepMs = Math.max(j.stat.slowestStepMs, Math.round(cpu));
        await gpuIdle(gl, turn);
        const gpu = performance.now() - a;
        if (j.stat.strips === 0) j.stat.firstStripMs = Math.round(gpu);
        j.stat.strips++;
        c += take.length;
        S.drawn += take.length;
        n = nextCells(take.length, gpu);
      }
    }
    j.stat.compileMs = j.progs.reduce((m, p) => Math.max(m, p.compileMs || 0), 0);
    j.stat.totalMs = Math.round(performance.now() - (parallel ? t0 : a0));
    for (const p of j.progs) p.mat.dispose();
  }
}

// The particle (2048) and decal (1024) atlases. `scale` 0.5 halves both (low and mobile tiers and
// software renderers; never high or medium). Returns the targets at once, empty; `ready` resolves
// when both are drawn; `progress()` is 0..1, `label()` says what is happening, `stats` has the timings.
// opts.now: draw them here and now (staged shots and stepped runs, and tests). They start at once
// where the browser compiles in parallel, and wait for start() where it does not (see above);
// opts.defer true / false forces one or the other.
export function createAtlases(post, opts = {}) {
  const scale = opts.scale === 0.5 ? 0.5 : 1;
  const particles = new WebGLRenderTarget(2048 * scale, 2048 * scale, ATLAS_OPTS);
  const decals = new WebGLRenderTarget(1024 * scale, 1024 * scale, ATLAS_OPTS);
  const list = [['particles', particles, PARTICLE_FRAG], ['decals', decals, DECAL_FRAG]];
  const stats = list.map(([name, rt]) => ({ name, size: rt.width, compileMs: 0, firstStripMs: 0, strips: 0, slowestStepMs: 0, totalMs: 0 }));
  const S = { phase: 'waiting', compiled: 0, programs: 0, drawn: 0, cells: 0 };
  let ready; let start = () => {};
  if (opts.now) {
    list.forEach(([name, rt, frag], i) => { const a = performance.now(); bakeNow(post, rt, name, frag); stats[i].strips = 1; stats[i].totalMs = Math.round(performance.now() - a); });
    S.phase = 'done';
    ready = Promise.resolve();
  } else {
    const parallel = parallelCompile(post.renderer);
    const jobs = list.map(([name, rt, frag], i) => ({ rt, grid: ATLAS_KINDS[name].grid, progs: programsFor(post, name, frag), stat: stats[i] }));
    S.programs = jobs.reduce((n, j) => n + j.progs.length, 0);
    S.cells = jobs.reduce((n, j) => n + j.progs.reduce((m, p) => m + p.cells.length, 0), 0);
    let go;
    const started = new Promise((res) => { go = res; });
    start = () => go();
    ready = started.then(() => wait(0)).then(() => bakeStepped(post, jobs, parallel, S))
      .then(() => { S.phase = 'done'; }, (e) => { S.phase = 'done'; console.error(`[fx] atlas bake failed: ${e && e.message}`); });
    // without the extension nothing starts before start(), unless asked to (opts.defer === false)
    if (opts.defer === false || (opts.defer === undefined && parallel)) start();
  }
  return {
    particles, decals, ready, stats, start,
    // share of the work done: compiles and cells count alike
    progress() { const all = S.programs + S.cells; return S.phase === 'done' || !all ? 1 : (S.compiled + S.drawn) / all; },
    label() {
      if (S.phase === 'compiling') return `Preparing effects: compiling ${Math.min(S.compiled + (S.parallel ? 0 : 1), S.programs)} / ${S.programs}`;
      if (S.phase === 'drawing') return `Preparing effects: drawing ${Math.min(S.drawn, S.cells)} / ${S.cells}`;
      return 'Preparing effects';
    },
    // after a context restore the targets exist again but are empty: draw them again
    rebake() { bakeNow(post, particles, 'particles', PARTICLE_FRAG); bakeNow(post, decals, 'decals', DECAL_FRAG); },
    dispose() { particles.dispose(); decals.dispose(); },
  };
}
