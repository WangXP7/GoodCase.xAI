// G.fx: one instanced GPU particle system plus projected decals (decals.js).
//
// Particles are stateless on the CPU: a spawn writes one 24-float record into a ring buffer and the
// vertex shader works out where the particle is from its age (drag + gravity in closed form, or
// ballistic bounces off a floor height for chips, shards and casings). Nothing is simulated or
// sorted per frame. Everything is one draw call in the post chain's 'fx' slot, after the decals,
// depth-tested and depth-softened against the scene depth texture, lit by fxlights.js.
//
// Geometry modes: camera billboard, velocity-stretched, surface-aligned, plus a tumbling plate
// (glass) and a cylinder impostor (casings). Blending is premultiplied alpha throughout: fire is an
// emissive body with alpha (it covers what is behind it); only sparks are purely additive.
import {
  Vector4,
  InstancedBufferGeometry, BufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, RawShaderMaterial, GLSL3,
  Mesh, Scene, NormalBlending, DoubleSide, Vector3,
} from 'three';
import { stubs } from '../core/stubs.js';
import { createFxLights, readVec, FX_LIGHT_GLSL } from './fxlights.js';
import { createAtlases, P_CELL } from './atlas.js';
import { isSoftwareRenderer, rendererName } from '../render/software.js';
import { createDecals, goreOf, spatterSize } from './decals.js';
import { installFxTest } from './fxtest.js';
import { createRingUploader } from './ring.js';
import { casingLaunch } from './casing.js';
import { createCombat } from './combat.js';
import { MELEE } from '../weapon/rig.js';
import { upgradeLook } from '../weapon/models/upgrade.js';

export const MAX_PARTICLES = 4096;
const CASING_SLOTS = 128; // casings live far longer than anything else: their own ring at the end of the pool
// Smoke that hangs (a blast's, a fire's, the gas cloud) has its own ring too, so that sustained fire,
// which fills the main ring several times a second, cannot evict it mid-life.
export const slowSlots = (cap) => (cap >= 4096 ? 512 : Math.max(96, Math.round(cap / 6)));
const SLOW_LIFE = 1.7;

// ---- what a bullet hit leaves (pure; tests/fx.test.js) ----------------------------------------------
// e: { part, killed }. gore: G.fx.gore. r0..r3: randoms in [0, 1). out: { amount, ground, wall } with
// ground / wall the size in metres of the spatter to lay (0 = none). A hit never lays a pool: pools
// belong to a death (deathPool) and to corpses.
export function hitBlood(e, gore, r0, r1, r2, r3, out = { amount: 0, ground: 0, wall: 0 }) {
  const g = goreOf(gore);
  const head = e && e.part === 'head';
  out.amount = e && e.killed ? 1.4 : (head ? 1.1 : (!e || e.part === 'torso' || !e.part ? 0.75 : 0.55));
  out.ground = 0; out.wall = 0;
  if (g <= 0) { out.amount = 0; return out; }
  if (r0 < 0.8 * g) out.ground = spatterSize(out.amount, r1);
  if (r2 < 0.65 * g) out.wall = spatterSize(out.amount + 0.2, r3);
  return out;
}
// Metres across the pool under a body, or 0: full gore only, and only while nobody else owns corpse
// pools (blood.js sets G.fx.bloodOwner, or G.fx.corpsePools = false).
export function deathPool(gore, owner, enabled, r) {
  if (owner || !enabled || goreOf(gore) < 1) return 0;
  return 0.5 + 0.3 * r;
}
const STRIDE = 24;

// particle kinds (a4.x)
export const KIND = {
  smoke: 0, //   lit flipbook billboard
  fire: 1, //    emissive billboard (flipbook or single cell)
  spark: 2, //   velocity-stretched, additive, cools over life
  chip: 3, //    solid lit debris, bounces
  drop: 4, //    velocity-stretched glossy liquid, dies on the floor
  shard: 5, //   tumbling glass plate, bounces
  casing: 6, //  brass cylinder impostor, bounces and settles
  flat: 7, //    surface-aligned emissive (vel = surface normal)
  dust: 8, //    surface-aligned lit dust (vel = surface normal)
  splash: 9, //  glossy liquid flipbook billboard
  jet: 10, //    emissive, stretched forward from its origin (flame tongue)
  haze: 11, //   lit smoke stretched along its velocity (a5.w = stretch seconds), relaxes to a wisp
  mote: 12, //   featureless soft blob eroded by animated noise; clouds are built from dozens of these
  tracer: 13, // additive streak a5.w metres long whose head flies from a0 along a1 (no drag, no gravity)
  bolt: 14, //   additive still segment from a0 to a0 + a1 (an arc's ribbon), fades over its life
  glint: 15, //  additive round glow in its own colour (not the fire ramp)
};
// How many of a burst's particles a tier draws: all of them at the desktop cap, about 60 % on mobile.
export const burstScale = (cap) => Math.min(1, Math.max(0.5, Math.sqrt((cap > 0 ? cap : MAX_PARTICLES) / MAX_PARTICLES)));

