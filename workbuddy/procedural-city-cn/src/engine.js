/* ============================================================
 * engine.js — 程序化城市引擎核心
 * 种子随机 / 地面画布 / 楼宇 / 街道 / 植被 / 载具 / 水面 / 天空 / 时段光照
 * 约定：1 单位 = 1 米；所有几何按材质合并，控制 draw call
 * ========================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hipRoof, gableRoof } from './lib/roofs.js';

/* ---------------- 随机 ---------------- */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- 时段预设 ---------------- */
export const TIMES = {
  dawn:  { key: 'dawn',  name: '晨', sun: [0.62, 0.20, 0.42], sunCol: 0xffcfa2, sunI: 2.4,
           hemiSky: 0xc3cfdd, hemiGnd: 0x5b5348, hemiI: 0.85, fogCol: 0xc6ccd4, fogD: 1.0,
           expo: 1.06, win: 0.10, lamp: 0.15, neon: 0.10, star: 0.0 },
  noon:  { key: 'noon',  name: '午', sun: [0.30, 0.92, 0.26], sunCol: 0xfff3e2, sunI: 3.1,
           hemiSky: 0xc4daf0, hemiGnd: 0x8d8574, hemiI: 1.15, fogCol: 0xd9dfe6, fogD: 0.55,
           expo: 1.00, win: 0.0, lamp: 0.0, neon: 0.0, star: 0.0 },
  dusk:  { key: 'dusk',  name: '昏', sun: [-0.70, 0.34, 0.42], sunCol: 0xffb478, sunI: 3.3,
           hemiSky: 0x9db0cc, hemiGnd: 0x5a5044, hemiI: 2.4, fogCol: 0xa89080, fogD: 0.7,
           expo: 1.25, win: 0.45, lamp: 0.75, neon: 0.55, star: 0.0 },
  night: { key: 'night', name: '夜', sun: [0.34, 0.62, -0.70], sunCol: 0x93a9d6, sunI: 0.75,
           hemiSky: 0x27334a, hemiGnd: 0x0b0d13, hemiI: 0.65, fogCol: 0x0d1322, fogD: 1.35,
           expo: 1.18, win: 1.45, lamp: 1.55, neon: 1.50, star: 1.0 },
};

/* ---------------- 贴图生成（canvas 程序化，零外部素材） ---------------- */
function canvas2d(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f); else c.lerp(new THREE.Color(0x000000), -f);
  return '#' + c.getHexString();
}
/** 数字色值 / 字符串 → canvas CSS 色（数字直接赋 fillStyle 会被浏览器忽略！） */
function css(c) {
  if (typeof c === 'string') return c;
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}

