/* =====================================================================
   10. WebGL2 渲染器
   ===================================================================== */

/* ---------- 着色器工具 ---------- */
class Prog {
  constructor(gl, vsSrc, fsSrc, name) {
    this.gl = gl; this.name = name || 'prog';
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + '.vs');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.fs');
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('链接失败 [' + this.name + ']: ' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this._u = Object.create(null);
  }
  u(n) {
    let l = this._u[n];
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, n); this._u[n] = l; }
    return l;
  }
  use() { this.gl.useProgram(this.p); return this; }
}
function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
    throw new Error('编译失败 [' + label + ']\n' + log + '\n----\n' + lines);
  }
  return s;
}

/* ---------- 着色器源码 ---------- */
const VS_TERRAIN = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLayer;
layout(location=3) in vec3 aLight;
uniform mat4 uProj, uView;
uniform vec3 uOffset;
uniform float uTime;
uniform float uWave;
out vec2 vUV;
out float vLayer;
out vec3 vLight;
out float vDist;
void main(){
  vec3 wp = aPos + uOffset;
  if (uWave > 0.5) {
    wp.y += sin(wp.x * 0.94 + uTime * 1.85) * 0.031
          + sin(wp.z * 1.17 + uTime * 1.35) * 0.031
          + sin((wp.x + wp.z) * 0.5 + uTime * 2.6) * 0.016 - 0.042;
  }
  vUV = aUV; vLayer = aLayer; vLight = aLight;
  vec4 vp = uView * vec4(wp, 1.0);
  vDist = length(vp.xyz);
  gl_Position = uProj * vp;
}`;

const FS_TERRAIN = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV; in float vLayer; in vec3 vLight; in float vDist;
uniform sampler2DArray uAtlas;
uniform vec3 uSkyColor, uBlockColor, uFogColor, uTint;
uniform float uFogStart, uFogEnd, uAmbient, uAlpha, uAlphaTest, uBrightness;
out vec4 frag;
void main(){
  vec4 tex = texture(uAtlas, vec3(vUV, vLayer));
  if (uAlphaTest > 0.5 && tex.a < 0.5) discard;
  vec3 lc = max(vec3(vLight.x) * uSkyColor, vec3(vLight.y) * uBlockColor);
  lc = lc * vLight.z + uAmbient;
  vec3 c = tex.rgb * lc * uTint * uBrightness;
  float f = clamp((vDist - uFogStart) / max(0.001, uFogEnd - uFogStart), 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  c = mix(c, uFogColor, f);
  frag = vec4(c, tex.a * uAlpha);
}`;

const VS_SKY = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uView;
uniform float uTanHalfFov, uAspect;
out vec3 vDir;
void main(){
  vec3 dc = vec3(aPos.x * uTanHalfFov * uAspect, aPos.y * uTanHalfFov, -1.0);
  vDir = normalize(transpose(mat3(uView)) * dc);
  gl_Position = vec4(aPos, 0.99999, 1.0);
}`;

const FS_SKY = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform sampler2D uStars;
uniform float uStarAlpha, uSunGlow;
out vec4 frag;
void main(){
  float h = vDir.y;
  vec3 c;
  if (h >= 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), 0.62);
    c = mix(uHorizon, uZenith, t);
  } else {
    c = mix(uHorizon, uGround, clamp(-h * 2.6, 0.0, 1.0));
  }
  // 太阳附近的暖色扩散
  float sd = max(dot(normalize(vDir), uSunDir), 0.0);
  c += uSunColor * pow(sd, 5.0) * 0.22 * uSunGlow;
  c += uSunColor * pow(sd, 90.0) * 0.55 * uSunGlow;
  // 星空
  if (uStarAlpha > 0.001) {
    float u = atan(vDir.z, vDir.x) / 6.2831853 + 0.5;
    float v = acos(clamp(vDir.y, -1.0, 1.0)) / 3.14159265;
    float s = texture(uStars, vec2(u * 2.0, v)).r;
    c += vec3(s) * uStarAlpha * 0.95;
  }
  frag = vec4(c, 1.0);
}`;

