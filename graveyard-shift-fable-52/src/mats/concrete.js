// Cast concrete: tonal blotches, sand grain, bug holes, hairline cracks, formwork seams, leaching
// streaks, efflorescence, grime where it meets the ground, optional flaking paint (kerbs, bollards).
// Porous: rain soaks in and darkens it, and pools on flat tops.
import { Vector2 } from 'three';

const concreteDef = {
  kind: 'concrete',
  glsl: /* glsl */ `
uniform vec3 uCColor;
uniform vec3 uCPaint;
uniform float uCAge;
uniform float uCPaintAmt;
uniform float uCPaintWear;
uniform vec2 uCPanel;
void surfaceMain(inout Surf s) {
  vec3 p = gP;
  float side = 1.0 - smoothstep(0.3, 0.8, abs(gN.y));
  float blotch = sFbm(p, 0.7);
  #if SURF_Q > 0
  vec4 grain = sFbmD(p, 220.0);
  #else
  vec4 grain = vec4(0.5, 0.0, 0.0, 0.0);
  #endif
  vec4 mid = sFbmD(S_ROT * p + 7.0, 18.0);
  mid.yzw = mid.yzw * S_ROT;
  vec3 alb = uCColor * (0.6 + 0.8 * blotch) * (0.8 + 0.4 * grain.x);
  alb *= 0.82 + 0.36 * mid.x;
  float rough = 0.9 - 0.08 * mid.x;
  vec3 g = grain.yzw * 0.0006 + mid.yzw * 0.0012;

  // bug holes left by air against the formwork (many small, a few large), and sand grains showing
  // through the paste: both from one voronoi fetch
  float fH = sFade(180.0);
  float hole = 0.0;
  #if SURF_Q < 1
  fH = 0.0;
  #endif
  if (fH > 0.0) {
    vec4 v = sVoro(p, 90.0);
    float rad = 0.07 + 0.24 * v.z * v.z;
    float present = 1.0 - smoothstep(0.3 + 0.3 * uCAge, 0.36 + 0.3 * uCAge, fract(v.z * 3.0));
    hole = (1.0 - smoothstep(rad * 0.6, rad, v.x)) * present * fH;
    alb *= 1.0 - 0.4 * hole;
    gHt -= hole * rad * (0.6 / 90.0);
  }
  #if SURF_Q > 1
  float fS = sFade(760.0);
  if (fS > 0.0) {
    vec4 sd = sDomes(p + 3.0, 380.0, 0.5);
    alb *= 1.0 + sd.x * (sd.w > 0.5 ? 0.45 : -0.4) * fS;
  }
  #endif

  // hairline cracks
  float crack = 0.0;
  #if SURF_Q > 0
  float fCr = sFade(300.0);
  float cm = smoothstep(0.5, 0.65, blotch + uCAge * 0.25) * fCr;
  if (cm > 0.0) {
    vec4 cw = sFbmD(p + 51.0, 0.9);
    cw = vec4(cw.x + (mid.x - 0.5) * 0.1, cw.yzw + mid.yzw * 0.1);
    crack = (1.0 - smoothstep(0.0006, 0.0018 + gFp, sIsoDist(cw))) * cm;
  }
  alb *= 1.0 - 0.7 * crack;
  #endif

  // formwork seams with a darker bleed either side
  if (uCPanel.x > 0.0) {
    float u = abs(gN.x) > abs(gN.z) ? p.z : p.x;
    vec2 f = abs(fract(vec2(u, p.y) / uCPanel) - 0.5);
    float sd = min((0.5 - f.x) * uCPanel.x, (0.5 - f.y) * uCPanel.y);
    alb *= 1.0 - 0.45 * (1.0 - smoothstep(0.002, 0.005 + gFp, sd)) * side;
    alb *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.06, sd)) * side;
  }

  // leaching streaks down vertical faces, and pale efflorescence
  float st = 0.5;
  if (side > 0.01) {
    st = sNoise(vec3(p.x * 7.0, p.y * 0.3, p.z * 7.0), 7.0) * 0.7 + (mid.x - 0.5) * 0.3 + 0.15;
    float streak = smoothstep(0.5, 0.85, st) * side * (0.35 + 0.65 * uCAge);
    alb *= mix(vec3(1.0), vec3(0.5, 0.47, 0.42), streak * 0.85);
    float eff = smoothstep(0.62, 0.8, 1.0 - blotch + (mid.x - 0.5) * 0.4) * uCAge * side;
    alb = mix(alb, vec3(0.62, 0.62, 0.6), eff * 0.35);
  }

  // paint, flaking by the shared damage model (no primer on masonry: the rim is the paint edge)
  if (uCPaintAmt > 0.0) {
    Chip k = sChips(p, uCPaintWear, 1.6);
    float paint = uCPaintAmt * (1.0 - k.primer);
    alb = mix(alb, uCPaint * (0.78 + 0.34 * blotch), paint * 0.95);
    rough = mix(rough, 0.6, paint);
    g = mix(g, g * 0.4, paint) + k.grad * 2.0;
  }

  // grime and moss where it meets the ground
  float sp = sSplashBand();
  alb = mix(alb, vec3(0.05, 0.045, 0.035), sp * 0.55 * (0.5 + 0.5 * mid.x));
  float moss = smoothstep(0.55, 0.7, mid.x) * sp * uCAge;
  alb = mix(alb, vec3(0.035, 0.06, 0.02), moss * 0.6);

  s.albedo = alb; s.rough = rough; s.metal = 0.0; s.grad = g;
  float w = sWetAmount();
  sWetPorous(s, w, 0.9, blotch * 0.7 + mid.x * 0.3, st);
  // water films on flat tops and sits in the holes
  float pool = gNw.y > 0.6 ? smoothstep(0.6, 0.95, gNw.y) * w * smoothstep(0.45, 0.7, mid.x * 0.5 + blotch * 0.5 + 0.25 * w) : 0.0;
  s.rough = mix(s.rough, 0.08, max(pool * 0.85, hole * w));
  s.grad *= 1.0 - 0.7 * pool;
}
`,
};

// opts: color (dry tone, default mid grey), age 0..1, panel (formwork panel size in metres, number
// or [w, h]; 0 = none), paint (colour or null), paintWear 0..1, plus the common options.
export function makeConcrete(opts, ctx) {
  const panel = Array.isArray(opts.panel) ? opts.panel : [opts.panel || 0, opts.panel || 0];
  return ctx.build(concreteDef, opts, {
    uCColor: { value: ctx.toColor(opts.color, 0x8f8c86) },
    uCPaint: { value: ctx.toColor(opts.paint, 0xc8a416) },
    uCAge: { value: opts.age ?? 0.5 },
    uCPaintAmt: { value: opts.paint !== undefined && opts.paint !== null ? 1 : 0 },
    uCPaintWear: { value: opts.paintWear ?? 0.5 },
    uCPanel: { value: new Vector2(panel[0], panel[1]) },
  });
}
