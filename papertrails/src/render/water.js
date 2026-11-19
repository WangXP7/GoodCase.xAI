// OWNER: water / ground-print (gold pass). GLSL + tables for the LIVING WATER and the GROUND PRINT of the page.
// Everything here is printed on the page (src/world/book.js chains it into the page shader): no meshes, no passes,
// no draw calls. Animation is a pure function of the time uniform (state.time).
//
// How water pixels are found: the bake (book.js) writes a BLURRED WATER MASK into the alpha of every base-print
// layer of a 'water' tile (teal test on the baked print, plus the pond disc of CONFIG.world.pondRadius / .ponds so a
// grey pond middle has no hole). alpha 0.5 = the shore line, -> 1 = open water, 0.5 -> 0 = the bank outside it, so
// one fetch gives coverage, the cream rim, the waterline and the depth, and a second fetch a little to the north
// gives the mirrored dark band of the far bank (the "reflection").
// Flow: rivers get an analytic frame (s along, c across) from the tile's sockets; the drift speed is the world
// direction FLOW_DIR projected on the local tangent, so it needs no upstream / downstream bookkeeping and is
// continuous across tile seams. All river patterns are periodic per tile and mirror-symmetric for the same reason.
import * as THREE from 'three';
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { MODELS } from '../core/models.js';
import { BIOMES } from '../core/biomes.js';

const NB = BIOMES.length;

/** Defaults; CONFIG.book.water / CONFIG.book.groundPrint override key by key. */
export const WATER_DEFAULTS = {
  enabled: true,
  /** Blur radius of the baked shore mask in tile uv (1 = one tile). Rim, waterline and depth band scale with it. */
  shoreBlur: 0.1,
  ripple: 0.95,       // opacity of the cream ripple dashes / rings
  reflection: 0.9,   // darkness of the mirrored far-bank band
  caustic: 0.07,      // amplitude of the slow light net
  floaters: 1,        // lily pads / leaves / petals / ice plates (0 = none)
  flow: 0.17,         // world units per second along a river
  streak: 0.55,       // night: warm streaks under lamp pools
  /** shortfall pass: REAL mirrored reflections (planar pass, see renderReflection below). */
  mirror: {
    enabled: true,
    scale: 0.5,        // reflection target size relative to the drawing buffer
    maxWidth: 1024,    // cap of the target width (px)
    strength: 0.95,    // how much of the water colour the mirror image replaces
    gain: 0.88,        // brightness of the mirror image (a little darker than the object)
    tint: 0.6,         // shortfall fixer: 0.32 -> 0.6 (muddy brown image -> teal mirror). 0 = raw image, 1 = fully multiplied by the water colour
    distort: 0.017,    // sideways ripple displacement, world units
    ice: 0.34,         // strength on ice (blurred)
    band: 0.22,        // shortfall fixer: 0.4 -> 0.22. what is left of the old printed dark far-bank band while the mirror is on
    clip: 0.03,        // world height below which nothing is mirrored (flat flaps lying on the page)
    night: 0.62,       // gain of HDR-bright pixels (lit panes measure up to ~9 in the pass): mirrored at this fraction, untinted
    include: ['world', 'traveller-root', 'life', 'life_animals'],   // top-level scene nodes drawn in the pass
    exclude: ['life_soft'],                                          // children left out (soft particles)
    // draw-call budget (at most 8): the traveller is 8 separate meshes, so he is mirrored only while he stands within
    // `travellerReach` of a water tile, then only his `travellerMeshes` largest pieces, and the leaves / birds sit out
    traveller: 'traveller-root',
    travellerReach: 1.0,
    travellerMeshes: 5,
    travellerInstead: ['life'],
    minQuality: 'med', // 'low' keeps the printed band only
  },
  // per biome: shallow, deep, rim, river floater (albedo: the grade adds the warmth)
  palette: {
    heartland: ['#6fc4b0', '#1f8f8a', '#f6e6bc', '#dc9440'],   // fixer (gold pass): deeper, more saturated teal, creamier rim
    desert: ['#74c4ac', '#1f8a80', '#f7e3b6', '#c9c06a'],
    snow: ['#b7c8de', '#8fa6c6', '#f8f9fc', '#f6f8fc'],
    blossom: ['#72c2ae', '#218a82', '#f6e4cc', '#f4a3b3'],
    pinewood: ['#58988a', '#1f5f5c', '#cfc49c', '#c7933d'],
  },
};
export const GROUND_DEFAULTS = {
  enabled: true,
  soften: 2.3,     // mip level (at a 512 bake) the ground print is read at: soft blob / path edges
  wobble: 0.011,   // hand-cut wobble of printed edges, tile uv
  mottle: 0.085,   // large-scale paper mottling (value swing)
  clumps: 0.7,     // printed grass tufts / flower dots on open grass
  seam: 0.45,      // tile seam crease strength relative to CONFIG.book.creaseDark / creaseEmboss
  path: 1,         // road treatment (0 = the raw print)
  // round 3 (page)
  wobbleSlow: 0.016,     // slow wander of printed edges, tile uv (gentle width variation of the roads)
  flatten: 0.94,         // how much of the printed tone patches / per-tile tone goes back to the one ground colour
  groundColor: '#b4aa77', // the one ground tone (sRGB hex, albedo; the bake's own value is dropped: it carries a per-tile gradient)
  pathColor: '#eed3a8',  // road tone (sRGB hex): warm cream-beige, luma about 1.25 x the ground after the grade
  contact: 0.13,         // soft darker patch where the bake is darkest (under the props of a tile); 0 = none
  pathWorn: 0.17,        // darkening of the worn centre line
};

export function waterConfig() { return { ...WATER_DEFAULTS, ...((CONFIG.book && CONFIG.book.water) || {}) }; }
export function groundConfig() { return { ...GROUND_DEFAULTS, ...((CONFIG.book && CONFIG.book.groundPrint) || {}) }; }

/**
 * Water kind of a tile model: 0 none, 1 pond, 2 river N-S, 3 river corner N-E, 4 river E-W (bridge), 5 source, 6 ice.
 * disc = [u east, v south, radius] in world units (ponds only).
 */
export function waterKind(id) {
  const m = MODELS[id];
  if (!m || !m.tags || !m.tags.includes('water')) return { kind: 0, disc: null };
  const W = CONFIG.world || {};
  const pd = W.ponds && W.ponds[id];
  if (id === 'frozen_pond') return { kind: 6, disc: pd || [0, 0, W.pondRadius || 0.62] };
  if (pd) return { kind: 1, disc: pd };
  if (id === 'pond') return { kind: 1, disc: [0, 0, W.pondRadius || 0.62] };
  const s = m.sockets || {};
  const r = (k) => s[k] === 'river';
  const n = ['n', 'e', 's', 'w'].filter(r).length;
  if (n === 1) return { kind: 5, disc: null };
  if (r('n') && r('s')) return { kind: 2, disc: null };
  if (r('e') && r('w')) return { kind: 4, disc: null };
  if (r('n') && r('e')) return { kind: 3, disc: null };
  return { kind: 2, disc: null };
}

/** Uniforms shared by the page shader. */
export function waterUniforms() {
  const w = waterConfig(); const g = groundConfig();
  const pal = [];
  const c = new THREE.Color();
  for (let b = 0; b < NB; b++) {
    const p = (w.palette && w.palette[BIOMES[b]]) || WATER_DEFAULTS.palette[BIOMES[b]] || WATER_DEFAULTS.palette.heartland;
    for (let i = 0; i < 4; i++) { c.set(p[i]); pal.push(new THREE.Vector3(c.r, c.g, c.b)); }
  }
  const on = w.enabled !== false ? 1 : 0; const gon = g.enabled !== false ? 1 : 0;
  return {
    uWat: { value: new THREE.Vector4(0, w.ripple * on, w.reflection, w.floaters) },
    uWat2: { value: new THREE.Vector4(w.flow, w.caustic, w.streak, on) },
    uGnd: { value: new THREE.Vector4(g.mottle * gon, g.clumps * gon, gon ? g.seam : 1, g.path * gon) },
    uWatPal: { value: pal },
  };
}