const VS_BILLBOARD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uProj, uView;
uniform vec3 uCenter, uRight, uUp;
uniform vec2 uSize;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  vec3 wp = uCenter + uRight * (aPos.x * uSize.x) + uUp * (aPos.y * uSize.y);
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

const FS_TEXTURED = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uColor;
uniform float uCutoff;
out vec4 frag;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < uCutoff) discard;
  frag = vec4(t.rgb * uColor.rgb, t.a * uColor.a);
}`;

const VS_CLOUD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uProj, uView;
uniform vec3 uCenter;
uniform float uSize;
uniform vec2 uScroll;
out vec2 vUV;
out float vDist;
void main(){
  vec2 p = aPos * uSize;
  vec3 wp = vec3(uCenter.x + p.x, uCenter.y, uCenter.z + p.y);
  vUV = (p + uScroll) * 0.0042;
  vec4 vp = uView * vec4(wp, 1.0);
  vDist = length(vp.xyz);
  gl_Position = uProj * vp;
}`;

const FS_CLOUD = `#version 300 es
precision highp float;
in vec2 vUV; in float vDist;
uniform sampler2D uCloud;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
out vec4 frag;
void main(){
  vec4 t = texture(uCloud, vUV);
  if (t.a < 0.5) discard;
  vec3 c = t.rgb * uColor;
  float f = clamp((vDist - uFogStart) / max(0.001, uFogEnd - uFogStart), 0.0, 1.0);
  c = mix(c, uFogColor, f * 0.42);
  frag = vec4(c, 0.9);
}`;

