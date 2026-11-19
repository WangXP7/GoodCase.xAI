// Zombie skin and clothing. Both sample in object/rest space (skinned meshes: the `position`
// attribute is the rest pose, so detail never swims) and share a soft direct-light model (wrapped
// diffuse with a tinted scatter term, a grazing sheen, a retroreflective lobe for hi-vis tape).
// All noise comes from the shared volumes (noiseTex.js): a handful of fetches per pixel.
//
// Wounds, tears and blood are PLACED, never a global noise threshold:
//   aSurf.x  skin: wound 0..1            cloth: 0..0.5 wear, 0.5..1 torn through
//   aSurf.y  blood 0..1 (both)
//   aSurf.z  cloth: fold 0..1 (crease shading)
//   wounds / stains options: up to four rest-space spheres each, also on material.surf.uWound /
//   uStain (Vector4 x,y,z,radius) so a bite can be added at runtime.
// Noise only breaks up the outline of what was placed. Blood runs follow `down` in rest space.
import { Vector2, Vector3, Vector4, Color, DoubleSide } from 'three';
import { CHAR_SHARED, CHAR_PARS, CHAR_GLSL, CHAR_CUT_MAIN, charUniforms } from './charBody.js';

// Replaces three's RE_Direct for these two programs.
const SOFT_LIGHT = /* glsl */ `
uniform vec3 uScatter;
uniform float uWrap;
// set by the surface function (so one program can light skin and cloth differently)
vec3 gScatter = vec3(0.5);
float gWrap = 0.4;
vec3 gFuzzC = vec3(0.0);
float gRetro = 0.0;
void RE_Direct_Soft(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  float ndl = dot(geometryNormal, directLight.direction);
  float wrap = saturate((ndl + gWrap) / (1.0 + gWrap));
  // light that entered nearby and comes back out past the terminator, tinted by what it crossed
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseContribution) * gScatter * max(wrap * wrap - saturate(ndl), 0.0);
  float ndv = saturate(dot(geometryNormal, geometryViewDir));
  // grazing sheen: cloth nap, and the waxy film on wet skin that catches a rim light
  reflectedLight.directSpecular += directLight.color * gFuzzC * (pow(1.0 - ndv, 3.0) * wrap * 0.35);
  // retroreflective tape: a tight return towards the light, and a wider, weaker one around it
  float back = saturate(dot(directLight.direction, geometryViewDir));
  float b8 = back * back; b8 *= b8; b8 *= b8;
  reflectedLight.directSpecular += directLight.color * (gRetro * (pow(b8, 6.0) * 5.0 + b8 * 0.5) * saturate(ndl + 0.2));
}
#if SURF_Q > 0
  #undef RE_Direct
  #define RE_Direct RE_Direct_Soft
#endif
`;

const PLACED_GLSL = /* glsl */ `
uniform float uBlood;
uniform vec4 uWound[4];
uniform vec4 uStain[4];
uniform vec3 uDown;
uniform vec3 uAxis;
// A placed sphere as an irregular patch: 1 at its centre, 0 at its edge. 'k' gives each one its own
// long axis and stretch; 'warp' (noise, about -0.5..0.5) pushes the edge in and out, so no two are
// the same shape and none is a disc.
float sPatch(vec4 a, vec3 pr, float k, float warp) {
  if (a.w <= 0.0) return 0.0;
  vec3 v = pr - a.xyz;
  float d2 = dot(v, v);
  if (d2 > a.w * a.w * 4.0) return 0.0;
  vec3 dir = normalize(vec3(sin(k * 2.4 + 0.7), cos(k * 1.7) * 1.3, sin(k * 3.1 + 2.0)));
  float al = dot(v, dir);
  float sq = 0.45 + 0.4 * fract(k * 0.618);
  float d = sqrt(max(d2 - al * al * (1.0 - sq * sq), 0.0)) / (a.w * (0.72 + 0.28 * sq) * clamp(1.0 + warp * 1.1, 0.35, 1.7));
  return 1.0 - smoothstep(0.0, 1.0, d);
}
// Where blood from a source has run: x = envelope (wide at the source, narrowing down), y = how far
// down its length this is (0..1). The trails themselves are cut from this with streak noise.
vec2 sRunEnv(vec4 a, vec3 pr, vec3 down, float k) {
  if (a.w <= 0.0) return vec2(0.0);
  vec3 v = pr - a.xyz; float al = dot(v, down);
  float len = a.w * (2.5 + 5.0 * fract(k * 0.37));
  if (al < -a.w * 0.2 || al > len) return vec2(0.0);
  float t = max(al, 0.0) / len;
  float wid = a.w * mix(0.7, 0.1, sqrt(t));
  float lat = length(v - down * al);
  return vec2((1.0 - smoothstep(wid * 0.4, wid, lat)) * smoothstep(-a.w * 0.2, a.w * 0.3, al) * (1.0 - smoothstep(0.75, 1.0, t)), t);
}
`;

