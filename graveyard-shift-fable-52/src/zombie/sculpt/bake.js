// Detail is baked at load by evaluating the sculpt on the GPU. The cages are drawn into the atlas
// (position = uv) carrying rest position and normal; per texel the fragment shader evaluates the
// field plus a finer displacement layer (creases at joints, forehead and lip lines, the fold from
// nose to mouth, skin relief, vein cords) and writes
//   normalAo         rg = slope of the detailed surface along the u and v directions (encoded tan),
//                    b = ambient occlusion from field taps along the normal, a = broad cavity
//   albedoRough      rgb = dead skin, painted from anatomy (sqrt encoded), a = roughness
//   thicknessCavity  r = thinness from taps along the inverse normal, g = fine cavity,
//                    b = scalp hair cover, a = "special" (eyeball, nail: not tinted by skin tone, wet)
// One draw per cage region, so the work can be spread over frames; then one cheap pass grows every
// region into its gutter. The sculpt is never meshed at high resolution.
import {
  WebGLRenderTarget, RawShaderMaterial, Mesh, BufferGeometry, BufferAttribute, Scene, OrthographicCamera, DataTexture, PlaneGeometry,
  RGBAFormat, FloatType, UnsignedByteType, NearestFilter, LinearFilter, LinearMipmapLinearFilter, NoBlending, GLSL3, NoColorSpace, ClampToEdgeWrapping, DoubleSide,
} from 'three';
import { SDF_GLSL, STRIDE } from './sdf.js';
import { EYE, EYE_R, MOUTH_Y } from './head.js';
import { WRIST } from './hands.js';
import { ELBOW, KNEE } from './figure.js';
import { SHOULDER, ARM_ABDUCT } from '../skeleton.js';
import { canCompileInParallel, gpuIdle } from '../../render/warm.js';
import { rollLoops, ROLL_UNIFORMS } from '../../render/rollLoops.js';

// The bake shaders' loops stay loops (render/rollLoops.js): Direct3D's compiler otherwise unrolls them,
// and every call inside them, into seconds of compile on every Windows PC.
const ROLLED = (src) => rollLoops(src).src;

