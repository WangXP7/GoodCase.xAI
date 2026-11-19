// The character program: one material for a whole dressed figure, so a zombie is one draw call
// (plus one per shadow pass). G.mats.cloth({ slots: [...], body: {...} }) builds it (skinCloth.js).
// Surface detail is SAMPLED, not computed: the sculpt bake (zombie/sculpt/bake.js) gives the skin
// its slopes, occlusion, cavity, colour, roughness and thinness, and the garment bake gives cloth
// its folds and seams. Per pixel that is three fetches for skin and one for cloth, where the old
// program evaluated up to nine noise volumes.
// The vertex attribute aSurf.w says what each triangle is:
//   0..7  cloth, garment slot n     aSurf.xy = the garment's own metric UV (weave, plaid), uv = atlas
//   8     skin                      uv = body atlas
//   9     hair card                 aSurf.xy = strand texture UV (x across, y root to tip), aSurf.z = shade
//   10    eye (cornea dome)         aSurf.xy = -1..1 across the dome
//   11    tooth / bone              aSurf.y 0 at the root .. 1 at the tip
//   12    gore                      inside of the mouth and skull, stump flesh
// Per zombie, from uniforms and the REST position (so nothing needs vertex data and everything
// crosses joints softly): blood per body part (uChBlood[6]), up to eight wounds (uChWound, kind in
// uChWoundK: 0 bullet, 1 blast, 2 bite), severed parts (uChSever[5]: head, armL, armR, legL, legR).