/** Fragment shader of the bake copy pass: rgb = the print, a = blurred water mask (uWk.x = 1) or 0. */
export const BAKE_COPY_FRAG = /* glsl */ `
uniform sampler2D t;
uniform vec4 uWk;   // x: 1 = water tile base print (2 = ice: disc only), yz: pond disc centre (uv), w: pond disc radius (uv, 0 = none)
uniform float uR;   // blur radius (uv)
varying vec2 vUv;
float wmask(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  vec3 c = texture2D(t, uv).rgb;
  float m = smoothstep(0.035, 0.085, min(c.g, c.b) - c.r);
  if (uWk.x > 1.5) return 1.0 - smoothstep(uWk.w * 0.93, uWk.w, distance(uv, uWk.yz));   // ice: the pale print fails the teal test
  if (uWk.w > 0.0) m = max(m, 1.0 - smoothstep(uWk.w * 0.78, uWk.w * 0.9, distance(uv, uWk.yz)));
  return m;
}
void main() {
  vec4 c = texture2D(t, vUv);
  float a = 0.0;
  if (uWk.x > 0.5) {
    float s = 0.0; float ws = 0.0;
    for (int j = -6; j <= 6; j++) {
      for (int i = -6; i <= 6; i++) {
        vec2 o = vec2(float(i), float(j)) / 6.0;
        float w = max(0.0, 1.0 - dot(o, o));
        s += w * wmask(vUv + o * uR); ws += w;
      }
    }
    a = s / ws;
  }
  gl_FragColor = vec4(c.rgb, a);
}`;

/** Declarations + helpers (fragment, after <common>). */
export function waterGLSL() {
  return /* glsl */ `
uniform vec4 uWat;    // x: time (s), y: ripple opacity, z: reflection, w: floaters
uniform vec4 uWat2;   // x: flow speed, y: caustic, z: night streak, w: enabled
uniform vec4 uGnd;    // x: mottle, y: clumps, z: seam factor, w: path treatment
uniform vec3 uWatPal[${NB * 4}];
float gWatGlow;
float gPathM;              // round 3: road mask of the ground print (book.js biome path tones use it)
uniform sampler2D uReflTex;   // planar mirror pass (rgb = lit colour, a = coverage)
uniform vec4 uRefl;           // x: strength (0 = pass off), y: distort (uv at w = 1), z: tint, w: gain
uniform vec4 uRefl2;          // x: ice strength, y: band factor, z: night gain, w: blur step (uv)
varying vec4 vReflP;
vec4 gWatRefl;                // xy: ripple displacement (unit waves), z: mirror weight, w: ice
vec3 gWatCol;
float gWatNight = 0.0;
#define WKF(n) (0.02454369 * float(n))   /* multiples of 2 pi / 256: the world position wraps every 256 units */
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// value noise, f = lattice cells per world unit (256 f must be an integer)
float wNoise(vec2 x, float f) {
  vec2 q = x * f; vec2 i = floor(q); vec2 u = q - i; u = u * u * (3.0 - 2.0 * u); float P = 256.0 * f;
  return mix(mix(wHash(mod(i, P)), wHash(mod(i + vec2(1.0, 0.0), P)), u.x), mix(wHash(mod(i + vec2(0.0, 1.0), P)), wHash(mod(i + vec2(1.0, 1.0), P)), u.x), u.y);
}
// lens-shaped cut dash: c = centred position, L = half length, th = half thickness at the middle
float wLens(vec2 c, float L, float th, float aa) {
  float d = c.x / L; float k = max(1.0 - d * d, 0.0);
  return (1.0 - smoothstep(th * k - aa, th * k + aa, abs(c.y))) * smoothstep(0.0, 0.3, k);
}
// river dashes in the flow frame (s along, c across): a brick pattern, periodic per tile, mirror-symmetric
float wRiverDash(vec2 sc, int ph, float aa, float sg) {
  const float PER = 0.5; const float RH = 0.105;
  float r; float cy;
  if (ph == 0) { r = floor(sc.y / RH + 0.5); cy = sc.y - r * RH; r = abs(r); }
  else { r = floor(abs(sc.y) / RH); cy = abs(sc.y) - (r + 0.5) * RH; }
  float sx = sc.x + 0.5 * PER * mod(r, 2.0);
  float cx = (fract(sx / PER) - 0.5) * PER;
  // round 3: some dashes drop out and their length varies (4 cells = one tile, so the pattern still tiles)
  float dh = wHash(vec2(mod(floor(sx / PER), 4.0) + 0.5, r + 7.0 * float(ph)));
  float L = 0.11 + 0.1 * fract(dh * 7.1);
  return step(0.4, dh) * wLens(vec2(cx, cy), L, 0.0115 * (1.0 + 0.62 * sg * cx / L), aa);   // round 3: thicker head downstream, thin tail
}
// lily pad: disc with a notch, pale cut rim and radial veins. returns (coverage, ink 0..1 for rim / veins)
vec2 wPad(vec2 c, float r, float turn, float aa) {
  float len = length(c);
  float ang = atan(c.y, c.x) + turn;
  float notch = smoothstep(0.26, 0.34, abs(mod(ang, 6.2832) - 3.1416));
  float cov = (1.0 - smoothstep(r - aa, r + aa, len)) * max(notch, 1.0 - smoothstep(r * 0.12, r * 0.3, len));
  float rim = smoothstep(r - 0.009 - aa, r - 0.009 + aa, len);
  float vein = (1.0 - smoothstep(0.1, 0.22, abs(sin(ang * 3.5)))) * smoothstep(r * 0.2, r * 0.45, len) * 0.45;
  return vec2(cov, max(rim, vein));
}
`;
}

/**
 * GROUND PRINT body. Runs right after the base / twin fetches of pageColor().
 * In: p, f, uv, dx, dy, layer, gb, base4 (crisp base print, rgba), flat_. Out: base (vec3), isProp, wq, wpx.
 */