const v3 = (a) => `vec3(${a.map((v) => v.toFixed(5)).join(', ')})`;

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
out vec3 vP; out vec3 vN;
void main() { vP = position; vN = normal; gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler3D;
in vec3 vP; in vec3 vN;
layout(location = 0) out vec4 oNormalAo;
layout(location = 1) out vec4 oAlbedo;
layout(location = 2) out vec4 oThick;
layout(location = 3) out vec4 oMask;
uniform sampler3D tNzA; uniform sampler3D tNzB;
uniform vec2 uRes;
uniform vec4 uJoint[24]; uniform vec3 uJointAx[24]; uniform int uJointN;
uniform vec4 uNail[5]; uniform vec3 uNailAx[5]; uniform vec3 uNailUp;
${SDF_GLSL}
const vec3 EYE = ${v3(EYE)}; const float EYE_R = ${EYE_R.toFixed(5)};
const vec3 SH = ${v3(SHOULDER)}; const vec3 ARM = vec3(${Math.sin(ARM_ABDUCT).toFixed(5)}, ${(-Math.cos(ARM_ABDUCT)).toFixed(5)}, 0.0);
const vec3 WR = ${v3(WRIST)};
float fbm(vec3 p, float f) { return textureLod(tNzA, p * (f / 8.0), 0.0).x; }
vec4 voro(vec3 p, float c) { return textureLod(tNzB, p * (c / 16.0), 0.0); }
// a thin groove at every integer of x
float groove(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(fract(x) - 0.5)); }
float segDist(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

// where the veins stand out as cords
float veinMask(vec3 q) {
  vec3 v = q - SH; float al = dot(v, ARM); float rho = length(v - ARM * al);
  float arm = smoothstep(0.3, 0.4, al) * (1.0 - smoothstep(0.06, 0.09, rho)) * (1.0 - smoothstep(0.66, 0.7, al));
  float foot = (1.0 - smoothstep(0.07, 0.12, q.y)) * smoothstep(-0.02, 0.03, q.z);
  float temple = smoothstep(0.052, 0.062, q.x) * smoothstep(1.69, 1.7, q.y) * (1.0 - smoothstep(1.73, 1.75, q.y)) * smoothstep(0.0, 0.02, q.z) * 0.7;
  float neck = smoothstep(1.49, 1.51, q.y) * (1.0 - smoothstep(1.58, 1.6, q.y)) * smoothstep(0.02, 0.035, q.x) * 0.6;
  return clamp(arm + foot + temple + neck, 0.0, 1.0);
}
float gCord = 0.0;
// fine relief in metres, positive outward
float detail(vec3 p) {
  vec3 q = vec3(abs(p.x), p.yz);
  float h = (fbm(p, 55.0) - 0.5) * 0.0006 + (fbm(p + 7.3, 210.0) - 0.5) * 0.00014;
  vec4 mv = voro(p, 950.0);
  h -= (1.0 - smoothstep(0.0, 0.2, mv.g)) * 0.00005;
  for (int i = 0; i < uJointN; i++) {
    vec3 d = q - uJoint[i].xyz; float r = uJoint[i].w;
    float k = 1.0 - smoothstep(0.45, 1.0, length(d) / r);
    if (k > 0.0) h -= k * groove(dot(d, uJointAx[i]) / (r * 0.26) + (fbm(p + 3.1, 120.0) - 0.5) * 1.4, 0.2) * r * 0.014;
  }
  if (q.y > 1.5) {
    float w1 = (fbm(p + 1.7, 30.0) - 0.5);
    float fk = smoothstep(1.706, 1.716, q.y) * (1.0 - smoothstep(1.74, 1.752, q.y)) * smoothstep(0.045, 0.07, q.z) * (1.0 - smoothstep(0.042, 0.06, q.x));
    h -= fk * groove(q.y * 78.0 + w1 * 2.6 + q.x * 6.0, 0.12) * 0.00032 * (0.4 + 1.2 * fbm(p + 2.0, 22.0));
    float gk = (1.0 - smoothstep(0.004, 0.0095, q.x)) * smoothstep(1.692, 1.7, q.y) * (1.0 - smoothstep(1.712, 1.72, q.y)) * step(0.08, q.z);
    h -= gk * groove(q.x * 150.0 + 0.5 + w1, 0.18) * 0.0006;
    vec3 d = q - (EYE + vec3(0.0155, 0.0005, 0.006));
    float ck = smoothstep(0.002, 0.006, d.x) * (1.0 - smoothstep(0.011, 0.019, length(d.xy)));
    h -= ck * groove(atan(d.y, d.x) * 3.0, 0.2) * 0.0004;
    vec2 e2 = vec2(q.x - EYE.x, q.y - EYE.y);
    float under = smoothstep(-0.021, -0.012, e2.y) * (1.0 - smoothstep(-0.011, -0.008, e2.y)) * (1.0 - smoothstep(0.011, 0.018, abs(e2.x))) * step(0.05, q.z);
    h -= under * groove((e2.y - e2.x * e2.x * 9.0) * 250.0, 0.22) * 0.00035;
    // upper lid crease
    h -= 0.0006 * exp(-pow((e2.y - 0.0088 + e2.x * e2.x * 14.0) / 0.0011, 2.0)) * (1.0 - smoothstep(0.012, 0.017, abs(e2.x))) * step(0.05, q.z);
    h -= 0.0012 * exp(-pow(segDist(q, vec3(0.0225, 1.6485, 0.092), vec3(0.033, 1.615, 0.078)) / 0.003, 2.0));
    float lk = (1.0 - smoothstep(0.019, 0.0255, q.x)) * (1.0 - smoothstep(0.006, 0.011, abs(q.y - ${MOUTH_Y.toFixed(4)}))) * smoothstep(0.076, 0.086, q.z);
    h -= lk * groove(q.x * 480.0 + fbm(p, 300.0) * 2.0, 0.22) * 0.0003;
    float nk = (1.0 - smoothstep(1.57, 1.59, q.y)) * smoothstep(-0.03, 0.02, q.z);
    h -= nk * groove(q.y * 80.0 + w1 * 1.3, 0.14) * 0.00035;
  }
  vec4 vv = voro(p + (fbm(p, 18.0) - 0.5) * 0.03, 27.0);
  gCord = 1.0 - smoothstep(0.0, 0.075, vv.g);
  h += gCord * veinMask(q) * 0.00065;
  // ribs under the arm, the edge of the rib cage
  float rk = smoothstep(0.085, 0.13, q.x) * (1.0 - smoothstep(1.29, 1.33, q.y)) * smoothstep(1.12, 1.16, q.y) * smoothstep(-0.03, 0.03, q.z);
  h -= rk * groove((q.y + q.x * 0.3) * 29.0, 0.3) * 0.0013;
  // nails: a flat plate with a groove round it
  for (int i = 0; i < 5; i++) {
    vec3 d = q - uNail[i].xyz; float r = uNail[i].w;
    float al = dot(d, uNailAx[i]), up = dot(d, uNailUp);
    float lat = length(d - uNailAx[i] * al - uNailUp * up);
    float e = max(abs(al) / (r * 1.25), lat / (r * 0.82));
    if (up > 0.0) h -= (1.0 - smoothstep(0.0, 0.14, abs(e - 1.0))) * 0.00035;
  }
  return h;
}
float nailMask(vec3 q) {
  float m = 0.0;
  for (int i = 0; i < 5; i++) {
    vec3 d = q - uNail[i].xyz; float r = uNail[i].w;
    float al = dot(d, uNailAx[i]), up = dot(d, uNailUp);
    float lat = length(d - uNailAx[i] * al - uNailUp * up);
    if (up > r * 0.25) m = max(m, 1.0 - smoothstep(0.9, 1.0, max(abs(al) / (r * 1.25), lat / (r * 0.82))));
  }
  return m;
}
float fieldD(vec3 p) { return sdFigure(p) - detail(p); }
float enc(float t) { return 0.5 + 0.5 * sign(t) * sqrt(min(abs(t), 3.0) / 3.0); }

void main() {
  vec3 N0 = normalize(vN);
  vec3 p = vP;
  float d0 = sdFigure(p);       // how far the cage itself is from the skin here
  p -= N0 * d0; p -= N0 * sdFigure(p);
  // detailed normal: tetrahedral taps
  const float e = 0.00022;
  const vec2 k = vec2(1.0, -1.0);
  vec3 nd = normalize(k.xyy * fieldD(p + k.xyy * e) + k.yyx * fieldD(p + k.yyx * e) + k.yxy * fieldD(p + k.yxy * e) + k.xxx * fieldD(p + k.xxx * e));
  float cordHere = gCord;
  const float em = 0.0012;
  vec3 nm = normalize(k.xyy * sdFigure(p + k.xyy * em) + k.yyx * sdFigure(p + k.yyx * em) + k.yxy * sdFigure(p + k.yxy * em) + k.xxx * sdFigure(p + k.xxx * em));
  // the u and v directions in the plane of the shading normal (the facet's own tangents tilt against
  // it by half the angle a cell turns through, which would bake the cage in as a sawtooth)
  vec3 Tu = dFdx(vP), Tv = dFdy(vP);
  Tu = normalize(Tu - N0 * dot(Tu, N0)); Tv = normalize(Tv - N0 * dot(Tv, N0));
  float dn = max(dot(nd, N0), 0.25);
  oNormalAo.r = enc(-dot(nd, Tu) / dn);
  oNormalAo.g = enc(-dot(nd, Tv) / dn);
  // occlusion: how much closer the surface is than open space along the normal
  float occ = 0.0;
  occ += max(0.0, 0.003 - sdFigure(p + nm * 0.003)) / 0.003 * 0.3;
  occ += max(0.0, 0.008 - sdFigure(p + nm * 0.008)) / 0.008 * 0.35;
  occ += max(0.0, 0.02 - sdFigure(p + nm * 0.02)) / 0.02 * 0.4;
  occ += max(0.0, 0.045 - sdFigure(p + nm * 0.045)) / 0.045 * 0.4;
  occ += max(0.0, 0.1 - sdFigure(p + nm * 0.1)) / 0.1 * 0.35;
  float ao = clamp(1.0 - occ, 0.0, 1.0);
  float cavB = clamp((0.006 - sdFigure(p + nm * 0.006)) / 0.006 * 1.6, 0.0, 1.0);
  float cavF = clamp(((0.0009 - fieldD(p + nd * 0.0009)) / 0.0009) * 0.9 + ((0.0022 - fieldD(p + nd * 0.0022)) / 0.0022) * 0.8, 0.0, 1.0);
  oNormalAo.b = ao; oNormalAo.a = cavB;
  float thin = (smoothstep(-0.004, 0.0, sdFigure(p - nm * 0.004)) + smoothstep(-0.009, 0.0, sdFigure(p - nm * 0.009)) + smoothstep(-0.018, -0.003, sdFigure(p - nm * 0.018))) / 3.0;

  // ---- paint
  vec3 q = vec3(abs(p.x), p.yz);
  float big = fbm(p + 11.0, 7.0), mid = fbm(p + 4.0, 38.0);
  float bN = clamp((big - 0.3) * 2.5, 0.0, 1.0), mN = clamp((mid - 0.3) * 2.5, 0.0, 1.0);
  vec3 alb = vec3(0.235, 0.24, 0.205);                                  // drained grey with green in it
  alb = mix(alb, vec3(0.18, 0.155, 0.2), smoothstep(0.4, 0.75, bN) * 0.65);   // purple-grey drifts
  alb *= 0.9 + 0.2 * mN;
  // lividity: blood pooled low and at the ends
  vec3 av = q - SH; float al = dot(av, ARM); float rho = length(av - ARM * al);
  float onArm = (1.0 - smoothstep(0.07, 0.1, rho)) * step(0.0, al);
  float hand = onArm * smoothstep(0.52, 0.62, al);
  float lowLeg = 1.0 - smoothstep(0.12, 0.56 + 0.2 * (bN - 0.5), q.y);
  float head = smoothstep(1.5, 1.56, q.y);
  float livid = clamp(hand * (0.55 + 0.45 * smoothstep(0.66, 0.74, al)) + lowLeg * 0.8 + onArm * smoothstep(0.3, 0.5, al) * 0.3 * bN, 0.0, 1.0);
  // face: the ends of the nose and ears, the sockets, the lips
  float de = length(q - EYE) - EYE_R;
  float orbit = (1.0 - smoothstep(0.012, 0.03, length((q - EYE) * vec3(1.0, 1.25, 0.6)))) * head;
  float lipK = (1.0 - smoothstep(0.02, 0.027, q.x)) * (1.0 - smoothstep(0.0055, 0.0095, abs(q.y - ${(MOUTH_Y - 0.0005).toFixed(4)}))) * smoothstep(0.078, 0.085, q.z);
  float noseTip = (1.0 - smoothstep(0.008, 0.02, length(q - vec3(0.0, 1.646, 0.112)))) * 0.22;
  float ear = smoothstep(0.076, 0.082, q.x) * head * 0.6;
  livid = clamp(livid + noseTip + ear, 0.0, 1.0);
  // (livid means purple: the hands, the feet and shins, the ears; it must read as colour, not as grey)
  alb = mix(alb, vec3(0.17, 0.078, 0.165) * (0.8 + 0.4 * mN), livid * (0.7 + 0.3 * mN));
  // round the eyes and the mouth the skin is raw and red-brown, not drained
  alb = mix(alb, vec3(0.135, 0.05, 0.045), orbit * 0.85);
  float perioral = (1.0 - smoothstep(0.012, 0.034, length((q - vec3(0.0, ${(MOUTH_Y).toFixed(4)}, 0.088)) * vec3(0.75, 1.25, 1.0)))) * head * step(0.05, q.z);
  alb = mix(alb, vec3(0.15, 0.062, 0.055), perioral * 0.5);
  // the bridge and tip of the nose stay pale and waxy, so the nose stands apart from the mouth under it
  float noseK = (1.0 - smoothstep(0.006, 0.016, segDist(q, vec3(0.0, 1.69, 0.094), vec3(0.0, 1.65, 0.114)))) * head;
  noseK *= 1.0 - smoothstep(0.006, 0.012, q.x);       // (the ridge only: on the wings the pale stood out as hard-edged patches beside the nostrils)
  alb = mix(alb, alb * 1.25 + vec3(0.015, 0.014, 0.01), noseK * 0.6);
  // the wings of the nose and the crease behind them: raw and dark, so they sink into the cheek
  float wing = (1.0 - smoothstep(0.5, 1.15, length((q - vec3(0.0165, 1.6445, 0.097)) / vec3(0.011, 0.01, 0.014)))) * head;
  alb = mix(alb, alb * vec3(0.72, 0.5, 0.48), wing * 0.7);
  // raw at the knuckles, elbows, knees, nostrils and lid edges
  float raw = 0.0;
  for (int i = 0; i < uJointN; i++) raw = max(raw, 1.0 - smoothstep(0.3, 0.9, length(q - uJoint[i].xyz) / uJoint[i].w));
  alb = mix(alb, alb * vec3(1.05, 0.72, 0.68), raw * 0.45);
  // veins show through as a dark net everywhere, strongest where they stand out
  float net = (1.0 - smoothstep(0.0, 0.11, voro(p + (fbm(p, 18.0) - 0.5) * 0.03, 27.0).g)) * smoothstep(0.3, 0.65, bN * 0.5 + mN * 0.5);
  alb = mix(alb, alb * vec3(0.5, 0.62, 0.66), clamp(net * 0.55 + cordHere * veinMask(q) * 0.5, 0.0, 0.8));
  // decay: near-black green blotches
  float nec = smoothstep(0.66, 0.84, (1.0 - mN) * 0.55 + bN * 0.45);
  alb = mix(alb, alb * vec3(0.4, 0.5, 0.32), nec * 0.6);
  float rough = mix(0.7, 0.52, smoothstep(0.35, 0.7, mN * 0.5 + (1.0 - bN) * 0.5));
  // creases hold dirt and old blood
  alb *= 1.0 - 0.3 * cavF - 0.12 * cavB;
  alb = mix(alb, vec3(0.105, 0.04, 0.048) * (0.7 + 0.6 * mN), lipK * 0.85);
  rough = mix(rough, 0.42, lipK);
  // eyebrows: short dark strokes along the ridge
  {
    float bd = segDist(q, vec3(0.0135, 1.6995, 0.091), vec3(0.03, 1.7035, 0.085));
    bd = min(bd, segDist(q, vec3(0.03, 1.7035, 0.085), vec3(0.049, 1.7005, 0.0725)));
    float st = fbm(vec3(q.x * 2.0 + q.y * 9.0, q.y * 2.0 - q.x * 3.0, q.z) , 1400.0);
    float brow = (1.0 - smoothstep(0.0028, 0.0062, bd)) * smoothstep(0.38, 0.6, st + (1.0 - bd / 0.006) * 0.25) * head;
    alb = mix(alb, vec3(0.022, 0.018, 0.015), brow * 0.9);
    rough = mix(rough, 0.7, brow);
  }
  // Where the cage cannot follow the skin (one radial sheet from the tip of the nose to the lip and
  // the cheek: under the nose, behind its wings) a texel is not on the skin at all. It is the
  // shadow in that hollow: dark, matt and flat, not a smear of the pale nose across it.
  float hollow = smoothstep(0.0012, 0.0032, abs(d0)) * head * step(0.07, q.z) * (1.0 - smoothstep(0.028, 0.038, q.x)) * smoothstep(1.622, 1.63, q.y) * (1.0 - smoothstep(1.664, 1.672, q.y));
  if (hollow > 0.0) {
    alb = mix(alb, vec3(0.03, 0.015, 0.014), hollow * 0.9);
    rough = mix(rough, 0.85, hollow);
    oNormalAo.rg = mix(oNormalAo.rg, vec2(0.5), hollow);
    oNormalAo.b *= 1.0 - 0.75 * hollow;
  }
  float special = 0.0;
  // the eyeball where it shows: yellowed white with red threads, darker under the lids
  float sclera = (1.0 - smoothstep(0.00025, 0.0007, abs(de))) * head;
  // only between the lids: the floor of the socket above and below them is as far from the middle
  // of the ball as the ball is, and was painted white in slivers
  { vec2 e2 = q.xy - EYE.xy; sclera *= (1.0 - smoothstep(0.0042, 0.0056, e2.y)) * smoothstep(-0.0092, -0.0078, e2.y) * (1.0 - smoothstep(0.0122, 0.0138, abs(e2.x))) * step(0.06, q.z); }
  if (sclera > 0.0) {
    float thr = 1.0 - smoothstep(0.0, 0.12, voro(p * vec3(1.0, 2.2, 1.0), 420.0).g);
    vec3 sc = mix(vec3(0.21, 0.175, 0.13), vec3(0.22, 0.045, 0.035), thr * 0.7 + 0.45 * smoothstep(0.003, 0.011, length(q.xy - EYE.xy)));
    alb = mix(alb, sc * (1.0 - 0.5 * cavB), sclera);
    rough = mix(rough, 0.1, sclera);
    special = sclera;
  }
  // lid margins: wet, dark, a lash line
  float lidEdge = smoothstep(0.0007, 0.001, de) * (1.0 - smoothstep(0.0016, 0.003, de)) * head * step(0.05, q.z) * (1.0 - smoothstep(0.012, 0.017, abs(q.x - EYE.x)));
  alb = mix(alb, vec3(0.03, 0.016, 0.016), lidEdge * 0.9);
  rough = mix(rough, 0.25, lidEdge);
  float nail = nailMask(q);
  alb = mix(alb, vec3(0.13, 0.11, 0.13) * (0.8 + 0.3 * mN), nail);
  alb = mix(alb, vec3(0.03, 0.02, 0.016), nail * smoothstep(0.55, 0.8, fbm(p, 420.0)) * 0.8);   // dirt and blood under them
  rough = mix(rough, 0.3, nail);
  special = max(special, nail * 0.6);
  // scalp: where hair grows
  float hl = mix(1.632, 1.748, smoothstep(-0.06, 0.07, q.z)) + 0.016 * smoothstep(0.028, 0.06, q.x) * smoothstep(0.03, 0.06, q.z) - 0.05 * smoothstep(0.066, 0.075, q.x) * smoothstep(-0.03, 0.0, q.z) * (1.0 - smoothstep(0.02, 0.04, q.z));
  float scalp = smoothstep(0.0, 0.012, q.y - hl + (mN - 0.5) * 0.012) * head * (1.0 - smoothstep(0.079, 0.083, q.x));
  oAlbedo = vec4(sqrt(clamp(alb, 0.0, 1.0)), clamp(rough, 0.0, 1.0));
  oThick = vec4(thin, cavF, scalp, special);
  oMask = vec4(1.0);
}
`;

const DILATE = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2; uniform sampler2D tM; uniform vec2 uPx;
void main() {
  vec2 uv = vUv;
  if (texture(tM, uv).r < 0.5) {
    float best = 99.0;
    for (int r = 1; r <= 6; r++) for (int d = 0; d < 8; d++) {
      vec2 o = vec2(d == 0 || d == 4 || d == 5 ? 1.0 : d == 1 || d == 6 || d == 7 ? -1.0 : 0.0, d == 2 || d == 4 || d == 6 ? 1.0 : d == 3 || d == 5 || d == 7 ? -1.0 : 0.0) * float(r);
      float l = length(o);
      // level 0 named outright: tM has no mip levels, so this is what texture() read, without a
      // derivative inside the loop's branch (Direct3D's compiler warns about those, X3595)
      if (l < best && textureLod(tM, vUv + o * uPx, 0.0).r > 0.5) { best = l; uv = vUv + o * uPx; }
    }
  }
  o0 = texture(t0, uv); o1 = texture(t1, uv); o2 = texture(t2, uv);
}
`;

const QUAD_VERT = 'precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function placeholder(r, g, b, a) {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}
export function primTexture(fig) {
  const D = fig.pack(), n = fig.n;
  const data = new Float32Array(n * 6 * 4);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE, t = i * 24;
    data.set([D[o], D[o + 1], D[o + 2], D[o + 3], D[o + 4], D[o + 5], D[o + 6], D[o + 7], D[o + 8], D[o + 9], D[o + 10], D[o + 11],
      D[o + 12], D[o + 13], D[o + 14], 0, D[o + 16], D[o + 17], D[o + 18], 0, D[o + 20], D[o + 21], D[o + 22], D[o + 23]], t);
  }
  const tex = new DataTexture(data, 6, n, RGBAFormat, FloatType);
  tex.minFilter = NearestFilter; tex.magFilter = NearestFilter; tex.needsUpdate = true;
  return tex;
}

