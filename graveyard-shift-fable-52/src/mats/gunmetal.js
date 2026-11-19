// Weapon metal and polymer by finish. Sampled in object/rest space (never swims on the viewmodel).
//   phosphate: matte charcoal conversion coating with crystalline grain, wearing to bright steel
//   bare:      brushed steel, temper tint and tarnish
//   polymer:   moulded pebble grain with studded grip zones, scuffing paler and shinier
//   blued:     polished blue-black oxide over steel, thinning to plum and then bright on edges
//   wood:      oiled walnut, grain along brushDir, handling wear paler and drier, dents darker
// All take edge wear (from curvature and the baked aSurf.x mask) and finger oil.
import { Vector3 } from 'three';

const FINISH = { phosphate: 0, bare: 1, polymer: 2, blued: 3, wood: 4 };
const MAX_GRIPS = 4;

const gunmetalDef = {
  kind: 'gunmetal',
  space: 'object',
  splash: 0,
  glsl: /* glsl */ `
uniform float uGFinish;
uniform float uGWear;
uniform float uGOil;
uniform float uGStud;
uniform vec3 uGBrush;
uniform vec3 uGPoly;
uniform vec3 uGripMin[${MAX_GRIPS}];
uniform vec3 uGripMax[${MAX_GRIPS}];
uniform int uGripCount;
void surfaceMain(inout Surf s) {
  vec3 p = gP;
  // convex edges: signed curvature from screen derivatives (1/m), plus the baked mask
  vec3 dpx = dFdx(vSP), dpy = dFdy(vSP), dnx = dFdx(gN), dny = dFdy(gN);
  float curv = (dot(dnx, dpx) + dot(dny, dpy)) / max(dot(dpx, dpx) + dot(dpy, dpy), 1e-12);
  float edge = clamp(smoothstep(120.0, 700.0, curv) + gA.x, 0.0, 1.0);

  vec4 wn = sFbmD(p + 19.0, 55.0);
  #if SURF_Q > 0
  vec4 wl = sFbmD(S_ROT * p + 3.0, 9.0);
  #else
  vec4 wl = wn.xzwy;
  #endif
  vec3 bd = normalize(uGBrush);

  // wear: edges first, then patches across the flats. Handling scratches pull the wear boundary
  // out into hairlines.
  float hair = 0.0;
  #if SURF_Q > 0
  hair = sScratches(p + 5.0, normalize(bd + vec3(0.15, 0.3, 0.0)), 2400.0, 30.0, 0.3);
  #endif
  #if SURF_Q > 1
  hair = max(hair, sScratches(p + 11.0, normalize(vec3(0.3, 1.0, 0.2)), 2400.0, 45.0, 0.22));
  #endif
  bool blued = uGFinish > 2.5 && uGFinish < 3.5;
  // bluing thins in patches along an edge, not as an even bright line
  float edgeK = blued ? 0.75 * smoothstep(0.42, 0.72, wn.x * 0.55 + wl.x * 0.45) : 0.7;
  float field = wn.x * 0.55 + wl.x * 0.45 + edge * edgeK + hair * 0.16;
  float th = mix(1.05, 0.5, uGWear);
  float worn = smoothstep(th, th + 0.025, field);

  // brushed grain: the fbm field squeezed along the brush direction. Two widths of line, so the
  // grain reads at arm's length and still resolves against the eye. Only where steel shows.
  float fB = sFade(900.0);
  float br = 0.5; vec3 brG = vec3(0.0);
  bool steelShows = (uGFinish < 1.5 && (uGFinish > 0.5 || worn > 0.0)) || (blued && worn > 0.0);
  #if SURF_Q < 1
  steelShows = false;
  #endif
  if (fB > 0.0 && steelShows) {
    vec4 b1 = sAnisoD(p, bd, 900.0, 20.0);
    br = b1.x; brG = b1.yzw * 2.2;
    #if SURF_Q > 1
    float f2 = sFade(2600.0);
    if (f2 > 0.0) {
      vec4 b2 = sAnisoD(p + 7.0, bd, 2600.0, 45.0);
      br = b1.x * 0.6 + b2.x * 0.4; brG += b2.yzw * f2;
    }
    #endif
    br = mix(0.5, br, fB); brG *= fB;
  }
  vec3 steel = vec3(0.55, 0.56, 0.58);
  vec3 alb; float rough; float metal; vec3 g = vec3(0.0);

  if (uGFinish < 0.5) {
    #if SURF_Q > 0
    vec4 mg = sFbmD(p, 650.0);
    #else
    vec4 mg = vec4(0.5, 0.0, 0.0, 0.0);
    #endif
    alb = vec3(0.075, 0.078, 0.082) * (0.8 + 0.4 * wl.x) * mix(vec3(1.0), vec3(0.92, 1.0, 0.95), wn.x) * (0.85 + 0.3 * mg.x);
    rough = 0.66 + 0.12 * mg.x; metal = 0.55;
    g += mg.yzw * 0.00012;
  } else if (uGFinish < 1.5) {
    alb = steel * (0.82 + 0.25 * wl.x);
    rough = 0.26 + 0.16 * br + 0.08 * (1.0 - fB); metal = 1.0;
    g += brG * 0.0000035;
    alb *= mix(vec3(1.0), vec3(0.8, 0.86, 1.0), smoothstep(0.5, 0.8, wn.x) * 0.5);
    float tarn = smoothstep(0.55, 0.8, wl.x) * (0.3 + uGWear);
    alb = mix(alb, vec3(0.2, 0.15, 0.1), tarn * 0.5);
    rough += tarn * 0.2;
  } else if (blued) {
    // the oxide is a few wavelengths thick: blue-black where it is whole, plum where hands have thinned it
    alb = vec3(0.05, 0.06, 0.09) * (0.75 + 0.5 * wl.x);
    alb = mix(alb, vec3(0.05, 0.03, 0.036), smoothstep(0.45, 0.8, wn.x) * (0.25 + 0.5 * uGWear));
    rough = 0.2 + 0.1 * wn.x; metal = 0.9;
  } else if (uGFinish > 3.5) {
    // walnut: wavy growth bands across the grain, open pores along it
    // walnut cut at a shallow angle to its growth rings: wide bands that wander and close into
    // cathedral figure, narrow dark latewood lines at their edges, long slow streaks along the
    // grain, the colour drifting redder and yellower; the pores are short dark ticks, not stripes
    vec3 across = normalize(cross(bd, vec3(0.31, 0.9, 0.2)));
    vec3 up2 = cross(bd, across);
    vec4 lw = sAnisoD(p, bd, 60.0, 7.0);
    float ph = dot(p, across) * 210.0 + dot(p, up2) * 95.0 + (lw.x - 0.5) * 24.0 + (wl.x - 0.5) * 18.0;
    float ring = 0.5 + 0.5 * sin(ph);
    float late = smoothstep(0.62, 0.97, ring);
    #if SURF_Q > 0
    vec4 po = sAnisoD(p + 3.0, bd, 1700.0, 40.0);
    #else
    vec4 po = vec4(0.5, 0.0, 0.0, 0.0);
    #endif
    float fig = 0.3 + 0.7 * (0.62 * (1.0 - late) + 0.38 * lw.x);
    alb = mix(uGPoly * 0.3, uGPoly, fig);
    alb *= mix(vec3(0.94, 1.0, 1.04), vec3(1.14, 0.95, 0.8), wn.x);
    alb *= 0.93 + 0.14 * po.x;
    alb = mix(alb, uGPoly * 0.2, smoothstep(0.74, 0.83, po.x) * 0.4 * sFade(1700.0));
    rough = 0.32 + 0.18 * po.x + 0.12 * late; metal = 0.0;
    g += po.yzw * 0.00003;
  } else {
    #if SURF_Q > 0
    vec4 pb = sFbmD(p + 8.0, 500.0);
    #else
    vec4 pb = vec4(0.5, 0.0, 0.0, 0.0);
    #endif
    alb = uGPoly * (0.9 + 0.2 * wl.x);
    rough = 0.58; metal = 0.0;
    g += pb.yzw * 0.0001;
    // studded grip zones: baked mask or rest-space boxes
    float zone = gA.z;
    vec3 pr = p - uSeedOff;
    for (int i = 0; i < ${MAX_GRIPS}; i++) {
      if (i >= uGripCount) break;
      vec3 e = abs(pr - (uGripMin[i] + uGripMax[i]) * 0.5) - (uGripMax[i] - uGripMin[i]) * 0.5;
      zone = max(zone, 1.0 - smoothstep(-0.0015, 0.0005, max(e.x, max(e.y, e.z))));
    }
    float fS = sFade(1.0 / uGStud);
    if (zone * fS > 0.001) {
      vec3 an = abs(gN); vec2 uv; vec3 U; vec3 V;
      if (an.x > an.y && an.x > an.z) { uv = pr.zy; U = vec3(0.0, 0.0, 1.0); V = vec3(0.0, 1.0, 0.0); }
      else if (an.y > an.z) { uv = pr.xz; U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 0.0, 1.0); }
      else { uv = pr.xy; U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 1.0, 0.0); }
      vec2 c = uv / uGStud;
      c.x += 0.5 * mod(floor(c.y), 2.0);
      vec2 f = fract(c) - 0.5;
      float r = length(f);
      float t = clamp((r - 0.2) / 0.22, 0.0, 1.0);
      float stud = 1.0 - t * t * (3.0 - 2.0 * t);
      vec2 sl = (f / max(r, 1e-4)) * (-6.0 * t * (1.0 - t) / 0.22) * (0.0005 / uGStud);
      float k = zone * fS;
      g = g * (1.0 - 0.6 * k) + (U * sl.x + V * sl.y) * k;
      rough = mix(rough, 0.5, stud * k * 0.4);
      alb *= 1.0 + 0.25 * stud * k;
    }
    rough = mix(rough, 0.52, zone * (1.0 - fS));
  }

  if (uGFinish < 1.5 || blued) {
    alb = mix(alb, steel * (0.9 + 0.2 * br), worn);
    metal = mix(metal, 1.0, worn);
    rough = mix(rough, 0.24 + 0.1 * br, worn);
    g = mix(g, brG * 0.000004, worn);
    float rim = smoothstep(th - 0.07, th, field) * (1.0 - worn) * step(uGFinish, 0.5);
    alb = mix(alb, vec3(0.1, 0.075, 0.055), rim * 0.5);
    if (blued) alb = mix(alb, vec3(0.09, 0.06, 0.07), smoothstep(th - 0.1, th, field) * (1.0 - worn) * 0.6);
  } else if (uGFinish > 3.5) {
    // bare, dry wood where the oil has been handled off; dents hold dirt
    alb = mix(alb, uGPoly * 1.25 + 0.03, worn * 0.55);
    rough = mix(rough, 0.72, worn);
    alb *= 1.0 - 0.5 * smoothstep(0.72, 0.8, wn.x * 0.6 + wl.x * 0.5);
  } else {
    alb = mix(alb, vec3(0.085, 0.085, 0.09), worn * 0.7);
    rough = mix(rough, 0.4, worn);
  }

  // finger oil: smeared glossy patches carrying a faint ridge print
  float oil = uGOil * smoothstep(0.58, 0.76, (1.0 - wn.x) * 0.7 + wl.x * 0.55);
  float ridges = 0.5 + 0.5 * sin((p.x + p.y * 0.6 + wn.x * 0.012) * 13823.0);
  float print = oil * (0.6 + 0.4 * ridges * sFade(4400.0));
  rough = mix(rough, rough * 0.45, print);
  alb *= 1.0 - 0.15 * oil;

  s.albedo = alb; s.rough = rough; s.metal = metal; s.grad = g;
  sWetHard(s, sWetAmount() * 0.8, wl.x);
}
`,
};

