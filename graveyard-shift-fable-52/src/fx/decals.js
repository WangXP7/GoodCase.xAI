// Projected decals: bullet holes per surface, blood pools and wall spatter, scorch marks.
// One instanced draw of oriented boxes in the post 'fx' slot. Each fragment rebuilds the world
// position under it from scene depth and maps it into the decal's box, so a decal follows the
// surface it landed on, is clipped by the box (nothing hangs past an edge into the air) and is
// rejected on faces that turn away from the decal's normal (no smear down the side of a block).
// Decals are drawn after scene lighting, so they are lit here by the shared fx light set.
// Blood is the exception: it is a second draw of the same buffer that MULTIPLIES what is already in
// the frame (a dark red film: dst * (1 - a + a * tint)), so it takes whatever light the surface has,
// baked interior light and shadows included, is darker than wet asphalt at night, deep red on a lit
// floor, and the puddle's reflections stay on top of it, tinted.
//
// Two rings share the buffer. Blood keeps its own share (160 of 256 on desktop tiers, 64 of 96 on
// mobile, times G.fx.gore) and recycles its oldest; bullet holes and scorches have the rest. Neither
// can push the other out. Blood stays until the game restarts.
//
// Blood in the rain: a decal is told how wet its surface is at its centre and how that changes
// across it (it may straddle a roof's drip line). Where it is wet the core has no hard rim and a
// pale, feathered halo of thinned blood creeps out of it, downhill (down a wall; along one seeded
// direction on the flat), and fades over 20-40 s while the core stays.
import {
  InstancedBufferGeometry, BoxGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, RawShaderMaterial, GLSL3,
  Mesh, BackSide, NormalBlending, CustomBlending, AddEquation, DstColorFactor, OneMinusSrcAlphaFactor, ZeroFactor, OneFactor, Vector3, Matrix4, Quaternion,
} from 'three';
import { FX_LIGHT_GLSL } from './fxlights.js';
import { D_CELL } from './atlas.js';