// before the skin and cloth functions
// shared by the colour program and the depth / shadow programs
export const CHAR_SHARED = /* glsl */ `
uniform vec4 uChWound[8];
uniform float uChWoundK[8];
uniform vec3 uChWoundN[8];
uniform float uChSever[5];
uniform float uChHat;
// Skin a hat hides (1 cap, 2 campaign hat, 3 beanie): the scalp above the band, and under a beanie
// the tops of the ears. A hat rides its own bone, askew, and the skull's own scale; cutting what
// is under it is what keeps a lump of scalp from coming through the crown.
bool sChHatCut(vec3 pr) {
  if (uChHat < 0.5) return false;
  if (pr.y > (uChHat < 1.5 ? 1.732 : uChHat < 2.5 ? 1.742 : 1.716)) return true;
  return uChHat > 2.5 && pr.y > 1.699 && abs(pr.x) > 0.0765;
}
// the arm of the rest pose: x = distance along it from the shoulder, y = distance from its line
vec2 sChArm(vec3 pr) {
  vec2 v = vec2(abs(pr.x) - 0.186, pr.y - 1.405);
  return vec2(v.x * 0.5646 - v.y * 0.8253, length(vec2(v.x * 0.8253 + v.y * 0.5646, pr.z + 0.012)));
}
// Is this fragment on a severed part (the skin of a hidden bone, collapsed to the joint: what is
// still drawn is the cap stretched over the stump)? Returns 0, or 1 + how far past the cut it was.
float sChStump(vec3 pr) {
  bool L = pr.x >= 0.0;
  if (uChSever[0] > 0.75 && pr.y > 1.54) return 1.0 + (pr.y - 1.54) * 6.0;
  // the jaw alone (a damaged head): the lower face is the stump
  if (uChSever[0] > 0.25 && pr.y < 1.628 && pr.y > 1.555 && pr.z > 0.0 && abs(pr.x) < 0.065) return 1.0 + (1.628 - pr.y) * 9.0;
  vec2 a = sChArm(pr);
  if ((L ? uChSever[1] : uChSever[2]) > 0.5 && a.x > 0.25 && a.y < 0.14 && pr.y < 1.3) return 1.0 + (a.x - 0.25) * 5.0;
  if ((L ? uChSever[3] : uChSever[4]) > 0.5 && pr.y < 0.56) return 1.0 + (0.56 - pr.y) * 5.0;
  return 0.0;
}
// A lock of wet hair on a card, drawn as a function of the card's (u, v), so there is no texel to
// stair-step however close the camera comes. u runs across one of eight locks, v from root to tip.
// The lock wanders and narrows to a point, and is made of strands that run its length, end at
// different places and thin as they end: its tip is a few hairs, its sides are hair, never the cut
// edge of a strip of paper. The cover and the knot (aSurf.z > 2) are one sheet of the same strands:
// only their ends are cut (the fringe at the hairline).
// Returns the coverage 0..1; gHair = (the strand's tone, where across the lock -1..1, where across
// the strand -0.5..0.5, how well single strands resolve 0..1).
vec4 gHair = vec4(1.0, 0.0, 0.0, 0.0);
float gHairThr = 0.5;
float sChLock() {
  bool cover = gA.z > 2.0;
  float lu = gA.x * 8.0, id = floor(lu), c = fract(lu) - 0.5, v = gA.y;
  float seed = cover ? 0.0 : fract(gA.z * 37.0);       // (a lock's own; the cover's shade varies across it)
  float E = cover ? 0.5 : 0.48 * (1.0 - 0.82 * smoothstep(0.3, 1.0, v));
  float cw = cover ? 0.0 : 0.075 * sin(v * 4.6 + id * 2.4 + seed * 40.0) * smoothstep(0.2, 1.0, v);
  float q = (c - cw) / E;
  float NS = cover ? 11.0 : 9.0;
  float sc = (q * 0.5 + 0.5) * NS;
  sc += 0.33 * sin(sc * 2.3 + id * 1.7 + seed * 9.0);       // strands of unequal width
  float si = floor(sc), sf = fract(sc) - 0.5;
  vec3 h = sHash3(ivec3(int(si), int(id) + int(seed * 977.0), 3));
  // most strands run nearly to the tip, the outer ones stop sooner
  float L = cover ? mix(0.5, 1.0, h.x) : 1.0 - 0.5 * h.x - 0.28 * q * q;
  float ht = 0.5 - 0.44 * smoothstep(L - 0.28, L, v);
  float wS = fwidth(sc);
  float one = clamp(0.5 + (ht - abs(sf)) / max(wS, 1e-4), 0.0, 1.0) * step(v, L);
  float res = 1.0 - smoothstep(0.5, 1.4, wS);
  float a = cover && v < 0.46 ? 1.0 : one;
  if (!cover) a *= clamp(0.5 + (1.0 - abs(q)) * E / max(fwidth(c), 1e-4), 0.0, 1.0);
  gHair = vec4(0.62 + 0.5 * h.y, cover ? 0.0 : clamp(q, -1.0, 1.0), sf, res);
  // partly covered pixels are kept or dropped against a threshold fixed to the strand (in lengths
  // of a few millimetres), so an edge breaks up into hairs and does not crawl
  gHairThr = 0.3 + 0.4 * sHash3(ivec3(int(si) + 31 * int(id), int(floor(v * 16.0 + h.z * 9.0)), 11)).x;
  return a;
}
bool sChHairGone() { float a = sChLock(); return a < gHairThr; }
// The nearest wound: x = distance in radii (0 centre, 1 edge; 9 = none), y = kind, z = radius;
// gWdDir = unit direction away from its centre in rest space.
vec3 gWdDir = vec3(0.0);
// reach: cloth stands off the skin, so along the wound's own outward normal that much distance is
// forgiven (the wound is the path of the shot, not a ball on the skin): 0 for skin.
vec3 sChWoundAtR(vec3 pr, float reach) {
  vec3 best = vec3(9.0, 0.0, 0.0);
  for (int i = 0; i < 8; i++) {
    vec4 w = uChWound[i];
    if (w.w <= 0.0) continue;
    vec3 v = pr - w.xyz;
    if (reach > 0.0) v -= uChWoundN[i] * clamp(dot(v, uChWoundN[i]), -0.015, reach);
    float d = length(v) / w.w;
    if (d < best.x) { best = vec3(d, uChWoundK[i], w.w); gWdDir = v / max(length(v), 1e-5); }
  }
  return best;
}
vec3 sChWoundAt(vec3 pr) { return sChWoundAtR(pr, 0.0); }
// the nearest wound as cloth meets it (x = distance in radii, through any layer worn over the skin)
vec3 sChWoundCloth(vec3 pr) { return sChWoundAtR(pr, 0.085); }
// how much blood the cloth round a wound has taken up: 1 at the hole, 0 from two radii out
// (ragged, and further down than up: it ran. A plain falloff soaked a perfect ring round the hole.)
float sChWound(vec3 pr) {
  vec3 w = sChWoundCloth(pr);
  if (w.x > 3.6) return 0.0;
  float n = sFbm(pr + 23.0, 1.4 / max(w.z, 0.01)), n2 = sFbm(pr + 61.0, 5.0 / max(w.z, 0.01));
  float d = w.x * (1.0 + 0.4 * gWdDir.y) + (n - 0.5) * 1.5 + (n2 - 0.5) * 0.5;
  return 1.0 - smoothstep(0.45, 1.7, d);
}
// A severed part is cut away, raggedly, a little past the joint; the stump is closed by a cap of
// flesh inside the limb (eyes.js: buildCore). The jaw alone is not cut: its skin is the wound.
bool sChCut(vec3 pr, float n) {
  float st = sChStump(pr);
  if (st <= 0.0) return false;
  if (uChSever[0] > 0.25 && uChSever[0] < 0.75 && pr.y > 1.5) return false;
  return st > 1.0 + 0.1 * n;
}
`;