function setupOut(tex, aniso) {
  tex.minFilter = LinearMipmapLinearFilter; tex.magFilter = LinearFilter; tex.generateMipmaps = true;
  tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping; tex.colorSpace = NoColorSpace; tex.anisotropy = aniso;
}

// Compiles a bake's shaders before its first draw, so that draw does not wait for the driver:
// [scene, target] pairs, each compiled against its target. With KHR_parallel_shader_compile on the
// driver's threads; without it the compile is issued and waited for with a GPU fence (warm.js gpuIdle).
function compileFirst(renderer, pairs, cam) {
  const parallel = canCompileInParallel(renderer) && typeof renderer.compileAsync === 'function';
  const prev = renderer.getRenderTarget();
  const waits = [];
  try {
    for (const [scene, target] of pairs) {
      renderer.setRenderTarget(target);
      if (parallel) waits.push(renderer.compileAsync(scene, cam).catch(() => {}));
      else renderer.compile(scene, cam);
    }
  } catch { /* the first draw compiles it */ } finally { renderer.setRenderTarget(prev); }
  // without the extension the compile runs in the browser's GPU process: wait for it there
  return Promise.all(waits).then(() => gpuIdle(renderer.getContext ? renderer.getContext() : null));
}

// What a job needs to run: saves and restores the renderer's state around each slice.
function withRenderer(renderer, fn) {
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevShadow = renderer.shadowMap.autoUpdate;
  const prevXr = renderer.xr && renderer.xr.enabled;
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
  try { fn(); } finally {
    renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto; renderer.shadowMap.autoUpdate = prevShadow;
    if (renderer.xr) renderer.xr.enabled = prevXr;
  }
}

