// Window glass in the rain. Alpha-blended (no transmission pass): reflections are added at full
// strength over the background, the body only dims it. Running drops with wiped trails, static
// beads, mist that the trails clear, and a dirt film that is heavier low down.
import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation, DoubleSide } from 'three';

const glassDef = {
  kind: 'glass',
  glsl: /* glsl */ `
uniform vec3 uGlTint;
uniform float uGlOpacity;
uniform float uGlDirt;
uniform float uGlMist;
#if SURF_Q > 0
  #define DROP_LAYERS 2
#else
  #define DROP_LAYERS 1
#endif

// Drops running down a pane. uv in metres, y up the slope.
// x = drop coverage, y = wiped-trail coverage, zw = slope of the water surface in uv.
vec4 sDrops(vec2 uv, float t, float amount) {
  vec4 o = vec4(0.0);
  for (int L = 0; L < DROP_LAYERS; L++) {
    float sc = L == 0 ? 1.0 : 0.55;
    vec2 q = uv / (vec2(0.032, 0.13) * sc) + float(L) * 7.7;
    float col = floor(q.x);
    vec3 hc = sHash3(ivec3(int(col), L, 11));
    float sp = 0.3 + 0.7 * hc.y;
    float tt = t * sp;
    q.y += hc.x * 9.0 + tt + 0.3 * sin(tt * 6.2832 + hc.z * 6.0);   // stick, then run
    vec2 ci = floor(q); vec2 f = fract(q);
    vec3 h = sHash3(ivec3(int(ci.x), int(ci.y), L + 20));
    if (fract(h.z * 3.1 + h.x) > amount) continue;
    float cx = 0.5 + (h.x - 0.5) * 0.45 + 0.07 * sin(q.y * 5.0 + h.y * 6.0);
    float r0 = 0.11 + 0.07 * h.y;
    vec2 d = vec2(f.x - cx, (f.y - 0.22) * 4.0);         // cell is 4x taller than wide
    float tdrop = 1.0 - dot(d, d) / (r0 * r0);
    float dx = abs(f.x - cx);
    float above = step(0.22, f.y);
    float trail = (1.0 - smoothstep(r0 * 0.35, r0 * 0.8, dx)) * above * (1.0 - smoothstep(0.3, 1.0, f.y));
    // beads left behind in the trail
    vec2 bd = vec2(f.x - cx, (fract(f.y * 7.0 + h.x) - 0.5) / 7.0 * 4.0);
    float br = r0 * 0.38;
    float tb = (1.0 - dot(bd, bd) / (br * br)) * above * (1.0 - smoothstep(0.35, 0.95, f.y));
    if (tdrop > 0.0) { o.x = max(o.x, smoothstep(0.0, 0.3, tdrop)); o.zw += -2.6 * tdrop * d / r0; }
    else if (tb > 0.0) { o.x = max(o.x, smoothstep(0.0, 0.3, tb) * 0.8); o.zw += -2.2 * tb * bd / br; }
    o.y = max(o.y, trail);
  }
  return o;
}

void surfaceMain(inout Surf s) {
  vec3 p = gP;
  vec3 T = cross(vec3(0.0, 1.0, 0.0), gN);
  float tl = length(T);
  float slope = smoothstep(0.05, 0.3, tl);
  T = tl > 1e-3 ? T / tl : vec3(1.0, 0.0, 0.0);
  vec3 B = cross(gN, T);
  vec2 uv = vec2(dot(p, T), dot(p, B));
  float w = sWetAmount();
  // the drops themselves stop resolving long before the tracks they wipe through the mist do
  float fD = sFade(250.0) * slope, fT = sFade(45.0) * slope;
  vec4 dr = (fT > 0.0 && w > 0.01) ? sDrops(uv, uTime, 0.8 * w * (0.35 + 0.65 * uRain)) * vec4(fD, fT, fD, fD) : vec4(0.0);
  float f1 = sFade(380.0);
  float drop = dr.x;
  #if SURF_Q > 0
  if (f1 > 0.0 && w > 0.01) drop = max(drop, sBeadLayer(p, 190.0, 0.6 * w, 0.9) * f1 * (1.0 - dr.y));
  #endif
  #if SURF_Q > 1
  if (sFade(1040.0) > 0.0 && w > 0.01) drop = max(drop, sBeadLayer(p + 5.0, 520.0, 0.7 * w, 0.9) * (1.0 - dr.y));
  #endif

  vec4 dv = sFbmD(p + 9.0, 3.0);
  float dn = dv.x;
  #if SURF_Q > 0
  float washed = sNoise(vec3(uv.x * 40.0, uv.y * 0.8, 3.0), 40.0);
  #else
  float washed = 0.5;
  #endif
  float dirt = uGlDirt * clamp(dn * 1.1 - 0.2 + sSplashBand() * 0.8 - 0.3 * smoothstep(0.5, 0.8, washed) * w, 0.0, 1.0);
  float mist = uGlMist * (0.6 + 0.4 * (1.0 - dn)) * (1.0 - 0.9 * dr.y) * (1.0 - drop);
  float film = clamp(dirt * 0.5 + mist * 0.45, 0.0, 1.0);

  s.albedo = mix(uGlTint * 0.5, vec3(0.2, 0.19, 0.17), dirt);
  s.albedo = mix(s.albedo, vec3(0.45, 0.47, 0.5), mist * (1.0 - dirt));
  s.rough = mix(mix(0.03, 0.5, film), 0.04, drop);
  // far away the drops stop resolving: keep their sparkle as a little roughness
  s.rough = max(s.rough, 0.12 * w * (1.0 - f1));
  s.metal = 0.0;
  s.grad = T * dr.z + B * dr.w;
  s.alpha = clamp(uGlOpacity + film * 0.8 + drop * 0.1, 0.0, 1.0);
}
`,
  // premultiplied output: body light scaled by alpha, reflections whole; fresnel adds coverage
  out: /* glsl */ `
{
  // coverage from the fresnel of the pane itself, not of each bead's rim (those would go opaque)
  float gFr = 0.04 + 0.96 * pow(1.0 - gNdv, 5.0);
  float gAl = diffuseColor.a;
  gl_FragColor = vec4(totalDiffuse * gAl + totalSpecular + totalEmissiveRadiance, clamp(gAl + gFr * (1.0 - gAl), 0.0, 1.0));
}
`,
};

// opts: tint (body colour), opacity (clean-glass alpha, default 0.1), dirt 0..1, mist 0..1
// (condensation; running drops wipe it), plus the common options. Double-sided by default.
export function makeGlass(opts, ctx) {
  return ctx.build(glassDef, { side: DoubleSide, ...opts }, {
    uGlTint: { value: ctx.toColor(opts.tint, 0x9fb8b0) },
    uGlOpacity: { value: opts.opacity ?? 0.1 },
    uGlDirt: { value: opts.dirt ?? 0.4 },
    uGlMist: { value: opts.mist ?? 0.4 },
  }, {
    transparent: true, depthWrite: false, forceSinglePass: true,
    blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
  });
}