export function groundBodyGLSL(bakeSize) {
  const g = groundConfig();
  const on = g.enabled !== false;
  const gmin = (Math.pow(2, g.soften) / 512).toFixed(6); // uv footprint of the soft read (independent of bake size)
  // round 3 (page): the tile builders print ONE ground tone on every tile and one kraft tone for every road, but the
  // bake carries a strong per-tile value gradient (measured in the atlas, linear: tile centre 0.30, edge middle 0.40,
  // corner 0.60 - the "stain blob" per tile). Chroma survives it (ground r/g 1.01-1.04, b/g 0.53-0.55; road r/g 1.23,
  // b/g 0.645; printed margin about half way), so the shader tells "open ground / tone patch", "road" and "something
  // else" apart by chroma and repaints the first two as continuous world-space fields in its own tones.
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const v3 = (a) => `vec3(${a.map((v) => v.toFixed(4)).join(', ')})`;
  const GC = lin(g.groundColor || GROUND_DEFAULTS.groundColor);
  const PC = lin(g.pathColor || GROUND_DEFAULTS.pathColor);
  const fl = (v, d = 4) => (+v).toFixed(d);
  return /* glsl */ `
  vec2 wq = p + uWorld0;
  float wpx = max(fwidth(p.x), fwidth(p.y));
  float waW = fwidth(base4.a);
  float isProp = smoothstep(0.03, 0.12, distance(base4.rgb, flat_));
  vec3 base = base4.rgb;
  gPathM = pathMask(base4.rgb) * float((gb >> 5) & 1);
  ${on ? /* glsl */ `{
    const vec3 GC = ${v3(GC)}; const vec3 PC = ${v3(PC)};
    const vec2 CG0 = vec2(1.02, 0.535); const vec2 CKD = vec2(0.212, 0.11); const float CKD2 = 0.05704;   // chroma (r/g, b/g) of the baked ground, and the step to the baked road
    // soft, wobbling read of the print: a fine hand-cut wobble + a slow one (gentle width variation of roads / beds)
    vec2 hd0 = 0.5 - abs(f - 0.5);
    float ew = smoothstep(0.0, 0.14, min(hd0.x, hd0.y));
    vec2 wv = ((vec2(wNoise(wq, 4.0), wNoise(wq + 31.7, 4.0)) - 0.5) * ${fl(g.wobble * 2)} + (vec2(wNoise(wq + 7.7, 1.0), wNoise(wq + 61.3, 1.0)) - 0.5) * ${fl(g.wobbleSlow * 2)}) * ew;
    float gfp = max(max(length(dx), length(dy)), 1e-6);
    vec3 gcol = textureGrad(uAtlas, vec3(uv + wv, layer), dx * max(1.0, ${gmin} / gfp), dy * max(1.0, ${gmin} / gfp)).rgb;
    vec2 dS = gcol.rb / max(gcol.g, 1e-3) - CG0;
    float tS = dot(dS, CKD) / CKD2;                              // 0 = ground, about 0.55 = printed margin, 1 = road
    float perpS = length(dS - CKD * clamp(tS, -0.15, 1.15));
    float lumOk = smoothstep(0.14, 0.22, gcol.g);
    float isG = (1.0 - smoothstep(0.12, 0.17, perpS)) * (1.0 - smoothstep(0.22, 0.4, tS)) * lumOk;   // open ground and its printed tone patches
    // ---- road: one continuous hand-cut ribbon ----
    float pbit = float((gb >> 5) & 1) * step(0.001, uGnd.w);
    // round 3 (resumed): tiles without a road print kraft "bare earth" patches in the road tone (yards, under benches,
    // round clearings): they read as pale stain blobs, so they join the ground field too (a faint lighter trace stays)
    float bare = (1.0 - smoothstep(0.07, 0.12, perpS)) * smoothstep(0.22, 0.4, tS) * lumOk * (1.0 - pbit) * step(0.001, uGnd.w);
    isG = max(isG, bare * 0.9);
    // desert / snow models are printed in their own ground tone (and carry the same per-tile value gradient): there the
    // reference chroma is the tile's own mean (top mip of its print). Shared models in those biomes keep the test above.
    int cBio = (gb >> 2) & 7;
    if (cBio == 1 || cBio == 2) {
      vec3 tm = textureGrad(uAtlas, vec3(0.5, 0.5, layer), vec2(1.0, 0.0), vec2(0.0, 1.0)).rgb;
      vec2 tc = tm.rb / max(tm.g, 1e-3);
      float own = smoothstep(0.06, 0.12, length(tc - CG0));
      float isO = (1.0 - smoothstep(0.035, 0.07, length(gcol.rb / max(gcol.g, 1e-3) - tc))) * lumOk * (cBio == 2 ? 0.75 : 1.0);
      isG = mix(isG, isO, own);
    }
    float pmS = 0.0; float fringe = 0.0; float worn = 0.0; float halo = 0.0; float onLine = 0.0;
    if (pbit > 0.5) {
      onLine = (1.0 - smoothstep(0.045, 0.085, perpS)) * lumOk * pbit;
      float kS = clamp(tS, 0.0, 1.0) * onLine;
      // a very soft read (1/16 tile): how deep inside the ribbon this point is
      float gw = max(1.0, 0.0625 / gfp);
      vec3 cW = textureGrad(uAtlas, vec3(uv + wv, layer), dx * gw, dy * gw).rgb;
      float kW = clamp(dot(cW.rb / max(cW.g, 1e-3) - CG0, CKD) / CKD2, 0.0, 1.0);
      float n1 = wNoise(wq + 3.3, 1.5); float n2 = wNoise(wq + 9.1, 6.0); float n3 = wNoise(wq + 2.2, 24.0);
      float ef = mix(kS, kW, 0.45) + (n1 - 0.5) * 0.2 + (n2 - 0.5) * 0.15;
      pmS = smoothstep(0.47, 0.69, ef + (n3 - 0.5) * 0.26) * onLine;   // grainy feathered cut
      halo = smoothstep(0.4, 0.62, ef) * (1.0 - pmS);
      fringe = smoothstep(0.24, 0.5, ef) * (1.0 - smoothstep(0.6, 0.82, ef));
      worn = smoothstep(0.6, 0.92, kW) * pmS;
      gPathM = pmS;
    }
    float open = 1.0 - pmS;
    // ---- one continuous field: tone patches, per-tile tone steps and the road print outside the cut go back to the ground colour ----
    // (the darkest cores of the baked value gradient sit under the props of a tile: a little of them stays as a contact patch)
    float contact = (1.0 - smoothstep(0.29, 0.42, gcol.g)) * isG;
    gcol = mix(gcol, GC, mix(isG * ${fl(g.flatten)}, 1.0, onLine) * open);
    gcol *= 1.0 - ${fl(g.contact)} * contact * open * vec3(0.9, 1.0, 1.15);
    // large-scale paper mottling (three sizes, 0.5 to 4 traveller heights), a little warmer / greener by patch
    float m1 = wNoise(wq, 1.0) - 0.5; float m2 = wNoise(wq + 17.3, 2.5) - 0.5; float m3 = wNoise(wq + 4.4, 0.5) - 0.5;
    float mot = (m3 * 0.5 + m1 * 0.5 + m2 * 0.3) * 2.0;
    gcol *= 1.0 + uGnd.x * mot * (0.45 + 0.55 * open);
    gcol *= vec3(1.0) + uGnd.x * 0.6 * (m2 + m3) * vec3(0.9, 0.05, -1.1) * open;
    if (pbit > 0.5) {
      // warm cream-beige, fine grit, soft tonal patches, a slightly darker worn centre line
      vec3 pcol = PC * (1.0 + 0.09 * (wHash(floor(mod(wq, 256.0) * 96.0)) - 0.5)) * (1.0 + 0.5 * uGnd.x * mot);
      pcol *= 1.0 - ${fl(g.pathWorn)} * worn * (0.5 + wNoise(wq + 12.0, 3.0)) * vec3(0.9, 1.0, 1.15);
      gcol = mix(gcol, mix(gcol, PC, 0.12), halo * uGnd.w);
      gcol = mix(gcol, pcol, pmS * uGnd.w);
      gcol *= 1.0 - 0.07 * fringe * open * uGnd.w * vec3(1.0, 0.8, 1.1);        // darker, greener fringe outside the cut
      // small pebbles biting into the margin
      vec2 pg = wq * 11.0; vec2 pid = mod(floor(pg), 2816.0); float phh = wHash(pid + 13.7);
      vec2 pc = (fract(pg) - 0.5) / 11.0 - (vec2(wHash(pid + 4.1), wHash(pid + 19.3)) - 0.5) * 0.045;
      float pr_ = 0.015 + 0.016 * fract(phh * 9.7);
      float pl = length(pc * vec2(1.0, 1.45));
      float peb = (1.0 - smoothstep(pr_ - wpx, pr_ + wpx, pl)) * step(phh, 0.5 * fringe + 0.02 * pmS) * uGnd.w;
      vec3 pebC = mix(vec3(0.5, 0.4, 0.29), vec3(0.93, 0.8, 0.62), smoothstep(pr_ * 0.5, -pr_ * 0.4, pc.y + pc.x * 0.4));
      gcol = mix(gcol, pebC * mix(1.0, 0.8, smoothstep(pr_ * 0.75, pr_, pl)), peb);
    }
    // printed grass ticks and flower dots, in drifts, on open ground and biting into the road margin
    float grassy = max(isG * open, fringe * 0.85) * (1.0 - smoothstep(0.02, 0.2, base4.a));
    if (grassy * uGnd.y > 0.01) {
      vec2 cg = wq * 5.0; vec2 cid = mod(floor(cg), 1280.0);
      float ch = wHash(cid + 3.1); float ch2 = wHash(cid + 57.7);
      float clus = smoothstep(0.52, 0.7, wNoise(wq + 5.1, 0.75));
      float fdr = smoothstep(0.56, 0.72, wNoise(wq + 88.8, 0.75));
      // fixer (round 3): ~70 % fewer ticks, free position / size / lean / ink per tick, so they stop reading as a grid
      float tks = 0.72 + 0.56 * fract(ch * 17.3);
      vec2 cc = ((fract(cg) - 0.5) * 0.2 - (vec2(ch2, fract(ch2 * 13.7)) - 0.5) * 0.11) / tks;
      cc.x += (fract(ch2 * 29.1) - 0.5) * 0.7 * (0.04 - cc.y);
      float hh = 0.04 - cc.y;                       // height above the tuft foot (north = up the page)
      float wd = 0.009 * (1.0 - hh / 0.095) + 0.0015;
      float inh = step(0.0, hh) * step(hh, 0.095);
      float bl = max(max(1.0 - smoothstep(wd, wd + wpx, abs(cc.x + 0.5 * hh)), 1.0 - smoothstep(wd, wd + wpx, abs(cc.x - 0.06 * hh))), 1.0 - smoothstep(wd, wd + wpx, abs(cc.x - 0.55 * hh))) * inh;
      float present = step(ch, 0.01 + 0.19 * clus + 0.24 * fringe) * grassy * uGnd.y;
      gcol = mix(gcol, gcol * vec3(0.5, 0.7, 0.4), bl * present * (0.45 + 0.55 * fract(ch * 41.3)));
      // one small five-petal flower in some cells of a flower drift (free position in the cell: no dot grid)
      vec2 fq = (fract(cg) - 0.5) * 0.2 - (vec2(fract(ch * 91.7), fract(ch2 * 47.3)) - 0.5) * 0.13;
      float fr0 = 0.014 + 0.006 * fract(ch * 53.0);
      float fl5 = length(fq) / (0.78 + 0.22 * cos(atan(fq.y, fq.x) * 5.0 + ch * 6.0));
      float dot_ = (1.0 - smoothstep(fr0, fr0 + wpx, fl5)) * step(fract(ch * 31.0), 0.012 + 0.36 * fdr) * isG * open * grassy * uGnd.y;
      float fkind = step(0.5, wNoise(wq + 55.5, 0.5) + 0.3 * (fract(ch * 77.0) - 0.5));   // one colour leads per drift
      vec3 fcol = mix(mix(vec3(0.95, 0.88, 0.7), vec3(0.9, 0.42, 0.16), fkind), mix(vec3(0.9, 0.5, 0.14), vec3(0.45, 0.2, 0.08), fkind), 1.0 - smoothstep(fr0 * 0.3, fr0 * 0.3 + wpx, length(fq)));
      gcol = mix(gcol, fcol, dot_ * 0.85);
    }
    base = gcol;
  }` : ''}
`;
}