// skinSurface(): the whole skin. In the character program (CHAR_BODY) it also reads the scalp
// masks from the UVs and blood per body part.
const SKIN_GLSL = /* glsl */ `
uniform vec3 uSkTone;
uniform float uSkRot;
uniform float uSkGrime;
uniform vec2 uSkLivid;
void skinSurface(inout Surf s) {
  gScatter = uScatter; gWrap = uWrap;
  vec3 p = gP;
  vec3 pr = p - uSeedOff;
  float rot = uSkRot;
  vec3 down = normalize(uDown);
  vec4 big = sFbmD(p, 5.0);
  vec4 mid = sFbmD(S_ROT * p + 13.0, 36.0);
  mid.yzw = mid.yzw * S_ROT;
  float bN = clamp((big.x - 0.3) * 2.5, 0.0, 1.0), mN = clamp((mid.x - 0.3) * 2.5, 0.0, 1.0);

  // ---- what the builder placed. First a cheap reach test, so the outline noise is only paid for
  // near a wound, a stain or a run.
  bool marked = gA.x + gA.y > 0.002;
  #ifdef CHAR_BODY
  vec2 partB = sChPartBlood(pr);
  if (partB.x > 0.0) marked = true;
  #endif
  for (int i = 0; i < 4; i++) {
    vec4 a = uWound[i], b = uStain[i];
    vec3 va = pr - a.xyz, vb = pr - b.xyz;
    float da = dot(va, down), db = dot(vb, down);
    if (a.w > 0.0 && (dot(va, va) < a.w * a.w * 4.0 || (da > 0.0 && da < a.w * 7.5 && dot(va, va) - da * da < a.w * a.w))) marked = true;
    if (b.w > 0.0 && (dot(vb, vb) < b.w * b.w * 4.0 || (db > 0.0 && db < b.w * 7.5 && dot(vb, vb) - db * db < b.w * b.w))) marked = true;
  }
  // outline noise at about the size of a wound: lobes, not lace
  vec4 wn = marked ? sFbmD(p + 150.0, 16.0) : vec4(0.5, 0.0, 0.0, 0.0);
  float wN = clamp((wn.x - 0.3) * 2.5, 0.0, 1.0);
  float W = gA.x, B = gA.y;
  vec2 rn = vec2(0.0);
  if (marked) {
    float warp = (wN - 0.5) * 1.0 + (mN - 0.5) * 0.2;
    for (int i = 0; i < 4; i++) {
      float k = float(i) * 1.37 + uSeedOff.x;
      W = max(W, sPatch(uWound[i], pr, k, warp));
      B = max(B, sPatch(uStain[i], pr, k + 5.0, warp));
      vec2 r1 = sRunEnv(uWound[i], pr, down, k), r2 = sRunEnv(uStain[i], pr, down, k + 5.0);
      if (r1.x > rn.x) rn = r1;
      if (r2.x * 0.8 > rn.x) rn = vec2(r2.x * 0.8, r2.y);
    }
    #ifdef CHAR_BODY
    // blood on a whole body part: spatter and smears that grow and join as the amount rises
    B = max(B, partB.x * smoothstep(0.78 - 0.7 * partB.x, 0.95 - 0.6 * partB.x, wN * 0.6 + bN * 0.4) * 0.95);
    #endif
  }

  // ---- colour: dead flesh. The living tone is all but gone: a low grey with green in it, drifting
  // to purple-grey in broad patches. It is kept dark (about a quarter reflectance) so that under a
  // bright lamp the form is carried by shading and the wet sheen, not by a pale blown-out surface.
  float grey = sLuma(uSkTone);
  vec3 alb = mix(uSkTone, grey * vec3(0.86, 0.96, 0.8), 0.88 + 0.08 * rot) * 0.5;
  alb = mix(alb, grey * vec3(0.4, 0.36, 0.47), smoothstep(0.38, 0.72, bN) * 0.6);
  // lividity: blood settles to the low parts of the body and shows through, dark and purple, in
  // large blotches with a broken upper edge
  float low = 1.0 - smoothstep(uSkLivid.x, uSkLivid.y, -dot(pr, down) + (bN - 0.5) * 0.5);
  float livid = clamp(low * 0.85 + smoothstep(0.62, 0.8, bN) * 0.5, 0.0, 1.0) * (0.5 + 0.5 * mN);
  alb = mix(alb, alb * vec3(0.5, 0.36, 0.56), livid * 0.85);
  // the modeller's shade also marks where blood has pooled blue: lips, eyelids, ears, finger ends
  alb = mix(alb, alb * vec3(0.62, 0.5, 0.72), gA.z * 0.6);
  // drained areas are paler and waxy
  float wax = smoothstep(0.5, 0.2, bN) * (1.0 - livid);
  alb *= 1.0 + 0.22 * wax;
  alb *= 0.92 + 0.16 * mN;
  // decay: soft grey-green to near-black mottling
  float nec = smoothstep(0.62 - 0.22 * rot, 0.82 - 0.17 * rot, (1.0 - mN) * 0.6 + bN * 0.4) * rot;
  alb = mix(alb, alb * vec3(0.4, 0.5, 0.33), nec * 0.75);

  // sheen: greasy patches against drier ones
  float gloss = smoothstep(0.35, 0.7, mN * 0.5 + (1.0 - bN) * 0.5);
  float rough = mix(0.62, 0.48, gloss);
  // skin has no grain: only the faintest undulation at the centimetre scale
  vec3 g = mid.yzw * 0.0006;

  // ---- up close: pores and the fine net of creases between them, both from one voronoi fetch
  vec4 fv = vec4(0.5, 0.3, 0.5, 0.5);
  #if SURF_Q > 1
  float fC = sFade(1600.0);
  if (fC > 0.0) {
    fv = sVoro(p, 800.0);
    float line = (1.0 - smoothstep(0.02, 0.16, fv.y)) * fC;
    float pore = (1.0 - smoothstep(0.05, 0.22, fv.x)) * fC;
    alb *= 1.0 - 0.1 * line - 0.04 * pore;
    gHt -= line * 0.00005 + pore * 0.00003;
    rough += (0.16 * (fv.w - 0.5) + 0.08 * line) * fC;
  }
  #endif
  // marbling: the veins show through dead skin as a dark branching net, plain from a few metres
  #if SURF_Q > 0
  {
    float fV = sFade(60.0);
    if (fV > 0.0) {
      vec4 vv = sVoro(p + (mid.x - 0.5) * 0.06 + 9.0, 15.0);
      float vein = (1.0 - smoothstep(0.0, 0.085, vv.y)) * smoothstep(0.35, 0.7, bN * 0.55 + vv.w * 0.45) * (0.45 + 0.55 * rot) * fV;
      alb = mix(alb, alb * vec3(0.5, 0.6, 0.62), vein * 0.75);
    }
  }
  #endif

  // ---- shade painted into hollows by the modeller (eye sockets, nostrils, between the fingers)
  float ao = 1.0 - 0.6 * gA.z, cav = 0.0;
  alb *= 1.0 - 0.5 * gA.z;
  #ifdef CHAR_BODY
  // scalp: hair lying flat and wet on it, thinning to stubble at its edge
  float hairK = clamp(dot(vSUv, uChHairAmt), 0.0, 1.0);
  if (hairK > 0.01) {
    float hk = smoothstep(0.25, 0.75, hairK * (0.6 + 0.8 * mN));
    alb = mix(alb, uChHair * (0.35 + 0.5 * mN), hk * 0.92);
    rough = mix(rough, 0.5, hk);
  }
  #endif

  // ---- wound: bruising spreading outward, a thin pale torn rim, a dark recessed wet interior
  if (W > 0.001) {
    float inW = smoothstep(0.03, 0.3, W);
    float Wn = W * (0.6 + 0.8 * wN) + (mN - 0.5) * 0.14 * inW;
    // bruise: wide, soft-edged and uneven; yellow-green where it is oldest, at the outside
    float bruise = smoothstep(0.03, 0.42, W * (0.7 + 0.6 * bN) + (mN - 0.5) * 0.12 * inW);
    alb = mix(alb, alb * vec3(0.86, 0.86, 0.6), smoothstep(0.02, 0.14, W) * (1.0 - bruise) * 0.4);
    alb = mix(alb, alb * vec3(0.52, 0.3, 0.42), bruise * 0.9);
    // raw and reddened right at the edge
    alb = mix(alb, alb * vec3(0.62, 0.3, 0.27), smoothstep(0.3, 0.52, Wn) * 0.7);
    cav = smoothstep(0.55, 0.6, Wn);
    float deep = smoothstep(0.6, 0.95, Wn);
    float rim = smoothstep(0.46, 0.55, Wn) * (1.0 - cav);
    // torn skin at the edge: thin, pale, ragged
    alb = mix(alb, alb * 1.25 + vec3(0.02, 0.014, 0.012), rim * 0.6);
    rough = mix(rough, 0.6, rim);
    // inside: dark, wet, a little red-brown tissue, the odd pale fleck near the wall
    vec3 flesh = mix(vec3(0.055, 0.012, 0.009), vec3(0.012, 0.003, 0.003), deep) * (0.55 + 0.9 * mN);
    flesh = mix(flesh, vec3(0.11, 0.085, 0.05), smoothstep(0.7, 0.9, fv.w) * (1.0 - deep) * 0.45);
    alb = mix(alb, flesh, cav);
    rough = mix(rough, 0.2 + 0.45 * fv.w, cav);
    g *= 1.0 - cav;
    // relief: the lip stands a little proud, the floor drops away over a soft wall
    gHt += 0.0009 * rim - 0.003 * smoothstep(0.5, 0.8, Wn) - 0.0015 * deep;
    ao *= 1.0 - 0.55 * cav - 0.3 * deep;
  }

  // ---- grime
  float gr = uSkGrime > 0.0 ? uSkGrime * clamp((1.0 - mN) * 0.9 + bN * 0.6 - 0.55 + sSplashBand() * 0.6, 0.0, 1.0) : 0.0;
  alb = mix(alb, vec3(0.03, 0.026, 0.02), gr * 0.6);
  rough = mix(rough, 0.8, gr * 0.5);

  // ---- blood: nearly black, soaked in at the source, running down in trails that taper, split
  // and vary in width; glossy only where it is still wet
  float fresh = 0.0;
  if (marked && uBlood > 0.0) {
    float has = smoothstep(0.0, 0.3, uBlood);
    // trails: streak noise, squeezed along gravity and wandering sideways, cut by a level that
    // rises down the run, so the trails thin out, end at different lengths and break up
    float trail = 0.0;
    if (rn.x > 0.0) {
      vec3 side = cross(down, gN);
      float st = sAnisoD(pr + side * ((mid.x - 0.5) * 0.05), down, 120.0, 5.0).x;
      float lvl = mix(0.4, 0.62, rn.y) - 0.22 * (rn.x - 0.5);
      trail = smoothstep(lvl, lvl + 0.035 + gFp * 60.0, st) * smoothstep(0.0, 0.25, rn.x);
    }
    float Bq = max(B, smoothstep(0.2, 0.6, W) * 0.62);
    float inB = smoothstep(0.02, 0.3, Bq);
    float Bn = Bq * (0.55 + 0.9 * wN) + (mN - 0.5) * 0.2 * inB;
    float dried = max(smoothstep(0.34, 0.42, Bn), trail) * has;
    fresh = max(smoothstep(0.6, 0.72, Bn), trail * (1.0 - smoothstep(0.2, 0.7, rn.y))) * uBlood;
    // a thin washed-out stain around it
    alb = mix(alb, alb * vec3(0.6, 0.36, 0.33), smoothstep(0.16, 0.36, Bn) * (1.0 - dried) * 0.5 * has);
    alb = mix(alb, vec3(0.02, 0.0045, 0.0035) * (0.6 + 0.8 * mN), dried * (1.0 - 0.6 * cav));
    alb = mix(alb, vec3(0.032, 0.003, 0.0025), fresh * 0.8);
    rough = mix(rough, 0.55, dried * (1.0 - fresh));
    rough = mix(rough, 0.12, fresh);
  }

  // ---- rain: skin does not soak. It goes slick, carries clear beads and running films.
  float w = sWetAmount();
  float sheen = 0.03;
  if (w > 0.01) {
    alb *= 1.0 - 0.1 * w;
    rough = mix(rough, mix(0.4, 0.26, gloss), w * (1.0 - 0.5 * cav));
    float bead = 0.0;
    #if SURF_Q > 0
    float fb = sFade(300.0);
    if (fb > 0.0) bead = sBeadLayer(p, 200.0, 0.1 * w, 0.3) * fb;
    #endif
    #if SURF_Q > 1
    if (uRain > 0.0 && sFade(140.0) > 0.0) {
      float rv = sAnisoD(pr - down * (uTime * 0.16), down, 70.0, 2.5).x;
      float riv = smoothstep(0.6, 0.7, rv) * w * uRain * sFade(140.0) * (1.0 - 0.6 * abs(gNw.y));
      gHt += riv * 0.00025;
      bead = max(bead, riv);
    }
    #endif
    rough = mix(rough, 0.07, bead * 0.8);
    alb *= 1.0 + 0.06 * bead;          // a clear drop gathers light; it must not read as a dark speck
    sheen += 0.45 * w;
  }
  gFuzzC = vec3(sheen) * (1.0 - cav);
  s.albedo = alb; s.rough = rough; s.metal = 0.0; s.grad = g;
  s.ao = ao;
}
`;
const skinDef = {
  kind: 'skin',
  space: 'object',
  splash: 0.5,
  lightPars: SOFT_LIGHT,
  glsl: `${PLACED_GLSL}\n${SKIN_GLSL}\nvoid surfaceMain(inout Surf s) { skinSurface(s); }\n`,
};

