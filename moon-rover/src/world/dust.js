/* ============================================================
   REGOLITH IN FLIGHT
   ------------------------------------------------------------
   There is no air, so there is no billowing cloud and no settling
   haze — every grain flies a clean parabola at 1.62 m/s² and lands.
   That single fact is what makes lunar dust look lunar: rooster
   tails that arc far, hang, and drop as sharply as they rose.
   ============================================================ */
import * as THREE from 'three';
import { MOON_G } from './terrain.js';
import { clamp } from '../core/rng.js';

function grainSprite() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.98)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, 6.2832); x.fill();
  // bite the alpha with noise so a grain is a clod, not a Gaussian dot
  const img = x.getImageData(0, 0, S, S), p = img.data;
  const hs = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (a, b) => {
    const i = Math.floor(a), j = Math.floor(b);
    let fa = a - i, fb = b - j; fa = fa * fa * (3 - 2 * fa); fb = fb * fb * (3 - 2 * fb);
    const p00 = hs(i, j), p10 = hs(i + 1, j), p01 = hs(i, j + 1), p11 = hs(i + 1, j + 1);
    return p00 + (p10 - p00) * fa + (p01 - p00) * fb + (p00 - p10 - p01 + p11) * fa * fb;
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const o = (j * S + i) * 4;
    const n = vn(i * 0.30, j * 0.30) * 0.62 + vn(i * 0.8 + 9, j * 0.8 + 3) * 0.38;
    p[o + 3] = Math.min(255, p[o + 3] * (0.42 + 0.58 * n));
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Dust {
  constructor(scene, terrain, sunDirRef, max = 2200) {
    this.terrain = terrain;
    this.MAX = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.norm = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.tint = new Float32Array(max);        // 0 = regolith, 1 = anomalous (bright)

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.norm, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uTex: { value: grainSprite() },
        uSunDir: sunDirRef,
        uAlbedo: { value: new THREE.Vector3(0.152, 0.133, 0.108) },
        uSunCol: { value: new THREE.Vector3(2.05, 1.94, 1.76) },
        uAmb: { value: new THREE.Vector3(0.048, 0.056, 0.078) },
        uPx: { value: 1 }
      },
      vertexShader: /* glsl */`
        attribute vec3 aVel; attribute float aLife, aSeed, aTint;
        varying float vL, vAng, vStretch, vSeed, vTint;
        uniform float uPx;
        void main(){
          vL = aLife; vSeed = aSeed; vTint = aTint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 vv = (viewMatrix * vec4(aVel, 0.0)).xyz;
          vAng = atan(vv.y, vv.x);
          vStretch = clamp(1.0 + length(vv.xy) * 0.055, 1.0, 2.1);
          float sz = (0.55 + 0.85 * aSeed) * (1.0 + 0.9 * (1.0 - aLife));
          gl_PointSize = 62.0 * sz * uPx * sqrt(vStretch) / max(-mv.z, 0.6);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision mediump float;
        uniform sampler2D uTex; uniform vec3 uSunDir, uAlbedo, uSunCol, uAmb;
        varying float vL, vAng, vStretch, vSeed, vTint;
        void main(){
          vec2 pc = gl_PointCoord - 0.5;
          float c = cos(vAng), s = sin(vAng);
          pc = mat2(c, s, -s, c) * pc;
          pc.x /= vStretch;                                  // streak along travel
          float a = texture2D(uTex, pc + 0.5).a;
          if (a < 0.01) discard;
          // spherical impostor: the grain is lit by the same sun as the ground
          vec2 nc = (gl_PointCoord - 0.5) * 2.0;
          float r2 = dot(nc, nc);
          vec3 N = vec3(nc.x, -nc.y, sqrt(max(1.0 - r2, 0.0)));
          float lam = max(dot(N, normalize(uSunDir)), 0.0);
          vec3 alb = mix(uAlbedo, vec3(0.36, 0.52, 0.60), vTint);
          vec3 col = alb * (0.82 + 0.36 * vSeed) * (lam * uSunCol + uAmb);
          col += vec3(0.10, 0.55, 0.72) * vTint * 0.9;
          float aIn = smoothstep(0.0, 0.10, vL);
          float aOut = smoothstep(0.0, 0.30, 1.0 - vL);
          gl_FragColor = vec4(col, a * aIn * aOut * 0.92);
        }`
    });

    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.geo = g;
    scene.add(this.points);
  }

  /** Launch grains. dirX/dirZ bias the cone along a heading (a rooster tail). */
  spawn(n, x, y, z, force, spread, dirX = 0, dirZ = 0, tint = 0) {
    const biased = (dirX || dirZ);
    const hd = biased ? Math.atan2(dirZ, dirX) : 0;
    for (let k = 0; k < n; k++) {
      if (this.n >= this.MAX) return;
      const i = this.n++;
      const a = biased ? hd + (Math.random() - 0.5) * 2.0 : Math.random() * 6.2832;
      const out = (0.35 + Math.random() * 1.25) * force;
      const vy = (0.85 + Math.random() * 1.9) * force * (biased ? 0.62 : 1.0);
      const ring = spread * (0.15 + Math.random() * 0.85);
      this.pos[i * 3] = x + Math.cos(a) * ring;
      this.pos[i * 3 + 1] = y + 0.05;
      this.pos[i * 3 + 2] = z + Math.sin(a) * ring;
      this.vel[i * 3] = Math.cos(a) * out;
      this.vel[i * 3 + 1] = vy;
      this.vel[i * 3 + 2] = Math.sin(a) * out;
      this.seed[i] = Math.random();
      this.tint[i] = tint;
      // a grain lives exactly as long as its parabola: 2·v/g, plus a beat on the ground
      this.maxLife[i] = 2 * vy / MOON_G + 0.55;
      this.life[i] = this.maxLife[i];
    }
  }

  update(dt) {
    const P = this.pos, V = this.vel, L = this.life, M = this.maxLife, N = this.norm, T = this.tint, S = this.seed;
    let i = 0;
    while (i < this.n) {
      L[i] -= dt;
      const i3 = i * 3;
      V[i3 + 1] -= MOON_G * dt;                  // vacuum: gravity is the only force
      P[i3] += V[i3] * dt;
      P[i3 + 1] += V[i3 + 1] * dt;
      P[i3 + 2] += V[i3 + 2] * dt;
      // land on the regolith it came from
      if (V[i3 + 1] < 0) {
        const gh = this.terrain.heightAt(P[i3], P[i3 + 2]);
        if (P[i3 + 1] <= gh + 0.02) {
          P[i3 + 1] = gh + 0.02;
          V[i3] *= 0.22; V[i3 + 2] *= 0.22; V[i3 + 1] = 0;
          if (L[i] > 0.34) L[i] = 0.34;           // no bounce; regolith is not sand on a beach
        }
      }
      if (L[i] <= 0) {                            // swap-remove
        const j = --this.n, j3 = j * 3;
        P[i3] = P[j3]; P[i3 + 1] = P[j3 + 1]; P[i3 + 2] = P[j3 + 2];
        V[i3] = V[j3]; V[i3 + 1] = V[j3 + 1]; V[i3 + 2] = V[j3 + 2];
        L[i] = L[j]; M[i] = M[j]; S[i] = S[j]; T[i] = T[j];
        continue;
      }
      N[i] = clamp(L[i] / M[i], 0, 1);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aVel.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSeed.needsUpdate = true;
    this.geo.attributes.aTint.needsUpdate = true;
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }

  /** Resize the particle pool for a new quality tier. Grains in flight are
      kept — they are ballistic and mid-parabola, and popping them all at once
      is more visible than the budget change itself. */
  setMax(max) {
    if (max === this.MAX) return;
    const keep = Math.min(this.n, max);
    const grow = (old, stride) => {
      const a = new Float32Array(max * stride);
      a.set(old.subarray(0, keep * stride));
      return a;
    };
    this.pos = grow(this.pos, 3);
    this.vel = grow(this.vel, 3);
    this.life = grow(this.life, 1);
    this.maxLife = grow(this.maxLife, 1);
    this.norm = grow(this.norm, 1);
    this.seed = grow(this.seed, 1);
    this.tint = grow(this.tint, 1);
    this.MAX = max;
    this.n = keep;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.norm, 1));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.geo.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 1));
    this.geo.setDrawRange(0, keep);
  }
}