export const MAX_DECALS = 256;
const STRIDE = 20;
const FADE_AHEAD = 24; // slots ahead of the write cursor that are told to fade out
const FADE_TIME = 0.4; // a slot is never rewritten while it is still fading (see `free`): no pop
const CORE = 0.64; // a blood decal's shape fills this much of its box: the rest is room for the halo
// The rain-thinned halo round blood on a wet surface. It reads the core's own field (a blurrier mip of
// an atlas shape, the drops' distance field for a spatter), so it follows the shape and can never
// fill the decal's box; it is feathered out between FEATHER[0] and FEATHER[1] of the box and is thin.
export const HALO = { lodBias: 1.5, lodMax: 3.5, feather: [0.3, 0.5], alpha: 0.15 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// The halo's opacity at box coordinates (x, y in -0.5..0.5) where the core's blurred field is `field`
// (0 = no blood near): the shader computes exactly this, times wetness, age and a little noise (<= 1).
export function haloWeight(x, y, field) {
  return sstep(0, 0.25, field) * sstep(HALO.feather[1], HALO.feather[0], Math.max(Math.abs(x), Math.abs(y))) * HALO.alpha;
}
// The mip a halo samples for a core drawn at `lod`.
export const haloLod = (lod) => Math.min(Math.max(lod + HALO.lodBias, 2), HALO.lodMax);
// Metres across the spatter one hit leaves: 0.15-0.4, larger for a heavier hit. r: a random in [0, 1).
export const SPATTER = { min: 0.15, max: 0.4 };
export function spatterSize(amount, r) {
  const k = Math.min(1, Math.max(0, (amount - 0.5) / 1.0));
  return Math.min(SPATTER.max, SPATTER.min + (SPATTER.max - SPATTER.min) * (0.25 + 0.5 * k) * (0.4 + 1.2 * r));
}
// Depth of a decal's box (metres, through the surface): thin on a floor so nothing standing on it is
// painted; deeper on walls and vehicles, whose colliders stand a little off what is drawn.
export const boxDepth = (size, floor) => (floor ? Math.min(Math.max(size * 0.2, 0.1), 0.12) : Math.max(size * 0.5, 0.36));
// how the buffer is shared: [total live decals, of which blood] from the tier's decal cap
export function decalShares(cap) {
  const total = Math.max(16, Math.min(MAX_DECALS, Math.floor(cap > 0 ? cap : MAX_DECALS)));
  return [total, total >= 256 ? 160 : Math.round((total * 2) / 3)];
}
// live blood decals allowed at a gore level (1 or 0.3)
// (gore 0: none; anything that is not a number counts as full)
export const goreOf = (g) => (typeof g === 'number' && g === g ? Math.min(1, Math.max(0, g)) : 1);
export const bloodCap = (share, gore) => { const g = goreOf(gore); return g <= 0 ? 0 : Math.max(4, Math.min(share, Math.round(share * g))); };

const VERT = /* glsl */ `precision highp float;
in vec3 position;
in vec4 d0; // xyz centre, w size (0 = unused slot)
in vec4 d1; // orientation quaternion, local z = surface normal
in vec4 d2; // atlas cell, spawn time, shade, seed
in vec4 d3; // rgb tint, a wetness
in vec4 d4; // x: time at which this decal has finished fading out (ring about to reuse the slot)
            // blood: y growth time constant (s), zw how the wetness changes across the box
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
flat out vec4 vD0; flat out vec4 vD1; flat out vec4 vD2; flat out vec4 vD3; flat out float vKill; flat out vec3 vD4;
uniform float uTime;
uniform float uBlood; // 1: this draw is the blood, 0: everything else
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vD0 = d0; vD1 = d1; vD2 = d2; vD3 = d3; vKill = d4.x; vD4 = d4.yzw;
  if (d0.w <= 0.0 || uTime >= d4.x || (abs(d2.z - 3.0) < 0.5) != (uBlood > 0.5)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float nY = qrot(d1, vec3(0.0, 0.0, 1.0)).y;
  float dp = nY > 0.6 ? clamp(d0.w * 0.2, 0.1, 0.12) : max(d0.w * 0.5, 0.36);
  vec3 wp = d0.xyz + qrot(d1, position * vec3(d0.w, d0.w, dp));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = (post, blood) => /* glsl */ `precision highp float;
#define BLOOD_PASS ${blood ? 1 : 0}
precision highp sampler2D;
${post.glsl.common}
${post.glsl.depth}
${FX_LIGHT_GLSL}
uniform sampler2D uAtlas;
uniform vec2 texel;
uniform vec2 resolution;
uniform mat4 projMatrix;
uniform float uTime;
uniform vec3 cameraPosition;
flat in vec4 vD0; flat in vec4 vD1; flat in vec4 vD2; flat in vec4 vD3; flat in float vKill; flat in vec3 vD4;
out vec4 outColor;
const float CORE = ${CORE.toFixed(3)};

vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
float dn(vec2 p, float seed) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec3 b = vec3(i + 2048.0, seed);
  return mix(mix(hash13(b), hash13(b + vec3(1, 0, 0)), f.x), mix(hash13(b + vec3(0, 1, 0)), hash13(b + vec3(1, 1, 0)), f.x), f.y);
}
vec3 hash3(vec3 p) {
  uint h = hashU(uvec3(ivec3(p)));
  return vec3(float(h & 1023u), float((h >> 10u) & 1023u), float((h >> 20u) & 1023u)) / 1023.0;
}
// A spatter drawn from its seed, so no two are alike: a parent drop, a few lesser ones and a cast of
// satellites thrown mostly toward +y (the way the blood was travelling), each round or drawn out along
// its own line of flight by at most 2.5x. q: -1..1 across the core. th: the growth threshold. px: one
// pixel in q units (drops are anti-aliased against it and fade out below it). soft: extra edge width
// (rain). run > 0 (a wall, a car): some drops trail a thin run toward -y, run x a few radii long.
// Out: coverage, the field (1 at a drop's centre, 0 at its rim, negative outside in drop radii), and
// the outward direction on the winning drop.
void spatter(vec2 q, float seed, float th, float px, float soft, float run, out float cov, out float fmax, out vec2 nrm) {
  cov = 0.0; fmax = -8.0; nrm = vec2(0.0);
  float sd = floor(seed * 4000.0);
  vec3 g = hash3(vec3(sd, 3.0, 1.0));
  if (g.x > 0.5) q.x = -q.x;
  float n = 8.0 + floor(g.y * 6.99);
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    if (fi >= n) break;
    vec3 h = hash3(vec3(sd, fi, 5.0)); vec3 k = hash3(vec3(sd, fi, 9.0));
    float a; float d; float rad; float el;
    if (i == 0) { a = (h.x - 0.5) * 0.8; d = 0.14 * h.y; rad = 0.24 + 0.2 * h.z; el = 1.0 + 0.5 * k.x; }
    else if (i < 4) { a = (h.x - 0.5) * 2.8; d = 0.32 + 0.5 * h.y; rad = 0.05 + 0.12 * h.z * h.z; el = 1.0 + 1.1 * k.x; }
    else { a = (h.x - 0.5) * (k.y < 0.3 || run > 0.0 ? 6.2832 : 2.2); d = 0.4 + 0.75 * sqrt(h.y); rad = 0.016 + 0.05 * h.z * h.z; el = 1.0 + 1.5 * k.x; }
    vec2 u = vec2(sin(a), cos(a));
    vec2 c = u * d;
    vec2 p = q - c;
    float pl = dot(p, u); float pt = u.x * p.y - u.y * p.x;
    pl = pl > 0.0 ? pl * 1.25 : pl; // blunt on the far side, drawn out behind
    float dd = length(vec2(pl / el, pt)) / rad;
    if (rad > 0.09) dd += (dn(q * 5.0, sd) - 0.5) * 0.34; // a big drop's edge is not a circle
    float f = 1.0 - dd; float er = rad;
    if (run > 0.0 && k.z > 0.4 && rad > 0.028) {
      vec2 b = c - vec2((h.x - 0.5) * 0.04, rad * (1.2 + 5.0 * k.y) * run);
      vec2 pa = q - c; vec2 ba = b - c;
      float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float w = rad * mix(0.6, 0.2, smoothstep(0.0, 0.35, t)) * (1.0 + 0.5 * smoothstep(0.85, 1.0, t));
      float fr = (1.0 - length(pa - ba * t) / w) * mix(0.9, 0.6, t);
      if (fr > f) { f = fr; er = w; }
    }
    float w = max(0.1, 2.5 * px / er) + soft;
    cov = max(cov, clamp((f - th) / w + 0.5, 0.0, 1.0) * clamp(er / px, 0.0, 1.0));
    if (f > fmax) { fmax = f; nrm = p / max(length(p), 1e-4) * smoothstep(0.3, 1.0, dd); }
  }
}
void main() {
  vec2 suv = gl_FragCoord.xy * texel;
  float dz = rawDepth(suv);
  vec3 wp = worldPos(suv);
  vec3 ddx = dFdx(wp); vec3 ddy = dFdy(wp);
  if (dz >= 1.0) discard;
  float size = vD0.w;
  vec4 qi = vec4(-vD1.xyz, vD1.w);
  vec3 nd = qrot(vD1, vec3(0.0, 0.0, 1.0));
  vec3 lp = qrot(qi, wp - vD0.xyz) / vec3(size, size, nd.y > 0.6 ? clamp(size * 0.2, 0.1, 0.12) : max(size * 0.5, 0.36));
  if (any(greaterThan(abs(lp), vec3(0.5)))) discard;

  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 ns = normalize(cross(ddx, ddy));
  if (dot(ns, V) < 0.0) ns = -ns;
  int shade = int(vD2.z + 0.5);
  // blood wraps round a curved body (a car's shoulder line) further than a bullet hole may
  float facing = shade == 3 ? smoothstep(0.0, 0.45, dot(ns, nd)) : smoothstep(0.3, 0.6, dot(ns, nd));
  if (facing <= 0.0) discard;
  vec3 tx = qrot(vD1, vec3(1.0, 0.0, 0.0));
  vec3 ty = qrot(vD1, vec3(0.0, 1.0, 0.0));

  // mip level from the footprint of one pixel (screen-space derivatives break at depth edges)
  float fill = shade == 3 ? CORE : 1.0; // how much of the box the atlas cell covers
  float pix = dist * 2.0 / (projMatrix[1][1] * resolution.y);
  float lodRaw = log2(max(pix * 256.0 / (size * fill), 1.0));
  float cell = vD2.x;
  float acell = cell >= 100.0 ? 0.0 : cell; // 100+: a spatter drawn from its seed, not from the atlas
  vec2 cellAt = vec2(mod(acell, 4.0), floor(acell / 4.0));
  float lod = min(lodRaw, 4.0);
  float mrg = exp2(lod) / 256.0; // keep the filter footprint inside the cell
  vec2 cuv = (cellAt + clamp(lp.xy / fill + 0.5, mrg, 1.0 - mrg)) / 4.0;
  vec4 t = textureLod(uAtlas, cuv, lod);
  vec2 nxy = t.rg * 2.0 - 1.0;
  float age = uTime - vD2.y;
  if (age < 0.0) discard; // not there yet
  vec3 glow = vec3(0.0);
  float seed = vD2.w * 97.0;
  float grain = dn(lp.xy * size * 240.0, seed);
  float grain2 = dn(lp.xy * size * 60.0, seed + 3.0);

  vec3 albedo = vec3(0.0); vec3 F0 = vec3(0.04); vec3 N = ns;
  float alpha = 0.0; float rough = 0.85; float sheen = 0.0;

  if (shade == 0) { // crater in asphalt / concrete / dirt
    float f = t.a + (grain2 - 0.5) * 0.14;
    float m = smoothstep(0.26, 0.36, f);
    float dust = smoothstep(0.02, 0.24, t.a) * (1.0 - m);
    N = normalize(ns + (tx * nxy.x + ty * nxy.y) * 1.8 * m);
    albedo = mix(vD3.rgb * (0.65 + 0.7 * grain), vec3(0.004), t.b * 0.94);
    albedo = mix(albedo, vD3.rgb * 1.1, dust * (1.0 - m));
    alpha = m * mix(0.86, 1.0, t.b) + dust * (0.06 + 0.12 * grain);
  } else if (shade == 1) { // punched sheet metal: hole, burr, bare steel, chipped paint, dent
    float f = t.a;
    float jag = f + (grain2 - 0.5) * 0.16 + (dn(lp.xy * 9.0, seed + 9.0) - 0.5) * 0.3;
    float hole = t.b;
    float bare = smoothstep(0.46, 0.5, jag);
    float primer = smoothstep(0.33, 0.37, jag);
    float dent = smoothstep(0.02, 0.4, f);
    N = normalize(ns + (tx * nxy.x + ty * nxy.y) * 1.5);
    albedo = mix(vec3(0.3, 0.27, 0.24), vec3(0.5, 0.51, 0.53), bare);
    albedo = mix(vD3.rgb, albedo, primer);
    albedo = mix(albedo, vec3(0.003), hole);
    F0 = mix(vec3(0.04), vec3(0.62, 0.63, 0.66), bare * (1.0 - hole));
    rough = mix(0.6, 0.3 + 0.15 * grain, bare);
    alpha = max(primer, dent * 0.4);
  } else if (shade == 2) { // glass: hole, crushed frosting, cracks
    float hole = t.b;
    float lines = t.r * (0.25 + 0.75 * dn(lp.xy * 7.0, seed + 5.0)); // cracks catch the light unevenly
    float frost = t.g * (0.6 + 0.8 * grain);
    albedo = mix(vec3(0.7, 0.78, 0.76), vec3(0.008), hole);
    N = normalize(ns + (tx * (grain - 0.5) + ty * (grain2 - 0.5)) * 1.6 * (1.0 - hole));
    F0 = vec3(0.08); rough = 0.2;
    alpha = max(hole * 0.92, max(lines * 0.7, frost * 0.5));
#if BLOOD_PASS
  } else if (shade == 3) { // blood: grows outward and darkens; thinned and feathered where the surface is wet
    float wetL = clamp(vD3.a + dot(vD4.yz, lp.xy), 0.0, 1.0);
    float grow = 1.0 - exp(-max(age, 0.0) / max(vD4.x, 0.02));
    float th = mix(0.9, 0.1, grow);
    float spread = 1.0 - exp(-max(age, 0.0) / 9.0);
    float box = max(abs(lp.x), abs(lp.y));
    float m; float f; float hal;
    if (cell >= 100.0) {
      float qs = CORE * 0.5;
      spatter(lp.xy / qs, vD2.w, th, pix / (size * qs), wetL * (0.1 + 0.35 * spread), cell - 100.0, m, f, nxy);
      m *= smoothstep(0.5, 0.47, box);
      hal = smoothstep(-(0.5 + 1.5 * spread), 0.0, f - th) * 0.9;
      f = clamp(f, 0.0, 1.0);
    } else {
      f = t.a + (grain2 - 0.5) * 0.05;
      float soften = wetL * 0.16; // on standing water the edge is a gradient, not a rim
      m = smoothstep(th - soften, th + 0.05 + soften * 1.6, f);
      // the halo: a blurrier level of the same field, drawn a little downhill (down a wall; along one
      // seeded direction on the flat). Never coarser than HALO.lodMax: a coarser level is the whole cell.
      float sa = fract(vD2.w * 7.31) * 6.2831853;
      vec2 flow = nd.y > 0.6 ? vec2(cos(sa), sin(sa)) : vec2(0.0, -1.0);
      float hl = clamp(lod + ${HALO.lodBias.toFixed(2)}, 2.0, ${HALO.lodMax.toFixed(2)});
      float hm = exp2(hl) / 256.0;
      float h = 0.0;
      for (int i = 0; i < 3; i++) {
        vec2 hp = (lp.xy - flow * spread * 0.06 * float(i)) / CORE;
        float inb = step(max(abs(hp.x), abs(hp.y)), 0.5);
        h = max(h, textureLod(uAtlas, (cellAt + clamp(hp + 0.5, hm, 1.0 - hm)) / 4.0, hl).a * inb * (1.0 - 0.25 * float(i)));
      }
      hal = smoothstep(0.0, 0.25, h * (0.4 + 0.6 * grow));
      nxy *= 0.5;
    }
    float thick = clamp((f - th) * (cell >= 100.0 ? 4.0 : 2.2), 0.0, 1.0);
    float dark = 1.0 - exp(-max(age, 0.0) / 3.5);
    // albedo here is the tint of the film: what is left of the light the surface under it sends back.
    // Thick blood passes a quarter of the red and next to nothing else; it browns as it sets; the thin
    // edge is brown. On a wet surface it is darker still. sheen: the share of the surface's own
    // reflections that stays on top of the film, most at a grazing angle (puddle light runs over it).
    vec3 deep = mix(vec3(0.5, 0.018, 0.011), vec3(0.32, 0.014, 0.009), clamp(dark * 0.6 + thick * 0.5, 0.0, 1.0));
    float rim = (1.0 - smoothstep(0.0, 0.3, thick)) * m; // the thin edge dries brown first
    albedo = mix(deep, vec3(0.4, 0.15, 0.075), rim * 0.7) * mix(1.0, 0.8, wetL) * vD3.rgb;
    N = normalize(ns + (tx * nxy.x + ty * nxy.y) * (1.0 - thick) * 0.7 * m);
    sheen = (mix(0.03, 0.2, wetL) + 0.5 * pow(1.0 - max(dot(N, V), 0.0), 4.0)) * mix(0.4, 1.0, thick);
    alpha = m * mix(0.8, 0.98, thick) * mix(1.0, 0.94 - 0.1 * spread, wetL);
    if (wetL > 0.02) {
      float life = 20.0 + 20.0 * fract(vD2.w * 3.7);
      float hf = smoothstep(0.2, 2.5, age) * (1.0 - smoothstep(0.5, 1.0, age / life));
      float hn = 0.55 + 0.45 * dn(lp.xy * size * 14.0, seed + 5.0);
      float ha = hal * smoothstep(${HALO.feather[1].toFixed(2)}, ${HALO.feather[0].toFixed(2)}, box) * ${HALO.alpha.toFixed(3)} * hf * wetL * hn;
      float both = alpha + ha * (1.0 - alpha);
      // thinned by the rain: a pink-brown wash. Its red is above 1: it lifts the red of a dark wet
      // surface a little, so the stain's edge can be seen where the core is black on black
      albedo = (albedo * alpha + vec3(1.7, 0.72, 0.6) * ha * (1.0 - alpha)) / max(both, 1e-4);
      sheen *= alpha / max(both, 1e-4);
      alpha = both;
    }
#endif
  } else if (shade == 5) { // burn: charred through, ash flecks, an edge that glows while it is fresh
    float f = t.a + (grain2 - 0.5) * 0.12;
    float body = smoothstep(0.0, 0.3, f);
    float ash = smoothstep(0.74, 0.92, grain) * smoothstep(0.25, 0.6, f); // a few pale flecks, not gravel
    albedo = mix(vec3(0.004), vec3(0.075, 0.07, 0.066), ash * 0.5);
    alpha = body * 0.94 * (0.75 + 0.25 * t.b);
    rough = 0.95;
    float hot = exp(-max(age, 0.0) / 5.0);
    float rim = smoothstep(0.02, 0.2, f) * (1.0 - smoothstep(0.2, 0.5, f));
    float em = (rim * smoothstep(0.45, 0.75, grain2) + smoothstep(0.7, 0.9, dn(lp.xy * size * 30.0, seed + 11.0)) * body * 0.5) * hot;
    em *= 0.6 + 0.4 * sin(uTime * 9.0 + grain * 40.0);
    glow = vec3(1.0, 0.24, 0.03) * em * 0.7;
  } else { // scorch
    albedo = vec3(0.012);
    alpha = smoothstep(0.0, 0.6, t.a) * 0.88 * (0.65 + 0.35 * t.b) * (0.8 + 0.2 * grain);
  }

  alpha *= facing * clamp((vKill - uTime) / ${FADE_TIME.toFixed(3)}, 0.0, 1.0);
#if BLOOD_PASS
  alpha *= exp(-uFogDensity * uFogDensity * dist * dist); // far off the fog is in front of it
  outColor = vec4((albedo + sheen) * alpha, alpha); // blended as dst * (rgb + 1 - a)
#else
  vec3 diff, spec, back;
  fxLight(wp, N, V, 0.0, rough, diff, spec, back);
  vec3 fres = F0 + (1.0 - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float metal = clamp((F0.g - 0.04) * 2.0, 0.0, 1.0);
  vec3 c = albedo * diff * (1.0 - metal) + spec * fres + uAmbient * fres * (1.0 - rough) + glow;
  outColor = vec4(fxFog(c * alpha, alpha, dist), alpha);
#endif
}`;

// surface -> bullet-hole look. tint is the freshly broken material (or the dent colour on metal).
const BULLET = {
  asphalt: { shade: 0, cell: D_CELL.crater, size: 0.1, tint: [0.085, 0.08, 0.075] },
  concrete: { shade: 0, cell: D_CELL.crater + 1, size: 0.13, tint: [0.27, 0.26, 0.24] },
  dirt: { shade: 0, cell: D_CELL.crater, size: 0.12, tint: [0.1, 0.075, 0.05] },
  metal: { shade: 1, cell: D_CELL.metal, size: 0.07, tint: [0.05, 0.05, 0.055] },
  glass: { shade: 2, cell: D_CELL.glass, size: 0.26, tint: [1, 1, 1] },
};

export function createDecals(G, post, atlasTexture, lights, clock, rng) {
  const data = new Float32Array(MAX_DECALS * STRIDE);
  const buffer = new InstancedInterleavedBuffer(data, STRIDE, 1);
  const box = new BoxGeometry(1, 1, 1);
  const geo = new InstancedBufferGeometry();
  geo.setIndex(box.index);
  geo.setAttribute('position', box.getAttribute('position'));
  for (let i = 0; i < 5; i++) geo.setAttribute(`d${i}`, new InterleavedBufferAttribute(buffer, 4, i * 4));
  geo.instanceCount = MAX_DECALS;

  const material = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: VERT, fragmentShader: frag(post, false),
    uniforms: { ...post.shared, ...lights.uniforms, uAtlas: { value: atlasTexture }, uBlood: { value: 0 } },
    side: BackSide, depthTest: false, depthWrite: false, transparent: true, blending: NormalBlending, premultipliedAlpha: true,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.name = 'fx-decals';
  // the blood: the same instances, drawn first and multiplied into the frame
  const bloodMaterial = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: VERT, fragmentShader: frag(post, true),
    uniforms: { ...post.shared, ...lights.uniforms, uAtlas: { value: atlasTexture }, uBlood: { value: 1 } },
    side: BackSide, depthTest: false, depthWrite: false, transparent: true,
    blending: CustomBlending, blendEquation: AddEquation, blendSrc: DstColorFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
  });
  const bloodMesh = new Mesh(geo, bloodMaterial);
  bloodMesh.frustumCulled = false;
  bloodMesh.renderOrder = -1;
  bloodMesh.name = 'fx-blood';

  // rings: blood in [0, bloodLive), everything else in [bloodMax, total)
  let total = MAX_DECALS; let bloodMax = 160; let bloodLive = 160; let lastCap = -1; let lastGore = -1;
  let cursorB = 0; let cursorO = 0; let countB = 0; let countO = 0;
  // Slots are written by two rings and by fades, in no one order: what goes to the GPU is the span
  // from the lowest to the highest slot touched since the last upload (at most 20 KB), through one
  // reused range object.
  const span = { start: 0, count: 0 };
  let lo = MAX_DECALS; let hi = -1;
  const uploader = {
    mark(i) { if (i < lo) lo = i; if (i > hi) hi = i; },
    markAll() { lo = 0; hi = MAX_DECALS - 1; },
    get pending() { return buffer.updateRanges.length > 0; },
    flush() {
      if (hi < 0) return;
      const ranges = buffer.updateRanges;
      if (ranges.length > 0) { lo = 0; hi = MAX_DECALS - 1; } // an earlier span never reached the GPU: send everything
      ranges.length = 0;
      span.start = lo * STRIDE; span.count = (hi - lo + 1) * STRIDE;
      ranges.push(span);
      buffer.needsUpdate = true;
      lo = MAX_DECALS; hi = -1;
    },
  };
  const X = new Vector3(); const Y = new Vector3(); const Z = new Vector3(); const DV = new Vector3();
  const M = new Matrix4(); const Q = new Quaternion();
  const kill = (i, when) => { const v = i * STRIDE; if (data[v + 3] > 0 && data[v + 16] > when) { data[v + 16] = when; uploader.mark(i); } };

  // The shares follow the tier and the gore setting; a share that shrinks fades what no longer fits.
  function shares() {
    const cap = (G.quality && G.quality.decals) || MAX_DECALS;
    const gore = goreOf(G.fx ? G.fx.gore : 1);
    if (cap === lastCap && gore === lastGore) return;
    lastCap = cap; lastGore = gore;
    const [t, b] = decalShares(cap);
    const live = bloodCap(b, gore);
    for (let i = live; i < bloodMax; i++) kill(i, clock.now + FADE_TIME);
    if (b !== bloodMax || t !== total) { for (let i = Math.min(b, bloodMax); i < MAX_DECALS; i++) kill(i, clock.now + FADE_TIME); cursorO = 0; countO = 0; }
    total = t; bloodMax = b; bloodLive = live;
    if (cursorB >= bloodLive) cursorB = 0;
    if (bloodLive === 0) countB = 0;
    if (countB > bloodLive) countB = bloodLive;
  }

  // 0 under a roof, 1 in the open: G.level.rainOccluders are the roofs' boxes
  function rainAt(x, y, z) {
    const occ = G.level && G.level.rainOccluders;
    if (!Array.isArray(occ)) return 1;
    for (let i = 0; i < occ.length; i++) {
      const b = occ[i]; const lo = b.min; const hi = b.max;
      if (x > lo[0] && x < hi[0] && z > lo[2] && z < hi[2] && y < hi[1]) return 0;
    }
    return 1;
  }

  // The frame of a decal: Z the normal; a wall keeps +y up (drips run down); the flat gets `dir`
  // (the way the blood was travelling or dragged) or a random roll.
  function frame(normal, dir, away) {
    Z.copy(normal);
    if (Z.lengthSq() < 1e-8) Z.set(0, 1, 0);
    Z.normalize();
    let roll = Math.abs(Z.y) > 0.6;
    if (Math.abs(Z.y) < 0.9) X.set(0, 1, 0).cross(Z).normalize(); else X.set(1, 0, 0).cross(Z).cross(Z).negate().normalize();
    Y.crossVectors(Z, X);
    if (dir && roll) {
      DV.copy(dir).addScaledVector(Z, -dir.dot(Z));
      if (DV.lengthSq() > 1e-6) { Y.copy(DV).normalize().multiplyScalar(away ? -1 : 1); X.crossVectors(Y, Z); roll = false; }
    }
    if (roll) {
      const a = rng.range(0, Math.PI * 2);
      X.multiplyScalar(Math.cos(a)).addScaledVector(Y, Math.sin(a)).normalize();
      Y.crossVectors(Z, X);
    }
    Q.setFromRotationMatrix(M.makeBasis(X, Y, Z));
  }

  function write(i, pos, size, cell, shade, age, tr, tg, tb, wet, tau, gx, gy) {
    const k = i * STRIDE;
    data[k] = pos.x; data[k + 1] = pos.y; data[k + 2] = pos.z; data[k + 3] = size;
    data[k + 4] = Q.x; data[k + 5] = Q.y; data[k + 6] = Q.z; data[k + 7] = Q.w;
    data[k + 8] = cell; data[k + 9] = clock.now - age; data[k + 10] = shade; data[k + 11] = rng.next();
    data[k + 12] = tr; data[k + 13] = tg; data[k + 14] = tb; data[k + 15] = wet;
    data[k + 16] = 1e9; data[k + 17] = tau; data[k + 18] = gx; data[k + 19] = gy;
    uploader.mark(i);
  }
  // the slot `ahead` of a full ring's cursor starts its fade now, so it is gone before it is reused
  function fadeAhead(i, base, len) {
    const v = (base + ((i - base + Math.min(FADE_AHEAD, len - 1)) % len)) * STRIDE;
    if (data[v + 16] > clock.now + FADE_TIME) { data[v + 16] = clock.now + FADE_TIME; uploader.mark(v / STRIDE); }
  }
  // May slot i be written now? Not while what is in it can still be seen: under fire faster than the
  // fade the new decal is the one that is dropped (and the slot told to go), so nothing ever pops.
  function free(i) {
    const v = i * STRIDE;
    if (!(data[v + 3] > 0) || data[v + 16] <= clock.now) return true;
    if (data[v + 16] > clock.now + FADE_TIME) { data[v + 16] = clock.now + FADE_TIME; uploader.mark(i); }
    return false;
  }

  // Blood. pos, normal: Vector3. o: { kind: 'spatter' | 'pool' | 'smear' | 'drip', size (metres across
  // the shape), grow (seconds to full size), dir (Vector3: travel or drag direction, for the flat),
  // wet (0..1, overrides what the roofs say), age, tint }. Returns the slot.
  function addBlood(pos, normal, o) {
    shares();
    frame(normal, o && o.dir, false); // +y of the decal = the way the blood was going
    const floorish = Z.y > 0.6;
    if (bloodLive <= 0) return -1; // gore 0
    if (!free(cursorB)) return -1;
    const kind = (o && o.kind) || 'spatter';
    let cell; let size; let tau;
    // 100 + run: a spatter drawn from the decal's seed (see the shader); run = how far its drops trail
    // down a surface that is not flat (o.run, else a little; 'drip' is mostly runs)
    const run = floorish ? 0 : (o && o.run >= 0 ? Math.min(o.run, 1) : 0.25);
    if (kind === 'pool') { cell = D_CELL.pool + rng.int(0, D_CELL.poolCount - 1); size = rng.range(0.45, 0.7); tau = 1.1; }
    else if (kind === 'smear') { cell = D_CELL.smear; size = rng.range(0.5, 0.8); tau = 0.12; }
    else if (kind === 'drip' && !floorish) { cell = 101; size = rng.range(0.25, 0.4); tau = 1.6; }
    else if (kind === 'drip') { cell = 100; size = rng.range(0.08, 0.16); tau = 0.1; }
    else { cell = 100 + run; size = rng.range(SPATTER.min, SPATTER.max); tau = floorish ? 0.06 : 0.3 + run; }
    let tr = 1; let tg = 1; let tb = 1; let age = 0; let wet = -1;
    if (o) {
      if (o.size > 0) size = o.size;
      if (o.grow > 0) tau = o.grow / 3;
      if (typeof o.wet === 'number') wet = o.wet;
      if (o.tint) { tr = o.tint[0]; tg = o.tint[1]; tb = o.tint[2]; }
      if (o.age) age = o.age; // negative: it appears that many seconds from now
    }
    size /= CORE;
    let gx = 0; let gy = 0;
    if (wet < 0) { // from the roofs: at the centre, and across the box (a decal on a drip line is half diluted)
      const sky = lights.uniforms.uWetness.value * (floorish ? 1 : 0.6);
      const h = size * 0.5; const up = 0.1;
      wet = rainAt(pos.x, pos.y + up, pos.z) * sky;
      gx = (rainAt(pos.x + X.x * h, pos.y + X.y * h + up, pos.z + X.z * h) - rainAt(pos.x - X.x * h, pos.y - X.y * h + up, pos.z - X.z * h)) * sky;
      gy = (rainAt(pos.x + Y.x * h, pos.y + Y.y * h + up, pos.z + Y.z * h) - rainAt(pos.x - Y.x * h, pos.y - Y.y * h + up, pos.z - Y.z * h)) * sky;
      if (gx !== 0 || gy !== 0) wet = 0.5 * sky; // on the line: dry at one edge, wet at the other
    }
    const i = cursorB;
    cursorB = (cursorB + 1) % bloodLive;
    if (countB < bloodLive) countB++;
    write(i, pos, size, cell, 3, age, tr, tg, tb, wet, tau, gx, gy);
    if (countB === bloodLive) fadeAhead(i, 0, bloodLive);
    return i;
  }

  // pos, normal: Vector3. kind: 'bullet' | 'blood' | 'scorch'.
  // opts: { surface, size (metres across), age (seconds already elapsed), wet (0..1), tint:[r,g,b], burn (scorch) }
  function add(pos, normal, kind, opts) {
    const o = opts || null;
    if (kind === 'blood') return addBlood(pos, normal, o);
    shares();
    if (!free(bloodMax + cursorO)) return -1;
    let shade; let cell; let size; let tr = 1; let tg = 1; let tb = 1;
    if (kind === 'scorch') {
      shade = o && o.burn ? 5 : 4; cell = D_CELL.scorch + rng.int(0, D_CELL.scorchCount - 1); size = rng.range(0.5, 0.7);
    } else {
      const b = BULLET[o && o.surface] || BULLET.concrete;
      if (o && (o.surface === 'flesh' || o.surface === 'cloth')) return -1;
      shade = b.shade; cell = b.cell + (b.shade === 0 ? 0 : rng.int(0, 1)); size = b.size * rng.range(0.85, 1.2);
      tr = b.tint[0]; tg = b.tint[1]; tb = b.tint[2];
    }
    if (o) {
      if (o.size > 0) size = o.size;
      if (o.tint) { tr = o.tint[0]; tg = o.tint[1]; tb = o.tint[2]; }
    }
    frame(normal, null, false);
    const len = total - bloodMax;
    const i = bloodMax + cursorO;
    cursorO = (cursorO + 1) % len;
    if (countO < len) countO++;
    write(i, pos, size, cell, shade, (o && o.age) || 0, tr, tg, tb, 0, 0, 0, 0);
    if (countO === len) fadeAhead(i, bloodMax, len);
    return i;
  }

  function flush() {
    uploader.flush();
  }
  // Retire one blood decal: it is gone in about `seconds` (the last FADE_TIME of them fading). slot: what
  // addBlood returned. A slot that has been recycled since belongs to another decal: the caller's risk.
  function fadeBlood(slot, seconds = 1) {
    if (!(slot >= 0) || slot >= bloodMax) return false;
    const v = slot * STRIDE; const when = clock.now + Math.max(seconds, FADE_TIME);
    if (!(data[v + 3] > 0) || data[v + 16] <= when) return false;
    data[v + 16] = when; uploader.mark(slot);
    return true;
  }

  function clear() {
    data.fill(0);
    cursorB = 0; cursorO = 0; countB = 0; countO = 0;
    uploader.markAll();
  }

  return {
    mesh, bloodMesh, buffer, add, addBlood, fadeBlood, flush, clear, rainAt,
    restore() { buffer.updateRanges.length = 0; uploader.markAll(); },
    get pending() { return uploader.pending; },
    get count() { return countB + countO; },
    get bloodCount() { return countB; },
    get caps() { shares(); return { total, blood: bloodLive, other: total - bloodMax }; },
    dispose() { geo.dispose(); box.dispose(); material.dispose(); bloodMaterial.dispose(); },
  };
}
