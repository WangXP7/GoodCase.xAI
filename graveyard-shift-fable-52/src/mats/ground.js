// Asphalt ground. Large-scale masks (puddle height, dampness, oil, wear) live in one small float
// texture covering the playable area, sampled bicubically so texels never show; the stones come from
// the baked aggregate tile and everything else from the shared noise volumes (noiseTex.js). Wetness is one ramp, standing water -> soaked -> damp -> dry, that drives albedo,
// roughness and normal together. Painted markings and tyre marks are analytic boxes in uniforms.
//
// A level can also hand in its own history of the surface (opts.detail, see makeGround): stains,
// wheel polish, patch repairs and cracks as two authored maps. They are material variation, not
// overlays: each changes albedo, roughness, relief and the height the water stands against, all
// before the wetness ramp, so whatever lies below a puddle's level is under the water, and a
// stain or a polished track shows as a change in the reflection.
import { AGG_PER_M, AGG_CELLS, AGG_SLOPE } from './noiseTex.js';
import { DataTexture, RGBAFormat, HalfFloatType, UnsignedByteType, LinearFilter, ClampToEdgeWrapping, DataUtils, Vector4, Matrix4 } from 'three';

export const GROUND_MAX_MARKS = 32;
const MASK_RES = 256;

const groundDef = {
  kind: 'ground',
  glsl: /* glsl */ `
#define NMARK ${GROUND_MAX_MARKS}
#define AGG_UV ${(AGG_PER_M / AGG_CELLS).toFixed(6)}
#define AGG_SLOPE ${AGG_SLOPE.toFixed(1)}
#if SURF_Q > 1
  #define RING_LAYERS 2
  #define REFL_TAPS 12
#else
  #define RING_LAYERS 1
  #define REFL_TAPS 6
#endif
uniform sampler2D tAgg;
uniform sampler2D tGroundMask;
uniform vec4 uMaskRect;
uniform float uMaskRes;
uniform sampler2D tGDetail;   // r stain potential, g wheel polish, b patch (0.5 = saw cut), a crack corridor (0.5 = none)
uniform sampler2D tGCrack;    // rg offset to the nearest crack centre line
uniform vec4 uGDetailRect;    // minX, minZ, 1/width, 1/depth
uniform float uGCrackRange;   // metres per unit of tGCrack
uniform sampler2D tGBlood;    // r: blood lying on the surface, over its own rectangle
uniform vec4 uGBloodRect;     // minX, minZ, 1/width, 1/depth (all zero: none)
uniform mat4 uReflMatrix;
uniform sampler2D tReflection;
uniform float uReflOn;
uniform vec4 uMarkA[NMARK];
uniform vec4 uMarkB[NMARK];
uniform int uMarkCount;
uniform vec3 uGTint;
uniform float uGPuddle;
float gWater = 0.0;
float gSoak = 0.0;
float gOilFilm = 0.0;
vec2 gRip = vec2(0.0);
float gFilmN = 0.0;
float gGloss = 0.0;

// expanding rain rings: slope of the water surface (x, z)
vec2 sRings(vec2 p, float t, float rain) {
  vec2 g = vec2(0.0);
  for (int L = 0; L < RING_LAYERS; L++) {
    float fq = L == 0 ? 6.5 : 10.5;
    vec2 q = p * fq + float(L) * 17.3;
    ivec2 c = ivec2(floor(q)); vec2 f = fract(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 h = sHash3(ivec3(c + ivec2(i, j), L + 3));
      if (fract(h.z * 5.7 + h.x) > rain) continue;
      float ph = fract(t * (0.9 + 0.5 * h.z) + h.y * 9.0);
      vec2 d = f - (vec2(i, j) + 0.15 + 0.7 * h.xy);
      float r = length(d);
      float x = (r - ph * 0.9) * 30.0;
      g += (d / max(r, 1e-3)) * cos(x) * exp(-x * x * 0.3) * (1.0 - ph) * (1.0 - ph);
    }
  }
  return g;
}

void surfaceMain(inout Surf s) {
  vec2 xz = gP.xz;
  vec3 p2 = vec3(xz.x, 0.0, xz.y);
  vec4 mk = sBicubic(tGroundMask, (xz - uMaskRect.xy) * uMaskRect.zw, uMaskRes);
  // GROUND_DETAIL is defined only on a material that was given a level map. Everything that reads
  // the level's maps is inside such a block, so the plain ground compiles to what it always was.
  #ifdef GROUND_DETAIL
  vec2 duv = (xz - uGDetailRect.xy) * uGDetailRect.zw;
  vec4 dt = texture2D(tGDetail, duv);
  vec2 buv = (xz - uGBloodRect.xy) * uGBloodRect.zw;
  float bl = 0.0;
  if (buv.x > 0.0 && buv.x < 1.0 && buv.y > 0.0 && buv.y < 1.0) bl = textureLod(tGBlood, buv, log2(gFp * uGBloodRect.z * 1024.0)).r;
  #endif

  vec4 mo = sFbmD(p2, 0.55);
  float mott = mo.x;
  #if SURF_Q > 0
  vec4 fine = sFbmD(p2, 420.0);
  float hd = sFbm(S_ROT * p2 + 2.0, 9.0);        // a finer field: keeps shorelines and edges broken
  #else
  vec4 fine = vec4(0.5, 0.0, 0.0, 0.0);
  float hd = 0.5;
  #endif
  vec4 hn = sFbmD(p2 + 5.0, 1.1);

  #ifdef GROUND_DETAIL
  // ---- patch repairs: a newer, blacker, finer mix let into the old surface along a saw cut
  float pe = dt.b + (hd - 0.5) * 0.1 * step(0.02, dt.b);
  float repair = smoothstep(0.47, 0.53, pe);
  float cut = abs(pe - 0.5);                      // 1 unit = 16 cm across the cut
  float polish = dt.g;
  #endif

  // ---- aggregate: angular crushed stone, flat-topped and tilted, set in darker binder. One fetch
  // of the baked stone field (height, slope, tone); two unrelated slow fields hide its 0.75 m tile.
  // A patch reads the same field 1.8 times finer and from somewhere else.
  float fAgg = sFade(170.0);
  #ifdef GROUND_DETAIL
  float pk = step(0.5, pe);
  vec4 ag = texture2D(tAgg, xz * (AGG_UV * (1.0 + 0.8 * pk)) + pk * 0.37); // (the one-pixel mip slip along the cut is under the joint)
  #else
  vec4 ag = texture2D(tAgg, xz * AGG_UV);
  #endif
  float h1 = ag.r;
  vec2 g2 = (ag.gb - 0.5) * (2.0 * AGG_SLOPE) * fAgg;
  float micro = mix(0.5, h1, fAgg);

  float wear = clamp(mk.a + (mott - 0.5) * 0.4, 0.0, 1.0);
  #ifdef GROUND_DETAIL
  wear *= 1.0 - 0.4 * repair;
  #endif
  float expose = mix(0.55, 0.95, wear);
  vec3 binder = vec3(0.02, 0.02, 0.022);
  float tone = ag.a * ag.a;
  vec3 stoneCol = mix(0.035, 0.24, tone * tone + 0.15 * tone) * mix(vec3(1.0, 0.94, 0.86), vec3(0.86, 0.94, 1.06), smoothstep(0.3, 0.7, ag.a));
  vec3 alb = mix(binder, stoneCol, h1 * expose);
  alb = mix(mix(binder, vec3(0.085), 0.6 * expose), alb, fAgg);
  alb *= (0.75 + 0.5 * mott) * (0.7 + 0.6 * fine.x) * uGTint;
  float rough = mix(0.93, 0.8, wear) - h1 * 0.1 * wear * fAgg;
  // pitted stone faces, gritty binder
  g2 += fine.yw * 0.0009 * (1.0 - 0.4 * h1);
  #ifdef GROUND_DETAIL
  alb *= 1.0 - 0.1 * repair;
  rough -= 0.05 * repair;
  g2 *= 1.0 - 0.35 * repair;
  micro = mix(micro, 0.65 * micro, repair);
  // ---- wheel polish: where tyres run the stone tops are worn smooth and the binder is tight:
  // a little darker, a good deal smoother, flatter
  alb *= 1.0 - 0.45 * polish;
  rough -= 0.18 * polish;
  micro = mix(micro, 0.22, 0.65 * polish);
  g2 *= 1.0 - 0.45 * polish;
  #endif

  // ---- cracks
  float crack = 0.0;      // open crack: a dark line
  float tar = 0.0;        // tar poured over a crack or round a repair
  float ravel = 0.0;      // the crumbled, damper shoulder of a crack
  float H0 = 0.5;
  #ifdef GROUND_DETAIL
  H0 = hn.x;
  #endif
  #if SURF_Q > 0
  #ifdef GROUND_DETAIL
  {
    // authored: a coarse corridor says a crack is near and how strong; the offset map says exactly where
    float ca = dt.a * 255.0;
    float corr = abs(ca - 127.5) / 127.5;
    float fN = 1.0 - smoothstep(0.012, 0.035, gFp);            // near enough to resolve a line
    if (corr > 0.03) {
      float sealed = step(127.5, ca);
      float dv = (1.0 - corr) * 0.085;                         // far away: the corridor's own falloff will do
      if (fN > 0.0) {
        vec2 v = (textureLod(tGCrack, duv, 0.0).rg * 255.0 - 128.0) * (uGCrackRange / 127.0);
        dv = mix(dv, length(v), fN);
      }
      float st = smoothstep(0.03, 0.5, corr);
      // open: hairline at the tips to a few millimetres on the trunk, never even
      // (it opens and closes along its length with the metre-scale field, and frays with the fine one)
      float w = 0.0004 + 0.0036 * corr * smoothstep(0.3, 0.7, hn.x + (hd - 0.5) * 0.5) * (0.4 + 0.6 * fine.x);
      // (a line thinner than a pixel covers only its share of it)
      crack = (1.0 - smoothstep(w * 0.5, w + gFp * 0.8, dv)) * min(1.0, 2.5 * w / (w + gFp)) * (1.0 - sealed) * st * fN;
      ravel = (1.0 - smoothstep(0.003, 0.02 + 0.03 * hd, dv)) * st * (1.0 - 0.6 * sealed) * fN;
      // sealed: an over-banded ribbon of tar, a couple of centimetres wide, pooled in places
      float tw = 0.006 + 0.012 * smoothstep(0.3, 0.75, hd) + 0.004 * corr;
      tar = (1.0 - smoothstep(tw * 0.7, tw + gFp * 0.5, dv)) * min(1.0, 3.0 * tw / (tw + gFp)) * sealed * st * mix(smoothstep(0.75, 0.95, corr), 1.0, fN);
    }
    // the saw cut round a repair: tar along most of it, a bare joint where it was missed or has gone
    if (dt.b > 0.02) {
      float sealHere = smoothstep(0.47, 0.55, hn.x + (mott - 0.5) * 0.5);
      float tw = 0.05 + 0.1 * smoothstep(0.35, 0.7, hd);       // 0.8 to 2.4 cm either side
      tar = max(tar, (1.0 - smoothstep(tw * 0.65, tw + gFp * 4.0, cut)) * sealHere);
      crack = max(crack, (1.0 - smoothstep(0.004, 0.012 + gFp * 5.0, cut)) * min(1.0, 0.004 / (0.002 + gFp)) * (1.0 - sealHere) * smoothstep(0.4, 0.6, hd + mott - 0.5) * fN);
    }
  }
  #else
  {
    // no level map: the 0.5 contour of a slow field, only in the areas that have failed
    vec4 cw = sFbmD(p2 + 40.0, 0.3);
    H0 = cw.x;
    float cmask = smoothstep(0.45, 0.6, sFbm(p2 + 80.0, 0.12)) * sFade(110.0);
    if (cmask > 0.0) {
      // the stored field is smooth at this scale: a finer copy makes the line wander
      vec4 cd = sFbmD(p2 + 9.0, 2.6);
      vec4 cq = vec4(cw.x + (cd.x - 0.5) * 0.16, cw.yzw + cd.yzw * 0.16);
      float cwid = 0.0015 + 0.003 * fine.x;
      crack = (1.0 - smoothstep(cwid * 0.5, cwid + gFp, sIsoDist(cq))) * cmask;
    }
  }
  #endif
  #ifdef GROUND_DETAIL
  alb *= (1.0 - 0.65 * crack) * (1.0 - 0.14 * ravel);
  alb = mix(alb, vec3(0.02, 0.02, 0.021), 0.85 * tar);
  rough = mix(rough, 0.42, tar);
  micro = mix(micro, 0.12, tar);
  g2 *= 1.0 - 0.9 * tar;
  #else
  alb *= 1.0 - 0.7 * crack;
  #endif
  #endif

  // ---- painted markings and tyre marks
  float paint = 0.0; vec3 pcol = vec3(0.0); float skid = 0.0;
  float pw = -1.0;      // paint-wear field, fetched once and only near a marking
  float aa = gFp + 0.0015;
  for (int i = 0; i < NMARK; i++) {
    if (i >= uMarkCount) break;
    vec4 a = uMarkA[i], b = uMarkB[i];
    vec2 q = xz - a.xy;
    q = vec2(q.x * b.x + q.y * b.y, q.y * b.x - q.x * b.y);
    vec2 e = abs(q) - a.zw;
    float sd = max(e.x, e.y);
    if (sd > 0.05) continue;
    if (b.z > 3.5) {
      // an arrow along +x: a shaft, then a head tapering from the full width to the tip
      float hs = a.z * 0.05;
      sd = max(e.x, abs(q.y) - (q.x < hs ? a.w * 0.32 : a.w * (1.0 - (q.x - hs) / (a.z - hs))));
    }
    if (pw < 0.0) pw = clamp(0.5 + (sFbm(p2 + 15.0, 26.0) - 0.5) * 1.5, 0.0, 1.0);
    if (b.z > 1.5 && b.z < 2.5) {
      float tr = smoothstep(0.42, 0.58, abs(q.y) / a.w);
      float st = sNoise(vec3(q.x * 2.0, q.y * 90.0, float(i)), 90.0);
      float ends = 1.0 - smoothstep(0.4, 1.0, abs(q.x) / a.z);
      skid = max(skid, tr * ends * smoothstep(0.25, 0.7, st) * (1.0 - smoothstep(-0.02, 0.0, sd)) * (1.0 - b.w));
    } else {
      float m = 1.0 - smoothstep(-aa, aa, sd + (pw - 0.5) * 0.012);
      if (b.z > 2.5 && b.z < 3.5) m *= smoothstep(-aa * 1.6, aa * 1.6, abs(fract((q.x + q.y) * 1.6) - 0.5) - 0.25);
      // paint flakes off the stone tops first, and faster in the wheel lanes
      float th = b.w * (0.6 + 0.4 * wear);
      float keep = clamp((pw - 0.3) * 2.5, 0.0, 1.0) * 0.65 + mix(0.5, 1.0 - h1, fAgg) * 0.35;
      m *= smoothstep(th - 0.15, th + 0.05, keep);
      if (m > paint) { paint = m; pcol = b.z < 0.5 || b.z > 3.5 ? vec3(0.5, 0.5, 0.47) : vec3(0.5, 0.33, 0.02); }
    }
  }
  alb = mix(alb, pcol * (0.8 + 0.3 * mott), paint * 0.92);
  rough = mix(rough, 0.72, paint);
  g2 *= 1.0 - 0.5 * paint;
  alb *= 1.0 - 0.45 * skid;
  rough = mix(rough, 0.7, skid * 0.6);

  #ifdef GROUND_DETAIL
  // ---- stains. The level's map holds smooth hills; cutting them at three levels with fine noise
  // gives tide marks: a faint halo of dirt, the soak, and a dark core where the sump sat. Only the
  // soak and the core are oil; the film on them shows where they are wet (see the post block).
  // (most of the lot has none of this: each block runs only where its map says something is there)
  float oilMap = 0.0;
  if (dt.r > 0.012) {
    float sp = dt.r;
    float spn = sp + ((hd - 0.5) * 0.16 + (fine.x - 0.5) * 0.05) * smoothstep(0.02, 0.15, sp);
    float sHalo = smoothstep(0.03, 0.3, spn);
    float sBody = smoothstep(0.4, 0.47, spn);
    float sCore = smoothstep(0.7, 0.8, spn);
    // a tide mark is darkest along its own edge
    float sRim = sBody * (1.0 - smoothstep(0.47, 0.56, spn)) + 0.6 * sHalo * (1.0 - smoothstep(0.3, 0.4, spn)) * smoothstep(0.2, 0.3, spn);
    alb *= (1.0 - 0.36 * sHalo) * (1.0 - 0.45 * sBody) * (1.0 - 0.55 * sCore) * (1.0 - 0.25 * sRim);
    oilMap = clamp(0.55 * sBody + 0.45 * sCore, 0.0, 1.0);
  }
  #endif

  // ---- oil
  float oil = mk.b > 0.04 ? smoothstep(0.3, 0.75, mk.b + (H0 - 0.5) * 0.3 + (hd - 0.5) * 0.4) : 0.0;
  alb *= 1.0 - 0.5 * oil;
  #ifdef GROUND_DETAIL
  oil = max(oil, oilMap);
  micro = mix(micro, 0.3 * micro, 0.6 * oilMap);
  #endif
  rough = mix(rough, 0.55, oil * 0.7);

  // ---- water. H is the ground height in puddle units; the level rises with wetness.
  float Hn = hn.x + (hd - 0.5) * 0.12;
  #ifdef GROUND_DETAIL
  // a patch has settled or stands proud, a part at a time; tar stands a little proud; cracks hold water
  float H = mk.r + (Hn - 0.5) * 0.36 - crack * 0.12 + tar * 0.03
    + repair * (0.02 - 0.035 * smoothstep(0.5, 0.75, mott));
  #else
  float H = mk.r + (Hn - 0.5) * 0.36 - crack * 0.15;
  #endif

  float d = mix(0.12, 0.6, uWetness) + uGPuddle - H;
  float wetOn = step(0.001, uWetness);
  float dm = d + (0.5 - micro) * 0.05;                 // stones stand proud of the shoreline
  float water = smoothstep(0.0, 0.01 + gFp * 0.3, dm) * wetOn;
  float damp = clamp(uWetness * mk.g * 1.1, 0.0, 1.0);

  #ifdef GROUND_DETAIL
  // ---- blood lying on the surface: cut hard where it is thick, a thin wash round that the rain
  // is taking; where water stands over it most of it has gone into the water
  float blood = 0.0;
  if (bl > 0.012) {
    float blN = (bl + ((hd - 0.5) * 0.22 + (fine.x - 0.5) * 0.1) * smoothstep(0.02, 0.2, bl)) * (1.0 - 0.6 * water);
    // (dragged thin it stays in the hollows between the stones and is scraped off their tops)
    blood = smoothstep(0.3, 0.42, blN - 0.16 * (1.0 - smoothstep(0.55, 0.8, blN)) * smoothstep(0.35, 0.7, h1) * fAgg);
    float wash = smoothstep(0.04, 0.3, blN) * (1.0 - blood);
    alb = mix(alb, alb * vec3(0.8, 0.34, 0.3), 0.8 * wash);
    alb = mix(alb, vec3(0.03, 0.0025, 0.002) * (0.6 + 0.4 * h1), 0.94 * blood);
    rough = mix(rough, 0.3, 0.8 * blood);
    micro = mix(micro, 0.3 * micro, 0.7 * blood);
  }
  // on drier ground a wet tyre leaves a print: the stone tops it touched, damp; nothing in the hollows
  if (polish > 0.01) {
    float print = polish * (1.0 - damp) * mix(1.0, smoothstep(0.3, 0.62, h1 + (fine.x - 0.5) * 0.5), fAgg);
    damp = max(damp, min(damp + print * wetOn, 0.62));
  }
  damp = max(damp, ravel * 0.6 * uWetness);
  #endif
  // soaked next to standing water, and everywhere once the rain has been at it long enough
  float soak = max(smoothstep(-0.2, 0.0, d), smoothstep(0.5, 0.9, damp + (mott - 0.5) * 0.3)) * wetOn;
  damp = max(damp, soak);
  // one ramp, three stops
  alb = sSat(alb, 1.0 + 0.2 * damp) * mix(1.0, 0.6, damp);
  alb *= mix(1.0, 0.72, soak);
  alb *= mix(1.0, max(exp(-max(d, 0.0) * 9.0), 0.35), water);
  rough = mix(rough, rough * 0.78, damp);
  rough = mix(rough, mix(0.1, 0.42, micro) - 0.08 * oil, soak);
  rough = mix(rough, 0.02, water);
  g2 *= mix(1.0, 0.7, soak);
  vec2 rip = vec2(0.0);
  if (water > 0.001) {
    #if SURF_Q > 0
    float fR = sFade(150.0);
    if (fR > 0.0) rip = sRings(xz, uTime, uRain) * 0.3 * fR;
    #endif
    vec4 wv = sFbmD(vec3(xz + uTime * vec2(0.033, 0.022), uTime * 0.045), 9.0);
    rip += wv.yz * 0.0005 * (0.3 + uRain);
  }
  g2 = mix(g2, rip, water);

  gWater = water; gSoak = soak * (1.0 - water); gRip = rip;
  gOilFilm = oil * max(water, soak * 0.6);
  #ifdef GROUND_DETAIL
  gGloss = clamp(0.9 * polish + tar + 0.4 * repair + 0.5 * oilMap + blood, 0.0, 1.0);
  #endif
  gFilmN = hd + fine.x;
  s.albedo = alb; s.rough = rough; s.metal = 0.0;
  s.grad = vec3(g2.x, 0.0, g2.y);
}
`,
  post: /* glsl */ `
{
  float gNdvV = saturate(dot(normal, normalize(vViewPosition)));
  if (gOilFilm > 0.001) {
    // thin-film sheen: colour cycles with film thickness and view angle
    float th = gFilmN * 1.4 + gNdvV * 1.6;
    vec3 irid = 0.5 + 0.5 * cos(6.2832 * (th + vec3(0.0, 0.33, 0.67)));
    vec3 tint = mix(vec3(1.0), irid * 2.2, gOilFilm * 0.75);
    reflectedLight.directSpecular *= tint;
    reflectedLight.indirectSpecular *= tint;
  }
  float gReflM = uReflOn * max(gWater, gSoak * 0.6);
  if (gReflM > 0.001) {
    // Planar reflection. Standing water is a near-mirror: one sample, moved only by the ripple
    // normal. Soaked asphalt smears it down the screen: many taps at small steps, the whole column
    // shifted per pixel so the taps never line up into copies of what is reflected. The smear grows
    // with roughness and with distance along the ground.
    vec4 rc = uReflMatrix * vec4(gWp, 1.0);
    vec2 ruv = rc.xy / max(rc.w, 1e-4) + gRip * 0.02;
    vec4 acc;
    if (gWater > 0.98) {
      acc = texture2D(tReflection, ruv);
    } else {
      float reach = (1.0 - gWater) * (0.012 + 0.05 * roughnessFactor) * (0.6 + 0.4 * min(length(vViewPosition) * 0.1, 2.0));
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      acc = vec4(0.0); float wsum = 0.0;
      for (int k = 0; k < REFL_TAPS; k++) {
        float t = (float(k) + 0.5 + jit) / float(REFL_TAPS) * 2.0 - 1.0;
        float wk = 1.0 - 0.75 * t * t;
        // longer below the mirror point than above it, as a wet road draws a light out towards you
        acc += texture2D(tReflection, ruv + vec2(0.0, t * reach * (t < 0.0 ? 1.6 : 0.7))) * wk;
        wsum += wk;
      }
      acc /= wsum;
    }
    float fr = 0.02 + 0.98 * pow(1.0 - gNdvV, 5.0);
    // smoother ground (a polished track, tar, a newer patch, an oil soak) returns more of it
    vec3 planar = acc.rgb * 0.2 * fr * (1.0 + 0.8 * gGloss * (1.0 - gWater));
    // acc.a is how much of the mirror here is the lot (cars, canopy, walls) rather than open sky.
    // Things in the lot replace the sky reflection; where the mirror sees only sky the ground keeps
    // the environment's sky (as it has with the planar pass off) and gains the lamps' smear on top.
    // Replacing it outright made wet ground under open sky darker with the reflection on than off.
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, planar + reflectedLight.indirectSpecular * (1.0 - acc.a), gReflM);
  }
}
`,
};