/**
 * WATER body. Runs after the biome tint block, before the twin mix.
 * In: base, flat_, isProp, base4, waW, wq, wpx, l (model frame, -1..1), rot, uv, dx, dy, layer, w0..w3 / b0..b3.
 * kinds = [{ index, kind, disc }] of the water models. hasPools = the paper material's lamp-pool uniforms exist.
 */
/** Night: warm streaks running toward the camera under every lit lamp pool (main(), after pageColor()). */
export const WATER_GLOW_GLSL = /* glsl */ `
if (gWatGlow > 0.0 && uPaperPoolCol.w > 0.0) {
  float nk = clamp(uPaperPoolCol.r * 1.2, 0.0, 1.0);   // lamp pools fade in with the night
  gWatNight = nk;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.52, 0.7), gWatGlow * nk);   // deep blue night water
  float wg = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 pp = uPaperPool[i];
    vec2 dl = vPaperW.xz - pp.xz;
    float sx = dl.x + 0.035 * sin(dl.y * 38.0 - uWat.x * 2.0);
    wg += pp.w * exp(-sx * sx / 0.007) * smoothstep(0.05, 0.3, dl.y) * (1.0 - smoothstep(0.6, 2.1, dl.y)) * (0.55 + 0.45 * sin(dl.y * 64.0 + uWat.x * 1.7));
  }
  totalEmissiveRadiance += gWatGlow * wg * uWat2.z * uPaperPoolCol.rgb;
}`;

/**
 * shortfall pass: the REAL mirror image (main(), after pageColor() and WATER_GLOW_GLSL). The pass target holds LIT
 * colour, so it replaces albedo and goes out as emissive (it must not be lit a second time).
 */
export const WATER_MIRROR_GLSL = /* glsl */ `
if (uRefl.x > 0.0 && gWatRefl.z > 0.003) {
  float rwi = 1.0 / max(vReflP.w, 1e-3);
  vec2 ruv = vReflP.xy * rwi + gWatRefl.xy * uRefl.y * rwi;
  vec4 rc = texture2D(uReflTex, ruv);
  if (gWatRefl.w > 0.5) {
    // ice: a faint, blurry image (9 taps)
    vec2 bs = vec2(uRefl2.w, uRefl2.w * 1.7);
    rc = rc * 0.2 + 0.1 * (texture2D(uReflTex, ruv + bs * vec2(1.0, 0.4)) + texture2D(uReflTex, ruv + bs * vec2(-1.0, -0.4)) + texture2D(uReflTex, ruv + bs * vec2(-0.4, 1.0)) + texture2D(uReflTex, ruv + bs * vec2(0.4, -1.0))
       + texture2D(uReflTex, ruv + bs * vec2(2.0, -0.6)) + texture2D(uReflTex, ruv + bs * vec2(-2.0, 0.6)) + texture2D(uReflTex, ruv + bs * vec2(0.6, 2.0)) + texture2D(uReflTex, ruv + bs * vec2(-0.6, -2.0)));
  }
  vec2 re = smoothstep(vec2(0.0), vec2(0.03), ruv) * (1.0 - smoothstep(vec2(0.97), vec2(1.0), ruv));
  float rcov = clamp(rc.a, 0.0, 1.0) * gWatRefl.z * re.x * re.y;
  float rk = rcov * mix(uRefl.x, uRefl2.x, gWatRefl.w);
  vec3 rcol = rc.rgb / max(rc.a, 0.05);
  float rmx = max(gWatCol.r, max(gWatCol.g, gWatCol.b));
  vec3 rtint = mix(vec3(1.0), gWatCol / max(rmx, 0.05), uRefl.z);
  // bright pixels (lit panes, lantern points) stay bright: they are light sources, not paper
  float rhot = smoothstep(0.9, 2.2, max(rcol.r, max(rcol.g, rcol.b)));
  rcol *= mix(rtint * uRefl.w * mix(vec3(1.0), vec3(0.55, 0.66, 0.82), gWatNight), vec3(uRefl2.z), rhot);   // night: paper sinks into the blue, lights do not
  rk = max(rk, rhot * rcov * mix(1.0, min(1.0, uRefl2.x * 1.5), gWatRefl.w));
  diffuseColor.rgb *= 1.0 - rk;
  totalEmissiveRadiance += rk * rcol;
  if (gWatNight > 0.05 && gWatRefl.w < 0.5) {
    // round 3 (page): at night lit panes and lamps in the mirror pull out into warm broken streaks toward the viewer
    // (4 taps up the mirror image, water pixels only, night only)
    float sk = 0.0;
    for (int i = 1; i <= 4; i++) {
      vec2 su = ruv + vec2(0.0025 * sin(gl_FragCoord.y * 0.21 + uWat.x * 2.0 + float(i)), 0.011 * float(i));
      vec4 s4 = texture2D(uReflTex, su);
      vec3 sc4 = s4.rgb / max(s4.a, 0.05);
      sk += smoothstep(0.95, 2.2, max(sc4.r, max(sc4.g, sc4.b))) * clamp(s4.a, 0.0, 1.0) * (1.0 - 0.2 * float(i));
    }
    float brk = 0.45 + 0.55 * smoothstep(-0.3, 0.6, sin(gl_FragCoord.y * 0.75 + uWat.x * 1.7 + 3.0 * sin(gl_FragCoord.x * 0.05)));
    totalEmissiveRadiance += gWatRefl.z * gWatNight * sk * brk * 0.42 * vec3(1.0, 0.72, 0.38);
  }
}`;

