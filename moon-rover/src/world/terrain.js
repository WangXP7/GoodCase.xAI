/* ============================================================
   ANAXAGORAS BASIN — terrain
   ------------------------------------------------------------
   • Height is BAKED on the CPU into Float textures; the GPU only ever
     samples them.  Physics and pixels therefore agree exactly.
   • Rendered as a 9-level geometry clipmap centred on the camera:
     0.16 m cells under the wheels, 41 m cells at the 5 km horizon,
     ~370 k triangles total, zero per-frame CPU geometry work.
   • A baked sun-occlusion mask gives kilometre-long crater shadows.
   • A GPU "trail" buffer records the compacted surface and grouser marks.
   • A CPU-authoritative dent field carries the real geometry: wheel ruts
     with displaced berms, drill pits, and wheelspin holes — the ones
     that were churned slump at the angle of repose, the compacted ones
     stay exactly where you put them.
   ============================================================ */
import * as THREE from 'three';
import { fbm, ridged, vnoise, hash2i, clamp, sstep, lerp } from '../core/rng.js';

/* ---------------- world constants (metres) ---------------- */
export const MOON_G = 1.62;

export const MACRO_EXT = 1200, MACRO_RES = 2048;      // 0.586 m / texel
export const FAR_EXT = 7200, FAR_RES = 512;           // horizon scenery
export const DET_TILE = 16, DET_RES = 256;            // 0.0625 m / texel, tiling
export const DENT_EXT = 1024;                         // excavation field extent
export const SUNMASK_EXT = 1500, SUNMASK_RES = 1024;

export const RIM_R = 470, RIM_W = 74;                 // crater rim wall
export const PLAYABLE_R = 432;                        // soft mission fence

const DET_AMP = 0.38, DET_AMP2 = 0.105, DET_SCALE2 = 4.33;
const BERM_OUT = 1.72;      // berm reaches this multiple of the rut half-width
const BERM_GAIN = 0.85;     // how much of the displaced volume shows up as lip
const DIG_CAP = 0.48;       // buried to the axle; past this you are not driving out
const SLUMP_TTL = 2.4;                                // seconds an excavation keeps settling
const CURVE_R = 620000;                               // horizon-curvature radius

/* ============================================================
   1.  THE SHAPE OF THE BASIN  (smooth, low-frequency)
   ============================================================ */
const RILLE_CUT = 2.6;
const rilleProfile = (t) => 1 / (1 + Math.pow(t, 6));
const RILLE_EDGE = rilleProfile(RILLE_CUT);

function rilleH(x, z) {
  // A sinuous graben running roughly N–S through the western floor.
  if (z < -470 || z > 470) return 0;
  const xc = -168 + 118 * Math.sin(z * 0.0061) + 46 * Math.sin(z * 0.0172 + 1.3)
                  + 17 * Math.sin(z * 0.041 - 0.4);
  const w = 27 + 9 * Math.sin(z * 0.0102 + 2.1);
  const d = Math.abs(x - xc);
  const t = d / w;
  if (t > RILLE_CUT) return 0;
  // collapsed section around z≈95 forms the only natural crossing
  const bridge = Math.exp(-Math.pow((z - 95) / 46, 2)) * 0.97;
  const taper = sstep(470, 380, Math.abs(z));
  // A single C-infinity profile — flat floor, steep shoulders, exactly zero at
  // the cut-off. The obvious two-branch version leaves a five-metre step at the
  // wall, and the Catmull-Rom upsample rings across that step into a row of
  // shark fins running the whole length of the graben.
  const prof = -(rilleProfile(t) - RILLE_EDGE) / (1 - RILLE_EDGE);
  return prof * 17.5 * (1 - bridge) * taper;
}

/** Smooth basin form. Shared by the near AND far bakes so they blend seamlessly. */
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.00175, z * 0.00175, 4, 2.05, 0.5, 11) - 0.5) * 33;

  // broad bowl: the floor sinks toward the middle
  h -= 36 * sstep(RIM_R - 40, 55, r);

  // rim wall — ridged crests, with azimuthal breaches that let ejecta out
  const ang = Math.atan2(z, x);
  const breach = fbm(Math.cos(ang) * 1.55 + 5, Math.sin(ang) * 1.55 + 9, 3, 2.0, 0.5, 77);
  const rimAmp = 112 * (0.30 + 1.05 * breach);
  const prof = Math.exp(-Math.pow((r - RIM_R) / RIM_W, 2));
  h += rimAmp * prof * (0.5 + 0.95 * ridged(x * 0.0062, z * 0.0062, 4, 2.1, 0.5, 31));

  // terraced apron on the inner face of the wall
  const terr = sstep(RIM_R - 150, RIM_R - 20, r) * (1 - sstep(RIM_R, RIM_R + 60, r));
  h += terr * 9 * Math.sin(r * 0.10 + fbm(x * 0.004, z * 0.004, 2, 2, .5, 3) * 5.0);

  // outside the wall: fall away, then distant ridge country
  const outT = sstep(RIM_R + RIM_W * 0.55, RIM_R + 430, r);
  h -= 62 * outT;
  h += sstep(RIM_R + 130, RIM_R + 900, r) *
       (ridged(x * 0.00212, z * 0.00212, 5, 2.1, 0.55, 5) - 0.30) * 190;

  // Central massif — crustal rebound after the impact. Wide rather than tall:
  // a narrow peak of the same height would exceed 35° and simply could not be
  // driven, and the whole last mission happens on top of it.
  const cm = Math.exp(-Math.pow(r / 110, 2));
  h += cm * (64 + 26 * ridged(x * 0.0195, z * 0.0195, 4, 2.1, 0.5, 61));

  h += rilleH(x, z);
  return h;
}

/* ============================================================
   2.  CRATERS  (splatted, not evaluated per-texel)
   ============================================================ */
const TIERS = [
  //  cell, rMin, rMax, prob, depth, seed
  [104, 27, 55, 0.52, 0.155, 3],
  [ 36,  9, 22, 0.60, 0.180, 17],
  [ 12,  2.6, 7.4, 0.64, 0.195, 41]
];

/** classic bowl + raised rim + ejecta skirt, normalised to unit radius */
function craterProfile(t, age) {
  // t = d / r ;  age 0 = fresh & deep, 1 = ancient & filled
  if (t >= 1.92) return 0;
  const depth = lerp(1.0, 0.22, age);
  if (t < 1.0) {
    const c = Math.cos(t * Math.PI) * 0.5 + 0.5;          // 1 at centre -> 0 at rim
    const flat = lerp(1.35, 2.2, age);                     // older craters flatten out
    return -Math.pow(c, flat) * depth;
  }
  const u = (t - 1.0) / 0.92;
  return Math.sin(u * Math.PI) * (1 - u) * 0.55 * depth * lerp(1.0, 0.35, age);
}

function forEachCrater(ext, cb) {
  const half = ext * 0.5;
  for (let ti = 0; ti < TIERS.length; ti++) {
    const [cell, rMin, rMax, prob, depth, seed] = TIERS[ti];
    const n = Math.ceil(ext / cell) + 2;
    const o = -half - cell;
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      if (hash2i(gx, gz, seed) > prob) continue;
      const cx = o + (gx + hash2i(gx, gz, seed + 1)) * cell;
      const cz = o + (gz + hash2i(gx, gz, seed + 2)) * cell;
      const rr = hash2i(gx, gz, seed + 3);
      const r = rMin + (rMax - rMin) * rr * rr;            // many small, few large
      const age = hash2i(gx, gz, seed + 4);
      // keep the central massif clean — the node is up there
      const dc = Math.hypot(cx, cz);
      if (dc < 82) continue;
      cb(cx, cz, r, age, depth, ti);
    }
  }
}