const CLOTH_KIND = { denim: 0, flannel: 1, canvas: 2, hivis: 3, jersey: 4, leather: 5, cotton: 6, towel: 7 };
const CLOTH_DEFAULTS = {
  denim: { color: 0x24375f, colorB: 0xdcd9cf },
  flannel: { color: 0x7a1a17, colorB: 0x1a1c20 },
  canvas: { color: 0x8a6a3e, colorB: 0x8a6a3e },
  hivis: { color: 0xd8f01c, colorB: 0xbfc2c6 },
  jersey: { color: 0x6f7377, colorB: 0x6f7377 },
  leather: { color: 0x3a2416, colorB: 0x8a6240 },
  cotton: { color: 0x9aa3ad, colorB: 0x9aa3ad },
  towel: { color: 0xb9b2a2, colorB: 0xb9b2a2 },
};

// The weave frame and the tear test, shared by the colour pass and the shadow passes.
// With CLOTH_SLOTS one material dresses a whole figure: kind, colours and tearing come from arrays
// of eight garment slots and the slot is the vertex attribute aSurf.w.
const CLOTH_SHARED = /* glsl */ `
#ifdef CLOTH_SLOTS
uniform float uClKindA[8];
uniform float uClTornA[8];
int gSlot = 0;
#define CL_KIND uClKindA[gSlot]
#define CL_TORN uClTornA[gSlot]
#else
uniform float uClKind;
uniform float uClTorn;
#define CL_KIND uClKind
#define CL_TORN uClTorn
#endif
uniform float uClUv;
// threads per metre
float sClothT() {
  int k = int(CL_KIND + 0.5);
  return k == 0 ? 1500.0 : k == 1 ? 1000.0 : k == 2 ? 620.0 : k == 3 ? 900.0 : k == 4 ? 1100.0 : k == 6 ? 1400.0 : k == 7 ? 420.0 : 520.0;
}
// 2D frame for the weave in metres: garment UVs when the mesh has them, else the dominant rest axis.
// 'seam' falls to 0 where that projection is about to flip.
void sClothFrame(out vec2 uv, out vec3 U, out vec3 V, out float seam) {
  U = vec3(0.0); V = vec3(0.0); seam = 1.0;
  #ifdef CHAR_BODY
  uv = vSA.xy; return;       // the garment's own metric UV (the mesh UV is the atlas)
  #endif
  if (uClUv > 0.0) { uv = vSUv * uClUv; return; }
  vec3 an = abs(gN);
  float top = max(an.x, max(an.y, an.z));
  float second = an.x + an.y + an.z - top - min(an.x, min(an.y, an.z));
  seam = smoothstep(0.0, 0.14, top - second);
  if (an.x >= top) { uv = gP.zy; U = vec3(0.0, 0.0, 1.0); V = vec3(0.0, 1.0, 0.0); }
  else if (an.y >= top) { uv = gP.xz; U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 0.0, 1.0); }
  else { uv = gP.xy; U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 1.0, 0.0); }
}
// Rips run along the weft (u): long ragged slits, with warp threads of different lengths left
// hanging across them. x = 1 where the cloth is gone, y = closeness to a torn edge, z = a surviving
// frayed thread. aSurf.x up to 0.5 is wear and never opens a hole; above 0.5 the cloth tears, a
// little at first and almost everywhere by 1.
vec3 sClothTear(vec2 uv, float T) {
  #ifdef CHAR_BODY
  vec3 cwd = sChWoundCloth(gP - uSeedOff);
  float placed = cwd.x < 2.2 ? 1.0 : 0.0;
  #else
  float placed = smoothstep(0.5, 1.0, gA.x);
  #endif
  if (CL_TORN <= 0.0 && placed <= 0.0) return vec3(0.0);
  // slit noise: slow along the weft, fast across it (one fetch; its upper octaves fray the outline)
  float n = sFbm(vec3(uv.x * 8.0, uv.y * 55.0, 0.37) + uSeedOff, 1.0);
  n = clamp(0.5 + (n - 0.5) * 2.2, 0.0, 1.0);
  // a placed rip: the mask says where, the slit noise decides the outline, and nothing opens at 0
  #ifdef CHAR_BODY
  // (on a character the mask is a soft sphere round a wound: let the slit noise decide more of the
  // outline, so it opens as a few ragged slits rather than a disc)
  // the hole is about the wound's own size with a lobed, slit outline, never a disc; what is worn
  // under another garment opens wider, so the flesh shows through every layer
  float lobes = clamp((sFbm(gP + 77.0, 0.75 / max(cwd.z, 0.01)) - 0.3) * 2.5, 0.0, 1.0);
  bool inner = gSlot == 6 || gSlot == 0 || gSlot == 1;
  float e = placed * 0.5 * ((inner ? 1.4 : 0.85) - cwd.x + (n - 0.5) * 0.85 + (lobes - 0.5) * 0.8);
  if (placed <= 0.0) e = -1.0;
  #else
  float e = placed * (0.2 + 1.3 * n) - 0.5;
  #endif
  // scattered rips
  if (CL_TORN > 0.0) e = max(e, n - 1.0 + 0.3 * CL_TORN);
  if (e < -0.12) return vec3(0.0);
  // bundles of warp threads, about 4 mm apart, survive different distances into the slit
  float tc = uv.x * 250.0;
  vec3 h = sHash3(ivec3(int(floor(tc)), 3, 9));
  float inThread = 1.0 - smoothstep(0.1 + 0.15 * h.z, 0.16 + 0.15 * h.z + gFp * 250.0, abs(fract(tc) - 0.5));
  float thread = step(0.35, h.x) * inThread * (1.0 - smoothstep(0.0, 0.05 + 0.45 * h.y * h.y, e)) * sFade(250.0);
  return vec3((e > 0.0 && thread < 0.5) ? 1.0 : 0.0, smoothstep(-0.12, 0.0, e), thread * step(0.0, e));
}
bool clothCut() {
  #ifdef CLOTH_SLOTS
  gSlot = clamp(int(gA.w + 0.5), 0, 7);
  #endif
  #ifdef CHAR_BODY
  if (sChStump(gP - uSeedOff) > 0.0) return true;
  #endif
  vec2 uv; vec3 U; vec3 V; float seam;
  sClothFrame(uv, U, V, seam);
  return sClothTear(uv, sClothT()).x > 0.5;
}
`;

