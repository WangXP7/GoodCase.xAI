// Ground materials, made on the GPU at load: eight tiling surfaces rendered into two texture
// arrays (albedo + height, normal + roughness + occlusion). Also the shared tiling noise texture.
import * as THREE from 'three';

export const GROUND = { GRASS: 0, DIRT: 1, ROCK: 2, SHINGLE: 3, SALT: 4, ASH: 5, SNOW: 6, MUD: 7 };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Periodic noise: every function repeats exactly over uv 0..1.
const LIB = /* glsl */ `
float ph(vec2 p, vec2 per) {
  p = mod(p, per);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 ph2(vec2 p, vec2 per) {
  p = mod(p, per);
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float pn(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i, per), ph(i + vec2(1, 0), per), f.x), mix(ph(i + vec2(0, 1), per), ph(i + vec2(1, 1), per), f.x), f.y);
}
// fbm: freq = lattice cells across the tile
float fbm(vec2 uv, float freq, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * pn(uv * freq + float(i) * 7.3, vec2(freq));
    n += a;
    a *= 0.5;
    freq *= 2.0;
  }
  return s / n;
}
// Voronoi: x = distance to nearest point, y = second nearest, z = cell id
vec3 vor(vec2 uv, float freq) {
  vec2 x = uv * freq, i = floor(x), f = fract(x);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
    vec2 g = vec2(float(a), float(b));
    vec2 o = ph2(i + g, vec2(freq));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = ph(i + g + 3.7, vec2(freq)); }
    else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
`;