const VS_LINE = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView;
uniform vec3 uOffset;
uniform mat3 uRot;
uniform vec3 uScale;
void main(){
  vec3 p = uRot * (aPos * uScale) + uOffset;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const FS_LINE = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main(){ frag = uColor; }`;

const VS_PARTICLE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uProj, uView;
uniform vec3 uCenter;
uniform vec2 uSize;
uniform float uLight;
out vec2 vUV;
out float vLight;
void main(){
  vUV = aPos * 0.5 + 0.5;
  vLight = uLight;
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up    = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 wp = uCenter + right * (aPos.x * uSize.x) + up * (aPos.y * uSize.y);
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

const FS_PARTICLE = `#version 300 es
precision highp float;
in vec2 vUV; in float vLight;
uniform sampler2D uTex;
uniform vec3 uColor;
out vec4 frag;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.4) discard;
  frag = vec4(t.rgb * uColor * vLight, 1.0);
}`;

/* =====================================================================
   渲染器
   ===================================================================== */
class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true,
      desynchronized: false,
    });
    if (!gl) throw new Error('浏览器不支持 WebGL2');
    this.gl = gl;
    this.canvas = canvas;

    // 各向异性过滤（有就用）
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = ext ? gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    this.anisoExt = ext;

    this.progTerrain = new Prog(gl, VS_TERRAIN, FS_TERRAIN, 'terrain');
    this.progSky = new Prog(gl, VS_SKY, FS_SKY, 'sky');
    this.progBB = new Prog(gl, VS_BILLBOARD, FS_TEXTURED, 'bb');
    this.progCloud = new Prog(gl, VS_CLOUD, FS_CLOUD, 'cloud');
    this.progLine = new Prog(gl, VS_LINE, FS_LINE, 'line');
    this.progPart = new Prog(gl, VS_PARTICLE, FS_PARTICLE, 'particle');

    // 全屏四边形
    this.quadVAO = gl.createVertexArray();
    const qb = gl.createBuffer();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.proj = M4.create();
    this.view = M4.create();
    this.viewRot = new Float32Array(9);

    this.fogStart = 60; this.fogEnd = 128;
    this.skyColor = [1, 1, 1];
    this.blockColor = [1.0, 0.87, 0.68];
    this.fogColor = [0.62, 0.75, 1.0];
    this.brightness = 1.0;
    this.ambient = 0.035;

    this.texAtlas = null;
    this.texCloud = null;
    this.texStars = null;
    this.tex2D = Object.create(null);   // name → WebGLTexture
    this.texLayers = Object.create(null); // name → layer index

    // 选中方块线框
    this.wireVAO = this._makeWireBox();
    // 手持方块 / 掉落物共用的立方体
    this.cubeVAO = this._makeCube();
    this.cubeIndexCount = 36;

    this.stats = { drawnChunks: 0, tris: 0, drawCalls: 0 };
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    this.aspect = w / h;
    this.dpr = dpr;
  }

  /* ---------- 纹理上传 ---------- */
  uploadAtlas(packed) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, packed.S, packed.S, packed.layers,
      0, gl.RGBA, gl.UNSIGNED_BYTE, packed.data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.anisoExt) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, this.aniso));
    this.texAtlas = t;
  }

  upload2D(name, pixels, opts = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixels.w, pixels.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.d);
    if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      opts.mipmap ? (opts.smooth ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_LINEAR) : (opts.smooth ? gl.LINEAR : gl.NEAREST));
    const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.anisoExt && opts.aniso) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opts.aniso, this.aniso));
    this.tex2D[name] = t;
    return t;
  }

  /** 从纹理层生成一个独立的 2D 纹理（用于物品图标 / 粒子） */
  makeLayerTexture(layer) {
    const gl = this.gl;
    const t = gl.createTexture();
    const src = this._atlasCPU;
    const px = new Uint8Array(1024);
    px.set(src.subarray(layer * 1024, layer * 1024 + 1024));
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex2D['layer_' + layer] = t;
    return t;
  }

  /** 生成星星贴图（等距柱状投影） */
  makeStars() {
    const W = 1024, H = 512;
    const px = new Uint8Array(W * H * 4);
    const rnd = mulberry32(20240614);
    const put = (x, y, v, cr, cg, cb) => {
      x = ((x % W) + W) % W; y = ((y % H) + H) % H;
      const i = (y * W + x) * 4;
      px[i] = cr; px[i + 1] = cg; px[i + 2] = cb; px[i + 3] = v;
    };
    for (let i = 0; i < 2600; i++) {
      const u = rnd(), v = rnd();
      const x = (u * W) | 0;
      // 极地附近星星更密（等距柱状投影的失真补偿）
      const y = (Math.pow(v, 1.0) * H) | 0;
      const b = Math.pow(rnd(), 2.6) * 255;
      const tint = rnd();
      let cr = b, cg = b, cb = b;
      if (tint < 0.12) { cr = b; cg = b * 0.86; cb = b * 0.72; }
      else if (tint > 0.9) { cr = b * 0.78; cg = b * 0.88; cb = b; }
      const a = b | 0;
      put(x, y, a, cr | 0, cg | 0, cb | 0);
      if (b > 190) { put(x + 1, y, a * 0.5, cr | 0, cg | 0, cb | 0); put(x, y + 1, a * 0.5, cr | 0, cg | 0, cb | 0); }
    }
    const t = this.gl.createTexture();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texStars = t;
  }

  /* ---------- 几何工具 ---------- */
  _makeWireBox() {
    const gl = this.gl;
    const e = 0.002;
    const a = -e, b = 1 + e;
    const P = [
      [a,a,a],[b,a,a],[b,a,a],[b,a,b],[b,a,b],[a,a,b],[a,a,b],[a,a,a],
      [a,b,a],[b,b,a],[b,b,a],[b,b,b],[b,b,b],[a,b,b],[a,b,b],[a,b,a],
      [a,a,a],[a,b,a],[b,a,a],[b,b,a],[b,a,b],[b,b,b],[a,a,b],[a,b,b],
    ];
    const vao = gl.createVertexArray();
    const vb = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P.flat()), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: P.length };
  }

  _makeCube() {
    const gl = this.gl;
    const P = [], UV = [], FC = [], I = [];
    const F = [
      [[1,0,0],[0,0,-1],[0,1,0]],   // +X
      [[-1,0,0],[0,0,1],[0,1,0]],   // -X
      [[0,1,0],[1,0,0],[0,0,-1]],   // +Y
      [[0,-1,0],[1,0,0],[0,0,1]],   // -Y
      [[0,0,1],[1,0,0],[0,1,0]],    // +Z
      [[0,0,-1],[-1,0,0],[0,1,0]],  // -Z
    ];
    for (let f = 0; f < 6; f++) {
      const [n, u, v] = F[f];
      const base = P.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px0 = 0.5 + su * 0.5 * u[0] + sv * 0.5 * v[0];
        const py0 = 0.5 + su * 0.5 * u[1] + sv * 0.5 * v[1];
        const pz0 = 0.5 + su * 0.5 * u[2] + sv * 0.5 * v[2];
        // 沿法线推到立方体表面
        const px = (n[0] !== 0) ? (n[0] > 0 ? 1 : 0) : px0;
        const py = (n[1] !== 0) ? (n[1] > 0 ? 1 : 0) : py0;
        const pz = (n[2] !== 0) ? (n[2] > 0 ? 1 : 0) : pz0;
        P.push(px, py, pz);
        UV.push(su * 0.5 + 0.5, 0.5 - sv * 0.5);
        FC.push(f);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const vao = gl.createVertexArray();
    const vb = gl.createBuffer(), ub = gl.createBuffer(), fb = gl.createBuffer(), ebo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(UV), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(FC), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: I.length, ebo };
  }

  /* ---------- 天空颜色 ---------- */
  computeSky(world, underwater) {
    const a = world.time * TAU;
    const sun = [Math.cos(a) * 0.86, Math.sin(a), Math.cos(a) * 0.5];
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    sun[0] /= len; sun[1] /= len; sun[2] /= len;

    const sy = Math.sin(a);
    const day = clamp(sy * 2.4 + 0.42, 0, 1);
    const dusk = clamp(1 - Math.abs(sy) / 0.34, 0, 1) * clamp((sy + 0.55) / 0.55, 0, 1);
    const night = 1 - day;

    const mix3 = (A, B, t) => [lerp(A[0],B[0],t), lerp(A[1],B[1],t), lerp(A[2],B[2],t)];
    const DAY_Z = [0.267, 0.502, 0.945], NIGHT_Z = [0.004, 0.006, 0.027];
    const DAY_H = [0.635, 0.804, 0.996], NIGHT_H = [0.035, 0.045, 0.098];
    const DUSK_H = [0.98, 0.51, 0.24];

    let zenith = mix3(NIGHT_Z, DAY_Z, day);
    let horizon = mix3(NIGHT_H, DAY_H, day);
    horizon = mix3(horizon, DUSK_H, dusk * 0.94);
    zenith = mix3(zenith, [0.40, 0.28, 0.56], dusk * 0.62);

    // 天光颜色（照亮方块）
    const DAY_L = [1.0, 1.0, 0.98], NIGHT_L = [0.16, 0.19, 0.30];
    let skyLight = mix3(NIGHT_L, DAY_L, day);
    skyLight = mix3(skyLight, [1.0, 0.72, 0.52], dusk * 0.55);

    const ground = mix3([0.05, 0.055, 0.075], horizon, day * 0.78);

    let fog = horizon.slice();
    // 雾色取地平线与天顶的中间调，避免远处淡出时出现硬色带
    fog = mix3(fog, zenith, 0.22);

    if (underwater) {
      fog = mix3(fog, [0.05, 0.16, 0.38], 0.88);
      skyLight = mix3(skyLight, [0.28, 0.46, 0.78], 0.5);
    }

    return { sun, day, dusk, night, zenith, horizon, ground, skyLight, fog, fogStart: this.fogStart, fogEnd: this.fogEnd };
  }
}