export const CHAR_PARS = /* glsl */ `
uniform sampler2D tChNA;
uniform sampler2D tChAR;
uniform sampler2D tChTC;
uniform sampler2D tChCloth;
uniform sampler2D tChHair;
uniform float uChBlood[6];
uniform vec3 uChHair;
uniform vec2 uChHairAmt;
uniform vec3 uChTint;
uniform float uChRot;
uniform float uChGrime;
uniform vec4 uChEye;
uniform float uChFar;
uniform float uChDebug;
// x = how much blood this body part carries here, y = 1 if any part carries any
vec2 sChPartBlood(vec3 pr) {
  float any = uChBlood[0] + uChBlood[1] + uChBlood[2] + uChBlood[3] + uChBlood[4] + uChBlood[5];
  if (any <= 0.0) return vec2(0.0);
  bool L = pr.x >= 0.0;
  float head = smoothstep(1.47, 1.53, pr.y);
  vec2 a = sChArm(pr);
  float arm = smoothstep(-0.02, 0.07, a.x) * (1.0 - smoothstep(0.075, 0.125, a.y)) * (1.0 - head);
  float leg = (1.0 - smoothstep(0.84, 0.96, pr.y)) * (1.0 - arm);
  float torso = (1.0 - head) * (1.0 - arm) * (1.0 - leg);
  return vec2(uChBlood[0] * head + uChBlood[1] * torso + (L ? uChBlood[2] : uChBlood[3]) * arm + (L ? uChBlood[4] : uChBlood[5]) * leg, 1.0);
}
// baked slopes (encoded tan along u and v) -> height derivatives on screen, metres per pixel
vec2 sChSlope(vec2 enc) {
  vec2 t = enc * 2.0 - 1.0;
  t = sign(t) * t * t * 3.0;
  vec3 dPx = dFdx(vSP), dPy = dFdy(vSP);
  vec2 dUx = dFdx(vSUv), dUy = dFdy(vSUv);
  float det = dUx.x * dUy.y - dUx.y * dUy.x;
  if (abs(det) < 1e-14) return vec2(0.0);
  vec3 Tu = (dPx * dUy.y - dPy * dUx.y) / det, Tv = (dPy * dUx.x - dPx * dUy.x) / det;
  vec2 m = t * vec2(length(Tu), length(Tv));
  return vec2(dot(m, dUx), dot(m, dUy));
}
`;