// Joints that crease, and the nails, from the figure's landmarks (left side; the bake folds x).
function jointUniforms(fig) {
  const J = [], A = [];
  const dir = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return d.map((v) => v / l); };
  const fingers = fig.marks.fingers.concat([fig.marks.thumb]);
  for (const f of fingers) for (let k = 1; k <= 3; k++) { J.push([...f.pts[k], f.r[k - 1] * 1.7]); A.push(dir(f.pts[k], f.pts[k + 1])); }
  J.push([...ELBOW, 0.06]); A.push(dir(SHOULDER, ELBOW));
  J.push([...WRIST, 0.035]); A.push(dir(ELBOW, WRIST));
  J.push([...KNEE, 0.075]); A.push([0, 1, 0]);
  const N = [], NA = [];
  for (const f of fingers) {
    const d = dir(f.pts[3], f.pts[4]);
    N.push([f.pts[4][0] - d[0] * 0.0075, f.pts[4][1] - d[1] * 0.0075, f.pts[4][2] - d[2] * 0.0075, f.r[3] * 1.05]); NA.push(d);
  }
  return { J, A, N, NA };
}

// bakeCharacter(G, figure, atlas, opts) -> { normalAo, albedoRough, thicknessCavity, done, progress, step(), finish() }
//   atlas: { size, position, normal, uv (Float32Arrays of the cage vertices), index (Uint32Array),
//            regions: [[start, count], ...] index ranges, one draw each }
//   opts.onProgress(fraction)
// The textures exist at once (blank until their region is drawn); call step() until done (one
// region per call) or finish() to run everything now.
export function bakeCharacter(G, figure, atlas, opts = {}) {
  const renderer = G && G.renderer;
  if (!renderer || renderer.stub || !renderer.getContext || (G.mats && G.mats.noise && G.mats.noise.placeholder)) {
    return { normalAo: placeholder(128, 128, 255, 0), albedoRough: placeholder(150, 150, 140, 140), thicknessCavity: placeholder(0, 0, 0, 0), done: true, progress: 1, step() { return true; }, finish() {}, ms: 0 };
  }
  const size = atlas.size;
  const mk = (count) => new WebGLRenderTarget(size, size, { count, depthBuffer: false, type: UnsignedByteType, format: RGBAFormat });
  const tmp = mk(4), out = mk(3);
  for (const t of tmp.textures) { t.minFilter = NearestFilter; t.magFilter = NearestFilter; t.generateMipmaps = false; }
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  for (const t of out.textures) setupOut(t, aniso);
  const prims = primTexture(figure);
  const ju = jointUniforms(figure);
  const pad = (list, n, w) => { const o = []; for (let i = 0; i < n; i++) o.push(...(list[i] || new Array(w).fill(0))); return new Float32Array(o); };
  const mat = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: VERT, fragmentShader: ROLLED(FRAG), depthTest: false, depthWrite: false, blending: NoBlending, side: DoubleSide,
    uniforms: {
      ...ROLL_UNIFORMS(),
      tPrims: { value: prims }, uPrimN: { value: figure.n }, tNzA: { value: G.mats.noise.tNzA }, tNzB: { value: G.mats.noise.tNzB }, uRes: { value: [size, size] },
      uJoint: { value: pad(ju.J, 24, 4) }, uJointAx: { value: pad(ju.A, 24, 3) }, uJointN: { value: ju.J.length },
      uNail: { value: pad(ju.N, 5, 4) }, uNailAx: { value: pad(ju.NA, 5, 3) }, uNailUp: { value: [Math.cos(ARM_ABDUCT), Math.sin(ARM_ABDUCT), 0] },
    },
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(atlas.position, 3));
  geo.setAttribute('normal', new BufferAttribute(atlas.normal, 3));
  geo.setAttribute('uv', new BufferAttribute(atlas.uv, 2));
  geo.setIndex(new BufferAttribute(atlas.index, 1));
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new Scene(); scene.add(mesh);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const regions = atlas.regions.slice();
  const total = regions.length + 1;
  // the pass that grows every region into its gutter, drawn last
  const dm = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: QUAD_VERT, fragmentShader: DILATE, depthTest: false, depthWrite: false, blending: NoBlending,
    uniforms: { t0: { value: tmp.textures[0] }, t1: { value: tmp.textures[1] }, t2: { value: tmp.textures[2] }, tM: { value: tmp.textures[3] }, uPx: { value: [1 / size, 1 / size] } },
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), dm); quad.frustumCulled = false;
  const s2 = new Scene(); s2.add(quad);
  let at = 0;
  let band = 0; let bands = 1;
  const t0 = performance.now();
  const job = {
    normalAo: out.textures[0], albedoRough: out.textures[1], thicknessCavity: out.textures[2], done: false, progress: 0, ms: 0, target: out,
    // resolves once both shaders are compiled (see compileFirst); step() works without waiting for it
    prepare() { return compileFirst(renderer, [[scene, tmp], [s2, out]], cam); },
    // bands > 1: a region is drawn in that many horizontal strips, one strip a step (a scissor on
    // the target). Each texel is written by the same triangles in the same order, so the maps are
    // the same; a slow GPU gets shorter pieces of work. Read when a region starts.
    bands: 1,
    step() {
      if (job.done) return true;
      withRenderer(renderer, () => {
        if (at === 0 && band === 0) { renderer.setRenderTarget(tmp); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); }
        if (at < regions.length) {
          if (band === 0) bands = Math.max(1, Math.min(64, Math.floor(job.bands) || 1));
          geo.setDrawRange(regions[at][0], regions[at][1]);
          if (bands > 1) {
            const h = Math.ceil(size / bands);
            tmp.scissor.set(0, band * h, size, Math.min(h, size - band * h));
            tmp.scissorTest = true;
          }
          renderer.setRenderTarget(tmp);
          try { renderer.render(scene, cam); } finally { tmp.scissorTest = false; }
        } else {
          renderer.setRenderTarget(out);
          renderer.render(s2, cam);
          dm.dispose(); quad.geometry.dispose();
        }
      });
      if (at < regions.length && ++band < bands) {
        job.progress = (at + band / bands) / total;
        if (opts.onProgress) opts.onProgress(job.progress);
        return false;
      }
      band = 0;
      at++;
      job.progress = at / total;
      if (opts.onProgress) opts.onProgress(job.progress);
      if (at >= total) {
        job.done = true;
        tmp.dispose(); mat.dispose(); geo.dispose(); prims.dispose();
        job.ms = performance.now() - t0;
      }
      return job.done;
    },
    finish() { while (!job.step()); },
  };
  return job;
}