/** Uniforms + water-cell list shared by the page shader (book.js) and the mirror pass (post.js calls renderReflection). */
const _placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
_placeholder.needsUpdate = true;
export const REFLECT = {
  uniforms: {
    uReflTex: { value: _placeholder },
    uReflMat: { value: new THREE.Matrix4() },
    uRefl: { value: new THREE.Vector4(0, 0, 0, 1) },
    uRefl2: { value: new THREE.Vector4(0.3, 1, 1, 0.004) },
  },
  /** World x, z of the inked water cells on the page: written by book.js every update. */
  cells: new Float32Array(512),
  count: 0,
  /** Debug / checks: was the pass drawn this frame, and its draw calls. */
  active: false,
  calls: 0,
  target: null,
};

const _R = {
  cam: null, frustum: new THREE.Frustum(), pv: new THREE.Matrix4(), sphere: new THREE.Sphere(new THREE.Vector3(), 1.5),
  camPos: new THREE.Vector3(), rot: new THREE.Matrix4(), look: new THREE.Vector3(), up: new THREE.Vector3(),
  plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(), clear: new THREE.Color(), hidden: [], frames: 0, travList: [], travN: -1,
  bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1),
};
const QRANK = { low: 0, med: 1, high: 2 };

/**
 * Planar mirror pass: the upright paper (tile batches, traveller, animals, leaves / birds) drawn once more with the
 * camera mirrored about the page plane y = 0 into a small HDR target, ONLY while an inked water cell is inside the
 * view frustum. No shadow-map re-render (the previous frame's maps are sampled), no MSAA, page / table / soft
 * particles hidden. Call right before the main scene render. `quality` = 'low' | 'med' | 'high'.
 */
export function renderReflection(renderer, scene, camera, width, height, quality = 'high') {
  const w = waterConfig();
  const m = { ...WATER_DEFAULTS.mirror, ...(w.mirror || {}) };
  const U = REFLECT.uniforms;
  REFLECT.active = false; REFLECT.calls = 0;
  U.uRefl.value.x = 0;
  _R.frames++;
  if (w.enabled === false || m.enabled === false || REFLECT.count === 0 || _R.frames < 3) return;
  if ((QRANK[quality] ?? 2) < (QRANK[m.minQuality] ?? 1) || !camera.isPerspectiveCamera) return;
  camera.updateMatrixWorld();
  _R.camPos.setFromMatrixPosition(camera.matrixWorld);
  if (_R.camPos.y <= m.clip + 0.05) return;
  _R.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _R.frustum.setFromProjectionMatrix(_R.pv);
  let seen = false;
  for (let i = 0; i < REFLECT.count && !seen; i++) {
    _R.sphere.center.set(REFLECT.cells[i * 2], 0, REFLECT.cells[i * 2 + 1]);
    seen = _R.frustum.intersectsSphere(_R.sphere);
  }
  if (!seen) return;

  // target
  const tw = Math.max(2, Math.min(m.maxWidth, Math.round(width * m.scale)));
  const th = Math.max(2, Math.round(tw * height / Math.max(1, width)));
  let rt = REFLECT.target;
  if (!rt) {
    const canFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    rt = REFLECT.target = new THREE.WebGLRenderTarget(tw, th, { type: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: 0 });
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    rt.texture.name = 'water-mirror';
  } else if (rt.width !== tw || rt.height !== th) rt.setSize(tw, th);

  // mirrored camera (same construction as three's Reflector, plane y = 0, normal +y)
  const vc = _R.cam || (_R.cam = new THREE.PerspectiveCamera());
  _R.rot.extractRotation(camera.matrixWorld);
  _R.look.set(0, 0, -1).applyMatrix4(_R.rot).add(_R.camPos);
  _R.look.y = -_R.look.y;
  vc.position.set(_R.camPos.x, -_R.camPos.y, _R.camPos.z);
  _R.up.set(0, 1, 0).applyMatrix4(_R.rot); _R.up.y = -_R.up.y;
  vc.up.copy(_R.up);
  vc.lookAt(_R.look);
  vc.near = camera.near; vc.far = camera.far;
  vc.updateMatrixWorld();
  vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
  vc.projectionMatrix.copy(camera.projectionMatrix);
  vc.projectionMatrix.elements[8] *= -1; vc.projectionMatrix.elements[12] *= -1;
  U.uReflMat.value.copy(_R.bias).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
  // oblique near plane at y = clip: nothing below it is drawn (flat flaps, the mirrored-away half space)
  _R.plane.set(_R.up.set(0, 1, 0), -m.clip).applyMatrix4(vc.matrixWorldInverse);
  const cp = _R.clip.set(_R.plane.normal.x, _R.plane.normal.y, _R.plane.normal.z, _R.plane.constant);
  const pe = vc.projectionMatrix.elements; const q = _R.q;
  q.x = (Math.sign(cp.x) + pe[8]) / pe[0];
  q.y = (Math.sign(cp.y) + pe[9]) / pe[5];
  q.z = -1.0;
  q.w = (1.0 + pe[10]) / pe[14];
  cp.multiplyScalar(2.0 / cp.dot(q));
  pe[2] = cp.x; pe[6] = cp.y; pe[10] = cp.z + 1.0; pe[14] = cp.w;
  vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

  // draw: only the listed top-level nodes (lights stay), no background, no shadow-map update
  const hidden = _R.hidden; hidden.length = 0;
  let travNear = false; let trav = null;
  for (const o of scene.children) if (o.name === m.traveller) trav = o;
  if (trav) {
    const reach = TILE_SIZE / 2 + m.travellerReach;
    for (let i = 0; i < REFLECT.count && !travNear; i++) travNear = Math.max(Math.abs(REFLECT.cells[i * 2] - trav.position.x), Math.abs(REFLECT.cells[i * 2 + 1] - trav.position.z)) < reach;
  }
  for (const o of scene.children) {
    if (o.isLight || !o.visible) continue;
    const skip = !m.include.includes(o.name) || (o === trav && !travNear) || (travNear && m.travellerInstead.includes(o.name));
    if (skip) { if (o.isMesh || o.isGroup || o.isPoints || o.isLine || o.children.length) { o.visible = false; hidden.push(o); } continue; }
    for (const c of o.children) if (c.visible && m.exclude.includes(c.name)) { c.visible = false; hidden.push(c); }
  }
  if (trav && travNear) {
    // his largest pieces only (sorted once per mesh count)
    const list = _R.travList;
    let n = 0; trav.traverse((c) => { if (c.isMesh) n++; });
    if (_R.travN !== n) {
      _R.travN = n; list.length = 0;
      trav.traverse((c) => {
        if (!c.isMesh || !c.geometry) return;
        if (!c.geometry.boundingSphere) c.geometry.computeBoundingSphere();
        list.push({ mesh: c, r: c.geometry.boundingSphere.radius * c.getWorldScale(_R.look).length() });
      });
      list.sort((p, q) => q.r - p.r);
    }
    for (let i = m.travellerMeshes; i < list.length; i++) { const c = list[i].mesh; if (c.visible) { c.visible = false; hidden.push(c); } }
  }
  const prevRT = renderer.getRenderTarget();
  const prevBg = scene.background;
  const prevAuto = renderer.shadowMap.autoUpdate; const prevNeeds = renderer.shadowMap.needsUpdate;
  const prevAutoClear = renderer.autoClear;
  renderer.getClearColor(_R.clear); const prevAlpha = renderer.getClearAlpha();
  const calls0 = renderer.info.render.calls;
  scene.background = null;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  try { renderer.render(scene, vc); } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(_R.clear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevAuto; renderer.shadowMap.needsUpdate = prevNeeds;
    scene.background = prevBg;
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  }
  REFLECT.active = true;
  REFLECT.calls = renderer.info.render.calls - calls0;
  U.uReflTex.value = rt.texture;
  // sideways displacement: world units -> uv at clip w = 1 (projection scale x 0.5)
  U.uRefl.value.set(m.strength, m.distort * 0.5 * camera.projectionMatrix.elements[0], m.tint, m.gain);
  U.uRefl2.value.set(m.ice, m.band, m.night, 3.0 / tw);
}