const VERT = /* glsl */ `precision highp float;
in vec2 corner;
in vec4 a0; // xyz spawn position, w spawn time
in vec4 a1; // xyz velocity (or surface normal for aligned kinds), w life
in vec4 a2; // size at birth, size at death, rotation, spin (rad/s)
in vec4 a3; // rgb colour, a opacity
in vec4 a4; // kind, drag (1/s), gravity (g units, negative rises), floor height
in vec4 a5; // emissive strength, seed, atlas cell, frames (billboards) or stretch seconds (stretched)
            // motes: desaturation, seed, cloud normal z, light wrap (0..4) + 8 * streak milliseconds
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
uniform vec4 uFlashAt; // xyz: how far the muzzle has moved since the last shot's flash was born; w: that flash's birth time
out vec2 vUv;
out vec3 vWorld;
out vec3 vT; out vec3 vB; out vec3 vN;
out float vViewZ;
flat out vec4 vColor;
flat out vec4 vMisc;  // kind, age fraction, emissive, seed
flat out vec4 vFrame; // cell A, cell B, blend, soft distance
flat out vec4 vAux;   // casing: sin(axis, view), half length, radius, 0

vec3 rotAxis(vec3 v, vec3 ax, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
}
// Ballistic flight with up to four bounces off a floor, then rest. h is height above the floor,
// moveT the effective time of horizontal travel (each bounce loses speed).
void bounce(float h0, float vy, float g, float t, float e, out float h, out float moveT, out float rest, out float restAge) {
  moveT = 0.0; rest = 0.0; restAge = 0.0; h = h0;
  float f = 1.0;
  for (int i = 0; i < 4; i++) {
    float th = (vy + sqrt(max(vy * vy + 2.0 * g * h, 0.0))) / g;
    if (t < th) { h = max(h + vy * t - 0.5 * g * t * t, 0.0); moveT += f * t; return; }
    t -= th; moveT += f * th;
    vy = (g * th - vy) * e; h = 0.0; f *= 0.5;
  }
  rest = 1.0; restAge = t; h = 0.0;
}
void main() {
  float age = uTime - a0.w;
  float life = a1.w;
  float u = age / max(life, 1e-4);
  if (age < 0.0 || u >= 1.0 || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int kind = int(a4.x + 0.5);
  float drag = a4.y; float grav = a4.z * 9.81; float floorY = a4.w;
  float seed = a5.y;
  vec3 p = a0.xyz; vec3 v = a1.xyz;
  if ((kind == 1 || kind == 10) && a0.w == uFlashAt.w) p += uFlashAt.xyz; // the flash stays on the muzzle as the gun recoils
  float sz = mix(a2.x, a2.y, 1.0 - (1.0 - u) * (1.0 - u));
  float spinT = age; float rest = 0.0; float restAge = 0.0; float alphaMul = 1.0;
  bool aligned = kind == 7 || kind == 8;
  bool bouncy = kind == 3 || kind == 5 || kind == 6;
  bool beam = kind == 13 || kind == 14;

  if (bouncy) {
    float rad = kind == 3 ? sz * 0.35 : (kind == 6 ? 0.0048 * sz : 0.004);
    float h, moveT;
    bounce(max(p.y - floorY - rad, 0.0), v.y, max(grav, 0.5), age, kind == 6 ? 0.42 : 0.3, h, moveT, rest, restAge);
    p.xz += v.xz * moveT;
    p.y = floorY + rad + h;
    spinT = moveT;
  } else if (beam) {
    vec3 ax; float L;
    if (kind == 13) { float sp = length(v); ax = v / max(sp, 1e-4); float gone = sp * age; L = min(a5.w, gone); p += ax * (gone - L * 0.5); }
    else { L = length(v); ax = v / max(L, 1e-5); p += v * 0.5; }
    v = ax * L; // axis and length for the quad below
  } else if (!aligned) {
    float k = max(drag, 0.02);
    float ek = exp(-k * age);
    vec3 gk = vec3(0.0, -grav, 0.0) / k;
    p += (v - gk) * (1.0 - ek) / k + gk * age;
    v = v * ek + gk * (1.0 - ek);
    if (p.y < floorY) {
      if (kind == 2) { p.y = floorY + (floorY - p.y) * 0.3; v.y = abs(v.y) * 0.3; }
      else if (kind == 4) alphaMul = 0.0;
      else p.y = floorY;
    }
  }

  vec3 toCam = normalize(cameraPosition - p);
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ang = kind == 12 ? 0.0 : a2.z + a2.w * spinT;
  vec3 T; vec3 B; vec3 N; vec2 hs = vec2(sz * 0.5);
  vAux = vec4(0.0);
  float cellA = a5.z; float cellB = a5.z; float blend = 0.0;

  if (beam) { // a ribbon along its axis, turned to face the eye, never thinner than a pixel and a bit
    float L = length(v);
    T = v / max(L, 1e-5);
    B = normalize(cross(T, toCam) + 1e-5); N = normalize(cross(T, B));
    float w = max(sz, length(cameraPosition - p) * 0.0013);
    alphaMul = sz / w;
    hs = vec2(L * 0.5 + (kind == 14 ? w * 0.5 : 0.0), w * 0.5);
  } else if (kind == 2 || kind == 4 || kind == 10 || kind == 11) { // velocity-stretched
    float sp = length(v);
    vec3 ax = sp > 1e-4 ? v / sp : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(ax, toCam) + 1e-5);
    float hl = sz * 0.5 + min(0.5 * a5.w * sp, 0.6);
    T = ax; B = side; N = normalize(cross(T, B));
    hs = vec2(hl, sz * 0.5);
    if (kind == 10) p += ax * hl; else if (kind != 11) p -= ax * (hl - sz * 0.5);
  } else if (kind == 6) { // casing: a cylinder seen as a quad along its projected axis
    vec3 ax0 = normalize(vec3(sin(seed * 40.0), 0.35, cos(seed * 40.0)));
    vec3 tum = normalize(vec3(cos(seed * 91.0), 0.6 * sin(seed * 17.0), sin(seed * 91.0)));
    vec3 ax = rotAxis(ax0, tum, ang);
    vec3 lying = normalize(vec3(ax.x, 0.0, ax.z) + vec3(1e-4, 0.0, 0.0));
    ax = normalize(mix(ax, lying, rest * smoothstep(0.0, 0.06, restAge)));
    float sinT = length(cross(ax, toCam));
    vec3 side = normalize(cross(ax, toCam) + 1e-5);
    T = normalize(cross(toCam, side)); B = side; N = ax;
    float L = 0.019 * sz; float R = 0.0048 * sz;
    hs = vec2(L * 0.5 * sinT + R * sqrt(max(1.0 - sinT * sinT, 0.0)) + 0.0005, R);
    vAux = vec4(sinT, L * 0.5, R, dot(ax, toCam));
    blend = life - age; // seconds left
  } else if (kind == 5) { // tumbling plate, comes to rest flat
    vec3 tum = normalize(vec3(cos(seed * 91.0), sin(seed * 53.0) * 0.7, sin(seed * 91.0)));
    vec3 b0 = normalize(cross(tum, vec3(0.31, 0.9, 0.22)));
    T = tum; B = rotAxis(b0, tum, ang);
    float settle = rest * smoothstep(0.0, 0.05, restAge);
    vec3 tf = normalize(vec3(T.x, 0.0, T.z) + vec3(1e-4, 0.0, 0.0));
    T = normalize(mix(T, tf, settle));
    B = normalize(mix(B, cross(vec3(0.0, 1.0, 0.0), T), settle));
    N = normalize(cross(T, B));
  } else if (aligned) {
    N = normalize(a1.xyz);
    vec3 t0 = normalize(cross(abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), N));
    T = rotAxis(t0, N, ang); B = cross(N, T);
    p += N * 0.012;
  } else { // camera billboard
    float c = cos(ang), s = sin(ang);
    T = camR * c + camU * s; B = camU * c - camR * s; N = cross(camR, camU);
    if (kind == 12 && a5.w >= 8.0) { // streaked mote: drawn out behind it along its motion across the view
      vec3 vs = v - toCam * dot(v, toCam);
      float sp = length(vs);
      float sl = min(sp * floor(a5.w / 8.0) * 0.001, length(p - a0.xyz)); // never longer than the way it has come
      if (sl > 1e-4) {
        T = vs / sp; B = normalize(cross(N, T));
        hs.x += 0.5 * sl; p -= T * (0.5 * sl);
        alphaMul *= sqrt(sz / (sz + sl)); // thinner where it is spread along the streak
      }
    }
  }
  if (kind == 12) { // mote: two frames of the noise flipbook, and the cloud-space normal
    float fp = clamp(u * 9.0 + fract(seed * 5.3) * 6.0, 0.0, 14.99);
    cellA = floor(fp); cellB = cellA + 1.0; blend = fract(fp);
    vAux = vec4(a2.z, a2.w, a5.z, mod(a5.w, 8.0)); // w: light wrap (0 hard terminator, 1 half lit, 3 lit all round)
  } else if (kind == 0 || kind == 1 || kind == 9 || kind == 11 || aligned) { // flipbook
    float frames = kind == 11 ? 10.0 : max(a5.w, 1.0);
    float fp = u * (frames - 1.0);
    cellA = a5.z + floor(fp); cellB = min(cellA + 1.0, a5.z + frames - 1.0); blend = fract(fp);
  }

  vec3 wp = p + T * (corner.x * hs.x) + B * (corner.y * hs.y);
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * vp;
  vUv = corner * 0.5 + 0.5;
  vWorld = wp; vT = T; vB = B; vN = N;
  vViewZ = -vp.z;
  vColor = vec4(a3.rgb, a3.a * alphaMul);
  vMisc = vec4(a4.x, u, a5.x, seed);
  // (soft distance: a surface-aligned quad lies 12 mm off its surface and must not be faded out by it)
  vFrame = vec4(cellA, cellB, blend, aligned ? 0.004 : max(sz * 0.5, 0.02));
}`;