// Seeded smooth 2D noise on the CPU for the mask.
function lattice(rng, n = 64) {
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  const at = (x, y) => v[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct = 4) => {
    let s = 0, a = 0.5, n2 = 0;
    for (let o = 0; o < oct; o++) { s += a * noise(x + o * 13.1, y + o * 7.7); n2 += a; a *= 0.5; x *= 2.03; y *= 2.03; }
    return s / n2;
  };
}

const boxFalloff = (x, z, b, soft) => {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const dx = x - b.x, dz = z - b.z;
  const lx = Math.abs(dx * c + dz * s) - b.hx, lz = Math.abs(dz * c - dx * s) - b.hz;
  const d = Math.max(lx, lz);
  const t = Math.min(1, Math.max(0, 1 - d / soft));
  return t * t * (3 - 2 * t);
};

// R puddle height (low = water collects), G dampness, B oil, A wear.
function buildMask(opts, rng) {
  const [minX, minZ, maxX, maxZ] = opts.bounds;
  const fbm = lattice(rng);
  const data = new Uint16Array(MASK_RES * MASK_RES * 4);
  const puddles = opts.puddles || [], oil = opts.oil || [], dry = opts.dry || [], lanes = opts.lanes || [];
  const pn = opts.puddleNoise ?? 1;
  for (let j = 0; j < MASK_RES; j++) {
    for (let i = 0; i < MASK_RES; i++) {
      const x = minX + ((i + 0.5) / MASK_RES) * (maxX - minX), z = minZ + ((j + 0.5) / MASK_RES) * (maxZ - minZ);
      let h = 0.78 + (fbm(x * 0.07, z * 0.07, 4) - 0.5) * 1.1 * pn;
      let damp = 0.7 + 0.3 * fbm(x * 0.11 + 40, z * 0.11, 3);
      let o = Math.max(0, fbm(x * 0.16 + 90, z * 0.16 + 20, 3) - 0.68) * 2.2;
      let w = 0.25 + 0.2 * fbm(x * 0.05 + 7, z * 0.05 + 70, 2);
      for (const p of puddles) {
        const dx = x - p.x, dz = z - p.z, r = p.r || 2;
        h -= (p.depth ?? 0.6) * Math.exp(-(dx * dx + dz * dz) / (r * r));
      }
      for (const p of oil) {
        const dx = x - p.x, dz = z - p.z, r = p.r || 1;
        o += (p.amount ?? 0.9) * Math.exp(-(dx * dx + dz * dz) / (r * r));
      }
      for (const b of lanes) w = Math.max(w, (b.amount ?? 0.85) * boxFalloff(x, z, b, 1.2));
      for (const b of dry) {
        const t = boxFalloff(x, z, b, b.soft ?? 2.5);
        h += t * 0.9; damp *= 1 - t * (b.amount ?? 0.9);
      }
      const k = (j * MASK_RES + i) * 4;
      data[k] = DataUtils.toHalfFloat(h);
      data[k + 1] = DataUtils.toHalfFloat(Math.min(1, Math.max(0, damp)));
      data[k + 2] = DataUtils.toHalfFloat(Math.min(1, o));
      data[k + 3] = DataUtils.toHalfFloat(Math.min(1, w));
    }
  }
  const tex = new DataTexture(data, MASK_RES, MASK_RES, RGBAFormat, HalfFloatType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const MARK_KIND = { white: 0, yellow: 1, skid: 2, hatch: 3, arrow: 4 };

// opts:
//   bounds [minX, minZ, maxX, maxZ]  area the mask covers (default 140 m square on the origin)
//   puddles [{x, z, r, depth}]       extra low spots;  puddleNoise 0..1 scales the random ones
//   oil [{x, z, r, amount}]          oil stains (put these at the pumps)
//   lanes [{x, z, hx, hz, rot, amount}]  wheel-polished strips
//   dry [{x, z, hx, hz, rot, soft, amount}]  sheltered rectangles (under the canopy)
//   marks [{x, z, length, width, rot, kind:'white'|'yellow'|'skid'|'hatch'|'arrow', wear 0..1}]  max 32
//     (rot turns the mark's own +x from world +x toward +z; an arrow points along its +x and is `width` across the head)
//   tint (colour multiplier), puddle (level bias, + = more water)
//   detail { map, crackMap, rect: [minX, minZ, maxX, maxZ], crackRange, bloodMap, bloodRect }  the level's own history of
//     the surface (see the header and src/level/groundMask.js for the channels). map: RGBA8,
//     linear, mip-mapped, clamped, neutral (0, 0, 0, 0.5) along its border. crackMap: RG8, linear,
//     no mips. Without it the surface has no stains, tracks or patches and cracks are procedural.
//     Optional bloodMap (R8, linear, mip-mapped, clamped, zero along its border) over bloodRect.
let neutralDetail = null;
function neutral() {
  if (!neutralDetail) {
    const mk = (px) => { const t = new DataTexture(new Uint8Array(px), 1, 1, RGBAFormat, UnsignedByteType); t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.needsUpdate = true; return t; };
    neutralDetail = { map: mk([0, 0, 0, 127]), crackMap: mk([255, 255, 0, 0]) };
  }
  return neutralDetail;
}

export function makeGround(opts, ctx) {
  const bounds = opts.bounds || [-70, -70, 70, 70];
  const detail = opts.detail && opts.detail.map && opts.detail.crackMap ? opts.detail : null;
  const blood = !!(detail && detail.bloodMap && detail.bloodRect);
  const mask = buildMask({ ...opts, bounds }, ctx.rng.fork('groundMask'));
  const A = [], B = [];
  const marks = (opts.marks || []).slice(0, GROUND_MAX_MARKS);
  for (let i = 0; i < GROUND_MAX_MARKS; i++) {
    const m = marks[i];
    if (!m) { A.push(new Vector4()); B.push(new Vector4(1, 0, 0, 0)); continue; }
    const rot = m.rot || 0;
    A.push(new Vector4(m.x, m.z, (m.length ?? 1) / 2, (m.width ?? 0.12) / 2));
    B.push(new Vector4(Math.cos(rot), Math.sin(rot), MARK_KIND[m.kind] ?? 0, m.wear ?? 0.35));
  }
  const mat = ctx.build(groundDef, { ...opts, space: 'world', splash: 0 }, {
    tGroundMask: { value: mask },
    tAgg: { value: ctx.noise.tAgg },
    uMaskRect: { value: new Vector4(bounds[0], bounds[1], 1 / (bounds[2] - bounds[0]), 1 / (bounds[3] - bounds[1])) },
    uMaskRes: { value: MASK_RES },
    tGDetail: { value: detail ? detail.map : neutral().map },
    tGCrack: { value: detail ? detail.crackMap : neutral().crackMap },
    uGDetailRect: { value: detail ? new Vector4(detail.rect[0], detail.rect[1], 1 / (detail.rect[2] - detail.rect[0]), 1 / (detail.rect[3] - detail.rect[1])) : new Vector4(0, 0, 1, 1) },
    uGCrackRange: { value: detail ? detail.crackRange ?? 0.06 : 0.06 },
    tGBlood: { value: blood ? detail.bloodMap : neutral().map },
    uGBloodRect: { value: blood ? new Vector4(detail.bloodRect[0], detail.bloodRect[1], 1 / (detail.bloodRect[2] - detail.bloodRect[0]), 1 / (detail.bloodRect[3] - detail.bloodRect[1])) : new Vector4(0, 0, 0, 0) },
    uReflMatrix: { value: new Matrix4() },
    tReflection: { value: null },
    uReflOn: { value: 0 },
    uMarkA: { value: A },
    uMarkB: { value: B },
    uMarkCount: { value: marks.length },
    uGTint: { value: ctx.toColor(opts.tint, 0xffffff) },
    uGPuddle: { value: opts.puddle ?? 0 },
  });
  if (detail) mat.defines.GROUND_DETAIL = 1; // its own program: the plain ground pays nothing for the level's maps
  mat.addEventListener('dispose', () => mask.dispose());
  return mat;
}
