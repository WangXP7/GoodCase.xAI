/* ============================================================
   THE SKY OVER ANAXAGORAS  (73.4°N, 10.1°W — near the north limb)
   ------------------------------------------------------------
   No atmosphere means: black sky at noon, stars that do not twinkle,
   a sun that never softens, and a terminator you can stand on.
   At this latitude the sun does not arc overhead — it circles the
   horizon at 4°–19°, so shadows sweep around you like a sundial.
   Earth hangs low over the northern rim and barely moves at all.
   ============================================================ */
import * as THREE from 'three';
import { makeRNG, clamp, sstep, lerp } from '../core/rng.js';

const SUN_ANGULAR = 0.00930;     // 0.53° — the real solar disc from 1 AU
const EARTH_ANGULAR = 0.0327;    // ~1.9° from the Moon: four sun-widths across

/* Blackbody -> linear RGB, good enough for stellar colour */
function kelvinToRGB(k, out) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.52 * Math.log(t - 10) - 305.04;
  out.set(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255);
  // to linear
  out.r = Math.pow(out.r, 2.2); out.g = Math.pow(out.g, 2.2); out.b = Math.pow(out.b, 2.2);
  return out;
}

export class Sky {
  constructor(renderer, scene, textures, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.renderOrder = -1000;
    scene.add(this.group);

    this.sunDir = new THREE.Vector3(1, 0.2, 0).normalize();
    this.earthDir = new THREE.Vector3(0, 0.28, -1).normalize();
    this.sunAz = 0.6;
    this.sunAlt = 0.20;
    this.starIntensity = 1.0;

    this._buildGalaxy();
    this._buildStars();
    this._buildSun();
    this._buildEarth(textures);
    this._buildEnv();
  }