/* ============================================================
   3.  BAKING
   ============================================================ */
function bilinear(arr, res, ext, x, z) {
  // matches GL LinearFilter + ClampToEdge exactly
  let u = (x / ext + 0.5) * res - 0.5;
  let v = (z / ext + 0.5) * res - 0.5;
  const x0 = Math.floor(u), z0 = Math.floor(v);
  const fx = u - x0, fz = v - z0;
  const c = (a, b) => (a < 0 ? 0 : a > b ? b : a);
  const xa = c(x0, res - 1), xb = c(x0 + 1, res - 1);
  const za = c(z0, res - 1), zb = c(z0 + 1, res - 1);
  const h00 = arr[za * res + xa], h10 = arr[za * res + xb];
  const h01 = arr[zb * res + xa], h11 = arr[zb * res + xb];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}
function bilinearWrap(arr, res, x, z) {
  let u = x * res - 0.5, v = z * res - 0.5;
  const x0 = Math.floor(u), z0 = Math.floor(v);
  const fx = u - x0, fz = v - z0;
  const w = (a) => ((a % res) + res) % res;
  const xa = w(x0), xb = w(x0 + 1), za = w(z0), zb = w(z0 + 1);
  const h00 = arr[za * res + xa], h10 = arr[za * res + xb];
  const h01 = arr[zb * res + xa], h11 = arr[zb * res + xb];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/* periodic value noise, for the seamless detail tile */
function pvn(x, y, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = (a) => ((a % per) + per) % per;
  const a = hash2i(w(ix), w(iy), seed), b = hash2i(w(ix + 1), w(iy), seed);
  const c = hash2i(w(ix), w(iy + 1), seed), d = hash2i(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Box-filtered mip chain. A clipmap ring with 19 m cells cannot represent a
    20 m crater bowl; without a filtered height field it interpolates straight
    across and leaves a row of tents on the horizon. */
function buildMips(base, res) {
  const mips = [{ data: base, width: res, height: res }];
  let src = base, w = res;
  while (w > 4) {
    const nw = w >> 1;
    const dst = new Float32Array(nw * nw);
    for (let y = 0; y < nw; y++) {
      const r0 = (y * 2) * w, r1 = r0 + w, o = y * nw;
      for (let x = 0; x < nw; x++) {
        const i = x * 2;
        dst[o + x] = (src[r0 + i] + src[r0 + i + 1] + src[r1 + i] + src[r1 + i + 1]) * 0.25;
      }
    }
    mips.push({ data: dst, width: nw, height: nw });
    src = dst; w = nw;
  }
  return mips;
}

/** Bake everything. Returns a generator: step it until done, reading .progress. */
export function* bakeTerrain(report) {
  /* --- 3a. macro base (coarse, then smoothly upsampled) --- */
  const CO = 640;                                    // coarse resolution of the smooth form
  const coarse = new Float32Array(CO * CO);
  for (let z = 0; z < CO; z++) {
    for (let x = 0; x < CO; x++) {
      const wx = (x / (CO - 1) - 0.5) * MACRO_EXT;
      const wz = (z / (CO - 1) - 0.5) * MACRO_EXT;
      coarse[z * CO + x] = baseHeight(wx, wz);
    }
    if ((z & 15) === 0) { report(0.02 + 0.20 * (z / CO), 'shaping the basin'); yield; }
  }

  /* Catmull–Rom upsample, done SEPARABLY: rows first into a strip, then
     columns. The naive 2D form costs 21 M spline evaluations at this size and
     blocks the main thread for seconds; separating it costs 5.5 M. */
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  // precompute the x sample indices + parameter once; every row reuses them
  const xi = new Int32Array(MACRO_RES), xt = new Float32Array(MACRO_RES);
  for (let x = 0; x < MACRO_RES; x++) {
    const fx = (x / (MACRO_RES - 1)) * (CO - 1);
    xi[x] = Math.floor(fx); xt[x] = fx - xi[x];
  }
  const cx = (v) => (v < 0 ? 0 : v > CO - 1 ? CO - 1 : v);
  const strip = new Float32Array(CO * MACRO_RES);       // CO rows × full width
  for (let z = 0; z < CO; z++) {
    const row = z * CO, out = z * MACRO_RES;
    for (let x = 0; x < MACRO_RES; x++) {
      const i = xi[x];
      strip[out + x] = cr(coarse[row + cx(i - 1)], coarse[row + cx(i)],
                          coarse[row + cx(i + 1)], coarse[row + cx(i + 2)], xt[x]);
    }
    if ((z & 63) === 0) { report(0.22 + 0.05 * (z / CO), 'resolving relief'); yield; }
  }

  const macro = new Float32Array(MACRO_RES * MACRO_RES);
  for (let z = 0; z < MACRO_RES; z++) {
    const fz = (z / (MACRO_RES - 1)) * (CO - 1), iz = Math.floor(fz), tz = fz - iz;
    const r0 = cx(iz - 1) * MACRO_RES, r1 = cx(iz) * MACRO_RES;
    const r2 = cx(iz + 1) * MACRO_RES, r3 = cx(iz + 2) * MACRO_RES;
    const out = z * MACRO_RES;
    for (let x = 0; x < MACRO_RES; x++) {
      macro[out + x] = cr(strip[r0 + x], strip[r1 + x], strip[r2 + x], strip[r3 + x], tz);
    }
    if ((z & 63) === 0) { report(0.27 + 0.09 * (z / MACRO_RES), 'resolving relief'); yield; }
  }

  /* --- 3b. splat craters into the macro field --- */
  const px = MACRO_EXT / MACRO_RES;                  // metres per texel
  const half = MACRO_RES * 0.5;
  let done = 0, total = 0;
  forEachCrater(MACRO_EXT + 240, () => total++);
  const jobs = [];
  forEachCrater(MACRO_EXT + 240, (cx, cz, r, age, depth) => jobs.push([cx, cz, r, age, depth]));
  for (let ji = 0; ji < jobs.length; ji++) {
    const [cx, cz, r, age, depth] = jobs[ji];
    const R = r * 1.92, amp = r * depth;
    const gx0 = Math.max(0, Math.floor((cx - R) / px + half));
    const gx1 = Math.min(MACRO_RES - 1, Math.ceil((cx + R) / px + half));
    const gz0 = Math.max(0, Math.floor((cz - R) / px + half));
    const gz1 = Math.min(MACRO_RES - 1, Math.ceil((cz + R) / px + half));
    for (let gz = gz0; gz <= gz1; gz++) {
      const wz = (gz - half + 0.5) * px;
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = (gx - half + 0.5) * px;
        const d = Math.hypot(wx - cx, wz - cz) / r;
        if (d >= 1.92) continue;
        // radial noise on the lip so no crater is a perfect circle
        const wob = 1 + 0.13 * (vnoise(Math.atan2(wz - cz, wx - cx) * 2.4 + cx, cz * 0.1, 909) - 0.5) * 2;
        macro[gz * MACRO_RES + gx] += craterProfile(d * wob, age) * amp;
      }
    }
    done++;
    if ((ji & 127) === 0) { report(0.36 + 0.26 * (done / total), `impact record · ${done}/${total}`); yield; }
  }

  /* --- 3c. far horizon field --- */
  const far = new Float32Array(FAR_RES * FAR_RES);
  for (let z = 0; z < FAR_RES; z++) {
    for (let x = 0; x < FAR_RES; x++) {
      const wx = (x / (FAR_RES - 1) - 0.5) * FAR_EXT;
      const wz = (z / (FAR_RES - 1) - 0.5) * FAR_EXT;
      far[z * FAR_RES + x] = baseHeight(wx, wz);
    }
    if ((z & 31) === 0) { report(0.62 + 0.08 * (z / FAR_RES), 'plotting the horizon'); yield; }
  }

  /* --- 3d. seamless detail tile: grain, clods, sub-metre pitting --- */
  const det = new Float32Array(DET_RES * DET_RES);
  const P = 16;                                       // noise lattice period inside the tile
  for (let z = 0; z < DET_RES; z++) {
    for (let x = 0; x < DET_RES; x++) {
      const u = x / DET_RES * P, v = z / DET_RES * P;
      let d = pvn(u, v, P, 5) * 0.5 + pvn(u * 2, v * 2, P * 2, 6) * 0.29
            + pvn(u * 4, v * 4, P * 4, 7) * 0.14 + pvn(u * 8, v * 8, P * 8, 8) * 0.07;
      det[z * DET_RES + x] = d - 0.5;
    }
    if ((z & 63) === 0) { report(0.70 + 0.04 * (z / DET_RES), 'grain'); yield; }
  }
  // micro-craters, wrapped
  {
    const mpx = DET_TILE / DET_RES;
    const N = 26;
    for (let k = 0; k < 130; k++) {
      const cx = hash2i(k, 1, 313) * DET_TILE, cz = hash2i(k, 2, 313) * DET_TILE;
      const r = 0.16 + Math.pow(hash2i(k, 3, 313), 2.4) * 1.15;
      const age = hash2i(k, 4, 313);
      const R = r * 1.92;
      const g0x = Math.floor((cx - R) / mpx), g1x = Math.ceil((cx + R) / mpx);
      const g0z = Math.floor((cz - R) / mpx), g1z = Math.ceil((cz + R) / mpx);
      for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
        const wx = gx * mpx, wz = gz * mpx;
        const d = Math.hypot(wx - cx, wz - cz) / r;
        if (d >= 1.92) continue;
        const ix = ((gx % DET_RES) + DET_RES) % DET_RES;
        const iz = ((gz % DET_RES) + DET_RES) % DET_RES;
        det[iz * DET_RES + ix] += craterProfile(d, age) * r * 0.30 / DET_AMP;
      }
    }
    // normalise to ±0.5 so DET_AMP is meaningful
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < det.length; i++) { if (det[i] < mn) mn = det[i]; if (det[i] > mx) mx = det[i]; }
    const s = 1 / Math.max(mx - mn, 1e-6);
    for (let i = 0; i < det.length; i++) det[i] = (det[i] - mn) * s - 0.5;
  }
  report(0.75, 'regolith settled'); yield;
  const macroMips = buildMips(macro, MACRO_RES);
  const farMips = buildMips(far, FAR_RES);
  report(0.76, 'filtering for distance'); yield;

  return { macro, far, det, macroMips, farMips };
}