/** 居民楼立面：base 色 + 窗格；返回 {map, emissiveMap} */
export function makeFacade(base) {
  const [c, g] = canvas2d(256, 256);
  const [ce, ge] = canvas2d(256, 256);
  g.fillStyle = shade(base, -0.05); g.fillRect(0, 0, 256, 256);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const cols = 6, rows = 7, mw = 34, mh = 28, gx = 7, gy = 7;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const x = gx + q * (mw + gx), y = 18 + r * (mh + gy);
    g.fillStyle = shade(base, -0.22); g.fillRect(x, y, mw, mh);
    g.fillStyle = shade(base, 0.06); g.fillRect(x + 2, y + 2, mw - 4, mh - 8);
    if (Math.random() < 0.34) {
      ge.fillStyle = Math.random() < 0.82 ? '#ffc276' : '#bcd8ff';
      ge.globalAlpha = 0.55 + Math.random() * 0.45;
      ge.fillRect(x, y, mw, mh);
      ge.globalAlpha = 1;
    }
  }
  return finishTex(c, ce);
}
/** 玻璃幕墙：竖向窗棂 + 稀疏亮 panel */
export function makeGlass(base) {
  const [c, g] = canvas2d(256, 256);
  const [ce, ge] = canvas2d(256, 256);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 22) { g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, 0, 3, 256); }
  for (let y = 0; y < 256; y += 40) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y, 256, 3); }
  for (let r = 0; r < 40; r++) {
    if (Math.random() < 0.30) {
      ge.fillStyle = Math.random() < 0.7 ? '#ffcf90' : '#a8c8ff';
      ge.globalAlpha = 0.35 + Math.random() * 0.5;
      ge.fillRect(Math.floor(Math.random() * 12) * 22, Math.floor(Math.random() * 6) * 40, 18, 34);
      ge.globalAlpha = 1;
    }
  }
  return finishTex(c, ce);
}
/** 灰砖（民国建筑 / 城墙砖） */
export function makeBrick(base) {
  const [c, g] = canvas2d(256, 256);
  const [ce, ge] = canvas2d(256, 256);
  g.fillStyle = shade(base, -0.1); g.fillRect(0, 0, 256, 256);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const bh = 13, bw = 32;
  for (let r = 0, y = 0; y < 256; y += bh, r++) {
    for (let x = (r % 2) * -bw / 2; x < 256; x += bw) {
      g.fillStyle = shade(base, (Math.random() - 0.5) * 0.14);
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  for (let r = 0; r < 7; r++) {
    const x = 30 + Math.floor(Math.random() * 5) * 40, y = 40 + Math.floor(Math.random() * 4) * 50;
    g.fillStyle = shade(base, -0.35); g.fillRect(x, y, 22, 26);
    if (Math.random() < 0.3) { ge.fillStyle = '#ffbe7c'; ge.globalAlpha = .8; ge.fillRect(x, y, 22, 26); ge.globalAlpha = 1; }
  }
  return finishTex(c, ce);
}
function finishTex(c, ce) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const e = new THREE.CanvasTexture(ce);
  e.wrapS = e.wrapT = THREE.RepeatWrapping;
  e.colorSpace = THREE.SRGBColorSpace;
  e.anisotropy = 8;
  return { map: t, emissiveMap: e };
}

/* ---------------- 着色器：天空 / 水面 ---------------- */
const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `
uniform vec3 uTop, uHorizon, uFogCol, uSunCol, uSunDir;
uniform float uSunI, uStar, uTime;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.38));
  col = mix(col, uFogCol, clamp(-h*4.0, 0.0, 1.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 900.0)*1.7*uSunI + pow(s, 9.0)*0.20*uSunI);
  if (uStar > 0.001 && h > 0.02) {
    vec3 sp = floor(d*240.0);
    float rnd = hash(sp);
    float star = step(0.9975, rnd) * uStar;
    col += vec3(star) * (0.55 + 0.45*hash(sp+1.7));
  }
  col += (hash(vec3(gl_FragCoord.xy, floor(uTime*2.0)))-0.5)*0.005;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const WATER_VERT = `
varying vec3 vWorld;
void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WATER_FRAG = `
uniform float uTime, uFogD, uSunI, uSkyMix;
uniform vec3 uSunDir, uSunCol, uTop, uHorizon, uDeep, uShallow, uFogCol;
varying vec3 vWorld;
void main(){
  vec2 p = vWorld.xz;
  float w = sin(p.x*0.16 + uTime*1.15)*0.5 + sin(p.y*0.12 - uTime*0.9)*0.45 + sin((p.x+p.y)*0.07 + uTime*0.6)*0.6;
  vec3 N = normalize(vec3(-w*0.10, 1.0, w*0.085));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N,V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uTop, clamp(R.y*1.5, 0.0, 1.0));
  vec3 deep = mix(uDeep, uShallow, clamp(w*0.45+0.5, 0.0, 1.0));
  float glint = pow(max(dot(R, uSunDir), 0.0), 200.0) * uSunI * 2.4;
  vec3 col = mix(deep, sky, clamp(uSkyMix + fres * 0.75, 0.0, 0.95));
  col += uSunCol * glint;
  float dist = length(cameraPosition - vWorld);
  col = mix(col, uFogCol, clamp(1.0 - exp(-dist*uFogD), 0.0, 1.0));
  gl_FragColor = vec4(col, 0.93);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ============================================================
 * Environment — 天空 / 光照 / 雾（全局唯一，随城市换色调）
 * ========================================================== */
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(4300, 32, 18),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide,
        depthWrite: false, depthTest: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x3d6ea8) }, uHorizon: { value: new THREE.Color(0xc9b184) },
          uFogCol: { value: new THREE.Color(0xc08a63) }, uSunCol: { value: new THREE.Color(0xff9a4e) },
          uSunDir: { value: new THREE.Vector3(-0.74, 0.24, 0.44).normalize() },
          uSunI: { value: 3.3 }, uStar: { value: 0 }, uTime: { value: 0 },
        },
      })
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    // PMREM 环境反射（玻璃幕墙的灵魂：反射天空）
    this.skyScene = new THREE.Scene();
    this.skyScene.add(this.sky.clone()); // 共享材质与 uniforms
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = null;

    this.sun = new THREE.DirectionalLight(0xff9a4e, 3.3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -700; sc.right = 700; sc.top = 700; sc.bottom = -700; sc.near = 200; sc.far = 2800;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 1.1;
    scene.add(this.sun); scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9d8fa6, 0x4d433a, 0.72);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xc08a63, 0.00042);
    this.waterMats = [];
    this.builders = [];
    this.time = 0;
  }
  register(builder) {
    this.builders = [builder];
    this.waterMats = [builder.waterMat];
    const p = builder.palette;
    this.sky.material.uniforms.uTop.value.set(p.skyTop);
    this.sky.material.uniforms.uHorizon.value.set(p.skyHorizon);
    this.paletteFog = new THREE.Color(p.fog);
    this.fogMix = p.fogMix ?? 0.3;
    this.sky.material.uniforms.uFogCol.value.copy(this.paletteFog);
  }
  applyTime(t, fogScale = 1) {
    const u = this.sky.material.uniforms;
    u.uSunDir.value.set(t.sun[0], t.sun[1], t.sun[2]).normalize();
    u.uSunCol.value.set(t.sunCol);
    u.uSunI.value = t.sunI;
    u.uStar.value = t.star;
    this.sun.position.copy(u.uSunDir.value).multiplyScalar(1500);
    this.sun.color.set(t.sunCol);
    this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGnd);
    this.hemi.intensity = t.hemiI;
    const fc = new THREE.Color(t.fogCol).lerp(this.paletteFog || new THREE.Color(t.fogCol), this.fogMix || 0);
    this.scene.fog.color.copy(fc);
    u.uFogCol.value.copy(fc);
    this.scene.fog.density = 0.00042 * t.fogD * fogScale;
    this.renderer.toneMappingExposure = t.expo;
    for (const b of this.builders) {
      for (const m of b.tagged.window) m.emissiveIntensity = t.win;
      for (const m of b.tagged.lamp) m.emissiveIntensity = t.lamp;
      for (const m of b.tagged.neon) m.emissiveIntensity = t.neon;
      for (const m of b.waterMats) {
        m.uniforms.uSunDir.value.copy(u.uSunDir.value);
        m.uniforms.uSunCol.value.set(t.sunCol);
        m.uniforms.uSunI.value = t.sunI;
        m.uniforms.uFogCol.value.copy(fc);
        m.uniforms.uFogD.value = this.scene.fog.density;
      }
    }
    // 重烘环境贴图（天空随时间/城市变化，玻璃幕墙反射天空）
    const rt = this.pmrem.fromScene(this.skyScene, 0.05, 100, 9000);
    if (this.envMap) this.envMap.dispose();
    this.envMap = rt.texture;
    this.scene.environment = this.envMap;
  }
  update(dt) {
    this.time += dt;
    this.sky.material.uniforms.uTime.value = this.time;
    for (const m of this.waterMats) m.uniforms.uTime.value = this.time;
  }
}

/* ============================================================
 * CityBuilder — 城市构建上下文（城市模块的 ctx）
 * ========================================================== */
export class CityBuilder {
  constructor({ seed, density, palette, groundSize = 1200, loader }) {
    this.THREE = THREE;
    this.rng = mulberry32(hashSeed(seed));
    this.density = density;
    this.palette = palette;
    this.GS = groundSize;
    this.GPX = 2048;
    this.root = new THREE.Group();
    this.batches = new Map();     // matKey -> { mat, geos, cast }
    this.inst = new Map();        // key -> { geo, mat, items }
    this.tagged = { window: [], lamp: [], neon: [] };
    this.tickers = [];
    this.hills = [];
    this.carList = [];            // {lane, s, speed, dir}
    this.carColors = {};
    this.boats = []; this.trains = [];
    this.stats = { buildings: 0, landmarks: 0, trees: 0, vehicles: 0, roads: 0 };
    this._loader = loader || (() => {});
    // 地面画布
    const [c, g] = canvas2d(this.GPX, this.GPX);
    this.gc = c; this.gx = g;
    g.fillStyle = css(palette.ground); g.fillRect(0, 0, this.GPX, this.GPX);
    for (let i = 0; i < 900; i++) {   // 地面噪点
      const x = Math.random() * this.GPX, y = Math.random() * this.GPX, r = 6 + Math.random() * 26;
      g.fillStyle = `rgba(${palette.blotch},${0.03 + Math.random() * 0.05})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // 水面材质（本城专属深浅色）
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true,
      uniforms: {
        uTime: { value: 0 }, uFogD: { value: 0.0004 }, uSunI: { value: 3 }, uSkyMix: { value: palette.waterMix ?? 0.42 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xff9a4e) },
        uTop: { value: new THREE.Color(palette.skyTop) }, uHorizon: { value: new THREE.Color(palette.skyHorizon) },
        uDeep: { value: new THREE.Color(palette.waterDeep) }, uShallow: { value: new THREE.Color(palette.waterShallow) },
        uFogCol: { value: new THREE.Color(palette.fog) },
      },
    });
    this.waterMats = [this.waterMat];
  }

  /* ---- 加载进度（async 构建用） ---- */
  async step(label) { this._loader(label); await new Promise(r => setTimeout(r, 16)); }

  /* ---- 世界 → 画布坐标 ---- */
  w2c(x, z) {
    const s = this.GPX / this.GS;
    return [(x + this.GS / 2) * s, this.GPX - (z + this.GS / 2) * s];
  }

  /* ---- 材质缓存 ---- */
  mat(key, p, tags = []) {
    this._mats = this._mats || {};
    const sig = JSON.stringify(p);
    if (this._mats[key] && this._mats[key]._sig === sig) return this._mats[key];
    const m = new THREE.MeshStandardMaterial(p);
    m._sig = sig; m._key = key;
    for (const t of tags) if (this.tagged[t]) this.tagged[t].push(m);
    this._mats[key] = m;
    return m;
  }
  _push(key, geo, mat, cast = true) {
    let b = this.batches.get(key);
    if (!b) { b = { mat, geos: [], cast }; this.batches.set(key, b); }
    b.geos.push(geo.index ? geo.toNonIndexed() : geo);
  }

  /* ---- 基础几何 ---- */
  box(w, h, d, x, y, z, { mat, ry = 0, rz = 0, uv = 3.2, cast = true } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) {
      const f = Math.floor(i / 4);
      let su, sv;
      if (f < 2) { su = d / uv; sv = h / uv; }
      else if (f < 4) { su = w / uv; sv = d / uv; }
      else { su = w / uv; sv = h / uv; }
      uvA.setXY(i, uvA.getX(i) * su, uvA.getY(i) * sv);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz));
    m.compose(new THREE.Vector3(x, y + h / 2, z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    this._push(mat._key, g, mat, cast);
    return g;
  }
  cyl(rt, rb, h, x, y, z, { mat, ry = 0, rz = 0, seg = 12, uv = 3.2, cast = true } = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * (Math.PI * 2 * Math.max(rt, rb) / uv), uvA.getY(i) * h / uv);
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    this._push(mat._key, g, mat, cast);
    return g;
  }
  /** 折线梁（墙 / 桥面 / 高架） */
  beam(pts, w, h, mat, y0 = 0, cast = true) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ry = Math.atan2(x2 - x1, z2 - z1);
      this.box(w, h, len, (x1 + x2) / 2, y0, (z1 + z2) / 2, { mat, ry, cast });
    }
  }
  /** 雉堞（城齿） */
  merlons(x1, z1, x2, z2, y, h, mat, step = 2.2) {
    const len = Math.hypot(x2 - x1, z2 - z1), ry = Math.atan2(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.floor(len / step));
    for (let i = 0; i < n; i += 2) {
      const t = (i + 0.5) / n;
      const x = lerp(x1, x2, t), z = lerp(z1, z2, t);
      this.box(0.9, h, 1.1, x, y, z, { mat, ry, cast: false });
    }
  }

  /* ---- 立面材质族 ---------------- */
  facade(i = 0) {
    this._facades = this._facades || [];
    const list = this.palette.facades;
    if (!this._facades[i]) {
      const { map, emissiveMap } = makeFacade(list[i % list.length]);
      this._facades[i] = this.mat('facade' + i, {
        map, emissiveMap, emissive: 0xffb45e, emissiveIntensity: 0, roughness: 0.82, metalness: 0.04,
      }, ['window']);
    }
    return this._facades[i];
  }
  glass(i = 0) {
    this._glass = this._glass || [];
    if (!this._glass[i]) {
      const { map, emissiveMap } = makeGlass(this.palette.glassBase);
      this._glass[i] = this.mat('glass' + i, {
        map, emissiveMap, emissive: 0xffc88a, emissiveIntensity: 0,
        roughness: 0.16, metalness: 0.55, color: 0xdfe8ee,
      }, ['window']);
    }
    return this._glass[i];
  }
  brick(i = 0) {
    this._bricks = this._bricks || [];
    if (!this._bricks[i]) {
      const { map, emissiveMap } = makeBrick(this.palette.brickBase);
      this._bricks[i] = this.mat('brick' + i, {
        map, emissiveMap, emissive: 0xffb45e, emissiveIntensity: 0, roughness: 0.9, metalness: 0.02,
      }, ['window']);
    }
    return this._bricks[i];
  }

  /* ---- 楼宇 ---------------- */
  /**
   * building(x, z, { w, d, h, mat?, style?, roof?, setbacks?, shop?, hut? })
   * roof: 'flat' | 'gable' | 'hip' | {type:'hip'|'gable', mat}
   */
  building(x, z, o) {
    const r = this.rng;
    const w = o.w, d = o.d, h = o.h, yb = o.y || 0;
    let mat = o.mat || (h > 95 ? this.glass(Math.floor(r() * 3)) : (o.style === 'republican' ? this.brick(Math.floor(r() * 3)) : this.facade(Math.floor(r() * 5))));
    const baseMat = o.baseMat || this.mat('base', { color: this.palette.baseColor, roughness: 0.9 });
    // 主体（可分段退台）
    const setbacks = o.setbacks || (h > 130 && r() < 0.55 ? [{ at: 0.62, k: 0.78 }, { at: 0.84, k: 0.62 }] : []);
    let cw = w, cd = d;
    const segs = [{ y0: 0, y1: h * (setbacks[0] ? setbacks[0].at : 1), w, d }];
    for (let i = 0; i < setbacks.length; i++) {
      const k = setbacks[i].k;
      segs.push({ y0: segs[i].y1, y1: h * (setbacks[i + 1] ? setbacks[i + 1].at : 1), w: cw * k, d: cd * k });
      cw *= k; cd *= k;
    }
    for (const s of segs) this.box(s.w, s.y1 - s.y0, s.d, x, yb + s.y0, z, { mat });
    if (o.shop) {  // 底商
      this.box(w + 0.5, 4.2, d + 0.5, x, yb, z, { mat: this.mat('shop' + (o.shopTone || 0), { color: o.shopTone === 1 ? 0x2a2d33 : 0x37302a, roughness: 0.35, metalness: 0.3 }, o.shopTone === 2 ? ['neon'] : []) });
    }
    // 屋顶
    const roof = o.roof === undefined ? 'flat' : o.roof;
    if (roof === 'flat') {
      this.box(cw + 0.6, 0.7, cd + 0.6, x, yb + h, z, { mat: baseMat, cast: false });
      if (o.hut !== false && r() < 0.6) {
        const hw = 3 + r() * 3, hd = 3 + r() * 3, hh = 2.5 + r() * 2.5;
        this.box(hw, hh, hd, x + (r() - 0.5) * (cw - hw) * 0.5, yb + h + 0.7, z + (r() - 0.5) * (cd - hd) * 0.5, { mat: baseMat });
      }
      if (h > 130) this.cyl(0.35, 0.6, h * 0.06, x, yb + h + 0.7, z, { mat: this.mat('steel', { color: 0x9aa2ab, roughness: 0.5, metalness: 0.7 }), seg: 6 });
    } else if (roof === 'gable') {
      const rm = roof.mat || this.mat('tileBlack', { color: this.palette.tileBlack || 0x2c2f36, roughness: 0.8 });
      gableRoof(this, x, yb + h, z, w, d, 3.2 + h * 0.012, rm);
    } else if (roof && roof.type === 'hip') {
      hipRoof(this, x, yb + h, z, w, d, { mat: roof.mat || this.mat('roofGold', { color: this.palette.roofGold || 0xc9a227, roughness: 0.45, metalness: 0.25 }), eave: 0.5 });
    } else if (roof && roof.type === 'gold') {
      hipRoof(this, x, yb + h, z, w, d, { mat: roof.mat || this.mat('roofGold2', { color: 0xd8b23a, roughness: 0.4, metalness: 0.3 }), eave: 0.7, tiers: 1 });
    } else if (roof && roof.type === 'green') {
      hipRoof(this, x, yb + h, z, w, d, { mat: roof.mat || this.mat('roofGreen', { color: 0x2e6b4f, roughness: 0.5, metalness: 0.2 }), eave: 0.7 });
    }
    this.stats.buildings++;
    return h;
  }

  /* ---- 地面绘制 ---------------- */
  paintRect(x, z, w, d, color) {
    const [px, py] = this.w2c(x - w / 2, z - d / 2);
    this.gx.fillStyle = css(color);
    this.gx.fillRect(px, py, w * this.GPX / this.GS, d * this.GPX / this.GS);
  }
  paintPoly(pts, color) {
    this.gx.fillStyle = css(color); this.gx.beginPath();
    pts.forEach(([x, z], i) => { const [px, py] = this.w2c(x, z); i ? this.gx.lineTo(px, py) : this.gx.moveTo(px, py); });
    this.gx.closePath(); this.gx.fill();
  }
  /** 道路（绘制 + 路缘石） */
  road(x1, z1, x2, z2, w, { curb = true, dash = true, color } = {}) {
    const s = this.GPX / this.GS;
    const [ax, ay] = this.w2c(x1, z1), [bx, by] = this.w2c(x2, z2);
    const ang = Math.atan2(by - ay, bx - ax), nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    this.gx.lineCap = 'butt';
    this.gx.strokeStyle = css(color || this.palette.road); this.gx.lineWidth = w * s;
    this.gx.beginPath(); this.gx.moveTo(ax, ay); this.gx.lineTo(bx, by); this.gx.stroke();
    if (dash) {
      this.gx.strokeStyle = this.palette.roadDash || 'rgba(235,225,195,.5)'; this.gx.lineWidth = 0.45 * s;
      this.gx.setLineDash([5 * s, 5 * s]);
      this.gx.beginPath(); this.gx.moveTo(ax, ay); this.gx.lineTo(bx, by); this.gx.stroke();
      this.gx.setLineDash([]);
    }
    if (curb) { // 人行道缘石
      const cm = this.mat('curb', { color: this.palette.curb || 0x8d8a82, roughness: 0.95 });
      const len = Math.hypot(x2 - x1, z2 - z1), ry = Math.atan2(x2 - x1, z2 - z1);
      for (const sgn of [-1, 1]) {
        const ox = nx / s * sgn * (w / 2 + 0.25), oy = ny / s * sgn * (w / 2 + 0.25);
        this.box(0.4, 0.24, len, (x1 + x2) / 2 + ox, 0, (z1 + z2) / 2 + oy, { mat: cm, ry, cast: false });
      }
    }
    this.stats.roads++;
  }
  /** 林荫大道：路 + 缘石 + 路灯 + 树 + 可选灯笼 */
  avenue(x1, z1, x2, z2, { w = 14, tree = 'plane', lamp = true, lantern = false, dash = true } = {}) {
    this.road(x1, z1, x2, z2, w, { dash });
    const len = Math.hypot(x2 - x1, z2 - z1), ry = Math.atan2(x2 - x1, z2 - z1);
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const px = -dz, pz = dx; // 垂直方向
    const nT = Math.floor(len / 19), nL = Math.floor(len / 30);
    for (let i = 0; i < nT; i++) {
      const t = (i + 0.5) / nT, jx = (this.rng() - 0.5) * 4;
      for (const sgn of [-1, 1]) {
        const x = x1 + dx * len * t + px * sgn * (w / 2 + 2.6) + jx;
        const z = z1 + dz * len * t + pz * sgn * (w / 2 + 2.6);
        this.tree(x, z, { type: tree, scale: 0.85 + this.rng() * 0.4 });
      }
    }
    if (lamp) for (let i = 0; i < nL; i++) {
      const t = (i + 0.5) / nL;
      const x = x1 + dx * len * t + px * (w / 2 + 1.2), z = z1 + dz * len * t + pz * (w / 2 + 1.2);
      this.lamp(x, z, ry);
      if (lantern) this.lantern(x + px * 1.1, 4.6, z + pz * 1.1);
    }
  }
  plaza(x, z, w, d, color) { this.paintRect(x, z, w, d, color || this.palette.plaza || 0x3a3d44); }

  /* ---- 植被（实例化） ---------------- */
  tree(x, z, { type = 'plane', scale = 1, y = null } = {}) {
    this._treeData = this._treeData || {};
    const td = this._treeData[type] = this._treeData[type] || { trunk: [], canopy: [] };
    const r = this.rng;
    const yy = y === null ? this.groundY(x, z) : y;
    td.trunk.push({ x, z, y: yy, s: scale, ry: r() * 6.28 });
    td.canopy.push({ x, z, y: yy, s: scale, ry: r() * 6.28, c: r() });
    this.stats.trees++;
  }
  lamp(x, z, ry = 0) {
    this._lampData = this._lampData || { pole: [], head: [] };
    this._lampData.pole.push({ x, z, ry });
    this._lampData.head.push({ x, z, ry });
  }
  lantern(x, y, z, s = 1) {
    this._lanternData = this._lanternData || [];
    this._lanternData.push({ x, y, z, s });
  }

  /* ---- 山丘 / 远山 ---------------- */
  /** 平顶台地山（top=台顶半径占比），高度语义：h = 山顶实际标高 */
  hill(x, z, r, h, mat, { top = 0.32 } = {}) {
    const T = THREE;
    const rt = r * top;
    const rings = 16, sectors = 30;
    const pos = [0, h, 0], uvs = [0.5, 0.5], idx = [];
    const yAt = (d, vx, vz) => {
      let y = d <= rt ? h : h * Math.pow(1 - (d - rt) / (r - rt), 0.8);
      if (d > rt * 0.92) y *= 1 + 0.10 * Math.sin(vx * 0.11 + 1.7) * Math.cos(vz * 0.09);
      return y;
    };
    for (let i = 1; i <= rings; i++) {
      const d = (i / rings) * r;
      for (let j = 0; j <= sectors; j++) {
        const a = (j / sectors) * Math.PI * 2;
        const vx = Math.cos(a) * d, vz = Math.sin(a) * d;
        pos.push(vx, yAt(d, vx, vz), vz);
        uvs.push(0.5 + Math.cos(a) * 0.5 * (d / r), 0.5 + Math.sin(a) * 0.5 * (d / r));
      }
    }
    for (let j = 0; j < sectors; j++) idx.push(0, 2 + j, 1 + j);
    for (let i = 1; i < rings; i++) {
      const base = 1 + (i - 1) * (sectors + 1);
      for (let j = 0; j < sectors; j++) {
        const a = base + j, b = base + j + 1, c = base + (sectors + 1) + j, d2 = base + (sectors + 1) + j + 1;
        idx.push(a, c, b, b, c, d2);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { // 中心法线应朝上，否则翻转绕序
      const arr = g.index.array;
      for (let i = 0; i < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; }
      g.computeVertexNormals();
    }
    g.translate(x, 0, z);
    this._push(mat._key, g, mat);
    this.hills.push({ x, z, r, h, top });
  }
  /** 地形标高查询（山丘叠加取最高） */
  groundY(x, z) {
    let y = 0;
    for (const h of this.hills) {
      const px = x - h.x, py = h.z - z; // hill 内部 polar-y 与世界 z 反向
      const d = Math.hypot(px, py);
      if (d >= h.r) continue;
      const rt = h.r * h.top;
      const hh = d <= rt ? h.h : h.h * Math.pow(1 - (d - rt) / (h.r - rt), 0.8);
      if (hh > y) y = hh;
    }
    return y;
  }
  /** 远山脊线：沿 z 排布的三角幕帘 */
  ridge(z, x0, x1, hMin, hMax, mat, step = 130) {
    const r = this.rng;
    for (let x = x0; x < x1; x += step) {
      const w = step * (1.1 + r() * 0.5), h = hMin + r() * (hMax - hMin);
      const cx = x + w / 2, cz = z + (r() - 0.5) * 40;
      this.box(w, h, 60, cx, 0, cz, { mat, ry: (r() - 0.5) * 0.2, cast: false });
    }
  }

  /* ---- 水面 ---------------- */
  water(x, z, w, d) {
    const g = new THREE.PlaneGeometry(w, d, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.waterMat);
    m.position.set(x, 0.14, z);
    m.renderOrder = 1;
    this.root.add(m);
  }

  /* ---- 载具 ---------------- */
  carLane({ x1, z1, x2, z2, n = 8, speed = 11, colors = null }) {
    const lane = { x1, z1, x2, z2, len: Math.hypot(x2 - x1, z2 - z1), speed };
    const palette = colors || [0xd8d8d8, 0x2b2d33, 0xb8bec4, 0xa8332c, 0x2c4a7a, 0xd6b04a];
    for (let i = 0; i < n; i++) {
      const c = palette[Math.floor(this.rng() * palette.length)];
      const inst = { lane, s: this.rng(), speed: speed * (0.85 + this.rng() * 0.3) };
      this.carList.push(inst);
      (this.carColors[c] = this.carColors[c] || []).push(inst);
    }
    this.stats.vehicles += n;
  }
  boat(pts, { kind = 'huafang', speed = 4 } = {}) {
    const g = new THREE.Group();
    const hullMat = this.mat('hull', { color: kind === 'wupeng' ? 0x4a3a28 : 0x33291f, roughness: 0.85 });
    const cabinMat = this.mat('cabin', { color: kind === 'youchuan' ? 0xe8e2d4 : 0x8a5a30, roughness: 0.7 });
    const lampMat = this.mat('lanternRed', { color: 0xd83a2a, emissive: 0xff5a30, emissiveIntensity: 0, roughness: 0.6 }, ['lamp']);
    if (kind === 'wupeng') {
      g.add(mesh(new THREE.BoxGeometry(2.2, 0.7, 8), hullMat, 0, 0.35, 0));
      g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.4, 8, 1, false, 0, Math.PI), cabinMat, 0, 0.7, 0).rotateZ(Math.PI / 2));
    } else {
      g.add(mesh(new THREE.BoxGeometry(3.2, 1.0, 13), hullMat, 0, 0.5, 0));
      g.add(mesh(new THREE.BoxGeometry(2.6, 1.6, 7), cabinMat, 0, 1.8, 0.5));
      g.add(mesh(new THREE.BoxGeometry(3.0, 0.18, 9), this.mat('rail', { color: 0x6b5335, roughness: 0.8 }), 0, 2.7, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const l = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.8, 8), lampMat, sx * 1.5, 2.4, sz * 3.4);
        g.add(l);
      }
    }
    this.root.add(g);
    const b = { g, pts, speed, s: Math.random(), kind };
    this.boats.push(b);
    this.stats.vehicles++;
    return b;
  }
  /** 轻轨列车（沿折线往复） */
  train(pts, { speed = 21, cars = 3 } = {}) {
    const g = new THREE.Group();
    const body = this.mat('trainBody', { color: 0xd8dde2, roughness: 0.35, metalness: 0.4 });
    const stripe = this.mat('trainStripe', { color: 0xc0392b, roughness: 0.5 });
    const glassM = this.mat('trainGlass', { color: 0x1a2530, roughness: 0.15, metalness: 0.6 });
    for (let i = 0; i < cars; i++) {
      const c = new THREE.Group();
      c.add(mesh(new THREE.BoxGeometry(2.6, 2.9, 9), body, 0, 1.9, 0));
      c.add(mesh(new THREE.BoxGeometry(2.7, 0.5, 9.2), stripe, 0, 1.1, 0));
      c.add(mesh(new THREE.BoxGeometry(2.62, 1.1, 7.6), glassM, 0, 2.6, 0));
      c.position.z = i * 10;
      g.add(c);
    }
    this.root.add(g);
    const t = { g, pts, speed, s: 0, cars };
    this.trains.push(t);
    this.stats.vehicles++;
    return t;
  }

  onTick(fn) { this.tickers.push(fn); }

  /* ---- 地标登记 ---------------- */
  mark(name) { this.stats.landmarks++; this._marks = this._marks || []; this._marks.push(name); }

  /* ---- 收尾：合并几何 + 实例化 ---------------- */
  finalize() {
    for (const [key, b] of this.batches) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat);
      m.castShadow = b.cast; m.receiveShadow = true;
      this.root.add(m);
    }
    // 树
    const T = THREE;
    const treeGeos = {
      plane: { trunk: [new T.CylinderGeometry(0.28, 0.42, 5.2, 6), ], canopy: canopyGeo([[0, 5.6, 0, 3.6], [1.9, 4.9, 1.0, 2.5], [-1.7, 5.0, -1.1, 2.3], [0.4, 6.6, -0.6, 2.0]], 0.72) },
      willow: { trunk: [new T.CylinderGeometry(0.3, 0.45, 4.4, 6)], canopy: canopyGeo([[0, 4.4, 0, 3.0], [1.8, 3.6, 0.9, 2.2], [-1.8, 3.7, -0.9, 2.1]], 1.5, -0.4) },
      pine: { trunk: [new T.CylinderGeometry(0.22, 0.34, 2.4, 6)], canopy: coneStack([2.6, 2.1, 1.6], 3.2, 8.5) },
      broad: { trunk: [new T.CylinderGeometry(0.3, 0.45, 4.2, 6)], canopy: canopyGeo([[0, 4.8, 0, 3.0], [1.4, 4.2, 0.8, 2.0], [-1.3, 4.3, -0.9, 1.9]], 0.9) },
      pineTall: { trunk: [new T.CylinderGeometry(0.26, 0.4, 3.2, 6)], canopy: coneStack([3.0, 2.4, 1.8], 4.0, 11) },
    };
    const trunkMat = this.mat('trunk', { color: 0x5a4634, roughness: 0.95 });
    const data = this._treeData || {};
    const mtx = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), pos = new T.Vector3(), col = new T.Color();
    for (const type in data) {
      const geos = treeGeos[type] || treeGeos.broad;
      const n = data[type].trunk.length;
      if (!n) continue;
      const tm = new T.InstancedMesh(mergeGeometries(geos.trunk.map(g => g.toNonIndexed()), false), trunkMat, n);
      const cm = new T.InstancedMesh(geos.canopy, this.mat('canopy' + type, {
        color: this.palette.treeColors[type] || 0x3d5a34, roughness: 0.9,
      }), n);
      const base = new T.Color(this.palette.treeColors[type] || 0x3d5a34);
      for (let i = 0; i < n; i++) {
        const t = data[type].trunk[i], c = data[type].canopy[i];
        q.setFromEuler(new T.Euler(0, t.ry, 0));
        pos.set(t.x, t.y, t.z); sc.set(t.s, t.s, t.s);
        tm.setMatrixAt(i, mtx.compose(pos, q, sc));
        q.setFromEuler(new T.Euler(0, c.ry, 0));
        cm.setMatrixAt(i, mtx.compose(pos.set(c.x, c.y, c.z), q, sc));
        col.copy(base).offsetHSL(0, 0, (c.c - 0.5) * 0.09);
        cm.setColorAt(i, col);
      }
      tm.instanceMatrix.needsUpdate = true; cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
      tm.castShadow = true; cm.castShadow = true;
      tm.frustumCulled = false; cm.frustumCulled = false;
      this.root.add(tm); this.root.add(cm);
    }
    // 路灯
    const ld = this._lampData;
    if (ld && ld.pole.length) {
      const poleGeo = mergeGeometries([
        new T.CylinderGeometry(0.09, 0.13, 7.4, 6).translate(0, 3.7, 0),
        new T.BoxGeometry(0.14, 0.14, 1.6).translate(0, 7.3, 0.7),
      ].map(g => g.toNonIndexed()), false);
      const headGeo = new T.BoxGeometry(0.5, 0.22, 1.2).translate(0, 7.1, 1.4);
      const n = ld.pole.length;
      const pm = new T.InstancedMesh(poleGeo, this.mat('pole', { color: 0x3c4048, roughness: 0.6, metalness: 0.5 }), n);
      const hm = new T.InstancedMesh(headGeo, this.mat('lampHead', { color: 0xfff2d8, emissive: 0xffc878, emissiveIntensity: 0, roughness: 0.4 }, ['lamp']), n);
      for (let i = 0; i < n; i++) {
        const p = ld.pole[i];
        q.setFromEuler(new T.Euler(0, p.ry, 0));
        pm.setMatrixAt(i, mtx.compose(pos.set(p.x, 0, p.z), q, sc.set(1, 1, 1)));
        hm.setMatrixAt(i, mtx.compose(pos.set(p.x, 0, p.z), q, sc.set(1, 1, 1)));
      }
      pm.instanceMatrix.needsUpdate = true; hm.instanceMatrix.needsUpdate = true;
      pm.castShadow = true; hm.castShadow = true; pm.frustumCulled = false; hm.frustumCulled = false;
      this.root.add(pm); this.root.add(hm);
    }
    // 灯笼
    const ln = this._lanternData;
    if (ln && ln.length) {
      const lg = new T.CylinderGeometry(0.5, 0.55, 0.85, 8);
      const lm = new T.InstancedMesh(lg, this.mat('lanternRed2', { color: 0xd83a2a, emissive: 0xff4a22, emissiveIntensity: 0, roughness: 0.55 }, ['lamp']), ln.length);
      for (let i = 0; i < ln.length; i++) {
        const l = ln[i];
        lm.setMatrixAt(i, mtx.compose(pos.set(l.x, l.y, l.z), q.identity(), sc.set(l.s, l.s, l.s)));
      }
      lm.instanceMatrix.needsUpdate = true; lm.frustumCulled = false;
      this.root.add(lm);
    }
    // 车辆
    if (this.carList.length) {
      const carGeo = mergeGeometries([
        new T.BoxGeometry(2.0, 0.72, 4.5).translate(0, 0.75, 0),
        new T.BoxGeometry(1.8, 0.62, 2.2).translate(0, 1.32, -0.2),
        new T.BoxGeometry(1.9, 0.3, 4.3).translate(0, 0.3, 0),
      ].map(g => g.toNonIndexed()), false);
      this.carMeshes = {};
      for (const c in this.carColors) {
        const n = this.carColors[c].length;
        const im = new T.InstancedMesh(carGeo, this.mat('car' + c, { color: +c, roughness: 0.35, metalness: 0.5 }), n);
        im.castShadow = true; im.frustumCulled = false;
        im.count = n;
        this.carColors[c].forEach((inst, i) => { inst.mesh = im; inst.idx = i; });
        this.carMeshes[c] = im;
        this.root.add(im);
      }
    }
    // 地面网格
    const gt = new T.CanvasTexture(this.gc);
    gt.colorSpace = T.SRGBColorSpace;
    gt.anisotropy = this.renderer ? 16 : 8;
    const gm = new T.Mesh(new T.PlaneGeometry(this.GS, this.GS), new T.MeshStandardMaterial({ map: gt, roughness: 0.94, metalness: 0.02 }));
    gm.rotation.x = -Math.PI / 2;
    gm.receiveShadow = true;
    this.root.add(gm);
    return this;
  }

  /* ---- 每帧更新 ---------------- */
  update(dt, t) {
    const T = THREE;
    const mtx = new T.Matrix4(), q = new T.Quaternion(), pos = new T.Vector3(), sc = new T.Vector3(1, 1, 1);
    for (const c of this.carList) {
      c.s += c.speed * dt / c.lane.len;
      if (c.s > 1) c.s -= 1;
      const { x1, z1, x2, z2 } = c.lane;
      const x = x1 + (x2 - x1) * c.s, z = z1 + (z2 - z1) * c.s;
      const ry = Math.atan2(x2 - x1, z2 - z1);
      q.setFromEuler(new T.Euler(0, ry, 0));
      c.mesh.setMatrixAt(c.idx, mtx.compose(pos.set(x, 0, z), q, sc));
      c.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.boats) {
      b.s += b.speed * dt / polyLen(b.pts);
      if (b.s > 1) b.s -= 1;
      const p = polyAt(b.pts, b.s);
      b.g.position.set(p.x, 0.14 + Math.sin(t * 1.4 + b.s * 9) * 0.12, p.z);
      b.g.rotation.y = p.ry;
      b.g.rotation.z = Math.sin(t * 1.1 + b.s * 7) * 0.03;
    }
    for (const tr of this.trains) {
      tr.s += tr.speed * dt / polyLen(tr.pts);
      if (tr.s > 1) tr.s -= 1;
      const p = polyAt(tr.pts, tr.s);
      tr.g.position.set(p.x, p.y || 0, p.z);
      tr.g.rotation.y = p.ry;
    }
    for (const fn of this.tickers) fn(dt, t);
  }
}

/* ---------------- 小工具 ---------------- */
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
function canopyGeo(blobs, sy, dy = 0) {
  const T = THREE;
  const parts = blobs.map(([x, y, z, r]) =>
    new T.IcosahedronGeometry(r, 1).translate(x, y + dy, z));
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false);
  g.scale(1, sy, 1);
  return g;
}
function coneStack(rs, totalH, baseY) {
  const T = THREE;
  const parts = [];
  let y = baseY;
  rs.forEach((r, i) => {
    const h = totalH / rs.length * (i === 0 ? 1.15 : 1);
    parts.push(new T.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0));
    y += h * 0.72;
  });
  return mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false);
}
function polyLen(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
  return L;
}
function polyAt(pts, s) {
  let L = polyLen(pts) * s, i = 0;
  while (i < pts.length - 2 && L > Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2])) {
    L -= Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]); i++;
  }
  const [x1, , z1] = pts[i], [x2, , z2] = pts[i + 1];
  const seg = Math.hypot(x2 - x1, z2 - z1) || 1;
  const t = Math.min(1, L / seg);
  return { x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, ry: Math.atan2(x2 - x1, z2 - z1) };
}
