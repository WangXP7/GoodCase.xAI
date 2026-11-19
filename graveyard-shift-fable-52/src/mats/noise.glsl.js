// Shared GLSL noise library for every surface shader. Noise is read from the textures generated at
// load by noiseTex.js (fbm value + gradient, voronoi, one-octave streak noise); what stays analytic is
// what is cheap and must be exact: integer hashes, single-cell domes (beads, grains), iso-contour
// lines, and a bicubic (B-spline) sampler for data maps so texels never show.
//
// Conventions:
//   - *D functions return vec4(value, d/dx, d/dy, d/dz). Values are in [0,1].
//   - gFp (set by surface.js) is the size of one pixel in noise space. sFade(freq) is 1 while a
//     feature of that spatial frequency is resolvable and falls to 0 before it reaches Nyquist.
//     Texture fetches choose their mip from gFp (gLod), so they are safe inside branches.
export const NOISE_GLSL = /* glsl */ `
float gFp = 0.001;

vec3 sHash3(ivec3 c) {
  uvec3 x = uvec3(c);
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  return vec3(x) * (1.0 / 4294967295.0);
}
float sHash1(ivec3 c) { return sHash3(c).x; }
vec3 sHash2(ivec2 c) { return sHash3(ivec3(c, 7)); }

float sFade(float freq) { return 1.0 - smoothstep(0.16, 0.5, gFp * freq); }

const mat3 S_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

// ---- texture-backed noise (noiseTex.js). These replace the procedural functions above at runtime:
// one fetch each, with the mip level chosen from gFp, so they are safe inside branches and fade to
// their mean with distance by themselves.
uniform highp sampler3D tNzA;
uniform highp sampler3D tNzB;
float gLod = 0.0;      // mip level of a volume sampled at one tile per unit of noise space

// fbm, three octaves up from 'freq' cycles per unit: x = value (mean 0.5), yzw = gradient per unit of p
vec4 sFbmD(vec3 p, float freq) {
  float sc = freq * (1.0 / NZ_BASE);
  vec4 t = textureLod(tNzA, p * sc, gLod + log2(sc));
  return vec4(t.x, (t.yzw - 0.5) * (2.0 * NZ_GRAD * freq));
}
float sFbm(vec3 p, float freq) {
  float sc = freq * (1.0 / NZ_BASE);
  return textureLod(tNzA, p * sc, gLod + log2(sc)).x;
}
// the same field with different frequencies across and along a direction
vec4 sAnisoD(vec3 p, vec3 dir, float perp, float along) {
  vec3 q = p * perp + dir * (dot(p, dir) * (along - perp));
  vec4 t = textureLod(tNzA, q * (1.0 / NZ_BASE), gLod + log2(max(perp, along) * (1.0 / NZ_BASE)));
  vec3 g = (t.yzw - 0.5) * (2.0 * NZ_GRAD);
  return vec4(t.x, g * perp + dir * (dot(g, dir) * (along - perp)));
}
// one octave of gradient noise; q is in lattice cells, fmax the largest scale applied to get there
float sNoise(vec3 q, float fmax) {
  return textureLod(tNzB, q * (1.0 / NZ_BASE), gLod + log2(fmax * (1.0 / NZ_BASE))).a;
}
// voronoi, 'cells' per unit: x = F1, y = F2 - F1 (0 on cell edges), z = cell id, w = unrelated noise
vec4 sVoro(vec3 p, float cells) {
  float sc = cells * (1.0 / NZ_VORO);
  return textureLod(tNzB, p * sc, gLod + log2(sc));
}
// Sparse round domes (water beads, sand grains, pills): jittered spheres on a 3D grid, cut by the
// surface. Analytic and exact at any distance from one hash: each sphere stays inside its own cell, so
// only that cell is tested. 'amount' is the fraction of cells that hold one.
// x = coverage 0..1, y = dome height 0..1, z = radius in cells, w = per-dome random.
vec3 gDomeSlope = vec3(0.0);   // slope of the last dome evaluated (noise space, per cell)
vec4 sDomes(vec3 p, float cells, float amount) {
  vec3 q = p * cells;
  vec3 fl = floor(q);
  vec3 h = sHash3(ivec3(fl));
  float pick = fract(h.x * 7.31 + h.y * 3.17);
  vec3 r = q - (fl + 0.5 + (h - 0.5) * 0.4);
  float rad = 0.12 + 0.17 * fract(h.z * 5.3 + pick);
  float t = 1.0 - dot(r, r) / (rad * rad);
  gDomeSlope = vec3(0.0);
  if (pick > amount || t <= 0.0) return vec4(0.0, 0.0, rad, 0.0);
  gDomeSlope = -3.0 * t * r / rad;
  return vec4(smoothstep(0.0, 0.25, t), t, rad, fract(h.z * 11.3));
}
vec3 gGradX = vec3(0.0);       // extra analytic slope from shared layers (beads), added to Surf.grad
float gHt = 0.0;       // extra relief in metres, differentiated on screen once (beads, rivulets, pits)

// Straight hairline scratches along 'dir': the one-octave field squeezed along that direction, so
// each lattice cell becomes a long thin sliver, and only the brightest slivers are kept.
float sScratches(vec3 p, vec3 dir, float across, float along, float density) {
  float f = sFade(across);
  if (f <= 0.0) return 0.0;
  float n = sNoise(p * across - dir * dot(p, dir) * (across - along), across);
  return smoothstep(1.0 - density, 1.0 - density * 0.6, n) * f;
}

// Thin winding line along the 0.5 iso-contour of a noise field: returns distance to the line in the
// field's own space units (metres if p is metres), using the analytic gradient for constant width.
float sIsoDist(vec4 n) { return abs(n.x - 0.5) / max(length(n.yzw), 1e-4); }

// B-spline bicubic from four bilinear taps. The texture must use linear filtering.
vec4 sBicubic(sampler2D t, vec2 uv, float res) {
  vec2 st = uv * res - 0.5; vec2 i = floor(st); vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / res, h1 = (i + 1.5 + w3 / g1) / res;
  return g0.y * (g0.x * texture2D(t, h0) + g1.x * texture2D(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)) + g1.x * texture2D(t, h1));
}

float sLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sSat(vec3 c, float k) { return max(mix(vec3(sLuma(c)), c, k), 0.0); }
`;