/* ============================================================
   4.  GLSL — one height function, shared by every terrain shader
   ============================================================ */
export const TERRAIN_GLSL = /* glsl */`
uniform sampler2D uMacro, uFar, uDetail, uDent, uTrail;
uniform vec4 uConst;      // MACRO_EXT, FAR_EXT, DET_TILE, DENT_EXT
uniform vec4 uConst2;     // DET_AMP, DET_AMP2, DET_SCALE2, TRAIL_EXT
uniform vec3 uCamXZ;      // camera x, z, detail-fade distance
uniform vec2 uLod;        // mip level this clipmap ring should read
uniform vec4 uTexRes;     // macro, far, detail, dent texel counts

#ifdef MANUAL_BILINEAR
/* Four taps and a lerp — what the sampler would have done for us. */
float texBil(sampler2D t, vec2 uv, float res){
  vec2 p = uv * res - 0.5;
  vec2 i = floor(p), f = fract(p);
  vec2 b = (i + 0.5) / res, e = vec2(1.0 / res, 0.0);
  float h00 = textureLod(t, b, 0.0).r;
  float h10 = textureLod(t, b + e.xy, 0.0).r;
  float h01 = textureLod(t, b + e.yx, 0.0).r;
  float h11 = textureLod(t, b + e.xx, 0.0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
  #define SAMPLE_H(t, uv, res, lod) texBil(t, uv, res)
#else
  #define SAMPLE_H(t, uv, res, lod) textureLod(t, uv, lod).r
#endif

float hMacro(vec2 p){
  vec2 uv = p / uConst.x + 0.5;
  float m = SAMPLE_H(uMacro, clamp(uv, 0.0005, 0.9995), uTexRes.x, uLod.x);
  float f = SAMPLE_H(uFar, p / uConst.y + 0.5, uTexRes.y, uLod.y);
  float r = length(p);
  return mix(m, f, smoothstep(520.0, 596.0, r));
}
float hDetail(vec2 p, float fade){
  // No fract() here: the texture is RepeatWrapping, and folding the coordinate
  // by hand would put a hard seam at every tile boundary in BOTH paths.
  float d  = SAMPLE_H(uDetail, p / uConst.z, uTexRes.z, 0.0) * uConst2.x;
  d += SAMPLE_H(uDetail, p / uConst2.z + vec2(0.37, 0.71), uTexRes.z, 0.0) * uConst2.y;
  return d * fade;
}
float hDent(vec2 p){
  vec2 uv = p / uConst.w + 0.5;
  if (any(lessThan(uv, vec2(0.001))) || any(greaterThan(uv, vec2(0.999)))) return 0.0;
  return SAMPLE_H(uDent, uv, uTexRes.w, 0.0);
}
float terrainH(vec2 p){
  float fade = 1.0 - smoothstep(95.0, 300.0, distance(p, uCamXZ.xy));
  return hMacro(p) + hDetail(p, fade) - hDent(p);
}
`;

/* ============================================================
   5.  TERRAIN OBJECT
   ============================================================ */