const frag = (post) => /* glsl */ `precision highp float;
precision highp sampler2D;
${post.glsl.depth}
${FX_LIGHT_GLSL}
uniform sampler2D uAtlas;
uniform vec2 texel;
uniform vec3 cameraPosition;
in vec2 vUv;
in vec3 vWorld;
in vec3 vT; in vec3 vB; in vec3 vN;
in float vViewZ;
flat in vec4 vColor;
flat in vec4 vMisc;
flat in vec4 vFrame;
flat in vec4 vAux;
out vec4 outColor;

float gLod; float gMrg;
// Mip level is capped so a cell never blurs into its neighbours (tiny chips keep their coverage).
vec4 cellTex(float cell, vec2 uv) {
  return textureLod(uAtlas, (vec2(mod(cell, 8.0), floor(cell / 8.0)) + clamp(uv, gMrg, 1.0 - gMrg)) / 8.0, gLod);
}
vec4 flip(vec2 uv) { return mix(cellTex(vFrame.x, uv), cellTex(vFrame.y, uv), vFrame.z); }
vec3 fireRamp(float h) {
  vec3 c = mix(vec3(1.0, 0.14, 0.015), vec3(1.0, 0.5, 0.13), smoothstep(0.0, 0.5, h));
  c = mix(c, vec3(1.0, 0.86, 0.62), smoothstep(0.45, 1.0, h));
  return c * (0.12 + h * h * 1.25);
}
void main() {
  vec2 suv = gl_FragCoord.xy * texel;
  float gap = linearDepth(suv) - vViewZ;
  vec2 tdx = dFdx(vUv) * 256.0; vec2 tdy = dFdy(vUv) * 256.0;
  gLod = clamp(0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))), 0.0, 3.5);
  gMrg = exp2(gLod) / 256.0;
  int kind = int(vMisc.x + 0.5);
  float u = vMisc.y; float emis = vMisc.z;
  // motes: emissive slot = light desaturation (0..1), + 2 for fine grain
  float fine = kind == 12 ? step(1.5, emis) : 0.0;
  vec2 tuv = vUv;
  if (fine > 0.5) { // the whole noise cell across the mote, turned a different way for each
    if (fract(vMisc.w * 3.1) > 0.5) tuv.x = 1.0 - tuv.x;
    if (fract(vMisc.w * 7.7) > 0.5) tuv.y = 1.0 - tuv.y;
    if (fract(vMisc.w * 11.3) > 0.5) tuv = tuv.yx;
    tuv = 0.04 + tuv * 0.92;
  } else if (kind == 12) tuv = 0.1 + vUv * 0.4 + 0.4 * fract(vMisc.w * vec2(7.3, 13.7));
  vec4 t = flip(tuv);
  if (gap <= 0.0) discard;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float soft = clamp(gap / vFrame.w, 0.0, 1.0);
  vec3 col = vec3(0.0); float alpha = 0.0;
  vec3 diff, spec, back;
  float endFade = smoothstep(1.0, 0.88, u);

  if (kind == 0 || kind == 8 || kind == 11) { // lit smoke / dust
    float dens = t.a;
    vec2 n2 = t.rg * 2.0 - 1.0;
    vec3 N = kind == 8 ? vN : normalize(vT * n2.x + vB * n2.y + vN * (0.6 + sqrt(max(1.0 - dot(n2, n2), 0.06))));
    // Erosion: a noise threshold that rises with age opens holes through the whole puff from the
    // first frame, so it thins into wisps instead of fading a fixed silhouette.
    float th = mix(0.1, 1.0, u);
    float er = kind == 8 ? 1.0 : smoothstep(th - 0.45, th + 0.4, t.b * 0.65 + dens * 0.35);
    alpha = dens * er * smoothstep(0.0, 0.04, u) * (1.0 - u) * vColor.a;
    alpha = min(alpha * soft * smoothstep(0.06, 0.3, vViewZ), 1.0);
    fxLight(vWorld, N, V, 0.75, 1.0, diff, spec, back);
    // self-shadowing: the dense core of a puff is darker than its lit rim
    col = vColor.rgb * (diff * mix(1.0, 0.62, dens) + back * (1.0 - dens) * 0.7);
    // a close flash must not blow thin smoke out to white
    col *= min(1.0, (kind == 11 ? 1.1 : 3.0) / max(max(col.r, col.g), max(col.b, 1e-3)));
  } else if (kind == 12) { // mote: no outline of its own, the cloud's shape comes from accumulation
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    float blob = max(exp(-r2 * 3.0) - 0.0498, 0.0) / 0.95;
    float th = mix(-0.15, 0.9, u);
    float ew = 0.3 + 0.2 * fine; // fine grain is also softer: it thins evenly, with no lumps to read as billows
    float er = smoothstep(th - ew, th + ew, t.b); // animated noise eats it away as it ages
    alpha = min(blob * er * (1.0 - u) * vColor.a * soft * smoothstep(0.06, 0.3, vViewZ), 1.0);
    // which side of the cloud this mote is on decides how much light it gets
    vec3 N = normalize(vAux.xyz + (vT * q.x + vB * q.y) * 0.5 + vN * 0.3);
    fxLight(vWorld, N, V, vAux.w, 1.0, diff, spec, back);
    // rim back-scatter only for clouds with a dark side; one lit right through (wrap > 1) has no rim,
    // and a rim in another light's colour reads as a fringe
    vec3 lit = diff + back * 0.35 * (1.0 - blob) * vAux.w * step(vAux.w, 1.5);
    lit = mix(lit, vec3(dot(lit, vec3(0.2126, 0.7152, 0.0722))), emis - 2.0 * fine);
    col = vColor.rgb * lit;
    col *= min(1.0, 1.5 / max(max(col.r, col.g), max(col.b, 1e-3)));
  } else if (kind == 1 || kind == 7 || kind == 10) { // fire
    float heat = t.r * (1.0 - u * 0.65);
    float er = u * 0.8;
    alpha = t.a * smoothstep(er - 0.05, er + 0.45, t.r + 0.06) * (1.0 - u * u) * vColor.a * soft;
    col = fireRamp(heat) * vColor.rgb * emis;
  } else if (kind == 2) { // spark: additive, white-hot to red
    float heat = (1.0 - u);
    vec3 c = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.78, 0.42), heat * heat);
    outColor = vec4(c * vColor.rgb * emis * t.a * pow(heat, 0.6), 0.0);
    return;
  } else if (kind == 13 || kind == 14) { // tracer, arc ribbon: a white-hot line inside a coloured sheath
    float y = vUv.y * 2.0 - 1.0;
    float along = kind == 13 ? pow(vUv.x, 1.6) * smoothstep(1.0, 0.97, vUv.x) : smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * (1.0 - u * u);
    vec3 c = vColor.rgb * exp(-y * y * 5.0) + vec3(1.0) * exp(-y * y * 60.0) * 0.3;
    outColor = vec4(c * emis * along * vColor.a * step(0.0, gap), 0.0);
    return;
  } else if (kind == 15) { // glint
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    float g = max(exp(-r2 * 5.0) - 0.0067, 0.0) + exp(-r2 * 40.0) * 1.5;
    outColor = vec4(vColor.rgb * emis * g * (1.0 - u * u) * vColor.a * soft, 0.0);
    return;
  } else if (kind == 3) { // chip
    if (t.a < 0.5) discard;
    vec2 n2 = t.rg * 2.0 - 1.0;
    vec3 N = normalize(vT * n2.x + vB * n2.y + vN * sqrt(max(1.0 - dot(n2, n2), 0.1)));
    fxLight(vWorld, N, V, 0.2, mix(0.8, 0.22, emis), diff, spec, back); // emissive slot = wetness for chips
    col = vColor.rgb * (0.65 + 0.7 * t.b) * diff + spec * 0.04;
    alpha = vColor.a * endFade;
  } else if (kind == 4 || kind == 9) { // liquid
    float cov = smoothstep(0.35, 0.55, t.a);
    if (cov <= 0.0) discard;
    vec2 n2 = t.rg * 2.0 - 1.0;
    vec3 N = normalize(vT * n2.x + vB * n2.y + vN * sqrt(max(1.0 - dot(n2, n2), 0.05)));
    fxLight(vWorld, N, V, kind == 9 ? 0.35 : 0.9, kind == 9 ? 0.4 : 0.3, diff, spec, back);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = vColor.rgb * (diff + back * 0.5) + (spec * (kind == 9 ? 0.35 : 4.0) + uAmbient * 0.3) * max(fres, kind == 9 ? 0.0 : 0.12);
    alpha = cov * vColor.a * (kind == 9 ? mix(0.55, 1.0, t.b) * pow(1.0 - u, 0.6) : endFade);
  } else if (kind == 5) { // glass shard
    if (t.a < 0.5) discard;
    vec3 N = normalize(vN + (vT * (t.g - 0.5) + vB * (t.r - 0.3)) * 0.25);
    if (dot(N, V) < 0.0) N = -N;
    fxLight(vWorld, N, V, 0.0, 0.1, diff, spec, back);
    float fres = 0.06 + 0.94 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = vColor.rgb * (spec * (0.3 + fres) + uAmbient * fres + diff * mix(0.1, 0.5, t.r) + back * 0.3);
    alpha = (mix(0.28, 0.7, t.r) + fres * 0.3) * vColor.a * endFade;
    col /= max(alpha, 1e-3); // glints are not dimmed by the thin body
  } else { // 6: casing
    float s = vUv.y * 2.0 - 1.0;
    float hx = (vUv.x * 2.0 - 1.0) * (vAux.y * vAux.x + vAux.z * sqrt(max(1.0 - vAux.x * vAux.x, 0.0)) + 0.0005);
    float body = vAux.y * vAux.x;
    float capR = max(vAux.z * sqrt(max(1.0 - vAux.x * vAux.x, 0.0)), 0.0006);
    float ex = max(abs(hx) - body, 0.0) / capR;
    if (ex * ex + s * s > 1.0) discard;
    vec3 axis = vN;
    vec3 face = normalize(V - axis * dot(V, axis) + 1e-5);
    vec3 N = normalize(vB * s + face * sqrt(max(1.0 - s * s, 0.0)));
    // seen end-on the cap faces the camera
    N = normalize(mix(N, axis * sign(vAux.w), smoothstep(0.0, 1.0, ex) * 0.8));
    fxLight(vWorld, N, V, 0.1, 0.32, diff, spec, back);
    float l = hx / max(body, 1e-4) * sign(dot(vT, axis) + 1e-5); // -1 base .. +1 mouth
    float groove = smoothstep(0.05, 0.0, abs(l + 0.8)) * 0.6;
    float mouth = smoothstep(0.86, 0.97, l);
    vec3 F0 = vColor.rgb;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = F0 * (diff * 0.22 + spec * 0.7) + uAmbient * mix(F0, vec3(1.0), fres) * (0.6 + 0.8 * max(N.y, 0.0));
    col *= (1.0 - groove) * (1.0 - mouth * 0.85);
    alpha = vColor.a * clamp(vFrame.z / 0.5, 0.0, 1.0);
  }
  outColor = vec4(fxFog(col * alpha, alpha, dist), alpha);
}`;

// ---- surface looks -----------------------------------------------------------------------------
const SURF = {
  asphalt: { dust: [0.17, 0.16, 0.15], dustA: 0.5, chip: [0.055, 0.055, 0.06], chips: 12, grit: 8, puffs: 52, sparks: 2, spray: 7 },
  concrete: { dust: [0.5, 0.48, 0.44], dustA: 0.55, chip: [0.36, 0.35, 0.32], chips: 12, grit: 12, puffs: 60, sparks: 1, spray: 0 },
  dirt: { dust: [0.2, 0.15, 0.1], dustA: 0.5, chip: [0.1, 0.075, 0.045], chips: 9, grit: 10, puffs: 56, sparks: 0, spray: 4 },
  cloth: { dust: [0.3, 0.3, 0.28], dustA: 0.35, chip: [0.2, 0.2, 0.19], chips: 3, grit: 2, puffs: 20, sparks: 0, spray: 0 },
};
const BRASS = [0.95, 0.66, 0.3];
// what leaves the port, by weapon, where it is not a pistol's brass: [r, g, b, size]. The Brandt 12
// throws a green plastic hull twice the size; the rifles longer brass.
const CASE_LOOK = { autoShotgun: [0.07, 0.3, 0.14, 2.1], rifle: [0.95, 0.66, 0.3, 1.5], battleRifle: [0.95, 0.66, 0.3, 1.9], lmg: [0.95, 0.66, 0.3, 1.9] };
const BLOOD = [0.085, 0.0016, 0.0012]; // saturated: deep red under a lamp, black without one
const MIST = [0.03, 0.0012, 0.0009]; // the spray out of the far side: a dark red aerosol
const PUFF = [0.09, 0.0035, 0.0025]; // the puff back out of the wound, toward whoever fired: redder, thinner

