// Everything liquid: the sea and the Mere (one surface at y = 0 with a planar reflection),
// the river (a ribbon that follows its bed) and the lava in the Scar.
import * as THREE from 'three';
import { shared, sharedUniforms } from './shared.js';
import './atmos.js';
import { LAYER_MAIN_ONLY } from './engine.js';
import { MERE, SCAR, WORLD } from '../world/heightmap.js';
import { lerp, smoothstep } from '../core/math.js';

/** Tiling ripple normals: rg = slope, b = height. Built from sinusoids with whole wave numbers. */
export function makeWaterNormalTexture(size = 256, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = [];
  for (let i = 0; i < 44; i++) {
    const a = rnd() * Math.PI * 2;
    const k = 2 + Math.floor(Math.pow(rnd(), 1.6) * 22);
    const kx = Math.round(Math.cos(a) * k),
      ky = Math.round(Math.sin(a) * k);
    const kk = Math.hypot(kx, ky) || 1;
    waves.push({ kx, ky, amp: 1 / Math.pow(kk, 1.35), ph: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  const H = new Float32Array(size * size),
    DX = new Float32Array(size * size),
    DY = new Float32Array(size * size);
  let hm = 0,
    dm = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2,
        v = (y / size) * Math.PI * 2;
      let h = 0,
        dx = 0,
        dy = 0;
      for (const w of waves) {
        const f = w.kx * u + w.ky * v + w.ph;
        // sharpen the crests a little
        const sn = Math.sin(f),
          cs = Math.cos(f);
        h += w.amp * (sn + 0.3 * Math.cos(2 * f));
        dx += w.amp * w.kx * (cs - 0.6 * Math.sin(2 * f));
        dy += w.amp * w.ky * (cs - 0.6 * Math.sin(2 * f));
      }
      const k = y * size + x;
      H[k] = h;
      DX[k] = dx;
      DY[k] = dy;
      hm = Math.max(hm, Math.abs(h));
      dm = Math.max(dm, Math.abs(dx), Math.abs(dy));
    }
  for (let k = 0; k < size * size; k++) {
    data[k * 4] = (DX[k] / dm) * 127 + 128;
    data[k * 4 + 1] = (DY[k] / dm) * 127 + 128;
    data[k * 4 + 2] = (H[k] / hm) * 127 + 128;
    data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const WAVES = /* glsl */ `
uniform float uSea;
// One Gerstner wave: adds displacement to d and slope to n.
void tpWave(vec2 p, vec2 dir, float L, float A, float t, inout vec3 d, inout vec2 n) {
  float k = 6.2831853 / L;
  float f = k * dot(dir, p) - sqrt(9.81 * k) * t;
  float s = sin(f), c = cos(f);
  d.y += A * s;
  d.xz += dir * (A * 0.75 * c);
  n += dir * (k * A * c);
}
// The swell at a point. amp scales it; returns displacement, writes the surface slope.
vec3 tpSea(vec2 p, float amp, out vec2 slope) {
  vec3 d = vec3(0.0);
  vec2 n = vec2(0.0);
  float t = uTime;
  tpWave(p, vec2(0.196, -0.981), 33.0, 0.2, t, d, n);
  tpWave(p, vec2(0.588, -0.809), 18.5, 0.11, t, d, n);
  tpWave(p, vec2(-0.342, -0.94), 10.3, 0.06, t, d, n);
  tpWave(p, vec2(0.84, -0.54), 5.7, 0.03, t, d, n);
  tpWave(p, vec2(-0.71, -0.704), 3.3, 0.017, t, d, n);
  slope = n * amp;
  return d * amp;
}
// How rough the water is here: calm in the shallows and on the Mere, fading out far from the eye.
float tpSeaAmp(vec2 p, float depth) {
  float a = uSea * smoothstep(0.1, 5.0, depth);
  float mere = smoothstep(${(MERE.r + 46).toFixed(1)}, ${(MERE.r + 14).toFixed(1)}, distance(p, vec2(${MERE.x.toFixed(1)}, ${MERE.z.toFixed(1)})));
  return a * (1.0 - 0.94 * mere);
}
`;

const SEA_VERT = /* glsl */ `
#include <common>
${WAVES}
uniform vec3 uOrigin;
varying vec3 vW;
varying vec2 vP0;
varying float vAmp;
void main() {
  vec3 p = position;
  #ifdef SEA_NEAR
    p.xz += uOrigin.xz;
  #else
    p.xz = p.xz * 3200.0 + uOrigin.xz;
  #endif
  vP0 = p.xz;
  float depth = -tpHeight(p.xz);
  float amp = 0.0;
  #ifdef SEA_NEAR
    float fade = 1.0 - smoothstep(72.0, 112.0, max(abs(position.x), abs(position.z)));
    amp = tpSeaAmp(p.xz, depth) * fade;
    vec2 sl;
    p += tpSea(p.xz, amp, sl);
  #endif
  vAmp = amp;
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const WATER_FRAG_COMMON = /* glsl */ `
uniform sampler2D uRipple;
uniform vec3 uDeep;
uniform vec3 uShallow;
// two layers of ripples sliding over each other
vec3 tpRipples(vec2 p, vec2 flow, float t, float scale) {
  vec3 a = texture2D(uRipple, p * 0.11 * scale + flow * t * 0.021).rgb;
  vec3 b = texture2D(uRipple, p * 0.047 * scale - flow.yx * t * 0.013 + 0.37).rgb;
  vec3 c = texture2D(uRipple, p * 0.31 * scale + vec2(flow.y, -flow.x) * t * 0.034 + 0.71).rgb;
  vec2 s = (a.rg - 0.5) * 1.0 + (b.rg - 0.5) * 1.3 + (c.rg - 0.5) * 0.55;
  return vec3(s, a.b * 0.5 + b.b * 0.35 + c.b * 0.15);
}
`;

const SEA_FRAG = /* glsl */ `
#include <common>
${WAVES}
${WATER_FRAG_COMMON}
uniform vec3 uOrigin;
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
varying vec3 vW;
varying vec2 vP0;
varying float vAmp;
void main() {
  #ifndef SEA_NEAR
    // the far sheet leaves a hole for the near grid
    vec2 q = abs(vP0 - uOrigin.xz);
    if (max(q.x, q.y) < 119.99) discard;
  #endif
  vec3 toEye = cameraPosition - vW;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  float ground = tpHeight(vW.xz);
  float depth = vW.y - ground;
  float mere = smoothstep(${(MERE.r + 46).toFixed(1)}, ${(MERE.r + 14).toFixed(1)}, distance(vW.xz, vec2(${MERE.x.toFixed(1)}, ${MERE.z.toFixed(1)})));

  // surface normal: the swell, then ripples that flatten with distance
  vec2 sl = vec2(0.0);
  #ifdef SEA_NEAR
    tpSea(vP0, vAmp, sl);
  #endif
  float calm = mix(1.0, 0.22, mere);
  vec3 rp = tpRipples(vW.xz, vec2(0.3, -1.0), uTime, 1.0);
  float rStr = (0.16 + 0.5 * uSea) * calm / (1.0 + dist * 0.012);
  vec2 slope = sl + rp.xy * rStr;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  if (cameraPosition.y < vW.y) N.y = -N.y;

  float nv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);

  // what the surface mirrors
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = tpSkyColor(R);
  if (uReflOn > 0.5) {
    vec3 rpnt = vec3(vW.x + slope.x * 5.5, 0.0, vW.z + slope.y * 5.5);
    vec4 rc = uReflMat * vec4(rpnt, 1.0);
    vec2 ruv = clamp(rc.xy / rc.w, vec2(0.002), vec2(0.998));
    refl = texture2D(uReflTex, ruv).rgb;
  }

  // the body of the water: murk lit from above
  float cs = tpCloudShadow(vW);
  vec3 lit = uAmbient * 1.25 + uSunColor * cs * max(uSunDir.y, 0.0) * 0.5;
  float crest = clamp(rp.z * 0.5 + 0.5 + sl.y * 0.0, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, exp(-depth * 0.55) * 0.75 + vAmp * crest * 0.25) * lit;
  body = mix(body, body * vec3(0.55, 0.62, 0.6), mere);

  vec3 col = mix(body, refl, fres);

  // the sun on the water
  vec3 Hh = normalize(V + uSunDir);
  float nh = max(dot(N, Hh), 0.0);
  float glint = pow(nh, 420.0) * 3.0 + pow(nh, 46.0) * 0.07;
  col += uSunColor * cs * glint * smoothstep(0.0, 0.08, uSunDir.y);

  // foam where the water meets the land, in bands that walk ashore
  float fn = texture2D(uNoiseTex, vW.xz * 0.11 + vec2(uTime * 0.012, 0.0)).r * 0.6 + texture2D(uNoiseTex, vW.xz * 0.37 - vec2(0.0, uTime * 0.02)).g * 0.4;
  // a wash at the very edge, and thin lines of lace that walk in over the last half metre
  float edge = smoothstep(0.14, 0.0, depth) * (0.45 + 0.55 * fn);
  float line = smoothstep(0.72, 0.98, 0.5 + 0.5 * sin(depth * 24.0 + uTime * 1.15 + fn * 7.0));
  float lace = line * smoothstep(0.6, 0.06, depth) * smoothstep(0.28, 0.62, fn);
  float foam = (edge + lace * 0.6) * (1.0 - mere * 0.85) * smoothstep(-0.02, 0.03, depth);
  foam += smoothstep(0.7, 1.0, crest) * smoothstep(0.55, 1.2, vAmp) * 0.25;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, lit * vec3(0.66, 0.7, 0.72), foam * 0.75);

  // clear in the shallows, opaque in the deep, and never a hard edge on the sand
  float alpha = 1.0 - exp(-max(depth, 0.0) * 1.7);
  alpha = max(alpha, fres * 0.9);
  alpha = max(alpha, foam * 0.85);
  alpha = max(alpha, smoothstep(12.0, 55.0, dist));
  alpha *= smoothstep(0.0, 0.07, depth);

  col = tpFog(col, vW);
  gl_FragColor = vec4(col, alpha);
}
`;

const RIVER_VERT = /* glsl */ `
#include <common>
attribute vec3 aFlow; // across -1..1, along (m), fade
attribute vec3 aDir;  // downstream tangent xz, slope
varying vec3 vW;
varying vec3 vFlow;
varying vec3 vDir;
void main() {
  vW = position;
  vFlow = aFlow;
  vDir = aDir;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const RIVER_FRAG = /* glsl */ `
#include <common>
${WATER_FRAG_COMMON}
varying vec3 vW;
varying vec3 vFlow;
varying vec3 vDir;
void main() {
  vec3 toEye = cameraPosition - vW;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  float depth = vW.y - tpHeight(vW.xz);
  vec2 T = normalize(vDir.xy);
  vec2 B = vec2(-T.y, T.x);
  float speed = 1.3 + vDir.z * 26.0;
  // ripples carried downstream, faster mid-stream
  float mid = 1.0 - vFlow.x * vFlow.x;
  vec2 fuv = vec2(dot(vW.xz, B), dot(vW.xz, T));
  vec3 a = texture2D(uRipple, fuv * vec2(0.23, 0.11) - vec2(0.0, uTime * speed * (0.07 + 0.05 * mid))).rgb;
  vec3 b = texture2D(uRipple, fuv * vec2(0.5, 0.21) + 0.4 - vec2(0.0, uTime * speed * 0.16)).rgb;
  vec2 s2 = (a.rg - 0.5) * 1.1 + (b.rg - 0.5) * 0.8;
  vec2 slope = (B * s2.x + T * s2.y) * (0.42 + vDir.z * 3.0) / (1.0 + dist * 0.02);
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float nv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = tpSkyColor(R);
  float cs = tpCloudShadow(vW);
  vec3 lit = uAmbient * 1.25 + uSunColor * cs * max(uSunDir.y, 0.0) * 0.5;
  vec3 body = mix(uDeep, uShallow, exp(-depth * 1.1)) * lit;
  vec3 col = mix(body, refl, fres);
  vec3 Hh = normalize(V + uSunDir);
  col += uSunColor * cs * pow(max(dot(N, Hh), 0.0), 300.0) * 2.0 * smoothstep(0.0, 0.08, uSunDir.y);
  // white water on the steep runs and along the banks
  float fn = a.b * 0.6 + b.b * 0.4;
  float foam = smoothstep(0.55, 0.9, fn + min(vDir.z * 7.0, 0.3) - 0.2) * smoothstep(0.012, 0.05, vDir.z) * 0.7;
  foam = max(foam, smoothstep(0.3, 0.0, depth) * smoothstep(0.35, 0.7, fn) * 0.7);
  col = mix(col, lit * vec3(0.8, 0.84, 0.86), clamp(foam, 0.0, 1.0) * 0.8);
  float alpha = max(1.0 - exp(-max(depth, 0.0) * 2.6), fres * 0.9);
  alpha = max(alpha, foam * 0.8) * smoothstep(0.0, 0.06, depth) * vFlow.z;
  col = tpFog(col, vW);
  gl_FragColor = vec4(col, alpha);
}
`;

const LAVA_VERT = /* glsl */ `
#include <common>
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const LAVA_FRAG = /* glsl */ `
#include <common>
uniform vec2 uCentre;
uniform float uHeat;
varying vec3 vW;
float fbm(vec2 p) {
  return texture2D(uNoiseTex, p).r * 0.55 + texture2D(uNoiseTex, p * 2.3 + 0.3).g * 0.3 + texture2D(uNoiseTex, p * 5.1 + 0.6).b * 0.15;
}
void main() {
  vec2 p = vW.xz - uCentre;
  float r = length(p);
  // a slow churn: the crust drifts outward and round
  float ang = uTime * 0.012;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = rot * p * 0.045;
  vec2 warp = vec2(fbm(q * 0.7 + uTime * 0.004), fbm(q * 0.7 + 3.1 - uTime * 0.003)) - 0.5;
  float n = fbm(q + warp * 0.55);
  float n2 = fbm(q * 2.6 - warp * 0.4 + uTime * 0.006);
  // black plates of crust, thin seams of fire between them, a few open pools
  // (widened by the pixel footprint, and dimmed to match, so far seams do not sparkle)
  float aw = fwidth(n) * 1.2, aw2 = fwidth(n2) * 1.2;
  float seam = (1.0 - smoothstep(0.0, 0.02 + aw, abs(n - 0.5))) * (0.02 / (0.02 + aw));
  seam = max(seam, (1.0 - smoothstep(0.0, 0.011 + aw2, abs(n2 - 0.5))) * 0.55 * (0.011 / (0.011 + aw2)));
  // a soft bed of heat under the seams, so they do not read as drawn lines
  float bed = (1.0 - smoothstep(0.0, 0.05, abs(n - 0.5))) * 0.24;
  float pulse = 0.82 + 0.18 * sin(uTime * 0.7 + n * 12.0);
  float pool = smoothstep(0.66, 0.84, n) * (0.55 + 0.45 * n2);
  float heat = clamp(max(seam, bed) * pulse + pool * 0.8, 0.0, 1.0);
  heat = max(heat, smoothstep(27.5, 31.0, r) * 0.4 * (0.5 + 0.5 * n2));
  heat *= uHeat;
  // black-body ramp: dull red, orange, and yellow only in the hottest cores
  // (kept far from white: the tone curve bleaches anything that is bright in all three channels)
  vec3 glow = vec3(1.1, 0.045, 0.0) * smoothstep(0.0, 0.5, heat);
  glow += vec3(1.5, 0.16, 0.0) * smoothstep(0.35, 0.85, heat);
  glow += vec3(1.1, 0.42, 0.04) * smoothstep(0.84, 1.0, heat);
  float plate = smoothstep(0.0, 0.12, abs(n - 0.5));
  vec3 crust = vec3(0.02, 0.014, 0.012) * (0.45 + 1.1 * n2) * (0.6 + 0.4 * plate);
  vec3 col = crust * (uAmbient + uSunColor * 0.3) + glow + vec3(0.22, 0.016, 0.0) * (1.0 - heat) * 0.12 * uHeat;
  col = tpFog(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _n = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _t = new THREE.Vector3(),
  _look = new THREE.Vector3(),
  _rot = new THREE.Matrix4(),
  _q = new THREE.Vector4(),
  _plane = new THREE.Plane(),
  _clip = new THREE.Vector4();

export class Water {
  constructor(engine, T) {
    this.engine = engine;
    this.T = T;
    const scene = engine.scene;
    this.ripple = makeWaterNormalTexture(256);
    this.reflRT = null;
    this.virtual = new THREE.PerspectiveCamera();
    this.virtual.layers.set(0);

    const U = (this.uniforms = sharedUniforms({
      uSea: { value: 0.6 },
      uOrigin: { value: new THREE.Vector3() },
      uRipple: { value: this.ripple },
      uDeep: { value: new THREE.Color(0.006, 0.016, 0.02) },
      uShallow: { value: new THREE.Color(0.03, 0.058, 0.052) },
      uReflTex: { value: null },
      uReflMat: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
    }));

    // near grid: a lattice that snaps to its own cells, so waves never swim
    const CELL = 1.25,
      NC = 192;
    const near = new THREE.PlaneGeometry(NC * CELL, NC * CELL, NC, NC);
    near.rotateX(-Math.PI / 2);
    const mat = (defs) =>
      new THREE.ShaderMaterial({
        uniforms: U,
        vertexShader: SEA_VERT,
        fragmentShader: SEA_FRAG,
        defines: defs,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        fog: false,
      });
    this.near = new THREE.Mesh(near, mat({ SEA_NEAR: 1 }));
    const far = new THREE.PlaneGeometry(2, 2, 1, 1);
    far.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(far, mat({}));
    for (const m of [this.near, this.far]) {
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.layers.set(LAYER_MAIN_ONLY);
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
    this.cell = CELL;

    this._buildRiver(scene);
    this._buildLava(scene);
    engine.hooks.reflect = (r, sc, cam) => this._renderReflection(r, sc, cam);
  }

  _buildRiver(scene) {
    const T = this.T,
      R = T.river;
    const pos = [],
      flow = [],
      dir = [],
      idx = [];
    const o = {};
    const STEP = 2.2;
    const surfAt = (s) => {
      R.at(s, o);
      return lerp(T.riverSurf[o.i], T.riverSurf[o.i + 1], o.t);
    };
    let rows = 0;
    const COLS = 7;
    for (let s = 0; s <= R.len; s += STEP) {
      R.at(s, o);
      const x = o.x,
        z = o.z,
        tx = o.tx,
        tz = o.tz;
      const y = surfAt(s);
      if (y <= 0.02) break; // the lake takes over
      const slope = Math.max(0, (surfAt(Math.max(0, s - 3)) - surfAt(Math.min(R.len, s + 3))) / 6);
      // find each bank: the first place the land rises out of the water
      const bank = (sgn) => {
        let d = 0.4;
        for (; d < 10; d += 0.4) if (T.heightAt(x - tz * d * sgn, z + tx * d * sgn) > y - 0.02) break;
        return Math.min(d + 0.5, 10);
      };
      const bl = T.heightAt(x, z) < y ? bank(-1) : 0.01,
        br = T.heightAt(x, z) < y ? bank(1) : 0.01;
      const fade = smoothstep(0.02, 0.35, y) * smoothstep(0, 6, s);
      for (let c = 0; c < COLS; c++) {
        const u = (c / (COLS - 1)) * 2 - 1;
        const d = u < 0 ? u * bl : u * br;
        pos.push(x - tz * d, y, z + tx * d);
        flow.push(u, s, fade);
        dir.push(tx, tz, slope);
      }
      if (rows > 0) {
        const a = (rows - 1) * COLS,
          b = rows * COLS;
        for (let c = 0; c < COLS - 1; c++) idx.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1);
      }
      rows++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false });
    this.river = new THREE.Mesh(g, m);
    this.river.renderOrder = 1;
    this.river.matrixAutoUpdate = false;
    this.river.layers.set(LAYER_MAIN_ONLY);
    scene.add(this.river);
  }

  _buildLava(scene) {
    const g = new THREE.CircleGeometry(SCAR.lava + 3.5, 72);
    g.rotateX(-Math.PI / 2);
    this.lavaUniforms = sharedUniforms({ uCentre: { value: new THREE.Vector2(SCAR.x, SCAR.z) }, uHeat: { value: 1 } });
    const m = new THREE.ShaderMaterial({ uniforms: this.lavaUniforms, vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG, fog: false });
    this.lava = new THREE.Mesh(g, m);
    this.lava.position.set(SCAR.x, WORLD.lava, SCAR.z);
    this.lava.updateMatrix();
    this.lava.matrixAutoUpdate = false;
    scene.add(this.lava);
  }

  update(dt) {
    const e = this.engine,
      cam = e.camera.position,
      c = this.cell;
    this.uniforms.uOrigin.value.set(Math.round(cam.x / c) * c, 0, Math.round(cam.z / c) * c);
    this.uniforms.uSea.value = 0.5 + 1.1 * shared.uWind.value.z;
    this.uniforms.uReflOn.value = e.q.reflect && cam.y > 0.05 ? 1 : 0;
    this.river.visible = cam.y < 140;
  }

  /** Mirror the camera in the water plane and draw the world (layer 0) into the reflection target. */
  _renderReflection(renderer, scene, camera) {
    if (camera.position.y <= 0.05) return;
    const e = this.engine;
    const w = Math.max(2, e.w >> 1),
      h = Math.max(2, e.h >> 1);
    if (!this.reflRT || this.reflRT.width !== w || this.reflRT.height !== h) {
      if (this.reflRT) this.reflRT.dispose();
      this.reflRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      this.uniforms.uReflTex.value = this.reflRT.texture;
    }
    const v = this.virtual;
    _n.set(0, 1, 0);
    // mirrored eye, target and up
    _v.copy(camera.position);
    _v.y = -_v.y;
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(camera.position);
    _look.y = -_look.y;
    v.position.copy(_v);
    v.up.set(0, 1, 0).applyMatrix4(_rot);
    v.up.y = -v.up.y;
    v.lookAt(_look);
    v.near = camera.near;
    v.far = camera.far;
    v.updateMatrixWorld();
    v.matrixWorldInverse.copy(v.matrixWorld).invert();
    v.projectionMatrix.copy(camera.projectionMatrix);
    const tm = this.uniforms.uReflMat.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(v.projectionMatrix);
    tm.multiply(v.matrixWorldInverse);
    // oblique near plane: nothing below the water gets into the mirror
    _plane.setFromNormalAndCoplanarPoint(_n, _t.set(0, 0.08, 0));
    _plane.applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = v.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
    _q.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
    _q.z = -1;
    _q.w = (1 + pm[10]) / pm[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x;
    pm[6] = _clip.y;
    pm[10] = _clip.z + 1;
    pm[14] = _clip.w;
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.reflRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, v);
    renderer.setRenderTarget(prev);
  }
}