  /* ---------------- deep sky: Milky Way + zodiacal glow ---------------- */
  _buildGalaxy() {
    const geo = new THREE.SphereGeometry(9000, 48, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: { uInt: { value: 1.0 } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec3 vD; uniform float uInt;
        float h(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p += dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        float fb(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=n3(p)*a; p*=2.13; a*=0.5; } return s; }
        void main(){
          // galactic plane tilted through the sky
          vec3 gn = normalize(vec3(0.36, 0.79, -0.49));
          float b = abs(dot(vD, gn));
          float band = exp(-b*b*30.0);
          float clouds = fb(vD*19.0);
          float dark   = fb(vD*34.0 + 40.0);
          float lum = band * (0.24 + 0.80*clouds) * (0.34 + 0.66*smoothstep(0.30,0.78,dark));
          vec3 col = mix(vec3(0.030,0.035,0.058), vec3(0.062,0.056,0.047), clouds) * lum;
          col += vec3(0.011,0.016,0.032) * pow(band, 3.0) * 0.45;   // core glow
          // faint all-sky floor so the void is not a flat #000
          col += vec3(0.0022,0.0026,0.0042) * (0.55 + 0.45*fb(vD*6.0));
          gl_FragColor = vec4(col * uInt, 1.0);
        }`
    });
    this.galaxy = new THREE.Mesh(geo, mat);
    this.galaxy.frustumCulled = false;
    this.galaxy.renderOrder = -1000;
    this.galaxyMat = mat;
    this.group.add(this.galaxy);
  }

  /* ---------------- stars: steady, hard, airless ---------------- */
  _buildStars() {
    const N = this.quality.stars;
    const rng = makeRNG(0xA17A6);
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const mag = new Float32Array(N);
    const c = new THREE.Color();
    const gn = new THREE.Vector3(0.36, 0.79, -0.49).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      // uniform on the sphere, then biased toward the galactic plane
      let ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(th), u, s * Math.sin(th));
        const b = Math.abs(v.dot(gn));
        ok = rng() < 0.30 + 0.70 * Math.exp(-b * b * 7.0);
      }
      v.multiplyScalar(8600);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      // magnitude: a steep power law — a few bright ones, a haze of faint ones
      const m = Math.pow(rng(), 3.1);
      mag[i] = 0.10 + m * 1.55;
      // spectral temperature, weighted toward cool dwarfs
      const t = rng();
      const kelvin = t < 0.76 ? lerp(2900, 5600, Math.pow(rng(), 0.7))
                   : t < 0.95 ? lerp(5600, 8200, rng())
                              : lerp(9000, 24000, rng());
      kelvinToRGB(kelvin, c);
      const boost = 0.55 + 0.45 * m;
      col[i * 3] = c.r * boost; col[i * 3 + 1] = c.g * boost; col[i * 3 + 2] = c.b * boost;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uInt: { value: 1.0 }, uPx: { value: 1.0 } },
      vertexShader: /* glsl */`
        attribute vec3 aCol; attribute float aMag;
        varying vec3 vC; varying float vM;
        uniform float uPx;
        void main(){
          vC = aCol; vM = aMag;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.05 + aMag*2.35) * uPx;
        }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec3 vC; varying float vM; uniform float uInt;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d,d);
          if (r2 > 0.25) discard;
          // an Airy-ish core: no atmosphere, so no scintillation and no bloat
          float core = exp(-r2 * 42.0);
          float halo = exp(-r2 * 7.0) * 0.22;
          gl_FragColor = vec4(vC * (core + halo) * vM * 2.6 * uInt, 1.0);
        }`
    });
    this.stars = new THREE.Points(g, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.starMat = mat;
    this.group.add(this.stars);
  }

  /** Restar the sky at a new tier. Purely visual — nothing collides with a
      star — so this just rebuilds the point cloud. starIntensity is re-applied
      from update() every frame, so the new material picks it up on its own. */
  setQuality(q) {
    if (q.stars === this.quality.stars) { this.quality = q; return; }
    this.quality = q;
    this.group.remove(this.stars);
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this._buildStars();
  }

  /* ---------------- the sun ---------------- */
  _buildSun() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uInt: { value: 1.0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; uniform float uInt;
        void main(){
          vec2 d = (vUv-0.5)*2.0; float r = length(d);
          float disc = 1.0 - smoothstep(0.130, 0.150, r);      // the photosphere: a hard edge
          float limb = mix(1.0, 0.78, smoothstep(0.0,0.150,r)); // limb darkening
          float corona = pow(max(0.0, 1.0 - r), 5.0) * 0.30;
          float spikes = 0.0;
          float a = atan(d.y, d.x);
          spikes += pow(max(0.0, abs(cos(a*2.0))), 62.0) * pow(max(0.0,1.0-r), 2.2) * 0.55;
          vec3 col = vec3(1.0,0.985,0.955) * (disc*limb*26.0) + vec3(1.0,0.94,0.80)*(corona+spikes)*3.2;
          float a2 = clamp(disc + corona*2.4 + spikes*2.0, 0.0, 1.0);
          if (a2 < 0.002) discard;
          gl_FragColor = vec4(col*uInt, a2);
        }`
    });
    const D = 8000 * SUN_ANGULAR / 0.130 * 0.5;    // disc occupies r=0.13 of the quad
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, D * 2), mat);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -998;
    this.sunMat = mat;
    this.group.add(this.sun);
  }

  /* ---------------- Earth, low over the northern rim ---------------- */
  _buildEarth(tex) {
    const R = 8000 * EARTH_ANGULAR * 0.5;
    const g = new THREE.SphereGeometry(R, 96, 64);
    this.earthMat = new THREE.ShaderMaterial({
      fog: false, depthWrite: false, depthTest: true, transparent: true,
      uniforms: {
        uDay: { value: tex.earthDay }, uNight: { value: tex.earthNight }, uCloud: { value: tex.earthClouds },
        uSun: { value: new THREE.Vector3(1, 0, 0) }, uInt: { value: 1.0 }, uSpin: { value: 0 }
      },
      vertexShader: `varying vec3 vN; varying vec2 vUv; varying vec3 vW;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vUv = uv;
          vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec3 vN; varying vec2 vUv; varying vec3 vW;
        uniform sampler2D uDay, uNight, uCloud; uniform vec3 uSun; uniform float uInt, uSpin;
        void main(){
          vec2 uv = vec2(fract(vUv.x + uSpin), vUv.y);
          float lam = dot(vN, uSun);
          float lit = smoothstep(-0.10, 0.16, lam);            // soft terminator
          vec3 day = texture2D(uDay, uv).rgb;
          vec3 night = texture2D(uNight, uv).rgb;
          float cl = texture2D(uCloud, vec2(fract(uv.x + uSpin*0.22), uv.y)).r;
          day = mix(day, vec3(0.96,0.97,1.0), cl*0.90);
          vec3 col = day * lit * 2.05;
          col += night * (1.0-lit) * 1.45 * (1.0 - cl*0.75);    // city light through the cloud deck
          // rayleigh limb: the thin blue line that makes Earth read as alive
          vec3 V = normalize(cameraPosition - vW);
          float edge = pow(clamp(1.0 - abs(dot(vN, V)), 0.0, 1.0), 3.0);
          col += vec3(0.24,0.46,0.92) * edge * (0.30 + 0.70*max(lam,0.0)) * 1.5;
          gl_FragColor = vec4(col*uInt, 1.0);
        }`
    });
    this.earth = new THREE.Mesh(g, this.earthMat);
    this.earth.frustumCulled = false;
    this.earth.renderOrder = -997;
    this.group.add(this.earth);

    // atmospheric halo
    this.earthGlow = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.055, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, fog: false,
        uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uInt: { value: 1.0 } },
        vertexShader: `varying vec3 vN; varying vec3 vW;
          void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz;
            gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `precision highp float; varying vec3 vN; varying vec3 vW;
          uniform vec3 uSun; uniform float uInt;
          void main(){
            vec3 V = normalize(cameraPosition - vW);
            float e = pow(clamp(1.0 - abs(dot(vN, V)), 0.0, 1.0), 2.6);
            float lit = smoothstep(-0.35, 0.35, dot(vN, uSun));
            gl_FragColor = vec4(vec3(0.28,0.52,1.0) * e * lit * 0.85 * uInt, 1.0);
          }`
      })
    );
    this.earthGlow.frustumCulled = false;
    this.earthGlow.renderOrder = -996;
    this.group.add(this.earthGlow);
  }

  /* ---------------- image-based lighting ----------------
     On an airless world the environment is: the sun, the black sky,
     Earth, and a very bright ground bounce. That last one is what
     actually lights the underside of the rover. */
  _buildEnv() {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(1, 0.2, 0) },
        uEarth: { value: new THREE.Vector3(0, 0.3, -1) },
        uGround: { value: new THREE.Vector3(0.19, 0.168, 0.140) },
        uSunCol: { value: new THREE.Vector3(2.6, 2.46, 2.24) }
      },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec3 vD;
        uniform vec3 uSun, uEarth, uGround, uSunCol;
        void main(){
          vec3 d = normalize(vD);
          vec3 col = vec3(0.0018, 0.0022, 0.0038);            // starlight floor
          // ground hemisphere: regolith lit by the grazing sun, brightest toward the sun
          float g = smoothstep(0.06, -0.55, d.y);
          float back = 0.55 + 0.75 * max(dot(normalize(vec3(uSun.x,0.0,uSun.z)), normalize(vec3(d.x,0.0,d.z))), 0.0);
          col += uGround * uSunCol * g * 0.34 * back * max(uSun.y, 0.05) * 5.4;
          // the sun itself
          float s = dot(d, normalize(uSun));
          col += uSunCol * 30.0 * smoothstep(0.99987, 0.99995, s);
          col += uSunCol * 0.55 * pow(max(s,0.0), 220.0);
          // Earth
          float e = dot(d, normalize(uEarth));
          col += vec3(0.30,0.44,0.72) * 2.2 * smoothstep(0.99930, 0.99968, e);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envMat));
    this.envRT = null;
    this._envDirty = true;
  }

  refreshEnv() {
    this.envMat.uniforms.uSun.value.copy(this.sunDir);
    this.envMat.uniforms.uEarth.value.copy(this.earthDir);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 4000);
    if (old) old.dispose();
    this.scene.environment = this.envRT.texture;
    this._envDirty = false;
  }

  /* ---------------- per-frame ---------------- */
  setSun(azimuth, altitude) {
    this.sunAz = azimuth; this.sunAlt = altitude;
    const ca = Math.cos(altitude);
    this.sunDir.set(ca * Math.cos(azimuth), Math.sin(altitude), ca * Math.sin(azimuth)).normalize();
  }

  update(dt, camera, elapsed) {
    this.group.position.copy(camera.position);

    // sun billboard
    this.sun.position.copy(camera.position).addScaledVector(this.sunDir, 7600);
    this.sun.quaternion.copy(camera.quaternion);

    // Earth: fixed in the lunar sky (tidal lock) with a slow libration wobble
    const lib = elapsed * 0.0021;
    const az = 1.62 + Math.sin(lib) * 0.055;
    const alt = 0.255 + Math.cos(lib * 0.83) * 0.030;
    this.earthDir.set(Math.cos(alt) * Math.cos(az), Math.sin(alt), Math.cos(alt) * Math.sin(az)).normalize();
    const ep = _v.copy(camera.position).addScaledVector(this.earthDir, 7400);
    this.earth.position.copy(ep);
    this.earthGlow.position.copy(ep);
    this.earth.rotation.y = -elapsed * 0.0009;
    this.earthMat.uniforms.uSun.value.copy(this.sunDir);
    this.earthGlow.material.uniforms.uSun.value.copy(this.sunDir);

    // Sunlight washes the star field out of any real exposure; keep a trace.
    const wash = lerp(1.0, 0.34, sstep(-0.02, 0.13, this.sunDir.y));
    this.starMat.uniforms.uInt.value = this.starIntensity * wash;
    this.galaxyMat.uniforms.uInt.value = this.starIntensity * wash;

    if (this._envDirty) this.refreshEnv();
  }

  markEnvDirty() { this._envDirty = true; }

  dispose() {
    this.pmrem.dispose();
    if (this.envRT) this.envRT.dispose();
  }
}

const _v = new THREE.Vector3();
