// Sky dome, sun and moon, clouds, stars, and the light model that follows the hour:
// it owns the main light's direction and colour, the sky light, the fog colours and the exposure.
import * as THREE from 'three';
import { shared, sharedUniforms } from './shared.js';
import './atmos.js';
import { clamp, lerp, smoothstep, saturate } from '../core/math.js';

// Keys by the sun's height (sin of elevation). Colours are linear HDR.
// zen, hor: sky. glow: halo round the sun. sun: light colour, si: its intensity. amb: sky light scale. ev: exposure.
const KEYS = [
  { y: -0.3, zen: [0.007, 0.011, 0.026], hor: [0.02, 0.031, 0.055], glow: [0, 0, 0], sun: [1, 0.5, 0.25], si: 0, amb: 1.0, ev: 3.3 },
  { y: -0.1, zen: [0.022, 0.03, 0.07], hor: [0.12, 0.085, 0.1], glow: [0.5, 0.17, 0.06], sun: [1, 0.42, 0.18], si: 0, amb: 1.0, ev: 2.3 },
  { y: -0.01, zen: [0.07, 0.095, 0.18], hor: [0.5, 0.26, 0.14], glow: [2.0, 0.75, 0.24], sun: [1, 0.42, 0.17], si: 1.3, amb: 1.0, ev: 1.45 },
  { y: 0.09, zen: [0.1, 0.145, 0.25], hor: [0.6, 0.44, 0.3], glow: [2.4, 1.3, 0.6], sun: [1, 0.64, 0.36], si: 3.5, amb: 1.0, ev: 1.1 },
  { y: 0.24, zen: [0.125, 0.18, 0.29], hor: [0.5, 0.5, 0.49], glow: [1.7, 1.3, 0.9], sun: [1, 0.84, 0.64], si: 3.9, amb: 1.0, ev: 0.98 },
  { y: 0.62, zen: [0.145, 0.205, 0.32], hor: [0.45, 0.5, 0.54], glow: [1.2, 1.1, 0.96], sun: [1, 0.93, 0.82], si: 3.9, amb: 1.0, ev: 0.94 },
];
const MOON_LIGHT = [0.5, 0.64, 1.0];
const SWING_C = Math.cos(0.7),
  SWING_S = Math.sin(0.7);

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
#include <common>
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlowCol;
uniform vec3 uSunPos;
uniform vec3 uSunDisc;
uniform vec3 uMoonPos;
uniform vec3 uMoonCol;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uStars;
uniform float uHaze;
uniform float uEnv;