// One ground layer at a point of its tile: rgb = colour, a = height.
const GROUND_GLSL = /* glsl */ `
${LIB}
vec4 ground(vec2 uv, int uLayer) {
  vec3 col;
  float h;
  float n4 = fbm(uv, 4.0, 5), n16 = fbm(uv + 0.37, 16.0, 4), n64 = fbm(uv + 0.11, 64.0, 3);
  if (uLayer == 0) {
    // moor turf: matted dead grass, moss, bare soil between the tussocks
    vec3 v = vor(uv + (vec2(n16, n4) - 0.5) * 0.07, 13.0);
    vec3 v2 = vor(uv + 0.3 + (vec2(n4, n16) - 0.5) * 0.05, 31.0);
    float t1 = smoothstep(0.7, 0.1, v.x) * (0.4 + 0.6 * v.z);
    float t2 = smoothstep(0.7, 0.2, v2.x) * (0.3 + 0.7 * v2.z);
    float tuss = max(t1, t2 * 0.75);
    float fib = fbm(uv + 0.2, 96.0, 3);
    h = tuss * 0.5 + fib * 0.38 + n16 * 0.12;
    vec3 soil = srgb(30.0, 27.0, 21.0), straw = srgb(80.0, 74.0, 49.0), olive = srgb(49.0, 53.0, 32.0), moss = srgb(38.0, 46.0, 26.0);
    col = mix(soil, mix(olive, straw, smoothstep(0.3, 0.8, fib * 0.55 + v.z * 0.4 + (n4 - 0.5) * 0.5)), smoothstep(0.18, 0.55, h));
    col = mix(col, moss, smoothstep(0.5, 0.75, n4) * 0.45);
    col *= 0.86 + 0.28 * n16;
  } else if (uLayer == 1) {
    // trodden earth with small stones
    vec3 v = vor(uv + (vec2(n64, n16) - 0.5) * 0.02, 34.0);
    float stone = smoothstep(0.3, 0.16, v.x / (0.3 + 0.75 * fract(v.z * 17.3))) * step(0.965, v.z);
    vec3 cv = vor(uv + n16 * 0.05, 15.0);
    float crack = smoothstep(0.014, 0.0, cv.y - cv.x) * smoothstep(0.4, 0.7, n4);
    float rut = pn(vec2(uv.x * 6.0 + n4 * 1.5, uv.y * 40.0), vec2(6.0, 40.0));
    float puddle = smoothstep(0.62, 0.74, n4);
    // (grit, not fine noise: smooth noise this small reads as worm-tracks under a lamp held low)
    vec3 gv = vor(uv + 0.23, 61.0);
    float grit = smoothstep(0.72, 0.18, gv.x) * (0.25 + 0.75 * gv.z);
    h = fbm(uv + 0.37, 9.0, 3) * 0.42 + grit * 0.2 + n64 * 0.05 + rut * 0.16 + stone * 0.2 - crack * 0.12;
    h = mix(h, 0.18, puddle * 0.85);
    col = mix(srgb(38.0, 32.0, 27.0), srgb(74.0, 64.0, 53.0), n16 * 0.7 + n64 * 0.3);
    col = mix(col, srgb(66.0, 63.0, 59.0) * (0.75 + 0.4 * fract(v.z * 31.7)), stone * 0.8);
    col = mix(col, srgb(24.0, 21.0, 19.0), puddle * 0.7);
    col *= 1.0 - crack * 0.25;
  } else if (uLayer == 2) {
    // bedded rock: strata, joints, lichen
    float warp = n4 * 0.9 + n16 * 0.25;
    float strata = pn(vec2(uv.x * 4.0, (uv.y + warp * 0.12) * 44.0), vec2(4.0, 44.0));
    vec3 v = vor(uv + vec2(n16, n4) * 0.05, 7.0);
    float joint = smoothstep(0.05, 0.0, v.y - v.x);
    float pit = smoothstep(0.6, 0.85, n64);
    h = strata * 0.4 + n16 * 0.35 + n64 * 0.15 + v.z * 0.15 - joint * 0.55 - pit * 0.1;
    col = mix(srgb(44.0, 45.0, 49.0), srgb(92.0, 90.0, 86.0), strata * 0.55 + n16 * 0.45);
    col = mix(col, srgb(74.0, 66.0, 58.0), smoothstep(0.5, 0.8, n4) * 0.5);
    col = mix(col, srgb(104.0, 110.0, 84.0), smoothstep(0.64, 0.8, fbm(uv + 0.6, 5.0, 5)) * 0.4);
    col *= 1.0 - joint * 0.6;
  } else if (uLayer == 3) {
    // shingle: wave-rounded stones
    vec3 v = vor(uv, 26.0), v2 = vor(uv + 0.5, 58.0);
    float big = smoothstep(0.62, 0.2, v.x), small = smoothstep(0.6, 0.25, v2.x);
    h = max(big * (0.6 + 0.4 * v.z), small * 0.45);
    vec3 a = srgb(70.0, 70.0, 70.0), b = srgb(84.0, 82.0, 79.0), c = srgb(54.0, 55.0, 59.0), d = srgb(74.0, 66.0, 59.0);
    vec3 st = v.z < 0.3 ? c : v.z < 0.66 ? a : v.z < 0.92 ? b : d;
    col = mix(srgb(40.0, 38.0, 36.0), st * (0.86 + 0.28 * n64), smoothstep(0.1, 0.4, h));
    col *= 0.82 + 0.36 * n4;
  } else if (uLayer == 4) {
    // salt pan: polygonal plates with raised rims
    vec3 v = vor(uv + vec2(n16, n4) * 0.03, 6.0);
    float rim = smoothstep(0.1, 0.0, v.y - v.x);
    // (the crust is grains, not smooth noise: noise this fine turns to worm-tracks once it is lit from the side)
    vec3 g = vor(uv + 0.31, 46.0);
    float grain = smoothstep(0.78, 0.1, g.x) * (0.4 + 0.6 * g.z);
    float crust = fbm(uv + 0.2, 18.0, 3);
    h = rim * 0.72 + grain * 0.12 + crust * 0.16 + (v.z - 0.5) * 0.08;
    col = mix(srgb(200.0, 186.0, 182.0), srgb(238.0, 230.0, 224.0), crust * 0.45 + grain * 0.2 + rim * 0.5);
    col = mix(col, srgb(176.0, 142.0, 138.0), smoothstep(0.45, 0.8, n4) * 0.35 * (1.0 - rim));
    col *= 0.9 + 0.2 * n16;
  } else if (uLayer == 5) {
    // cooled lava and ash
    vec3 v = vor(uv + vec2(n16, n4) * 0.06, 9.0);
    float gap = smoothstep(0.09, 0.0, v.y - v.x);
    float ropy = pn(vec2(uv.x * 8.0 + n4 * 3.0, uv.y * 72.0), vec2(8.0, 72.0));
    h = (1.0 - gap) * (0.5 + 0.3 * v.z) + ropy * 0.2 + n64 * 0.1;
    float dust = smoothstep(0.55, 0.3, h + n16 * 0.3);
    col = mix(srgb(26.0, 25.0, 28.0), srgb(52.0, 49.0, 50.0), ropy * 0.5 + n64 * 0.5);
    col = mix(col, srgb(92.0, 86.0, 80.0), dust * 0.75);
    col *= 1.0 - gap * 0.7;
  } else if (uLayer == 6) {
    // wind-packed snow
    float rip = pn(vec2(uv.x * 12.0 + n4 * 2.0, uv.y * 56.0 + n16 * 3.0), vec2(12.0, 56.0));
    h = n4 * 0.4 + rip * 0.4 + n64 * 0.2;
    col = mix(srgb(168.0, 184.0, 204.0), srgb(226.0, 232.0, 240.0), h);
  } else {
    // silt and mud
    vec3 v = vor(uv, 34.0);
    float stone = smoothstep(0.3, 0.2, v.x) * step(0.94, v.z);
    float rip = pn(vec2(uv.x * 20.0 + n4 * 4.0, uv.y * 6.0), vec2(20.0, 6.0));
    h = n4 * 0.3 + rip * 0.25 + n64 * 0.08 + stone * 0.4;
    col = mix(srgb(36.0, 31.0, 26.0), srgb(64.0, 56.0, 46.0), n16 * 0.6 + rip * 0.4);
    col = mix(col, srgb(70.0, 68.0, 64.0), stone);
  }
  return vec4(col, clamp(h, 0.0, 1.0));
}
`;

