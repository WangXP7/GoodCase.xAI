// Noise textures, generated once at load on the GPU. Every surface shader reads its noise from
// these instead of evaluating fbm / voronoi per pixel per frame.
//
//   tNzA  128^3 RGBA8, tiling, mip-mapped   fbm: x = value, yzw = its gradient (see NZ_* below)
//   tNzB  128^3 RGBA8, tiling, mip-mapped   voronoi: r = F1, g = F2 - F1 (edge distance), b = cell id;
//                                           a = one octave of gradient noise (streaks, scratches)
//   tAgg  1024^2 RGBA8, tiling, mip-mapped  asphalt aggregate: r = stone height, gb = slope, a = stone tone
//
// Volumes rather than 2D tiles because the library samples noise by 3D position (world or rest
// space), so there are no UVs to depend on and no projection seams. Mip-mapping is the distance fade.
import {
  WebGL3DRenderTarget, WebGLRenderTarget, Data3DTexture, DataTexture, ShaderMaterial, Mesh, PlaneGeometry,
  OrthographicCamera, Scene, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType,
  NoColorSpace, NoBlending,
} from 'three';

export const NZ_RES = 128;       // volume resolution
export const NZ_BASE = 8;        // lattice cells of the lowest fbm octave (and of tNzB.a) per tile
export const NZ_GRAD = 4;        // stored gradient range: +-NZ_GRAD per base cell
export const NZ_VORO = 16;       // voronoi cells per tile
export const AGG_RES = 1024;
export const AGG_CELLS = 128;    // stones per tile
export const AGG_PER_M = 170;    // stones per metre (so one tile is AGG_CELLS / AGG_PER_M metres)
export const AGG_SLOPE = 3;      // stored slope range

const GEN_FRAG = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform float uZ;
uniform int uMode;

vec3 hash3(ivec3 c) {
  uvec3 x = uvec3(c);
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  x = ((x >> 8U) ^ x.yzx) * 1103515245U;
  return vec3(x) * (1.0 / 4294967295.0);
}
ivec3 wrap3(ivec3 c, int n) { return (c + n * 4) % n; }

// periodic gradient noise with analytic derivative: value about [0,1], gradient per lattice cell
vec4 pNoiseD(vec3 x, int n, int seed) {
  vec3 i = floor(x); vec3 f = x - i; ivec3 c = ivec3(i);
  ivec3 so = ivec3(seed * 131 + 7, seed * 17 + 3, seed * 71 + 11);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  #define G(ox, oy, oz) (hash3(wrap3(c + ivec3(ox, oy, oz), n) + so) * 2.0 - 1.0)
  vec3 ga = G(0, 0, 0), gb = G(1, 0, 0), gc = G(0, 1, 0), gd = G(1, 1, 0);
  vec3 ge = G(0, 0, 1), gf = G(1, 0, 1), gg = G(0, 1, 1), gh = G(1, 1, 1);
  float va = dot(ga, f), vb = dot(gb, f - vec3(1.0, 0.0, 0.0)), vc = dot(gc, f - vec3(0.0, 1.0, 0.0)), vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0)), vf = dot(gf, f - vec3(1.0, 0.0, 1.0)), vg = dot(gg, f - vec3(0.0, 1.0, 1.0)), vh = dot(gh, f - vec3(1.0));
  float kxy = va - vb - vc + vd, kyz = va - vc - ve + vg, kzx = va - vb - ve + vf, kxyz = -va + vb + vc - vd + ve - vf - vg + vh;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * kxy + u.y * u.z * kyz + u.z * u.x * kzx + u.x * u.y * u.z * kxyz;
  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
    + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3(vb, vc, ve) - va + u.yzx * vec3(kxy, kyz, kzx) + u.zxy * vec3(kzx, kxy, kyz) + u.yzx * u.zxy * kxyz);
  return vec4(0.5 + 0.85 * v, 0.85 * d);
}