// opts: finish 'phosphate'|'bare'|'polymer'|'blued'|'wood' (wood: color = the pale grain colour), wear 0..1, oil 0..1, brushDir [x,y,z] (rest space,
// default along z = the barrel), color (polymer body colour), studPitch (metres, default 2.5 mm),
// gripZones [{min:[x,y,z], max:[x,y,z]}] (rest space, max 4; polymer only), plus the common options.
// Default space is 'object'; use space:'rest' with G.mats.bakeRest for multi-part models.
export function makeGunmetal(opts, ctx) {
  const zones = (opts.gripZones || []).slice(0, MAX_GRIPS);
  const mins = [], maxs = [];
  for (let i = 0; i < MAX_GRIPS; i++) {
    mins.push(new Vector3(...(zones[i] ? zones[i].min : [0, 0, 0])));
    maxs.push(new Vector3(...(zones[i] ? zones[i].max : [0, 0, 0])));
  }
  return ctx.build(gunmetalDef, opts, {
    uGFinish: { value: FINISH[opts.finish] ?? 0 },
    uGWear: { value: opts.wear ?? 0.45 },
    uGOil: { value: opts.oil ?? 0.4 },
    uGStud: { value: opts.studPitch ?? 0.0025 },
    uGBrush: { value: new Vector3(...(opts.brushDir || [0, 0, 1])) },
    uGPoly: { value: ctx.toColor(opts.color, 0x2c2c2e) },
    uGripMin: { value: mins },
    uGripMax: { value: maxs },
    uGripCount: { value: zones.length },
  });
}