export function createFx(G) {
  const post = G.post;
  if (!post || post.stub || typeof post.addPass !== 'function') return stubs.fx();

  // Seeded stream; a staged shot re-forks it so the same effect is drawn every time.
  let stream = G.rng.fork('fx');
  const rng = { next: () => stream.next(), int: (a, b) => stream.int(a, b), range: (a, b) => stream.range(a, b) };
  const lights = createFxLights(G);
  // drawn over the next frames (atlas.js); the boot waits for fx.ready before the first frame. Half
  // size on the low and mobile tiers and on a software renderer, at once in staged shots and stepped runs.
  const tier = G.quality && G.quality.tier;
  const soft = isSoftwareRenderer(rendererName(post.renderer.getContext && post.renderer.getContext()));
  const atlases = createAtlases(post, {
    scale: tier === 'low' || tier === 'mobile' || soft ? 0.5 : 1,
    now: !!(G.params && (G.params.shot || G.params.step)),
  });
  if (typeof window !== 'undefined') { window.__fxBake = atlases.stats; window.__fxAtlases = atlases; } // load cost and targets, for the harness
  // The fx clock: particle and decal ages are measured on it. A staged shot pins it.
  const clock = { now: 100, frozen: false };
  const decals = createDecals(G, post, atlases.decals.texture, lights, clock, rng);

  // ---- particle buffers --------------------------------------------------------------------
  const data = new Float32Array(MAX_PARTICLES * STRIDE);
  const buffer = new InstancedInterleavedBuffer(data, STRIDE, 1);
  const flashAt = { value: new Vector4(0, 0, 0, -1) };
  const geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  for (let i = 0; i < 6; i++) geo.setAttribute(`a${i}`, new InterleavedBufferAttribute(buffer, 4, i * 4));
  geo.instanceCount = MAX_PARTICLES;
  const material = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: VERT, fragmentShader: frag(post),
    uniforms: { ...post.shared, ...lights.uniforms, uAtlas: { value: atlases.particles.texture }, uFlashAt: flashAt },
    side: DoubleSide, depthTest: false, depthWrite: false, transparent: true, blending: NormalBlending, premultipliedAlpha: true,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'fx-particles';
  const fxScene = new Scene();
  fxScene.add(decals.bloodMesh, decals.mesh, mesh);
  fxScene.matrixWorldAutoUpdate = false;

  // The main ring is the tier's particle cap less the casings' ring (G.quality.particles: 4096 on
  // desktop tiers, 1536 on mobile). A tier change rebuilds the bookkeeping, not the buffer.
  const CASING_AT = MAX_PARTICLES - CASING_SLOTS;
  let mainSlots = 0; let slowN = 0; let lastCap = 0; let uploader = null; let dens = 1;
  function fitTier() {
    const cap = Math.min(MAX_PARTICLES, Math.max(256, Math.floor((G.quality && G.quality.particles) || MAX_PARTICLES)));
    if (cap === lastCap) return;
    lastCap = cap;
    slowN = slowSlots(cap);
    mainSlots = cap - CASING_SLOTS - slowN;
    dens = burstScale(cap);
    // hanging smoke sits first in the buffer: instances are drawn in slot order, unsorted, and fire and
    // sparks must be drawn over the smoke that has been standing there, never under it
    uploader = createRingUploader(buffer, STRIDE, [[slowN, mainSlots], [CASING_AT, CASING_SLOTS], [0, slowN]]);
    for (let k = (mainSlots + slowN) * STRIDE; k < CASING_AT * STRIDE; k += STRIDE) data[k + 7] = 0; // beyond the cap: dead
    buffer.updateRanges.length = 0; buffer.needsUpdate = true; // the whole buffer once
    cursor = 0; slowCursor = 0; // (slots moved: what was alive is dropped with the old layout)
    for (let k = 0; k < (mainSlots + slowN) * STRIDE; k += STRIDE) data[k + 7] = 0;
  }
  let cursor = 0; let slowCursor = 0;
  let casingCursor = 0;
  let activeUntil = 0;

  let combat = null; // set once the fx object exists (see the end of this function)
  // Seconds from now until the next spawned particle is born (lets one call emit over time).
  let delay = 0;
  // ... and a lead added to every spawn while it is set: a whole effect staged ahead of its moment
  // (a blade's blood is called for on the press and seen when the blade arrives)
  let lead = 0;
  // One particle. Positional on purpose: called in bursts, must not allocate.
  function spawn(kind, px, py, pz, vx, vy, vz, life, s0, s1, rot, spin, r, g, b, a, drag, grav, floorY, emis, cell, aux) {
    let i;
    if (kind === KIND.casing) { i = CASING_AT + casingCursor; casingCursor = (casingCursor + 1) % CASING_SLOTS; uploader.mark(i, 1); }
    else if (life >= SLOW_LIFE && (kind === KIND.mote || kind === KIND.smoke)) { i = slowCursor; slowCursor = (slowCursor + 1) % slowN; uploader.mark(i, 2); }
    else { i = slowN + cursor; cursor = (cursor + 1) % mainSlots; uploader.mark(i, 0); }
    const k = i * STRIDE;
    data[k] = px; data[k + 1] = py; data[k + 2] = pz; data[k + 3] = clock.now + delay + lead;
    data[k + 4] = vx; data[k + 5] = vy; data[k + 6] = vz; data[k + 7] = life;
    data[k + 8] = s0; data[k + 9] = s1; data[k + 10] = rot; data[k + 11] = spin;
    data[k + 12] = r; data[k + 13] = g; data[k + 14] = b; data[k + 15] = a;
    data[k + 16] = kind; data[k + 17] = drag; data[k + 18] = grav; data[k + 19] = floorY;
    data[k + 20] = emis; data[k + 21] = rng.next(); data[k + 22] = cell; data[k + 23] = aux;
    if (clock.now + delay + lead + life > activeUntil) activeUntil = clock.now + delay + lead + life;
  }

  fitTier();

  // ---- scratch ------------------------------------------------------------------------------
  const P = new Vector3(); const D = new Vector3(); const T1 = new Vector3(); const T2 = new Vector3(); const W = new Vector3();
  const P2 = new Vector3(); const D2 = new Vector3();
  const rayO = [0, 0, 0]; const rayD = [0, -1, 0];
  const TAU = Math.PI * 2;
  const rr = (a, b) => a + (b - a) * rng.next();

  function basis(n) { // T1, T2 perpendicular to n
    if (Math.abs(n.y) < 0.9) T1.set(0, 1, 0); else T1.set(1, 0, 0);
    T1.cross(n).normalize();
    T2.crossVectors(n, T1);
  }
  // W = random direction within halfAngle (radians) of n. basis(n) must have been called.
  function cone(n, halfAngle) {
    const c = 1 - rng.next() * (1 - Math.cos(halfAngle));
    const s = Math.sqrt(Math.max(1 - c * c, 0));
    const ph = rng.next() * TAU;
    return W.copy(n).multiplyScalar(c).addScaledVector(T1, s * Math.cos(ph)).addScaledVector(T2, s * Math.sin(ph));
  }
  function levelRay(o, d, max) {
    const lv = G.level;
    if (!lv || typeof lv.raycast !== 'function') return null;
    rayO[0] = o.x; rayO[1] = o.y; rayO[2] = o.z; rayD[0] = d.x; rayD[1] = d.y; rayD[2] = d.z;
    return lv.raycast(rayO, rayD, max);
  }
  const DOWN = new Vector3(0, -1, 0);
  const HIT = new Vector3(); const FB = new Vector3();
  // Height of the floor under a point: what bouncing debris lands on.
  function floorBelow(p) {
    FB.set(p.x, p.y + 0.05, p.z);
    const hit = levelRay(FB, DOWN, 8);
    if (hit && hit.pos) return readVec(hit.pos, HIT).y;
    return G.level && !G.level.stub ? p.y - 4 : 0;
  }

  // ---- effects ------------------------------------------------------------------------------
  // A volume of smoke, dust or mist: `count` motes let out of `o` over `window` seconds within
  // `angle` of n (basis(n) must have been called). Speeds are biased low and drag is strong, so the
  // cloud is densest at its source, has no gap, and its far end slows and thins first.
  const CN = new Vector3();
  // `wrap`: how far light reaches round the cloud (0.15 a dense body with a dark side .. 3 a thin
  // aerosol lit right through). `streak`: seconds of travel each mote is drawn out over (whole ms).
  // `desat`: 0..1, how far the light on it is greyed; add 2 for fine grain (a mist of specks, no lumps).
  // `bias`: speed = min + (max - min) * f^bias; 2 piles most of the cloud up near its source.
  function cloud(o, n, count, window, spMin, spMax, drag, grav, lifeNear, lifeFar, s0, sNear, sFar, r, g, b, a, angle, desat, floorY, wrap, streak = 0, bias = 2) {
    const aux = wrap + 8 * Math.round(streak * 1000);
    if (count > 1) count = Math.max(1, Math.round(count * dens));
    for (let i = 0; i < count; i++) {
      cone(n, angle);
      const f = rng.next(); const sp = spMin + (spMax - spMin) * (bias === 2 ? f * f : Math.pow(f, bias));
      CN.copy(W).addScaledVector(n, -0.8 * W.dot(n)); // mostly the sideways part: which flank of the cloud
      if (CN.lengthSq() < 1e-6) CN.copy(n);
      CN.normalize();
      const j = rr(0.85, 1.15);
      delay = window * rng.next() * rng.next(); // most of it leaves at once, the rest trails
      spawn(KIND.mote, o.x, o.y, o.z, W.x * sp, W.y * sp, W.z * sp, (lifeNear + (lifeFar - lifeNear) * f) * rr(0.85, 1.15), s0, (sNear + (sFar - sNear) * f) * rr(0.8, 1.25),
        CN.x, CN.y, r * j, g * j, b * j, a * (1 - 0.65 * f), drag, grav, floorY, desat, CN.z, aux);
    }
    delay = 0;
  }

  const MW = P.clone(); // where the world's flash light is put
  // The flash's colours. Stock: what the particle shader's own fire ramp gives (multipliers of 1) and
  // the warm lights. An upgraded weapon passes `tint` ([body rgb, core rgb], scene-linear): the
  // multipliers are that colour over the ramp's own, so the flame comes out in the weapon's colour.
  const FT = { core: [1, 1, 1], body: [1, 1, 1], stockFx: null, stockWorld: null, from: new Vector3(), on: false };
  const _mz = new Vector3();
  function flashTint(tint) {
    const ml = lights.muzzle, wl = G.lights && G.lights.muzzle && G.lights.muzzle.color;
    if (!FT.stockFx) FT.stockFx = ml.color.clone();
    if (wl && !FT.stockWorld) FT.stockWorld = wl.clone();
    if (!tint) {
      FT.core[0] = FT.core[1] = FT.core[2] = 1; FT.body[0] = FT.body[1] = FT.body[2] = 1;
      ml.color.copy(FT.stockFx); if (wl) wl.copy(FT.stockWorld);
      return;
    }
    const b = tint[0], c = tint[1];
    FT.body[0] = b[0]; FT.body[1] = b[1] / 0.5; FT.body[2] = b[2] / 0.16;
    FT.core[0] = c[0]; FT.core[1] = c[1] / 0.8; FT.core[2] = c[2] / 0.55;
    ml.color.set(b[0] * 1.2 + 0.13, b[1] * 1.2 + 0.08, b[2] * 1.2 + 0.04);
    if (wl) wl.setRGB(b[0] * 0.9 + 0.1, b[1] * 0.9 + 0.06, b[2] * 0.9 + 0.03);
  }
  function muzzle(pos, dir, tint = null) {
    readVec(pos, P); readVec(dir, D);
    if (D.lengthSq() < 1e-8) D.set(0, 0, -1);
    D.normalize(); basis(D);
    flashTint(tint);
    const C = FT.core, B = FT.body;
    const ml = lights.muzzle;
    ml.pos.copy(P).addScaledVector(D, 0.12);
    ml.t0 = clock.now;
    // the same flash on the world, from the middle of the fireball rather than the crown: 12 cm from
    // the muzzle the light sat a hand's width from the glove and the frame and burned them out flat
    if (G.lights && G.lights.setMuzzleFlash) G.lights.setMuzzleFlash(MW.copy(P).addScaledVector(D, 0.5), 1);
    // The flame is born a hair late, so its birth time is its own: the shader moves exactly these
    // particles with the muzzle while they live (update(), below). Only for the gun in the hands.
    const view = G.weapon && !G.weapon.stub && G.weapon.view;
    FT.on = !!(view && typeof view.muzzleWorld === 'function') && view.muzzleWorld(_mz).distanceToSquared(P) < 0.01;
    FT.from.copy(P);
    delay = 0.0005;
    flashAt.value.set(0, 0, 0, FT.on ? Math.fround(clock.now + delay + lead) : -1);
    // hot core and the star seen from behind the gun
    spawn(KIND.fire, P.x + D.x * 0.03, P.y + D.y * 0.03, P.z + D.z * 0.03, D.x, D.y, D.z, 0.026, 0.09, 0.15, 0, 0, C[0], 0.82 * C[1], 0.6 * C[2], 0.9, 12, 0, -1e5, 60, P_CELL.glow, 1);
    spawn(KIND.fire, P.x + D.x * 0.05, P.y + D.y * 0.05, P.z + D.z * 0.05, D.x * 2, D.y * 2, D.z * 2, 0.05, 0.15, 0.26, rr(0, TAU), 0, C[0], 0.9 * C[1], 0.75 * C[2], 1, 20, 0, -1e5, 42, P_CELL.star + rng.int(0, 3), 1);
    // flame tongues along the bore, plus two short side vents
    for (let i = 0; i < 2; i++) {
      cone(D, 0.1);
      const sp = rr(5.5, 8.5);
      spawn(KIND.jet, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.045, 0.06), 0.075, 0.11, 0, 0, B[0], 0.9 * B[1], 0.75 * B[2], 1, 26, 0, -1e5, 46, P_CELL.tongue + rng.int(0, 3), 0.034);
    }
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      W.copy(D).multiplyScalar(0.55).addScaledVector(T1, 0.55 * s).addScaledVector(T2, rr(-0.5, 0.5)).normalize();
      spawn(KIND.jet, P.x, P.y, P.z, W.x * 3.5, W.y * 3.5, W.z * 3.5, 0.04, 0.04, 0.06, 0, 0, B[0], 0.85 * B[1], 0.7 * B[2], 0.9, 30, 0, -1e5, 30, P_CELL.tongue + rng.int(0, 3), 0.03);
    }
    delay = 0;
    for (let i = 0; i < 5; i++) {
      cone(D, 0.3);
      const sp = rr(6, 16);
      spawn(KIND.spark, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.07, 0.2), 0.005, 0.003, 0, 0, B[0], 0.9 * B[1], 0.7 * B[2], 1, 5, 0.6, -1e5, 26, P_CELL.streak, 0.012);
    }
    // powder smoke: thin grey haze from the muzzle outward along the bore, gone in a third of a second
    cloud(P, D, 64, 0.05, 0.4, 8.5, 13, -0.04, 0.3, 0.17, 0.03, 0.1, 0.22, 0.2, 0.2, 0.21, 0.055, 0.2, 0.7, -1e5, 0.8);
  }

  function debris(s, n, floorY, scale) {
    // dust: a short cone, densest at the hole, that is all but stopped within a tenth of a second, sags a
    // little and thins from its far end. Motes stay small (no billow) and are lit right through.
    cloud(P, n, s.puffs, 0.05, 0.2, 4.2 * scale, 14, 0.25, 0.5, 0.24, 0.04 * scale, 0.09 * scale, 0.12 * scale, s.dust[0], s.dust[1], s.dust[2], s.dustA, 0.28, 2, floorY + 0.01, 3, 0.01);
    // fine grit that drops out of the cloud
    for (let i = 0; i < s.grit; i++) {
      cone(n, 0.8);
      const sp = rr(0.5, 2.6); const j = rr(0.7, 1.3); const sz = rr(0.002, 0.005);
      delay = rr(0, 0.06);
      spawn(KIND.chip, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.8, 1.6), sz, sz, rr(0, TAU), rr(-25, 25), s.chip[0] * j, s.chip[1] * j, s.chip[2] * j, 1, 0, 1, floorY, 0, P_CELL.chip + rng.int(0, 7), 1);
    }
    delay = 0;
    for (let i = 0; i < s.chips; i++) {
      cone(n, 0.95);
      const sp = rr(1.2, 5.5); const j = rr(0.7, 1.3);
      const sz = rr(0.006, 0.022) * scale;
      spawn(KIND.chip, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(1.0, 1.6), sz, sz, rr(0, TAU), rr(-25, 25), s.chip[0] * j, s.chip[1] * j, s.chip[2] * j, 1, 0, 1, floorY, 0, P_CELL.chip + rng.int(0, 7), 1);
    }
    for (let i = 0; i < s.sparks; i++) {
      if (rng.next() > 0.6) continue;
      cone(n, 0.8);
      const sp = rr(3, 8);
      spawn(KIND.spark, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.1, 0.25), 0.005, 0.003, 0, 0, 1, 0.85, 0.6, 1, 2.5, 1, floorY, 14, P_CELL.streak, 0.014);
    }
    // standing water thrown up from wet ground
    const wet = lights.uniforms.uWetness.value;
    if (wet > 0.4 && n.y > 0.5) {
      for (let i = 0; i < s.spray; i++) {
        cone(n, 0.7);
        const sp = rr(1.5, 4.5);
        spawn(KIND.drop, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, 1.0, rr(0.003, 0.006), 0.003, 0, 0, 0.05, 0.055, 0.06, 0.3, 0.8, 1, floorY, 0, P_CELL.drop + rng.int(0, 3), 0.012);
      }
    }
  }

  function impact(pos, normal, surface) {
    readVec(pos, P); readVec(normal, D);
    if (D.lengthSq() < 1e-8) D.set(0, 1, 0);
    D.normalize(); basis(D);
    if (surface === 'flesh') { bloodAt(P, D, 0.7); return; }
    P.addScaledVector(D, 0.012);
    const floorY = floorBelow(P);
    if (surface === 'metal') {
      spawn(KIND.fire, P.x, P.y, P.z, D.x, D.y, D.z, 0.06, 0.05, 0.16, 0, 0, 1, 0.85, 0.65, 0.9, 10, 0, -1e5, 34, P_CELL.glow, 1);
      spawn(KIND.flat, P.x, P.y, P.z, D.x, D.y, D.z, 0.07, 0.1, 0.3, rr(0, TAU), 0, 1, 0.85, 0.6, 0.9, 0, 0, -1e5, 26, P_CELL.burst, 1);
      for (let i = 0; i < 22; i++) {
        cone(D, 1.15);
        const sp = rr(2.5, 13) * (i < 6 ? 1.3 : 1);
        spawn(KIND.spark, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(0.18, 0.7), rr(0.004, 0.008), 0.003, 0, 0, 1, 0.9, 0.7, 1, 2.2, 1, floorY, rr(18, 40), P_CELL.streak, 0.016);
      }
      cloud(P, D, 18, 0.04, 0.2, 2.5, 9, -0.05, 0.5, 0.3, 0.02, 0.05, 0.12, 0.3, 0.3, 0.31, 0.06, 0.5, 0.5, floorY, 0.7);
      basis(D);
      for (let i = 0; i < 4; i++) { // flakes of paint
        cone(D, 0.9);
        const sp = rr(1, 3.5); const sz = rr(0.004, 0.009);
        spawn(KIND.chip, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, 1.5, sz, sz, rr(0, TAU), rr(-30, 30), 0.12, 0.12, 0.13, 1, 0, 1, floorY, 0, P_CELL.chip + rng.int(0, 7), 1);
      }
      return;
    }
    if (surface === 'glass') {
      for (let i = 0; i < 18; i++) {
        cone(D, 1.0);
        const sp = rr(1.0, 5.5); const sz = rr(0.008, 0.03);
        spawn(KIND.shard, P.x, P.y, P.z, W.x * sp, W.y * sp, W.z * sp, rr(1.2, 2), sz, sz, rr(0, TAU), rr(-30, 30), 0.8, 1, 0.95, 1, 0, 1, floorY, 0, P_CELL.shard + rng.int(0, 3), 1);
      }
      cloud(P, D, 26, 0.04, 0.2, 3.5, 10, 0.12, 0.45, 0.25, 0.02, 0.06, 0.15, 0.6, 0.66, 0.66, 0.06, 0.55, 0.3, floorY, 0.7);
      return;
    }
    debris(SURF[surface] || SURF.concrete, D, floorY, D.y > 0.5 ? 0.75 : 1);
    if (surface === 'cloth') bloodAt(P, D, 0.35);
  }

  // Blood leaving a body. p, d: Vector3 (d normalised: the way the round was going). Two parts: a
  // brief red puff and a few fat drops back out of the wound toward whoever fired (what the shooter
  // sees), and a darker, longer spray out of the far side. part: where it struck ('head' throws a
  // wider, finer burst and some of it up and back; a limb a thin one that mostly falls). Counts follow
  // G.fx.gore (0: nothing; reduced keeps the puff that says "hit") and the tier (fewer on mobile, so
  // sustained fire does not flood the ring). Uses P2/D2 so callers may pass P/D.
  const BK = new Vector3();
  function bloodAt(p, d, amount, part) {
    P2.copy(p); D2.copy(d);
    const gore = goreOf(fx.gore);
    if (gore <= 0) return;
    const head = part === 'head'; const limb = part === 'arm' || part === 'leg' || part === 'armL' || part === 'armR' || part === 'legL' || part === 'legR';
    const a = Math.max(0.15, amount);
    const k = Math.sqrt(a);
    const floorY = floorBelow(P2);
    const lite = dens < 1 ? 0.6 : 1;
    const g = (0.45 + 0.55 * gore) * lite;
    // seen from further off the puff is drawn larger, so a hit at 10 m still reads from behind the sights
    const far = Math.min(1.8, Math.max(1, P2.distanceTo(G.camera.position) / 6));
    const near = Math.min(1, P2.distanceTo(G.camera.position) / 2.5); // at arm's length the drops fly into the lens: smaller
    // -- entry: back along the shot and a little up
    BK.copy(D2).negate(); BK.y += 0.2; BK.normalize();
    basis(BK);
    // the wound opening: a wet burst that breaks up in a fifth of a second
    spawn(KIND.splash, P2.x + BK.x * 0.07, P2.y + BK.y * 0.07, P2.z + BK.z * 0.07, BK.x * 1.2, BK.y * 1.2 + 0.3, BK.z * 1.2, rr(0.2, 0.26), 0.1 * k * far, rr(0.5, 0.66) * k * far, rr(0, TAU), rr(-1, 1), BLOOD[0], BLOOD[1], BLOOD[2], 0.95, 3, 0.25, floorY, 0, P_CELL.splash, P_CELL.splashFrames);
    cloud(P2, BK, Math.round(44 * a * g), 0.02, 0.4, 4.2, 9, 0.35, 0.42, 0.26, 0.04 * far, 0.1 * k * far, 0.22 * k * far, PUFF[0], PUFF[1], PUFF[2], 0.6, 0.8, 2, floorY, 3, 0.012, 1.4);
    for (let i = 0, n = Math.max(2, Math.round((3 + 3 * a) * gore * lite)); i < n; i++) {
      cone(BK, 0.65);
      const sp = rr(1.4, 4.2);
      spawn(KIND.drop, P2.x, P2.y, P2.z, W.x * sp, W.y * sp + 0.8, W.z * sp, 1.4, rr(0.012, 0.024) * far * near, 0.008 * far * near, 0, 0, BLOOD[0] * 1.4, BLOOD[1], BLOOD[2], 0.95, 0.7, 1, floorY, 0, P_CELL.drop + rng.int(0, 3), 0.008);
    }
    // -- exit: a darker fan of mist the way the round went, many small streaked motes
    basis(D2);
    const mist = (44 + 36 * a) * (head ? 1.35 : limb ? 0.6 : 1) * g;
    cloud(P2, D2, Math.round(mist), 0.025, 0.5, head ? 7 : 6, 12, 0.3, 0.36, 0.2, 0.02, 0.045 * k, 0.09 * k, MIST[0], MIST[1], MIST[2], 0.6, head ? 0.6 : limb ? 0.3 : 0.42, 2, floorY, 3, 0.016, 1.4);
    if (head && gore >= 1) { // the back of the skull: a slower puff up and away
      W.copy(D2).multiplyScalar(0.5); W.y += 0.85; W.normalize(); D.copy(W); basis(D);
      cloud(P2, D, Math.round(34 * a * lite), 0.04, 0.3, 3.2, 9, 0.5, 0.45, 0.3, 0.02, 0.06 * k, 0.12 * k, MIST[0] * 1.6, MIST[1], MIST[2], 0.55, 0.5, 2, floorY, 3, 0.012, 1.4);
      basis(D2);
    }
    for (let i = 0, n = Math.max(2, Math.round((5 + 6 * a) * (limb ? 1.3 : 1) * gore * lite)); i < n; i++) {
      cone(D2, head ? 0.75 : 0.55);
      const sp = rr(1.5, limb ? 4 : 6);
      spawn(KIND.drop, P2.x, P2.y, P2.z, W.x * sp, W.y * sp + 0.6, W.z * sp, 1.4, rr(0.007, 0.016), 0.006, 0, 0, BLOOD[0] * 1.2, BLOOD[1], BLOOD[2], 0.95, 0.7, 1, floorY, 0, P_CELL.drop + rng.int(0, 3), 0.007);
    }
    // small wet chunks
    for (let i = 0, n = Math.round((2 + 3 * a) * (head ? 1.6 : 1) * (gore >= 1 ? lite : 0)); i < n; i++) {
      cone(D2, 0.6);
      const sp = rr(1, 3.8); const sz = rr(0.006, 0.014);
      spawn(KIND.chip, P2.x, P2.y, P2.z, W.x * sp, W.y * sp + 0.4, W.z * sp, rr(1.0, 1.6), sz, sz, rr(0, TAU), rr(-25, 25), BLOOD[0] * 1.2, BLOOD[1] * 1.5, BLOOD[2] * 1.5, 1, 0, 1, floorY, 1, P_CELL.chip + rng.int(0, 7), 1);
    }
  }

  function blood(pos, dir, amount = 1, part) {
    readVec(pos, P); readVec(dir, D);
    if (D.lengthSq() < 1e-8) D.set(0, 1, 0);
    bloodAt(P, D.normalize(), amount, part);
  }

  // Blood particles by kind, for whoever decides what bleeds: 'spray' a burst of stretched
  // droplets along dir, 'mist' a fine aerosol, 'drop' single drips that fall. Lit; counts follow
  // G.fx.gore and the tier's particle cap.
  function bloodParticles(kind, pos, dir, count = 8, speed = 3) {
    readVec(pos, P2); readVec(dir || UP, D2);
    if (D2.lengthSq() < 1e-8) D2.set(0, -1, 0);
    D2.normalize(); basis(D2);
    const gore = goreOf(fx.gore);
    if (gore <= 0) return;
    const floorY = floorBelow(P2);
    const n = Math.max(1, Math.round(count * gore * dens));
    if (kind === 'mist') { cloud(P2, D2, n * 6, 0.03, 0.3, speed * 1.5, 12, 0.3, 0.34, 0.2, 0.015, 0.035, 0.07, MIST[0], MIST[1], MIST[2], 0.7, 0.42, 2, floorY, 3, 0.016, 1.4); return; }
    for (let i = 0; i < n; i++) {
      if (kind === 'drop') { W.copy(D2).multiplyScalar(rr(0, 0.4)); W.x += rr(-0.15, 0.15); W.z += rr(-0.15, 0.15); delay = rr(0, 0.5); } else { cone(D2, 0.35); W.multiplyScalar(speed * rr(0.5, 1.2)); }
      spawn(KIND.drop, P2.x, P2.y, P2.z, W.x, W.y, W.z, 1.6, rr(0.004, 0.009), 0.004, 0, 0, BLOOD[0] * 1.3, BLOOD[1], BLOOD[2], 0.95, 0.7, 1, floorY, 0, P_CELL.drop + rng.int(0, 3), 0.006);
    }
    delay = 0;
  }

  let casingsThrown = 0;
  const lastCasing = [0, 0, 0];
  // look: [r, g, b, size] (size 1 = a 19 mm pistol case); brass when not given
  function casing(pos, vel, look) {
    readVec(pos, P); readVec(vel, D);
    casingsThrown++;
    lastCasing[0] = P.x; lastCasing[1] = P.y; lastCasing[2] = P.z;
    const c = look || BRASS; const sz = look ? look[3] : 1;
    spawn(KIND.casing, P.x, P.y, P.z, D.x, D.y, D.z, 14, sz, sz, rr(0, TAU), rr(18, 34) * (rng.next() < 0.5 ? -1 : 1) / Math.sqrt(sz), c[0], c[1], c[2], 1, 0, 1, floorBelow(P), 0, 0, 0);
  }

  // One spent case for one shot, from the weapon:fire payload ({ pos, dir, eject }). This is the
  // only place brass comes from: it leaves the ejection port (`eject`), not the muzzle.
  const LAUNCH = new Array(6);
  function ejectCasing(e) {
    const pv = G.player && !G.player.stub ? G.player.vel : null;
    if (!casingLaunch(e, rng, pv, LAUNCH)) return false;
    E1.set(LAUNCH[0], LAUNCH[1], LAUNCH[2]); E3.set(LAUNCH[3], LAUNCH[4], LAUNCH[5]);
    casing(E1, E3, CASE_LOOK[e.weapon]);
    return true;
  }

  function puff(pos, size = 1) {
    readVec(pos, P);
    const floorY = floorBelow(P);
    D.set(0, 1, 0); basis(D);
    cloud(P, D, 60, 0.15, 0.2, 3.2 * size, 5, -0.02, 1.6, 0.9, 0.06 * size, 0.22 * size, 0.5 * size, 0.28, 0.265, 0.245, 0.22, 1.45, 0.2, floorY, 0.7);
  }

  function decal(pos, normal, kind = 'bullet', opts) {
    readVec(pos, P); readVec(normal, D);
    return decals.add(P, D, kind, opts);
  }
  // A persistent blood decal: { kind: 'spatter' | 'pool' | 'smear' | 'drip', size, grow (seconds),
  // dir (travel or drag direction on the flat), wet (override), tint } -> slot. See decals.js.
  const BD = new Vector3(); const bdOpts = { kind: 'spatter', size: 0, grow: 0, dir: null, wet: undefined, tint: null, age: 0, run: -1 };
  function bloodDecal(pos, normal, o) {
    readVec(pos, P); readVec(normal || UP, D);
    bdOpts.kind = (o && o.kind) || null; bdOpts.size = (o && o.size) || 0; bdOpts.grow = (o && o.grow) || 0;
    bdOpts.dir = o && o.dir ? readVec(o.dir, BD) : null;
    bdOpts.wet = o && typeof o.wet === 'number' ? o.wet : undefined; bdOpts.tint = (o && o.tint) || null; bdOpts.age = (o && o.age) || 0; bdOpts.run = o && o.run >= 0 ? o.run : -1;
    return decals.addBlood(P, D, bdOpts);
  }

  // Low-level: one particle from a description. For effects owned by other modules.
  const ZERO = [0, 0, 0]; const WHITE = [1, 1, 1, 1];
  function emit(d) {
    const kind = typeof d.kind === 'string' ? KIND[d.kind] : d.kind;
    readVec(d.pos, P); readVec(d.vel || ZERO, D);
    const c = d.color || WHITE;
    const size = d.size === undefined ? 0.1 : d.size;
    const s0 = typeof size === 'number' ? size : size[0];
    const s1 = typeof size === 'number' ? size : size[1];
    const cell = d.cell === undefined ? P_CELL.smoke : (typeof d.cell === 'string' ? P_CELL[d.cell] : d.cell);
    spawn(kind || 0, P.x, P.y, P.z, D.x, D.y, D.z, d.life || 1, s0, s1, d.rot || 0, d.spin || 0, c[0], c[1], c[2], c[3] === undefined ? 1 : c[3],
      d.drag || 0, d.gravity || 0, d.floorY === undefined ? -1e5 : d.floorY, d.emissive || 0, cell, d.frames || d.stretch || 1);
  }

  function clear() {
    data.fill(0);
    cursor = 0; casingCursor = 0; slowCursor = 0; uploader.markAll();
    activeUntil = 0;
    lights.muzzle.t0 = -1e9;
    clock.now = 100; // nothing refers to older times any more: rebase so float32 ages stay exact
    decals.clear();
    if (combat) combat.clear();
  }

  // ---- events -------------------------------------------------------------------------------
  const E1 = new Vector3(); const E2 = new Vector3(); const E3 = new Vector3(); const UP = new Vector3(0, 1, 0);
  if (G.events) {
    G.events.on('weapon:fire', (e) => {
      if (!e || !e.pos || !e.dir) return;
      if (e.weapon !== 'jumper') muzzle(e.pos, e.dir, e.upgraded ? upgradeLook(e.weapon).flash : null); // the Jumper throws an arc (combat.js), not powder
      ejectCasing(e);
    });
    const worldOpts = { surface: 'concrete' };
    G.events.on('hit:world', (e) => {
      if (!e || !e.pos) return;
      const n = e.normal || UP;
      impact(e.pos, n, e.surface);
      if (e.surface !== 'flesh' && e.surface !== 'cloth') { worldOpts.surface = e.surface; decals.add(readVec(e.pos, E1), readVec(n, E2), 'bullet', worldOpts); }
    });
    // blood.js decides what a hit spills (it sets fx.bloodOwner). Until it does,
    // this does: spray by where the round struck, spatter on the wall behind and on the ground the
    // way the round was going, in the decal pool's blood share. No blood from fire or the arc.
    const hitOpts = { kind: 'spatter', size: 0.3, dir: null, grow: 0, run: -1, age: 0 };
    const plan = { amount: 0, ground: 0, wall: 0 };
    G.events.on('hit:zombie', (e) => {
      if (fx.bloodOwner || !e || !e.pos) return;
      const src = e.source || 'bullet';
      if (src === 'fire' || src === 'arc') return;
      hitBlood(e, fx.gore, rng.next(), rng.next(), rng.next(), rng.next(), plan);
      if (plan.amount <= 0) return; // gore 0
      readVec(e.pos, E1);
      if (e.dir) readVec(e.dir, E2); else E2.copy(E1).sub(G.camera.position); // the round's direction of travel
      if (E2.lengthSq() < 1e-6) E2.set(0, 0, -1);
      E2.normalize();
      const head = e.part === 'head';
      if (src === 'melee') {
        // A blade: the damage is dealt on the press, the steel arrives a moment later (rig.js MELEE)
        // where the player is looking, so the blood is staged for then and put where the view's
        // axis meets the body, not at the body's middle.
        lead = Math.max(0, (MELEE[e.weapon] || MELEE.knife).hit - 0.01);
        G.camera.getWorldDirection(E3);
        const zr = G.zombies && typeof G.zombies.raycast === 'function' ? G.zombies.raycast(G.camera.position, E3, 2.6) : null;
        if (zr && zr.pos) readVec(zr.pos, E1); else E1.y = Math.min(E1.y + 0.2, G.camera.position.y - 0.1);
        E2.copy(E3);
        plan.amount = e.weapon === 'axe' ? 1.6 : 1.2;
      }
      hitOpts.age = -lead;
      bloodAt(E1, E2, plan.amount, e.part);
      lead = 0;
      // on whatever is close behind: a small spatter; on a car body its drops run a little. Never on
      // glass (a pane is not a wall: blood does not hang on it as paint would)
      if (plan.wall > 0) {
        const wall = levelRay(E1, E2, head ? 3 : 2.2);
        if (wall && wall.pos && wall.normal && wall.surface !== 'glass') {
          readVec(wall.normal, P);
          if (P.y < 0.6) {
            hitOpts.kind = 'spatter'; hitOpts.size = plan.wall; hitOpts.dir = null; hitOpts.run = wall.surface === 'metal' ? 0.4 : 0.2;
            decals.addBlood(readVec(wall.pos, E3), P, hitOpts);
          }
        }
      }
      // on the ground, where the spray comes down: drops cast the way the round went
      if (plan.ground > 0) {
        const h = E1.y - floorBelow(E1);
        if (h < 2.5) {
          const reach = rr(0.3, 0.8) + h * 0.45;
          E3.set(E1.x + E2.x * reach, E1.y + 0.05, E1.z + E2.z * reach);
          const hit = levelRay(E3, DOWN, 4);
          if (hit && hit.pos && hit.surface !== 'glass') {
            readVec(hit.normal || UP, P);
            hitOpts.kind = 'spatter'; hitOpts.size = plan.ground; hitOpts.dir = E2; hitOpts.run = P.y > 0.6 ? -1 : 0.4;
            if (hitOpts.age < 0) hitOpts.age -= 0.3; // a blade's blood is still in the air
            decals.addBlood(readVec(hit.pos, E3), P, hitOpts);
          }
        }
      }
    });
    // Corpse pools belong to blood.js. Until its blood.js takes over (fx.bloodOwner, or fx.corpsePools =
    // false), a death lays one modest pool that spreads over a few seconds.
    const dieOpts = { kind: 'pool', size: 0.6, dir: null, grow: 5 };
    G.events.on('zombie:die', (e) => {
      if (!e || !e.pos) return;
      const size = deathPool(fx.gore, fx.bloodOwner, fx.corpsePools, rng.next());
      if (size <= 0) return;
      readVec(e.pos, E1); E1.y += 0.3;
      const hit = levelRay(E1, DOWN, 4);
      if (!hit || !hit.pos || hit.surface === 'glass') return;
      dieOpts.size = size;
      decals.addBlood(readVec(hit.pos, E3), UP, dieOpts);
    });
    // a restored context has empty atlases and empty buffers
    G.events.on('renderer:restored', () => { atlases.rebake(); uploader.markAll(); decals.restore(); warm = 4; });
  }

  // ---- render pass --------------------------------------------------------------------------
  const pass = post.addPass({
    name: 'particles',
    render(p) {
      p.renderer.setRenderTarget(p.targets.hdr);
      p.renderer.render(fxScene, G.camera);
    },
    dispose() { geo.dispose(); material.dispose(); decals.dispose(); atlases.dispose(); },
  }, 'fx');

  let warm = 4;
  // eslint-disable-next-line prefer-const
  let fx = null;
  fx = {
    // the effects atlases: a promise that resolves once they are drawn, and how far along they are (0..1)
    ready: atlases.ready, readyProgress: () => atlases.progress(), readyLabel: () => atlases.label(), startEffects: () => atlases.start(),
    muzzle, impact, blood, casing, ejectCasing, puff, decal, emit, clear, bloodDecal, bloodParticles,
    // retire one blood decal by the slot bloodDecal returned: gone in about a second (the pool cap)
    fadeBloodDecal(slot, seconds = 1) { return decals.fadeBlood(slot, seconds); },
    // how wet a spot is: 0 under a roof .. 1 in open rain (times the sky's wetness)
    wetAt(pos) { readVec(pos, P); return decals.rainAt(P.x, P.y + 0.1, P.z) * lights.uniforms.uWetness.value; },
    // 1 (full) or 0.3 (reduced): the settings write it; every gore effect reads it
    gore: G.params && G.params.gore === 'reduced' ? 0.3 : 1,
    // set true by whoever takes over deciding what a hit spills (blood.js)
    bloodOwner: false,
    // one modest pool under each body until the corpse pools exist; false switches it off
    corpsePools: true,
    KIND, CELL: P_CELL,
    // The flash as particles and decals see it: { pos:Vector3, color:Vector3, intensity (scene cd), range }.
    // fx.muzzle() also calls G.lights.setMuzzleFlash, so the world gets the same flash.
    muzzleLight: lights.muzzle,
    get clock() { return clock.now; },
    get decalCount() { return decals.count; },
    get bloodDecalCount() { return decals.bloodCount; },
    get decalCaps() { return decals.caps; },
    get particleCap() { return mainSlots + slowN; },
    // for the harness: casings thrown since load, and where the last one started
    get casingCount() { return casingsThrown; },
    lastCasing,
    buffers: { particles: buffer, decals: decals.buffer }, // for tests: upload ranges are visible on these

    // dt: simulation time (0 while paused: particles hold). frameDt: the frame's real dt.
    update(dt, frameDt = dt) {
      if (!clock.frozen) clock.now += dt;
      fitTier();
      lights.uniforms.uTime.value = clock.now;
      const ml = lights.muzzle;
      const ma = clock.now - ml.t0;
      const level = ma >= 0 && ma < 0.2 ? Math.exp(-ma / 0.03) : 0;
      ml.intensity = 90 * level;
      // the last shot's flame rides the muzzle for as long as it is seen
      if (FT.on && ma >= 0 && ma < 0.08 && !clock.frozen) { const f = flashAt.value; G.weapon.view.muzzleWorld(_mz); f.x = _mz.x - FT.from.x; f.y = _mz.y - FT.from.y; f.z = _mz.z - FT.from.z; }
      // a staged flash is pinned in time: hold the world's flash light at the same age
      if (clock.frozen && level > 0 && G.lights && G.lights.setMuzzleFlash) G.lights.setMuzzleFlash(ml.pos, level);
      combat.update(clock.frozen ? 0 : dt); // after the staged-flash line above: a blast's flash is its own
      lights.update(G.camera.position);

      const sc = G.shotCam;
      if (sc !== stagedFrom) { stagedFrom = sc; if (sc && sc.fx !== undefined) stage(sc.fx, sc.age, sc.size); }

      uploader.flush();
      decals.flush();
      // the pass also runs while a buffer change is waiting to be uploaded (uploads happen on draw)
      // ... and for the first frames after load and after a restored context, with nothing alive: the
      // two programs are compiled and linked then, in the pass's own render state, not on the first hit
      if (warm > 0) warm--;
      pass.enabled = warm > 0 || clock.now < activeUntil || decals.count > 0 || uploader.pending || decals.pending;

      // rain attaches itself as fx.rain; it is ticked here because the loop only calls fx.update
      const rain = fx.rain;
      if (rain && typeof rain.update === 'function') rain.update(frameDt); // rain is weather, not gameplay: it falls through a pause
    },
  };

  // ---- staged shots: __setShot({ fx:'<name>', age:<seconds>, size? }) ------------------------
  // Clears everything, replays one effect with a fixed seed and pins the fx clock at `age`, so the
  // frame is the same however many frames are stepped. { fx:null } releases the clock.
  let stagedFrom = null;
  let anchors = null; // set by the test stage; otherwise effects are placed in front of the camera
  const A = { pos: new Vector3(), normal: new Vector3(), dir: new Vector3() };
  function stage(name, age, size) {
    clear();
    stream = G.rng.fork('fx');
    if (anchors && anchors.frame) anchors.frame(name || '');
    if (!name) { clock.frozen = false; return; }
    clock.frozen = true; clock.now = 100;
    const s = size > 0 ? size : 1;
    const at = (key) => {
      if (anchors && anchors(key, A)) return A;
      // no stage: 2.5 m ahead of the camera, on the floor for surface effects
      G.camera.getWorldDirection(A.dir);
      A.pos.copy(G.camera.position).addScaledVector(A.dir, 2.5);
      A.normal.set(0, 1, 0);
      if (key !== 'air') A.pos.y = floorBelow(A.pos);
      return A;
    };
    let a;
    switch (name) {
      case 'muzzle': a = at('muzzle'); muzzle(a.pos, a.dir); break;
      case 'impact-asphalt': a = at('asphalt'); impact(a.pos, a.normal, 'asphalt'); decals.add(a.pos, a.normal, 'bullet', { surface: 'asphalt' }); break;
      case 'impact-dirt': a = at('asphalt'); impact(a.pos, a.normal, 'dirt'); decals.add(a.pos, a.normal, 'bullet', { surface: 'dirt' }); break;
      case 'impact-concrete': a = at('concrete'); impact(a.pos, a.normal, 'concrete'); decals.add(a.pos, a.normal, 'bullet', { surface: 'concrete' }); break;
      case 'impact-metal': a = at('metal'); impact(a.pos, a.normal, 'metal'); decals.add(a.pos, a.normal, 'bullet', { surface: 'metal' }); break;
      case 'impact-glass': a = at('glass'); impact(a.pos, a.normal, 'glass'); decals.add(a.pos, a.normal, 'bullet', { surface: 'glass' }); break;
      case 'impact-flesh': a = at('flesh'); impact(a.pos, a.normal, 'flesh'); break;
      case 'blood-mist': a = at('mist'); blood(a.pos, a.dir, 1.5 * s); break;
      case 'casing': a = at('casing'); casing(a.pos, a.dir); break;
      case 'puff': a = at('asphalt'); puff(a.pos, s); break;
      case 'decal-bullet':
        for (const key of ['asphalt', 'concrete', 'metal', 'glass', 'concrete-edge', 'concrete-top']) {
          a = at(key);
          decals.add(a.pos, a.normal, 'bullet', { surface: key.split('-')[0], size: size > 0 ? size : 0 });
        }
        break;
      case 'decal-blood':
        a = at('asphalt'); decals.add(a.pos, a.normal, 'blood', { size: 0.9 * s });
        a = at('concrete'); decals.add(a.pos, a.normal, 'blood', { size: 0.55 * s });
        a = at('concrete-top'); decals.add(a.pos, a.normal, 'blood', { size: 0.5 * s, wet: 0 });
        break;
      case 'decal-scorch': a = at('asphalt'); decals.add(a.pos, a.normal, 'scorch', { size: 0.6 * s }); break;
      case 'fx-blood-ground-wet': // left: in the rain; right: the same shapes dry (under a roof)
        a = at('asphalt');
        decals.addBlood(P.set(a.pos.x - 0.35, a.pos.y, a.pos.z), a.normal, { kind: 'pool', size: 0.6 * s, wet: 1 });
        decals.addBlood(P.set(a.pos.x - 0.3, a.pos.y, a.pos.z + 0.7), a.normal, { kind: 'spatter', size: 0.5 * s, wet: 1, dir: D.set(1, 0, 0.3) });
        decals.addBlood(P.set(a.pos.x + 0.85, a.pos.y, a.pos.z), a.normal, { kind: 'pool', size: 0.6 * s, wet: 0 });
        decals.addBlood(P.set(a.pos.x + 0.9, a.pos.y, a.pos.z + 0.7), a.normal, { kind: 'spatter', size: 0.5 * s, wet: 0, dir: D.set(1, 0, 0.3) });
        decals.addBlood(P.set(a.pos.x + 0.3, a.pos.y, a.pos.z + 1.2), a.normal, { kind: 'smear', size: 0.7 * s, wet: 0.5, dir: D.set(1, 0, 0.2) });
        break;
      case 'fx-blood-wall':
        a = at('concrete');
        decals.addBlood(P.set(a.pos.x - 0.2, a.pos.y + 0.1, a.pos.z), a.normal, { kind: 'spatter', size: 0.5 * s, wet: 0 });
        decals.addBlood(P.set(a.pos.x + 0.22, a.pos.y + 0.12, a.pos.z), a.normal, { kind: 'drip', size: 0.5 * s, wet: 0.6 });
        break;
      default: if (!combat.stage(name, at, s, age > 0 ? age : 0)) console.warn(`[fx] unknown staged effect "${name}"`);
    }
    clock.now = 100 + (age > 0 ? age : 0);
  }
  fx.stage = stage;

  // ---- combat effects (combat.js): tracers, blasts, fire, arcs, the flare, clouds, gibs -------
  combat = createCombat(G, fx, {
    spawn, cloud, basis, cone, W, rr, rng, floorBelow, levelRay, lights, clock, decals, bloodAt, KIND,
    setDelay(d) { delay = d; },
    setLead(d) { lead = d; },
    get dens() { return dens; },
  });

  if (G.params && G.params.shot === 'fxtest') anchors = installFxTest(G, lights);
  return fx;
}