// after them: skin from the baked maps, the small surfaces, and the switch
export const CHAR_GLSL = /* glsl */ `
void charFlesh(inout Surf s, float depth, float n) {
  // torn flesh: dark wet red, paler fat and bone toward the middle of a stump
  // (red meat, wet but not a mirror: under a lamp it must read as flesh, not as chrome or a void)
  // (matte: torn muscle is fibrous and tacky. Glossy, it read as a glazed cherry.)
  vec3 c = mix(vec3(0.3, 0.042, 0.03), vec3(0.07, 0.01, 0.008), smoothstep(0.25, 0.8, n));
  c = mix(c, vec3(0.34, 0.2, 0.12), smoothstep(0.72, 0.9, sFbm(gP + 17.0, 210.0)) * 0.45);      // strands of fat and sinew
  s.albedo = c; s.rough = 0.62 + 0.25 * n; s.metal = 0.0; s.ao = 0.8; s.grad = vec3(0.0);
  gFuzzC = vec3(0.012);
}
void charSkin(inout Surf s) {
  gScatter = uScatter; gWrap = uWrap;
  vec3 pr = gP - uSeedOff;
  if (sChHatCut(pr)) discard;
  float stump = sChStump(pr);
  float bN = sFbm(gP, 6.0);
  if (stump > 0.0) {
    float n = sFbm(gP + 9.0, 70.0);
    if (sChCut(pr, n)) discard;
    charFlesh(s, stump, n);
    float bone = smoothstep(1.55, 1.75, stump + (n - 0.5) * 0.25);
    s.albedo = mix(s.albedo, vec3(0.34, 0.3, 0.22) * (0.7 + 0.5 * n), bone);
    s.albedo = mix(s.albedo, vec3(0.09, 0.07, 0.035), smoothstep(1.02, 1.12, stump) * (1.0 - smoothstep(1.2, 1.4, stump)) * 0.5);   // fat under the skin
    s.rough = mix(s.rough, 0.45, bone);
    return;
  }
  vec4 na = texture2D(tChNA, vSUv), ar = texture2D(tChAR, vSUv), tc = texture2D(tChTC, vSUv);
  vec3 alb = ar.rgb * ar.rgb;
  float rough = ar.a, ao = na.b, cav = na.a, cavF = tc.g, thin = tc.r, special = tc.a;
  // this zombie: its tone, how far gone it is, and its own blotches (so shared maps never give two the same face)
  alb *= mix(uChTint, vec3(1.0), special);
  float blot = clamp((bN - 0.3) * 2.5, 0.0, 1.0);
  alb *= mix(1.0, 0.78 + 0.44 * blot, 1.0 - special);
  alb = mix(alb, alb * vec3(0.5, 0.6, 0.38), smoothstep(0.55, 0.85, blot) * uChRot * (1.0 - special));
  s.dH = sChSlope(na.rg);
  s.grad = vec3(0.0);
  // scalp: hair lying flat and wet on it
  float hairK = tc.b * mix(uChHairAmt.x, uChHairAmt.y, smoothstep(1.735, 1.775, pr.y + 0.25 * pr.z));
  if (hairK > 0.01) {
    float hk = smoothstep(0.2, 0.7, hairK * (0.7 + 0.6 * blot));
    alb = mix(alb, uChHair * (0.16 + 0.2 * blot), hk * 0.9);
    rough = mix(rough, 0.5, hk);
    alb *= 1.0 - 0.4 * smoothstep(0.03, 0.3, hairK) * (1.0 - hk);       // and the shadow it lays on the skin along the hairline
  }
  // ---- wounds: bruise, a pale torn rim, a crater with wet flesh in it
  vec3 wd = sChWoundAt(pr);
  float crater = 0.0;
  if (wd.x < 2.2) {
    float wn = sFbm(gP + 150.0, 1.7 / wd.z);
    float d = wd.x + (wn - 0.5) * 0.9;
    // the bruise is blotched and lopsided, not a halo: it follows its own noise, not the hole's
    float bruise = (1.0 - smoothstep(0.6, 2.0, wd.x + (sFbm(gP + 88.0, 0.8 / wd.z) - 0.5) * 1.6)) * (0.35 + 0.65 * blot);
    alb = mix(alb, alb * vec3(0.5, 0.3, 0.42), bruise * 0.85 * (1.0 - special));
    crater = 1.0 - smoothstep(0.62, 0.76, d);
    float rim = (1.0 - smoothstep(0.76, 0.98, d)) * (1.0 - crater);
    bool blast = wd.y > 0.5 && wd.y < 1.5 && pr.y > 1.5;
    if (blast && d < 0.56) discard;       // a blast opens the skull
    alb = mix(alb, alb * 1.3 + vec3(0.03, 0.015, 0.012), rim * 0.6);
    float fib = sFbm(gP + 12.0, 190.0);
    vec3 flesh = mix(vec3(0.24, 0.034, 0.026), vec3(0.04, 0.006, 0.005), smoothstep(0.6, 0.1, d)) * (0.5 + 0.9 * fib);
    // the broken edge of the skull: a ring of bone before the scalp
    if (blast) flesh = mix(flesh, vec3(0.5, 0.44, 0.33) * (0.6 + 0.6 * wn), 1.0 - smoothstep(0.6, 0.66, d));
    if (wd.y > 1.5) flesh = mix(flesh, vec3(0.2, 0.17, 0.1), smoothstep(0.62, 0.8, sFbm(gP + 31.0, 1.6 / wd.z)) * 0.6);   // a bite: gnawed down to pale tissue
    alb = mix(alb, flesh, crater);
    rough = mix(rough, 0.7, rim); rough = mix(rough, 0.6 + 0.3 * fib, crater);
    ao *= 1.0 - 0.5 * crater;
    // relief: the rim stands proud, the floor drops away
    float sl = (smoothstep(1.0, 0.8, d) * step(0.74, d) * 0.5 - (1.0 - smoothstep(0.3, 0.74, d)) * step(d, 0.74) * 2.2);
    s.grad += gWdDir * sl;
    s.dH *= 1.0 - crater;
  }
  // ---- blood: placed per body part. It lies in the creases first (the baked cavity), then spreads.
  vec2 pb = sChPartBlood(pr);
  float fresh = 0.0;
  if (pb.x > 0.0 || crater > 0.0 || wd.x < 2.2) {
    float pool = clamp(cavF * 0.9 + cav * 0.45 + (blot - 0.5) * 0.9, 0.0, 1.5);
    // the mouth and chin carry more of the head's share: it has been feeding
    // (and it stays under the nose: blood over the nose and the mouth together reads as one black hole)
    float amt = pb.x * (0.7 + 1.9 * (1.0 - smoothstep(0.015, 0.05, length((pr - vec3(0.0, 1.605, 0.088)) * vec3(1.0, 0.7, 1.0)))) * (1.0 - smoothstep(1.626, 1.636, pr.y)));
    amt *= 1.0 - 0.85 * (1.0 - smoothstep(0.012, 0.03, length((pr - vec3(0.0, 1.662, 0.1)) * vec3(1.0, 0.55, 1.0))));
    amt = min(amt, 1.0);
    float B = amt * smoothstep(1.0 - amt, 1.25 - 0.9 * amt, pool + 0.3);
    // running down from a wound
    if (wd.x < 6.0) {
      vec3 v = gWdDir * wd.x * wd.z;
      float below = -v.y, lat = length(v.xz);
      float run = smoothstep(0.0, wd.z * 0.6, below) * (1.0 - smoothstep(wd.z * 2.0, wd.z * 5.5, below)) * (1.0 - smoothstep(wd.z * 0.25, wd.z * 0.7, lat + (blot - 0.5) * wd.z * 0.6));
      B = max(B, max(run * 0.9, (1.0 - smoothstep(0.6, 1.3, wd.x)) * 0.8));
    }
    float dried = smoothstep(0.25, 0.5, B);
    fresh = smoothstep(0.6, 0.9, B) * uBlood;
    alb = mix(alb, alb * vec3(0.55, 0.3, 0.28), smoothstep(0.05, 0.3, B) * (1.0 - dried) * 0.6);
    alb = mix(alb, vec3(0.07, 0.0105, 0.0085) * (0.55 + 0.8 * blot), dried * (1.0 - 0.5 * crater));
    rough = mix(rough, 0.55, dried * (1.0 - fresh)); rough = mix(rough, 0.3, fresh * (1.0 - crater));
  }
  // ---- grime, low down and in the creases
  float gr = uChGrime * clamp(sSplashBand() * 0.8 + cav * 0.5 + (blot - 0.6) * 0.8, 0.0, 1.0) * (1.0 - special);
  alb = mix(alb, vec3(0.03, 0.026, 0.02), gr * 0.55);
  rough = mix(rough, 0.8, gr * 0.5);
  // ---- rain: skin does not soak; it goes slick and carries beads
  float w = sWetAmount();
  float sheen = 0.03;
  if (w > 0.01) {
    alb *= 1.0 - 0.1 * w;
    rough = mix(rough, rough * 0.66, w * (1.0 - crater));
    #if SURF_Q > 0
    float fb = sFade(300.0) * (1.0 - uChFar);
    if (fb > 0.0) { float bead = sBeadLayer(gP, 200.0, 0.1 * w, 0.3) * fb; rough = mix(rough, 0.1, bead * 0.7); }
    #endif
    sheen += 0.24 * w;
  }
  // the shade under a brim: deepest at the brow, gone by the mouth (a cap); a campaign hat's brim
  // goes all the way round. Painted, so it is smooth however coarse the shadow map is.
  if (uChHat > 0.5 && uChHat < 2.5 && pr.y > 1.6) {
    float under = smoothstep(1.63, 1.708, pr.y) * (1.0 - smoothstep(1.715, 1.74, pr.y));
    float front = uChHat > 1.5 ? 0.55 + 0.45 * smoothstep(-0.02, 0.06, pr.z) : smoothstep(0.01, 0.07, pr.z);
    float k = under * front * (uChHat > 1.5 ? 0.62 : 0.72);
    alb *= 1.0 - k; ao *= 1.0 - 0.6 * k; sheen *= 1.0 - k;
  }
  // thin parts (ears, nostrils, fingers, lids) let light through
  gScatter = mix(uScatter, vec3(0.85, 0.32, 0.22), thin * 0.7);
  gWrap = uWrap + 0.35 * thin;
  gFuzzC = vec3(sheen) * (1.0 - crater);
  s.albedo = alb; s.rough = rough; s.metal = 0.0;
  s.ao = ao;
  // zdbg=<n> on the test stage: 1 slopes, 2 occlusion and cavity, 3 baked colour, 4 thinness, special, scalp
  if (uChDebug > 0.5) {
    s.dH = vec2(0.0); s.rough = 1.0; s.albedo = vec3(0.0);
    s.emissive = (uChDebug < 1.5 ? vec3(na.rg, 0.5) : uChDebug < 2.5 ? vec3(na.b, na.a, cavF) : uChDebug < 3.5 ? ar.rgb * ar.rgb : vec3(thin, special, tc.b)) * 0.6;
  }
}
void charMisc(inout Surf s, int id) {
  gScatter = vec3(0.3); gWrap = 0.3;
  float w = sWetAmount();
  vec3 pr = gP - uSeedOff;
  s.metal = 0.0; s.grad = vec3(0.0);
  if (id == 9) {
    // hair: the cover and the locks. Wet hair is dark, clumped and stuck down, with a broken sheen
    // that runs along the strands; a lock is round (lit across like a rope, dark down its sides),
    // and what lies under the locks is in their shadow.
    if (sChHairGone()) discard;
    bool cover = gA.z > 2.0;
    float hShade = cover ? gA.z - 2.0 : gA.z;
    { vec3 bw = sChWoundAt(pr); if (bw.y > 0.5 && bw.y < 1.5 && bw.x < 0.75) discard; }       // a blast takes the hair with the skull
    float strand = gHair.x, q = gHair.y;
    // (strands vary the tone a little; clumps and the damp vary it more, in patches: never corduroy)
    float clumpN = clamp((sFbm(gP + 40.0, 28.0) - 0.3) * 2.5, 0.0, 1.0);
    float body = cover ? 0.42 : 0.6 + 0.4 * (1.0 - q * q);
    vec3 c = uChHair * mix(0.8, strand, 0.35 + 0.65 * gHair.w) * (0.72 + 0.45 * clumpN) * hShade * body * (0.4 + 0.6 * smoothstep(0.0, 0.4, gA.y));
    c *= mix(1.0, 0.45 + 0.55 * (1.0 - pow(abs(2.0 * gHair.z), 3.0)), gHair.w);       // the dark between strands
    s.albedo = c * mix(0.72, 0.24, w);
    s.rough = mix(0.82, 0.5, w) - 0.1 * (strand - 0.85);
    s.ao = (0.45 + 0.55 * smoothstep(0.03, 0.5, gA.y)) * (cover ? 0.7 : 1.0);
    // relief, as slopes across the card (a function, so nothing steps): the lock's own roundness,
    // and each strand a ridge, which is what draws a highlight out into streaks along the hair
    vec2 du = vec2(dFdx(gA.x), dFdy(gA.x));
    float dl = length(du);
    if (dl > 1e-9) s.dH = (du / dl) * gFp * (-(cover ? 0.0 : 0.45 * q) - 1.1 * gHair.z * gHair.w);
    gFuzzC = vec3(0.01 + 0.04 * w) * (0.4 + strand);
    gScatter = uChHair * 0.5 + 0.05; gWrap = 0.55;
  } else if (id == 10) {
    { vec3 bw = sChWoundAt(pr); if (bw.y > 0.5 && bw.y < 1.5 && bw.x < 0.8) discard; }       // a blast that takes the socket takes the eye
    // the cornea dome: pupil, iris fibres, a dark limbal ring, clouded over; its bulge carries its
    // own sharp highlight apart from the white's
    float r = length(gA.xy);
    float ang = atan(gA.y, gA.x);
    float fib = sNoise(vec3(ang * 9.0, r * 3.0, uSeedOff.x), 9.0);
    vec3 iris = uChEye.rgb * (0.4 + 0.8 * fib) * (0.5 + 0.7 * smoothstep(0.2, 0.6, r));
    iris = mix(iris, iris * 0.1, smoothstep(0.5, 0.66, r));                     // limbal ring
    vec3 c = mix(vec3(0.004), iris, smoothstep(0.2, 0.25, r));
    c = mix(c, vec3(0.3, 0.3, 0.27), (0.16 + 0.22 * smoothstep(0.3, 0.7, sFbm(gP, 300.0))) * (1.0 - 0.7 * smoothstep(0.5, 0.66, r)));   // the film of a dead eye
    float edge = smoothstep(0.66, 1.0, r);
    c = mix(c, vec3(0.3, 0.26, 0.2), edge);
    s.albedo = c; s.rough = mix(0.035, 0.12, edge); s.ao = 1.0;
    // the glow is in the pupil, with a faint spill into the iris so it still glints at ten metres
    s.emissive = vec3(1.0, 0.55, 0.2) * uChEye.a * ((1.0 - smoothstep(0.1, 0.24, r)) + 0.22 * (1.0 - smoothstep(0.2, 0.62, r)));
    gFuzzC = vec3(0.15);
  } else if (id == 11) {
    // teeth and bare bone: stained, darkest at the gum
    float n = sFbm(gP, 300.0);
    s.albedo = mix(vec3(0.07, 0.035, 0.02), vec3(0.6, 0.53, 0.38), smoothstep(0.05, 0.6, gA.y)) * (0.7 + 0.6 * n);
    s.rough = 0.3; s.ao = 0.45 + 0.55 * gA.y;
    gFuzzC = vec3(0.03);
  } else {
    // inside the mouth and the skull, stump flesh: nearly black, wet
    float n = sFbm(gP, 90.0);
    if (gA.z < 1.5 && sChStump(pr) > 0.0) discard;
    charFlesh(s, 0.0, n);
    if (gA.z > 1.5) {
      // the cap of a stump, seen end on: bone in the middle, muscle round it, fat and skin at the rim
      float r = length(gA.xy) + (n - 0.5) * 0.18;
      float rb = length(gA.xy - vec2(0.0, -0.22)) + (n - 0.5) * 0.12;                              // the bone sits off centre
      float big = clamp((sFbm(gP + 5.0, 60.0) - 0.3) * 2.5, 0.0, 1.0);
      vec3 meat = mix(vec3(0.15, 0.02, 0.016), vec3(0.035, 0.005, 0.004), smoothstep(0.25, 0.8, big)) * (0.7 + 0.6 * sFbm(gP + 5.0, 260.0));
      vec3 c = mix(vec3(0.46, 0.41, 0.31) * (0.7 + 0.5 * n), meat, smoothstep(0.2, 0.26, rb));
      c = mix(c, vec3(0.08, 0.01, 0.008), (1.0 - smoothstep(0.0, 0.09, rb)) * 0.8);                // marrow
      c = mix(c, vec3(0.01, 0.002, 0.002), 1.0 - smoothstep(0.08, 0.14, length(gA.xy - vec2(0.0, 0.4))));   // a severed vessel, dark and open
      c = mix(c, vec3(0.3, 0.24, 0.12) * (0.7 + 0.6 * n), smoothstep(0.82, 0.9, r) * 0.7);       // fat under the skin
      s.albedo = c; s.rough = mix(0.5, 0.3 + 0.3 * n, smoothstep(0.2, 0.26, rb)); s.ao = 0.9;
    } else if (gA.z > 0.8) {
      // what a blast shows inside the skull: grey-pink folds, wet, blood in the furrows
      float f = sFbm(gP + 3.0, 45.0);
      vec3 c = mix(vec3(0.34, 0.2, 0.17), vec3(0.16, 0.03, 0.025), smoothstep(0.35, 0.6, f));
      s.albedo = c * (0.7 + 0.6 * n); s.rough = 0.28 + 0.3 * f; s.ao = 0.85;
      s.emissive = s.albedo * 0.035;       // it sits in the skull's own shadow: a little is always seen
    } else {
      // the mouth: dark red, darker toward the throat (gA.z); the tongue is paler
      s.albedo = mix(vec3(0.012, 0.002, 0.002), vec3(0.2, 0.045, 0.04), gA.z * 1.2) * (0.6 + 0.8 * n);
      s.rough = 0.3 + 0.25 * n; s.ao = 0.35 + 0.6 * gA.z;
    }
  }
  gRetro = 0.0;
}
void surfaceMain(inout Surf s) {
  int id = int(gA.w + 0.5);
  if (id < 8) clothSurface(s);
  else if (id == 8) {
    if (!gl_FrontFacing) discard;      // the far side of the skin is never seen
    charSkin(s);
  }
  else charMisc(s, id);
}
`;