export class Terrain {
  constructor(renderer, baked, quality, caps = {}) {
    this.renderer = renderer;
    /* Height fields are R32F. Sampling them with LinearFilter needs
       OES_texture_float_linear, which three silently downgrades to NEAREST when
       absent — 0.6 m stair-steps across the whole basin. Where the extension is
       missing we filter in the shader instead. */
    this.manualBilinear = caps.floatLinear === false;
    this.macro = baked.macro; this.far = baked.far; this.det = baked.det;
    this.quality = quality;

    /* ---- data textures ----
       R32F, not half: heights reach 160 m and half-float's 10-bit mantissa
       would quantise that to 12 cm steps — visibly terraced ground. The
       Float32Array IS the texture, so there is no conversion cost either. */
    const mk = (arr, res, wrap, mips) => {
      const t = new THREE.DataTexture(arr, res, res, THREE.RedFormat, THREE.FloatType);
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      if (this.manualBilinear) { t.magFilter = t.minFilter = THREE.NearestFilter; }
      else if (mips) { t.mipmaps = mips; t.minFilter = THREE.LinearMipmapLinearFilter; }
      else t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.texMacro = mk(this.macro, MACRO_RES, false, baked.macroMips);
    this.texFar = mk(this.far, FAR_RES, false, baked.farMips);
    this.texDetail = mk(this.det, DET_RES, true, null);

    /* ---- excavation field (CPU authoritative, uploaded as dirty rects) ----
       0.25 m per texel at HIGH, which is what it takes for a 0.30 m wheel to
       cut a rut you can actually see. Half-float on the GPU: the field only
       ever holds +-4 m, where a half carries sub-millimetre precision. */
    const DR = this.dentRes = quality.dentRes;
    this.dent = new Float32Array(DR * DR);
    this.dentHalf = new Uint16Array(DR * DR);
    this.texDent = new THREE.DataTexture(this.dentHalf, DR, DR, THREE.RedFormat, THREE.HalfFloatType);
    this.texDent.magFilter = this.texDent.minFilter =
      this.manualBilinear ? THREE.NearestFilter : THREE.LinearFilter;
    this.texDent.generateMipmaps = false;
    this.texDent.needsUpdate = true;
    // A rut touches ~4 texels; a drill pit touches ~200. Uploading a fixed
    // 128-square block for both wastes two orders of magnitude of bandwidth.
    this.scratches = [16, 64, 256].map((n) => {
      const t = new THREE.DataTexture(new Uint16Array(n * n), n, n, THREE.RedFormat, THREE.HalfFloatType);
      t.generateMipmaps = false; t.needsUpdate = true;
      return { n, tex: t };
    });
    this._marks = [];      // rects awaiting GPU upload
    this._slumps = [];     // excavations still settling: [x0,z0,x1,z1,ttl]

    /* ---- trail buffer (wheel tracks) ---- */
    const TR = quality.trailRes;
    this.TRAIL_EXT = 900;
    this.trailRT = new THREE.WebGLRenderTarget(TR, TR, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    });
    this.trailCam = new THREE.OrthographicCamera(-this.TRAIL_EXT / 2, this.TRAIL_EXT / 2,
      this.TRAIL_EXT / 2, -this.TRAIL_EXT / 2, -1, 1);
    this.trailCam.position.set(0, 0, 0);
    this.trailScene = new THREE.Scene();
    this._trailPool = []; this._trailUsed = 0;
    this._trailTex = makeTrackStamp();
    this._trailGeo = new THREE.PlaneGeometry(1, 1);
    // Additive accumulation: a track deepens where wheels pass twice, and
    // saturates at 1. Nothing ever erases it — lunar tracks outlive us.
    this._trailProto = new THREE.MeshBasicMaterial({
      map: this._trailTex, color: 0xffffff, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, toneMapped: false
    });
    renderer.setRenderTarget(this.trailRT);
    renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
    renderer.setRenderTarget(null);

    /* ---- sun occlusion mask ---- */
    this.sunRT = new THREE.WebGLRenderTarget(quality.sunRes, quality.sunRes, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    });
    this.sunMat = new THREE.ShaderMaterial({
      uniforms: {
        uMacro: { value: this.texMacro }, uFar: { value: this.texFar },
        uSun: { value: new THREE.Vector3(1, 0.3, 0) }, uExt: { value: SUNMASK_EXT },
        uSteps: { value: quality.sunSteps }
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy*2.0,0.0,1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv;
        uniform sampler2D uMacro, uFar; uniform vec3 uSun; uniform float uExt, uSteps;
        float hM(vec2 p){
          float m = texture2D(uMacro, clamp(p/${MACRO_EXT.toFixed(1)}+0.5, 0.0005, 0.9995)).r;
          float f = texture2D(uFar, p/${FAR_EXT.toFixed(1)}+0.5).r;
          return mix(m, f, smoothstep(520.0, 596.0, length(p)));
        }
        void main(){
          vec2 p = (vUv - 0.5) * uExt;
          float h0 = hM(p) + 0.15;                       // bias off the surface: no acne
          vec2 dir = normalize(uSun.xz + vec2(1e-5));
          float tanA = max(uSun.y, 0.02) / max(length(uSun.xz), 1e-4);
          float sh = 1.0, d = 0.7, step = 0.7;
          for (int i = 0; i < 96; i++){
            if (float(i) >= uSteps) break;
            float hr = h0 + d * tanA;
            float ht = hM(p + dir * d);
            // Penumbra width is the sun's angular diameter times the distance
            // to the occluder — 0.53°, which is why lunar shadows have edges
            // you could cut yourself on.
            sh = min(sh, clamp((hr - ht) / (0.0093 * d + 0.06), 0.0, 1.0));
            if (sh <= 0.002) break;
            d += step; step *= 1.05;
          }
          gl_FragColor = vec4(sh, 0.0, 0.0, 1.0);
        }`
    });
    this._sunQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sunMat);
    this._sunScene = new THREE.Scene(); this._sunScene.add(this._sunQuad);
    this._sunCam = new THREE.Camera();
    this._lastSun = new THREE.Vector3(9, 9, 9);

    this.buildMaterial();
    this.buildClipmap();
  }

  /* ---------- CPU height, byte-for-byte what the vertex shader computes ---------- */
  heightAt(x, z) {
    const m = bilinear(this.macro, MACRO_RES, MACRO_EXT, x, z);
    const f = bilinear(this.far, FAR_RES, FAR_EXT, x, z);
    const r = Math.hypot(x, z);
    let h = lerp(m, f, sstep(520, 596, r));
    h += bilinearWrap(this.det, DET_RES, x / DET_TILE, z / DET_TILE) * DET_AMP;
    h += bilinearWrap(this.det, DET_RES, x / DET_SCALE2 + 0.37, z / DET_SCALE2 + 0.71) * DET_AMP2;
    h -= this.dentAt(x, z);
    return h;
  }
  dentAt(x, z) {
    const u = (x / DENT_EXT + 0.5), v = (z / DENT_EXT + 0.5);
    if (u < 0.001 || u > 0.999 || v < 0.001 || v > 0.999) return 0;
    return bilinear(this.dent, this.dentRes, DENT_EXT, x, z);
  }
  normalAt(x, z, e = 0.35, out = new THREE.Vector3()) {
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  /** slope in degrees */
  slopeAt(x, z) { const n = this.normalAt(x, z, 0.9, _v3a); return Math.acos(clamp(n.y, -1, 1)) * 57.29578; }

  /** CPU sun visibility (0 shadow .. 1 lit) — used to light the rover.
      Marches the macro field only, exactly like the baked GPU mask does. */
  sunVis(x, z, sun) {
    const h0 = bilinear(this.macro, MACRO_RES, MACRO_EXT, x, z);
    const l = Math.hypot(sun.x, sun.z) || 1e-4;
    const dx = sun.x / l, dz = sun.z / l;
    const tanA = Math.max(sun.y, 0.02) / l;
    let sh = 1, d = 0.9, step = 0.9;
    for (let i = 0; i < 56; i++) {
      const hr = h0 + 0.15 + d * tanA;
      const ht = bilinear(this.macro, MACRO_RES, MACRO_EXT, x + dx * d, z + dz * d);
      sh = Math.min(sh, clamp((hr - ht) / (0.0093 * d + 0.06), 0, 1));
      if (sh <= 0.004) break;
      d += step; step *= 1.08;
    }
    return sh;
  }

  /* ============================================================
     material
     ============================================================ */
  buildMaterial() {
    const U = this.uniforms = {
      uMacro: { value: this.texMacro }, uFar: { value: this.texFar },
      uDetail: { value: this.texDetail }, uDent: { value: this.texDent },
      uTrail: { value: this.trailRT.texture },
      uSunMask: { value: this.sunRT.texture },
      uAlbedoTex: { value: null },
      uConst: { value: new THREE.Vector4(MACRO_EXT, FAR_EXT, DET_TILE, DENT_EXT) },
      uConst2: { value: new THREE.Vector4(DET_AMP, DET_AMP2, DET_SCALE2, this.TRAIL_EXT) },
      uCamXZ: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0.6, 0.22, 0.3).normalize() },
      uSunCol: { value: new THREE.Vector3(2.55, 2.42, 2.20) },
      uAmbient: { value: new THREE.Vector3(0.030, 0.036, 0.052) },
      uEarthDir: { value: new THREE.Vector3(0.2, 0.7, -0.6).normalize() },
      uEarthCol: { value: new THREE.Vector3(0.055, 0.075, 0.115) },
      uSunMaskExt: { value: SUNMASK_EXT },
      uCurveR: { value: CURVE_R },
      uCell: { value: 0.3 },
      uSag: { value: 0.0 },
      uLod: { value: new THREE.Vector2(0, 0) },
      uTexRes: { value: new THREE.Vector4(MACRO_RES, FAR_RES, DET_RES, this.dentRes) },
      uLamp: { value: new THREE.Vector3(0, 0, 0) },      // headlight position
      uLampDir: { value: new THREE.Vector3(0, 0, -1) },
      uLampPow: { value: 0.0 },
      uScanC: { value: new THREE.Vector3(0, 0, 0) },     // GPR pulse origin
      uScanR: { value: -1 },                              // pulse radius (<0 = off)
      uTime: { value: 0 },
      uFogK: { value: 1.0 },
      // the rover's own shadow, from three's directional shadow map
      uRShadow: { value: null },
      uRShadowMat: { value: new THREE.Matrix4() },
      uRShadowOn: { value: 0 },
      uRShadowTexel: { value: 1 / 2048 }
    };

    const vert = /* glsl */`
      ${TERRAIN_GLSL}
      uniform float uCurveR, uCell, uSag;
      varying vec3 vW; varying vec3 vN; varying float vDent;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec2 p = wp.xz;
        float h = terrainH(p);
        float e = max(uCell, 0.25);
        float hx = terrainH(p + vec2(e, 0.0));
        float hz = terrainH(p + vec2(0.0, e));
        vN = normalize(vec3(h - hx, e, h - hz));
        vDent = hDent(p);
        wp.y = h - uSag;
        wp.y -= dot(p - uCamXZ.xy, p - uCamXZ.xy) / (2.0 * uCurveR);   // horizon curvature
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`;

    const frag = /* glsl */`
      precision highp float;
      #include <packing>
      varying vec3 vW; varying vec3 vN; varying float vDent;
      uniform sampler2D uSunMask, uAlbedoTex, uTrail;
      uniform sampler2D uRShadow; uniform mat4 uRShadowMat;
      uniform float uRShadowOn, uRShadowTexel;
      uniform vec3 uSunDir, uSunCol, uAmbient, uEarthDir, uEarthCol;
      uniform vec3 uLamp, uLampDir, uScanC;
      uniform float uSunMaskExt, uLampPow, uScanR, uTime, uMarks, uFogK;
      uniform vec4 uConst2;

      float h1(vec2 p){ p = fract(p*vec2(0.1031,0.1030)); p += dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }
      const mat2 RA = mat2(0.8090,-0.5878,0.5878,0.8090);
      const mat2 RB = mat2(0.3090,0.9511,-0.9511,0.3090);
      float fb(vec2 p){ return n2(p)*0.55 + n2(RA*p*2.17+7.7)*0.30 + n2(RB*p*4.01+19.3)*0.15; }

      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float dist = distance(vW.xz, cameraPosition.xz);
        float near = 1.0 - smoothstep(26.0, 190.0, dist);

        /* ---- micro relief: the grain must CATCH the grazing sun, not be painted on.
           Kept high-frequency on purpose — at a half-metre wavelength it reads as
           swirling dunes, which the Moon does not have. ---- */
        #define GRIT(P) (n2((P)*7.3)*0.58 + n2((P)*23.0)*0.42)
        float g0 = GRIT(vW.xz);
        vec3 Nr = N;
        if (near > 0.002){
          float e = 0.045;
          float gx = GRIT(vW.xz + vec2(e, 0.0));
          float gz = GRIT(vW.xz + vec2(0.0, e));
          Nr = normalize(N + vec3(-(gx-g0), 0.0, -(gz-g0)) * 0.62 * near);
        }

        /* ---- albedo: mare/highland mottling from the real lunar map + grain ---- */
        vec3 macroAlb = texture2D(uAlbedoTex, vW.xz*0.00042 + vec2(0.31,0.62)).rgb;
        float mott = mix(0.72, 1.24, dot(macroAlb, vec3(0.33)));
        float varN = fb(vW.xz*0.34);
        float speck = n2(vW.xz*11.9);
        vec3 base = vec3(0.148, 0.129, 0.104);
        vec3 albedo = base * mott * (0.87 + 0.17*varN + 0.11*g0) * (0.90 + 0.22*speck);
        // freshly excavated material is brighter — unweathered, unsputtered
        albedo *= 1.0 + 0.62 * smoothstep(0.02, 0.55, vDent);
        /* ---- wheel tracks ----
           Sampled per PIXEL, not per vertex: a 0.44 m rut across a 0.30 m
           clipmap cell would otherwise be smeared into nothing. Compacted
           regolith is darker and smoother than the fluffy stuff around it,
           which is exactly why Apollo's tracks are still legible from orbit. */
        // The trail buffer is an orthographic view looking down −Z, so world +Z
        // lands on −Y in the texture. Sample with that flip or the tracks end up
        // mirrored across the origin, four hundred metres from the wheels.
        vec2 tuv = vec2(vW.x, -vW.z) / uConst2.w + 0.5;
        float trackFade = 1.0 - smoothstep(120.0, 460.0, dist);
        float tr = (tuv.x>0.004&&tuv.x<0.996&&tuv.y>0.004&&tuv.y<0.996)
                 ? texture2D(uTrail, tuv).r * trackFade : 0.0;
        if (tr > 0.004){
          // Recover the direction of travel from the gradient of the trail
          // field, so the grouser marks lie ACROSS the rut instead of drifting
          // through it on some fixed diagonal.
          float e = 2.0 / uConst2.w;
          vec2 g = vec2(texture2D(uTrail, tuv + vec2(e,0.0)).r - texture2D(uTrail, tuv - vec2(e,0.0)).r,
                        texture2D(uTrail, tuv + vec2(0.0,e)).r - texture2D(uTrail, tuv - vec2(0.0,e)).r);
          vec2 across = vec2(g.x, -g.y);
          vec2 along = (length(across) > 1e-4) ? normalize(vec2(-across.y, across.x)) : vec2(1.0, 0.0);
          float tread = smoothstep(0.05, 0.9, 0.5 + 0.5*sin(dot(vW.xz, along * 27.0)));
          albedo *= mix(1.0, 0.34 + 0.26*tread, tr);
          Nr = normalize(mix(Nr, N, tr*0.8));       // the grain is crushed flat
        }

        /* ---- shadowing: baked long crater shadows ---- */
        vec2 smu = vW.xz / uSunMaskExt + 0.5;
        float sm = (smu.x>0.0&&smu.x<1.0&&smu.y>0.0&&smu.y<1.0) ? texture2D(uSunMask, smu).r : 1.0;

        /* ---- plus the rover and the boulders, from the real shadow map ----
           Without this the machine floats: nothing sells contact with a surface
           like the shadow it throws across it. */
        if (uRShadowOn > 0.5){
          vec4 sc = uRShadowMat * vec4(vW, 1.0);
          vec3 sp = sc.xyz / sc.w;
          if (sp.x > 0.001 && sp.x < 0.999 && sp.y > 0.001 && sp.y < 0.999 && sp.z < 1.0){
            float d = sp.z - 0.0016;
            float o = uRShadowTexel;
            float s = 0.0;
            s += step(d, unpackRGBAToDepth(texture2D(uRShadow, sp.xy + vec2(-o,-o))));
            s += step(d, unpackRGBAToDepth(texture2D(uRShadow, sp.xy + vec2( o,-o))));
            s += step(d, unpackRGBAToDepth(texture2D(uRShadow, sp.xy + vec2(-o, o))));
            s += step(d, unpackRGBAToDepth(texture2D(uRShadow, sp.xy + vec2( o, o))));
            s += step(d, unpackRGBAToDepth(texture2D(uRShadow, sp.xy)));
            // fade the map out at its border so the frustum edge is invisible
            float edge = smoothstep(0.5, 0.42, max(abs(sp.x-0.5), abs(sp.y-0.5)));
            sm *= mix(1.0, s * 0.2, edge);
          }
        }

        /* ---- Lommel–Seeliger: the real lunar photometric function ---- */
        float ci = max(dot(Nr, uSunDir), 0.0);
        float ce = max(dot(Nr, V), 0.0);
        float ls = ci / (ci + ce + 0.18);
        vec3 col = albedo * (ls * uSunCol * sm);

        /* ---- opposition surge: coherent backscatter, tight and sun-gated ---- */
        float od = max(dot(V, uSunDir), 0.0);
        col *= 1.0 + 0.28 * (0.42*pow(od,3.0) + 0.58*pow(od,26.0)) * sm;

        /* ---- fill: earthshine, starlight, and regolith bouncing off itself ----
           Shadowed ground on the Moon is dark but not black — the sunlit floor
           a hundred metres away throws a surprising amount of light sideways. */
        col += albedo * uEarthCol * (0.45 + 0.55*max(dot(Nr, uEarthDir), 0.0));
        col += albedo * uAmbient * (0.5 + 0.5*N.y);
        col += albedo * uSunCol * 0.052 * max(uSunDir.y, 0.0) * (0.35 + 0.65*N.y);

        /* ---- rover headlights ---- */
        if (uLampPow > 0.001){
          vec3 tl = uLamp - vW; float dl = length(tl); vec3 L = tl/max(dl,1e-3);
          float cone = smoothstep(0.72, 0.955, dot(-L, uLampDir));
          float att = uLampPow * cone / (1.0 + 0.020*dl*dl);
          col += albedo * vec3(1.30,1.24,1.12) * att * max(dot(Nr, L), 0.0) * 5.5;
        }

        /* ---- GPR pulse sweep ---- */
        if (uScanR > 0.0){
          float dr = distance(vW.xz, uScanC.xz);
          float ring = exp(-pow((dr - uScanR)/2.2, 2.0));
          float grid = smoothstep(0.86,1.0,max(sin(vW.x*1.05),sin(vW.z*1.05)));
          col += vec3(0.10,0.55,0.72) * ring * (0.35 + 0.65*grid) * uScanC.y;
        }

        /* ---- distance ----
           There is no air, so there is no aerial perspective: the far rim is
           genuinely as bright as the ground at your feet, which is why lunar
           photographs have no sense of scale. A little falloff is kept purely
           as a depth cue — any more and the mountains read as black cut-outs. */
        col *= mix(1.0, 0.34, smoothstep(700.0, 3400.0, dist) * uFogK);
        gl_FragColor = vec4(col, 1.0);
      }`;

    this.material = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: vert, fragmentShader: frag, fog: false,
      defines: this.manualBilinear ? { MANUAL_BILINEAR: 1 } : {}
    });
  }

  /* ============================================================
     clipmap
     ============================================================ */
  buildClipmap() {
    // Reuse the group across rebuilds: main adds it to the scene once at boot,
    // so handing back a fresh one on a quality change would leave the old rings
    // drawn and the new ones orphaned.
    if (this.group) {
      for (const L of this.levels) {
        this.group.remove(L.mesh);
        L.mesh.geometry.dispose(); L.mesh.material.dispose();
      }
    } else {
      this.group = new THREE.Group();
      this.group.frustumCulled = false;
    }
    this.levels = [];
    const M = this.quality.clipM;          // cells per side
    const L = this.quality.clipLevels;
    const c0 = this.quality.clipCell;

    const grid = (nx, nz, hole) => {
      // hole = half-width in cells of the removed centre (0 = solid patch)
      const verts = [], idx = [];
      const w = nx + 1;
      for (let z = 0; z <= nz; z++) for (let x = 0; x <= nx; x++) verts.push(x - nx / 2, 0, z - nz / 2);
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        if (hole) {
          const cx = x - nx / 2 + 0.5, cz = z - nz / 2 + 0.5;
          if (Math.abs(cx) < hole && Math.abs(cz) < hole) continue;
        }
        const a = z * w + x, b = a + 1, c = a + w, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      return g;
    };

    for (let i = 0; i < L; i++) {
      const cell = c0 * Math.pow(2, i);
      const geo = grid(M, M, i === 0 ? 0 : M / 4 - 2);   // 2-cell overlap hides any snap mismatch
      // Built directly rather than cloned: ShaderMaterial.clone() deep-copies
      // the uniforms, which warns on every render-target texture in the set
      // (uTrail, uSunMask) and then has its work thrown away by the line below.
      // Harmless at boot, nine warnings a time once the tier can change.
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, this.uniforms),      // share the value objects
        vertexShader: this.material.vertexShader,
        fragmentShader: this.material.fragmentShader,
        defines: this.material.defines,
        fog: false
      });
      mat.uniforms.uCell = { value: cell };
      // Sag rises with cell size so a coarser ring always sits UNDER the finer
      // one it overlaps, hiding both the LOD step and any snapping mismatch.
      mat.uniforms.uSag = { value: i === 0 ? 0 : 0.10 * cell };
      mat.uniforms.uLod = { value: new THREE.Vector2(
        Math.max(0, Math.log2(cell / (MACRO_EXT / MACRO_RES))),
        Math.max(0, Math.log2(cell / (FAR_EXT / FAR_RES)))) };
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(cell, 1, cell);
      m.frustumCulled = false;
      m.renderOrder = -10 + i;
      this.group.add(m);
      this.levels.push({ mesh: m, cell, snap: cell * 2 });
    }
  }

  /* ============================================================
     excavation
     ============================================================ */
  /* Mark a rect for GPU upload. Rects are kept as a SHORT LIST, never a single
     union: two dig sites 300 m apart would otherwise produce one rect spanning
     everything between them, and we would re-upload a third of the world. */
  _mark(x0, z0, x1, z1) {
    const M = this._marks;
    for (const m of M) {                        // merge only into a rect it touches
      if (x0 <= m[2] + 8 && x1 >= m[0] - 8 && z0 <= m[3] + 8 && z1 >= m[1] - 8) {
        m[0] = Math.min(m[0], x0); m[1] = Math.min(m[1], z0);
        m[2] = Math.max(m[2], x1); m[3] = Math.max(m[3], z1);
        return;
      }
    }
    if (M.length < 12) M.push([x0, z0, x1, z1]);
    else {                                      // over budget: fold into the first
      const m = M[0];
      m[0] = Math.min(m[0], x0); m[1] = Math.min(m[1], z0);
      m[2] = Math.max(m[2], x1); m[3] = Math.max(m[3], z1);
    }
  }

  /** An excavation that is still settling. Only the drill creates these — a
      compacted wheel rut does not flow, it stays exactly where you put it. */
  _slumpRegion(x0, z0, x1, z1) {
    for (const r of this._slumps) {
      if (x0 <= r[2] + 4 && x1 >= r[0] - 4 && z0 <= r[3] + 4 && z1 >= r[1] - 4) {
        r[0] = Math.min(r[0], x0); r[1] = Math.min(r[1], z0);
        r[2] = Math.max(r[2], x1); r[3] = Math.max(r[3], z1);
        r[4] = SLUMP_TTL;
        return;
      }
    }
    if (this._slumps.length >= 8) this._slumps.shift();
    this._slumps.push([x0, z0, x1, z1, SLUMP_TTL]);
  }

  /** Carve a bowl and pile the spoil into a rim. Volume-conserving. */
  excavate(wx, wz, radius, depth) {
    const DENT_RES = this.dentRes;
    const px = DENT_EXT / DENT_RES, half = DENT_RES * 0.5;
    const R = radius * 1.85;
    const gx0 = Math.max(1, Math.floor((wx - R) / px + half));
    const gx1 = Math.min(DENT_RES - 2, Math.ceil((wx + R) / px + half));
    const gz0 = Math.max(1, Math.floor((wz - R) / px + half));
    const gz1 = Math.min(DENT_RES - 2, Math.ceil((wz + R) / px + half));
    if (gx1 < gx0 || gz1 < gz0) return;
    for (let gz = gz0; gz <= gz1; gz++) {
      const p = (gz - half + 0.5) * px;
      for (let gx = gx0; gx <= gx1; gx++) {
        const q = (gx - half + 0.5) * px;
        const t = Math.hypot(q - wx, p - wz) / radius;
        if (t >= 1.85) continue;
        let d;
        if (t < 1) d = Math.pow(Math.cos(t * Math.PI) * 0.5 + 0.5, 1.35);
        else { const u = (t - 1) / 0.85; d = -Math.sin(u * Math.PI) * (1 - u) * 0.62; }
        const i = gz * DENT_RES + gx;
        this.dent[i] = clamp(this.dent[i] + d * depth, -1.1, 3.6);
      }
    }
    this._mark(gx0, gz0, gx1, gz1);
    this._slumpRegion(gx0, gz0, gx1, gz1);
  }

  /** Cut a wheel rut.
      Regolith is displaced, not destroyed: what the wheel presses down piles up
      into berms along both flanks, which is what turns a dark stripe into an
      actual furrow you can see across the basin. Rolling settles toward a
      target depth and stops there; `dig` accumulates without limit, because
      that is exactly what a spinning wheel does — and it is how you bury
      yourself to the axle.  */
  rut(wx, wz, halfWidth, depth, dig) {
    const DENT_RES = this.dentRes;
    const px = DENT_EXT / DENT_RES, half = DENT_RES * 0.5;
    const R = halfWidth * BERM_OUT;
    const gx0 = Math.max(1, Math.floor((wx - R) / px + half));
    const gx1 = Math.min(DENT_RES - 2, Math.ceil((wx + R) / px + half));
    const gz0 = Math.max(1, Math.floor((wz - R) / px + half));
    const gz1 = Math.min(DENT_RES - 2, Math.ceil((wz + R) / px + half));
    if (gx1 < gx0 || gz1 < gz0) return;
    const D = this.dent;
    for (let gz = gz0; gz <= gz1; gz++) {
      const p = (gz - half + 0.5) * px;
      for (let gx = gx0; gx <= gx1; gx++) {
        const q = (gx - half + 0.5) * px;
        const t = Math.hypot(q - wx, p - wz) / halfWidth;
        const i = gz * DENT_RES + gx;
        if (t < 1) {
          const target = depth * (1 - 0.30 * t * t);        // near-flat floor
          if (dig) D[i] = Math.min(DIG_CAP, D[i] + dig * (1 - 0.5 * t));
          else if (D[i] < target) D[i] = Math.min(target, D[i] + depth * 0.6);
        } else if (t < BERM_OUT) {
          // Never let the berm pass eat a trough. Successive calls overlap as
          // the wheel rolls, so a texel that was rut floor one step ago lands
          // in the berm annulus the next — and without this guard the two
          // passes fight and cancel each other into flat ground.
          if (D[i] > 0.004) continue;
          const u = (t - 1) / (BERM_OUT - 1);
          const lobe = Math.sin(u * Math.PI) * (1 - u) * 1.55;
          const target = -depth * lobe * BERM_GAIN - (dig ? dig * lobe * 2.2 : 0);
          if (D[i] > target) D[i] = Math.max(target, D[i] - Math.max(depth, dig) * 0.5);
        }
      }
    }
    this._mark(gx0, gz0, gx1, gz1);
    // Only a churned rut creeps back; a compacted one stays put for a billion years.
    if (dig) this._slumpRegion(gx0, gz0, gx1, gz1);
  }

  /** Dry regolith cannot hold a wall: relax anything past the angle of repose.
      Each excavation settles on its own clock, inside its own small rect. */
  relax(dt) {
    if (!this._slumps.length) return;
    const DENT_RES = this.dentRes;
    const D = this.dent, n = DENT_RES;
    const px = DENT_EXT / DENT_RES;
    const STEP = 0.62 * px;                    // ≈ 32° repose angle for dry regolith
    const STEPD = STEP * 1.41421;
    const FLOW = Math.min(0.42, dt * 9);
    for (let k = this._slumps.length - 1; k >= 0; k--) {
      const r = this._slumps[k];
      r[4] -= dt;
      const x0 = Math.max(1, r[0] - 1), z0 = Math.max(1, r[1] - 1);
      const x1 = Math.min(DENT_RES - 2, r[2] + 1), z1 = Math.min(DENT_RES - 2, r[3] + 1);
      if (x1 < x0 || z1 < z0 || r[4] <= 0) { this._slumps.splice(k, 1); continue; }
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const i = z * n + x;
        let si = -D[i];
        const move = (j, thr) => {
          const sj = -D[j], d = si - sj;
          if (d > thr) { const m = (d - thr) * FLOW * 0.5; D[i] += m; D[j] -= m; si -= m; }
        };
        move(i - 1, STEP); move(i + 1, STEP); move(i - n, STEP); move(i + n, STEP);
        move(i - n - 1, STEPD); move(i - n + 1, STEPD); move(i + n - 1, STEPD); move(i + n + 1, STEPD);
      }
      this._mark(x0, z0, x1, z1);
    }
  }

  _uploadDirty() {
    if (!this._marks.length) return;
    for (const m of this._marks) this._uploadRect(m[0], m[1], m[2], m[3]);
    this._marks.length = 0;
  }

  _uploadRect(x0, z0, x1, z1) {
    const DENT_RES = this.dentRes;
    x0 = Math.max(0, x0); z0 = Math.max(0, z0);
    x1 = Math.min(DENT_RES - 1, x1); z1 = Math.min(DENT_RES - 1, z1);
    if (x1 < x0 || z1 < z0) return;
    const need = Math.max(x1 - x0 + 1, z1 - z0 + 1);
    const sc = this.scratches.find(s => s.n >= need) || this.scratches[this.scratches.length - 1];
    const S = sc.n, data = sc.tex.image.data;
    const half = THREE.DataUtils.toHalfFloat;
    for (let by = z0; by <= z1; by += S) {
      for (let bx = x0; bx <= x1; bx += S) {
        // The blit always writes a full S-square, so clamp the origin inward
        // rather than running off the edge of the texture.
        const ox = Math.min(bx, DENT_RES - S), oz = Math.min(by, DENT_RES - S);
        for (let y = 0; y < S; y++) {
          const src = (oz + y) * DENT_RES, dst = y * S;
          for (let x = 0; x < S; x++) data[dst + x] = half(this.dent[src + ox + x]);
        }
        sc.tex.needsUpdate = true;
        this.renderer.copyTextureToTexture(new THREE.Vector2(ox, oz), sc.tex, this.texDent);
      }
    }
  }

  /* ============================================================
     wheel trails
     ============================================================ */
  _trailQuad() {
    if (this._trailUsed < this._trailPool.length) return this._trailPool[this._trailUsed++];
    const m = new THREE.Mesh(this._trailGeo, this._trailProto.clone());
    m.frustumCulled = false; m.visible = false;
    this._trailPool.push(m); this._trailUsed++;
    this.trailScene.add(m);
    return m;
  }
  /** Queue a track segment. The buffer is a top-down orthographic view, so
      +Z in the world maps to −Y in the buffer. */
  addTrack(ax, az, bx, bz, width, strength) {
    if (this._trailUsed >= 96) return;                       // hard per-frame cap
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4 || !Number.isFinite(len)) return;
    const m = this._trailQuad();
    m.position.set((ax + bx) * 0.5, -(az + bz) * 0.5, 0);
    m.rotation.z = Math.atan2(-dz, dx);
    m.scale.set(len + width * 0.5, width, 1);
    const s = clamp(strength, 0, 1);
    m.material.color.setScalar(s);
    m.visible = true;
  }
  _flushTrails() {
    if (this._trailUsed === 0) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.trailRT);
    r.render(this.trailScene, this.trailCam);          // one pass, all queued quads
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    for (let i = 0; i < this._trailUsed; i++) this._trailPool[i].visible = false;
    this._trailUsed = 0;
  }
  clearTrails() {
    const r = this.renderer, p = r.getRenderTarget();
    const prev = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    r.setRenderTarget(this.trailRT);
    r.setClearColor(0x000000, 1); r.clear(true, false, false);
    r.setRenderTarget(p);
    r.setClearColor(prev, prevA);
  }

  /** Wipe every excavation and push the whole field back to the GPU. */
  clearDent() {
    this.dent.fill(0);
    this._slumps.length = 0;
    this._marks.length = 0;
    this._uploadRect(0, 0, this.dentRes - 1, this.dentRes - 1);
  }

  /* ============================================================
     live quality change
     ============================================================
     Re-fit everything the tier sizes, without re-baking the basin: bakeTerrain
     takes no quality argument, so the height field is tier-independent and the
     expensive half of the load is reusable. A tier change costs a hitch, not a
     reload.

     One rule holds this together: uniform VALUES are mutated in place and the
     wrapper objects are never replaced. Every clipmap ring shares these exact
     wrappers (buildClipmap does Object.assign to share them), and the dust holds
     uSunDir directly — swapping a wrapper would silently unwire both. */
  setQuality(q) {
    const prev = this.quality;
    this.quality = q;

    if (q.dentRes !== this.dentRes) this._resizeDent(q.dentRes);
    if (q.trailRes !== prev.trailRes) this._resizeTrail(q.trailRes);
    if (q.sunRes !== prev.sunRes) {
      this.sunRT.dispose();
      this.sunRT = new THREE.WebGLRenderTarget(q.sunRes, q.sunRes, {
        format: THREE.RedFormat, type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
      });
      this.uniforms.uSunMask.value = this.sunRT.texture;
    }
    this.sunMat.uniforms.uSteps.value = q.sunSteps;
    // The mask is derived from the height field and the sun angle, so there is
    // nothing to preserve — just force update() to redraw it next frame.
    this._lastSun.set(9, 9, 9);

    if (q.clipM !== prev.clipM || q.clipLevels !== prev.clipLevels || q.clipCell !== prev.clipCell) {
      this.buildClipmap();
    }
  }

  /** Reallocate the excavation field, resampling what is already dug into it.
      The field is the player's own ruts and drill pits; dropping them on a
      settings change would be a worse bug than the one this fixes. */
  _resizeDent(DR) {
    const src = this.dent, SR = this.dentRes;
    const out = new Float32Array(DR * DR);
    // Both grids cover the same ±DENT_EXT, so texel centres map linearly.
    const ratio = SR / DR;
    for (let z = 0; z < DR; z++) {
      const sz = (z + 0.5) * ratio - 0.5;
      const z0 = Math.floor(sz), fz = sz - z0;
      const za = clamp(z0, 0, SR - 1) * SR, zb = clamp(z0 + 1, 0, SR - 1) * SR;
      for (let x = 0; x < DR; x++) {
        const sx = (x + 0.5) * ratio - 0.5;
        const x0 = Math.floor(sx), fx = sx - x0;
        const xa = clamp(x0, 0, SR - 1), xb = clamp(x0 + 1, 0, SR - 1);
        const h0 = src[za + xa] + (src[za + xb] - src[za + xa]) * fx;
        const h1 = src[zb + xa] + (src[zb + xb] - src[zb + xa]) * fx;
        out[z * DR + x] = h0 + (h1 - h0) * fz;
      }
    }

    this.dent = out;
    this.dentRes = DR;
    this.dentHalf = new Uint16Array(DR * DR);
    const half = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < out.length; i++) this.dentHalf[i] = half(out[i]);

    this.texDent.dispose();
    this.texDent = new THREE.DataTexture(this.dentHalf, DR, DR, THREE.RedFormat, THREE.HalfFloatType);
    this.texDent.magFilter = this.texDent.minFilter =
      this.manualBilinear ? THREE.NearestFilter : THREE.LinearFilter;
    this.texDent.generateMipmaps = false;
    // Upload the whole field as one texture rather than replaying it through
    // the scratch blitter: copyTextureToTexture needs a destination that is
    // already resident, and a fresh DataTexture is not until three uploads it.
    this.texDent.needsUpdate = true;

    this.uniforms.uDent.value = this.texDent;
    this.uniforms.uTexRes.value.w = DR;
    // Both lists index the grid that just went away.
    this._marks.length = 0;
    this._slumps.length = 0;
  }

  /** Reallocate the wheel-track buffer, copying the existing tracks across.
      Tracks are the record of where you have been; a settings change should
      not erase them. */
  _resizeTrail(TR) {
    const old = this.trailRT;
    this.trailRT = new THREE.WebGLRenderTarget(TR, TR, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    });
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(this.TRAIL_EXT, this.TRAIL_EXT),
      new THREE.MeshBasicMaterial({ map: old.texture, depthTest: false, depthWrite: false, toneMapped: false })
    );
    quad.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(quad);
    const r = this.renderer, p = r.getRenderTarget();
    r.setRenderTarget(this.trailRT);
    r.setClearColor(0x000000, 1); r.clear(true, false, false);
    r.render(sc, this.trailCam);
    r.setRenderTarget(p);
    quad.geometry.dispose(); quad.material.dispose();
    old.dispose();
    this.uniforms.uTrail.value = this.trailRT.texture;
  }

  /* ============================================================
     per-frame
     ============================================================ */
  update(dt, camera, sunDir) {
    // clipmap follow + snap
    const cx = camera.position.x, cz = camera.position.z;
    this.uniforms.uCamXZ.value.set(cx, cz, 0);
    for (const L of this.levels) {
      L.mesh.position.x = Math.round(cx / L.snap) * L.snap;
      L.mesh.position.z = Math.round(cz / L.snap) * L.snap;
    }
    this.relax(dt);
    this._uploadDirty();
    this._flushTrails();

    // rebake the sun mask only when the sun has actually moved
    if (sunDir.distanceToSquared(this._lastSun) > 2e-6) {
      this._lastSun.copy(sunDir);
      this.sunMat.uniforms.uSun.value.copy(sunDir);
      const r = this.renderer, p = r.getRenderTarget();
      r.setRenderTarget(this.sunRT);
      r.render(this._sunScene, this._sunCam);
      r.setRenderTarget(p);
    }
  }

  dispose() {
    this.texMacro.dispose(); this.texFar.dispose(); this.texDetail.dispose();
    this.texDent.dispose();
    for (const s of this.scratches) s.tex.dispose();
    this.trailRT.dispose(); this.sunRT.dispose();
    for (const L of this.levels) { L.mesh.geometry.dispose(); L.mesh.material.dispose(); }
  }
}

const _v3a = new THREE.Vector3();

/** Cross-section profile of a wheel rut: compacted plateau, soft shoulders.
    Uniform along its length so the quad can be stretched to any distance. */
function makeTrackStamp() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    const v = Math.abs((y + 0.5) / S * 2 - 1);            // 0 centre .. 1 edge
    let a = 1 - sstep(0.55, 1.0, v);
    a *= 0.82 + 0.18 * Math.cos(v * 9.0);                  // faint twin-rut relief
    const k = Math.round(clamp(a, 0, 1) * 255);
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = k;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