void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-up * 3.4));
  float sd = max(dot(d, uSunPos), 0.0);
  col += uGlowCol * (pow(sd, 5.0) * 0.16 + pow(sd, 42.0) * 0.5) * smoothstep(-0.12, 0.05, d.y + uSunPos.y * 0.5 + 0.06);

  // stars and the moon
  float md = max(dot(d, uMoonPos), 0.0);
  if (uStars > 0.002) {
    vec3 sp = d * 190.0;
    vec3 id = floor(sp);
    float h = tpHash31(id);
    vec3 off = tpHash33(id + 7.0) - 0.5;
    float pt = smoothstep(0.38, 0.0, length(fract(sp) - 0.5 - off * 0.5));
    float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 5.0) + h * 80.0);
    col += step(0.9935, h) * pt * tw * uStars * mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.86, 1.0), fract(h * 91.7)) * smoothstep(0.02, 0.3, d.y) * 1.6;
    // a faint river of stars
    float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.5, -0.8))) * 3.2, 2.0));
    col += uStars * band * 0.012 * (0.6 + 0.8 * texture2D(uNoiseTex, d.xz * 1.7 + d.y).r) * vec3(0.7, 0.8, 1.0);
  }
  float disc = smoothstep(0.99952, 0.9997, md);
  if (md > 0.99) {
    vec3 mu = normalize(cross(uMoonPos, vec3(0.0, 1.0, 0.0)));
    vec3 mv = cross(uMoonPos, mu);
    vec2 mc = vec2(dot(d, mu), dot(d, mv)) * 34.0;
    float seas = texture2D(uNoiseTex, mc * 0.5 + 0.2).r * 0.6 + texture2D(uNoiseTex, mc * 1.6).g * 0.4;
    float limb = sqrt(max(0.0, 1.0 - dot(mc, mc) * 0.92));
    col += uMoonCol * disc * (0.45 + 0.75 * smoothstep(0.35, 0.7, seas)) * (0.5 + 0.5 * limb) * 5.0;
  }
  col += uMoonCol * (pow(md, 260.0) * 0.5 + pow(md, 22.0) * 0.045);
  col += uSunDisc * smoothstep(0.99962, 0.99982, sd);

  // clouds: one field on a plane, lit from the sun's side
  if (d.y > -0.03) {
    float inv = 1.0 / (d.y + 0.085);
    vec2 p = cameraPosition.xz + d.xz * inv * uCloudB.y;
    float n = tpCloudField(p);
    n += (texture2D(uNoiseTex, p * uCloud.y * 13.0 + uCloud.zw * 2.3).a - 0.5) * 0.11;
    float a = tpCloudCover(n);
    vec2 toSun = normalize(uSunPos.xz + vec2(1e-4)) * 240.0;
    float a2 = tpCloudCover(tpCloudField(p + toSun));
    float shade = clamp(1.0 - a2 * 0.72 - a * 0.3, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, shade * shade);
    cc += uGlowCol * pow(sd, 7.0) * (1.0 - a) * 0.55;
    cc += uMoonCol * pow(md, 9.0) * (1.0 - a) * 0.5;
    // a second, higher veil
    float hi = texture2D(uNoiseTex, p * uCloud.y * 0.37 - uCloud.zw * 0.6).g;
    col = mix(col, mix(uCloudDark, uCloudLit, 0.7), smoothstep(0.5, 0.95, hi) * 0.22 * uCloud.x * smoothstep(0.0, 0.2, d.y));
    col = mix(col, cc, a * smoothstep(-0.03, 0.14, d.y));
  }

  // the horizon meets the fog exactly, so far land dissolves into the sky
  vec3 fogc = uFogColor + uFogSunColor * pow(sd, uFogB.x) * (1.0 - 0.7 * uFogB.z);
  float hz = exp(-up * uHaze);
  col = mix(col, fogc, clamp(hz, 0.0, 1.0) * uFogB.y);
  if (uEnv > 0.5 && d.y < 0.0) col = mix(fogc, uHorizon * vec3(0.16, 0.14, 0.12), smoothstep(0.0, -0.25, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

const _c = new THREE.Color();
const mix3 = (a, b, t, out) => {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
};
const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.uniforms = sharedUniforms({
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlowCol: { value: new THREE.Color() },
      uSunPos: { value: new THREE.Vector3(0, 1, 0) },
      uSunDisc: { value: new THREE.Color() },
      uMoonPos: { value: new THREE.Vector3(0, -1, 0) },
      uMoonCol: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uStars: { value: 0 },
      uHaze: { value: 7 },
      uEnv: { value: 0 },
    });
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = true;

    // what the rest of the engine reads
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.lightColor = new THREE.Color();
    this.lightIntensity = 1;
    this.ambient = new THREE.Color();
    this.exposure = 1;
    this.night = 0;
    this.hour = 12;
    // weather, set from outside (0..1)
    this.overcast = 0.6;
    this.fog = 0.5; // how thick
    this.fogTint = new THREE.Color(1, 1, 1); // regional tint of the fog
    this.fogLift = 0; // 0..1 extra brightness of the fog (mist in the sun)
    this.cloudOffset = new THREE.Vector2();
    this.dim = 1; // dims every light (the Gloom)

    // environment map for reflections and soft sky light
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.material);
    this.envScene.add(this.envMesh);
    this.envRT = null;
    this._envAge = 1e9;
    this._k = { zen: [0, 0, 0], hor: [0, 0, 0], glow: [0, 0, 0], sun: [0, 0, 0] };
  }

  /** Advance the sky. hour 0..24; returns nothing, read the public fields after. */
  update(dt, hour, camera) {
    this.hour = hour;
    // the sun rides a circle tilted toward the north (-Z): the road up from the landing walks into the light
    const a = ((hour - 6) / 12) * Math.PI;
    const tilt = 0.9;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), -(Math.sin(a) * Math.sin(tilt) + 0.08)).normalize();
    // and the whole path is swung so that the afternoon sun stands over the chapel as seen from the road
    const sx = this.sunDir.x,
      sz = this.sunDir.z;
    this.sunDir.x = sx * SWING_C - sz * SWING_S;
    this.sunDir.z = sx * SWING_S + sz * SWING_C;
    const am = a + Math.PI + 0.35;
    this.moonDir.set(Math.cos(am) * 0.8, Math.sin(am) * 0.78 + 0.12, -Math.sin(am) * 0.45 + 0.25).normalize();
    const sy = this.sunDir.y;

    // palette for this sun height
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].y < sy) i++;
    const k0 = KEYS[i],
      k1 = KEYS[i + 1];
    const t = saturate((sy - k0.y) / (k1.y - k0.y));
    const K = this._k;
    mix3(k0.zen, k1.zen, t, K.zen);
    mix3(k0.hor, k1.hor, t, K.hor);
    mix3(k0.glow, k1.glow, t, K.glow);
    mix3(k0.sun, k1.sun, t, K.sun);
    let si = lerp(k0.si, k1.si, t);
    this.exposure = lerp(k0.ev, k1.ev, t);
    const night = smoothstep(0.02, -0.22, sy);
    this.night = night;

    // overcast pulls the sky toward grey and takes the sun's edge off
    const ov = this.overcast;
    const gz = lum(K.zen) * 1.25,
      gh = lum(K.hor) * 0.95;
    for (let c = 0; c < 3; c++) {
      K.zen[c] = lerp(K.zen[c], gz * (c === 2 ? 1.08 : 0.97), ov * 0.82);
      K.hor[c] = lerp(K.hor[c], gh * (c === 2 ? 1.05 : 0.98), ov * 0.7);
      K.glow[c] *= 1 - ov * 0.62;
    }
    si *= 1 - ov * 0.55;
    const ambScale = (0.9 + ov * 0.24) * this.dim;
    // (the night keeps a floor of cold sky light: black silhouettes, but ground a walker can read)
    const nf = night * this.dim;
    this.ambient.setRGB((K.zen[0] * 0.6 + K.hor[0] * 0.4) * ambScale + 0.011 * nf, (K.zen[1] * 0.6 + K.hor[1] * 0.4) * ambScale + 0.015 * nf, (K.zen[2] * 0.6 + K.hor[2] * 0.4) * ambScale + 0.027 * nf);
    // a lid of cloud is darker than the day under it
    const lid = 1 - ov * 0.46 * (1 - night * 0.6);
    for (let c = 0; c < 3; c++) {
      K.zen[c] *= lid * (1 - ov * 0.12);
      K.hor[c] *= lid;
    }

    // main light: the sun while it is up, then the moon
    const moonUp = smoothstep(-0.02, 0.14, this.moonDir.y);
    const sunW = smoothstep(-0.03, 0.03, sy);
    const U = this.uniforms;
    if (sunW > 0.001) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.035) {
        this.lightDir.y = 0.035;
        this.lightDir.normalize();
      }
      this.lightColor.setRGB(K.sun[0], K.sun[1], K.sun[2]);
      this.lightIntensity = si * sunW * this.dim;
    } else {
      this.lightDir.copy(this.moonDir);
      if (this.lightDir.y < 0.1) {
        this.lightDir.y = 0.1;
        this.lightDir.normalize();
      }
      this.lightColor.setRGB(MOON_LIGHT[0], MOON_LIGHT[1], MOON_LIGHT[2]);
      this.lightIntensity = 0.85 * moonUp * smoothstep(-0.03, -0.12, sy) * (1 - ov * 0.45) * this.dim;
    }

    U.uZenith.value.setRGB(K.zen[0], K.zen[1], K.zen[2]);
    U.uHorizon.value.setRGB(K.hor[0], K.hor[1], K.hor[2]);
    U.uGlowCol.value.setRGB(K.glow[0], K.glow[1], K.glow[2]);
    shared.uSkyZen.value.copy(U.uZenith.value);
    shared.uSkyHor.value.copy(U.uHorizon.value);
    U.uSunPos.value.copy(this.sunDir);
    U.uMoonPos.value.copy(this.moonDir);
    const discVis = (1 - ov * 0.9) * smoothstep(-0.06, 0.02, sy);
    U.uSunDisc.value.setRGB(K.sun[0] * 60 * discVis, K.sun[1] * 60 * discVis, K.sun[2] * 60 * discVis);
    const mv = night * (1 - ov * 0.5);
    U.uMoonCol.value.setRGB(0.75 * mv, 0.86 * mv, 1.0 * mv);
    U.uStars.value = night * Math.max(0, 1 - ov * 1.15);
    // clouds take the sun's colour on the lit side and the sky's on the dark
    const cl = lum(K.hor);
    U.uCloudLit.value.setRGB(cl * 0.9 + K.sun[0] * si * 0.2 + K.glow[0] * 0.2, cl * 0.9 + K.sun[1] * si * 0.2 + K.glow[1] * 0.2, cl * 0.95 + K.sun[2] * si * 0.2 + K.glow[2] * 0.2);
    U.uCloudDark.value.setRGB(K.zen[0] * 0.42 + cl * 0.08, K.zen[1] * 0.43 + cl * 0.08, K.zen[2] * 0.47 + cl * 0.09);
    U.uHaze.value = lerp(11, 3.2, this.fog);

    // sky light and fog
    shared.uAmbient.value.copy(this.ambient);
    const ft = this.fogTint,
      lift = 1 + this.fogLift;
    shared.uFogColor.value.setRGB(lerp(K.hor[0], K.zen[0], 0.42) * 0.9 * ft.r * lift * this.dim, lerp(K.hor[1], K.zen[1], 0.42) * 0.9 * ft.g * lift * this.dim, lerp(K.hor[2], K.zen[2], 0.42) * 0.9 * ft.b * lift * this.dim);
    const fs = (sunW > 0.001 ? si * sunW * 0.2 : this.lightIntensity * 0.5) * this.dim;
    _c.copy(this.lightColor);
    shared.uFogSunColor.value.setRGB(_c.r * fs + K.glow[0] * 0.26 * this.dim, _c.g * fs * 0.88 + K.glow[1] * 0.22 * this.dim, _c.b * fs * 0.7 + K.glow[2] * 0.16 * this.dim);
    shared.uSunDir.value.copy(this.lightDir);
    shared.uSunColor.value.copy(this.lightColor).multiplyScalar(this.lightIntensity);
    shared.uGlow.value = 1 + night * 0.9;

    // clouds drift with the wind
    const w = shared.uWind.value;
    this.cloudOffset.x += w.x * dt * 0.0042 * (0.4 + w.z);
    this.cloudOffset.y += w.y * dt * 0.0042 * (0.4 + w.z);
    shared.uCloud.value.set(lerp(0.12, 1, ov), 1 / 1900, this.cloudOffset.x, this.cloudOffset.y);
    shared.uCloudB.value.set(lerp(0.75, 0.3, ov) * (sunW > 0.001 ? 1 : 0.6), 620, 0, 0);

    if (camera) {
      this.mesh.position.copy(camera.position);
      this.mesh.scale.setScalar(camera.far * 0.0085);
    }
    this._envAge += dt;
  }

  /** Re-bake the sky into the scene's environment map now and then. */
  updateEnvironment(scene, force = false) {
    if (!force && this._envAge < 2.5) return;
    this._envAge = 0;
    this.uniforms.uEnv.value = 1;
    this.envMesh.scale.setScalar(10);
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.uniforms.uEnv.value = 0;
    scene.environment = rt.texture;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
  }
}