// ---- garments -----------------------------------------------------------------------------------
// A garment piece is a rectangle of cloth with metric coordinates (u round or across, v down), so its
// relief is a 2D function: a fold model that knows where the joint is (compression folds inside the
// elbow and behind the knee), where the cloth hangs from (drape folds growing down a shirt or a
// skirt), where it stacks (over the boot), and the tailoring: seams, hems, plackets with buttons,
// pockets, collars, ribbing, webbing. Written to one atlas: rg = slopes, b = occlusion (valleys),
// a = seams (above 0.5 thread, below 0.5 a dark edge).
const GARMENT_FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 oC;
uniform sampler3D tNzA;
uniform vec2 uSize; uniform int uKind; uniform int uStyle; uniform vec4 uV; uniform float uSeed;
float gSt = 0.0, gDk = 0.0;
float n2(float x, float y) { return textureLod(tNzA, vec3(x, y, uSeed) / 8.0, 0.0).x; }
// creases: a ridged noise, stretched so folds run along one direction
float fold(vec2 p, vec2 f) { float n = n2(p.x * f.x, p.y * f.y); return 1.0 - abs(2.0 * clamp((n - 0.5) * 2.2 + 0.5, 0.0, 1.0) - 1.0); }
float lineD(float d, float w) { return 1.0 - smoothstep(w * 0.5, w, abs(d)); }
float stitch(float d, float along) { return lineD(d, 0.0011) * step(0.35, fract(along * 300.0)); }
// a seam: a slight ridge with a row of stitches each side
float seam(float d, float along, float dbl) { gSt = max(gSt, max(stitch(d - 0.004, along), dbl * stitch(d + 0.004, along))); gDk = max(gDk, lineD(d, 0.0008)); return 0.0005 * (1.0 - smoothstep(0.0, 0.006, abs(d))); }
float rectD(vec2 p, vec2 c, vec2 h) { vec2 e = abs(p - c) - h; return max(e.x, e.y); }
float pocket(vec2 p, vec2 c, vec2 h) { float d = rectD(p, c, h); gSt = max(gSt, stitch(d + 0.004, p.x + p.y)); gDk = max(gDk, lineD(d, 0.001)); return 0.0009 * (1.0 - smoothstep(-0.004, 0.0, d)); }
float height(vec2 p) {
  float W = uSize.x, H = uSize.y, u = p.x, v = p.y, h = 0.0;
  float hemD = H - v;
  if (uKind == 0) {
    // ---- a body: hangs from the shoulders, gathers at the waist
    // (an undershirt lies on the body: the long hanging folds of a shirt, baked into it at full
    // depth, read as a smear down the chest. A robe is thick: its folds are broad, not deep.)
    float soft = uStyle == 6 ? 0.0 : uStyle == 4 ? 1.0 : uStyle == 5 ? 0.4 : (uStyle == 2 || uStyle == 9) ? 0.22 : uStyle == 1 ? 0.75 : 1.0;
    h += soft * 0.007 * (fold(p, vec2(uStyle == 4 ? 8.0 : 12.0, 3.4)) - 0.5) * (0.4 + 0.6 * v / H) + min(1.0, soft * 1.2) * 0.002 * (fold(p + 7.0, vec2(30.0, 9.0)) - 0.5);
    h += soft * 0.0025 * (fold(p + 3.0, vec2(4.0, 14.0)) - 0.5) * smoothstep(H - 0.2, H - 0.03, v);
    for (int k = 0; k < 2; k++) {
      vec2 d = p - vec2(W * (k == 0 ? 0.25 : 0.75), 0.13);
      h += soft * 0.003 * sin(length(d * vec2(1.0, 0.6)) * 95.0) * exp(-length(d) / 0.085);       // drag lines from the armpit
    }
    float side = min(abs(u - W * 0.25), abs(u - W * 0.75));
    if (uStyle != 6 && uStyle != 4) h += seam(side, v, 0.0);
    if (uStyle != 6) h += seam(hemD - 0.014, u, 0.0) + 0.0006 * (1.0 - smoothstep(0.0, 0.016, hemD));
    float fc = abs(abs(u - W * 0.5) - uV.y);       // distance to the front opening's edge (uV.y = its half width) or the centre
    if (uStyle == 1) {
      h += 0.0008 * (1.0 - smoothstep(0.012, 0.016, fc)); gSt = max(gSt, stitch(fc - 0.012, v)); gDk = max(gDk, lineD(fc - 0.0165, 0.0008));
      float bv = fract(v / 0.085) - 0.5; float bd = length(vec2(fc - (uV.y > 0.0 ? 0.008 : 0.0), bv * 0.085));
      h += 0.0012 * (1.0 - smoothstep(0.004, 0.0055, bd)); gDk = max(gDk, lineD(bd - 0.0055, 0.0007));
      h += seam(v - 0.05, u, 0.0);
      h += pocket(p, vec2(W * 0.5 - 0.1, 0.25), vec2(0.048, 0.055)) + pocket(p, vec2(W * 0.5 + 0.1, 0.25), vec2(0.048, 0.055));
      gSt = max(gSt, stitch(v - 0.215, u) * step(rectD(p, vec2(W * 0.5 - 0.1, 0.25), vec2(0.048, 0.055)), 0.0));
    } else if (uStyle == 2 || uStyle == 9) {
      h += 0.0007 * sin(u * 700.0) * (1.0 - smoothstep(0.014, 0.018, v)); gDk = max(gDk, lineD(v - 0.018, 0.0008));
    } else if (uStyle == 3) {
      h += 0.001 * sin(u * 520.0) * (1.0 - smoothstep(0.045, 0.05, hemD)); gDk = max(gDk, lineD(hemD - 0.05, 0.001));
      h += pocket(p, vec2(W * 0.5, H - 0.2), vec2(0.13, 0.075));
    } else if (uStyle == 4) {
      h += 0.004 * (1.0 - smoothstep(0.05, 0.075, fc)); gDk = max(gDk, lineD(fc - 0.07, 0.0015));
      h += pocket(p, vec2(W * 0.5 - 0.17, H * 0.52), vec2(0.06, 0.07)) + pocket(p, vec2(W * 0.5 + 0.17, H * 0.52), vec2(0.06, 0.07));
    } else if (uStyle == 5) {
      gDk = max(gDk, lineD(fc - 0.012, 0.001)); gSt = max(gSt, stitch(fc - 0.008, v));
      h += pocket(p, vec2(W * 0.5 - 0.11, H - 0.13), vec2(0.06, 0.06)) + pocket(p, vec2(W * 0.5 + 0.11, H - 0.13), vec2(0.06, 0.06));
    } else if (uStyle == 6) {
      // armour: a plate carrier front and back, rows of webbing across it, a strap at each side
      float fr = rectD(p, vec2(W * 0.5, H * 0.52), vec2(0.15, H * 0.4)), bk = min(rectD(p, vec2(0.0, H * 0.52), vec2(0.15, H * 0.4)), rectD(p, vec2(W, H * 0.52), vec2(0.15, H * 0.4)));
      float pl = min(fr, bk);
      h += 0.003 * (1.0 - smoothstep(-0.006, 0.0, pl)); gDk = max(gDk, lineD(pl, 0.0012)); gSt = max(gSt, stitch(pl + 0.005, u + v));
      float web = step(pl, -0.012) * step(0.45, fract(v / 0.034));
      h += 0.0012 * web; gDk = max(gDk, web * lineD(fract(u / 0.038) - 0.5, 0.06) * 0.8);
      h += 0.002 * lineD(side, 0.03) * step(0.3, fract(v / 0.09));
    } else if (uStyle == 7 || uStyle == 8) {
      // the seat of a pair of trousers: waistband, fly, pockets
      h += 0.0008 * (1.0 - smoothstep(0.036, 0.04, v)); gSt = max(gSt, max(stitch(v - 0.004, u), stitch(v - 0.036, u))); gDk = max(gDk, lineD(v - 0.04, 0.001));
      float fly = abs(u - W * 0.5); h += seam(fly, v, 1.0); gSt = max(gSt, stitch(fly - 0.03 + max(0.0, v - 0.13) * 0.6, v) * step(v, 0.17));
      float bc = min(u, W - u);
      h += seam(bc, v, 1.0);
      if (uStyle == 7) { h += pocket(vec2(bc, v), vec2(0.105, 0.125), vec2(0.06, 0.065)); h += seam(v - 0.055 - bc * 0.22, u, 1.0) * step(bc, 0.27); }
      float fp = length(vec2(fc - 0.19, v - 0.03) * vec2(1.0, 0.75)) - 0.085; gSt = max(gSt, stitch(fp, u + v) * step(0.04, v)); gDk = max(gDk, lineD(fp - 0.004, 0.001) * step(0.04, v));
    } else if (uStyle == 10) {
      gSt = max(gSt, stitch(min(u, W - u) - 0.02, v));
      h += 0.001 * (1.0 - smoothstep(0.02, 0.024, min(u, W - u)));
    }
  } else if (uKind == 1 || uKind == 2) {
    // ---- a sleeve or a trouser leg: bunched at the joint, stacked at the hem
    float vj = uV.x * H;
    if (uV.x > 0.0) h += 0.0055 * (fold(p, vec2(2.6, 34.0)) - 0.35) * exp(-pow((v - vj) / 0.075, 2.0));
    h += 0.004 * (fold(p + 5.0, vec2(11.0, 6.0)) - 0.5) + 0.0008 * (fold(p + 8.0, vec2(26.0, 22.0)) - 0.5);
    if (uV.y > 0.5) h += 0.006 * (fold(p + 9.0, vec2(2.2, 40.0)) - 0.35) * smoothstep(H - 0.17, H - 0.03, v);
    float oseam = min(u, W - u), inn = abs(u - W * 0.5);
    int st = int(uV.w + 0.5);
    if (st == 4) {
      // a boot: creased across the ankle, laced up the front
      h += 0.002 * (fold(p, vec2(3.0, 60.0)) - 0.4) * smoothstep(H - 0.12, H, v);
      float lf = abs(u - W * 0.25);
      float lace = lineD(abs(fract(v / 0.028) - 0.5) * 0.028 - lf * 0.5, 0.0022) * step(lf, 0.02) * step(0.02, v);
      h += 0.0015 * lace; gSt = max(gSt, lace * 0.7); gDk = max(gDk, lineD(lf - 0.021, 0.0012));
      h += 0.001 * (1.0 - smoothstep(0.0, 0.012, v));
    } else {
      h += seam(oseam, v, st == 1 ? 1.0 : 0.0) + seam(inn, v, st == 1 ? 1.0 : 0.0);
      h += seam(hemD - 0.014, u, st == 1 ? 1.0 : 0.0);
      if (st == 2) { h += 0.0012 * lineD(abs(u - W * 0.25), 0.004) + 0.0012 * lineD(abs(u - W * 0.75), 0.004); gSt = max(gSt, lineD(oseam, 0.011) * 0.9); }
      if (st == 3) h += pocket(vec2(oseam, v), vec2(0.0, H * 0.42), vec2(0.07, 0.085)) + 0.0012 * lineD(v - (H * 0.42 - 0.05), 0.02) * step(oseam, 0.07);
      if (uV.z > 0.5) { h += 0.0007 * (1.0 - smoothstep(0.05, 0.054, hemD)); gSt = max(gSt, stitch(hemD - 0.05, u)); }
    }
  } else if (uKind == 3) {
    // ---- a skirt: folds that deepen to the hem
    h += 0.008 * (fold(p, vec2(6.0, 1.0)) - 0.5) * (0.25 + 0.75 * v / H) + 0.002 * (fold(p + 4.0, vec2(14.0, 3.0)) - 0.5);
    h += seam(hemD - 0.016, u, 0.0);
    h += 0.0008 * (1.0 - smoothstep(0.03, 0.034, v)); gDk = max(gDk, lineD(v - 0.034, 0.001));
    if (uStyle == 1) {
      h += pocket(p, vec2(W * 0.5, H * 0.45), vec2(0.11, 0.07));
      float e = min(u, W - u); gSt = max(gSt, stitch(e - 0.01, v)); h += 0.0006 * (1.0 - smoothstep(0.008, 0.012, e));
    }
  } else if (uKind == 4) {
    if (uStyle == 1) { float e = min(v, H - v); gSt = max(gSt, stitch(e - 0.004, u)); float hole = length(vec2((fract(u / 0.028) - 0.5) * 0.028, v - H * 0.5)); gDk = max(gDk, (1.0 - smoothstep(0.002, 0.003, hole)) * step(abs(u - W * 0.5), 0.13)); }
    else if (uStyle == 2) { h += 0.0006 * sin(u * 500.0) * sin(v * 500.0); float e = min(v, H - v); gDk = max(gDk, lineD(e - 0.004, 0.001)); }
    else if (uStyle == 3) { gDk = max(gDk, lineD(v - H * 0.38, 0.0012)); float sn = length(p - vec2(W * 0.5, H * 0.3)); h += 0.0015 * (1.0 - smoothstep(0.006, 0.008, sn)); gSt = max(gSt, 1.0 - smoothstep(0.004, 0.006, sn)); gSt = max(gSt, stitch(min(min(u, W - u), min(v, H - v)) - 0.006, u + v)); }
    else if (uStyle == 4) h += 0.009 * (fold(p, vec2(5.0, 22.0)) - 0.4) + 0.003 * (fold(p + 2.0, vec2(18.0, 9.0)) - 0.5);
    else if (uStyle == 5) { for (int k = 1; k <= 5; k++) gSt = max(gSt, stitch(v - float(k) * H / 6.0, u)); gDk = max(gDk, lineD(v - H + 0.004, 0.0015)); }
    else if (uStyle == 6) { h += 0.0018 * (fold(p, vec2(30.0, 5.0)) - 0.4) * smoothstep(0.1, 0.16, v) * (1.0 - smoothstep(0.2, 0.24, v)); gSt = max(gSt, stitch(abs(u - W * 0.5) - W * 0.34, v)); }
  } else {
    // ---- headwear
    if (uStyle == 1) {
      float pn = abs(fract(u / (W / 6.0)) - 0.5) * (W / 6.0);
      h += seam(pn, v, 1.0);
      gSt = max(gSt, max(stitch(v - 0.012, u), stitch(v - 0.03, u)));
      float back = step(W * 0.27, abs(u - W * 0.5)) * step(0.045, v);
      vec2 m = fract(p / 0.0042) - 0.5; float holeM = 1.0 - smoothstep(0.22, 0.32, length(m));
      gDk = max(gDk, back * 0.25);       // (the mesh back is the weave's job: holes this small only alias in the atlas)
    } else if (uStyle == 3) {
      h += 0.0011 * sin(u * 560.0) * (0.6 + 0.4 * step(0.11, v)); gDk = max(gDk, lineD(v - 0.11, 0.0015));
    } else if (uStyle == 4) {
      float band = step(0.1, v) * step(v, 0.135);
      h += 0.0012 * band; gDk = max(gDk, band * 0.75 + lineD(v - 0.1, 0.001));
      gSt = max(gSt, lineD(v - 0.117, 0.0025) * step(0.4, fract(u * 160.0)));
      gSt = max(gSt, stitch(v - 0.008, u));
      h += 0.0015 * (fold(p, vec2(3.0, 9.0)) - 0.5) * step(0.14, v);
    }
  }
  return h;
}
float enc(float t) { return 0.5 + 0.5 * sign(t) * sqrt(min(abs(t), 3.0) / 3.0); }
void main() {
  vec2 p = vUv * uSize;
  float h = height(p);
  float st = gSt, dk = gDk;
  const float e = 0.0006;
  float su = (height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0))) / (2.0 * e);
  float sv = (height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e);
  const float w = 0.007;
  float lap = h - 0.25 * (height(p + vec2(w, 0.0)) + height(p - vec2(w, 0.0)) + height(p + vec2(0.0, w)) + height(p - vec2(0.0, w)));
  float ao = clamp(1.0 + lap * 420.0, 0.3, 1.0) * (1.0 - 0.25 * dk);
  oC = vec4(enc(su), enc(sv), ao, clamp(0.5 + 0.5 * st - 0.5 * dk * (1.0 - st), 0.0, 1.0));
}
`;
const GARMENT_VERT = 'precision highp float; in vec3 position; in vec2 uv; uniform vec4 uRect; uniform float uGut; out vec2 vUv; void main() { vec2 s = uRect.zw - uRect.xy; vec2 g = vec2(uGut) / s; vUv = (uv - g) / (1.0 - 2.0 * g); gl_Position = vec4(mix(uRect.xy, uRect.zw, uv) * 2.0 - 1.0, 0.0, 1.0); }';
const BODY_STYLE = { placket: 1, crew: 2, pouch: 3, robe: 4, vest: 5, armour: 6, denim: 7, seat: 8, tank: 9, hood: 10 };

// bakeGarments(G, pieces, size) -> { texture, done, progress, step(), finish() }
//   pieces: Map name -> { rect, kind, W, H, ...flags } (garments.js PIECES)
export function bakeGarments(G, pieces, size) {
  const renderer = G && G.renderer;
  if (!renderer || renderer.stub || !renderer.getContext || !pieces || !pieces.size || (G.mats && G.mats.noise && G.mats.noise.placeholder)) {
    return { texture: placeholder(128, 128, 255, 128), done: true, progress: 1, step() { return true; }, finish() {}, ms: 0 };
  }
  const rt = new WebGLRenderTarget(size, size, { depthBuffer: false, type: UnsignedByteType, format: RGBAFormat });
  setupOut(rt.texture, Math.min(4, renderer.capabilities.getMaxAnisotropy()));
  const mat = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: GARMENT_VERT, fragmentShader: ROLLED(GARMENT_FRAG), depthTest: false, depthWrite: false, blending: NoBlending, side: DoubleSide,
    uniforms: {
      ...ROLL_UNIFORMS(), tNzA: { value: G.mats.noise.tNzA }, uRect: { value: [0, 0, 1, 1] }, uGut: { value: 5 / 1024 }, uSize: { value: [1, 1] }, uKind: { value: 0 }, uStyle: { value: 0 }, uV: { value: [0, 0, 0, 0] }, uSeed: { value: 0 } },
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const quad = new Mesh(geo, mat); quad.frustumCulled = false;
  const scene = new Scene(); scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const list = [...pieces.values()];
  const KIND = { body: 0, sleeve: 1, leg: 2, skirt: 3, flat: 4, hat: 5 };
  let at = 0;
  const t0 = performance.now();
  const job = {
    texture: rt.texture, done: false, progress: 0, ms: 0, target: rt,
    perStep: 12, // pieces drawn per step (fewer on a slow GPU; the result is the same)
    prepare() { return compileFirst(renderer, [[scene, rt]], cam); },
    step() {
      if (job.done) return true;
      withRenderer(renderer, () => {
        renderer.setRenderTarget(rt);
        if (at === 0) { renderer.setClearColor(0x8080ff, 0.5); renderer.clear(true, false, false); }
        const u = mat.uniforms;
        const per = Math.max(1, Math.min(12, Math.floor(job.perStep) || 12));
        for (let n = 0; n < per && at < list.length; n++, at++) {
          const p = list[at];
          u.uRect.value = p.rect; u.uSize.value = [p.W, p.H]; u.uKind.value = KIND[p.kind] ?? 4; u.uSeed.value = 1.37 + at * 0.61;
          let style = 0;
          if (p.kind === 'body') { for (const k of Object.keys(BODY_STYLE)) if (p[k]) style = BODY_STYLE[k]; if (p.seat && !p.denim) style = 8; if (p.seat && p.denim) style = 7; }
          else if (p.kind === 'skirt') style = p.apron ? 1 : 0;
          else if (p.kind === 'flat') style = p.belt || (p.hat === 2 ? 5 : p.boot === 2 ? 6 : 0);
          else if (p.kind === 'hat') style = p.hat || 0;
          u.uStyle.value = style;
          u.uV.value = p.kind === 'body' ? [0, p.gapU || 0, 0, 0] : [p.joint ?? -1, p.stack ? 1 : 0, p.cuff ? 1 : 0, p.boot ? 4 : p.denim ? 1 : p.crease ? 2 : p.cargo ? 3 : 0];
          renderer.render(scene, cam);
        }
      });
      job.progress = at / list.length;
      if (at >= list.length) { job.done = true; mat.dispose(); geo.dispose(); job.ms = performance.now() - t0; }
      return job.done;
    },
    finish() { while (!job.step()); },
  };
  return job;
}
