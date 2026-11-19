// Painted sheet metal (pumps, canopy fascia, cars, signs, bollards): paint with orange peel and
// chalking, scratches, chips through primer to steel, oxide halo creeping under the paint edge,
// rust runs hanging below chip clusters, a dirt film the rain washes in streaks, then water.

const paintedMetalDef = {
  kind: 'paintedMetal',
  glsl: /* glsl */ `
uniform vec3 uPColor;
uniform float uPWear;
uniform float uPRust;
uniform float uPRough;
uniform float uPDirt;
void surfaceMain(inout Surf s) {
  vec3 p = gP;
  float side = 1.0 - smoothstep(0.3, 0.8, abs(gN.y));
  Chip k = sChips(p, uPWear, 1.0);

  // paint body. 'dn' is the slow field shared by chalking, dirt and the water film.
  float dn = sFbm(p + 9.0, 2.4);
  #if SURF_Q > 0
  vec4 rn = sFbmD(p + 77.0, 90.0);
  #else
  vec4 rn = vec4(0.5, 0.0, 0.0, 0.0);
  #endif
  float chalk = 1.0 - dn;
  vec3 paint = uPColor * (0.86 + 0.28 * chalk);
  paint = mix(paint, sSat(paint, 0.6) * 1.15 + 0.02, smoothstep(0.55, 0.9, chalk) * uPWear * 0.6);
  float rough = uPRough + 0.25 * uPWear * chalk;
  // orange peel: the fine field again at four times the scale
  vec3 g = rn.yzw * 0.00002;

  // scratches: straight hairlines, mostly along the length of the panel, some across
  float scr = 0.0;
  #if SURF_Q > 0
  // (one family of hairlines; which way they run changes from patch to patch)
  scr = sScratches(p + 3.0, dn > 0.5 ? vec3(0.95, 0.114, 0.285) : vec3(0.52, 0.83, -0.21), 2200.0, 34.0, 0.3);
  #endif
  scr *= smoothstep(0.35, 0.7, 0.5 + (rn.x - 0.5) * 0.6 + (dn - 0.5) * 0.8) * min(uPWear * 2.0, 1.0);
  paint = mix(paint, paint * 1.6 + 0.06, scr * 0.5);
  rough += scr * 0.25;

  // what is under the paint
  vec3 rustC = mix(vec3(0.16, 0.05, 0.015), vec3(0.34, 0.13, 0.03), rn.x) * (0.6 + 0.8 * dn);
  float rusted = smoothstep(0.1, 0.45, uPRust + (dn - 0.5) * 0.5 + (rn.x - 0.5) * 0.3);
  vec3 bare = mix(vec3(0.3, 0.3, 0.31), rustC, rusted);

  // oxide halo: rust under the paint edge stains and blisters it
  float halo = k.halo * (1.0 - k.primer) * rusted;
  paint = mix(paint, rustC * 1.1, halo * 0.55 * sqrt(uPRust));
  g += rn.yzw * 0.0006 * halo;

  // rust runs and rain-washed streaks share one vertical-streak fetch
  float lines = side > 0.01 ? sNoise(vec3(p.x * 34.0, p.y * 0.9, p.z * 34.0), 34.0) : 0.5;
  float run = 0.0;
  #if SURF_Q > 0
  if (side > 0.01 && uPRust > 0.0 && uPWear > 0.0) {
    // look up the face for chip clusters, hang streaks beneath them
    float th = sChipTh(uPWear);
    float a = smoothstep(th - 0.05, th + 0.03, gChipLo * 0.42 + sFbm(S_ROT * (p + vec3(0.0, 0.09, 0.0)), 13.0) * 0.58);
    run = a * smoothstep(0.3, 0.65, lines) * side * sqrt(uPRust);
  }
  #endif
  paint = mix(paint, mix(paint, vec3(0.6, 0.3, 0.12), 0.5) * vec3(0.6, 0.36, 0.2), run * 0.85);
  rough += run * 0.25;

  // compose the layers
  vec3 alb = mix(paint, vec3(0.2, 0.19, 0.185), k.primer);
  alb = mix(alb, bare, k.bare);
  float metal = k.bare * (1.0 - rusted);
  rough = mix(rough, 0.7, k.primer);
  rough = mix(rough, mix(0.35, 0.92, rusted), k.bare);
  g += k.grad + rn.yzw * 0.0012 * k.bare * rusted;

  // dirt film: settles on up-faces and low down; rain washes clean streaks down the sides
  float dirt = uPDirt * clamp(dn * 1.2 - 0.25 + 0.5 * smoothstep(0.2, 0.9, gNw.y) + sSplashBand() * 0.9
    - side * 0.35 * smoothstep(0.5, 0.8, 1.0 - lines), 0.0, 1.0);
  alb = mix(alb, vec3(0.07, 0.06, 0.05), dirt * 0.7);
  rough = mix(rough, 0.92, dirt * 0.8);
  metal *= 1.0 - dirt;

  s.albedo = alb; s.rough = clamp(rough, 0.05, 1.0); s.metal = metal; s.grad = g;
  float w = sWetAmount();
  sWetHard(s, w, dn);
  s.albedo *= 1.0 - 0.35 * w * max(dirt, k.bare * rusted);
}
`,
};

// opts: color, wear 0..1 (chips, scratches, chalking), rust 0..1 (how far exposed steel has gone,
// halo and runs), roughness (fresh paint gloss, default 0.3), dirt 0..1, plus the common options.
export function makePaintedMetal(opts, ctx) {
  return ctx.build(paintedMetalDef, opts, {
    uPColor: { value: ctx.toColor(opts.color, 0xa01c14) },
    uPWear: { value: opts.wear ?? 0.4 },
    uPRust: { value: opts.rust ?? 0.4 },
    uPRough: { value: opts.roughness ?? 0.3 },
    uPDirt: { value: opts.dirt ?? 0.6 },
  });
}