const ALBEDO = /* glsl */ `
varying vec2 vUv;
uniform int uLayer;
${GROUND_GLSL}
void main() {
  gl_FragColor = ground(vUv, uLayer);
}
`;

// The relief is taken from the height as it is computed, not from the 8-bit copy beside the colour:
// a gentle slope stored in 256 steps comes back as terraces, and a lamp held low draws every one.
const NORMAL = /* glsl */ `
varying vec2 vUv;
uniform int uLayer;
uniform float uStrength;
uniform float uRough;
${GROUND_GLSL}
void main() {
  float t = 1.0 / 512.0;
  float hl = ground(vUv - vec2(t, 0.0), uLayer).a, hr = ground(vUv + vec2(t, 0.0), uLayer).a;
  float hd = ground(vUv - vec2(0.0, t), uLayer).a, hu = ground(vUv + vec2(0.0, t), uLayer).a;
  float h = ground(vUv, uLayer).a;
  vec3 n = normalize(vec3((hl - hr) * uStrength, (hd - hu) * uStrength, 1.0));
  float ao = clamp(0.55 + h * 0.7, 0.0, 1.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(uRough + (0.5 - h) * 0.25, 0.05, 1.0), ao);
}
`;

// strength of the relief and base roughness per layer
const RELIEF = [5, 4, 4.8, 3.6, 5, 6, 2.2, 3];
const ROUGH = [0.95, 0.92, 0.84, 0.66, 0.5, 0.88, 0.72, 0.4];

/** Render the ground texture arrays. Returns { albedo, normal } (both DataArrayTexture-like). */
export function makeGroundTextures(renderer, size = 512) {
  const layers = 8;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mk = (srgb) => {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, layers, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false });
    const t = rt.texture;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return rt;
  };
  const A = mk(true),
    N = mk(false);
  const mA = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ALBEDO, uniforms: { uLayer: { value: 0 } }, depthTest: false, depthWrite: false });
  const mN = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: NORMAL, uniforms: { uLayer: { value: 0 }, uStrength: { value: 4 }, uRough: { value: 0.9 } }, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(geo, mA);
  quad.frustumCulled = false;
  const prev = renderer.getRenderTarget();
  for (let i = 0; i < layers; i++) {
    mA.uniforms.uLayer.value = i;
    renderer.setRenderTarget(A, i);
    renderer.render(quad, cam);
  }
  quad.material = mN;
  for (let i = 0; i < layers; i++) {
    mN.uniforms.uLayer.value = i;
    mN.uniforms.uStrength.value = RELIEF[i];
    mN.uniforms.uRough.value = ROUGH[i];
    renderer.setRenderTarget(N, i);
    renderer.render(quad, cam);
  }
  renderer.setRenderTarget(prev);
  mA.dispose();
  mN.dispose();
  geo.dispose();
  return { albedo: A.texture, normal: N.texture };
}

/** 256 x 256 RGBA tiling value noise, four independent fractal channels. */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (x, y, per, s) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let fx = x - xi,
      fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % per) + per) % per,
      y0 = ((yi % per) + per) % per,
      x1 = (x0 + 1) % per,
      y1 = (y0 + 1) % per;
    const a = hash(x0, y0, s),
      b = hash(x1, y0, s),
      c = hash(x0, y1, s),
      d = hash(x1, y1, s);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  for (let c = 0; c < 4; c++) {
    let min = 1e9,
      max = -1e9;
    const tmp = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let v = 0,
          a = 0.5,
          per = 4;
        for (let o = 0; o < 5; o++) {
          v += a * vn((x / size) * per, (y / size) * per, per, c * 31 + o);
          a *= 0.5;
          per *= 2;
        }
        tmp[y * size + x] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = ((tmp[i] - min) / (max - min)) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