void main() {
  vec3 u = vec3(vUv, uZ);
  if (uMode == 0) {
    // three octaves of fbm, gradient in units of the base cell
    vec4 acc = vec4(0.0); float a = 0.5, norm = 0.0;
    for (int k = 0; k < 3; k++) {
      int n = ${NZ_BASE} << k;
      vec4 nz = pNoiseD(u * float(n), n, k);
      acc.x += a * nz.x; acc.yzw += a * float(1 << k) * nz.yzw;
      norm += a; a *= 0.5;
    }
    acc /= norm;
    gl_FragColor = vec4(acc.x, acc.yzw / ${(2 * NZ_GRAD).toFixed(1)} + 0.5);
  } else if (uMode == 1) {
    vec3 q = u * ${NZ_VORO.toFixed(1)};
    ivec3 c = ivec3(floor(q)); vec3 f = fract(q);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec3 o = ivec3(i, j, k);
      vec3 h = hash3(wrap3(c + o, ${NZ_VORO}) + ivec3(5, 9, 2));
      vec3 r = f - (vec3(o) + 0.5 + (h - 0.5) * 0.8);
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = fract(h.x * 13.7 + h.y); } else if (d < d2) { d2 = d; }
    }
    d1 = sqrt(d1); d2 = sqrt(d2);
    gl_FragColor = vec4(d1, d2 - d1, id, pNoiseD(u * ${NZ_BASE.toFixed(1)}, ${NZ_BASE}, 9).x);
  } else {
    // asphalt aggregate: angular crushed stone, flat-topped and tilted, each inset by its own amount
    vec2 p = vUv * ${AGG_CELLS.toFixed(1)};
    vec3 w3 = vec3(vUv * 52.0, 0.5);
    p += 0.6 * (vec2(pNoiseD(w3, 52, 3).x, pNoiseD(w3 + vec3(0.0, 0.0, 7.0), 52, 4).x) - 0.5);
    ivec2 c = ivec2(floor(p)); vec2 f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0; vec2 r1 = vec2(0.0), r2 = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec3 cc = wrap3(ivec3(c + ivec2(i, j), 0), ${AGG_CELLS}); cc.z = 7;
      vec3 h = hash3(cc);
      vec2 r = f - (vec2(i, j) + h.xy);
      float d = dot(r, r);
      if (d < d1) { d2 = d1; r2 = r1; d1 = d; id = h.z; r1 = r; } else if (d < d2) { d2 = d; r2 = r; }
    }
    d1 = sqrt(d1); d2 = sqrt(d2);
    float e = d2 - d1;
    float inset = 0.02 + 0.3 * fract(id * 23.7) * fract(id * 23.7);
    float te = clamp((e - inset) / 0.26, 0.0, 1.0);
    float sunk = 1.0 - 0.8 * step(fract(id * 5.3), 0.3);
    float h1 = te * te * (3.0 - 2.0 * te) * sunk;
    vec2 ge = r2 / max(d2, 1e-3) - r1 / max(d1, 1e-3);
    vec2 tilt = vec2(fract(id * 17.3), fract(id * 31.7)) - 0.5;
    vec2 g2 = ge * (6.0 * te * (1.0 - te) / 0.26) * sunk * (0.0006 * ${AGG_PER_M.toFixed(1)}) + tilt * 0.5 * h1;
    gl_FragColor = vec4(h1, g2 / ${(2 * AGG_SLOPE).toFixed(1)} + 0.5, id);
  }
}
`;

function setup(tex) {
  tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
  if ('wrapR' in tex) tex.wrapR = RepeatWrapping;
  tex.magFilter = LinearFilter; tex.minFilter = LinearMipmapLinearFilter;
  tex.colorSpace = NoColorSpace;
  return tex;
}

// Flat mid-grey stand-ins, for a stubbed renderer (tests) or a failed generation.
function placeholders() {
  const px = new Uint8Array([128, 128, 128, 128]);
  const mk3 = () => { const t = new Data3DTexture(px, 1, 1, 1); t.format = RGBAFormat; t.type = UnsignedByteType; t.needsUpdate = true; return t; };
  const t2 = new DataTexture(px, 1, 1, RGBAFormat, UnsignedByteType); t2.needsUpdate = true;
  return { tNzA: mk3(), tNzB: mk3(), tAgg: t2, ms: 0, placeholder: true };
}

// Returns { tNzA, tNzB, tAgg, ms }. Leaves the renderer's target, clear state and viewport as found.
export function createNoiseTextures(renderer) {
  if (!renderer || renderer.stub || !renderer.getContext) return placeholders();
  const t0 = performance.now();
  const mat = new ShaderMaterial({
    uniforms: { uZ: { value: 0 }, uMode: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GEN_FRAG, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new Scene(); scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  const prevXr = renderer.xr && renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate;
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  const volume = (mode) => {
    const rt = new WebGL3DRenderTarget(NZ_RES, NZ_RES, NZ_RES, { depthBuffer: false });
    setup(rt.texture);
    rt.texture.generateMipmaps = false;
    mat.uniforms.uMode.value = mode;
    for (let z = 0; z < NZ_RES; z++) {
      mat.uniforms.uZ.value = (z + 0.5) / NZ_RES;
      if (z === NZ_RES - 1) rt.texture.generateMipmaps = true;     // build the mip chain once, after the last slice
      renderer.setRenderTarget(rt, z);
      renderer.render(scene, cam);
    }
    return rt;
  };
  let out;
  try {
    const a = volume(0), b = volume(1);
    const agg = new WebGLRenderTarget(AGG_RES, AGG_RES, { depthBuffer: false });
    setup(agg.texture);
    agg.texture.generateMipmaps = true;
    agg.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    mat.uniforms.uMode.value = 2;
    renderer.setRenderTarget(agg);
    renderer.render(scene, cam);
    out = { tNzA: a.texture, tNzB: b.texture, tAgg: agg.texture, targets: [a, b, agg] };
  } catch (e) {
    console.error(`[mats] noise texture generation failed: ${e.message}`);
    out = placeholders();
  }
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAuto;
  renderer.shadowMap.autoUpdate = prevShadow;
  if (renderer.xr) renderer.xr.enabled = prevXr;
  mat.dispose(); quad.geometry.dispose();
  // the time to issue the work (the GPU finishes it in the background; waiting here with
  // gl.finish() held the boot for the whole of it)
  out.ms = performance.now() - t0;
  return out;
}