// Depth and shadow passes: what the colour pass will cut is cut here too.
export const CHAR_CUT_MAIN = /* glsl */ `
uniform sampler2D tChHair;
bool surfaceCut() {
  if (gA.w < 7.5) return clothCut();
  if (gA.w > 8.5 && gA.w < 9.5) {
    if (sChHairGone()) return true;
    vec3 bw = sChWoundAt(gP - uSeedOff);
    return bw.y > 0.5 && bw.y < 1.5 && bw.x < 0.75;
  }
  if (gA.w > 9.5 && gA.w < 10.5) { vec3 bw = sChWoundAt(gP - uSeedOff); return bw.y > 0.5 && bw.y < 1.5 && bw.x < 0.8; }
  #ifdef CHAR_PREPASS
  if (gA.w < 8.5 && !gl_FrontFacing) return true;
  #endif
  if (gA.w < 8.5) {
    vec3 pr = gP - uSeedOff;
    if (sChHatCut(pr)) return true;
    if (sChStump(pr) > 0.0 && sChCut(pr, sFbm(gP + 9.0, 70.0))) return true;
    if (pr.y > 1.5) { vec3 wd = sChWoundAt(pr); if (wd.y > 0.5 && wd.y < 1.5 && wd.x + (sFbm(gP + 150.0, 1.7 / wd.z) - 0.5) * 0.9 < 0.56) return true; }
  }
  return false;
}
`;