const CLOTH_GLSL = /* glsl */ `
uniform float uClWet;
uniform float uClDirt;
#ifdef CLOTH_SLOTS
uniform vec3 uClColorA[8];
uniform vec3 uClColorBA[8];
#define CL_COLOR uClColorA[gSlot]
#define CL_COLORB uClColorBA[gSlot]
#else
uniform vec3 uClColor;
uniform vec3 uClColorB;
#define CL_COLOR uClColor
#define CL_COLORB uClColorB
#endif
uniform vec3 uClScatter;
uniform float uClWrap;
uniform vec4 uClStripe;
uniform vec2 uClPanel;
uniform vec4 uClPocket[2];
uniform vec4 uClWearAt[2];
${CLOTH_SHARED}
// plaid: which of the two colours a thread at coordinate x (metres) is dyed, with a thin overcheck.
// Band edges are anti-aliased, and the overcheck goes before it can alias.
vec3 sPlaid(float x) {
  float sx = fract(x / 0.075);
  float aa = gFp / 0.075 + 0.004;
  float b = smoothstep(0.5 - aa, 0.5 + aa, sx) * (1.0 - smoothstep(1.0 - aa, 1.0, sx)) + (1.0 - smoothstep(0.0, aa, sx));
  vec3 c = mix(CL_COLOR, CL_COLORB, clamp(b, 0.0, 1.0));
  float fine = sFade(260.0);
  c = mix(c, mix(c, vec3(0.3, 0.25, 0.13), 0.4), (1.0 - smoothstep(0.012, 0.012 + aa, abs(sx - 0.25))) * fine);
  return mix(c, CL_COLORB * 0.5, (1.0 - smoothstep(0.03, 0.03 + aa, abs(sx - 0.75))) * 0.7);
}
// a row of stitches at signed distance d from a line; 'along' runs down the row
float sStitch(float d, float along) {
  float line = (1.0 - smoothstep(0.0005, 0.0011 + gFp, abs(d))) * min(1.0, 0.0016 / max(gFp, 1e-5));
  return line * mix(0.7, step(0.3, fract(along * 280.0)), sFade(560.0));
}
// The fold field: creases lean towards wrapping the limb axis, but only a little. A lattice noise
// squeezed hard along one axis shows its cells as a checker from a few metres (the round-1 sleeve
// artefact), so the squeeze stays under 1.5 and the lookup is turned off the axes first.
vec4 sFoldD(vec3 p, vec3 ax, float around, float along) {
  vec3 q = p * around + ax * (dot(p, ax) * (along - around));
  // (never the sharpest mips: the top octave of the stored field is a regular 1.5 cm cobble at this
  // scale, which reads as a checker on a sleeve; folds are the two octaves under it)
  vec4 t = textureLod(tNzA, (S_ROT * q) * (1.0 / NZ_BASE), max(gLod + log2(along * (1.0 / NZ_BASE)), 1.7));
  vec3 g = ((t.yzw - 0.5) * (2.0 * NZ_GRAD)) * S_ROT;
  return vec4(t.x, g * around + ax * (dot(g, ax) * (along - around)));
}
void clothSurface(inout Surf s) {
  gScatter = uClScatter; gWrap = uClWrap;
  #ifdef CLOTH_SLOTS
  gSlot = clamp(int(gA.w + 0.5), 0, 7);
  #endif
  vec3 p = gP;
  vec3 pr = p - uSeedOff;
  int kind = int(CL_KIND + 0.5);
  vec3 down = normalize(uDown), ax = normalize(uAxis);
  vec2 uv; vec3 U; vec3 V; float seam;
  sClothFrame(uv, U, V, seam);
  float T = sClothT();

  vec3 tear = sClothTear(uv, T);
  if (tear.x > 0.5) discard;
  #ifdef CHAR_BODY
  if (sChStump(pr) > 0.0) discard;
  // folds, occlusion and seams come from the garment bake
  vec4 cm = texture2D(tChCloth, vSUv);
  gA.x = 0.0; gA.y = 0.0; gA.z = clamp((1.0 - cm.b) * 1.6, 0.0, 1.0);
  #endif

  float fW = sFade(T) * seam;
  #if SURF_Q < 1
  fW = 0.0;       // low: the weave is its mean colour
  #endif
  // three fetches carry the cloth: a slow field (fading, soak, dirt, big drape), the fold field,
  // and one fine value (slubs along the warp for denim, nap and fray for the rest)
  vec4 lfD = sFbmD(p + 3.0, 4.5);
  float lf = clamp((lfD.x - 0.3) * 2.5, 0.0, 1.0);
  bool stiff = kind == 2 || kind == 5;
  #ifdef CHAR_BODY
  vec4 fd = vec4(0.5, 0.0, 0.0, 0.0);
  #else
  vec4 fd = sFoldD(p + 21.0, ax, stiff ? 8.0 : 12.0, stiff ? 12.0 : 18.0);
  #endif
  // folds gather in places (where a limb bends, where cloth hangs slack) and lie flat between
  float gather = 0.35 + 0.65 * smoothstep(0.65, 0.3, lf);
  #ifdef CHAR_BODY
  gather *= 0.3;       // the garment's folds are modelled; the painted ones would read as smudges
  #endif
  fd = vec4(0.5 + (fd.x - 0.5) * gather, fd.yzw * gather);
  float fN = clamp((fd.x - 0.3) * 2.5, 0.0, 1.0);
  float fine = 0.5;
  #if SURF_Q > 1
  if (sFade(520.0) > 0.0) {
    fine = kind == 0 ? sNoise(vec3(uv.x * 260.0, uv.y * 7.0, 1.0) + uSeedOff, 260.0) : sNoise(p * 260.0 + 40.0, 260.0);
    fine = mix(0.5, clamp((fine - 0.5) * 1.6 + 0.5, 0.0, 1.0), sFade(520.0));
  }
  #endif
  vec3 col = CL_COLOR; vec3 avg = CL_COLOR;
  float h = 0.5; vec2 dh = vec2(0.0);
  float rough = 0.9; float fuzz = 0.5; float amp = 0.2; float tape = 0.0;

  // ---- folds: crests catch the light and rub pale, valleys sit in shade
  float fold = gA.z;
  float crest = smoothstep(0.55, 0.85, fN), valley = smoothstep(0.5, 0.15, fN);
  float foldAmp = (kind == 5 ? 0.012 : kind == 2 ? 0.011 : kind == 0 ? 0.008 : 0.01) * (0.7 + 1.5 * fold);
  vec3 gw = fd.yzw * foldAmp + lfD.yzw * 0.02;

  // ---- where the garment is worn: placed mask, placed UV spots, hems and seams, fold crests
  float wear = smoothstep(0.0, 0.5, gA.x);
  float stitch = 0.0, ridge = 0.0, shadowLine = 0.0;
  if (uClUv > 0.0) {
    for (int i = 0; i < 2; i++) {
      vec4 wa = uClWearAt[i];
      if (wa.z > 0.0) wear = max(wear, wa.w * (1.0 - smoothstep(0.3, 1.0, length(uv - wa.xy) / wa.z)));
      vec4 pk = uClPocket[i];
      if (pk.z > 0.0) {
        vec2 e = abs(uv - pk.xy - pk.zw * 0.5) - pk.zw * 0.5;
        float sd = max(e.x, e.y);
        stitch = max(stitch, sStitch(sd + 0.006, uv.x + uv.y));
        shadowLine = max(shadowLine, 1.0 - smoothstep(0.0, 0.0015 + gFp, abs(sd)));
        wear = max(wear, 0.35 * (1.0 - smoothstep(0.0, 0.006, abs(sd))));
      }
    }
    if (uClPanel.x > 0.0) {
      float dS = min(uv.x, uClPanel.x - uv.x), dH = uv.y, dT = uClPanel.y - uv.y;
      stitch = max(stitch, max(sStitch(dS - 0.009, uv.y), max(sStitch(dH - 0.013, uv.x), sStitch(dT - 0.01, uv.x))));
      if (kind == 0) stitch = max(stitch, sStitch(dS - 0.015, uv.y));          // denim's double row
      ridge = max(1.0 - smoothstep(0.011, 0.013 + gFp, dS), 1.0 - smoothstep(0.016, 0.018 + gFp, dH));
      shadowLine = max(shadowLine, max(1.0 - smoothstep(0.0, 0.0015 + gFp, abs(dS - 0.012)), 1.0 - smoothstep(0.0, 0.0015 + gFp, abs(dH - 0.017))));
      // edges of seams and hems rub pale; hems fray
      wear = max(wear, 0.7 * ridge + 0.5 * (1.0 - smoothstep(0.0, 0.035, dH)) * (0.5 + 0.5 * lf));
    }
  }
  #ifdef CHAR_BODY
  stitch = max(stitch, smoothstep(0.62, 0.8, cm.a) * min(1.0, 0.0016 / max(gFp, 1e-5)));
  shadowLine = max(shadowLine, smoothstep(0.38, 0.2, cm.a));
  wear = max(wear, smoothstep(0.55, 0.62, cm.a) * 0.4);
  #endif
  wear = clamp(wear + smoothstep(0.6, 0.95, lf) * 0.3 + crest * 0.25, 0.0, 1.0);

  // ---- the weave
  vec2 c = uv * T;
  if (kind == 4) c.y *= 1.25;
  vec2 ci = floor(c); vec2 f = c - ci;
  float sx = sin(3.14159 * f.x), sy = sin(3.14159 * f.y);
  float cxd = 3.14159 * cos(3.14159 * f.x), cyd = 3.14159 * cos(3.14159 * f.y);
  float yarn = 1.0, yarnB = 1.0;
  if (fW > 0.0) {
    yarn = 0.85 + 0.3 * sHash1(ivec3(int(ci.x), 0, 5));
    yarnB = 0.85 + 0.3 * sHash1(ivec3(0, int(ci.y), 6));
  }
  if (kind == 5) {
    // leather: pebbled grain, a net of creases that break the highlight, pale dry scuffs
    vec4 v = fW > 0.0 ? sVoro(vec3(uv, 0.37) + uSeedOff, T) : vec4(0.4, 0.2, 0.5, 0.5);
    float cell = 1.0 - smoothstep(0.0, 0.16, v.y);
    float creaseW = 0.0006 + 0.0012 * lf;
    float crease = (1.0 - smoothstep(creaseW * 0.4, creaseW + gFp, sIsoDist(fd))) * sFade(300.0) * clamp(0.08 + 0.9 * valley + 0.6 * fold, 0.0, 1.0);
    float scuff = clamp(smoothstep(0.55, 0.9, lf * 0.6 + fine * 0.4) * 0.8 + wear * 0.8, 0.0, 1.0);
    avg = mix(CL_COLOR * 1.2, CL_COLORB * 0.8, scuff * 0.6);
    col = avg * (0.85 + 0.3 * v.z) * (1.0 - 0.14 * cell);
    col *= 1.0 - 0.55 * crease;
    avg *= 1.0 - 0.3 * crease;
    gHt -= (cell * 0.00006 * fW + crease * 0.00035);
    // waxed where it flexes least, dry where it rubs, matt in every crease: never one even gloss
    rough = mix(mix(0.3, 0.5, lf), 0.8, scuff) + 0.12 * (v.z - 0.5) * fW;
    rough = mix(rough, 0.9, crease);
    fuzz = 0.04; amp = 0.0;
  } else if (kind == 0) {
    // denim: 3/1 twill, indigo warp over a pale weft. Behind the twill sit yarn slubs (streaks down
    // the warp) and fading on every ridge, which are what still say "denim" from across the forecourt.
    bool weft = mod(ci.x - ci.y, 4.0) < 0.5;
    float fade = clamp(smoothstep(0.5, 0.9, lf) * 0.45 + wear * 0.9, 0.0, 1.0);
    vec3 warpAvg = mix(CL_COLOR * 1.15, mix(CL_COLOR * 2.6 + 0.05, CL_COLORB * 0.7, 0.5), fade) * (0.8 + 0.4 * fine);
    col = weft ? CL_COLORB * yarnB : warpAvg * yarn;
    h = weft ? 0.2 + 0.4 * sy : 0.55 + 0.45 * sx;
    dh = weft ? vec2(0.0, 0.4 * cyd) : vec2(0.45 * cxd, 0.0);
    col *= 0.55 + 0.6 * h;
    avg = mix(warpAvg, CL_COLORB, 0.16) * 0.92;
    rough = 0.86; fuzz = 0.3; amp = 0.3;
  } else if (kind == 1) {
    // flannel: plain weave of dyed yarns makes the plaid; the brushed nap blurs it and lifts its darks
    bool weft = mod(ci.x + ci.y, 2.0) < 0.5;
    vec3 wc = sPlaid(uv.x), fc = sPlaid(uv.y + 0.031);
    vec3 mean = 0.5 * (CL_COLOR + CL_COLORB);
    avg = mix(0.5 * (wc + fc), mean, 0.12);
    col = mix(weft ? fc * yarnB : wc * yarn, avg, 0.35);
    // where the fallback projection flips the plaid would break: dissolve it into its mean
    avg = mix(mean, avg, seam); col = mix(mean, col, seam);
    float nap = 0.8 + 0.5 * fine;
    avg = avg * nap + 0.008; col = col * nap + 0.008;
    avg = mix(avg, avg * 1.35 + 0.02, wear * 0.6); col = mix(col, col * 1.35 + 0.02, wear * 0.6);
    h = weft ? 0.5 + 0.3 * sy : 0.5 + 0.3 * sx;
    dh = weft ? vec2(0.0, 0.3 * cyd) : vec2(0.3 * cxd, 0.0);
    rough = 0.96; fuzz = 1.1; amp = 0.1;
  } else if (kind == 2) {
    // canvas duck: coarse plain weave you can see from arm's length, stiff, matt
    bool weft = mod(ci.x + ci.y, 2.0) < 0.5;
    avg = CL_COLOR * (0.78 + 0.34 * fine) * (0.85 + 0.3 * lf);
    avg = mix(avg, avg * 1.5 + 0.03, wear * 0.6);
    col = avg * (weft ? yarnB : yarn) * (0.62 + 0.55 * (weft ? sy : sx));
    h = weft ? 0.4 + 0.6 * sy : 0.4 + 0.6 * sx;
    dh = weft ? vec2(0.0, 0.6 * cyd) : vec2(0.6 * cxd, 0.0);
    rough = 0.93; fuzz = 0.22; amp = 0.34;
  } else if (kind == 3) {
    // hi-vis: fluorescent bird's-eye mesh. Fluorescence gives back more than it is lit with.
    vec2 fm = vec2(fract(c.x * 0.5 + 0.5 * mod(floor(c.y * 0.5), 2.0)), fract(c.y * 0.5)) - 0.5;
    float rr = length(fm);
    float pit = 1.0 - smoothstep(0.12, 0.3, rr);
    avg = CL_COLOR * 1.2 * (0.9 + 0.2 * fine);
    col = avg * (1.0 - 0.6 * pit) * (0.9 + 0.2 * yarn) * 1.12;
    h = 1.0 - pit;
    float tt = clamp((rr - 0.12) / 0.18, 0.0, 1.0);
    dh = (fm / max(rr, 1e-4)) * 6.0 * tt * (1.0 - tt) / 0.18 * 0.5;
    rough = 0.78; fuzz = 0.25; amp = 0.14;
  } else if (kind == 6) {
    // cotton: a fine smooth plain weave (shirts, a dress, a uniform); it creases rather than drapes
    bool weft = mod(ci.x + ci.y, 2.0) < 0.5;
    avg = CL_COLOR * (0.86 + 0.22 * fine) * (0.92 + 0.16 * lf);
    avg = mix(avg, avg * 1.25 + 0.02, wear * 0.5);
    col = avg * (weft ? yarnB : yarn) * (0.8 + 0.3 * (weft ? sy : sx));
    h = weft ? 0.5 + 0.5 * sy : 0.5 + 0.5 * sx;
    dh = weft ? vec2(0.0, 0.5 * cyd) : vec2(0.5 * cxd, 0.0);
    rough = 0.84; fuzz = 0.3; amp = 0.1;
  } else if (kind == 7) {
    // towelling: a pile of loops; soft, deep, catches light on every loop top
    vec4 v = fW > 0.0 ? sVoro(vec3(uv, 0.37) + uSeedOff, T) : vec4(0.4, 0.2, 0.5, 0.5);
    float loop = smoothstep(0.02, 0.3, v.y);
    avg = CL_COLOR * (0.8 + 0.3 * lf);
    avg = mix(avg, avg * 0.7, wear * 0.5);                   // matted flat where it is worn
    col = avg * (0.5 + 0.75 * loop) * (0.85 + 0.3 * v.z);
    gHt += loop * 0.0005 * fW;
    rough = 1.0; fuzz = 1.7; amp = 0.0;
  } else {
    // jersey: columns of V-shaped knit stitches, soft and slightly fuzzy
    float leg = f.y - abs(f.x - 0.5) * 1.1;
    float ky = sin(6.28318 * leg);
    h = sx * (0.6 + 0.4 * ky);
    dh = vec2(cxd * (0.6 + 0.4 * ky), sx * 0.4 * 6.28318 * cos(6.28318 * leg) * 1.25);
    avg = CL_COLOR * (0.8 + 0.3 * fine);
    avg = mix(avg, avg * 1.3 + 0.015, wear * 0.5);
    col = avg * (0.72 + 0.45 * h) * yarn;
    rough = 0.93; fuzz = 0.8; amp = 0.12;
  }
  // pilling on the napped cloths: small pale bobbles where it rubs
  #if SURF_Q > 1
  if ((kind == 1 || kind == 4) && sFade(700.0) > 0.0) {
    vec4 pl = sDomes(p + 40.0, 350.0, 0.1 + 0.3 * wear);
    col = mix(col, col * 1.4 + 0.02, pl.x * sFade(700.0) * 0.4);
  }
  #endif
  col = mix(avg, col, fW);
  rough += 0.04 * (1.0 - fW);
  // ---- what the weave adds up to. From a metre the threads are finer than a pixel, but the cloth
  // they make is not smooth: denim's wale runs up it on the diagonal, a knit stands in ribs of
  // stitches, canvas is a basket you can count, flannel and cotton a softer and a finer one, a
  // towel a pile of tufts. Each is drawn at the few millimetres it reads at, as tone and as relief,
  // and gives way to the real threads close to and to the mean far off.
  vec2 mdh = vec2(0.0); float mAmp = 0.0;
  #if SURF_Q > 0
  {
    float Tm = kind == 0 ? 300.0 : kind == 4 ? 280.0 : kind == 2 ? 330.0 : kind == 1 ? 300.0 : kind == 6 ? 420.0 : kind == 7 ? 240.0 : 0.0;
    float fM = Tm > 0.0 ? (1.0 - smoothstep(0.2, 0.55, gFp * Tm * (kind == 0 ? 1.4 : 1.0))) * (1.0 - 0.65 * fW) * seam : 0.0;
    if (fM > 0.0) {
      vec2 m = uv * Tm; vec2 mi = floor(m), mf = m - mi;
      float tone = 0.0;
      if (kind == 0) {
        float ph = 6.28318 * (m.x - m.y) + 1.5 * (fine - 0.5);       // (the slubs nudge the wale, so it is never ruled)
        float r = 0.5 + 0.5 * sin(ph);
        mdh = vec2(1.0, -1.0) * 3.14159 * cos(ph); tone = (r - 0.5) * 0.3; mAmp = 0.2;
      } else if (kind == 4) {
        float leg = mf.y - abs(mf.x - 0.5) * 1.1;
        float wale = sin(3.14159 * mf.x), st = 0.65 + 0.35 * sin(6.28318 * leg);
        mdh = vec2(3.14159 * cos(3.14159 * mf.x) * st, wale * 2.2 * cos(6.28318 * leg));
        tone = (wale * st - 0.55) * 0.36; mAmp = 0.24;
      } else if (kind == 7) {
        vec3 hh = sHash3(ivec3(int(mi.x), int(mi.y), 9));
        vec2 d = mf - 0.5 - (hh.xy - 0.5) * 0.45; float tuft = exp(-dot(d, d) * 9.0);
        mdh = -18.0 * d * tuft; tone = (tuft - 0.4) * 0.5 * (0.7 + 0.6 * hh.z); mAmp = 0.16;
      } else {
        bool wf = mod(mi.x + mi.y, 2.0) < 0.5;
        float k2 = kind == 2 ? 1.0 : kind == 1 ? 0.5 : 0.6;
        float r = wf ? sin(3.14159 * mf.y) : sin(3.14159 * mf.x);
        mdh = wf ? vec2(0.0, 3.14159 * cos(3.14159 * mf.y)) : vec2(3.14159 * cos(3.14159 * mf.x), 0.0);
        tone = (r - 0.62) * 0.36 * k2; mAmp = 0.24 * k2;
      }
      col *= 1.0 + 0.62 * tone * fM;
      mAmp *= 0.6 * fM;
    }
  }
  #endif
  #if SURF_Q < 1
  amp = 0.0;
  #endif

  // ---- retroreflective tape on the vest
  if (kind == 3 && uClStripe.z > 0.0) {
    float aaT = gFp + 0.0008;
    float dY = min(abs(pr.y - uClStripe.x), abs(pr.y - uClStripe.y)) - uClStripe.z;
    float dX = uClStripe.w > 0.0 ? abs(abs(pr.x) - uClStripe.w) - uClStripe.z : 1.0;
    tape = 1.0 - smoothstep(-aaT, aaT, min(dY, dX));
    vec2 hx = fract(uv * 650.0 + 0.5 * floor(uv.yx * 650.0)) - 0.5;
    float prism = smoothstep(0.5, 0.35, max(abs(hx.x), abs(hx.y))) * sFade(650.0);
    col = mix(col, vec3(0.78, 0.79, 0.8) * (0.85 + 0.25 * prism), tape);
    rough = mix(rough, 0.36, tape); fuzz *= 1.0 - tape; fW *= 1.0 - tape;
    wear *= 1.0 - tape;
  }

  // ---- stitching, seam ridges, pocket and hem edges (UV garments)
  vec3 threadCol = kind == 0 ? vec3(0.55, 0.3, 0.08) : kind == 5 ? CL_COLORB * 0.6 : avg * 1.5 + 0.03;
  col = mix(col, threadCol, stitch * 0.85);
  col *= 1.0 - 0.45 * shadowLine;

  // ---- fold shading: large and soft, so no sleeve is an evenly lit tube
  col *= 1.0 - (0.22 + 0.25 * fold) * valley * (1.0 - 0.5 * tape) - 0.3 * fold * fold;
  col *= 0.86 + 0.28 * lf;

  // ---- dirt: ground in low down and in patches, matt
  // dirt: thrown up from the ground and ground in where the garment is worn; a little everywhere
  float dirt = uClDirt * clamp(sSplashBand() * 0.9 + wear * 0.45 + (lf - 0.72) * 1.2, 0.0, 1.0) * (1.0 - 0.6 * tape);
  col = mix(col, vec3(0.045, 0.037, 0.028), dirt * 0.65);
  rough = mix(rough, 0.95, dirt * 0.5);

  // ---- torn edges: pale frayed threads standing off grubby, darkened cloth
  col = mix(col, col * 0.6, tear.y * (1.0 - tear.z) * 0.7);
  col = mix(col, avg * 2.2 + 0.06, tear.z * 0.85);
  // short fray along the edge itself
  col = mix(col, avg * 1.8 + 0.04, smoothstep(0.75, 1.0, tear.y) * smoothstep(0.45, 0.7, fine) * 0.7);
  fuzz += tear.y;

  s.dH = vec2(0.0);
  if (uClUv > 0.0) s.dH = vec2(dot(dh * amp * fW + mdh * mAmp, dFdx(uv)), dot(dh * amp * fW + mdh * mAmp, dFdy(uv)));
  s.albedo = col; s.rough = rough; s.metal = 0.0;
  s.grad = (U * (dh.x * amp * fW + mdh.x * mAmp) + V * (dh.y * amp * fW + mdh.y * mAmp)) + gw;
  s.ao = 1.0 - 0.4 * valley * (0.5 + fold) - 0.3 * shadowLine;
  #ifdef CHAR_BODY
  s.dH += sChSlope(cm.rg);
  s.ao = cm.b * (1.0 - 0.3 * shadowLine);
  s.albedo *= 0.78 + 0.22 * cm.b;       // (the baked occlusion shades; it must not paint streaks into the colour)
  #endif

  // ---- rain
  float w = sWetAmount() * uClWet;
  if (kind == 5) {
    sWetHard(s, w * 0.8, lfD.x);
    s.albedo *= 1.0 - 0.3 * w;
    #ifdef CHAR_BODY
    // work boots are scuffed dull leather, not patent: a wet boot darkens, it does not mirror the lamp
    if (gSlot == 2) s.rough = max(s.rough, 0.62 + 0.25 * lf);
    #endif
  } else {
    // cloth soaks in patches with an edge; soaked cloth is darker, more saturated and lies flatter.
    // Knit clings and takes a slight sheen along its ridges.
    // (rain lands on the shoulders and the top of the back first: they are always the darkest)
    float k = w * smoothstep(0.25, 0.6, lf * 0.55 + (1.0 - fN) * 0.15 + w * 0.6 + smoothstep(1.3, 1.45, pr.y) * (0.25 + 0.45 * smoothstep(0.15, 0.7, gNw.y))) * (1.0 - tape);
    s.albedo = sSat(s.albedo, 1.0 + 0.3 * k) * mix(1.0, kind == 3 ? 0.7 : 0.5, k);
    s.rough = mix(s.rough, s.rough * (kind == 4 ? 0.5 : 0.66), k);
    if (kind == 4) s.rough = mix(s.rough, 0.3, k * crest * 0.8);
    fuzz *= 1.0 - 0.75 * k;
  }

  // ---- blood: soaked in, dark, irregular; it sinks down the cloth, wicks out along the threads
  // and dries with a darker edge
  float B = gA.y;
  #ifdef CHAR_BODY
  {
    vec2 pb = sChPartBlood(pr);
    B = max(B, max(pb.x * 0.85 * smoothstep(0.5 - 0.5 * pb.x, 1.05 - 0.5 * pb.x, lf * 0.5 + fN * 0.5), sChWound(pr) * 0.85));
  }
  #endif
  for (int i = 0; i < 4; i++) {
    vec4 a = uStain[i];
    if (a.w <= 0.0) continue;
    vec3 v = pr - a.xyz; float al = dot(v, down);
    // a soaked patch hangs below its source
    vec3 vs = v - down * (al * (al > 0.0 ? 0.55 : 0.0));
    B = max(B, 1.0 - smoothstep(0.0, 1.0, length(vs) / (a.w * clamp(0.75 + (lf - 0.5) * 0.7 + (fN - 0.5) * 0.5, 0.4, 1.5))));
  }
  if (B > 0.001 && uBlood > 0.0) {
    float inB = smoothstep(0.02, 0.3, B);
    float wick = 0.5;
    #if SURF_Q > 0
    if (sFade(420.0) > 0.0) {
      float w1 = sNoise(vec3(uv.x * 420.0, uv.y * 30.0, 4.0), 420.0), w2 = sNoise(vec3(uv.x * 30.0, uv.y * 420.0, 5.0), 420.0);
      wick = mix(0.5, max(w1, w2), sFade(420.0));
    }
    #endif
    // (on a character the threads wick it less: long thread-straight edges down a pale undershirt read as a smear, not a stain)
    #ifdef CHAR_BODY
    float Bn = B * (0.55 + 0.9 * fN) + ((lf - 0.5) * 0.45 + (wick - 0.5) * 0.12 + (fine - 0.5) * 0.1) * inB;
    #else
    float Bn = B * (0.55 + 0.9 * fN) + ((lf - 0.5) * 0.3 + (wick - 0.5) * 0.35 + (fine - 0.5) * 0.15) * inB;
    #endif
    float soak = smoothstep(0.3, 0.38, Bn) * smoothstep(0.0, 0.3, uBlood);
    float ring = soak * (1.0 - smoothstep(0.38, 0.46, Bn));
    float core = smoothstep(0.6, 0.85, Bn) * uBlood;
    vec3 stain = s.albedo * vec3(0.17, 0.032, 0.027) + vec3(0.006, 0.0008, 0.0006);
    // a faint brown tide mark beyond the soaked edge
    s.albedo = mix(s.albedo, s.albedo * vec3(0.7, 0.5, 0.45), smoothstep(0.2, 0.3, Bn) * (1.0 - soak) * 0.5);
    s.albedo = mix(s.albedo, stain * (1.0 - 0.45 * ring) * (1.0 - 0.3 * core), soak * (1.0 - 0.6 * tape));
    s.rough = mix(s.rough, 0.45, core * 0.6);
    fuzz *= 1.0 - 0.6 * soak;
  }

  gFuzzC = (s.albedo * 1.5 + 0.03) * fuzz;
  gRetro = tape;
}
`;
const CLOTH_CUT_MAIN = 'bool surfaceCut() { return clothCut(); }\n';
const CLOTH_MAIN = 'void surfaceMain(inout Surf s) { clothSurface(s); }\n';
const clothDef = {
  kind: 'cloth', space: 'object', splash: 0.6, lightPars: SOFT_LIGHT,
  cut: CLOTH_SHARED + CLOTH_CUT_MAIN,
  glsl: `${PLACED_GLSL}\n${CLOTH_GLSL}\n${CLOTH_MAIN}`,
};
// one garment per slot (aSurf.w), eight slots: G.mats.cloth({ slots: [...] })
const SLOTS = '#define CLOTH_SLOTS 1\n';
const clothSlotsDef = {
  kind: 'clothSlots', space: 'object', splash: 0.6, lightPars: SOFT_LIGHT,
  cut: SLOTS + CLOTH_SHARED + CLOTH_CUT_MAIN,
  glsl: `${SLOTS}${PLACED_GLSL}\n${CLOTH_GLSL}\n${CLOTH_MAIN}`,
};
// a whole dressed figure in one program: G.mats.cloth({ slots: [...], body: {...} })
const CHAR = '#define CLOTH_SLOTS 1\n#define CHAR_BODY 1\n';
const bodyDef = {
  kind: 'char', space: 'object', splash: 0.6, lightPars: SOFT_LIGHT,
  cut: CHAR + CHAR_SHARED + CLOTH_SHARED + CHAR_CUT_MAIN,
  glsl: `${CHAR}${PLACED_GLSL}\n${CHAR_SHARED}\n${CHAR_PARS}\n${CLOTH_GLSL}\n${CHAR_GLSL}`,
};