export function waterBodyGLSL(kinds) {
  const H = (TILE_SIZE / 2).toFixed(3);
  const chain = kinds.map((k) => `if (mi == ${k.index}) { wk = ${k.kind}; wd = vec3(${k.disc ? [k.disc[0] / (TILE_SIZE / 2), k.disc[1] / (TILE_SIZE / 2), k.disc[2] / (TILE_SIZE / 2)].map((v) => v.toFixed(4)).join(', ') : '0.0, 0.0, 1.0'}); }`).join(' else ');
  return /* glsl */ `
  gWatGlow = 0.0; gWatRefl = vec4(0.0); gWatCol = vec3(0.0);
  {
    int mi = int(layer * 0.5 + 0.25);
    int wk = 0; vec3 wd = vec3(0.0, 0.0, 1.0);
    ${chain}
    if (wk > 0 && uWat2.w > 0.5) {
      float T = uWat.x;
      // round 3: the bank line wanders (noise-warped mask): uneven width, small inlets and spits
      float wa0 = base4.a;
      float wwin = smoothstep(0.03, 0.3, wa0) * (1.0 - smoothstep(0.75, 0.98, wa0)) * (wk == 6 ? 0.45 : 1.0);
      float wa = clamp(wa0 + wwin * ((wNoise(wq + 1.9, 2.0) - 0.5) * 0.22 + (wNoise(wq + 6.3, 7.0) - 0.5) * 0.09
        + 0.17 * smoothstep(0.68, 0.9, wNoise(wq + 40.0, 1.25)) - 0.12 * smoothstep(0.7, 0.9, wNoise(wq + 70.0, 1.25))), 0.0, 1.0);
      float aw = clamp(waW * 0.75, 0.008, 0.12);
      float wm = smoothstep(0.5 - aw, 0.5 + aw, wa);
      #define WPAL(o) (w0 * uWatPal[b0 * 4 + o] + w1 * uWatPal[b1 * 4 + o] + w2 * uWatPal[b2 * 4 + o] + w3 * uWatPal[b3 * 4 + o])
      vec3 cSh = WPAL(0); vec3 cDp = WPAL(1); vec3 cRim = WPAL(2); vec3 cFl = WPAL(3);
      float snowW = (b0 == 2 ? w0 : 0.0) + (b1 == 2 ? w1 : 0.0) + (b2 == 2 ? w2 : 0.0) + (b3 == 2 ? w3 : 0.0);
      float blosW = (b0 == 3 ? w0 : 0.0) + (b1 == 3 ? w1 : 0.0) + (b2 == 3 ? w2 : 0.0) + (b3 == 3 ? w3 : 0.0);
      bool pondK = wk == 1 || wk == 6;
      float ice = wk == 6 ? 1.0 : 0.0;
      // flow frame
      vec2 sc = wq; vec2 tl = vec2(0.0); float ctr; float sScale = 1.0;
      if (pondK) { ctr = 1.0 - smoothstep(0.1, 0.95, distance(l, wd.xy) / wd.z); }
      else {
        if (wk == 3) { vec2 r = l - vec2(1.0, -1.0); float rl = max(length(r), 1e-3); sc = vec2(atan(r.y, -r.x) * 1.2732395 - 1.0, rl - 1.0); tl = vec2(r.y, -r.x) / rl; sScale = 1.2732395; }
        else if (wk == 4) { sc = l; tl = vec2(1.0, 0.0); }
        else { sc = l.yx; tl = vec2(0.0, 1.0); }
        sc *= ${H};
        ctr = 1.0 - smoothstep(0.0, 0.3, abs(sc.y));
        for (int i = 0; i < 3; i++) { if (i < rot) tl = vec2(-tl.y, tl.x); }
      }
      float spd = dot(tl, vec2(0.8, 0.6)) * uWat2.x;
      // printed water: lighter at the bank, darker toward the middle, mottled like the rest of the paper
      // shortfall fixer: two STEPPED depth tones (printed bands, wobbling edge) over the soft gradient
      float dpt = clamp(smoothstep(0.55, 1.0, wa) * 0.45 + 0.7 * ctr * ctr, 0.0, 1.0);
      float dpn = dpt + 0.16 * (wNoise(wq, 3.0) - 0.5) + 0.12 * (wNoise(wq + 8.0, 1.0) - 0.5);
      float dst = 0.3 * smoothstep(0.13, 0.2, dpn) + 0.3 * smoothstep(0.38, 0.46, dpn) + 0.36 * smoothstep(0.66, 0.76, dpn);   // round 3: three soft steps
      // round 3: where the marks gather: along the bank and around whatever folds flat onto / stands in the water
      float bankB = smoothstep(0.52, 0.6, wa) * (1.0 - smoothstep(0.66, 0.88, wa));
      float gwd = max(1.0, 0.03125 / max(max(length(dx), length(dy)), 1e-6));
      float propN = smoothstep(0.02, 0.1, distance(textureGrad(uAtlas, vec3(uv, twinLayer), dx * gwd, dy * gwd).rgb, textureGrad(uAtlas, vec3(uv, layer), dx * gwd, dy * gwd).rgb));
      float clW = clamp(max(bankB * 0.75, propN), 0.0, 1.0);
      vec3 W = mix(cSh, cDp, mix(dpt, dst, 0.62 * (1.0 - ice)));
      W *= 0.94 + 0.12 * wNoise(wq, 2.5);
      // mirrored far bank: a darker, greyer band below whatever stands north of the water, its edge wobbling
      float rcol = wNoise(vec2(wq.x, 3.0), 11.0);   // column noise: the mirror reads as reed / trunk streaks of uneven length
      vec2 ro = vec2(0.03 * sin(wq.y * WKF(2200) + T * 1.3) * (1.0 - ice), -(0.11 + 0.2 * rcol)) / ${H};
      for (int i = 0; i < 3; i++) { if (i < rot) ro = vec2(ro.y, -ro.x); }
      float aN = textureGrad(uAtlas, vec3(uv + vec2(ro.x, -ro.y) * 0.5, layer), dx, dy).a;
      float refl = clamp((wa - aN) * 3.0, 0.0, 1.0) * (0.55 + 0.45 * smoothstep(0.25, 0.6, rcol)) * uWat.z * mix(1.0, 0.4, ice) * (uRefl.x > 0.0 ? uRefl2.y : 1.0);
      refl *= mix(0.7 + 0.3 * sin(wq.y * WKF(3400) + 1.5 * sin(wq.x * WKF(500) + T * 0.9)), 1.0, ice);
      W = mix(W, W * vec3(0.36, 0.5, 0.44) + vec3(0.03, 0.034, 0.004), refl);
      // mirrored props: whatever folds flat onto the water (reeds, bridge deck, rocks) stays on it as a dark broken mirror
      float prf = isProp * uWat.z * (0.72 + 0.28 * sin(wq.y * WKF(3000) + 1.5 * sin(wq.x * WKF(700) - T * 1.1))) * mix(1.0, 0.45, ice);
      W = mix(W, mix(W, flat_, 0.3) * vec3(0.62, 0.76, 0.72), prf * 0.5);   // shortfall fixer: was a dark smudge (0.5 / 0.8)
      float lilyF = 0.0; float lilyC = 0.0; float foam = 0.0;
      float rip = 0.0; float flo = 0.0; float floInk = 0.0; float floSh = 0.0; vec3 floCol = cFl;
      if (ice < 0.5) {
        // slow light net
        float ca = sin(wq.x * WKF(1250) + 1.4 * sin(wq.y * WKF(900) + T * 0.55)) * sin(wq.y * WKF(1500) + 1.2 * sin(wq.x * WKF(1050) - T * 0.4));
        W *= 1.0 + uWat2.y * (smoothstep(0.3, 0.95, ca) - 0.5 * smoothstep(0.3, 0.95, -ca));
        if (pondK) {
          // drifting, slowly twinkling cream dashes (screen-horizontal) + now and then a spreading ring
          vec2 q = vec2(wq.x - 0.03 * T, wq.y) / vec2(0.5, 0.125);
          vec2 id = mod(floor(q), vec2(512.0, 2048.0));
          float h = wHash(id + 1.7);
          vec2 c = (fract(q) - 0.5) * vec2(0.5, 0.125); c.x += (wHash(id + 9.2) - 0.5) * 0.1;
          rip = step(h, 0.06 + 0.5 * clW) * wLens(c + vec2(0.0, 0.012 * (1.0 - c.x * c.x / 0.0256)), 0.12 + 0.07 * fract(h * 7.3), 0.011, wpx) * (0.4 + 0.6 * (0.5 + 0.5 * sin(T * 0.8 + h * 40.0)));
          vec2 rg = wq / 0.64; vec2 rid = mod(floor(rg), 400.0); float rh = wHash(rid + 11.3);
          vec2 rc = (fract(rg) - 0.5) * 0.64 - (vec2(wHash(rid + 5.1), wHash(rid + 23.9)) - 0.5) * 0.3;
          float rt = fract(T * 0.17 + rh * 9.0);
          float rd = length(rc * vec2(1.0, 1.45));
          float ring = max(max(1.0 - smoothstep(0.004, 0.004 + wpx, abs(rd - (0.02 + 0.15 * rt))), (1.0 - smoothstep(0.004, 0.004 + wpx, abs(rd - (0.012 + 0.1 * rt)))) * 0.75), (1.0 - smoothstep(0.0035, 0.0035 + wpx, abs(rd - (0.006 + 0.05 * rt)))) * 0.55);
          rip = max(rip, step(rh, 0.16 + 0.5 * smoothstep(0.0, 0.6, clW)) * ring * (1.0 - rt) * smoothstep(0.0, 0.12, rt) * 0.85);
          // lily pads (none on snow): they turn and bob a little, each with its own shadow on the water
          vec2 pg = wq / 0.32; vec2 pid = mod(floor(pg), 800.0); float ph = wHash(pid + 41.3);
          vec2 pc = (fract(pg) - 0.5) * 0.32 - (vec2(wHash(pid + 2.9), wHash(pid + 77.1)) - 0.5) * 0.13 - 0.006 * vec2(sin(T * 0.5 + ph * 30.0), cos(T * 0.41 + ph * 17.0));
          vec2 pl = -pc / ${H};
          for (int i = 0; i < 3; i++) { if (i < rot) pl = vec2(pl.y, -pl.x); }
          float pdc = distance(l + pl, wd.xy) / wd.z;   // pad centre, 0 = middle of the pond, 1 = bank
          float pin = step(ph, 0.22 + 0.3 * smoothstep(0.3, 0.6, pdc) + 0.6 * smoothstep(0.36, 0.6, wNoise(wq + 33.0, 1.5))) * step(pdc, 0.74) * (1.0 - snowW) * uWat.w;
          float pr_ = 0.056 + 0.024 * fract(ph * 5.7);
          vec2 pd2 = wPad(pc, pr_, ph * 6.2832 + 0.25 * sin(T * 0.3 + ph * 9.0), wpx);
          flo = pd2.x * pin; floInk = pd2.y;
          floSh = (1.0 - smoothstep(pr_ - wpx, pr_ + wpx * 3.0, length(pc - vec2(0.014, 0.02)))) * pin;
          floCol = mix(vec3(0.5, 0.56, 0.17), vec3(0.42, 0.52, 0.16), fract(ph * 3.3));
          vec2 lfc = pc - vec2(0.014, -0.01); float lfa = atan(lfc.y, lfc.x); float lfr = length(lfc);
          lilyF = (1.0 - smoothstep(0.03 - wpx, 0.03 + wpx, lfr / (0.7 + 0.3 * cos(lfa * 5.0 + ph * 6.0)))) * pin * step(fract(ph * 11.3), 0.45);
          lilyC = 1.0 - smoothstep(0.009, 0.009 + wpx, lfr);
        } else {
          // rows of dashes carried by the flow: two phases cross-fade so the pattern never shears
          float present = smoothstep(0.64, 0.76, wNoise(wq + vec2(0.03, 0.0) * T, 2.0) + 0.24 * clW);   // round 3: glints gather at banks, stones, reeds   // shortfall fixer: a few long glints, not a brick pattern
          float sgn = spd < 0.0 ? -1.0 : 1.0; float fade = smoothstep(0.01, 0.04, abs(spd));
          float streak = 0.0;
          for (int i = 0; i < 2; i++) {
            float fph = fract(T / 7.0 + 0.5 * float(i)); float tau = (fph - 0.5) * 7.0; float wgt = 1.0 - abs(2.0 * fph - 1.0);
            rip += wgt * wRiverDash(vec2(sc.x - spd * sScale * tau, sc.y), i, wpx, sgn);
            // round 3 (resumed): faint long current lines sliding with the flow (periodic per tile along the stream)
            float sx2 = sc.x - spd * sScale * tau;
            float rowS = floor(sc.y * 8.0 + 0.5 + 0.5 * float(i));
            float lnS = abs(fract(sc.y * 8.0 + 0.5 * float(i) + 0.12 * sin(sx2 * 3.14159 + rowS)) - 0.5) / 8.0;
            streak += wgt * (1.0 - smoothstep(0.0025, 0.0025 + wpx, lnS)) * smoothstep(0.35, 0.95, sin(sx2 * 6.28318 + rowS * 2.3));
            // floaters ride the same flow in the canonical (downstream) frame: leaves, petals, ice plates
            float fx = (sgn * sc.x - abs(spd) * sScale * tau) * 2.0 + 0.5 * float(i);
            float cls = mod(floor(fx), 4.0);
            vec2 fc = vec2((fract(fx) - 0.5) * 0.5, sgn * sc.y - (mod(cls, 2.0) - 0.5) * 0.22 - (cls - 1.5) * 0.03);
            float fr_ = cls * 1.9 + 0.5 * sin(T * 0.5 + cls * 2.0) + float(i);
            vec2 fq = vec2(fc.x * cos(fr_) - fc.y * sin(fr_), fc.x * sin(fr_) + fc.y * cos(fr_));
            float keep = wgt * fade * step(0.5, wNoise(wq, 1.5) + 0.25 * blosW + 0.12 * snowW - 0.18 * mod(cls + float(i), 2.0)) * uWat.w;
            float shp = mix(wLens(fq, mix(0.05, 0.032, blosW), mix(0.021, 0.016, blosW), wpx), 1.0 - smoothstep(0.062 - wpx, 0.062 + wpx, length(fq) + 0.014 * sin(atan(fq.y, fq.x) * 3.0 + cls)), snowW);
            flo = max(flo, shp * keep);
            floSh = max(floSh, mix(wLens(fq - vec2(0.012, 0.016), 0.055, 0.024, wpx * 2.0), 1.0 - smoothstep(0.066, 0.075, length(fq - vec2(0.012, 0.016))), snowW) * keep);
            floInk = max(floInk, (1.0 - smoothstep(0.0, 0.004 + wpx, abs(fq.y))) * 0.5 * (1.0 - snowW));
          }
          rip *= present;
          W = mix(W, W * 1.1 + vec3(0.02, 0.03, 0.03), streak * fade * 0.5 * smoothstep(0.62, 0.85, wa) * smoothstep(0.35, 0.65, wNoise(wq + 50.0, 1.5)));
          // round 3: foam flecks on the outer bank of a bend and at the bridge piers, twinkling
          float fz = 0.0;
          if (wk == 3) fz = bankB * smoothstep(0.02, 0.14, sc.y);
          else if (wk == 4) fz = (1.0 - smoothstep(0.03, 0.17, abs(abs(sc.x) - 0.38))) * smoothstep(0.58, 0.72, wa);
          if (fz > 0.01) {
            float fn = wNoise(wq + vec2(0.012 * sin(T * 0.7 + wq.y * 9.0), 0.012 * cos(T * 0.6 + wq.x * 9.0)), 24.0);
            foam = smoothstep(0.6, 0.7, fn * (0.55 + 0.6 * wNoise(wq + 2.0, 6.0))) * fz * (0.6 + 0.4 * sin(T * 1.6 + wNoise(wq, 3.0) * 25.0));
          }
        }
      } else {
        // ice: static pale sheen bands and white looping skate lines
        float sh = smoothstep(0.55, 0.95, sin((wq.x * 0.8 + wq.y) * WKF(260) + 2.0 * wNoise(wq, 2.0)));
        W = mix(W, cRim, sh * 0.3);
        vec2 kg = wq / 0.5; vec2 kid = mod(floor(kg), 512.0); float kh = wHash(kid + 3.3);
        vec2 kc = (fract(kg) - 0.5) * 0.5 - (vec2(kh, wHash(kid + 8.8)) - 0.5) * 0.2;
        float kr = 0.11 + 0.1 * fract(kh * 9.1);
        rip = (1.0 - smoothstep(0.0035, 0.0035 + wpx, abs(length(kc * vec2(1.0, 1.25 + 0.5 * kh)) - kr))) * step(0.25, kh) * 0.75;
      }
      float inner = smoothstep(0.62, 0.9, wa);
      // real mirror (main(), WATER_MIRROR_GLSL): under the ripples / floaters / rim, not on flat-folded props; the
      // image shifts sideways row by row (two wave trains) and breaks into bands
      gWatCol = W;
      float rw1 = sin(wq.y * WKF(1700) + T * 1.5 + 1.8 * sin(wq.x * WKF(260) + T * 0.45));
      float rw2 = sin(wq.y * WKF(4100) - T * 2.2 + 1.2 * sin(wq.x * WKF(610) - T * 0.7));
      gWatRefl.xy = vec2(rw1 + 0.45 * rw2, 0.35 * rw2) * (1.0 - ice);
      gWatRefl.z = wm * smoothstep(0.5, 0.66, wa) * (1.0 - clamp(rip * inner * (ice > 0.5 ? 0.8 : uWat.y), 0.0, 1.0)) * (1.0 - flo * inner)
        * (1.0 - 0.75 * prf) * mix(0.82 + 0.18 * smoothstep(-0.75, -0.35, rw2), 1.0, ice) * mix(1.0, 0.8, ctr * ctr);
      gWatRefl.w = ice;
      W = mix(W, W * 0.72, floSh * inner * 0.55);
      rip = max(rip, foam);
      W = mix(W, mix(cRim, vec3(1.0), 0.6), rip * inner * (ice > 0.5 ? 0.8 : uWat.y));
      W = mix(W, mix(floCol, mix(floCol * 0.62, mix(cRim, vec3(1.0), 0.3), pondK ? step(0.5, floInk) : 0.0), floInk * (pondK ? 1.0 : 0.6)), flo * inner);
      W = mix(W, mix(vec3(0.99, 0.87, 0.85), vec3(0.95, 0.62, 0.14), lilyC), lilyF * inner);
      // darker waterline just inside the shore, then the pale hand-cut rim outside it
      W *= 1.0 - 0.42 * wm * (1.0 - smoothstep(0.52, 0.62, wa));
      // shortfall fixer: the shore is a thin crisp cream line at the water and, outside it, a sandy band of uneven
      // width that fades into the ground (was one hard band of constant width with a contact shadow)
      float shN = wNoise(wq, 1.5); float shF = 0.06 * (wNoise(wq, 5.0) - 0.5);
      float shLo = 0.03 + 0.2 * shN;
      float rimSoft = smoothstep(shLo, shLo + 0.26, wa + shF);
      // round 3 (resumed): the cream cut line swells, thins and now and then breaks where grass reaches the water
      float rwN = wNoise(wq + 23.0, 1.8);
      float rLo = 0.25 + 0.17 * wNoise(wq + 11.0, 1.1);
      float rimLine = smoothstep(rLo, rLo + 0.07, wa + shF * 0.5) * (1.0 - 0.75 * smoothstep(0.68, 0.8, rwN));
      float rimM = max(rimLine * 0.94, rimSoft * 0.58) * (1.0 - wm);
      vec3 sandC = mix(base * vec3(1.16, 1.08, 0.9) + vec3(0.03, 0.02, 0.0), cRim, 0.55);
      base = mix(base, mix(sandC, cRim, rimLine) * (0.95 + 0.1 * wNoise(wq, 10.0)), rimM);
      base = mix(base, W, wm);
      gWatGlow = wm;   // water coverage: night tint + lamp streaks are added in main() (WATER_GLOW_GLSL)
    }
    flat_ = mix(base, flat_, isProp);
  }
`;
}