// body: { tint, rot, grime, hair (colour), hairAmt [sides, top], eye (iris colour), glow, maps: { normalAo,
// albedoRough, thicknessCavity, cloth, hair } }
export function charUniforms(body, ctx, T) {
  const m = body.maps || {};
  const wounds = [];
  for (let i = 0; i < 8; i++) wounds.push(new T.Vector4(0, 0, 0, 0));
  const eye = ctx.toColor(body.eye, 0x8a8f6a);
  return {
    tChNA: { value: m.normalAo || null }, tChAR: { value: m.albedoRough || null }, tChTC: { value: m.thicknessCavity || null },
    tChCloth: { value: m.cloth || null }, tChHair: { value: m.hair || null },
    uChBlood: { value: new Float32Array(6) },
    uChHair: { value: ctx.toColor(body.hair, 0x1a1510) },
    uChHairAmt: { value: new T.Vector2(...(body.hairAmt || [1, 1])) },
    uChTint: { value: new T.Vector3(...(body.tint || [1, 1, 1])) },
    uChRot: { value: body.rot ?? 0.4 },
    uChGrime: { value: body.grime ?? 0.5 },
    uChWound: { value: wounds },
    uChWoundK: { value: new Float32Array(8) },
    uChWoundN: { value: wounds.map(() => new T.Vector3(0, 0, 1)) },
    uChSever: { value: new Float32Array(5) },
    uChEye: { value: new T.Vector4(eye.r, eye.g, eye.b, body.glow ?? 0.6) },
    uChFar: { value: 0 },
    uChHat: { value: body.hat ?? 0 },
    uChDebug: { value: 0 },
  };
}