const v3 = (a, d) => new Vector3(...(a || d));
function spheres(list) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const w = list && list[i];
    out.push(w ? new Vector4(w.pos[0], w.pos[1], w.pos[2], w.r ?? 0.04) : new Vector4(0, 0, 0, 0));
  }
  return out;
}

// opts: tone (living skin colour; the shader kills it), rot 0..1 (decay: discolouration, mottling,
// veins, deeper wrinkles), grime 0..1, seed (defaults to a fresh one per material),
//   wounds [{pos:[x,y,z], r}]   up to 4 rest-space spheres: bruise at r, ragged cavity in the middle
//   stains [{pos:[x,y,z], r}]   up to 4 rest-space spheres of blood with no wound (mouth, hands)
//   blood 0..1 (default 0.7)    how fresh/heavy the placed blood is; 0 = old dry wounds, no blood
//   axis [x,y,z] (default +Y)   limb direction in rest space: wrinkles wrap it, muscle fibre follows it
//   down [x,y,z] (default -Y)   gravity in rest space: blood runs, rain films, lividity
//   lividity [lo, hi] (default [0.2, 1.0])  rest-space heights between which pooled blood fades out
// plus the common options. Per-vertex: aSurf.x wound, aSurf.y blood. Default space 'object'.
function skinUniforms(opts, ctx) {
  const lv = opts.lividity || [0.2, 1.0];
  return {
    uSkTone: { value: ctx.toColor(opts.tone, 0xb98c6e) },
    uSkRot: { value: opts.rot ?? 0.4 },
    uSkGrime: { value: opts.grime ?? 0.5 },
    uSkLivid: { value: new Vector2(lv[0], lv[1]) },
  };
}
export function makeSkin(opts, ctx) {
  return ctx.build(skinDef, { seed: 1 + ctx.rng.next() * 997, ...opts }, {
    ...skinUniforms(opts, ctx),
    uBlood: { value: opts.blood ?? 0.7 },
    uWound: { value: spheres(opts.wounds) },
    uStain: { value: spheres(opts.stains) },
    uDown: { value: v3(opts.down, [0, -1, 0]) },
    uAxis: { value: v3(opts.axis, [0, 1, 0]) },
    uScatter: { value: new Vector3(0.5, 0.42, 0.36) },
    uWrap: { value: 0.45 },
  });
}

// opts: kind 'denim'|'flannel'|'canvas'|'hivis'|'jersey'|'leather', color, colorB (denim weft,
// flannel second colour, leather scuff), wet 0..1 (how much of the global rain wetness this cloth
// takes up; default 1), torn 0..1 (scattered rips; placed rips come from aSurf.x > 0.5), dirt 0..1,
// seed, stripes {y:[a,b], halfWidth, x} (hi-vis tape at rest-space heights, optional braces at |x|),
//   uvScale (metres per UV unit; `uv: true` = 1)  use the mesh's UVs for weave, plaid and seams.
//                                With 0 (default) the weave is projected from rest space instead.
//   panel [w, h]                 UV garments: size in metres of the UV rectangle. Seams are stitched
//                                along u = 0 and u = w, the hem along v = 0, the top edge along v = h.
//   pockets [{u, v, w, h}]       up to 2 stitched rectangles, metres in UV space
//   wearAt [{u, v, r, amount}]   up to 2 worn spots (knees, elbows), metres in UV space
//   stains [{pos, r}], blood (default 0.7), axis, down   as for skin
// plus the common options. Per-vertex: aSurf.x 0..0.5 wear, 0.5..1 torn; aSurf.y blood; aSurf.z fold.
// Always double-sided. Torn cloth needs G.mats.castCutShadows(mesh) for matching shadows.
export function makeCloth(opts, ctx) {
  const kind = CLOTH_KIND[opts.kind] !== undefined ? opts.kind : 'denim';
  const d = CLOTH_DEFAULTS[kind];
  const st = opts.stripes || (kind === 'hivis' ? { y: [1.05, 1.3], halfWidth: 0.025, x: 0 } : null);
  const rects = (list, f) => [0, 1].map((i) => (list && list[i] ? f(list[i]) : new Vector4(0, 0, 0, 0)));
  const panel = opts.panel || [0, 0];
  // slots: the per-garment values as arrays; body: the skin (and hair, eyes, teeth) uniforms too
  const extra = {};
  let def = clothDef;
  if (opts.slots) {
    def = opts.body ? bodyDef : clothSlotsDef;
    extra.uClKindA = { value: new Float32Array(8) }; extra.uClTornA = { value: new Float32Array(8) };
    extra.uClColorA = { value: [] }; extra.uClColorBA = { value: [] };
    for (let i = 0; i < 8; i++) {
      const sl = opts.slots[i] || {};
      const k = CLOTH_KIND[sl.kind] !== undefined ? sl.kind : 'canvas';
      extra.uClKindA.value[i] = CLOTH_KIND[k];
      extra.uClTornA.value[i] = sl.torn ?? 0;
      extra.uClColorA.value.push(ctx.toColor(sl.color, CLOTH_DEFAULTS[k].color));
      extra.uClColorBA.value.push(ctx.toColor(sl.colorB ?? sl.color, CLOTH_DEFAULTS[k].colorB));
    }
    if (opts.body) Object.assign(extra, skinUniforms(opts.body, ctx), charUniforms(opts.body, ctx, { Vector2, Vector3, Vector4, Color }));
  }
  const wounds = spheres(opts.body ? opts.body.wounds : null);
  return ctx.build(def, { seed: 1 + ctx.rng.next() * 997, side: DoubleSide, ...opts }, {
    ...extra,
    uClScatter: { value: new Vector3(0.55, 0.5, 0.45) },
    uClWrap: { value: 0.3 },
    uClKind: { value: CLOTH_KIND[kind] },
    uClWet: { value: opts.wet ?? 1 },
    uClTorn: { value: opts.torn ?? 0 },
    uClUv: { value: opts.body ? 1 : opts.uvScale ?? (opts.uv ? 1 : 0) },
    uClDirt: { value: opts.dirt ?? 0.6 },
    uClColor: { value: ctx.toColor(opts.color, d.color) },
    uClColorB: { value: ctx.toColor(opts.colorB, d.colorB) },
    uClStripe: { value: st ? new Vector4(st.y[0], st.y[1], st.halfWidth ?? 0.025, st.x ?? 0) : new Vector4(0, 0, 0, 0) },
    uClPanel: { value: new Vector2(panel[0], panel[1]) },
    uClPocket: { value: rects(opts.pockets, (r) => new Vector4(r.u, r.v, r.w, r.h)) },
    uClWearAt: { value: rects(opts.wearAt, (r) => new Vector4(r.u, r.v, r.r ?? 0.08, r.amount ?? 0.8)) },
    uBlood: { value: opts.blood ?? 0.7 },
    uWound: { value: wounds },
    uStain: { value: spheres(opts.stains) },
    uDown: { value: v3(opts.down, [0, -1, 0]) },
    uAxis: { value: v3(opts.axis, [0, 1, 0]) },
    // (skin's own scatter and wrap when this is a character material; unused by plain cloth)
    uScatter: { value: new Vector3(0.5, 0.42, 0.36) },
    uWrap: { value: 0.45 },
  });
}
